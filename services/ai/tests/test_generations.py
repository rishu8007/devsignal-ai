import asyncio
from dataclasses import dataclass
from types import SimpleNamespace
from typing import cast

import pytest
from fastapi import Request
from fastapi.testclient import TestClient
from httpx2 import Request as HttpxRequest
from httpx2 import Response
from openai import APITimeoutError, RateLimitError

from app.api.dependencies import require_internal_api_key
from app.errors import ApplicationError
from app.main import app
from app.prompts import SYSTEM_PROMPT
from app.providers.openai_provider import OpenAIProvider, ProviderError
from app.schemas.generation import (
    GenerationRequest,
    GenerationVariation,
    ProviderGenerationOutput,
    ProviderGenerationResult,
)

VALID_CONTENT = "This is a grounded LinkedIn post based only on the submitted project notes. " * 3


@dataclass
class FakeProvider:
    output: ProviderGenerationOutput | None = None
    error: Exception | None = None

    async def generate(self, _request: GenerationRequest) -> ProviderGenerationResult:
        if self.error:
            raise self.error
        assert self.output is not None
        return ProviderGenerationResult(output=self.output, model="provider-model")

    async def close(self) -> None:
        pass


def valid_output() -> ProviderGenerationOutput:
    return ProviderGenerationOutput(
        variations=[
            GenerationVariation(angle="professional_impact", content=VALID_CONTENT),
            GenerationVariation(angle="technical_depth", content=VALID_CONTENT),
            GenerationVariation(angle="learning_story", content=VALID_CONTENT),
        ]
    )


def request_payload() -> dict[str, str]:
    return {
        "topic": "Connecting my Next.js dashboard to an authenticated API",
        "notes": (
            "I connected the dashboard form to an authenticated Express API and verified the flow."
        ),
        "primaryAudience": "Developers & engineers",
        "contentType": "Build in public",
    }


def client_with(provider: FakeProvider) -> TestClient:
    client = TestClient(app)
    client.__enter__()
    app.state.provider = provider
    return client


def test_generation_success_normalizes_order() -> None:
    client = client_with(FakeProvider(output=valid_output()))
    try:
        response = client.post(
            "/api/v1/generations",
            json=request_payload(),
            headers={"X-Internal-API-Key": "test-internal-key-that-is-at-least-32-characters"},
        )
    finally:
        client.__exit__(None, None, None)
    assert response.status_code == 200
    assert [item["angle"] for item in response.json()["data"]["variations"]] == [
        "technical_depth",
        "learning_story",
        "professional_impact",
    ]
    assert response.json()["data"]["model"] == "provider-model"


def test_grounding_prompt_prohibits_unsupported_facts() -> None:
    for prohibited in (
        "durations",
        "dates",
        "sprints",
        "deadlines",
        "team involvement",
        "collaboration",
        "deployment status",
        "scale",
        "metrics",
        "business outcomes",
    ):
        assert prohibited in SYSTEM_PROMPT
    assert "Do not force a" in SYSTEM_PROMPT
    assert "narrative into the" in SYSTEM_PROMPT


@pytest.mark.parametrize("header", [None, "wrong"])
def test_generation_authentication_is_safe(header: str | None) -> None:
    client = client_with(FakeProvider(output=valid_output()))
    try:
        headers = {} if header is None else {"X-Internal-API-Key": header}
        response = client.post("/api/v1/generations", json=request_payload(), headers=headers)
    finally:
        client.__exit__(None, None, None)
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "SERVICE_AUTHENTICATION_REQUIRED"


def test_non_ascii_internal_key_is_rejected_safely() -> None:
    with pytest.raises(ApplicationError) as raised:
        require_internal_api_key(cast(Request, object()), "é" * 40)
    assert raised.value.code == "SERVICE_AUTHENTICATION_REQUIRED"


def test_generation_rejects_unknown_fields() -> None:
    client = client_with(FakeProvider(output=valid_output()))
    try:
        payload = request_payload()
        payload["ownerId"] = "not-allowed"
        response = client.post(
            "/api/v1/generations",
            json=payload,
            headers={"X-Internal-API-Key": "test-internal-key-that-is-at-least-32-characters"},
        )
    finally:
        client.__exit__(None, None, None)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"


def test_generation_rejects_invalid_provider_output() -> None:
    output = valid_output()
    output.variations[0] = GenerationVariation(angle="technical_depth", content=VALID_CONTENT)
    client = client_with(FakeProvider(output=output))
    try:
        response = client.post(
            "/api/v1/generations",
            json=request_payload(),
            headers={"X-Internal-API-Key": "test-internal-key-that-is-at-least-32-characters"},
        )
    finally:
        client.__exit__(None, None, None)
    assert response.status_code == 502
    assert response.json()["error"]["code"] == "AI_INVALID_RESPONSE"


@pytest.mark.parametrize(
    ("kind", "status_code", "code"),
    [
        ("timeout", 504, "AI_PROVIDER_TIMEOUT"),
        ("rate_limit", 503, "AI_PROVIDER_RATE_LIMITED"),
        ("unavailable", 503, "AI_PROVIDER_UNAVAILABLE"),
        ("provider", 502, "AI_PROVIDER_ERROR"),
        ("refused", 422, "AI_GENERATION_REFUSED"),
        ("invalid_response", 502, "AI_INVALID_RESPONSE"),
    ],
)
def test_generation_provider_errors_map_to_public_contract(
    kind: str, status_code: int, code: str
) -> None:
    client = client_with(FakeProvider(error=ProviderError(kind)))
    try:
        response = client.post(
            "/api/v1/generations",
            json=request_payload(),
            headers={"X-Internal-API-Key": "test-internal-key-that-is-at-least-32-characters"},
        )
    finally:
        client.__exit__(None, None, None)
    assert response.status_code == status_code
    assert response.json()["error"]["code"] == code


class FakeResponses:
    def __init__(self, response: object | None = None, error: Exception | None = None) -> None:
        self.response = response
        self.error = error

    async def parse(self, **_kwargs: object) -> object:
        if self.error:
            raise self.error
        assert self.response is not None
        return self.response


def test_openai_adapter_maps_timeout() -> None:
    request = HttpxRequest("POST", "https://example.test")
    provider = OpenAIProvider(
        FakeResponses(error=APITimeoutError(request)),
        _noop_close,
        "test-model",
    )
    with pytest.raises(ProviderError) as raised:
        asyncio.run(provider.generate(GenerationRequest(**request_payload())))
    assert raised.value.kind == "timeout"


def test_openai_adapter_maps_rate_limit() -> None:
    request = HttpxRequest("POST", "https://example.test")
    response = Response(429, request=request)
    provider = OpenAIProvider(
        FakeResponses(error=RateLimitError("busy", response=response, body=None)),
        _noop_close,
        "test-model",
    )
    with pytest.raises(ProviderError) as raised:
        asyncio.run(provider.generate(GenerationRequest(**request_payload())))
    assert raised.value.kind == "rate_limit"


def test_openai_adapter_preserves_provider_model() -> None:
    response = SimpleNamespace(
        output_parsed=valid_output(),
        output=[],
        model="gpt-5-mini",
    )
    provider = OpenAIProvider(FakeResponses(response=response), _noop_close, "gpt-5.6-luna")
    result = asyncio.run(provider.generate(GenerationRequest(**request_payload())))
    assert result.model == "gpt-5-mini"


@pytest.mark.parametrize(
    "response",
    [
        SimpleNamespace(output_parsed=None, output=[], model="provider-model"),
        SimpleNamespace(output_parsed=None, output=[], status="incomplete", model="provider-model"),
        SimpleNamespace(
            output_parsed=None,
            output=[SimpleNamespace(content=[SimpleNamespace(refusal="no")])],
            model="provider-model",
        ),
    ],
)
def test_openai_adapter_handles_invalid_and_refusal(response: object) -> None:
    provider = OpenAIProvider(FakeResponses(response=response), _noop_close, "test-model")
    with pytest.raises(ProviderError):
        asyncio.run(provider.generate(GenerationRequest(**request_payload())))


async def _noop_close() -> None:
    pass

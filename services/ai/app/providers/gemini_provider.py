from __future__ import annotations

import asyncio
from collections.abc import Sequence
from typing import Protocol, TypeVar

import httpx
from google.genai import types
from google.genai.errors import APIError
from pydantic import BaseModel, ValidationError

from app.prompts import SYSTEM_PROMPT, build_user_prompt
from app.providers.errors import ProviderError
from app.providers.gemini_errors import (
    gemini_api_error_kind,
    gemini_api_error_reason,
    is_http_timeout_exception,
)
from app.providers.text_prompts import (
    DRAFT_REVIEW_SYSTEM_PROMPT,
    RESEARCH_BRIEF_SYSTEM_PROMPT,
    TOPIC_PLANNING_SYSTEM_PROMPT,
)
from app.schemas.common import UsageMetadata
from app.schemas.draft_review import DraftReviewData, DraftReviewRequest
from app.schemas.generation import (
    GenerationRequest,
    ProviderGenerationOutput,
    ProviderGenerationResult,
)
from app.schemas.research_brief import ResearchBriefData, ResearchBriefRequest
from app.schemas.topic_planning import TopicPlanData, TopicPlanRequest

OutputT = TypeVar("OutputT", bound=BaseModel)

_RETRYABLE_HTTP_STATUS_CODES = [408, 429, 500, 502, 503, 504]
_REFUSAL_FINISH_REASONS = {
    "BLOCKLIST",
    "IMAGE_PROHIBITED_CONTENT",
    "IMAGE_RECITATION",
    "IMAGE_SAFETY",
    "JAILBREAK",
    "MODEL_ARMOR",
    "PROHIBITED_CONTENT",
    "RECITATION",
    "SAFETY",
    "SPII",
}


class GeminiAsyncModels(Protocol):
    async def generate_content(
        self,
        *,
        model: str,
        contents: str,
        config: types.GenerateContentConfig,
    ) -> object: ...


class GeminiAsyncClient(Protocol):
    models: GeminiAsyncModels

    async def aclose(self) -> None: ...


class GeminiStructuredClient:
    """Structured Gemini API boundary owning one injected async client."""

    def __init__(
        self,
        client: GeminiAsyncClient,
        model: str,
        timeout_seconds: float = 45,
        retry_attempts: int = 2,
    ) -> None:
        if not model.strip():
            raise ValueError("model must not be blank")
        if timeout_seconds <= 0:
            raise ValueError("timeout_seconds must be positive")
        if not 1 <= retry_attempts <= 3:
            raise ValueError("retry_attempts must be between 1 and 3")
        self._client = client
        self._model = model
        self._timeout_seconds = timeout_seconds
        self._retry_attempts = retry_attempts
        self._closed = False
        self._close_lock = asyncio.Lock()

    async def generate(
        self,
        *,
        system_instruction: str,
        contents: str,
        response_schema: type[OutputT],
    ) -> tuple[OutputT, str, UsageMetadata | None]:
        stage = "request_config"
        try:
            provider_schema = _gemini_response_schema(response_schema)
            config = types.GenerateContentConfig(
                system_instruction=system_instruction,
                response_mime_type="application/json",
                response_json_schema=provider_schema,
                http_options=types.HttpOptions(
                    timeout=int(self._timeout_seconds * 1000),
                    retry_options=types.HttpRetryOptions(
                        attempts=self._retry_attempts,
                        http_status_codes=_RETRYABLE_HTTP_STATUS_CODES,
                    ),
                ),
            )
            stage = "generate_content"
            response = await self._client.models.generate_content(
                model=self._model,
                contents=contents,
                config=config,
            )
        except asyncio.CancelledError:
            raise
        except (httpx.TimeoutException, TimeoutError) as exception:
            raise ProviderError(
                "timeout",
                exception_class=type(exception).__name__,
                stage=stage,
            ) from exception
        except APIError as exception:
            raise ProviderError(
                gemini_api_error_kind(exception),
                exception_class=type(exception).__name__,
                stage=stage,
                upstream_status=exception.code,
                reason=gemini_api_error_reason(exception),
            ) from exception
        except httpx.TransportError as exception:
            raise ProviderError(
                "provider",
                exception_class=type(exception).__name__,
                stage=stage,
            ) from exception
        except Exception as exception:
            kind = "timeout" if is_http_timeout_exception(exception) else "provider"
            raise ProviderError(
                kind,
                exception_class=type(exception).__name__,
                stage=stage,
            ) from exception

        output = _parse_response(response, response_schema)
        actual_model = getattr(response, "model_version", None)
        model = actual_model if isinstance(actual_model, str) and actual_model else self._model
        return output, model, _usage_metadata(getattr(response, "usage_metadata", None), model)

    async def close(self) -> None:
        async with self._close_lock:
            if not self._closed:
                await self._client.aclose()
                self._closed = True


def _gemini_response_schema(response_schema: type[OutputT]) -> dict[str, object]:
    raw_schema = response_schema.model_json_schema()
    definitions = raw_schema.get("$defs", {})
    if not isinstance(definitions, dict):
        raise TypeError("Pydantic schema definitions must be an object")

    def expand(value: object) -> object:
        if isinstance(value, list):
            return [expand(item) for item in value]
        if not isinstance(value, dict):
            return value
        reference = value.get("$ref")
        if isinstance(reference, str):
            prefix = "#/$defs/"
            if not reference.startswith(prefix):
                raise ValueError("unsupported schema reference")
            definition = definitions.get(reference[len(prefix) :])
            if not isinstance(definition, dict):
                raise ValueError("missing schema definition")
            return expand(definition)
        return {
            key: expand(item)
            for key, item in value.items()
            if key not in {"$defs", "$ref", "title", "default"}
        }

    expanded = expand(raw_schema)
    if not isinstance(expanded, dict):
        raise TypeError("Pydantic schema must be an object")
    return expanded


class GeminiGenerationProvider:
    def __init__(self, structured_client: GeminiStructuredClient) -> None:
        self._structured_client = structured_client

    async def generate(self, request: GenerationRequest) -> ProviderGenerationResult:
        output, model, usage = await self._structured_client.generate(
            system_instruction=SYSTEM_PROMPT,
            contents=build_user_prompt(request),
            response_schema=ProviderGenerationOutput,
        )
        return ProviderGenerationResult(output=output, model=model, usage=usage)

    async def close(self) -> None:
        await self._structured_client.close()


class GeminiTopicPlanningProvider:
    def __init__(self, structured_client: GeminiStructuredClient) -> None:
        self._structured_client = structured_client

    async def plan(self, request: TopicPlanRequest) -> TopicPlanData:
        output, _ = await self.plan_with_usage(request)
        return output

    async def plan_with_usage(
        self, request: TopicPlanRequest
    ) -> tuple[TopicPlanData, UsageMetadata | None]:
        output, _, usage = await self._structured_client.generate(
            system_instruction=TOPIC_PLANNING_SYSTEM_PROMPT,
            contents=request.model_dump_json(by_alias=True),
            response_schema=TopicPlanData,
        )
        return output, usage

    async def close(self) -> None:
        await self._structured_client.close()


class GeminiResearchBriefProvider:
    def __init__(self, structured_client: GeminiStructuredClient) -> None:
        self._structured_client = structured_client

    async def research(self, request: ResearchBriefRequest) -> ResearchBriefData:
        output, _ = await self.research_with_usage(request)
        return output

    async def research_with_usage(
        self, request: ResearchBriefRequest
    ) -> tuple[ResearchBriefData, UsageMetadata | None]:
        output, _, usage = await self._structured_client.generate(
            system_instruction=RESEARCH_BRIEF_SYSTEM_PROMPT,
            contents=request.model_dump_json(by_alias=True),
            response_schema=ResearchBriefData,
        )
        return output, usage

    async def close(self) -> None:
        await self._structured_client.close()


class GeminiDraftReviewProvider:
    def __init__(self, structured_client: GeminiStructuredClient) -> None:
        self._structured_client = structured_client

    async def review(self, request: DraftReviewRequest) -> DraftReviewData:
        output, _ = await self.review_with_usage(request)
        return output

    async def review_with_usage(
        self, request: DraftReviewRequest
    ) -> tuple[DraftReviewData, UsageMetadata | None]:
        output, _, usage = await self._structured_client.generate(
            system_instruction=DRAFT_REVIEW_SYSTEM_PROMPT,
            contents=request.model_dump_json(by_alias=True),
            response_schema=DraftReviewData,
        )
        return output, usage

    async def close(self) -> None:
        await self._structured_client.close()


def _parse_response(response: object, response_schema: type[OutputT]) -> OutputT:
    prompt_feedback = getattr(response, "prompt_feedback", None)
    if _enum_name(getattr(prompt_feedback, "block_reason", None)) not in (
        "",
        "BLOCKED_REASON_UNSPECIFIED",
    ):
        raise ProviderError("refused")

    candidates = getattr(response, "candidates", None)
    if not isinstance(candidates, Sequence) or isinstance(candidates, (str, bytes)):
        raise ProviderError("invalid_response", stage="response_shape", reason="missing_candidates")
    for candidate in candidates:
        finish_reason = _enum_name(getattr(candidate, "finish_reason", None))
        if finish_reason in _REFUSAL_FINISH_REASONS:
            raise ProviderError("refused")
        if finish_reason == "MAX_TOKENS":
            raise ProviderError("invalid_response", stage="response_shape", reason="max_tokens")

    if not candidates:
        raise ProviderError("invalid_response", stage="response_shape", reason="empty_candidates")

    parsed = getattr(response, "parsed", None)
    try:
        if isinstance(parsed, response_schema):
            return parsed
        if parsed is not None:
            return response_schema.model_validate(parsed)
        text = getattr(response, "text", None)
        if not isinstance(text, str) or not text.strip():
            raise ProviderError("invalid_response", stage="response_shape", reason="missing_text")
        return response_schema.model_validate_json(text)
    except ProviderError:
        raise
    except (ValidationError, TypeError, ValueError) as exception:
        reason = "response_validation_failed"
        if isinstance(exception, ValidationError):
            first_error = exception.errors(include_url=False)[0]
            location = ".".join(str(item) for item in first_error.get("loc", ()))
            error_type = first_error.get("type")
            if isinstance(error_type, str):
                reason = f"{error_type}@{location or 'root'}"
        raise ProviderError(
            "invalid_response",
            exception_class=type(exception).__name__,
            stage="response_validation",
            reason=reason,
        ) from exception


def _enum_name(value: object) -> str:
    value = getattr(value, "value", value)
    if not isinstance(value, str):
        return ""
    return value.rsplit(".", 1)[-1].upper()


def _usage_metadata(usage: object | None, model: str) -> UsageMetadata | None:
    if usage is None:
        return None
    # Gemini's prompt count already includes any cached tokens; thought tokens
    # are not final output. Neither should be added to the existing usage fields.
    return UsageMetadata(
        model=model,
        inputTokens=_token_count(getattr(usage, "prompt_token_count", None)),
        outputTokens=_token_count(getattr(usage, "candidates_token_count", None)),
    )


def _token_count(value: object) -> int | None:
    if isinstance(value, int) and not isinstance(value, bool) and value >= 0:
        return value
    return None

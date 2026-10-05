import asyncio
from dataclasses import dataclass, field
from types import SimpleNamespace

import httpx
import pytest
from google.genai import types
from google.genai.errors import APIError
from pydantic import BaseModel

from app.errors import ApplicationError
from app.prompts import SYSTEM_PROMPT, build_user_prompt
from app.providers.errors import ProviderError
from app.providers.gemini_provider import (
    GeminiAsyncModels,
    GeminiDraftReviewProvider,
    GeminiGenerationProvider,
    GeminiResearchBriefProvider,
    GeminiStructuredClient,
    GeminiTopicPlanningProvider,
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
    GenerationVariation,
    ProviderGenerationOutput,
)
from app.schemas.research_brief import ResearchBriefData, ResearchBriefRequest
from app.schemas.topic_planning import TopicPlanData, TopicPlanRequest
from app.services.generation_service import generate_posts_with_usage

MODEL = "gemini-3.8-flash"
VALID_CONTENT = (
    "I connected the dashboard form to an authenticated Express API and verified the request "
    "flow. This post describes only the supplied implementation notes and the result I checked."
)


@dataclass
class FakeResponse:
    parsed: object | None
    usage_metadata: object | None = None
    candidates: list[object] = field(
        default_factory=lambda: [SimpleNamespace(finish_reason=types.FinishReason.STOP)]
    )
    prompt_feedback: object | None = None
    model_version: str | None = MODEL
    text: str | None = None


class FakeModels:
    def __init__(self, response: object | None = None, error: BaseException | None = None) -> None:
        self.response = response
        self.error = error
        self.calls: list[dict[str, object]] = []

    async def generate_content(
        self,
        *,
        model: str,
        contents: str,
        config: types.GenerateContentConfig,
    ) -> object:
        self.calls.append({"model": model, "contents": contents, "config": config})
        if self.error is not None:
            raise self.error
        assert self.response is not None
        return self.response


@dataclass
class FakeAsyncClient:
    models: GeminiAsyncModels
    close_calls: int = 0

    async def aclose(self) -> None:
        self.close_calls += 1


def structured_client(
    response: object | None = None,
    error: BaseException | None = None,
    *,
    retry_attempts: int = 2,
) -> tuple[GeminiStructuredClient, FakeModels, FakeAsyncClient]:
    models = FakeModels(response=response, error=error)
    client = FakeAsyncClient(models=models)
    return (
        GeminiStructuredClient(client, MODEL, retry_attempts=retry_attempts),
        models,
        client,
    )


def generation_request(topic: str = "Building an authenticated API flow") -> GenerationRequest:
    return GenerationRequest(
        topic=topic,
        notes="I connected the dashboard form to the API and verified the request flow.",
        primaryAudience="Developers & engineers",
        contentType="Build in public",
        context=[{"chunkId": "chunk-1", "text": "The request uses an authenticated API."}],
    )


def valid_generation_output() -> ProviderGenerationOutput:
    return ProviderGenerationOutput(
        variations=[
            GenerationVariation(
                angle="technical_depth",
                content=VALID_CONTENT,
                citations=["chunk-1"],
            ),
            GenerationVariation(
                angle="learning_story",
                content=(
                    "I learned how much clearer an integration becomes when I verify each "
                    "boundary. I tested the authenticated request flow and kept the behavior "
                    "grounded in that implementation."
                ),
                citations=["chunk-1"],
            ),
            GenerationVariation(
                angle="professional_impact",
                content=(
                    "I completed a dashboard-to-API integration and checked that the request "
                    "flow works with authentication. The change keeps the user interaction "
                    "connected to the existing service boundary."
                ),
                citations=["chunk-1"],
            ),
        ]
    )


def valid_topic_plan() -> TopicPlanData:
    return TopicPlanData(
        model=MODEL,
        suggestions=[
            {
                "id": f"topic-{index}",
                "title": f"Grounded implementation idea {index}",
                "angle": "Explain a verified implementation decision.",
                "relevance": "The selected source documents this work clearly.",
                "talkingPoints": ["Describe the verified implementation."],
                "sourceIds": ["source-1"],
                "missingEvidence": [],
            }
            for index in range(1, 4)
        ],
    )


def valid_research_brief() -> ResearchBriefData:
    return ResearchBriefData(
        model=MODEL,
        noEvidence=False,
        topicSummary="A concise summary of the supplied evidence.",
        talkingPoints=[],
        claimAssessments=[],
        missingInformation=[],
        questions=[],
        limitations=[],
    )


def valid_draft_review() -> DraftReviewData:
    return DraftReviewData(model=MODEL, summary="The draft is grounded.", findings=[])


def test_generation_uses_structured_output_and_validates_three_angles_and_citations() -> None:
    client, models, _ = structured_client(FakeResponse(parsed=valid_generation_output()))
    provider = GeminiGenerationProvider(client)

    result, usage = asyncio.run(generate_posts_with_usage(provider, generation_request()))

    assert [variation.angle for variation in result.variations] == [
        "technical_depth",
        "learning_story",
        "professional_impact",
    ]
    assert all(variation.citations == ["chunk-1"] for variation in result.variations)
    assert result.model == MODEL
    assert usage is None
    call = models.calls[0]
    config = call["config"]
    assert isinstance(config, types.GenerateContentConfig)
    assert config.system_instruction == SYSTEM_PROMPT
    assert config.response_mime_type == "application/json"
    assert config.response_json_schema is not None
    assert "$ref" not in str(config.response_json_schema)
    assert call["contents"] == build_user_prompt(generation_request())


def test_generation_rejects_unknown_citations_through_existing_validation() -> None:
    output = valid_generation_output()
    output.variations[0] = output.variations[0].model_copy(update={"citations": ["unknown"]})
    client, _, _ = structured_client(FakeResponse(parsed=output))

    with pytest.raises(ApplicationError) as raised:
        asyncio.run(
            generate_posts_with_usage(GeminiGenerationProvider(client), generation_request())
        )

    assert raised.value.code == "AI_INVALID_RESPONSE"


def test_topic_planning_uses_its_existing_pydantic_schema_and_system_instruction() -> None:
    client, models, _ = structured_client(FakeResponse(parsed=valid_topic_plan()))
    request = TopicPlanRequest(
        audience="Backend developers",
        contentGoal="Share grounded engineering lessons",
        sources=[
            {
                "sourceId": "source-1",
                "contentVersion": 1,
                "title": "API integration",
                "text": "The dashboard uses an authenticated API.",
            }
        ],
    )

    output, usage = asyncio.run(GeminiTopicPlanningProvider(client).plan_with_usage(request))

    assert output == valid_topic_plan()
    assert usage is None
    call = models.calls[0]
    config = call["config"]
    assert isinstance(config, types.GenerateContentConfig)
    assert config.response_json_schema is not None
    assert "$ref" not in str(config.response_json_schema)
    assert config.system_instruction == TOPIC_PLANNING_SYSTEM_PROMPT
    assert call["contents"] == request.model_dump_json(by_alias=True)


def test_research_brief_uses_its_existing_pydantic_schema_and_system_instruction() -> None:
    client, models, _ = structured_client(FakeResponse(parsed=valid_research_brief()))
    request = ResearchBriefRequest(
        topic="Authenticated API integration",
        notes="I connected the dashboard form to an authenticated API and verified it.",
        evidence=[],
    )

    output, usage = asyncio.run(GeminiResearchBriefProvider(client).research_with_usage(request))

    assert output == valid_research_brief()
    assert usage is None
    config = models.calls[0]["config"]
    assert isinstance(config, types.GenerateContentConfig)
    assert config.response_json_schema is not None
    assert "$ref" not in str(config.response_json_schema)
    assert config.system_instruction == RESEARCH_BRIEF_SYSTEM_PROMPT


def test_draft_review_uses_its_existing_pydantic_schema_and_system_instruction() -> None:
    client, models, _ = structured_client(FakeResponse(parsed=valid_draft_review()))
    request = DraftReviewRequest(draft=VALID_CONTENT, evidence=[])

    output, usage = asyncio.run(GeminiDraftReviewProvider(client).review_with_usage(request))

    assert output == valid_draft_review()
    assert usage is None
    config = models.calls[0]["config"]
    assert isinstance(config, types.GenerateContentConfig)
    assert config.response_json_schema is not None
    assert "$ref" not in str(config.response_json_schema)
    assert config.system_instruction == DRAFT_REVIEW_SYSTEM_PROMPT


@pytest.mark.parametrize(
    ("response", "kind"),
    [
        (FakeResponse(parsed=None, candidates=[]), "invalid_response"),
        (
            FakeResponse(
                parsed=None,
                candidates=[SimpleNamespace(finish_reason=types.FinishReason.MAX_TOKENS)],
            ),
            "invalid_response",
        ),
        (
            FakeResponse(
                parsed=None,
                prompt_feedback=SimpleNamespace(block_reason=types.BlockedReason.SAFETY),
            ),
            "refused",
        ),
        (
            FakeResponse(
                parsed=None,
                candidates=[SimpleNamespace(finish_reason=types.FinishReason.SAFETY)],
            ),
            "refused",
        ),
        (FakeResponse(parsed={"unexpected": True}), "invalid_response"),
        (FakeResponse(parsed=None, text="{not valid json"), "invalid_response"),
    ],
)
def test_malformed_blocked_empty_and_truncated_outputs_are_classified(
    response: FakeResponse, kind: str
) -> None:
    client, _, _ = structured_client(response)

    with pytest.raises(ProviderError) as raised:
        asyncio.run(
            client.generate(
                system_instruction="system instructions",
                contents="user data",
                response_schema=ProviderGenerationOutput,
            )
        )

    assert raised.value.kind == kind


def test_pydantic_response_validation_logs_only_safe_path_and_type() -> None:
    client, _, _ = structured_client(FakeResponse(parsed={"unexpected": True}))

    with pytest.raises(ProviderError) as raised:
        asyncio.run(
            client.generate(
                system_instruction="instructions",
                contents="fictional content",
                response_schema=ProviderGenerationOutput,
            )
        )

    assert raised.value.stage == "response_validation"
    assert raised.value.exception_class == "ValidationError"
    assert raised.value.reason is not None
    assert "variations" in raised.value.reason
    assert "fictional content" not in raised.value.reason


@pytest.mark.parametrize(
    ("status", "kind"),
    [
        (400, "provider"),
        (401, "unavailable"),
        (403, "unavailable"),
        (404, "unavailable"),
        (408, "timeout"),
        (429, "rate_limit"),
        (500, "provider"),
        (504, "timeout"),
    ],
)
def test_gemini_api_errors_map_without_exposing_provider_message(status: int, kind: str) -> None:
    error = APIError(status, {"message": "sensitive provider detail"})
    client, _, _ = structured_client(error=error)

    with pytest.raises(ProviderError) as raised:
        asyncio.run(
            client.generate(
                system_instruction="system instructions",
                contents="user data",
                response_schema=ProviderGenerationOutput,
            )
        )

    assert raised.value.kind == kind
    assert str(raised.value) == kind
    assert raised.value.exception_class == "APIError"
    assert raised.value.stage == "generate_content"
    assert raised.value.upstream_status == status
    assert raised.value.reason in {
        "invalid_request",
        "authentication",
        "permission",
        "not_found",
        "request_timeout",
        "rate_limited",
        "upstream_server_error",
        "gateway_timeout",
    }


@pytest.mark.parametrize(
    ("error", "kind"),
    [
        (httpx.ReadTimeout("transport detail"), "timeout"),
        (httpx.ConnectError("transport detail"), "provider"),
    ],
)
def test_network_failures_map_to_safe_provider_errors(error: Exception, kind: str) -> None:
    client, _, _ = structured_client(error=error)

    with pytest.raises(ProviderError) as raised:
        asyncio.run(
            client.generate(
                system_instruction="system instructions",
                contents="user data",
                response_schema=ProviderGenerationOutput,
            )
        )

    assert raised.value.kind == kind
    assert str(raised.value) == kind


def test_usage_metadata_maps_prompt_and_candidate_tokens_only() -> None:
    response = FakeResponse(
        parsed=valid_generation_output(),
        usage_metadata=SimpleNamespace(
            prompt_token_count=120,
            candidates_token_count=60,
            cached_content_token_count=30,
            thoughts_token_count=45,
            total_token_count=225,
        ),
    )
    client, _, _ = structured_client(response)

    _, model, usage = asyncio.run(
        client.generate(
            system_instruction="system instructions",
            contents="user data",
            response_schema=ProviderGenerationOutput,
        )
    )

    assert model == MODEL
    assert usage is not None
    assert usage.model == MODEL
    assert usage.input_tokens == 120
    assert usage.output_tokens == 60


def test_concurrent_requests_keep_usage_isolated_and_missing_usage_is_none() -> None:
    first_response = FakeResponse(
        parsed=valid_generation_output(),
        usage_metadata=SimpleNamespace(prompt_token_count=11, candidates_token_count=7),
        model_version="model-one",
    )
    second_response = FakeResponse(
        parsed=valid_generation_output(),
        usage_metadata=SimpleNamespace(prompt_token_count=29, candidates_token_count=13),
        model_version="model-two",
    )

    class ConcurrentModels(FakeModels):
        async def generate_content(
            self,
            *,
            model: str,
            contents: str,
            config: types.GenerateContentConfig,
        ) -> object:
            self.calls.append({"model": model, "contents": contents, "config": config})
            await asyncio.sleep(0)
            return first_response if contents == "first" else second_response

    models = ConcurrentModels()
    client = GeminiStructuredClient(FakeAsyncClient(models), MODEL)

    async def run() -> tuple[
        tuple[BaseModel, str, UsageMetadata | None],
        tuple[BaseModel, str, UsageMetadata | None],
    ]:
        return await asyncio.gather(
            client.generate(
                system_instruction="instructions",
                contents="first",
                response_schema=ProviderGenerationOutput,
            ),
            client.generate(
                system_instruction="instructions",
                contents="second",
                response_schema=ProviderGenerationOutput,
            ),
        )

    first, second = asyncio.run(run())
    assert first[1] == "model-one"
    assert second[1] == "model-two"
    assert first[2] is not None and first[2].input_tokens == 11
    assert second[2] is not None and second[2].input_tokens == 29

    no_usage_client, _, _ = structured_client(FakeResponse(parsed=valid_generation_output()))
    _, _, usage = asyncio.run(
        no_usage_client.generate(
            system_instruction="instructions",
            contents="without usage",
            response_schema=ProviderGenerationOutput,
        )
    )
    assert usage is None


def test_sdk_retry_is_explicitly_bounded_and_excludes_auth_and_invalid_input() -> None:
    client, models, _ = structured_client(
        FakeResponse(parsed=valid_generation_output()),
        retry_attempts=2,
    )

    asyncio.run(
        client.generate(
            system_instruction="instructions",
            contents="user data",
            response_schema=ProviderGenerationOutput,
        )
    )

    config = models.calls[0]["config"]
    assert isinstance(config, types.GenerateContentConfig)
    assert config.http_options is not None
    assert config.http_options.timeout == 45_000
    retry_options = config.http_options.retry_options
    assert retry_options is not None
    assert retry_options.attempts == 2
    assert retry_options.http_status_codes == [408, 429, 500, 502, 503, 504]


def test_sdk_httpx2_timeout_is_mapped_to_timeout() -> None:
    class TimeoutException(Exception):
        pass

    class ReadTimeout(TimeoutException):
        pass

    TimeoutException.__module__ = "httpx2"
    ReadTimeout.__module__ = "httpx2"
    client, _, _ = structured_client(error=ReadTimeout("transport detail"))

    with pytest.raises(ProviderError) as raised:
        asyncio.run(
            client.generate(
                system_instruction="instructions",
                contents="user data",
                response_schema=ProviderGenerationOutput,
            )
        )

    assert raised.value.kind == "timeout"


def test_cancellation_is_preserved_and_injected_client_is_closed_once() -> None:
    client, _, raw_client = structured_client(error=asyncio.CancelledError())
    provider = GeminiGenerationProvider(client)

    with pytest.raises(asyncio.CancelledError):
        asyncio.run(provider.generate(generation_request()))

    async def close_all() -> None:
        await asyncio.gather(
            provider.close(),
            GeminiTopicPlanningProvider(client).close(),
            GeminiResearchBriefProvider(client).close(),
            GeminiDraftReviewProvider(client).close(),
        )

    asyncio.run(close_all())
    asyncio.run(provider.close())

    assert raw_client.close_calls == 1

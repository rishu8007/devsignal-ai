import asyncio
import math
from dataclasses import dataclass
from types import SimpleNamespace

import httpx
import pytest
from google.genai import types
from google.genai.errors import APIError

from app.providers.errors import EmbeddingProviderError
from app.providers.gemini_embedding_provider import (
    GEMINI_EMBEDDING_DIMENSIONS,
    GEMINI_EMBEDDING_MODEL,
    GeminiEmbeddingModels,
    GeminiEmbeddingProvider,
)

TEST_MODEL = "gemini-embedding-2-test"
TEST_DIMENSIONS = 3


@dataclass
class FakeEmbedding:
    values: list[float]
    statistics: object | None = None


@dataclass
class FakeResponse:
    embeddings: list[FakeEmbedding] | None


class FakeModels:
    def __init__(
        self,
        response: FakeResponse | None = None,
        error: BaseException | None = None,
    ) -> None:
        self.response = response
        self.error = error
        self.calls: list[dict[str, object]] = []

    async def embed_content(
        self,
        *,
        model: str,
        contents: list[types.Content],
        config: types.EmbedContentConfig,
    ) -> object:
        self.calls.append({"model": model, "contents": contents, "config": config})
        if self.error is not None:
            raise self.error
        assert self.response is not None
        return self.response


class FakeClient:
    def __init__(self, models: GeminiEmbeddingModels) -> None:
        self.models = models
        self.close_calls = 0

    async def aclose(self) -> None:
        self.close_calls += 1


def provider(
    response: FakeResponse | None = None,
    error: BaseException | None = None,
    *,
    dimensions: int = TEST_DIMENSIONS,
) -> tuple[GeminiEmbeddingProvider, FakeModels, FakeClient]:
    models = FakeModels(response=response, error=error)
    client = FakeClient(models)
    return (
        GeminiEmbeddingProvider(
            client,
            model=TEST_MODEL,
            dimensions=dimensions,
        ),
        models,
        client,
    )


def embedding(value: float, token_count: int | None = None) -> FakeEmbedding:
    statistics = SimpleNamespace(token_count=token_count) if token_count is not None else None
    return FakeEmbedding(values=[value] * TEST_DIMENSIONS, statistics=statistics)


@pytest.mark.anyio
async def test_multiple_document_inputs_remain_independent_and_ordered() -> None:
    adapter, models, _ = provider(FakeResponse([embedding(1.0, 3), embedding(2.0, 5)]))
    chunks = ["first chunk text", "second chunk text"]

    vectors, usage = await adapter.embed_with_usage(chunks, purpose="document")

    assert vectors == [[1.0] * TEST_DIMENSIONS, [2.0] * TEST_DIMENSIONS]
    assert usage is not None and usage.embedding_tokens == 8
    call = models.calls[0]
    assert call["model"] == TEST_MODEL
    contents = call["contents"]
    assert isinstance(contents, list) and len(contents) == len(chunks)
    assert all(isinstance(content, types.Content) for content in contents)
    assert [
        content.parts[0].text for content in contents if isinstance(content, types.Content)
    ] == [
        "title: none | text: first chunk text",
        "title: none | text: second chunk text",
    ]
    assert all(
        len(content.parts) == 1 for content in contents if isinstance(content, types.Content)
    )
    config = call["config"]
    assert isinstance(config, types.EmbedContentConfig)
    assert config.output_dimensionality == TEST_DIMENSIONS
    assert config.task_type is None
    assert config.http_options is not None
    assert config.http_options.timeout == 45_000
    assert config.http_options.retry_options is not None
    assert config.http_options.retry_options.attempts == 1
    assert config.http_options.retry_options.http_status_codes == []


@pytest.mark.anyio
async def test_query_uses_gemini_search_query_instruction_without_mutating_input() -> None:
    query = "  how do I authenticate an API request?  "
    adapter, models, _ = provider(FakeResponse([embedding(4.0)]))

    vectors = await adapter.embed([query], purpose="query")

    assert vectors == [[4.0] * TEST_DIMENSIONS]
    content = models.calls[0]["contents"][0]
    assert isinstance(content, types.Content)
    assert content.parts[0].text == f"task: search result | query: {query}"
    assert query == "  how do I authenticate an API request?  "


@pytest.mark.anyio
async def test_default_configuration_targets_gemini_embedding_2_at_1536_dimensions() -> None:
    assert GEMINI_EMBEDDING_MODEL == "gemini-embedding-2"
    assert GEMINI_EMBEDDING_DIMENSIONS == 1536
    models = FakeModels(FakeResponse([FakeEmbedding(values=[0.5] * GEMINI_EMBEDDING_DIMENSIONS)]))
    adapter = GeminiEmbeddingProvider(FakeClient(models))

    vectors = await adapter.embed(["one source chunk"])

    assert len(vectors) == 1
    assert len(vectors[0]) == GEMINI_EMBEDDING_DIMENSIONS
    config = models.calls[0]["config"]
    assert isinstance(config, types.EmbedContentConfig)
    assert config.output_dimensionality == GEMINI_EMBEDDING_DIMENSIONS
    assert models.calls[0]["model"] == GEMINI_EMBEDDING_MODEL


@pytest.mark.anyio
@pytest.mark.parametrize(
    "response",
    [
        FakeResponse(None),
        FakeResponse([]),
        FakeResponse([FakeEmbedding(values=[1.0])]),
        FakeResponse([FakeEmbedding(values=[1.0, 2.0, math.inf])]),
        FakeResponse([FakeEmbedding(values=[1.0, 2.0, math.nan])]),
        FakeResponse([FakeEmbedding(values=[1.0, 2.0, True])]),  # type: ignore[list-item]
        FakeResponse([FakeEmbedding(values=[1.0, 2.0, 10**10_000])]),  # type: ignore[list-item]
    ],
)
async def test_rejects_missing_wrong_count_or_invalid_vectors(response: FakeResponse) -> None:
    adapter, _, _ = provider(response)

    with pytest.raises(EmbeddingProviderError) as raised:
        await adapter.embed(["one"])

    assert raised.value.kind == "invalid_response"


@pytest.mark.anyio
async def test_rejects_invalid_or_oversized_batches_before_provider_call() -> None:
    adapter, models, _ = provider()

    for texts in (
        [],
        ["   "],
        ["x" * 1_001],
        ["x"] * 65,
        ["x" * 1_000] * 33,
    ):
        with pytest.raises(ValueError):
            await adapter.embed(texts)

    assert models.calls == []


@pytest.mark.anyio
@pytest.mark.parametrize(
    ("status", "kind"),
    [
        (400, "provider"),
        (401, "unavailable"),
        (403, "unavailable"),
        (408, "timeout"),
        (429, "rate_limit"),
        (500, "provider"),
        (503, "provider"),
        (504, "timeout"),
    ],
)
async def test_maps_api_failures_without_exposing_details(status: int, kind: str) -> None:
    adapter, _, _ = provider(error=APIError(status, {"message": "private provider detail"}))

    with pytest.raises(EmbeddingProviderError) as raised:
        await adapter.embed(["source content"])

    assert raised.value.kind == kind
    assert str(raised.value) == kind


@pytest.mark.anyio
@pytest.mark.parametrize(
    ("error", "kind"),
    [
        (httpx.ReadTimeout("private timeout detail"), "timeout"),
        (httpx.ConnectError("private connection detail"), "provider"),
    ],
)
async def test_maps_transport_errors_without_exposing_details(
    error: Exception,
    kind: str,
) -> None:
    adapter, _, _ = provider(error=error)

    with pytest.raises(EmbeddingProviderError) as raised:
        await adapter.embed(["source content"])

    assert raised.value.kind == kind
    assert str(raised.value) == kind


@pytest.mark.anyio
async def test_preserves_cancellation_and_does_not_close_borrowed_client() -> None:
    adapter, _, client = provider(error=asyncio.CancelledError())

    with pytest.raises(asyncio.CancelledError):
        await adapter.embed(["source content"])

    assert client.close_calls == 0


@pytest.mark.anyio
async def test_usage_is_request_local_and_missing_statistics_remain_none() -> None:
    class ConcurrentModels(FakeModels):
        async def embed_content(
            self,
            *,
            model: str,
            contents: list[types.Content],
            config: types.EmbedContentConfig,
        ) -> object:
            self.calls.append({"model": model, "contents": contents, "config": config})
            await asyncio.sleep(0)
            first_text = contents[0].parts[0].text
            return FakeResponse(
                [
                    embedding(
                        1.0,
                        7 if first_text == "title: none | text: first" else 13,
                    )
                ]
            )

    models = ConcurrentModels()
    adapter = GeminiEmbeddingProvider(FakeClient(models), TEST_MODEL, TEST_DIMENSIONS)

    first, second = await asyncio.gather(
        adapter.embed_with_usage(["first"]),
        adapter.embed_with_usage(["second"]),
    )

    assert first[1] is not None and first[1].embedding_tokens == 7
    assert second[1] is not None and second[1].embedding_tokens == 13

    missing_usage, _, _ = provider(FakeResponse([embedding(1.0)]))
    _, usage = await missing_usage.embed_with_usage(["without usage"])
    assert usage is None

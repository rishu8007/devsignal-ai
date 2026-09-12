import math
from dataclasses import dataclass

import httpx
import pytest
from openai import APITimeoutError

from app.providers.embedding_provider import (
    EMBEDDING_DIMENSIONS,
    MAX_EMBEDDING_BATCH_CODE_POINTS,
    MAX_EMBEDDING_BATCH_SIZE,
    MAX_EMBEDDING_TEXT_LENGTH,
    EmbeddingProviderError,
    OpenAIEmbeddingProvider,
)


@dataclass
class FakeEmbedding:
    index: int
    embedding: list[float]


@dataclass
class FakeResponse:
    data: list[FakeEmbedding]


class FakeEmbeddingsAPI:
    def __init__(
        self,
        response: FakeResponse | None = None,
        error: Exception | None = None,
    ) -> None:
        self.response = response
        self.error = error
        self.calls: list[dict[str, object]] = []

    async def create(self, **kwargs: object) -> FakeResponse:
        self.calls.append(kwargs)
        if self.error is not None:
            raise self.error
        assert self.response is not None
        return self.response


def vector(value: float) -> list[float]:
    return [value] * EMBEDDING_DIMENSIONS


@pytest.mark.anyio
async def test_returns_vectors_in_input_order_and_passes_configuration() -> None:
    api = FakeEmbeddingsAPI(
        FakeResponse(
            [
                FakeEmbedding(index=1, embedding=vector(2.0)),
                FakeEmbedding(index=0, embedding=vector(1.0)),
            ]
        )
    )
    provider = OpenAIEmbeddingProvider(
        api,
        model="test-embedding",
        dimensions=EMBEDDING_DIMENSIONS,
    )

    result = await provider.embed(["first", "second"])

    assert result[0][0] == 1.0
    assert result[1][0] == 2.0
    assert api.calls == [
        {
            "input": ["first", "second"],
            "model": "test-embedding",
            "dimensions": EMBEDDING_DIMENSIONS,
            "encoding_format": "float",
        }
    ]


@pytest.mark.anyio
@pytest.mark.parametrize(
    "response",
    [
        FakeResponse([FakeEmbedding(index=0, embedding=vector(1.0))]),
        FakeResponse(
            [
                FakeEmbedding(index=0, embedding=vector(1.0)),
                FakeEmbedding(index=0, embedding=vector(2.0)),
            ]
        ),
        FakeResponse(
            [
                FakeEmbedding(index=-1, embedding=vector(1.0)),
                FakeEmbedding(index=1, embedding=vector(2.0)),
            ]
        ),
        FakeResponse(
            [
                FakeEmbedding(index=0, embedding=[1.0]),
                FakeEmbedding(index=1, embedding=vector(2.0)),
            ]
        ),
        FakeResponse(
            [
                FakeEmbedding(
                    index=0,
                    embedding=[math.inf] * EMBEDDING_DIMENSIONS,
                ),
                FakeEmbedding(index=1, embedding=vector(2.0)),
            ]
        ),
        FakeResponse(
            [
                FakeEmbedding(index=0, embedding=vector(1.0)),
                FakeEmbedding(index=2, embedding=vector(2.0)),
            ]
        ),
    ],
)
async def test_rejects_malformed_indexed_responses(response: FakeResponse) -> None:
    provider = OpenAIEmbeddingProvider(
        FakeEmbeddingsAPI(response),
        dimensions=EMBEDDING_DIMENSIONS,
    )

    with pytest.raises(EmbeddingProviderError) as exception:
        await provider.embed(["first", "second"])

    assert exception.value.kind == "invalid_response"


@pytest.mark.anyio
async def test_rejects_empty_blank_and_oversized_inputs_without_provider_call() -> None:
    api = FakeEmbeddingsAPI(FakeResponse([]))
    provider = OpenAIEmbeddingProvider(api, dimensions=EMBEDDING_DIMENSIONS)

    invalid_inputs = [
        [],
        ["   "],
        ["x" * (MAX_EMBEDDING_TEXT_LENGTH + 1)],
        ["x"] * (MAX_EMBEDDING_BATCH_SIZE + 1),
        ["x" * MAX_EMBEDDING_TEXT_LENGTH]
        * (MAX_EMBEDDING_BATCH_CODE_POINTS // MAX_EMBEDDING_TEXT_LENGTH + 1),
    ]
    for texts in invalid_inputs:
        with pytest.raises(ValueError):
            await provider.embed(texts)
    assert api.calls == []


@pytest.mark.anyio
async def test_maps_provider_failures_without_exposing_provider_details() -> None:
    request = httpx.Request("POST", "https://api.openai.com/v1/embeddings")
    provider = OpenAIEmbeddingProvider(
        FakeEmbeddingsAPI(error=APITimeoutError(request=request)),
        dimensions=EMBEDDING_DIMENSIONS,
    )

    with pytest.raises(EmbeddingProviderError) as exception:
        await provider.embed(["safe text"])

    assert exception.value.kind == "timeout"
    assert str(exception.value) == "timeout"

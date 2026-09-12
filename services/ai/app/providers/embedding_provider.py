from __future__ import annotations

import math
from collections.abc import Sequence
from typing import Literal, Protocol

from openai import (
    APIConnectionError,
    APIStatusError,
    APITimeoutError,
    AuthenticationError,
    RateLimitError,
)

EMBEDDING_MODEL = "text-embedding-3-small"
EMBEDDING_DIMENSIONS = 1536
MAX_EMBEDDING_BATCH_SIZE = 64
MAX_EMBEDDING_TEXT_LENGTH = 1_000
MAX_EMBEDDING_BATCH_CODE_POINTS = 32_000


class EmbeddingItem(Protocol):
    index: int
    embedding: Sequence[object]


class EmbeddingResponse(Protocol):
    data: Sequence[EmbeddingItem]


class EmbeddingsAPI(Protocol):
    async def create(
        self,
        *,
        input: list[str],
        model: str,
        dimensions: int,
        encoding_format: Literal["float"],
    ) -> EmbeddingResponse: ...


class EmbeddingProvider(Protocol):
    async def embed(self, texts: Sequence[str]) -> list[list[float]]: ...


class EmbeddingProviderError(Exception):
    def __init__(self, kind: str) -> None:
        self.kind = kind
        super().__init__(kind)


class OpenAIEmbeddingProvider:
    def __init__(
        self,
        embeddings: EmbeddingsAPI,
        model: str = EMBEDDING_MODEL,
        dimensions: int = EMBEDDING_DIMENSIONS,
    ) -> None:
        self._embeddings = embeddings
        self._model = model
        self._dimensions = dimensions

    async def embed(self, texts: Sequence[str]) -> list[list[float]]:
        input_texts = list(texts)
        _validate_input_texts(input_texts)

        try:
            response = await self._embeddings.create(
                input=input_texts,
                model=self._model,
                dimensions=self._dimensions,
                encoding_format="float",
            )
        except APITimeoutError as exception:
            raise EmbeddingProviderError("timeout") from exception
        except RateLimitError as exception:
            raise EmbeddingProviderError("rate_limit") from exception
        except AuthenticationError as exception:
            raise EmbeddingProviderError("unavailable") from exception
        except (APIConnectionError, APIStatusError) as exception:
            raise EmbeddingProviderError("provider") from exception

        return _validate_response(response, len(input_texts), self._dimensions)


def _validate_input_texts(texts: list[str]) -> None:
    if not texts:
        raise ValueError("At least one text is required")
    if len(texts) > MAX_EMBEDDING_BATCH_SIZE:
        raise ValueError("Embedding batch is too large")

    total_code_points = 0
    for text in texts:
        if not isinstance(text, str) or not text.strip():
            raise ValueError("Embedding texts must be nonblank strings")
        if len(text) > MAX_EMBEDDING_TEXT_LENGTH:
            raise ValueError("Embedding text is too large")
        total_code_points += len(text)

    if total_code_points > MAX_EMBEDDING_BATCH_CODE_POINTS:
        raise ValueError("Embedding batch input is too large")


def _validate_response(
    response: EmbeddingResponse,
    expected_count: int,
    expected_dimensions: int,
) -> list[list[float]]:
    data = getattr(response, "data", None)
    if (
        not isinstance(data, Sequence)
        or isinstance(data, (str, bytes))
        or len(data) != expected_count
    ):
        raise EmbeddingProviderError("invalid_response")

    vectors: list[list[float] | None] = [None] * expected_count
    for item in data:
        index = getattr(item, "index", None)
        embedding = getattr(item, "embedding", None)
        if not isinstance(index, int) or isinstance(index, bool):
            raise EmbeddingProviderError("invalid_response")
        if index < 0 or index >= expected_count or vectors[index] is not None:
            raise EmbeddingProviderError("invalid_response")
        vector = _validate_vector(embedding, expected_dimensions)
        vectors[index] = vector

    if any(vector is None for vector in vectors):
        raise EmbeddingProviderError("invalid_response")
    return [vector for vector in vectors if vector is not None]


def _validate_vector(vector: object, expected_dimensions: int) -> list[float]:
    if not isinstance(vector, Sequence) or isinstance(vector, (str, bytes)):
        raise EmbeddingProviderError("invalid_response")
    if len(vector) != expected_dimensions:
        raise EmbeddingProviderError("invalid_response")

    normalized: list[float] = []
    for value in vector:
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise EmbeddingProviderError("invalid_response")
        numeric_value = float(value)
        if not math.isfinite(numeric_value):
            raise EmbeddingProviderError("invalid_response")
        normalized.append(numeric_value)
    return normalized

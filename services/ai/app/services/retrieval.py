from __future__ import annotations

import math
import re
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Protocol

from app.providers.embedding_provider import (
    EMBEDDING_DIMENSIONS,
    EMBEDDING_MODEL,
    MAX_EMBEDDING_TEXT_LENGTH,
    EmbeddingProviderError,
)
from app.repositories.qdrant_repository import (
    ChunkSearchResult,
    QdrantRepositoryError,
)
from app.services.source_indexing import EmbeddingClient, EmbeddingConfiguration

MAX_RETRIEVAL_RESULT_COUNT = 20
OWNER_ID_PATTERN = re.compile(r"^[0-9a-fA-F]{24}$")


class VectorSearcher(Protocol):
    async def search(
        self,
        owner_id: str,
        query_vector: Sequence[float],
        limit: int,
        source_ids: Sequence[str] | None = None,
    ) -> list[ChunkSearchResult]: ...


@dataclass(frozen=True)
class RetrievalCandidate:
    point_id: str
    source_id: str
    content_version: int
    chunker_version: str
    chunk_index: int
    chunk_id: str
    text: str
    start_offset: int
    end_offset: int
    embedding_model: str
    score: float


class RetrievalError(Exception):
    def __init__(self, kind: str) -> None:
        self.kind = kind
        super().__init__(kind)


class RetrievalService:
    def __init__(
        self,
        embedding_provider: EmbeddingClient,
        vector_searcher: VectorSearcher,
        embedding_configuration: EmbeddingConfiguration | None = None,
        max_result_count: int = MAX_RETRIEVAL_RESULT_COUNT,
    ) -> None:
        self._embedding_provider = embedding_provider
        self._vector_searcher = vector_searcher
        self._embedding_configuration = embedding_configuration or EmbeddingConfiguration(
            model=EMBEDDING_MODEL, dimensions=EMBEDDING_DIMENSIONS
        )
        if max_result_count < 1:
            raise ValueError("max_result_count must be positive")
        self._max_result_count = max_result_count

    async def retrieve(
        self,
        owner_id: str,
        query: str,
        limit: int,
        source_ids: Sequence[str] | None = None,
    ) -> list[RetrievalCandidate]:
        normalized_owner_id = _validate_owner_id(owner_id)
        _validate_query(query)
        _validate_limit(limit, self._max_result_count)

        try:
            vectors = await self._embedding_provider.embed([query])
        except EmbeddingProviderError as exception:
            raise RetrievalError(exception.kind) from exception
        except (TypeError, ValueError) as exception:
            raise RetrievalError("invalid_embedding") from exception

        vector = _validate_embedding(vectors, self._embedding_configuration.dimensions)
        try:
            if source_ids is None:
                results = await self._vector_searcher.search(normalized_owner_id, vector, limit)
            else:
                results = await self._vector_searcher.search(
                    normalized_owner_id, vector, limit, source_ids
                )
        except QdrantRepositoryError as exception:
            raise RetrievalError(exception.kind) from exception
        except (TypeError, ValueError) as exception:
            raise RetrievalError("invalid_search") from exception

        return _validate_results(
            results,
            normalized_owner_id,
            self._embedding_configuration,
            limit,
        )


def _validate_owner_id(owner_id: object) -> str:
    if not isinstance(owner_id, str) or OWNER_ID_PATTERN.fullmatch(owner_id) is None:
        raise ValueError("owner_id must be a 24-character hexadecimal ObjectId")
    return owner_id.lower()


def _validate_query(query: object) -> None:
    if not isinstance(query, str) or not query.strip():
        raise ValueError("query must be a nonblank string")
    if len(query) > MAX_EMBEDDING_TEXT_LENGTH:
        raise ValueError("query is too large")


def _validate_limit(limit: object, maximum: int) -> None:
    if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= maximum:
        raise ValueError(f"limit must be between 1 and {maximum}")


def _validate_embedding(
    vectors: object,
    dimensions: int,
) -> list[float]:
    if not isinstance(vectors, Sequence) or isinstance(vectors, (str, bytes)):
        raise RetrievalError("invalid_embedding")
    if len(vectors) != 1:
        raise RetrievalError("invalid_embedding")
    vector = vectors[0]
    if not isinstance(vector, Sequence) or isinstance(vector, (str, bytes)):
        raise RetrievalError("invalid_embedding")
    if len(vector) != dimensions:
        raise RetrievalError("invalid_embedding")
    normalized: list[float] = []
    for value in vector:
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise RetrievalError("invalid_embedding")
        numeric_value = float(value)
        if not math.isfinite(numeric_value):
            raise RetrievalError("invalid_embedding")
        normalized.append(numeric_value)
    return normalized


def _validate_results(
    results: Sequence[ChunkSearchResult],
    owner_id: str,
    configuration: EmbeddingConfiguration,
    limit: int,
) -> list[RetrievalCandidate]:
    if len(results) > limit:
        raise RetrievalError("invalid_response")

    candidates: list[RetrievalCandidate] = []
    for result in results:
        if (
            not isinstance(result.point_id, str)
            or not result.point_id.strip()
            or result.owner_id != owner_id
            or not isinstance(result.source_id, str)
            or not isinstance(result.content_version, int)
            or isinstance(result.content_version, bool)
            or not isinstance(result.chunker_version, str)
            or not isinstance(result.chunk_index, int)
            or isinstance(result.chunk_index, bool)
            or not isinstance(result.chunk_id, str)
            or not isinstance(result.text, str)
            or not isinstance(result.start_offset, int)
            or isinstance(result.start_offset, bool)
            or not isinstance(result.end_offset, int)
            or isinstance(result.end_offset, bool)
            or not isinstance(result.embedding_model, str)
            or isinstance(result.score, bool)
            or not isinstance(result.score, (int, float))
        ):
            raise RetrievalError("invalid_response")
        if result.embedding_model != configuration.model:
            raise RetrievalError("embedding_incompatible")
        if not _valid_object_id(result.source_id):
            raise RetrievalError("invalid_response")
        if result.content_version < 1 or result.chunk_index < 0:
            raise RetrievalError("invalid_response")
        if result.chunker_version.strip() == "" or result.chunk_id.strip() == "":
            raise RetrievalError("invalid_response")
        if result.chunk_id != (
            f"{result.source_id}_v{result.content_version}_c{result.chunk_index}"
        ):
            raise RetrievalError("invalid_response")
        if not result.text.strip():
            raise RetrievalError("invalid_response")
        if (
            result.start_offset < 0
            or result.end_offset <= result.start_offset
            or result.end_offset - result.start_offset != len(result.text)
        ):
            raise RetrievalError("invalid_response")
        if not math.isfinite(result.score):
            raise RetrievalError("invalid_response")
        candidates.append(
            RetrievalCandidate(
                point_id=result.point_id,
                source_id=result.source_id,
                content_version=result.content_version,
                chunker_version=result.chunker_version,
                chunk_index=result.chunk_index,
                chunk_id=result.chunk_id,
                text=result.text,
                start_offset=result.start_offset,
                end_offset=result.end_offset,
                embedding_model=result.embedding_model,
                score=result.score,
            )
        )
    return candidates


def _valid_object_id(value: str) -> bool:
    return OWNER_ID_PATTERN.fullmatch(value) is not None

from dataclasses import dataclass, field

import pytest

from app.providers.embedding_provider import EmbeddingProviderError
from app.repositories.qdrant_repository import ChunkSearchResult, QdrantRepositoryError
from app.services.retrieval import (
    RetrievalError,
    RetrievalService,
)
from app.services.source_indexing import EmbeddingConfiguration

OWNER_ID = "aaaaaaaaaaaaaaaaaaaaaaaa"
SOURCE_ID = "bbbbbbbbbbbbbbbbbbbbbbbb"
CONFIGURATION = EmbeddingConfiguration(
    model="test-embedding",
    dimensions=3,
)


@dataclass
class FakeEmbeddingProvider:
    vectors: list[list[float]] = field(default_factory=lambda: [[0.1, 0.2, 0.3]])
    error: Exception | None = None
    calls: list[list[str]] = field(default_factory=list)

    async def embed(self, texts: list[str]) -> list[list[float]]:
        self.calls.append(texts)
        if self.error is not None:
            raise self.error
        return self.vectors


@dataclass
class FakeVectorSearcher:
    results: list[ChunkSearchResult] = field(default_factory=list)
    error: Exception | None = None
    calls: list[tuple[str, list[float], int]] = field(default_factory=list)

    async def search(
        self,
        owner_id: str,
        query_vector: list[float],
        limit: int,
    ) -> list[ChunkSearchResult]:
        self.calls.append((owner_id, query_vector, limit))
        if self.error is not None:
            raise self.error
        return self.results


def result(
    *,
    owner_id: str = OWNER_ID,
    source_id: str = SOURCE_ID,
    chunk_index: int = 0,
    chunk_id: str | None = None,
    embedding_model: str = "test-embedding",
    score: float = 0.9,
) -> ChunkSearchResult:
    return ChunkSearchResult(
        point_id="point-id",
        owner_id=owner_id,
        source_id=source_id,
        content_version=2,
        chunker_version="text-v1",
        chunk_index=chunk_index,
        chunk_id=chunk_id or f"{source_id}_v2_c{chunk_index}",
        text="chunk",
        start_offset=0,
        end_offset=5,
        embedding_model=embedding_model,
        score=score,
    )


def service(
    provider: FakeEmbeddingProvider,
    searcher: FakeVectorSearcher,
    *,
    max_result_count: int = 5,
) -> RetrievalService:
    return RetrievalService(
        provider,
        searcher,
        CONFIGURATION,
        max_result_count=max_result_count,
    )


@pytest.mark.anyio
async def test_propagates_owner_filter_and_preserves_result_order() -> None:
    searcher = FakeVectorSearcher(results=[result(chunk_index=1), result(chunk_index=0)])
    provider = FakeEmbeddingProvider()

    candidates = await service(provider, searcher).retrieve(OWNER_ID, "find this", 2)

    assert [candidate.chunk_index for candidate in candidates] == [1, 0]
    assert searcher.calls == [(OWNER_ID, [0.1, 0.2, 0.3], 2)]
    assert provider.calls == [["find this"]]
    assert not hasattr(candidates[0], "vector")


@pytest.mark.anyio
async def test_returns_empty_results_without_error() -> None:
    candidates = await service(FakeEmbeddingProvider(), FakeVectorSearcher()).retrieve(
        OWNER_ID, "nothing", 5
    )

    assert candidates == []


@pytest.mark.parametrize(
    ("owner_id", "query", "limit"),
    [
        ("not-an-owner", "query", 5),
        (OWNER_ID, "   ", 5),
        (OWNER_ID, "x" * 1_001, 5),
        (OWNER_ID, "query", 0),
        (OWNER_ID, "query", 6),
    ],
)
@pytest.mark.anyio
async def test_rejects_invalid_input_without_provider_calls(
    owner_id: str,
    query: str,
    limit: int,
) -> None:
    provider = FakeEmbeddingProvider()

    with pytest.raises(ValueError):
        await service(provider, FakeVectorSearcher()).retrieve(owner_id, query, limit)

    assert provider.calls == []


@pytest.mark.anyio
async def test_rejects_malformed_and_incompatible_results() -> None:
    cases = [
        result(owner_id="cccccccccccccccccccccccc"),
        result(embedding_model="other-model"),
        result(chunk_id="wrong"),
        result(score=float("nan")),
        result(source_id="not-an-id"),
    ]
    for malformed in cases:
        with pytest.raises(RetrievalError):
            await service(
                FakeEmbeddingProvider(),
                FakeVectorSearcher(results=[malformed]),
            ).retrieve(OWNER_ID, "query", 5)


@pytest.mark.anyio
async def test_rejects_more_results_than_requested() -> None:
    with pytest.raises(RetrievalError) as exception:
        await service(
            FakeEmbeddingProvider(),
            FakeVectorSearcher(results=[result(), result(chunk_index=1)]),
        ).retrieve(OWNER_ID, "query", 1)

    assert exception.value.kind == "invalid_response"


@pytest.mark.anyio
async def test_maps_embedding_and_search_failures() -> None:
    with pytest.raises(RetrievalError) as embedding_exception:
        await service(
            FakeEmbeddingProvider(error=EmbeddingProviderError("timeout")),
            FakeVectorSearcher(),
        ).retrieve(OWNER_ID, "query", 5)
    assert embedding_exception.value.kind == "timeout"

    with pytest.raises(RetrievalError) as search_exception:
        await service(
            FakeEmbeddingProvider(),
            FakeVectorSearcher(error=QdrantRepositoryError("collection_missing")),
        ).retrieve(OWNER_ID, "query", 5)
    assert search_exception.value.kind == "collection_missing"

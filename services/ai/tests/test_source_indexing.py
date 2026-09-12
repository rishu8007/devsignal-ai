from dataclasses import dataclass, field

import pytest

from app.providers.embedding_provider import EmbeddingProviderError
from app.repositories.qdrant_repository import (
    ChunkVectorRecord,
    QdrantRepositoryError,
    deterministic_point_id,
)
from app.services.source_indexing import (
    EmbeddingConfiguration,
    SourceIndexingError,
    SourceIndexingInput,
    SourceIndexingService,
)

OWNER_ID = "aaaaaaaaaaaaaaaaaaaaaaaa"
SOURCE_ID = "bbbbbbbbbbbbbbbbbbbbbbbb"
CONFIGURATION = EmbeddingConfiguration(
    model="test-embedding",
    dimensions=3,
    max_batch_size=3,
    max_batch_code_points=1_500,
)


@dataclass
class FakeEmbeddingProvider:
    vectors: list[list[float]]
    error: Exception | None = None
    calls: list[list[str]] = field(default_factory=list)

    async def embed(self, texts: list[str]) -> list[list[float]]:
        self.calls.append(texts)
        if self.error is not None:
            raise self.error
        count = len(texts)
        return self.vectors[:count]


@dataclass
class FakeRepository:
    ensure_error: Exception | None = None
    upsert_error: Exception | None = None
    ensure_calls: int = 0
    records: list[ChunkVectorRecord] = field(default_factory=list)

    async def ensure_collection(self) -> None:
        self.ensure_calls += 1
        if self.ensure_error is not None:
            raise self.ensure_error

    async def upsert(self, records: list[ChunkVectorRecord]) -> None:
        if self.upsert_error is not None:
            raise self.upsert_error
        self.records.extend(records)


def source(content: str) -> SourceIndexingInput:
    return SourceIndexingInput(
        ownerId=OWNER_ID,
        sourceId=SOURCE_ID,
        contentVersion=2,
        content=content,
    )


def provider_for(count: int) -> FakeEmbeddingProvider:
    return FakeEmbeddingProvider([[float(index), 0.0, 1.0] for index in range(count)])


@pytest.mark.anyio
async def test_indexes_single_batch_and_returns_metadata_only() -> None:
    provider = provider_for(1)
    repository = FakeRepository()
    result = await SourceIndexingService(provider, repository, CONFIGURATION).index(
        source("A short source note.")
    )

    assert result.source_id == SOURCE_ID
    assert result.content_version == 2
    assert result.embedding_model == "test-embedding"
    assert result.dimensions == 3
    assert result.indexed_chunk_count == 1
    assert len(provider.calls) == 1
    assert len(repository.records) == 1
    assert repository.records[0].owner_id == OWNER_ID
    assert repository.records[0].vector == [0.0, 0.0, 1.0]
    assert not hasattr(result, "vectors")
    assert not hasattr(result, "content")


@pytest.mark.anyio
async def test_splits_batches_by_item_and_aggregate_limits() -> None:
    content = "x" * 1000 + "y" * 1000 + "z" * 1000
    provider = provider_for(4)
    repository = FakeRepository()
    configuration = EmbeddingConfiguration(
        model="test-embedding",
        dimensions=3,
        max_batch_size=10,
        max_batch_code_points=1_500,
    )

    result = await SourceIndexingService(provider, repository, configuration).index(source(content))

    assert result.indexed_chunk_count == 4
    assert [len(batch) for batch in provider.calls] == [1, 1, 2]
    assert all(sum(map(len, batch)) <= 1_500 for batch in provider.calls)
    assert len(repository.records) == 4


@pytest.mark.anyio
async def test_splits_batches_by_item_limit() -> None:
    content = "x" * 1000 + "y" * 1000 + "z" * 1000
    provider = provider_for(4)
    repository = FakeRepository()
    configuration = EmbeddingConfiguration(
        model="test-embedding",
        dimensions=3,
        max_batch_size=2,
        max_batch_code_points=10_000,
    )

    await SourceIndexingService(provider, repository, configuration).index(source(content))

    assert [len(batch) for batch in provider.calls] == [2, 2]


@pytest.mark.anyio
async def test_collection_failure_prevents_embedding_calls() -> None:
    provider = provider_for(1)
    repository = FakeRepository(ensure_error=QdrantRepositoryError("collection_incompatible"))

    with pytest.raises(SourceIndexingError) as exception:
        await SourceIndexingService(provider, repository, CONFIGURATION).index(
            source("A short source note.")
        )

    assert exception.value.kind == "collection_incompatible"
    assert provider.calls == []
    assert repository.records == []


@pytest.mark.anyio
async def test_embedding_failure_prevents_all_vector_writes() -> None:
    provider = FakeEmbeddingProvider([], EmbeddingProviderError("rate_limit"))
    repository = FakeRepository()

    with pytest.raises(SourceIndexingError) as exception:
        await SourceIndexingService(provider, repository, CONFIGURATION).index(
            source("A short source note.")
        )

    assert exception.value.kind == "rate_limit"
    assert repository.records == []


@pytest.mark.anyio
@pytest.mark.parametrize(
    "vectors",
    [
        [],
        [[1.0, 2.0]],
        [[1.0, 2.0, float("nan")]],
    ],
)
async def test_invalid_embedding_results_prevent_writes(vectors: list[list[float]]) -> None:
    provider = FakeEmbeddingProvider(vectors)
    repository = FakeRepository()

    with pytest.raises(SourceIndexingError) as exception:
        await SourceIndexingService(provider, repository, CONFIGURATION).index(
            source("A short source note.")
        )

    assert exception.value.kind == "invalid_embedding"
    assert repository.records == []


@pytest.mark.anyio
async def test_upsert_failure_is_not_reported_as_success() -> None:
    provider = provider_for(1)
    repository = FakeRepository(upsert_error=QdrantRepositoryError("unavailable"))

    with pytest.raises(SourceIndexingError) as exception:
        await SourceIndexingService(provider, repository, CONFIGURATION).index(
            source("A short source note.")
        )

    assert exception.value.kind == "unavailable"


@pytest.mark.anyio
async def test_identical_retries_build_stable_records_and_point_ids() -> None:
    first_provider = provider_for(4)
    first_repository = FakeRepository()
    second_provider = provider_for(4)
    second_repository = FakeRepository()
    service_one = SourceIndexingService(first_provider, first_repository, CONFIGURATION)
    service_two = SourceIndexingService(second_provider, second_repository, CONFIGURATION)
    request = source("x" * 2_000)

    await service_one.index(request)
    await service_two.index(request)

    first = first_repository.records
    second = second_repository.records
    assert [(record.chunk_id, record.vector) for record in first] == [
        (record.chunk_id, record.vector) for record in second
    ]
    assert [deterministic_point_id(record) for record in first] == [
        deterministic_point_id(record) for record in second
    ]


@pytest.mark.anyio
async def test_preserves_offsets_and_owner_source_version_metadata() -> None:
    provider = provider_for(1)
    repository = FakeRepository()

    await SourceIndexingService(provider, repository, CONFIGURATION).index(
        source("Paragraph one.\n\nParagraph two.")
    )

    record = repository.records[0]
    assert record.owner_id == OWNER_ID
    assert record.source_id == SOURCE_ID
    assert record.content_version == 2
    assert record.start_offset == 0
    assert record.end_offset == len(record.text)


@pytest.mark.parametrize(
    "payload",
    [
        {
            "ownerId": "not-an-id",
            "sourceId": SOURCE_ID,
            "contentVersion": 1,
            "content": "valid note",
        },
        {"ownerId": OWNER_ID, "sourceId": SOURCE_ID, "contentVersion": 0, "content": "valid note"},
        {"ownerId": OWNER_ID, "sourceId": SOURCE_ID, "content": "valid note"},
        {
            "ownerId": OWNER_ID,
            "sourceId": SOURCE_ID,
            "contentVersion": 1,
            "content": "valid note",
            "model": "user-controlled",
        },
    ],
)
def test_rejects_invalid_indexing_input(payload: dict[str, object]) -> None:
    with pytest.raises(ValueError):
        SourceIndexingInput.model_validate(payload)

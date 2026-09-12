from dataclasses import dataclass

import pytest
from qdrant_client.http import models
from qdrant_client.http.exceptions import ApiException, UnexpectedResponse

from app.repositories.qdrant_repository import (
    ChunkVectorRecord,
    QdrantRepositoryError,
    QdrantVectorRepository,
    deterministic_point_id,
)

VECTOR_SIZE = 3
OWNER_ID = "aaaaaaaaaaaaaaaaaaaaaaaa"
OTHER_OWNER_ID = "bbbbbbbbbbbbbbbbbbbbbbbb"
SOURCE_ID = "cccccccccccccccccccccccc"


@dataclass
class FakeQdrant:
    collection: models.CollectionInfo | None = None
    get_error: Exception | None = None
    create_error: Exception | None = None
    operation_error: Exception | None = None
    query_response: models.QueryResponse | None = None

    def __post_init__(self) -> None:
        self.created_configs: list[models.VectorParams] = []
        self.upserted: list[list[models.PointStruct]] = []
        self.deleted: list[models.Filter] = []
        self.queries: list[tuple[list[float], models.Filter, int]] = []

    async def get_collection(
        self,
        collection_name: str,
        *,
        timeout: int | None = None,
    ) -> models.CollectionInfo:
        del collection_name, timeout
        if self.get_error is not None:
            error = self.get_error
            self.get_error = None
            raise error
        assert self.collection is not None
        return self.collection

    async def create_collection(
        self,
        collection_name: str,
        *,
        vectors_config: models.VectorParams,
        timeout: int | None = None,
    ) -> bool:
        del collection_name, timeout
        if self.create_error is not None:
            raise self.create_error
        self.created_configs.append(vectors_config)
        self.collection = compatible_collection(vectors_config.size, vectors_config.distance)
        return True

    async def upsert(
        self,
        collection_name: str,
        *,
        points: list[models.PointStruct],
        wait: bool = True,
        timeout: int | None = None,
    ) -> models.UpdateResult:
        del collection_name, wait, timeout
        if self.operation_error is not None:
            raise self.operation_error
        self.upserted.append(points)
        return models.UpdateResult.model_construct(status=models.UpdateStatus.COMPLETED)

    async def delete(
        self,
        collection_name: str,
        *,
        points_selector: models.Filter,
        wait: bool = True,
        timeout: int | None = None,
    ) -> models.UpdateResult:
        del collection_name, wait, timeout
        if self.operation_error is not None:
            raise self.operation_error
        self.deleted.append(points_selector)
        return models.UpdateResult.model_construct(status=models.UpdateStatus.COMPLETED)

    async def query_points(
        self,
        collection_name: str,
        query: list[float],
        *,
        query_filter: models.Filter,
        limit: int,
        with_payload: bool,
        with_vectors: bool,
        timeout: int | None = None,
    ) -> models.QueryResponse:
        del collection_name, with_payload, with_vectors, timeout
        if self.operation_error is not None:
            raise self.operation_error
        self.queries.append((query, query_filter, limit))
        if self.query_response is not None:
            return self.query_response
        return models.QueryResponse.model_construct(points=[])


def compatible_collection(size: int, distance: models.Distance) -> models.CollectionInfo:
    params = models.CollectionParams.model_construct(
        vectors=models.VectorParams(size=size, distance=distance)
    )
    config = models.CollectionConfig.model_construct(params=params)
    return models.CollectionInfo.model_construct(config=config)


def repository(client: FakeQdrant, size: int = VECTOR_SIZE) -> QdrantVectorRepository:
    return QdrantVectorRepository(client, "test_collection", size, 5)


def record(
    *,
    owner_id: str = OWNER_ID,
    source_id: str = SOURCE_ID,
    chunk_index: int = 0,
    vector: list[float] | None = None,
) -> ChunkVectorRecord:
    return ChunkVectorRecord(
        owner_id=owner_id,
        source_id=source_id,
        content_version=2,
        chunker_version="text-v1",
        chunk_index=chunk_index,
        chunk_id=f"{source_id}_v2_c{chunk_index}",
        text="chunk",
        start_offset=0,
        end_offset=5,
        embedding_model="text-embedding-3-small",
        vector=vector or [0.1, 0.2, 0.3],
    )


def not_found() -> UnexpectedResponse:
    import httpx

    return UnexpectedResponse(404, "Not Found", b"", httpx.Headers())


def conflict() -> UnexpectedResponse:
    import httpx

    return UnexpectedResponse(409, "Conflict", b"", httpx.Headers())


@pytest.mark.anyio
async def test_initializes_new_collection_with_cosine_and_dimensions() -> None:
    client = FakeQdrant(get_error=not_found())

    await repository(client).ensure_collection()

    assert len(client.created_configs) == 1
    assert client.created_configs[0].size == VECTOR_SIZE
    assert client.created_configs[0].distance == models.Distance.COSINE


@pytest.mark.anyio
@pytest.mark.parametrize(
    ("size", "distance"),
    [(2, models.Distance.COSINE), (VECTOR_SIZE, models.Distance.DOT)],
)
async def test_rejects_incompatible_existing_collection(
    size: int, distance: models.Distance
) -> None:
    client = FakeQdrant(collection=compatible_collection(size, distance))

    with pytest.raises(QdrantRepositoryError) as exception:
        await repository(client).ensure_collection()

    assert exception.value.kind == "collection_incompatible"


@pytest.mark.anyio
async def test_re_reads_and_validates_after_concurrent_collection_creation() -> None:
    client = FakeQdrant(get_error=not_found(), create_error=conflict())
    client.collection = compatible_collection(VECTOR_SIZE, models.Distance.COSINE)

    await repository(client).ensure_collection()

    assert client.created_configs == []


def test_point_id_is_deterministic_and_identity_scoped() -> None:
    first = deterministic_point_id(record())
    repeated = deterministic_point_id(record())

    assert first == repeated
    assert first != deterministic_point_id(record(chunk_index=1))
    assert first != deterministic_point_id(record(owner_id=OTHER_OWNER_ID))
    assert first != deterministic_point_id(record(source_id="dddddddddddddddddddddddd"))


@pytest.mark.anyio
async def test_validates_records_before_bounded_upserts() -> None:
    client = FakeQdrant()
    records = [record(chunk_index=index) for index in range(65)]

    await repository(client).upsert(records)

    assert [len(batch) for batch in client.upserted] == [64, 1]
    assert client.upserted[0][0].payload is not None
    assert client.upserted[0][0].payload["chunkId"] == records[0].chunk_id
    assert client.upserted[0][0].id == deterministic_point_id(records[0])

    with pytest.raises(ValueError):
        await repository(client).upsert([record(vector=[0.1, 0.2])])
    assert [len(batch) for batch in client.upserted] == [64, 1]


@pytest.mark.anyio
@pytest.mark.parametrize(
    "bad_vector",
    [[0.1, 0.2], [0.1, float("nan"), 0.3], [0.1, float("inf"), 0.3]],
)
async def test_rejects_invalid_vectors(bad_vector: list[float]) -> None:
    with pytest.raises(ValueError):
        await repository(FakeQdrant()).upsert([record(vector=bad_vector)])


@pytest.mark.anyio
async def test_delete_requires_owner_and_source_filters() -> None:
    client = FakeQdrant()

    await repository(client).delete_source(OWNER_ID, SOURCE_ID)

    assert len(client.deleted) == 1
    conditions = client.deleted[0].must
    assert conditions is not None
    assert {
        condition.key for condition in conditions if isinstance(condition, models.FieldCondition)
    } == {
        "ownerId",
        "sourceId",
    }


@pytest.mark.anyio
async def test_search_requires_owner_filter_and_validates_typed_results() -> None:
    client = FakeQdrant()
    client.query_response = valid_query_response()

    results = await repository(client).search(OWNER_ID, [0.1, 0.2, 0.3], 5)

    assert len(results) == 1
    assert results[0].owner_id == OWNER_ID
    assert results[0].score == 0.9
    assert client.queries[0][1].must is not None
    condition = client.queries[0][1].must[0]
    assert isinstance(condition, models.FieldCondition)
    assert condition.key == "ownerId"
    assert condition.match == models.MatchValue(value=OWNER_ID)


def valid_query_response() -> models.QueryResponse:
    return models.QueryResponse.model_construct(
        points=[
            models.ScoredPoint.model_construct(
                id="point-id",
                score=0.9,
                payload={
                    "ownerId": OWNER_ID,
                    "sourceId": SOURCE_ID,
                    "contentVersion": 2,
                    "chunkerVersion": "text-v1",
                    "chunkIndex": 0,
                    "chunkId": f"{SOURCE_ID}_v2_c0",
                    "text": "chunk",
                    "startOffset": 0,
                    "endOffset": 5,
                    "embeddingModel": "text-embedding-3-small",
                },
            )
        ]
    )


@pytest.mark.anyio
async def test_maps_qdrant_failures_without_exposing_raw_errors() -> None:
    client = FakeQdrant(operation_error=ApiException("private transport detail"))

    with pytest.raises(QdrantRepositoryError) as exception:
        await repository(client).upsert([record()])

    assert exception.value.kind == "unavailable"
    assert str(exception.value) == "unavailable"


@pytest.mark.anyio
async def test_rejects_malformed_search_payload() -> None:
    client = FakeQdrant()
    client.query_response = models.QueryResponse.model_construct(
        points=[
            models.ScoredPoint.model_construct(
                id="point-id",
                score=0.9,
                payload={"ownerId": OWNER_ID},
            )
        ]
    )

    with pytest.raises(QdrantRepositoryError) as exception:
        await repository(client).search(OWNER_ID, [0.1, 0.2, 0.3], 5)

    assert exception.value.kind == "invalid_response"

from __future__ import annotations

import math
import re
import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Protocol

from qdrant_client.http import models
from qdrant_client.http.exceptions import ApiException, UnexpectedResponse

POINT_ID_NAMESPACE = uuid.uuid5(
    uuid.NAMESPACE_URL,
    "https://devsignal.ai/qdrant/knowledge-chunk",
)
MAX_UPSERT_BATCH_SIZE = 64
OWNER_ID_PATTERN = re.compile(r"^[0-9a-fA-F]{24}$")


class QdrantAPI(Protocol):
    async def get_collection(
        self,
        collection_name: str,
    ) -> models.CollectionInfo: ...

    async def create_collection(
        self,
        collection_name: str,
        *,
        vectors_config: models.VectorParams,
        timeout: int | None = None,
    ) -> bool: ...

    async def upsert(
        self,
        collection_name: str,
        *,
        points: Sequence[models.PointStruct],
        wait: bool = True,
        timeout: int | None = None,
    ) -> models.UpdateResult: ...

    async def delete(
        self,
        collection_name: str,
        *,
        points_selector: models.Filter,
        wait: bool = True,
        timeout: int | None = None,
    ) -> models.UpdateResult: ...

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
    ) -> models.QueryResponse: ...


@dataclass(frozen=True)
class ChunkVectorRecord:
    owner_id: str
    source_id: str
    content_version: int
    chunker_version: str
    chunk_index: int
    chunk_id: str
    text: str
    start_offset: int
    end_offset: int
    embedding_model: str
    vector: Sequence[float]


@dataclass(frozen=True)
class ChunkSearchResult:
    point_id: str
    owner_id: str
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


class QdrantRepositoryError(Exception):
    def __init__(self, kind: str) -> None:
        self.kind = kind
        super().__init__(kind)


class QdrantVectorRepository:
    def __init__(
        self,
        client: QdrantAPI,
        collection_name: str,
        vector_size: int,
        timeout_seconds: int,
    ) -> None:
        self._client = client
        self._collection_name = collection_name
        self._vector_size = vector_size
        self._timeout_seconds = timeout_seconds

    async def ensure_collection(self) -> None:
        try:
            collection = await self._client.get_collection(
                self._collection_name,
            )
        except UnexpectedResponse as exception:
            if exception.status_code != 404:
                raise QdrantRepositoryError("unavailable") from exception
            try:
                await self._client.create_collection(
                    self._collection_name,
                    vectors_config=models.VectorParams(
                        size=self._vector_size,
                        distance=models.Distance.COSINE,
                    ),
                    timeout=self._timeout_seconds,
                )
            except UnexpectedResponse as create_exception:
                if create_exception.status_code != 409:
                    raise QdrantRepositoryError("unavailable") from create_exception
                collection = await self._read_collection_after_concurrent_create()
            except ApiException as create_exception:
                raise QdrantRepositoryError("unavailable") from create_exception
            else:
                return
        except ApiException as exception:
            raise QdrantRepositoryError("unavailable") from exception

        _validate_collection_compatibility(collection, self._vector_size)

    async def upsert(self, records: Sequence[ChunkVectorRecord]) -> None:
        if not records:
            raise ValueError("At least one chunk vector record is required")
        validated_records = [_validate_record(record, self._vector_size) for record in records]
        for start in range(0, len(validated_records), MAX_UPSERT_BATCH_SIZE):
            batch = validated_records[start : start + MAX_UPSERT_BATCH_SIZE]
            points = [
                models.PointStruct(
                    id=deterministic_point_id(record),
                    vector=list(record.vector),
                    payload=_record_payload(record),
                )
                for record in batch
            ]
            try:
                await self._client.upsert(
                    self._collection_name,
                    points=points,
                    wait=True,
                    timeout=self._timeout_seconds,
                )
            except ApiException as exception:
                raise QdrantRepositoryError("unavailable") from exception

    async def delete_source(self, owner_id: str, source_id: str) -> None:
        normalized_owner_id = _validate_object_id(owner_id, "owner_id")
        normalized_source_id = _validate_object_id(source_id, "source_id")
        selector = models.Filter(
            must=[
                _match_condition("ownerId", normalized_owner_id),
                _match_condition("sourceId", normalized_source_id),
            ]
        )
        try:
            await self._client.delete(
                self._collection_name,
                points_selector=selector,
                wait=True,
                timeout=self._timeout_seconds,
            )
        except ApiException as exception:
            raise QdrantRepositoryError("unavailable") from exception

    async def search(
        self,
        owner_id: str,
        query_vector: Sequence[float],
        limit: int,
    ) -> list[ChunkSearchResult]:
        normalized_owner_id = _validate_object_id(owner_id, "owner_id")
        vector = _validate_vector(query_vector, self._vector_size)
        if limit < 1:
            raise ValueError("limit must be positive")
        selector = models.Filter(must=[_match_condition("ownerId", normalized_owner_id)])
        try:
            response = await self._client.query_points(
                self._collection_name,
                query=vector,
                query_filter=selector,
                limit=limit,
                with_payload=True,
                with_vectors=False,
                timeout=self._timeout_seconds,
            )
        except ApiException as exception:
            raise QdrantRepositoryError("unavailable") from exception
        return _parse_search_response(response)

    async def _read_collection_after_concurrent_create(self) -> models.CollectionInfo:
        try:
            return await self._client.get_collection(
                self._collection_name,
            )
        except ApiException as exception:
            raise QdrantRepositoryError("unavailable") from exception


def deterministic_point_id(record: ChunkVectorRecord) -> str:
    normalized_owner_id = _validate_object_id(record.owner_id, "owner_id")
    normalized_source_id = _validate_object_id(record.source_id, "source_id")
    if record.content_version < 1:
        raise ValueError("content_version must be positive")
    if record.chunk_index < 0:
        raise ValueError("chunk_index must not be negative")
    identity = ":".join(
        (
            normalized_owner_id,
            normalized_source_id,
            str(record.content_version),
            record.chunker_version,
            str(record.chunk_index),
        )
    )
    return str(uuid.uuid5(POINT_ID_NAMESPACE, identity))


def _validate_record(record: ChunkVectorRecord, vector_size: int) -> ChunkVectorRecord:
    owner_id = _validate_object_id(record.owner_id, "owner_id")
    source_id = _validate_object_id(record.source_id, "source_id")
    if record.content_version < 1:
        raise ValueError("content_version must be positive")
    if record.chunk_index < 0:
        raise ValueError("chunk_index must not be negative")
    if not record.chunker_version.strip() or not record.embedding_model.strip():
        raise ValueError("chunker_version and embedding_model must not be blank")
    if not record.chunk_id.strip() or not record.text.strip():
        raise ValueError("chunk_id and text must not be blank")
    expected_chunk_id = f"{source_id}_v{record.content_version}_c{record.chunk_index}"
    if record.chunk_id != expected_chunk_id:
        raise ValueError("chunk_id does not match source and chunk metadata")
    if record.start_offset < 0 or record.end_offset <= record.start_offset:
        raise ValueError("chunk offsets are invalid")
    if record.end_offset - record.start_offset != len(record.text):
        raise ValueError("chunk offsets do not match text length")
    vector = _validate_vector(record.vector, vector_size)
    return ChunkVectorRecord(
        owner_id=owner_id,
        source_id=source_id,
        content_version=record.content_version,
        chunker_version=record.chunker_version,
        chunk_index=record.chunk_index,
        chunk_id=record.chunk_id,
        text=record.text,
        start_offset=record.start_offset,
        end_offset=record.end_offset,
        embedding_model=record.embedding_model,
        vector=vector,
    )


def _validate_object_id(value: object, field_name: str) -> str:
    if not isinstance(value, str) or OWNER_ID_PATTERN.fullmatch(value) is None:
        raise ValueError(f"{field_name} must be a 24-character hexadecimal ObjectId")
    return value.lower()


def _validate_vector(vector: object, vector_size: int) -> list[float]:
    if not isinstance(vector, Sequence) or isinstance(vector, (str, bytes)):
        raise ValueError("vector must be a sequence of numbers")
    if len(vector) != vector_size:
        raise ValueError("vector dimensions do not match the configured collection")
    normalized: list[float] = []
    for value in vector:
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise ValueError("vector values must be finite numbers")
        numeric_value = float(value)
        if not math.isfinite(numeric_value):
            raise ValueError("vector values must be finite numbers")
        normalized.append(numeric_value)
    return normalized


def _record_payload(record: ChunkVectorRecord) -> dict[str, object]:
    return {
        "ownerId": record.owner_id,
        "sourceId": record.source_id,
        "contentVersion": record.content_version,
        "chunkerVersion": record.chunker_version,
        "chunkIndex": record.chunk_index,
        "chunkId": record.chunk_id,
        "text": record.text,
        "startOffset": record.start_offset,
        "endOffset": record.end_offset,
        "embeddingModel": record.embedding_model,
    }


def _match_condition(key: str, value: str) -> models.FieldCondition:
    return models.FieldCondition(key=key, match=models.MatchValue(value=value))


def _validate_collection_compatibility(
    collection: models.CollectionInfo,
    vector_size: int,
) -> None:
    vectors = collection.config.params.vectors
    if not isinstance(vectors, models.VectorParams):
        raise QdrantRepositoryError("collection_incompatible")
    if vectors.size != vector_size or vectors.distance != models.Distance.COSINE:
        raise QdrantRepositoryError("collection_incompatible")


def _parse_search_response(response: models.QueryResponse) -> list[ChunkSearchResult]:
    points = getattr(response, "points", None)
    if not isinstance(points, Sequence):
        raise QdrantRepositoryError("invalid_response")
    results: list[ChunkSearchResult] = []
    for point in points:
        result = _parse_search_point(point)
        results.append(result)
    return results


def _parse_search_point(point: object) -> ChunkSearchResult:
    point_id = getattr(point, "id", None)
    score = getattr(point, "score", None)
    payload = getattr(point, "payload", None)
    if not isinstance(point_id, (str, int, uuid.UUID)):
        raise QdrantRepositoryError("invalid_response")
    if isinstance(score, bool) or not isinstance(score, (int, float)) or not math.isfinite(score):
        raise QdrantRepositoryError("invalid_response")
    if not isinstance(payload, dict):
        raise QdrantRepositoryError("invalid_response")

    return ChunkSearchResult(
        point_id=str(point_id),
        owner_id=_payload_string(payload, "ownerId"),
        source_id=_payload_string(payload, "sourceId"),
        content_version=_payload_positive_int(payload, "contentVersion"),
        chunker_version=_payload_string(payload, "chunkerVersion"),
        chunk_index=_payload_nonnegative_int(payload, "chunkIndex"),
        chunk_id=_payload_string(payload, "chunkId"),
        text=_payload_string(payload, "text"),
        start_offset=_payload_nonnegative_int(payload, "startOffset"),
        end_offset=_payload_positive_int(payload, "endOffset"),
        embedding_model=_payload_string(payload, "embeddingModel"),
        score=float(score),
    )


def _payload_string(payload: dict[str, object], key: str) -> str:
    value = payload.get(key)
    if not isinstance(value, str) or not value.strip():
        raise QdrantRepositoryError("invalid_response")
    return value


def _payload_positive_int(payload: dict[str, object], key: str) -> int:
    value = payload.get(key)
    if not isinstance(value, int) or isinstance(value, bool) or value < 1:
        raise QdrantRepositoryError("invalid_response")
    return value


def _payload_nonnegative_int(payload: dict[str, object], key: str) -> int:
    value = payload.get(key)
    if not isinstance(value, int) or isinstance(value, bool) or value < 0:
        raise QdrantRepositoryError("invalid_response")
    return value

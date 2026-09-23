from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Protocol

from pydantic import BaseModel, ConfigDict, Field, StrictInt, StrictStr, field_validator

from app.providers.embedding_provider import (
    EMBEDDING_DIMENSIONS,
    EMBEDDING_MODEL,
    MAX_EMBEDDING_BATCH_CODE_POINTS,
    MAX_EMBEDDING_BATCH_SIZE,
    EmbeddingProviderError,
)
from app.repositories.qdrant_repository import (
    ChunkVectorRecord,
    QdrantRepositoryError,
)
from app.schemas.common import UsageMetadata
from app.services.chunking import ChunkingInput, TextChunk, chunk_text


class SourceIndexingInput(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    owner_id: StrictStr = Field(alias="ownerId")
    source_id: StrictStr = Field(alias="sourceId")
    content_version: StrictInt = Field(alias="contentVersion")
    content: StrictStr

    @field_validator("owner_id", "source_id")
    @classmethod
    def validate_object_id(cls, value: str) -> str:
        try:
            return ChunkingInput(
                sourceId=value,
                contentVersion=1,
                content="placeholder",
            ).source_id
        except ValueError as exception:
            raise ValueError(
                "ownerId and sourceId must be 24-character hexadecimal IDs"
            ) from exception

    @field_validator("content_version")
    @classmethod
    def validate_content_version(cls, value: int) -> int:
        if value < 1:
            raise ValueError("contentVersion must be a positive integer")
        return value

    @field_validator("content")
    @classmethod
    def validate_content(cls, value: str) -> str:
        validated = ChunkingInput(
            sourceId="000000000000000000000000",
            contentVersion=1,
            content=value,
        )
        return validated.content


@dataclass(frozen=True)
class EmbeddingConfiguration:
    model: str = EMBEDDING_MODEL
    dimensions: int = EMBEDDING_DIMENSIONS
    max_batch_size: int = MAX_EMBEDDING_BATCH_SIZE
    max_batch_code_points: int = MAX_EMBEDDING_BATCH_CODE_POINTS

    def __post_init__(self) -> None:
        if not self.model.strip():
            raise ValueError("embedding model must not be blank")
        if self.dimensions < 1:
            raise ValueError("embedding dimensions must be positive")
        if self.max_batch_size < 1:
            raise ValueError("embedding batch size must be positive")
        if self.max_batch_code_points < 1:
            raise ValueError("embedding batch input limit must be positive")


class EmbeddingClient(Protocol):
    async def embed(self, texts: Sequence[str]) -> list[list[float]]: ...


class VectorWriter(Protocol):
    async def ensure_collection(self) -> None: ...

    async def upsert(self, records: Sequence[ChunkVectorRecord]) -> None: ...


@dataclass(frozen=True)
class SourceIndexingResult:
    source_id: str
    content_version: int
    chunker_version: str
    embedding_model: str
    dimensions: int
    indexed_chunk_count: int
    usage: list[UsageMetadata] = field(default_factory=list)


class SourceIndexingError(Exception):
    def __init__(self, kind: str) -> None:
        self.kind = kind
        super().__init__(kind)


class SourceIndexingService:
    def __init__(
        self,
        embedding_provider: EmbeddingClient,
        vector_repository: VectorWriter,
        embedding_configuration: EmbeddingConfiguration,
    ) -> None:
        self._embedding_provider = embedding_provider
        self._vector_repository = vector_repository
        self._embedding_configuration = embedding_configuration

    async def index(self, source: SourceIndexingInput) -> SourceIndexingResult:
        import time

        correlation_id = source.source_id[:8]
        start_time = time.time()
        logger = __import__("logging").getLogger("devsignal-ai-service")

        logger.info(f"[indexing] {correlation_id} service-start")

        try:
            chunks = _chunk_source(source)
            logger.info(f"[indexing] {correlation_id} chunking-success count={len(chunks)}")
        except SourceIndexingError as e:
            elapsed_ms = int((time.time() - start_time) * 1000)
            logger.info(
                f"[indexing] {correlation_id} chunking-failed kind={e.kind} elapsed={elapsed_ms}ms"
            )
            raise

        try:
            logger.info(f"[indexing] {correlation_id} collection-init-start")
            await self._vector_repository.ensure_collection()
            logger.info(f"[indexing] {correlation_id} collection-init-success")
        except QdrantRepositoryError as exception:
            elapsed_ms = int((time.time() - start_time) * 1000)
            logger.info(
                f"[indexing] {correlation_id} collection-init-failed "
                f"kind={exception.kind} elapsed={elapsed_ms}ms"
            )
            raise SourceIndexingError(exception.kind) from exception

        vectors: list[list[float]] = []
        usage: list[UsageMetadata] = []
        total_batches = 0
        for batch in _batches(chunks, self._embedding_configuration):
            total_batches += 1
            try:
                logger.info(
                    f"[indexing] {correlation_id} embedding-start "
                    f"batch={total_batches} size={len(batch)}"
                )
                if hasattr(self._embedding_provider, "embed_with_usage"):
                    batch_vectors, provider_usage = await self._embedding_provider.embed_with_usage(
                        [chunk.text for chunk in batch]
                    )
                else:
                    batch_vectors = await self._embedding_provider.embed(
                        [chunk.text for chunk in batch]
                    )
                    provider_usage = None
                if provider_usage is not None:
                    usage.append(provider_usage)
                logger.info(
                    f"[indexing] {correlation_id} embedding-success "
                    f"batch={total_batches} count={len(batch_vectors)}"
                )
            except EmbeddingProviderError as exception:
                elapsed_ms = int((time.time() - start_time) * 1000)
                logger.info(
                    f"[indexing] {correlation_id} embedding-failed "
                    f"kind={exception.kind} elapsed={elapsed_ms}ms"
                )
                raise SourceIndexingError(exception.kind) from exception
            except (ValueError, TypeError) as exception:
                elapsed_ms = int((time.time() - start_time) * 1000)
                logger.info(f"[indexing] {correlation_id} embedding-error elapsed={elapsed_ms}ms")
                raise SourceIndexingError("invalid_embedding") from exception
            _validate_batch_vectors(
                batch_vectors,
                len(batch),
                self._embedding_configuration.dimensions,
            )
            vectors.extend(batch_vectors)

        records = [
            _build_record(
                source.owner_id,
                chunk,
                vector,
                self._embedding_configuration,
            )
            for chunk, vector in zip(chunks, vectors, strict=True)
        ]
        try:
            logger.info(f"[indexing] {correlation_id} upsert-start count={len(records)}")
            await self._vector_repository.upsert(records)
            elapsed_ms = int((time.time() - start_time) * 1000)
            logger.info(
                f"[indexing] {correlation_id} upsert-success "
                f"count={len(records)} elapsed={elapsed_ms}ms"
            )
        except QdrantRepositoryError as exception:
            elapsed_ms = int((time.time() - start_time) * 1000)
            logger.info(
                f"[indexing] {correlation_id} upsert-failed kind={exception.kind} "
                f"elapsed={elapsed_ms}ms"
            )
            raise SourceIndexingError(exception.kind) from exception

        return SourceIndexingResult(
            source_id=source.source_id,
            content_version=source.content_version,
            chunker_version=chunks[0].chunker_version,
            embedding_model=self._embedding_configuration.model,
            dimensions=self._embedding_configuration.dimensions,
            indexed_chunk_count=len(chunks),
            usage=usage,
        )


def _chunk_source(source: SourceIndexingInput) -> list[TextChunk]:
    chunks = chunk_text(
        ChunkingInput(
            sourceId=source.source_id,
            contentVersion=source.content_version,
            content=source.content,
        )
    )
    if not chunks:
        raise SourceIndexingError("invalid_content")
    return chunks


def _batches(
    chunks: Sequence[TextChunk],
    configuration: EmbeddingConfiguration,
) -> list[list[TextChunk]]:
    batches: list[list[TextChunk]] = []
    current: list[TextChunk] = []
    current_size = 0
    for chunk in chunks:
        chunk_size = len(chunk.text)
        if current and (
            len(current) >= configuration.max_batch_size
            or current_size + chunk_size > configuration.max_batch_code_points
        ):
            batches.append(current)
            current = []
            current_size = 0
        if chunk_size > configuration.max_batch_code_points:
            raise SourceIndexingError("embedding_input_too_large")
        current.append(chunk)
        current_size += chunk_size
    if current:
        batches.append(current)
    return batches


def _validate_batch_vectors(
    vectors: Sequence[Sequence[float]],
    expected_count: int,
    expected_dimensions: int,
) -> None:
    if len(vectors) != expected_count:
        raise SourceIndexingError("invalid_embedding")
    for vector in vectors:
        if len(vector) != expected_dimensions:
            raise SourceIndexingError("invalid_embedding")
        for value in vector:
            if isinstance(value, bool) or not isinstance(value, (int, float)):
                raise SourceIndexingError("invalid_embedding")
            if not math.isfinite(float(value)):
                raise SourceIndexingError("invalid_embedding")


def _build_record(
    owner_id: str,
    chunk: TextChunk,
    vector: Sequence[float],
    configuration: EmbeddingConfiguration,
) -> ChunkVectorRecord:
    return ChunkVectorRecord(
        owner_id=owner_id,
        source_id=chunk.source_id,
        content_version=chunk.content_version,
        chunker_version=chunk.chunker_version,
        chunk_index=chunk.chunk_index,
        chunk_id=chunk.chunk_id,
        text=chunk.text,
        start_offset=chunk.start_offset,
        end_offset=chunk.end_offset,
        embedding_model=configuration.model,
        vector=list(vector),
    )

import logging

from fastapi import APIRouter, Depends

from app.api.dependencies import require_internal_indexing_service
from app.schemas.indexing import IndexingData, IndexingRequest, IndexingResponse
from app.services.source_indexing import SourceIndexingError, SourceIndexingService

logger = logging.getLogger("devsignal-ai-service")

router = APIRouter()


@router.post("/indexings", response_model=IndexingResponse, response_model_exclude_none=True)
async def create_indexing(
    request: IndexingRequest,
    service: SourceIndexingService = Depends(require_internal_indexing_service),  # noqa: B008
) -> IndexingResponse:
    correlation_id = request.source_id[:8]
    logger.info(f"[indexing] {correlation_id} request-received")

    try:
        result = await service.index(request)
    except SourceIndexingError as exception:
        from app.errors import ApplicationError

        error_map = {
            "collection_incompatible": (503, "INDEXING_STORAGE_INCOMPATIBLE"),
            "unavailable": (503, "INDEXING_UNAVAILABLE"),
            "timeout": (504, "INDEXING_TIMEOUT"),
            "rate_limit": (503, "INDEXING_PROVIDER_BUSY"),
            "invalid_embedding": (502, "INDEXING_INVALID_EMBEDDING"),
            "invalid_content": (400, "VALIDATION_ERROR"),
        }
        status_code, code = error_map.get(exception.kind, (502, "INDEXING_FAILED"))
        logger.info(
            f"[indexing] {correlation_id} error kind={exception.kind} "
            f"code={code} status={status_code}"
        )
        raise ApplicationError(status_code, code, "Knowledge source indexing failed") from exception

    logger.info(f"[indexing] {correlation_id} success chunks={result.indexed_chunk_count}")

    data = IndexingData(
        sourceId=result.source_id,
        contentVersion=result.content_version,
        chunkerVersion=result.chunker_version,
        embeddingModel=result.embedding_model,
        dimensions=result.dimensions,
        indexedChunkCount=result.indexed_chunk_count,
    )
    return IndexingResponse(data=data, usage=list(result.usage) or None)

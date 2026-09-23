import logging

from fastapi import APIRouter, Depends

from app.api.dependencies import require_internal_retrieval_service
from app.errors import ApplicationError
from app.schemas.common import UsageMetadata
from app.schemas.retrieval import (
    RetrievalCandidateData,
    RetrievalRequest,
    RetrievalResponse,
)
from app.services.retrieval import RetrievalError, RetrievalService

logger = logging.getLogger("devsignal-ai-service")
router = APIRouter()


@router.post("/retrievals", response_model=RetrievalResponse, response_model_exclude_none=True)
async def create_retrieval(
    request: RetrievalRequest,
    service: RetrievalService = Depends(require_internal_retrieval_service),  # noqa: B008
) -> RetrievalResponse:
    return await retrieve_response(request, service)


async def retrieve_response(
    request: RetrievalRequest, service: RetrievalService
) -> RetrievalResponse:
    usage: UsageMetadata | None = None
    try:
        if hasattr(service, "retrieve_with_usage"):
            candidates, usage = await service.retrieve_with_usage(
                request.owner_id, request.query, request.limit, request.source_ids
            )
        else:
            if request.source_ids is None:
                candidates = await service.retrieve(request.owner_id, request.query, request.limit)
            else:
                candidates = await service.retrieve(
                    request.owner_id, request.query, request.limit, request.source_ids
                )
            usage = None
    except ValueError as exception:
        raise ApplicationError(400, "VALIDATION_ERROR", "Invalid request data") from exception
    except RetrievalError as exception:
        error_map = {
            "collection_missing": (503, "RETRIEVAL_COLLECTION_MISSING"),
            "unavailable": (503, "RETRIEVAL_UNAVAILABLE"),
            "timeout": (504, "RETRIEVAL_TIMEOUT"),
            "rate_limit": (503, "RETRIEVAL_PROVIDER_BUSY"),
            "invalid_embedding": (502, "RETRIEVAL_INVALID_EMBEDDING"),
            "embedding_incompatible": (502, "RETRIEVAL_INCOMPATIBLE_INDEX"),
            "invalid_response": (502, "RETRIEVAL_INVALID_RESPONSE"),
            "invalid_search": (502, "RETRIEVAL_INVALID_RESPONSE"),
        }
        status_code, code = error_map.get(exception.kind, (502, "RETRIEVAL_FAILED"))
        logger.info("retrieval failed kind=%s code=%s", exception.kind, code)
        raise ApplicationError(status_code, code, "Knowledge retrieval failed") from exception

    return RetrievalResponse(
        data=[
            RetrievalCandidateData(
                pointId=candidate.point_id,
                ownerId=request.owner_id,
                sourceId=candidate.source_id,
                contentVersion=candidate.content_version,
                chunkerVersion=candidate.chunker_version,
                chunkIndex=candidate.chunk_index,
                chunkId=candidate.chunk_id,
                text=candidate.text,
                startOffset=candidate.start_offset,
                endOffset=candidate.end_offset,
                embeddingModel=candidate.embedding_model,
                score=candidate.score,
            )
            for candidate in candidates
        ],
        usage=usage if isinstance(usage, UsageMetadata) else None,
    )

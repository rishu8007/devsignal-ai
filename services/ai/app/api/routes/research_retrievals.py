from fastapi import APIRouter, Depends

from app.api.dependencies import require_internal_research_retrieval_service
from app.api.routes.retrievals import retrieve_response
from app.schemas.retrieval import RetrievalRequest, RetrievalResponse
from app.services.retrieval import RetrievalService

router = APIRouter()


@router.post("/research-retrievals", response_model=RetrievalResponse)
async def create_research_retrieval(
    request: RetrievalRequest,
    service: RetrievalService = Depends(require_internal_research_retrieval_service),  # noqa: B008
) -> RetrievalResponse:
    return await retrieve_response(request, service)

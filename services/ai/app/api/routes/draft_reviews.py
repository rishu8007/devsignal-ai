from fastapi import APIRouter, Depends

from app.api.dependencies import require_internal_draft_review_provider
from app.providers.draft_review_provider import DraftReviewProvider
from app.schemas.draft_review import DraftReviewRequest, DraftReviewResponse

router = APIRouter()


@router.post("/draft-reviews", response_model=DraftReviewResponse)
async def create_draft_review(
    request: DraftReviewRequest,
    provider: DraftReviewProvider = Depends(require_internal_draft_review_provider),  # noqa: B008
) -> DraftReviewResponse:
    return DraftReviewResponse(data=await provider.review(request))

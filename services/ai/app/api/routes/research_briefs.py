from fastapi import APIRouter, Depends

from app.api.dependencies import require_internal_research_brief_provider
from app.providers.research_brief_provider import ResearchBriefProvider
from app.schemas.research_brief import ResearchBriefRequest, ResearchBriefResponse

router = APIRouter()


@router.post(
    "/research-briefs", response_model=ResearchBriefResponse, response_model_exclude_none=True
)
async def create_research_brief(
    request: ResearchBriefRequest,
    provider: ResearchBriefProvider = Depends(require_internal_research_brief_provider),  # noqa: B008
) -> ResearchBriefResponse:
    if hasattr(provider, "research_with_usage"):
        data, usage = await provider.research_with_usage(request)
    else:
        data, usage = await provider.research(request), None
    return ResearchBriefResponse(data=data, usage=usage)

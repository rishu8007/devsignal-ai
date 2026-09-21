from fastapi import APIRouter, Depends

from app.api.dependencies import require_internal_topic_planning_provider
from app.providers.topic_planning_provider import TopicPlanningProvider
from app.schemas.topic_planning import TopicPlanRequest, TopicPlanResponse

router = APIRouter()


@router.post("/topic-plans", response_model=TopicPlanResponse)
async def create_topic_plan(
    request: TopicPlanRequest,
    provider: TopicPlanningProvider = Depends(require_internal_topic_planning_provider),  # noqa: B008
) -> TopicPlanResponse:
    return TopicPlanResponse(data=await provider.plan(request))

from fastapi import APIRouter, Depends

from app.api.dependencies import require_internal_topic_planning_provider
from app.providers.topic_planning_provider import TopicPlanningProvider
from app.schemas.topic_planning import TopicPlanRequest, TopicPlanResponse

router = APIRouter()


@router.post("/topic-plans", response_model=TopicPlanResponse, response_model_exclude_none=True)
async def create_topic_plan(
    request: TopicPlanRequest,
    provider: TopicPlanningProvider = Depends(require_internal_topic_planning_provider),  # noqa: B008
) -> TopicPlanResponse:
    if hasattr(provider, "plan_with_usage"):
        data, usage = await provider.plan_with_usage(request)
    else:
        data, usage = await provider.plan(request), None
    return TopicPlanResponse(data=data, usage=usage)

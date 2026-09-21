from pydantic import BaseModel, ConfigDict, Field, StrictStr

from app.schemas.common import SuccessResponse


class TopicSource(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)
    source_id: StrictStr = Field(alias="sourceId", min_length=1, max_length=100)
    content_version: int = Field(alias="contentVersion", ge=1)
    title: StrictStr = Field(min_length=1, max_length=200)
    text: StrictStr = Field(min_length=1, max_length=4000)

class TopicPlanRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)
    audience: str = Field(max_length=500)
    content_goal: str = Field(alias="contentGoal", max_length=500)
    sources: list[TopicSource] = Field(min_length=1, max_length=5)

class TopicSuggestion(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)
    id: StrictStr = Field(min_length=1, max_length=100)
    title: StrictStr = Field(min_length=5, max_length=160)
    angle: StrictStr = Field(min_length=10, max_length=1000)
    relevance: StrictStr = Field(min_length=10, max_length=1000)
    talking_points: list[StrictStr] = Field(alias="talkingPoints", min_length=1, max_length=8)
    source_ids: list[StrictStr] = Field(alias="sourceIds", min_length=1, max_length=5)
    missing_evidence: list[StrictStr] = Field(alias="missingEvidence", max_length=8)

class TopicPlanData(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)
    model: str
    suggestions: list[TopicSuggestion] = Field(min_length=3, max_length=5)

class TopicPlanResponse(SuccessResponse[TopicPlanData]):
    pass

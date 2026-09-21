from pydantic import BaseModel, ConfigDict, Field, StrictStr

from app.schemas.common import SuccessResponse


class ResearchEvidence(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)
    evidence_id: StrictStr = Field(alias="evidenceId", min_length=1, max_length=120)
    source_id: StrictStr = Field(alias="sourceId", min_length=1, max_length=100)
    content_version: int = Field(alias="contentVersion", ge=1)
    chunk_id: StrictStr = Field(alias="chunkId", min_length=1, max_length=200)
    chunk_index: int = Field(alias="chunkIndex", ge=0)
    text: StrictStr = Field(min_length=1, max_length=1000)
    score: float


class ResearchBriefRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)
    topic: str = Field(min_length=5, max_length=120)
    notes: str = Field(min_length=30, max_length=4000)
    evidence: list[ResearchEvidence] = Field(max_length=8)


class ResearchTalkingPoint(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)
    text: StrictStr = Field(min_length=1, max_length=1000)
    evidence_ids: list[StrictStr] = Field(alias="evidenceIds", max_length=8)


class ResearchClaimAssessment(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)
    claim: StrictStr = Field(min_length=1, max_length=500)
    assessment: str = Field(pattern="^(supported|partially_supported|unsupported|conflicting)$")
    explanation: StrictStr = Field(min_length=1, max_length=1000)
    evidence_ids: list[StrictStr] = Field(alias="evidenceIds", max_length=8)


class ResearchBriefData(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)
    model: str
    no_evidence: bool = Field(alias="noEvidence")
    topic_summary: str = Field(alias="topicSummary", max_length=1200)
    talking_points: list[ResearchTalkingPoint] = Field(alias="talkingPoints", max_length=8)
    claim_assessments: list[ResearchClaimAssessment] = Field(
        alias="claimAssessments", max_length=12
    )
    missing_information: list[str] = Field(alias="missingInformation", max_length=12)
    questions: list[str] = Field(max_length=12)
    limitations: list[str] = Field(max_length=8)


class ResearchBriefResponse(SuccessResponse[ResearchBriefData]):
    pass

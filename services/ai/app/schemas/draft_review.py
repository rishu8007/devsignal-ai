from pydantic import BaseModel, ConfigDict, Field, StrictStr

from app.schemas.common import SuccessResponse


class ReviewEvidence(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)
    evidence_id: StrictStr = Field(alias="evidenceId", min_length=1, max_length=120)
    text: StrictStr = Field(min_length=1, max_length=1000)


class DraftReviewRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)
    draft: StrictStr = Field(min_length=100, max_length=3000)
    evidence: list[ReviewEvidence] = Field(max_length=8)


class ReviewFinding(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)
    category: str = Field(
        pattern="^(unsupported_personal_claim|unsupported_technical_claim|contradiction|overstatement|clarity)$"
    )
    severity: str = Field(pattern="^(low|medium|high)$")
    passage: StrictStr = Field(min_length=1, max_length=1000)
    explanation: StrictStr = Field(min_length=1, max_length=1200)
    evidence_ids: list[StrictStr] = Field(alias="evidenceIds", max_length=8)
    suggestion: StrictStr = Field(min_length=1, max_length=1000)


class DraftReviewData(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)
    model: str
    summary: StrictStr = Field(max_length=1500)
    findings: list[ReviewFinding] = Field(max_length=12)
    proposed_draft: str | None = Field(alias="proposedDraft", default=None, max_length=3000)


class DraftReviewResponse(SuccessResponse[DraftReviewData]):
    pass

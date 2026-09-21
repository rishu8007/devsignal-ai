from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, StrictStr

from app.schemas.common import SuccessResponse


class WorkflowEvidence(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)
    evidence_id: StrictStr = Field(alias="evidenceId", min_length=1, max_length=120)
    source_id: StrictStr = Field(alias="sourceId", min_length=1, max_length=100)
    content_version: int = Field(alias="contentVersion", ge=1)
    chunk_id: StrictStr = Field(alias="chunkId", min_length=1, max_length=200)
    chunk_index: int = Field(alias="chunkIndex", ge=0)
    text: StrictStr = Field(min_length=1, max_length=1000)


class WorkflowRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)
    thread_id: StrictStr = Field(alias="threadId", min_length=1, max_length=100)
    owner_id: StrictStr = Field(alias="ownerId", min_length=1, max_length=100)
    topic: str = Field(min_length=5, max_length=120)
    notes: str = Field(min_length=30, max_length=4000)
    primary_audience: Literal[
        "Recruiters & hiring teams",
        "Developers & engineers",
        "Founders & product teams",
        "AI community",
    ] = Field(alias="primaryAudience")
    content_type: Literal["Project update", "Learning", "Technical insight", "Build in public"] = (
        Field(alias="contentType")
    )
    evidence: list[WorkflowEvidence] = Field(max_length=8)
    research: dict[str, Any] | None = None
    resume: bool = False
    approval: dict[str, Any] | None = None


class WorkflowResponse(SuccessResponse[dict[str, Any]]):
    pass

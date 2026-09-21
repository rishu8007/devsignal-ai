from pydantic import BaseModel, ConfigDict, Field, StrictInt, StrictStr

from app.schemas.common import SuccessResponse


class RetrievalRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    owner_id: StrictStr = Field(alias="ownerId")
    query: StrictStr
    limit: StrictInt
    source_ids: list[StrictStr] | None = Field(default=None, alias="sourceIds", max_length=5)


class RetrievalCandidateData(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    point_id: StrictStr = Field(alias="pointId")
    owner_id: StrictStr = Field(alias="ownerId")
    source_id: StrictStr = Field(alias="sourceId")
    content_version: StrictInt = Field(alias="contentVersion")
    chunker_version: StrictStr = Field(alias="chunkerVersion")
    chunk_index: StrictInt = Field(alias="chunkIndex")
    chunk_id: StrictStr = Field(alias="chunkId")
    text: StrictStr
    start_offset: StrictInt = Field(alias="startOffset")
    end_offset: StrictInt = Field(alias="endOffset")
    embedding_model: StrictStr = Field(alias="embeddingModel")
    score: float


class RetrievalResponse(SuccessResponse[list[RetrievalCandidateData]]):
    pass

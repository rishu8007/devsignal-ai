from pydantic import BaseModel, ConfigDict, Field

from app.schemas.common import SuccessResponse
from app.services.source_indexing import SourceIndexingInput


class IndexingRequest(SourceIndexingInput):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class IndexingData(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    source_id: str = Field(alias="sourceId")
    content_version: int = Field(alias="contentVersion")
    chunker_version: str = Field(alias="chunkerVersion")
    embedding_model: str = Field(alias="embeddingModel")
    dimensions: int
    indexed_chunk_count: int = Field(alias="indexedChunkCount")


class IndexingResponse(SuccessResponse[IndexingData]):
    pass

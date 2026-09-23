from datetime import datetime
from typing import Generic, Literal, TypeVar

from pydantic import BaseModel, ConfigDict, Field, StrictInt, StrictStr

DataT = TypeVar("DataT")


class SuccessResponse(BaseModel, Generic[DataT]):
    model_config = ConfigDict(extra="forbid")

    success: Literal[True] = True
    data: DataT
    usage: "UsageMetadata | list[UsageMetadata] | None" = None


class UsageMetadata(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    model: StrictStr = Field(min_length=1)
    input_tokens: StrictInt | None = Field(default=None, alias="inputTokens", ge=0)
    output_tokens: StrictInt | None = Field(default=None, alias="outputTokens", ge=0)
    embedding_tokens: StrictInt | None = Field(default=None, alias="embeddingTokens", ge=0)
    recorded_at: datetime | None = Field(default=None, alias="recordedAt")


class ErrorBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: str
    message: str
    details: dict[str, dict[str, list[str]]] | None = None


class ErrorResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    success: Literal[False] = False
    error: ErrorBody

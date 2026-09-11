from typing import Generic, Literal, TypeVar

from pydantic import BaseModel, ConfigDict

DataT = TypeVar("DataT")


class SuccessResponse(BaseModel, Generic[DataT]):
    model_config = ConfigDict(extra="forbid")

    success: Literal[True] = True
    data: DataT


class ErrorBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: str
    message: str


class ErrorResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    success: Literal[False] = False
    error: ErrorBody

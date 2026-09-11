from dataclasses import dataclass
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.schemas.common import SuccessResponse

Angle = Literal["technical_depth", "learning_story", "professional_impact"]


class GenerationRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

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

    @field_validator("topic", "notes", mode="before")
    @classmethod
    def trim_text(cls, value: str) -> str:
        return value.strip()


class GenerationVariation(BaseModel):
    model_config = ConfigDict(extra="forbid")

    angle: Angle
    content: str


class GenerationData(BaseModel):
    model_config = ConfigDict(extra="forbid")

    variations: list[GenerationVariation]
    model: str


class GenerationResponse(SuccessResponse[GenerationData]):
    pass


class ProviderGenerationOutput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    variations: list[GenerationVariation]


@dataclass(frozen=True)
class ProviderGenerationResult:
    output: ProviderGenerationOutput
    model: str

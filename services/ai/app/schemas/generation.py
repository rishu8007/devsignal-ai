from dataclasses import dataclass
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, StrictStr, field_validator

from app.schemas.common import SuccessResponse, UsageMetadata

Angle = Literal["technical_depth", "learning_story", "professional_impact"]

# Bounds for optional grounding context. A chunk's text is capped at the same length the
# indexing/embedding chunker already enforces (MAX_CHUNK_LENGTH in app.services.chunking),
# and the chunk count is capped to match the API's sources/search default ceiling.
MAX_CONTEXT_CHUNKS = 5
MAX_CONTEXT_CHUNK_LENGTH = 1_000
MAX_CONTEXT_TOTAL_LENGTH = 4_000


class GenerationContextChunk(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    chunk_id: StrictStr = Field(alias="chunkId", min_length=1, max_length=200)
    text: StrictStr = Field(min_length=1, max_length=MAX_CONTEXT_CHUNK_LENGTH)


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
    context: list[GenerationContextChunk] | None = Field(
        default=None, max_length=MAX_CONTEXT_CHUNKS
    )

    @field_validator("topic", "notes", mode="before")
    @classmethod
    def trim_text(cls, value: str) -> str:
        return value.strip()

    @field_validator("context")
    @classmethod
    def validate_context(
        cls, value: list[GenerationContextChunk] | None
    ) -> list[GenerationContextChunk] | None:
        if value is None:
            return value
        chunk_ids = [chunk.chunk_id for chunk in value]
        if len(chunk_ids) != len(set(chunk_ids)):
            raise ValueError("context chunk IDs must be unique")
        if sum(len(chunk.text) for chunk in value) > MAX_CONTEXT_TOTAL_LENGTH:
            raise ValueError("context is too large")
        return value


class GenerationVariation(BaseModel):
    model_config = ConfigDict(extra="forbid")

    angle: Angle
    content: str
    citations: list[str] = Field(default_factory=list)


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
    usage: UsageMetadata | None = None

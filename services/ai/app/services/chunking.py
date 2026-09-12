from __future__ import annotations

from typing import ClassVar

from pydantic import BaseModel, ConfigDict, Field, StrictInt, StrictStr, field_validator

MAX_CONTENT_LENGTH = 20_000
MAX_CHUNK_LENGTH = 1_000
CHUNK_OVERLAP = 150
BOUNDARY_LOOKBACK = 200
CHUNKER_VERSION = "text-v1"


class ChunkingInput(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    source_id: StrictStr = Field(alias="sourceId")
    content_version: StrictInt = Field(alias="contentVersion")
    content: StrictStr

    _source_id_pattern: ClassVar[str] = r"^[0-9a-fA-F]{24}$"

    @field_validator("source_id")
    @classmethod
    def validate_source_id(cls, value: str) -> str:
        import re

        if re.fullmatch(cls._source_id_pattern, value) is None:
            raise ValueError("sourceId must contain exactly 24 hexadecimal characters")
        return value.lower()

    @field_validator("content_version")
    @classmethod
    def validate_content_version(cls, value: int) -> int:
        if value < 1:
            raise ValueError("contentVersion must be a positive integer")
        return value

    @field_validator("content")
    @classmethod
    def validate_content(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("content must not be blank")
        if len(value) > MAX_CONTENT_LENGTH:
            raise ValueError("content must contain at most 20000 characters")
        return value


class TextChunk(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    chunk_id: str = Field(alias="chunkId")
    source_id: str = Field(alias="sourceId")
    content_version: int = Field(alias="contentVersion")
    chunk_index: int = Field(alias="chunkIndex")
    text: str
    start_offset: int = Field(alias="startOffset")
    end_offset: int = Field(alias="endOffset")
    chunker_version: str = Field(alias="chunkerVersion")


def chunk_text(source: ChunkingInput) -> list[TextChunk]:
    normalized_content = source.content.replace("\r\n", "\n").replace("\r", "\n")
    chunks: list[TextChunk] = []
    start = 0
    chunk_index = 0

    while start < len(normalized_content):
        candidate_end = min(start + MAX_CHUNK_LENGTH, len(normalized_content))
        end = _choose_end(normalized_content, start, candidate_end)
        if end <= start:
            end = candidate_end

        text = normalized_content[start:end]
        if text.strip():
            chunks.append(
                TextChunk(
                    chunkId=f"{source.source_id}_v{source.content_version}_c{chunk_index}",
                    sourceId=source.source_id,
                    contentVersion=source.content_version,
                    chunkIndex=chunk_index,
                    text=text,
                    startOffset=start,
                    endOffset=end,
                    chunkerVersion=CHUNKER_VERSION,
                )
            )
            chunk_index += 1

        if end >= len(normalized_content):
            break

        next_start = max(start + 1, end - CHUNK_OVERLAP)
        if next_start <= start:
            next_start = end
        start = next_start

    return chunks


def _choose_end(content: str, start: int, candidate_end: int) -> int:
    if candidate_end == len(content):
        return candidate_end

    boundary_start = max(start + 1, candidate_end - BOUNDARY_LOOKBACK)
    paragraph_end = _last_paragraph_boundary(content, boundary_start, candidate_end)
    if paragraph_end is not None and paragraph_end > start + CHUNK_OVERLAP:
        return paragraph_end

    whitespace_end = _last_whitespace_boundary(content, boundary_start, candidate_end)
    if whitespace_end is not None and whitespace_end > start + CHUNK_OVERLAP:
        return whitespace_end

    return candidate_end


def _last_paragraph_boundary(content: str, start: int, end: int) -> int | None:
    boundary: int | None = None
    position = content.find("\n\n", start, end)
    while position != -1:
        boundary = position + 2
        position = content.find("\n\n", position + 1, end)
    return boundary


def _last_whitespace_boundary(content: str, start: int, end: int) -> int | None:
    for position in range(end - 1, start - 1, -1):
        if content[position].isspace():
            return position + 1
    return None

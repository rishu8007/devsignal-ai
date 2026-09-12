import pytest
from pydantic import ValidationError

from app.services.chunking import (
    CHUNK_OVERLAP,
    CHUNKER_VERSION,
    MAX_CHUNK_LENGTH,
    ChunkingInput,
    TextChunk,
    chunk_text,
)

SOURCE_ID = "ABCDEF0123456789ABCDEF01"


def make_input(content: str, *, source_id: str = SOURCE_ID, version: int = 1) -> ChunkingInput:
    return ChunkingInput(sourceId=source_id, contentVersion=version, content=content)


def test_rejects_empty_whitespace_oversized_and_invalid_inputs() -> None:
    for content in ("", " \n\t", "x" * 20_001):
        with pytest.raises(ValidationError):
            make_input(content)

    for source_id in ("short", "g" * 24, "a" * 23):
        with pytest.raises(ValidationError):
            make_input("valid content", source_id=source_id)

    for version in (0, -1, True, 1.0):
        with pytest.raises(ValidationError):
            ChunkingInput(sourceId=SOURCE_ID, contentVersion=version, content="valid content")


def test_short_input_is_one_exact_chunk_with_normalized_source_id() -> None:
    source = make_input("A short note.", version=3)

    chunks = chunk_text(source)

    assert chunks == [
        TextChunk(
            chunkId="abcdef0123456789abcdef01_v3_c0",
            sourceId="abcdef0123456789abcdef01",
            contentVersion=3,
            chunkIndex=0,
            text="A short note.",
            startOffset=0,
            endOffset=13,
            chunkerVersion=CHUNKER_VERSION,
        )
    ]


def test_prefers_last_paragraph_boundary_then_whitespace_boundary() -> None:
    paragraph_content = ("a" * 700) + "\n\n" + ("b" * 100) + "\n\n" + ("c" * 500)
    paragraph_chunks = chunk_text(make_input(paragraph_content))
    assert paragraph_chunks[0].end_offset == 804
    assert paragraph_chunks[0].text == paragraph_content[:804]

    whitespace_content = ("a" * 850) + (" " * 1) + ("b" * 149) + ("c" * 200)
    whitespace_chunks = chunk_text(make_input(whitespace_content))
    assert whitespace_chunks[0].end_offset == 851
    assert whitespace_chunks[0].text == whitespace_content[:851]


def test_long_unbroken_text_splits_at_maximum_and_always_progresses() -> None:
    content = "x" * 2_501

    chunks = chunk_text(make_input(content))

    assert [len(chunk.text) for chunk in chunks] == [1000, 1000, 801]
    assert all(len(chunk.text) <= MAX_CHUNK_LENGTH for chunk in chunks)
    assert all(
        current.start_offset < current.end_offset
        and (index == 0 or current.start_offset > chunks[index - 1].start_offset)
        for index, current in enumerate(chunks)
    )


def test_normalizes_line_endings_and_offsets_use_normalized_code_points() -> None:
    source = make_input("first\r\n\rsecond\rthird")

    chunks = chunk_text(source)

    normalized = "first\n\nsecond\nthird"
    assert chunks[0].text == normalized
    assert chunks[0].start_offset == 0
    assert chunks[0].end_offset == len(normalized)
    assert chunks[0].text == normalized[chunks[0].start_offset : chunks[0].end_offset]


def test_unicode_offsets_are_code_points_and_preserve_emoji() -> None:
    content = "🚀" * 999 + " end"

    chunks = chunk_text(make_input(content))

    assert chunks[0].text == content[:1000]
    assert chunks[0].end_offset == 1000
    assert chunks[0].text == content[chunks[0].start_offset : chunks[0].end_offset]


def test_chunk_invariants_overlap_coverage_and_determinism() -> None:
    content = ("paragraph one\n\n" * 1000)[:20_000]
    source = make_input(content)

    first = chunk_text(source)
    second = chunk_text(source)

    assert first == second
    assert first
    assert all(chunk.chunker_version == CHUNKER_VERSION for chunk in first)
    assert all(chunk.text.strip() for chunk in first)
    assert all(len(chunk.text) <= MAX_CHUNK_LENGTH for chunk in first)
    assert all(
        chunk.text
        == content.replace("\r\n", "\n").replace("\r", "\n")[chunk.start_offset : chunk.end_offset]
        for chunk in first
    )
    assert all(
        first[index + 1].start_offset <= chunk.end_offset - CHUNK_OVERLAP
        for index, chunk in enumerate(first[:-1])
    )
    for position, character in enumerate(content):
        if not character.isspace():
            assert any(chunk.start_offset <= position < chunk.end_offset for chunk in first)


def test_source_and_version_change_chunk_identifiers() -> None:
    content = "Stable source content."

    source_chunks = chunk_text(make_input(content, source_id=SOURCE_ID, version=1))
    other_source_chunks = chunk_text(make_input(content, source_id="a" * 24, version=1))
    other_version_chunks = chunk_text(make_input(content, source_id=SOURCE_ID, version=2))

    assert source_chunks[0].chunk_id != other_source_chunks[0].chunk_id
    assert source_chunks[0].chunk_id != other_version_chunks[0].chunk_id

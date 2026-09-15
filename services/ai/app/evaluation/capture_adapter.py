"""Convert saved public Knowledge search responses into evaluator results."""

from __future__ import annotations

import json
import math
from collections.abc import Mapping
from pathlib import Path
from typing import Any

from app.evaluation.retrieval import (
    RESULTS_SCHEMA_VERSION,
    Benchmark,
    load_benchmark,
    load_results,
)

CAPTURE_SCHEMA_VERSION = "retrieval-captures-v1"
MAPPING_SCHEMA_VERSION = "retrieval-source-map-v1"
PUBLIC_CANDIDATE_FIELDS = {
    "sourceId",
    "title",
    "contentVersion",
    "chunkId",
    "chunkIndex",
    "text",
    "startOffset",
    "endOffset",
    "score",
}


def adapt_captures(
    benchmark_payload: Mapping[str, Any],
    captures_payload: Mapping[str, Any],
    mapping_payload: Mapping[str, Any],
) -> dict[str, Any]:
    benchmark = load_benchmark(benchmark_payload)
    mapping = _load_mapping(mapping_payload, benchmark)
    captures = _load_captures(captures_payload, benchmark, mapping)
    output = {
        "schemaVersion": RESULTS_SCHEMA_VERSION,
        "resultsOrigin": "recorded",
        "results": captures,
    }
    load_results(output, benchmark)
    return output


def write_output(output: Mapping[str, Any], path: Path, overwrite: bool = False) -> None:
    if path.exists() and not overwrite:
        raise ValueError(f"output already exists; pass --overwrite to replace: {path}")
    path.write_text(json.dumps(output, indent=2) + "\n", encoding="utf-8")


def _load_mapping(
    payload: Mapping[str, Any],
    benchmark: Benchmark,
) -> dict[str, str]:
    _require_version(payload, "schemaVersion", MAPPING_SCHEMA_VERSION)
    raw_mappings = _list(payload, "mappings")
    mapping: dict[str, str] = {}
    targets: set[str] = set()
    for index, raw_mapping in enumerate(raw_mappings):
        item = _object(raw_mapping, f"mappings[{index}]")
        application_id = _identifier(
            item.get("applicationSourceId"),
            f"mappings[{index}].applicationSourceId",
        )
        benchmark_id = _identifier(
            item.get("benchmarkSourceId"),
            f"mappings[{index}].benchmarkSourceId",
        )
        if application_id in mapping:
            raise ValueError(f"duplicate application source mapping: {application_id}")
        if benchmark_id in targets:
            raise ValueError(f"ambiguous benchmark source mapping: {benchmark_id}")
        if benchmark_id not in benchmark.source_ids:
            raise ValueError(f"unknown benchmark sourceId in mapping: {benchmark_id}")
        mapping[application_id] = benchmark_id
        targets.add(benchmark_id)
    return mapping


def _load_captures(
    payload: Mapping[str, Any],
    benchmark: Benchmark,
    mapping: Mapping[str, str],
) -> list[dict[str, Any]]:
    _require_version(payload, "schemaVersion", CAPTURE_SCHEMA_VERSION)
    raw_captures = _list(payload, "captures")
    cases = {case.case_id: case for case in benchmark.cases}
    seen: set[str] = set()
    results: list[dict[str, Any]] = []
    for index, raw_capture in enumerate(raw_captures):
        item = _object(raw_capture, f"captures[{index}]")
        case_id = _identifier(item.get("caseId"), f"captures[{index}].caseId")
        if case_id in seen:
            raise ValueError(f"duplicate capture caseId: {case_id}")
        case = cases.get(case_id)
        if case is None:
            raise ValueError(f"unknown capture caseId: {case_id}")
        seen.add(case_id)
        query = _nonblank(item.get("query"), f"captures[{index}].query")
        if query != case.query:
            raise ValueError(f"capture query does not match benchmark case: {case_id}")
        response = _object(item.get("response"), f"captures[{index}].response")
        candidates = _validate_response(response, f"captures[{index}].response")
        source_ids: list[str] = []
        for candidate in candidates:
            application_id = candidate["sourceId"]
            benchmark_id = mapping.get(application_id)
            if benchmark_id is None:
                raise ValueError(
                    f"unmapped application sourceId in case {case_id}: {application_id}"
                )
            source_ids.append(benchmark_id)
        results.append({"caseId": case_id, "sourceIds": source_ids})
    missing = set(cases) - seen
    if missing:
        raise ValueError(f"missing capture caseId: {sorted(missing)[0]}")
    return results


def _validate_response(response: Mapping[str, Any], label: str) -> list[Mapping[str, Any]]:
    if response.get("success") is not True:
        raise ValueError(f"{label} must be a successful response")
    data = _object(response.get("data"), f"{label}.data")
    candidates = _list(data, "candidates")
    validated: list[Mapping[str, Any]] = []
    for index, raw_candidate in enumerate(candidates):
        candidate = _object(raw_candidate, f"{label}.data.candidates[{index}]")
        missing = PUBLIC_CANDIDATE_FIELDS - candidate.keys()
        if missing:
            raise ValueError(
                f"{label}.data.candidates[{index}] missing field: {sorted(missing)[0]}"
            )
        _identifier(candidate["sourceId"], f"{label}.data.candidates[{index}].sourceId")
        _string(candidate["title"], f"{label}.data.candidates[{index}].title")
        _positive_int(
            candidate["contentVersion"], f"{label}.data.candidates[{index}].contentVersion"
        )
        _identifier(candidate["chunkId"], f"{label}.data.candidates[{index}].chunkId")
        _nonnegative_int(candidate["chunkIndex"], f"{label}.data.candidates[{index}].chunkIndex")
        _string(candidate["text"], f"{label}.data.candidates[{index}].text")
        start = _nonnegative_int(
            candidate["startOffset"], f"{label}.data.candidates[{index}].startOffset"
        )
        end = _nonnegative_int(
            candidate["endOffset"], f"{label}.data.candidates[{index}].endOffset"
        )
        if end <= start:
            raise ValueError(f"{label}.data.candidates[{index}] has invalid offsets")
        score = candidate["score"]
        if (
            isinstance(score, bool)
            or not isinstance(score, (int, float))
            or not math.isfinite(score)
        ):
            raise ValueError(f"{label}.data.candidates[{index}].score must be finite")
        validated.append(candidate)
    return validated


def _require_version(payload: Mapping[str, Any], field: str, expected: str) -> None:
    if payload.get(field) != expected:
        raise ValueError(f"{field} must be {expected}")


def _object(value: Any, label: str) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise ValueError(f"{label} must be an object")
    return value


def _list(payload: Mapping[str, Any], field: str) -> list[Any]:
    value = payload.get(field)
    if not isinstance(value, list):
        raise ValueError(f"{field} must be an array")
    return value


def _identifier(value: Any, label: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{label} must be a nonblank string")
    return value


def _nonblank(value: Any, label: str) -> str:
    return _identifier(value, label).strip()


def _string(value: Any, label: str) -> str:
    if not isinstance(value, str):
        raise ValueError(f"{label} must be a string")
    return value


def _positive_int(value: Any, label: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
        raise ValueError(f"{label} must be a positive integer")
    return value


def _nonnegative_int(value: Any, label: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise ValueError(f"{label} must be a nonnegative integer")
    return value

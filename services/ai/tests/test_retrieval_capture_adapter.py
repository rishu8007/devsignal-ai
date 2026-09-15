from __future__ import annotations

import json

import pytest

from app.evaluation.capture_adapter import adapt_captures, write_output
from app.evaluation.retrieval import load_benchmark, load_results


def benchmark_payload() -> dict[str, object]:
    return {
        "schemaVersion": "retrieval-benchmark-v1",
        "corpus": [
            {"sourceId": "expected-a"},
            {"sourceId": "expected-b"},
        ],
        "cases": [
            {"caseId": "one", "query": "first query", "expectedSourceIds": ["expected-a"]},
            {"caseId": "two", "query": "second query", "expectedSourceIds": []},
        ],
    }


def candidate(source_id: str) -> dict[str, object]:
    return {
        "sourceId": source_id,
        "title": "Synthetic title",
        "contentVersion": 1,
        "chunkId": f"{source_id}_v1_c0",
        "chunkIndex": 0,
        "text": "Synthetic text",
        "startOffset": 0,
        "endOffset": 14,
        "score": 0.5,
    }


def captures_payload(
    response_one: dict[str, object] | None = None,
    response_two: dict[str, object] | None = None,
) -> dict[str, object]:
    return {
        "schemaVersion": "retrieval-captures-v1",
        "captures": [
            {
                "caseId": "one",
                "query": "first query",
                "response": response_one or {"success": True, "data": {"candidates": []}},
            },
            {
                "caseId": "two",
                "query": "second query",
                "response": response_two or {"success": True, "data": {"candidates": []}},
            },
        ],
    }


def mapping_payload() -> dict[str, object]:
    return {
        "schemaVersion": "retrieval-source-map-v1",
        "mappings": [
            {"applicationSourceId": "app-a", "benchmarkSourceId": "expected-a"},
            {"applicationSourceId": "app-b", "benchmarkSourceId": "expected-b"},
        ],
    }


def test_adapter_maps_order_and_repeated_sources_for_downstream_deduplication() -> None:
    response = {
        "success": True,
        "data": {"candidates": [candidate("app-a"), candidate("app-a"), candidate("app-b")]},
    }
    output = adapt_captures(benchmark_payload(), captures_payload(response), mapping_payload())
    assert output["results"] == [
        {"caseId": "one", "sourceIds": ["expected-a", "expected-a", "expected-b"]},
        {"caseId": "two", "sourceIds": []},
    ]
    benchmark = load_benchmark(benchmark_payload())
    _, results = load_results(output, benchmark)
    assert results[0].source_ids == ("expected-a", "expected-a", "expected-b")


def test_empty_candidates_are_valid() -> None:
    output = adapt_captures(benchmark_payload(), captures_payload(), mapping_payload())
    assert output["results"][0] == {"caseId": "one", "sourceIds": []}


@pytest.mark.parametrize(
    ("change", "message"),
    [
        (lambda payload: payload["captures"][0].update({"caseId": "unknown"}), "unknown capture"),
        (
            lambda payload: payload["captures"].append(payload["captures"][0].copy()),
            "duplicate capture",
        ),
        (lambda payload: payload["captures"][0].update({"query": "wrong"}), "query does not match"),
    ],
)
def test_invalid_case_mappings_and_queries_are_rejected(change, message: str) -> None:
    payload = captures_payload()
    change(payload)
    with pytest.raises(ValueError, match=message):
        adapt_captures(benchmark_payload(), payload, mapping_payload())


def test_unknown_mapping_and_failed_or_malformed_responses_are_rejected() -> None:
    with pytest.raises(ValueError, match="unmapped application"):
        adapt_captures(
            benchmark_payload(),
            captures_payload({"success": True, "data": {"candidates": [candidate("unmapped")]}}),
            mapping_payload(),
        )
    with pytest.raises(ValueError, match="successful response"):
        adapt_captures(
            benchmark_payload(),
            captures_payload({"success": False, "data": {"candidates": []}}),
            mapping_payload(),
        )
    malformed = {"success": True, "data": {"candidates": [{"sourceId": "app-a"}]}}
    with pytest.raises(ValueError, match="missing field"):
        adapt_captures(benchmark_payload(), captures_payload(malformed), mapping_payload())


def test_ambiguous_mapping_and_output_overwrite_protection(tmp_path) -> None:
    ambiguous = {
        "schemaVersion": "retrieval-source-map-v1",
        "mappings": [
            {"applicationSourceId": "app-a", "benchmarkSourceId": "expected-a"},
            {"applicationSourceId": "app-b", "benchmarkSourceId": "expected-a"},
        ],
    }
    with pytest.raises(ValueError, match="ambiguous"):
        adapt_captures(benchmark_payload(), captures_payload(), ambiguous)

    output_path = tmp_path / "results.json"
    output_path.write_text("original\n", encoding="utf-8")
    output = adapt_captures(benchmark_payload(), captures_payload(), mapping_payload())
    with pytest.raises(ValueError, match="already exists"):
        write_output(output, output_path)
    assert output_path.read_text(encoding="utf-8") == "original\n"
    write_output(output, output_path, overwrite=True)
    assert json.loads(output_path.read_text(encoding="utf-8"))["resultsOrigin"] == "recorded"

from __future__ import annotations

import pytest

from app.evaluation.retrieval import (
    Benchmark,
    BenchmarkCase,
    ResultEntry,
    evaluate,
    load_benchmark,
    load_results,
)


def benchmark(*expected: tuple[str, ...]) -> Benchmark:
    return Benchmark(
        frozenset({"a", "b", "c", "d"}),
        tuple(
            BenchmarkCase(str(index), f"query {index}", sources)
            for index, sources in enumerate(expected)
        ),
    )


def test_metrics_use_deduplicated_source_ranks_and_hand_calculated_scores() -> None:
    data = benchmark(("a",), ("a", "b"), ("c",))
    report = evaluate(
        data,
        "synthetic",
        (
            ResultEntry("0", ("a",)),
            ResultEntry("1", ("x", "a", "b")),
            ResultEntry("2", ("x", "c")),
        ),
    )
    assert report.metrics[1] == {"hitRate": 1 / 3, "recall": 1 / 3, "mrr": 1 / 3}
    assert report.metrics[3] == {"hitRate": 1.0, "recall": 1.0, "mrr": 2 / 3}


def test_no_answer_cases_are_reported_and_excluded() -> None:
    data = benchmark(("a",), ())
    report = evaluate(data, "synthetic", (ResultEntry("0", ("a",)), ResultEntry("1", ("b",))))
    assert report.no_answer_case_count == 1
    assert report.no_answer_returned_result_count == 1
    assert report.answerable_case_count == 1
    assert report.metrics[1]["hitRate"] == 1.0


def test_all_no_answer_metrics_are_unavailable() -> None:
    data = benchmark((), ())
    report = evaluate(data, "synthetic", (ResultEntry("0", ()), ResultEntry("1", ("a",))))
    assert report.metrics[1] == {"hitRate": None, "recall": None, "mrr": None}


def test_validation_rejects_missing_duplicate_and_unknown_mappings() -> None:
    base = {
        "schemaVersion": "retrieval-benchmark-v1",
        "corpus": [{"sourceId": "a"}],
        "cases": [{"caseId": "one", "query": "q", "expectedSourceIds": ["a"]}],
    }
    benchmark_data = load_benchmark(base)
    with pytest.raises(ValueError, match="missing result"):
        load_results(
            {"schemaVersion": "retrieval-results-v1", "resultsOrigin": "synthetic", "results": []},
            benchmark_data,
        )
    with pytest.raises(ValueError, match="duplicate result"):
        load_results(
            {
                "schemaVersion": "retrieval-results-v1",
                "resultsOrigin": "synthetic",
                "results": [
                    {"caseId": "one", "sourceIds": []},
                    {"caseId": "one", "sourceIds": []},
                ],
            },
            benchmark_data,
        )
    with pytest.raises(ValueError, match="unknown returned"):
        load_results(
            {
                "schemaVersion": "retrieval-results-v1",
                "resultsOrigin": "synthetic",
                "results": [{"caseId": "one", "sourceIds": ["unknown"]}],
            },
            benchmark_data,
        )

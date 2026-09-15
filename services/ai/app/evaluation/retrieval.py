"""Pure source-level retrieval evaluation.

This module deliberately has no application, provider, database, or Qdrant imports.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from fractions import Fraction
from typing import Any

BENCHMARK_SCHEMA_VERSION = "retrieval-benchmark-v1"
RESULTS_SCHEMA_VERSION = "retrieval-results-v1"
SUPPORTED_K = (1, 3, 5)


@dataclass(frozen=True)
class BenchmarkCase:
    case_id: str
    query: str
    expected_source_ids: tuple[str, ...]


@dataclass(frozen=True)
class Benchmark:
    source_ids: frozenset[str]
    cases: tuple[BenchmarkCase, ...]


@dataclass(frozen=True)
class ResultEntry:
    case_id: str
    source_ids: tuple[str, ...]


@dataclass(frozen=True)
class EvaluationReport:
    case_count: int
    answerable_case_count: int
    no_answer_case_count: int
    no_answer_returned_result_count: int
    results_origin: str
    metrics: dict[int, dict[str, float | None]]

    def as_dict(self) -> dict[str, Any]:
        return {
            "caseCount": self.case_count,
            "answerableCaseCount": self.answerable_case_count,
            "noAnswerCaseCount": self.no_answer_case_count,
            "noAnswerReturnedResultCount": self.no_answer_returned_result_count,
            "resultsOrigin": self.results_origin,
            "metrics": {str(k): values for k, values in self.metrics.items()},
        }


def load_benchmark(payload: Mapping[str, Any]) -> Benchmark:
    _require_version(payload, "schemaVersion", BENCHMARK_SCHEMA_VERSION)
    corpus = _require_list(payload, "corpus")
    cases = _require_list(payload, "cases")

    source_ids: set[str] = set()
    for index, note in enumerate(corpus):
        item = _require_mapping(note, f"corpus[{index}]")
        source_id = _identifier(item.get("sourceId"), f"corpus[{index}].sourceId")
        if source_id in source_ids:
            raise ValueError(f"duplicate corpus sourceId: {source_id}")
        source_ids.add(source_id)

    parsed_cases: list[BenchmarkCase] = []
    case_ids: set[str] = set()
    for index, raw_case in enumerate(cases):
        item = _require_mapping(raw_case, f"cases[{index}]")
        case_id = _identifier(item.get("caseId"), f"cases[{index}].caseId")
        if case_id in case_ids:
            raise ValueError(f"duplicate caseId: {case_id}")
        case_ids.add(case_id)
        query = _nonblank(item.get("query"), f"cases[{index}].query")
        expected = _require_list(item, "expectedSourceIds", f"cases[{index}]")
        expected_ids: list[str] = []
        for expected_index, value in enumerate(expected):
            source_id = _identifier(
                value,
                f"cases[{index}].expectedSourceIds[{expected_index}]",
            )
            if source_id not in source_ids:
                raise ValueError(f"unknown expected sourceId: {source_id}")
            if source_id in expected_ids:
                raise ValueError(f"duplicate expected sourceId in case: {case_id}")
            expected_ids.append(source_id)
        parsed_cases.append(BenchmarkCase(case_id, query, tuple(expected_ids)))

    return Benchmark(frozenset(source_ids), tuple(parsed_cases))


def load_results(
    payload: Mapping[str, Any], benchmark: Benchmark
) -> tuple[str, tuple[ResultEntry, ...]]:
    _require_version(payload, "schemaVersion", RESULTS_SCHEMA_VERSION)
    origin = _nonblank(payload.get("resultsOrigin"), "resultsOrigin")
    if origin not in {"synthetic", "recorded"}:
        raise ValueError("resultsOrigin must be synthetic or recorded")
    raw_results = _require_list(payload, "results")
    case_ids = {case.case_id for case in benchmark.cases}
    seen: set[str] = set()
    parsed: list[ResultEntry] = []
    for index, raw_result in enumerate(raw_results):
        item = _require_mapping(raw_result, f"results[{index}]")
        case_id = _identifier(item.get("caseId"), f"results[{index}].caseId")
        if case_id in seen:
            raise ValueError(f"duplicate result caseId: {case_id}")
        if case_id not in case_ids:
            raise ValueError(f"unknown result caseId: {case_id}")
        seen.add(case_id)
        source_ids = _require_list(item, "sourceIds", f"results[{index}]")
        parsed_ids = tuple(
            _identifier(value, f"results[{index}].sourceIds[{source_index}]")
            for source_index, value in enumerate(source_ids)
        )
        unknown = sorted(set(parsed_ids) - benchmark.source_ids)
        if unknown:
            raise ValueError(f"unknown returned sourceId: {unknown[0]}")
        parsed.append(ResultEntry(case_id, parsed_ids))
    missing = case_ids - seen
    if missing:
        raise ValueError(f"missing result caseId: {sorted(missing)[0]}")
    return origin, tuple(parsed)


def evaluate(
    benchmark: Benchmark,
    results_origin: str,
    results: Iterable[ResultEntry],
) -> EvaluationReport:
    by_case = {entry.case_id: entry for entry in results}
    answerable = [case for case in benchmark.cases if case.expected_source_ids]
    no_answer = [case for case in benchmark.cases if not case.expected_source_ids]
    no_answer_with_results = sum(
        bool(_dedupe(by_case[case.case_id].source_ids)) for case in no_answer
    )
    metrics: dict[int, dict[str, float | None]] = {}
    for k in SUPPORTED_K:
        if not answerable:
            metrics[k] = {"hitRate": None, "recall": None, "mrr": None}
            continue
        hits = 0
        recall_total = Fraction(0)
        mrr_total = Fraction(0)
        for case in answerable:
            ranked = _dedupe(by_case[case.case_id].source_ids)[:k]
            expected = set(case.expected_source_ids)
            matching = expected.intersection(ranked)
            hits += bool(matching)
            recall_total += Fraction(len(matching), len(expected))
            first_rank = next(
                (rank for rank, source_id in enumerate(ranked, start=1) if source_id in expected),
                None,
            )
            if first_rank is not None:
                mrr_total += Fraction(1, first_rank)
        denominator = len(answerable)
        metrics[k] = {
            "hitRate": hits / denominator,
            "recall": float(recall_total / denominator),
            "mrr": float(mrr_total / denominator),
        }
    return EvaluationReport(
        len(benchmark.cases),
        len(answerable),
        len(no_answer),
        no_answer_with_results,
        results_origin,
        metrics,
    )


def _dedupe(source_ids: Iterable[str]) -> list[str]:
    return list(dict.fromkeys(source_ids))


def _require_version(payload: Mapping[str, Any], field: str, expected: str) -> None:
    if payload.get(field) != expected:
        raise ValueError(f"{field} must be {expected}")


def _require_mapping(value: Any, label: str) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise ValueError(f"{label} must be an object")
    return value


def _require_list(
    payload: Mapping[str, Any],
    field: str,
    label: str | None = None,
) -> list[Any]:
    value = payload.get(field)
    if not isinstance(value, list):
        raise ValueError(f"{label or field} must be an array")
    return value


def _identifier(value: Any, label: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{label} must be a nonblank string")
    return value


def _nonblank(value: Any, label: str) -> str:
    return _identifier(value, label).strip()

"""Command-line entry point for offline retrieval evaluation."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from app.evaluation.retrieval import evaluate, load_benchmark, load_results


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Evaluate source-level retrieval rankings offline."
    )
    parser.add_argument("--benchmark", required=True, type=Path)
    parser.add_argument("--results", required=True, type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    try:
        benchmark = load_benchmark(_read_json(args.benchmark))
        origin, results = load_results(_read_json(args.results), benchmark)
        report = evaluate(benchmark, origin, results).as_dict()
    except (OSError, json.JSONDecodeError, ValueError) as error:
        parser.error(str(error))
    print(_format_report(report))
    if args.output:
        args.output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    return 0


def _read_json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"{path} must contain a JSON object")
    return value


def _format_report(report: dict[str, Any]) -> str:
    lines = [
        f"cases: {report['caseCount']} "
        f"(answerable={report['answerableCaseCount']}, no-answer={report['noAnswerCaseCount']})",
        f"results origin: {report['resultsOrigin']}",
        f"no-answer cases with returned results: {report['noAnswerReturnedResultCount']}",
    ]
    for k, metrics in report["metrics"].items():
        lines.append(
            f"@{k}: hit_rate={_display(metrics['hitRate'])} "
            f"recall={_display(metrics['recall'])} mrr={_display(metrics['mrr'])}"
        )
    return "\n".join(lines)


def _display(value: float | None) -> str:
    return "unavailable" if value is None else f"{value:.3f}"


if __name__ == "__main__":
    raise SystemExit(main())

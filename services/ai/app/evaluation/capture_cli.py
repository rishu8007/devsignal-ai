"""Command-line entry point for adapting saved search captures."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from app.evaluation.capture_adapter import adapt_captures, write_output


def main() -> int:
    parser = argparse.ArgumentParser(description="Adapt saved Knowledge search captures offline.")
    parser.add_argument("--benchmark", required=True, type=Path)
    parser.add_argument("--captures", required=True, type=Path)
    parser.add_argument("--mapping", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--overwrite", action="store_true")
    args = parser.parse_args()
    try:
        output = adapt_captures(
            _read_json(args.benchmark),
            _read_json(args.captures),
            _read_json(args.mapping),
        )
        write_output(output, args.output, args.overwrite)
    except (OSError, json.JSONDecodeError, ValueError) as error:
        parser.error(str(error))
    print(f"wrote recorded results: {args.output}")
    return 0


def _read_json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"{path} must contain a JSON object")
    return value


if __name__ == "__main__":
    raise SystemExit(main())

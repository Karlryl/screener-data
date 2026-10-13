#!/usr/bin/env python3
"""Build a deterministic quarterly SEC-only GQS shadow calendar.

This orchestrates the producer-owned input verifier and the unchanged GQS
shadow runner.  It deliberately materializes no outcomes and therefore cannot
turn the exploratory shadow into confirmatory early-detection evidence.
"""

from __future__ import annotations

import argparse
import calendar
import hashlib
import json
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


SCHEMA = "early-detection-gqs-shadow-calendar/v1"
ROOT = Path(__file__).resolve().parents[1]
INPUT_SCRIPT = Path(__file__).resolve().with_name("early-detection-gqs-inputs.py")
SHADOW_SCRIPT = Path(__file__).resolve().with_name("early-detection-gqs-shadow.js")


class GqsCalendarError(RuntimeError):
    """The quarterly shadow calendar contract could not be satisfied."""


def canonical_sha256(value: Any) -> str:
    raw = json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def parse_quarter(value: str) -> tuple[int, int]:
    if len(value) != 6 or value[4] != "q" or not value[:4].isdigit() or value[5] not in "1234":
        raise GqsCalendarError(f"invalid quarter: {value}")
    return int(value[:4]), int(value[5])


def quarter_values(start: str, end: str) -> list[str]:
    start_year, start_quarter = parse_quarter(start)
    end_year, end_quarter = parse_quarter(end)
    first = start_year * 4 + start_quarter - 1
    last = end_year * 4 + end_quarter - 1
    if first > last:
        raise GqsCalendarError("from-quarter is after to-quarter")
    return [f"{value // 4}q{value % 4 + 1}" for value in range(first, last + 1)]


def quarter_as_of(value: str) -> str:
    year, quarter = parse_quarter(value)
    month = quarter * 3
    day = calendar.monthrange(year, month)[1]
    return f"{year:04d}-{month:02d}-{day:02d}T23:59:59Z"


def run_json(command: list[str]) -> dict[str, Any]:
    completed = subprocess.run(command, cwd=ROOT, check=False, capture_output=True, text=True)
    if completed.returncode:
        raise GqsCalendarError(
            f"command failed ({completed.returncode}): {' '.join(command)}\n"
            f"{completed.stderr or completed.stdout}"
        )
    try:
        return json.loads(completed.stdout)
    except json.JSONDecodeError as exc:
        raise GqsCalendarError(f"command returned non-JSON output: {' '.join(command)}") from exc


def read_json(path: Path) -> dict[str, Any]:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise GqsCalendarError(f"cannot read JSON artifact: {path}") from exc


def summarize_point(quarter: str, input_path: Path, shadow_path: Path) -> dict[str, Any]:
    verification = run_json([sys.executable, str(INPUT_SCRIPT), "verify", "--input", str(input_path)])
    shadow = read_json(shadow_path)
    expected_at = quarter_as_of(quarter)
    if verification.get("status") != "PASS":
        raise GqsCalendarError(f"input verification failed for {quarter}")
    if shadow.get("evaluationAt") != expected_at:
        raise GqsCalendarError(f"shadow evaluation timestamp mismatch for {quarter}")
    if shadow.get("mode") != "SEC_ONLY_SHADOW_NOT_PRODUCTION_RECONSTRUCTION":
        raise GqsCalendarError(f"shadow mode mismatch for {quarter}")
    embedded_input = shadow.get("input", {})
    for key in ("bundleSha256", "fileSha256", "snapshots"):
        if embedded_input.get(key) != verification.get(key):
            raise GqsCalendarError(f"shadow/input {key} mismatch for {quarter}")
    summary = shadow.get("summary", {})
    engine = shadow.get("engine", {})
    return {
        "quarter": quarter,
        "evaluationAt": expected_at,
        "input": {
            "path": str(input_path.resolve()),
            "bytes": verification["bytes"],
            "snapshots": verification["snapshots"],
            "bundleSha256": verification["bundleSha256"],
            "fileSha256": verification["fileSha256"],
        },
        "shadow": {
            "path": str(shadow_path.resolve()),
            "bytes": shadow_path.stat().st_size,
            "fileSha256": file_sha256(shadow_path),
            "reportSha256": shadow.get("reportSha256"),
            "results": summary.get("results"),
            "scored": summary.get("scored"),
            "qualifiedExploratory": summary.get("qualified"),
        },
        "scoringTreeSha256": engine.get("scoringTreeSha256"),
        "productiveFilesModifiedByRun": engine.get("productiveFilesModifiedByThisRun"),
    }


def build(database: Path, data_root: Path, start: str, end: str, output: Path) -> dict[str, Any]:
    points: list[dict[str, Any]] = []
    input_dir = data_root / "derived" / "gqs-inputs"
    shadow_dir = data_root / "derived" / "gqs-shadow"
    input_dir.mkdir(parents=True, exist_ok=True)
    shadow_dir.mkdir(parents=True, exist_ok=True)
    for quarter in quarter_values(start, end):
        as_of = quarter_as_of(quarter)
        date_name = as_of[:10]
        input_path = input_dir / f"{date_name}.json"
        shadow_path = shadow_dir / f"{date_name}.json"
        run_json([
            sys.executable, str(INPUT_SCRIPT), "build", "--database", str(database),
            "--as-of", as_of, "--output", str(input_path),
        ])
        run_json(["node", str(SHADOW_SCRIPT), "--input", str(input_path), "--output", str(shadow_path)])
        points.append(summarize_point(quarter, input_path, shadow_path))
    scoring_hashes = sorted({point["scoringTreeSha256"] for point in points})
    if len(scoring_hashes) != 1 or None in scoring_hashes:
        raise GqsCalendarError("calendar points do not share one frozen scoring tree")
    if any(point["productiveFilesModifiedByRun"] is not False for point in points):
        raise GqsCalendarError("a shadow point reports productive scoring changes")
    unsigned = {
        "schema": SCHEMA,
        "status": "EXPLORATORY_CALENDAR_PASS_OUTCOME_STUDY_PENDING",
        "fromQuarter": start,
        "toQuarter": end,
        "points": points,
        "pointCount": len(points),
        "protocol": "GQS-00@1.0.0",
        "scoringTreeSha256": scoring_hashes[0],
        "confirmatoryEligible": False,
        "limitations": [
            "SEC-only shadows do not reconstruct historical Yahoo industries, prices, market caps or analyst revisions.",
            "Top-100 board qualification is an exploratory historical baseline, not an early-detection result or investment signal.",
            "No growth or price outcome is read or calculated by this calendar builder.",
        ],
    }
    report = {**unsigned, "reportSha256": canonical_sha256(unsigned)}
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return report


def self_test() -> dict[str, Any]:
    if quarter_values("2012q4", "2013q2") != ["2012q4", "2013q1", "2013q2"]:
        raise GqsCalendarError("quarter sequence self-test failed")
    if quarter_as_of("2012q1") != "2012-03-31T23:59:59Z":
        raise GqsCalendarError("Q1 end self-test failed")
    if quarter_as_of("2012q2") != "2012-06-30T23:59:59Z":
        raise GqsCalendarError("Q2 end self-test failed")
    with tempfile.TemporaryDirectory() as temporary:
        path = Path(temporary) / "payload.bin"
        path.write_bytes(b"calendar-fixture")
        if file_sha256(path) != "1d35d8db568373aedc57f040af3a669f9193ebf69a8e63ac25d522f084a99019":
            raise GqsCalendarError("file hash self-test failed")
    return {
        "schema": "early-detection-gqs-shadow-calendar-self-test/v1",
        "status": "PASS",
        "quarterSequence": quarter_values("2012q4", "2013q2"),
        "leapQuarterEnd": quarter_as_of("2012q1"),
    }


def parser() -> argparse.ArgumentParser:
    value = argparse.ArgumentParser(description=__doc__)
    commands = value.add_subparsers(dest="command", required=True)
    build_parser = commands.add_parser("build")
    build_parser.add_argument("--database", required=True)
    build_parser.add_argument("--data-root", required=True)
    build_parser.add_argument("--from-quarter", required=True)
    build_parser.add_argument("--to-quarter", required=True)
    build_parser.add_argument("--output", required=True)
    commands.add_parser("self-test")
    return value


def main() -> int:
    args = parser().parse_args()
    if args.command == "self-test":
        result = self_test()
    else:
        result = build(
            Path(args.database).resolve(), Path(args.data_root).resolve(),
            args.from_quarter, args.to_quarter, Path(args.output).resolve(),
        )
    print(json.dumps(result, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

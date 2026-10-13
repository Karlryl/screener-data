#!/usr/bin/env python3
"""Compare the wide and compact PIT indexes by counts and source-row hashes."""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import sqlite3
import sys
import tempfile
from pathlib import Path
from types import ModuleType
from typing import Any


class CompareError(RuntimeError):
    """The two derived indexes are not logically equivalent."""


def load_module(name: str, filename: str) -> ModuleType:
    path = Path(__file__).resolve().with_name(filename)
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise CompareError(f"cannot load local module: {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def digest_hex_rows(rows: list[tuple[Any, ...]], value_index: int, encoded_hex: bool) -> str:
    digest = hashlib.sha256()
    for row in rows:
        value = row[value_index]
        digest.update(bytes.fromhex(str(value)) if encoded_hex else bytes(value))
    return digest.hexdigest()


def compare_databases(
    wide_path: Path,
    compact_path: Path,
    from_quarter: str | None = None,
    to_quarter: str | None = None,
) -> dict[str, Any]:
    compact_module = load_module("pit_compact_compare", "early-detection-pit-compact.py")
    if not wide_path.exists() or not compact_path.exists():
        raise CompareError("wide and compact databases must both exist")
    wide = sqlite3.connect(wide_path)
    compact = sqlite3.connect(compact_path)
    try:
        parameters: list[Any] = []
        filters: list[str] = []
        if from_quarter:
            filters.append("quarter>=?")
            parameters.append(from_quarter)
        if to_quarter:
            filters.append("quarter<=?")
            parameters.append(to_quarter)
        where = " WHERE " + " AND ".join(filters) if filters else ""
        wide_payloads = {
            str(row[0]): str(row[1])
            for row in wide.execute(
                "SELECT payload_sha256,quarter FROM source_payloads" + where,
                parameters,
            )
        }
        compact_payloads = {
            str(row[1]): (int(row[0]), str(row[2]))
            for row in compact.execute(
                "SELECT payload_id,payload_sha256,quarter FROM source_payloads" + where,
                parameters,
            )
        }
        if set(wide_payloads) != set(compact_payloads):
            raise CompareError("payload sets differ")
        results: list[dict[str, Any]] = []
        for payload_sha256 in sorted(wide_payloads):
            payload_id, compact_quarter = compact_payloads[payload_sha256]
            if wide_payloads[payload_sha256] != compact_quarter:
                raise CompareError(f"quarter differs for {payload_sha256}")
            stats = compact.execute(
                """SELECT submissions,facts,presentations,tags,
                          hex(fact_rows_sha256),hex(presentation_rows_sha256),hex(tag_rows_sha256)
                   FROM payload_stats WHERE payload_id=?""",
                (payload_id,),
            ).fetchone()
            if stats is None:
                raise CompareError(f"compact stats missing for {payload_sha256}")
            wide_counts = {
                "submissions": int(wide.execute(
                    "SELECT COUNT(*) FROM submissions WHERE payload_sha256=?", (payload_sha256,)
                ).fetchone()[0]),
                "facts": int(wide.execute(
                    "SELECT COUNT(*) FROM facts WHERE payload_sha256=?", (payload_sha256,)
                ).fetchone()[0]),
                "presentations": int(wide.execute(
                    "SELECT COUNT(*) FROM presentations WHERE payload_sha256=?", (payload_sha256,)
                ).fetchone()[0]),
                "tags": int(wide.execute(
                    "SELECT COUNT(*) FROM tags WHERE payload_sha256=?", (payload_sha256,)
                ).fetchone()[0]),
            }
            compact_counts = {
                "submissions": int(stats[0]), "facts": int(stats[1]),
                "presentations": int(stats[2]), "tags": int(stats[3]),
            }
            if wide_counts != compact_counts:
                raise CompareError(f"row counts differ for {payload_sha256}")
            for table, expected_index in (("facts", 4), ("presentations", 5), ("tags", 6)):
                wide_rows = wide.execute(
                    f"SELECT row_sha256 FROM {table} WHERE payload_sha256=? ORDER BY row_number",
                    (payload_sha256,),
                ).fetchall()
                actual = digest_hex_rows(wide_rows, 0, encoded_hex=True)
                expected = str(stats[expected_index]).lower()
                if actual != expected:
                    raise CompareError(f"{table} row-hash sequence differs for {payload_sha256}")
            wide_submissions = sorted(
                bytes.fromhex(str(row[0]))
                for row in wide.execute(
                    "SELECT row_sha256 FROM submissions WHERE payload_sha256=?",
                    (payload_sha256,),
                )
            )
            compact_submissions = sorted(
                bytes(row[0])
                for row in compact.execute(
                    "SELECT row_sha256 FROM submissions WHERE payload_id=?",
                    (payload_id,),
                )
            )
            if wide_submissions != compact_submissions:
                raise CompareError(f"submission row-hash set differs for {payload_sha256}")
            results.append({
                "payloadSha256": payload_sha256,
                "quarter": compact_quarter,
                "counts": compact_counts,
                "factRowsSha256": str(stats[4]).lower(),
                "presentationRowsSha256": str(stats[5]).lower(),
                "tagRowsSha256": str(stats[6]).lower(),
            })
        manifest_sha256 = hashlib.sha256(
            json.dumps(results, sort_keys=True, separators=(",", ":")).encode("utf-8")
        ).hexdigest()
        return {
            "schema": "early-detection-pit-wide-compact-comparison/v1",
            "status": "PASS",
            "wideDatabase": str(wide_path.resolve()),
            "compactDatabase": str(compact_path.resolve()),
            "fromQuarter": from_quarter,
            "toQuarter": to_quarter,
            "payloadsCompared": len(results),
            "manifestSha256": manifest_sha256,
            "payloads": results,
        }
    finally:
        wide.close()
        compact.close()


def self_test() -> dict[str, Any]:
    wide_module = load_module("pit_wide_compare_test", "early-detection-pit.py")
    compact_module = load_module("pit_compact_compare_test", "early-detection-pit-compact.py")
    with tempfile.TemporaryDirectory(prefix="pit-compare-") as temporary:
        base = Path(temporary)
        root = base / "store"
        payload = wide_module.synthetic_fsd()
        payload_sha256 = hashlib.sha256(payload).hexdigest()
        relative = Path("blobs") / "sha256" / payload_sha256[:2] / f"{payload_sha256}.zip"
        (root / relative).parent.mkdir(parents=True)
        (root / relative).write_bytes(payload)
        (root / "STORE.json").write_text(
            json.dumps({"schema": "early-detection-raw-store/v1"}) + "\n", encoding="utf-8"
        )
        observation = {
            "schema": "early-detection-source-observation/v1",
            "sourceClass": "sec_financial_statement_dataset",
            "sourceUrl": "https://www.sec.gov/example.zip",
            "quarter": "2020q1",
            "observedAt": "2026-01-01T00:00:00.000Z",
            "payloadSha256": payload_sha256,
            "payloadBytes": len(payload),
            "payloadPath": relative.as_posix(),
            "qualityState": "accepted",
        }
        observation_path = root / "observations" / "sec-fsd" / "2020q1" / "test.json"
        observation_path.parent.mkdir(parents=True)
        observation_path.write_text(json.dumps(observation) + "\n", encoding="utf-8")
        wide_path = base / "wide.sqlite"
        compact_path = base / "compact.sqlite"
        wide_module.import_store(root, wide_path, full_verification=True)
        compact_module.import_store(root, compact_path)
        result = compare_databases(wide_path, compact_path, "2020q1", "2020q1")
        if result["payloadsCompared"] != 1:
            raise CompareError("comparison self-test payload count failed")
        return {
            "schema": "early-detection-pit-compare-self-test/v1",
            "status": "PASS",
            "payloadsCompared": result["payloadsCompared"],
            "manifestSha256": result["manifestSha256"],
        }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    compare = sub.add_parser("compare")
    compare.add_argument("--wide", type=Path, required=True)
    compare.add_argument("--compact", type=Path, required=True)
    compare.add_argument("--from-quarter")
    compare.add_argument("--to-quarter")
    sub.add_parser("self-test")
    return parser


def main() -> int:
    args = build_parser().parse_args()
    try:
        result = self_test() if args.command == "self-test" else compare_databases(
            args.wide, args.compact, args.from_quarter, args.to_quarter
        )
        print(json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True))
        return 0
    except (CompareError, OSError, ValueError, json.JSONDecodeError, sqlite3.Error) as exc:
        print(f"[early-detection-pit-compare] {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

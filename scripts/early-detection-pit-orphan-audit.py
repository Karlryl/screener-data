#!/usr/bin/env python3
"""Audit quarantined SEC FSD rows whose foreign submission is absent."""

from __future__ import annotations

import argparse
import hashlib
import json
import sqlite3
import sys
import tempfile
from collections import Counter
from pathlib import Path
from typing import Any


SCHEMA = "early-detection-pit-orphan-audit/v1"


class OrphanAuditError(RuntimeError):
    """The orphan quarantine cannot be proven lossless."""


def canonical_bytes(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def canonical_sha256(value: Any) -> str:
    return hashlib.sha256(canonical_bytes(value)).hexdigest()


def audit_connection(connection: sqlite3.Connection, database: str) -> dict[str, Any]:
    schema = connection.execute("SELECT value FROM meta WHERE key='schema'").fetchone()
    if schema is None or schema[0] != "early-detection-pit-compact-sqlite/v1":
        raise OrphanAuditError("database is not a compact PIT v1 ledger")
    payloads = connection.execute(
        """
        SELECT p.payload_id,p.quarter,p.payload_sha256,o.rows,o.rows_sha256
          FROM source_payloads p JOIN payload_orphan_stats o USING(payload_id)
         WHERE o.rows>0 ORDER BY p.quarter,p.payload_sha256
        """
    ).fetchall()
    issues: list[str] = []
    details = []
    total = 0
    member_counts: Counter[str] = Counter()
    reason_counts: Counter[str] = Counter()
    foreign_counts: Counter[str] = Counter()
    for payload_id, quarter, payload_sha256, expected_rows, expected_hash in payloads:
        rows = connection.execute(
            """
            SELECT member,row_number,foreign_key,reason,row_json,row_sha256
              FROM orphan_rows WHERE payload_id=?
             ORDER BY CASE member WHEN 'num.txt' THEN 1 WHEN 'pre.txt' THEN 2 ELSE 9 END,row_number
            """,
            (payload_id,),
        ).fetchall()
        sequence = hashlib.sha256()
        for member, row_number, foreign_key, reason, row_json, row_hash in rows:
            try:
                parsed = json.loads(row_json)
            except json.JSONDecodeError:
                issues.append(f"invalid_row_json:{payload_sha256}:{member}:{row_number}")
                continue
            actual_row_hash = hashlib.sha256(canonical_bytes(parsed)).digest()
            if actual_row_hash != row_hash:
                issues.append(f"row_hash:{payload_sha256}:{member}:{row_number}")
            sequence.update(row_hash)
            member_counts[member] += 1
            reason_counts[reason] += 1
            foreign_counts[foreign_key] += 1
        if len(rows) != expected_rows:
            issues.append(f"row_count:{payload_sha256}:expected={expected_rows}:actual={len(rows)}")
        if sequence.digest() != expected_hash:
            issues.append(f"sequence_hash:{payload_sha256}")
        total += len(rows)
        details.append({
            "quarter": quarter,
            "payloadSha256": payload_sha256,
            "rows": len(rows),
            "sequenceSha256": sequence.hexdigest(),
        })
    usable_overlap = connection.execute(
        """
        SELECT COUNT(*) FROM orphan_rows o
        JOIN submissions s ON s.payload_id=o.payload_id AND s.adsh=o.foreign_key
        """
    ).fetchone()[0]
    if usable_overlap:
        issues.append(f"orphan_now_has_submission:{usable_overlap}")
    report: dict[str, Any] = {
        "schema": SCHEMA,
        "status": "PASS_QUARANTINED_SOURCE_INCONSISTENCY" if not issues else "FAIL",
        "database": database,
        "payloadsWithOrphans": len(payloads),
        "orphanRows": total,
        "memberCounts": dict(sorted(member_counts.items())),
        "reasonCounts": dict(sorted(reason_counts.items())),
        "distinctMissingAccessions": len(foreign_counts),
        "topMissingAccessions": [
            {"accession": key, "rows": value}
            for key, value in sorted(foreign_counts.items(), key=lambda item: (-item[1], item[0]))[:25]
        ],
        "payloadEvidence": details,
        "hashVerification": "PASS" if not any(issue.startswith(("row_hash", "sequence_hash", "row_count", "invalid_row_json")) for issue in issues) else "FAIL",
        "usableTableOverlap": usable_overlap,
        "issues": issues,
        "decision": "Rows remain preserved in the immutable raw ZIP and the hash-bound orphan table, but are excluded from facts and presentations because their filing identity has no same-payload submission evidence.",
        "confirmatoryUseAllowed": False,
    }
    report["reportSha256"] = canonical_sha256(report)
    return report


def audit(database: Path) -> dict[str, Any]:
    resolved = database.expanduser().resolve()
    if not resolved.is_file():
        raise OrphanAuditError(f"database does not exist: {resolved}")
    connection = sqlite3.connect(f"file:{resolved.as_posix()}?mode=ro", uri=True)
    try:
        return audit_connection(connection, str(resolved))
    finally:
        connection.close()


def self_test() -> dict[str, Any]:
    with tempfile.TemporaryDirectory() as temporary:
        path = Path(temporary) / "fixture.sqlite"
        connection = sqlite3.connect(path)
        connection.executescript(
            """
            CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT);
            INSERT INTO meta VALUES('schema','early-detection-pit-compact-sqlite/v1');
            CREATE TABLE source_payloads(payload_id INTEGER PRIMARY KEY,quarter TEXT,payload_sha256 TEXT);
            CREATE TABLE submissions(payload_id INTEGER,adsh TEXT);
            CREATE TABLE orphan_rows(payload_id INTEGER,member TEXT,row_number INTEGER,foreign_key TEXT,reason TEXT,row_json TEXT,row_sha256 BLOB);
            CREATE TABLE payload_orphan_stats(payload_id INTEGER,rows INTEGER,rows_sha256 BLOB);
            INSERT INTO source_payloads VALUES(1,'2013q1','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
            """
        )
        row = {"adsh": "missing", "tag": "Revenues"}
        row_hash = hashlib.sha256(canonical_bytes(row)).digest()
        sequence = hashlib.sha256(row_hash).digest()
        connection.execute("INSERT INTO orphan_rows VALUES(?,?,?,?,?,?,?)", (1, "num.txt", 1, "missing", "missing_submission", canonical_bytes(row).decode("utf-8"), row_hash))
        connection.execute("INSERT INTO payload_orphan_stats VALUES(?,?,?)", (1, 1, sequence))
        connection.commit()
        result = audit_connection(connection, str(path))
        connection.close()
        if result["status"] != "PASS_QUARANTINED_SOURCE_INCONSISTENCY" or result["orphanRows"] != 1:
            raise OrphanAuditError("self-test did not preserve the orphan row")
        return {"status": "PASS", "orphanRows": 1, "hashVerification": result["hashVerification"]}


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    run = sub.add_parser("audit")
    run.add_argument("--database", type=Path, required=True)
    run.add_argument("--output", type=Path, required=True)
    sub.add_parser("self-test")
    return parser


def main() -> int:
    args = build_parser().parse_args()
    try:
        if args.command == "self-test":
            result = self_test()
        else:
            result = audit(args.database)
            output = args.output.expanduser().resolve()
            output.parent.mkdir(parents=True, exist_ok=True)
            output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(json.dumps(result if args.command == "self-test" else {
            "status": result["status"], "orphanRows": result["orphanRows"],
            "payloadsWithOrphans": result["payloadsWithOrphans"], "reportSha256": result["reportSha256"],
        }, indent=2))
        return 0 if result["status"].startswith("PASS") else 1
    except (OrphanAuditError, OSError, sqlite3.Error, json.JSONDecodeError) as exc:
        print(f"[early-detection-pit-orphan-audit] {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

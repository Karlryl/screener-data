#!/usr/bin/env python3
"""Run a full integrity audit of the compact point-in-time SEC FSD ledger."""

from __future__ import annotations

import argparse
import hashlib
import json
import sqlite3
import tempfile
import zipfile
from pathlib import Path
from typing import Any, Iterable


SCHEMA = "early-detection-pit-compact-sqlite/v1"
REPORT_SCHEMA = "early-detection-pit-compact-integrity/v1"


class IntegrityAuditError(RuntimeError):
    """The compact SEC ledger failed its integrity contract."""


def canonical_sha256(value: Any) -> str:
    raw = json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def digest_blobs(rows: Iterable[tuple[bytes]]) -> str:
    digest = hashlib.sha256()
    for row in rows:
        value = row[0]
        if not isinstance(value, bytes) or len(value) != 32:
            raise IntegrityAuditError("row digest is not a 32-byte SHA-256 blob")
        digest.update(value)
    return digest.hexdigest()


def observation_hashes(data_root: Path) -> dict[str, str]:
    base = data_root / "observations" / "sec-fsd"
    result: dict[str, str] = {}
    if not base.exists():
        return result
    for path in sorted(base.rglob("*.json")):
        digest = sha256_file(path)
        result[digest] = str(path.relative_to(data_root)).replace("\\", "/")
    return result


def audit(data_root: Path, database: Path, full_row_digests: bool = True) -> dict[str, Any]:
    root = data_root.expanduser().resolve()
    db = database.expanduser().resolve()
    if not db.is_file():
        raise IntegrityAuditError(f"compact SEC database missing: {db}")
    connection = sqlite3.connect(f"file:{db.as_posix()}?mode=ro", uri=True)
    issues: list[str] = []
    payload_evidence: list[dict[str, Any]] = []
    observations = observation_hashes(root)
    try:
        connection.execute("PRAGMA query_only=ON")
        schema = connection.execute("SELECT value FROM meta WHERE key='schema'").fetchone()
        if schema is None or schema[0] != SCHEMA:
            issues.append("schema_mismatch")
        integrity_rows = [str(row[0]) for row in connection.execute("PRAGMA integrity_check")]
        if integrity_rows != ["ok"]:
            issues.extend(f"sqlite_integrity:{value}" for value in integrity_rows[:20])
        foreign_keys = list(connection.execute("PRAGMA foreign_key_check"))
        if foreign_keys:
            issues.append(f"foreign_key_violations:{len(foreign_keys)}")
        payloads = connection.execute(
            """SELECT p.payload_id,p.quarter,p.payload_sha256,p.payload_path,p.payload_bytes,
                      hex(p.observation_sha256),s.submissions,s.facts,s.presentations,s.tags,
                      hex(s.submission_rows_sha256),hex(s.fact_rows_sha256),
                      hex(s.presentation_rows_sha256),hex(s.tag_rows_sha256),
                      o.rows,hex(o.rows_sha256)
               FROM source_payloads p JOIN payload_stats s USING(payload_id)
               JOIN payload_orphan_stats o USING(payload_id)
               ORDER BY p.quarter,p.observed_at,p.payload_sha256"""
        ).fetchall()
        for row in payloads:
            (
                payload_id, quarter, payload_sha, payload_path_raw, payload_bytes, observation_sha,
                expected_submissions, expected_facts, expected_presentations, expected_tags,
                expected_submission_sha, expected_fact_sha, expected_presentation_sha, expected_tag_sha,
                expected_orphans, expected_orphan_sha,
            ) = row
            item_issues: list[str] = []
            payload_path = root / str(payload_path_raw)
            if not payload_path.is_file():
                item_issues.append("payload_missing")
            else:
                if payload_path.stat().st_size != int(payload_bytes):
                    item_issues.append("payload_bytes")
                if sha256_file(payload_path) != payload_sha:
                    item_issues.append("payload_sha256")
                try:
                    with zipfile.ZipFile(payload_path) as archive:
                        bad_member = archive.testzip()
                    if bad_member is not None:
                        item_issues.append(f"zip_crc:{bad_member}")
                except zipfile.BadZipFile:
                    item_issues.append("zip_invalid")
            if str(observation_sha).lower() not in observations:
                item_issues.append("observation_sha256")
            count_specs = [
                ("submissions", expected_submissions, "submissions"),
                ("facts", expected_facts, "facts"),
                ("presentations", expected_presentations, "presentations"),
                ("tags", expected_tags, "payload_tags"),
                ("orphans", expected_orphans, "orphan_rows"),
            ]
            counts: dict[str, int] = {}
            for label, expected, table in count_specs:
                actual = int(connection.execute(f"SELECT COUNT(*) FROM {table} WHERE payload_id=?", (payload_id,)).fetchone()[0])
                counts[label] = actual
                if actual != int(expected):
                    item_issues.append(f"count_{label}:{actual}!={expected}")
            row_digests: dict[str, str] | None = None
            if full_row_digests:
                row_digests = {
                    "submissions": digest_blobs(connection.execute(
                        "SELECT row_sha256 FROM submissions WHERE payload_id=? ORDER BY submission_id", (payload_id,)
                    )),
                    "facts": digest_blobs(connection.execute(
                        "SELECT row_sha256 FROM facts WHERE payload_id=? ORDER BY row_number", (payload_id,)
                    )),
                    "presentations": digest_blobs(connection.execute(
                        "SELECT row_sha256 FROM presentations WHERE payload_id=? ORDER BY row_number", (payload_id,)
                    )),
                    "tags": digest_blobs(connection.execute(
                        """SELECT d.row_sha256 FROM payload_tags p JOIN tag_definitions d USING(definition_id)
                           WHERE p.payload_id=? ORDER BY p.row_number""", (payload_id,)
                    )),
                    "orphans": digest_blobs(connection.execute(
                        """SELECT row_sha256 FROM orphan_rows WHERE payload_id=?
                           ORDER BY CASE member WHEN 'num.txt' THEN 0 WHEN 'pre.txt' THEN 1 ELSE 2 END,row_number""",
                        (payload_id,),
                    )),
                }
                expected_digests = {
                    "submissions": str(expected_submission_sha).lower(),
                    "facts": str(expected_fact_sha).lower(),
                    "presentations": str(expected_presentation_sha).lower(),
                    "tags": str(expected_tag_sha).lower(),
                    "orphans": str(expected_orphan_sha).lower(),
                }
                for label, actual in row_digests.items():
                    if actual != expected_digests[label]:
                        item_issues.append(f"row_digest_{label}")
            if item_issues:
                issues.extend(f"payload:{payload_sha}:{value}" for value in item_issues)
            payload_evidence.append({
                "payloadId": int(payload_id),
                "quarter": quarter,
                "payloadSha256": payload_sha,
                "payloadBytes": int(payload_bytes),
                "observationPath": observations.get(str(observation_sha).lower()),
                "counts": counts,
                "rowDigests": row_digests,
                "issues": item_issues,
            })
        table_counts = {
            table: int(connection.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0])
            for table in ("source_payloads", "submissions", "facts", "presentations", "payload_tags", "orphan_rows")
        }
    finally:
        connection.close()
    unsigned = {
        "schema": REPORT_SCHEMA,
        "status": "PASS_FULL_INTEGRITY" if not issues and full_row_digests else ("PASS_STRUCTURAL_ONLY" if not issues else "FAIL"),
        "database": str(db),
        "databaseBytes": db.stat().st_size,
        "dataRoot": str(root),
        "fullRowDigests": full_row_digests,
        "sqliteIntegrity": integrity_rows,
        "foreignKeyViolations": len(foreign_keys),
        "tableCounts": table_counts,
        "payloads": payload_evidence,
        "issues": issues,
        "productiveGqsModified": False,
    }
    unsigned["logicalEvidenceSha256"] = canonical_sha256({
        "tableCounts": table_counts,
        "payloads": payload_evidence,
    })
    return {**unsigned, "reportSha256": canonical_sha256(unsigned)}


def write_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def self_test() -> dict[str, Any]:
    with tempfile.TemporaryDirectory() as folder:
        root = Path(folder) / "store"
        blob = root / "blobs" / "fixture.zip"
        blob.parent.mkdir(parents=True)
        with zipfile.ZipFile(blob, "w", zipfile.ZIP_DEFLATED) as archive:
            archive.writestr("fixture.txt", b"fixture")
        observation = root / "observations" / "sec-fsd" / "2020q1" / "fixture.json"
        observation.parent.mkdir(parents=True)
        observation.write_text("{}\n", encoding="utf-8")
        database = Path(folder) / "fixture.sqlite"
        connection = sqlite3.connect(database)
        connection.executescript("""
            PRAGMA foreign_keys=ON;
            CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT);
            CREATE TABLE source_payloads(payload_id INTEGER PRIMARY KEY,payload_sha256 TEXT,quarter TEXT,observed_at_epoch INTEGER,observed_at TEXT,source_url TEXT,payload_path TEXT,payload_bytes INTEGER,observation_sha256 BLOB,imported_at TEXT);
            CREATE TABLE submissions(submission_id INTEGER PRIMARY KEY,payload_id INTEGER,row_sha256 BLOB,FOREIGN KEY(payload_id) REFERENCES source_payloads(payload_id));
            CREATE TABLE facts(payload_id INTEGER,row_number INTEGER,row_sha256 BLOB,FOREIGN KEY(payload_id) REFERENCES source_payloads(payload_id));
            CREATE TABLE presentations(payload_id INTEGER,row_number INTEGER,row_sha256 BLOB,FOREIGN KEY(payload_id) REFERENCES source_payloads(payload_id));
            CREATE TABLE tag_definitions(definition_id INTEGER PRIMARY KEY,row_sha256 BLOB);
            CREATE TABLE payload_tags(payload_id INTEGER,row_number INTEGER,definition_id INTEGER,FOREIGN KEY(payload_id) REFERENCES source_payloads(payload_id),FOREIGN KEY(definition_id) REFERENCES tag_definitions(definition_id));
            CREATE TABLE orphan_rows(payload_id INTEGER,member TEXT,row_number INTEGER,row_sha256 BLOB,FOREIGN KEY(payload_id) REFERENCES source_payloads(payload_id));
            CREATE TABLE payload_stats(payload_id INTEGER PRIMARY KEY,submissions INTEGER,facts INTEGER,presentations INTEGER,tags INTEGER,submission_rows_sha256 BLOB,fact_rows_sha256 BLOB,presentation_rows_sha256 BLOB,tag_rows_sha256 BLOB,FOREIGN KEY(payload_id) REFERENCES source_payloads(payload_id));
            CREATE TABLE payload_orphan_stats(payload_id INTEGER PRIMARY KEY,rows INTEGER,rows_sha256 BLOB,FOREIGN KEY(payload_id) REFERENCES source_payloads(payload_id));
        """)
        hashes = {name: hashlib.sha256(name.encode()).digest() for name in ("sub", "fact", "pre", "tag")}
        connection.execute("INSERT INTO meta VALUES('schema',?)", (SCHEMA,))
        connection.execute("INSERT INTO source_payloads VALUES(1,?,?,?,?,?,?,?,?,?)", (
            sha256_file(blob), "2020q1", 1, "2020-01-01T00:00:00Z", "https://example.test",
            "blobs/fixture.zip", blob.stat().st_size, bytes.fromhex(sha256_file(observation)), "now",
        ))
        connection.execute("INSERT INTO submissions VALUES(1,1,?)", (hashes["sub"],))
        connection.execute("INSERT INTO facts VALUES(1,1,?)", (hashes["fact"],))
        connection.execute("INSERT INTO presentations VALUES(1,1,?)", (hashes["pre"],))
        connection.execute("INSERT INTO tag_definitions VALUES(1,?)", (hashes["tag"],))
        connection.execute("INSERT INTO payload_tags VALUES(1,1,1)")
        digest = lambda value: hashlib.sha256(value).digest()
        connection.execute("INSERT INTO payload_stats VALUES(1,1,1,1,1,?,?,?,?)", tuple(digest(hashes[name]) for name in ("sub", "fact", "pre", "tag")))
        connection.execute("INSERT INTO payload_orphan_stats VALUES(1,0,?)", (hashlib.sha256().digest(),))
        connection.commit()
        connection.close()
        result = audit(root, database, True)
        repeated = audit(root, database, True)
        if result["status"] != "PASS_FULL_INTEGRITY" or result["reportSha256"] != repeated["reportSha256"]:
            raise IntegrityAuditError(f"self-test failed: {result['issues']}")
        return {"status": "PASS", "deterministic": True, "reportSha256": result["reportSha256"]}


def parser() -> argparse.ArgumentParser:
    value = argparse.ArgumentParser(description=__doc__)
    sub = value.add_subparsers(dest="command", required=True)
    audit_parser = sub.add_parser("audit")
    audit_parser.add_argument("--data-root", type=Path, required=True)
    audit_parser.add_argument("--database", type=Path, required=True)
    audit_parser.add_argument("--output", type=Path, required=True)
    audit_parser.add_argument("--skip-row-digests", action="store_true")
    sub.add_parser("self-test")
    return value


def main() -> int:
    args = parser().parse_args()
    if args.command == "self-test":
        result = self_test()
        summary = result
    else:
        result = audit(args.data_root, args.database, not args.skip_row_digests)
        write_json(args.output, result)
        summary = {
            "status": result["status"],
            "payloads": len(result["payloads"]),
            "issues": len(result["issues"]),
            "logicalEvidenceSha256": result["logicalEvidenceSha256"],
            "reportSha256": result["reportSha256"],
            "output": str(args.output),
        }
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0 if result["status"].startswith("PASS") else 2


if __name__ == "__main__":
    raise SystemExit(main())

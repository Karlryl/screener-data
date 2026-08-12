#!/usr/bin/env python3
"""Build an outcome-blind SEC document-retrieval queue from frozen event metadata."""
from __future__ import annotations

import argparse
import hashlib
import json
import sqlite3
import os
import re
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "research" / "early-detection-v4" / "sec-terminal-wealth-queue-contract-v2.json"


def raw(path: Path) -> bytes:
    value = path.read_bytes()
    if value.startswith(b"\xef\xbb\xbf"):
        raise ValueError("BOM forbidden")
    return value


def canonical(value) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(8 * 1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def file_state(path: Path) -> tuple[int, int]:
    status = path.stat()
    return status.st_size, status.st_mtime_ns


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--database", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    contract = json.loads(raw(CONTRACT))
    report_path = ROOT / contract["input"]["reportPath"]
    report = json.loads(raw(report_path))
    if hashlib.sha256(raw(report_path)).hexdigest() != contract["input"]["reportRawSha256"]:
        raise ValueError("input report raw hash changed")
    if report["reportSha256"] != contract["input"]["reportCanonicalSha256"]:
        raise ValueError("input report canonical hash changed")
    database = Path(args.database).resolve()
    if str(database) != str(Path(report["database"]).resolve()):
        raise ValueError("database path differs from bound report")
    before = file_state(database)
    if before[0] != contract["input"]["databaseBytes"] or file_sha256(database) != contract["input"]["databaseRawSha256"]:
        raise ValueError("database byte binding changed")
    if file_state(database) != before:
        raise ValueError("database changed during initial hash")
    connection = sqlite3.connect(f"file:{database.as_posix()}?mode=ro", uri=True)
    if connection.execute("PRAGMA quick_check").fetchone()[0] != "ok":
        raise ValueError("database quick_check failed")
    if connection.execute("SELECT value FROM meta WHERE key='schema'").fetchone() != ("early-detection-sec-corporate-action-candidates/v1",):
        raise ValueError("database schema marker changed")
    sequence = hashlib.sha256()
    for sequence_row in connection.execute("""
      SELECT e.source_payload_sha256,e.source_row_number,e.event_class,e.cik,e.company_name,e.form,e.filed_date,
             COALESCE(e.accession,''),e.filing_path,COALESCE(b.ticker,''),COALESCE(b.first_snapshot,''),
             COALESCE(b.last_snapshot,''),COALESCE(b.snapshot_count,0)
      FROM events e LEFT JOIN bridge_links b USING(event_id)
      ORDER BY e.filed_date,e.cik,e.form,e.source_payload_sha256,e.source_row_number,b.ticker
    """):
        sequence.update(canonical(list(sequence_row)) + b"\n")
    if sequence.hexdigest() != contract["input"]["eventSequenceSha256"]:
        raise ValueError("event sequence binding changed")
    rows = connection.execute("""
      SELECT e.event_id,e.event_class,e.cik,e.company_name,e.form,e.filed_date,e.accession,e.filing_path,
             e.source_payload_sha256,e.source_observed_at,e.source_row_number,COUNT(b.ticker) AS bridge_link_count
      FROM events e LEFT JOIN bridge_links b ON b.event_id=e.event_id
      GROUP BY e.event_id
    """).fetchall()
    connection.close()
    after_query = file_state(database)
    if after_query != before or file_sha256(database) != contract["input"]["databaseRawSha256"] or file_state(database) != after_query:
        raise ValueError("database changed during extraction")
    if len(rows) != contract["input"]["expectedEvents"]:
        raise ValueError("event denominator changed")
    classes = contract["documentClasses"]
    queue = []
    for row in rows:
        event_id,event_class,cik,name,form,filed,accession,filing_path,payload_sha,observed_at,row_number,links = row
        if event_class not in classes:
            raise ValueError("unexpected event class")
        if not re.fullmatch(r"[0-9a-f]{64}", payload_sha) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", filed):
            raise ValueError("event source/date binding malformed")
        if accession is not None and not re.fullmatch(r"\d{10}-\d{2}-\d{6}", accession):
            raise ValueError("accession malformed")
        queue.append({
            "rowId": f"SEC-TW-{event_id:08d}", "eventClass": event_class, "cik": f"{cik:010d}",
            "companyName": name, "form": form, "filedDate": filed, "accession": accession,
            "filingPath": filing_path, "sourcePayloadSha256": payload_sha, "sourceObservedAt": observed_at,
            "sourceRowNumber": row_number, "bridgeLinkCount": links, "documentClasses": classes[event_class],
            "resolutionState": "UNRESOLVED", "outcomesAccessed": False,
        })
    queue.sort(key=lambda item: (
        item["accession"] is None, -item["bridgeLinkCount"], item["eventClass"], item["filedDate"],
        item["cik"], item["accession"] or "", item["rowId"],
    ))
    units = [(item["cik"], item["accession"], item["eventClass"], item["filedDate"]) for item in queue]
    if len(units) != len(set(units)):
        raise ValueError("queue unit is not unique")
    for index, item in enumerate(queue, 1):
        item["priorityRank"] = index
    form25_count = sum(x["eventClass"] == "DELISTING_FORM25_CANDIDATE" for x in queue)
    form15_count = sum(x["eventClass"] == "DEREGISTRATION_FORM15_CANDIDATE" for x in queue)
    if form25_count != contract["input"]["expectedForm25Family"] or form15_count != contract["input"]["expectedForm15Family"]:
        raise ValueError("event-class denominators changed")
    payload = {
        "schema": "early-detection-sec-terminal-wealth-queue/v1",
        "contractRawSha256": hashlib.sha256(raw(CONTRACT)).hexdigest(),
        "inputReportRawSha256": contract["input"]["reportRawSha256"],
        "inputDatabaseRawSha256": contract["input"]["databaseRawSha256"],
        "inputEventSequenceSha256": contract["input"]["eventSequenceSha256"],
        "counts": {
            "rows": len(queue),
            "form25Family": form25_count,
            "form15Family": form15_count,
            "unresolved": len(queue), "resolved": 0,
        },
        "claimLocks": contract["claimLocks"], "rows": queue,
    }
    payload["reportSha256"] = hashlib.sha256(canonical(payload)).hexdigest()
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True, indent=2).encode() + b"\n"
    temp_path = None
    try:
        with tempfile.NamedTemporaryFile(mode="wb", dir=output.parent, prefix=output.name + ".", suffix=".tmp", delete=False) as handle:
            temp_path = Path(handle.name)
            handle.write(encoded)
            handle.flush()
            os.fsync(handle.fileno())
        os.link(temp_path, output)
    except FileExistsError as exc:
        raise ValueError("output already exists") from exc
    finally:
        if temp_path is not None and temp_path.exists():
            temp_path.unlink()
    if output.read_bytes() != encoded:
        raise ValueError("output readback mismatch")
    print(json.dumps({"status":"PASS", "rows":len(queue), "reportSha256":payload["reportSha256"], "outcomesAccessed":False}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

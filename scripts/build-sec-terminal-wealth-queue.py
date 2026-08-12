#!/usr/bin/env python3
"""Build an outcome-blind SEC document-retrieval queue from frozen event metadata."""
from __future__ import annotations

import argparse
import hashlib
import json
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "research" / "early-detection-v4" / "sec-terminal-wealth-queue-contract-v1.json"


def raw(path: Path) -> bytes:
    value = path.read_bytes()
    if value.startswith(b"\xef\xbb\xbf"):
        raise ValueError("BOM forbidden")
    return value


def canonical(value) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()


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
    connection = sqlite3.connect(f"file:{database.as_posix()}?mode=ro", uri=True)
    rows = connection.execute("""
      SELECT e.event_id,e.event_class,e.cik,e.company_name,e.form,e.filed_date,e.accession,e.filing_path,
             e.source_payload_sha256,e.source_observed_at,e.source_row_number,COUNT(b.ticker) AS bridge_link_count
      FROM events e LEFT JOIN bridge_links b ON b.event_id=e.event_id
      GROUP BY e.event_id ORDER BY e.event_class,e.filed_date,e.cik,COALESCE(e.accession,''),e.event_id
    """).fetchall()
    connection.close()
    if len(rows) != contract["input"]["expectedEvents"]:
        raise ValueError("event denominator changed")
    classes = contract["documentClasses"]
    queue = []
    for row in rows:
        event_id,event_class,cik,name,form,filed,accession,filing_path,payload_sha,observed_at,row_number,links = row
        if event_class not in classes:
            raise ValueError("unexpected event class")
        queue.append({
            "rowId": f"SEC-TW-{event_id:08d}", "eventClass": event_class, "cik": f"{cik:010d}",
            "companyName": name, "form": form, "filedDate": filed, "accession": accession,
            "filingPath": filing_path, "sourcePayloadSha256": payload_sha, "sourceObservedAt": observed_at,
            "sourceRowNumber": row_number, "bridgeLinkCount": links, "documentClasses": classes[event_class],
            "resolutionState": "UNRESOLVED", "outcomesAccessed": False,
        })
    payload = {
        "schema": "early-detection-sec-terminal-wealth-queue/v1",
        "contractRawSha256": hashlib.sha256(raw(CONTRACT)).hexdigest(),
        "inputReportRawSha256": contract["input"]["reportRawSha256"],
        "counts": {
            "rows": len(queue),
            "form25Family": sum(x["eventClass"] == "DELISTING_FORM25_CANDIDATE" for x in queue),
            "form15Family": sum(x["eventClass"] == "DEREGISTRATION_FORM15_CANDIDATE" for x in queue),
            "unresolved": len(queue), "resolved": 0,
        },
        "claimLocks": contract["claimLocks"], "rows": queue,
    }
    payload["reportSha256"] = hashlib.sha256(canonical(payload)).hexdigest()
    output = Path(args.output)
    if output.exists():
        raise ValueError("output already exists")
    output.write_bytes(json.dumps(payload, ensure_ascii=False, sort_keys=True, indent=2).encode() + b"\n")
    print(json.dumps({"status":"PASS", "rows":len(queue), "reportSha256":payload["reportSha256"], "outcomesAccessed":False}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

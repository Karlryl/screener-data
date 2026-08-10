#!/usr/bin/env python3
"""Build a fail-closed SEC Form 25/15 corporate-action candidate ledger."""

from __future__ import annotations

import argparse
import hashlib
import json
import sqlite3
import tempfile
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any


SCHEMA = "early-detection-sec-corporate-action-candidates/v1"


class CorporateActionError(RuntimeError):
    """Corporate-action candidate construction failed closed."""


def canonical_bytes(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def candidate_links(bridge: sqlite3.Connection) -> dict[int, list[dict[str, Any]]]:
    grouped: dict[tuple[int, str], list[str]] = defaultdict(list)
    for observed_at, ticker, ciks_json in bridge.execute(
        """SELECT s.observed_at,c.ticker,c.candidate_ciks_json
           FROM candidates c JOIN snapshots s USING(snapshot_id)
           WHERE c.status='CANDIDATE_UNADJUDICATED'
           ORDER BY s.observed_at,c.ticker"""
    ):
        ciks = json.loads(ciks_json)
        if not isinstance(ciks, list) or len(ciks) != 1 or not isinstance(ciks[0], int):
            raise CorporateActionError("unique bridge candidate does not contain exactly one integer CIK")
        grouped[(ciks[0], ticker)].append(observed_at)
    result: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for (cik, ticker), observations in sorted(grouped.items()):
        result[cik].append({
            "ticker": ticker,
            "firstSnapshot": min(observations),
            "lastSnapshot": max(observations),
            "snapshotCount": len(observations),
        })
    return result


def event_class(form: str) -> str | None:
    if form == "25" or form.startswith("25-") or form.startswith("25/"):
        return "DELISTING_FORM25_CANDIDATE"
    if form.startswith("15-") or form.startswith("15F-"):
        return "DEREGISTRATION_FORM15_CANDIDATE"
    return None


def initialize(connection: sqlite3.Connection) -> None:
    connection.executescript("""
        PRAGMA journal_mode=WAL;
        CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS events(
          event_id INTEGER PRIMARY KEY,
          source_payload_sha256 TEXT NOT NULL,
          source_observed_at TEXT NOT NULL,
          source_row_number INTEGER NOT NULL,
          event_class TEXT NOT NULL,
          cik INTEGER NOT NULL,
          company_name TEXT NOT NULL,
          form TEXT NOT NULL,
          filed_date TEXT NOT NULL,
          accession TEXT,
          filing_path TEXT NOT NULL,
          UNIQUE(source_payload_sha256,source_row_number)
        );
        CREATE TABLE IF NOT EXISTS bridge_links(
          event_id INTEGER NOT NULL REFERENCES events(event_id),
          ticker TEXT NOT NULL,
          first_snapshot TEXT NOT NULL,
          last_snapshot TEXT NOT NULL,
          snapshot_count INTEGER NOT NULL,
          PRIMARY KEY(event_id,ticker)
        );
        CREATE INDEX IF NOT EXISTS events_cik_date ON events(cik,filed_date);
        CREATE INDEX IF NOT EXISTS events_class_date ON events(event_class,filed_date);
    """)
    schema = connection.execute("SELECT value FROM meta WHERE key='schema'").fetchone()
    if schema is None:
        connection.execute("INSERT INTO meta VALUES('schema',?)", (SCHEMA,))
    elif schema[0] != SCHEMA:
        raise CorporateActionError(f"candidate ledger schema changed: {schema[0]}")


def build(edgar_database: Path, bridge_database: Path, output_database: Path, report_path: Path) -> dict[str, Any]:
    edgar_path = edgar_database.expanduser().resolve()
    bridge_path = bridge_database.expanduser().resolve()
    output_path = output_database.expanduser().resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    edgar = sqlite3.connect(f"file:{edgar_path.as_posix()}?mode=ro", uri=True)
    bridge = sqlite3.connect(f"file:{bridge_path.as_posix()}?mode=ro", uri=True)
    output = sqlite3.connect(output_path)
    try:
        edgar_schema = edgar.execute("SELECT COUNT(*) FROM payloads").fetchone()
        bridge_schema = bridge.execute("SELECT value FROM meta WHERE key='schema'").fetchone()
        if edgar_schema is None or bridge_schema is None or bridge_schema[0] != "early-detection-entity-bridge/v2":
            raise CorporateActionError("input database identity failed")
        links = candidate_links(bridge)
        initialize(output)
        rows = edgar.execute(
            """SELECT p.payload_sha256,p.observed_at,f.row_number,f.cik,f.company_name,
                      f.form,f.filed_date,f.accession,f.filename
               FROM filings f JOIN payloads p USING(payload_id)
               WHERE f.form='25' OR f.form LIKE '25-%' OR f.form LIKE '25/%'
                  OR f.form LIKE '15-%' OR f.form LIKE '15F-%'
               ORDER BY f.filed_date,f.cik,f.form,p.payload_sha256,f.row_number"""
        ).fetchall()
        with output:
            output.execute("DELETE FROM bridge_links")
            output.execute("DELETE FROM events")
            for values in rows:
                classification = event_class(str(values[5]))
                if classification is None:
                    raise CorporateActionError(f"unclassified SEC exit form: {values[5]}")
                cursor = output.execute(
                    "INSERT INTO events VALUES(NULL,?,?,?,?,?,?,?,?,?,?)",
                    (values[0], values[1], values[2], classification, values[3], values[4], values[5], values[6], values[7], values[8]),
                )
                event_id = int(cursor.lastrowid)
                for link in links.get(int(values[3]), []):
                    output.execute(
                        "INSERT INTO bridge_links VALUES(?,?,?,?,?)",
                        (event_id, link["ticker"], link["firstSnapshot"], link["lastSnapshot"], link["snapshotCount"]),
                    )
        integrity = output.execute("PRAGMA quick_check").fetchone()[0]
        counts = dict(output.execute("SELECT event_class,COUNT(*) FROM events GROUP BY event_class ORDER BY event_class").fetchall())
        linked_events = int(output.execute("SELECT COUNT(DISTINCT event_id) FROM bridge_links").fetchone()[0])
        linked_tickers = int(output.execute("SELECT COUNT(DISTINCT ticker) FROM bridge_links").fetchone()[0])
        hasher = hashlib.sha256()
        for row in output.execute(
            """SELECT e.source_payload_sha256,e.source_row_number,e.event_class,e.cik,e.company_name,
                      e.form,e.filed_date,COALESCE(e.accession,''),e.filing_path,
                      COALESCE(b.ticker,''),COALESCE(b.first_snapshot,''),COALESCE(b.last_snapshot,''),COALESCE(b.snapshot_count,0)
               FROM events e LEFT JOIN bridge_links b USING(event_id)
               ORDER BY e.filed_date,e.cik,e.form,e.source_payload_sha256,e.source_row_number,b.ticker"""
        ):
            hasher.update(canonical_bytes(list(row)) + b"\n")
        output.execute("PRAGMA journal_mode=DELETE").fetchone()
    finally:
        edgar.close()
        bridge.close()
        output.close()
    if integrity != "ok":
        raise CorporateActionError(f"candidate ledger quick_check failed: {integrity}")
    total = sum(int(value) for value in counts.values())
    unsigned = {
        "schema": SCHEMA,
        "status": "EVENT_CANDIDATE_LEDGER_PASS_ORIGINAL_FILINGS_PENDING",
        "database": str(output_path),
        "databaseBytes": output_path.stat().st_size,
        "edgarDatabase": str(edgar_path),
        "bridgeDatabase": str(bridge_path),
        "events": total,
        "byClass": counts,
        "linkedEvents": linked_events,
        "linkedEventRate": linked_events / total if total else 0,
        "linkedTickers": linked_tickers,
        "eventSequenceSha256": hasher.hexdigest(),
        "confirmatoryEligible": False,
        "limitations": [
            "Filed date is a locator date, not the exchange-effective date or exact SEC acceptance timestamp.",
            "Every event remains a candidate until its original Form 25/15 submission is captured and parsed.",
            "A current-name or sparse-snapshot ticker link is not a permanent security identity.",
            "The ledger contains no delisting return or post-delisting price continuation.",
        ],
        "productiveGqsModified": False,
    }
    report = {**unsigned, "reportSha256": hashlib.sha256(canonical_bytes(unsigned)).hexdigest()}
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return report


def self_test() -> dict[str, Any]:
    with tempfile.TemporaryDirectory() as folder:
        root = Path(folder)
        edgar = sqlite3.connect(root / "edgar.sqlite")
        edgar.executescript("""
            CREATE TABLE payloads(payload_id INTEGER PRIMARY KEY,payload_sha256 TEXT,observed_at TEXT);
            CREATE TABLE filings(payload_id INTEGER,row_number INTEGER,cik INTEGER,company_name TEXT,form TEXT,filed_date TEXT,accession TEXT,filename TEXT);
            INSERT INTO payloads VALUES(1,'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','2021-01-01T00:00:00Z');
            INSERT INTO filings VALUES(1,1,7,'Example Inc','25-NSE','2020-01-02','0000000000-20-000001','edgar/data/7/example.txt');
            INSERT INTO filings VALUES(1,2,8,'Other Inc','15-12G','2020-01-03','0000000000-20-000002','edgar/data/8/other.txt');
        """)
        edgar.commit()
        edgar.close()
        bridge = sqlite3.connect(root / "bridge.sqlite")
        bridge.executescript("""
            CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT);
            INSERT INTO meta VALUES('schema','early-detection-entity-bridge/v2');
            CREATE TABLE snapshots(snapshot_id INTEGER PRIMARY KEY,observed_at TEXT);
            CREATE TABLE candidates(snapshot_id INTEGER,ticker TEXT,status TEXT,candidate_ciks_json TEXT);
            INSERT INTO snapshots VALUES(1,'2019-12-31T00:00:00Z');
            INSERT INTO candidates VALUES(1,'EXM','CANDIDATE_UNADJUDICATED','[7]');
        """)
        bridge.commit()
        bridge.close()
        output = root / "events.sqlite"
        first = build(root / "edgar.sqlite", root / "bridge.sqlite", output, root / "first.json")
        second = build(root / "edgar.sqlite", root / "bridge.sqlite", output, root / "second.json")
        if first["events"] != 2 or first["linkedEvents"] != 1 or first["reportSha256"] != second["reportSha256"]:
            raise CorporateActionError("self-test candidate ledger changed")
        return {"status": "PASS", "events": 2, "deterministic": True}


def parser() -> argparse.ArgumentParser:
    value = argparse.ArgumentParser(description=__doc__)
    sub = value.add_subparsers(dest="command", required=True)
    build_parser = sub.add_parser("build")
    build_parser.add_argument("--edgar-database", type=Path, required=True)
    build_parser.add_argument("--bridge-database", type=Path, required=True)
    build_parser.add_argument("--database", type=Path, required=True)
    build_parser.add_argument("--report", type=Path, required=True)
    sub.add_parser("self-test")
    return value


def main() -> int:
    args = parser().parse_args()
    result = self_test() if args.command == "self-test" else build(
        args.edgar_database, args.bridge_database, args.database, args.report,
    )
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

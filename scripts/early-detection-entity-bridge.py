#!/usr/bin/env python3
"""Build a fail-closed Nasdaq ticker-to-SEC-CIK candidate bridge.

This is a research aid, not a permanent identity ledger.  It matches an exact
archived exchange snapshot to SEC issuer names evidenced by as-filed FSD rows
and, when supplied, official EDGAR master-index filing locators.  Every
ambiguous or unmatched name stays explicit; no ticker is projected between
captures and no candidate is treated as production-equivalent.
"""

from __future__ import annotations

import argparse
import csv
import gzip
import hashlib
import io
import json
import re
import sqlite3
import tempfile
import unicodedata
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


SCHEMA = "early-detection-entity-bridge/v3"
OBSERVATION_SCHEMA = "early-detection-source-observation/v1"
CORPORATE_SUFFIXES = {
    "CO", "COMPANY", "CORP", "CORPORATION", "INC", "INCORPORATED", "LTD", "LIMITED",
    "LLC", "LP", "LLP", "PLC", "NV", "SA", "AG", "HOLDING", "HOLDINGS",
}
SECURITY_TAIL = re.compile(
    r"\b(?:CLASS\s+[A-Z0-9]+\s+)?(?:COMMON|ORDINARY|PREFERRED)\s+(?:STOCK|SHARES?)\b.*$"
)


class EntityBridgeError(RuntimeError):
    """The candidate identity bridge could not satisfy its fail-closed contract."""


def canonical_bytes(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def normalize_text(value: str) -> str:
    ascii_value = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode("ascii")
    return " ".join(re.findall(r"[A-Z0-9]+", ascii_value.upper()))


def issuer_core(value: str) -> str:
    normalized = normalize_text(SECURITY_TAIL.sub("", normalize_text(value)))
    words = normalized.split()
    while words and words[-1] in CORPORATE_SUFFIXES:
        words.pop()
    return " ".join(words)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def timestamp_epoch(value: str) -> int:
    return int(datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp())


def parse_listing_records(payload: bytes, dataset: str) -> list[dict[str, str]]:
    decoded_payload = payload
    if payload.startswith(b"\x1f\x8b"):
        try:
            decoded_payload = gzip.decompress(payload)
        except (EOFError, OSError) as exc:
            raise EntityBridgeError(f"listing gzip transport decoding failed: {exc}") from exc
    text = decoded_payload.decode("utf-8-sig", errors="replace")
    try:
        rows = list(csv.reader(io.StringIO(text, newline=""), delimiter="|"))
    except csv.Error as exc:
        raise EntityBridgeError(f"listing CSV parsing failed: {exc}") from exc
    if len(rows) < 2:
        raise EntityBridgeError("listing payload is empty")
    header = [value.strip() for value in rows[0]]
    symbol_column = "ACT Symbol" if "ACT Symbol" in header else "Symbol"
    for required in (symbol_column, "Security Name", "Test Issue"):
        if required not in header:
            raise EntityBridgeError(f"listing column missing: {required}")
    result: list[dict[str, str]] = []
    for values in rows[1:]:
        if not values or values[0].startswith("File Creation Time") or not any(value.strip() for value in values):
            continue
        if len(values) != len(header):
            raise EntityBridgeError(f"listing row width changed: {len(values)} != {len(header)}")
        row = dict(zip(header, (value.strip() for value in values)))
        symbol = row[symbol_column]
        if not symbol:
            raise EntityBridgeError("listing snapshot contains a blank symbol")
        result.append({
            "dataset": dataset,
            "ticker": symbol,
            "securityName": row["Security Name"],
            "exchange": row.get("Exchange", "NASDAQ" if dataset == "nasdaqlisted" else ""),
            "testIssue": row.get("Test Issue", ""),
            "etf": row.get("ETF", ""),
            "nextShares": row.get("NextShares", ""),
        })
    return result


def issuer_indexes(entities: list[dict[str, Any]]) -> tuple[dict[str, set[int]], dict[str, set[int]]]:
    strict: dict[str, set[int]] = defaultdict(set)
    core: dict[str, set[int]] = defaultdict(set)
    for entity in entities:
        cik = int(entity["cik"])
        strict[normalize_text(str(entity["name"]))].add(cik)
        normalized_core = issuer_core(str(entity["name"]))
        if normalized_core:
            core[normalized_core].add(cik)
    return strict, core


def candidate_for(record: dict[str, str], strict: dict[str, set[int]], core: dict[str, set[int]]) -> dict[str, Any]:
    if record["testIssue"] == "Y":
        return {"status": "EXCLUDE_TEST_ISSUE", "matchMethod": None, "candidateCiks": []}
    if record["etf"] == "Y" or record["nextShares"] == "Y":
        return {"status": "EXCLUDE_NON_OPERATING_SECURITY", "matchMethod": None, "candidateCiks": []}
    strict_candidates = sorted(strict.get(normalize_text(record["securityName"]), set()))
    if len(strict_candidates) == 1:
        return {"status": "CANDIDATE_UNADJUDICATED", "matchMethod": "strict_name", "candidateCiks": strict_candidates}
    if len(strict_candidates) > 1:
        return {"status": "AMBIGUOUS", "matchMethod": "strict_name", "candidateCiks": strict_candidates}
    core_candidates = sorted(core.get(issuer_core(record["securityName"]), set()))
    if len(core_candidates) == 1:
        return {"status": "CANDIDATE_UNADJUDICATED", "matchMethod": "unique_issuer_core", "candidateCiks": core_candidates}
    if len(core_candidates) > 1:
        return {"status": "AMBIGUOUS", "matchMethod": "unique_issuer_core", "candidateCiks": core_candidates}
    return {"status": "UNRESOLVED", "matchMethod": None, "candidateCiks": []}


def initialize(connection: sqlite3.Connection) -> None:
    connection.executescript(
        """
        PRAGMA foreign_keys=ON;
        PRAGMA journal_mode=WAL;
        CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS snapshots(
          snapshot_id INTEGER PRIMARY KEY,
          dataset TEXT NOT NULL,
          observed_at TEXT NOT NULL,
          observed_epoch INTEGER NOT NULL,
          payload_sha256 TEXT NOT NULL,
          payload_bytes INTEGER NOT NULL,
          source_root TEXT NOT NULL,
          observation_path TEXT NOT NULL,
          rows INTEGER NOT NULL,
          UNIQUE(dataset,observed_at,payload_sha256),
          UNIQUE(source_root,observation_path)
        );
        CREATE TABLE IF NOT EXISTS candidates(
          snapshot_id INTEGER NOT NULL REFERENCES snapshots(snapshot_id),
          row_number INTEGER NOT NULL,
          ticker TEXT NOT NULL,
          security_name TEXT NOT NULL,
          exchange_code TEXT,
          status TEXT NOT NULL,
          match_method TEXT,
          candidate_ciks_json TEXT NOT NULL,
          PRIMARY KEY(snapshot_id,row_number)
        );
        CREATE INDEX IF NOT EXISTS idx_bridge_ticker_time ON candidates(ticker,snapshot_id);
        CREATE INDEX IF NOT EXISTS idx_bridge_status ON candidates(status);
        """
    )
    row = connection.execute("SELECT value FROM meta WHERE key='schema'").fetchone()
    if row is None:
        connection.execute("INSERT INTO meta(key,value) VALUES('schema',?)", (SCHEMA,))
    elif row[0] != SCHEMA:
        raise EntityBridgeError(f"entity bridge schema changed: {row[0]}")


def latest_entities(sec: sqlite3.Connection, epoch: int) -> list[dict[str, Any]]:
    rows = sec.execute(
        """
        WITH ranked AS (
          SELECT cik,name,sic,accepted_at_epoch,
                 ROW_NUMBER() OVER(PARTITION BY cik ORDER BY accepted_at_epoch DESC,submission_id DESC) AS rn
          FROM submissions WHERE accepted_at_epoch<=?
        )
        SELECT cik,name,sic,accepted_at_epoch FROM ranked WHERE rn=1 ORDER BY cik
        """,
        (epoch,),
    ).fetchall()
    return [dict(row) for row in rows]


def historical_edgar_entities(edgar: sqlite3.Connection, epoch: int) -> list[dict[str, Any]]:
    cutoff = datetime.fromtimestamp(epoch, tz=timezone.utc).date().isoformat()
    rows = edgar.execute(
        """
        SELECT DISTINCT cik,company_name AS name
        FROM filings
        WHERE filed_date<=?
          AND (
            form LIKE '10-K%' OR form LIKE '10-Q%' OR form LIKE '8-K%'
            OR form LIKE '10-12%' OR form LIKE '20-F%' OR form LIKE '40-F%'
            OR form LIKE '6-K%' OR form LIKE 'S-1%' OR form LIKE 'S-3%'
            OR form LIKE 'S-4%' OR form LIKE '25%' OR form LIKE '15-%'
          )
        ORDER BY cik,company_name
        """,
        (cutoff,),
    ).fetchall()
    return [{"cik": int(row[0]), "name": str(row[1])} for row in rows]


def observation_paths(data_roots: list[Path]) -> list[tuple[Path, Path]]:
    result: list[tuple[Path, Path]] = []
    for data_root in data_roots:
        base = data_root / "observations" / "nasdaq-symbol-directory"
        if base.exists():
            result.extend((data_root, path) for path in base.rglob("*.json"))
    return sorted(result, key=lambda item: (str(item[0]).casefold(), str(item[1]).casefold()))


def import_snapshot(
    connection: sqlite3.Connection,
    sec: sqlite3.Connection,
    edgar: sqlite3.Connection | None,
    data_root: Path,
    observation_path: Path,
) -> dict[str, Any]:
    observation = json.loads(observation_path.read_text(encoding="utf-8"))
    if observation.get("schema") != OBSERVATION_SCHEMA or observation.get("sourceClass") != "nasdaq_symbol_directory_snapshot":
        raise EntityBridgeError(f"unexpected listing observation: {observation_path}")
    payload_path = data_root / Path(str(observation["payloadPath"]))
    if not payload_path.is_file() or sha256_file(payload_path) != observation["payloadSha256"]:
        raise EntityBridgeError(f"listing payload hash mismatch: {payload_path}")
    existing = connection.execute(
        """SELECT snapshot_id,rows FROM snapshots
           WHERE dataset=? AND observed_at=? AND payload_sha256=?""",
        (observation["sourceId"], observation["observedAt"], observation["payloadSha256"]),
    ).fetchone()
    if existing is not None:
        return {"dataset": observation["sourceId"], "status": "ALREADY_IMPORTED", "rows": int(existing[1])}
    collision = connection.execute(
        "SELECT payload_sha256 FROM snapshots WHERE dataset=? AND observed_at=?",
        (observation["sourceId"], observation["observedAt"]),
    ).fetchone()
    if collision is not None:
        raise EntityBridgeError(
            f"conflicting payloads for {observation['sourceId']} at {observation['observedAt']}"
        )
    records = parse_listing_records(payload_path.read_bytes(), str(observation["sourceId"]))
    epoch = timestamp_epoch(str(observation["observedAt"]))
    entities = latest_entities(sec, epoch)
    edgar_entities = historical_edgar_entities(edgar, epoch) if edgar is not None else []
    entities.extend(edgar_entities)
    strict, core = issuer_indexes(entities)
    with connection:
        cursor = connection.execute(
            """INSERT INTO snapshots(dataset,observed_at,observed_epoch,payload_sha256,payload_bytes,source_root,observation_path,rows)
               VALUES(?,?,?,?,?,?,?,?)""",
            (
                observation["sourceId"], observation["observedAt"], epoch, observation["payloadSha256"],
                observation["payloadBytes"], str(data_root.resolve()),
                str(observation_path.relative_to(data_root)).replace("\\", "/"), len(records),
            ),
        )
        snapshot_id = int(cursor.lastrowid)
        counts: Counter[str] = Counter()
        for row_number, record in enumerate(records, start=2):
            match = candidate_for(record, strict, core)
            counts[match["status"]] += 1
            connection.execute(
                "INSERT INTO candidates VALUES(?,?,?,?,?,?,?,?)",
                (
                    snapshot_id, row_number, record["ticker"], record["securityName"], record["exchange"] or None,
                    match["status"], match["matchMethod"], json.dumps(match["candidateCiks"], separators=(",", ":")),
                ),
            )
    return {
        "dataset": observation["sourceId"],
        "observedAt": observation["observedAt"],
        "status": "IMPORTED",
        "rows": len(records),
        "entitiesKnownAtCapture": len(entities),
        "edgarIssuerAliasesKnownAtCapture": len(edgar_entities),
        "byStatus": dict(sorted(counts.items())),
    }


def logical_manifest(connection: sqlite3.Connection) -> dict[str, Any]:
    counts = dict(connection.execute("SELECT status,COUNT(*) FROM candidates GROUP BY status ORDER BY status").fetchall())
    total = sum(counts.values())
    candidate_rows = int(counts.get("CANDIDATE_UNADJUDICATED", 0))
    hasher = hashlib.sha256()
    for row in connection.execute(
        """SELECT s.dataset,s.observed_at,s.payload_sha256,c.row_number,c.ticker,c.security_name,
                  c.exchange_code,c.status,c.match_method,c.candidate_ciks_json
           FROM candidates c JOIN snapshots s USING(snapshot_id)
           ORDER BY s.observed_at,s.dataset,c.row_number"""
    ):
        hasher.update(canonical_bytes(list(row)) + b"\n")
    snapshot_coverage = []
    for snapshot_id, dataset, observed_at, rows in connection.execute(
        "SELECT snapshot_id,dataset,observed_at,rows FROM snapshots ORDER BY observed_at,dataset"
    ):
        snapshot_counts = dict(connection.execute(
            "SELECT status,COUNT(*) FROM candidates WHERE snapshot_id=? GROUP BY status ORDER BY status",
            (snapshot_id,),
        ).fetchall())
        candidate_count = int(snapshot_counts.get("CANDIDATE_UNADJUDICATED", 0))
        snapshot_coverage.append({
            "dataset": dataset,
            "observedAt": observed_at,
            "rows": int(rows),
            "byStatus": snapshot_counts,
            "candidateRate": candidate_count / int(rows) if rows else 0.0,
        })
    return {
        "snapshots": int(connection.execute("SELECT COUNT(*) FROM snapshots").fetchone()[0]),
        "rows": total,
        "byStatus": counts,
        "candidateRate": candidate_rows / total if total else 0.0,
        "snapshotCoverage": snapshot_coverage,
        "candidateSequenceSha256": hasher.hexdigest(),
    }


def build(
    data_roots: list[Path],
    sec_database: Path,
    output_database: Path,
    report_path: Path,
    edgar_database: Path | None = None,
) -> dict[str, Any]:
    output_database.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(output_database)
    sec = sqlite3.connect(f"file:{sec_database.as_posix()}?mode=ro", uri=True)
    sec.row_factory = sqlite3.Row
    edgar = sqlite3.connect(f"file:{edgar_database.as_posix()}?mode=ro", uri=True) if edgar_database is not None else None
    try:
        initialize(connection)
        [
            import_snapshot(connection, sec, edgar, data_root, path)
            for data_root, path in observation_paths(data_roots)
        ]
        integrity = connection.execute("PRAGMA quick_check").fetchone()[0]
        manifest = logical_manifest(connection)
        connection.execute("PRAGMA journal_mode=DELETE").fetchone()
    finally:
        sec.close()
        if edgar is not None:
            edgar.close()
        connection.close()
    if integrity != "ok":
        raise EntityBridgeError(f"entity bridge quick_check failed: {integrity}")
    unsigned = {
        "schema": SCHEMA,
        "status": "CANDIDATE_BRIDGE_PASS_NOT_ADJUDICATED",
        "database": str(output_database.resolve()),
        "databaseBytes": output_database.stat().st_size,
        "evidenceSources": {
            "nasdaqSnapshotRoots": [str(path.resolve()) for path in data_roots],
            "secFsd": str(sec_database.resolve()),
            "secEdgarMasterIndex": str(edgar_database.resolve()) if edgar_database is not None else None,
        },
        **manifest,
        "confirmatoryEligible": False,
        "limitations": [
            "Name matching is a candidate generator and never establishes a permanent entity or listing identity.",
            "Snapshots are sparse exact captures and are never forward-filled between dates.",
            "EDGAR master indexes are filing locators; their issuer names add candidate aliases but not security identity.",
            "Every candidate still requires filing-cover, Form 25/15 or equivalent event evidence and independent audit.",
        ],
        "productiveGqsModified": False,
    }
    report = {**unsigned, "reportSha256": hashlib.sha256(canonical_bytes(unsigned)).hexdigest()}
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return report


def self_test() -> dict[str, Any]:
    entities = [{"cik": 1, "name": "Example Corporation"}, {"cik": 2, "name": "Twin Inc"}, {"cik": 3, "name": "Twin Corp"}]
    strict, core = issuer_indexes(entities)
    exact = candidate_for(
        {"securityName": "Example Corporation Common Stock", "testIssue": "N", "etf": "N", "nextShares": "N"},
        strict, core,
    )
    ambiguous = candidate_for(
        {"securityName": "Twin Company Common Stock", "testIssue": "N", "etf": "N", "nextShares": "N"},
        strict, core,
    )
    if exact["candidateCiks"] != [1] or exact["status"] != "CANDIDATE_UNADJUDICATED":
        raise EntityBridgeError("unique core self-test failed")
    if ambiguous["status"] != "AMBIGUOUS" or ambiguous["candidateCiks"] != [2, 3]:
        raise EntityBridgeError("ambiguous core self-test failed")
    with tempfile.TemporaryDirectory() as temporary:
        root = Path(temporary) / "store"
        payload_relative = Path("blobs") / "listing.txt"
        payload_path = root / payload_relative
        payload_path.parent.mkdir(parents=True)
        payload = (
            "Symbol|Security Name|Test Issue|Financial Status|Round Lot Size|ETF|NextShares\n"
            "EXM|Example Corporation Common Stock|N|N|100|N|N\n"
            "OLD|Former Holdings Common Stock|N|N|100|N|N\n"
            "File Creation Time: 2020010112:00||||||\n"
        ).encode("utf-8")
        payload_path.write_bytes(payload)
        observation_path = root / "observations" / "nasdaq-symbol-directory" / "nasdaqlisted" / "2020q1.json"
        observation_path.parent.mkdir(parents=True)
        observation_path.write_text(json.dumps({
            "schema": OBSERVATION_SCHEMA,
            "sourceClass": "nasdaq_symbol_directory_snapshot",
            "sourceId": "nasdaqlisted",
            "observedAt": "2020-01-01T12:00:00.000Z",
            "payloadSha256": hashlib.sha256(payload).hexdigest(),
            "payloadBytes": len(payload),
            "payloadPath": payload_relative.as_posix(),
        }), encoding="utf-8")
        sec_database = Path(temporary) / "sec.sqlite"
        sec = sqlite3.connect(sec_database)
        sec.execute("CREATE TABLE submissions(submission_id INTEGER,cik INTEGER,name TEXT,sic INTEGER,accepted_at_epoch INTEGER)")
        sec.execute("INSERT INTO submissions VALUES(1,1,'Example Corporation',3571,1577836800)")
        sec.commit()
        sec.close()
        edgar_database = Path(temporary) / "edgar.sqlite"
        edgar = sqlite3.connect(edgar_database)
        edgar.execute("CREATE TABLE filings(cik INTEGER,company_name TEXT,form TEXT,filed_date TEXT)")
        edgar.execute("INSERT INTO filings VALUES(2,'Former Holdings Inc','8-K','2019-12-31')")
        edgar.commit()
        edgar.close()
        bridge_database = Path(temporary) / "bridge.sqlite"
        second_root = Path(temporary) / "store-2"
        second_payload = gzip.compress(payload, mtime=0)
        second_relative = Path("blobs") / "listing.txt.gz"
        second_payload_path = second_root / second_relative
        second_payload_path.parent.mkdir(parents=True)
        second_payload_path.write_bytes(second_payload)
        second_observation_path = (
            second_root / "observations" / "nasdaq-symbol-directory" / "nasdaqlisted" / "2020q2.json"
        )
        second_observation_path.parent.mkdir(parents=True)
        second_observation_path.write_text(json.dumps({
            "schema": OBSERVATION_SCHEMA,
            "sourceClass": "nasdaq_symbol_directory_snapshot",
            "sourceId": "nasdaqlisted",
            "observedAt": "2020-04-01T12:00:00.000Z",
            "payloadSha256": hashlib.sha256(second_payload).hexdigest(),
            "payloadBytes": len(second_payload),
            "payloadPath": second_relative.as_posix(),
        }), encoding="utf-8")
        roots = [root, second_root]
        first = build(roots, sec_database, bridge_database, Path(temporary) / "first.json", edgar_database)
        second = build(roots, sec_database, bridge_database, Path(temporary) / "second.json", edgar_database)
        if first["reportSha256"] != second["reportSha256"]:
            raise EntityBridgeError("idempotent report hash self-test failed")
        if first["snapshots"] != 2 or first["byStatus"].get("CANDIDATE_UNADJUDICATED") != 4:
            raise EntityBridgeError("EDGAR issuer-alias candidate self-test failed")
    return {
        "schema": "early-detection-entity-bridge-self-test/v1",
        "status": "PASS",
        "uniqueCandidate": exact,
        "ambiguousCandidate": ambiguous,
        "deterministicReportHash": True,
        "edgarAliasCandidate": True,
        "multipleSnapshotRoots": True,
        "gzipTransportVerified": True,
    }


def parser() -> argparse.ArgumentParser:
    value = argparse.ArgumentParser(description=__doc__)
    commands = value.add_subparsers(dest="command", required=True)
    build_parser = commands.add_parser("build")
    build_parser.add_argument("--data-root", action="append", required=True)
    build_parser.add_argument("--sec-database", required=True)
    build_parser.add_argument("--edgar-database")
    build_parser.add_argument("--database", required=True)
    build_parser.add_argument("--report", required=True)
    commands.add_parser("self-test")
    return value


def main() -> int:
    args = parser().parse_args()
    if args.command == "self-test":
        result = self_test()
    else:
        result = build(
            [Path(path).resolve() for path in args.data_root], Path(args.sec_database).resolve(),
            Path(args.database).resolve(), Path(args.report).resolve(),
            Path(args.edgar_database).resolve() if args.edgar_database else None,
        )
    print(json.dumps(result, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

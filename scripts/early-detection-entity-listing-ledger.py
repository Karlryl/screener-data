#!/usr/bin/env python3
"""Build a fail-closed historical entity/listing evidence ledger.

Direct SEC CIK/name/ticker snapshots adjudicate sparse Nasdaq name candidates.
MIDAS contributes ticker-presence evidence only and can never establish CIK or
listing continuity. Every source is retained at its exact observation date;
no missing period is forward-filled.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import sqlite3
from pathlib import Path
from types import ModuleType
from typing import Any


SCHEMA = "early-detection-entity-listing-ledger/v1"
OBSERVATION_SCHEMA = "early-detection-source-observation/v1"
ADJUDICATION_INSERT = "INSERT INTO adjudications VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)"


class LedgerError(RuntimeError):
    """Entity/listing evidence violated a fail-closed contract."""


def canonical_bytes(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_module(filename: str, name: str) -> ModuleType:
    path = Path(__file__).with_name(filename)
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise LedgerError(f"cannot load helper module: {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def initialize(connection: sqlite3.Connection) -> None:
    connection.executescript(
        """
        PRAGMA foreign_keys=ON;
        PRAGMA journal_mode=WAL;
        CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
        CREATE TABLE sec_snapshots(
          snapshot_id INTEGER PRIMARY KEY,
          source_id TEXT NOT NULL,
          observed_at TEXT NOT NULL,
          observed_epoch INTEGER NOT NULL,
          payload_sha256 TEXT NOT NULL,
          payload_bytes INTEGER NOT NULL,
          source_root TEXT NOT NULL,
          observation_path TEXT NOT NULL,
          rows INTEGER NOT NULL,
          source_rows INTEGER NOT NULL,
          exact_duplicate_rows INTEGER NOT NULL,
          UNIQUE(source_id,observed_at,payload_sha256)
        );
        CREATE TABLE sec_mappings(
          snapshot_id INTEGER NOT NULL REFERENCES sec_snapshots(snapshot_id),
          row_number INTEGER NOT NULL,
          cik INTEGER NOT NULL,
          company_name TEXT NOT NULL,
          ticker TEXT NOT NULL,
          exchange_code TEXT,
          PRIMARY KEY(snapshot_id,row_number)
        );
        CREATE INDEX idx_sec_mapping_ticker ON sec_mappings(snapshot_id,ticker);
        CREATE TABLE adjudications(
          nasdaq_snapshot_id INTEGER NOT NULL,
          nasdaq_row_number INTEGER NOT NULL,
          nasdaq_observed_at TEXT NOT NULL,
          ticker TEXT NOT NULL,
          security_name TEXT NOT NULL,
          candidate_status TEXT NOT NULL,
          candidate_ciks_json TEXT NOT NULL,
          sec_snapshot_id INTEGER REFERENCES sec_snapshots(snapshot_id),
          sec_observed_at TEXT,
          sec_age_days REAL,
          direct_cik INTEGER,
          direct_name TEXT,
          direct_exchange TEXT,
          name_core_agrees INTEGER,
          adjudication_status TEXT NOT NULL,
          PRIMARY KEY(nasdaq_snapshot_id,nasdaq_row_number)
        );
        CREATE INDEX idx_adjudication_status ON adjudications(adjudication_status);
        CREATE TABLE midas_ticker_presence(
          ticker TEXT PRIMARY KEY,
          first_trade_date TEXT NOT NULL,
          last_trade_date TEXT NOT NULL,
          stock_security_ids INTEGER NOT NULL,
          etf_security_ids INTEGER NOT NULL,
          security_ids_json TEXT NOT NULL
        );
        """
    )
    connection.execute("INSERT INTO meta(key,value) VALUES('schema',?)", (SCHEMA,))


def observation_paths(data_roots: list[Path]) -> list[tuple[Path, Path]]:
    result: list[tuple[Path, Path]] = []
    for root in data_roots:
        base = root / "observations" / "sec-company-tickers"
        if base.exists():
            result.extend((root, path) for path in base.rglob("*.json"))
    return sorted(result, key=lambda item: (str(item[0]).casefold(), str(item[1]).casefold()))


def import_sec_snapshots(connection: sqlite3.Connection, roots: list[Path], ticker_module: ModuleType) -> dict[str, int]:
    snapshots = rows = source_rows = duplicates = 0
    for root, observation_path in observation_paths(roots):
        observation = json.loads(observation_path.read_text(encoding="utf-8"))
        if observation.get("schema") != OBSERVATION_SCHEMA or observation.get("sourceClass") != "sec_company_ticker_snapshot":
            raise LedgerError(f"unexpected SEC ticker observation: {observation_path}")
        payload_path = root / Path(str(observation.get("payloadPath", "")))
        if not payload_path.is_file() or sha256_file(payload_path) != observation.get("payloadSha256"):
            raise LedgerError(f"SEC ticker payload hash mismatch: {payload_path}")
        parsed = ticker_module.parse_snapshot(payload_path.read_bytes(), str(observation["sourceId"]))
        existing = connection.execute(
            "SELECT snapshot_id FROM sec_snapshots WHERE source_id=? AND observed_at=? AND payload_sha256=?",
            (observation["sourceId"], observation["observedAt"], observation["payloadSha256"]),
        ).fetchone()
        if existing is not None:
            continue
        collision = connection.execute(
            "SELECT payload_sha256 FROM sec_snapshots WHERE source_id=? AND observed_at=?",
            (observation["sourceId"], observation["observedAt"]),
        ).fetchone()
        if collision is not None:
            raise LedgerError(f"conflicting SEC ticker payloads at {observation['observedAt']}")
        epoch = ticker_module.datetime.fromisoformat(str(observation["observedAt"]).replace("Z", "+00:00")).timestamp()
        cursor = connection.execute(
            """INSERT INTO sec_snapshots(source_id,observed_at,observed_epoch,payload_sha256,payload_bytes,
               source_root,observation_path,rows,source_rows,exact_duplicate_rows) VALUES(?,?,?,?,?,?,?,?,?,?)""",
            (
                observation["sourceId"], observation["observedAt"], int(epoch), observation["payloadSha256"],
                int(observation["payloadBytes"]), str(root.resolve()),
                str(observation_path.relative_to(root)).replace("\\", "/"), parsed["rows"],
                parsed["sourceRows"], parsed["exactDuplicateRows"],
            ),
        )
        snapshot_id = int(cursor.lastrowid)
        for row_number, record in enumerate(parsed["records"], start=1):
            connection.execute(
                "INSERT INTO sec_mappings VALUES(?,?,?,?,?,?)",
                (snapshot_id, row_number, record["cik"], record["name"], record["ticker"], record["exchange"]),
            )
        snapshots += 1
        rows += parsed["rows"]
        source_rows += parsed["sourceRows"]
        duplicates += parsed["exactDuplicateRows"]
    return {"snapshots": snapshots, "rows": rows, "sourceRows": source_rows, "exactDuplicateRows": duplicates}


def import_midas_presence(connection: sqlite3.Connection, midas_database: Path) -> dict[str, int]:
    midas = sqlite3.connect(f"file:{midas_database.as_posix()}?mode=ro", uri=True)
    try:
        rows = midas.execute(
            """SELECT s.ticker,MIN(d.trade_date),MAX(d.trade_date),
                      COUNT(DISTINCT CASE WHEN s.security_type='Stock' THEN s.security_id END),
                      COUNT(DISTINCT CASE WHEN s.security_type='ETF' THEN s.security_id END),
                      GROUP_CONCAT(DISTINCT s.security_id)
               FROM daily_metrics d JOIN securities s USING(security_id)
               GROUP BY s.ticker ORDER BY s.ticker"""
        ).fetchall()
    finally:
        midas.close()
    for ticker, first_date, last_date, stock_count, etf_count, ids in rows:
        ordered_ids = sorted(int(value) for value in str(ids).split(","))
        connection.execute(
            "INSERT INTO midas_ticker_presence VALUES(?,?,?,?,?,?)",
            (ticker, first_date, last_date, int(stock_count), int(etf_count), json.dumps(ordered_ids, separators=(",", ":"))),
        )
    return {"tickers": len(rows), "withStockEvidence": sum(1 for row in rows if int(row[3]) > 0)}


def adjudication_status(candidate_status: str, candidate_ciks: list[int], direct_cik: int | None, name_agrees: bool | None, direct_count: int) -> str:
    if direct_count == 0:
        return "NO_DIRECT_TICKER"
    if direct_count > 1:
        return "DIRECT_TICKER_AMBIGUOUS"
    if not name_agrees:
        return "DIRECT_TICKER_NAME_CONFLICT"
    if candidate_status == "CANDIDATE_UNADJUDICATED":
        return "DIRECT_AGREEMENT" if direct_cik in candidate_ciks else "DIRECT_DISAGREEMENT"
    if candidate_status == "AMBIGUOUS":
        return "DIRECT_RESOLVED_AMBIGUOUS" if direct_cik in candidate_ciks else "DIRECT_DISAGREEMENT"
    if candidate_status == "UNRESOLVED":
        return "DIRECT_RECOVERY"
    return "EXCLUDED_SECURITY"


def adjudicate(connection: sqlite3.Connection, candidate_database: Path, max_age_days: int, bridge_module: ModuleType) -> dict[str, Any]:
    source = sqlite3.connect(f"file:{candidate_database.as_posix()}?mode=ro", uri=True)
    source.row_factory = sqlite3.Row
    counts: dict[str, int] = {}
    try:
        snapshots = source.execute("SELECT snapshot_id,observed_at,observed_epoch FROM snapshots ORDER BY observed_epoch,dataset").fetchall()
        for snapshot in snapshots:
            sec_snapshot = connection.execute(
                """SELECT snapshot_id,observed_at,observed_epoch FROM sec_snapshots
                   WHERE observed_epoch<=? AND observed_epoch>=?
                   ORDER BY observed_epoch DESC,CASE source_id WHEN 'company_tickers_exchange' THEN 0 ELSE 1 END
                   LIMIT 1""",
                (int(snapshot["observed_epoch"]), int(snapshot["observed_epoch"]) - max_age_days * 86400),
            ).fetchone()
            direct: dict[str, list[sqlite3.Row]] = {}
            if sec_snapshot is not None:
                connection.row_factory = sqlite3.Row
                for row in connection.execute("SELECT cik,company_name,ticker,exchange_code FROM sec_mappings WHERE snapshot_id=?", (sec_snapshot[0],)):
                    direct.setdefault(str(row["ticker"]), []).append(row)
            candidates = source.execute(
                """SELECT row_number,ticker,security_name,status,candidate_ciks_json
                   FROM candidates WHERE snapshot_id=? ORDER BY row_number""",
                (snapshot["snapshot_id"],),
            ).fetchall()
            for row in candidates:
                direct_rows = direct.get(str(row["ticker"]), [])
                direct_row = direct_rows[0] if len(direct_rows) == 1 else None
                candidate_ciks = json.loads(row["candidate_ciks_json"])
                name_agrees = None if direct_row is None else (
                    bridge_module.issuer_core(str(row["security_name"])) == bridge_module.issuer_core(str(direct_row["company_name"]))
                )
                status = adjudication_status(
                    str(row["status"]), candidate_ciks,
                    int(direct_row["cik"]) if direct_row is not None else None,
                    name_agrees, len(direct_rows),
                )
                counts[status] = counts.get(status, 0) + 1
                age_days = None if sec_snapshot is None else (int(snapshot["observed_epoch"]) - int(sec_snapshot[2])) / 86400
                connection.execute(
                    ADJUDICATION_INSERT,
                    (
                        snapshot["snapshot_id"], row["row_number"], snapshot["observed_at"], row["ticker"],
                        row["security_name"], row["status"], row["candidate_ciks_json"],
                        sec_snapshot[0] if sec_snapshot is not None else None,
                        sec_snapshot[1] if sec_snapshot is not None else None, age_days,
                        int(direct_row["cik"]) if direct_row is not None else None,
                        str(direct_row["company_name"]) if direct_row is not None else None,
                        direct_row["exchange_code"] if direct_row is not None else None,
                        int(name_agrees) if name_agrees is not None else None, status,
                    ),
                )
    finally:
        source.close()
    agreement = counts.get("DIRECT_AGREEMENT", 0)
    disagreement = counts.get("DIRECT_DISAGREEMENT", 0)
    denominator = agreement + disagreement
    return {
        "rows": sum(counts.values()), "byStatus": dict(sorted(counts.items())),
        "candidateAuditAgreement": agreement, "candidateAuditDisagreement": disagreement,
        "candidateAuditAccuracy": agreement / denominator if denominator else None,
        "candidateAuditDenominator": denominator,
    }


def logical_hash(connection: sqlite3.Connection) -> str:
    digest = hashlib.sha256()
    for row in connection.execute(
        """SELECT s.source_id,s.observed_at,s.payload_sha256,m.row_number,m.cik,m.company_name,m.ticker,m.exchange_code
           FROM sec_mappings m JOIN sec_snapshots s USING(snapshot_id)
           ORDER BY s.observed_at,s.source_id,m.row_number"""
    ):
        digest.update(canonical_bytes(list(row)) + b"\n")
    for row in connection.execute(
        """SELECT nasdaq_snapshot_id,nasdaq_row_number,ticker,candidate_status,candidate_ciks_json,
                  sec_observed_at,direct_cik,name_core_agrees,adjudication_status
           FROM adjudications ORDER BY nasdaq_observed_at,nasdaq_snapshot_id,nasdaq_row_number"""
    ):
        digest.update(canonical_bytes(list(row)) + b"\n")
    return digest.hexdigest()


def build(sec_ticker_roots: list[Path], candidate_database: Path, midas_database: Path, output_database: Path, report_path: Path, max_age_days: int) -> dict[str, Any]:
    if output_database.exists() or report_path.exists():
        raise LedgerError("output database/report already exists; immutable rebuild requires a new path")
    ticker_module = load_module("early-detection-sec-company-tickers.py", "sec_company_tickers")
    bridge_module = load_module("early-detection-entity-bridge.py", "entity_bridge")
    output_database.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(output_database)
    try:
        initialize(connection)
        with connection:
            sec_counts = import_sec_snapshots(connection, sec_ticker_roots, ticker_module)
            midas_counts = import_midas_presence(connection, midas_database)
            adjudication = adjudicate(connection, candidate_database, max_age_days, bridge_module)
        integrity = connection.execute("PRAGMA quick_check").fetchone()[0]
        sequence_hash = logical_hash(connection)
        direct_with_midas = connection.execute(
            """SELECT COUNT(*) FROM sec_mappings m JOIN sec_snapshots s USING(snapshot_id)
               JOIN midas_ticker_presence p USING(ticker)
               WHERE p.stock_security_ids>0 AND substr(s.observed_at,1,10) BETWEEN p.first_trade_date AND p.last_trade_date"""
        ).fetchone()[0]
        connection.execute("PRAGMA journal_mode=DELETE").fetchone()
    finally:
        connection.close()
    if integrity != "ok":
        raise LedgerError(f"entity/listing ledger quick_check failed: {integrity}")
    unsigned = {
        "schema": SCHEMA, "status": "EVIDENCE_LEDGER_PASS_GATE_REMAINS_RED",
        "database": str(output_database.resolve()), "databaseBytes": output_database.stat().st_size,
        "evidenceSources": {
            "secTickerRoots": [str(path.resolve()) for path in sec_ticker_roots],
            "nasdaqCandidateDatabase": str(candidate_database.resolve()),
            "secMidasDatabase": str(midas_database.resolve()),
        },
        "secDirectMappings": sec_counts, "midasPresence": midas_counts,
        "adjudication": adjudication, "directMappingsWithMidasStockPresence": int(direct_with_midas),
        "maxPriorSecSnapshotAgeDays": max_age_days, "logicalSequenceSha256": sequence_hash,
        "confirmatoryEligible": False,
        "limitations": [
            "SEC mapping snapshots are direct official evidence only at exact capture times; they are not effective-date intervals.",
            "Nasdaq candidates are adjudicated only when a prior SEC snapshot within the fixed age window has one ticker and matching issuer core.",
            "MIDAS establishes ticker market presence only; it never supplies CIK, listing identity, OHLCV or continuity.",
            "Pre-2017 direct CIK-ticker coverage and exact event-effective dates remain open, so entityListingLedger stays RED.",
        ],
        "productiveGqsModified": False,
    }
    report = {**unsigned, "reportSha256": hashlib.sha256(canonical_bytes(unsigned)).hexdigest()}
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return report


def self_test() -> dict[str, Any]:
    if adjudication_status("CANDIDATE_UNADJUDICATED", [1], 1, True, 1) != "DIRECT_AGREEMENT":
        raise LedgerError("agreement self-test failed")
    if adjudication_status("CANDIDATE_UNADJUDICATED", [2], 1, True, 1) != "DIRECT_DISAGREEMENT":
        raise LedgerError("disagreement self-test failed")
    if adjudication_status("UNRESOLVED", [], 1, True, 1) != "DIRECT_RECOVERY":
        raise LedgerError("recovery self-test failed")
    if adjudication_status("CANDIDATE_UNADJUDICATED", [1], 1, False, 1) != "DIRECT_TICKER_NAME_CONFLICT":
        raise LedgerError("name-conflict self-test failed")
    if adjudication_status("CANDIDATE_UNADJUDICATED", [1], None, None, 0) != "NO_DIRECT_TICKER":
        raise LedgerError("missing-direct self-test failed")
    connection = sqlite3.connect(":memory:")
    try:
        initialize(connection)
        connection.execute(
            ADJUDICATION_INSERT,
            (1, 2, "2020-01-01T00:00:00.000Z", "ABC", "Example Corp", "UNRESOLVED", "[]",
             None, None, None, None, None, None, None, "NO_DIRECT_TICKER"),
        )
        if connection.execute("SELECT COUNT(*) FROM adjudications").fetchone()[0] != 1:
            raise LedgerError("adjudication SQL self-test failed")
    finally:
        connection.close()
    return {
        "schema": "early-detection-entity-listing-ledger-self-test/v1", "status": "PASS",
        "failClosedStates": 5, "adjudicationSqlVerified": True,
    }


def parser() -> argparse.ArgumentParser:
    value = argparse.ArgumentParser(description=__doc__)
    commands = value.add_subparsers(dest="command", required=True)
    build_parser = commands.add_parser("build")
    build_parser.add_argument("--sec-ticker-root", action="append", required=True)
    build_parser.add_argument("--candidate-database", required=True)
    build_parser.add_argument("--midas-database", required=True)
    build_parser.add_argument("--database", required=True)
    build_parser.add_argument("--report", required=True)
    build_parser.add_argument("--max-age-days", type=int, default=45)
    commands.add_parser("self-test")
    return value


def main() -> int:
    args = parser().parse_args()
    if args.command == "self-test":
        result = self_test()
    else:
        result = build(
            [Path(path).resolve() for path in args.sec_ticker_root], Path(args.candidate_database).resolve(),
            Path(args.midas_database).resolve(), Path(args.database).resolve(), Path(args.report).resolve(), args.max_age_days,
        )
    print(json.dumps(result, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

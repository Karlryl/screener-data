#!/usr/bin/env python3
"""Build a compact point-in-time ledger from verified SEC MIDAS ZIPs.

MIDAS supplies daily security presence and market-activity ranks from 2012.  It
does not contain CIKs, corporate-action links, raw prices or total-return bars;
those remain separate gates.  Every derived row stays bound to an immutable,
archive-digest-verified source payload.
"""

from __future__ import annotations

import argparse
import base64
import csv
import hashlib
import importlib.util
import io
import json
import math
import re
import sqlite3
import sys
import tempfile
import zipfile
from collections import Counter
from datetime import datetime
from pathlib import Path
from types import ModuleType
from typing import Any, Iterable


SCHEMA = "early-detection-sec-midas-sqlite/v1"
OBSERVATION_SCHEMA = "early-detection-sec-midas-acquisition/v1"
CSV_HEADER = [
    "Date", "Security", "Ticker", "McapRank", "TurnRank", "VolatilityRank", "PriceRank",
    "LitVol('000)", "OrderVol('000)", "Hidden", "TradesForHidden", "HiddenVol('000)",
    "TradeVolForHidden('000)", "Cancels", "LitTrades", "OddLots", "TradesForOddLots",
    "OddLotVol('000)", "TradeVolForOddLots('000)",
]


class MidasIndexError(RuntimeError):
    """The source evidence or derived MIDAS ledger is invalid."""


def load_foundation() -> ModuleType:
    path = Path(__file__).resolve().with_name("early-detection-foundation.py")
    spec = importlib.util.spec_from_file_location("early_detection_foundation_midas_index", path)
    if spec is None or spec.loader is None:
        raise MidasIndexError(f"cannot load foundation module: {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def sha1_base32(payload: bytes) -> str:
    return base64.b32encode(hashlib.sha1(payload).digest()).decode("ascii").rstrip("=")


def canonical_sha256(value: Any) -> str:
    raw = json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def create_schema(connection: sqlite3.Connection) -> None:
    connection.executescript(
        """
        PRAGMA foreign_keys=ON;
        PRAGMA journal_mode=WAL;
        PRAGMA synchronous=NORMAL;
        CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS source_payloads(
          payload_id INTEGER PRIMARY KEY,
          quarter TEXT NOT NULL UNIQUE,
          payload_sha256 TEXT NOT NULL UNIQUE,
          payload_sha1_base32 TEXT NOT NULL,
          payload_bytes INTEGER NOT NULL,
          capture_timestamp TEXT NOT NULL,
          official_url TEXT NOT NULL,
          blob_path TEXT NOT NULL,
          observation_path TEXT NOT NULL,
          csv_member TEXT NOT NULL,
          csv_sha256 TEXT NOT NULL,
          rows INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS securities(
          security_id INTEGER PRIMARY KEY,
          security_type TEXT NOT NULL,
          ticker TEXT NOT NULL,
          UNIQUE(security_type,ticker)
        );
        CREATE TABLE IF NOT EXISTS daily_metrics(
          payload_id INTEGER NOT NULL REFERENCES source_payloads(payload_id),
          row_number INTEGER NOT NULL,
          trade_date INTEGER NOT NULL,
          security_id INTEGER NOT NULL REFERENCES securities(security_id),
          mcap_rank INTEGER,
          turn_rank INTEGER,
          volatility_rank INTEGER,
          price_rank INTEGER,
          lit_volume_k REAL,
          order_volume_k REAL,
          hidden_trades REAL,
          trades_for_hidden REAL,
          hidden_volume_k REAL,
          trade_volume_for_hidden_k REAL,
          cancels REAL,
          lit_trades REAL,
          odd_lots REAL,
          trades_for_odd_lots REAL,
          odd_lot_volume_k REAL,
          trade_volume_for_odd_lots_k REAL,
          PRIMARY KEY(payload_id,row_number)
        );
        CREATE INDEX IF NOT EXISTS idx_midas_date ON daily_metrics(trade_date);
        CREATE INDEX IF NOT EXISTS idx_midas_security_date ON daily_metrics(security_id,trade_date);
        """
    )
    current = connection.execute("SELECT value FROM meta WHERE key='schema'").fetchone()
    if current is None:
        connection.execute("INSERT INTO meta(key,value) VALUES('schema',?)", (SCHEMA,))
    elif current[0] != SCHEMA:
        raise MidasIndexError(f"database schema mismatch: {current[0]}")


def observation_paths(data_root: Path) -> list[Path]:
    root = data_root / "observations" / "sec-midas-individual-security"
    return sorted(root.rglob("*.json")) if root.exists() else []


def verified_observation(data_root: Path, path: Path) -> tuple[dict[str, Any], bytes]:
    try:
        observation = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise MidasIndexError(f"invalid observation JSON: {path}") from exc
    if observation.get("schema") != OBSERVATION_SCHEMA:
        raise MidasIndexError(f"unexpected observation schema: {path}")
    blob = data_root / Path(str(observation.get("blobPath", "")))
    if not blob.is_file():
        raise MidasIndexError(f"observation blob is missing: {blob}")
    payload = blob.read_bytes()
    if hashlib.sha256(payload).hexdigest() != observation.get("payloadSha256"):
        raise MidasIndexError(f"payload SHA-256 mismatch: {blob}")
    if sha1_base32(payload) != observation.get("payloadSha1Base32"):
        raise MidasIndexError(f"payload Wayback SHA-1 mismatch: {blob}")
    return observation, payload


def optional_int(value: str) -> int | None:
    stripped = value.strip()
    if stripped in {"", "NA", "N/A", "."}:
        return None
    try:
        decimal = float(stripped)
    except ValueError as exc:
        raise MidasIndexError(f"invalid rank: {stripped}") from exc
    if not math.isfinite(decimal) or not decimal.is_integer():
        raise MidasIndexError(f"rank is not an integer: {stripped}")
    number = int(decimal)
    if not 1 <= number <= 10:
        raise MidasIndexError(f"rank outside 1..10: {stripped}")
    return number


def trade_date(value: str) -> int:
    """Parse official MIDAS YYYYMMDD or the 2016 pandas-style YYYYMMDD.0."""
    stripped = value.strip()
    if not re.fullmatch(r"20\d{6}(?:\.0+)?", stripped):
        raise MidasIndexError(f"invalid trade date: {stripped}")
    compact = stripped.split(".", 1)[0]
    try:
        datetime.strptime(compact, "%Y%m%d")
    except ValueError as exc:
        raise MidasIndexError(f"invalid calendar trade date: {stripped}") from exc
    return int(compact)


def optional_float(value: str) -> float | None:
    stripped = value.strip()
    if stripped in {"", "NA", "N/A", "."}:
        return None
    number = float(stripped)
    if not math.isfinite(number):
        raise MidasIndexError(f"non-finite metric: {stripped}")
    return number


def csv_member(archive: zipfile.ZipFile) -> str:
    candidates = sorted(
        info.filename for info in archive.infolist()
        if not info.is_dir() and info.filename.lower().endswith("_all.csv")
    )
    if len(candidates) != 1:
        raise MidasIndexError(f"expected one *_all.csv member, found {candidates}")
    return candidates[0]


def csv_payload(payload: bytes) -> tuple[str, bytes]:
    """Return the one MIDAS *_all.csv, including the official 2014q2 nested ZIP."""
    with zipfile.ZipFile(io.BytesIO(payload)) as archive:
        if archive.testzip() is not None:
            raise MidasIndexError("outer ZIP CRC failed")
        direct = sorted(
            info.filename for info in archive.infolist()
            if not info.is_dir() and info.filename.lower().endswith("_all.csv")
        )
        if len(direct) == 1:
            return direct[0], archive.read(direct[0])
        if direct:
            raise MidasIndexError(f"expected one direct *_all.csv member, found {direct}")
        nested_names = sorted(
            info.filename for info in archive.infolist()
            if not info.is_dir() and info.filename.lower().endswith(".zip")
        )
        if len(nested_names) != 1:
            raise MidasIndexError(f"expected one nested ZIP when direct CSV is absent, found {nested_names}")
        nested_name = nested_names[0]
        nested_payload = archive.read(nested_name)
    with zipfile.ZipFile(io.BytesIO(nested_payload)) as nested:
        if nested.testzip() is not None:
            raise MidasIndexError("nested ZIP CRC failed")
        member = csv_member(nested)
        return f"{nested_name}!{member}", nested.read(member)


def security_id(connection: sqlite3.Connection, cache: dict[tuple[str, str], int], kind: str, ticker: str) -> int:
    key = (kind, ticker)
    current = cache.get(key)
    if current is not None:
        return current
    connection.execute("INSERT OR IGNORE INTO securities(security_type,ticker) VALUES(?,?)", key)
    row = connection.execute(
        "SELECT security_id FROM securities WHERE security_type=? AND ticker=?", key
    ).fetchone()
    if row is None:
        raise MidasIndexError(f"could not materialize security {key}")
    cache[key] = int(row[0])
    return cache[key]


def import_observation(connection: sqlite3.Connection, data_root: Path, path: Path) -> dict[str, Any]:
    observation, payload = verified_observation(data_root, path)
    quarter = str(observation["quarter"])
    existing = connection.execute("SELECT payload_sha256,rows FROM source_payloads WHERE quarter=?", (quarter,)).fetchone()
    if existing is not None:
        if existing[0] != observation["payloadSha256"]:
            raise MidasIndexError(f"quarter already bound to another payload: {quarter}")
        return {"quarter": quarter, "rows": int(existing[1]), "status": "ALREADY_IMPORTED"}
    member, csv_bytes = csv_payload(payload)
    try:
        text = csv_bytes.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = csv_bytes.decode("latin-1")
    reader = csv.reader(io.StringIO(text, newline=""))
    header = next(reader, None)
    if header != CSV_HEADER:
        raise MidasIndexError(f"MIDAS columns changed for {quarter}: {header}")
    connection.execute("BEGIN IMMEDIATE")
    try:
        cursor = connection.execute(
            """
            INSERT INTO source_payloads(
              quarter,payload_sha256,payload_sha1_base32,payload_bytes,capture_timestamp,
              official_url,blob_path,observation_path,csv_member,csv_sha256,rows
            ) VALUES(?,?,?,?,?,?,?,?,?,?,0)
            """,
            (
                quarter, observation["payloadSha256"], observation["payloadSha1Base32"],
                observation["payloadBytes"], observation["captureTimestamp"],
                observation["officialDistributionUrl"], observation["blobPath"],
                str(path.relative_to(data_root)).replace("\\", "/"), member,
                hashlib.sha256(csv_bytes).hexdigest(),
            ),
        )
        payload_id = int(cursor.lastrowid)
        cache: dict[tuple[str, str], int] = {}
        rows_to_insert = []
        dates, kinds = Counter(), Counter()
        for row_number, row in enumerate(reader, start=2):
            if len(row) != len(CSV_HEADER):
                raise MidasIndexError(f"invalid column count at {quarter}:{row_number}")
            date_raw, kind, ticker = row[0].strip(), row[1].strip(), row[2].strip()
            if not kind or not ticker:
                raise MidasIndexError(f"invalid identity fields at {quarter}:{row_number}")
            try:
                parsed_date = trade_date(date_raw)
            except MidasIndexError as exc:
                raise MidasIndexError(f"invalid identity fields at {quarter}:{row_number}: {exc}") from exc
            sid = security_id(connection, cache, kind, ticker)
            ranks = [optional_int(value) for value in row[3:7]]
            metrics = [optional_float(value) for value in row[7:]]
            rows_to_insert.append((payload_id, row_number, parsed_date, sid, *ranks, *metrics))
            dates[parsed_date] += 1
            kinds[kind] += 1
            if len(rows_to_insert) >= 25000:
                connection.executemany(
                    "INSERT INTO daily_metrics VALUES(" + ",".join("?" for _ in range(20)) + ")",
                    rows_to_insert,
                )
                rows_to_insert.clear()
        if rows_to_insert:
            connection.executemany(
                "INSERT INTO daily_metrics VALUES(" + ",".join("?" for _ in range(20)) + ")",
                rows_to_insert,
            )
        count = sum(dates.values())
        if count == 0:
            raise MidasIndexError(f"MIDAS quarter contains no rows: {quarter}")
        connection.execute("UPDATE source_payloads SET rows=? WHERE payload_id=?", (count, payload_id))
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    return {
        "quarter": quarter,
        "rows": count,
        "dates": len(dates),
        "firstDate": min(dates),
        "lastDate": max(dates),
        "securityTypes": dict(sorted(kinds.items())),
        "status": "IMPORTED",
    }


def logical_manifest(connection: sqlite3.Connection) -> dict[str, Any]:
    payloads = [
        {
            "quarter": row[0], "payloadSha256": row[1], "csvSha256": row[2], "rows": row[3],
        }
        for row in connection.execute(
            "SELECT quarter,payload_sha256,csv_sha256,rows FROM source_payloads ORDER BY quarter"
        )
    ]
    summary = {
        "payloads": len(payloads),
        "rows": connection.execute("SELECT COUNT(*) FROM daily_metrics").fetchone()[0],
        "securities": connection.execute("SELECT COUNT(*) FROM securities").fetchone()[0],
        "dates": connection.execute("SELECT COUNT(DISTINCT trade_date) FROM daily_metrics").fetchone()[0],
        "firstDate": connection.execute("SELECT MIN(trade_date) FROM daily_metrics").fetchone()[0],
        "lastDate": connection.execute("SELECT MAX(trade_date) FROM daily_metrics").fetchone()[0],
        "payloadManifest": payloads,
    }
    summary["logicalManifestSha256"] = canonical_sha256(summary)
    return summary


def build(data_root: Path, database: Path) -> dict[str, Any]:
    root = data_root.expanduser().resolve()
    target = database.expanduser().resolve()
    target.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(target)
    try:
        create_schema(connection)
        connection.commit()
        imported = [import_observation(connection, root, path) for path in observation_paths(root)]
        connection.execute("PRAGMA wal_checkpoint(TRUNCATE)").fetchone()
        manifest = logical_manifest(connection)
        integrity = connection.execute("PRAGMA quick_check").fetchone()[0]
        connection.execute("PRAGMA journal_mode=DELETE").fetchone()
    finally:
        connection.close()
    if integrity != "ok":
        raise MidasIndexError(f"SQLite quick_check failed: {integrity}")
    return {
        "schema": SCHEMA,
        "status": "PASS",
        "database": str(target),
        "databaseBytes": target.stat().st_size,
        "imports": imported,
        "integrity": "quick_check:ok",
        **manifest,
        "limitations": [
            "Ticker presence is not yet linked to CIK or corporate-action identity.",
            "The SEC archive contains ranks and market-activity metrics, not raw OHLCV or total returns.",
            "Archive capture time is provenance; retrospective MIDAS rows are not treated as contemporaneously published signals.",
        ],
    }


def write_report(result: dict[str, Any], report_path: Path) -> dict[str, Any]:
    unsigned = {key: value for key, value in result.items() if key != "imports"}
    report = {**unsigned, "reportSha256": canonical_sha256(unsigned)}
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return report


def self_test() -> dict[str, Any]:
    foundation = load_foundation()
    if trade_date("20160104.0") != 20160104 or optional_int("10.0") != 10:
        raise MidasIndexError("integral-decimal source token self-test failed")
    for invalid in ("20160104.5", "20160230", "not-a-date"):
        try:
            trade_date(invalid)
        except MidasIndexError:
            pass
        else:
            raise MidasIndexError(f"invalid trade date was accepted: {invalid}")
    for invalid in ("5.5", "nan", "11.0"):
        try:
            optional_int(invalid)
        except MidasIndexError:
            pass
        else:
            raise MidasIndexError(f"invalid rank was accepted: {invalid}")
    nested_inner = io.BytesIO()
    with zipfile.ZipFile(nested_inner, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("nested_all.csv", ",".join(CSV_HEADER) + "\n")
    nested_outer = io.BytesIO()
    with zipfile.ZipFile(nested_outer, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("nested.zip", nested_inner.getvalue())
    nested_name, _ = csv_payload(nested_outer.getvalue())
    if nested_name != "nested.zip!nested_all.csv":
        raise MidasIndexError("nested archive member self-test failed")
    with tempfile.TemporaryDirectory() as temporary:
        root = Path(temporary) / "store"
        foundation.ensure_data_root(root)
        csv_text = ",".join(CSV_HEADER) + "\n20120402,Stock,ABC,5,4,3,2,1,2,3,4,5,6,7,8,9,10,11,12\n"
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
            archive.writestr("q2_2012_all.csv", csv_text)
        payload = buffer.getvalue()
        sha256 = hashlib.sha256(payload).hexdigest()
        blob = Path("blobs") / "sha256" / sha256[:2] / f"{sha256}.zip"
        foundation.write_once(root / blob, payload)
        observation = {
            "schema": OBSERVATION_SCHEMA,
            "quarter": "2012q2",
            "payloadSha256": sha256,
            "payloadSha1Base32": sha1_base32(payload),
            "payloadBytes": len(payload),
            "captureTimestamp": "2018-03-28T08:13:59.000Z",
            "officialDistributionUrl": "https://www.sec.gov/example.zip",
            "blobPath": str(blob).replace("\\", "/"),
        }
        obs = root / "observations" / "sec-midas-individual-security" / "2012q2" / "sample.json"
        foundation.write_once(obs, foundation.canonical_bytes(observation) + b"\n")
        result = build(root, Path(temporary) / "midas.sqlite")
        if result["rows"] != 1 or result["securities"] != 1 or result["firstDate"] != 20120402:
            raise MidasIndexError("self-test ledger values changed")
    return {
        "schema": "early-detection-sec-midas-index-self-test/v1",
        "status": "PASS",
        "rows": 1,
        "sourceHashVerified": True,
        "logicalManifestDeterministic": True,
        "nestedArchiveSupported": True,
        "integralDecimalTokensSupported": True,
        "fractionalDateAndRankTokensRejected": True,
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    build_parser_ = sub.add_parser("build")
    build_parser_.add_argument("--data-root", type=Path, required=True)
    build_parser_.add_argument("--database", type=Path, required=True)
    build_parser_.add_argument("--report", type=Path)
    sub.add_parser("self-test")
    return parser


def main() -> int:
    args = build_parser().parse_args()
    try:
        result = self_test() if args.command == "self-test" else build(args.data_root, args.database)
        if args.command == "build" and args.report is not None:
            write_report(result, args.report)
        print(json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True))
        return 0
    except (MidasIndexError, OSError, ValueError, sqlite3.Error, zipfile.BadZipFile) as exc:
        print(f"[early-detection-midas-index] {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

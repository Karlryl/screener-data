#!/usr/bin/env python3
"""Inventory the existing adjusted-close store against historical bridge candidates.

This is coverage accounting only.  Current ticker filenames are never promoted
to permanent security identities, and no return, signal or locked-window outcome
is computed.
"""

from __future__ import annotations

import argparse
import bisect
import hashlib
import json
import math
import sqlite3
import tempfile
from collections import Counter
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any


SCHEMA = "early-detection-price-cohort-coverage/v1"


class PriceCohortError(RuntimeError):
    """The bounded price-cohort inventory failed closed."""


def canonical_sha256(value: Any) -> str:
    raw = json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def parse_price_file(path: Path) -> dict[str, Any]:
    try:
        rows = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise PriceCohortError(f"invalid price JSON: {path}") from exc
    if not isinstance(rows, list) or not rows:
        raise PriceCohortError(f"empty price history: {path}")
    dates: list[str] = []
    for index, row in enumerate(rows):
        if not isinstance(row, dict) or set(row) != {"date", "close"}:
            raise PriceCohortError(f"price schema changed: {path}:{index}")
        try:
            parsed = date.fromisoformat(str(row["date"]))
            close = float(row["close"])
        except (TypeError, ValueError) as exc:
            raise PriceCohortError(f"invalid price row: {path}:{index}") from exc
        if not math.isfinite(close) or close <= 0:
            raise PriceCohortError(f"non-positive price: {path}:{index}")
        dates.append(parsed.isoformat())
    if dates != sorted(dates) or len(dates) != len(set(dates)):
        raise PriceCohortError(f"price dates are not strictly increasing: {path}")
    return {
        "rows": len(dates),
        "firstDate": dates[0],
        "lastDate": dates[-1],
        "dates": dates,
        "sha256": sha256_file(path),
        "bytes": path.stat().st_size,
    }


def candidate_rows(connection: sqlite3.Connection) -> list[tuple[str, str, str, str]]:
    return connection.execute(
        """SELECT s.dataset,s.observed_at,c.ticker,c.status
           FROM candidates c JOIN snapshots s USING(snapshot_id)
           WHERE c.status IN ('CANDIDATE_UNADJUDICATED','AMBIGUOUS')
           ORDER BY s.observed_at,s.dataset,c.ticker"""
    ).fetchall()


def audit(bridge_database: Path, prices_directory: Path) -> dict[str, Any]:
    bridge = bridge_database.expanduser().resolve()
    prices = prices_directory.expanduser().resolve()
    if not bridge.is_file() or not prices.is_dir():
        raise PriceCohortError("bridge database or prices directory missing")
    connection = sqlite3.connect(f"file:{bridge.as_posix()}?mode=ro", uri=True)
    try:
        schema = connection.execute("SELECT value FROM meta WHERE key='schema'").fetchone()
        if schema is None or schema[0] != "early-detection-entity-bridge/v2":
            raise PriceCohortError(f"unexpected bridge schema: {schema}")
        candidates = candidate_rows(connection)
    finally:
        connection.close()
    histories: dict[str, dict[str, Any] | None] = {}
    invalid_files: dict[str, str] = {}
    for ticker in sorted({row[2] for row in candidates}):
        path = prices / f"{ticker}.json"
        if not path.is_file():
            histories[ticker] = None
            continue
        try:
            histories[ticker] = parse_price_file(path)
        except PriceCohortError as exc:
            histories[ticker] = None
            invalid_files[ticker] = str(exc)
    snapshot_counts: dict[tuple[str, str], Counter[str]] = {}
    total = Counter()
    for dataset, observed_at, ticker, status in candidates:
        key = (dataset, observed_at)
        counts = snapshot_counts.setdefault(key, Counter())
        counts["rows"] += 1
        total["rows"] += 1
        history = histories[ticker]
        if history is None:
            counts["missingOrInvalidFile"] += 1
            total["missingOrInvalidFile"] += 1
            continue
        counts["currentTickerFile"] += 1
        total["currentTickerFile"] += 1
        cutoff = observed_at[:10]
        prior = bisect.bisect_right(history["dates"], cutoff)
        for threshold, label in ((1, "atLeastOnePriorBar"), (126, "atLeast126PriorBars"), (252, "atLeast252PriorBars")):
            if prior >= threshold:
                counts[label] += 1
                total[label] += 1
        horizon = (date.fromisoformat(cutoff) + timedelta(days=730)).isoformat()
        if history["lastDate"] >= horizon:
            counts["calendarTwoYearCoverage"] += 1
            total["calendarTwoYearCoverage"] += 1
    snapshots = []
    for key in sorted(snapshot_counts, key=lambda item: (item[1], item[0])):
        counts = snapshot_counts[key]
        rows = counts["rows"]
        snapshots.append({
            "dataset": key[0],
            "observedAt": key[1],
            **dict(sorted(counts.items())),
            "currentTickerFileRate": counts["currentTickerFile"] / rows if rows else 0,
            "prior252Rate": counts["atLeast252PriorBars"] / rows if rows else 0,
        })
    file_manifest = [
        {
            "ticker": ticker,
            "rows": history["rows"],
            "firstDate": history["firstDate"],
            "lastDate": history["lastDate"],
            "bytes": history["bytes"],
            "sha256": history["sha256"],
        }
        for ticker, history in sorted(histories.items()) if history is not None
    ]
    unsigned = {
        "schema": SCHEMA,
        "status": "BOUNDED_CURRENT_TICKER_CLOSE_COHORT_NOT_CONFIRMATORY",
        "bridgeDatabase": str(bridge),
        "pricesDirectory": str(prices),
        "candidateRows": len(candidates),
        "candidateTickers": len(histories),
        "validPriceFiles": len(file_manifest),
        "invalidPriceFiles": invalid_files,
        "coverage": dict(sorted(total.items())),
        "snapshotCoverage": snapshots,
        "priceFileManifestSha256": canonical_sha256(file_manifest),
        "priceFileManifest": file_manifest,
        "confirmatoryEligible": False,
        "limitations": [
            "The store is keyed by current ticker and cannot disambiguate ticker reuse or historical listing identity.",
            "Files contain date and adjusted close only; they cannot support volume, OHLC or Squeeze Momentum tests.",
            "Current adjusted values can embed later corporate-action factors and are not point-in-time feature evidence.",
            "Missing delisted and acquired symbols make this a coverage-bounded cohort, never a survivorship-safe universe.",
            "No return, technical signal, growth outcome or locked-window result is computed by this inventory.",
        ],
        "productiveGqsModified": False,
    }
    return {**unsigned, "reportSha256": canonical_sha256(unsigned)}


def self_test() -> dict[str, Any]:
    with tempfile.TemporaryDirectory() as folder:
        root = Path(folder)
        database = root / "bridge.sqlite"
        connection = sqlite3.connect(database)
        connection.executescript("""
            CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT);
            INSERT INTO meta VALUES('schema','early-detection-entity-bridge/v2');
            CREATE TABLE snapshots(snapshot_id INTEGER PRIMARY KEY,dataset TEXT,observed_at TEXT);
            CREATE TABLE candidates(snapshot_id INTEGER,ticker TEXT,status TEXT);
            INSERT INTO snapshots VALUES(1,'nasdaqlisted','2020-12-31T00:00:00.000Z');
            INSERT INTO candidates VALUES(1,'ABC','CANDIDATE_UNADJUDICATED'),(1,'MISS','AMBIGUOUS');
        """)
        connection.commit()
        connection.close()
        prices = root / "prices"
        prices.mkdir()
        rows = [{"date": (date(2020, 1, 1) + timedelta(days=index)).isoformat(), "close": 10 + index} for index in range(300)]
        (prices / "ABC.json").write_text(json.dumps(rows), encoding="utf-8")
        first = audit(database, prices)
        second = audit(database, prices)
        if first["reportSha256"] != second["reportSha256"] or first["coverage"]["currentTickerFile"] != 1:
            raise PriceCohortError("self-test price cohort changed")
        return {"status": "PASS", "deterministic": True, "validPriceFiles": first["validPriceFiles"]}


def parser() -> argparse.ArgumentParser:
    value = argparse.ArgumentParser(description=__doc__)
    sub = value.add_subparsers(dest="command", required=True)
    audit_parser = sub.add_parser("audit")
    audit_parser.add_argument("--bridge-database", type=Path, required=True)
    audit_parser.add_argument("--prices-directory", type=Path, required=True)
    audit_parser.add_argument("--output", type=Path, required=True)
    sub.add_parser("self-test")
    return value


def main() -> int:
    args = parser().parse_args()
    if args.command == "self-test":
        result = self_test()
        printed = result
    else:
        result = audit(args.bridge_database, args.prices_directory)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        printed = {
            "status": result["status"],
            "candidateRows": result["candidateRows"],
            "validPriceFiles": result["validPriceFiles"],
            "coverage": result["coverage"],
            "priceFileManifestSha256": result["priceFileManifestSha256"],
            "reportSha256": result["reportSha256"],
        }
    print(json.dumps(printed, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

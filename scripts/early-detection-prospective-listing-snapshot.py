#!/usr/bin/env python3
"""Capture free official listing snapshots for prospective point-in-time history.

The collector is deliberately non-confirmatory.  It stores immutable source
payloads and an outcome-blind observation report, but never turns issuer CIKs
or current tickers into permanent security identities and never backfills
historical listing intervals.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import os
import tempfile
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable


SCHEMA = "early-detection-prospective-listing-snapshot/v1"
SOURCES = {
    "secCompanyTickersExchange": "https://www.sec.gov/files/company_tickers_exchange.json",
    "nasdaqListed": "https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt",
    "otherListed": "https://www.nasdaqtrader.com/dynamic/SymDir/otherlisted.txt",
}


class SnapshotError(RuntimeError):
    """The prospective listing snapshot failed closed."""


def now_utc() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def canonical_sha256(value: Any) -> str:
    payload = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def immutable_write(root: Path, payload: bytes, suffix: str) -> tuple[str, Path, bool]:
    digest = sha256_bytes(payload)
    target = root / "blobs" / "sha256" / digest[:2] / f"{digest}{suffix}"
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists():
        if sha256_file(target) != digest:
            raise SnapshotError(f"existing immutable payload mismatch: {target}")
        return digest, target, False
    with tempfile.NamedTemporaryFile(
        prefix=digest + ".", suffix=".tmp", dir=target.parent, delete=False
    ) as handle:
        temporary = Path(handle.name)
        handle.write(payload)
        handle.flush()
        os.fsync(handle.fileno())
    if sha256_file(temporary) != digest:
        raise SnapshotError("temporary payload hash mismatch")
    os.replace(temporary, target)
    return digest, target, True


def fetch(url: str, user_agent: str, timeout: int) -> tuple[bytes, dict[str, str], int]:
    request = urllib.request.Request(
        url,
        headers={"User-Agent": user_agent, "Accept-Encoding": "identity"},
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        payload = response.read()
        headers = {
            key: value
            for key, value in response.headers.items()
            if key.lower() in {"date", "etag", "last-modified", "content-type", "content-length"}
        }
        return payload, headers, int(response.status)


def parse_sec(payload: bytes) -> dict[str, Any]:
    try:
        value = json.loads(payload.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise SnapshotError("invalid SEC JSON") from exc
    if value.get("fields") != ["cik", "name", "ticker", "exchange"]:
        raise SnapshotError("unexpected SEC field contract")
    rows = value.get("data")
    if not isinstance(rows, list) or not rows:
        raise SnapshotError("empty SEC mapping")
    if any(not isinstance(row, list) or len(row) != 4 for row in rows):
        raise SnapshotError("unexpected SEC row contract")
    tickers = [str(row[2]).strip() for row in rows]
    if any(not ticker for ticker in tickers):
        raise SnapshotError("blank SEC ticker")
    exchanges = [str(row[3]) for row in rows]
    return {
        "rows": len(rows),
        "uniqueCiks": len({int(row[0]) for row in rows}),
        "uniqueTickers": len(set(tickers)),
        "duplicateTickerRows": len(tickers) - len(set(tickers)),
        "exchangeCounts": {
            exchange: exchanges.count(exchange) for exchange in sorted(set(exchanges))
        },
        "tickers": sorted(set(tickers)),
    }


def parse_pipe(payload: bytes, expected_first: str) -> dict[str, Any]:
    try:
        text = payload.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise SnapshotError("invalid Nasdaq Trader text encoding") from exc
    rows = list(csv.DictReader(io.StringIO(text), delimiter="|"))
    if not rows or expected_first not in rows[0]:
        raise SnapshotError(f"unexpected Nasdaq Trader field contract: {expected_first}")
    footer = [row for row in rows if (row.get(expected_first) or "").startswith("File Creation Time:")]
    data = [row for row in rows if row not in footer and (row.get(expected_first) or "").strip()]
    symbols = [(row.get(expected_first) or "").strip() for row in data]
    return {
        "rows": len(data),
        "uniqueSymbols": len(set(symbols)),
        "duplicateSymbolRows": len(symbols) - len(set(symbols)),
        "testIssueRows": sum(1 for row in data if (row.get("Test Issue") or "").strip() == "Y"),
        "etfRows": sum(1 for row in data if (row.get("ETF") or "").strip() == "Y"),
        "footer": footer,
        "symbols": sorted(set(symbols)),
    }


Fetcher = Callable[[str, str, int], tuple[bytes, dict[str, str], int]]


def capture_snapshot(
    store_root: Path,
    output: Path,
    user_agent: str,
    timeout: int,
    fetcher: Fetcher = fetch,
    observed_at: str | None = None,
) -> dict[str, Any]:
    output = output.expanduser().resolve()
    if output.exists():
        raise SnapshotError("refusing to overwrite snapshot report")
    store = store_root.expanduser().resolve()
    observed = observed_at or now_utc()
    captures: dict[str, dict[str, Any]] = {}
    parsed: dict[str, dict[str, Any]] = {}
    for key, url in SOURCES.items():
        try:
            payload, headers, status = fetcher(url, user_agent, timeout)
        except Exception as exc:
            raise SnapshotError(f"source fetch failed: {key}: {type(exc).__name__}: {exc}") from exc
        if status != 200 or not payload:
            raise SnapshotError(f"source did not return a non-empty HTTP 200 payload: {key}")
        suffix = ".json" if key == "secCompanyTickersExchange" else ".txt"
        digest, path, created = immutable_write(store, payload, suffix)
        captures[key] = {
            "url": url,
            "httpStatus": status,
            "responseHeaders": headers,
            "payloadSha256": digest,
            "payloadBytes": len(payload),
            "payloadPath": str(path),
            "payloadCreated": created,
        }
        if key == "secCompanyTickersExchange":
            parsed[key] = parse_sec(payload)
        elif key == "nasdaqListed":
            parsed[key] = parse_pipe(payload, "Symbol")
        else:
            parsed[key] = parse_pipe(payload, "ACT Symbol")

    sec = set(parsed["secCompanyTickersExchange"].pop("tickers"))
    nasdaq = set(parsed["nasdaqListed"].pop("symbols"))
    other = set(parsed["otherListed"].pop("symbols"))
    exchange = nasdaq | other
    comparison = {
        "secUniqueTickers": len(sec),
        "nasdaqTraderUniqueSymbols": len(exchange),
        "exactTickerOverlap": len(sec & exchange),
        "secOnlyExactTicker": len(sec - exchange),
        "nasdaqTraderOnlyExactSymbol": len(exchange - sec),
        "interpretation": (
            "Exact ticker comparison is diagnostic only: symbols can differ by class notation "
            "and the sources cover different security/entity domains. It is not a permanent-identity join."
        ),
    }
    script_path = Path(__file__).resolve()
    unsigned: dict[str, Any] = {
        "schema": SCHEMA,
        "observedAt": observed,
        "status": "CAPTURED_CURRENT_STATE_FOR_PROSPECTIVE_USE",
        "collectorScript": "scripts/early-detection-prospective-listing-snapshot.py",
        "collectorScriptSha256": sha256_file(script_path),
        "captures": captures,
        "parsedCounts": parsed,
        "crossSourceDiagnostic": comparison,
        "pointInTimeRule": (
            "The payloads establish only state observed at observedAt. Repeated snapshots may bound "
            "future listing intervals; they never backfill 2009-2024 or establish an exchange-effective "
            "first/final trading session by themselves."
        ),
        "knownLimitations": [
            "Issuer CIK is not a permanent security identifier.",
            "Ticker notation and coverage differ across SEC and Nasdaq Trader files.",
            "Daily snapshots bound changes between observations but do not prove exact intraday effective times.",
            "This snapshot contains no OHLCV, corporate-action factor or delisting return.",
        ],
        "confirmatoryEligible": False,
        "resultComputationAllowed": False,
        "outcomesAccessed": False,
        "productiveGqsModified": False,
    }
    result = {**unsigned, "reportSha256": canonical_sha256(unsigned)}
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return result


def fixture_payloads() -> dict[str, bytes]:
    sec = {
        "fields": ["cik", "name", "ticker", "exchange"],
        "data": [[1, "Alpha", "AAA", "Nasdaq"], [2, "Beta", "BBB", "NYSE"]],
    }
    nasdaq = (
        "Symbol|Security Name|Market Category|Test Issue|Financial Status|Round Lot Size|ETF|NextShares\n"
        "AAA|Alpha|Q|N|N|100|N|N\n"
        "File Creation Time: 0101202600:00|||||||\n"
    )
    other = (
        "ACT Symbol|Security Name|Exchange|CQS Symbol|ETF|Round Lot Size|Test Issue|NASDAQ Symbol\n"
        "BBB|Beta|N|BBB|N|100|N|BBB\n"
        "File Creation Time: 0101202600:00|||||||\n"
    )
    return {
        "secCompanyTickersExchange": json.dumps(sec).encode("utf-8"),
        "nasdaqListed": nasdaq.encode("utf-8"),
        "otherListed": other.encode("utf-8"),
    }


def self_test() -> dict[str, Any]:
    payloads = fixture_payloads()

    def fake_fetch(url: str, _user_agent: str, _timeout: int) -> tuple[bytes, dict[str, str], int]:
        key = next(key for key, source_url in SOURCES.items() if source_url == url)
        return payloads[key], {"Date": "Thu, 01 Jan 2026 00:00:00 GMT"}, 200

    with tempfile.TemporaryDirectory() as folder:
        root = Path(folder)
        output = root / "snapshot.json"
        result = capture_snapshot(
            root / "store",
            output,
            "fixture-agent",
            1,
            fetcher=fake_fetch,
            observed_at="2026-01-01T00:00:00.000Z",
        )
        overwrite_rejected = False
        try:
            capture_snapshot(root / "store", output, "fixture-agent", 1, fetcher=fake_fetch)
        except SnapshotError:
            overwrite_rejected = True
        first_digest, first_path, first_created = immutable_write(root / "store", b"same", ".bin")
        second_digest, second_path, second_created = immutable_write(root / "store", b"same", ".bin")
        if not (
            result["crossSourceDiagnostic"]["exactTickerOverlap"] == 2
            and result["resultComputationAllowed"] is False
            and overwrite_rejected
            and first_digest == second_digest
            and first_path == second_path
            and first_created
            and not second_created
        ):
            raise SnapshotError("self-test invariant failed")
    return {
        "status": "PASS",
        "overwriteRejected": overwrite_rejected,
        "immutableDeduplication": True,
        "resultComputationAllowed": False,
    }


def parser() -> argparse.ArgumentParser:
    value = argparse.ArgumentParser(description=__doc__)
    commands = value.add_subparsers(dest="command", required=True)
    capture = commands.add_parser("capture")
    capture.add_argument("--store-root", type=Path, required=True)
    capture.add_argument("--output", type=Path, required=True)
    capture.add_argument("--timeout", type=int, default=30)
    capture.add_argument(
        "--user-agent",
        default="GrowthScreenerResearch/1.0 research@example.invalid",
    )
    commands.add_parser("self-test")
    return value


def main() -> int:
    args = parser().parse_args()
    if args.command == "self-test":
        print(json.dumps(self_test(), ensure_ascii=False, sort_keys=True))
        return 0
    result = capture_snapshot(args.store_root, args.output, args.user_agent, args.timeout)
    print(
        json.dumps(
            {
                "status": result["status"],
                "observedAt": result["observedAt"],
                "secRows": result["parsedCounts"]["secCompanyTickersExchange"]["rows"],
                "nasdaqRows": result["parsedCounts"]["nasdaqListed"]["rows"],
                "otherRows": result["parsedCounts"]["otherListed"]["rows"],
                "exactTickerOverlap": result["crossSourceDiagnostic"]["exactTickerOverlap"],
                "output": str(args.output.expanduser().resolve()),
                "reportSha256": result["reportSha256"],
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

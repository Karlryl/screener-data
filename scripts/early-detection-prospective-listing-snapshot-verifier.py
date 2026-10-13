#!/usr/bin/env python3
"""Independently rehash and reparse a prospective listing snapshot."""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


SNAPSHOT_SCHEMA = "early-detection-prospective-listing-snapshot/v1"
VERIFICATION_SCHEMA = "early-detection-prospective-listing-snapshot-verification/v1"
PANEL_SCHEMA = "early-detection-prospective-listing-panel/v1"
EXPECTED_SOURCES = {
    "secCompanyTickersExchange": "https://www.sec.gov/files/company_tickers_exchange.json",
    "nasdaqListed": "https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt",
    "otherListed": "https://www.nasdaqtrader.com/dynamic/SymDir/otherlisted.txt",
}


class VerificationError(RuntimeError):
    """The independent prospective-snapshot verification failed closed."""


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


def parse_sec(payload: bytes) -> dict[str, Any]:
    value = json.loads(payload.decode("utf-8"))
    if value.get("fields") != ["cik", "name", "ticker", "exchange"]:
        raise VerificationError("unexpected SEC field contract")
    rows = value.get("data")
    if not isinstance(rows, list) or not rows:
        raise VerificationError("empty SEC mapping")
    if any(not isinstance(row, list) or len(row) != 4 for row in rows):
        raise VerificationError("unexpected SEC row contract")
    tickers = [str(row[2]).strip() for row in rows]
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
    rows = list(csv.DictReader(io.StringIO(payload.decode("utf-8-sig")), delimiter="|"))
    if not rows or expected_first not in rows[0]:
        raise VerificationError(f"unexpected Nasdaq Trader field contract: {expected_first}")
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


def is_below(path: Path, root: Path) -> bool:
    try:
        path.relative_to(root)
        return True
    except ValueError:
        return False


def verify_snapshot(snapshot_path: Path, store_root: Path, output: Path) -> dict[str, Any]:
    snapshot_path = snapshot_path.expanduser().resolve()
    store_root = store_root.expanduser().resolve()
    output = output.expanduser().resolve()
    if output.exists():
        raise VerificationError("refusing to overwrite verification output")
    snapshot = json.loads(snapshot_path.read_text(encoding="utf-8-sig"))
    failures: list[str] = []
    unsigned_snapshot = dict(snapshot)
    claimed = unsigned_snapshot.pop("reportSha256", None)
    signature_valid = canonical_sha256(unsigned_snapshot) == claimed
    if not signature_valid:
        failures.append("SNAPSHOT_SIGNATURE")
    if snapshot.get("schema") != SNAPSHOT_SCHEMA:
        failures.append("SNAPSHOT_SCHEMA")
    if set(snapshot.get("captures", {})) != set(EXPECTED_SOURCES):
        failures.append("SOURCE_SET")
    for flag in ("confirmatoryEligible", "resultComputationAllowed", "outcomesAccessed", "productiveGqsModified"):
        if snapshot.get(flag) is not False:
            failures.append(f"FORBIDDEN_FLAG:{flag}")

    parsed: dict[str, dict[str, Any]] = {}
    payloads: dict[str, dict[str, Any]] = {}
    for key in sorted(EXPECTED_SOURCES):
        item = snapshot.get("captures", {}).get(key)
        if not isinstance(item, dict):
            continue
        if item.get("url") != EXPECTED_SOURCES[key] or item.get("httpStatus") != 200:
            failures.append(f"SOURCE_CONTRACT:{key}")
        path = Path(str(item.get("payloadPath", ""))).expanduser().resolve()
        if not is_below(path, store_root):
            failures.append(f"PAYLOAD_OUTSIDE_STORE:{key}")
            continue
        if not path.is_file():
            failures.append(f"PAYLOAD_MISSING:{key}")
            continue
        payload = path.read_bytes()
        digest = sha256_bytes(payload)
        if digest != item.get("payloadSha256"):
            failures.append(f"PAYLOAD_HASH:{key}")
        if len(payload) != item.get("payloadBytes"):
            failures.append(f"PAYLOAD_BYTES:{key}")
        payloads[key] = {"path": str(path), "sha256": digest, "bytes": len(payload)}
        try:
            if key == "secCompanyTickersExchange":
                parsed[key] = parse_sec(payload)
            elif key == "nasdaqListed":
                parsed[key] = parse_pipe(payload, "Symbol")
            else:
                parsed[key] = parse_pipe(payload, "ACT Symbol")
        except (UnicodeDecodeError, json.JSONDecodeError, VerificationError, ValueError) as exc:
            failures.append(f"PAYLOAD_PARSE:{key}:{type(exc).__name__}")

    if set(parsed) == set(EXPECTED_SOURCES):
        sec = set(parsed["secCompanyTickersExchange"].pop("tickers"))
        nasdaq = set(parsed["nasdaqListed"].pop("symbols"))
        other = set(parsed["otherListed"].pop("symbols"))
        exchange = nasdaq | other
        recomputed = {
            "secUniqueTickers": len(sec),
            "nasdaqTraderUniqueSymbols": len(exchange),
            "exactTickerOverlap": len(sec & exchange),
            "secOnlyExactTicker": len(sec - exchange),
            "nasdaqTraderOnlyExactSymbol": len(exchange - sec),
        }
    else:
        recomputed = {}
    expected_counts = snapshot.get("parsedCounts", {})
    parsed_counts_reproduced = parsed == expected_counts
    if not parsed_counts_reproduced:
        failures.append("PARSED_COUNTS")
    claimed_comparison = {
        key: value
        for key, value in snapshot.get("crossSourceDiagnostic", {}).items()
        if key != "interpretation"
    }
    comparison_reproduced = recomputed == claimed_comparison
    if not comparison_reproduced:
        failures.append("CROSS_SOURCE_DIAGNOSTIC")

    report_tampered = dict(unsigned_snapshot)
    report_tampered["status"] = "TAMPERED"
    report_tamper_detected = canonical_sha256(report_tampered) != claimed
    first = next(iter(payloads.values()), None)
    if first is None:
        payload_tamper_detected = False
    else:
        first_bytes = Path(first["path"]).read_bytes()
        changed = bytes([first_bytes[0] ^ 1]) + first_bytes[1:] if first_bytes else b"x"
        payload_tamper_detected = sha256_bytes(changed) != first["sha256"]
    if not report_tamper_detected:
        failures.append("REPORT_TAMPER_PROBE")
    if not payload_tamper_detected:
        failures.append("PAYLOAD_TAMPER_PROBE")

    failures = sorted(set(failures))
    unsigned: dict[str, Any] = {
        "schema": VERIFICATION_SCHEMA,
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
        "status": "PASS" if not failures else "FAIL",
        "snapshot": str(snapshot_path),
        "snapshotFileSha256": sha256_file(snapshot_path),
        "snapshotReportSha256": claimed,
        "storeRoot": str(store_root),
        "checks": {
            "snapshotSignatureValid": signature_valid,
            "sourceSetExact": set(snapshot.get("captures", {})) == set(EXPECTED_SOURCES),
            "payloadsRehashed": len(payloads),
            "payloadsReparsed": len(parsed),
            "parsedCountsReproduced": parsed_counts_reproduced,
            "crossSourceDiagnosticReproduced": comparison_reproduced,
            "reportTamperDetected": report_tamper_detected,
            "payloadTamperDetected": payload_tamper_detected,
        },
        "payloads": payloads,
        "failures": failures,
        "resultComputationAllowed": False,
        "outcomesAccessed": False,
        "productiveGqsModified": False,
    }
    result = {**unsigned, "reportSha256": canonical_sha256(unsigned)}
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return result


def load_snapshot_symbols(snapshot_path: Path, store_root: Path) -> tuple[dict[str, Any], dict[str, set[str]]]:
    snapshot = json.loads(snapshot_path.read_text(encoding="utf-8-sig"))
    unsigned = dict(snapshot)
    claimed = unsigned.pop("reportSha256", None)
    if canonical_sha256(unsigned) != claimed:
        raise VerificationError(f"snapshot signature invalid: {snapshot_path}")
    if snapshot.get("schema") != SNAPSHOT_SCHEMA or set(snapshot.get("captures", {})) != set(EXPECTED_SOURCES):
        raise VerificationError(f"snapshot source contract invalid: {snapshot_path}")
    symbols: dict[str, set[str]] = {}
    for key in sorted(EXPECTED_SOURCES):
        item = snapshot["captures"][key]
        path = Path(str(item["payloadPath"])).expanduser().resolve()
        if not is_below(path, store_root) or not path.is_file():
            raise VerificationError(f"snapshot payload unavailable inside store: {key}")
        payload = path.read_bytes()
        if sha256_bytes(payload) != item.get("payloadSha256") or len(payload) != item.get("payloadBytes"):
            raise VerificationError(f"snapshot payload hash mismatch: {key}")
        if key == "secCompanyTickersExchange":
            symbols[key] = set(parse_sec(payload).pop("tickers"))
        elif key == "nasdaqListed":
            symbols[key] = set(parse_pipe(payload, "Symbol").pop("symbols"))
        else:
            symbols[key] = set(parse_pipe(payload, "ACT Symbol").pop("symbols"))
    return snapshot, symbols


def compare_snapshots(first_path: Path, second_path: Path, store_root: Path, output: Path) -> dict[str, Any]:
    first_path = first_path.expanduser().resolve()
    second_path = second_path.expanduser().resolve()
    store_root = store_root.expanduser().resolve()
    output = output.expanduser().resolve()
    if output.exists():
        raise VerificationError("refusing to overwrite panel output")
    first, first_symbols = load_snapshot_symbols(first_path, store_root)
    second, second_symbols = load_snapshot_symbols(second_path, store_root)
    first_time = datetime.fromisoformat(str(first["observedAt"]).replace("Z", "+00:00"))
    second_time = datetime.fromisoformat(str(second["observedAt"]).replace("Z", "+00:00"))
    if not first_time < second_time:
        raise VerificationError("snapshot chronology is not strictly increasing")
    deltas: dict[str, dict[str, Any]] = {}
    for key in sorted(EXPECTED_SOURCES):
        before = first_symbols[key]
        after = second_symbols[key]
        first_hash = first["captures"][key]["payloadSha256"]
        second_hash = second["captures"][key]["payloadSha256"]
        deltas[key] = {
            "firstPayloadSha256": first_hash,
            "secondPayloadSha256": second_hash,
            "payloadChanged": first_hash != second_hash,
            "firstSymbolCount": len(before),
            "secondSymbolCount": len(after),
            "addedCount": len(after - before),
            "removedCount": len(before - after),
            "addedSymbols": sorted(after - before),
            "removedSymbols": sorted(before - after),
        }
    unsigned: dict[str, Any] = {
        "schema": PANEL_SCHEMA,
        "status": "PASS_PROSPECTIVE_INTERVAL_DELTAS_BOUND_HISTORICAL_GATE_REMAINS_RED",
        "firstSnapshot": str(first_path),
        "firstSnapshotFileSha256": sha256_file(first_path),
        "firstObservedAt": first["observedAt"],
        "secondSnapshot": str(second_path),
        "secondSnapshotFileSha256": sha256_file(second_path),
        "secondObservedAt": second["observedAt"],
        "storeRoot": str(store_root),
        "sourceDeltas": deltas,
        "interpretation": (
            "The two verified observations prove bounded source-state changes only. They do not identify "
            "the exact effective instant, a permanent security identity, OHLCV, an adjustment factor or a delisting return."
        ),
        "historical2009To2024GateClosed": False,
        "confirmatoryEligible": False,
        "resultComputationAllowed": False,
        "outcomesAccessed": False,
        "productiveGqsModified": False,
    }
    result = {**unsigned, "reportSha256": canonical_sha256(unsigned)}
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return result


def fixture_snapshot(root: Path) -> Path:
    store = root / "store"
    payload_values = {
        "secCompanyTickersExchange": json.dumps(
            {
                "fields": ["cik", "name", "ticker", "exchange"],
                "data": [[1, "Alpha", "AAA", "Nasdaq"], [2, "Beta", "BBB", "NYSE"]],
            }
        ).encode("utf-8"),
        "nasdaqListed": (
            "Symbol|Security Name|Market Category|Test Issue|Financial Status|Round Lot Size|ETF|NextShares\n"
            "AAA|Alpha|Q|N|N|100|N|N\n"
            "File Creation Time: 0101202600:00|||||||\n"
        ).encode("utf-8"),
        "otherListed": (
            "ACT Symbol|Security Name|Exchange|CQS Symbol|ETF|Round Lot Size|Test Issue|NASDAQ Symbol\n"
            "BBB|Beta|N|BBB|N|100|N|BBB\n"
            "File Creation Time: 0101202600:00|||||||\n"
        ).encode("utf-8"),
    }
    captures: dict[str, dict[str, Any]] = {}
    parsed: dict[str, dict[str, Any]] = {}
    symbol_sets: dict[str, set[str]] = {}
    for key, payload in payload_values.items():
        digest = sha256_bytes(payload)
        suffix = ".json" if key == "secCompanyTickersExchange" else ".txt"
        path = store / "blobs" / "sha256" / digest[:2] / f"{digest}{suffix}"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(payload)
        captures[key] = {
            "url": EXPECTED_SOURCES[key],
            "httpStatus": 200,
            "responseHeaders": {},
            "payloadSha256": digest,
            "payloadBytes": len(payload),
            "payloadPath": str(path.resolve()),
            "payloadCreated": True,
        }
        if key == "secCompanyTickersExchange":
            item = parse_sec(payload)
            symbol_sets[key] = set(item.pop("tickers"))
        elif key == "nasdaqListed":
            item = parse_pipe(payload, "Symbol")
            symbol_sets[key] = set(item.pop("symbols"))
        else:
            item = parse_pipe(payload, "ACT Symbol")
            symbol_sets[key] = set(item.pop("symbols"))
        parsed[key] = item
    sec = symbol_sets["secCompanyTickersExchange"]
    exchange = symbol_sets["nasdaqListed"] | symbol_sets["otherListed"]
    unsigned = {
        "schema": SNAPSHOT_SCHEMA,
        "observedAt": "2026-01-01T00:00:00.000Z",
        "status": "CAPTURED_CURRENT_STATE_FOR_PROSPECTIVE_USE",
        "captures": captures,
        "parsedCounts": parsed,
        "crossSourceDiagnostic": {
            "secUniqueTickers": len(sec),
            "nasdaqTraderUniqueSymbols": len(exchange),
            "exactTickerOverlap": len(sec & exchange),
            "secOnlyExactTicker": len(sec - exchange),
            "nasdaqTraderOnlyExactSymbol": len(exchange - sec),
            "interpretation": "fixture",
        },
        "pointInTimeRule": "fixture",
        "knownLimitations": [],
        "confirmatoryEligible": False,
        "resultComputationAllowed": False,
        "outcomesAccessed": False,
        "productiveGqsModified": False,
    }
    snapshot = {**unsigned, "reportSha256": canonical_sha256(unsigned)}
    path = root / "snapshot.json"
    path.write_text(json.dumps(snapshot), encoding="utf-8")
    return path


def self_test() -> dict[str, Any]:
    with tempfile.TemporaryDirectory() as folder:
        root = Path(folder)
        snapshot_path = fixture_snapshot(root)
        valid = verify_snapshot(snapshot_path, root / "store", root / "valid-report.json")
        tampered = json.loads(snapshot_path.read_text(encoding="utf-8"))
        tampered["status"] = "TAMPERED"
        tampered_path = root / "tampered.json"
        tampered_path.write_text(json.dumps(tampered), encoding="utf-8")
        rejected = verify_snapshot(tampered_path, root / "store", root / "tampered-report.json")
        second = json.loads(snapshot_path.read_text(encoding="utf-8"))
        second.pop("reportSha256")
        second["observedAt"] = "2026-01-02T00:00:00.000Z"
        second["reportSha256"] = canonical_sha256(second)
        second_path = root / "snapshot-2.json"
        second_path.write_text(json.dumps(second), encoding="utf-8")
        panel = compare_snapshots(snapshot_path, second_path, root / "store", root / "panel.json")
        if (
            valid["status"] != "PASS"
            or rejected["status"] != "FAIL"
            or "SNAPSHOT_SIGNATURE" not in rejected["failures"]
            or panel["historical2009To2024GateClosed"] is not False
        ):
            raise VerificationError("self-test invariant failed")
    return {
        "status": "PASS",
        "panelCompared": True,
        "validSnapshotAccepted": True,
        "tamperedSnapshotRejected": True,
    }


def parser() -> argparse.ArgumentParser:
    value = argparse.ArgumentParser(description=__doc__)
    commands = value.add_subparsers(dest="command", required=True)
    verify = commands.add_parser("verify")
    verify.add_argument("--snapshot", type=Path, required=True)
    verify.add_argument("--store-root", type=Path, required=True)
    verify.add_argument("--output", type=Path, required=True)
    compare = commands.add_parser("compare")
    compare.add_argument("--first-snapshot", type=Path, required=True)
    compare.add_argument("--second-snapshot", type=Path, required=True)
    compare.add_argument("--store-root", type=Path, required=True)
    compare.add_argument("--output", type=Path, required=True)
    commands.add_parser("self-test")
    return value


def main() -> int:
    args = parser().parse_args()
    if args.command == "self-test":
        print(json.dumps(self_test(), ensure_ascii=False, sort_keys=True))
        return 0
    if args.command == "compare":
        result = compare_snapshots(
            args.first_snapshot,
            args.second_snapshot,
            args.store_root,
            args.output,
        )
        print(
            json.dumps(
                {
                    "status": result["status"],
                    "firstObservedAt": result["firstObservedAt"],
                    "secondObservedAt": result["secondObservedAt"],
                    "sourceDeltas": result["sourceDeltas"],
                    "output": str(args.output.expanduser().resolve()),
                    "reportSha256": result["reportSha256"],
                },
                ensure_ascii=False,
                indent=2,
            )
        )
        return 0
    result = verify_snapshot(args.snapshot, args.store_root, args.output)
    print(
        json.dumps(
            {
                "status": result["status"],
                "checks": result["checks"],
                "failures": result["failures"],
                "output": str(args.output.expanduser().resolve()),
                "reportSha256": result["reportSha256"],
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0 if result["status"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())

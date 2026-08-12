#!/usr/bin/env python3
"""Build and verify a fail-closed monthly gap matrix for Nasdaq directory snapshots."""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import os
import tempfile
from pathlib import Path
from typing import Any, Callable


ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "research" / "early-detection-v4" / "nasdaq-symbol-directory-monthly-gap-matrix-contract-v1.json"
INPUT = ROOT / "reports" / "early-detection" / "nasdaq-symbol-directory-wayback-snapshots-2009-2024-v2.json"
OUTPUT = ROOT / "reports" / "early-detection" / "nasdaq-symbol-directory-monthly-gap-matrix-v1.json"
EXPECTED_RAW = "cc499b7cbaa9b585ba4fff6510623c2a6898360e16386edcf8546023fc62103e"
EXPECTED_SELF = "70d1c5b7c2c8f8343241f22a4722863538187fdf0ff2e5290947846a967d3a69"
INPUT_RAW = "c653dd26a12e2c5adb149f2035c22c293b595b576d7a02bd04a6f31aa2a080fd"
INPUT_REPORT = "34584a6206d7b2035dd463692ba605dd7d6e7dd4ce8c6f44850bcf7bad2dfb23"
KINDS = ["NASDAQ", "OTHER_LISTED"]


class GapError(RuntimeError):
    pass


def fail(message: str) -> None:
    raise GapError(message)


def canonical(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def sha(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def exact_keys(value: Any, expected: set[str], label: str) -> None:
    if not isinstance(value, dict) or set(value) != expected:
        fail(f"{label} exact keys changed")


def months() -> list[str]:
    return [f"{year:04d}-{month:02d}" for year in range(2009, 2025) for month in range(1, 13)]


def validate_contract() -> dict[str, Any]:
    raw = CONTRACT.read_bytes()
    if sha(raw) != EXPECTED_RAW:
        fail("contract raw bytes changed")
    value = json.loads(raw)
    body = dict(value)
    claim = body.pop("contractSha256", None)
    if claim != EXPECTED_SELF or sha(canonical(body)) != EXPECTED_SELF:
        fail("contract self hash changed")
    exact_keys(value, {"schema", "createdAt", "taskId", "sourceId", "track", "purpose", "input", "matrixContract", "output", "claimLocks", "contractSha256"}, "contract")
    if value["schema"] != "early-detection-nasdaq-symbol-directory-monthly-gap-matrix-contract/v1" or value["taskId"] != "Q005-US-EXCHANGE-PUBLIC-CATALOGS" or value["sourceId"] != "NASDAQ_SYMBOL_DIRECTORY_ARCHIVE" or value["track"] != "SHARED_OUTCOME_BLIND_INFRA":
        fail("contract boundary changed")
    if value["input"] != {
        "path": "reports/early-detection/nasdaq-symbol-directory-wayback-snapshots-2009-2024-v2.json",
        "rawSha256": INPUT_RAW,
        "reportSha256": INPUT_REPORT,
        "introductionCommit": "d3e540c642066b69a1618be986948c05fcbc9764",
        "periodStart": "2009-01",
        "periodEnd": "2024-12",
        "snapshotKinds": KINDS,
        "snapshots": 103,
        "observations": 434214,
    }:
        fail("input contract changed")
    if value["matrixContract"] != {
        "monthCount": 192,
        "cellCount": 384,
        "oneCellPerMonthAndKind": True,
        "cellStates": ["MISSING_ARCHIVE_SNAPSHOT", "ONE_ARCHIVE_SNAPSHOT", "MULTIPLE_ARCHIVE_SNAPSHOTS"],
        "positivePresenceOnly": True,
        "continuousIntervalInferenceAllowed": False,
        "firstOrLastTradingDateInferenceAllowed": False,
        "permanentSecurityIdentityInferenceAllowed": False,
        "outcomesAccessed": False,
    }:
        fail("matrix contract changed")
    if value["output"] != {"path": "reports/early-detection/nasdaq-symbol-directory-monthly-gap-matrix-v1.json", "writeNewAtomic": True}:
        fail("output contract changed")
    if any(value["claimLocks"].values()):
        fail("claim lock opened")
    return value


def load_input() -> dict[str, Any]:
    raw = INPUT.read_bytes()
    if sha(raw) != INPUT_RAW:
        fail("input raw bytes changed")
    value = json.loads(raw)
    body = dict(value)
    claim = body.pop("reportSha256", None)
    if claim != INPUT_REPORT or sha(canonical(body)) != INPUT_REPORT:
        fail("input self hash changed")
    if value.get("status") != "ARCHIVE_SNAPSHOT_EVIDENCE_COMPLETE" or value.get("confirmatoryEligible") is not False or value.get("outcomesAccessed") is not False or value.get("snapshots") != 103 or value.get("observations") != 434214:
        fail("input boundary changed")
    if value.get("limitations") != [
        "Archive snapshots prove positive directory presence only at captured as-of states.",
        "Sparse captures cannot establish exact first or final trading dates or continuous presence between snapshots.",
        "Nasdaq directory symbols are not permanent security identifiers and require ticker-reuse adjudication.",
        "Directory snapshots contain no adjusted OHLCV or delisting returns.",
    ]:
        fail("input limitations changed")
    return value


def build_cells(value: dict[str, Any]) -> list[dict[str, Any]]:
    grouped: dict[tuple[str, str], list[dict[str, Any]]] = {}
    evidence = value.get("snapshotEvidence")
    if not isinstance(evidence, list) or len(evidence) != 103:
        fail("snapshot evidence changed")
    for row in evidence:
        timestamp = row.get("captureTimestamp")
        kind = row.get("kind")
        if not isinstance(timestamp, str) or len(timestamp) != 14 or kind not in KINDS:
            fail("snapshot identity changed")
        month = f"{timestamp[:4]}-{timestamp[4:6]}"
        grouped.setdefault((month, kind), []).append(row)
    cells = []
    rank = 0
    for month in months():
        for kind in KINDS:
            rank += 1
            rows = sorted(grouped.get((month, kind), []), key=lambda row: (row["captureTimestamp"], row["payloadSha256"]))
            count = len(rows)
            state = "MISSING_ARCHIVE_SNAPSHOT" if count == 0 else "ONE_ARCHIVE_SNAPSHOT" if count == 1 else "MULTIPLE_ARCHIVE_SNAPSHOTS"
            cells.append({
                "cellRank": rank,
                "cellId": f"{month}|{kind}",
                "month": month,
                "kind": kind,
                "state": state,
                "snapshotCount": count,
                "snapshotIds": [row["snapshotId"] for row in rows],
                "captureTimestamps": [row["captureTimestamp"] for row in rows],
                "payloadSha256": [row["payloadSha256"] for row in rows],
                "positivePresenceOnly": True,
                "continuousIntervalProven": False,
                "outcomesAccessed": False,
            })
    return cells


def build_report(contract: dict[str, Any], source: dict[str, Any], cells: list[dict[str, Any]]) -> dict[str, Any]:
    state_counts: dict[str, int] = {}
    for cell in cells:
        state_counts[cell["state"]] = state_counts.get(cell["state"], 0) + 1
    month_set = {cell["month"] for cell in cells if cell["snapshotCount"] > 0}
    both = sum(all(any(cell["month"] == month and cell["kind"] == kind and cell["snapshotCount"] > 0 for cell in cells) for kind in KINDS) for month in months())
    value = {
        "schema": "early-detection-nasdaq-symbol-directory-monthly-gap-matrix/v1",
        "taskId": contract["taskId"],
        "sourceId": contract["sourceId"],
        "track": contract["track"],
        "contractRawSha256": sha(CONTRACT.read_bytes()),
        "contractSha256": contract["contractSha256"],
        "inputRawSha256": INPUT_RAW,
        "inputReportSha256": INPUT_REPORT,
        "population": {
            "months": 192,
            "cells": 384,
            "snapshots": 103,
            "observations": 434214,
            "monthsWithAnySnapshot": len(month_set),
            "monthsWithBothKinds": both,
            "monthsWithNoSnapshot": 192 - len(month_set),
            "byCellState": dict(sorted(state_counts.items())),
        },
        "cells": cells,
        "interpretationLocks": {
            "positivePresenceOnly": True,
            "missingSnapshotIsNotAbsenceEvidence": True,
            "continuousIntervalInferenceAllowed": False,
            "firstOrLastTradingDateInferenceAllowed": False,
            "permanentSecurityIdentityInferenceAllowed": False,
        },
        "claimLocks": contract["claimLocks"],
        "outcomesAccessed": False,
    }
    value["reportSha256"] = sha(canonical(value))
    return value


def validate_report(value: dict[str, Any], contract: dict[str, Any], source: dict[str, Any]) -> None:
    exact_keys(value, {"schema", "taskId", "sourceId", "track", "contractRawSha256", "contractSha256", "inputRawSha256", "inputReportSha256", "population", "cells", "interpretationLocks", "claimLocks", "outcomesAccessed", "reportSha256"}, "report")
    body = dict(value)
    claim = body.pop("reportSha256", None)
    if claim != sha(canonical(body)) or value["schema"] != "early-detection-nasdaq-symbol-directory-monthly-gap-matrix/v1":
        fail("report self hash changed")
    if value["contractRawSha256"] != sha(CONTRACT.read_bytes()) or value["contractSha256"] != contract["contractSha256"] or value["inputRawSha256"] != INPUT_RAW or value["inputReportSha256"] != INPUT_REPORT:
        fail("report binding changed")
    expected = build_cells(source)
    if value["cells"] != expected:
        fail("report cells do not match rebuild")
    if len(value["cells"]) != 384 or [row["cellRank"] for row in value["cells"]] != list(range(1, 385)) or len({row["cellId"] for row in value["cells"]}) != 384:
        fail("cell population changed")
    counts: dict[str, int] = {}
    for row in value["cells"]:
        counts[row["state"]] = counts.get(row["state"], 0) + 1
        if row["positivePresenceOnly"] is not True or row["continuousIntervalProven"] is not False or row["outcomesAccessed"] is not False:
            fail("cell interpretation changed")
    month_set = {row["month"] for row in value["cells"] if row["snapshotCount"] > 0}
    both = sum(all(any(row["month"] == month and row["kind"] == kind and row["snapshotCount"] > 0 for row in value["cells"]) for kind in KINDS) for month in months())
    if value["population"] != {"months": 192, "cells": 384, "snapshots": 103, "observations": 434214, "monthsWithAnySnapshot": len(month_set), "monthsWithBothKinds": both, "monthsWithNoSnapshot": 192 - len(month_set), "byCellState": dict(sorted(counts.items()))}:
        fail("population counts changed")
    if value["interpretationLocks"] != {"positivePresenceOnly": True, "missingSnapshotIsNotAbsenceEvidence": True, "continuousIntervalInferenceAllowed": False, "firstOrLastTradingDateInferenceAllowed": False, "permanentSecurityIdentityInferenceAllowed": False}:
        fail("interpretation lock changed")
    if value["claimLocks"] != contract["claimLocks"] or any(value["claimLocks"].values()) or value["outcomesAccessed"] is not False:
        fail("claim boundary changed")


def write_new(path: Path, raw: bytes) -> None:
    if path.exists():
        fail("output exists")
    descriptor, name = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    temporary = Path(name)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(raw)
            handle.flush()
            os.fsync(handle.fileno())
        os.link(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def rejected(action: Callable[[], None]) -> bool:
    try:
        action()
    except (GapError, KeyError, TypeError, ValueError, OSError, json.JSONDecodeError):
        return True
    return False


def self_test(contract: dict[str, Any], source: dict[str, Any]) -> dict[str, Any]:
    report = build_report(contract, source, build_cells(source))
    validate_report(report, contract, source)
    kills = {}
    for name, mutate in {
        "missingAsAbsenceEvidence": lambda x: x["interpretationLocks"].__setitem__("missingSnapshotIsNotAbsenceEvidence", False),
        "continuousIntervalClaim": lambda x: x["cells"][0].__setitem__("continuousIntervalProven", True),
        "originalV4Credit": lambda x: x["claimLocks"].__setitem__("originalV4GateCredit", True),
        "cellRemoved": lambda x: x["cells"].pop(),
        "snapshotCountChanged": lambda x: x["cells"][0].__setitem__("snapshotCount", 99),
    }.items():
        item = copy.deepcopy(report)
        mutate(item)
        item["reportSha256"] = sha(canonical({key: val for key, val in item.items() if key != "reportSha256"}))
        kills[name] = rejected(lambda item=item: validate_report(item, contract, source))
    return {"schema": "early-detection-nasdaq-symbol-directory-monthly-gap-matrix-self-test/v1", "status": "PASS", "kills": kills, "outcomesAccessed": False}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=("verify-contract", "self-test", "build", "verify-output"))
    args = parser.parse_args()
    try:
        contract = validate_contract()
        source = load_input()
        if args.command == "verify-contract":
            result = {"schema": "early-detection-nasdaq-symbol-directory-monthly-gap-matrix-contract-verification/v1", "status": "PASS", "contractSha256": contract["contractSha256"], "outcomesAccessed": False}
        elif args.command == "self-test":
            result = self_test(contract, source)
        elif args.command == "build":
            cells = build_cells(source)
            report = build_report(contract, source, cells)
            validate_report(report, contract, source)
            raw = json.dumps(report, ensure_ascii=False, sort_keys=True, indent=2).encode("utf-8") + b"\n"
            write_new(OUTPUT, raw)
            result = {"schema": "early-detection-nasdaq-symbol-directory-monthly-gap-matrix-build/v1", "status": "PASS", "output": OUTPUT.relative_to(ROOT).as_posix(), "rawSha256": sha(raw), "reportSha256": report["reportSha256"], "cells": 384, "outcomesAccessed": False}
        else:
            report = json.loads(OUTPUT.read_bytes())
            validate_report(report, contract, source)
            result = {"schema": "early-detection-nasdaq-symbol-directory-monthly-gap-matrix-verification/v1", "status": "PASS", "rawSha256": sha(OUTPUT.read_bytes()), "reportSha256": report["reportSha256"], "sourceRebuildVerified": True, "cells": 384, "outcomesAccessed": False}
    except (GapError, KeyError, TypeError, ValueError, OSError, json.JSONDecodeError) as exc:
        parser.error(str(exc))
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

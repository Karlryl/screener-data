#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CASES = ROOT / "research" / "early-detection-v4" / "quantconnect-free-cloud-pilot-cases-v1.json"
CONTRACT = ROOT / "research" / "early-detection-v4" / "quantconnect-free-cloud-pilot-contract-v1.json"
CLOUD_SCRIPT = ROOT / "scripts" / "quantconnect-free-cloud-metadata-pilot-v1.py"
CATEGORIES = {
    "ACTIVE_STABLE": 8,
    "SYMBOL_CHANGE": 6,
    "MULTI_SHARE_CLASS": 6,
    "CASH_MERGER": 8,
    "STOCK_OR_MIXED_MERGER": 5,
    "REVERSE_SPLIT": 5,
    "BANKRUPTCY_OTC_CONTINUATION": 8,
    "NO_FINAL_VISIBLE_BAR_SENTINEL": 4,
}
FORBIDDEN = {"RETURN", "P_VALUE", "ENDPOINT_VALUE", "FAVORABLE_PROVIDER_COVERAGE", "ORIGINAL_V4_RESULT"}


def load(path: Path) -> dict:
    raw = path.read_bytes()
    if raw.startswith(b"\xef\xbb\xbf") or b"\r" in raw:
        raise ValueError(f"non-canonical bytes: {path}")
    return json.loads(raw)


def main() -> int:
    cases = load(CASES)
    contract = load(CONTRACT)
    rows = cases["cases"]
    assert cases["schema"] == "early-detection-quantconnect-free-cloud-pilot-cases/v1"
    assert cases["selectionState"] == "FROZEN_PRE_CLOUD_EXECUTION"
    assert cases["caseCount"] == len(rows) == 50
    assert cases["categoryQuotas"] == CATEGORIES
    assert set(cases["forbiddenSelectionInputs"]) == FORBIDDEN
    assert cases["outcomesAccessed"] is False
    assert len({row["caseId"] for row in rows}) == 50
    assert [row["caseId"] for row in rows] == [f"QC-{i:03d}" for i in range(1, 51)]
    counts = {key: 0 for key in CATEGORIES}
    for row in rows:
        assert set(row) == {"caseId", "category", "querySymbol", "alternateSymbols", "referenceStart", "referenceEnd", "identityState"}
        assert row["category"] in counts
        assert row["identityState"] == "PRE_PILOT_UNRESOLVED"
        assert row["referenceEnd"] <= "2024-12-31"
        counts[row["category"]] += 1
    assert counts == CATEGORIES
    assert contract["taskId"] == "Q002-QUANTCONNECT-50-CASE-CONTRACT"
    assert contract["sourceId"] == "QUANTCONNECT_FREE_CLOUD"
    assert contract["humanAttestation"] is False and contract["outcomesAccessed"] is False
    bound = contract["boundFiles"]
    assert bound["casesPath"] == CASES.relative_to(ROOT).as_posix()
    assert bound["casesRawSha256"] == hashlib.sha256(CASES.read_bytes()).hexdigest()
    assert bound["cloudScriptPath"] == CLOUD_SCRIPT.relative_to(ROOT).as_posix()
    assert bound["cloudScriptRawSha256"] == hashlib.sha256(CLOUD_SCRIPT.read_bytes()).hexdigest()
    verifier_path = ROOT / bound["verifierPath"]
    test_path = ROOT / bound["testPath"]
    assert bound["verifierRawSha256"] == hashlib.sha256(verifier_path.read_bytes()).hexdigest()
    assert bound["testRawSha256"] == hashlib.sha256(test_path.read_bytes()).hexdigest()
    assert contract["requiredRunParameters"]["minimumIndependentRuns"] == 2
    assert "TERMINAL_WEALTH_COMPLETE" in contract["claimBoundary"]["forbidden"]
    assert "ORIGINAL_V4_GATE_PASS" in contract["claimBoundary"]["forbidden"]
    script = CLOUD_SCRIPT.read_text(encoding="utf-8")
    for token in ("priceValuesExported", "returnsComputed", "ordersSubmitted", "reportSha256"):
        assert token in script
    result = {
        "status": "PASS",
        "caseCount": len(rows),
        "categoryCounts": counts,
        "casesRawSha256": hashlib.sha256(CASES.read_bytes()).hexdigest(),
        "contractRawSha256": hashlib.sha256(CONTRACT.read_bytes()).hexdigest(),
        "cloudScriptRawSha256": hashlib.sha256(CLOUD_SCRIPT.read_bytes()).hexdigest(),
        "executionBlocked": True,
        "outcomesAccessed": False,
    }
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

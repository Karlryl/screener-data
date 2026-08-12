#!/usr/bin/env python3
"""Fail-closed static/output verifier for the discovery-only QC cloud pilot.

Local output files can establish schema/parity only. They never unlock execution
or source promotion; that requires two provider-run envelopes with CAS/Git/remote
provenance in a later queue-controller version.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CASES = ROOT / "research" / "early-detection-v4" / "quantconnect-free-cloud-pilot-cases-v1.json"
CONTRACT = ROOT / "research" / "early-detection-v4" / "quantconnect-free-cloud-pilot-contract-v3.json"
SCRIPT = ROOT / "scripts" / "quantconnect-free-cloud-metadata-pilot-v3.py"
TEST = ROOT / "tests" / "quantconnect-free-cloud-pilot-v3.test.js"
SHA = re.compile(r"^[0-9a-f]{64}$")
DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
FORBIDDEN_KEYS = {
    "OPEN", "HIGH", "LOW", "CLOSE", "ADJUSTED_CLOSE", "ADJCLOSE", "VOLUME", "PRICE",
    "RETURN", "P_VALUE", "ENDPOINT_VALUE", "HOLDINGS", "PORTFOLIO_VALUE", "ORIGINAL_V4_RESULT",
}
TOP_KEYS = {
    "schema", "pilotCoreSha256", "casesRawSha256", "providerRunId", "executedAt", "leanVersion",
    "datasetVersion", "runMode", "caseCount", "rows", "outcomesAccessed", "priceValuesExported",
    "returnsComputed", "ordersSubmitted", "reportSha256",
}
ROW_KEYS = {
    "caseId", "category", "querySymbol", "alternateSymbols", "referenceStart", "referenceEnd",
    "identityAssessment", "aliasResults", "errors",
}
ALIAS_KEYS = {
    "role", "requestedTicker", "subscriptionAccepted", "securityIdentifier", "barCount", "firstBarDate",
    "lastBarDate", "splitDates", "dividendDates", "symbolChanges", "delistingEvents", "errors",
}
SYMBOL_EVENT_KEYS = {"date", "requestedTicker", "oldSymbol", "newSymbol"}
DELIST_EVENT_KEYS = {"date", "requestedTicker", "eventType"}


class VerificationError(RuntimeError):
    pass


def require(ok, message):
    if not ok:
        raise VerificationError(message)


def raw(path):
    data = path.read_bytes()
    require(not data.startswith(b"\xef\xbb\xbf") and b"\r" not in data, f"noncanonical bytes: {path}")
    return data


def load(path):
    return json.loads(raw(path))


def sha(path):
    return hashlib.sha256(raw(path)).hexdigest()


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()


def normalized_key(key):
    value = re.sub(r"(?<=[a-z0-9])(?=[A-Z])", "_", str(key)).upper()
    return re.sub(r"[^A-Z0-9]+", "_", value).strip("_")


def no_forbidden(value, path="root"):
    if isinstance(value, dict):
        for key, item in value.items():
            require(normalized_key(key) not in FORBIDDEN_KEYS, f"forbidden field {path}.{key}")
            no_forbidden(item, f"{path}.{key}")
    elif isinstance(value, list):
        for index, item in enumerate(value):
            no_forbidden(item, f"{path}[{index}]")


def exact_string_list(value, label):
    require(isinstance(value, list) and all(isinstance(item, str) and item for item in value), label)
    require(value == sorted(set(value)), f"{label} must be sorted and unique")


def valid_date(value, start, end, label):
    require(isinstance(value, str) and DATE.fullmatch(value) is not None and start <= value <= end, label)


def validate_static():
    cases, contract = load(CASES), load(CONTRACT)
    require(contract["schema"] == "early-detection-quantconnect-free-cloud-pilot-contract/v3", "contract schema")
    require(contract["phase"] == "DISCOVERY_ONLY_PRE_IDENTITY_VALIDATION", "phase")
    require(contract["outcomesAccessed"] is False and contract["humanAttestation"] is False, "locks")
    require(contract["boundFiles"] == {
        "casesPath": CASES.relative_to(ROOT).as_posix(), "casesRawSha256": sha(CASES),
        "cloudScriptPath": SCRIPT.relative_to(ROOT).as_posix(), "cloudScriptRawSha256": sha(SCRIPT),
        "verifierPath": Path(__file__).resolve().relative_to(ROOT).as_posix(), "verifierRawSha256": sha(Path(__file__).resolve()),
        "testPath": TEST.relative_to(ROOT).as_posix(), "testRawSha256": sha(TEST),
    }, "bindings")
    require(contract["executionBlockedUntil"] == [
        "EXTERNALLY_CONFIRMED_FREE_ACCOUNT_NO_PAYMENT_NO_TRIAL",
        "TERMS_AND_DERIVATIVE_EXPORT_RIGHTS_REMOTE_BOUND",
        "TWO_PROVIDER_RUN_ENVELOPES_CAS_GIT_REMOTE_VERIFIED",
    ], "execution locks")
    require(set(contract["claimBoundary"]["forbidden"]) == {
        "IDENTITY_RESOLVED", "TERMINAL_WEALTH_COMPLETE", "COVERAGE_RATE", "FULL_MARKET", "SURVIVORSHIP_SAFE",
        "ORIGINAL_V4_GATE_PASS", "H_LATE", "H_FEM",
    }, "forbidden claims")
    require(contract["claimBoundary"]["allowed"] == ["METADATA_DISCOVERY_AND_REPRODUCIBILITY_ONLY"], "allowed claims")
    rows = cases["cases"]
    require(len(rows) == cases["caseCount"] == 50, "case count")
    require([row["caseId"] for row in rows] == [f"QC-{index:03d}" for index in range(1, 51)], "case IDs")
    for row in rows:
        require(row["referenceStart"] <= row["referenceEnd"] <= "2024-12-31", "case chronology")
    core = contract["pilotCore"]
    require(contract["pilotCoreSha256"] == hashlib.sha256(canonical(core)).hexdigest(), "core hash")
    require(core["casesRawSha256"] == sha(CASES), "core cases hash")
    script = SCRIPT.read_text("utf-8")
    require(contract["pilotCoreSha256"] in script and sha(CASES) in script, "script core binding")
    for token in ("alternateSymbols", "referenceStart", "referenceEnd", "DISCOVERY_ONLY_UNRESOLVED", "aliasResults"):
        require(token in script, f"runner missing {token}")
    return cases, contract


def validate_output(path, cases, contract):
    value = load(path)
    require(set(value) == TOP_KEYS, "output keys")
    require(value["schema"] == "early-detection-quantconnect-free-cloud-metadata-output/v3", "output schema")
    require(value["pilotCoreSha256"] == contract["pilotCoreSha256"] and value["casesRawSha256"] == sha(CASES), "output bindings")
    require(value["runMode"] == "DISCOVERY_ONLY" and value["caseCount"] == 50 and len(value["rows"]) == 50, "output mode/count")
    require(all(value[key] is False for key in ("outcomesAccessed", "priceValuesExported", "returnsComputed", "ordersSubmitted")), "outcome locks")
    for key in ("providerRunId", "leanVersion", "datasetVersion"):
        require(isinstance(value[key], str) and value[key] not in ("", "MISSING", "UNAVAILABLE"), f"run metadata {key}")
    datetime.strptime(value["executedAt"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    copy = dict(value)
    stored = copy.pop("reportSha256")
    require(isinstance(stored, str) and SHA.fullmatch(stored) and stored == hashlib.sha256(canonical(copy)).hexdigest(), "report self hash")
    expected = {row["caseId"]: row for row in cases["cases"]}
    require([row["caseId"] for row in value["rows"]] == sorted(expected), "row order")
    for row in value["rows"]:
        require(set(row) == ROW_KEYS, "row keys")
        case = expected[row["caseId"]]
        for key in ("category", "querySymbol", "alternateSymbols", "referenceStart", "referenceEnd"):
            require(row[key] == case[key], f"row binding {row['caseId']}.{key}")
        require(row["identityAssessment"] == "DISCOVERY_ONLY_UNRESOLVED", "identity overclaim")
        require(isinstance(row["errors"], list) and all(isinstance(item, str) for item in row["errors"]), "row errors")
        expected_tickers = [case["querySymbol"], *case["alternateSymbols"]]
        require(len(row["aliasResults"]) == len(expected_tickers), "aliases missing")
        for index, alias in enumerate(row["aliasResults"]):
            require(set(alias) == ALIAS_KEYS, "alias schema")
            require(alias["role"] == ("PRIMARY" if index == 0 else "ALTERNATE"), "alias role/order")
            require(alias["requestedTicker"] == expected_tickers[index], "alias ticker/order")
            require(isinstance(alias["subscriptionAccepted"], bool), "subscriptionAccepted type")
            require(alias["securityIdentifier"] is None or isinstance(alias["securityIdentifier"], str), "security identifier type")
            require(isinstance(alias["barCount"], int) and not isinstance(alias["barCount"], bool) and alias["barCount"] >= 0, "barCount")
            require(isinstance(alias["errors"], list) and all(isinstance(item, str) for item in alias["errors"]), "alias errors")
            if alias["barCount"] == 0:
                require(alias["firstBarDate"] is None and alias["lastBarDate"] is None, "zero bars must have null dates")
            else:
                valid_date(alias["firstBarDate"], case["referenceStart"], case["referenceEnd"], "first bar date")
                valid_date(alias["lastBarDate"], case["referenceStart"], case["referenceEnd"], "last bar date")
                require(alias["firstBarDate"] <= alias["lastBarDate"], "bar date order")
            for key in ("splitDates", "dividendDates"):
                exact_string_list(alias[key], key)
                for date in alias[key]:
                    valid_date(date, case["referenceStart"], case["referenceEnd"], key)
            require(isinstance(alias["symbolChanges"], list), "symbol changes")
            for event in alias["symbolChanges"]:
                require(isinstance(event, dict) and set(event) == SYMBOL_EVENT_KEYS, "symbol event schema")
                valid_date(event["date"], case["referenceStart"], case["referenceEnd"], "symbol event date")
                require(event["requestedTicker"] == alias["requestedTicker"], "symbol event alias")
                require(all(isinstance(event[key], str) and event[key] for key in ("oldSymbol", "newSymbol")), "symbol event symbols")
            require(isinstance(alias["delistingEvents"], list), "delisting events")
            for event in alias["delistingEvents"]:
                require(isinstance(event, dict) and set(event) == DELIST_EVENT_KEYS, "delisting event schema")
                valid_date(event["date"], case["referenceStart"], case["referenceEnd"], "delisting event date")
                require(event["requestedTicker"] == alias["requestedTicker"], "delisting event alias")
                require(isinstance(event["eventType"], str) and event["eventType"], "delisting event type")
    no_forbidden(value)
    return value


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-a")
    parser.add_argument("--run-b")
    args = parser.parse_args()
    cases, contract = validate_static()
    result = {
        "status": "PASS", "staticContractVerified": True, "executionBlocked": True,
        "providerRunEnvelopesRequired": True, "outcomesAccessed": False,
    }
    require((args.run_a is None) == (args.run_b is None), "both cloud outputs required")
    if args.run_a:
        a = validate_output(Path(args.run_a), cases, contract)
        b = validate_output(Path(args.run_b), cases, contract)
        require(a["providerRunId"] != b["providerRunId"], "run IDs must differ")
        require(a["leanVersion"] == b["leanVersion"] and a["datasetVersion"] == b["datasetVersion"], "version mismatch")
        ac, bc = dict(a), dict(b)
        for obj in (ac, bc):
            obj.pop("providerRunId")
            obj.pop("executedAt")
            obj.pop("reportSha256")
        require(ac == bc, "cloud runs are not reproducible")
        result.update({
            "localTwoFileParityVerified": True,
            "runARawSha256": sha(Path(args.run_a)), "runBRawSha256": sha(Path(args.run_b)),
        })
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (VerificationError, KeyError, TypeError, ValueError, json.JSONDecodeError, OSError) as exc:
        print(json.dumps({"status": "FAIL", "error": str(exc), "outcomesAccessed": False}, sort_keys=True))
        raise SystemExit(2)

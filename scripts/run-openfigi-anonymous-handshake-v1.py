#!/usr/bin/env python3
"""Outcome-blind, anonymous OpenFIGI V3 three-case handshake.

The network command makes exactly one anonymous request, writes no files and emits
the exact raw response body as base64 plus content hashes to stdout.
"""

from __future__ import annotations

import argparse
import base64
import copy
import hashlib
import json
import re
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
CONTRACT_PATH = ROOT / "research" / "early-detection-v4" / "openfigi-anonymous-handshake-contract-v1.json"
EXPECTED_CONTRACT_SHA256 = "b760a32a20f9afcb106935e9631b49bb864d3fb97a12fdf8e75fd6930082b7c8"
EXPECTED_SCHEMA = "openfigi-anonymous-handshake-contract/v1"
EXPECTED_ENDPOINT = "https://api.openfigi.com/v3/mapping"
EXPECTED_JOB_IDS = (
    "AAPL_ACTIVE",
    "FB_INCLUDE_UNLISTED",
    "META_INCLUDE_UNLISTED",
    "ATVI_DEFAULT",
    "ATVI_INCLUDE_UNLISTED",
)
EXPECTED_POINT_TICKERS = {
    "AAPL_ACTIVE": {"AAPL"},
    "FB_INCLUDE_UNLISTED": {"FB", "META"},
    "META_INCLUDE_UNLISTED": {"META"},
    "ATVI_DEFAULT": {"ATVI"},
    "ATVI_INCLUDE_UNLISTED": {"ATVI"},
}
DATA_KEYS = {
    "figi",
    "securityType",
    "marketSector",
    "ticker",
    "name",
    "exchCode",
    "shareClassFIGI",
    "compositeFIGI",
    "securityType2",
    "securityDescription",
}
NULLABLE_STRING_KEYS = DATA_KEYS - {"figi"}
FIGI_RE = re.compile(r"^BBG[A-Z0-9]{9}$")
SAFE_REQUEST_HEADERS = {
    "Accept": "application/json",
    "Content-Type": "application/json",
    "User-Agent": "GrowthScreenerResearchData-OpenFIGI-Anonymous-Handshake/1.0",
}
RATE_HEADERS = ("ratelimit-limit", "ratelimit-remaining", "ratelimit-reset")
LOCKS = {
    "outcomesAccessed": False,
    "pricesAccessed": False,
    "returnsAccessed": False,
    "historicalIntervalClaimed": False,
    "terminalStatusClaimed": False,
    "terminalPaymentClaimed": False,
    "humanAttestation": False,
}


class HandshakeError(RuntimeError):
    pass


def canonical_bytes(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def sha256_bytes(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def exact_keys(value: Any, expected: set[str], label: str) -> None:
    if not isinstance(value, dict) or set(value) != expected:
        actual = sorted(value) if isinstance(value, dict) else type(value).__name__
        raise HandshakeError(f"{label} exact keys mismatch: {actual}")


def compute_self_hash(value: dict[str, Any], field: str) -> str:
    copy_value = copy.deepcopy(value)
    copy_value.pop(field, None)
    return sha256_bytes(canonical_bytes(copy_value))


def load_contract() -> dict[str, Any]:
    raw = CONTRACT_PATH.read_bytes()
    try:
        contract = json.loads(raw)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise HandshakeError(f"contract is not valid UTF-8 JSON: {exc}") from exc
    if not isinstance(contract, dict):
        raise HandshakeError("contract must be an object")
    if contract.get("schema") != EXPECTED_SCHEMA:
        raise HandshakeError("contract schema drift")
    observed = compute_self_hash(contract, "contractSha256")
    if observed != contract.get("contractSha256") or observed != EXPECTED_CONTRACT_SHA256:
        raise HandshakeError("contract self-hash mismatch")
    verify_contract_semantics(contract)
    return contract


def verify_contract_semantics(contract: dict[str, Any]) -> None:
    if contract.get("endpoint", {}).get("url") != EXPECTED_ENDPOINT:
        raise HandshakeError("endpoint drift")
    entitlement = contract.get("entitlement")
    if not isinstance(entitlement, dict):
        raise HandshakeError("entitlement missing")
    expected_entitlement = {
        "accountRequired": False,
        "apiKeyRequired": False,
        "paymentDetailsRequired": False,
        "trialAllowed": False,
        "anonymousRequestsPerMinuteCeiling": 25,
        "jobsPerRequestFailClosedCeiling": 5,
        "requestsInHandshake": 1,
        "jobsInHandshake": 5,
    }
    for key, value in expected_entitlement.items():
        if entitlement.get(key) != value:
            raise HandshakeError(f"entitlement drift: {key}")
    jobs = contract.get("fixedJobs")
    if not isinstance(jobs, list) or len(jobs) != 5:
        raise HandshakeError("fixed job count drift")
    if tuple(job.get("jobId") for job in jobs) != EXPECTED_JOB_IDS:
        raise HandshakeError("fixed job order drift")
    if [job.get("requestIndex") for job in jobs] != list(range(5)):
        raise HandshakeError("request indexes drift")
    request = [job.get("requestBody") for job in jobs]
    expected = [
        {"idType": "TICKER", "idValue": "AAPL", "exchCode": "US", "marketSecDes": "Equity"},
        {"idType": "TICKER", "idValue": "FB", "exchCode": "US", "marketSecDes": "Equity", "includeUnlistedEquities": True},
        {"idType": "TICKER", "idValue": "META", "exchCode": "US", "marketSecDes": "Equity", "includeUnlistedEquities": True},
        {"idType": "TICKER", "idValue": "ATVI", "exchCode": "US", "marketSecDes": "Equity"},
        {"idType": "TICKER", "idValue": "ATVI", "exchCode": "US", "marketSecDes": "Equity", "includeUnlistedEquities": True},
    ]
    if request != expected:
        raise HandshakeError("fixed request drift")
    if contract.get("locks") != LOCKS:
        raise HandshakeError("outcome locks drift")
    if contract.get("networkPolicy", {}).get("singleRequestOnly") is not True:
        raise HandshakeError("single request lock drift")
    if contract.get("networkPolicy", {}).get("automaticRetryAllowed") is not False:
        raise HandshakeError("retry lock drift")
    if contract.get("networkPolicy", {}).get("writeProductionOutputAllowed") is not False:
        raise HandshakeError("production-write lock drift")


def validate_figi(value: Any, label: str, nullable: bool) -> None:
    if value is None and nullable:
        return
    if not isinstance(value, str) or not FIGI_RE.fullmatch(value):
        raise HandshakeError(f"{label} is not a valid-shape FIGI")


def validate_data_row(row: Any, label: str) -> dict[str, Any]:
    exact_keys(row, DATA_KEYS, label)
    validate_figi(row["figi"], f"{label}.figi", False)
    validate_figi(row["shareClassFIGI"], f"{label}.shareClassFIGI", True)
    validate_figi(row["compositeFIGI"], f"{label}.compositeFIGI", True)
    for key in NULLABLE_STRING_KEYS - {"shareClassFIGI", "compositeFIGI"}:
        if row[key] is not None and not isinstance(row[key], str):
            raise HandshakeError(f"{label}.{key} must be string or null")
    if row["marketSector"] != "Equity":
        raise HandshakeError(f"{label}.marketSector is not Equity")
    return row


def parse_job_result(value: Any, job_id: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise HandshakeError(f"{job_id} result must be an object")
    if set(value) == {"warning"}:
        if value["warning"] != "No identifier found.":
            raise HandshakeError(f"{job_id} warning schema drift")
        return {"jobId": job_id, "state": "NO_MAPPING_WARNING", "warning": value["warning"]}
    if set(value) == {"error"}:
        raise HandshakeError(f"{job_id} provider error: {value['error']}")
    if set(value) != {"data"}:
        raise HandshakeError(f"{job_id} result schema drift")
    data = value["data"]
    if not isinstance(data, list) or not data:
        raise HandshakeError(f"{job_id} data must be a non-empty array")
    if len(data) > 1:
        raise HandshakeError(f"{job_id} ambiguous: {len(data)} rows")
    row = validate_data_row(data[0], f"{job_id}.data[0]")
    if row["ticker"] not in EXPECTED_POINT_TICKERS[job_id]:
        raise HandshakeError(f"{job_id} returned an unexpected point ticker")
    if row["exchCode"] != "US":
        raise HandshakeError(f"{job_id} returned an unexpected exchange code")
    return {"jobId": job_id, "state": "UNIQUE_POINT_MAPPING", "mapping": row}


def unique_mapping(job: dict[str, Any]) -> dict[str, Any] | None:
    if job["state"] == "UNIQUE_POINT_MAPPING":
        return job["mapping"]
    return None


def parse_mapping_response(payload: Any) -> dict[str, Any]:
    if not isinstance(payload, list) or len(payload) != 5:
        raise HandshakeError("mapping response must be an array of exactly five results")
    parsed_jobs = [parse_job_result(value, EXPECTED_JOB_IDS[index]) for index, value in enumerate(payload)]
    aapl = unique_mapping(parsed_jobs[0])
    if aapl is None:
        raise HandshakeError("AAPL active control did not map")
    if aapl["ticker"] != "AAPL":
        raise HandshakeError("AAPL active control ticker mismatch")
    if aapl["compositeFIGI"] is None or aapl["shareClassFIGI"] is None:
        raise HandshakeError("AAPL active control lacks composite/share-class FIGI")

    fb = unique_mapping(parsed_jobs[1])
    meta = unique_mapping(parsed_jobs[2])
    if fb is not None and meta is not None and fb["shareClassFIGI"] and fb["shareClassFIGI"] == meta["shareClassFIGI"]:
        symbol_comparison = "SAME_SHARE_CLASS_FIGI_POINT_EVIDENCE"
    elif fb is not None and meta is not None:
        symbol_comparison = "DISTINCT_OR_NULL_SHARE_CLASS_POINT_EVIDENCE"
    else:
        symbol_comparison = "POINT_COMPARISON_INCOMPLETE"

    atvi_default = unique_mapping(parsed_jobs[3])
    atvi_unlisted = unique_mapping(parsed_jobs[4])
    if atvi_default is None and atvi_unlisted is not None:
        atvi_comparison = "MAPPING_ONLY_WITH_INCLUDE_UNLISTED_POINT_EVIDENCE"
    elif atvi_default is not None and atvi_unlisted is not None:
        same = atvi_default["figi"] == atvi_unlisted["figi"]
        atvi_comparison = "BOTH_REQUESTS_RETURN_SAME_FIGI_POINT_EVIDENCE" if same else "BOTH_REQUESTS_RETURN_DIFFERENT_FIGI_POINT_EVIDENCE"
    elif atvi_default is None and atvi_unlisted is None:
        atvi_comparison = "NO_MAPPING_IN_EITHER_REQUEST"
    else:
        atvi_comparison = "DEFAULT_ONLY_MAPPING_POINT_EVIDENCE"

    return {
        "schema": "openfigi-anonymous-handshake-parse/v1",
        "qualificationStatus": "QUALIFIED_POINT_EVIDENCE_ONLY",
        "jobs": parsed_jobs,
        "cases": {
            "ACTIVE_STABLE": "UNIQUE_CURRENT_POINT_MAPPING",
            "SAME_SECURITY_SYMBOL_CHANGE": symbol_comparison,
            "TERMINAL_CASH_MERGER_OR_DELISTING": atvi_comparison,
        },
        "claimCeiling": "POINT_EVIDENCE_ONLY_NO_HISTORICAL_INTERVAL_OR_TERMINAL_INFERENCE",
        "locks": copy.deepcopy(LOCKS),
    }


def validate_rate_headers(headers: dict[str, str]) -> dict[str, str]:
    lowered = {key.lower(): value.strip() for key, value in headers.items()}
    selected: dict[str, str] = {}
    for key in RATE_HEADERS:
        value = lowered.get(key)
        if value is None or not re.fullmatch(r"\d+", value):
            raise HandshakeError(f"missing or invalid rate-limit header: {key}")
        selected[key] = value
    if int(selected["ratelimit-limit"]) < 1:
        raise HandshakeError("rate-limit ceiling is invalid")
    if int(selected["ratelimit-remaining"]) > int(selected["ratelimit-limit"]):
        raise HandshakeError("rate-limit remaining exceeds limit")
    selected["content-type"] = lowered.get("content-type", "")
    if not selected["content-type"].lower().startswith("application/json"):
        raise HandshakeError("response content-type is not application/json")
    return selected


def finalise_bundle(bundle: dict[str, Any]) -> dict[str, Any]:
    result = copy.deepcopy(bundle)
    result["bundleSha256"] = compute_self_hash(result, "bundleSha256")
    return result


def build_bundle(
    contract: dict[str, Any],
    request_raw: bytes,
    status: int,
    headers: dict[str, str],
    response_raw: bytes,
    parsed: dict[str, Any] | None,
    network_status: str,
    diagnostic: str | None,
) -> dict[str, Any]:
    selected_headers = {key.lower(): value.strip() for key, value in headers.items() if key.lower() in set(RATE_HEADERS) | {"content-type"}}
    bundle = {
        "schema": "openfigi-anonymous-handshake-capture/v1",
        "capturedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "track": contract["track"],
        "taskId": contract["taskId"],
        "sourceId": contract["sourceId"],
        "contractPath": CONTRACT_PATH.relative_to(ROOT).as_posix(),
        "contractSha256": contract["contractSha256"],
        "endpoint": EXPECTED_ENDPOINT,
        "networkStatus": network_status,
        "request": {
            "bodyBase64": base64.b64encode(request_raw).decode("ascii"),
            "byteLength": len(request_raw),
            "sha256": sha256_bytes(request_raw),
        },
        "response": {
            "httpStatus": status,
            "bodyBase64": base64.b64encode(response_raw).decode("ascii"),
            "byteLength": len(response_raw),
            "sha256": sha256_bytes(response_raw),
            "selectedHeaders": selected_headers,
            "selectedHeadersSha256": sha256_bytes(canonical_bytes(selected_headers)),
        },
        "parsed": parsed,
        "diagnostic": diagnostic,
        "locks": copy.deepcopy(LOCKS),
    }
    return finalise_bundle(bundle)


def request_body(contract: dict[str, Any]) -> bytes:
    jobs = [job["requestBody"] for job in contract["fixedJobs"]]
    return canonical_bytes(jobs)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req: Any, fp: Any, code: int, msg: str, headers: Any, newurl: str) -> None:
        return None


def run_live(contract: dict[str, Any]) -> int:
    raw_request = request_body(contract)
    request = urllib.request.Request(EXPECTED_ENDPOINT, data=raw_request, headers=SAFE_REQUEST_HEADERS, method="POST")
    opener = urllib.request.build_opener(NoRedirect)
    status = 0
    response_raw = b""
    headers: dict[str, str] = {}
    try:
        with opener.open(request, timeout=contract["endpoint"]["timeoutSeconds"]) as response:
            status = int(response.status)
            headers = dict(response.headers.items())
            response_raw = response.read(contract["endpoint"]["maximumResponseBytes"] + 1)
    except urllib.error.HTTPError as exc:
        status = int(exc.code)
        headers = dict(exc.headers.items()) if exc.headers else {}
        response_raw = exc.read(contract["endpoint"]["maximumResponseBytes"] + 1)
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        bundle = build_bundle(contract, raw_request, 0, {}, b"", None, "NETWORK_FAILED", str(exc))
        print(json.dumps(bundle, ensure_ascii=False, sort_keys=True, separators=(",", ":")))
        return 2

    if len(response_raw) > contract["endpoint"]["maximumResponseBytes"]:
        bundle = build_bundle(contract, raw_request, status, headers, response_raw, None, "RESPONSE_TOO_LARGE", "maximum response bytes exceeded")
        print(json.dumps(bundle, ensure_ascii=False, sort_keys=True, separators=(",", ":")))
        return 2
    if status == 429:
        bundle = build_bundle(contract, raw_request, status, headers, response_raw, None, "RATE_DEFERRED", "HTTP 429; no retry attempted")
        print(json.dumps(bundle, ensure_ascii=False, sort_keys=True, separators=(",", ":")))
        return 75
    if status != 200:
        bundle = build_bundle(contract, raw_request, status, headers, response_raw, None, "HTTP_REJECTED", f"HTTP {status}")
        print(json.dumps(bundle, ensure_ascii=False, sort_keys=True, separators=(",", ":")))
        return 2

    try:
        validate_rate_headers(headers)
        payload = json.loads(response_raw)
        parsed = parse_mapping_response(payload)
    except (UnicodeDecodeError, json.JSONDecodeError, HandshakeError) as exc:
        bundle = build_bundle(contract, raw_request, status, headers, response_raw, None, "FAIL_CLOSED", str(exc))
        print(json.dumps(bundle, ensure_ascii=False, sort_keys=True, separators=(",", ":")))
        return 2
    bundle = build_bundle(contract, raw_request, status, headers, response_raw, parsed, "QUALIFIED", None)
    print(json.dumps(bundle, ensure_ascii=False, sort_keys=True, separators=(",", ":")))
    return 0


def sample_row(figi: str, ticker: str, name: str, share: str, composite: str | None = None) -> dict[str, Any]:
    return {
        "figi": figi,
        "securityType": "Common Stock",
        "marketSector": "Equity",
        "ticker": ticker,
        "name": name,
        "exchCode": "US",
        "shareClassFIGI": share,
        "compositeFIGI": composite or figi,
        "securityType2": "Common Stock",
        "securityDescription": ticker,
    }


def valid_fixture() -> list[dict[str, Any]]:
    return [
        {"data": [sample_row("BBG000B9XRY4", "AAPL", "APPLE INC", "BBG001S5N8V8")]},
        {"data": [sample_row("BBG000MM2P62", "FB", "META PLATFORMS INC", "BBG001SQCQC5")]},
        {"data": [sample_row("BBG000MM2P62", "META", "META PLATFORMS INC", "BBG001SQCQC5")]},
        {"warning": "No identifier found."},
        {"data": [sample_row("BBG000CVWGS6", "ATVI", "ACTIVISION BLIZZARD INC", "BBG001S699P1")]},
    ]


def expect_rejected(payload: Any, expected_fragment: str) -> None:
    try:
        parse_mapping_response(payload)
    except HandshakeError as exc:
        if expected_fragment not in str(exc):
            raise HandshakeError(f"wrong rejection: {exc}") from exc
        return
    raise HandshakeError(f"tamper was accepted: {expected_fragment}")


def self_test(contract: dict[str, Any]) -> None:
    fixture = valid_fixture()
    parsed = parse_mapping_response(copy.deepcopy(fixture))
    if parsed["cases"]["SAME_SECURITY_SYMBOL_CHANGE"] != "SAME_SHARE_CLASS_FIGI_POINT_EVIDENCE":
        raise HandshakeError("symbol comparison fixture failed")
    if parsed["cases"]["TERMINAL_CASH_MERGER_OR_DELISTING"] != "MAPPING_ONLY_WITH_INCLUDE_UNLISTED_POINT_EVIDENCE":
        raise HandshakeError("ATVI comparison fixture failed")

    tamper = copy.deepcopy(fixture)
    tamper[0]["data"][0]["price"] = 123
    expect_rejected(tamper, "exact keys mismatch")
    tamper = copy.deepcopy(fixture)
    tamper[0]["data"].append(copy.deepcopy(tamper[0]["data"][0]))
    expect_rejected(tamper, "ambiguous")
    tamper = copy.deepcopy(fixture)
    tamper[1] = {"data": tamper[1]["data"], "warning": "also"}
    expect_rejected(tamper, "schema drift")
    tamper = copy.deepcopy(fixture)
    tamper[2] = {"error": "provider failed"}
    expect_rejected(tamper, "provider error")
    tamper = copy.deepcopy(fixture)
    tamper[0]["data"][0]["figi"] = "NOT_A_FIGI"
    expect_rejected(tamper, "valid-shape FIGI")
    tamper = copy.deepcopy(fixture)
    tamper[3] = {"warning": "Unexpected warning."}
    expect_rejected(tamper, "warning schema drift")
    tamper = copy.deepcopy(fixture)
    tamper[4]["data"][0]["ticker"] = "WRONG"
    expect_rejected(tamper, "unexpected point ticker")
    tamper = copy.deepcopy(fixture)
    tamper.pop()
    expect_rejected(tamper, "exactly five")
    try:
        validate_rate_headers({"content-type": "application/json", "ratelimit-limit": "25", "ratelimit-remaining": "24"})
    except HandshakeError as exc:
        if "ratelimit-reset" not in str(exc):
            raise
    else:
        raise HandshakeError("missing rate header accepted")
    headers = validate_rate_headers({"Content-Type": "application/json; charset=utf-8", "RateLimit-Limit": "25", "RateLimit-Remaining": "24", "RateLimit-Reset": "59"})
    if headers["ratelimit-limit"] != "25":
        raise HandshakeError("rate header canonicalization failed")

    request_raw = request_body(contract)
    response_raw = canonical_bytes(fixture)
    bundle = build_bundle(contract, request_raw, 200, headers, response_raw, parsed, "QUALIFIED", None)
    if bundle["bundleSha256"] != compute_self_hash(bundle, "bundleSha256"):
        raise HandshakeError("bundle self-hash failed")
    if base64.b64decode(bundle["response"]["bodyBase64"]) != response_raw:
        raise HandshakeError("response base64 round-trip failed")
    if bundle["response"]["sha256"] != sha256_bytes(response_raw):
        raise HandshakeError("response content hash failed")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=("verify-contract", "self-test", "parse-fixture", "network-handshake"))
    args = parser.parse_args()
    try:
        contract = load_contract()
        if args.command == "verify-contract":
            print(json.dumps({"status": "PASS", "contractSha256": contract["contractSha256"], "locks": LOCKS}, sort_keys=True))
            return 0
        if args.command == "self-test":
            self_test(contract)
            print(json.dumps({"status": "PASS", "tests": 15, "contractSha256": contract["contractSha256"], "locks": LOCKS}, sort_keys=True))
            return 0
        if args.command == "parse-fixture":
            payload = json.load(sys.stdin)
            result = parse_mapping_response(payload)
            print(json.dumps(result, ensure_ascii=False, sort_keys=True, separators=(",", ":")))
            return 0
        return run_live(contract)
    except (HandshakeError, json.JSONDecodeError, UnicodeDecodeError) as exc:
        print(f"FAIL_CLOSED: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())

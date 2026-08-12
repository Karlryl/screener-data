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
import subprocess
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
CONTRACT_PATH = ROOT / "research" / "early-detection-v4" / "openfigi-anonymous-handshake-contract-v1.json"
TERMS_SNAPSHOT_PATH = ROOT / "research" / "early-detection-v4" / "openfigi-terms-snapshot-v1.json"
TERMS_SOURCE_PATH = ROOT / "research" / "early-detection-v4" / "openfigi-terms-of-service-2026-08-12.html"
TEST_PATH = ROOT / "tests" / "run-openfigi-anonymous-handshake-v1.test.js"
RUNNER_PATH = Path(__file__).resolve()
EXPECTED_CONTRACT_RAW_SHA256 = "5f96f607036d34b364ef53fa673596d89232d7de8ce944ac0689a4308fde3676"
EXPECTED_CONTRACT_SHA256 = "1f7b4672e254d18c0ea63a6ecbe0046f28d7cb45f937b08af93a08216d54232c"
EXPECTED_TERMS_RAW_SHA256 = "423d084fd0ff7ebb20fc0d055901a0aa9b915a40218c911653462234a8b80ae7"
EXPECTED_TERMS_SHA256 = "8c882530c0cd7f918f0101373421d7238689ec584d74d8f77306421e13b33c95"
EXPECTED_TERMS_SOURCE_RAW_SHA256 = "dc1f321786c6e29cc4758bfd86137d49e95ae7a0b1c2abf68d44f2f53a67420e"
EXPECTED_REMOTE_URL = "https://github.com/Karlryl/screener-data.git"
EXPECTED_REMOTE_REF = "refs/heads/codex/early-detection-v4-gates-20260810"
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
    if sha256_bytes(raw) != EXPECTED_CONTRACT_RAW_SHA256:
        raise HandshakeError("contract raw-byte hash mismatch")
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
    terms = load_terms_snapshot()
    verify_contract_semantics(contract, terms)
    return contract


def load_terms_snapshot() -> dict[str, Any]:
    raw = TERMS_SNAPSHOT_PATH.read_bytes()
    if sha256_bytes(raw) != EXPECTED_TERMS_RAW_SHA256:
        raise HandshakeError("terms snapshot raw-byte hash mismatch")
    try:
        snapshot = json.loads(raw)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise HandshakeError(f"terms snapshot is not valid UTF-8 JSON: {exc}") from exc
    if not isinstance(snapshot, dict):
        raise HandshakeError("terms snapshot must be an object")
    observed = compute_self_hash(snapshot, "snapshotSha256")
    if observed != snapshot.get("snapshotSha256") or observed != EXPECTED_TERMS_SHA256:
        raise HandshakeError("terms snapshot self-hash mismatch")
    expected_semantics = {
        "figiIdentifiers": "PUBLIC_DOMAIN_FREE_REPRODUCTION_DISTRIBUTION_AND_USE",
        "relatedSecurityDescriptions": "AS_IS_NO_ACCURACY_GUARANTEE_NO_PUBLIC_DOMAIN_CLAIM_IN_THIS_STUDY",
        "trademark": "FAIR_REFERENCE_ONLY_NO_ENDORSEMENT_OR_SPONSORSHIP_IMPLICATION",
        "termsMayChange": True,
    }
    expected_disposition = {
        "figiIdentifierUse": "FREE_INTERNAL_AND_REPRODUCIBLE_EVIDENCE_ALLOWED",
        "descriptiveFieldUse": "INTERNAL_HANDSHAKE_EVIDENCE_ONLY_NO_REDISTRIBUTION_RIGHT_ASSERTED",
        "terminalOrHistoricalClaim": False,
        "humanLegalAttestation": False,
    }
    if snapshot.get("semanticFacts") != expected_semantics or snapshot.get("studyDisposition") != expected_disposition:
        raise HandshakeError("terms snapshot semantic disposition drift")
    source_raw = TERMS_SOURCE_PATH.read_bytes()
    source = snapshot.get("observedHttpBody")
    expected_source = {
        "path": TERMS_SOURCE_PATH.relative_to(ROOT).as_posix(),
        "bytes": len(source_raw),
        "sha256": EXPECTED_TERMS_SOURCE_RAW_SHA256,
        "rawBodyStoredInRepository": True,
    }
    if sha256_bytes(source_raw) != EXPECTED_TERMS_SOURCE_RAW_SHA256 or source != expected_source:
        raise HandshakeError("terms source-body binding drift")
    return snapshot


def verify_contract_semantics(contract: dict[str, Any], terms: dict[str, Any]) -> None:
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
    expected_terms_binding = {
        "path": TERMS_SNAPSHOT_PATH.relative_to(ROOT).as_posix(),
        "rawSha256": EXPECTED_TERMS_RAW_SHA256,
        "snapshotSha256": EXPECTED_TERMS_SHA256,
        "sourceBodyPath": TERMS_SOURCE_PATH.relative_to(ROOT).as_posix(),
        "sourceBodyRawSha256": EXPECTED_TERMS_SOURCE_RAW_SHA256,
        "figiIdentifiersDisposition": "PUBLIC_DOMAIN_FREE_REPRODUCTION_DISTRIBUTION_AND_USE",
        "relatedDescriptionsDisposition": "INTERNAL_HANDSHAKE_EVIDENCE_ONLY_NO_REDISTRIBUTION_RIGHT_ASSERTED",
    }
    if contract.get("termsSnapshot") != expected_terms_binding:
        raise HandshakeError("terms snapshot binding drift")
    if terms.get("snapshotSha256") != contract["termsSnapshot"]["snapshotSha256"]:
        raise HandshakeError("terms snapshot cross-binding drift")
    policy = contract.get("networkPolicy", {})
    if policy.get("singleRequestOnly") is not True:
        raise HandshakeError("single request lock drift")
    if policy.get("automaticRetryAllowed") is not False:
        raise HandshakeError("retry lock drift")
    if policy.get("redirectAllowed") is not False:
        raise HandshakeError("redirect lock drift")
    if policy.get("proxyOrRateLimitBypassAllowed") is not False:
        raise HandshakeError("proxy/rate-limit bypass lock drift")
    if policy.get("accountOrKeyUseAllowed") is not False:
        raise HandshakeError("account/key lock drift")
    if policy.get("writeProductionOutputAllowed") is not False:
        raise HandshakeError("production-write lock drift")
    expected_implementation_policy = {
        "runnerPath": RUNNER_PATH.relative_to(ROOT).as_posix(),
        "testPath": TEST_PATH.relative_to(ROOT).as_posix(),
        "termsSourcePath": TERMS_SOURCE_PATH.relative_to(ROOT).as_posix(),
        "remoteName": "origin",
        "remoteUrl": EXPECTED_REMOTE_URL,
        "remoteRef": EXPECTED_REMOTE_REF,
        "localHeadEqualsUpstreamAndRemoteRequired": True,
        "localBytesEqualHeadGitBlobsRequired": True,
        "preAndPostNetworkSnapshotEqualityRequired": True,
    }
    if contract.get("implementationPolicy") != expected_implementation_policy:
        raise HandshakeError("implementation policy drift")


def git_text(*args: str) -> str:
    result = subprocess.run(
        ["git", *args], cwd=ROOT, check=False, capture_output=True, text=True, encoding="utf-8"
    )
    if result.returncode != 0:
        raise HandshakeError(f"git {' '.join(args)} failed: {result.stderr.strip()}")
    return result.stdout.strip()


def implementation_snapshot(require_remote: bool) -> dict[str, Any]:
    paths = (CONTRACT_PATH, TERMS_SNAPSHOT_PATH, TERMS_SOURCE_PATH, RUNNER_PATH, TEST_PATH)
    local: dict[str, dict[str, Any]] = {}
    raw_by_path: dict[Path, bytes] = {}
    for path in paths:
        raw = path.read_bytes()
        raw_by_path[path] = raw
        local[path.relative_to(ROOT).as_posix()] = {"bytes": len(raw), "sha256": sha256_bytes(raw)}
    snapshot: dict[str, Any] = {
        "remoteVerified": False,
        "headCommit": None,
        "remoteRef": EXPECTED_REMOTE_REF,
        "remoteUrl": None,
        "files": local,
    }
    if not require_remote:
        return snapshot
    head = git_text("rev-parse", "HEAD")
    upstream = git_text("rev-parse", "@{upstream}")
    remote_url = git_text("remote", "get-url", "origin")
    if remote_url != EXPECTED_REMOTE_URL:
        raise HandshakeError("origin URL drift")
    remote_lines = git_text("ls-remote", "origin", EXPECTED_REMOTE_REF).splitlines()
    if len(remote_lines) != 1 or remote_lines[0].split()[0] != head or upstream != head:
        raise HandshakeError("local/upstream/remote commit drift")
    for path in paths:
        relative = path.relative_to(ROOT).as_posix()
        blob = subprocess.run(
            ["git", "show", f"{head}:{relative}"], cwd=ROOT, check=False, capture_output=True
        )
        if blob.returncode != 0 or blob.stdout != raw_by_path[path]:
            raise HandshakeError(f"local/Git blob drift: {relative}")
    snapshot.update({"remoteVerified": True, "headCommit": head, "remoteUrl": remote_url})
    return snapshot


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
    if int(selected["ratelimit-limit"]) != 25:
        raise HandshakeError("anonymous rate-limit ceiling drift")
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


def parse_utc(value: Any, label: str) -> datetime:
    if not isinstance(value, str) or not value.endswith("Z"):
        raise HandshakeError(f"{label} must be RFC3339 UTC")
    try:
        parsed = datetime.fromisoformat(value[:-1] + "+00:00")
    except ValueError as exc:
        raise HandshakeError(f"{label} is invalid") from exc
    return parsed


def validate_capture_bundle(bundle: Any, contract: dict[str, Any]) -> dict[str, Any]:
    expected_keys = {
        "schema", "capturedAt", "track", "taskId", "sourceId", "contractPath",
        "contractRawSha256", "contractSha256", "termsSnapshotPath",
        "termsSnapshotRawSha256", "termsSnapshotSha256", "termsSourceRawSha256",
        "implementation", "endpoint", "networkStatus", "request", "response",
        "parsed", "diagnostic", "locks", "bundleSha256",
    }
    exact_keys(bundle, expected_keys, "capture bundle")
    if bundle["schema"] != "openfigi-anonymous-handshake-capture/v1":
        raise HandshakeError("capture schema drift")
    parse_utc(bundle["capturedAt"], "capturedAt")
    if bundle["bundleSha256"] != compute_self_hash(bundle, "bundleSha256"):
        raise HandshakeError("capture self-hash mismatch")
    expected_scalar = {
        "track": contract["track"],
        "taskId": contract["taskId"],
        "sourceId": contract["sourceId"],
        "contractPath": CONTRACT_PATH.relative_to(ROOT).as_posix(),
        "contractRawSha256": EXPECTED_CONTRACT_RAW_SHA256,
        "contractSha256": EXPECTED_CONTRACT_SHA256,
        "termsSnapshotPath": TERMS_SNAPSHOT_PATH.relative_to(ROOT).as_posix(),
        "termsSnapshotRawSha256": EXPECTED_TERMS_RAW_SHA256,
        "termsSnapshotSha256": EXPECTED_TERMS_SHA256,
        "termsSourceRawSha256": EXPECTED_TERMS_SOURCE_RAW_SHA256,
        "endpoint": EXPECTED_ENDPOINT,
        "networkStatus": "QUALIFIED",
        "diagnostic": None,
    }
    for key, expected in expected_scalar.items():
        if bundle[key] != expected:
            raise HandshakeError(f"capture binding drift: {key}")
    if bundle["locks"] != LOCKS:
        raise HandshakeError("capture outcome locks drift")

    exact_keys(bundle["request"], {"bodyBase64", "byteLength", "sha256"}, "capture request")
    try:
        request_raw = base64.b64decode(bundle["request"]["bodyBase64"], validate=True)
    except (ValueError, TypeError) as exc:
        raise HandshakeError("capture request base64 invalid") from exc
    expected_request = request_body(contract)
    if request_raw != expected_request or bundle["request"]["byteLength"] != len(request_raw) or bundle["request"]["sha256"] != sha256_bytes(request_raw):
        raise HandshakeError("capture request bytes drift")

    exact_keys(bundle["response"], {"httpStatus", "bodyBase64", "byteLength", "sha256", "selectedHeaders", "selectedHeadersSha256"}, "capture response")
    try:
        response_raw = base64.b64decode(bundle["response"]["bodyBase64"], validate=True)
    except (ValueError, TypeError) as exc:
        raise HandshakeError("capture response base64 invalid") from exc
    if bundle["response"]["httpStatus"] != 200 or bundle["response"]["byteLength"] != len(response_raw) or bundle["response"]["sha256"] != sha256_bytes(response_raw):
        raise HandshakeError("capture response bytes drift")
    headers = validate_rate_headers(bundle["response"]["selectedHeaders"])
    if headers != bundle["response"]["selectedHeaders"] or bundle["response"]["selectedHeadersSha256"] != sha256_bytes(canonical_bytes(headers)):
        raise HandshakeError("capture response-header binding drift")
    try:
        reparsed = parse_mapping_response(json.loads(response_raw))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise HandshakeError("capture response JSON invalid") from exc
    if reparsed != bundle["parsed"]:
        raise HandshakeError("capture parsed payload is not source-derived")

    implementation = bundle["implementation"]
    exact_keys(implementation, {"remoteVerified", "headCommit", "remoteRef", "remoteUrl", "files"}, "capture implementation")
    if implementation["remoteVerified"] is not True or implementation["remoteRef"] != EXPECTED_REMOTE_REF or implementation["remoteUrl"] != EXPECTED_REMOTE_URL:
        raise HandshakeError("capture implementation is not remote verified")
    commit = implementation["headCommit"]
    if not isinstance(commit, str) or not re.fullmatch(r"[0-9a-f]{40}", commit):
        raise HandshakeError("capture implementation commit invalid")
    remote_head = git_text("ls-remote", "origin", EXPECTED_REMOTE_REF).splitlines()
    if len(remote_head) != 1:
        raise HandshakeError("capture remote ref unavailable")
    current_remote = remote_head[0].split()[0]
    ancestry = subprocess.run(["git", "merge-base", "--is-ancestor", commit, current_remote], cwd=ROOT, check=False)
    if ancestry.returncode != 0:
        raise HandshakeError("capture implementation commit is not on the remote lineage")
    expected_paths = {
        CONTRACT_PATH.relative_to(ROOT).as_posix(), TERMS_SNAPSHOT_PATH.relative_to(ROOT).as_posix(),
        TERMS_SOURCE_PATH.relative_to(ROOT).as_posix(), RUNNER_PATH.relative_to(ROOT).as_posix(),
        TEST_PATH.relative_to(ROOT).as_posix(),
    }
    if not isinstance(implementation["files"], dict) or set(implementation["files"]) != expected_paths:
        raise HandshakeError("capture implementation file set drift")
    for relative, metadata in implementation["files"].items():
        exact_keys(metadata, {"bytes", "sha256"}, f"capture implementation {relative}")
        blob = subprocess.run(["git", "show", f"{commit}:{relative}"], cwd=ROOT, check=False, capture_output=True)
        if blob.returncode != 0 or metadata != {"bytes": len(blob.stdout), "sha256": sha256_bytes(blob.stdout)}:
            raise HandshakeError(f"capture implementation Git binding drift: {relative}")
    return bundle


def build_bundle(
    contract: dict[str, Any],
    request_raw: bytes,
    status: int,
    headers: dict[str, str],
    response_raw: bytes,
    parsed: dict[str, Any] | None,
    network_status: str,
    diagnostic: str | None,
    implementation: dict[str, Any] | None = None,
) -> dict[str, Any]:
    selected_headers = {key.lower(): value.strip() for key, value in headers.items() if key.lower() in set(RATE_HEADERS) | {"content-type"}}
    bundle = {
        "schema": "openfigi-anonymous-handshake-capture/v1",
        "capturedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "track": contract["track"],
        "taskId": contract["taskId"],
        "sourceId": contract["sourceId"],
        "contractPath": CONTRACT_PATH.relative_to(ROOT).as_posix(),
        "contractRawSha256": EXPECTED_CONTRACT_RAW_SHA256,
        "contractSha256": contract["contractSha256"],
        "termsSnapshotPath": TERMS_SNAPSHOT_PATH.relative_to(ROOT).as_posix(),
        "termsSnapshotRawSha256": EXPECTED_TERMS_RAW_SHA256,
        "termsSnapshotSha256": EXPECTED_TERMS_SHA256,
        "termsSourceRawSha256": EXPECTED_TERMS_SOURCE_RAW_SHA256,
        "implementation": copy.deepcopy(implementation or implementation_snapshot(False)),
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
    before = implementation_snapshot(True)
    raw_request = request_body(contract)
    request = urllib.request.Request(EXPECTED_ENDPOINT, data=raw_request, headers=SAFE_REQUEST_HEADERS, method="POST")
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect)
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
        after = implementation_snapshot(True)
        if after != before:
            raise HandshakeError("implementation snapshot drift during network call")
        bundle = build_bundle(contract, raw_request, 0, {}, b"", None, "NETWORK_FAILED", str(exc), before)
        print(json.dumps(bundle, ensure_ascii=False, sort_keys=True, separators=(",", ":")))
        return 2

    if len(response_raw) > contract["endpoint"]["maximumResponseBytes"]:
        after = implementation_snapshot(True)
        if after != before:
            raise HandshakeError("implementation snapshot drift during network call")
        bundle = build_bundle(contract, raw_request, status, headers, response_raw, None, "RESPONSE_TOO_LARGE", "maximum response bytes exceeded", before)
        print(json.dumps(bundle, ensure_ascii=False, sort_keys=True, separators=(",", ":")))
        return 2
    if status == 429:
        after = implementation_snapshot(True)
        if after != before:
            raise HandshakeError("implementation snapshot drift during network call")
        bundle = build_bundle(contract, raw_request, status, headers, response_raw, None, "RATE_DEFERRED", "HTTP 429; no retry attempted", before)
        print(json.dumps(bundle, ensure_ascii=False, sort_keys=True, separators=(",", ":")))
        return 75
    if status != 200:
        after = implementation_snapshot(True)
        if after != before:
            raise HandshakeError("implementation snapshot drift during network call")
        bundle = build_bundle(contract, raw_request, status, headers, response_raw, None, "HTTP_REJECTED", f"HTTP {status}", before)
        print(json.dumps(bundle, ensure_ascii=False, sort_keys=True, separators=(",", ":")))
        return 2

    try:
        validate_rate_headers(headers)
        payload = json.loads(response_raw)
        parsed = parse_mapping_response(payload)
    except (UnicodeDecodeError, json.JSONDecodeError, HandshakeError) as exc:
        after = implementation_snapshot(True)
        if after != before:
            raise HandshakeError("implementation snapshot drift during network call")
        bundle = build_bundle(contract, raw_request, status, headers, response_raw, None, "FAIL_CLOSED", str(exc), before)
        print(json.dumps(bundle, ensure_ascii=False, sort_keys=True, separators=(",", ":")))
        return 2
    after = implementation_snapshot(True)
    if after != before:
        raise HandshakeError("implementation snapshot drift during network call")
    bundle = build_bundle(contract, raw_request, status, headers, response_raw, parsed, "QUALIFIED", None, before)
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
    try:
        validate_rate_headers({"Content-Type": "application/json", "RateLimit-Limit": "100", "RateLimit-Remaining": "99", "RateLimit-Reset": "59"})
    except HandshakeError as exc:
        if "ceiling drift" not in str(exc):
            raise
    else:
        raise HandshakeError("inflated anonymous rate limit accepted")

    request_raw = request_body(contract)
    response_raw = canonical_bytes(fixture)
    bundle = build_bundle(contract, request_raw, 200, headers, response_raw, parsed, "QUALIFIED", None)
    if bundle["bundleSha256"] != compute_self_hash(bundle, "bundleSha256"):
        raise HandshakeError("bundle self-hash failed")
    if base64.b64decode(bundle["response"]["bodyBase64"]) != response_raw:
        raise HandshakeError("response base64 round-trip failed")
    if bundle["response"]["sha256"] != sha256_bytes(response_raw):
        raise HandshakeError("response content hash failed")
    if bundle["contractRawSha256"] != EXPECTED_CONTRACT_RAW_SHA256:
        raise HandshakeError("bundle contract raw binding failed")
    if bundle["termsSnapshotRawSha256"] != EXPECTED_TERMS_RAW_SHA256:
        raise HandshakeError("bundle terms raw binding failed")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=("verify-contract", "self-test", "parse-fixture", "verify-capture", "network-handshake"))
    args = parser.parse_args()
    try:
        contract = load_contract()
        if args.command == "verify-contract":
            print(json.dumps({"status": "PASS", "contractSha256": contract["contractSha256"], "locks": LOCKS}, sort_keys=True))
            return 0
        if args.command == "self-test":
            self_test(contract)
            print(json.dumps({"status": "PASS", "tests": 16, "contractRawSha256": EXPECTED_CONTRACT_RAW_SHA256, "contractSha256": contract["contractSha256"], "termsSnapshotRawSha256": EXPECTED_TERMS_RAW_SHA256, "locks": LOCKS}, sort_keys=True))
            return 0
        if args.command == "parse-fixture":
            payload = json.load(sys.stdin)
            result = parse_mapping_response(payload)
            print(json.dumps(result, ensure_ascii=False, sort_keys=True, separators=(",", ":")))
            return 0
        if args.command == "verify-capture":
            capture = json.load(sys.stdin)
            result = validate_capture_bundle(capture, contract)
            print(json.dumps({"status": "PASS", "bundleSha256": result["bundleSha256"], "implementationCommit": result["implementation"]["headCommit"], "locks": LOCKS}, sort_keys=True))
            return 0
        return run_live(contract)
    except (HandshakeError, json.JSONDecodeError, UnicodeDecodeError) as exc:
        print(f"FAIL_CLOSED: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())

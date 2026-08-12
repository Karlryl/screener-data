#!/usr/bin/env python3
"""Build a deterministic public-domain FIGI-only derivative from quarantined V1."""

from __future__ import annotations

import argparse
import base64
import copy
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
CONTRACT_PATH = ROOT / "research" / "early-detection-v4" / "openfigi-figi-only-disposition-contract-v2.json"
BUILDER_PATH = Path(__file__).resolve()
TEST_PATH = ROOT / "tests" / "build-openfigi-figi-only-capture-v2.test.js"
V1_PATH = ROOT / "reports" / "early-detection" / "openfigi-anonymous-handshake-capture-v1.json"
TERMS_PATH = ROOT / "research" / "early-detection-v4" / "openfigi-terms-snapshot-v1.json"
TERMS_SOURCE_PATH = ROOT / "research" / "early-detection-v4" / "openfigi-terms-of-service-2026-08-12.html"
OUTPUT_PATH = ROOT / "reports" / "early-detection" / "openfigi-figi-only-capture-v2.json"

EXPECTED_CONTRACT_RAW_SHA256 = "10b15dbdcd4fae0a9ed570b450b583b9c24141c6749acf5f0403cb853d1660f2"
EXPECTED_CONTRACT_SHA256 = "7378bf2992c0bc1cb640f7ea1cfa7ff9a09a7055ddb830c9d57b88febc7a7eb7"
EXPECTED_V1_RAW_SHA256 = "99144a7a85520efe7e127f32bbd438f07efa8578007f1f7333dd6bc58c683c48"
EXPECTED_V1_SELF_SHA256 = "846050a4d5fd84900e01e7c387c4ad96086c49696e092d6817fd29b9f96c9e2c"
EXPECTED_V1_REQUEST_SHA256 = "9a90c3d2135fede385dd5277a27ced5441c49826af6a5e2bf9f8e21e60b3d698"
EXPECTED_V1_RESPONSE_SHA256 = "0eeea739a2df7a64c4dc63a5e5572b97eb07b8717a7c2e762ab089c34a1d747a"
EXPECTED_V1_COMMIT = "9ecf9a8b67bc103812174eb347a8547b52144d93"
EXPECTED_V1_BLOB = "fdcae77fcb09e98f57628209efbe5d548b92a30f"
EXPECTED_TERMS_RAW_SHA256 = "423d084fd0ff7ebb20fc0d055901a0aa9b915a40218c911653462234a8b80ae7"
EXPECTED_TERMS_SELF_SHA256 = "8c882530c0cd7f918f0101373421d7238689ec584d74d8f77306421e13b33c95"
EXPECTED_TERMS_SOURCE_SHA256 = "dc1f321786c6e29cc4758bfd86137d49e95ae7a0b1c2abf68d44f2f53a67420e"
EXPECTED_REMOTE_BASE = "ec806d8112fdaa05ee2cd328da256c504e8038fe"
EXPECTED_REMOTE_URL = "https://github.com/Karlryl/screener-data.git"
EXPECTED_REMOTE_REF = "refs/heads/codex/early-detection-v4-gates-20260810"
EXPECTED_JOB_ORDER = (
    "AAPL_ACTIVE",
    "FB_INCLUDE_UNLISTED",
    "META_INCLUDE_UNLISTED",
    "ATVI_DEFAULT",
    "ATVI_INCLUDE_UNLISTED",
)
EXPECTED_STATES = {
    "AAPL_ACTIVE": "UNIQUE_POINT_MAPPING",
    "FB_INCLUDE_UNLISTED": "UNIQUE_POINT_MAPPING",
    "META_INCLUDE_UNLISTED": "UNIQUE_POINT_MAPPING",
    "ATVI_DEFAULT": "NO_MAPPING_WARNING",
    "ATVI_INCLUDE_UNLISTED": "UNIQUE_POINT_MAPPING",
}
EXPECTED_SANITIZED_ROWS = (
    {"jobId": "AAPL_ACTIVE", "state": "UNIQUE_POINT_MAPPING", "figi": "BBG000B9XRY4", "compositeFIGI": "BBG000B9XRY4", "shareClassFIGI": "BBG001S5N8V8"},
    {"jobId": "FB_INCLUDE_UNLISTED", "state": "UNIQUE_POINT_MAPPING", "figi": "BBG01VRMNFB1", "compositeFIGI": "BBG01VRMNFB1", "shareClassFIGI": "BBG01VRMNGC8"},
    {"jobId": "META_INCLUDE_UNLISTED", "state": "UNIQUE_POINT_MAPPING", "figi": "BBG000MM2P62", "compositeFIGI": "BBG000MM2P62", "shareClassFIGI": "BBG001SQCQC5"},
    {"jobId": "ATVI_DEFAULT", "state": "NO_MAPPING_WARNING", "figi": None, "compositeFIGI": None, "shareClassFIGI": None},
    {"jobId": "ATVI_INCLUDE_UNLISTED", "state": "UNIQUE_POINT_MAPPING", "figi": "BBG000CVWGS6", "compositeFIGI": "BBG000CVWGS6", "shareClassFIGI": "BBG001S6C009"},
)
FIGI_KEYS = ("figi", "compositeFIGI", "shareClassFIGI")
ROW_KEYS = {"jobId", "state", *FIGI_KEYS}
V1_DATA_KEYS = {
    "figi", "securityType", "marketSector", "ticker", "name", "exchCode",
    "shareClassFIGI", "compositeFIGI", "securityType2", "securityDescription",
}
FORBIDDEN_OUTPUT_KEYS = {
    "name", "ticker", "securityDescription", "marketSector", "exchCode",
    "securityType", "securityType2", "bodyBase64", "rawBody", "responseBody",
    "price", "return", "terminalPayment", "terminalWealth", "delistingDate",
    "lastTradingSession",
}
LOCKS = {
    "outcomesAccessed": False,
    "pricesAccessed": False,
    "returnsAccessed": False,
    "historicalIntervalClaimed": False,
    "historicalBridgeClaimed": False,
    "terminalStatusClaimed": False,
    "terminalPaymentClaimed": False,
    "originalV4GateCredit": False,
    "humanAttestation": False,
}
FIGI_RE = re.compile(r"^BBG[A-Z0-9]{9}$")


class SanitizeError(RuntimeError):
    pass


def canonical_bytes(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def final_bytes(value: Any) -> bytes:
    return canonical_bytes(value) + b"\n"


def sha256_bytes(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def self_hash(value: dict[str, Any], field: str) -> str:
    copied = copy.deepcopy(value)
    copied.pop(field, None)
    return sha256_bytes(canonical_bytes(copied))


def exact_keys(value: Any, expected: set[str], label: str) -> None:
    if not isinstance(value, dict) or set(value) != expected:
        actual = sorted(value) if isinstance(value, dict) else type(value).__name__
        raise SanitizeError(f"{label} exact keys mismatch: {actual}")


def read_json(raw: bytes, label: str) -> dict[str, Any]:
    try:
        value = json.loads(raw)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise SanitizeError(f"{label} is not valid UTF-8 JSON: {exc}") from exc
    if not isinstance(value, dict):
        raise SanitizeError(f"{label} must be an object")
    return value


def load_contract() -> dict[str, Any]:
    raw = CONTRACT_PATH.read_bytes()
    if sha256_bytes(raw) != EXPECTED_CONTRACT_RAW_SHA256:
        raise SanitizeError("contract raw-byte hash mismatch")
    contract = read_json(raw, "contract")
    if contract.get("contractSha256") != self_hash(contract, "contractSha256") or contract["contractSha256"] != EXPECTED_CONTRACT_SHA256:
        raise SanitizeError("contract self-hash mismatch")
    validate_contract(contract)
    return contract


def validate_contract(contract: dict[str, Any]) -> None:
    if contract.get("schema") != "openfigi-figi-only-disposition-contract/v2":
        raise SanitizeError("contract schema drift")
    v1 = contract.get("v1Disposition")
    if not isinstance(v1, dict) or v1.get("status") != "QUARANTINED_DESCRIPTIVE_FIELDS_RIGHTS_UNCLEARED" or v1.get("studyCredit") != "ZERO":
        raise SanitizeError("V1 quarantine drift")
    if v1.get("eligibleForAnyStudyGate") is not False or v1.get("eligibleForOriginalV4") is not False or v1.get("publicationAllowed") is not False:
        raise SanitizeError("V1 credit/publication lock drift")
    v2 = contract.get("v2Disposition")
    if not isinstance(v2, dict) or v2.get("status") != "PUBLIC_FIGI_ONLY_POINT_EVIDENCE" or v2.get("originalV4GateCredit") != "ZERO":
        raise SanitizeError("V2 disposition drift")
    if v2.get("descriptiveFieldsIncluded") is not False or v2.get("rawProviderBodyIncluded") is not False:
        raise SanitizeError("V2 sanitization lock drift")
    if contract.get("locks") != LOCKS:
        raise SanitizeError("claim locks drift")
    if set(contract.get("forbiddenOutputKeys", [])) != FORBIDDEN_OUTPUT_KEYS:
        raise SanitizeError("forbidden output-key set drift")
    derivation = contract.get("derivation", {})
    if tuple(derivation.get("expectedJobOrder", [])) != EXPECTED_JOB_ORDER or derivation.get("expectedStates") != EXPECTED_STATES:
        raise SanitizeError("derivation population drift")
    if set(derivation.get("rowExactKeys", [])) != ROW_KEYS or set(derivation.get("sourceFieldsAllowedToDerive", [])) != ROW_KEYS:
        raise SanitizeError("FIGI-only row contract drift")
    if contract.get("output", {}).get("path") != OUTPUT_PATH.relative_to(ROOT).as_posix():
        raise SanitizeError("output path drift")
    terms = contract.get("termsBinding", {})
    expected_terms = {
        "sourcePath": TERMS_SOURCE_PATH.relative_to(ROOT).as_posix(),
        "sourceRawSha256": EXPECTED_TERMS_SOURCE_SHA256,
        "snapshotPath": TERMS_PATH.relative_to(ROOT).as_posix(),
        "snapshotRawSha256": EXPECTED_TERMS_RAW_SHA256,
        "snapshotSha256": EXPECTED_TERMS_SELF_SHA256,
        "publicDomainScope": "FIGI_IDENTIFIERS_ONLY",
        "relatedDescriptionsDisposition": "EXCLUDED_FROM_V2",
    }
    if terms != expected_terms:
        raise SanitizeError("terms binding drift")
    source = contract.get("v1Binding", {})
    expected_source = {
        "path": V1_PATH.relative_to(ROOT).as_posix(), "rawSha256": EXPECTED_V1_RAW_SHA256,
        "bundleSha256": EXPECTED_V1_SELF_SHA256, "requestRawSha256": EXPECTED_V1_REQUEST_SHA256,
        "responseRawSha256": EXPECTED_V1_RESPONSE_SHA256, "introductionTag": 742,
        "introductionCommit": EXPECTED_V1_COMMIT, "introductionGitBlob": EXPECTED_V1_BLOB,
    }
    if source != expected_source:
        raise SanitizeError("V1 binding drift")
    remote = contract.get("remoteBinding", {})
    if remote.get("minimumRemoteBaseCommit") != EXPECTED_REMOTE_BASE or remote.get("url") != EXPECTED_REMOTE_URL or remote.get("ref") != EXPECTED_REMOTE_REF:
        raise SanitizeError("remote-base binding drift")
    allowed = set(contract.get("claimCeiling", {}).get("allowed", []))
    forbidden = set(contract.get("claimCeiling", {}).get("forbidden", []))
    if allowed != {"CURRENT_POINT_FIGI_MAPPING", "NEGATIVE_TICKER_REUSE_EVIDENCE"} or "ORIGINAL_V4_GATE_CREDIT" not in forbidden or "HISTORICAL_VALIDITY_INTERVAL" not in forbidden:
        raise SanitizeError("claim ceiling drift")


def load_terms() -> dict[str, Any]:
    raw = TERMS_PATH.read_bytes()
    if sha256_bytes(raw) != EXPECTED_TERMS_RAW_SHA256:
        raise SanitizeError("terms snapshot raw hash mismatch")
    value = read_json(raw, "terms snapshot")
    if value.get("snapshotSha256") != self_hash(value, "snapshotSha256") or value["snapshotSha256"] != EXPECTED_TERMS_SELF_SHA256:
        raise SanitizeError("terms snapshot self-hash mismatch")
    source_raw = TERMS_SOURCE_PATH.read_bytes()
    if sha256_bytes(source_raw) != EXPECTED_TERMS_SOURCE_SHA256:
        raise SanitizeError("terms HTML raw hash mismatch")
    expected_semantics = {
        "figiIdentifiers": "PUBLIC_DOMAIN_FREE_REPRODUCTION_DISTRIBUTION_AND_USE",
        "relatedSecurityDescriptions": "AS_IS_NO_ACCURACY_GUARANTEE_NO_PUBLIC_DOMAIN_CLAIM_IN_THIS_STUDY",
        "trademark": "FAIR_REFERENCE_ONLY_NO_ENDORSEMENT_OR_SPONSORSHIP_IMPLICATION",
        "termsMayChange": True,
    }
    if value.get("semanticFacts") != expected_semantics:
        raise SanitizeError("terms semantic disposition drift")
    return value


def decode_base64(value: Any, label: str) -> bytes:
    if not isinstance(value, str):
        raise SanitizeError(f"{label} must be base64 text")
    try:
        return base64.b64decode(value, validate=True)
    except (ValueError, TypeError) as exc:
        raise SanitizeError(f"{label} base64 invalid") from exc


def validate_figi(value: Any, label: str) -> str:
    if not isinstance(value, str) or not FIGI_RE.fullmatch(value):
        raise SanitizeError(f"{label} invalid FIGI")
    return value


def derive_rows(v1: dict[str, Any]) -> list[dict[str, Any]]:
    if v1.get("bundleSha256") != self_hash(v1, "bundleSha256") or v1["bundleSha256"] != EXPECTED_V1_SELF_SHA256:
        raise SanitizeError("V1 bundle self-hash mismatch")
    if v1.get("networkStatus") != "QUALIFIED" or v1.get("diagnostic") is not None:
        raise SanitizeError("V1 qualification drift")
    request = v1.get("request", {})
    response = v1.get("response", {})
    request_raw = decode_base64(request.get("bodyBase64"), "V1 request")
    response_raw = decode_base64(response.get("bodyBase64"), "V1 response")
    if sha256_bytes(request_raw) != EXPECTED_V1_REQUEST_SHA256 or request.get("sha256") != EXPECTED_V1_REQUEST_SHA256 or request.get("byteLength") != len(request_raw):
        raise SanitizeError("V1 request binding drift")
    if sha256_bytes(response_raw) != EXPECTED_V1_RESPONSE_SHA256 or response.get("sha256") != EXPECTED_V1_RESPONSE_SHA256 or response.get("byteLength") != len(response_raw):
        raise SanitizeError("V1 response binding drift")
    try:
        raw_jobs = json.loads(response_raw)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise SanitizeError("V1 response JSON invalid") from exc
    parsed_jobs = v1.get("parsed", {}).get("jobs")
    if not isinstance(raw_jobs, list) or len(raw_jobs) != len(EXPECTED_JOB_ORDER) or not isinstance(parsed_jobs, list) or len(parsed_jobs) != len(EXPECTED_JOB_ORDER):
        raise SanitizeError("V1 job population drift")
    rows: list[dict[str, Any]] = []
    for index, job_id in enumerate(EXPECTED_JOB_ORDER):
        parsed = parsed_jobs[index]
        if not isinstance(parsed, dict) or parsed.get("jobId") != job_id or parsed.get("state") != EXPECTED_STATES[job_id]:
            raise SanitizeError(f"V1 job identity/state drift: {job_id}")
        raw_result = raw_jobs[index]
        if EXPECTED_STATES[job_id] == "NO_MAPPING_WARNING":
            exact_keys(parsed, {"jobId", "state", "warning"}, f"V1 parsed {job_id}")
            if raw_result != {"warning": "No identifier found."} or parsed["warning"] != "No identifier found.":
                raise SanitizeError(f"V1 no-map evidence drift: {job_id}")
            row = {"jobId": job_id, "state": "NO_MAPPING_WARNING", "figi": None, "compositeFIGI": None, "shareClassFIGI": None}
        else:
            exact_keys(parsed, {"jobId", "state", "mapping"}, f"V1 parsed {job_id}")
            exact_keys(raw_result, {"data"}, f"V1 raw {job_id}")
            data = raw_result["data"]
            if not isinstance(data, list) or len(data) != 1:
                raise SanitizeError(f"V1 ambiguous/missing mapping: {job_id}")
            mapping = data[0]
            exact_keys(mapping, V1_DATA_KEYS, f"V1 raw mapping {job_id}")
            if parsed["mapping"] != mapping:
                raise SanitizeError(f"V1 raw/parsed mismatch: {job_id}")
            row = {"jobId": job_id, "state": "UNIQUE_POINT_MAPPING"}
            for key in FIGI_KEYS:
                row[key] = validate_figi(mapping.get(key), f"{job_id}.{key}")
        exact_keys(row, ROW_KEYS, f"V2 row {job_id}")
        rows.append(row)
    if v1.get("locks") is None or any(v1["locks"].values()) or v1.get("parsed", {}).get("locks") != v1["locks"]:
        raise SanitizeError("V1 outcome/claim locks drift")
    return rows


def load_v1() -> tuple[dict[str, Any], bytes]:
    raw = V1_PATH.read_bytes()
    if sha256_bytes(raw) != EXPECTED_V1_RAW_SHA256:
        raise SanitizeError("V1 capture raw hash mismatch")
    value = read_json(raw, "V1 capture")
    derive_rows(value)
    return value, raw


def git_text(*args: str) -> str:
    result = subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True, encoding="utf-8", check=False)
    if result.returncode != 0:
        raise SanitizeError(f"git {' '.join(args)} failed: {result.stderr.strip()}")
    return result.stdout.strip()


def is_ancestor(ancestor: str, descendant: str) -> bool:
    return subprocess.run(["git", "merge-base", "--is-ancestor", ancestor, descendant], cwd=ROOT, check=False).returncode == 0


def implementation_snapshot(require_remote: bool) -> dict[str, Any]:
    paths = (CONTRACT_PATH, BUILDER_PATH, TEST_PATH, V1_PATH, TERMS_PATH, TERMS_SOURCE_PATH)
    files: dict[str, dict[str, Any]] = {}
    raw_by_path: dict[Path, bytes] = {}
    for path in paths:
        raw = path.read_bytes()
        raw_by_path[path] = raw
        files[path.relative_to(ROOT).as_posix()] = {"bytes": len(raw), "sha256": sha256_bytes(raw)}
    snapshot = {
        "remoteVerified": False, "headCommit": None, "remoteRef": EXPECTED_REMOTE_REF,
        "remoteUrl": EXPECTED_REMOTE_URL, "minimumRemoteBaseCommit": EXPECTED_REMOTE_BASE,
        "v1IntroductionCommit": EXPECTED_V1_COMMIT, "files": files,
    }
    if not require_remote:
        return snapshot
    head = git_text("rev-parse", "HEAD")
    upstream = git_text("rev-parse", "@{upstream}")
    if git_text("remote", "get-url", "origin") != EXPECTED_REMOTE_URL:
        raise SanitizeError("origin URL drift")
    remote_lines = git_text("ls-remote", "origin", EXPECTED_REMOTE_REF).splitlines()
    if len(remote_lines) != 1:
        raise SanitizeError("live remote ref unavailable")
    live_remote = remote_lines[0].split()[0]
    if head != upstream or head != live_remote:
        raise SanitizeError("local/upstream/live-remote drift")
    if not is_ancestor(EXPECTED_REMOTE_BASE, head) or not is_ancestor(EXPECTED_V1_COMMIT, head):
        raise SanitizeError("remote lineage drift")
    if git_text("rev-parse", f"{EXPECTED_V1_COMMIT}:{V1_PATH.relative_to(ROOT).as_posix()}") != EXPECTED_V1_BLOB:
        raise SanitizeError("V1 introduction blob drift")
    for path, raw in raw_by_path.items():
        relative = path.relative_to(ROOT).as_posix()
        blob = subprocess.run(["git", "show", f"{head}:{relative}"], cwd=ROOT, capture_output=True, check=False)
        if blob.returncode != 0 or blob.stdout != raw:
            raise SanitizeError(f"local/HEAD Git blob drift: {relative}")
    snapshot["remoteVerified"] = True
    snapshot["headCommit"] = head
    return snapshot


def collect_keys(value: Any) -> set[str]:
    keys: set[str] = set()
    if isinstance(value, dict):
        keys.update(value)
        for item in value.values():
            keys.update(collect_keys(item))
    elif isinstance(value, list):
        for item in value:
            keys.update(collect_keys(item))
    return keys


def build_payload(contract: dict[str, Any], v1: dict[str, Any], implementation: dict[str, Any]) -> dict[str, Any]:
    rows = derive_rows(v1)
    payload = {
        "schema": "openfigi-figi-only-capture/v2",
        "track": contract["track"],
        "taskId": contract["taskId"],
        "sourceId": contract["sourceId"],
        "contractBinding": {
            "path": CONTRACT_PATH.relative_to(ROOT).as_posix(),
            "rawSha256": EXPECTED_CONTRACT_RAW_SHA256,
            "contractSha256": EXPECTED_CONTRACT_SHA256,
        },
        "v1Disposition": copy.deepcopy(contract["v1Disposition"]),
        "v2Disposition": copy.deepcopy(contract["v2Disposition"]),
        "termsBinding": copy.deepcopy(contract["termsBinding"]),
        "sourceV1": {
            "path": contract["v1Binding"]["path"], "rawSha256": EXPECTED_V1_RAW_SHA256,
            "bundleSha256": EXPECTED_V1_SELF_SHA256, "requestRawSha256": EXPECTED_V1_REQUEST_SHA256,
            "responseRawSha256": EXPECTED_V1_RESPONSE_SHA256, "introductionCommit": EXPECTED_V1_COMMIT,
            "introductionGitBlob": EXPECTED_V1_BLOB,
        },
        "implementation": copy.deepcopy(implementation),
        "rows": rows,
        "counts": {
            "rows": len(rows), "mapped": sum(row["state"] == "UNIQUE_POINT_MAPPING" for row in rows),
            "noMap": sum(row["state"] == "NO_MAPPING_WARNING" for row in rows),
            "uniqueFigi": len({row["figi"] for row in rows if row["figi"] is not None}),
        },
        "claimCeiling": copy.deepcopy(contract["claimCeiling"]),
        "locks": copy.deepcopy(LOCKS),
    }
    payload["payloadSha256"] = self_hash(payload, "payloadSha256")
    validate_payload(payload, contract)
    return payload


def validate_payload(payload: Any, contract: dict[str, Any]) -> None:
    expected_top = {
        "schema", "track", "taskId", "sourceId", "contractBinding", "v1Disposition",
        "v2Disposition", "termsBinding", "sourceV1", "implementation", "rows", "counts",
        "claimCeiling", "locks", "payloadSha256",
    }
    exact_keys(payload, expected_top, "V2 payload")
    if payload["schema"] != "openfigi-figi-only-capture/v2" or payload["payloadSha256"] != self_hash(payload, "payloadSha256"):
        raise SanitizeError("V2 payload schema/self-hash drift")
    if (payload["track"], payload["taskId"], payload["sourceId"]) != (contract["track"], contract["taskId"], contract["sourceId"]):
        raise SanitizeError("V2 identity binding drift")
    expected_contract_binding = {
        "path": CONTRACT_PATH.relative_to(ROOT).as_posix(),
        "rawSha256": EXPECTED_CONTRACT_RAW_SHA256,
        "contractSha256": EXPECTED_CONTRACT_SHA256,
    }
    if payload["contractBinding"] != expected_contract_binding:
        raise SanitizeError("V2 contract binding drift")
    leaked = collect_keys(payload) & FORBIDDEN_OUTPUT_KEYS
    if leaked:
        raise SanitizeError(f"V2 forbidden output key leak: {sorted(leaked)}")
    if payload["v1Disposition"] != contract["v1Disposition"] or payload["v1Disposition"]["studyCredit"] != "ZERO":
        raise SanitizeError("V1 quarantine/credit leak")
    if payload["v2Disposition"] != contract["v2Disposition"] or payload["locks"] != LOCKS:
        raise SanitizeError("V2 disposition/lock drift")
    if payload["termsBinding"] != contract["termsBinding"]:
        raise SanitizeError("V2 terms binding drift")
    expected_source_v1 = {
        "path": contract["v1Binding"]["path"], "rawSha256": EXPECTED_V1_RAW_SHA256,
        "bundleSha256": EXPECTED_V1_SELF_SHA256, "requestRawSha256": EXPECTED_V1_REQUEST_SHA256,
        "responseRawSha256": EXPECTED_V1_RESPONSE_SHA256, "introductionCommit": EXPECTED_V1_COMMIT,
        "introductionGitBlob": EXPECTED_V1_BLOB,
    }
    if payload["sourceV1"] != expected_source_v1:
        raise SanitizeError("V2 source-V1 binding drift")
    implementation = payload["implementation"]
    expected_implementation_keys = {
        "remoteVerified", "headCommit", "remoteRef", "remoteUrl", "minimumRemoteBaseCommit",
        "v1IntroductionCommit", "files",
    }
    exact_keys(implementation, expected_implementation_keys, "V2 implementation")
    expected_files = implementation_snapshot(False)["files"]
    if (
        implementation["remoteRef"] != EXPECTED_REMOTE_REF
        or implementation["remoteUrl"] != EXPECTED_REMOTE_URL
        or implementation["minimumRemoteBaseCommit"] != EXPECTED_REMOTE_BASE
        or implementation["v1IntroductionCommit"] != EXPECTED_V1_COMMIT
        or implementation["files"] != expected_files
    ):
        raise SanitizeError("V2 implementation provenance drift")
    if implementation["remoteVerified"] is True:
        validate_remote_marker(implementation)
    elif implementation["remoteVerified"] is not False or implementation["headCommit"] is not None:
        raise SanitizeError("V2 implementation verification-state drift")
    rows = payload["rows"]
    if not isinstance(rows, list) or len(rows) != len(EXPECTED_JOB_ORDER):
        raise SanitizeError("V2 row population drift")
    for index, row in enumerate(rows):
        exact_keys(row, ROW_KEYS, f"V2 payload row {index}")
        job_id = EXPECTED_JOB_ORDER[index]
        if row["jobId"] != job_id or row["state"] != EXPECTED_STATES[job_id]:
            raise SanitizeError(f"V2 row identity/state drift: {job_id}")
        if row["state"] == "NO_MAPPING_WARNING":
            if any(row[key] is not None for key in FIGI_KEYS):
                raise SanitizeError(f"V2 no-map identifiers must be null: {job_id}")
        else:
            for key in FIGI_KEYS:
                validate_figi(row[key], f"V2 payload {job_id}.{key}")
    if rows != list(EXPECTED_SANITIZED_ROWS):
        raise SanitizeError("V2 identifier binding drift")
    if payload["counts"] != {"rows": 5, "mapped": 4, "noMap": 1, "uniqueFigi": 4}:
        raise SanitizeError("V2 counts drift")
    if payload["claimCeiling"] != contract["claimCeiling"] or payload["v2Disposition"]["originalV4GateCredit"] != "ZERO":
        raise SanitizeError("V2 claim/study-credit drift")


def validate_output_path(value: str) -> Path:
    candidate = Path(value)
    if not candidate.is_absolute():
        candidate = ROOT / candidate
    if candidate.resolve() != OUTPUT_PATH.resolve():
        raise SanitizeError("sidepath output rejected")
    if candidate.exists():
        raise SanitizeError("write-new output already exists")
    if not candidate.parent.is_dir():
        raise SanitizeError("output parent directory missing")
    return candidate


def atomic_create_new(path: Path, raw: bytes) -> None:
    if path.exists():
        raise SanitizeError("write-new output already exists")
    descriptor, temp_name = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    temp_path = Path(temp_name)
    linked = False
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(raw)
            handle.flush()
            os.fsync(handle.fileno())
        os.link(temp_path, path)
        linked = True
        if path.read_bytes() != raw:
            raise SanitizeError("atomic output verification failed")
    except FileExistsError as exc:
        raise SanitizeError("write-new output race detected") from exc
    finally:
        if temp_path.exists():
            temp_path.unlink()
        if not linked and path.exists():
            raise SanitizeError("unexpected output appeared during failed atomic write")


def expect_rejected(label: str, action: Any, fragment: str) -> None:
    try:
        action()
    except SanitizeError as exc:
        if fragment not in str(exc):
            raise SanitizeError(f"{label} wrong rejection: {exc}") from exc
        return
    raise SanitizeError(f"{label} tamper accepted")


def self_test(contract: dict[str, Any], v1: dict[str, Any], terms: dict[str, Any]) -> None:
    implementation = implementation_snapshot(False)
    payload = build_payload(contract, v1, implementation)
    if canonical_bytes(payload) != canonical_bytes(build_payload(contract, copy.deepcopy(v1), copy.deepcopy(implementation))):
        raise SanitizeError("deterministic rebuild failed")
    if collect_keys(payload) & FORBIDDEN_OUTPUT_KEYS:
        raise SanitizeError("baseline payload leaked descriptions")

    for key in ("ticker", "name", "securityDescription", "bodyBase64", "rawBody"):
        tamper = copy.deepcopy(payload)
        tamper["rows"][0][key] = "LEAK"
        tamper["payloadSha256"] = self_hash(tamper, "payloadSha256")
        expect_rejected(f"leak {key}", lambda tamper=tamper: validate_payload(tamper, contract), "forbidden output key leak")
    tamper = copy.deepcopy(payload)
    tamper["v1Disposition"]["studyCredit"] = "ONE"
    tamper["payloadSha256"] = self_hash(tamper, "payloadSha256")
    expect_rejected("V1 credit", lambda: validate_payload(tamper, contract), "V1 quarantine/credit")
    tamper = copy.deepcopy(payload)
    tamper["rows"][0]["figi"] = "BBG000000000"
    tamper["payloadSha256"] = self_hash(tamper, "payloadSha256")
    expect_rejected("identifier", lambda: validate_payload(tamper, contract), "identifier binding drift")
    tamper = copy.deepcopy(payload)
    tamper["contractBinding"]["contractSha256"] = "0" * 64
    tamper["payloadSha256"] = self_hash(tamper, "payloadSha256")
    expect_rejected("contract binding", lambda: validate_payload(tamper, contract), "contract binding drift")
    tamper = copy.deepcopy(payload)
    tamper["sourceV1"]["rawSha256"] = "0" * 64
    tamper["payloadSha256"] = self_hash(tamper, "payloadSha256")
    expect_rejected("V1 provenance", lambda: validate_payload(tamper, contract), "source-V1 binding drift")
    tamper = copy.deepcopy(payload)
    tamper["termsBinding"]["sourceRawSha256"] = "0" * 64
    tamper["payloadSha256"] = self_hash(tamper, "payloadSha256")
    expect_rejected("terms provenance", lambda: validate_payload(tamper, contract), "terms binding drift")
    tamper = copy.deepcopy(payload)
    tamper["implementation"]["remoteUrl"] = "https://proxy.invalid/repo.git"
    tamper["payloadSha256"] = self_hash(tamper, "payloadSha256")
    expect_rejected("implementation provenance", lambda: validate_payload(tamper, contract), "implementation provenance drift")

    for field in ("price", "terminalPayment"):
        source = copy.deepcopy(v1)
        response_raw = decode_base64(source["response"]["bodyBase64"], "test response")
        response = json.loads(response_raw)
        response[4]["data"][0][field] = 1
        mutated_raw = canonical_bytes(response)
        source["response"]["bodyBase64"] = base64.b64encode(mutated_raw).decode("ascii")
        source["response"]["byteLength"] = len(mutated_raw)
        source["response"]["sha256"] = sha256_bytes(mutated_raw)
        source["bundleSha256"] = self_hash(source, "bundleSha256")
        expect_rejected(field, lambda source=source: derive_rows(source), "V1 bundle self-hash mismatch")
    source = copy.deepcopy(v1)
    source["parsed"]["jobs"][4]["mapping"]["figi"] = "BBG000000000"
    source["bundleSha256"] = self_hash(source, "bundleSha256")
    expect_rejected("altered identifier", lambda: derive_rows(source), "V1 bundle self-hash mismatch")
    source = copy.deepcopy(v1)
    source["parsed"]["jobs"][3] = {"jobId": "ATVI_DEFAULT", "state": "UNIQUE_POINT_MAPPING", "mapping": source["parsed"]["jobs"][4]["mapping"]}
    source["bundleSha256"] = self_hash(source, "bundleSha256")
    expect_rejected("no-map state", lambda: derive_rows(source), "V1 bundle self-hash mismatch")
    terms_tamper = copy.deepcopy(terms)
    terms_tamper["semanticFacts"]["relatedSecurityDescriptions"] = "PUBLIC_DOMAIN"
    terms_tamper["snapshotSha256"] = self_hash(terms_tamper, "snapshotSha256")
    expect_rejected("terms drift", lambda: validate_terms_object(terms_tamper), "terms semantic disposition drift")
    expect_rejected("sidepath", lambda: validate_output_path("reports/early-detection/not-the-v2-output.json"), "sidepath")
    non_remote = implementation_snapshot(False)
    expect_rejected("non-remote", lambda: validate_remote_marker(non_remote), "not remote verified")


def validate_terms_object(value: dict[str, Any]) -> None:
    expected = {
        "figiIdentifiers": "PUBLIC_DOMAIN_FREE_REPRODUCTION_DISTRIBUTION_AND_USE",
        "relatedSecurityDescriptions": "AS_IS_NO_ACCURACY_GUARANTEE_NO_PUBLIC_DOMAIN_CLAIM_IN_THIS_STUDY",
        "trademark": "FAIR_REFERENCE_ONLY_NO_ENDORSEMENT_OR_SPONSORSHIP_IMPLICATION",
        "termsMayChange": True,
    }
    if value.get("semanticFacts") != expected:
        raise SanitizeError("terms semantic disposition drift")


def validate_remote_marker(snapshot: dict[str, Any]) -> None:
    if snapshot.get("remoteVerified") is not True or not snapshot.get("headCommit"):
        raise SanitizeError("implementation not remote verified")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=("verify-contract", "self-test", "build"))
    parser.add_argument("--output")
    args = parser.parse_args()
    try:
        contract = load_contract()
        terms = load_terms()
        v1, _ = load_v1()
        if args.command == "verify-contract":
            print(json.dumps({"status": "PASS", "contractSha256": contract["contractSha256"], "v1Disposition": contract["v1Disposition"]["status"], "v1StudyCredit": "ZERO", "locks": LOCKS}, sort_keys=True))
            return 0
        if args.command == "self-test":
            self_test(contract, v1, terms)
            print(json.dumps({"status": "PASS", "tests": 20, "v1StudyCredit": "ZERO", "locks": LOCKS}, sort_keys=True))
            return 0
        if not args.output:
            raise SanitizeError("build requires --output")
        output = validate_output_path(args.output)
        before = implementation_snapshot(True)
        payload = build_payload(contract, v1, before)
        after = implementation_snapshot(True)
        if before != after:
            raise SanitizeError("pre/post build implementation snapshot drift")
        raw = final_bytes(payload)
        atomic_create_new(output, raw)
        print(json.dumps({"status": "PASS", "output": output.relative_to(ROOT).as_posix(), "bytes": len(raw), "rawSha256": sha256_bytes(raw), "payloadSha256": payload["payloadSha256"], "implementationCommit": before["headCommit"], "v1StudyCredit": "ZERO", "locks": LOCKS}, sort_keys=True))
        return 0
    except (SanitizeError, OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        print(f"FAIL_CLOSED: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())

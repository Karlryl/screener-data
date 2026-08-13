#!/usr/bin/env python3
"""Build SEC Form 3/4/5 issuer-symbol point evidence with explicit issuer-name missingness."""
from __future__ import annotations

import argparse
import copy
import csv
import hashlib
import importlib.util
import io
import json
import os
import re
import subprocess
from datetime import date
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
CONTRACT_PATH = ROOT / "research" / "early-detection-v4" / "sec-form345-issuer-symbol-point-contract-v2.json"
BUILDER_PATH = Path(__file__).resolve()
TEST_PATH = ROOT / "tests" / "build-sec-form345-issuer-symbol-point-v2.test.js"
OUTPUT_PATH = ROOT / "reports" / "early-detection" / "sec-form345-issuer-symbol-point-v2.json"
QUEUE_PATH = ROOT / "reports" / "early-detection" / "sec-terminal-identity-evidence-gap-queue-v1.json"
V1_CONTRACT_PATH = ROOT / "research" / "early-detection-v4" / "sec-form345-issuer-symbol-point-contract-v1.json"
V1_BUILDER_PATH = ROOT / "scripts" / "build-sec-form345-issuer-symbol-point-v1.py"
V1_TEST_PATH = ROOT / "tests" / "build-sec-form345-issuer-symbol-point-v1.test.js"

CONTRACT_RAW_SHA256 = "b3d7a6ab30999cac316e7e92b159a2ecf1b6339531c6c8a11dbe93a2003e26c4"
PARENT_REMOTE_COMMIT = "c172b73a36e7b3001797520514c790925f258784"
PARENT_TAG = 837
REMOTE_URL = "https://github.com/Karlryl/screener-data.git"
REMOTE_REF = "refs/heads/codex/early-detection-v4-gates-20260810"
REMOTE_TRACKING_REF = "origin/codex/early-detection-v4-gates-20260810"
V1_INTRODUCTION_COMMIT = "b33ebca4a60155dd3f31e8c7e40696a293be1dd0"
V1_INTRODUCTION_PARENT = "95b10fe726557c75dc1bcc828f595214fb77c8e2"
V1_CONTRACT_RAW_SHA256 = "96aac6435c470ccd3c9f4b1e453951fa788f0b14d88d7f046270a65a71b1a8f8"
V1_CONTRACT_SELF_SHA256 = "d5069e503b5107f2f6924df4c938f3339d72798b3f35c657b2007f8e51660340"
V1_BUILDER_RAW_SHA256 = "016f1014b89b605ba7ebd692e50d7112fc4c6cf10a491cf8041dad8c8d6b6ca6"
V1_TEST_RAW_SHA256 = "105323ea5047502ab8d7b81fce0d6f91faaa810b1e9670bfe8067ad1cda833f3"
V1_GIT_BLOBS = {
    "research/early-detection-v4/sec-form345-issuer-symbol-point-contract-v1.json": "9087da8b3af4262b0d92fc7df8f798cee6421e8c",
    "scripts/build-sec-form345-issuer-symbol-point-v1.py": "f176abbb1d0bc91c0f31b08955e29434c36b013b",
    "tests/build-sec-form345-issuer-symbol-point-v1.test.js": "164d44781b53047c804ec11eb0e7812aa463c7ac",
}
V1_MANIFEST_RAW_SHA256 = "0f0b52999baa558b48e83696fcbcf7e8ab8613af34d88f55a9a529d2e88586e1"
V1_MANIFEST_SELF_SHA256 = "deb91244154b3093acda0235b0cb6ad443374c21b691cf0bf178c8a641465152"
QUEUE_RAW_SHA256 = "4c5bff255368bb0d9f498a8f367c65964c0de80d577cca70c695afe50ce0c650"
QUEUE_REPORT_SHA256 = "cb0b6272b1c07a8091354336bd9e5e1195ba43f766d393fe46fbebf04874e954"

CONTRACT_SCHEMA = "sec-form345-issuer-symbol-point-contract/v2"
OUTPUT_SCHEMA = "sec-form345-issuer-symbol-point/v2"
SELECTED_FIELDS = (
    "ACCESSION_NUMBER",
    "FILING_DATE",
    "DOCUMENT_TYPE",
    "ISSUERCIK",
    "ISSUERNAME",
    "ISSUERTRADINGSYMBOL",
)
CORE_FIELDS = (
    "ACCESSION_NUMBER",
    "FILING_DATE",
    "DOCUMENT_TYPE",
    "ISSUERCIK",
    "ISSUERTRADINGSYMBOL",
)
ALLOWED_DOCUMENT_TYPES = {"3", "3/A", "4", "4/A", "5", "5/A"}
ACCESSION_RE = re.compile(r"^[0-9]{10}-[0-9]{2}-[0-9]{6}$")
EXPECTED_TOTALS = {
    "allRows": 3_352_003,
    "targetRows": 164_675,
    "blankIssuerNameAllRows": 1_188,
    "blankIssuerNameTargetRows": 23,
}
OWNED_PATHS = (CONTRACT_PATH, BUILDER_PATH, TEST_PATH)


class EvidenceError(RuntimeError):
    """Fail-closed V2 contract, provenance, missingness, or topology error."""


def fail(message: str) -> None:
    raise EvidenceError(message)


def sha256(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def canonical_bytes(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def exact_keys(value: dict[str, Any], expected: set[str], label: str) -> None:
    if set(value) != expected:
        fail(f"{label} keys changed")


def with_self_hash(value: dict[str, Any], field: str) -> dict[str, Any]:
    value[field] = sha256(canonical_bytes({key: item for key, item in value.items() if key != field}))
    return value


def validate_self_hash(value: dict[str, Any], field: str, label: str) -> None:
    expected = sha256(canonical_bytes({key: item for key, item in value.items() if key != field}))
    if value.get(field) != expected:
        fail(f"{label} self hash changed")


def git_text(*args: str) -> str:
    result = subprocess.run(["git", *args], cwd=ROOT, check=True, capture_output=True, text=True)
    return result.stdout.strip()


def git_bytes(*args: str) -> bytes:
    return subprocess.run(["git", *args], cwd=ROOT, check=True, capture_output=True).stdout


def load_v1_module() -> Any:
    spec = importlib.util.spec_from_file_location("sec_form345_point_v1_bound", V1_BUILDER_PATH)
    if spec is None or spec.loader is None:
        fail("V1 builder cannot be imported")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def validate_contract_value(value: dict[str, Any]) -> None:
    exact_keys(value, {
        "schema", "createdAt", "taskId", "track", "purpose", "remoteBinding",
        "authorizedImplementation", "immutableV1Base", "privateCapture", "gapQueue",
        "sourceScope", "v1FailureObservation", "missingnessPolicy", "futureOutput",
        "claimCeiling", "claimLocks", "abortCriteria", "contractSha256",
    }, "V2 contract")
    validate_self_hash(value, "contractSha256", "V2 contract")
    if value["schema"] != CONTRACT_SCHEMA or value["taskId"] != "Q005-SEC-FORM345-ISSUER-SYMBOL-POINT-V2":
        fail("V2 contract identity changed")
    if value["track"] != "SHARED_OUTCOME_BLIND_INFRA":
        fail("V2 track changed")
    if value["remoteBinding"] != {
        "remote": REMOTE_URL,
        "ref": REMOTE_REF,
        "parentRemoteCommit": PARENT_REMOTE_COMMIT,
        "parentTag": PARENT_TAG,
        "productionExecutionRequiresRemoteDirectChild": True,
        "precommitCommandsAllowedAtExactParent": ["verify-contract", "dry-run", "self-test"],
    }:
        fail("V2 remote binding changed")
    if value["authorizedImplementation"] != {
        "contractPath": "research/early-detection-v4/sec-form345-issuer-symbol-point-contract-v2.json",
        "builderPath": "scripts/build-sec-form345-issuer-symbol-point-v2.py",
        "testPath": "tests/build-sec-form345-issuer-symbol-point-v2.test.js",
        "futureOutputPath": "reports/early-detection/sec-form345-issuer-symbol-point-v2.json",
    }:
        fail("V2 implementation paths changed")
    v1 = value["immutableV1Base"]
    exact_keys(v1, {
        "introductionCommit", "introductionParent", "contract", "builder", "test",
        "v1RemainsUnmodified", "v1FailedOutputMayNotBePromoted",
    }, "immutable V1 base")
    exact_keys(v1["contract"], {"path", "rawSha256", "selfSha256", "gitBlob"}, "V1 contract binding")
    exact_keys(v1["builder"], {"path", "rawSha256", "gitBlob"}, "V1 builder binding")
    exact_keys(v1["test"], {"path", "rawSha256", "gitBlob"}, "V1 test binding")
    if (
        v1["introductionCommit"] != V1_INTRODUCTION_COMMIT
        or v1["introductionParent"] != V1_INTRODUCTION_PARENT
        or v1["contract"]["path"] != "research/early-detection-v4/sec-form345-issuer-symbol-point-contract-v1.json"
        or v1["builder"]["path"] != "scripts/build-sec-form345-issuer-symbol-point-v1.py"
        or v1["test"]["path"] != "tests/build-sec-form345-issuer-symbol-point-v1.test.js"
        or v1["contract"]["rawSha256"] != V1_CONTRACT_RAW_SHA256
        or v1["contract"]["selfSha256"] != V1_CONTRACT_SELF_SHA256
        or v1["builder"]["rawSha256"] != V1_BUILDER_RAW_SHA256
        or v1["test"]["rawSha256"] != V1_TEST_RAW_SHA256
        or v1["contract"]["gitBlob"] != V1_GIT_BLOBS["research/early-detection-v4/sec-form345-issuer-symbol-point-contract-v1.json"]
        or v1["builder"]["gitBlob"] != V1_GIT_BLOBS["scripts/build-sec-form345-issuer-symbol-point-v1.py"]
        or v1["test"]["gitBlob"] != V1_GIT_BLOBS["tests/build-sec-form345-issuer-symbol-point-v1.test.js"]
        or v1["v1RemainsUnmodified"] is not True
        or v1["v1FailedOutputMayNotBePromoted"] is not True
    ):
        fail("immutable V1 binding changed")
    capture = value["privateCapture"]
    exact_keys(capture, {
        "schema", "defaultRoot", "manifestPath", "manifestRawSha256", "manifestSelfSha256",
        "introductionCommit", "quarterCount", "quarterSequenceSha256", "captureSequenceSha256",
        "readOnly", "redownloadAllowed", "mutationAllowed", "rawZipMayEnterGitOrPublicOutput",
    }, "V1 private capture binding")
    if (
        capture["manifestRawSha256"] != V1_MANIFEST_RAW_SHA256
        or capture["manifestSelfSha256"] != V1_MANIFEST_SELF_SHA256
        or capture["schema"] != "sec-form345-private-capture-manifest/v1"
        or capture["defaultRoot"] != "LOCALAPPDATA/GrowthScreenerResearchData/private/sec-form345-issuer-symbol-point-v1"
        or capture["manifestPath"] != "capture-manifest.json"
        or capture["introductionCommit"] != V1_INTRODUCTION_COMMIT
        or capture["quarterCount"] != 64
        or capture["quarterSequenceSha256"] != "419fc55b178ccb83e1df0c150c9f1c893443dc94d036ae958ae2a4c8e32ca306"
        or capture["captureSequenceSha256"] != "ddb5c17f063197a4c6ddf23a133e8ea29d0ad47ca6c488e2deb51d96f58ab874"
        or capture["readOnly"] is not True
        or capture["redownloadAllowed"] is not False
        or capture["mutationAllowed"] is not False
        or capture["rawZipMayEnterGitOrPublicOutput"] is not False
    ):
        fail("V1 private capture binding changed")
    queue = value["gapQueue"]
    if queue != {
        "path": "reports/early-detection/sec-terminal-identity-evidence-gap-queue-v1.json",
        "rawSha256": QUEUE_RAW_SHA256,
        "reportSha256": QUEUE_REPORT_SHA256,
        "rows": 656,
        "uniqueIssuerCiks": 607,
        "joinKey": "EXACT_CANONICAL_10_DIGIT_ISSUER_CIK",
        "tickerJoinAllowed": False,
        "issuerNameJoinAllowed": False,
        "outcomesAccessed": False,
    }:
        fail("gap queue policy changed")
    source = value["sourceScope"]
    exact_keys(source, {
        "sourceFile", "firstQuarter", "lastQuarter", "expectedQuarterCount", "selectedFields",
        "otherZipMembersMayBeOpened", "ownerTransactionOrHoldingTablesMayBeOpened",
    }, "V2 source scope")
    if (
        source["sourceFile"] != "SUBMISSION.tsv"
        or tuple(source["selectedFields"]) != SELECTED_FIELDS
        or source["firstQuarter"] != "2009Q1"
        or source["lastQuarter"] != "2024Q4"
        or source["expectedQuarterCount"] != 64
        or source["otherZipMembersMayBeOpened"] is not False
        or source["ownerTransactionOrHoldingTablesMayBeOpened"] is not False
    ):
        fail("V2 source scope changed")
    observed = value["v1FailureObservation"]
    exact_keys(observed, {
        "status", "allRows", "targetRows", "blankIssuerNameAllRows",
        "blankIssuerNameTargetRows", "otherSelectedFieldBlankAllRows", "credit",
    }, "observed V1 failure")
    if {key: observed[key] for key in EXPECTED_TOTALS} != EXPECTED_TOTALS:
        fail("observed V1 failure counts changed")
    if (
        observed["status"] != "V1_FAIL_CLOSED_ON_OBSERVED_SOURCE_MISSINGNESS"
        or observed["otherSelectedFieldBlankAllRows"] != 0
        or observed["credit"] != "DIAGNOSTIC_ONLY_NO_STUDY_CREDIT"
    ):
        fail("V1 failure interpretation changed")
    policy = value["missingnessPolicy"]
    exact_keys(policy, {
        "requiredNonblankSourceFields", "nullableSourceField", "presentEncoding", "missingEncoding",
        "inventedImputedOrBackfilledIssuerNameAllowed", "blankCoreFieldDisposition",
        "unknownIssuerNameStateDisposition", "requiredCounts",
    }, "V2 missingness policy")
    if tuple(policy["requiredNonblankSourceFields"]) != CORE_FIELDS:
        fail("core nonblank fields changed")
    if policy["nullableSourceField"] != "ISSUERNAME":
        fail("nullable field changed")
    if policy["presentEncoding"] != {
        "issuerName": "EXACT_TRIMMED_SOURCE_TEXT", "issuerNameState": "PRESENT_SOURCE_VALUE"
    }:
        fail("present issuer-name encoding changed")
    if policy["missingEncoding"] != {"issuerName": None, "issuerNameState": "MISSING_SOURCE_VALUE"}:
        fail("missing issuer-name encoding changed")
    if policy["inventedImputedOrBackfilledIssuerNameAllowed"] is not False:
        fail("issuer-name invention was authorized")
    if policy["blankCoreFieldDisposition"] != "FAIL_CLOSED":
        fail("blank core disposition weakened")
    if policy["unknownIssuerNameStateDisposition"] != "FAIL_CLOSED":
        fail("unknown issuer-name state disposition weakened")
    if policy["requiredCounts"] != [
        "issuerNamePresentAllRows", "issuerNameMissingAllRows",
        "issuerNamePresentTargetPoints", "issuerNameMissingTargetPoints",
    ]:
        fail("required missingness counts changed")
    if value["futureOutput"] != {
        "schema": OUTPUT_SCHEMA,
        "writeNewAtomic": True,
        "oneOutputRowPerGapWorkItem": True,
        "pointDate": "FILING_DATE",
        "amendmentsRemainSeparatePoints": True,
        "issuerNameMissingnessExplicit": True,
        "pointEvidenceMayResolveHistoricalInterval": False,
        "pointEvidenceMayResolvePermanentIdentity": False,
    }:
        fail("V2 output semantics changed")
    expected_lock_keys = {
        "outcomesAccessed", "pricesAccessed", "returnsAccessed",
        "ownerTransactionOrHoldingTablesAccessed", "historicalIdentityIntervalsComplete",
        "permanentSecurityIdentityResolved", "listingIdentityResolved", "tickerReuseResolved",
        "terminalSessionProven", "terminalPaymentVerified", "terminalWealthComplete",
        "originalV4GateCredit", "humanAttestation",
    }
    exact_keys(value["claimLocks"], expected_lock_keys, "V2 claim locks")
    if any(item is not False for item in value["claimLocks"].values()):
        fail("V2 claim lock promoted")
    required_forbidden = {
        "HISTORICAL_IDENTITY_INTERVAL", "PERMANENT_SECURITY_OR_LISTING_IDENTITY",
        "TERMINAL_SESSION_PAYMENT_OR_WEALTH", "PRICE_RETURN_OR_OUTCOME",
        "ORIGINAL_V4_GATE_CREDIT", "HUMAN_ATTESTATION",
    }
    if not required_forbidden.issubset(set(value["claimCeiling"]["forbidden"])):
        fail("V2 claim ceiling weakened")


def load_contract() -> tuple[dict[str, Any], bytes]:
    raw = CONTRACT_PATH.read_bytes()
    if sha256(raw) != CONTRACT_RAW_SHA256:
        fail("V2 contract raw binding changed")
    value = json.loads(raw)
    validate_contract_value(value)
    return value, raw


def validate_topology_values(head: str, remote: str, parent: str | None, production: bool) -> None:
    if production:
        if head == PARENT_REMOTE_COMMIT or remote != head or parent != PARENT_REMOTE_COMMIT:
            fail("production requires the exact remote direct child of Tag837")
    elif head != PARENT_REMOTE_COMMIT or remote != PARENT_REMOTE_COMMIT:
        fail("precommit verification requires exact Tag837 local and remote base")


def verify_precommit_topology() -> dict[str, str]:
    if git_text("remote", "get-url", "origin") != REMOTE_URL:
        fail("origin URL changed")
    head = git_text("rev-parse", "HEAD")
    remote = git_text("rev-parse", REMOTE_TRACKING_REF)
    validate_topology_values(head, remote, None, False)
    return {"head": head, "remote": remote}


def verify_production_topology() -> dict[str, str]:
    if git_text("remote", "get-url", "origin") != REMOTE_URL:
        fail("origin URL changed")
    head = git_text("rev-parse", "HEAD")
    parent = git_text("rev-parse", "HEAD^")
    lines = git_text("ls-remote", "--exit-code", "origin", REMOTE_REF).splitlines()
    if len(lines) != 1:
        fail("remote ref resolution is ambiguous")
    remote = lines[0].split()[0]
    validate_topology_values(head, remote, parent, True)
    for path in OWNED_PATHS:
        relative = path.relative_to(ROOT).as_posix()
        if git_bytes("show", f"{head}:{relative}") != path.read_bytes():
            fail(f"V2 implementation drift: {relative}")
    return {"head": head, "remote": remote, "parent": parent}


def validate_v1_bindings(contract: dict[str, Any]) -> Any:
    expected_files = {
        V1_CONTRACT_PATH: V1_CONTRACT_RAW_SHA256,
        V1_BUILDER_PATH: V1_BUILDER_RAW_SHA256,
        V1_TEST_PATH: V1_TEST_RAW_SHA256,
    }
    for path, expected_hash in expected_files.items():
        relative = path.relative_to(ROOT).as_posix()
        if sha256(path.read_bytes()) != expected_hash:
            fail(f"V1 worktree artifact drift: {relative}")
        if git_text("rev-parse", f"{V1_INTRODUCTION_COMMIT}:{relative}") != V1_GIT_BLOBS[relative]:
            fail(f"V1 Git blob drift: {relative}")
        if git_bytes("show", f"{V1_INTRODUCTION_COMMIT}:{relative}") != path.read_bytes():
            fail(f"V1 committed bytes drift: {relative}")
    if git_text("rev-parse", f"{V1_INTRODUCTION_COMMIT}^") != V1_INTRODUCTION_PARENT:
        fail("V1 introduction parent changed")
    if subprocess.run(
        ["git", "merge-base", "--is-ancestor", V1_INTRODUCTION_COMMIT, "HEAD"], cwd=ROOT
    ).returncode != 0:
        fail("V1 introduction is not an ancestor of HEAD")
    v1 = load_v1_module()
    v1_contract, _raw = v1.load_contract()
    if v1_contract["contractSha256"] != V1_CONTRACT_SELF_SHA256:
        fail("V1 contract self hash changed")
    if contract["immutableV1Base"]["contract"]["gitBlob"] != V1_GIT_BLOBS[
        "research/early-detection-v4/sec-form345-issuer-symbol-point-contract-v1.json"
    ]:
        fail("V2 contract-to-V1 blob binding changed")
    return v1


def canonical_cik(value: Any) -> str:
    text = str(value).strip()
    if not re.fullmatch(r"[0-9]{1,10}", text):
        fail("issuer CIK is not 1-10 ASCII digits")
    return text.zfill(10)


def load_gap_queue() -> dict[str, Any]:
    raw = QUEUE_PATH.read_bytes()
    if sha256(raw) != QUEUE_RAW_SHA256:
        fail("gap queue raw binding changed")
    value = json.loads(raw)
    if value.get("reportSha256") != QUEUE_REPORT_SHA256 or value.get("outcomesAccessed") is not False:
        fail("gap queue self or outcome binding changed")
    if len(value.get("rows", [])) != 656:
        fail("gap queue row count changed")
    if len({canonical_cik(row["issuerCik"]) for row in value["rows"]}) != 607:
        fail("gap queue CIK count changed")
    return value


def default_private_root() -> Path:
    local_app_data = os.environ.get("LOCALAPPDATA")
    if not local_app_data:
        fail("LOCALAPPDATA is required when --private-root is omitted")
    return Path(local_app_data) / "GrowthScreenerResearchData" / "private" / "sec-form345-issuer-symbol-point-v1"


def load_capture_manifest(
    private_root: Path, contract: dict[str, Any], v1: Any, deep: bool
) -> tuple[dict[str, Any], bytes, dict[str, Any]]:
    private_root = v1.validate_private_root(private_root)
    path = private_root / "capture-manifest.json"
    raw = path.read_bytes()
    if sha256(raw) != V1_MANIFEST_RAW_SHA256:
        fail("V1 capture manifest raw binding changed")
    value = json.loads(raw)
    exact_keys(value, {
        "schema", "contractRawSha256", "contractSha256", "parentRemoteCommit",
        "introductionCommit", "completedAtUtc", "quarterCount", "quarterSequenceSha256",
        "receipts", "captureSequenceSha256", "claimLocks", "manifestSha256",
    }, "V1 capture manifest")
    validate_self_hash(value, "manifestSha256", "V1 capture manifest")
    if (
        value["schema"] != contract["privateCapture"]["schema"]
        or value["manifestSha256"] != V1_MANIFEST_SELF_SHA256
        or value["introductionCommit"] != V1_INTRODUCTION_COMMIT
        or value["quarterCount"] != 64
        or value["quarterSequenceSha256"] != contract["privateCapture"]["quarterSequenceSha256"]
        or value["captureSequenceSha256"] != contract["privateCapture"]["captureSequenceSha256"]
        or value["claimLocks"] != contract["claimLocks"]
        or len(value["receipts"]) != 64
    ):
        fail("V1 capture manifest scope changed")
    quarters = [item["quarter"] for item in value["receipts"]]
    if quarters != [item["quarter"] for item in v1.expected_quarters()]:
        fail("V1 capture quarter order changed")
    v1_contract, _ = v1.load_contract()
    if deep:
        v1.validate_final_manifest(value, v1_contract, private_root, V1_INTRODUCTION_COMMIT)
    return value, raw, v1_contract


def parse_submission_rows(
    raw: bytes, target_ciks: set[str], v1: Any
) -> tuple[list[dict[str, Any]], dict[str, int]]:
    try:
        text = raw.decode("utf-8-sig", errors="strict")
    except UnicodeDecodeError as exc:
        fail(f"SUBMISSION.tsv encoding changed: {exc}")
    reader = csv.reader(io.StringIO(text, newline=""), delimiter="\t")
    try:
        header = next(reader)
    except StopIteration:
        fail("SUBMISSION.tsv is empty")
    if len(header) != len(set(header)):
        fail("SUBMISSION.tsv contains duplicate headers")
    if any(field not in header for field in SELECTED_FIELDS):
        fail("SUBMISSION.tsv selected header is missing")
    indices = {field: header.index(field) for field in SELECTED_FIELDS}
    observations: list[dict[str, Any]] = []
    stats = {key: 0 for key in EXPECTED_TOTALS}
    for line_number, fields in enumerate(reader, start=2):
        if not fields or (len(fields) == 1 and fields[0] == ""):
            continue
        if len(fields) != len(header):
            fail(f"SUBMISSION.tsv row width changed at line {line_number}")
        values = {field: fields[index].strip() for field, index in indices.items()}
        blank_core = [field for field in CORE_FIELDS if values[field] == ""]
        if blank_core:
            fail(f"blank core SUBMISSION value at line {line_number}: {blank_core[0]}")
        if not ACCESSION_RE.fullmatch(values["ACCESSION_NUMBER"]):
            fail(f"invalid ACCESSION_NUMBER at line {line_number}")
        if values["DOCUMENT_TYPE"] not in ALLOWED_DOCUMENT_TYPES:
            fail(f"unknown DOCUMENT_TYPE at line {line_number}")
        cik = canonical_cik(values["ISSUERCIK"])
        filing_date = v1.parse_filing_date(values["FILING_DATE"])
        issuer_name = values["ISSUERNAME"] or None
        if issuer_name is not None and len(issuer_name) > 150:
            fail(f"issuer name length changed at line {line_number}")
        if len(values["ISSUERTRADINGSYMBOL"]) > 10:
            fail(f"issuer symbol length changed at line {line_number}")
        stats["allRows"] += 1
        if issuer_name is None:
            stats["blankIssuerNameAllRows"] += 1
        if cik not in target_ciks:
            continue
        stats["targetRows"] += 1
        if issuer_name is None:
            stats["blankIssuerNameTargetRows"] += 1
        observations.append({
            "accessionNumber": values["ACCESSION_NUMBER"],
            "filingDate": filing_date,
            "documentType": values["DOCUMENT_TYPE"],
            "issuerCik": cik,
            "issuerName": issuer_name,
            "issuerNameState": "MISSING_SOURCE_VALUE" if issuer_name is None else "PRESENT_SOURCE_VALUE",
            "issuerTradingSymbol": values["ISSUERTRADINGSYMBOL"],
        })
    return observations, stats


def validate_observation(observation: dict[str, Any], expected_cik: str) -> None:
    exact_keys(observation, {
        "accessionNumber", "filingDate", "documentType", "issuerCik", "issuerName",
        "issuerNameState", "issuerTradingSymbol", "sourceQuarter", "sourceZipRawSha256",
        "sourceSubmissionRawSha256", "captureReceiptRawSha256", "evidenceRowId",
    }, "V2 observation")
    if canonical_cik(observation["issuerCik"]) != expected_cik:
        fail("V2 observation CIK join changed")
    if observation["issuerNameState"] == "MISSING_SOURCE_VALUE":
        if observation["issuerName"] is not None:
            fail("missing issuer name was invented or imputed")
    elif observation["issuerNameState"] == "PRESENT_SOURCE_VALUE":
        if not isinstance(observation["issuerName"], str) or observation["issuerName"].strip() == "":
            fail("present issuer name is blank or non-text")
        if observation["issuerName"] != observation["issuerName"].strip():
            fail("present issuer name is not exact trimmed source text")
    else:
        fail("unknown issuer-name state")
    if not ACCESSION_RE.fullmatch(observation["accessionNumber"]):
        fail("V2 observation accession changed")
    if observation["documentType"] not in ALLOWED_DOCUMENT_TYPES:
        fail("V2 observation document type changed")
    if not re.fullmatch(r"20(?:0[9]|1[0-9]|2[0-4])-\d{2}-\d{2}", observation["filingDate"]):
        fail("V2 observation filing date changed")
    try:
        date.fromisoformat(observation["filingDate"])
    except ValueError as exc:
        fail(f"V2 observation filing date is invalid: {exc}")
    if (
        not isinstance(observation["issuerTradingSymbol"], str)
        or observation["issuerTradingSymbol"].strip() == ""
        or observation["issuerTradingSymbol"] != observation["issuerTradingSymbol"].strip()
        or len(observation["issuerTradingSymbol"]) > 10
    ):
        fail("V2 observation issuer symbol changed")
    if isinstance(observation["issuerName"], str) and len(observation["issuerName"]) > 150:
        fail("V2 observation issuer name length changed")
    if not re.fullmatch(r"20(?:0[9]|1[0-9]|2[0-4])Q[1-4]", observation["sourceQuarter"]):
        fail("V2 observation source quarter changed")
    for field in ("sourceZipRawSha256", "sourceSubmissionRawSha256", "captureReceiptRawSha256"):
        if not re.fullmatch(r"[0-9a-f]{64}", observation[field]):
            fail("V2 observation provenance hash changed")
    body = {key: item for key, item in observation.items() if key != "evidenceRowId"}
    if observation["evidenceRowId"] != sha256(canonical_bytes(body)):
        fail("V2 evidence row hash changed")


def validate_public_output(
    value: dict[str, Any], contract: dict[str, Any], queue: dict[str, Any],
    expected_introduction_commit: str,
) -> None:
    exact_keys(value, {
        "schema", "taskId", "track", "contractRawSha256", "contractSha256",
        "v1IntroductionCommit", "v1ContractRawSha256", "v1BuilderRawSha256",
        "v1TestRawSha256", "captureManifestRawSha256", "captureManifestSha256",
        "gapQueueRawSha256", "gapQueueReportSha256", "introductionCommit",
        "quarterCoverage", "population", "rows", "claimCeiling", "claimLocks", "reportSha256",
    }, "V2 public output")
    validate_self_hash(value, "reportSha256", "V2 public output")
    if (
        value["schema"] != OUTPUT_SCHEMA
        or value["taskId"] != contract["taskId"]
        or value["track"] != contract["track"]
    ):
        fail("V2 public output identity changed")
    expected_bindings = {
        "v1IntroductionCommit": V1_INTRODUCTION_COMMIT,
        "v1ContractRawSha256": V1_CONTRACT_RAW_SHA256,
        "v1BuilderRawSha256": V1_BUILDER_RAW_SHA256,
        "v1TestRawSha256": V1_TEST_RAW_SHA256,
        "captureManifestRawSha256": V1_MANIFEST_RAW_SHA256,
        "captureManifestSha256": V1_MANIFEST_SELF_SHA256,
        "gapQueueRawSha256": QUEUE_RAW_SHA256,
        "gapQueueReportSha256": QUEUE_REPORT_SHA256,
    }
    if any(value[key] != expected for key, expected in expected_bindings.items()):
        fail("V2 public provenance binding changed")
    if value["contractRawSha256"] != CONTRACT_RAW_SHA256 or value["contractSha256"] != contract["contractSha256"]:
        fail("V2 public contract binding changed")
    if value["claimCeiling"] != contract["claimCeiling"] or value["claimLocks"] != contract["claimLocks"]:
        fail("V2 public claim boundary changed")
    if value["introductionCommit"] != expected_introduction_commit:
        fail("V2 introduction commit binding changed")
    if len(value["quarterCoverage"]) != 64 or len(value["rows"]) != 656:
        fail("V2 public scope changed")
    aggregate = {key: 0 for key in EXPECTED_TOTALS}
    expected_quarters = [f"{year}Q{quarter}" for year in range(2009, 2025) for quarter in range(1, 5)]
    for expected_quarter, coverage in zip(expected_quarters, value["quarterCoverage"], strict=True):
        exact_keys(coverage, {
            "quarter", "sourceZipRawSha256", "sourceSubmissionRawSha256", "allRows",
            "captureReceiptRawSha256", "targetRows", "issuerNameMissingAllRows",
            "issuerNameMissingTargetRows",
        }, "V2 quarter coverage")
        if coverage["quarter"] != expected_quarter:
            fail("V2 public quarter order changed")
        for field in ("sourceZipRawSha256", "sourceSubmissionRawSha256", "captureReceiptRawSha256"):
            if not re.fullmatch(r"[0-9a-f]{64}", coverage[field]):
                fail("V2 quarter provenance hash changed")
        for field in ("allRows", "targetRows", "issuerNameMissingAllRows", "issuerNameMissingTargetRows"):
            if type(coverage[field]) is not int or coverage[field] < 0:
                fail("V2 quarter count is invalid")
        aggregate["allRows"] += coverage["allRows"]
        aggregate["targetRows"] += coverage["targetRows"]
        aggregate["blankIssuerNameAllRows"] += coverage["issuerNameMissingAllRows"]
        aggregate["blankIssuerNameTargetRows"] += coverage["issuerNameMissingTargetRows"]
    if aggregate != EXPECTED_TOTALS:
        fail("V2 observed capture totals changed")
    population = value["population"]
    exact_keys(population, {
        "gapRows", "uniqueIssuerCiks", "rowsWithPointEvidence", "rowsWithoutPointEvidence",
        "sourceAllRows", "sourceTargetPoints", "issuerNamePresentAllRows",
        "issuerNameMissingAllRows", "issuerNamePresentTargetPoints",
        "issuerNameMissingTargetPoints", "gapRowsWithMissingIssuerNamePoint",
    }, "V2 population")
    if (
        population["gapRows"] != 656
        or population["uniqueIssuerCiks"] != 607
        or population["sourceAllRows"] != EXPECTED_TOTALS["allRows"]
        or population["sourceTargetPoints"] != EXPECTED_TOTALS["targetRows"]
        or population["issuerNameMissingAllRows"] != EXPECTED_TOTALS["blankIssuerNameAllRows"]
        or population["issuerNameMissingTargetPoints"] != EXPECTED_TOTALS["blankIssuerNameTargetRows"]
        or population["issuerNamePresentAllRows"] + population["issuerNameMissingAllRows"] != population["sourceAllRows"]
        or population["issuerNamePresentTargetPoints"] + population["issuerNameMissingTargetPoints"] != population["sourceTargetPoints"]
        or population["rowsWithPointEvidence"] + population["rowsWithoutPointEvidence"] != 656
    ):
        fail("V2 population counts changed")
    queue_bindings = [(row["workItemId"], canonical_cik(row["issuerCik"])) for row in queue["rows"]]
    coverage_by_quarter = {item["quarter"]: item for item in value["quarterCoverage"]}
    unique_observations: dict[str, str] = {}
    rows_with_points = 0
    gap_rows_with_missing = 0
    for row, binding in zip(value["rows"], queue_bindings, strict=True):
        exact_keys(row, {
            "workItemId", "issuerCik", "pointState", "observations",
            "distinctIssuerTradingSymbols", "issuerNameMissingPointCount", "rowSha256",
        }, "V2 public row")
        validate_self_hash(row, "rowSha256", "V2 public row")
        if (row["workItemId"], row["issuerCik"]) != binding:
            fail("V2 row-to-gap binding changed")
        expected_state = "OBSERVED_FILING_POINTS" if row["observations"] else "NO_FORM345_POINT_EVIDENCE"
        if row["pointState"] != expected_state:
            fail("V2 point state changed")
        if row["observations"]:
            rows_with_points += 1
        missing_count = sum(item["issuerNameState"] == "MISSING_SOURCE_VALUE" for item in row["observations"])
        if row["issuerNameMissingPointCount"] != missing_count:
            fail("V2 row missingness count changed")
        if missing_count:
            gap_rows_with_missing += 1
        symbols = sorted({item["issuerTradingSymbol"] for item in row["observations"]})
        if row["distinctIssuerTradingSymbols"] != symbols:
            fail("V2 row symbol summary changed")
        if row["observations"] != sorted(
            row["observations"], key=lambda item: (item["filingDate"], item["accessionNumber"], item["sourceQuarter"])
        ):
            fail("V2 observations are not deterministically ordered")
        for observation in row["observations"]:
            validate_observation(observation, row["issuerCik"])
            source_binding = coverage_by_quarter[observation["sourceQuarter"]]
            if (
                observation["sourceZipRawSha256"] != source_binding["sourceZipRawSha256"]
                or observation["sourceSubmissionRawSha256"] != source_binding["sourceSubmissionRawSha256"]
                or observation["captureReceiptRawSha256"] != source_binding["captureReceiptRawSha256"]
            ):
                fail("V2 observation-to-quarter provenance changed")
            state = observation["issuerNameState"]
            prior = unique_observations.setdefault(observation["accessionNumber"], state)
            if prior != state:
                fail("V2 duplicate accession missingness conflict")
    if rows_with_points != population["rowsWithPointEvidence"]:
        fail("V2 rows-with-points count changed")
    if gap_rows_with_missing != population["gapRowsWithMissingIssuerNamePoint"]:
        fail("V2 missing-name gap-row count changed")
    if len(unique_observations) != EXPECTED_TOTALS["targetRows"]:
        fail("V2 unique target accession count changed")
    if sum(state == "MISSING_SOURCE_VALUE" for state in unique_observations.values()) != EXPECTED_TOTALS["blankIssuerNameTargetRows"]:
        fail("V2 unique target missing-name count changed")


def build(private_root_arg: str | None) -> dict[str, Any]:
    contract, _ = load_contract()
    topology = verify_production_topology()
    v1 = validate_v1_bindings(contract)
    private_root = Path(private_root_arg) if private_root_arg else default_private_root()
    manifest, _manifest_raw, v1_contract = load_capture_manifest(private_root, contract, v1, deep=True)
    private_root = v1.validate_private_root(private_root)
    queue = load_gap_queue()
    target_ciks = {canonical_cik(row["issuerCik"]) for row in queue["rows"]}
    observations_by_cik: dict[str, list[dict[str, Any]]] = {cik: [] for cik in target_ciks}
    seen_accessions: set[str] = set()
    totals = {key: 0 for key in EXPECTED_TOTALS}
    coverage: list[dict[str, Any]] = []
    receipt_items = {item["quarter"]: item for item in manifest["receipts"]}
    for source in v1.expected_quarters():
        quarter, url = source["quarter"], source["url"]
        receipt, receipt_raw = v1.load_receipt(
            v1.receipt_path(private_root, quarter), v1_contract, private_root, quarter, url
        )
        zip_raw = v1.blob_path(private_root, receipt["rawSha256"]).read_bytes()
        _member, submission_raw = v1.read_submission_member(zip_raw)
        selected, stats = parse_submission_rows(submission_raw, target_ciks, v1)
        for key in totals:
            totals[key] += stats[key]
        for item in selected:
            if item["accessionNumber"] in seen_accessions:
                fail("duplicate target accession across V1 capture")
            seen_accessions.add(item["accessionNumber"])
            evidence = {
                **item,
                "sourceQuarter": quarter,
                "sourceZipRawSha256": receipt["rawSha256"],
                "sourceSubmissionRawSha256": sha256(submission_raw),
                "captureReceiptRawSha256": sha256(receipt_raw),
            }
            evidence["evidenceRowId"] = sha256(canonical_bytes(evidence))
            observations_by_cik[item["issuerCik"]].append(evidence)
        coverage.append({
            "quarter": quarter,
            "sourceZipRawSha256": receipt_items[quarter]["zipRawSha256"],
            "sourceSubmissionRawSha256": sha256(submission_raw),
            "captureReceiptRawSha256": sha256(receipt_raw),
            "allRows": stats["allRows"],
            "targetRows": stats["targetRows"],
            "issuerNameMissingAllRows": stats["blankIssuerNameAllRows"],
            "issuerNameMissingTargetRows": stats["blankIssuerNameTargetRows"],
        })
    if totals != EXPECTED_TOTALS:
        fail("observed V1 capture totals changed")
    rows: list[dict[str, Any]] = []
    rows_with_points = 0
    gap_rows_with_missing = 0
    for queue_row in queue["rows"]:
        cik = canonical_cik(queue_row["issuerCik"])
        points = sorted(
            observations_by_cik[cik],
            key=lambda item: (item["filingDate"], item["accessionNumber"], item["sourceQuarter"]),
        )
        missing_count = sum(item["issuerNameState"] == "MISSING_SOURCE_VALUE" for item in points)
        if points:
            rows_with_points += 1
        if missing_count:
            gap_rows_with_missing += 1
        row = {
            "workItemId": queue_row["workItemId"],
            "issuerCik": cik,
            "pointState": "OBSERVED_FILING_POINTS" if points else "NO_FORM345_POINT_EVIDENCE",
            "observations": points,
            "distinctIssuerTradingSymbols": sorted({item["issuerTradingSymbol"] for item in points}),
            "issuerNameMissingPointCount": missing_count,
            "rowSha256": "",
        }
        rows.append(with_self_hash(row, "rowSha256"))
    output = {
        "schema": OUTPUT_SCHEMA,
        "taskId": contract["taskId"],
        "track": contract["track"],
        "contractRawSha256": CONTRACT_RAW_SHA256,
        "contractSha256": contract["contractSha256"],
        "v1IntroductionCommit": V1_INTRODUCTION_COMMIT,
        "v1ContractRawSha256": V1_CONTRACT_RAW_SHA256,
        "v1BuilderRawSha256": V1_BUILDER_RAW_SHA256,
        "v1TestRawSha256": V1_TEST_RAW_SHA256,
        "captureManifestRawSha256": V1_MANIFEST_RAW_SHA256,
        "captureManifestSha256": V1_MANIFEST_SELF_SHA256,
        "gapQueueRawSha256": QUEUE_RAW_SHA256,
        "gapQueueReportSha256": QUEUE_REPORT_SHA256,
        "introductionCommit": topology["head"],
        "quarterCoverage": coverage,
        "population": {
            "gapRows": 656,
            "uniqueIssuerCiks": 607,
            "rowsWithPointEvidence": rows_with_points,
            "rowsWithoutPointEvidence": 656 - rows_with_points,
            "sourceAllRows": totals["allRows"],
            "sourceTargetPoints": totals["targetRows"],
            "issuerNamePresentAllRows": totals["allRows"] - totals["blankIssuerNameAllRows"],
            "issuerNameMissingAllRows": totals["blankIssuerNameAllRows"],
            "issuerNamePresentTargetPoints": totals["targetRows"] - totals["blankIssuerNameTargetRows"],
            "issuerNameMissingTargetPoints": totals["blankIssuerNameTargetRows"],
            "gapRowsWithMissingIssuerNamePoint": gap_rows_with_missing,
        },
        "rows": rows,
        "claimCeiling": contract["claimCeiling"],
        "claimLocks": contract["claimLocks"],
        "reportSha256": "",
    }
    with_self_hash(output, "reportSha256")
    validate_public_output(output, contract, queue, topology["head"])
    if verify_production_topology()["head"] != topology["head"]:
        fail("Git or remote topology drifted during V2 build")
    return output


def expect_failure(callback: Any) -> bool:
    try:
        callback()
    except (EvidenceError, UnicodeDecodeError, ValueError, KeyError):
        return True
    return False


def self_test() -> dict[str, Any]:
    contract, _ = load_contract()
    verify_precommit_topology()
    v1 = validate_v1_bindings(contract)
    queue = load_gap_queue()
    manifest, _raw, _v1_contract = load_capture_manifest(default_private_root(), contract, v1, deep=False)
    target_cik = canonical_cik(queue["rows"][0]["issuerCik"])
    header = "\t".join((*SELECTED_FIELDS, "UNSELECTED_COLUMN"))
    missing_name_row = "\t".join((
        "0000123456-09-000001", "31-DEC-2009", "4/A", target_cik.lstrip("0"), "", "EXMPL", "IGNORED",
    ))
    present_name_row = "\t".join((
        "0000123456-09-000002", "31-DEC-2009", "4", target_cik, " Example Issuer ", "EXMPL", "IGNORED",
    ))
    fixture = f"{header}\n{missing_name_row}\n{present_name_row}\n".encode("utf-8")
    parsed, stats = parse_submission_rows(fixture, {target_cik}, v1)
    checks: dict[str, bool] = {
        "contractRawBound": sha256(CONTRACT_PATH.read_bytes()) == CONTRACT_RAW_SHA256,
        "contractSelfBound": contract["contractSha256"] == sha256(canonical_bytes({
            key: item for key, item in contract.items() if key != "contractSha256"
        })),
        "v1ManifestRawBound": sha256((default_private_root() / "capture-manifest.json").read_bytes()) == V1_MANIFEST_RAW_SHA256,
        "v1ManifestSelfBound": manifest["manifestSha256"] == V1_MANIFEST_SELF_SHA256,
        "blankNameAcceptedExplicitly": parsed[0]["issuerName"] is None and parsed[0]["issuerNameState"] == "MISSING_SOURCE_VALUE",
        "presentNameTrimmed": parsed[1]["issuerName"] == "Example Issuer" and parsed[1]["issuerNameState"] == "PRESENT_SOURCE_VALUE",
        "fixtureCountsExplicit": stats == {
            "allRows": 2, "targetRows": 2, "blankIssuerNameAllRows": 1, "blankIssuerNameTargetRows": 1,
        },
        "unselectedColumnAbsent": "UNSELECTED_COLUMN" not in canonical_bytes(parsed).decode("utf-8"),
        "noCaptureOrNetworkCommand": True,
    }
    for field in CORE_FIELDS:
        parts = missing_name_row.split("\t")
        parts[SELECTED_FIELDS.index(field)] = ""
        mutated = f"{header}\n{'\t'.join(parts)}\n".encode("utf-8")
        checks[f"blankCoreRejected_{field}"] = expect_failure(
            lambda raw=mutated: parse_submission_rows(raw, {target_cik}, v1)
        )
    missing_header = "\t".join(SELECTED_FIELDS[:-1]).encode("utf-8") + b"\n"
    checks["missingHeaderRejected"] = expect_failure(
        lambda: parse_submission_rows(missing_header, {target_cik}, v1)
    )
    evidence = {
        **parsed[0],
        "sourceQuarter": "2009Q4",
        "sourceZipRawSha256": "a" * 64,
        "sourceSubmissionRawSha256": "b" * 64,
        "captureReceiptRawSha256": "c" * 64,
    }
    evidence["evidenceRowId"] = sha256(canonical_bytes(evidence))
    validate_observation(evidence, target_cik)
    invented = copy.deepcopy(evidence)
    invented["issuerName"] = "Invented Name"
    invented["evidenceRowId"] = sha256(canonical_bytes({key: item for key, item in invented.items() if key != "evidenceRowId"}))
    checks["inventedMissingNameRejected"] = expect_failure(lambda: validate_observation(invented, target_cik))
    unknown_state = copy.deepcopy(evidence)
    unknown_state["issuerNameState"] = "IMPUTED_VALUE"
    unknown_state["evidenceRowId"] = sha256(canonical_bytes({key: item for key, item in unknown_state.items() if key != "evidenceRowId"}))
    checks["unknownNameStateRejected"] = expect_failure(lambda: validate_observation(unknown_state, target_cik))
    outcome = copy.deepcopy(evidence)
    outcome["outcome"] = 1
    outcome["evidenceRowId"] = sha256(canonical_bytes({key: item for key, item in outcome.items() if key != "evidenceRowId"}))
    checks["outcomeFieldRejected"] = expect_failure(lambda: validate_observation(outcome, target_cik))
    rehashed_policy = copy.deepcopy(contract)
    rehashed_policy["missingnessPolicy"]["inventedImputedOrBackfilledIssuerNameAllowed"] = True
    with_self_hash(rehashed_policy, "contractSha256")
    checks["rehashedImputationPromotionRejected"] = expect_failure(lambda: validate_contract_value(rehashed_policy))
    promoted = copy.deepcopy(contract)
    promoted["claimLocks"]["historicalIdentityIntervalsComplete"] = True
    with_self_hash(promoted, "contractSha256")
    checks["rehashedClaimPromotionRejected"] = expect_failure(lambda: validate_contract_value(promoted))
    checks["productionAtParentRejected"] = expect_failure(
        lambda: validate_topology_values(PARENT_REMOTE_COMMIT, PARENT_REMOTE_COMMIT, None, True)
    )
    checks["remoteDriftRejected"] = expect_failure(
        lambda: validate_topology_values("a" * 40, "b" * 40, PARENT_REMOTE_COMMIT, True)
    )
    if not all(checks.values()):
        fail("V2 self-test failed: " + ",".join(key for key, passed in checks.items() if not passed))
    return {"status": "PASS", **checks, "networkRequests": 0, "filesWritten": 0, "outcomesAccessed": False}


def verify_contract() -> dict[str, Any]:
    contract, raw = load_contract()
    topology = verify_precommit_topology()
    validate_v1_bindings(contract)
    load_gap_queue()
    return {
        "status": "PASS",
        "contractRawSha256": sha256(raw),
        "contractSha256": contract["contractSha256"],
        "head": topology["head"],
        "v1IntroductionCommit": V1_INTRODUCTION_COMMIT,
        "networkRequests": 0,
        "filesWritten": 0,
        "outcomesAccessed": False,
    }


def dry_run(private_root_arg: str | None) -> dict[str, Any]:
    contract, _ = load_contract()
    topology = verify_precommit_topology()
    v1 = validate_v1_bindings(contract)
    private_root = Path(private_root_arg) if private_root_arg else default_private_root()
    manifest, raw, _v1_contract = load_capture_manifest(private_root, contract, v1, deep=False)
    load_gap_queue()
    return {
        "status": "PASS",
        "head": topology["head"],
        "manifestRawSha256": sha256(raw),
        "manifestSha256": manifest["manifestSha256"],
        "quarters": manifest["quarterCount"],
        "expectedAllRows": EXPECTED_TOTALS["allRows"],
        "expectedTargetRows": EXPECTED_TOTALS["targetRows"],
        "expectedMissingIssuerNameTargetRows": EXPECTED_TOTALS["blankIssuerNameTargetRows"],
        "networkRequests": 0,
        "filesWritten": 0,
        "outcomesAccessed": False,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("verify-contract")
    dry = commands.add_parser("dry-run")
    dry.add_argument("--private-root")
    commands.add_parser("self-test")
    build_parser = commands.add_parser("build")
    build_parser.add_argument("--private-root")
    build_parser.add_argument("--output", default=str(OUTPUT_PATH))
    args = parser.parse_args()
    try:
        if args.command == "verify-contract":
            result = verify_contract()
        elif args.command == "dry-run":
            result = dry_run(args.private_root)
        elif args.command == "self-test":
            result = self_test()
        elif args.command == "build":
            if Path(args.output).resolve(strict=False) != OUTPUT_PATH.resolve(strict=False):
                fail("V2 public output sidepaths are forbidden")
            payload = build(args.private_root)
            encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True, indent=2).encode("utf-8") + b"\n"
            before_write = verify_production_topology()["head"]
            v1 = load_v1_module()
            v1.atomic_create_new(OUTPUT_PATH, encoded)
            if verify_production_topology()["head"] != before_write:
                fail("Git or remote topology drifted across V2 output write")
            result = {
                "status": "PASS",
                "rows": payload["population"]["gapRows"],
                "sourceTargetPoints": payload["population"]["sourceTargetPoints"],
                "issuerNameMissingTargetPoints": payload["population"]["issuerNameMissingTargetPoints"],
                "reportSha256": payload["reportSha256"],
                "outcomesAccessed": False,
            }
        else:
            raise AssertionError("unreachable")
    except (EvidenceError, OSError, ValueError, KeyError, subprocess.CalledProcessError) as exc:
        parser.error(str(exc))
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

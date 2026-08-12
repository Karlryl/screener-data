#!/usr/bin/env python3
"""Authorized endpoint and analysis runner for the separate SEC-CIK study.

This file is outcome-blind until an independently audited, remotely bound
endpoint checkpoint exists.  The endpoint command verifies that checkpoint
before opening the SEC database.  The original V4 study is never read or
modified by this runner.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import re
import sqlite3
import subprocess
import tempfile
from collections import defaultdict
from datetime import datetime, timezone
from decimal import Decimal, ROUND_HALF_EVEN, localcontext
from pathlib import Path
from typing import Any


PROTOCOL = "SEC-CIK-GROWTH-PERSISTENCE@1.0.0"
ENDPOINT_SCHEMA = "sec-cik-growth-persistence-endpoint/v1"
ANALYSIS_SCHEMA = "sec-cik-growth-persistence-analysis/v1"
ENDPOINT_LEDGER_SCHEMA = "sec-cik-growth-persistence-endpoint-ledger/v1"
ANALYSIS_LEDGER_SCHEMA = "sec-cik-growth-persistence-analysis-ledger/v1"
AUDIT_SCHEMA = "sec-cik-growth-persistence-endpoint-ai-audit/v1"
SEAL_SCHEMA = "sec-cik-growth-persistence-endpoint-preoutcome-seal/v1"
AUTH_SCHEMA = "sec-cik-growth-persistence-endpoint-remote-authorization/v1"

CUTOFF = "2014-06-30T23:59:59Z"
CUTOFF_EPOCH = 1404172799
ENDPOINT_CUTOFF = "2015-09-28T23:59:59Z"
ENDPOINT_CUTOFF_EPOCH = 1443484799
ENDPOINT_PAYLOADS_SHA256 = "ffca37f6998e929e903bf99eaff43f22b6bf58e3582058cd704c345979baef1b"
EXPOSURE_RAW_SHA256 = "9632586d332ad9a67a4c12e10f9716da9e533330e1b573506b738dd60eb75c7a"
EXPOSURE_REPORT_SHA256 = "5dbb2ecb17101a6e8f66eecc1d0890a4921c6d66342985db5a89c8575aab603a"
PRIOR_AUTHORIZATION_SHA256 = "081eda0b66bc7f01b6d6dbb9e6b035e32a772e9c4551aedb089bb79e777bd0cb"
PRIOR_AUTHORIZATION_COMMIT = "7d023e56cddc77cfdc4a2629a3be9912ea35913a"
EMPTY_LEDGER_SHA256 = "02b79914b07ff3c08f05d490df701f95a2df7dcdb7702b139fb12bb0a6a090dd"
DATABASE_SHA256 = "aacd729b4dccc4924f0223cc24b549742180e01156717de2f888d5913b2b2df7"
DATABASE_BYTES = 41141956608
MIN_REVENUE_YOY = Decimal("0.20")
Z_975 = Decimal("1.959963984540054")
DISPLAY_QUANTUM = Decimal("0.000000000000000001")

REMOTE = "origin"
REMOTE_URL = "https://github.com/Karlryl/screener-data.git"
REMOTE_REF = "refs/heads/codex/early-detection-v4-gates-20260810"

ROOT = Path(__file__).resolve().parents[1]
BASE_SELECTOR_PATH = ROOT / "scripts" / "early-detection-sec-cik-growth-persistence.py"

PATHS = {
    "SCOPE": "reports/early-detection/sec-cik-growth-persistence-scope-v1.md",
    "CLAIM_CONTRACT": "reports/early-detection/sec-cik-growth-persistence-claim-contract-v1.json",
    "SELECTOR": "scripts/early-detection-sec-cik-growth-persistence.py",
    "SOURCE_LINE": "reports/early-detection/sec-cik-growth-persistence-source-line-v2.json",
    "DATABASE_ATTESTATION": "reports/early-detection/sec-cik-growth-persistence-database-attestation-v1.json",
    "EXPOSURE": "reports/early-detection/sec-cik-growth-persistence-exposure-v3.json",
    "EMPTY_LEDGER": "reports/early-detection/sec-cik-growth-persistence-outcome-ledger-v1.json",
    "PRIOR_AUTHORIZATION": "reports/early-detection/sec-cik-growth-persistence-remote-authorization-v4.json",
    "ENDPOINT_RUNNER": "scripts/early-detection-sec-cik-growth-persistence-endpoint.py",
    "ENDPOINT_TEST": "tests/early-detection-sec-cik-growth-persistence-endpoint.test.js",
    "ENDPOINT_AUDIT_METHOD": "reports/early-detection/sec-cik-growth-persistence-endpoint-ai-audit-method-v1.json",
    "ENDPOINT_AUDIT_DATA": "reports/early-detection/sec-cik-growth-persistence-endpoint-ai-audit-data-v1.json",
    "ENDPOINT_AUDIT_COUNTEREXAMPLE": "reports/early-detection/sec-cik-growth-persistence-endpoint-ai-audit-counterexample-v1.json",
}

FROZEN_HASHES = {
    "SCOPE": "d8bc4bcc6ebbc5c8d1f5bbaa6af1ac8ac8b6380a1656483bdcd168b1600765fa",
    "CLAIM_CONTRACT": "3212d024e9c82dfb8ea2702ca781351e5a2e5c773d97d534ba8c445a2926a388",
    "SELECTOR": "e07bc9316c5c492ef13c684b9cf1d619860f9d997597606ba2807a4b26b7fd3a",
    "SOURCE_LINE": "9898fbcf2fddb9f8716cf7a9a15a87f528ef9752d1008856cee979608ce472c9",
    "DATABASE_ATTESTATION": "9a09b8b495f5cc9d2623d64ca425992b4b05801a0b57a83ef24adee434f13cdf",
    "EXPOSURE": EXPOSURE_RAW_SHA256,
    "EMPTY_LEDGER": EMPTY_LEDGER_SHA256,
    "PRIOR_AUTHORIZATION": PRIOR_AUTHORIZATION_SHA256,
}

CLAIM_LOCKS = {
    "coverageBoundedSecRegistrantsOnly": True,
    "fullMarket": False,
    "survivorshipSafe": False,
    "stockReturns": False,
    "originalV4Result": False,
    "humanAttestation": False,
    "aiAuditOnly": True,
    "cikIsPermanentSecurityId": False,
}

RESULT_PATHS = {
    "ENDPOINT": "reports/early-detection/sec-cik-growth-persistence-endpoint-v1.json",
    "ENDPOINT_LEDGER": "reports/early-detection/sec-cik-growth-persistence-endpoint-ledger-v1.json",
    "ANALYSIS": "reports/early-detection/sec-cik-growth-persistence-analysis-v1.json",
    "ANALYSIS_LEDGER": "reports/early-detection/sec-cik-growth-persistence-analysis-ledger-v1.json",
}
ENDPOINT_SEAL_PATH = "reports/early-detection/sec-cik-growth-persistence-endpoint-preoutcome-seal-v1.json"
ENDPOINT_AUTHORIZATION_PATH = "reports/early-detection/sec-cik-growth-persistence-endpoint-remote-authorization-v1.json"

COUNTS = {
    "candidateCiks": 9431,
    "eligibleCiks": 770,
    "triggerPositive": 72,
    "triggerNegative": 698,
    "sourceRefs": 13954,
}

ROLE_CHECKS = {
    "METHOD": [
        "ENDPOINT_CONTRACT_FROZEN",
        "FULL_COHORT_DENOMINATOR_LOCKED",
        "NEWCOMBE_METHOD_10_ORACLE_PASS",
        "LEDGER_STATE_MACHINE_FAIL_CLOSED",
        "CLAIM_LOCKS_CLOSED",
        "SYNTHETIC_ENDPOINT_TESTS_PASS",
    ],
    "DATA": [
        "FIVE_ENDPOINT_PAYLOADS_BOUND",
        "ACCEPTANCE_WINDOW_EXCLUSIVE_INCLUSIVE",
        "FROZEN_DENOMINATORS_ONLY",
        "AMENDMENTS_COMPARATIVES_EXCLUDED",
        "DATABASE_DOUBLE_SHA_REQUIRED",
        "NO_POSTWINDOW_SOURCE_ALLOWED",
    ],
    "COUNTEREXAMPLE": [
        "CHECKPOINT_BYPASS_REJECTED",
        "COHORT_MUTATION_REJECTED",
        "ENDPOINT_OMISSION_REJECTED",
        "MISSING_QUARTER_COMPRESSION_REJECTED",
        "COMPLETE_CASE_DENOMINATOR_REJECTED",
        "ANALYSIS_TAMPER_REJECTED",
    ],
}

HEX64 = re.compile(r"^[0-9a-f]{64}$")
HEX40 = re.compile(r"^[0-9a-f]{40}$")


class EndpointError(RuntimeError):
    pass


def load_base() -> Any:
    spec = importlib.util.spec_from_file_location("sec_cik_growth_exposure", BASE_SELECTOR_PATH)
    if spec is None or spec.loader is None:
        raise EndpointError("cannot load frozen exposure selector")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


BASE = load_base()


def canonical_bytes(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def sha256_bytes(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(8 * 1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def canonical_sha256(value: Any) -> str:
    return sha256_bytes(canonical_bytes(value))


def unsigned_sha256(value: dict[str, Any], field: str) -> str:
    copy = dict(value)
    copy.pop(field, None)
    return canonical_sha256(copy)


def decode_json_snapshot(raw: bytes, path: Path) -> dict[str, Any]:
    try:
        value = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise EndpointError(f"invalid UTF-8 JSON: {path}") from exc
    if not isinstance(value, dict):
        raise EndpointError(f"JSON root is not an object: {path}")
    return value


def load_json_snapshot(path: Path) -> tuple[dict[str, Any], bytes]:
    raw = path.read_bytes()
    return decode_json_snapshot(raw, path), raw


def require_keys(value: dict[str, Any], keys: set[str], label: str) -> None:
    if set(value) != keys:
        raise EndpointError(f"{label} key set changed")


def require_fixed_repo_path(path: Path, expected_repo_path: str, label: str) -> None:
    expected = (ROOT / expected_repo_path).resolve()
    if path.expanduser().resolve() != expected:
        raise EndpointError(f"{label} path must be frozen at {expected}")


def parse_z(value: Any, label: str) -> datetime:
    if not isinstance(value, str) or not value.endswith("Z"):
        raise EndpointError(f"{label} is not an ISO Z timestamp")
    try:
        parsed = datetime.fromisoformat(value[:-1] + "+00:00")
    except ValueError as exc:
        raise EndpointError(f"{label} is invalid") from exc
    if parsed.tzinfo != timezone.utc:
        raise EndpointError(f"{label} is not UTC")
    return parsed


def run_git(args: list[str]) -> bytes:
    completed = subprocess.run(
        ["git", *args], cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False
    )
    if completed.returncode != 0:
        detail = completed.stderr.decode("utf-8", errors="replace").strip()
        raise EndpointError(f"git {' '.join(args)} failed: {detail}")
    return completed.stdout


def git_blob(commit: str, path: str) -> bytes:
    return run_git(["show", f"{commit}:{path}"])


def git_commit_time(commit: str, label: str) -> datetime:
    raw = run_git(["show", "-s", "--format=%cI", commit]).decode().strip()
    try:
        return datetime.fromisoformat(raw).astimezone(timezone.utc)
    except ValueError as exc:
        raise EndpointError(f"{label} commit time is invalid") from exc


def git_commit_parents(commit: str) -> list[str]:
    fields = run_git(["rev-list", "--parents", "-n", "1", commit]).decode().strip().split()
    if not fields or fields[0] != commit:
        raise EndpointError("cannot resolve exact commit parent list")
    return fields[1:]


def git_path_exists(commit: str, repo_path: str) -> bool:
    return subprocess.run(
        ["git", "cat-file", "-e", f"{commit}:{repo_path}"],
        cwd=ROOT,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        check=False,
    ).returncode == 0


def validate_preoutcome_result_absence(
    commits: list[str],
    exists_lookup: Any,
) -> None:
    for commit in commits:
        for role, result_path in RESULT_PATHS.items():
            if exists_lookup(commit, result_path):
                raise EndpointError(f"pre-outcome commit already contains result {role}")


AUDIT_KEYS = {
    "schema", "protocol", "role", "status", "reviewerType", "agentId", "runId",
    "completedAt", "blockingFindings", "humanAttestation", "outcomesAccessed",
    "postAnchorFactsRead", "endpointRunnerSha256", "endpointTestSha256",
    "selectorSha256", "scopeSha256", "claimContractSha256", "sourceLineSha256",
    "databaseAttestationSha256", "exposureFileSha256", "exposureReportSha256",
    "emptyLedgerSha256", "priorAuthorizationSha256", "counts", "checks", "auditSha256",
}


def audit_bindings() -> dict[str, str]:
    return {
        "endpointRunnerSha256": sha256_file(ROOT / PATHS["ENDPOINT_RUNNER"]),
        "endpointTestSha256": sha256_file(ROOT / PATHS["ENDPOINT_TEST"]),
        "selectorSha256": FROZEN_HASHES["SELECTOR"],
        "scopeSha256": FROZEN_HASHES["SCOPE"],
        "claimContractSha256": FROZEN_HASHES["CLAIM_CONTRACT"],
        "sourceLineSha256": FROZEN_HASHES["SOURCE_LINE"],
        "databaseAttestationSha256": FROZEN_HASHES["DATABASE_ATTESTATION"],
        "exposureFileSha256": EXPOSURE_RAW_SHA256,
        "exposureReportSha256": EXPOSURE_REPORT_SHA256,
        "emptyLedgerSha256": EMPTY_LEDGER_SHA256,
        "priorAuthorizationSha256": PRIOR_AUTHORIZATION_SHA256,
    }


def validate_audit(value: dict[str, Any], role: str) -> None:
    require_keys(value, AUDIT_KEYS, f"{role} audit")
    if value["schema"] != AUDIT_SCHEMA or value["protocol"] != PROTOCOL or value["role"] != role:
        raise EndpointError(f"{role} audit identity changed")
    if value["status"] != "PASS" or value["reviewerType"] != "CODEX_AGENT":
        raise EndpointError(f"{role} audit is not a passing AI audit")
    if value["blockingFindings"] != [] or value["humanAttestation"] is not False:
        raise EndpointError(f"{role} audit has blockers or a HUMAN claim")
    if value["outcomesAccessed"] is not False or value["postAnchorFactsRead"] is not False:
        raise EndpointError(f"{role} audit crossed the outcome barrier")
    if not isinstance(value["agentId"], str) or not value["agentId"]:
        raise EndpointError(f"{role} agentId is empty")
    if not isinstance(value["runId"], str) or not value["runId"]:
        raise EndpointError(f"{role} runId is empty")
    parse_z(value["completedAt"], f"{role}.completedAt")
    for key, expected in audit_bindings().items():
        if value[key] != expected:
            raise EndpointError(f"{role} audit binding changed: {key}")
    if value["counts"] != COUNTS or value["checks"] != ROLE_CHECKS[role]:
        raise EndpointError(f"{role} audit coverage changed")
    if value["auditSha256"] != unsigned_sha256(value, "auditSha256"):
        raise EndpointError(f"{role} audit self-hash changed")


def endpoint_audit_paths() -> dict[str, Path]:
    return {
        "METHOD": ROOT / PATHS["ENDPOINT_AUDIT_METHOD"],
        "DATA": ROOT / PATHS["ENDPOINT_AUDIT_DATA"],
        "COUNTEREXAMPLE": ROOT / PATHS["ENDPOINT_AUDIT_COUNTEREXAMPLE"],
    }


def validate_endpoint_audits() -> dict[str, dict[str, Any]]:
    values: dict[str, dict[str, Any]] = {}
    for role, path in endpoint_audit_paths().items():
        value, _ = load_json_snapshot(path)
        validate_audit(value, role)
        values[role] = value
    if len({value["agentId"] for value in values.values()}) != 3:
        raise EndpointError("endpoint audits do not have three distinct agents")
    if len({value["runId"] for value in values.values()}) != 3:
        raise EndpointError("endpoint audits do not have three distinct runs")
    return values


SEAL_KEYS = {
    "schema", "protocol", "status", "sealedAt", "stageACommit", "artifacts",
    "priorAuthorizationSha256", "exposureReportSha256", "outcomesAccessed",
    "postAnchorFactsRead", "postAnchorFactsMaterialized", "analysisExecuted",
    "humanAttestation", "aiAuditOnly",
}
AUTH_KEYS = {
    "schema", "protocol", "status", "createdAt", "authorizationRemote",
    "authorizationRemoteUrl", "authorizationRef", "stageACommit", "sealCommit",
    "sealPath", "sealSha256", "priorAuthorizationPath", "priorAuthorizationSha256",
    "outcomeLedgerPath", "outcomeLedgerSha256", "outcomesAccessed",
    "postAnchorFactsRead", "postAnchorFactsMaterialized", "analysisExecuted",
    "humanAttestation", "aiAuditOnly",
}


def require_closed_locks(value: dict[str, Any], label: str) -> None:
    for key in (
        "outcomesAccessed", "postAnchorFactsRead", "postAnchorFactsMaterialized",
        "analysisExecuted", "humanAttestation",
    ):
        if value.get(key) is not False:
            raise EndpointError(f"{label}.{key} is not closed")
    if value.get("aiAuditOnly") is not True:
        raise EndpointError(f"{label}.aiAuditOnly is not true")


def validate_endpoint_seal(path: Path) -> tuple[dict[str, Any], bytes, list[datetime]]:
    require_fixed_repo_path(path, ENDPOINT_SEAL_PATH, "endpoint seal")
    seal, seal_raw = load_json_snapshot(path)
    require_keys(seal, SEAL_KEYS, "endpoint seal")
    if seal["schema"] != SEAL_SCHEMA or seal["protocol"] != PROTOCOL:
        raise EndpointError("endpoint seal identity changed")
    if seal["status"] != "SEALED_ENDPOINT_CODE_PRE_OUTCOME":
        raise EndpointError("endpoint seal status changed")
    sealed_at = parse_z(seal["sealedAt"], "endpoint seal.sealedAt")
    if not isinstance(seal["stageACommit"], str) or not HEX40.fullmatch(seal["stageACommit"]):
        raise EndpointError("endpoint seal Stage-A commit is malformed")
    if seal["priorAuthorizationSha256"] != PRIOR_AUTHORIZATION_SHA256:
        raise EndpointError("endpoint seal prior authorization changed")
    if seal["exposureReportSha256"] != EXPOSURE_REPORT_SHA256:
        raise EndpointError("endpoint seal exposure report changed")
    require_closed_locks(seal, "endpoint seal")
    artifacts = seal["artifacts"]
    if not isinstance(artifacts, list):
        raise EndpointError("endpoint seal artifacts are not a list")
    by_role: dict[str, dict[str, Any]] = {}
    for artifact in artifacts:
        if not isinstance(artifact, dict) or set(artifact) != {"role", "path", "sha256"}:
            raise EndpointError("endpoint seal artifact schema changed")
        if artifact["role"] in by_role:
            raise EndpointError("duplicate endpoint seal artifact role")
        by_role[artifact["role"]] = artifact
    if set(by_role) != set(PATHS):
        raise EndpointError("endpoint seal artifact roles changed")
    before: dict[str, str] = {}
    for role, expected_path in PATHS.items():
        artifact = by_role[role]
        if artifact["path"] != expected_path:
            raise EndpointError(f"endpoint seal path changed for {role}")
        local = ROOT / expected_path
        local_sha = sha256_file(local)
        before[role] = local_sha
        if artifact["sha256"] != local_sha:
            raise EndpointError(f"endpoint seal hash changed for {role}")
        if role in FROZEN_HASHES and local_sha != FROZEN_HASHES[role]:
            raise EndpointError(f"frozen artifact changed for {role}")
        if sha256_bytes(git_blob(seal["stageACommit"], expected_path)) != local_sha:
            raise EndpointError(f"Stage-A blob changed for {role}")
    audits = validate_endpoint_audits()
    audit_times = [parse_z(value["completedAt"], f"{role}.completedAt") for role, value in audits.items()]
    stage_time = git_commit_time(seal["stageACommit"], "endpoint Stage A")
    if max(audit_times) > stage_time or stage_time > sealed_at:
        raise EndpointError("endpoint audit/Stage-A/seal timeline is invalid")
    for role, expected_path in PATHS.items():
        if sha256_file(ROOT / expected_path) != before[role]:
            raise EndpointError(f"artifact changed during endpoint seal validation: {role}")
    if path.read_bytes() != seal_raw:
        raise EndpointError("endpoint seal bytes changed during validation")
    return seal, seal_raw, audit_times


def validate_endpoint_authorization(path: Path, *, require_current_head: bool = True) -> dict[str, Any]:
    require_fixed_repo_path(path, ENDPOINT_AUTHORIZATION_PATH, "endpoint authorization")
    auth, auth_raw = load_json_snapshot(path)
    require_keys(auth, AUTH_KEYS, "endpoint authorization")
    if auth["schema"] != AUTH_SCHEMA or auth["protocol"] != PROTOCOL:
        raise EndpointError("endpoint authorization identity changed")
    if auth["status"] != "AUTHORIZED_ENDPOINT_CODE_PRE_OUTCOME":
        raise EndpointError("endpoint authorization status changed")
    auth_time = parse_z(auth["createdAt"], "endpoint authorization.createdAt")
    if auth["authorizationRemote"] != REMOTE or auth["authorizationRemoteUrl"] != REMOTE_URL:
        raise EndpointError("endpoint authorization remote changed")
    if auth["authorizationRef"] != REMOTE_REF:
        raise EndpointError("endpoint authorization ref changed")
    if auth["sealPath"] != ENDPOINT_SEAL_PATH:
        raise EndpointError("endpoint authorization seal path changed")
    for key in ("stageACommit", "sealCommit"):
        if not isinstance(auth[key], str) or not HEX40.fullmatch(auth[key]):
            raise EndpointError(f"endpoint authorization {key} is malformed")
    if auth["priorAuthorizationPath"] != PATHS["PRIOR_AUTHORIZATION"]:
        raise EndpointError("endpoint authorization prior path changed")
    if auth["priorAuthorizationSha256"] != PRIOR_AUTHORIZATION_SHA256:
        raise EndpointError("endpoint authorization prior SHA changed")
    if auth["outcomeLedgerPath"] != PATHS["EMPTY_LEDGER"] or auth["outcomeLedgerSha256"] != EMPTY_LEDGER_SHA256:
        raise EndpointError("endpoint authorization empty ledger changed")
    require_closed_locks(auth, "endpoint authorization")
    seal_path = ROOT / auth["sealPath"]
    seal, seal_raw, audit_times = validate_endpoint_seal(seal_path)
    if auth["stageACommit"] != seal["stageACommit"]:
        raise EndpointError("endpoint authorization Stage-A mismatch")
    if auth["sealSha256"] != sha256_bytes(seal_raw):
        raise EndpointError("endpoint authorization seal SHA changed")
    seal_blob = git_blob(auth["sealCommit"], auth["sealPath"])
    if seal_blob != seal_raw:
        raise EndpointError("endpoint seal commit does not bind exact bytes")
    if git_commit_parents(auth["sealCommit"]) != [auth["stageACommit"]]:
        raise EndpointError("endpoint seal commit is not directly based on Stage A")
    head = run_git(["rev-parse", "HEAD"]).decode().strip()
    auth_repo_path = path.resolve().relative_to(ROOT).as_posix()
    authorization_commit = run_git(["rev-list", "-1", "HEAD", "--", auth_repo_path]).decode().strip()
    if not HEX40.fullmatch(authorization_commit):
        raise EndpointError("endpoint authorization commit cannot be located")
    if git_commit_parents(authorization_commit) != [auth["sealCommit"]]:
        raise EndpointError("endpoint authorization HEAD is not directly based on the seal commit")
    if require_current_head and head != authorization_commit:
        raise EndpointError("endpoint execution requires the authorization commit as current HEAD")
    if run_git(["merge-base", "--is-ancestor", authorization_commit, head]) != b"":
        raise EndpointError("current HEAD is not descended from endpoint authorization")
    remote = run_git(["ls-remote", REMOTE, REMOTE_REF]).decode().strip().split()
    if len(remote) != 2 or remote[0] != head:
        raise EndpointError("endpoint authorization lineage is not the current remote head")
    if run_git(["remote", "get-url", REMOTE]).decode().strip() != REMOTE_URL:
        raise EndpointError("configured remote URL differs from the endpoint authorization")
    if git_blob(authorization_commit, auth_repo_path) != auth_raw:
        raise EndpointError("remote endpoint authorization does not bind exact bytes")
    if sha256_bytes(git_blob(authorization_commit, PATHS["EMPTY_LEDGER"])) != EMPTY_LEDGER_SHA256:
        raise EndpointError("remote endpoint authorization no longer carries the empty ledger")
    if sha256_bytes(git_blob(authorization_commit, PATHS["PRIOR_AUTHORIZATION"])) != PRIOR_AUTHORIZATION_SHA256:
        raise EndpointError("remote endpoint authorization detached from the prior checkpoint")
    if run_git(["merge-base", "--is-ancestor", PRIOR_AUTHORIZATION_COMMIT, auth["stageACommit"]]) != b"":
        raise EndpointError("endpoint Stage A is not descended from the prior authorization")
    if git_commit_parents(auth["stageACommit"]) != [PRIOR_AUTHORIZATION_COMMIT]:
        raise EndpointError("endpoint Stage A is not directly based on prior authorization")
    validate_preoutcome_result_absence(
        [PRIOR_AUTHORIZATION_COMMIT, auth["stageACommit"], auth["sealCommit"], authorization_commit],
        git_path_exists,
    )
    sealed_at = parse_z(seal["sealedAt"], "endpoint seal.sealedAt")
    stage_time = git_commit_time(auth["stageACommit"], "endpoint Stage A")
    seal_time = git_commit_time(auth["sealCommit"], "endpoint seal")
    auth_commit_time = git_commit_time(authorization_commit, "endpoint authorization")
    if not (max(audit_times) <= stage_time <= sealed_at <= seal_time <= auth_time <= auth_commit_time):
        raise EndpointError("endpoint remote checkpoint timeline is invalid")
    if seal_path.read_bytes() != seal_raw:
        raise EndpointError("endpoint seal bytes changed during authorization validation")
    return {
        "value": auth,
        "rawSha256": sha256_bytes(auth_raw),
        "authorizationCommit": authorization_commit,
        "stageACommit": auth["stageACommit"],
        "sealCommit": auth["sealCommit"],
    }


def endpoint_payloads(source_line: dict[str, Any]) -> list[dict[str, Any]]:
    values = [row for row in source_line["payloads"] if "2014q2" < row["quarter"] <= "2015q3"]
    if len(values) != 5 or canonical_sha256(values) != ENDPOINT_PAYLOADS_SHA256:
        raise EndpointError("endpoint payload set changed")
    return values


def validate_future_row(row: dict[str, Any]) -> None:
    accepted = row["acceptedAtEpoch"]
    if not CUTOFF_EPOCH < accepted <= ENDPOINT_CUTOFF_EPOCH:
        raise EndpointError("future source crossed the exclusive-inclusive acceptance window")
    if row["form"] not in {"10-Q", "10-K"}:
        raise EndpointError("amendment or unsupported form entered the endpoint")
    if row["filingPeriodEnd"] != row["periodEnd"]:
        raise EndpointError("comparative fact entered the endpoint")
    accepted_date = datetime.fromtimestamp(accepted, timezone.utc).date()
    if accepted_date < BASE.parse_date_int(row["periodEnd"]):
        raise EndpointError("future source was accepted before its period ended")


def endpoint_ref(ref: dict[str, Any], source_metadata: dict[tuple[int, int, str], dict[str, str]]) -> dict[str, Any]:
    key = (ref["payloadId"], ref["rowNumber"], ref["accession"])
    metadata = source_metadata.get(key)
    if metadata is None:
        raise EndpointError("future source reference lost its submission binding")
    return {**ref, **metadata}


def load_future_facts(
    connection: sqlite3.Connection,
    eligible_rows: list[dict[str, Any]],
    payloads: list[dict[str, Any]],
    revenue_concepts: list[str],
) -> tuple[
    dict[int, Any],
    dict[tuple[int, int, str], dict[str, str]],
    dict[int, dict[tuple[str, int], set[int]]],
]:
    payload_ids = [row["payloadId"] for row in payloads]
    facts: dict[int, Any] = defaultdict(lambda: defaultdict(lambda: defaultdict(dict)))
    source_metadata: dict[tuple[int, int, str], dict[str, str]] = {}
    fiscal_identities: dict[int, dict[tuple[str, int], set[int]]] = defaultdict(
        lambda: defaultdict(set)
    )
    tags = list(revenue_concepts)
    for offset in range(0, len(eligible_rows), 50):
        batch = eligible_rows[offset:offset + 50]
        expected: list[tuple[int, int, int]] = []
        for row in batch:
            anchor = row["quarterlyRevenue"][0]
            anchor_ordinal = anchor["fiscalYear"] * 4 + anchor["fiscalQuarter"] - 1
            for step in range(1, 5):
                fy, fq0 = divmod(anchor_ordinal + step, 4)
                expected.append((int(row["cik"]), fy, fq0 + 1))
        pmarks = ",".join("?" for _ in payload_ids)
        tmarks = ",".join("?" for _ in tags)
        expected_values = ",".join("(?,?,?)" for _ in expected)
        expected_parameters = [value for triple in expected for value in triple]
        query = f"""
            WITH expected(cik, fiscal_year, fiscal_quarter) AS (
                VALUES {expected_values}
            )
            SELECT s.cik,s.adsh,s.form,s.accepted_at_epoch,s.period_end,s.fy,s.fp,
                   c.tag,f.ddate,f.qtrs,u.uom,f.value_text,f.row_number,f.payload_id,
                   lower(hex(s.row_sha256)),lower(hex(f.row_sha256))
              FROM facts f
              JOIN submissions s ON s.submission_id=f.submission_id AND s.payload_id=f.payload_id
              JOIN concepts c ON c.concept_id=f.concept_id
              JOIN units u ON u.unit_id=f.unit_id
              JOIN expected e
                ON e.cik=s.cik
               AND e.fiscal_year=s.fy
               AND e.fiscal_quarter=CASE s.fp
                   WHEN 'Q1' THEN 1 WHEN 'Q2' THEN 2 WHEN 'Q3' THEN 3
                   WHEN 'Q4' THEN 4 WHEN 'FY' THEN 4 END
             WHERE f.payload_id IN ({pmarks})
               AND c.tag IN ({tmarks})
               AND f.qtrs IN (1,2,3,4)
               AND f.coreg IS NULL
               AND u.uom='USD'
               AND s.form IN ('10-Q','10-K')
               AND s.accepted_at_epoch>?
               AND s.accepted_at_epoch<=?
               AND s.period_end=f.ddate
             ORDER BY s.cik,c.tag,f.qtrs,f.ddate,s.accepted_at_epoch,s.adsh,f.payload_id,f.row_number
        """
        rows = connection.execute(
            query, [*expected_parameters, *payload_ids, *tags, CUTOFF_EPOCH, ENDPOINT_CUTOFF_EPOCH]
        )
        for (
            cik, accession, form, accepted, filing_end, fy, fp, concept, period_end,
            qtrs, unit, value_text, row_number, payload_id, submission_sha, fact_sha,
        ) in rows:
            value = BASE.finite(value_text)
            if value is None or fy is None or fp not in {"Q1", "Q2", "Q3", "Q4", "FY"}:
                continue
            row = {
                "payloadId": payload_id,
                "rowNumber": row_number,
                "accession": accession,
                "form": form,
                "acceptedAtEpoch": accepted,
                "filingPeriodEnd": filing_end,
                "fiscalYear": fy,
                "fiscalPeriod": fp,
                "concept": concept,
                "periodEnd": period_end,
                "qtrs": qtrs,
                "unit": unit,
                "value": value,
                "rowSha256": fact_sha,
            }
            validate_future_row(row)
            fiscal_quarter = BASE.fiscal_quarter_number(fp)
            if fiscal_quarter is None:
                continue
            fiscal_identities[cik][(concept, period_end)].add(
                int(fy) * 4 + fiscal_quarter - 1
            )
            source_metadata[(payload_id, row_number, accession)] = {
                "submissionRowSha256": submission_sha,
                "value": BASE.decimal_text(value),
            }
            BASE.add_candidate(facts[cik], row)
    return facts, source_metadata, fiscal_identities


def unresolved_slot(step: int, expected_fy: int, expected_fq: int, reason: str) -> dict[str, Any]:
    return {
        "step": step,
        "expectedFiscalYear": expected_fy,
        "expectedFiscalQuarter": expected_fq,
        "status": "UNRESOLVED",
        "reason": reason,
    }


def frozen_row_sha(row: dict[str, Any]) -> str:
    return canonical_sha256(row)


def index_revenue_fiscal_slots(
    revenue: dict[int, dict[str, Any]],
    fiscal_identities: dict[tuple[str, int], set[int]],
) -> tuple[dict[int, list[tuple[int, dict[str, Any]]]], set[int]]:
    by_ordinal: dict[int, list[tuple[int, dict[str, Any]]]] = defaultdict(list)
    ambiguous_ordinals: set[int] = set()
    for period_end, row in revenue.items():
        if row.get("ambiguous"):
            identities = fiscal_identities.get((row.get("concept"), period_end), set())
            if not identities:
                raise EndpointError("ambiguous future revenue lost its fiscal identity")
            ambiguous_ordinals.update(identities)
            continue
        fy, fq = row.get("fiscalYear"), row.get("fiscalQuarter")
        if isinstance(fy, int) and fq in {1, 2, 3, 4}:
            by_ordinal[fy * 4 + fq - 1].append((period_end, row))
    return by_ordinal, ambiguous_ordinals


def select_fiscal_slot(
    by_ordinal: dict[int, list[tuple[int, dict[str, Any]]]],
    ambiguous_ordinals: set[int],
    ordinal: int,
) -> tuple[tuple[int, dict[str, Any]] | None, str | None]:
    if ordinal in ambiguous_ordinals:
        return None, "AMBIGUOUS_FISCAL_SLOT"
    candidates = by_ordinal.get(ordinal, [])
    if len(candidates) > 1:
        return None, "DUPLICATE_FISCAL_SLOT"
    if not candidates:
        return None, "MISSING_OR_AMBIGUOUS_FUTURE_QUARTER"
    return candidates[0], None


def classify_endpoint_row(
    exposure_row: dict[str, Any],
    cik_facts: dict[str, Any],
    revenue_concepts: list[str],
    source_metadata: dict[tuple[int, int, str], dict[str, str]],
    fiscal_identities: dict[tuple[str, int], set[int]],
) -> dict[str, Any]:
    anchor = exposure_row["quarterlyRevenue"][0]
    anchor_fy = anchor["fiscalYear"]
    anchor_fq = anchor["fiscalQuarter"]
    anchor_ordinal = anchor_fy * 4 + anchor_fq - 1
    revenue = BASE.revenue_quarters(cik_facts, revenue_concepts)
    by_ordinal, ambiguous_ordinals = index_revenue_fiscal_slots(revenue, fiscal_identities)
    slots: list[dict[str, Any]] = []
    previous_period_end = int(exposure_row["anchorPeriodEnd"])
    previous_resolved = True
    for step in range(1, 5):
        ordinal = anchor_ordinal + step
        expected_fy, expected_fq = divmod(ordinal, 4)
        expected_fq += 1
        selected, reason = select_fiscal_slot(by_ordinal, ambiguous_ordinals, ordinal)
        if reason is not None:
            slots.append(unresolved_slot(step, expected_fy, expected_fq, reason))
            previous_resolved = False
            continue
        if selected is None:
            raise EndpointError("fiscal-slot selector returned no candidate and no reason")
        period_end, item = selected
        if not previous_resolved:
            slots.append(unresolved_slot(step, expected_fy, expected_fq, "PRIOR_SLOT_UNRESOLVED"))
            continue
        gap = (BASE.parse_date_int(period_end) - BASE.parse_date_int(previous_period_end)).days
        if not BASE.QUARTER_GAP_MIN <= gap <= BASE.QUARTER_GAP_MAX:
            slots.append(unresolved_slot(step, expected_fy, expected_fq, "INVALID_QUARTER_GAP"))
            previous_resolved = False
            continue
        comparison_index = 4 - step
        comparison = exposure_row["quarterlyRevenue"][comparison_index]
        expected_comparison_ordinal = ordinal - 4
        actual_comparison_ordinal = comparison["fiscalYear"] * 4 + comparison["fiscalQuarter"] - 1
        denominator = BASE.finite(comparison["value"])
        if actual_comparison_ordinal != expected_comparison_ordinal:
            slots.append(unresolved_slot(step, expected_fy, expected_fq, "FROZEN_BASE_MISMATCH"))
            previous_resolved = False
            continue
        if denominator is None or denominator <= 0:
            slots.append(unresolved_slot(step, expected_fy, expected_fq, "NONPOSITIVE_FROZEN_BASE"))
            previous_resolved = False
            continue
        refs = [endpoint_ref(ref, source_metadata) for ref in item["sourceRefs"]]
        for ref in refs:
            validate_endpoint_source_ref(ref, {45, 47, 49, 51, 53})
        yoy = item["value"] / denominator - Decimal(1)
        slots.append({
            "step": step,
            "expectedFiscalYear": expected_fy,
            "expectedFiscalQuarter": expected_fq,
            "status": "VERIFIED",
            "periodEnd": str(period_end),
            "value": BASE.decimal_text(item["value"]),
            "concept": item["concept"],
            "derivation": item["derivation"],
            "sourceRefs": refs,
            "frozenComparisonIndex": comparison_index,
            "frozenComparisonPeriodEnd": comparison["periodEnd"],
            "frozenComparisonValue": comparison["value"],
            "revenueYoy": BASE.decimal_text(yoy),
            "meetsThreshold": yoy >= MIN_REVENUE_YOY,
        })
        previous_period_end = period_end
    ascertainable = all(slot["status"] == "VERIFIED" for slot in slots)
    passing = sum(slot.get("meetsThreshold") is True for slot in slots)
    if not ascertainable:
        state = "NO_VERIFIABLE_4Q_SEQUENCE"
    elif passing >= 3:
        state = "VERIFIED_PERSISTENT"
    else:
        state = "VERIFIED_NOT_PERSISTENT"
    return {
        "cik": exposure_row["cik"],
        "exposure": exposure_row["exposure"],
        "anchorPeriodEnd": exposure_row["anchorPeriodEnd"],
        "anchorFiscalYear": anchor_fy,
        "anchorFiscalQuarter": anchor_fq,
        "frozenExposureRowSha256": frozen_row_sha(exposure_row),
        "futureQuarterSlots": slots,
        "endpointState": state,
        "ascertainable4Q": ascertainable,
        "persistentIndicator": 1 if state == "VERIFIED_PERSISTENT" else 0,
    }


ENDPOINT_SOURCE_REF_KEYS = BASE.SOURCE_REF_KEYS | {"submissionRowSha256", "value"}
VERIFIED_SLOT_KEYS = {
    "step", "expectedFiscalYear", "expectedFiscalQuarter", "status", "periodEnd",
    "value", "concept", "derivation", "sourceRefs", "frozenComparisonIndex",
    "frozenComparisonPeriodEnd", "frozenComparisonValue", "revenueYoy", "meetsThreshold",
}
UNRESOLVED_SLOT_KEYS = {
    "step", "expectedFiscalYear", "expectedFiscalQuarter", "status", "reason",
}
ENDPOINT_ROW_KEYS = {
    "cik", "exposure", "anchorPeriodEnd", "anchorFiscalYear", "anchorFiscalQuarter",
    "frozenExposureRowSha256", "futureQuarterSlots", "endpointState", "ascertainable4Q",
    "persistentIndicator",
}


def validate_endpoint_source_ref(ref: dict[str, Any], allowed_payloads: set[int]) -> None:
    if not isinstance(ref, dict) or set(ref) != ENDPOINT_SOURCE_REF_KEYS:
        raise EndpointError("endpoint source reference schema changed")
    if ref["payloadId"] not in allowed_payloads:
        raise EndpointError("endpoint source reference is not in the five bound payloads")
    if not CUTOFF_EPOCH < ref["acceptedAtEpoch"] <= ENDPOINT_CUTOFF_EPOCH:
        raise EndpointError("endpoint source reference crossed the acceptance window")
    if ref["form"] not in {"10-Q", "10-K"} or ref["unit"] != "USD":
        raise EndpointError("endpoint source reference form/unit changed")
    if ref["filingPeriodEnd"] != ref["periodEnd"]:
        raise EndpointError("endpoint comparative source reference detected")
    if not HEX64.fullmatch(ref["rowSha256"]) or not HEX64.fullmatch(ref["submissionRowSha256"]):
        raise EndpointError("endpoint source hashes are malformed")
    value = BASE.finite(ref["value"])
    if value is None or BASE.decimal_text(value) != ref["value"]:
        raise EndpointError("endpoint source value is not a canonical finite decimal")
    accepted_date = datetime.fromtimestamp(ref["acceptedAtEpoch"], timezone.utc).date()
    if accepted_date < BASE.parse_date_int(ref["periodEnd"]):
        raise EndpointError("endpoint source predates its period")


def endpoint_counts(rows: list[dict[str, Any]]) -> dict[str, Any]:
    by_exposure: dict[str, dict[str, int]] = {}
    for exposure in ("TRIGGER_POSITIVE", "TRIGGER_NEGATIVE"):
        group = [row for row in rows if row["exposure"] == exposure]
        states = defaultdict(int)
        for row in group:
            states[row["endpointState"]] += 1
        by_exposure[exposure] = {
            "nTotal": len(group),
            "nPersistent": states["VERIFIED_PERSISTENT"],
            "nVerifiedNotPersistent": states["VERIFIED_NOT_PERSISTENT"],
            "nNoVerifiable": states["NO_VERIFIABLE_4Q_SEQUENCE"],
            "nAscertainable4Q": states["VERIFIED_PERSISTENT"] + states["VERIFIED_NOT_PERSISTENT"],
        }
    return {
        "eligibleCiks": len(rows),
        "exposures": {
            "TRIGGER_POSITIVE": by_exposure["TRIGGER_POSITIVE"]["nTotal"],
            "TRIGGER_NEGATIVE": by_exposure["TRIGGER_NEGATIVE"]["nTotal"],
        },
        "states": {
            state: sum(row["endpointState"] == state for row in rows)
            for state in (
                "VERIFIED_PERSISTENT", "VERIFIED_NOT_PERSISTENT", "NO_VERIFIABLE_4Q_SEQUENCE"
            )
        },
        "byExposure": by_exposure,
    }


def build_endpoint(
    database: Path, exposure_path: Path, authorization_path: Path, *,
    require_current_authorization_head: bool = True,
) -> dict[str, Any]:
    authorization_before = validate_endpoint_authorization(
        authorization_path, require_current_head=require_current_authorization_head
    )
    exposure, _ = BASE.verify_exposure_contract(exposure_path)
    exposure_raw = exposure_path.read_bytes()
    if sha256_bytes(exposure_raw) != EXPOSURE_RAW_SHA256 or exposure["reportSha256"] != EXPOSURE_REPORT_SHA256:
        raise EndpointError("sealed exposure binding changed")
    eligible = [row for row in exposure["rows"] if row["status"] == "ELIGIBLE"]
    if len(eligible) != 770:
        raise EndpointError("sealed eligible cohort changed")
    contract, roles = BASE.load_contracts()
    source_line, source_raw = load_json_snapshot(ROOT / PATHS["SOURCE_LINE"])
    BASE.validate_source_line(source_line)
    payloads = endpoint_payloads(source_line)
    database_before = BASE.verify_database_sha256(database)
    connection = BASE.open_database(database)
    if BASE.database_snapshot_state(database) != database_before:
        connection.close()
        raise EndpointError("database changed between hash and endpoint query")
    try:
        selected = BASE.selected_payloads(connection, "2015q3")
        selected_endpoint = [row for row in selected if "2014q2" < row["quarter"] <= "2015q3"]
        if selected_endpoint != payloads:
            raise EndpointError("database endpoint payloads differ from the sealed source line")
        facts, source_metadata, fiscal_identities = load_future_facts(
            connection, eligible, payloads, roles["revenue"]
        )
    finally:
        connection.close()
    database_after = BASE.verify_database_sha256(database)
    if database_after != database_before:
        raise EndpointError("database identity changed during endpoint query")
    authorization_after = validate_endpoint_authorization(
        authorization_path, require_current_head=require_current_authorization_head
    )
    if authorization_after != authorization_before:
        raise EndpointError("endpoint authorization changed during endpoint query")
    rows = [
        classify_endpoint_row(
            row,
            facts.get(int(row["cik"]), {}),
            roles["revenue"],
            source_metadata,
            fiscal_identities.get(int(row["cik"]), {}),
        )
        for row in eligible
    ]
    result = {
        "schema": ENDPOINT_SCHEMA,
        "protocol": PROTOCOL,
        "status": "ENDPOINT_MATERIALIZED_COVERAGE_BOUNDED",
        "commonObservationCutoff": CUTOFF,
        "endpointWindowEnd": ENDPOINT_CUTOFF,
        "endpointWindowAcceptedAtRule": "EXCLUSIVE_CUTOFF_INCLUSIVE_WINDOW_END",
        "endpointPayloads": payloads,
        "exposureFileSha256": sha256_bytes(exposure_raw),
        "exposureReportSha256": exposure["reportSha256"],
        "claimContractFileSha256": FROZEN_HASHES["CLAIM_CONTRACT"],
        "scopeFileSha256": FROZEN_HASHES["SCOPE"],
        "sourceLineFileSha256": sha256_bytes(source_raw),
        "databaseAttestationFileSha256": FROZEN_HASHES["DATABASE_ATTESTATION"],
        "authorizationFileSha256": authorization_before["rawSha256"],
        "authorizationCommit": authorization_before["authorizationCommit"],
        "stageACommit": authorization_before["stageACommit"],
        "sealCommit": authorization_before["sealCommit"],
        "counts": endpoint_counts(rows),
        "rows": rows,
        "claimLocks": CLAIM_LOCKS,
        "outcomesAccessed": True,
        "postAnchorFactsRead": True,
        "postAnchorFactsMaterialized": True,
        "analysisExecuted": False,
        "stockReturnsAccessed": False,
        "originalV4OutcomesAccessed": False,
        "humanAttestation": False,
    }
    result["reportSha256"] = canonical_sha256(result)
    return result


ENDPOINT_TOP_KEYS = {
    "schema", "protocol", "status", "commonObservationCutoff", "endpointWindowEnd",
    "endpointWindowAcceptedAtRule", "endpointPayloads", "exposureFileSha256",
    "exposureReportSha256", "claimContractFileSha256", "scopeFileSha256",
    "sourceLineFileSha256", "databaseAttestationFileSha256", "authorizationFileSha256",
    "authorizationCommit", "stageACommit", "sealCommit", "counts", "rows", "claimLocks",
    "outcomesAccessed", "postAnchorFactsRead", "postAnchorFactsMaterialized",
    "analysisExecuted", "stockReturnsAccessed", "originalV4OutcomesAccessed",
    "humanAttestation", "reportSha256",
}


def validate_endpoint_contract(
    path: Path, raw_snapshot: bytes | None = None,
) -> tuple[dict[str, Any], dict[str, Any]]:
    raw = path.read_bytes() if raw_snapshot is None else raw_snapshot
    endpoint = decode_json_snapshot(raw, path)
    require_keys(endpoint, ENDPOINT_TOP_KEYS, "endpoint")
    if endpoint["schema"] != ENDPOINT_SCHEMA or endpoint["protocol"] != PROTOCOL:
        raise EndpointError("endpoint identity changed")
    if endpoint["status"] != "ENDPOINT_MATERIALIZED_COVERAGE_BOUNDED":
        raise EndpointError("endpoint status changed")
    if endpoint["reportSha256"] != unsigned_sha256(endpoint, "reportSha256"):
        raise EndpointError("endpoint self-hash changed")
    if endpoint["commonObservationCutoff"] != CUTOFF or endpoint["endpointWindowEnd"] != ENDPOINT_CUTOFF:
        raise EndpointError("endpoint window changed")
    if endpoint["endpointWindowAcceptedAtRule"] != "EXCLUSIVE_CUTOFF_INCLUSIVE_WINDOW_END":
        raise EndpointError("endpoint boundary rule changed")
    if canonical_sha256(endpoint["endpointPayloads"]) != ENDPOINT_PAYLOADS_SHA256:
        raise EndpointError("endpoint payload binding changed")
    expected_bindings = {
        "exposureFileSha256": EXPOSURE_RAW_SHA256,
        "exposureReportSha256": EXPOSURE_REPORT_SHA256,
        "claimContractFileSha256": FROZEN_HASHES["CLAIM_CONTRACT"],
        "scopeFileSha256": FROZEN_HASHES["SCOPE"],
        "sourceLineFileSha256": FROZEN_HASHES["SOURCE_LINE"],
        "databaseAttestationFileSha256": FROZEN_HASHES["DATABASE_ATTESTATION"],
    }
    if any(endpoint[key] != expected for key, expected in expected_bindings.items()):
        raise EndpointError("endpoint frozen binding changed")
    if endpoint["claimLocks"] != CLAIM_LOCKS:
        raise EndpointError("endpoint claim locks changed")
    if not HEX64.fullmatch(endpoint["authorizationFileSha256"]):
        raise EndpointError("endpoint authorization hash is malformed")
    for key in ("authorizationCommit", "stageACommit", "sealCommit"):
        if not isinstance(endpoint[key], str) or not HEX40.fullmatch(endpoint[key]):
            raise EndpointError(f"endpoint {key} is malformed")
    if not (
        endpoint["outcomesAccessed"] is True
        and endpoint["postAnchorFactsRead"] is True
        and endpoint["postAnchorFactsMaterialized"] is True
        and endpoint["analysisExecuted"] is False
        and endpoint["stockReturnsAccessed"] is False
        and endpoint["originalV4OutcomesAccessed"] is False
        and endpoint["humanAttestation"] is False
    ):
        raise EndpointError("endpoint outcome/claim state changed")
    exposure, _ = BASE.verify_exposure_contract(ROOT / PATHS["EXPOSURE"])
    frozen = {row["cik"]: row for row in exposure["rows"] if row["status"] == "ELIGIBLE"}
    rows = endpoint["rows"]
    if not isinstance(rows, list) or len(rows) != 770:
        raise EndpointError("endpoint row count changed")
    ciks = [row.get("cik") for row in rows]
    if ciks != sorted(frozen) or len(ciks) != len(set(ciks)):
        raise EndpointError("endpoint cohort was omitted, duplicated, or expanded")
    allowed_payloads = {row["payloadId"] for row in endpoint["endpointPayloads"]}
    for row in rows:
        require_keys(row, ENDPOINT_ROW_KEYS, "endpoint row")
        source = frozen[row["cik"]]
        anchor = source["quarterlyRevenue"][0]
        if (
            row["exposure"] != source["exposure"]
            or row["anchorPeriodEnd"] != source["anchorPeriodEnd"]
            or row["anchorFiscalYear"] != anchor["fiscalYear"]
            or row["anchorFiscalQuarter"] != anchor["fiscalQuarter"]
            or row["frozenExposureRowSha256"] != frozen_row_sha(source)
        ):
            raise EndpointError("endpoint row changed a frozen cohort identity")
        slots = row["futureQuarterSlots"]
        if not isinstance(slots, list) or len(slots) != 4:
            raise EndpointError("endpoint row does not have four fixed slots")
        expected_ordinal = anchor["fiscalYear"] * 4 + anchor["fiscalQuarter"] - 1
        verified = 0
        passing = 0
        previous_period = int(source["anchorPeriodEnd"])
        previous_verified = True
        for step, slot in enumerate(slots, 1):
            ordinal = expected_ordinal + step
            fy, fq0 = divmod(ordinal, 4)
            fq = fq0 + 1
            if slot.get("step") != step or slot.get("expectedFiscalYear") != fy or slot.get("expectedFiscalQuarter") != fq:
                raise EndpointError("endpoint slot fiscal identity changed")
            if slot.get("status") == "UNRESOLVED":
                require_keys(slot, UNRESOLVED_SLOT_KEYS, "unresolved endpoint slot")
                if slot["reason"] not in {
                    "MISSING_OR_AMBIGUOUS_FUTURE_QUARTER", "DUPLICATE_FISCAL_SLOT",
                    "AMBIGUOUS_FISCAL_SLOT",
                    "PRIOR_SLOT_UNRESOLVED", "INVALID_QUARTER_GAP", "FROZEN_BASE_MISMATCH",
                    "NONPOSITIVE_FROZEN_BASE",
                }:
                    raise EndpointError("unresolved endpoint reason changed")
                previous_verified = False
                continue
            require_keys(slot, VERIFIED_SLOT_KEYS, "verified endpoint slot")
            if slot["status"] != "VERIFIED" or not previous_verified:
                raise EndpointError("endpoint slot compressed a missing fiscal quarter")
            refs = slot["sourceRefs"]
            if not isinstance(refs, list) or not refs:
                raise EndpointError("verified endpoint slot has no source references")
            for ref in refs:
                validate_endpoint_source_ref(ref, allowed_payloads)
                if ref["concept"] != slot["concept"] or ref["fiscalYear"] != fy:
                    raise EndpointError("endpoint source reference does not bind the slot")
            period = int(slot["periodEnd"])
            gap = (BASE.parse_date_int(period) - BASE.parse_date_int(previous_period)).days
            if not BASE.QUARTER_GAP_MIN <= gap <= BASE.QUARTER_GAP_MAX:
                raise EndpointError("verified endpoint slot has an invalid quarter gap")
            comparison_index = 4 - step
            comparison = source["quarterlyRevenue"][comparison_index]
            if (
                slot["frozenComparisonIndex"] != comparison_index
                or slot["frozenComparisonPeriodEnd"] != comparison["periodEnd"]
                or slot["frozenComparisonValue"] != comparison["value"]
            ):
                raise EndpointError("endpoint slot did not use the frozen denominator")
            numerator = BASE.finite(slot["value"])
            denominator = BASE.finite(comparison["value"])
            if numerator is None or denominator is None or denominator <= 0:
                raise EndpointError("endpoint slot value/base is invalid")
            if slot["derivation"] == "DIRECT_QTRS1":
                if (
                    len(refs) != 1 or refs[0]["qtrs"] != 1
                    or refs[0]["periodEnd"] != period
                    or BASE.finite(refs[0]["value"]) != numerator
                    or fq not in {1, 2, 3}
                    or BASE.fiscal_quarter_number(refs[0]["fiscalPeriod"]) != fq
                ):
                    raise EndpointError("endpoint direct-quarter derivation does not recompute")
            else:
                expected_derivation = f"QTRS{fq}_MINUS_QTRS{fq - 1}_SAME_CIK_CONCEPT_UNIT_FY"
                if fq not in {2, 3, 4} or slot["derivation"] != expected_derivation or len(refs) != 2:
                    raise EndpointError("endpoint cumulative-quarter derivation changed")
                current, prior = refs
                current_value, prior_value = BASE.finite(current["value"]), BASE.finite(prior["value"])
                if (
                    current["qtrs"] != fq or prior["qtrs"] != fq - 1
                    or current["periodEnd"] != period or prior["periodEnd"] >= period
                    or current_value is None or prior_value is None
                    or current_value - prior_value != numerator
                    or current["fiscalYear"] != prior["fiscalYear"]
                    or current["concept"] != prior["concept"]
                    or current["unit"] != prior["unit"]
                ):
                    raise EndpointError("endpoint cumulative-quarter values do not recompute")
                derivation_gap = (BASE.parse_date_int(period) - BASE.parse_date_int(prior["periodEnd"])).days
                if not BASE.QUARTER_GAP_MIN <= derivation_gap <= BASE.QUARTER_GAP_MAX:
                    raise EndpointError("endpoint cumulative-quarter gap changed")
            yoy = numerator / denominator - Decimal(1)
            if slot["revenueYoy"] != BASE.decimal_text(yoy) or slot["meetsThreshold"] is not (yoy >= MIN_REVENUE_YOY):
                raise EndpointError("endpoint slot YoY does not recompute")
            verified += 1
            passing += int(slot["meetsThreshold"])
            previous_period = period
        expected_state = (
            "NO_VERIFIABLE_4Q_SEQUENCE" if verified != 4
            else "VERIFIED_PERSISTENT" if passing >= 3
            else "VERIFIED_NOT_PERSISTENT"
        )
        if (
            row["endpointState"] != expected_state
            or row["ascertainable4Q"] is not (verified == 4)
            or row["persistentIndicator"] != int(expected_state == "VERIFIED_PERSISTENT")
        ):
            raise EndpointError("endpoint state does not recompute")
    recomputed = endpoint_counts(rows)
    if endpoint["counts"] != recomputed:
        raise EndpointError("endpoint counts do not recompute")
    if recomputed["exposures"] != {"TRIGGER_POSITIVE": 72, "TRIGGER_NEGATIVE": 698}:
        raise EndpointError("endpoint exposure denominator changed")
    return endpoint, {
        "status": "PASS",
        "rows": len(rows),
        "reportSha256": endpoint["reportSha256"],
        "rawSha256": sha256_bytes(raw),
    }


def verify_endpoint(path: Path, database: Path, authorization: Path) -> dict[str, Any]:
    require_result_path(path, "ENDPOINT")
    authorization_before = validate_endpoint_authorization(
        authorization, require_current_head=False
    )
    endpoint_head, endpoint_raw, endpoint_commit = require_remote_result_bound(path, "ENDPOINT")
    validate_result_commit_lineage(
        {"ENDPOINT": endpoint_commit},
        authorization_before["authorizationCommit"],
        git_commit_parents,
    )
    validate_result_stage_contents(
        {"ENDPOINT": endpoint_commit},
        git_result_path_exists,
    )
    endpoint, verdict = validate_endpoint_contract(path, endpoint_raw)
    rebuilt = build_endpoint(
        database, ROOT / PATHS["EXPOSURE"], authorization,
        require_current_authorization_head=False,
    )
    if endpoint != rebuilt:
        raise EndpointError("endpoint does not match a deterministic database rebuild")
    authorization_after = validate_endpoint_authorization(
        authorization, require_current_head=False
    )
    if authorization_after != authorization_before:
        raise EndpointError("endpoint authorization changed during verification")
    endpoint_head_after, endpoint_after, endpoint_commit_after = require_remote_result_bound(
        path, "ENDPOINT"
    )
    if (
        endpoint_head_after != endpoint_head
        or endpoint_after != endpoint_raw
        or endpoint_commit_after != endpoint_commit
    ):
        raise EndpointError("endpoint bytes changed during verification")
    return {
        **verdict,
        "deterministicDatabaseRebuild": True,
        "verifiedRemoteHead": endpoint_head,
        "verifiedRawSha256": sha256_bytes(endpoint_raw),
        "verifiedResultCommit": endpoint_commit,
    }


def display_decimal(value: Decimal) -> str:
    return format(value.quantize(DISPLAY_QUANTUM, rounding=ROUND_HALF_EVEN), "f")


def wilson_interval(successes: int, total: int) -> tuple[Decimal, Decimal]:
    if total <= 0 or not 0 <= successes <= total:
        raise EndpointError("invalid Wilson inputs")
    with localcontext() as context:
        context.prec = 60
        n = Decimal(total)
        p = Decimal(successes) / n
        denominator = Decimal(1) + Z_975 * Z_975 / n
        center = (p + Z_975 * Z_975 / (Decimal(2) * n)) / denominator
        half = Z_975 * (p * (Decimal(1) - p) / n + Z_975 * Z_975 / (Decimal(4) * n * n)).sqrt() / denominator
        return center - half, center + half


def newcombe_method_10(x1: int, n1: int, x0: int, n0: int) -> tuple[Decimal, Decimal, Decimal]:
    with localcontext() as context:
        context.prec = 60
        p1 = Decimal(x1) / Decimal(n1)
        p0 = Decimal(x0) / Decimal(n0)
        l1, u1 = wilson_interval(x1, n1)
        l0, u0 = wilson_interval(x0, n0)
        difference = p1 - p0
        lower = difference - ((p1 - l1) ** 2 + (u0 - p0) ** 2).sqrt()
        upper = difference + ((u1 - p1) ** 2 + (p0 - l0) ** 2).sqrt()
        return difference, lower, upper


ENDPOINT_LEDGER_KEYS = {
    "schema", "protocol", "status", "parentLedgerPath", "parentLedgerSha256",
    "authorizationPath", "authorizationSha256", "authorizationCommit", "endpointPath",
    "endpointFileSha256", "endpointReportSha256", "events", "outcomesAccessed",
    "postAnchorFactsRead", "postAnchorFactsMaterialized", "analysisExecuted",
    "stockReturnsAccessed", "originalV4OutcomesAccessed", "humanAttestation", "ledgerSha256",
}


def build_endpoint_ledger(
    endpoint_path: Path,
    authorization_path: Path,
    *,
    endpoint_raw_snapshot: bytes | None = None,
) -> dict[str, Any]:
    require_fixed_repo_path(
        authorization_path, ENDPOINT_AUTHORIZATION_PATH, "endpoint authorization"
    )
    endpoint_raw = endpoint_path.read_bytes() if endpoint_raw_snapshot is None else endpoint_raw_snapshot
    endpoint = decode_json_snapshot(endpoint_raw, endpoint_path)
    validate_endpoint_contract(endpoint_path, endpoint_raw)
    auth, auth_raw = load_json_snapshot(authorization_path)
    if endpoint["authorizationFileSha256"] != sha256_bytes(auth_raw):
        raise EndpointError("endpoint and authorization differ at ledger transition")
    empty, empty_raw = load_json_snapshot(ROOT / PATHS["EMPTY_LEDGER"])
    if sha256_bytes(empty_raw) != EMPTY_LEDGER_SHA256 or empty != {
        "schema": "sec-cik-growth-persistence-outcome-ledger/v1",
        "protocol": PROTOCOL,
        "status": "PRE_OUTCOME_EMPTY",
        "outcomesAccessed": False,
        "postAnchorFactsRead": False,
        "postAnchorFactsMaterialized": False,
        "analysisExecuted": False,
        "events": [],
    }:
        raise EndpointError("sealed empty ledger changed")
    value = {
        "schema": ENDPOINT_LEDGER_SCHEMA,
        "protocol": PROTOCOL,
        "status": "ENDPOINT_VERIFIED",
        "parentLedgerPath": PATHS["EMPTY_LEDGER"],
        "parentLedgerSha256": sha256_bytes(empty_raw),
        "authorizationPath": authorization_path.resolve().relative_to(ROOT).as_posix(),
        "authorizationSha256": sha256_bytes(auth_raw),
        "authorizationCommit": endpoint["authorizationCommit"],
        "endpointPath": endpoint_path.resolve().relative_to(ROOT).as_posix(),
        "endpointFileSha256": sha256_bytes(endpoint_raw),
        "endpointReportSha256": endpoint["reportSha256"],
        "events": [{
            "event": "ENDPOINT_VERIFIED",
            "endpointFileSha256": sha256_bytes(endpoint_raw),
            "endpointReportSha256": endpoint["reportSha256"],
        }],
        "outcomesAccessed": True,
        "postAnchorFactsRead": True,
        "postAnchorFactsMaterialized": True,
        "analysisExecuted": False,
        "stockReturnsAccessed": False,
        "originalV4OutcomesAccessed": False,
        "humanAttestation": False,
    }
    value["ledgerSha256"] = canonical_sha256(value)
    return value


def validate_endpoint_ledger(
    path: Path,
    endpoint_path: Path,
    *,
    raw_snapshot: bytes | None = None,
    endpoint_raw_snapshot: bytes | None = None,
) -> tuple[dict[str, Any], bytes]:
    raw = path.read_bytes() if raw_snapshot is None else raw_snapshot
    ledger = decode_json_snapshot(raw, path)
    require_keys(ledger, ENDPOINT_LEDGER_KEYS, "endpoint ledger")
    if ledger["schema"] != ENDPOINT_LEDGER_SCHEMA or ledger["protocol"] != PROTOCOL:
        raise EndpointError("endpoint ledger identity changed")
    if ledger["status"] != "ENDPOINT_VERIFIED" or ledger["ledgerSha256"] != unsigned_sha256(ledger, "ledgerSha256"):
        raise EndpointError("endpoint ledger status/self-hash changed")
    if ledger["authorizationPath"] != ENDPOINT_AUTHORIZATION_PATH:
        raise EndpointError("endpoint ledger authorization path changed")
    endpoint_raw = endpoint_path.read_bytes() if endpoint_raw_snapshot is None else endpoint_raw_snapshot
    endpoint = decode_json_snapshot(endpoint_raw, endpoint_path)
    validate_endpoint_contract(endpoint_path, endpoint_raw)
    expected = build_endpoint_ledger(
        endpoint_path,
        ROOT / ledger["authorizationPath"],
        endpoint_raw_snapshot=endpoint_raw,
    )
    if ledger != expected:
        raise EndpointError("endpoint ledger transition does not recompute")
    if ledger["endpointFileSha256"] != sha256_bytes(endpoint_raw) or ledger["endpointReportSha256"] != endpoint["reportSha256"]:
        raise EndpointError("endpoint ledger detached from endpoint bytes")
    return ledger, raw


def group_analysis(rows: list[dict[str, Any]], exposure: str) -> dict[str, Any]:
    group = [row for row in rows if row["exposure"] == exposure]
    persistent = sum(row["endpointState"] == "VERIFIED_PERSISTENT" for row in group)
    verified_not = sum(row["endpointState"] == "VERIFIED_NOT_PERSISTENT" for row in group)
    no_verifiable = sum(row["endpointState"] == "NO_VERIFIABLE_4Q_SEQUENCE" for row in group)
    total = len(group)
    ascertainable = persistent + verified_not
    with localcontext() as context:
        context.prec = 60
        return {
            "nTotal": total,
            "nPersistent": persistent,
            "nVerifiedNotPersistent": verified_not,
            "nNoVerifiable": no_verifiable,
            "nAscertainable4Q": ascertainable,
            "fullCohortPersistentRate": display_decimal(Decimal(persistent) / Decimal(total)),
            "ascertainmentRate": display_decimal(Decimal(ascertainable) / Decimal(total)),
        }


def build_analysis(
    endpoint_path: Path,
    endpoint_ledger_path: Path,
    *,
    endpoint_raw_snapshot: bytes | None = None,
    endpoint_ledger_raw_snapshot: bytes | None = None,
) -> dict[str, Any]:
    endpoint_raw = endpoint_path.read_bytes() if endpoint_raw_snapshot is None else endpoint_raw_snapshot
    endpoint = decode_json_snapshot(endpoint_raw, endpoint_path)
    validate_endpoint_contract(endpoint_path, endpoint_raw)
    ledger, ledger_raw = validate_endpoint_ledger(
        endpoint_ledger_path,
        endpoint_path,
        raw_snapshot=endpoint_ledger_raw_snapshot,
        endpoint_raw_snapshot=endpoint_raw,
    )
    positive = group_analysis(endpoint["rows"], "TRIGGER_POSITIVE")
    negative = group_analysis(endpoint["rows"], "TRIGGER_NEGATIVE")
    difference, lower, upper = newcombe_method_10(
        positive["nPersistent"], positive["nTotal"], negative["nPersistent"], negative["nTotal"]
    )
    positive_size = positive["nTotal"] >= 40
    negative_size = negative["nTotal"] >= 80
    positive_ascertainment = positive["nAscertainable4Q"] * 10 >= positive["nTotal"] * 9
    negative_ascertainment = negative["nAscertainable4Q"] * 10 >= negative["nTotal"] * 9
    ascertainment_difference = (
        abs(
            positive["nAscertainable4Q"] * negative["nTotal"]
            - negative["nAscertainable4Q"] * positive["nTotal"]
        ) * 10
        <= positive["nTotal"] * negative["nTotal"]
    )
    gates = {
        "minimumTriggerPositive": positive_size,
        "minimumTriggerNegative": negative_size,
        "minimumAscertainmentTriggerPositive": positive_ascertainment,
        "minimumAscertainmentTriggerNegative": negative_ascertainment,
        "maximumAscertainmentDifference": ascertainment_difference,
    }
    gates["allPassed"] = all(gates.values())
    verdict = "INCONCLUSIVE"
    if gates["allPassed"] and lower > 0:
        verdict = "SUPPORT"
    elif gates["allPassed"] and upper < 0:
        verdict = "REJECT"
    value = {
        "schema": ANALYSIS_SCHEMA,
        "protocol": PROTOCOL,
        "status": "ANALYSIS_COMPLETE_COVERAGE_BOUNDED",
        "endpointPath": endpoint_path.resolve().relative_to(ROOT).as_posix(),
        "endpointFileSha256": sha256_bytes(endpoint_raw),
        "endpointReportSha256": endpoint["reportSha256"],
        "endpointLedgerPath": endpoint_ledger_path.resolve().relative_to(ROOT).as_posix(),
        "endpointLedgerFileSha256": sha256_bytes(ledger_raw),
        "endpointLedgerCanonicalSha256": ledger["ledgerSha256"],
        "groups": {"TRIGGER_POSITIVE": positive, "TRIGGER_NEGATIVE": negative},
        "riskDifferenceTriggerPositiveMinusNegative": display_decimal(difference),
        "newcombe95": {
            "method": "NEWCOMBE_METHOD_10_WILSON_NO_CONTINUITY_CORRECTION",
            "lower": display_decimal(lower),
            "upper": display_decimal(upper),
        },
        "gates": gates,
        "verdict": verdict,
        "claimLocks": CLAIM_LOCKS,
        "outcomesAccessed": True,
        "postAnchorFactsRead": True,
        "postAnchorFactsMaterialized": True,
        "analysisExecuted": True,
        "stockReturnsAccessed": False,
        "originalV4OutcomesAccessed": False,
        "humanAttestation": False,
    }
    value["reportSha256"] = canonical_sha256(value)
    return value


ANALYSIS_TOP_KEYS = {
    "schema", "protocol", "status", "endpointPath", "endpointFileSha256",
    "endpointReportSha256", "endpointLedgerPath", "endpointLedgerFileSha256",
    "endpointLedgerCanonicalSha256", "groups", "riskDifferenceTriggerPositiveMinusNegative",
    "newcombe95", "gates", "verdict", "claimLocks", "outcomesAccessed",
    "postAnchorFactsRead", "postAnchorFactsMaterialized", "analysisExecuted",
    "stockReturnsAccessed", "originalV4OutcomesAccessed", "humanAttestation", "reportSha256",
}


def validate_analysis(
    path: Path,
    endpoint_path: Path,
    endpoint_ledger_path: Path,
    *,
    raw_snapshot: bytes | None = None,
    endpoint_raw_snapshot: bytes | None = None,
    endpoint_ledger_raw_snapshot: bytes | None = None,
) -> tuple[dict[str, Any], bytes]:
    raw = path.read_bytes() if raw_snapshot is None else raw_snapshot
    analysis = decode_json_snapshot(raw, path)
    require_keys(analysis, ANALYSIS_TOP_KEYS, "analysis")
    if analysis["schema"] != ANALYSIS_SCHEMA or analysis["protocol"] != PROTOCOL:
        raise EndpointError("analysis identity changed")
    if analysis["reportSha256"] != unsigned_sha256(analysis, "reportSha256"):
        raise EndpointError("analysis self-hash changed")
    rebuilt = build_analysis(
        endpoint_path,
        endpoint_ledger_path,
        endpoint_raw_snapshot=endpoint_raw_snapshot,
        endpoint_ledger_raw_snapshot=endpoint_ledger_raw_snapshot,
    )
    if analysis != rebuilt:
        raise EndpointError("analysis does not deterministically recompute")
    return analysis, raw


ANALYSIS_LEDGER_KEYS = {
    "schema", "protocol", "status", "parentLedgerPath", "parentLedgerSha256",
    "endpointPath", "endpointFileSha256", "endpointReportSha256", "analysisPath",
    "analysisFileSha256", "analysisReportSha256", "events", "outcomesAccessed",
    "postAnchorFactsRead", "postAnchorFactsMaterialized", "analysisExecuted",
    "stockReturnsAccessed", "originalV4OutcomesAccessed", "humanAttestation", "ledgerSha256",
}


def build_analysis_ledger(
    analysis_path: Path,
    endpoint_path: Path,
    endpoint_ledger_path: Path,
    *,
    analysis_raw_snapshot: bytes | None = None,
    endpoint_raw_snapshot: bytes | None = None,
    endpoint_ledger_raw_snapshot: bytes | None = None,
) -> dict[str, Any]:
    endpoint_raw = endpoint_path.read_bytes() if endpoint_raw_snapshot is None else endpoint_raw_snapshot
    endpoint = decode_json_snapshot(endpoint_raw, endpoint_path)
    analysis, analysis_raw = validate_analysis(
        analysis_path,
        endpoint_path,
        endpoint_ledger_path,
        raw_snapshot=analysis_raw_snapshot,
        endpoint_raw_snapshot=endpoint_raw,
        endpoint_ledger_raw_snapshot=endpoint_ledger_raw_snapshot,
    )
    endpoint_ledger, endpoint_ledger_raw = validate_endpoint_ledger(
        endpoint_ledger_path,
        endpoint_path,
        raw_snapshot=endpoint_ledger_raw_snapshot,
        endpoint_raw_snapshot=endpoint_raw,
    )
    value = {
        "schema": ANALYSIS_LEDGER_SCHEMA,
        "protocol": PROTOCOL,
        "status": "ANALYSIS_COMPLETE",
        "parentLedgerPath": endpoint_ledger_path.resolve().relative_to(ROOT).as_posix(),
        "parentLedgerSha256": sha256_bytes(endpoint_ledger_raw),
        "endpointPath": endpoint_path.resolve().relative_to(ROOT).as_posix(),
        "endpointFileSha256": sha256_bytes(endpoint_raw),
        "endpointReportSha256": endpoint["reportSha256"],
        "analysisPath": analysis_path.resolve().relative_to(ROOT).as_posix(),
        "analysisFileSha256": sha256_bytes(analysis_raw),
        "analysisReportSha256": analysis["reportSha256"],
        "events": [
            endpoint_ledger["events"][0],
            {
                "event": "ANALYSIS_COMPLETE",
                "analysisFileSha256": sha256_bytes(analysis_raw),
                "analysisReportSha256": analysis["reportSha256"],
            },
        ],
        "outcomesAccessed": True,
        "postAnchorFactsRead": True,
        "postAnchorFactsMaterialized": True,
        "analysisExecuted": True,
        "stockReturnsAccessed": False,
        "originalV4OutcomesAccessed": False,
        "humanAttestation": False,
    }
    value["ledgerSha256"] = canonical_sha256(value)
    return value


def validate_analysis_ledger(
    path: Path,
    analysis_path: Path,
    endpoint_path: Path,
    endpoint_ledger_path: Path,
    *,
    raw_snapshot: bytes | None = None,
    analysis_raw_snapshot: bytes | None = None,
    endpoint_raw_snapshot: bytes | None = None,
    endpoint_ledger_raw_snapshot: bytes | None = None,
) -> tuple[dict[str, Any], bytes]:
    raw = path.read_bytes() if raw_snapshot is None else raw_snapshot
    ledger = decode_json_snapshot(raw, path)
    require_keys(ledger, ANALYSIS_LEDGER_KEYS, "analysis ledger")
    if ledger["schema"] != ANALYSIS_LEDGER_SCHEMA or ledger["protocol"] != PROTOCOL:
        raise EndpointError("analysis ledger identity changed")
    if ledger["status"] != "ANALYSIS_COMPLETE" or ledger["ledgerSha256"] != unsigned_sha256(ledger, "ledgerSha256"):
        raise EndpointError("analysis ledger status/self-hash changed")
    rebuilt = build_analysis_ledger(
        analysis_path,
        endpoint_path,
        endpoint_ledger_path,
        analysis_raw_snapshot=analysis_raw_snapshot,
        endpoint_raw_snapshot=endpoint_raw_snapshot,
        endpoint_ledger_raw_snapshot=endpoint_ledger_raw_snapshot,
    )
    if ledger != rebuilt:
        raise EndpointError("analysis ledger transition does not recompute")
    if not (
        ledger["outcomesAccessed"] is True
        and ledger["postAnchorFactsRead"] is True
        and ledger["postAnchorFactsMaterialized"] is True
        and ledger["analysisExecuted"] is True
        and ledger["stockReturnsAccessed"] is False
        and ledger["originalV4OutcomesAccessed"] is False
        and ledger["humanAttestation"] is False
    ):
        raise EndpointError("analysis ledger lock state changed")
    return ledger, raw


def write_new(path: Path, value: dict[str, Any]) -> None:
    target = path.expanduser().resolve()
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists():
        raise EndpointError(f"refusing to overwrite: {target}")
    with target.open("x", encoding="utf-8", newline="\n") as handle:
        json.dump(value, handle, ensure_ascii=False, separators=(",", ":"))
        handle.write("\n")


def require_result_path(path: Path, role: str) -> None:
    expected = (ROOT / RESULT_PATHS[role]).resolve()
    if path.expanduser().resolve() != expected:
        raise EndpointError(f"{role} path must be the frozen result path: {expected}")


def require_remote_result_bound(path: Path, role: str) -> tuple[str, bytes, str]:
    require_result_path(path, role)
    local_raw = path.read_bytes()
    head = run_git(["rev-parse", "HEAD"]).decode().strip()
    remote = run_git(["ls-remote", REMOTE, REMOTE_REF]).decode().strip().split()
    if len(remote) != 2 or remote[0] != head:
        raise EndpointError(f"{role} is not being consumed from the current remote head")
    repo_path = path.resolve().relative_to(ROOT).as_posix()
    if git_blob(head, repo_path) != local_raw:
        raise EndpointError(f"{role} local bytes differ from the current remote head")
    if path.read_bytes() != local_raw:
        raise EndpointError(f"{role} bytes changed during remote verification")
    touching_commits = [
        line for line in run_git(["rev-list", "HEAD", "--", repo_path]).decode().splitlines()
        if line
    ]
    if len(touching_commits) != 1 or not HEX40.fullmatch(touching_commits[0]):
        raise EndpointError(f"{role} must be introduced once and never amended")
    introduction_commit = touching_commits[0]
    if git_blob(introduction_commit, repo_path) != local_raw:
        raise EndpointError(f"{role} introduction commit does not bind current bytes")
    return head, local_raw, introduction_commit


RESULT_ROLE_ORDER = ("ENDPOINT", "ENDPOINT_LEDGER", "ANALYSIS", "ANALYSIS_LEDGER")


def validate_result_commit_lineage(
    commits: dict[str, str],
    authorization_commit: str,
    parent_lookup: Any,
) -> None:
    roles = tuple(commits)
    if roles != RESULT_ROLE_ORDER[:len(roles)]:
        raise EndpointError("result roles are not a strict stage prefix")
    expected_parent = authorization_commit
    for role in roles:
        commit = commits[role]
        if parent_lookup(commit) != [expected_parent]:
            raise EndpointError(f"{role} is not a separate direct remote checkpoint")
        expected_parent = commit


def validate_result_stage_contents(
    commits: dict[str, str],
    exists_lookup: Any,
) -> None:
    for index, role in enumerate(RESULT_ROLE_ORDER):
        if role not in commits:
            break
        commit = commits[role]
        for future_role in RESULT_ROLE_ORDER[index + 1:]:
            if exists_lookup(commit, RESULT_PATHS[future_role]):
                raise EndpointError(f"{role} commit already contains future result {future_role}")


def git_result_path_exists(commit: str, result_path: str) -> bool:
    return git_path_exists(commit, result_path)


def synthetic_parent_lookup(parents: dict[str, str | list[str]]) -> Any:
    def lookup(commit: str) -> list[str]:
        value = parents[commit]
        return value if isinstance(value, list) else [value]
    return lookup


def require_stable_remote_snapshots(
    bindings: list[tuple[Path, str]],
    authorization_commit: str,
) -> tuple[str, dict[str, bytes], dict[str, str]]:
    snapshots: dict[str, bytes] = {}
    commits: dict[str, str] = {}
    head: str | None = None
    for path, role in bindings:
        current_head, raw, introduction_commit = require_remote_result_bound(path, role)
        if head is None:
            head = current_head
        elif current_head != head:
            raise EndpointError("result chain crossed remote heads")
        snapshots[role] = raw
        commits[role] = introduction_commit
    if head is None:
        raise EndpointError("empty remote snapshot set")
    validate_result_commit_lineage(
        commits,
        authorization_commit,
        git_commit_parents,
    )
    validate_result_stage_contents(commits, git_result_path_exists)
    return head, snapshots, commits


def require_verified_endpoint_snapshot(
    endpoint_verdict: dict[str, Any],
    snapshot_head: str,
    endpoint_raw: bytes,
    endpoint_commit: str,
) -> None:
    if (
        endpoint_verdict.get("verifiedRemoteHead") != snapshot_head
        or endpoint_verdict.get("verifiedRawSha256") != sha256_bytes(endpoint_raw)
        or endpoint_verdict.get("verifiedResultCommit") != endpoint_commit
    ):
        raise EndpointError("result chain detached from the DB-verified endpoint snapshot")


def verify_analysis_chain(
    analysis_path: Path,
    endpoint_path: Path,
    endpoint_ledger_path: Path,
    database: Path,
    authorization: Path,
) -> tuple[dict[str, Any], bytes, str, dict[str, bytes], dict[str, str]]:
    authorization_before = validate_endpoint_authorization(
        authorization, require_current_head=False
    )
    endpoint_verdict = verify_endpoint(endpoint_path, database, authorization)
    bindings = [
        (endpoint_path, "ENDPOINT"),
        (endpoint_ledger_path, "ENDPOINT_LEDGER"),
        (analysis_path, "ANALYSIS"),
    ]
    snapshot_head, snapshots, snapshot_commits = require_stable_remote_snapshots(
        bindings, authorization_before["authorizationCommit"]
    )
    require_verified_endpoint_snapshot(
        endpoint_verdict,
        snapshot_head,
        snapshots["ENDPOINT"],
        snapshot_commits["ENDPOINT"],
    )
    analysis, raw = validate_analysis(
        analysis_path,
        endpoint_path,
        endpoint_ledger_path,
        raw_snapshot=snapshots["ANALYSIS"],
        endpoint_raw_snapshot=snapshots["ENDPOINT"],
        endpoint_ledger_raw_snapshot=snapshots["ENDPOINT_LEDGER"],
    )
    final_head, final_snapshots, final_commits = require_stable_remote_snapshots(
        bindings, authorization_before["authorizationCommit"]
    )
    if (
        final_head != snapshot_head
        or final_snapshots != snapshots
        or final_commits != snapshot_commits
    ):
        raise EndpointError("analysis result chain changed during verification")
    return analysis, raw, snapshot_head, snapshots, snapshot_commits


def verify_analysis_ledger_chain(
    ledger_path: Path,
    analysis_path: Path,
    endpoint_path: Path,
    endpoint_ledger_path: Path,
    database: Path,
    authorization: Path,
) -> tuple[dict[str, Any], bytes]:
    _, _, verified_head, verified_snapshots, verified_commits = verify_analysis_chain(
        analysis_path, endpoint_path, endpoint_ledger_path, database, authorization
    )
    bindings = [
        (endpoint_path, "ENDPOINT"),
        (endpoint_ledger_path, "ENDPOINT_LEDGER"),
        (analysis_path, "ANALYSIS"),
        (ledger_path, "ANALYSIS_LEDGER"),
    ]
    authorization_state = validate_endpoint_authorization(
        authorization, require_current_head=False
    )
    snapshot_head, snapshots, snapshot_commits = require_stable_remote_snapshots(
        bindings, authorization_state["authorizationCommit"]
    )
    if (
        snapshot_head != verified_head
        or any(snapshots[role] != verified_snapshots[role] for role in verified_snapshots)
        or any(snapshot_commits[role] != verified_commits[role] for role in verified_commits)
    ):
        raise EndpointError("analysis-ledger chain detached from the verified analysis snapshots")
    ledger, raw = validate_analysis_ledger(
        ledger_path,
        analysis_path,
        endpoint_path,
        endpoint_ledger_path,
        raw_snapshot=snapshots["ANALYSIS_LEDGER"],
        analysis_raw_snapshot=snapshots["ANALYSIS"],
        endpoint_raw_snapshot=snapshots["ENDPOINT"],
        endpoint_ledger_raw_snapshot=snapshots["ENDPOINT_LEDGER"],
    )
    final_head, final_snapshots, final_commits = require_stable_remote_snapshots(
        bindings, authorization_state["authorizationCommit"]
    )
    if (
        final_head != snapshot_head
        or final_snapshots != snapshots
        or final_commits != snapshot_commits
    ):
        raise EndpointError("analysis-ledger result chain changed during verification")
    return ledger, raw


def make_synthetic_exposure_row(exposure: str = "TRIGGER_POSITIVE") -> dict[str, Any]:
    values = ["120", "110", "105", "100", "100", "95", "90", "85", "80"]
    quarters = []
    fy, fq = 2014, 1
    dates = [20140331, 20131231, 20130930, 20130630, 20130331, 20121231, 20120930, 20120630, 20120331]
    for index, (period, value) in enumerate(zip(dates, values)):
        ordinal = fy * 4 + fq - 1 - index
        qfy, qfq0 = divmod(ordinal, 4)
        quarters.append({
            "periodEnd": str(period), "value": value, "concept": "Revenues",
            "fiscalYear": qfy, "fiscalQuarter": qfq0 + 1, "derivation": "DIRECT_QTRS1",
            "sourceRefs": [],
        })
    return {
        "cik": "0000000001", "name": "SYNTHETIC", "sic": 1, "status": "ELIGIBLE",
        "anchorPeriodEnd": "20140331", "exposure": exposure,
        "currentRevenueYoy": "0.2", "previousFourRevenueYoyMedian": "0",
        "revenueYoyAcceleration": "0.2", "lastFourQuarterOperatingCashFlow": "1",
        "quarterlyRevenue": quarters, "quarterlyOperatingCashFlow": [],
    }


def make_future_item(step: int, value: str, verified: bool = True) -> dict[str, Any]:
    ordinal = 2014 * 4 + 1 - 1 + step
    fy, fq0 = divmod(ordinal, 4)
    if not verified:
        return unresolved_slot(step, fy, fq0 + 1, "MISSING_OR_AMBIGUOUS_FUTURE_QUARTER")
    comparison = [None, (3, "100", "20130630"), (2, "105", "20130930"), (1, "110", "20131231"), (0, "120", "20140331")][step]
    yoy = Decimal(value) / Decimal(comparison[1]) - 1
    return {
        "step": step, "expectedFiscalYear": fy, "expectedFiscalQuarter": fq0 + 1,
        "status": "VERIFIED", "periodEnd": [None, "20140630", "20140930", "20141231", "20150331"][step],
        "value": value, "concept": "Revenues", "derivation": "DIRECT_QTRS1",
        "sourceRefs": [], "frozenComparisonIndex": comparison[0],
        "frozenComparisonPeriodEnd": comparison[2], "frozenComparisonValue": comparison[1],
        "revenueYoy": BASE.decimal_text(yoy), "meetsThreshold": yoy >= MIN_REVENUE_YOY,
    }


def synthetic_state(slots: list[dict[str, Any]]) -> str:
    if any(slot["status"] != "VERIFIED" for slot in slots):
        return "NO_VERIFIABLE_4Q_SEQUENCE"
    return "VERIFIED_PERSISTENT" if sum(slot["meetsThreshold"] for slot in slots) >= 3 else "VERIFIED_NOT_PERSISTENT"


def make_audit(role: str) -> dict[str, Any]:
    value = {
        "schema": AUDIT_SCHEMA, "protocol": PROTOCOL, "role": role, "status": "PASS",
        "reviewerType": "CODEX_AGENT", "agentId": f"agent-{role}", "runId": f"run-{role}",
        "completedAt": "2026-08-12T06:00:00Z", "blockingFindings": [],
        "humanAttestation": False, "outcomesAccessed": False, "postAnchorFactsRead": False,
        **audit_bindings(), "counts": dict(COUNTS), "checks": list(ROLE_CHECKS[role]),
    }
    value["auditSha256"] = canonical_sha256(value)
    return value


def self_test() -> dict[str, Any]:
    slots_three_plus_missing = [
        make_future_item(1, "120"), make_future_item(2, "126"),
        make_future_item(3, "132"), make_future_item(4, "144", verified=False),
    ]
    slots_three_pass = [
        make_future_item(1, "120"), make_future_item(2, "126"),
        make_future_item(3, "132"), make_future_item(4, "144"),
    ]
    slots_two_pass = [
        make_future_item(1, "120"), make_future_item(2, "126"),
        make_future_item(3, "110"), make_future_item(4, "120"),
    ]
    if synthetic_state(slots_three_plus_missing) != "NO_VERIFIABLE_4Q_SEQUENCE":
        raise EndpointError("three passing quarters plus missing did not fail closed")
    if synthetic_state(slots_three_pass) != "VERIFIED_PERSISTENT":
        raise EndpointError("three of four passing quarters did not persist")
    if synthetic_state(slots_two_pass) != "VERIFIED_NOT_PERSISTENT":
        raise EndpointError("two of four passing quarters did not classify negative")
    exact = Decimal("120") / Decimal("100") - 1
    below = Decimal("119.999999999999999999") / Decimal("100") - 1
    if not exact >= MIN_REVENUE_YOY or below >= MIN_REVENUE_YOY:
        raise EndpointError("exact Decimal threshold failed")
    difference, lower, upper = newcombe_method_10(30, 50, 20, 100)
    oracle = (
        display_decimal(difference) == "0.400000000000000000"
        and display_decimal(lower) == "0.235726183059041188"
        and display_decimal(upper) == "0.540695295164522902"
    )
    if not oracle:
        raise EndpointError("Newcombe Method 10 oracle changed")
    audits = {role: make_audit(role) for role in ROLE_CHECKS}
    for role, value in audits.items():
        validate_audit(value, role)
    broken = dict(audits["METHOD"])
    broken["outcomesAccessed"] = True
    broken["auditSha256"] = unsigned_sha256(broken, "auditSha256")
    try:
        validate_audit(broken, "METHOD")
        audit_unlock_rejected = False
    except EndpointError:
        audit_unlock_rejected = True
    if not audit_unlock_rejected:
        raise EndpointError("audit outcome unlock was accepted")
    cutoff_boundaries = []
    for accepted in (CUTOFF_EPOCH, CUTOFF_EPOCH + 1, ENDPOINT_CUTOFF_EPOCH, ENDPOINT_CUTOFF_EPOCH + 1):
        row = {
            "acceptedAtEpoch": accepted, "form": "10-Q", "filingPeriodEnd": 20140630,
            "periodEnd": 20140630,
        }
        try:
            validate_future_row(row)
            cutoff_boundaries.append(True)
        except EndpointError:
            cutoff_boundaries.append(False)
    if cutoff_boundaries != [False, True, True, False]:
        raise EndpointError("exclusive-inclusive endpoint boundaries changed")
    amendment = {
        "acceptedAtEpoch": CUTOFF_EPOCH + 1, "form": "10-Q/A",
        "filingPeriodEnd": 20140630, "periodEnd": 20140630,
    }
    comparative = {
        "acceptedAtEpoch": CUTOFF_EPOCH + 1, "form": "10-Q",
        "filingPeriodEnd": 20140630, "periodEnd": 20140331,
    }
    try:
        validate_future_row(amendment)
        amendment_rejected = False
    except EndpointError:
        amendment_rejected = True
    try:
        validate_future_row(comparative)
        comparative_rejected = False
    except EndpointError:
        comparative_rejected = True
    if not amendment_rejected or not comparative_rejected:
        raise EndpointError("amendment/comparative endpoint source was accepted")
    synthetic_ordinal = 2014 * 4 + 2 - 1
    resolved_candidate = (20140701, {"value": Decimal("122")})
    selected, ambiguity_reason = select_fiscal_slot(
        {synthetic_ordinal: [resolved_candidate]},
        {synthetic_ordinal},
        synthetic_ordinal,
    )
    if selected is not None or ambiguity_reason != "AMBIGUOUS_FISCAL_SLOT":
        raise EndpointError("ambiguous fiscal slot was hidden by a resolved period")
    selected, duplicate_reason = select_fiscal_slot(
        {synthetic_ordinal: [resolved_candidate, (20140630, {"value": Decimal("120")})]},
        set(),
        synthetic_ordinal,
    )
    if selected is not None or duplicate_reason != "DUPLICATE_FISCAL_SLOT":
        raise EndpointError("duplicate fiscal slot was accepted")
    valid_commits = {
        "ENDPOINT": "1" * 40,
        "ENDPOINT_LEDGER": "2" * 40,
        "ANALYSIS": "3" * 40,
        "ANALYSIS_LEDGER": "4" * 40,
    }
    valid_parents = {
        "1" * 40: "a" * 40,
        "2" * 40: "1" * 40,
        "3" * 40: "2" * 40,
        "4" * 40: "3" * 40,
    }
    validate_result_commit_lineage(
        valid_commits,
        "a" * 40,
        synthetic_parent_lookup(valid_parents),
    )
    try:
        validate_result_commit_lineage(
            valid_commits,
            "a" * 40,
            synthetic_parent_lookup({commit: "a" * 40 for commit in valid_parents}),
        )
        same_commit_stage_bypass_rejected = False
    except EndpointError:
        same_commit_stage_bypass_rejected = True
    if not same_commit_stage_bypass_rejected:
        raise EndpointError("same-parent result stages bypassed the remote state machine")
    merge_parents = dict(valid_parents)
    merge_parents["2" * 40] = ["1" * 40, "b" * 40]
    try:
        validate_result_commit_lineage(
            valid_commits,
            "a" * 40,
            synthetic_parent_lookup(merge_parents),
        )
        merge_checkpoint_rejected = False
    except EndpointError:
        merge_checkpoint_rejected = True
    if not merge_checkpoint_rejected:
        raise EndpointError("merge commit was accepted as a direct result checkpoint")
    try:
        validate_result_stage_contents(
            {"ENDPOINT": "1" * 40},
            lambda _commit, result_path: result_path == RESULT_PATHS["ANALYSIS"],
        )
        future_result_piggyback_rejected = False
    except EndpointError:
        future_result_piggyback_rejected = True
    if not future_result_piggyback_rejected:
        raise EndpointError("endpoint commit carried an unauthorized future result")
    try:
        require_verified_endpoint_snapshot(
            {
                "verifiedRemoteHead": "h" * 40,
                "verifiedRawSha256": sha256_bytes(b"A"),
                "verifiedResultCommit": "1" * 40,
            },
            "h" * 40,
            b"B",
            "1" * 40,
        )
        endpoint_snapshot_drift_rejected = False
    except EndpointError:
        endpoint_snapshot_drift_rejected = True
    if not endpoint_snapshot_drift_rejected:
        raise EndpointError("analysis accepted a different endpoint snapshot")
    try:
        require_result_path(Path("side-result.json"), "ENDPOINT")
        side_result_path_rejected = False
    except EndpointError:
        side_result_path_rejected = True
    if not side_result_path_rejected:
        raise EndpointError("side-path result was accepted")
    try:
        require_fixed_repo_path(
            Path("side-authorization.json"),
            ENDPOINT_AUTHORIZATION_PATH,
            "endpoint authorization",
        )
        side_authorization_path_rejected = False
    except EndpointError:
        side_authorization_path_rejected = True
    try:
        require_fixed_repo_path(
            Path("side-seal.json"),
            ENDPOINT_SEAL_PATH,
            "endpoint seal",
        )
        side_seal_path_rejected = False
    except EndpointError:
        side_seal_path_rejected = True
    if not side_authorization_path_rejected or not side_seal_path_rejected:
        raise EndpointError("side-path checkpoint was accepted")
    try:
        validate_preoutcome_result_absence(
            ["stage-a", "seal", "authorization"],
            lambda commit, result_path: (
                commit == "stage-a" and result_path == RESULT_PATHS["ENDPOINT"]
            ),
        )
        preoutcome_result_history_rejected = False
    except EndpointError:
        preoutcome_result_history_rejected = True
    if not preoutcome_result_history_rejected:
        raise EndpointError("pre-outcome history carried a transient result")
    exact_ascertainment = 90 * 10 >= 100 * 9
    below_ascertainment = 89 * 10 >= 100 * 9
    exact_difference = abs(90 * 100 - 80 * 100) * 10 <= 100 * 100
    above_difference = abs(90 * 100 - 79 * 100) * 10 <= 100 * 100
    if not exact_ascertainment or below_ascertainment or not exact_difference or above_difference:
        raise EndpointError("exact ascertainment gates changed")
    result = {
        "status": "PASS",
        "threePassPlusMissingFailsClosed": True,
        "threeOfFourPersistent": True,
        "twoOfFourNotPersistent": True,
        "exactTwentyPercentPasses": True,
        "belowTwentyPercentFails": True,
        "newcombeMethod10OraclePass": True,
        "fullCohortDenominatorPreserved": (20, 40),
        "auditOutcomeUnlockRejected": True,
        "endpointAcceptanceBoundariesPass": True,
        "amendmentRejected": True,
        "comparativeFactRejected": True,
        "ambiguousFiscalSlotFailsClosed": True,
        "duplicateFiscalSlotFailsClosed": True,
        "sameCommitStageBypassRejected": True,
        "mergeCheckpointRejected": True,
        "futureResultPiggybackRejected": True,
        "endpointSnapshotDriftRejected": True,
        "sideResultPathRejected": True,
        "sideAuthorizationPathRejected": True,
        "sideSealPathRejected": True,
        "preoutcomeResultHistoryRejected": True,
        "exactAscertainmentGatesPass": True,
        "postCutoffFactsRead": False,
        "outcomesAccessed": False,
    }
    return result


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("self-test")
    checkpoint = sub.add_parser("verify-checkpoint")
    checkpoint.add_argument("--authorization", required=True, type=Path)
    endpoint = sub.add_parser("endpoint")
    endpoint.add_argument("--database", required=True, type=Path)
    endpoint.add_argument("--exposure", required=True, type=Path)
    endpoint.add_argument("--authorization", required=True, type=Path)
    endpoint.add_argument("--output", required=True, type=Path)
    verify = sub.add_parser("verify-endpoint")
    verify.add_argument("--input", required=True, type=Path)
    verify.add_argument("--database", required=True, type=Path)
    verify.add_argument("--authorization", required=True, type=Path)
    transition = sub.add_parser("transition-endpoint-ledger")
    transition.add_argument("--endpoint", required=True, type=Path)
    transition.add_argument("--database", required=True, type=Path)
    transition.add_argument("--authorization", required=True, type=Path)
    transition.add_argument("--output", required=True, type=Path)
    analyze = sub.add_parser("analyze-endpoint")
    analyze.add_argument("--endpoint", required=True, type=Path)
    analyze.add_argument("--endpoint-ledger", required=True, type=Path)
    analyze.add_argument("--database", required=True, type=Path)
    analyze.add_argument("--authorization", required=True, type=Path)
    analyze.add_argument("--output", required=True, type=Path)
    verify_analysis_parser = sub.add_parser("verify-analysis")
    verify_analysis_parser.add_argument("--input", required=True, type=Path)
    verify_analysis_parser.add_argument("--endpoint", required=True, type=Path)
    verify_analysis_parser.add_argument("--endpoint-ledger", required=True, type=Path)
    verify_analysis_parser.add_argument("--database", required=True, type=Path)
    verify_analysis_parser.add_argument("--authorization", required=True, type=Path)
    final_ledger = sub.add_parser("transition-analysis-ledger")
    final_ledger.add_argument("--analysis", required=True, type=Path)
    final_ledger.add_argument("--endpoint", required=True, type=Path)
    final_ledger.add_argument("--endpoint-ledger", required=True, type=Path)
    final_ledger.add_argument("--database", required=True, type=Path)
    final_ledger.add_argument("--authorization", required=True, type=Path)
    final_ledger.add_argument("--output", required=True, type=Path)
    verify_final_ledger = sub.add_parser("verify-analysis-ledger")
    verify_final_ledger.add_argument("--input", required=True, type=Path)
    verify_final_ledger.add_argument("--analysis", required=True, type=Path)
    verify_final_ledger.add_argument("--endpoint", required=True, type=Path)
    verify_final_ledger.add_argument("--endpoint-ledger", required=True, type=Path)
    verify_final_ledger.add_argument("--database", required=True, type=Path)
    verify_final_ledger.add_argument("--authorization", required=True, type=Path)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.command == "self-test":
        print(json.dumps(self_test(), indent=2))
    elif args.command == "verify-checkpoint":
        value = validate_endpoint_authorization(args.authorization)
        print(json.dumps({"status": "PASS", **value}, indent=2))
    elif args.command == "endpoint":
        require_result_path(args.output, "ENDPOINT")
        write_new(args.output, build_endpoint(args.database, args.exposure, args.authorization))
        print(json.dumps({"status": "PASS", "output": str(args.output.resolve())}))
    elif args.command == "verify-endpoint":
        print(json.dumps(verify_endpoint(args.input, args.database, args.authorization), indent=2))
    elif args.command == "transition-endpoint-ledger":
        require_result_path(args.endpoint, "ENDPOINT")
        require_result_path(args.output, "ENDPOINT_LEDGER")
        endpoint_verdict = verify_endpoint(args.endpoint, args.database, args.authorization)
        endpoint_head, endpoint_raw, endpoint_commit = require_remote_result_bound(
            args.endpoint, "ENDPOINT"
        )
        require_verified_endpoint_snapshot(
            endpoint_verdict, endpoint_head, endpoint_raw, endpoint_commit
        )
        write_new(
            args.output,
            build_endpoint_ledger(
                args.endpoint,
                args.authorization,
                endpoint_raw_snapshot=endpoint_raw,
            ),
        )
        print(json.dumps({"status": "PASS", "output": str(args.output.resolve())}))
    elif args.command == "analyze-endpoint":
        require_result_path(args.endpoint, "ENDPOINT")
        require_result_path(args.endpoint_ledger, "ENDPOINT_LEDGER")
        require_result_path(args.output, "ANALYSIS")
        endpoint_verdict = verify_endpoint(args.endpoint, args.database, args.authorization)
        authorization_state = validate_endpoint_authorization(
            args.authorization, require_current_head=False
        )
        snapshot_head, snapshots, snapshot_commits = require_stable_remote_snapshots([
            (args.endpoint, "ENDPOINT"),
            (args.endpoint_ledger, "ENDPOINT_LEDGER"),
        ], authorization_state["authorizationCommit"])
        require_verified_endpoint_snapshot(
            endpoint_verdict,
            snapshot_head,
            snapshots["ENDPOINT"],
            snapshot_commits["ENDPOINT"],
        )
        write_new(
            args.output,
            build_analysis(
                args.endpoint,
                args.endpoint_ledger,
                endpoint_raw_snapshot=snapshots["ENDPOINT"],
                endpoint_ledger_raw_snapshot=snapshots["ENDPOINT_LEDGER"],
            ),
        )
        print(json.dumps({"status": "PASS", "output": str(args.output.resolve())}))
    elif args.command == "verify-analysis":
        value, raw, _, _, _ = verify_analysis_chain(
            args.input,
            args.endpoint,
            args.endpoint_ledger,
            args.database,
            args.authorization,
        )
        print(json.dumps({"status": "PASS", "rawSha256": sha256_bytes(raw), "reportSha256": value["reportSha256"]}, indent=2))
    elif args.command == "transition-analysis-ledger":
        require_result_path(args.endpoint, "ENDPOINT")
        require_result_path(args.endpoint_ledger, "ENDPOINT_LEDGER")
        require_result_path(args.analysis, "ANALYSIS")
        require_result_path(args.output, "ANALYSIS_LEDGER")
        _, _, verified_head, verified_snapshots, verified_commits = verify_analysis_chain(
            args.analysis,
            args.endpoint,
            args.endpoint_ledger,
            args.database,
            args.authorization,
        )
        authorization_state = validate_endpoint_authorization(
            args.authorization, require_current_head=False
        )
        snapshot_head, snapshots, snapshot_commits = require_stable_remote_snapshots([
            (args.endpoint, "ENDPOINT"),
            (args.endpoint_ledger, "ENDPOINT_LEDGER"),
            (args.analysis, "ANALYSIS"),
        ], authorization_state["authorizationCommit"])
        if (
            snapshot_head != verified_head
            or snapshots != verified_snapshots
            or snapshot_commits != verified_commits
        ):
            raise EndpointError("analysis-ledger transition detached from verified snapshots")
        write_new(
            args.output,
            build_analysis_ledger(
                args.analysis,
                args.endpoint,
                args.endpoint_ledger,
                analysis_raw_snapshot=snapshots["ANALYSIS"],
                endpoint_raw_snapshot=snapshots["ENDPOINT"],
                endpoint_ledger_raw_snapshot=snapshots["ENDPOINT_LEDGER"],
            ),
        )
        print(json.dumps({"status": "PASS", "output": str(args.output.resolve())}))
    elif args.command == "verify-analysis-ledger":
        value, raw = verify_analysis_ledger_chain(
            args.input,
            args.analysis,
            args.endpoint,
            args.endpoint_ledger,
            args.database,
            args.authorization,
        )
        print(json.dumps({"status": "PASS", "rawSha256": sha256_bytes(raw), "ledgerSha256": value["ledgerSha256"]}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

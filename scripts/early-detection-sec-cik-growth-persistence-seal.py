#!/usr/bin/env python3
"""Fail-closed audit, seal, and remote-checkpoint verifier for the SEC CIK study.

This verifier is intentionally separate from the frozen exposure selector.  It
does not read post-cutoff facts or outcomes.  It validates only pre-outcome
artifacts, Git blobs, and remote ancestry.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


PROTOCOL = "SEC-CIK-GROWTH-PERSISTENCE@1.0.0"
AUDIT_SCHEMA = "sec-cik-growth-persistence-ai-audit/v2"
SEAL_SCHEMA = "sec-cik-growth-persistence-preoutcome-seal/v2"
AUTH_SCHEMA = "sec-cik-growth-persistence-remote-authorization/v2"
REMOTE = "origin"
REMOTE_URL = "https://github.com/Karlryl/screener-data.git"
REMOTE_REF = "refs/heads/codex/early-detection-v4-gates-20260810"
SEAL_PATH = "reports/early-detection/sec-cik-growth-persistence-preoutcome-seal-v2.json"
HEX64_RE = re.compile(r"^[0-9a-f]{64}$")
HEX40_RE = re.compile(r"^[0-9a-f]{40}$")

ROOT = Path(__file__).resolve().parents[1]

PATHS = {
    "SCOPE": "reports/early-detection/sec-cik-growth-persistence-scope-v1.md",
    "CLAIM_CONTRACT": "reports/early-detection/sec-cik-growth-persistence-claim-contract-v1.json",
    "SELECTOR": "scripts/early-detection-sec-cik-growth-persistence.py",
    "SELECTOR_TEST": "tests/early-detection-sec-cik-growth-persistence.test.js",
    "SOURCE_LINE": "reports/early-detection/sec-cik-growth-persistence-source-line-v2.json",
    "DATABASE_ATTESTATION": "reports/early-detection/sec-cik-growth-persistence-database-attestation-v1.json",
    "EXPOSURE": "reports/early-detection/sec-cik-growth-persistence-exposure-v3.json",
    "OUTCOME_LEDGER": "reports/early-detection/sec-cik-growth-persistence-outcome-ledger-v1.json",
    "CHECKPOINT_VALIDATOR": "scripts/early-detection-sec-cik-growth-persistence-seal.py",
    "CHECKPOINT_TEST": "tests/early-detection-sec-cik-growth-persistence-seal.test.js",
    "AI_AUDIT_METHOD": "reports/early-detection/sec-cik-growth-persistence-ai-audit-method-v2.json",
    "AI_AUDIT_DATA": "reports/early-detection/sec-cik-growth-persistence-ai-audit-data-v2.json",
    "AI_AUDIT_COUNTEREXAMPLE": "reports/early-detection/sec-cik-growth-persistence-ai-audit-counterexample-v2.json",
}

FIXED_HASHES = {
    "SCOPE": "d8bc4bcc6ebbc5c8d1f5bbaa6af1ac8ac8b6380a1656483bdcd168b1600765fa",
    "CLAIM_CONTRACT": "3212d024e9c82dfb8ea2702ca781351e5a2e5c773d97d534ba8c445a2926a388",
    "SELECTOR": "e07bc9316c5c492ef13c684b9cf1d619860f9d997597606ba2807a4b26b7fd3a",
    "SELECTOR_TEST": "30a3c79a51711cb0e65a1f4e3818200167b11097c5b02a253621fabffde07398",
    "SOURCE_LINE": "9898fbcf2fddb9f8716cf7a9a15a87f528ef9752d1008856cee979608ce472c9",
    "DATABASE_ATTESTATION": "9a09b8b495f5cc9d2623d64ca425992b4b05801a0b57a83ef24adee434f13cdf",
    "EXPOSURE": "9632586d332ad9a67a4c12e10f9716da9e533330e1b573506b738dd60eb75c7a",
    "OUTCOME_LEDGER": "02b79914b07ff3c08f05d490df701f95a2df7dcdb7702b139fb12bb0a6a090dd",
}

EXPOSURE_REPORT_SHA256 = "5dbb2ecb17101a6e8f66eecc1d0890a4921c6d66342985db5a89c8575aab603a"
COUNTS = {
    "candidateCiks": 9431,
    "eligibleCiks": 770,
    "triggerPositive": 72,
    "triggerNegative": 698,
    "sourceRefs": 13954,
}

ROLE_CHECKS = {
    "METHOD": [
        "METHOD_CONTRACT_CONSISTENT",
        "EXPOSURE_SEMANTICS_RECOMPUTED",
        "CLAIM_LOCKS_CLOSED",
        "OUTCOME_BARRIER_CLOSED",
        "ADVERSARIAL_TESTS_PASS",
    ],
    "DATA": [
        "DATABASE_DOUBLE_SHA_PASS",
        "DATABASE_IDENTITY_STABLE",
        "SOURCE_PAYLOAD_PARITY_PASS",
        "ALL_ELIGIBLE_ROWS_RECOMPUTED",
        "ALL_SOURCE_REFS_PRECUTOFF",
        "OUTCOME_BARRIER_CLOSED",
    ],
    "COUNTEREXAMPLE": [
        "CONCEPT_PRIORITY_ATTACKS_REJECTED",
        "REVISION_CONFLICT_REJECTED",
        "DATABASE_INTERPOSITION_REJECTED",
        "REHASHED_OUTPUT_TAMPER_REJECTED",
        "DETERMINISTIC_REBUILD_PASS",
        "OUTCOME_BARRIER_CLOSED",
    ],
}

AUDIT_KEYS = {
    "schema",
    "protocol",
    "role",
    "status",
    "reviewerType",
    "agentId",
    "runId",
    "completedAt",
    "blockingFindings",
    "humanAttestation",
    "outcomesAccessed",
    "postAnchorFactsRead",
    "selectorSha256",
    "testSha256",
    "scopeSha256",
    "claimContractSha256",
    "sourceLineSha256",
    "databaseAttestationSha256",
    "exposureFileSha256",
    "exposureReportSha256",
    "counts",
    "checks",
    "auditSha256",
}

AUDIT_BINDINGS = {
    "selectorSha256": FIXED_HASHES["SELECTOR"],
    "testSha256": FIXED_HASHES["SELECTOR_TEST"],
    "scopeSha256": FIXED_HASHES["SCOPE"],
    "claimContractSha256": FIXED_HASHES["CLAIM_CONTRACT"],
    "sourceLineSha256": FIXED_HASHES["SOURCE_LINE"],
    "databaseAttestationSha256": FIXED_HASHES["DATABASE_ATTESTATION"],
    "exposureFileSha256": FIXED_HASHES["EXPOSURE"],
    "exposureReportSha256": EXPOSURE_REPORT_SHA256,
}

SEAL_KEYS = {
    "schema",
    "protocol",
    "status",
    "sealedAt",
    "stageACommit",
    "artifacts",
    "exposureReportSha256",
    "outcomesAccessed",
    "postAnchorFactsRead",
    "postAnchorFactsMaterialized",
    "analysisExecuted",
    "humanAttestation",
    "aiAuditOnly",
}
ARTIFACT_KEYS = {"role", "path", "sha256"}

AUTH_KEYS = {
    "schema",
    "protocol",
    "status",
    "createdAt",
    "authorizationRemote",
    "authorizationRemoteUrl",
    "authorizationRef",
    "stageACommit",
    "sealCommit",
    "sealPath",
    "sealSha256",
    "outcomeLedgerPath",
    "outcomeLedgerSha256",
    "outcomesAccessed",
    "postAnchorFactsRead",
    "postAnchorFactsMaterialized",
    "analysisExecuted",
    "humanAttestation",
    "aiAuditOnly",
}


class CheckpointError(RuntimeError):
    pass


def canonical_bytes(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_json_bytes(data: bytes, label: str) -> dict[str, Any]:
    try:
        parsed = json.loads(data.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise CheckpointError(f"{label} is not canonical UTF-8 JSON") from exc
    if not isinstance(parsed, dict):
        raise CheckpointError(f"{label} must be an object")
    return parsed


def load_json(path: Path, label: str) -> dict[str, Any]:
    return load_json_bytes(path.read_bytes(), label)


def require_exact_keys(value: dict[str, Any], expected: set[str], label: str) -> None:
    actual = set(value)
    if actual != expected:
        missing = sorted(expected - actual)
        extra = sorted(actual - expected)
        raise CheckpointError(f"{label} keys differ; missing={missing}, extra={extra}")


def parse_z_time(value: Any, label: str) -> datetime:
    if not isinstance(value, str) or not value.endswith("Z"):
        raise CheckpointError(f"{label} must be an ISO-8601 Z timestamp")
    try:
        parsed = datetime.fromisoformat(value[:-1] + "+00:00")
    except ValueError as exc:
        raise CheckpointError(f"{label} is not a valid timestamp") from exc
    if parsed.tzinfo != timezone.utc:
        raise CheckpointError(f"{label} must be UTC")
    return parsed


def run_git(args: list[str], *, check: bool = True) -> bytes:
    completed = subprocess.run(
        ["git", *args],
        cwd=ROOT,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    if check and completed.returncode != 0:
        detail = completed.stderr.decode("utf-8", errors="replace").strip()
        raise CheckpointError(f"git {' '.join(args)} failed: {detail}")
    return completed.stdout


def local_path_from_cli(path: Path) -> Path:
    return path if path.is_absolute() else ROOT / path


def git_blob(commit: str, path: str) -> bytes:
    return run_git(["show", f"{commit}:{path}"])


def require_false_locks(value: dict[str, Any], label: str) -> None:
    for key in (
        "outcomesAccessed",
        "postAnchorFactsRead",
        "postAnchorFactsMaterialized",
        "analysisExecuted",
        "humanAttestation",
    ):
        if value.get(key) is not False:
            raise CheckpointError(f"{label}.{key} must be false")
    if value.get("aiAuditOnly") is not True:
        raise CheckpointError(f"{label}.aiAuditOnly must be true")


def validate_audit_object(value: dict[str, Any], expected_role: str, label: str) -> dict[str, Any]:
    require_exact_keys(value, AUDIT_KEYS, label)
    if value["schema"] != AUDIT_SCHEMA or value["protocol"] != PROTOCOL:
        raise CheckpointError(f"{label} schema/protocol mismatch")
    if value["role"] != expected_role or expected_role not in ROLE_CHECKS:
        raise CheckpointError(f"{label} role mismatch")
    if value["status"] != "PASS" or value["reviewerType"] != "CODEX_AGENT":
        raise CheckpointError(f"{label} is not a passing Codex-agent audit")
    if not isinstance(value["agentId"], str) or not value["agentId"].strip():
        raise CheckpointError(f"{label}.agentId is empty")
    if not isinstance(value["runId"], str) or not value["runId"].strip():
        raise CheckpointError(f"{label}.runId is empty")
    parse_z_time(value["completedAt"], f"{label}.completedAt")
    if value["blockingFindings"] != []:
        raise CheckpointError(f"{label} has blocking findings")
    for key in ("humanAttestation", "outcomesAccessed", "postAnchorFactsRead"):
        if value[key] is not False:
            raise CheckpointError(f"{label}.{key} must be false")
    for key, expected in AUDIT_BINDINGS.items():
        if value[key] != expected:
            raise CheckpointError(f"{label}.{key} binding mismatch")
    if value["counts"] != COUNTS:
        raise CheckpointError(f"{label}.counts mismatch")
    if value["checks"] != ROLE_CHECKS[expected_role]:
        raise CheckpointError(f"{label}.checks mismatch")
    if not isinstance(value["auditSha256"], str) or not HEX64_RE.fullmatch(value["auditSha256"]):
        raise CheckpointError(f"{label}.auditSha256 is malformed")
    unsigned = dict(value)
    supplied = unsigned.pop("auditSha256")
    expected_sha = sha256_bytes(canonical_bytes(unsigned))
    if supplied != expected_sha:
        raise CheckpointError(f"{label}.auditSha256 mismatch")
    return value


def validate_audits(paths_by_role: dict[str, Path]) -> dict[str, dict[str, Any]]:
    if set(paths_by_role) != set(ROLE_CHECKS):
        raise CheckpointError("exactly METHOD, DATA, and COUNTEREXAMPLE audits are required")
    resolved = [path.resolve() for path in paths_by_role.values()]
    if len(set(resolved)) != 3:
        raise CheckpointError("audit paths must be distinct")
    validated: dict[str, dict[str, Any]] = {}
    for role, path in paths_by_role.items():
        validated[role] = validate_audit_object(load_json(path, role), role, role)
    agent_ids = [audit["agentId"] for audit in validated.values()]
    run_ids = [audit["runId"] for audit in validated.values()]
    if len(set(agent_ids)) != 3:
        raise CheckpointError("AI audits must have three distinct agentId values")
    if len(set(run_ids)) != 3:
        raise CheckpointError("AI audits must have three distinct runId values")
    return validated


def audit_paths() -> dict[str, Path]:
    return {
        "METHOD": ROOT / PATHS["AI_AUDIT_METHOD"],
        "DATA": ROOT / PATHS["AI_AUDIT_DATA"],
        "COUNTEREXAMPLE": ROOT / PATHS["AI_AUDIT_COUNTEREXAMPLE"],
    }


def expected_artifact_paths() -> dict[str, str]:
    return dict(PATHS)


def validate_seal(path: Path) -> dict[str, Any]:
    seal = load_json(path, "seal")
    require_exact_keys(seal, SEAL_KEYS, "seal")
    if seal["schema"] != SEAL_SCHEMA or seal["protocol"] != PROTOCOL:
        raise CheckpointError("seal schema/protocol mismatch")
    if seal["status"] != "SEALED_PRE_OUTCOME":
        raise CheckpointError("seal status mismatch")
    sealed_at = parse_z_time(seal["sealedAt"], "seal.sealedAt")
    if not isinstance(seal["stageACommit"], str) or not HEX40_RE.fullmatch(seal["stageACommit"]):
        raise CheckpointError("seal.stageACommit is malformed")
    if seal["exposureReportSha256"] != EXPOSURE_REPORT_SHA256:
        raise CheckpointError("seal exposure report binding mismatch")
    require_false_locks(seal, "seal")
    if not isinstance(seal["artifacts"], list):
        raise CheckpointError("seal.artifacts must be a list")
    expected_paths = expected_artifact_paths()
    artifacts: dict[str, dict[str, Any]] = {}
    for index, artifact in enumerate(seal["artifacts"]):
        if not isinstance(artifact, dict):
            raise CheckpointError(f"seal artifact {index} must be an object")
        require_exact_keys(artifact, ARTIFACT_KEYS, f"seal artifact {index}")
        role = artifact["role"]
        if role in artifacts:
            raise CheckpointError(f"duplicate seal artifact role {role}")
        artifacts[role] = artifact
    if set(artifacts) != set(expected_paths):
        raise CheckpointError("seal artifact roles mismatch")
    local_hashes: dict[str, str] = {}
    for role, expected_path in expected_paths.items():
        artifact = artifacts[role]
        if artifact["path"] != expected_path:
            raise CheckpointError(f"seal artifact path mismatch for {role}")
        local_path = ROOT / expected_path
        local_sha = sha256_file(local_path)
        local_hashes[role] = local_sha
        if artifact["sha256"] != local_sha:
            raise CheckpointError(f"seal local SHA mismatch for {role}")
        if role in FIXED_HASHES and local_sha != FIXED_HASHES[role]:
            raise CheckpointError(f"frozen artifact changed for {role}")
        blob = git_blob(seal["stageACommit"], expected_path)
        if sha256_bytes(blob) != local_sha:
            raise CheckpointError(f"Stage-A Git blob mismatch for {role}")
    audits = validate_audits(audit_paths())
    if any(parse_z_time(audit["completedAt"], f"{role}.completedAt") > sealed_at for role, audit in audits.items()):
        raise CheckpointError("seal predates at least one required AI audit")
    for role, expected_path in expected_paths.items():
        if sha256_file(ROOT / expected_path) != local_hashes[role]:
            raise CheckpointError(f"local artifact changed during seal validation for {role}")
    return seal


def validate_authorization(path: Path) -> dict[str, Any]:
    auth_bytes = path.read_bytes()
    auth = load_json_bytes(auth_bytes, "authorization")
    require_exact_keys(auth, AUTH_KEYS, "authorization")
    if auth["schema"] != AUTH_SCHEMA or auth["protocol"] != PROTOCOL:
        raise CheckpointError("authorization schema/protocol mismatch")
    if auth["status"] != "AUTHORIZED_PRE_OUTCOME_REMOTE_CHECKPOINT":
        raise CheckpointError("authorization status mismatch")
    auth_time = parse_z_time(auth["createdAt"], "authorization.createdAt")
    if auth["authorizationRemote"] != REMOTE or auth["authorizationRemoteUrl"] != REMOTE_URL:
        raise CheckpointError("authorization remote mismatch")
    if auth["authorizationRef"] != REMOTE_REF:
        raise CheckpointError("authorization ref mismatch")
    for key in ("stageACommit", "sealCommit"):
        if not isinstance(auth[key], str) or not HEX40_RE.fullmatch(auth[key]):
            raise CheckpointError(f"authorization.{key} is malformed")
    if auth["outcomeLedgerPath"] != PATHS["OUTCOME_LEDGER"]:
        raise CheckpointError("authorization outcome ledger path mismatch")
    if auth["outcomeLedgerSha256"] != FIXED_HASHES["OUTCOME_LEDGER"]:
        raise CheckpointError("authorization outcome ledger SHA mismatch")
    require_false_locks(auth, "authorization")

    if auth["sealPath"] != SEAL_PATH:
        raise CheckpointError("authorization seal path mismatch")
    seal_path = ROOT / auth["sealPath"]
    seal = validate_seal(seal_path)
    if auth["stageACommit"] != seal["stageACommit"]:
        raise CheckpointError("authorization and seal Stage-A commits differ")
    if auth["sealSha256"] != sha256_file(seal_path):
        raise CheckpointError("authorization seal SHA mismatch")
    if auth_time < parse_z_time(seal["sealedAt"], "seal.sealedAt"):
        raise CheckpointError("authorization predates seal")
    seal_blob = git_blob(auth["sealCommit"], auth["sealPath"])
    if seal_blob != seal_path.read_bytes():
        raise CheckpointError("seal commit does not bind exact local seal bytes")

    stage_parent = run_git(["rev-parse", f"{auth['sealCommit']}^"]).decode().strip()
    if stage_parent != auth["stageACommit"]:
        raise CheckpointError("seal commit is not directly based on Stage A")
    head = run_git(["rev-parse", "HEAD"]).decode().strip()
    if run_git(["rev-parse", "HEAD^"]).decode().strip() != auth["sealCommit"]:
        raise CheckpointError("authorization HEAD is not directly based on seal commit")
    remote_line = run_git(["ls-remote", REMOTE, REMOTE_REF]).decode().strip().split()
    if len(remote_line) != 2 or remote_line[0] != head:
        raise CheckpointError("remote ref does not equal local authorization HEAD")
    remote_url = run_git(["remote", "get-url", REMOTE]).decode().strip()
    if remote_url != REMOTE_URL:
        raise CheckpointError("configured origin URL differs from pinned authorization URL")
    auth_blob = git_blob(head, path.relative_to(ROOT).as_posix())
    if auth_blob != auth_bytes:
        raise CheckpointError("remote authorization commit does not bind exact checkpoint bytes")
    ledger_blob = git_blob(head, PATHS["OUTCOME_LEDGER"])
    if sha256_bytes(ledger_blob) != FIXED_HASHES["OUTCOME_LEDGER"]:
        raise CheckpointError("remote HEAD outcome ledger is no longer the sealed empty ledger")
    return auth


def make_audit(role: str, agent_id: str, run_id: str) -> dict[str, Any]:
    value: dict[str, Any] = {
        "schema": AUDIT_SCHEMA,
        "protocol": PROTOCOL,
        "role": role,
        "status": "PASS",
        "reviewerType": "CODEX_AGENT",
        "agentId": agent_id,
        "runId": run_id,
        "completedAt": "2026-08-12T05:00:00Z",
        "blockingFindings": [],
        "humanAttestation": False,
        "outcomesAccessed": False,
        "postAnchorFactsRead": False,
        **AUDIT_BINDINGS,
        "counts": dict(COUNTS),
        "checks": list(ROLE_CHECKS[role]),
    }
    value["auditSha256"] = sha256_bytes(canonical_bytes(value))
    return value


def self_test() -> dict[str, Any]:
    with tempfile.TemporaryDirectory() as temp_dir:
        temp = Path(temp_dir)
        paths: dict[str, Path] = {}
        for role in ROLE_CHECKS:
            path = temp / f"{role.lower()}.json"
            path.write_bytes(canonical_bytes(make_audit(role, f"agent-{role}", f"run-{role}")) + b"\n")
            paths[role] = path
        validate_audits(paths)

        def rejected(mutator: Any, *, rehash: bool = True) -> bool:
            broken_paths: dict[str, Path] = {}
            for role in ROLE_CHECKS:
                value = make_audit(role, f"agent-{role}", f"run-{role}")
                if role == "METHOD":
                    mutator(value)
                    if rehash:
                        value.pop("auditSha256", None)
                        value["auditSha256"] = sha256_bytes(canonical_bytes(value))
                path = temp / f"broken-{role.lower()}.json"
                path.write_bytes(canonical_bytes(value) + b"\n")
                broken_paths[role] = path
            try:
                validate_audits(broken_paths)
            except CheckpointError:
                return True
            return False

        status_rejected = rejected(lambda value: value.__setitem__("status", "FAIL"))
        extra_key_rejected = rejected(lambda value: value.__setitem__("verdict", "PASS"))
        binding_rejected = rejected(lambda value: value.__setitem__("exposureFileSha256", "0" * 64))
        outcome_rejected = rejected(lambda value: value.__setitem__("outcomesAccessed", True))
        self_hash_rejected = rejected(
            lambda value: value.__setitem__("auditSha256", "0" * 64), rehash=False
        )

        duplicate_agent = {role: make_audit(role, "same-agent", f"run-{role}") for role in ROLE_CHECKS}
        duplicate_paths: dict[str, Path] = {}
        for role, value in duplicate_agent.items():
            path = temp / f"duplicate-agent-{role.lower()}.json"
            path.write_bytes(canonical_bytes(value) + b"\n")
            duplicate_paths[role] = path
        try:
            validate_audits(duplicate_paths)
            duplicate_agent_rejected = False
        except CheckpointError:
            duplicate_agent_rejected = True

    result = {
        "status": "PASS",
        "validAuditSetAccepted": True,
        "statusMutationRejected": status_rejected,
        "schemaDriftRejected": extra_key_rejected,
        "bindingMutationRejected": binding_rejected,
        "outcomeUnlockRejected": outcome_rejected,
        "selfHashMutationRejected": self_hash_rejected,
        "duplicateAgentRejected": duplicate_agent_rejected,
        "outcomesAccessed": False,
    }
    if not all(value is True for key, value in result.items() if key not in {"status", "outcomesAccessed"}):
        raise CheckpointError("self-test did not reject every adversarial mutation")
    return result


def main() -> int:
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser("self-test")
    audit_parser = subparsers.add_parser("verify-audits")
    audit_parser.add_argument("--method", type=Path, required=True)
    audit_parser.add_argument("--data", type=Path, required=True)
    audit_parser.add_argument("--counterexample", type=Path, required=True)
    seal_parser = subparsers.add_parser("verify-seal")
    seal_parser.add_argument("--seal", type=Path, required=True)
    auth_parser = subparsers.add_parser("verify-authorization")
    auth_parser.add_argument("--authorization", type=Path, required=True)
    args = parser.parse_args()
    if args.command == "self-test":
        output = self_test()
    elif args.command == "verify-audits":
        validated = validate_audits(
            {
                "METHOD": local_path_from_cli(args.method),
                "DATA": local_path_from_cli(args.data),
                "COUNTEREXAMPLE": local_path_from_cli(args.counterexample),
            }
        )
        output = {
            "status": "PASS",
            "roles": sorted(validated),
            "agentIds": sorted(audit["agentId"] for audit in validated.values()),
            "runIds": sorted(audit["runId"] for audit in validated.values()),
            "outcomesAccessed": False,
        }
    elif args.command == "verify-seal":
        seal = validate_seal(local_path_from_cli(args.seal).resolve())
        output = {"status": "PASS", "stageACommit": seal["stageACommit"], "outcomesAccessed": False}
    else:
        auth = validate_authorization(local_path_from_cli(args.authorization).resolve())
        output = {
            "status": "PASS",
            "stageACommit": auth["stageACommit"],
            "sealCommit": auth["sealCommit"],
            "remoteRef": auth["authorizationRef"],
            "outcomesAccessed": False,
        }
    print(json.dumps(output, sort_keys=True, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

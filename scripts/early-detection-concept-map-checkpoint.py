#!/usr/bin/env python3
"""Bind the frozen SEC concept map and full-period coverage to authorized Git history."""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


MAP_RELATIVE = "research/early-detection-v4/sec-concept-map-1.0.0.json"
SEAL_RELATIVE = "research/early-detection-v4/sec-concept-map-1.0.0-seal.json"
COVERAGE_RELATIVE = "reports/early-detection/sec-concept-coverage-2009-2024.json"


class ConceptCheckpointError(RuntimeError):
    pass


def canonical_sha256(value: Any) -> str:
    raw = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def normalize_checkout_line_endings(value: bytes) -> bytes:
    return value.replace(b"\r\n", b"\n")


def git_bytes(repository: Path, *arguments: str) -> bytes:
    process = subprocess.run(
        ["git", "-C", str(repository), *arguments],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    if process.returncode != 0:
        raise ConceptCheckpointError(
            f"git {' '.join(arguments)} failed: {process.stderr.decode('utf-8', errors='replace').strip()}"
        )
    return process.stdout


def load_json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8-sig"))
    if not isinstance(value, dict):
        raise ConceptCheckpointError(f"JSON root is not an object: {path}")
    return value


def expected_quarters() -> list[str]:
    return [f"{year}q{quarter}" for year in range(2009, 2025) for quarter in range(1, 5)]


def bind_remote(args: argparse.Namespace) -> dict[str, Any]:
    repository = args.repository.resolve()
    output = args.output.resolve()
    if output.exists():
        raise ConceptCheckpointError("refusing to overwrite output")
    paths = {
        "map": repository / MAP_RELATIVE,
        "seal": repository / SEAL_RELATIVE,
        "coverage": repository / COVERAGE_RELATIVE,
    }
    concept_map = load_json(paths["map"])
    seal = load_json(paths["seal"])
    coverage = load_json(paths["coverage"])
    if concept_map.get("schema") != "early-detection-sec-concept-map/v1":
        raise ConceptCheckpointError("unexpected concept-map schema")
    if concept_map.get("version") != "FEM-SEC-CONCEPT-MAP@1.0.0":
        raise ConceptCheckpointError("unexpected concept-map version")
    if seal.get("schema") != "early-detection-sec-concept-map-seal/v1":
        raise ConceptCheckpointError("unexpected concept-map seal schema")
    map_bytes = normalize_checkout_line_endings(paths["map"].read_bytes())
    if hashlib.sha256(map_bytes).hexdigest() != seal.get("artifact", {}).get("sha256"):
        raise ConceptCheckpointError("concept-map bytes do not match the frozen seal")
    unsigned_coverage = {key: value for key, value in coverage.items() if key != "reportSha256"}
    if canonical_sha256(unsigned_coverage) != coverage.get("reportSha256"):
        raise ConceptCheckpointError("coverage report signature mismatch")
    if coverage.get("scope", {}).get("quarters") != expected_quarters():
        raise ConceptCheckpointError("coverage report does not contain the exact 64-quarter sequence")
    if coverage.get("scope", {}).get("payloads") != 127:
        raise ConceptCheckpointError("coverage report payload count changed")
    if len(coverage.get("roles", [])) != 9 or coverage.get("unresolvedCoverage") != []:
        raise ConceptCheckpointError("concept-map role coverage is incomplete")

    artifact_commit = args.artifact_commit
    remote_commit = git_bytes(repository, "rev-parse", args.remote_ref).decode("ascii").strip()
    ancestor = subprocess.run(
        ["git", "-C", str(repository), "merge-base", "--is-ancestor", artifact_commit, remote_commit],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    if ancestor.returncode != 0:
        raise ConceptCheckpointError("artifact commit is not an ancestor of the authorized remote ref")
    remote_artifacts: dict[str, dict[str, Any]] = {}
    for name, relative in (("map", MAP_RELATIVE), ("seal", SEAL_RELATIVE), ("coverage", COVERAGE_RELATIVE)):
        committed = git_bytes(repository, "show", f"{artifact_commit}:{relative}")
        remote = git_bytes(repository, "show", f"{remote_commit}:{relative}")
        local = paths[name].read_bytes()
        if committed != remote:
            raise ConceptCheckpointError(f"authorized remote changed frozen {name} bytes")
        if normalize_checkout_line_endings(local) != remote:
            raise ConceptCheckpointError(f"local signed {name} differs from authorized remote bytes")
        remote_artifacts[name] = {
            "path": relative,
            "remoteBlobSha256": hashlib.sha256(remote).hexdigest(),
            "localCheckoutSha256": hashlib.sha256(local).hexdigest(),
            "localCheckoutLineEndingsNormalized": local != remote,
            "remoteBytesMatchArtifactCommit": True,
        }

    unsigned: dict[str, Any] = {
        "schema": "early-detection-concept-map-gate-decision/v3",
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
        "protocol": "FEM-SEC-US@1.2.0",
        "gate": "conceptMapFrozen",
        "status": "TECHNICAL_CHECKPOINT_PASS_OFFICIAL_GATE_RED_UNTIL_EXACT_INPUT_AND_SEMANTIC_AUDIT",
        "gatePassed": False,
        "technicalCheckpointPassed": True,
        "verdict": (
            "The frozen map, seal and exact 2009q1-2024q4 coverage are byte-identical on authorized origin/main. "
            "The official gate remains red until a run-bound artifact attests the exact authorized full-input and "
            "conceptMap component hashes and a genuinely independent human semantic audit approves the frozen choices."
        ),
        "remoteBinding": {
            "artifactCommit": artifact_commit,
            "remoteRef": args.remote_ref,
            "remoteCommit": remote_commit,
            "artifactCommitIsRemoteAncestor": True,
            "artifacts": remote_artifacts,
        },
        "coverage": {
            "version": concept_map["version"],
            "sealedAt": seal["sealedAt"],
            "coverageReportSha256": coverage["reportSha256"],
            "quarters": 64,
            "payloads": 127,
            "rolesCovered": 9,
            "unresolvedCoverage": 0,
        },
        "officialGateRequirementsStillMissing": [
            "exactAuthorizedFullInputSha256",
            "runBoundConceptMapComponentSha256",
            "remoteExecutionGateArtifactOnAuthorizedHistory",
            "independentHumanSemanticAudit",
        ],
        "confirmatoryEligible": False,
        "resultComputationAllowed": False,
        "outcomesAccessed": False,
        "productiveGqsModified": False,
    }
    result = {**unsigned, "reportSha256": canonical_sha256(unsigned)}
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return result


def self_test() -> dict[str, Any]:
    if normalize_checkout_line_endings(b"a\r\nb\r\n") != b"a\nb\n":
        raise ConceptCheckpointError("line-ending normalization failed")
    quarters = expected_quarters()
    if quarters[0] != "2009q1" or quarters[-1] != "2024q4" or len(quarters) != 64:
        raise ConceptCheckpointError("quarter-sequence self-test failed")
    unsigned = {"schema": "fixture", "gatePassed": False}
    signed = {**unsigned, "reportSha256": canonical_sha256(unsigned)}
    if canonical_sha256({key: value for key, value in signed.items() if key != "reportSha256"}) != signed["reportSha256"]:
        raise ConceptCheckpointError("signature self-test failed")
    return {"status": "PASS", "quarters": 64, "failClosed": True}


def parser() -> argparse.ArgumentParser:
    value = argparse.ArgumentParser(description=__doc__)
    commands = value.add_subparsers(dest="command", required=True)
    bind = commands.add_parser("bind-remote")
    bind.add_argument("--repository", type=Path, required=True)
    bind.add_argument("--artifact-commit", required=True)
    bind.add_argument("--remote-ref", default="origin/main")
    bind.add_argument("--output", type=Path, required=True)
    commands.add_parser("self-test")
    return value


def main() -> int:
    args = parser().parse_args()
    result = self_test() if args.command == "self-test" else bind_remote(args)
    print(json.dumps({
        "status": result["status"],
        "gate": result.get("gate"),
        "gatePassed": result.get("gatePassed"),
        "technicalCheckpointPassed": result.get("technicalCheckpointPassed"),
        "reportSha256": result.get("reportSha256"),
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
"""Prepare and fail-closed verify the independent human concept-map semantic audit."""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import subprocess
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from typing import Any
from urllib.parse import urlparse


MAP_RELATIVE = "research/early-detection-v4/sec-concept-map-1.0.0.json"
SEAL_RELATIVE = "research/early-detection-v4/sec-concept-map-1.0.0-seal.json"
COVERAGE_RELATIVE = "reports/early-detection/sec-concept-coverage-2009-2024.json"
CHECKPOINT_RELATIVE = "reports/early-detection/concept-map-gate-decision-2026-08-10-v3.json"
FIELDS = [
    "itemId", "scope", "role", "dimension", "frozenValueJson", "requiredPrimaryEvidence",
    "reviewerDecision", "findingSeverity", "evidenceCitation", "reviewerComment",
]
CORE_FIELDS = FIELDS[:6]
DECISIONS = {"APPROVE", "REJECT", "NEEDS_CHANGE"}
SEVERITIES = {"NONE", "P0", "P1", "P2", "P3"}
EVIDENCE_FIELDS = [
    "evidenceId", "authority", "sourceUrl", "exactLocator", "retrievedAt",
    "payloadSha256", "repositoryPath", "remoteCommit",
]
ATTESTATION_SCHEMA = "early-detection-concept-map-semantic-audit-attestation/v2"
KIT_SCHEMA = "early-detection-concept-map-semantic-audit-kit/v2"
DECISION_SCHEMA = "early-detection-concept-map-semantic-audit-decision/v2"


class SemanticAuditError(RuntimeError):
    pass


def canonical_sha256(value: Any) -> str:
    raw = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def file_sha256(path: Path, normalize_line_endings: bool = False) -> str:
    raw = path.read_bytes()
    if normalize_line_endings:
        raw = raw.replace(b"\r\n", b"\n")
    return hashlib.sha256(raw).hexdigest()


def is_sha256(value: Any) -> bool:
    return isinstance(value, str) and len(value) == 64 and all(char in "0123456789abcdef" for char in value)


def is_commit(value: Any) -> bool:
    return isinstance(value, str) and len(value) == 40 and all(char in "0123456789abcdef" for char in value)


def timestamp(value: Any, field: str) -> datetime:
    if not isinstance(value, str) or not value.strip():
        raise SemanticAuditError(f"missing {field} timestamp")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise SemanticAuditError(f"invalid {field} timestamp: {value}") from exc
    if parsed.tzinfo is None:
        raise SemanticAuditError(f"{field} must carry a timezone")
    return parsed.astimezone(timezone.utc)


def safe_relative(value: Any) -> str:
    if not isinstance(value, str) or not value.strip():
        raise SemanticAuditError("blank repository-relative evidence path")
    path = PurePosixPath(value.replace("\\", "/"))
    if path.is_absolute() or any(part in {"", ".", ".."} for part in path.parts):
        raise SemanticAuditError(f"unsafe repository-relative evidence path: {value}")
    return path.as_posix()


def git_bytes(repository: Path, commit: str, path: str) -> bytes:
    relative = safe_relative(path)
    result = subprocess.run(
        ["git", "-C", str(repository), "show", f"{commit}:{relative}"],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False,
    )
    if result.returncode != 0:
        message = result.stderr.decode("utf-8", errors="replace").strip()
        raise SemanticAuditError(f"evidence missing at {commit}:{relative}: {message}")
    return result.stdout


def require_ancestor(repository: Path, commit: str) -> None:
    result = subprocess.run(
        ["git", "-C", str(repository), "merge-base", "--is-ancestor", commit, "origin/main"],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False,
    )
    if result.returncode != 0:
        raise SemanticAuditError("evidence commit is not reachable from origin/main")


def write_utf8(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(text.encode("utf-8"))


def load_json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8-sig"))
    if not isinstance(value, dict):
        raise SemanticAuditError(f"JSON root is not an object: {path}")
    return value


def verify_signed(value: dict[str, Any], label: str) -> None:
    unsigned = {key: item for key, item in value.items() if key != "reportSha256"}
    if canonical_sha256(unsigned) != value.get("reportSha256"):
        raise SemanticAuditError(f"signature mismatch: {label}")


def primary_requirement(dimension: str) -> str:
    if dimension == "conceptPriority":
        return "Official US-GAAP taxonomy definitions for every listed concept plus an explanation of priority order."
    if dimension in {"requiredQtrs", "derivations"}:
        return "SEC FSD qtrs semantics and primary accounting-period evidence for the frozen derivation."
    if dimension == "destinationFields":
        return "Destination-field contract and primary accounting definition proving semantic equivalence."
    if dimension.startswith("selection."):
        return "Primary SEC filing/FSD availability semantics and a look-ahead counterexample check."
    if dimension.startswith("forbidden."):
        return "Primary accounting or point-in-time rationale confirming the prohibition is necessary and sufficient."
    return "Primary SEC or US-GAAP definition directly supporting the frozen semantic choice."


def audit_items(concept_map: dict[str, Any]) -> list[dict[str, str]]:
    raw_items: list[tuple[str, str, str, Any]] = [
        ("global", "", "forms", concept_map["forms"]),
        ("global", "", "unit", concept_map["unit"]),
    ]
    for key, value in sorted(concept_map["selection"].items()):
        raw_items.append(("global", "", f"selection.{key}", value))
    for index, value in enumerate(concept_map["forbidden"], 1):
        raw_items.append(("global", "", f"forbidden.{index:02d}", value))
    raw_items.append(("global", "", "changeControl", concept_map["changeControl"]))
    for role, contract in concept_map["roles"].items():
        for dimension in ("destinationFields", "conceptPriority", "requiredQtrs", "derivations"):
            raw_items.append(("role", role, dimension, contract[dimension]))
    items: list[dict[str, str]] = []
    for index, (scope, role, dimension, frozen) in enumerate(raw_items, 1):
        items.append({
            "itemId": f"CM-{index:03d}",
            "scope": scope,
            "role": role,
            "dimension": dimension,
            "frozenValueJson": json.dumps(frozen, ensure_ascii=False, sort_keys=True, separators=(",", ":")),
            "requiredPrimaryEvidence": primary_requirement(dimension),
            "reviewerDecision": "",
            "findingSeverity": "",
            "evidenceCitation": "",
            "reviewerComment": "",
        })
    return items


def core_rows(rows: list[dict[str, str]]) -> list[dict[str, str]]:
    return [{field: row[field] for field in CORE_FIELDS} for row in rows]


def csv_text(rows: list[dict[str, str]]) -> str:
    output = io.StringIO(newline="")
    writer = csv.DictWriter(output, fieldnames=FIELDS, lineterminator="\n")
    writer.writeheader()
    writer.writerows(rows)
    return output.getvalue()


def read_review(path: Path) -> list[dict[str, str]]:
    with path.open(encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        if reader.fieldnames != FIELDS:
            raise SemanticAuditError("review CSV schema changed")
        return [{key: value or "" for key, value in row.items()} for row in reader]


def evidence_csv_text(rows: list[dict[str, str]]) -> str:
    output = io.StringIO(newline="")
    writer = csv.DictWriter(output, fieldnames=EVIDENCE_FIELDS, lineterminator="\n")
    writer.writeheader()
    writer.writerows(rows)
    return output.getvalue()


def read_evidence(path: Path) -> list[dict[str, str]]:
    with path.open(encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        if reader.fieldnames != EVIDENCE_FIELDS:
            raise SemanticAuditError("evidence CSV schema changed")
        return [{key: value or "" for key, value in row.items()} for row in reader]


def authority_matches_url(authority: str, source_url: str) -> bool:
    parsed = urlparse(source_url)
    host = (parsed.hostname or "").lower()
    if parsed.scheme != "https":
        return False
    if authority == "SEC":
        return host == "sec.gov" or host.endswith(".sec.gov")
    if authority == "FASB":
        return (
            host == "fasb.org" or host.endswith(".fasb.org")
            or host == "accountingfoundation.org" or host.endswith(".accountingfoundation.org")
        )
    return False


def validate_evidence(repository: Path, rows: list[dict[str, str]]) -> dict[str, Any]:
    evidence_ids: set[str] = set()
    errors: list[str] = []
    for line, row in enumerate(rows, start=2):
        try:
            if any(not str(row.get(field, "")).strip() for field in EVIDENCE_FIELDS):
                raise SemanticAuditError(f"blank evidence field at line {line}")
            evidence_id = row["evidenceId"].strip()
            if evidence_id in evidence_ids:
                raise SemanticAuditError(f"duplicate evidenceId: {evidence_id}")
            evidence_ids.add(evidence_id)
            if not authority_matches_url(row["authority"].strip(), row["sourceUrl"].strip()):
                raise SemanticAuditError(f"evidence URL is not an allowed official authority at line {line}")
            timestamp(row["retrievedAt"], f"evidence line {line}.retrievedAt")
            expected = row["payloadSha256"].strip()
            commit = row["remoteCommit"].strip()
            path = safe_relative(row["repositoryPath"])
            if not is_sha256(expected) or not is_commit(commit):
                raise SemanticAuditError(f"invalid evidence hash or commit at line {line}")
            require_ancestor(repository, commit)
            if hashlib.sha256(git_bytes(repository, commit, path)).hexdigest() != expected:
                raise SemanticAuditError(f"remote evidence hash mismatch at line {line}")
        except SemanticAuditError as exc:
            errors.append(str(exc))
    return {
        "evidenceManifestValid": bool(rows) and not errors,
        "evidenceCount": len(evidence_ids),
        "evidenceIds": evidence_ids,
        "errors": errors,
    }


def prepare(args: argparse.Namespace) -> dict[str, Any]:
    repository = args.repository.resolve()
    kit = args.kit.resolve()
    manifest_path = kit / "kit-manifest.json"
    items_path = kit / "audit-items-template.csv"
    evidence_path = kit / "evidence-manifest-template.csv"
    attestation_path = kit / "attestation-template.json"
    readme_path = kit / "README.md"
    if any(path.exists() for path in (manifest_path, items_path, evidence_path, attestation_path, readme_path)):
        raise SemanticAuditError("refusing to overwrite semantic-audit kit")
    concept_map = load_json(repository / MAP_RELATIVE)
    seal = load_json(repository / SEAL_RELATIVE)
    coverage = load_json(repository / COVERAGE_RELATIVE)
    checkpoint = load_json(repository / CHECKPOINT_RELATIVE)
    verify_signed(coverage, "coverage")
    verify_signed(checkpoint, "technical checkpoint")
    if file_sha256(repository / MAP_RELATIVE, normalize_line_endings=True) != seal.get("artifact", {}).get("sha256"):
        raise SemanticAuditError("map does not match seal")
    if checkpoint.get("technicalCheckpointPassed") is not True or checkpoint.get("gatePassed") is not False:
        raise SemanticAuditError("technical checkpoint does not preserve fail-closed state")
    rows = audit_items(concept_map)
    kit.mkdir(parents=True, exist_ok=True)
    write_utf8(items_path, csv_text(rows))
    write_utf8(evidence_path, evidence_csv_text([]))
    attestation = {
        "schema": ATTESTATION_SCHEMA,
        "reviewerName": "",
        "reviewerType": "HUMAN",
        "reviewerQualifications": "",
        "independenceFromMapDesignAndImplementationAttested": False,
        "noStudyDesignDataOrCodeContributionAttested": False,
        "noOutcomeAccessAttested": False,
        "primaryTaxonomySourcesReviewedAttested": False,
        "allEvidenceCitationsVerifiedAttested": False,
        "kitManifestFileSha256": "",
        "reviewFileSha256": "",
        "evidenceManifestFileSha256": "",
        "conflictDisclosure": "",
        "startedAt": None,
        "completedAt": None,
        "signatureName": "",
    }
    write_utf8(attestation_path, json.dumps(attestation, ensure_ascii=False, indent=2) + "\n")
    write_utf8(readme_path,
        "# Unabhaengiger Human-Semantikaudit der SEC-Konzeptkarte\n\n"
        "Dieser Kit prueft ausschliesslich die eingefrorene Semantik. Der Reviewer darf keine Wachstums-, "
        "Kurs- oder Studienergebnisse sehen und muss von Erstellung und Implementierung unabhaengig sein.\n\n"
        "1. `audit-items-template.csv` unter neuem Namen kopieren und jede der 50 Zeilen entscheiden.\n"
        "2. Fuer jede Zeile `reviewerDecision`, `findingSeverity`, `evidenceCitation` und `reviewerComment` ausfuellen; "
        "`evidenceCitation` enthaelt eine oder mehrere mit Semikolon getrennte evidenceIds.\n"
        "3. Jeden tragenden SEC-/FASB-/US-GAAP-Primarbeleg in `evidence-manifest-template.csv` erfassen, "
        "unveraenderlich im Repository ablegen und an einen von origin/main erreichbaren Commit binden.\n"
        "4. `attestation-template.json` unter neuem Namen ausfuellen, die SHA-256-Werte von Kit, Review und "
        "Evidenzmanifest eintragen und mit exakt demselben Namen wie `reviewerName` persoenlich signieren.\n"
        "5. Den Verifier mit Review, Evidenzmanifest und Attest ausfuehren. Ein Software-Selbsttest oder LLM "
        "ist kein unabhaengiger Human-Audit.\n\n"
        "Ein Semantik-PASS schliesst das offizielle Gate noch nicht allein: Der exakte autorisierte Gesamtinput "
        "und sein run-gebundener conceptMap-Komponentenhash bleiben zusaetzlich Pflicht.\n",
    )
    unsigned: dict[str, Any] = {
        "schema": KIT_SCHEMA,
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
        "protocol": "FEM-SEC-US@1.2.0",
        "conceptMapVersion": concept_map["version"],
        "inputs": {
            "map": {"path": MAP_RELATIVE, "sha256": seal["artifact"]["sha256"]},
            "seal": {"path": SEAL_RELATIVE, "fileSha256": file_sha256(repository / SEAL_RELATIVE, True)},
            "coverage": {"path": COVERAGE_RELATIVE, "fileSha256": file_sha256(repository / COVERAGE_RELATIVE, True), "reportSha256": coverage["reportSha256"]},
            "technicalCheckpoint": {"path": CHECKPOINT_RELATIVE, "fileSha256": file_sha256(repository / CHECKPOINT_RELATIVE, True), "reportSha256": checkpoint["reportSha256"]},
        },
        "auditItems": {
            "path": items_path.name,
            "count": len(rows),
            "coreRowsSha256": canonical_sha256(core_rows(rows)),
            "requiredDecisionFields": FIELDS[6:],
        },
        "evidenceManifestTemplate": evidence_path.name,
        "attestationTemplate": attestation_path.name,
        "readme": readme_path.name,
        "humanReviewPresent": False,
        "semanticAuditPassed": False,
        "officialGatePassed": False,
        "outcomesAccessed": False,
        "productiveGqsModified": False,
    }
    manifest = {**unsigned, "reportSha256": canonical_sha256(unsigned)}
    write_utf8(manifest_path, json.dumps(manifest, ensure_ascii=False, indent=2) + "\n")
    return manifest


def evaluate(
    rows: list[dict[str, str]], evidence_checks: dict[str, Any], attestation: dict[str, Any],
    *, kit_manifest_sha256: str | None = None, review_sha256: str | None = None,
    evidence_manifest_sha256: str | None = None, kit_frozen_at: str | None = None,
) -> dict[str, Any]:
    decisions_valid = all(row["reviewerDecision"] in DECISIONS for row in rows)
    severities_valid = all(row["findingSeverity"] in SEVERITIES for row in rows)
    evidence_ids = evidence_checks.get("evidenceIds", set())
    citations_valid = True
    for row in rows:
        references = [item.strip() for item in row["evidenceCitation"].split(";") if item.strip()]
        if not references or not all(item in evidence_ids for item in references) or not row["reviewerComment"].strip():
            citations_valid = False
    evidence_complete = evidence_checks.get("evidenceManifestValid") is True and citations_valid
    all_approved = decisions_valid and all(
        row["reviewerDecision"] == "APPROVE" and row["findingSeverity"] == "NONE" for row in rows
    )
    attestation_time_valid = False
    try:
        if kit_frozen_at:
            started = timestamp(attestation.get("startedAt"), "attestation.startedAt")
            completed = timestamp(attestation.get("completedAt"), "attestation.completedAt")
            attestation_time_valid = started >= timestamp(kit_frozen_at, "kit.generatedAt") and completed >= started
    except SemanticAuditError:
        attestation_time_valid = False
    reviewer_name = str(attestation.get("reviewerName", "")).strip()
    signature_name = str(attestation.get("signatureName", "")).strip()
    attestation_pass = all((
        attestation.get("schema") == ATTESTATION_SCHEMA,
        attestation.get("reviewerType") == "HUMAN",
        bool(reviewer_name),
        bool(str(attestation.get("reviewerQualifications", "")).strip()),
        attestation.get("independenceFromMapDesignAndImplementationAttested") is True,
        attestation.get("noStudyDesignDataOrCodeContributionAttested") is True,
        attestation.get("noOutcomeAccessAttested") is True,
        attestation.get("primaryTaxonomySourcesReviewedAttested") is True,
        attestation.get("allEvidenceCitationsVerifiedAttested") is True,
        bool(str(attestation.get("conflictDisclosure", "")).strip()),
        attestation_time_valid,
        bool(signature_name), signature_name == reviewer_name,
        is_sha256(kit_manifest_sha256), is_sha256(review_sha256), is_sha256(evidence_manifest_sha256),
        attestation.get("kitManifestFileSha256") == kit_manifest_sha256,
        attestation.get("reviewFileSha256") == review_sha256,
        attestation.get("evidenceManifestFileSha256") == evidence_manifest_sha256,
    ))
    return {
        "decisionsValid": decisions_valid,
        "severitiesValid": severities_valid,
        "evidenceComplete": evidence_complete,
        "citationsResolveToRemotePrimaryEvidence": citations_valid and evidence_checks.get("evidenceManifestValid") is True,
        "evidenceCount": evidence_checks.get("evidenceCount", 0),
        "evidenceErrors": evidence_checks.get("errors", []),
        "allItemsApproved": all_approved,
        "attestationPassed": attestation_pass,
        "attestationTimestampValid": attestation_time_valid,
        "attestationBindsExactFiles": all((
            is_sha256(kit_manifest_sha256), is_sha256(review_sha256), is_sha256(evidence_manifest_sha256),
            attestation.get("kitManifestFileSha256") == kit_manifest_sha256,
            attestation.get("reviewFileSha256") == review_sha256,
            attestation.get("evidenceManifestFileSha256") == evidence_manifest_sha256,
        )),
        "semanticAuditPassed": all((decisions_valid, severities_valid, evidence_complete, all_approved, attestation_pass)),
        "pendingItems": sum(1 for row in rows if row["reviewerDecision"] not in DECISIONS),
    }


def verify(args: argparse.Namespace) -> dict[str, Any]:
    repository = args.repository.resolve()
    manifest = load_json(args.manifest.resolve())
    verify_signed(manifest, "kit manifest")
    rows = read_review(args.review.resolve())
    if len(rows) != manifest.get("auditItems", {}).get("count"):
        raise SemanticAuditError("review item count differs from kit")
    if canonical_sha256(core_rows(rows)) != manifest.get("auditItems", {}).get("coreRowsSha256"):
        raise SemanticAuditError("immutable review-item columns differ from kit")
    if file_sha256(repository / MAP_RELATIVE, True) != manifest["inputs"]["map"]["sha256"]:
        raise SemanticAuditError("current frozen map differs from kit")
    for key, relative in (("seal", SEAL_RELATIVE), ("coverage", COVERAGE_RELATIVE), ("technicalCheckpoint", CHECKPOINT_RELATIVE)):
        if file_sha256(repository / relative, True) != manifest["inputs"][key]["fileSha256"]:
            raise SemanticAuditError(f"current {key} differs from kit")
    evidence_rows = read_evidence(args.evidence.resolve())
    evidence_checks = validate_evidence(repository, evidence_rows)
    attestation = load_json(args.attestation.resolve())
    manifest_sha = file_sha256(args.manifest.resolve())
    review_sha = file_sha256(args.review.resolve())
    evidence_sha = file_sha256(args.evidence.resolve())
    checks = evaluate(
        rows, evidence_checks, attestation,
        kit_manifest_sha256=manifest_sha,
        review_sha256=review_sha,
        evidence_manifest_sha256=evidence_sha,
        kit_frozen_at=manifest.get("generatedAt"),
    )
    unsigned: dict[str, Any] = {
        "schema": DECISION_SCHEMA,
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
        "status": "PASS" if checks["semanticAuditPassed"] else "RED_HUMAN_REVIEW_INCOMPLETE_OR_NOT_APPROVED",
        "semanticAuditPassed": checks["semanticAuditPassed"],
        "humanReviewPresent": checks["pendingItems"] < len(rows),
        "kitManifestReportSha256": manifest["reportSha256"],
        "kitManifestFileSha256": manifest_sha,
        "reviewFileSha256": review_sha,
        "evidenceManifestFileSha256": evidence_sha,
        "attestationFileSha256": file_sha256(args.attestation.resolve()),
        "checks": checks,
        "officialConceptMapGatePassed": False,
        "officialGateRequirementsStillMissing": [
            "exactAuthorizedFullInputSha256",
            "runBoundConceptMapComponentSha256",
            "remoteExecutionGateArtifactOnAuthorizedHistory",
        ] if checks["semanticAuditPassed"] else [
            "independentHumanSemanticAudit",
            "exactAuthorizedFullInputSha256",
            "runBoundConceptMapComponentSha256",
            "remoteExecutionGateArtifactOnAuthorizedHistory",
        ],
        "resultComputationAllowed": False,
        "outcomesAccessed": False,
        "productiveGqsModified": False,
    }
    result = {**unsigned, "reportSha256": canonical_sha256(unsigned)}
    output = args.output.resolve()
    if output.exists():
        raise SemanticAuditError("refusing to overwrite audit decision")
    output.parent.mkdir(parents=True, exist_ok=True)
    write_utf8(output, json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    return result


def self_test() -> dict[str, Any]:
    fixture = {
        "forms": ["10-K"], "unit": "USD", "selection": {"availability": "fixture"},
        "forbidden": ["fixture"], "changeControl": "fixture",
        "roles": {"revenue": {"destinationFields": ["x"], "conceptPriority": ["y"], "requiredQtrs": [1], "derivations": ["z"]}},
    }
    rows = audit_items(fixture)
    evidence_checks = {
        "evidenceManifestValid": True, "evidenceCount": 1,
        "evidenceIds": {"EV-001"}, "errors": [],
    }
    kit_sha, review_sha, evidence_sha = "a" * 64, "b" * 64, "c" * 64
    frozen_at = "1999-12-31T23:59:59Z"
    blank = evaluate(rows, {"evidenceManifestValid": False, "evidenceCount": 0, "evidenceIds": set(), "errors": []}, {})
    approved = [{
        **row, "reviewerDecision": "APPROVE", "findingSeverity": "NONE",
        "evidenceCitation": "EV-001", "reviewerComment": "synthetic evaluator fixture",
    } for row in rows]
    attestation = {
        "schema": ATTESTATION_SCHEMA,
        "reviewerName": "Synthetic Human Fixture", "reviewerType": "HUMAN",
        "reviewerQualifications": "synthetic taxonomy reviewer",
        "independenceFromMapDesignAndImplementationAttested": True,
        "noStudyDesignDataOrCodeContributionAttested": True,
        "noOutcomeAccessAttested": True, "primaryTaxonomySourcesReviewedAttested": True,
        "allEvidenceCitationsVerifiedAttested": True, "conflictDisclosure": "none",
        "kitManifestFileSha256": kit_sha, "reviewFileSha256": review_sha,
        "evidenceManifestFileSha256": evidence_sha,
        "startedAt": "2000-01-01T00:00:00Z", "completedAt": "2000-01-02T00:00:00Z",
        "signatureName": "Synthetic Human Fixture",
    }
    passed = evaluate(
        approved, evidence_checks, attestation,
        kit_manifest_sha256=kit_sha, review_sha256=review_sha,
        evidence_manifest_sha256=evidence_sha, kit_frozen_at=frozen_at,
    )
    if blank["semanticAuditPassed"] or not passed["semanticAuditPassed"]:
        raise SemanticAuditError("fail-closed evaluator self-test failed")
    negative_checks = 0
    invalid_fixtures = []
    signature_mismatch = dict(attestation)
    signature_mismatch["signatureName"] = "Different Human"
    invalid_fixtures.append((approved, evidence_checks, signature_mismatch))
    early = dict(attestation)
    early["startedAt"] = "1990-01-01T00:00:00Z"
    invalid_fixtures.append((approved, evidence_checks, early))
    wrong_hash = dict(attestation)
    wrong_hash["reviewFileSha256"] = "0" * 64
    invalid_fixtures.append((approved, evidence_checks, wrong_hash))
    unresolved = [dict(row) for row in approved]
    unresolved[0]["evidenceCitation"] = "EV-UNKNOWN"
    invalid_fixtures.append((unresolved, evidence_checks, attestation))
    for invalid_rows, invalid_evidence, invalid_attestation in invalid_fixtures:
        value = evaluate(
            invalid_rows, invalid_evidence, invalid_attestation,
            kit_manifest_sha256=kit_sha, review_sha256=review_sha,
            evidence_manifest_sha256=evidence_sha, kit_frozen_at=frozen_at,
        )
        if value["semanticAuditPassed"]:
            raise SemanticAuditError("negative semantic-audit fixture passed")
        negative_checks += 1
    return {
        "status": "PASS", "blankRejected": True, "syntheticPositiveFixturePassed": True,
        "attestationFileBindingEnforced": passed["attestationBindsExactFiles"],
        "remotePrimaryEvidenceRequired": passed["citationsResolveToRemotePrimaryEvidence"],
        "negativeChecksPassed": negative_checks,
    }


def parser() -> argparse.ArgumentParser:
    value = argparse.ArgumentParser(description=__doc__)
    commands = value.add_subparsers(dest="command", required=True)
    prep = commands.add_parser("prepare")
    prep.add_argument("--repository", type=Path, required=True)
    prep.add_argument("--kit", type=Path, required=True)
    check = commands.add_parser("verify")
    check.add_argument("--repository", type=Path, required=True)
    check.add_argument("--manifest", type=Path, required=True)
    check.add_argument("--review", type=Path, required=True)
    check.add_argument("--evidence", type=Path, required=True)
    check.add_argument("--attestation", type=Path, required=True)
    check.add_argument("--output", type=Path, required=True)
    commands.add_parser("self-test")
    return value


def main() -> int:
    args = parser().parse_args()
    if args.command == "prepare":
        result = prepare(args)
    elif args.command == "verify":
        result = verify(args)
    else:
        result = self_test()
    status = result.get("status")
    if status is None:
        status = (
            "KIT_PREPARED_RED_HUMAN_REVIEW_NOT_PRESENT"
            if result.get("semanticAuditPassed") is False else "UNKNOWN"
        )
    print(json.dumps({
        "status": status,
        "auditItems": result.get("auditItems", {}).get("count"),
        "semanticAuditPassed": result.get("semanticAuditPassed"),
        "humanReviewPresent": result.get("humanReviewPresent"),
        "reportSha256": result.get("reportSha256"),
        "blankRejected": result.get("blankRejected"),
        "syntheticPositiveFixturePassed": result.get("syntheticPositiveFixturePassed"),
        "attestationFileBindingEnforced": result.get("attestationFileBindingEnforced"),
        "remotePrimaryEvidenceRequired": result.get("remotePrimaryEvidenceRequired"),
        "negativeChecksPassed": result.get("negativeChecksPassed"),
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

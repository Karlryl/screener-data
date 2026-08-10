#!/usr/bin/env python3
"""Prepare and fail-closed verify the independent human concept-map semantic audit."""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


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


def prepare(args: argparse.Namespace) -> dict[str, Any]:
    repository = args.repository.resolve()
    kit = args.kit.resolve()
    manifest_path = kit / "kit-manifest.json"
    items_path = kit / "audit-items-template.csv"
    attestation_path = kit / "attestation-template.json"
    readme_path = kit / "README.md"
    if any(path.exists() for path in (manifest_path, items_path, attestation_path, readme_path)):
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
    items_path.write_text(csv_text(rows), encoding="utf-8")
    attestation = {
        "schema": "early-detection-concept-map-semantic-audit-attestation/v1",
        "reviewerName": "",
        "reviewerType": "HUMAN",
        "independenceFromStudyAttested": False,
        "noOutcomeAccessAttested": False,
        "primaryTaxonomySourcesReviewedAttested": False,
        "conflictDisclosure": "",
        "completedAt": None,
        "signatureName": "",
    }
    attestation_path.write_text(json.dumps(attestation, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    readme_path.write_text(
        "# Unabhaengiger Human-Semantikaudit der SEC-Konzeptkarte\n\n"
        "Dieser Kit prueft ausschliesslich die eingefrorene Semantik. Der Reviewer darf keine Wachstums-, "
        "Kurs- oder Studienergebnisse sehen und muss von Erstellung und Implementierung unabhaengig sein.\n\n"
        "1. `audit-items-template.csv` unter neuem Namen kopieren und jede der 50 Zeilen entscheiden.\n"
        "2. Fuer jede Zeile `reviewerDecision`, `findingSeverity`, `evidenceCitation` und `reviewerComment` ausfuellen.\n"
        "3. Nur offizielle SEC-/FASB-/US-GAAP-Primarquellen als tragende Semantikbelege verwenden.\n"
        "4. `attestation-template.json` unter neuem Namen ausfuellen und persoenlich signieren.\n"
        "5. Den Verifier ausfuehren. Ein Software-Selbsttest oder LLM ist kein unabhaengiger Human-Audit.\n\n"
        "Ein Semantik-PASS schliesst das offizielle Gate noch nicht allein: Der exakte autorisierte Gesamtinput "
        "und sein run-gebundener conceptMap-Komponentenhash bleiben zusaetzlich Pflicht.\n",
        encoding="utf-8",
    )
    unsigned: dict[str, Any] = {
        "schema": "early-detection-concept-map-semantic-audit-kit/v1",
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
        "protocol": "FEM-SEC-US@1.2.0",
        "conceptMapVersion": concept_map["version"],
        "inputs": {
            "map": {"path": MAP_RELATIVE, "sha256": seal["artifact"]["sha256"]},
            "seal": {"path": SEAL_RELATIVE, "sha256": file_sha256(repository / SEAL_RELATIVE, True)},
            "coverage": {"path": COVERAGE_RELATIVE, "reportSha256": coverage["reportSha256"]},
            "technicalCheckpoint": {"path": CHECKPOINT_RELATIVE, "reportSha256": checkpoint["reportSha256"]},
        },
        "auditItems": {
            "path": items_path.name,
            "count": len(rows),
            "coreRowsSha256": canonical_sha256(core_rows(rows)),
            "requiredDecisionFields": FIELDS[6:],
        },
        "attestationTemplate": attestation_path.name,
        "readme": readme_path.name,
        "humanReviewPresent": False,
        "semanticAuditPassed": False,
        "officialGatePassed": False,
        "outcomesAccessed": False,
        "productiveGqsModified": False,
    }
    manifest = {**unsigned, "reportSha256": canonical_sha256(unsigned)}
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return manifest


def evaluate(rows: list[dict[str, str]], attestation: dict[str, Any]) -> dict[str, Any]:
    decisions_valid = all(row["reviewerDecision"] in DECISIONS for row in rows)
    severities_valid = all(row["findingSeverity"] in SEVERITIES for row in rows)
    evidence_complete = all(row["evidenceCitation"].strip() and row["reviewerComment"].strip() for row in rows)
    all_approved = decisions_valid and all(
        row["reviewerDecision"] == "APPROVE" and row["findingSeverity"] == "NONE" for row in rows
    )
    attestation_pass = all((
        attestation.get("reviewerType") == "HUMAN",
        bool(str(attestation.get("reviewerName", "")).strip()),
        attestation.get("independenceFromStudyAttested") is True,
        attestation.get("noOutcomeAccessAttested") is True,
        attestation.get("primaryTaxonomySourcesReviewedAttested") is True,
        bool(str(attestation.get("conflictDisclosure", "")).strip()),
        bool(attestation.get("completedAt")),
        bool(str(attestation.get("signatureName", "")).strip()),
    ))
    return {
        "decisionsValid": decisions_valid,
        "severitiesValid": severities_valid,
        "evidenceComplete": evidence_complete,
        "allItemsApproved": all_approved,
        "attestationPassed": attestation_pass,
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
    attestation = load_json(args.attestation.resolve())
    checks = evaluate(rows, attestation)
    unsigned: dict[str, Any] = {
        "schema": "early-detection-concept-map-semantic-audit-decision/v1",
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
        "status": "PASS" if checks["semanticAuditPassed"] else "RED_HUMAN_REVIEW_INCOMPLETE_OR_NOT_APPROVED",
        "semanticAuditPassed": checks["semanticAuditPassed"],
        "humanReviewPresent": checks["pendingItems"] < len(rows),
        "kitManifestReportSha256": manifest["reportSha256"],
        "reviewFileSha256": file_sha256(args.review.resolve()),
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
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return result


def self_test() -> dict[str, Any]:
    fixture = {
        "forms": ["10-K"], "unit": "USD", "selection": {"availability": "fixture"},
        "forbidden": ["fixture"], "changeControl": "fixture",
        "roles": {"revenue": {"destinationFields": ["x"], "conceptPriority": ["y"], "requiredQtrs": [1], "derivations": ["z"]}},
    }
    rows = audit_items(fixture)
    blank = evaluate(rows, {})
    approved = [{**row, "reviewerDecision": "APPROVE", "findingSeverity": "NONE", "evidenceCitation": "synthetic://primary-fixture", "reviewerComment": "synthetic evaluator fixture"} for row in rows]
    attestation = {
        "reviewerName": "Synthetic Human Fixture", "reviewerType": "HUMAN",
        "independenceFromStudyAttested": True, "noOutcomeAccessAttested": True,
        "primaryTaxonomySourcesReviewedAttested": True, "conflictDisclosure": "none",
        "completedAt": "2000-01-01T00:00:00Z", "signatureName": "Synthetic Human Fixture",
    }
    passed = evaluate(approved, attestation)
    if blank["semanticAuditPassed"] or not passed["semanticAuditPassed"]:
        raise SemanticAuditError("fail-closed evaluator self-test failed")
    return {"status": "PASS", "blankRejected": True, "syntheticPositiveFixturePassed": True}


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
    print(json.dumps({
        "status": result.get("status", "PASS"),
        "auditItems": result.get("auditItems", {}).get("count"),
        "semanticAuditPassed": result.get("semanticAuditPassed"),
        "humanReviewPresent": result.get("humanReviewPresent"),
        "reportSha256": result.get("reportSha256"),
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

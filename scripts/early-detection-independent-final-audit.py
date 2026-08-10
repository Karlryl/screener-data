#!/usr/bin/env python3
"""Prepare and fail-closed verify the independent final FEM audit."""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import re
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable


PROTOCOL = "FEM-SEC-US@1.2.0"
LEDGER_RELATIVE = "protocol/early-detection/1.2.0/outcome-access-ledger.json"
MANIFEST_RELATIVE = "protocol/early-detection/1.2.0/hash-manifest.json"
INPUT_COMPONENTS = (
    "entityListingLedger", "historicalUniverse", "femSignals", "femControlPool",
    "technicalOnlySignals", "technicalOnlyControlPool", "hLatePopulation", "conceptMap",
)
GATE_COMPONENTS = {
    "entityListingLedger": ("entityListingLedger",),
    "appendOnlySecStore": ("femSignals", "femControlPool", "hLatePopulation"),
    "historicalUniverse": (
        "entityListingLedger", "historicalUniverse", "femSignals", "femControlPool",
        "technicalOnlySignals", "technicalOnlyControlPool", "hLatePopulation",
    ),
    "asOfLeakageGate": INPUT_COMPONENTS,
    "adjustedOhlcv": ("femSignals", "femControlPool", "technicalOnlySignals", "technicalOnlyControlPool", "hLatePopulation"),
    "corporateActionsDelistings": (
        "entityListingLedger", "historicalUniverse", "femSignals", "femControlPool",
        "technicalOnlySignals", "technicalOnlyControlPool", "hLatePopulation",
    ),
    "historicalGqsAdapter": ("femSignals", "femControlPool", "hLatePopulation"),
    "conceptMapFrozen": ("conceptMap",),
    "independentAuditPassed": INPUT_COMPONENTS,
    "blindCodingAgreementPassed": ("femSignals", "femControlPool", "hLatePopulation"),
    "researchCorpusSealed": ("researchCorpus",),
}
GATES = tuple(GATE_COMPONENTS)
CHECKLIST_FIELDS = (
    "itemId", "area", "requirement", "requiredEvidence", "auditorDecision",
    "findingIds", "evidenceCitation", "auditorComment",
)
CHECKLIST_CORE_FIELDS = CHECKLIST_FIELDS[:4]
FINDING_FIELDS = (
    "findingId", "checklistItemId", "severity", "status", "summary",
    "evidenceCitation", "resolution", "resolvedAt",
)
DECISIONS = {"PASS", "PASS_WITH_P3", "FAIL", "NOT_REVIEWED"}
SEVERITIES = {"P0", "P1", "P2", "P3"}
FINDING_STATUSES = {"OPEN", "RESOLVED", "WONT_FIX"}
CHECKLIST_SPEC = (
    ("IFA-001", "independence", "Auditor identity, competence and independence are established.", "Signed human attestation and conflict disclosure."),
    ("IFA-002", "outcome-blindness", "The auditor had no confirmatory outcome access before signing.", "Signed no-outcome-access attestation and access-ledger review."),
    ("IFA-003", "run-binding", "Run ID, cutoff, authorization time and remote commit are exact.", "Authorized ledger tail event and remote commit."),
    ("IFA-004", "input-integrity", "The exact full input file is byte-rehashed.", "Input-file SHA-256 matching the authorization event."),
    ("IFA-005", "component-integrity", "All eight raw input components and the research-corpus identity are rehashed.", "Complete componentManifest with independent recomputation."),
    ("IFA-006", "gate-integrity", "All eleven non-code gate artifacts and every cited evidence file are rehashed from authorized history.", "Execution-gate evidence file plus remote artifact/evidence hashes."),
    ("IFA-007", "entity-listing", "Entity, security and listing identities are effective-dated without ticker projection.", "Population checks and sampled identity/listing reproductions."),
    ("IFA-008", "sec-store", "The append-only SEC store preserves raw revisions, accessions and acceptance chronology.", "Revision/population manifests and sampled raw payload rehashes."),
    ("IFA-009", "historical-universe", "The historical universe includes exits, failures, acquisitions and delistings without survivorship bias.", "Point-in-time membership and exit samples."),
    ("IFA-010", "as-of", "Later facts cannot enter earlier states anywhere in the ingestion path.", "Negative time-shift injections and chronology samples."),
    ("IFA-011", "ohlcv", "Adjusted OHLCV provenance and split/dividend treatment are complete.", "Vendor/source provenance, adjustment tests and sampled bars."),
    ("IFA-012", "actions-delistings", "Corporate actions, security continuity and delisting returns are effective-dated.", "Action-ledger and return-policy reproductions."),
    ("IFA-013", "historical-gqs", "Historical GQS states use only then-known facts under the frozen formula identity.", "Adapter replay, remote seal and selected snapshot reproductions."),
    ("IFA-014", "concept-map", "The frozen concept map is semantically approved and bound to the exact input.", "Independent concept-map semantic audit and run-bound component hash."),
    ("IFA-015", "blind-coding", "Two independent blinded coders meet the sealed agreement thresholds.", "Coder independence, kappa and exact-agreement artifacts."),
    ("IFA-016", "research-corpus", "The corpus is sealed before outcome access and cannot expand selectively.", "Corpus manifest, queries, cutoffs, source classes and content hashes."),
    ("IFA-017", "population", "Candidate, control, technical-only and H-LATE populations are complete and non-reused as specified.", "Population counts, deterministic matching and non-reuse tests."),
    ("IFA-018", "sampling", "Auditor samples cover every locked time split and every required gate area.", "Dated sampling log with reproducible commands and evidence paths."),
    ("IFA-019", "runtime", "Protocol, runner and numerical runtime are the exact sealed versions.", "Protocol manifest, runtime lock and repository audit output."),
    ("IFA-020", "authorization", "Every verification predates authorization and authorization predates outcome access.", "Timezone-qualified timestamps and append-only ledger chain."),
    ("IFA-021", "findings", "Every finding is classified, evidenced and dispositioned.", "Complete findings register linked to checklist items."),
    ("IFA-022", "closure", "No unresolved P0, P1 or P2 remains at signature time.", "Findings register with resolution evidence and signed closure."),
)


class FinalAuditError(RuntimeError):
    pass


def canonical_sha256(value: Any) -> str:
    raw = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def file_sha256(path: Path) -> str:
    return sha256_bytes(path.read_bytes())


def signed(value: dict[str, Any]) -> dict[str, Any]:
    return {**value, "reportSha256": canonical_sha256(value)}


def load_json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8-sig"))
    if not isinstance(value, dict):
        raise FinalAuditError(f"JSON root is not an object: {path}")
    return value


def verify_signed(value: dict[str, Any], label: str) -> None:
    unsigned = {key: item for key, item in value.items() if key != "reportSha256"}
    if value.get("reportSha256") != canonical_sha256(unsigned):
        raise FinalAuditError(f"signature mismatch: {label}")


def timestamp(value: Any, label: str) -> datetime:
    if not isinstance(value, str) or "T" not in value:
        raise FinalAuditError(f"{label} must be a timezone-qualified timestamp")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise FinalAuditError(f"{label} is not a valid timestamp") from exc
    if parsed.tzinfo is None:
        raise FinalAuditError(f"{label} must include a timezone")
    return parsed.astimezone(timezone.utc)


def is_sha256(value: Any) -> bool:
    return isinstance(value, str) and re.fullmatch(r"[0-9a-f]{64}", value) is not None


def is_commit(value: Any) -> bool:
    return isinstance(value, str) and re.fullmatch(r"[0-9a-f]{40}", value) is not None


def safe_relative(value: Any) -> str:
    if not isinstance(value, str) or not value or value.startswith(("/", "\\")) or ".." in Path(value).parts:
        raise FinalAuditError("remote artifact path is unsafe")
    return value.replace("\\", "/")


def csv_text(fields: tuple[str, ...], rows: list[dict[str, str]]) -> str:
    output = io.StringIO(newline="")
    writer = csv.DictWriter(output, fieldnames=fields, lineterminator="\n")
    writer.writeheader()
    writer.writerows(rows)
    return output.getvalue()


def read_csv(path: Path, fields: tuple[str, ...]) -> list[dict[str, str]]:
    with path.open(encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        if tuple(reader.fieldnames or ()) != fields:
            raise FinalAuditError(f"CSV schema changed: {path.name}")
        return [{key: value or "" for key, value in row.items()} for row in reader]


def core_rows(rows: list[dict[str, str]]) -> list[dict[str, str]]:
    return [{field: row[field] for field in CHECKLIST_CORE_FIELDS} for row in rows]


def checklist_rows() -> list[dict[str, str]]:
    return [{
        "itemId": item_id, "area": area, "requirement": requirement,
        "requiredEvidence": required, "auditorDecision": "NOT_REVIEWED",
        "findingIds": "", "evidenceCitation": "", "auditorComment": "",
    } for item_id, area, requirement, required in CHECKLIST_SPEC]


def git_bytes(repository: Path, commit: str, path: str) -> bytes:
    completed = subprocess.run(
        ["git", "-C", str(repository), "show", f"{commit}:{safe_relative(path)}"],
        capture_output=True, timeout=60, check=False,
    )
    if completed.returncode != 0:
        raise FinalAuditError(f"remote artifact unavailable: {path}")
    return completed.stdout


def require_ancestor(repository: Path, ancestor: str, descendant: str) -> None:
    if not is_commit(ancestor):
        raise FinalAuditError("remote commit is invalid")
    completed = subprocess.run(
        ["git", "-C", str(repository), "merge-base", "--is-ancestor", ancestor, descendant],
        capture_output=True, timeout=30, check=False,
    )
    if completed.returncode != 0:
        raise FinalAuditError(f"commit {ancestor} is not an ancestor of {descendant}")


def evaluate_human(
    rows: list[dict[str, str]], findings: list[dict[str, str]], attestation: dict[str, Any],
    manifest: dict[str, Any],
) -> dict[str, Any]:
    if len(rows) != manifest["checklist"]["count"]:
        raise FinalAuditError("checklist row count differs from kit")
    if canonical_sha256(core_rows(rows)) != manifest["checklist"]["coreRowsSha256"]:
        raise FinalAuditError("immutable checklist columns differ from kit")
    finding_ids: set[str] = set()
    item_ids = {row["itemId"] for row in rows}
    valid_findings = True
    unresolved_high = 0
    for finding in findings:
        if not any(value.strip() for value in finding.values()):
            continue
        finding_id = finding["findingId"].strip()
        if not finding_id or finding_id in finding_ids or finding["checklistItemId"] not in item_ids:
            valid_findings = False
        finding_ids.add(finding_id)
        if finding["severity"] not in SEVERITIES or finding["status"] not in FINDING_STATUSES:
            valid_findings = False
        if not finding["summary"].strip() or not finding["evidenceCitation"].strip():
            valid_findings = False
        if finding["status"] == "RESOLVED" and (not finding["resolution"].strip() or not finding["resolvedAt"].strip()):
            valid_findings = False
        if finding["severity"] in {"P0", "P1", "P2"} and finding["status"] != "RESOLVED":
            unresolved_high += 1
    decisions_valid = all(row["auditorDecision"] in DECISIONS for row in rows)
    evidence_complete = all(
        row["auditorDecision"] in {"PASS", "PASS_WITH_P3"}
        and row["evidenceCitation"].strip() and row["auditorComment"].strip()
        for row in rows
    )
    linked_findings_valid = all(
        all(item.strip() in finding_ids for item in row["findingIds"].split(";") if item.strip())
        for row in rows
    )
    all_pass = decisions_valid and all(row["auditorDecision"] in {"PASS", "PASS_WITH_P3"} for row in rows)
    attestation_pass = all((
        attestation.get("schema") == "early-detection-independent-final-audit-attestation/v1",
        attestation.get("reviewerType") == "HUMAN",
        bool(str(attestation.get("reviewerName", "")).strip()),
        bool(str(attestation.get("reviewerQualifications", "")).strip()),
        attestation.get("independentFromProducingSystemAttested") is True,
        attestation.get("noStudyDesignDataOrCodeContributionAttested") is True,
        attestation.get("noConfirmatoryOutcomeAccessBeforeSignatureAttested") is True,
        attestation.get("allFindingsDisclosedAttested") is True,
        attestation.get("noUnresolvedP0P1P2Attested") is True,
        bool(str(attestation.get("conflictDisclosure", "")).strip()),
        bool(attestation.get("completedAt")),
        bool(str(attestation.get("signatureName", "")).strip()),
    ))
    return {
        "decisionsValid": decisions_valid,
        "evidenceComplete": evidence_complete,
        "linkedFindingsValid": linked_findings_valid,
        "findingsValid": valid_findings,
        "allChecklistItemsPassed": all_pass,
        "attestationPassed": attestation_pass,
        "pendingChecklistItems": sum(1 for row in rows if row["auditorDecision"] not in {"PASS", "PASS_WITH_P3"}),
        "findingCount": len(finding_ids),
        "unresolvedP0P1P2": unresolved_high,
        "humanAuditPassed": all((all_pass, evidence_complete, linked_findings_valid, valid_findings, unresolved_high == 0, attestation_pass)),
    }


def validate_input(payload: dict[str, Any], research_corpus_sha256: str) -> dict[str, str]:
    manifest = payload.get("componentManifest")
    expected = {*INPUT_COMPONENTS, "researchCorpus"}
    if not isinstance(manifest, dict) or set(manifest) != expected:
        raise FinalAuditError("input componentManifest is incomplete or contains undeclared components")
    for name in INPUT_COMPONENTS:
        if name not in payload or not is_sha256(manifest.get(name)):
            raise FinalAuditError(f"input component missing or unhashed: {name}")
        if canonical_sha256(payload[name]) != manifest[name]:
            raise FinalAuditError(f"input component hash mismatch: {name}")
    if manifest.get("researchCorpus") != research_corpus_sha256:
        raise FinalAuditError("input research-corpus identity differs from run binding")
    return manifest


def validate_gate_artifact(
    gate: str, artifact: dict[str, Any], input_sha: str, corpus_sha: str,
    authorization_at: datetime, commit: str, loader: Callable[[str, str], bytes],
) -> None:
    if artifact.get("schema") != "early-detection-execution-gate-artifact/v1" \
            or artifact.get("protocol") != PROTOCOL or artifact.get("gate") != gate or artifact.get("status") != "PASS":
        raise FinalAuditError(f"gate artifact identity/status mismatch: {gate}")
    if artifact.get("confirmatoryInputFileSha256") != input_sha:
        raise FinalAuditError(f"gate artifact attests another input: {gate}")
    if gate == "researchCorpusSealed" and artifact.get("researchCorpusSha256") != corpus_sha:
        raise FinalAuditError("research-corpus artifact attests another corpus")
    if not str(artifact.get("verificationMethod", "")).strip():
        raise FinalAuditError(f"gate artifact lacks verification method: {gate}")
    verified_at = timestamp(artifact.get("verifiedAt"), f"{gate}.verifiedAt")
    if verified_at > authorization_at:
        raise FinalAuditError(f"gate artifact verified after authorization: {gate}")
    evidence = artifact.get("evidence")
    if not isinstance(evidence, list) or not evidence:
        raise FinalAuditError(f"gate artifact lacks evidence: {gate}")
    ids: set[str] = set()
    paths: set[str] = set()
    for item in evidence:
        if not isinstance(item, dict) or not str(item.get("evidenceId", "")).strip() \
                or not is_sha256(item.get("sha256")):
            raise FinalAuditError(f"invalid gate evidence: {gate}")
        path = safe_relative(item.get("artifactPath"))
        if item["evidenceId"] in ids or path in paths:
            raise FinalAuditError(f"duplicate gate evidence identity/path: {gate}")
        ids.add(item["evidenceId"])
        paths.add(path)
        if timestamp(item.get("verifiedAt"), f"{gate}.evidence.verifiedAt") > verified_at:
            raise FinalAuditError(f"gate evidence timestamp exceeds artifact time: {gate}")
        if sha256_bytes(loader(commit, path)) != item["sha256"]:
            raise FinalAuditError(f"gate evidence hash mismatch: {gate}/{item['evidenceId']}")


def mechanical_checks(
    repository: Path, run: dict[str, Any], input_path: Path | None, gate_path: Path | None,
    loader: Callable[[str, str], bytes] | None = None,
) -> dict[str, Any]:
    checks = {
        "runBindingComplete": False, "authorizedRemoteCommitReachable": False,
        "authorizationLedgerTailMatches": False, "protocolManifestMatches": False,
        "exactInputRehashed": False, "componentManifestRecomputed": False,
        "gateEvidenceRehashed": False, "allElevenGateArtifactsRehashed": False,
        "allRemoteEvidenceRehashed": False,
    }
    errors: list[str] = []
    try:
        required_strings = (
            "runId", "authorizedRemoteCommit", "inputFileSha256", "gateEvidenceFileSha256",
            "researchCorpusSha256", "protocolManifestSha256", "authorizationLedgerEventSha256",
        )
        if run.get("schema") != "early-detection-independent-final-audit-run-binding/v1" \
                or run.get("protocol") != PROTOCOL or not all(str(run.get(key, "")).strip() for key in required_strings) \
                or not is_commit(run.get("authorizedRemoteCommit")) \
                or not all(is_sha256(run.get(key)) for key in required_strings[2:]) \
                or run.get("outcomesAccessed") is not False:
            raise FinalAuditError("run binding is incomplete")
        authorization_at = timestamp(run.get("authorizationAccessAt"), "authorizationAccessAt")
        timestamp(run.get("analysisCutoffAt"), "analysisCutoffAt")
        checks["runBindingComplete"] = True
        commit = run["authorizedRemoteCommit"]
        require_ancestor(repository, commit, "origin/main")
        checks["authorizedRemoteCommitReachable"] = True
        active_loader = loader or (lambda c, p: git_bytes(repository, c, p))
        manifest_bytes = active_loader(commit, MANIFEST_RELATIVE)
        if sha256_bytes(manifest_bytes) != run["protocolManifestSha256"]:
            raise FinalAuditError("remote protocol manifest hash mismatch")
        checks["protocolManifestMatches"] = True
        ledger = json.loads(active_loader(commit, LEDGER_RELATIVE).decode("utf-8"))
        events = ledger.get("events")
        if not isinstance(events, list) or not events:
            raise FinalAuditError("authorization ledger has no event")
        event = events[-1]
        if event.get("eventType") != "confirmatory_execution_authorized" \
                or canonical_sha256(event) != run["authorizationLedgerEventSha256"]:
            raise FinalAuditError("authorization ledger tail does not match run binding")
        expected_event = {
            "runId": run["runId"], "inputFileSha256": run["inputFileSha256"],
            "gateEvidenceFileSha256": run["gateEvidenceFileSha256"],
            "researchCorpusSha256": run["researchCorpusSha256"],
            "protocolManifestSha256": run["protocolManifestSha256"],
            "analysisCutoffAt": run["analysisCutoffAt"], "accessAt": run["authorizationAccessAt"],
        }
        if any(event.get(key) != value for key, value in expected_event.items()):
            raise FinalAuditError("authorization ledger fields differ from run binding")
        checks["authorizationLedgerTailMatches"] = True
        if input_path is None or gate_path is None:
            raise FinalAuditError("exact input and gate-evidence paths are required")
        input_bytes = input_path.read_bytes()
        if sha256_bytes(input_bytes) != run["inputFileSha256"]:
            raise FinalAuditError("exact input file hash mismatch")
        checks["exactInputRehashed"] = True
        payload = json.loads(input_bytes.decode("utf-8"))
        components = validate_input(payload, run["researchCorpusSha256"])
        checks["componentManifestRecomputed"] = True
        gate_bytes = gate_path.read_bytes()
        if sha256_bytes(gate_bytes) != run["gateEvidenceFileSha256"]:
            raise FinalAuditError("gate-evidence file hash mismatch")
        checks["gateEvidenceRehashed"] = True
        gate_evidence = json.loads(gate_bytes.decode("utf-8"))
        gates = gate_evidence.get("gates")
        if gate_evidence.get("schema") != "early-detection-execution-gate-evidence/v1" \
                or gate_evidence.get("protocol") != PROTOCOL \
                or gate_evidence.get("researchCorpusSha256") != run["researchCorpusSha256"] \
                or not isinstance(gates, dict) or set(gates) != set(GATES):
            raise FinalAuditError("gate-evidence contract is incomplete")
        artifacts: dict[str, dict[str, Any]] = {}
        for gate in GATES:
            item = gates[gate]
            if not isinstance(item, dict) or item.get("status") != "PASS" \
                    or not is_sha256(item.get("artifactSha256")) or not is_commit(item.get("remoteCommit")):
                raise FinalAuditError(f"gate evidence entry invalid: {gate}")
            require_ancestor(repository, item["remoteCommit"], commit)
            artifact_bytes = active_loader(item["remoteCommit"], item.get("artifactPath"))
            if sha256_bytes(artifact_bytes) != item["artifactSha256"]:
                raise FinalAuditError(f"remote gate artifact hash mismatch: {gate}")
            artifact = json.loads(artifact_bytes.decode("utf-8"))
            validate_gate_artifact(
                gate, artifact, run["inputFileSha256"], run["researchCorpusSha256"],
                authorization_at, item["remoteCommit"], active_loader,
            )
            artifacts[gate] = artifact
        checks["allElevenGateArtifactsRehashed"] = True
        checks["allRemoteEvidenceRehashed"] = True
        for gate, expected in GATE_COMPONENTS.items():
            actual = artifacts[gate].get("componentSha256")
            if not isinstance(actual, dict) or set(actual) != set(expected) \
                    or any(actual[name] != components[name] for name in expected):
                raise FinalAuditError(f"gate component coverage/hash mismatch: {gate}")
        return {"passed": True, "checks": checks, "errors": []}
    except (FinalAuditError, OSError, UnicodeDecodeError, json.JSONDecodeError, subprocess.SubprocessError) as exc:
        errors.append(str(exc))
        return {"passed": False, "checks": checks, "errors": errors}


def prepare(args: argparse.Namespace) -> dict[str, Any]:
    kit = args.kit.resolve()
    paths = {
        "checklist": kit / "audit-checklist-template.csv",
        "findings": kit / "findings-template.csv",
        "attestation": kit / "attestation-template.json",
        "runBinding": kit / "run-binding-template.json",
        "readme": kit / "README.md",
        "manifest": kit / "kit-manifest.json",
    }
    if any(path.exists() for path in paths.values()):
        raise FinalAuditError("refusing to overwrite independent-audit kit")
    kit.mkdir(parents=True, exist_ok=True)
    rows = checklist_rows()
    paths["checklist"].write_text(csv_text(CHECKLIST_FIELDS, rows), encoding="utf-8")
    paths["findings"].write_text(csv_text(FINDING_FIELDS, []), encoding="utf-8")
    attestation = {
        "schema": "early-detection-independent-final-audit-attestation/v1",
        "reviewerName": "", "reviewerType": "HUMAN", "reviewerQualifications": "",
        "independentFromProducingSystemAttested": False,
        "noStudyDesignDataOrCodeContributionAttested": False,
        "noConfirmatoryOutcomeAccessBeforeSignatureAttested": False,
        "allFindingsDisclosedAttested": False, "noUnresolvedP0P1P2Attested": False,
        "conflictDisclosure": "", "completedAt": None, "signatureName": "",
    }
    paths["attestation"].write_text(json.dumps(attestation, indent=2) + "\n", encoding="utf-8")
    run_binding = {
        "schema": "early-detection-independent-final-audit-run-binding/v1",
        "protocol": PROTOCOL, "runId": "", "analysisCutoffAt": None,
        "authorizationAccessAt": None, "authorizedRemoteCommit": "",
        "inputFileSha256": "", "gateEvidenceFileSha256": "",
        "researchCorpusSha256": "", "protocolManifestSha256": "",
        "authorizationLedgerEventSha256": "", "outcomesAccessed": False,
    }
    paths["runBinding"].write_text(json.dumps(run_binding, indent=2) + "\n", encoding="utf-8")
    paths["readme"].write_text(
        "# Unabhaengiges Abschluss-Audit FEM-SEC-US@1.2.0\n\n"
        "Dieses Paket ist fuer einen wirklich unabhaengigen Human-Auditor. Die produzierende Instanz darf sich "
        "nicht selbst freigeben. Ergebniszugriff vor der signierten Auditentscheidung ist verboten.\n\n"
        "1. Erst nach zehn bestandenen Voraussetzungsgates den exakten Input, das Forschungskorpus und den "
        "autorisierten Remote-Stand fixieren.\n"
        "2. `run-binding-template.json` unter neuem Namen mit der letzten autorisierten Ledger-Zeile ausfuellen.\n"
        "3. Alle 22 Checklistenpunkte anhand der angegebenen Primaerbelege pruefen; jedes Finding in einer Kopie "
        "von `findings-template.csv` erfassen.\n"
        "4. Offene P0/P1/P2 muessen vor der Signatur geschlossen sein. Offene P3 duerfen nur als "
        "`PASS_WITH_P3` sichtbar bleiben.\n"
        "5. Attestation persoenlich ausfuellen und signieren. Ein LLM, Software-Selbsttest oder Autor der Studie "
        "ist kein unabhaengiger Human-Auditor.\n"
        "6. Den Verifier mit exaktem Input und Gate-Evidence ausfuehren. Seine Entscheidung wird als Beleg des "
        "`independentAuditPassed`-Artefakts committed; danach wird die volle Elf-Gate-Kette vor der "
        "Ausfuehrungsautorisierung nochmals mechanisch geprueft.\n\n"
        "Der leere Vorlagenzustand ist absichtlich RED und darf nie als Audit-PASS zitiert werden.\n",
        encoding="utf-8",
    )
    unsigned = {
        "schema": "early-detection-independent-final-audit-kit/v1",
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
        "protocol": PROTOCOL,
        "checklist": {
            "path": paths["checklist"].name, "count": len(rows),
            "coreRowsSha256": canonical_sha256(core_rows(rows)),
            "decisionFields": list(CHECKLIST_FIELDS[4:]),
        },
        "findings": {"path": paths["findings"].name, "fields": list(FINDING_FIELDS)},
        "attestationTemplate": paths["attestation"].name,
        "runBindingTemplate": paths["runBinding"].name,
        "readme": paths["readme"].name,
        "requiredGateArtifacts": list(GATES),
        "requiredInputComponents": list(INPUT_COMPONENTS),
        "humanReviewPresent": False, "independentAuditPassed": False,
        "outcomesAccessed": False, "productiveGqsModified": False,
    }
    manifest = signed(unsigned)
    paths["manifest"].write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return manifest


def verify(args: argparse.Namespace) -> dict[str, Any]:
    manifest = load_json(args.manifest.resolve())
    verify_signed(manifest, "kit manifest")
    rows = read_csv(args.checklist.resolve(), CHECKLIST_FIELDS)
    findings = read_csv(args.findings.resolve(), FINDING_FIELDS)
    attestation = load_json(args.attestation.resolve())
    run = load_json(args.run_binding.resolve())
    human = evaluate_human(rows, findings, attestation, manifest)
    mechanical = mechanical_checks(
        args.repository.resolve(), run,
        args.input.resolve() if args.input else None,
        args.gate_evidence.resolve() if args.gate_evidence else None,
    )
    passed = human["humanAuditPassed"] and mechanical["passed"]
    unsigned = {
        "schema": "early-detection-independent-final-audit-decision/v1",
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
        "protocol": PROTOCOL,
        "status": "PASS" if passed else "RED_EXACT_INPUT_REMOTE_EVIDENCE_OR_HUMAN_AUDIT_INCOMPLETE",
        "independentAuditPassed": passed,
        "humanReviewPresent": human["pendingChecklistItems"] < len(rows) or bool(str(attestation.get("reviewerName", "")).strip()),
        "kitManifestReportSha256": manifest["reportSha256"],
        "checklistFileSha256": file_sha256(args.checklist.resolve()),
        "findingsFileSha256": file_sha256(args.findings.resolve()),
        "attestationFileSha256": file_sha256(args.attestation.resolve()),
        "runBindingFileSha256": file_sha256(args.run_binding.resolve()),
        "humanChecks": human,
        "mechanicalChecks": mechanical,
        "officialGatePassed": False,
        "officialGateNote": "A PASS decision must still be committed and packaged as the run-bound independentAuditPassed execution-gate artifact before authorization.",
        "resultComputationAllowed": False,
        "outcomesAccessed": False,
        "productiveGqsModified": False,
    }
    result = signed(unsigned)
    output = args.output.resolve()
    if output.exists():
        raise FinalAuditError("refusing to overwrite final-audit decision")
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return result


def self_test() -> dict[str, Any]:
    rows = checklist_rows()
    manifest = {"checklist": {"count": len(rows), "coreRowsSha256": canonical_sha256(core_rows(rows))}}
    blank = evaluate_human(rows, [], {}, manifest)
    approved = [{
        **row, "auditorDecision": "PASS", "evidenceCitation": "synthetic://fixture",
        "auditorComment": "synthetic evaluator fixture",
    } for row in rows]
    attestation = {
        "schema": "early-detection-independent-final-audit-attestation/v1",
        "reviewerName": "Synthetic Human Fixture", "reviewerType": "HUMAN",
        "reviewerQualifications": "synthetic", "independentFromProducingSystemAttested": True,
        "noStudyDesignDataOrCodeContributionAttested": True,
        "noConfirmatoryOutcomeAccessBeforeSignatureAttested": True,
        "allFindingsDisclosedAttested": True, "noUnresolvedP0P1P2Attested": True,
        "conflictDisclosure": "synthetic none", "completedAt": "2000-01-01T00:00:00Z",
        "signatureName": "Synthetic Human Fixture",
    }
    positive = evaluate_human(approved, [], attestation, manifest)
    open_p2 = [{
        "findingId": "F-1", "checklistItemId": "IFA-001", "severity": "P2", "status": "OPEN",
        "summary": "synthetic", "evidenceCitation": "synthetic://fixture", "resolution": "", "resolvedAt": "",
    }]
    negative = evaluate_human(approved, open_p2, attestation, manifest)
    components = {name: ([] if name != "conceptMap" else {}) for name in INPUT_COMPONENTS}
    component_manifest = {name: canonical_sha256(value) for name, value in components.items()}
    component_manifest["researchCorpus"] = "a" * 64
    validate_input({**components, "componentManifest": component_manifest}, "a" * 64)
    if blank["humanAuditPassed"] or not positive["humanAuditPassed"] or negative["humanAuditPassed"]:
        raise FinalAuditError("fail-closed human evaluator self-test failed")
    return {
        "status": "PASS", "checklistItems": len(rows),
        "blankRejected": True, "syntheticPositiveFixturePassed": True,
        "openP2Rejected": True, "componentManifestRecomputed": True,
    }


def parser() -> argparse.ArgumentParser:
    value = argparse.ArgumentParser(description=__doc__)
    commands = value.add_subparsers(dest="command", required=True)
    prep = commands.add_parser("prepare")
    prep.add_argument("--kit", type=Path, required=True)
    check = commands.add_parser("verify")
    check.add_argument("--repository", type=Path, required=True)
    check.add_argument("--manifest", type=Path, required=True)
    check.add_argument("--checklist", type=Path, required=True)
    check.add_argument("--findings", type=Path, required=True)
    check.add_argument("--attestation", type=Path, required=True)
    check.add_argument("--run-binding", type=Path, required=True)
    check.add_argument("--input", type=Path)
    check.add_argument("--gate-evidence", type=Path)
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
    checklist_count = result.get("checklistItems")
    if checklist_count is None:
        checklist_count = result.get("checklist", {}).get("count")
    if checklist_count is None:
        human_checks = result.get("humanChecks", {})
        checklist_count = human_checks.get("pendingChecklistItems")
    print(json.dumps({
        "status": result.get("status", "PASS"),
        "checklistItems": checklist_count,
        "independentAuditPassed": result.get("independentAuditPassed"),
        "humanReviewPresent": result.get("humanReviewPresent"),
        "reportSha256": result.get("reportSha256"),
        "blankRejected": result.get("blankRejected"),
        "syntheticPositiveFixturePassed": result.get("syntheticPositiveFixturePassed"),
        "openP2Rejected": result.get("openP2Rejected"),
        "componentManifestRecomputed": result.get("componentManifestRecomputed"),
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
"""Build a complete, signed SEC-store checkpoint and revision-coverage proof."""

from __future__ import annotations

import argparse
import hashlib
import json
import sqlite3
import subprocess
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


KNOWN_SCHEMAS = {
    "early-detection-source-observation/v1",
    "early-detection-sec-edgar-feed-observation/v1",
    "early-detection-sec-edgar-feed-observation/v2",
    "early-detection-sec-edgar-master-index-observation/v1",
    "early-detection-sec-oldloads-observation/v1",
    "early-detection-sec-oldloads-observation/v2",
    "early-detection-sec-individual-filing-observation/v2",
    "early-detection-sec-midas-acquisition/v1",
}
FORM8 = ("8-A12B", "8-A12B/A")
FORM25 = ("25", "25/A", "25-NSE", "25-NSE/A")
FORM15 = (
    "15-12B", "15-12B/A", "15-12G", "15-12G/A", "15-15D", "15-15D/A",
    "15F-12B", "15F-12B/A", "15F-12G", "15F-12G/A", "15F-15D", "15F-15D/A",
)


class CheckpointError(RuntimeError):
    pass


def canonical_sha256(value: Any) -> str:
    raw = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(4 * 1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def load_signed(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8-sig"))
    unsigned = {key: item for key, item in value.items() if key != "reportSha256"}
    if canonical_sha256(unsigned) != value.get("reportSha256"):
        raise CheckpointError(f"report signature mismatch: {path}")
    return value


def safe_child(root: Path, relative: str) -> Path:
    candidate = (root / relative).resolve()
    try:
        candidate.relative_to(root.resolve())
    except ValueError as exc:
        raise CheckpointError(f"path escapes data root: {relative}") from exc
    return candidate


def enumerate_snapshot(data_root: Path) -> tuple[list[dict[str, Any]], list[dict[str, Any]], set[str]]:
    observation_index: list[dict[str, Any]] = []
    payload_index: dict[str, dict[str, Any]] = {}
    fsd_digests: set[str] = set()
    for path in sorted((data_root / "observations").rglob("*.json")):
        raw = path.read_bytes()
        item = json.loads(raw.decode("utf-8-sig"))
        schema = str(item.get("schema", ""))
        if schema not in KNOWN_SCHEMAS:
            raise CheckpointError(f"unknown observation schema: {path}: {schema}")
        relative_payload = str(item.get("payloadPath") or item.get("blobPath") or "")
        expected_sha = str(item.get("payloadSha256", ""))
        payload_path = safe_child(data_root, relative_payload)
        if not payload_path.is_file():
            raise CheckpointError(f"missing payload: {relative_payload}")
        actual_sha = file_sha256(payload_path)
        actual_bytes = payload_path.stat().st_size
        if actual_sha != expected_sha or (
            item.get("payloadBytes") is not None and int(item["payloadBytes"]) != actual_bytes
        ):
            raise CheckpointError(f"payload contract mismatch: {relative_payload}")
        key = payload_path.as_posix().lower()
        payload_index.setdefault(key, {
            "path": payload_path.relative_to(data_root).as_posix(),
            "bytes": actual_bytes,
            "sha256": actual_sha,
        })
        archive_relative = str(item.get("archiveRecordPath") or "")
        if archive_relative or item.get("archiveRecordSha256"):
            archive_path = safe_child(data_root, archive_relative)
            if not archive_path.is_file() or file_sha256(archive_path) != item.get("archiveRecordSha256"):
                raise CheckpointError(f"archive record contract mismatch: {archive_relative}")
            archive_key = archive_path.as_posix().lower()
            payload_index.setdefault(archive_key, {
                "path": archive_path.relative_to(data_root).as_posix(),
                "bytes": archive_path.stat().st_size,
                "sha256": str(item["archiveRecordSha256"]),
            })
        if item.get("sourceClass") == "sec_financial_statement_dataset" and "2009q1" <= str(item.get("quarter")) <= "2024q4":
            digest = str(item.get("archiveEvidence", {}).get("captureDigestSha1Base32", ""))
            if not digest:
                raise CheckpointError(f"SEC FSD observation lacks archive digest: {path}")
            fsd_digests.add(digest)
        observation_index.append({
            "path": path.relative_to(data_root).as_posix(),
            "bytes": len(raw),
            "sha256": hashlib.sha256(raw).hexdigest(),
            "schema": schema,
            "payloadSha256": item.get("payloadSha256"),
        })
    return observation_index, sorted(payload_index.values(), key=lambda row: row["path"]), fsd_digests


def unique_cdx_digests(path: Path, from_year: int, to_year: int) -> set[str]:
    raw = json.loads(path.read_text(encoding="utf-8-sig"))
    columns = ["timestamp", "original", "mimetype", "statuscode", "digest", "length"]
    if not isinstance(raw, list) or not raw or raw[0] != columns:
        raise CheckpointError("CDX cache schema changed")
    result: set[str] = set()
    for values in raw[1:]:
        row = dict(zip(columns, values))
        original = str(row["original"])
        for year in range(from_year, to_year + 1):
            if any(f"{year}q{quarter}" in original for quarter in range(1, 5)):
                result.add(str(row["digest"]))
                break
    return result


def form_counts(master: dict[str, Any], forms: tuple[str, ...]) -> dict[str, int]:
    available = master.get("forms", {})
    result = {form: int(available.get(form, 0)) for form in forms}
    if any(count <= 0 for count in result.values()):
        raise CheckpointError(f"required SEC form missing from master index: {result}")
    return result


def enumerate_capture_inputs(data_root: Path, capture: dict[str, Any]) -> dict[str, Any]:
    rows_for_hash: list[list[Any]] = []
    state_evidence: list[dict[str, Any]] = []
    verified_files: dict[str, dict[str, Any]] = {}
    family_counts: dict[str, dict[str, int]] = {}
    progress_artifacts = [
        artifact for artifact in capture.get("artifacts", [])
        if ":progress:" in str(artifact.get("role", ""))
    ]
    if not progress_artifacts:
        raise CheckpointError("capture gate decision has no progress artifacts")
    for artifact in progress_artifacts:
        role = str(artifact["role"])
        family, _, range_label = role.partition(":progress:")
        progress_path = Path(str(artifact["path"])).resolve()
        progress = load_signed(progress_path)
        if progress.get("status") != "RANGE_COMPLETE":
            raise CheckpointError(f"capture range not complete: {progress_path}")
        state_path = Path(str(progress["stateDatabase"])).resolve()
        if not state_path.is_file():
            raise CheckpointError(f"capture state database missing: {state_path}")
        connection = sqlite3.connect(f"file:{state_path.as_posix()}?mode=ro", uri=True)
        connection.row_factory = sqlite3.Row
        try:
            if str(connection.execute("PRAGMA quick_check").fetchone()[0]) != "ok":
                raise CheckpointError(f"capture state quick_check failed: {state_path}")
            columns = {str(row[1]) for row in connection.execute("PRAGMA table_info(captures)")}
            required = {
                "event_id", "cik", "accession", "status", "http_status", "payload_sha256",
                "payload_bytes", "payload_path", "acceptance_at",
            }
            if not required.issubset(columns):
                raise CheckpointError(f"capture state columns changed: {state_path}: {sorted(columns)}")
            if "observed_form" in columns:
                form_column = "observed_form"
            elif "registration_form" in columns:
                form_column = "registration_form"
            else:
                raise CheckpointError(f"capture state has no parsed form field: {state_path}")
            state_rows = list(connection.execute(
                f"SELECT event_id,cik,accession,status,http_status,payload_sha256,payload_bytes,payload_path,"
                f"acceptance_at,{form_column} AS form_identity FROM captures ORDER BY event_id"
            ))
        finally:
            connection.close()
        expected_rows = int(progress["range"]["selectedEvents"])
        if len(state_rows) != expected_rows:
            raise CheckpointError(f"capture state row count mismatch: {state_path}")
        state_status_counts: dict[str, int] = {}
        for row in state_rows:
            status = str(row["status"])
            state_status_counts[status] = state_status_counts.get(status, 0) + 1
            payload_relative: str | None = None
            if status == "VERIFIED":
                if not row["payload_path"] or not row["payload_sha256"] or row["payload_bytes"] is None:
                    raise CheckpointError(f"verified capture lacks payload identity: {state_path}:{row['event_id']}")
                if not row["acceptance_at"] or not row["form_identity"]:
                    raise CheckpointError(f"verified capture lacks SEC acceptance/form: {state_path}:{row['event_id']}")
                payload_path = Path(str(row["payload_path"])).resolve()
                try:
                    payload_relative = payload_path.relative_to(data_root).as_posix()
                except ValueError as exc:
                    raise CheckpointError(f"capture payload outside data root: {payload_path}") from exc
                key = payload_path.as_posix().lower()
                if key not in verified_files:
                    if not payload_path.is_file():
                        raise CheckpointError(f"capture payload missing: {payload_path}")
                    actual_bytes = payload_path.stat().st_size
                    actual_sha = file_sha256(payload_path)
                    if actual_bytes != int(row["payload_bytes"]) or actual_sha != str(row["payload_sha256"]):
                        raise CheckpointError(f"capture payload contract mismatch: {payload_path}")
                    verified_files[key] = {
                        "path": payload_relative,
                        "bytes": actual_bytes,
                        "sha256": actual_sha,
                    }
            elif status != "NOT_FOUND":
                raise CheckpointError(f"unresolved capture status: {state_path}:{row['event_id']}:{status}")
            rows_for_hash.append([
                family,
                range_label,
                int(row["event_id"]),
                int(row["cik"]),
                str(row["accession"]),
                status,
                int(row["http_status"]) if row["http_status"] is not None else None,
                str(row["payload_sha256"]) if row["payload_sha256"] else None,
                int(row["payload_bytes"]) if row["payload_bytes"] is not None else None,
                payload_relative,
                str(row["acceptance_at"]) if row["acceptance_at"] else None,
                str(row["form_identity"]) if row["form_identity"] else None,
            ])
        expected_status_counts = {str(key): int(value) for key, value in progress.get("counts", {}).items()}
        if state_status_counts != expected_status_counts:
            raise CheckpointError(f"capture status recount mismatch: {state_path}")
        family_count = family_counts.setdefault(family, {"events": 0, "verified": 0, "notFound": 0})
        family_count["events"] += len(state_rows)
        family_count["verified"] += state_status_counts.get("VERIFIED", 0)
        family_count["notFound"] += state_status_counts.get("NOT_FOUND", 0)
        state_evidence.append({
            "role": role,
            "progressReportPath": str(progress_path),
            "progressReportSha256": progress["reportSha256"],
            "stateDatabasePath": str(state_path),
            "stateDatabaseSha256": file_sha256(state_path),
            "rows": len(state_rows),
            "statusCounts": state_status_counts,
        })
    for family, expected in capture["independentlyVerifiedCoverage"].items():
        actual = family_counts.get(family)
        if actual is None:
            raise CheckpointError(f"capture family absent from state enumeration: {family}")
        if actual["events"] != int(expected["populationEvents"]):
            raise CheckpointError(f"capture family event mismatch: {family}")
        if actual["verified"] != int(expected["verifiedPayloads"]):
            raise CheckpointError(f"capture family verified mismatch: {family}")
        if actual["notFound"] != int(expected["explicitNonPayloadOutcomes"]):
            raise CheckpointError(f"capture family non-payload mismatch: {family}")
    payloads = sorted(verified_files.values(), key=lambda row: row["path"])
    return {
        "captureRows": len(rows_for_hash),
        "captureIndexSha256": canonical_sha256(rows_for_hash),
        "verifiedPayloadFiles": len(payloads),
        "verifiedPayloadBytes": sum(int(row["bytes"]) for row in payloads),
        "verifiedPayloadIndexSha256": canonical_sha256(payloads),
        "familyCounts": family_counts,
        "stateEvidence": state_evidence,
    }


def build(args: argparse.Namespace) -> dict[str, Any]:
    output = args.output.resolve()
    if output.exists():
        raise CheckpointError("refusing to overwrite output")
    data_root = args.data_root.resolve()
    composite = load_signed(args.composite_verification.resolve())
    master = load_signed(args.master_index_report.resolve())
    listing = load_signed(args.listing_population_report.resolve())
    corporate = load_signed(args.corporate_population_report.resolve())
    effect = load_signed(args.effect_population_report.resolve())
    capture = load_signed(args.capture_gate_decision.resolve())
    truncation = load_signed(args.truncation_audit.resolve())
    if composite.get("status") != "PASS_LOCAL_SNAPSHOT" or composite.get("issues"):
        raise CheckpointError("composite store verification did not pass")
    if truncation.get("status") != "PASS_TRUNCATED_ARCHIVE_DUPLICATE_NOT_DISTINCT_REVISION":
        raise CheckpointError("truncation audit did not pass")

    observations, payloads, local_fsd_digests = enumerate_snapshot(data_root)
    if canonical_sha256(observations) != composite.get("observationIndexSha256"):
        raise CheckpointError("observation index does not match composite verification")
    if canonical_sha256(payloads) != composite.get("payloadIndexSha256"):
        raise CheckpointError("payload index does not match composite verification")
    if len(observations) != int(composite["observationFiles"]) or len(payloads) != int(composite["distinctPayloads"]):
        raise CheckpointError("composite counts changed")

    all_cdx_digests = unique_cdx_digests(args.cdx_cache.resolve(), 2009, 2024)
    truncated_digest = str(truncation["cdxRow"]["digest"])
    valid_cdx_digests = all_cdx_digests - {truncated_digest}
    missing_fsd = sorted(valid_cdx_digests - local_fsd_digests)
    unexpected_fsd = sorted(local_fsd_digests - valid_cdx_digests)
    if missing_fsd or unexpected_fsd:
        raise CheckpointError(f"FSD digest set mismatch: missing={missing_fsd} unexpected={unexpected_fsd}")

    form8_counts = form_counts(master, FORM8)
    form25_counts = form_counts(master, FORM25)
    form15_counts = form_counts(master, FORM15)
    coverage = capture["independentlyVerifiedCoverage"]
    listing_events = int(listing["candidateEvents"])
    corporate_events = int(corporate["events"])
    effect_events = int(effect["events"])
    if listing_events != sum(form8_counts.values()) or listing_events != int(coverage["form8aFilings"]["populationEvents"]):
        raise CheckpointError("Form 8-A population mismatch")
    if corporate_events != sum(form25_counts.values()) + sum(form15_counts.values()) or corporate_events != int(coverage["corporateActions"]["populationEvents"]):
        raise CheckpointError("corporate-action population mismatch")
    if effect_events != int(coverage["effectNotices"]["populationEvents"]):
        raise CheckpointError("EFFECT population mismatch")
    annual = coverage.get("annual10KIdentity")
    if annual is not None and (
        int(annual["populationEvents"]) != 20495
        or int(annual["verifiedPayloads"]) != 20495
        or int(annual["explicitNonPayloadOutcomes"]) != 0
    ):
        raise CheckpointError("annual 10-K identity population mismatch")
    original_filings = enumerate_capture_inputs(data_root, capture)
    capture_decision = (
        "All valid archived SEC FSD payload revisions and all original/amended Form 8-A12B, "
        "Form 25/15 and EFFECT population outcomes"
    )
    if annual is not None:
        capture_decision += " and the bounded annual 10-K identity population"
    capture_decision += " are explicitly represented and locally hash-verified."

    evidence_paths = {
        "compositeVerification": args.composite_verification.resolve(),
        "masterIndexReport": args.master_index_report.resolve(),
        "listingPopulationReport": args.listing_population_report.resolve(),
        "corporatePopulationReport": args.corporate_population_report.resolve(),
        "effectPopulationReport": args.effect_population_report.resolve(),
        "captureGateDecision": args.capture_gate_decision.resolve(),
        "truncationAudit": args.truncation_audit.resolve(),
        "cdxCache": args.cdx_cache.resolve(),
    }
    unsigned = {
        "schema": "early-detection-sec-store-checkpoint/v1",
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
        "status": "PASS_LOCAL_COMPLETE_READY_FOR_REMOTE_BINDING",
        "dataWindow": {"fromYear": 2009, "toYear": 2024},
        "snapshot": {
            "observationFiles": len(observations),
            "distinctPayloads": len(payloads),
            "distinctPayloadBytes": sum(int(row["bytes"]) for row in payloads),
            "observationIndexSha256": canonical_sha256(observations),
            "payloadIndexSha256": canonical_sha256(payloads),
            "observations": observations,
            "payloads": payloads,
        },
        "revisionCoverage": {
            "secFsd": {
                "cdxUniqueDigestCaptures": len(all_cdx_digests),
                "invalidTruncatedDuplicateCaptures": 1,
                "validDistinctPayloadRevisions": len(valid_cdx_digests),
                "locallyVerifiedValidPayloadRevisions": len(local_fsd_digests),
                "missingValidPayloadRevisions": 0,
                "truncatedDuplicateDigest": truncated_digest,
            },
            "form8aNationalExchangeRegistration": {
                "forms": form8_counts,
                "populationEvents": listing_events,
                "verifiedPayloads": int(coverage["form8aFilings"]["verifiedPayloads"]),
                "explicitNonPayloadOutcomes": int(coverage["form8aFilings"]["explicitNonPayloadOutcomes"]),
            },
            "form25And15CorporateActions": {
                "form25Family": form25_counts,
                "form15Family": form15_counts,
                "populationEvents": corporate_events,
                "verifiedPayloads": int(coverage["corporateActions"]["verifiedPayloads"]),
                "explicitNonPayloadOutcomes": int(coverage["corporateActions"]["explicitNonPayloadOutcomes"]),
            },
            "effectNotices": {
                "populationEvents": effect_events,
                "verifiedPayloads": int(coverage["effectNotices"]["verifiedPayloads"]),
                "explicitNonPayloadOutcomes": int(coverage["effectNotices"]["explicitNonPayloadOutcomes"]),
                "nonPayloadOutcomesByStatus": coverage["effectNotices"]["nonPayloadOutcomesByStatus"],
            },
            **({
                "annual10KIdentity": {
                    "populationEvents": int(annual["populationEvents"]),
                    "verifiedPayloads": int(annual["verifiedPayloads"]),
                    "explicitNonPayloadOutcomes": int(annual["explicitNonPayloadOutcomes"]),
                    "distinctPayloadFiles": int(annual["distinctPayloadFiles"]),
                    "distinctPayloadBytes": int(annual["distinctPayloadBytes"]),
                    "distinctPayloadIndexSha256": annual["distinctPayloadIndexSha256"],
                    "missingAcceptanceFallbacks": int(annual["missingAcceptanceFallbacks"]),
                }
            } if annual is not None else {}),
        },
        "originalFilingCaptureCheckpoint": original_filings,
        "evidence": {
            role: {"path": str(path), "fileSha256": file_sha256(path)}
            for role, path in evidence_paths.items()
        },
        "decision": capture_decision,
        "remainingGateRequirements": [
            "This checkpoint must be committed to and fetched from the authorized origin/main history.",
            "A genuinely independent auditor must reproduce the full-input checkpoint before confirmatory input assembly.",
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
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        payload = root / "blobs" / "sha256" / "fixture.bin"
        payload.parent.mkdir(parents=True)
        payload.write_bytes(b"fixture")
        observation = root / "observations" / "fixture.json"
        observation.parent.mkdir()
        observation.write_text(json.dumps({
            "schema": "early-detection-source-observation/v1",
            "sourceClass": "fixture",
            "payloadPath": payload.relative_to(root).as_posix(),
            "payloadSha256": file_sha256(payload),
            "payloadBytes": payload.stat().st_size,
        }), encoding="utf-8")
        observations, payloads, fsd = enumerate_snapshot(root)
        if len(observations) != 1 or len(payloads) != 1 or fsd:
            raise CheckpointError("self-test failed")
    if normalize_checkout_line_endings(b"a\r\nb\r\n") != b"a\nb\n":
        raise CheckpointError("line-ending normalization self-test failed")
    return {
        "status": "PASS",
        "observationManifest": True,
        "payloadManifest": True,
        "checkoutLineEndingNormalization": True,
    }


def git_bytes(repository: Path, *arguments: str) -> bytes:
    process = subprocess.run(
        ["git", "-C", str(repository), *arguments],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    if process.returncode != 0:
        raise CheckpointError(
            f"git {' '.join(arguments)} failed: {process.stderr.decode('utf-8', errors='replace').strip()}"
        )
    return process.stdout


def normalize_checkout_line_endings(value: bytes) -> bytes:
    """Normalize only Git's reversible CRLF checkout translation."""
    return value.replace(b"\r\n", b"\n")


def bind_remote(args: argparse.Namespace) -> dict[str, Any]:
    repository = args.repository.resolve()
    checkpoint_path = args.checkpoint.resolve()
    output = args.output.resolve()
    if output.exists():
        raise CheckpointError("refusing to overwrite output")
    checkpoint = load_signed(checkpoint_path)
    if checkpoint.get("status") != "PASS_LOCAL_COMPLETE_READY_FOR_REMOTE_BINDING":
        raise CheckpointError("checkpoint is not ready for remote binding")
    try:
        relative = checkpoint_path.relative_to(repository).as_posix()
    except ValueError as exc:
        raise CheckpointError("checkpoint is outside repository") from exc
    checkpoint_commit = args.checkpoint_commit
    remote_commit = git_bytes(repository, "rev-parse", args.remote_ref).decode("ascii").strip()
    ancestor = subprocess.run(
        ["git", "-C", str(repository), "merge-base", "--is-ancestor", checkpoint_commit, remote_commit],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    if ancestor.returncode != 0:
        raise CheckpointError(f"checkpoint commit is not an ancestor of {args.remote_ref}")
    committed_bytes = git_bytes(repository, "show", f"{checkpoint_commit}:{relative}")
    remote_bytes = git_bytes(repository, "show", f"{remote_commit}:{relative}")
    local_bytes = checkpoint_path.read_bytes()
    if remote_bytes != committed_bytes:
        raise CheckpointError("remote checkpoint bytes do not match the checkpoint commit")
    if normalize_checkout_line_endings(local_bytes) != committed_bytes:
        raise CheckpointError("committed checkpoint does not match the signed local checkpoint")
    unsigned = {
        "schema": "early-detection-gate-decision/v6",
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
        "gate": "appendOnlySecStore",
        "status": "TECHNICAL_CHECKPOINT_PASS_OFFICIAL_GATE_RED_UNTIL_EXACT_INPUT_BINDING",
        "gatePassed": False,
        "technicalCheckpointPassed": True,
        "verdict": "The complete append-only SEC component checkpoint is locally reproduced, includes all valid FSD revisions and all required original/amended filing populations, and is byte-identically bound to authorized origin/main history. The official execution gate remains red because the sealed protocol additionally requires a run-bound artifact attesting the exact authorized full-input hash and gate-specific component hashes.",
        "checkpoint": {
            "path": relative,
            "fileSha256": hashlib.sha256(committed_bytes).hexdigest(),
            "localCheckoutFileSha256": hashlib.sha256(local_bytes).hexdigest(),
            "localCheckoutLineEndingsNormalized": local_bytes != committed_bytes,
            "reportSha256": checkpoint["reportSha256"],
            "checkpointCommit": checkpoint_commit,
            "remoteRef": args.remote_ref,
            "remoteCommit": remote_commit,
            "checkpointCommitIsRemoteAncestor": True,
            "remoteBytesMatch": True,
        },
        "coverage": {
            "snapshot": {
                "observationFiles": checkpoint["snapshot"]["observationFiles"],
                "distinctPayloads": checkpoint["snapshot"]["distinctPayloads"],
                "distinctPayloadBytes": checkpoint["snapshot"]["distinctPayloadBytes"],
                "observationIndexSha256": checkpoint["snapshot"]["observationIndexSha256"],
                "payloadIndexSha256": checkpoint["snapshot"]["payloadIndexSha256"],
            },
            "revisionCoverage": checkpoint["revisionCoverage"],
            "originalFilingCaptureCheckpoint": {
                key: checkpoint["originalFilingCaptureCheckpoint"][key]
                for key in (
                    "captureRows", "captureIndexSha256", "verifiedPayloadFiles",
                    "verifiedPayloadBytes", "verifiedPayloadIndexSha256", "familyCounts",
                )
            },
        },
        "officialGateRequirementsStillMissing": [
            "exactAuthorizedFullInputSha256",
            "runBoundAppendOnlySecStoreComponentSha256",
            "remoteExecutionGateArtifactOnAuthorizedHistory",
        ],
        "separateExecutionGatesStillRed": ["independentAuditPassed"],
        "interpretation": "The SEC component store is technically complete and immutable. That does not by itself satisfy the stricter run-bound gateEvidenceRule or the separate independent human audit gate.",
        "confirmatoryEligible": False,
        "resultComputationAllowed": False,
        "outcomesAccessed": False,
        "productiveGqsModified": False,
    }
    result = {**unsigned, "reportSha256": canonical_sha256(unsigned)}
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return result


def parser() -> argparse.ArgumentParser:
    value = argparse.ArgumentParser(description=__doc__)
    commands = value.add_subparsers(dest="command", required=True)
    run = commands.add_parser("build")
    run.add_argument("--data-root", type=Path, required=True)
    run.add_argument("--cdx-cache", type=Path, required=True)
    run.add_argument("--composite-verification", type=Path, required=True)
    run.add_argument("--master-index-report", type=Path, required=True)
    run.add_argument("--listing-population-report", type=Path, required=True)
    run.add_argument("--corporate-population-report", type=Path, required=True)
    run.add_argument("--effect-population-report", type=Path, required=True)
    run.add_argument("--capture-gate-decision", type=Path, required=True)
    run.add_argument("--truncation-audit", type=Path, required=True)
    run.add_argument("--output", type=Path, required=True)
    bind = commands.add_parser("bind-remote")
    bind.add_argument("--repository", type=Path, required=True)
    bind.add_argument("--checkpoint", type=Path, required=True)
    bind.add_argument("--checkpoint-commit", required=True)
    bind.add_argument("--remote-ref", default="origin/main")
    bind.add_argument("--output", type=Path, required=True)
    commands.add_parser("self-test")
    return value


def main() -> int:
    args = parser().parse_args()
    if args.command == "self-test":
        result = self_test()
    elif args.command == "bind-remote":
        result = bind_remote(args)
    else:
        result = build(args)
    if args.command == "self-test":
        summary = result
    elif args.command == "bind-remote":
        summary = {
            "status": result["status"],
            "gate": result["gate"],
            "remoteCommit": result["checkpoint"]["remoteCommit"],
            "reportSha256": result["reportSha256"],
        }
    else:
        summary = {
        "status": result["status"],
        "observationFiles": result["snapshot"]["observationFiles"],
        "distinctPayloads": result["snapshot"]["distinctPayloads"],
        "distinctPayloadBytes": result["snapshot"]["distinctPayloadBytes"],
        "validFsdRevisions": result["revisionCoverage"]["secFsd"]["validDistinctPayloadRevisions"],
        "originalFilingCaptureRows": result["originalFilingCaptureCheckpoint"]["captureRows"],
        "originalFilingPayloadFiles": result["originalFilingCaptureCheckpoint"]["verifiedPayloadFiles"],
        "reportSha256": result["reportSha256"],
        }
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

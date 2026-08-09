#!/usr/bin/env python3
"""Sealed confirmatory analysis runner for FEM-SEC-US@1.2.0.

This program is intentionally outcome-blind until all thirteen execution gates
are true.  It consumes only the frozen raw observation contract and derives
labels, splits, estimates, intervals and decisions internally.  Prepared
success booleans are neither accepted nor read.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import platform
import re
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import numpy as np


PROTOCOL = "FEM-SEC-US@1.2.0"
REQUIRED_GATES = (
    "protocolSealed",
    "confirmatoryAnalysisImplementationSealed",
    "entityListingLedger",
    "appendOnlySecStore",
    "historicalUniverse",
    "asOfLeakageGate",
    "adjustedOhlcv",
    "corporateActionsDelistings",
    "historicalGqsAdapter",
    "conceptMapFrozen",
    "independentAuditPassed",
    "blindCodingAgreementPassed",
    "researchCorpusSealed",
)
ELIGIBLE_FORMS = {"10-Q", "10-K"}
REGIMES = {"bear", "recovery", "bull", "neutral"}
BOOTSTRAP_REPLICATES = 10_000
ROOT = Path(__file__).resolve().parents[1]
RUNTIME_LOCK = ROOT / "protocol" / "early-detection" / "1.2.0" / "confirmatory-runtime-lock.json"
INPUT_COMPONENTS = (
    "entityListingLedger", "historicalUniverse", "femSignals", "femControlPool",
    "technicalOnlySignals", "technicalOnlyControlPool", "hLatePopulation", "conceptMap",
)
GATE_COMPONENTS = {
    "entityListingLedger": ("entityListingLedger",),
    "appendOnlySecStore": ("femSignals", "femControlPool", "hLatePopulation"),
    "historicalUniverse": ("entityListingLedger", "historicalUniverse", "femSignals", "femControlPool", "technicalOnlySignals", "technicalOnlyControlPool", "hLatePopulation"),
    "asOfLeakageGate": INPUT_COMPONENTS,
    "adjustedOhlcv": ("femSignals", "femControlPool", "technicalOnlySignals", "technicalOnlyControlPool", "hLatePopulation"),
    "corporateActionsDelistings": ("entityListingLedger", "historicalUniverse", "femSignals", "femControlPool", "technicalOnlySignals", "technicalOnlyControlPool", "hLatePopulation"),
    "historicalGqsAdapter": ("femSignals", "femControlPool", "hLatePopulation"),
    "conceptMapFrozen": ("conceptMap",),
    "independentAuditPassed": INPUT_COMPONENTS,
    "blindCodingAgreementPassed": ("femSignals", "femControlPool", "hLatePopulation"),
    "researchCorpusSealed": ("researchCorpus",),
}


class ContractError(ValueError):
    """The frozen input contract is incomplete or internally inconsistent."""


def canonical_sha256(value: Any) -> str:
    payload = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def json_safe(value: Any) -> Any:
    if isinstance(value, float) and not math.isfinite(value):
        return None
    if isinstance(value, dict):
        return {key: json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [json_safe(item) for item in value]
    if isinstance(value, np.generic):
        return json_safe(value.item())
    return value


def timestamp(value: Any, field: str) -> datetime:
    if not isinstance(value, str) or "T" not in value or not (value.endswith("Z") or "+" in value[10:] or "-" in value[10:]):
        raise ContractError(f"{field} must be a timezone-qualified timestamp")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ContractError(f"{field} is not a valid timestamp") from exc
    if parsed.tzinfo is None:
        raise ContractError(f"{field} must include a timezone")
    return parsed.astimezone(timezone.utc)


def require_string(row: dict[str, Any], field: str) -> str:
    value = row.get(field)
    if not isinstance(value, str) or not value:
        raise ContractError(f"{field} is required")
    return value


def split_for(value: str) -> str:
    instant = timestamp(value, "split timestamp")
    date = instant.date().isoformat()
    if "2009-01-01" <= date <= "2016-12-31":
        return "development"
    if "2017-01-01" <= date <= "2020-12-31":
        return "validation"
    if "2021-01-01" <= date <= "2024-12-31":
        return "locked"
    if "2025-01-01" <= date <= "2026-08-08":
        return "recent_descriptive"
    if "2026-08-08" < date <= "2026-12-31":
        return "prospective_descriptive"
    return "outside_protocol"


def readiness(gates: Any, implementation_sealed: bool | None = None) -> dict[str, Any]:
    supplied = gates if isinstance(gates, dict) else {}
    if implementation_sealed is not None:
        supplied = {**supplied, "confirmatoryAnalysisImplementationSealed": implementation_sealed}
    missing = [gate for gate in REQUIRED_GATES if supplied.get(gate) is not True]
    return {
        "status": "READY_TO_EXECUTE" if not missing else "NOT_READY_TO_EXECUTE",
        "missing": missing,
        "resultComputationAllowed": not missing,
    }


def verify_runtime_lock() -> dict[str, Any]:
    try:
        lock = json.loads(RUNTIME_LOCK.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ContractError("confirmatory runtime lock missing or invalid") from exc
    actual = {
        "python": ".".join(str(part) for part in sys.version_info[:3]),
        "numpy": np.__version__,
        "operatingSystem": platform.system(),
        "machine": platform.machine(),
        "numpyBuildConfigSha256": canonical_sha256(np.__config__.CONFIG),
        "bitGenerator": "numpy.random.PCG64",
        "bootstrapReplicates": BOOTSTRAP_REPLICATES,
    }
    if lock.get("schema") != "early-detection-confirmatory-runtime/v1" or lock.get("protocol") != PROTOCOL:
        raise ContractError("confirmatory runtime lock identity mismatch")
    for key, value in actual.items():
        if lock.get(key) != value:
            raise ContractError(f"confirmatory runtime mismatch for {key}: expected {lock.get(key)}, got {value}")
    return actual


def verify_remote_seal_and_checkpoint() -> dict[str, Any]:
    runtime = verify_runtime_lock()
    audit = ROOT / "scripts" / "early-detection-audit.js"
    completed = subprocess.run(
        ["node", str(audit), "--verify"], cwd=ROOT, text=True,
        capture_output=True, timeout=120, check=False,
    )
    if completed.returncode != 0:
        detail = (completed.stderr or completed.stdout).strip()
        raise ContractError(f"remote manifest/checkpoint verification failed: {detail[-800:]}")
    manifest_path = ROOT / "protocol" / "early-detection" / "1.2.0" / "hash-manifest.json"
    return {**runtime, "protocolManifestSha256": sha256_bytes(manifest_path.read_bytes())}


def _remote_artifact_bytes(commit: str, artifact_path: str) -> bytes:
    if not re.fullmatch(r"[0-9a-f]{40}", commit or "") or artifact_path.startswith(("/", "\\")) or ".." in Path(artifact_path).parts:
        raise ContractError("gate evidence contains an invalid commit or artifact path")
    ancestor = subprocess.run(
        ["git", "merge-base", "--is-ancestor", commit, "origin/main"], cwd=ROOT,
        capture_output=True, timeout=30, check=False,
    )
    if ancestor.returncode != 0:
        raise ContractError("gate evidence commit is not an ancestor of origin/main")
    shown = subprocess.run(
        ["git", "show", f"{commit}:{artifact_path}"], cwd=ROOT,
        capture_output=True, timeout=30, check=False,
    )
    if shown.returncode != 0:
        raise ContractError(f"remote gate artifact unavailable: {artifact_path}")
    return shown.stdout


def _verify_input_component_manifest(payload: Any, authorization: dict[str, Any], artifacts: dict[str, dict[str, Any]]) -> None:
    if not isinstance(payload, dict):
        raise ContractError("confirmatory input must be a JSON object")
    manifest = payload.get("componentManifest")
    expected_names = {*INPUT_COMPONENTS, "researchCorpus"}
    if not isinstance(manifest, dict) or set(manifest) != expected_names:
        raise ContractError("confirmatory input component manifest is incomplete or contains undeclared components")
    for name in INPUT_COMPONENTS:
        if name not in payload or not re.fullmatch(r"[0-9a-f]{64}", str(manifest.get(name, ""))):
            raise ContractError(f"confirmatory input component is missing or unhashed: {name}")
        if canonical_sha256(payload[name]) != manifest[name]:
            raise ContractError(f"confirmatory input component hash mismatch: {name}")
    if manifest.get("researchCorpus") != authorization.get("researchCorpusSha256"):
        raise ContractError("research corpus component differs from the remotely authorized corpus")
    for gate, expected_components in GATE_COMPONENTS.items():
        attested = artifacts[gate].get("componentSha256")
        if not isinstance(attested, dict) or set(attested) != set(expected_components):
            raise ContractError(f"gate artifact component coverage is incomplete: {gate}")
        for name in expected_components:
            if attested.get(name) != manifest[name]:
                raise ContractError(f"gate artifact is bound to another input component: {gate}/{name}")


def _validate_gate_artifact_identity(
        gate: str, artifact: Any, authorization: dict[str, Any], remote_commit: str,
        evidence_loader: Any = _remote_artifact_bytes) -> dict[str, Any]:
    if not isinstance(artifact, dict) or artifact.get("schema") != "early-detection-execution-gate-artifact/v1" \
            or artifact.get("protocol") != PROTOCOL or artifact.get("gate") != gate or artifact.get("status") != "PASS":
        raise ContractError(f"remote gate artifact identity/status mismatch: {gate}")
    if artifact.get("confirmatoryInputFileSha256") != authorization.get("inputFileSha256"):
        raise ContractError(f"gate artifact does not attest the exact confirmatory input: {gate}")
    if gate == "researchCorpusSealed" and artifact.get("researchCorpusSha256") != authorization.get("researchCorpusSha256"):
        raise ContractError("research-corpus artifact is bound to another corpus")
    require_string(artifact, "verificationMethod")
    verified_at = timestamp(artifact.get("verifiedAt"), "gateArtifact.verifiedAt")
    if verified_at > timestamp(authorization.get("accessAt"), "authorization.accessAt"):
        raise ContractError(f"gate artifact was verified after execution authorization: {gate}")
    evidence = artifact.get("evidence")
    if not isinstance(evidence, list) or not evidence:
        raise ContractError(f"gate artifact lacks verification evidence: {gate}")
    evidence_ids = set()
    evidence_paths = set()
    for item in evidence:
        if not isinstance(item, dict) or not isinstance(item.get("evidenceId"), str) or not item["evidenceId"] \
                or not isinstance(item.get("artifactPath"), str) or not item["artifactPath"] \
                or not re.fullmatch(r"[0-9a-f]{64}", str(item.get("sha256", ""))):
            raise ContractError(f"gate artifact contains invalid verification evidence: {gate}")
        if item["evidenceId"] in evidence_ids or item["artifactPath"] in evidence_paths:
            raise ContractError(f"gate artifact contains duplicate evidence identity/path: {gate}")
        evidence_ids.add(item["evidenceId"])
        evidence_paths.add(item["artifactPath"])
        if timestamp(item.get("verifiedAt"), "gateEvidence.verifiedAt") > verified_at:
            raise ContractError(f"gate evidence timestamp exceeds its artifact verification time: {gate}")
        evidence_bytes = evidence_loader(remote_commit, item["artifactPath"])
        if sha256_bytes(evidence_bytes) != item["sha256"]:
            raise ContractError(f"remote gate evidence hash mismatch: {gate}/{item['evidenceId']}")
    return artifact


def authorize_execution(input_path: Path, gate_evidence_path: Path) -> tuple[dict[str, Any], bytes, dict[str, Any]]:
    runtime = verify_remote_seal_and_checkpoint()
    ledger_path = ROOT / "protocol" / "early-detection" / "1.2.0" / "outcome-access-ledger.json"
    try:
        ledger = json.loads(ledger_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ContractError("live outcome ledger is unavailable") from exc
    events = ledger.get("events")
    if not isinstance(events, list) or not events:
        raise ContractError("no remotely checkpointed confirmatory execution authorization exists")
    authorization = events[-1]
    if authorization.get("eventType") != "confirmatory_execution_authorized":
        raise ContractError("latest outcome-access event does not authorize a confirmatory run")
    if authorization.get("protocolManifestSha256") != runtime["protocolManifestSha256"]:
        raise ContractError("execution authorization is bound to another protocol manifest")
    try:
        gate_bytes = gate_evidence_path.read_bytes()
    except OSError as exc:
        raise ContractError("gate evidence file is unavailable") from exc
    if sha256_bytes(gate_bytes) != authorization.get("gateEvidenceFileSha256"):
        raise ContractError("gate evidence file does not match the remotely checkpointed authorization")
    try:
        evidence = json.loads(gate_bytes.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ContractError("gate evidence file is invalid") from exc
    if evidence.get("schema") != "early-detection-execution-gate-evidence/v1" or evidence.get("protocol") != PROTOCOL:
        raise ContractError("gate evidence identity mismatch")
    if evidence.get("researchCorpusSha256") != authorization.get("researchCorpusSha256"):
        raise ContractError("research corpus identity differs from the authorization")
    required_evidence_gates = REQUIRED_GATES[2:]
    supplied = evidence.get("gates")
    if not isinstance(supplied, dict) or set(supplied) != set(required_evidence_gates):
        raise ContractError("gate evidence must contain exactly the eleven remotely anchored data/audit gates")
    gate_artifacts: dict[str, dict[str, Any]] = {}
    for gate in required_evidence_gates:
        row = supplied[gate]
        if not isinstance(row, dict) or row.get("status") != "PASS" or not re.fullmatch(r"[0-9a-f]{64}", str(row.get("artifactSha256", ""))):
            raise ContractError(f"gate evidence is not PASS with a valid artifact hash: {gate}")
        artifact_bytes = _remote_artifact_bytes(str(row.get("remoteCommit", "")), str(row.get("artifactPath", "")))
        if sha256_bytes(artifact_bytes) != row["artifactSha256"]:
            raise ContractError(f"remote gate artifact hash mismatch: {gate}")
        try:
            artifact = json.loads(artifact_bytes.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ContractError(f"remote gate artifact is not valid JSON: {gate}") from exc
        gate_artifacts[gate] = _validate_gate_artifact_identity(gate, artifact, authorization, str(row.get("remoteCommit", "")))
    try:
        input_bytes = input_path.read_bytes()
    except OSError as exc:
        raise ContractError("confirmatory input file is unavailable") from exc
    if sha256_bytes(input_bytes) != authorization.get("inputFileSha256"):
        raise ContractError("confirmatory input does not match the remotely checkpointed authorization")
    try:
        input_payload = json.loads(input_bytes.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ContractError("confirmatory input file is invalid") from exc
    _verify_input_component_manifest(input_payload, authorization, gate_artifacts)
    return authorization, input_bytes, runtime


def _availability_from_source(record: dict[str, Any], field: str) -> datetime:
    source_class = record.get("sourceClass")
    required = {
        "sec_filing": ("accepted_at", "observed_at"),
        "issuer_release": ("source_published_at", "observed_at"),
        "government_publication": ("source_published_at", "observed_at"),
        "research_publication": ("source_published_at", "observed_at"),
        "public_web": ("source_published_at", "observed_at"),
        "market_bar": ("bar_available_at", "observed_at"),
    }.get(source_class)
    if required is None:
        raise ContractError(f"{field} has an unknown source class")
    return max(timestamp(record.get(name), f"{field}.{name}") for name in required)


def _quarter_contract(observation: dict[str, Any]) -> list[dict[str, Any]]:
    entity = require_string(observation, "entityId")
    raw = observation.get("quarterRows")
    if not isinstance(raw, list):
        raise ContractError("quarterRows must be an array")
    rows: list[dict[str, Any]] = []
    sequences: set[int] = set()
    accessions: set[str] = set()
    metrics: set[str] = set()
    for item in raw:
        if not isinstance(item, dict) or item.get("entityId") != entity:
            raise ContractError("quarter row entity identity mismatch")
        year, quarter = item.get("fiscalYear"), item.get("fiscalQuarter")
        if not isinstance(year, int) or isinstance(year, bool) or not isinstance(quarter, int) or isinstance(quarter, bool) or not 1 <= quarter <= 4:
            raise ContractError("quarter row has an invalid fiscal identity")
        sequence = year * 4 + quarter - 1
        if sequence in sequences:
            raise ContractError("duplicate fiscal quarter")
        sequences.add(sequence)
        accession = require_string(item, "accessionId")
        if accession in accessions:
            raise ContractError("duplicate filing accession")
        accessions.add(accession)
        if item.get("form") not in ELIGIBLE_FORMS or item.get("sourceClass") != "sec_filing":
            raise ContractError("quarter rows require as-filed 10-Q/10-K SEC records")
        filing_at = max(timestamp(item.get("acceptedAt"), "quarter.acceptedAt"), timestamp(item.get("observedAt"), "quarter.observedAt"))
        sector_at = timestamp(item.get("sectorPercentileKnownAt"), "sectorPercentileKnownAt")
        value_at = timestamp(item.get("valueCaptureKnownAt"), "valueCaptureKnownAt")
        acquisition = item.get("acquisitionAvailability")
        if not isinstance(acquisition, dict):
            raise ContractError("acquisition availability is required")
        acquisition_at = _availability_from_source(acquisition, "acquisitionAvailability")
        if acquisition_at != timestamp(item.get("acquisitionContributionKnownAt"), "acquisitionContributionKnownAt"):
            raise ContractError("acquisition known-at does not equal latest source availability")
        numeric_fields = ("revenue", "sectorPercentile", "economicValue", "dilutedShares", "acquisitionRevenueShare")
        if any(isinstance(item.get(name), bool) or not isinstance(item.get(name), (int, float)) or not math.isfinite(item[name]) for name in numeric_fields):
            raise ContractError("quarter row has a missing or nonfinite economic input")
        if item["revenue"] < 0 or item["economicValue"] < 0 or item["dilutedShares"] <= 0 or not 0 <= item["acquisitionRevenueShare"] <= 1:
            raise ContractError("quarter row has an invalid economic input")
        metric = require_string(item, "economicMetric")
        metrics.add(metric)
        adjudication = item.get("valueCaptureAdjudication")
        if not isinstance(adjudication, dict) or adjudication.get("agreement") is not True:
            raise ContractError("blinded value-capture adjudication with agreement is required")
        decisions = adjudication.get("decisions")
        if not isinstance(decisions, list) or len(decisions) != 2 or any(not isinstance(decision, dict) for decision in decisions):
            raise ContractError("value-capture adjudication requires exactly two coder decisions")
        coder_ids = [decision.get("coderId") for decision in decisions]
        accepted_values = [decision.get("accepted") for decision in decisions]
        if any(not isinstance(coder, str) or not coder for coder in coder_ids) or len(set(coder_ids)) != 2 or any(not isinstance(value, bool) for value in accepted_values) or len(set(accepted_values)) != 1:
            raise ContractError("value-capture coder decisions are incomplete or disagree")
        evidence_ids = adjudication.get("evidenceSourceIds")
        if not isinstance(evidence_ids, list) or not evidence_ids or len(set(evidence_ids)) != len(evidence_ids):
            raise ContractError("value-capture adjudication requires evidence source ids")
        if timestamp(adjudication.get("knownAt"), "valueCaptureAdjudication.knownAt") != value_at:
            raise ContractError("value-capture adjudication timestamp mismatch")
        rows.append({
            **item, "sequence": sequence, "filingAt": filing_at, "sectorAt": sector_at,
            "valueAt": value_at, "acquisitionAt": acquisition_at,
            "outcomeKnownAt": max(filing_at, sector_at, value_at, acquisition_at),
            "valueCaptureAccepted": accepted_values[0],
        })
    if len(metrics) > 1:
        raise ContractError("economic metric changes within an entity")
    return sorted(rows, key=lambda row: row["sequence"])


def derive_growth_events(observation: dict[str, Any]) -> list[dict[str, Any]]:
    rows = _quarter_contract(observation)
    by_sequence = {row["sequence"]: row for row in rows}
    enriched: dict[int, dict[str, Any]] = {}
    for row in rows:
        prior_year = by_sequence.get(row["sequence"] - 4)
        enriched[row["sequence"]] = {
            **row,
            "yoy": row["revenue"] / prior_year["revenue"] - 1 if prior_year and prior_year["revenue"] > 0 else None,
            "economicYoy": row["economicValue"] / prior_year["economicValue"] - 1 if prior_year and prior_year["economicValue"] > 0 else None,
            "perShareYoy": (row["revenue"] / row["dilutedShares"]) / (prior_year["revenue"] / prior_year["dilutedShares"]) - 1
            if prior_year and prior_year["revenue"] > 0 and prior_year["dilutedShares"] > 0 else None,
        }
    events = []
    for sequence in sorted(enriched):
        row = enriched[sequence]
        prior = [enriched.get(key) for key in (sequence - 4, sequence - 3, sequence - 2, sequence - 1)]
        forward = [enriched.get(sequence + offset) for offset in range(1, 5)]
        if any(item is None for item in [*prior, *forward]):
            continue
        required_values = [row["yoy"], *[item["yoy"] for item in prior], *[value for item in forward for value in (item["yoy"], item["economicYoy"], item["perShareYoy"])]]
        if not all(isinstance(value, (int, float)) and math.isfinite(value) for value in required_values):
            continue
        prior_median = float(np.median([item["yoy"] for item in prior]))
        qualifies = (
            row["sectorPercentile"] >= 80
            and row["yoy"] - prior_median >= 0.05
            and sum(item["yoy"] > 0 for item in forward) >= 3
            and sum(item["economicYoy"] > 0 for item in forward) >= 3
            and sum(item["perShareYoy"] > 0 for item in forward) >= 3
            and all(item["acquisitionRevenueShare"] <= 0.5 for item in [row, *forward])
            and row["valueCaptureAccepted"] is True
        )
        if qualifies:
            maturity = max(row["outcomeKnownAt"], *[value for item in forward for value in (item["filingAt"], item["acquisitionAt"])])
            events.append({
                "eventId": f"{row['entityId']}:{row['fiscalYear']}:Q{row['fiscalQuarter']}",
                "entityId": row["entityId"], "eventAvailableAt": row["outcomeKnownAt"], "maturityAt": maturity,
                "sequence": sequence,
            })
            break
    return events


def _eligible_filings(observation: dict[str, Any], cutoff: datetime, after: datetime | None = None) -> list[dict[str, Any]]:
    signal_at = after if after is not None else timestamp(observation.get("signalAvailableAt"), "signalAvailableAt")
    rows = _quarter_contract(observation)
    filings = [row for row in rows if signal_at < row["filingAt"] <= cutoff]
    return sorted(filings, key=lambda row: (row["filingAt"], row["accessionId"]))


def label_observation(observation: dict[str, Any], analysis_cutoff_at: str) -> dict[str, Any]:
    cutoff = timestamp(analysis_cutoff_at, "analysisCutoffAt")
    require_string(observation, "entityId")
    require_string(observation, "listingId")
    signal_at = timestamp(observation.get("signalAvailableAt"), "signalAvailableAt")
    filings = _eligible_filings(observation, cutoff)
    horizon_at = filings[7]["filingAt"] if len(filings) >= 8 else None
    candidates = [event for event in derive_growth_events(observation) if event["eventAvailableAt"] > signal_at]
    within_horizon = next((event for event in candidates if horizon_at is not None and event["eventAvailableAt"] <= horizon_at), None)
    if within_horizon is not None:
        if within_horizon["maturityAt"] > cutoff:
            return {"status": "CENSORED", "reason": "positive_event_not_mature", "filingCount": len(filings)}
        return {
            "status": "POSITIVE", "filingCount": len(filings), "growthEventId": within_horizon["eventId"],
            "growthEventAvailableAt": within_horizon["eventAvailableAt"].isoformat().replace("+00:00", "Z"),
            "maturityAt": within_horizon["maturityAt"].isoformat().replace("+00:00", "Z"),
        }
    if horizon_at is not None:
        return {"status": "NEGATIVE", "filingCount": len(filings), "horizonAt": horizon_at.isoformat().replace("+00:00", "Z")}
    return {"status": "CENSORED", "reason": "fewer_than_eight_filings", "filingCount": len(filings)}


def nearest_rank(values: np.ndarray, probability: float) -> float:
    if values.size == 0:
        return math.nan
    ordered = np.sort(values)
    rank = max(1, math.ceil(probability * ordered.size))
    return float(ordered[rank - 1])


def interval(values: list[float]) -> list[float] | None:
    if len(values) != BOOTSTRAP_REPLICATES or any(not math.isfinite(value) for value in values):
        return None
    finite = np.asarray(values, dtype=float)
    return [nearest_rank(finite, 0.025), nearest_rank(finite, 0.975)]


def one_sided_lower(values: list[float]) -> float | None:
    if len(values) != BOOTSTRAP_REPLICATES or any(not math.isfinite(value) for value in values):
        return None
    return nearest_rank(np.asarray(values, dtype=float), 0.05)


def ratio(numerator: float, denominator: float) -> float:
    return numerator / denominator if denominator > 0 else math.nan


def _pre_breakout(observation: dict[str, Any], label: dict[str, Any]) -> bool | None:
    if label["status"] != "POSITIVE":
        return None
    signal_at = timestamp(observation.get("signalAvailableAt"), "signalAvailableAt")
    outcome_at = timestamp(label["growthEventAvailableAt"], "growthEventAvailableAt")
    if _price_sessions_before(observation, outcome_at) < 315:
        return None
    breakout_at = _primary_breakout_available_at(observation)
    if breakout_at is None:
        return True
    if breakout_at >= outcome_at:
        return True
    return signal_at < breakout_at


def _bars_contract(bars: Any, label: str) -> list[dict[str, Any]]:
    if not isinstance(bars, list):
        raise ContractError(f"{label} must be an array")
    seen = set()
    prepared = []
    for bar in bars:
        if not isinstance(bar, dict) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(bar.get("date", ""))):
            raise ContractError(f"{label} date is invalid")
        if bar["date"] in seen:
            raise ContractError(f"duplicate {label} date")
        seen.add(bar["date"])
        close = bar.get("close")
        if isinstance(close, bool) or not isinstance(close, (int, float)) or not math.isfinite(close) or close <= 0:
            raise ContractError(f"{label} close is invalid")
        close_at = timestamp(bar.get("closeAt"), "priceBar.closeAt")
        next_open = timestamp(bar.get("nextOpenAt"), "priceBar.nextOpenAt")
        if next_open <= close_at or not str(bar["closeAt"]).startswith(f"{bar['date']}T"):
            raise ContractError(f"{label} close/next-open timing is invalid")
        prepared.append({**bar, "close": float(close), "_closeAt": close_at, "_nextOpenAt": next_open})
    prepared.sort(key=lambda row: row["date"])
    if any(prepared[index - 1]["_closeAt"] >= prepared[index]["_closeAt"] for index in range(1, len(prepared))):
        raise ContractError(f"{label} is not chronologically ordered")
    return prepared


def _price_contract(observation: dict[str, Any]) -> list[dict[str, Any]]:
    history = observation.get("priceHistory")
    if not isinstance(history, dict) or history.get("adjustmentPolicy") != "point_in_time_total_return" or history.get("corporateActionKnownAtPolicy") != "point_in_time":
        raise ContractError("point-in-time adjusted price-history metadata is required")
    return _bars_contract(history.get("bars"), "priceHistory.bars")


def _breakout_rows(bars: list[dict[str, Any]], lookback: int) -> list[dict[str, Any]]:
    result = []
    previous_raw = -10**9
    for index in range(lookback, len(bars)):
        if bars[index]["close"] > max(row["close"] for row in bars[index - lookback:index]):
            if index >= lookback + 63 and index - previous_raw > 63:
                result.append(bars[index])
            previous_raw = index
    return result


def _aligned_return(stock: list[dict[str, Any]], benchmark: list[dict[str, Any]], sessions: int, end_at: datetime) -> float | None:
    benchmark_by_date = {row["date"]: row["close"] for row in benchmark if row["_closeAt"] <= end_at}
    eligible = [row for row in stock if row["_closeAt"] <= end_at and row["date"] in benchmark_by_date]
    if len(eligible) <= sessions:
        return None
    start, end = eligible[-1 - sessions], eligible[-1]
    return end["close"] / start["close"] - benchmark_by_date[end["date"]] / benchmark_by_date[start["date"]]


def _validate_panel_anchor(ordered: list[dict[str, Any]], label: str) -> str:
    if not ordered:
        raise ContractError(f"{label} is empty")
    first_month = ordered[0].get("vintageMonth")
    anchors = {row.get("historyCompleteFrom") for row in ordered}
    start_reasons = {row.get("panelStartReason") for row in ordered}
    if len(anchors) != 1 or next(iter(anchors)) != first_month or len(start_reasons) != 1:
        raise ContractError(f"{label} lacks one explicit, internally consistent completeness anchor")
    start_reason = next(iter(start_reasons))
    if start_reason not in {"effective_listing_start", "study_start", "data_start"}:
        raise ContractError(f"{label} has an invalid panel-start reason")
    listing_start = start_reason == "effective_listing_start"
    if ordered[0].get("isListingStartVintage") is not listing_start or any(row.get("isListingStartVintage") is not (listing_start and index == 0) for index, row in enumerate(ordered)):
        raise ContractError(f"{label} listing-start flags contradict the panel-start reason")
    if start_reason == "study_start" and first_month != "2009-01":
        raise ContractError(f"{label} study_start must equal the frozen 2009-01 primary anchor")
    listing_months = {row.get("listingStartMonth") for row in ordered}
    if listing_start and (listing_months != {first_month}):
        raise ContractError(f"{label} effective listing start is not bound to the ledger month")
    if not listing_start and any(value is not None for value in listing_months):
        raise ContractError(f"{label} carries a listing-start month without a listing-start anchor")
    return start_reason


def _market_levels(observation: dict[str, Any]) -> list[dict[str, Any]]:
    history = observation.get("priceHistory")
    if not isinstance(history, dict):
        raise ContractError("priceHistory is required for market recognition")
    stock = _price_contract(observation)
    sector = _bars_contract(history.get("sectorBars"), "priceHistory.sectorBars")
    market = _bars_contract(history.get("marketBars"), "priceHistory.marketBars")
    calendar = observation.get("marketVintageCalendar")
    if not isinstance(calendar, list) or len(calendar) < 2:
        raise ContractError("marketVintageCalendar requires at least two consecutive months")
    ordered = sorted(calendar, key=lambda row: str(row.get("vintageMonth")))
    start_reason = _validate_panel_anchor(ordered, "market vintage calendar")
    result = []
    breakout126 = _breakout_rows(stock, 126)
    breakout252 = _breakout_rows(stock, 252)
    for index, row in enumerate(ordered):
        if row.get("entityId") != observation.get("entityId") or row.get("listingId") != observation.get("listingId") or not re.fullmatch(r"\d{4}-\d{2}", str(row.get("vintageMonth", ""))):
            raise ContractError("market vintage month is invalid")
        close_at = timestamp(row.get("closeAt"), "marketVintage.closeAt")
        next_open = timestamp(row.get("nextOpenAt"), "marketVintage.nextOpenAt")
        if next_open <= close_at or (index and ordered[index - 1]["vintageMonth"] != _previous_month(row["vintageMonth"])):
            raise ContractError("market vintage calendar timing is invalid or gapped")
        previous_close = timestamp(ordered[index - 1]["closeAt"], "previousMarketVintage.closeAt") if index else None
        month_start = datetime(int(row["vintageMonth"][:4]), int(row["vintageMonth"][5:7]), 1, tzinfo=timezone.utc)
        window_start = previous_close if previous_close is not None else month_start
        recent126 = [item for item in breakout126 if window_start < item["_closeAt"] <= close_at]
        recent252 = [item for item in breakout252 if window_start < item["_closeAt"] <= close_at]
        relatives = [_aligned_return(stock, benchmark, sessions, close_at) for benchmark in (sector, market) for sessions in (63, 126)]
        if any(value is None for value in relatives) or sum(item["_closeAt"] <= close_at for item in stock) < 315:
            result.append({
                "vintageMonth": row["vintageMonth"], "signalAvailableAt": row["nextOpenAt"],
                "M": 0, "computable": False, "notComputableReason": "insufficient_frozen_price_history",
                "panelStartReason": start_reason,
            })
            continue
        if recent252 and (_aligned_return(stock, sector, 126, recent252[-1]["_closeAt"]) or 0) > 0:
            level = 3
        elif recent126:
            level = 2
        elif all(value > 0 for value in relatives):
            level = 1
        else:
            level = 0
        result.append({
            "vintageMonth": row["vintageMonth"], "signalAvailableAt": row["nextOpenAt"],
            "M": level, "computable": True, "panelStartReason": start_reason,
        })
    return result


def _market_level_at(observation: dict[str, Any]) -> int:
    market_row = next((row for row in _market_levels(observation) if row["vintageMonth"] == observation.get("vintageMonth")), None)
    if market_row is None:
        raise ContractError("observation vintage is absent from market vintage calendar")
    if market_row["computable"] is not True:
        raise ContractError("market recognition is not computable at the observation vintage")
    return market_row["M"]


def _market_regime(observation: dict[str, Any]) -> str:
    history = observation.get("priceHistory")
    market = _bars_contract(history.get("marketBars") if isinstance(history, dict) else None, "priceHistory.marketBars")
    calendar = observation.get("marketVintageCalendar")
    current = next((row for row in calendar or [] if row.get("vintageMonth") == observation.get("vintageMonth")), None)
    if current is None:
        raise ContractError("regime vintage is absent from market calendar")
    close_at = timestamp(current.get("closeAt"), "regimeVintage.closeAt")
    bars = [row for row in market if row["_closeAt"] <= close_at]
    if len(bars) < 252:
        raise ContractError("market regime lacks 252 sessions")
    close = bars[-1]["close"]
    high252 = max(row["close"] for row in bars[-252:])
    drawdown = close / high252 - 1
    if drawdown <= -0.20:
        return "bear"
    prior126 = bars[-127:-1]
    prior_bear = any(row["close"] / max(item["close"] for item in bars[max(0, index - 251):index + 1]) - 1 <= -0.20
                     for index, row in enumerate(bars[-127:-1], start=len(bars) - 127))
    sma200 = sum(row["close"] for row in bars[-200:]) / 200
    if prior_bear and close >= sma200:
        return "recovery"
    return126 = close / bars[-127]["close"] - 1
    if close > sma200 and return126 > 0 and drawdown > -0.10:
        return "bull"
    return "neutral"


def _primary_breakout_available_at(observation: dict[str, Any]) -> datetime | None:
    bars = _price_contract(observation)
    breakouts = _breakout_rows(bars, 252)
    return breakouts[0]["_nextOpenAt"] if breakouts else None


def _price_sessions_before(observation: dict[str, Any], instant: datetime) -> int:
    return sum(row["_closeAt"] < instant for row in _price_contract(observation))


def _lead(observation: dict[str, Any], label: dict[str, Any]) -> dict[str, Any] | None:
    if label["status"] != "POSITIVE":
        return None
    signal_at = timestamp(observation.get("signalAvailableAt"), "signalAvailableAt")
    maturity_at = timestamp(label["maturityAt"], "maturityAt")
    filings = _eligible_filings(observation, maturity_at)
    gqs_at = _first_gqs_available_at(observation, through_at=maturity_at)
    if gqs_at is not None:
        if gqs_at <= signal_at:
            return {"filingEvents": 0, "censored": False}
        if gqs_at <= maturity_at:
            count = sum(signal_at < row["filingAt"] < gqs_at for row in filings)
            return {"filingEvents": count, "censored": False}
    count = sum(signal_at < row["filingAt"] <= maturity_at for row in filings)
    return {"filingEvents": count, "censored": True}


def _first_gqs_available_at(observation: dict[str, Any], through_at: datetime | None = None, require_followup: bool = True) -> datetime | None:
    panel = observation.get("historicalGqsPanel")
    calendar = observation.get("gqsVintageCalendar")
    if not isinstance(panel, list) or not panel or not isinstance(calendar, list) or not calendar:
        raise ContractError("complete historical GQS panel is required")
    entity = require_string(observation, "entityId")
    listing = require_string(observation, "listingId")
    ordered_calendar = sorted(calendar, key=lambda row: str(row.get("vintageMonth")))
    calendar_by_month = {}
    for index, row in enumerate(ordered_calendar):
        month = row.get("vintageMonth")
        if not re.fullmatch(r"\d{4}-\d{2}", str(month or "")) or (index and ordered_calendar[index - 1]["vintageMonth"] != _previous_month(month)):
            raise ContractError("historical GQS calendar is invalid or gapped")
        close_at = timestamp(row.get("closeAt"), "gqsVintage.closeAt")
        next_open = timestamp(row.get("nextOpenAt"), "gqsVintage.nextOpenAt")
        if next_open <= close_at:
            raise ContractError("historical GQS calendar timing is invalid")
        calendar_by_month[month] = {**row, "_nextOpen": next_open}
    ordered_panel = sorted(panel, key=lambda row: str(row.get("vintageMonth")))
    if len(ordered_panel) != len(ordered_calendar) or [row.get("vintageMonth") for row in ordered_panel] != [row.get("vintageMonth") for row in ordered_calendar]:
        raise ContractError("historical GQS panel does not exactly cover its sealed calendar")
    start_reason = _validate_panel_anchor(ordered_panel, "historical GQS panel")
    if start_reason == "data_start":
        raise ContractError("data-start GQS history cannot identify a primary first qualification")
    if through_at is not None and calendar_by_month[ordered_calendar[-1]["vintageMonth"]]["_nextOpen"] < through_at:
        raise ContractError("historical GQS panel ends before the required follow-up")
    seen = set()
    qualified = []
    for row in ordered_panel:
        if not isinstance(row, dict) or row.get("entityId") != entity or row.get("listingId") != listing \
                or row.get("protocol") != "GQS-00@1.0.0" or not isinstance(row.get("qualified"), bool):
            raise ContractError("historical GQS panel row is invalid")
        snapshot_id = require_string(row, "snapshotId")
        if snapshot_id in seen or not re.fullmatch(r"[0-9a-f]{64}", str(row.get("snapshotSha256", ""))):
            raise ContractError("duplicate historical GQS snapshot")
        seen.add(snapshot_id)
        available_at = timestamp(row.get("availableAt"), "historicalGqs.availableAt")
        if available_at != calendar_by_month[row["vintageMonth"]]["_nextOpen"]:
            raise ContractError("historical GQS snapshot is not bound to its sealed vintage")
        if row["qualified"] and (through_at is None or available_at <= through_at):
            qualified.append(available_at)
    if start_reason != "effective_listing_start" and ordered_panel[0]["qualified"]:
        raise ContractError("historical GQS first qualification is left-censored at the panel anchor")
    return min(qualified) if qualified else None


def _growth_visible_at(observation: dict[str, Any], evaluation_at: datetime) -> bool | None:
    rows = _quarter_contract(observation)
    available = {row["sequence"]: row for row in rows if row["filingAt"] <= evaluation_at and row["sectorAt"] <= evaluation_at}
    assessments = []
    for sequence in sorted(available):
        window = [available.get(key) for key in range(sequence - 8, sequence + 1)]
        if any(item is None for item in window):
            continue
        row = available[sequence]
        prior_year = available[sequence - 4]
        if prior_year["revenue"] <= 0:
            continue
        yoy = row["revenue"] / prior_year["revenue"] - 1
        prior_yoy = []
        for prior_sequence in range(sequence - 4, sequence):
            prior = available[prior_sequence]
            denominator = available[prior_sequence - 4]["revenue"]
            if denominator <= 0:
                prior_yoy = []
                break
            prior_yoy.append(prior["revenue"] / denominator - 1)
        if len(prior_yoy) == 4:
            assessments.append(row["sectorPercentile"] >= 80 and yoy - float(np.median(prior_yoy)) >= 0.05)
    return any(assessments) if assessments else None


def _candidate_panel(observation: dict[str, Any]) -> list[dict[str, Any]]:
    panel = observation.get("candidatePanel")
    if not isinstance(panel, list) or not panel:
        raise ContractError("FEM observation requires a complete raw candidate panel")
    entity = require_string(observation, "entityId")
    listing = require_string(observation, "listingId")
    calendar = observation.get("marketVintageCalendar")
    if not isinstance(calendar, list):
        raise ContractError("candidate panel requires the sealed market vintage calendar")
    calendar_by_month = {row.get("vintageMonth"): row for row in calendar}
    calendar_sha = canonical_sha256(calendar)
    market_by_month = {row["vintageMonth"]: row["M"] for row in _market_levels(observation)}
    ordered_raw = sorted(panel, key=lambda row: str(row.get("vintageMonth")))
    start_reason = _validate_panel_anchor(ordered_raw, "candidate panel")
    derived = []
    for index, row in enumerate(ordered_raw):
        if not isinstance(row, dict) or "state" in row:
            raise ContractError("prepared candidate states are prohibited")
        month = row.get("vintageMonth")
        calendar_row = calendar_by_month.get(month)
        if row.get("entityId") != entity or row.get("listingId") != listing or not re.fullmatch(r"\d{4}-\d{2}", str(month or "")) or calendar_row is None:
            raise ContractError("candidate panel entity/listing/calendar identity is invalid")
        if index and ordered_raw[index - 1]["vintageMonth"] != _previous_month(month):
            raise ContractError("candidate panel contains a skipped month")
        evaluation_at = timestamp(row.get("evaluationAt"), "candidatePanel.evaluationAt")
        signal_at = timestamp(row.get("signalAvailableAt"), "candidatePanel.signalAvailableAt")
        if evaluation_at != timestamp(calendar_row.get("closeAt"), "marketVintage.closeAt") or signal_at != timestamp(calendar_row.get("nextOpenAt"), "marketVintage.nextOpenAt") or row.get("vintageCalendarSha256") != calendar_sha:
            raise ContractError("candidate panel timing/hash is not bound to the sealed calendar")
        levels = [row.get(name) for name in ("T", "E", "L")]
        if any(not isinstance(value, int) or isinstance(value, bool) or not 0 <= value <= 3 for value in levels):
            raise ContractError("candidate T/E/L levels must be integers from 0 to 3")
        theme = require_string(row, "themeId")
        evidence = row.get("dimensionEvidence")
        sources = row.get("evidenceSources")
        if not isinstance(evidence, dict) or not isinstance(sources, list):
            raise ContractError("candidate dimensions require evidence and source records")
        source_map = {}
        for source in sources:
            if not isinstance(source, dict):
                raise ContractError("candidate evidence source is invalid")
            source_id = require_string(source, "sourceId")
            if source_id in source_map or not re.fullmatch(r"[0-9a-f]{64}", str(source.get("payloadSha256", ""))):
                raise ContractError("candidate evidence source identity/hash is invalid")
            source_map[source_id] = source
        for dimension, level in zip(("T", "E", "L"), levels):
            item = evidence.get(dimension)
            if not isinstance(item, dict) or item.get("level") != level or item.get("entityId") != entity or item.get("listingId") != listing or item.get("themeId") != theme:
                raise ContractError(f"{dimension} evidence identity/level mismatch")
            source_ids = item.get("sourceIds")
            if not isinstance(source_ids, list) or not source_ids or len(set(source_ids)) != len(source_ids) or any(source_id not in source_map for source_id in source_ids):
                raise ContractError(f"{dimension} evidence source ids are invalid")
            known_at = timestamp(item.get("knownAt"), f"{dimension}.knownAt")
            source_known = [_availability_from_source(source_map[source_id], f"{dimension}.source") for source_id in source_ids]
            if known_at != max(source_known) or known_at > evaluation_at:
                raise ContractError(f"{dimension} evidence known-at is invalid")
        if row.get("managementOnly") is True and row["L"] > 1:
            raise ContractError("management-only operational evidence cannot exceed L1")
        visible = _growth_visible_at(observation, evaluation_at) if row["T"] >= 2 and row["E"] >= 2 and row["L"] >= 2 else False
        if row["T"] >= 2 and row["E"] >= 2 and row["L"] >= 2 and visible is None:
            state = "REJECTED_HOLD"
        elif _first_gqs_available_at(observation, through_at=signal_at, require_followup=False) is not None:
            state = "GQS_CONFIRMED"
        elif row.get("dataQuality") not in {"accepted", "verified"} or row.get("contradicted") is True:
            state = "REJECTED_HOLD"
        elif row["T"] >= 2 and row["E"] >= 2 and row["L"] >= 2 and visible is False:
            state = "MARKET_CONFIRMING" if market_by_month[month] >= 2 else "PRE_GROWTH_CANDIDATE"
        elif row["T"] >= 2 and row["E"] >= 2 and row["L"] >= 1:
            state = "RESEARCH_WATCH"
        else:
            state = "REJECTED_HOLD"
        derived.append({**row, "state": state, "growthVisible": visible, "M": market_by_month[month], "panelStartReason": start_reason})
    return derived


def _validate_fem_primary_signal(signal: dict[str, Any]) -> dict[str, Any]:
    ordered = _candidate_panel(signal)
    if ordered[0]["panelStartReason"] == "data_start":
        raise ContractError("data-start candidate panels cannot identify a primary first FEM signal")
    eligible = {"PRE_GROWTH_CANDIDATE", "MARKET_CONFIRMING"}
    transitions = [row for index, row in enumerate(ordered) if row["state"] in eligible and (index == 0 or ordered[index - 1]["state"] not in eligible)]
    if not transitions:
        raise ContractError("candidate panel contains no FEM transition")
    first = transitions[0]
    if first is ordered[0] and first.get("isListingStartVintage") is not True:
        raise ContractError("first FEM transition is left-censored")
    if signal.get("vintageMonth") != first["vintageMonth"] or signal.get("signalAvailableAt") != first["signalAvailableAt"]:
        raise ContractError("FEM signal is not the first eligible transition")
    return {
        **signal,
        "T": first["T"], "E": first["E"], "L": first["L"], "M": first["M"],
        "themeId": first["themeId"], "state": first["state"],
    }


def _derive_fem_control(control: dict[str, Any]) -> dict[str, Any]:
    ordered = _candidate_panel(control)
    if ordered[0]["panelStartReason"] == "data_start":
        raise ContractError("data-start candidate panels cannot prove a never-signalled control")
    current = next((row for row in ordered if row["vintageMonth"] == control.get("vintageMonth")), None)
    if current is None or current["signalAvailableAt"] != control.get("signalAvailableAt"):
        raise ContractError("control vintage is absent from its candidate panel")
    eligible = {"PRE_GROWTH_CANDIDATE", "MARKET_CONFIRMING"}
    history = [row for row in ordered if row["vintageMonth"] <= control["vintageMonth"]]
    if any(row["state"] in eligible for row in history):
        raise ContractError("control was or is a primary FEM candidate")
    return {
        **control,
        "T": current["T"], "E": current["E"], "L": current["L"], "M": current["M"],
        "themeId": current["themeId"], "state": current["state"], "neverPrimarySignalled": True,
    }


def _validate_technical_control(control: dict[str, Any]) -> dict[str, Any]:
    ordered = _market_levels(control)
    if ordered[0]["panelStartReason"] == "data_start":
        raise ContractError("data-start market panels cannot prove a never-signalled technical control")
    computable = [row for row in ordered if row["computable"]]
    if not computable:
        raise ContractError("technical control has no computable market vintage")
    if computable[0]["M"] >= 2:
        raise ContractError("technical control is left-censored in M2/M3")
    current_index = None
    for index, row in enumerate(ordered):
        if row["vintageMonth"] == control.get("vintageMonth"):
            current_index = index
    if current_index is None or ordered[current_index].get("signalAvailableAt") != control.get("signalAvailableAt"):
        raise ContractError("technical control vintage is absent from its panel")
    if ordered[current_index]["computable"] is not True:
        raise ContractError("technical control market level is not computable at its vintage")
    history = [row for row in ordered[:current_index + 1] if row["computable"]]
    for index in range(1, len(history)):
        if history[index - 1]["M"] <= 1 and history[index]["M"] >= 2:
            raise ContractError("technical control already had an M2/M3 transition")
    return {**control, "state": "TECHNICAL_NON_SIGNAL", "neverPrimarySignalled": True}


def _derive_match_sets(raw_signals: Any, raw_control_pool: Any, cutoff: str, technical_only: bool = False) -> tuple[list[dict[str, Any]], dict[str, int], list[dict[str, Any]]]:
    if not isinstance(raw_signals, list) or not isinstance(raw_control_pool, list):
        raise ContractError("signals and complete eligible control pool must be arrays")
    if any(not isinstance(row, dict) for row in raw_signals):
        raise ContractError("signal rows must be objects")
    prepared_signals = []
    for row in raw_signals:
        with_regime = {**row, "marketRegime": _market_regime(row)}
        if technical_only:
            _validate_technical_transition(with_regime)
            if {"T", "E", "L", "G", "themeId"}.intersection(with_regime):
                raise ContractError("technical-only signal contains prohibited theme/fundamental fields")
            prepared_signals.append(with_regime)
        else:
            prepared_signals.append(_validate_fem_primary_signal(with_regime))
    signals = sorted(prepared_signals, key=lambda row: (str(row.get("signalAvailableAt")), str(row.get("entityId")), str(row.get("listingId"))))
    signal_entities = {require_string(row, "entityId") for row in signals}
    if len(signal_entities) != len(signals):
        raise ContractError("duplicate primary signal entity")
    controls_by_key: dict[tuple[str, str, str], list[dict[str, Any]]] = {}
    for raw in raw_control_pool:
        if not isinstance(raw, dict):
            raise ContractError("control-pool row must be an object")
        if technical_only and {"T", "E", "L", "G", "themeId"}.intersection(raw):
            raise ContractError("technical-only control contains prohibited theme/fundamental fields")
        raw_with_regime = {**raw, "marketRegime": _market_regime(raw)}
        control = _validate_technical_control(raw_with_regime) if technical_only else _derive_fem_control(raw_with_regime)
        key = (str(control.get("sectorBranch")), str(control.get("vintageMonth")), str(control.get("marketRegime")))
        controls_by_key.setdefault(key, []).append(control)
    used_entities = set(signal_entities)
    prepared = []
    unmatched_by_split: dict[str, int] = {}
    for signal in signals:
        signal_features = _match_features(signal, technical_only)
        key = (signal["sectorBranch"], signal["vintageMonth"], signal["marketRegime"])
        candidates = []
        for control in controls_by_key.get(key, []):
            if control["entityId"] in used_entities:
                continue
            try:
                _validate_match(signal, control, technical_only)
            except ContractError:
                continue
            control_features = _match_features(control, technical_only)
            calipers = {"logMarketCap": 0.50, "listingAgeSessions": 252.0, "logDollarVolume": 1.0}
            if not technical_only:
                calipers["relativeReturn"] = 0.15
            distance = sum(((signal_features[name] - control_features[name]) / limit) ** 2 for name, limit in calipers.items())
            candidates.append((distance, control["entityId"], control["listingId"], control))
        unique = []
        local_seen = set()
        for _, entity, _, control in sorted(candidates, key=lambda item: (item[0], item[1], item[2])):
            if entity not in local_seen:
                local_seen.add(entity)
                unique.append(control)
            if len(unique) == 5:
                break
        split = split_for(signal["signalAvailableAt"])
        if len(unique) < 5:
            unmatched_by_split[split] = unmatched_by_split.get(split, 0) + 1
            continue
        used_entities.update(control["entityId"] for control in unique)
        prepared.append({
            "signal": {"row": signal, "label": label_observation(signal, cutoff)},
            "controls": [{"row": control, "label": label_observation(control, cutoff)} for control in unique],
            "split": split,
        })
    return prepared, unmatched_by_split, signals


def _match_features(row: dict[str, Any], technical_only: bool) -> dict[str, float]:
    if row.get("isPrimaryListing") is not True or not re.fullmatch(r"\d{4}-\d{2}", str(row.get("vintageMonth", ""))):
        raise ContractError("match row lacks primary-listing or monthly-vintage identity")
    if not isinstance(row.get("sectorBranch"), str) or not row["sectorBranch"] or row.get("marketRegime") not in REGIMES:
        raise ContractError("match row lacks frozen sector branch or market regime")
    calendar = row.get("marketVintageCalendar")
    current = next((item for item in calendar or [] if item.get("vintageMonth") == row.get("vintageMonth")), None)
    if current is None:
        raise ContractError("match vintage is absent from market calendar")
    close_at = timestamp(current.get("closeAt"), "matchVintage.closeAt")
    if timestamp(current.get("nextOpenAt"), "matchVintage.nextOpenAt") != timestamp(row.get("signalAvailableAt"), "signalAvailableAt"):
        raise ContractError("signal/control availability is not the sealed next market open")
    stock = [item for item in _price_contract(row) if item["_closeAt"] <= close_at]
    if len(stock) < 126:
        raise ContractError("match row lacks price history")
    shares = row.get("sharesOutstandingAtVintage")
    if isinstance(shares, bool) or not isinstance(shares, (int, float)) or not math.isfinite(shares) or shares <= 0:
        raise ContractError("shares outstanding at vintage are invalid")
    if timestamp(row.get("sharesOutstandingKnownAt"), "sharesOutstandingKnownAt") > close_at:
        raise ContractError("shares outstanding were not known at the match vintage")
    cap = shares * stock[-1]["close"]
    last120 = stock[-120:]
    dollar_volumes = []
    for item in last120:
        volume = item.get("volume")
        if isinstance(volume, bool) or not isinstance(volume, (int, float)) or not math.isfinite(volume) or volume < 0:
            raise ContractError("match price bars require valid volume")
        dollar_volumes.append(item["close"] * volume)
    median_dollar_volume = float(np.median(dollar_volumes))
    if median_dollar_volume <= 0:
        raise ContractError("median dollar volume is nonpositive")
    features = {"logMarketCap": math.log(cap), "listingAgeSessions": float(len(stock)), "logDollarVolume": math.log(median_dollar_volume)}
    if not technical_only:
        history = row.get("priceHistory")
        sector = _bars_contract(history.get("sectorBars") if isinstance(history, dict) else None, "priceHistory.sectorBars")
        relative = _aligned_return(stock, sector, 126, close_at)
        if relative is None or not math.isfinite(relative):
            raise ContractError("sector-relative return is not computable at the match vintage")
        features["relativeReturn"] = relative
    return features


def _validate_match(signal: dict[str, Any], control: dict[str, Any], technical_only: bool) -> None:
    if control.get("sectorBranch") != signal.get("sectorBranch") or control.get("vintageMonth") != signal.get("vintageMonth") or control.get("marketRegime") != signal.get("marketRegime"):
        raise ContractError("control exact-match fields differ from signal")
    if control.get("neverPrimarySignalled") is not True or control.get("state") in {"PRE_GROWTH_CANDIDATE", "MARKET_CONFIRMING"}:
        raise ContractError("control is not an eligible never-signalled observation")
    left = _match_features(signal, technical_only)
    right = _match_features(control, technical_only)
    calipers = {"logMarketCap": 0.50, "listingAgeSessions": 252.0, "logDollarVolume": 1.0}
    if not technical_only:
        calipers["relativeReturn"] = 0.15
    if any(abs(left[name] - right[name]) > limit for name, limit in calipers.items()):
        raise ContractError("control is outside a frozen matching caliper")


def _previous_month(value: str) -> str:
    year, month = (int(part) for part in value.split("-"))
    return f"{year - 1}-12" if month == 1 else f"{year}-{month - 1:02d}"


def _validate_technical_transition(signal: dict[str, Any]) -> int:
    ordered = _market_levels(signal)
    if ordered[0]["panelStartReason"] == "data_start":
        raise ContractError("data-start market panels cannot identify a primary technical transition")
    computable = [row for row in ordered if row["computable"]]
    if not computable:
        raise ContractError("technical signal has no computable market vintage")
    if computable[0]["M"] >= 2:
        raise ContractError("technical signal is left-censored in M2/M3")
    transitions = []
    for index, row in enumerate(computable):
        if index and computable[index - 1]["M"] <= 1 and row["M"] >= 2:
            transitions.append(row)
    if not transitions:
        raise ContractError("technical panel contains no M0/M1 to M2/M3 transition")
    first = transitions[0]
    if signal.get("vintageMonth") != first["vintageMonth"] or signal.get("signalAvailableAt") != first["signalAvailableAt"]:
        raise ContractError("technical-only signal is not the first panel transition")
    return first["M"]


def _precision_metrics(sets: list[dict[str, Any]]) -> dict[str, Any]:
    signals = [item["signal"] for item in sets if item["signal"]["label"]["status"] != "CENSORED"]
    controls = [control for item in sets for control in item["controls"] if control["label"]["status"] != "CENSORED"]
    signal_positive = sum(item["label"]["status"] == "POSITIVE" for item in signals)
    control_positive = sum(item["label"]["status"] == "POSITIVE" for item in controls)
    signal_precision = ratio(signal_positive, len(signals))
    control_precision = ratio(control_positive, len(controls))
    lift = ratio(signal_precision, control_precision)
    return {
        "signalMature": len(signals), "signalPositive": signal_positive, "signalPrecision": signal_precision,
        "controlMature": len(controls), "controlPositive": control_positive, "controlPrecision": control_precision,
        "precisionLift": lift,
    }


def _bootstrap_sets(sets: list[dict[str, Any]], seed: int) -> dict[str, Any]:
    if not sets:
        return {"precisionLift95": None, "precisionLiftOneSided95Lower": None, "preBreakoutDifference95": None}
    rng = np.random.Generator(np.random.PCG64(seed))
    lifts: list[float] = []
    breakout_differences: list[float] = []
    for _ in range(BOOTSTRAP_REPLICATES):
        sample = [sets[index] for index in rng.integers(0, len(sets), size=len(sets))]
        metrics = _precision_metrics(sample)
        lifts.append(metrics["precisionLift"])
        signal_pre: list[bool] = []
        control_pre: list[bool] = []
        for item in sample:
            value = _pre_breakout(item["signal"]["row"], item["signal"]["label"])
            if value is not None:
                signal_pre.append(value)
            for control in item["controls"]:
                value = _pre_breakout(control["row"], control["label"])
                if value is not None:
                    control_pre.append(value)
        signal_share = ratio(sum(signal_pre), len(signal_pre))
        control_share = ratio(sum(control_pre), len(control_pre))
        breakout_differences.append(signal_share - control_share if math.isfinite(signal_share) and math.isfinite(control_share) else math.nan)
    return {
        "precisionLift95": interval(lifts), "precisionLiftOneSided95Lower": one_sided_lower(lifts),
        "preBreakoutDifference95": interval(breakout_differences),
    }


def _solve_irls(x: np.ndarray, y: np.ndarray) -> dict[str, Any]:
    if x.ndim != 2 or y.ndim != 1 or x.shape[0] != y.size or y.size == 0 or np.unique(y).size != 2:
        return {"status": "NOT_COMPUTABLE", "reason": "invalid_or_single_class_development_sample"}
    beta = np.zeros(x.shape[1], dtype=float)
    for iteration in range(1, 101):
        eta = x @ beta
        if not np.all(np.isfinite(eta)):
            return {"status": "NOT_COMPUTABLE", "reason": "nonfinite_linear_predictor"}
        probability = 1.0 / (1.0 + np.exp(-np.clip(eta, -700, 700)))
        weight = probability * (1.0 - probability)
        if np.any(weight <= 1e-15):
            return {"status": "NOT_COMPUTABLE", "reason": "complete_or_quasi_complete_separation"}
        information = x.T @ (weight[:, None] * x)
        score = x.T @ (y - probability)
        try:
            delta = np.linalg.solve(information, score)
        except np.linalg.LinAlgError:
            return {"status": "NOT_COMPUTABLE", "reason": "singular_information_matrix"}
        beta_next = beta + delta
        if not np.all(np.isfinite(beta_next)) or np.max(np.abs(beta_next)) > 20:
            return {"status": "NOT_COMPUTABLE", "reason": "coefficient_limit_or_nonfinite"}
        if np.max(np.abs(beta_next - beta)) < 1e-8:
            return {"status": "COMPUTABLE", "coefficients": beta_next.tolist(), "iterations": iteration}
        beta = beta_next
    return {"status": "NOT_COMPUTABLE", "reason": "failed_to_converge"}


def _log_loss(y: np.ndarray, probability: np.ndarray) -> float:
    clipped = np.clip(probability, 1e-15, 1.0 - 1e-15)
    return float(-np.mean(y * np.log(clipped) + (1.0 - y) * np.log(1.0 - clipped)))


def _average_precision(y: np.ndarray, probability: np.ndarray) -> float:
    positives = int(np.sum(y == 1))
    if positives == 0:
        return math.nan
    order = np.argsort(-probability, kind="stable")
    sorted_y = y[order]
    sorted_p = probability[order]
    cumulative_positive = 0
    cumulative_total = 0
    score = 0.0
    index = 0
    while index < len(sorted_y):
        end = index + 1
        while end < len(sorted_y) and sorted_p[end] == sorted_p[index]:
            end += 1
        group_positive = int(np.sum(sorted_y[index:end] == 1))
        cumulative_positive += group_positive
        cumulative_total = end
        score += (group_positive / positives) * (cumulative_positive / cumulative_total)
        index = end
    return score


def _technical_incrementality(sets: list[dict[str, Any]], all_signals: list[dict[str, Any]], cutoff: str) -> dict[str, Any]:
    rows: dict[str, tuple[dict[str, Any], dict[str, Any], str]] = {}
    observations = [{"row": signal, "label": label_observation(signal, cutoff)} for signal in all_signals]
    observations.extend(control for item in sets for control in item["controls"])
    for observation in observations:
            row = observation["row"]
            label = observation["label"]
            if label["status"] == "CENSORED":
                continue
            entity = row["entityId"]
            market_level = _market_level_at(row)
            values = [row.get(name) for name in ("T", "E", "L")] + [market_level]
            if any(not isinstance(value, int) or isinstance(value, bool) or not 0 <= value <= 3 for value in values):
                return {"status": "NOT_COMPUTABLE", "reason": "missing_or_invalid_ordinal_dimension"}
            split = split_for(row["signalAvailableAt"])
            if entity in rows:
                return {"status": "NOT_COMPUTABLE", "reason": "duplicate_entity_observation"}
            rows[entity] = ({**row, "M": market_level}, label, split)
    development = [value for value in rows.values() if value[2] == "development"]
    validation = [value for value in rows.values() if value[2] == "validation"]
    locked = [value for value in rows.values() if value[2] == "locked"]
    if not development or not locked:
        return {
            "status": "NOT_COMPUTABLE", "reason": "development_or_locked_sample_missing",
            "developmentRows": len(development), "validationRows": len(validation), "lockedRows": len(locked),
        }
    y_dev = np.asarray([item[1]["status"] == "POSITIVE" for item in development], dtype=float)
    y_locked = np.asarray([item[1]["status"] == "POSITIVE" for item in locked], dtype=float)
    reduced_dev = np.asarray([[1.0, item[0]["T"], item[0]["E"], item[0]["L"]] for item in development], dtype=float)
    full_dev = np.asarray([[1.0, item[0]["T"], item[0]["E"], item[0]["L"], item[0]["M"]] for item in development], dtype=float)
    reduced_fit = _solve_irls(reduced_dev, y_dev)
    full_fit = _solve_irls(full_dev, y_dev)
    if reduced_fit["status"] != "COMPUTABLE" or full_fit["status"] != "COMPUTABLE":
        return {"status": "NOT_COMPUTABLE", "reducedFit": reduced_fit, "fullFit": full_fit}
    reduced_locked = np.asarray([[1.0, item[0]["T"], item[0]["E"], item[0]["L"]] for item in locked], dtype=float)
    full_locked = np.asarray([[1.0, item[0]["T"], item[0]["E"], item[0]["L"], item[0]["M"]] for item in locked], dtype=float)
    p_reduced = 1.0 / (1.0 + np.exp(-(reduced_locked @ np.asarray(reduced_fit["coefficients"]))))
    p_full = 1.0 / (1.0 + np.exp(-(full_locked @ np.asarray(full_fit["coefficients"]))))
    reduced_loss = _log_loss(y_locked, p_reduced)
    full_loss = _log_loss(y_locked, p_full)
    point = (reduced_loss - full_loss) / reduced_loss if reduced_loss > 0 else math.nan
    rng = np.random.Generator(np.random.PCG64(20260809))
    boot: list[float] = []
    for _ in range(BOOTSTRAP_REPLICATES):
        indices = rng.integers(0, len(locked), size=len(locked))
        loss_reduced = _log_loss(y_locked[indices], p_reduced[indices])
        loss_full = _log_loss(y_locked[indices], p_full[indices])
        boot.append((loss_reduced - loss_full) / loss_reduced if loss_reduced > 0 else math.nan)
    validation_report = None
    if validation:
        y_validation = np.asarray([item[1]["status"] == "POSITIVE" for item in validation], dtype=float)
        reduced_validation = np.asarray([[1.0, item[0]["T"], item[0]["E"], item[0]["L"]] for item in validation], dtype=float)
        full_validation = np.asarray([[1.0, item[0]["T"], item[0]["E"], item[0]["L"], item[0]["M"]] for item in validation], dtype=float)
        p_reduced_validation = 1.0 / (1.0 + np.exp(-(reduced_validation @ np.asarray(reduced_fit["coefficients"]))))
        p_full_validation = 1.0 / (1.0 + np.exp(-(full_validation @ np.asarray(full_fit["coefficients"]))))
        validation_reduced_loss = _log_loss(y_validation, p_reduced_validation)
        validation_full_loss = _log_loss(y_validation, p_full_validation)
        validation_report = {
            "rows": len(validation), "reducedLogLoss": validation_reduced_loss, "fullLogLoss": validation_full_loss,
            "relativeLogLossReduction": (validation_reduced_loss - validation_full_loss) / validation_reduced_loss if validation_reduced_loss > 0 else math.nan,
            "reducedAUPRC": _average_precision(y_validation, p_reduced_validation),
            "fullAUPRC": _average_precision(y_validation, p_full_validation),
        }
    technical_interval = interval(boot)
    if technical_interval is None:
        return {"status": "NOT_COMPUTABLE", "reason": "undefined_bootstrap_replicate", "developmentRows": len(development), "lockedRows": len(locked)}
    return {
        "status": "COMPUTABLE", "developmentRows": len(development), "validationRows": len(validation), "lockedRows": len(locked),
        "reducedFit": reduced_fit, "fullFit": full_fit,
        "reducedLogLoss": reduced_loss, "fullLogLoss": full_loss,
        "relativeLogLossReduction": point, "relativeLogLossReduction95": technical_interval,
        "reducedAUPRC": _average_precision(y_locked, p_reduced), "fullAUPRC": _average_precision(y_locked, p_full),
        "validationDescriptiveOnly": validation_report,
    }


def wilson(successes: int, total: int) -> dict[str, float] | None:
    if total <= 0 or successes < 0 or successes > total:
        return None
    z = 1.959963984540054
    p = successes / total
    denominator = 1.0 + z * z / total
    centre = (p + z * z / (2.0 * total)) / denominator
    margin = z * math.sqrt((p * (1.0 - p) + z * z / (4.0 * total)) / total) / denominator
    return {"estimate": p, "lower": max(0.0, centre - margin), "upper": min(1.0, centre + margin)}


def _h_late(events: Any, cutoff: str) -> dict[str, Any]:
    if not isinstance(events, list):
        raise ContractError("hLatePopulation must be an array")
    analysis_cutoff = timestamp(cutoff, "analysisCutoffAt")
    earliest: dict[str, tuple[dict[str, Any], dict[str, Any]]] = {}
    censored = 0
    outside_locked = 0
    for observation in events:
        if not isinstance(observation, dict):
            raise ContractError("invalid H-LATE population row")
        entity = require_string(observation, "entityId")
        growth_events = derive_growth_events(observation)
        if not growth_events:
            continue
        event = growth_events[0]
        if split_for(event["eventAvailableAt"].isoformat()) != "locked":
            outside_locked += 1
            continue
        if entity in earliest:
            raise ContractError("H-LATE population contains duplicate entity rows")
        earliest[entity] = (observation, event)
    values: list[int] = []
    for observation, event in earliest.values():
        maturity = event["maturityAt"]
        if maturity > analysis_cutoff or observation.get("completeEntityHistory") is not True or _price_sessions_before(observation, event["eventAvailableAt"]) < 315:
            censored += 1
            continue
        event_at = event["eventAvailableAt"]
        breakout = _primary_breakout_available_at(observation)
        gqs_at = _first_gqs_available_at(observation, through_at=maturity)
        if breakout is None:
            values.append(0)
            continue
        if breakout > event_at:
            values.append(0)
            continue
        if gqs_at is None:
            values.append(1)
        else:
            values.append(int(breakout < gqs_at))
    result = wilson(sum(values), len(values))
    if len(values) < 200:
        status = "INCONCLUSIVE"
    elif result and result["estimate"] >= 0.70 and result["lower"] >= 0.70:
        status = "H_LATE_CONFIRMED"
    elif result and result["estimate"] < 0.70:
        status = "H_LATE_REJECTED"
    else:
        status = "INCONCLUSIVE"
    return {"status": status, "eligibleEvents": len(values), "censored": censored, "outsideLockedWindow": outside_locked, "wilson95": result}


def _growth_event_recall(raw_signals: Any, population: Any, cutoff: str) -> dict[str, Any]:
    if not isinstance(raw_signals, list) or not isinstance(population, list):
        raise ContractError("recall requires FEM signals and the full growth-event population")
    cutoff_at = timestamp(cutoff, "analysisCutoffAt")
    signal_by_entity = {require_string(row, "entityId"): timestamp(row.get("signalAvailableAt"), "signalAvailableAt") for row in raw_signals}
    if len(signal_by_entity) != len(raw_signals):
        raise ContractError("recall signal population contains duplicate entities")
    seen = set()
    eligible = 0
    detected = 0
    censored = 0
    for observation in population:
        entity = require_string(observation, "entityId")
        if entity in seen:
            raise ContractError("growth-event population contains duplicate entities")
        seen.add(entity)
        events = derive_growth_events(observation)
        if not events or split_for(events[0]["eventAvailableAt"].isoformat()) != "locked":
            continue
        event = events[0]
        if event["maturityAt"] > cutoff_at or observation.get("completeEntityHistory") is not True:
            censored += 1
            continue
        eligible += 1
        detected += int(entity in signal_by_entity and signal_by_entity[entity] < event["eventAvailableAt"])
    return {"eligibleLockedGrowthEvents": eligible, "detectedBeforeEvent": detected, "recall": ratio(detected, eligible), "censored": censored}


def _technical_only(raw_signals: Any, raw_control_pool: Any, cutoff: str) -> dict[str, Any]:
    sets, unmatched_by_split, _ = _derive_match_sets(raw_signals, raw_control_pool, cutoff, technical_only=True)
    locked = [item for item in sets if item["split"] == "locked"]
    metrics = _precision_metrics(locked)
    boot = _bootstrap_sets(locked, 20260810)
    total_mature = metrics["signalMature"] + metrics["controlMature"]
    lower = boot["precisionLiftOneSided95Lower"] if boot["precisionLiftOneSided95Lower"] is not None else math.nan
    enough = metrics["signalMature"] >= 50 and total_mature >= 200
    if not enough:
        status = "INCONCLUSIVE"
    elif math.isfinite(metrics["precisionLift"]) and metrics["precisionLift"] >= 1.5 and lower > 1.0:
        status = "TECHNICAL_ONLY_SUPPORTED"
    else:
        status = "TECHNICAL_ONLY_REJECTED"
    return {"status": status, "unmatchedSignals": unmatched_by_split.get("locked", 0), **metrics, **boot}


def _ai_classification(row: dict[str, Any], evaluation_at: datetime | None = None) -> str:
    classification = row.get("aiClassification")
    if not isinstance(classification, dict):
        return "unknown"
    ai_class = classification.get("aiClass")
    if ai_class == "unknown":
        return "unknown"
    if ai_class not in {"direct", "infrastructure", "indirect", "narrative", "independent"}:
        raise ContractError("AI classification is invalid")
    known_at = timestamp(classification.get("knownAt"), "aiClassification.knownAt")
    reference_at = evaluation_at if evaluation_at is not None else timestamp(row.get("signalAvailableAt"), "signalAvailableAt")
    if known_at > reference_at:
        if evaluation_at is not None:
            return "unknown"
        raise ContractError("AI classification uses evidence after the signal vintage")
    sources = classification.get("sourceIds")
    if not isinstance(sources, list) or not sources or len(set(sources)) != len(sources) or any(not isinstance(item, str) or not item for item in sources):
        raise ContractError("AI classification requires unique evidence source ids")
    evidence_classes = classification.get("materialEvidenceClasses")
    if not isinstance(evidence_classes, list) or any(item not in {"revenue", "backlog", "capex", "necessary_product_function"} for item in evidence_classes):
        raise ContractError("AI material evidence class is invalid")
    if ai_class in {"direct", "infrastructure", "indirect"} and not evidence_classes:
        return "unknown"
    material = ai_class in {"direct", "infrastructure", "indirect"}
    return "material" if material else "non_material"


def _non_ai_scenario(locked: list[dict[str, Any]], full_precision: float, include_unknown: bool, seed: int) -> dict[str, Any]:
    scenario_sets = []
    for item in locked:
        signal = item["signal"]
        if signal["label"]["status"] == "CENSORED":
            continue
        signal_class = _ai_classification(signal["row"])
        if signal_class == "material" or (signal_class == "unknown" and not include_unknown):
            continue
        controls = []
        for control in item["controls"]:
            if control["label"]["status"] == "CENSORED":
                continue
            control_class = _ai_classification(control["row"])
            if control_class == "material" or (control_class == "unknown" and not include_unknown):
                continue
            controls.append(control)
        scenario_sets.append({"signal": signal, "controls": controls, "split": item["split"]})

    def measures(sample: list[dict[str, Any]]) -> dict[str, Any]:
        signals = [item["signal"] for item in sample]
        controls = [control for item in sample for control in item["controls"]]
        signal_positive = sum(item["label"]["status"] == "POSITIVE" for item in signals)
        control_positive = sum(item["label"]["status"] == "POSITIVE" for item in controls)
        precision = ratio(signal_positive, len(signals))
        base_rate = ratio(control_positive, len(controls))
        themes: dict[str, int] = {}
        for item in signals:
            if item["label"]["status"] == "POSITIVE":
                theme = require_string(item["row"], "themeId")
                themes[theme] = themes.get(theme, 0) + 1
        return {
            "matureSignals": len(signals), "signalPositive": signal_positive,
            "matureMatchedControls": len(controls), "controlPositive": control_positive,
            "precision": precision, "precisionWilson95": wilson(signal_positive, len(signals)),
            "matchedControlBaseRate": base_rate, "baseRateWilson95": wilson(control_positive, len(controls)),
            "precisionLift": ratio(precision, base_rate),
            "precisionRetention": ratio(precision, full_precision),
            "positiveAllocationToSignalArm": ratio(signal_positive, signal_positive + control_positive),
            "positiveAllocationWilson95": wilson(signal_positive, signal_positive + control_positive),
            "maximumTruePositiveThemeShare": ratio(max(themes.values(), default=0), signal_positive),
        }

    result = measures(scenario_sets)
    lifts: list[float] = []
    if scenario_sets:
        rng = np.random.Generator(np.random.PCG64(seed))
        for _ in range(BOOTSTRAP_REPLICATES):
            sample = [scenario_sets[index] for index in rng.integers(0, len(scenario_sets), size=len(scenario_sets))]
            lifts.append(measures(sample)["precisionLift"])
    result["precisionLift95"] = interval(lifts)
    return result


def _non_ai_growth_event_recall(raw_signals: Any, population: Any, cutoff: str, include_unknown: bool) -> dict[str, Any]:
    if not isinstance(raw_signals, list) or not isinstance(population, list):
        raise ContractError("non-AI recall requires FEM signals and the full growth-event population")
    cutoff_at = timestamp(cutoff, "analysisCutoffAt")
    signal_by_entity = {require_string(row, "entityId"): timestamp(row.get("signalAvailableAt"), "signalAvailableAt") for row in raw_signals}
    if len(signal_by_entity) != len(raw_signals):
        raise ContractError("non-AI recall signal population contains duplicate entities")
    seen = set()
    classified = 0
    unknown = 0
    eligible = 0
    detected = 0
    censored = 0
    for observation in population:
        entity = require_string(observation, "entityId")
        if entity in seen:
            raise ContractError("non-AI growth-event population contains duplicate entities")
        seen.add(entity)
        events = derive_growth_events(observation)
        if not events or split_for(events[0]["eventAvailableAt"].isoformat()) != "locked":
            continue
        event = events[0]
        if event["maturityAt"] > cutoff_at or observation.get("completeEntityHistory") is not True:
            censored += 1
            continue
        ai_state = _ai_classification(observation, event["eventAvailableAt"])
        classified += int(ai_state != "unknown")
        unknown += int(ai_state == "unknown")
        if ai_state == "material" or (ai_state == "unknown" and not include_unknown):
            continue
        eligible += 1
        detected += int(entity in signal_by_entity and signal_by_entity[entity] < event["eventAvailableAt"])
    total_classifiable = classified + unknown
    return {
        "eligibleLockedGrowthEvents": eligible, "detectedBeforeEvent": detected,
        "recall": ratio(detected, eligible), "recallWilson95": wilson(detected, eligible),
        "censored": censored, "classifiedGrowthEvents": classified, "unknownGrowthEvents": unknown,
        "evidenceCoverage": ratio(classified, total_classifiable),
    }


def _non_ai_robustness(locked: list[dict[str, Any]], full_precision: float, raw_signals: Any, population: Any, cutoff: str) -> dict[str, Any]:
    mature_observations = [
        observation
        for item in locked
        for observation in (item["signal"], *item["controls"])
        if observation["label"]["status"] != "CENSORED"
    ]
    classes = [_ai_classification(item["row"]) for item in mature_observations]
    classified_count = sum(state != "unknown" for state in classes)
    coverage = ratio(classified_count, len(classes))
    unknown_count = sum(state == "unknown" for state in classes)
    removed = _non_ai_scenario(locked, full_precision, include_unknown=False, seed=20260811)
    kept = _non_ai_scenario(locked, full_precision, include_unknown=True, seed=20260812)
    removed["growthEventRecall"] = _non_ai_growth_event_recall(raw_signals, population, cutoff, include_unknown=False)
    kept["growthEventRecall"] = _non_ai_growth_event_recall(raw_signals, population, cutoff, include_unknown=True)
    population_coverage = removed["growthEventRecall"]["evidenceCoverage"]
    evidence_ready = math.isfinite(coverage) and coverage >= 0.95 and math.isfinite(population_coverage) and population_coverage >= 0.95
    sample_ready = all(
        scenario["matureSignals"] >= 50
        and scenario["matureSignals"] + scenario["matureMatchedControls"] >= 200
        and scenario["precisionLift95"] is not None
        for scenario in (removed, kept)
    )
    performance_passes = (
        math.isfinite(removed["precisionRetention"]) and removed["precisionRetention"] >= 0.80
        and math.isfinite(kept["precisionRetention"]) and kept["precisionRetention"] >= 0.80
        and math.isfinite(removed["maximumTruePositiveThemeShare"]) and removed["maximumTruePositiveThemeShare"] <= 0.50
        and math.isfinite(kept["maximumTruePositiveThemeShare"]) and kept["maximumTruePositiveThemeShare"] <= 0.50
    )
    status = "NOT_READY" if not evidence_ready else ("INCONCLUSIVE" if not sample_ready else ("PASS" if performance_passes else "FAILED"))
    return {
        "status": status, "matchedObservationEvidenceCoverage": coverage, "growthEventPopulationEvidenceCoverage": population_coverage,
        "evidenceReady": evidence_ready, "minimumSampleReady": sample_ready,
        "classifiedMatureObservations": classified_count, "unknownMatureObservations": unknown_count,
        "unknownRemovedWithAi": removed, "unknownIncludedAsNonAi": kept,
    }


def run_confirmatory(payload: dict[str, Any], derived_gates: dict[str, bool]) -> dict[str, Any]:
    if payload.get("schema") != "early-detection-confirmatory-input/v1" or payload.get("protocol") != PROTOCOL:
        raise ContractError("confirmatory input identity mismatch")
    gate_state = readiness(derived_gates, implementation_sealed=True)
    if not gate_state["resultComputationAllowed"]:
        raise ContractError("confirmatory execution blocked: " + ", ".join(gate_state["missing"]))
    cutoff = payload.get("analysisCutoffAt")
    timestamp(cutoff, "analysisCutoffAt")
    if payload.get("researchCorpusSha256") != derived_gates.get("researchCorpusSha256"):
        raise ContractError("confirmatory input is bound to another research corpus")
    sets, unmatched_by_split, all_fem_signals = _derive_match_sets(payload.get("femSignals"), payload.get("femControlPool"), cutoff)
    unmatched = unmatched_by_split.get("locked", 0)
    development_sets = [item for item in sets if item["split"] == "development"]
    validation_sets = [item for item in sets if item["split"] == "validation"]
    locked = [item for item in sets if item["split"] == "locked"]
    metrics = _precision_metrics(locked)
    bootstrap = _bootstrap_sets(locked, 20260808)
    signal_pre = []
    control_pre = []
    leads = []
    true_positive_signals = []
    for item in locked:
        signal = item["signal"]
        pre = _pre_breakout(signal["row"], signal["label"])
        if pre is not None:
            signal_pre.append(pre)
        lead = _lead(signal["row"], signal["label"])
        if lead is not None:
            leads.append(lead)
        if signal["label"]["status"] == "POSITIVE":
            true_positive_signals.append(signal["row"])
        for control in item["controls"]:
            pre = _pre_breakout(control["row"], control["label"])
            if pre is not None:
                control_pre.append(pre)
    signal_share = ratio(sum(signal_pre), len(signal_pre))
    control_share = ratio(sum(control_pre), len(control_pre))
    pre_difference = signal_share - control_share if math.isfinite(signal_share) and math.isfinite(control_share) else math.nan
    lead_values = [item["filingEvents"] for item in leads]
    median_lead = float(np.median(lead_values)) if lead_values else math.nan
    themes: dict[str, int] = {}
    regimes: dict[str, int] = {}
    microcaps = 0
    for row in true_positive_signals:
        theme = require_string(row, "themeId")
        regime = row.get("marketRegime")
        if regime not in REGIMES:
            raise ContractError("marketRegime is invalid")
        market_cap = math.exp(_match_features(row, False)["logMarketCap"])
        themes[theme] = themes.get(theme, 0) + 1
        regimes[regime] = regimes.get(regime, 0) + 1
        microcaps += int(market_cap < 300_000_000)
    positive_count = len(true_positive_signals)
    theme_share = ratio(max(themes.values(), default=0), positive_count)
    regime_share = ratio(max(regimes.values(), default=0), positive_count)
    microcap_share = ratio(microcaps, positive_count)
    non_ai = _non_ai_robustness(locked, metrics["signalPrecision"], payload.get("femSignals"), payload.get("hLatePopulation"), cutoff)
    technical = _technical_incrementality(sets, all_fem_signals, cutoff)
    technical_only = _technical_only(payload.get("technicalOnlySignals"), payload.get("technicalOnlyControlPool"), cutoff)
    h_late = _h_late(payload.get("hLatePopulation"), cutoff)
    recall = _growth_event_recall(payload.get("femSignals"), payload.get("hLatePopulation"), cutoff)
    lift_lower = bootstrap["precisionLift95"][0] if bootstrap["precisionLift95"] else math.nan
    breakout_lower = bootstrap["preBreakoutDifference95"][0] if bootstrap["preBreakoutDifference95"] else math.nan
    technical_lower = (technical.get("relativeLogLossReduction95") or [math.nan])[0]
    total_signals = len([item for item in sets if item["split"] == "locked"]) + unmatched
    gates = {
        "minimumMatureEvents": metrics["signalMature"] + metrics["controlMature"] >= 200,
        "minimumUniquePrimarySignals": metrics["signalMature"] >= 50,
        "minimumFuturePositivesPerArm": len(signal_pre) >= 30 and len(control_pre) >= 30,
        "readinessComplete": True,
        "primaryBootstrapComputable": bootstrap["precisionLift95"] is not None and bootstrap["preBreakoutDifference95"] is not None,
        "technicalIncrementalityComputable": technical.get("status") == "COMPUTABLE",
        "nonAiEvidenceReady": non_ai["evidenceReady"] is True,
        "nonAiMinimumSample": non_ai["minimumSampleReady"] is True,
        "precisionLift": math.isfinite(metrics["precisionLift"]) and metrics["precisionLift"] >= 1.5,
        "precisionInterval": math.isfinite(lift_lower) and lift_lower >= 1.0,
        "medianLead": math.isfinite(median_lead) and median_lead >= 2,
        "preBreakoutDifference": math.isfinite(pre_difference) and pre_difference >= 0.10,
        "preBreakoutInterval": math.isfinite(breakout_lower) and breakout_lower > 0,
        "unmatchedRate": ratio(unmatched, total_signals) <= 0.20 if total_signals else False,
        "themeConcentration": math.isfinite(theme_share) and theme_share <= 0.50,
        "microcapConcentration": math.isfinite(microcap_share) and microcap_share <= 0.50,
        "marketRegimeConcentration": math.isfinite(regime_share) and regime_share <= 0.60,
        "nonAiRobustness": non_ai["status"] == "PASS",
        "technicalLogLossGain": technical.get("status") == "COMPUTABLE" and technical.get("relativeLogLossReduction", math.nan) >= 0.02,
        "technicalLogLossInterval": technical.get("status") == "COMPUTABLE" and math.isfinite(technical_lower) and technical_lower > 0,
    }
    sample_gates = (
        "minimumMatureEvents", "minimumUniquePrimarySignals", "minimumFuturePositivesPerArm", "readinessComplete",
        "primaryBootstrapComputable", "technicalIncrementalityComputable", "nonAiEvidenceReady", "nonAiMinimumSample",
    )
    if any(not gates[name] for name in sample_gates):
        h_fem = "INCONCLUSIVE"
    elif all(gates.values()):
        h_fem = "HFEM_PASSED"
    else:
        h_fem = "AUTOMATION_REJECTED"
    return {
        "schema": "early-detection-confirmatory-result/v1",
        "protocol": PROTOCOL,
        "inputSha256": canonical_sha256(payload),
        "analysisCutoffAt": cutoff,
        "readiness": gate_state,
        "primaryLocked": {
            **metrics, **bootstrap,
            "matchedSets": len(locked), "unmatchedSignals": unmatched,
            "signalPreBreakoutShare": signal_share, "controlPreBreakoutShare": control_share,
            "preBreakoutDifference": pre_difference,
            "medianLeadFilingEvents": median_lead,
            "leadCount": len(leads), "leadRightCensoredCount": sum(item["censored"] for item in leads),
            "maximumThemeShare": theme_share, "microcapShare": microcap_share,
            "maximumMarketRegimeShare": regime_share,
            "nonAiRobustness": non_ai,
            "growthEventRecall": recall,
        },
        "developmentDescriptiveOnly": {**_precision_metrics(development_sets), "matchedSets": len(development_sets), "unmatchedSignals": unmatched_by_split.get("development", 0)},
        "validationDescriptiveOnly": {**_precision_metrics(validation_sets), "matchedSets": len(validation_sets), "unmatchedSignals": unmatched_by_split.get("validation", 0)},
        "technicalIncrementality": technical,
        "technicalOnlyNullTest": technical_only,
        "hLate": h_late,
        "hFemGates": gates,
        "hFemStatus": h_fem,
        "interpretationBoundary": "Research result only; never a valuation, buy signal, Elliott-wave count or productive GQS change.",
    }


def self_test() -> dict[str, Any]:
    def quarter_rows(entity: str, growing: bool = False, future_maturity: bool = False) -> list[dict[str, Any]]:
        revenues = ([100] * 4 + [105] * 4 + [140, 141, 142, 143, 144]) if growing else [100] * 17
        rows = []
        for index, revenue in enumerate(revenues):
            year = 2019 + index // 4
            quarter = index % 4 + 1
            month = quarter * 3
            known = f"{year}-{month:02d}-28T21:00:00Z"
            if future_maturity and growing and index == 12:
                known = "2026-01-15T21:00:00Z"
            rows.append({
                "entityId": entity, "fiscalYear": year, "fiscalQuarter": quarter,
                "accessionId": f"{entity}-A{index}", "form": "10-K" if quarter == 4 else "10-Q",
                "sourceClass": "sec_filing", "acceptedAt": known, "observedAt": known,
                "sectorPercentileKnownAt": known, "valueCaptureKnownAt": known,
                "acquisitionContributionKnownAt": known,
                "acquisitionAvailability": {"sourceClass": "sec_filing", "accepted_at": known, "observed_at": known},
                "revenue": revenue, "sectorPercentile": 85 if growing and index == 8 else 50,
                "economicValue": revenue * 0.6, "dilutedShares": 10,
                "acquisitionRevenueShare": 0, "economicMetric": "gross_profit",
                "valueCaptureAdjudication": {"agreement": True, "knownAt": known, "evidenceSourceIds": [f"{entity}-S{index}"], "decisions": [{"coderId": "A", "accepted": True}, {"coderId": "B", "accepted": True}]},
            })
        return rows
    def gqs_history(entity: str, listing: str, qualified_month: str | None) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        calendar, panel = [], []
        year, month = 2009, 1
        while (year, month) <= (2023, 1):
            vintage = f"{year}-{month:02d}"
            next_year, next_month = (year + 1, 1) if month == 12 else (year, month + 1)
            close_at = f"{year}-{month:02d}-28T21:00:00Z"
            next_open = f"{next_year}-{next_month:02d}-01T14:30:00Z"
            common = {"entityId": entity, "listingId": listing, "vintageMonth": vintage, "historyCompleteFrom": "2009-01", "panelStartReason": "study_start", "isListingStartVintage": False}
            calendar.append({**common, "closeAt": close_at, "nextOpenAt": next_open})
            panel.append({**common, "protocol": "GQS-00@1.0.0", "snapshotId": f"{entity}-{vintage}", "snapshotSha256": hashlib.sha256(f"{entity}-{vintage}".encode()).hexdigest(), "availableAt": next_open, "qualified": vintage == qualified_month})
            year, month = next_year, next_month
        return calendar, panel
    def flat_market_history(entity: str, listing: str) -> tuple[dict[str, Any], list[dict[str, Any]]]:
        bars = []
        start = datetime(2019, 1, 1, tzinfo=timezone.utc)
        for index in range(800):
            day = start + timedelta(days=index)
            next_day = day + timedelta(days=1)
            bars.append({
                "date": day.date().isoformat(), "close": 100.0, "volume": 100_000,
                "closeAt": day.replace(hour=21).isoformat().replace("+00:00", "Z"),
                "nextOpenAt": next_day.replace(hour=14, minute=30).isoformat().replace("+00:00", "Z"),
            })
        calendar = [
            {"entityId": entity, "listingId": listing, "vintageMonth": "2021-01", "historyCompleteFrom": "2021-01", "panelStartReason": "data_start", "isListingStartVintage": False,
             "closeAt": "2021-01-31T21:00:00Z", "nextOpenAt": "2021-02-01T14:30:00Z"},
            {"entityId": entity, "listingId": listing, "vintageMonth": "2021-02", "historyCompleteFrom": "2021-01", "panelStartReason": "data_start", "isListingStartVintage": False,
             "closeAt": "2021-02-28T21:00:00Z", "nextOpenAt": "2021-03-01T14:30:00Z"},
        ]
        history = {
            "adjustmentPolicy": "point_in_time_total_return", "corporateActionKnownAtPolicy": "point_in_time",
            "bars": bars, "sectorBars": bars, "marketBars": bars,
        }
        return history, calendar
    def listing_transition_history(entity: str, listing: str) -> tuple[dict[str, Any], list[dict[str, Any]]]:
        bars = []
        start = datetime(2019, 1, 1, tzinfo=timezone.utc)
        for index in range(800):
            day = start + timedelta(days=index)
            next_day = day + timedelta(days=1)
            close = 150.0 if day >= datetime(2020, 2, 15, tzinfo=timezone.utc) else 100.0
            bars.append({
                "date": day.date().isoformat(), "close": close, "volume": 100_000,
                "closeAt": day.replace(hour=21).isoformat().replace("+00:00", "Z"),
                "nextOpenAt": next_day.replace(hour=14, minute=30).isoformat().replace("+00:00", "Z"),
            })
        benchmark = [{**bar, "close": 100.0} for bar in bars]
        calendar = []
        year, month = 2019, 1
        while (year, month) <= (2021, 2):
            next_year, next_month = (year + 1, 1) if month == 12 else (year, month + 1)
            next_first = datetime(next_year, next_month, 1, tzinfo=timezone.utc)
            close_day = next_first - timedelta(days=1)
            vintage = f"{year}-{month:02d}"
            calendar.append({
                "entityId": entity, "listingId": listing, "vintageMonth": vintage,
                "historyCompleteFrom": "2019-01", "panelStartReason": "effective_listing_start",
                "listingStartMonth": "2019-01", "isListingStartVintage": vintage == "2019-01",
                "closeAt": close_day.replace(hour=21).isoformat().replace("+00:00", "Z"),
                "nextOpenAt": next_first.replace(hour=14, minute=30).isoformat().replace("+00:00", "Z"),
            })
            year, month = next_year, next_month
        return {
            "adjustmentPolicy": "point_in_time_total_return", "corporateActionKnownAtPolicy": "point_in_time",
            "bars": bars, "sectorBars": benchmark, "marketBars": benchmark,
        }, calendar
    base = {
        "entityId": "E1", "listingId": "L1", "signalAvailableAt": "2021-01-01T14:30:00Z",
        "quarterRows": quarter_rows("E1"),
    }
    checks = 0
    assert len(readiness({})["missing"]) == 13
    checks += 1
    assert "confirmatoryAnalysisImplementationSealed" in readiness({gate: True for gate in REQUIRED_GATES if gate != "confirmatoryAnalysisImplementationSealed"})["missing"]
    checks += 1
    assert "confirmatoryAnalysisImplementationSealed" in readiness({gate: True for gate in REQUIRED_GATES}, implementation_sealed=False)["missing"]
    checks += 1
    negative = label_observation({**base, "growthEvents": [{"qualifies": True}]}, "2025-01-01T00:00:00Z")
    assert negative["status"] == "NEGATIVE"
    checks += 1
    assert derive_growth_events({**base, "growthEvents": [{"qualifies": True}]}) == []
    checks += 1
    future = {**base, "signalAvailableAt": "2020-01-01T14:30:00Z", "quarterRows": quarter_rows("E1", growing=True, future_maturity=True)}
    assert label_observation(future, "2025-01-01T00:00:00Z")["status"] == "CENSORED"
    checks += 1
    gqs_calendar, gqs_panel = gqs_history("E1", "L1", "2020-10")
    positive_observation = {
        **base, "signalAvailableAt": "2020-01-01T14:30:00Z", "quarterRows": quarter_rows("E1", growing=True),
        "gqsVintageCalendar": gqs_calendar, "historicalGqsPanel": gqs_panel,
    }
    positive_label = label_observation(positive_observation, "2025-01-01T00:00:00Z")
    assert positive_label["status"] == "POSITIVE" and _lead(positive_observation, positive_label) == {"filingEvents": 3, "censored": False}
    checks += 1
    late_calendar, late_panel = gqs_history("E1", "L1", "2022-12")
    late_gqs = {**positive_observation, "gqsVintageCalendar": late_calendar, "historicalGqsPanel": late_panel}
    assert _lead(late_gqs, positive_label) == {"filingEvents": 9, "censored": True}
    checks += 1
    no_calendar, no_panel = gqs_history("E1", "L1", None)
    no_gqs = {**positive_observation, "gqsVintageCalendar": no_calendar, "historicalGqsPanel": no_panel}
    assert _lead(no_gqs, positive_label) == {"filingEvents": 9, "censored": True}
    checks += 1
    assert split_for("2016-12-31T23:59:59Z") == "development" and split_for("2021-01-01T00:00:00Z") == "locked"
    checks += 1
    singular = _solve_irls(np.asarray([[1.0, 1.0], [1.0, 1.0]]), np.asarray([0.0, 1.0]))
    assert singular["status"] == "NOT_COMPUTABLE"
    checks += 1
    invalid_interval = [0.0] * (BOOTSTRAP_REPLICATES - 1) + [math.nan]
    ordered_interval = [float(index) for index in range(BOOTSTRAP_REPLICATES)]
    assert interval(invalid_interval) is None and one_sided_lower(ordered_interval) == 499.0 and interval(ordered_interval)[0] == 249.0
    checks += 1
    components = {name: ([] if name != "conceptMap" else {}) for name in INPUT_COMPONENTS}
    corpus_sha = "a" * 64
    component_manifest = {name: canonical_sha256(value) for name, value in components.items()}
    component_manifest["researchCorpus"] = corpus_sha
    artifacts = {gate: {"componentSha256": {name: component_manifest[name] for name in names}} for gate, names in GATE_COMPONENTS.items()}
    _verify_input_component_manifest({**components, "componentManifest": component_manifest}, {"researchCorpusSha256": corpus_sha}, artifacts)
    input_sha = "b" * 64
    corpus_evidence = b"sealed external corpus manifest evidence"
    corpus_artifact = {
        "schema": "early-detection-execution-gate-artifact/v1", "protocol": PROTOCOL,
        "gate": "researchCorpusSealed", "status": "PASS", "confirmatoryInputFileSha256": input_sha,
        "researchCorpusSha256": corpus_sha, "componentSha256": {"researchCorpus": corpus_sha},
        "verificationMethod": "deterministic corpus-manifest verifier", "verifiedAt": "2026-08-08T10:00:00Z",
        "evidence": [{"evidenceId": "CORPUS-MANIFEST", "artifactPath": "evidence/corpus.json", "sha256": sha256_bytes(corpus_evidence), "verifiedAt": "2026-08-08T09:59:00Z"}],
    }
    assert sha256_bytes(json.dumps(corpus_artifact, sort_keys=True).encode("utf-8")) != corpus_sha
    gate_authorization = {"inputFileSha256": input_sha, "researchCorpusSha256": corpus_sha, "accessAt": "2026-08-08T11:00:00Z"}
    loaded_paths = []
    def evidence_loader(commit: str, artifact_path: str) -> bytes:
        loaded_paths.append((commit, artifact_path))
        return corpus_evidence
    _validate_gate_artifact_identity("researchCorpusSealed", corpus_artifact, gate_authorization, "d" * 40, evidence_loader)
    assert loaded_paths == [("d" * 40, "evidence/corpus.json")]
    checks += 1
    try:
        _validate_gate_artifact_identity("researchCorpusSealed", {**corpus_artifact, "evidence": []}, gate_authorization, "d" * 40, evidence_loader)
        raise AssertionError("PASS gate artifacts without verification evidence must be rejected")
    except ContractError:
        checks += 1
    try:
        duplicate_evidence = [corpus_artifact["evidence"][0], {**corpus_artifact["evidence"][0]}]
        _validate_gate_artifact_identity("researchCorpusSealed", {**corpus_artifact, "evidence": duplicate_evidence}, gate_authorization, "d" * 40, evidence_loader)
        raise AssertionError("duplicate gate evidence identities and paths must be rejected")
    except ContractError:
        checks += 1
    try:
        bad_hash_evidence = [{**corpus_artifact["evidence"][0], "sha256": "e" * 64}]
        _validate_gate_artifact_identity("researchCorpusSealed", {**corpus_artifact, "evidence": bad_hash_evidence}, gate_authorization, "d" * 40, evidence_loader)
        raise AssertionError("remote gate evidence bytes must match their declared hash")
    except ContractError:
        checks += 1
    broken_artifacts = {**artifacts, "historicalUniverse": {"componentSha256": {}}}
    try:
        _verify_input_component_manifest({**components, "componentManifest": component_manifest}, {"researchCorpusSha256": corpus_sha}, broken_artifacts)
        raise AssertionError("component-level gate coverage must be mandatory")
    except ContractError:
        checks += 1
    market_history, market_calendar = flat_market_history("E1", "L1")
    incomplete_candidate = {
        **base, "priceHistory": market_history, "marketVintageCalendar": market_calendar,
        "candidatePanel": [{
            "entityId": "E1", "listingId": "L1", "vintageMonth": "2021-01", "historyCompleteFrom": "2021-01", "panelStartReason": "data_start", "isListingStartVintage": False,
            "evaluationAt": "2021-01-31T21:00:00Z", "signalAvailableAt": "2021-02-01T14:30:00Z",
            "vintageCalendarSha256": canonical_sha256(market_calendar), "T": 2, "E": 2, "L": 2, "themeId": "THEME", "dataQuality": "verified",
        }],
    }
    try:
        _candidate_panel(incomplete_candidate)
        raise AssertionError("candidate dimensions without source evidence must be rejected")
    except ContractError:
        checks += 1
    try:
        _validate_panel_anchor([{
            "vintageMonth": "2020-01", "historyCompleteFrom": "2020-01", "panelStartReason": "study_start", "isListingStartVintage": False,
        }], "fake study panel")
        raise AssertionError("study_start must be bound to the frozen 2009-01 anchor")
    except ContractError:
        checks += 1
    no_qualification_calendar, no_qualification_panel = gqs_history("E1", "L1", None)
    sourced_candidate_rows = []
    for index, market_row in enumerate(market_calendar):
        evidence_at = market_row["closeAt"]
        sources = [{
            "sourceId": f"S-{dimension}-{index}", "sourceClass": "public_web",
            "source_published_at": evidence_at, "observed_at": evidence_at, "payloadSha256": hashlib.sha256(f"{dimension}-{index}".encode()).hexdigest(),
        } for dimension in ("T", "E", "L")]
        levels = (0, 0, 0) if index == 0 else (2, 2, 2)
        sourced_candidate_rows.append({
            **market_row, "evaluationAt": market_row["closeAt"], "signalAvailableAt": market_row["nextOpenAt"],
            "vintageCalendarSha256": canonical_sha256(market_calendar), "T": levels[0], "E": levels[1], "L": levels[2],
            "themeId": "THEME", "dataQuality": "verified", "evidenceSources": sources,
            "dimensionEvidence": {dimension: {
                "level": level, "entityId": "E1", "listingId": "L1", "themeId": "THEME",
                "sourceIds": [f"S-{dimension}-{index}"], "knownAt": evidence_at,
            } for dimension, level in zip(("T", "E", "L"), levels)},
        })
    data_start_signal = {
        **base, "vintageMonth": "2021-02", "signalAvailableAt": "2021-03-01T14:30:00Z",
        "priceHistory": market_history, "marketVintageCalendar": market_calendar,
        "candidatePanel": sourced_candidate_rows,
        "gqsVintageCalendar": no_qualification_calendar, "historicalGqsPanel": no_qualification_panel,
    }
    try:
        _validate_fem_primary_signal(data_start_signal)
        raise AssertionError("data-start false-to-eligible panels cannot identify a primary FEM signal")
    except ContractError:
        checks += 1
    truncated_gqs = {**positive_observation, "gqsVintageCalendar": gqs_calendar, "historicalGqsPanel": gqs_panel[1:]}
    try:
        _first_gqs_available_at(truncated_gqs)
        raise AssertionError("truncated historical GQS panels must be rejected")
    except ContractError:
        checks += 1
    data_start_calendar = [{**row, "historyCompleteFrom": "2020-01", "panelStartReason": "data_start", "isListingStartVintage": False} for row in gqs_calendar if row["vintageMonth"] >= "2020-01"]
    data_start_gqs_panel = [{**row, "historyCompleteFrom": "2020-01", "panelStartReason": "data_start", "isListingStartVintage": False} for row in gqs_panel if row["vintageMonth"] >= "2020-01"]
    try:
        _first_gqs_available_at({**positive_observation, "gqsVintageCalendar": data_start_calendar, "historicalGqsPanel": data_start_gqs_panel})
        raise AssertionError("data-start false-to-qualified panels cannot identify a first GQS qualification")
    except ContractError:
        checks += 1
    transition_history, transition_calendar = listing_transition_history("E2", "L2")
    unmatched_signal = {
        **base, "entityId": "E2", "listingId": "L2", "quarterRows": quarter_rows("E2"),
        "signalAvailableAt": "2021-02-01T14:30:00Z", "vintageMonth": "2021-01", "T": 2, "E": 2, "L": 2,
        "priceHistory": transition_history, "marketVintageCalendar": transition_calendar,
    }
    unmatched_result = _technical_incrementality([], [unmatched_signal], "2025-01-01T00:00:00Z")
    assert unmatched_result["status"] == "NOT_COMPUTABLE" and unmatched_result["lockedRows"] == 1
    checks += 1
    transition_signal = {
        "entityId": "E2", "listingId": "L2", "vintageMonth": "2020-02", "signalAvailableAt": "2020-03-01T14:30:00Z",
        "priceHistory": transition_history, "marketVintageCalendar": transition_calendar,
    }
    assert _validate_technical_transition(transition_signal) >= 2
    checks += 1
    left_calendar = [
        {**row, "historyCompleteFrom": "2020-02", "panelStartReason": "data_start", "isListingStartVintage": False}
        for row in transition_calendar if row["vintageMonth"] >= "2020-02"
    ]
    try:
        _validate_technical_transition({**transition_signal, "marketVintageCalendar": left_calendar})
        raise AssertionError("a first-observed M2/M3 technical state must remain left-censored")
    except ContractError:
        checks += 1
    match = {
        **base, "sectorBranch": "TECH", "vintageMonth": "2021-01", "marketRegime": "bull",
        "isPrimaryListing": True, "marketCapUsd": 1_000_000_000, "listingAgeSessions": 600,
        "sectorRelativeReturn126": 0.1, "medianDollarVolume120Usd": 10_000_000,
        "candidatePanel": [{"entityId": "E1", "vintageMonth": "2021-01", "state": "PRE_GROWTH_CANDIDATE", "signalAvailableAt": "2021-01-01T14:30:00Z", "isListingStartVintage": True}],
    }
    try:
        _derive_match_sets([match], [], "2025-01-01T00:00:00Z")
        raise AssertionError("raw price and regime inputs must be mandatory")
    except ContractError:
        checks += 1
    rng_a = np.random.Generator(np.random.PCG64(20260808)).integers(0, 100, size=20).tolist()
    rng_b = np.random.Generator(np.random.PCG64(20260808)).integers(0, 100, size=20).tolist()
    assert rng_a == rng_b
    checks += 1
    return {"status": "PASS", "checks": checks, "protocol": PROTOCOL}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument("--input", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--gate-evidence", type=Path)
    args = parser.parse_args()
    if args.self_test:
        print(json.dumps(self_test(), sort_keys=True))
        return 0
    if args.input is None or args.output is None or args.gate_evidence is None:
        parser.error("--input, --output and --gate-evidence are required outside --self-test")
    authorization, input_bytes, runtime = authorize_execution(args.input, args.gate_evidence)
    payload = json.loads(input_bytes.decode("utf-8"))
    if payload.get("analysisCutoffAt") != authorization.get("analysisCutoffAt"):
        raise ContractError("analysis cutoff differs from the remotely checkpointed authorization")
    evidence = json.loads(args.gate_evidence.read_text(encoding="utf-8"))
    derived_gates = {gate: True for gate in REQUIRED_GATES[2:]}
    derived_gates["protocolSealed"] = True
    derived_gates["researchCorpusSha256"] = evidence["researchCorpusSha256"]
    result = run_confirmatory(payload, derived_gates)
    result["runtime"] = runtime
    result["executionAuthorization"] = {key: authorization[key] for key in (
        "runId", "eventHash", "inputFileSha256", "gateEvidenceFileSha256", "researchCorpusSha256",
        "protocolManifestSha256", "analysisCutoffAt",
    )}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(json_safe(result), indent=2, sort_keys=True, allow_nan=False) + "\n", encoding="utf-8")
    print(json.dumps({"status": result["hFemStatus"], "output": str(args.output), "inputSha256": result["inputSha256"]}, sort_keys=True))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ContractError, json.JSONDecodeError, OSError) as error:
        print(f"[early-detection-confirmatory] {error}", file=sys.stderr)
        raise SystemExit(1)

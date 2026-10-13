#!/usr/bin/env python3
"""Verify a still-red V7 gate decision bound to the complete identity dossier ledger."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
from typing import Any


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def canonical_sha256(value: Any) -> str:
    return hashlib.sha256(
        json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def read_signed(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8-sig"))
    unsigned = {key: item for key, item in value.items() if key != "reportSha256"}
    if canonical_sha256(unsigned) != value.get("reportSha256"):
        raise RuntimeError(f"signature mismatch: {path}")
    return value


def expected_selected(dossier: dict[str, Any]) -> dict[str, Any]:
    return {
        "counts": dossier["counts"],
        "symbolProfileStatusCounts": dossier["symbolProfileStatusCounts"],
        "cikProfileStatusCounts": dossier["cikProfileStatusCounts"],
        "corporateEventLinkStatusCounts": dossier["corporateEventLinkStatusCounts"],
        "identityResolvedRows": dossier["identityResolvedRows"],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--decision", type=Path, required=True)
    parser.add_argument("--gate", choices=("entityListingLedger", "historicalUniverse", "corporateActionsDelistings"), required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    source_path = args.decision.expanduser().resolve()
    output = args.output.expanduser().resolve()
    if output.exists():
        raise RuntimeError("refusing to overwrite immutable output")
    source = read_signed(source_path)
    if source.get("schema") != "early-detection-gate-decision/v7":
        raise RuntimeError("unexpected schema")
    if source.get("gate") != args.gate or not str(source.get("status", "")).startswith("RED_"):
        raise RuntimeError("gate boundary changed")
    if source.get("identityResolvedRows") != 0:
        raise RuntimeError("identity boundary changed")
    if any(source.get(key) is not False for key in (
        "confirmatoryEligible", "resultComputationAllowed", "outcomesAccessed", "productiveGqsModified"
    )):
        raise RuntimeError("fail-closed flags changed")
    inputs: dict[str, dict[str, Any]] = {}
    for name, bound in source["inputs"].items():
        path = Path(str(bound["path"])).resolve()
        value = read_signed(path)
        if file_sha256(path) != bound["fileSha256"] or value["reportSha256"] != bound["reportSha256"]:
            raise RuntimeError(f"input binding mismatch: {name}")
        inputs[name] = value
    if inputs["baseDecision"].get("gate") != args.gate or not str(inputs["baseDecision"].get("status", "")).startswith("RED_"):
        raise RuntimeError("base gate mismatch")
    if inputs["baseVerification"].get("status") != "PASS":
        raise RuntimeError("base verification not PASS")
    dossier = inputs["identityTransitionDossiers"]
    dossier_verify = inputs["identityTransitionDossiersVerification"]
    if dossier.get("status") != "PASS_OUTCOME_BLIND_IDENTITY_TRANSITIONS_QUANTIFIED_GATES_REMAIN_RED" or dossier_verify.get("status") != "PASS":
        raise RuntimeError("dossier chain not PASS")
    if source.get("selectedDossierEvidence") != expected_selected(dossier):
        raise RuntimeError("selected dossier evidence mismatch")
    if not source.get("blockingReasons") or not source.get("externalExit"):
        raise RuntimeError("red-gate rationale missing")
    mutated = json.loads(source_path.read_text(encoding="utf-8-sig"))
    mutated["identityResolvedRows"] = 1
    claimed = mutated.pop("reportSha256")
    mutation_rejected = canonical_sha256(mutated) != claimed
    if not mutation_rejected:
        raise RuntimeError("mutation probe failed")
    unsigned: dict[str, Any] = {
        "schema": "early-detection-gate-decision-verification/v7",
        "generatedAt": utc_now(),
        "status": "PASS",
        "gate": args.gate,
        "sourceDecision": str(source_path),
        "sourceDecisionFileSha256": file_sha256(source_path),
        "sourceDecisionReportSha256": source["reportSha256"],
        "checks": {
            "signedDecision": True,
            "fourInputsRehashed": True,
            "baseRedGatePreserved": True,
            "dossierFullIndependentVerificationPassed": True,
            "selectedDossierEvidenceReproduced": True,
            "identityResolvedRows": 0,
            "resultComputationAllowed": False,
            "mutationRejected": mutation_rejected,
        },
        "confirmatoryEligible": False,
        "resultComputationAllowed": False,
        "outcomesAccessed": False,
        "productiveGqsModified": False,
    }
    result = {**unsigned, "reportSha256": canonical_sha256(unsigned)}
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"gate": args.gate, "status": "PASS", "reportSha256": result["reportSha256"]}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

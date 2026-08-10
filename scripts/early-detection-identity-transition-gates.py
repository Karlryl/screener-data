#!/usr/bin/env python3
"""Bind independently verified identity-transition dossiers into still-red data gates."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
from typing import Any


SCHEMA = "early-detection-gate-decision/v7"
CONTRACTS = {
    "entityListingLedger": {
        "status": "RED_TRANSITIONS_QUANTIFIED_PERMANENT_IDENTITY_INTERVALS_UNPROVEN",
        "verdict": (
            "Archived symbol transitions and SEC CIK candidates are completely quantified, including every "
            "multi-CIK symbol conflict and multi-symbol CIK. They remain candidates and do not establish a "
            "permanent security identity or exchange-effective interval."
        ),
        "blockingReasons": [
            "393 kind-specific symbol profiles have more than one point-in-time direct CIK candidate.",
            "1,906 CIK candidates have more than one observed symbol; ticker change versus share class is unresolved.",
            "Sparse positive states cannot prove continuous identity or absence between captures.",
        ],
        "autonomousNext": (
            "Keep all 25,403 symbol profiles, 8,954 CIK profiles and 42,319 observed transitions immutable; "
            "adjudicate only with an independently verified permanent-identity source."
        ),
        "externalExit": (
            "A lawful 2009-2024 security master with stable identifiers, exchange-effective intervals, share-class "
            "and ticker-reuse adjudication passes independent audit."
        ),
    },
    "historicalUniverse": {
        "status": "RED_TRANSITIONS_QUANTIFIED_SECURITY_UNIVERSE_AND_ABSENCE_UNPROVEN",
        "verdict": (
            "All observed archive appearances, disappearances and name changes are quantified. They are not "
            "listing events and cannot prove the complete then-listed universe or uncaptured absence."
        ),
        "blockingReasons": [
            "18,093 observed appearances and 15,314 disappearances occur only between sparse snapshot states.",
            "Archive absence between captures is unknown and no complete market denominator is established.",
            "Stable identity, terminal sessions, corporate-action adjustments and delisting returns remain absent.",
        ],
        "autonomousNext": (
            "Preserve the 101 consecutive-snapshot deltas and every source-bound transition dossier; never infer "
            "an effective listing date or full-market denominator from the sparse states."
        ),
        "externalExit": (
            "A lawful zero-cost security-level universe with stable identity, complete exchange-effective intervals, "
            "terminal sessions and delisting treatment passes independent audit."
        ),
    },
    "corporateActionsDelistings": {
        "status": "RED_COMPLETE_FORMS_DOSSIERS_QUANTIFIED_TERMINAL_MARKET_AND_SUCCESSOR_PROOF_MISSING",
        "verdict": (
            "All 16,078 common-equity Form 25/15 events are now linked to the nearest available preceding and "
            "following point-in-time CIK candidates. The links quantify evidence gaps but do not prove a terminal "
            "market session, successor identity or delisting return."
        ),
        "blockingReasons": [
            "10,215 common-equity events have no point-in-time direct Nasdaq-directory CIK candidate.",
            "96 events have different candidate symbol sets before and after the filing without successor proof.",
            "No verified terminal OHLCV session or delisting-return treatment exists for the exact universe.",
        ],
        "autonomousNext": (
            "Keep every filing and candidate link immutable; add only independently verified terminal market "
            "sessions and successor identities, never synthesized dates or returns."
        ),
        "externalExit": (
            "Independently audited final-trading sessions, successor identities, corporate-action adjustments and "
            "delisting returns exist for the exact security universe."
        ),
    },
}


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


def bind(path: Path, value: dict[str, Any]) -> dict[str, str]:
    return {
        "path": str(path.resolve()),
        "fileSha256": file_sha256(path.resolve()),
        "reportSha256": str(value["reportSha256"]),
    }


def selected(dossier: dict[str, Any]) -> dict[str, Any]:
    return {
        "counts": dossier["counts"],
        "symbolProfileStatusCounts": dossier["symbolProfileStatusCounts"],
        "cikProfileStatusCounts": dossier["cikProfileStatusCounts"],
        "corporateEventLinkStatusCounts": dossier["corporateEventLinkStatusCounts"],
        "identityResolvedRows": dossier["identityResolvedRows"],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--gate", choices=tuple(CONTRACTS), required=True)
    parser.add_argument("--base", type=Path, required=True)
    parser.add_argument("--base-verification", type=Path, required=True)
    parser.add_argument("--dossier", type=Path, required=True)
    parser.add_argument("--dossier-verification", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    output = args.output.expanduser().resolve()
    if output.exists():
        raise RuntimeError("refusing to overwrite immutable output")
    paths = {
        "baseDecision": args.base.expanduser().resolve(),
        "baseVerification": args.base_verification.expanduser().resolve(),
        "identityTransitionDossiers": args.dossier.expanduser().resolve(),
        "identityTransitionDossiersVerification": args.dossier_verification.expanduser().resolve(),
    }
    values = {name: read_signed(path) for name, path in paths.items()}
    if values["baseDecision"].get("gate") != args.gate or not str(values["baseDecision"].get("status", "")).startswith("RED_"):
        raise RuntimeError("unexpected base gate")
    if values["baseVerification"].get("status") != "PASS":
        raise RuntimeError("base verification not PASS")
    dossier = values["identityTransitionDossiers"]
    if dossier.get("status") != "PASS_OUTCOME_BLIND_IDENTITY_TRANSITIONS_QUANTIFIED_GATES_REMAIN_RED":
        raise RuntimeError("unexpected dossier status")
    if values["identityTransitionDossiersVerification"].get("status") != "PASS":
        raise RuntimeError("dossier verification not PASS")
    if dossier.get("identityResolvedRows") != 0:
        raise RuntimeError("dossier resolved identity")
    if any(value.get("outcomesAccessed") is not False for value in values.values()):
        raise RuntimeError("upstream outcome boundary changed")
    contract = CONTRACTS[args.gate]
    unsigned: dict[str, Any] = {
        "schema": SCHEMA,
        "generatedAt": utc_now(),
        "gate": args.gate,
        "status": contract["status"],
        "verdict": contract["verdict"],
        "baseStatus": values["baseDecision"]["status"],
        "dossierStatus": dossier["status"],
        "selectedDossierEvidence": selected(dossier),
        "blockingReasons": contract["blockingReasons"],
        "autonomousNext": contract["autonomousNext"],
        "externalExit": contract["externalExit"],
        "inputs": {name: bind(paths[name], values[name]) for name in paths},
        "decisionBuilder": str(Path(__file__).resolve()),
        "decisionBuilderSha256": file_sha256(Path(__file__).resolve()),
        "identityResolvedRows": 0,
        "confirmatoryEligible": False,
        "resultComputationAllowed": False,
        "outcomesAccessed": False,
        "productiveGqsModified": False,
    }
    result = {**unsigned, "reportSha256": canonical_sha256(unsigned)}
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "gate": result["gate"], "status": result["status"],
        "reportSha256": result["reportSha256"],
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

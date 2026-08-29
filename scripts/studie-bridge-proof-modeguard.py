#!/usr/bin/env python3
"""Caller-side pre-flight for the R2-A1 independent-rebuild proof (finding H6).

`scripts/studie-identity-bridge-artifact.py` believes the mode a proof claims
about ITSELF: `load_independent_rebuild_proof()` reads `boundManifestMode` but
never re-derives it, and never holds `artifactVersion` against
`ARTIFACT_VERSION`. Two holes follow from that:

  * a proof carrying `artifactVersion` 1.1.0 together with
    `boundManifestMode` FIRST_BUILD_OF_VERSION is accepted, although 1.1.0 is
    the replication-bound version ("FORGED PROOF ACCEPTED -> mode never
    re-derived");
  * an unknown version silently falls through to the weaker FIRST_BUILD mode
    instead of refusing (fail-open).

That script is byte-pinned - `currentImplementation` in
`protocol/early-detection/2.0.0/r2-a1-v120-closure-record.json`, enforced by
`tests/studie-identity-bridge-artifact.test.js` - so the re-derivation lives
here instead and runs BEFORE the bridge script is reached:

    python scripts/studie-bridge-proof-modeguard.py --proof <proof.json>
    python scripts/studie-identity-bridge-artifact.py --discovery ... \
        --independent-proof <proof.json> ...

Every value is read out of the frozen records, never out of the guarded
script, so a defect in the guarded resolver cannot travel into its own gate.
This guard does NOT decide whether 1.2.0 should already be a replication case
(finding H7) - it mirrors the bound records as they stand today.
"""

import argparse
import json
import os
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

REPLICATION_BINDING = "REPLICATION_AGAINST_BOUND_MANIFEST"
FIRST_BUILD_BINDING = "FIRST_BUILD_OF_VERSION"

V120_CLOSURE_REL = (
    "protocol/early-detection/2.0.0/r2-a1-v120-closure-record.json"
)
DETERMINISM_CORRECTION_REL = (
    "protocol/early-detection/2.0.0/"
    "r2-a1-blocker2-independent-rebuild-correction.json"
)


class ProofRefused(Exception):
    """A proof was refused. Never a warning, never a downgrade."""


def _load(rel, repo=REPO):
    with open(os.path.join(repo, *rel.split("/")), encoding="utf-8") as handle:
        return json.load(handle)


def frozen_binding(repo=REPO):
    """Read the version binding out of the frozen records themselves."""
    closure = _load(V120_CLOSURE_REL, repo)
    if closure.get("status") != "FROZEN_V120_CLOSURE":
        raise ProofRefused("v1.2.0 closure record is not frozen")
    correction = _load(DETERMINISM_CORRECTION_REL, repo)
    if correction.get("status") != "FROZEN_BEFORE_INDEPENDENT_REBUILDS":
        raise ProofRefused("independent-rebuild correction is not frozen")
    current = closure.get("boundArtifactVersion")
    superseded = (closure.get("supersedes") or {}).get("artifactVersion")
    replication = (correction.get("boundArtifact") or {}).get("artifactVersion")
    if not current or not replication:
        raise ProofRefused("frozen records do not name their artifact versions")
    return {
        "current": current,
        "replication": replication,
        "known": {v for v in (current, superseded, replication) if v},
    }


def expected_mode(version, binding):
    """Re-derive the bound-manifest mode. Unknown version = refusal, not a
    silent fall-through to the weaker mode."""
    if version not in binding["known"]:
        raise ProofRefused(
            "artifact version %r has no frozen record (known: %s); refusing "
            "instead of falling back to %s"
            % (version, ", ".join(sorted(binding["known"])), FIRST_BUILD_BINDING)
        )
    if version == binding["replication"]:
        return REPLICATION_BINDING
    return FIRST_BUILD_BINDING


def check_proof(proof, binding):
    """Refuse a proof whose named mode does not survive re-derivation.

    Order matters: an unknown version dies first, a lying mode second, a proof
    for the wrong version third - so each of the three holes has its own
    reachable refusal instead of being masked by an earlier check.
    """
    version = proof.get("artifactVersion")
    derived = expected_mode(version, binding)
    claimed = proof.get("boundManifestMode")
    if claimed != derived:
        raise ProofRefused(
            "proof claims bound-manifest mode %r, re-derived mode for %s is %r"
            % (claimed, version, derived)
        )
    if version != binding["current"]:
        raise ProofRefused(
            "proof is for artifact version %r, the current bound version is %r"
            % (version, binding["current"])
        )
    matches = proof.get("matchesBoundManifest")
    if derived == REPLICATION_BINDING and matches is not True:
        raise ProofRefused(
            "replication mode requires matchesBoundManifest true, got %r" % (matches,)
        )
    if derived == FIRST_BUILD_BINDING and matches is not None:
        raise ProofRefused(
            "first build of a version cannot claim a bound-manifest match (%r)"
            % (matches,)
        )
    return derived


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--proof", required=True)
    args = parser.parse_args()
    with open(args.proof, encoding="utf-8") as handle:
        proof = json.load(handle)
    mode = check_proof(proof, frozen_binding())
    print("MODEGUARD OK - %s re-derived for artifact version %s"
          % (mode, proof.get("artifactVersion")))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except ProofRefused as error:
        print("MODEGUARD REFUSED: " + str(error), file=sys.stderr)
        sys.exit(1)

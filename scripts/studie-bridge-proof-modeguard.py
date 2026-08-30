#!/usr/bin/env python3
"""Caller-side pre-flight for the R2-A1 independent-rebuild proof (finding H6).

Rule modeguard/2 - MANIFEST EQUALITY. Ordered by the court of 2026-08-30
(`_COURT-MODEGUARD-2026-08-30.md`, option C, seven binding conditions) after
rule modeguard/1 was found not viable (DENIED, severity 9/10).

WHY THE RULE CHANGED. modeguard/1 re-derived the bound-manifest MODE from the
frozen records and refused any proof whose named mode differed. For the current
version 1.2.0 it derived FIRST_BUILD_OF_VERSION, because its replication case
was read out of the 1.1.0 correction alone. The repaired resolver in the pinned
script derives REPLICATION_AGAINST_BOUND_MANIFEST for the same version. The
consequence was measured, not suspected: an honest future 1.2.0 rebuild proof
was refused as a lying mode, and the only proof shape that passed was one that
downgraded ITSELF to the weaker mode - the guard rewarded exactly the
self-declaration it was built against.

WHAT DECIDES NOW. Not the mode, but the invariant the frozen closure record
states in words for every 1.2.0 proof, first build or rebuild alike: "Ein
spaeterer Neubau von 1.2.0 ist damit ein Replikations-Fall und muss dieses
Manifest exakt reproduzieren". Three values must agree:

  * SOLL   - `boundManifest.manifestFileSha256`, resolved out of the frozen
             closure record. Never a literal in this file (condition 1).
  * IST    - sha256 RE-COMPUTED here from the manifest file on disk. A proof
             that merely NAMES the bound hash proves nothing; the hash must be
             recomputed or a hand-edited proof walks through (condition R1,
             pinned by the sabotage test in the test file).
  * CLAIM  - `manifestSha256` as carried by the proof.

`boundManifestMode` stays DESCRIPTIVE. It must still be named and must still
agree with `matchesBoundManifest` - a missing field is refused, never
defaulted - but it no longer switches which gate applies.

H6 IS NOT CLOSED (condition 5). The root is still open: the pinned
`load_independent_rebuild_proof()` believes the mode a proof claims about
itself and never re-derives it. It does recompute the manifest hash, but only
against the manifest of the CURRENT run - never against the frozen record - so
a rebuild that diverges from the bound manifest is not caught there either.
H6 is carried as "root open, mitigated at the caller"; option D (re-derivation
inside the pinned loader) stays in the queue.

    python scripts/studie-bridge-proof-modeguard.py --proof <proof.json>
    python scripts/studie-identity-bridge-artifact.py --discovery ... \
        --independent-proof <proof.json> ...

Every value is read out of the frozen records, never out of the guarded
script, so a defect in the guarded resolver cannot travel into its own gate.
`--manifest` points the check at the manifest a future run actually built;
without it the manifest named by the record's canonical run is checked. The
pinned loader independently holds the proof against the run's own manifest, so
a wrong `--manifest` does not buy a green run - it only moves which of the two
legs reports first.
"""

import argparse
import hashlib
import json
import os
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# The rule is versioned and named in every verdict line (condition 7). A
# rollback may switch the default checker, but must invalidate neither the
# historic first-build proof nor a proof already carried under this rule -
# both are pinned as acceptable in tests/studie-bridge-proof-modeguard.test.js.
CHECK_RULE = "modeguard/2-manifest-equality"

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


def sha256_file(path):
    """Re-compute, never read a claimed value. Kept local on purpose: the guard
    must not import the pinned script it gates."""
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for block in iter(lambda: handle.read(65536), b""):
            digest.update(block)
    return digest.hexdigest()


def frozen_binding(repo=REPO):
    """Read the version binding AND the bound manifest out of the frozen
    records themselves. Every field is mandatory: a record that does not name
    its bound manifest refuses the run instead of degrading to a mode check."""
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
    bound_manifest = (closure.get("boundManifest") or {}).get("manifestFileSha256")
    if not bound_manifest:
        raise ProofRefused(
            "frozen closure record %s names no boundManifest.manifestFileSha256;"
            " refusing instead of falling back to a mode check" % V120_CLOSURE_REL
        )
    manifest_rel = ((closure.get("canonicalRun") or {}).get("artifacts") or {}).get(
        "manifest"
    )
    if not manifest_rel:
        raise ProofRefused(
            "frozen closure record %s names no canonicalRun.artifacts.manifest"
            % V120_CLOSURE_REL
        )
    return {
        "current": current,
        "replication": replication,
        "known": {v for v in (current, superseded, replication) if v},
        "boundManifest": bound_manifest,
        "manifestRel": manifest_rel,
        "source": V120_CLOSURE_REL,
    }


def expected_mode(version, binding):
    """Descriptive only under modeguard/2: the mode a proof for this version is
    expected to NAME. It no longer decides whether the proof passes - manifest
    equality does. Kept because the refusal for an unknown version still has to
    say what the weaker mode would have been."""
    if version not in binding["known"]:
        raise ProofRefused(
            "artifact version %r has no frozen record (known: %s); refusing "
            "instead of falling back to %s"
            % (version, ", ".join(sorted(binding["known"])), FIRST_BUILD_BINDING)
        )
    if version == binding["replication"]:
        return REPLICATION_BINDING
    return FIRST_BUILD_BINDING


def check_proof(proof, binding, manifest_path):
    """Refuse a proof that does not reproduce the bound manifest.

    Order matters, and every hole keeps its own reachable refusal: an unknown
    version dies first, a proof for the wrong version second, an unnamed or
    self-contradicting mode third, a manifest that is not the bound one last.
    """
    version = proof.get("artifactVersion")
    expected_mode(version, binding)
    if version != binding["current"]:
        raise ProofRefused(
            "proof is for artifact version %r, the current bound version is %r"
            % (version, binding["current"])
        )
    # The mode is descriptive now, but it is still mandatory and still has to
    # agree with itself - no branch waves a missing field through (condition 2).
    claimed_mode = proof.get("boundManifestMode")
    if claimed_mode not in (REPLICATION_BINDING, FIRST_BUILD_BINDING):
        raise ProofRefused(
            "proof claims bound-manifest mode %r, which names neither %s nor %s"
            % (claimed_mode, REPLICATION_BINDING, FIRST_BUILD_BINDING)
        )
    matches = proof.get("matchesBoundManifest")
    if claimed_mode == REPLICATION_BINDING and matches is not True:
        raise ProofRefused(
            "replication mode requires matchesBoundManifest true, got %r" % (matches,)
        )
    if claimed_mode == FIRST_BUILD_BINDING and matches is not None:
        raise ProofRefused(
            "first build of a version cannot claim a bound-manifest match (%r)"
            % (matches,)
        )
    # The deciding leg. SOLL out of the record, IST re-computed from the file,
    # CLAIM out of the proof - all three named in every outcome (condition 3).
    soll = binding["boundManifest"]
    if not os.path.exists(manifest_path):
        raise ProofRefused(
            "manifest %s does not exist; SOLL %s from %s cannot be checked "
            "against anything" % (manifest_path, soll, binding["source"])
        )
    ist = sha256_file(manifest_path)
    if ist != soll:
        raise ProofRefused(
            "manifest does not reproduce the bound manifest: SOLL %s (source %s), "
            "IST %s (re-computed from %s)"
            % (soll, binding["source"], ist, manifest_path)
        )
    claim = proof.get("manifestSha256")
    if claim != soll:
        raise ProofRefused(
            "proof is bound to another manifest: SOLL %s (source %s), proof "
            "claims %s" % (soll, binding["source"], claim)
        )
    return {"mode": claimed_mode, "soll": soll, "ist": ist,
            "source": binding["source"], "manifest": manifest_path}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--proof", required=True)
    parser.add_argument(
        "--manifest",
        help="manifest the run actually built; defaults to the manifest named "
             "by canonicalRun.artifacts.manifest in the frozen closure record",
    )
    args = parser.parse_args()
    with open(args.proof, encoding="utf-8") as handle:
        proof = json.load(handle)
    binding = frozen_binding()
    manifest_path = args.manifest or os.path.join(
        REPO, *binding["manifestRel"].split("/")
    )
    result = check_proof(proof, binding, manifest_path)
    print(
        "MODEGUARD OK [%s] - manifest reproduced: SOLL %s (source %s), IST %s "
        "(re-computed from %s); artifact version %s, declared mode %s"
        % (CHECK_RULE, result["soll"], result["source"], result["ist"],
           result["manifest"], proof.get("artifactVersion"), result["mode"])
    )
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except ProofRefused as error:
        print("MODEGUARD REFUSED [%s]: %s" % (CHECK_RULE, error), file=sys.stderr)
        sys.exit(1)

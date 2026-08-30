#!/usr/bin/env python3
"""R2-A1: deterministic identity-only panel bridge with a semantic seam guard."""

from __future__ import annotations

import argparse
import bisect
import hashlib
import hmac
import importlib.util
import json
import os
import re
import subprocess
import sys
from collections import defaultdict


REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PREREG_REL = (
    "protocol/early-detection/2.0.0/"
    "r2-a1-identity-bridge-artifact-preregistration.json"
)
PREREG = os.path.join(REPO, *PREREG_REL.split("/"))
CORRECTION_REL = (
    "protocol/early-detection/2.0.0/"
    "r2-a1-blocker1-identity-protection-correction.json"
)
CORRECTION = os.path.join(REPO, *CORRECTION_REL.split("/"))
DETERMINISM_CORRECTION_REL = (
    "protocol/early-detection/2.0.0/"
    "r2-a1-blocker2-independent-rebuild-correction.json"
)
DETERMINISM_CORRECTION = os.path.join(
    REPO, *DETERMINISM_CORRECTION_REL.split("/")
)
BLOCKER_CLOSURE_REL = (
    "protocol/early-detection/2.0.0/"
    "r2-a1-blocker2-3-closure-record.json"
)
BLOCKER_CLOSURE = os.path.join(REPO, *BLOCKER_CLOSURE_REL.split("/"))
V120_CLOSURE_REL = (
    "protocol/early-detection/2.0.0/"
    "r2-a1-v120-closure-record.json"
)
DETERMINISM_FIXTURE_REL = (
    "tests/fixtures/studie-identity-bridge-determinism-input.json"
)
DETERMINISM_FIXTURE = os.path.join(REPO, *DETERMINISM_FIXTURE_REL.split("/"))
D3_SCRIPT_REL = "scripts/studie-identifier-bridge.py"
BASIS_SCRIPT_REL = "scripts/studie-basisraten.py"
COUNT_SCRIPT_REL = "scripts/studie-zaehlprobe.py"
SEALED_SCRIPT_REL = "scripts/studie-e4d-kadenz.py"
LAST_ALLOWED_DATE = "2020-12-31"
LAST_ALLOWED_DDATE = "20201231"
ARTIFACT_VERSION = "1.2.0"
PRIOR_ARTIFACT_VERSION = "1.0.0"
BLOCKER1_ARTIFACT_VERSION = "1.1.0"
# ARTIFACT_VERSION sits inside the HMAC payload, so every bump changes all E-,
# I- and S-IDs and therefore the pinned logical payload hash. A payload pin is
# valid for exactly ONE artifact version and is written by that version's
# post-run closure record. Old versions stay checkable against their own
# record; a missing entry is a loud refusal, never a silent pass.
CLOSURE_RECORDS = {
    "1.1.0": (BLOCKER_CLOSURE_REL, "FROZEN_BLOCKER_2_3_CLOSURE"),
    "1.2.0": (V120_CLOSURE_REL, "FROZEN_V120_CLOSURE"),
}
PRIOR_MANIFEST_SHA256 = "d6e6af0bded542bdc104f35a5b2d2a1e35d1ef95acc63fb4f17ebab3ea8414bc"
PUBLIC_ID_SAMPLE = 50
PUBLIC_CIK_MAX = 2_100_000
INDEPENDENT_FINGERPRINT_FIELDS = (
    "artifactVersion",
    "logicalPayloadSha256",
    "manifestFileSha256",
    "manifestPayloadSha256",
    "shardSetSha256",
    "orderedShardDescriptorsSha256",
    "countsSha256",
    "inputsSha256",
    "keyFingerprintSha256",
)
BLOCK = 4_000_000
SHARD_MAX_BYTES = 180 * 1024
FACT_METADATA_COLUMNS = (
    "rowid", "adsh", "tag", "version", "coreg", "ddate", "qtrs", "uom"
)
FORBIDDEN_FACT_COLUMNS = {
    "value", "signal", "outcome", "price", "return", "growth", "acceleration"
}
WINDOWS = (
    ("entdeckung", "entdeckung", "panel-entdeckung.sqlite"),
    ("pruefung", "pruefung", "panel-validierung.sqlite"),
)
# Every exclusion the scan can make, with the already-read row count it is
# measured against. Declared here so a counter that never fires reports 0
# instead of being absent: zero and never-measured must stay distinguishable.
EXCLUSION_COUNTERS = {
    "nonperiodicReportsExcluded": "reportRowsRead",
    "reportsWithoutAcceptedExcluded": "reportRowsRead",
    "reportsWithoutValidCikExcluded": "reportRowsRead",
    "reportsWithoutNameExcluded": "reportRowsRead",
    "coregFactMetadataExcluded": "factMetadataRowsRead",
    "customTaxonomyMetadataExcluded": "factMetadataRowsRead",
    "nonperiodicFactMetadataExcluded": "factMetadataRowsRead",
    "factMetadataWithoutIdentityExcluded": "factMetadataRowsRead",
    "factMetadataWithoutUnitExcluded": "factMetadataRowsRead",
    "factMetadataOutsideDateExcluded": "factMetadataRowsRead",
}


class ArtifactError(Exception):
    """Fail-closed bridge-contract violation."""


def load_module(relative, name):
    path = os.path.join(REPO, *relative.split("/"))
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise ArtifactError("Module cannot be loaded: " + relative)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


BASIS = load_module(BASIS_SCRIPT_REL, "r2_a1_basis")
COUNT = load_module(COUNT_SCRIPT_REL, "r2_a1_count")
SOURCE_DEFINITIONS = tuple(BASIS.UMSATZ_QUELLEN)
SOURCE_RANK = {source: rank for rank, (source, _tags) in enumerate(SOURCE_DEFINITIONS)}
SOURCE_TAGS = tuple(sorted({tag for _source, tags in SOURCE_DEFINITIONS for tag in tags}))


def repo_path(relative):
    return os.path.join(REPO, *relative.split("/"))


def sha256_bytes(value):
    return hashlib.sha256(value).hexdigest()


def sha256_file(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def canonical_bytes(value):
    return (json.dumps(
        value, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    ) + "\n").encode("utf-8")


def canonical_hash(value):
    return sha256_bytes(canonical_bytes(value))


def write_json(path, value):
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    with open(path, "wb") as handle:
        handle.write(canonical_bytes(value))


def write_text(path, value):
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as handle:
        handle.write(value)


def shard_payload(part, entities):
    return {
        "schema": "R2-A1-identity-bridge-panel-shard/1",
        "artifactVersion": ARTIFACT_VERSION,
        "part": part,
        "entities": entities,
    }


def manifest_from_artifact(artifact, manifest_basename):
    groups = []
    current = []
    for entity in artifact["entities"]:
        candidate = current + [entity]
        payload = shard_payload(len(groups) + 1, candidate)
        if len(canonical_bytes(payload)) >= SHARD_MAX_BYTES and current:
            groups.append(current)
            current = [entity]
            payload = shard_payload(len(groups) + 1, current)
        else:
            current = candidate
        if len(canonical_bytes(payload)) >= SHARD_MAX_BYTES:
            raise ArtifactError("One bridge entity exceeds the artifact shard ceiling")
    if current:
        groups.append(current)

    shard_dir = os.path.splitext(manifest_basename)[0]
    shards = []
    descriptors = []
    for index, entities in enumerate(groups, start=1):
        payload = shard_payload(index, entities)
        raw = canonical_bytes(payload)
        relative = shard_dir + "/part-%04d.json" % index
        descriptors.append({
            "file": relative,
            "sha256": sha256_bytes(raw),
            "bytes": len(raw),
            "entities": len(entities),
            "identifierMappings": sum(len(row["identifiers"]) for row in entities),
            "bridgeSeams": sum(len(row["seams"]) for row in entities),
        })
        shards.append((relative, payload))
    manifest = {
        "schema": "R2-A1-identity-bridge-panel-manifest/1",
        "artifactVersion": artifact["artifactVersion"],
        "preregistration": artifact["preregistration"],
        "identityProtectionCorrection": artifact["identityProtectionCorrection"],
        "construction": artifact["construction"],
        "seamContract": artifact["seamContract"],
        "inputs": artifact["inputs"],
        "exclusions": artifact["exclusions"],
        "counts": artifact["counts"],
        "logicalPayloadSha256": artifact["canonicalPayloadSha256"],
        "shardSetSha256": canonical_hash(descriptors),
        "shards": descriptors,
    }
    manifest["canonicalPayloadSha256"] = canonical_hash(manifest)
    return manifest, shards


def deterministic_build_fingerprint(artifact, manifest):
    fingerprint = {
        "artifactVersion": artifact["artifactVersion"],
        "logicalPayloadSha256": artifact["canonicalPayloadSha256"],
        "manifestFileSha256": sha256_bytes(canonical_bytes(manifest)),
        "manifestPayloadSha256": manifest["canonicalPayloadSha256"],
        "shardSetSha256": manifest["shardSetSha256"],
        "orderedShardDescriptorsSha256": canonical_hash(manifest["shards"]),
        "countsSha256": canonical_hash(artifact["counts"]),
        "inputsSha256": canonical_hash(artifact["inputs"]),
        "keyFingerprintSha256": artifact["construction"]["identifierProtection"][
            "keyFingerprintSha256"],
    }
    if tuple(fingerprint) != INDEPENDENT_FINGERPRINT_FIELDS:
        raise ArtifactError("Independent fingerprint fields drifted from registration")
    return fingerprint


def independent_build_record(artifact, manifest, state, sabotage=False):
    fingerprint = deterministic_build_fingerprint(artifact, manifest)
    if sabotage:
        fingerprint = dict(fingerprint)
        fingerprint["shardSetSha256"] = "0" * 64
    return {
        "schema": "R2-A1-independent-builder-record/1",
        "processId": os.getpid(),
        "pythonRuntime": "%d.%d.%d" % sys.version_info[:3],
        "scanPanelCalls": state["scanPanelCalls"],
        "panelsScanned": [row["file"] for row in artifact["inputs"]],
        "fingerprint": fingerprint,
        "sabotageApplied": sabotage,
    }


def load_determinism_correction():
    with open(DETERMINISM_CORRECTION, encoding="utf-8") as handle:
        correction = json.load(handle)
    if correction.get("status") != "FROZEN_BEFORE_INDEPENDENT_REBUILDS":
        raise ArtifactError("Independent-rebuild correction is not frozen")
    if tuple(correction.get("deterministicFingerprintFields", ())) != (
            INDEPENDENT_FINGERPRINT_FIELDS):
        raise ArtifactError("Independent fingerprint no longer matches its correction")
    return correction


REPLICATION_BINDING = "REPLICATION_AGAINST_BOUND_MANIFEST"
FIRST_BUILD_BINDING = "FIRST_BUILD_OF_VERSION"
SHA256_PATTERN = re.compile(r"[0-9a-f]{64}\Z")


def closure_record(version):
    """The FROZEN post-run closure record of that version, or None.

    None means exactly one thing: the version IS registered, but its post-run
    record has not been written yet. A record that exists with the wrong status
    is not absence, it is tampering, and it refuses loudly. An unregistered
    version refuses loudly too - guessing a record path is how a pin turns into
    a suggestion.
    """
    entry = CLOSURE_RECORDS.get(version)
    if entry is None:
        raise ArtifactError(
            "No closure record is registered for artifact version " + version
        )
    relative, expected_status = entry
    path = repo_path(relative)
    if not os.path.isfile(path):
        return None
    with open(path, encoding="utf-8") as handle:
        record = json.load(handle)
    # These records are hand-maintained JSON. A malformed one must arrive as a
    # named ArtifactError, not as an AttributeError from the next .get() - the
    # fail-closed contract is only worth something if it is readable.
    if not isinstance(record, dict):
        raise ArtifactError(
            "Closure record for artifact version " + version
            + " is not a JSON object: " + relative
        )
    if record.get("status") != expected_status:
        raise ArtifactError(
            "Closure record for artifact version " + version + " is not frozen"
        )
    return record


def frozen_bound_manifest(record, version):
    """The manifest a FROZEN record binds for that version, or None.

    None means the record carries no boundManifest AT ALL - the 1.1.0 shape,
    an honest "nothing to replicate". Absence is the only reading that means
    it. A record that DOES carry the field has to carry it properly: a hollow
    body, a wrong type or a value that is not a sha256 is a named refusal, not
    a quiet fall-through to the weaker mode. These records are hand-maintained
    JSON, so a malformed one must arrive as an ArtifactError rather than as an
    AttributeError from the next attribute access.
    """
    if "boundManifest" not in record:
        return None
    bound_manifest = record["boundManifest"]
    if not isinstance(bound_manifest, dict):
        raise ArtifactError(
            "boundManifest of artifact version " + version
            + " is not a JSON object: " + repr(bound_manifest)
        )
    pinned = bound_manifest.get("manifestFileSha256")
    if not isinstance(pinned, str) or not SHA256_PATTERN.match(pinned):
        raise ArtifactError(
            "Bound manifest pin for artifact version " + version
            + " is not a sha256: " + repr(pinned)
        )
    return pinned


def bound_manifest_binding(version):
    """Resolve the prior-manifest binding for THAT artifact version.

    Context-dependent, version-aware (ENTSCHIED 9), same two-stage shape as the
    Q1 payload pin: what a run can be held against depends on whether a frozen
    record already pins it. The binding is READ OUT OF THE RECORDS - H7 was the
    defect where it came from one hardwired version instead.

    REPLICATION_AGAINST_BOUND_MANIFEST - a frozen record binds a manifest for
        this version, so both rebuilds must reproduce that exact manifest.
        Blocker-2 semantics for 1.1.0 are untouched; the v1.2.0 closure record
        promises the same thing for 1.2.0 in boundManifest.resolution, and that
        promise is what this function now keeps.
    FIRST_BUILD_OF_VERSION - the version is registered but its post-run record
        is not written yet, so there is nothing to replicate: a corrected
        version changes the artifact bytes by design and can never reproduce
        its predecessor's manifest. The gate is then the A==B identity, and the
        binding is deferred to the record it will be written to. Unchanged in
        semantics and gate - it merely stops being the silent default.

    A version that is neither is REFUSED. Falling back to the weaker mode for
    an unknown version is precisely the fail-open this function exists to
    prevent, and the mode is returned so the attestation can NAME it.

    Authority: r2-a1-v120-bound-manifest-resolution-addendum-2026-08-30.json.
    """
    bound = load_determinism_correction()["boundArtifact"]
    if version == bound["artifactVersion"]:
        return REPLICATION_BINDING, bound["manifestSha256BeforeCorrection"]
    if version not in CLOSURE_RECORDS:
        raise ArtifactError(
            "Artifact version " + version + " binds no frozen record and is no"
            " registered first build; refusing to degrade to " + FIRST_BUILD_BINDING
        )
    record = closure_record(version)
    if record is None:
        return FIRST_BUILD_BINDING, None
    pinned = frozen_bound_manifest(record, version)
    if pinned is None:
        return FIRST_BUILD_BINDING, None
    return REPLICATION_BINDING, pinned


def compare_independent_build_records(builder_a, builder_b):
    correction = load_determinism_correction()
    mismatches = [
        field for field in INDEPENDENT_FINGERPRINT_FIELDS
        if builder_a["fingerprint"].get(field)
        != builder_b["fingerprint"].get(field)
    ]
    process_ids_distinct = (
        builder_a.get("processId") != builder_b.get("processId")
    )
    runtimes_equal = (
        builder_a.get("pythonRuntime") == builder_b.get("pythonRuntime")
    )
    scans_per_process = [
        builder_a.get("scanPanelCalls"), builder_b.get("scanPanelCalls")
    ]
    expected_panels = correction["boundArtifact"]["expectedPanels"]
    panels_match = (
        builder_a.get("panelsScanned") == expected_panels
        and builder_b.get("panelsScanned") == expected_panels
    )
    built_version = builder_a["fingerprint"].get("artifactVersion")
    binding_mode, expected_manifest = bound_manifest_binding(built_version)
    if expected_manifest is None:
        # Not applicable, not "passed": None never reads as a satisfied check.
        bound_manifest_match = None
        deferred_to = (CLOSURE_RECORDS.get(built_version) or (None,))[0]
    else:
        bound_manifest_match = (
            builder_a["fingerprint"].get("manifestFileSha256") == expected_manifest
            and builder_b["fingerprint"].get("manifestFileSha256") == expected_manifest
        )
        deferred_to = None
    passes = (
        not mismatches
        and process_ids_distinct
        and scans_per_process == [2, 2]
        and panels_match
        and bound_manifest_match is not False
        and runtimes_equal
    )
    return {
        "schema": "R2-A1-independent-rebuild-proof/1",
        "artifactVersion": builder_a["fingerprint"]["artifactVersion"],
        "manifestSha256": builder_a["fingerprint"]["manifestFileSha256"],
        "determinismCorrection": {
            "path": DETERMINISM_CORRECTION_REL,
            "sha256": sha256_file(DETERMINISM_CORRECTION),
            "status": correction["status"],
        },
        "builders": [builder_a, builder_b],
        "independentProcessesExecuted": 2,
        "processIdsDistinct": process_ids_distinct,
        "pythonRuntimesEqual": runtimes_equal,
        "scanPanelCallsPerProcess": scans_per_process,
        "totalScanPanelCalls": sum(
            value for value in scans_per_process if isinstance(value, int)
        ),
        "panelsMatchRegistration": panels_match,
        "boundManifestMode": binding_mode,
        "matchesBoundManifest": bound_manifest_match,
        "priorManifestBindingDeferredTo": deferred_to,
        "fingerprintFieldsCompared": list(INDEPENDENT_FINGERPRINT_FIELDS),
        "fingerprintMismatches": mismatches,
        "observedStatus": "GREEN" if passes else "RED",
        "passes": passes,
        "companyIdentifiersWritten": 0,
    }


def write_sharded_artifact(manifest_path, artifact, manifest, shards):
    validate_bridge_write_bundle(artifact, manifest, shards)
    root = os.path.dirname(os.path.abspath(manifest_path))
    expected_names = {relative.replace("/", os.sep) for relative, _payload in shards}
    shard_root = os.path.join(root, os.path.splitext(os.path.basename(manifest_path))[0])
    if os.path.isdir(shard_root):
        observed = {
            os.path.relpath(os.path.join(base, name), root)
            for base, _dirs, files in os.walk(shard_root)
            for name in files
        }
        unexpected = observed - expected_names
        if unexpected:
            raise ArtifactError("Shard directory contains unexpected files; refusing implicit deletion")
    for relative, payload in shards:
        path = os.path.join(root, *relative.split("/"))
        write_json(path, payload)
        if os.path.getsize(path) >= 200 * 1024:
            raise ArtifactError("Written bridge shard exceeds the study artifact ceiling")
    write_json(manifest_path, manifest)


def normalize_cik(value):
    raw = str(value or "").strip()
    if not raw.isdigit():
        return None
    return str(int(raw))


def normalize_name(value):
    raw = str(value or "").upper().strip()
    raw = re.sub(r"[^A-Z0-9]+", " ", raw)
    return " ".join(raw.split())


def form_stem(value):
    return str(value or "").upper().strip().split("/", 1)[0]


def accepted_date(value):
    raw = str(value or "").strip()
    if not re.match(r"^\d{4}-\d{2}-\d{2}", raw):
        return None
    return raw[:10]


def compact_date(value):
    """Render either date notation as the panel's compact YYYYMMDD form.

    `ddate` arrives as "20201231", `accepted` as "2020-12-31". Both must be
    comparable against LAST_ALLOWED_DDATE and sortable against each other, so
    every date that reaches the artifact is normalised here first.
    """
    raw = re.sub(r"[^0-9]", "", str(value or ""))
    return raw if re.match(r"^\d{8}$", raw) else None


def beyond_date_wall(value):
    """Single date-wall predicate; an unreadable date is never inside the wall."""
    compact = compact_date(value)
    if compact is None:
        return True
    return compact > LAST_ALLOWED_DDATE


def legacy_stable_id(prefix, *parts):
    """Rejected v1.0.0 mapping, retained only so the public attack stays executable."""
    payload = ("R2-A1/" + prefix + "/1\0" + "\0".join(parts)).encode("utf-8")
    return prefix + "-" + hashlib.sha256(payload).hexdigest()[:20]


def stable_id(identity_key, prefix, *parts):
    if not isinstance(identity_key, bytes) or len(identity_key) < 32:
        raise ArtifactError("Identity HMAC key must contain at least 32 bytes")
    payload = (
        "R2-A1/identity-artifact/" + ARTIFACT_VERSION + "/" + prefix + "\0"
        + "\0".join(parts)
    ).encode("utf-8")
    return prefix + "-" + hmac.new(identity_key, payload, hashlib.sha256).hexdigest()[:20]


def load_identity_key(path):
    if not path:
        raise ArtifactError("--identity-key-file is required for empirical identifiers")
    absolute = os.path.realpath(os.path.abspath(path))
    try:
        if os.path.commonpath((REPO, absolute)) == os.path.commonpath((REPO, REPO)):
            raise ArtifactError("Identity HMAC key must remain outside the repository")
    except ValueError:
        pass
    if not os.path.isfile(absolute):
        raise ArtifactError("Identity HMAC key file does not exist")
    with open(absolute, "rb") as handle:
        key = handle.read()
    if len(key) < 32:
        raise ArtifactError("Identity HMAC key must contain at least 32 bytes")
    return key


def new_scan_state(identity_key=None):
    return {
        "identityKey": identity_key,
        "scanPanelCalls": 0,
        "identities": defaultdict(lambda: {
            "names": set(), "renameEdges": set(), "windows": set()
        }),
        # tag -> compact accepted date of the earliest filing carrying that tag
        # for this (cik, unit, ddate, qtrs) period. ddate stays the period key.
        "components": defaultdict(dict),
        "dateWindows": defaultdict(set),
        # No shared counter bag: exclusions belong to the window that made
        # them and live in that window's entry of inputSummaries.
        "inputSummaries": [],
    }


def zero_exclusions(observed=None):
    """All ten counters, zero-initialised, overlaid with what was observed."""
    counters = dict.fromkeys(EXCLUSION_COUNTERS, 0)
    for name, value in (observed or {}).items():
        if name not in counters:
            raise ArtifactError("Unknown exclusion counter: " + str(name))
        counters[name] = value
    return dict(sorted(counters.items()))


def update_digest(digest, row):
    digest.update(canonical_bytes(list(row)))


def scan_panel(path, window_name, wall_name, expected_basename, state):
    if os.path.basename(os.path.abspath(path)) != expected_basename:
        raise ArtifactError("Panel basename does not match the preregistered window")
    state["scanPanelCalls"] += 1
    checked = COUNT.pruefe_mauer(path, wall_name)
    panel = COUNT.oeffne_nur_lesend(checked, wall_name)
    identity_digest = hashlib.sha256()
    fact_digest = hashlib.sha256()
    adsh_to_cik = {}
    adsh_accepted = {}
    exclusions = dict.fromkeys(EXCLUSION_COUNTERS, 0)
    summary = {
        "file": expected_basename,
        "window": window_name,
        "bytes": os.path.getsize(checked),
        "reportRowsRead": 0,
        "periodicIdentityRows": 0,
        "factMetadataRowsRead": 0,
        "eligibleFactMetadataRows": 0,
        "lastAllowedDate": LAST_ALLOWED_DATE,
    }
    try:
        query = (
            "SELECT adsh,cik,name,former,changed,form,accepted FROM bericht "
            "ORDER BY adsh"
        )
        for adsh, raw_cik, name, former, changed, form, accepted in panel.execute(query):
            summary["reportRowsRead"] += 1
            if form_stem(form) not in BASIS.PERIODISCHE_FORMEN:
                exclusions["nonperiodicReportsExcluded"] += 1
                continue
            date = accepted_date(accepted)
            if date is None:
                exclusions["reportsWithoutAcceptedExcluded"] += 1
                continue
            if date > LAST_ALLOWED_DATE:
                raise ArtifactError("A report beyond the allowed date entered an allowed panel")
            cik = normalize_cik(raw_cik)
            current_name = normalize_name(name)
            former_name = normalize_name(former)
            changed_raw = str(changed or "").strip()
            if cik is None:
                exclusions["reportsWithoutValidCikExcluded"] += 1
                continue
            if not current_name:
                exclusions["reportsWithoutNameExcluded"] += 1
                continue
            existing = adsh_to_cik.get(adsh)
            if existing is not None and existing != cik:
                raise ArtifactError("One filing identifier points to two internal CIKs")
            adsh_to_cik[adsh] = cik
            adsh_accepted[adsh] = compact_date(date)
            identity = state["identities"][cik]
            identity["names"].add(current_name)
            identity["windows"].add(window_name)
            if former_name and re.match(r"^\d{8}$", changed_raw):
                identity["renameEdges"].add(tuple(sorted((current_name, former_name))))
            update_digest(identity_digest, (
                cik, current_name, former_name, changed_raw, date, window_name
            ))
            summary["periodicIdentityRows"] += 1

        highest = panel.execute("SELECT MAX(rowid) FROM fakt").fetchone()[0] or 0
        placeholders = ",".join("?" * len(SOURCE_TAGS))
        selected_columns = ",".join(FACT_METADATA_COLUMNS)
        if FORBIDDEN_FACT_COLUMNS.intersection(FACT_METADATA_COLUMNS):
            raise ArtifactError("Production fact query contains a forbidden numeric column")
        start = 1
        while start <= highest:
            stop = start + BLOCK - 1
            fact_query = (
                "SELECT " + selected_columns + " FROM fakt "
                "WHERE rowid BETWEEN ? AND ? AND tag IN (" + placeholders + ") "
                "AND ddate <= ? ORDER BY rowid"
            )
            params = (start, stop) + SOURCE_TAGS + (LAST_ALLOWED_DDATE,)
            for (_rowid, adsh, tag, version, coreg, ddate, qtrs, uom) in panel.execute(
                    fact_query, params):
                summary["factMetadataRowsRead"] += 1
                if coreg is not None and str(coreg).strip():
                    exclusions["coregFactMetadataExcluded"] += 1
                    continue
                if not BASIS.STANDARD_VERSION_RE.match(str(version or "").strip()):
                    exclusions["customTaxonomyMetadataExcluded"] += 1
                    continue
                if str(qtrs or "").strip() not in {"1", "4"}:
                    exclusions["nonperiodicFactMetadataExcluded"] += 1
                    continue
                cik = adsh_to_cik.get(adsh)
                if cik is None:
                    exclusions["factMetadataWithoutIdentityExcluded"] += 1
                    continue
                unit = str(uom or "").strip()
                date = str(ddate or "").strip()
                if not unit:
                    exclusions["factMetadataWithoutUnitExcluded"] += 1
                    continue
                if not re.match(r"^\d{8}$", date) or date > LAST_ALLOWED_DDATE:
                    exclusions["factMetadataOutsideDateExcluded"] += 1
                    continue
                quarter_span = str(qtrs).strip()
                key = (cik, unit, date, quarter_span)
                carried_at = adsh_accepted[adsh]
                known_at = state["components"][key].get(tag)
                if known_at is None or carried_at < known_at:
                    state["components"][key][tag] = carried_at
                state["dateWindows"][(cik, unit, date)].add(window_name)
                update_digest(fact_digest, (
                    cik, tag, str(version).strip(), date, quarter_span, unit, window_name
                ))
                summary["eligibleFactMetadataRows"] += 1
            start = stop + 1
    finally:
        panel.close()
    summary["identityEvidenceSha256"] = identity_digest.hexdigest()
    summary["factMetadataEvidenceSha256"] = fact_digest.hexdigest()
    summary["exclusions"] = zero_exclusions(exclusions)
    state["inputSummaries"].append(summary)


def identity_class(identity):
    names = set(identity["names"])
    if not names:
        return None
    if len(names) == 1:
        return "cik+normalized-name-continuity"
    graph = defaultdict(set)
    for left, right in identity["renameEdges"]:
        graph[left].add(right)
        graph[right].add(left)
    reached = set()
    pending = [next(iter(names))]
    while pending:
        current = pending.pop()
        if current in reached:
            continue
        reached.add(current)
        pending.extend(graph[current] - reached)
    if names.issubset(reached):
        return "cik+explicit-rename-chain"
    return None


def source_dates_from_components(components):
    source_dates = defaultdict(set)
    for (cik, unit, date, _quarter_span), tags_present in components.items():
        for source, required_tags in SOURCE_DEFINITIONS:
            if set(required_tags).issubset(tags_present):
                source_dates[(cik, unit, source)].add(date)
    return source_dates


def source_event_dates_from_components(components):
    """accepted date on which each (cik, unit, source, ddate) was first carried.

    A source is carried once every tag it requires exists, so the completing
    moment is the latest of the per-tag first-carrying filings; across the
    quarter spans of one period key the earliest such moment wins.
    """
    events = {}
    for (cik, unit, date, _quarter_span), accepted_by_tag in components.items():
        for source, required_tags in SOURCE_DEFINITIONS:
            carried = [accepted_by_tag.get(tag) for tag in required_tags]
            if any(value is None for value in carried):
                continue
            complete_at = max(carried)
            key = (cik, unit, source, date)
            known = events.get(key)
            if known is None or complete_at < known:
                events[key] = complete_at
    return events


def selected_track(source_dates, cik, unit):
    by_source = {
        source: sorted(dates)
        for (track_cik, track_unit, source), dates in source_dates.items()
        if track_cik == cik and track_unit == unit
    }
    all_dates = sorted({date for dates in by_source.values() for date in dates})
    selected = []
    for date in all_dates:
        candidates = []
        for source, dates in by_source.items():
            if date not in dates:
                continue
            length = bisect.bisect_right(dates, date)
            candidates.append((-length, SOURCE_RANK[source], source))
        if candidates:
            selected.append((date, min(candidates)[2]))
    return selected


def identifier_id(identity_key, entity_id, source, unit):
    return stable_id(identity_key, "I", entity_id, source, unit)


def seam_id(identity_key, entity_id, unit, date, old_identifier, new_identifier):
    return stable_id(
        identity_key, "S", entity_id, unit, date, old_identifier, new_identifier
    )


def artifact_from_state(state, reverse_inputs=False):
    identity_key = state.get("identityKey")
    if not isinstance(identity_key, bytes) or len(identity_key) < 32:
        raise ArtifactError("Artifact state lacks a valid identity HMAC key")
    identities = state["identities"]
    source_dates = source_dates_from_components(state["components"])
    source_events = source_event_dates_from_components(state["components"])
    # Locals, never state: artifact_from_state is called repeatedly on one state
    # (ordering proof, stability proof) and must stay side-effect free.
    collapsed_transitions = 0
    fallback_event_dates = 0
    eligible = {}
    rejected_ambiguous = 0
    for cik, identity in identities.items():
        evidence = identity_class(identity)
        if evidence is None:
            rejected_ambiguous += 1
        else:
            eligible[cik] = evidence

    units_by_cik = defaultdict(set)
    for cik, unit, _source in source_dates:
        units_by_cik[cik].add(unit)

    entities = []
    identifier_owner = {}
    all_seam_ids = set()
    for cik in sorted(eligible, key=lambda value: (int(value), value),
                      reverse=reverse_inputs):
        entity = stable_id(identity_key, "E", cik)
        mappings = {}
        seams = []
        for unit in sorted(units_by_cik.get(cik, set()), reverse=reverse_inputs):
            track = selected_track(source_dates, cik, unit)
            selected_by_source = defaultdict(list)
            for date, source in track:
                selected_by_source[source].append(date)
            previous = None
            unit_seams = {}
            for date, source in track:
                current_identifier = identifier_id(identity_key, entity, source, unit)
                if previous is not None and previous[1] != source:
                    old_identifier = identifier_id(
                        identity_key, entity, previous[1], unit
                    )
                    event_date = source_events.get((cik, unit, source, date))
                    if event_date is None:
                        fallback_event_dates += 1
                        event_date = date
                    # One filing that first carries the new source for several
                    # period keys is ONE seam event, not one per period.
                    event_key = (old_identifier, current_identifier, event_date)
                    seam = unit_seams.get(event_key)
                    if seam is None:
                        unit_seams[event_key] = {
                            "seamId": seam_id(
                                identity_key, entity, unit, event_date,
                                old_identifier, current_identifier,
                            ),
                            "entityId": entity,
                            "date": date,
                            "seamEventDate": event_date,
                            "periodKeysCollapsed": 1,
                            "unit": unit,
                            "oldIdentifierId": old_identifier,
                            "newIdentifierId": current_identifier,
                            "identityEvidenceClass": eligible[cik],
                            "defaultSeriesPolicy": "terminate-at-seam",
                            "crossSeamRequiresExplicitMarker": True,
                        }
                    else:
                        seam["periodKeysCollapsed"] += 1
                        collapsed_transitions += 1
                        if date < seam["date"]:
                            seam["date"] = date
                previous = (date, source)
            seams.extend(unit_seams.values())
            for source, dates in selected_by_source.items():
                iid = identifier_id(identity_key, entity, source, unit)
                mappings[iid] = {
                    "identifierId": iid,
                    "entityId": entity,
                    "source": source,
                    "unit": unit,
                    "firstDate": min(dates),
                    "lastDate": max(dates),
                    "windows": sorted({
                        window
                        for date in dates
                        for window in state["dateWindows"].get((cik, unit, date), set())
                    }),
                }
        if not seams:
            continue
        for mapping in mappings.values():
            owner = identifier_owner.setdefault(mapping["identifierId"], entity)
            if owner != entity:
                raise ArtifactError("One identifier maps to more than one entity")
        for seam in seams:
            if seam["seamId"] in all_seam_ids:
                raise ArtifactError("Duplicate seam identifier")
            all_seam_ids.add(seam["seamId"])
        entities.append({
            "entityId": entity,
            "identityEvidenceClass": eligible[cik],
            "identityEvidence": {
                "internalCikExact": True,
                "normalizedNameContinuityOrRenameChain": True,
                "exchangeEvidenceAvailable": False,
            },
            "identifiers": list(mappings.values()),
            "seams": seams,
        })

    for entity in entities:
        entity["identifiers"] = sorted(entity["identifiers"],
                                        key=lambda row: row["identifierId"])
        entity["seams"] = sorted(
            entity["seams"],
            key=lambda row: (row["seamEventDate"], row["date"], row["seamId"]))
    entities = sorted(entities, key=lambda row: row["entityId"])
    input_summaries = sorted(state["inputSummaries"], key=lambda row: row["file"])
    # C: exclusions stay window-separated; the canonicalising sort travels with
    # them (zero_exclusions sorts each block, and byWindow/total sort here).
    by_window = {}
    totals = dict.fromkeys(EXCLUSION_COUNTERS, 0)
    for row in input_summaries:
        if row["window"] in by_window:
            raise ArtifactError("Two panel summaries claim one window name")
        by_window[row["window"]] = row["exclusions"]
        for name, value in row["exclusions"].items():
            totals[name] += value
    exclusions = {
        "byWindow": dict(sorted(by_window.items())),
        "denominators": dict(sorted(EXCLUSION_COUNTERS.items())),
        "total": dict(sorted(totals.items())),
    }
    # B: the multi-seam exposure is derived from the published entities and
    # carried BY the artifact; the report renders it instead of literals.
    seam_distribution = defaultdict(int)
    for row in entities:
        seam_distribution[str(len(row["seams"]))] += 1
    counts = {
        "identityEntitiesSeen": len(identities),
        "identityEntitiesEligible": len(eligible),
        "identityEntitiesRejectedAmbiguous": rejected_ambiguous,
        "entitiesWithBridgeSeams": len(entities),
        "identifierMappings": sum(len(row["identifiers"]) for row in entities),
        "bridgeSeams": sum(len(row["seams"]) for row in entities),
        "entitiesWithMultipleBridgeSeams": sum(
            1 for row in entities if len(row["seams"]) > 1),
        "maximumBridgeSeamsPerEntity": max(
            (len(row["seams"]) for row in entities), default=0),
        "bridgeSeamCountDistribution": dict(sorted(
            seam_distribution.items(), key=lambda item: int(item[0]))),
        "periodKeyTransitionsCollapsedIntoSeams": collapsed_transitions,
        "seamEventDatesFallenBackToPeriodKey": fallback_event_dates,
        "exchangeEvidenceRows": 0,
    }
    artifact = {
        "schema": "R2-A1-identity-bridge-panel/1",
        "artifactVersion": ARTIFACT_VERSION,
        "preregistration": {
            "path": PREREG_REL,
            "sha256": sha256_file(PREREG),
            "status": "FROZEN_BEFORE_R2_A1_FACT_ACCESS",
        },
        "identityProtectionCorrection": {
            "path": CORRECTION_REL,
            "sha256": sha256_file(CORRECTION),
            "status": "FROZEN_BEFORE_IDENTITY_REBUILD",
            "supersedesArtifactVersion": PRIOR_ARTIFACT_VERSION,
            "supersedesManifestSha256": PRIOR_MANIFEST_SHA256,
        },
        "construction": {
            "entityRule": "exact internal CIK plus normalized-name continuity or explicit rename chain",
            "sourceRule": "metadata-only longest available source history, then frozen source priority",
            "exchangeEvidenceAvailable": False,
            "numericFactColumnsRead": 0,
            "lastAllowedDate": LAST_ALLOWED_DATE,
            "identifierProtection": {
                "algorithm": "HMAC-SHA-256",
                "keyBytesMinimum": 32,
                "keyStoredInRepository": False,
                "keyFingerprintSha256": sha256_bytes(identity_key),
                "publicSaltUsed": False,
            },
        },
        "seamContract": {
            "default": "terminate-at-seam",
            "explicitCrossSeamMarker": "crossSeam=true",
            "requiredMarkerFields": ["crossSeam", "crossedSeamCount", "seamPolicy"],
        },
        "inputs": input_summaries,
        "exclusions": exclusions,
        "counts": counts,
        "entities": entities,
    }
    artifact["canonicalPayloadSha256"] = canonical_hash(artifact)
    validate_artifact(artifact)
    return artifact


def validate_artifact(artifact, raw_ciks=None, raw_names=None):
    if artifact.get("artifactVersion") != ARTIFACT_VERSION:
        raise ArtifactError("Artifact version does not match the identity correction")
    protection = artifact["construction"].get("identifierProtection", {})
    if protection.get("algorithm") != "HMAC-SHA-256":
        raise ArtifactError("Artifact does not use the corrected HMAC identifier scheme")
    if protection.get("keyStoredInRepository") is not False:
        raise ArtifactError("Artifact claims an in-repository identity key")
    if artifact["construction"]["numericFactColumnsRead"] != 0:
        raise ArtifactError("A numeric fact column entered the bridge artifact")
    if artifact["construction"]["lastAllowedDate"] != LAST_ALLOWED_DATE:
        raise ArtifactError("The artifact date wall changed")
    identifier_owner = {}
    for entity in artifact["entities"]:
        entity_id_value = entity["entityId"]
        identifiers = {row["identifierId"]: row for row in entity["identifiers"]}
        for iid, row in identifiers.items():
            if row["entityId"] != entity_id_value:
                raise ArtifactError("Identifier mapping points to another entity")
            owner = identifier_owner.setdefault(iid, entity_id_value)
            if owner != entity_id_value:
                raise ArtifactError("Identifier maps to multiple entities")
            if beyond_date_wall(row["lastDate"]):
                raise ArtifactError("Identifier mapping crosses the date wall")
        for seam in entity["seams"]:
            if seam["oldIdentifierId"] not in identifiers:
                raise ArtifactError("Seam old identifier has no mapping")
            if seam["newIdentifierId"] not in identifiers:
                raise ArtifactError("Seam new identifier has no mapping")
            old = identifiers[seam["oldIdentifierId"]]
            new = identifiers[seam["newIdentifierId"]]
            if old["unit"] != new["unit"] or seam["unit"] != old["unit"]:
                raise ArtifactError("A currency or unit boundary was bridged")
            if beyond_date_wall(seam["date"]):
                raise ArtifactError("A seam crosses the date wall")
            if beyond_date_wall(seam["seamEventDate"]):
                raise ArtifactError("A seam event crosses the date wall")
            if seam["defaultSeriesPolicy"] != "terminate-at-seam":
                raise ArtifactError("A seam lost its termination default")
    expected = dict(artifact)
    observed_hash = expected.pop("canonicalPayloadSha256")
    if canonical_hash(expected) != observed_hash:
        raise ArtifactError("Canonical payload hash mismatch")
    serialized = canonical_bytes(artifact).decode("utf-8")
    banned_keys = {"cik", "ticker", "adsh", "company", "companyname", "company_name"}

    def visit(value):
        if isinstance(value, dict):
            for key, child in value.items():
                if str(key).lower() in banned_keys:
                    raise ArtifactError("Raw company identity key leaked into artifact")
                visit(child)
        elif isinstance(value, list):
            for child in value:
                visit(child)
    visit(artifact)
    for raw in raw_ciks or ():
        if json.dumps(str(raw)) in serialized:
            raise ArtifactError("Raw internal CIK leaked into artifact")
    for raw in raw_names or ():
        if raw and json.dumps(str(raw), ensure_ascii=False) in serialized:
            raise ArtifactError("Raw company name leaked into artifact")


def published_entity_ids(manifest_path, sample_size=PUBLIC_ID_SAMPLE):
    with open(manifest_path, encoding="utf-8") as handle:
        manifest = json.load(handle)
    if manifest.get("artifactVersion") != ARTIFACT_VERSION:
        raise ArtifactError("Public ID watcher received the wrong artifact version")
    root = os.path.dirname(os.path.abspath(manifest_path))
    entity_ids = []
    for descriptor in manifest.get("shards", []):
        path = os.path.join(root, *descriptor["file"].split("/"))
        if sha256_file(path) != descriptor["sha256"]:
            raise ArtifactError("Public ID watcher found a shard hash mismatch")
        with open(path, encoding="utf-8") as handle:
            shard = json.load(handle)
        entity_ids.extend(row["entityId"] for row in shard.get("entities", []))
        if len(entity_ids) >= sample_size:
            break
    sample = entity_ids[:sample_size]
    if len(sample) != sample_size or len(set(sample)) != sample_size:
        raise ArtifactError("Public ID watcher could not obtain fifty unique entity IDs")
    return sample


def legacy_inversion_matches(published_ids, namespace_max):
    targets = set(published_ids)
    matches = set()
    for candidate in range(1, namespace_max + 1):
        derived = legacy_stable_id("E", str(candidate))
        if derived in targets:
            matches.add(derived)
    return len(matches)


def public_identity_proof(manifest_path, namespace_max=PUBLIC_CIK_MAX):
    sample = published_entity_ids(manifest_path, PUBLIC_ID_SAMPLE)
    matches = legacy_inversion_matches(sample, namespace_max)
    return {
        "schema": "R2-A1-public-identity-inversion-proof/1",
        "artifactVersion": ARTIFACT_VERSION,
        "manifestSha256": sha256_file(manifest_path),
        "sampledPublishedEntityIds": len(sample),
        "candidateCikMinimum": 1,
        "candidateCikMaximum": namespace_max,
        "candidateCiksTried": namespace_max,
        "repositoryPublicMappingsTried": ["v1.0.0-unsalted-truncated-sha256"],
        "hmacKeyRead": False,
        "invertiblePublishedIds": matches,
        "threshold": "zero of fifty",
        "passes": matches == 0,
        "companyIdentifiersWritten": 0,
    }


def verify_public_identity(manifest_path, proof_path=None, namespace_max=PUBLIC_CIK_MAX):
    proof = public_identity_proof(manifest_path, namespace_max)
    if proof_path:
        write_json(proof_path, proof)
    print(json.dumps({
        "candidateCikMaximum": proof["candidateCikMaximum"],
        "candidateCiksTried": proof["candidateCiksTried"],
        "invertiblePublishedIds": proof["invertiblePublishedIds"],
        "passes": proof["passes"],
        "sampledPublishedEntityIds": proof["sampledPublishedEntityIds"],
    }, sort_keys=True))
    return 0 if proof["passes"] else 1


def sabotage_reversible_ids(proof_path=None, namespace_max=PUBLIC_CIK_MAX):
    sample = [legacy_stable_id("E", str(candidate)) for candidate in range(1, 51)]
    matches = legacy_inversion_matches(sample, namespace_max)
    proof = {
        "schema": "R2-A1-public-identity-inversion-sabotage/1",
        "sabotage": "fifty-legacy-unsalted-entity-ids",
        "sampledPublishedEntityIds": len(sample),
        "candidateCikMinimum": 1,
        "candidateCikMaximum": namespace_max,
        "candidateCiksTried": namespace_max,
        "invertiblePublishedIds": matches,
        "expectedStatus": "RED",
        "observedStatus": "RED" if matches > 0 else "GREEN",
        "companyIdentifiersWritten": 0,
    }
    if proof_path:
        write_json(proof_path, proof)
    if matches > 0:
        print("IDENTITY SABOTAGE RED: reversible published IDs detected", file=sys.stderr)
        return 1
    print("IDENTITY SABOTAGE FAILED: reversible IDs stayed green", file=sys.stderr)
    return 0


def seam_pairs(artifact):
    pairs = set()
    for entity in artifact["entities"]:
        for seam in entity["seams"]:
            pairs.add((seam["oldIdentifierId"], seam["newIdentifierId"]))
    return pairs


def validate_bridge_write_payload(value, known_seams):
    """Reject derived cross-seam rows unless their enclosing result is explicit."""
    guarded_results = 0

    def visit(node):
        nonlocal guarded_results
        if isinstance(node, dict):
            if "changes" in node:
                validate_derived_result(node, known_seams)
                guarded_results += 1
                for key, child in node.items():
                    if key != "changes":
                        visit(child)
                return
            if {"fromIdentifierId", "toIdentifierId"}.issubset(node):
                if node["fromIdentifierId"] != node["toIdentifierId"]:
                    raise ArtifactError(
                        "Cross-seam provenance row is outside a guarded derived result"
                    )
            for child in node.values():
                visit(child)
        elif isinstance(node, list):
            for child in node:
                visit(child)

    visit(value)
    return guarded_results


def validate_bridge_write_bundle(artifact, manifest, shards):
    """Production write gate for the manifest and every identity-bridge shard."""
    validate_artifact(artifact)
    known_seams = seam_pairs(artifact)
    guarded_results = validate_bridge_write_payload(manifest, known_seams)
    for _relative, payload in shards:
        guarded_results += validate_bridge_write_payload(payload, known_seams)
    return guarded_results


def derive_changes(observations, artifact, cross_seam=False, emit_marker=True):
    ordered = sorted(observations, key=lambda row: row["date"])
    known_seams = seam_pairs(artifact)
    changes = []
    crossed = 0
    for previous, current in zip(ordered, ordered[1:]):
        different = previous["identifierId"] != current["identifierId"]
        if different:
            pair = (previous["identifierId"], current["identifierId"])
            if pair not in known_seams:
                raise ArtifactError("A derived calculation crosses an unknown seam")
            if not cross_seam:
                continue
            crossed += 1
        changes.append({
            "fromIdentifierId": previous["identifierId"],
            "toIdentifierId": current["identifierId"],
            "change": current["value"] - previous["value"],
        })
    result = {"changes": changes}
    if emit_marker:
        result.update({
            "crossSeam": bool(cross_seam and crossed),
            "crossedSeamCount": crossed,
            "seamPolicy": "explicit-cross-seam" if crossed else "terminate-at-seam",
        })
    validate_derived_result(result, known_seams)
    return result


def validate_derived_result(result, known_seams):
    crossed = [row for row in result.get("changes", [])
               if row["fromIdentifierId"] != row["toIdentifierId"]]
    for row in crossed:
        if (row["fromIdentifierId"], row["toIdentifierId"]) not in known_seams:
            raise ArtifactError("A derived calculation crosses an unknown seam")
    if crossed:
        if result.get("crossSeam") is not True:
            raise ArtifactError("Unmarked cross-seam derived calculation")
        if result.get("crossedSeamCount") != len(crossed):
            raise ArtifactError("Cross-seam marker count does not match the calculation")
        if result.get("seamPolicy") != "explicit-cross-seam":
            raise ArtifactError("Cross-seam calculation lacks the explicit seam policy")


def fixture_state():
    state = new_scan_state(b"fixture-only-hmac-key-32-bytes!!")
    for cik, names, edges in (
            ("100", {"ALPHA INC"}, set()),
            ("200", {"OLD CO", "NEW CO"}, {("NEW CO", "OLD CO")}),
            ("300", {"UNLINKED A", "UNLINKED B"}, set())):
        state["identities"][cik]["names"].update(names)
        state["identities"][cik]["renameEdges"].update(edges)
        state["identities"][cik]["windows"].add("pruefung")
    # accepted dates deliberately differ from the period keys so the fixture
    # exercises the accepted-time seam placement rather than the fallback.
    state["components"][("100", "USD", "20180331", "1")]["SalesRevenueNet"] = "20180510"
    state["components"][("100", "USD", "20180630", "1")]["SalesRevenueNet"] = "20180809"
    state["components"][("100", "USD", "20180930", "1")][
        "RevenueFromContractWithCustomerExcludingAssessedTax"] = "20181108"
    state["components"][("100", "EUR", "20181231", "1")][
        "RevenueFromContractWithCustomerExcludingAssessedTax"] = "20190215"
    for date in ("20180331", "20180630", "20180930", "20181231"):
        for unit in ("USD", "EUR"):
            state["dateWindows"][("100", unit, date)].add("pruefung")
    state["inputSummaries"] = [{
        "file": "fixture.sqlite", "window": "pruefung", "bytes": 1,
        "reportRowsRead": 3,
        "periodicIdentityRows": 3, "factMetadataRowsRead": 4,
        "eligibleFactMetadataRows": 4, "lastAllowedDate": LAST_ALLOWED_DATE,
        "identityEvidenceSha256": "0" * 64,
        "factMetadataEvidenceSha256": "1" * 64,
        "exclusions": zero_exclusions(),
    }]
    return state


def state_from_fixed_fixture(payload):
    if payload.get("schema") != "R2-A1-identity-bridge-determinism-input/1":
        raise ArtifactError("Determinism fixture has the wrong schema")
    key = payload.get("identityKeyUtf8", "").encode("utf-8")
    state = new_scan_state(key)
    for row in payload.get("identities", []):
        identity = state["identities"][str(row["cik"])]
        identity["names"].update(row.get("names", []))
        identity["renameEdges"].update(
            tuple(sorted(edge)) for edge in row.get("renameEdges", [])
        )
        identity["windows"].update(row.get("windows", []))
    for row in payload.get("components", []):
        key_tuple = (
            str(row["cik"]), row["unit"], row["date"], row["quarterSpan"]
        )
        # A fixture without acceptedByTag carries no accepted evidence; the
        # seam then falls back to the period key and is counted as such.
        accepted_by_tag = row.get("acceptedByTag", {})
        for tag in row.get("tags", []):
            state["components"][key_tuple][tag] = compact_date(
                accepted_by_tag.get(tag))
    for row in payload.get("dateWindows", []):
        key_tuple = (str(row["cik"]), row["unit"], row["date"])
        state["dateWindows"][key_tuple].update(row.get("windows", []))
    # The frozen fixture predates the per-window split: its single summary
    # inherits the fixture's counters, every further one starts at explicit 0.
    state["inputSummaries"] = [
        dict(row,
             window=row.get("window", "pruefung"),
             exclusions=zero_exclusions(
                 payload.get("counters", {}) if index == 0 else {}))
        for index, row in enumerate(payload.get("inputSummaries", []))
    ]
    return state


def fixed_fixture_artifact(path):
    with open(path, encoding="utf-8") as handle:
        payload = json.load(handle)
    return artifact_from_fixed_fixture_payload(payload)


def artifact_from_fixed_fixture_payload(payload):
    return artifact_from_state(state_from_fixed_fixture(payload))


def load_blocker_closure():
    with open(BLOCKER_CLOSURE, encoding="utf-8") as handle:
        record = json.load(handle)
    if record.get("status") != "FROZEN_BLOCKER_2_3_CLOSURE":
        raise ArtifactError("Blocker closure record is not frozen")
    return record


def pinned_fixture_binding(version=None):
    """Resolve the logical-payload pin from the closure record OF THAT VERSION.

    Two-stage pin protocol (ENTSCHIED 6, Q1): a correction record frozen BEFORE
    a run can only pin what is knowable beforehand - script hash, artifact
    version, procedure. The payload hash is knowable only afterwards and is
    therefore carried by a post-run closure record, one per artifact version.
    Resolving per version keeps the old pin checkable against the old artifact
    and stops a pin from one version silently judging another version's bytes.
    """
    version = version or ARTIFACT_VERSION
    record = closure_record(version)
    if record is None:
        raise ArtifactError(
            "The post-run closure record for artifact version " + version
            + " does not exist yet (" + CLOSURE_RECORDS[version][0] + "). Its"
            " payload pin is written after the one canonical re-proof, never"
            " before it."
        )
    binding = record["blocker2MutationSensitiveDeterminism"]
    # The 1.1.0 record predates the field; the version->record map already binds
    # it. Any record that DOES carry it must agree, or the pin is not its own.
    if binding.get("boundArtifactVersion", version) != version:
        raise ArtifactError(
            "Closure record pin is bound to another artifact version"
        )
    return binding


def verify_determinism_fixture(path):
    # Input-side facts (fixture bytes, deliberate mutation) are version-free and
    # stay in the blocker closure; only the OUTPUT pin is resolved per version.
    inputs = load_blocker_closure()["blocker2MutationSensitiveDeterminism"]
    if sha256_file(path) != inputs["fixedInputFixture"]["sha256"]:
        raise ArtifactError("Fixed determinism input fixture hash mismatch")
    observed = fixed_fixture_artifact(path)["canonicalPayloadSha256"]
    expected = pinned_fixture_binding()["pinnedExpectedLogicalPayloadSha256"]
    if observed != expected:
        raise ArtifactError(
            "Fixed determinism output hash mismatch: " + observed + " != " + expected
        )
    print(json.dumps({
        "fixtureSha256": sha256_file(path),
        "logicalPayloadSha256": observed,
        "status": "GREEN",
    }, sort_keys=True))
    return 0


def sabotage_determinism_fixture(path, proof_path=None):
    # The mutation must be CONTENT under the SAME artifact version, so the pin
    # fires for the mutation and not for a version jump (ENTSCHIED 6, Q1d).
    inputs = load_blocker_closure()["blocker2MutationSensitiveDeterminism"]
    expected = pinned_fixture_binding()["pinnedExpectedLogicalPayloadSha256"]
    if sha256_file(path) != inputs["fixedInputFixture"]["sha256"]:
        raise ArtifactError("Fixed determinism input fixture hash mismatch before sabotage")
    with open(path, encoding="utf-8") as handle:
        payload = json.load(handle)
    mutation = inputs["deliberateMutation"]
    component = payload["components"][mutation["componentIndex"]]
    if component[mutation["field"]] != mutation["from"]:
        raise ArtifactError("Determinism sabotage fixture no longer has its pinned source value")
    component[mutation["field"]] = mutation["to"]
    observed = artifact_from_fixed_fixture_payload(payload)["canonicalPayloadSha256"]
    proof = {
        "schema": "R2-A1-determinism-fixture-sabotage-proof/1",
        "artifactVersion": ARTIFACT_VERSION,
        "fixture": DETERMINISM_FIXTURE_REL,
        "mutation": mutation,
        "expectedLogicalPayloadSha256": expected,
        "observedLogicalPayloadSha256": observed,
        "observedStatus": "RED" if observed != expected else "GREEN",
        "passes": observed != expected,
    }
    if proof_path:
        write_json(proof_path, proof)
    if proof["passes"]:
        print(
            "DETERMINISM FIXTURE SABOTAGE RED: input mutation changed the pinned output hash",
            file=sys.stderr,
        )
        return 1
    print("DETERMINISM FIXTURE SABOTAGE FAILED: mutation stayed green", file=sys.stderr)
    return 0


SELF_TEST_NAMES = (
    "Registration is frozen before R2-A1 fact access",
    "Production fact query excludes every numeric and result column",
    "Exact CIK and normalized-name continuity is eligible",
    "Explicit rename chain is eligible",
    "Ambiguous name evidence is rejected",
    "Same-unit source change creates a semantic seam",
    "Unit change is not bridged",
    "Each identifier maps to exactly one entity",
    "Default derived calculation stops at the seam",
    "Explicit cross-seam calculation carries all markers",
    "Unmarked cross-seam calculation is rejected",
    "Unknown cross-seam calculation is rejected",
    "Canonical hash is independent of input ordering",
    "Raw company identity is absent from the artifact",
    "Date-wall violation is rejected",
    "Canonical payload hash mismatch is rejected",
    "Same-process canonical serialization is stable",
    "HMAC entity IDs change when the unseen key changes",
    "Secure fixture IDs resist the public legacy namespace attack",
    "Legacy reversible fixture IDs are recovered by the public watcher",
    "Independent comparator accepts two distinct complete build records",
    "Independent comparator rejects one mismatched rebuild fingerprint",
    "Fixed input fixture reproduces its pinned logical payload hash",
    "One fixed input field mutation changes the pinned logical payload hash",
    "Production bridge writer gates the manifest and every shard",
    "Seam event carries the accepted date while ddate stays the period key",
    "Post-wall seam event is rejected in the accepted date notation",
    "Ten exclusion counters are published per window and zero-initialised",
    "Bound-manifest replication mode enforces the pinned manifest",
    "A new artifact version defers the prior-manifest binding and names the mode",
    "Replication mode still rejects a manifest that does not match its pin",
    # H7: the two directions of the record-resolving binding.
    "Bound manifest for a closed version resolves out of its frozen record",
    "An artifact version without a frozen record is refused, not degraded",
    "A record whose bound manifest is hollow is refused, not degraded",
)


def self_test():
    failures = []

    def check(name, condition, actual=None):
        if condition:
            print("  ok    " + name)
        else:
            failures.append(name)
            print("  ROT   " + name + " (actual: " + repr(actual) + ")")

    with open(PREREG, encoding="utf-8") as handle:
        prereg = json.load(handle)
    check(SELF_TEST_NAMES[0], prereg.get("status") == "FROZEN_BEFORE_R2_A1_FACT_ACCESS",
          prereg.get("status"))
    check(SELF_TEST_NAMES[1], not FORBIDDEN_FACT_COLUMNS.intersection(FACT_METADATA_COLUMNS),
          FACT_METADATA_COLUMNS)
    state = fixture_state()
    check(SELF_TEST_NAMES[2], identity_class(state["identities"]["100"])
          == "cik+normalized-name-continuity")
    check(SELF_TEST_NAMES[3], identity_class(state["identities"]["200"])
          == "cik+explicit-rename-chain")
    check(SELF_TEST_NAMES[4], identity_class(state["identities"]["300"]) is None)
    artifact = artifact_from_state(state)
    entity = artifact["entities"][0]
    check(SELF_TEST_NAMES[5], len(entity["seams"]) == 1, entity["seams"])
    check(SELF_TEST_NAMES[6], all(
        seam["unit"] == "USD" for seam in entity["seams"]), entity["seams"])
    ownership = defaultdict(set)
    for row in artifact["entities"]:
        for mapping in row["identifiers"]:
            ownership[mapping["identifierId"]].add(mapping["entityId"])
    check(SELF_TEST_NAMES[7], all(len(owners) == 1 for owners in ownership.values()),
          ownership)
    old_id = entity["seams"][0]["oldIdentifierId"]
    new_id = entity["seams"][0]["newIdentifierId"]
    observations = [
        {"date": "20180331", "identifierId": old_id, "value": 10.0},
        {"date": "20180630", "identifierId": old_id, "value": 12.0},
        {"date": "20180930", "identifierId": new_id, "value": 30.0},
    ]
    stopped = derive_changes(observations, artifact)
    check(SELF_TEST_NAMES[8], len(stopped["changes"]) == 1
          and stopped["crossedSeamCount"] == 0, stopped)
    crossed = derive_changes(observations, artifact, cross_seam=True)
    check(SELF_TEST_NAMES[9], crossed["crossSeam"] is True
          and crossed["crossedSeamCount"] == 1
          and crossed["seamPolicy"] == "explicit-cross-seam", crossed)
    try:
        derive_changes(observations, artifact, cross_seam=True, emit_marker=False)
        unmarked_rejected = False
    except ArtifactError:
        unmarked_rejected = True
    check(SELF_TEST_NAMES[10], unmarked_rejected)
    unknown = [dict(row) for row in observations]
    unknown[-1]["identifierId"] = "I-unknown"
    try:
        derive_changes(unknown, artifact, cross_seam=True)
        unknown_rejected = False
    except ArtifactError:
        unknown_rejected = True
    check(SELF_TEST_NAMES[11], unknown_rejected)
    reversed_artifact = artifact_from_state(state, reverse_inputs=True)
    check(SELF_TEST_NAMES[12], canonical_hash(artifact) == canonical_hash(reversed_artifact),
          (canonical_hash(artifact), canonical_hash(reversed_artifact)))
    try:
        validate_artifact(artifact, raw_ciks={"100", "200", "300"},
                          raw_names={"ALPHA INC", "OLD CO", "NEW CO"})
        identity_absent = True
    except ArtifactError:
        identity_absent = False
    check(SELF_TEST_NAMES[13], identity_absent)
    bad_date = json.loads(json.dumps(artifact))
    bad_date["entities"][0]["seams"][0]["date"] = "20210101"
    body = dict(bad_date)
    body.pop("canonicalPayloadSha256")
    bad_date["canonicalPayloadSha256"] = canonical_hash(body)
    try:
        validate_artifact(bad_date)
        date_rejected = False
    except ArtifactError:
        date_rejected = True
    check(SELF_TEST_NAMES[14], date_rejected)
    bad_hash = json.loads(json.dumps(artifact))
    bad_hash["canonicalPayloadSha256"] = "f" * 64
    try:
        validate_artifact(bad_hash)
        hash_rejected = False
    except ArtifactError:
        hash_rejected = True
    check(SELF_TEST_NAMES[15], hash_rejected)
    check(SELF_TEST_NAMES[16], canonical_hash(artifact_from_state(state))
          == canonical_hash(artifact_from_state(state)), canonical_hash(artifact))
    first_key_id = stable_id(b"a" * 32, "E", "100")
    second_key_id = stable_id(b"b" * 32, "E", "100")
    check(SELF_TEST_NAMES[17], first_key_id != second_key_id,
          (first_key_id, second_key_id))
    secure_fixture_ids = [stable_id(b"a" * 32, "E", str(value))
                          for value in range(1, 11)]
    check(SELF_TEST_NAMES[18], legacy_inversion_matches(secure_fixture_ids, 100) == 0)
    legacy_fixture_ids = [legacy_stable_id("E", str(value)) for value in range(1, 11)]
    check(SELF_TEST_NAMES[19], legacy_inversion_matches(legacy_fixture_ids, 100) == 10)
    bound_artifact = load_determinism_correction()["boundArtifact"]
    registered_manifest = bound_artifact["manifestSha256BeforeCorrection"]
    # The bound version, not ARTIFACT_VERSION: pairing a corrected version with
    # its predecessor's manifest is a combination that cannot occur in a real
    # build, and pretending it can is what hid the comparator defect.
    base_fingerprint = {
        field: (bound_artifact["artifactVersion"]
                if field == "artifactVersion" else "a" * 64)
        for field in INDEPENDENT_FINGERPRINT_FIELDS
    }
    base_fingerprint["manifestFileSha256"] = registered_manifest
    record_a = {
        "schema": "R2-A1-independent-builder-record/1",
        "processId": 101,
        "pythonRuntime": "%d.%d.%d" % sys.version_info[:3],
        "scanPanelCalls": 2,
        "panelsScanned": ["panel-entdeckung.sqlite", "panel-validierung.sqlite"],
        "fingerprint": dict(base_fingerprint),
        "sabotageApplied": False,
    }
    record_b = dict(record_a)
    record_b["processId"] = 202
    record_b["fingerprint"] = dict(base_fingerprint)
    independent_ok = compare_independent_build_records(record_a, record_b)
    check(SELF_TEST_NAMES[20], independent_ok["passes"] is True, independent_ok)
    record_b["fingerprint"]["shardSetSha256"] = "0" * 64
    record_b["sabotageApplied"] = True
    independent_red = compare_independent_build_records(record_a, record_b)
    check(
        SELF_TEST_NAMES[21],
        independent_red["observedStatus"] == "RED"
        and independent_red["fingerprintMismatches"] == ["shardSetSha256"],
        independent_red,
    )

    def compared_pair(version, manifest_sha):
        fingerprint = dict(base_fingerprint)
        fingerprint["artifactVersion"] = version
        fingerprint["manifestFileSha256"] = manifest_sha
        return compare_independent_build_records(
            dict(record_a, processId=303, fingerprint=dict(fingerprint),
                 sabotageApplied=False),
            dict(record_a, processId=404, fingerprint=dict(fingerprint),
                 sabotageApplied=False),
        )

    replication = compared_pair(
        bound_artifact["artifactVersion"], registered_manifest)
    check(
        SELF_TEST_NAMES[28],
        replication["boundManifestMode"] == REPLICATION_BINDING
        and replication["matchesBoundManifest"] is True
        and replication["passes"] is True,
        replication,
    )
    # H7: ARTIFACT_VERSION cannot serve here any more - 1.2.0 HAS a frozen
    # record now and is therefore a replication case, which is the whole fix.
    # The deferred branch is the state 1.2.0 itself was in during its own first
    # build: registered, post-run record not yet written. Registering that
    # state for the length of one check is the only way to reach the branch
    # without deleting a frozen record; the entry is removed again either way.
    unwritten_version = "1.3.0-self-test"
    unwritten_record = (
        "protocol/early-detection/2.0.0/r2-a1-v130-closure-record-not-written.json"
    )
    CLOSURE_RECORDS[unwritten_version] = (unwritten_record, "FROZEN_V130_CLOSURE")
    try:
        first_build = compared_pair(unwritten_version, "b" * 64)
    finally:
        del CLOSURE_RECORDS[unwritten_version]
    check(
        SELF_TEST_NAMES[29],
        first_build["boundManifestMode"] == FIRST_BUILD_BINDING
        and first_build["matchesBoundManifest"] is None
        and first_build["priorManifestBindingDeferredTo"] == unwritten_record
        and first_build["passes"] is True,
        first_build,
    )
    # The guard must still bite in replication mode, or the fix would be a
    # blanket weakening dressed up as a mode.
    wrong_manifest = compared_pair(bound_artifact["artifactVersion"], "c" * 64)
    check(
        SELF_TEST_NAMES[30],
        wrong_manifest["boundManifestMode"] == REPLICATION_BINDING
        and wrong_manifest["matchesBoundManifest"] is False
        and wrong_manifest["passes"] is False,
        wrong_manifest,
    )
    # H7, both directions on the version the closure record actually binds. The
    # expected manifest is read out of that record here too: a literal in the
    # check would only prove that script and check share one copy.
    v120_manifest = closure_record(ARTIFACT_VERSION)["boundManifest"][
        "manifestFileSha256"]
    v120_green = compared_pair(ARTIFACT_VERSION, v120_manifest)
    v120_red = compared_pair(ARTIFACT_VERSION, "d" * 64)
    check(
        SELF_TEST_NAMES[31],
        v120_green["boundManifestMode"] == REPLICATION_BINDING
        and v120_green["matchesBoundManifest"] is True
        and v120_green["passes"] is True
        and v120_red["boundManifestMode"] == REPLICATION_BINDING
        and v120_red["matchesBoundManifest"] is False
        and v120_red["passes"] is False,
        (v120_green, v120_red),
    )
    # Before the fix an unknown version fell silently into the weaker mode.
    try:
        bound_manifest_binding("9.9.9")
        unknown_version_refused = False
    except ArtifactError:
        unknown_version_refused = True
    check(SELF_TEST_NAMES[32], unknown_version_refused)
    # A record that carries boundManifest must carry it properly. Absence is
    # the 1.1.0 shape and stays the only quiet answer; every hollow or
    # malformed body is a named refusal, or the weaker mode would be reachable
    # again through a record body instead of through an unknown version.
    hollow_records = [
        {"boundManifest": {}},
        {"boundManifest": {"manifestFileSha256": "not-a-hash"}},
        {"boundManifest": "a string, not an object"},
        {"boundManifest": {"manifestFileSha256": v120_manifest + "trailing"}},
    ]
    hollow_refused = []
    for candidate in hollow_records:
        try:
            frozen_bound_manifest(candidate, "1.2.0")
            hollow_refused.append(False)
        except ArtifactError:
            hollow_refused.append(True)
    check(
        SELF_TEST_NAMES[33],
        all(hollow_refused)
        # ... and the two honest answers still work, or the check above would
        # be satisfied by a function that only ever refuses.
        and frozen_bound_manifest({}, "1.1.0") is None
        and frozen_bound_manifest(
            {"boundManifest": {"manifestFileSha256": v120_manifest}},
            "1.2.0") == v120_manifest,
        hollow_refused,
    )
    closure = load_blocker_closure()
    fixture_binding = closure["blocker2MutationSensitiveDeterminism"]
    # Documented interim state (ENTSCHIED 6, Q2): the v1.2.0 closure record is
    # written only after the one canonical re-proof, so these two checks are
    # RED with a plaintext reason until then. Everything else must stay green.
    try:
        pinned_payload = pinned_fixture_binding()["pinnedExpectedLogicalPayloadSha256"]
        pin_state = "pin resolved for " + ARTIFACT_VERSION
    except ArtifactError as error:
        pinned_payload = None
        pin_state = str(error)
    fixture_artifact = fixed_fixture_artifact(DETERMINISM_FIXTURE)
    check(
        SELF_TEST_NAMES[22],
        sha256_file(DETERMINISM_FIXTURE) == fixture_binding["fixedInputFixture"]["sha256"]
        and fixture_artifact["canonicalPayloadSha256"] == pinned_payload,
        (pin_state, fixture_artifact["canonicalPayloadSha256"]),
    )
    with open(DETERMINISM_FIXTURE, encoding="utf-8") as handle:
        mutated_payload = json.load(handle)
    mutation = fixture_binding["deliberateMutation"]
    mutated_payload["components"][mutation["componentIndex"]][mutation["field"]] = (
        mutation["to"]
    )
    mutated_hash = artifact_from_fixed_fixture_payload(mutated_payload)[
        "canonicalPayloadSha256"
    ]
    check(
        SELF_TEST_NAMES[23],
        pinned_payload is not None and mutated_hash != pinned_payload,
        (pin_state, mutated_hash),
    )
    clean_manifest, clean_shards = manifest_from_artifact(
        fixture_artifact, "fixture-bridge.json"
    )
    clean_guarded = validate_bridge_write_bundle(
        fixture_artifact, clean_manifest, clean_shards
    )
    sabotaged_shards = json.loads(json.dumps(clean_shards))
    seam = fixture_artifact["entities"][0]["seams"][0]
    sabotaged_shards[0][1]["derivedSeries"] = {
        "changes": [{
            "fromIdentifierId": seam["oldIdentifierId"],
            "toIdentifierId": seam["newIdentifierId"],
            "change": 1.0,
        }]
    }
    try:
        write_sharded_artifact(
            os.path.join(REPO, ".never-written-bridge-sabotage.json"),
            fixture_artifact,
            clean_manifest,
            sabotaged_shards,
        )
        writer_rejected = False
    except ArtifactError:
        writer_rejected = True
    check(SELF_TEST_NAMES[24], clean_guarded == 0 and writer_rejected)
    placed = artifact["entities"][0]["seams"][0]
    check(
        SELF_TEST_NAMES[25],
        placed["seamEventDate"] == "20181108"
        and placed["date"] == "20180930"
        and placed["periodKeysCollapsed"] == 1,
        placed,
    )
    post_wall_event = json.loads(json.dumps(artifact))
    post_wall_event["entities"][0]["seams"][0]["seamEventDate"] = "2021-03-05"
    body = dict(post_wall_event)
    body.pop("canonicalPayloadSha256")
    post_wall_event["canonicalPayloadSha256"] = canonical_hash(body)
    try:
        validate_artifact(post_wall_event)
        event_rejected = False
    except ArtifactError:
        event_rejected = True
    # The raw string compare mis-orders the wall day itself ("2020-12-31" sorts
    # below "20201231"); only the normalisation makes the guard sound.
    check(
        SELF_TEST_NAMES[26],
        event_rejected
        and beyond_date_wall("2021-03-05")
        and not beyond_date_wall("2020-12-31")
        and compact_date("2020-12-31") == LAST_ALLOWED_DDATE
        and ("2020-12-31" > LAST_ALLOWED_DDATE) is False,
        event_rejected,
    )
    try:
        zero_exclusions({"typoCounterName": 1})
        unknown_counter_rejected = False
    except ArtifactError:
        unknown_counter_rejected = True
    published = artifact["exclusions"]
    check(
        SELF_TEST_NAMES[27],
        len(EXCLUSION_COUNTERS) == 10
        and set(published["total"]) == set(EXCLUSION_COUNTERS)
        and all(set(block) == set(EXCLUSION_COUNTERS)
                for block in published["byWindow"].values())
        and set(published["byWindow"]) == {"pruefung"}
        and all(value == 0 for value in published["total"].values())
        and list(published["total"]) == sorted(published["total"])
        and unknown_counter_rejected,
        published,
    )
    if failures:
        print("SELBSTTEST ROT - %d named checks failed" % len(failures))
        return 1
    print("SELBSTTEST GREEN - %d named checks" % len(SELF_TEST_NAMES))
    return 0


def sabotage_cross_seam(proof_path=None):
    state = fixture_state()
    artifact = artifact_from_state(state)
    entity = artifact["entities"][0]
    old_id = entity["seams"][0]["oldIdentifierId"]
    new_id = entity["seams"][0]["newIdentifierId"]
    observations = [
        {"date": "20180630", "identifierId": old_id, "value": 12.0},
        {"date": "20180930", "identifierId": new_id, "value": 30.0},
    ]
    try:
        derive_changes(observations, artifact, cross_seam=True, emit_marker=False)
    except ArtifactError as error:
        proof = {
            "schema": "R2-A1-cross-seam-sabotage-proof/1",
            "preregistrationSha256": sha256_file(PREREG),
            "sabotage": "unmarked-cross-seam-derived-calculation",
            "expectedStatus": "RED",
            "observedStatus": "RED",
            "failureClass": "unmarked-cross-seam",
            "guardMessage": str(error),
            "companyIdentifiersWritten": 0,
        }
        if proof_path:
            write_json(proof_path, proof)
        print("SABOTAGE RED: " + str(error), file=sys.stderr)
        return 1
    print("SABOTAGE FAILED: unmarked cross-seam calculation stayed green", file=sys.stderr)
    return 0


def sabotage_bridge_write(proof_path=None):
    artifact = fixed_fixture_artifact(DETERMINISM_FIXTURE)
    manifest, shards = manifest_from_artifact(artifact, "fixture-bridge.json")
    sabotaged = json.loads(json.dumps(shards))
    seam = artifact["entities"][0]["seams"][0]
    sabotaged[0][1]["derivedSeries"] = {
        "changes": [{
            "fromIdentifierId": seam["oldIdentifierId"],
            "toIdentifierId": seam["newIdentifierId"],
            "change": 1.0,
        }]
    }
    try:
        write_sharded_artifact(
            os.path.join(REPO, ".never-written-bridge-sabotage.json"),
            artifact,
            manifest,
            sabotaged,
        )
    except ArtifactError as error:
        proof = {
            "schema": "R2-A1-bridge-write-sabotage-proof/1",
            "writer": "write_sharded_artifact",
            "guard": "validate_bridge_write_bundle",
            "payload": "identity-bridge shard",
            "sabotage": "unmarked cross-seam derived row before shard write",
            "guardMessage": str(error),
            "observedStatus": "RED",
            "writeOccurred": False,
        }
        if proof_path:
            write_json(proof_path, proof)
        print("BRIDGE WRITE SABOTAGE RED: " + str(error), file=sys.stderr)
        return 1
    print("BRIDGE WRITE SABOTAGE FAILED: unmarked seam reached the writer", file=sys.stderr)
    return 0


def load_and_validate_sabotage(path):
    with open(path, encoding="utf-8") as handle:
        proof = json.load(handle)
    if proof.get("observedStatus") != "RED":
        raise ArtifactError("Cross-seam sabotage proof is not red")
    if proof.get("failureClass") != "unmarked-cross-seam":
        raise ArtifactError("Cross-seam sabotage failed for the wrong reason")
    if proof.get("preregistrationSha256") != sha256_file(PREREG):
        raise ArtifactError("Cross-seam sabotage proof is bound to another registration")
    return proof


def load_identity_sabotage(path):
    with open(path, encoding="utf-8") as handle:
        proof = json.load(handle)
    if proof.get("observedStatus") != "RED":
        raise ArtifactError("Identity inversion sabotage proof is not red")
    if proof.get("sampledPublishedEntityIds") != PUBLIC_ID_SAMPLE:
        raise ArtifactError("Identity sabotage does not contain fifty fixture IDs")
    if proof.get("invertiblePublishedIds") != PUBLIC_ID_SAMPLE:
        raise ArtifactError("Identity sabotage did not recover all reversible fixture IDs")
    if proof.get("candidateCikMaximum") != PUBLIC_CIK_MAX:
        raise ArtifactError("Identity sabotage did not scan the full plausible namespace")
    if proof.get("candidateCiksTried") != PUBLIC_CIK_MAX:
        raise ArtifactError("Identity sabotage did not execute every configured CIK attempt")
    return proof


def load_identity_proof(path, manifest_path):
    with open(path, encoding="utf-8") as handle:
        proof = json.load(handle)
    if proof.get("manifestSha256") != sha256_file(manifest_path):
        raise ArtifactError("Public identity proof is bound to another manifest")
    if proof.get("sampledPublishedEntityIds") != PUBLIC_ID_SAMPLE:
        raise ArtifactError("Public identity proof does not sample fifty IDs")
    if proof.get("candidateCikMaximum") != PUBLIC_CIK_MAX:
        raise ArtifactError("Public identity proof did not scan the full plausible namespace")
    if proof.get("candidateCiksTried") != PUBLIC_CIK_MAX:
        raise ArtifactError("Public identity proof did not execute every configured CIK attempt")
    if proof.get("invertiblePublishedIds") != 0 or proof.get("passes") is not True:
        raise ArtifactError("At least one sampled published ID is publicly invertible")
    if proof.get("hmacKeyRead") is not False:
        raise ArtifactError("Public identity watcher read the private HMAC key")
    return proof


def construct_empirical_build(discovery, validation, identity_key_file,
                              manifest_basename):
    state = new_scan_state(load_identity_key(identity_key_file))
    for path, (window, wall, basename) in zip(
            (discovery, validation), WINDOWS):
        scan_panel(path, window, wall, basename, state)
    artifact = artifact_from_state(state)
    manifest, shards = manifest_from_artifact(artifact, manifest_basename)
    return state, artifact, manifest, shards


def emit_independent_build(args):
    state, artifact, manifest, _shards = construct_empirical_build(
        args.discovery, args.validation, args.identity_key_file,
        os.path.basename(args.artifact),
    )
    record = independent_build_record(
        artifact, manifest, state, sabotage=args.sabotage_independent_fingerprint
    )
    print(json.dumps(record, ensure_ascii=False, sort_keys=True))
    return 0


def run_independent_build_pair(args, sabotage_child=False):
    state, artifact, manifest, shards = construct_empirical_build(
        args.discovery, args.validation, args.identity_key_file,
        os.path.basename(args.artifact),
    )
    builder_a = independent_build_record(artifact, manifest, state)
    command = [
        sys.executable, os.path.abspath(__file__),
        "--emit-independent-build",
        "--discovery", os.path.abspath(args.discovery),
        "--validation", os.path.abspath(args.validation),
        "--artifact", os.path.abspath(args.artifact),
        "--identity-key-file", os.path.abspath(args.identity_key_file),
    ]
    if sabotage_child:
        command.append("--sabotage-independent-fingerprint")
    child = subprocess.run(
        command, cwd=REPO, capture_output=True, text=True, check=False
    )
    if child.returncode != 0:
        raise ArtifactError(
            "Independent builder process failed: " + child.stderr.strip()
        )
    try:
        builder_b = json.loads(child.stdout)
    except json.JSONDecodeError as error:
        raise ArtifactError("Independent builder did not emit one JSON record") from error
    proof = compare_independent_build_records(builder_a, builder_b)
    write_json(args.independent_proof, proof)
    return artifact, manifest, shards, proof


def sabotage_independent_rebuild(args):
    _artifact, _manifest, _shards, proof = run_independent_build_pair(
        args, sabotage_child=True
    )
    expected_mismatches = ["shardSetSha256"]
    # Anchored on the isolated mismatch, NOT on observedStatus RED (ENTSCHIED 9).
    # RED is over-determined: any other failing condition also colours the proof
    # red, so RED alone would not prove that the sabotage is what was detected.
    if (
            proof["fingerprintMismatches"] == expected_mismatches
            and proof["processIdsDistinct"] is True
            and proof["scanPanelCallsPerProcess"] == [2, 2]):
        print(
            "INDEPENDENT REBUILD SABOTAGE RED: mismatched child fingerprint detected",
            file=sys.stderr,
        )
        return 1
    print(
        "INDEPENDENT REBUILD SABOTAGE FAILED: mismatched child stayed green",
        file=sys.stderr,
    )
    return 0


def load_independent_rebuild_proof(path, manifest_path):
    with open(path, encoding="utf-8") as handle:
        proof = json.load(handle)
    if proof.get("manifestSha256") != sha256_file(manifest_path):
        raise ArtifactError("Independent rebuild proof is bound to another manifest")
    if proof.get("observedStatus") != "GREEN" or proof.get("passes") is not True:
        raise ArtifactError("Independent rebuild proof is not green")
    if proof.get("processIdsDistinct") is not True:
        raise ArtifactError("Independent rebuilds did not use distinct processes")
    if proof.get("scanPanelCallsPerProcess") != [2, 2]:
        raise ArtifactError("Independent rebuilds did not each scan both panels")
    if proof.get("totalScanPanelCalls") != 4:
        raise ArtifactError("Independent rebuild proof did not record four panel scans")
    if proof.get("fingerprintMismatches") != []:
        raise ArtifactError("Independent rebuild fingerprints differ")
    # Mode-aware (ENTSCHIED 9). A proof that does not NAME its mode is refused
    # outright, so an older or hand-made proof cannot slip past the weaker gate
    # by simply omitting the field.
    if proof.get("boundManifestMode") not in (REPLICATION_BINDING, FIRST_BUILD_BINDING):
        raise ArtifactError("Independent rebuild proof does not name its bound-manifest mode")
    if proof.get("boundManifestMode") == REPLICATION_BINDING:
        if proof.get("matchesBoundManifest") is not True:
            raise ArtifactError("Independent rebuild did not reproduce the bound manifest")
    elif proof.get("matchesBoundManifest") is not None:
        raise ArtifactError("First build of a version cannot claim a bound-manifest match")
    if any(row.get("sabotageApplied") for row in proof.get("builders", [])):
        raise ArtifactError("Green independent rebuild proof contains a sabotage")
    return proof


def load_independent_rebuild_sabotage(path):
    with open(path, encoding="utf-8") as handle:
        proof = json.load(handle)
    if proof.get("observedStatus") != "RED" or proof.get("passes") is not False:
        raise ArtifactError("Independent rebuild sabotage proof is not red")
    if proof.get("processIdsDistinct") is not True:
        raise ArtifactError("Independent rebuild sabotage reused one process")
    if proof.get("scanPanelCallsPerProcess") != [2, 2]:
        raise ArtifactError("Independent rebuild sabotage did not run both full scans")
    if proof.get("fingerprintMismatches") != ["shardSetSha256"]:
        raise ArtifactError("Independent rebuild sabotage did not isolate its mismatch")
    builders = proof.get("builders", [])
    if len(builders) != 2 or builders[1].get("sabotageApplied") is not True:
        raise ArtifactError("Independent rebuild sabotage is not present in builder B")
    return proof


def build_result(artifact, manifest, artifact_path, seam_proof, seam_proof_path,
                 identity_proof, identity_proof_path, identity_sabotage,
                 identity_sabotage_path, independent_proof,
                 independent_proof_path, independent_sabotage,
                 independent_sabotage_path):
    artifact_file_hash = sha256_file(artifact_path)
    contract = {
        "status": "HOLD_BLOCKER_3_AND_METHOD_CORRECTIONS",
        "passes": False,
        "blocker1IdentityProtection": {
            "status": "PASS",
            "sampledPublishedEntityIds": identity_proof["sampledPublishedEntityIds"],
            "invertiblePublishedIds": identity_proof["invertiblePublishedIds"],
            "threshold": identity_proof["threshold"],
            "legacySabotageRecovered": identity_sabotage["invertiblePublishedIds"],
            "legacySabotageStatus": identity_sabotage["observedStatus"],
        },
        "blocker2IndependentDeterminism": {
            "status": "PASS",
            "independentProcessesExecuted": independent_proof[
                "independentProcessesExecuted"],
            "processIdsDistinct": independent_proof["processIdsDistinct"],
            "scanPanelCallsPerProcess": independent_proof[
                "scanPanelCallsPerProcess"],
            "totalScanPanelCalls": independent_proof["totalScanPanelCalls"],
            "fingerprintMismatches": len(independent_proof[
                "fingerprintMismatches"]),
            "deliberateMismatchSabotageStatus": independent_sabotage[
                "observedStatus"],
        },
        "blocker3ProvenanceDerivedSeamGuard": {
            "status": "OPEN",
            "knownSingleSabotageRed": seam_proof["observedStatus"] == "RED",
            "threeRequiredBypassSabotagesCompleted": 0,
        },
        "methodCorrections": {
            "acceptedTimeSeamPlacement": "APPLIED_PENDING_METHOD_ACCEPTANCE",
            "multipleSeamExposureRestoration": "PUBLISHED_IN_ARTIFACT",
            "completeExclusionCounters": "PUBLISHED_IN_ARTIFACT",
        },
    }
    result = {
        "schema": "R2-A1-identity-bridge-artifact-result/3",
        "preregistration": artifact["preregistration"],
        "identityProtectionCorrection": artifact["identityProtectionCorrection"],
        "corrections": [{
            "artifactVersion": PRIOR_ARTIFACT_VERSION,
            "manifestSha256": PRIOR_MANIFEST_SHA256,
            "status": "REJECTED_REVERSIBLE_IDENTIFIERS",
        }, {
            "artifactVersion": BLOCKER1_ARTIFACT_VERSION,
            "status": "BLOCKER1_IDENTITY_PROTECTION_CORRECTION",
        }, {
            "artifactVersion": ARTIFACT_VERSION,
            "status": "CURRENT_METHOD_CORRECTIONS_A_B_C",
        }, {
            "path": DETERMINISM_CORRECTION_REL,
            "sha256": sha256_file(DETERMINISM_CORRECTION),
            "status": "BLOCKER2_INDEPENDENT_REBUILDS_PASS",
        }],
        "boundImplementation": {
            D3_SCRIPT_REL: sha256_file(repo_path(D3_SCRIPT_REL)),
            BASIS_SCRIPT_REL: sha256_file(repo_path(BASIS_SCRIPT_REL)),
            COUNT_SCRIPT_REL: sha256_file(repo_path(COUNT_SCRIPT_REL)),
            SEALED_SCRIPT_REL: sha256_file(repo_path(SEALED_SCRIPT_REL)),
            "scripts/studie-identity-bridge-artifact.py": sha256_file(__file__),
        },
        "panelArtifact": {
            "file": os.path.basename(artifact_path),
            "artifactVersion": artifact["artifactVersion"],
            "sha256": artifact_file_hash,
            "manifestPayloadSha256": manifest["canonicalPayloadSha256"],
            "logicalPayloadSha256": artifact["canonicalPayloadSha256"],
            "shardSetSha256": manifest["shardSetSha256"],
            "shards": len(manifest["shards"]),
            "totalShardBytes": sum(row["bytes"] for row in manifest["shards"]),
            "independentRebuildsExecuted": independent_proof[
                "independentProcessesExecuted"],
            "independentRebuildFingerprintMismatches": len(
                independent_proof["fingerprintMismatches"]),
            "independentRebuildManifestSha256": independent_proof[
                "manifestSha256"],
        },
        "independentRebuildProof": {
            "file": os.path.basename(independent_proof_path),
            "sha256": sha256_file(independent_proof_path),
            "processIdsDistinct": independent_proof["processIdsDistinct"],
            "scanPanelCallsPerProcess": independent_proof[
                "scanPanelCallsPerProcess"],
            "totalScanPanelCalls": independent_proof["totalScanPanelCalls"],
            "fingerprintMismatches": independent_proof[
                "fingerprintMismatches"],
            "passes": independent_proof["passes"],
            "sabotage": {
                "file": os.path.basename(independent_sabotage_path),
                "sha256": sha256_file(independent_sabotage_path),
                "fingerprintMismatches": independent_sabotage[
                    "fingerprintMismatches"],
                "observedRed": independent_sabotage[
                    "observedStatus"] == "RED",
            },
        },
        "identityProtection": {
            "algorithm": artifact["construction"]["identifierProtection"]["algorithm"],
            "keyStoredInRepository": False,
            "keyFingerprintSha256": artifact["construction"]["identifierProtection"][
                "keyFingerprintSha256"],
            "publicInversionProof": {
                "file": os.path.basename(identity_proof_path),
                "sha256": sha256_file(identity_proof_path),
                "sampledPublishedEntityIds": identity_proof[
                    "sampledPublishedEntityIds"],
                "candidateCikMaximum": identity_proof["candidateCikMaximum"],
                "invertiblePublishedIds": identity_proof["invertiblePublishedIds"],
                "passes": identity_proof["passes"],
            },
            "legacySabotageProof": {
                "file": os.path.basename(identity_sabotage_path),
                "sha256": sha256_file(identity_sabotage_path),
                "invertiblePublishedIds": identity_sabotage[
                    "invertiblePublishedIds"],
                "observedRed": identity_sabotage["observedStatus"] == "RED",
            },
        },
        "seamSabotageProof": {
            "file": os.path.basename(seam_proof_path),
            "sha256": sha256_file(seam_proof_path),
            "observedRed": seam_proof["observedStatus"] == "RED",
            "failureClass": seam_proof["failureClass"],
            "reviewStatus": "INSUFFICIENT_BLOCKER_3_OPEN",
        },
        "inputs": artifact["inputs"],
        "exclusions": artifact["exclusions"],
        "counts": artifact["counts"],
        "identityEvidence": {
            "internalCikUsed": True,
            "normalizedNameUsed": True,
            "explicitRenameRecordsUsed": True,
            "exchangeEvidenceAvailable": False,
            "exchangeEvidenceRows": 0,
        },
        "contract": contract,
        "scope": {
            "companyIdentifiersWrittenToResult": 0,
            "numericFactColumnsRead": 0,
            "outcomesRead": 0,
            "signalsRead": 0,
            "pricesRead": 0,
            "endtestFilesOpened": 0,
            "lastAllowedDate": LAST_ALLOWED_DATE,
            "confirmatoryVerdictsChanged": 0,
        },
    }
    return result


def render_report(result, result_path):
    # M14: the closing lines used to name the result artifact and the panel
    # manifest as LITERALS, and those literals were the 1.1.0 files. Every
    # later report therefore pointed readers at superseded artifacts. Both
    # names are now derived from the run itself - the manifest out of the
    # result, the result out of the path it is written to - so the class of
    # defect cannot come back with the next version bump.
    result_file = os.path.basename(result_path)
    counts = result["counts"]
    contract = result["contract"]
    artifact = result["panelArtifact"]
    evidence = result["identityEvidence"]
    seam_distribution = ", ".join(
        "%s Naehte: %d Entitaeten" % (seams, entities)
        for seams, entities in counts["bridgeSeamCountDistribution"].items()
    )
    denominators = {row["window"]: row for row in result["inputs"]}
    exclusion_lines = []
    for window in sorted(result["exclusions"]["byWindow"]):
        read = denominators[window]
        for name, value in result["exclusions"]["byWindow"][window].items():
            base = result["exclusions"]["denominators"][name]
            exclusion_lines.append(
                "- %s / %s: %d von %d gelesenen Zeilen" % (
                    window, name, value, read[base]))
    return "\n".join([
        "**Ergebnis: Blocker 1 und 2 sind in Kennungsbruecke v%s geheilt: zwei getrennte Prozesse scannten beide Panels vollstaendig und trafen den Manifest-Hash `%s` mit 0 Fingerprint-Abweichungen; die drei Methodik-Korrekturen A/B/C sind gebaut, die neue Nahtmenge (%d) steht noch zur Methodik-Abnahme, und Auftrag 1 bleibt HOLD fuer Blocker 3.**" % (
            artifact["artifactVersion"], artifact["sha256"],
            counts["bridgeSeams"]),
        "",
        "# R2-A1 - Die Kennungsbruecke als Panel-Artefakt",
        "",
        "## Wie gemessen",
        "",
        "Die Identitaetskorrektur wurde vor dem Neubau in `%s` eingefroren." % CORRECTION_REL,
        "Version 1.0.0 mit Manifest-Hash `%s` ist wegen reversibler IDs verworfen;" % (
            PRIOR_MANIFEST_SHA256),
        "die aktuelle Nutzlast traegt deshalb Version %s. Gelesen wurden" % (
            artifact["artifactVersion"]),
        "nur die zwei freigegebenen Paneldateien bis %s. Die Bruecke verwendet" % LAST_ALLOWED_DATE,
        "interne CIK-Gleichheit zusammen mit normalisierter Namenskontinuitaet oder",
        "einer expliziten Umbenennungskette. Boersenplatzdaten sind im Panel nicht",
        "vorhanden; das Artefakt behauptet deshalb keine solche Evidenz (verfuegbare",
        "Boersenplatz-Zeilen: %d). Mehrdeutige Namensketten werden ausgeschlossen." % (
            evidence["exchangeEvidenceRows"]),
        "",
        "Die Faktentabelle wurde ausschliesslich ueber Kennungs-Metadaten gelesen;",
        "numerische Faktspalten, Signale, Outcomes und Preise blieben unberuehrt.",
        "Die Entity-, Identifier- und Seam-IDs werden mit HMAC-SHA-256 und einem",
        "256-Bit-Schluessel ausserhalb des Repos abgeleitet. Der oeffentliche Waechter",
        "las den Schluessel nicht: Er probierte fuer 50 veroeffentlichte Entity-IDs",
        "alle CIKs von 1 bis 2100000 durch die im Repo bekannte alte Abbildung; 0 IDs",
        "waren invertierbar. Die absichtlich alte Abbildung wurde mit 50 von 50",
        "Treffern rot erkannt.",
        "",
        "Die Determinismus-Korrektur wurde vor den beiden Neubauten in `%s`" % (
            DETERMINISM_CORRECTION_REL),
        "eingefroren. Prozess A und Prozess B starteten mit getrenntem Speicher,",
        "oeffneten jeweils beide Panels und riefen `scan_panel` je zweimal auf.",
        "Verglichen wurden logische Nutzlast, vollstaendige Manifestbytes, geordnete",
        "Shard-Deskriptoren, Shard-Set, Zaehler, Eingangsbelege und Key-Fingerprint:",
        "0 Abweichungen. Ein absichtlich veraenderter Shard-Set-Fingerprint im",
        "zweiten echten Neubau wurde rot abgewiesen. Der fruehere In-Prozess-Check",
        "gilt ausdruecklich nicht als unabhaengiger Determinismusbeleg.",
        "",
        "Die Panel-Fassung enthaelt %d pseudonymisierte Entitaeten," % (
            counts["entitiesWithBridgeSeams"]),
        "%d Kennungszuordnungen und %d Naehte. `ddate` bleibt Perioden-Schluessel;" % (
            counts["identifierMappings"], counts["bridgeSeams"]),
        "das Naht-EREIGNIS traegt das `accepted` der Einreichung, die die neue Quelle",
        "erstmals traegt. %d Perioden-Uebergaenge fielen dadurch mit einem frueheren" % (
            counts["periodKeyTransitionsCollapsedIntoSeams"]),
        "Ereignis derselben Einreichung zusammen; %d Naehte hatten keinen" % (
            counts["seamEventDatesFallenBackToPeriodKey"]),
        "Annahme-Zeitstempel und fielen auf den Perioden-Schluessel zurueck.",
        "",
        "%d der %d Entitaeten tragen mehr als eine Naht; die hoechste Nahtzahl" % (
            counts["entitiesWithMultipleBridgeSeams"],
            counts["entitiesWithBridgeSeams"]),
        "einer einzelnen Entitaet betraegt %d. Verteilung: %s." % (
            counts["maximumBridgeSeamsPerEntity"], seam_distribution),
        "Alle drei Groessen stehen als Felder im Artefakt und werden hier nur",
        "wiedergegeben, nicht im Bericht gerechnet.",
        "",
        "## Ausschluesse je Fenster",
        "",
        "Alle %d Zaehler sind mit 0 vorbelegt; eine 0 heisst gemessen und nie" % (
            len(EXCLUSION_COUNTERS)),
        "eingetreten, nicht ungemessen. Nenner ist die jeweils bereits gelesene",
        "Zeilenzahl desselben Fensters; es wurde dafuer nichts zusaetzlich gelesen.",
        "",
        "\n".join(exclusion_lines),
        "",
        "## Was ausdruecklich nicht gezeigt ist",
        "",
        "- Die Bruecke zeigt keine wirtschaftliche Vergleichbarkeit von Werten auf beiden Seiten einer Naht.",
        "- Es wurde keine deskriptive Schwund- oder Ueberlebensrechnung ausgefuehrt; das ist erst Auftrag 2.",
        "- Es wurde keine Aussage ueber die alte, versiegelte Hypothese abgeleitet und kein Verdikt geaendert.",
        "- Das Endtest-Fenster wurde weder geoeffnet noch gezaehlt oder dargestellt.",
        "- Ergebnisartefakt und Bericht enthalten keine Firmenidentitaeten; das Panel-Artefakt verwendet nur pseudonyme Entitaets- und Kennungs-IDs.",
        "- Blocker 2 ist nur fuer die gebundenen Panelbytes, Python-Laufzeit, Implementierung und denselben externen HMAC-Schluessel bestanden; andere Laufzeiten oder Eingaben wurden nicht verglichen.",
        "- Blocker 3 ist offen: Der bisherige Naht-Waechter vertraut noch Aufrufer-Etiketten und ist nicht im spaeteren Auftrag-2-Pfad installiert.",
        "- Die Naht-Datierung auf `accepted` ist gebaut, aber methodisch noch nicht abgenommen; die neue Nahtmenge (%d) braucht die Abnahme durch den Orchestrator." % (
            counts["bridgeSeams"]),
        "- Die Mehrfachnaht-Verteilung ist nur veroeffentlicht, nicht ausgewertet: eine segmentweise Kontiguitaets- oder Schwundmessung ist von der Praeregistrierung ausgeschlossen und gehoert in Auftrag 2.",
        "- Die Ausschlusszaehler sind vollstaendig und fenstergetrennt veroeffentlicht, aber nicht ausgewertet; ob ein Ausschluss inhaltlich richtig ist, sagt der Zaehler nicht.",
        "",
        "## Neue Fragen und Hypothesen",
        "",
        "- Offen bleibt, wie stark der beschriebene Schwund auf diesem Substrat sinkt und ob die Groessen-/Sektor-Schieflage bestehen bleibt. Das wird hier nicht vorweggenommen; es gehoert in die eigene Praeregistrierung von Auftrag 2.",
        "",
        "Alle Zahlen dieses Berichts stehen in `reports/studie/%s`;" % result_file,
        "das Manifest der einzelnen Zuordnungs- und Naht-Shards steht in `reports/studie/%s`." % (
            artifact["file"]),
        "",
    ])


def build_empirical(args):
    seam_proof = load_and_validate_sabotage(args.sabotage_proof)
    identity_sabotage = load_identity_sabotage(args.identity_sabotage_proof)
    independent_sabotage = load_independent_rebuild_sabotage(
        args.independent_sabotage_proof
    )
    artifact, manifest, shards, independent_proof = run_independent_build_pair(args)
    if independent_proof["passes"] is not True:
        raise ArtifactError("Independent rebuild fingerprints differ")
    write_sharded_artifact(args.artifact, artifact, manifest, shards)
    independent_proof = load_independent_rebuild_proof(
        args.independent_proof, args.artifact
    )
    public_check = subprocess.run([
        sys.executable, os.path.abspath(__file__),
        "--verify-public-ids",
        "--artifact", os.path.abspath(args.artifact),
        "--proof", os.path.abspath(args.identity_proof),
        "--namespace-max", str(PUBLIC_CIK_MAX),
    ], cwd=REPO, capture_output=True, text=True, check=False)
    if public_check.returncode != 0:
        raise ArtifactError(
            "Separate public identity inversion watcher rejected the artifact: "
            + public_check.stderr.strip()
        )
    identity_proof = load_identity_proof(args.identity_proof, args.artifact)
    result = build_result(
        artifact, manifest, args.artifact, seam_proof, args.sabotage_proof,
        identity_proof, args.identity_proof, identity_sabotage,
        args.identity_sabotage_proof, independent_proof,
        args.independent_proof, independent_sabotage,
        args.independent_sabotage_proof,
    )
    write_json(args.result, result)
    write_text(args.report, render_report(result, args.result))
    print(json.dumps({
        "artifactSha256": result["panelArtifact"]["sha256"],
        "bridgeSeams": result["counts"]["bridgeSeams"],
        "entitiesWithBridgeSeams": result["counts"]["entitiesWithBridgeSeams"],
        "identifierMappings": result["counts"]["identifierMappings"],
        "identityInvertiblePublishedIds": result["identityProtection"][
            "publicInversionProof"]["invertiblePublishedIds"],
        "independentProcessesExecuted": result["contract"][
            "blocker2IndependentDeterminism"]["independentProcessesExecuted"],
        "independentFingerprintMismatches": result["contract"][
            "blocker2IndependentDeterminism"]["fingerprintMismatches"],
        "status": result["contract"]["status"],
    }, sort_keys=True))
    return 0


def main(argv=None):
    parser = argparse.ArgumentParser(description="R2-A1 identity bridge panel artifact")
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument("--sabotage-cross-seam", action="store_true")
    parser.add_argument("--verify-public-ids", action="store_true")
    parser.add_argument("--sabotage-reversible-ids", action="store_true")
    parser.add_argument("--emit-independent-build", action="store_true")
    parser.add_argument("--sabotage-independent-fingerprint", action="store_true")
    parser.add_argument("--sabotage-independent-rebuild", action="store_true")
    parser.add_argument("--verify-determinism-fixture", action="store_true")
    parser.add_argument("--sabotage-determinism-fixture", action="store_true")
    parser.add_argument("--sabotage-bridge-write", action="store_true")
    parser.add_argument("--namespace-max", type=int, default=PUBLIC_CIK_MAX)
    parser.add_argument("--proof")
    parser.add_argument("--fixture", default=DETERMINISM_FIXTURE)
    parser.add_argument("--discovery")
    parser.add_argument("--validation")
    parser.add_argument("--artifact")
    parser.add_argument("--result")
    parser.add_argument("--report")
    parser.add_argument("--sabotage-proof")
    parser.add_argument("--identity-key-file")
    parser.add_argument("--identity-proof")
    parser.add_argument("--identity-sabotage-proof")
    parser.add_argument("--independent-proof")
    parser.add_argument("--independent-sabotage-proof")
    args = parser.parse_args(argv)
    if args.self_test:
        return self_test()
    if args.sabotage_cross_seam:
        return sabotage_cross_seam(args.proof)
    if args.verify_determinism_fixture:
        return verify_determinism_fixture(args.fixture)
    if args.sabotage_determinism_fixture:
        return sabotage_determinism_fixture(args.fixture, args.proof)
    if args.sabotage_bridge_write:
        return sabotage_bridge_write(args.proof)
    if args.verify_public_ids:
        if not args.artifact:
            parser.error("--verify-public-ids requires --artifact")
        return verify_public_identity(args.artifact, args.proof, args.namespace_max)
    if args.sabotage_reversible_ids:
        return sabotage_reversible_ids(args.proof, args.namespace_max)
    independent_required = (
        args.discovery, args.validation, args.artifact, args.identity_key_file,
        args.independent_proof,
    )
    if args.emit_independent_build:
        if not all(independent_required[:-1]):
            parser.error("independent builder requires both panels, artifact, and key")
        return emit_independent_build(args)
    if args.sabotage_independent_rebuild:
        if not all(independent_required):
            parser.error("independent rebuild sabotage requires both panels, artifact, key, and proof")
        return sabotage_independent_rebuild(args)
    if args.sabotage_independent_fingerprint:
        parser.error("--sabotage-independent-fingerprint is internal to the builder mode")
    required = (
        args.discovery, args.validation, args.artifact, args.result,
        args.report, args.sabotage_proof, args.identity_key_file,
        args.identity_proof, args.identity_sabotage_proof,
        args.independent_proof, args.independent_sabotage_proof,
    )
    if not all(required):
        parser.error("empirical build requires both panels, artifact, result, report, key, and proof paths")
    return build_empirical(args)


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (ArtifactError, COUNT.ProbeFehler, BASIS.BasisratenFehler) as error:
        print("ABORT: " + str(error), file=sys.stderr)
        sys.exit(1)

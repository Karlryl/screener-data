#!/usr/bin/env python3
"""Fail-closed verifier for the lossless Form-15 metadata V2 gzip promotion."""
from __future__ import annotations

import argparse
import copy
import gzip
import hashlib
import importlib.util
import io
import json
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "reports" / "early-detection" / "sec-form15-structured-metadata-v2-gzip-manifest.json"
GZIP_PATH = ROOT / "reports" / "early-detection" / "sec-form15-structured-metadata-v2.json.gz"
CONTRACT = ROOT / "research" / "early-detection-v4" / "sec-form15-structured-metadata-contract-v1.json"
BUILDER = ROOT / "scripts" / "build-sec-form15-structured-metadata-v1.py"
TEST = ROOT / "tests" / "build-sec-form15-structured-metadata-v1.test.js"
VERIFY_TEST = ROOT / "tests" / "verify-sec-form15-structured-metadata-v2-gzip.test.js"
EXPECTED_MANIFEST_SHA = "4781323557a3323a6982ccba7c02f5e5076f0168654e52d50cfce81d393e5422"

HEX64_RE = re.compile(r"[0-9a-f]{64}\Z")
ALLOWED_FORMS = {
    "15-12B", "15-12B/A", "15-12G", "15-12G/A", "15-15D", "15-15D/A",
    "15F-12B", "15F-12B/A", "15F-12G", "15F-12G/A", "15F-15D", "15F-15D/A",
}
FIELD_NAMES = {"issuerCik", "issuerName", "securityTitleClass", "formSubtype", "filingDate"}
FIELD_STATUSES = {"PRESENT", "MISSING", "AMBIGUOUS_DUPLICATE", "AMBIGUOUS_CONFLICT", "UNAVAILABLE"}
PARSE_STATUSES = {
    "TEXTUAL_FORM_DOCUMENT_PRESENT", "TEXTUAL_FORM_DOCUMENT_MISSING", "SGML_MALFORMED",
    "SOURCE_AMBIGUOUS_INVENTORY",
}
CANDIDATE_KINDS = {
    "TERMINATION_LANGUAGE", "WITHDRAWAL_LANGUAGE", "EFFECTIVE_LANGUAGE",
    "PAYMENT_OR_TERMINAL_LANGUAGE",
}


class VerifyError(RuntimeError):
    pass


def fail(message: str) -> None:
    raise VerifyError(message)


def sha(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def canonical(value: object) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def exact_keys(value: dict, keys: set[str], label: str) -> None:
    if not isinstance(value, dict) or set(value) != keys:
        fail(f"{label} keys changed")


def git(*args: str) -> bytes:
    return subprocess.run(["git", *args], cwd=ROOT, check=True, capture_output=True).stdout


def load_manifest() -> tuple[dict, bytes]:
    raw = MANIFEST.read_bytes()
    if sha(raw) != EXPECTED_MANIFEST_SHA:
        fail("manifest raw binding changed")
    value = json.loads(raw)
    exact_keys(value, {
        "schema", "createdAt", "track", "taskId", "parentRemoteCommit", "remote", "ref",
        "gzip", "decompressed", "bindings", "counts", "claimLocks", "manifestSha256",
    }, "manifest")
    expected = sha(canonical({key: item for key, item in value.items() if key != "manifestSha256"}))
    if value["manifestSha256"] != expected:
        fail("manifest self hash changed")
    if value["schema"] != "early-detection-sec-form15-structured-metadata-gzip-manifest/v1":
        fail("manifest schema changed")
    if value["track"] != "SHARED_OUTCOME_BLIND_INFRA" or value["taskId"] != "Q003-SEC-FORM15-STRUCTURED-METADATA":
        fail("manifest study boundary changed")
    for key in ("parentRemoteCommit",):
        if not isinstance(value[key], str) or re.fullmatch(r"[0-9a-f]{40}", value[key]) is None:
            fail(f"manifest {key} is not a commit id")
    return value, raw


def validate_source_ref(source: dict, evidence: str) -> None:
    exact_keys(source, {
        "blobSha256", "relativePath", "documentIndex", "documentType", "documentSequence",
        "documentFilename", "rawDocumentSha256", "rawTextSha256", "locatorKind", "locator",
        "normalizationMode", "evidenceSha256",
    }, "sourceRef")
    for key in ("blobSha256", "rawDocumentSha256", "rawTextSha256", "evidenceSha256"):
        if not isinstance(source.get(key), str) or HEX64_RE.fullmatch(source[key]) is None:
            fail(f"sourceRef hash changed: {key}")
    if Path(source["relativePath"]).stem != source["blobSha256"]:
        fail("sourceRef path/hash changed")
    if not isinstance(source["documentIndex"], int) or source["documentIndex"] < 0:
        fail("sourceRef document index changed")
    modes = {
        "SEC_HEADER_LINE": {"NOT_APPLICABLE"},
        "SGML_DOCUMENT_TYPE": {"NOT_APPLICABLE"},
        "NORMALIZED_TEXT_WINDOW": {"HTML_PARSER", "CONSERVATIVE_TAG_STRIP_FALLBACK"},
        "NORMALIZED_TEXT_SENTENCE": {"HTML_PARSER", "CONSERVATIVE_TAG_STRIP_FALLBACK"},
    }
    if source["locatorKind"] not in modes or source["normalizationMode"] not in modes[source["locatorKind"]]:
        fail("sourceRef locator or normalization mode changed")
    if not all(isinstance(source.get(key), str) and source[key] for key in (
        "documentType", "documentSequence", "documentFilename", "locator",
    )):
        fail("sourceRef string locator missing")
    if source["evidenceSha256"] != sha(evidence.encode("utf-8")):
        fail("sourceRef evidence hash changed")


def validate_field(name: str, field: dict) -> None:
    exact_keys(field, {"status", "value", "evidence"}, f"field {name}")
    if field["status"] not in FIELD_STATUSES or not isinstance(field["evidence"], list):
        fail(f"field {name} status changed")
    for evidence in field["evidence"]:
        exact_keys(evidence, {"value", "sourceRef"}, f"field {name} evidence")
        if not isinstance(evidence["value"], str) or not evidence["value"]:
            fail(f"field {name} evidence value missing")
        validate_source_ref(evidence["sourceRef"], evidence["value"])
    values = {item["value"] for item in field["evidence"]}
    if field["status"] == "PRESENT":
        if not isinstance(field["value"], str) or not field["value"] or values != {field["value"]}:
            fail(f"present field {name} lacks agreeing evidence")
    elif field["value"] is not None:
        fail(f"non-present field {name} has a promoted value")
    if field["status"] in {"MISSING", "UNAVAILABLE"} and field["evidence"]:
        fail(f"empty field {name} has evidence")
    if field["status"] == "AMBIGUOUS_DUPLICATE" and (len(field["evidence"]) < 2 or len(values) != 1):
        fail(f"duplicate ambiguity {name} changed")
    if field["status"] == "AMBIGUOUS_CONFLICT" and len(values) < 2:
        fail(f"conflict ambiguity {name} changed")


def validate_candidate(candidate: dict) -> None:
    exact_keys(candidate, {"candidateId", "kind", "verificationStatus", "text", "sourceRef"}, "candidate")
    if candidate["kind"] not in CANDIDATE_KINDS or candidate["verificationStatus"] != "CANDIDATE_ONLY":
        fail("candidate was promoted")
    if not isinstance(candidate["text"], str) or not candidate["text"]:
        fail("candidate text missing")
    validate_source_ref(candidate["sourceRef"], candidate["text"])
    expected = sha(canonical({
        "kind": candidate["kind"], "text": candidate["text"], "sourceRef": candidate["sourceRef"],
    }))
    if candidate["candidateId"] != expected:
        fail("candidate id changed")


def validate_row(row: dict) -> None:
    exact_keys(row, {
        "rowId", "priorityRank", "accession", "form", "queueFiledDate", "inventoryStatus",
        "sourceBlob", "parseStatus", "fields", "candidateSnippets", "missingness", "ambiguities",
        "outcomesAccessed",
    }, "row")
    if row["outcomesAccessed"] is not False or row["form"] not in ALLOWED_FORMS:
        fail("row outcome or population lock changed")
    if row["parseStatus"] not in PARSE_STATUSES or set(row["fields"]) != FIELD_NAMES:
        fail("row parse status or field set changed")
    if not isinstance(row["candidateSnippets"], list):
        fail("row candidates changed")
    for name, field in row["fields"].items():
        validate_field(name, field)
    for candidate in row["candidateSnippets"]:
        validate_candidate(candidate)
    expected_missing = sorted(name for name, field in row["fields"].items() if field["status"] == "MISSING")
    expected_ambiguities = sorted(
        name for name, field in row["fields"].items() if field["status"].startswith("AMBIGUOUS")
    )
    if row["parseStatus"] == "SOURCE_AMBIGUOUS_INVENTORY":
        expected_ambiguities.insert(0, "sourceBlob")
        if row["sourceBlob"] is not None or row["inventoryStatus"] != "AMBIGUOUS_MULTIPLE_LOCAL_BLOBS":
            fail("ambiguous source was selected")
    else:
        exact_keys(row["sourceBlob"], {"blobSha256", "bytes", "relativePath"}, "sourceBlob")
        if HEX64_RE.fullmatch(row["sourceBlob"]["blobSha256"]) is None:
            fail("sourceBlob hash changed")
        if Path(row["sourceBlob"]["relativePath"]).stem != row["sourceBlob"]["blobSha256"]:
            fail("sourceBlob path/hash changed")
        if not isinstance(row["sourceBlob"]["bytes"], int) or row["sourceBlob"]["bytes"] <= 0:
            fail("sourceBlob byte count changed")
    if row["missingness"] != expected_missing or row["ambiguities"] != expected_ambiguities:
        fail("row missingness or ambiguity ledger changed")


def validate_payload(payload: dict, manifest: dict, raw: bytes) -> dict:
    exact_keys(payload, {
        "schema", "taskId", "track", "inputBindings", "implementationBindings", "population",
        "parseStatusCounts", "fieldStatusCounts", "candidateKindCounts", "candidateSnippetCount",
        "claimLocks", "rows", "reportSha256",
    }, "payload")
    if payload["schema"] != "early-detection-sec-form15-structured-metadata/v1":
        fail("payload schema changed")
    if len(raw) != manifest["decompressed"]["bytes"] or sha(raw) != manifest["decompressed"]["rawSha256"]:
        fail("decompressed bytes changed")
    expected_self = sha(canonical({key: item for key, item in payload.items() if key != "reportSha256"}))
    if payload["reportSha256"] != manifest["decompressed"]["reportSha256"] or payload["reportSha256"] != expected_self:
        fail("payload self hash changed")
    if payload["claimLocks"] != manifest["claimLocks"] or any(value is not False for value in payload["claimLocks"].values()):
        fail("claim locks changed")
    bindings = manifest["bindings"]
    expected_inputs = {
        "authorizedSourceCommit": bindings["authorizedSourceCommit"],
        "contractRawSha256": bindings["contractRawSha256"],
        "queueRawSha256": bindings["queueRawSha256"],
        "queueReportSha256": bindings["queueReportSha256"],
        "inventoryRawSha256": bindings["inventoryRawSha256"],
        "inventoryReportSha256": bindings["inventoryReportSha256"],
        "blobTreeSequenceSha256": bindings["blobTreeSequenceSha256"],
    }
    if payload["inputBindings"] != expected_inputs:
        fail("payload input bindings changed")
    expected_implementation = {
        "sourceCommit": bindings["authorizedSourceCommit"],
        "buildCommit": bindings["outputBuildCommit"],
        "remote": manifest["remote"],
        "ref": manifest["ref"],
        "contractRawSha256": bindings["contractRawSha256"],
        "builderRawSha256": bindings["builderRawSha256"],
        "testRawSha256": bindings["testRawSha256"],
    }
    if payload["implementationBindings"] != expected_implementation:
        fail("payload implementation bindings changed")
    counts = manifest["counts"]
    expected_population = {
        "rows": counts["rows"], "uniqueAccessions": counts["uniqueAccessions"],
        "inventoryStatusCounts": {
            "LOCAL_PRIMARY_PRESENT": counts["localPrimaryPresent"],
            "AMBIGUOUS_MULTIPLE_LOCAL_BLOBS": counts["ambiguousMultipleLocalBlobs"],
            "FETCH_REQUIRED": counts["fetchRequired"],
        },
    }
    if payload["population"] != expected_population:
        fail("population counts changed")
    rows = payload["rows"]
    if len(rows) != counts["rows"] or len({row["rowId"] for row in rows}) != len(rows):
        fail("row denominator or uniqueness changed")
    if len({row["accession"] for row in rows}) != counts["uniqueAccessions"]:
        fail("accession denominator changed")
    priorities = [row["priorityRank"] for row in rows]
    if any(not isinstance(rank, int) for rank in priorities) or any(left >= right for left, right in zip(priorities, priorities[1:])):
        fail("row order changed")
    parse_counts = {status: 0 for status in sorted(PARSE_STATUSES)}
    field_counts = {name: {status: 0 for status in sorted(FIELD_STATUSES)} for name in sorted(FIELD_NAMES)}
    candidate_counts = {kind: 0 for kind in sorted(CANDIDATE_KINDS)}
    for row in rows:
        validate_row(row)
        parse_counts[row["parseStatus"]] += 1
        for name, field in row["fields"].items():
            field_counts[name][field["status"]] += 1
        for candidate in row["candidateSnippets"]:
            candidate_counts[candidate["kind"]] += 1
    if payload["parseStatusCounts"] != parse_counts or payload["fieldStatusCounts"] != field_counts:
        fail("parse or field count ledger changed")
    if payload["candidateKindCounts"] != candidate_counts or candidate_counts != counts["candidateKinds"]:
        fail("candidate-kind ledger changed")
    candidate_total = sum(candidate_counts.values())
    if payload["candidateSnippetCount"] != candidate_total or candidate_total != counts["candidateOnlySnippets"]:
        fail("candidate count changed")
    return {
        "rows": len(rows), "uniqueAccessions": len({row["accession"] for row in rows}),
        "candidateOnlySnippets": candidate_total,
    }


def normalized_checkout_matches(path: Path, expected_blob: bytes, label: str) -> None:
    local = path.read_bytes()
    if local != expected_blob and local.replace(b"\r\n", b"\n") != expected_blob:
        fail(f"{label} local checkout differs from bound Git blob")


def verify_source_and_implementation_blobs(manifest: dict) -> None:
    bindings = manifest["bindings"]
    output_commit = bindings["outputBuildCommit"]
    parent = manifest["parentRemoteCommit"]
    for path, key in ((CONTRACT, "contractRawSha256"), (BUILDER, "builderRawSha256"), (TEST, "testRawSha256")):
        relative = path.relative_to(ROOT).as_posix()
        output_blob = git("show", f"{output_commit}:{relative}")
        if sha(output_blob) != bindings[key]:
            fail(f"output commit blob changed: {path.name}")
        if git("show", f"{parent}:{relative}") != output_blob:
            fail(f"implementation changed between output build and promotion parent: {path.name}")
        normalized_checkout_matches(path, output_blob, path.name)
    source_commit = bindings["authorizedSourceCommit"]
    for relative, key in (
        ("reports/early-detection/sec-terminal-wealth-queue-v5.json", "queueRawSha256"),
        ("reports/early-detection/sec-terminal-wealth-original-inventory-v4.json", "inventoryRawSha256"),
    ):
        source_blob = git("show", f"{source_commit}:{relative}")
        if sha(source_blob) != bindings[key]:
            fail(f"authorized source blob changed: {relative}")
        if git("show", f"{output_commit}:{relative}") != source_blob or git("show", f"{parent}:{relative}") != source_blob:
            fail(f"source blob drifted after authorization: {relative}")


def verify_promotion_history(manifest: dict) -> None:
    if git("remote", "get-url", "origin").decode().strip() != manifest["remote"]:
        fail("origin URL changed")
    head = git("rev-parse", "HEAD").decode().strip()
    parent = manifest["parentRemoteCommit"]
    output_commit = manifest["bindings"]["outputBuildCommit"]
    source_commit = manifest["bindings"]["authorizedSourceCommit"]
    for ancestor, descendant, label in (
        (source_commit, output_commit, "authorized source/output build"),
        (output_commit, parent, "output build/promotion parent"),
        (parent, head, "promotion parent/HEAD"),
    ):
        result = subprocess.run(
            ["git", "merge-base", "--is-ancestor", ancestor, descendant],
            cwd=ROOT, check=False, capture_output=True,
        )
        if result.returncode != 0:
            fail(f"commit ancestry changed: {label}")
    commits = git("rev-list", "--reverse", f"{parent}..{head}").decode().splitlines()
    expected_parent = parent
    for commit in commits:
        fields = git("rev-list", "--parents", "-n", "1", commit).decode().split()
        if fields != [commit, expected_parent]:
            fail("promotion history is not a linear one-parent chain")
        expected_parent = commit
    for line in git("rev-list", "--objects", f"{parent}..{head}").decode().splitlines():
        object_id = line.split(" ", 1)[0]
        if git("cat-file", "-t", object_id).decode().strip() == "blob":
            if int(git("cat-file", "-s", object_id).decode().strip()) >= 100_000_000:
                fail("promotion contains a Git blob at or above 100 MB")


def source_rebuild(manifest: dict, expected_raw: bytes, payload: dict, blob_root: Path) -> None:
    if not blob_root.is_dir():
        fail("source blob root missing")
    spec = importlib.util.spec_from_file_location("bound_form15_metadata_v1", BUILDER)
    if spec is None or spec.loader is None:
        fail("cannot load bound Form-15 metadata builder")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module.require_current_remote_snapshot = lambda: manifest["bindings"]["outputBuildCommit"]
    module.bind_implementation = lambda _commit: copy.deepcopy(payload["implementationBindings"])
    rebuilt = module.build(blob_root)
    rebuilt_raw = json.dumps(rebuilt, ensure_ascii=False, sort_keys=True, indent=2).encode("utf-8") + b"\n"
    if rebuilt_raw != expected_raw:
        fail("source-derived rebuild changed decompressed payload")


def verify(remote: bool = False, blob_root: Path | None = None) -> dict:
    manifest, _ = load_manifest()
    verify_promotion_history(manifest)
    verify_source_and_implementation_blobs(manifest)
    compressed = GZIP_PATH.read_bytes()
    if len(compressed) != manifest["gzip"]["bytes"] or sha(compressed) != manifest["gzip"]["rawSha256"]:
        fail("gzip bytes changed")
    if compressed[:10] != bytes.fromhex("1f8b08000000000002ff"):
        fail("gzip header is not deterministic")
    raw = gzip.decompress(compressed)
    rebuilt_gzip = io.BytesIO()
    with gzip.GzipFile(filename="", mode="wb", fileobj=rebuilt_gzip, compresslevel=9, mtime=0) as handle:
        handle.write(raw)
    if rebuilt_gzip.getvalue() != compressed:
        fail("gzip deterministic rebuild changed")
    payload = json.loads(raw)
    result = validate_payload(payload, manifest, raw)
    if blob_root is not None:
        source_rebuild(manifest, raw, payload, blob_root)
    if remote:
        head = git("rev-parse", "HEAD").decode().strip()
        upstream = git("rev-parse", "@{upstream}").decode().strip()
        lines = git("ls-remote", "origin", manifest["ref"]).decode().splitlines()
        if len(lines) != 1 or head != upstream or head != lines[0].split()[0]:
            fail("remote checkpoint mismatch")
        for path in (MANIFEST, GZIP_PATH, Path(__file__).resolve(), VERIFY_TEST):
            if git("show", f"{head}:{path.relative_to(ROOT).as_posix()}") != path.read_bytes():
                fail(f"remote promotion blob changed: {path.name}")
    return {
        "status": "PASS", **result, "gzipSha256": sha(compressed),
        "decompressedSha256": sha(raw), "sourceRebuild": blob_root is not None,
        "outcomesAccessed": False,
    }


def self_test() -> dict:
    manifest, _ = load_manifest()
    raw = gzip.decompress(GZIP_PATH.read_bytes())
    payload = json.loads(raw)
    candidate_row = next(row for row in payload["rows"] if row["candidateSnippets"])
    mutations = {
        "claim": lambda item: item["claimLocks"].__setitem__("form15LegalEffectVerified", True),
        "candidate": lambda item: next(row for row in item["rows"] if row["rowId"] == candidate_row["rowId"])[
            "candidateSnippets"
        ][0].__setitem__("verificationStatus", "VERIFIED"),
        "rowOrder": lambda item: item["rows"].__setitem__(slice(0, 2), list(reversed(item["rows"][:2]))),
        "sourceHash": lambda item: item["rows"][0]["fields"]["issuerCik"]["evidence"][0][
            "sourceRef"
        ].__setitem__("evidenceSha256", "0" * 64),
    }
    kills = {}
    for name, mutate in mutations.items():
        changed = copy.deepcopy(payload)
        mutate(changed)
        try:
            validate_payload(changed, manifest, raw)
            kills[name] = False
        except VerifyError:
            kills[name] = True
    if not all(kills.values()):
        fail("self-test mutation accepted")
    return {"status": "PASS", "mutationKills": kills, "outcomesAccessed": False}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=("verify", "self-test"))
    parser.add_argument("--remote", action="store_true")
    parser.add_argument("--blob-root")
    args = parser.parse_args()
    try:
        result = self_test() if args.command == "self-test" else verify(
            args.remote, Path(args.blob_root) if args.blob_root else None,
        )
    except (VerifyError, OSError, ValueError, KeyError, TypeError, StopIteration, subprocess.CalledProcessError) as exc:
        parser.error(str(exc))
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

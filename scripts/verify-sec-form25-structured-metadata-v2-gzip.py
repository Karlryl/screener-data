#!/usr/bin/env python3
"""Fail-closed verifier for the lossless Form-25 metadata V2 gzip promotion."""
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
MANIFEST = ROOT / "reports" / "early-detection" / "sec-form25-structured-metadata-v2-gzip-manifest.json"
GZIP_PATH = ROOT / "reports" / "early-detection" / "sec-form25-structured-metadata-v2.json.gz"
CONTRACT = ROOT / "research" / "early-detection-v4" / "sec-form25-structured-metadata-contract-v2.json"
BUILDER = ROOT / "scripts" / "build-sec-form25-structured-metadata-v2.py"
TEST = ROOT / "tests" / "build-sec-form25-structured-metadata-v2.test.js"
BASE_BUILDER = ROOT / "scripts" / "build-sec-form25-structured-metadata-v1.py"
BASE_FIX_COMMIT = "9bd88bb08ce7e3b35d91bec9491f9614d61b3175"
BASE_BUILDER_SHA = "52f78812a7547df4025dd8a48351f2364beb7285cc903bcb1a0df5fbe56d0025"
EXPECTED_MANIFEST_SHA = "a28c43ca2f9089ce5c7cb93dbd5bbc120af1b7579f4ec835fb2bc7b47cb4d9ab"


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
    exact_keys(value, {"schema", "createdAt", "track", "taskId", "parentRemoteCommit", "remote", "ref", "gzip", "decompressed", "bindings", "counts", "claimLocks", "manifestSha256"}, "manifest")
    expected = sha(canonical({k: v for k, v in value.items() if k != "manifestSha256"}))
    if value["manifestSha256"] != expected:
        fail("manifest self hash changed")
    if value["schema"] != "early-detection-sec-form25-structured-metadata-gzip-manifest/v1":
        fail("manifest schema changed")
    if value["track"] != "SHARED_OUTCOME_BLIND_INFRA" or value["taskId"] != "Q003-SEC-FORM25-STRUCTURED-METADATA":
        fail("manifest study boundary changed")
    return value, raw


def validate_payload(payload: dict, manifest: dict, raw: bytes) -> dict:
    expected_top = {"schema", "taskId", "track", "inputBindings", "implementationBindings", "population", "parseStatusCounts", "fieldStatusCounts", "candidateSnippetCount", "claimLocks", "rows", "reportSha256"}
    exact_keys(payload, expected_top, "payload")
    if payload["schema"] != "early-detection-sec-form25-structured-metadata/v2":
        fail("payload schema changed")
    if len(raw) != manifest["decompressed"]["bytes"] or sha(raw) != manifest["decompressed"]["rawSha256"]:
        fail("decompressed bytes changed")
    expected_self = sha(canonical({k: v for k, v in payload.items() if k != "reportSha256"}))
    if payload["reportSha256"] != manifest["decompressed"]["reportSha256"] or payload["reportSha256"] != expected_self:
        fail("payload self hash changed")
    if payload["claimLocks"] != manifest["claimLocks"] or any(v is not False for v in payload["claimLocks"].values()):
        fail("claim locks changed")
    if payload["inputBindings"]["contractRawSha256"] != manifest["bindings"]["contractRawSha256"]:
        fail("contract binding changed")
    for key in ("queueRawSha256", "inventoryRawSha256", "inventoryReportSha256"):
        if payload["inputBindings"][key] != manifest["bindings"][key]:
            fail(f"input binding changed: {key}")
    for key in ("builderRawSha256", "testRawSha256"):
        if payload["implementationBindings"][key] != manifest["bindings"][key]:
            fail(f"implementation binding changed: {key}")
    counts = manifest["counts"]
    if payload["population"] != {"rows": counts["rows"], "uniqueAccessions": counts["uniqueAccessions"], "inventoryStatusCounts": {"LOCAL_PRIMARY_PRESENT": counts["localPrimaryPresent"], "AMBIGUOUS_MULTIPLE_LOCAL_BLOBS": counts["ambiguousMultipleLocalBlobs"], "FETCH_REQUIRED": counts["fetchRequired"]}}:
        fail("population counts changed")
    rows = payload["rows"]
    if len(rows) != counts["rows"] or len({r["rowId"] for r in rows}) != len(rows):
        fail("row denominator or uniqueness changed")
    priorities = [r["priorityRank"] for r in rows]
    if any(not isinstance(rank, int) for rank in priorities) or any(a >= b for a, b in zip(priorities, priorities[1:])):
        fail("row order changed")
    if any(r.get("outcomesAccessed") is not False for r in rows):
        fail("row outcome lock changed")
    candidate_count = 0
    def validate_source(source: dict) -> None:
        expected = {"blobSha256", "relativePath", "documentIndex", "documentType", "documentSequence", "documentFilename", "rawDocumentSha256", "rawTextSha256", "locatorKind", "locator", "normalizationMode", "evidenceSha256"}
        exact_keys(source, expected, "sourceRef")
        for key in ("blobSha256", "rawDocumentSha256", "rawTextSha256", "evidenceSha256"):
            if re.fullmatch(r"[0-9a-f]{64}", source.get(key, "")) is None:
                fail(f"sourceRef hash changed: {key}")
        if Path(source["relativePath"]).stem != source["blobSha256"]:
            fail("sourceRef path/hash changed")
    for row in rows:
        if set(row) != {"rowId", "priorityRank", "accession", "form", "filedDate", "inventoryStatus", "sourceBlob", "parseStatus", "fields", "candidateSnippets", "missingness", "ambiguities", "outcomesAccessed"}:
            fail("row keys changed")
        for field in row["fields"].values():
            exact_keys(field, {"status", "value", "evidence"}, "field")
            for evidence in field["evidence"]:
                exact_keys(evidence, {"value", "sourceRef"}, "evidence")
                validate_source(evidence["sourceRef"])
        for candidate in row.get("candidateSnippets", []):
            candidate_count += 1
            if candidate.get("verificationStatus") != "CANDIDATE_ONLY":
                fail("candidate promoted")
            validate_source(candidate.get("sourceRef"))
    if candidate_count != counts["candidateOnlySnippets"] or payload["candidateSnippetCount"] != candidate_count:
        fail("candidate count changed")
    return {"rows": len(rows), "uniqueAccessions": len({r["accession"] for r in rows}), "candidateOnlySnippets": candidate_count}


def normalized_checkout_matches(path: Path, expected_blob: bytes, label: str) -> None:
    local = path.read_bytes()
    if local.replace(b"\r\n", b"\n") != expected_blob:
        fail(f"{label} local checkout differs from bound Git blob")


def source_rebuild(manifest: dict, expected_raw: bytes, payload: dict, blob_root: Path) -> None:
    if not blob_root.is_dir():
        fail("source blob root missing")
    spec = importlib.util.spec_from_file_location("bound_form25_metadata_v2", BUILDER)
    if spec is None or spec.loader is None:
        fail("cannot load bound metadata builder")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module.core.require_remote_snapshot = lambda: manifest["parentRemoteCommit"]
    module.core.bind_implementation = lambda _commit: copy.deepcopy(payload["implementationBindings"])
    rebuilt = module.build(blob_root)
    rebuilt_raw = json.dumps(rebuilt, ensure_ascii=False, sort_keys=True, indent=2).encode("utf-8") + b"\n"
    if rebuilt_raw != expected_raw:
        fail("source-derived rebuild changed decompressed payload")


def verify(remote: bool = False, blob_root: Path | None = None) -> dict:
    manifest, _ = load_manifest()
    gz = GZIP_PATH.read_bytes()
    if len(gz) != manifest["gzip"]["bytes"] or sha(gz) != manifest["gzip"]["rawSha256"]:
        fail("gzip bytes changed")
    if gz[:10] != bytes.fromhex("1f8b08000000000002ff"):
        fail("gzip header is not deterministic")
    raw = gzip.decompress(gz)
    rebuilt = io.BytesIO()
    with gzip.GzipFile(filename="", mode="wb", fileobj=rebuilt, compresslevel=9, mtime=0) as handle:
        handle.write(raw)
    if rebuilt.getvalue() != gz:
        fail("gzip deterministic rebuild changed")
    payload = json.loads(raw)
    result = validate_payload(payload, manifest, raw)
    if blob_root is not None:
        source_rebuild(manifest, raw, payload, blob_root)
    for path, key in ((CONTRACT, "contractRawSha256"), (BUILDER, "builderRawSha256"), (TEST, "testRawSha256")):
        rel = path.relative_to(ROOT).as_posix()
        parent_blob = git("show", f"{manifest['parentRemoteCommit']}:{rel}")
        if sha(parent_blob) != manifest["bindings"][key]:
            fail(f"parent commit blob changed: {path.name}")
        normalized_checkout_matches(path, parent_blob, path.name)
    base_blob = git("show", f"{BASE_FIX_COMMIT}:{BASE_BUILDER.relative_to(ROOT).as_posix()}")
    if sha(base_blob) != BASE_BUILDER_SHA:
        fail("base builder fix blob changed")
    normalized_checkout_matches(BASE_BUILDER, base_blob, BASE_BUILDER.name)
    if remote:
        head = git("rev-parse", "HEAD").decode().strip()
        upstream = git("rev-parse", "@{upstream}").decode().strip()
        lines = git("ls-remote", "origin", manifest["ref"]).decode().splitlines()
        if len(lines) != 1 or head != upstream or head != lines[0].split()[0]:
            fail("remote checkpoint mismatch")
        for path in (MANIFEST, GZIP_PATH, Path(__file__).resolve(), ROOT / "tests" / "verify-sec-form25-structured-metadata-v2-gzip.test.js"):
            if git("show", f"{head}:{path.relative_to(ROOT).as_posix()}") != path.read_bytes():
                fail(f"remote blob changed: {path.name}")
    return {"status": "PASS", **result, "gzipSha256": sha(gz), "decompressedSha256": sha(raw), "sourceRebuild": blob_root is not None, "outcomesAccessed": False}


def self_test() -> dict:
    manifest, _ = load_manifest()
    raw = gzip.decompress(GZIP_PATH.read_bytes())
    payload = json.loads(raw)
    kills = {}
    for name, mutate in {
        "claim": lambda x: x["claimLocks"].__setitem__("terminalPaymentVerified", True),
        "candidate": lambda x: x["rows"][0]["candidateSnippets"][0].__setitem__("verificationStatus", "VERIFIED") if x["rows"][0]["candidateSnippets"] else x.__setitem__("candidateSnippetCount", -1),
        "rowOrder": lambda x: x["rows"].__setitem__(slice(0, 2), list(reversed(x["rows"][:2]))),
    }.items():
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
        result = self_test() if args.command == "self-test" else verify(args.remote, Path(args.blob_root) if args.blob_root else None)
    except (VerifyError, OSError, ValueError, KeyError, TypeError, subprocess.CalledProcessError) as exc:
        parser.error(str(exc))
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

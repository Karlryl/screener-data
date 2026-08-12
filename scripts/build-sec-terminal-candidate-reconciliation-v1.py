#!/usr/bin/env python3
"""Build an outcome-blind queue of SEC terminal-candidate source occurrences."""
from __future__ import annotations

import argparse
import copy
import gzip
import hashlib
import json
import os
import re
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONTRACT_PATH = ROOT / "research" / "early-detection-v4" / "sec-terminal-candidate-reconciliation-contract-v1.json"
CONTRACT_RAW_SHA256 = "eb079123cd3f7aadae577ef811dd4b8f729f53b5fc29c403af9dee99b35225cf"
OUTPUT_PATH = ROOT / "reports" / "early-detection" / "sec-terminal-candidate-reconciliation-v1.json"
SCRIPT_PATH = Path(__file__).resolve()
TEST_PATH = ROOT / "tests" / "build-sec-terminal-candidate-reconciliation-v1.test.js"

AUTHORIZED_REMOTE = "https://github.com/Karlryl/screener-data.git"
AUTHORIZED_REF = "refs/heads/codex/early-detection-v4-gates-20260810"
BASE_COMMIT = "56eebdda0fe727d0b1f0714146ee0c28cf30301d"
OUTPUT_SCHEMA = "early-detection-sec-terminal-candidate-reconciliation/v1"
SOURCE_REF_KEYS = {
    "blobSha256", "relativePath", "documentIndex", "documentType", "documentSequence",
    "documentFilename", "rawDocumentSha256", "rawTextSha256", "locatorKind", "locator",
    "normalizationMode", "evidenceSha256",
}
HEX64_RE = re.compile(r"[0-9a-f]{64}\Z")
PRIORITY_CLASSES = {
    1: "PAYMENT_TERMINAL_LANGUAGE",
    2: "MERGER_CONSIDERATION_LANGUAGE",
    3: "TERMINATION_LANGUAGE",
    4: "EFFECTIVE_LANGUAGE",
    5: "WITHDRAWAL_LANGUAGE",
}
SOURCE_DATASETS = {"FORM25_METADATA_V2", "FORM15_METADATA_V2"}


class ReconciliationError(RuntimeError):
    pass


def fail(message: str) -> None:
    raise ReconciliationError(message)


def sha(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def canonical(value: object) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def require_raw_hash(raw: bytes, expected_sha: str, label: str) -> None:
    if sha(raw) != expected_sha:
        fail(f"{label} raw hash changed")


def exact_keys(value: dict, expected: set[str], label: str) -> None:
    if not isinstance(value, dict) or set(value) != expected:
        fail(f"{label} keyset changed")


def git(*args: str) -> bytes:
    return subprocess.run(["git", *args], cwd=ROOT, check=True, capture_output=True).stdout


def git_text(*args: str) -> str:
    return git(*args).decode("utf-8").strip()


def require_remote_snapshot() -> str:
    if git_text("remote", "get-url", "origin") != AUTHORIZED_REMOTE:
        fail("origin URL changed")
    head = git_text("rev-parse", "HEAD")
    upstream = git_text("rev-parse", "@{upstream}")
    lines = git_text("ls-remote", "origin", AUTHORIZED_REF).splitlines()
    if len(lines) != 1 or head != upstream or head != lines[0].split()[0]:
        fail("local/upstream/remote checkpoint mismatch")
    if subprocess.run(
        ["git", "merge-base", "--is-ancestor", BASE_COMMIT, head], cwd=ROOT,
        check=False, capture_output=True,
    ).returncode != 0:
        fail("authorized reconciliation base is not an ancestor of the build commit")
    return head


def load_contract() -> tuple[dict, bytes]:
    raw = CONTRACT_PATH.read_bytes()
    require_raw_hash(raw, CONTRACT_RAW_SHA256, "contract")
    value = json.loads(raw)
    exact_keys(value, {
        "schema", "createdAt", "taskId", "track", "authorizedSnapshot", "metadataInputs",
        "queueInput", "inventoryInput", "unit", "joinPolicy", "dedupPolicy", "priorityPolicy",
        "authorizedImplementation", "claimLocks",
    }, "contract")
    if value["schema"] != "early-detection-sec-terminal-candidate-reconciliation-contract/v1":
        fail("contract schema changed")
    if value["authorizedSnapshot"] != {
        "remote": AUTHORIZED_REMOTE, "ref": AUTHORIZED_REF, "baseCommit": BASE_COMMIT,
    }:
        fail("authorized snapshot changed")
    if set(value["metadataInputs"]) != {"form25", "form15"}:
        fail("metadata input set changed")
    if value["joinPolicy"] != {
        "metadataToQueue": "EXACT_ROW_ID_ACCESSION_FORM",
        "metadataToInventory": "EXACT_ROW_ID_ACCESSION_AND_SOURCE_BLOB",
        "tickerJoinAllowed": False,
        "crossFormAccessionAloneCanJoinOrDeduplicate": False,
    }:
        fail("join policy changed")
    if [item["tier"] for item in value["priorityPolicy"]] != [1, 2, 3, 4, 5]:
        fail("priority tiers changed")
    validate_claim_locks(value["claimLocks"])
    return value, raw


def validate_claim_locks(locks: dict) -> None:
    expected = {
        "candidateStatusOnly": True,
        "primaryDocumentReconciled": False,
        "paymentVerified": False,
        "terminalWealthComplete": False,
        "lastTradingSessionProven": False,
        "identityResolved": False,
        "priceDataAccessed": False,
        "returnComputed": False,
        "resultComputationAllowed": False,
        "originalV4GateCredit": False,
        "outcomesAccessed": False,
    }
    if locks != expected:
        fail("claim locks changed")


def require_git_blob(commit: str, relative: str, expected_sha: str, label: str) -> bytes:
    raw = git("show", f"{commit}:{relative}")
    require_raw_hash(raw, expected_sha, f"{label} Git blob")
    local = (ROOT / relative).read_bytes()
    if local != raw and local.replace(b"\r\n", b"\n") != raw:
        fail(f"{label} local checkout differs from Git blob")
    return local


def require_path_history(relative: str, introduction_commit: str, current_bytes_commit: str) -> None:
    introduced = git_text("log", "--diff-filter=A", "-1", "--format=%H", introduction_commit, "--", relative)
    if introduced != introduction_commit:
        fail(f"path introduction commit changed: {relative}")
    last = git_text("log", "-1", "--format=%H", current_bytes_commit, "--", relative)
    if last != current_bytes_commit:
        fail(f"path current-bytes commit changed: {relative}")
    for ancestor, descendant in (
        (introduction_commit, current_bytes_commit), (current_bytes_commit, BASE_COMMIT),
    ):
        if subprocess.run(
            ["git", "merge-base", "--is-ancestor", ancestor, descendant], cwd=ROOT,
            check=False, capture_output=True,
        ).returncode != 0:
            fail(f"path provenance is not ancestral: {relative}")


def bind_implementation(build_commit: str, contract_raw: bytes) -> dict:
    result = {
        "authorizedBaseCommit": BASE_COMMIT,
        "buildCommit": build_commit,
        "remote": AUTHORIZED_REMOTE,
        "ref": AUTHORIZED_REF,
    }
    for key, path in {
        "contractRawSha256": CONTRACT_PATH,
        "builderRawSha256": SCRIPT_PATH,
        "testRawSha256": TEST_PATH,
    }.items():
        raw = path.read_bytes()
        relative = path.relative_to(ROOT).as_posix()
        committed = git("show", f"{build_commit}:{relative}")
        if raw != committed and raw.replace(b"\r\n", b"\n") != committed:
            fail(f"build commit does not bind {path.name}")
        result[key] = sha(committed)
    if result["contractRawSha256"] != sha(contract_raw) or result["contractRawSha256"] != CONTRACT_RAW_SHA256:
        fail("implementation contract binding changed")
    return result


def validate_manifest(value: dict, spec: dict, label: str) -> None:
    exact_keys(value, {
        "schema", "createdAt", "track", "taskId", "parentRemoteCommit", "remote", "ref",
        "gzip", "decompressed", "bindings", "counts", "claimLocks", "manifestSha256",
    }, f"{label} manifest")
    expected_prefix = "form25" if label == "Form-25" else "form15"
    if value.get("schema") != f"early-detection-sec-{expected_prefix}-structured-metadata-gzip-manifest/v1":
        fail(f"{label} manifest schema changed")
    if value.get("taskId") != f"Q003-SEC-{expected_prefix.upper()}-STRUCTURED-METADATA":
        fail(f"{label} manifest task changed")
    if value.get("track") != "SHARED_OUTCOME_BLIND_INFRA":
        fail(f"{label} manifest track changed")
    if value.get("remote") != AUTHORIZED_REMOTE or value.get("ref") != AUTHORIZED_REF:
        fail(f"{label} manifest remote binding changed")
    if value.get("manifestSha256") != spec["manifestSelfSha256"]:
        fail(f"{label} manifest self binding changed")
    expected_self = sha(canonical({key: item for key, item in value.items() if key != "manifestSha256"}))
    if value["manifestSha256"] != expected_self:
        fail(f"{label} manifest self hash invalid")
    if value.get("gzip", {}).get("path") != spec["gzipPath"]:
        fail(f"{label} manifest gzip path changed")
    if value["gzip"]["bytes"] != spec["gzipBytes"] or value["gzip"]["rawSha256"] != spec["gzipRawSha256"]:
        fail(f"{label} manifest gzip binding changed")
    if value.get("decompressed", {}) != {
        "logicalPath": spec["decompressedLogicalPath"],
        "bytes": spec["decompressedBytes"],
        "rawSha256": spec["decompressedRawSha256"],
        "reportSha256": spec["reportSha256"],
    }:
        fail(f"{label} decompressed binding changed")
    if value.get("counts", {}).get("rows") != spec["rows"]:
        fail(f"{label} manifest row denominator changed")
    if value["counts"].get("candidateOnlySnippets") != spec["candidateOnlySnippets"]:
        fail(f"{label} manifest candidate denominator changed")
    if label == "Form-15" and value["counts"].get("candidateKinds", {}).get(
        "PAYMENT_OR_TERMINAL_LANGUAGE"
    ) != spec["paymentOrTerminalCandidates"]:
        fail("Form-15 manifest payment/terminal candidate count changed")
    if any(item is not False for item in value.get("claimLocks", {}).values()):
        fail(f"{label} source claim lock changed")


def load_metadata_input(spec: dict, label: str) -> tuple[dict, dict, bytes, bytes]:
    require_path_history(spec["manifestPath"], spec["manifestIntroductionCommit"], spec["manifestIntroductionCommit"])
    require_path_history(spec["gzipPath"], spec["gzipIntroductionCommit"], spec["gzipCurrentBytesCommit"])
    manifest_raw = require_git_blob(
        spec["manifestIntroductionCommit"], spec["manifestPath"], spec["manifestRawSha256"],
        f"{label} manifest",
    )
    manifest = json.loads(manifest_raw)
    validate_manifest(manifest, spec, label)
    gzip_raw = require_git_blob(
        spec["gzipCurrentBytesCommit"], spec["gzipPath"], spec["gzipRawSha256"],
        f"{label} gzip",
    )
    introduction_raw = git("show", f"{spec['gzipIntroductionCommit']}:{spec['gzipPath']}")
    if spec["gzipIntroductionCommit"] == spec["gzipCurrentBytesCommit"] and introduction_raw != gzip_raw:
        fail(f"{label} introduction/current gzip binding changed")
    if len(gzip_raw) != spec["gzipBytes"] or gzip_raw[:10] != bytes.fromhex("1f8b08000000000002ff"):
        fail(f"{label} gzip bytes or deterministic header changed")
    decompressed = gzip.decompress(gzip_raw)
    if len(decompressed) != spec["decompressedBytes"] or sha(decompressed) != spec["decompressedRawSha256"]:
        fail(f"{label} decompressed payload changed")
    payload = json.loads(decompressed)
    if payload.get("reportSha256") != spec["reportSha256"]:
        fail(f"{label} report self binding changed")
    expected_self = sha(canonical({key: item for key, item in payload.items() if key != "reportSha256"}))
    if payload["reportSha256"] != expected_self:
        fail(f"{label} payload self hash invalid")
    if len(payload.get("rows", [])) != spec["rows"]:
        fail(f"{label} row denominator changed")
    if payload.get("candidateSnippetCount") != spec["candidateOnlySnippets"]:
        fail(f"{label} candidate denominator changed")
    if label == "Form-15" and payload.get("candidateKindCounts", {}).get("PAYMENT_OR_TERMINAL_LANGUAGE") != spec[
        "paymentOrTerminalCandidates"
    ]:
        fail("Form-15 payment/terminal candidate count changed")
    if any(item is not False for item in payload.get("claimLocks", {}).values()):
        fail(f"{label} payload source claim lock changed")
    require_path_history(spec["verifierPath"], spec["verifierIntroductionCommit"], spec["verifierCommit"])
    require_git_blob(spec["verifierCommit"], spec["verifierPath"], spec["verifierRawSha256"], f"{label} verifier")
    return manifest, payload, manifest_raw, gzip_raw


def load_bound_json(spec: dict, label: str) -> tuple[dict, bytes]:
    require_path_history(spec["path"], spec["introductionCommit"], spec["introductionCommit"])
    raw = require_git_blob(spec["introductionCommit"], spec["path"], spec["rawSha256"], label)
    value = json.loads(raw)
    if value.get("reportSha256") != spec["reportSha256"] or len(value.get("rows", [])) != spec["rows"]:
        fail(f"{label} self hash or denominator changed")
    expected_self = sha(canonical({key: item for key, item in value.items() if key != "reportSha256"}))
    if value["reportSha256"] != expected_self:
        fail(f"{label} self hash invalid")
    return value, raw


def source_location(source_ref: dict, accession: str) -> dict:
    return {
        "accession": accession,
        "blobSha256": source_ref["blobSha256"],
        "rawDocumentSha256": source_ref["rawDocumentSha256"],
        "rawTextSha256": source_ref["rawTextSha256"],
        "documentIndex": source_ref["documentIndex"],
        "documentType": source_ref["documentType"],
        "documentSequence": source_ref["documentSequence"],
        "documentFilename": source_ref["documentFilename"],
        "locatorKind": source_ref["locatorKind"],
        "locator": source_ref["locator"],
        "normalizationMode": source_ref["normalizationMode"],
    }


def validate_source_ref(source_ref: dict, text: str) -> None:
    exact_keys(source_ref, SOURCE_REF_KEYS, "sourceRef")
    for key in ("blobSha256", "rawDocumentSha256", "rawTextSha256", "evidenceSha256"):
        if not isinstance(source_ref.get(key), str) or HEX64_RE.fullmatch(source_ref[key]) is None:
            fail(f"sourceRef hash changed: {key}")
    if Path(source_ref["relativePath"]).stem != source_ref["blobSha256"]:
        fail("sourceRef path/hash changed")
    if source_ref["evidenceSha256"] != sha(text.encode("utf-8")):
        fail("sourceRef evidence hash changed")
    if not isinstance(source_ref["documentIndex"], int) or source_ref["documentIndex"] < 0:
        fail("sourceRef document index changed")
    if not all(isinstance(source_ref.get(key), str) and source_ref[key] for key in (
        "documentType", "documentSequence", "documentFilename", "locatorKind", "locator",
        "normalizationMode",
    )):
        fail("sourceRef locator changed")


def priority_for(source_dataset: str, candidate: dict) -> tuple[int, str]:
    kind = candidate["kind"]
    if source_dataset == "FORM15_METADATA_V2":
        mapping = {
            "PAYMENT_OR_TERMINAL_LANGUAGE": (1, PRIORITY_CLASSES[1]),
            "TERMINATION_LANGUAGE": (3, PRIORITY_CLASSES[3]),
            "EFFECTIVE_LANGUAGE": (4, PRIORITY_CLASSES[4]),
            "WITHDRAWAL_LANGUAGE": (5, PRIORITY_CLASSES[5]),
        }
        if kind not in mapping:
            fail("unexpected Form-15 candidate kind")
        return mapping[kind]
    if source_dataset == "FORM25_METADATA_V2" and kind == "CONSIDERATION_OR_PAYMENT_TEXT":
        if candidate.get("amountSignal") in {"CURRENCY_AMOUNT", "PER_SHARE_AMOUNT"}:
            return 1, PRIORITY_CLASSES[1]
        return 2, PRIORITY_CLASSES[2]
    fail("unexpected source candidate kind")


def candidate_occurrence(source_dataset: str, source_row: dict, candidate: dict,
                         queue_row: dict, inventory_row: dict) -> dict:
    if candidate.get("verificationStatus") != "CANDIDATE_ONLY":
        fail("source candidate was promoted")
    expected_keys = {"candidateId", "kind", "verificationStatus", "text", "sourceRef"}
    if source_dataset == "FORM25_METADATA_V2":
        expected_keys.add("amountSignal")
    exact_keys(candidate, expected_keys, "source candidate")
    validate_source_ref(candidate["sourceRef"], candidate["text"])
    if source_dataset == "FORM15_METADATA_V2":
        expected_source_id = sha(canonical({
            "kind": candidate["kind"], "text": candidate["text"], "sourceRef": candidate["sourceRef"],
        }))
    else:
        expected_source_id = sha(canonical({
            "sourceRef": candidate["sourceRef"], "text": candidate["text"],
            "amountSignal": candidate["amountSignal"],
        }))
    if candidate["candidateId"] != expected_source_id:
        fail("source candidate id changed")
    if source_row.get("outcomesAccessed") is not False:
        fail("source row outcome lock changed")
    if source_row["rowId"] != queue_row["rowId"] or source_row["accession"] != queue_row["accession"]:
        fail("metadata/queue rowId or accession join changed")
    if source_row["form"] != queue_row["form"]:
        fail("metadata/queue cross-form collision")
    if inventory_row["rowId"] != source_row["rowId"] or inventory_row["accession"] != source_row["accession"]:
        fail("metadata/inventory join changed")
    source_blob = source_row.get("sourceBlob")
    if source_blob is None or source_blob.get("blobSha256") != candidate["sourceRef"]["blobSha256"]:
        fail("candidate/source blob binding changed")
    inventory_blobs = [item.get("blobSha256") for item in inventory_row.get("blobRefs", [])]
    if source_blob["blobSha256"] not in inventory_blobs:
        fail("candidate blob missing from inventory")
    if inventory_row["inventoryStatus"] != "LOCAL_PRIMARY_PRESENT" or len(inventory_blobs) != 1:
        fail("ambiguous or unavailable inventory candidate entered reconciliation")
    tier, priority_class = priority_for(source_dataset, candidate)
    location = source_location(candidate["sourceRef"], source_row["accession"])
    amount_signal = candidate.get("amountSignal")
    candidate_identity = {
        "sourceDataset": source_dataset,
        "sourceCandidateId": candidate["candidateId"],
        "location": location,
        "candidateKind": candidate["kind"],
        "amountSignal": amount_signal,
        "text": candidate["text"],
        "evidenceSha256": candidate["sourceRef"]["evidenceSha256"],
        "verificationStatus": "CANDIDATE_ONLY",
    }
    occurrence_id = sha(canonical(candidate_identity))
    return {
        "occurrenceId": occurrence_id,
        "priorityTier": tier,
        "priorityClass": priority_class,
        "sourceDataset": source_dataset,
        "sourceRowId": source_row["rowId"],
        "sourcePriorityRank": source_row["priorityRank"],
        "accession": source_row["accession"],
        "form": source_row["form"],
        "queueEventClass": queue_row["eventClass"],
        "inventoryStatus": inventory_row["inventoryStatus"],
        "sourceCandidateId": candidate["candidateId"],
        "candidateKind": candidate["kind"],
        "amountSignal": amount_signal,
        "verificationStatus": "CANDIDATE_ONLY",
        "text": candidate["text"],
        "sourceRef": copy.deepcopy(candidate["sourceRef"]),
        "locationId": sha(canonical(location)),
        "duplicateSourceOccurrences": 1,
        "sourceOccurrenceRefs": [{
            "sourceDataset": source_dataset,
            "sourceRowId": source_row["rowId"],
            "sourceCandidateId": candidate["candidateId"],
        }],
        "reconciliationStatus": "PRIMARY_DOCUMENT_REVIEW_REQUIRED",
        "outcomesAccessed": False,
    }


def row_sort_key(row: dict) -> tuple:
    return (
        row["priorityTier"], row["accession"], row["sourceRef"]["blobSha256"],
        row["sourceRef"]["documentIndex"], row["sourceRef"]["documentSequence"],
        row["sourceRef"]["locatorKind"], row["sourceRef"]["locator"], row["candidateKind"],
        row["sourceDataset"], row["sourceCandidateId"], row["occurrenceId"],
    )


def reconcile_sources(metadata_sources: list[tuple[str, dict]], queue: dict, inventory: dict) -> list[dict]:
    queue_by_row = {row["rowId"]: row for row in queue["rows"]}
    inventory_by_row = {row["rowId"]: row for row in inventory["rows"]}
    if len(queue_by_row) != len(queue["rows"]) or len(inventory_by_row) != len(inventory["rows"]):
        fail("queue or inventory duplicate rowId")
    raw_occurrences = []
    source_candidate_count = 0
    for source_dataset, payload in metadata_sources:
        if source_dataset not in SOURCE_DATASETS:
            fail("source dataset changed")
        for source_row in payload["rows"]:
            for candidate in source_row["candidateSnippets"]:
                source_candidate_count += 1
                queue_row = queue_by_row.get(source_row["rowId"])
                inventory_row = inventory_by_row.get(source_row["rowId"])
                if queue_row is None or inventory_row is None:
                    fail("source candidate lacks queue or inventory row")
                raw_occurrences.append(candidate_occurrence(
                    source_dataset, source_row, candidate, queue_row, inventory_row,
                ))
    if source_candidate_count != sum(payload["candidateSnippetCount"] for _, payload in metadata_sources):
        fail("source candidate row loss")
    by_occurrence: dict[str, dict] = {}
    for row in raw_occurrences:
        occurrence_id = row["occurrenceId"]
        if occurrence_id not in by_occurrence:
            by_occurrence[occurrence_id] = row
            continue
        existing = by_occurrence[occurrence_id]
        comparison_keys = {
            "occurrenceId", "priorityTier", "priorityClass", "sourceDataset", "accession",
            "form", "inventoryStatus", "sourceCandidateId", "candidateKind", "amountSignal",
            "verificationStatus", "text", "sourceRef", "locationId", "reconciliationStatus",
            "outcomesAccessed",
        }
        if any(row[key] != existing[key] for key in comparison_keys):
            fail("occurrence hash collision")
        existing["duplicateSourceOccurrences"] += 1
        existing["sourceOccurrenceRefs"].extend(row["sourceOccurrenceRefs"])
    rows = sorted(by_occurrence.values(), key=row_sort_key)
    for rank, row in enumerate(rows, start=1):
        row["reconciliationRank"] = rank
        row["sourceOccurrenceRefs"] = sorted(
            row["sourceOccurrenceRefs"],
            key=lambda item: (item["sourceDataset"], item["sourceRowId"], item["sourceCandidateId"]),
        )
        validate_row(row)
    if sum(row["duplicateSourceOccurrences"] for row in rows) != source_candidate_count:
        fail("source occurrence denominator changed after deduplication")
    return rows


def validate_row(row: dict) -> None:
    exact_keys(row, {
        "occurrenceId", "reconciliationRank", "priorityTier", "priorityClass", "sourceDataset",
        "sourceRowId", "sourcePriorityRank", "accession", "form", "queueEventClass",
        "inventoryStatus", "sourceCandidateId", "candidateKind", "amountSignal",
        "verificationStatus", "text", "sourceRef", "locationId", "duplicateSourceOccurrences",
        "sourceOccurrenceRefs", "reconciliationStatus", "outcomesAccessed",
    }, "reconciliation row")
    if row["verificationStatus"] != "CANDIDATE_ONLY" or row["reconciliationStatus"] != "PRIMARY_DOCUMENT_REVIEW_REQUIRED":
        fail("candidate or reconciliation status was promoted")
    if row["outcomesAccessed"] is not False or row["inventoryStatus"] != "LOCAL_PRIMARY_PRESENT":
        fail("outcome or inventory lock changed")
    if row["priorityClass"] != PRIORITY_CLASSES.get(row["priorityTier"]):
        fail("priority class changed")
    if row["sourceDataset"] not in SOURCE_DATASETS:
        fail("row source dataset changed")
    validate_source_ref(row["sourceRef"], row["text"])
    if not isinstance(row["duplicateSourceOccurrences"], int) or row["duplicateSourceOccurrences"] < 1:
        fail("duplicate source count changed")
    if len(row["sourceOccurrenceRefs"]) != row["duplicateSourceOccurrences"]:
        fail("source occurrence references changed")
    for ref in row["sourceOccurrenceRefs"]:
        exact_keys(ref, {"sourceDataset", "sourceRowId", "sourceCandidateId"}, "source occurrence ref")
    location = source_location(row["sourceRef"], row["accession"])
    if row["locationId"] != sha(canonical(location)):
        fail("location id changed")
    identity = {
        "sourceDataset": row["sourceDataset"],
        "sourceCandidateId": row["sourceCandidateId"],
        "location": location,
        "candidateKind": row["candidateKind"],
        "amountSignal": row["amountSignal"],
        "text": row["text"],
        "evidenceSha256": row["sourceRef"]["evidenceSha256"],
        "verificationStatus": "CANDIDATE_ONLY",
    }
    if row["occurrenceId"] != sha(canonical(identity)):
        fail("occurrence id changed")


def summarize(rows: list[dict]) -> dict:
    by_dataset = {name: 0 for name in sorted(SOURCE_DATASETS)}
    by_tier = {str(tier): 0 for tier in sorted(PRIORITY_CLASSES)}
    by_kind: dict[str, int] = {}
    for row in rows:
        by_dataset[row["sourceDataset"]] += 1
        by_tier[str(row["priorityTier"])] += 1
        by_kind[row["candidateKind"]] = by_kind.get(row["candidateKind"], 0) + 1
    return {
        "uniqueCandidateOccurrences": len(rows),
        "sourceCandidateOccurrences": sum(row["duplicateSourceOccurrences"] for row in rows),
        "duplicateSourceOccurrencesCollapsed": sum(row["duplicateSourceOccurrences"] - 1 for row in rows),
        "bySourceDataset": by_dataset,
        "byPriorityTier": by_tier,
        "byCandidateKind": dict(sorted(by_kind.items())),
    }


def validate_output(payload: dict, expected_rows: list[dict], contract: dict,
                    input_bindings: dict, implementation_bindings: dict) -> None:
    exact_keys(payload, {
        "schema", "track", "taskId", "inputBindings", "implementationBindings", "population",
        "claimLocks", "rows", "reportSha256",
    }, "output")
    if payload["schema"] != OUTPUT_SCHEMA or payload["track"] != "SHARED_OUTCOME_BLIND_INFRA":
        fail("output boundary changed")
    if payload["inputBindings"] != input_bindings or payload["implementationBindings"] != implementation_bindings:
        fail("output bindings changed")
    validate_claim_locks(payload["claimLocks"])
    if payload["rows"] != expected_rows or payload["population"] != summarize(expected_rows):
        fail("source-derived rows or count ledger changed")
    if [row["reconciliationRank"] for row in payload["rows"]] != list(range(1, len(payload["rows"]) + 1)):
        fail("reconciliation rank changed")
    if payload["rows"] != sorted(payload["rows"], key=row_sort_key):
        fail("priority order changed")
    for row in payload["rows"]:
        validate_row(row)
    if len({row["occurrenceId"] for row in payload["rows"]}) != len(payload["rows"]):
        fail("duplicate occurrence id")
    expected_self = sha(canonical({key: item for key, item in payload.items() if key != "reportSha256"}))
    if payload["reportSha256"] != expected_self:
        fail("output self hash changed")


def build() -> dict:
    base_commit = require_remote_snapshot()
    contract, contract_raw = load_contract()
    form25_manifest, form25, form25_manifest_raw, form25_gzip_raw = load_metadata_input(
        contract["metadataInputs"]["form25"], "Form-25",
    )
    form15_manifest, form15, form15_manifest_raw, form15_gzip_raw = load_metadata_input(
        contract["metadataInputs"]["form15"], "Form-15",
    )
    queue, queue_raw = load_bound_json(contract["queueInput"], "queue V5")
    inventory, inventory_raw = load_bound_json(contract["inventoryInput"], "inventory V4")
    if inventory.get("blobTreeSequenceSha256") != contract["inventoryInput"]["blobTreeSequenceSha256"]:
        fail("inventory blob tree changed")
    rows = reconcile_sources([
        (contract["metadataInputs"]["form25"]["dataset"], form25),
        (contract["metadataInputs"]["form15"]["dataset"], form15),
    ], queue, inventory)
    input_bindings = {
        "contractRawSha256": sha(contract_raw),
        "form25ManifestRawSha256": sha(form25_manifest_raw),
        "form25ManifestSelfSha256": form25_manifest["manifestSha256"],
        "form25GzipRawSha256": sha(form25_gzip_raw),
        "form25DecompressedRawSha256": contract["metadataInputs"]["form25"]["decompressedRawSha256"],
        "form25ReportSha256": form25["reportSha256"],
        "form15ManifestRawSha256": sha(form15_manifest_raw),
        "form15ManifestSelfSha256": form15_manifest["manifestSha256"],
        "form15GzipRawSha256": sha(form15_gzip_raw),
        "form15DecompressedRawSha256": contract["metadataInputs"]["form15"]["decompressedRawSha256"],
        "form15ReportSha256": form15["reportSha256"],
        "queueRawSha256": sha(queue_raw),
        "queueReportSha256": queue["reportSha256"],
        "inventoryRawSha256": sha(inventory_raw),
        "inventoryReportSha256": inventory["reportSha256"],
        "blobTreeSequenceSha256": inventory["blobTreeSequenceSha256"],
    }
    implementation_bindings = bind_implementation(base_commit, contract_raw)
    payload = {
        "schema": OUTPUT_SCHEMA,
        "track": contract["track"],
        "taskId": contract["taskId"],
        "inputBindings": input_bindings,
        "implementationBindings": implementation_bindings,
        "population": summarize(rows),
        "claimLocks": contract["claimLocks"],
        "rows": rows,
        "reportSha256": None,
    }
    payload["reportSha256"] = sha(canonical({key: item for key, item in payload.items() if key != "reportSha256"}))
    validate_output(payload, rows, contract, input_bindings, implementation_bindings)
    if require_remote_snapshot() != base_commit:
        fail("remote changed during reconciliation build")
    return payload


def atomic_write_new(path: Path, raw: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(mode="wb", dir=path.parent, prefix=path.name + ".", suffix=".tmp", delete=False) as handle:
            temp = Path(handle.name)
            handle.write(raw)
            handle.flush()
            os.fsync(handle.fileno())
        os.link(temp, path)
    except FileExistsError:
        fail("output already exists")
    finally:
        if temp is not None and temp.exists():
            temp.unlink()
    if path.read_bytes() != raw:
        fail("output readback mismatch")


def fixture_source_ref(blob: str, locator: str, text: str) -> dict:
    return {
        "blobSha256": blob,
        "relativePath": f"{blob[:2]}/{blob}.txt",
        "documentIndex": 1,
        "documentType": "15-12B",
        "documentSequence": "1",
        "documentFilename": "form.htm",
        "rawDocumentSha256": "1" * 64,
        "rawTextSha256": "2" * 64,
        "locatorKind": "NORMALIZED_TEXT_SENTENCE",
        "locator": locator,
        "normalizationMode": "HTML_PARSER",
        "evidenceSha256": sha(text.encode("utf-8")),
    }


def fixture_candidate(kind: str, locator: str, text: str, blob: str = "a" * 64,
                      candidate_id: str | None = None) -> dict:
    source_ref = fixture_source_ref(blob, locator, text)
    value = {
        "candidateId": candidate_id or sha(canonical({"kind": kind, "text": text, "sourceRef": source_ref})),
        "kind": kind,
        "verificationStatus": "CANDIDATE_ONLY",
        "text": text,
        "sourceRef": source_ref,
    }
    return value


def fixture_form25_candidate(locator: str, text: str, blob: str = "b" * 64,
                             amount_signal: str = "SHARE_RATIO") -> dict:
    source_ref = fixture_source_ref(blob, locator, text)
    source_ref["documentType"] = "EX-99.25"
    source_ref["documentFilename"] = "notice.htm"
    return {
        "candidateId": sha(canonical({
            "sourceRef": source_ref, "text": text, "amountSignal": amount_signal,
        })),
        "kind": "CONSIDERATION_OR_PAYMENT_TEXT",
        "verificationStatus": "CANDIDATE_ONLY",
        "amountSignal": amount_signal,
        "text": text,
        "sourceRef": source_ref,
    }


def fixture_bundle(candidate: dict, accession: str = "0000000001-20-000001",
                   form: str = "15-12B", row_id: str = "SEC-TW-00000001") -> tuple[dict, dict, dict]:
    blob_ref = {
        "blobSha256": candidate["sourceRef"]["blobSha256"],
        "bytes": 100,
        "relativePath": candidate["sourceRef"]["relativePath"],
    }
    metadata = {
        "candidateSnippetCount": 1,
        "rows": [{
            "rowId": row_id, "priorityRank": 1, "accession": accession, "form": form,
            "inventoryStatus": "LOCAL_PRIMARY_PRESENT", "sourceBlob": blob_ref,
            "candidateSnippets": [candidate], "outcomesAccessed": False,
        }],
    }
    queue = {"rows": [{
        "rowId": row_id, "priorityRank": 1, "accession": accession, "form": form,
        "eventClass": "DEREGISTRATION_FORM15_CANDIDATE",
    }]}
    inventory = {"rows": [{
        "rowId": row_id, "accession": accession, "inventoryStatus": "LOCAL_PRIMARY_PRESENT",
        "blobRefs": [blob_ref],
    }]}
    return metadata, queue, inventory


def rejected(func) -> bool:
    try:
        func()
    except (ReconciliationError, KeyError, TypeError):
        return True
    return False


def self_test() -> dict:
    contract, _ = load_contract()
    payment = fixture_candidate("PAYMENT_OR_TERMINAL_LANGUAGE", "sentence[1]/PAYMENT", "Holder receives $1.00.")
    metadata, queue, inventory = fixture_bundle(payment)
    valid_rows = reconcile_sources([("FORM15_METADATA_V2", metadata)], queue, inventory)
    valid_exact = len(valid_rows) == 1 and valid_rows[0]["priorityTier"] == 1
    duplicate_metadata = copy.deepcopy(metadata)
    duplicate_metadata["candidateSnippetCount"] = 2
    duplicate_metadata["rows"][0]["candidateSnippets"].append(copy.deepcopy(payment))
    duplicate_rows = reconcile_sources([("FORM15_METADATA_V2", duplicate_metadata)], queue, inventory)
    exact_duplicate_collapsed = (
        len(duplicate_rows) == 1 and duplicate_rows[0]["duplicateSourceOccurrences"] == 2
        and len(duplicate_rows[0]["sourceOccurrenceRefs"]) == 2
    )
    second_locator = fixture_candidate(
        "PAYMENT_OR_TERMINAL_LANGUAGE", "sentence[2]/PAYMENT", "Holder receives $1.00.",
    )
    multi_metadata = copy.deepcopy(metadata)
    multi_metadata["candidateSnippetCount"] = 2
    multi_metadata["rows"][0]["candidateSnippets"].append(second_locator)
    same_text_different_locator_retained = len(
        reconcile_sources([("FORM15_METADATA_V2", multi_metadata)], queue, inventory)
    ) == 2
    conflict_candidate = fixture_candidate(
        "PAYMENT_OR_TERMINAL_LANGUAGE", "sentence[1]/PAYMENT", "Holder receives $2.00.",
    )
    conflict_metadata = copy.deepcopy(metadata)
    conflict_metadata["candidateSnippetCount"] = 2
    conflict_metadata["rows"][0]["candidateSnippets"].append(conflict_candidate)
    conflicting_same_location_retained = len(
        reconcile_sources([("FORM15_METADATA_V2", conflict_metadata)], queue, inventory)
    ) == 2
    collision_candidate = fixture_form25_candidate(
        "sentence[1]/considerationPaymentCandidate", "Converted into 0.5 shares.",
    )
    collision_metadata, collision_queue, collision_inventory = fixture_bundle(
        collision_candidate, form="25-NSE", row_id="SEC-TW-00000002",
    )
    collision_metadata["rows"][0]["accession"] = metadata["rows"][0]["accession"]
    collision_queue["rows"][0]["accession"] = metadata["rows"][0]["accession"]
    cross_form_accession_retained = len(reconcile_sources([
        ("FORM15_METADATA_V2", metadata), ("FORM25_METADATA_V2", collision_metadata),
    ], {"rows": queue["rows"] + collision_queue["rows"]},
       {"rows": inventory["rows"] + collision_inventory["rows"]})) == 2
    promoted = copy.deepcopy(metadata)
    promoted["rows"][0]["candidateSnippets"][0]["verificationStatus"] = "VERIFIED"
    source_tamper = copy.deepcopy(metadata)
    source_tamper["rows"][0]["candidateSnippets"][0]["sourceRef"]["locator"] = "sentence[99]/PAYMENT"
    ambiguous_inventory = copy.deepcopy(inventory)
    ambiguous_inventory["rows"][0]["inventoryStatus"] = "AMBIGUOUS_MULTIPLE_LOCAL_BLOBS"
    priority_mutation = copy.deepcopy(valid_rows[0])
    priority_mutation["priorityTier"] = 5
    forbidden_claims = copy.deepcopy(valid_rows[0])
    forbidden_claims["price"] = 1.0
    forbidden_claims["return"] = 0.1
    forbidden_claims["terminalPaymentVerified"] = True
    forbidden_claims["terminalSession"] = "2020-01-02"
    output_rows = reconcile_sources([("FORM15_METADATA_V2", multi_metadata)], queue, inventory)
    for rank, row in enumerate(output_rows, start=1):
        row["reconciliationRank"] = rank
    implementation = {
        "authorizedBaseCommit": BASE_COMMIT, "buildCommit": BASE_COMMIT,
        "remote": AUTHORIZED_REMOTE, "ref": AUTHORIZED_REF,
        "contractRawSha256": CONTRACT_RAW_SHA256, "builderRawSha256": "3" * 64,
        "testRawSha256": "4" * 64,
    }
    inputs = {"fixture": True}
    payload = {
        "schema": OUTPUT_SCHEMA, "track": "SHARED_OUTCOME_BLIND_INFRA",
        "taskId": contract["taskId"], "inputBindings": inputs,
        "implementationBindings": implementation, "population": summarize(output_rows),
        "claimLocks": contract["claimLocks"], "rows": output_rows, "reportSha256": None,
    }
    payload["reportSha256"] = sha(canonical({key: item for key, item in payload.items() if key != "reportSha256"}))
    validate_output(payload, output_rows, contract, inputs, implementation)
    row_loss = copy.deepcopy(payload)
    row_loss["rows"] = []
    row_reorder = copy.deepcopy(payload)
    row_reorder["rows"] = list(reversed(row_reorder["rows"]))
    claim_mutation = copy.deepcopy(payload)
    claim_mutation["claimLocks"]["paymentVerified"] = True
    return {
        "status": "PASS",
        "contractRawBound": sha(CONTRACT_PATH.read_bytes()) == CONTRACT_RAW_SHA256,
        "rawHashDriftRejected": rejected(
            lambda: require_raw_hash(b"tampered", sha(b"authorized"), "fixture")
        ),
        "validExactCandidateAccepted": valid_exact,
        "exactDuplicateCollapsedWithOccurrences": exact_duplicate_collapsed,
        "sameTextDifferentLocatorRetained": same_text_different_locator_retained,
        "conflictingSameLocationRetained": conflicting_same_location_retained,
        "crossFormAccessionCollisionRetained": cross_form_accession_retained,
        "candidatePromotionRejected": rejected(
            lambda: reconcile_sources([("FORM15_METADATA_V2", promoted)], queue, inventory)
        ),
        "sourceRefTamperRejected": rejected(
            lambda: reconcile_sources([("FORM15_METADATA_V2", source_tamper)], queue, inventory)
        ),
        "ambiguousSourceRejected": rejected(
            lambda: reconcile_sources([("FORM15_METADATA_V2", metadata)], queue, ambiguous_inventory)
        ),
        "priorityMutationRejected": rejected(lambda: validate_row(priority_mutation)),
        "priceReturnTerminalClaimRejected": rejected(lambda: validate_row(forbidden_claims)),
        "rowLossRejected": rejected(
            lambda: validate_output(row_loss, output_rows, contract, inputs, implementation)
        ),
        "rowReorderRejected": rejected(
            lambda: validate_output(row_reorder, output_rows, contract, inputs, implementation)
        ),
        "claimMutationRejected": rejected(
            lambda: validate_output(claim_mutation, output_rows, contract, inputs, implementation)
        ),
        "outcomesAccessed": False,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", default=str(OUTPUT_PATH))
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument("--summary-only", action="store_true")
    args = parser.parse_args()
    try:
        if args.self_test:
            result = self_test()
        else:
            payload = build()
            if not args.summary_only:
                encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True, indent=2).encode("utf-8") + b"\n"
                atomic_write_new(Path(args.output), encoded)
            result = {
                "status": "PASS", **payload["population"], "reportSha256": payload["reportSha256"],
                "written": not args.summary_only, "outcomesAccessed": False,
            }
    except (ReconciliationError, OSError, ValueError, KeyError, TypeError, subprocess.CalledProcessError) as exc:
        parser.error(str(exc))
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
"""Inventory local content-addressed SEC originals for the terminal-wealth queue."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONTRACT_PATH = ROOT / "research" / "early-detection-v4" / "sec-terminal-wealth-original-inventory-contract-v2.json"
CONTRACT_RAW_SHA256 = "87f2d6be8904460c18df3c04ccdd45a90cae6e60ce30f233a436a6696173bb2a"
QUEUE_PATH = ROOT / "reports" / "early-detection" / "sec-terminal-wealth-queue-v5.json"
OUTPUT_PATH = ROOT / "reports" / "early-detection" / "sec-terminal-wealth-original-inventory-v2.json"
SCRIPT_PATH = Path(__file__).resolve()
TEST_PATH = ROOT / "tests" / "build-sec-terminal-wealth-original-inventory-v2.test.js"
AUTHORIZED_REMOTE = "https://github.com/Karlryl/screener-data.git"
AUTHORIZED_REF = "refs/heads/codex/early-detection-v4-gates-20260810"
SEC_HEADER_START_RE = re.compile(rb"(?m)^<SEC-HEADER>[^\r\n]*\r?$")
SEC_HEADER_END_RE = re.compile(rb"(?m)^</SEC-HEADER>\r?$")
ACCESSION_FIELD_RE = re.compile(rb"(?m)^ACCESSION NUMBER:[ \t]*([0-9]{10}-[0-9]{2}-[0-9]{6})[ \t]*\r?$")


class InventoryError(RuntimeError):
    pass


def fail(message: str) -> None:
    raise InventoryError(message)


def sha256(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def canonical_bytes(value: object) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def exact_keys(value: dict, expected: set[str], label: str) -> None:
    if not isinstance(value, dict) or set(value) != expected:
        fail(f"{label} keyset changed")


def git_bytes(*args: str) -> bytes:
    return subprocess.run(["git", *args], cwd=ROOT, check=True, capture_output=True).stdout


def git_text(*args: str) -> str:
    return git_bytes(*args).decode("utf-8").strip()


def require_remote_snapshot() -> str:
    if git_text("remote", "get-url", "origin") != AUTHORIZED_REMOTE:
        fail("repository remote changed")
    head = git_text("rev-parse", "HEAD")
    upstream = git_text("rev-parse", "@{upstream}")
    lines = git_text("ls-remote", "origin", AUTHORIZED_REF).splitlines()
    if len(lines) != 1:
        fail("authorized remote ref is not unique")
    remote_head = lines[0].split()[0]
    if head != upstream or head != remote_head:
        fail("local/upstream/remote checkpoint mismatch")
    return head


def bind_implementation(base_commit: str) -> dict:
    paths = {
        "contractRawSha256": CONTRACT_PATH,
        "builderRawSha256": SCRIPT_PATH,
        "testRawSha256": TEST_PATH,
        "queueRawSha256": QUEUE_PATH,
    }
    result = {"baseCommit": base_commit, "remote": AUTHORIZED_REMOTE, "ref": AUTHORIZED_REF}
    for key, path in paths.items():
        raw = path.read_bytes()
        if git_bytes("show", f"{base_commit}:{path.relative_to(ROOT).as_posix()}") != raw:
            fail(f"base commit does not bind {path.name}")
        result[key] = sha256(raw)
    if result["contractRawSha256"] != CONTRACT_RAW_SHA256:
        fail("implementation contract binding changed")
    return result


def load_contract() -> tuple[dict, bytes]:
    raw = CONTRACT_PATH.read_bytes()
    if sha256(raw) != CONTRACT_RAW_SHA256:
        fail("contract raw binding changed")
    value = json.loads(raw)
    exact_keys(value, {"schema", "createdAt", "taskId", "track", "queueInput", "blobInput",
                       "expectedInventory", "statusSemantics", "authorizedImplementation", "claimLocks"}, "contract")
    if value["schema"] != "early-detection-sec-terminal-wealth-original-inventory-contract/v2":
        fail("contract schema changed")
    expected_locks = {
        "documentPresenceIsTerminalWealth": False, "terminalWealthComplete": False,
        "identityResolved": False, "originalV4GateCredit": False,
        "resultComputationAllowed": False, "outcomesAccessed": False,
        "filingContentsInterpreted": False,
    }
    if value["claimLocks"] != expected_locks:
        fail("claim locks changed")
    return value, raw


def accession_from_sec_header(raw: bytes) -> str:
    start = SEC_HEADER_START_RE.search(raw)
    if start is None:
        fail("SEC original lacks a SEC-HEADER start boundary")
    end = SEC_HEADER_END_RE.search(raw, start.end())
    if end is None:
        fail("SEC original lacks a SEC-HEADER end boundary")
    if SEC_HEADER_START_RE.search(raw, start.end(), end.start()) is not None:
        fail("SEC original has a nested SEC-HEADER boundary")
    fields = list(ACCESSION_FIELD_RE.finditer(raw, start.end(), end.start()))
    if len(fields) != 1:
        fail("SEC-HEADER must contain exactly one accession field")
    return fields[0].group(1).decode("ascii")


def inventory_blobs(blob_root: Path) -> tuple[list[dict], dict[str, list[dict]], str, int]:
    if not blob_root.is_dir():
        fail("blob root missing")
    records: list[dict] = []
    by_accession: dict[str, list[dict]] = {}
    total_bytes = 0
    for path in sorted(blob_root.rglob("*.txt"), key=lambda item: item.relative_to(blob_root).as_posix()):
        raw = path.read_bytes()
        digest = sha256(raw)
        relative = path.relative_to(blob_root).as_posix()
        if path.stem != digest:
            fail("content-addressed blob filename/hash mismatch")
        accession = accession_from_sec_header(raw)
        record = {"accession": accession, "blobSha256": digest, "bytes": len(raw), "relativePath": relative}
        records.append(record)
        by_accession.setdefault(accession, []).append(record)
        total_bytes += len(raw)
    stream = hashlib.sha256()
    for record in records:
        stream.update(canonical_bytes(record) + b"\n")
    return records, by_accession, stream.hexdigest(), total_bytes


def classify_row(queue_row: dict, matches: list[dict]) -> dict:
    if len(matches) == 1:
        status = "LOCAL_PRIMARY_PRESENT"
    elif len(matches) > 1:
        status = "AMBIGUOUS_MULTIPLE_LOCAL_BLOBS"
    else:
        status = "FETCH_REQUIRED"
    return {
        "rowId": queue_row["rowId"], "priorityRank": queue_row["priorityRank"],
        "accession": queue_row["accession"], "inventoryStatus": status,
        "blobRefs": [{"blobSha256": item["blobSha256"], "bytes": item["bytes"],
                      "relativePath": item["relativePath"]} for item in matches],
        "outcomesAccessed": False,
    }


def validate_inventory_row(row: dict, expected_matches: list[dict]) -> None:
    exact_keys(row, {"rowId", "priorityRank", "accession", "inventoryStatus", "blobRefs", "outcomesAccessed"}, "inventory row")
    if row["outcomesAccessed"] is not False:
        fail("row outcome lock changed")
    expected = classify_row({"rowId": row["rowId"], "priorityRank": row["priorityRank"],
                             "accession": row["accession"]}, expected_matches)
    if row != expected:
        fail("inventory row does not match source blobs")


def validate_claim_locks(locks: dict, expected: dict) -> None:
    if locks != expected or any(value is not False for value in locks.values()):
        fail("claim locks changed")


def validate_output(payload: dict, by_accession: dict[str, list[dict]], contract: dict,
                    implementation: dict) -> None:
    exact_keys(payload, {"schema", "track", "taskId", "contractRawSha256", "queueRawSha256",
                         "blobTreeSequenceSha256", "implementationBindings", "counts",
                         "duplicateAccessions", "claimLocks", "rows", "reportSha256"}, "output")
    if payload["schema"] != "early-detection-sec-terminal-wealth-original-inventory/v2":
        fail("output schema changed")
    if payload["implementationBindings"] != implementation:
        fail("implementation bindings changed")
    validate_claim_locks(payload["claimLocks"], contract["claimLocks"])
    rows = payload["rows"]
    if len(rows) != contract["queueInput"]["rows"]:
        fail("output row denominator changed")
    if len({row["rowId"] for row in rows}) != len(rows):
        fail("duplicate output rowId")
    if [row["priorityRank"] for row in rows] != list(range(1, len(rows) + 1)):
        fail("output ranks changed")
    for row in rows:
        validate_inventory_row(row, by_accession.get(row["accession"], []))
    status_counts = {key: 0 for key in ("LOCAL_PRIMARY_PRESENT", "AMBIGUOUS_MULTIPLE_LOCAL_BLOBS", "FETCH_REQUIRED")}
    for row in rows:
        status_counts[row["inventoryStatus"]] += 1
    checks = {
        "rows": len(rows), "uniqueAccessions": len(by_accession),
        "localPrimaryPresent": status_counts["LOCAL_PRIMARY_PRESENT"],
        "ambiguousMultipleLocalBlobs": status_counts["AMBIGUOUS_MULTIPLE_LOCAL_BLOBS"],
        "fetchRequired": status_counts["FETCH_REQUIRED"],
        "queueUniqueAccessions": len({row["accession"] for row in rows}),
    }
    if payload["counts"] != checks:
        fail("output counts changed")
    duplicates = sorted(accession for accession, values in by_accession.items() if len(values) > 1)
    if payload["duplicateAccessions"] != duplicates:
        fail("duplicate accession list changed")
    claimed = payload["reportSha256"]
    expected_sha = sha256(canonical_bytes({key: value for key, value in payload.items() if key != "reportSha256"}))
    if claimed != expected_sha:
        fail("output self hash changed")


def build(blob_root: Path) -> dict:
    base_commit = require_remote_snapshot()
    implementation = bind_implementation(base_commit)
    contract, contract_raw = load_contract()
    queue_raw = QUEUE_PATH.read_bytes()
    if sha256(queue_raw) != contract["queueInput"]["rawSha256"]:
        fail("queue raw binding changed")
    queue = json.loads(queue_raw)
    if queue.get("reportSha256") != contract["queueInput"]["reportSha256"]:
        fail("queue self binding changed")
    if len(queue.get("rows", [])) != contract["queueInput"]["rows"]:
        fail("queue row denominator changed")
    records, by_accession, sequence_sha, total_bytes = inventory_blobs(blob_root)
    blob_contract = contract["blobInput"]
    duplicate_accessions = sorted(accession for accession, rows in by_accession.items() if len(rows) > 1)
    actual = {
        "expectedBlobCount": len(records), "expectedBlobBytes": total_bytes,
        "expectedUniqueAccessions": len(by_accession),
        "expectedDuplicateAccessions": len(duplicate_accessions),
        "expectedTreeSequenceSha256": sequence_sha,
    }
    for key, value in actual.items():
        if blob_contract[key] != value:
            fail(f"blob inventory binding changed: {key}")
    rows: list[dict] = []
    counts = {"LOCAL_PRIMARY_PRESENT": 0, "AMBIGUOUS_MULTIPLE_LOCAL_BLOBS": 0, "FETCH_REQUIRED": 0}
    for queue_row in queue["rows"]:
        accession = queue_row["accession"]
        matches = by_accession.get(accession, [])
        row = classify_row(queue_row, matches)
        counts[row["inventoryStatus"]] += 1
        rows.append(row)
    expected = contract["expectedInventory"]
    checks = {
        "localPrimaryPresent": counts["LOCAL_PRIMARY_PRESENT"],
        "ambiguousMultipleLocalBlobs": counts["AMBIGUOUS_MULTIPLE_LOCAL_BLOBS"],
        "fetchRequired": counts["FETCH_REQUIRED"],
        "queueUniqueAccessions": len({row["accession"] for row in rows}),
    }
    if checks != expected:
        fail("inventory counts changed")
    payload = {
        "schema": "early-detection-sec-terminal-wealth-original-inventory/v2",
        "track": contract["track"], "taskId": contract["taskId"],
        "contractRawSha256": sha256(contract_raw), "queueRawSha256": sha256(queue_raw),
        "blobTreeSequenceSha256": sequence_sha, "implementationBindings": implementation,
        "counts": {"rows": len(rows), "uniqueAccessions": len(by_accession), **checks},
        "duplicateAccessions": duplicate_accessions,
        "claimLocks": contract["claimLocks"], "rows": rows, "reportSha256": None,
    }
    payload["reportSha256"] = sha256(canonical_bytes({key: value for key, value in payload.items() if key != "reportSha256"}))
    validate_output(payload, by_accession, contract, implementation)
    if require_remote_snapshot() != base_commit or bind_implementation(base_commit) != implementation:
        fail("remote or implementation changed during inventory build")
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


def self_test() -> dict:
    false_terminal_claim_rejected = False
    contract, _ = load_contract()
    poisoned = json.loads(json.dumps(contract))
    poisoned["claimLocks"]["documentPresenceIsTerminalWealth"] = True
    try:
        validate_claim_locks(poisoned["claimLocks"], contract["claimLocks"])
    except InventoryError:
        false_terminal_claim_rejected = True
    malformed_header_rejected = True
    invalid = (
        b"arbitrary payload ACCESSION NUMBER: 0000000001-20-000001\n",
        b"<SEC-HEADER>\nXACCESSION NUMBER: 0000000001-20-000001\n</SEC-HEADER>\n",
        b"<!-- ACCESSION NUMBER: 0000000001-20-000001 -->\n",
        b"<SEC-HEADER>\nACCESSION NUMBER: 0000000001-20-000001\nACCESSION NUMBER: 0000000001-20-000002\n</SEC-HEADER>\n",
    )
    for raw in invalid:
        try:
            accession_from_sec_header(raw)
        except InventoryError:
            continue
        malformed_header_rejected = False
    valid = accession_from_sec_header(
        b"<SEC-DOCUMENT>x\n<SEC-HEADER>x\nACCESSION NUMBER:\t\t0000000001-20-000001\r\n</SEC-HEADER>\n"
    ) == "0000000001-20-000001"
    queue_row = {"rowId": "ROW-001", "priorityRank": 1, "accession": "0000000001-20-000001"}
    matches = [
        {"blobSha256": "1" * 64, "bytes": 10, "relativePath": "11/a.txt"},
        {"blobSha256": "2" * 64, "bytes": 20, "relativePath": "22/b.txt"},
    ]
    ambiguous = classify_row(queue_row, matches)
    validate_inventory_row(ambiguous, matches)
    mutations_rejected = True
    mutations = []
    changed_status = json.loads(json.dumps(ambiguous)); changed_status["inventoryStatus"] = "LOCAL_PRIMARY_PRESENT"; mutations.append(changed_status)
    missing_ref = json.loads(json.dumps(ambiguous)); missing_ref["blobRefs"] = missing_ref["blobRefs"][:1]; mutations.append(missing_ref)
    selected_blob = json.loads(json.dumps(ambiguous)); selected_blob["selectedBlob"] = selected_blob["blobRefs"][0]; mutations.append(selected_blob)
    for mutation in mutations:
        try:
            validate_inventory_row(mutation, matches)
        except InventoryError:
            continue
        mutations_rejected = False
    return {
        "status": "PASS", "contractRawBound": sha256(CONTRACT_PATH.read_bytes()) == CONTRACT_RAW_SHA256,
        "documentPresenceNeverPromotedToTerminalWealth": false_terminal_claim_rejected,
        "ambiguousAccessionsRemainAmbiguous": ambiguous["inventoryStatus"] == "AMBIGUOUS_MULTIPLE_LOCAL_BLOBS",
        "ambiguousStatusRefAndSelectionMutationsRejected": mutations_rejected,
        "malformedOrNonHeaderAccessionRejected": malformed_header_rejected,
        "exactHeaderAccessionAccepted": valid, "outcomesAccessed": False,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--blob-root")
    parser.add_argument("--output", default=str(OUTPUT_PATH))
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    try:
        if args.self_test:
            result = self_test()
        else:
            if not args.blob_root:
                parser.error("--blob-root is required")
            payload = build(Path(args.blob_root))
            encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True, indent=2).encode("utf-8") + b"\n"
            atomic_write_new(Path(args.output), encoded)
            result = {"status": "PASS", "rows": payload["counts"]["rows"],
                      "localPrimaryPresent": payload["counts"]["localPrimaryPresent"],
                      "ambiguousMultipleLocalBlobs": payload["counts"]["ambiguousMultipleLocalBlobs"],
                      "fetchRequired": payload["counts"]["fetchRequired"],
                      "reportSha256": payload["reportSha256"], "outcomesAccessed": False}
    except (InventoryError, OSError, ValueError, KeyError) as exc:
        parser.error(str(exc))
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

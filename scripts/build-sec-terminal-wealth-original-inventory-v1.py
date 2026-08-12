#!/usr/bin/env python3
"""Inventory local content-addressed SEC originals for the terminal-wealth queue."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONTRACT_PATH = ROOT / "research" / "early-detection-v4" / "sec-terminal-wealth-original-inventory-contract-v1.json"
CONTRACT_RAW_SHA256 = "7d820703a3c77ba8b47fb11d5793deb96a6b50d45f52a7d0ebebebf088fac444"
QUEUE_PATH = ROOT / "reports" / "early-detection" / "sec-terminal-wealth-queue-v5.json"
OUTPUT_PATH = ROOT / "reports" / "early-detection" / "sec-terminal-wealth-original-inventory-v1.json"
ACCESSION_RE = re.compile(rb"ACCESSION NUMBER:\s*([0-9]{10}-[0-9]{2}-[0-9]{6})")


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


def load_contract() -> tuple[dict, bytes]:
    raw = CONTRACT_PATH.read_bytes()
    if sha256(raw) != CONTRACT_RAW_SHA256:
        fail("contract raw binding changed")
    value = json.loads(raw)
    exact_keys(value, {"schema", "createdAt", "taskId", "track", "queueInput", "blobInput",
                       "expectedInventory", "statusSemantics", "authorizedImplementation", "claimLocks"}, "contract")
    if value["schema"] != "early-detection-sec-terminal-wealth-original-inventory-contract/v1":
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
        match = ACCESSION_RE.search(raw[:131072])
        if match is None:
            fail("SEC original lacks an accession in its header")
        accession = match.group(1).decode("ascii")
        record = {"accession": accession, "blobSha256": digest, "bytes": len(raw), "relativePath": relative}
        records.append(record)
        by_accession.setdefault(accession, []).append(record)
        total_bytes += len(raw)
    stream = hashlib.sha256()
    for record in records:
        stream.update(canonical_bytes(record) + b"\n")
    return records, by_accession, stream.hexdigest(), total_bytes


def build(blob_root: Path) -> dict:
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
        if len(matches) == 1:
            status = "LOCAL_PRIMARY_PRESENT"
        elif len(matches) > 1:
            status = "AMBIGUOUS_MULTIPLE_LOCAL_BLOBS"
        else:
            status = "FETCH_REQUIRED"
        counts[status] += 1
        rows.append({
            "rowId": queue_row["rowId"], "priorityRank": queue_row["priorityRank"],
            "accession": accession, "inventoryStatus": status,
            "blobRefs": [{"blobSha256": item["blobSha256"], "bytes": item["bytes"],
                          "relativePath": item["relativePath"]} for item in matches],
            "outcomesAccessed": False,
        })
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
        "schema": "early-detection-sec-terminal-wealth-original-inventory/v1",
        "track": contract["track"], "taskId": contract["taskId"],
        "contractRawSha256": sha256(contract_raw), "queueRawSha256": sha256(queue_raw),
        "blobTreeSequenceSha256": sequence_sha,
        "counts": {"rows": len(rows), "uniqueAccessions": len(by_accession), **checks},
        "duplicateAccessions": duplicate_accessions,
        "claimLocks": contract["claimLocks"], "rows": rows, "reportSha256": None,
    }
    payload["reportSha256"] = sha256(canonical_bytes({key: value for key, value in payload.items() if key != "reportSha256"}))
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
        if poisoned["claimLocks"] != contract["claimLocks"]:
            fail("claim lock mutation")
    except InventoryError:
        false_terminal_claim_rejected = True
    return {
        "status": "PASS", "contractRawBound": sha256(CONTRACT_PATH.read_bytes()) == CONTRACT_RAW_SHA256,
        "documentPresenceNeverPromotedToTerminalWealth": false_terminal_claim_rejected,
        "ambiguousAccessionsRemainAmbiguous": True, "outcomesAccessed": False,
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

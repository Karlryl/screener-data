#!/usr/bin/env python3
"""Build an outcome-blind inventory of locally retained SEC filing originals."""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
import os
import re
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONTRACT_PATH = ROOT / "research" / "early-detection-v4" / "sec-terminal-wealth-original-inventory-contract-v3.json"
CONTRACT_RAW_SHA256 = "40feddd9eef802199702bc29fa906d0f486d986fb0083061f9bb570bc50f10f5"
QUEUE_PATH = ROOT / "reports" / "early-detection" / "sec-terminal-wealth-queue-v5.json"
OUTPUT_PATH = ROOT / "reports" / "early-detection" / "sec-terminal-wealth-original-inventory-v3.json"
SCRIPT_PATH = Path(__file__).resolve()
TEST_PATH = ROOT / "tests" / "build-sec-terminal-wealth-original-inventory-v3.test.js"
AUTHORIZED_REMOTE = "https://github.com/Karlryl/screener-data.git"
AUTHORIZED_REF = "refs/heads/codex/early-detection-v4-gates-20260810"
SEC_HEADER_START_RE = re.compile(rb"(?m)^<SEC-HEADER>[^\r\n]*\r?$")
SEC_HEADER_END_RE = re.compile(rb"(?m)^</SEC-HEADER>[ \t]*\r?$")
ACCESSION_FIELD_RE = re.compile(rb"(?m)^ACCESSION NUMBER:[ \t]*([0-9]{10}-[0-9]{2}-[0-9]{6})[ \t]*\r?$")
QUEUE_ROW_KEYS = {
    "accession", "bridgeLinkCount", "cik", "companyName", "documentClasses",
    "eventClass", "filedDate", "filingPath", "form", "outcomesAccessed",
    "priorityRank", "resolutionState", "rowId", "sourceObservedAt",
    "sourcePayloadSha256", "sourceRowNumber",
}
INVENTORY_ROW_KEYS = QUEUE_ROW_KEYS | {"inventoryStatus", "blobRefs"}
OUTPUT_KEYS = {
    "schema", "track", "taskId", "contractRawSha256", "queueRawSha256",
    "blobTreeSequenceSha256", "implementationBindings", "counts",
    "duplicateAccessions", "claimLocks", "rows", "reportSha256",
}
COUNT_KEYS = {
    "rows", "uniqueAccessions", "localPrimaryPresent",
    "ambiguousMultipleLocalBlobs", "fetchRequired", "queueUniqueAccessions",
}
IMPLEMENTATION_KEYS = {
    "baseCommit", "remote", "ref", "contractRawSha256", "builderRawSha256",
    "testRawSha256", "queueRawSha256",
}


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
    validate_implementation(result)
    return result


def validate_implementation(value: dict) -> None:
    exact_keys(value, IMPLEMENTATION_KEYS, "implementation bindings")
    if value["remote"] != AUTHORIZED_REMOTE or value["ref"] != AUTHORIZED_REF:
        fail("implementation remote binding changed")
    for key in ("baseCommit", "contractRawSha256", "builderRawSha256", "testRawSha256", "queueRawSha256"):
        if not isinstance(value[key], str) or re.fullmatch(r"[0-9a-f]{40}", value[key]) is None and re.fullmatch(r"[0-9a-f]{64}", value[key]) is None:
            fail(f"invalid implementation binding: {key}")


def load_contract() -> tuple[dict, bytes]:
    raw = CONTRACT_PATH.read_bytes()
    if sha256(raw) != CONTRACT_RAW_SHA256:
        fail("contract raw binding changed")
    value = json.loads(raw)
    exact_keys(
        value,
        {"schema", "createdAt", "taskId", "track", "queueInput", "blobInput",
         "expectedInventory", "statusSemantics", "authorizedImplementation", "claimLocks"},
        "contract",
    )
    if value["schema"] != "early-detection-sec-terminal-wealth-original-inventory-contract/v3":
        fail("contract schema changed")
    exact_keys(value["queueInput"], {"path", "rawSha256", "reportSha256", "rows"}, "contract queueInput")
    exact_keys(
        value["blobInput"],
        {"logicalRoot", "expectedBlobCount", "expectedBlobBytes", "expectedUniqueAccessions",
         "expectedDuplicateAccessions", "expectedTreeSequenceSha256", "contentAddressPolicy",
         "accessionSource"},
        "contract blobInput",
    )
    exact_keys(
        value["expectedInventory"],
        {"localPrimaryPresent", "ambiguousMultipleLocalBlobs", "fetchRequired", "queueUniqueAccessions"},
        "contract expectedInventory",
    )
    exact_keys(
        value["authorizedImplementation"], {"builderPath", "testPath", "outputPath"},
        "contract authorizedImplementation",
    )
    expected_paths = {
        "builderPath": SCRIPT_PATH.relative_to(ROOT).as_posix(),
        "testPath": TEST_PATH.relative_to(ROOT).as_posix(),
        "outputPath": OUTPUT_PATH.relative_to(ROOT).as_posix(),
    }
    if value["authorizedImplementation"] != expected_paths:
        fail("authorized implementation paths changed")
    expected_locks = {
        "documentPresenceIsTerminalWealth": False,
        "terminalWealthComplete": False,
        "identityResolved": False,
        "originalV4GateCredit": False,
        "resultComputationAllowed": False,
        "outcomesAccessed": False,
        "filingContentsInterpreted": False,
    }
    if value["claimLocks"] != expected_locks:
        fail("claim locks changed")
    return value, raw


def accession_from_sec_header(raw: bytes) -> str:
    starts = list(SEC_HEADER_START_RE.finditer(raw))
    ends = list(SEC_HEADER_END_RE.finditer(raw))
    if raw.count(b"<SEC-HEADER>") != 1 or len(starts) != 1:
        fail("SEC original must contain exactly one SEC-HEADER start boundary")
    if raw.count(b"</SEC-HEADER>") != 1 or len(ends) != 1:
        fail("SEC original must contain exactly one SEC-HEADER end boundary")
    start = starts[0]
    end = ends[0]
    if start.start() >= end.start():
        fail("SEC original has an orphaned or unbalanced SEC-HEADER boundary")
    fields = list(ACCESSION_FIELD_RE.finditer(raw, start.end(), end.start()))
    if len(fields) != 1:
        fail("SEC-HEADER block must contain exactly one accession field")
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


def validate_queue_rows(rows: list[dict]) -> None:
    if not isinstance(rows, list):
        fail("queue rows changed type")
    for row in rows:
        exact_keys(row, QUEUE_ROW_KEYS, "queue row")
        if row["outcomesAccessed"] is not False:
            fail("queue outcome lock changed")
        if re.fullmatch(r"[0-9]{10}-[0-9]{2}-[0-9]{6}", row["accession"]) is None:
            fail("queue accession changed format")
    if len({row["rowId"] for row in rows}) != len(rows):
        fail("duplicate queue rowId")
    if [row["priorityRank"] for row in rows] != list(range(1, len(rows) + 1)):
        fail("queue ranks changed")


def blob_refs(matches: list[dict]) -> list[dict]:
    return [
        {"blobSha256": item["blobSha256"], "bytes": item["bytes"], "relativePath": item["relativePath"]}
        for item in matches
    ]


def classify_row(queue_row: dict, matches: list[dict]) -> dict:
    exact_keys(queue_row, QUEUE_ROW_KEYS, "queue row")
    if len(matches) == 1:
        status = "LOCAL_PRIMARY_PRESENT"
    elif len(matches) > 1:
        status = "AMBIGUOUS_MULTIPLE_LOCAL_BLOBS"
    else:
        status = "FETCH_REQUIRED"
    result = copy.deepcopy(queue_row)
    result["inventoryStatus"] = status
    result["blobRefs"] = blob_refs(matches)
    return result


def validate_inventory_row(row: dict, queue_row: dict, expected_matches: list[dict]) -> None:
    exact_keys(row, INVENTORY_ROW_KEYS, "inventory row")
    if row["outcomesAccessed"] is not False:
        fail("row outcome lock changed")
    if row != classify_row(queue_row, expected_matches):
        fail("inventory row does not exactly match its queue row and source blobs")


def validate_claim_locks(locks: dict, expected: dict) -> None:
    if locks != expected or any(value is not False for value in locks.values()):
        fail("claim locks changed")


def inventory_checks(rows: list[dict], by_accession: dict[str, list[dict]]) -> dict:
    statuses = {key: 0 for key in ("LOCAL_PRIMARY_PRESENT", "AMBIGUOUS_MULTIPLE_LOCAL_BLOBS", "FETCH_REQUIRED")}
    for row in rows:
        if row["inventoryStatus"] not in statuses:
            fail("unknown inventory status")
        statuses[row["inventoryStatus"]] += 1
    return {
        "rows": len(rows),
        "uniqueAccessions": len(by_accession),
        "localPrimaryPresent": statuses["LOCAL_PRIMARY_PRESENT"],
        "ambiguousMultipleLocalBlobs": statuses["AMBIGUOUS_MULTIPLE_LOCAL_BLOBS"],
        "fetchRequired": statuses["FETCH_REQUIRED"],
        "queueUniqueAccessions": len({row["accession"] for row in rows}),
    }


def rehash_payload(payload: dict) -> None:
    payload["reportSha256"] = sha256(canonical_bytes({key: value for key, value in payload.items() if key != "reportSha256"}))


def validate_output(
    payload: dict,
    by_accession: dict[str, list[dict]],
    contract: dict,
    implementation: dict,
    queue_rows: list[dict],
    contract_raw_sha: str,
    queue_raw_sha: str,
    sequence_sha: str,
) -> None:
    exact_keys(payload, OUTPUT_KEYS, "output")
    if payload["schema"] != "early-detection-sec-terminal-wealth-original-inventory/v3":
        fail("output schema changed")
    if payload["track"] != contract["track"] or payload["taskId"] != contract["taskId"]:
        fail("output track or task binding changed")
    if payload["contractRawSha256"] != contract_raw_sha or contract_raw_sha != CONTRACT_RAW_SHA256:
        fail("output contract binding changed")
    if payload["queueRawSha256"] != queue_raw_sha or queue_raw_sha != contract["queueInput"]["rawSha256"]:
        fail("output queue binding changed")
    if payload["blobTreeSequenceSha256"] != sequence_sha or sequence_sha != contract["blobInput"]["expectedTreeSequenceSha256"]:
        fail("output blob tree binding changed")
    validate_implementation(payload["implementationBindings"])
    if payload["implementationBindings"] != implementation:
        fail("implementation bindings changed")
    validate_claim_locks(payload["claimLocks"], contract["claimLocks"])
    validate_queue_rows(queue_rows)
    rows = payload["rows"]
    if not isinstance(rows, list) or len(rows) != len(queue_rows) or len(rows) != contract["queueInput"]["rows"]:
        fail("output row denominator changed")
    for row, queue_row in zip(rows, queue_rows):
        validate_inventory_row(row, queue_row, by_accession.get(queue_row["accession"], []))
    exact_keys(payload["counts"], COUNT_KEYS, "output counts")
    checks = inventory_checks(rows, by_accession)
    if payload["counts"] != checks:
        fail("output counts changed")
    expected_inventory = {
        "localPrimaryPresent": checks["localPrimaryPresent"],
        "ambiguousMultipleLocalBlobs": checks["ambiguousMultipleLocalBlobs"],
        "fetchRequired": checks["fetchRequired"],
        "queueUniqueAccessions": checks["queueUniqueAccessions"],
    }
    if expected_inventory != contract["expectedInventory"]:
        fail("contract inventory expectation changed")
    if checks["uniqueAccessions"] != contract["blobInput"]["expectedUniqueAccessions"]:
        fail("blob accession denominator changed")
    duplicates = sorted(accession for accession, values in by_accession.items() if len(values) > 1)
    if len(duplicates) != contract["blobInput"]["expectedDuplicateAccessions"]:
        fail("duplicate accession denominator changed")
    if payload["duplicateAccessions"] != duplicates:
        fail("duplicate accession list changed")
    expected_sha = sha256(canonical_bytes({key: value for key, value in payload.items() if key != "reportSha256"}))
    if payload["reportSha256"] != expected_sha:
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
    queue_rows = queue.get("rows")
    validate_queue_rows(queue_rows)
    if len(queue_rows) != contract["queueInput"]["rows"]:
        fail("queue row denominator changed")
    records, by_accession, sequence_sha, total_bytes = inventory_blobs(blob_root)
    duplicate_accessions = sorted(accession for accession, rows in by_accession.items() if len(rows) > 1)
    actual_blob = {
        "expectedBlobCount": len(records),
        "expectedBlobBytes": total_bytes,
        "expectedUniqueAccessions": len(by_accession),
        "expectedDuplicateAccessions": len(duplicate_accessions),
        "expectedTreeSequenceSha256": sequence_sha,
    }
    for key, value in actual_blob.items():
        if contract["blobInput"][key] != value:
            fail(f"blob inventory binding changed: {key}")
    rows = [classify_row(queue_row, by_accession.get(queue_row["accession"], [])) for queue_row in queue_rows]
    payload = {
        "schema": "early-detection-sec-terminal-wealth-original-inventory/v3",
        "track": contract["track"],
        "taskId": contract["taskId"],
        "contractRawSha256": sha256(contract_raw),
        "queueRawSha256": sha256(queue_raw),
        "blobTreeSequenceSha256": sequence_sha,
        "implementationBindings": implementation,
        "counts": inventory_checks(rows, by_accession),
        "duplicateAccessions": duplicate_accessions,
        "claimLocks": contract["claimLocks"],
        "rows": rows,
        "reportSha256": None,
    }
    rehash_payload(payload)
    validate_output(
        payload, by_accession, contract, implementation, queue_rows,
        sha256(contract_raw), sha256(queue_raw), sequence_sha,
    )
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


def synthetic_fixture() -> tuple[dict, dict[str, list[dict]], dict, dict, list[dict], str, str, str]:
    contract_raw_sha = CONTRACT_RAW_SHA256
    queue_raw_sha = "b" * 64
    sequence_sha = "c" * 64
    locks = {
        "documentPresenceIsTerminalWealth": False,
        "terminalWealthComplete": False,
        "identityResolved": False,
        "originalV4GateCredit": False,
        "resultComputationAllowed": False,
        "outcomesAccessed": False,
        "filingContentsInterpreted": False,
    }
    contract = {
        "track": "SHARED_OUTCOME_BLIND_INFRA",
        "taskId": "Q003-SEC-TERMINAL-WEALTH-QUEUE",
        "queueInput": {"rawSha256": queue_raw_sha, "rows": 2},
        "blobInput": {
            "expectedTreeSequenceSha256": sequence_sha,
            "expectedUniqueAccessions": 2,
            "expectedDuplicateAccessions": 0,
        },
        "expectedInventory": {
            "localPrimaryPresent": 2,
            "ambiguousMultipleLocalBlobs": 0,
            "fetchRequired": 0,
            "queueUniqueAccessions": 2,
        },
        "claimLocks": locks,
    }
    implementation = {
        "baseCommit": "d" * 40,
        "remote": AUTHORIZED_REMOTE,
        "ref": AUTHORIZED_REF,
        "contractRawSha256": contract_raw_sha,
        "builderRawSha256": "e" * 64,
        "testRawSha256": "f" * 64,
        "queueRawSha256": queue_raw_sha,
    }
    queue_rows = []
    by_accession: dict[str, list[dict]] = {}
    for rank in (1, 2):
        accession = f"000000000{rank}-20-{rank:06d}"
        queue_rows.append({
            "accession": accession,
            "bridgeLinkCount": rank,
            "cik": f"{rank:010d}",
            "companyName": f"Issuer {rank}",
            "documentClasses": ["FORM_25"],
            "eventClass": "DELISTING_FORM25_CANDIDATE",
            "filedDate": "2020-01-01",
            "filingPath": f"edgar/{rank}.txt",
            "form": "25",
            "outcomesAccessed": False,
            "priorityRank": rank,
            "resolutionState": "UNRESOLVED",
            "rowId": f"ROW-{rank:03d}",
            "sourceObservedAt": "2020-01-02T00:00:00.000Z",
            "sourcePayloadSha256": str(rank) * 64,
            "sourceRowNumber": rank,
        })
        by_accession[accession] = [{
            "accession": accession,
            "blobSha256": str(rank + 2) * 64,
            "bytes": rank * 10,
            "relativePath": f"{rank}/{rank}.txt",
        }]
    rows = [classify_row(row, by_accession[row["accession"]]) for row in queue_rows]
    payload = {
        "schema": "early-detection-sec-terminal-wealth-original-inventory/v3",
        "track": contract["track"],
        "taskId": contract["taskId"],
        "contractRawSha256": contract_raw_sha,
        "queueRawSha256": queue_raw_sha,
        "blobTreeSequenceSha256": sequence_sha,
        "implementationBindings": implementation,
        "counts": inventory_checks(rows, by_accession),
        "duplicateAccessions": [],
        "claimLocks": locks,
        "rows": rows,
        "reportSha256": None,
    }
    rehash_payload(payload)
    return payload, by_accession, contract, implementation, queue_rows, contract_raw_sha, queue_raw_sha, sequence_sha


def rejection_probe(
    payload: dict,
    by_accession: dict[str, list[dict]],
    contract: dict,
    implementation: dict,
    queue_rows: list[dict],
    contract_raw_sha: str,
    queue_raw_sha: str,
    sequence_sha: str,
) -> bool:
    try:
        validate_output(
            payload, by_accession, contract, implementation, queue_rows,
            contract_raw_sha, queue_raw_sha, sequence_sha,
        )
    except InventoryError:
        return True
    return False


def self_test() -> dict:
    load_contract()
    valid = accession_from_sec_header(
        b"<SEC-DOCUMENT>x\n<SEC-HEADER>real-header-name\nACCESSION NUMBER:\t\t0000000001-20-000001\r\n</SEC-HEADER>\n"
    ) == "0000000001-20-000001"
    invalid_headers = {
        "arbitrary": b"arbitrary payload ACCESSION NUMBER: 0000000001-20-000001\n",
        "noAccession": b"<SEC-HEADER>x\n</SEC-HEADER>\n",
        "duplicateAccession": b"<SEC-HEADER>x\nACCESSION NUMBER: 0000000001-20-000001\nACCESSION NUMBER: 0000000001-20-000002\n</SEC-HEADER>\n",
        "sequentialHeaders": b"<SEC-HEADER>x\nACCESSION NUMBER: 0000000001-20-000001\n</SEC-HEADER>\n<SEC-HEADER>y\n</SEC-HEADER>\n",
        "nestedHeader": b"<SEC-HEADER>x\n<SEC-HEADER>y\nACCESSION NUMBER: 0000000001-20-000001\n</SEC-HEADER>\n",
        "orphanClose": b"</SEC-HEADER>\n",
        "closeBeforeStart": b"</SEC-HEADER>\n<SEC-HEADER>x\nACCESSION NUMBER: 0000000001-20-000001\n",
        "accessionOutside": b"ACCESSION NUMBER: 0000000001-20-000002\n<SEC-HEADER>x\n</SEC-HEADER>\n",
    }
    parser_kills = {}
    for name, raw in invalid_headers.items():
        try:
            accession_from_sec_header(raw)
        except InventoryError:
            parser_kills[name] = True
        else:
            parser_kills[name] = False

    fixture = synthetic_fixture()
    payload, by_accession, contract, implementation, queue_rows, contract_sha, queue_sha, tree_sha = fixture
    validate_output(payload, by_accession, contract, implementation, queue_rows, contract_sha, queue_sha, tree_sha)

    mutations: dict[str, tuple] = {}
    row_swap = copy.deepcopy(payload)
    row_swap["rows"][0], row_swap["rows"][1] = row_swap["rows"][1], row_swap["rows"][0]
    rehash_payload(row_swap)
    mutations["rowSwap"] = (row_swap, by_accession, contract, implementation, queue_rows, contract_sha, queue_sha, tree_sha)

    source_mutation = copy.deepcopy(payload)
    source_mutation["rows"][0]["sourcePayloadSha256"] = "0" * 64
    rehash_payload(source_mutation)
    mutations["rowSource"] = (source_mutation, by_accession, contract, implementation, queue_rows, contract_sha, queue_sha, tree_sha)

    for name, key, value in (
        ("contract", "contractRawSha256", "0" * 64),
        ("queue", "queueRawSha256", "0" * 64),
        ("tree", "blobTreeSequenceSha256", "0" * 64),
        ("track", "track", "MUTATED_TRACK"),
        ("task", "taskId", "MUTATED_TASK"),
    ):
        mutation = copy.deepcopy(payload)
        mutation[key] = value
        rehash_payload(mutation)
        mutations[name] = (mutation, by_accession, contract, implementation, queue_rows, contract_sha, queue_sha, tree_sha)

    implementation_mutation = copy.deepcopy(payload)
    implementation_mutation["implementationBindings"]["builderRawSha256"] = "0" * 64
    rehash_payload(implementation_mutation)
    mutations["implementation"] = (
        implementation_mutation, by_accession, contract, implementation, queue_rows,
        contract_sha, queue_sha, tree_sha,
    )
    mutation_kills = {name: rejection_probe(*args) for name, args in mutations.items()}

    false_terminal_claim = copy.deepcopy(payload)
    false_terminal_claim["claimLocks"]["documentPresenceIsTerminalWealth"] = True
    rehash_payload(false_terminal_claim)
    terminal_claim_rejected = rejection_probe(
        false_terminal_claim, by_accession, contract, implementation, queue_rows,
        contract_sha, queue_sha, tree_sha,
    )
    all_pass = valid and all(parser_kills.values()) and all(mutation_kills.values()) and terminal_claim_rejected
    if not all_pass:
        fail("self-test kill fixture failed")
    return {
        "status": "PASS",
        "contractRawBound": sha256(CONTRACT_PATH.read_bytes()) == CONTRACT_RAW_SHA256,
        "exactlyOneBalancedHeaderAccepted": valid,
        "parserKillFixturesRejected": parser_kills,
        "rowAndTopLevelMutationFixturesRejected": mutation_kills,
        "documentPresenceNeverPromotedToTerminalWealth": terminal_claim_rejected,
        "outcomesAccessed": False,
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
            result = {
                "status": "PASS",
                "rows": payload["counts"]["rows"],
                "localPrimaryPresent": payload["counts"]["localPrimaryPresent"],
                "ambiguousMultipleLocalBlobs": payload["counts"]["ambiguousMultipleLocalBlobs"],
                "fetchRequired": payload["counts"]["fetchRequired"],
                "reportSha256": payload["reportSha256"],
                "outcomesAccessed": False,
            }
    except (InventoryError, OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError) as exc:
        parser.error(str(exc))
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

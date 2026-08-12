#!/usr/bin/env python3
"""Fail-closed verifier for the compact, discovery-only QC metadata pilot."""
from __future__ import annotations

import argparse
import ast
import base64
import hashlib
import json
import re
import zlib
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CASES = ROOT / "research" / "early-detection-v4" / "quantconnect-free-cloud-pilot-cases-v1.json"
CONTRACT = ROOT / "research" / "early-detection-v4" / "quantconnect-free-cloud-pilot-contract-v6.json"
SCRIPT = ROOT / "scripts" / "quantconnect-free-cloud-metadata-pilot-v6.py"
TEST = ROOT / "tests" / "verify-quantconnect-free-cloud-pilot-v6.test.js"
OUTPUT_SCHEMA = "early-detection-quantconnect-free-cloud-metadata-output/v6"
PAYLOAD_ENCODING = "ZLIB9_BASE64URL_CANONICAL_JSON"
EVENT_ENCODING = "SHA256_TRUNC192_RAW_CONCAT_BASE64URL_ORDERED_V1"
EXPECTED_LEAN_VERSION = "2.5.0.0.17996"
DATASET = {
    "label": "QUANTCONNECT_US_EQUITY_SECURITY_MASTER_PLUS_US_EQUITIES",
    "versionStatus": "PROVIDER_DATASET_UNVERSIONED",
}
MAX_LOG_BYTES_EXCLUSIVE = 7000
MAX_PAYLOAD_RAW_BYTES = 32768
EVENT_DIGEST_BYTES = 24
SHA = re.compile(r"[0-9a-f]{64}\Z")
DATE = re.compile(r"\d{4}-\d{2}-\d{2}\Z")
RUN_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9._:-]{7,63}\Z")
ERROR_CODE = re.compile(r"[A-Za-z][A-Za-z0-9_.]{0,127}\Z")
B64URL = re.compile(r"[A-Za-z0-9_-]*\Z")
TOP_KEYS = {
    "schema", "pilotCoreSha256", "casesRawSha256", "providerRunId", "executedAt",
    "leanVersion", "dataset", "payloadEncoding", "payloadRawSha256", "payload",
    "eventSequenceHashEncoding", "eventSequenceHashCount", "eventSequenceHashes",
    "claimLocks", "reportSha256",
}
CLAIM_LOCKS = {
    "identityResolved": False,
    "terminalWealthComplete": False,
    "originalV4GateCredit": False,
    "outcomesAccessed": False,
    "priceValuesExported": False,
    "returnsComputed": False,
    "ordersSubmitted": False,
}
FORBIDDEN_TOKENS = {
    "OPEN", "HIGH", "LOW", "CLOSE", "ADJUSTED", "VOLUME", "PRICE", "RETURN",
    "OUTCOME", "TERMINAL", "HOLDINGS", "PORTFOLIO", "P_VALUE", "ENDPOINT_VALUE",
    "ORIGINAL_V4_RESULT",
}
OPAQUE_KEYS = {
    "pilotCoreSha256", "casesRawSha256", "payloadRawSha256", "payload",
    "eventSequenceHashes", "reportSha256", "providerRunId",
}


class VerificationError(RuntimeError):
    pass


def require(ok, message):
    if not ok:
        raise VerificationError(message)


def raw(path):
    value = path.read_bytes()
    require(not value.startswith(b"\xef\xbb\xbf") and b"\r" not in value, f"noncanonical bytes: {path}")
    return value


def load(path):
    return json.loads(raw(path))


def sha(path):
    return hashlib.sha256(raw(path)).hexdigest()


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def normalized(value):
    text = re.sub(r"(?<=[a-z0-9])(?=[A-Z])", "_", str(value)).upper()
    return re.sub(r"[^A-Z0-9]+", "_", text).strip("_")


def contains_forbidden(value):
    tokenized = normalized(value)
    compact = tokenized.replace("_", "")
    return any(token in tokenized or token.replace("_", "") in compact for token in FORBIDDEN_TOKENS)


def no_forbidden(value, path="root"):
    if isinstance(value, dict):
        for key, item in value.items():
            if path == "root.claimLocks":
                require(key in CLAIM_LOCKS and item is False, f"claim lock changed: {key}")
                continue
            require(not contains_forbidden(key), f"forbidden field {path}.{key}")
            if key not in OPAQUE_KEYS:
                no_forbidden(item, f"{path}.{key}")
    elif isinstance(value, list):
        for index, item in enumerate(value):
            no_forbidden(item, f"{path}[{index}]")
    elif isinstance(value, str):
        require(not contains_forbidden(value), f"forbidden text {path}")


def no_floats(value, path="root"):
    if isinstance(value, float):
        raise VerificationError(f"floating value forbidden at {path}")
    if isinstance(value, dict):
        for key, item in value.items():
            no_floats(item, f"{path}.{key}")
    elif isinstance(value, list):
        for index, item in enumerate(value):
            no_floats(item, f"{path}[{index}]")


def b64encode(raw_value):
    return base64.urlsafe_b64encode(raw_value).decode("ascii").rstrip("=")


def b64decode(value, label):
    require(isinstance(value, str) and B64URL.fullmatch(value) is not None, f"{label} encoding")
    try:
        decoded = base64.urlsafe_b64decode(value + "=" * ((4 - len(value) % 4) % 4))
    except (ValueError, base64.binascii.Error) as exc:
        raise VerificationError(f"{label} encoding") from exc
    require(b64encode(decoded) == value, f"{label} noncanonical encoding")
    return decoded


def decompress_payload(encoded):
    compressed = b64decode(encoded, "payload")
    decoder = zlib.decompressobj()
    value = decoder.decompress(compressed, MAX_PAYLOAD_RAW_BYTES + 1)
    require(
        len(value) <= MAX_PAYLOAD_RAW_BYTES and decoder.eof and not decoder.unused_data
        and not decoder.unconsumed_tail,
        "payload compression boundary",
    )
    return value


def valid_date(value, start, end, label):
    require(isinstance(value, str) and DATE.fullmatch(value) is not None, label)
    parsed = datetime.strptime(value, "%Y-%m-%d").date()
    require(start <= value <= end, label)
    return parsed


def weekdays(start, end):
    first = datetime.strptime(start, "%Y-%m-%d").date()
    last = datetime.strptime(end, "%Y-%m-%d").date()
    return sum(1 for offset in range((last - first).days + 1) if (first + timedelta(days=offset)).weekday() < 5)


def extract_runner_cases(script_text):
    tree = ast.parse(script_text)
    for node in tree.body:
        if isinstance(node, ast.ClassDef) and node.name == "FreeCloudMetadataPilotV6":
            for statement in node.body:
                if isinstance(statement, ast.Assign) and any(
                    isinstance(target, ast.Name) and target.id == "CASES" for target in statement.targets
                ):
                    return ast.literal_eval(statement.value)
    raise VerificationError("runner CASES literal missing")


def validate_static():
    cases, contract = load(CASES), load(CONTRACT)
    require(set(contract) == {
        "schema", "createdAt", "taskId", "sourceId", "phase", "predecessorObservation",
        "pilotCore", "pilotCoreSha256", "boundFiles", "executionBlockedUntil",
        "claimBoundary", "humanAttestation", "outcomesAccessed",
    }, "contract keyset")
    require(contract["schema"] == "early-detection-quantconnect-free-cloud-pilot-contract/v6", "contract schema")
    require(contract["phase"] == "DISCOVERY_ONLY_PRE_IDENTITY_VALIDATION", "contract phase")
    require(contract["humanAttestation"] is False and contract["outcomesAccessed"] is False, "contract locks")
    require(contract["boundFiles"] == {
        "casesPath": CASES.relative_to(ROOT).as_posix(), "casesRawSha256": sha(CASES),
        "cloudScriptPath": SCRIPT.relative_to(ROOT).as_posix(), "cloudScriptRawSha256": sha(SCRIPT),
        "verifierPath": Path(__file__).resolve().relative_to(ROOT).as_posix(),
        "verifierRawSha256": sha(Path(__file__).resolve()),
        "testPath": TEST.relative_to(ROOT).as_posix(), "testRawSha256": sha(TEST),
    }, "bound files")
    predecessor = contract["predecessorObservation"]
    require(predecessor == {
        "status": "OPERATOR_REPORTED_UNSEALED_NOT_PROMOTED",
        "schema": "early-detection-quantconnect-free-cloud-metadata-output/v5",
        "leanVersionObserved": EXPECTED_LEAN_VERSION,
        "caseCount": 50,
        "dataPoints": 217358,
        "completionMarker": "Algorithm completed",
        "observedLogCharacters": 8172,
        "truncationObservedAfterCaseId": "QC-006",
        "evidenceArtifactBound": False,
    }, "predecessor observation")
    require(contract["pilotCoreSha256"] == hashlib.sha256(canonical(contract["pilotCore"])).hexdigest(), "core hash")
    core = contract["pilotCore"]
    require(core["casesRawSha256"] == sha(CASES), "core case binding")
    require(core["expectedLeanVersion"] == EXPECTED_LEAN_VERSION, "core LEAN label")
    require(core["datasetPolicy"] == {
        **DATASET, "retrievalDateSource": "UTC_WALL_CLOCK_AT_RUN", "officialVersionClaimed": False,
    }, "dataset policy")
    require(core["maxLogBytesExclusive"] == MAX_LOG_BYTES_EXCLUSIVE, "log ceiling")
    require(core["eventSequence"] == {
        "eventTypeOrder": ["SPLIT", "DIVIDEND", "SYMBOL_CHANGE", "DELISTING"],
        "digest": "LENGTH_PREFIXED_CANONICAL_JSON_SEQUENCE_SHA256_TRUNC192",
        "stream": EVENT_ENCODING,
        "zeroCountHashOmitted": True,
    }, "event sequence contract")
    require(core["claimLocks"] == CLAIM_LOCKS, "core claim locks")
    require(contract["executionBlockedUntil"] == [
        "TWO_COMPLETE_NONTRUNCATED_PROVIDER_RUNS",
        "TWO_PROVIDER_RUN_ENVELOPES_CAS_GIT_REMOTE_VERIFIED",
        "TERMS_AND_DERIVATIVE_EXPORT_RIGHTS_REMOTE_BOUND",
    ], "execution locks")
    require(contract["claimBoundary"]["allowed"] == ["METADATA_DISCOVERY_AND_REPRODUCIBILITY_ONLY"], "allowed claims")
    require(set(contract["claimBoundary"]["forbidden"]) == {
        "IDENTITY_RESOLVED", "TERMINAL_WEALTH_COMPLETE", "COVERAGE_RATE", "FULL_MARKET",
        "SURVIVORSHIP_SAFE", "ORIGINAL_V4_GATE_PASS", "H_LATE", "H_FEM",
    }, "forbidden claims")
    rows = cases["cases"]
    require(len(rows) == cases["caseCount"] == 50, "50-case denominator")
    require([row["caseId"] for row in rows] == [f"QC-{index:03d}" for index in range(1, 51)], "case order")
    expected_runner_cases = [
        (row["caseId"], row["category"], row["querySymbol"], row["alternateSymbols"],
         row["referenceStart"], row["referenceEnd"])
        for row in rows
    ]
    script_text = SCRIPT.read_text("utf-8")
    require(extract_runner_cases(script_text) == expected_runner_cases, "runner case/alias/window binding")
    require(contract["pilotCoreSha256"] in script_text and sha(CASES) in script_text, "runner core binding")
    forbidden_attributes = {"open", "high", "low", "close", "volume", "price", "holdings", "portfolio"}
    attributes = {node.attr.lower() for node in ast.walk(ast.parse(script_text)) if isinstance(node, ast.Attribute)}
    require(not attributes.intersection(forbidden_attributes), "runner accesses forbidden value attributes")
    for token in ("market_order", "set_holdings", "liquidate", "calculate_order_quantity"):
        require(token not in script_text.lower(), f"runner order primitive: {token}")
    return cases, contract


def validate_output(path, cases, contract):
    raw_value = raw(path)
    value = json.loads(raw_value)
    require(set(value) == TOP_KEYS, "output keyset")
    require(raw_value in (canonical(value), canonical(value) + b"\n"), "output must be compact canonical JSON")
    require(value["schema"] == OUTPUT_SCHEMA, "output schema")
    require(value["pilotCoreSha256"] == contract["pilotCoreSha256"], "core binding")
    require(value["casesRawSha256"] == sha(CASES), "case binding")
    require(value["leanVersion"] == EXPECTED_LEAN_VERSION, "LEAN version")
    require(isinstance(value["providerRunId"], str) and RUN_ID.fullmatch(value["providerRunId"]), "provider run id")
    executed = datetime.strptime(value["executedAt"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    require(value["dataset"] == {**DATASET, "retrievedOn": executed.strftime("%Y-%m-%d")}, "unversioned dataset label/date")
    require(value["payloadEncoding"] == PAYLOAD_ENCODING, "payload encoding")
    require(value["eventSequenceHashEncoding"] == EVENT_ENCODING, "event hash encoding")
    require(value["claimLocks"] == CLAIM_LOCKS, "claim locks")
    report_copy = dict(value)
    stored = report_copy.pop("reportSha256")
    require(isinstance(stored, str) and SHA.fullmatch(stored) is not None, "report hash syntax")
    require(stored == hashlib.sha256(canonical(report_copy)).hexdigest(), "report self hash")
    require(len(b"QC_METADATA_V6=" + canonical(value)) < MAX_LOG_BYTES_EXCLUSIVE, "cloud log size ceiling")
    payload_raw = decompress_payload(value["payload"])
    require(isinstance(value["payloadRawSha256"], str) and SHA.fullmatch(value["payloadRawSha256"]), "payload hash syntax")
    require(hashlib.sha256(payload_raw).hexdigest() == value["payloadRawSha256"], "payload raw hash")
    payload = json.loads(payload_raw)
    require(payload_raw == canonical(payload), "payload canonical bytes")
    require(isinstance(payload, dict) and set(payload) == {"caseRows"}, "payload keyset")
    expected_cases = cases["cases"]
    rows = payload["caseRows"]
    require(isinstance(rows, list) and len(rows) == 50, "payload case denominator")
    require([row[0] for row in rows] == [case["caseId"] for case in expected_cases], "payload case order")
    nonzero_sequences = 0
    alias_count = 0
    for row, case in zip(rows, expected_cases):
        require(isinstance(row, list) and len(row) == 2 and row[0] == case["caseId"], "case tuple")
        aliases = row[1]
        expected_aliases = 1 + len(case["alternateSymbols"])
        require(isinstance(aliases, list) and len(aliases) == expected_aliases, "case alias count/order")
        window_days = (
            datetime.strptime(case["referenceEnd"], "%Y-%m-%d").date()
            - datetime.strptime(case["referenceStart"], "%Y-%m-%d").date()
        ).days + 1
        for alias in aliases:
            alias_count += 1
            require(isinstance(alias, list) and len(alias) == 7, "alias tuple schema")
            accepted, security_id, observations, first_date, last_date, event_counts, errors = alias
            require(isinstance(accepted, bool), "subscription flag")
            require(isinstance(observations, int) and not isinstance(observations, bool) and observations >= 0, "observation count")
            require(observations <= weekdays(case["referenceStart"], case["referenceEnd"]), "observation count exceeds window")
            require(
                isinstance(event_counts, list) and len(event_counts) == 4
                and all(isinstance(item, int) and not isinstance(item, bool) and 0 <= item <= window_days for item in event_counts),
                "event counts",
            )
            require(
                isinstance(errors, list) and errors == sorted(set(errors))
                and all(isinstance(item, str) and ERROR_CODE.fullmatch(item) for item in errors),
                "error codes",
            )
            if accepted:
                require(
                    isinstance(security_id, str) and 1 <= len(security_id) <= 160
                    and security_id.strip() == security_id and all(32 <= ord(char) <= 126 for char in security_id),
                    "accepted security identifier",
                )
                require(errors == [], "accepted subscription errors")
            else:
                require(security_id is None and observations == 0, "rejected subscription metadata")
                require(first_date is None and last_date is None, "rejected observation dates")
                require(event_counts == [0, 0, 0, 0] and len(errors) >= 1, "rejected event/error semantics")
            if observations == 0:
                require(first_date is None and last_date is None, "zero observation dates")
            else:
                valid_date(first_date, case["referenceStart"], case["referenceEnd"], "first observation date")
                valid_date(last_date, case["referenceStart"], case["referenceEnd"], "last observation date")
                require(first_date <= last_date, "observation date order")
            nonzero_sequences += sum(1 for count in event_counts if count > 0)
    require(alias_count == sum(1 + len(case["alternateSymbols"]) for case in expected_cases), "global alias count")
    require(
        isinstance(value["eventSequenceHashCount"], int)
        and not isinstance(value["eventSequenceHashCount"], bool)
        and value["eventSequenceHashCount"] == nonzero_sequences,
        "event hash count",
    )
    hash_bytes = b64decode(value["eventSequenceHashes"], "event hashes")
    require(len(hash_bytes) == nonzero_sequences * EVENT_DIGEST_BYTES, "event hash byte count")
    for offset in range(0, len(hash_bytes), EVENT_DIGEST_BYTES):
        require(any(hash_bytes[offset:offset + EVENT_DIGEST_BYTES]), "zero event hash placeholder")
    no_floats(value)
    no_floats(payload)
    no_forbidden(value)
    no_forbidden(payload)
    return value


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-a")
    parser.add_argument("--run-b")
    args = parser.parse_args()
    cases, contract = validate_static()
    result = {
        "status": "PASS", "staticContractVerified": True, "executionBlocked": True,
        "providerRunEnvelopesRequired": True, "maxLogBytesExclusive": MAX_LOG_BYTES_EXCLUSIVE,
        "outcomesAccessed": False,
    }
    require((args.run_a is None) == (args.run_b is None), "both provider outputs are required")
    if args.run_a:
        a = validate_output(Path(args.run_a), cases, contract)
        b = validate_output(Path(args.run_b), cases, contract)
        require(a["providerRunId"] != b["providerRunId"], "provider run IDs must differ")
        require(a["leanVersion"] == b["leanVersion"] == EXPECTED_LEAN_VERSION, "run LEAN labels differ")
        require(a["dataset"] == b["dataset"], "run dataset labels/dates differ")
        a_parity, b_parity = dict(a), dict(b)
        for item in (a_parity, b_parity):
            item.pop("providerRunId")
            item.pop("executedAt")
            item.pop("reportSha256")
        require(a_parity == b_parity, "provider runs are not metadata-identical")
        result.update({
            "localTwoFileParityVerified": True,
            "runARawSha256": sha(Path(args.run_a)),
            "runBRawSha256": sha(Path(args.run_b)),
            "runALogBytes": len(b"QC_METADATA_V6=" + canonical(a)),
            "runBLogBytes": len(b"QC_METADATA_V6=" + canonical(b)),
        })
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (VerificationError, KeyError, IndexError, TypeError, ValueError, json.JSONDecodeError, OSError) as exc:
        print(json.dumps({"status": "FAIL", "error": str(exc), "outcomesAccessed": False}, sort_keys=True))
        raise SystemExit(2)

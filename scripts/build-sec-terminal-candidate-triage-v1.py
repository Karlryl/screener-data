#!/usr/bin/env python3
"""Build an outcome-blind lexical triage of the highest-priority SEC candidates."""

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
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
CONTRACT_PATH = ROOT / "research" / "early-detection-v4" / "sec-terminal-candidate-triage-contract-v1.json"
INPUT_PATH = ROOT / "reports" / "early-detection" / "sec-terminal-candidate-reconciliation-v1.json"
OUTPUT_PATH = ROOT / "reports" / "early-detection" / "sec-terminal-candidate-triage-v1.json"
SCRIPT_PATH = Path(__file__).resolve()
TEST_PATH = ROOT / "tests" / "build-sec-terminal-candidate-triage-v1.test.js"
CONTRACT_RAW_SHA256 = "911b46ba81b9538614c5c6ed8ba16a83aa6a390ff6c9f999c3138ee8697227ba"
INPUT_RAW_SHA256 = "e38823a9701a7ea58afc1a91e5ed209837251f2e397fdf9d31bc4433831b4fa0"
INPUT_REPORT_SHA256 = "a05ba1777da74a076698dfbb8bcbb43315f6ddcd1eb78cb5d7c3e5b64e7761ab"
AUTHORIZED_REMOTE = "https://github.com/Karlryl/screener-data.git"
AUTHORIZED_REF = "refs/heads/codex/early-detection-v4-gates-20260810"
BASE_COMMIT = "a9c23d12dd755435e1734982c5bfe802416a5c00"
INPUT_INTRODUCTION_COMMIT = "8ff267c0afc257ec2db3e72c512050fbcbb102f8"
OUTPUT_SCHEMA = "early-detection-sec-terminal-candidate-triage/v1"
REVIEW_STATUS = "AUTOMATED_TRIAGE_ONLY_PRIMARY_DOCUMENT_REVIEW_REQUIRED"
CLASSES = [
    "EXPLICIT_CASH_OR_MIXED_CONSIDERATION_CANDIDATE",
    "LIQUIDATION_OR_DISTRIBUTION_CANDIDATE",
    "STOCK_OR_SECURITY_EXCHANGE_CANDIDATE",
    "ADMINISTRATIVE_REMOVAL_NOTICE_CANDIDATE",
    "OTHER_PRIMARY_DOCUMENT_REVIEW_CANDIDATE",
]
AMOUNT = r"(?:US\$|\$)\s*[0-9][0-9,]*(?:\.[0-9]+)?(?:\s*(?:million|billion))?"
CASH_NEAR_AMOUNT = re.compile(
    rf"(?is)(?:(?:converted\s+into|right\s+to\s+receive|exchanged\s+for|"
    rf"cancelled\s+(?:and\s+)?(?:converted\s+into|for)|canceled\s+(?:and\s+)?"
    rf"(?:converted\s+into|for)|redeemed\s+for|merger\s+consideration).{{0,100}}{AMOUNT}|"
    rf"{AMOUNT}.{{0,80}}(?:in\s+cash|cash\s+per\s+share|net\s+per\s+share)|"
    rf"(?:in\s+cash|cash\s+per\s+share|net\s+per\s+share).{{0,80}}{AMOUNT})"
)
LIQUIDATION = re.compile(
    r"(?is)\b(?:liquidat(?:e|ed|ing|ion)|dissol(?:ve|ved|ution)|winding\s+up|"
    r"distribution\s+(?:to|for)\s+(?:share|stock)holders)\b"
)
STOCK_EXCHANGE = re.compile(
    r"(?is)\b(?:converted\s+into|exchanged\s+for|right\s+to\s+receive|merger\s+consideration)"
    r".{0,240}\b(?:share|shares|stock|security|securities)\b"
)
ADMINISTRATIVE = re.compile(
    r"(?is)\b(?:removal\s+from\s+listing|remove\s+the\s+entire\s+class|"
    r"registration\s+on\s+the\s+exchange|rule\s+12d2-2)\b"
)


class TriageError(RuntimeError):
    pass


def fail(message: str) -> None:
    raise TriageError(message)


def canonical(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def sha(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def exact_keys(value: Any, expected: set[str], label: str) -> None:
    if not isinstance(value, dict) or set(value) != expected:
        fail(f"{label} exact keys changed")


def git(*args: str) -> bytes:
    return subprocess.run(["git", *args], cwd=ROOT, check=True, capture_output=True).stdout


def git_text(*args: str) -> str:
    return git(*args).decode("utf-8").strip()


def remote_snapshot() -> str:
    if git_text("remote", "get-url", "origin") != AUTHORIZED_REMOTE:
        fail("origin URL changed")
    head = git_text("rev-parse", "HEAD")
    upstream = git_text("rev-parse", "@{upstream}")
    remote = git_text("ls-remote", "origin", AUTHORIZED_REF).splitlines()
    if len(remote) != 1 or head != upstream or head != remote[0].split()[0]:
        fail("local/upstream/remote snapshot mismatch")
    if subprocess.run(
        ["git", "merge-base", "--is-ancestor", BASE_COMMIT, head], cwd=ROOT,
        check=False, capture_output=True,
    ).returncode != 0:
        fail("authorized base is not an ancestor")
    return head


def expected_locks() -> dict[str, bool]:
    return {
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


def load_contract() -> tuple[dict[str, Any], bytes]:
    raw = CONTRACT_PATH.read_bytes()
    if sha(raw) != CONTRACT_RAW_SHA256:
        fail("contract raw hash changed")
    value = json.loads(raw)
    exact_keys(value, {
        "schema", "createdAt", "taskId", "track", "authorizedSnapshot", "input",
        "unit", "taxonomy", "triagePolicy", "authorizedImplementation", "claimLocks",
    }, "contract")
    if value["schema"] != "early-detection-sec-terminal-candidate-triage-contract/v1":
        fail("contract schema changed")
    if value["authorizedSnapshot"] != {
        "remote": AUTHORIZED_REMOTE, "ref": AUTHORIZED_REF, "baseCommit": BASE_COMMIT,
    }:
        fail("authorized snapshot changed")
    spec = value["input"]
    if spec != {
        "path": "reports/early-detection/sec-terminal-candidate-reconciliation-v1.json",
        "rawSha256": INPUT_RAW_SHA256,
        "reportSha256": INPUT_REPORT_SHA256,
        "introductionCommit": INPUT_INTRODUCTION_COMMIT,
        "totalRows": 16507,
        "eligiblePriorityTiers": [1, 2],
        "eligibleRows": 1101,
    }:
        fail("input contract changed")
    if [item.get("class") for item in value["taxonomy"]] != CLASSES:
        fail("taxonomy changed")
    if [item.get("rank") for item in value["taxonomy"]] != [1, 2, 3, 4, 5]:
        fail("taxonomy rank changed")
    if value["claimLocks"] != expected_locks():
        fail("claim locks changed")
    policy = value["triagePolicy"]
    if policy != {
        "firstMatchingRuleWins": True,
        "caseInsensitiveUnicodeText": True,
        "tickerJoinAllowed": False,
        "amountParsedAsVerifiedValue": False,
        "classificationProvesPayment": False,
        "classificationProvesTerminalWealth": False,
        "sourceTextRetainedForReview": True,
        "sourceRefRetainedExactly": True,
        "reviewStatus": REVIEW_STATUS,
    }:
        fail("triage policy changed")
    return value, raw


def load_input() -> tuple[dict[str, Any], bytes]:
    raw = INPUT_PATH.read_bytes()
    if sha(raw) != INPUT_RAW_SHA256:
        fail("input raw hash changed")
    committed = git("show", f"{INPUT_INTRODUCTION_COMMIT}:reports/early-detection/sec-terminal-candidate-reconciliation-v1.json")
    if committed != raw:
        fail("input differs from introduction Git blob")
    value = json.loads(raw)
    if value.get("reportSha256") != INPUT_REPORT_SHA256:
        fail("input report hash changed")
    if sha(canonical({key: item for key, item in value.items() if key != "reportSha256"})) != INPUT_REPORT_SHA256:
        fail("input self hash invalid")
    if len(value.get("rows", [])) != 16507 or value.get("claimLocks") != expected_locks():
        fail("input denominator or claim locks changed")
    return value, raw


def classify(text: str) -> tuple[str, list[str]]:
    if not isinstance(text, str) or not text.strip():
        fail("candidate text missing")
    if CASH_NEAR_AMOUNT.search(text):
        return CLASSES[0], ["CURRENCY_AMOUNT_NEAR_CASH_OR_CONSIDERATION_LANGUAGE"]
    if LIQUIDATION.search(text):
        return CLASSES[1], ["LIQUIDATION_DISSOLUTION_OR_DISTRIBUTION_LANGUAGE"]
    if STOCK_EXCHANGE.search(text):
        return CLASSES[2], ["STOCK_OR_SECURITY_EXCHANGE_LANGUAGE"]
    if ADMINISTRATIVE.search(text):
        return CLASSES[3], ["ADMINISTRATIVE_REMOVAL_LANGUAGE"]
    return CLASSES[4], ["NO_HIGHER_FROZEN_RULE_MATCH"]


def triage_row(source: dict[str, Any], triage_rank: int) -> dict[str, Any]:
    if source.get("priorityTier") not in (1, 2):
        fail("ineligible priority tier")
    if source.get("verificationStatus") != "CANDIDATE_ONLY" or source.get("outcomesAccessed") is not False:
        fail("source candidate boundary changed")
    classification, reasons = classify(source["text"])
    identity = {
        "sourceOccurrenceId": source["occurrenceId"],
        "classification": classification,
        "classificationReasons": reasons,
    }
    return {
        "triageRowId": sha(canonical(identity)),
        "triageRank": triage_rank,
        "sourceReconciliationRank": source["reconciliationRank"],
        "sourceOccurrenceId": source["occurrenceId"],
        "priorityTier": source["priorityTier"],
        "accession": source["accession"],
        "form": source["form"],
        "sourceDataset": source["sourceDataset"],
        "sourceRowId": source["sourceRowId"],
        "sourceCandidateId": source["sourceCandidateId"],
        "candidateKind": source["candidateKind"],
        "classification": classification,
        "classificationReasons": reasons,
        "reviewStatus": REVIEW_STATUS,
        "text": source["text"],
        "sourceRef": copy.deepcopy(source["sourceRef"]),
        "paymentVerified": False,
        "terminalWealthComplete": False,
        "outcomesAccessed": False,
    }


def validate_triage_row(row: dict[str, Any]) -> None:
    exact_keys(row, {
        "triageRowId", "triageRank", "sourceReconciliationRank", "sourceOccurrenceId",
        "priorityTier", "accession", "form", "sourceDataset", "sourceRowId",
        "sourceCandidateId", "candidateKind", "classification", "classificationReasons",
        "reviewStatus", "text", "sourceRef", "paymentVerified", "terminalWealthComplete",
        "outcomesAccessed",
    }, "triage row")
    if not isinstance(row["triageRank"], int) or row["triageRank"] < 1:
        fail("triage rank invalid")
    if row["priorityTier"] not in (1, 2):
        fail("triage priority tier changed")
    classification, reasons = classify(row["text"])
    if row["classification"] != classification or row["classificationReasons"] != reasons:
        fail("lexical classification changed")
    identity = {
        "sourceOccurrenceId": row["sourceOccurrenceId"],
        "classification": classification,
        "classificationReasons": reasons,
    }
    if row["triageRowId"] != sha(canonical(identity)):
        fail("triage row identity changed")
    if row["reviewStatus"] != REVIEW_STATUS:
        fail("review status promoted")
    if row["paymentVerified"] is not False or row["terminalWealthComplete"] is not False:
        fail("payment or terminal claim promoted")
    if row["outcomesAccessed"] is not False:
        fail("outcome lock opened")


def build_rows(source: dict[str, Any]) -> list[dict[str, Any]]:
    eligible = [row for row in source["rows"] if row["priorityTier"] in (1, 2)]
    if len(eligible) != 1101:
        fail("eligible denominator changed")
    rows = [triage_row(row, rank) for rank, row in enumerate(eligible, 1)]
    if len({row["triageRowId"] for row in rows}) != len(rows):
        fail("duplicate triage row id")
    return rows


def summarize(rows: list[dict[str, Any]]) -> dict[str, Any]:
    by_class = {name: 0 for name in CLASSES}
    by_tier = {"1": 0, "2": 0}
    for row in rows:
        by_class[row["classification"]] += 1
        by_tier[str(row["priorityTier"])] += 1
    return {"rows": len(rows), "byPriorityTier": by_tier, "byClassification": by_class}


def bind_implementation(head: str, contract_raw: bytes) -> dict[str, str]:
    result = {
        "buildCommit": head,
        "authorizedBaseCommit": BASE_COMMIT,
        "remote": AUTHORIZED_REMOTE,
        "ref": AUTHORIZED_REF,
    }
    for key, path in (
        ("contractRawSha256", CONTRACT_PATH),
        ("builderRawSha256", SCRIPT_PATH),
        ("testRawSha256", TEST_PATH),
    ):
        relative = path.relative_to(ROOT).as_posix()
        raw = path.read_bytes()
        committed = git("show", f"{head}:{relative}")
        if raw != committed and raw.replace(b"\r\n", b"\n") != committed:
            fail(f"implementation Git binding changed: {relative}")
        result[key] = sha(committed)
    if result["contractRawSha256"] != sha(contract_raw) or result["contractRawSha256"] != CONTRACT_RAW_SHA256:
        fail("contract implementation binding changed")
    return result


def validate_output(payload: dict[str, Any], rows: list[dict[str, Any]], bindings: dict[str, Any], implementation: dict[str, Any]) -> None:
    exact_keys(payload, {
        "schema", "track", "taskId", "inputBindings", "implementationBindings",
        "population", "claimLocks", "rows", "reportSha256",
    }, "output")
    if payload["schema"] != OUTPUT_SCHEMA or payload["track"] != "SHARED_OUTCOME_BLIND_INFRA":
        fail("output identity changed")
    if payload["inputBindings"] != bindings or payload["implementationBindings"] != implementation:
        fail("output bindings changed")
    if payload["claimLocks"] != expected_locks() or payload["rows"] != rows:
        fail("output locks or source-derived rows changed")
    if payload["population"] != summarize(rows):
        fail("population ledger changed")
    if [row["triageRank"] for row in rows] != list(range(1, len(rows) + 1)):
        fail("triage rank changed")
    for row in rows:
        validate_triage_row(row)
    expected_self = sha(canonical({key: item for key, item in payload.items() if key != "reportSha256"}))
    if payload["reportSha256"] != expected_self:
        fail("output self hash changed")


def build() -> dict[str, Any]:
    head = remote_snapshot()
    contract, contract_raw = load_contract()
    source, source_raw = load_input()
    rows = build_rows(source)
    bindings = {
        "contractRawSha256": sha(contract_raw),
        "sourcePath": contract["input"]["path"],
        "sourceRawSha256": sha(source_raw),
        "sourceReportSha256": source["reportSha256"],
        "sourceIntroductionCommit": INPUT_INTRODUCTION_COMMIT,
    }
    implementation = bind_implementation(head, contract_raw)
    payload = {
        "schema": OUTPUT_SCHEMA,
        "track": contract["track"],
        "taskId": contract["taskId"],
        "inputBindings": bindings,
        "implementationBindings": implementation,
        "population": summarize(rows),
        "claimLocks": contract["claimLocks"],
        "rows": rows,
        "reportSha256": None,
    }
    payload["reportSha256"] = sha(canonical({key: item for key, item in payload.items() if key != "reportSha256"}))
    validate_output(payload, rows, bindings, implementation)
    if remote_snapshot() != head:
        fail("remote changed during build")
    return payload


def atomic_write_new(path: Path, raw: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp: Path | None = None
    try:
        with tempfile.NamedTemporaryFile("wb", dir=path.parent, prefix=path.name + ".", suffix=".tmp", delete=False) as handle:
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


def fixture(text: str) -> dict[str, Any]:
    return {
        "occurrenceId": "a" * 64,
        "reconciliationRank": 1,
        "priorityTier": 1,
        "verificationStatus": "CANDIDATE_ONLY",
        "outcomesAccessed": False,
        "accession": "0000000001-20-000001",
        "form": "15-12B",
        "sourceDataset": "FORM15_METADATA_V2",
        "sourceRowId": "SEC-TW-00000001",
        "sourceCandidateId": "b" * 64,
        "candidateKind": "PAYMENT_OR_TERMINAL_LANGUAGE",
        "text": text,
        "sourceRef": {"evidenceSha256": sha(text.encode("utf-8"))},
    }


def rejected(func: Any) -> bool:
    try:
        func()
    except (TriageError, KeyError, TypeError, ValueError):
        return True
    return False


def self_test() -> dict[str, Any]:
    cash = triage_row(fixture("Each share was converted into $12.50 in cash."), 1)
    liquidation = triage_row(fixture("The initial liquidating distribution was paid to stockholders."), 1)
    stock = triage_row(fixture("Each share was exchanged for 0.5 shares of Buyer common stock."), 1)
    administrative = triage_row(fixture("Notice of removal from listing under Rule 12d2-2."), 1)
    other = triage_row(fixture("The duty to file reports was terminated."), 1)
    promoted = copy.deepcopy(cash)
    promoted["paymentVerified"] = True
    empty = fixture("")
    return {
        "status": "PASS",
        "classFixtures": [
            cash["classification"], liquidation["classification"], stock["classification"],
            administrative["classification"], other["classification"],
        ] == CLASSES,
        "paymentPromotionRejected": rejected(lambda: validate_triage_row(promoted)),
        "emptyTextRejected": rejected(lambda: triage_row(empty, 1)),
        "tickerJoinUsed": False,
        "outcomesAccessed": False,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument("--summary-only", action="store_true")
    parser.add_argument("--output", default=str(OUTPUT_PATH))
    args = parser.parse_args()
    try:
        if args.self_test:
            result = self_test()
        else:
            payload = build()
            if not args.summary_only:
                raw = json.dumps(payload, ensure_ascii=False, sort_keys=True, indent=2).encode("utf-8") + b"\n"
                atomic_write_new(Path(args.output), raw)
            result = {
                "status": "PASS", **payload["population"], "reportSha256": payload["reportSha256"],
                "written": not args.summary_only, "outcomesAccessed": False,
            }
    except (TriageError, OSError, ValueError, KeyError, TypeError, subprocess.CalledProcessError) as exc:
        parser.error(str(exc))
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

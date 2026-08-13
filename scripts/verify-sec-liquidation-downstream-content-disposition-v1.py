#!/usr/bin/env python3
"""Verify the exact 115-document, 90-day downstream SEC content disposition."""

from __future__ import annotations

import argparse
import copy
import hashlib
import importlib.util
import json
import re
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable


ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "research" / "early-detection-v4" / "sec-liquidation-downstream-content-disposition-contract-v1.json"
VERIFIER = Path(__file__).resolve()
TEST = ROOT / "tests" / "verify-sec-liquidation-downstream-content-disposition-v1.test.js"
DISCOVERY = ROOT / "scripts" / "build-sec-liquidation-downstream-filing-discovery-v1.py"
CAPTURE = ROOT / "scripts" / "capture-sec-liquidation-downstream-filings-v2.py"
PARSER = ROOT / "scripts" / "build-sec-form25-structured-metadata-v1.py"
FROZEN = ROOT / "research" / "early-detection-v4" / "sec-frozen-liquidation-payment-evidence-contract-v1.json"
PRIVATE_ROOT = Path(r"C:\Users\Anwender\Documents\GrowthScreenerResearchData\early-detection-v4\liquidation-downstream-sec-originals-v1")
MANIFEST = PRIVATE_ROOT / "manifests" / "sha256" / "a9" / "a9663c757d2e115ec7cd453ae401ce0069308221e7f72aa53a73157023d97e78.json"
OWNED = (CONTRACT, VERIFIER, TEST)

CONTRACT_RAW = "a9100217bc53e13a9391a2c0971154e28c0f027243de35df886c9328ba9ace7e"
CONTRACT_SELF = "567cb0581a0ecbacc227a56fa61852b033a412673222dd3bbe1d581f5bedb25c"
TEST_RAW = "ce63b8d0e7b80eb96b845096daf6a174016e334325b6ac9ba38bde209e7a4248"
BASE = "d29d9cf382bbf7d06f7666c01c93f3357ec6122a"
REMOTE = "https://github.com/Karlryl/screener-data.git"
REMOTE_REF = "refs/heads/codex/early-detection-v4-gates-20260810"
CREATED_AT = "2026-08-13T13:58:19Z"
DISCOVERY_RAW = "69fcca3f46e993af4a78188a78b7726477e74f10c21968e65bfff2679ed945a9"
CAPTURE_RAW = "792ee4784fc668159b0034685937a1b5b273dfd2bcd40b70770b4dcb68e9e8e9"
PARSER_RAW = "52f78812a7547df4025dd8a48351f2364beb7285cc903bcb1a0df5fbe56d0025"
FROZEN_RAW = "a282583efe18ae14dfcc2b17db0822c92be75fade962aa53b53d28b05e99ff10"
MANIFEST_RAW = "564d6657ef48b3cba602e694afb558095d5d84543b7b6bba5b4822f4ab8fd760"
MANIFEST_SELF = "a9663c757d2e115ec7cd453ae401ce0069308221e7f72aa53a73157023d97e78"
EXPECTED_SENTENCE_SHA = "6eaf2e270330a16657bebfc6cfd6d584ae32a3e3e3dd6de4ce184f6b2062943e"
EXPECTED_CASES = [f"LIQUIDATION-PAYMENT-{number:03d}" for number in range(14, 18)]

PURPOSE = (
    "Verify all 115 privately captured official SEC submissions in the exact pre-sealed 90-day same-issuer-CIK stage, "
    "freeze four exact later SEC liquidation-date corroborations, and record zero same-descriptor original-amount, "
    "past-additional-distribution or no-further-payment sentences without claiming absence outside that bounded stage."
)
LOCKS = {
    "sameSecurityVerified": False, "securityIdentityResolved": False, "listingIdentityResolved": False,
    "originalAmountRepeatedInDownstreamSentence": False, "additionalDistributionVerified": False,
    "noFurtherPaymentsVerified": False, "laterRecoveriesExcluded": False, "completeCorporateActionChainVerified": False,
    "lastConsolidatedSessionObserved": False, "lastTradePriceObserved": False, "laterOtcTradingExcluded": False,
    "terminalWealthComplete": False, "originalV4GateCredit": False, "resultComputationAllowed": False,
    "pricesAccessed": False, "returnsAccessed": False, "outcomesAccessed": False,
}


class DispositionError(RuntimeError):
    pass


def fail(message: str) -> None:
    raise DispositionError(message)


def sha(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def canonical(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def self_hash(value: dict[str, Any], field: str) -> str:
    body = dict(value)
    body.pop(field, None)
    return sha(canonical(body))


def exact_keys(value: Any, expected: set[str], label: str) -> None:
    if type(value) is not dict or set(value) != expected:
        fail(f"{label} exact keys changed")


def normalized_verifier(raw: bytes) -> bytes:
    text = raw.decode("utf-8").replace("\r\n", "\n")
    for name in ("CONTRACT_RAW", "CONTRACT_SELF", "TEST_RAW"):
        pattern = re.compile(rf'^{name} = "[0-9a-f]{{64}}"$', re.MULTILINE)
        matches = pattern.findall(text)
        if len(matches) != 1:
            fail(f"{name} normalization structure changed")
        text = pattern.sub(f'{name} = "{"0" * 64}"', text)
    return text.encode("utf-8")


def git(*args: str, check: bool = True) -> str:
    result = subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True, check=False)
    if check and result.returncode:
        fail(result.stderr.strip() or "git command failed")
    return result.stdout.strip()


def git_raw(commit: str, path: Path) -> bytes:
    result = subprocess.run(["git", "show", f"{commit}:{path.relative_to(ROOT).as_posix()}"], cwd=ROOT, capture_output=True)
    if result.returncode:
        fail(f"Git blob unavailable for {path.name}")
    return result.stdout


def is_ancestor(older: str, newer: str) -> bool:
    return subprocess.run(["git", "merge-base", "--is-ancestor", older, newer], cwd=ROOT).returncode == 0


def import_bound(name: str, path: Path, expected: str, head: str) -> Any:
    raw = path.read_bytes()
    git_bytes = git_raw(head, path)
    if sha(git_bytes) != expected or raw.replace(b"\r\n", b"\n") != git_bytes:
        fail(f"{name} implementation bytes changed")
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        fail(f"{name} import failed")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def expected_inputs() -> dict[str, Any]:
    return {
        "discoveryBuilder": {"path": DISCOVERY.relative_to(ROOT).as_posix(), "rawSha256": DISCOVERY_RAW},
        "captureRunner": {"path": CAPTURE.relative_to(ROOT).as_posix(), "rawSha256": CAPTURE_RAW},
        "documentParser": {"path": PARSER.relative_to(ROOT).as_posix(), "rawSha256": PARSER_RAW},
        "frozenLiquidationContract": {"path": FROZEN.relative_to(ROOT).as_posix(), "rawSha256": FROZEN_RAW},
        "privateManifest": {"absolutePath": str(MANIFEST), "rawSha256": MANIFEST_RAW, "manifestSha256": MANIFEST_SELF,
                            "capturedCandidates": 115, "remainingCandidates": 0, "complete": True},
    }


def expected_scan() -> dict[str, Any]:
    return {
        "windowDaysAfterEachSeedEffectiveDate": [1, 90], "candidateFilings": 115, "caseCandidateLinks": 469,
        "parsedDocuments": 399, "normalizedSentences": 43949, "exactDescriptorLinks": 38,
        "exactDescriptorCandidates": 20, "exactDescriptorCases": 12, "laterLiquidationCorroborationRows": 4,
        "laterLiquidationCorroborationCases": EXPECTED_CASES, "uniqueCorroborationSentences": 1,
        "corroborationSentenceSha256": EXPECTED_SENTENCE_SHA, "corroborationForm": "N-Q",
        "corroborationFiledDate": "2014-11-26", "corroborationDayOffset": 56,
        "sameDescriptorOriginalAmountSentenceMatches": 0, "pastAdditionalDistributionSentenceMatches": 0,
        "noFurtherPaymentSentenceMatches": 0, "claimScope": "EXACT_CAPTURED_115_DOCUMENT_90_DAY_STAGE_ONLY",
    }


def validate_contract(value: dict[str, Any]) -> None:
    exact_keys(value, {"schema", "createdAt", "taskId", "track", "purpose", "inputs", "scanContract", "claimLocks", "implementationContract", "contractSha256"}, "contract")
    if value["schema"] != "sec-liquidation-downstream-content-disposition-contract/v1" or value["createdAt"] != CREATED_AT:
        fail("contract identity or time changed")
    if datetime.fromisoformat(CREATED_AT.replace("Z", "+00:00")) > datetime.now(timezone.utc):
        fail("contract time is future")
    if value["taskId"] != "Q003-SEC-LIQUIDATION-DOWNSTREAM-CONTENT-DISPOSITION" or value["track"] != "SHARED_OUTCOME_BLIND_INFRA":
        fail("task identity changed")
    if value["purpose"] != PURPOSE or value["inputs"] != expected_inputs() or value["scanContract"] != expected_scan():
        fail("purpose, inputs or scan contract changed")
    if value["claimLocks"] != LOCKS:
        fail("claim locks changed")
    expected_impl = {
        "baseCommit": BASE, "baseTag": 895, "remote": REMOTE, "ref": REMOTE_REF,
        "contractPath": CONTRACT.relative_to(ROOT).as_posix(), "verifierPath": VERIFIER.relative_to(ROOT).as_posix(),
        "testPath": TEST.relative_to(ROOT).as_posix(), "verifierNormalizedSha256": sha(normalized_verifier(VERIFIER.read_bytes())),
        "testRawSha256": TEST_RAW, "introductionMustBeDirectSingleParentChildOfBase": True,
        "introductionAddsExactlyThreeOwnedPaths": True, "laterLinearSingleParentDescendantsAllowed": True,
        "verificationRequiresLiveRemote": True, "writesAllowed": False,
    }
    if value["implementationContract"] != expected_impl:
        fail("implementation contract changed")
    if value["contractSha256"] != CONTRACT_SELF or self_hash(value, "contractSha256") != CONTRACT_SELF:
        fail("contract self hash changed")


def load_contract() -> dict[str, Any]:
    raw = CONTRACT.read_bytes()
    if sha(raw) != CONTRACT_RAW:
        fail("contract raw bytes changed")
    value = json.loads(raw)
    validate_contract(value)
    return value


def scan(head: str) -> dict[str, Any]:
    discovery = import_bound("discovery", DISCOVERY, DISCOVERY_RAW, head)
    capture = import_bound("capture", CAPTURE, CAPTURE_RAW, head)
    parser = import_bound("parser", PARSER, PARSER_RAW, head)
    if sha(FROZEN.read_bytes()) != FROZEN_RAW or git_raw(head, FROZEN) != FROZEN.read_bytes():
        fail("frozen evidence contract changed")
    manifest_raw = MANIFEST.read_bytes()
    if sha(manifest_raw) != MANIFEST_RAW:
        fail("private manifest raw bytes changed")
    manifest = json.loads(manifest_raw)
    if manifest.get("manifestSha256") != MANIFEST_SELF or self_hash(manifest, "manifestSha256") != MANIFEST_SELF:
        fail("private manifest self hash changed")
    if (manifest.get("capturedCandidates"), manifest.get("remainingCandidates"), manifest.get("complete"), manifest.get("outcomesAccessed")) != (115, 0, True, False):
        fail("private manifest completion changed")
    seeds, candidates, links, _stats = discovery.build_rows()
    if len(seeds) != 17 or len(candidates) != 115 or len(links) != 469:
        fail("discovery population changed")
    seed_by_id = {item["caseId"]: item for item in seeds}
    candidate_by_id = {item["candidateId"]: item for item in candidates}
    links_by_candidate: dict[str, list[dict[str, Any]]] = {}
    for link in links:
        links_by_candidate.setdefault(link["candidateId"], []).append(link)
    v1 = capture.load_v1(head)
    capture.verify_v1_checkpoint(v1, candidates)
    current = capture.build_v2_manifest(v1, candidates)
    capture.validate_v2_manifest(v1, current, candidates)
    if current != manifest:
        fail("private manifest differs from receipts")
    receipts = {item["candidateId"]: item for item in capture.load_receipts(v1, candidates)}
    frozen = json.loads(FROZEN.read_bytes())
    frozen_by_case = {item["caseId"]: item for item in frozen["frozenCases"]}
    documents_total = sentences_total = 0
    exact_links: set[tuple[str, str]] = set()
    exact_candidates: set[str] = set()
    exact_cases: set[str] = set()
    rows: list[dict[str, Any]] = []
    original_amount = additional = no_further = 0
    for candidate_id in sorted(links_by_candidate):
        candidate = candidate_by_id[candidate_id]
        receipt = receipts[candidate_id]
        raw = (PRIVATE_ROOT / receipt["blobRelativePath"]).read_bytes()
        documents = parser.extract_documents(raw)
        sentences = parser.sentences_for_documents(documents)
        documents_total += len(documents)
        sentences_total += len(sentences)
        for link in links_by_candidate[candidate_id]:
            seed = seed_by_id[link["caseId"]]
            descriptor = " ".join(re.sub(r"[^a-z0-9]+", " ", seed["securityDescription"].lower()).split())
            for document, sentence_index, sentence, mode in sentences:
                lowered = " ".join(re.sub(r"[^a-z0-9]+", " ", sentence.lower()).split())
                if descriptor not in lowered:
                    continue
                exact_links.add((seed["caseId"], candidate_id)); exact_candidates.add(candidate_id); exact_cases.add(seed["caseId"])
                frozen_case = frozen_by_case[seed["caseId"]]
                if frozen_case["amountLiteral"].replace(" ", "") in sentence.replace(" ", ""):
                    original_amount += 1
                if re.search(r"\b(?:additional|further|subsequent|supplemental|second|final)\b.{0,100}\b(?:distribution|payment|proceeds|cash)\b", sentence, re.I | re.S) and re.search(r"\b(?:was|were|has been|have been)\s+(?:distributed|paid|received|remitted)", sentence, re.I):
                    additional += 1
                if re.search(r"\b(?:no|not)\s+(?:additional|further|subsequent)\s+(?:distribution|payment)s?\b", sentence, re.I):
                    no_further += 1
                sentence_sha = sha(sentence.encode("utf-8"))
                if sentence_sha == EXPECTED_SENTENCE_SHA and re.search(r"\bThe funds liquidated on October 1, 2014\b", sentence):
                    rows.append({
                        "caseId": seed["caseId"], "candidateId": candidate_id, "candidateAccession": candidate["accession"],
                        "form": candidate["form"], "filedDate": candidate["filedDate"], "dayOffset": link["dayOffset"],
                        "candidateRawSha256": receipt["rawSha256"], "documentIndex": document["index"],
                        "documentType": document["type"], "documentSequence": document["sequence"],
                        "documentFilename": document["filename"], "rawDocumentSha256": sha(document["raw"]),
                        "rawTextSha256": sha(document["textRaw"]), "sentenceIndex": sentence_index,
                        "sentenceSha256": sentence_sha, "normalizationMode": mode,
                        "evidenceKind": "LATER_SEC_REPORT_STATES_FUND_LIQUIDATED_ON_EXACT_DATE",
                    })
    rows.sort(key=lambda item: item["caseId"])
    stats = {
        "candidateFilings": len(candidates), "caseCandidateLinks": len(links), "parsedDocuments": documents_total,
        "normalizedSentences": sentences_total, "exactDescriptorLinks": len(exact_links),
        "exactDescriptorCandidates": len(exact_candidates), "exactDescriptorCases": len(exact_cases),
        "laterLiquidationCorroborationRows": len(rows), "laterLiquidationCorroborationCases": [item["caseId"] for item in rows],
        "uniqueCorroborationSentences": len({item["sentenceSha256"] for item in rows}),
        "sameDescriptorOriginalAmountSentenceMatches": original_amount,
        "pastAdditionalDistributionSentenceMatches": additional, "noFurtherPaymentSentenceMatches": no_further,
    }
    expected = expected_scan()
    for key, actual in stats.items():
        if actual != expected[key]:
            fail(f"source-derived {key} changed")
    report = {
        "schema": "sec-liquidation-downstream-content-disposition/v1", "scope": expected["claimScope"],
        "manifestRawSha256": MANIFEST_RAW, "stats": stats, "rows": rows, "claimLocks": LOCKS,
        "outcomesAccessed": False, "reportSha256": "",
    }
    report["reportSha256"] = self_hash(report, "reportSha256")
    return report


def changed_paths(commit: str) -> list[tuple[str, str]]:
    output = git("diff-tree", "--no-commit-id", "--name-status", "-r", commit)
    return [tuple(line.split("\t", 1)) for line in output.splitlines() if line]


def introduction_for(path: Path) -> list[str]:
    output = git("log", "--reverse", "--format=%H", "--diff-filter=A", f"{BASE}..HEAD", "--", path.relative_to(ROOT).as_posix())
    return output.splitlines() if output else []


def verify_repository(remote_required: bool) -> dict[str, Any]:
    if not remote_required:
        fail("live remote verification is mandatory")
    if git("remote", "get-url", "origin") != REMOTE:
        fail("origin URL changed")
    head = git("rev-parse", "HEAD")
    if git("rev-parse", "@{u}") != head or git("ls-remote", "--refs", "origin", REMOTE_REF).split() != [head, REMOTE_REF]:
        fail("HEAD, upstream and live remote differ")
    if not is_ancestor(BASE, head):
        fail("base is not ancestor of HEAD")
    introductions = [introduction_for(path) for path in OWNED]
    if all(not item for item in introductions):
        if head != BASE:
            fail("pre-introduction HEAD moved beyond base")
        return {"phase": "PRE_INTRODUCTION", "introductionCommit": None, "remoteVerified": True}
    if any(len(item) != 1 for item in introductions) or len({item[0] for item in introductions}) != 1:
        fail("owned paths were not introduced together once")
    intro = introductions[0][0]
    if git("show", "-s", "--format=%P", intro).split() != [BASE]:
        fail("introduction is not direct single-parent child of base")
    if changed_paths(intro) != [("A", path.relative_to(ROOT).as_posix()) for path in OWNED]:
        fail("introduction does not add exactly owned paths")
    previous = intro
    for commit in git("rev-list", "--reverse", "--first-parent", f"{intro}..{head}").splitlines():
        if git("show", "-s", "--format=%P", commit).split() != [previous]:
            fail("post-introduction history is not linear single-parent")
        previous = commit
    for path in OWNED:
        raw = path.read_bytes()
        if git_raw(intro, path) != raw or git_raw(head, path) != raw:
            fail("owned Git bytes changed")
    return {"phase": "POST_INTRODUCTION", "introductionCommit": intro, "remoteVerified": True}


def reseal(value: dict[str, Any]) -> dict[str, Any]:
    item = copy.deepcopy(value); item["contractSha256"] = self_hash(item, "contractSha256"); return item


def rejected(action: Callable[[], None]) -> bool:
    try:
        action()
    except (DispositionError, KeyError, TypeError, ValueError, OSError, json.JSONDecodeError):
        return True
    return False


def self_test(value: dict[str, Any]) -> dict[str, Any]:
    mutations: dict[str, Callable[[dict[str, Any]], None]] = {
        "backdated": lambda x: x.__setitem__("createdAt", "1970-01-01T00:00:00Z"),
        "purposeOverclaim": lambda x: x.__setitem__("purpose", "terminal wealth complete"),
        "candidateLoss": lambda x: x["scanContract"].__setitem__("candidateFilings", 114),
        "documentLoss": lambda x: x["scanContract"].__setitem__("parsedDocuments", 398),
        "sentenceLoss": lambda x: x["scanContract"].__setitem__("normalizedSentences", 43948),
        "corroborationGain": lambda x: x["scanContract"].__setitem__("laterLiquidationCorroborationRows", 5),
        "amountGain": lambda x: x["scanContract"].__setitem__("sameDescriptorOriginalAmountSentenceMatches", 1),
        "additionalGain": lambda x: x["scanContract"].__setitem__("pastAdditionalDistributionSentenceMatches", 1),
        "noFurtherGain": lambda x: x["scanContract"].__setitem__("noFurtherPaymentSentenceMatches", 1),
        "scopeExpansion": lambda x: x["scanContract"].__setitem__("claimScope", "ALL_FUTURE_TIME"),
        "manifestDrift": lambda x: x["inputs"]["privateManifest"].__setitem__("rawSha256", "0" * 64),
        "sameSecurityCredit": lambda x: x["claimLocks"].__setitem__("sameSecurityVerified", True),
        "recoveryCredit": lambda x: x["claimLocks"].__setitem__("laterRecoveriesExcluded", True),
        "terminalCredit": lambda x: x["claimLocks"].__setitem__("terminalWealthComplete", True),
        "outcomeCredit": lambda x: x["claimLocks"].__setitem__("outcomesAccessed", True),
        "unknownCredit": lambda x: x["claimLocks"].__setitem__("unknownCredit", True),
        "verifierDrift": lambda x: x["implementationContract"].__setitem__("verifierNormalizedSha256", "0" * 64),
    }
    kills: dict[str, bool] = {}
    for name, mutate in mutations.items():
        item = copy.deepcopy(value); mutate(item); item = reseal(item)
        kills[name] = rejected(lambda item=item: validate_contract(item))
    if not all(kills.values()):
        fail("self-test kill failed")
    return {"schema": "sec-liquidation-downstream-content-disposition-self-test/v1", "status": "PASS", "mutationKills": kills, "outcomesAccessed": False}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=("verify-contract", "verify", "self-test"))
    parser.add_argument("--remote", action="store_true")
    args = parser.parse_args()
    try:
        contract = load_contract()
        repository = verify_repository(args.remote)
        if args.command == "self-test":
            result = {**self_test(contract), **repository}
        else:
            report = scan(git("rev-parse", "HEAD"))
            result = {"schema": "sec-liquidation-downstream-content-disposition-verification/v1", "status": "PASS", **repository,
                      "reportSha256": report["reportSha256"], **report["stats"], "claimLocks": LOCKS,
                      "writes": 0, "networkRequests": 0, "outcomesAccessed": False}
    except (DispositionError, KeyError, TypeError, ValueError, OSError, json.JSONDecodeError) as exc:
        parser.error(str(exc))
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

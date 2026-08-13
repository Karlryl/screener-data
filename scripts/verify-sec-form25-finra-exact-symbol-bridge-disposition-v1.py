#!/usr/bin/env python3
"""Verify the zero-credit SEC Form-25 to FINRA exact-symbol bridge disposition."""

from __future__ import annotations

import argparse
import bisect
import copy
import gzip
import hashlib
import json
import re
import subprocess
from collections import Counter, defaultdict
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Callable


ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "research" / "early-detection-v4" / "sec-form25-finra-exact-symbol-bridge-disposition-contract-v1.json"
VERIFIER = Path(__file__).resolve()
TEST = ROOT / "tests" / "verify-sec-form25-finra-exact-symbol-bridge-disposition-v1.test.js"
BOUNDARY = ROOT / "reports" / "early-detection" / "sec-form25-suspension-boundary-v2.json"
POINTS = ROOT / "reports" / "early-detection" / "sec-form345-issuer-symbol-point-v3.json.gz"
FINRA_MANIFEST = ROOT / "reports" / "early-detection" / "finra-q004-historical-crawl-manifest-v3.json"
PRIVATE = Path(r"C:\Users\Anwender\Documents\GrowthScreenerResearchData\private-evidence\finra-q004\historical")
CHECKPOINT = PRIVATE / "checkpoint-v2.json"

CONTRACT_RAW = "0739bb8ab81853b8a34d326fa6fece77457cb7692a7f89246f8f200d25bafa71"
CONTRACT_SELF = "467d82f52c0afbe81bc458d689d5e8d2e7cae31d003dc6d8f8c0eced217c4bb1"
BASE = "609f37df9e9c277323c5c8e24d6accfa3d1f3ea7"
REMOTE = "https://github.com/Karlryl/screener-data.git"
REMOTE_REF = "refs/heads/codex/early-detection-v4-gates-20260810"
BOUNDARY_RAW = "4e9b33086ff6120de04110deb1e6e3916d2ca5001384729bbc28b273efd8735f"
BOUNDARY_SELF = "99199da6cf5b9c4ffc7416c5e97dc4fd9f6300ba3e7c731b123c11fa4c030345"
POINTS_GZIP_RAW = "fe75233db21467dbec453cd8f20e5b25a8a4d4db16317d6b2fc78eaa7c97f484"
POINTS_RAW = "81e748f609cbf8e73de2f5ea91166ce178c71c1df4fa0398ab9821f30459e0f4"
POINTS_SELF = "b27c9a9197088cbf29d0532a0d73c15a35e41c5300bacb12a7fb7f81076c7ef3"
FINRA_MANIFEST_RAW = "2f266d063d5c05df53d635afcb922d0775d0345005869955b41fece3b9502580"
FINRA_MANIFEST_SELF = "caff5b9863516992222f9b58690cfad31df700441eeaf2fe3c41b356e641a09f"
CHECKPOINT_RAW = "7dd6a000e72b5219d00f25d98540fca3c6ab4f0a0b9527498656d4d2e9a2cc9c"
CHECKPOINT_SELF = "37b68644f955d046bc97885d6dde4014acbcc04fa8acc3945712b204ee58e5ad"
ROW_SEQUENCE = "2e2aa926ce60a632942fe87e53fada22e0373108e04d2e5e5591727dad383c4a"
HEX64 = re.compile(r"[0-9a-f]{64}\Z")
COMMIT40 = re.compile(r"[0-9a-f]{40}\Z")
PLACEHOLDERS = {"N/A", "NA", "NONE", "NULL", "UNKNOWN", "NOT PROVIDED", "NOT APPLICABLE", "0", "-", "--"}
OWNED = (CONTRACT, VERIFIER, TEST)

EXPECTED_PURPOSE = (
    "Determine reproducibly whether exact same-CIK, pre-boundary SEC Form-3/4/5 symbol points can bridge "
    "primary SEC Form-25 suspension boundaries to private FINRA OTC Daily List events without description "
    "matching, symbol splitting, suffix inference, identity promotion, price access, return access, outcome "
    "access or Original-V4 credit."
)
EXPECTED_CREATED_AT = "2026-08-13T06:06:14Z"
EXPECTED_LOCKS = {
    "candidateRowsPromoted": False,
    "securityIdentityResolved": False,
    "listingIdentityResolved": False,
    "laterOtcTradingExcluded": False,
    "lastConsolidatedSessionObserved": False,
    "lastTradePriceObserved": False,
    "terminalPaymentVerified": False,
    "terminalWealthComplete": False,
    "pricesAccessed": False,
    "returnsAccessed": False,
    "outcomesAccessed": False,
    "originalV4GateCredit": False,
}
EXPECTED_PRIMARY = {"cells": 560, "boundaries": 560, "symbols": 226, "finraUniverseSymbolOverlap": 1, "candidatePairs": 0, "candidateBoundaries": 0, "candidateEvents": 0}
EXPECTED_RECENT = {"cells": 7472, "boundaries": 526, "symbols": 226, "finraUniverseSymbolOverlap": 2, "candidatePairs": 0, "candidateBoundaries": 0, "candidateEvents": 0}
EXPECTED_ALL = {
    "cells": 73608, "boundaries": 560, "symbols": 293, "finraUniverseSymbolOverlap": 8,
    "candidatePairs": 48, "candidateBoundaries": 2, "candidateEvents": 2,
    "minimumPointAgeDays": 3908, "maximumPointAgeDays": 5670,
    "eventCodePairCounts": {"SA": 24, "SC": 24},
}


class DispositionError(RuntimeError):
    pass


def fail(message: str) -> None:
    raise DispositionError(message)


def sha(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def canonical(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def exact_keys(value: Any, expected: set[str], label: str) -> None:
    if type(value) is not dict or set(value) != expected:
        fail(f"{label} exact keys changed")


def self_hash(value: dict[str, Any], field: str) -> str:
    body = dict(value)
    body.pop(field, None)
    return sha(canonical(body))


def normalized_verifier(raw: bytes) -> bytes:
    text = raw.decode("utf-8").replace("\r\n", "\n")
    for name in ("CONTRACT_RAW", "CONTRACT_SELF"):
        expression = re.compile(rf'^{name} = "[0-9a-fA-Z_]+"$', re.MULTILINE)
        if len(expression.findall(text)) != 1:
            fail(f"{name} normalization structure changed")
        text = expression.sub(f'{name} = "{'0' * 64}"', text)
    return text.encode("utf-8")


def canonical_cik(value: Any) -> str:
    text = str(value).strip()
    if not text.isascii() or not text.isdigit() or not 1 <= len(text) <= 10:
        fail("CIK format changed")
    return text.zfill(10)


def normalized_symbol(value: Any) -> str | None:
    if value is None:
        return None
    if type(value) is not str:
        fail("symbol type changed")
    text = value.strip().upper()
    if not text or text in PLACEHOLDERS:
        return None
    if not text.isascii() or len(text) > 40 or any(ord(char) < 32 or ord(char) > 126 for char in text):
        fail("symbol encoding changed")
    return text


def latest_eligible_points(
    prior: list[tuple[int, str]], symbol_ciks: dict[str, set[str]]
) -> list[tuple[int, str]]:
    """Filter for globally unique symbols before selecting the latest eligible date."""
    usable = [(point_day, symbol) for point_day, symbol in prior if len(symbol_ciks[symbol]) == 1]
    if not usable:
        return []
    latest_day = max(point_day for point_day, _ in usable)
    return [(point_day, symbol) for point_day, symbol in usable if point_day == latest_day]


def git_bytes(*args: str) -> bytes:
    run = subprocess.run(["git", *args], cwd=ROOT, capture_output=True)
    if run.returncode:
        fail("Git binding failed")
    return run.stdout


def git_text(*args: str) -> str:
    return git_bytes(*args).decode("utf-8").strip()


def git_blob(commit: str, path: Path) -> bytes:
    return git_bytes("show", f"{commit}:{path.relative_to(ROOT).as_posix()}")


def validate_contract(value: dict[str, Any]) -> None:
    exact_keys(value, {
        "schema", "createdAt", "taskId", "track", "purpose", "authoritativeInputs", "matchContract",
        "expectedRebuild", "disposition", "claimCeiling", "claimLocks", "privacyContract",
        "implementationContract", "contractSha256",
    }, "contract")
    if value["schema"] != "sec-form25-finra-exact-symbol-bridge-disposition-contract/v1":
        fail("contract schema changed")
    if value["taskId"] != "Q003-SEC-FORM25-FINRA-EXACT-SYMBOL-BRIDGE-DISPOSITION" or value["track"] != "SHARED_OUTCOME_BLIND_INFRA":
        fail("contract identity changed")
    if value["createdAt"] != EXPECTED_CREATED_AT:
        fail("contract timestamp changed")
    created = datetime.fromisoformat(value["createdAt"].replace("Z", "+00:00"))
    if created.tzinfo is None or created > datetime.now(timezone.utc):
        fail("contract time is invalid or future dated")
    if value["purpose"] != EXPECTED_PURPOSE:
        fail("purpose changed")
    if value["contractSha256"] != CONTRACT_SELF or self_hash(value, "contractSha256") != CONTRACT_SELF:
        fail("contract self hash changed")
    inputs = value["authoritativeInputs"]
    exact_keys(inputs, {"suspensionBoundary", "form345SymbolPoints", "finraPublicManifest", "finraPrivateCheckpoint"}, "inputs")
    if inputs["suspensionBoundary"] != {
        "path": BOUNDARY.relative_to(ROOT).as_posix(), "rawBytes": 31957128, "rawSha256": BOUNDARY_RAW,
        "reportSha256": BOUNDARY_SELF, "introductionCommit": BASE, "rows": 12727, "uniqueAccessions": 6366,
    }:
        fail("boundary input changed")
    if inputs["form345SymbolPoints"] != {
        "path": POINTS.relative_to(ROOT).as_posix(), "gzipBytes": 10805035, "gzipRawSha256": POINTS_GZIP_RAW,
        "decompressedBytes": 138658140, "decompressedRawSha256": POINTS_RAW, "reportSha256": POINTS_SELF,
        "introductionCommit": "036ba9e53623f47fe8ab0f3b926c5033b629dc2c", "gapRows": 656,
        "sourceTargetPoints": 164675, "outputObservationOccurrences": 181080,
        "placeholderObservationOccurrencesExcluded": 205, "uniqueIssuerCiks": 607,
    }:
        fail("Form345 point input changed")
    if inputs["finraPublicManifest"] != {
        "path": FINRA_MANIFEST.relative_to(ROOT).as_posix(), "rawSha256": FINRA_MANIFEST_RAW,
        "reportSha256": FINRA_MANIFEST_SELF, "introductionCommit": "8ad108bc6d135e313a001364deb4a87df643af0f",
        "rawRowsIncluded": False, "allRowsPrivate": True,
    }:
        fail("FINRA public manifest changed")
    if inputs["finraPrivateCheckpoint"] != {
        "path": CHECKPOINT.as_posix(), "rawBytes": 589706, "rawSha256": CHECKPOINT_RAW,
        "checkpointSha256": CHECKPOINT_SELF, "rowSequenceSha256": ROW_SEQUENCE, "partitionCount": 1522,
        "pageCount": 1556, "recordCount": 145103, "rawResponseBytes": 257639538,
        "availableMinimumDate": "2016-01-18", "availableMaximumDate": "2024-12-31", "rawRowsRemainPrivate": True,
    }:
        fail("FINRA private checkpoint changed")
    match = value["matchContract"]
    exact_keys(match, {
        "cikRule", "symbolRule", "pointDirection", "symbolUniqueness", "eventRule", "eventWindow",
        "primaryPointRule", "recentDiagnosticPointRule", "allHistoryPositiveControl", "descriptionMatchingAllowed",
        "commaSeparatedSymbolSplittingAllowed", "otcSuffixInferenceAllowed", "tickerOnlyIdentityResolutionAllowed",
    }, "match contract")
    expected_match = {
        "cikRule": "ASCII_DIGITS_STRIP_THEN_LEFT_PAD_TO_TEN_NO_OTHER_NORMALIZATION",
        "symbolRule": "ASCII_STRIP_UPPER_WHOLE_LITERAL_NO_SPLIT_NO_SUFFIX_NO_FUZZY_DESCRIPTION",
        "pointDirection": "SEC_POINT_FILING_DATE_ON_OR_BEFORE_SUSPENSION_BOUNDARY_DATE",
        "symbolUniqueness": "SYMBOL_MUST_MAP_TO_EXACTLY_ONE_CIK_ACROSS_BOUND_FORM345_POINTS",
        "eventRule": "EXACT_WHOLE_LITERAL_EQUALS_FINRA_OLD_OR_NEW_SYMBOL",
        "eventWindow": "ABSOLUTE_CALENDAR_DAYS_FROM_SUSPENSION_BOUNDARY_LE_365",
        "primaryPointRule": "LATEST_ELIGIBLE_PRE_BOUNDARY_POINT_DATE_ONLY",
        "recentDiagnosticPointRule": "ANY_ELIGIBLE_PRE_BOUNDARY_POINT_NOT_OLDER_THAN_365_DAYS",
        "allHistoryPositiveControl": "ANY_ELIGIBLE_PRE_BOUNDARY_POINT_WITHOUT_POINT_AGE_LIMIT",
        "descriptionMatchingAllowed": False, "commaSeparatedSymbolSplittingAllowed": False,
        "otcSuffixInferenceAllowed": False, "tickerOnlyIdentityResolutionAllowed": False,
    }
    if match != expected_match:
        fail("match semantics changed")
    rebuild = value["expectedRebuild"]
    exact_keys(rebuild, {
        "boundaryRows", "boundaryRowsInFinraCoverage", "boundaryUniqueCiksInFinraCoverage",
        "boundaryRowsWithPriorForm345Point", "primaryLatestPoint", "recentPointDiagnostic",
        "allHistoryPositiveControl", "finraRows", "finraUniqueSymbols",
        "form345PlaceholderObservationOccurrencesExcluded",
    }, "expected rebuild")
    if rebuild != {
        "boundaryRows": 12727, "boundaryRowsInFinraCoverage": 8246, "boundaryUniqueCiksInFinraCoverage": 1847,
        "boundaryRowsWithPriorForm345Point": 572, "primaryLatestPoint": EXPECTED_PRIMARY,
        "recentPointDiagnostic": EXPECTED_RECENT, "allHistoryPositiveControl": EXPECTED_ALL,
        "finraRows": 145103, "finraUniqueSymbols": 36145, "form345PlaceholderObservationOccurrencesExcluded": 205,
    }:
        fail("expected rebuild changed")
    disposition = value["disposition"]
    exact_keys(disposition, {"status", "studyCredit", "identityCapabilityClosed", "terminalCapabilityClosed", "laterOtcTradingExcluded", "reason", "futureRelaxationRequiresNewProtocol", "forbiddenRelaxations"}, "disposition")
    if disposition != {
        "status": "NO_GO_CURRENT_BOUND_SOURCES_FOR_TIMELY_EXACT_SYMBOL_BRIDGE", "studyCredit": "ZERO",
        "identityCapabilityClosed": False, "terminalCapabilityClosed": False, "laterOtcTradingExcluded": False,
        "reason": "BOTH_PRIMARY_LATEST_AND_RECENT_POINT_RULES_YIELD_ZERO_CANDIDATES_WHILE_THE_ALL_HISTORY_POSITIVE_CONTROL_ONLY_MATCHES_POINTS_3908_TO_5670_DAYS_OLD",
        "futureRelaxationRequiresNewProtocol": True,
        "forbiddenRelaxations": ["DESCRIPTION_FUZZY_MATCH", "COMMA_SPLIT_WITHOUT_SOURCE_CONTRACT", "OTC_SUFFIX_GUESS", "STALE_TICKER_IDENTITY_PROMOTION", "ZERO_MATCH_INTERPRETED_AS_NO_LATER_OTC_TRADING"],
    }:
        fail("disposition changed")
    ceiling = value["claimCeiling"]
    exact_keys(ceiling, {"allowed", "forbidden"}, "claim ceiling")
    if ceiling["allowed"] != ["BOUND_SOURCE_DENOMINATORS", "EXACT_RULE_ZERO_CANDIDATE_DISPOSITION", "TEMPORALLY_STALE_ALL_HISTORY_POSITIVE_CONTROL_COUNTS"]:
        fail("allowed claims changed")
    if set(ceiling["forbidden"]) != {"SECURITY_IDENTITY_RESOLVED", "LISTING_IDENTITY_RESOLVED", "NO_LATER_OTC_TRADING", "LAST_CONSOLIDATED_SESSION", "LAST_TRADE_PRICE", "TERMINAL_PAYMENT", "TERMINAL_WEALTH", "PRICE_RETURN_OR_OUTCOME", "ORIGINAL_V4_GATE_CREDIT"}:
        fail("forbidden claims changed")
    if value["claimLocks"] != EXPECTED_LOCKS:
        fail("claim locks changed")
    if value["privacyContract"] != {"privateRowsPrinted": False, "privateRowsWritten": False, "publicOutputCreated": False, "aggregateCountsOnly": True}:
        fail("privacy contract changed")
    implementation = value["implementationContract"]
    exact_keys(implementation, {"baseCommit", "remote", "ref", "contractPath", "verifierPath", "testPath", "verifierNormalizedSha256", "testRawSha256", "introductionMustBeDirectSingleParentChildOfBase", "introductionAddsExactlyThreeOwnedPaths", "linearSingleParentDescendantsAllowed", "remoteVerificationRequired", "noRemoteVerificationMustFail", "writeCapabilityAllowed"}, "implementation")
    if implementation["baseCommit"] != BASE or implementation["remote"] != REMOTE or implementation["ref"] != REMOTE_REF:
        fail("implementation base or remote changed")
    if [implementation["contractPath"], implementation["verifierPath"], implementation["testPath"]] != [item.relative_to(ROOT).as_posix() for item in OWNED]:
        fail("owned paths changed")
    for key in ("introductionMustBeDirectSingleParentChildOfBase", "introductionAddsExactlyThreeOwnedPaths", "linearSingleParentDescendantsAllowed", "remoteVerificationRequired", "noRemoteVerificationMustFail"):
        if implementation[key] is not True:
            fail("implementation gate weakened")
    if implementation["writeCapabilityAllowed"] is not False:
        fail("write capability enabled")
    if HEX64.fullmatch(implementation["verifierNormalizedSha256"]) is None or HEX64.fullmatch(implementation["testRawSha256"]) is None:
        fail("owned hash malformed")


def load_contract() -> dict[str, Any]:
    raw = CONTRACT.read_bytes()
    if sha(raw) != CONTRACT_RAW:
        fail("contract raw bytes changed")
    value = json.loads(raw)
    validate_contract(value)
    if sha(normalized_verifier(VERIFIER.read_bytes())) != value["implementationContract"]["verifierNormalizedSha256"]:
        fail("verifier normalized bytes changed")
    if sha(TEST.read_bytes()) != value["implementationContract"]["testRawSha256"]:
        fail("test bytes changed")
    return value


def load_public_inputs() -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    boundary_raw = BOUNDARY.read_bytes()
    if len(boundary_raw) != 31957128 or sha(boundary_raw) != BOUNDARY_RAW:
        fail("boundary raw bytes changed")
    boundary = json.loads(boundary_raw)
    if boundary.get("reportSha256") != BOUNDARY_SELF or self_hash(boundary, "reportSha256") != BOUNDARY_SELF:
        fail("boundary self hash changed")
    rows = boundary.get("rows")
    if type(rows) is not list or len(rows) != 12727 or boundary.get("population", {}).get("uniqueAccessions") != 6366:
        fail("boundary denominator changed")
    gzip_raw = POINTS.read_bytes()
    if len(gzip_raw) != 10805035 or sha(gzip_raw) != POINTS_GZIP_RAW:
        fail("Form345 gzip bytes changed")
    point_raw = gzip.decompress(gzip_raw)
    if len(point_raw) != 138658140 or sha(point_raw) != POINTS_RAW:
        fail("Form345 decompressed bytes changed")
    points = json.loads(point_raw)
    if points.get("reportSha256") != POINTS_SELF or self_hash(points, "reportSha256") != POINTS_SELF:
        fail("Form345 self hash changed")
    if points.get("population") != {
        "gapRows": 656, "gapRowsWithMissingIssuerNamePoint": 17, "issuerNameMissingAllRows": 1188,
        "issuerNameMissingTargetPoints": 23, "issuerNamePresentAllRows": 3350815,
        "issuerNamePresentTargetPoints": 164652, "rowsWithPointEvidence": 595, "rowsWithoutPointEvidence": 61,
        "sourceAllRows": 3352003, "sourceTargetPoints": 164675, "uniqueIssuerCiks": 607,
    }:
        fail("Form345 population changed")
    point_rows = points.get("rows")
    if type(point_rows) is not list or len(point_rows) != 656 or sum(len(row.get("observations", [])) for row in point_rows) != 181080:
        fail("Form345 observation denominator changed")
    manifest_raw = FINRA_MANIFEST.read_bytes()
    if sha(manifest_raw) != FINRA_MANIFEST_RAW:
        fail("FINRA manifest raw bytes changed")
    manifest = json.loads(manifest_raw)
    if manifest.get("reportSha256") != FINRA_MANIFEST_SELF or self_hash(manifest, "reportSha256") != FINRA_MANIFEST_SELF:
        fail("FINRA manifest self hash changed")
    if manifest.get("capture") != {
        "allRowsPrivate": True, "checkpointSha256": CHECKPOINT_SELF, "identifiersIncluded": False,
        "pageCount": 1556, "rawResponseBytes": 257639538, "rawRowsIncluded": False,
        "recordCount": 145103, "rowSequenceSha256": ROW_SEQUENCE, "uniqueIdentifierCount": 145103,
    }:
        fail("FINRA manifest capture changed")
    return rows, point_rows


def load_checkpoint() -> dict[str, Any]:
    raw = CHECKPOINT.read_bytes()
    if len(raw) != 589706 or sha(raw) != CHECKPOINT_RAW:
        fail("FINRA checkpoint raw bytes changed")
    value = json.loads(raw)
    if value.get("checkpointSha256") != CHECKPOINT_SELF or self_hash(value, "checkpointSha256") != CHECKPOINT_SELF:
        fail("FINRA checkpoint self hash changed")
    if value.get("outcomesAccessed") is not False or value.get("totalRows") != 145103 or value.get("totalResponseBytes") != 257639538:
        fail("FINRA checkpoint boundary changed")
    completed = value.get("completed")
    if type(completed) is not list or len(completed) != 1522 or sum(len(item.get("pages", [])) for item in completed) != 1556:
        fail("FINRA checkpoint partition denominator changed")
    return value


def build_point_index(point_rows: list[dict[str, Any]]) -> tuple[dict[str, list[tuple[int, str]]], dict[str, set[str]], int]:
    cells: set[tuple[str, int, str]] = set()
    placeholder_occurrences = 0
    for row in point_rows:
        cik = canonical_cik(row["issuerCik"])
        for observation in row["observations"]:
            if canonical_cik(observation["issuerCik"]) != cik:
                fail("Form345 row/observation CIK changed")
            symbol = normalized_symbol(observation["issuerTradingSymbol"])
            if symbol is None:
                placeholder_occurrences += 1
                continue
            cells.add((cik, date.fromisoformat(observation["filingDate"]).toordinal(), symbol))
    by_cik: dict[str, list[tuple[int, str]]] = defaultdict(list)
    symbol_ciks: dict[str, set[str]] = defaultdict(set)
    for cik, ordinal, symbol in cells:
        by_cik[cik].append((ordinal, symbol))
        symbol_ciks[symbol].add(cik)
    for values in by_cik.values():
        values.sort()
    if placeholder_occurrences != 205:
        fail("Form345 placeholder observation denominator changed")
    return by_cik, symbol_ciks, placeholder_occurrences


def build_finra_index(checkpoint: dict[str, Any]) -> tuple[dict[str, dict[int, tuple[int, str | None]]], dict[str, Any]]:
    index: dict[str, dict[int, tuple[int, str | None]]] = defaultdict(dict)
    sequence = hashlib.sha256()
    identifiers: set[int] = set()
    rows_seen = 0
    bytes_seen = 0
    for partition in checkpoint["completed"]:
        day = partition.get("calendarDay")
        expected_offset = 0
        for page in partition.get("pages", []):
            if page.get("offset") != expected_offset:
                fail("FINRA page order changed")
            raw_claim = page.get("rawSha256")
            if type(raw_claim) is not str or HEX64.fullmatch(raw_claim) is None:
                fail("FINRA page hash malformed")
            path = PRIVATE / "blobs" / "sha256" / raw_claim[:2] / raw_claim
            raw = path.read_bytes()
            if sha(raw) != raw_claim or len(raw) != page.get("bytes"):
                fail("FINRA private blob changed")
            rows = json.loads(raw)
            if type(rows) is not list or len(rows) != page.get("rowCount"):
                fail("FINRA page row count changed")
            for source in rows:
                if type(source) is not dict or source.get("calendarDay") != day:
                    fail("FINRA source row changed")
                identifier = source.get("OTCDailyListID")
                if type(identifier) is not int or identifier in identifiers:
                    fail("FINRA source identifier changed")
                identifiers.add(identifier)
                sequence.update(canonical(source))
                sequence.update(b"\n")
                ordinal = date.fromisoformat(day[:10]).toordinal()
                for field in ("oldSymbolCode", "newSymbolCode"):
                    symbol = normalized_symbol(source.get(field))
                    if symbol is not None:
                        current = index[symbol].get(identifier)
                        candidate = (ordinal, source.get("dailyListEventCode"))
                        if current is not None and current != candidate:
                            fail("FINRA duplicate symbol/event changed")
                        index[symbol][identifier] = candidate
            expected_offset += len(rows)
            rows_seen += len(rows)
            bytes_seen += len(raw)
        if expected_offset != partition.get("recordTotal"):
            fail("FINRA partition total changed")
    if rows_seen != 145103 or bytes_seen != 257639538 or len(identifiers) != 145103 or sequence.hexdigest() != ROW_SEQUENCE:
        fail("FINRA full private rebuild changed")
    return index, {"finraRows": rows_seen, "finraUniqueSymbols": len(index), "rowSequenceSha256": sequence.hexdigest()}


def summarize(cells: list[tuple[str, int, int, str]], finra: dict[str, dict[int, tuple[int, str | None]]], include_age: bool) -> dict[str, Any]:
    pairs: set[tuple[str, int, str, int, int, str | None]] = set()
    for boundary_id, boundary_day, point_day, symbol in cells:
        for identifier, (event_day, event_code) in finra.get(symbol, {}).items():
            if abs(event_day - boundary_day) <= 365:
                pairs.add((boundary_id, point_day, symbol, identifier, event_day, event_code))
    summary: dict[str, Any] = {
        "cells": len(cells), "boundaries": len({item[0] for item in cells}), "symbols": len({item[3] for item in cells}),
        "finraUniverseSymbolOverlap": len({item[3] for item in cells} & set(finra)), "candidatePairs": len(pairs),
        "candidateBoundaries": len({item[0] for item in pairs}), "candidateEvents": len({item[3] for item in pairs}),
    }
    if include_age:
        ages = []
        cell_ages = {(boundary_id, point_day, symbol): boundary_day - point_day for boundary_id, boundary_day, point_day, symbol in cells}
        for boundary_id, point_day, symbol, _identifier, _event_day, _code in pairs:
            ages.append(cell_ages[(boundary_id, point_day, symbol)])
        summary.update({
            "minimumPointAgeDays": min(ages) if ages else None, "maximumPointAgeDays": max(ages) if ages else None,
            "eventCodePairCounts": dict(sorted(Counter(str(item[5]) for item in pairs).items())),
        })
    return summary


def rebuild() -> dict[str, Any]:
    boundary_rows, point_rows = load_public_inputs()
    checkpoint = load_checkpoint()
    by_cik, symbol_ciks, placeholder_occurrences = build_point_index(point_rows)
    finra, finra_stats = build_finra_index(checkpoint)
    minimum = date(2016, 1, 18).toordinal()
    maximum = date(2024, 12, 31).toordinal()
    covered: list[dict[str, Any]] = []
    with_prior = 0
    primary: list[tuple[str, int, int, str]] = []
    recent: list[tuple[str, int, int, str]] = []
    all_history: list[tuple[str, int, int, str]] = []
    for row in boundary_rows:
        boundary_day = date.fromisoformat(row["suspensionBoundaryDate"]).toordinal()
        if not minimum <= boundary_day <= maximum:
            continue
        covered.append(row)
        points = by_cik.get(canonical_cik(row["issuerCik"]), [])
        right = bisect.bisect_right(points, (boundary_day, chr(0x10FFFF)))
        prior = points[:right]
        if not prior:
            continue
        with_prior += 1
        usable = [(point_day, symbol) for point_day, symbol in prior if len(symbol_ciks[symbol]) == 1]
        primary_points = latest_eligible_points(prior, symbol_ciks)
        boundary_id = row["boundaryId"]
        for point_day, symbol in usable:
            cell = (boundary_id, boundary_day, point_day, symbol)
            all_history.append(cell)
            if boundary_day - point_day <= 365:
                recent.append(cell)
        for point_day, symbol in primary_points:
            primary.append((boundary_id, boundary_day, point_day, symbol))
    for values in (primary, recent, all_history):
        values.sort()
    result = {
        "boundaryRows": len(boundary_rows), "boundaryRowsInFinraCoverage": len(covered),
        "boundaryUniqueCiksInFinraCoverage": len({canonical_cik(row["issuerCik"]) for row in covered}),
        "boundaryRowsWithPriorForm345Point": with_prior,
        "primaryLatestPoint": summarize(primary, finra, False),
        "recentPointDiagnostic": summarize(recent, finra, False),
        "allHistoryPositiveControl": summarize(all_history, finra, True),
        "finraRows": finra_stats["finraRows"], "finraUniqueSymbols": finra_stats["finraUniqueSymbols"],
        "form345PlaceholderObservationOccurrencesExcluded": placeholder_occurrences,
    }
    return result


def validate_rebuild(value: dict[str, Any], contract: dict[str, Any]) -> None:
    if value != contract["expectedRebuild"]:
        fail("source-derived rebuild differs from contract")
    if value["primaryLatestPoint"]["candidatePairs"] != 0 or value["recentPointDiagnostic"]["candidatePairs"] != 0:
        fail("timely exact-symbol zero disposition changed")
    control = value["allHistoryPositiveControl"]
    if control["candidatePairs"] <= 0 or control["minimumPointAgeDays"] <= 365:
        fail("all-history positive control no longer isolates stale evidence")


def introduced_once(path: Path) -> list[str]:
    relative = path.relative_to(ROOT).as_posix()
    output = git_text("log", "--reverse", "--format=%H", "--diff-filter=A", f"{BASE}..HEAD", "--", relative)
    return [line for line in output.splitlines() if line]


def verify_repository(contract: dict[str, Any], remote_required: bool) -> dict[str, Any]:
    if not remote_required:
        fail("live remote verification is mandatory")
    if git_text("remote", "get-url", "origin") != REMOTE:
        fail("origin URL changed")
    head = git_text("rev-parse", "HEAD")
    if git_text("rev-parse", "@{u}") != head:
        fail("HEAD and upstream differ")
    live = git_text("ls-remote", "--refs", "origin", REMOTE_REF).split()
    if len(live) != 2 or live != [head, REMOTE_REF]:
        fail("live remote differs")
    for path, expected_commit in ((BOUNDARY, BASE), (POINTS, "036ba9e53623f47fe8ab0f3b926c5033b629dc2c"), (FINRA_MANIFEST, "8ad108bc6d135e313a001364deb4a87df643af0f")):
        if git_blob(expected_commit, path) != path.read_bytes() or git_blob(head, path) != path.read_bytes():
            fail("input Git bytes changed")
    introductions = [introduced_once(path) for path in OWNED]
    if all(not values for values in introductions):
        if head != BASE:
            fail("pre-introduction HEAD moved beyond sealed base")
        return {"phase": "PRE_INTRODUCTION", "introductionCommit": None, "remoteVerified": True, "ownedGitBytesBound": 0}
    if any(len(values) != 1 for values in introductions) or len({values[0] for values in introductions}) != 1:
        fail("owned paths were not introduced together exactly once")
    introduction = introductions[0][0]
    if COMMIT40.fullmatch(introduction) is None or git_text("show", "-s", "--format=%P", introduction).split() != [BASE]:
        fail("introduction is not direct single-parent child of base")
    changed = git_text("diff-tree", "--no-commit-id", "--name-status", "-r", introduction).splitlines()
    expected = [f"A\t{path.relative_to(ROOT).as_posix()}" for path in OWNED]
    if changed != expected:
        fail("introduction does not add exactly owned paths")
    if subprocess.run(["git", "merge-base", "--is-ancestor", introduction, head], cwd=ROOT).returncode:
        fail("introduction is not ancestor of HEAD")
    chain = git_text("rev-list", "--reverse", "--first-parent", f"{introduction}..{head}").splitlines()
    previous = introduction
    for commit in chain:
        if git_text("show", "-s", "--format=%P", commit).split() != [previous]:
            fail("post-introduction history is not linear single-parent")
        previous = commit
    for path in OWNED:
        raw = path.read_bytes()
        if git_blob(introduction, path) != raw or git_blob(head, path) != raw:
            fail("owned local/introduction/HEAD bytes changed")
    return {"phase": "POST_INTRODUCTION", "introductionCommit": introduction, "remoteVerified": True, "ownedGitBytesBound": 3}


def reseal(value: dict[str, Any]) -> dict[str, Any]:
    item = copy.deepcopy(value)
    item["contractSha256"] = self_hash(item, "contractSha256")
    return item


def rejected(action: Callable[[], None]) -> bool:
    try:
        action()
    except (DispositionError, KeyError, TypeError, ValueError, OSError, json.JSONDecodeError):
        return True
    return False


def self_test(contract: dict[str, Any]) -> dict[str, Any]:
    kills: dict[str, bool] = {}
    mutations: dict[str, Callable[[dict[str, Any]], None]] = {
        "timestampBackdated": lambda item: item.__setitem__("createdAt", "1970-01-01T00:00:00Z"),
        "timestampNonZulu": lambda item: item.__setitem__("createdAt", "2026-08-13T06:06:14+00:00"),
        "purposeOverclaim": lambda item: item.__setitem__("purpose", "identity and terminal wealth resolved"),
        "descriptionMatchEnabled": lambda item: item["matchContract"].__setitem__("descriptionMatchingAllowed", True),
        "commaSplitEnabled": lambda item: item["matchContract"].__setitem__("commaSeparatedSymbolSplittingAllowed", True),
        "suffixInferenceEnabled": lambda item: item["matchContract"].__setitem__("otcSuffixInferenceAllowed", True),
        "latestCandidateInvented": lambda item: item["expectedRebuild"]["primaryLatestPoint"].__setitem__("candidatePairs", 1),
        "recentCandidateInvented": lambda item: item["expectedRebuild"]["recentPointDiagnostic"].__setitem__("candidatePairs", 1),
        "positiveControlRemoved": lambda item: item["expectedRebuild"]["allHistoryPositiveControl"].__setitem__("candidatePairs", 0),
        "staleEvidencePromoted": lambda item: item["disposition"].__setitem__("studyCredit", "POSITIVE"),
        "identityPromoted": lambda item: item["claimLocks"].__setitem__("securityIdentityResolved", True),
        "laterOtcExcluded": lambda item: item["claimLocks"].__setitem__("laterOtcTradingExcluded", True),
        "terminalWealthPromoted": lambda item: item["claimLocks"].__setitem__("terminalWealthComplete", True),
        "outcomesAccessed": lambda item: item["claimLocks"].__setitem__("outcomesAccessed", True),
        "privateRowsPrinted": lambda item: item["privacyContract"].__setitem__("privateRowsPrinted", True),
        "writeCapabilityEnabled": lambda item: item["implementationContract"].__setitem__("writeCapabilityAllowed", True),
        "remoteOptional": lambda item: item["implementationContract"].__setitem__("remoteVerificationRequired", False),
        "unknownClaimLock": lambda item: item["claimLocks"].__setitem__("unknownScientificCredit", True),
    }
    for name, mutate in mutations.items():
        item = copy.deepcopy(contract)
        mutate(item)
        item = reseal(item)
        kills[name] = rejected(lambda item=item: validate_contract(item))
    kills.update({
        "wholeLiteralPreserved": normalized_symbol(" PLA, PLAA ") == "PLA, PLAA",
        "noSuffixInference": normalized_symbol("ABC") != normalized_symbol("ABCQ"),
        "asciiCaseNormalizationOnly": normalized_symbol(" ab.c ") == "AB.C",
        "placeholderRejected": normalized_symbol("N/A") is None,
        "CIKZeroPadOnly": canonical_cik("65100") == "0000065100",
        "latestAfterUniquenessFilter": latest_eligible_points(
            [(10, "UNIQUE"), (11, "AMBIGUOUS")],
            {"UNIQUE": {"0000000001"}, "AMBIGUOUS": {"0000000001", "0000000002"}},
        ) == [(10, "UNIQUE")],
    })
    if not all(kills.values()):
        fail("self-test kill failed")
    return {
        "schema": "sec-form25-finra-exact-symbol-bridge-disposition-self-test/v1", "status": "PASS",
        "mutationKills": kills, "studyCredit": "ZERO", "privateRowsPrinted": False,
        "privateRowsWritten": False, "outcomesAccessed": False,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=("verify-contract", "self-test", "verify"))
    parser.add_argument("--remote", action="store_true")
    args = parser.parse_args()
    try:
        contract = load_contract()
        repository = verify_repository(contract, args.remote)
        if args.command == "verify-contract":
            result = {
                "schema": "sec-form25-finra-exact-symbol-bridge-disposition-contract-verification/v1",
                "status": "PASS", **repository, "studyCredit": "ZERO", "outcomesAccessed": False,
            }
        elif args.command == "self-test":
            result = {**self_test(contract), **repository}
        else:
            rebuilt = rebuild()
            validate_rebuild(rebuilt, contract)
            result = {
                "schema": "sec-form25-finra-exact-symbol-bridge-disposition-verification/v1", "status": "PASS",
                **repository, "disposition": contract["disposition"]["status"], "studyCredit": "ZERO",
                "rebuild": rebuilt, "privateRowsPrinted": False, "privateRowsWritten": False,
                "publicOutputCreated": False, "pricesAccessed": False, "returnsAccessed": False,
                "outcomesAccessed": False,
            }
    except (DispositionError, KeyError, TypeError, ValueError, OSError, json.JSONDecodeError, gzip.BadGzipFile) as exc:
        parser.error(str(exc))
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
"""Verify the aggregate-only SEC Form-25 to FINRA exact-description disposition."""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import re
import subprocess
import unicodedata
from collections import Counter, defaultdict
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Callable


ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "research" / "early-detection-v4" / "sec-form25-finra-exact-description-bridge-disposition-contract-v1.json"
VERIFIER = Path(__file__).resolve()
TEST = ROOT / "tests" / "verify-sec-form25-finra-exact-description-bridge-disposition-v1.test.js"
BOUNDARY = ROOT / "reports" / "early-detection" / "sec-form25-suspension-boundary-v2.json"
ROLE_CONTRACT = ROOT / "research" / "early-detection-v4" / "sec-form25-suspension-boundary-role-reconciliation-contract-v1.json"
ROLE_BUILDER = ROOT / "scripts" / "build-sec-form25-suspension-boundary-role-reconciliation-v1.py"
ROLE_TEST = ROOT / "tests" / "build-sec-form25-suspension-boundary-role-reconciliation-v1.test.js"
FINRA_MANIFEST = ROOT / "reports" / "early-detection" / "finra-q004-historical-crawl-manifest-v3.json"
PRIVATE = Path(r"C:\Users\Anwender\Documents\GrowthScreenerResearchData\private-evidence\finra-q004\historical")
CHECKPOINT = PRIVATE / "checkpoint-v2.json"

CONTRACT_RAW = "7f74d85e8112fedc4181a936da09ae909f6c80564803076fb8e704e76c0c74e4"
CONTRACT_SELF = "5580ec21655c0e3ac5b61aa70635d919771f95f02c95f8de5c8e1629368ecaa9"
BASE = "f5925ae8b5735f8119f3098ef5fdfe89628041b6"
REMOTE = "https://github.com/Karlryl/screener-data.git"
REMOTE_REF = "refs/heads/codex/early-detection-v4-gates-20260810"
BOUNDARY_RAW = "4e9b33086ff6120de04110deb1e6e3916d2ca5001384729bbc28b273efd8735f"
BOUNDARY_SELF = "99199da6cf5b9c4ffc7416c5e97dc4fd9f6300ba3e7c731b123c11fa4c030345"
ROLE_CONTRACT_RAW = "ad858bb73cc1c727916b5bb66848a164a429c814f84b24a8ea0209dd06888f98"
ROLE_BUILDER_RAW = "d8189abdd7d0e0c4d767df525c9ea4c1049a77f7a2fbed0d548a11643cfed381"
ROLE_TEST_RAW = "9d3e1c96392e8bd3e7385c69e3e1d3acab27062cab83929fa6406759ffa10041"
ROLE_INTRODUCTION = "9705c9814fe8410401f5ec0d808b9424689f639e"
FINRA_MANIFEST_RAW = "2f266d063d5c05df53d635afcb922d0775d0345005869955b41fece3b9502580"
FINRA_MANIFEST_SELF = "caff5b9863516992222f9b58690cfad31df700441eeaf2fe3c41b356e641a09f"
FINRA_MANIFEST_INTRODUCTION = "8ad108bc6d135e313a001364deb4a87df643af0f"
CHECKPOINT_RAW = "7dd6a000e72b5219d00f25d98540fca3c6ab4f0a0b9527498656d4d2e9a2cc9c"
CHECKPOINT_SELF = "37b68644f955d046bc97885d6dde4014acbcc04fa8acc3945712b204ee58e5ad"
ROW_SEQUENCE = "2e2aa926ce60a632942fe87e53fada22e0373108e04d2e5e5591727dad383c4a"
HEX64 = re.compile(r"[0-9a-f]{64}\Z")
COMMIT40 = re.compile(r"[0-9a-f]{40}\Z")
OWNED = (CONTRACT, VERIFIER, TEST)

EXPECTED_CREATED_AT = "2026-08-13T12:03:17Z"
EXPECTED_PURPOSE = (
    "Determine reproducibly whether an exact normalized concatenation of the primary SEC Form-25 issuer "
    "name plus security description matches a private FINRA OTC Daily List old or new security description "
    "during the first 120 calendar days after the suspension boundary; require a unique FINRA event per SEC "
    "suspension event before any bridge candidate could exist; preserve all ambiguous exact matches; and grant "
    "no entity, security, listing, interval, later-OTC, terminal-wealth, price, return, outcome or Original-V4 credit."
)
EXPECTED_MATCH = {
    "secEventUnit": "EXACT_ACCESSION_WITH_ONE_SOURCE_DERIVED_SUSPENSION_EVENT_PROVENANCE",
    "secDescription": "NORMALIZED_ISSUER_NAME_SINGLE_SPACE_NORMALIZED_SECURITY_DESCRIPTION",
    "finraDescriptionFields": ["oldSecurityDescription", "newSecurityDescription"],
    "normalization": "UNICODE_NFKD_ASCII_UPPERCASE_AMPERSAND_TO_AND_ALNUM_TOKENS_SINGLE_SPACES",
    "comparison": "EXACT_FULL_CANONICAL_STRING_EQUALITY",
    "primaryWindow": "ZERO_TO_ONE_HUNDRED_TWENTY_CALENDAR_DAYS_AFTER_SUSPENSION_INCLUSIVE",
    "sameFinraEventMatchedOnBothSidesCountsOnce": True,
    "uniqueBridgeCandidateRequiresExactlyOneFinraEventForSecEvent": True,
    "issuerNameOnlyMatchingAllowed": False,
    "tokenIntersectionMatchingAllowed": False,
    "prefixMatchingAllowed": False,
    "substringMatchingAllowed": False,
    "fuzzyMatchingAllowed": False,
    "symbolMatchingAllowed": False,
    "caseOnlyRawEqualityClaimed": False,
}
EXPECTED_LOCKS = {
    "candidateRowsPromoted": False, "entityIdentityResolved": False,
    "securityIdentityResolved": False, "listingIdentityResolved": False,
    "historicalIntervalComplete": False, "laterOtcTradingExcluded": False,
    "lastConsolidatedSessionObserved": False, "lastTradePriceObserved": False,
    "terminalPaymentVerified": False, "terminalWealthComplete": False,
    "originalV4GateCredit": False, "resultComputationAllowed": False,
    "pricesAccessed": False, "returnsAccessed": False, "outcomesAccessed": False,
}
EXPECTED_PRIVACY = {
    "privateFinraRowsMayBeReadForSourceRebuild": True, "privateRowsPrinted": False,
    "privateRowsWritten": False, "privateDescriptionsPrinted": False,
    "publicOutputCreated": False, "aggregateCountsOnly": True,
}
EXPECTED_REBUILD = {
    "boundaryRoleProjectionRows": 12727, "uniqueSuspensionEvents": 6366,
    "modernDescriptorEvents": 6361, "legacyDescriptorUnavailableEventsExcluded": 5,
    "finraPartitions": 1522, "finraPages": 1556, "finraRows": 145103,
    "finraResponseBytes": 257639538, "finraCanonicalDescriptions": 39492,
    "primaryPost120": {
        "candidatePairs": 2, "candidateSecEvents": 1, "candidateFinraEvents": 2,
        "secEventsWithExactlyOneFinraEvent": 0, "minimumCalendarDayDelta": 0,
        "maximumCalendarDayDelta": 0, "finraDescriptionSideCounts": {"OLD": 2},
        "eventCodeCounts": {"SA": 1, "SD": 1},
    },
    "absolute120Diagnostic": {
        "candidatePairs": 5, "candidateSecEvents": 2, "candidateFinraEvents": 5,
        "secEventsWithExactlyOneFinraEvent": 0, "minimumCalendarDayDelta": -64,
        "maximumCalendarDayDelta": 0, "finraDescriptionSideCounts": {"OLD": 5},
        "eventCodeCounts": {"SA": 2, "SD": 3},
    },
    "allHistoryPositiveControl": {
        "candidatePairs": 34, "candidateSecEvents": 11, "candidateFinraEvents": 34,
        "secEventsWithExactlyOneFinraEvent": 1, "minimumCalendarDayDelta": -2080,
        "maximumCalendarDayDelta": 3761,
        "finraDescriptionSideCounts": {"NEW": 2, "NEW+OLD": 13, "OLD": 19},
        "eventCodeCounts": {"DA": 4, "NONE": 2, "SA": 7, "SC": 9, "SD": 12},
    },
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
        text = expression.sub(f'{name} = "{"0" * 64}"', text)
    return text.encode("utf-8")


def normalized_description(value: Any) -> str | None:
    if value is None:
        return None
    if type(value) is not str:
        fail("description type changed")
    text = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode("ascii")
    text = text.upper().replace("&", " AND ")
    tokens = re.findall(r"[A-Z0-9]+", text)
    return " ".join(tokens) or None


def expected_inputs() -> dict[str, Any]:
    return {
        "suspensionBoundary": {
            "path": "reports/early-detection/sec-form25-suspension-boundary-v2.json",
            "rawSha256": BOUNDARY_RAW, "reportSha256": BOUNDARY_SELF,
            "introductionCommit": "609f37df9e9c277323c5c8e24d6accfa3d1f3ea7",
            "roleProjectionRows": 12727, "uniqueSuspensionEvents": 6366,
        },
        "roleReconciliation": {
            "contractPath": "research/early-detection-v4/sec-form25-suspension-boundary-role-reconciliation-contract-v1.json",
            "contractRawSha256": ROLE_CONTRACT_RAW,
            "contractSha256": "a1f49ecca0f53fe5e5343e77ed5d073b962181ee59dc4856cbdfaa2a3407f68e",
            "builderPath": "scripts/build-sec-form25-suspension-boundary-role-reconciliation-v1.py",
            "builderRawSha256": ROLE_BUILDER_RAW,
            "testPath": "tests/build-sec-form25-suspension-boundary-role-reconciliation-v1.test.js",
            "testRawSha256": ROLE_TEST_RAW, "introductionCommit": ROLE_INTRODUCTION,
        },
        "finraManifest": {
            "path": "reports/early-detection/finra-q004-historical-crawl-manifest-v3.json",
            "rawSha256": FINRA_MANIFEST_RAW, "reportSha256": FINRA_MANIFEST_SELF,
            "introductionCommit": FINRA_MANIFEST_INTRODUCTION,
        },
        "privateFinraCheckpoint": {
            "logicalPath": "finra-q004/historical/checkpoint-v2.json", "rawSha256": CHECKPOINT_RAW,
            "checkpointSha256": CHECKPOINT_SELF, "rowSequenceSha256": ROW_SEQUENCE,
            "partitions": 1522, "pages": 1556, "rows": 145103, "responseBytes": 257639538,
        },
    }


def expected_disposition() -> dict[str, Any]:
    return {
        "status": "NO_GO_CURRENT_BOUND_SOURCES_FOR_UNIQUE_POST_SUSPENSION_EXACT_DESCRIPTION_BRIDGE",
        "studyCredit": "ZERO",
        "reason": (
            "The primary exact full-description rule produces two distinct FINRA events for the same SEC "
            "suspension event and therefore zero uniquely linked SEC events. Weaker name, token, prefix, "
            "substring, fuzzy or symbol rules are outside this contract and cannot receive credit."
        ),
        "futureRelaxationRequiresNewProtocol": True,
    }


def expected_implementation(value: dict[str, Any]) -> dict[str, Any]:
    return {
        "baseCommit": BASE, "baseTag": 890, "remote": REMOTE, "ref": REMOTE_REF,
        "contractPath": CONTRACT.relative_to(ROOT).as_posix(),
        "verifierPath": VERIFIER.relative_to(ROOT).as_posix(), "testPath": TEST.relative_to(ROOT).as_posix(),
        "verifierNormalizedSha256": value.get("verifierNormalizedSha256"),
        "testRawSha256": value.get("testRawSha256"),
        "introductionMustBeDirectSingleParentChildOfBase": True,
        "introductionAddsExactlyThreeOwnedPaths": True,
        "laterLinearSingleParentDescendantsAllowed": True,
        "remoteVerificationRequired": True, "noRemoteVerificationMustFail": True,
        "writeCapabilityAllowed": False,
    }


def validate_contract(value: dict[str, Any]) -> None:
    exact_keys(value, {
        "schema", "createdAt", "taskId", "track", "purpose", "authoritativeInputs", "matchContract",
        "expectedRebuild", "disposition", "claimCeiling", "claimLocks", "privacyContract",
        "implementationContract", "contractSha256",
    }, "contract")
    if value["schema"] != "sec-form25-finra-exact-description-bridge-disposition-contract/v1":
        fail("contract schema changed")
    if value["taskId"] != "Q003-SEC-FORM25-FINRA-EXACT-DESCRIPTION-BRIDGE-DISPOSITION" or value["track"] != "SHARED_OUTCOME_BLIND_INFRA":
        fail("contract identity changed")
    if value["createdAt"] != EXPECTED_CREATED_AT or not value["createdAt"].endswith("Z"):
        fail("contract timestamp changed")
    created = datetime.fromisoformat(value["createdAt"].replace("Z", "+00:00"))
    if created.tzinfo is None or created > datetime.now(timezone.utc):
        fail("contract timestamp is invalid")
    if value["purpose"] != EXPECTED_PURPOSE or value["authoritativeInputs"] != expected_inputs():
        fail("contract purpose or inputs changed")
    if value["matchContract"] != EXPECTED_MATCH or value["expectedRebuild"] != EXPECTED_REBUILD:
        fail("match or expected rebuild changed")
    if value["disposition"] != expected_disposition():
        fail("disposition changed")
    if value["claimCeiling"] != "AGGREGATE_ONLY_EXACT_NORMALIZED_DESCRIPTION_MATCH_DISPOSITION_WITH_ZERO_UNIQUE_POST_SUSPENSION_BRIDGE_CANDIDATES":
        fail("claim ceiling changed")
    if value["claimLocks"] != EXPECTED_LOCKS or value["privacyContract"] != EXPECTED_PRIVACY:
        fail("claim or privacy locks changed")
    implementation = value["implementationContract"]
    exact_keys(implementation, set(expected_implementation(implementation)), "implementation")
    if implementation != expected_implementation(implementation):
        fail("implementation contract changed")
    if implementation["verifierNormalizedSha256"] != sha(normalized_verifier(VERIFIER.read_bytes())):
        fail("verifier normalized bytes changed")
    if implementation["testRawSha256"] != sha(TEST.read_bytes()):
        fail("test raw bytes changed")
    if value["contractSha256"] != self_hash(value, "contractSha256"):
        fail("contract self hash changed")


def load_contract() -> dict[str, Any]:
    raw = CONTRACT.read_bytes()
    if sha(raw) != CONTRACT_RAW:
        fail("contract raw bytes changed")
    value = json.loads(raw)
    if value.get("contractSha256") != CONTRACT_SELF:
        fail("contract self claim changed")
    validate_contract(value)
    return value


def git_bytes(*args: str) -> bytes:
    run = subprocess.run(["git", *args], cwd=ROOT, capture_output=True)
    if run.returncode:
        fail("Git binding failed")
    return run.stdout


def git_text(*args: str) -> str:
    return git_bytes(*args).decode("utf-8").strip()


def git_blob(commit: str, path: Path) -> bytes:
    return git_bytes("show", f"{commit}:{path.relative_to(ROOT).as_posix()}")


def load_public_inputs() -> list[dict[str, Any]]:
    raw = BOUNDARY.read_bytes()
    if sha(raw) != BOUNDARY_RAW:
        fail("boundary raw bytes changed")
    value = json.loads(raw)
    if self_hash(value, "reportSha256") != BOUNDARY_SELF or value.get("reportSha256") != BOUNDARY_SELF:
        fail("boundary self hash changed")
    rows = value.get("rows")
    if type(rows) is not list or len(rows) != 12727:
        fail("boundary row denominator changed")
    manifest_raw = FINRA_MANIFEST.read_bytes()
    if sha(manifest_raw) != FINRA_MANIFEST_RAW:
        fail("FINRA manifest raw bytes changed")
    manifest = json.loads(manifest_raw)
    if manifest.get("reportSha256") != FINRA_MANIFEST_SELF or self_hash(manifest, "reportSha256") != FINRA_MANIFEST_SELF:
        fail("FINRA manifest self hash changed")
    return rows


def load_checkpoint() -> dict[str, Any]:
    raw = CHECKPOINT.read_bytes()
    if sha(raw) != CHECKPOINT_RAW:
        fail("private checkpoint raw bytes changed")
    value = json.loads(raw)
    if value.get("checkpointSha256") != CHECKPOINT_SELF or self_hash(value, "checkpointSha256") != CHECKPOINT_SELF:
        fail("private checkpoint self hash changed")
    if value.get("totalRows") != 145103 or value.get("totalResponseBytes") != 257639538:
        fail("private checkpoint aggregate changed")
    if type(value.get("completed")) is not list or len(value["completed"]) != 1522:
        fail("private checkpoint partition count changed")
    return value


def verify_role_rebuild() -> None:
    run = subprocess.run(
        ["python", "-B", str(ROLE_BUILDER), "dry-run", "--remote"], cwd=ROOT,
        capture_output=True, text=True, env={**dict(__import__("os").environ), "PYTHONDONTWRITEBYTECODE": "1"},
    )
    if run.returncode:
        fail("source-derived role reconciliation failed")
    result = json.loads(run.stdout)
    population = result.get("population", {})
    if result.get("status") != "PASS" or population.get("uniqueSuspensionEvents") != 6366 or population.get("modernPairedEvents") != 6361 or result.get("outcomesAccessed") is not False:
        fail("source-derived role reconciliation aggregate changed")


def build_sec_index(rows: list[dict[str, Any]]) -> dict[str, tuple[int, str]]:
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        if type(row) is not dict or type(row.get("accession")) is not str:
            fail("boundary row shape changed")
        grouped[row["accession"]].append(row)
    if len(grouped) != 6366:
        fail("unique suspension event denominator changed")
    output: dict[str, tuple[int, str]] = {}
    excluded = 0
    for accession, event_rows in grouped.items():
        values = {
            (row.get("issuerNameState"), row.get("securityDescriptionState"), row.get("issuerName"),
             row.get("securityDescription"), row.get("suspensionBoundaryDate"))
            for row in event_rows
        }
        if len(values) != 1:
            fail("role projections disagree on event descriptor")
        issuer_state, description_state, issuer, description, boundary_day = values.pop()
        if issuer_state == "PRESENT" and description_state == "PRESENT":
            issuer_key = normalized_description(issuer)
            description_key = normalized_description(description)
            if issuer_key is None or description_key is None:
                fail("present SEC descriptor normalized empty")
            output[accession] = (date.fromisoformat(boundary_day).toordinal(), f"{issuer_key} {description_key}")
        else:
            if {issuer_state, description_state} != {"UNAVAILABLE"}:
                fail("legacy descriptor state changed")
            excluded += 1
    if len(output) != 6361 or excluded != 5:
        fail("modern or legacy event denominator changed")
    return output


def build_finra_index(checkpoint: dict[str, Any]) -> tuple[dict[str, dict[int, list[Any]]], dict[str, int]]:
    index: dict[str, dict[int, list[Any]]] = defaultdict(dict)
    identifiers: set[int] = set()
    sequence = hashlib.sha256()
    rows_seen = bytes_seen = pages_seen = 0
    for partition in checkpoint["completed"]:
        day = partition.get("calendarDay")
        expected_offset = 0
        for page in partition.get("pages", []):
            pages_seen += 1
            if page.get("offset") != expected_offset:
                fail("FINRA page offset changed")
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
                    fail("FINRA identifier changed")
                identifiers.add(identifier)
                sequence.update(canonical(source))
                sequence.update(b"\n")
                ordinal = date.fromisoformat(day[:10]).toordinal()
                code = source.get("dailyListEventCode")
                for side, field in (("OLD", "oldSecurityDescription"), ("NEW", "newSecurityDescription")):
                    description = normalized_description(source.get(field))
                    if description is None:
                        continue
                    current = index[description].get(identifier)
                    if current is None:
                        index[description][identifier] = [ordinal, code, {side}]
                    elif current[0] != ordinal or current[1] != code:
                        fail("FINRA duplicate event descriptor changed")
                    else:
                        current[2].add(side)
            expected_offset += len(rows)
            rows_seen += len(rows)
            bytes_seen += len(raw)
        if expected_offset != partition.get("recordTotal"):
            fail("FINRA partition total changed")
    if pages_seen != 1556 or rows_seen != 145103 or bytes_seen != 257639538 or len(identifiers) != 145103:
        fail("FINRA full private denominator changed")
    if sequence.hexdigest() != ROW_SEQUENCE or len(index) != 39492:
        fail("FINRA row sequence or canonical description count changed")
    return index, {"pages": pages_seen, "rows": rows_seen, "bytes": bytes_seen, "descriptions": len(index)}


def summarize(sec: dict[str, tuple[int, str]], finra: dict[str, dict[int, list[Any]]], mode: str) -> dict[str, Any]:
    pairs: dict[tuple[str, int], tuple[int, int, Any, tuple[str, ...]]] = {}
    for accession, (boundary_day, description) in sec.items():
        for identifier, (event_day, event_code, sides) in finra.get(description, {}).items():
            delta = event_day - boundary_day
            include = mode == "ALL" or (mode == "POST120" and 0 <= delta <= 120) or (mode == "ABS120" and abs(delta) <= 120)
            if include:
                pairs[(accession, identifier)] = (boundary_day, event_day, event_code, tuple(sorted(sides)))
    by_sec: dict[str, set[int]] = defaultdict(set)
    for accession, identifier in pairs:
        by_sec[accession].add(identifier)
    deltas = [event_day - boundary_day for boundary_day, event_day, _code, _sides in pairs.values()]
    return {
        "candidatePairs": len(pairs), "candidateSecEvents": len(by_sec),
        "candidateFinraEvents": len({identifier for _accession, identifier in pairs}),
        "secEventsWithExactlyOneFinraEvent": sum(len(values) == 1 for values in by_sec.values()),
        "minimumCalendarDayDelta": min(deltas) if deltas else None,
        "maximumCalendarDayDelta": max(deltas) if deltas else None,
        "finraDescriptionSideCounts": dict(sorted(Counter("+".join(value[3]) for value in pairs.values()).items())),
        "eventCodeCounts": dict(sorted(Counter("NONE" if value[2] is None else str(value[2]) for value in pairs.values()).items())),
    }


def rebuild() -> dict[str, Any]:
    verify_role_rebuild()
    sec = build_sec_index(load_public_inputs())
    checkpoint = load_checkpoint()
    finra, stats = build_finra_index(checkpoint)
    return {
        "boundaryRoleProjectionRows": 12727, "uniqueSuspensionEvents": 6366,
        "modernDescriptorEvents": len(sec), "legacyDescriptorUnavailableEventsExcluded": 5,
        "finraPartitions": len(checkpoint["completed"]), "finraPages": stats["pages"],
        "finraRows": stats["rows"], "finraResponseBytes": stats["bytes"],
        "finraCanonicalDescriptions": stats["descriptions"],
        "primaryPost120": summarize(sec, finra, "POST120"),
        "absolute120Diagnostic": summarize(sec, finra, "ABS120"),
        "allHistoryPositiveControl": summarize(sec, finra, "ALL"),
    }


def validate_rebuild(value: dict[str, Any], contract: dict[str, Any]) -> None:
    if value != contract["expectedRebuild"] or value != EXPECTED_REBUILD:
        fail("source-derived rebuild differs from contract")
    primary = value["primaryPost120"]
    if primary["candidatePairs"] <= 0 or primary["secEventsWithExactlyOneFinraEvent"] != 0:
        fail("primary ambiguity disposition changed")
    if value["allHistoryPositiveControl"]["candidatePairs"] <= primary["candidatePairs"]:
        fail("all-history positive control changed")


def introduced_once(path: Path) -> list[str]:
    output = git_text("log", "--reverse", "--format=%H", "--diff-filter=A", f"{BASE}..HEAD", "--", path.relative_to(ROOT).as_posix())
    return [line for line in output.splitlines() if line]


def verify_repository(remote_required: bool) -> dict[str, Any]:
    if not remote_required:
        fail("live remote verification is mandatory")
    if git_text("remote", "get-url", "origin") != REMOTE:
        fail("origin URL changed")
    head = git_text("rev-parse", "HEAD")
    if git_text("rev-parse", "@{u}") != head:
        fail("HEAD and upstream differ")
    live = git_text("ls-remote", "--refs", "origin", REMOTE_REF).split()
    if live != [head, REMOTE_REF]:
        fail("live remote differs")
    dependencies = (
        (BOUNDARY, BOUNDARY_RAW, "609f37df9e9c277323c5c8e24d6accfa3d1f3ea7"),
        (ROLE_CONTRACT, ROLE_CONTRACT_RAW, ROLE_INTRODUCTION),
        (ROLE_BUILDER, ROLE_BUILDER_RAW, ROLE_INTRODUCTION),
        (ROLE_TEST, ROLE_TEST_RAW, ROLE_INTRODUCTION),
        (FINRA_MANIFEST, FINRA_MANIFEST_RAW, FINRA_MANIFEST_INTRODUCTION),
    )
    for path, expected_raw, introduction in dependencies:
        raw = path.read_bytes()
        if sha(raw) != expected_raw or git_blob(introduction, path) != raw or git_blob(head, path) != raw:
            fail("dependency Git bytes changed")
    introductions = [introduced_once(path) for path in OWNED]
    if all(not values for values in introductions):
        if head != BASE:
            fail("pre-introduction HEAD moved beyond sealed base")
        return {"phase": "PRE_INTRODUCTION", "introductionCommit": None, "remoteVerified": True, "ownedGitBytesBound": 0}
    if any(len(values) != 1 for values in introductions) or len({values[0] for values in introductions}) != 1:
        fail("owned paths were not introduced together exactly once")
    introduction = introductions[0][0]
    if COMMIT40.fullmatch(introduction) is None or git_text("show", "-s", "--format=%P", introduction).split() != [BASE]:
        fail("introduction is not direct child of base")
    changed = git_text("diff-tree", "--no-commit-id", "--name-status", "-r", introduction).splitlines()
    expected = [f"A\t{path.relative_to(ROOT).as_posix()}" for path in OWNED]
    if changed != expected:
        fail("introduction does not add exactly owned paths")
    if subprocess.run(["git", "merge-base", "--is-ancestor", introduction, head], cwd=ROOT).returncode:
        fail("introduction is not ancestor of HEAD")
    previous = introduction
    for commit in git_text("rev-list", "--reverse", "--first-parent", f"{introduction}..{head}").splitlines():
        if git_text("show", "-s", "--format=%P", commit).split() != [previous]:
            fail("post-introduction history is not linear")
        previous = commit
    for path in OWNED:
        raw = path.read_bytes()
        if git_blob(introduction, path) != raw or git_blob(head, path) != raw:
            fail("owned Git bytes changed")
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
    mutations: dict[str, Callable[[dict[str, Any]], None]] = {
        "timestampBackdated": lambda x: x.__setitem__("createdAt", "1970-01-01T00:00:00Z"),
        "timestampNonZulu": lambda x: x.__setitem__("createdAt", "2026-08-13T12:03:17+00:00"),
        "purposeOverclaim": lambda x: x.__setitem__("purpose", "identity and terminal wealth resolved"),
        "inputRedirect": lambda x: x["authoritativeInputs"]["suspensionBoundary"].__setitem__("path", "outcomes.json"),
        "roleBindingDrift": lambda x: x["authoritativeInputs"]["roleReconciliation"].__setitem__("contractRawSha256", "0" * 64),
        "checkpointDrift": lambda x: x["authoritativeInputs"]["privateFinraCheckpoint"].__setitem__("rowSequenceSha256", "0" * 64),
        "issuerOnlyEnabled": lambda x: x["matchContract"].__setitem__("issuerNameOnlyMatchingAllowed", True),
        "tokenIntersectionEnabled": lambda x: x["matchContract"].__setitem__("tokenIntersectionMatchingAllowed", True),
        "prefixEnabled": lambda x: x["matchContract"].__setitem__("prefixMatchingAllowed", True),
        "fuzzyEnabled": lambda x: x["matchContract"].__setitem__("fuzzyMatchingAllowed", True),
        "symbolEnabled": lambda x: x["matchContract"].__setitem__("symbolMatchingAllowed", True),
        "windowExpanded": lambda x: x["matchContract"].__setitem__("primaryWindow", "ALL_HISTORY"),
        "primaryUniqueInvented": lambda x: x["expectedRebuild"]["primaryPost120"].__setitem__("secEventsWithExactlyOneFinraEvent", 1),
        "primaryPairRemoved": lambda x: x["expectedRebuild"]["primaryPost120"].__setitem__("candidatePairs", 0),
        "positiveControlRemoved": lambda x: x["expectedRebuild"]["allHistoryPositiveControl"].__setitem__("candidatePairs", 0),
        "studyCreditPromoted": lambda x: x["disposition"].__setitem__("studyCredit", "POSITIVE"),
        "identityPromoted": lambda x: x["claimLocks"].__setitem__("securityIdentityResolved", True),
        "laterOtcExcluded": lambda x: x["claimLocks"].__setitem__("laterOtcTradingExcluded", True),
        "terminalWealthPromoted": lambda x: x["claimLocks"].__setitem__("terminalWealthComplete", True),
        "outcomesAccessed": lambda x: x["claimLocks"].__setitem__("outcomesAccessed", True),
        "unknownCredit": lambda x: x["claimLocks"].__setitem__("unknownScientificCredit", True),
        "privateRowsPrinted": lambda x: x["privacyContract"].__setitem__("privateRowsPrinted", True),
        "publicOutputEnabled": lambda x: x["privacyContract"].__setitem__("publicOutputCreated", True),
        "writeEnabled": lambda x: x["implementationContract"].__setitem__("writeCapabilityAllowed", True),
        "remoteOptional": lambda x: x["implementationContract"].__setitem__("remoteVerificationRequired", False),
        "topologyWeakened": lambda x: x["implementationContract"].__setitem__("introductionAddsExactlyThreeOwnedPaths", False),
    }
    kills: dict[str, bool] = {}
    for name, mutate in mutations.items():
        item = copy.deepcopy(contract)
        mutate(item)
        item = reseal(item)
        kills[name] = rejected(lambda item=item: validate_contract(item))
    kills.update({
        "normalizationDeterministic": normalized_description("  Société & Co., Class A ") == "SOCIETE AND CO CLASS A",
        "normalizationNoFuzzy": normalized_description("Alpha Holdings") != normalized_description("Alpha Holding"),
        "concatenationBoundaryPreserved": f"{normalized_description('ABC')} {normalized_description('Common Stock')}" == "ABC COMMON STOCK",
        "nullDescriptionRejected": normalized_description(None) is None,
    })
    if not all(kills.values()):
        fail("self-test kill failed")
    return {
        "schema": "sec-form25-finra-exact-description-bridge-disposition-self-test/v1",
        "status": "PASS", "mutationKills": kills, "studyCredit": "ZERO",
        "privateRowsPrinted": False, "privateRowsWritten": False, "outcomesAccessed": False,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=("verify-contract", "self-test", "verify"))
    parser.add_argument("--remote", action="store_true")
    args = parser.parse_args()
    try:
        contract = load_contract()
        repository = verify_repository(args.remote)
        if args.command == "verify-contract":
            result = {
                "schema": "sec-form25-finra-exact-description-bridge-disposition-contract-verification/v1",
                "status": "PASS", **repository, "studyCredit": "ZERO", "outcomesAccessed": False,
            }
        elif args.command == "self-test":
            result = {**self_test(contract), **repository}
        else:
            rebuilt = rebuild()
            validate_rebuild(rebuilt, contract)
            result = {
                "schema": "sec-form25-finra-exact-description-bridge-disposition-verification/v1",
                "status": "PASS", **repository, "disposition": contract["disposition"]["status"],
                "studyCredit": "ZERO", "rebuild": rebuilt, "privateRowsPrinted": False,
                "privateRowsWritten": False, "privateDescriptionsPrinted": False,
                "publicOutputCreated": False, "pricesAccessed": False, "returnsAccessed": False,
                "outcomesAccessed": False,
            }
    except (DispositionError, KeyError, TypeError, ValueError, OSError, json.JSONDecodeError) as exc:
        parser.error(str(exc))
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

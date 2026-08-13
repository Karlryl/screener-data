#!/usr/bin/env python3
"""Verify the append-only, proposal-only V3 hypothesis register contract."""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import re
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable


ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "research" / "early-detection-v4" / "hypothesis-register-contract-v3.json"
SCRIPT = Path(__file__).resolve()
TEST = ROOT / "tests" / "verify-hypothesis-register-v3.test.js"
AUTHORIZED_REMOTE = "https://github.com/Karlryl/screener-data.git"
AUTHORIZED_REF = "refs/heads/codex/early-detection-v4-gates-20260810"
BUILD_BASE = "996fd2eeb7f2193cfc6352ca15ab544d3f09ae4c"
CONSTRUCTION_HEAD = "5622b794b0a435c5389707a6777161a33f8a79f7"
EXPECTED_CONTRACT_RAW = "253cd6b42d40da895d09d36bf6448a7051a12bb6bea27f77248addb793a83a9d"
EXPECTED_CONTRACT_SELF = "8c29ab1195246fcd30aa0044c9797a1b5b3a940c5d6f8cef93eff27b3e4c4af1"
EXPECTED_VERIFIER_NORMALIZED = "41f17b0088a006bbf7253a77448793d944ef7cc03e9890bf15e4e9bdead5a16c"
EXPECTED_TEST_RAW = "3d80874a0da1e6ae033865840ca4837af365af859776f69596e2892fc9aab8e7"

OWNED_PATHS = [
    "research/early-detection-v4/hypothesis-register-contract-v3.json",
    "scripts/verify-hypothesis-register-v3.py",
    "tests/verify-hypothesis-register-v3.test.js",
]
DEFERRED_FIELDS = [
    "TARGET_POPULATION",
    "EXPOSURE_DEFINITION",
    "ENDPOINT_DEFINITION",
    "ESTIMAND",
    "EXCLUSIONS",
    "MISSINGNESS_RULE",
    "DENOMINATOR",
    "NUMERIC_THRESHOLDS",
    "CONFIDENCE_INTERVALS",
    "MULTIPLICITY_RULE",
    "VERDICT_RULE",
]
PROPOSAL_FIELDS = {
    "hypothesisId", "familyId", "mechanism", "primaryClaim", "requiredDataCategories",
    "expectedDirection", "conceptualFalsification", "developmentWindow", "validationWindow",
    "multiplicityFamilyId", "generationProvenance", "deferredToSeparateProtocol",
    "forbiddenClaims", "proposalSha256",
}
EVENT_FIELDS = {
    "schema", "sequence", "eventId", "createdAt", "hypothesisId", "eventType",
    "previousEventSha256", "proposalSha256", "statusAfter", "protocolBinding", "eventSha256",
}
ALLOWED_INSPECTED_FIELDS = [
    "schema",
    "verdict",
    "scope.payloads",
    "scope.quarters",
    "roles.*.candidates.*.coverage.*.taxonomyVersion",
    "roles.*.candidates.*.coverage.*.periodKind",
    "roles.*.candidates.*.coverage.*.distinctAccessions",
    "roles.*.candidates.*.coverage.*.distinctEntities",
    "roles.*.candidates.*.coverage.*.firstAcceptedEpoch",
    "roles.*.candidates.*.coverage.*.lastAcceptedEpoch",
    "limitations",
]
PREOUTCOME_STATEMENT = (
    "The map is frozen before growth-outcome materialization; full 2009-2024 coverage "
    "and an independent semantic audit remain gates."
)
FORBIDDEN_ORIGIN_TOKENS = {
    "ORIGINAL_V4", "ORIGINAL_V4_RESULT", "H_LATE", "H_FEM", "SEC_CIK",
    "SEC_CIK_RESULT", "SEC_CIK_ENDPOINT", "COMPLETED_SEC_CIK", "ANALYSIS_LEDGER",
    "BEST_CUTOFF", "CHOOSE_BEST_CUTOFF", "STOCK_RETURN", "RETURN_VALUE",
    "PRICE_SERIES", "MARKET_PRICE", "RETURN_SERIES", "ENDPOINT_VALUE", "P_VALUE", "FAVORABLE_RESULT",
    "COMPLETED_STUDY_RESULT", "THRESHOLD_OPTIMIZATION", "POST_OUTCOME_OPTIMIZATION",
}
EXPECTED_SOURCE_VALUE_CONTRACT = {
    "pathSemantics": "DOT_SEGMENTS_WITH_STAR_EXPANDING_ONE_DICT_OR_LIST_LEVEL",
    "resolvedPathCardinalities": {
        "schema": 1,
        "verdict": 1,
        "scope.payloads": 1,
        "scope.quarters": 1,
        "roles.*.candidates.*.coverage.*.taxonomyVersion": 904,
        "roles.*.candidates.*.coverage.*.periodKind": 904,
        "roles.*.candidates.*.coverage.*.distinctAccessions": 904,
        "roles.*.candidates.*.coverage.*.distinctEntities": 904,
        "roles.*.candidates.*.coverage.*.firstAcceptedEpoch": 904,
        "roles.*.candidates.*.coverage.*.lastAcceptedEpoch": 904,
        "limitations": 1,
    },
    "roleCount": 9,
    "candidateCount": 16,
    "coverageRowCount": 904,
    "taxonomyVersionRule": "NONEMPTY_US_GAAP_OR_IFRS_VERSION_OR_SEC_ACCESSION",
    "distinctTaxonomyVersions": 134,
    "allowedPeriodKinds": [
        "annual", "cumulative_duration_qtrs_2", "cumulative_duration_qtrs_3",
        "instant", "quarterly",
    ],
    "integerFieldsStrictNoBoolean": True,
    "distinctAccessionsRange": [1, 34634],
    "distinctEntitiesRange": [1, 8062],
    "firstAcceptedEpochRange": [1239828240, 1608067260],
    "lastAcceptedEpochRange": [1240866720, 1609449780],
    "eachFirstAcceptedAtOrBeforeLastAccepted": True,
    "maximumAcceptedUtc": "2020-12-31T21:23:00Z",
}
EXPECTED_LOCKS = {
    "proposalExecutionAuthorized": False,
    "resultComputationAllowed": False,
    "studyCredit": "NONE",
    "originalV4GateCredit": False,
    "originalV4Complete": False,
    "publicAiAppendOnly": True,
    "secCikStudyAppendOnly": True,
    "completedSecCikStudyAccessedForGeneration": False,
    "reserved2021To2024OpenedForGeneration": False,
    "hLateAccessed": False,
    "hFemAccessed": False,
    "pricesAccessed": False,
    "returnsAccessed": False,
    "outcomesAccessed": False,
    "humanAttestation": False,
    "separateProtocolRequiredBeforePreregistration": True,
    "fullPopulationEndpointEstimandSpecified": False,
}


class ContractError(RuntimeError):
    pass


def fail(message: str) -> None:
    raise ContractError(message)


def canonical(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def sha(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def canonical_sha(value: Any) -> str:
    return sha(canonical(value))


def exact_keys(value: Any, expected: set[str], label: str) -> None:
    if not isinstance(value, dict) or set(value) != expected:
        fail(f"{label} keys changed")


def require_exact_type(value: Any, expected_type: type, label: str) -> Any:
    if type(value) is not expected_type:
        fail(f"{label} type changed")
    return value


def require_string(value: Any, label: str, *, nonempty: bool = True) -> str:
    require_exact_type(value, str, label)
    if nonempty and not value:
        fail(f"{label} must be non-empty")
    return value


def require_string_list(value: Any, label: str, *, exact: list[str] | None = None) -> list[str]:
    require_exact_type(value, list, label)
    if any(type(item) is not str or not item for item in value):
        fail(f"{label} must contain only non-empty strings")
    if exact is not None and value != exact:
        fail(f"{label} values changed")
    return value


def require_typed_equal(value: Any, expected: Any, label: str) -> None:
    if type(value) is not type(expected):
        fail(f"{label} type changed")
    if isinstance(expected, dict):
        exact_keys(value, set(expected), label)
        for key, expected_item in expected.items():
            require_typed_equal(value[key], expected_item, f"{label}.{key}")
        return
    if isinstance(expected, list):
        if len(value) != len(expected):
            fail(f"{label} length changed")
        for index, (item, expected_item) in enumerate(zip(value, expected)):
            require_typed_equal(item, expected_item, f"{label}[{index}]")
        return
    if value != expected:
        fail(f"{label} value changed")


def require_sha(value: Any, label: str) -> str:
    if not isinstance(value, str) or not re.fullmatch(r"[0-9a-f]{64}", value):
        fail(f"{label} is not a lowercase SHA-256")
    return value


def safe_path(relative: Any) -> Path:
    if not isinstance(relative, str) or not relative or "\\" in relative:
        fail("repository path is not canonical")
    path = (ROOT / relative).resolve()
    try:
        path.relative_to(ROOT.resolve())
    except ValueError as exc:
        raise ContractError("repository path escapes root") from exc
    return path


def git_text(*args: str) -> str:
    result = subprocess.run(
        ["git", *args], cwd=ROOT, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    )
    return result.stdout.decode("utf-8").strip()


def git_bytes(*args: str) -> bytes:
    result = subprocess.run(
        ["git", *args], cwd=ROOT, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    )
    return result.stdout


def require_first_parent_ancestor(ancestor: str, descendant: str, label: str) -> None:
    if not re.fullmatch(r"[0-9a-f]{40}", ancestor) or not re.fullmatch(r"[0-9a-f]{40}", descendant):
        fail(f"{label} commit syntax changed")
    chain = git_text("rev-list", "--first-parent", descendant).splitlines()
    if ancestor not in chain:
        fail(f"{label} is outside the authorized first-parent line")


def require_ancestor(ancestor: str, descendant: str, label: str) -> None:
    if not re.fullmatch(r"[0-9a-f]{40}", ancestor) or not re.fullmatch(r"[0-9a-f]{40}", descendant):
        fail(f"{label} commit syntax changed")
    result = subprocess.run(
        ["git", "merge-base", "--is-ancestor", ancestor, descendant], cwd=ROOT,
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    if result.returncode != 0:
        fail(f"{label} is outside authorized Git ancestry")


def normalize_verifier(raw: bytes) -> bytes:
    names = (
        b"EXPECTED_CONTRACT_RAW", b"EXPECTED_CONTRACT_SELF",
        b"EXPECTED_VERIFIER_NORMALIZED", b"EXPECTED_TEST_RAW",
    )
    normalized = raw
    for name in names:
        pattern = rb'(?m)^(' + re.escape(name) + rb' = ")[0-9a-f]{64}("\r?$)'
        normalized, count = re.subn(pattern, rb"\g<1>" + (b"0" * 64) + rb"\g<2>", normalized)
        if count != 1:
            fail(f"verifier normalization target changed: {name.decode()}")
    return normalized


def recursive_strings(value: Any) -> list[str]:
    if isinstance(value, str):
        return [value]
    if isinstance(value, list):
        return [text for item in value for text in recursive_strings(item)]
    if isinstance(value, dict):
        return [
            text
            for key, item in value.items()
            for text in ([key] + recursive_strings(item))
        ]
    return []


def tokenized(value: Any) -> str:
    text = json.dumps(recursive_strings(value), ensure_ascii=False, sort_keys=True)
    text = re.sub(r"(?<=[A-Z])(?=[A-Z][a-z])", "_", text)
    text = re.sub(r"(?<=[a-z0-9])(?=[A-Z])", "_", text).upper()
    return re.sub(r"[^A-Z0-9]+", "_", text).strip("_")


def contains_forbidden_origin(value: Any) -> bool:
    text = tokenized(value)
    normalized = {re.sub(r"[^A-Z0-9]+", "_", item.upper()).strip("_") for item in FORBIDDEN_ORIGIN_TOKENS}
    if any(re.search(rf"(?<![A-Z0-9]){re.escape(item)}(?![A-Z0-9])", text) for item in normalized):
        return True
    compact_text = text.replace("_", "")
    compact_tokens = {item.replace("_", "") for item in normalized if len(item.replace("_", "")) >= 9}
    return any(item in compact_text for item in compact_tokens)


def resolve_path(value: Any, path: str) -> list[Any]:
    require_string(path, "source path")
    nodes = [value]
    for segment in path.split("."):
        next_nodes: list[Any] = []
        if segment == "*":
            for node in nodes:
                if isinstance(node, dict):
                    next_nodes.extend(node.values())
                elif isinstance(node, list):
                    next_nodes.extend(node)
                else:
                    fail(f"source path wildcard cannot expand: {path}")
        else:
            for node in nodes:
                if not isinstance(node, dict) or segment not in node:
                    fail(f"source path does not resolve: {path}")
                next_nodes.append(node[segment])
        if not next_nodes:
            fail(f"source path resolved no values: {path}")
        nodes = next_nodes
    return nodes


def proposal_sha(value: dict[str, Any]) -> str:
    return canonical_sha({key: val for key, val in value.items() if key != "proposalSha256"})


def event_sha(value: dict[str, Any]) -> str:
    return canonical_sha({key: val for key, val in value.items() if key != "eventSha256"})


def validate_file_binding(binding: dict[str, Any], *, build_base: str, label: str) -> bytes:
    required = {"path", "bytes", "rawSha256", "gitBlob", "introductionCommit"}
    if "selfField" in binding or "selfSha256" in binding:
        required |= {"selfField", "selfSha256"}
    exact_keys(binding, required, label)
    if type(binding["bytes"]) is not int or binding["bytes"] < 1:
        fail(f"{label}.bytes type or value changed")
    require_string(binding["path"], f"{label}.path")
    require_sha(binding["rawSha256"], f"{label}.rawSha256")
    if not isinstance(binding["gitBlob"], str) or re.fullmatch(r"[0-9a-f]{40}", binding["gitBlob"]) is None:
        fail(f"{label}.gitBlob changed")
    path = safe_path(binding["path"])
    raw = path.read_bytes()
    if len(raw) != binding["bytes"] or sha(raw) != require_sha(binding["rawSha256"], f"{label}.rawSha256"):
        fail(f"{label} local byte binding changed")
    if git_text("hash-object", str(path)) != binding["gitBlob"]:
        fail(f"{label} Git blob binding changed")
    if git_bytes("show", f"{build_base}:{binding['path']}") != raw:
        fail(f"{label} differs from build-base bytes")
    introduction = binding["introductionCommit"]
    require_ancestor(introduction, build_base, f"{label} introduction")
    if git_bytes("show", f"{introduction}:{binding['path']}") != raw:
        fail(f"{label} differs from introduction bytes")
    if "selfField" in binding:
        value = json.loads(raw)
        field = binding["selfField"]
        claim = value.pop(field, None)
        expected = require_sha(binding["selfSha256"], f"{label}.selfSha256")
        if claim != expected or canonical_sha(value) != expected:
            fail(f"{label} canonical self binding changed")
    return raw


def validate_source_report(report: Any, source: dict[str, Any]) -> None:
    require_exact_type(report, dict, "generation source report")
    value_contract = source["sourceValueContract"]
    require_typed_equal(value_contract, EXPECTED_SOURCE_VALUE_CONTRACT, "sourceValueContract")
    if source["sourceValueContractSha256"] != canonical_sha(value_contract):
        fail("source-value contract self hash changed")

    cardinalities = value_contract["resolvedPathCardinalities"]
    for path in source["allowedGenerationFields"]:
        resolved = resolve_path(report, path)
        if path not in cardinalities or len(resolved) != cardinalities[path]:
            fail(f"source path cardinality changed: {path}")
    if set(cardinalities) != set(source["allowedGenerationFields"]):
        fail("source cardinality contract and allowlist diverged")

    schema = resolve_path(report, "schema")
    verdict = resolve_path(report, "verdict")
    payloads = resolve_path(report, "scope.payloads")
    quarters = resolve_path(report, "scope.quarters")
    limitations = resolve_path(report, "limitations")
    if schema != [source["schema"]] or verdict != [source["verdict"]]:
        fail("source identity fields changed")
    if len(payloads) != 1 or type(payloads[0]) is not int or payloads[0] != source["payloads"]:
        fail("source payload count type or value changed")
    expected_quarters = [f"{year}q{quarter}" for year in range(2009, 2021) for quarter in range(1, 5)]
    if len(quarters) != 1:
        fail("source quarter path cardinality changed")
    require_string_list(quarters[0], "source quarters", exact=expected_quarters)
    if len(limitations) != 1:
        fail("source limitations path cardinality changed")
    require_string_list(limitations[0], "source limitations")
    if len(limitations[0]) <= 2 or limitations[0][2] != PREOUTCOME_STATEMENT:
        fail("generation source pre-outcome statement changed")

    roles = report.get("roles")
    require_exact_type(roles, dict, "source roles")
    if len(roles) != value_contract["roleCount"] or any(type(key) is not str or not key for key in roles):
        fail("source role structure changed")
    candidates: list[dict[str, Any]] = []
    coverage: list[dict[str, Any]] = []
    required_coverage_fields = {
        "taxonomyVersion", "periodKind", "distinctAccessions", "distinctEntities",
        "firstAcceptedEpoch", "lastAcceptedEpoch",
    }
    for role_name, role in roles.items():
        require_exact_type(role, dict, f"source role {role_name}")
        role_candidates = role.get("candidates")
        require_exact_type(role_candidates, list, f"source role {role_name} candidates")
        for candidate in role_candidates:
            require_exact_type(candidate, dict, f"source role {role_name} candidate")
            rows = candidate.get("coverage")
            require_exact_type(rows, list, f"source role {role_name} candidate coverage")
            if not rows:
                fail("source candidate coverage may not be empty")
            candidates.append(candidate)
            for row in rows:
                require_exact_type(row, dict, "source coverage row")
                if not required_coverage_fields.issubset(row):
                    fail("source coverage row required fields changed")
                coverage.append(row)
    if len(candidates) != value_contract["candidateCount"] or len(coverage) != value_contract["coverageRowCount"]:
        fail("source candidate or coverage row count changed")

    taxonomies: list[str] = []
    period_kinds: list[str] = []
    integer_fields = {
        "distinctAccessions": [],
        "distinctEntities": [],
        "firstAcceptedEpoch": [],
        "lastAcceptedEpoch": [],
    }
    taxonomy_pattern = re.compile(r"(?:(?:us-gaap|ifrs)/[0-9]{4}|[0-9]{10}-[0-9]{2}-[0-9]{6})")
    for row in coverage:
        taxonomy = require_string(row["taxonomyVersion"], "source taxonomyVersion")
        if taxonomy_pattern.fullmatch(taxonomy) is None:
            fail("source taxonomyVersion value changed")
        taxonomies.append(taxonomy)
        period = require_string(row["periodKind"], "source periodKind")
        period_kinds.append(period)
        for field in integer_fields:
            if type(row[field]) is not int:
                fail(f"source {field} must be a strict integer")
            integer_fields[field].append(row[field])
        if row["firstAcceptedEpoch"] > row["lastAcceptedEpoch"]:
            fail("source accepted epoch order changed")

    if len(set(taxonomies)) != value_contract["distinctTaxonomyVersions"]:
        fail("source taxonomy-version cardinality changed")
    if sorted(set(period_kinds)) != value_contract["allowedPeriodKinds"]:
        fail("source period-kind values changed")
    range_keys = {
        "distinctAccessions": "distinctAccessionsRange",
        "distinctEntities": "distinctEntitiesRange",
        "firstAcceptedEpoch": "firstAcceptedEpochRange",
        "lastAcceptedEpoch": "lastAcceptedEpochRange",
    }
    for field, range_key in range_keys.items():
        values = integer_fields[field]
        if [min(values), max(values)] != value_contract[range_key]:
            fail(f"source {field} range changed")
    maximum_utc = datetime.fromtimestamp(
        max(integer_fields["lastAcceptedEpoch"]), tz=timezone.utc,
    ).strftime("%Y-%m-%dT%H:%M:%SZ")
    if maximum_utc != value_contract["maximumAcceptedUtc"] or maximum_utc[:10] > source["maximumObservedDate"]:
        fail("source maximum accepted date crossed the generation boundary")


def validate_dependencies(value: dict[str, Any]) -> None:
    prior_binding = {
        key: value["priorRegister"][key]
        for key in ("path", "bytes", "rawSha256", "gitBlob", "selfField", "selfSha256", "introductionCommit")
    }
    validate_file_binding(prior_binding, build_base=CONSTRUCTION_HEAD, label="prior register V2")
    prior = json.loads(safe_path(prior_binding["path"]).read_bytes())
    if prior.get("schema") != "early-detection-hypothesis-register-contract/v2":
        fail("prior register structure changed")
    if len(prior.get("proposals", [])) != 1 or len(prior.get("events", [])) != 1:
        fail("prior register proposal or event history changed")
    if prior.get("scientificLocks", {}).get("studyCredit") != "NONE":
        fail("prior register scientific-credit boundary changed")

    resume = value["operationalResume"]["resumeV2"]
    validate_file_binding(resume, build_base=BUILD_BASE, label="operational resume V2")
    resume_value = json.loads(safe_path(resume["path"]).read_bytes())
    if resume_value.get("schema") != "early-detection-continuous-free-source-operational-resume-contract/v2":
        fail("operational resume schema changed")
    if not any(item.get("workId") == "OUTCOME-BLIND-HYPOTHESIS-REGISTER-PRE2021" for item in resume_value.get("nextQueue", [])):
        fail("operational hypothesis queue authorization missing")
    locks = resume_value.get("scientificLocks", {})
    if locks.get("outcomesAccessed") is not False or locks.get("reserved2021To2024OpenedForHypothesisGeneration") is not False:
        fail("operational resume scientific boundary changed")

    harness = value["operationalResume"]["harnessV3"]
    for role in ("contract", "verifier", "test"):
        role_binding = dict(harness[role])
        role_binding["introductionCommit"] = harness["introductionCommit"]
        validate_file_binding(role_binding, build_base=BUILD_BASE, label=f"operational harness V3 {role}")
    harness_value = json.loads(safe_path(harness["contract"]["path"]).read_bytes())
    if harness_value.get("schema") != "early-detection-continuous-free-source-operational-resume-harness-contract/v3":
        fail("operational harness schema changed")
    if harness_value.get("providerPolicy", {}).get("requiredProviderPhase") != "POST_INTRODUCTION":
        fail("operational harness provider phase changed")
    if harness_value.get("scientificLocks", {}).get("outcomesAccessed") is not False:
        fail("operational harness outcome lock changed")

    source = value["evidenceSources"][0]
    source_binding = {
        key: source[key] for key in ("path", "bytes", "rawSha256", "gitBlob", "introductionCommit")
    }
    raw = validate_file_binding(source_binding, build_base=BUILD_BASE, label="generation source")
    report = json.loads(raw)
    if report.get("schema") != source["schema"] or report.get("verdict") != source["verdict"]:
        fail("generation source schema or verdict changed")
    claim = report.pop(source["reportSelfField"], None)
    if claim != source["reportSelfSha256"] or canonical_sha(report) != source["reportSelfSha256"]:
        fail("generation source self hash changed")
    scope = report.get("scope", {})
    expected_quarters = [f"{year}q{quarter}" for year in range(2009, 2021) for quarter in range(1, 5)]
    if scope.get("quarters") != expected_quarters or scope.get("payloads") != 95:
        fail("generation source pre-2021 scope changed")
    if scope.get("payloadManifestSha256") != source["payloadManifestSha256"]:
        fail("generation source payload manifest changed")
    limitations = report.get("limitations", [])
    if len(limitations) <= 2 or limitations[2] != PREOUTCOME_STATEMENT:
        fail("generation source pre-outcome statement changed")
    validate_source_report(report, source)


def validate_contract(value: dict[str, Any], *, exact_artifact: bool, dependencies: bool) -> None:
    exact_keys(value, {
        "schema", "createdAt", "taskId", "track", "purpose", "sourceBase", "priorRegister",
        "operationalResume", "generationBoundary", "evidenceSources", "proposalContract",
        "proposals", "events", "scientificLocks", "ownedBindings", "contractSha256",
    }, "contract")
    if value["schema"] != "early-detection-hypothesis-register-contract/v3":
        fail("contract schema changed")
    require_string(value["createdAt"], "contract.createdAt")
    require_string(value["purpose"], "contract.purpose")
    if value["createdAt"] != "2026-08-13T04:30:00Z":
        fail("contract creation timestamp changed")
    if value["track"] != "ADDON_PROPOSALS_ONLY" or value["taskId"] != "OUTCOME-BLIND-HYPOTHESIS-REGISTER-PRE2021-V3":
        fail("proposal-only boundary changed")
    require_string(value["track"], "contract.track")
    require_string(value["taskId"], "contract.taskId")
    body = dict(value)
    claim = body.pop("contractSha256", None)
    if require_sha(claim, "contractSha256") != canonical_sha(body):
        fail("contract canonical self hash changed")
    if exact_artifact and claim != EXPECTED_CONTRACT_SELF:
        fail("contract expected self binding changed")

    source_base = value["sourceBase"]
    expected_source_base = {
        "remote": AUTHORIZED_REMOTE,
        "ref": AUTHORIZED_REF,
        "buildBase": BUILD_BASE,
        "buildBaseTag": 854,
        "buildBaseIsMinimumSealedAncestor": True,
        "constructionHead": CONSTRUCTION_HEAD,
        "constructionHeadTag": 861,
        "exactRemoteAtContractBuild": True,
        "buildBaseMustRemainFirstParentAncestor": True,
        "constructionHeadMustRemainFirstParentAncestor": True,
        "interveningLinearCommitsBeforeIntroductionAllowed": True,
        "introductionPolicy": "FIRST_REMOTE_FIRST_PARENT_DESCENDANT_OF_CONSTRUCTION_HEAD_THAT_ADDS_ALL_THREE_OWNED_PATHS",
        "introductionCommitAddsExactlyAuthorizedPaths": True,
        "authorizedPaths": OWNED_PATHS,
    }
    require_typed_equal(source_base, expected_source_base, "sourceBase")

    prior = value["priorRegister"]
    expected_prior = {
        "path": "research/early-detection-v4/hypothesis-register-contract-v2.json",
        "bytes": 12145,
        "rawSha256": "6c12b139edf61757dc9c457d75a4647974bb13da8473dc1b0e4fd5d3c31e24f4",
        "gitBlob": "2e0bb9c645c3662638841595b5fd198858255a28",
        "selfField": "contractSha256",
        "selfSha256": "199164de8a6251409b671c669c44acc1bf2577d95f534ff7bebb4b961006e4a2",
        "introductionCommit": "912ed611aae9081c528cb8e39f8017a290fd4258",
        "proposalCount": 1,
        "eventCount": 1,
        "appendOnly": True,
        "unchangedAtConstructionHead": True,
        "supersededByV3ForCorrectedProvenanceOnly": True,
        "knownSupersededDefects": [
            "INSPECTED_FIELD_PATHS_OMITTED_COVERAGE_ARRAY_LEVEL",
            "FORBIDDEN_ORIGIN_SCAN_IGNORED_DICTIONARY_KEYS_AND_TEXT_FIELD_TYPES",
        ],
        "historicalDefinitionsOrStatusesMutated": False,
        "scientificCredit": "NONE",
    }
    require_typed_equal(prior, expected_prior, "priorRegister")

    operational = value["operationalResume"]
    exact_keys(operational, {"resumeV2", "harnessV3"}, "operationalResume")
    resume = operational["resumeV2"]
    expected_resume = {
        "path": "research/early-detection-v4/continuous-free-source-operational-resume-contract-v2.json",
        "bytes": 13760,
        "rawSha256": "084bbfc27e10bbb444c369bb488ddf60d6ed4c1547a2a5c807f700862a70eb5d",
        "gitBlob": "ab077a35d5612f2693efbb78885073b60469a695",
        "selfField": "resumeSha256",
        "selfSha256": "9a24cea57cbc5340e88836399fee297ad186de5fd00c058a3ea206626d8eaa1b",
        "introductionCommit": "2d0b8ee0e1cf3d9fea6489d529b8bf85774bcfb9",
    }
    require_typed_equal(resume, expected_resume, "resumeV2")
    harness = operational["harnessV3"]
    exact_keys(harness, {"introductionCommit", "introductionTag", "requiredProviderPhase", "contract", "verifier", "test"}, "harnessV3")
    if type(harness["introductionTag"]) is not int or harness["introductionCommit"] != BUILD_BASE or harness["introductionTag"] != 854 or harness["requiredProviderPhase"] != "POST_INTRODUCTION":
        fail("Tag854 harness binding changed")
    expected_harness_roles = {
        "contract": ("research/early-detection-v4/continuous-free-source-operational-resume-harness-contract-v3.json", 4167, "84fc2a7aec9603193764104742735c36fe0da77be3b477411de6a50199ae4a5e", "55df901b8d4f520542afe6df12cd09f920a0e62e"),
        "verifier": ("scripts/verify-continuous-free-source-operational-resume-harness-v3.py", 15888, "e434800b72800f400caf8d887bc8b01153e051f9ab034e8647871796d56e0069", "c53288becb38a04048de2c6ddf17872ed9100679"),
        "test": ("tests/verify-continuous-free-source-operational-resume-harness-v3.test.js", 3994, "88a5471cf2fabd63672023e9c2ed71628e37671ade616e8286f8810cc2d8472e", "ee41afb3a6ba0b2014f15e5fa74f156c21e49932"),
    }
    for role, (expected_path, expected_bytes, expected_raw, expected_blob) in expected_harness_roles.items():
        binding = harness[role]
        required_role_keys = {"path", "bytes", "rawSha256", "gitBlob"}
        if role == "contract":
            required_role_keys |= {"selfField", "selfSha256"}
        exact_keys(binding, required_role_keys, f"harnessV3.{role}")
        if binding["path"] != expected_path or binding["bytes"] != expected_bytes or binding["rawSha256"] != expected_raw or binding["gitBlob"] != expected_blob:
            fail(f"Tag854 harness {role} exact byte or Git binding changed")

    boundary = value["generationBoundary"]
    exact_keys(boundary, {
        "maximumObservedDate", "reservedPeriod", "reservedPeriodOpenedForIdeaGeneration",
        "onlyHashBoundPreOutcomeSourceFeaturesAllowed", "completedSecCikStudyMayBeUsedForGeneration",
        "completedSecCikThresholdReuseAllowed", "originalV4MayBeUsedForGeneration",
        "hLateMayBeUsedForGeneration", "hFemMayBeUsedForGeneration",
        "pricesOrReturnsMayBeUsedForGeneration", "outcomesAccessed",
    }, "generationBoundary")
    expected_boundary = {
        "maximumObservedDate": "2020-12-31",
        "reservedPeriod": "2021-01-01/2024-12-31",
        "reservedPeriodOpenedForIdeaGeneration": False,
        "onlyHashBoundPreOutcomeSourceFeaturesAllowed": True,
        "completedSecCikStudyMayBeUsedForGeneration": False,
        "completedSecCikThresholdReuseAllowed": False,
        "originalV4MayBeUsedForGeneration": False,
        "hLateMayBeUsedForGeneration": False,
        "hFemMayBeUsedForGeneration": False,
        "pricesOrReturnsMayBeUsedForGeneration": False,
        "outcomesAccessed": False,
    }
    require_typed_equal(boundary, expected_boundary, "generationBoundary")

    sources = value["evidenceSources"]
    if type(sources) is not list or len(sources) != 1:
        fail("exactly one eligible pre-2021 source is required")
    source = sources[0]
    exact_keys(source, {
        "sourceId", "authority", "path", "bytes", "rawSha256", "gitBlob", "introductionCommit",
        "schema", "verdict", "reportSelfField", "reportSelfSha256", "payloadManifestSha256",
        "payloads", "quarterCount", "firstQuarter", "lastQuarter", "maximumObservedDate",
        "preOutcomeBinding", "allowedGenerationFields", "directProposalUseAllowed",
        "sourceValueContract", "sourceValueContractSha256",
        "outcomesAccessed", "pricesAccessed", "returnsAccessed",
    }, "evidenceSource")
    if source["sourceId"] != "SEC_CONCEPT_COVERAGE_2009_2020_PREOUTCOME":
        fail("generation source identity changed")
    for field in (
        "sourceId", "authority", "path", "rawSha256", "gitBlob", "introductionCommit",
        "schema", "verdict", "reportSelfField", "reportSelfSha256", "payloadManifestSha256",
        "firstQuarter", "lastQuarter", "maximumObservedDate", "sourceValueContractSha256",
    ):
        require_string(source[field], f"evidenceSource.{field}")
    for field in ("bytes", "payloads", "quarterCount"):
        if type(source[field]) is not int:
            fail(f"evidenceSource.{field} type changed")
    if any((
        source["path"] != "reports/early-detection/sec-concept-coverage-2009-2020.json",
        source["bytes"] != 390685,
        source["rawSha256"] != "f68ac0d467e3b21d93141715b58f3edf3123c25902a0bccf7ecc2dc0c0f9ec38",
        source["gitBlob"] != "1914cbbcd3d2f8255afa39ed395448b3767fc89d",
        source["introductionCommit"] != "ffefb06a41e7b61547f334c3a4bbb2fa07a3fcd4",
        source["authority"] != "SEC_FINANCIAL_STATEMENT_DATA_SETS_PRIMARY_DERIVED_COVERAGE",
        source["schema"] != "early-detection-concept-audit/v2",
        source["verdict"] != "COVERAGE_PASS_MAP_FROZEN_PERIOD_EXTENSION_PENDING",
        source["reportSelfField"] != "reportSha256",
        source["reportSelfSha256"] != "2e2e4fefb5e1949b66e6275ea7e1039e1847126ac562bbe779db798229b464d6",
        source["payloadManifestSha256"] != "e77144099fa209a2173f6c8765c456062ed78b16ee4a79bee80e4ba511c3a2aa",
        source["payloads"] != 95,
    )):
        fail("generation source exact byte or Git binding changed")
    if source["maximumObservedDate"] != "2020-12-31" or source["quarterCount"] != 48 or source["firstQuarter"] != "2009q1" or source["lastQuarter"] != "2020q4":
        fail("generation source chronology changed")
    require_typed_equal(
        source["preOutcomeBinding"],
        {"field": "limitations[2]", "exactStatement": PREOUTCOME_STATEMENT},
        "generation source pre-outcome binding",
    )
    if source["allowedGenerationFields"] != ALLOWED_INSPECTED_FIELDS:
        fail("generation source field allowlist changed")
    require_string_list(source["allowedGenerationFields"], "generation source field allowlist", exact=ALLOWED_INSPECTED_FIELDS)
    require_typed_equal(source["sourceValueContract"], EXPECTED_SOURCE_VALUE_CONTRACT, "sourceValueContract")
    if source["sourceValueContractSha256"] != canonical_sha(source["sourceValueContract"]):
        fail("source-value contract hash changed")
    if source["directProposalUseAllowed"] is not True or any(source[key] is not False for key in ("outcomesAccessed", "pricesAccessed", "returnsAccessed")):
        fail("generation source access locks changed")

    proposal_contract = value["proposalContract"]
    exact_keys(proposal_contract, {
        "proposalExactFields", "statusStoredInsideProposal", "statusStorage", "allowedStatuses",
        "seedAllowedEventTypes", "seedDerivedStatus", "laterStatusChangeRequiresNewRegisterVersion",
        "preregisteredRequiresEarlierSeparateRemoteProtocolSeal", "directProposalToTestedForbidden",
        "fullProtocolFieldsDeferred", "exactNestedSchemasAndTypesEnforced",
        "sourcePathsMustResolveAndValuesMustMatchContract",
        "forbiddenOriginScanTraversesDictionaryKeysAndValues",
        "forbiddenClaimsExceptionOnlyAtProposalTopLevel",
    }, "proposalContract")
    if set(proposal_contract["proposalExactFields"]) != PROPOSAL_FIELDS or len(proposal_contract["proposalExactFields"]) != len(PROPOSAL_FIELDS):
        fail("proposal exact-field contract changed")
    if proposal_contract["statusStoredInsideProposal"] is not False or proposal_contract["statusStorage"] != "APPEND_ONLY_HASH_CHAIN_EVENTS_ONLY":
        fail("proposal status immutability changed")
    if proposal_contract["allowedStatuses"] != ["PROPOSAL", "PREREGISTERED", "TESTED", "REJECTED"]:
        fail("status enum changed")
    if proposal_contract["seedAllowedEventTypes"] != ["PROPOSAL_CREATED"] or proposal_contract["seedDerivedStatus"] != "PROPOSAL":
        fail("seed event boundary changed")
    if not all(proposal_contract[key] is True for key in (
        "laterStatusChangeRequiresNewRegisterVersion",
        "preregisteredRequiresEarlierSeparateRemoteProtocolSeal",
        "directProposalToTestedForbidden",
        "exactNestedSchemasAndTypesEnforced",
        "sourcePathsMustResolveAndValuesMustMatchContract",
        "forbiddenOriginScanTraversesDictionaryKeysAndValues",
        "forbiddenClaimsExceptionOnlyAtProposalTopLevel",
    )):
        fail("later protocol gate changed")
    if proposal_contract["fullProtocolFieldsDeferred"] != DEFERRED_FIELDS:
        fail("deferred protocol field contract changed")

    proposals = value["proposals"]
    if type(proposals) is not list or len(proposals) != 1:
        fail("V3 must contain exactly one source-bound proposal")
    proposal = proposals[0]
    exact_keys(proposal, PROPOSAL_FIELDS, "proposal")
    if "status" in proposal:
        fail("status may not be stored inside proposal")
    if proposal["hypothesisId"] != "HYP-SEC-CONCEPT-MAP-MISSINGNESS-001" or proposal["familyId"] != "SOURCE_CONCEPT_ASCERTAINMENT":
        fail("proposal identity changed")
    for field in (
        "hypothesisId", "familyId", "mechanism", "primaryClaim", "expectedDirection",
        "conceptualFalsification", "developmentWindow", "validationWindow",
        "multiplicityFamilyId",
    ):
        require_string(proposal[field], f"proposal.{field}")
    require_string_list(
        proposal["requiredDataCategories"], "proposal.requiredDataCategories",
        exact=["SEC_FSD_CONCEPT_ROLE", "TAXONOMY_VERSION", "PERIOD_KIND", "ACCEPTED_AT"],
    )
    require_string_list(proposal["deferredToSeparateProtocol"], "proposal.deferredToSeparateProtocol", exact=DEFERRED_FIELDS)
    require_string_list(
        proposal["forbiddenClaims"], "proposal.forbiddenClaims",
        exact=["STOCK_RETURN", "FULL_MARKET", "ORIGINAL_V4", "H_LATE", "H_FEM", "SEC_CIK_COMPLETED_STUDY", "CAUSALITY"],
    )
    provenance = proposal["generationProvenance"]
    exact_keys(provenance, {
        "sourceIds", "originClass", "selector", "maximumObservedDate", "inspectedFields",
        "sourceFeatureReceipt", "sourceFeatureReceiptSha256", "outcomesAccessed",
        "pricesAccessed", "returnsAccessed", "sourcePathsResolved", "sourceValuesValidated",
        "sourceValueContractSha256",
    }, "generationProvenance")
    require_string_list(provenance["sourceIds"], "generationProvenance.sourceIds", exact=[source["sourceId"]])
    if provenance["originClass"] != "THEORY_AND_SOURCE_FEATURES_ONLY":
        fail("proposal source provenance changed")
    if provenance["selector"] != "EXACT_BOUND_REPORT_ONLY_AND_SCOPE_QUARTERS_END_2020Q4" or provenance["maximumObservedDate"] != "2020-12-31":
        fail("proposal pre-2021 selector changed")
    if provenance["inspectedFields"] != ALLOWED_INSPECTED_FIELDS:
        fail("proposal inspected-field allowlist changed")
    require_string_list(provenance["inspectedFields"], "proposal inspected fields", exact=ALLOWED_INSPECTED_FIELDS)
    if provenance["sourcePathsResolved"] is not True or provenance["sourceValuesValidated"] is not True:
        fail("proposal source-validation receipt changed")
    if provenance["sourceValueContractSha256"] != source["sourceValueContractSha256"]:
        fail("proposal source-value contract binding changed")
    if any(provenance[key] is not False for key in ("outcomesAccessed", "pricesAccessed", "returnsAccessed")):
        fail("proposal provenance access locks changed")
    receipt = provenance["sourceFeatureReceipt"]
    expected_receipt = {
        "schema": "early-detection-hypothesis-source-feature-receipt/v3",
        "sourceRawSha256": source["rawSha256"],
        "sourceValueContractSha256": source["sourceValueContractSha256"],
        "quarterCount": 48,
        "firstQuarter": "2009q1",
        "lastQuarter": "2020q4",
        "maximumObservedDate": "2020-12-31",
        "preOutcomeStatement": PREOUTCOME_STATEMENT,
    }
    require_typed_equal(receipt, expected_receipt, "sourceFeatureReceipt")
    if provenance["sourceFeatureReceiptSha256"] != canonical_sha(receipt):
        fail("source-feature receipt self hash changed")
    if proposal["developmentWindow"] != "2009Q1/2016Q4" or proposal["validationWindow"] != "2017Q1/2020Q4":
        fail("proposal chronology changed")
    if proposal["deferredToSeparateProtocol"] != DEFERRED_FIELDS:
        fail("proposal deferred fields changed")
    scan_value = {key: val for key, val in proposal.items() if key != "forbiddenClaims"}
    if contains_forbidden_origin(scan_value):
        fail("proposal contains forbidden origin or outcome input")
    if proposal["proposalSha256"] != proposal_sha(proposal):
        fail("proposal self hash changed")
    require_sha(proposal["proposalSha256"], "proposal.proposalSha256")

    events = value["events"]
    if type(events) is not list or len(events) != 1:
        fail("seed register must contain one creation event per proposal")
    event = events[0]
    exact_keys(event, EVENT_FIELDS, "event")
    if type(event["sequence"]) is not int:
        fail("event sequence type changed")
    for field in ("schema", "eventId", "createdAt", "hypothesisId", "eventType", "proposalSha256", "statusAfter", "eventSha256"):
        require_string(event[field], f"event.{field}")
    if event["schema"] != "early-detection-hypothesis-register-event/v3" or event["sequence"] != 1:
        fail("event schema or sequence changed")
    if event["eventId"] != "HYP-V3-EVENT-0001" or event["hypothesisId"] != proposal["hypothesisId"]:
        fail("event identity changed")
    if event["createdAt"] != value["createdAt"]:
        fail("event creation timestamp changed")
    if event["eventType"] != "PROPOSAL_CREATED" or event["statusAfter"] != "PROPOSAL":
        fail("seed event type or derived status changed")
    if event["previousEventSha256"] is not None or event["protocolBinding"] is not None:
        fail("seed event must be a protocol-free hash-chain genesis")
    if event["proposalSha256"] != proposal["proposalSha256"]:
        fail("event proposal binding changed")
    if event["eventSha256"] != event_sha(event):
        fail("event self hash changed")
    require_sha(event["eventSha256"], "event.eventSha256")

    require_typed_equal(value["scientificLocks"], EXPECTED_LOCKS, "scientificLocks")

    owned = value["ownedBindings"]
    exact_keys(owned, {"contract", "verifier", "test"}, "ownedBindings")
    if owned["contract"] != {"path": OWNED_PATHS[0], "binding": "EXACT_RAW_AND_CANONICAL_SELF"}:
        fail("owned contract binding changed")
    exact_keys(owned["verifier"], {"path", "binding", "normalization", "normalizedRawSha256"}, "owned verifier")
    if owned["verifier"]["path"] != OWNED_PATHS[1] or owned["verifier"]["binding"] != "NORMALIZED_RAW_SHA256" or owned["verifier"]["normalization"] != "ONLY_FOUR_EXPECTED_HASH_CONSTANT_VALUES_ZEROED":
        fail("owned verifier policy changed")
    if owned["verifier"]["normalizedRawSha256"] != EXPECTED_VERIFIER_NORMALIZED:
        fail("owned verifier normalized binding changed")
    exact_keys(owned["test"], {"path", "binding", "rawSha256"}, "owned test")
    if owned["test"] != {"path": OWNED_PATHS[2], "binding": "EXACT_RAW_SHA256", "rawSha256": EXPECTED_TEST_RAW}:
        fail("owned test binding changed")

    if exact_artifact:
        contract_raw = CONTRACT.read_bytes()
        if sha(contract_raw) != EXPECTED_CONTRACT_RAW:
            fail("contract raw bytes changed")
        if sha(normalize_verifier(SCRIPT.read_bytes())) != EXPECTED_VERIFIER_NORMALIZED:
            fail("verifier normalized bytes changed")
        if sha(TEST.read_bytes()) != EXPECTED_TEST_RAW:
            fail("test raw bytes changed")
    if dependencies:
        validate_dependencies(value)


def introduction_phase(*, remote: bool) -> str:
    head = git_text("rev-parse", "HEAD")
    if remote:
        if git_text("remote", "get-url", "origin") != AUTHORIZED_REMOTE:
            fail("origin URL changed")
        rows = git_text("ls-remote", "--refs", AUTHORIZED_REMOTE, AUTHORIZED_REF).splitlines()
        if len(rows) != 1:
            fail("authorized remote ref did not resolve exactly once")
        remote_head, remote_ref = rows[0].split()
        if remote_ref != AUTHORIZED_REF or remote_head != head:
            fail("local HEAD is not exact authorized remote HEAD")
    require_first_parent_ancestor(BUILD_BASE, head, "build base")
    require_first_parent_ancestor(CONSTRUCTION_HEAD, head, "construction head")

    present: list[bool] = []
    for path in OWNED_PATHS:
        result = subprocess.run(
            ["git", "cat-file", "-e", f"{head}:{path}"], cwd=ROOT,
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        present.append(result.returncode == 0)
    if not any(present):
        return "PRE_INTRODUCTION"
    if not all(present):
        fail("owned paths were only partially introduced")

    introductions: list[str] = []
    for path in OWNED_PATHS:
        rows = git_text("log", "--format=%H", "--diff-filter=A", "--reverse", f"{CONSTRUCTION_HEAD}..{head}", "--", path).splitlines()
        if len(rows) != 1:
            fail("owned path introduction is not unique after construction head")
        introductions.append(rows[0])
    if len(set(introductions)) != 1:
        fail("owned paths were not introduced together")
    introduction = introductions[0]
    require_first_parent_ancestor(BUILD_BASE, introduction, "introduction build base")
    require_first_parent_ancestor(CONSTRUCTION_HEAD, introduction, "introduction construction head")
    require_first_parent_ancestor(introduction, head, "introduction remote head")
    parents = git_text("show", "-s", "--format=%P", introduction).split()
    if len(parents) != 1:
        fail("introduction commit must have exactly one parent")
    changed = []
    for line in git_text("diff-tree", "--no-commit-id", "--name-status", "-r", "--no-renames", introduction).splitlines():
        parts = line.split("\t", 1)
        if len(parts) != 2:
            fail("introduction diff format changed")
        changed.append(parts)
    if changed != [["A", path] for path in OWNED_PATHS]:
        fail("introduction commit did not add exactly the three authorized paths in order")
    for path in OWNED_PATHS:
        local = safe_path(path).read_bytes()
        if git_bytes("show", f"{introduction}:{path}") != local or git_bytes("show", f"{head}:{path}") != local:
            fail("owned artifact changed after introduction")
    return "POST_INTRODUCTION"


def reseal(value: dict[str, Any]) -> None:
    sources = value.get("evidenceSources", [])
    if isinstance(sources, list):
        for source in sources:
            if isinstance(source, dict) and isinstance(source.get("sourceValueContract"), dict):
                source["sourceValueContractSha256"] = canonical_sha(source["sourceValueContract"])
    for proposal in value.get("proposals", []):
        provenance = proposal.get("generationProvenance")
        if isinstance(provenance, dict) and isinstance(provenance.get("sourceFeatureReceipt"), dict):
            if sources and isinstance(sources[0], dict):
                provenance["sourceValueContractSha256"] = sources[0].get("sourceValueContractSha256")
                provenance["sourceFeatureReceipt"]["sourceValueContractSha256"] = sources[0].get("sourceValueContractSha256")
            provenance["sourceFeatureReceiptSha256"] = canonical_sha(provenance["sourceFeatureReceipt"])
        proposal["proposalSha256"] = proposal_sha(proposal)
    previous: str | None = None
    by_id = {row.get("hypothesisId"): row for row in value.get("proposals", []) if isinstance(row, dict)}
    for index, event in enumerate(value.get("events", []), start=1):
        event["sequence"] = index
        event["previousEventSha256"] = previous
        proposal = by_id.get(event.get("hypothesisId"))
        if proposal is not None:
            event["proposalSha256"] = proposal["proposalSha256"]
        event["eventSha256"] = event_sha(event)
        previous = event["eventSha256"]
    body = {key: val for key, val in value.items() if key != "contractSha256"}
    value["contractSha256"] = canonical_sha(body)


def self_test(base_value: dict[str, Any]) -> dict[str, Any]:
    mutations: dict[str, tuple[Callable[[dict[str, Any]], None], str]] = {
        "buildBase": (lambda x: x["sourceBase"].__setitem__("buildBase", "1" * 40), "all"),
        "constructionHead": (lambda x: x["sourceBase"].__setitem__("constructionHead", "1" * 40), "all"),
        "directChildLie": (lambda x: x["sourceBase"].__setitem__("interveningLinearCommitsBeforeIntroductionAllowed", False), "all"),
        "authorizedPathOrder": (lambda x: x["sourceBase"]["authorizedPaths"].reverse(), "all"),
        "v2Raw": (lambda x: x["priorRegister"].__setitem__("rawSha256", "1" * 64), "all"),
        "v2Blob": (lambda x: x["priorRegister"].__setitem__("gitBlob", "1" * 40), "all"),
        "v2Mutable": (lambda x: x["priorRegister"].__setitem__("historicalDefinitionsOrStatusesMutated", True), "all"),
        "resumeRaw": (lambda x: x["operationalResume"]["resumeV2"].__setitem__("rawSha256", "1" * 64), "all"),
        "resumeBlob": (lambda x: x["operationalResume"]["resumeV2"].__setitem__("gitBlob", "1" * 40), "all"),
        "harnessRaw": (lambda x: x["operationalResume"]["harnessV3"]["contract"].__setitem__("rawSha256", "1" * 64), "all"),
        "harnessBlob": (lambda x: x["operationalResume"]["harnessV3"]["contract"].__setitem__("gitBlob", "1" * 40), "all"),
        "sourceRaw": (lambda x: x["evidenceSources"][0].__setitem__("rawSha256", "1" * 64), "all"),
        "sourceBlob": (lambda x: x["evidenceSources"][0].__setitem__("gitBlob", "1" * 40), "all"),
        "sourcePath": (lambda x: x["evidenceSources"][0].__setitem__("path", "reports/early-detection/other.json"), "all"),
        "sourceIntroduction": (lambda x: x["evidenceSources"][0].__setitem__("introductionCommit", "1" * 40), "all"),
        "sourceReservedDate": (lambda x: x["evidenceSources"][0].__setitem__("maximumObservedDate", "2021-01-01"), "all"),
        "sourceQuarterCount": (lambda x: x["evidenceSources"][0].__setitem__("quarterCount", 49), "all"),
        "sourceValueContract": (lambda x: x["evidenceSources"][0]["sourceValueContract"].__setitem__("coverageRowCount", 903), "all"),
        "sourceValueContractHash": (lambda x: x["evidenceSources"][0].__setitem__("sourceValueContractSha256", "1" * 64), "contract"),
        "preOutcomeStatement": (lambda x: x["evidenceSources"][0]["preOutcomeBinding"].__setitem__("exactStatement", "changed"), "all"),
        "generationProvenanceMissing": (lambda x: x["proposals"][0].pop("generationProvenance"), "all"),
        "unknownSource": (lambda x: x["proposals"][0]["generationProvenance"].__setitem__("sourceIds", ["UNKNOWN"]), "all"),
        "selectorChanged": (lambda x: x["proposals"][0]["generationProvenance"].__setitem__("selector", "NO_DATE_FILTER"), "all"),
        "reservedProposalDate": (lambda x: x["proposals"][0]["generationProvenance"].__setitem__("maximumObservedDate", "2021-01-01"), "all"),
        "unapprovedInspectedField": (lambda x: x["proposals"][0]["generationProvenance"]["inspectedFields"].append("scope.database"), "all"),
        "omittedCoverageLevel": (
            lambda x: (
                x["evidenceSources"][0]["allowedGenerationFields"].__setitem__(4, "roles.*.candidates.*.taxonomyVersion"),
                x["proposals"][0]["generationProvenance"]["inspectedFields"].__setitem__(4, "roles.*.candidates.*.taxonomyVersion"),
            ),
            "all",
        ),
        "sourcePathsUnresolved": (lambda x: x["proposals"][0]["generationProvenance"].__setitem__("sourcePathsResolved", False), "all"),
        "sourceValuesUnvalidated": (lambda x: x["proposals"][0]["generationProvenance"].__setitem__("sourceValuesValidated", False), "all"),
        "proposalStatusInjected": (lambda x: x["proposals"][0].__setitem__("status", "PROPOSAL"), "all"),
        "nonStringPrimaryClaim": (lambda x: x["proposals"][0].__setitem__("primaryClaim", {"text": "claim"}), "all"),
        "proposalHash": (lambda x: x["proposals"][0].__setitem__("proposalSha256", "1" * 64), "contract"),
        "receiptHash": (lambda x: x["proposals"][0]["generationProvenance"].__setitem__("sourceFeatureReceiptSha256", "1" * 64), "proposal"),
        "receiptSchema": (lambda x: x["proposals"][0]["generationProvenance"]["sourceFeatureReceipt"].__setitem__("schema", "changed"), "all"),
        "artificialPendingProposal": (lambda x: x["proposals"].append(copy.deepcopy(x["proposals"][0])), "all"),
        "deferredFieldDropped": (lambda x: x["proposals"][0]["deferredToSeparateProtocol"].pop(), "all"),
        "protocolFieldInjected": (lambda x: x["proposals"][0].__setitem__("endpoint", "not allowed"), "all"),
        "eventTypeTested": (lambda x: x["events"][0].__setitem__("eventType", "TESTED"), "all"),
        "eventProtocolBinding": (lambda x: x["events"][0].__setitem__("protocolBinding", {}), "all"),
        "eventHash": (lambda x: x["events"][0].__setitem__("eventSha256", "1" * 64), "contract"),
        "eventChain": (lambda x: x["events"][0].__setitem__("previousEventSha256", "1" * 64), "event"),
        "duplicateEvent": (lambda x: x["events"].append(copy.deepcopy(x["events"][0])), "all"),
        "executionAuthorized": (lambda x: x["scientificLocks"].__setitem__("proposalExecutionAuthorized", True), "all"),
        "studyCredit": (lambda x: x["scientificLocks"].__setitem__("studyCredit", "SCIENTIFIC"), "all"),
        "originalV4Credit": (lambda x: x["scientificLocks"].__setitem__("originalV4GateCredit", True), "all"),
        "humanAttestation": (lambda x: x["scientificLocks"].__setitem__("humanAttestation", True), "all"),
        "resultComputation": (lambda x: x["scientificLocks"].__setitem__("resultComputationAllowed", True), "all"),
        "reservedPeriodOpened": (lambda x: x["generationBoundary"].__setitem__("reservedPeriodOpenedForIdeaGeneration", True), "all"),
        "secCikGeneration": (lambda x: x["generationBoundary"].__setitem__("completedSecCikStudyMayBeUsedForGeneration", True), "all"),
        "forbiddenOriginalV4": (lambda x: x["proposals"][0].__setitem__("mechanism", "Use ORIGINAL V4 result"), "all"),
        "forbiddenHLate": (lambda x: x["proposals"][0].__setitem__("mechanism", "Use H-LATE endpoint value"), "all"),
        "forbiddenHFem": (lambda x: x["proposals"][0].__setitem__("mechanism", "Use H_FEM result"), "all"),
        "forbiddenSecCik": (lambda x: x["proposals"][0].__setitem__("mechanism", "Use SEC CIK completed study result"), "all"),
        "forbiddenReturn": (lambda x: x["proposals"][0].__setitem__("mechanism", "Use stock return value"), "all"),
        "forbiddenBestCutoff": (lambda x: x["proposals"][0].__setitem__("mechanism", "Choose best cutoff from analysis ledger"), "all"),
        "verifierBinding": (lambda x: x["ownedBindings"]["verifier"].__setitem__("normalizedRawSha256", "1" * 64), "all"),
        "testBinding": (lambda x: x["ownedBindings"]["test"].__setitem__("rawSha256", "1" * 64), "all"),
        "contractSelf": (lambda x: x.__setitem__("contractSha256", "1" * 64), "none"),
    }
    kills: dict[str, bool] = {}
    for name, (mutate, repair) in mutations.items():
        item = copy.deepcopy(base_value)
        mutate(item)
        if repair == "all":
            reseal(item)
        elif repair == "proposal":
            proposal = item["proposals"][0]
            proposal["proposalSha256"] = proposal_sha(proposal)
            item["events"][0]["proposalSha256"] = proposal["proposalSha256"]
            item["events"][0]["eventSha256"] = event_sha(item["events"][0])
            item["contractSha256"] = canonical_sha({key: val for key, val in item.items() if key != "contractSha256"})
        elif repair == "event":
            item["events"][0]["eventSha256"] = event_sha(item["events"][0])
            item["contractSha256"] = canonical_sha({key: val for key, val in item.items() if key != "contractSha256"})
        elif repair == "contract":
            item["contractSha256"] = canonical_sha({key: val for key, val in item.items() if key != "contractSha256"})
        try:
            validate_contract(item, exact_artifact=False, dependencies=False)
        except (ContractError, KeyError, TypeError, ValueError):
            kills[name] = True
        else:
            kills[name] = False
    nested_key_cases = {
        "forbiddenNestedKeyOriginalV4Result": "OriginalV4Result",
        "forbiddenNestedKeySecCik": "SEC-CIK",
        "forbiddenNestedKeyHLate": "HLate",
        "forbiddenNestedKeyHFem": "HFem",
        "forbiddenNestedKeyStockReturn": "stockReturn",
        "forbiddenNestedKeyAnalysisLedger": "analysisLedger",
    }
    for name, key in nested_key_cases.items():
        kills[name] = contains_forbidden_origin({"outer": [{"inner": {key: "theory"}}]})
    report = json.loads(safe_path(base_value["evidenceSources"][0]["path"]).read_bytes())
    try:
        resolve_path(report, "roles.*.candidates.*.coverage.*.doesNotExist")
    except ContractError:
        kills["nonexistentAllowlistPath"] = True
    else:
        kills["nonexistentAllowlistPath"] = False
    proposal = base_value["proposals"][0]
    scan_value = {key: val for key, val in proposal.items() if key != "forbiddenClaims"}
    kills["forbiddenClaimsOnlyException"] = (
        contains_forbidden_origin({"forbiddenClaims": proposal["forbiddenClaims"]})
        and not contains_forbidden_origin(scan_value)
    )
    if not kills or not all(kills.values()):
        survivors = sorted(name for name, killed in kills.items() if not killed)
        fail(f"self-test kill fixture survived: {survivors}")
    return {
        "schema": "early-detection-hypothesis-register-self-test/v3",
        "status": "PASS",
        "kills": kills,
        "killCount": len(kills),
        "outcomesAccessed": False,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    verify_parser = sub.add_parser("verify")
    verify_parser.add_argument("--remote", action="store_true")
    sub.add_parser("self-test")
    args = parser.parse_args()
    try:
        value = json.loads(CONTRACT.read_bytes())
        validate_contract(value, exact_artifact=True, dependencies=True)
        if args.command == "self-test":
            result = self_test(value)
        else:
            phase = introduction_phase(remote=args.remote)
            result = {
                "schema": "early-detection-hypothesis-register-verification/v3",
                "status": "PASS",
                "phase": phase,
                "proposals": 1,
                "events": 1,
                "eligibleSources": 1,
                "derivedStatus": "PROPOSAL",
                "proposalExecutionAuthorized": False,
                "studyCredit": "NONE",
                "maximumObservedDate": "2020-12-31",
                "outcomesAccessed": False,
            }
    except (ContractError, OSError, json.JSONDecodeError, subprocess.CalledProcessError, KeyError, TypeError, ValueError) as exc:
        parser.error(str(exc))
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

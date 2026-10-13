#!/usr/bin/env python3
"""Prepare and verify the run-bound independent-human blind-coding gate."""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import subprocess
import tempfile
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from typing import Any, Callable


PROTOCOL = "FEM-SEC-US@1.2.0"
KIT_SCHEMA = "early-detection-blind-coding-kit/v2"
RUN_SCHEMA = "early-detection-blind-coding-run-binding/v2"
ATTESTATION_SCHEMA = "early-detection-blind-coding-attestation/v2"
DECISION_SCHEMA = "early-detection-blind-coding-agreement/v2"
KAPPA_MINIMUM = 0.70
EXACT_MINIMUM = 0.80
CATEGORIES = (0, 1, 2, 3)
DIMENSIONS = ("T", "E", "L")
CASE_FIELDS = (
    "item_id", "entity_id", "listing_id", "theme_id", "as_of",
    "source_bundle_id", "version",
)
SOURCE_FIELDS = (
    "source_bundle_id", "source_id", "exact_locator", "published_at",
    "retrieved_at", "known_at", "evidence_class", "payload_sha256",
)
CODER_FIELDS = (
    "item_id", "entity_id", "listing_id", "theme_id", "dimension", "level",
    "as_of", "source_bundle_id", "source_id", "exact_locator", "published_at",
    "retrieved_at", "known_at", "evidence_class", "counterevidence",
    "coder_id", "version",
)


class BlindCodingError(RuntimeError):
    pass


def canonical_sha256(value: Any) -> str:
    payload = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def file_sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def is_sha256(value: Any) -> bool:
    return isinstance(value, str) and len(value) == 64 and all(char in "0123456789abcdef" for char in value)


def is_commit(value: Any) -> bool:
    return isinstance(value, str) and len(value) == 40 and all(char in "0123456789abcdef" for char in value)


def timestamp(value: Any, field: str) -> datetime:
    if not isinstance(value, str) or not value.strip():
        raise BlindCodingError(f"missing {field} timestamp")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise BlindCodingError(f"invalid {field} timestamp: {value}") from exc
    if parsed.tzinfo is None:
        raise BlindCodingError(f"{field} must carry a timezone")
    return parsed.astimezone(timezone.utc)


def safe_relative(value: Any) -> str:
    if not isinstance(value, str) or not value.strip():
        raise BlindCodingError("blank repository-relative path")
    normalized = value.replace("\\", "/")
    path = PurePosixPath(normalized)
    if path.is_absolute() or any(part in {"", ".", ".."} for part in path.parts):
        raise BlindCodingError(f"unsafe repository-relative path: {value}")
    return path.as_posix()


def signed(value: dict[str, Any]) -> dict[str, Any]:
    result = dict(value)
    result["reportSha256"] = canonical_sha256(result)
    return result


def verify_signed(value: dict[str, Any], label: str) -> None:
    expected = value.get("reportSha256")
    unsigned = {key: item for key, item in value.items() if key != "reportSha256"}
    if not is_sha256(expected) or canonical_sha256(unsigned) != expected:
        raise BlindCodingError(f"{label} signature mismatch")


def load_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise BlindCodingError(f"cannot load JSON {path}: {exc}") from exc
    if not isinstance(value, dict):
        raise BlindCodingError(f"JSON root must be an object: {path}")
    return value


def csv_text(fields: tuple[str, ...], rows: list[dict[str, Any]]) -> str:
    handle = io.StringIO(newline="")
    writer = csv.DictWriter(handle, fieldnames=fields, lineterminator="\n")
    writer.writeheader()
    writer.writerows(rows)
    return handle.getvalue()


def write_utf8(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(text.encode("utf-8"))


def write_json(path: Path, value: Any) -> None:
    write_utf8(path, json.dumps(value, ensure_ascii=False, indent=2) + "\n")


def read_csv(path: Path, fields: tuple[str, ...]) -> list[dict[str, str]]:
    try:
        with path.open("r", encoding="utf-8-sig", newline="") as handle:
            reader = csv.DictReader(handle)
            if reader.fieldnames is None or tuple(reader.fieldnames) != fields:
                raise BlindCodingError(f"CSV header differs from sealed schema: {path.name}")
            return [dict(row) for row in reader]
    except (OSError, UnicodeDecodeError, csv.Error) as exc:
        raise BlindCodingError(f"cannot load CSV {path}: {exc}") from exc


def git_bytes(repository: Path, commit: str, path: str) -> bytes:
    relative = safe_relative(path)
    result = subprocess.run(
        ["git", "-C", str(repository), "show", f"{commit}:{relative}"],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False,
    )
    if result.returncode != 0:
        message = result.stderr.decode("utf-8", errors="replace").strip()
        raise BlindCodingError(f"remote artifact missing at {commit}:{relative}: {message}")
    return result.stdout


def require_ancestor(repository: Path, ancestor: str, descendant: str = "origin/main") -> None:
    result = subprocess.run(
        ["git", "-C", str(repository), "merge-base", "--is-ancestor", ancestor, descendant],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False,
    )
    if result.returncode != 0:
        raise BlindCodingError(f"candidate commit is not reachable from {descendant}")


def load_cases(path: Path) -> dict[str, dict[str, str]]:
    rows = read_csv(path, CASE_FIELDS)
    if not rows:
        raise BlindCodingError("case manifest contains no items")
    cases: dict[str, dict[str, str]] = {}
    for line, row in enumerate(rows, start=2):
        if any(not str(row.get(field, "")).strip() for field in CASE_FIELDS):
            raise BlindCodingError(f"blank case field at line {line}")
        item_id = row["item_id"].strip()
        if item_id in cases:
            raise BlindCodingError(f"duplicate case item_id: {item_id}")
        timestamp(row["as_of"], f"case[{item_id}].as_of")
        cases[item_id] = {field: row[field].strip() for field in CASE_FIELDS}
    return cases


def load_sources(path: Path) -> dict[tuple[str, str, str], dict[str, str]]:
    rows = read_csv(path, SOURCE_FIELDS)
    if not rows:
        raise BlindCodingError("source-bundle manifest contains no sources")
    sources: dict[tuple[str, str, str], dict[str, str]] = {}
    for line, row in enumerate(rows, start=2):
        if any(not str(row.get(field, "")).strip() for field in SOURCE_FIELDS):
            raise BlindCodingError(f"blank source field at line {line}")
        if not is_sha256(row["payload_sha256"].strip()):
            raise BlindCodingError(f"invalid source payload SHA-256 at line {line}")
        published = timestamp(row["published_at"], f"source line {line}.published_at")
        known = timestamp(row["known_at"], f"source line {line}.known_at")
        timestamp(row["retrieved_at"], f"source line {line}.retrieved_at")
        if published > known:
            raise BlindCodingError(f"source known_at precedes published_at at line {line}")
        key = tuple(row[field].strip() for field in ("source_bundle_id", "source_id", "exact_locator"))
        if key in sources:
            raise BlindCodingError(f"duplicate source identity at line {line}: {key}")
        sources[key] = {field: row[field].strip() for field in SOURCE_FIELDS}
    return sources


def load_coder(
    path: Path, cases: dict[str, dict[str, str]],
    sources: dict[tuple[str, str, str], dict[str, str]],
) -> tuple[str, str, dict[tuple[str, str], dict[str, Any]]]:
    rows = read_csv(path, CODER_FIELDS)
    if not rows:
        raise BlindCodingError("coder file contains no decisions")
    decisions: dict[tuple[str, str], dict[str, Any]] = {}
    coder_ids: set[str] = set()
    versions: set[str] = set()
    identity_fields = ("entity_id", "listing_id", "theme_id", "as_of", "source_bundle_id", "version")
    source_fields = ("published_at", "retrieved_at", "known_at", "evidence_class")
    for line, row in enumerate(rows, start=2):
        if any(not str(row.get(field, "")).strip() for field in CODER_FIELDS):
            raise BlindCodingError(f"blank coder field at line {line}")
        item_id = row["item_id"].strip()
        case = cases.get(item_id)
        if case is None:
            raise BlindCodingError(f"coder contains undeclared item: {item_id}")
        mismatches = [field for field in identity_fields if row[field].strip() != case[field]]
        if mismatches:
            raise BlindCodingError(f"case identity differs for {item_id}: fields={mismatches}")
        dimension = row["dimension"].strip().upper()
        if dimension not in DIMENSIONS:
            raise BlindCodingError(f"unsupported dimension at line {line}: {dimension}")
        try:
            level = int(row["level"])
        except ValueError as exc:
            raise BlindCodingError(f"non-integer level at line {line}") from exc
        if level not in CATEGORIES:
            raise BlindCodingError(f"level outside 0..3 at line {line}")
        source_key = (
            row["source_bundle_id"].strip(), row["source_id"].strip(),
            row["exact_locator"].strip(),
        )
        source = sources.get(source_key)
        if source is None:
            raise BlindCodingError(f"coder cites source outside frozen bundle at line {line}")
        if any(row[field].strip() != source[field] for field in source_fields):
            raise BlindCodingError(f"coder source metadata differs from frozen bundle at line {line}")
        as_of = timestamp(row["as_of"], f"coder line {line}.as_of")
        if timestamp(row["published_at"], f"coder line {line}.published_at") > as_of \
                or timestamp(row["known_at"], f"coder line {line}.known_at") > as_of:
            raise BlindCodingError(f"source became available after item cutoff at line {line}")
        key = (item_id, dimension)
        if key in decisions:
            raise BlindCodingError(f"duplicate item/dimension decision: {key}")
        coder_id = row["coder_id"].strip()
        coder_ids.add(coder_id)
        versions.add(row["version"].strip())
        decisions[key] = {**row, "dimension": dimension, "level": level}
    expected = {(item_id, dimension) for item_id in cases for dimension in DIMENSIONS}
    if set(decisions) != expected:
        missing = sorted(expected - set(decisions))
        extra = sorted(set(decisions) - expected)
        raise BlindCodingError(f"coder item/dimension set differs from frozen cases: missing={missing[:5]} extra={extra[:5]}")
    if len(coder_ids) != 1 or len(versions) != 1:
        raise BlindCodingError("each coder file must use exactly one coder_id and version")
    return next(iter(coder_ids)), next(iter(versions)), decisions


def weighted_kappa(left: list[int], right: list[int], power: int) -> float | None:
    if len(left) != len(right) or not left:
        raise BlindCodingError("paired labels are missing")
    count = len(left)
    matrix = Counter(zip(left, right))
    marginal_left = Counter(left)
    marginal_right = Counter(right)
    denominator = len(CATEGORIES) - 1

    def distance(a: int, b: int) -> float:
        return (abs(a - b) / denominator) ** power

    observed = sum(distance(a, b) * n for (a, b), n in matrix.items()) / count
    expected = sum(
        distance(a, b) * (marginal_left[a] / count) * (marginal_right[b] / count)
        for a in CATEGORIES for b in CATEGORIES
    )
    if expected <= 1e-15:
        return None
    return max(-1.0, min(1.0, 1.0 - observed / expected))


def agreement(rows_a: dict[tuple[str, str], dict[str, Any]], rows_b: dict[tuple[str, str], dict[str, Any]]) -> dict[str, Any]:
    if set(rows_a) != set(rows_b):
        raise BlindCodingError("coder item/dimension sets differ")
    keys = sorted(rows_a)
    exact = sum(rows_a[key]["level"] == rows_b[key]["level"] for key in keys) / len(keys)
    pairs_by_dimension: dict[str, list[tuple[int, int]]] = defaultdict(list)
    for key in keys:
        pairs_by_dimension[key[1]].append((rows_a[key]["level"], rows_b[key]["level"]))
    dimensions: dict[str, Any] = {}
    has_fail = exact < EXACT_MINIMUM
    has_ambiguity = False
    for dimension in DIMENSIONS:
        pairs = pairs_by_dimension[dimension]
        linear = weighted_kappa([pair[0] for pair in pairs], [pair[1] for pair in pairs], 1)
        quadratic = weighted_kappa([pair[0] for pair in pairs], [pair[1] for pair in pairs], 2)
        if linear is None or quadratic is None:
            status = "NOT_COMPUTABLE_NO_LABEL_VARIATION"
            has_ambiguity = True
        elif min(linear, quadratic) >= KAPPA_MINIMUM:
            status = "PASS_WEIGHT_INVARIANT"
        elif max(linear, quadratic) < KAPPA_MINIMUM:
            status = "FAIL_WEIGHT_INVARIANT"
            has_fail = True
        else:
            status = "NOT_COMPUTABLE_WEIGHT_SCHEME_UNSPECIFIED"
            has_ambiguity = True
        dimensions[dimension] = {
            "n": len(pairs),
            "exactAgreement": sum(a == b for a, b in pairs) / len(pairs),
            "linearWeightedKappa": linear,
            "quadraticWeightedKappa": quadratic,
            "status": status,
        }
    decision = "FAIL" if has_fail else ("NOT_COMPUTABLE" if has_ambiguity else "PASS_WEIGHT_INVARIANT")
    return {
        "decision": decision, "pairedDecisions": len(keys),
        "overallExactAgreement": exact, "dimensions": dimensions,
    }


def validate_run_binding(
    repository: Path, run: dict[str, Any], run_path: Path, manifest_path: Path,
    case_path: Path, source_path: Path, rules_path: Path,
    loader: Callable[[str, str], bytes] | None = None,
    ancestor_check: Callable[[Path, str], None] | None = None,
) -> datetime:
    required_hashes = (
        "kitManifestFileSha256", "caseManifestFileSha256",
        "sourceBundleManifestFileSha256", "codingRulesFileSha256",
        "researchCorpusSha256",
    )
    required_paths = (
        "kitManifestPath", "caseManifestPath", "sourceBundleManifestPath", "codingRulesPath",
    )
    if run.get("schema") != RUN_SCHEMA or run.get("protocol") != PROTOCOL \
            or not str(run.get("runId", "")).strip() \
            or not is_commit(run.get("candidateRemoteCommit")) \
            or not all(is_sha256(run.get(field)) for field in required_hashes) \
            or run.get("outcomesAccessed") is not False:
        raise BlindCodingError("run binding is incomplete")
    frozen_at = timestamp(run.get("packageFrozenAt"), "packageFrozenAt")
    paths = {field: safe_relative(run.get(field)) for field in required_paths}
    local = {
        "kitManifestFileSha256": manifest_path,
        "caseManifestFileSha256": case_path,
        "sourceBundleManifestFileSha256": source_path,
        "codingRulesFileSha256": rules_path,
    }
    for field, path in local.items():
        if file_sha256(path) != run[field]:
            raise BlindCodingError(f"local file differs from run binding: {field}")
    checker = ancestor_check or (lambda repo, commit: require_ancestor(repo, commit))
    checker(repository, run["candidateRemoteCommit"])
    active_loader = loader or (lambda commit, path: git_bytes(repository, commit, path))
    remote_fields = (
        ("kitManifestPath", "kitManifestFileSha256"),
        ("caseManifestPath", "caseManifestFileSha256"),
        ("sourceBundleManifestPath", "sourceBundleManifestFileSha256"),
        ("codingRulesPath", "codingRulesFileSha256"),
    )
    for path_field, hash_field in remote_fields:
        if hashlib.sha256(active_loader(run["candidateRemoteCommit"], paths[path_field])).hexdigest() != run[hash_field]:
            raise BlindCodingError(f"remote file differs from run binding: {path_field}")
    if not is_sha256(file_sha256(run_path)):
        raise BlindCodingError("run-binding file is unreadable")
    return frozen_at


def validate_attestation(
    value: dict[str, Any], coder_id: str, coder_file_sha256: str,
    run_binding_sha256: str, run: dict[str, Any], frozen_at: datetime,
) -> str:
    coder_name = str(value.get("coderName", "")).strip()
    signature_name = str(value.get("signatureName", "")).strip()
    started = timestamp(value.get("startedAt"), "attestation.startedAt")
    completed = timestamp(value.get("completedAt"), "attestation.completedAt")
    required_true = (
        "independentFromOtherCoderAttested", "noCommunicationWithOtherCoderBeforeCompletionAttested",
        "independentFromProducingSystemAttested", "noStudyDesignDataOrCodeContributionAttested",
        "sameFrozenCaseAndSourcePackageReceivedAttested", "equalResearchBudgetAttested",
        "noLaterSourcesAccessAttested", "noPricePathsAccessAttested",
        "noGqsDatesAccessAttested", "noOutcomeLabelsAccessAttested",
    )
    checks = (
        value.get("schema") == ATTESTATION_SCHEMA,
        value.get("coderType") == "HUMAN",
        value.get("coderId") == coder_id,
        bool(coder_name), bool(signature_name), signature_name == coder_name,
        started >= frozen_at, completed >= started,
        all(value.get(field) is True for field in required_true),
        value.get("runBindingFileSha256") == run_binding_sha256,
        value.get("caseManifestFileSha256") == run.get("caseManifestFileSha256"),
        value.get("sourceBundleManifestFileSha256") == run.get("sourceBundleManifestFileSha256"),
        value.get("codingRulesFileSha256") == run.get("codingRulesFileSha256"),
        value.get("coderFileSha256") == coder_file_sha256,
    )
    if not all(checks):
        raise BlindCodingError(f"attestation invalid or not bound to exact package for coder {coder_id}")
    return coder_name


def evaluate_bundle(
    repository: Path, manifest_path: Path, run_path: Path, case_path: Path,
    source_path: Path, rules_path: Path, coder_a_path: Path, attestation_a_path: Path,
    coder_b_path: Path, attestation_b_path: Path,
    loader: Callable[[str, str], bytes] | None = None,
    ancestor_check: Callable[[Path, str], None] | None = None,
) -> dict[str, Any]:
    manifest = load_json(manifest_path)
    verify_signed(manifest, "kit manifest")
    if manifest.get("schema") != KIT_SCHEMA or manifest.get("protocol") != PROTOCOL \
            or manifest.get("thresholds") != {
                "weightedCohenKappaMinimumPerDimension": KAPPA_MINIMUM,
                "exactAgreementMinimum": EXACT_MINIMUM,
                "weightSchemeRule": "PASS_ONLY_IF_LINEAR_AND_QUADRATIC_PASS",
            }:
        raise BlindCodingError("kit manifest identity or thresholds changed")
    run = load_json(run_path)
    frozen_at = validate_run_binding(
        repository, run, run_path, manifest_path, case_path, source_path, rules_path,
        loader=loader, ancestor_check=ancestor_check,
    )
    if manifest.get("codingRules", {}).get("sha256") != run.get("codingRulesFileSha256"):
        raise BlindCodingError("run binding does not use the sealed coding rules")
    cases = load_cases(case_path)
    sources = load_sources(source_path)
    used_bundles = {case["source_bundle_id"] for case in cases.values()}
    available_bundles = {key[0] for key in sources}
    if not used_bundles.issubset(available_bundles):
        raise BlindCodingError("one or more cases reference an empty source bundle")
    coder_a, version_a, rows_a = load_coder(coder_a_path, cases, sources)
    coder_b, version_b, rows_b = load_coder(coder_b_path, cases, sources)
    if coder_a == coder_b or version_a != version_b:
        raise BlindCodingError("coders must be distinct and use the same frozen version")
    run_sha = file_sha256(run_path)
    name_a = validate_attestation(
        load_json(attestation_a_path), coder_a, file_sha256(coder_a_path), run_sha, run, frozen_at,
    )
    name_b = validate_attestation(
        load_json(attestation_b_path), coder_b, file_sha256(coder_b_path), run_sha, run, frozen_at,
    )
    if name_a.casefold() == name_b.casefold():
        raise BlindCodingError("two coder IDs cannot represent the same human")
    metric = agreement(rows_a, rows_b)
    passed = metric["decision"] == "PASS_WEIGHT_INVARIANT"
    return signed({
        "schema": DECISION_SCHEMA,
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
        "protocol": PROTOCOL,
        "decision": metric["decision"],
        "thresholds": manifest["thresholds"],
        "runId": run["runId"],
        "candidateRemoteCommit": run["candidateRemoteCommit"],
        "packageFrozenAt": run["packageFrozenAt"],
        "researchCorpusSha256": run["researchCorpusSha256"],
        "kitManifestFileSha256": file_sha256(manifest_path),
        "runBindingFileSha256": run_sha,
        "caseManifestFileSha256": file_sha256(case_path),
        "sourceBundleManifestFileSha256": file_sha256(source_path),
        "codingRulesFileSha256": file_sha256(rules_path),
        "coderA": {
            "coderId": coder_a, "coderFileSha256": file_sha256(coder_a_path),
            "attestationFileSha256": file_sha256(attestation_a_path),
        },
        "coderB": {
            "coderId": coder_b, "coderFileSha256": file_sha256(coder_b_path),
            "attestationFileSha256": file_sha256(attestation_b_path),
        },
        "caseCount": len(cases),
        **metric,
        "humanIndependenceAttested": True,
        "sameFrozenPackageVerified": True,
        "officialGatePassed": False,
        "officialGateNote": (
            "A numerical and attestation PASS must still be committed and packaged as the run-bound "
            "blindCodingAgreementPassed execution-gate artifact before the official gate changes."
        ),
        "executionGateArtifactCreationAllowed": passed,
        "gateChangeAllowed": False,
        "productiveGqsModified": False,
        "outcomesAccessed": False,
    })


def prepare(args: argparse.Namespace) -> dict[str, Any]:
    kit = args.kit.resolve()
    paths = {
        "readme": kit / "README.md",
        "rules": kit / "coding-rules.md",
        "cases": kit / "case-manifest-template.csv",
        "sources": kit / "source-bundle-manifest-template.csv",
        "coder": kit / "coder-template.csv",
        "attestation": kit / "attestation-template.json",
        "run": kit / "run-binding-template.json",
        "manifest": kit / "kit-manifest.json",
    }
    if any(path.exists() for path in paths.values()):
        raise BlindCodingError("refusing to overwrite blind-coding kit")
    kit.mkdir(parents=True, exist_ok=True)
    rules = (
        "# Versiegelte Blind-Coding-Regeln\n\n"
        "Jeder item_id wird getrennt in T, E und L mit ganzzahligen Stufen 0 bis 3 codiert. "
        "Zulaessig sind nur Quellen aus dem fuer den Fall eingefrorenen source_bundle_id, deren published_at "
        "und known_at nicht nach as_of liegen. Counterevidence ist verpflichtend; wenn nach gleichem "
        "Recherchebudget nichts gefunden wurde, ist NONE_FOUND_AFTER_EQUAL_BUDGET einzutragen. "
        "Spaetere Quellen, Kursverlaeufe, GQS-Daten, Outcome-Labels und Kommunikation zwischen den "
        "Codierern vor beider Abschluss sind verboten.\n"
    )
    write_utf8(paths["rules"], rules)
    write_utf8(paths["cases"], csv_text(CASE_FIELDS, []))
    write_utf8(paths["sources"], csv_text(SOURCE_FIELDS, []))
    write_utf8(paths["coder"], csv_text(CODER_FIELDS, []))
    attestation = {
        "schema": ATTESTATION_SCHEMA,
        "coderId": "", "coderName": "", "coderType": "HUMAN",
        "independentFromOtherCoderAttested": False,
        "noCommunicationWithOtherCoderBeforeCompletionAttested": False,
        "independentFromProducingSystemAttested": False,
        "noStudyDesignDataOrCodeContributionAttested": False,
        "sameFrozenCaseAndSourcePackageReceivedAttested": False,
        "equalResearchBudgetAttested": False,
        "noLaterSourcesAccessAttested": False,
        "noPricePathsAccessAttested": False,
        "noGqsDatesAccessAttested": False,
        "noOutcomeLabelsAccessAttested": False,
        "runBindingFileSha256": "", "caseManifestFileSha256": "",
        "sourceBundleManifestFileSha256": "", "codingRulesFileSha256": "",
        "coderFileSha256": "", "startedAt": None, "completedAt": None,
        "signatureName": "",
    }
    write_json(paths["attestation"], attestation)
    run_binding = {
        "schema": RUN_SCHEMA, "protocol": PROTOCOL, "runId": "",
        "packageFrozenAt": None, "candidateRemoteCommit": "",
        "kitManifestPath": "", "kitManifestFileSha256": "",
        "caseManifestPath": "", "caseManifestFileSha256": "",
        "sourceBundleManifestPath": "", "sourceBundleManifestFileSha256": "",
        "codingRulesPath": "", "codingRulesFileSha256": "",
        "researchCorpusSha256": "", "outcomesAccessed": False,
    }
    write_json(paths["run"], run_binding)
    write_utf8(paths["readme"], (
        "# Blind-Coding-Kit FEM-SEC-US@1.2.0 V2\n\n"
        "Dieses Paket ersetzt keine zwei unabhaengigen Menschen. Es beweist aber bytegenau, dass beide "
        "denselben eingefrorenen Fall- und Quellenbestand erhalten haben.\n\n"
        "1. Fallmanifest, Quellenbuendel und diese Coding-Regeln auf origin/main committen.\n"
        "2. Run-Binding auf diesen bereits existierenden Kandidaten-Commit mit den exakten Pfaden, Hashes, "
        "Korpus-Hash und Freeze-Zeitpunkt ausfuellen; beide persoenlichen Atteste binden seinen Byte-Hash.\n"
        "3. Beiden Menschen getrennt exakt dasselbe Paket geben; keine spaeteren Quellen, Kurse, GQS-Daten oder Outcomes.\n"
        "4. Jeder Mensch fuellt eine eigene coder-Datei und ein eigenes persoenliches Attest aus.\n"
        "5. Erst nach Abschluss beider Dateien den Verifier ausfuehren. Ein LLM oder derselbe Mensch in zwei "
        "Durchlaeufen ist unzulaessig.\n\n"
        "Ein PASS entsteht nur, wenn lineares und quadratisches gewichtetes Cohen-Kappa je Dimension mindestens "
        "0,70 erreichen und die gesamte exakte Uebereinstimmung mindestens 0,80 betraegt. Der leere "
        "Vorlagenzustand ist absichtlich RED.\n"
    ))
    unsigned = {
        "schema": KIT_SCHEMA,
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
        "protocol": PROTOCOL,
        "thresholds": {
            "weightedCohenKappaMinimumPerDimension": KAPPA_MINIMUM,
            "exactAgreementMinimum": EXACT_MINIMUM,
            "weightSchemeRule": "PASS_ONLY_IF_LINEAR_AND_QUADRATIC_PASS",
        },
        "codingRules": {"path": paths["rules"].name, "sha256": file_sha256(paths["rules"])},
        "templates": {
            "caseManifest": {"path": paths["cases"].name, "sha256": file_sha256(paths["cases"])},
            "sourceBundleManifest": {"path": paths["sources"].name, "sha256": file_sha256(paths["sources"])},
            "coder": {"path": paths["coder"].name, "sha256": file_sha256(paths["coder"])},
            "attestation": {"path": paths["attestation"].name, "sha256": file_sha256(paths["attestation"])},
            "runBinding": {"path": paths["run"].name, "sha256": file_sha256(paths["run"])},
        },
        "requiredDimensions": list(DIMENSIONS),
        "humanReviewPresent": False,
        "blindCodingAgreementPassed": False,
        "outcomesAccessed": False,
        "productiveGqsModified": False,
    }
    manifest = signed(unsigned)
    write_json(paths["manifest"], manifest)
    return manifest


def self_test() -> dict[str, Any]:
    with tempfile.TemporaryDirectory() as folder:
        root = Path(folder)
        rules_path = root / "coding-rules.md"
        case_path = root / "cases.csv"
        source_path = root / "sources.csv"
        coder_a_path = root / "coder-a.csv"
        coder_b_path = root / "coder-b.csv"
        manifest_path = root / "kit.json"
        run_path = root / "run.json"
        att_a_path = root / "att-a.json"
        att_b_path = root / "att-b.json"
        write_utf8(rules_path, "synthetic sealed rules\n")
        cases: list[dict[str, Any]] = []
        sources: list[dict[str, Any]] = []
        coders: dict[str, list[dict[str, Any]]] = {"A": [], "B": []}
        for index in range(20):
            case = {
                "item_id": f"I{index:03d}", "entity_id": f"E{index:03d}",
                "listing_id": f"L{index:03d}", "theme_id": "THEME",
                "as_of": "2020-12-31T23:59:59Z", "source_bundle_id": f"B{index:03d}",
                "version": "1.0.0",
            }
            source = {
                "source_bundle_id": case["source_bundle_id"], "source_id": f"S{index:03d}",
                "exact_locator": f"page:{index + 1}", "published_at": "2020-01-01T00:00:00Z",
                "retrieved_at": "2026-08-11T00:00:00Z", "known_at": "2020-01-02T00:00:00Z",
                "evidence_class": "primary", "payload_sha256": hashlib.sha256(str(index).encode()).hexdigest(),
            }
            cases.append(case)
            sources.append(source)
            for dimension in DIMENSIONS:
                for coder in ("A", "B"):
                    level = index % 4
                    if coder == "B" and index in {3, 13}:
                        level = (level + 1) % 4
                    coders[coder].append({
                        **{field: case[field] for field in ("item_id", "entity_id", "listing_id", "theme_id")},
                        "dimension": dimension, "level": level, "as_of": case["as_of"],
                        "source_bundle_id": case["source_bundle_id"], "source_id": source["source_id"],
                        "exact_locator": source["exact_locator"], "published_at": source["published_at"],
                        "retrieved_at": source["retrieved_at"], "known_at": source["known_at"],
                        "evidence_class": source["evidence_class"],
                        "counterevidence": "NONE_FOUND_AFTER_EQUAL_BUDGET",
                        "coder_id": f"HUMAN_{coder}", "version": case["version"],
                    })
        write_utf8(case_path, csv_text(CASE_FIELDS, cases))
        write_utf8(source_path, csv_text(SOURCE_FIELDS, sources))
        write_utf8(coder_a_path, csv_text(CODER_FIELDS, coders["A"]))
        write_utf8(coder_b_path, csv_text(CODER_FIELDS, coders["B"]))
        manifest = signed({
            "schema": KIT_SCHEMA, "protocol": PROTOCOL,
            "thresholds": {
                "weightedCohenKappaMinimumPerDimension": KAPPA_MINIMUM,
                "exactAgreementMinimum": EXACT_MINIMUM,
                "weightSchemeRule": "PASS_ONLY_IF_LINEAR_AND_QUADRATIC_PASS",
            },
            "codingRules": {"path": "coding-rules.md", "sha256": file_sha256(rules_path)},
        })
        write_json(manifest_path, manifest)
        commit = "d" * 40
        run = {
            "schema": RUN_SCHEMA, "protocol": PROTOCOL, "runId": "SYNTHETIC",
            "packageFrozenAt": "2020-12-31T23:59:59Z", "candidateRemoteCommit": commit,
            "kitManifestPath": "kit.json", "kitManifestFileSha256": file_sha256(manifest_path),
            "caseManifestPath": "cases.csv", "caseManifestFileSha256": file_sha256(case_path),
            "sourceBundleManifestPath": "sources.csv", "sourceBundleManifestFileSha256": file_sha256(source_path),
            "codingRulesPath": "coding-rules.md", "codingRulesFileSha256": file_sha256(rules_path),
            "researchCorpusSha256": "e" * 64, "outcomesAccessed": False,
        }
        write_json(run_path, run)
        run_sha = file_sha256(run_path)

        def attestation(coder: str, name: str, coder_path: Path) -> dict[str, Any]:
            return {
                "schema": ATTESTATION_SCHEMA, "coderId": f"HUMAN_{coder}",
                "coderName": name, "coderType": "HUMAN",
                "independentFromOtherCoderAttested": True,
                "noCommunicationWithOtherCoderBeforeCompletionAttested": True,
                "independentFromProducingSystemAttested": True,
                "noStudyDesignDataOrCodeContributionAttested": True,
                "sameFrozenCaseAndSourcePackageReceivedAttested": True,
                "equalResearchBudgetAttested": True, "noLaterSourcesAccessAttested": True,
                "noPricePathsAccessAttested": True, "noGqsDatesAccessAttested": True,
                "noOutcomeLabelsAccessAttested": True, "runBindingFileSha256": run_sha,
                "caseManifestFileSha256": run["caseManifestFileSha256"],
                "sourceBundleManifestFileSha256": run["sourceBundleManifestFileSha256"],
                "codingRulesFileSha256": run["codingRulesFileSha256"],
                "coderFileSha256": file_sha256(coder_path),
                "startedAt": "2021-01-01T00:00:00Z", "completedAt": "2021-01-02T00:00:00Z",
                "signatureName": name,
            }

        write_json(att_a_path, attestation("A", "Synthetic Human A", coder_a_path))
        write_json(att_b_path, attestation("B", "Synthetic Human B", coder_b_path))
        remote = {
            "kit.json": manifest_path.read_bytes(), "cases.csv": case_path.read_bytes(),
            "sources.csv": source_path.read_bytes(), "coding-rules.md": rules_path.read_bytes(),
        }
        result = evaluate_bundle(
            root, manifest_path, run_path, case_path, source_path, rules_path,
            coder_a_path, att_a_path, coder_b_path, att_b_path,
            loader=lambda unused_commit, path: remote[path],
            ancestor_check=lambda unused_repository, unused_commit: None,
        )
        if result["decision"] != "PASS_WEIGHT_INVARIANT" or not result["sameFrozenPackageVerified"]:
            raise BlindCodingError("positive bundle self-test did not pass")
        negative_checks = 0
        invalid_attestation = load_json(att_b_path)
        invalid_attestation["coderName"] = "Synthetic Human A"
        invalid_attestation["signatureName"] = "Synthetic Human A"
        write_json(att_b_path, invalid_attestation)
        try:
            evaluate_bundle(
                root, manifest_path, run_path, case_path, source_path, rules_path,
                coder_a_path, att_a_path, coder_b_path, att_b_path,
                loader=lambda unused_commit, path: remote[path],
                ancestor_check=lambda unused_repository, unused_commit: None,
            )
        except BlindCodingError as exc:
            if "same human" not in str(exc):
                raise
            negative_checks += 1
        else:
            raise BlindCodingError("same-human negative fixture passed")
        invalid_hash = attestation("B", "Synthetic Human B", coder_b_path)
        invalid_hash["caseManifestFileSha256"] = "0" * 64
        try:
            validate_attestation(invalid_hash, "HUMAN_B", file_sha256(coder_b_path), run_sha, run, timestamp(run["packageFrozenAt"], "freeze"))
        except BlindCodingError:
            negative_checks += 1
        else:
            raise BlindCodingError("attestation hash negative fixture passed")
        early = attestation("B", "Synthetic Human B", coder_b_path)
        early["startedAt"] = "2020-01-01T00:00:00Z"
        try:
            validate_attestation(early, "HUMAN_B", file_sha256(coder_b_path), run_sha, run, timestamp(run["packageFrozenAt"], "freeze"))
        except BlindCodingError:
            negative_checks += 1
        else:
            raise BlindCodingError("pre-freeze attestation negative fixture passed")
        incomplete_path = root / "incomplete.csv"
        write_utf8(incomplete_path, csv_text(CODER_FIELDS, coders["A"][:-1]))
        try:
            load_coder(incomplete_path, load_cases(case_path), load_sources(source_path))
        except BlindCodingError:
            negative_checks += 1
        else:
            raise BlindCodingError("incomplete coder negative fixture passed")
        late_sources = [dict(row) for row in sources]
        late_sources[0]["known_at"] = "2021-01-02T00:00:00Z"
        late_source_path = root / "late-sources.csv"
        write_utf8(late_source_path, csv_text(SOURCE_FIELDS, late_sources))
        try:
            load_coder(coder_a_path, load_cases(case_path), load_sources(late_source_path))
        except BlindCodingError:
            negative_checks += 1
        else:
            raise BlindCodingError("post-cutoff source negative fixture passed")
        return {
            "status": "PASS", "decision": result["decision"],
            "caseCount": result["caseCount"], "pairedDecisions": result["pairedDecisions"],
            "sameFrozenPackageVerified": True, "humanAttestationBindingVerified": True,
            "negativeChecksPassed": negative_checks,
        }


def verify(args: argparse.Namespace) -> dict[str, Any]:
    try:
        result = evaluate_bundle(
            args.repository.resolve(), args.manifest.resolve(), args.run_binding.resolve(),
            args.cases.resolve(), args.sources.resolve(), args.rules.resolve(),
            args.coder_a.resolve(), args.attestation_a.resolve(),
            args.coder_b.resolve(), args.attestation_b.resolve(),
        )
    except (BlindCodingError, OSError, UnicodeDecodeError, json.JSONDecodeError, subprocess.SubprocessError) as exc:
        result = signed({
            "schema": DECISION_SCHEMA,
            "generatedAt": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
            "protocol": PROTOCOL,
            "decision": "RED_PACKAGE_OR_HUMAN_CODING_INCOMPLETE",
            "errors": [str(exc)],
            "humanIndependenceAttested": False,
            "sameFrozenPackageVerified": False,
            "officialGatePassed": False, "gateChangeAllowed": False,
            "productiveGqsModified": False, "outcomesAccessed": False,
        })
    output = args.output.resolve()
    if output.exists():
        raise BlindCodingError("refusing to overwrite blind-coding decision")
    write_json(output, result)
    return result


def parser() -> argparse.ArgumentParser:
    value = argparse.ArgumentParser(description=__doc__)
    commands = value.add_subparsers(dest="command", required=True)
    prep = commands.add_parser("prepare")
    prep.add_argument("--kit", type=Path, required=True)
    check = commands.add_parser("verify")
    check.add_argument("--repository", type=Path, required=True)
    check.add_argument("--manifest", type=Path, required=True)
    check.add_argument("--run-binding", type=Path, required=True)
    check.add_argument("--cases", type=Path, required=True)
    check.add_argument("--sources", type=Path, required=True)
    check.add_argument("--rules", type=Path, required=True)
    check.add_argument("--coder-a", type=Path, required=True)
    check.add_argument("--attestation-a", type=Path, required=True)
    check.add_argument("--coder-b", type=Path, required=True)
    check.add_argument("--attestation-b", type=Path, required=True)
    check.add_argument("--output", type=Path, required=True)
    commands.add_parser("self-test")
    return value


def main() -> int:
    args = parser().parse_args()
    if args.command == "prepare":
        result = prepare(args)
    elif args.command == "verify":
        result = verify(args)
    else:
        result = self_test()
    status = result.get("status")
    if status is None:
        if result.get("decision") is not None:
            status = "PASS" if result.get("decision") == "PASS_WEIGHT_INVARIANT" else result.get("decision")
        elif result.get("blindCodingAgreementPassed") is False:
            status = "KIT_PREPARED_RED_HUMAN_CODING_NOT_PRESENT"
        else:
            status = "UNKNOWN"
    print(json.dumps({
        "status": status,
        "decision": result.get("decision"),
        "caseCount": result.get("caseCount"),
        "pairedDecisions": result.get("pairedDecisions"),
        "sameFrozenPackageVerified": result.get("sameFrozenPackageVerified"),
        "humanAttestationBindingVerified": result.get("humanAttestationBindingVerified"),
        "negativeChecksPassed": result.get("negativeChecksPassed"),
        "blindCodingAgreementPassed": result.get("blindCodingAgreementPassed"),
        "reportSha256": result.get("reportSha256"),
        "errors": result.get("errors"),
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

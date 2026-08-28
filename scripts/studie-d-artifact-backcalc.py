#!/usr/bin/env python3
"""Mechanical D1-D6 artifact-to-source back-calculation package."""

from __future__ import annotations

import argparse
import copy
import hashlib
import importlib.util
import json
import os
import sys


REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REGISTRATION_REL = (
    "protocol/early-detection/2.0.0/"
    "r2-d-artifact-data-backcalculation-registration.json"
)
REGISTRATION = os.path.join(REPO, *REGISTRATION_REL.split("/"))
SCRIPT_PATHS = {
    "D1": "scripts/studie-panel-survival.py",
    "D2": "scripts/studie-attrition-size-sector.py",
    "D3": "scripts/studie-identifier-bridge.py",
    "D4": "scripts/studie-censoring-aware-attrition.py",
    "D5": "scripts/studie-entry-cohort-standardization.py",
    "D6": "scripts/studie-descriptive-closure-audit.py",
}
ARTIFACT_PATHS = {
    "D1": "reports/studie/D1-panel-survival-2026-08-23.json",
    "D2": "reports/studie/D2-attrition-size-sector-2026-08-23.json",
    "D3": "reports/studie/D3-identifier-bridge-2026-08-23.json",
    "D4": "reports/studie/D4-censoring-aware-attrition-2026-08-23.json",
    "D5": "reports/studie/D5-entry-cohort-standardization-2026-08-23.json",
    "D6": "reports/studie/D6-descriptive-closure-audit-2026-08-23.json",
}
E4A_PRUEFUNG_REL = "reports/studie/E4a-diagnose-pruefung-2026-08-19.json"
EXPECTED_IDS = tuple(SCRIPT_PATHS)


class BackcalculationError(Exception):
    """Fail-closed back-calculation contract violation."""


def repo_path(relative: str) -> str:
    return os.path.join(REPO, *relative.split("/"))


def sha256_file(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def read_json(path: str) -> dict[str, object]:
    with open(path, "r", encoding="utf-8") as handle:
        value = json.load(handle)
    if not isinstance(value, dict):
        raise BackcalculationError("Expected JSON object: " + path)
    return value


def load_module(name: str, relative: str):
    path = repo_path(relative)
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise BackcalculationError("Could not load D-series script: " + relative)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


D1 = load_module("backcalc_d1", SCRIPT_PATHS["D1"])
D2 = load_module("backcalc_d2", SCRIPT_PATHS["D2"])
D3 = load_module("backcalc_d3", SCRIPT_PATHS["D3"])
D4 = load_module("backcalc_d4", SCRIPT_PATHS["D4"])
D5 = load_module("backcalc_d5", SCRIPT_PATHS["D5"])
D6 = load_module("backcalc_d6", SCRIPT_PATHS["D6"])


def metric_check(
        identifier: str,
        statistic: str,
        expected: object,
        recomputed: object,
        source: dict[str, object]) -> dict[str, object]:
    return {
        "id": identifier,
        "script": {
            "path": SCRIPT_PATHS[identifier],
            "sha256": sha256_file(repo_path(SCRIPT_PATHS[identifier])),
        },
        "publishedArtifact": {
            "path": ARTIFACT_PATHS[identifier],
            "sha256": sha256_file(repo_path(ARTIFACT_PATHS[identifier])),
        },
        "source": source,
        "statistic": statistic,
        "published": expected,
        "recomputed": recomputed,
        "matchesExactly": expected == recomputed,
    }


def d3_target(artifact: dict[str, object]) -> dict[str, object]:
    matches = [
        row for row in artifact["results"]
        if row["window"] == "pruefung" and row["arm"] == "signal"
    ]
    if len(matches) != 1:
        raise BackcalculationError("D3 published target row is not unique")
    return matches[0]


def build_result(discovery: str, validation: str) -> dict[str, object]:
    registration = read_json(REGISTRATION)
    if registration.get("status") != "FROZEN_BEFORE_BACKCALCULATION_PANEL_ACCESS":
        raise BackcalculationError("D-series back-calculation registration is not frozen")
    registered_ids = tuple(row.get("id") for row in registration.get("checks", []))
    if registered_ids != EXPECTED_IDS:
        raise BackcalculationError("Registered D-series check order is incomplete")

    artifacts = {
        identifier: read_json(repo_path(relative))
        for identifier, relative in ARTIFACT_PATHS.items()
    }

    d1_companies, _ = D1.read_panels([discovery, validation])
    d1_records = D1.company_records(d1_companies)
    d1_recomputed = sum(1 for row in d1_records if row["event"])

    d2_companies, d2_inputs = D2.read_panels([discovery, validation])
    d2_rows = D2.company_rows(d2_companies)
    d2_result = D2.result_from_rows(d2_rows, d2_inputs, artifacts["D1"])

    d3_anchor = read_json(repo_path(E4A_PRUEFUNG_REL))
    d3_block = d3_anchor["baender"]["2017-2019"]["varianten"]["S-U"]["signal"]
    d3_recomputed = D3.bridge_metrics(d3_block)["identityOnlyRecovered"]

    D4.verify_bound_inputs()
    d4_records = D4.company_records(d2_companies)
    d4_result = D4.result_from_records(
        d4_records, d2_inputs, artifacts["D1"], artifacts["D2"]
    )

    D5.verify_bound_inputs()
    d5_records = D5.company_records(d2_companies)
    d5_result = D5.result_from_records(
        d5_records,
        artifacts["D1"],
        artifacts["D2"],
        artifacts["D4"],
        d2_inputs,
    )

    d6_inputs = {key.lower(): artifacts[key] for key in ("D1", "D2", "D3", "D4", "D5")}
    d6_recomputed = D6.result_from_artifacts(
        d6_inputs,
        artifacts["D6"]["sourceFiles"],
        source_failures=[],
        report_failures=[],
    )

    panel_sources = {
        "kind": "pre-endtest panels",
        "files": [
            {"file": os.path.basename(path), "sha256": sha256_file(path)}
            for path in sorted([discovery, validation], key=os.path.basename)
        ],
        "lastAllowedDate": "2020-12-31",
    }
    checks = [
        metric_check(
            "D1",
            "counts.terminalExits",
            artifacts["D1"]["counts"]["terminalExits"],
            d1_recomputed,
            panel_sources,
        ),
        metric_check(
            "D2",
            "size.riskDifferencePercentagePointsSmallerMinusLarger",
            artifacts["D2"]["size"]["riskDifferencePercentagePointsSmallerMinusLarger"],
            d2_result["size"]["riskDifferencePercentagePointsSmallerMinusLarger"],
            panel_sources,
        ),
        metric_check(
            "D3",
            "pruefung/S-U/signal.identityOnlyRecovered",
            d3_target(artifacts["D3"])["identityOnlyRecovered"],
            d3_recomputed,
            {
                "kind": "committed E4a aggregate anchor",
                "path": E4A_PRUEFUNG_REL,
                "sha256": sha256_file(repo_path(E4A_PRUEFUNG_REL)),
                "eStageExecuted": False,
            },
        ),
        metric_check(
            "D4",
            "size.survivalDifferencePercentagePointsSmallerMinusLarger",
            artifacts["D4"]["size"]["survivalDifferencePercentagePointsSmallerMinusLarger"],
            d4_result["size"]["survivalDifferencePercentagePointsSmallerMinusLarger"],
            panel_sources,
        ),
        metric_check(
            "D5",
            "standardizedSize.survivalDifferencePercentagePointsSmallerMinusLarger",
            artifacts["D5"]["standardizedSize"][
                "survivalDifferencePercentagePointsSmallerMinusLarger"
            ],
            d5_result["standardizedSize"][
                "survivalDifferencePercentagePointsSmallerMinusLarger"
            ],
            panel_sources,
        ),
        metric_check(
            "D6",
            "auditContract.observedFailures",
            artifacts["D6"]["auditContract"]["observedFailures"],
            d6_recomputed["auditContract"]["observedFailures"],
            {
                "kind": "committed D1-D5 artifacts",
                "panelFilesOpened": 0,
                "paths": [ARTIFACT_PATHS[key] for key in ("D1", "D2", "D3", "D4", "D5")],
            },
        ),
    ]
    mismatches = [row["id"] for row in checks if not row["matchesExactly"]]
    result = {
        "schema": "R2-D-artifact-data-backcalculation/1",
        "registration": {
            "path": REGISTRATION_REL,
            "sha256": sha256_file(REGISTRATION),
            "status": registration["status"],
        },
        "scope": {
            "uniquePanelFilesOpened": 2,
            "lastAllowedDate": "2020-12-31",
            "eStagesExecuted": 0,
            "signalsReadOutsideCommittedAggregates": 0,
            "pricesUsed": 0,
            "outcomesUsed": 0,
            "companyIdentifiersWritten": 0,
            "endtestOpened": False,
            "verdictsChanged": 0,
        },
        "checks": checks,
        "integrityContract": {
            "testStatistic": "exact mismatch count",
            "nullModel": "zero exact mismatches across D1-D6",
            "threshold": "one or more mismatches fails closed",
            "observedMismatches": len(mismatches),
            "passes": not mismatches,
            "mismatchedChecks": mismatches,
        },
    }
    validate_result(result)
    return result


def validate_result(result: dict[str, object]) -> None:
    checks = result.get("checks")
    if not isinstance(checks, list) or tuple(row.get("id") for row in checks) != EXPECTED_IDS:
        raise BackcalculationError("Back-calculation check set is not exactly D1-D6")
    mismatches = []
    for row in checks:
        actual_match = row.get("published") == row.get("recomputed")
        if row.get("matchesExactly") is not actual_match:
            raise BackcalculationError("Stored match flag disagrees with object values: " + row["id"])
        if not actual_match:
            mismatches.append(row["id"])
        for descriptor_name in ("script", "publishedArtifact"):
            descriptor = row.get(descriptor_name)
            if not isinstance(descriptor, dict) or not isinstance(descriptor.get("path"), str):
                raise BackcalculationError("Back-calculation descriptor is absent")
            if not isinstance(descriptor.get("sha256"), str) or len(descriptor["sha256"]) != 64:
                raise BackcalculationError("Back-calculation descriptor hash is malformed")
    contract = result.get("integrityContract") or {}
    if contract.get("observedMismatches") != len(mismatches):
        raise BackcalculationError("Mismatch count does not reconcile")
    if contract.get("mismatchedChecks") != mismatches:
        raise BackcalculationError("Mismatch inventory does not reconcile")
    if contract.get("passes") is not (len(mismatches) == 0):
        raise BackcalculationError("Pass flag does not follow mismatch threshold")
    scope = result.get("scope") or {}
    if scope.get("eStagesExecuted") != 0 or scope.get("endtestOpened") is not False:
        raise BackcalculationError("E-stage or endtest boundary was crossed")
    if scope.get("outcomesUsed") != 0 or scope.get("companyIdentifiersWritten") != 0:
        raise BackcalculationError("Outcome or identity boundary was crossed")
    serialized = json.dumps(result, ensure_ascii=True, sort_keys=True).lower()
    for forbidden in ('"cik"', '"ticker"', '"adsh"', '"companyname"', '"company_name"'):
        if forbidden in serialized:
            raise BackcalculationError("Company identity leaked into back-calculation output")
    for forbidden_year in ('"2021q', '"2022q', '"2023q', '"2024q'):
        if forbidden_year in serialized:
            raise BackcalculationError("Post-cutoff quarter leaked into output")
    if mismatches:
        raise BackcalculationError("Published aggregate mismatch: " + ",".join(mismatches))


def render_report(result: dict[str, object]) -> str:
    lines = [
        "**Ergebnis: Sechs von sechs vorregistrierten D1-D6-Kennzahlen wurden aus ihren gebundenen Datenobjekten exakt zurueckgerechnet; die Abweichungszahl ist null.**",
        "",
        "# R2 - Artefakt-Daten-Rueckrechnung der D-Reihe",
        "",
        "## Wie gemessen",
        "",
        (
            "Die Rueckrechnung wurde vor dem Panelzugriff in `%s` eingefroren. "
            "D1, D2, D4 und D5 wurden aus den zwei Panels bis 31.12.2020 neu "
            "aggregiert. D3 wurde nur aus seinem bereits committeten E4a-Aggregat "
            "abgeleitet; kein E-Stadium lief. D6 wurde nur aus D1-D5 abgeleitet und "
            "oeffnete kein Panel."
        ) % result["registration"]["path"],
        "",
        "| Skript | Kennzahl | Veroeffentlicht | Zurueckgerechnet | Quelle |",
        "|---|---|---:|---:|---|",
    ]
    for row in result["checks"]:
        lines.append("| %s | `%s` | %s | %s | %s |" % (
            row["id"],
            row["statistic"],
            row["published"],
            row["recomputed"],
            row["source"]["kind"],
        ))
    lines.extend([
        "",
        "## Was ausdruecklich nicht gezeigt ist",
        "",
        "- Keine veroeffentlichte D-Zahl oder Schwelle wurde geaendert.",
        "- D3 ist an sein committetes E4a-Aggregat zurueckgerechnet, nicht durch einen neuen E4a-Lauf.",
        "- Die Rueckrechnung trifft keine Interpretation, Empfehlung oder Verdiktaussage.",
        "- Preise, Outcomes und das versiegelte Endtest-Fenster 2021-2023 wurden nicht geoeffnet.",
        "- Es werden keine Firmenidentitaeten oder Einzelwerte ausgegeben.",
    ])
    return "\n".join(lines) + "\n"


def write_json(path: str, result: dict[str, object]) -> None:
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as handle:
        json.dump(result, handle, ensure_ascii=False, indent=2, sort_keys=True)
        handle.write("\n")


def write_text(path: str, text: str) -> None:
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as handle:
        handle.write(text)


def synthetic_result() -> dict[str, object]:
    checks = [
        {
            "id": identifier,
            "script": {"path": SCRIPT_PATHS[identifier], "sha256": "0" * 64},
            "publishedArtifact": {"path": ARTIFACT_PATHS[identifier], "sha256": "1" * 64},
            "source": {"kind": "fixture"},
            "statistic": "fixture.value",
            "published": index,
            "recomputed": index,
            "matchesExactly": True,
        }
        for index, identifier in enumerate(EXPECTED_IDS, start=1)
    ]
    return {
        "schema": "R2-D-artifact-data-backcalculation/1",
        "registration": {"path": REGISTRATION_REL, "sha256": "2" * 64,
                         "status": "FROZEN_BEFORE_BACKCALCULATION_PANEL_ACCESS"},
        "scope": {"uniquePanelFilesOpened": 2, "lastAllowedDate": "2020-12-31",
                  "eStagesExecuted": 0, "signalsReadOutsideCommittedAggregates": 0,
                  "pricesUsed": 0, "outcomesUsed": 0, "companyIdentifiersWritten": 0,
                  "endtestOpened": False, "verdictsChanged": 0},
        "checks": checks,
        "integrityContract": {"testStatistic": "exact mismatch count",
                              "nullModel": "zero exact mismatches across D1-D6",
                              "threshold": "one or more mismatches fails closed",
                              "observedMismatches": 0, "passes": True,
                              "mismatchedChecks": []},
    }


def self_test() -> int:
    failures = []

    def check(name: str, condition: bool, actual: object = None) -> None:
        if condition:
            print("  ok    " + name)
        else:
            failures.append(name)
            print("  ROT   " + name + " (ist: " + repr(actual) + ")")

    fixture = synthetic_result()
    try:
        validate_result(fixture)
        baseline_ok = True
    except BackcalculationError:
        baseline_ok = False
    check("Sechs Objektchecks bestehen in der unveraenderten Fixture", baseline_ok)

    mutated = copy.deepcopy(fixture)
    mutated["checks"][3]["recomputed"] += 1
    try:
        validate_result(mutated)
        mutation_blocked = False
    except BackcalculationError:
        mutation_blocked = True
    check("Ein veraenderter D4-Wert wird rot", mutation_blocked)

    missing = copy.deepcopy(fixture)
    del missing["checks"][2]
    try:
        validate_result(missing)
        absence_blocked = False
    except BackcalculationError:
        absence_blocked = True
    check("Ein fehlender D3-Objektcheck wird rot", absence_blocked)

    opened = copy.deepcopy(fixture)
    opened["scope"]["endtestOpened"] = True
    try:
        validate_result(opened)
        endtest_blocked = False
    except BackcalculationError:
        endtest_blocked = True
    check("Ein geoeffnet markierter Endtest wird rot", endtest_blocked)

    check("Die Fixture schreibt keine Firmenidentitaet",
          all(token not in json.dumps(fixture).lower()
              for token in ('"cik"', '"ticker"', '"adsh"')))

    if failures:
        print("SELBSTTEST ROT - %d Pruefung(en) gescheitert" % len(failures))
        return 1
    print("SELBSTTEST GRUEN - 5 benannte Pruefungen")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="D1-D6 artifact/data back-calculation")
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument("--validate-artifact")
    parser.add_argument("--discovery")
    parser.add_argument("--validation")
    parser.add_argument("--output")
    parser.add_argument("--report")
    args = parser.parse_args(argv)
    if args.self_test:
        return self_test()
    if args.validate_artifact:
        validate_result(read_json(args.validate_artifact))
        print("ARTEFAKT GRUEN")
        return 0
    if not (args.discovery and args.validation and args.output and args.report):
        parser.error("--discovery, --validation, --output and --report are required")
    result = build_result(args.discovery, args.validation)
    write_json(args.output, result)
    write_text(args.report, render_report(result))
    print(json.dumps({
        "checks": len(result["checks"]),
        "observedMismatches": result["integrityContract"]["observedMismatches"],
        "eStagesExecuted": result["scope"]["eStagesExecuted"],
        "endtestOpened": result["scope"]["endtestOpened"],
    }, sort_keys=True))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (
        BackcalculationError,
        D1.SurvivalError,
        D2.AssociationError,
        D3.BridgeError,
        D4.SensitivityError,
        D5.StandardizationError,
        D6.ClosureAuditError,
    ) as error:
        print("ABBRUCH: " + str(error), file=sys.stderr)
        sys.exit(1)

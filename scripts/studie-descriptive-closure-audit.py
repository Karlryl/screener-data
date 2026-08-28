#!/usr/bin/env python3
"""D6: panel-free closure audit over the published D1-D5 descriptive package."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys


REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REGISTRATION_REL = (
    "protocol/early-detection/2.0.0/"
    "d6-descriptive-closure-audit-registration.json"
)
REGISTRATION = os.path.join(REPO, *REGISTRATION_REL.split("/"))
THRESHOLD_SEAL_REL = "protocol/early-detection/2.0.0/r2-d-threshold-seal.json"
ARTIFACTS = {
    "d1": "reports/studie/D1-panel-survival-2026-08-23.json",
    "d2": "reports/studie/D2-attrition-size-sector-2026-08-23.json",
    "d3": "reports/studie/D3-identifier-bridge-2026-08-23.json",
    "d4": "reports/studie/D4-censoring-aware-attrition-2026-08-23.json",
    "d5": "reports/studie/D5-entry-cohort-standardization-2026-08-23.json",
}
REPORTS = [
    "reports/studie/D1-panel-survival-2026-08-23.md",
    "reports/studie/D2-attrition-size-sector-2026-08-23.md",
    "reports/studie/D3-identifier-bridge-2026-08-23.md",
    "reports/studie/D4-censoring-aware-attrition-2026-08-23.md",
    "reports/studie/D5-entry-cohort-standardization-2026-08-23.md",
]
EXPECTED_SOURCE_COUNT = 21


class ClosureAuditError(Exception):
    """Fail-closed D6 audit violation."""


def repo_path(relative):
    return os.path.join(REPO, *relative.split("/"))


def sha256_file(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def load_json(relative):
    with open(repo_path(relative), encoding="utf-8") as handle:
        return json.load(handle)


def verify_sources(registration):
    failures = []
    sources = registration.get("sourceFiles", {})
    threshold_seal = load_json(THRESHOLD_SEAL_REL)
    if threshold_seal.get("status") != "FROZEN_THRESHOLD_BINDING_CORRECTION":
        failures.append("threshold-seal-status")
    current_scripts = threshold_seal.get("currentScripts") or {}
    if len(sources) != EXPECTED_SOURCE_COUNT:
        failures.append("source-count")
    for relative, expected in sources.items():
        path = repo_path(relative)
        current_expected = current_scripts.get(relative, expected)
        if not os.path.isfile(path):
            failures.append("missing:" + relative)
        elif sha256_file(path) != current_expected:
            failures.append("hash:" + relative)
    return failures


def verify_report_contracts():
    failures = []
    for relative in REPORTS:
        with open(repo_path(relative), encoding="utf-8") as handle:
            text = handle.read()
        first_line = text.splitlines()[0] if text.splitlines() else ""
        if not first_line.startswith("**Ergebnis:") or not first_line.endswith("**"):
            failures.append("first-line:" + relative)
        marker = "## Was ausdrücklich nicht gezeigt ist"
        if marker not in text or not text.split(marker, 1)[1].strip():
            failures.append("limitations:" + relative)
    return failures


def find_d3_target(d3):
    matches = [
        row for row in d3["results"]
        if row["window"] == "pruefung" and row["arm"] == "signal"
    ]
    if len(matches) != 1:
        raise ClosureAuditError("D3 target row is not unique")
    return matches[0]


def derive_headlines(d1, d2, d3, d4, d5):
    target = find_d3_target(d3)
    return {
        "d1": {
            "companies": d1["counts"]["companies"],
            "terminalExits": d1["counts"]["terminalExits"],
            "rightCensored": d1["counts"]["rightCensored"],
            "medianStayQuarters": d1["medianStayQuarters"],
        },
        "d2": {
            "rawSizeAttritionDifferencePercentagePoints": d2["size"][
                "riskDifferencePercentagePointsSmallerMinusLarger"
            ],
            "sectorCramersV": d2["sector"]["cramersV"],
            "sizeThresholdCrossed": d2["size"]["thresholdCrossed"],
            "sectorThresholdCrossed": d2["sector"]["thresholdCrossed"],
        },
        "d3": {
            "targetFirstEventCompanies": target["firstEventCompanies"],
            "targetAttritionBeforeBridge": target["attritionBeforeBridge"],
            "targetIdentityOnlyRecovered": target["identityOnlyRecovered"],
            "targetRemainingAttrition": target["remainingAttrition"],
            "targetRemainingAttritionRate": target["remainingAttritionRate"],
            "targetRetentionAfterBridge": target["retentionRateAfterBridge"],
        },
        "d4": {
            "sizeSurvivalDifferencePercentagePoints": d4["size"][
                "survivalDifferencePercentagePointsSmallerMinusLarger"
            ],
            "sectorSurvivalRangePercentagePoints": d4["sector"][
                "maxMinusMinSurvivalPercentagePoints"
            ],
            "sizeThresholdCrossed": d4["size"]["thresholdCrossed"],
            "sectorThresholdCrossed": d4["sector"]["thresholdCrossed"],
        },
        "d5": {
            "standardizedSizeSurvivalDifferencePercentagePoints": d5["standardizedSize"][
                "survivalDifferencePercentagePointsSmallerMinusLarger"
            ],
            "absoluteShiftFromD4PercentagePoints": d5["standardizedSize"][
                "absoluteShiftFromD4PercentagePoints"
            ],
            "cadenceDifferencePercentagePoints": d5["cadence"][
                "survivalDifferencePercentagePointsAnnualMinusQuarterly"
            ],
            "entryCohortRangePercentagePoints": d5["entryCohorts"][
                "maxMinusMinSurvivalPercentagePoints"
            ],
            "sizeThresholdCrossed": d5["standardizedSize"]["thresholdCrossed"],
            "cadenceThresholdCrossed": d5["cadence"]["thresholdCrossed"],
            "entryCohortThresholdCrossed": d5["entryCohorts"]["thresholdCrossed"],
        },
    }


def derive_cross_checks(headlines, d1, d2, d4, d5):
    population_counts_equal = all(
        artifact["counts"]["companies"] == headlines["d1"]["companies"]
        and artifact["counts"]["terminalExits"] == headlines["d1"]["terminalExits"]
        and artifact["counts"]["rightCensored"] == headlines["d1"]["rightCensored"]
        for artifact in (d2, d4, d5)
    )
    size_direction = (
        headlines["d2"]["rawSizeAttritionDifferencePercentagePoints"] > 0
        and headlines["d4"]["sizeSurvivalDifferencePercentagePoints"] < 0
        and headlines["d5"]["standardizedSizeSurvivalDifferencePercentagePoints"] < 0
    )
    sector_flags_differ = (
        headlines["d2"]["sectorThresholdCrossed"]
        != headlines["d4"]["sectorThresholdCrossed"]
    )
    bridge_reconciles = (
        headlines["d3"]["targetIdentityOnlyRecovered"]
        + headlines["d3"]["targetRemainingAttrition"]
        == headlines["d3"]["targetAttritionBeforeBridge"]
    )
    return {
        "populationCountsEqualAcrossD1D2D4D5": population_counts_equal,
        "sizeDirectionConsistentAcrossD2D4D5": size_direction,
        "sectorDescriptiveFlagsDifferBetweenD2AndD4": sector_flags_differ,
        "d3TargetBridgeReconciles": bridge_reconciles,
        "d5CadenceAndCohortFlagsBothCrossed": (
            headlines["d5"]["cadenceThresholdCrossed"]
            and headlines["d5"]["entryCohortThresholdCrossed"]
        ),
    }


def audit_failures(headlines, checks, artifacts):
    failures = []
    d1 = artifacts["d1"]
    if headlines["d1"]["terminalExits"] + headlines["d1"]["rightCensored"] != headlines[
            "d1"]["companies"]:
        failures.append("d1-count-reconciliation")
    for required in (
            "populationCountsEqualAcrossD1D2D4D5",
            "d3TargetBridgeReconciles",
    ):
        if not checks[required]:
            failures.append("cross-check:" + required)
    target = headlines["d3"]
    expected_remaining_rate = target["targetRemainingAttrition"] / target[
        "targetFirstEventCompanies"]
    if abs(expected_remaining_rate - target["targetRemainingAttritionRate"]) > 1e-15:
        failures.append("d3-remaining-rate")
    if d1["scope"]["companyIdentifiersWritten"] != 0:
        failures.append("d1-identity-scope")
    for name, artifact in artifacts.items():
        if artifact["scope"]["companyIdentifiersWritten"] != 0:
            failures.append(name + "-identity-scope")
    return failures


def result_from_artifacts(artifacts, source_hashes, source_failures=None, report_failures=None):
    headlines = derive_headlines(
        artifacts["d1"], artifacts["d2"], artifacts["d3"], artifacts["d4"], artifacts["d5"]
    )
    checks = derive_cross_checks(
        headlines, artifacts["d1"], artifacts["d2"], artifacts["d4"], artifacts["d5"]
    )
    failures = list(source_failures or []) + list(report_failures or [])
    failures.extend(audit_failures(headlines, checks, artifacts))
    result = {
        "schema": "D6-descriptive-closure-audit/1",
        "registration": {
            "path": REGISTRATION_REL,
            "sha256": sha256_file(REGISTRATION),
            "status": "FROZEN_BEFORE_D6_ASSEMBLY_AFTER_D1_D5_PUBLICATION",
        },
        "sourceFiles": source_hashes,
        "scope": {
            "panelFilesOpened": 0,
            "companyLevelRecordsRead": 0,
            "companyIdentifiersWritten": 0,
            "newEmpiricalObservations": 0,
            "signalsChanged": 0,
            "thresholdsChanged": 0,
            "verdictsChanged": 0,
        },
        "auditContract": {
            "testStatistic": "integrity failure count",
            "nullModel": "zero integrity failures",
            "threshold": "one or more failures fails closed",
            "observedFailures": len(failures),
            "passes": len(failures) == 0,
            "failures": failures,
        },
        "headlines": headlines,
        "crossChecks": checks,
        "reviewQueue": [
            {
                "key": "size-association-after-adjustments",
                "decisionOwner": "Claude",
                "resolvedByD6": False,
            },
            {
                "key": "sector-statistics-disagree-on-descriptive-flags",
                "decisionOwner": "Claude",
                "resolvedByD6": False,
            },
            {
                "key": "entry-cohort-and-cadence-heterogeneity",
                "decisionOwner": "Claude",
                "resolvedByD6": False,
            },
            {
                "key": "identity-bridge-as-future-default",
                "decisionOwner": "Claude",
                "resolvedByD6": False,
            },
        ],
    }
    validate_result(result)
    return result


def validate_result(result):
    contract = result["auditContract"]
    if contract["observedFailures"] != len(contract["failures"]):
        raise ClosureAuditError("D6 failure count does not reconcile")
    if contract["passes"] != (contract["observedFailures"] == 0):
        raise ClosureAuditError("D6 pass flag does not follow threshold")
    if result["scope"]["panelFilesOpened"] != 0:
        raise ClosureAuditError("D6 opened a panel")
    if len(result["sourceFiles"]) != EXPECTED_SOURCE_COUNT:
        raise ClosureAuditError("D6 source inventory is incomplete")
    if any(row["decisionOwner"] != "Claude" or row["resolvedByD6"]
           for row in result["reviewQueue"]):
        raise ClosureAuditError("D6 crossed the judgment boundary")

    def check_keys(value):
        if isinstance(value, dict):
            for key, child in value.items():
                if str(key).lower() in {
                        "cik", "ticker", "adsh", "company", "companyname", "company_name"}:
                    raise ClosureAuditError("Company identity leaked into D6")
                check_keys(child)
        elif isinstance(value, list):
            for child in value:
                check_keys(child)
    check_keys(result)


def build_result():
    registration = load_json(REGISTRATION_REL)
    if registration.get("status") != "FROZEN_BEFORE_D6_ASSEMBLY_AFTER_D1_D5_PUBLICATION":
        raise ClosureAuditError("D6 registration is not frozen")
    source_failures = verify_sources(registration)
    report_failures = verify_report_contracts()
    artifacts = {name: load_json(relative) for name, relative in ARTIFACTS.items()}
    return result_from_artifacts(
        artifacts,
        registration["sourceFiles"],
        source_failures,
        report_failures,
    )


def write_json(path, result):
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as handle:
        json.dump(result, handle, ensure_ascii=False, indent=2, sort_keys=True)
        handle.write("\n")


def synthetic_fixture():
    scope = {"companyIdentifiersWritten": 0}
    return {
        "d1": {
            "counts": {"companies": 10, "terminalExits": 4, "rightCensored": 6},
            "medianStayQuarters": 8,
            "scope": scope,
        },
        "d2": {
            "counts": {"companies": 10, "terminalExits": 4, "rightCensored": 6},
            "size": {
                "riskDifferencePercentagePointsSmallerMinusLarger": 12.0,
                "thresholdCrossed": True,
            },
            "sector": {"cramersV": 0.12, "thresholdCrossed": True},
            "scope": scope,
        },
        "d3": {
            "results": [{
                "window": "pruefung",
                "arm": "signal",
                "firstEventCompanies": 10,
                "attritionBeforeBridge": 4,
                "identityOnlyRecovered": 2,
                "remainingAttrition": 2,
                "remainingAttritionRate": 0.2,
                "retentionRateAfterBridge": 0.8,
            }],
            "scope": scope,
        },
        "d4": {
            "counts": {"companies": 10, "terminalExits": 4, "rightCensored": 6},
            "size": {
                "survivalDifferencePercentagePointsSmallerMinusLarger": -10.0,
                "thresholdCrossed": True,
            },
            "sector": {
                "maxMinusMinSurvivalPercentagePoints": 8.0,
                "thresholdCrossed": False,
            },
            "scope": scope,
        },
        "d5": {
            "counts": {"companies": 10, "terminalExits": 4, "rightCensored": 6},
            "standardizedSize": {
                "survivalDifferencePercentagePointsSmallerMinusLarger": -7.0,
                "absoluteShiftFromD4PercentagePoints": 3.0,
                "thresholdCrossed": True,
            },
            "cadence": {
                "survivalDifferencePercentagePointsAnnualMinusQuarterly": 6.0,
                "thresholdCrossed": True,
            },
            "entryCohorts": {
                "maxMinusMinSurvivalPercentagePoints": 11.0,
                "thresholdCrossed": True,
            },
            "scope": scope,
        },
    }


def self_test():
    failures = []

    def check(name, condition, actual=None):
        if condition:
            print("  ok    " + name)
        else:
            failures.append(name)
            print("  ROT   " + name + " (ist: " + repr(actual) + ")")

    registration = load_json(REGISTRATION_REL)
    source_failures = verify_sources(registration)
    fixture = synthetic_fixture()
    result = result_from_artifacts(fixture, registration["sourceFiles"])
    check("Historische 21 Quellen und aktuelle Schwellen-Skripte sind beide exakt",
          len(registration["sourceFiles"]) == 21 and not source_failures,
          source_failures)
    check("Fixture-D1 geht als vier plus sechs gleich zehn auf",
          result["headlines"]["d1"] == {
              "companies": 10, "terminalExits": 4,
              "rightCensored": 6, "medianStayQuarters": 8},
          result["headlines"]["d1"])
    check("Fixture-Groessenrichtung bleibt ueber drei Deskriptoren konsistent",
          result["crossChecks"]["sizeDirectionConsistentAcrossD2D4D5"] is True,
          result["crossChecks"])
    check("Fixture-Sektorflag widerspricht sich sichtbar zwischen D2 und D4",
          result["crossChecks"]["sectorDescriptiveFlagsDifferBetweenD2AndD4"] is True,
          result["crossChecks"])
    check("Fixture-Kennungsbruecke geht als zwei plus zwei gleich vier auf",
          result["crossChecks"]["d3TargetBridgeReconciles"] is True,
          result["headlines"]["d3"])
    check("Fixture-Kadenz und Kohorte bleiben gemeinsam als offene Flags sichtbar",
          result["crossChecks"]["d5CadenceAndCohortFlagsBothCrossed"] is True,
          result["crossChecks"])
    check("Null Fehler laesst den Auditvertrag bestehen",
          result["auditContract"]["passes"] is True
          and result["auditContract"]["observedFailures"] == 0,
          result["auditContract"])
    sabotaged = result_from_artifacts(
        fixture,
        registration["sourceFiles"],
        source_failures=["fixture-sabotage"],
    )
    check("Ein absichtlicher Fehler kippt den Auditvertrag rot",
          sabotaged["auditContract"]["passes"] is False
          and sabotaged["auditContract"]["observedFailures"] == 1,
          sabotaged["auditContract"])
    empirical_variant = synthetic_fixture()
    empirical_variant["d4"]["sector"]["thresholdCrossed"] = True
    empirical_variant["d5"]["cadence"]["thresholdCrossed"] = False
    empirical_result = result_from_artifacts(
        empirical_variant,
        registration["sourceFiles"],
    )
    check("Ein anderes empirisches Flag ist kein Integritaetsfehler",
          empirical_result["auditContract"]["passes"] is True,
          empirical_result["auditContract"])
    check("Vier Urteilsfragen bleiben ausschliesslich bei Claude",
          len(result["reviewQueue"]) == 4
          and all(row["decisionOwner"] == "Claude" for row in result["reviewQueue"]),
          result["reviewQueue"])
    check("D6 oeffnet null Panels und erzeugt null neue Beobachtungen",
          result["scope"]["panelFilesOpened"] == 0
          and result["scope"]["newEmpiricalObservations"] == 0,
          result["scope"])
    check("Alle fuenf Quellberichte tragen Ergebniszeile und Pflichtgrenze",
          not verify_report_contracts(), verify_report_contracts())
    check("D6 schreibt keine Firmenidentitaet",
          result["scope"]["companyIdentifiersWritten"] == 0, result["scope"])

    if failures:
        print("SELBSTTEST ROT - %d Pruefung(en) gescheitert" % len(failures))
        return 1
    print("SELBSTTEST GRUEN - 13 benannte Pruefungen")
    return 0


def main(argv=None):
    parser = argparse.ArgumentParser(description="D6 panel-free descriptive closure audit")
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument("--output")
    args = parser.parse_args(argv)
    if args.self_test:
        return self_test()
    if not args.output:
        parser.error("--output is required")
    result = build_result()
    write_json(args.output, result)
    print(json.dumps({
        "observedFailures": result["auditContract"]["observedFailures"],
        "passes": result["auditContract"]["passes"],
        "reviewQuestions": len(result["reviewQueue"]),
        "panelFilesOpened": result["scope"]["panelFilesOpened"],
    }, sort_keys=True))
    return 0 if result["auditContract"]["passes"] else 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    except ClosureAuditError as error:
        print("ABBRUCH: " + str(error), file=sys.stderr)
        sys.exit(1)

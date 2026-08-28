#!/usr/bin/env python3
"""D5: entry-year standardization of D4 size survival, plus cadence/cohort rows."""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
import sys
from datetime import timedelta


REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PREREG_REL = (
    "protocol/early-detection/2.0.0/"
    "d5-entry-cohort-standardization-preregistration.json"
)
PREREG = os.path.join(REPO, *PREREG_REL.split("/"))
D4_SCRIPT_REL = "scripts/studie-censoring-aware-attrition.py"
D1_ARTIFACT_REL = "reports/studie/D1-panel-survival-2026-08-23.json"
D2_ARTIFACT_REL = "reports/studie/D2-attrition-size-sector-2026-08-23.json"
D4_ARTIFACT_REL = "reports/studie/D4-censoring-aware-attrition-2026-08-23.json"
HORIZON_QUARTERS = 12
THRESHOLD_SCRIPT_REL = "scripts/studie-threshold-seal.py"

BOUND_INPUTS = {
    "scripts/studie-panel-survival.py": "d1a6fae94a46588f5f1783a288ad5055737648de1fb480f673b985c75dbf4c54",
    "scripts/studie-attrition-size-sector.py": "a3f8e7806168b1b3b6dfda4e6e646dfe67cb7f42ddf35ff65a0a6a2ac58658b2",
    D4_SCRIPT_REL: "65944d3bfce5ca92174cad33b91516b9e6f627a3e27216dc8d0682d4aa8d1d51",
    D1_ARTIFACT_REL: "81e9f312df2faac322fc64647ed33cf6862d8ce15120c80ce665e5fde14c8724",
    D2_ARTIFACT_REL: "c4d0c1f30b850920b48163f790f2a8704f892702d0686b583e4e315705a98d63",
    D4_ARTIFACT_REL: "f4b252613cc03cac4f40b4b701b6e7017855cfb638759dc4ccbdb6d857a996f5",
}


class StandardizationError(Exception):
    """Fail-closed D5 contract violation."""


def repo_path(relative):
    return os.path.join(REPO, *relative.split("/"))


def sha256_file(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def load_module(name, relative):
    spec = importlib.util.spec_from_file_location(name, repo_path(relative))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


D4 = load_module("d4_censoring_aware_attrition", D4_SCRIPT_REL)
D2 = D4.D2
D1 = D4.D1
THRESHOLD_SEAL = load_module("d_series_threshold_seal_d5", THRESHOLD_SCRIPT_REL)
THRESHOLDS, THRESHOLD_SEAL_META = THRESHOLD_SEAL.load_thresholds(
    "d5", __file__, StandardizationError
)
SIZE_THRESHOLD_PP = THRESHOLDS["sizeThresholdPP"]
CADENCE_THRESHOLD_PP = THRESHOLDS["cadenceThresholdPP"]
COHORT_THRESHOLD_PP = THRESHOLDS["cohortThresholdPP"]
COHORT_MIN_N = THRESHOLDS["cohortMinimumN"]


def verify_bound_inputs():
    with open(PREREG, encoding="utf-8") as handle:
        prereg = json.load(handle)
    if prereg.get("status") != "FROZEN_BEFORE_D5_PANEL_ACCESS":
        raise StandardizationError("D5 preregistration is not frozen")
    if prereg.get("boundInputs") != BOUND_INPUTS:
        raise StandardizationError("D5 preregistration bound-input map changed")
    threshold_seal = THRESHOLD_SEAL.read_json(THRESHOLD_SEAL.SEAL)
    current_scripts = threshold_seal.get("currentScripts") or {}
    for relative, expected in BOUND_INPUTS.items():
        current_expected = current_scripts.get(relative, expected)
        if sha256_file(repo_path(relative)) != current_expected:
            raise StandardizationError("Bound D5 input changed: " + relative)
    return True


def company_records(companies):
    records = []
    for state in companies.values():
        periods = list(state["periods"].values())
        if not periods:
            continue
        entry = min(periods, key=lambda row: row["accepted"])
        accepted_dates = sorted(set(row["accepted"] for row in periods))
        cadence_days = (
            D1.QUARTERLY_DAYS
            if state["forms"].intersection(D1.DOMESTIC_FORMS)
            else D1.ANNUAL_DAYS
        )
        expected_next = accepted_dates[-1] + timedelta(days=cadence_days)
        event = expected_next <= D1.CUTOFF
        endpoint = expected_next if event else D1.CUTOFF
        duration = D1.quarter_index(endpoint) - D1.quarter_index(accepted_dates[0])
        potential_followup = (
            D1.quarter_index(D1.CUTOFF) - D1.quarter_index(accepted_dates[0])
        )
        if duration < 0 or potential_followup < 0:
            raise StandardizationError("Negative D5 duration")
        afs_code = entry["afs"] if entry["afs"] in D2.AFS else None
        records.append({
            "duration": duration,
            "event": event,
            "cadence": "quarterly" if cadence_days == D1.QUARTERLY_DAYS else "annual",
            "sizeGroup": D2.AFS[afs_code][1] if afs_code else "missing_or_unknown",
            "sector": entry["sector"] or "unclassified",
            "entryYear": accepted_dates[0].year,
            "horizonEligible": potential_followup >= HORIZON_QUARTERS,
        })
    if not records:
        raise StandardizationError("No eligible D5 companies")
    return records


def raw_counts(records, key):
    result = {}
    for row in records:
        group = result.setdefault(row[key], {
            "companies": 0,
            "terminalExits": 0,
            "rightCensored": 0,
        })
        group["companies"] += 1
        if row["event"]:
            group["terminalExits"] += 1
        else:
            group["rightCensored"] += 1
    return result


def direct_standardization(records):
    eligible = [
        row for row in records
        if row["horizonEligible"]
        and row["sizeGroup"] in ("larger", "smaller")
    ]
    years = sorted(set(row["entryYear"] for row in eligible))
    total = len(eligible)
    if not years or total == 0:
        raise StandardizationError("No D5 primary population")
    year_rows = []
    standardized = {"larger": 0.0, "smaller": 0.0}
    for year in years:
        pooled = [row for row in eligible if row["entryYear"] == year]
        weight = len(pooled) / total
        summaries = {}
        for size in ("larger", "smaller"):
            subset = [row for row in pooled if row["sizeGroup"] == size]
            summary = D4.km_summary(subset)
            if not subset or not summary["horizonEstimable"]:
                raise StandardizationError(
                    "Primary entry year lacks an estimable size group: " + str(year)
                )
            summaries[size] = summary
            standardized[size] += weight * summary["survivalAtHorizon"]
        year_rows.append({
            "entryYear": year,
            "pooledCompanies": len(pooled),
            "commonWeight": round(weight, 15),
            "largerCompanies": summaries["larger"]["companies"],
            "largerSurvivalAtHorizon": summaries["larger"]["survivalAtHorizon"],
            "smallerCompanies": summaries["smaller"]["companies"],
            "smallerSurvivalAtHorizon": summaries["smaller"]["survivalAtHorizon"],
        })
    return eligible, year_rows, standardized


def cohort_rows(records):
    rows = []
    for year in sorted(set(row["entryYear"] for row in records)):
        subset = [row for row in records if row["entryYear"] == year]
        summary = D4.km_summary(subset)
        eligible = all(row["horizonEligible"] for row in subset)
        if not eligible:
            summary["horizonEstimable"] = False
            summary["atRiskAtHorizon"] = 0
            summary["survivalAtHorizon"] = None
        rows.append({"entryYear": year, "eligibleForCommonHorizon": eligible, **summary})
    return rows


def result_from_records(records, d1_anchor=None, d2_anchor=None, d4_anchor=None, inputs=None):
    events = sum(1 for row in records if row["event"])
    eligible, standard_rows, standardized = direct_standardization(records)
    standardized_difference = 100.0 * (standardized["smaller"] - standardized["larger"])

    unstandardized = {
        size: D4.km_summary([row for row in records if row["sizeGroup"] == size])
        for size in ("larger", "smaller")
    }
    unstandardized_difference = 100.0 * (
        unstandardized["smaller"]["survivalAtHorizon"]
        - unstandardized["larger"]["survivalAtHorizon"]
    )

    cadence = {
        name: D4.km_summary([row for row in records if row["cadence"] == name])
        for name in ("quarterly", "annual")
    }
    if not all(group["horizonEstimable"] for group in cadence.values()):
        raise StandardizationError("D5 cadence horizon is not estimable")
    cadence_difference = 100.0 * (
        cadence["annual"]["survivalAtHorizon"]
        - cadence["quarterly"]["survivalAtHorizon"]
    )

    cohorts = cohort_rows(records)
    eligible_cohorts = [
        row for row in cohorts
        if row["eligibleForCommonHorizon"]
        and row["companies"] >= COHORT_MIN_N
        and row["survivalAtHorizon"] is not None
    ]
    cohort_values = [row["survivalAtHorizon"] for row in eligible_cohorts]
    cohort_range = (
        100.0 * (max(cohort_values) - min(cohort_values))
        if len(cohort_values) >= 2 else None
    )

    if d1_anchor is not None and d2_anchor is not None and d4_anchor is not None:
        D4.reconcile_anchors(records, d1_anchor, d2_anchor)
        for size in ("larger", "smaller"):
            anchored = d4_anchor["size"]["groups"][size]
            actual = unstandardized[size]
            for field in ("companies", "terminalExits", "rightCensored", "survivalAtHorizon"):
                if actual[field] != anchored[field]:
                    raise StandardizationError("D5 does not reproduce D4 size: " + size)

    result = {
        "schema": "D5-entry-cohort-standardization/1",
        "preregistration": {
            "path": PREREG_REL,
            "sha256": sha256_file(PREREG),
            "status": "FROZEN_BEFORE_D5_PANEL_ACCESS",
        },
        "thresholdSeal": THRESHOLD_SEAL_META,
        "boundInputs": BOUND_INPUTS,
        "anchors": (
            {
                "d1CountsMatched": True,
                "d2SizeGroupsMatched": True,
                "d4UnstandardizedSizeMatched": True,
            }
            if d1_anchor is not None else None
        ),
        "scope": {
            "lastAllowedDate": D1.CUTOFF.isoformat(),
            "signalsUsed": 0,
            "companyIdentifiersWritten": 0,
            "dailyObservationsUsed": 0,
        },
        "inputs": inputs or [],
        "counts": {
            "companies": len(records),
            "terminalExits": events,
            "rightCensored": len(records) - events,
        },
        "effectiveN": {
            "companies": len(records),
            "primaryEligibleCompanies": len(eligible),
            "independentUnit": "company",
            "filingsAreIndependentObservations": False,
            "dailyPoints": 0,
            "tableTotalsMayBeAdded": False,
        },
        "horizonQuarters": HORIZON_QUARTERS,
        "standardizedSize": {
            "entryYearRows": standard_rows,
            "largerSurvivalAtHorizon": round(standardized["larger"], 12),
            "smallerSurvivalAtHorizon": round(standardized["smaller"], 12),
            "survivalDifferencePercentagePointsSmallerMinusLarger": round(
                standardized_difference, 12
            ),
            "unstandardizedD4DifferencePercentagePoints": round(
                unstandardized_difference, 12
            ),
            "absoluteShiftFromD4PercentagePoints": round(
                abs(standardized_difference - unstandardized_difference), 12
            ),
            "directionConsistentWithD4": (
                standardized_difference * unstandardized_difference > 0
            ),
            "absoluteDifferenceThresholdPercentagePoints": SIZE_THRESHOLD_PP,
            "thresholdCrossed": abs(standardized_difference) >= SIZE_THRESHOLD_PP,
            "nullModel": "equal entry-year-standardized 12-quarter survival",
            "isSignificanceTest": False,
        },
        "cadence": {
            "groups": cadence,
            "survivalDifferencePercentagePointsAnnualMinusQuarterly": round(
                cadence_difference, 12
            ),
            "absoluteDifferenceThresholdPercentagePoints": CADENCE_THRESHOLD_PP,
            "thresholdCrossed": abs(cadence_difference) >= CADENCE_THRESHOLD_PP,
            "nullModel": "equal 12-quarter survival by reporting cadence",
            "isSignificanceTest": False,
        },
        "entryCohorts": {
            "groups": cohorts,
            "minimumCompaniesForRange": COHORT_MIN_N,
            "eligibleYears": [row["entryYear"] for row in eligible_cohorts],
            "maxMinusMinSurvivalPercentagePoints": (
                round(cohort_range, 12) if cohort_range is not None else None
            ),
            "rangeThresholdPercentagePoints": COHORT_THRESHOLD_PP,
            "thresholdCrossed": (
                cohort_range is not None and cohort_range >= COHORT_THRESHOLD_PP
            ),
            "nullModel": "equal 12-quarter survival across eligible entry years",
            "isSignificanceTest": False,
        },
    }
    validate_result(result)
    return result


def validate_group(group):
    if group["terminalExits"] + group["rightCensored"] != group["companies"]:
        raise StandardizationError("D5 group outcomes do not reconcile")
    previous = 1.0
    for row in group["survivalCurve"]:
        if not 0.0 <= row["survival"] <= previous <= 1.0:
            raise StandardizationError("D5 survival curve is invalid")
        previous = row["survival"]


def validate_result(result):
    counts = result["counts"]
    if counts["terminalExits"] + counts["rightCensored"] != counts["companies"]:
        raise StandardizationError("D5 outcomes do not reconcile")
    weights = result["standardizedSize"]["entryYearRows"]
    if abs(sum(row["commonWeight"] for row in weights) - 1.0) > 1e-12:
        raise StandardizationError("D5 common weights do not sum to one")
    if sum(row["pooledCompanies"] for row in weights) != result["effectiveN"][
            "primaryEligibleCompanies"]:
        raise StandardizationError("D5 primary effective N does not reconcile")
    for group in list(result["cadence"]["groups"].values()) + result["entryCohorts"]["groups"]:
        validate_group(group)
    if sum(group["companies"] for group in result["cadence"]["groups"].values()) != counts[
            "companies"]:
        raise StandardizationError("D5 cadence groups do not reconcile")
    if sum(group["companies"] for group in result["entryCohorts"]["groups"]) != counts[
            "companies"]:
        raise StandardizationError("D5 cohort groups do not reconcile")

    def check_keys(value):
        if isinstance(value, dict):
            for key, child in value.items():
                if str(key).lower() in {
                        "cik", "ticker", "adsh", "company", "companyname",
                        "company_name", "signal", "signalvalue"}:
                    raise StandardizationError("Identity or signal leaked into D5 output")
                check_keys(child)
        elif isinstance(value, list):
            for child in value:
                check_keys(child)
    check_keys(result)


def build_result(paths):
    verify_bound_inputs()
    with open(repo_path(D1_ARTIFACT_REL), encoding="utf-8") as handle:
        d1_anchor = json.load(handle)
    with open(repo_path(D2_ARTIFACT_REL), encoding="utf-8") as handle:
        d2_anchor = json.load(handle)
    with open(repo_path(D4_ARTIFACT_REL), encoding="utf-8") as handle:
        d4_anchor = json.load(handle)
    companies, inputs = D2.read_panels(paths)
    records = company_records(companies)
    return result_from_records(records, d1_anchor, d2_anchor, d4_anchor, inputs)


def write_json(path, result):
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as handle:
        json.dump(result, handle, ensure_ascii=False, indent=2, sort_keys=True)
        handle.write("\n")


def self_test():
    failures = []

    def check(name, condition, actual=None):
        if condition:
            print("  ok    " + name)
        else:
            failures.append(name)
            print("  ROT   " + name + " (ist: " + repr(actual) + ")")

    bound_inputs_ok = verify_bound_inputs()
    fixture = [
        {"duration": 2, "event": True, "cadence": "quarterly", "sizeGroup": "larger", "entryYear": 2015, "horizonEligible": True},
        {"duration": 12, "event": False, "cadence": "quarterly", "sizeGroup": "larger", "entryYear": 2015, "horizonEligible": True},
        {"duration": 12, "event": False, "cadence": "annual", "sizeGroup": "larger", "entryYear": 2015, "horizonEligible": True},
        {"duration": 1, "event": True, "cadence": "quarterly", "sizeGroup": "smaller", "entryYear": 2015, "horizonEligible": True},
        {"duration": 3, "event": True, "cadence": "quarterly", "sizeGroup": "smaller", "entryYear": 2015, "horizonEligible": True},
        {"duration": 12, "event": False, "cadence": "annual", "sizeGroup": "smaller", "entryYear": 2015, "horizonEligible": True},
        {"duration": 12, "event": False, "cadence": "quarterly", "sizeGroup": "larger", "entryYear": 2016, "horizonEligible": True},
        {"duration": 12, "event": False, "cadence": "quarterly", "sizeGroup": "larger", "entryYear": 2016, "horizonEligible": True},
        {"duration": 12, "event": False, "cadence": "annual", "sizeGroup": "larger", "entryYear": 2016, "horizonEligible": True},
        {"duration": 6, "event": True, "cadence": "quarterly", "sizeGroup": "smaller", "entryYear": 2016, "horizonEligible": True},
        {"duration": 12, "event": False, "cadence": "quarterly", "sizeGroup": "smaller", "entryYear": 2016, "horizonEligible": True},
        {"duration": 12, "event": False, "cadence": "annual", "sizeGroup": "smaller", "entryYear": 2016, "horizonEligible": True},
        {"duration": 6, "event": False, "cadence": "annual", "sizeGroup": "missing_or_unknown", "entryYear": 2019, "horizonEligible": False},
    ]
    result = result_from_records(fixture)
    primary = result["standardizedSize"]
    check("Historische D5-Bindung und aktuelle Schwellen-Skripte sind beide exakt",
          bound_inputs_ok is True, bound_inputs_ok)
    check("Fixture zaehlt genau dreizehn Firmen", result["counts"]["companies"] == 13,
          result["counts"])
    check("Primaere Standardisierung verwendet genau zwoelf Firmen",
          result["effectiveN"]["primaryEligibleCompanies"] == 12,
          result["effectiveN"])
    check("Beide Eintrittsjahre erhalten von Hand Gewicht ein halb",
          all(abs(row["commonWeight"] - 0.5) < 1e-12
              for row in primary["entryYearRows"]), primary["entryYearRows"])
    check("Standardisierte Larger-Survival ist von Hand fuenf Sechstel",
          abs(primary["largerSurvivalAtHorizon"] - 5 / 6) < 1e-12, primary)
    check("Standardisierte Smaller-Survival ist von Hand ein halb",
          abs(primary["smallerSurvivalAtHorizon"] - 0.5) < 1e-12, primary)
    check("Standardisierte Differenz ist von Hand minus ein Drittel",
          abs(primary["survivalDifferencePercentagePointsSmallerMinusLarger"]
              + 100 / 3) < 1e-9, primary)
    check("Fuenf-Punkte-Schwelle greift in der Fixture",
          primary["thresholdCrossed"] is True, primary)
    check("Standardisierte Richtung stimmt mit unstandardisierter Richtung ueberein",
          primary["directionConsistentWithD4"] is True, primary)
    check("Spaete Eintrittskohorte bleibt sichtbar aber am Horizont ungeschaetzt",
          result["entryCohorts"]["groups"][-1]["entryYear"] == 2019
          and result["entryCohorts"]["groups"][-1]["survivalAtHorizon"] is None,
          result["entryCohorts"]["groups"][-1])
    check("Quartals- und Jahreskadenz gehen gemeinsam auf dreizehn auf",
          sum(group["companies"] for group in result["cadence"]["groups"].values()) == 13,
          result["cadence"]["groups"])
    check("Eintrittskohorten gehen gemeinsam auf dreizehn auf",
          sum(group["companies"] for group in result["entryCohorts"]["groups"]) == 13,
          result["entryCohorts"]["groups"])
    check("Gemeinsame Gewichte summieren sich exakt zu eins",
          abs(sum(row["commonWeight"] for row in primary["entryYearRows"]) - 1.0) < 1e-12,
          primary["entryYearRows"])
    check("Effektives N addiert die drei Tabellen nie",
          result["effectiveN"]["tableTotalsMayBeAdded"] is False
          and result["effectiveN"]["dailyPoints"] == 0,
          result["effectiveN"])
    check("Aggregat schreibt weder Firmenidentitaet noch Signal",
          result["scope"]["companyIdentifiersWritten"] == 0
          and result["scope"]["signalsUsed"] == 0, result["scope"])

    if failures:
        print("SELBSTTEST ROT - %d Pruefung(en) gescheitert" % len(failures))
        return 1
    print("SELBSTTEST GRUEN - 15 benannte Pruefungen")
    return 0


def main(argv=None):
    parser = argparse.ArgumentParser(description="D5 entry-year standardization")
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument("--discovery")
    parser.add_argument("--validation")
    parser.add_argument("--output")
    args = parser.parse_args(argv)
    if args.self_test:
        return self_test()
    if not (args.discovery and args.validation and args.output):
        parser.error("--discovery, --validation and --output are required")
    result = build_result([args.discovery, args.validation])
    write_json(args.output, result)
    print(json.dumps({
        "companies": result["counts"]["companies"],
        "standardizedSizeDifferencePP": result["standardizedSize"][
            "survivalDifferencePercentagePointsSmallerMinusLarger"
        ],
        "cadenceDifferencePP": result["cadence"][
            "survivalDifferencePercentagePointsAnnualMinusQuarterly"
        ],
        "entryCohortRangePP": result["entryCohorts"][
            "maxMinusMinSurvivalPercentagePoints"
        ],
    }, sort_keys=True))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (
            StandardizationError,
            D4.SensitivityError,
            D2.AssociationError,
            D1.SurvivalError,
    ) as error:
        print("ABBRUCH: " + str(error), file=sys.stderr)
        sys.exit(1)

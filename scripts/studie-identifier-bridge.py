#!/usr/bin/env python3
"""D3: reproduce E4a and apply an aggregate identity-only availability bridge."""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import inspect
import json
import os
import sys


REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PREREG_REL = "protocol/early-detection/2.0.0/d3-identifier-bridge-preregistration.json"
PREREG = os.path.join(REPO, *PREREG_REL.split("/"))
E4A_SCRIPT = os.path.join(REPO, "scripts", "studie-e4a-diagnose.py")
BASIS_SCRIPT = os.path.join(REPO, "scripts", "studie-basisraten.py")
COUNT_SCRIPT = os.path.join(REPO, "scripts", "studie-zaehlprobe.py")
ANCHORS = {
    "entdeckung": os.path.join(REPO, "reports", "studie",
                                "E4a-diagnose-entdeckung-2026-08-19.json"),
    "pruefung": os.path.join(REPO, "reports", "studie",
                              "E4a-diagnose-pruefung-2026-08-19.json"),
}
PANELS = {
    "entdeckung": "panel-entdeckung.sqlite",
    "pruefung": "panel-validierung.sqlite",
}
PRIMARY_BANDS = {"entdeckung": "2009-2015", "pruefung": "2017-2019"}
ARMS = ("signal", "kontrolle")
FIELDS = (
    "firmen_mit_erst_ereignis", "fallzahl", "unreif_gesamt",
    "klasse_a_keine_folgequartale", "klasse_b_kennung_gewechselt",
    "klasse_b1_nur_kennungsname", "klasse_b2_auch_waehrungseinheit",
    "klasse_c_zu_wenige_folgequartale", "klasse_d_ohne_gewaehlte_reihe",
    "hypothetische_fallzahl_anschlussfaehig",
)


class BridgeError(Exception):
    """Fail-closed contract violation."""


def load_module(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


E4A = load_module(E4A_SCRIPT, "d3_e4a")


def sha256_file(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def verify_bound_code():
    with open(PREREG, encoding="utf-8") as handle:
        expected = json.load(handle)["boundImplementation"]
    actual = {
        "scripts/studie-e4a-diagnose.py": sha256_file(E4A_SCRIPT),
        "scripts/studie-basisraten.py": sha256_file(BASIS_SCRIPT),
        "scripts/studie-zaehlprobe.py": sha256_file(COUNT_SCRIPT),
    }
    if actual != expected:
        raise BridgeError("A bound E4a implementation file changed after preregistration")
    return actual


def check_panel_path(path, window):
    absolute = os.path.abspath(path)
    if os.path.basename(absolute) != PANELS[window]:
        raise BridgeError("Panel basename does not match preregistered window")
    return E4A.zp.pruefe_mauer(absolute, window)


def bridge_metrics(block):
    total = int(block["firmen_mit_erst_ereignis"])
    retained_before = int(block["fallzahl"])
    attrition_before = int(block["unreif_gesamt"])
    recovered = int(block["klasse_b1_nur_kennungsname"])
    currency_change_not_recovered = int(block["klasse_b2_auch_waehrungseinheit"])
    remaining = attrition_before - recovered
    retained_after = retained_before + recovered
    if retained_before + attrition_before != total:
        raise BridgeError("Pre-bridge counts do not reconcile")
    if recovered + remaining != attrition_before:
        raise BridgeError("Recovered plus remaining does not equal pre-bridge attrition")
    if retained_after + remaining != total:
        raise BridgeError("Post-bridge counts do not reconcile")
    if int(block["klasse_b_kennung_gewechselt"]) != (
            recovered + currency_change_not_recovered):
        raise BridgeError("Identifier-change subclasses do not reconcile")
    expected_remaining = sum(int(block[key]) for key in (
        "klasse_a_keine_folgequartale", "klasse_b2_auch_waehrungseinheit",
        "klasse_c_zu_wenige_folgequartale", "klasse_d_ohne_gewaehlte_reihe"))
    if remaining != expected_remaining:
        raise BridgeError("Remaining attrition is not exactly a+b2+c+d")
    return {
        "firstEventCompanies": total,
        "retainedBeforeBridge": retained_before,
        "attritionBeforeBridge": attrition_before,
        "attritionRateBeforeBridge": attrition_before / total if total else None,
        "identityOnlyRecovered": recovered,
        "currencyChangeNotRecovered": currency_change_not_recovered,
        "retainedAfterBridge": retained_after,
        "retentionRateAfterBridge": retained_after / total if total else None,
        "remainingAttrition": remaining,
        "remainingAttritionRate": remaining / total if total else None,
        "retentionImprovementPercentagePoints": 100.0 * recovered / total if total else None,
        "zeroRecoveryNullRejectedDescriptively": recovered >= 1,
    }


def compare_anchor(recomputed, anchor, window):
    band = PRIMARY_BANDS[window]
    for variant in ("S-U", "S-G"):
        for arm in ARMS:
            left = recomputed[band]["varianten"][variant][arm]
            right = anchor["baender"][band]["varianten"][variant][arm]
            for field in FIELDS:
                if left[field] != right[field]:
                    raise BridgeError(
                        "Recomputed E4a aggregate differs from committed anchor at "
                        + "/".join((window, band, variant, arm, field)))


def run_window(window, panel_path, work_path):
    if os.path.exists(work_path):
        raise BridgeError("Work file already exists; refusing an implicit delete: " + work_path)
    checked = check_panel_path(panel_path, window)
    panel = E4A.zp.oeffne_nur_lesend(checked, window)
    try:
        e2 = E4A.zp.lade_modul(E4A.zp.E2_SKRIPT, "d3_basis_" + window)
        return E4A.diagnose_fenster(panel, work_path, e2, window)
    finally:
        panel.close()


def build_result(discovery, validation, work_dir):
    bound = verify_bound_code()
    os.makedirs(work_dir, exist_ok=True)
    recomputed = {}
    for index, (window, panel_path) in enumerate((
            ("entdeckung", discovery), ("pruefung", validation)), start=1):
        work_path = os.path.join(work_dir, "d3-bridge-work-%d.sqlite" % index)
        recomputed[window] = run_window(window, panel_path, work_path)
        with open(ANCHORS[window], encoding="utf-8") as handle:
            anchor = json.load(handle)
        compare_anchor(recomputed[window], anchor, window)

    rows = []
    controls = []
    for window in ("entdeckung", "pruefung"):
        band = PRIMARY_BANDS[window]
        variants = recomputed[window][band]["varianten"]
        for arm in ARMS:
            rows.append({"window": window, "band": band, "arm": arm,
                         **bridge_metrics(variants["S-U"][arm])})
            controls.append({"window": window, "band": band, "arm": arm,
                             **bridge_metrics(variants["S-G"][arm])})

    result = {
        "schema": "D3-identifier-bridge/1",
        "preregistration": {"path": PREREG_REL, "sha256": sha256_file(PREREG),
                            "status": "FROZEN_BEFORE_D3_FACT_ACCESS"},
        "boundImplementation": bound,
        "sourceReproduction": {
            "anchorsMatched": True,
            "anchors": [
                {"file": os.path.basename(ANCHORS[window]),
                 "sha256": sha256_file(ANCHORS[window])}
                for window in ("entdeckung", "pruefung")
            ],
        },
        "scope": {"variant": "S-U", "signalsChanged": 0,
                  "crossSeamValueComputations": 0, "companyIdentifiersWritten": 0,
                  "dailyObservationsUsed": 0, "lastAllowedDate": "2020-12-31"},
        "results": rows,
        "negativeControlSG": controls,
        "nullModel": {"name": "identity-only bridge recovers zero companies",
                      "threshold": "at least one recovered company",
                      "anyRowRejectsDescriptively": any(
                          row["identityOnlyRecovered"] >= 1 for row in rows),
                      "isSignificanceTest": False},
    }
    validate_result(result)
    return result


def validate_result(result):
    for row in result["results"] + result["negativeControlSG"]:
        if row["retainedAfterBridge"] + row["remainingAttrition"] != row["firstEventCompanies"]:
            raise BridgeError("Output row does not reconcile")
    if any(row["identityOnlyRecovered"] != 0 for row in result["negativeControlSG"]):
        raise BridgeError("S-G negative control recovered an identifier-only case")

    def check_keys(value):
        if isinstance(value, dict):
            for key, child in value.items():
                if str(key).lower() in {
                        "cik", "ticker", "adsh", "companyname", "company_name",
                        "value", "signalvalue"}:
                    raise BridgeError("Identity or individual value leaked into output")
                check_keys(child)
        elif isinstance(value, list):
            for child in value:
                check_keys(child)
    check_keys(result)


def write_json(path, result):
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as handle:
        json.dump(result, handle, ensure_ascii=False, indent=2, sort_keys=True)
        handle.write("\n")


def fixture_block(**changes):
    block = {
        "firmen_mit_erst_ereignis": 10,
        "fallzahl": 6,
        "unreif_gesamt": 4,
        "klasse_a_keine_folgequartale": 1,
        "klasse_b_kennung_gewechselt": 2,
        "klasse_b1_nur_kennungsname": 1,
        "klasse_b2_auch_waehrungseinheit": 1,
        "klasse_c_zu_wenige_folgequartale": 1,
        "klasse_d_ohne_gewaehlte_reihe": 0,
        "hypothetische_fallzahl_anschlussfaehig": 8,
    }
    block.update(changes)
    return block


def self_test():
    failures = []

    def check(name, condition, actual=None):
        if condition:
            print("  ok    " + name)
        else:
            failures.append(name)
            print("  ROT   " + name + " (ist: " + repr(actual) + ")")

    bound = verify_bound_code()
    check("Drei gebundene Rechenmodule sind bytegleich zur Vorregistrierung", len(bound) == 3, bound)
    metrics = bridge_metrics(fixture_block())
    check("Nur der reine Kennungsname wird zurueckgewonnen",
          metrics["identityOnlyRecovered"] == 1, metrics)
    check("Waehrungseinheitswechsel bleibt ausdruecklich Verlust",
          metrics["currencyChangeNotRecovered"] == 1, metrics)
    check("Verbleibender Schwund ist exakt a plus b2 plus c plus d",
          metrics["remainingAttrition"] == 3, metrics)
    check("Nach Bruecke gehen zehn Firmen als sieben plus drei auf",
          metrics["retainedAfterBridge"] == 7
          and metrics["retainedAfterBridge"] + metrics["remainingAttrition"] == 10, metrics)
    check("Verbleibende Schwundquote ist von Hand 3/10",
          abs(metrics["remainingAttritionRate"] - 0.3) < 1e-12, metrics)
    check("Retention nach Bruecke ist von Hand 7/10",
          abs(metrics["retentionRateAfterBridge"] - 0.7) < 1e-12, metrics)
    check("Verbesserung ist von Hand zehn Prozentpunkte",
          abs(metrics["retentionImprovementPercentagePoints"] - 10.0) < 1e-12, metrics)
    check("Ein zurueckgewonnener Fall kippt das Nullmodell",
          metrics["zeroRecoveryNullRejectedDescriptively"] is True, metrics)
    zero = bridge_metrics(fixture_block(
        klasse_b_kennung_gewechselt=1,
        klasse_b1_nur_kennungsname=0,
        klasse_b2_auch_waehrungseinheit=1,
        klasse_a_keine_folgequartale=2))
    check("Nur Waehrungswechsel kippt das Nullmodell nicht",
          zero["zeroRecoveryNullRejectedDescriptively"] is False, zero)
    negative = bridge_metrics(fixture_block(
        klasse_b_kennung_gewechselt=0,
        klasse_b1_nur_kennungsname=0,
        klasse_b2_auch_waehrungseinheit=0,
        klasse_a_keine_folgequartale=2,
        klasse_c_zu_wenige_folgequartale=2))
    check("S-G-Negativkontrolle gewinnt null Kennungsfaelle zurueck",
          negative["identityOnlyRecovered"] == 0, negative)
    source = inspect.getsource(bridge_metrics).lower()
    check("Brueckenfunktion kennt keine Einzelwerte oder Wachstumsrechnung",
          all(word not in source for word in ("value", "wert", "growth", "wachstum", "acceleration")),
          source)
    check("Brueckenfunktion schreibt nur aggregierte Zaehler",
          all(key not in json.dumps(metrics).lower() for key in ('"cik"', '"adsh"', '"ticker"')),
          metrics)
    try:
        bridge_metrics(fixture_block(unreif_gesamt=5))
        reconciliation_failed = False
    except BridgeError:
        reconciliation_failed = True
    check("Eine nicht aufgehende Klassenzerlegung bricht fail-closed ab", reconciliation_failed)

    if failures:
        print("SELBSTTEST ROT - %d Pruefung(en) gescheitert" % len(failures))
        return 1
    print("SELBSTTEST GRUEN - 14 benannte Pruefungen")
    return 0


def main(argv=None):
    parser = argparse.ArgumentParser(description="D3 identity-only availability bridge")
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument("--discovery")
    parser.add_argument("--validation")
    parser.add_argument("--work-dir")
    parser.add_argument("--output")
    args = parser.parse_args(argv)
    if args.self_test:
        return self_test()
    if not (args.discovery and args.validation and args.work_dir and args.output):
        parser.error("--discovery, --validation, --work-dir and --output are required")
    result = build_result(args.discovery, args.validation, args.work_dir)
    write_json(args.output, result)
    target = next(row for row in result["results"]
                  if row["window"] == "pruefung" and row["arm"] == "signal")
    print(json.dumps({
        "firstEventCompanies": target["firstEventCompanies"],
        "identityOnlyRecovered": target["identityOnlyRecovered"],
        "remainingAttrition": target["remainingAttrition"],
        "remainingAttritionRate": target["remainingAttritionRate"],
    }, sort_keys=True))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (BridgeError, E4A.DiagnoseFehler, E4A.zp.ProbeFehler) as error:
        print("ABBRUCH: " + str(error), file=sys.stderr)
        sys.exit(1)

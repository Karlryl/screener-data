#!/usr/bin/env python3
"""Shared fail-closed binding from D-series decisions to frozen preregistrations."""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import math
import os
import re
import sys


REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SEAL_REL = "protocol/early-detection/2.0.0/r2-d-threshold-seal.json"
SEAL = os.path.join(REPO, *SEAL_REL.split("/"))
AT_LEAST_RE = re.compile(r"\bat least\s+([0-9]+(?:\.[0-9]+)?)\b", re.IGNORECASE)


class ThresholdSealError(Exception):
    """Fail-closed threshold binding violation."""


def repo_path(relative: str, repo: str = REPO) -> str:
    return os.path.join(repo, *relative.split("/"))


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
        raise ThresholdSealError("Threshold source is not a JSON object: " + path)
    return value


def nested(value: dict[str, object], path: list[str]) -> object:
    current: object = value
    for part in path:
        if not isinstance(current, dict) or part not in current:
            raise ThresholdSealError("Threshold source path is absent: " + ".".join(path))
        current = current[part]
    return current


def extract_number(value: object, mode: str) -> float:
    if mode == "number":
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise ThresholdSealError("Numeric threshold source is not numeric")
        number = float(value)
    elif mode == "atLeastText":
        match = AT_LEAST_RE.search(str(value))
        if match is None:
            raise ThresholdSealError("Threshold text has no 'at least N' value")
        number = float(match.group(1))
    else:
        raise ThresholdSealError("Unknown threshold extractor: " + str(mode))
    if not math.isfinite(number):
        raise ThresholdSealError("Threshold source is not finite")
    return number


def values_from_objects(
        seal: dict[str, object],
        preregistrations: dict[str, dict[str, object]],
        component: str) -> dict[str, float | int]:
    components = seal.get("components")
    if not isinstance(components, dict) or component not in components:
        raise ThresholdSealError("Threshold component is absent: " + component)
    component_seal = components[component]
    definitions = component_seal.get("thresholds") if isinstance(component_seal, dict) else None
    if not isinstance(definitions, dict) or not definitions:
        raise ThresholdSealError("Threshold component has no definitions: " + component)
    result: dict[str, float | int] = {}
    for name, definition in definitions.items():
        if not isinstance(definition, dict):
            raise ThresholdSealError("Malformed threshold definition: " + str(name))
        prereg_name = definition.get("sourcePreregistration")
        if prereg_name not in preregistrations:
            raise ThresholdSealError("Threshold preregistration is absent: " + str(prereg_name))
        source_path = definition.get("sourcePath")
        if not isinstance(source_path, list) or not all(isinstance(item, str) for item in source_path):
            raise ThresholdSealError("Threshold source path is malformed: " + str(name))
        extracted = extract_number(
            nested(preregistrations[prereg_name], source_path),
            str(definition.get("extract")),
        )
        sealed = definition.get("value")
        if isinstance(sealed, bool) or not isinstance(sealed, (int, float)):
            raise ThresholdSealError("Sealed threshold value is not numeric: " + str(name))
        if float(sealed) != extracted:
            raise ThresholdSealError(
                "Threshold seal disagrees with frozen preregistration for " + str(name)
            )
        result[name] = int(sealed) if isinstance(sealed, int) else float(sealed)
    return result


def load_thresholds(
        component: str,
        caller_path: str,
        error_type=ThresholdSealError) -> tuple[dict[str, float | int], dict[str, str]]:
    try:
        seal = read_json(SEAL)
        if seal.get("status") != "FROZEN_THRESHOLD_BINDING_CORRECTION":
            raise ThresholdSealError("D-series threshold seal is not frozen")
        sources = seal.get("sourcePreregistrations")
        if not isinstance(sources, dict) or not sources:
            raise ThresholdSealError("Threshold seal has no source preregistrations")
        preregistrations = {}
        for name, descriptor in sources.items():
            if not isinstance(descriptor, dict):
                raise ThresholdSealError("Malformed preregistration descriptor: " + str(name))
            relative = descriptor.get("path")
            expected = descriptor.get("sha256")
            if not isinstance(relative, str) or not isinstance(expected, str):
                raise ThresholdSealError("Incomplete preregistration descriptor: " + str(name))
            source_path = repo_path(relative)
            if not os.path.isfile(source_path):
                raise ThresholdSealError("Frozen preregistration is absent: " + relative)
            if sha256_file(source_path) != expected:
                raise ThresholdSealError("Frozen preregistration hash changed: " + relative)
            preregistrations[name] = read_json(source_path)

        scripts = seal.get("currentScripts")
        if not isinstance(scripts, dict):
            raise ThresholdSealError("Threshold seal has no current-script map")
        component_descriptor = seal["components"].get(component)
        caller_relative = (
            component_descriptor.get("script")
            if isinstance(component_descriptor, dict)
            else None
        )
        if not isinstance(caller_relative, str):
            raise ThresholdSealError("Threshold component has no caller script")
        actual_caller = os.path.normcase(os.path.abspath(caller_path))
        expected_caller = os.path.normcase(os.path.abspath(repo_path(caller_relative)))
        if actual_caller != expected_caller:
            raise ThresholdSealError("Threshold component called from an unsealed script")
        required_scripts = {
            "scripts/studie-threshold-seal.py": __file__,
            caller_relative: caller_path,
        }
        for relative, actual_path in required_scripts.items():
            expected_hash = scripts.get(relative)
            if not isinstance(expected_hash, str) or sha256_file(actual_path) != expected_hash:
                raise ThresholdSealError("Threshold-bound script hash changed: " + relative)

        values = values_from_objects(seal, preregistrations, component)
        return values, {"path": SEAL_REL, "sha256": sha256_file(SEAL)}
    except ThresholdSealError as error:
        if error_type is ThresholdSealError:
            raise
        raise error_type(str(error)) from error


def self_test() -> int:
    failures = []

    def check(name: str, condition: bool, actual: object = None) -> None:
        if condition:
            print("  ok    " + name)
        else:
            failures.append(name)
            print("  ROT   " + name + " (ist: " + repr(actual) + ")")

    seal = read_json(SEAL)
    preregs = {
        name: read_json(repo_path(descriptor["path"]))
        for name, descriptor in seal["sourcePreregistrations"].items()
    }
    expected = {
        "d2": {"sizeThresholdPP": 5.0, "sectorThresholdV": 0.1, "sectorMinimumN": 200},
        "d4": {"sizeThresholdPP": 5.0, "sectorThresholdPP": 10.0, "sectorMinimumN": 200},
        "d5": {
            "sizeThresholdPP": 5.0,
            "cadenceThresholdPP": 5.0,
            "cohortThresholdPP": 10.0,
            "cohortMinimumN": 200,
        },
    }
    actual = {name: values_from_objects(seal, preregs, name) for name in expected}
    check("Alle D2-D5-Schwellen stammen aus ihren eingefrorenen Objekten",
          actual == expected, actual)

    lowered = copy.deepcopy(preregs)
    lowered["d4"]["sectorSensitivity"]["threshold"] = (
        "a range of at least 8.0 percentage points is flagged descriptively"
    )
    try:
        values_from_objects(seal, lowered, "d4")
        lowering_blocked = False
    except ThresholdSealError:
        lowering_blocked = True
    check("Eine auf 8.0 gesenkte Sektorschwelle wird rot", lowering_blocked)

    missing = copy.deepcopy(preregs)
    del missing["d5"]["cadenceSensitivity"]["threshold"]
    try:
        values_from_objects(seal, missing, "d5")
        absence_blocked = False
    except ThresholdSealError:
        absence_blocked = True
    check("Eine fehlende Schwelle wird rot", absence_blocked)

    changed_seal = copy.deepcopy(seal)
    changed_seal["components"]["d2"]["thresholds"]["sectorThresholdV"]["value"] = 0.08
    try:
        values_from_objects(changed_seal, preregs, "d2")
        seal_lowering_blocked = False
    except ThresholdSealError:
        seal_lowering_blocked = True
    check("Eine nur im Siegel gesenkte Schwelle wird rot", seal_lowering_blocked)

    if failures:
        print("SELBSTTEST ROT - %d Pruefung(en) gescheitert" % len(failures))
        return 1
    print("SELBSTTEST GRUEN - 4 benannte Pruefungen")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="D-series threshold seal")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args(argv)
    if args.self_test:
        return self_test()
    parser.error("--self-test is required")


if __name__ == "__main__":
    try:
        sys.exit(main())
    except ThresholdSealError as error:
        print("ABBRUCH: " + str(error), file=sys.stderr)
        sys.exit(1)

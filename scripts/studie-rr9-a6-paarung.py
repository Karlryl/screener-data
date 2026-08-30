#!/usr/bin/env python3
"""RR9-A6 Stufe 1, erste Ausgabe - die PAARUNGSTABELLE.

DIE FRAGE, DIE NUR S2 GESEHEN HAT: R6 verlangt eine Sensitivitaet "je Quartal".
Dafuer braucht es Quartale, die BEIDE Jahrgaenge tragen. Gemessen und berichtet
waren bisher drei GETRENNTE Zaehlungen - 64 legacy, 69 reprozessiert, 50 ohne
Kennzeichen - aber kein einziger Paarungswert. Die Schnittmenge ist die Groesse,
die R6 ueberhaupt ausfuehrbar macht, und sie war ungemessen.

RUECKKEHR-KLAUSEL (RR9-A6 Ziffer 3): deckt die Schnittmenge die
Prueffenster-Quartale NICHT, ist R6 nicht ausfuehrbar und RR-5 kehrt als
Methodikfrage zurueck. Genau das entscheidet diese Tabelle.

Was hier NICHT passiert: kein Panel wird geoeffnet, kein Blob entpackt, kein
Wert gelesen. Gezaehlt werden ausschliesslich die Beobachtungs-Records des
Speichers und ihr Feld `datasetVariant`. Stufe 1s zweite Haelfte (Schluessel-
und Zeilenvergleich) und Stufe 2 (volle Zwei-Panel-Sensitivitaet) sind hier
ausdruecklich nicht enthalten.

Aufruf:
  python scripts/studie-rr9-a6-paarung.py --daten-wurzel <pfad> [--ziel <datei>]
  python scripts/studie-rr9-a6-paarung.py --selbsttest
"""

import argparse
import collections
import json
import os
import sys

ORTE = ("early-detection-v4", "early-detection-v4-sealed127", "early-detection-store")
BEOBACHTUNGEN = ("observations", "sec-fsd")
LEGACY = "legacy_earliest_archived"
POST2024 = "post_2024_reprocessed_or_current"
OHNE = "OHNE_KENNZEICHEN"
FENSTER = (("entdeckung", 2009, 2016), ("pruefung", 2017, 2020),
           ("endtest", 2021, 2024))


def lies_beobachtungen(daten_wurzel, orte=ORTE):
    """(quartal, variante, ort) je Beobachtungs-Record. Fehlt das Feld, heisst
    das OHNE_KENNZEICHEN - nie ein Default auf einen der beiden Jahrgaenge."""
    treffer = []
    je_ort = {}
    for ort in orte:
        wurzel = os.path.join(daten_wurzel, ort, *BEOBACHTUNGEN)
        zahl = 0
        if os.path.isdir(wurzel):
            for quartal in sorted(os.listdir(wurzel)):
                verz = os.path.join(wurzel, quartal)
                if not os.path.isdir(verz):
                    continue
                for name in sorted(os.listdir(verz)):
                    if not name.endswith(".json"):
                        continue
                    with open(os.path.join(verz, name), encoding="utf-8") as fh:
                        rec = json.load(fh)
                    treffer.append((quartal, rec.get("datasetVariant") or OHNE, ort))
                    zahl += 1
        je_ort[ort] = {"vorhanden": os.path.isdir(wurzel), "beobachtungen": zahl}
    return treffer, je_ort


def paarungstabelle(daten_wurzel, orte=ORTE):
    treffer, je_ort = lies_beobachtungen(daten_wurzel, orte)
    je_quartal = collections.defaultdict(collections.Counter)
    varianten = collections.Counter()
    for quartal, variante, _ort in treffer:
        je_quartal[quartal][variante] += 1
        varianten[variante] += 1

    legacy = {q for q, c in je_quartal.items() if c[LEGACY] > 0}
    post = {q for q, c in je_quartal.items() if c[POST2024] > 0}
    beide = legacy & post

    def im_fenster(menge, von, bis):
        return sorted(q for q in menge if q[:4].isdigit() and von <= int(q[:4]) <= bis)

    je_fenster = {}
    for name, von, bis in FENSTER:
        alle_q = im_fenster(set(je_quartal), von, bis)
        je_fenster[name] = {
            "quartaleGesamt": len(alle_q),
            "beideJahrgaenge": len(im_fenster(beide, von, bis)),
            "nurLegacy": len(im_fenster(legacy - post, von, bis)),
            "nurPost2024": len(im_fenster(post - legacy, von, bis)),
            "quartaleOhneBeide": sorted(set(alle_q) - set(im_fenster(beide, von, bis))),
        }

    deckt_pruefenster = (je_fenster["pruefung"]["quartaleGesamt"] > 0
                         and not je_fenster["pruefung"]["quartaleOhneBeide"])
    return {
        "schema": "studie-rr9-a6-paarungstabelle/v1",
        "auflage": "RR9-A6 Stufe 1, erste Ausgabe - _COURT-RR9-2026-08-30",
        "pruefmethode": {
            "wie": ("Gezaehlt werden die Beobachtungs-Records des Speichers "
                    "(observations/sec-fsd/<quartal>/*.json) am Feld "
                    "`datasetVariant`. Kein Panel, kein Blob-Inhalt, kein Wert."),
            "wasNichtEnthaltenIst": ("Stufe 1s Schluessel- und Zeilenvergleich "
                                     "sowie Stufe 2 (Zwei-Panel-Sensitivitaet)."),
        },
        "suchachsen": [
            {"achse": "Verzeichnis", "status": "gemessen",
             "wert": "je Ort observations/sec-fsd/<quartal>"},
            {"achse": "Feldname", "status": "gemessen", "wert": "datasetVariant"},
            {"achse": "Registerfeld", "status": "ungemessen",
             "wert": "ob ein Payload registriert ist, sagt diese Tabelle nicht"},
        ],
        "orte": je_ort,
        "beobachtungenGesamt": len(treffer),
        "variantenGesamt": dict(varianten),
        "ohneJahrgangsKennzeichen": varianten[OHNE],
        "quartaleGesamt": len(je_quartal),
        "quartaleBeideJahrgaenge": len(beide),
        "quartaleNurLegacy": sorted(legacy - post),
        "quartaleNurPost2024": sorted(post - legacy),
        "jeFenster": je_fenster,
        "schnittmengeDecktPrueffenster": deckt_pruefenster,
        "rueckkehrklausel": (
            "NICHT AUSGELOEST: die Schnittmenge deckt die Prueffenster-Quartale "
            "vollstaendig. R6 ist je Quartal ausfuehrbar; RR-5 kehrt NICHT als "
            "Methodikfrage zurueck."
            if deckt_pruefenster else
            "AUSGELOEST: die Schnittmenge deckt die Prueffenster-Quartale NICHT. "
            "R6 ist nicht ausfuehrbar; RR-5 kehrt als Methodikfrage zurueck."),
        "bekannteVergleichsgrenze": (
            "Die `segments`-Asymmetrie zwischen den Jahrgaengen (K1 §4 Grenze 4, "
            "A4-Legacy-Sonderfall) und die 6 bzw. 11 gezaehlten, nicht "
            "untersuchten `value`-Abweichungen bleiben als benannte Grenze im "
            "R6-Bericht - diese Tabelle raeumt sie nicht aus."),
    }


def selbsttest():
    import tempfile
    ok = fehl = 0

    def pruefe(name, bedingung):
        nonlocal ok, fehl
        if bedingung:
            ok += 1
            print("  ok   " + name)
        else:
            fehl += 1
            print("  FAIL " + name)

    def bestand(tmp, saetze):
        ort = ORTE[0]
        for quartal, variante in saetze:
            verz = os.path.join(tmp, ort, *BEOBACHTUNGEN, quartal)
            os.makedirs(verz, exist_ok=True)
            name = str(len(os.listdir(verz))) + ".json"
            rec = {} if variante is None else {"datasetVariant": variante}
            with open(os.path.join(verz, name), "w", encoding="utf-8") as fh:
                json.dump(rec, fh)
        return (ort,)

    # 1. Ein Quartal mit beiden Jahrgaengen im Prueffenster -> Klausel schweigt.
    with tempfile.TemporaryDirectory() as tmp:
        orte = bestand(tmp, [("2018q1", LEGACY), ("2018q1", POST2024)])
        t = paarungstabelle(tmp, orte)
        pruefe("Schnittmenge zaehlt das gepaarte Quartal",
               t["quartaleBeideJahrgaenge"] == 1)
        pruefe("Rueckkehrklausel schweigt, wenn das Prueffenster gedeckt ist",
               t["schnittmengeDecktPrueffenster"] is True
               and "NICHT AUSGELOEST" in t["rueckkehrklausel"])

    # 2. ROT-PROBE: ein Prueffenster-Quartal ohne Gegenstueck -> Klausel feuert.
    with tempfile.TemporaryDirectory() as tmp:
        orte = bestand(tmp, [("2018q1", LEGACY), ("2018q1", POST2024),
                             ("2019q2", LEGACY)])
        t = paarungstabelle(tmp, orte)
        pruefe("ROT-PROBE A6: ungepaartes Prueffenster-Quartal loest die "
               "Rueckkehrklausel aus",
               t["schnittmengeDecktPrueffenster"] is False
               and "AUSGELOEST" in t["rueckkehrklausel"]
               and t["jeFenster"]["pruefung"]["quartaleOhneBeide"] == ["2019q2"])

    # 3. Ein Record ohne Feld ist OHNE_KENNZEICHEN, nie ein stiller Jahrgang.
    with tempfile.TemporaryDirectory() as tmp:
        orte = bestand(tmp, [("2018q1", LEGACY), ("2018q1", POST2024),
                             ("2018q1", None)])
        t = paarungstabelle(tmp, orte)
        pruefe("fehlendes datasetVariant zaehlt als OHNE_KENNZEICHEN",
               t["ohneJahrgangsKennzeichen"] == 1
               and t["variantenGesamt"].get(OHNE) == 1)

    print("selbsttest: %d ok, %d FAIL" % (ok, fehl))
    return 0 if fehl == 0 else 1


def main(argv=None):
    p = argparse.ArgumentParser(description="RR9-A6 Paarungstabelle")
    p.add_argument("--daten-wurzel")
    p.add_argument("--ziel")
    p.add_argument("--selbsttest", action="store_true")
    a = p.parse_args(argv)
    if a.selbsttest:
        return selbsttest()
    if not a.daten_wurzel:
        print("--daten-wurzel fehlt", file=sys.stderr)
        return 2
    t = paarungstabelle(a.daten_wurzel)
    print("Beobachtungen        : %d (%s)"
          % (t["beobachtungenGesamt"],
             ", ".join("%s %d" % (k, v) for k, v in sorted(t["variantenGesamt"].items()))))
    print("ohne Kennzeichen     : %d" % t["ohneJahrgangsKennzeichen"])
    print("Quartale gesamt      : %d, davon BEIDE Jahrgaenge: %d"
          % (t["quartaleGesamt"], t["quartaleBeideJahrgaenge"]))
    for name, _v, _b in FENSTER:
        f = t["jeFenster"][name]
        print("  %-11s %2d Quartale | beide %2d | nur legacy %2d | nur post %2d"
              % (name, f["quartaleGesamt"], f["beideJahrgaenge"],
                 f["nurLegacy"], f["nurPost2024"]))
    print("Rueckkehrklausel     : " + t["rueckkehrklausel"])
    if a.ziel:
        with open(a.ziel, "w", encoding="utf-8", newline="\n") as fh:
            json.dump(t, fh, ensure_ascii=False, indent=1, sort_keys=True)
            fh.write("\n")
        print("Bericht              : " + a.ziel)
    return 0


if __name__ == "__main__":
    sys.exit(main())

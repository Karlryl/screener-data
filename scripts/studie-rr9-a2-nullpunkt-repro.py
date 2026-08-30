#!/usr/bin/env python3
"""RR9-A2 Schritt 2 - die Reproduktion des V0-Nullpunkts.

DIE AUFLAGE, WOERTLICH (_COURT-RR9-2026-08-30, RR9-A2 Ziffer 2):
  "Vor F4 wird gezeigt, dass `arm_zaehlen` (R5, identischer Codepfad) die alte
   Allowlist als Parameter fahren kann und auf dem bestehenden Panel die
   registrierte 326/365 bit-gleich reproduziert. Bit-gleich -> weiter.
   Abweichend -> Stopp und Veroeffentlichung der Abweichung. Jede andere
   Reaktion - Neubemessung von Design, Liste, Preis oder Zeitplan - ist
   untersagt."

DAS ZIEL IST NICHT 326/365. Der Bremsen-Bau hat gemessen, dass die 326/365 auf
der Variante S-G (`OperatingIncomeLoss`, `ERGEBNIS_QUELLEN`) ruht und NICHT auf
der `umsatzQuellenAllowlist` (Korrektur 1, agent-reports/rr9-bremsen-bau-
2026-08-30.md). Eine Reproduktion der 326/365 belegte damit die Zaehlkette, aber
nicht die Identitaet der Allowlist - und genau die Allowlist ist das Objekt von
B3'. Der Orchestrator hat den Anker deshalb umgehaengt (ENTSCHIED 130):

  ZIEL = 292/438 (S-U, umsatzQuellenAllowlist), nicht 326/365 (S-G).

  Begruendung des Entscheids, hier zitiert statt nacherzaehlt: "B3-Strich soll
  die Basis pinnen, AUF der die Verbreiterung aufsetzt = die Quellen-Allowlist;
  326/365 ist per Korrektur 1 ein anderer Tripel-Teil (S-G) und belegt
  Allowlist-Identitaet nicht."

  KIPP-BEDINGUNG, unveraendert mitgefuehrt: "Liest eine kuenftige Ratssitzung V0
  anders, wird umverankert; die B3'-Tests machen die Umverankerung billig
  (ENTSCHIED 130)."

WARUM DIESES MODUL NICHT IN studie-rr9-nullpunkt.py LEBT
--------------------------------------------------------
Dort wacht ein AST-Waechter darueber, dass `arm_zaehlen`, `signale`,
`erst_ereignisse` und `ampel_fuer` im Modul NICHT erreichbar sind - das ist der
Blindheitskern des B2-Trockenlaufs (das Verhaeltnis der Reifequoten darf dort
strukturell nicht bildbar sein). Diese Reproduktion BRAUCHT genau diese
Funktionen; sie in dasselbe Modul zu legen haette den Waechter des Trockenlaufs
entwertet. Zwei verschiedene Blindheits-Anforderungen gehoeren in zwei Module.

DIE BLINDHEITS-ZAEUNE DIESES MODULS, eigenstaendig
--------------------------------------------------
1. NUR die Referenzkohorte (S-U unter der registrierten Allowlist). Die
   verbreiterte Konzeptliste 2.1.0 wird nie geladen - ihre Zaehlung IST F4.
2. Kein `ampel_fuer`, keine Quote, kein Verhaeltnis. Der Anker sind zwei
   ZAEHLUNGEN (292 und 438), nicht ihr Quotient.
3. KEIN Panel wird geoeffnet. Gerechnet wird auf dem gespeicherten
   Zwischenstand des bereits angemeldeten E3-Laufs
   (`geschriebenePfade: ["arbeit/E3-zwischenstand.sqlite"]` im E3-Bericht),
   nur-lesend und byte-gegengeprueft. Deshalb entsteht hier kein neuer
   Fenster-Zugriff und deshalb braucht dieser Lauf keine eigene K3/R1-Freigabe:
   der reproduzierte Wert steht seit dem 19.08. veroeffentlicht im Repo.
   `pruefe_kein_panel` haelt das fail-closed fest.
4. F4, F5, F5b und F6 bleiben gesperrt. Nichts hier startet sie.

Aufruf:
  python scripts/studie-rr9-a2-nullpunkt-repro.py reproduktion [--ziel <datei.json>]
                                                  [--zwischenstand <datei.sqlite>]
  python scripts/studie-rr9-a2-nullpunkt-repro.py selbsttest
"""

import argparse
import hashlib
import importlib.util
import json
import os
import sqlite3
import sys
from collections import defaultdict

WURZEL = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASISRATEN = os.path.join(WURZEL, "scripts", "studie-basisraten.py")
ZAEHLPROBE = os.path.join(WURZEL, "scripts", "studie-zaehlprobe.py")
NULLPUNKT_MODUL = os.path.join(WURZEL, "scripts", "studie-rr9-nullpunkt.py")
E3_BERICHT = os.path.join(WURZEL, "reports", "studie",
                          "E3-zaehlprobe-pruefung-2026-08-19.json")

DATENWURZEL_ENV = "EARLY_DETECTION_DATA_ROOT"
ZWISCHENSTAND_REL = os.path.join("arbeit", "E3-zwischenstand.sqlite")

# DER V0-NULLPUNKT. Zwei Zaehlungen, kein Quotient. Hier als Konstante notiert
# und NICHT aus dem E3-Bericht gelesen: ein Werkzeug, das seinen Sollwert aus
# der Datei holt, gegen die es prueft, prueft nichts. Der Bericht wird
# zusaetzlich gelesen und muss dasselbe sagen - zwei unabhaengige Quellen, damit
# eine still verstellte von der anderen auffliegt.
NULLPUNKT = {
    "variante": "S-U",
    "fallzahl": 292,
    "firmen_mit_erst_ereignis": 438,
    "zensierte_erst_ereignisse": 0,
}
NULLPUNKT_HERKUNFT = ("reports/studie/E3-zaehlprobe-pruefung-2026-08-19.json"
                      "::varianten['S-U'] - registriert und veroeffentlicht am "
                      "2026-08-19, runId e3-zaehlprobe-pruefung-2026-08-19-neulauf")

# Die Sanktion ist unveraendert die von B3'. Die Absenkung auf STOPP liegt als
# OFFEN-2 beim Gericht und ist NICHT vollzogen.
SANKTION = "BEERDIGEN"
EXIT_ABWEICHUNG = 5

# Panel-Dateinamen und -Ordner. Wer hier vorbeikommt, hat ein Fenster geoeffnet.
PANEL_TEILE = ("panel-entdeckung", "panel-validierung", "panel-endtest",
               "pruefung", "prüfung", "endtest", "schluessel", ".enc", ".key")

# Berichtsfelder, die es hier nicht geben darf: alles, was aus zwei Zaehlungen
# eine Bewertung macht. Der Anker ist der Zaehlerstand, nie sein Quotient.
VERBOTENE_FELDTEILE = ("quote", "ratio", "verhaeltnis", "ampel", "reife",
                       "auffindbar")


class ReproBruch(Exception):
    """Die Reproduktion weicht ab, oder ein Zaun ist gerissen."""


def lade(pfad, name):
    spec = importlib.util.spec_from_file_location(name, pfad)
    modul = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(modul)
    return modul


def sha256_datei(pfad, block=1 << 22):
    h = hashlib.sha256()
    with open(pfad, "rb") as fh:
        while True:
            stueck = fh.read(block)
            if not stueck:
                break
            h.update(stueck)
    return h.hexdigest()


class KeinSpeicherort(ReproBruch):
    """Der Speicherort ist gar nicht erst benannt.

    EIGENE KLASSE, und das ist der ganze Punkt: 'niemand hat gesagt, wo die
    Daten liegen' (im CI der Normalfall) und 'der benannte Ort ist leer' sind
    zwei verschiedene Lagen. Der Selbsttest darf nur die ERSTE ueberspringen.
    Vorher fielen beide in dasselbe `except ReproBruch` und ein verschwundener
    Zwischenstand meldete '0 FAIL', ohne je etwas reproduziert zu haben -
    genau die Klasse, gegen die dieses Modul geschrieben ist.
    """


def zwischenstand_pfad(vorgabe=None):
    if vorgabe:
        return vorgabe
    wurzel = os.environ.get(DATENWURZEL_ENV)
    if not wurzel:
        raise KeinSpeicherort(
            "Speicherort unbekannt: " + DATENWURZEL_ENV + " ist nicht gesetzt und "
            "--zwischenstand fehlt (R12a verbietet einen fest verdrahteten Pfad).")
    return os.path.join(wurzel, ZWISCHENSTAND_REL)


def pruefe_kein_panel(pfad):
    """Zaun 3, fail-closed: dieser Lauf oeffnet kein Fenster.

    Geprueft werden BEIDE Formen - der geschriebene Pfad und der ueber
    `realpath` aufgeloeste, damit eine Junction oder ein Symlink nicht daran
    vorbeifuehrt. Ein Treffer ist ein ABBRUCH, kein Filter.
    """
    for form in (os.path.abspath(pfad), os.path.realpath(pfad)):
        flach = form.replace(os.sep, "/").lower()
        for teil in PANEL_TEILE:
            if teil in flach:
                raise ReproBruch(
                    "RR9-A2-ABBRUCH: '" + pfad + "' (aufgeloest: '"
                    + os.path.realpath(pfad) + "') sieht nach einer Panel-Datei "
                    "oder nach Schluesselmaterial aus. Die Nullpunkt-"
                    "Reproduktion oeffnet KEIN Fenster - sie rechnet auf dem "
                    "gespeicherten Zwischenstand des bereits angemeldeten "
                    "E3-Laufs. Ein Fenster-Zugriff braeuchte eine eigene "
                    "K3/R1-Freigabe, die dieser Lauf nicht hat.")
    return os.path.realpath(pfad)


def verbotene_felder(baum, pfad=""):
    """Zaun 2: kein Feld, das aus den beiden Zaehlungen eine Bewertung macht."""
    treffer = []
    if isinstance(baum, dict):
        for name, wert in baum.items():
            voll = (pfad + "." + name) if pfad else name
            if any(teil in name.lower() for teil in VERBOTENE_FELDTEILE):
                treffer.append(voll)
            treffer.extend(verbotene_felder(wert, voll))
    elif isinstance(baum, list):
        for i, wert in enumerate(baum):
            treffer.extend(verbotene_felder(wert, pfad + "[" + str(i) + "]"))
    return treffer


def registrierter_nullpunkt(bericht=E3_BERICHT):
    """Die zweite, unabhaengige Quelle. Muss die Konstante bestaetigen."""
    variante = (json.load(open(bericht, encoding="utf-8")).get("varianten")
                or {}).get(NULLPUNKT["variante"])
    if not variante:
        raise ReproBruch(
            "RR9-A2-ABBRUCH: der E3-Bericht fuehrt die Variante "
            + repr(NULLPUNKT["variante"]) + " nicht mehr. Ohne den registrierten "
            "Wert gibt es keinen Nullpunkt.")
    aus_bericht = {k: variante.get(k) for k in
                   ("fallzahl", "firmen_mit_erst_ereignis",
                    "zensierte_erst_ereignisse")}
    soll = {k: v for k, v in NULLPUNKT.items() if k != "variante"}
    if aus_bericht != soll:
        raise ReproBruch(
            "RR9-A2-ABBRUCH: der registrierte Wert im E3-Bericht "
            + json.dumps(aus_bericht, sort_keys=True) + " weicht vom Anker "
            + json.dumps(soll, sort_keys=True) + " ab. Eine der beiden Quellen "
            "ist verstellt worden; welche, entscheidet nicht dieses Werkzeug.")
    return aus_bericht


# =============================================================================
# Die Reproduktion - identischer Codepfad, Allowlist als Parameter
# =============================================================================

def reproduziere(quellen, zwischenstand, perzentil=None, e2=None, zp=None):
    """Zaehlt EINEN Arm auf dem gespeicherten Zwischenstand.

    `quellen` ist der PARAMETER, um den es der Auflage geht: die alte Allowlist
    in der Form, die `firmenreihen` faehrt. Sie wird hereingereicht, nicht im
    Zaehlpfad nachgeschlagen - genau das ist "die alte Allowlist als Parameter
    fahren".

    `perzentil=None` heisst: das eingefrorene Perzentil der Praeregistrierung.
    Ein abweichender Wert ist die Rot-Probe des Beweisplans (ein absichtlich
    verstellter Zaehlparameter muss den Nullpunkt verfehlen).
    """
    e2 = e2 or lade(BASISRATEN, "studie_basisraten")
    zp = zp or lade(ZAEHLPROBE, "studie_zaehlprobe")
    fenster = zp.FENSTER["pruefung"]
    p_wert = zp.PERZENTIL if perzentil is None else perzentil

    voll = pruefe_kein_panel(zwischenstand)
    if not os.path.isfile(voll):
        raise ReproBruch("RR9-A2-ABBRUCH: Zwischenstand nicht gefunden: " + voll)
    vorher = sha256_datei(voll)

    # NUR-LESEND, und das ist keine Bequemlichkeit: der Zwischenstand ist das
    # Arbeitsartefakt eines bereits angemeldeten Laufs. Wuerde `pit_reduktion`
    # seinen Index hier erst anlegen muessen, bricht SQLite - fail-closed und
    # richtig so. Wir schreiben nicht in ein Beweisstueck.
    arbeit = sqlite3.connect("file:" + voll.replace("\\", "/") + "?mode=ro",
                             uri=True)
    arbeit.execute("PRAGMA cache_size=-200000")
    zaehler = defaultdict(int)
    for name in e2.alle_zaehlernamen():
        zaehler[name] += 0
    try:
        roh_zeilen = arbeit.execute("SELECT COUNT(*) FROM roh").fetchone()[0]
        je_firma = e2.pit_reduktion(arbeit, zaehler)
    finally:
        arbeit.close()

    nachher = sha256_datei(voll)
    if nachher != vorher:
        raise ReproBruch(
            "RR9-A2-ABBRUCH: der Zwischenstand hat sich waehrend des Laufs "
            "geaendert (" + vorher + " -> " + nachher + "). Ein Beweisstueck, "
            "das der Lauf selbst anfasst, beweist nichts mehr.")

    # Ab hier: exakt die Kette aus studie-zaehlprobe.py::zaehle_fenster, mit
    # `quellen` als Parameter. `nur_positiv=True` ist die S-U-Einstellung; sie
    # steht dort in derselben Zeile wie die Allowlist und wird hier nicht neu
    # erfunden.
    alle, gewaehlt = e2.firmenreihen(je_firma, quellen, True, zaehler, "umsatz_")
    _g, a_saetze = e2.wachstum_und_beschleunigung(alle, zaehler, "umsatz_")
    feuerungen, _auswertbar, _grenzen = e2.signale(a_saetze, p_wert, zaehler,
                                                   "umsatz_")
    band = [f for f in feuerungen
            if zp.im_signalband(f, e2, fenster["von"], fenster["bis"])]
    arm = zp.arm_zaehlen(band, gewaehlt, e2,
                         e2.ordinal(fenster["rand"].replace("-", "")))
    return {
        "fallzahl": arm["fallzahl"],
        "firmen_mit_erst_ereignis": arm["firmen_mit_erst_ereignis"],
        "zensierte_erst_ereignisse": arm["zensierte_erst_ereignisse"],
        "roh_zeilen": roh_zeilen,
        "firmen_im_zwischenstand": len(je_firma),
        "zwischenstandSha256": vorher,
        "perzentil": p_wert,
    }


def pruefe_gegen_nullpunkt(gemessen):
    """Bit-gleich -> weiter. Abweichend -> Stopp.

    Und NUR das: die Auflage untersagt jede andere Reaktion ausdruecklich -
    keine Neubemessung von Design, Liste, Preis oder Zeitplan (P5-Logik).
    """
    soll = {k: v for k, v in NULLPUNKT.items() if k != "variante"}
    ist = {k: gemessen.get(k) for k in soll}
    if ist != soll:
        raise ReproBruch(
            "RR9-A2-ABBRUCH (" + SANKTION + "): die Reproduktion des "
            "V0-Nullpunkts weicht ab.\n"
            "  registriert : " + json.dumps(soll, sort_keys=True) + "\n"
            "  gemessen    : " + json.dumps(ist, sort_keys=True) + "\n"
            "Die Auflage laesst genau eine Reaktion zu: Stopp und "
            "Veroeffentlichung der Abweichung. Eine Neubemessung von Design, "
            "Liste, Preis oder Zeitplan ist untersagt (RR9-A2 Ziffer 2).")
    return ist


def bericht(zwischenstand=None, ziel=None):
    e2 = lade(BASISRATEN, "studie_basisraten")
    zp = lade(ZAEHLPROBE, "studie_zaehlprobe")
    np_modul = lade(NULLPUNKT_MODUL, "studie_rr9_nullpunkt")

    # B3' ZUERST. Erst wenn die zur Laufzeit geladene Allowlist bit-identisch
    # mit der registrierten ist, darf mit ihr gerechnet werden. Faellt sie hier,
    # gibt es keinen Nullpunkt zu reproduzieren.
    registrierte_liste = np_modul.pruefe_nullpunkt(np_modul.geladene_allowlist(e2))
    aus_bericht = registrierter_nullpunkt()

    pfad = zwischenstand_pfad(zwischenstand)
    gemessen = reproduziere(e2.UMSATZ_QUELLEN, pfad, e2=e2, zp=zp)
    pruefe_gegen_nullpunkt(gemessen)

    daten = {
        "schema": "studie-rr9-a2-nullpunkt-reproduktion/v1",
        "auflage": "RR9-A2 Schritt 2 - _COURT-RR9-2026-08-30",
        "anker": ("ENTSCHIED 130: ZIEL = 292/438 (S-U, umsatzQuellenAllowlist), "
                  "NICHT 326/365. Die 326/365 ruht nach der gemessenen "
                  "Korrektur 1 des Bremsen-Baus auf der Variante S-G "
                  "(OperatingIncomeLoss, ERGEBNIS_QUELLEN) und belegt die "
                  "Identitaet der Allowlist deshalb nicht; B3' soll die Basis "
                  "pinnen, AUF der die Verbreiterung aufsetzt, und das ist die "
                  "Quellen-Allowlist."),
        "kipp": ("Liest eine kuenftige Ratssitzung V0 anders, wird umverankert; "
                 "die B3'-Tests machen die Umverankerung billig "
                 "(ENTSCHIED 130)."),
        "pruefmethode": {
            "wie": ("identischer Codepfad: e2.firmenreihen -> "
                    "e2.wachstum_und_beschleunigung -> e2.signale -> "
                    "zp.im_signalband -> zp.arm_zaehlen, mit der Allowlist als "
                    "PARAMETER statt als Nachschlagung im Zaehlpfad"),
            "worauf": ("gespeicherter Zwischenstand des bereits angemeldeten "
                       "E3-Laufs, nur-lesend geoeffnet und vor/nach dem Lauf "
                       "byte-gegengeprueft"),
            "keinPanel": ("KEIN Panel-Fenster geoeffnet - pruefe_kein_panel "
                          "haelt das fail-closed fest"),
            "keineFreigabeNoetig": (
                "Es entsteht kein neuer Wert und kein neuer Fenster-Zugriff: "
                "reproduziert wird ein seit 2026-08-19 im Repo "
                "veroeffentlichter, registrierter Wert. Nach RR9-A2 Ziffer 2 "
                "verbraucht dieser Lauf ausdruecklich KEINE Einheit des "
                "K2-Kontingents; die Zeile dazu steht vorab in Register-"
                "Eintrag 22."),
        },
        "suchachsen": [
            {"achse": "Feldname", "status": "gemessen",
             "wert": "varianten['S-U'].fallzahl / .firmen_mit_erst_ereignis"},
            {"achse": "Registerfeld", "status": "gemessen",
             "wert": "NULLPUNKT-Konstante gegen den E3-Bericht, zwei Quellen"},
            {"achse": "Inhalts-String", "status": "gemessen",
             "wert": "SHA-256 des Zwischenstands vor und nach dem Lauf"},
        ],
        "registrierterNullpunkt": aus_bericht,
        "registrierterNullpunktHerkunft": NULLPUNKT_HERKUNFT,
        "geladeneAllowlist": list(registrierte_liste),
        "allowlistAlsParameter": True,
        "gemessen": {k: gemessen[k] for k in
                     ("fallzahl", "firmen_mit_erst_ereignis",
                      "zensierte_erst_ereignisse")},
        "umfang": {k: gemessen[k] for k in
                   ("roh_zeilen", "firmen_im_zwischenstand", "perzentil")},
        "zwischenstandSha256": gemessen["zwischenstandSha256"],
        "bitGleich": True,
        # RR9-A4 verlangt die Suchachse UND die Grenze im Befund. Der staerkste
        # Einwand gegen diesen Lauf, hier selbst benannt statt abgewartet:
        "grenze": (
            "WAS DIESER LAUF NICHT ZEIGT: die Stufe Panel -> Zwischenstand "
            "(lade_berichte + lies_rohwerte) ist NICHT nachgefahren - sie ist "
            "die einzige, die das Panel oeffnen wuerde. Reproduziert ist die "
            "Kette AB pit_reduktion. Das ist kein Zirkel: der Zwischenstand ist "
            "eine feste Eingabe, und dieselbe Eingabe wandert bei verstelltem "
            "Zaehlparameter oder verkuerzter Allowlist NACHWEISLICH vom "
            "Nullpunkt weg (zwei Rot-Proben im Selbsttest). Was der Lauf damit "
            "belegt, ist genau die Drift, gegen die B3' geschrieben ist: der "
            "versiegelte Zaehlcode rechnet heute noch, was das registrierte "
            "Protokoll sagt. Die nicht nachgefahrene Stufe ist anderweitig "
            "gedeckt - studie-basisraten.py hasht unveraendert auf ihren "
            "registrierten Wert (hash-manifest.json 2.0.0, Provenienz-Lesung "
            "RR9-A2 Schritt 1), und panel-validierung.sqlite liegt mit den "
            "4.447.633.408 Bytes des E1-Baus auf der Platte. Beides ist eine "
            "Groessen- und Hash-Aussage ueber Code und Datei, keine "
            "Nachrechnung der Stufe selbst."),
        "eintretendeKohorteGemessen": False,
        "f4": ("GESPERRT. Die Zaehlprobe der Verbreiterung ist ein eigener "
               "Vorgang mit eigenem Register-Eintrag; dieser Lauf laedt die "
               "Konzeptliste 2.1.0 nicht."),
        "befund": ("POSITIV: der V0-Nullpunkt ist bit-gleich reproduziert. "
                   "fallzahl 292, firmen_mit_erst_ereignis 438, zensiert 0 - "
                   "identisch mit dem registrierten Wert des E3-Laufs."),
    }
    verboten = verbotene_felder(daten)
    if verboten:
        raise ReproBruch(
            "RR9-A2-ABBRUCH: der Bericht traegt bewertende Felder " + str(verboten)
            + ". Der Anker sind zwei Zaehlungen, nie ihr Quotient.")
    if ziel:
        with open(ziel, "w", encoding="utf-8", newline="\n") as fh:
            json.dump(daten, fh, ensure_ascii=False, indent=1, sort_keys=True)
            fh.write("\n")
    return daten


# =============================================================================
# Selbsttest - mit der Rot-Probe, die der Beweisplan verlangt
# =============================================================================

def selbsttest(zwischenstand=None):
    ok = fehl = 0

    def pruefe(name, bedingung):
        nonlocal ok, fehl
        if bedingung:
            ok += 1
            print("  ok   " + name)
        else:
            fehl += 1
            print("  FAIL " + name)

    # -- Anker: zwei unabhaengige Quellen sagen dasselbe ----------------------
    pruefe("Anker: E3-Bericht bestaetigt die Konstante 292/438/0",
           registrierter_nullpunkt() == {"fallzahl": 292,
                                         "firmen_mit_erst_ereignis": 438,
                                         "zensierte_erst_ereignisse": 0})
    pruefe("Anker: das Ziel ist S-U, nicht S-G",
           NULLPUNKT["variante"] == "S-U" and NULLPUNKT["fallzahl"] == 292)

    # ROT-PROBE Anker: ein verstellter Bericht darf nicht als Bestaetigung
    # durchgehen. Sonst waere die zweite Quelle Dekoration.
    import tempfile
    with tempfile.TemporaryDirectory() as tmp:
        kopie = os.path.join(tmp, "E3-verstellt.json")
        roh = json.load(open(E3_BERICHT, encoding="utf-8"))
        roh["varianten"]["S-U"]["fallzahl"] = 293
        with open(kopie, "w", encoding="utf-8") as fh:
            json.dump(roh, fh)
        try:
            registrierter_nullpunkt(kopie)
            pruefe("ROT-PROBE Anker: verstellter E3-Bericht -> Abbruch", False)
        except ReproBruch as exc:
            pruefe("ROT-PROBE Anker: verstellter E3-Bericht -> Abbruch",
                   "weicht vom Anker" in str(exc))

    # -- Zaun 3: kein Panel ---------------------------------------------------
    for boese in (os.path.join("x", "panel", "panel-validierung.sqlite"),
                  os.path.join("x", "panel", "panel-endtest.sqlite.enc"),
                  os.path.join("x", "schluessel", "endtest.key")):
        try:
            pruefe_kein_panel(boese)
            pruefe("ROT-PROBE Zaun: " + boese + " -> Abbruch", False)
        except ReproBruch:
            pruefe("ROT-PROBE Zaun: " + os.path.basename(boese) + " -> Abbruch",
                   True)
    pruefe("Gegenprobe Zaun: der Zwischenstand selbst geht durch",
           pruefe_kein_panel(os.path.join("x", "arbeit",
                                          "E3-zwischenstand.sqlite")) is not None)

    # -- Zaun 2: bewertende Felder -------------------------------------------
    pruefe("ROT-PROBE Bericht: ein eingeschmuggeltes Quoten-Feld faellt auf",
           verbotene_felder({"gemessen": {"fallzahl": 292,
                                          "auffindbarkeit": 0.66}})
           == ["gemessen.auffindbarkeit"])
    pruefe("Gegenprobe Bericht: reine Zaehlungen sind erlaubt",
           verbotene_felder({"gemessen": {"fallzahl": 292,
                                          "firmen_mit_erst_ereignis": 438}}) == [])

    # -- Der Vergleich selbst, in beide Richtungen ----------------------------
    pruefe("Nullpunkt: der registrierte Wert geht durch (Anwesenheit)",
           pruefe_gegen_nullpunkt(dict(NULLPUNKT, **{"variante": None}))
           == {"fallzahl": 292, "firmen_mit_erst_ereignis": 438,
               "zensierte_erst_ereignisse": 0})
    try:
        pruefe_gegen_nullpunkt({"fallzahl": 291, "firmen_mit_erst_ereignis": 438,
                                "zensierte_erst_ereignisse": 0})
        pruefe("ROT-PROBE Nullpunkt: 291 statt 292 -> Stopp", False)
    except ReproBruch as exc:
        pruefe("ROT-PROBE Nullpunkt: 291 statt 292 -> Stopp",
               SANKTION in str(exc) and "untersagt" in str(exc))

    # -- Die teure Probe ------------------------------------------------------
    # Uebersprungen wird sie NUR, wenn niemand einen Speicherort genannt hat.
    # Ist einer genannt und die Datei fehlt, ist das ein Befund und kein
    # Sonderfall: sonst meldete dieser Selbsttest '0 FAIL', ohne die eine
    # Sache getan zu haben, fuer die es ihn gibt.
    try:
        pfad = zwischenstand_pfad(zwischenstand)
    except KeinSpeicherort as exc:
        pfad = None
        grund = str(exc)
    if pfad and not os.path.isfile(pfad):
        raise ReproBruch(
            "RR9-A2-ABBRUCH: der Speicherort ist benannt, aber unter " + pfad
            + " liegt kein Zwischenstand. Das ist kein CI-Fall, sondern ein "
            "Befund - ein gruener Selbsttest ohne die Reproduktion waere "
            "genau die stille Luege, die dieses Modul verhindern soll.")
    if pfad:
        e2 = lade(BASISRATEN, "studie_basisraten")
        zp = lade(ZAEHLPROBE, "studie_zaehlprobe")
        vorher = sha256_datei(pfad)
        echt = reproduziere(e2.UMSATZ_QUELLEN, pfad, e2=e2, zp=zp)
        pruefe("REPRODUKTION: 292/438 bit-gleich auf dem Zwischenstand",
               pruefe_gegen_nullpunkt(echt) is not None)
        pruefe("REPRODUKTION: der Zwischenstand ist byte-identisch geblieben",
               sha256_datei(pfad) == vorher)
        # ROT-PROBE des Beweisplans: ein absichtlich verstellter ZAEHLPARAMETER
        # muss den Nullpunkt verfehlen und den Stopp ausloesen. Der LAUF steht
        # mit im try: braecht er aus einem anderen Grund, waere die Meldung
        # sonst dieser Probe zugeschrieben und der ganze Selbsttest tot.
        try:
            pruefe_gegen_nullpunkt(
                reproduziere(e2.UMSATZ_QUELLEN, pfad, perzentil=94, e2=e2, zp=zp))
            pruefe("ROT-PROBE Zaehlparameter: Perzentil 94 -> Stopp", False)
        except ReproBruch as exc:
            pruefe("ROT-PROBE Zaehlparameter: Perzentil 94 -> Stopp",
                   SANKTION in str(exc))
        # Und eine verstellte ALLOWLIST muss ihn ebenfalls verfehlen - sonst
        # haenge der Nullpunkt gar nicht an der Liste, und B3' waere gegenstandslos.
        try:
            pruefe_gegen_nullpunkt(
                reproduziere(tuple(e2.UMSATZ_QUELLEN[:2]), pfad, e2=e2, zp=zp))
            pruefe("ROT-PROBE Allowlist: verkuerzte Liste -> Stopp", False)
        except ReproBruch as exc:
            pruefe("ROT-PROBE Allowlist: verkuerzte Liste -> Stopp",
                   SANKTION in str(exc))
    else:
        print("  --   REPRODUKTION uebersprungen: " + grund)

    print("selbsttest: %d ok, %d FAIL" % (ok, fehl))
    return 0 if fehl == 0 else 1


def main(argv=None):
    p = argparse.ArgumentParser(description="RR9-A2 Schritt 2 - V0-Nullpunkt")
    unter = p.add_subparsers(dest="befehl", required=True)
    rp = unter.add_parser("reproduktion")
    rp.add_argument("--ziel")
    rp.add_argument("--zwischenstand")
    st = unter.add_parser("selbsttest")
    st.add_argument("--zwischenstand")
    a = p.parse_args(argv)

    try:
        if a.befehl == "selbsttest":
            return selbsttest(a.zwischenstand)
        daten = bericht(zwischenstand=a.zwischenstand, ziel=a.ziel)
        print(daten["befund"])
        print("registriert : " + json.dumps(daten["registrierterNullpunkt"],
                                            sort_keys=True))
        print("gemessen    : " + json.dumps(daten["gemessen"], sort_keys=True))
        print("bit-gleich  : " + str(daten["bitGleich"]))
        print("Zwischenstand sha256: " + daten["zwischenstandSha256"])
        if a.ziel:
            print("Bericht     : " + a.ziel)
        return 0
    except ReproBruch as exc:
        print(str(exc), file=sys.stderr)
        return EXIT_ABWEICHUNG


if __name__ == "__main__":
    sys.exit(main())

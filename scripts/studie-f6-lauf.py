#!/usr/bin/env python3
"""F6-LAUF - der konfirmatorische Laeufer des F6-Auffindbarkeits-Tors.

Angeordnet durch _COURT-F6-VOLLZUG-2026-08-31 (ratifiziert Session 07,
2026-08-31 22:19; ORCHESTRATOR-NACHTRAG 1, Vollzugsordnung Ziffer 5) unter den
Auflagen F6-B6, F6-B7, F6-B10 bis F6-B15 und F6-B19.

DIESER LAEUFER IST HEUTE ABSICHTLICH UNTAETIG.
=============================================
Es gibt keinen Register-Eintrag 25. Ohne eine gueltige Freigabe der Art
`confirmatory_execution_authorized` tut dieses Skript NICHTS - es liest kein
Panel, rechnet nichts und schreibt nichts. Phase 0 ist keine Formalie, sondern
das Tor: sie steht VOR jeder anderen Handlung, auch vor dem Rehash.
`tests/studie-f6-lauf.test.js` belegt die Verweigerung am Objekt.

DIE SECHS PHASEN, JEDE FAIL-CLOSED, KEINE UEBERSPRINGBAR
========================================================
  (0) FREIGABE     F6-B19 - eigener Leser, POSITIV auf ART_ZUGRIFF.
  (1) REHASH       F6-B7  - ERSTE Handlung nach der Freigabe: jeder in den
                            Eintraegen 23 und 24 gebundene Digest wird gegen
                            den Arbeitsbaum nachgerechnet.
  (2) ZAEHLUNG     je Signalvariante {S-U, S-G} x Arm {signal, kontrollpool}.
  (3) KLUMPEN->SE  Tally (m_g, n_g) -> scripts/studie-f6-klumpen-se.py.
  (4) BAND         scripts/studie-vb-b4-band.py, unveraendert.
  (5) AUSGABE      F6-B10..B15 - zwei getrennte Listen, zweiseitige
                            zweig-bewusste Pruefung, Verbotsliste.

WARUM PHASE 0 EINEN EIGENEN LESER HAT (F6-B19, V2)
--------------------------------------------------
`scripts/studie-zaehlprobe.py::pruefe_freigabe_gegen_register` prueft auf
`ART_ZAEHLPROBE` und bricht bei allem anderen mit W2-ABBRUCH ab - das ist der
Blast-Radius-Schutz aus F6-B17(e) und bleibt genau so. Er ist deshalb fuer
diesen Lauf UNBRAUCHBAR und wird ausdruecklich NICHT wiederverwendet. Der
Leser hier prueft POSITIV auf `ART_ZUGRIFF`: er akzeptiert genau eine Art und
weist jede andere namentlich ab - auch `C0_REGELFREEZE`, auch wenn dieser
Eintrag frisch und server-bestaetigt ist. Ein Freeze autorisiert keinen Lauf.

DIE ZEITKETTE, AM OBJEKT ABGELESEN STATT GERATEN (VB-A11)
----------------------------------------------------------
`accessedAt` ist eine UNTERGRENZE, keine Obergrenze. Register-Eintrag 23 sagt
es woertlich: das Feld "bezeichnet hier keinen Zugriff, sondern den fruehesten
Zeitpunkt, ab dem der eingefrorene Satz VERWENDET werden darf".
`scripts/studie-zaehlprobe.py::pruefe_serverzeit` setzt genau das um
(`zugriff > server` UND `zugriff >= geplant`). Die Kette lautet also

    registeredAt < serverConfirmedAt <= accessedAt <= ersterZugriff

und NICHT "jetzt < accessedAt". Wer sie andersherum baut, sperrt den Lauf
genau ab dem Zeitpunkt aus, ab dem er erlaubt ist.

WAS DIESER LAEUFER NIE TUT
--------------------------
Keine Firmen-Kennung verlaesst den Prozess (F6-B14): der Klumpen-Tally
(m_g, n_g) wird im Speicher gebildet, fuer den Aufruf des SE-Moduls in eine
Temp-Datei geschrieben und danach geloescht; er steht in keiner Ausgabe. Kein
Endtest, kein Siegel, keine Lueckenliste. Nichts geht nach stdout ausser dem
Fortschrittsprotokoll - die Ergebnisdaten gehen ausschliesslich in die per
`--bericht` benannte Datei.

Aufruf:
  python scripts/studie-f6-lauf.py --freigabe <freigabe.json>
                                   --panel <panel-validierung.sqlite>
                                   --bericht <report.json>
                                   --zaehlwerk <zaehlwerk.py>
"""

import argparse
import datetime
import hashlib
import importlib.util
import json
import math
import os
import platform
import subprocess
import sys
import tempfile

HIER = os.path.dirname(os.path.abspath(__file__))
WURZEL_REPO = os.path.dirname(HIER)

SCHEMA = "early-detection-f6-lauf/v1"
PROTOKOLL = "FEM-SEC-US@2.0.0"

# Muss mit lib/studie-verfassung.js:285/290/298 uebereinstimmen. Die Arten
# stehen hier als Konstanten, damit der Waechter sie importieren kann statt sie
# abzutippen.
ART_ZUGRIFF = "confirmatory_execution_authorized"
ART_ZAEHLPROBE = "count_only_probe_authorized"
ART_C0_REGELFREEZE = "C0_REGELFREEZE"

REGISTER_REL = os.path.join("protocol", "early-detection", "2.0.0",
                            "outcome-access-ledger.json")

VARIANTEN = ("S-U", "S-G")
ARME = ("signal", "kontrollpool")

# protocol/early-detection/2.0.0/preregistration.json:88 -
# {"minimum": 0.9, "gilt": "Signal-Arm UND Kontrollpool", "maxDifferenzPunkte": 10}
MAX_DIFFERENZ_PUNKTE = 10


class LaufAbbruch(Exception):
    """Ein benannter Abbruch. Auf JEDEM Pfad ein Grund - ein durchgereichter
    Traceback ist kein Abbruch, sondern ein Absturz."""


class EntscheidungNoetig(LaufAbbruch):
    """Ein Abbruch, den kein Bauer aufloesen darf: er braucht eine
    Entscheidung des Gerichts oder des Orchestrators."""


# =============================================================================
# Die Bindungen aus den Register-Eintraegen 23 und 24 (F6-B7)
# =============================================================================
#
# SOLLWERTE ALS KONSTANTEN, AM OBJEKT NACHGERECHNET - die Form aus F6-B8.
# Sie stehen ZUSAETZLICH zum Register, nicht statt seiner: `rehash()` haelt
# jeden Sollwert gegen BEIDE Seiten, gegen die Datei im Arbeitsbaum UND gegen
# den Eintrag, der ihn bindet. Ein Werkzeug, das seine Sollwerte allein aus dem
# Geprueften liest, prueft nichts; eines, das sie allein bei sich fuehrt,
# driftet still vom Register weg. Beide Richtungen sind hier zu.
#
# `art`:
#   datei                 SHA-256 ueber die Bytes der Datei.
#   inhalt                SHA-256 ueber den kanonisierten Teilbaum `inhalt`.
#   inhalt_ohne_hashfeld  SHA-256 ueber das kanonisierte Dokument OHNE das
#                         Hash-Feld selbst (Kanonisierung wie in Eintrag 23
#                         beschrieben).
BINDUNGEN = (
    # --- Register-Eintrag 23, f6-tor-freeze-2026-08-31 ---------------------
    {"pfad": "protocol/early-detection/2.1.0/e2-schwellen-satz-2026-08-30.json",
     "art": "datei", "eintrag": "f6-tor-freeze-2026-08-31", "was": "PIN 1 Schwellen-Satz",
     "soll": "80798025d2ad6387b3ed72048227112426369ec8392ae633a92df58f0cf4d1e5"},
    {"pfad": "protocol/early-detection/2.1.0/e2-schwellen-satz-2026-08-30.json",
     "art": "inhalt_ohne_hashfeld", "hashfeld": "inhaltSha256",
     "eintrag": "f6-tor-freeze-2026-08-31", "was": "PIN 1 Schwellen-Satz (Inhalt)",
     "soll": "c4a888906e4cb26a1a4994c54fc34b89c068e40646a800d3d07c7051308b2bee"},
    {"pfad": "scripts/studie-basisraten.py",
     "art": "datei", "eintrag": "f6-tor-freeze-2026-08-31",
     "was": "PIN 2 E2-Regel, das versiegelte Modul",
     "soll": "997a80d26871937f848b3eea76a9b4ba1a4e1c76f1cc3c30db98d7888ec2601d"},
    {"pfad": "scripts/studie-e2-verbreitert.py",
     "art": "datei", "eintrag": "f6-tor-freeze-2026-08-31",
     "was": "Auslese-Werkzeug (WERKZEUG-Nachweis, ausdruecklich KEINE zweite Regel)",
     "soll": "9a24ed94e943e9a6f5b4a1373ba6c6aa2001ddadb2d60a705277bf5eb359984b"},
    {"pfad": "protocol/early-detection/2.1.0/b4-bandregel-2026-08-30.json",
     "art": "datei", "eintrag": "f6-tor-freeze-2026-08-31", "was": "Band-Artefakt",
     "soll": "d9c5990ad403b6baca2e3a4228218af0b73367e4f51ffd213ac654fc41cdc5da"},
    # Der eigentliche Pin des Band-Moduls. KV-1: `scripts/studie-vb-b4-band.py`
    # traegt selbst KEINEN gebundenen Datei-Hash - gepinnt ist sein Erzeugnis.
    # Wird das Modul angefasst und driftet dieser Wert, ist der Freeze-Akt
    # ungueltig und F6 haelt an, ohne neue Sitzung.
    {"pfad": "protocol/early-detection/2.1.0/b4-bandregel-2026-08-30.json",
     "art": "inhalt", "eintrag": "f6-tor-freeze-2026-08-31",
     "was": "Band-Artefakt (Inhalt) - der KV-1-Pin gegen Drift am Band-Modul",
     "soll": "1fd6a9f3ceb6dab0076c6812f57483889708345d6a87c6103a7515689cf8c46e"},

    # --- Register-Eintrag 24, f6-se-klumpen-freeze-2026-08-31 --------------
    {"pfad": "scripts/studie-f6-klumpen-se.py",
     "art": "datei", "eintrag": "f6-se-klumpen-freeze-2026-08-31",
     "was": "FUENFTER PIN - die Rechenvorschrift F6-SE-KLUMPEN/v1 IST dieses Modul",
     "soll": "bf10becdfe2dc08a303d22a97dda3eb65988fb72a50f8811c23b2c377c11a1d3"},
    {"pfad": "protocol/early-detection/2.1.0/f6-vollzug-zweig-a-2026-08-31.json",
     "art": "datei", "eintrag": "f6-se-klumpen-freeze-2026-08-31",
     "was": "Vollzugs-Artefakt (F6-B5)",
     "soll": "8c66818e80140b16a473c278a47327d726601e14de83450d2ed6d353e55e4427"},
    {"pfad": "protocol/early-detection/2.1.0/f6-vollzug-zweig-a-2026-08-31.json",
     "art": "inhalt", "eintrag": "f6-se-klumpen-freeze-2026-08-31",
     "was": "Vollzugs-Artefakt (Inhalt, F6-B5)",
     "soll": "792f4ff58687945167e273d08ca509544f4ad7fd7ecd9eaa60d5dac3118c99f7"},
    {"pfad": "protocol/early-detection/2.0.0/rules.json",
     "art": "datei", "eintrag": "f6-se-klumpen-freeze-2026-08-31",
     "was": "Regelwerk (F6-B4) - traegt ueber REGELWERK_PFAD die Fenstergrenzen",
     "soll": "dc008723798f58fdae3cc67b36817aebf88b090acd8472cedda141f1e4b021bc"},
    {"pfad": "protocol/early-detection/2.1.0/f6-se-klumpen-v1-wortlaut.json",
     "art": "datei", "eintrag": "f6-se-klumpen-freeze-2026-08-31",
     "was": "Quelle des eingefrorenen Wortlauts",
     "soll": "10e812fa345bba545077f333de7d81edf18bb371e9e48ee7b697558c1bc944e8"},
)


# =============================================================================
# Der Ausgabesatz (F6-B10 bis F6-B15)
# =============================================================================

# F6-B12 - die DATEN-Felder je Variante x Arm. Jeder Schluessel traegt die
# eingefrorene Pflicht, die ihn verlangt.
DATEN_SCHLUESSEL = {
    # Bruch und Tor
    "zaehler_reife", "nenner_tor", "anteil",
    # SE-Block
    "se_binomial", "se_klumpen_robust", "se_stern", "se_entschied",
    "klumpen_anzahl",
    # Berichtspflicht VB-A10
    "wilson95_unten", "wilson95_oben", "abstand_zu_090",
    "abstand_zu_329_von_365", "bandbreite_absolut", "bandbreite_in_se",
    "schwelle", "fallzahl_min", "messgeraet_vollstaendig",
    # Verdikt
    "verdikt", "weiter", "grund", "etikett", "pflichtsatz", "zweitsatz",
    # A16-Zerlegungen als REINE Zaehlungen
    "n_A", "n_B_reif", "n_B_unreif", "n_verloren", "feuerfaehig",
    "strukturell_nicht_feuerfaehig", "rechts_zensiert",
}

# F6-B11 - je Variante GENAU EIN armuebergreifender Schluessel.
VARIANTEN_SCHLUESSEL = {"differenz_punkte"}

# F6-B10 - die EIGENE Umschlag-Allowlist. Sie wird nie mit DATEN_SCHLUESSEL
# vermischt: "Vermischen ist der Mechanismus, durch den der Zaehlproben-Satz zu
# breit wurde."
UMSCHLAG_ALLOWLIST = {
    "schema", "protokoll", "runId", "fenster", "variante", "arm", "panelRand",
    "serverConfirmedAt", "accessedAt", "ersterZugriffAm", "beendetAm",
    "gelesenePfade", "geschriebenePfade", "ergebnisdatenBeruehrt",
    "siegelWache", "manifestGeprueft", "umgebung", "gebundeneHashes",
}

# F6-B14 - draussen bleibt. Jeder Eintrag ein ABBRUCH, kein Filter.
VERBOTENE_SCHLUESSEL = {
    "klumpen_quadratsumme", "klumpen_tally", "klumpen", "s",
    "cik", "adsh", "name", "accession", "firma", "firmen", "entitaet",
    "monatsreihe", "quartalsreihe", "wachstum", "persistenz", "aktienzahl",
    "kurs", "rendite",
    "p_wert", "p_werte", "teststatistik", "bootstrap", "konfidenzintervall",
    "endtest", "endtest_groesse", "lueckenliste", "matching", "baseline_a",
    "feuerrate", "ampel", "kontrollpool_auffindbarkeit", "feuerungen",
    "auswertbare_firmen_quartale",
}

# F6-B15 - die DREI zweig-pflichtigen Teilmengen. Sie sind nicht erfunden,
# sondern an `scripts/studie-vb-b4-band.py::auswerten` ABGELESEN: die
# eingefrorene Maschine hat genau drei unterscheidbare Schluesselmengen.
#
#   gate_gerissen       :129-134  - ohne bandbreiteAbsolut, ohne
#                                   abstandZu329Von365, ohne etikett
#   im Band             :211-215  - vollstaendiger Bericht, ohne etikett
#   ausserhalb des Band :216-224  - vollstaendiger Bericht, ohne pflichtsatz
#                                   und ohne zweitsatz (BESTANDEN und NICHT
#                                   BESTANDEN tragen dieselbe Menge)
#
# Strikte Gleichheit waere hier ein Fehlalarm - genau V3s Korrektur.
ZWEIG_GATE_GERISSEN = "gate_gerissen"
ZWEIG_IM_BAND = "im_band"
ZWEIG_AUSSERHALB_BAND = "ausserhalb_band"

ZWEIG_PFLICHT = {
    ZWEIG_GATE_GERISSEN: DATEN_SCHLUESSEL - {
        "bandbreite_absolut", "abstand_zu_329_von_365", "etikett"},
    ZWEIG_IM_BAND: DATEN_SCHLUESSEL - {"etikett"},
    ZWEIG_AUSSERHALB_BAND: DATEN_SCHLUESSEL - {"pflichtsatz", "zweitsatz"},
}

# F6-B13 - der Stempel, woertlich. Das Verbot stammt aus Register-Eintrag 23,
# Feld `verboten`, und wird hier unveraendert wiederholt.
STEMPEL_329 = {
    "schluessel": "abstand_zu_329_von_365",
    "stempel": "BERICHTSANGABE",
    "bedeutung": ("Diese Groesse ist eine reine Berichtsangabe. Sie ist NIE "
                  "Entscheidungsgroesse und nirgends Verzweigungsgrundlage. "
                  "Die eingefrorene Maschine emittiert den Schluessel "
                  "(scripts/studie-vb-b4-band.py, auswerten), und ein nicht "
                  "gelisteter Schluessel ist ein ABBRUCH, kein Filter - "
                  "deshalb wird er registriert statt gefiltert."),
    "verbotWoertlichAusEintrag23": "jede Verwendung von 329/365 als Entscheidungsgroesse",
    "auflage": "F6-B13",
}

# F6-B25 / KV-6 - VORAB, nie hinterher als Befund.
VORAB_DETERMINIERTHEIT = (
    "F6-B25 (vorab, nicht als Befund): Gilt n_g = 1 fuer alle g - die nach "
    "PIN 3 erwartete Lage -, dann faellt se_entschied KONSTRUKTIV auf "
    "SE_klumpen-robust, und die A16-Pflicht 'welcher entschied' ist dort "
    "formal, nicht materiell erfuellt. Tritt im Tor-Nenner doch ein Klumpen "
    "mit n_g > 1 auf, entfaellt diese Feststellung (KV-6) und die Pflichtangabe "
    "wird materiell; das ist kein Anhalte-Grund, aber der Bericht fuehrt dann "
    "die andere Fassung."
)


# =============================================================================
# Kleinwerkzeug
# =============================================================================

def sha256_datei(pfad, block=1 << 22):
    """Streaming-SHA-256 (Hausform, vgl. scripts/studie-rr9-a2-nullpunkt-repro.py:132)."""
    h = hashlib.sha256()
    with open(pfad, "rb") as fh:
        for stueck in iter(lambda: fh.read(block), b""):
            h.update(stueck)
    return h.hexdigest()


def kanonisch_sha256(objekt):
    """Die in den Eintraegen 22/23/24 dokumentierte Kanonisierung: JSON,
    Schluessel sortiert, separators ',' und ':', ensure_ascii=False, UTF-8."""
    roh = json.dumps(objekt, ensure_ascii=False, sort_keys=True,
                     separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(roh).hexdigest()


def kurzpfad(voll):
    """Elternverzeichnis + Dateiname. Genug zum Unterscheiden, ohne die
    Benutzerkennung des Rechners in den Report zu schreiben (R12a).

    Woertlich die Form aus scripts/studie-basisraten.py:251 - der Bericht
    dieses Laufs wandert in die Akte, und ein voller Windows-Pfad traegt den
    Kontonamen mit hinein.
    """
    return (os.path.basename(os.path.dirname(voll)) + "/"
            + os.path.basename(voll))


def lies_json(pfad, was):
    if not os.path.isfile(pfad):
        raise LaufAbbruch(was + " fehlt: " + str(pfad))
    try:
        with open(pfad, encoding="utf-8") as fh:
            return json.load(fh)
    except ValueError as fehler:
        raise LaufAbbruch(was + " ist kein lesbares JSON (" + str(pfad)
                          + "): " + str(fehler))


def _zeit(text, feld):
    """Ein Zeitstempel MIT Zone. Ohne Zone ist ein Vergleich zwischen Serveruhr
    und lokaler Uhr keine Pruefung, sondern ein Zufall (Muster
    scripts/studie-zaehlprobe.py::_parse_zeit)."""
    roh = str(text).strip()
    if roh.endswith("Z"):
        roh = roh[:-1] + "+00:00"
    try:
        wert = datetime.datetime.fromisoformat(roh)
    except ValueError:
        raise LaufAbbruch("unlesbarer Zeitstempel in '" + feld + "': " + str(text))
    if wert.tzinfo is None:
        raise LaufAbbruch(
            "'" + feld + "' traegt keine Zeitzone (" + str(text) + ").")
    return wert


def jetzt_iso():
    return datetime.datetime.now(datetime.timezone.utc).isoformat(
        timespec="milliseconds").replace("+00:00", "Z")


# =============================================================================
# PHASE 0 - Der Freigabe-Leser (F6-B19)
# =============================================================================

def lies_freigabe_konfirmatorisch(freigabe_pfad, register_pfad, erster_zugriff):
    """Der EIGENE Leser des F6-Laeufers. POSITIV auf ART_ZUGRIFF.

    `scripts/studie-zaehlprobe.py::pruefe_freigabe_gegen_register` wird
    ausdruecklich NICHT wiederverwendet: er prueft auf ART_ZAEHLPROBE und ist
    genau deshalb der Blast-Radius-Schutz aus F6-B17(e). Beide Leser stehen
    nebeneinander und lassen jeweils genau EINE Art durch.
    """
    freigabe = lies_json(freigabe_pfad, "Das Freigabe-Protokoll")

    pflicht = ("runId", "fenster", "serverConfirmedAt", "accessedAt",
               "registeredAt", "registerEventHash", "registerZweig")
    fehlend = [f for f in pflicht if not freigabe.get(f)]
    if fehlend:
        raise LaufAbbruch(
            "Freigabe ohne Pflichtfeld(er): " + ", ".join(fehlend)
            + ". Ohne Server-Bestaetigung gibt es keinen Zugriff.")

    # Der Beweis muss gegen main gefuehrt sein. Ein Eintrag auf einem
    # Seitenzweig ist kein Eintrag (Ein-Appender-Regel, main-first).
    if freigabe["registerZweig"] != "main":
        raise LaufAbbruch(
            "Die Freigabe ist gegen den Zweig " + repr(freigabe["registerZweig"])
            + " gefuehrt, nicht gegen 'main'. Der Serverbeweis gilt nur gegen main.")

    register = lies_json(register_pfad, "Das Zugriffs-Register")
    treffer = [e for e in (register.get("events") or [])
               if e.get("runId") == freigabe["runId"]]
    if len(treffer) != 1:
        raise LaufAbbruch(
            "runId " + repr(freigabe["runId"]) + " steht " + str(len(treffer))
            + "-mal im Zugriffs-Register. Genau einmal ist richtig.")
    eintrag = treffer[0]

    # ── DAS TOR (F6-B19): POSITIV auf genau eine Art ──────────────────────
    art = eintrag.get("typ") or eintrag.get("type")
    if art != ART_ZUGRIFF:
        raise LaufAbbruch(
            "Eintrag " + repr(freigabe["runId"]) + " traegt die Art "
            + repr(art) + ", verlangt ist " + repr(ART_ZUGRIFF) + ". "
            + ("Ein C0-Regelfreeze friert Groessen ein und autorisiert KEINEN "
               "Lauf - er schaltet definitionsgemaess keine Ergebnisdaten frei "
               "(R4). " if art == ART_C0_REGELFREEZE else "")
            + ("Eine Zaehlproben-Anmeldung traegt den Zaehlproben-Erlaubnistext "
               "und deckt keinen konfirmatorischen Lauf. " if art == ART_ZAEHLPROBE
               else "")
            + "Der Lauf bricht ab, bevor er irgendetwas anderes tut.")

    if eintrag.get("eventHash") != freigabe["registerEventHash"]:
        raise LaufAbbruch(
            "Der Eintrags-Hash der Freigabe passt nicht zum Register - die "
            "Freigabe-Datei gehoert zu einem anderen Registerstand.")
    for feld in ("accessedAt", "registeredAt"):
        if freigabe[feld] != eintrag.get(feld):
            raise LaufAbbruch(
                "Die Freigabe fuehrt " + feld + " = " + repr(freigabe[feld])
                + ", das Register " + repr(eintrag.get(feld)) + ".")
    # Die GANZE Liste, nicht nur ihr erstes Element. Der Register-Eintrag
    # e1b-abnahme-2026-08-16 fuehrt woertlich
    # ["pruefung 2017-2019", "endtest 2021-2023"] - ein Eintrag mit ZWEI
    # Fenstern ist in diesem Register real, und das zweite ist das
    # Endtest-Fenster. Ein Vergleich nur gegen [0] liesse genau den Fall
    # durch, in dem ein ungenanntes zweites Fenster mitreist. Die Hausform
    # (scripts/studie-zaehlprobe.py:355) prueft nur [0]; hier gilt die
    # strengere Fassung.
    if eintrag.get("fenster") != [freigabe["fenster"]]:
        raise LaufAbbruch(
            "Das Fenster der Freigabe passt nicht zum Register-Eintrag: "
            "angemeldet ist genau [" + repr(freigabe["fenster"]) + "], der "
            "Eintrag fuehrt " + repr(eintrag.get("fenster")) + ". Ein "
            "Eintrag, der ein zweites Fenster mitfuehrt, autorisiert diesen "
            "Lauf nicht.")

    # ── DIE ZEITKETTE VB-A11 ──────────────────────────────────────────────
    # registeredAt < serverConfirmedAt <= accessedAt <= ersterZugriff
    registriert = _zeit(freigabe["registeredAt"], "registeredAt")
    server = _zeit(freigabe["serverConfirmedAt"], "serverConfirmedAt")
    geplant = _zeit(freigabe["accessedAt"], "accessedAt")
    zugriff = _zeit(erster_zugriff, "ersterZugriffAm")

    if not registriert < server:
        raise LaufAbbruch(
            "Die Server-Bestaetigung " + freigabe["serverConfirmedAt"]
            + " liegt nicht NACH der Anmeldung " + freigabe["registeredAt"]
            + ". Ein Eintrag kann nicht vor sich selbst server-bestaetigt sein.")
    if not registriert < geplant:
        raise LaufAbbruch(
            "accessedAt " + freigabe["accessedAt"] + " liegt nicht nach "
            "registeredAt " + freigabe["registeredAt"] + " (Register-Regel: "
            "registeredAt < accessedAt).")
    # Das MITTLERE Glied der Kette. Ohne es geht die Anordnung
    # registriert < accessedAt < serverConfirmedAt < zugriff glatt durch alle
    # uebrigen Pruefungen (zugriff >= accessedAt folgt dann aus der
    # Transitivitaet) - und genau die heisst: die Anmeldung war zum
    # angemeldeten Zugriffszeitpunkt noch NICHT server-bestaetigt.
    if not server <= geplant:
        raise LaufAbbruch(
            "Die Server-Bestaetigung " + freigabe["serverConfirmedAt"]
            + " liegt NACH der angemeldeten Zugriffszeit "
            + freigabe["accessedAt"] + ". Die Anmeldung war zum angemeldeten "
            "Zugriffszeitpunkt nicht nachweislich auf origin.")
    if not zugriff > server:
        raise LaufAbbruch(
            "Erstzugriff " + erster_zugriff + " liegt nicht NACH der "
            "Server-Bestaetigung " + freigabe["serverConfirmedAt"] + ". Die "
            "Vorab-Anmeldung war zum Zeitpunkt des Zugriffs nicht nachweislich "
            "auf origin - der Lauf haette spicken koennen.")
    if zugriff < geplant:
        raise LaufAbbruch(
            "Erstzugriff " + erster_zugriff + " liegt VOR der angemeldeten "
            "Zugriffszeit " + freigabe["accessedAt"] + ".")

    return freigabe, eintrag


# =============================================================================
# PHASE 1 - Rehash aller gebundenen Digests (F6-B7)
# =============================================================================

def _ist_hash(bindung, wurzel):
    pfad = os.path.join(wurzel, *bindung["pfad"].split("/"))
    if not os.path.isfile(pfad):
        raise LaufAbbruch(
            "GEBUNDENE DATEI FEHLT: " + bindung["pfad"] + " (" + bindung["was"]
            + ", gebunden in Eintrag " + bindung["eintrag"] + ").")
    if bindung["art"] == "datei":
        return sha256_datei(pfad)
    dokument = lies_json(pfad, "Die gebundene Datei " + bindung["pfad"])
    if bindung["art"] == "inhalt":
        if "inhalt" not in dokument:
            raise LaufAbbruch(
                bindung["pfad"] + " traegt keinen Teilbaum 'inhalt'.")
        return kanonisch_sha256(dokument["inhalt"])
    if bindung["art"] == "inhalt_ohne_hashfeld":
        feld = bindung["hashfeld"]
        if feld not in dokument:
            raise LaufAbbruch(
                bindung["pfad"] + " traegt kein Hash-Feld " + repr(feld) + ".")
        return kanonisch_sha256({k: v for k, v in dokument.items() if k != feld})
    raise LaufAbbruch("Unbekannte Bindungsart: " + repr(bindung["art"]))


def rehash(wurzel, register_pfad, protokoll):
    """F6-B7: die ERSTE Handlung nach der Freigabe. Jede Abweichung bricht ab,
    unter Nennung der Datei.

    Zweiseitig: der Sollwert wird gegen die DATEI im Arbeitsbaum gehalten UND
    gegen den REGISTER-EINTRAG, der ihn bindet. Faellt eine der beiden Seiten,
    ist die Bindung nicht mehr das, was sie zu sein behauptet.
    """
    register = lies_json(register_pfad, "Das Zugriffs-Register")
    je_eintrag = {}
    for e in (register.get("events") or []):
        je_eintrag[e.get("runId")] = json.dumps(e, ensure_ascii=False,
                                                sort_keys=True)

    gepruefte = []
    for b in BINDUNGEN:
        ist = _ist_hash(b, wurzel)
        if ist != b["soll"]:
            raise LaufAbbruch(
                "HASH-ABWEICHUNG an " + b["pfad"] + " (" + b["art"] + ", "
                + b["was"] + "): ist " + ist + ", gebunden ist " + b["soll"]
                + " (Register-Eintrag " + b["eintrag"] + "). Der Lauf bricht "
                "ab - eine gebrochene Bindung macht jedes Ergebnis wertlos.")

        # Gegenrichtung: steht der Sollwert wirklich in dem Eintrag, auf den
        # sich diese Bindung beruft?
        text = je_eintrag.get(b["eintrag"])
        if text is None:
            raise LaufAbbruch(
                "Die Bindung fuer " + b["pfad"] + " beruft sich auf den "
                "Register-Eintrag " + repr(b["eintrag"]) + ", den es nicht gibt.")
        if b["soll"] not in text:
            raise LaufAbbruch(
                "REGISTER-DRIFT: der Sollwert fuer " + b["pfad"] + " ("
                + b["soll"][:16] + "...) steht NICHT im Register-Eintrag "
                + b["eintrag"] + ". Das Werkzeug fuehrt einen Wert, den das "
                "Register nicht bindet.")
        gepruefte.append({"pfad": b["pfad"], "art": b["art"],
                          "sha256": ist, "eintrag": b["eintrag"]})

    protokoll.append("Phase 1 REHASH: " + str(len(gepruefte))
                     + " Bindungen aus den Eintraegen 23 und 24 nachgerechnet, "
                     "alle deckungsgleich (Datei UND Register).")
    return gepruefte


# =============================================================================
# PHASE 2 - Die Zaehlung (injizierbare Grenze)
# =============================================================================
#
# WARUM HIER EINE GRENZE STEHT UND KEIN AUFRUF DES VERSIEGELTEN MODULS:
# `scripts/studie-basisraten.py` KANN das Prueffenster-Panel nicht oeffnen. Es
# fuehrt selbst die Mauer
#
#     VERBOTEN_RE = re.compile(r"endtest|validierung|pruefenster|prüfenster|..."
#
# und `pruefe_mauer()` wirft R2-ABBRUCH auf jeden Pfad, der darauf passt. Das
# Prueffenster-Panel heisst `panel-validierung.sqlite`
# (scripts/studie-zaehlprobe.py:97) und faellt damit unter die Sperre; das
# versiegelte Modul sagt woertlich: "E2 oeffnet ausschliesslich das
# Entdeckungsfenster". Es kennt ausserdem den Arm `kontrollpool` nicht (null
# Vorkommen) und gibt nur Aggregat-Zaehler zurueck, keine Zeilen je Firma -
# aus denen erst der Klumpen-Tally (m_g, n_g) entstuende.
#
# Das Modul zu aendern ist dreifach verboten (PIN 2, F6-B22, Wortlaut Ziffer 9:
# "Byte fuer Byte"). Also wird es NICHT geaendert, und die Zaehlung steht
# hinter dieser Grenze. Ohne gebundenes Zaehlwerk laeuft hier NICHTS -
# fail-closed, mit einer Meldung, die eine Entscheidung verlangt statt einer
# Zahl, die niemand gerechnet hat.

ZAEHLWERK_VERTRAG = """Ein Zaehlwerk ist eine Python-Datei mit der Funktion

    zaehle(panel_pfad, variante, arm) -> dict

Rueckgabe, alle Werte reine Zaehlungen:
    klumpen    Liste [[m_g, n_g], ...] - der Tally je Signal-Entitaet (Firma)
               ueber die Einheiten des NETTO-Tornenners. OHNE Kennung.
    n          der berichtete Netto-Tornenner N (Kreuzprobe)
    zaehler    der berichtete Zaehler M, reife Erst-Ereignisse (Kreuzprobe)
    zerlegung  dict mit n_A, n_B_reif, n_B_unreif, n_verloren, feuerfaehig,
               strukturell_nicht_feuerfaehig, rechts_zensiert (A16)

Das Zaehlwerk gibt NIE eine Firmen-Kennung zurueck (F6-B14). Sein SHA-256 wird
in Eintrag 25 namentlich gebunden (F6-B7)."""

ZERLEGUNGS_SCHLUESSEL = ("n_A", "n_B_reif", "n_B_unreif", "n_verloren",
                         "feuerfaehig", "strukturell_nicht_feuerfaehig",
                         "rechts_zensiert")


def lade_zaehlwerk(pfad):
    if not pfad:
        raise EntscheidungNoetig(
            "KEIN ZAEHLWERK GEBUNDEN. Die Zaehlung auf dem Prueffenster-Panel "
            "kann nicht vom versiegelten Modul scripts/studie-basisraten.py "
            "geleistet werden: dessen eigene Mauer (VERBOTEN_RE / pruefe_mauer) "
            "sperrt jeden Pfad, der 'validierung' enthaelt, und das "
            "Prueffenster-Panel heisst panel-validierung.sqlite. Das Modul "
            "kennt zudem den Arm 'kontrollpool' nicht und liefert keine Zeilen "
            "je Firma, aus denen der Klumpen-Tally entstuende. Es zu aendern "
            "ist durch PIN 2 und F6-B22 ausgeschlossen. ENTSCHEIDUNG NOETIG: "
            "welches Zaehlwerk die konfirmatorische Zaehlung fuehrt und unter "
            "welchem Akt es gebunden wird.\n\n" + ZAEHLWERK_VERTRAG)
    if not os.path.isfile(pfad):
        raise LaufAbbruch("Zaehlwerk nicht gefunden: " + str(pfad))
    spec = importlib.util.spec_from_file_location("f6_zaehlwerk", pfad)
    modul = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(modul)
    if not hasattr(modul, "zaehle"):
        raise LaufAbbruch(
            "Das Zaehlwerk " + str(pfad) + " fuehrt keine Funktion zaehle().\n\n"
            + ZAEHLWERK_VERTRAG)
    return modul, sha256_datei(pfad)


def _ganzzahl(x):
    """bool ist ein int - hier zaehlt es NICHT als Zahl (Muster `_zahl` aus
    scripts/studie-vb-b4-band.py)."""
    return isinstance(x, int) and not isinstance(x, bool)


def zaehlung(modul, panel_pfad, variante, arm):
    roh = modul.zaehle(panel_pfad, variante, arm)
    wo = variante + "/" + arm
    if not isinstance(roh, dict):
        raise LaufAbbruch("Das Zaehlwerk gab fuer " + wo + " kein dict zurueck.")
    for feld in ("klumpen", "n", "zaehler", "zerlegung"):
        if feld not in roh:
            raise LaufAbbruch("Zaehlwerk-Rueckgabe fuer " + wo
                              + " ohne Feld " + repr(feld) + ".")
    if not _ganzzahl(roh["n"]) or not _ganzzahl(roh["zaehler"]):
        raise LaufAbbruch("n und zaehler muessen ganze Zahlen sein (" + wo + ").")
    zerlegung = roh["zerlegung"]
    if not isinstance(zerlegung, dict):
        raise LaufAbbruch("zerlegung ist kein dict (" + wo + ").")
    fehlend = [k for k in ZERLEGUNGS_SCHLUESSEL if k not in zerlegung]
    if fehlend:
        raise LaufAbbruch("A16-Zerlegung unvollstaendig (" + wo + "): "
                          + ", ".join(fehlend))
    for k in ZERLEGUNGS_SCHLUESSEL:
        if not _ganzzahl(zerlegung[k]):
            raise LaufAbbruch("A16-Zerlegung " + k + " ist keine ganze Zahl ("
                              + wo + "). Die Zerlegungen sind REINE Zaehlungen.")
    fremd = sorted(set(zerlegung) - set(ZERLEGUNGS_SCHLUESSEL))
    if fremd:
        raise LaufAbbruch(
            "Die A16-Zerlegung fuehrt nicht gelistete Schluessel (" + wo
            + "): " + ", ".join(fremd) + ". Ein nicht gelisteter Schluessel "
            "ist ein ABBRUCH, kein Filter.")

    # Der Tally ist eine Liste von Zahlenpaaren. Ein Eintrag, der etwas anderes
    # ist, wird nach ART beschrieben - nie abgedruckt: der Abbruchtext ist auch
    # eine Ausgabeflaeche, und F6-B14 gilt dort ebenso.
    klumpen = roh["klumpen"]
    if not isinstance(klumpen, list):
        raise LaufAbbruch("klumpen ist keine Liste (" + wo + "), sondern "
                          + type(klumpen).__name__ + ".")
    for eintrag in klumpen:
        if (not isinstance(eintrag, (list, tuple)) or len(eintrag) != 2
                or not all(_ganzzahl(z) for z in eintrag)):
            raise LaufAbbruch(
                "Der Klumpen-Tally (" + wo + ") enthaelt einen Eintrag der Art "
                + type(eintrag).__name__ + ", der kein Paar aus zwei ganzen "
                "Zahlen ist. Eine Firmen-Kennung im Tally ist ein ABBRUCH, "
                "kein Filter (F6-B14).")
    return roh


# =============================================================================
# PHASE 3 - Klumpen-Tally -> SE (das eingefrorene Modul, per CLI)
# =============================================================================

def se_klumpen(se_skript, klumpen, n, zaehler, wo):
    """Ruft scripts/studie-f6-klumpen-se.py ueber seine eingefrorene CLI auf.

    Der Tally verlaesst den Prozess NUR als Zahlenpaare in eine Temp-Datei, die
    unmittelbar danach geloescht wird. Er steht in keiner Ausgabe (F6-B14).
    """
    fd, tally_pfad = tempfile.mkstemp(suffix=".json", prefix="f6-tally-")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump([[int(m), int(nn)] for m, nn in klumpen], fh)
        ruf = [sys.executable, se_skript, "se", "--klumpen", tally_pfad,
               "--n", str(n), "--zaehler", str(zaehler)]
        # Frist statt Ewigkeit (Muster scripts/studie-e2-verbreitert.py:598):
        # der Lauf ist unbeaufsichtigt, und ein haengendes Kind blockierte
        # sonst die ganze Nacht, ohne eine Zeile zu sagen.
        try:
            fertig = subprocess.run(ruf, capture_output=True, text=True,
                                    timeout=600)
        except subprocess.TimeoutExpired:
            raise LaufAbbruch(
                "Das SE-Modul hat fuer " + wo + " die Frist von 600 s "
                "ueberschritten und wurde abgebrochen.")
    finally:
        # Auch auf dem Abbruchpfad. Ein liegengebliebener Tally waere eine
        # Firmen-nahe Datei ohne Besitzer.
        try:
            os.unlink(tally_pfad)
        except OSError:
            pass

    if fertig.returncode != 0:
        raise LaufAbbruch(
            "Der klumpen-robuste SE ist fuer " + wo + " NICHT BERECHENBAR: "
            + (fertig.stderr or "").strip()[:400]
            + " | Folge ohne Ermessen: BandNichtAuswertbar -> "
            "Zulaessigkeits-Gate gerissen -> NICHT UNTERSCHEIDBAR, WEITER = 0. "
            "KEIN Rueckfall auf den kleineren SE.")
    try:
        ergebnis = json.loads(fertig.stdout)
    except ValueError:
        raise LaufAbbruch("Das SE-Modul gab fuer " + wo + " kein JSON zurueck.")

    erwartet = {"se_klumpen_robust", "klumpen_anzahl", "n", "zaehler", "anteil"}
    if set(ergebnis) != erwartet:
        raise LaufAbbruch(
            "Die Ausgabeflaeche des SE-Moduls ist eingefroren (Wortlaut "
            "Ziffer 9). Gesehen fuer " + wo + ": "
            + ", ".join(sorted(ergebnis)) + ".")
    return ergebnis


def se_binomial(anteil, n):
    """SE_binomial = Wurzel( p(1-p) / N ).

    Am Objekt abgelesen, nicht gewaehlt: die eingefrorene Vorschrift Ziffer 7
    setzt SE_klumpen-robust = SE_binomial * Wurzel(N/(N-1)) bei
    SE_klumpen-robust = Wurzel(p(1-p)/(N-1)); daraus folgt genau diese Form.
    `scripts/studie-f6-klumpen-se.py::selbsttest` rechnet mit demselben
    Ausdruck (se_binom = math.sqrt(p * (1 - p) / 10) bei N = 10).
    """
    # POSITIV geprueft, was gelten MUSS. Eine Schranke der Form `if n <= 0`
    # feuert bei NaN NIE, weil jeder Vergleich mit NaN False ist - dieselbe
    # Begruendung wie bei `_zahl` in scripts/studie-vb-b4-band.py.
    if not _ganzzahl(n) or n <= 0:
        raise LaufAbbruch("SE_binomial ist bei N = " + repr(n) + " nicht definiert.")
    if not (isinstance(anteil, float) and math.isfinite(anteil)
            and 0.0 <= anteil <= 1.0):
        raise LaufAbbruch("SE_binomial braucht einen Anteil in [0,1], nicht "
                          + repr(anteil) + ".")
    return math.sqrt(anteil * (1.0 - anteil) / n)


# =============================================================================
# PHASE 4 - Das Band-Modul, unveraendert (F6-B22)
# =============================================================================

def lade_bandmodul(wurzel):
    """Das Modul wird UNVERAENDERT geladen und mit den beiden bereits
    gerechneten Zahlen aufgerufen - `se_stern()` bildet nur `max()` darueber.

    Geladen statt ueber die CLI gefahren, weil die CLI `auswerten` nur
    menschenlesbar ausgibt (Verdikt, WEITER, SE*, Abstand, Wilson, Grund) und
    damit weder `bandbreiteAbsolut` noch `messgeraetVollstaendig` noch
    `abstandZu329Von365` an die Oberflaeche bringt. Die zweig-bewusste Pruefung
    aus F6-B15 braucht die VOLLSTAENDIGE Schluesselmenge des Zweigs; sie aus
    der Textausgabe zu rekonstruieren waere eine zweite Implementierung
    derselben Regel. Die Flaggen `--se-binomial` / `--se-klumpen` entsprechen
    eins zu eins den Parametern `se_binom` / `se_klumpen`; die Datei bleibt
    Byte fuer Byte unangetastet.
    """
    pfad = os.path.join(wurzel, "scripts", "studie-vb-b4-band.py")
    if not os.path.isfile(pfad):
        raise LaufAbbruch("Das Band-Modul fehlt: " + pfad)
    spec = importlib.util.spec_from_file_location("studie_vb_b4_band", pfad)
    modul = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(modul)
    return modul


def zweig_von(band):
    """Welcher der DREI Zweige (F6-B15)? Abgelesen an der SEMANTIK des
    Verdikts, nicht an den emittierten Schluesseln - sonst waere die
    Teilmengen-Pruefung zirkulaer und immer gruen."""
    if not band.get("messgeraetVollstaendig"):
        return ZWEIG_GATE_GERISSEN
    verdikt = band.get("verdikt")
    if verdikt == "NICHT UNTERSCHEIDBAR":
        return ZWEIG_IM_BAND
    if verdikt in ("BESTANDEN", "NICHT BESTANDEN"):
        return ZWEIG_AUSSERHALB_BAND
    raise LaufAbbruch(
        "Unbekannter Zweig der eingefrorenen Maschine: verdikt = "
        + repr(verdikt) + ". Die drei Zweige sind erschoepfend; ein vierter "
        "heisst, dass die Maschine nicht mehr die ist, gegen die geprueft wird.")


def uebersetze(band, zaehlung_roh, se_ergebnis):
    """Die camelCase-Ausgabe der eingefrorenen Maschine in die registrierten
    Schluesselnamen (F6-B12). Reine Umbenennung, keine Rechnung."""
    wilson = band.get("wilson95")
    werte = {
        "zaehler_reife": zaehlung_roh["zaehler"],
        "nenner_tor": band["n"],
        "anteil": band["ergebnis"],
        "se_binomial": band["seBinomial"],
        "se_klumpen_robust": band["seKlumpenRobust"],
        "klumpen_anzahl": se_ergebnis["klumpen_anzahl"],
        "wilson95_unten": wilson[0] if wilson else None,
        "wilson95_oben": wilson[1] if wilson else None,
        "schwelle": band["schwelle"],
        "bandbreite_in_se": band["bandbreiteInSE"],
        "fallzahl_min": band["fallzahlMin"],
        "messgeraet_vollstaendig": band["messgeraetVollstaendig"],
        "verdikt": band["verdikt"],
        "weiter": band["weiter"],
        "grund": band["grund"],
    }
    # Zweigabhaengig - genau das, was strikte Gleichheit zum Fehlalarm machen
    # wuerde. Was die Maschine in diesem Zweig nicht emittiert, wird hier auch
    # nicht erfunden.
    for band_name, registriert in (("seStern", "se_stern"),
                                   ("entschied", "se_entschied"),
                                   ("abstand", "abstand_zu_090"),
                                   ("bandbreiteAbsolut", "bandbreite_absolut"),
                                   ("abstandZu329Von365", "abstand_zu_329_von_365"),
                                   ("etikett", "etikett"),
                                   ("pflichtsatz", "pflichtsatz"),
                                   ("zweitsatz", "zweitsatz")):
        if band_name in band:
            werte[registriert] = band[band_name]
    werte.update({k: zaehlung_roh["zerlegung"][k] for k in ZERLEGUNGS_SCHLUESSEL})
    return werte


# =============================================================================
# PHASE 5 - Die Ausgabepruefung (F6-B10, B14, B15)
# =============================================================================

def pruefe_verbotene(baum, wo):
    """F6-B14 an JEDER Stelle des Baums, nicht nur auf der obersten Ebene.
    Jeder Eintrag ein ABBRUCH."""
    if isinstance(baum, dict):
        for k, v in baum.items():
            if str(k).lower() in VERBOTENE_SCHLUESSEL:
                raise LaufAbbruch(
                    "VERBOTENER SCHLUESSEL " + repr(k) + " in " + wo
                    + " (F6-B14). Jeder Eintrag der Verbotsliste ist ein "
                    "ABBRUCH, kein Filter - er wird nicht entfernt, der Lauf "
                    "endet.")
            pruefe_verbotene(v, wo + "." + str(k))
    elif isinstance(baum, list):
        for i, v in enumerate(baum):
            pruefe_verbotene(v, wo + "[" + str(i) + "]")


def pruefe_ausgabesatz(werte, zweig, wo):
    """F6-B15 - zweiseitig UND zweig-bewusst."""
    emittiert = set(werte)

    # (1) emittiert TEILMENGE VON registriert. Ein ungelisteter Schluessel ist
    #     ein ABBRUCH, kein Filter (preregistration.json:196).
    ungelistet = sorted(emittiert - DATEN_SCHLUESSEL)
    if ungelistet:
        raise LaufAbbruch(
            "UNGELISTETER SCHLUESSEL in " + wo + ": " + ", ".join(ungelistet)
            + ". Ein nicht gelisteter Schluessel ist ein ABBRUCH, kein Filter. "
            "Der Satz wird NIE durch Weglassen gebildet (F6-B9).")

    # (2) emittiert OBERMENGE VON zweig-pflichtig. Schweigen ueber einen
    #     unbequemen Zaehler ist ebenso ein ABBRUCH.
    pflicht = ZWEIG_PFLICHT[zweig]
    fehlend = sorted(pflicht - emittiert)
    if fehlend:
        raise LaufAbbruch(
            "PFLICHTSCHLUESSEL FEHLT in " + wo + " (Zweig " + zweig + "): "
            + ", ".join(fehlend) + ". Strikte Gleichheit waere ein Fehlalarm, "
            "ein fehlender Pflichtschluessel ist es nicht.")

    pruefe_verbotene(werte, wo)


def pruefe_umschlag(umschlag):
    ungelistet = sorted(set(umschlag) - UMSCHLAG_ALLOWLIST)
    if ungelistet:
        raise LaufAbbruch(
            "UNGELISTETES UMSCHLAG-FELD: " + ", ".join(ungelistet)
            + ". Die Umschlag-Allowlist ist eine EIGENE Liste (F6-B10).")
    vermischt = sorted(set(umschlag) & DATEN_SCHLUESSEL)
    if vermischt:
        raise LaufAbbruch(
            "VERMISCHUNG von Umschlag und Daten: " + ", ".join(vermischt)
            + ". Vermischen ist der Mechanismus, durch den der "
            "Zaehlproben-Satz zu breit wurde (F6-B10).")
    pruefe_verbotene(umschlag, "umschlag")


# =============================================================================
# Der Lauf
# =============================================================================

def lauf(freigabe_pfad, panel_pfad, bericht_pfad, zaehlwerk_pfad=None,
         wurzel=None, register_pfad=None):
    wurzel = wurzel or WURZEL_REPO
    register_pfad = register_pfad or os.path.join(wurzel, REGISTER_REL)
    protokoll = []
    gelesene = []

    # ── PHASE 0 ───────────────────────────────────────────────────────────
    # VOR allem anderen. Ohne gueltige Freigabe wird nicht einmal gehasht.
    erster_zugriff = jetzt_iso()
    freigabe, eintrag = lies_freigabe_konfirmatorisch(
        freigabe_pfad, register_pfad, erster_zugriff)
    gelesene.extend([freigabe_pfad, register_pfad])
    protokoll.append("Phase 0 FREIGABE: runId " + freigabe["runId"]
                     + ", Art " + ART_ZUGRIFF + ", Zweig main, Zeitkette "
                     "registeredAt < serverConfirmedAt <= accessedAt <= "
                     "ersterZugriff eingehalten.")

    # ── PHASE 1 ───────────────────────────────────────────────────────────
    gebundene = rehash(wurzel, register_pfad, protokoll)
    # Was gehasht wurde, wurde GELESEN. Der Bericht ist ein pruefbarer
    # Nachweis darueber, was der Lauf angefasst hat; eine unvollstaendige
    # Liste ist eine falsche Auskunft, kein fehlender Komfort.
    gelesene.extend(os.path.join(wurzel, *b["pfad"].split("/")) for b in BINDUNGEN)

    # ── PHASE 2 ───────────────────────────────────────────────────────────
    zaehlwerk, zaehlwerk_sha = lade_zaehlwerk(zaehlwerk_pfad)
    if not panel_pfad or not os.path.isfile(panel_pfad):
        raise LaufAbbruch("Das Panel fehlt: " + str(panel_pfad))
    gelesene.append(panel_pfad)
    protokoll.append("Phase 2 ZAEHLUNG: Zaehlwerk " + str(zaehlwerk_pfad)
                     + " (sha256 " + zaehlwerk_sha + ").")

    se_skript = os.path.join(wurzel, "scripts", "studie-f6-klumpen-se.py")
    band_pfad = os.path.join(wurzel, "scripts", "studie-vb-b4-band.py")
    band_modul = lade_bandmodul(wurzel)
    gelesene.extend([band_pfad, se_skript, str(zaehlwerk_pfad)])

    daten = {}
    for variante in VARIANTEN:
        je_arm = {}
        for arm in ARME:
            wo = variante + "/" + arm
            roh = zaehlung(zaehlwerk, panel_pfad, variante, arm)

            # ── PHASE 3 ───────────────────────────────────────────────────
            se = se_klumpen(se_skript, roh["klumpen"], roh["n"], roh["zaehler"], wo)
            anteil = se["anteil"]
            binom = se_binomial(anteil, se["n"])

            # ── PHASE 4 ───────────────────────────────────────────────────
            band = band_modul.auswerten(anteil, se["n"], binom,
                                        se["se_klumpen_robust"])

            # ── PHASE 5 ───────────────────────────────────────────────────
            werte = uebersetze(band, roh, se)
            zweig = zweig_von(band)
            pruefe_ausgabesatz(werte, zweig, wo)
            je_arm[arm] = {"umschlag": {"variante": variante, "arm": arm},
                           "werte": werte, "zweig": zweig}

        # F6-B11 - je Variante GENAU EIN armuebergreifender Schluessel.
        a_sig = je_arm["signal"]["werte"]["anteil"]
        a_kon = je_arm["kontrollpool"]["werte"]["anteil"]
        je_arm["differenz_punkte"] = abs(a_sig - a_kon) * 100.0
        fremd = sorted(set(je_arm) - set(ARME) - VARIANTEN_SCHLUESSEL)
        if fremd:
            raise LaufAbbruch("Ungelisteter Variantenschluessel: " + ", ".join(fremd))
        daten[variante] = je_arm

    beendet = jetzt_iso()
    umschlag = {
        "schema": SCHEMA,
        "protokoll": PROTOKOLL,
        "runId": freigabe["runId"],
        "fenster": freigabe["fenster"],
        "panelRand": None,
        "serverConfirmedAt": freigabe["serverConfirmedAt"],
        "accessedAt": freigabe["accessedAt"],
        "ersterZugriffAm": erster_zugriff,
        "beendetAm": beendet,
        "gelesenePfade": sorted({kurzpfad(p) for p in gelesene}),
        "geschriebenePfade": sorted([kurzpfad(bericht_pfad)]),
        "ergebnisdatenBeruehrt": True,
        "siegelWache": "Endtest-Siegel unberuehrt und ZU. Kein Endtest-Fenster, "
                       "kein Schluesselmaterial, keine Lueckenliste geoeffnet "
                       "(F6-A16).",
        "manifestGeprueft": sorted({b["pfad"] for b in BINDUNGEN}),
        "umgebung": {"plattform": sys.platform,
                     "python": platform.python_version()},
        "gebundeneHashes": gebundene + [
            {"pfad": "scripts/studie-f6-lauf.py", "art": "datei",
             "sha256": sha256_datei(os.path.abspath(__file__)),
             "eintrag": "zu binden in Eintrag 25 (F6-B7)"},
            {"pfad": kurzpfad(str(zaehlwerk_pfad)), "art": "datei",
             "sha256": zaehlwerk_sha,
             "eintrag": "zu binden in Eintrag 25 (F6-B7)"},
        ],
    }
    pruefe_umschlag(umschlag)

    bericht = {
        "umschlag": umschlag,
        "daten": daten,
        "stempel": {
            "abstandZu329Von365": STEMPEL_329,
            "vorabDeterminiertheit": VORAB_DETERMINIERTHEIT,
            "kriteriumDifferenz": {
                "schluessel": "differenz_punkte",
                "maxDifferenzPunkte": MAX_DIFFERENZ_PUNKTE,
                "quelle": "protocol/early-detection/2.0.0/preregistration.json:88",
                "auswertung": (
                    "NICHT AUSGEWERTET. Der Laeufer BERICHTET differenz_punkte "
                    "(F6-B11) und vergleicht sie NICHT gegen "
                    "maxDifferenzPunkte. Ob das 10-Punkte-Kriterium ein Tor "
                    "ist, das dieser Lauf zieht, oder eine Groesse, die der "
                    "Bericht nur ausweist, ist eine Methodikfrage: V2 fuehrt "
                    "die Zweiarmigkeit ausdruecklich als 'Arbeitsteilung - die "
                    "Bandregel je Arm, das 10-Punkte-Kriterium daneben' und "
                    "hat 'nichts daran entschieden'. Der Bauende entscheidet "
                    "sie nicht still mit. OFFEN."),
            },
            "zweigPflichtTeilmengen": {
                z: sorted(s) for z, s in ZWEIG_PFLICHT.items()},
        },
        "protokoll": protokoll,
    }
    return bericht


def main(argv=None):
    p = argparse.ArgumentParser(
        description="F6-LAUF - der konfirmatorische Laeufer des F6-Tors")
    p.add_argument("--freigabe", required=True,
                   help="Freigabe-Protokoll aus scripts/studie-r1-serverzeit.js")
    p.add_argument("--panel", help="Pfad des Prueffenster-Panels")
    p.add_argument("--bericht", required=True, help="Zieldatei des Berichts")
    p.add_argument("--zaehlwerk", help="Python-Datei mit zaehle(panel, variante, arm)")
    p.add_argument("--wurzel", help="Repo-Wurzel (Vorgabe: die dieses Skripts)")
    p.add_argument("--register", help="Zugriffs-Register (Vorgabe: die Hausdatei)")
    a = p.parse_args(argv)

    # Fail-closed bis in die Ausgabe: bei einem Abbruch wird KEIN Bericht
    # geschrieben. Ein halber Bericht wanderte als Ergebnis in die Akte.
    try:
        bericht = lauf(a.freigabe, a.panel, a.bericht, a.zaehlwerk,
                       a.wurzel, a.register)
    except EntscheidungNoetig as fehler:
        print("F6-LAUF-ENTSCHEIDUNG-NOETIG: " + str(fehler), file=sys.stderr)
        return 2
    except LaufAbbruch as fehler:
        print("F6-LAUF-ABBRUCH: " + str(fehler), file=sys.stderr)
        return 1
    except Exception as fehler:  # noqa: BLE001 - genau das ist der Zweck
        # DIE FEHLERFLAECHE IST AUCH EINE AUSGABEFLAECHE (F6-B14).
        # Das Zaehlwerk ist FREMDER, per --zaehlwerk geladener Code und das
        # einzige Glied dieser Kette, das Zeilen je Firma sieht. Ein
        # durchgereichter Traceback traegt seinen Ausnahmetext ungeprueft nach
        # stderr - ein KeyError ueber einer CIK-Schluesselung druckt die CIK,
        # ein sqlite3-Fehler unter Umstaenden eine ganze Zeile. Ausserdem waere
        # ein nackter Traceback kein BENANNTER Abbruch.
        # Deshalb: die ART melden, den TEXT unterdruecken.
        print("F6-LAUF-ABBRUCH: interner Fehler der Art "
              + type(fehler).__name__ + ". Der Ausnahmetext wird "
              "ABSICHTLICH unterdrueckt - er kann aus fremdem Code stammen "
              "und eine Firmen-Kennung tragen (F6-B14). Zur Diagnose den "
              "Lauf mit einem Fixture-Zaehlwerk wiederholen.", file=sys.stderr)
        return 1

    with open(a.bericht, "w", encoding="utf-8") as fh:
        # allow_nan=False: json.dump schreibt sonst STILL die nicht-normgerechten
        # Literale NaN / Infinity und erzeugte damit einen Bericht, der wie eine
        # Zahl aussieht und keine ist. Hier soll er lieber laut brechen.
        json.dump(bericht, fh, ensure_ascii=False, indent=1, allow_nan=False)
        fh.write("\n")
    for zeile in bericht["protokoll"]:
        print(zeile)
    print("Bericht       : " + a.bericht)
    return 0


if __name__ == "__main__":
    sys.exit(main())

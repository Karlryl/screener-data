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

# =============================================================================
# Panel-Rand und Signalband (F6-C20 bis F6-C23)
# =============================================================================
#
# ABGELEITET, NIE GESETZT. `scripts/studie-zaehlprobe.py:97` fuehrt denselben
# Wert, ist aber AUSDRUECKLICH NICHT die Quelle (F6-C20, 3:0): ein Instrument
# der Art `count_only_probe_authorized` vererbt seine Konstanten nicht an ein
# Instrument anderer Art. Es bleibt als Korroboration zitierfaehig, mehr nicht.
#
# SOLLWERTE als Konstanten UND zur Laufzeit am Objekt nachgerechnet - Form
# F6-B8, beide Richtungen zu. Kein CLI-Argument, keine Vorbelegung.

# Das Fenster heisst im Haus "pruefung", in `rules.json` "validierung".
RULES_FENSTER = {"pruefung": "validierung", "entdeckung": "entdeckung",
                 "endtest": "endtest"}

# JE FENSTER. Ein einziger globaler Sollwert-Satz haette jedes andere Fenster
# mit "ABGELEITETER WERT WEICHT AB" quittiert - einer Meldung, die nach
# Manipulation klingt, obwohl der Lauf schlicht ein anderes Fenster fuehrt.
FENSTER_SOLL = {
    "entdeckung": {"von": "2009-01-01", "bis": "2015-12-31",
                   "rand": "2016-12-31"},
    "pruefung": {"von": "2017-01-01", "bis": "2019-12-31",
                 "rand": "2020-12-31"},
}
FENSTER_VON_SOLL = FENSTER_SOLL["pruefung"]["von"]
FENSTER_BIS_SOLL = FENSTER_SOLL["pruefung"]["bis"]
PANEL_RAND_SOLL = FENSTER_SOLL["pruefung"]["rand"]

PANEL_RAND_HERKUNFT = (
    "ABGELEITET, NICHT GESETZT. rules.json (dc008723...) fenster.validierung "
    "von 2017q1 bis 2019q4 und pufferjahre [2016, 2020] mit pufferGrund "
    "\"Reifebereinigung: jedes Ereignis braucht 4 Folgequartale ... kein "
    "Folgequartal darf ueber eine Fenstergrenze reichen.\"; "
    "preregistration.json /splits/pruefung \"2017-01-01/2019-12-31 "
    "(Signalfenster) mit Pufferjahr 2020 fuer die Reife\" und /splits/"
    "fensterAchse \"Jedes Fenster wird am `accepted`-Zeitstempel der "
    "SEC-Einreichung geschnitten, nie am Bilanzstichtag.\"; Reife = vier "
    "Folgequartale; Schnitt realisiert in scripts/studie-panel-bau.py:99. "
    "scripts/studie-zaehlprobe.py:97 ist NUR Korroboration, nie Quelle "
    "(F6-C20). SIGNALBAND und PANEL-RAND werden getrennt gefuehrt und "
    "gegeneinander verriegelt (F6-C22): Erst-Ereignisse duerfen ausschliesslich "
    "aus 2017-01-01/2019-12-31 stammen, die Zensur rechnet gegen 2020-12-31. "
    "Ein Erst-Ereignis mit accepted im Pufferjahr 2020 ist ein ABBRUCH, kein "
    "Sonderfall - sonst verlaengert der Panel-Rand still das Signalband um ein "
    "Jahr.")

# F6-C18/KZ-7 - die am Objekt gemessenen Anker, damit der konfirmatorische
# Eintrag sie abschreiben kann statt sie neu abzuleiten.
ZWEIG_ANKER = {
    "datei": "scripts/studie-vb-b4-band.py",
    "funktion": "auswerten :145-227",
    "konvention": ("fuehrende Zeile (def bzw. das entscheidende `if`) plus die "
                   "vollstaendige return-Anweisung"),
    "gate_gerissen": ":168-172",
    "im_band": ":213-217",
    "ausserhalb_band": ":218-227",
    "berichtigung": ("Die frueher im Laeufer gefuehrten Anker "
                     "\":129-134 / :211-215 / :216-224\" sind falsch; "
                     ":129-142 ist se_stern(). Der zwischen den Stimmen "
                     "strittige Anker ausserhalb_band ist am Objekt gemessen "
                     ":218-227 (Z2/Z3), nicht :218-226 (Z1) - :226-227 tragen "
                     "die letzten zwei Zeilen der NICHT-BESTANDEN-Rueckgabe."),
}


def _quartalsgrenze(wert, feld, erwartetes_quartal):
    """Eine Fenstergrenze der Form JJJJqQ - Jahr UND Quartal positiv geprueft.

    `signal_von` wird als 1. Januar und `signal_bis`/`panelRand` als
    31. Dezember gebildet. Das ist nur richtig, wenn das Fenster wirklich in
    Q1 beginnt und in Q4 endet. Wer das nicht prueft, raet es.
    """
    roh = str(wert)
    if (len(roh) != 6 or roh[4] != "q" or not roh[:4].isdigit()
            or not roh[5].isdigit()):
        raise LaufAbbruch(
            "Die Fenstergrenze " + repr(wert) + " (" + feld + ") hat nicht die "
            "erwartete Quartalsform JJJJqQ - der Panel-Rand ist daraus nicht "
            "ableitbar.")
    if roh[5] != erwartetes_quartal:
        raise LaufAbbruch(
            "Die Fenstergrenze " + repr(wert) + " (" + feld + ") liegt in "
            "Quartal " + roh[5] + ", erwartet ist Quartal "
            + erwartetes_quartal + ". Die Ableitung bildet Jahresgrenzen "
            "(01-01 bzw. 12-31) und waere bei einem anderen Quartal schlicht "
            "falsch - sie wird deshalb nicht geraten.")
    return roh


def leite_panelrand_ab(wurzel, fenster_name):
    """F6-C23: den Panel-Rand zur LAUFZEIT ableiten und gegen die gebundene
    Konstante halten. Abweichung = fail-closed-Abbruch, kein Ermessen.

    Die Kette, jedes Glied registriert:
      rules.json  fenster.<fenster>.bis  ->  letztes Signaljahr
      rules.json  pufferjahre            ->  das Pufferjahr = Signaljahr + 1
      Panel-Rand  = 31.12. des Pufferjahres
    """
    schluessel = RULES_FENSTER.get(fenster_name)
    if not schluessel:
        raise LaufAbbruch(
            "Unbekanntes Fenster " + repr(fenster_name) + " - der Panel-Rand "
            "ist dafuer nicht ableitbar.")
    regeln = lies_json(os.path.join(wurzel, "protocol", "early-detection",
                                    "2.0.0", "rules.json"),
                       "Das Regelwerk rules.json")
    fenster = (regeln.get("fenster") or {}).get(schluessel)
    if not fenster or not fenster.get("von") or not fenster.get("bis"):
        raise LaufAbbruch(
            "rules.json fuehrt kein vollstaendiges Fenster " + repr(schluessel)
            + ". Ohne Fenstergrenzen gibt es keinen abgeleiteten Panel-Rand.")
    puffer = regeln.get("pufferjahre")
    if not isinstance(puffer, list) or not puffer:
        raise LaufAbbruch("rules.json fuehrt keine pufferjahre.")

    # "2019q4" -> 2019. Die Quartalsform wird positiv geprueft, nie geraten.
    # Das QUARTAL wird mitgeprueft, nicht nur das Jahr. Ohne diese Zeile
    # erzeugte "2019q2" still denselben Rand "2019-12-31" wie "2019q4" - der
    # Sollwert-Vergleich haette gehalten, obwohl das Quellendokument etwas
    # anderes sagt. Der Kommentar versprach eine positive Pruefung; hier steht
    # sie jetzt auch.
    bis = _quartalsgrenze(fenster["bis"], "bis", "4")
    signaljahr = int(bis[:4])
    pufferjahr = signaljahr + 1
    if pufferjahr not in puffer:
        raise LaufAbbruch(
            "Das Pufferjahr " + str(pufferjahr) + " (Signaljahr " + str(signaljahr)
            + " + 1) steht nicht in rules.json pufferjahre " + repr(puffer)
            + ". Die Reifebereinigung braucht genau dieses Jahr; ohne es ist "
            "der Panel-Rand nicht abgeleitet, sondern geraten.")

    abgeleitet = str(pufferjahr) + "-12-31"
    von = _quartalsgrenze(fenster["von"], "von", "1")
    signal_von = von[:4] + "-01-01"
    signal_bis = str(signaljahr) + "-12-31"

    # Beide Richtungen zu (F6-B8): der abgeleitete Wert gegen die gebundene
    # Konstante, und die Konstante gegen das Objekt.
    soll_satz = FENSTER_SOLL.get(fenster_name)
    if not soll_satz:
        raise LaufAbbruch(
            "Fuer das Fenster " + repr(fenster_name) + " fuehrt der Laeufer "
            "keinen gebundenen Sollwert-Satz.")
    for name, ist, soll in (("panelRand", abgeleitet, soll_satz["rand"]),
                            ("fensterVon", signal_von, soll_satz["von"]),
                            ("fensterBis", signal_bis, soll_satz["bis"])):
        if ist != soll:
            raise LaufAbbruch(
                "ABGELEITETER WERT WEICHT AB: " + name + " ist " + repr(ist)
                + ", gebunden ist " + repr(soll) + ". Der Lauf bricht ab - "
                "ein Bericht mit einem geratenen Fenster ist ein Bericht ohne "
                "Fenster.")

    # F6-C22: Signalband und Panel-Rand sind verriegelt - der Rand liegt genau
    # ein Jahr hinter dem Signalband und darf es nie verlaengern.
    if not signal_bis < abgeleitet:
        raise LaufAbbruch(
            "Der Panel-Rand " + abgeleitet + " liegt nicht nach dem Ende des "
            "Signalbands " + signal_bis + ".")
    return {"fensterVon": signal_von, "fensterBis": signal_bis,
            "panelRand": abgeleitet}


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
    "fensterVon", "fensterBis",
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

# F6-B15 / F6-C17 / F6-C18 - die DREI zweig-pflichtigen Teilmengen. Sie sind
# nicht erfunden, sondern an `scripts/studie-vb-b4-band.py::auswerten`
# (:145-227) ABGELESEN: die eingefrorene Maschine hat genau drei
# unterscheidbare Schluesselmengen.
#
# ANKER, AM OBJEKT GEMESSEN (F6-C18/KZ-7 - der gemessene Wert gilt, nicht der
# des Gerichts). Konvention: die fuehrende Zeile (def bzw. das entscheidende
# `if`) plus die vollstaendige `return`-Anweisung.
#
#   gate_gerissen       :168-172  - def :168, return :169-172
#   im_band             :213-217  - if  :213, return :214-217
#   ausserhalb_band     :218-227  - if  :218, return BESTANDEN :219-222,
#                                   return NICHT BESTANDEN :223-227
#
# Die frueher hier gefuehrten Anker ":129-134 / :211-215 / :216-224" waren
# FALSCH: :129-142 ist `se_stern()`, nicht `gate_gerissen` (F6-C18, 2:0).
# Der zwischen den Stimmen strittige Anker `ausserhalb_band` ist gemessen
# :218-227 (Z2/Z3) und nicht :218-226 (Z1) - :226-227 tragen die letzten zwei
# Zeilen der NICHT-BESTANDEN-Rueckgabe, die bei :218-226 abgeschnitten waeren.
#
# WAS DIE MENGEN UNTERSCHEIDET - ausgeschrieben, nie abgekuerzt (F6-C17):
#   gate_gerissen fuehrt `abstand_zu_090` SEHR WOHL, naemlich als None; NICHT
#   gefuehrt wird `abstand_zu_329_von_365`. Die Kurzform "ohne abstand" ist
#   unzulaessig - sie verschluckt `_zu_329_von_365` und ist genau die Art
#   Verkuerzung, gegen die F6-B13 den Stempel gesetzt hat.
#
# NULL IST ANWESEND (F6-C19): im Zweig gate_gerissen sind `se_stern`,
# `se_entschied` und `abstand_zu_090` VORHANDEN mit Wert None, ebenso
# `wilson95_unten`/`wilson95_oben` bei `messbar = false`. F6-B15 prueft
# ANWESENHEIT, nicht Wert. Weglassen statt None ist ein Pflichtschluessel-
# ABBRUCH.
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
    if not isinstance(freigabe.get("fenster"), str):
        raise LaufAbbruch(
            "Das Feld 'fenster' der Freigabe ist keine Zeichenkette ("
            + type(freigabe.get("fenster")).__name__ + ").")
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


def _pfadgleich(a, b):
    """Zwei Pfadangaben auf dieselbe Stelle. Gross-/Kleinschreibung und
    Trennzeichen sind unter Windows nicht bedeutungstragend, der Pfad selbst
    schon."""
    norm = lambda p: os.path.normcase(os.path.abspath(str(p)))
    return norm(a) == norm(b)


def ruest_zaehlwerk(modul, arbeit_pfad, freigabe=None):
    """Der Arbeitspfad geht VOR der ersten Zaehlung an das Zaehlwerk.

    Der Vertrag `zaehle(panel_pfad, variante, arm)` ist eingefroren (F6-C1) und
    traegt den Arbeitspfad deshalb nicht. Ein Zaehlwerk, das eine Arbeitsdatei
    braucht, fuehrt dafuer `setze_arbeitspfad`; ein Fixture-Zaehlwerk ohne
    eigene E/A fuehrt sie nicht und braucht dann auch keinen Pfad.

    RANGFOLGE (Ruling 2): nennt die FREIGABE einen Arbeitspfad, ist er
    massgeblich - ein davon abweichendes --arbeit ist dann ein ABBRUCH, kein
    Vorrang. Nennt sie keinen, gilt --arbeit, und ohne --arbeit die benannte
    Vorgabe des Zaehlwerks. Der Pfad wird nie zur Laufzeit erfunden
    (W-B / KZ-3).
    """
    if not hasattr(modul, "setze_arbeitspfad"):
        return None
    angemeldet = (freigabe or {}).get("arbeitspfad")
    if angemeldet and arbeit_pfad and not _pfadgleich(angemeldet, arbeit_pfad):
        raise LaufAbbruch(
            "ARBEITSPFAD WEICHT VON DER FREIGABE AB: angemeldet ist "
            + repr(angemeldet) + ", uebergeben wurde " + repr(arbeit_pfad)
            + ". Der im Eintrag genannte Pfad ist massgeblich; ein anderer "
            "Pfad ist ein anderer Lauf.")
    gewaehlt = angemeldet or arbeit_pfad or getattr(
        modul, "ARBEITSPFAD_VORGABE", None)
    if not gewaehlt:
        raise LaufAbbruch(
            "Das Zaehlwerk verlangt einen Arbeitspfad (setze_arbeitspfad), "
            "fuehrt aber keine ARBEITSPFAD_VORGABE, und der Lauf hat kein "
            "--arbeit bekommen. Der Arbeitspfad wird VOR der Freigabe geprueft "
            "und im Eintrag genannt, nie zur Laufzeit erfunden (W-B / KZ-3).")
    return modul.setze_arbeitspfad(gewaehlt)


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


# =============================================================================
# Das 10-Punkte-Kriterium (F6-C13 bis F6-C16)
# =============================================================================
#
# AUSGEWERTET, NICHT NUR BERICHTET - als VIERTE KONJUNKTIVE Torbedingung,
# gerechnet HIER im Laeufer und NIEMALS im eingefrorenen Bandmodul
# (`scripts/studie-vb-b4-band.py` bleibt Byte fuer Byte unangetastet, F6-B22).
#
# Diese Frage hat das Gericht entschieden, nicht der Bauende: der frueher an
# dieser Stelle gefuehrte Stempel "NICHT AUSGEWERTET ... OFFEN" ist durch
# _COURT-F6-ZAEHLWERK-2026-09-01 (B), 3:0, erledigt. Belege im Urteil:
# `preregistration.json:88` fuehrt die 10 Punkte INNERHALB des Objekts, das
# woertlich `gate` heisst; `:89` sagt "R9 - Pass/Fail, nicht Fussnote.";
# `:139` gibt die Folge (INCONCLUSIVE_DATA, kein p-Wert); und zwei
# ratifizierte Vollstrecker rechnen es bereits als Tor
# (`studie-zaehlprobe.py:529-530`, `studie-e4d-kadenz.py:612-632`).
#
# ZWEI WOERTLICHKEITS-FALLEN (F6-C14), beide gepinnt:
#   (a) GLEICHHEIT BESTEHT. Verglichen wird `<= 10`; exakt 10,0 reisst NICHT.
#       KEINE RUNDUNG VOR DEM VERGLEICH - Hauskonvention des Bandmoduls
#       (`studie-vb-b4-band.py:198-199`).
#   (b) EINHEIT. Verglichen wird in PUNKTEN gegen 10, nie in Anteilen gegen
#       0,1. Ein Faktor-100-Fehler kippt hier das Verdikt.
#
# KEIN BAND, KEIN SE, KEIN ERMESSEN auf der Differenz: ein Band um die
# Differenz waere eine neue Schaetzgroesse mit neuem SE und damit die von
# Register-Eintrag 23 verbotene Neuableitung. Blanker Punktvergleich.

DIFFERENZ_QUELLE = ("protocol/early-detection/2.0.0/preregistration.json:88 - "
                    "\"gate\": {\"minimum\": 0.9, \"gilt\": \"Signal-Arm UND "
                    "Kontrollpool\", \"maxDifferenzPunkte\": 10}")

# Die Zusammensetzung als REGELTEXT (F6-C13), woertlich wie im Urteil.
TOR_REGELTEXT = (
    "WEITER = 1 nur bei (beide Arm-Bandverdikte BESTANDEN) UND "
    "(differenz_punkte <= 10). "
    "Ein Arm NICHT UNTERSCHEIDBAR -> Gesamt NICHT UNTERSCHEIDBAR, WEITER = 0 "
    "(das Messgeraet hat nicht getrennt; die Bandfolge dominiert). "
    "Ein Arm NICHT BESTANDEN -> Tor gerissen, WEITER = 0. "
    "Beide BESTANDEN, aber differenz_punkte > 10 -> Tor gerissen nach "
    "preregistration.json:139 (INCONCLUSIVE_DATA, kein p-Wert), WEITER = 0. "
    "Kein Band, kein SE und kein Ermessen auf der Differenz.")

TOR_RICHTUNG = (
    "RICHTUNGS-OFFENLEGUNG (Form F6-B21): die Zusammensetzung kann WEITER nur "
    "ERSCHWEREN, nie erzeugen - sie entfernt ein BESTANDEN, sie schafft "
    "keines. Das ist eine Aussage ueber die Richtung der REGEL, nicht ueber "
    "den Ausgang des Laufs.")


def differenz_objekt(anteil_signal, anteil_kontrollpool):
    """F6-C15: `differenz_punkte` ist ein Objekt, kein nackter Wert.

    Gerechnet wird in PUNKTEN (`* 100.0`) und OHNE jede Rundung - der
    Vergleich `<= 10` faellt sonst genau auf der Kante falsch aus.
    """
    for name, wert in (("signal", anteil_signal),
                       ("kontrollpool", anteil_kontrollpool)):
        if not (isinstance(wert, float) and math.isfinite(wert)):
            raise LaufAbbruch(
                "Der Anteil des Arms " + name + " ist keine endliche Zahl ("
                + repr(wert) + ") - die Arm-Differenz ist nicht bildbar.")
    wert = abs(anteil_signal - anteil_kontrollpool) * 100.0
    return {
        "wert": wert,
        "maxDifferenzPunkte": MAX_DIFFERENZ_PUNKTE,
        # Gleichheit besteht. KEINE Rundung vor dem Vergleich.
        "erfuellt": wert <= MAX_DIFFERENZ_PUNKTE,
        "quelle": DIFFERENZ_QUELLE,
    }


def tor_verdikt(verdikt_signal, verdikt_kontrollpool, differenz):
    """F6-C13: das Tor-Verdikt je Variante, vier konjunktive Bedingungen.

    Die Reihenfolge ist die des Urteils und nicht beliebig: die Bandfolge
    DOMINIERT. Ein Arm, den das Messgeraet nicht getrennt hat, macht das
    Gesamtverdikt NICHT UNTERSCHEIDBAR - auch dann, wenn die Differenz haelt.
    """
    verdikte = (verdikt_signal, verdikt_kontrollpool)
    bekannt = {"BESTANDEN", "NICHT UNTERSCHEIDBAR", "NICHT BESTANDEN"}
    unbekannt = [v for v in verdikte if v not in bekannt]
    if unbekannt:
        raise LaufAbbruch(
            "Unbekanntes Arm-Verdikt: " + repr(unbekannt) + ". Die drei "
            "Verdikte der eingefrorenen Maschine sind erschoepfend; ein "
            "viertes heisst, dass die Maschine nicht mehr die ist, gegen die "
            "geprueft wird.")

    if "NICHT UNTERSCHEIDBAR" in verdikte:
        return {"verdikt": "NICHT UNTERSCHEIDBAR", "weiter": 0,
                "grund": ("Mindestens ein Arm ist NICHT UNTERSCHEIDBAR - das "
                          "Messgeraet hat dort nicht getrennt. Die Bandfolge "
                          "dominiert die Differenz-Bedingung."),
                "regeltext": TOR_REGELTEXT, "richtung": TOR_RICHTUNG}
    if "NICHT BESTANDEN" in verdikte:
        return {"verdikt": "TOR GERISSEN", "weiter": 0,
                "grund": "Mindestens ein Arm ist NICHT BESTANDEN.",
                "regeltext": TOR_REGELTEXT, "richtung": TOR_RICHTUNG}
    # Beide Arme BESTANDEN - jetzt, und nur jetzt, entscheidet die Differenz.
    if not differenz["erfuellt"]:
        return {"verdikt": "TOR GERISSEN", "weiter": 0,
                "grund": ("Beide Arme BESTANDEN, aber die Arm-Differenz "
                          + repr(differenz["wert"]) + " Punkte ueberschreitet "
                          + repr(MAX_DIFFERENZ_PUNKTE) + " Punkte: "
                          "INCONCLUSIVE_DATA nach preregistration.json:139, "
                          "kein p-Wert wird berechnet (R9)."),
                "regeltext": TOR_REGELTEXT, "richtung": TOR_RICHTUNG}
    return {"verdikt": "TOR GEHALTEN", "weiter": 1,
            "grund": ("Beide Arm-Bandverdikte BESTANDEN und die Arm-Differenz "
                      + repr(differenz["wert"]) + " Punkte haelt die Schranke "
                      "von " + repr(MAX_DIFFERENZ_PUNKTE) + " Punkten "
                      "(Gleichheit besteht)."),
            "regeltext": TOR_REGELTEXT, "richtung": TOR_RICHTUNG}


def pruefe_keine_absolutpfade(baum, absolut, wo="bericht"):
    """R12a am SCHREIB-RAND: kein absoluter Pfad verlaesst diesen Lauf.

    WARUM HIER UND NICHT AN JEDER EINZELNEN STELLE: ein Kurzpfad-Aufruf, den
    jemand kuenftig vergisst, macht dieselbe Wunde neu auf. Der Wachposten
    steht deshalb dort, wo ALLE Wege zusammenlaufen - unmittelbar vor dem
    Schreiben.

    Geprueft wird gegen die Pfade, die dieser Lauf TATSAECHLICH angefasst hat
    (exakt, keine Heuristik), plus die zwei Wurzelformen, die eine
    Benutzerkennung tragen koennen. Der Vergleich laeuft ueber den GEPARSTEN
    Baum, nicht ueber den JSON-Text: in JSON-Text sind Windows-Backslashes
    verdoppelt, und genau daran ist die erste Fassung dieses Waechters auf
    Windows still gruen geblieben, waehrend sie auf Linux zu Recht rot wurde.
    """
    if isinstance(baum, dict):
        for k, v in baum.items():
            pruefe_keine_absolutpfade(v, absolut, wo + "." + str(k))
        return
    if isinstance(baum, list):
        for i, v in enumerate(baum):
            pruefe_keine_absolutpfade(v, absolut, wo + "[" + str(i) + "]")
        return
    if not isinstance(baum, str):
        return
    for pfad in absolut:
        if pfad and pfad in baum:
            raise LaufAbbruch(
                "ABSOLUTER PFAD IM BERICHT bei " + wo + " (R12a). Ein voller "
                "Pfad traegt die Benutzerkennung des Rechners in die Akte. "
                "Es gilt die Kurzform Elternverzeichnis/Datei (Muster "
                "scripts/studie-basisraten.py:251).")
    # Die beiden Wurzelformen, die eine Kennung tragen. Prosa enthaelt sie
    # nicht; ein durchgerutschter Pfad schon.
    for wurzelform in ("/home/", "/Users/", "C:\\", "c:\\"):
        if wurzelform in baum:
            raise LaufAbbruch(
                "PFAD-WURZEL " + repr(wurzelform) + " im Bericht bei " + wo
                + " (R12a).")


def pruefe_umschlag(umschlag):
    # F6-C23: bis hierher pruefte diese Funktion ausschliesslich
    # Schluessel-MITGLIEDSCHAFT, nie den Wert - ein `panelRand: None` waere
    # glatt durchgelaufen. "Ein Null-Rand im konfirmatorischen Bericht ist ein
    # Bericht ohne Fenster." Die Pflichtfelder werden deshalb POSITIV auf
    # einen Wert geprueft.
    for feld in ("panelRand", "fensterVon", "fensterBis", "runId", "fenster",
                 "serverConfirmedAt", "accessedAt", "ersterZugriffAm"):
        wert = umschlag.get(feld)
        if not isinstance(wert, str) or not wert.strip():
            raise LaufAbbruch(
                "UMSCHLAG-PFLICHTFELD OHNE WERT: " + feld + " = " + repr(wert)
                + ". Schluessel-Mitgliedschaft allein ist keine Angabe.")
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
         wurzel=None, register_pfad=None, arbeit_pfad=None):
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

    # F6-C23 - direkt nach dem Rehash, weil die Ableitung auf rules.json steht
    # und die Datei erst jetzt nachweislich die gebundene ist.
    rand = leite_panelrand_ab(wurzel, freigabe["fenster"])
    protokoll.append("Phase 1b PANEL-RAND: Signalband " + rand["fensterVon"]
                     + " bis " + rand["fensterBis"] + ", Panel-Rand "
                     + rand["panelRand"] + " - aus rules.json abgeleitet und "
                     "gegen die gebundene Konstante gehalten.")

    # ── PHASE 2 ───────────────────────────────────────────────────────────
    zaehlwerk, zaehlwerk_sha = lade_zaehlwerk(zaehlwerk_pfad)
    geruesteter_arbeitspfad = ruest_zaehlwerk(zaehlwerk, arbeit_pfad, freigabe)
    if not panel_pfad or not os.path.isfile(panel_pfad):
        raise LaufAbbruch("Das Panel fehlt: " + str(panel_pfad))
    gelesene.append(panel_pfad)
    protokoll.append(
        "Phase 2 ZAEHLUNG: Zaehlwerk " + kurzpfad(str(zaehlwerk_pfad))
        + " (sha256 " + zaehlwerk_sha + ")"
        + (", Arbeitspfad " + kurzpfad(str(geruesteter_arbeitspfad))
           + " (W-B geprueft)" if geruesteter_arbeitspfad else "") + ".")

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

        # F6-B11 / F6-C15 - je Variante GENAU EIN armuebergreifender
        # Schluessel; er traegt jetzt ein OBJEKT statt einer nackten Zahl.
        # VARIANTEN_SCHLUESSEL bleibt dadurch einelementig: eine Erweiterung
        # von EINEM auf ZWEI Schluesseln waere eine Schwaechung von F6-B11.
        a_sig = je_arm["signal"]["werte"]["anteil"]
        a_kon = je_arm["kontrollpool"]["werte"]["anteil"]
        je_arm["differenz_punkte"] = differenz_objekt(a_sig, a_kon)
        je_arm["tor"] = tor_verdikt(
            je_arm["signal"]["werte"]["verdikt"],
            je_arm["kontrollpool"]["werte"]["verdikt"],
            je_arm["differenz_punkte"])
        fremd = sorted(set(je_arm) - set(ARME) - VARIANTEN_SCHLUESSEL
                       - {"tor"})
        if fremd:
            raise LaufAbbruch("Ungelisteter Variantenschluessel: " + ", ".join(fremd))
        daten[variante] = je_arm

    beendet = jetzt_iso()
    umschlag = {
        "schema": SCHEMA,
        "protokoll": PROTOKOLL,
        "runId": freigabe["runId"],
        "fenster": freigabe["fenster"],
        "fensterVon": rand["fensterVon"],
        "fensterBis": rand["fensterBis"],
        "panelRand": rand["panelRand"],
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
             "eintrag": "zu binden im konfirmatorischen Eintrag (F6-B7)"},
            # F6-C24: `studie-zaehlprobe.py` ist durch die Wiederverwendung von
            # arm_zaehlen/ist_zensiert/im_signalband AUSFUEHRENDER REGELCODE
            # geworden und deshalb zwingend mitzubinden - der mitbeurkundete
            # Nebenpreis: jede spaetere Aenderung daran bricht ab sofort den
            # F6-Vollzug. Es steht NICHT in BINDUNGEN, weil die Eintraege 23
            # und 24 es nicht binden; gebunden wird es im konfirmatorischen
            # Eintrag, und dafuer wird der Wert hier gemessen ausgewiesen.
            {"pfad": "scripts/studie-zaehlprobe.py", "art": "datei",
             "sha256": sha256_datei(os.path.join(
                 wurzel, "scripts", "studie-zaehlprobe.py")),
             "eintrag": "zu binden im konfirmatorischen Eintrag (F6-C24)"},
        ],
    }
    pruefe_umschlag(umschlag)

    bericht = {
        "umschlag": umschlag,
        "daten": daten,
        "stempel": {
            "abstandZu329Von365": STEMPEL_329,
            "vorabDeterminiertheit": VORAB_DETERMINIERTHEIT,
            "identitaetA16": getattr(zaehlwerk, "IDENTITAET_A16", None),
            "kriteriumDifferenz": {
                "schluessel": "differenz_punkte",
                "maxDifferenzPunkte": MAX_DIFFERENZ_PUNKTE,
                "quelle": DIFFERENZ_QUELLE,
                # F6-C16: der Stempel "NICHT AUSGEWERTET ... OFFEN" ist
                # ersetzt. Die Frage war eine Methodikfrage und ist vom
                # GERICHT entschieden worden, nicht vom Bauenden still
                # mitentschieden.
                "auswertung": (
                    "AUSGEWERTET als VIERTE KONJUNKTIVE Torbedingung, im "
                    "Laeufer gerechnet und niemals im Bandmodul "
                    "(scripts/studie-vb-b4-band.py bleibt Byte fuer Byte "
                    "unangetastet, F6-B22). Entschieden durch "
                    "_COURT-F6-ZAEHLWERK-2026-09-01, Frage (B), 3:0, "
                    "Auflagen F6-C13/C14/C15/C16 - nicht vom Bauenden."),
                "belege": [
                    "preregistration.json:88 - die 10 Punkte stehen INNERHALB "
                    "des Objekts, das woertlich \"gate\" heisst",
                    "preregistration.json:89 - \"regel\": \"R9 - Pass/Fail, "
                    "nicht Fussnote.\"",
                    "preregistration.json:134 - Wiederholung unter "
                    "primarySuccessCriteria",
                    "preregistration.json:139 - Folge des Reissens: "
                    "INCONCLUSIVE_DATA, kein p-Wert wird berechnet (R9)",
                    "scripts/studie-zaehlprobe.py:529-530 - rechnet es bereits "
                    "als Tor (AMPEL_ROT)",
                    "scripts/studie-e4d-kadenz.py:612-632 - \"Die Regel, "
                    "WOERTLICH wie im Siegel - drei Bedingungen, kein "
                    "Ermessen\"",
                    "protocol/early-detection/2.0.0/e4d-freeze.json:45 - "
                    "\"UNVERAENDERT aus der versiegelten Praeregistrierung "
                    "2.0.0\", \"nicht gesenkt, nicht diskutiert, nicht "
                    "kalibriert\"",
                ],
                "regeltext": TOR_REGELTEXT,
                "richtung": TOR_RICHTUNG,
                "gleichheitBesteht": (
                    "<= 10: exakt 10,0 Punkte reissen NICHT. Keine Rundung vor "
                    "dem Vergleich (Hauskonvention studie-vb-b4-band.py:198-199)."),
                "einheit": ("PUNKTE gegen 10, nie Anteile gegen 0,1 - der "
                            "Laeufer rechnet abs(a_sig - a_kon) * 100.0."),
                "ebene": ("differenz_punkte liegt auf VARIANTEN-Ebene und "
                          "beruehrt die drei zweig-pflichtigen Teilmengen "
                          "NICHT (F6-C19). Ein Arm kennt die Differenz allein "
                          "gar nicht."),
                "unterschluessel": ["wert", "maxDifferenzPunkte", "erfuellt",
                                    "quelle"],
            },
            "zweigPflichtTeilmengen": {
                z: sorted(s) for z, s in ZWEIG_PFLICHT.items()},
            "zweigAnker": ZWEIG_ANKER,
            "panelRandHerkunft": PANEL_RAND_HERKUNFT,
        },
        "protokoll": protokoll,
    }
    # R12a am Schreib-Rand, gegen die Pfade dieses Laufs. Erst hier, damit
    # KEIN Weg daran vorbeifuehrt.
    pruefe_keine_absolutpfade(bericht, {
        os.path.abspath(str(p)) for p in
        [freigabe_pfad, register_pfad, panel_pfad, bericht_pfad,
         zaehlwerk_pfad, wurzel] if p
    } | {str(p) for p in
         [freigabe_pfad, register_pfad, panel_pfad, bericht_pfad,
          zaehlwerk_pfad, wurzel] if p})
    return bericht


def main(argv=None):
    p = argparse.ArgumentParser(
        description="F6-LAUF - der konfirmatorische Laeufer des F6-Tors")
    p.add_argument("--freigabe", required=True,
                   help="Freigabe-Protokoll aus scripts/studie-r1-serverzeit.js")
    p.add_argument("--panel", help="Pfad des Prueffenster-Panels")
    p.add_argument("--bericht", required=True, help="Zieldatei des Berichts")
    p.add_argument("--zaehlwerk", help="Python-Datei mit zaehle(panel, variante, arm)")
    p.add_argument("--arbeit", help="Arbeitsdatei des Zaehlwerks (W-B-geprueft, "
                                    "im Eintrag genannt)")
    p.add_argument("--wurzel", help="Repo-Wurzel (Vorgabe: die dieses Skripts)")
    p.add_argument("--register", help="Zugriffs-Register (Vorgabe: die Hausdatei)")
    a = p.parse_args(argv)

    # Fail-closed bis in die Ausgabe: bei einem Abbruch wird KEIN Bericht
    # geschrieben. Ein halber Bericht wanderte als Ergebnis in die Akte.
    try:
        bericht = lauf(a.freigabe, a.panel, a.bericht, a.zaehlwerk,
                       a.wurzel, a.register, a.arbeit)
    except EntscheidungNoetig as fehler:
        print("F6-LAUF-ENTSCHEIDUNG-NOETIG: " + str(fehler), file=sys.stderr)
        return 2
    except LaufAbbruch as fehler:
        print("F6-LAUF-ABBRUCH: " + str(fehler), file=sys.stderr)
        return 1
    except Exception as fehler:  # noqa: BLE001 - genau das ist der Zweck
        # EINE Ausnahme von der Unterdrueckung: der Abbruch des gebundenen
        # Zaehlwerks. Seine Texte sind HAUSTEXTE aus einem per SHA gebundenen
        # Modul, sie sind auf Kennungsfreiheit geprueft (Waechter in
        # tests/studie-f6-zaehlwerk.test.js), und ohne sie saehe der Bedienende
        # bei einem reinen Konfigurationsfehler nur "interner Fehler der Art
        # ZaehlwerkAbbruch" - eine Meldung, mit der niemand etwas anfangen kann.
        if type(fehler).__name__ == "ZaehlwerkAbbruch":
            print("F6-LAUF-ABBRUCH: das Zaehlwerk hat abgebrochen: "
                  + str(fehler), file=sys.stderr)
            return 1
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

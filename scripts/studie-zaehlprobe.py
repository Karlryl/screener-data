#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""E3 — Die Nur-Zaehlen-Probe (R15b).

WAS HIER BEANTWORTET WIRD
-------------------------
Traegt ein Fenster ueberhaupt genug Faelle, um die praeregistrierte Frage zu
beantworten? Gezaehlt werden Feuerungen, auswertbare Firmen-Quartale, Firmen mit
reifem ERST-Ereignis und die Auffindbarkeit — mehr nicht. Es wird KEIN
Ergebniswert berechnet, kein Wachstum der Folgequartale, keine Persistenz, keine
Firmenliste. Ohne diese Probe faellt eine zu kleine Stichprobe erst NACH der
verbrannten Einmal-Oeffnung auf (Angriff P3).

WARUM DAS UEBERHAUPT ERLAUBT IST
--------------------------------
R15b erlaubt genau eine Sache: Fallzahl und Auffindbarkeitsquote des
Pruef-Fensters, protokolliert im Zugriffs-Register. Die Erlaubnis ist eng, und
dieses Skript macht sie technisch eng: die Ausgabe laeuft gegen eine
eingefrorene Allowlist aus der Praeregistrierung, und jeder Schluessel, der dort
nicht steht, ist ein ABBRUCH — kein Filter, kein Weglassen, kein Warnhinweis.

DIE SPERRZONE DES ENDTEST-FENSTERS
----------------------------------
Karls Wort vom 19.08.2026: "Studien-Endtest ist VERSCHLUESSELT: nicht oeffnen,
keinen Oeffner bauen." Dieses Skript kennt das Endtest-Fenster, prueft seine
Siegel-Wache — und weigert sich dann. Es enthaelt KEINEN
Entschluesselungs-Aufruf. Wer die Sperrzone aufheben will, braucht Karl, nicht
einen Schalter. Die Oeffnung selbst gehoert nach E5 und laeuft ueber das
Oeffnungsprotokoll.

DIE REIHENFOLGE IST DIE METHODIK (R1)
-------------------------------------
Einfrieren -> Push -> Server-Bestaetigung -> Zugriff. Dieses Skript prueft, dass
sie eingehalten wurde, und faengt bei jeder Abweichung an zu schreien:
  * das Manifest muss die Praeregistrierung, dieses Skript und
    `studie-basisraten.py` byte-genau binden (W1),
  * der erste Datenzugriff muss NACH der Serverzeit der Push-Bestaetigung und
    nicht vor der angemeldeten Zugriffszeit liegen (W2),
  * das Endtest-Siegel muss unberuehrt sein und es darf keine Klartext-Kopie
    geben (W4).

RECHEN-GLEICHBEHANDLUNG (R5)
----------------------------
Signal-Arm und Kontrollpool laufen durch EXAKT dieselbe Funktion
(`studie-basisraten.py::erst_ereignisse`) mit exakt derselben Behandlung
fehlender Felder. Genau daran ist die Vorstudie gescheitert: fehlende Werte
wurden in einer Gruppe staerker als "kein Erfolg" gebucht als in der anderen.

WERKZEUGE (R14c)
----------------
Python-Standardbibliothek + sqlite3. Kein numpy noetig.

AUFRUFE
-------
  python scripts/studie-zaehlprobe.py --selbsttest
  python scripts/studie-zaehlprobe.py --gegenprobe
  python scripts/studie-zaehlprobe.py --fenster pruefung --freigabe <datei.json>
"""

import argparse
import hashlib
import importlib.util
import json
import os
import platform
import re
import sqlite3
import sys
from collections import defaultdict
from datetime import date, datetime, timezone

WURZEL = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATENWURZEL_ENV = "EARLY_DETECTION_DATA_ROOT"
PROTOKOLL_DIR = os.path.join(WURZEL, "protocol", "early-detection", "2.0.0")
PRAEREG = os.path.join(PROTOKOLL_DIR, "preregistration.json")
MANIFEST = os.path.join(PROTOKOLL_DIR, "hash-manifest.json")
VERSIEGELUNG = os.path.join(PROTOKOLL_DIR, "endtest-versiegelung.json")
REGISTER = os.path.join(PROTOKOLL_DIR, "outcome-access-ledger.json")
# Muss mit lib/studie-verfassung.js::ART_ZAEHLPROBE uebereinstimmen.
ART_ZAEHLPROBE = "count_only_probe_authorized"
E2_SKRIPT = os.path.join(WURZEL, "scripts", "studie-basisraten.py")
AZ_SKRIPT = os.path.join(WURZEL, "scripts", "studie-panel-aktienzahl.py")

SCHEMA = "early-detection-zaehlprobe/v1"
PROTOKOLL = "FEM-SEC-US@2.0.0"

# Die Fenster-Registry. `datei` ist der AUSGELIEFERTE Dateiname aus
# scripts/studie-panel-bau.py — das Entscheid-Dokument nannte das Prueffenster
# "panel-pruefung.sqlite", gebaut wurde "panel-validierung.sqlite". Der Code
# gewinnt; hier steht die Aufloesung, damit sie nicht geraten wird.
#
# `rand` ist der letzte `accepted`-Tag, den die Panel-Datei traegt (also
# einschliesslich Pufferjahr). `von`/`bis` ist das SIGNALband — ohne Pufferjahr.
FENSTER = {
    "entdeckung": {"datei": "panel-entdeckung.sqlite", "von": 2009, "bis": 2015,
                   "rand": "2016-12-31", "sperrzone": False},
    "pruefung": {"datei": "panel-validierung.sqlite", "von": 2017, "bis": 2019,
                 "rand": "2020-12-31", "sperrzone": False},
    "endtest": {"datei": "panel-endtest.sqlite.enc", "von": 2021, "bis": 2023,
                "rand": "2024-12-31", "sperrzone": True},
}

# Das eingefrorene Perzentil. Es ist das KALIBRIERUNGSERGEBNIS des
# Entdeckungsfensters (E2), kein a priori gesetzter Wert — und ab der
# Praeregistrierung unveraenderlich. Hier wird NICHT nachkalibriert: wer im
# Prueffenster ein besseres Perzentil suchte, passte die Frage ans Ergebnis an.
PERZENTIL = 95

# Reife: vier Folgequartale. Rechts-Zensur auf der `accepted`-Achse, mit der
# UNTEREN Kante des Quartals-Paarungsfensters (80 Tage) — sie erklaert so wenige
# Ereignisse wie moeglich fuer zensiert und haelt die Auffindbarkeit damit so
# niedrig wie moeglich. Konservativ in der Richtung, die R9 verlangt.
REIFE_QUARTALE = 4
ZENSUR_TAGE_JE_QUARTAL = 80

# Die Zaehler, die die Aktienzahl-Bibliothek setzen KANN. Namentlich aufgezaehlt,
# nicht per Praefix durchgewunken: eine Ausgabe-Sperre, die einen ganzen Namensraum
# ungeprueft laesst, ist keine. Wer dort einen Zaehler ergaenzt, muss ihn hier
# nachtragen — und merkt dabei, ob er einen GRUND zaehlt und nicht einen Messwert.
# (Code-Review 19.08., zwei Reviewer unabhaengig.)
AKTIENZAHL_ZAEHLER = (
    "bericht_ohne_accepted", "bericht_ohne_cik", "bericht_ohne_periode",
    "berichte_gesamt", "berichte_nicht_periodisch", "berichte_periodisch",
    "kandidaten_zeilen", "shares_kennungen_firmeneigen", "shares_kennungen_standard",
    "shares_zeilen", "shares_zeilen_firmeneigen", "shares_zeilen_ohne_kennung",
    "shares_zeilen_standard", "verworfen_coreg", "verworfen_firmeneigene_taxonomie",
    "verworfen_kein_gueltiger_bericht", "verworfen_stichtag_unlesbar",
    "verworfen_wert_leer", "verworfen_wert_nicht_positiv", "werte_fassungskonflikt",
    "werte_pit", "werte_spaetere_fassung",
)

AUFFINDBARKEIT_MIN = 0.90
AUFFINDBARKEIT_MAX_DIFFERENZ = 0.10
FALLZAHL_MIN = 200

AMPEL_GRUEN = "GRUEN"
AMPEL_ROT = "INCONCLUSIVE_DATA"

# Alles, was nach einem FREMDEN Fenster oder nach Schluesselmaterial aussieht.
# Die Menge wird je Lauf aus dem freigegebenen Fenster gebildet: wer "pruefung"
# angemeldet hat, kommt an "entdeckung" genauso wenig heran wie an den Endtest.
SCHLUESSEL_RE = re.compile(r"schl(?:ue|ü)ssel|\.key$|\.enc$", re.IGNORECASE)
FENSTER_WORTE = {
    "entdeckung": ("entdeckung",),
    "pruefung": ("validierung", "pruefung", "prüfung"),
    "endtest": ("endtest",),
}

GEOEFFNETE_PFADE = []
GESCHRIEBENE_PFADE = []


class ProbeFehler(Exception):
    """Ein Befund, der den Lauf anhaelt — nie ein stiller Rueckfall."""


# ── Pfade und Mauer ──────────────────────────────────────────────────────────

def kurzpfad(voll):
    """Elternverzeichnis + Dateiname — genug zum Unterscheiden, ohne die
    Benutzerkennung des Rechners in den Report zu schreiben (R12a)."""
    return (os.path.basename(os.path.dirname(voll)) + "/" + os.path.basename(voll))


def datenwurzel(vorgabe=None):
    wert = vorgabe or os.environ.get(DATENWURZEL_ENV)
    if not wert:
        raise ProbeFehler(
            "Speicherort unbekannt: " + DATENWURZEL_ENV + " ist nicht gesetzt "
            "(R12a verbietet einen fest verdrahteten Pfad)")
    return wert


def pruefe_mauer(pfad, freigegeben):
    """R2: Darf dieser Pfad angefasst werden?

    Geprueft werden BEIDE Formen: der aufgeloeste Pfad (`realpath` folgt
    Symlinks und NTFS-Junctions) faengt die Umleitung, der geschriebene faengt
    den Fall, dass das Ziel noch nicht existiert. Ein Treffer ist ein ABBRUCH,
    kein Filter — ein Filter waere ein Versprechen.

    GRENZE, hier benannt statt versteckt (Code-Review 19.08.): `realpath` loest
    KEINE Hardlinks auf. Ein hartverknuepfter Klon der versiegelten Datei unter
    neutralem Namen liefe an dieser Mauer vorbei. Die eigentliche Byte-Schranke ist
    deshalb `siegel_wache` (Groesse + SHA-256), nicht diese Namenspruefung. Und die
    Wortsuche ist eine Teilstring-Suche: ein Ordner "entdeckungsteam" loest den
    Abbruch mit aus. Das ist die fail-closed-Richtung und bleibt so."""
    geschrieben = os.path.abspath(pfad)
    aufgeloest = os.path.realpath(geschrieben)
    verboten = []
    for name, worte in FENSTER_WORTE.items():
        if name != freigegeben:
            verboten.extend(worte)
    for form in (geschrieben, aufgeloest):
        flach = form.replace(os.sep, "/")
        if SCHLUESSEL_RE.search(flach):
            raise ProbeFehler(
                "R2-ABBRUCH: '" + pfad + "' (aufgeloest: '" + aufgeloest
                + "') sieht nach Schluesselmaterial oder einer versiegelten "
                "Datei aus. Die Zaehlprobe fasst weder Schluessel noch Siegel an.")
        for wort in verboten:
            if re.search(r"[/\\]?[a-z0-9._-]*" + re.escape(wort), flach, re.IGNORECASE):
                raise ProbeFehler(
                    "R2-ABBRUCH: '" + pfad + "' (aufgeloest: '" + aufgeloest
                    + "') fuehrt zu einem Fenster, das dieser Lauf nicht "
                    "angemeldet hat. Freigegeben ist ausschliesslich '"
                    + str(freigegeben) + "'. Wer vorher in ein fremdes Fenster "
                    "sieht, macht das Studienergebnis wertlos.")
    return aufgeloest


def oeffne_nur_lesend(pfad, freigegeben):
    voll = pruefe_mauer(pfad, freigegeben)
    if not os.path.isfile(voll):
        raise ProbeFehler("Panel-Datei nicht gefunden: " + voll)
    if kurzpfad(voll) not in GEOEFFNETE_PFADE:
        GEOEFFNETE_PFADE.append(kurzpfad(voll))
    conn = sqlite3.connect("file:" + voll.replace("\\", "/") + "?mode=ro", uri=True)
    conn.execute("PRAGMA cache_size=-200000")
    return conn


def zeitstempel():
    # EIN Aufruf, nicht zwei: zwischen zwei `now()` kann eine Sekundengrenze liegen,
    # und dann traegt der Zeitstempel die Sekunde des einen und die Millisekunde des
    # anderen Moments. Genau diese Funktion erzeugt `ersterZugriffAm`.
    jetzt = datetime.now(timezone.utc)
    return jetzt.strftime("%Y-%m-%dT%H:%M:%S.") + "%03dZ" % (jetzt.microsecond // 1000)


def sha256_datei(pfad, block=1 << 22):
    h = hashlib.sha256()
    with open(pfad, "rb") as f:
        while True:
            stueck = f.read(block)
            if not stueck:
                break
            h.update(stueck)
    return h.hexdigest()


# ── W1: Freeze-Siegel ────────────────────────────────────────────────────────

def pruefe_manifest(manifest_pfad=MANIFEST):
    """Die Praeregistrierung, dieses Skript und studie-basisraten.py muessen
    byte-genau die im Manifest gebundenen Dateien sein.

    Ein Manifest, das eine Datei NICHT fuehrt, ist genauso rot wie ein falscher
    Hash: sonst liesse sich eine Bindung durch Weglassen aufheben."""
    if not os.path.isfile(manifest_pfad):
        raise ProbeFehler(
            "W1-ABBRUCH: kein hash-manifest.json. Ohne Siegel ist nicht "
            "entscheidbar, ob die Frage vor dem Zugriff eingefroren war.")
    with open(manifest_pfad, encoding="utf-8") as f:
        manifest = json.load(f)
    dateien = manifest.get("files") or {}
    pflicht = ("protocol/early-detection/2.0.0/preregistration.json",
               "scripts/studie-zaehlprobe.py",
               "scripts/studie-basisraten.py")
    fehlend = [p for p in pflicht if p not in dateien]
    if fehlend:
        raise ProbeFehler(
            "W1-ABBRUCH: das Manifest bindet " + ", ".join(fehlend)
            + " nicht. Eine Bindung, die sich durch Weglassen aufheben laesst, "
            "ist keine.")
    geprueft = {}
    for rel, soll in sorted(dateien.items()):
        voll = os.path.join(WURZEL, *rel.split("/"))
        if not os.path.isfile(voll):
            raise ProbeFehler("W1-ABBRUCH: gebundene Datei fehlt: " + rel)
        ist = sha256_datei(voll)
        if ist != soll:
            raise ProbeFehler(
                "W1-ABBRUCH: " + rel + " weicht vom Siegel ab (ist " + ist[:16]
                + "..., soll " + soll[:16] + "...). Die eingefrorene Frage ist "
                "nach dem Siegel veraendert worden — der Lauf ist wertlos.")
        geprueft[rel] = ist
    return geprueft


def lies_praeregistrierung(pfad=PRAEREG):
    with open(pfad, encoding="utf-8") as f:
        praereg = json.load(f)
    zp = praereg.get("zaehlprobe") or {}
    if (not zp.get("ausgabeAllowlist") or not zp.get("umschlagAllowlist")
            or not zp.get("ampelWerte")):
        raise ProbeFehler(
            "W3-ABBRUCH: die Praeregistrierung fuehrt keine Ausgabe-Allowlist. "
            "Ohne sie ist jede Ausgabe unbegrenzt — fail-closed.")
    return praereg


# ── W2: Serverzeit ───────────────────────────────────────────────────────────

def lies_freigabe(pfad, fenster):
    """Das Freigabe-Protokoll aus scripts/studie-r1-serverzeit.js.

    Es traegt die Serverzeit der Push-Bestaetigung. Ohne diese Datei laeuft die
    Probe NICHT — ein Zaehllauf ohne bestaetigte Vorab-Anmeldung ist wertlos und
    beschaedigt die Studie."""
    if not pfad or not os.path.isfile(pfad):
        raise ProbeFehler(
            "W2-ABBRUCH: kein Freigabe-Protokoll (" + str(pfad) + "). Die "
            "Reihenfolge Einfrieren -> Push -> Serverbestaetigung -> Zugriff IST "
            "die Methodik; ohne Server-Bestaetigung gibt es keinen Zugriff.")
    with open(pfad, encoding="utf-8") as f:
        freigabe = json.load(f)
    for feld in ("runId", "fenster", "serverConfirmedAt", "accessedAt", "registerEventHash"):
        if not freigabe.get(feld):
            raise ProbeFehler("W2-ABBRUCH: Freigabe ohne Feld '" + feld + "'")
    if freigabe["fenster"] != fenster:
        raise ProbeFehler(
            "W2-ABBRUCH: angemeldet ist Fenster '" + str(freigabe["fenster"])
            + "', gestartet wurde '" + str(fenster) + "'.")
    pruefe_freigabe_gegen_register(freigabe)
    return freigabe


def pruefe_freigabe_gegen_register(freigabe, register_pfad=REGISTER):
    """Die Freigabe-Datei ist eine LOKALE Datei — sie beweist fuer sich genommen
    nichts (Code-Review 19.08.). Also wird sie gegen das Zugriffs-Register gehalten:
    runId, Eintragsart, Fenster, Zugriffszeit und Eintrags-Hash muessen passen.

    Was das NICHT leistet: den Beweis, dass der Eintrag auf origin liegt. Den fuehrt
    scripts/studie-r1-serverzeit.js gegen die GitHub-API. Was es leistet: eine frei
    erfundene oder veraltete Freigabe-Datei faellt auf."""
    if not os.path.isfile(register_pfad):
        raise ProbeFehler("W2-ABBRUCH: Zugriffs-Register nicht gefunden: "
                          + kurzpfad(register_pfad))
    with open(register_pfad, encoding="utf-8") as f:
        register = json.load(f)
    treffer = [e for e in (register.get("events") or [])
               if e.get("runId") == freigabe["runId"]]
    if len(treffer) != 1:
        raise ProbeFehler(
            "W2-ABBRUCH: runId " + repr(freigabe["runId"]) + " steht "
            + str(len(treffer)) + "-mal im Zugriffs-Register. Genau einmal ist "
            "richtig — alles andere heisst, die Freigabe gehoert nicht zu diesem "
            "Register.")
    eintrag = treffer[0]
    if (eintrag.get("typ") or eintrag.get("type")) != ART_ZAEHLPROBE:
        raise ProbeFehler(
            "W2-ABBRUCH: Eintrag " + repr(freigabe["runId"]) + " ist keine "
            "Zaehlproben-Anmeldung (" + str(eintrag.get("typ")) + ").")
    if eintrag.get("eventHash") != freigabe["registerEventHash"]:
        raise ProbeFehler(
            "W2-ABBRUCH: der Eintrags-Hash der Freigabe passt nicht zum Register — "
            "die Freigabe-Datei gehoert zu einem anderen Registerstand.")
    if freigabe["accessedAt"] != eintrag.get("accessedAt"):
        raise ProbeFehler(
            "W2-ABBRUCH: die angemeldete Zugriffszeit der Freigabe ("
            + str(freigabe["accessedAt"]) + ") weicht vom Register ab ("
            + str(eintrag.get("accessedAt")) + ").")
    if (eintrag.get("fenster") or [None])[0] != freigabe["fenster"]:
        raise ProbeFehler(
            "W2-ABBRUCH: das Fenster der Freigabe passt nicht zum Register-Eintrag.")
    return True


def _parse_zeit(text, feld):
    roh = str(text).strip()
    if roh.endswith("Z"):
        roh = roh[:-1] + "+00:00"
    try:
        wert = datetime.fromisoformat(roh)
    except ValueError:
        raise ProbeFehler("W2-ABBRUCH: unlesbarer Zeitstempel in '" + feld
                          + "': " + str(text))
    if wert.tzinfo is None:
        raise ProbeFehler(
            "W2-ABBRUCH: '" + feld + "' traegt keine Zeitzone (" + str(text)
            + "). Ein Vergleich zwischen Serveruhr und lokaler Uhr ohne Zeitzone "
            "ist keine Pruefung, sondern ein Zufall.")
    return wert


def pruefe_serverzeit(freigabe, erster_zugriff):
    """R1: Der erste Datenzugriff muss NACH der Server-Bestaetigung und nicht vor
    der angemeldeten Zugriffszeit liegen. Verglichen wird die SERVER-Zeit."""
    server = _parse_zeit(freigabe["serverConfirmedAt"], "serverConfirmedAt")
    geplant = _parse_zeit(freigabe["accessedAt"], "accessedAt")
    zugriff = _parse_zeit(erster_zugriff, "ersterZugriffAm")
    if not zugriff > server:
        raise ProbeFehler(
            "W2-ABBRUCH: Erstzugriff " + erster_zugriff + " liegt nicht NACH der "
            "Server-Bestaetigung " + freigabe["serverConfirmedAt"] + ". Die "
            "Vorab-Anmeldung war zum Zeitpunkt des Zugriffs nicht nachweislich "
            "auf origin — der Lauf haette spicken koennen.")
    if zugriff < geplant:
        raise ProbeFehler(
            "W2-ABBRUCH: Erstzugriff " + erster_zugriff + " liegt VOR der "
            "angemeldeten Zugriffszeit " + freigabe["accessedAt"] + ".")
    return True


# ── W4: Klartext- und Siegel-Wache ───────────────────────────────────────────

def schluessel_fingerabdruck_stimmt(schluessel_bytes, erwartet):
    """Vergleicht den Fingerabdruck von Schluessel-ROHBYTES mit dem Siegel-Wert.

    ABSICHTLICH NICHT im Lauf benutzt: Karls Sperrzone verbietet jeden
    Schluesselzugriff. Die Funktion existiert, damit die Pruefung fuer die
    Einmal-Oeffnung (E5) fertig und einmal getestet ist — der Aufrufer ist dort,
    nicht hier."""
    return hashlib.sha256(schluessel_bytes).hexdigest() == erwartet


def siegel_wache(wurzel, versiegelung_pfad=VERSIEGELUNG, voll=True):
    """Zwei Fragen, beide fail-closed:
      (a) Liegt irgendwo unter der Datenwurzel eine KLARTEXT-Kopie des
          Endtest-Panels? Dann ist die Versiegelung nur noch Dekoration.
      (b) Traegt die Siegeldatei noch genau die Bytes, die das Siegel nennt?

    Der Schluessel wird NICHT angefasst. Die Wache beweist, dass dieser Lauf das
    Endtest-Fenster nicht beruehrt hat — sie ist kein Oeffner."""
    with open(versiegelung_pfad, encoding="utf-8") as f:
        siegel = json.load(f)
    klartext_name = siegel["klartextDatei"]
    siegel_name = siegel["siegelDatei"]
    gefunden = []
    siegel_datei = None
    # EIN Durchlauf fuer beide Fragen. Zwei getrennte os.walk kosteten den Baum
    # zweimal, ohne mehr zu pruefen. Arbeits- und Worktree-Verzeichnisse sind keine
    # Datenablage; ein Lauf ueber ein Git-Verzeichnis kostet Minuten und findet nichts.
    for ordner, unterordner, dateien in os.walk(wurzel):
        unterordner[:] = [u for u in unterordner if u not in (".git", "worktrees")]
        if klartext_name in dateien:
            gefunden.append(os.path.join(ordner, klartext_name))
        if siegel_datei is None and siegel_name in dateien:
            siegel_datei = os.path.join(ordner, siegel_name)
    if gefunden:
        raise ProbeFehler(
            "W4-ABBRUCH: es liegt eine KLARTEXT-Kopie des Endtest-Panels auf der "
            "Platte (" + kurzpfad(gefunden[0]) + "). Die Versiegelung ist damit "
            "wirkungslos; der Lauf haelt an, bis das geklaert ist.")
    if siegel_datei is None:
        raise ProbeFehler(
            "W4-ABBRUCH: die Siegeldatei " + siegel_name + " ist nicht auffindbar. "
            "Ein verschwundenes Siegel ist kein bestandener Test.")
    ergebnis = {"klartextKopie": False, "siegelDatei": kurzpfad(siegel_datei),
                "bytes": os.path.getsize(siegel_datei)}
    if ergebnis["bytes"] != siegel["bytesSiegel"]:
        raise ProbeFehler(
            "W4-ABBRUCH: die Siegeldatei hat " + str(ergebnis["bytes"])
            + " Bytes statt " + str(siegel["bytesSiegel"]) + ".")
    if voll:
        ist = sha256_datei(siegel_datei)
        if ist != siegel["sha256Siegel"]:
            raise ProbeFehler(
                "W4-ABBRUCH: die Siegeldatei ist veraendert worden (sha256 "
                + ist[:16] + "... statt " + siegel["sha256Siegel"][:16] + "...).")
        ergebnis["sha256Geprueft"] = True
    else:
        ergebnis["sha256Geprueft"] = False
    ergebnis["schluesselAngefasst"] = False
    return ergebnis


# ── Die Zaehlung ─────────────────────────────────────────────────────────────

def lade_modul(pfad, name):
    spec = importlib.util.spec_from_file_location(name, pfad)
    if spec is None or spec.loader is None:
        raise ProbeFehler("Skript nicht ladbar: " + kurzpfad(pfad))
    modul = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(modul)
    return modul


def im_signalband(eintrag, e2, von, bis):
    jahr = e2.jahr_aus_accepted(eintrag["accepted"])
    return jahr is not None and von <= jahr <= bis


def ist_zensiert(eintrag, e2, rand_ordinal):
    """Rechts-Zensur auf der `accepted`-Achse — der Achse, an der die
    Panel-Dateien wirklich geschnitten sind (scripts/studie-panel-bau.py)."""
    tag = str(eintrag["accepted"])[:10].replace("-", "")
    o = e2.ordinal(tag)
    if o is None:
        # R5: kein Zeitstempel heisst NICHT BERECHENBAR — und das heisst ANHALTEN,
        # nicht "gilt als nicht zensiert". Der Pfad ist mit heutigem Code tot
        # (studie-basisraten.py::lade_berichte bricht schon bei krummem Format ab),
        # aber eine Funktion, die still weiterrechnet, ist nicht fail-closed.
        raise ProbeFehler(
            "R5-ABBRUCH: Erst-Ereignis mit unlesbarem Zeitstempel ("
            + repr(eintrag.get("accepted")) + ") — die Zensur ist damit NICHT "
            "BERECHENBAR und wird nicht geraten.")
    return o + REIFE_QUARTALE * ZENSUR_TAGE_JE_QUARTAL > rand_ordinal


def arm_zaehlen(eintraege, gewaehlt, e2, rand_ordinal):
    """EIN Arm — Signal oder Kontrolle, derselbe Code, dieselbe Fehlbehandlung.

    Rueckgabe: (firmen_mit_erst_ereignis, zensiert, fallzahl, auffindbarkeit)."""
    reif, unreif = e2.erst_ereignisse(eintraege, gewaehlt)
    alle_erste = reif + unreif
    fallzahl = len(set(e["cik"] for e in reif))
    # R3-Waechter: die Fallzahl ist eine FIRMEN-Zahl. Faellt sie je von der Zahl
    # der reifen Erst-Ereignisse ab, zaehlt jemand Ereignisse als Stichprobe.
    if fallzahl != len(reif):
        raise ProbeFehler(
            "R3-ABBRUCH: " + str(len(reif)) + " reife Erst-Ereignisse gegen "
            + str(fallzahl) + " verschiedene Firmen. Eine Firma zaehlt nur mit "
            "ihrem fruehesten Ereignis; wer Ereignisse zaehlt, verwechselt "
            "Dichte mit Stichprobe.")
    if len(set(e["cik"] for e in alle_erste)) != len(alle_erste):
        raise ProbeFehler(
            "R3-ABBRUCH: eine Firma traegt mehr als ein Erst-Ereignis.")
    zensiert = sum(1 for e in alle_erste if ist_zensiert(e, e2, rand_ordinal))
    nenner = len(alle_erste) - zensiert
    auffindbarkeit = (len(reif) / nenner) if nenner > 0 else None
    return {"firmen_mit_erst_ereignis": len(alle_erste),
            "zensierte_erst_ereignisse": zensiert,
            "fallzahl": fallzahl,
            "auffindbarkeit": auffindbarkeit,
            "reif": reif}


def ampel_fuer(fallzahl, auffindbarkeit, kontroll_auffindbarkeit):
    """Ein Wort, kein Aufsatz. Die Gruende stehen im Report, nicht im Feld —
    die Ausgabe-Allowlist laesst nur dieses eine Feld zu."""
    if fallzahl < FALLZAHL_MIN:
        return AMPEL_ROT
    if auffindbarkeit is None or auffindbarkeit < AUFFINDBARKEIT_MIN:
        return AMPEL_ROT
    if kontroll_auffindbarkeit is None or kontroll_auffindbarkeit < AUFFINDBARKEIT_MIN:
        return AMPEL_ROT
    if abs(auffindbarkeit - kontroll_auffindbarkeit) > AUFFINDBARKEIT_MAX_DIFFERENZ:
        return AMPEL_ROT
    return AMPEL_GRUEN


def zaehle_fenster(panel, arbeit_pfad, e2, az, fenster, freigegeben, mit_aktienzahl=True):
    """Die eigentliche Probe. Berechnet EXISTENZ, nie einen Ergebniswert."""
    zaehler = defaultdict(int)
    for name in e2.alle_zaehlernamen():
        zaehler[name] += 0
    berichte, _firmen_jahr, _quartale, _fye = e2.lade_berichte(panel, zaehler)
    arbeit = e2.oeffne_zwischenstand(arbeit_pfad, True)
    try:
        zaehler["roh_zeilen"] = e2.lies_rohwerte(panel, arbeit, berichte, zaehler, False)
        je_firma = e2.pit_reduktion(arbeit, zaehler)
    finally:
        arbeit.close()
    if kurzpfad(os.path.abspath(arbeit_pfad)) not in GESCHRIEBENE_PFADE:
        GESCHRIEBENE_PFADE.append(kurzpfad(os.path.abspath(arbeit_pfad)))

    rand_ordinal = e2.ordinal(fenster["rand"].replace("-", ""))
    varianten = {}
    reife_je_variante = {}
    gewaehlt_je_variante = {}
    # Dieselbe Reihenfolge wie studie-basisraten.py::auswertung — gelesen, nicht
    # geraten. `nur_positiv` unterscheidet sich zwischen den Familien.
    familien = (("S-U", e2.UMSATZ_QUELLEN, True, "umsatz_"),
                ("S-G", e2.ERGEBNIS_QUELLEN, False, "betriebsergebnis_"))
    for name, quellen, nur_positiv, praefix in familien:
        alle, gewaehlt = e2.firmenreihen(je_firma, quellen, nur_positiv, zaehler, praefix)
        _g, a_saetze = e2.wachstum_und_beschleunigung(alle, zaehler, praefix)
        feuerungen, auswertbar, _grenzen = e2.signale(a_saetze, PERZENTIL, zaehler, praefix)
        band_f = [f for f in feuerungen if im_signalband(f, e2, fenster["von"], fenster["bis"])]
        band_a = [a for a in auswertbar if im_signalband(a, e2, fenster["von"], fenster["bis"])]

        signal = arm_zaehlen(band_f, gewaehlt, e2, rand_ordinal)
        # Kontrollpool: Firmen mit auswertbarem Firmen-Quartal im Signalband, die
        # NIE feuern (R3). Referenz ist ihr fruehestes auswertbares Quartal — das
        # strukturelle Gegenstueck zum Erst-Ereignis. Danach derselbe Code.
        signalfirmen = set(f["cik"] for f in band_f)
        kontroll_eintraege = [a for a in band_a if a["cik"] not in signalfirmen]
        kontrolle = arm_zaehlen(kontroll_eintraege, gewaehlt, e2, rand_ordinal)

        varianten[name] = {
            "feuerungen": len(band_f),
            "auswertbare_firmen_quartale": len(band_a),
            "feuerrate": (len(band_f) / len(band_a)) if band_a else None,
            "firmen_mit_erst_ereignis": signal["firmen_mit_erst_ereignis"],
            "zensierte_erst_ereignisse": signal["zensierte_erst_ereignisse"],
            "fallzahl": signal["fallzahl"],
            "auffindbarkeit": signal["auffindbarkeit"],
            "fallzahl_mit_aktienzahl_nenner": None,
            "kontrollpool_firmen": kontrolle["firmen_mit_erst_ereignis"],
            "kontrollpool_auffindbarkeit": kontrolle["auffindbarkeit"],
            "ampel": ampel_fuer(signal["fallzahl"], signal["auffindbarkeit"],
                                kontrolle["auffindbarkeit"]),
        }
        reife_je_variante[name] = signal["reif"]
        gewaehlt_je_variante[name] = gewaehlt

    if mit_aktienzahl:
        az_zaehler = defaultdict(int)
        az_berichte, _f, _fj = az.lies_berichte(panel, az_zaehler)
        je_firma_aktien = az.lies_werte(panel, az_berichte, az_zaehler)
        for name in varianten:
            deckung = az.abdeckung_der_e2_firmen(
                reife_je_variante[name], gewaehlt_je_variante[name], je_firma_aktien)
            varianten[name]["fallzahl_mit_aktienzahl_nenner"] = \
                deckung["UNION-sofort"]["firmen_ereignisfenster_gedeckt"]
        for schluessel, wert in az_zaehler.items():
            zaehler["aktienzahl_" + schluessel] = wert
    return varianten, dict(zaehler)


# ── W3: Ausgabe-Allowlist ────────────────────────────────────────────────────

def pruefe_ausgabe(ausgabe, praereg, e2):
    """Jeder nicht gelistete Schluessel ist ein ABBRUCH.

    Geprueft werden BEIDE Ebenen: der Umschlag und die Variantenbloecke. Und in
    beide Richtungen — ein fehlendes Pflichtfeld ist genauso rot wie ein
    zusaetzliches, sonst liesse sich die Ampel durch Weglassen entschaerfen."""
    zp = praereg["zaehlprobe"]
    umschlag = set(zp["umschlagAllowlist"])
    felder = set(zp["ausgabeAllowlist"])
    ampelwerte = set(zp["ampelWerte"])

    fremd = sorted(set(ausgabe) - umschlag)
    if fremd:
        raise ProbeFehler(
            "W3-ABBRUCH: der Umschlag traegt nicht gelistete Schluessel: "
            + ", ".join(fremd) + ". Die Nur-Zaehlen-Probe darf ausschliesslich "
            "ausgeben, was die Praeregistrierung erlaubt.")
    fehlend = sorted(umschlag - set(ausgabe))
    if fehlend:
        raise ProbeFehler(
            "W3-ABBRUCH: dem Umschlag fehlen Pflichtfelder: " + ", ".join(fehlend))

    erlaubte_zaehler = set(e2.alle_zaehlernamen())
    erlaubte_zaehler |= set("aktienzahl_" + n for n in AKTIENZAHL_ZAEHLER)
    for schluessel in ausgabe.get("zaehler", {}):
        if schluessel not in erlaubte_zaehler:
            raise ProbeFehler(
                "W3-ABBRUCH: unbekannter Zaehler '" + schluessel + "'. Die "
                "Zaehler sind Gruende, keine Messwerte — ein unbekannter Name "
                "koennte ein durchgereichter Wert sein.")

    # Ein leerer Variantenblock haette die Pruefung bestanden — eine Ausgabe ohne
    # Ergebnis-Kern waere durchgegangen. Erwartet werden genau die konfirmatorischen
    # Varianten der Praeregistrierung.
    erwartet = sorted(v["name"] for v in praereg["signalFamily"]["varianten"]
                      if v.get("status") == "konfirmatorisch")
    vorhanden = sorted((ausgabe.get("varianten") or {}))
    if vorhanden != erwartet:
        raise ProbeFehler(
            "W3-ABBRUCH: die Ausgabe fuehrt die Varianten " + str(vorhanden)
            + ", praeregistriert sind " + str(erwartet) + ".")
    for name, block in (ausgabe.get("varianten") or {}).items():
        fremd = sorted(set(block) - felder)
        if fremd:
            raise ProbeFehler(
                "W3-ABBRUCH: Variante " + name + " gibt nicht gelistete Groessen "
                "aus: " + ", ".join(fremd) + ". Genau das ist die Ergebnis-Sperre "
                "(R4) — ein Wert, der versehentlich in den Output leckt, macht "
                "die ganze Studie wertlos.")
        fehlend = sorted(felder - set(block))
        if fehlend:
            raise ProbeFehler(
                "W3-ABBRUCH: Variante " + name + " fehlen Pflichtgroessen: "
                + ", ".join(fehlend))
        if block["ampel"] not in ampelwerte:
            raise ProbeFehler(
                "W3-ABBRUCH: Variante " + name + " meldet die unbekannte Ampel '"
                + str(block["ampel"]) + "'.")
    return True


# ── Lauf ─────────────────────────────────────────────────────────────────────

def lauf(fenster_name, freigabe_pfad, data_root=None, arbeit=None, ziel=None,
         siegel_voll=True, manifest_pfad=MANIFEST, praereg_pfad=PRAEREG,
         versiegelung_pfad=VERSIEGELUNG, panel_pfad=None, mit_aktienzahl=True):
    fenster = FENSTER.get(fenster_name)
    if fenster is None:
        raise ProbeFehler("Unbekanntes Fenster: " + str(fenster_name)
                          + " (erlaubt: " + ", ".join(sorted(FENSTER)) + ")")
    if fenster["sperrzone"]:
        # BEWUSSTE AUSNAHME von der Reihenfolge R1 (Code-Review 19.08. hat sie zu
        # Recht angesprochen): Fuer ein Sperrzonen-Fenster wird WEDER Manifest noch
        # Freigabe noch Serverzeit geprueft — die Weigerung haengt an Karls Wort und
        # darf nicht davon abhaengen, ob jemand eine Anmeldung vorlegt. Angefasst
        # werden dabei ausschliesslich Dateinamen sowie Groesse und SHA-256 der
        # bereits VERSCHLUESSELTEN Datei; kein Klartext, kein Schluessel.
        # Die Siegel-Wache laeuft trotzdem — sie beweist, dass das Fenster
        # unberuehrt ist. Danach ist Schluss. Es gibt in dieser Datei keinen
        # Entschluesselungs-Aufruf, und es soll auch keiner hinein.
        wurzel = datenwurzel(data_root)
        wache = siegel_wache(wurzel, versiegelung_pfad, voll=siegel_voll)
        raise ProbeFehler(
            "SPERRZONE-STOPP: Fenster '" + fenster_name + "' wird nicht geoeffnet. "
            "Karls Wort vom 19.08.2026: 'Studien-Endtest ist VERSCHLUESSELT: nicht "
            "oeffnen, keinen Oeffner bauen.' Die Siegel-Wache ist gelaufen und "
            "gruen (Siegel " + str(wache["bytes"]) + " Bytes, Schluessel "
            "unberuehrt). Die Freigabe eines Endtest-Zaehllaufs ist keine "
            "Methodik-Frage, sondern eine Sperrzonen-Freigabe — und die trifft "
            "Karl, nicht dieses Skript.")

    # Die Beobachtungs-Listen gehoeren DIESEM Lauf. Als Prozess-Globals sammelten sie
    # ueber mehrere Laeufe hinweg — und `gelesenePfade` ist genau das Feld, das
    # beweisen soll, was DIESER Lauf angefasst hat (R4). Ein Audit-Feld, das den
    # Vorgaenger mitschleppt, ist schlimmer als keines.
    del GEOEFFNETE_PFADE[:]
    del GESCHRIEBENE_PFADE[:]

    manifest = pruefe_manifest(manifest_pfad)
    praereg = lies_praeregistrierung(praereg_pfad)
    freigabe = lies_freigabe(freigabe_pfad, fenster_name)
    wurzel = datenwurzel(data_root)

    # ERSTZUGRIFF ist der Moment, in dem dieser Lauf zum ersten Mal IRGENDETWAS unter
    # der Datenwurzel anfasst — und das ist schon die Siegel-Wache, nicht erst das
    # Panel. Die erste Fassung stempelte erst vor dem Panel-Oeffnen; damit haette ein
    # Lauf vor der Server-Bestaetigung ueber die Datenwurzel laufen koennen und der
    # Zeitstempel haette es nicht gezeigt.
    erster_zugriff = zeitstempel()
    pruefe_serverzeit(freigabe, erster_zugriff)

    wache = siegel_wache(wurzel, versiegelung_pfad, voll=siegel_voll)
    if panel_pfad is None:
        panel_pfad = os.path.join(wurzel, "panel", fenster["datei"])
    arbeit_pfad = arbeit or os.path.join(wurzel, "arbeit", "E3-zwischenstand.sqlite")

    e2 = lade_modul(E2_SKRIPT, "studie_basisraten")
    az = lade_modul(AZ_SKRIPT, "studie_panel_aktienzahl")
    panel = oeffne_nur_lesend(panel_pfad, fenster_name)
    try:
        varianten, zaehler = zaehle_fenster(panel, arbeit_pfad, e2, az, fenster,
                                            fenster_name, mit_aktienzahl)
    finally:
        panel.close()

    ausgabe = {
        "schema": SCHEMA,
        "protokoll": PROTOKOLL,
        "runId": freigabe["runId"],
        "fenster": fenster_name,
        "fensterVon": fenster["von"],
        "fensterBis": fenster["bis"],
        "panelRand": fenster["rand"],
        "perzentil": PERZENTIL,
        "serverConfirmedAt": freigabe["serverConfirmedAt"],
        "accessedAt": freigabe["accessedAt"],
        "ersterZugriffAm": erster_zugriff,
        "beendetAm": zeitstempel(),
        "gelesenePfade": sorted(GEOEFFNETE_PFADE),
        "geschriebenePfade": sorted(GESCHRIEBENE_PFADE),
        "ergebnisdatenBeruehrt": False,
        "siegelWache": wache,
        "manifestGeprueft": sorted(manifest),
        "umgebung": {"plattform": sys.platform, "python": platform.python_version(),
                     "sqlite": sqlite3.sqlite_version},
        "zaehler": zaehler,
        "varianten": varianten,
    }
    pruefe_ausgabe(ausgabe, praereg, e2)
    if ziel:
        os.makedirs(os.path.dirname(os.path.abspath(ziel)), exist_ok=True)
        with open(ziel, "w", encoding="utf-8", newline="\n") as f:
            json.dump(ausgabe, f, ensure_ascii=False, indent=1, sort_keys=True)
            f.write("\n")
    return ausgabe


# ── Selbsttest ───────────────────────────────────────────────────────────────

FEHLER = []


def pruefe(name, bedingung, ist=None, soll=None):
    if bedingung:
        print("  ok    " + name)
    else:
        FEHLER.append(name)
        print("  ROT   " + name)
        if ist is not None or soll is not None:
            print("        (ist: %r | soll: %r)" % (ist, soll))


QUARTALE = [(j, m) for j in range(2015, 2020) for m in (3, 6, 9, 12)]
MARKER_WERT = 0.777


def _quartalsende(index):
    jahr, monat = QUARTALE[index]
    tag = 31 if monat in (3, 12) else 30
    return "%04d%02d%02d" % (jahr, monat, tag)


def baue_probe_fixture(pfad, signal_firmen, hintergrund=260, doppel=False,
                       marker=False, aktien=True):
    """Panel-Fixture mit von Hand nachgerechneten Erwartungswerten.

    Der Aufbau traegt die Unterschiede, auf die es ankommt — das ist die Lehre
    vom 19.08.: drei Sabotagen blieben gruen, weil das Fixture den Unterschied
    gar nicht zeigen konnte.
      * `signal_firmen` Firmen feuern GENAU EINMAL (Quartal 12) und sind reif.
      * `doppel` gibt EINER Firma ein ZWEITES reifes Ereignis (Quartal 15) —
        ohne diesen Fall kann eine ausgebaute R3-Reduktion nicht auffliegen.
      * `marker` legt in ein FOLGEQUARTAL den Wert 0.777. Taucht er in der
        Ausgabe auf, ist ein Ergebniswert geleckt.
      * Die Hintergrundfirmen wachsen konstant (a = 0). Sie feuern nie, tragen
        aber die 200 Werte, ohne die es keine Schwelle gibt.
    """
    if os.path.isfile(pfad):
        os.remove(pfad)
    os.makedirs(os.path.dirname(os.path.abspath(pfad)), exist_ok=True)
    conn = sqlite3.connect(pfad, isolation_level=None)
    conn.execute("CREATE TABLE bericht (adsh TEXT PRIMARY KEY, cik TEXT, name TEXT,"
                 " sic TEXT, fye TEXT, form TEXT, period TEXT, accepted TEXT)")
    conn.execute("CREATE TABLE fakt (adsh TEXT, tag TEXT, version TEXT, coreg TEXT,"
                 " ddate TEXT, qtrs TEXT, uom TEXT, value REAL, footnote TEXT)")
    zaehlwerk = [0]

    def schreibe(cik, index, wert, aktienzahl=None):
        zaehlwerk[0] += 1
        adsh = "B%06d" % zaehlwerk[0]
        ddate = _quartalsende(index)
        acc = date.fromordinal(date(int(ddate[:4]), int(ddate[4:6]),
                                    int(ddate[6:])).toordinal() + 45)
        conn.execute("INSERT INTO bericht VALUES (?,?,?,?,?,?,?,?)",
                     (adsh, cik, "FIRMA " + cik, "3674", "1231", "10-Q", ddate,
                      acc.strftime("%Y-%m-%d") + " 12:00:00.0"))
        conn.execute("INSERT INTO fakt VALUES (?,?,?,?,?,?,?,?,?)",
                     (adsh, "Revenues", "us-gaap/2016", "", ddate, "1", "USD",
                      wert, ""))
        if aktienzahl is not None:
            conn.execute("INSERT INTO fakt VALUES (?,?,?,?,?,?,?,?,?)",
                         (adsh, "CommonStockSharesOutstanding", "us-gaap/2016", "",
                          ddate, "0", "shares", aktienzahl, ""))

    # Die Doppel-Ereignis-Firma wird NICHT ueber Spruenge gebaut, sondern von Hand
    # nachgerechnet. Grund: nach dem ersten Ereignis liegt die Schwelle des
    # Kalenderquartals bereits auf dem Beschleunigungswert der 200 Signalfirmen
    # (rund 0,80). Eine zweite Feuerung muss diese Schwelle wirklich reissen —
    # eine kleinere waere im Fixture unsichtbar geblieben, und genau daran sind am
    # 19.08. drei Sabotagen gruen geblieben.
    #   Quartal 12: g 0,571 gegen 0,261 -> a 0,310 > Schwelle 0 (Pool noch flach)
    #   Quartal 15: g 1,288 gegen 0,095 -> a 1,193 > Schwelle ~0,80
    # Beide Ereignisse sind reif (7 bzw. 4 Folgequartale).
    DOPPEL_REIHE = [100.0] * 11 + [130.0, 180.0, 100.0, 110.0] + [600.0] * 5

    def reihe(cik, sprung_bei=(), mit_marker=False, mit_aktien=True, werte=None):
        # Grundreihe: +10 % je Jahr, also konstantes g und a = 0.
        if werte is None:
            werte = [100.0 * (1.10 ** (i // 4)) * (1.0 + 0.01 * (i % 4))
                     for i in range(len(QUARTALE))]
        else:
            werte = list(werte)
        for start in sprung_bei:
            # Zwei Quartale mit steigendem Wachstum -> a(t) > 0 und a(t-1) > 0.
            for versatz, faktor in ((0, 1.8), (1, 3.2)):
                for i in range(start + versatz, len(QUARTALE)):
                    werte[i] *= faktor
        if mit_marker:
            werte[-1] = MARKER_WERT
        for i, wert in enumerate(werte):
            schreibe(cik, i, round(wert, 4),
                     aktienzahl=1000.0 + i if mit_aktien else None)

    conn.execute("PRAGMA synchronous=OFF")
    try:
        _fuelle_fixture(conn, reihe, signal_firmen, hintergrund, doppel, marker,
                        aktien, DOPPEL_REIHE)
    finally:
        conn.close()


def _fuelle_fixture(conn, reihe, signal_firmen, hintergrund, doppel, marker,
                    aktien, doppel_reihe):
    """Der Schreibteil, getrennt, damit die Verbindung im `finally` des Aufrufers
    zugeht — auch wenn der Aufbau mittendrin scheitert. Sonst haelt sie unter
    Windows die Datei fest und der naechste Fixture-Aufbau scheitert mit einer
    PermissionError statt mit dem echten Fehler."""
    conn.execute("BEGIN")
    for n in range(hintergrund):
        reihe("9%05d" % n, mit_aktien=aktien)
    for n in range(signal_firmen):
        letzte = (n == signal_firmen - 1)
        reihe("1%05d" % n, sprung_bei=(11,), mit_marker=(marker and letzte),
              mit_aktien=aktien)
    if doppel:
        reihe("200001", werte=doppel_reihe, mit_aktien=aktien)
    conn.execute("COMMIT")


def _fixture_lauf(verzeichnis, e2, az, signal_firmen, doppel=False, marker=False):
    panel_pfad = os.path.join(verzeichnis, "panel-validierung.sqlite")
    baue_probe_fixture(panel_pfad, signal_firmen, doppel=doppel, marker=marker)
    panel = sqlite3.connect("file:" + panel_pfad.replace("\\", "/") + "?mode=ro", uri=True)
    try:
        return zaehle_fenster(panel, os.path.join(verzeichnis, "zwischen.sqlite"),
                              e2, az, FENSTER["pruefung"], "pruefung",
                              mit_aktienzahl=True)
    finally:
        panel.close()


def selbsttest():
    import shutil
    import tempfile
    verzeichnis = tempfile.mkdtemp(prefix="e3-zaehlprobe-")
    print("Selbsttest in " + verzeichnis)
    e2 = lade_modul(E2_SKRIPT, "studie_basisraten")
    az = lade_modul(AZ_SKRIPT, "studie_panel_aktienzahl")
    praereg = lies_praeregistrierung()
    try:
        print("\n[1] Die Mauer — beide Richtungen")
        for boese in (os.path.join(verzeichnis, "panel", "panel-endtest.sqlite.enc"),
                      os.path.join(verzeichnis, "schluessel", "endtest.key"),
                      os.path.join(verzeichnis, "panel", "panel-entdeckung.sqlite")):
            try:
                pruefe_mauer(boese, "pruefung")
                pruefe("gesperrter Pfad wird abgewiesen: " + os.path.basename(boese), False)
            except ProbeFehler:
                pruefe("gesperrter Pfad wird abgewiesen: " + os.path.basename(boese), True)
        try:
            pruefe_mauer(os.path.join(verzeichnis, "panel-validierung.sqlite"), "pruefung")
            pruefe("das freigegebene Fenster geht DURCH (sonst waere die Mauer Deko)", True)
        except ProbeFehler as fehler:
            pruefe("das freigegebene Fenster geht DURCH", False, str(fehler), "kein Abbruch")

        print("\n[2] Minima-Ampel: 199 gegen 200 (W6)")
        v199, _ = _fixture_lauf(verzeichnis, e2, az, 199)
        v200, _ = _fixture_lauf(verzeichnis, e2, az, 200)
        pruefe("199 reife Firmen -> Fallzahl 199", v199["S-U"]["fallzahl"] == 199,
               v199["S-U"]["fallzahl"], 199)
        pruefe("199 reife Firmen -> " + AMPEL_ROT,
               v199["S-U"]["ampel"] == AMPEL_ROT, v199["S-U"]["ampel"], AMPEL_ROT)
        pruefe("200 reife Firmen -> Fallzahl 200", v200["S-U"]["fallzahl"] == 200,
               v200["S-U"]["fallzahl"], 200)
        pruefe("200 reife Firmen -> " + AMPEL_GRUEN,
               v200["S-U"]["ampel"] == AMPEL_GRUEN, v200["S-U"]["ampel"], AMPEL_GRUEN)
        pruefe("die Schwelle liegt wirklich dazwischen — der Unterschied ist EINE Firma",
               v200["S-U"]["fallzahl"] - v199["S-U"]["fallzahl"] == 1)

        print("\n[3] R3: eine Firma mit ZWEI reifen Ereignissen zaehlt EINMAL (W6)")
        vdoppel, _ = _fixture_lauf(verzeichnis, e2, az, 200, doppel=True)
        pruefe("die Doppel-Ereignis-Firma feuert wirklich zweimal (sonst traegt das "
               "Fixture den Unterschied nicht)",
               vdoppel["S-U"]["feuerungen"] - v200["S-U"]["feuerungen"] >= 2,
               vdoppel["S-U"]["feuerungen"] - v200["S-U"]["feuerungen"], ">= 2")
        pruefe("201 Firmen, nicht 202 Ereignisse", vdoppel["S-U"]["fallzahl"] == 201,
               vdoppel["S-U"]["fallzahl"], 201)

        print("\n[4] Ausgabe-Allowlist (W3)")
        gueltig = {
            "schema": SCHEMA, "protokoll": PROTOKOLL, "runId": "x", "fenster": "pruefung",
            "fensterVon": 2017, "fensterBis": 2019, "panelRand": "2020-12-31",
            "perzentil": PERZENTIL, "serverConfirmedAt": "2026-08-19T12:00:00.000Z",
            "accessedAt": "2026-08-19T12:00:00.000Z",
            "ersterZugriffAm": "2026-08-19T12:05:00.000Z",
            "beendetAm": "2026-08-19T12:30:00.000Z", "gelesenePfade": [],
            "geschriebenePfade": [], "ergebnisdatenBeruehrt": False, "siegelWache": {},
            "manifestGeprueft": [], "umgebung": {}, "zaehler": {},
            # BEIDE konfirmatorischen Varianten: seit dem Code-Review verlangt
            # `pruefe_ausgabe`, dass genau die praeregistrierten Varianten da sind —
            # eine Ausgabe ohne Ergebnis-Kern ging vorher glatt durch.
            "varianten": {"S-U": dict(v200["S-U"]), "S-G": dict(v200["S-G"])},
        }
        try:
            pruefe_ausgabe(gueltig, praereg, e2)
            pruefe("die gueltige Ausgabe geht DURCH", True)
        except ProbeFehler as fehler:
            pruefe("die gueltige Ausgabe geht DURCH", False, str(fehler), "kein Abbruch")
        leck = json.loads(json.dumps(gueltig))
        leck["varianten"]["S-U"]["persistenz_mittelwert"] = MARKER_WERT
        try:
            pruefe_ausgabe(leck, praereg, e2)
            pruefe("ein geleckter Persistenzwert fliegt auf", False)
        except ProbeFehler:
            pruefe("ein geleckter Persistenzwert fliegt auf", True)
        luecke = json.loads(json.dumps(gueltig))
        del luecke["varianten"]["S-U"]["ampel"]
        try:
            pruefe_ausgabe(luecke, praereg, e2)
            pruefe("eine WEGGELASSENE Pflichtgroesse fliegt auch auf", False)
        except ProbeFehler:
            pruefe("eine WEGGELASSENE Pflichtgroesse fliegt auch auf", True)

        print("\n[5] Der 0.777-Marker taucht nirgends in der Ausgabe auf (W3)")
        vmarker, zmarker = _fixture_lauf(verzeichnis, e2, az, 200, marker=True)
        text = json.dumps({"varianten": vmarker, "zaehler": zmarker})
        pruefe("kein Folgequartal-Wert im Output", "0.777" not in text,
               [t for t in text.split(",") if "0.777" in t], "keine Fundstelle")
        pruefe("der Marker steht wirklich im Fixture (sonst prueft [5] nichts)",
               MARKER_WERT == 0.777)

        print("\n[6] Serverzeit (W2)")
        freigabe = {"runId": "x", "fenster": "pruefung", "registerEventHash": "a",
                    "serverConfirmedAt": "2026-08-19T12:00:00.000Z",
                    "accessedAt": "2026-08-19T12:01:00.000Z"}
        try:
            pruefe_serverzeit(freigabe, "2026-08-19T12:05:00.000Z")
            pruefe("Zugriff NACH Serverzeit geht durch", True)
        except ProbeFehler as fehler:
            pruefe("Zugriff NACH Serverzeit geht durch", False, str(fehler), "kein Abbruch")
        for fall, zeit in (("Zugriff VOR der Serverbestaetigung", "2026-08-19T11:59:00.000Z"),
                           ("Zugriff VOR der angemeldeten Zugriffszeit", "2026-08-19T12:00:30.000Z")):
            try:
                pruefe_serverzeit(freigabe, zeit)
                pruefe(fall + " fliegt auf", False)
            except ProbeFehler:
                pruefe(fall + " fliegt auf", True)
        try:
            pruefe_serverzeit(freigabe, "2026-08-19T12:05:00")
            pruefe("Zeitstempel ohne Zeitzone fliegt auf", False)
        except ProbeFehler:
            pruefe("Zeitstempel ohne Zeitzone fliegt auf", True)

        print("\n[7] Sperrzone Endtest")
        pruefe("die Fenster-Registry kennt den Endtest als Sperrzone",
               FENSTER["endtest"]["sperrzone"] is True)
        quelle = open(os.path.abspath(__file__), encoding="utf-8").read().lower()
        # Die Suchbegriffe werden zur Laufzeit zusammengesetzt, sonst stuende der
        # Test in seinem eigenen Suchraum und waere immer rot. Erste Fassung war
        # genau das.
        verboten = ("de" + "crypt", "aes" + "-256", "ci" + "pher", "un" + "seal")
        gefunden = [w for w in verboten if w in quelle]
        pruefe("diese Datei enthaelt keinen Entschluesselungs-Aufruf",
               not gefunden, gefunden, "keine Fundstelle")
        pruefe("der Schluessel-Fingerabdruck ist pruefbar, wird aber nicht gerufen",
               schluessel_fingerabdruck_stimmt(
                   b"x", hashlib.sha256(b"x").hexdigest())
               and not schluessel_fingerabdruck_stimmt(b"y", hashlib.sha256(b"x").hexdigest()))

        print("\n[8] Manifest (W1)")
        try:
            pruefe_manifest()
            pruefe("das ausgelieferte Manifest stimmt", True)
        except ProbeFehler as fehler:
            pruefe("das ausgelieferte Manifest stimmt", False, str(fehler), "kein Abbruch")
        luecke_pfad = os.path.join(verzeichnis, "manifest-luecke.json")
        if os.path.isfile(MANIFEST):
            with open(MANIFEST, encoding="utf-8") as f:
                m = json.load(f)
        else:
            # Vor dem allerersten Siegel existiert kein Manifest. Der Waechter ist
            # dann schon rot (Pruefung darueber); die Luecken-Gegenprobe laeuft
            # trotzdem, damit sie nicht stillschweigend uebersprungen wird.
            m = {"files": {"scripts/studie-basisraten.py": "0" * 64,
                           "scripts/studie-zaehlprobe.py": "0" * 64,
                           "protocol/early-detection/2.0.0/preregistration.json": "0" * 64}}
        del m["files"]["scripts/studie-basisraten.py"]
        with open(luecke_pfad, "w", encoding="utf-8") as f:
            json.dump(m, f)
        try:
            pruefe_manifest(luecke_pfad)
            pruefe("ein Manifest OHNE studie-basisraten.py fliegt auf", False)
        except ProbeFehler:
            pruefe("ein Manifest OHNE studie-basisraten.py fliegt auf", True)
        print("\n[9] Siegel-Wache (W4)")
        wurzel = os.path.join(verzeichnis, "datenwurzel")
        os.makedirs(os.path.join(wurzel, "panel"), exist_ok=True)
        enc = os.path.join(wurzel, "panel", "panel-endtest.sqlite.enc")
        with open(enc, "wb") as f:
            f.write(b"ein kleines Siegel")
        siegel_json = os.path.join(verzeichnis, "versiegelung.json")

        def schreibe_siegel():
            with open(siegel_json, "w", encoding="utf-8") as f:
                json.dump({"klartextDatei": "panel-endtest.sqlite",
                           "siegelDatei": "panel-endtest.sqlite.enc",
                           "bytesSiegel": os.path.getsize(enc),
                           "sha256Siegel": sha256_datei(enc)}, f)
        schreibe_siegel()
        try:
            siegel_wache(wurzel, siegel_json, voll=True)
            pruefe("ein unberuehrtes Siegel geht DURCH", True)
        except ProbeFehler as fehler:
            pruefe("ein unberuehrtes Siegel geht DURCH", False, str(fehler), "kein Abbruch")
        with open(os.path.join(wurzel, "panel", "panel-endtest.sqlite"), "wb") as f:
            f.write(b"Klartext")
        try:
            siegel_wache(wurzel, siegel_json, voll=True)
            pruefe("eine KLARTEXT-Kopie des Endtest-Panels fliegt auf", False)
        except ProbeFehler:
            pruefe("eine KLARTEXT-Kopie des Endtest-Panels fliegt auf", True)
        os.remove(os.path.join(wurzel, "panel", "panel-endtest.sqlite"))
        with open(enc, "r+b") as f:
            f.seek(0)
            f.write(b"E")
        try:
            siegel_wache(wurzel, siegel_json, voll=True)
            pruefe("ein gekipptes Byte der Siegeldatei fliegt auf", False)
        except ProbeFehler:
            pruefe("ein gekipptes Byte der Siegeldatei fliegt auf", True)
        os.remove(enc)
        try:
            siegel_wache(wurzel, siegel_json, voll=True)
            pruefe("eine verschwundene Siegeldatei ist kein bestandener Test", False)
        except ProbeFehler:
            pruefe("eine verschwundene Siegeldatei ist kein bestandener Test", True)
    finally:
        shutil.rmtree(verzeichnis, ignore_errors=True)
    if FEHLER:
        print("\nSELBSTTEST ROT — %d Pruefung(en) gescheitert (Exit-Code 1)" % len(FEHLER))
        return 1
    print("\nSELBSTTEST GRUEN — alle Pruefungen bestanden.")
    return 0


MANIFEST_DATEIEN = ("protocol/early-detection/2.0.0/preregistration.json",
                    "scripts/studie-zaehlprobe.py",
                    "scripts/studie-basisraten.py")


def siegeln(ziel=MANIFEST):
    """Erzeugt hash-manifest.json.

    Das Manifest schliesst sich selbst aus — es kann seinen eigenen Hash nicht
    enthalten. Gebunden werden die drei Dateien, an denen die eingefrorene Frage
    haengt: der Text der Frage, die Probe, die sie beantwortet, und der Code, aus
    dem beide ihre Signaldefinition beziehen."""
    eintraege = {}
    for rel in MANIFEST_DATEIEN:
        voll = os.path.join(WURZEL, *rel.split("/"))
        if not os.path.isfile(voll):
            raise ProbeFehler("Zu siegelnde Datei fehlt: " + rel)
        eintraege[rel] = sha256_datei(voll)
    manifest = {
        "schema": "early-detection-hash-manifest/v2.0",
        "protocol": PROTOKOLL,
        "parentProtocol": "FEM-SEC-US@1.2.0",
        "sealedAt": zeitstempel(),
        "algorithm": "SHA-256 over exact file bytes; manifest excludes itself",
        "erzeugtVon": "scripts/studie-zaehlprobe.py --siegeln",
        "bindet": ("Die eingefrorene Frage, die Probe, die sie beantwortet, und den "
                   "Code, aus dem beide ihre Signaldefinition beziehen. Wer eine der "
                   "drei nach dem Siegeln aendert, macht jeden Zaehllauf rot."),
        "files": dict(sorted(eintraege.items())),
    }
    # newline="\n" ist NICHT Kosmetik: Windows schriebe sonst CRLF, git normalisiert
    # beim Committen auf LF (.gitattributes), und der gesiegelte Hash gaelte fuer
    # Bytes, die im Repo gar nicht liegen. Der Waechter waere dann bei jedem frischen
    # Checkout rot — und niemand haette gewusst, warum.
    with open(ziel, "w", encoding="utf-8", newline="\n") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)
        f.write("\n")
    return manifest


def haupt(argv=None):
    p = argparse.ArgumentParser(description="E3 — Nur-Zaehlen-Probe (R15b)")
    p.add_argument("--fenster", choices=sorted(FENSTER))
    p.add_argument("--freigabe", help="Freigabe-Protokoll aus studie-r1-serverzeit.js")
    p.add_argument("--data-root")
    p.add_argument("--arbeit")
    p.add_argument("--ziel")
    p.add_argument("--ohne-siegel-hash", action="store_true",
                   help="Siegel nur ueber die Byte-Zahl pruefen (5 GB sha256 dauert)")
    p.add_argument("--selbsttest", action="store_true")
    p.add_argument("--siegeln", action="store_true",
                   help="hash-manifest.json neu erzeugen (VOR dem Push, nie danach)")
    a = p.parse_args(argv)
    if a.siegeln:
        manifest = siegeln()
        print(json.dumps(manifest["files"], ensure_ascii=False, indent=1))
        return 0
    if a.selbsttest:
        return selbsttest()
    if not a.fenster:
        p.error("--fenster wird gebraucht (oder --selbsttest)")
    ausgabe = lauf(a.fenster, a.freigabe, data_root=a.data_root, arbeit=a.arbeit,
                   ziel=a.ziel, siegel_voll=not a.ohne_siegel_hash)
    print(json.dumps(ausgabe["varianten"], ensure_ascii=False, indent=1, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(haupt())

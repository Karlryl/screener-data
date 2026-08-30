#!/usr/bin/env python
"""E4g - Die Restursache der S-G-Verluste. Ein reiner Zaehl-Lauf.

DIE FRAGE: Der Bruecken-Rat hat gemessen, dass die Kennungsbruecke den Arm S-G um
exakt 0,000pp hebt - die 39 Signal-Verluste sind 9x Klasse (a) + 30x Klasse (c),
kein einziger Kennungswechsel. Offen ist NUR noch die Restursache: Sind diese
Firmen an der FENSTERKANTE gescheitert (die vier Folgequartale passten nach dem
eigenen Melderhythmus gar nicht mehr bis 2020-12-31), an einem REGIMEWECHSEL zur
Jahreskadenz (20-F/40-F/10-K statt 10-Q), oder sind sie ECHT VERSCHWUNDEN?

DREI SONDEN, je Firma gekreuzt (T171-Auftrag, orchestrator ENTSCHIED 1):
  (1) KANTENPROBE auf der ACCEPTED-Achse. E4d bildete den Kadenz-Median ueber
      ddate, ankerte die Zensur aber auf accepted - Meldeverzug fiel damit durch
      den Rost. Hier liegt ALLES auf einer Achse: Median-Abstand
      accepted->accepted der gewaehlten Reihe VOR dem Signal, mal vier, gegen die
      Restlaufzeit bis zum Panelrand.
  (2) FORMULARREGIME nach dem Signal. Welche Formulare reicht die Firma NACH
      ihrem Signaldatum noch ein? Nur Jahresformen = sie lebt, meldet aber
      jaehrlich (vier FolgeQUARTALE kann sie bauartbedingt nie liefern). Gar
      keine Zeile mehr = echter Abgang.
  (3) afs-GRUPPE als Gegenprobe zu D2. Dieselbe Zuordnung wie
      scripts/studie-attrition-size-sector.py, damit die Zahlen vergleichbar sind.

WAS DIESES SKRIPT NICHT TUT: Es entscheidet NICHTS. Die Entscheidungsregel ist in
orchestrator-2026-08-29.md ENTSCHIED 2 VORAB eingefroren - vor Kenntnis dieser
Zahlen. Es aendert keine Schwelle, keine Reifedefinition, keine Praeregistrierung,
es fasst kein anderes Fenster an und den verschluesselten Endtest schon gar nicht.
Es gibt keine Firmen-Kennung aus, keinen Umsatz-, Gewinn-, Aktienzahl- oder
Kurswert, und keine Naht-ID des Bruecken-Artefakts (PANEL-Ebene, T171-Auflage).

WOHER DER CODE KOMMT: Signaldefinition, Reifedefinition, Klassen-Zerlegung und
saemtliche Waechter werden aus scripts/studie-e4a-diagnose.py,
scripts/studie-zaehlprobe.py und scripts/studie-basisraten.py IMPORTIERT, nicht
nachgebaut. Ein Nachbau haette die Population auseinanderlaufen lassen - und die
Population IST hier der Bit-Anker.

DER BINDENDE SELBST-CHECK (Register-Eintrag e4g-restursachen-pruefung-v2-
2026-08-29, im Eintragstext gehasht): Die Rekonstruktion MUSS exakt 39 S-G-Signal-
und 448 S-G-Kontrollpool-Verluste ergeben. Jede Abweichung ist ein SOFORT-STOPP
mit Eskalation - kein Weiterrechnen, keine Anpassung an die Sollzahl, keine zweite
Variante. Genau das tut ANKER_ABBRUCH weiter unten.

Aufruf:
  python scripts/studie-e4g-restursachen.py --selbsttest
  python scripts/studie-e4g-restursachen.py --allowlist-ausgeben
  python scripts/studie-e4g-restursachen.py --freigabe <freigabe.json> --ziel <report.json>
"""

import argparse
import importlib.util
import json
import os
import platform
import sqlite3
import statistics
import sys
from collections import defaultdict

WURZEL = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
E4A_SKRIPT = os.path.join(WURZEL, "scripts", "studie-e4a-diagnose.py")

SCHEMA = "early-detection-e4g-restursachen/v1"
FENSTER_NAME = "pruefung"
VARIANTE = "S-G"
BAND = (2017, 2019)

# ── Die Ausgabe-Allowlist ────────────────────────────────────────────────────
# EXAKT die 20 Felder, die der Register-Eintrag
# e4g-restursachen-pruefung-v2-2026-08-29 unter `allowedOutputs` fuehrt. Die
# Gleichheit wird in pruefe_anmeldung_deckt_ausgabe() in BEIDE Richtungen
# geprueft: ein Feld mehr ist ein Leck, ein Feld weniger eine stille
# Entschaerfung. Alle 20 sind Firmen-ZAHLEN, Tages-Abstaende oder Etiketten -
# kein Umsatz, kein Gewinn, keine Aktienzahl, kein Kurs, keine Kennung.
DATEN_FELDER = (
    "afs",
    "afs_gruppe",
    "fallzahl",
    "jahreskadenz",
    "jahreskadenz_ja",
    "jahreskadenz_nein",
    "kante_unmoeglich",
    "kante_unmoeglich_ja",
    "kante_unmoeglich_nein",
    "kantenfenster_accepted_tage",
    "klasse",
    "klasse_a_keine_folgequartale",
    "klasse_c_zu_wenige_folgequartale",
    "kontrollpool_verluste",
    "letzte_form_nach_signal",
    "median_abstand_accepted_tage",
    "nenner_restursachen",
    "ohne_zeile_nach_signal",
    "restlaufzeit_accepted_tage",
    "signal_verluste",
)

# Die Zeilen-Dimensionen (T171: "je Firma eine Zeile"). Sie tragen ETIKETTEN,
# keine Messwerte - und keine Firmen-Kennung. `nenner_restursachen` traegt, wie
# viele Firmen in genau dieser Zelle liegen; damit ist die Zeilenmenge
# vollstaendig rekonstruierbar, ohne dass eine einzelne Firma identifizierbar
# waere. Die Zeilen werden kanonisch sortiert ausgegeben: die Reihenfolge traegt
# dadurch keine Information ueber einzelne Firmen.
ZEILEN_FELDER = ("afs", "jahreskadenz", "kante_unmoeglich", "klasse",
                 "letzte_form_nach_signal", "nenner_restursachen")

# Zaehler je Arm. `klasse` und die Zeilen-Etiketten stehen NICHT hier - sie sind
# Dimensionen, keine Zaehler.
ARM_ZAEHLER = ("fallzahl", "jahreskadenz_ja", "jahreskadenz_nein",
               "kante_unmoeglich_ja", "kante_unmoeglich_nein",
               "klasse_a_keine_folgequartale", "klasse_c_zu_wenige_folgequartale",
               "nenner_restursachen", "ohne_zeile_nach_signal")
ARM_TAGE = ("kantenfenster_accepted_tage", "median_abstand_accepted_tage",
            "restlaufzeit_accepted_tage")
ARM_VERTEILUNGEN = ("afs", "afs_gruppe", "letzte_form_nach_signal")
ARM_BLOCK = tuple(sorted(ARM_ZAEHLER + ARM_TAGE + ARM_VERTEILUNGEN + ("zeilen",)))
ARME = ("kontrolle", "signal")

UMSCHLAG_ALLOWLIST = (
    "accessedAt", "arme", "beendetAm", "ergebnisdatenBeruehrt", "ersterZugriffAm",
    "fenster", "gelesenePfade", "geschriebenePfade", "kontrollpool_verluste",
    "manifestGeprueft", "panelRand", "perzentil", "protokoll", "runId", "schema",
    "selbstCheck", "serverConfirmedAt", "siegelWache", "signal_verluste",
    "umgebung", "variante",
)

# Die committeten E4a-Zahlen (reports/studie/E4a-diagnose-pruefung-2026-08-19.json,
# Band 2017-2019, Variante S-G). Sie werden NICHT "verglichen und dann geglaettet":
# jede Abweichung bricht den Lauf ab. Das ist der Bit-Anker aus ENTSCHIED 17.
ANKER = {
    "signal": {"unreif_gesamt": 39, "fallzahl": 326},
    "kontrolle": {"unreif_gesamt": 448, "fallzahl": 4285},
}
ANKER_QUELLE = "reports/studie/E4a-diagnose-pruefung-2026-08-19.json"

# Klassen-Etiketten. Der Register-Eintrag benennt Zaehler nur fuer (a) und (c) -
# das sind die beiden Klassen, die S-G im Signalarm ueberhaupt traegt. Der
# Kontrollpool traegt zusaetzlich EINE Firma der Klasse (b) (E4a hat diese Zahl
# bereits veroeffentlicht). Sie faellt deshalb nicht unter den Tisch, sondern
# steht in der Zeilen-Dimension `klasse` - einem ETIKETT, keinem neuen Feldnamen.
KLASSEN_ETIKETT = {
    "klasse_a_keine_folgequartale": "a",
    "klasse_b_kennung_gewechselt": "b",
    "klasse_c_zu_wenige_folgequartale": "c",
    "klasse_d_ohne_gewaehlte_reihe": "d",
}

# Die Untergrenze des Melderhythmus, WORTGLEICH aus E4d uebernommen
# (scripts/studie-e4d-kadenz.py::FISKALQUARTAL_TAGE): SEC Exchange Act Rule
# 13a-13 + 13a-1 ergeben vier periodische Berichte je Geschaeftsjahr, also
# 365/4 = 91,25 Tage. Schnellere gemessene Abstaende stammen aus Nachtraegen und
# Ueberschneidungen, nicht aus einem schnelleren Rhythmus. Sie wird hier NICHT
# neu gewaehlt - eine zweite Untergrenze fuer dieselbe Sache hiesse: keine.
FISKALQUARTAL_TAGE = 365.0 / 4.0

# afs-Zuordnung, WORTGLEICH aus scripts/studie-attrition-size-sector.py. Genau
# das macht Sonde (3) zur Gegenprobe zu D2 statt zu einer zweiten Meinung.
AFS = {
    "1-LAF": "larger",
    "2-ACC": "larger",
    "3-SRA": "smaller",
    "4-NON": "smaller",
    "5-SML": "smaller",
}
AFS_UNBEKANNT = "unbekannt"
AFS_GRUPPE_UNBEKANNT = "missing_or_unknown"

# Jahres-Formen: wer NACH dem Signal nur noch diese einreicht, meldet jaehrlich
# und kann vier FolgeQUARTALE bauartbedingt nicht mehr liefern. Abgeleitet aus
# studie-basisraten.py::PERIODISCHE_FORMEN minus 10-Q.
JAHRES_FORMEN = ("10-K", "20-F", "40-F")
KEINE_FORM = "keine"

# T185 - der GESCHLOSSENE Vorrat fuer `letzte_form_nach_signal`.
#
# Bis 2026-08-30 hielt dieses eine Feld nur zwei Bedingungen: Laenge <= 20 und
# nicht ausschliesslich Ziffern. Das faengt die NUMERISCHE Kennung (0000320193)
# und laesst die ALPHABETISCHE durch: `AAPL`, `Apple Inc.` und
# `OperatingIncomeLoss` gingen alle drei hindurch (RR-6-Audit, § P9, Testtabelle).
# Ein realisiertes Leck war das nicht - der echte Datenpfad liefert hier
# ausschliesslich `e2.formstamm(bericht.form)` -, aber der Waechter war an dieser
# Stelle nicht das, was den Leak verhindert. Das ist der Unterschied zwischen
# einer Zusicherung und einer Eigenschaft.
#
# Periodische Staemme wortgleich aus studie-basisraten.py::PERIODISCHE_FORMEN -
# hier NICHT ein drittes Mal getippt, sondern aus JAHRES_FORMEN
# zusammengesetzt, das bereits daraus abgeleitet ist. Der Selbsttest prueft die
# Gleichheit gegen das geladene Modul; eine Drift wird rot, nicht still.
PERIODISCHE_FORMSTAEMME = JAHRES_FORMEN + ("10-Q",)

# Die uebrigen Staemme, die der committete Lauf TATSAECHLICH gemessen hat
# (reports/studie/E4g-restursachen-diagnose-2026-08-29.json,
# `letzte_form_nach_signal` beider Arme). Gemessen, nicht erfunden.
WEITERE_FORMSTAEMME = ("6-K", "8-K", "S-1", "S-4")

# KIPP-BEDINGUNG, benannt statt versteckt: ein Lauf ueber ein anderes Band kann
# einen Formstamm liefern, der hier fehlt - dann BRICHT der Lauf ab, statt still
# durchzulassen. Das ist die gewollte Richtung (RestursachenFehler statt stiller
# Rueckfall). Die Heilung ist EINE Zeile in WEITERE_FORMSTAEMME, sichtbar im
# Diff - und genau deshalb faellt ein Ticker in dieser Liste auf.
FORM_VORRAT = tuple(sorted(
    set(PERIODISCHE_FORMSTAEMME + WEITERE_FORMSTAEMME + (KEINE_FORM,))))


class RestursachenFehler(Exception):
    """Ein Befund, der den Lauf anhaelt - nie ein stiller Rueckfall."""


def lade(pfad, name):
    spec = importlib.util.spec_from_file_location(name, pfad)
    if spec is None or spec.loader is None:
        raise RestursachenFehler("Skript nicht ladbar: " + pfad)
    modul = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(modul)
    return modul


e4a = lade(E4A_SKRIPT, "studie_e4a_diagnose")
zp = e4a.zp                      # EINE Instanz, nicht zwei - sonst laufen die
                                 # Konstanten der beiden Ladungen auseinander.


# ── Die drei Sonden ──────────────────────────────────────────────────────────

def accepted_ordinal(e2, accepted):
    o = e2.ordinal(str(accepted)[:10].replace("-", ""))
    if o is None:
        raise RestursachenFehler(
            "R5-ABBRUCH: unlesbarer Melde-Zeitstempel. Die Kantenprobe ist damit "
            "NICHT BERECHENBAR und wird nicht geraten. (Der Wert selbst steht "
            "bewusst nicht in dieser Meldung - ein Tagesdatum einer einzelnen "
            "Firma gehoert nicht in ein Protokoll.)")
    return o


def kantenprobe(f, gewaehlt, e2, rand_ordinal):
    """SONDE 1 - passten die vier Folgequartale ueberhaupt noch ins Fenster?

    Alles auf der ACCEPTED-Achse, und genau das ist der Punkt: E4d mass den
    Rhythmus auf ddate und die Zensur auf accepted; wer spaet nachreicht, fiel
    dadurch durch den Rost. Gemessen wird der Median der Abstaende zwischen den
    Melde-Zeitpunkten der gewaehlten Reihe mit ddate <= ddate(Signal) - also nur
    VOR dem Signal, kein Vorgriff (R11) - nach unten begrenzt durch ein
    Fiskalquartal.

    kante_unmoeglich  <=>  4 * Melderhythmus  >  Restlaufzeit bis zum Panelrand

    Rueckgabe: (median_tage, kantenfenster_tage, restlaufzeit_tage, unmoeglich)
    """
    reihe = gewaehlt.get(f["cik"])
    if not reihe:
        raise RestursachenFehler(
            "KANTEN-ABBRUCH: Erst-Ereignis-Firma ohne gewaehlte Reihe. Wer "
            "feuert, MUSS in der gewaehlten Reihe stehen - kommt das vor, ist "
            "die Datenstrecke kaputt und nicht die Kadenz zu langsam.")
    ordinale = sorted(accepted_ordinal(e2, eintrag[1])
                      for d, eintrag in reihe.items() if d <= f["ddate"])
    if len(ordinale) < 2:
        raise RestursachenFehler(
            "KANTEN-ABBRUCH: nur " + str(len(ordinale)) + " Melde-Zeitpunkt(e) "
            "vor dem Signal. Ohne mindestens einen Abstand gibt es keinen "
            "Rhythmus - konstruktiv unmoeglich, weil jede Feuerung ein "
            "Vorquartal derselben Quelle braucht. Kommt es doch vor, ist es ein "
            "Befund.")
    gemessen = statistics.median(
        [b - a for a, b in zip(ordinale, ordinale[1:])])
    median = max(float(gemessen), FISKALQUARTAL_TAGE)
    kantenfenster = e2.REIFE_QUARTALE * median
    restlaufzeit = float(rand_ordinal - accepted_ordinal(e2, f["accepted"]))
    if restlaufzeit < 0:
        raise RestursachenFehler(
            "R5-ABBRUCH: negative Restlaufzeit. Das Panel traegt per Bauart nur "
            "Berichte bis zum Rand; ein Signal dahinter waere ein Baufehler und "
            "kein knapper Fall.")
    return median, kantenfenster, restlaufzeit, kantenfenster > restlaufzeit


def formularregime(f, formulare, e2):
    """SONDE 2 - was reicht die Firma NACH ihrem Signal noch ein?

    Drei Befunde, sauber getrennt:
      * ohne_zeile   - GAR KEINE Zeile mehr, in KEINER Form (auch kein 8-K, kein
                       S-1). Das ist die strengste Lesart von "echter Abgang":
                       die Firma taucht im Panel nach ihrem Signal nicht mehr auf.
      * jahreskadenz - periodische Zeilen ja, aber KEIN 10-Q mehr; nur noch
                       10-K/20-F/40-F. Die Firma lebt, kann vier FolgeQUARTALE
                       aber bauartbedingt nicht liefern.
      * letzte_form  - der Formstamm der SPAETESTEN Zeile nach dem Signal, ueber
                       ALLE Formen. Eine Firma, die nur noch 8-K meldet, steht
                       damit sichtbar zwischen "lebt" und "weg" - sie faellt
                       weder unter ohne_zeile noch unter Jahreskadenz.

    GRENZE, hier benannt statt versteckt: das Panel endet am Rand (2020-12-31).
    "Keine Zeile mehr" heisst deshalb "keine Zeile mehr BIS ZUM PANELRAND", nicht
    "nie wieder". Fuer ein Signal kurz vor dem Rand ist das eine schwache Aussage
    - genau deshalb laeuft Sonde 1 daneben.

    Rueckgabe: (ohne_zeile, jahreskadenz, letzte_form)
    """
    grenze = str(f["accepted"])
    nach = [(acc, form) for acc, form in formulare.get(f["cik"], ())
            if acc > grenze]
    if not nach:
        return True, False, KEINE_FORM
    letzte = max(nach)[1]
    periodisch = set(form for _acc, form in nach
                     if form in e2.PERIODISCHE_FORMEN)
    jahres = bool(periodisch) and periodisch.issubset(set(JAHRES_FORMEN))
    return False, jahres, letzte


def afs_gruppe(code):
    """SONDE 3 - die Groessenklasse der Firma, Gegenprobe zu D2.

    Dieselbe Zuordnung wie scripts/studie-attrition-size-sector.py. Ein leeres
    oder unbekanntes afs wird NICHT still einer Gruppe zugeschlagen: es bekommt
    seine eigene Klasse. Eine stille Zuordnung waere hier besonders teuer, weil
    D2s Befund genau an dieser Achse haengt."""
    return AFS.get(code, AFS_GRUPPE_UNBEKANNT)


# ── Der Arm ──────────────────────────────────────────────────────────────────

def leerer_arm():
    block = dict((feld, 0) for feld in ARM_ZAEHLER)
    for feld in ARM_TAGE:
        block[feld] = None
    for feld in ARM_VERTEILUNGEN:
        block[feld] = {}
    block["zeilen"] = []
    return block


def zerlege_arm(unreif, reif, gewaehlt, formulare, afs_je_firma, e2, rand_ordinal):
    """EIN Arm - Signal oder Kontrollpool, derselbe Code, dieselbe Fehlbehandlung.

    Die Vorstudie ist daran gestorben, dass fehlende Werte in einer Gruppe
    strenger gebucht wurden als in der anderen. Hier ruft jeder Arm dieselbe
    Funktion; die Restursachen-Zerlegung des Kontrollpools ist deshalb mit der
    des Signalarms vergleichbar."""
    block = leerer_arm()
    block["fallzahl"] = len(reif)
    block["nenner_restursachen"] = len(unreif)
    zellen = defaultdict(int)
    mediane, fenster, reste = [], [], []
    for f in unreif:
        klasse, _unter, _anschluss = e4a.klassifiziere(f, gewaehlt)
        etikett = KLASSEN_ETIKETT.get(klasse)
        if etikett is None:
            raise RestursachenFehler(
                "KLASSEN-ABBRUCH: unbekannte Klasse " + repr(klasse)
                + ". Eine Klasse ohne Etikett waere eine stille Luecke in der "
                "Zerlegung.")
        median, kantenfenster, restlaufzeit, unmoeglich = kantenprobe(
            f, gewaehlt, e2, rand_ordinal)
        ohne_zeile, jahres, letzte = formularregime(f, formulare, e2)
        code = afs_je_firma.get(f["cik"], AFS_UNBEKANNT)

        mediane.append(median)
        fenster.append(kantenfenster)
        reste.append(restlaufzeit)
        if klasse in ARM_ZAEHLER:
            block[klasse] += 1
        block["kante_unmoeglich_ja" if unmoeglich else "kante_unmoeglich_nein"] += 1
        block["jahreskadenz_ja" if jahres else "jahreskadenz_nein"] += 1
        if ohne_zeile:
            block["ohne_zeile_nach_signal"] += 1
        block["afs"][code] = block["afs"].get(code, 0) + 1
        gruppe = afs_gruppe(code)
        block["afs_gruppe"][gruppe] = block["afs_gruppe"].get(gruppe, 0) + 1
        block["letzte_form_nach_signal"][letzte] = (
            block["letzte_form_nach_signal"].get(letzte, 0) + 1)
        zellen[(code, "ja" if jahres else "nein", "ja" if unmoeglich else "nein",
                etikett, letzte)] += 1

    for feld in ARM_VERTEILUNGEN:
        block[feld] = dict(sorted(block[feld].items()))
    if mediane:
        block["median_abstand_accepted_tage"] = _median(mediane)
        block["kantenfenster_accepted_tage"] = _median(fenster)
        block["restlaufzeit_accepted_tage"] = _median(reste)
    block["zeilen"] = [
        {"afs": a, "jahreskadenz": j, "kante_unmoeglich": k, "klasse": kl,
         "letzte_form_nach_signal": lf, "nenner_restursachen": n}
        for (a, j, k, kl, lf), n in sorted(zellen.items())]
    pruefe_arminvarianten(block)
    return block


def _median(werte):
    # Auf vier Nachkommastellen festgenagelt: die Untergrenze 365/4 = 91,25
    # erzeugt sonst je nach Plattform unterschiedlich lange Float-Darstellungen,
    # und ein Report, der sich zwischen zwei Laeufen im letzten Bit unterscheidet,
    # ist nicht mehr byte-vergleichbar.
    return round(float(statistics.median(werte)), 4)


def pruefe_arminvarianten(b):
    """Die Zerlegung muss AUFGEHEN. Ein Zaehler, der sich still von der
    Gesamtzahl loest, waere die bequemste Art, ein gewuenschtes Ergebnis zu
    erzeugen - deshalb bricht hier der Lauf ab, statt zu runden."""
    n = b["nenner_restursachen"]
    for ja, nein in (("kante_unmoeglich_ja", "kante_unmoeglich_nein"),
                     ("jahreskadenz_ja", "jahreskadenz_nein")):
        if b[ja] + b[nein] != n:
            raise RestursachenFehler(
                "ZERLEGUNGS-ABBRUCH: " + ja + " + " + nein + " ergibt "
                + str(b[ja] + b[nein]) + ", der Nenner ist " + str(n) + ".")
    for feld in ARM_VERTEILUNGEN:
        summe = sum(b[feld].values())
        if summe != n:
            raise RestursachenFehler(
                "ZERLEGUNGS-ABBRUCH: die Verteilung " + feld + " summiert sich "
                "auf " + str(summe) + ", der Nenner ist " + str(n) + ". Eine "
                "Verteilung, die nicht aufgeht, erklaert nichts.")
    summe = sum(z["nenner_restursachen"] for z in b["zeilen"])
    if summe != n:
        raise RestursachenFehler(
            "ZERLEGUNGS-ABBRUCH: die Zeilen summieren sich auf " + str(summe)
            + ", der Nenner ist " + str(n) + ".")
    if b["ohne_zeile_nach_signal"] > n:
        raise RestursachenFehler(
            "ZERLEGUNGS-ABBRUCH: mehr echte Abgaenge als Verluste.")
    # Wer gar keine Zeile mehr einreicht, kann keine Jahreskadenz fuehren. Die
    # beiden Befunde sind disjunkt, und wenn sie es einmal nicht sind, ist die
    # Sonde kaputt und nicht die Firma ungewoehnlich.
    ohne = sum(z["nenner_restursachen"] for z in b["zeilen"]
               if z["letzte_form_nach_signal"] == KEINE_FORM
               and z["jahreskadenz"] == "ja")
    if ohne:
        raise RestursachenFehler(
            "ZERLEGUNGS-ABBRUCH: " + str(ohne) + " Firma(en) fuehren gleichzeitig "
            "'keine Zeile nach dem Signal' und 'Jahreskadenz'. Beides zugleich "
            "ist konstruktiv unmoeglich.")
    return True


# ── Der Lauf ─────────────────────────────────────────────────────────────────

def lies_metadaten(panel, e2):
    """cik -> sortierte (accepted, formstamm)-Liste, und cik -> afs bei EINTRITT.

    Beides aus derselben `bericht`-Tabelle, die die Zaehlprobe ohnehin liest -
    keine neue Quelle, keine neue Datei, kein anderes Fenster. `afs` bei Eintritt
    heisst: der Wert der FRUEHESTEN periodischen Zeile der Firma. Genau die
    Konvention von D2 (studie-attrition-size-sector.py::company_rows), damit die
    Gegenprobe eine Gegenprobe ist und keine zweite Definition."""
    formulare = defaultdict(list)
    eintritt = {}
    for cik, form, afs, accepted in panel.execute(
            "SELECT cik, form, afs, accepted FROM bericht"):
        firma = str(cik or "").strip()
        if not firma or not accepted:
            continue
        stamm = e2.formstamm(form)
        formulare[firma].append((str(accepted), stamm))
        if stamm not in e2.PERIODISCHE_FORMEN:
            continue
        code = str(afs or "").strip().upper() or AFS_UNBEKANNT
        vorhanden = eintritt.get(firma)
        if vorhanden is None or str(accepted) < vorhanden[0]:
            eintritt[firma] = (str(accepted), code)
    for firma in formulare:
        formulare[firma].sort()
    return dict(formulare), dict((k, v[1]) for k, v in eintritt.items())


def restursachen(panel, arbeit_pfad, e2):
    """Dieselbe Datenstrecke wie studie-e4a-diagnose.py::diagnose_fenster -
    gelesen, nicht geraten. Nur der letzte Schritt ist ein anderer: statt der
    Klassen-Zerlegung entsteht die Restursachen-Kreuzung."""
    fenster = zp.FENSTER[FENSTER_NAME]
    if zp.REIFE_QUARTALE != e2.REIFE_QUARTALE:
        raise RestursachenFehler(
            "REIFE-ABBRUCH: die Zaehlprobe verlangt " + str(zp.REIFE_QUARTALE)
            + " Folgequartale, studie-basisraten.py " + str(e2.REIFE_QUARTALE)
            + ". Zwei Schwellen fuer dieselbe Sache heisst: keine.")
    zaehler = defaultdict(int)
    berichte, _fj, _q, _fye = e2.lade_berichte(panel, zaehler)
    arbeit = e2.oeffne_zwischenstand(arbeit_pfad, True)
    try:
        e2.lies_rohwerte(panel, arbeit, berichte, zaehler, False)
        je_firma = e2.pit_reduktion(arbeit, zaehler)
    finally:
        arbeit.close()
    kurz = zp.kurzpfad(os.path.abspath(arbeit_pfad))
    if kurz not in zp.GESCHRIEBENE_PFADE:
        zp.GESCHRIEBENE_PFADE.append(kurz)

    formulare, afs_je_firma = lies_metadaten(panel, e2)
    rand_ordinal = e2.ordinal(fenster["rand"].replace("-", ""))

    # NUR S-G. S-U ist nicht Gegenstand dieser Diagnose (der Bruecken-Rat hat den
    # Arm bereits erklaert), und ein Arm, der nicht gebraucht wird, wird auch
    # nicht ausgegeben.
    alle, gewaehlt = e2.firmenreihen(je_firma, e2.ERGEBNIS_QUELLEN, False,
                                     zaehler, "betriebsergebnis_")
    _g, a_saetze = e2.wachstum_und_beschleunigung(alle, zaehler,
                                                  "betriebsergebnis_")
    feuerungen, auswertbar, _grenzen = e2.signale(a_saetze, zp.PERZENTIL, zaehler,
                                                  "betriebsergebnis_")
    band_f = [f for f in feuerungen if e4a.e2_im_band(f, e2, BAND[0], BAND[1])]
    band_a = [a for a in auswertbar if e4a.e2_im_band(a, e2, BAND[0], BAND[1])]
    signalfirmen = set(f["cik"] for f in band_f)
    kontroll = [a for a in band_a if a["cik"] not in signalfirmen]

    arme = {}
    for name, eintraege in (("signal", band_f), ("kontrolle", kontroll)):
        reif, unreif = e2.erst_ereignisse(eintraege, gewaehlt)
        pruefe_anker(name, len(unreif), len(reif))
        arme[name] = zerlege_arm(unreif, reif, gewaehlt, formulare, afs_je_firma,
                                 e2, rand_ordinal)
    return arme


def pruefe_anker(arm, unreif, fallzahl):
    """DER BIT-ANKER aus ENTSCHIED 17, gehasht im Register-Eintragstext.

    39 Signal- und 448 Kontrollpool-Verluste. Jede Abweichung ist ein
    SOFORT-STOPP mit Eskalation an den Orchestrator - kein Weiterrechnen, keine
    Anpassung der Rekonstruktion an die Sollzahl, keine zweite Variante. Die
    Fallzahl laeuft als zweiter, unabhaengiger Anker mit: eine Rekonstruktion,
    die zufaellig 39 Verluste bei falscher Population liefert, faellt daran auf."""
    soll = ANKER[arm]
    if unreif != soll["unreif_gesamt"] or fallzahl != soll["fallzahl"]:
        raise RestursachenFehler(
            "ANKER_ABBRUCH (SOFORT-STOPP, Eskalation an den Orchestrator): Arm "
            + arm + " ergibt " + str(unreif) + " Verluste bei Fallzahl "
            + str(fallzahl) + "; die committeten E4a-Zahlen sind "
            + str(soll["unreif_gesamt"]) + " bei " + str(soll["fallzahl"])
            + " (" + ANKER_QUELLE + "). Der Selbst-Check des Register-Eintrags "
            "e4g-restursachen-pruefung-v2-2026-08-29 ist damit VERLETZT. Es wird "
            "NICHT weitergerechnet und die Rekonstruktion NICHT an die Sollzahl "
            "angepasst.")
    return True


# ── Waechter ─────────────────────────────────────────────────────────────────

def pruefe_anmeldung_deckt_ausgabe(freigabe, register_pfad=None):
    """W9: was ausgegeben wird, muss angemeldet sein - Feld fuer Feld.

    Diese Diagnose hat keine eigene Praeregistrierung (sie ist eine Diagnose,
    keine Hypothesenpruefung); ihre Bindung ist der Register-Eintrag. Wer hier
    ein Feld ergaenzt, ohne es anzumelden, faellt auf - und wer eines weglaesst,
    auch: sonst liesse sich ein unbequemer Zaehler durch Schweigen entschaerfen."""
    pfad = register_pfad or zp.REGISTER
    with open(pfad, encoding="utf-8") as f:
        register = json.load(f)
    treffer = [e for e in (register.get("events") or [])
               if e.get("runId") == freigabe["runId"]]
    if len(treffer) != 1:
        raise RestursachenFehler(
            "W9-ABBRUCH: runId " + repr(freigabe["runId"]) + " steht "
            + str(len(treffer)) + "-mal im Zugriffs-Register.")
    angemeldet = set(treffer[0].get("allowedOutputs") or ())
    erlaubt = set(DATEN_FELDER)
    if angemeldet != erlaubt:
        raise RestursachenFehler(
            "W9-ABBRUCH: die Anmeldung deckt die Ausgabe nicht. Nur im Skript: "
            + str(sorted(erlaubt - angemeldet)) + "; nur im Register: "
            + str(sorted(angemeldet - erlaubt)) + ". Eine Anmeldung, die etwas "
            "anderes erlaubt als der Lauf ausgibt, ist keine Anmeldung.")
    return True


def pruefe_ausgabe(ausgabe):
    """W3-E4g: die Ergebnis-Sperre. Jeder nicht gelistete Schluessel ist ein
    ABBRUCH, in BEIDE Richtungen.

    Zusaetzlich zur Namenspruefung eine TYPPRUEFUNG: Zaehler sind nicht-negative
    ganze Zahlen, Tages-Groessen nicht-negative Zahlen, Etiketten kurze
    Zeichenketten aus einem festen Vorrat. Ein durchgereichter Umsatz-, Gewinn-
    oder Kurswert faellt damit auf, auch wenn er sich unter einem erlaubten Namen
    versteckt - und eine Firmen-Kennung ebenso, weil sie keinem Etikett-Vorrat
    angehoert."""
    fremd = sorted(set(ausgabe) - set(UMSCHLAG_ALLOWLIST))
    if fremd:
        raise RestursachenFehler(
            "W3-ABBRUCH: der Umschlag traegt nicht gelistete Schluessel: "
            + ", ".join(fremd))
    fehlend = sorted(set(UMSCHLAG_ALLOWLIST) - set(ausgabe))
    if fehlend:
        raise RestursachenFehler(
            "W3-ABBRUCH: dem Umschlag fehlen Pflichtfelder: " + ", ".join(fehlend))
    arme = ausgabe.get("arme") or {}
    if sorted(arme) != sorted(ARME):
        raise RestursachenFehler(
            "W3-ABBRUCH: die Ausgabe fuehrt die Arme " + str(sorted(arme))
            + ", erwartet sind " + str(sorted(ARME)) + ". Eine Ausgabe ohne "
            "Ergebnis-Kern haette die Pruefung sonst bestanden.")
    for name, arm in sorted(arme.items()):
        pruefe_arm_block(arm, name)
    for feld in ("signal_verluste", "kontrollpool_verluste"):
        wert = ausgabe[feld]
        if not isinstance(wert, int) or isinstance(wert, bool) or wert < 0:
            raise RestursachenFehler(
                "W3-ABBRUCH: " + feld + " ist " + repr(wert)
                + " - erwartet ist eine nicht-negative ganze Zahl.")
    return True


def pruefe_arm_block(arm, ort):
    if not isinstance(arm, dict):
        raise RestursachenFehler("W3-ABBRUCH: " + ort + " ist kein Block.")
    fremd = sorted(set(arm) - set(ARM_BLOCK))
    if fremd:
        raise RestursachenFehler(
            "W3-ABBRUCH: " + ort + " gibt nicht gelistete Groessen aus: "
            + ", ".join(fremd) + ". Genau das ist die Ergebnis-Sperre (R4) - ein "
            "Wert, der in den Output leckt, macht die ganze Studie wertlos.")
    fehlend = sorted(set(ARM_BLOCK) - set(arm))
    if fehlend:
        raise RestursachenFehler(
            "W3-ABBRUCH: " + ort + " fehlen Pflichtgroessen: " + ", ".join(fehlend))
    for feld in ARM_ZAEHLER:
        wert = arm[feld]
        if not isinstance(wert, int) or isinstance(wert, bool) or wert < 0:
            raise RestursachenFehler(
                "W3-ABBRUCH: " + ort + "/" + feld + " ist " + repr(wert)
                + " - erwartet ist eine nicht-negative ganze Zahl. Ein "
                "Nachkommawert an dieser Stelle waere ein durchgereichter "
                "Messwert, kein Zaehler.")
    for feld in ARM_TAGE:
        wert = arm[feld]
        if wert is None:
            continue
        if isinstance(wert, bool) or not isinstance(wert, (int, float)) or wert < 0:
            raise RestursachenFehler(
                "W3-ABBRUCH: " + ort + "/" + feld + " ist " + repr(wert)
                + " - eine Tages-Groesse ist nicht negativ oder NICHT BERECHENBAR.")
    for feld in ARM_VERTEILUNGEN:
        verteilung = arm[feld]
        if not isinstance(verteilung, dict):
            raise RestursachenFehler(
                "W3-ABBRUCH: " + ort + "/" + feld + " ist kein Block.")
        for etikett, anzahl in verteilung.items():
            pruefe_etikett(feld, etikett, ort)
            if not isinstance(anzahl, int) or isinstance(anzahl, bool) or anzahl < 0:
                raise RestursachenFehler(
                    "W3-ABBRUCH: " + ort + "/" + feld + " zaehlt " + repr(anzahl)
                    + " - erwartet ist eine nicht-negative ganze Zahl.")
    for zeile in arm["zeilen"]:
        if sorted(zeile) != sorted(ZEILEN_FELDER):
            raise RestursachenFehler(
                "W3-ABBRUCH: " + ort + "/zeilen fuehrt " + str(sorted(zeile))
                + ", erlaubt ist " + str(sorted(ZEILEN_FELDER)) + ".")
        for feld in ("afs", "jahreskadenz", "kante_unmoeglich", "klasse",
                     "letzte_form_nach_signal"):
            pruefe_etikett(feld, zeile[feld], ort + "/zeilen")
        anzahl = zeile["nenner_restursachen"]
        if not isinstance(anzahl, int) or isinstance(anzahl, bool) or anzahl <= 0:
            raise RestursachenFehler(
                "W3-ABBRUCH: " + ort + "/zeilen zaehlt " + repr(anzahl)
                + " - eine Zeile ohne Firma dahinter ist eine erfundene Zeile.")
    return True


# Die festen Etikett-Vorraete. Ein Etikett ausserhalb des Vorrats ist ein
# ABBRUCH - genau daran faellt eine durchgereichte Firmen-Kennung auf, ohne dass
# irgendwo nach "sieht wie eine CIK aus" gesucht werden muesste.
ETIKETT_VORRAT = {
    "afs": tuple(sorted(AFS)) + (AFS_UNBEKANNT,),
    "afs_gruppe": tuple(sorted(set(AFS.values()))) + (AFS_GRUPPE_UNBEKANNT,),
    "jahreskadenz": ("ja", "nein"),
    "kante_unmoeglich": ("ja", "nein"),
    "klasse": tuple(sorted(KLASSEN_ETIKETT.values())),
    # T185: kein freies Feld mehr - geschlossener Vorrat wie die uebrigen fuenf.
    "letzte_form_nach_signal": FORM_VORRAT,
}


def pruefe_etikett(feld, wert, ort):
    if not isinstance(wert, str) or not wert:
        raise RestursachenFehler(
            "W3-ABBRUCH: " + ort + "/" + feld + " traegt " + repr(wert)
            + " - erwartet ist ein Etikett.")
    vorrat = ETIKETT_VORRAT.get(feld, ())
    if wert not in vorrat:
        hinweis = ""
        if feld == "letzte_form_nach_signal":
            hinweis = (" Ist das ein ECHTER SEC-Formstamm aus einem anderen "
                       "Band, gehoert er in WEITERE_FORMSTAEMME - eine Zeile, "
                       "sichtbar im Diff. Ist es keiner, leckt hier eine "
                       "Firmen-Identitaet.")
        raise RestursachenFehler(
            "W3-ABBRUCH: " + ort + "/" + feld + " traegt " + repr(wert)
            + " - erlaubt sind ausschliesslich " + str(list(vorrat)) + "."
            + hinweis)
    return True


def lauf(freigabe_pfad, data_root=None, arbeit=None, ziel=None, siegel_voll=True,
         panel_pfad=None, register_pfad=None):
    fenster = zp.FENSTER[FENSTER_NAME]
    if fenster["sperrzone"]:
        raise RestursachenFehler("SPERRZONE-STOPP: " + FENSTER_NAME)

    del zp.GEOEFFNETE_PFADE[:]
    del zp.GESCHRIEBENE_PFADE[:]

    manifest = zp.pruefe_manifest()
    freigabe = zp.lies_freigabe(freigabe_pfad, FENSTER_NAME)
    pruefe_anmeldung_deckt_ausgabe(freigabe, register_pfad)
    wurzel = zp.datenwurzel(data_root)

    erster_zugriff = zp.zeitstempel()
    zp.pruefe_serverzeit(freigabe, erster_zugriff)
    wache = zp.siegel_wache(wurzel, voll=siegel_voll)

    if panel_pfad is None:
        panel_pfad = os.path.join(wurzel, "panel", fenster["datei"])
    arbeit_pfad = arbeit or os.path.join(
        wurzel, "arbeit", "E4g-" + FENSTER_NAME + "-zwischenstand.sqlite")

    e2 = zp.lade_modul(zp.E2_SKRIPT, "studie_basisraten")
    panel = zp.oeffne_nur_lesend(panel_pfad, FENSTER_NAME)
    try:
        arme = restursachen(panel, arbeit_pfad, e2)
    finally:
        panel.close()

    ausgabe = {
        "schema": SCHEMA,
        "protokoll": zp.PROTOKOLL,
        "runId": freigabe["runId"],
        "fenster": FENSTER_NAME,
        "variante": VARIANTE,
        "panelRand": fenster["rand"],
        "perzentil": zp.PERZENTIL,
        "serverConfirmedAt": freigabe["serverConfirmedAt"],
        "accessedAt": freigabe["accessedAt"],
        "ersterZugriffAm": erster_zugriff,
        "beendetAm": zp.zeitstempel(),
        "gelesenePfade": sorted(zp.GEOEFFNETE_PFADE),
        "geschriebenePfade": sorted(zp.GESCHRIEBENE_PFADE),
        "ergebnisdatenBeruehrt": False,
        "siegelWache": wache,
        "manifestGeprueft": sorted(manifest),
        "umgebung": {"plattform": sys.platform, "python": platform.python_version(),
                     "sqlite": sqlite3.sqlite_version},
        "selbstCheck": {
            "quelle": ANKER_QUELLE,
            "sollSignalVerluste": ANKER["signal"]["unreif_gesamt"],
            "istSignalVerluste": arme["signal"]["nenner_restursachen"],
            "sollKontrollpoolVerluste": ANKER["kontrolle"]["unreif_gesamt"],
            "istKontrollpoolVerluste": arme["kontrolle"]["nenner_restursachen"],
            "sollFallzahlSignal": ANKER["signal"]["fallzahl"],
            "istFallzahlSignal": arme["signal"]["fallzahl"],
            "sollFallzahlKontrolle": ANKER["kontrolle"]["fallzahl"],
            "istFallzahlKontrolle": arme["kontrolle"]["fallzahl"],
            "bestanden": True,
        },
        "signal_verluste": arme["signal"]["nenner_restursachen"],
        "kontrollpool_verluste": arme["kontrolle"]["nenner_restursachen"],
        "arme": arme,
    }
    pruefe_ausgabe(ausgabe)
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


def _bricht(fn):
    try:
        fn()
    except RestursachenFehler:
        return True
    return False


class _E2:
    """Der schmale Teil von studie-basisraten.py, den die Sonden brauchen -
    echte Funktionen, keine Attrappen: ordinal/formstamm/PERIODISCHE_FORMEN
    werden aus dem geladenen Modul durchgereicht."""

    def __init__(self, e2):
        self.ordinal = e2.ordinal
        self.formstamm = e2.formstamm
        self.PERIODISCHE_FORMEN = e2.PERIODISCHE_FORMEN
        self.REIFE_QUARTALE = e2.REIFE_QUARTALE


def _gueltige_ausgabe():
    arm = leerer_arm()
    arm["fallzahl"] = 3
    arm["nenner_restursachen"] = 2
    arm["klasse_a_keine_folgequartale"] = 1
    arm["klasse_c_zu_wenige_folgequartale"] = 1
    arm["kante_unmoeglich_ja"] = 1
    arm["kante_unmoeglich_nein"] = 1
    arm["jahreskadenz_ja"] = 1
    arm["jahreskadenz_nein"] = 1
    arm["ohne_zeile_nach_signal"] = 1
    arm["median_abstand_accepted_tage"] = 91.25
    arm["kantenfenster_accepted_tage"] = 365.0
    arm["restlaufzeit_accepted_tage"] = 200.0
    arm["afs"] = {"1-LAF": 1, "5-SML": 1}
    arm["afs_gruppe"] = {"larger": 1, "smaller": 1}
    arm["letzte_form_nach_signal"] = {"10-K": 1, KEINE_FORM: 1}
    arm["zeilen"] = [
        {"afs": "1-LAF", "jahreskadenz": "ja", "kante_unmoeglich": "nein",
         "klasse": "c", "letzte_form_nach_signal": "10-K",
         "nenner_restursachen": 1},
        {"afs": "5-SML", "jahreskadenz": "nein", "kante_unmoeglich": "ja",
         "klasse": "a", "letzte_form_nach_signal": KEINE_FORM,
         "nenner_restursachen": 1},
    ]
    import copy
    return {
        "schema": SCHEMA, "protokoll": "FEM-SEC-US@2.0.0", "runId": "x",
        "fenster": FENSTER_NAME, "variante": VARIANTE, "panelRand": "2020-12-31",
        "perzentil": 95, "serverConfirmedAt": "z", "accessedAt": "z",
        "ersterZugriffAm": "z", "beendetAm": "z", "gelesenePfade": [],
        "geschriebenePfade": [], "ergebnisdatenBeruehrt": False,
        "siegelWache": {}, "manifestGeprueft": [], "umgebung": {},
        "selbstCheck": {}, "signal_verluste": 2, "kontrollpool_verluste": 2,
        "arme": {"signal": arm, "kontrolle": copy.deepcopy(arm)},
    }


def selbsttest():
    e2_voll = zp.lade_modul(zp.E2_SKRIPT, "studie_basisraten")
    e2 = _E2(e2_voll)
    rand = e2.ordinal("20201231")

    # ── Sonde 1: die Kantenprobe ─────────────────────────────────────────────
    # Eine Firma mit quartalsweisem Melderhythmus (91 Tage) und einem Signal, das
    # 200 Tage vor dem Rand angenommen wurde: 4 x 91,25 = 365 > 200 -> die vier
    # Folgequartale passten nicht mehr ins Fenster.
    def reihe(tage, ddates=None):
        ddates = ddates or ["2018%02d31" % m for m in range(1, len(tage) + 1)]
        return dict((d, (1.0, t, "direkt", ("OperatingIncomeLoss", "USD")))
                    for d, t in zip(ddates, tage))

    # Die Stichtage liegen QUARTALSWEISE (91 Tage), die Melde-Zeitpunkte 100 Tage
    # auseinander: eine Firma, die konstant spaet einreicht. Wer den Median auf
    # ddate bildet, bekommt hier 91 und damit die Untergrenze 91,25 - wer ihn auf
    # accepted bildet, bekommt 100. Genau diese Firma ist der Grund fuer T171.
    knapp = {"cik": "1", "ddate": "20200601", "accepted": "2020-06-14 12:00:00.0"}
    gewaehlt = {"1": reihe(["2019-06-15 12:00:00.0", "2019-09-23 12:00:00.0",
                            "2020-01-01 12:00:00.0", "2020-04-10 12:00:00.0"],
                           ["20190331", "20190630", "20190930", "20191231"])}
    median, fenster, rest, unmoeglich = kantenprobe(knapp, gewaehlt, e2, rand)
    pruefe("Kantenprobe: der Melderhythmus wird auf der ACCEPTED-Achse gemessen",
           median == 100.0, median, 100.0)
    pruefe("Kantenprobe: das Kantenfenster ist vier Melde-Abstaende breit",
           round(fenster, 2) == round(4 * median, 2))
    pruefe("Kantenprobe: die Restlaufzeit zaehlt bis zum Panelrand",
           rest == 200.0, rest, 200.0)
    pruefe("Kantenprobe: 4 Abstaende > Restlaufzeit -> kantenunmoeglich",
           unmoeglich is True)

    # Dieselbe Firma, Signal drei Jahre frueher: dieselbe Kadenz, aber genug Zeit.
    frueh = dict(knapp, accepted="2018-06-14 12:00:00.0")
    _m, _f, rest2, unmoeglich2 = kantenprobe(frueh, gewaehlt, e2, rand)
    pruefe("Kantenprobe: dieselbe Kadenz frueh im Fenster -> NICHT unmoeglich",
           unmoeglich2 is False)
    pruefe("Kantenprobe: die Restlaufzeit wandert mit dem Signal",
           rest2 > rest, rest2, "> " + str(rest))

    # Die Untergrenze: ein Nachtrag am Folgetag darf keinen 1-Tages-Rhythmus
    # erzeugen. E4ds dokumentierte Untergrenze greift.
    dicht = {"cik": "1", "ddate": "20200601", "accepted": "2020-06-14 12:00:00.0"}
    gewaehlt_dicht = {"1": reihe(["2020-01-01 12:00:00.0", "2020-01-02 12:00:00.0",
                                  "2020-01-03 12:00:00.0"],
                                 ["20190331", "20190630", "20190930"])}
    median_d, _f, _r, _u = kantenprobe(dicht, gewaehlt_dicht, e2, rand)
    pruefe("Kantenprobe: die Untergrenze 365/4 greift gegen Nachtrags-Buendel",
           median_d == FISKALQUARTAL_TAGE, median_d, FISKALQUARTAL_TAGE)

    # Nur Quartale VOR dem Signal zaehlen - sonst saehe die Kadenz in die Zukunft.
    mit_zukunft = {"1": dict(gewaehlt["1"],
                             **{"20201231": (1.0, "2020-12-30 12:00:00.0",
                                             "direkt",
                                             ("OperatingIncomeLoss", "USD"))})}
    knapp_vor = {"cik": "1", "ddate": "20191231",
                 "accepted": "2020-03-14 12:00:00.0"}
    m_ohne, _f, _r, _u = kantenprobe(knapp_vor, gewaehlt, e2, rand)
    m_mit, _f, _r, _u = kantenprobe(knapp_vor, mit_zukunft, e2, rand)
    pruefe("Kantenprobe: Quartale NACH dem Signal aendern die Kadenz nicht (R11)",
           m_ohne == m_mit, m_mit, m_ohne)
    pruefe("Kantenprobe: eine Firma ohne gewaehlte Reihe bricht ab",
           _bricht(lambda: kantenprobe(knapp, {}, e2, rand)))
    pruefe("Kantenprobe: ein einziger Melde-Zeitpunkt bricht ab",
           _bricht(lambda: kantenprobe(
               knapp, {"1": reihe(["2019-06-15 12:00:00.0"], ["20190331"])},
               e2, rand)))

    # ── Sonde 2: das Formularregime ──────────────────────────────────────────
    signal = {"cik": "1", "accepted": "2019-06-14 12:00:00.0"}
    formen = {
        "1": [("2019-03-01 12:00:00.0", "10-Q"), ("2019-06-14 12:00:00.0", "10-Q"),
              ("2019-09-01 12:00:00.0", "10-K"), ("2020-03-01 12:00:00.0", "20-F")],
    }
    ohne, jahres, letzte = formularregime(signal, formen, e2)
    pruefe("Formularregime: nur Jahresformen nach dem Signal -> Jahreskadenz",
           (ohne, jahres, letzte) == (False, True, "20-F"),
           (ohne, jahres, letzte), (False, True, "20-F"))
    mit_q = {"1": formen["1"] + [("2020-06-01 12:00:00.0", "10-Q")]}
    ohne, jahres, letzte = formularregime(signal, mit_q, e2)
    pruefe("Formularregime: ein einziges 10-Q danach kippt die Jahreskadenz",
           (ohne, jahres, letzte) == (False, False, "10-Q"),
           (ohne, jahres, letzte), (False, False, "10-Q"))
    ohne, jahres, letzte = formularregime(
        {"cik": "1", "accepted": "2020-12-31 23:59:59.0"}, formen, e2)
    pruefe("Formularregime: gar keine Zeile mehr -> echter Abgang",
           (ohne, jahres, letzte) == (True, False, KEINE_FORM),
           (ohne, jahres, letzte), (True, False, KEINE_FORM))
    nur_8k = {"1": formen["1"][:2] + [("2020-01-01 12:00:00.0", "8-K")]}
    ohne, jahres, letzte = formularregime(signal, nur_8k, e2)
    pruefe("Formularregime: nur noch 8-K ist WEDER Abgang NOCH Jahreskadenz",
           (ohne, jahres, letzte) == (False, False, "8-K"),
           (ohne, jahres, letzte), (False, False, "8-K"))
    ohne, jahres, letzte = formularregime({"cik": "unbekannt",
                                           "accepted": "2019-01-01 00:00:00.0"},
                                          formen, e2)
    pruefe("Formularregime: eine Firma ohne jede Zeile ist ein Abgang, kein Fehler",
           ohne is True and letzte == KEINE_FORM)

    # ── Sonde 3: die afs-Gegenprobe ──────────────────────────────────────────
    pruefe("afs: 1-LAF ist 'larger' - dieselbe Zuordnung wie D2",
           afs_gruppe("1-LAF") == "larger")
    pruefe("afs: 5-SML ist 'smaller' - dieselbe Zuordnung wie D2",
           afs_gruppe("5-SML") == "smaller")
    pruefe("afs: ein leeres afs bekommt eine EIGENE Klasse, keine stille Gruppe",
           afs_gruppe(AFS_UNBEKANNT) == AFS_GRUPPE_UNBEKANNT)

    # ── Der Bit-Anker ────────────────────────────────────────────────────────
    pruefe("Bit-Anker: 39/326 im Signalarm gehen durch",
           pruefe_anker("signal", 39, 326))
    pruefe("Bit-Anker: 448/4285 im Kontrollpool gehen durch",
           pruefe_anker("kontrolle", 448, 4285))
    pruefe("Bit-Anker: 38 statt 39 ist ein SOFORT-STOPP",
           _bricht(lambda: pruefe_anker("signal", 38, 326)))
    pruefe("Bit-Anker: 40 statt 39 ist ebenso ein SOFORT-STOPP",
           _bricht(lambda: pruefe_anker("signal", 40, 326)))
    pruefe("Bit-Anker: richtige Verlustzahl bei FALSCHER Fallzahl faellt auf",
           _bricht(lambda: pruefe_anker("signal", 39, 327)))
    pruefe("Bit-Anker: 447 statt 448 im Kontrollpool ist ein SOFORT-STOPP",
           _bricht(lambda: pruefe_anker("kontrolle", 447, 4285)))

    # ── Die Ergebnis-Sperre ──────────────────────────────────────────────────
    pruefe("die gueltige Ausgabe geht DURCH", pruefe_ausgabe(_gueltige_ausgabe()))

    def sabotage(fn):
        a = _gueltige_ausgabe()
        fn(a)
        return _bricht(lambda: pruefe_ausgabe(a))

    pruefe("eine geleckte Firmen-Kennung fliegt am Etikett-Vorrat auf",
           sabotage(lambda a: a["arme"]["signal"]["zeilen"][0].__setitem__(
               "afs", "0000320193")))
    pruefe("eine Kennung in der letzten Form fliegt auf",
           sabotage(lambda a: a["arme"]["signal"]["zeilen"][0].__setitem__(
               "letzte_form_nach_signal", "0000320193")))

    # ── T185: die drei ALPHABETISCHEN Faelle der RR-6-Testtabelle ────────────
    # Die alte Laengen-/Ziffern-Heuristik liess alle drei durch; sie testete den
    # Waechter ausgerechnet dort, wo er stark war. Jetzt haelt sie der
    # geschlossene Vorrat.
    for _name, _wert in (("ein Ticker", "AAPL"),
                         ("ein Firmenname", "Apple Inc."),
                         ("ein Konzeptname", "OperatingIncomeLoss")):
        pruefe("T185: " + _name + " in der letzten Form fliegt auf",
               sabotage(lambda a, w=_wert: a["arme"]["signal"]["zeilen"][0]
                        .__setitem__("letzte_form_nach_signal", w)))

    # Gegenrichtung: der Vorrat darf nicht so eng sein, dass er den echten
    # Datenpfad erschlaegt. Jeder Stamm, den der committete Lauf gemessen hat,
    # muss durchgehen - sonst ist das hier eine Wache, die den Lauf bricht.
    pruefe("T185: jeder Formstamm des Vorrats geht DURCH",
           all(pruefe_etikett("letzte_form_nach_signal", stamm, "probe")
               for stamm in FORM_VORRAT))
    pruefe("T185: der Vorrat traegt PERIODISCHE_FORMEN wortgleich",
           set(PERIODISCHE_FORMSTAEMME) == set(e2.PERIODISCHE_FORMEN),
           sorted(PERIODISCHE_FORMSTAEMME), sorted(e2.PERIODISCHE_FORMEN))
    pruefe("ein durchgereichter Messwert fliegt am Typ auf",
           sabotage(lambda a: a["arme"]["signal"].__setitem__(
               "nenner_restursachen", 2.7)))
    pruefe("ein zusaetzliches Feld im Arm fliegt auf",
           sabotage(lambda a: a["arme"]["signal"].__setitem__(
               "umsatz_median", 1000000)))
    pruefe("ein FEHLENDES Pflichtfeld fliegt genauso auf wie ein zusaetzliches",
           sabotage(lambda a: a["arme"]["signal"].pop("ohne_zeile_nach_signal")))
    pruefe("ein zusaetzlicher Schluessel im Umschlag fliegt auf",
           sabotage(lambda a: a.__setitem__("firmenliste", ["AAPL"])))
    pruefe("eine Zeile mit null Firmen dahinter fliegt auf",
           sabotage(lambda a: a["arme"]["signal"]["zeilen"][0].__setitem__(
               "nenner_restursachen", 0)))
    pruefe("ein erfundenes Klassen-Etikett fliegt auf",
           sabotage(lambda a: a["arme"]["signal"]["zeilen"][0].__setitem__(
               "klasse", "z")))
    pruefe("ein fehlender Arm fliegt auf",
           sabotage(lambda a: a["arme"].pop("kontrolle")))

    # ── Die Zerlegungs-Invarianten ───────────────────────────────────────────
    def invariante(fn):
        a = _gueltige_ausgabe()
        arm = a["arme"]["signal"]
        fn(arm)
        return _bricht(lambda: pruefe_arminvarianten(arm))

    pruefe("die gueltige Zerlegung geht auf",
           pruefe_arminvarianten(_gueltige_ausgabe()["arme"]["signal"]))
    pruefe("kante_unmoeglich ja+nein muss den Nenner treffen",
           invariante(lambda arm: arm.__setitem__("kante_unmoeglich_ja", 2)))
    pruefe("jahreskadenz ja+nein muss den Nenner treffen",
           invariante(lambda arm: arm.__setitem__("jahreskadenz_nein", 5)))
    pruefe("eine Verteilung, die nicht aufgeht, bricht ab",
           invariante(lambda arm: arm["afs"].__setitem__("1-LAF", 7)))
    pruefe("Zeilen, die sich nicht auf den Nenner summieren, brechen ab",
           invariante(lambda arm: arm["zeilen"][0].__setitem__(
               "nenner_restursachen", 9)))
    pruefe("'keine Zeile mehr' UND 'Jahreskadenz' zugleich bricht ab",
           invariante(lambda arm: arm["zeilen"][1].__setitem__(
               "jahreskadenz", "ja")))

    # ── W9: Anmeldung deckt Ausgabe ──────────────────────────────────────────
    pruefe("W9: die 20 Felder decken sich mit dem Register-Eintrag",
           pruefe_anmeldung_deckt_ausgabe(
               {"runId": "e4g-restursachen-pruefung-v2-2026-08-29"}))
    pruefe("W9: die Ausgabe-Allowlist zaehlt genau 20 Felder",
           len(DATEN_FELDER) == 20, len(DATEN_FELDER), 20)

    print("")
    if FEHLER:
        print("ROT: " + str(len(FEHLER)) + " Pruefung(en) gescheitert")
        return 1
    print("GRUEN: alle Pruefungen bestanden")
    return 0


def main(argv=None):
    p = argparse.ArgumentParser(description="E4g - Restursachen-Diagnose S-G")
    p.add_argument("--freigabe")
    p.add_argument("--ziel")
    p.add_argument("--data-root")
    p.add_argument("--arbeit")
    p.add_argument("--selbsttest", action="store_true")
    p.add_argument("--allowlist-ausgeben", action="store_true")
    p.add_argument("--form-vorrat-ausgeben", action="store_true")
    args = p.parse_args(argv)

    if args.selbsttest:
        return selbsttest()
    if args.allowlist_ausgeben:
        print(json.dumps(sorted(DATEN_FELDER), ensure_ascii=False, indent=1))
        return 0
    if args.form_vorrat_ausgeben:
        # T185: damit ein Test von aussen belegen kann, dass der geschlossene
        # Vorrat das committete Ergebnis wirklich deckt - statt es zu glauben.
        print(json.dumps(list(FORM_VORRAT), ensure_ascii=False, indent=1))
        return 0
    if not args.freigabe:
        p.error("--freigabe fehlt")
    ausgabe = lauf(args.freigabe, data_root=args.data_root, arbeit=args.arbeit,
                   ziel=args.ziel)
    print(json.dumps({
        "signal_verluste": ausgabe["signal_verluste"],
        "kontrollpool_verluste": ausgabe["kontrollpool_verluste"],
        "selbstCheck": ausgabe["selbstCheck"]["bestanden"],
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())

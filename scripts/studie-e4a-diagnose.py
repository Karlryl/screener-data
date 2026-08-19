#!/usr/bin/env python
"""E4a - Warum reisst die Auffindbarkeit? Die Klassen-Zerlegung.

DIE FRAGE: E3 hat fuer das Prueffenster INCONCLUSIVE_DATA gemeldet, weil das
Auffindbarkeits-Gate reisst (S-U 66,67 %, S-G 89,32 %). Die naheliegende
Erklaerung - Fensterkante - ist widerlegt: null zensierte Erst-Ereignisse. Die
stehende Hypothese lautet: es liegt am KENNUNGSWECHSEL (S-U laeuft auf vier
Umsatz-Kennungen mit ASC-606-Wechsel um 2018, S-G auf einer einzigen).

DIESES SKRIPT PRUEFT DIE HYPOTHESE, ES BESTAETIGT SIE NICHT. Es zaehlt drei
Dinge, und jedes davon kann die Hypothese kippen:

  1. WARUM ist ein Erst-Ereignis unreif? Genau eine Klasse je Firma:
       (a) keine Folgequartale        - die Reihe endet mit dem Ereignis
       (b) Kennung gewechselt         - >= 4 Folgequartale da, aber nicht unter
                                        derselben Quellen-Basis. DAS IST DER KERN:
                                        der Unterschied zwischen "die Firma ist
                                        verschwunden" und "unser Zaehler hat sie
                                        verloren".
       (c) zu wenige Folgequartale    - 1..3 Quartale, auch quellenuebergreifend
       (d) gar keine gewaehlte Reihe  - darf nicht vorkommen; wenn doch, ist es
                                        ein Befund und kein Rundungsfehler.
  2. Die HYPOTHETISCHE Quote, wenn die Kennung als anschlussfaehig statt als
     identisch gelesen wuerde. Das ist eine RECHNUNG, kein Einbau - eine
     anschlussfaehige Reifedefinition waere eine Protokollaenderung mit eigener
     Praeregistrierung (E4b).
  3. Der JAHRESVERLAUF der Auffindbarkeit. Das ist die Messung, die entscheidet:
     Haengt der Effekt zeitlich an 2018, stuetzt das die Hypothese. Ist der
     Verlauf gleichmaessig niedrig, ist sie widerlegt. Und S-G laeuft als
     Kontrollgruppe mit - eine einzige Kennung, kein ASC-606-Wechsel. Zeigt S-G
     denselben Verlauf, ist der Kennungswechsel NICHT die Ursache.

WAS DIESES SKRIPT NICHT TUT: Es rechnet keinen Ergebniswert (R4), es fasst das
verschluesselte Endtest-Fenster nicht an (Sperrzone, Karl 19.08.), es aendert
weder Schwelle noch Reifedefinition noch die versiegelte Praeregistrierung. Die
Frage, ob 90 % fuer Fundamentaldaten die richtige Schwelle ist, wird hier weder
gestellt noch beantwortet - sie gehoert nach der Messung vor den Orchestrator.

WOHER DER CODE KOMMT: Signaldefinition, Reifedefinition und saemtliche Waechter
werden aus scripts/studie-zaehlprobe.py und scripts/studie-basisraten.py
IMPORTIERT, nicht nachgebaut. Beide Dateien haengen im gesiegelten Manifest und
werden von diesem Skript nicht angefasst. Ein Nachbau haette die Zahlen
auseinanderlaufen lassen und die Diagnose wertlos gemacht.

Aufruf:
  python scripts/studie-e4a-diagnose.py --allowlist-ausgeben
  python scripts/studie-e4a-diagnose.py --fenster pruefung --freigabe <freigabe.json> --ziel <report.json>
  python scripts/studie-e4a-diagnose.py --selbsttest
"""

import argparse
import importlib.util
import json
import os
import platform
import sqlite3
import sys
from collections import defaultdict
from datetime import date

WURZEL = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ZP_SKRIPT = os.path.join(WURZEL, "scripts", "studie-zaehlprobe.py")

SCHEMA = "early-detection-e4a-diagnose/v1"

# Die Baender je Fenster. Ein Band ist ein SIGNALband - das Erst-Ereignis wird
# INNERHALB des Bandes bestimmt, deshalb laesst sich ein schmaleres Band nicht
# aus den Jahreszahlen eines breiteren zusammenaddieren. Wer beide Baender will,
# muss beide rechnen; genau das passiert hier.
#   registry  = das Band, das die Fenster-Registry der Zaehlprobe fuehrt.
#   e2_anker  = E2s Kalibrierungsband (mit Pufferjahr 2016). Es existiert hier
#               ausschliesslich als Gegenprobe gegen E2s veroeffentlichte Zahlen.
BAENDER = {
    "pruefung": (("registry", 2017, 2019),),
    "entdeckung": (("registry", 2009, 2015), ("e2_anker", 2012, 2016)),
}

# Die veroeffentlichten Anker. Sie werden nicht "verglichen und dann geglaettet",
# sondern brechen den Lauf ab. Ein Diagnose-Lauf, der die bekannten Zahlen nicht
# reproduziert, misst etwas anderes als E2/E3 - und ist damit als Erklaerung
# ihres Befunds wertlos.
ANKER = {
    ("pruefung", "registry"): {
        "quelle": "reports/studie/E3-zaehlprobe-pruefung-2026-08-19.json",
        "S-U": {"firmen_mit_erst_ereignis": 438, "fallzahl": 292,
                "zensierte_erst_ereignisse": 0},
        "S-G": {"firmen_mit_erst_ereignis": 365, "fallzahl": 326,
                "zensierte_erst_ereignisse": 0},
    },
    ("entdeckung", "e2_anker"): {
        "quelle": "reports/studie/E2-basisraten-2026-08-19.json",
        "S-U": {"firmen_mit_erst_ereignis": 731, "fallzahl": 512,
                "unreif_gesamt": 219},
        "S-G": {"firmen_mit_erst_ereignis": 811, "fallzahl": 546,
                "unreif_gesamt": 265},
    },
}

# ── Die Ausgabe-Allowlist ────────────────────────────────────────────────────
# Muster ist die Allowlist der Zaehlprobe (scripts/studie-zaehlprobe.py,
# pruefe_ausgabe). Sie wird hier BEWUSST UND MINIMAL erweitert - um die
# Klassen-Zaehler, den hypothetischen Gegentest und die Jahresachse - statt
# umgangen. Die versiegelte preregistration.json wird dabei NICHT angefasst:
# ihre Allowlist gehoert zur eingefrorenen Zaehlprobe, und ein nachtraeglich
# erweitertes Siegel waere kein Siegel mehr.
#
# Alle Felder sind FIRMEN-ZAHLEN oder Quoten daraus. Kein Umsatz, kein Gewinn,
# keine Wachstumsrate, keine Firmen-Kennung, kein Kennungsname.
ZAEHL_FELDER = (
    "firmen_mit_erst_ereignis",
    "zensierte_erst_ereignisse",
    "nenner_auffindbarkeit",
    "fallzahl",
    "unreif_gesamt",
    "klasse_a_keine_folgequartale",
    "klasse_b_kennung_gewechselt",
    "klasse_b1_nur_kennungsname",
    "klasse_b2_auch_waehrungseinheit",
    "klasse_c_zu_wenige_folgequartale",
    "klasse_d_ohne_gewaehlte_reihe",
    "hypothetische_fallzahl_anschlussfaehig",
)
QUOTEN_FELDER = (
    "auffindbarkeit",
    "hypothetische_auffindbarkeit_anschlussfaehig",
)
JAHRES_FELDER = ("je_jahr_accepted", "je_jahr_ddate")

ZAHLEN_BLOCK = tuple(sorted(ZAEHL_FELDER + QUOTEN_FELDER))
ARM_BLOCK = tuple(sorted(ZAHLEN_BLOCK + JAHRES_FELDER))
ARME = ("signal", "kontrolle")
BAND_BLOCK = ("bis", "rolle", "varianten", "von")

UMSCHLAG_ALLOWLIST = (
    "accessedAt", "ankerGeprueft", "baender", "beendetAm", "ergebnisdatenBeruehrt",
    "ersterZugriffAm", "fenster", "gelesenePfade", "geschriebenePfade",
    "manifestGeprueft", "panelRand", "perzentil", "protokoll", "runId",
    "schema", "serverConfirmedAt", "siegelWache", "umgebung",
)

KLASSE_A = "klasse_a_keine_folgequartale"
KLASSE_B = "klasse_b_kennung_gewechselt"
KLASSE_B1 = "klasse_b1_nur_kennungsname"
KLASSE_B2 = "klasse_b2_auch_waehrungseinheit"
KLASSE_C = "klasse_c_zu_wenige_folgequartale"
KLASSE_D = "klasse_d_ohne_gewaehlte_reihe"


class DiagnoseFehler(Exception):
    """Ein Befund, der den Lauf anhaelt - nie ein stiller Rueckfall."""


def lade(pfad, name):
    spec = importlib.util.spec_from_file_location(name, pfad)
    if spec is None or spec.loader is None:
        raise DiagnoseFehler("Skript nicht ladbar: " + pfad)
    modul = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(modul)
    return modul


zp = lade(ZP_SKRIPT, "studie_zaehlprobe")


# ── Die Zerlegung ────────────────────────────────────────────────────────────

def klassifiziere(f, gewaehlt):
    """WARUM ist dieses Erst-Ereignis unreif? Genau EINE Klasse, plus die Zahl,
    die den hypothetischen Gegentest traegt.

    Rueckgabe: (klasse, unterklasse_oder_None, anschlussfaehig_reif)

    `anschlussfaehig_reif` ist die Antwort auf die Frage aus Punkt 2 des
    Auftrags: haette diese Firma vier Folgequartale, wenn ein Wechsel INNERHALB
    der eingefrorenen Quellen-Prioritaeten als Fortsetzung gezaehlt wuerde?
    Sie ist eine RECHNUNG. Nichts an der Reifedefinition aendert sich dadurch.
    """
    reihe = gewaehlt.get(f["cik"])
    if reihe is None:
        # Konstruktiv unmoeglich: wer feuert, steht in `gewaehlt`. Fail-closed
        # trotzdem als eigene Klasse gefuehrt - eine stille Einordnung unter (a)
        # wuerde einen echten Datenfehler als "Firma verschwunden" tarnen.
        return KLASSE_D, None, False
    nach = [eintrag for d, eintrag in reihe.items() if d > f["ddate"]]
    if not nach:
        return KLASSE_A, None, False
    anschlussfaehig = len(nach) >= zp.REIFE_QUARTALE
    if not anschlussfaehig:
        # 1..3 Folgequartale - auch quellenuebergreifend zu wenige. Ein
        # Kennungswechsel koennte hier zusaetzlich vorliegen, waere aber nicht
        # die bindende Ursache: die Firma wuerde die Reife so oder so verfehlen.
        return KLASSE_C, None, False
    # >= 4 Folgequartale sind DA, die Reife scheitert trotzdem: der Zaehler hat
    # sie an der Quellen-Basis verloren. Das ist Klasse (b), der Kern der Frage.
    einheit = f["basis"][1]
    fremde_einheit = any(eintrag[3][1] != einheit for eintrag in nach)
    return KLASSE_B, (KLASSE_B2 if fremde_einheit else KLASSE_B1), True


def leerer_block():
    block = dict((feld, 0) for feld in ZAEHL_FELDER)
    block["auffindbarkeit"] = None
    block["hypothetische_auffindbarkeit_anschlussfaehig"] = None
    return block


def quote(zaehler, nenner):
    """Dieselbe Regel wie in der Zaehlprobe: Nenner 0 heisst NICHT BERECHENBAR,
    nie 0,0. Eine stille Null saehe im Report aus wie ein gemessener Ausfall."""
    return (zaehler / nenner) if nenner > 0 else None


def fuelle_quoten(block):
    nenner = block["nenner_auffindbarkeit"]
    block["auffindbarkeit"] = quote(block["fallzahl"], nenner)
    block["hypothetische_auffindbarkeit_anschlussfaehig"] = quote(
        block["hypothetische_fallzahl_anschlussfaehig"], nenner)
    return block


def zerlege_arm(eintraege, gewaehlt, e2, rand_ordinal):
    """EIN Arm - Signal oder Kontrolle, derselbe Code, dieselbe Fehlbehandlung.

    Die Vorstudie ist daran gestorben, dass fehlende Werte in einer Gruppe
    strenger gebucht wurden als in der anderen. Hier ruft jeder Arm dieselbe
    Funktion; die Klassen-Zerlegung des Kontrollpools ist deshalb mit der des
    Signalarms vergleichbar.

    Reif/unreif kommen aus e2.erst_ereignisse - der EINGEFROREN definierten
    Reifepruefung. Dieses Skript entscheidet nicht neu, wer reif ist; es fragt
    nur nach, warum die Unreifen unreif sind."""
    reif, unreif = e2.erst_ereignisse(eintraege, gewaehlt)
    alle_erste = reif + unreif
    if len(set(e["cik"] for e in alle_erste)) != len(alle_erste):
        raise DiagnoseFehler(
            "R3-ABBRUCH: eine Firma traegt mehr als ein Erst-Ereignis.")

    gesamt = leerer_block()
    je_accepted = defaultdict(leerer_block)
    je_ddate = defaultdict(leerer_block)

    for e in alle_erste:
        jahr_a = e2.jahr_aus_accepted(e["accepted"])
        if jahr_a is None:
            raise DiagnoseFehler(
                "R5-ABBRUCH: Erst-Ereignis ohne lesbares Anmeldejahr. Die "
                "Jahresachse ist damit NICHT BERECHENBAR und wird nicht geraten.")
        jahr_d = str(e["ddate"])[:4]
        if len(jahr_d) != 4 or not jahr_d.isdigit():
            raise DiagnoseFehler(
                "R5-ABBRUCH: Erst-Ereignis mit unlesbarem Bilanzstichtag ("
                + repr(e.get("ddate")) + ").")
        bloecke = (gesamt, je_accepted[str(jahr_a)], je_ddate[jahr_d])
        zensiert = zp.ist_zensiert(e, e2, rand_ordinal)
        for b in bloecke:
            b["firmen_mit_erst_ereignis"] += 1
            if zensiert:
                b["zensierte_erst_ereignisse"] += 1
            else:
                b["nenner_auffindbarkeit"] += 1
        if e["folgequartale"] >= zp.REIFE_QUARTALE:
            for b in bloecke:
                b["fallzahl"] += 1
                b["hypothetische_fallzahl_anschlussfaehig"] += 1
            continue
        klasse, unterklasse, anschluss = klassifiziere(e, gewaehlt)
        for b in bloecke:
            b["unreif_gesamt"] += 1
            b[klasse] += 1
            if unterklasse is not None:
                b[unterklasse] += 1
            if anschluss:
                b["hypothetische_fallzahl_anschlussfaehig"] += 1

    for b in [gesamt] + list(je_accepted.values()) + list(je_ddate.values()):
        fuelle_quoten(b)
        pruefe_blockinvarianten(b)

    ergebnis = dict(gesamt)
    ergebnis["je_jahr_accepted"] = dict(sorted(je_accepted.items()))
    ergebnis["je_jahr_ddate"] = dict(sorted(je_ddate.items()))
    return ergebnis


def pruefe_blockinvarianten(b):
    """Die Zerlegung muss AUFGEHEN. Ein Klassen-Zaehler, der sich still von der
    Gesamtzahl loest, waere die bequemste Art, ein gewuenschtes Ergebnis zu
    erzeugen - deshalb bricht hier der Lauf ab, statt zu runden."""
    if b["fallzahl"] + b["unreif_gesamt"] != b["firmen_mit_erst_ereignis"]:
        raise DiagnoseFehler(
            "ZERLEGUNGS-ABBRUCH: reif (" + str(b["fallzahl"]) + ") + unreif ("
            + str(b["unreif_gesamt"]) + ") ergibt nicht die Zahl der "
            "Erst-Ereignis-Firmen (" + str(b["firmen_mit_erst_ereignis"]) + ").")
    summe = (b[KLASSE_A] + b[KLASSE_B] + b[KLASSE_C] + b[KLASSE_D])
    if summe != b["unreif_gesamt"]:
        raise DiagnoseFehler(
            "ZERLEGUNGS-ABBRUCH: die Klassen (a)+(b)+(c)+(d) summieren sich auf "
            + str(summe) + ", unreif sind " + str(b["unreif_gesamt"])
            + ". Eine Zerlegung, die nicht aufgeht, erklaert nichts.")
    if b[KLASSE_B1] + b[KLASSE_B2] != b[KLASSE_B]:
        raise DiagnoseFehler(
            "ZERLEGUNGS-ABBRUCH: die Unterklassen b1+b2 ("
            + str(b[KLASSE_B1] + b[KLASSE_B2]) + ") summieren sich nicht auf "
            "Klasse (b) (" + str(b[KLASSE_B]) + ").")
    if b["hypothetische_fallzahl_anschlussfaehig"] != b["fallzahl"] + b[KLASSE_B]:
        raise DiagnoseFehler(
            "ZERLEGUNGS-ABBRUCH: die hypothetische Fallzahl ("
            + str(b["hypothetische_fallzahl_anschlussfaehig"]) + ") ist nicht "
            "die Fallzahl plus Klasse (b) (" + str(b["fallzahl"] + b[KLASSE_B])
            + "). Genau diese Gleichung IST der Gegentest - stimmt sie nicht, "
            "misst die Rechnung etwas anderes als die Hypothese behauptet.")
    if (b["zensierte_erst_ereignisse"] + b["nenner_auffindbarkeit"]
            != b["firmen_mit_erst_ereignis"]):
        raise DiagnoseFehler(
            "ZERLEGUNGS-ABBRUCH: zensiert + Nenner ergibt nicht die Zahl der "
            "Erst-Ereignis-Firmen.")
    return True


# ── Der Lauf ueber ein Fenster ───────────────────────────────────────────────

def diagnose_fenster(panel, arbeit_pfad, e2, fenster_name):
    """Dieselbe Datenstrecke wie scripts/studie-zaehlprobe.py::zaehle_fenster -
    gelesen, nicht geraten. Nur der letzte Schritt ist ein anderer: statt der
    Ampel-Zaehler entsteht die Klassen-Zerlegung."""
    fenster = zp.FENSTER[fenster_name]
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

    rand_ordinal = e2.ordinal(fenster["rand"].replace("-", ""))
    # Dieselbe Reihenfolge und dieselben Flags wie zaehle_fenster.
    familien = (("S-U", e2.UMSATZ_QUELLEN, True, "umsatz_"),
                ("S-G", e2.ERGEBNIS_QUELLEN, False, "betriebsergebnis_"))
    vorbereitet = {}
    for name, quellen, nur_positiv, praefix in familien:
        alle, gewaehlt = e2.firmenreihen(je_firma, quellen, nur_positiv, zaehler,
                                         praefix)
        _g, a_saetze = e2.wachstum_und_beschleunigung(alle, zaehler, praefix)
        feuerungen, auswertbar, _grenzen = e2.signale(a_saetze, zp.PERZENTIL,
                                                      zaehler, praefix)
        vorbereitet[name] = (feuerungen, auswertbar, gewaehlt)

    baender = {}
    for rolle, von, bis in BAENDER[fenster_name]:
        varianten = {}
        for name, (feuerungen, auswertbar, gewaehlt) in vorbereitet.items():
            band_f = [f for f in feuerungen if e2_im_band(f, e2, von, bis)]
            band_a = [a for a in auswertbar if e2_im_band(a, e2, von, bis)]
            signalfirmen = set(f["cik"] for f in band_f)
            kontroll = [a for a in band_a if a["cik"] not in signalfirmen]
            varianten[name] = {
                "signal": zerlege_arm(band_f, gewaehlt, e2, rand_ordinal),
                "kontrolle": zerlege_arm(kontroll, gewaehlt, e2, rand_ordinal),
            }
        baender["%d-%d" % (von, bis)] = {
            "von": von, "bis": bis, "rolle": rolle, "varianten": varianten}
    return baender


def e2_im_band(eintrag, e2, von, bis):
    """Bandzugehoerigkeit exakt wie zp.im_signalband - nur mit freien Grenzen,
    damit derselbe Code auch das E2-Anker-Band messen kann."""
    jahr = e2.jahr_aus_accepted(eintrag["accepted"])
    return jahr is not None and von <= jahr <= bis


# ── Waechter ─────────────────────────────────────────────────────────────────

def pruefe_ausgabe(ausgabe):
    """W3-E4a: die Ergebnis-Sperre. Jeder nicht gelistete Schluessel ist ein
    ABBRUCH, in BEIDE Richtungen - ein fehlendes Pflichtfeld ist genauso rot wie
    ein zusaetzliches, sonst liesse sich ein unbequemer Zaehler durch Weglassen
    entschaerfen.

    Zusaetzlich zur Namenspruefung eine TYPPRUEFUNG: Zaehlfelder muessen ganze
    Zahlen sein, Quoten liegen in [0,1] oder sind None. Ein durchgereichter
    Umsatz- oder Wachstumswert faellt damit auf, auch wenn er sich unter einem
    erlaubten Namen versteckt."""
    fremd = sorted(set(ausgabe) - set(UMSCHLAG_ALLOWLIST))
    if fremd:
        raise DiagnoseFehler(
            "W3-ABBRUCH: der Umschlag traegt nicht gelistete Schluessel: "
            + ", ".join(fremd))
    fehlend = sorted(set(UMSCHLAG_ALLOWLIST) - set(ausgabe))
    if fehlend:
        raise DiagnoseFehler(
            "W3-ABBRUCH: dem Umschlag fehlen Pflichtfelder: " + ", ".join(fehlend))
    baender = ausgabe.get("baender") or {}
    if not baender:
        raise DiagnoseFehler(
            "W3-ABBRUCH: die Ausgabe fuehrt kein einziges Band. Eine Ausgabe "
            "ohne Ergebnis-Kern haette die Pruefung sonst bestanden.")
    for bandname, band in baender.items():
        if sorted(band) != sorted(BAND_BLOCK):
            raise DiagnoseFehler(
                "W3-ABBRUCH: Band " + bandname + " fuehrt " + str(sorted(band))
                + ", erlaubt ist " + str(sorted(BAND_BLOCK)) + ".")
        varianten = band["varianten"]
        if sorted(varianten) != ["S-G", "S-U"]:
            raise DiagnoseFehler(
                "W3-ABBRUCH: Band " + bandname + " fuehrt die Varianten "
                + str(sorted(varianten)) + ", erwartet sind ['S-G', 'S-U'].")
        for vname, variante in varianten.items():
            if sorted(variante) != sorted(ARME):
                raise DiagnoseFehler(
                    "W3-ABBRUCH: Variante " + vname + " in Band " + bandname
                    + " fuehrt die Arme " + str(sorted(variante))
                    + ", erwartet sind " + str(sorted(ARME)) + ".")
            for aname, arm in variante.items():
                ort = bandname + "/" + vname + "/" + aname
                pruefe_block(arm, ort, ARM_BLOCK)
                for achse in JAHRES_FELDER:
                    jahre = arm[achse]
                    if not isinstance(jahre, dict):
                        raise DiagnoseFehler(
                            "W3-ABBRUCH: " + ort + "/" + achse + " ist kein Block.")
                    # Beide Richtungen: eine leere Achse bei vorhandenen Firmen ist
                    # eine verlorene Messung, eine gefuellte Achse ohne Firmen eine
                    # erfundene. Der Jahresverlauf IST die Messung, die entscheidet.
                    if bool(jahre) != bool(arm["firmen_mit_erst_ereignis"]):
                        raise DiagnoseFehler(
                            "W3-ABBRUCH: " + ort + "/" + achse + " fuehrt "
                            + str(len(jahre)) + " Jahre, der Arm aber "
                            + str(arm["firmen_mit_erst_ereignis"])
                            + " Erst-Ereignis-Firmen. Leere Achse bei vorhandenen "
                            "Firmen ist eine verlorene Messung, gefuellte Achse "
                            "ohne Firmen eine erfundene.")
                    for jahr, block in jahre.items():
                        if not (isinstance(jahr, str) and len(jahr) == 4
                                and jahr.isdigit()):
                            raise DiagnoseFehler(
                                "W3-ABBRUCH: " + ort + "/" + achse
                                + " traegt den Jahresschluessel " + repr(jahr)
                                + " - erwartet ist eine vierstellige Jahreszahl.")
                        pruefe_block(block, ort + "/" + achse + "/" + jahr,
                                     ZAHLEN_BLOCK)
    return True


def pruefe_block(block, ort, erlaubt):
    if not isinstance(block, dict):
        raise DiagnoseFehler("W3-ABBRUCH: " + ort + " ist kein Block.")
    fremd = sorted(set(block) - set(erlaubt))
    if fremd:
        raise DiagnoseFehler(
            "W3-ABBRUCH: " + ort + " gibt nicht gelistete Groessen aus: "
            + ", ".join(fremd) + ". Genau das ist die Ergebnis-Sperre (R4) - ein "
            "Wert, der in den Output leckt, macht die ganze Studie wertlos.")
    fehlend = sorted(set(erlaubt) - set(block))
    if fehlend:
        raise DiagnoseFehler(
            "W3-ABBRUCH: " + ort + " fehlen Pflichtgroessen: " + ", ".join(fehlend))
    for feld in ZAEHL_FELDER:
        wert = block[feld]
        if not isinstance(wert, int) or isinstance(wert, bool) or wert < 0:
            raise DiagnoseFehler(
                "W3-ABBRUCH: " + ort + "/" + feld + " ist " + repr(wert)
                + " - erwartet ist eine nicht-negative ganze Zahl. Ein "
                "Nachkommawert an dieser Stelle waere ein durchgereichter "
                "Messwert, kein Zaehler.")
    for feld in QUOTEN_FELDER:
        wert = block[feld]
        if wert is None:
            continue
        if not isinstance(wert, float) or not (0.0 <= wert <= 1.0):
            raise DiagnoseFehler(
                "W3-ABBRUCH: " + ort + "/" + feld + " ist " + repr(wert)
                + " - eine Quote liegt in [0,1] oder ist NICHT BERECHENBAR.")
    return True


def pruefe_anker(baender, fenster_name):
    """W8: die veroeffentlichten Zahlen von E2 und E3 muessen exakt herauskommen.

    Das ist der einzige harte Beweis, dass diese Diagnose dieselbe Strecke misst
    wie der Befund, den sie erklaeren soll. Eine Abweichung wird NICHT als
    Rundung durchgewunken - sie bricht ab."""
    geprueft = []
    for (fenster, rolle), erwartung in sorted(ANKER.items()):
        if fenster != fenster_name:
            continue
        treffer = [b for b in baender.values() if b["rolle"] == rolle]
        if len(treffer) != 1:
            raise DiagnoseFehler(
                "W8-ABBRUCH: fuer den Anker '" + rolle + "' liegen "
                + str(len(treffer)) + " Baender vor, erwartet ist genau eines.")
        band = treffer[0]
        for vname, felder in sorted(erwartung.items()):
            if vname == "quelle":
                continue
            ist = band["varianten"][vname]["signal"]
            for feld, soll in sorted(felder.items()):
                if ist[feld] != soll:
                    raise DiagnoseFehler(
                        "W8-ABBRUCH: Anker " + rolle + "/" + vname + "/" + feld
                        + " ist " + str(ist[feld]) + ", veroeffentlicht ist "
                        + str(soll) + " (" + erwartung["quelle"] + "). Diese "
                        "Diagnose misst dann nicht die Strecke, deren Befund sie "
                        "erklaeren soll.")
            geprueft.append(rolle + "/" + vname + " gegen " + erwartung["quelle"])
    return sorted(geprueft)


def pruefe_anmeldung_deckt_ausgabe(freigabe, register_pfad=None):
    """W9: was ausgegeben wird, muss angemeldet sein - Feld fuer Feld.

    Die Zaehlprobe prueft ihre Ausgabe gegen die versiegelte Praeregistrierung.
    Diese Diagnose hat keine eigene Praeregistrierung (sie ist eine Diagnose,
    keine Hypothesenpruefung); ihre Bindung ist deshalb der Register-Eintrag.
    Wer hier ein Feld ergaenzt, ohne es anzumelden, faellt auf."""
    pfad = register_pfad or zp.REGISTER
    with open(pfad, encoding="utf-8") as f:
        register = json.load(f)
    treffer = [e for e in (register.get("events") or [])
               if e.get("runId") == freigabe["runId"]]
    if len(treffer) != 1:
        raise DiagnoseFehler(
            "W9-ABBRUCH: runId " + repr(freigabe["runId"]) + " steht "
            + str(len(treffer)) + "-mal im Zugriffs-Register.")
    angemeldet = set(treffer[0].get("allowedOutputs") or ())
    erlaubt = set(ZAEHL_FELDER + QUOTEN_FELDER)
    if angemeldet != erlaubt:
        raise DiagnoseFehler(
            "W9-ABBRUCH: die Anmeldung deckt die Ausgabe nicht. Nur angemeldet: "
            + str(sorted(erlaubt - angemeldet)) + "; nur im Register: "
            + str(sorted(angemeldet - erlaubt)) + ". Eine Anmeldung, die etwas "
            "anderes erlaubt als der Lauf ausgibt, ist keine Anmeldung.")
    return True


# ── Lauf ─────────────────────────────────────────────────────────────────────

def lauf(fenster_name, freigabe_pfad, data_root=None, arbeit=None, ziel=None,
         siegel_voll=True, panel_pfad=None, register_pfad=None):
    fenster = zp.FENSTER.get(fenster_name)
    if fenster is None:
        raise DiagnoseFehler("Unbekanntes Fenster: " + str(fenster_name))
    if fenster["sperrzone"]:
        raise DiagnoseFehler(
            "SPERRZONE-STOPP: Fenster '" + fenster_name + "' wird nicht "
            "geoeffnet. Karls Wort vom 19.08.2026: 'Studien-Endtest ist "
            "VERSCHLUESSELT: nicht oeffnen, keinen Oeffner bauen.' Diese Datei "
            "enthaelt keinen Entschluesselungs-Aufruf, und es soll auch keiner "
            "hinein. E4a ist eine Diagnose des Prueffensters, kein Endtest.")
    if fenster_name not in BAENDER:
        raise DiagnoseFehler(
            "Fuer Fenster '" + fenster_name + "' ist kein Band hinterlegt.")

    del zp.GEOEFFNETE_PFADE[:]
    del zp.GESCHRIEBENE_PFADE[:]

    manifest = zp.pruefe_manifest()
    freigabe = zp.lies_freigabe(freigabe_pfad, fenster_name)
    pruefe_anmeldung_deckt_ausgabe(freigabe, register_pfad)
    wurzel = zp.datenwurzel(data_root)

    erster_zugriff = zp.zeitstempel()
    zp.pruefe_serverzeit(freigabe, erster_zugriff)
    wache = zp.siegel_wache(wurzel, voll=siegel_voll)

    if panel_pfad is None:
        panel_pfad = os.path.join(wurzel, "panel", fenster["datei"])
    arbeit_pfad = arbeit or os.path.join(
        wurzel, "arbeit", "E4a-" + fenster_name + "-zwischenstand.sqlite")

    e2 = zp.lade_modul(zp.E2_SKRIPT, "studie_basisraten")
    panel = zp.oeffne_nur_lesend(panel_pfad, fenster_name)
    try:
        baender = diagnose_fenster(panel, arbeit_pfad, e2, fenster_name)
    finally:
        panel.close()

    ausgabe = {
        "schema": SCHEMA,
        "protokoll": zp.PROTOKOLL,
        "runId": freigabe["runId"],
        "fenster": fenster_name,
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
        "ankerGeprueft": pruefe_anker(baender, fenster_name),
        "baender": baender,
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


# 2015q1..2019q4. Dasselbe Raster wie das Zaehlproben-Fixture, damit die
# Fixtures vergleichbar bleiben.
QUARTALE = [(j, m) for j in range(2015, 2020) for m in (3, 6, 9, 12)]
MARKER_WERT = 0.777
# Firmen-Kennungen des Fixtures. Taucht eine davon im Output auf, ist eine
# Firmen-Identitaet geleckt.
CIK_REIF = "310001"
CIK_A = "320001"
CIK_B1 = "330001"
CIK_B2 = "340001"
CIK_C = "350001"


def _quartalsende(index):
    jahr, monat = QUARTALE[index]
    tag = 31 if monat in (3, 12) else 30
    return "%04d%02d%02d" % (jahr, monat, tag)


def baue_klassen_fixture(pfad, hintergrund=260):
    """Ein Fixture, das den Unterschied WIRKLICH TRAEGT.

    Die Lehre vom 19.08.: drei Sabotagen blieben gruen, weil das Fixture den
    Unterschied gar nicht zeigen konnte. Fuer eine Klassen-Zerlegung heisst das:
    jede Klasse braucht mindestens eine Firma, sonst kann die Sabotage einer
    Klasse gar nicht auffliegen.

      * Hintergrund: `hintergrund` Firmen mit konstantem Wachstum (a = 0). Sie
        feuern nie, tragen aber die 200 Werte, ohne die es keine Schwelle gibt.
      * CIK_REIF: feuert einmal und hat sieben Folgequartale derselben Quelle.
      * CIK_A:    feuert einmal, danach endet die Reihe -> Klasse (a).
      * CIK_B1:   feuert unter SalesRevenueNet, danach sieben Quartale unter
                  RevenueFromContractWithCustomerExcludingAssessedTax, gleiche
                  Waehrung -> Klasse (b1).
      * CIK_B2:   feuert unter Revenues/USD, danach sieben Quartale
                  Revenues/EUR -> Klasse (b2).
      * CIK_C:    feuert spaet, danach nur drei Folgequartale -> Klasse (c).
      * In ein Folgequartal von CIK_REIF wird MARKER_WERT gelegt. Taucht er im
        Output auf, ist ein Ergebniswert geleckt.
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

    def schreibe(cik, index, wert, tag, uom):
        zaehlwerk[0] += 1
        adsh = "B%06d" % zaehlwerk[0]
        ddate = _quartalsende(index)
        acc = date.fromordinal(date(int(ddate[:4]), int(ddate[4:6]),
                                    int(ddate[6:])).toordinal() + 45)
        conn.execute("INSERT INTO bericht VALUES (?,?,?,?,?,?,?,?)",
                     (adsh, cik, "FIRMA " + cik, "3674", "1231", "10-Q", ddate,
                      acc.strftime("%Y-%m-%d") + " 12:00:00.0"))
        conn.execute("INSERT INTO fakt VALUES (?,?,?,?,?,?,?,?,?)",
                     (adsh, tag, "us-gaap/2016", "", ddate, "1", uom, wert, ""))
        # S-G laeuft im Fixture NEBEN S-U, immer unter OperatingIncomeLoss und
        # immer in USD. Genau das ist die Kontrollgruppen-Eigenschaft, um die es
        # geht: dieselben Firmen, dieselben Quartale, EINE Kennung. Die Firmen,
        # die bei S-U die Kennung wechseln, tun es bei S-G nicht - und muessen
        # dort folglich reif sein. Ohne diese Zeilen waere die Kontrollgruppe im
        # Fixture leer und die S-G-Behauptung ungeprueft.
        conn.execute("INSERT INTO fakt VALUES (?,?,?,?,?,?,?,?,?)",
                     (adsh, "OperatingIncomeLoss", "us-gaap/2016", "", ddate, "1",
                      "USD", wert, ""))

    def werte_mit_sprung(sprung_bei):
        # LINEARES Grundwachstum, kein konstantes Prozentwachstum. Grund, hart
        # gelernt: bei konstanter Rate ist die Beschleunigung a exakt null, und
        # ob eine Firma feuert, entscheidet dann das VORZEICHEN DES
        # RUNDUNGSFEHLERS. Im ersten Anlauf feuerte deshalb eine Fixture-Firma
        # ein Quartal zu frueh und rutschte in die falsche Klasse. Linear heisst:
        # die Jahresrate faellt monoton, a ist strikt negativ, und der Sprung ist
        # das einzige Ereignis im ganzen Fixture.
        werte = [100.0 + 2.0 * i for i in range(len(QUARTALE))]
        if sprung_bei is not None:
            # Zwei Stufen: a(s) > 0 und a(s+1) > 0, a(s+2) wieder < 0. Damit
            # feuert die Firma GENAU EINMAL, naemlich bei s+1 (dort sind beide
            # Beschleunigungsquartale positiv).
            for versatz, faktor in ((0, 1.8), (1, 3.2)):
                for i in range(sprung_bei + versatz, len(QUARTALE)):
                    werte[i] *= faktor
        return werte

    def reihe(cik, sprung_bei=None, bis=None, tag="Revenues", uom="USD",
              ab=0, werte=None, marker_bei=None):
        werte = werte if werte is not None else werte_mit_sprung(sprung_bei)
        ende = len(QUARTALE) if bis is None else bis + 1
        for i in range(ab, ende):
            wert = MARKER_WERT if i == marker_bei else round(werte[i], 4)
            schreibe(cik, i, wert, tag, uom)

    conn.execute("PRAGMA synchronous=OFF")
    conn.execute("BEGIN")
    try:
        for n in range(hintergrund):
            reihe("9%05d" % n)
        # Sprung bei 11 -> Feuerung im Quartalsindex 12 (Bilanzstichtag
        # 2018-03-31, angenommen 2018-05-15). Nachgerechnet und am Fixture
        # nachgemessen, nicht geraten.
        reihe(CIK_REIF, sprung_bei=11, marker_bei=17)
        reihe(CIK_A, sprung_bei=11, bis=12)
        basis_b = werte_mit_sprung(11)
        reihe(CIK_B1, werte=basis_b, bis=12, tag="SalesRevenueNet")
        reihe(CIK_B1, werte=basis_b, ab=13,
              tag="RevenueFromContractWithCustomerExcludingAssessedTax")
        reihe(CIK_B2, werte=basis_b, bis=12, tag="Revenues", uom="USD")
        reihe(CIK_B2, werte=basis_b, ab=13, tag="Revenues", uom="EUR")
        # Sprung bei 14 -> Feuerung im Quartalsindex 15 (Bilanzstichtag
        # 2018-12-31, angenommen 2019-02-14). Reihe endet bei 18: genau drei
        # Folgequartale. Das Q4-Ereignis ist Absicht - es faellt auf der
        # Anmelde-Achse ins Jahr 2019 und auf der Stichtags-Achse ins Jahr 2018.
        # Nur so kann auffliegen, wenn beide Jahresachsen aus demselben Feld
        # gerechnet wuerden.
        reihe(CIK_C, sprung_bei=14, bis=18)
        conn.execute("COMMIT")
    finally:
        conn.close()


def _fixture_lauf(verzeichnis, e2):
    panel_pfad = os.path.join(verzeichnis, "panel-validierung.sqlite")
    baue_klassen_fixture(panel_pfad)
    panel = sqlite3.connect("file:" + panel_pfad.replace("\\", "/") + "?mode=ro",
                            uri=True)
    try:
        return diagnose_fenster(panel, os.path.join(verzeichnis, "zwischen.sqlite"),
                                e2, "pruefung")
    finally:
        panel.close()


def selbsttest():
    import shutil
    import tempfile
    verzeichnis = tempfile.mkdtemp(prefix="e4a-diagnose-")
    print("Selbsttest in " + verzeichnis)
    try:
        e2 = zp.lade_modul(zp.E2_SKRIPT, "studie_basisraten")
        baender = _fixture_lauf(verzeichnis, e2)
        su = baender["2017-2019"]["varianten"]["S-U"]["signal"]

        pruefe("das Fixture erzeugt genau fuenf Erst-Ereignis-Firmen",
               su["firmen_mit_erst_ereignis"] == 5,
               su["firmen_mit_erst_ereignis"], 5)
        pruefe("genau eine Firma ist reif", su["fallzahl"] == 1,
               su["fallzahl"], 1)
        pruefe("Klasse (a) - keine Folgequartale - kommt genau einmal vor",
               su[KLASSE_A] == 1, su[KLASSE_A], 1)
        pruefe("Klasse (b) - Kennungswechsel - kommt genau zweimal vor",
               su[KLASSE_B] == 2, su[KLASSE_B], 2)
        pruefe("Klasse (b1) - nur der Kennungsname wechselt - genau einmal",
               su[KLASSE_B1] == 1, su[KLASSE_B1], 1)
        pruefe("Klasse (b2) - auch die Waehrungseinheit wechselt - genau einmal",
               su[KLASSE_B2] == 1, su[KLASSE_B2], 1)
        pruefe("Klasse (c) - zu wenige Folgequartale - kommt genau einmal vor",
               su[KLASSE_C] == 1, su[KLASSE_C], 1)
        pruefe("Klasse (d) bleibt leer - jede Feuerung steht in der Reihe",
               su[KLASSE_D] == 0, su[KLASSE_D], 0)
        pruefe("die Klassen summieren sich auf die unreifen Firmen",
               su[KLASSE_A] + su[KLASSE_B] + su[KLASSE_C] + su[KLASSE_D]
               == su["unreif_gesamt"])
        pruefe("die Auffindbarkeit ist 1 von 5",
               su["auffindbarkeit"] == 0.2, su["auffindbarkeit"], 0.2)
        pruefe("die hypothetische Quote steigt um GENAU Klasse (b): 3 von 5",
               su["hypothetische_auffindbarkeit_anschlussfaehig"] == 0.6,
               su["hypothetische_auffindbarkeit_anschlussfaehig"], 0.6)
        pruefe("die hypothetische Rechnung aendert die echte Fallzahl NICHT",
               su["fallzahl"] == 1, su["fallzahl"], 1)

        # Die Jahresachse: vier Firmen feuern 2018, eine 2019.
        ja = su["je_jahr_accepted"]
        pruefe("der Jahresverlauf fuehrt genau die Jahre 2018 und 2019",
               sorted(ja) == ["2018", "2019"], sorted(ja), ["2018", "2019"])
        pruefe("2018 traegt vier Erst-Ereignis-Firmen",
               ja["2018"]["firmen_mit_erst_ereignis"] == 4,
               ja["2018"]["firmen_mit_erst_ereignis"], 4)
        pruefe("2019 traegt die spaete Firma der Klasse (c)",
               ja["2019"][KLASSE_C] == 1, ja["2019"][KLASSE_C], 1)
        pruefe("2018 traegt keine Klasse-(c)-Firma",
               ja["2018"][KLASSE_C] == 0, ja["2018"][KLASSE_C], 0)
        pruefe("die Jahreszahlen summieren sich auf die Bandzahl",
               sum(b["firmen_mit_erst_ereignis"] for b in ja.values())
               == su["firmen_mit_erst_ereignis"])
        jd = su["je_jahr_ddate"]
        pruefe("die zweite Jahresachse (Bilanzstichtag) summiert sich auch",
               sum(b["firmen_mit_erst_ereignis"] for b in jd.values())
               == su["firmen_mit_erst_ereignis"])
        # Das Q4-Ereignis der Klasse-(c)-Firma liegt auf der Stichtags-Achse in
        # 2018, auf der Anmelde-Achse in 2019. Waeren beide Achsen aus demselben
        # Feld gerechnet, stuende hier zweimal dasselbe.
        pruefe("die beiden Jahresachsen sind NICHT dieselbe Achse",
               sorted(jd) == ["2018"] and sorted(ja) == ["2018", "2019"],
               (sorted(jd), sorted(ja)), (["2018"], ["2018", "2019"]))

        # Kontrollarm: derselbe Code, gefuellt.
        ku = baender["2017-2019"]["varianten"]["S-U"]["kontrolle"]
        pruefe("der Kontrollarm laeuft durch denselben Code und ist gefuellt",
               ku["firmen_mit_erst_ereignis"] > 0,
               ku["firmen_mit_erst_ereignis"], "> 0")
        # S-G ist die KONTROLLGRUPPE der Hypothese: eine einzige Kennung, kein
        # Wechsel. Im Fixture sind es dieselben fuenf Firmen - nur verliert S-G
        # die beiden Kennungswechsler NICHT.
        sg = baender["2017-2019"]["varianten"]["S-G"]["signal"]
        pruefe("S-G sieht dieselben fuenf Erst-Ereignis-Firmen",
               sg["firmen_mit_erst_ereignis"] == 5,
               sg["firmen_mit_erst_ereignis"], 5)
        pruefe("S-G hat KEINEN Kennungswechsel - die Kontrollgruppe traegt",
               sg[KLASSE_B] == 0, sg[KLASSE_B], 0)
        pruefe("S-G ist bei drei Firmen reif, S-U nur bei einer",
               (sg["fallzahl"], su["fallzahl"]) == (3, 1),
               (sg["fallzahl"], su["fallzahl"]), (3, 1))
        pruefe("S-G verliert dieselben echten Ausfaelle wie S-U",
               (sg[KLASSE_A], sg[KLASSE_C]) == (1, 1),
               (sg[KLASSE_A], sg[KLASSE_C]), (1, 1))

        # W3: die Ausgabe-Sperre - in beide Richtungen.
        umschlag = _beispiel_umschlag(baender)
        pruefe("die gueltige Ausgabe geht DURCH", pruefe_ausgabe(umschlag) is True)
        pruefe("ein geleckter Kennungsname fliegt auf",
               _fliegt_auf(umschlag, ["baender", "2017-2019", "varianten", "S-U",
                                      "signal"], "quelle_name", "Revenues"))
        pruefe("ein geleckter Wachstumswert fliegt am Typ auf",
               _fliegt_auf(umschlag, ["baender", "2017-2019", "varianten", "S-U",
                                      "signal"], "fallzahl", 1.53))
        pruefe("eine Quote ausserhalb [0,1] fliegt auf",
               _fliegt_auf(umschlag, ["baender", "2017-2019", "varianten", "S-U",
                                      "signal"], "auffindbarkeit", 4.2))
        pruefe("eine WEGGELASSENE Pflichtgroesse fliegt auch auf",
               _fliegt_ohne(umschlag, ["baender", "2017-2019", "varianten", "S-U",
                                       "signal"], KLASSE_B))
        pruefe("ein geleckter Zaehler in der JAHRESachse fliegt auf",
               _fliegt_auf(umschlag, ["baender", "2017-2019", "varianten", "S-U",
                                      "signal", "je_jahr_accepted", "2018"],
                           "mittleres_wachstum", 0.42))
        pruefe("eine Ausgabe ohne Baender besteht die Pruefung NICHT",
               _fliegt(dict(umschlag, baender={})))

        # R4: kein Ergebniswert, keine Firmen-Kennung im Output.
        roh = json.dumps(umschlag, ensure_ascii=False, sort_keys=True)
        pruefe("kein Folgequartal-Wert im Output (Marker 0.777)",
               "0.777" not in roh)
        lecks = [c for c in (CIK_REIF, CIK_A, CIK_B1, CIK_B2, CIK_C) if c in roh]
        pruefe("keine Firmen-Kennung im Output", not lecks, lecks, [])
        pruefe("kein Umsatz-Kennungsname im Output",
               "Revenues" not in roh and "SalesRevenueNet" not in roh)

        # Blockinvarianten: die Zerlegung muss aufgehen, sonst rot.
        pruefe("eine Zerlegung, die nicht aufgeht, bricht ab",
               _invariante_bricht(dict(su, **{KLASSE_A: su[KLASSE_A] + 1})))
        pruefe("eine hypothetische Fallzahl neben Klasse (b) bricht ab",
               _invariante_bricht(dict(
                   su, hypothetische_fallzahl_anschlussfaehig=su["fallzahl"])))

        # Die Sperrzone bleibt zu - auch mit gueltiger Freigabe.
        pruefe("das Endtest-Fenster wird nicht geoeffnet",
               _sperrzone_haelt())
        with open(os.path.abspath(__file__), encoding="utf-8") as f:
            quelle = f.read().lower()
        # Die Suchbegriffe werden zur Laufzeit zusammengesetzt, sonst stuende der
        # Test in seinem eigenen Suchraum und waere immer rot. Erste Fassung war
        # genau das (dieselbe Falle wie in der Zaehlprobe).
        verboten = ("de" + "crypt", "aes" + "-256", "ci" + "pher", "un" + "seal",
                    "open" + "ssl")
        gefunden = [w for w in verboten if w in quelle]
        pruefe("diese Datei enthaelt keinen Entschluesselungs-Aufruf",
               not gefunden, gefunden, "keine Fundstelle")
    finally:
        shutil.rmtree(verzeichnis, ignore_errors=True)

    if FEHLER:
        print("\nSELBSTTEST ROT — " + str(len(FEHLER)) + " Pruefung(en) gescheitert:")
        for name in FEHLER:
            print("  - " + name)
        return 1
    print("\nSELBSTTEST GRUEN — alle Pruefungen bestanden.")
    return 0


def _beispiel_umschlag(baender):
    return {
        "schema": SCHEMA, "protokoll": zp.PROTOKOLL, "runId": "selbsttest",
        "fenster": "pruefung", "panelRand": "2020-12-31", "perzentil": zp.PERZENTIL,
        "serverConfirmedAt": "2026-08-19T00:00:00.000Z",
        "accessedAt": "2026-08-19T00:00:01.000Z",
        "ersterZugriffAm": "2026-08-19T00:00:02.000Z",
        "beendetAm": "2026-08-19T00:00:03.000Z",
        "gelesenePfade": [], "geschriebenePfade": [], "ergebnisdatenBeruehrt": False,
        "siegelWache": {}, "manifestGeprueft": [], "umgebung": {},
        "ankerGeprueft": [], "baender": baender,
    }


def _tief(umschlag, pfad):
    ziel = json.loads(json.dumps(umschlag))
    knoten = ziel
    for teil in pfad:
        knoten = knoten[teil]
    return ziel, knoten


def _fliegt(umschlag):
    try:
        pruefe_ausgabe(umschlag)
    except DiagnoseFehler:
        return True
    return False


def _fliegt_auf(umschlag, pfad, feld, wert):
    ziel, knoten = _tief(umschlag, pfad)
    knoten[feld] = wert
    return _fliegt(ziel)


def _fliegt_ohne(umschlag, pfad, feld):
    ziel, knoten = _tief(umschlag, pfad)
    del knoten[feld]
    return _fliegt(ziel)


def _invariante_bricht(block):
    try:
        pruefe_blockinvarianten(block)
    except DiagnoseFehler:
        return True
    return False


def _sperrzone_haelt():
    try:
        lauf("endtest", None)
    except DiagnoseFehler as fehler:
        return "SPERRZONE-STOPP" in str(fehler)
    return False


def haupt(argv=None):
    p = argparse.ArgumentParser(description="E4a — Klassen-Zerlegung der Reife")
    p.add_argument("--fenster", choices=sorted(BAENDER))
    p.add_argument("--freigabe", help="Freigabe-Protokoll aus studie-r1-serverzeit.js")
    p.add_argument("--data-root")
    p.add_argument("--arbeit")
    p.add_argument("--ziel")
    p.add_argument("--ohne-siegel-hash", action="store_true",
                   help="Siegel nur ueber die Byte-Zahl pruefen (5 GB sha256 dauert)")
    p.add_argument("--allowlist-ausgeben", action="store_true",
                   help="die Ausgabe-Allowlist als JSON — Eingabe fuer die Anmeldung")
    p.add_argument("--selbsttest", action="store_true")
    a = p.parse_args(argv)
    if a.allowlist_ausgeben:
        print(json.dumps(sorted(ZAEHL_FELDER + QUOTEN_FELDER), ensure_ascii=False,
                         indent=1))
        return 0
    if a.selbsttest:
        return selbsttest()
    if not a.fenster:
        p.error("--fenster wird gebraucht (oder --selbsttest)")
    ausgabe = lauf(a.fenster, a.freigabe, data_root=a.data_root, arbeit=a.arbeit,
                   ziel=a.ziel, siegel_voll=not a.ohne_siegel_hash)
    print(json.dumps(ausgabe["baender"], ensure_ascii=False, indent=1,
                     sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(haupt())

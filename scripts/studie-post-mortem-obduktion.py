#!/usr/bin/env python
"""Explorative Obduktion - Wachstums-Persistenz der Folgequartale. Ein Zaehl-Lauf.

DIE FRAGE (Karls 89,3-%-Wunsch in seiner SANKTIONIERTEN Form, ENTSCHIED 45):
Auf den Firmen, die ihre vier Folgequartale ueberhaupt geliefert haben - hielt
das Wachstum, das das Signal im Feuerungsquartal zertifiziert hat? Und hielt es
im Signal-Arm haeufiger als im Kontrollpool?

WAS HIER NICHT GEFRAGT WIRD - und nie gefragt werden darf: ob der KURS gestiegen
ist. R4 sperrt diese Signalfamilie DAUERHAFT von Kurs-, Rendite- und
Preis-Endpunkten ("NIE wieder - auch nicht in Folgeprotokollen, auch nicht
sekundaer", rules.json R4 endpunktSperren). Der einzige registrierte Anspruch von
FEM-SEC-US@2.0.0 ist die Wachstums-Persistenz der Folgequartale, und genau der
wird hier gemessen. Der Laufzeit-Check gegen lib/studie-verfassung.js::
pruefeEndpunktKlasse laeuft in pruefe_endpunktklasse() - er ist keine Zierde,
sondern die Bedingung, unter der dieser Lauf ueberhaupt starten darf.

DIE PERSISTENZ-DEFINITION IST KEIN NEUER KNOPF. Das Signal feuert unter anderem
unter Bedingung (c) `g(t) > 0` (studie-basisraten.py::signale) - echtes Wachstum,
kein langsameres Schrumpfen. Die Obduktion legt GENAU DIESE Bedingung auf die
vier Folgequartale: Persistenz JA heisst `g > 0` in ALLEN vier, gemessen auf
DERSELBEN Quellen-Basis wie die Feuerung. Eine eigene Schwelle waere eine zweite
Schwelle fuer dieselbe Sache - also keine. Traegt auch nur ein Folgequartal
keinen berechenbaren g-Wert, ist die Firma UNENTSCHEIDBAR und faellt aus dem
Nenner; sie wird nicht stillschweigend als "nein" verbucht.

DER PFLICHT-STEMPEL (im Register-Eintragstext gehasht, auf JEDER Ausgabe):
"bekannte Ueberlebens-Verzerrung, Obergrenzen-Lesart". Die fehlenden 10,7 % sind
NICHT zufaellig - Verlierer verschwinden oefter. Jede hier berichtete Rate ist
deshalb eine OBERGRENZE und keine Punktschaetzung.

EXPLORATIV - NIEMALS KONFIRMATORISCH. Dieser Lauf erzeugt kein Verdikt, bewegt
keine Schwelle, aendert keine Praeregistrierung und darf in keiner spaeteren
Argumentation als Bestaetigung zitiert werden. Er gehoert zum Nachlass, nicht
zum Verfahren (ENTSCHIED 45). Das Endtest-Fenster bleibt versiegelt: es wird
nicht geoeffnet, nicht gelesen, nicht gezaehlt.

WOHER DER CODE KOMMT: Signaldefinition, Reifedefinition, Wachstum und saemtliche
Waechter werden aus scripts/studie-e4a-diagnose.py, scripts/studie-zaehlprobe.py
und scripts/studie-basisraten.py IMPORTIERT, nicht nachgebaut - dieselbe
Datenstrecke wie E4g/E4h. Ein Nachbau haette die Population auseinanderlaufen
lassen.

Aufruf:
  python scripts/studie-post-mortem-obduktion.py --selbsttest
  python scripts/studie-post-mortem-obduktion.py --allowlist-ausgeben
  python scripts/studie-post-mortem-obduktion.py --freigabe <freigabe.json> --ziel <report.json>
"""

import argparse
import importlib.util
import json
import os
import platform
import sqlite3
import subprocess
import sys
from collections import defaultdict

WURZEL = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
E4A_SKRIPT = os.path.join(WURZEL, "scripts", "studie-e4a-diagnose.py")
REGELWERK = os.path.join(WURZEL, "protocol", "early-detection", "2.0.0", "rules.json")
VERFASSUNG_JS = os.path.join(WURZEL, "lib", "studie-verfassung.js")

SCHEMA = "early-detection-post-mortem-obduktion/v1"
FENSTER_NAME = "pruefung"
VARIANTE = "S-G"
BAND = (2017, 2019)

# Der Endpunkt. Er steht hier als Konstante, damit die R4-Pruefung etwas zu
# pruefen hat, das im Code steht und nicht im Aufruf - ein per Flag gesetzter
# Endpunkt waere eine Sperre, die sich wegkonfigurieren laesst.
ENDPUNKT = "wachstums_persistenz_folgequartale"

# Der Pflicht-Stempel. Er steht in JEDER Ausgabe dieses Laufs - Umschlag wie
# Markdown. Wer ihn entfernt, faellt in pruefe_ausgabe() auf.
STEMPEL = ("bekannte Ueberlebens-Verzerrung, Obergrenzen-Lesart: die fehlenden "
           "10,7 % sind nicht zufaellig, Verlierer verschwinden oefter - jede "
           "hier berichtete Rate ist eine OBERGRENZE, keine Punktschaetzung")

# ── Die Ausgabe-Allowlist ────────────────────────────────────────────────────
# EXAKT die 14 Felder, die der Register-Eintrag
# post-mortem-explorativ-pruefung-2026-08-30 unter `allowedOutputs` fuehrt. Die
# Gleichheit wird in pruefe_anmeldung_deckt_ausgabe() in BEIDE Richtungen
# geprueft: ein Feld mehr ist ein Leck, ein Feld weniger eine stille
# Entschaerfung. Alle 14 sind Firmen-ZAHLEN oder daraus gebildete Raten - kein
# Umsatz, kein Gewinn, keine Aktienzahl, kein Kurs, keine Kennung.
DATEN_FELDER = (
    "differenz_persistenz_rate",
    "fallzahl",
    "folgequartale_verfuegbar",
    "folgequartale_zensiert",
    "kontrollpool_firmen",
    "nenner_persistenz",
    "nenner_verfolgbarkeit",
    "persistenz_ja",
    "persistenz_nein",
    "persistenz_rate",
    "persistenz_rate_kontrolle",
    "signal_arm_firmen",
    "unentscheidbar_gesamt",
    "verfolgbare_firmen",
)

# Zaehler je Arm. Ganze, nicht-negative Zahlen.
ARM_ZAEHLER = ("fallzahl", "folgequartale_verfuegbar", "folgequartale_zensiert",
               "nenner_persistenz", "nenner_verfolgbarkeit", "persistenz_ja",
               "persistenz_nein", "unentscheidbar_gesamt", "verfolgbare_firmen")
# Raten je Arm. Zahlen in [0, 1] oder None, wenn der Nenner null ist - eine Rate
# ohne Nenner wird NICHT als 0.0 ausgegeben, das waere eine erfundene Null.
ARM_RATEN = ("persistenz_rate",)
ARM_BLOCK = tuple(sorted(ARM_ZAEHLER + ARM_RATEN))
ARME = ("kontrolle", "signal")

# Felder auf oberster Ebene: die Arm-Groessen und der Arm-Vergleich.
OBEN_ZAEHLER = ("signal_arm_firmen", "kontrollpool_firmen")
OBEN_RATEN = ("persistenz_rate_kontrolle", "differenz_persistenz_rate")

UMSCHLAG_ALLOWLIST = (
    "accessedAt", "arme", "beendetAm", "endpunkt", "endpunktGeprueft",
    "ergebnisdatenBeruehrt", "ersterZugriffAm", "fenster", "gelesenePfade",
    "geschriebenePfade", "kontrollpool_firmen", "lesart", "manifestGeprueft",
    "panelRand", "perzentil", "persistenzRegel", "protokoll", "runId", "schema",
    "selbstCheck", "serverConfirmedAt", "siegelWache", "signal_arm_firmen",
    "umgebung", "variante", "differenz_persistenz_rate",
    "persistenz_rate_kontrolle",
)

# Die committeten E4a-Zahlen (reports/studie/E4a-diagnose-pruefung-2026-08-19.json,
# Band 2017-2019, Variante S-G). Der Register-Eintrag verlangt fuer die Obduktion
# KEINE Populations-Sollzahl - dieser Check laeuft trotzdem mit, weil er nichts
# kostet und eine auseinandergelaufene Rekonstruktion sofort sichtbar macht.
# Er wird NICHT an die Sollzahl angepasst; er bricht ab.
ANKER = {
    "signal": {"reif": 326, "unreif": 39},
    "kontrolle": {"reif": 4285, "unreif": 448},
}
ANKER_QUELLE = "reports/studie/E4a-diagnose-pruefung-2026-08-19.json"


class ObduktionsFehler(Exception):
    """Ein Befund, der den Lauf anhaelt - nie ein stiller Rueckfall."""


def lade(pfad, name):
    spec = importlib.util.spec_from_file_location(name, pfad)
    if spec is None or spec.loader is None:
        raise ObduktionsFehler("Skript nicht ladbar: " + pfad)
    modul = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(modul)
    return modul


e4a = lade(E4A_SKRIPT, "studie_e4a_diagnose")
zp = e4a.zp                      # EINE Instanz, nicht zwei - sonst laufen die
                                 # Konstanten der beiden Ladungen auseinander.


# ── R4: die Endpunkt-Sperre ──────────────────────────────────────────────────

def pruefe_endpunktklasse(endpunkt=ENDPUNKT, regelwerk_pfad=REGELWERK,
                          js_pfad=VERFASSUNG_JS):
    """R4-Laufzeit-Check gegen die AUTHORITATIVE Implementierung.

    Bewusst KEIN Python-Nachbau: `pruefeEndpunktKlasse` lebt in
    lib/studie-verfassung.js, und eine zweite Implementierung derselben Sperre
    waere eine zweite Sperre - also keine. Der Aufruf geht deshalb durch node
    gegen genau die Funktion, die auch die Verfassung durchsetzt.

    Fail-closed in JEDE Richtung: kein node, kaputtes Regelwerk, leere
    Sperrliste, Fehler im Aufruf - alles ist ein ABBRUCH, nie ein Durchwinken."""
    programm = (
        "const {pruefeEndpunktKlasse}=require(process.argv[1]);"
        "const regelwerk=require(process.argv[2]);"
        "pruefeEndpunktKlasse(process.argv[3], regelwerk);"
        "process.stdout.write('ENDPUNKT_ERLAUBT');"
    )
    try:
        ergebnis = subprocess.run(
            ["node", "-e", programm, js_pfad, regelwerk_pfad, endpunkt],
            capture_output=True, text=True, timeout=120)
    except (OSError, subprocess.SubprocessError) as fehler:
        raise ObduktionsFehler(
            "R4-ABBRUCH: die Endpunkt-Sperre konnte nicht ausgefuehrt werden ("
            + str(fehler) + "). Ein Lauf, der seine eigene Sperre nicht pruefen "
            "kann, laeuft nicht.")
    if ergebnis.returncode != 0 or ergebnis.stdout.strip() != "ENDPUNKT_ERLAUBT":
        raise ObduktionsFehler(
            "R4-ABBRUCH: Endpunkt " + repr(endpunkt) + " ist nicht zulaessig oder "
            "die Pruefung schlug fehl. node sagt: "
            + (ergebnis.stderr or ergebnis.stdout or "(keine Ausgabe)").strip())
    return True


# ── Die Persistenz-Sonde ─────────────────────────────────────────────────────

def folgequartale(f, gewaehlt, e2):
    """Die Folgequartale DERSELBEN Quellen-Basis, aufsteigend, gedeckelt auf vier.

    Wortgleich die Auswahl aus studie-basisraten.py::erst_ereignisse - dort
    werden sie GEZAEHLT, hier werden dieselben Stichtage AUFGEZAEHLT. Der
    Naht-Waechter `basis_gleich` vergleicht auch hier wirklich: die gewaehlte
    Reihe darf ueber die Zeit die Quelle wechseln, und ein Folgequartal aus einer
    anderen Quelle traegt die Persistenz-Aussage nicht."""
    reihe = gewaehlt.get(f["cik"], {})
    stichtage = sorted(d for d, eintrag in reihe.items()
                       if d > f["ddate"] and e2.basis_gleich(eintrag[3], f["basis"]))
    return stichtage[:e2.REIFE_QUARTALE]


def persistenz(f, gewaehlt, g_index, e2):
    """Hielt das Wachstum ueber die vier Folgequartale?

    Die Regel ist Bedingung (c) des Signals, vorwaerts gelegt: `g > 0` in ALLEN
    vier Folgequartalen. Rueckgabe: (befund, verfuegbar, zensiert) mit befund aus
    {"ja", "nein", "unentscheidbar"}.

    Ein Folgequartal ohne berechenbaren g-Wert (nenner_null,
    kein_vorjahrespartner) macht die Firma UNENTSCHEIDBAR - es wird NICHT als
    "nein" verbucht. Der Unterschied ist der ganze Punkt: "wir wissen es nicht"
    ist keine Antwort, und eine Obduktion, die Unwissen als Misserfolg zaehlt,
    faelscht die Rate nach unten."""
    stichtage = folgequartale(f, gewaehlt, e2)
    verfuegbar, zensiert, alle_positiv = 0, 0, True
    for d in stichtage:
        eintrag = g_index.get((f["cik"], d))
        if eintrag is None or not e2.basis_gleich(eintrag["basis"], f["basis"]):
            zensiert += 1
            continue
        verfuegbar += 1
        if not eintrag["g"] > 0:
            alle_positiv = False
    # Slots, die es gar nicht erst gab (Firma hat weniger als vier
    # Folgequartale), zaehlen ebenfalls als zensiert - sonst waere
    # verfuegbar + zensiert nicht 4 je Firma und die Summe nicht pruefbar.
    zensiert += e2.REIFE_QUARTALE - len(stichtage)
    if zensiert:
        return "unentscheidbar", verfuegbar, zensiert
    return ("ja" if alle_positiv else "nein"), verfuegbar, zensiert


def leerer_arm():
    return {"fallzahl": 0, "folgequartale_verfuegbar": 0,
            "folgequartale_zensiert": 0, "nenner_persistenz": 0,
            "nenner_verfolgbarkeit": 0, "persistenz_ja": 0, "persistenz_nein": 0,
            "persistenz_rate": None, "unentscheidbar_gesamt": 0,
            "verfolgbare_firmen": 0}


def zerlege_arm(reif, unreif, gewaehlt, g_index, e2):
    """Ein Arm, Firma fuer Firma. Es entsteht KEINE Zeilenliste.

    E4g gab je Firma eine Etiketten-Zeile aus; hier ist das nicht noetig und
    deshalb auch nicht erlaubt - der Register-Eintrag fuehrt ausschliesslich
    Aggregatfelder. Was den Umschlag verlaesst, sind Summen."""
    b = leerer_arm()
    b["fallzahl"] = len(reif)
    b["verfolgbare_firmen"] = len(reif)
    b["nenner_verfolgbarkeit"] = len(reif) + len(unreif)
    for f in reif:
        befund, verfuegbar, zensiert = persistenz(f, gewaehlt, g_index, e2)
        b["folgequartale_verfuegbar"] += verfuegbar
        b["folgequartale_zensiert"] += zensiert
        if befund == "unentscheidbar":
            b["unentscheidbar_gesamt"] += 1
        elif befund == "ja":
            b["persistenz_ja"] += 1
        else:
            b["persistenz_nein"] += 1
    b["nenner_persistenz"] = b["persistenz_ja"] + b["persistenz_nein"]
    b["persistenz_rate"] = (None if b["nenner_persistenz"] == 0
                            else b["persistenz_ja"] / float(b["nenner_persistenz"]))
    return b


def pruefe_arminvarianten(b, e2):
    """Was arithmetisch gelten MUSS, wird nachgerechnet statt geglaubt."""
    if b["verfolgbare_firmen"] != b["fallzahl"]:
        raise ObduktionsFehler(
            "INVARIANTE: verfolgbare_firmen != fallzahl - beide zaehlen die Firmen "
            "mit reifem Erst-Ereignis.")
    if b["nenner_verfolgbarkeit"] < b["verfolgbare_firmen"]:
        raise ObduktionsFehler(
            "INVARIANTE: der Verfolgbarkeits-Nenner ist kleiner als seine eigene "
            "Teilmenge.")
    zerlegung = b["persistenz_ja"] + b["persistenz_nein"] + b["unentscheidbar_gesamt"]
    if zerlegung != b["verfolgbare_firmen"]:
        raise ObduktionsFehler(
            "INVARIANTE: ja + nein + unentscheidbar (" + str(zerlegung) + ") deckt "
            "die verfolgbaren Firmen (" + str(b["verfolgbare_firmen"]) + ") nicht. "
            "Eine Firma ist verlorengegangen oder doppelt gezaehlt.")
    slots = b["folgequartale_verfuegbar"] + b["folgequartale_zensiert"]
    if slots != b["verfolgbare_firmen"] * e2.REIFE_QUARTALE:
        raise ObduktionsFehler(
            "INVARIANTE: verfuegbare + zensierte Folgequartale (" + str(slots)
            + ") sind nicht " + str(e2.REIFE_QUARTALE) + " je verfolgbarer Firma ("
            + str(b["verfolgbare_firmen"] * e2.REIFE_QUARTALE) + ").")
    if b["nenner_persistenz"] != b["persistenz_ja"] + b["persistenz_nein"]:
        raise ObduktionsFehler("INVARIANTE: der Persistenz-Nenner passt nicht zu ja+nein.")
    return True


# ── Der Lauf ─────────────────────────────────────────────────────────────────

def obduktion(panel, arbeit_pfad, e2):
    """Dieselbe Datenstrecke wie studie-e4g-restursachen.py::restursachen -
    gelesen, nicht geraten. Nur der letzte Schritt ist ein anderer: statt der
    Restursachen der VERLUSTE entsteht die Persistenz der VERFOLGBAREN."""
    fenster = zp.FENSTER[FENSTER_NAME]
    if zp.REIFE_QUARTALE != e2.REIFE_QUARTALE:
        raise ObduktionsFehler(
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

    alle, gewaehlt = e2.firmenreihen(je_firma, e2.ERGEBNIS_QUELLEN, False,
                                     zaehler, "betriebsergebnis_")
    g_saetze, a_saetze = e2.wachstum_und_beschleunigung(alle, zaehler,
                                                        "betriebsergebnis_")
    # Der g-Index ist der einzige Grund, warum g_saetze hier ueberhaupt
    # gebraucht wird: er beantwortet "hielt das Wachstum in Quartal X?" ohne
    # dass ein einziger g-Wert den Umschlag verlaesst.
    g_index = dict(((s["cik"], s["ddate"]), s) for s in g_saetze)

    feuerungen, auswertbar, _grenzen = e2.signale(a_saetze, zp.PERZENTIL, zaehler,
                                                   "betriebsergebnis_")
    band_f = [f for f in feuerungen if e4a.e2_im_band(f, e2, BAND[0], BAND[1])]
    band_a = [a for a in auswertbar if e4a.e2_im_band(a, e2, BAND[0], BAND[1])]
    signalfirmen = set(f["cik"] for f in band_f)
    kontroll = [a for a in band_a if a["cik"] not in signalfirmen]

    arme = {}
    for name, eintraege in (("signal", band_f), ("kontrolle", kontroll)):
        reif, unreif = e2.erst_ereignisse(eintraege, gewaehlt)
        pruefe_anker(name, len(reif), len(unreif))
        arme[name] = zerlege_arm(reif, unreif, gewaehlt, g_index, e2)
        pruefe_arminvarianten(arme[name], e2)
    return arme


def pruefe_anker(arm, reif, unreif):
    """Der Konsistenz-Check gegen die committeten E4a-Zahlen.

    Der Register-Eintrag der Obduktion verlangt KEINE Populations-Sollzahl - er
    verlangt, dass jede Rate als Obergrenze gelesen wird. Dieser Check laeuft
    trotzdem: dieselbe Population traegt seit E4a/E4g/E4h dieselben Zahlen, und
    eine Rekonstruktion, die davon abweicht, misst etwas anderes als sie
    behauptet. Bei Abweichung wird ABGEBROCHEN und NICHT angepasst."""
    soll = ANKER[arm]
    if reif != soll["reif"] or unreif != soll["unreif"]:
        raise ObduktionsFehler(
            "ANKER_ABBRUCH (SOFORT-STOPP, Eskalation an den Orchestrator): Arm "
            + arm + " ergibt " + str(reif) + " reife und " + str(unreif)
            + " unreife Erst-Ereignisse; die committeten E4a-Zahlen sind "
            + str(soll["reif"]) + " und " + str(soll["unreif"]) + " ("
            + ANKER_QUELLE + "). Es wird NICHT weitergerechnet und die "
            "Rekonstruktion NICHT an die Sollzahl angepasst.")
    return True


# ── Waechter ─────────────────────────────────────────────────────────────────

def pruefe_anmeldung_deckt_ausgabe(freigabe, register_pfad=None):
    """W9: was ausgegeben wird, muss angemeldet sein - Feld fuer Feld, in BEIDE
    Richtungen. Ein Feld mehr ist ein Leck, ein Feld weniger eine stille
    Entschaerfung."""
    pfad = register_pfad or zp.REGISTER
    with open(pfad, encoding="utf-8") as f:
        register = json.load(f)
    treffer = [e for e in (register.get("events") or [])
               if e.get("runId") == freigabe["runId"]]
    if len(treffer) != 1:
        raise ObduktionsFehler(
            "W9-ABBRUCH: runId " + repr(freigabe["runId"]) + " steht "
            + str(len(treffer)) + "-mal im Zugriffs-Register.")
    angemeldet = set(treffer[0].get("allowedOutputs") or ())
    erlaubt = set(DATEN_FELDER)
    if angemeldet != erlaubt:
        raise ObduktionsFehler(
            "W9-ABBRUCH: die Anmeldung deckt die Ausgabe nicht. Nur im Skript: "
            + str(sorted(erlaubt - angemeldet)) + "; nur im Register: "
            + str(sorted(angemeldet - erlaubt)) + ".")
    return True


def pruefe_zahl(wert, feld, ort, rate=False):
    if rate:
        if wert is None:
            return
        if isinstance(wert, bool) or not isinstance(wert, (int, float)):
            raise ObduktionsFehler("W3-ABBRUCH: " + ort + "." + feld
                                   + " ist keine Rate: " + repr(wert))
        if not -1.0 <= float(wert) <= 1.0:
            raise ObduktionsFehler(
                "W3-ABBRUCH: " + ort + "." + feld + " liegt ausserhalb [-1, 1]: "
                + repr(wert) + ". Eine Rate, die das verlaesst, ist keine Rate - "
                "und ein durchgereichter Roh- oder Kurswert faellt hier auf.")
        return
    if isinstance(wert, bool) or not isinstance(wert, int) or wert < 0:
        raise ObduktionsFehler(
            "W3-ABBRUCH: " + ort + "." + feld + " ist kein nicht-negativer "
            "Zaehler: " + repr(wert) + ". Zaehler sind ganze Firmen- oder "
            "Quartalszahlen; alles andere waere ein durchgereichter Messwert.")


def pruefe_ausgabe(ausgabe):
    """W3: die Ergebnis-Sperre. Jeder nicht gelistete Schluessel ist ein ABBRUCH,
    in BEIDE Richtungen - plus eine TYPPRUEFUNG, damit ein Umsatz-, Gewinn- oder
    Kurswert auch dann auffliegt, wenn er sich unter einem erlaubten Namen
    versteckt."""
    fremd = set(ausgabe) - set(UMSCHLAG_ALLOWLIST)
    if fremd:
        raise ObduktionsFehler(
            "W3-ABBRUCH: nicht angemeldete Umschlag-Schluessel: "
            + str(sorted(fremd)))
    fehlend = set(UMSCHLAG_ALLOWLIST) - set(ausgabe)
    if fehlend:
        raise ObduktionsFehler(
            "W3-ABBRUCH: fehlende Umschlag-Schluessel: " + str(sorted(fehlend)))
    if ausgabe.get("lesart") != STEMPEL:
        raise ObduktionsFehler(
            "STEMPEL-ABBRUCH: der Pflicht-Stempel steht nicht woertlich in der "
            "Ausgabe. Er ist im Register-Eintragstext gehasht und keine "
            "Formsache - ohne ihn liest jemand eine Obergrenze als Punktwert.")
    if ausgabe.get("endpunkt") != ENDPUNKT:
        raise ObduktionsFehler(
            "R4-ABBRUCH: die Ausgabe nennt einen anderen Endpunkt als den "
            "geprueften.")
    if ausgabe.get("ergebnisdatenBeruehrt") is not False:
        raise ObduktionsFehler("W3-ABBRUCH: ergebnisdatenBeruehrt muss False sein.")
    for feld in OBEN_ZAEHLER:
        pruefe_zahl(ausgabe.get(feld), feld, "oben")
    for feld in OBEN_RATEN:
        pruefe_zahl(ausgabe.get(feld), feld, "oben", rate=True)
    if set(ausgabe.get("arme") or {}) != set(ARME):
        raise ObduktionsFehler("W3-ABBRUCH: die Arme sind nicht genau "
                               + str(sorted(ARME)))
    for arm in ARME:
        block = ausgabe["arme"][arm]
        if set(block) != set(ARM_BLOCK):
            raise ObduktionsFehler(
                "W3-ABBRUCH: Arm " + arm + " traegt nicht genau die angemeldeten "
                "Felder. Zuviel: " + str(sorted(set(block) - set(ARM_BLOCK)))
                + "; zu wenig: " + str(sorted(set(ARM_BLOCK) - set(block))))
        for feld in ARM_ZAEHLER:
            pruefe_zahl(block[feld], feld, "arme." + arm)
        for feld in ARM_RATEN:
            pruefe_zahl(block[feld], feld, "arme." + arm, rate=True)
    return True


def lauf(freigabe_pfad, data_root=None, arbeit=None, ziel=None, siegel_voll=True,
         panel_pfad=None, register_pfad=None):
    fenster = zp.FENSTER[FENSTER_NAME]
    if fenster["sperrzone"]:
        raise ObduktionsFehler("SPERRZONE-STOPP: " + FENSTER_NAME)

    del zp.GEOEFFNETE_PFADE[:]
    del zp.GESCHRIEBENE_PFADE[:]

    # R4 ZUERST. Ein Lauf, dessen Endpunkt gesperrt ist, darf das Panel nicht
    # einmal oeffnen - die Sperre steht vor der Tuer, nicht dahinter.
    pruefe_endpunktklasse()

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
        wurzel, "arbeit", "Obduktion-" + FENSTER_NAME + "-zwischenstand.sqlite")

    e2 = zp.lade_modul(zp.E2_SKRIPT, "studie_basisraten")
    panel = zp.oeffne_nur_lesend(panel_pfad, FENSTER_NAME)
    try:
        arme = obduktion(panel, arbeit_pfad, e2)
    finally:
        panel.close()

    s, k = arme["signal"], arme["kontrolle"]
    differenz = (None if s["persistenz_rate"] is None or k["persistenz_rate"] is None
                 else s["persistenz_rate"] - k["persistenz_rate"])
    ausgabe = {
        "schema": SCHEMA,
        "protokoll": zp.PROTOKOLL,
        "runId": freigabe["runId"],
        "fenster": FENSTER_NAME,
        "variante": VARIANTE,
        "endpunkt": ENDPUNKT,
        "endpunktGeprueft": "lib/studie-verfassung.js::pruefeEndpunktKlasse",
        "lesart": STEMPEL,
        "persistenzRegel": (
            "Persistenz JA <=> g > 0 in ALLEN " + str(e2.REIFE_QUARTALE)
            + " Folgequartalen derselben Quellen-Basis. Das ist Bedingung (c) des "
            "Signals (studie-basisraten.py::signale) vorwaerts gelegt, keine neue "
            "Schwelle. Ein Folgequartal ohne berechenbaren g-Wert macht die Firma "
            "unentscheidbar; sie faellt aus dem Nenner statt als 'nein' zu zaehlen."),
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
            "sollReifSignal": ANKER["signal"]["reif"],
            "istReifSignal": s["verfolgbare_firmen"],
            "sollUnreifSignal": ANKER["signal"]["unreif"],
            "istUnreifSignal": s["nenner_verfolgbarkeit"] - s["verfolgbare_firmen"],
            "sollReifKontrolle": ANKER["kontrolle"]["reif"],
            "istReifKontrolle": k["verfolgbare_firmen"],
            "sollUnreifKontrolle": ANKER["kontrolle"]["unreif"],
            "istUnreifKontrolle": k["nenner_verfolgbarkeit"] - k["verfolgbare_firmen"],
            "bestanden": True,
        },
        "signal_arm_firmen": s["nenner_verfolgbarkeit"],
        "kontrollpool_firmen": k["nenner_verfolgbarkeit"],
        "persistenz_rate_kontrolle": k["persistenz_rate"],
        "differenz_persistenz_rate": differenz,
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
    except ObduktionsFehler:
        return True
    return False


class _E2:
    """Ein Mini-E2 fuer die Sonden-Tests. Nur was die Sonde anfasst."""
    REIFE_QUARTALE = 4

    @staticmethod
    def basis_gleich(a, b):
        return a == b


def _firma(cik="1", ddate="20180331", basis=("OperatingIncomeLoss", "USD")):
    return {"cik": cik, "ddate": ddate, "basis": basis}


def _reihe(ddates, basis=("OperatingIncomeLoss", "USD")):
    return dict((d, (1.0, "2018-05-01", "q", basis)) for d in ddates)


def _g(cik, ddate, g, basis=("OperatingIncomeLoss", "USD")):
    return {"cik": cik, "ddate": ddate, "g": g, "basis": basis}


def _gueltige_ausgabe():
    arm = {"fallzahl": 2, "folgequartale_verfuegbar": 8,
           "folgequartale_zensiert": 0, "nenner_persistenz": 2,
           "nenner_verfolgbarkeit": 3, "persistenz_ja": 1, "persistenz_nein": 1,
           "persistenz_rate": 0.5, "unentscheidbar_gesamt": 0,
           "verfolgbare_firmen": 2}
    return {
        "schema": SCHEMA, "protokoll": "FEM-SEC-US@2.0.0", "runId": "test",
        "fenster": FENSTER_NAME, "variante": VARIANTE, "endpunkt": ENDPUNKT,
        "endpunktGeprueft": "lib/studie-verfassung.js::pruefeEndpunktKlasse",
        "lesart": STEMPEL, "persistenzRegel": "regel", "panelRand": "2020-12-31",
        "perzentil": 95, "serverConfirmedAt": "z", "accessedAt": "z",
        "ersterZugriffAm": "z", "beendetAm": "z", "gelesenePfade": [],
        "geschriebenePfade": [], "ergebnisdatenBeruehrt": False,
        "siegelWache": {}, "manifestGeprueft": [], "umgebung": {},
        "selbstCheck": {}, "signal_arm_firmen": 3, "kontrollpool_firmen": 3,
        "persistenz_rate_kontrolle": 0.5, "differenz_persistenz_rate": 0.0,
        "arme": {"signal": dict(arm), "kontrolle": dict(arm)},
    }


def selbsttest():
    e2 = _E2()
    print("Obduktion - Selbsttest")

    print(" Persistenz-Sonde")
    f = _firma()
    gew = {"1": _reihe(["20180630", "20180930", "20181231", "20190331"])}
    idx = dict((("1", d), _g("1", d, 0.5)) for d in gew["1"])
    pruefe("vier positive Folgequartale -> ja",
           persistenz(f, gew, idx, e2) == ("ja", 4, 0))

    idx_neg = dict(idx)
    idx_neg[("1", "20181231")] = _g("1", "20181231", -0.1)
    pruefe("ein negatives Folgequartal -> nein",
           persistenz(f, gew, idx_neg, e2) == ("nein", 4, 0))

    idx_null = dict(idx)
    idx_null[("1", "20181231")] = _g("1", "20181231", 0.0)
    pruefe("g == 0 ist KEIN Wachstum -> nein",
           persistenz(f, gew, idx_null, e2) == ("nein", 4, 0))

    idx_fehlt = dict((k, v) for k, v in idx.items() if k[1] != "20181231")
    pruefe("fehlender g-Wert -> unentscheidbar, nicht nein",
           persistenz(f, gew, idx_fehlt, e2) == ("unentscheidbar", 3, 1))

    gew_kurz = {"1": _reihe(["20180630", "20180930"])}
    idx_kurz = dict((("1", d), _g("1", d, 0.5)) for d in gew_kurz["1"])
    pruefe("weniger als vier Folgequartale -> unentscheidbar mit zensierten Slots",
           persistenz(f, gew_kurz, idx_kurz, e2) == ("unentscheidbar", 2, 2))

    # Der Naht-Waechter muss hier wirklich beissen: ein Folgequartal einer
    # ANDEREN Quellen-Basis traegt die Persistenz-Aussage nicht.
    gew_naht = {"1": dict(_reihe(["20180630", "20180930", "20181231"]),
                          **{"20190331": (1.0, "2018-05-01", "q",
                                          ("Revenues", "USD"))})}
    idx_naht = dict((("1", d), _g("1", d, 0.5, gew_naht["1"][d][3]))
                    for d in gew_naht["1"])
    pruefe("Folgequartal fremder Quellen-Basis zaehlt nicht mit",
           persistenz(f, gew_naht, idx_naht, e2) == ("unentscheidbar", 3, 1))

    print(" Arm-Invarianten")
    b = leerer_arm()
    b.update({"fallzahl": 2, "verfolgbare_firmen": 2, "nenner_verfolgbarkeit": 3,
              "persistenz_ja": 1, "persistenz_nein": 1, "nenner_persistenz": 2,
              "folgequartale_verfuegbar": 8, "folgequartale_zensiert": 0})
    pruefe("gueltiger Arm geht durch", pruefe_arminvarianten(b, e2))
    kaputt = dict(b, persistenz_ja=2)
    pruefe("ja+nein+unentscheidbar != verfolgbar bricht ab",
           _bricht(lambda: pruefe_arminvarianten(kaputt, e2)))
    kaputt2 = dict(b, folgequartale_verfuegbar=7)
    pruefe("falsche Slot-Summe bricht ab",
           _bricht(lambda: pruefe_arminvarianten(kaputt2, e2)))

    print(" Anker")
    pruefe("committete E4a-Zahlen gehen durch", pruefe_anker("signal", 326, 39))
    pruefe("abweichende Population bricht ab",
           _bricht(lambda: pruefe_anker("signal", 325, 39)))

    print(" Ausgabe-Sperre")
    pruefe("gueltige Ausgabe geht durch", pruefe_ausgabe(_gueltige_ausgabe()))
    a = _gueltige_ausgabe(); a["kurs_rendite_12m"] = 0.4
    pruefe("Fremdschluessel im Umschlag bricht ab",
           _bricht(lambda: pruefe_ausgabe(a)))
    a = _gueltige_ausgabe(); del a["lesart"]
    pruefe("fehlender Umschlag-Schluessel bricht ab",
           _bricht(lambda: pruefe_ausgabe(a)))
    a = _gueltige_ausgabe(); a["lesart"] = "beliebiger Text"
    pruefe("entfernter Pflicht-Stempel bricht ab",
           _bricht(lambda: pruefe_ausgabe(a)))
    a = _gueltige_ausgabe(); a["arme"]["signal"]["kursrendite"] = 0.3
    pruefe("Fremdfeld im Arm bricht ab", _bricht(lambda: pruefe_ausgabe(a)))
    a = _gueltige_ausgabe(); del a["arme"]["signal"]["persistenz_ja"]
    pruefe("fehlendes Arm-Feld bricht ab", _bricht(lambda: pruefe_ausgabe(a)))
    a = _gueltige_ausgabe(); a["arme"]["signal"]["persistenz_ja"] = 1234567.89
    pruefe("durchgereichter Messwert unter erlaubtem Namen bricht ab",
           _bricht(lambda: pruefe_ausgabe(a)))
    a = _gueltige_ausgabe(); a["arme"]["signal"]["persistenz_rate"] = 42.0
    pruefe("Rate ausserhalb [-1,1] bricht ab", _bricht(lambda: pruefe_ausgabe(a)))
    a = _gueltige_ausgabe(); a["arme"]["signal"]["persistenz_rate"] = None
    pruefe("Rate ohne Nenner darf None sein", pruefe_ausgabe(a))
    a = _gueltige_ausgabe(); a["ergebnisdatenBeruehrt"] = True
    pruefe("ergebnisdatenBeruehrt=True bricht ab", _bricht(lambda: pruefe_ausgabe(a)))

    print(" Allowlist gegen das Register")
    pruefe("die 14 Skript-Felder sind genau die 14 angemeldeten",
           len(DATEN_FELDER) == 14 and len(set(DATEN_FELDER)) == 14)
    abgedeckt = set(ARM_BLOCK) | set(OBEN_ZAEHLER) | set(OBEN_RATEN)
    pruefe("Arm- und Oben-Felder decken die Allowlist genau",
           abgedeckt == set(DATEN_FELDER),
           sorted(abgedeckt), sorted(DATEN_FELDER))
    try:
        pruefe("Anmeldung deckt Ausgabe (echtes Register)",
               pruefe_anmeldung_deckt_ausgabe(
                   {"runId": "post-mortem-explorativ-pruefung-2026-08-30"}))
    except ObduktionsFehler as fehler:
        pruefe("Anmeldung deckt Ausgabe (echtes Register)", False, str(fehler))

    print(" R4-Endpunktsperre")
    try:
        pruefe("registrierter Endpunkt ist erlaubt", pruefe_endpunktklasse())
    except ObduktionsFehler as fehler:
        pruefe("registrierter Endpunkt ist erlaubt", False, str(fehler))
    pruefe("ein Kurs-Endpunkt wird gesperrt",
           _bricht(lambda: pruefe_endpunktklasse("kursrendite_12m")))
    pruefe("ein Rendite-Endpunkt wird gesperrt",
           _bricht(lambda: pruefe_endpunktklasse("return_6m")))

    print()
    if FEHLER:
        print("ROT: " + str(len(FEHLER)) + " Pruefung(en) gescheitert")
        return 1
    print("GRUEN: alle Pruefungen bestanden")
    return 0


def main(argv=None):
    p = argparse.ArgumentParser(description="Explorative Obduktion - Wachstums-Persistenz")
    p.add_argument("--freigabe")
    p.add_argument("--ziel")
    p.add_argument("--data-root")
    p.add_argument("--arbeit")
    p.add_argument("--panel")
    p.add_argument("--register")
    p.add_argument("--siegel-schnell", action="store_true")
    p.add_argument("--selbsttest", action="store_true")
    p.add_argument("--allowlist-ausgeben", action="store_true")
    a = p.parse_args(argv)
    if a.selbsttest:
        return selbsttest()
    if a.allowlist_ausgeben:
        print(json.dumps({"allowedOutputs": sorted(DATEN_FELDER)},
                         ensure_ascii=False, indent=1))
        return 0
    if not a.freigabe:
        p.error("--freigabe fehlt")
    ausgabe = lauf(a.freigabe, data_root=a.data_root, arbeit=a.arbeit,
                   ziel=a.ziel, siegel_voll=not a.siegel_schnell,
                   panel_pfad=a.panel, register_pfad=a.register)
    print(json.dumps(ausgabe, ensure_ascii=False, indent=1, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""F6-ZAEHLWERK - das Instrument der EINEN konfirmatorischen Zaehlung.

Angeordnet durch _COURT-F6-ZAEHLWERK-2026-09-01 (Frage (A), 3:0 im Instrument,
2:1 im Kern), ratifiziert Session 07, 2026-09-01 02:22, Auflagen F6-C1..C11.

DER VERTRAG (eingefroren in scripts/studie-f6-lauf.py):
    zaehle(panel_pfad, variante, arm) -> {klumpen, n, zaehler, zerlegung}
`klumpen` ist der (m_g, n_g)-Tally je Signal-Entitaet (Firma) ueber die
Einheiten des NETTO-Tornenners. **Niemals eine Firmen-Kennung im
Rueckgabewert** (F6-B14) - die Kennungen leben ausschliesslich innerhalb dieses
Prozesses und werden zu Zahlenpaaren verdichtet, bevor irgendetwas den Prozess
verlaesst.

ES BAUT DIE REGEL NICHT NACH - ES LAEDT SIE (F6-C2)
====================================================
Die eingefrorene Praeregistrierung NENNT die zu benutzende Funktion woertlich:

    /zaehlprobe/kontrollpool/rechenGleichbehandlung: "Signal-Arm und
    Kontrollpool laufen durch EXAKT dieselbe Funktion
    (scripts/studie-basisraten.py::erst_ereignisse) mit exakt derselben
    Behandlung fehlender Felder. Genau daran ist die Vorstudie gescheitert (R5)."

Ein Nachbau von `erst_ereignisse` waere damit kein strengerer Weg, sondern der
Bruch einer eingefrorenen Klausel. Deshalb: Manifest-Hash pruefen, dann laden,
dann ausschliesslich die REINEN Regelfunktionen rufen. "Zwei Nachbauten
derselben Rechnung driften; einer kann es nicht."
(`scripts/studie-e2-verbreitert.py:17-22`)

DIE VIER MAUERTRAGENDEN EINSTIEGSPUNKTE WERDEN NIE GERUFEN (F6-C4, W-A)
=======================================================================
`pruefe_mauer` · `oeffne_nur_lesend` · `oeffne_zwischenstand` ·
`schreibe_report`. Z3 hat sein JA hierauf konditioniert ("Ohne VL6-2 stimme ich
mit NEIN"), KZ-2 kippt (A) auf NEIN, wenn einer doch gerufen wird.

FOLGE, DIE DARAUS ERWAECHST - UND WARUM W-B DAMIT TRAGEND WIRD:
Weil `oeffne_zwischenstand` nicht gerufen werden darf, laeuft auf dem
Arbeitspfad auch `pruefe_mauer` nicht mehr mit. Dieses Modul oeffnet seine
Arbeitsdatei deshalb SELBST (F6-C1 weist ihm seine eigene E/A ausdruecklich zu)
und prueft den Pfad SELBST gegen `VERBOTEN_RE` (W-B, F6-C5). W-B ist damit kein
Guertel-und-Hosentraeger, sondern der Ersatz fuer einen Schutz, den der Verzicht
auf den Einstiegspunkt entfernt hat. Die Tabellenform der Arbeitsdatei ist die
des Hauses (drei Tabellen, `studie-basisraten.py:451-470`); nachgebaut wird
E/A-Gerippe, nie Regelarithmetik (F6-C2 beruehrt das nicht).

FENSTERNEUTRALITAET, VOR DEM BAU AM OBJEKT GEMESSEN (F6-C6 / KZ-1)
===================================================================
KZ-1 kippt (A) auf Z1s Neubau-Fassung, falls eine der geladenen reinen
Funktionen ueber Modul-Globals still das Entdeckungsfenster in ihre Arithmetik
bindet. Gemessen wurde per Syntaxbaum ueber den TRANSITIVEN Aufrufbaum von
`firmenreihen`, `signale` und `erst_ereignisse`: **keine** von ihnen liest
`FENSTER_VON` (:101), `FENSTER_BIS` (:102) oder `BAND_JAHRE` (:187). Alle drei
nehmen ihre Eingaben ausschliesslich als Argumente. KZ-1 feuert nicht.
`kalibriere()`, `im_band()` und `schwellen()` werden nie gerufen - sie SIND
Entdeckungs-Kalibrierung.

Aufruf (nur ueber scripts/studie-f6-lauf.py --zaehlwerk):
  Selbsttest:  python scripts/studie-f6-zaehlwerk.py selbsttest
"""

import hashlib
import importlib.util
import io
import json
import math
import os
import re
import sqlite3
import sys

HIER = os.path.dirname(os.path.abspath(__file__))
WURZEL_REPO = os.path.dirname(HIER)

# =============================================================================
# SOLLWERTE (F6-C6) - als Konstanten UND zur Laufzeit am Objekt nachgerechnet
# =============================================================================

VERSIEGELT_REL = "scripts/studie-basisraten.py"
VERSIEGELT_SHA = "997a80d26871937f848b3eea76a9b4ba1a4e1c76f1cc3c30db98d7888ec2601d"
ZAEHLPROBE_REL = "scripts/studie-zaehlprobe.py"

SCHWELLEN_SATZ_REL = "protocol/early-detection/2.1.0/e2-schwellen-satz-2026-08-30.json"
SCHWELLEN_DATEI_SHA = "80798025d2ad6387b3ed72048227112426369ec8392ae633a92df58f0cf4d1e5"
SCHWELLEN_INHALT_SHA = "c4a888906e4cb26a1a4994c54fc34b89c068e40646a800d3d07c7051308b2bee"

P_FINAL_SOLL = 95
REIFE_QUARTALE_SOLL = 4
ZENSUR_TAGE_JE_QUARTAL_SOLL = 80

# Der Signalband-/Panel-Rand-Satz je Fenster. Abgeleitet, nicht getippt - die
# Ableitung selbst fuehrt scripts/studie-f6-lauf.py::leite_panelrand_ab; hier
# stehen die Sollwerte, gegen die der Laeufer haelt (F6-C22).
FENSTER_SOLL = {
    "entdeckung": {"von": "2009-01-01", "bis": "2015-12-31", "rand": "2016-12-31"},
    "pruefung": {"von": "2017-01-01", "bis": "2019-12-31", "rand": "2020-12-31"},
}

# W-B (F6-C5): der Arbeitspfad darf kein Token hieraus tragen. Woertlich die
# Fassung aus scripts/studie-basisraten.py:106-108.
VERBOTEN_RE = re.compile(
    r"endtest|validierung|pruefenster|prüfenster|\.enc$|schl(?:ue|ü)ssel|\.key$",
    re.IGNORECASE)

VARIANTEN = ("S-U", "S-G")
ARME = ("signal", "kontrollpool")


class ZaehlwerkAbbruch(Exception):
    """Ein benannter Abbruch. Auf JEDEM Pfad ein Grund - eine stille Null waere
    hier der teuerste Fall (F6-C12: 'stille Null / fehlender Grund gegen nie
    geprueft')."""


# =============================================================================
# Die Aequivalenz-Sollwerte (F6-C7 / F6-C8 / F6-C9)
# =============================================================================
#
# JEDER WERT IST VOR DEM EINTRAGEN AN SEINEM ARTEFAKT NACHGERECHNET WORDEN:
# Bein 1 gegen protocol/early-detection/2.1.0/e2-schwellen-satz-2026-08-30.json
# (provenienz.aequivalenzTorSoll und jeFamilie), Bein 2 gegen
# reports/studie/E4d-kadenz-entdeckung-2026-08-19.json
# (baender["2009-2015"].varianten[...].{signal,kontrolle}).
#
# DER LAUF DES TORS IST NICHT DIESER AKT. Er braucht seinen eigenen
# `count_only_probe_authorized`-Register-Eintrag auf dem ENTDECKUNGS-Panel
# (Bauordnung Schritt 2, DZ-5 strengere Fassung). Hier steht die
# LAUFBEDINGUNG als Code; gefahren wird sie dort.

BEIN1_SOLL = {
    "aequivalenzTorSoll": {
        "S-U": {"firmen_reif": 512, "firmen_unreif": 219},
        "S-G": {"firmen_reif": 546, "firmen_unreif": 265},
        "S-UG": {"firmen_reif": 29, "firmen_unreif": 12},
    },
    "jeFamilie": {
        "S-U": {"schritt0_p": 90, "schritt0_firmen_reif": 1109,
                "schritt1_p": 95, "schritt1_firmen_reif": 540,
                "auswertbar_band": 68079,
                "firmenReif": 540, "firmenUnreif": 226},
        "S-G": {"schritt0_p": 90, "schritt0_firmen_reif": 1309,
                "schritt1_p": 95, "schritt1_firmen_reif": 546,
                "auswertbar_band": 82642,
                "firmenReif": 546, "firmenUnreif": 265},
    },
    "bindungen": {
        "modulSha256": VERSIEGELT_SHA,
        "konzeptlisteSha256":
            "88ba14a298837bcc6287c4f52a3ba61296b6ba56d96ba78cba0470335df99247",
        "inhaltSha256": SCHWELLEN_INHALT_SHA,
    },
}

BEIN2_QUELLE_REL = "reports/studie/E4d-kadenz-entdeckung-2026-08-19.json"
BEIN2_QUELLE_SHA = "46e191ec68e0480a336fd287dc548c8b6a975b8d50a07c6e0162274c6dbd8fdf"
BEIN2_SOLL = {
    ("S-U", "signal"): {"zaehler": 543, "nenner": 651, "zensiert": 0},
    ("S-U", "kontrollpool"): {"zaehler": 3760, "nenner": 4513, "zensiert": 1},
    ("S-G", "signal"): {"zaehler": 557, "nenner": 647, "zensiert": 0},
    ("S-G", "kontrollpool"): {"zaehler": 5000, "nenner": 5768, "zensiert": 0},
}
BEIN2_RAHMEN = {"panelRand": "2016-12-31", "signalband_von": "2009-01-01",
                "signalband_bis": "2015-12-31", "perzentil": 95}

# BEIN 3 (F6-C9): die Semantik, die kein Panel-Lauf deckt - gegen
# AUSGESCHRIEBENE LITERALE, woertlich transkribiert aus
# protocol/early-detection/2.0.0/preregistration.json. Nie gegen eine zweite
# Implementierung derselben Formel (Muster F6-B23).
BEIN3_LITERALE = {
    "rechtsZensur_definition": (
        "Ein Erst-Ereignis ist RECHTS-ZENSIERT, wenn seine vier Folgequartale "
        "aus Fenstergruenden gar nicht im Panel liegen KOENNEN: "
        "ordinal(accepted) + 4 * 80 Tage > ordinal(Panel-Rand)."),
    "rechtsZensur_achse": (
        "accepted (Veroeffentlichungszeitpunkt) — genau die Achse, an der die "
        "Panel-Dateien geschnitten sind (scripts/studie-panel-bau.py)."),
    "auffindbarkeit_formel": (
        "reife Erst-Ereignisse / (Erst-Ereignisse - rechts-zensierte "
        "Erst-Ereignisse)"),
    "reife_definition_anfang": (
        "Ein Ereignis ist REIF, wenn nach seinem Bilanzstichtag mindestens "
        "vier weitere Fiskalquartale DERSELBEN Quellen-Basis im Fenster-Panel "
        "existieren."),
    "untergrenze_4x80": (
        "4 * 80 Tage ist die UNTERE Kante des Quartals-Paarungsfensters."),
    "nie_stillschweigend": (
        "eine Nennereinheit ohne genau eine Klumpen-Kennung wird NIE "
        "stillschweigend fallengelassen"),
}


# =============================================================================
# Kleinwerkzeug
# =============================================================================

def sha256_datei(pfad, block=1 << 22):
    h = hashlib.sha256()
    with open(pfad, "rb") as fh:
        for stueck in iter(lambda: fh.read(block), b""):
            h.update(stueck)
    return h.hexdigest()


def kanonisch_sha256(objekt):
    roh = json.dumps(objekt, ensure_ascii=False, sort_keys=True,
                     separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(roh).hexdigest()


def _ganzzahl(x):
    """bool ist ein int - hier zaehlt es NICHT als Zahl."""
    return isinstance(x, int) and not isinstance(x, bool)


# =============================================================================
# W-B (F6-C5) - die Arbeitsdatei-Falle
# =============================================================================

def pruefe_arbeitspfad(pfad):
    """W-B: der Arbeitspfad traegt kein VERBOTEN_RE-Token - auch nicht ueber
    ein Elternverzeichnis oder eine aufgeloeste Junction.

    Dieser Wachposten ist TRAGEND, nicht dekorativ: weil F6-C4 den Aufruf von
    `oeffne_zwischenstand` verbietet, laeuft `pruefe_mauer` auf diesem Pfad
    nicht mehr mit. Was dort wegfiel, steht hier.
    """
    geschrieben = os.path.abspath(pfad)
    aufgeloest = os.path.realpath(geschrieben)
    for form in (geschrieben, aufgeloest):
        if VERBOTEN_RE.search(form.replace(os.sep, "/")):
            raise ZaehlwerkAbbruch(
                "W-B-ABBRUCH: der Arbeitspfad '" + str(pfad) + "' (aufgeloest: '"
                + aufgeloest + "') traegt ein gesperrtes Token. Ein Arbeitspfad "
                "mit 'validierung', 'endtest' oder Schluesselmaterial im Namen "
                "laesst die Mauer des versiegelten Moduls feuern und ist "
                "ausserdem selbst ein Befund. Vor der Freigabe zu pruefen, nie "
                "zur Laufzeit zu entdecken (KZ-3).")
    return aufgeloest


# =============================================================================
# Laden statt Nachbauen (F6-C2) - Hash-Pruefung VOR exec_module
# =============================================================================

def _lade_modul(wurzel, rel, soll_sha, name):
    """Erst die Bindung pruefen, dann laden. Nie umgekehrt.
    Muster scripts/studie-e2-verbreitert.py:97-119."""
    pfad = os.path.join(wurzel, *rel.split("/"))
    if not os.path.isfile(pfad):
        raise ZaehlwerkAbbruch("Das gebundene Modul fehlt: " + rel)
    ist = sha256_datei(pfad)
    if soll_sha and ist != soll_sha:
        raise ZaehlwerkAbbruch(
            rel + " weicht von der Bindung ab (ist " + ist[:16] + "..., soll "
            + soll_sha[:16] + "...). Die eingefrorene Regel ist nach ihrer "
            "Bindung veraendert worden - jede Zahl aus ihr waere wertlos.")
    spec = importlib.util.spec_from_file_location(name, pfad)
    modul = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(modul)
    return modul, ist


def lade_regelmodule(wurzel=None):
    """Das versiegelte Modul (F6-C2) und das Zaehlproben-Modul (F6-C3).

    `studie-zaehlprobe.py` wird durch diese Verwendung zu AUSFUEHRENDEM
    REGELCODE und ist damit zwingend per SHA im konfirmatorischen Eintrag zu
    binden (F6-C20). Der Nebenpreis ist mitbeurkundet: jede spaetere Aenderung
    daran bricht ab sofort den F6-Vollzug.
    """
    wurzel = wurzel or WURZEL_REPO
    e2, e2_sha = _lade_modul(wurzel, VERSIEGELT_REL, VERSIEGELT_SHA,
                             "studie_basisraten")
    # Der Sollwert des Zaehlprobe-Moduls wird zur Laufzeit GEMESSEN und
    # zurueckgegeben, damit der Laeufer ihn binden kann; ein hier eingetippter
    # Sollwert waere eine zweite Kopie derselben Bindung.
    zp, zp_sha = _lade_modul(wurzel, ZAEHLPROBE_REL, None, "studie_zaehlprobe")
    return {"e2": e2, "zp": zp, "modulSha256": e2_sha, "zaehlprobeSha256": zp_sha}


# =============================================================================
# F6-C6 - Regelparameter am Objekt nachrechnen, beide Richtungen zu
# =============================================================================

def pruefe_regelparameter(wurzel, module):
    """Sollwerte gegen die eingefrorenen Artefakte. Abweichung oder fehlender
    Wert = Abbruch VOR jeder Zahl."""
    wurzel = wurzel or WURZEL_REPO
    pfad = os.path.join(wurzel, *SCHWELLEN_SATZ_REL.split("/"))
    if not os.path.isfile(pfad):
        raise ZaehlwerkAbbruch("Der Schwellen-Satz fehlt: " + SCHWELLEN_SATZ_REL)
    ist_datei = sha256_datei(pfad)
    if ist_datei != SCHWELLEN_DATEI_SHA:
        raise ZaehlwerkAbbruch(
            "Der Schwellen-Satz weicht ab (Datei-SHA ist " + ist_datei[:16]
            + "..., soll " + SCHWELLEN_DATEI_SHA[:16] + "...).")
    satz = json.load(io.open(pfad, encoding="utf-8"))
    ohne = {k: v for k, v in satz.items() if k != "inhaltSha256"}
    ist_inhalt = kanonisch_sha256(ohne)
    if ist_inhalt != SCHWELLEN_INHALT_SHA:
        raise ZaehlwerkAbbruch(
            "Der Schwellen-Satz reproduziert seinen inhaltSha256 nicht (ist "
            + ist_inhalt[:16] + "..., soll " + SCHWELLEN_INHALT_SHA[:16] + "...).")

    # pFinal aus dem Artefakt LESEN, nie tippen - und gegen den Sollwert halten.
    gefunden = set()
    for name in VARIANTEN:
        fam = (satz.get("jeFamilie") or {}).get(name) or {}
        if "pFinal" in fam:
            gefunden.add(fam["pFinal"])
    if not gefunden:
        raise ZaehlwerkAbbruch(
            "Der Schwellen-Satz fuehrt kein pFinal je Familie. Ein fehlender "
            "Regelparameter ist ein Abbruch, kein Vorgabewert.")
    if gefunden != {P_FINAL_SOLL}:
        raise ZaehlwerkAbbruch(
            "pFinal im Artefakt ist " + repr(sorted(gefunden)) + ", gebunden "
            "ist " + repr(P_FINAL_SOLL) + ".")

    # Und die Zensur-Konstanten des Zaehlproben-Moduls, ebenfalls beidseitig.
    zp = module["zp"]
    for name, soll in (("PERZENTIL", P_FINAL_SOLL),
                       ("REIFE_QUARTALE", REIFE_QUARTALE_SOLL),
                       ("ZENSUR_TAGE_JE_QUARTAL", ZENSUR_TAGE_JE_QUARTAL_SOLL)):
        ist = getattr(zp, name, None)
        if ist != soll:
            raise ZaehlwerkAbbruch(
                "studie-zaehlprobe." + name + " ist " + repr(ist) + ", gebunden "
                "ist " + repr(soll) + ".")
    return {"pFinal": P_FINAL_SOLL, "schwellenDateiSha256": ist_datei,
            "schwellenInhaltSha256": ist_inhalt}


# =============================================================================
# Eigene E/A (F6-C1) - nie ueber die vier Einstiegspunkte
# =============================================================================

def eigene_panel_verbindung(panel_pfad):
    """Nur-lesend, mit eigenem URI. Bewusst NICHT `e2.oeffne_nur_lesend`
    (F6-C4) - dessen erste Zeile ist `pruefe_mauer`, und die sperrt genau das
    Fenster, das der konfirmatorische Eintrag autorisiert."""
    if not os.path.isfile(panel_pfad):
        raise ZaehlwerkAbbruch("Panel-Datei nicht gefunden: " + str(panel_pfad))
    voll = os.path.abspath(panel_pfad)
    conn = sqlite3.connect("file:" + voll.replace("\\", "/") + "?mode=ro",
                           uri=True)
    conn.execute("PRAGMA cache_size=-200000")
    return conn


def eigener_zwischenstand(pfad):
    """Die Arbeitsdatei, selbst geoeffnet (F6-C1) und selbst geprueft (W-B).

    Tabellenform woertlich die des Hauses (`studie-basisraten.py:451-470`) -
    `lies_rohwerte` und `pit_reduktion` erwarten genau diese drei Tabellen.
    Nachgebaut wird E/A-Gerippe, nie Regelarithmetik.
    """
    pruefe_arbeitspfad(pfad)
    if os.path.isfile(pfad):
        os.remove(pfad)
    os.makedirs(os.path.dirname(os.path.abspath(pfad)), exist_ok=True)
    conn = sqlite3.connect(pfad, isolation_level=None)
    conn.execute("PRAGMA synchronous=OFF")
    conn.execute("PRAGMA cache_size=-200000")
    conn.execute("CREATE TABLE IF NOT EXISTS roh (cik TEXT, tag TEXT, ddate TEXT,"
                 " qtrs TEXT, uom TEXT, accepted TEXT, adsh TEXT, value REAL)")
    conn.execute("CREATE TABLE IF NOT EXISTS lauf_stand (block INTEGER PRIMARY KEY,"
                 " zeilen INTEGER, fertig_am TEXT)")
    conn.execute("CREATE TABLE IF NOT EXISTS zaehler_stand (name TEXT PRIMARY KEY,"
                 " wert INTEGER)")
    return conn


# =============================================================================
# Die Zaehlung
# =============================================================================

# ponytail: Prozess-weiter Cache je Panel-Pfad. Der Vertrag ruft zaehle() vier
# Mal (2 Varianten x 2 Arme); ohne Cache liefe die ganze ETL vier Mal ueber ein
# Mehr-GB-Panel. Ceiling: der Cache lebt im Prozess und kennt keine Invalidierung
# - genau richtig fuer den EINEN Lauf, fuer den dieses Modul existiert.
_VORBEREITUNG = {}


def _vorbereitung(panel_pfad, arbeit_pfad, module):
    schluessel = os.path.abspath(panel_pfad)
    if schluessel in _VORBEREITUNG:
        return _VORBEREITUNG[schluessel]
    e2 = module["e2"]
    from collections import defaultdict
    zaehler = defaultdict(int)
    for name in e2.alle_zaehlernamen():
        zaehler[name] += 0

    panel = eigene_panel_verbindung(panel_pfad)
    try:
        berichte, _fj, _q, _fye = e2.lade_berichte(panel, zaehler)
        arbeit = eigener_zwischenstand(arbeit_pfad)
        try:
            zaehler["roh_zeilen"] = e2.lies_rohwerte(panel, arbeit, berichte,
                                                     zaehler, False)
            je_firma = e2.pit_reduktion(arbeit, zaehler)
        finally:
            arbeit.close()
    finally:
        panel.close()

    _VORBEREITUNG[schluessel] = (je_firma, zaehler)
    return _VORBEREITUNG[schluessel]


def _familie(variante, module):
    """Die Quellen-Konfiguration je Variante - dieselbe Reihenfolge wie
    `studie-basisraten.py::auswertung` und `studie-zaehlprobe.py:556-558`,
    gelesen und nicht geraten."""
    e2 = module["e2"]
    familien = {"S-U": (e2.UMSATZ_QUELLEN, True, "umsatz_"),
                "S-G": (e2.ERGEBNIS_QUELLEN, False, "betriebsergebnis_")}
    if variante not in familien:
        raise ZaehlwerkAbbruch(
            "Unbekannte Signalvariante " + repr(variante) + ". Bekannt sind "
            + repr(sorted(familien)) + " - eine dritte waere eine andere Studie.")
    return familien[variante]


def _arme(panel_pfad, arbeit_pfad, variante, module, fenster):
    """Beide Arme EINER Variante. Signal und Kontrollpool laufen durch
    denselben Code - `arm_zaehlen` -, wie die Praereg-Klausel
    `rechenGleichbehandlung` es verlangt."""
    e2, zp = module["e2"], module["zp"]
    je_firma, zaehler = _vorbereitung(panel_pfad, arbeit_pfad, module)
    quellen, nur_positiv, praefix = _familie(variante, module)

    alle, gewaehlt = e2.firmenreihen(je_firma, quellen, nur_positiv, zaehler,
                                     praefix)
    _g, a_saetze = e2.wachstum_und_beschleunigung(alle, zaehler, praefix)
    feuerungen, auswertbar, _grenzen = e2.signale(a_saetze, zp.PERZENTIL,
                                                  zaehler, praefix)
    band_f = [f for f in feuerungen
              if zp.im_signalband(f, e2, fenster["von"], fenster["bis"])]
    band_a = [a for a in auswertbar
              if zp.im_signalband(a, e2, fenster["von"], fenster["bis"])]

    rand_ordinal = e2.ordinal(fenster["rand"].replace("-", ""))
    signal = zp.arm_zaehlen(band_f, gewaehlt, e2, rand_ordinal)
    # Kontrollpool: Firmen mit auswertbarem Firmen-Quartal im Signalband, die
    # NIE feuern (R3). Woertlich die Konstruktion aus
    # `studie-zaehlprobe.py:567-570` - keine dritte Implementierung.
    signalfirmen = set(f["cik"] for f in band_f)
    kontroll_eintraege = [a for a in band_a if a["cik"] not in signalfirmen]
    kontrolle = zp.arm_zaehlen(kontroll_eintraege, gewaehlt, e2, rand_ordinal)
    return {"signal": (signal, band_f), "kontrollpool": (kontrolle, kontroll_eintraege),
            "band_a": band_a, "rand_ordinal": rand_ordinal}


def _tally(eintraege, reif_rows, e2, zp, rand_ordinal, wo):
    """Der (m_g, n_g)-Tally je Signal-Entitaet ueber die Einheiten des
    NETTO-Tornenners - und W-C (F6-C10) gleich mit.

    Die Einheiten sind `Erst-Ereignisse minus rechts-zensierte` (Wortlaut
    Ziffer 2). Die Firmen-Kennung wird HIER verbraucht: was diese Funktion
    zurueckgibt, sind Zahlenpaare (F6-B14).
    """
    reife_ciks = set(e["cik"] for e in reif_rows)
    klumpen_je_firma = {}
    zensiert = 0
    for e in eintraege:
        cik = e.get("cik")
        if cik is None:
            # Wortlaut Ziffer 8 / F6-C9: NIE stillschweigend fallengelassen.
            raise ZaehlwerkAbbruch(
                "Eine Nennereinheit ohne Klumpen-Kennung in " + wo
                + ". Sie wird nie stillschweigend fallengelassen - das ist ein "
                "ABBRUCH, kein Filter.")
        if zp.ist_zensiert(e, e2, rand_ordinal):
            zensiert += 1
            continue
        m, n = klumpen_je_firma.get(cik, (0, 0))
        klumpen_je_firma[cik] = (m + (1 if cik in reife_ciks else 0), n + 1)

    # ── W-C (F6-C10): die Tally-Invariante ────────────────────────────────
    gross = sorted(n for _m, n in klumpen_je_firma.values() if n != 1)
    if gross:
        raise ZaehlwerkAbbruch(
            "W-C-ABBRUCH in " + wo + ": " + str(len(gross)) + " Klumpen tragen "
            "n_g > 1 (groesster " + str(gross[-1]) + "). Eine Firma zaehlt nur "
            "mit ihrem fruehesten Ereignis; wer Ereignisse zaehlt, verwechselt "
            "Dichte mit Stichprobe - derselbe Befund, den der R3-ABBRUCH in "
            "scripts/studie-zaehlprobe.py:507-509 benennt.")

    klumpen = sorted(klumpen_je_firma.values())
    n = sum(paar[1] for paar in klumpen)
    zaehler = sum(paar[0] for paar in klumpen)
    G = len(klumpen)
    if G != n:
        raise ZaehlwerkAbbruch(
            "W-C-ABBRUCH in " + wo + ": G = " + str(G) + " gegen N = " + str(n)
            + ". Bei ausschliesslich einelementigen Klumpen muessen sie gleich "
            "sein.")
    return [[m, nn] for m, nn in klumpen], n, zaehler, zensiert


def zaehle(panel_pfad, variante, arm, wurzel=None, arbeit_pfad=None,
           fenster_name="pruefung"):
    """DER VERTRAG (F6-C1): {klumpen, n, zaehler, zerlegung}.

    Niemals eine Firmen-Kennung im Rueckgabewert.
    """
    if arm not in ARME:
        raise ZaehlwerkAbbruch("Unbekannter Arm " + repr(arm) + ".")
    wurzel = wurzel or WURZEL_REPO
    fenster_soll = FENSTER_SOLL.get(fenster_name)
    if not fenster_soll:
        raise ZaehlwerkAbbruch("Unbekanntes Fenster " + repr(fenster_name) + ".")
    if arbeit_pfad is None:
        raise ZaehlwerkAbbruch(
            "Kein Arbeitspfad uebergeben. Er wird VOR der Freigabe geprueft und "
            "im Eintrag genannt, nie zur Laufzeit erfunden (W-B / KZ-3).")

    module = lade_regelmodule(wurzel)
    pruefe_regelparameter(wurzel, module)
    e2, zp = module["e2"], module["zp"]

    arme = _arme(panel_pfad, arbeit_pfad, variante, module, fenster_soll)
    ergebnis, eintraege = arme[arm]
    klumpen, n, zaehler_reife, zensiert = _tally(
        eintraege, ergebnis["reif"], e2, zp, arme["rand_ordinal"],
        variante + "/" + arm)

    # Kreuzprobe gegen den Arm-Zaehler des Hauses. Die eingefrorene Formel
    # rechnet `len(reif) / (len(alle) - zensiert)`; die SE-Einheiten sind die
    # NICHT-zensierten. Beide muessen denselben Zaehler ergeben - tun sie es
    # nicht, waere ein reifes Ereignis zensiert, und die zwei Definitionen
    # widersprechen sich. Das ist ein Abbruch, keine Auslegungsfrage.
    if zaehler_reife != len(ergebnis["reif"]):
        raise ZaehlwerkAbbruch(
            "Kreuzprobe gerissen in " + variante + "/" + arm + ": der Tally "
            "zaehlt " + str(zaehler_reife) + " reife nicht-zensierte Einheiten, "
            "der Arm-Zaehler " + str(len(ergebnis["reif"])) + " reife "
            "Erst-Ereignisse. Ein reifes Ereignis waere damit zensiert - die "
            "eingefrorene Auffindbarkeits-Formel und die SE-Einheitenmenge "
            "widersprechen sich. Kein Ermessen.")
    if zensiert != ergebnis["zensierte_erst_ereignisse"]:
        raise ZaehlwerkAbbruch(
            "Kreuzprobe gerissen in " + variante + "/" + arm + ": Zensur "
            + str(zensiert) + " gegen " + str(ergebnis["zensierte_erst_ereignisse"]))

    alle = ergebnis["firmen_mit_erst_ereignis"]
    return {
        "klumpen": klumpen,
        "n": n,
        "zaehler": zaehler_reife,
        # A16-Zerlegungen als REINE Zaehlungen, keine Kennung.
        "zerlegung": {
            "n_A": alle,
            "n_B_reif": zaehler_reife,
            "n_B_unreif": n - zaehler_reife,
            "n_verloren": alle - n,
            "feuerfaehig": len(arme["band_a"]) if arm == "kontrollpool" else alle,
            "strukturell_nicht_feuerfaehig": n - zaehler_reife,
            "rechts_zensiert": zensiert,
        },
    }


# =============================================================================
# Das Aequivalenz-Tor (F6-C7 / C8 / C9) - Laufbedingung, kein Bau-Test
# =============================================================================

def aequivalenz_bein3():
    """BEIN 3: die Semantik gegen ausgeschriebene Literale. KEIN Panel-Lauf.

    Diese Pruefung braucht kein Fenster und keine Freigabe und laeuft deshalb
    auch im Selbsttest.
    """
    pfad = os.path.join(WURZEL_REPO, "protocol", "early-detection", "2.0.0",
                        "preregistration.json")
    if not os.path.isfile(pfad):
        raise ZaehlwerkAbbruch("Die Praeregistrierung fehlt: " + pfad)
    text = io.open(pfad, encoding="utf-8").read()
    fehlend = [name for name, literal in BEIN3_LITERALE.items()
               if name != "nie_stillschweigend" and literal not in text]
    if fehlend:
        raise ZaehlwerkAbbruch(
            "BEIN 3 gerissen: diese woertlichen Literale stehen nicht mehr in "
            "der Praeregistrierung: " + ", ".join(fehlend) + ". Die Semantik, "
            "gegen die dieses Zaehlwerk gebaut ist, hat sich bewegt.")
    return {"bestanden": True, "geprueft": sorted(
        k for k in BEIN3_LITERALE if k != "nie_stillschweigend")}


def aequivalenz_tor(panel_pfad, wurzel=None, arbeit_pfad=None):
    """Die LAUFBEDINGUNG vor jedem Prueffenster-Byte (F6-C7/C8, 3:0).

    Form woertlich aus `scripts/studie-e2-verbreitert.py:26-30`: "Durchlauf 1
    faehrt mit den ORIGINAL-Globals und MUSS die publizierten V0-Zahlen liefern
    ... dann STOPP, und zwar vor jeder verbreiterten Zahl."

    EINE Abweichung in EINER Stelle = STOPP (KZ-4). Kein zweiter
    Kandidaten-Sollwert, kein "nah genug", keine Nachjustierung.

    ACHTUNG - REIHENFOLGE: dieses Tor laeuft auf dem ENTDECKUNGS-Panel und
    braucht dafuer seinen eigenen `count_only_probe_authorized`-Eintrag
    (Bauordnung Schritt 2). Es ist NICHT Teil des konfirmatorischen Laufs auf
    dem Prueffenster, sondern seine Vorbedingung.
    """
    wurzel = wurzel or WURZEL_REPO
    module = lade_regelmodule(wurzel)
    pruefe_regelparameter(wurzel, module)
    bein3 = aequivalenz_bein3()

    fenster = FENSTER_SOLL["entdeckung"]
    gemessen, abweichungen = {}, []
    for variante in VARIANTEN:
        arme = _arme(panel_pfad, arbeit_pfad, variante, module, fenster)
        for arm in ARME:
            ergebnis, eintraege = arme[arm]
            klumpen, n, zaehler_reife, zensiert = _tally(
                eintraege, ergebnis["reif"], module["e2"], module["zp"],
                arme["rand_ordinal"], variante + "/" + arm)
            ist = {"zaehler": zaehler_reife, "nenner": n, "zensiert": zensiert}
            gemessen[variante + "/" + arm] = ist
            soll = BEIN2_SOLL[(variante, arm)]
            for feld in ("zaehler", "nenner", "zensiert"):
                if ist[feld] != soll[feld]:
                    abweichungen.append(
                        variante + "/" + arm + "." + feld + ": ist "
                        + str(ist[feld]) + ", soll " + str(soll[feld]))
    if abweichungen:
        raise ZaehlwerkAbbruch(
            "AEQUIVALENZ-TOR BEIN 2 GERISSEN - STOPP vor jedem "
            "Prueffenster-Byte (KZ-4): " + " | ".join(abweichungen)
            + ". Weicht Durchlauf 1 ab, ist nicht der Vergleich kaputt, "
            "sondern die Grundlage.")
    return {"bestanden": True, "bein2Gemessen": gemessen, "bein3": bein3,
            "modulSha256": module["modulSha256"],
            "zaehlprobeSha256": module["zaehlprobeSha256"],
            "bein2QuelleSha256": BEIN2_QUELLE_SHA}


# =============================================================================
# Selbsttest - ohne Panel, ohne Freigabe, ohne eine einzige Studienzahl
# =============================================================================

def selbsttest():
    ok = fehl = 0

    def pruefe(name, bedingung):
        nonlocal ok, fehl
        if bedingung:
            ok += 1
            print("  ok   " + name)
        else:
            fehl += 1
            print("  FAIL " + name)

    # W-B
    for schlecht in ("arbeit/validierung/x.sqlite", "x/endtest/a.sqlite",
                     "a/pruefenster/b.sqlite", "a/b.key", "a/schluessel.db"):
        try:
            pruefe_arbeitspfad(schlecht)
            pruefe("W-B faengt " + schlecht, False)
        except ZaehlwerkAbbruch:
            pruefe("W-B faengt " + schlecht, True)
    try:
        pruefe_arbeitspfad("arbeit/f6/zwischenstand.sqlite")
        pruefe("W-B GEGENPROBE: ein sauberer Arbeitspfad geht durch", True)
    except ZaehlwerkAbbruch:
        pruefe("W-B GEGENPROBE: ein sauberer Arbeitspfad geht durch", False)

    # W-C, an der reinen Tally-Funktion
    class _ZP:
        @staticmethod
        def ist_zensiert(e, e2, rand):
            return bool(e.get("zensiert"))

    def tally(eintraege, reif, wo="probe"):
        return _tally(eintraege, reif, None, _ZP, 0, wo)

    e = [{"cik": "1"}, {"cik": "2"}, {"cik": "3"}]
    klumpen, n, z, zens = tally(e, [{"cik": "1"}, {"cik": "2"}])
    pruefe("Tally: drei Firmen -> N = 3, Zaehler = 2, alle n_g = 1",
           n == 3 and z == 2 and all(p[1] == 1 for p in klumpen))
    pruefe("Tally gibt NUR Zahlenpaare zurueck, keine Kennung",
           all(isinstance(p, list) and len(p) == 2
               and all(_ganzzahl(x) for x in p) for p in klumpen))
    klumpen2, n2, z2, zens2 = tally(
        [{"cik": "1"}, {"cik": "2", "zensiert": True}], [{"cik": "1"}])
    pruefe("Tally: eine zensierte Einheit faellt aus dem Netto-Nenner",
           n2 == 1 and z2 == 1 and zens2 == 1)

    try:
        tally([{"cik": "1"}, {"cik": "1"}], [{"cik": "1"}])
        pruefe("W-C: n_g > 1 ist ein ABBRUCH", False)
    except ZaehlwerkAbbruch as f:
        pruefe("W-C: n_g > 1 ist ein ABBRUCH", "R3-ABBRUCH" in str(f))
    try:
        tally([{"cik": None}], [])
        pruefe("Einheit ohne Klumpen-Kennung: ABBRUCH, kein Filter", False)
    except ZaehlwerkAbbruch as f:
        pruefe("Einheit ohne Klumpen-Kennung: ABBRUCH, kein Filter",
               "kein Filter" in str(f))

    # BEIN 3
    try:
        r3 = aequivalenz_bein3()
        pruefe("BEIN 3: alle Wortlaut-Literale stehen in der Praereg",
               r3["bestanden"] and len(r3["geprueft"]) == 5)
    except ZaehlwerkAbbruch as f:
        pruefe("BEIN 3: alle Wortlaut-Literale stehen in der Praereg (" + str(f)[:60] + ")",
               False)

    # F6-C6 / F6-C2 am echten Repo
    try:
        module = lade_regelmodule()
        pruefe("F6-C2: das versiegelte Modul laedt nach Hash-Pruefung",
               module["modulSha256"] == VERSIEGELT_SHA)
        p = pruefe_regelparameter(None, module)
        pruefe("F6-C6: pFinal = 95 am Artefakt nachgerechnet",
               p["pFinal"] == P_FINAL_SOLL)
        pruefe("F6-C6: der Schwellen-Satz reproduziert BEIDE Hashes",
               p["schwellenDateiSha256"] == SCHWELLEN_DATEI_SHA
               and p["schwellenInhaltSha256"] == SCHWELLEN_INHALT_SHA)
        # W-A am Objekt: keiner der vier Einstiegspunkte steht im Quelltext.
        quelle = io.open(os.path.abspath(__file__), encoding="utf-8").read()
        import ast
        rufe = {k.func.attr for k in ast.walk(ast.parse(quelle))
                if isinstance(k, ast.Call) and isinstance(k.func, ast.Attribute)}
        verboten = rufe & {"pruefe_mauer", "oeffne_nur_lesend",
                           "oeffne_zwischenstand", "schreibe_report"}
        pruefe("W-A: keiner der vier mauertragenden Einstiegspunkte wird gerufen",
               not verboten)
    except ZaehlwerkAbbruch as f:
        pruefe("F6-C2/C6 am echten Repo (" + str(f)[:70] + ")", False)

    print("selbsttest: " + str(ok) + " ok, " + str(fehl) + " FAIL")
    return 1 if fehl else 0


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    if argv[:1] == ["selbsttest"]:
        return selbsttest()
    print("F6-ZAEHLWERK - Instrument der einen konfirmatorischen Zaehlung.\n"
          "Es wird nicht selbst gestartet, sondern von scripts/studie-f6-lauf.py\n"
          "ueber --zaehlwerk geladen. Eigener Aufruf: selbsttest.", file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main())

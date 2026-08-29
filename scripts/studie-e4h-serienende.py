#!/usr/bin/env python
"""E4h - Endet die gewaehlte Serie, waehrend im SELBEN Filing eine nutzbare
Alternativ-Serie liegt? Ein reiner Metadaten-Zaehl-Lauf.

DIE FRAGE (ENTSCHIED 32, Punkt 4): E4g hat die dominante Restursache freigelegt -
25 der 39 S-G-Signal-Verluste (und 192 der 448 Kontrollpool-Verluste) reichen nach
ihrem Signal WEITERHIN 10-Q ein, waehrend ihre gewaehlte Serie endet oder zu kurz
bleibt. Keine der drei Ursprungs-Hypothesen erklaert diese Klasse. Der Verdacht:
nicht die Firma verschwindet, sondern die SERIEN-KONSTRUKTION verliert sie.

Diese Diagnose prueft das - und kann es kippen. Sie zaehlt, ob in den
nachfolgenden Einreichungen derselben Firma eine Serie liegt, die die vier
Folgequartale TRAEGT, aber unter einer anderen Achse:
    * anderes KONZEPT (tag)       - die Firma meldet unter einer Kennung, die die
                                    eingefrorene Quellenliste nicht kennt
    * andere UNIT (uom)           - dieselbe Kennung, andere Einheit
    * anderer TRACK (version)     - andere Taxonomie-Fassung, inkl. der
                                    firmeneigenen, die STANDARD_VERSION_RE
                                    verwirft

WAS DIESES SKRIPT NICHT TUT: Es entscheidet NICHTS. Die Entscheidungsregel ist in
orchestrator-2026-08-29.md ENTSCHIED 32.4 VORAB eingefroren - vor Kenntnis dieser
Zahlen, ohne Grauzone. Es aendert keine Schwelle, keine Reifedefinition, keine
Serien-Konstruktion, keine Praeregistrierung. Es ist DIAGNOSE, keine Korrektur.

── LESE-SCHRANKE, die diese Datei selbst durchsetzt ─────────────────────────────
Die E4h-SONDE liest ausschliesslich FAKT-METADATEN: tag, version, uom, ddate,
qtrs, verknuepft ueber adsh. `fakt.value` wird von der Sonde NICHT gelesen -
mechanisch abgesichert durch pruefe_sondenabfrage(), die jede SQL dieser Datei
gegen eine Spalten-Allowlist haelt, und durch einen Waechtertest, der die Schranke
einmal absichtlich bricht.

OFFENGELEGT (und dem Orchestrator zur Ratifizierung vorgelegt): Die POPULATION
(25/192) ist ohne die Signal- und Reiferechnung nicht rekonstruierbar, und die
laeuft ueber scripts/studie-basisraten.py, das `value` liest. Der Eintragstext
verlangt BEIDES - den 25/192-Bit-Anker UND "value wird nicht gelesen". Beides
zugleich ist nur so erfuellbar, wie es hier gebaut ist:
  * die POPULATIONS-Rekonstruktion nutzt unveraendert die mit ENTSCHIED 17 /
    E4g-v2 bereits autorisierte Wertlesung DERSELBEN Datei desselben Fensters,
  * die E4h-SONDE selbst liest garantiert keinen Wert.
Die ORCHESTRATOR-ANTWORT begruendet den Scope genau so ("eine Metadaten-Lesung
ist echte Teilmenge der bereits autorisierten Wertlesung"). Eine Lesart, die den
eigenen Pflicht-Selbstcheck des Eintrags unmoeglich macht, kann nicht gemeint
sein. Sollte der Orchestrator das anders sehen, ist der Lauf zu verwerfen - die
Offenlegung steht deshalb im Bericht ganz oben.

Aufruf:
  python scripts/studie-e4h-serienende.py --selbsttest
  python scripts/studie-e4h-serienende.py --allowlist-ausgeben
  python scripts/studie-e4h-serienende.py --freigabe <freigabe.json> --ziel <report.json>
"""

import argparse
import importlib.util
import json
import os
import platform
import re
import sqlite3
import sys
from collections import defaultdict

WURZEL = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
E4A_SKRIPT = os.path.join(WURZEL, "scripts", "studie-e4a-diagnose.py")

SCHEMA = "early-detection-e4h-serienende/v1"
FENSTER_NAME = "pruefung"
VARIANTE = "S-G"
BAND = (2017, 2019)
WEITERFILER_FORM = "10-Q"

# ── Die Ausgabe-Allowlist ────────────────────────────────────────────────────
# EXAKT die 14 Felder aus `allowedOutputs` des Register-Eintrags
# e4h-serienende-pruefung-2026-08-29. Gleichheit wird in BEIDE Richtungen
# geprueft: ein Feld mehr ist ein Leck, ein Feld weniger eine stille
# Entschaerfung. Alle 14 sind Firmen-ZAHLEN - kein Wert, keine Kennung, keine
# Konzept- oder Unit-Liste.
DATEN_FELDER = (
    "alternativ_mehrere_achsen",
    "alternativ_nur_andere_unit",
    "alternativ_nur_anderer_track",
    "alternativ_nur_anderes_konzept",
    "ddate_abgedeckt",
    "fallzahl",
    "gewaehlte_serie_endet",
    "kontrollpool_weiterfiler",
    "mit_nutzbarer_alternativserie",
    "nenner_alternativpruefung",
    "ohne_nutzbare_alternativserie",
    "qtrs_abgedeckt",
    "quartalsfakten_im_filing_vorhanden",
    "signal_weiterfiler",
)

ARM_ZAEHLER = ("alternativ_mehrere_achsen", "alternativ_nur_andere_unit",
               "alternativ_nur_anderer_track", "alternativ_nur_anderes_konzept",
               "ddate_abgedeckt", "fallzahl", "gewaehlte_serie_endet",
               "mit_nutzbarer_alternativserie", "nenner_alternativpruefung",
               "ohne_nutzbare_alternativserie", "qtrs_abgedeckt",
               "quartalsfakten_im_filing_vorhanden")
ARM_BLOCK = tuple(sorted(ARM_ZAEHLER))
ARME = ("kontrolle", "signal")

UMSCHLAG_ALLOWLIST = (
    "accessedAt", "arme", "beendetAm", "ergebnisdatenBeruehrt", "ersterZugriffAm",
    "fenster", "gelesenePfade", "geschriebenePfade", "kontrollpool_weiterfiler",
    "manifestGeprueft", "panelRand", "perzentil", "protokoll", "runId", "schema",
    "selbstCheck", "serverConfirmedAt", "siegelWache", "signal_weiterfiler",
    "sondenSpalten", "umgebung", "variante",
)

# Die committeten E4g-Zahlen (reports/studie/E4g-restursachen-diagnose-2026-08-29,
# letzte_form_nach_signal == "10-Q") plus die E4a-Fallzahlen als zweiter,
# unabhaengiger Anker. Jede Abweichung bricht ab.
ANKER = {
    "signal": {"weiterfiler": 25, "fallzahl": 326},
    "kontrolle": {"weiterfiler": 192, "fallzahl": 4285},
}
ANKER_QUELLE = ("reports/studie/E4g-restursachen-diagnose-2026-08-29.json"
                " + reports/studie/E4a-diagnose-pruefung-2026-08-19.json")

# ── Die Lese-Schranke der Sonde ──────────────────────────────────────────────
# Genau die fuenf im Register-Eintrag benannten Metadaten-Spalten, plus `adsh`
# als Verknuepfung. `value` steht NICHT darin und darf nicht hinein.
SONDEN_SPALTEN = ("adsh", "ddate", "qtrs", "tag", "uom", "version")
VERBOTENE_SPALTE = "value"

# Jede gepruefte Abfrage wird mitgeschrieben. Damit laesst sich BELEGEN, dass die
# Schranke auf dem ECHTEN Lesepfad sitzt - nicht nur, dass es sie gibt. Ein
# Textscan ueber die Datei koennte das nicht: er stuende in seinem eigenen
# Suchraum (die Sabotage-Fixtures des Selbsttests enthalten die verbotene Spalte
# absichtlich als Zeichenkette).
GEPRUEFTE_ABFRAGEN = []


class SerienendeFehler(Exception):
    """Ein Befund, der den Lauf anhaelt - nie ein stiller Rueckfall."""


def lade(pfad, name):
    spec = importlib.util.spec_from_file_location(name, pfad)
    if spec is None or spec.loader is None:
        raise SerienendeFehler("Skript nicht ladbar: " + pfad)
    modul = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(modul)
    return modul


e4a = lade(E4A_SKRIPT, "studie_e4a_diagnose")
zp = e4a.zp


def pruefe_sondenabfrage(sql):
    """DIE LESE-SCHRANKE, mechanisch statt als Versprechen.

    Jede SQL, die diese Datei gegen `fakt` faehrt, laeuft hier durch. Erlaubt
    sind ausschliesslich die sechs Sonden-Spalten; taucht `value` auf, bricht der
    Lauf ab. Das ist der Unterschied zwischen 'wir lesen keinen Wert' als Satz im
    Bericht und als pruefbarer Eigenschaft des Codes."""
    flach = " ".join(str(sql).lower().split())
    GEPRUEFTE_ABFRAGEN.append(flach)
    if re.search(r"\b" + VERBOTENE_SPALTE + r"\b", flach):
        raise SerienendeFehler(
            "SONDEN-ABBRUCH: die Abfrage nennt die Spalte '" + VERBOTENE_SPALTE
            + "'. E4h ist eine reine Metadaten-Zaehlung; der Wert-Zugriff ist im "
            "Register-Eintrag ausdruecklich ausgeschlossen und damit gehasht.")
    gewaehlt = flach.split(" from ")[0].replace("select", "", 1)
    for stueck in gewaehlt.split(","):
        name = stueck.strip()
        if name and name not in SONDEN_SPALTEN:
            raise SerienendeFehler(
                "SONDEN-ABBRUCH: die Abfrage waehlt '" + name + "' - erlaubt sind "
                "ausschliesslich " + ", ".join(SONDEN_SPALTEN) + ".")
    return True


# ── Die Sonde ────────────────────────────────────────────────────────────────

def lies_fakt_metadaten(panel, e2, berichte_je_adsh, firmen=None):
    """cik -> Liste (ddate, tag, uom, version, qtrs, accepted) - OHNE Wert.

    Gelesen wird die Faktentabelle EINMAL sequenziell, wie die Zaehlprobe es tut
    (R14d: 40 Mio Zeilen, kein Index, nie am Stueck). Anders als dort faellt hier
    weder ein tag-Filter noch ein Versions-Filter an: die FRAGE ist ja gerade, was
    ausserhalb der eingefrorenen Quellenliste liegt. Ein Vorfilter wuerde die
    Antwort in die bequeme Richtung schieben."""
    frage = ("SELECT adsh, tag, version, uom, ddate, qtrs FROM fakt"
             " WHERE rowid BETWEEN ? AND ?")
    pruefe_sondenabfrage(frage)
    hoechste = panel.execute("SELECT MAX(rowid) FROM fakt").fetchone()[0] or 0
    if hoechste == 0 or not berichte_je_adsh:
        raise SerienendeFehler(
            "SONDEN-ABBRUCH: Panel traegt keine auswertbaren Metadaten "
            "(Faktenzeilen: " + str(hoechste) + ", periodische Berichte: "
            + str(len(berichte_je_adsh)) + "). Ein Report voller Nullen waere von "
            "einem echten Negativergebnis nicht zu unterscheiden.")
    je_firma = defaultdict(list)
    block = 2000000
    von = 1
    while von <= hoechste:
        for adsh, tag, version, uom, ddate, qtrs in panel.execute(
                frage, (von, von + block - 1)):
            traeger = berichte_je_adsh.get(adsh)
            if traeger is None:
                continue                       # nicht-periodische Einreichung
            # NUR die gepruefte Population. Ohne diesen Filter haelt der Lauf die
            # Metadaten aller ~5000 Firmen im Speicher (zweistellige Gigabyte bei
            # 40 Mio Faktenzeilen) - die Zaehlprobe schreibt aus genau diesem Grund
            # in eine Arbeitsdatei (R14d). Hier ist die Population vor dem Lesen
            # bekannt, also wird gar nicht erst eingesammelt, was niemand braucht.
            if firmen is not None and traeger[0] not in firmen:
                continue
            # Dieselbe Periodenlaengen-Schranke wie die Zaehlprobe
            # (studie-basisraten.py: qtrs in ('1','4')). `qtrs` bleibt am Datensatz
            # stehen, statt hier weggefiltert zu werden: die ddate-Achse und die
            # QUARTALS-Achse sind zwei verschiedene Fragen, und ein Vorfilter
            # wuerde sie zu einer einzigen verschmelzen.
            if qtrs not in ("1", "4"):
                continue
            if e2.ordinal(ddate) is None:
                continue
            je_firma[traeger[0]].append(
                (str(ddate), str(tag), str(uom or ""), str(version or ""),
                 str(qtrs), traeger[1]))
        von += block
    return je_firma


def gewaehlte_achsen(f, metadaten):
    """Die Achsen der GEWAEHLTEN Serie der Firma, aus den Metadaten gelesen.

    Konzept und Unit stehen an der Signal-Basis (`f["basis"]` = (Quellenname,
    uom); fuer S-G ist der Quellenname die Kennung OperatingIncomeLoss selbst).
    Der TRACK steht nicht an der Basis - die Serien-Konstruktion gruppiert nach
    (tag, uom) und filtert `version` nur, sie schluesselt nicht danach. Der
    gewaehlte Track wird deshalb aus den Metadaten der Quartale VOR dem Signal
    gelesen: alle Taxonomie-Fassungen, unter denen die gewaehlte Kennung in
    dieser Einheit bis zum Signal gemeldet wurde."""
    tag, uom = f["basis"]
    tracks = set(v for d, t, u, v, q, _a in metadaten
                 if t == tag and u == uom and q == "1" and d <= f["ddate"])
    return tag, uom, tracks


def alternativserie(f, metadaten, e2, rand_ordinal):
    """DIE SONDE: traegt eine ANDERE Achse die vier Folgequartale?

    OPERATIONALISIERUNG (mechanisch, vorab festgelegt, NICHT auf eine Zielzahl
    gestimmt - im Bericht woertlich offengelegt):

      Nutzbar ist eine Alternativ-Serie genau dann, wenn EIN Schluessel
      (tag, uom, version) existiert, der
        (1) in den NACH dem Signal eingereichten periodischen Berichten der Firma
            vorkommt (accepted(Bericht) > accepted(Signal)),
        (2) auf mindestens einer der drei Achsen von der gewaehlten Serie
            abweicht,
        (3) qtrs = '1' traegt (echte Quartalsfakten, keine Jahreswerte), und
        (4) mindestens REIFE_QUARTALE (4) VERSCHIEDENE Bilanzstichtage
            ddate > ddate(Signal) innerhalb des Panelfensters abdeckt.

    Die Schwelle ist NICHT frei gewaehlt: (4) ist woertlich die eingefrorene
    Reifebedingung aus studie-basisraten.py::REIFE_QUARTALE. Die Frage lautet ja
    genau 'waere diese Firma unter einer korrigierten Konstruktionsregel reif
    geworden' - jede andere Zahl waere eine neue Schwelle und damit eine
    Methodikaenderung.

    Achsen-Einordnung der Firma: unter allen qualifizierenden Schluesseln zaehlt
    der mit den WENIGSTEN abweichenden Achsen (der konservativste, der gewaehlten
    Serie naechste). Gleichstand wird deterministisch aufgeloest - erst nach Zahl
    der Achsen, dann nach der festen Achsen-Reihenfolge Konzept < Unit < Track.

    Rueckgabe: (quartalsfakten_da, ddate_abgedeckt, qtrs_abgedeckt, achsen)
               achsen ist None (keine nutzbare Alternative) oder ein sortiertes
               Tupel aus {"konzept", "unit", "track"}.
    """
    grenze_accepted = str(f["accepted"])
    nach = [(d, t, u, v, q) for d, t, u, v, q, acc in metadaten
            if acc > grenze_accepted]
    quartalsfakten_da = any(q == "1" for _d, _t, _u, _v, q in nach)
    spaeter = [(d, t, u, v, q) for d, t, u, v, q in nach
               if d > f["ddate"] and e2.ordinal(d) <= rand_ordinal]
    # ZWEI VERSCHIEDENE FRAGEN, bewusst getrennt gezaehlt:
    #   ddate_abgedeckt - traegt die Firma nach dem Signal ueberhaupt vier
    #                     verschiedene Bilanzstichtage? (Perioden-Achse, jede
    #                     Periodenlaenge)
    #   qtrs_abgedeckt  - sind darunter vier QUARTALS-Stichtage (qtrs='1')?
    # Eine Firma, die in ihren 10-Q nur noch Jahreswerte meldet, deckt die erste
    # Achse und reisst die zweite. Wer beide aus demselben Vorfilter rechnet,
    # kann diesen Fall nicht mehr sehen.
    ddate_abgedeckt = (len(set(d for d, _t, _u, _v, _q in spaeter))
                       >= e2.REIFE_QUARTALE)
    qtrs_abgedeckt = (len(set(d for d, _t, _u, _v, q in spaeter if q == "1"))
                      >= e2.REIFE_QUARTALE)

    g_tag, g_uom, g_tracks = gewaehlte_achsen(f, metadaten)
    je_schluessel = defaultdict(set)
    for d, t, u, v, q in spaeter:
        if q != "1":
            continue          # eine Fortsetzungs-Serie besteht aus QUARTALEN
        je_schluessel[(t, u, v)].add(d)

    beste = None
    for (t, u, v), stichtage in je_schluessel.items():
        if len(stichtage) < e2.REIFE_QUARTALE:
            continue
        achsen = []
        if t != g_tag:
            achsen.append("konzept")
        if u != g_uom:
            achsen.append("unit")
        if v not in g_tracks:
            achsen.append("track")
        if not achsen:
            continue                    # identisch mit der gewaehlten Serie
        ordnung = (len(achsen), tuple(sorted(achsen)))
        if beste is None or ordnung < beste[0]:
            beste = (ordnung, tuple(sorted(achsen)))
    return quartalsfakten_da, ddate_abgedeckt, qtrs_abgedeckt, (
        beste[1] if beste else None)


ACHSEN_FELD = {
    ("konzept",): "alternativ_nur_anderes_konzept",
    ("unit",): "alternativ_nur_andere_unit",
    ("track",): "alternativ_nur_anderer_track",
}


# ── Der Arm ──────────────────────────────────────────────────────────────────

def leerer_arm():
    return dict((feld, 0) for feld in ARM_ZAEHLER)


def zerlege_arm(weiterfiler, gewaehlt, metadaten_je_firma, fallzahl, e2,
                rand_ordinal):
    """EIN Arm - Signal oder Kontrollpool, derselbe Code, dieselbe
    Fehlbehandlung. Die Vorstudie ist daran gestorben, dass fehlende Werte in
    einer Gruppe strenger gebucht wurden als in der anderen."""
    block = leerer_arm()
    block["fallzahl"] = fallzahl
    block["nenner_alternativpruefung"] = len(weiterfiler)
    for f in weiterfiler:
        reihe = gewaehlt.get(f["cik"]) or {}
        if not any(d > f["ddate"] for d in reihe):
            block["gewaehlte_serie_endet"] += 1
        metadaten = metadaten_je_firma.get(f["cik"], ())
        da, ddate_ok, qtrs_ok, achsen = alternativserie(
            f, metadaten, e2, rand_ordinal)
        if da:
            block["quartalsfakten_im_filing_vorhanden"] += 1
        if ddate_ok:
            block["ddate_abgedeckt"] += 1
        if qtrs_ok:
            block["qtrs_abgedeckt"] += 1
        if achsen is None:
            block["ohne_nutzbare_alternativserie"] += 1
            continue
        block["mit_nutzbarer_alternativserie"] += 1
        block[ACHSEN_FELD.get(achsen, "alternativ_mehrere_achsen")] += 1
    pruefe_arminvarianten(block)
    return block


def pruefe_arminvarianten(b):
    """Die Zerlegung muss AUFGEHEN. Ein Zaehler, der sich still von der
    Gesamtzahl loest, waere die bequemste Art, ein gewuenschtes Ergebnis zu
    erzeugen - deshalb bricht hier der Lauf ab, statt zu runden."""
    n = b["nenner_alternativpruefung"]
    if b["mit_nutzbarer_alternativserie"] + b["ohne_nutzbare_alternativserie"] != n:
        raise SerienendeFehler(
            "ZERLEGUNGS-ABBRUCH: mit (" + str(b["mit_nutzbarer_alternativserie"])
            + ") + ohne (" + str(b["ohne_nutzbare_alternativserie"])
            + ") ergibt nicht den Nenner (" + str(n) + ").")
    achsen = (b["alternativ_nur_anderes_konzept"] + b["alternativ_nur_andere_unit"]
              + b["alternativ_nur_anderer_track"] + b["alternativ_mehrere_achsen"])
    if achsen != b["mit_nutzbarer_alternativserie"]:
        raise SerienendeFehler(
            "ZERLEGUNGS-ABBRUCH: die Achsen-Zaehler summieren sich auf "
            + str(achsen) + ", nutzbare Alternativen sind "
            + str(b["mit_nutzbarer_alternativserie"])
            + ". Eine Zerlegung, die nicht aufgeht, erklaert nichts.")
    # Der Trichter MUSS monoton sein: wer eine nutzbare Alternative traegt, hat
    # vier Stichtage; wer vier Stichtage hat, hat ueberhaupt Quartalsfakten. Bricht
    # das, misst die Sonde etwas anderes als sie behauptet.
    # ddate_abgedeckt ist NICHT enger als quartalsfakten_im_filing_vorhanden: eine
    # Firma kann vier Stichtage tragen, die alle Jahreswerte sind. Genau darum
    # sind es zwei Zaehler; die Kette bildet nur die echten Teilmengen ab.
    for enger, weiter in (("mit_nutzbarer_alternativserie", "qtrs_abgedeckt"),
                          ("qtrs_abgedeckt", "ddate_abgedeckt"),
                          ("qtrs_abgedeckt", "quartalsfakten_im_filing_vorhanden"),
                          ("ddate_abgedeckt", "nenner_alternativpruefung"),
                          ("quartalsfakten_im_filing_vorhanden",
                           "nenner_alternativpruefung")):
        if b[enger] > b[weiter]:
            raise SerienendeFehler(
                "TRICHTER-ABBRUCH: " + enger + " (" + str(b[enger]) + ") ist "
                "groesser als " + weiter + " (" + str(b[weiter]) + "). Der "
                "Trichter ist per Konstruktion monoton; bricht er, ist die Sonde "
                "kaputt.")
    if b["gewaehlte_serie_endet"] > n:
        raise SerienendeFehler(
            "ZERLEGUNGS-ABBRUCH: mehr endende Serien als gepruefte Firmen.")
    return True


# ── Der Lauf ─────────────────────────────────────────────────────────────────

def serienende(panel, arbeit_pfad, e2):
    """Population EXAKT wie E4g (importiert, nicht nachgebaut), dann die Sonde.

    Die Populations-Rekonstruktion nutzt die mit ENTSCHIED 17 / E4g-v2
    autorisierte Wertlesung derselben Datei; die E4h-SONDE selbst liest
    ausschliesslich Metadaten (siehe Dateikopf, Abschnitt LESE-SCHRANKE)."""
    fenster = zp.FENSTER[FENSTER_NAME]
    if zp.REIFE_QUARTALE != e2.REIFE_QUARTALE:
        raise SerienendeFehler(
            "REIFE-ABBRUCH: zwei Schwellen fuer dieselbe Sache heisst: keine.")
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

    formulare, _afs = lies_formulare(panel, e2)
    rand_ordinal = e2.ordinal(fenster["rand"].replace("-", ""))

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

    # Erst die Population festnageln (samt Bit-Anker), DANN die Metadaten lesen -
    # und zwar nur fuer genau diese Firmen. Der Anker sitzt damit VOR dem
    # Sonden-Lesepfad: eine falsche Population kommt gar nicht erst bis zur Sonde.
    population = {}
    for name, eintraege in (("signal", band_f), ("kontrolle", kontroll)):
        reif, unreif = e2.erst_ereignisse(eintraege, gewaehlt)
        weiterfiler = [f for f in unreif
                       if letzte_form(f, formulare, e2) == WEITERFILER_FORM]
        pruefe_anker(name, len(weiterfiler), len(reif))
        population[name] = (weiterfiler, len(reif))

    firmen = set(f["cik"] for w, _n in population.values() for f in w)
    metadaten_je_firma = lies_fakt_metadaten(panel, e2, berichte, firmen)

    arme = {}
    for name, (weiterfiler, fallzahl) in population.items():
        arme[name] = zerlege_arm(weiterfiler, gewaehlt, metadaten_je_firma,
                                 fallzahl, e2, rand_ordinal)
    return arme


def lies_formulare(panel, e2):
    """cik -> sortierte (accepted, formstamm)-Liste. Dieselbe Quelle und dieselbe
    Normalisierung wie E4g (scripts/studie-e4g-restursachen.py::lies_metadaten) -
    die Population muss byte-genau dieselbe sein, sonst ist der Bit-Anker wertlos."""
    formulare = defaultdict(list)
    for cik, form, accepted in panel.execute(
            "SELECT cik, form, accepted FROM bericht"):
        firma = str(cik or "").strip()
        if not firma or not accepted:
            continue
        formulare[firma].append((str(accepted), e2.formstamm(form)))
    for firma in formulare:
        formulare[firma].sort()
    return dict(formulare), None


def letzte_form(f, formulare, e2):
    """Der Formstamm der SPAETESTEN Zeile nach dem Signal - wortgleich E4gs
    Sonde 2. Keine Zeile mehr heisst None, nie '10-Q'."""
    grenze = str(f["accepted"])
    nach = [(acc, form) for acc, form in formulare.get(f["cik"], ())
            if acc > grenze]
    return max(nach)[1] if nach else None


def pruefe_anker(arm, weiterfiler, fallzahl):
    """DER BIT-ANKER aus ENTSCHIED 32.4, im Register-Eintragstext gehasht.

    25 Signal- und 192 Kontrollpool-Weiterfiler. Jede Abweichung ist ein
    SOFORT-STOPP mit Eskalation an den Orchestrator - kein Weiterrechnen, keine
    Anpassung der Rekonstruktion an die Sollzahl, keine zweite Variante. Die
    E4a-Fallzahl laeuft als zweiter, unabhaengiger Anker mit: eine Rekonstruktion,
    die zufaellig 25 Weiterfiler bei falscher Population liefert, faellt daran auf."""
    soll = ANKER[arm]
    if weiterfiler != soll["weiterfiler"] or fallzahl != soll["fallzahl"]:
        raise SerienendeFehler(
            "ANKER_ABBRUCH (SOFORT-STOPP, Eskalation an den Orchestrator): Arm "
            + arm + " ergibt " + str(weiterfiler) + " 10-Q-Weiterfiler bei "
            "Fallzahl " + str(fallzahl) + "; die committeten Zahlen sind "
            + str(soll["weiterfiler"]) + " bei " + str(soll["fallzahl"]) + " ("
            + ANKER_QUELLE + "). Der Selbst-Check des Register-Eintrags "
            "e4h-serienende-pruefung-2026-08-29 ist damit VERLETZT. Es wird NICHT "
            "weitergerechnet und die Rekonstruktion NICHT an die Sollzahl "
            "angepasst.")
    return True


# ── Waechter ─────────────────────────────────────────────────────────────────

def pruefe_anmeldung_deckt_ausgabe(freigabe, register_pfad=None):
    """W9: was ausgegeben wird, muss angemeldet sein - Feld fuer Feld, in beide
    Richtungen. Wer ein Feld ergaenzt, ohne es anzumelden, faellt auf - und wer
    eines weglaesst, auch: sonst liesse sich ein unbequemer Zaehler durch
    Schweigen entschaerfen."""
    pfad = register_pfad or zp.REGISTER
    with open(pfad, encoding="utf-8") as f:
        register = json.load(f)
    treffer = [e for e in (register.get("events") or [])
               if e.get("runId") == freigabe["runId"]]
    if len(treffer) != 1:
        raise SerienendeFehler(
            "W9-ABBRUCH: runId " + repr(freigabe["runId"]) + " steht "
            + str(len(treffer)) + "-mal im Zugriffs-Register.")
    angemeldet = set(treffer[0].get("allowedOutputs") or ())
    erlaubt = set(DATEN_FELDER)
    if angemeldet != erlaubt:
        raise SerienendeFehler(
            "W9-ABBRUCH: die Anmeldung deckt die Ausgabe nicht. Nur im Skript: "
            + str(sorted(erlaubt - angemeldet)) + "; nur im Register: "
            + str(sorted(angemeldet - erlaubt)) + ".")
    return True


def pruefe_ausgabe(ausgabe):
    """W3-E4h: die Ergebnis-Sperre. Jeder nicht gelistete Schluessel ist ein
    ABBRUCH, in BEIDE Richtungen, plus eine Typpruefung: alle 14 Groessen sind
    nicht-negative ganze Zahlen. Ein durchgereichter Messwert faellt damit auf,
    auch wenn er sich unter einem erlaubten Namen versteckt - und eine
    Konzept-, Unit- oder Kennungs-Liste ebenso, weil sie keine Zahl ist."""
    fremd = sorted(set(ausgabe) - set(UMSCHLAG_ALLOWLIST))
    if fremd:
        raise SerienendeFehler(
            "W3-ABBRUCH: der Umschlag traegt nicht gelistete Schluessel: "
            + ", ".join(fremd))
    fehlend = sorted(set(UMSCHLAG_ALLOWLIST) - set(ausgabe))
    if fehlend:
        raise SerienendeFehler(
            "W3-ABBRUCH: dem Umschlag fehlen Pflichtfelder: " + ", ".join(fehlend))
    arme = ausgabe.get("arme") or {}
    if sorted(arme) != sorted(ARME):
        raise SerienendeFehler(
            "W3-ABBRUCH: die Ausgabe fuehrt die Arme " + str(sorted(arme))
            + ", erwartet sind " + str(sorted(ARME)) + ".")
    for name, arm in sorted(arme.items()):
        if not isinstance(arm, dict):
            raise SerienendeFehler("W3-ABBRUCH: " + name + " ist kein Block.")
        fremd = sorted(set(arm) - set(ARM_BLOCK))
        if fremd:
            raise SerienendeFehler(
                "W3-ABBRUCH: " + name + " gibt nicht gelistete Groessen aus: "
                + ", ".join(fremd) + ". Genau das ist die Ergebnis-Sperre (R4).")
        fehlend = sorted(set(ARM_BLOCK) - set(arm))
        if fehlend:
            raise SerienendeFehler(
                "W3-ABBRUCH: " + name + " fehlen Pflichtgroessen: "
                + ", ".join(fehlend))
        for feld in ARM_ZAEHLER:
            pruefe_zahl(arm[feld], name + "/" + feld)
    for feld in ("signal_weiterfiler", "kontrollpool_weiterfiler"):
        pruefe_zahl(ausgabe[feld], feld)
    if sorted(ausgabe["sondenSpalten"]) != sorted(SONDEN_SPALTEN):
        raise SerienendeFehler(
            "W3-ABBRUCH: die ausgewiesenen Sonden-Spalten weichen von der "
            "Lese-Schranke ab. Der Bericht muss zeigen, was gelesen wurde.")
    return True


def pruefe_zahl(wert, ort):
    if not isinstance(wert, int) or isinstance(wert, bool) or wert < 0:
        raise SerienendeFehler(
            "W3-ABBRUCH: " + ort + " ist " + repr(wert) + " - erwartet ist eine "
            "nicht-negative ganze Zahl. Ein Nachkommawert oder eine Liste an "
            "dieser Stelle waere ein durchgereichter Messwert, kein Zaehler.")
    return True


def lauf(freigabe_pfad, data_root=None, arbeit=None, ziel=None, siegel_voll=True,
         panel_pfad=None, register_pfad=None):
    fenster = zp.FENSTER[FENSTER_NAME]
    if fenster["sperrzone"]:
        raise SerienendeFehler("SPERRZONE-STOPP: " + FENSTER_NAME)

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
        wurzel, "arbeit", "E4h-" + FENSTER_NAME + "-zwischenstand.sqlite")

    e2 = zp.lade_modul(zp.E2_SKRIPT, "studie_basisraten")
    panel = zp.oeffne_nur_lesend(panel_pfad, FENSTER_NAME)
    try:
        arme = serienende(panel, arbeit_pfad, e2)
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
        "sondenSpalten": sorted(SONDEN_SPALTEN),
        "umgebung": {"plattform": sys.platform, "python": platform.python_version(),
                     "sqlite": sqlite3.sqlite_version},
        "selbstCheck": {
            "quelle": ANKER_QUELLE,
            "sollSignalWeiterfiler": ANKER["signal"]["weiterfiler"],
            "istSignalWeiterfiler": arme["signal"]["nenner_alternativpruefung"],
            "sollKontrollpoolWeiterfiler": ANKER["kontrolle"]["weiterfiler"],
            "istKontrollpoolWeiterfiler":
                arme["kontrolle"]["nenner_alternativpruefung"],
            "sollFallzahlSignal": ANKER["signal"]["fallzahl"],
            "istFallzahlSignal": arme["signal"]["fallzahl"],
            "sollFallzahlKontrolle": ANKER["kontrolle"]["fallzahl"],
            "istFallzahlKontrolle": arme["kontrolle"]["fallzahl"],
            "bestanden": True,
        },
        "signal_weiterfiler": arme["signal"]["nenner_alternativpruefung"],
        "kontrollpool_weiterfiler": arme["kontrolle"]["nenner_alternativpruefung"],
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
    except SerienendeFehler:
        return True
    return False


class _E2:
    def __init__(self, e2):
        self.ordinal = e2.ordinal
        self.formstamm = e2.formstamm
        self.PERIODISCHE_FORMEN = e2.PERIODISCHE_FORMEN
        self.REIFE_QUARTALE = e2.REIFE_QUARTALE


def _md(eintraege, qtrs="1"):
    """(ddate, tag, uom, version, qtrs, accepted) - die Metadaten-Form der Sonde."""
    return [(d, t, u, v, qtrs, a) for d, t, u, v, a in eintraege]


def _gueltige_ausgabe():
    arm = leerer_arm()
    arm["fallzahl"] = 326
    arm["nenner_alternativpruefung"] = 4
    arm["quartalsfakten_im_filing_vorhanden"] = 4
    arm["ddate_abgedeckt"] = 3
    arm["qtrs_abgedeckt"] = 3
    arm["gewaehlte_serie_endet"] = 1
    arm["mit_nutzbarer_alternativserie"] = 3
    arm["ohne_nutzbare_alternativserie"] = 1
    arm["alternativ_nur_anderes_konzept"] = 1
    arm["alternativ_nur_andere_unit"] = 1
    arm["alternativ_nur_anderer_track"] = 1
    import copy
    return {
        "schema": SCHEMA, "protokoll": "FEM-SEC-US@2.0.0", "runId": "x",
        "fenster": FENSTER_NAME, "variante": VARIANTE, "panelRand": "2020-12-31",
        "perzentil": 95, "serverConfirmedAt": "z", "accessedAt": "z",
        "ersterZugriffAm": "z", "beendetAm": "z", "gelesenePfade": [],
        "geschriebenePfade": [], "ergebnisdatenBeruehrt": False,
        "siegelWache": {}, "manifestGeprueft": [], "umgebung": {},
        "sondenSpalten": sorted(SONDEN_SPALTEN), "selbstCheck": {},
        "signal_weiterfiler": 4, "kontrollpool_weiterfiler": 4,
        "arme": {"signal": arm, "kontrolle": copy.deepcopy(arm)},
    }


def selbsttest():
    e2_voll = zp.lade_modul(zp.E2_SKRIPT, "studie_basisraten")
    e2 = _E2(e2_voll)
    rand = e2.ordinal("20201231")
    OIL = "OperatingIncomeLoss"

    # Signal: Stichtag 2019-03-31, angemeldet 2019-05-15, Basis (OIL, USD),
    # Track us-gaap/2018. Davor zwei Quartale derselben Achse.
    f = {"cik": "1", "ddate": "20190331", "accepted": "2019-05-15 12:00:00.0",
         "basis": (OIL, "USD")}
    vor = [("20180930", OIL, "USD", "us-gaap/2018", "2018-11-10 12:00:00.0"),
           ("20181231", OIL, "USD", "us-gaap/2018", "2019-02-10 12:00:00.0"),
           ("20190331", OIL, "USD", "us-gaap/2018", "2019-05-15 12:00:00.0")]

    def nach(tag, uom, version, n=4, ab=6):
        return [("2019%02d30" % (ab + i), tag, uom, version,
                 "2020-01-%02d 12:00:00.0" % (i + 1)) for i in range(n)]

    # ── Die Sonde ────────────────────────────────────────────────────────────
    da, dd, qq, achsen = alternativserie(
        f, _md(vor + nach("OperatingIncomeLossAdjusted", "USD", "us-gaap/2018")),
        e2, rand)
    pruefe("Sonde: vier Folgequartale unter anderem KONZEPT -> nur Konzept",
           achsen == ("konzept",), achsen, ("konzept",))
    pruefe("Sonde: Quartalsfakten im Filing werden erkannt", da is True)
    pruefe("Sonde: vier Stichtage decken die ddate-Achse", dd is True and qq is True)

    _d, _e, _q, achsen = alternativserie(
        f, _md(vor + nach(OIL, "EUR", "us-gaap/2018")), e2, rand)
    pruefe("Sonde: vier Folgequartale in anderer UNIT -> nur Unit",
           achsen == ("unit",), achsen, ("unit",))

    _d, _e, _q, achsen = alternativserie(
        f, _md(vor + nach(OIL, "USD", "us-gaap/2020")), e2, rand)
    pruefe("Sonde: vier Folgequartale unter anderem TRACK -> nur Track",
           achsen == ("track",), achsen, ("track",))

    _d, _e, _q, achsen = alternativserie(
        f, _md(vor + nach("Sonstiges", "EUR", "firma/eigen")), e2, rand)
    pruefe("Sonde: Abweichung auf drei Achsen -> mehrere Achsen",
           achsen == ("konzept", "track", "unit"), achsen,
           ("konzept", "track", "unit"))

    _d, _e, _q, achsen = alternativserie(
        f, _md(vor + nach("OperatingIncomeLossAdjusted", "USD", "us-gaap/2018", 3)),
        e2, rand)
    pruefe("Sonde: DREI Folgequartale reichen NICHT - die Reifeschwelle haelt",
           achsen is None, achsen, None)

    _d, _e, _q, achsen = alternativserie(
        f, _md(vor + nach(OIL, "USD", "us-gaap/2018")), e2, rand)
    pruefe("Sonde: dieselbe Achse ist KEINE Alternative",
           achsen is None, achsen, None)

    # Die konservative Einordnung: liegen Konzept-Alternative UND
    # Mehr-Achsen-Alternative vor, zaehlt die mit den WENIGSTEN Achsen.
    _d, _e, _q, achsen = alternativserie(
        f, _md(vor + nach("OperatingIncomeLossAdjusted", "USD", "us-gaap/2018")
               + nach("Sonstiges", "EUR", "firma/eigen")), e2, rand)
    pruefe("Sonde: bei mehreren Treffern zaehlt die konservativste Achse",
           achsen == ("konzept",), achsen, ("konzept",))

    # Vorgriffs-Schutz: was VOR dem Signal eingereicht wurde, ist keine
    # Fortsetzung. Und was nach dem Panelrand liegt, existiert fuer die Studie nicht.
    frueh = [(d, "X", "USD", "us-gaap/2018", "2018-01-01 12:00:00.0")
             for d in ("20190630", "20190930", "20191231", "20200331")]
    _d, _e, _q, achsen = alternativserie(f, _md(vor + frueh), e2, rand)
    pruefe("Sonde: vor dem Signal eingereichte Zeilen sind keine Fortsetzung",
           achsen is None, achsen, None)
    spaet = [(d, "X", "USD", "us-gaap/2018", "2020-06-01 12:00:00.0")
             for d in ("20210331", "20210630", "20210930", "20211231")]
    _d, _e, _q, achsen = alternativserie(f, _md(vor + spaet), e2, rand)
    pruefe("Sonde: Stichtage HINTER dem Panelrand zaehlen nicht",
           achsen is None, achsen, None)

    # Der gewaehlte Track wird aus den Metadaten VOR dem Signal gelesen.
    _t, _u, tracks = gewaehlte_achsen(f, _md(vor))
    pruefe("Sonde: der gewaehlte Track kommt aus den Vor-Signal-Metadaten",
           tracks == {"us-gaap/2018"}, tracks, {"us-gaap/2018"})

    # Die beiden Abdeckungs-Achsen sind WIRKLICH zwei: vier Jahres-Stichtage
    # decken die Perioden-Achse und reissen die Quartals-Achse. Ohne diese Probe
    # waeren die zwei Zaehler stillschweigend derselbe Zaehler.
    jahres = _md(nach("OperatingIncomeLossAdjusted", "USD", "us-gaap/2018"),
                 qtrs="4")
    da, dd, qq, achsen = alternativserie(f, _md(vor) + jahres, e2, rand)
    pruefe("Abdeckung: vier JAHRES-Stichtage decken die ddate-Achse", dd is True)
    pruefe("Abdeckung: sie decken die QUARTALS-Achse aber NICHT", qq is False)
    pruefe("Abdeckung: ohne Quartalsfakten gibt es keine Alternativ-Serie",
           achsen is None and da is False, (achsen, da), (None, False))

    # ── Die Lese-Schranke ────────────────────────────────────────────────────
    pruefe("Lese-Schranke: die Metadaten-Abfrage geht durch",
           pruefe_sondenabfrage(
               "SELECT adsh, tag, version, uom, ddate, qtrs FROM fakt"))
    pruefe("Lese-Schranke: eine Abfrage MIT value bricht ab",
           _bricht(lambda: pruefe_sondenabfrage(
               "SELECT adsh, tag, value FROM fakt")))
    pruefe("Lese-Schranke: value in der WHERE-Klausel bricht auch ab",
           _bricht(lambda: pruefe_sondenabfrage(
               "SELECT adsh FROM fakt WHERE value > 0")))
    pruefe("Lese-Schranke: eine fremde Spalte bricht ab",
           _bricht(lambda: pruefe_sondenabfrage(
               "SELECT adsh, footnote FROM fakt")))
    # Die Schranke muss auf dem ECHTEN Lesepfad SITZEN, nicht nur existieren.
    # Deshalb laeuft lies_fakt_metadaten hier gegen ein winziges Fixture, und
    # danach wird die Abfrage geprueft, die dabei WIRKLICH durch die Wache lief.
    # Ein Textscan ueber diese Datei koennte das nicht leisten: er stuende in
    # seinem eigenen Suchraum, weil die Sabotage-Fixtures oben die verbotene
    # Spalte absichtlich als Zeichenkette enthalten.
    del GEPRUEFTE_ABFRAGEN[:]
    fixture = sqlite3.connect(":memory:")
    fixture.execute("CREATE TABLE fakt (adsh TEXT, tag TEXT, version TEXT,"
                    " coreg TEXT, ddate TEXT, qtrs TEXT, uom TEXT, value REAL,"
                    " footnote TEXT)")
    fixture.execute("INSERT INTO fakt VALUES ('A1',?,'us-gaap/2018','',"
                    "'20190630','1','USD',7.5,'')", (OIL,))
    fixture.execute("INSERT INTO fakt VALUES ('A1','X','us-gaap/2018','',"
                    "'20190930','4','USD',9.5,'')")
    gelesen = lies_fakt_metadaten(
        fixture, e2, {"A1": ("1", "2019-08-01 12:00:00.0", None)})
    fixture.close()
    pruefe("Lese-Schranke: der ECHTE Lesepfad liefert Metadaten",
           ("20190630", OIL, "USD", "us-gaap/2018", "1",
            "2019-08-01 12:00:00.0") in (gelesen.get("1") or []),
           gelesen.get("1"), "die Quartalszeile mit qtrs=1")
    pruefe("Lese-Schranke: qtrs bleibt am Datensatz stehen, statt wegzufallen",
           sorted(q for _d, _t, _u, _v, q, _a in gelesen.get("1") or []) == ["1", "4"],
           sorted(q for _d, _t, _u, _v, q, _a in gelesen.get("1") or []), ["1", "4"])
    pruefe("Lese-Schranke: die Abfrage des ECHTEN Lesepfads lief durch die Wache",
           len(GEPRUEFTE_ABFRAGEN) == 1 and "from fakt" in GEPRUEFTE_ABFRAGEN[0],
           GEPRUEFTE_ABFRAGEN, "genau eine gepruefte fakt-Abfrage")
    pruefe("Lese-Schranke: diese Abfrage nennt die verbotene Spalte NICHT",
           VERBOTENE_SPALTE not in GEPRUEFTE_ABFRAGEN[0])

    # ── Der Bit-Anker ────────────────────────────────────────────────────────
    pruefe("Bit-Anker: 25/326 im Signalarm gehen durch",
           pruefe_anker("signal", 25, 326))
    pruefe("Bit-Anker: 192/4285 im Kontrollpool gehen durch",
           pruefe_anker("kontrolle", 192, 4285))
    pruefe("Bit-Anker: 24 statt 25 ist ein SOFORT-STOPP",
           _bricht(lambda: pruefe_anker("signal", 24, 326)))
    pruefe("Bit-Anker: 26 statt 25 ist ebenso ein SOFORT-STOPP",
           _bricht(lambda: pruefe_anker("signal", 26, 326)))
    pruefe("Bit-Anker: richtige Weiterfiler-Zahl bei FALSCHER Fallzahl faellt auf",
           _bricht(lambda: pruefe_anker("signal", 25, 327)))
    pruefe("Bit-Anker: 191 statt 192 im Kontrollpool ist ein SOFORT-STOPP",
           _bricht(lambda: pruefe_anker("kontrolle", 191, 4285)))

    # ── Die Ergebnis-Sperre ──────────────────────────────────────────────────
    pruefe("die gueltige Ausgabe geht DURCH", pruefe_ausgabe(_gueltige_ausgabe()))

    def sabotage(fn):
        a = _gueltige_ausgabe()
        fn(a)
        return _bricht(lambda: pruefe_ausgabe(a))

    pruefe("eine Konzept-Liste im Arm fliegt auf",
           sabotage(lambda a: a["arme"]["signal"].__setitem__(
               "konzepte", ["OperatingIncomeLoss"])))
    pruefe("ein durchgereichter Messwert fliegt am Typ auf",
           sabotage(lambda a: a["arme"]["signal"].__setitem__(
               "nenner_alternativpruefung", 4.5)))
    pruefe("ein FEHLENDES Pflichtfeld fliegt genauso auf wie ein zusaetzliches",
           sabotage(lambda a: a["arme"]["signal"].pop("qtrs_abgedeckt")))
    pruefe("ein zusaetzlicher Schluessel im Umschlag fliegt auf",
           sabotage(lambda a: a.__setitem__("firmenliste", ["AAPL"])))
    pruefe("ein fehlender Arm fliegt auf",
           sabotage(lambda a: a["arme"].pop("kontrolle")))
    pruefe("verschwiegene Sonden-Spalten fliegen auf",
           sabotage(lambda a: a.__setitem__("sondenSpalten", ["adsh"])))

    # ── Die Zerlegungs-Invarianten ───────────────────────────────────────────
    def invariante(fn):
        a = _gueltige_ausgabe()
        arm = a["arme"]["signal"]
        fn(arm)
        return _bricht(lambda: pruefe_arminvarianten(arm))

    pruefe("die gueltige Zerlegung geht auf",
           pruefe_arminvarianten(_gueltige_ausgabe()["arme"]["signal"]))
    pruefe("mit+ohne muss den Nenner treffen",
           invariante(lambda arm: arm.__setitem__(
               "ohne_nutzbare_alternativserie", 2)))
    pruefe("die Achsen-Zaehler muessen die nutzbaren Alternativen treffen",
           invariante(lambda arm: arm.__setitem__(
               "alternativ_mehrere_achsen", 2)))
    pruefe("ein nicht-monotoner Trichter bricht ab",
           invariante(lambda arm: arm.__setitem__("qtrs_abgedeckt", 1)))
    pruefe("mehr endende Serien als gepruefte Firmen bricht ab",
           invariante(lambda arm: arm.__setitem__("gewaehlte_serie_endet", 9)))

    # ── W9 ───────────────────────────────────────────────────────────────────
    pruefe("W9: die 14 Felder decken sich mit dem Register-Eintrag",
           pruefe_anmeldung_deckt_ausgabe(
               {"runId": "e4h-serienende-pruefung-2026-08-29"}))
    pruefe("W9: die Ausgabe-Allowlist zaehlt genau 14 Felder",
           len(DATEN_FELDER) == 14, len(DATEN_FELDER), 14)

    print("")
    if FEHLER:
        print("ROT: " + str(len(FEHLER)) + " Pruefung(en) gescheitert")
        return 1
    print("GRUEN: alle Pruefungen bestanden")
    return 0


def main(argv=None):
    p = argparse.ArgumentParser(description="E4h - Serienende-Diagnose S-G")
    p.add_argument("--freigabe")
    p.add_argument("--ziel")
    p.add_argument("--data-root")
    p.add_argument("--arbeit")
    p.add_argument("--selbsttest", action="store_true")
    p.add_argument("--allowlist-ausgeben", action="store_true")
    args = p.parse_args(argv)

    if args.selbsttest:
        return selbsttest()
    if args.allowlist_ausgeben:
        print(json.dumps(sorted(DATEN_FELDER), ensure_ascii=False, indent=1))
        return 0
    if not args.freigabe:
        p.error("--freigabe fehlt")
    ausgabe = lauf(args.freigabe, data_root=args.data_root, arbeit=args.arbeit,
                   ziel=args.ziel)
    print(json.dumps({
        "signal_weiterfiler": ausgabe["signal_weiterfiler"],
        "kontrollpool_weiterfiler": ausgabe["kontrollpool_weiterfiler"],
        "mit_nutzbarer_alternativserie":
            ausgabe["arme"]["signal"]["mit_nutzbarer_alternativserie"],
        "selbstCheck": ausgabe["selbstCheck"]["bestanden"],
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())

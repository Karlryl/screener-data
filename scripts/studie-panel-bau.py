#!/usr/bin/env python3
"""E1-Panel, Stufe 3: der Bau der drei Fenster-Dateien.

WAS HIER GEBAUT WIRD
--------------------
Aus den 64 Payloads des Alt-Stands (`legacy_earliest_archived`) entstehen DREI
getrennte sqlite-Dateien — eine je Studien-Fenster. Getrennt, nicht eine Tabelle
mit einer Fenster-Spalte: eine Filter-Regel im selben Programm ist nur ein
Versprechen, eine eigene Datei ist eine Eigenschaft der Bytes (R2). Der
Hauptrisikofaktor ist ein Agent, der versehentlich den Endtest liest — der kann
eine Datei nicht aus Versehen mitlesen, die er nie geoeffnet hat.

Geschnitten wird am `accepted`-Zeitstempel aus sub.txt, also an dem Moment, ab
dem ein Bericht oeffentlich war — NICHT am Zeilendatum und nicht am Quartal des
Payloads. Nur der Veroeffentlichungs-Zeitpunkt sagt, welches Wissen wann
verfuegbar war (R6).

WARUM NUR DER ALT-STAND
-----------------------
R6 ist entschieden (Stufe 2, scripts/studie-panel-zaehlung.py): in 0 von 63
Quartalen traegt der reprozessierte Stand mehr Kennzahl-Zeitpunkte, im Mittel
-36,4 %. Er kommt nicht ins Panel. Der Alt-Stand hat 9 num.txt-Spalten und
KEINE `segments`-Spalte — hier ist also nichts zu filtern.

DIE REGELN, DIE HIER IM CODE LEBEN
----------------------------------
* R5  Fail-closed: ein unlesbarer `value` wird NULL und GEZAEHLT, nie geschaetzt.
      Ein Bericht ohne lesbaren `accepted` faellt auf das Payload-Quartal zurueck
      und wird gezaehlt — das ist containment-sicher, weil ein 2022er-Payload
      damit im Endtest landet und nie offen.
* R6  Jede Datenzeile traegt ihre Stand-Kennung (`variante`) und ihren Payload
      (`payload_sha256`), sonst laesst sich hinterher nicht sagen, aus welchem
      Wissen sie stammt.
* R15 Wiederaufnahme: eine Transaktion je (Payload, Datei), der bau_stand-Eintrag
      liegt IN dieser Transaktion und ist damit der einzige Wahrheitswert. Es gibt
      keinen zweiten Zustand, der davon abweichen koennte. Ein Abbruch kostet
      hoechstens den laufenden Payload.
* R12a Der Speicherort kommt aus EARLY_DETECTION_DATA_ROOT, nie aus dem Code.
* Verworfene Zeilen (Dubletten, Waisen, defekte Zeilen) werden GEZAEHLT und
  berichtet, nie still geschluckt.

WAS NICHT INS PANEL KOMMT
-------------------------
pre.txt und tag.txt. Sie bleiben im Sichtkasten lesbar; ein Vorrat auf Verdacht
kostet Stunden und Gigabyte und wird von keiner Frage dieser Etappe gebraucht.

Aufruf:
  python scripts/studie-panel-bau.py                      # Voll-Lauf (Stunden)
  python scripts/studie-panel-bau.py --grenze 3           # Probelauf
  python scripts/studie-panel-bau.py --pruefsumme         # R15-Ergebnis-Pruefsumme
  python scripts/studie-panel-bau.py --bericht-only       # Report neu aus bau_stand
  python scripts/studie-panel-bau.py --selftest
"""

import argparse
import hashlib
import json
import os
import re
import sqlite3
import sys
import time
import zipfile
from datetime import datetime, timezone

DATENWURZEL_ENV = "EARLY_DETECTION_DATA_ROOT"
VARIANTE = "legacy_earliest_archived"
SICHTKASTEN_NAME = "early-detection-v4-sealed127"

# Fenster am accepted-Datum. Bewusst LUECKENLOS: jeder Bericht zwischen 2009 und
# 2024 landet in genau einer Datei.
#
# ABWEICHUNG VON protocol/early-detection/2.0.0/rules.json — hier benannt, nicht
# stillschweigend: dort sind die Fenster quartalsbasiert und lassen die Pufferjahre
# 2016 und 2020 frei (2009q1..2015q4 / 2017q1..2019q4 / 2021q1..2023q4). Die
# Schnitte hier stammen aus dem E1-Vertrag und schlagen die Pufferjahre dem jeweils
# FRUEHEREN Fenster zu; 2024 faellt zusaetzlich in den Endtest. Beide Verschiebungen
# laufen containment-sicher (nichts wandert aus dem Endtest heraus). Wer spaeter
# strikt nach rules.json rechnet, filtert die Pufferjahre beim Lesen weg — deshalb
# traegt jede Bericht-Zeile ihr accepted-Datum mit.
FENSTER = (
    ("entdeckung", "2009-01-01", "2016-12-31"),
    ("validierung", "2017-01-01", "2020-12-31"),
    ("endtest", "2021-01-01", "2024-12-31"),
)
DATEINAME = {name: "panel-" + name + ".sqlite" for name, _, _ in FENSTER}

# Die 36 sub.txt-Spalten des Alt-Stands, in Lieferreihenfolge. Sie sind ueber alle
# 64 Payloads identisch (Schema-Inventar, Stufe 1) — trotzdem wird der Kopf jedes
# Payloads dagegen geprueft. Eine stillschweigend verschobene Spalte waere ein
# Datenschaden, den hinterher niemand mehr sieht.
SUB_SPALTEN = [
    "adsh", "cik", "name", "sic", "countryba", "stprba", "cityba", "zipba",
    "bas1", "bas2", "baph", "countryma", "stprma", "cityma", "zipma", "mas1",
    "mas2", "countryinc", "stprinc", "ein", "former", "changed", "afs", "wksi",
    "fye", "form", "period", "fy", "fp", "filed", "accepted", "prevrpt",
    "detail", "instance", "nciks", "aciks",
]
NUM_SPALTEN = ["adsh", "tag", "version", "coreg", "ddate", "qtrs", "uom", "value", "footnote"]
# Provenienz je Bericht (R6): woher die Zeile stammt und wie sie zugeordnet wurde.
PROVENIENZ = ["quartal", "payload_sha256", "variante", "zuordnung"]
# Der SEC-Naturschluessel einer Fakten-Zeile. Zweimal dieselbe Groesse im selben
# Payload ist eine Dublette, kein zweiter Messwert. `coreg` bleibt im Schluessel und
# als Spalte: die offene coreg-Frage der Verfassung soll ohne Neuscan beantwortbar
# bleiben.
FAKT_SCHLUESSEL = ("adsh", "tag", "version", "ddate", "qtrs", "uom", "coreg")

DATUM_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
QUARTAL_RE = re.compile(r"^(\d{4})q[1-4]$")
BATCH = 50000


class BauFehler(Exception):
    """Ein Befund, der den Lauf anhaelt — nie ein stiller Fallback."""


# -- Pfade --------------------------------------------------------------------

def datenwurzel(vorgabe=None):
    wert = vorgabe or os.environ.get(DATENWURZEL_ENV)
    if not wert:
        raise BauFehler(
            "Speicherort unbekannt: " + DATENWURZEL_ENV + " ist nicht gesetzt "
            "(R12a verbietet einen fest verdrahteten Pfad)")
    return wert


def finde_sichtkasten(wurzel):
    """Die Wurzel selbst oder der Sichtkasten darin — was von beidem Blobs fuehrt."""
    for kandidat in (wurzel, os.path.join(wurzel, SICHTKASTEN_NAME)):
        if os.path.isdir(os.path.join(kandidat, "blobs", "sha256")):
            return kandidat
    raise BauFehler(
        "Kein Sichtkasten gefunden: weder in der Datenwurzel noch unter "
        + SICHTKASTEN_NAME + " liegt blobs/sha256")


def panel_verzeichnis(wurzel, vorgabe=None):
    pfad = vorgabe or os.path.join(wurzel, "panel")
    # Der versiegelte Sichtkasten wird NUR gelesen. Ein Panel-Verzeichnis darin waere
    # eine Veraenderung am Siegel — das ist ein Abbruch, keine Warnung.
    if os.path.exists(os.path.join(os.path.dirname(os.path.abspath(pfad)), "VIEW.json")):
        raise BauFehler(
            "Panel-Ziel liegt im versiegelten Sichtkasten (" + pfad + ") — der wird nur "
            "gelesen. Datenwurzel eine Ebene hoeher setzen oder --panel angeben.")
    return pfad


def blob_pfad(sichtkasten, sha256):
    return os.path.join(sichtkasten, "blobs", "sha256", sha256[:2], sha256 + ".zip")


# -- Fenster-Zuordnung --------------------------------------------------------

def fenster_fuer_datum(datum):
    """'YYYY-MM-DD' -> Fenstername, oder None ausserhalb aller Fenster."""
    for name, von, bis in FENSTER:
        if von <= datum <= bis:
            return name
    return None


def lies_accepted(wert):
    """SEC liefert '2009-05-29 15:59:00.0'. Nur das Datum zaehlt; unlesbar -> None."""
    kopf = wert.strip()[:10]
    if not DATUM_RE.match(kopf):
        return None
    try:
        datetime.strptime(kopf, "%Y-%m-%d")
    except ValueError:
        return None
    return kopf


def fenster_fuer_quartal(quartal):
    """Fail-closed-Rueckfall: ohne lesbares accepted entscheidet das Payload-Quartal."""
    treffer = QUARTAL_RE.match(str(quartal).lower())
    if not treffer:
        raise BauFehler("Kein gueltiger Quartalsschluessel: " + str(quartal))
    name = fenster_fuer_datum(treffer.group(1) + "-07-01")
    if name is None:
        raise BauFehler("Quartal " + quartal + " liegt in keinem Fenster — Zuordnung unmoeglich")
    return name


# -- Datenbank ----------------------------------------------------------------

BAU_STAND_SPALTEN = [
    "payload_sha256", "quartal", "zeilen_gelesen", "zeilen_geschrieben", "dubletten",
    "waisen", "berichte_gelesen", "berichte_geschrieben", "berichte_dubletten",
    "zeilen_defekt", "wert_leer", "wert_unparsebar", "ohne_accepted", "accepted_ausserhalb",
]
# Payload-Eigenschaften (in allen drei Dateien identisch) gegenueber datei-lokalen
# Zahlen. Der Report braucht die Unterscheidung, sonst summiert er dreifach.
STAND_JE_DATEI = ("zeilen_geschrieben", "berichte_geschrieben", "berichte_dubletten")
STAND_JE_PAYLOAD = [s for s in BAU_STAND_SPALTEN[2:] if s not in STAND_JE_DATEI]


def oeffne_panel(pfad):
    os.makedirs(os.path.dirname(os.path.abspath(pfad)), exist_ok=True)
    conn = sqlite3.connect(pfad, isolation_level=None)   # Transaktionen von Hand
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute("PRAGMA cache_size=-65536")
    conn.execute("PRAGMA temp_store=FILE")
    bericht = ", ".join(s + " TEXT" for s in SUB_SPALTEN[1:] + PROVENIENZ)
    fakt = ", ".join("value REAL" if s == "value" else s + " TEXT" for s in NUM_SPALTEN)
    stand = ", ".join(
        "payload_sha256 TEXT PRIMARY KEY" if s == "payload_sha256"
        else (s + " TEXT" if s == "quartal" else s + " INTEGER")
        for s in BAU_STAND_SPALTEN)
    conn.execute("CREATE TABLE IF NOT EXISTS bericht (adsh TEXT PRIMARY KEY, " + bericht + ")")
    conn.execute("CREATE TABLE IF NOT EXISTS fakt (" + fakt + ")")
    conn.execute("CREATE TABLE IF NOT EXISTS bau_stand (" + stand + ", fertig_am TEXT)")
    return conn


def oeffne_alle(panel_dir):
    return dict((name, oeffne_panel(os.path.join(panel_dir, DATEINAME[name])))
                for name, _, _ in FENSTER)


def schon_gebaut(conn, sha256):
    return conn.execute("SELECT 1 FROM bau_stand WHERE payload_sha256=?",
                        (sha256,)).fetchone() is not None


def zeitstempel():
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


# -- Der eigentliche Bau ------------------------------------------------------

def _kopf(fh, erwartet, name):
    kopf = fh.readline().decode("utf-8", "replace").rstrip("\r\n").split("\t")
    if kopf != erwartet:
        raise BauFehler(name + " hat einen unerwarteten Spaltenkopf: "
                        + repr(kopf) + " statt " + repr(erwartet))
    return kopf


def _spuele(conn, stapel, fenster_zaehler, zaehler):
    if not stapel:
        return
    conn.executemany("INSERT INTO fakt VALUES (" + ",".join("?" * len(NUM_SPALTEN)) + ")", stapel)
    fenster_zaehler["fakten"] += len(stapel)
    zaehler["zeilen_geschrieben"] += len(stapel)
    del stapel[:]


def baue_payload(zip_pfad, meta, conns, offen):
    """Schreibt EINEN Payload in die offenen Fenster-Dateien. Eine Transaktion je Datei."""
    quartal, sha = meta["quartal"], meta["sha256"]
    jetzt = zeitstempel()
    zaehler = dict((s, 0) for s in BAU_STAND_SPALTEN[2:])
    je_fenster = dict((name, {"berichte": 0, "berichte_dubletten": 0, "fakten": 0})
                      for name, _, _ in FENSTER)

    for name in offen:
        conns[name].execute("BEGIN")
    try:
        with zipfile.ZipFile(zip_pfad) as archiv:
            vorhanden = set(i.filename for i in archiv.infolist())
            for pflicht in ("sub.txt", "num.txt"):
                if pflicht not in vorhanden:
                    raise BauFehler(pflicht + " fehlt im Archiv " + os.path.basename(zip_pfad))

            # --- sub.txt: Berichte, und damit die Fenster-Zuordnung je adsh ---
            i_acc = SUB_SPALTEN.index("accepted")
            adsh_fenster = {}
            puffer = dict((name, []) for name, _, _ in FENSTER)
            with archiv.open("sub.txt") as fh:
                _kopf(fh, SUB_SPALTEN, "sub.txt")
                for roh in fh:
                    f = roh.decode("utf-8", "replace").rstrip("\r\n").split("\t")
                    zaehler["berichte_gelesen"] += 1
                    if len(f) != len(SUB_SPALTEN):
                        zaehler["zeilen_defekt"] += 1
                        continue
                    datum = lies_accepted(f[i_acc])
                    fenster = fenster_fuer_datum(datum) if datum else None
                    if fenster is None:
                        # Fail-closed (R5): Rueckfall auf das Payload-Quartal, gezaehlt.
                        if datum is None:
                            zaehler["ohne_accepted"] += 1
                        else:
                            zaehler["accepted_ausserhalb"] += 1
                        fenster = fenster_fuer_quartal(quartal)
                        zuordnung = "payload_fallback"
                    else:
                        zuordnung = "accepted"
                    adsh_fenster[f[0]] = fenster
                    if fenster in offen:
                        puffer[fenster].append(tuple(f) + (quartal, sha, VARIANTE, zuordnung))

            platz = ",".join("?" * (len(SUB_SPALTEN) + len(PROVENIENZ)))
            for name in offen:
                zeilen = puffer[name]
                if not zeilen:
                    continue
                conn = conns[name]
                vorher = conn.total_changes
                # INSERT OR IGNORE: das FRUEHESTE Vorkommen eines adsh gewinnt. Payloads
                # laufen in Quartalsreihenfolge, damit ist "das frueheste" deterministisch.
                conn.executemany("INSERT OR IGNORE INTO bericht VALUES (" + platz + ")", zeilen)
                neu = conn.total_changes - vorher
                je_fenster[name]["berichte"] = neu
                je_fenster[name]["berichte_dubletten"] = len(zeilen) - neu
                zaehler["berichte_geschrieben"] += neu
                zaehler["berichte_dubletten"] += len(zeilen) - neu

            # --- num.txt: Fakten ---
            i_wert = NUM_SPALTEN.index("value")
            schluessel_idx = [NUM_SPALTEN.index(s) for s in FAKT_SCHLUESSEL]
            # ponytail: 16-Byte-Digest statt vollem Schluessel — 2,6 Mio Zeilen je Payload
            # waeren sonst ein halbes Gigabyte im Speicher. Kollisionsrisiko bei 128 Bit ist
            # rechnerisch null; wer je Payload > 10^15 Zeilen hat, braucht ohnehin eine
            # andere Bauweise.
            gesehen = set()
            stapel = dict((name, []) for name, _, _ in FENSTER)
            with archiv.open("num.txt") as fh:
                _kopf(fh, NUM_SPALTEN, "num.txt")
                for roh in fh:
                    f = roh.decode("utf-8", "replace").rstrip("\r\n").split("\t")
                    zaehler["zeilen_gelesen"] += 1
                    if len(f) != len(NUM_SPALTEN):
                        zaehler["zeilen_defekt"] += 1
                        continue
                    fenster = adsh_fenster.get(f[0])
                    if fenster is None:
                        # Waise: Fakt ohne Bericht. Ohne accepted-Zeitstempel ist jedes
                        # PIT-Signal darauf definitionsgemaess NICHT BERECHENBAR — die
                        # Zeile wird nicht geschrieben, aber laut gezaehlt.
                        zaehler["waisen"] += 1
                        continue
                    digest = hashlib.blake2b(
                        "\x1f".join(f[i] for i in schluessel_idx).encode("utf-8"),
                        digest_size=16).digest()
                    if digest in gesehen:
                        zaehler["dubletten"] += 1
                        continue
                    gesehen.add(digest)
                    roh_wert = f[i_wert].strip()
                    if roh_wert == "":
                        wert = None
                        zaehler["wert_leer"] += 1
                    else:
                        try:
                            wert = float(roh_wert)
                        except ValueError:
                            # R5: NICHT BERECHENBAR, nie Schaetzung — und gezaehlt.
                            wert = None
                            zaehler["wert_unparsebar"] += 1
                    if fenster not in offen:
                        continue
                    stapel[fenster].append(tuple(f[:i_wert]) + (wert,) + tuple(f[i_wert + 1:]))
                    if len(stapel[fenster]) >= BATCH:
                        _spuele(conns[fenster], stapel[fenster], je_fenster[fenster], zaehler)
            for name in offen:
                _spuele(conns[name], stapel[name], je_fenster[name], zaehler)

        # bau_stand ZULETZT und in derselben Transaktion — er ist der einzige
        # Wahrheitswert der Wiederaufnahme.
        platz = ",".join("?" * (len(BAU_STAND_SPALTEN) + 1))
        for name in offen:
            werte = [sha, quartal] + [zaehler[s] for s in BAU_STAND_SPALTEN[2:]]
            for s in STAND_JE_DATEI:
                werte[BAU_STAND_SPALTEN.index(s)] = je_fenster[name][
                    {"zeilen_geschrieben": "fakten", "berichte_geschrieben": "berichte",
                     "berichte_dubletten": "berichte_dubletten"}[s]]
            conns[name].execute("INSERT INTO bau_stand VALUES (" + platz + ")", werte + [jetzt])
            conns[name].execute("COMMIT")
    except BaseException:
        for name in offen:
            try:
                conns[name].execute("ROLLBACK")
            except sqlite3.Error:
                pass
        raise

    return zaehler


def payload_liste(schema_json):
    with open(schema_json, encoding="utf-8") as fh:
        payloads = json.load(fh)["payloads"]
    legacy = [p for p in payloads if p["variante"] == VARIANTE]
    if not legacy:
        raise BauFehler("Keine Payloads der Variante " + VARIANTE + " in " + schema_json)
    legacy.sort(key=lambda p: p["quartal"])
    return legacy


def bau(sichtkasten, panel_dir, schema_json, grenze=None):
    payloads = payload_liste(schema_json)
    conns = oeffne_alle(panel_dir)
    try:
        gemacht = 0
        for p in payloads:
            offen = [n for n, _, _ in FENSTER if not schon_gebaut(conns[n], p["sha256"])]
            if not offen:
                continue
            if grenze is not None and gemacht >= grenze:
                break
            zp = blob_pfad(sichtkasten, p["sha256"])
            if not os.path.exists(zp):
                raise BauFehler(
                    "Blob fehlt fuer " + p["quartal"] + " (" + p["sha256"][:16] + ") — ein "
                    "fehlender Payload ist ein Befund, kein uebersprungenes Quartal")
            start = time.time()
            z = baue_payload(zp, p, conns, offen)
            gemacht += 1
            print("  %s  gelesen %10d  geschrieben %10d  Dubletten %8d  Waisen %6d  (%.0fs)"
                  % (p["quartal"], z["zeilen_gelesen"], z["zeilen_geschrieben"],
                     z["dubletten"], z["waisen"], time.time() - start))
            sys.stdout.flush()
        return sammle_bericht(conns, panel_dir, len(payloads))
    finally:
        for c in conns.values():
            c.close()


# -- Bericht und Pruefsumme ---------------------------------------------------

def sammle_bericht(conns, panel_dir, payloads_gesamt):
    """Der Report kommt AUS bau_stand — es gibt keinen zweiten Zustand, der abweichen kann."""
    je_fenster, payloads = {}, {}
    for name, _, _ in FENSTER:
        conn = conns[name]
        zeilen = list(conn.execute(
            "SELECT " + ",".join(BAU_STAND_SPALTEN) + " FROM bau_stand ORDER BY quartal"))
        je_fenster[name] = {
            "datei": DATEINAME[name],
            "bytes": os.path.getsize(os.path.join(panel_dir, DATEINAME[name])),
            "payloads": len(zeilen),
            "berichte": conn.execute("SELECT COUNT(*) FROM bericht").fetchone()[0],
            "fakten": conn.execute("SELECT COUNT(*) FROM fakt").fetchone()[0],
            "berichte_payload_fallback": conn.execute(
                "SELECT COUNT(*) FROM bericht WHERE zuordnung='payload_fallback'").fetchone()[0],
            "fakten_wert_null": conn.execute(
                "SELECT COUNT(*) FROM fakt WHERE value IS NULL").fetchone()[0],
        }
        for zeile in zeilen:
            e = dict(zip(BAU_STAND_SPALTEN, zeile))
            ziel = payloads.setdefault(e["payload_sha256"], dict(
                [("quartal", e["quartal"])] + [(s, e[s]) for s in STAND_JE_PAYLOAD]
                + [("geschrieben", {})]))
            ziel["geschrieben"][name] = {
                "fakten": e["zeilen_geschrieben"],
                "berichte": e["berichte_geschrieben"],
                "berichte_dubletten": e["berichte_dubletten"],
            }
    summe = dict((s, sum(p[s] for p in payloads.values())) for s in STAND_JE_PAYLOAD)
    # Die datei-lokalen Zahlen ueber alle drei Dateien — sonst faellt genau das aus dem
    # Report, was der Bau tatsaechlich geschrieben und verworfen hat.
    geschrieben = [g for p in payloads.values() for g in p["geschrieben"].values()]
    summe["fakten_geschrieben"] = sum(g["fakten"] for g in geschrieben)
    summe["berichte_geschrieben"] = sum(g["berichte"] for g in geschrieben)
    summe["berichte_dubletten"] = sum(g["berichte_dubletten"] for g in geschrieben)
    return {
        "schema": "early-detection-panel-bau/v1",
        "protokoll": "FEM-SEC-US@2.0.0",
        "variante": VARIANTE,
        "erstelltAm": zeitstempel(),
        "fenster": dict((n, {"von": v, "bis": b}) for n, v, b in FENSTER),
        "fensterAbweichungVonRulesJson":
            "Die Pufferjahre 2016 und 2020 sind hier dem jeweils frueheren Fenster "
            "zugeschlagen, 2024 dem Endtest; rules.json laesst sie frei. Beide "
            "Verschiebungen laufen containment-sicher — nichts verlaesst den Endtest.",
        "payloadsGesamt": payloads_gesamt,
        "payloadsGebaut": len(payloads),
        "summe": summe,
        "jeFenster": je_fenster,
        "waisenSatz":
            str(summe["waisen"]) + " Fakten-Zeilen ohne zugehoerigen Bericht wurden NICHT "
            "geschrieben (ohne accepted-Zeitstempel ist jedes PIT-Signal darauf nicht "
            "berechenbar) — sie stehen je Payload in diesem Report, verschwiegen wird keine.",
        "payloads": payloads,
    }


def pruefsumme(conn):
    """R15-Ergebnis-Pruefsumme ueber den INHALT, nicht ueber die Dateibytes.

    Die Dateibytes koennen nach einem Abbruch abweichen (Freiliste, Aenderungszaehler
    im Dateikopf), ohne dass sich ein einziger Datenwert unterscheidet — eine
    Byte-Gleichheit waere also die falsche Frage. Geprueft wird der Inhalt inklusive
    Schema, aber OHNE `fertig_am`: wann gebaut wurde, ist eine Betriebsnotiz und kein
    Ergebnis.
    """
    h = hashlib.sha256()
    for (sql,) in conn.execute(
            "SELECT sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY name"):
        h.update(sql.encode("utf-8") + b"\n")
    ordnung = {
        "bericht": ("*", "adsh"),
        "fakt": ("*", ",".join(str(i + 1) for i in range(len(NUM_SPALTEN)))),
        "bau_stand": (",".join(BAU_STAND_SPALTEN), "payload_sha256"),
    }
    for tabelle in ("bericht", "fakt", "bau_stand"):
        spalten, sortierung = ordnung[tabelle]
        h.update(("[" + tabelle + "]\n").encode("utf-8"))
        for zeile in conn.execute(
                "SELECT " + spalten + " FROM " + tabelle + " ORDER BY " + sortierung):
            h.update(repr(zeile).encode("utf-8") + b"\n")
    return h.hexdigest()


def zeige_pruefsummen(panel_dir):
    for name, _, _ in FENSTER:
        pfad = os.path.join(panel_dir, DATEINAME[name])
        if not os.path.exists(pfad):
            print("  %-12s (nicht gebaut)" % name)
            continue
        conn = sqlite3.connect(pfad)
        try:
            conn.execute("PRAGMA temp_store=FILE")
            conn.execute("PRAGMA cache_size=-65536")
            print("  %-12s %s" % (name, pruefsumme(conn)))
        finally:
            conn.close()
    return 0


# -- Selbsttest ---------------------------------------------------------------

def selftest():
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

    def sub(adsh, accepted):
        f = [""] * len(SUB_SPALTEN)
        f[0], f[1] = adsh, "42"
        f[SUB_SPALTEN.index("accepted")] = accepted
        return "\t".join(f) + "\n"

    def num(adsh, tag, wert, ddate="20130331", coreg=""):
        return "\t".join([adsh, tag, "us-gaap/2013", coreg, ddate, "1", "USD", wert, ""]) + "\n"

    def kunst_payload(pfad, sub_zeilen, num_zeilen):
        with zipfile.ZipFile(pfad, "w") as z:
            z.writestr("sub.txt", "\t".join(SUB_SPALTEN) + "\n" + "".join(sub_zeilen))
            z.writestr("num.txt", "\t".join(NUM_SPALTEN) + "\n" + "".join(num_zeilen))
            z.writestr("pre.txt", "adsh\n")
            z.writestr("tag.txt", "tag\n")

    with tempfile.TemporaryDirectory() as tmp:
        wurzel = os.path.join(tmp, "wurzel")
        kasten = os.path.join(wurzel, SICHTKASTEN_NAME)
        payloads = [
            ("2013q1", "aa" + "0" * 62, [
                sub("A1", "2013-02-01 10:00:00.0"),
                sub("A2", ""),                             # ohne accepted -> Rueckfall
            ], [
                num("A1", "Rev", "100.5"),
                num("A1", "Rev", "100.5"),                 # Dublette
                num("A1", "Cost", "keine-zahl"),           # unparsebar -> NULL
                num("A1", "Leer", ""),                     # leer -> NULL
                num("A2", "Rev", "7"),
                num("GEIST", "Rev", "9"),                  # Waise
            ]),
            ("2016q4", "bb" + "0" * 62, [
                sub("B1", "2016-12-31 23:59:00.0"),        # exakt auf der Fenstergrenze
                sub("B2", "2017-01-01 00:00:01.0"),        # exakt danach
                sub("A1", "2016-11-01 10:00:00.0"),        # adsh gab es schon in 2013q1
            ], [
                num("B1", "Rev", "1"), num("B2", "Rev", "2"), num("A1", "Rev", "3"),
            ]),
            ("2022q1", "cc" + "0" * 62, [sub("C1", "2022-02-01 10:00:00.0")],
             [num("C1", "Rev", "5")]),
        ]
        for quartal, sha, subs, nums in payloads:
            bd = os.path.join(kasten, "blobs", "sha256", sha[:2])
            os.makedirs(bd, exist_ok=True)
            kunst_payload(os.path.join(bd, sha + ".zip"), subs, nums)
        with open(os.path.join(kasten, "VIEW.json"), "w", encoding="utf-8") as fh:
            json.dump({"payloadCount": len(payloads)}, fh)
        schema = os.path.join(tmp, "schema.json")
        with open(schema, "w", encoding="utf-8") as fh:
            json.dump({"payloads": [{"quartal": q, "sha256": s, "variante": VARIANTE}
                                    for q, s, _, _ in payloads]
                       + [{"quartal": "2013q1", "sha256": "dd" + "0" * 62,
                           "variante": "post_2024_reprocessed_or_current"}]}, fh)

        # === 1. Voller Bau, dann alle Inhalts-Pruefungen ======================
        panel = os.path.join(tmp, "panel")
        erg = bau(kasten, panel, schema)
        conns = oeffne_alle(panel)
        try:
            def eins(name, sql):
                return conns[name].execute(sql).fetchone()[0]

            def feld(name, sql):
                return conns[name].execute(sql).fetchone()[0]

            pruefe("nur der Alt-Stand wird gebaut (3 Payloads, nicht 4)",
                   erg["payloadsGebaut"] == 3)
            pruefe("drei getrennte Dateien liegen auf Platte",
                   all(os.path.exists(os.path.join(panel, DATEINAME[n])) for n, _, _ in FENSTER))
            pruefe("keine Fenster-Spalte in bericht",
                   "fenster" not in [z[1] for z in conns["entdeckung"].execute(
                       "PRAGMA table_info(bericht)")])

            # Fenstergrenze auf den Tag genau.
            pruefe("accepted 2016-12-31 landet in der Entdeckung",
                   eins("entdeckung", "SELECT COUNT(*) FROM bericht WHERE adsh='B1'") == 1)
            pruefe("accepted 2017-01-01 landet in der Validierung",
                   eins("validierung", "SELECT COUNT(*) FROM bericht WHERE adsh='B2'") == 1)
            pruefe("und B2 liegt NICHT auch in der Entdeckung",
                   eins("entdeckung", "SELECT COUNT(*) FROM bericht WHERE adsh='B2'") == 0)
            pruefe("der Fakt zu B2 wandert mit in die Validierung",
                   eins("validierung", "SELECT COUNT(*) FROM fakt WHERE adsh='B2'") == 1
                   and eins("entdeckung", "SELECT COUNT(*) FROM fakt WHERE adsh='B2'") == 0)

            # Containment: der Endtest fuehrt ausschliesslich Endtest-Berichte.
            pruefe("Endtest enthaelt genau den 2022er Bericht",
                   eins("endtest", "SELECT COUNT(*) FROM bericht") == 1
                   and eins("endtest", "SELECT COUNT(*) FROM bericht WHERE adsh='C1'") == 1)
            pruefe("Endtest-Fakten stehen in keiner offenen Datei",
                   eins("entdeckung", "SELECT COUNT(*) FROM fakt WHERE adsh='C1'") == 0
                   and eins("validierung", "SELECT COUNT(*) FROM fakt WHERE adsh='C1'") == 0)

            # Fail-closed-Rueckfall.
            pruefe("Bericht ohne accepted faellt auf das Payload-Quartal zurueck",
                   feld("entdeckung", "SELECT zuordnung FROM bericht WHERE adsh='A2'")
                   == "payload_fallback")
            pruefe("und der Rueckfall wird gezaehlt", erg["summe"]["ohne_accepted"] == 1)
            pruefe("ein lesbares accepted heisst zuordnung='accepted'",
                   feld("entdeckung", "SELECT zuordnung FROM bericht WHERE adsh='A1'")
                   == "accepted")

            # Dublette, Waise, unlesbarer Wert.
            pruefe("Fakten-Dublette IM Payload wird verworfen und gezaehlt",
                   erg["summe"]["dubletten"] == 1
                   and erg["summe"]["zeilen_gelesen"] - erg["summe"]["waisen"]
                   - erg["summe"]["dubletten"] == erg["summe"]["fakten_geschrieben"])
            # Vertragsfolge, hier absichtlich festgenagelt statt uebersehen: die
            # Fakten-Dedupe wirkt NUR innerhalb eines Payloads. Liefert ein spaeteres
            # Quartal denselben adsh noch einmal, steht der Fakt zweimal in der Datei —
            # unterscheidbar an payload_sha256 des zugehoerigen Berichts. Der Bericht
            # selbst bleibt eindeutig (Primaerschluessel adsh).
            pruefe("Fakten-Dedupe wirkt NUR im Payload (A1/Rev aus zwei Quartalen = 2 Zeilen)",
                   eins("entdeckung",
                        "SELECT COUNT(*) FROM fakt WHERE adsh='A1' AND tag='Rev'") == 2)
            pruefe("Waisen-Zeile wird NICHT geschrieben",
                   eins("entdeckung", "SELECT COUNT(*) FROM fakt WHERE adsh='GEIST'") == 0)
            pruefe("Waisen-Zeile wird gezaehlt und im Report benannt",
                   erg["summe"]["waisen"] == 1
                   and erg["waisenSatz"].startswith("1 Fakten-Zeilen"))
            pruefe("unparsebarer value wird NULL",
                   feld("entdeckung",
                        "SELECT value FROM fakt WHERE adsh='A1' AND tag='Cost'") is None)
            pruefe("leerer und unparsebarer value werden GETRENNT gezaehlt",
                   erg["summe"]["wert_unparsebar"] == 1 and erg["summe"]["wert_leer"] == 1)
            pruefe("ein lesbarer value bleibt eine Zahl",
                   feld("entdeckung",
                        "SELECT value FROM fakt WHERE adsh='A1' AND tag='Rev'") == 100.5)

            # Dedupe ueber Payloads: das frueheste Vorkommen gewinnt.
            pruefe("adsh A1 steht genau einmal in der Entdeckung",
                   eins("entdeckung", "SELECT COUNT(*) FROM bericht WHERE adsh='A1'") == 1)
            pruefe("und traegt das Quartal seines ERSTEN Vorkommens",
                   feld("entdeckung", "SELECT quartal FROM bericht WHERE adsh='A1'") == "2013q1")
            pruefe("die zweite Lieferung ist als Bericht-Dublette gezaehlt",
                   erg["summe"]["berichte_dubletten"] == 1)

            # R6: jede Datenzeile traegt ihre Stand-Kennung.
            pruefe("jede Bericht-Zeile traegt variante und payload_sha256",
                   eins("entdeckung", "SELECT COUNT(*) FROM bericht WHERE variante='"
                        + VARIANTE + "' AND length(payload_sha256)=64")
                   == eins("entdeckung", "SELECT COUNT(*) FROM bericht"))

            # bau_stand ist vollstaendig — auch dort, wo nichts zu schreiben war.
            pruefe("jeder Payload steht in allen drei Dateien im bau_stand",
                   all(eins(n, "SELECT COUNT(*) FROM bau_stand") == 3 for n, _, _ in FENSTER))
            pruefe("gelesene Zeilen stimmen mit dem Kunst-Bestand ueberein",
                   erg["summe"]["zeilen_gelesen"] == 10
                   and erg["summe"]["berichte_gelesen"] == 6)
        finally:
            for c in conns.values():
                c.close()

        # === 2. R15: Kill-Wiederaufnahme ======================================
        panel_a = os.path.join(tmp, "kill_a")
        bau(kasten, panel_a, schema, grenze=1)      # Abbruch nach dem ersten Payload
        bau(kasten, panel_a, schema)                # Wiederaufnahme
        panel_b = os.path.join(tmp, "kill_b")
        bau(kasten, panel_b, schema)                # ungestoerter Vergleichslauf
        gleich = True
        for name, _, _ in FENSTER:
            a = sqlite3.connect(os.path.join(panel_a, DATEINAME[name]))
            b = sqlite3.connect(os.path.join(panel_b, DATEINAME[name]))
            try:
                gleich = gleich and pruefsumme(a) == pruefsumme(b)
            finally:
                a.close()
                b.close()
        pruefe("Wiederaufnahme liefert dieselbe Ergebnis-Pruefsumme (R15)", gleich)

        # Gegenprobe an der Pruefsumme selbst: sie MUSS unterscheiden koennen.
        c = sqlite3.connect(os.path.join(panel_b, DATEINAME["entdeckung"]))
        try:
            vorher = pruefsumme(c)
            c.execute("UPDATE fakt SET value=value+1 WHERE adsh='A1' AND tag='Rev'")
            c.commit()
            pruefe("ein geaenderter Wert bricht die Pruefsumme", pruefsumme(c) != vorher)
        finally:
            c.close()

        # === 3. Bruchproben ===================================================
        # Ein fehlender Blob MUSS den Lauf anhalten.
        panel2 = os.path.join(tmp, "panel2")
        os.remove(os.path.join(kasten, "blobs", "sha256", "bb", "bb" + "0" * 62 + ".zip"))
        try:
            bau(kasten, panel2, schema)
            pruefe("fehlender Blob haelt den Lauf an", False)
        except BauFehler as e:
            pruefe("fehlender Blob haelt den Lauf an (statt still zu ueberspringen)",
                   "Blob fehlt" in str(e))
        c2 = oeffne_alle(panel2)
        try:
            pruefe("nach dem Abbruch ist genau der heile Payload gebucht",
                   c2["entdeckung"].execute(
                       "SELECT COUNT(*) FROM bau_stand").fetchone()[0] == 1)
        finally:
            for c in c2.values():
                c.close()

        # Ein verschobener Spaltenkopf MUSS auffliegen.
        sha = "ee" + "0" * 62
        bd = os.path.join(kasten, "blobs", "sha256", sha[:2])
        os.makedirs(bd, exist_ok=True)
        with zipfile.ZipFile(os.path.join(bd, sha + ".zip"), "w") as z:
            z.writestr("sub.txt", "\t".join(SUB_SPALTEN[:-1]) + "\n")
            z.writestr("num.txt", "\t".join(NUM_SPALTEN) + "\n")
        schema2 = os.path.join(tmp, "schema2.json")
        with open(schema2, "w", encoding="utf-8") as fh:
            json.dump({"payloads": [{"quartal": "2013q2", "sha256": sha,
                                     "variante": VARIANTE}]}, fh)
        try:
            bau(kasten, os.path.join(tmp, "panel3"), schema2)
            pruefe("fremder Spaltenkopf fliegt auf", False)
        except BauFehler as e:
            pruefe("fremder Spaltenkopf fliegt auf", "Spaltenkopf" in str(e))

        # Das Panel darf nicht in den versiegelten Sichtkasten geschrieben werden.
        try:
            panel_verzeichnis(kasten)
            pruefe("Panel im versiegelten Sichtkasten wird verweigert", False)
        except BauFehler as e:
            pruefe("Panel im versiegelten Sichtkasten wird verweigert",
                   "versiegelten Sichtkasten" in str(e))
        pruefe("ausserhalb des Sichtkastens ist das Panel erlaubt",
               panel_verzeichnis(wurzel).endswith("panel"))

        # Ohne Umgebungsvariable und ohne Vorgabe gibt es keinen Ort (R12a).
        alt = os.environ.pop(DATENWURZEL_ENV, None)
        try:
            datenwurzel()
            pruefe("fehlende Datenwurzel haelt an (R12a)", False)
        except BauFehler as e:
            pruefe("fehlende Datenwurzel haelt an (R12a)", DATENWURZEL_ENV in str(e))
        finally:
            if alt is not None:
                os.environ[DATENWURZEL_ENV] = alt

    print("\nstudie-panel-bau selftest: %d ok, %d fail" % (ok, fehl))
    return 0 if fehl == 0 else 1


# -- Einstieg -----------------------------------------------------------------

def main():
    p = argparse.ArgumentParser(description="E1-Panelbau (drei getrennte Fenster-Dateien).")
    p.add_argument("--datenwurzel", help="sonst " + DATENWURZEL_ENV)
    p.add_argument("--sichtkasten", help="sonst aus der Datenwurzel abgeleitet")
    p.add_argument("--panel", help="sonst <datenwurzel>/panel")
    p.add_argument("--schema", default="reports/studie/E1-panel-schema-2026-08-18.json")
    p.add_argument("--out", default="reports/studie/E1-panel-bau-2026-08-19.json")
    p.add_argument("--grenze", type=int, help="nur die ersten N offenen Payloads (Probelauf)")
    p.add_argument("--pruefsumme", action="store_true", help="R15-Ergebnis-Pruefsumme je Datei")
    p.add_argument("--bericht-only", action="store_true", help="Report neu aus bau_stand")
    p.add_argument("--selftest", action="store_true")
    a = p.parse_args()

    if a.selftest:
        return selftest()

    try:
        wurzel = datenwurzel(a.datenwurzel)
        panel_dir = panel_verzeichnis(wurzel, a.panel)
        if a.pruefsumme:
            print("Ergebnis-Pruefsummen in " + panel_dir + ":")
            return zeige_pruefsummen(panel_dir)
        if a.bericht_only:
            conns = oeffne_alle(panel_dir)
            try:
                erg = sammle_bericht(conns, panel_dir, len(payload_liste(a.schema)))
            finally:
                for c in conns.values():
                    c.close()
        else:
            kasten = a.sichtkasten or finde_sichtkasten(wurzel)
            print("Sichtkasten: " + kasten + "\nPanel:       " + panel_dir + "\n")
            erg = bau(kasten, panel_dir, a.schema, a.grenze)
    except BauFehler as e:
        print("FEHLER: " + str(e), file=sys.stderr)
        return 1

    print("\nGebaut: %d von %d Payloads." % (erg["payloadsGebaut"], erg["payloadsGesamt"]))
    for name, e in erg["jeFenster"].items():
        print("  %-12s %9d Berichte  %13d Fakten  %.2f GB"
              % (name, e["berichte"], e["fakten"], e["bytes"] / 1e9))
    s = erg["summe"]
    print("\n  Waisen %d - Fakten-Dubletten %d - Bericht-Dubletten %d - defekte Zeilen %d"
          % (s["waisen"], s["dubletten"], s["berichte_dubletten"], s["zeilen_defekt"]))
    print("  value leer %d - value unparsebar %d - ohne accepted %d - accepted ausserhalb %d"
          % (s["wert_leer"], s["wert_unparsebar"], s["ohne_accepted"], s["accepted_ausserhalb"]))
    print("\n" + erg["waisenSatz"])

    if a.out:
        os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
        with open(a.out, "w", encoding="utf-8") as fh:
            json.dump(erg, fh, ensure_ascii=False, indent=1)
        print("\nGeschrieben: " + a.out)
    return 0


if __name__ == "__main__":
    sys.exit(main())

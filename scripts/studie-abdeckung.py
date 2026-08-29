# -*- coding: utf-8 -*-
"""Etappe E1: Abdeckungs-Report der Datenbasis.

Zwei Fragen, beide aus der Verfassung:

  1. **Abdeckung** — wie viele Firmen traegt die Datenbasis je Jahr und je Branche?
     Ohne diese Zahl laesst sich nicht sagen, ob die spaetere Fallzahl ueberhaupt
     erreichbar ist (R15a).
  2. **Pflicht-Sensitivitaetslauf nach R6** — Alt-Stand gegen reprozessierten Stand,
     **zwingend auf Fakten-Ebene, nicht auf Firmen-Ebene.** Die Verfassung ist hier
     ausdruecklich: „Ein Firmen-Ebenen-Vergleich misst hier nachweislich das
     Falsche: die Firmenmenge ist zwischen den Staenden fast identisch, der
     Unterschied sitzt in den Zahlen."

Der reprozessierte Stand hat die 8-K-Einreichungen entfernt. Ein naiver Vergleich
„Fakten je Payload" misst deshalb vor allem diesen Wegfall und nicht die
Fakten-Tiefe. Gezaehlt wird darum **je Formularart getrennt** und die Kennzahl ist
**Fakten je periodischem Bericht** (10-K, 10-Q, 20-F, 40-F).

## Warum der Umweg ueber die Zeilen-Zaehlung

Die Datenbank ist **byte-genau im Daten-Vertrag gepinnt** (41 141 956 608 Bytes).
Sie wird deshalb ausschliesslich **schreibgeschuetzt** geoeffnet — schon das Anlegen
eines Index waere eine Aenderung und wuerde den Vertragswert brechen. Ohne Index ist
ein GROUP BY ueber 308 Mio. Faktenzeilen eine Sortier-Orgie mit riesigem
Zwischenspeicher; stattdessen wird die Tabelle **einmal sequenziell gelesen** und in
einem Zaehlfeld im Arbeitsspeicher aufsummiert. Das laeuft in Haeppchen ueber
rowid-Bereiche (R15c): jedes Haeppchen wird atomar fortgeschrieben, ein Abbruch
kostet hoechstens ein Haeppchen.

Regeln: R12a (Speicherort aus EARLY_DETECTION_DATA_ROOT), R14a (<200 KB),
R14c (Standardbibliothek + sqlite3 + numpy), R14d (nie am Stueck lesen),
R15c (Haeppchen, atomar, wiederaufnehmbar).

Aufruf:
  python scripts/studie-abdeckung.py --selbsttest
  python scripts/studie-abdeckung.py --zaehlen --zustand <datei.json>
  python scripts/studie-abdeckung.py --bericht <datei.json> --zustand <datei.json>
"""
from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
import tempfile
from pathlib import Path

try:
    import numpy as np
except ImportError:  # pragma: no cover - R14c erlaubt numpy ausdruecklich
    np = None

HIER = Path(__file__).resolve().parent
REPO = HIER.parent
PROTOKOLL = REPO / "protocol" / "early-detection" / "2.0.0"
DATENWURZEL_ENV = "EARLY_DETECTION_DATA_ROOT"
DB_RELATIV = ("derived", "sec-fsd-compact.sqlite")

# Die Formularen, die einen periodischen Bericht darstellen. 8-K und alles andere
# zaehlt mit, wird aber getrennt gefuehrt — der Unterschied zwischen den Staenden
# sitzt genau hier.
PERIODISCH = ("10-K", "10-Q", "20-F", "40-F")
HAEPPCHEN = 20_000_000  # rowid-Bereich je Haeppchen


class VerfassungsBruch(RuntimeError):
    pass


def datenwurzel(vorgabe: str | None) -> Path:
    wert = vorgabe or os.environ.get(DATENWURZEL_ENV)
    if not wert:
        raise VerfassungsBruch(
            "Speicherort unbekannt: %s ist nicht gesetzt (R12a)." % DATENWURZEL_ENV)
    return Path(wert)


def oeffne_db(pfad: Path) -> sqlite3.Connection:
    """NUR schreibgeschuetzt. Die Datenbank ist byte-genau im Vertrag gepinnt;
    jede Schreiboperation — auch ein Index — braeche den Vertragswert."""
    if not pfad.is_file():
        raise VerfassungsBruch("Studien-Datenbank nicht gefunden: %s" % pfad)
    uri = "file:%s?mode=ro" % pfad.as_posix()
    return sqlite3.connect(uri, uri=True)


def schreibe_atomar(ziel: Path, wert) -> None:
    """Ein halb geschriebener Zustand ist schlimmer als keiner: er sieht
    wiederaufnehmbar aus und ist es nicht."""
    ziel.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=str(ziel.parent),
                                     delete=False, suffix=".tmp") as f:
        json.dump(wert, f, ensure_ascii=False)
        temp = Path(f.name)
    temp.replace(ziel)


# ------------------------------------------------------------------ Zaehllauf
def zaehle(con: sqlite3.Connection, zustand_pfad: Path, fortschritt=print) -> dict:
    """Ein sequenzieller Durchlauf ueber die Faktentabelle, in Haeppchen.

    Ergebnis: Fakten je submission_id. Die Zuordnung zu Formular, Quartal und
    Branche passiert danach im Arbeitsspeicher — die submissions-Tabelle ist mit
    gut einer Million Zeilen klein genug dafuer."""
    if np is None:
        raise VerfassungsBruch("numpy fehlt — R14c erlaubt es, aber es ist nicht installiert.")
    hoechste = con.execute("SELECT MAX(submission_id) FROM submissions").fetchone()[0]
    alle = [r[0] for r in con.execute("SELECT payload_id FROM source_payloads ORDER BY payload_id")]

    zustand = {}
    if zustand_pfad.is_file():
        zustand = json.loads(zustand_pfad.read_text(encoding="utf-8"))
        if zustand.get("maxSubmissionId") != hoechste or zustand.get("payloadsGesamt") != len(alle):
            raise VerfassungsBruch(
                "Der gespeicherte Zwischenstand gehoert zu einer anderen Datenbank. "
                "Wiederaufnahme abgebrochen, statt zwei Laeufe zu mischen.")

    zaehler = np.zeros(hoechste + 1, dtype=np.int64)
    if zustand.get("zaehler"):
        gespeichert = np.array(zustand["zaehler"], dtype=np.int64)
        zaehler[: len(gespeichert)] = gespeichert
    erledigt = list(zustand.get("erledigtePayloads", []))

    # Die Faktentabelle hat keinen rowid (WITHOUT ROWID), aber einen
    # Primaerschluessel, der mit payload_id beginnt. Ein Haeppchen ist deshalb
    # genau ein Payload — exakt die Bruchkante, die R15c benennt, und die Abfrage
    # laeuft ueber den Primaerschluessel statt ueber einen vollen Tabellenscan.
    for nr, pid in enumerate([p for p in alle if p not in erledigt], start=len(erledigt) + 1):
        cur = con.execute("SELECT submission_id FROM facts WHERE payload_id = ?", (pid,))
        while True:
            block = cur.fetchmany(1_000_000)
            if not block:
                break
            ids = np.fromiter((r[0] for r in block), dtype=np.int64, count=len(block))
            # bincount statt np.add.at: dieselbe Rechnung, aber in C statt in einer
            # Schleife — bei 308 Mio. Zeilen ist das der Unterschied zwischen
            # Minuten und Stunden.
            zaehler += np.bincount(ids, minlength=zaehler.size)
        erledigt.append(pid)
        schreibe_atomar(zustand_pfad, {
            "schema": "early-detection-abdeckung-zustand/v1",
            "maxSubmissionId": hoechste, "payloadsGesamt": len(alle),
            "erledigtePayloads": erledigt, "zaehler": zaehler.tolist(),
        })
        fortschritt("  Payload %d von %d fortgeschrieben" % (nr, len(alle)))
    return {"zaehler": zaehler, "payloads": len(alle)}


# ------------------------------------------------------------------ Auswertung
def vintages(closure: dict) -> dict:
    raus = {p["payloadSha256"]: p["vintage"] for p in closure["payloads"]}
    return raus


def auswerten(con: sqlite3.Connection, zaehler, vintage_je_hash: dict) -> dict:
    payloads = {}
    for pid, sha, quartal in con.execute(
            "SELECT payload_id, payload_sha256, quarter FROM source_payloads"):
        payloads[pid] = {"quartal": quartal, "vintage": vintage_je_hash.get(sha)}
    unbekannt = [p for p in payloads.values() if p["vintage"] is None]
    if unbekannt:
        raise VerfassungsBruch(
            "%d Payloads der Datenbank stehen nicht in der Herkunfts-Schliessung — "
            "die Datenbank ist nicht die versiegelte." % len(unbekannt))

    # Je (Quartal, Stand, Formularklasse): Berichte, Fakten. Und je (Jahr, Branche)
    # die Firmenmenge — Firmen ueber die SEC-Nummer, wie R6 es festlegt.
    tiefe: dict = {}
    firmen: dict = {}
    for sid, pid, cik, sic, form, fy in con.execute(
            "SELECT submission_id, payload_id, cik, sic, form, fy FROM submissions"):
        p = payloads[pid]
        klasse = "periodisch" if form in PERIODISCH else ("8-K" if form.startswith("8-K") else "sonstige")
        schluessel = (p["quartal"], p["vintage"], klasse)
        eintrag = tiefe.setdefault(schluessel, {"berichte": 0, "fakten": 0})
        eintrag["berichte"] += 1
        eintrag["fakten"] += int(zaehler[sid]) if sid < len(zaehler) else 0
        if klasse == "periodisch" and fy:
            branche = (str(sic)[:2] + "xx") if sic else "unbekannt"
            firmen.setdefault((int(fy), branche), set()).add(cik)

    je_quartal = {}
    for (quartal, vintage, klasse), w in sorted(tiefe.items()):
        z = je_quartal.setdefault(quartal, {})
        z.setdefault(vintage, {})[klasse] = w

    sensitivitaet = []
    for quartal, staende in sorted(je_quartal.items()):
        alt = staende.get("legacy_earliest_archived", {}).get("periodisch")
        neu = staende.get("post_2024_reprocessed_or_current", {}).get("periodisch")
        if not alt or not neu or not alt["berichte"] or not neu["berichte"]:
            sensitivitaet.append({"quartal": quartal, "status": "NICHT VERGLEICHBAR",
                                  "grund": "ein Stand fehlt in der versiegelten Datenbank"})
            continue
        ja_alt = alt["fakten"] / alt["berichte"]
        ja_neu = neu["fakten"] / neu["berichte"]
        sensitivitaet.append({
            "quartal": quartal, "status": "vergleichbar",
            "berichteAlt": alt["berichte"], "berichteNeu": neu["berichte"],
            "faktenJeBerichtAlt": round(ja_alt, 1), "faktenJeBerichtNeu": round(ja_neu, 1),
            "tiefenZuwachsProzent": round((ja_neu / ja_alt - 1) * 100, 1),
            "achtKAlt": staende.get("legacy_earliest_archived", {}).get("8-K", {}).get("berichte", 0),
            "achtKNeu": staende.get("post_2024_reprocessed_or_current", {}).get("8-K", {}).get("berichte", 0),
        })

    firmen_je_jahr: dict = {}
    for (jahr, branche), menge in firmen.items():
        firmen_je_jahr.setdefault(jahr, {})[branche] = len(menge)
    firmen_gesamt = {jahr: len(set().union(*[v for (j, _b), v in firmen.items() if j == jahr]))
                     for jahr in sorted({j for j, _ in firmen})}

    return {
        "schema": "early-detection-abdeckung/v1",
        "sensitivitaetJeQuartal": sensitivitaet,
        "firmenJeJahr": dict(sorted(firmen_gesamt.items())),
        "firmenJeJahrUndBranche": {str(k): dict(sorted(v.items()))
                                   for k, v in sorted(firmen_je_jahr.items())},
    }


# ------------------------------------------------------------------ Selbsttest
def selbsttest() -> None:
    """Braucht keine 41-GB-Datenbank: eine winzige Datenbank mit derselben Form."""
    con = sqlite3.connect(":memory:")
    con.executescript(
        "CREATE TABLE source_payloads(payload_id INTEGER PRIMARY KEY, payload_sha256 TEXT, quarter TEXT);"
        "CREATE TABLE submissions(submission_id INTEGER PRIMARY KEY, payload_id INTEGER,"
        " cik INTEGER, sic INTEGER, form TEXT, fy INTEGER);"
        "CREATE TABLE facts(submission_id INTEGER);")
    con.executemany("INSERT INTO source_payloads VALUES(?,?,?)",
                    [(1, "alt", "2013q1"), (2, "neu", "2013q1")])
    con.executemany("INSERT INTO submissions VALUES(?,?,?,?,?,?)", [
        (1, 1, 100, 3674, "10-K", 2013), (2, 1, 101, 3674, "8-K", 2013),
        (3, 2, 100, 3674, "10-K", 2013),
    ])
    # Alt: 10 Fakten am 10-K, 4 am 8-K. Neu: 13 Fakten am 10-K, kein 8-K.
    con.executemany("INSERT INTO facts VALUES(?)",
                    [(1,)] * 10 + [(2,)] * 4 + [(3,)] * 13)
    zaehler = [0, 10, 4, 13]
    ergebnis = auswerten(con, zaehler, {"alt": "legacy_earliest_archived",
                                        "neu": "post_2024_reprocessed_or_current"})
    s = ergebnis["sensitivitaetJeQuartal"][0]
    if s["faktenJeBerichtAlt"] != 10.0 or s["faktenJeBerichtNeu"] != 13.0:
        raise SystemExit("SELBSTTEST ROT: Fakten je Bericht falsch: %s" % s)
    if s["tiefenZuwachsProzent"] != 30.0:
        raise SystemExit("SELBSTTEST ROT: Tiefen-Zuwachs %s statt 30.0" % s["tiefenZuwachsProzent"])
    if s["achtKAlt"] != 1 or s["achtKNeu"] != 0:
        raise SystemExit("SELBSTTEST ROT: der 8-K-Wegfall wird nicht getrennt gefuehrt.")
    print("  Fakten je periodischem Bericht: 10 -> 13 = +30 %, 8-K getrennt gefuehrt.")

    # Der entscheidende Fehler, den die Verfassung ausdruecklich nennt: wer die
    # 8-K-Zeilen mitzaehlt, misst den Wegfall statt der Tiefe. Das MUSS ein
    # anderes Ergebnis geben — sonst prueft der Test nichts.
    naiv_alt = (10 + 4) / 2
    if round((13 / 1 / naiv_alt - 1) * 100, 1) == s["tiefenZuwachsProzent"]:
        raise SystemExit("SELBSTTEST ROT: naive und formulargetrennte Zaehlung liefern "
                         "dasselbe — der Test kann den Fehler nicht unterscheiden.")
    print("  Gegenprobe: die naive Zaehlung ueber alle Formulare kaeme auf %+.1f %% "
          "statt %+.1f %%." % ((13 / naiv_alt - 1) * 100, s["tiefenZuwachsProzent"]))

    # Ein Payload ohne Eintrag in der Herkunfts-Schliessung muss abbrechen.
    try:
        auswerten(con, zaehler, {"alt": "legacy_earliest_archived"})
    except VerfassungsBruch:
        print("  Unbekannter Payload bricht ab (die Datenbank waere nicht die versiegelte).")
    else:
        raise SystemExit("SELBSTTEST ROT: ein unbekannter Payload geht still durch.")
    print("Selbsttest gruen.")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data-root")
    ap.add_argument("--zustand", default="abdeckung-zustand.json")
    ap.add_argument("--bericht")
    ap.add_argument("--zaehlen", action="store_true")
    ap.add_argument("--selbsttest", action="store_true")
    args = ap.parse_args()

    if args.selbsttest:
        print("Selbsttest (ohne Datenbank):")
        selbsttest()
        if not (args.zaehlen or args.bericht):
            return

    db = datenwurzel(args.data_root).joinpath(*DB_RELATIV)
    con = oeffne_db(db)
    zustand_pfad = Path(args.zustand)

    if args.zaehlen:
        print("Zaehllauf ueber die Faktentabelle (schreibgeschuetzt, in Haeppchen):")
        zaehle(con, zustand_pfad)
        print("Zaehllauf fertig.")

    if args.bericht:
        if not zustand_pfad.is_file():
            raise SystemExit("Kein Zaehlstand unter %s — erst --zaehlen laufen lassen."
                             % zustand_pfad)
        zustand = json.loads(zustand_pfad.read_text(encoding="utf-8"))
        fertig = len(zustand.get("erledigtePayloads", []))
        if fertig != zustand.get("payloadsGesamt"):
            raise SystemExit(
                "ABBRUCH: der Zaehllauf hat erst %s von %s Payloads. Ein Bericht aus "
                "halben Zahlen saehe fertig aus und waere falsch."
                % (fertig, zustand.get("payloadsGesamt")))
        closure = json.loads((PROTOKOLL / "provenance-closure.json").read_text(encoding="utf-8"))
        ergebnis = auswerten(con, zustand["zaehler"], vintages(closure))
        Path(args.bericht).write_text(
            json.dumps(ergebnis, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
        print("Bericht geschrieben:", args.bericht)
        vergleichbar = [s for s in ergebnis["sensitivitaetJeQuartal"] if s["status"] == "vergleichbar"]
        print("  %d von %d Quartalen vergleichbar."
              % (len(vergleichbar), len(ergebnis["sensitivitaetJeQuartal"])))
        if vergleichbar:
            zuwaechse = sorted(s["tiefenZuwachsProzent"] for s in vergleichbar)
            print("  Fakten-Tiefe im neuen Stand: %+.1f %% bis %+.1f %% (Mitte %+.1f %%)"
                  % (zuwaechse[0], zuwaechse[-1], zuwaechse[len(zuwaechse) // 2]))


if __name__ == "__main__":
    main()

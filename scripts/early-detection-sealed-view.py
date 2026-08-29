# -*- coding: utf-8 -*-
"""E1(a): der Payload-Filter — ein Sichtkasten mit genau den 127 versiegelten Payloads.

Der Daten-Vertrag sagt selbst: „Ohne Payload-Filter erzeugt Schritt 2 eine
Obermenge […] der Filter selbst ist eine benannte E1-Aufgabe." Dieses Werkzeug ist
dieser Filter.

## Warum ein eigenes Verzeichnis und keine Option im Bau-Skript

`scripts/early-detection-pit-compact.py` steht mit seiner sha256 im Daten-Vertrag.
Wer es aendert, macht den Vertrag zur Luege. Es liest seinen Speicher aber
vollstaendig ueber `--data-root`: STORE.json, dann alle `observations/sec-fsd/*.json`,
dann je Beobachtung den Blob unter ihrem relativen `payloadPath`. Ein Verzeichnis,
das nur die 127 versiegelten Beobachtungen und deren Blobs enthaelt, ist fuer das
gepinnte Skript daher **ununterscheidbar** von einem echten Speicher — und es kann
gar nicht mehr an die Obermenge geraten. Kein Siegel wird angefasst.

## Warum eine Erlaubnisliste und keine Sperrliste

Im Speicher lagen am 17.08.2026 bereits **183** Beobachtungen: 127 versiegelte,
51 aus der Herkunfts-Schliessung bekannte Obermenge und **5 Neuzugaenge**
(2025q1–2026q1), die in keiner Liste stehen. Ein Filter, der „die 51 ausschliesst",
haette heute 132 statt 127 importiert — stille Kontamination. Deshalb wird positiv
auf die 127 Pruefsummen geschlossen und alles andere ausgeschlossen, egal wie der
Speicher weiter waechst.

Regeln: R12a (Speicherort aus EARLY_DETECTION_DATA_ROOT, keine absoluten Pfade,
Laufumgebung als Quittung), R14a (<200 KB), R14c (nur Standardbibliothek),
R15c (Haeppchen, atomar, wiederaufnehmbar).

Aufruf:
  python scripts/early-detection-sealed-view.py self-test
  python scripts/early-detection-sealed-view.py build  --view-root <ziel>
  python scripts/early-detection-sealed-view.py verify --view-root <ziel>
  python scripts/early-detection-sealed-view.py verify-db --database <probe.sqlite>
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import shutil
import sqlite3
import sys
import tempfile
from pathlib import Path

HIER = Path(__file__).resolve().parent
REPO = HIER.parent
PROTOKOLL = REPO / "protocol" / "early-detection" / "2.0.0"
DATENWURZEL_ENV = "EARLY_DETECTION_DATA_ROOT"
BEOBACHTUNGEN = ("observations", "sec-fsd")


class VerfassungsBruch(RuntimeError):
    pass


def kanonisch_sha256(wert) -> str:
    """Dieselbe Kanonisierung wie scripts/studie-herkunft.py:69."""
    roh = json.dumps(wert, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(roh.encode("utf-8")).hexdigest()


def datei_sha256(pfad: Path) -> str:
    h = hashlib.sha256()
    with pfad.open("rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def lies_json(pfad: Path):
    with pfad.open(encoding="utf-8") as f:
        return json.load(f)


def datenwurzel(vorgabe: str | None) -> Path:
    wert = vorgabe or os.environ.get(DATENWURZEL_ENV)
    if not wert:
        raise VerfassungsBruch(
            "Speicherort unbekannt: %s ist nicht gesetzt (R12a)." % DATENWURZEL_ENV)
    return Path(wert)


def pruefe_siegel(closure: dict, contract: dict) -> None:
    """Erst die eigene Lesart pruefen, dann handeln. Ein einziger Schreibzugriff
    vor dieser Pruefung koennte einen Sichtkasten fuer eine ANDERE Menge bauen,
    der vollkommen in Ordnung aussieht."""
    payloads = closure.get("payloads")
    if not isinstance(payloads, list):
        raise VerfassungsBruch("Herkunfts-Schliessung ohne Payload-Liste.")
    eigen = kanonisch_sha256({k: v for k, v in contract.items() if k != "contractSha256"})
    if eigen != contract.get("contractSha256"):
        raise VerfassungsBruch(
            "ABBRUCH: der Daten-Vertrag trifft seinen eigenen Selbst-Digest nicht — "
            "er ist veraendert worden.")
    if kanonisch_sha256(payloads) != closure.get("payloadSetSha256"):
        raise VerfassungsBruch(
            "ABBRUCH: die nachgerechnete Mengen-Pruefsumme trifft die in der "
            "Herkunfts-Schliessung stehende nicht.")
    if contract.get("payloadSetSha256") != closure.get("payloadSetSha256"):
        raise VerfassungsBruch(
            "ABBRUCH: Vertrag und Schliessung nennen verschiedene Mengen-Pruefsummen.")
    if contract.get("payloadCount") != len(payloads):
        raise VerfassungsBruch(
            "ABBRUCH: Vertrag nennt %s Payloads, die Schliessung fuehrt %d."
            % (contract.get("payloadCount"), len(payloads)))


def lade_protokoll(closure_pfad, contract_pfad):
    closure = lies_json(Path(closure_pfad) if closure_pfad else PROTOKOLL / "provenance-closure.json")
    contract = lies_json(Path(contract_pfad) if contract_pfad else PROTOKOLL / "data-contract.json")
    pruefe_siegel(closure, contract)
    return closure, contract


def beobachtungs_index(wurzel: Path) -> dict:
    """payloadSha256 -> (Pfad, Beobachtung). Die Dateien sind wenige KB gross;
    die Rohdaten daneben werden nicht angefasst (R14d)."""
    ordner = wurzel.joinpath(*BEOBACHTUNGEN)
    if not ordner.is_dir():
        raise VerfassungsBruch("Kein sec-fsd-Beobachtungsordner unter %s" % ordner)
    raus = {}
    for pfad in sorted(ordner.rglob("*.json")):
        o = lies_json(pfad)
        h = o.get("payloadSha256")
        if h in raus:
            raise VerfassungsBruch(
                "Zwei Beobachtungen mit derselben Pruefsumme %s — hier entschiede sonst "
                "die Reihenfolge im Dateisystem." % h[:16])
        raus[h] = (pfad, o)
    return raus


def getrennt(a: Path, b: Path) -> bool:
    """Der Sichtkasten darf nicht im Roh-Speicher liegen und umgekehrt — sonst
    verschmutzt der Filter genau das, was er sauber halten soll."""
    a, b = a.resolve(), b.resolve()
    return not (str(a).startswith(str(b) + os.sep) or str(b).startswith(str(a) + os.sep) or a == b)


# ------------------------------------------------------------------------ build
def bauen(wurzel: Path, sicht: Path, closure: dict, contract: dict) -> dict:
    if not getrennt(sicht, wurzel):
        raise VerfassungsBruch(
            "Sichtkasten %s und Roh-Speicher %s duerfen nicht ineinander liegen." % (sicht, wurzel))
    index = beobachtungs_index(wurzel)
    store = wurzel / "STORE.json"
    if not store.is_file():
        raise VerfassungsBruch("STORE.json fehlt im Roh-Speicher — das Bau-Skript braucht sie.")

    sicht.mkdir(parents=True, exist_ok=True)
    shutil.copy2(store, sicht / "STORE.json")
    verknuepft = kopiert = 0
    for p in closure["payloads"]:
        h = p["payloadSha256"]
        if h not in index:
            raise VerfassungsBruch(
                "Versiegelter Payload %s (%s) liegt nicht im Speicher — der Sichtkasten "
                "waere unvollstaendig." % (h[:16], p["quarter"]))
        quelle, o = index[h]
        # Die Beobachtungsdatei gegen ihren versiegelten Hash pruefen, nicht nur
        # kopieren: sonst traegt der Sichtkasten eine veraenderte Beschreibung
        # eines richtigen Blobs.
        ist = datei_sha256(quelle)
        if ist != p.get("observationSha256"):
            raise VerfassungsBruch(
                "Beobachtungsdatei zu %s weicht vom versiegelten Hash ab (%s statt %s)."
                % (p["quarter"], ist[:16], str(p.get("observationSha256"))[:16]))
        ziel = sicht.joinpath(*BEOBACHTUNGEN, p["quarter"], quelle.name)
        ziel.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(quelle, ziel)

        rel = o["payloadPath"]
        blob_quelle = wurzel / rel
        blob_ziel = sicht / rel
        blob_ziel.parent.mkdir(parents=True, exist_ok=True)
        if not blob_ziel.exists():
            try:
                os.link(blob_quelle, blob_ziel)     # spart Platz, ist aber keine Bedingung
                verknuepft += 1
            except OSError:
                shutil.copy2(blob_quelle, blob_ziel)
                kopiert += 1
        # Immer nachrechnen, gleich ob verknuepft oder kopiert: die Gueltigkeit
        # haengt am Hash, nie am Dateisystem-Kunstgriff (R12a).
        if datei_sha256(blob_ziel) != h:
            raise VerfassungsBruch("Blob %s im Sichtkasten trifft seinen Hash nicht." % h[:16])

    quittung = {
        "schema": "early-detection-sealed-view/v1",
        "protokoll": closure.get("protocol"),
        "payloadCount": len(closure["payloads"]),
        "payloadSetSha256": closure["payloadSetSha256"],
        "contractSha256": contract["contractSha256"],
        "blobsVerknuepft": verknuepft, "blobsKopiert": kopiert,
        "werkzeugSha256": datei_sha256(Path(__file__)),
        "umgebung": {"python": sys.version.split()[0], "plattform": platform.system()},
    }
    (sicht / "VIEW.json").write_text(
        json.dumps(quittung, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    return quittung


# ----------------------------------------------------------------------- verify
def pruefen(sicht: Path, closure: dict) -> list[str]:
    """Anwesenheit UND Abwesenheit. Ein Pruefer, der nur zaehlt, ob alles da ist,
    uebersieht genau den Fehler, um den es hier geht: eine Datei zu viel."""
    fehler = []
    index = beobachtungs_index(sicht)
    soll = {p["payloadSha256"]: p for p in closure["payloads"]}
    zuviel = sorted(set(index) - set(soll))
    fehlt = sorted(set(soll) - set(index))
    for h in zuviel:
        fehler.append("zu viel: %s (%s) — nicht versiegelt" % (h[:16], index[h][1].get("quarter")))
    for h in fehlt:
        fehler.append("fehlt: %s (%s)" % (h[:16], soll[h]["quarter"]))
    if len(index) != len(soll) and not (zuviel or fehlt):
        fehler.append("Anzahl %d statt %d" % (len(index), len(soll)))
    for h, p in soll.items():
        if h not in index:
            continue
        pfad, o = index[h]
        if datei_sha256(pfad) != p.get("observationSha256"):
            fehler.append("Beobachtung %s veraendert" % p["quarter"])
        blob = sicht / o["payloadPath"]
        if not blob.is_file():
            fehler.append("Blob fehlt: %s" % p["quarter"])
        elif datei_sha256(blob) != h:
            fehler.append("Blob %s (%s) trifft seinen Hash nicht" % (h[:16], p["quarter"]))
    return fehler


def pruefe_db(db: Path, closure: dict, contract: dict) -> list[str]:
    """Der eigentliche Waechter: was ist WIRKLICH in der gebauten Datenbank
    gelandet? Nach jedem Haeppchen aufrufbar (R15c)."""
    fehler = []
    con = sqlite3.connect("file:%s?mode=ro" % db.as_posix(), uri=True)
    try:
        drin = {h: q for h, q in con.execute("SELECT payload_sha256, quarter FROM source_payloads")}
        soll = {p["payloadSha256"]: p for p in closure["payloads"]}
        quartale = {q for q in drin.values()}
        erwartet = {h: p for h, p in soll.items() if p["quarter"] in quartale}
        for h, q in sorted(drin.items()):
            if h not in soll:
                fehler.append("FREMDER Payload in der Datenbank: %s (%s) — steht nicht in "
                              "der Herkunfts-Schliessung" % (h[:16], q))
        for h, p in sorted(erwartet.items()):
            if h not in drin:
                fehler.append("versiegelter Payload fehlt: %s (%s)" % (h[:16], p["quarter"]))
        # Zeilenzahlen je Payload gegen die versiegelten Werte
        try:
            stats = {pid: (s, f) for pid, s, f in con.execute(
                "SELECT payload_id, submissions, facts FROM payload_stats")}
            hash_je_id = {pid: h for pid, h in con.execute(
                "SELECT payload_id, payload_sha256 FROM source_payloads")}
            for pid, (subs, fakten) in stats.items():
                p = soll.get(hash_je_id.get(pid))
                if not p or not p.get("counts"):
                    continue
                c = p["counts"]
                if c.get("submissions") != subs or c.get("facts") != fakten:
                    fehler.append("Zeilenzahlen %s weichen ab: %d/%d statt %s/%s"
                                  % (p["quarter"], subs, fakten,
                                     c.get("submissions"), c.get("facts")))
        except sqlite3.OperationalError:
            pass  # payload_stats gibt es erst nach vollstaendigem Import
        if quartale and len(drin) == contract.get("payloadCount"):
            for tabelle, soll_zahl in (contract.get("rowCounts") or {}).items():
                if tabelle in ("database_bytes",):
                    continue
                try:
                    ist = con.execute("SELECT COUNT(*) FROM %s" % tabelle).fetchone()[0]
                except sqlite3.OperationalError:
                    continue
                if ist != soll_zahl:
                    fehler.append("Gesamtzahl %s: %d statt %s" % (tabelle, ist, soll_zahl))
    finally:
        con.close()
    return fehler


# -------------------------------------------------------------------- self-test
def selbsttest() -> None:
    """Mini-Speicher im Temp-Verzeichnis: bauen, pruefen, dann zwei Sabotagen."""
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        speicher, sicht = tmp / "speicher", tmp / "sicht"
        (speicher / "blobs" / "sha256").mkdir(parents=True)
        (speicher / "observations" / "sec-fsd" / "2009q1").mkdir(parents=True)
        (speicher / "STORE.json").write_text('{"schema":"early-detection-raw-store/v1"}',
                                             encoding="utf-8")

        def lege_an(inhalt: bytes, quartal: str):
            h = hashlib.sha256(inhalt).hexdigest()
            blob = speicher / "blobs" / "sha256" / h[:2] / ("%s.zip" % h)
            blob.parent.mkdir(parents=True, exist_ok=True)
            blob.write_bytes(inhalt)
            o = {"quarter": quartal, "payloadSha256": h, "qualityState": "accepted",
                 "payloadPath": "blobs/sha256/%s/%s.zip" % (h[:2], h)}
            op = speicher / "observations" / "sec-fsd" / quartal / ("%s.json" % h[:12])
            op.parent.mkdir(parents=True, exist_ok=True)
            op.write_text(json.dumps(o, ensure_ascii=False), encoding="utf-8")
            return h, datei_sha256(op)

        h1, o1 = lege_an(b"versiegelt-eins", "2009q1")
        h2, o2 = lege_an(b"obermenge", "2009q1")     # liegt da, gehoert NICHT dazu
        payloads = [{"quarter": "2009q1", "vintage": "legacy_earliest_archived",
                     "payloadSha256": h1, "observationSha256": o1}]
        closure = {"protocol": "TEST@1", "payloads": payloads,
                   "payloadSetSha256": kanonisch_sha256(payloads)}
        contract = {"payloadCount": 1, "payloadSetSha256": closure["payloadSetSha256"]}
        contract["contractSha256"] = kanonisch_sha256(contract)

        bauen(speicher, sicht, closure, contract)
        fehler = pruefen(sicht, closure)
        if fehler:
            raise SystemExit("SELBSTTEST ROT: der frisch gebaute Sichtkasten faellt durch: %s" % fehler)
        gebaut = beobachtungs_index(sicht)
        if len(gebaut) != 1 or h2 in gebaut:
            raise SystemExit("SELBSTTEST ROT: die Obermenge ist im Sichtkasten gelandet.")
        print("  Gebaut: 1 von 2 Beobachtungen uebernommen, die Obermenge blieb draussen.")

        # Sabotage 1: eine Beobachtung zu viel einschleusen.
        fremd = sicht / "observations" / "sec-fsd" / "2009q1" / "fremd.json"
        fremd.write_text(json.dumps({"quarter": "2009q1", "payloadSha256": h2,
                                     "payloadPath": "blobs/sha256/%s/%s.zip" % (h2[:2], h2)}),
                         encoding="utf-8")
        if not [f for f in pruefen(sicht, closure) if f.startswith("zu viel")]:
            raise SystemExit("SELBSTTEST ROT: eine zusaetzliche Beobachtung faellt nicht auf.")
        fremd.unlink()
        print("  Sabotage 1: eine Beobachtung zu viel wird benannt.")

        # Sabotage 2: ein Byte im Blob kippen.
        blob = sicht / "blobs" / "sha256" / h1[:2] / ("%s.zip" % h1)
        blob.write_bytes(b"versiegelt-zwei")
        if not [f for f in pruefen(sicht, closure) if "Hash" in f]:
            raise SystemExit("SELBSTTEST ROT: ein veraenderter Blob faellt nicht auf.")
        print("  Sabotage 2: ein veraenderter Blob wird benannt.")

        # Sabotage 3: das Siegel selbst verfaelschen.
        for was, c, k in (("Vertrags-Selbstdigest", dict(contract, contractSha256="0" * 64), closure),
                          ("Mengen-Pruefsumme", contract, dict(closure, payloadSetSha256="0" * 64))):
            try:
                pruefe_siegel(k, c)
            except VerfassungsBruch:
                continue
            raise SystemExit("SELBSTTEST ROT: %s geht still durch." % was)
        print("  Sabotage 3: zwei Siegel-Verfaelschungen brechen ab.")
    print("Selbsttest gruen.")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("befehl", choices=("build", "verify", "verify-db", "self-test"))
    ap.add_argument("--data-root")
    ap.add_argument("--view-root")
    ap.add_argument("--database")
    ap.add_argument("--closure")
    ap.add_argument("--contract")
    args = ap.parse_args()

    if args.befehl == "self-test":
        print("Selbsttest (Mini-Speicher im Temp-Verzeichnis):")
        selbsttest()
        return

    closure, contract = lade_protokoll(args.closure, args.contract)
    print("Siegel geprueft: %d Payloads, Vertrag und Schliessung stimmen ueberein."
          % contract["payloadCount"])

    if args.befehl == "verify-db":
        if not args.database:
            raise SystemExit("--database fehlt.")
        fehler = pruefe_db(Path(args.database), closure, contract)
        if fehler:
            print("FAIL — %d Befund(e):" % len(fehler))
            for f in fehler:
                print("  " + f)
            sys.exit(1)
        print("PASS: die Datenbank enthaelt ausschliesslich versiegelte Payloads.")
        return

    if not args.view_root:
        raise SystemExit("--view-root fehlt (Pflichtargument, damit nie versehentlich "
                         "in den Roh-Speicher geschrieben wird).")
    sicht = Path(args.view_root)

    if args.befehl == "build":
        q = bauen(datenwurzel(args.data_root), sicht, closure, contract)
        print("Sichtkasten gebaut: %d Payloads, %d verknuepft, %d kopiert."
              % (q["payloadCount"], q["blobsVerknuepft"], q["blobsKopiert"]))

    fehler = pruefen(sicht, closure)
    if fehler:
        print("FAIL — %d Befund(e):" % len(fehler))
        for f in fehler:
            print("  " + f)
        sys.exit(1)
    print("PASS: %d Beobachtungen, alle gegen ihren versiegelten Hash geprueft, "
          "keine einzige zu viel." % contract["payloadCount"])


if __name__ == "__main__":
    main()

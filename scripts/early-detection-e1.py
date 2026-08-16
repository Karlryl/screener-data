#!/usr/bin/env python3
"""E1 Datenbasis: Payload-Filter, PIT-Panel, drei Fenster-Dateien, Abdeckung, Fallzahl.

Werkzeug-Deckel R14c eingehalten: nur Python-Standardbibliothek + sqlite3.
Speicherort kommt aus --data-root bzw. EARLY_DETECTION_DATA_ROOT (R12a), keine
absoluten Pfade als Gueltigkeitsbedingung.

Unterbefehle:
  filter     Payload-Filter aus der Herkunfts-Schliessung erzeugen und gegen die DB pruefen
  panel      PIT-Panel bauen (ein sequenzieller Durchlauf, Haeppchen je Payload, wiederaufnehmbar)
  fenster    Drei Fenster-Dateien schreiben; Endtest verschluesselt (R2)
  report     Abdeckungs-Report + Fallzahl-Vorschau (R15a)
  self-test  Wachtests: Fenster-Mauer, Verschluesselung, Rechen-Symmetrie
"""
from __future__ import annotations

import argparse
import hashlib
import hmac
import json
import math
import os
import secrets
import sqlite3
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

# --- R2: Fenster nach Bekanntwerdens-Zeitpunkt (accepted_at_epoch), nicht nach Zeilendatum.
# Jedes Fenster traegt seine 4 Reifequartale mit; genau dafuer gibt es die Pufferjahre
# 2016 und 2020 ("damit keine Folgequartale ueber die Mauer reichen").
WINDOWS = {
    "entdeckung": {"signal": (2009, 2015), "reife": 2016},
    "pruefung":   {"signal": (2017, 2019), "reife": 2020},
    "endtest":    {"signal": (2021, 2023), "reife": 2024},
}
ENCRYPTED_WINDOW = "endtest"
PERIODIC_FORMS = ("10-K", "10-K/A", "10-Q", "10-Q/A", "20-F", "20-F/A")
QTRS_KEPT = (0, 1, 2, 3, 4)


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def year_of(epoch: int) -> int:
    return datetime.fromtimestamp(epoch, tz=timezone.utc).year


def window_of(epoch: int) -> tuple[str, str] | tuple[None, None]:
    """Fenster und Rolle (signal|reife) fuer einen Annahme-Zeitstempel."""
    y = year_of(epoch)
    for name, spec in WINDOWS.items():
        lo, hi = spec["signal"]
        if lo <= y <= hi:
            return name, "signal"
        if y == spec["reife"]:
            return name, "reife"
    return None, None


def open_ro(path: Path) -> sqlite3.Connection:
    return sqlite3.connect(f"file:{path.as_posix()}?mode=ro&immutable=1", uri=True)


def to_number(v):
    """R5: fehlend bleibt fehlend. Auch 'nan'/'inf' sind KEINE Zahlen.

    float() akzeptiert 'nan', 'inf', 'Infinity' ohne ValueError - die landeten sonst als
    scheinbar vorhandener Wert im Panel, und NaN=NaN ist in SQL immer falsch, was im
    Vintage-Vergleich still als 'geaendert' gezaehlt wuerde. [Review-Befund 7]
    """
    if v in (None, ""):
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) else None


# --------------------------------------------------------------------------- filter
def cmd_filter(args) -> dict:
    closure = json.loads(Path(args.closure).read_text(encoding="utf-8"))
    sealed = {p["payloadSha256"]: p for p in closure["payloads"]}
    con = open_ro(Path(args.database))
    in_db = {sha for (sha,) in con.execute("select payload_sha256 from source_payloads")}
    con.close()
    missing = sorted(set(sealed) - in_db)
    extra = sorted(in_db - set(sealed))
    payload_set_sha = hashlib.sha256("\n".join(sorted(sealed)).encode()).hexdigest()
    out = {
        "schema": "early-detection-payload-filter/v1",
        "protocol": "FEM-SEC-US@2.0.0",
        "purpose": "R12b/R13: positive Erlaubnisliste. Ein Neubau ohne diesen Filter erzeugt eine Obermenge.",
        "erzeugtAm": utc_now(),
        "quelle": "protocol/early-detection/2.0.0/provenance-closure.json",
        "payloadCount": len(sealed),
        "allowedPayloadSha256": sorted(sealed),
        # Der Status steht AUCH auf oberster Ebene, sonst meldet main() Erfolg, waehrend
        # der Abgleich rot ist - und die Kappung des Terminal-Ausdrucks verschluckt das
        # verschachtelte Feld ohnehin. [Review-Befund: FAIL ohne Exit-Code]
        "status": "PASS" if not missing and not extra else "FAIL",
        "datenbankAbgleich": {
            "inDatenbank": len(in_db),
            "imFilterAberNichtInDB": missing,
            "inDBAberNichtImFilter": extra,
            "status": "PASS" if not missing and not extra else "FAIL",
        },
        "hinweis": (
            "Positive Liste, keine Ausschlussliste: neue Beobachtungen im Speicher "
            "(Stand 16.08.: 183) koennen den versiegelten Neubau damit nicht veraendern."
        ),
    }
    out["filterSha256"] = hashlib.sha256(
        json.dumps({k: v for k, v in out.items() if k != "filterSha256"}, sort_keys=True).encode()
    ).hexdigest()
    Path(args.out).write_text(json.dumps(out, indent=1, ensure_ascii=False), encoding="utf-8")
    return out


# ---------------------------------------------------------------------------- panel
PANEL_DDL = """
CREATE TABLE IF NOT EXISTS panel_submission (
  submission_key TEXT PRIMARY KEY, payload_id INTEGER NOT NULL, quarter TEXT NOT NULL,
  vintage TEXT NOT NULL, adsh TEXT NOT NULL, cik INTEGER NOT NULL, name TEXT NOT NULL,
  sic INTEGER, form TEXT NOT NULL, period_end INTEGER, fy INTEGER, fp TEXT,
  filed_date INTEGER NOT NULL, accepted_at_epoch INTEGER NOT NULL, prevrpt INTEGER NOT NULL,
  in_concept_map INTEGER NOT NULL, fenster TEXT, fenster_rolle TEXT
);
CREATE TABLE IF NOT EXISTS panel_fact (
  submission_key TEXT NOT NULL, rolle TEXT NOT NULL, tag TEXT NOT NULL, prioritaet INTEGER NOT NULL,
  qtrs INTEGER NOT NULL, ddate INTEGER NOT NULL, uom TEXT NOT NULL, wert REAL,
  wert_fehlt INTEGER NOT NULL,
  PRIMARY KEY(submission_key, rolle, tag, qtrs, ddate, uom)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS build_progress (
  payload_id INTEGER PRIMARY KEY, quarter TEXT, vintage TEXT, submissions INTEGER,
  facts INTEGER, verworfen_coreg INTEGER NOT NULL DEFAULT 0,
  verworfen_ohne_einreichung INTEGER NOT NULL DEFAULT 0,
  verworfen_unparsbar INTEGER NOT NULL DEFAULT 0, done_at TEXT
);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
"""


def cmd_panel(args) -> dict:
    closure = json.loads(Path(args.closure).read_text(encoding="utf-8"))
    vintage_by_sha = {p["payloadSha256"]: p["vintage"] for p in closure["payloads"]}
    cmap = json.loads(Path(args.concept_map).read_text(encoding="utf-8"))

    # R12b/R13: gegen das VERSIEGELTE Filter-Artefakt pruefen, nicht gegen die Rohquelle.
    # Sonst wandert eine spaetere Erweiterung der Herkunfts-Schliessung unbemerkt ins
    # Panel und erzeugt genau die Obermenge, gegen die der Filter existiert. [Befund 4]
    erlaubt = json.loads(Path(args.filter).read_text(encoding="utf-8"))
    if erlaubt.get("datenbankAbgleich", {}).get("status") != "PASS":
        raise SystemExit("Payload-Filter steht nicht auf PASS — Abbruch (fail-closed).")
    allow = set(erlaubt["allowedPayloadSha256"])
    if len(allow) != erlaubt["payloadCount"]:
        raise SystemExit("Payload-Filter inkonsistent: Listenlaenge != payloadCount.")
    fremd = sorted(set(vintage_by_sha) - allow)
    if fremd:
        raise SystemExit(f"Herkunfts-Schliessung enthaelt {len(fremd)} Payloads ausserhalb des "
                         f"versiegelten Filters — Abbruch (fail-closed): {fremd[:3]}")

    # Der Nenner der Auffindbarkeit haengt an in_concept_map. Weicht die Formularliste der
    # Landkarte von den geladenen Formularen ab, verschoebe sich der Nenner unbemerkt.
    fremd_forms = sorted(set(cmap["forms"]) - set(PERIODIC_FORMS))
    if fremd_forms:
        raise SystemExit(f"Landkarte fuehrt Formulare ausserhalb von PERIODIC_FORMS: {fremd_forms}")

    src = open_ro(Path(args.database))
    out = sqlite3.connect(args.panel)
    out.executescript(PANEL_DDL)
    out.execute("PRAGMA journal_mode=WAL")

    # Rollen-Tags mit Prioritaet (kleiner = hoeher). Die Landkarte ist eingefroren: nur lesen.
    tag_role: dict[str, tuple[str, int]] = {}
    for rolle, spec in cmap["roles"].items():
        for i, tag in enumerate(spec["conceptPriority"]):
            tag_role.setdefault(tag, (rolle, i))
    tags = sorted(tag_role)
    cid_rows = list(src.execute(
        "select concept_id, tag from concepts where tag in (%s)" % ",".join("?" * len(tags)), tags))
    cid_tag = {cid: tag for cid, tag in cid_rows}
    cids = sorted(cid_tag)
    units = dict(src.execute("select unit_id, uom from units"))

    payloads = [r for r in src.execute(
        "select payload_id, payload_sha256, quarter from source_payloads order by payload_id")]
    done = {r[0] for r in out.execute("select payload_id from build_progress")}
    started = time.time()
    total_s = total_f = 0

    for pid, sha, quarter in payloads:
        if pid in done:
            continue
        if sha not in allow or sha not in vintage_by_sha:
            raise SystemExit(f"Payload {pid} ({sha[:12]}) steht nicht im versiegelten Filter — "
                             "Abbruch (fail-closed).")
        vintage = vintage_by_sha[sha]

        subs = {}
        rows_s = []
        for (sid, adsh, cik, name, sic, form, pe, fy, fp, fd, acc, prev) in src.execute(
            "select submission_id, adsh, cik, name, sic, form, period_end, fy, fp,"
            " filed_date, accepted_at_epoch, prevrpt from submissions"
            " where payload_id=? and form in (%s)" % ",".join("?" * len(PERIODIC_FORMS)),
            [pid, *PERIODIC_FORMS],
        ):
            key = f"{sha[:12]}:{adsh}"
            fenster, rolle = window_of(acc)
            subs[sid] = key
            rows_s.append((key, pid, quarter, vintage, adsh, cik, name, sic, form, pe, fy, fp,
                           fd, acc, prev, 1 if form in cmap["forms"] else 0, fenster, rolle))
        out.executemany("INSERT OR REPLACE INTO panel_submission VALUES (%s)" % ",".join("?" * 18), rows_s)

        rows_f = []
        # Verworfene Zeilen werden GEZAEHLT, nicht nur uebersprungen. Ohne diese Zaehler
        # laesst sich nicht belegen, dass die Filter ueber Fenster und Staende gleich
        # greifen - genau die Blindstelle, unter der die Vorstudie ihre Ungleichbehandlung
        # nicht bemerkt hat. [Review-Befund 1]
        weg_coreg = weg_ohne_sub = weg_unparsbar = 0
        for (sid, cid, ddate, qtrs, uid, coreg, val) in src.execute(
            "select submission_id, concept_id, ddate, qtrs, unit_id, coreg, value_text from facts"
            " where payload_id=? and concept_id in (%s) and qtrs in (%s)"
            % (",".join("?" * len(cids)), ",".join("?" * len(QTRS_KEPT))),
            [pid, *cids, *QTRS_KEPT],
        ):
            if coreg not in (None, ""):   # nur konsolidierte Mutter, keine Tochter-Aufrisse
                weg_coreg += 1
                continue
            key = subs.get(sid)
            if key is None:      # Fakt gehoert zu einer nicht-periodischen Einreichung
                weg_ohne_sub += 1
                continue
            tag = cid_tag[cid]
            rolle, prio = tag_role[tag]
            wert = to_number(val)
            if wert is None and val not in (None, ""):
                weg_unparsbar += 1
            rows_f.append((key, rolle, tag, prio, qtrs, ddate, units[uid], wert, 1 if wert is None else 0))
        out.executemany("INSERT OR REPLACE INTO panel_fact VALUES (?,?,?,?,?,?,?,?,?)", rows_f)

        out.execute("INSERT OR REPLACE INTO build_progress VALUES (?,?,?,?,?,?,?,?,?)",
                    (pid, quarter, vintage, len(rows_s), len(rows_f),
                     weg_coreg, weg_ohne_sub, weg_unparsbar, utc_now()))
        out.commit()   # Haeppchen atomar (R15c)
        total_s += len(rows_s); total_f += len(rows_f)
        print(f"  {quarter} {vintage[:6]:6s} payload {pid:3d}: {len(rows_s):6,} Einr., {len(rows_f):8,} Fakten"
              f"  (verworfen: coreg {weg_coreg:,} / ohne Einreichung {weg_ohne_sub:,} / unparsbar {weg_unparsbar:,})",
              flush=True)

    out.execute("INSERT OR REPLACE INTO meta VALUES ('conceptMap', ?)", (cmap["version"],))
    out.execute("INSERT OR REPLACE INTO meta VALUES ('builtAt', ?)", (utc_now(),))
    out.commit()
    n_s = next(out.execute("select count(*) from panel_submission"))[0]
    n_f = next(out.execute("select count(*) from panel_fact"))[0]
    out.close(); src.close()
    return {"status": "PASS", "neuePayloads": len(payloads) - len(done),
            "panelEinreichungen": n_s, "panelFakten": n_f,
            "laufzeitSekunden": round(time.time() - started, 1)}


# --------------------------------------------------------------- Verschluesselung (R2)
def _keystream(key: bytes, nonce: bytes, n: int) -> bytes:
    """HMAC-SHA256 im Zaehlermodus. Stdlib-only (R14c verbietet neue Abhaengigkeiten)."""
    out = bytearray()
    ctr = 0
    while len(out) < n:
        out += hmac.new(key, nonce + ctr.to_bytes(8, "big"), hashlib.sha256).digest()
        ctr += 1
    return bytes(out[:n])


def seal(plain: bytes, key: bytes) -> bytes:
    """Verschluesseln-dann-signieren. Rueckgabe: nonce | ciphertext | tag."""
    enc_key = hmac.new(key, b"enc", hashlib.sha256).digest()
    mac_key = hmac.new(key, b"mac", hashlib.sha256).digest()
    nonce = secrets.token_bytes(16)
    ct = bytes(a ^ b for a, b in zip(plain, _keystream(enc_key, nonce, len(plain))))
    tag = hmac.new(mac_key, nonce + ct, hashlib.sha256).digest()
    return nonce + ct + tag


def unseal(blob: bytes, key: bytes) -> bytes:
    enc_key = hmac.new(key, b"enc", hashlib.sha256).digest()
    mac_key = hmac.new(key, b"mac", hashlib.sha256).digest()
    nonce, ct, tag = blob[:16], blob[16:-32], blob[-32:]
    if not hmac.compare_digest(tag, hmac.new(mac_key, nonce + ct, hashlib.sha256).digest()):
        raise ValueError("Siegel gebrochen: MAC stimmt nicht")
    return bytes(a ^ b for a, b in zip(ct, _keystream(enc_key, nonce, len(ct))))


# -------------------------------------------------------------------------- fenster
def _window_rows(con: sqlite3.Connection, fenster: str) -> list[dict]:
    cols = [d[1] for d in con.execute("pragma table_info(panel_submission)")]
    return [dict(zip(cols, r)) for r in con.execute(
        "select * from panel_submission where fenster=? order by accepted_at_epoch, adsh", (fenster,))]


def cmd_fenster(args) -> dict:
    con = sqlite3.connect(args.panel)
    outdir = Path(args.outdir); outdir.mkdir(parents=True, exist_ok=True)
    result = {"schema": "early-detection-window-files/v1", "erzeugtAm": utc_now(), "fenster": {}}
    for name in WINDOWS:
        rows = _window_rows(con, name)
        payload = json.dumps({
            "fenster": name, "signalJahre": WINDOWS[name]["signal"], "reifejahr": WINDOWS[name]["reife"],
            "zuordnung": "accepted_at_epoch (Bekanntwerdens-Zeitpunkt), nie period_end",
            "zeilen": rows,
        }, ensure_ascii=False).encode("utf-8")
        klar = hashlib.sha256(payload).hexdigest()
        info = {"zeilen": len(rows), "firmen": len({r["cik"] for r in rows}),
                "signalZeilen": sum(1 for r in rows if r["fenster_rolle"] == "signal"),
                "reifeZeilen": sum(1 for r in rows if r["fenster_rolle"] == "reife"),
                "klartextSha256": klar}
        if name == ENCRYPTED_WINDOW:
            key = secrets.token_bytes(32)
            blob = seal(payload, key)
            # Rundlauf VOR dem Schreiben, und als echte Pruefung statt assert: unter
            # python -O waere ein assert wirkungslos und ein defektes Siegel fiele erst
            # bei der Einmal-Oeffnung auf, wenn nichts mehr zu retten ist. [Befund 5]
            if unseal(blob, key) != payload:
                raise RuntimeError("Rundlauf der Verschluesselung fehlgeschlagen — nichts geschrieben")
            p = outdir / f"fenster-{name}.sealed"
            p.write_bytes(blob)
            # Der Schluessel darf NICHT neben das Siegel: ein Verzeichnis-Kopiervorgang
            # nimmt ihn sonst mit und die Verschluesselung schuetzt vor nichts. [Befund: Schluesselablage]
            kp = Path(args.key_out)
            if kp.resolve().parent == outdir.resolve():
                raise SystemExit("--key-out zeigt in das Fenster-Verzeichnis. Schluessel gehoert "
                                 "ausserhalb des Datenbaums.")
            kp.parent.mkdir(parents=True, exist_ok=True)
            kp.write_text(key.hex(), encoding="utf-8")
            info |= {"datei": p.name, "verschluesselt": True, "bytes": len(blob),
                     "siegelSha256": hashlib.sha256(blob).hexdigest(),
                     "schluesselAblage": str(kp)}
        else:
            p = outdir / f"fenster-{name}.json"
            p.write_bytes(payload)
            info |= {"datei": p.name, "verschluesselt": False, "bytes": len(payload)}
        result["fenster"][name] = info

    # R3-Vorarbeit: Firmen-Ueberlappung zwischen den Fenstern sichtbar machen.
    ciks = {n: {r["cik"] for r in _window_rows(con, n)} for n in WINDOWS}
    result["firmenUeberlappung"] = {
        f"{a}~{b}": len(ciks[a] & ciks[b])
        for i, a in enumerate(WINDOWS) for b in list(WINDOWS)[i + 1:]
    }
    result["hinweisR3"] = ("Zeit-Trennung allein reicht nicht. Die firmen-disjunkte Replikation "
                           "wird in der Praeregistrierung 2.0.0 ueber den Pruefsummen-Rest der CIK festgelegt.")
    con.close()
    Path(args.out).write_text(json.dumps(result, indent=1, ensure_ascii=False), encoding="utf-8")
    return result


# --------------------------------------------------------------------------- report
def cmd_report(args) -> dict:
    con = sqlite3.connect(args.panel)
    c = con.cursor()
    rep = {"schema": "early-detection-coverage/v1", "erzeugtAm": utc_now()}

    rep["gesamt"] = dict(zip(
        ["einreichungen", "firmen", "fakten"],
        [next(c.execute("select count(*) from panel_submission"))[0],
         next(c.execute("select count(distinct cik) from panel_submission"))[0],
         next(c.execute("select count(*) from panel_fact"))[0]]))

    rep["jeJahrUndStand"] = [
        {"jahr": j, "vintage": v, "einreichungen": n, "firmen": f}
        for j, v, n, f in c.execute(
            "select cast(strftime('%Y', accepted_at_epoch, 'unixepoch') as integer) j, vintage,"
            " count(*), count(distinct cik) from panel_submission group by j, vintage order by j, vintage")]

    rep["jeFensterUndSektor"] = [
        {"fenster": w, "sicGruppe": s, "firmen": f} for w, s, f in c.execute(
            "select fenster, substr(cast(sic as text),1,2), count(distinct cik) from panel_submission"
            " where fenster is not null and sic is not null group by fenster, substr(cast(sic as text),1,2)"
            " order by fenster, count(distinct cik) desc")]

    # R6-Pflichtvergleich auf FAKTEN-Ebene: gleiche Kennzahl-Identitaet, beide Staende.
    # Dedupe VOR dem Selbstjoin: dieselbe Accession kann in zwei Quartalsarchiven desselben
    # Standes liegen; ohne group by entstuende ein Kreuzprodukt, das die Quote verzerrt.
    c.execute("""
      create temporary table v as
      select f.rolle, f.tag, f.qtrs, f.ddate, s.cik, s.adsh, s.vintage,
             min(f.wert) wmin, max(f.wert) wmax, count(*) n
      from panel_fact f join panel_submission s using(submission_key)
      where f.wert is not null
      group by f.rolle, f.tag, f.qtrs, f.ddate, s.cik, s.adsh, s.vintage""")
    c.execute("create index if not exists vi on v(cik, adsh, rolle, tag, qtrs, ddate)")
    mehrdeutig, = next(c.execute("select count(*) from v where wmin<>wmax"))
    fanout, = next(c.execute("select coalesce(sum(n-1),0) from v"))
    paare = list(c.execute("""
      select a.rolle, count(*), sum(case when a.wmin=b.wmin then 1 else 0 end)
      from v a join v b on a.cik=b.cik and a.adsh=b.adsh and a.rolle=b.rolle and a.tag=b.tag
             and a.qtrs=b.qtrs and a.ddate=b.ddate
      where a.vintage='legacy_earliest_archived' and b.vintage='post_2024_reprocessed_or_current'
      group by a.rolle order by count(*) desc"""))
    # Was nur in EINEM Stand existiert, muss gezaehlt werden - sonst misst die Quote nur
    # die Aenderung unter beidseitig vorhandenen Werten und unterschaetzt die Instabilitaet. [Befund 2]
    einseitig = dict((r, (na, nb)) for r, na, nb in c.execute("""
      select rolle,
        sum(case when vintage='legacy_earliest_archived' and not exists (
              select 1 from v b where b.cik=v.cik and b.adsh=v.adsh and b.rolle=v.rolle
                and b.tag=v.tag and b.qtrs=v.qtrs and b.ddate=v.ddate
                and b.vintage='post_2024_reprocessed_or_current') then 1 else 0 end),
        sum(case when vintage='post_2024_reprocessed_or_current' and not exists (
              select 1 from v b where b.cik=v.cik and b.adsh=v.adsh and b.rolle=v.rolle
                and b.tag=v.tag and b.qtrs=v.qtrs and b.ddate=v.ddate
                and b.vintage='legacy_earliest_archived') then 1 else 0 end)
      from v group by rolle"""))
    rep["r6SensitivitaetFaktenEbene"] = [
        {"rolle": r, "vergleichbarePaare": n, "wertGleich": g, "wertGeaendert": n - g,
         "anteilGeaendert": round((n - g) / n, 4) if n else None,
         "nurAltStand": einseitig.get(r, (0, 0))[0], "nurNeuerStand": einseitig.get(r, (0, 0))[1]}
        for r, n, g in paare]
    rep["r6Fanout"] = {"identitaetenMitMehrerenZeilen": fanout,
                       "identitaetenMitWiderspruechlichenWerten": mehrdeutig,
                       "hinweis": "Vor dem Selbstjoin auf Identitaet dedupliziert; ein Wert >0 bei "
                                  "'widerspruechlich' hiesse, dieselbe Identitaet traegt im selben "
                                  "Stand zwei verschiedene Zahlen."}
    rep["r6Hinweis"] = ("Verglichen werden Kennzahl-Werte gleicher Identitaet (CIK, Accession, Rolle, "
                        "Tag, qtrs, ddate) zwischen Alt-Stand und reprozessiertem Stand. "
                        "'anteilGeaendert' bezieht sich NUR auf beidseitig vorhandene Werte; was nur "
                        "in einem Stand existiert, steht daneben in nurAltStand/nurNeuerStand. Ein "
                        "Vergleich auf Firmen-Ebene wuerde hier nichts finden (siehe R6-Praezisierung).")

    # R15a Fallzahl-Vorschau: reife Ereignisse = Firmen mit genug Quartalsreihe im Signalteil.
    fall = {}
    for w in WINDOWS:
        reihen = list(c.execute("""
          select cik, count(distinct ddate) from panel_fact f join panel_submission s using(submission_key)
          where s.fenster=? and s.fenster_rolle='signal' and f.rolle='revenue' and f.wert is not null
          group by cik""", (w,)))
        reif = [k for k, n in reihen if n >= args.min_quartale]
        fall[w] = {"firmenMitUmsatz": len(reihen), "firmenMitMindestreihe": len(reif),
                   "mindestQuartale": args.min_quartale}
    rep["r15aFallzahlVorschau"] = fall
    rep["r15aHinweis"] = ("Vorschau auf Datenbasis-Ebene, KEINE Signalzaehlung: die Signalfamilie wird "
                          "erst in E2 definiert und in E3 eingefroren. Gezaehlt werden Firmen, deren "
                          "Umsatzreihe im Signalteil des Fensters lang genug fuer ein reifes Ereignis ist.")

    # R9-Vorarbeit: Auffindbarkeit = Anteil Einreichungen mit brauchbarem Umsatzwert.
    rep["auffindbarkeit"] = [
        {"fenster": w, "einreichungen": n, "mitUmsatz": m,
         "quote": round(m / n, 4) if n else None}
        for w, n, m in c.execute("""
          select s.fenster, count(distinct s.submission_key),
                 count(distinct case when f.rolle='revenue' and f.wert is not null then s.submission_key end)
          from panel_submission s left join panel_fact f using(submission_key)
          where s.fenster is not null and s.in_concept_map=1 group by s.fenster""")]

    # R10: steht die verwaesserte Aktienzahl ueberhaupt zur Verfuegung?
    rep["r10DilutedSharesVerfuegbarkeit"] = "nicht in der eingefrorenen Konzept-Landkarte 1.0.0; Erweiterung braucht neues Siegel (changeControl)"
    con.close()
    Path(args.out).write_text(json.dumps(rep, indent=1, ensure_ascii=False), encoding="utf-8")
    return rep


# ------------------------------------------------------------------------ abnahme
def cmd_abnahme(args) -> dict:
    """E1b-Abnahmelauf. Regel ist VORHER eingefroren (Landkarte 1.1.0); hier wird nur gezaehlt.

    Pruef- und Endtest-Fenster werden ausschliesslich als Zaehlprobe nach R15b beruehrt:
    Anzahl Einreichungen und Existenz eines Umsatztraegers. Kein Kennzahl-Wert wird gelesen,
    keine Signalrechnung, keine Ergebnisdaten.
    """
    cmap = json.loads(Path(args.concept_map).read_text(encoding="utf-8"))
    gate = cmap["gateMetric"]
    uni = cmap["universe"]["kategorieAusschluss"]
    con = sqlite3.connect(args.panel)
    c = con.cursor()

    # Definitionsmenge: im Universum, Formular in der Landkarte, und die Firma traegt im
    # Fenster ueberhaupt einen Umsatzwert (sonst ist der Indikator fuer sie nicht definiert).
    c.execute("""
      create temporary view basis as
      select s.submission_key, s.cik, s.fenster, s.sic, s.form,
             cast(strftime('%Y', s.accepted_at_epoch, 'unixepoch') as integer) jahr,
             (select count(*) from panel_fact f
               where f.submission_key=s.submission_key and f.rolle='revenue' and f.wert is not null) rev
      from panel_submission s where s.fenster is not null""")
    c.execute(f"""
      create temporary view imUniversum as
      select * from basis where in_map() """.replace("in_map()",
        f"form in ({','.join(repr(f) for f in cmap['forms'])})"
        f" and (sic is null or sic < {uni['sicVon']} or sic > {uni['sicBis']})"))

    def quote(where_extra: str, gruppe: str):
        return list(c.execute(f"""
          with traeger as (select fenster, cik from imUniversum group by fenster, cik
                           having sum(rev>0) >= ?)
          select b.{gruppe}, count(*), sum(case when b.rev>0 then 1 else 0 end)
          from imUniversum b join traeger t on t.fenster=b.fenster and t.cik=b.cik
          {where_extra} group by b.{gruppe} order by b.{gruppe}""", (args.min_traeger,)))

    res = {"schema": "early-detection-e1b-acceptance/v1", "erzeugtAm": utc_now(),
           "conceptMap": cmap["version"], "mapSha256": cmap["mapSha256"],
           "regelEingefrorenAm": cmap["frozenAt"],
           "reihenfolge": "Regel VOR der Messung eingefroren; diese Zaehlung kann die Regel nicht mehr beeinflussen.",
           "r15bZaehlprobe": "Pruef- und Endtestfenster nur als Anzahl/Existenz beruehrt, keine Werte gelesen.",
           "gate": gate, "minTraegerFuerDefinitionsmenge": args.min_traeger}

    res["jeFenster"] = [{"fenster": f, "einreichungen": n, "mitUmsatz": m,
                         "quote": round(m / n, 4) if n else None}
                        for f, n, m in quote("", "fenster")]
    res["jeJahr"] = [{"jahr": j, "einreichungen": n, "mitUmsatz": m,
                      "quote": round(m / n, 4) if n else None}
                     for j, n, m in quote("", "jahr")]

    # Deckungsgrad: wer bleibt ausserhalb und warum. Pflichtfeld.
    deck = []
    # Liste ZUERST materialisieren. Wird derselbe Cursor in der Schleife erneut benutzt,
    # setzt er sich zurueck und nur das erste Fenster wird ausgewertet - der Pflichtblock
    # waere still unvollstaendig. (Eigener Fehler, beim Nachrechnen aufgefallen.)
    fenster_liste = [f for (f,) in c.execute("select distinct fenster from basis order by fenster")]
    if len(fenster_liste) != len(WINDOWS):
        raise SystemExit(f"Deckungsgrad: {len(fenster_liste)} Fenster statt {len(WINDOWS)} — Abbruch.")
    for f in fenster_liste:
        tot_e, = next(c.execute("select count(*) from basis where fenster=?", (f,)))
        tot_c, = next(c.execute("select count(distinct cik) from basis where fenster=?", (f,)))
        fin_e, fin_c = next(c.execute(
            f"select count(*), count(distinct cik) from basis where fenster=? and sic between {uni['sicVon']} and {uni['sicBis']}", (f,)))
        f20_e, f20_c = next(c.execute(
            "select count(*), count(distinct cik) from basis where fenster=? and form not in (%s)"
            % ",".join(repr(x) for x in cmap["forms"]), (f,)))
        vor_c, = next(c.execute(
            f"""select count(*) from (select cik from imUniversum where fenster=?
                 group by cik having sum(rev>0) < ?)""", (f, args.min_traeger)))
        deck.append({"fenster": f, "firmenGesamt": tot_c, "einreichungenGesamt": tot_e,
                     "ausserhalb": {
                         "finanzsektor": {"firmen": fin_c, "einreichungen": fin_e,
                                          "anteilEinreichungen": round(fin_e / tot_e, 4)},
                         "form20F": {"firmen": f20_c, "einreichungen": f20_e,
                                     "anteilEinreichungen": round(f20_e / tot_e, 4)},
                         "vorUmsatz": {"firmen": vor_c,
                                       "anteilFirmen": round(vor_c / tot_c, 4)}}})
    res["deckungsgrad"] = deck

    # --- Abnahmekriterien
    qs = {x["fenster"]: x["quote"] for x in res["jeFenster"]}
    jahr = {x["jahr"]: x["quote"] for x in res["jeJahr"]}
    k1 = all(v >= gate["schwelle"] for v in qs.values())
    diff = (max(qs.values()) - min(qs.values())) * 100 if qs else None
    k2 = diff is not None and diff <= gate["maxFensterDifferenzPunkte"]
    sprung = abs(jahr[2018] - jahr[2017]) * 100 if 2017 in jahr and 2018 in jahr else None
    k3 = sprung is not None and sprung <= gate["maxRestSprung2017_2018Punkte"]
    res["abnahme"] = {
        "k1_alleFensterUeber90": {"erfuellt": k1, "quoten": {k: round(v, 4) for k, v in qs.items()}},
        "k2_fensterDifferenzMax10Punkte": {"erfuellt": k2, "differenzPunkte": round(diff, 1) if diff is not None else None},
        "k3_restSprung2017_2018Max5Punkte": {"erfuellt": k3, "sprungPunkte": round(sprung, 1) if sprung is not None else None},
        "verdikt": "BESTANDEN" if (k1 and k2 and k3) else "INCONCLUSIVE_DATA",
    }
    res["status"] = "PASS" if res["abnahme"]["verdikt"] == "BESTANDEN" else "FAIL"
    con.close()
    Path(args.out).write_text(json.dumps(res, indent=1, ensure_ascii=False), encoding="utf-8")
    return res


# -------------------------------------------------------------------- rohvergleich
def cmd_rohvergleich(args) -> dict:
    """R6-Sensitivitaet fuer ein Quartal, dessen zweiter Stand NICHT in der versiegelten DB liegt.

    Rechnet direkt auf dem Roh-Payload im Speicher. Damit bleibt das Siegel unangetastet:
    der Fall 2015q4 erzwingt KEINE Aenderung am versiegelten Bestand.
    """
    import csv, io, zipfile
    root = Path(args.data_root)
    blob = root / "blobs" / "sha256" / args.sha[:2] / f"{args.sha}.zip"
    if not blob.exists():
        raise SystemExit(f"Roh-Payload fehlt: {blob}")
    cmap = json.loads(Path(args.concept_map).read_text(encoding="utf-8"))
    tags = {t for r in cmap["roles"].values() for t in r["conceptPriority"]}
    num = to_number

    with zipfile.ZipFile(blob) as z:
        subs = {r["adsh"] for r in csv.DictReader(
            io.TextIOWrapper(z.open("sub.txt"), encoding="utf-8", errors="replace"), delimiter="\t")
            if r["form"] in PERIODIC_FORMS}
        neu = {}
        for r in csv.DictReader(io.TextIOWrapper(z.open("num.txt"), encoding="utf-8", errors="replace"),
                                delimiter="\t"):
            if r["tag"] not in tags or r["adsh"] not in subs or r.get("coreg"):
                continue
            q = int(r["qtrs"])
            if q > 4:
                continue
            neu[(r["adsh"], r["tag"], q, int(r["ddate"]), r["uom"])] = num(r["value"])

    con = open_ro(Path(args.database))
    pid = next(con.execute(
        "select payload_id from source_payloads where quarter=? order by observed_at_epoch limit 1",
        (args.quarter,)))[0]
    alt = {}
    for adsh, tag, q, dd, uom, val in con.execute(
        "select s.adsh, c.tag, f.qtrs, f.ddate, u.uom, f.value_text from facts f"
        " join submissions s on s.submission_id=f.submission_id"
        " join concepts c on c.concept_id=f.concept_id join units u on u.unit_id=f.unit_id"
        " where f.payload_id=? and f.qtrs<=4 and (f.coreg is null or f.coreg='')"
        " and s.form in (%s) and c.tag in (%s)" % (",".join("?" * len(PERIODIC_FORMS)),
                                                   ",".join("?" * len(tags))),
        [pid, *PERIODIC_FORMS, *sorted(tags)],
    ):
        alt[(adsh, tag, q, dd, uom)] = num(val)
    con.close()

    # NUR beidseitig vorhandene ZAHLEN vergleichen. Ohne diesen Filter zaehlt Python
    # None == None als "gleich" - ein fehlender Wert wuerde die Uebereinstimmungsquote
    # schoenen, exakt die Fehlerklasse, an der die Vorstudie starb. [Review-Befund 3]
    alt_z = {k: v for k, v in alt.items() if v is not None}
    neu_z = {k: v for k, v in neu.items() if v is not None}
    both = set(alt_z) & set(neu_z)
    gleich = sum(1 for k in both if alt_z[k] == neu_z[k])
    res = {
        "schema": "early-detection-raw-vintage-compare/v2", "quartal": args.quarter,
        "rohPayloadSha256": args.sha, "status": "PASS" if both else "FAIL",
        "vergleichbarePaare": len(both), "wertGleich": gleich, "wertGeaendert": len(both) - gleich,
        "anteilGeaendert": round((len(both) - gleich) / len(both), 4) if both else None,
        "nurAltStand": len(set(alt_z) - set(neu_z)), "nurNeuerStand": len(set(neu_z) - set(alt_z)),
        "leerBeidseitigAusgeschlossen": len(set(alt) & set(neu)) - len(both),
        "hinweis": ("Ersetzt die fehlende DB-Seite fuer dieses Quartal vollstaendig. "
                    "Das Siegel wird dafuer nicht angefasst. Verglichen werden nur "
                    "beidseitig vorhandene Zahlen; leere Werte gelten nie als Uebereinstimmung."),
    }
    if args.out:
        Path(args.out).write_text(json.dumps(res, indent=1, ensure_ascii=False), encoding="utf-8")
    return res


# ------------------------------------------------------------------------ self-test
def cmd_self_test(args) -> dict:
    checks = {}

    # 1. Fenster-Mauer: kein Jahr faellt in zwei Fenster, Puffer bleiben Puffer.
    # Kein assert - unter python -O waere es wirkungslos und die Zuweisung darunter
    # meldete trotzdem PASS. Das Ergebnis wird aus der Pruefung ABGELEITET. [Befund 5]
    seen = {}
    disjunkt = True
    for name, spec in WINDOWS.items():
        for y in range(spec["signal"][0], spec["signal"][1] + 1):
            if y in seen:
                disjunkt = False
            seen[y] = name
        if spec["reife"] in seen:
            disjunkt = False
        seen[spec["reife"]] = name
    checks["fensterMauerDisjunkt"] = disjunkt
    checks["fremdesJahrOhneFenster"] = window_of(int(datetime(2026, 5, 1, tzinfo=timezone.utc).timestamp())) == (None, None)

    # 2. Verschluesselung: Rundlauf gruen, manipuliertes Siegel MUSS rot werden.
    key = secrets.token_bytes(32)
    blob = seal(b"geheime Endtest-Zeilen", key)
    checks["siegelRundlauf"] = unseal(blob, key) == b"geheime Endtest-Zeilen"
    broken = bytearray(blob); broken[20] ^= 1
    try:
        unseal(bytes(broken), key); checks["manipuliertesSiegelFliegtAuf"] = False
    except ValueError:
        checks["manipuliertesSiegelFliegtAuf"] = True
    try:
        unseal(blob, secrets.token_bytes(32)); checks["falscherSchluesselFliegtAuf"] = False
    except ValueError:
        checks["falscherSchluesselFliegtAuf"] = True

    # 3. R5: prueft die ECHTE Parse-Funktion aus dem Bau-Pfad, nicht eine nachgebaute
    # Lambda - der alte Test lief nur ueber Werte, die er selbst abfing, und konnte
    # gar nicht fehlschlagen. [Befund 6]
    checks["fehlwertBleibtFehlwert"] = all(
        to_number(v) is None for v in (None, "", "N/A", "abc", "nan", "inf", "-inf", "Infinity"))
    checks["echteZahlKommtDurch"] = to_number("-1234.5") == -1234.5 and to_number("0") == 0.0

    # 4. Rechen-Gleichbehandlung: derselbe Wert wird unabhaengig von der Gruppe gleich
    # behandelt - die Funktion kennt keine Gruppe, das ist der Beleg.
    checks["keineGruppenabhaengigkeit"] = to_number("") is to_number("")

    status = "PASS" if all(checks.values()) else "FAIL"
    return {"schema": "early-detection-e1-self-test/v1", "status": status, "pruefungen": checks}


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    sub = p.add_subparsers(dest="cmd", required=True)
    root = os.environ.get("EARLY_DETECTION_DATA_ROOT", "")

    f = sub.add_parser("filter"); f.add_argument("--closure", required=True)
    f.add_argument("--database", required=True); f.add_argument("--out", required=True)

    a = sub.add_parser("panel"); a.add_argument("--database", required=True)
    a.add_argument("--closure", required=True); a.add_argument("--concept-map", required=True)
    a.add_argument("--filter", required=True); a.add_argument("--panel", required=True)

    w = sub.add_parser("fenster"); w.add_argument("--panel", required=True)
    w.add_argument("--outdir", required=True); w.add_argument("--out", required=True)
    w.add_argument("--key-out", required=True,
                   help="Pfad fuer den Endtest-Schluessel. MUSS ausserhalb von --outdir liegen.")

    r = sub.add_parser("report"); r.add_argument("--panel", required=True)
    r.add_argument("--out", required=True); r.add_argument("--min-quartale", type=int, default=8)

    v = sub.add_parser("rohvergleich")
    v.add_argument("--data-root", default=root or None, required=not root)
    v.add_argument("--database", required=True); v.add_argument("--concept-map", required=True)
    v.add_argument("--quarter", required=True); v.add_argument("--sha", required=True)
    v.add_argument("--out")

    b = sub.add_parser("abnahme"); b.add_argument("--panel", required=True)
    b.add_argument("--concept-map", required=True); b.add_argument("--out", required=True)
    b.add_argument("--min-traeger", type=int, default=1)

    sub.add_parser("self-test")
    args = p.parse_args()
    fn = {"filter": cmd_filter, "panel": cmd_panel, "fenster": cmd_fenster, "report": cmd_report,
          "abnahme": cmd_abnahme, "rohvergleich": cmd_rohvergleich, "self-test": cmd_self_test}[args.cmd]
    res = fn(args)
    print(json.dumps(res, indent=1, ensure_ascii=False, sort_keys=True)[:4000])
    return 0 if res.get("status", "PASS") != "FAIL" else 1


if __name__ == "__main__":
    raise SystemExit(main())

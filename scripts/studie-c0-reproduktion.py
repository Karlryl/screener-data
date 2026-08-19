#!/usr/bin/env python3
"""C0-Reproduktion: die Themenliste ein ZWEITES Mal, nur aus den Siegeln.

Die SACHE: EDGAR ist ein lebender Dienst. Eine spaetere Neuabfrage kann andere Zahlen
liefern, weil sich der Index geaendert hat - das waere eine Robustheitsnotiz, niemals
ein Korrekturkanal. Reproduzierbar heisst deshalb: aus den VERSIEGELTEN Rohantworten
und dem eingefrorenen Regelstand entsteht dieselbe Liste. Nichts wird neu abgefragt.

Ablauf:
  1. Aus jeder versiegelten EDGAR-Antwort wird die Zaehlung neu aufgebaut - nicht aus
     der Zaehl-Datei abgeschrieben, sondern aus den Bytes neu gerechnet.
  2. In einem Arbeitsverzeichnis laufen Skript und Protokoll-Dateien noch einmal;
     der Datenspeicher zeigt auf die neu gebaute Zaehlung.
  3. Verglichen wird der Inhalt, nicht der Zeitstempel: aus jeder erzeugten Datei
     wird das Feld erzeugtAm entfernt, der Rest muss BYTE-GLEICH sein. Ein
     Zeitstempel-Vergleich waere per Konstruktion immer rot und damit wertlos.

Aufruf:  python scripts/studie-c0-reproduktion.py
"""

import hashlib
import importlib.util
import json
import os
import shutil
import subprocess
import sys
import tempfile

WURZEL = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SKRIPT = os.path.join(WURZEL, "scripts", "studie-c0.py")


def lade_c0():
    spec = importlib.util.spec_from_file_location("studie_c0", SKRIPT)
    modul = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(modul)
    return modul


def zaehlung_aus_siegeln(c0):
    """Baut jede Zeile der Zaehlung aus den versiegelten Antworten NEU."""
    neu = []
    with open(c0.zaehl_pfad(), "r", encoding="utf-8") as f:
        for zeile in f:
            zeile = zeile.strip()
            if not zeile:
                continue
            alt = json.loads(zeile)
            filer = []
            verworfen = 0
            gesamt = None
            seite = None
            for i, h in enumerate(alt["antworten"]):
                antwort = json.loads(c0.entsiegle("edgar", h).decode("utf-8", "replace"))
                if i == 0:
                    gesamt = c0.treffer_gesamt(antwort)
                    seite = len(antwort["hits"]["hits"])
                teil, verworfen_teil = c0.filer_aus(antwort)
                filer.extend(teil)
                verworfen += verworfen_teil
            ciks = sorted({f["cik"] for f in filer})
            max_ciks = 0
            for adsh in {f["adsh"] for f in filer}:
                max_ciks = max(max_ciks, len({f["cik"] for f in filer if f["adsh"] == adsh}))
            neu.append({
                "phrase": alt["phrase"], "jahr": alt["jahr"], "treffer": gesamt,
                "D": len(ciks), "gedeckelt": gesamt > c0.AUTO_PASS_TREFFER,
                "ciks": ciks, "filer": filer, "maxCiksJeTreffer": max_ciks,
                "antworten": alt["antworten"], "seitengroesse": seite,
                "verworfeneTreffer": verworfen,
                "behalteneTreffer": len(filer),
            })
    return neu


def ohne_zeitstempel(pfad):
    with open(pfad, "r", encoding="utf-8") as f:
        obj = json.load(f)
    if isinstance(obj, dict):
        obj.pop("erzeugtAm", None)
    text = json.dumps(obj, ensure_ascii=False, sort_keys=True)
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def haupt():
    c0 = lade_c0()
    arbeit = tempfile.mkdtemp(prefix="c0-repro-")
    try:
        os.makedirs(os.path.join(arbeit, "repo", "scripts"))
        shutil.copy2(SKRIPT, os.path.join(arbeit, "repo", "scripts", "studie-c0.py"))
        shutil.copytree(os.path.join(WURZEL, "protocol", "strang-c"),
                        os.path.join(arbeit, "repo", "protocol", "strang-c"))
        for name in ("C0-themenliste.json", "C0-leiter-log.json", "C0-freeze2.json"):
            weg = os.path.join(arbeit, "repo", "protocol", "strang-c", name)
            if os.path.exists(weg):
                os.remove(weg)
        filer_alt = os.path.join(arbeit, "repo", "protocol", "strang-c", "filer")
        if os.path.isdir(filer_alt):
            shutil.rmtree(filer_alt)

        speicher = os.path.join(arbeit, "daten", "strang-c")
        os.makedirs(speicher)
        for name in ("C0-screen.jsonl", "C0-query-log.jsonl"):
            quelle = os.path.join(c0.datenwurzel(), "strang-c", name)
            if os.path.exists(quelle):
                shutil.copy2(quelle, os.path.join(speicher, name))
        with open(os.path.join(speicher, "C0-zaehlung.jsonl"), "w",
                  encoding="utf-8", newline="\n") as f:
            for satz in zaehlung_aus_siegeln(c0):
                f.write(json.dumps(satz, ensure_ascii=False) + "\n")

        umgebung = dict(os.environ)
        umgebung["EARLY_DETECTION_DATA_ROOT"] = os.path.join(arbeit, "daten")
        lauf = subprocess.run([sys.executable,
                               os.path.join(arbeit, "repo", "scripts", "studie-c0.py"),
                               "ableiten"], capture_output=True, text=True, env=umgebung)
        if lauf.returncode != 0:
            print(json.dumps({"status": "ROT", "grund": "ableiten aus den Siegeln scheiterte",
                              "ausgabe": (lauf.stdout + lauf.stderr)[-800:]},
                             ensure_ascii=False, indent=1))
            return 1

        vergleiche = []
        original = os.path.join(WURZEL, "protocol", "strang-c")
        kopie = os.path.join(arbeit, "repo", "protocol", "strang-c")
        namen = ["C0-themenliste.json", "C0-leiter-log.json"]
        for name in sorted(os.listdir(os.path.join(original, "filer"))):
            namen.append(os.path.join("filer", name))
        for name in namen:
            a = os.path.join(original, name)
            b = os.path.join(kopie, name)
            if not os.path.exists(b):
                vergleiche.append({"datei": name, "befund": "in der Reproduktion nicht entstanden"})
                continue
            ha, hb = ohne_zeitstempel(a), ohne_zeitstempel(b)
            if ha != hb:
                vergleiche.append({"datei": name, "original": ha[:16], "reproduktion": hb[:16]})
        # Gegenprobe am Vergleicher selbst: er muss auch UNGLEICH erkennen koennen.
        probe = os.path.join(arbeit, "probe.json")
        with open(probe, "w", encoding="utf-8") as f:
            json.dump({"a": 1, "erzeugtAm": "x"}, f)
        h1 = ohne_zeitstempel(probe)
        with open(probe, "w", encoding="utf-8") as f:
            json.dump({"a": 2, "erzeugtAm": "y"}, f)
        h2 = ohne_zeitstempel(probe)
        if h1 == h2:
            raise SystemExit("Der Vergleicher unterscheidet nicht - die Gegenprobe ist wertlos")

        print(json.dumps({
            "status": "GRUEN" if not vergleiche else "ROT",
            "verglicheneDateien": len(namen),
            "abweichungen": vergleiche,
            "bedeutung": "Aus den versiegelten EDGAR-Antworten und dem eingefrorenen "
                         "Regelstand entsteht dieselbe Themenliste. Verglichen wurde der "
                         "Inhalt ohne das Feld erzeugtAm; alles andere ist byte-gleich.",
        }, ensure_ascii=False, indent=1))
        return 0 if not vergleiche else 1
    finally:
        shutil.rmtree(arbeit, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(haupt())

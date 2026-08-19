#!/usr/bin/env python3
"""Schliesst die Luecke, die der Dokument-Screen offengelassen hat.

DER BEFUND, DER DAS NOETIG MACHT: Der Screen sortiert ein Jahr aus, wenn es weniger
als ceil(Schwelle/4) Dokument-Treffer hat. Dahinter steckt die Annahme, eine
10-K-Einreichung trage hoechstens vier verschiedene Firmennummern. Die Regel verlangt
ausdruecklich, diese Reserve an den tatsaechlich ausgezaehlten Antworten NACHZUMESSEN
- und die Messung widerlegt sie: die hoechste beobachtete Zahl ist 67 CIKs auf EINER
Einreichung (Mit-Registranten), 125 von 1385 Auszaehlungen liegen ueber vier.

Damit ist der Screen nicht bewiesen sicher. Ein Jahr mit ein bis drei Dokument-Treffern
KANN die Schwelle von 20 Firmen erreichen, wenn eine dieser Einreichungen viele
Mit-Registranten traegt. Also wird nachgezaehlt statt gehofft: jedes Spike-Jahr mit
ein bis drei Treffern und sein Basisjahr werden exakt ausgezaehlt und an dieselbe
Zaehl-Datei angehaengt. Mehr exakte Zahlen koennen das Ergebnis der Regel nur naeher
an die Regel bringen - die Regel selbst bleibt unangetastet.

Aufruf:  python scripts/studie-c0-screenluecke.py
"""

import importlib.util
import json
import os
import sys

WURZEL = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def lade_c0():
    spec = importlib.util.spec_from_file_location(
        "studie_c0", os.path.join(WURZEL, "scripts", "studie-c0.py"))
    modul = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(modul)
    return modul


def haupt():
    c0 = lade_c0()
    screen = c0.gelesen(c0.screen_pfad(), lambda s: (s["phrase"], s["jahr"]))
    fertig = c0.gelesen(c0.zaehl_pfad(), lambda s: (s["phrase"], s["jahr"]))

    noetig = set()
    for (phrase, jahr), satz in screen.items():
        if jahr in c0.SPIKE_JAHRE and 1 <= satz["treffer"] < max(1, -(-c0.BASIS_SCHWELLE // c0.SCREEN_RESERVE)):
            noetig.add((phrase, jahr))
            noetig.add((phrase, jahr - c0.BASIS_ABSTAND))
    offen = sorted(k for k in noetig if k not in fertig)
    sys.stderr.write("nachzuzaehlen: %d Paare\n" % len(offen))

    protokoll = open(c0.query_log_pfad(), "a", encoding="utf-8", newline="\n")
    ausgabe = open(c0.zaehl_pfad(), "a", encoding="utf-8", newline="\n")
    neu = 0
    try:
        for i, (phrase, jahr) in enumerate(offen, 1):
            satz = c0.exakt_zaehlen(phrase, jahr, protokoll)
            ausgabe.write(json.dumps(satz, ensure_ascii=False) + "\n")
            ausgabe.flush()
            neu += 1
            if i % 100 == 0:
                sys.stderr.write("nachzaehlen %d/%d\n" % (i, len(offen)))
                sys.stderr.flush()
    finally:
        ausgabe.close()
        protokoll.close()
    print(json.dumps({"nachgezaehlt": neu, "offenGewesen": len(offen)}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(haupt())

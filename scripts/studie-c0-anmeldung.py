#!/usr/bin/env python3
"""Meldet einen C0-Regelstand im Zugriffs-Register an - mit frei waehlbarer Kennung.

Warum diese Datei existiert: `studie-c0.py freeze1` leitet die Lauf-Kennung aus dem
Kalendertag ab. Muss am selben Tag ein ZWEITER Regelstand angemeldet werden - etwa
weil das Skript einen Lesefehler hatte und korrigiert wurde -, kollidiert die Kennung,
und das Nur-Anhaengen-Register weist sie zu Recht ab. Die Alternative waere gewesen,
die Kennung im eingefrorenen Skript zu aendern; das haette dessen Pruefsumme
verschoben und die Anmeldung im Kreis gedreht.

Der Eintrag ist inhaltlich derselbe wie der von `freeze1`; abweichend sind nur die
Kennung und der Vermerk, welchen Stand er ersetzt. Das Ersetzen wird ausgeschrieben,
nicht verschwiegen: ein zweiter Freeze am selben Tag ist eine Sache, die ein Pruefer
sehen muss.

Aufruf:
  python scripts/studie-c0-anmeldung.py --runid <kennung> --zugriff-ab <ISO>
                                        --ersetzt <fruehere-kennung>
"""

import importlib.util
import json
import os
import sys
from datetime import datetime, timezone

WURZEL = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def lade_c0():
    spec = importlib.util.spec_from_file_location(
        "studie_c0", os.path.join(WURZEL, "scripts", "studie-c0.py"))
    modul = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(modul)
    return modul


def haupt(argv):
    def wert(name):
        if "--" + name not in argv:
            raise SystemExit("Argument --%s fehlt" % name)
        return argv[argv.index("--" + name) + 1]

    c0 = lade_c0()
    runid = wert("runid")
    zugriff_ab = wert("zugriff-ab")
    ersetzt = wert("ersetzt")
    if c0.zeitpunkt(zugriff_ab) <= datetime.now(timezone.utc):
        raise SystemExit("--zugriff-ab liegt nicht in der Zukunft")

    freeze = c0.lies_json(c0.FREEZE1)
    # Der angemeldete Hash muss der Hash der Dateien SEIN, die jetzt im Baum liegen -
    # nicht der, der zufaellig in der Freeze-Datei steht. Sonst meldete man einen
    # Stand an, den es nicht gibt.
    gesamt, zeilen = c0.buendelhash([
        ("protocol/strang-c/C0-regel.md", c0.dateihash(c0.REGEL)),
        ("protocol/strang-c/C0-register-manifest.json", c0.dateihash(c0.MANIFEST)),
        ("protocol/strang-c/C0-vokabular.json", c0.dateihash(c0.VOKABULAR)),
        ("scripts/studie-c0.py", c0.dateihash(os.path.join(WURZEL, "scripts", "studie-c0.py"))),
    ])
    if gesamt != freeze["buendelSha256"] or zeilen != freeze["buendel"]:
        raise SystemExit("Die Freeze-Datei beschreibt nicht den Stand im Arbeitsbaum - "
                         "erst 'freeze1' neu laufen lassen")

    eintrag = c0.haenge_an_register({
        "runId": runid,
        "typ": "C0_REGELFREEZE",
        "registeredAt": c0.jetzt(),
        "accessedAt": zugriff_ab,
        "fenster": ["kein Studienfenster - lebende EDGAR-Volltextsuche"],
        "allowedOutputs": ["dokument_treffer", "eindeutige_ciks", "filer_liste",
                           "spike_jahr", "leiter_schritt"],
        "erlaubt": "Zaehlung eindeutiger CIKs in 10-K-Volltexten der lebenden "
                   "EDGAR-Volltextsuche und die daraus abgeleitete Themenliste samt "
                   "Filer-Listen.",
        "verboten": "Jeder Kurs-, Rendite-, Marktwert- oder Ergebniswert; jeder Zugriff auf "
                    "den versiegelten SEC-Speicher; jede Aenderung am Vokabular nach diesem Hash.",
        "begruendung": "C0 Strang C - zweiter Regelstand. Buendel-SHA-256 %s. Ersetzt die "
                       "Anmeldung %s: an dem Stand war ausschliesslich das SKRIPT geaendert "
                       "(Lesen von EDGARs unterer Trefferschranke), Regeltext, "
                       "Register-Manifest und Vokabular tragen unveraenderte Pruefsummen."
                       % (gesamt, ersetzt),
        "endtestSiegel": "unberuehrt - C0 fasst den versiegelten Speicher nicht an.",
    })
    print(json.dumps({"runId": runid, "buendelSha256": gesamt,
                      "eventHash": eintrag["eventHash"],
                      "registeredAt": eintrag["registeredAt"],
                      "accessedAt": zugriff_ab}, ensure_ascii=False, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(haupt(sys.argv[1:]))

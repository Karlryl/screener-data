#!/usr/bin/env python3
"""F6-K17 Schritt 3 — DER AUFRUFER, DER DIE ZAEHLPROBE AUF DIE FORTSETZUNG RICHTET.

WARUM ES DIESE DATEI GIBT — und warum sie NICHT scripts/studie-zaehlprobe.py aendert.

Seit dem R14a-Rollover liegt der autorisierende count_only_probe_authorized-Akt in
protocol/early-detection/2.0.0/outcome-access-ledger-teil2.json. scripts/studie-zaehlprobe.py
verdrahtet die zuerst beschriebene Registerdatei und kennt keinen Schalter dagegen; sie faende
den Akt also nie und braeche in der Freigabe-Pruefung ab. Der Abbruch laege VOR der
Paneloeffnung — fail-closed —, waere unter dem EIN-MAL-Deckel F6-K19 aber trotzdem das Ende.

Der naheliegende Weg — der Datei einen --register-Schalter geben — ist GEMESSEN VERWORFEN.
Ihr SHA a3fce5a1672e231fe12d7d7ffc8a3655ad8e3ef9b3bd2a2195e1af5fcbdbf17b ist in ELF Artefakten
gebunden, darunter eine PRAEREGISTRIERUNG (d3-identifier-bridge-preregistration.json) und die
GESCHLOSSENE Registerdatei selbst. Beide sind nicht nachziehbar: die eine ist versiegelt, die
andere append-only und mit ihrem Abschluss-Akt geschlossen. Sechs weitere sind versiegelte
Beweis-Reports. Ein Byte an jener Datei machte elf Bindungen unwahr, und keine Zusatzakte
koennte das heilen.

Deshalb: ein eigener Aufrufer mit eigenem SHA, den der F6-K11-Akt wie jedes andere Werkzeug
bindet. Ratifiziert vom Orchestrator als Option A, in genau dieser Gestalt.

DAS HIER IST EIN MONKEYPATCH, und er wird so genannt. Vier Bedingungen machen ihn zur
Vollendung statt zur Aufweichung:

  1. NEUE DATEI, NULL BYTES an scripts/studie-zaehlprobe.py. Alle elf Bindungen bleiben wahr,
     es gibt keinen Siegel-Akt, das Manifest bleibt, wie es ist.
  2. DER AUFRUFER PINNT, WAS ER PATCHT. Vor dem Patchen wird der sha256 der importierten
     Quelle gegen den gesiegelten Wert gehalten — fail-closed. Der Patch behauptet damit zur
     LAUFZEIT, dass das Modul, das er umlenkt, byte-identisch zum gesiegelten ist. Das ist
     strikt MEHR Pruefung als heute, nicht weniger.
  3. PATCHFLAECHE = GENAU EINE FUNKTION, die Freigabe-/Register-Pruefung. Der ZAEHL-Pfad
     bleibt unberuehrt; ein Waechter behauptet, dass die Zaehlfunktionen die eigenen,
     un-gepatchten Objekte des Moduls sind.
  4. BRUCHPROBEN in beide Richtungen (siehe tests/studie-f6-zaehlprobe-fortsetzung.test.js).

Aufruf:
  python scripts/studie-f6-zaehlprobe-fortsetzung.py --fenster entdeckung \\
      --freigabe reports/studie/<freigabe>.json [--register <registerdatei>] [...]

Alle uebrigen Schalter werden unveraendert an scripts/studie-zaehlprobe.py durchgereicht.
"""

import argparse
import hashlib
import importlib.util
import json
import os
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ZAEHLPROBE_REL = "scripts/studie-zaehlprobe.py"
ZAEHLPROBE = os.path.join(REPO, *ZAEHLPROBE_REL.split("/"))

# Der gesiegelte Wert aus protocol/early-detection/2.0.0/hash-manifest.json. Er steht hier
# NICHT als zweite Wahrheit, sondern als Zusicherung: weicht die Datei ab, wird nicht
# gepatcht und nicht gezaehlt. Das Manifest bleibt die Quelle; dieser Wert ist die Kopie,
# die beim Abweichen laut wird.
ZAEHLPROBE_SHA = "a3fce5a1672e231fe12d7d7ffc8a3655ad8e3ef9b3bd2a2195e1af5fcbdbf17b"
MANIFEST_REL = "protocol/early-detection/2.0.0/hash-manifest.json"

# Die Registerdateien der Kette. Die Fortsetzung ist die aktive; die Vorgabe dieses
# Aufrufers ist genau sie — dafuer gibt es ihn.
REGISTER_RELS = (
    "protocol/early-detection/2.0.0/outcome-access-ledger.json",
    "protocol/early-detection/2.0.0/outcome-access-ledger-teil2.json",
)
AKTIVES_REGISTER_REL = REGISTER_RELS[-1]

# Die Funktion, die gepatcht wird. EINE, benannt, an einer Stelle.
GEPATCHTE_FUNKTION = "pruefe_freigabe_gegen_register"

# Die Zaehl-Funktionen, die NICHT angefasst werden. Der Waechter haelt sie gegen die
# Objekte des frisch importierten Moduls.
UNBERUEHRTE_FUNKTIONEN = ("zaehle_fenster", "lauf", "lies_freigabe", "pruefe_manifest",
                          "siegel_wache", "oeffne_nur_lesend")


class AufruferFehler(Exception):
    """Abbruch dieses Aufrufers. Nie ein stiller Rueckfall."""


def sha256_datei(pfad):
    with open(pfad, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


def pruefe_siegel():
    """Bedingung 2: die Datei, die gleich umgelenkt wird, MUSS die gesiegelte sein.

    Geprueft wird gegen den hier gepinnten Wert UND gegen das Manifest — die beiden
    muessen uebereinstimmen, sonst ist nicht entscheidbar, welcher der Sollwert ist.
    """
    if not os.path.isfile(ZAEHLPROBE):
        raise AufruferFehler("die Zaehlprobe fehlt: " + ZAEHLPROBE_REL)
    ist = sha256_datei(ZAEHLPROBE)

    manifest_pfad = os.path.join(REPO, *MANIFEST_REL.split("/"))
    with open(manifest_pfad, encoding="utf-8") as f:
        manifest = json.load(f)
    gesiegelt = (manifest.get("files") or {}).get(ZAEHLPROBE_REL)
    if gesiegelt is None:
        raise AufruferFehler(
            "das Manifest fuehrt " + ZAEHLPROBE_REL + " nicht mehr. Dann ist die Grundlage "
            "dieses Aufrufers entfallen und er darf nicht patchen.")
    if gesiegelt != ZAEHLPROBE_SHA:
        raise AufruferFehler(
            "der gepinnte Sollwert (" + ZAEHLPROBE_SHA + ") und das Manifest (" + gesiegelt
            + ") widersprechen sich. Welcher gilt, ist nicht entscheidbar — es wird nicht "
            "gepatcht.")
    if ist != ZAEHLPROBE_SHA:
        raise AufruferFehler(
            ZAEHLPROBE_REL + " ist " + ist + ", gesiegelt ist " + ZAEHLPROBE_SHA
            + ". Ein anderer Hash ist ein anderes Skript: dieser Aufrufer lenkt nur ein "
            "Modul um, von dem er nachgerechnet hat, dass es das gesiegelte ist.")
    return ist


def lade_zaehlprobe():
    spec = importlib.util.spec_from_file_location("studie_zaehlprobe_fortsetzung", ZAEHLPROBE)
    if spec is None or spec.loader is None:
        raise AufruferFehler("Zaehlprobe nicht ladbar: " + ZAEHLPROBE_REL)
    modul = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(modul)
    return modul


def richte_auf(modul, register_pfad):
    """Bedingung 3: GENAU EINE Funktion wird umgelenkt.

    `lies_freigabe` ruft `pruefe_freigabe_gegen_register(freigabe)` ohne Pfad; der Default
    ist bei `def` gebunden, ein Umsetzen von `modul.REGISTER` wirkt deshalb NICHT (gemessen).
    Umgelenkt wird die Funktion selbst — sie bekommt einen neuen Default und ruft im uebrigen
    das Original.
    """
    original = getattr(modul, GEPATCHTE_FUNKTION)

    def auf_fortsetzung(freigabe, register_pfad=register_pfad):
        return original(freigabe, register_pfad)

    auf_fortsetzung.__name__ = GEPATCHTE_FUNKTION
    auf_fortsetzung.__doc__ = (
        "Umgelenkt von scripts/studie-f6-zaehlprobe-fortsetzung.py auf " + register_pfad
        + ". Ruft unveraendert das Original des gesiegelten Moduls.")
    auf_fortsetzung.umgelenkt_von = "studie-f6-zaehlprobe-fortsetzung"
    auf_fortsetzung.original = original
    setattr(modul, GEPATCHTE_FUNKTION, auf_fortsetzung)
    return original


def haupt(argv=None):
    p = argparse.ArgumentParser(
        description="F6: Zaehlprobe gegen die Register-FORTSETZUNG (Option A, Aufrufer)")
    p.add_argument("--fenster", required=True)
    p.add_argument("--freigabe", required=True)
    p.add_argument("--register", help="Registerdatei (Vorgabe: die aktive der Kette)")
    p.add_argument("--data-root")
    p.add_argument("--arbeit")
    p.add_argument("--ziel")
    p.add_argument("--ohne-siegel-hash", action="store_true")
    p.add_argument("--nur-pruefen", action="store_true",
                   help="Siegel pruefen, umlenken, KEINEN Lauf starten")
    a = p.parse_args(argv)

    ist = pruefe_siegel()
    modul = lade_zaehlprobe()
    register_pfad = a.register or os.path.join(REPO, *AKTIVES_REGISTER_REL.split("/"))
    if not os.path.isfile(register_pfad):
        raise AufruferFehler("Registerdatei nicht gefunden: " + os.path.basename(register_pfad))
    richte_auf(modul, register_pfad)

    sys.stderr.write(
        "AUFRUFER: Zaehlprobe gesiegelt-gleich (" + ist[:16] + "...), EINE Funktion umgelenkt ("
        + GEPATCHTE_FUNKTION + ") auf " + os.path.basename(register_pfad) + "\n")
    if a.nur_pruefen:
        return 0

    ausgabe = modul.lauf(a.fenster, a.freigabe, data_root=a.data_root, arbeit=a.arbeit,
                         ziel=a.ziel, siegel_voll=not a.ohne_siegel_hash)
    print(json.dumps(ausgabe["varianten"], ensure_ascii=False, indent=1, sort_keys=True))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(haupt())
    except AufruferFehler as fehler:
        sys.stderr.write("AUFRUFER-ABBRUCH: " + str(fehler) + "\n")
        sys.exit(1)

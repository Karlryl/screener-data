#!/usr/bin/env python3
"""RR9-A2 (B3') - der V0-Nullpunkt - und der B2-Trockenlauf (OFFEN-1).

DREI DINGE, DIE HIER GETRENNT BLEIBEN

1. `provenienz`  - RR9-A2 Schritt 1. Reine LESUNG bereits veroeffentlichter
   Berichte: unter welchem Tripel wurde die registrierte 326/365 gezaehlt, und
   auf welchem Jahrgang ruht sie (RR9-A3 Ziffer 1, Restverknuepfung). Kein
   Panel-Zugriff, keine Rechnung.

2. `tripwire`    - RR9-A2 Schritt 3. Der DAUER-Tripwire von B3': zur Laufzeit
   muss die tatsaechlich geladene Umsatz-Allowlist bit-identisch mit der
   registrierten sein. Fail-closed. Diese Pruefung loest sich nicht auf, wenn
   man die Vorbedingung einmal erfuellt - das war S1s Konstruktionsauflage.

3. `b2-trockenlauf` - OFFEN-1, entschieden vom Orchestrator (ENTSCHIED 127).
   Beweist, dass V2' AUSFUEHRBAR ist: beide Kohorten in DERSELBEN Geometrie
   bestimmbar, `n` gegen die Fallzahl-Schwelle 200 ausgewiesen.

DER BLINDHEITSKERN DES TROCKENLAUFS
-----------------------------------
V2' vergleicht am Ende das VERHAELTNIS zweier Reifequoten gegen 1 (Abbruchregel
B2: >= 10 pp Rueckstand). Dieses Verhaeltnis frueh zu rechnen hiesse, das Tor
zu fahren. Es wird hier nicht "weggelassen", sondern es ist STRUKTURELL nicht
erreichbar: dieser Trockenlauf ruft nur `firmenreihen` auf. Er berechnet
nirgends eine Reifequote - weder `erst_ereignisse` noch `arm_zaehlen` noch
`ampel_fuer` werden geladen. Wo keine Quote entsteht, kann kein Verhaeltnis
gebildet werden. tests/studie-rr9-nullpunkt.test.js pinnt genau diese
Abwesenheit.

DIE SPALTUNG VON B3' (VB-A1..VB-A8, _COURT-VIERBANK-OFFEN23-2026-08-30)
----------------------------------------------------------------------
B3' ist seit dem Vier-Bank-Urteil vom 30.08. kein einzelner Waechter mehr,
sondern zwei namentlich getrennte Zweige mit verschiedenen Sanktionen:

  ANKER - die Registrierung selbst ist gebrochen oder der Nullpunkt ist nicht
          reproduzierbar. BEERDIGEN, automatisch, ohne jede Ausnahme.
  DRIFT - die zur Laufzeit geladene Liste fehlt oder weicht ab, WAEHREND die
          Registrierung unversehrt ist. STOPP mit Kontingent EINS; das zweite
          Feuern dieses Zweigs ist BEERDIGEN, automatisch.

Der Zweig haengt an der PRUEFUNG, nie an einem Textmuster: welche Sanktion
gilt, sagt `NullpunktBruch.sanktion`. Zwei Ausgaenge: 5 = BEERDIGEN
(unveraendert), 6 = STOPP.

Aufruf:
  python scripts/studie-rr9-nullpunkt.py provenienz [--ziel <datei.json>]
  python scripts/studie-rr9-nullpunkt.py tripwire [--liste <json-datei>]
  python scripts/studie-rr9-nullpunkt.py b2-trockenlauf [--ziel <datei.json>]
  python scripts/studie-rr9-nullpunkt.py zweig-rotproben [--ziel <datei.json>]
  python scripts/studie-rr9-nullpunkt.py register-anker [--ziel <datei.json>]
  python scripts/studie-rr9-nullpunkt.py selbsttest
"""

import argparse
import hashlib
import importlib.util
import json
import os
import sys

WURZEL = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROTOKOLL_2_0_0 = os.path.join(WURZEL, "protocol", "early-detection", "2.0.0")
PRAEREG = os.path.join(PROTOKOLL_2_0_0, "preregistration.json")
MANIFEST = os.path.join(PROTOKOLL_2_0_0, "hash-manifest.json")
KONZEPTLISTE_2_1_0 = os.path.join(
    WURZEL, "protocol", "early-detection", "2.1.0", "konzeptliste.json")
E3_BERICHT = os.path.join(WURZEL, "reports", "studie",
                          "E3-zaehlprobe-pruefung-2026-08-19.json")
E1_BERICHT = os.path.join(WURZEL, "reports", "studie",
                          "E1-panel-bau-2026-08-19.json")
BASISRATEN = os.path.join(WURZEL, "scripts", "studie-basisraten.py")

# Der registrierte Nullpunkt (§0.2 Befund 1 des Urteils, am Repo entschieden -
# hier NICHT neu hergeleitet, sondern als Tatsache gefuehrt und geprueft).
ALLOWLIST_PFAD = ("signalFamily", "gemeinsameMechanik", "umsatzQuellenAllowlist")
# Das Tripel, das hash-manifest.json 2.0.0 bindet - namentlich, nicht "was
# gerade drinsteht". Ohne diese Liste war `all()` ueber einen LEEREN Block
# `True`: ein Manifest mit fehlendem `files`-Block haette "das Tripel ist
# unveraendert" gemeldet, ohne eine einzige Datei geprueft zu haben.
TRIPEL_DATEIEN = (
    "protocol/early-detection/2.0.0/preregistration.json",
    "scripts/studie-basisraten.py",
    "scripts/studie-zaehlprobe.py",
)
PANELBAU = os.path.join(WURZEL, "scripts", "studie-panel-bau.py")
REGISTRIERTE_PRAEREG_SHA = ("799f925142860b4db97b5f18894b62c749aeb014"
                            "872279aa6a7df8ee99ac5a6c")
# Die Fallzahl-Schwelle aus scripts/studie-zaehlprobe.py (FALLZAHL_MIN). Sie
# wird hier als Zahl gefuehrt, NICHT durch Laden der Zaehlprobe geholt: dieses
# Modul soll den Zaehlpfad gar nicht erst im Speicher haben.
FALLZAHL_SCHWELLE = 200

# VB-A1 (_COURT-VIERBANK-OFFEN23-2026-08-30): B3' traegt nicht mehr EINE
# Sanktionskonstante fuer alle sieben Pruefungen. Zwei benannte Konstanten,
# zwei Meldungsformen, Zuordnung genau nach der Tabelle des Urteils. Der Zweig
# haengt an der PRUEFUNG, nie an einem Textmuster: welche Sanktion gilt, sagt
# das `sanktion`-Feld der Ausnahme, die die jeweilige Pruefung wirft.
#   ANKER (Registrierung gebrochen / Nullpunkt nicht reproduzierbar) -> BEERDIGEN
#   DRIFT (geladene Liste fehlt/weicht ab, Registrierung unversehrt) -> STOPP
# Dieselbe Form wie B1' in scripts/studie-rr9-b1-manifest.py - bewusst, nicht
# aus Bequemlichkeit: ein zweiter Zweig-Mechanismus waere ein zweites Verfahren.
SANKTION_ANKER = "BEERDIGEN"
SANKTION_DRIFT = "STOPP"
EXIT_B3 = 5          # BEERDIGEN - die bestehende Maschinerie, unveraendert
EXIT_B3_STOPP = 6    # STOPP mit Kontingent EINS (VB-A3)

LEDGER = os.path.join(PROTOKOLL_2_0_0, "outcome-access-ledger.json")
B1_MODUL = os.path.join(WURZEL, "scripts", "studie-rr9-b1-manifest.py")

# VB-A3: das Feld, an dem ein Reparatur-Akt des DRIFT-Zweigs im nur-anhaengenden
# Register erkannt wird. Ein Marker, nicht mehrere: zwei Erkennungswege waeren
# zwei Zaehlungen, und "nicht eindeutig" ist nach dem Urteil selbst der Bruchfall.
DRIFT_MARKE = "b3DriftReparatur"

STOPPSATZ = "F4 darf nicht starten, Rueckgabe an Orchestrator"

STOPP_VOLLZUG = (
    "VOLLZUG DES STOPP, abschliessend, kein Ermessen (VB-A4): "
    "1. sofortiger Halt VOR jedem geschuetzten Zugriff. "
    "2. Vorfall veroeffentlichen. "
    "3. AUSSCHLIESSLICH die registrierte Bit-Identitaet wiederherstellen - "
    "erlaubt die Reparatur irgendeine Wahl statt exakter Wiederherstellung, "
    "oder kann B3' erst NACH einem geschuetzten Zugriff feuern, gilt "
    "automatisch BEERDIGEN. "
    "4. Waechter erneut gruen und SERVER-BESTAETIGT nachweisen. "
    "5. Wiederaufnahme nur nach registriertem, server-bestaetigtem "
    "Reparatur-Akt, der die Ursache benennt (Registerfeld " + DRIFT_MARKE + "). "
    "UNTERSAGT in beiden Zweigen: Neubemessung von Design, Liste, Preis oder "
    "Zeitplan (P5-Logik, RR9-A2 Schritt 2). "
    "KONTINGENT EINS (VB-A3): das ZWEITE Feuern dieses Zweigs - gleiche oder "
    "andere Ursache - ist BEERDIGEN, automatisch, ohne weitere Beratung. "
    "NICHTENTSCHEIDUNG IST EIN BENANNTER AKT (VB-A5): verstreicht das "
    "Stopp-Datum ohne Entscheid, gilt K6s bestehende Regel (Rueckgabe an den "
    "Orchestrator, nie stille Verlaengerung); verstreicht auch die "
    "Wiedervorlage, ist der Pfad beerdigt und der Bericht fuehrt woertlich: "
    "'beerdigt durch Nichtentscheidung des Orchestrators am <Datum>'.")

# VB-A7: die 326/365 (S-G) belegt die Zaehlkette, nicht die Identitaet der
# Allowlist. Sie ist BERICHTSPFLICHT ohne Sanktion - kein B3'-Ausloeser haengt
# an ihr. tests/studie-vb-b3-spaltung.test.js prueft genau diese Abwesenheit.
KETTENPROBE_326 = (
    "VB-A7: Die Reproduktion der 326/365 (S-G) wird auf demselben "
    "gespeicherten Zwischenstand MITBERICHTET, weil sie die Zaehlkette "
    "unabhaengig von der Allowlist belegt. Sie traegt KEINE Sanktion; ein "
    "Verfehlen ist ein Berichtsbefund, kein B3'-Ausloeser. Der B3'-ANKER "
    "haengt allein an 292/438 (ENTSCHIED 130). Mitzufuehrende Grenze aus dem "
    "Reproduktions-Artefakt selbst: reproduziert ist die Kette AB "
    "pit_reduktion, die Stufe Panel -> Zwischenstand ist nicht nachgefahren.")


class NullpunktBruch(Exception):
    """B3' hat gefeuert. `sanktion` sagt, welcher der beiden Zweige."""

    def __init__(self, sanktion, text):
        super().__init__(text)
        self.sanktion = sanktion


def sha256_datei(pfad):
    with open(pfad, "rb") as fh:
        return hashlib.sha256(fh.read()).hexdigest()


def lies_json(pfad):
    with open(pfad, encoding="utf-8") as fh:
        return json.load(fh)


def hole(baum, pfad):
    for teil in pfad:
        if not isinstance(baum, dict) or teil not in baum:
            return None
        baum = baum[teil]
    return baum


def kanonisch(liste):
    """Bit-Vergleich heisst: eine Kanonisierung, an der nichts wackelt."""
    return json.dumps(liste, ensure_ascii=False, sort_keys=False,
                      separators=(",", ":"))


# =============================================================================
# 1. RR9-A2 Schritt 1 - Provenienz
# =============================================================================

def provenienz(praereg=PRAEREG, manifest=MANIFEST, e3=E3_BERICHT, e1=E1_BERICHT,
               panel_wurzel=None):
    """Reine Lesung. Beantwortet: unter welchem Tripel und auf welchem Jahrgang
    ruht die registrierte 326/365?"""
    m = lies_json(manifest)
    tripel = m.get("files") or {}
    tripel_ist = {}
    for rel in sorted(tripel):
        pfad = os.path.join(WURZEL, rel.replace("/", os.sep))
        tripel_ist[rel] = {
            "registriert": tripel[rel],
            "gemessen": sha256_datei(pfad) if os.path.isfile(pfad) else None,
        }
        tripel_ist[rel]["identisch"] = (
            tripel_ist[rel]["gemessen"] == tripel_ist[rel]["registriert"])
    # FAIL-CLOSED gegen die leere Menge: erst muss das Tripel VOLLSTAENDIG und
    # namentlich das erwartete sein, dann darf ueber seine Hashes geurteilt
    # werden. `all()` ueber nichts ist sonst wahr.
    tripel_vollstaendig = sorted(tripel) == sorted(TRIPEL_DATEIEN)
    tripel_haelt = (tripel_vollstaendig
                    and all(v["identisch"] for v in tripel_ist.values()))

    bericht = lies_json(e3)
    geprueft = sorted(bericht.get("manifestGeprueft") or [])
    lauf_unter_tripel = tripel_vollstaendig and geprueft == sorted(TRIPEL_DATEIEN)

    # WO liegt die 326/365 wirklich? Gemessen, nicht angenommen.
    treffer = []
    for name, werte in (bericht.get("varianten") or {}).items():
        if werte.get("fallzahl") == 326 and werte.get("firmen_mit_erst_ereignis") == 365:
            treffer.append(name)
    variante = treffer[0] if len(treffer) == 1 else None

    praereg_json = lies_json(praereg)
    allowlist = hole(praereg_json, ALLOWLIST_PFAD)
    # Der E3-Bericht schluesselt die Varianten unter ihrem `name` (S-U / S-G),
    # die Praeregistrierung fuehrt zusaetzlich eine `id` (H1 / H2). Gejoint wird
    # ueber den Namen - das ist der Schluessel, unter dem die 326/365 steht.
    groesse_je_variante = {
        v.get("name"): v.get("groesse")
        for v in hole(praereg_json, ("signalFamily", "varianten")) or []}
    # Traegt die Variante, die die 326/365 traegt, die Allowlist - oder eine
    # andere Groesse? Das entscheidet, was eine Reproduktion beweisen wuerde.
    groesse = groesse_je_variante.get(variante)
    ruht_auf_allowlist = bool(groesse) and "Allowlist" in groesse

    e1_json = lies_json(e1)
    jahrgang = e1_json.get("variante")
    panel_datei = (e1_json.get("jeFenster") or {}).get("validierung") or {}
    gelesen = bericht.get("gelesenePfade") or []
    kette = {
        "e3GelesenePfade": gelesen,
        "e1PanelDatei": panel_datei.get("datei"),
        "e1PanelBytes": panel_datei.get("bytes"),
        "e1Jahrgang": jahrgang,
        "e1Protokoll": e1_json.get("protokoll"),
        "e1PayloadsGebaut": e1_json.get("payloadsGebaut"),
        "e3LasDieseDatei": any(
            str(p).endswith(panel_datei.get("datei") or "\x00") for p in gelesen),
        "panelBytesAufPlatte": None,
        "panelBytesIdentisch": None,
    }
    if panel_wurzel and panel_datei.get("datei"):
        pfad = os.path.join(panel_wurzel, panel_datei["datei"])
        if os.path.isfile(pfad):
            kette["panelBytesAufPlatte"] = os.path.getsize(pfad)
            kette["panelBytesIdentisch"] = (
                kette["panelBytesAufPlatte"] == panel_datei.get("bytes"))

    geschlossen = bool(tripel_haelt and lauf_unter_tripel and variante
                       and kette["e3LasDieseDatei"] and jahrgang)
    return {
        "schema": "studie-rr9-a2-provenienz/v1",
        "auflage": "RR9-A2 Schritt 1 + RR9-A3 Ziffer 1 - _COURT-RR9-2026-08-30",
        "art": "Berichts-Provenienz-Lesung. Keine Rechnung, kein Panel-Zugriff.",
        "suchachsen": [
            {"achse": "Registerfeld", "status": "gemessen",
             "wert": "hash-manifest.json 2.0.0, files-Block"},
            {"achse": "Dateiname", "status": "gemessen",
             "wert": "die drei Tripel-Dateien am registrierten Pfad"},
            {"achse": "Feldname", "status": "gemessen",
             "wert": "varianten.*.fallzahl / .firmen_mit_erst_ereignis im E3-Bericht"},
            {"achse": "Inhalts-String", "status": "gemessen",
             "wert": "SHA-256 ueber die Dateibytes der drei Tripel-Dateien"},
        ],
        "tripel": tripel_ist,
        "tripelVollstaendigUndNamentlich": tripel_vollstaendig,
        "erwarteteTripelDateien": list(TRIPEL_DATEIEN),
        "tripelUnveraendertSeitDemSiegeln": tripel_haelt,
        "e3LiefUnterDemTripel": lauf_unter_tripel,
        "e3ManifestGeprueft": geprueft,
        "traegerVariante": variante,
        "traegerGroesse": groesse,
        "ruhtAufUmsatzAllowlist": ruht_auf_allowlist,
        "registrierteAllowlist": allowlist,
        "jahrgangsKette": kette,
        "provenienzGeschlossen": geschlossen,
        "befund": _provenienz_satz(geschlossen, variante, groesse, ruht_auf_allowlist,
                                   jahrgang),
    }


def _provenienz_satz(geschlossen, variante, groesse, ruht_auf_allowlist, jahrgang):
    if not geschlossen:
        return ("NEGATIV: die Provenienz laesst sich nicht schliessen. Nach "
                "RR9-A2 Schritt 1 hat V0 damit keinen Nullpunkt und B3' feuert "
                "sofort.")
    kern = ("POSITIV: die registrierte 326/365 wurde unter genau dem Tripel "
            "gezaehlt, das hash-manifest.json 2.0.0 bindet, und ruht auf dem "
            "Jahrgang " + repr(jahrgang) + ".")
    if ruht_auf_allowlist:
        return kern + " Traeger ist die Variante " + repr(variante) + "."
    return (kern + " KORREKTUR, GEMESSEN: Traeger ist die Variante "
            + repr(variante) + " mit der Groesse " + repr(groesse) + " - NICHT "
            "die umsatzQuellenAllowlist. Das Urteil fuehrt die 326/365 in "
            "RR9-A2 Schritt 1 als Wert 'unter dem Tripel aus preregistration."
            "json (umsatzQuellenAllowlist), studie-basisraten.py und "
            "studie-zaehlprobe.py'. Der Tripel-Teil haelt; die Zuordnung zur "
            "Allowlist haelt nicht. Eine Reproduktion der 326/365 belegt damit "
            "die Zaehlkette, aber NICHT die Identitaet der Allowlist.")


def jahrgangs_registrierung(panel_wurzel=None, panelbau=PANELBAU):
    """RR9-A3 Ziffer 2 - der Registrierungs-GEGENSTAND, nicht der Register-Akt.

    Diese Datei benennt und hasht, was einzufrieren ist: den gewaehlten Jahrgang
    und den GEMESSENEN Jahrgang der 89,32-%-Basis. Der Register-Eintrag selbst
    wird hier NICHT geschrieben - siehe `registerHinweis`.
    """
    p = provenienz(panel_wurzel=panel_wurzel)
    kette = p["jahrgangsKette"]
    basis_jahrgang = kette["e1Jahrgang"]
    # UNABHAENGIGE QUELLE, sonst waere der Vergleich eine Tautologie: der
    # gewaehlte Jahrgang ist der, den der BAU deklariert - die Konstante
    # VARIANTE in scripts/studie-panel-bau.py. Frueher stand hier
    # `gewaehlt = basis_jahrgang`, und `gewaehlt != basis_jahrgang` konnte
    # damit nie feuern. Genau die Fehlklasse, die RR9-A4 benennt.
    spec = importlib.util.spec_from_file_location("studie_panel_bau", panelbau)
    modul = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(modul)
    gewaehlt = getattr(modul, "VARIANTE", None)
    inhalt = {
        "gewaehlterJahrgang": gewaehlt,
        "gemessenerJahrgangDerBasis": basis_jahrgang,
        "weichenBeideVoneinanderAb": gewaehlt != basis_jahrgang,
        "kette": kette,
        "gewaehlterJahrgangHerkunft": "scripts/studie-panel-bau.py::VARIANTE",
        "gemessenerJahrgangHerkunft": "reports/studie/E1-panel-bau-2026-08-19.json::variante",
        "protokoll": "FEM-SEC-US@2.1.0",
    }
    inhalt_sha = hashlib.sha256(json.dumps(
        inhalt, ensure_ascii=False, sort_keys=True,
        separators=(",", ":")).encode("utf-8")).hexdigest()
    return {
        "schema": "studie-rr9-a3-jahrgang/v1",
        "auflage": "RR9-A3 Ziffer 2 und 3 - _COURT-RR9-2026-08-30",
        "inhalt": inhalt,
        "inhaltSha256": inhalt_sha,
        "a2Satz3": (
            "NICHT AUSGELOEST: gewaehlter und gemessener Jahrgang sind "
            "identisch. Der Ausloeser aus U1 ('bei nicht dokumentiertem "
            "Jahrgang der 89,32-%-Basis, oder wenn der gewaehlte Jahrgang von "
            "ihm abweicht') greift damit nicht. Das Zitierverbot bleibt "
            "woertlich in Kraft; es feuert hier nur nicht."
            if gewaehlt == basis_jahrgang else
            "AUSGELOEST: die 89,32 % darf nicht als Vergleichsbasis zitiert "
            "werden; der F6-Bericht fuehrt das als eigene Zeile."),
        "eskalationNachZiffer6": (
            "NICHT EINGETRETEN: die Provenienz ist eindeutig und zeigt "
            "legacy_earliest_archived, nicht post_2024_reprocessed_or_current. "
            "Die Jahrgangsfrage bleibt damit eine Messung und wird keine "
            "Weiche."
            if basis_jahrgang == "legacy_earliest_archived" else
            "EINGETRETEN: die Jahrgangsfrage geht an den vollen Rat."),
        "tripwire": {
            "ort": "scripts/studie-panel-bau.py::payload_liste",
            "regel": ("Ein Payload ohne Jahrgangs-Kennzeichen tritt nie in "
                      "einen jahrgangs-deklarierten Bau ein; der Bau bricht "
                      "hart ab."),
            "rotProbe": "tests/studie-rr9-bremsen.test.js, ROT-PROBE A3",
        },
        "registerHinweis": (
            "RR9-A3 Ziffer 2 verlangt die Eintragung IM F3b-EINTRAG. Der "
            "F3b-Eintrag ist Eintrag 21 im nur-anhaengenden, verketteten "
            "outcome-access-ledger.json und war zum Zeitpunkt des Urteils "
            "bereits geschlossen (PR #142, Serverbeweis PR #143). Er kann "
            "nicht nachtraeglich um den Jahrgang ergaenzt werden, ohne die "
            "Append-only-Disziplin zu brechen. Ein EIGENER Eintrag 22 waere "
            "der einzige gangbare Weg - das ist eine Entscheidung, die das "
            "Urteil nicht getroffen hat. Der Register-Akt wird deshalb NICHT "
            "vollzogen, sondern an den Orchestrator zurueckgegeben. Diese "
            "Datei ist sein vollstaendig vorbereiteter Gegenstand."),
    }


# =============================================================================
# 2. RR9-A2 Schritt 3 - der Dauer-Tripwire von B3'
# =============================================================================

def _anker(text):
    """Ein ANKER-Bruch: die Registrierung selbst ist gebrochen. BEERDIGEN,
    automatisch und ohne jede Ausnahme (Urteil V1, Zweig ANKER)."""
    return NullpunktBruch(
        SANKTION_ANKER,
        "B3'-ANKER-ABBRUCH (" + SANKTION_ANKER + "): " + text
        + " Die Registrierung selbst ist gebrochen; ohne V0 ist jede Differenz "
        "zwischen Vintage-Wechsel, Panel-Neubau und Konzept-Verbreiterung "
        "konfundiert und damit uninterpretierbar, in jede Richtung.")


def registrierte_allowlist(praereg=PRAEREG, manifest=MANIFEST):
    """Die registrierte Liste - oder ein ANKER-Bruch. Nie ein Default.

    Alle fuenf Pruefungen hier gehoeren nach der Urteilstabelle zum Zweig
    ANKER: sie treffen die Registrierung, nicht die geladene Konfiguration.
    """
    if not os.path.isfile(manifest):
        raise _anker("kein hash-manifest.json unter " + manifest + ".")
    registriert = (lies_json(manifest).get("files") or {}).get(
        "protocol/early-detection/2.0.0/preregistration.json")
    if registriert != REGISTRIERTE_PRAEREG_SHA:
        raise _anker(
            "das hash-manifest fuehrt fuer die Praeregistrierung "
            + repr(registriert) + ", registriert ist "
            + REGISTRIERTE_PRAEREG_SHA + ".")
    if not os.path.isfile(praereg):
        raise _anker(
            "die registrierte Praeregistrierung liegt nicht unter "
            + praereg + ".")
    ist = sha256_datei(praereg)
    if ist != registriert:
        raise _anker(
            praereg + " traegt sha256 " + ist + ", registriert ist "
            + registriert + ". Die Datei, aus der der Nullpunkt stammt, ist "
            "nicht mehr die registrierte.")
    liste = hole(lies_json(praereg), ALLOWLIST_PFAD)
    if not liste:
        raise _anker(
            "in der registrierten Praeregistrierung steht keine "
            "umsatzQuellenAllowlist unter " + ".".join(ALLOWLIST_PFAD) + ".")
    return liste


def drift_vorlauf(ledger=LEDGER):
    """VB-A3: wie viele Reparatur-Akte des DRIFT-Zweigs stehen schon im Register?

    Gezaehlt wird ueber das nur-anhaengende, verkettete
    `outcome-access-ledger.json` - kein neuer Mechanismus: die Wiederaufnahme
    nach einem DRIFT-STOPP IST nach dem Beschluss ohnehin ein registrierter,
    server-bestaetigter Reparatur-Akt.

    FAIL-CLOSED in die harte Richtung, woertlich aus dem Urteil: ist der
    Datensatz nicht lesbar oder nicht eindeutig, gilt "mindestens ein Vorlauf"
    -> BEERDIGEN. Ein NICHT geschriebener Datensatz macht die Regel damit
    schaerfer, nicht weicher. Deshalb gibt es hier keinen Except-Zweig, der
    still 0 zurueckgibt.
    """
    try:
        ereignisse = lies_json(ledger)["events"]
        if not isinstance(ereignisse, list):
            raise ValueError("`events` ist keine Liste")
    except Exception as exc:            # noqa: BLE001 - fail-closed ist der Zweck
        return 1, ("FAIL-CLOSED: das Register unter " + ledger + " ist nicht "
                   "lesbar (" + type(exc).__name__ + ": " + str(exc) + ") - "
                   "es gilt 'mindestens ein Vorlauf'.")
    def steckt_irgendwo(baum):
        """Traegt dieser Teilbaum die Marke - egal wie tief?

        Gesucht wird REKURSIV, nicht nur an der Oberflaeche. Eine Marke, die
        durch einen Schema-Wechsel eine Ebene tiefer rutscht, waere sonst still
        ungezaehlt: ein echter Reparatur-Akt gaelte als nie geschehen, und das
        ZWEITE Feuern bekaeme wieder STOPP statt der vorgeschriebenen
        Beerdigung. Fail-open an genau der Stelle, die fail-closed sein muss.
        """
        if isinstance(baum, dict):
            return DRIFT_MARKE in baum or any(
                steckt_irgendwo(v) for v in baum.values())
        if isinstance(baum, list):
            return any(steckt_irgendwo(v) for v in baum)
        return False

    anzahl = 0
    for e in ereignisse:
        if not isinstance(e, dict):
            continue
        if DRIFT_MARKE not in e:
            if steckt_irgendwo(e):
                return 1, ("FAIL-CLOSED: Registereintrag " + repr(e.get("runId"))
                           + " traegt " + DRIFT_MARKE + " NICHT auf der obersten "
                           "Ebene, sondern verschachtelt - die Zaehlung ist "
                           "nicht eindeutig, es gilt 'mindestens ein Vorlauf'.")
            continue
        marke = e[DRIFT_MARKE]
        if not isinstance(marke, dict) or not str(marke.get("ursache") or "").strip():
            return 1, ("FAIL-CLOSED: Registereintrag " + repr(e.get("runId"))
                       + " traegt " + DRIFT_MARKE + " ohne benannte Ursache - "
                       "nicht eindeutig, es gilt 'mindestens ein Vorlauf'.")
        anzahl += 1
    return anzahl, ("gezaehlt ueber " + str(len(ereignisse))
                    + " Registereintraege, Marke " + DRIFT_MARKE)


def _lade_b1(pfad=B1_MODUL):
    spec = importlib.util.spec_from_file_location("studie_rr9_b1_manifest", pfad)
    modul = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(modul)
    return modul


def beerdigungs_wache(b1_modul=B1_MODUL, praereg=PRAEREG):
    """VB-A8, ausfuehrbar: stehen jenseits F3 wirklich noch ZWEI automatische
    Beerdigungsregeln?

    Gezaehlt wird nicht, was irgendwo geschrieben steht, sondern was FEUERT.
    Jede der beiden Regeln wird an einer Wegwerf-Kopie einmal ausgeloest und
    ihre Sanktion abgelesen. Wer eine von beiden auf STOPP senkt, faellt hier
    auf - egal wie der Meldungstext danach lautet.

    Sperrklausel: faellt der ANKER-Zweig weg, springt der DRIFT-Zweig ohne
    weitere Sitzung auf BEERDIGEN beim ersten Ausloeser (siehe
    `pruefe_nullpunkt`). Eine Lage mit weniger als zwei automatischen
    Beerdigungsregeln jenseits F3 ist damit maschinell rot.
    """
    import tempfile
    regeln = []

    # Regel 1 - B1'-b, Byte-Nichtidentitaet (scripts/studie-rr9-b1-manifest.py).
    beobachtet = None
    try:
        b1 = _lade_b1(b1_modul)
        with tempfile.TemporaryDirectory() as tmp:
            ort = b1.ORTE[0]
            kasten = os.path.join(tmp, ort)
            inhalt = b"vb-a8-probe"
            sha = hashlib.sha256(inhalt).hexdigest()
            verz = os.path.join(kasten, *b1.BLOB_UNTERPFAD, sha[:2])
            os.makedirs(verz)
            datei = os.path.join(verz, sha + ".bin")
            with open(datei, "wb") as fh:
                fh.write(inhalt)
            m = b1.baue_manifest(tmp, orte=(ort,))
            with open(datei, "wb") as fh:      # der Eingriff: ein Byte kippt
                fh.write(b"gekippt")
            try:
                b1.pruefe_payload(m, kasten, sha)
            except b1.BremsenBruch as exc:
                beobachtet = exc.sanktion
    except Exception as exc:                   # noqa: BLE001 - fail-closed
        beobachtet = "NICHT AUSLOESBAR (" + type(exc).__name__ + ": " + str(exc) + ")"
    regeln.append({
        "regel": "B1'-b Byte-Nichtidentitaet",
        "ort": "scripts/studie-rr9-b1-manifest.py::pruefe_payload",
        "beobachteteSanktion": beobachtet,
        "automatischeBeerdigung": beobachtet == "BEERDIGEN",
    })

    # Regel 2 - B3'-ANKER (dieses Modul).
    beobachtet = None
    try:
        with tempfile.TemporaryDirectory() as tmp:
            falsch = os.path.join(tmp, "hash-manifest.json")
            with open(falsch, "w", encoding="utf-8") as fh:
                json.dump({"files": {
                    "protocol/early-detection/2.0.0/preregistration.json":
                        "0" * 64}}, fh)
            try:
                registrierte_allowlist(praereg=praereg, manifest=falsch)
            except NullpunktBruch as exc:
                beobachtet = exc.sanktion
    except Exception as exc:                   # noqa: BLE001 - fail-closed
        beobachtet = "NICHT AUSLOESBAR (" + type(exc).__name__ + ": " + str(exc) + ")"
    regeln.append({
        "regel": "B3'-ANKER",
        "ort": "scripts/studie-rr9-nullpunkt.py::registrierte_allowlist",
        "beobachteteSanktion": beobachtet,
        "automatischeBeerdigung": beobachtet == SANKTION_ANKER,
    })

    anzahl = sum(1 for r in regeln if r["automatischeBeerdigung"])
    return {
        "auflage": "VB-A8 - _COURT-VIERBANK-OFFEN23-2026-08-30",
        "regeln": regeln,
        "anzahlAutomatischerBeerdigungen": anzahl,
        "sollAnzahl": 2,
        "ankerZweigLebt": regeln[1]["automatischeBeerdigung"],
        "rot": anzahl < 2,
        "sperrklausel": (
            "Faellt der ANKER-Zweig weg, springt der DRIFT-Zweig ohne weitere "
            "Sitzung auf BEERDIGEN beim ersten Ausloeser, und S3s "
            "ratspflichtiger Punkt lebt im selben Moment wieder auf. Keine "
            "Lage mit weniger als zwei automatischen Beerdigungsregeln "
            "jenseits F3 ist ohne neuen Gerichtsbeschluss erreichbar."),
    }


def _drift_sanktion(ledger=LEDGER, b1_modul=B1_MODUL, praereg=PRAEREG):
    """Welche Sanktion traegt ein DRIFT-Bruch JETZT? STOPP ist der Regelfall -
    aber nur, solange beide Bedingungen der Mehrheit halten."""
    wache = beerdigungs_wache(b1_modul=b1_modul, praereg=praereg)
    if not wache["ankerZweigLebt"]:
        return SANKTION_ANKER, (
            "SPERRKLAUSEL VB-A8 GEFEUERT: der ANKER-Zweig loest keine "
            "automatische Beerdigung mehr aus (beobachtet: "
            + repr(wache["regeln"][1]["beobachteteSanktion"]) + "). Der "
            "DRIFT-Zweig springt damit ohne weitere Sitzung auf BEERDIGEN "
            "beim ERSTEN Ausloeser."), wache
    vorlauf, quelle = drift_vorlauf(ledger)
    if vorlauf >= 1:
        return SANKTION_ANKER, (
            "KONTINGENT EINS VERBRAUCHT (VB-A3): " + str(vorlauf) + " "
            "Reparatur-Akt(e) dieses Zweigs stehen bereits im Register ("
            + quelle + "). Das zweite Feuern - gleiche oder andere Ursache - "
            "ist BEERDIGEN, automatisch, ohne weitere Beratung."), wache
    return SANKTION_DRIFT, (
        "Kontingent EINS ist unverbraucht (" + quelle + "). " + STOPP_VOLLZUG), wache


def pruefe_nullpunkt(geladene_liste, praereg=PRAEREG, manifest=MANIFEST,
                     ledger=LEDGER, b1_modul=B1_MODUL):
    """B3', Dauer-Tripwire. Fail-closed, zur LAUFZEIT, nicht als Vorbedingung.

    Geprueft wird nicht "gibt es die Liste", sondern "ist die tatsaechlich
    geladene Liste bit-identisch mit der registrierten". Dieser Fall bleibt fuer
    immer eintretbar - eine reine Vorbedingungs-Regel loest sich auf, sobald man
    sie einmal erfuellt (S1s Konstruktionsauflage, woertlich uebernommen).

    Die Registrierungs-Pruefungen laufen ZUERST und tragen den ANKER-Zweig;
    erst danach kommen die beiden DRIFT-Pruefungen. Das ist keine Reihenfolge
    aus Bequemlichkeit: eine gebrochene Registrierung darf nie als blosse Drift
    durchgehen.
    """
    registriert = registrierte_allowlist(praereg, manifest)
    bruch = None
    if geladene_liste is None:
        bruch = ("zur Laufzeit ist keine Umsatz-Allowlist geladen. Fehlen ist "
                 "kein Sonderfall, sondern der Bruchfall.")
    elif kanonisch(list(geladene_liste)) != kanonisch(registriert):
        bruch = ("die zur Laufzeit geladene Umsatz-Allowlist ist nicht "
                 "bit-identisch mit der registrierten.\n"
                 "  geladen     : " + kanonisch(list(geladene_liste)) + "\n"
                 "  registriert : " + kanonisch(registriert))
    if bruch is None:
        return registriert
    sanktion, begruendung, _wache = _drift_sanktion(
        ledger=ledger, b1_modul=b1_modul, praereg=praereg)
    raise NullpunktBruch(
        sanktion,
        "B3'-DRIFT-ABBRUCH (" + sanktion + "): " + bruch + "\n"
        "Die Registrierung ist unversehrt - das ist der Zweig DRIFT.\n"
        + begruendung)


def zweig_rotproben(praereg=PRAEREG, manifest=MANIFEST, b1_modul=B1_MODUL,
                    datum="2026-08-30"):
    """VB-A2: beide Zweige je einmal absichtlich rot, getrennt, mit Gegenprobe.

    Alles an Wegwerf-Kopien, nie am Produktivobjekt. Der ANKER-Zweig MUSS
    BEERDIGEN ausloesen, nicht STOPP; der DRIFT-Zweig MUSS beim ersten Feuern
    STOPP ausloesen, nicht BEERDIGEN. Die Gegenprobe zeigt, dass der Waechter
    auch schweigen kann - ein Waechter, der immer rot ist, misst nichts.

    Diese Funktion IST der Nachweis: der Bericht wird aus ihrem Lauf gebaut,
    nicht danebengeschrieben.
    """
    import tempfile
    registriert = list(registrierte_allowlist(praereg, manifest))
    proben = []

    def ohne_maschinenpfade(text):
        """R12a: ein Bericht traegt keinen maschinengebundenen Pfad. Die
        Rot-Proben arbeiten unter genau zwei Wurzeln - Scratch und Repo -, und
        die Meldungen der Waechter nennen sie beim Namen. Der Selbsttest
        prueft darunter, dass danach wirklich keiner mehr uebrig ist;
        tests/studie-deckel.test.js prueft es am fertigen Artefakt."""
        for wurzel, marke in ((tempfile.gettempdir(), "<scratch>"),
                              (WURZEL, "<repo>")):
            for form in {wurzel, os.path.realpath(wurzel),
                         wurzel.replace("\\", "/"),
                         os.path.realpath(wurzel).replace("\\", "/")}:
                text = text.replace(form, marke)
        return text

    def probe(zweig, eingriff, erwartet, lauf):
        try:
            lauf()
            beobachtet, text = "KEIN BRUCH", ""
        except NullpunktBruch as exc:
            beobachtet = exc.sanktion
            text = ohne_maschinenpfade(str(exc).split("\n")[0])
        proben.append({
            "zweig": zweig, "datum": datum, "eingriff": eingriff,
            "erwarteteSanktion": erwartet, "beobachteteSanktion": beobachtet,
            "beobachtetesVerhalten": text,
            "traegt": beobachtet == erwartet,
        })

    # -- ANKER, rot: die Registrierung selbst verstellt -----------------------
    with tempfile.TemporaryDirectory() as tmp:
        falsch = os.path.join(tmp, "hash-manifest.json")
        with open(falsch, "w", encoding="utf-8") as fh:
            json.dump({"files": {
                "protocol/early-detection/2.0.0/preregistration.json":
                    "0" * 64}}, fh)
        probe("ANKER", "hash-manifest fuehrt einen fremden Praereg-Hash",
              SANKTION_ANKER,
              lambda: pruefe_nullpunkt(registriert, praereg=praereg,
                                       manifest=falsch, b1_modul=b1_modul))
        kopie = os.path.join(tmp, "preregistration.json")
        roh = lies_json(praereg)
        roh["signalFamily"]["gemeinsameMechanik"]["umsatzQuellenAllowlist"] = ["X"]
        with open(kopie, "w", encoding="utf-8") as fh:
            json.dump(roh, fh)
        probe("ANKER", "die registrierte Praeregistrierung traegt einen "
                       "abweichenden sha256",
              SANKTION_ANKER,
              lambda: pruefe_nullpunkt(registriert, praereg=kopie,
                                       manifest=manifest, b1_modul=b1_modul))

    # -- DRIFT, rot: die geladene Liste weicht ab, Registrierung unversehrt ---
    # Die Vorlauf-Lage wird HEREINGEREICHT, nicht dem Produktivregister
    # entnommen: "erstes Feuern" ist eine Eigenschaft des Zweigs, keine des
    # heutigen Registerstandes. Liefe die Probe gegen das echte Register, wuerde
    # sie nach einem spaeteren, voellig regelkonformen Reparatur-Eintrag rot -
    # ein Fehlalarm, der die Rot-Probe selbst entwertet.
    verstellt = list(registriert)
    verstellt[0] = verstellt[0] + "X"
    with tempfile.TemporaryDirectory() as tmp:
        ohne_vorlauf = os.path.join(tmp, "ledger-ohne-vorlauf.json")
        with open(ohne_vorlauf, "w", encoding="utf-8") as fh:
            json.dump({"events": []}, fh)
        probe("DRIFT", "ein Eintrag der zur Laufzeit geladenen Liste geaendert",
              SANKTION_DRIFT,
              lambda: pruefe_nullpunkt(verstellt, praereg=praereg,
                                       manifest=manifest, ledger=ohne_vorlauf,
                                       b1_modul=b1_modul))
        probe("DRIFT", "zur Laufzeit gar keine Liste geladen", SANKTION_DRIFT,
              lambda: pruefe_nullpunkt(None, praereg=praereg, manifest=manifest,
                                       ledger=ohne_vorlauf, b1_modul=b1_modul))

    # -- DRIFT, zweites Feuern: Kontingent EINS verbraucht -> BEERDIGEN -------
    with tempfile.TemporaryDirectory() as tmp:
        gebraucht = os.path.join(tmp, "ledger.json")
        with open(gebraucht, "w", encoding="utf-8") as fh:
            json.dump({"events": [{"runId": "b3-drift-reparatur-probe",
                                   DRIFT_MARKE: {"ursache": "Probe"}}]}, fh)
        probe("DRIFT", "zweites Feuern bei EINEM registrierten Reparatur-Akt",
              SANKTION_ANKER,
              lambda: pruefe_nullpunkt(verstellt, praereg=praereg,
                                       manifest=manifest, ledger=gebraucht,
                                       b1_modul=b1_modul))
        unlesbar = os.path.join(tmp, "kaputt.json")
        with open(unlesbar, "w", encoding="utf-8") as fh:
            fh.write("{ kein json")
        probe("DRIFT", "Register nicht lesbar (fail-closed)", SANKTION_ANKER,
              lambda: pruefe_nullpunkt(verstellt, praereg=praereg,
                                       manifest=manifest, ledger=unlesbar,
                                       b1_modul=b1_modul))

    # -- Gegenprobe: der Waechter muss auch schweigen koennen -----------------
    probe("BEIDE", "GEGENPROBE - die registrierte Liste unveraendert",
          "KEIN BRUCH",
          lambda: pruefe_nullpunkt(registriert, praereg=praereg,
                                   manifest=manifest, b1_modul=b1_modul))

    wache = beerdigungs_wache(b1_modul=b1_modul, praereg=praereg)
    zweige_rot = {z: any(p["traegt"] for p in proben if p["zweig"] == z)
                  for z in ("ANKER", "DRIFT")}
    # Der HEUTIGE Stand des Kontingents, am Produktivregister gemessen. Reine
    # Berichtsangabe - die Rot-Proben oben haengen bewusst nicht daran.
    vorlauf, vorlauf_quelle = drift_vorlauf()
    return {
        "schema": "studie-vb-a2-zweig-rotproben/v1",
        "auflage": "VB-A2 - _COURT-VIERBANK-OFFEN23-2026-08-30",
        "datum": datum,
        "proben": proben,
        "beideZweigeGetrenntRot": all(zweige_rot.values()),
        "alleProbenTragen": all(p["traegt"] for p in proben),
        "a17": ("Bis beide Zweige getrennt rot waren, gilt B3' nach A17 als "
                "nicht abgeschlossen - und dann steht B3' UNGETEILT auf "
                "BEERDIGEN, nicht auf STOPP."),
        "kettenprobe326": KETTENPROBE_326,
        "produktivVorlauf": {
            "reparaturAkteImRegister": vorlauf,
            "quelle": vorlauf_quelle,
            "bedeutung": ("0 = das Kontingent EINS ist unverbraucht, das "
                          "naechste DRIFT-Feuern ist STOPP. >= 1 = verbraucht, "
                          "das naechste DRIFT-Feuern ist BEERDIGEN."),
        },
        "vba8": wache,
    }


def register_anker(ledger=LEDGER, skript=None):
    """VB-A6: der B3'-Sollwert ist heute in KEINEM Register-Eintrag verankert.

    Kein eigener Akt - die beiden Werte werden im NAECHSTEN Register-Eintrag
    jenseits F3 mitgefuehrt. Diese Funktion baut die mitzufuehrende Nutzlast
    und misst am Objekt, ob sie schon drinsteht. Solange nicht, darf B3' nicht
    als register-verankert zitiert werden - und genau das steht dann hier.
    """
    skript = skript or os.path.abspath(__file__)
    rel = os.path.relpath(skript, WURZEL).replace(os.sep, "/")
    nutzlast = {
        "registriertePraeregSha": REGISTRIERTE_PRAEREG_SHA,
        "waechterDatei": rel,
        "waechterDateiSha256": sha256_datei(skript),
    }
    try:
        roh = json.dumps(lies_json(ledger), ensure_ascii=False)
    except Exception as exc:            # noqa: BLE001 - fail-closed
        roh, lesbar = "", "Register nicht lesbar: " + str(exc)
    else:
        lesbar = "gelesen"
    verankert = bool(roh) and all(w in roh for w in
                                  (nutzlast["registriertePraeregSha"],
                                   nutzlast["waechterDateiSha256"]))
    return {
        "schema": "studie-vb-a6-registeranker/v1",
        "auflage": "VB-A6 - _COURT-VIERBANK-OFFEN23-2026-08-30",
        "nutzlast": nutzlast,
        "register": ledger.replace(os.sep, "/").split("/")[-1],
        "registerStatus": lesbar,
        "registerVerankert": verankert,
        "zitierverbot": (
            "OFFEN" if not verankert else "AUFGEHOBEN - beide Werte stehen im Register"),
        "mechanismus": (
            "Der Sollwert ist eine QUELL-KONSTANTE im Waechter selbst "
            "(REGISTRIERTE_PRAEREG_SHA), keine Manifest-Lesung. Wer Allowlist "
            "und Manifest im selben Commit aendert, macht B3' rot. Die Luecke "
            "sitzt eine Ebene hoeher: " + rel + " steht in keinem "
            "hash-manifest-Tripel und in keinem Register-Eintrag - ein Commit, "
            "der Allowlist, Manifest UND die Waechter-Konstante zugleich "
            "verstellt, macht B3' stumm. Kanzlei-Befund §0.3."),
        "vollzug": (
            "KEIN eigener Akt, kein zusaetzlicher Eintrag: die Nutzlast wird "
            "im naechsten Register-Eintrag jenseits F3 mitgefuehrt. Bis dahin "
            "darf B3' NICHT als register-verankert zitiert werden."),
    }


# =============================================================================
# 3. OFFEN-1 - der B2-Trockenlauf
# =============================================================================

def lade_basisraten():
    spec = importlib.util.spec_from_file_location("studie_basisraten", BASISRATEN)
    modul = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(modul)
    return modul


def quellen_aus_konzeptliste(pfad=KONZEPTLISTE_2_1_0):
    """Die vier neuen Kennungen der Verbreiterung, in Listenreihenfolge."""
    liste = lies_json(pfad).get("konzeptliste") or []
    return tuple((e["concept"], (e["concept"],)) for e in liste)


def geladene_allowlist(e2):
    """Die Liste, die der Zaehlcode ZUR LAUFZEIT wirklich faehrt.

    Das ist `UMSATZ_QUELLEN` in scripts/studie-basisraten.py - der versiegelten
    Datei, aus der `firmenreihen` seine Quellen bezieht. Frueher las diese
    Stelle die Liste erneut aus derselben preregistration.json, gegen die
    B3' sie dann verglich: ein Vergleich einer Datei mit sich selbst, der eine
    Drift zwischen Code und Protokoll nie haette sehen koennen.
    """
    return [name for name, _tags in e2.UMSATZ_QUELLEN]


def kunst_je_firma(firmen):
    """{cik: {(tag, uom): {(ddate, qtrs): (accepted, value)}}} - die Form, die
    `pit_reduktion` liefert. Fuer den Trockenlauf gebaut, nie aus einem Panel."""
    je_firma = {}
    for cik, tag, werte in firmen:
        reihe = {}
        for ddate, wert in werte:
            reihe[(ddate, "1")] = (ddate[:4] + "-01-01 00:00:00.0", float(wert))
        je_firma.setdefault(cik, {})[(tag, "USD")] = reihe
    return je_firma


def b2_trockenlauf(je_firma=None, praereg=PRAEREG, manifest=MANIFEST,
                   konzeptliste=KONZEPTLISTE_2_1_0):
    """Ausfuehrbarkeits-Beweis fuer V2'. Kein Verhaeltnis, keine Reifequote.

    `je_firma` ist ein Trockenlauf-Bestand; die Populations-Fallzahl der
    eintretenden Kohorte wird hier NICHT gemessen - das waere die Zaehlprobe
    der Verbreiterung und damit F4.
    """
    from collections import defaultdict

    e2 = lade_basisraten()
    # B3' zuerst, und gegen die geladene Konstante - nicht gegen eine zweite
    # Lesung derselben Datei. Erst wenn Code und Registrierung bit-identisch
    # sind, darf mit dem Code gerechnet werden.
    pruefe_nullpunkt(geladene_allowlist(e2), praereg, manifest)
    referenz_quellen = e2.UMSATZ_QUELLEN
    neue_quellen = quellen_aus_konzeptliste(konzeptliste)

    ueberschneidung = sorted(
        set(t for _, tags in referenz_quellen for t in tags)
        & set(t for _, tags in neue_quellen for t in tags))

    if je_firma is None:
        je_firma = kunst_je_firma(_trockenbestand(referenz_quellen, neue_quellen))

    kohorten = {}
    for schluessel, quellen in (("referenz", referenz_quellen),
                                ("eintretend", neue_quellen)):
        zaehler = defaultdict(int)
        # DIESELBE Funktion, DERSELBE Bestand - nur `quellen` unterscheidet
        # sich. Genau das ist "in derselben Geometrie bestimmbar".
        _alle, gewaehlt = e2.firmenreihen(je_firma, quellen, True, zaehler, schluessel + "_")
        kohorten[schluessel] = {
            "quellen": [name for name, _ in quellen],
            "firmenMitAuswertbarerReihe": len(gewaehlt),
            "firmenOhneQuelle": zaehler[schluessel + "_firma_ohne_quelle"],
            "ciks": sorted(gewaehlt),
        }

    # Disjunktheit: `reiner_fallback` heisst, eine Firma tritt nur ueber die
    # neuen Kennungen ein, wenn sie unter der Allowlist KEINE Reihe hat.
    nur_neu = sorted(set(kohorten["eintretend"]["ciks"])
                     - set(kohorten["referenz"]["ciks"]))
    kohorten["eintretend"]["nurUeberNeueKennung"] = nur_neu

    geometrie_traegt = (kohorten["referenz"]["firmenMitAuswertbarerReihe"] > 0
                        and kohorten["eintretend"]["firmenMitAuswertbarerReihe"] > 0
                        and not ueberschneidung)

    bericht = {
        "schema": "studie-rr9-b2-trockenlauf/v1",
        "auflage": ("OFFEN-1 aus _COURT-RR9-2026-08-30, entschieden vom "
                    "Orchestrator (ENTSCHIED 127) - F4-Startgate-Artefakt"),
        "frage": ("Ist V2' ueberhaupt ausfuehrbar - beide Kohorten in DERSELBEN "
                  "Geometrie bestimmbar?"),
        "geometrie": {
            "funktion": "scripts/studie-basisraten.py::firmenreihen",
            "identischerCodepfad": True,
            "unterschied": ("ausschliesslich der Parameter `quellen`; Bestand, "
                            "Positivitaets-Filter und Reihenbildung sind gleich"),
            "quellenUeberschneidung": ueberschneidung,
        },
        "bestand": ("SYNTHETISCH - Kunst-Firmen aus _trockenbestand(), kein "
                    "Panel. Die `ciks` und `firmenMitAuswertbarerReihe` unten "
                    "sind KEINE gemessenen Populationszahlen; sie beantworten "
                    "allein die Frage, ob der Codepfad beide Kohorten traegt."),
        "kohorten": kohorten,
        "fallzahlSchwelle": FALLZAHL_SCHWELLE,
        "fallzahlDerReferenzkohorte": {
            "quelle": "reports/studie/E3-zaehlprobe-pruefung-2026-08-19.json",
            "art": "bereits registriert und veroeffentlicht - hier nur zitiert",
            "S-U": 292,
            "S-G": 326,
            "ueberDerSchwelle": True,
        },
        "fallzahlDerEintretendenKohorte": {
            "status": "UNGEMESSEN",
            "grund": ("Ihre Messung IST die Zaehlprobe der Verbreiterung und "
                      "damit F4. Register-Eintrag 21 sagt woertlich, dass "
                      "dieser Vorgang einen eigenen Eintrag braucht. Dieser "
                      "Trockenlauf misst sie deshalb nicht."),
        },
        "verhaeltnis": {
            "gerechnet": False,
            "warumStrukturellUnmoeglich": (
                "Dieser Lauf ruft ausschliesslich `firmenreihen` auf. Es "
                "entsteht an keiner Stelle eine Reifequote - weder "
                "`erst_ereignisse` noch `arm_zaehlen` noch `ampel_fuer` werden "
                "geladen. Wo keine Quote entsteht, kann kein Verhaeltnis "
                "gebildet werden; es wird nicht uebersprungen, es ist nicht da."),
        },
        "ausfuehrbar": geometrie_traegt,
        "gateSatz": (
            "V2' ist in derselben Geometrie ausfuehrbar: beide Kohorten "
            "entstehen aus demselben Bestand durch dieselbe Funktion, "
            "unterschieden nur durch den Quellen-Parameter."
            if geometrie_traegt else STOPPSATZ),
    }
    return bericht


def _trockenbestand(referenz_quellen, neue_quellen):
    """Sechs Kunst-Firmen: zwei mit Allowlist-Kennung, zwei nur mit neuer
    Kennung, zwei ohne jede der beiden. Der Bestand ist die Probe, nicht die
    Population - er beantwortet die Frage 'geht das ueberhaupt'."""
    werte = [("2013" + q, 100 + i * 10) for i, q in
             enumerate(("0331", "0630", "0930", "1231"))]
    werte += [("2014" + q, 150 + i * 10) for i, q in
              enumerate(("0331", "0630"))]
    ref_tag = referenz_quellen[0][1][0]
    neu_tag = neue_quellen[0][1][0]
    return [
        ("0000000001", ref_tag, werte),
        ("0000000002", ref_tag, werte),
        ("0000000003", neu_tag, werte),
        ("0000000004", neu_tag, werte),
        ("0000000005", "GanzAndereKennung", werte),
        ("0000000006", "NochEineAndere", werte),
    ]


# =============================================================================
# Selbsttest
# =============================================================================

def selbsttest():
    import copy
    import io
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

    # -- Provenienz -----------------------------------------------------------
    p = provenienz()
    pruefe("Provenienz: das Tripel ist seit dem Siegeln unveraendert",
           p["tripelUnveraendertSeitDemSiegeln"])
    pruefe("Provenienz: der E3-Lauf lief unter genau diesem Tripel",
           p["e3LiefUnterDemTripel"])
    pruefe("Provenienz: der Traeger der 326/365 ist GEMESSEN",
           p["traegerVariante"] is not None)
    pruefe("Provenienz: die Jahrgangs-Kette ist geschlossen",
           p["jahrgangsKette"]["e1Jahrgang"] == "legacy_earliest_archived"
           and p["jahrgangsKette"]["e3LasDieseDatei"])
    pruefe("Provenienz: geschlossen", p["provenienzGeschlossen"])

    # ROT-PROBE Provenienz: ein Manifest mit LEEREM files-Block darf nicht
    # "das Tripel ist unveraendert" melden. `all()` ueber nichts ist wahr -
    # genau diese Vakuum-Wahrheit war hier einmal das Tor.
    with tempfile.TemporaryDirectory() as tmp:
        leer = os.path.join(tmp, "hash-manifest.json")
        with open(leer, "w", encoding="utf-8") as fh:
            json.dump({"files": {}}, fh)
        v = provenienz(manifest=leer)
        pruefe("ROT-PROBE Provenienz: leeres Tripel gilt NICHT als unveraendert",
               v["tripelUnveraendertSeitDemSiegeln"] is False
               and v["e3LiefUnterDemTripel"] is False
               and v["provenienzGeschlossen"] is False)
        # Und ein Tripel mit den richtigen Namen, aber falschem Hash, ebenso.
        falsch = os.path.join(tmp, "hash-manifest-falsch.json")
        with open(falsch, "w", encoding="utf-8") as fh:
            json.dump({"files": {d: "0" * 64 for d in TRIPEL_DATEIEN}}, fh)
        v2 = provenienz(manifest=falsch)
        pruefe("ROT-PROBE Provenienz: falscher Tripel-Hash schliesst nicht",
               v2["tripelVollstaendigUndNamentlich"] is True
               and v2["tripelUnveraendertSeitDemSiegeln"] is False
               and v2["provenienzGeschlossen"] is False)

    # -- B3' Dauer-Tripwire ---------------------------------------------------
    registriert = registrierte_allowlist()
    # Der Tripwire haengt an der Konstante, die der Zaehlcode wirklich faehrt.
    pruefe("B3' vergleicht gegen scripts/studie-basisraten.py::UMSATZ_QUELLEN",
           geladene_allowlist(lade_basisraten()) == list(registriert))
    pruefe("B3': die registrierte Liste geht durch (Anwesenheit)",
           pruefe_nullpunkt(list(registriert)) == registriert)

    # ROT-PROBE: EIN veraenderter Eintrag muss B3' rot machen - Zweig DRIFT.
    verstellt = list(registriert)
    verstellt[0] = verstellt[0] + "X"
    try:
        pruefe_nullpunkt(verstellt)
        pruefe("ROT-PROBE B3'-1: ein geaenderter Eintrag -> DRIFT/STOPP", False)
    except NullpunktBruch as exc:
        pruefe("ROT-PROBE B3'-1: ein geaenderter Eintrag -> DRIFT/STOPP",
               exc.sanktion == SANKTION_DRIFT
               and "nicht bit-identisch" in str(exc))

    # ROT-PROBE: dieselbe Liste in anderer REIHENFOLGE ist nicht bit-identisch.
    try:
        pruefe_nullpunkt(list(reversed(registriert)))
        pruefe("ROT-PROBE B3'-2: umsortierte Liste -> DRIFT/STOPP", False)
    except NullpunktBruch as exc:
        pruefe("ROT-PROBE B3'-2: umsortierte Liste -> DRIFT/STOPP",
               exc.sanktion == SANKTION_DRIFT)

    # ROT-PROBE: gar keine geladene Liste ist der Bruchfall, kein Sonderfall.
    try:
        pruefe_nullpunkt(None)
        pruefe("ROT-PROBE B3'-3: keine geladene Liste -> DRIFT/STOPP", False)
    except NullpunktBruch as exc:
        pruefe("ROT-PROBE B3'-3: keine geladene Liste -> DRIFT/STOPP",
               exc.sanktion == SANKTION_DRIFT)

    # ROT-PROBE: eine verstellte REGISTRIERUNG feuert ebenfalls - der Tripwire
    # haengt am Objekt, nicht nur am Aufrufer. Zweig ANKER, BEERDIGEN.
    with tempfile.TemporaryDirectory() as tmp:
        kopie = os.path.join(tmp, "preregistration.json")
        roh = lies_json(PRAEREG)
        roh["signalFamily"]["gemeinsameMechanik"]["umsatzQuellenAllowlist"] = ["X"]
        with open(kopie, "w", encoding="utf-8") as fh:
            json.dump(roh, fh)
        try:
            pruefe_nullpunkt(list(registriert), praereg=kopie)
            pruefe("ROT-PROBE B3'-4: verstellte Registrierung -> ANKER/BEERDIGEN",
                   False)
        except NullpunktBruch as exc:
            pruefe("ROT-PROBE B3'-4: verstellte Registrierung -> ANKER/BEERDIGEN",
                   exc.sanktion == SANKTION_ANKER
                   and "nicht mehr die registrierte" in str(exc))

    # -- VB-A1/A2/A3/A8: die Spaltung, an den Pruefungen abgelesen ------------
    rp = zweig_rotproben()
    pruefe("VB-A2: beide Zweige sind GETRENNT rot gefahren",
           rp["beideZweigeGetrenntRot"] and rp["alleProbenTragen"])
    pruefe("VB-A1: der ANKER-Zweig loest BEERDIGEN aus, nie STOPP",
           all(p["beobachteteSanktion"] == SANKTION_ANKER
               for p in rp["proben"] if p["zweig"] == "ANKER"))
    pruefe("VB-A3: das ERSTE Feuern des DRIFT-Zweigs ist STOPP",
           any(p["beobachteteSanktion"] == SANKTION_DRIFT
               for p in rp["proben"] if p["zweig"] == "DRIFT"))
    pruefe("VB-A3: das ZWEITE Feuern des DRIFT-Zweigs ist BEERDIGEN",
           any(p["eingriff"].startswith("zweites Feuern")
               and p["beobachteteSanktion"] == SANKTION_ANKER
               for p in rp["proben"]))
    pruefe("VB-A3: ein unlesbares Register ist BEERDIGEN (fail-closed)",
           any(p["eingriff"].startswith("Register nicht lesbar")
               and p["beobachteteSanktion"] == SANKTION_ANKER
               for p in rp["proben"]))
    # ROT-PROBE VB-A3: eine Marke, die eine Ebene tiefer liegt, darf NICHT
    # still ungezaehlt bleiben. Nachgestellt am 30.08. nach dem
    # Silent-Failure-Review: sie lieferte 0 statt fail-closed 1.
    with tempfile.TemporaryDirectory() as tmp:
        for name, ereignis, erwartet in (
            ("verschachtelt", {"runId": "x", "meta": {DRIFT_MARKE: {"ursache": "echt"}}}, 1),
            ("tief verschachtelt",
             {"runId": "x", "a": [{"b": {DRIFT_MARKE: {"ursache": "echt"}}}]}, 1),
            ("oben, wohlgeformt", {"runId": "x", DRIFT_MARKE: {"ursache": "echt"}}, 1),
            ("gar keine Marke", {"runId": "x"}, 0),
        ):
            pfad = os.path.join(tmp, "l.json")
            with open(pfad, "w", encoding="utf-8") as fh:
                json.dump({"events": [ereignis]}, fh)
            pruefe("VB-A3-Zaehlung, Marke " + name + " -> " + str(erwartet),
                   drift_vorlauf(pfad)[0] == erwartet)
    pruefe("GEGENPROBE: der Waechter kann auch schweigen",
           any(p["eingriff"].startswith("GEGENPROBE")
               and p["beobachteteSanktion"] == "KEIN BRUCH"
               for p in rp["proben"]))
    pruefe("VB-A8: jenseits F3 stehen ZWEI automatische Beerdigungsregeln",
           rp["vba8"]["anzahlAutomatischerBeerdigungen"] == 2
           and rp["vba8"]["rot"] is False)

    # ROT-PROBE VB-A8: nimmt man dem ANKER-Zweig die automatische Beerdigung,
    # MUSS die Lage maschinell rot werden UND der DRIFT-Zweig auf BEERDIGEN
    # beim ersten Ausloeser zurueckspringen. Der Eingriff sitzt am Objekt: ein
    # B1'-Modul, dessen Byte-Nichtidentitaet nicht mehr ausloest.
    with tempfile.TemporaryDirectory() as tmp:
        stumm = os.path.join(tmp, "b1-stumm.py")
        with io.open(B1_MODUL, encoding="utf-8", newline="") as fh:
            quelle = fh.read()
        with io.open(stumm, "w", encoding="utf-8", newline="") as fh:
            fh.write(quelle.replace('SANKTION_BEERDIGEN = "BEERDIGEN"',
                                    'SANKTION_BEERDIGEN = "STOPP"', 1))
        w = beerdigungs_wache(b1_modul=stumm)
        pruefe("ROT-PROBE VB-A8: eine fehlende Automatik macht die Lage ROT",
               w["rot"] is True and w["anzahlAutomatischerBeerdigungen"] == 1)

    pruefe("VB-A6: der Sollwert ist heute NICHT register-verankert",
           register_anker()["registerVerankert"] is False)
    pruefe("VB-A7: kein B3'-Ausloeser haengt an 326/365",
           all("326" not in p["beobachtetesVerhalten"] for p in rp["proben"]))
    # R12a: das Artefakt darf keinen maschinengebundenen Pfad tragen. Geprueft
    # am fertigen JSON, nicht an der Absicht des Sanitizers.
    import re as _re
    pruefe("R12a: der Rotproben-Bericht traegt keinen Maschinenpfad",
           not _re.search(r"[A-Za-z]:[\\/]|[\\/]Users[\\/]|/home/",
                          json.dumps(rp, ensure_ascii=False)))

    # -- Jahrgang: der Vergleich muss ueberhaupt abweichen KOENNEN ------------
    j = jahrgangs_registrierung()
    pruefe("Jahrgang: gewaehlt kommt aus dem BAU, gemessen aus dem E1-Bericht",
           j["inhalt"]["gewaehlterJahrgang"] == "legacy_earliest_archived"
           and j["inhalt"]["gemessenerJahrgangDerBasis"] == "legacy_earliest_archived"
           and j["inhalt"]["weichenBeideVoneinanderAb"] is False)
    # ROT-PROBE: weicht der Bau-Jahrgang ab, MUSS der Vergleich das sehen.
    # Frueher stand `gewaehlt = basis_jahrgang` - der Zweig war tot.
    with tempfile.TemporaryDirectory() as tmp:
        kopie = os.path.join(tmp, "studie-panel-bau.py")
        with io.open(PANELBAU, encoding="utf-8", newline="") as fh:
            quelle = fh.read()
        with io.open(kopie, "w", encoding="utf-8", newline="") as fh:
            fh.write(quelle.replace(
                'VARIANTE = "legacy_earliest_archived"',
                'VARIANTE = "post_2024_reprocessed_or_current"', 1))
        j2 = jahrgangs_registrierung(panelbau=kopie)
        pruefe("ROT-PROBE Jahrgang: abweichender Bau-Jahrgang loest A2 Satz 3 aus",
               j2["inhalt"]["weichenBeideVoneinanderAb"] is True
               and j2["a2Satz3"].startswith("AUSGELOEST"))

    # -- B2-Trockenlauf -------------------------------------------------------
    t = b2_trockenlauf()
    pruefe("B2: beide Kohorten tragen Firmen",
           t["kohorten"]["referenz"]["firmenMitAuswertbarerReihe"] > 0
           and t["kohorten"]["eintretend"]["firmenMitAuswertbarerReihe"] > 0)
    pruefe("B2: die Kennungen der beiden Kohorten ueberschneiden sich nicht",
           t["geometrie"]["quellenUeberschneidung"] == [])
    pruefe("B2: die eintretende Kohorte tritt NUR ueber neue Kennungen ein",
           len(t["kohorten"]["eintretend"]["nurUeberNeueKennung"])
           == t["kohorten"]["eintretend"]["firmenMitAuswertbarerReihe"])
    pruefe("B2: identischer Codepfad, Unterschied nur im Quellen-Parameter",
           t["geometrie"]["funktion"].endswith("firmenreihen")
           and t["geometrie"]["identischerCodepfad"])
    pruefe("B2: das Verhaeltnis ist NICHT gerechnet",
           t["verhaeltnis"]["gerechnet"] is False)
    pruefe("B2: der Bericht traegt keinerlei Quoten-Feld",
           not _quotenfelder(t))
    pruefe("B2: die Fallzahl der eintretenden Kohorte bleibt UNGEMESSEN (F4)",
           t["fallzahlDerEintretendenKohorte"]["status"] == "UNGEMESSEN")
    pruefe("B2: die Schwelle 200 steht im Bericht", t["fallzahlSchwelle"] == 200)
    pruefe("B2: Gate-Ergebnis ausfuehrbar", t["ausfuehrbar"] is True)

    # GEGENPROBE zum Gate: faellt eine Kohorte weg, muss der Stoppsatz kommen -
    # und zwar woertlich.
    leer = b2_trockenlauf(je_firma=kunst_je_firma([("0000000009", "Unbekannt",
                                                    [("20130331", 1.0)])]))
    pruefe("ROT-PROBE B2: ohne bestimmbare Kohorten kommt der Stoppsatz woertlich",
           leer["ausfuehrbar"] is False and leer["gateSatz"] == STOPPSATZ)

    # Und der Quoten-Waechter muss selbst rot werden koennen.
    verseucht = copy.deepcopy(t)
    verseucht["kohorten"]["referenz"]["reifequote"] = 0.9
    pruefe("ROT-PROBE B2-Waechter: ein eingeschmuggeltes Quoten-Feld faellt auf",
           _quotenfelder(verseucht) == ["kohorten.referenz.reifequote"])
    # Und ausgerechnet UNTER `verhaeltnis` darf er nicht blind sein - dort
    # uebersprang er frueher die ganze Teilstruktur.
    pruefe("ROT-PROBE B2-Waechter: auch unter `verhaeltnis` wird gesucht",
           _quotenfelder({"verhaeltnis": {"gerechnet": False, "reifequote": 0.9}})
           == ["verhaeltnis.reifequote"])
    pruefe("Gegenprobe: der Block `verhaeltnis` selbst gilt nicht als Treffer",
           _quotenfelder({"verhaeltnis": {"gerechnet": False}}) == [])
    pruefe("B2: der Bestand ist als SYNTHETISCH gekennzeichnet",
           t["bestand"].startswith("SYNTHETISCH"))

    print("selbsttest: %d ok, %d FAIL" % (ok, fehl))
    return 0 if fehl == 0 else 1


VERBOTENE_TEILE = ("quote", "rate", "verhaeltnis", "ratio", "auffindbarkeit",
                   "reife", "ampel")
# Genau ein Pfad darf den verbotenen Wortstamm im Namen tragen: der Block, der
# die Abwesenheit selbst beurkundet. Sein INHALT wird trotzdem durchsucht.
ERLAUBTE_QUOTENPFADE = ("verhaeltnis",)


def _quotenfelder(baum, pfad=""):
    """Der Blindheits-Waechter: JEDES Feld, dessen Name nach einer Quote oder
    einem Verhaeltnis klingt. `verhaeltnis.gerechnet=False` ist die einzige
    erlaubte Ausnahme, weil sie die Abwesenheit selbst beurkundet."""
    treffer = []
    if isinstance(baum, dict):
        for name, wert in baum.items():
            voll = (pfad + "." + name) if pfad else name
            # NUR der Block-Name selbst ist ausgenommen, nicht sein Inhalt.
            # Frueher stand hier ein `continue`, das die ganze Teilstruktur
            # uebersprang - ein `verhaeltnis.reifequote` waere unentdeckt
            # geblieben, ausgerechnet unter dem Schluessel, der die Abwesenheit
            # beurkundet.
            if voll not in ERLAUBTE_QUOTENPFADE and any(
                    teil in name.lower() for teil in VERBOTENE_TEILE):
                treffer.append(voll)
            treffer.extend(_quotenfelder(wert, voll))
    elif isinstance(baum, list):
        for i, wert in enumerate(baum):
            treffer.extend(_quotenfelder(wert, pfad + "[" + str(i) + "]"))
    return treffer


def schreibe_ziel(a, bericht):
    """Schreibt den Bericht nach --ziel, falls gesetzt.

    Als eigene Funktion, damit auch der ROTE Ausgang ihn schreibt: frueher
    stand der Schreibvorgang hinter einem `return`, und ausgerechnet im
    Schadensfall - wenn eine Rot-Probe nicht traegt - entstand keine Datei.
    """
    if not getattr(a, "ziel", None):
        return
    with open(a.ziel, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(bericht, fh, ensure_ascii=False, indent=1, sort_keys=True)
        fh.write("\n")
    print("Bericht     : " + a.ziel)


def main(argv=None):
    p = argparse.ArgumentParser(description="RR9-A2 (B3') und der B2-Trockenlauf")
    unter = p.add_subparsers(dest="befehl", required=True)
    pr = unter.add_parser("provenienz")
    pr.add_argument("--ziel")
    pr.add_argument("--panel-wurzel", help="nur fuer die Byte-Gegenprobe der Panel-Datei")
    ja = unter.add_parser("jahrgang")
    ja.add_argument("--ziel")
    ja.add_argument("--panel-wurzel")
    tw = unter.add_parser("tripwire")
    tw.add_argument("--liste", help="JSON-Datei mit der zur Laufzeit geladenen Liste")
    b2 = unter.add_parser("b2-trockenlauf")
    b2.add_argument("--ziel")
    zr = unter.add_parser("zweig-rotproben")
    zr.add_argument("--ziel")
    ra = unter.add_parser("register-anker")
    ra.add_argument("--ziel")
    unter.add_parser("selbsttest")
    a = p.parse_args(argv)

    if a.befehl == "selbsttest":
        return selbsttest()
    try:
        if a.befehl == "provenienz":
            bericht = provenienz(panel_wurzel=a.panel_wurzel)
            print(bericht["befund"])
            print("Traeger-Variante : " + repr(bericht["traegerVariante"])
                  + "  Groesse: " + repr(bericht["traegerGroesse"]))
            print("Jahrgang         : "
                  + repr(bericht["jahrgangsKette"]["e1Jahrgang"]))
        elif a.befehl == "jahrgang":
            bericht = jahrgangs_registrierung(panel_wurzel=a.panel_wurzel)
            print("gewaehlt  : " + repr(bericht["inhalt"]["gewaehlterJahrgang"]))
            print("Basis     : " + repr(bericht["inhalt"]["gemessenerJahrgangDerBasis"]))
            print("sha256    : " + bericht["inhaltSha256"])
            print("A2 Satz 3 : " + bericht["a2Satz3"])
            print("Eskalation: " + bericht["eskalationNachZiffer6"])
            print("Register  : " + bericht["registerHinweis"])
        elif a.befehl == "tripwire":
            liste = (lies_json(a.liste) if a.liste
                     else geladene_allowlist(lade_basisraten()))
            pruefe_nullpunkt(liste)
            print("B3' ok: die zur Laufzeit geladene Allowlist ist "
                  "bit-identisch mit der registrierten (" + kanonisch(liste)
                  + ")")
            print("  geladen aus: "
                  + ("--liste " + a.liste if a.liste
                     else "scripts/studie-basisraten.py::UMSATZ_QUELLEN"))
            return 0
        elif a.befehl == "zweig-rotproben":
            bericht = zweig_rotproben()
            for probe in bericht["proben"]:
                print(("ok   " if probe["traegt"] else "FAIL ")
                      + probe["zweig"] + ": " + probe["eingriff"] + " -> "
                      + probe["beobachteteSanktion"])
            print("beide Zweige getrennt rot : "
                  + str(bericht["beideZweigeGetrenntRot"]))
            print("VB-A8 automatische Beerdigungen jenseits F3 : "
                  + str(bericht["vba8"]["anzahlAutomatischerBeerdigungen"])
                  + " von " + str(bericht["vba8"]["sollAnzahl"])
                  + ("  ROT" if bericht["vba8"]["rot"] else "  ok"))
            if not (bericht["alleProbenTragen"] and not bericht["vba8"]["rot"]):
                # Der Bericht wird AUCH im roten Fall geschrieben - gerade dann
                # ist er der Gegenstand, den jemand lesen muss. Frueher stand
                # hier ein blankes `return`, und genau im Schadensfall entstand
                # keine Datei.
                schreibe_ziel(a, bericht)
                return EXIT_B3
        elif a.befehl == "register-anker":
            bericht = register_anker()
            print("Praereg-Sollwert : "
                  + bericht["nutzlast"]["registriertePraeregSha"])
            print("Waechter-Datei   : " + bericht["nutzlast"]["waechterDatei"]
                  + "  sha256 " + bericht["nutzlast"]["waechterDateiSha256"])
            print("register-verankert : " + str(bericht["registerVerankert"]))
            print("Zitierverbot       : " + bericht["zitierverbot"])
        else:
            bericht = b2_trockenlauf()
            print("ausfuehrbar : " + str(bericht["ausfuehrbar"]))
            print("Gate        : " + bericht["gateSatz"])
            print("Referenz    : n(registriert, E3) S-U 292 / S-G 326 gegen "
                  "Schwelle " + str(bericht["fallzahlSchwelle"]))
            print("Eintretend  : n "
                  + bericht["fallzahlDerEintretendenKohorte"]["status"]
                  + " - " + bericht["fallzahlDerEintretendenKohorte"]["grund"])
            print("Verhaeltnis : nicht gerechnet, strukturell nicht bildbar")
        schreibe_ziel(a, bericht)
        return 0
    except NullpunktBruch as exc:
        print(str(exc), file=sys.stderr)
        # VB-A1: zwei Zweige, zwei Ausgaenge. EXIT_B3 (5) bleibt BEERDIGEN -
        # die bestehende Maschinerie ist unveraendert; der neue Ausgang 6 ist
        # der gesenkte DRIFT-Zweig. Wer beide gleich behandelt, hat die
        # Spaltung nicht vollzogen.
        return EXIT_B3_STOPP if exc.sanktion == SANKTION_DRIFT else EXIT_B3


if __name__ == "__main__":
    sys.exit(main())

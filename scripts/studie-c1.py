#!/usr/bin/env python3
"""C1 — die Zeitleisten je Thema, ausgefuehrt.

Die SACHE, die dieses Skript schuetzt: ein Datum ohne Beleg sieht in einer Tabelle
genauso aus wie ein belegtes. Deshalb traegt hier JEDES Datum die Pruefsumme der
Rohantwort, aus der es stammt - und jede Stelle, an der ein Datum ohne Beleg
entstehen koennte, haelt an statt zu schaetzen.

Die zweite SACHE: Rueckblick-Wissen. Alle 26 Themen laufen durch dieselbe
geschlossene Sondenliste, dieselbe Abfrageform, dieselbe Ankerregel. Es gibt keinen
Handgriff, der nur bei einem Thema stattfindet - auch nicht bei den bekannten.

Regeltext: protocol/strang-c/C1-regel.md (mit diesem Skript zusammen eingefroren).
Werkzeug-Deckel R14c: Python-Standardbibliothek. R12a: kein absoluter Pfad im Code.

Befehle (in dieser Reihenfolge):
  freeze1      Regeltext + Skript hashen, Eintrag ans Zugriffs-Register
  kurve        D(Phrase, Jahr) fuer 2001-2025 aus der EDGAR-Volltextsuche
  ereignisse   die vier externen Sonden (OpenAlex, Crossref, Wikipedia, Federal Register)
  fuehrung     Kontextfenster der acht fruehesten 10-K-Nennungen je Thema
  ableiten     Zeitleisten bauen, C0-Anker pruefen, Fuehrungs-Dateien schreiben
  freeze2      Buendel-Hash ueber die Ausgabe, Eintrag ans Zugriffs-Register
  pruefen      Waechter: Buendel, C0-Anker, Belegpflicht, Vollstaendigkeit
  selbsttest   Rechen-Selbsttest der Ableitungen, jede Pruefung in beide Richtungen
"""

import hashlib
import html as htmlmod
import importlib.util
import json
import os
import re
import sys
import urllib.parse
from datetime import datetime, timezone

WURZEL = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROTO = os.path.join(WURZEL, "protocol", "strang-c")
REGEL = os.path.join(PROTO, "C1-regel.md")
FREEZE1 = os.path.join(PROTO, "C1-freeze1.json")
FREEZE2 = os.path.join(PROTO, "C1-freeze2.json")
ZEITLEISTEN = os.path.join(PROTO, "C1-zeitleisten.json")
FUEHRUNG_DIR = os.path.join(PROTO, "c1-fuehrung")
KANDIDATEN_DIR = os.path.join(PROTO, "c1-kandidaten")
C0_THEMEN = os.path.join(PROTO, "C0-themenliste.json")
FREIGABE = os.path.join(WURZEL, "reports", "studie", "C1-freigabe.json")

# Regel-Parameter. Sie stehen hier EINMAL und sind mit dem Skript eingefroren.
JAHRE = list(range(2001, 2026))          # EDGAR-Volltext ab 2001; 2026 unvollstaendig
BASIS_ABSTAND = 3                        # derselbe Abstand wie C0
FUEHRUNG_N = 8                           # Zahl der fruehesten Nennungen je Thema
FENSTER = 400                            # Kontextfenster in Zeichen, je Seite
VERZEHNFACHUNG = 10.0
VERDOPPLUNG = 2.0
KIPP_ANTEIL = 0.5
CROSSREF_ZEILEN = 1000                   # Relevanz-Fenster
CROSSREF_ALT_ZEILEN = 200                # zusaetzliches Aeltestes-zuerst-Fenster
KANDIDATEN_JE_SONDE = 5
DOK_HOECHSTENS = 3                       # Dokumente je Filing, bis die Phrase gefunden ist
QUELLEN_UNTERGRENZE = {"openalex": None, "crossref": None, "wikipedia": 2001,
                       "edgar": 2001, "fedreg": 1994}
EBENE = {"openalex": "fachlich", "crossref": "fachlich",
         "wikipedia": "oeffentlich", "edgar": "oeffentlich", "fedreg": "oeffentlich"}
NICHT_BELEGBAR = "NICHT BELEGBAR"

ANBIETER_SIGNALE = ["we offer", "we provide", "we sell", "we develop", "we market",
                    "we design", "we launch", "we introduce", "we manufacture",
                    "our products", "our solutions", "our platform", "our offerings",
                    "our services"]
ANWENDER_SIGNALE = ["we use", "we utilize", "we utilise", "we deploy", "we adopt",
                    "we implement", "we have implemented", "we rely on", "our use of",
                    "we leverage"]


class Bruch(Exception):
    """Fail-closed: alles, was die Regel verletzen wuerde, haelt an."""


def lade_c0():
    """Die Zaehlmaschine wird IMPORTIERT, nicht nachgebaut. Eine zweite Zaehlung
    waere eine zweite Wahrheit - und der C0-Anker koennte dann nicht mehr beweisen,
    dass beide dasselbe messen."""
    pfad = os.path.join(WURZEL, "scripts", "studie-c0.py")
    spec = importlib.util.spec_from_file_location("studie_c0", pfad)
    modul = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(modul)
    return modul


C0 = lade_c0()


def jetzt():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def sha256(daten):
    return hashlib.sha256(daten).hexdigest()


def dateihash(pfad):
    with open(pfad, "rb") as f:
        return sha256(f.read())


def lies_json(pfad):
    with open(pfad, "r", encoding="utf-8") as f:
        return json.load(f)


def schreib_json(pfad, obj, einrueckung=1):
    C0.schreib_atomar(pfad, json.dumps(obj, ensure_ascii=False, indent=einrueckung,
                                       sort_keys=False) + "\n")


# ── Themen und Phrasen ────────────────────────────────────────────────────────

def _dateiname(text):
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def themen():
    """Alle 26 C0-Themen, unveraendert. Reihenfolge und Zahl sind Pflicht: waer hier
    ein Thema herausfiele, waere genau die Rueckblick-Auswahl passiert, die C0
    ausgeschlossen hat."""
    liste = lies_json(C0_THEMEN)["themen"]
    aus = []
    for t in liste:
        if t.get("herkunft") == "MANDAT":
            leit = t["thema"].lower()
            begriffe = [leit]
        else:
            leit = t["thema"]
            begriffe = list(t.get("begriffe") or [])
            if leit not in begriffe:
                raise Bruch("Thema %r fuehrt seinen eigenen Namen nicht in 'begriffe' - "
                            "die Leitphrase waere geraten" % t["thema"])
        aus.append({"thema": t["thema"], "herkunft": t.get("herkunft"),
                    "leitphrase": leit, "begriffe": begriffe,
                    "c0SpikeJahr": t.get("spikeJahr"), "c0D": t.get("D")})
    namen = [_dateiname(t["thema"]) for t in aus]
    if len(set(namen)) != len(namen):
        raise Bruch("Zwei Themen haetten denselben Dateinamen - eins wuerde das andere "
                    "ueberschreiben")
    if len(aus) != 26:
        raise Bruch("C0 fuehrt %d Themen statt 26 - die Themenmenge ist nicht die "
                    "eingefrorene" % len(aus))
    return aus


def alle_phrasen():
    aus = []
    for t in themen():
        for b in t["begriffe"]:
            if b not in aus:
                aus.append(b)
    return aus


# ── Regelstand und Freigabe (R1) ──────────────────────────────────────────────

def pruefe_regelstand(was):
    """Verweigert jeden Rechenschritt, dessen Regelstand vom FREEZE-1-Siegel abweicht.
    Geprueft werden Regeltext UND Skript - die Regel lebt in beidem: Zeitraum,
    Fenstergroesse und Signallisten sind Konstanten IM PROGRAMM."""
    if not os.path.exists(FREEZE1):
        raise Bruch("Kein FREEZE 1 - '%s' ist ohne eingefrorene Regel nicht erlaubt" % was)
    freeze = lies_json(FREEZE1)
    soll = dict(z.rsplit("  ", 1) for z in freeze["buendel"])
    for name, pfad in (("protocol/strang-c/C1-regel.md", REGEL),
                       ("scripts/studie-c1.py", os.path.abspath(__file__))):
        if name not in soll:
            raise Bruch("FREEZE 1 fuehrt %s nicht - das Siegel ist unvollstaendig" % name)
        ist = dateihash(pfad)
        if ist != soll[name]:
            raise Bruch("%s weicht vom FREEZE-1-Siegel ab (%s statt %s) - "
                        "'%s' haelt an" % (name, ist[:16], soll[name][:16], was))


def pruefe_freigabe(was):
    """R1: ohne bestaetigte Vorab-Anmeldung auf dem Server wird nicht gemessen.

    Geprueft wird gegen die SERVER-Uhr aus der Freigabe-Datei, nicht gegen die
    lokale Anmeldezeit. Fehlt die Datei, passt die Kennung nicht oder liegt der
    freigegebene Zugriffszeitpunkt noch in der Zukunft, haelt der Lauf an."""
    if not os.path.exists(FREIGABE):
        raise Bruch("Keine Server-Bestaetigung (%s fehlt) - '%s' misst nicht"
                    % (os.path.relpath(FREIGABE, WURZEL), was))
    frei = lies_json(FREIGABE)
    freeze = lies_json(FREEZE1)
    if frei.get("runId") != freeze.get("runId"):
        raise Bruch("Die Freigabe gilt fuer %r, das Siegel fuer %r"
                    % (frei.get("runId"), freeze.get("runId")))
    for feld in ("serverConfirmedAt", "accessedAt", "registeredAt"):
        if not frei.get(feld):
            raise Bruch("Die Freigabe traegt kein %s" % feld)
    bestaetigt = C0.zeitpunkt(frei["serverConfirmedAt"])
    zugriff = C0.zeitpunkt(frei["accessedAt"])
    if C0.zeitpunkt(frei["registeredAt"]) >= bestaetigt:
        raise Bruch("Die Anmeldung liegt nicht vor der Server-Bestaetigung")
    if zugriff < bestaetigt:
        raise Bruch("Der freigegebene Zugriffszeitpunkt liegt vor der Server-Bestaetigung")
    if datetime.now(timezone.utc) < zugriff:
        raise Bruch("Der freigegebene Zugriffszeitpunkt (%s) ist noch nicht erreicht"
                    % frei["accessedAt"])
    return frei


def bereit(was):
    pruefe_regelstand(was)
    pruefe_freigabe(was)


# ── Befehl: freeze1 ───────────────────────────────────────────────────────────

def buendel1():
    return C0.buendelhash([
        ("protocol/strang-c/C1-regel.md", dateihash(REGEL)),
        ("scripts/studie-c1.py", dateihash(os.path.abspath(__file__))),
    ])


def wert(argv, name):
    if "--" + name not in argv:
        raise Bruch("Argument --%s fehlt" % name)
    return argv[argv.index("--" + name) + 1]


def befehl_freeze1(argv):
    runid = wert(argv, "runid")
    zugriff_ab = wert(argv, "zugriff-ab")
    # Ein zweiter Regelstand am selben Tag ist eine Sache, die ein Pruefer sehen muss.
    # Deshalb steht die Ersetzung IM Register, nicht nur im Bericht.
    ersetzt = argv[argv.index("--ersetzt") + 1] if "--ersetzt" in argv else None
    if C0.zeitpunkt(zugriff_ab) <= datetime.now(timezone.utc):
        raise Bruch("--zugriff-ab liegt nicht in der Zukunft - eine Anmeldung, die den "
                    "Zugriff schon erlaubt, ist ein Nachher-Protokoll")
    gesamt, zeilen = buendel1()
    schreib_json(FREEZE1, {
        "schema": "strang-c-freeze/v1", "stufe": "C1_FREEZE_1", "runId": runid,
        "erzeugtAm": jetzt(), "buendelSha256": gesamt, "buendel": zeilen,
        "ersetzt": ersetzt,
        "bedeutung": "Regeltext und Werkzeug von C1, eingefroren vor der ersten Messung.",
    })
    gesamt2, zeilen2 = buendel1()
    if gesamt2 != gesamt:
        raise Bruch("Das Siegel beschreibt nicht den Stand im Arbeitsbaum")
    eintrag = C0.haenge_an_register({
        "runId": runid,
        "typ": "C1_REGELFREEZE",
        "registeredAt": jetzt(),
        "accessedAt": zugriff_ab,
        "fenster": ["kein Studienfenster - lebende Fremdquellen, kein Kursdatum"],
        "allowedOutputs": ["firmenzahl_je_jahr", "filer_liste", "ereignis_datum",
                           "quellen_pruefsumme", "kontextfenster", "rolle"],
        "erlaubt": "Zaehlung eindeutiger CIKs in 10-K-Volltexten je Jahr sowie datierte "
                   "Ereignis-Kandidaten aus arXiv, Crossref, Wikipedia und Federal "
                   "Register; Kontextfenster um die Themenphrase aus einzelnen "
                   "SEC-Filing-Dokumenten.",
        "verboten": "Jeder Kurs-, Rendite-, Marktwert-, Marktkapitalisierungs- oder "
                    "Volumenwert; jeder Zugriff auf den versiegelten SEC-Speicher oder "
                    "auf Schluesselmaterial; jede Aenderung an den C0-Siegeln.",
        "begruendung": ("C1 Strang C - Zeitleisten je Thema. Buendel-SHA-256 %s ueber "
                        "Regeltext und Werkzeug." % gesamt)
                       + ("" if not ersetzt else
                          " Ersetzt die Anmeldung %s: zwei unabhaengige Code-Reviews "
                          "fanden vier Stellen, an denen das Werkzeug still etwas "
                          "anderes tat als der Regeltext sagt. Kein Schwellenwert, "
                          "kein Zeitraum, keine Sonde, keine Fenstergroesse veraendert; "
                          "der Zaehlpfad (befehl_kurve, fruehste_filer, beleg_je_filer, "
                          "alle_phrasen) ist byte-gleich." % ersetzt),
        "endtestSiegel": "unberuehrt - C1 fasst den versiegelten Speicher nicht an.",
    })
    print(json.dumps({"runId": runid, "buendelSha256": gesamt,
                      "eventHash": eintrag["eventHash"],
                      "registeredAt": eintrag["registeredAt"],
                      "accessedAt": zugriff_ab}, ensure_ascii=False, indent=1))
    return 0


# ── Rohbytes holen (R7) ───────────────────────────────────────────────────────

def hole_und_siegle(unter, url, mindestabstand=0.35, versuche=3, wartezeit=3.0,
                    protokoll=None, hoechstens=None):
    """Holt eine URL, versiegelt die Rohbytes und gibt (bytes, hash) zurueck.
    Ein 404 ist ein Ergebnis (None), jeder andere Fehlschlag fliegt - eine Luecke
    muss als Luecke sichtbar werden, nie als leeres Ergebnis."""
    rohbytes, status = C0.hole(url, mindestabstand=mindestabstand, versuche=versuche,
                               wartezeit=wartezeit)
    if rohbytes is None:
        return None, None, status
    if hoechstens is not None and len(rohbytes) > hoechstens:
        raise Bruch("Antwort auf %s ist %d Bytes gross (Deckel %d)"
                    % (url, len(rohbytes), hoechstens))
    h = C0.versiegle(unter, rohbytes)
    if protokoll is not None:
        protokoll.write(json.dumps({"url": url, "sha256": h, "bytes": len(rohbytes),
                                    "status": status, "geholtAm": jetzt()},
                                   ensure_ascii=False) + "\n")
        protokoll.flush()
    return rohbytes, h, status


def rohpfad(name):
    return os.path.join(C0.rohordner("."), name)


# ── Befehl: kurve ─────────────────────────────────────────────────────────────

def kurve_pfad():
    return rohpfad("C1-kurve.jsonl")


def c1_query_log():
    """Ein EIGENES Abfrage-Protokoll. C0s Protokoll steht im FREEZE-2-Buendel von C0;
    wer daran anhaengt, bricht ein fremdes Siegel."""
    return rohpfad("C1-query-log.jsonl")


def fruehste_filer(filer, n):
    """Die n fruehesten Nennungen, deterministisch sortiert. Ohne feste Sortierung
    haengt 'wer war zuerst' an der Reihenfolge der EDGAR-Antwort."""
    einmalig = {}
    for f in filer:
        schluessel = (f["cik"], f["adsh"])
        if schluessel not in einmalig:
            einmalig[schluessel] = f
    geordnet = sorted(einmalig.values(), key=lambda f: (f["datum"] or "9999-99-99",
                                                        f["cik"], f["adsh"] or ""))
    return geordnet[:n]


def beleg_je_filer(satz, ausgewaehlt):
    """Welche versiegelte Antwortseite trug diese Nennung? Ohne diese Zuordnung waere
    der Beleg eines Ereignis-Datums nur 'irgendeine Seite dieses Jahres' - und ein
    Pruefer koennte ihn nicht nachschlagen. Gelesen wird lokal aus dem Siegel, nicht
    neu geholt."""
    offen = {(f["cik"], f["adsh"]): f for f in ausgewaehlt}
    for h in satz.get("antworten") or []:
        if not offen:
            break
        antwort = json.loads(C0.entsiegle("edgar", h).decode("utf-8", "replace"))
        teil, _ = C0.filer_aus(antwort)
        for f in teil:
            treffer = offen.pop((f["cik"], f["adsh"]), None)
            if treffer is not None:
                treffer["belegSha256"] = h
    for f in ausgewaehlt:
        if not f.get("belegSha256"):
            raise Bruch("Nennung %s/%s hat keine versiegelte Belegseite - ein Datum "
                        "ohne Beleg" % (f["cik"], f["adsh"]))
    return ausgewaehlt


def befehl_kurve(_argv):
    bereit("kurve")
    phrasen = alle_phrasen()
    noetig = [(p, j) for p in phrasen for j in JAHRE]
    fertig = C0.gelesen(kurve_pfad(), lambda s: (s["phrase"], s["jahr"]))
    offen = [k for k in noetig if k not in fertig]
    protokoll = open(c1_query_log(), "a", encoding="utf-8", newline="\n")
    ausgabe = open(kurve_pfad(), "a", encoding="utf-8", newline="\n")
    try:
        for i, (phrase, jahr) in enumerate(offen, 1):
            satz = C0.exakt_zaehlen(phrase, jahr, protokoll)
            satz["fruehesteFiler"] = beleg_je_filer(
                satz, fruehste_filer(satz["filer"], FUEHRUNG_N))
            satz.pop("filer", None)
            ausgabe.write(json.dumps(satz, ensure_ascii=False) + "\n")
            ausgabe.flush()
            if i % 25 == 0:
                sys.stderr.write("kurve %d/%d\n" % (i, len(offen)))
                sys.stderr.flush()
    finally:
        ausgabe.close()
        protokoll.close()
    print(json.dumps({"noetig": len(noetig), "neu": len(offen)}, ensure_ascii=False))
    return 0


# ── Die vier externen Sonden ──────────────────────────────────────────────────

def normraum(text):
    return re.sub(r"\s+", " ", text or "").strip()


def enthaelt_phrase(text, phrase):
    """Exakte Phrase an Wortgrenzen. Reine Teilzeichenketten waeren zwar einfacher,
    wuerden aber 'cloud' in 'cloudy' finden und dem Thema ein zu FRUEHES Datum geben -
    und ein zu frueher Anker ist der gefaehrlichere Fehler von beiden."""
    muster = r"(?<!\w)%s(?!\w)" % re.escape(normraum(phrase))
    return re.search(muster, normraum(text), re.IGNORECASE) is not None


def datum_padden(teil):
    """Ein Datumsteil wird fuer den VERGLEICH aufgefuellt, in der Ausgabe bleibt er
    unveraendert. Wer '1968' als '1968-01-01' ausgibt, erfindet Genauigkeit."""
    stuecke = str(teil).split("-")
    while len(stuecke) < 3:
        stuecke.append("01")
    return "-".join(s.zfill(2) if i else s.zfill(4) for i, s in enumerate(stuecke))


def genauigkeit_von(teil):
    return {1: "jahr", 2: "monat", 3: "tag"}.get(len(str(teil).split("-")), "unbekannt")


def kandidat(sonde, phrase, datum, bezeichnung, url, h, ankerfaehig=True, grund=None,
             extra=None):
    satz = {"sonde": sonde, "phrase": phrase, "datum": str(datum),
            "datumVergleich": datum_padden(datum), "genauigkeit": genauigkeit_von(datum),
            "bezeichnung": bezeichnung, "url": url, "sha256": h,
            "ankerfaehig": bool(ankerfaehig), "ebene": EBENE[sonde]}
    if grund:
        satz["grund"] = grund
    if extra:
        satz.update(extra)
    return satz


def p1_openalex(phrase, protokoll):
    """Der fachliche Kanal. OpenAlex statt arXiv, aus zwei Gruenden:

    (a) arXiv drosselt dauerhaft mit HTTP 429 und liefert damit je nach Tageszeit mal
        Kandidaten und mal keine. Genau das waere die Ungleichbehandlung, die C1
        ausschliessen soll - ein Thema, das waehrend der Drossel drankommt, saehe
        aermer aus als eins davor.
    (b) arXiv deckt Physik und Informatik ab. Chemie, Medizin und Energietechnik nicht -
        Wasserstoff, Solarstrom und Cannabis waeren dort systematisch benachteiligt.

    Vorsicht bei der Genauigkeit: OpenAlex setzt reine Jahresangaben auf den 1. Januar.
    Das Jahr steht deshalb zusaetzlich als eigenes Feld, damit ein Pruefer die
    Scheingenauigkeit sieht statt sie zu glauben.
    """
    url = ("https://api.openalex.org/works?filter=title.search:%s"
           "&sort=publication_date:asc&per-page=100"
           "&select=id,display_name,publication_date,publication_year,type,doi"
           "&mailto=Karl_viehrig@web.de" % urllib.parse.quote('"%s"' % phrase))
    rohbytes, h, status = hole_und_siegle("openalex", url, mindestabstand=1.0,
                                          protokoll=protokoll)
    if rohbytes is None:
        raise Bruch("OpenAlex antwortet HTTP %s auf %s" % (status, url))
    daten = json.loads(rohbytes.decode("utf-8", "replace"))
    aus = []
    for satz in (daten.get("results") or []):
        titel = normraum(satz.get("display_name"))
        datum = satz.get("publication_date")
        if not datum or not enthaelt_phrase(titel, phrase):
            continue
        if (satz.get("type") or "") == "paratext":
            continue          # Vorspann, Register, Impressum - kein datierbares Ereignis
        jahr = int(str(datum)[:4])
        ankerfaehig = jahr >= 1900
        aus.append(kandidat("openalex", phrase, datum, titel,
                            satz.get("doi") or satz.get("id"), h, ankerfaehig,
                            None if ankerfaehig else "Jahr < 1900 - unplausibler "
                                                     "Metadatensatz",
                            {"jahr": satz.get("publication_year"),
                             "typ": satz.get("type"),
                             "trefferGesamt": (daten.get("meta") or {}).get("count")}))
    return deckeln(aus)


def deckeln(kandidaten):
    """Der Kandidaten-Deckel greift NACH der Zulaessigkeit, nicht davor.

    Die erste Fassung brach ab, sobald KANDIDATEN_JE_SONDE Titel-Treffer beisammen
    waren - unabhaengig davon, ob sie ankerfaehig sind. Ein Thema, dessen fruehe
    Datensaetze kaputte Metadaten tragen (Jahr 0 und aehnliches), haette damit still
    'NICHT BELEGBAR' bekommen, obwohl ein gueltiger Kandidat existierte. Und das
    haengt an der zufaelligen Metadatenqualitaet je Thema - also genau die
    Ungleichbehandlung, die C1 ausschliesst. (Silent-Failure-Review 20.08.)"""
    geordnet = sorted(kandidaten, key=lambda k: (k["datumVergleich"],
                                                 k.get("bezeichnung") or ""))
    ja = [k for k in geordnet if k["ankerfaehig"]][:KANDIDATEN_JE_SONDE]
    nein = [k for k in geordnet if not k["ankerfaehig"]][:KANDIDATEN_JE_SONDE]
    return sorted(ja + nein, key=lambda k: (k["datumVergleich"],
                                            k.get("bezeichnung") or ""))


def _crossref_treffer(rohbytes, h, phrase, url):
    daten = json.loads(rohbytes.decode("utf-8", "replace"))
    aus = []
    for satz in (daten.get("message") or {}).get("items") or []:
        titel = normraum(" ".join(satz.get("title") or []))
        if not enthaelt_phrase(titel, phrase):
            continue
        teile = (satz.get("published") or {}).get("date-parts") or []
        if not teile or not teile[0] or teile[0][0] is None:
            continue
        datum = "-".join(str(x) for x in teile[0][:3])
        jahr = int(teile[0][0])
        erzeugt = (satz.get("created") or {}).get("date-time")
        ankerfaehig, grund = True, None
        if jahr < 1900:
            ankerfaehig, grund = False, "Jahr < 1900 - unplausibler Metadatensatz"
        elif not erzeugt:
            ankerfaehig, grund = False, "kein created-Zeitstempel"
        doi = satz.get("DOI")
        aus.append(kandidat("crossref", phrase, datum, titel,
                            ("https://doi.org/%s" % doi) if doi else None, h,
                            ankerfaehig, grund,
                            {"abgelegtAm": erzeugt, "typ": satz.get("type")}))
    return aus, (daten.get("message") or {}).get("total-results")


def p2_crossref(phrase, protokoll):
    """Zwei Fenster: die relevantesten Titel-Treffer UND die aeltesten. Ein einzelnes
    Fenster verliert bei haeufigen Phrasen genau den fruehen Aufsatz, den die Frage
    sucht - und wuerde das nicht merken."""
    feld = "DOI,title,published,created,type"
    basis = ("https://api.crossref.org/works?query.title=%s&select=%s"
             "&mailto=Karl_viehrig@web.de" % (urllib.parse.quote(phrase), feld))
    aus, gesamt, voll = [], None, False
    for zusatz, zeilen in (("", CROSSREF_ZEILEN),
                           ("&sort=published&order=asc", CROSSREF_ALT_ZEILEN)):
        url = basis + ("&rows=%d" % zeilen) + zusatz
        rohbytes, h, status = hole_und_siegle("crossref", url, mindestabstand=1.0,
                                              protokoll=protokoll)
        if rohbytes is None:
            raise Bruch("Crossref antwortet HTTP %s auf %s" % (status, url))
        teil, summe = _crossref_treffer(rohbytes, h, phrase, url)
        if summe is not None:
            gesamt = summe
            if summe > zeilen:
                voll = True
        aus.extend(teil)
    aus.sort(key=lambda k: (k["datumVergleich"], k["bezeichnung"]))
    gesehen, eindeutig = set(), []
    for k in aus:
        schluessel = k["url"] or (k["bezeichnung"], k["datum"])
        if schluessel in gesehen:
            continue
        gesehen.add(schluessel)
        k["fensterVoll"] = voll
        k["trefferGesamt"] = gesamt
        eindeutig.append(k)
    return deckeln(eindeutig)


def p3_wikipedia(phrase, protokoll):
    url = ("https://en.wikipedia.org/w/api.php?action=query&prop=revisions&titles=%s"
           "&rvdir=newer&rvlimit=1&rvprop=timestamp%%7Cuser&redirects=1&format=json"
           "&formatversion=2" % urllib.parse.quote(phrase))
    rohbytes, h, status = hole_und_siegle("wikipedia", url, mindestabstand=0.5,
                                          protokoll=protokoll)
    if rohbytes is None:
        raise Bruch("Wikipedia antwortet HTTP %s auf %s" % (status, url))
    daten = json.loads(rohbytes.decode("utf-8", "replace"))
    aus = []
    for seite in ((daten.get("query") or {}).get("pages") or []):
        if seite.get("missing"):
            continue
        versionen = seite.get("revisions") or []
        if not versionen or not versionen[0].get("timestamp"):
            raise Bruch("Wikipedia liefert die Seite %r ohne erste Version - das waere "
                        "ein Datum ohne Beleg" % seite.get("title"))
        lemma = seite.get("title") or ""
        gleich = normraum(lemma).lower() == normraum(phrase).lower()
        aus.append(kandidat("wikipedia", phrase, versionen[0]["timestamp"][:10], lemma,
                            "https://en.wikipedia.org/wiki/%s"
                            % urllib.parse.quote(lemma.replace(" ", "_")), h,
                            gleich,
                            None if gleich else
                            "weiterleitungAufAnderesLemma: %r statt %r" % (lemma, phrase),
                            {"lemma": lemma, "ersteVersionVon": versionen[0].get("user")}))
    return aus


def p5_fedreg(phrase, protokoll):
    felder = "".join("&fields[]=%s" % f for f in
                     ("document_number", "publication_date", "title", "type", "html_url"))
    url = ("https://www.federalregister.gov/api/v1/documents.json?conditions[term]=%s"
           "&order=oldest&per_page=%d%s"
           % (urllib.parse.quote('"%s"' % phrase), KANDIDATEN_JE_SONDE, felder))
    rohbytes, h, status = hole_und_siegle("fedreg", url, mindestabstand=1.0,
                                          protokoll=protokoll)
    if rohbytes is None:
        raise Bruch("Federal Register antwortet HTTP %s auf %s" % (status, url))
    daten = json.loads(rohbytes.decode("utf-8", "replace"))
    aus = []
    for satz in (daten.get("results") or []):
        if not satz.get("publication_date"):
            continue
        aus.append(kandidat("fedreg", phrase, satz["publication_date"],
                            normraum(satz.get("title")), satz.get("html_url"), h,
                            True, None,
                            {"dokumentNummer": satz.get("document_number"),
                             "art": satz.get("type"),
                             "trefferGesamt": daten.get("count")}))
    return aus


SONDEN = [("openalex", p1_openalex), ("crossref", p2_crossref),
          ("wikipedia", p3_wikipedia), ("fedreg", p5_fedreg)]


def ereignis_pfad():
    return rohpfad("C1-ereignisse.jsonl")


def befehl_ereignisse(_argv):
    bereit("ereignisse")
    noetig = []
    for t in themen():
        for phrase in t["begriffe"]:
            for name, _ in SONDEN:
                noetig.append((t["thema"], phrase, name))
    fertig = C0.gelesen(ereignis_pfad(),
                        lambda s: (s["thema"], s["phrase"], s["sonde"]))
    offen = [k for k in noetig if k not in fertig]
    funktion = dict(SONDEN)
    protokoll = open(c1_query_log(), "a", encoding="utf-8", newline="\n")
    ausgabe = open(ereignis_pfad(), "a", encoding="utf-8", newline="\n")
    try:
        for i, (thema, phrase, name) in enumerate(offen, 1):
            treffer = funktion[name](phrase, protokoll)
            ausgabe.write(json.dumps({"thema": thema, "phrase": phrase, "sonde": name,
                                      "kandidaten": treffer, "geholtAm": jetzt()},
                                     ensure_ascii=False) + "\n")
            ausgabe.flush()
            sys.stderr.write("ereignisse %d/%d %s/%s\n" % (i, len(offen), thema, name))
            sys.stderr.flush()
    finally:
        ausgabe.close()
        protokoll.close()
    print(json.dumps({"noetig": len(noetig), "neu": len(offen)}, ensure_ascii=False))
    return 0


# ── Befehl: fuehrung ──────────────────────────────────────────────────────────

def kurve_lesen():
    stand = C0.gelesen(kurve_pfad(), lambda s: (s["phrase"], s["jahr"]))
    if not stand:
        raise Bruch("Kein Kurven-Stand - erst 'kurve' laufen lassen")
    return stand


def erste_nennungen(leitphrase, stand):
    """Die acht fruehesten Nennungen - mit der Marke, aus welchem Jahr sie stammen.

    Ein GEDECKELTES Jahr gibt seine Trefferliste nur unvollstaendig und nach EDGARs
    Relevanz sortiert heraus, nicht nach Datum. Die daraus gezogenen Namen sind
    Nennungen, aber nicht belegbar die fruehesten. Sie bleiben in der Liste - sonst
    verschwiegen wir die einzigen Namen, die es fuer dieses Jahr gibt - und tragen die
    Marke `ausGedeckeltemJahr`."""
    alle = []
    for jahr in JAHRE:
        satz = stand.get((leitphrase, jahr))
        if satz is None:
            raise Bruch("Kurve fuer %r/%d fehlt" % (leitphrase, jahr))
        for f in (satz.get("fruehesteFiler") or []):
            eintrag = dict(f)
            eintrag["ausGedeckeltemJahr"] = bool(satz.get("gedeckelt"))
            alle.append(eintrag)
    return fruehste_filer(alle, FUEHRUNG_N)


def p4_kandidat_moeglich(leitphrase, stand):
    """Darf aus der Kurve ein EDGAR-Ereignisdatum abgeleitet werden?

    Nur wenn das frueheste Jahr mit ueberhaupt einer Nennung nicht gedeckelt ist.
    Sonst waere "das frueheste 10-K" eine Behauptung ueber eine Liste, die die Quelle
    gar nicht vollstaendig herausgibt - fail-closed."""
    for jahr in JAHRE:
        satz = stand.get((leitphrase, jahr))
        if satz is None:
            raise Bruch("Kurve fuer %r/%d fehlt" % (leitphrase, jahr))
        if satz.get("gedeckelt"):
            return False, "fruehestes Jahr mit Nennungen (%d) ist gedeckelt" % jahr
        if satz.get("fruehesteFiler"):
            return True, None
    return False, "keine Nennung im Zeitraum"


def text_aus(rohbytes):
    text = rohbytes.decode("utf-8", "replace")
    text = re.sub(r"(?is)<(script|style)[^>]*>.*?</\1>", " ", text)
    text = re.sub(r"(?s)<[^>]+>", " ", text)
    return normraum(htmlmod.unescape(text))


# Bekannte Luecke, bewusst so gelassen: Filings, die ihre Item-Ueberschrift nur
# optisch (fett/gross) statt mit Satzzeichen abtrennen, sind aus reinem Text nicht
# erkennbar. Dort bleibt `abschnitt` leer und die Rolle faellt auf die
# Signalfamilien zurueck - das ist der ehrliche Ausgang, kein stiller Treffer.
ITEM_MUSTER = re.compile(r"(?i)\bitem\s+(\d{1,2}\s*[A-Za-z]?)\s*[\.\:\-\u2013\u2014]")


def abschnitt_vor(text, stelle):
    letzter = None
    for treffer in ITEM_MUSTER.finditer(text, 0, stelle):
        letzter = treffer
    return normraum(letzter.group(0)).rstrip(".:-").strip() if letzter else None


def rolle_aus(fenster, abschnitt):
    """Grobe Kontext-Marke, kein Urteil ueber das Geschaeftsmodell."""
    klein = fenster.lower()
    anbieter = sum(klein.count(s) for s in ANBIETER_SIGNALE)
    anwender = sum(klein.count(s) for s in ANWENDER_SIGNALE)
    if abschnitt and re.match(r"(?i)item\s*1\s*a$", abschnitt.strip()):
        rolle = "RISIKOTEIL"
    elif anbieter > anwender:
        rolle = "ANBIETER"
    elif anwender > anbieter:
        rolle = "ANWENDER"
    else:
        rolle = "ERWAEHNUNG"
    return rolle, {"anbieter": anbieter, "anwender": anwender}


def dokumente_von(cik, adsh, protokoll):
    ohne = (adsh or "").replace("-", "")
    if not ohne:
        return [], None, False
    url = ("https://www.sec.gov/Archives/edgar/data/%d/%s/index.json"
           % (int(cik), ohne))
    rohbytes, h, status = hole_und_siegle("filing", url, mindestabstand=0.15,
                                          protokoll=protokoll)
    if rohbytes is None:
        return [], status, False
    daten = json.loads(rohbytes.decode("utf-8", "replace"))
    posten = (daten.get("directory") or {}).get("item") or []
    haupt = sorted((p for p in posten if (p.get("type") or "") == "10-K"),
                   key=lambda p: p.get("name") or "")
    rest = sorted((p for p in posten
                   if (p.get("name") or "").lower().endswith((".htm", ".html", ".txt"))
                   and not (p.get("type") or "").upper().startswith("EX")
                   and p not in haupt),
                  key=lambda p: -int(p.get("size") or 0))
    namen = [p.get("name") for p in haupt + rest if p.get("name")]
    return ["https://www.sec.gov/Archives/edgar/data/%d/%s/%s" % (int(cik), ohne, n)
            for n in namen[:DOK_HOECHSTENS]], status, True


def phrasenstelle(text, phrase):
    """Fundstelle an Wortgrenzen - dieselbe Regel wie enthaelt_phrase.

    Die erste Fassung nahm hier str.find(). Damit haette "cloud" in "cloudy"
    getroffen, und Kontextfenster samt Rolle waeren fuer eine Stelle berechnet worden,
    an der die Phrase gar nicht steht - ein Beleg, der aussieht wie ein Beleg. Zwei
    unabhaengige Reviews haben genau das gefunden (20.08.)."""
    treffer = re.search(r"(?<!\w)%s(?!\w)" % re.escape(normraum(phrase)),
                        normraum(text), re.IGNORECASE)
    return treffer.start() if treffer else -1


def fenster_suchen(phrase, urls, protokoll):
    """Gibt (fund, gelesen) zurueck. `gelesen` sagt, ob ueberhaupt ein Dokument
    gelesen werden konnte - sonst waeren "nicht erreichbar" und "Phrase nicht
    enthalten" derselbe leere Wert, und der Bericht wiese das eine als das andere
    aus."""
    gelesen_eins = False
    for url in urls:
        rohbytes, h, status = hole_und_siegle("filing", url, mindestabstand=0.15,
                                              protokoll=protokoll)
        if rohbytes is None:
            continue
        gelesen_eins = True
        text = normraum(text_aus(rohbytes))
        stelle = phrasenstelle(text, phrase)
        if stelle < 0:
            continue
        von = max(0, stelle - FENSTER)
        bis = min(len(text), stelle + len(normraum(phrase)) + FENSTER)
        return {"url": url, "sha256": h, "fenster": text[von:bis],
                "abschnitt": abschnitt_vor(text, stelle), "stelle": stelle,
                "textLaenge": len(text)}, True
    return None, gelesen_eins


def fuehrung_pfad():
    return rohpfad("C1-fuehrung.jsonl")


def befehl_fuehrung(_argv):
    bereit("fuehrung")
    stand = kurve_lesen()
    noetig = []
    for t in themen():
        for f in erste_nennungen(t["leitphrase"], stand):
            noetig.append((t["thema"], f["cik"], f["adsh"]))
    fertig = C0.gelesen(fuehrung_pfad(), lambda s: (s["thema"], s["cik"], s["adsh"]))
    offen = [k for k in noetig if k not in fertig]
    nach_thema = {t["thema"]: t for t in themen()}
    daten = {}
    for t in themen():
        for f in erste_nennungen(t["leitphrase"], stand):
            daten[(t["thema"], f["cik"], f["adsh"])] = f
    protokoll = open(c1_query_log(), "a", encoding="utf-8", newline="\n")
    ausgabe = open(fuehrung_pfad(), "a", encoding="utf-8", newline="\n")
    try:
        for i, schluessel in enumerate(offen, 1):
            thema, cik, adsh = schluessel
            f = daten[schluessel]
            phrase = nach_thema[thema]["leitphrase"]
            urls, status, indexgelesen = dokumente_von(cik, adsh, protokoll)
            fund, gelesen_eins = (fenster_suchen(phrase, urls, protokoll) if urls
                                  else (None, False))
            satz = {"thema": thema, "cik": cik, "adsh": adsh, "name": f.get("name"),
                    "datum": f.get("datum"), "form": f.get("form"),
                    "ausGedeckeltemJahr": bool(f.get("ausGedeckeltemJahr")),
                    "geholtAm": jetzt()}
            if fund is None:
                satz["belegbar"] = False
                if not urls:
                    satz["grund"] = NICHT_BELEGBAR + (
                        ": Einreichungs-Index gelesen, listet aber kein pruefbares "
                        "Dokument" if indexgelesen
                        else ": Einreichungs-Index nicht abrufbar (HTTP %s)" % status)
                elif not gelesen_eins:
                    satz["grund"] = (NICHT_BELEGBAR + ": keines der %d Dokumente war "
                                     "abrufbar" % len(urls))
                else:
                    satz["grund"] = (NICHT_BELEGBAR + ": Phrase in den geprueften "
                                     "Dokumenten nicht gefunden")
            else:
                rolle, signale = rolle_aus(fund["fenster"], fund["abschnitt"])
                satz.update({"belegbar": True, "rolle": rolle, "signale": signale,
                             "abschnitt": fund["abschnitt"], "fenster": fund["fenster"],
                             "url": fund["url"], "sha256": fund["sha256"]})
            ausgabe.write(json.dumps(satz, ensure_ascii=False) + "\n")
            ausgabe.flush()
            if i % 10 == 0:
                sys.stderr.write("fuehrung %d/%d\n" % (i, len(offen)))
                sys.stderr.flush()
    finally:
        ausgabe.close()
        protokoll.close()
    print(json.dumps({"noetig": len(noetig), "neu": len(offen)}, ensure_ascii=False))
    return 0


# ── Befehl: ableiten ──────────────────────────────────────────────────────────

def reihe_von(leitphrase, stand):
    reihe = {}
    for jahr in JAHRE:
        satz = stand.get((leitphrase, jahr))
        if satz is None:
            raise Bruch("Kurve fuer %r/%d fehlt" % (leitphrase, jahr))
        reihe[jahr] = None if satz.get("gedeckelt") else satz["D"]
    return reihe


def vereinigungsreihe(begriffe, stand):
    reihe = {}
    for jahr in JAHRE:
        menge, gedeckelt = set(), False
        for b in begriffe:
            satz = stand.get((b, jahr))
            if satz is None:
                raise Bruch("Kurve fuer %r/%d fehlt" % (b, jahr))
            if satz.get("gedeckelt"):
                gedeckelt = True
            menge.update(satz.get("ciks") or [])
        reihe[jahr] = None if gedeckelt else len(menge)
    return reihe


def beschleunigung(reihe):
    """Rein deskriptiv. Ein gedeckeltes Jahr unterbricht die Rechnung, statt sie zu
    fuellen - eine gefuellte Luecke waere eine erfundene Beobachtung."""
    jahre = sorted(reihe)
    def paar(j):
        a, b = reihe.get(j), reihe.get(j - BASIS_ABSTAND)
        return (a, b) if (a is not None and b is not None) else (None, None)
    verzehn = None
    for j in jahre:
        a, b = paar(j)
        if a is not None and a >= VERZEHNFACHUNG * max(1, b):
            verzehn = j
            break
    verdopp = None
    for j in jahre:
        a, b = paar(j)
        if a is not None and a >= VERDOPPLUNG * max(1, b):
            verdopp = j
    messbar = [(j, reihe[j]) for j in jahre if reihe[j] is not None]
    if not messbar:
        return {"verzehnfachung": None, "letzteVerdopplung": None,
                "hoehepunkt": None, "hoehepunktD": None, "kipppunkt": None}
    hoch = max(messbar, key=lambda p: (p[1], -p[0]))
    kipp = None
    for j, d in messbar:
        if j > hoch[0] and d <= KIPP_ANTEIL * hoch[1]:
            kipp = j
            break
    return {"verzehnfachung": verzehn, "letzteVerdopplung": verdopp,
            "hoehepunkt": hoch[0], "hoehepunktD": hoch[1], "kipppunkt": kipp}


def anker_aus(kandidaten, sonden):
    """Der frueheste ANKERFAEHIGE Kandidat der genannten Sonden. Keiner? Dann
    NICHT BELEGBAR - nie der naechstbeste, nie eine Schaetzung."""
    zulaessig = [k for k in kandidaten if k["sonde"] in sonden and k["ankerfaehig"]]
    if not zulaessig:
        return None
    besten = min(zulaessig, key=lambda k: (k["datumVergleich"], k["sonde"], k["url"] or ""))
    grenze = QUELLEN_UNTERGRENZE.get(besten["sonde"])
    besten = dict(besten)
    besten["linkszensiert"] = bool(grenze and besten["datumVergleich"][:4] == str(grenze))
    return besten


def monate_zwischen(frueh, spaet):
    if not frueh or not spaet:
        return None
    a = [int(x) for x in frueh["datumVergleich"].split("-")]
    b = [int(x) for x in spaet["datumVergleich"].split("-")]
    return (b[0] - a[0]) * 12 + (b[1] - a[1])


def befehl_ableiten(_argv):
    pruefe_regelstand("ableiten")
    stand = kurve_lesen()
    ereignisse = {}
    for satz in C0.gelesen(ereignis_pfad(),
                           lambda s: (s["thema"], s["phrase"], s["sonde"])).values():
        ereignisse.setdefault(satz["thema"], []).extend(satz["kandidaten"])
    laeufe = {}
    for schluessel in C0.gelesen(ereignis_pfad(),
                                 lambda s: (s["thema"], s["phrase"], s["sonde"])):
        laeufe.setdefault(schluessel[0], set()).add((schluessel[1], schluessel[2]))
    fuehrung = {}
    for satz in C0.gelesen(fuehrung_pfad(),
                           lambda s: (s["thema"], s["cik"], s["adsh"])).values():
        fuehrung.setdefault(satz["thema"], []).append(satz)

    os.makedirs(FUEHRUNG_DIR, exist_ok=True)
    os.makedirs(KANDIDATEN_DIR, exist_ok=True)
    aus, ankerpruefung = [], []
    for t in themen():
        reihe = reihe_von(t["leitphrase"], stand)
        kand = list(ereignisse.get(t["thema"]) or [])
        # P4 EDGAR entsteht aus der eigenen Kurve, nicht aus einem zweiten Abruf.
        erste = erste_nennungen(t["leitphrase"], stand)
        p4_ok, p4_grund = p4_kandidat_moeglich(t["leitphrase"], stand)
        if p4_ok and erste and erste[0].get("datum") and erste[0].get("belegSha256"):
            f = erste[0]
            kand.append(kandidat("edgar", t["leitphrase"], f["datum"],
                                 "%s (10-K)" % f.get("name"),
                                 "https://www.sec.gov/Archives/edgar/data/%d/%s/index.json"
                                 % (int(f["cik"]), (f["adsh"] or "").replace("-", "")),
                                 f["belegSha256"], True, None, {"cik": f["cik"]}))
        kand.sort(key=lambda k: (k["datumVergleich"], k["sonde"]))
        fach = anker_aus(kand, {"openalex", "crossref"})
        oeff = anker_aus(kand, {"wikipedia", "edgar", "fedreg"})
        zeile = {
            "thema": t["thema"], "herkunft": t["herkunft"],
            "leitphrase": t["leitphrase"], "begriffe": t["begriffe"],
            "c0SpikeJahr": t["c0SpikeJahr"], "c0D": t["c0D"],
            "sondenLaeufe": len(laeufe.get(t["thema"]) or ()),
            "p4Moeglich": p4_ok, "p4Grund": p4_grund,
            "sondenLaeufeSoll": len(t["begriffe"]) * len(SONDEN),
            "reihe": {str(j): reihe[j] for j in sorted(reihe)},
            # Ein gedeckeltes Startjahr heisst NICHT "nicht zensiert", sondern
            # "unbekannt". Die alte Fassung buchte es als False.
            "linkszensiert": (None if reihe.get(JAHRE[0]) is None
                              else reihe[JAHRE[0]] > 0),
            "gedeckelteJahre": [j for j in sorted(reihe) if reihe[j] is None],
            "beschleunigung": beschleunigung(reihe),
            "ankerFachlich": fach or NICHT_BELEGBAR,
            "ankerOeffentlich": oeff or NICHT_BELEGBAR,
            "abstandMonate": monate_zwischen(fach, oeff),
            "kandidatenZahl": len(kand),
            "kandidatenDatei": "protocol/strang-c/c1-kandidaten/%s.json" % _dateiname(t["thema"]),
            "fuehrungDatei": "protocol/strang-c/c1-fuehrung/%s.json" % _dateiname(t["thema"]),
        }
        if len(t["begriffe"]) > 1:
            v = vereinigungsreihe(t["begriffe"], stand)
            zeile["vereinigungsreihe"] = {str(j): v[j] for j in sorted(v)}
        # Anker gegen C0: dieselbe Zahl im Aufnahmejahr, sonst rot.
        if t["herkunft"] == "REGEL":
            ist = reihe.get(t["c0SpikeJahr"])
            ankerpruefung.append({"thema": t["thema"], "jahr": t["c0SpikeJahr"],
                                  "c0D": t["c0D"], "c1D": ist, "gleich": ist == t["c0D"]})
        aus.append(zeile)
        # Die Kandidaten liegen je Thema in einer eigenen Datei: alle zusammen sprengen
        # den 200-KB-Deckel (R14a), und ein gekuerzter Kandidatensatz waere genau die
        # unsichtbare Auswahl, die C1 ausschliessen soll.
        schreib_json(os.path.join(KANDIDATEN_DIR, "%s.json" % _dateiname(t["thema"])),
                     {"schema": "strang-c-c1-kandidaten/v1", "thema": t["thema"],
                      "leitphrase": t["leitphrase"], "begriffe": t["begriffe"],
                      "kandidaten": kand})
        schreib_json(os.path.join(FUEHRUNG_DIR, "%s.json" % _dateiname(t["thema"])),
                     {"schema": "strang-c-c1-fuehrung/v1", "thema": t["thema"],
                      "leitphrase": t["leitphrase"],
                      "hinweis": "Grobe Kontext-Marke aus einem Fenster von +/-%d Zeichen "
                                 "um die Phrase. Kein Urteil ueber das Geschaeftsmodell."
                                 % FENSTER,
                      "nennungen": sorted(fuehrung.get(t["thema"]) or [],
                                          key=lambda s: (s.get("datum") or "", s["cik"]))})
    schreib_json(ZEITLEISTEN, {
        "schema": "strang-c-zeitleisten/v1", "erzeugtAm": jetzt(),
        "jahre": [JAHRE[0], JAHRE[-1]], "themen": len(aus),
        "c0Ankerpruefung": ankerpruefung,
        "c0AnkerAlleGleich": all(p["gleich"] for p in ankerpruefung),
        "zeitleisten": aus,
    })
    print(json.dumps({"themen": len(aus),
                      "c0AnkerAlleGleich": all(p["gleich"] for p in ankerpruefung),
                      "ankerFachlichBelegt": sum(1 for z in aus
                                                 if z["ankerFachlich"] != NICHT_BELEGBAR),
                      "ankerOeffentlichBelegt": sum(1 for z in aus
                                                    if z["ankerOeffentlich"] != NICHT_BELEGBAR)},
                     ensure_ascii=False, indent=1))
    return 0


# ── Befehl: freeze2 / pruefen ─────────────────────────────────────────────────

def buendel2():
    paare = [("protocol/strang-c/C1-zeitleisten.json", dateihash(ZEITLEISTEN))]
    for ordner, kurz in ((FUEHRUNG_DIR, "c1-fuehrung"), (KANDIDATEN_DIR, "c1-kandidaten")):
        for name in sorted(os.listdir(ordner)):
            if name.endswith(".json"):
                paare.append(("protocol/strang-c/%s/%s" % (kurz, name),
                              dateihash(os.path.join(ordner, name))))
    return C0.buendelhash(paare)


def befehl_freeze2(argv):
    pruefe_regelstand("freeze2")
    runid = wert(argv, "runid")
    zugriff_ab = wert(argv, "zugriff-ab")
    gesamt, zeilen = buendel2()
    schreib_json(FREEZE2, {
        "schema": "strang-c-freeze/v1", "stufe": "C1_FREEZE_2", "runId": runid,
        "erzeugtAm": jetzt(), "buendelSha256": gesamt, "buendel": zeilen,
        "bedeutung": "Zeitleisten und Fuehrungs-Dateien von C1, nach der Ableitung.",
    })
    eintrag = C0.haenge_an_register({
        "runId": runid, "typ": "C1_REGELFREEZE", "registeredAt": jetzt(),
        "accessedAt": zugriff_ab,
        "fenster": ["kein Studienfenster - abgeleitetes Ergebnis"],
        "allowedOutputs": ["zeitleiste", "firmenzahl_je_jahr", "ereignis_datum",
                           "quellen_pruefsumme", "kontextfenster", "rolle"],
        "erlaubt": "Veroeffentlichung der abgeleiteten Zeitleisten und Fuehrungs-Dateien.",
        "verboten": "Jede nachtraegliche Aenderung an Zeitleisten oder Fuehrungs-Dateien; "
                    "jeder Kurs-, Rendite- oder Marktwert.",
        "begruendung": "C1 FREEZE 2 - Buendel-SHA-256 %s ueber Zeitleisten und "
                       "Fuehrungs-Dateien." % gesamt,
        "endtestSiegel": "unberuehrt",
    })
    print(json.dumps({"runId": runid, "buendelSha256": gesamt,
                      "eventHash": eintrag["eventHash"]}, ensure_ascii=False, indent=1))
    return 0


def pruefungen():
    """Die Waechter als Liste (name, ok, meldung). Getrennt vom Ausgeben, damit der
    Meta-Test sie einzeln nachrechnen kann."""
    aus = []

    def w(name, ok, meldung):
        aus.append({"pruefung": name, "ok": bool(ok), "meldung": meldung})

    daten = lies_json(ZEITLEISTEN)
    leisten = daten["zeitleisten"]
    c0 = lies_json(C0_THEMEN)["themen"]

    # W1 - Vollstaendigkeit: kein Thema darf fehlen, auch keine Sprachmode.
    fehlend = sorted({t["thema"] for t in c0} - {z["thema"] for z in leisten})
    w("W1_alle_26_themen_haben_eine_zeitleiste", not fehlend and len(leisten) == 26,
      "fehlend: %s (n=%d)" % (fehlend or "keins", len(leisten)))

    # W2 - Der C0-Anker: die Firmenzahl im Aufnahmejahr muss reproduziert sein.
    schief = [p for p in daten["c0Ankerpruefung"] if not p["gleich"]]
    w("W2_c0_firmenzahl_im_aufnahmejahr_reproduziert",
      not schief and len(daten["c0Ankerpruefung"]) == 24,
      "abweichend: %s (geprueft=%d)" % (schief or "keins", len(daten["c0Ankerpruefung"])))

    # W3 - Belegpflicht: jedes Datum in der Ausgabe traegt eine Quellen-Pruefsumme.
    ohne = []
    for z in leisten:
        kpfad = os.path.join(WURZEL, *z["kandidatenDatei"].split("/"))
        if not os.path.exists(kpfad):
            ohne.append(z["thema"] + ":Kandidatendatei fehlt")
            continue
        kand = lies_json(kpfad)["kandidaten"]
        if len(kand) != z["kandidatenZahl"]:
            ohne.append("%s: %d Kandidaten statt %d" % (z["thema"], len(kand),
                                                        z["kandidatenZahl"]))
        for k in kand:
            if not k.get("sha256") or not re.fullmatch(r"[0-9a-f]{64}", k["sha256"] or ""):
                ohne.append("%s/%s/%s" % (z["thema"], k["sonde"], k["datum"]))
        for feld in ("ankerFachlich", "ankerOeffentlich"):
            anker = z[feld]
            if anker != NICHT_BELEGBAR and not re.fullmatch(r"[0-9a-f]{64}",
                                                            anker.get("sha256") or ""):
                ohne.append("%s/%s" % (z["thema"], feld))
    w("W3_jedes_datum_traegt_eine_quellen_pruefsumme", not ohne,
      "ohne Beleg: %s" % (ohne[:5] or "keins"))

    # W4 - Gleichbehandlung: jedes Thema hat dieselbe Zahl Sonden-Laeufe.
    ungleich = {z["thema"]: (z["sondenLaeufe"], z["sondenLaeufeSoll"])
                for z in leisten if z["sondenLaeufe"] != z["sondenLaeufeSoll"]}
    w("W4_jedes_thema_bekommt_genau_dieselben_sonden", not ungleich,
      "abweichend: %s" % (ungleich or "keins"))

    # W5 - Reihenlaenge: jede Zeitleiste deckt den vollen Zeitraum ab.
    kurz = [z["thema"] for z in leisten if len(z["reihe"]) != len(JAHRE)]
    w("W5_jede_reihe_deckt_2001_bis_2025", not kurz, "unvollstaendig: %s" % (kurz or "keins"))

    # W6 - Das Buendel-Siegel.
    if os.path.exists(FREEZE2):
        gesamt, zeilen = buendel2()
        freeze = lies_json(FREEZE2)
        w("W6_ausgabe_stimmt_mit_dem_freeze_2_siegel",
          gesamt == freeze["buendelSha256"] and zeilen == freeze["buendel"],
          "ist %s / soll %s" % (gesamt[:16], freeze["buendelSha256"][:16]))
    else:
        w("W6_ausgabe_stimmt_mit_dem_freeze_2_siegel", False, "FREEZE 2 fehlt")

    # W7 - Fuehrung: keine leere Rolle, kein stilles ERWAEHNUNG ohne Fenster.
    schlecht = []
    for z in leisten:
        pfad = os.path.join(WURZEL, *z["fuehrungDatei"].split("/"))
        if not os.path.exists(pfad):
            schlecht.append(z["thema"] + ":datei fehlt")
            continue
        for n in lies_json(pfad)["nennungen"]:
            if n.get("belegbar") and not normraum(n.get("fenster")):
                schlecht.append("%s/%s: Rolle ohne Fenster" % (z["thema"], n["cik"]))
            if not n.get("belegbar") and n.get("rolle"):
                schlecht.append("%s/%s: Rolle trotz NICHT BELEGBAR" % (z["thema"], n["cik"]))
    w("W7_keine_rolle_ohne_belegtes_kontextfenster", not schlecht,
      "verletzt: %s" % (schlecht[:5] or "keins"))

    # W8 - Die Dateimenge ist genau die der 26 Themen. Sonst wanderte eine
    # liegengebliebene Datei aus einem frueheren Lauf stillschweigend ins Siegel,
    # und W6 bliebe gruen, weil es denselben verunreinigten Stand nachrechnet.
    soll = {_dateiname(z["thema"]) + ".json" for z in leisten}
    fremd = []
    for ordner, kurz in ((FUEHRUNG_DIR, "c1-fuehrung"), (KANDIDATEN_DIR, "c1-kandidaten")):
        ist = {n for n in os.listdir(ordner) if n.endswith(".json")}
        for n in sorted(ist - soll):
            fremd.append("%s/%s ueberzaehlig" % (kurz, n))
        for n in sorted(soll - ist):
            fremd.append("%s/%s fehlt" % (kurz, n))
    w("W8_nur_die_26_themendateien_stehen_im_siegel", not fremd,
      "abweichend: %s" % (fremd[:5] or "keins"))
    return aus


def befehl_pruefen(_argv):
    ergebnis = pruefungen()
    for p in ergebnis:
        print("%s %s — %s" % ("OK  " if p["ok"] else "ROT ", p["pruefung"], p["meldung"]))
    rot = [p for p in ergebnis if not p["ok"]]
    print(json.dumps({"gruen": len(ergebnis) - len(rot), "rot": len(rot)},
                     ensure_ascii=False))
    return 1 if rot else 0


# ── Befehl: selbsttest ────────────────────────────────────────────────────────

def befehl_selbsttest(_argv):
    """Jede Rechenregel einmal in beide Richtungen: sie muss den richtigen Fall
    DURCHLASSEN und den falschen AUFFLIEGEN lassen. Ein Test, der nur die gute
    Richtung prueft, ist ein Kommentar."""
    n = [0]

    def ist(bedingung, was):
        n[0] += 1
        if not bedingung:
            raise Bruch("Selbsttest fehlgeschlagen: %s" % was)

    # datum_padden / genauigkeit
    ist(datum_padden("1968") == "1968-01-01", "Jahr wird aufgefuellt")
    ist(datum_padden("2012-6-5") == "2012-06-05", "Monat/Tag werden aufgefuellt")
    ist(genauigkeit_von("1968") == "jahr", "Jahr erkannt")
    ist(genauigkeit_von("2012-06-15") == "tag", "Tag erkannt")
    ist(datum_padden("2012-06") < datum_padden("2012-07"), "Vergleich sortiert richtig")
    ist(not (datum_padden("2013") < datum_padden("2012")), "Vergleich dreht nicht um")

    # enthaelt_phrase
    ist(enthaelt_phrase("A Survey of Deep  Learning", "deep learning"), "Phrase gefunden")
    ist(not enthaelt_phrase("A Survey of Learning", "deep learning"), "Nicht-Treffer faellt durch")
    ist(not enthaelt_phrase("a cloudy day", "cloud"), "Wortgrenze haelt 'cloudy' zurueck")
    ist(enthaelt_phrase("the Cloud, revisited", "cloud"), "Satzzeichen ist eine Wortgrenze")
    ist(enthaelt_phrase("Software-Defined Networking today", "software-defined networking"),
        "Bindestrich-Phrase wird gefunden")

    # beschleunigung
    r = {j: None for j in JAHRE}
    for j, d in ((2001, 1), (2002, 1), (2003, 1), (2004, 30), (2005, 60), (2006, 5)):
        r[j] = d
    b = beschleunigung(r)
    ist(b["verzehnfachung"] == 2004, "Verzehnfachung 2004")
    ist(b["hoehepunkt"] == 2005 and b["hoehepunktD"] == 60, "Hoehepunkt 2005")
    ist(b["kipppunkt"] == 2006, "Kipppunkt 2006")
    ist(b["letzteVerdopplung"] == 2006, "letzte Verdopplung 2006")
    r2 = dict(r)
    r2[2004] = 25   # knapp unter 10x der 1 aus 2001? nein: 25 >= 10 -> weiterhin Treffer
    ist(beschleunigung(r2)["verzehnfachung"] == 2004, "Grenzfall 25 >= 10*1")
    r3 = dict(r)
    r3[2004] = 9
    ist(beschleunigung(r3)["verzehnfachung"] == 2005, "9 < 10*1 -> erst 2005")
    r4 = {j: None for j in JAHRE}
    ist(beschleunigung(r4)["hoehepunkt"] is None, "leere Reihe liefert nichts")
    r5 = dict(r)
    r5[2001] = None
    ist(beschleunigung(r5)["verzehnfachung"] == 2005,
        "gedeckeltes Basisjahr unterbricht statt zu fuellen")

    # anker_aus
    ka = [kandidat("wikipedia", "x", "2005-01-01", "X", "u1", "a" * 64, False, "wl"),
          kandidat("edgar", "x", "2009-03-02", "Y", "u2", "b" * 64, True)]
    a = anker_aus(ka, {"wikipedia", "edgar", "fedreg"})
    ist(a["sonde"] == "edgar", "nicht-ankerfaehiger Kandidat gewinnt nicht")
    ist(anker_aus(ka, {"openalex"}) is None, "keine Sonde -> None statt Notloesung")
    ka2 = list(ka) + [kandidat("edgar", "x", "2001-02-02", "Z", "u3", "c" * 64, True)]
    a2 = anker_aus(ka2, {"edgar"})
    ist(a2["linkszensiert"] is True, "Randlage an der Untergrenze wird markiert")
    ist(anker_aus(ka, {"edgar"})["linkszensiert"] is False, "2009 ist nicht zensiert")

    # monate_zwischen
    ist(monate_zwischen({"datumVergleich": "2012-01-01"},
                        {"datumVergleich": "2014-07-01"}) == 30, "30 Monate")
    ist(monate_zwischen(None, {"datumVergleich": "2014-07-01"}) is None, "ohne Anker None")
    ist(monate_zwischen({"datumVergleich": "2014-07-01"},
                        {"datumVergleich": "2012-01-01"}) == -30, "negativ bleibt negativ")

    # rolle_aus
    rolle, s = rolle_aus("we offer our cloud solutions to customers", None)
    ist(rolle == "ANBIETER" and s["anbieter"] >= 1, "Anbieter erkannt")
    ist(rolle_aus("we use cloud services internally", None)[0] == "ANWENDER", "Anwender erkannt")
    ist(rolle_aus("the term appears once", None)[0] == "ERWAEHNUNG", "Rest ist Erwaehnung")
    ist(rolle_aus("we offer cloud", "Item 1A")[0] == "RISIKOTEIL", "Risikoteil schlaegt alles")
    ist(rolle_aus("we offer cloud", "Item 1")[0] == "ANBIETER", "Item 1 ist kein Risikoteil")
    ist(rolle_aus("we offer and we use", None)[0] == "ERWAEHNUNG", "Gleichstand -> Erwaehnung")

    # abschnitt_vor / text_aus
    t = text_aus(b"<p>Item 1A. Risk Factors</p><p>our cloud offering</p>")
    ist("Item 1A" in t and "<p>" not in t, "HTML wird gestrippt")
    ist(abschnitt_vor(t, t.find("cloud")).lower().startswith("item 1a"), "Abschnitt gefunden")
    ist(abschnitt_vor("kein Kopf hier", 5) is None, "ohne Kopf None")

    # phrasenstelle - der Befund, den zwei Reviews gefunden haben
    ist(phrasenstelle("a cloudy day", "cloud") == -1, "cloudy ist kein cloud-Treffer")
    ist(phrasenstelle("our cloud, revisited", "cloud") == 4, "echter Treffer wird gefunden")
    ist(phrasenstelle("nichts hier", "cloud") == -1, "kein Treffer -> -1")

    # deckeln - Zulaessigkeit vor Deckel
    viele = [kandidat("openalex", "x", "190%d" % i, "T%d" % i, "u%d" % i, "a" * 64,
                      False, "kaputt") for i in range(6)]
    viele.append(kandidat("openalex", "x", "2001-01-01", "gut", "ug", "b" * 64, True))
    gedeckelt = deckeln(viele)
    ist(any(k["ankerfaehig"] for k in gedeckelt),
        "ein gueltiger Kandidat ueberlebt den Deckel auch hinter 6 kaputten")
    ist(len([k for k in gedeckelt if not k["ankerfaehig"]]) == KANDIDATEN_JE_SONDE,
        "die kaputten werden auf den Deckel gekuerzt")
    ist(deckeln([]) == [], "leere Liste bleibt leer")

    # fruehste_filer
    ff = fruehste_filer([{"cik": "2", "adsh": "b", "datum": "2005-01-01"},
                         {"cik": "1", "adsh": "a", "datum": "2004-01-01"},
                         {"cik": "1", "adsh": "a", "datum": "2004-01-01"}], 2)
    ist([f["cik"] for f in ff] == ["1", "2"], "nach Datum sortiert und entdoppelt")
    ist(len(fruehste_filer([], 5)) == 0, "leere Liste bleibt leer")

    print(json.dumps({"selbsttest": "gruen", "pruefungen": n[0]}, ensure_ascii=False))
    return 0


BEFEHLE = {"freeze1": befehl_freeze1, "kurve": befehl_kurve,
           "ereignisse": befehl_ereignisse, "fuehrung": befehl_fuehrung,
           "ableiten": befehl_ableiten, "freeze2": befehl_freeze2,
           "pruefen": befehl_pruefen, "selbsttest": befehl_selbsttest}


def haupt(argv):
    if not argv or argv[0] not in BEFEHLE:
        sys.stderr.write(__doc__)
        return 2
    return BEFEHLE[argv[0]](argv[1:])


if __name__ == "__main__":
    try:
        sys.exit(haupt(sys.argv[1:]))
    except Bruch as fehler:
        sys.stderr.write("REGELBRUCH: %s\n" % fehler)
        sys.exit(1)
    except C0.Bruch as fehler:
        sys.stderr.write("REGELBRUCH (C0): %s\n" % fehler)
        sys.exit(1)

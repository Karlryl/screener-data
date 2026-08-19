#!/usr/bin/env python3
"""C0 — die eingefrorene Themen-Auswahlregel fuer Strang C, ausgefuehrt.

Die SACHE, die dieses Skript schuetzt: eine Auswahlregel, die nachtraeglich an ihr
eigenes Ergebnis angepasst wird, macht den ganzen Strang wertlos. Deshalb ist jede
Stelle, an der die Wahl den DATEN folgen koennte statt der REGEL, hier entweder
unmoeglich gemacht oder als Zaehlstand-Trigger sichtbar geloggt.

Werkzeug-Deckel R14c: ausschliesslich Python-Standardbibliothek.
Maschinen-Unabhaengigkeit R12a: kein absoluter Pfad im Code, der Speicherort kommt
aus der Umgebungsvariablen EARLY_DETECTION_DATA_ROOT.

Befehle (in dieser Reihenfolge):
  register    Rohbytes der drei Register ziehen und versiegeln (R7)
  vokabular   Begriffe mechanisch aus den versiegelten Rohbytes ableiten
  freeze1     Regeltext + Manifest + Vokabular hashen, Eintrag ans Zugriffs-Register
  screen      EDGAR-Dokument-Treffer je Begriff und Jahr (billige Vorstufe)
  zaehlen     CIK-Auszaehlung fuer Screen-Passierer und deren Basisjahre
  ableiten    Spike, Zusammenlegung, Leiter, Mandat -> Themenliste + Filer-Listen
  freeze2     Buendel-Hash ueber Themenliste, Filer-Listen, Query-Log, Leiter-Log
  pruefen     Waechter: das ausgelieferte Buendel gegen den Freeze-2-Hash
"""

import gzip
import hashlib
import html
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

# ── Wege und Konstanten ───────────────────────────────────────────────────────

WURZEL = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROTO = os.path.join(WURZEL, "protocol", "strang-c")
REGEL = os.path.join(PROTO, "C0-regel.md")
MANIFEST = os.path.join(PROTO, "C0-register-manifest.json")
VOKABULAR = os.path.join(PROTO, "C0-vokabular.json")
FREEZE1 = os.path.join(PROTO, "C0-freeze1.json")
FREEZE2 = os.path.join(PROTO, "C0-freeze2.json")
THEMEN = os.path.join(PROTO, "C0-themenliste.json")
LEITER = os.path.join(PROTO, "C0-leiter-log.json")
FILER_DIR = os.path.join(PROTO, "filer")
LEDGER = os.path.join(WURZEL, "protocol", "early-detection", "2.0.0", "outcome-access-ledger.json")

DATENWURZEL_ENV = "EARLY_DETECTION_DATA_ROOT"
KOPF = {"User-Agent": "Karl Viehrig Marktstruktur-Studie Strang C Karl_viehrig@web.de"}

# Regel-Parameter. Sie stehen hier EINMAL und werden von der Leiter (Abschnitt 6 der
# Regel) veraendert - ausschliesslich zaehlstand-getriggert.
BASIS_SCHWELLE = 20
BASIS_FAKTOR = 3.0
SPIKE_JAHRE = list(range(2004, 2023))
BASIS_ABSTAND = 3
EDGAR_JAHRE = list(range(min(SPIKE_JAHRE) - BASIS_ABSTAND, max(SPIKE_JAHRE) + 1))
AUTO_PASS_TREFFER = 5000
SCREEN_RESERVE = 4          # Sicherheitsreserve des Dokument-Screens
ZIELBAND = (15, 25)
HANDLUNGSBAND = (12, 30)
PFLICHT_VERWECHSLER = ["3D-Druck", "Metaverse", "Wasserstoff", "Cannabis", "Blockchain"]


class Bruch(Exception):
    """Fail-closed: alles, was die Regel verletzen wuerde, haelt an."""


def jetzt():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def datenwurzel():
    wert = os.environ.get(DATENWURZEL_ENV)
    if not wert:
        raise Bruch(
            "Speicherort unbekannt: %s ist nicht gesetzt (R12a verbietet einen fest "
            "verdrahteten Pfad)" % DATENWURZEL_ENV
        )
    return wert


def rohordner(unter):
    pfad = os.path.join(datenwurzel(), "strang-c", unter)
    os.makedirs(pfad, exist_ok=True)
    return pfad


def sha256(daten):
    return hashlib.sha256(daten).hexdigest()


def lies_json(pfad):
    with open(pfad, "r", encoding="utf-8") as f:
        return json.load(f)


def schreib_json(pfad, obj, einrueckung=1):
    os.makedirs(os.path.dirname(pfad), exist_ok=True)
    text = json.dumps(obj, ensure_ascii=False, indent=einrueckung, sort_keys=False)
    with open(pfad, "w", encoding="utf-8", newline="\n") as f:
        f.write(text + "\n")


# ── Netz: holen und versiegeln (R7) ───────────────────────────────────────────

_letzter_abruf = [0.0]


# Das Internet Archive liefert bei Wartung eine Stoerungsseite MIT Statuscode 200.
# Wer die als Inhalt durchlaesst, bekommt keine Fehlermeldung, sondern eine Seite mit
# null Titeln - und bucht den Jahrgang still als Luecke. Genau diese Verwechslung von
# "nicht da" und "gerade nicht erreichbar" ist der gefaehrlichste stille Fehler in
# diesem Skript, deshalb steht der Marker hier und nicht in einem Kommentar.
STOERUNGS_MARKER = b"Internet Archive: Temporarily Offline"


def hole(url, mindestabstand=0.11, versuche=3, wartezeit=1.5):
    """Holt eine URL und gibt die ROHBYTES zurueck. Kein stiller Fallback: schlaegt
    der Abruf endgueltig fehl, fliegt die Ausnahme, damit die Luecke als Luecke
    sichtbar wird statt als leeres Ergebnis."""
    letzter = None
    for versuch in range(versuche):
        abstand = time.time() - _letzter_abruf[0]
        if abstand < mindestabstand:
            time.sleep(mindestabstand - abstand)
        _letzter_abruf[0] = time.time()
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=KOPF), timeout=120) as antwort:
                rohbytes = antwort.read()
            if STOERUNGS_MARKER in rohbytes[:4000]:
                letzter = "Stoerungsseite des Internet Archive (Statuscode %s)" % antwort.status
            else:
                return rohbytes, antwort.status
        except urllib.error.HTTPError as fehler:
            if fehler.code in (404, 403):
                return None, fehler.code
            letzter = fehler
        except Exception as fehler:  # Netzfehler, Timeouts
            letzter = fehler
        time.sleep(wartezeit * (versuch + 1))
    raise Bruch("Abruf endgueltig gescheitert: %s (%s)" % (url, letzter))


def hole_archiv(url):
    """Wayback-Abrufe brauchen einen laengeren Atem als der lebende EDGAR-Dienst:
    das Archiv ist zeitweise komplett offline. Lieber lange warten als eine Luecke
    erfinden."""
    return hole(url, mindestabstand=1.0, versuche=8, wartezeit=20.0)


def versiegle(unter, rohbytes):
    """Legt die Rohbytes gzip-komprimiert unter ihrem Klartext-Hash ab. Gehasht und
    verglichen wird IMMER der Klartext; gzip ist reine Transportform."""
    h = sha256(rohbytes)
    ziel = os.path.join(rohordner(unter), h + ".gz")
    if not os.path.exists(ziel):
        vorlaeufig = ziel + ".teil"
        with gzip.open(vorlaeufig, "wb") as f:
            f.write(rohbytes)
        os.replace(vorlaeufig, ziel)
    return h


def entsiegle(unter, h):
    ziel = os.path.join(rohordner(unter), h + ".gz")
    with gzip.open(ziel, "rb") as f:
        rohbytes = f.read()
    if sha256(rohbytes) != h:
        raise Bruch("Versiegelte Bytes %s stimmen nicht mit ihrem Hash ueberein" % h)
    return rohbytes


# ── Quelle A: Gartner Top 10 Strategic Technology Trends ──────────────────────

CDX_SEITE = ("http://web.archive.org/cdx/search/cdx?url=%s&output=json&collapse=urlkey"
             "&fl=timestamp,original,statuscode&pageSize=5&page=%d")
CDX_SEITEN = ("http://web.archive.org/cdx/search/cdx?url=%s&collapse=urlkey"
              "&pageSize=5&showNumPages=true")


def cdx_alle(praefix):
    """Holt den Wayback-Index VOLLSTAENDIG, seitenweise.

    Der erste Anlauf zog den Index in einem Rutsch - und Wayback lieferte gelegentlich
    eine abgeschnittene Antwort. Abgeschnitten heisst hier: Jahrgaenge fehlen still.
    Genau deshalb wird geblaettert und JEDE Seite streng geparst; eine unlesbare Seite
    haelt an, statt eine stille Luecke zu erzeugen (fail-closed)."""
    ziel = urllib.parse.quote(praefix, safe="*")
    kopf, _ = hole_archiv(CDX_SEITEN % ziel)
    seiten = int(kopf.decode("ascii", "replace").strip())
    zeilen = []
    hashes = []
    for seite in range(seiten):
        rohbytes, _ = hole_archiv(CDX_SEITE % (ziel, seite))
        hashes.append(versiegle("roh", rohbytes))
        try:
            teil = json.loads(rohbytes.decode("utf-8", "replace"))
        except ValueError as fehler:
            raise Bruch("Wayback-Index Seite %d/%d unlesbar: %s" % (seite, seiten, fehler))
        zeilen.extend(teil[1:] if teil and teil[0][0] == "timestamp" else teil)
    return hashes, zeilen


def kandidaten(zeilen, muster, jahrgang_gruppe):
    """Ordnet die Index-Zeilen den Jahrgaengen zu. Feste, dokumentierte Sortierung:
    erst die echten 200er, dann alles andere, jeweils aeltester Snapshot zuerst.
    Damit haengt die Wahl des Snapshots an einer Regel, nicht am Zufall der Zeile."""
    gefunden = {}
    for zeitstempel, original, status in zeilen:
        treffer = muster.search(original)
        if not treffer:
            continue
        jahrgang = int(treffer.group(jahrgang_gruppe))
        gefunden.setdefault(jahrgang, []).append((0 if status == "200" else 1, zeitstempel, original))
    return {j: sorted(v) for j, v in gefunden.items()}


A_MUSTER = re.compile(
    r"/(\d{4})-\d{2}-\d{2}-gartner-?(?:identifies|says)-+the-?top-10-strategic-technology-trends-+for-(\d{4})/?$")


def quelle_a_urls():
    """Findet die Pressemitteilungen mechanisch im Wayback-Index. Keine Merkliste,
    keine Motor-Erinnerung: was das Muster trifft, kommt rein."""
    hashes, zeilen = cdx_alle("gartner.com/en/newsroom/press-releases/*")
    return hashes, kandidaten(zeilen, A_MUSTER, 2)


A_BLOCK = re.compile(r"<(h[1-6]|strong|b)[^>]*>(.{0,200}?)</\1>", re.S | re.I)
A_TREND = re.compile(r"^trend\s*no\.?\s*(\d{1,2})\s*[:.)-]\s*(.+)$", re.I)


def _klartext(roh):
    text = html.unescape(re.sub(r"<[^>]+>", " ", roh))
    return re.sub(r"\s+", " ", text.replace("\u00a0", " ")).strip()


def quelle_a_titel(roh_html):
    """Die zehn Listen-Ueberschriften der Pressemitteilung.

    Zwei mechanische Formen, beide auf JEDEN Snapshot angewandt; genommen wird die,
    die genau zehn Titel liefert. Liefert keine zehn, ist der Jahrgang eine LUECKE -
    es wird nichts aus dem Fliesstext geraten und nichts von Hand nachgetragen.
      A1  Die fett gesetzten Trend-Namen zwischen dem Titel (h3) und dem ersten
          fett gesetzten "About ..." - so setzt Gartner die Liste seit 2017.
      A2  Die Form "Trend No. 3: Hyperautomation" in Ueberschrift oder Fettdruck.
    """
    text = roh_html.decode("utf-8", "replace")
    stuecke = [(m.group(1).lower(), _klartext(m.group(2))) for m in A_BLOCK.finditer(text)]

    nummeriert = []
    for _, klartext in stuecke:
        treffer = A_TREND.match(klartext)
        if treffer:
            paar = (int(treffer.group(1)), treffer.group(2).strip())
            if paar not in nummeriert:
                nummeriert.append(paar)
    if len(nummeriert) == 10:
        return [t for _, t in sorted(nummeriert, key=lambda p: p[0])]

    start = None
    for i, (tag, klartext) in enumerate(stuecke):
        if tag == "h3" and "top 10 strategic technology trends" in klartext.lower():
            start = i + 1
            break
    if start is not None:
        fett = []
        for tag, klartext in stuecke[start:]:
            if tag not in ("strong", "b"):
                continue
            if klartext.lower().startswith("about "):
                break
            if klartext and klartext not in fett:
                fett.append(klartext)
        if len(fett) == 10:
            return fett
    return []


# ── Quelle C: MIT Technology Review 10 Breakthrough Technologies ───────────────

C_ARCHIV = "https://www.technologyreview.com/supertopic/tr10-archive/"
C_JAHRESSEITE = "https://www.technologyreview.com/10-breakthrough-technologies/%d/"
C_JAHRE = list(range(2001, 2025))

# Drei mechanische Formen, in denen die Liste auf den Seiten steht. Alle drei werden
# auf JEDE Seite angewandt; genommen wird die Form, die genau zehn Titel liefert.
# Eine Seite, die unter keiner Form zehn Titel hergibt, ist eine Luecke - nie ein
# Handgriff. (Das ist die Stelle, an der eine Sonderbehandlung je Jahrgang eine
# stille Auswahl-Entscheidung waere.)
#
# Form 1 traegt Titel UND Adresse, weil dieselbe Bauform auf derselben Seite auch die
# Jahres-Navigation rendert. Die Navigation zeigt auf /10-breakthrough-technologies/
# JJJJ/, die Listeneintraege auf den Artikel. Ohne diese Trennung liefert die Seite 48
# statt 10 Titel - der erste Lauf ist genau daran gescheitert und hat 20 Jahrgaenge
# still als Luecke gebucht.
C_LISTE = re.compile(r'"name":"list-menu-item","config":\{"title":"(.*?)","url":"(.*?)"')
# Die Jahres-Navigation erkennt man NICHT zuverlaessig an der Adresse: sie zeigt mal
# auf die Jahresseite, mal auf einen Artikel, mal auf ein PDF (Jahrgang 2001). Was
# sie ausnahmslos auszeichnet, ist die Beschriftung - eine nackte vierstellige
# Jahreszahl. Das ist eine FORM-Regel, kein Urteil ueber Inhalte: eine Technologie
# heisst nie "2010". Der Adressfilter bleibt zusaetzlich stehen.
C_JAHRESNAV = re.compile(r"/10-breakthrough-technologies/\d{4}/?$")
C_JAHRESZAHL = re.compile(r"^(19|20)\d{2}$")
# Form 2 nummeriert die Eintraege im Element-Namen. Genommen werden die Nummern 1 bis
# 10 - der Jahrgang 2022 fuehrt zusaetzlich einen "11. Durchbruch" aus einer
# Leserabstimmung, der nicht Teil der Zehnerliste ist. Die Nummer entscheidet, nicht
# der Text; ein Text-Filter waere ein Urteil.
# Form 3 begrenzt die Ueberschrift auf 80 Zeichen ohne Anfuehrungszeichen, weil ein
# offenes .*? quer durch die ganze Seite laeuft und Datenmuell einsammelt.
C_FORMEN_NUMMERIERT = re.compile(r"tech-(\d+)-title[^>]*>(.*?)\\u003c/h3>")
C_FORMEN = [
    ("headline-anchor", re.compile(r'"headline":"([^"\\\\]{2,80})","link":"[^"]*#')),
]


def _nummerierte_titel(text):
    nach_nummer = {}
    for nummer, roh in C_FORMEN_NUMMERIERT.findall(text):
        n = int(nummer)
        if 1 <= n <= 10:
            nach_nummer.setdefault(n, _saeubere(roh))
    if len(nach_nummer) != 10:
        return []
    return [nach_nummer[n] for n in range(1, 11)]


def _saeubere(treffer):
    # Die Titel stehen in JSON-Zeichenketten. json.loads ist der EINE richtige
    # Entschluessler dafuer; unicode_escape wuerde Nicht-ASCII zerstoeren. Was json
    # nicht lesen kann, wird roh genommen statt geraten.
    try:
        titel = json.loads('"' + treffer + '"')
    except ValueError:
        titel = treffer
    titel = html.unescape(titel)
    return re.sub(r"\s+", " ", titel.replace("\u00a0", " ")).strip()


def c_titel(roh_html):
    text = roh_html.decode("utf-8", "replace")
    formen = [("list-menu-item", [t for t, u in C_LISTE.findall(text)
                                  if not C_JAHRESNAV.search(_saeubere(u))
                                  and not C_JAHRESZAHL.match(_saeubere(t))]),
              ("tech-title", _nummerierte_titel(text))]
    formen += [(name, muster.findall(text)) for name, muster in C_FORMEN]
    for name, rohtreffer in formen:
        gesehen = []
        for treffer in rohtreffer:
            titel = _saeubere(treffer)
            if titel and titel not in gesehen:
                gesehen.append(titel)
        if len(gesehen) == 10:
            return name, gesehen
    return None, []



def quelle_c_urls():
    rohbytes, status = hole(C_ARCHIV)
    if rohbytes is None:
        raise Bruch("Das TR10-Archiv ist nicht abrufbar (HTTP %s)" % status)
    archiv_hash = versiegle("roh", rohbytes)
    text = rohbytes.decode("utf-8", "replace")
    artikel = {}
    for treffer in re.finditer(
            r"https://www\.technologyreview\.com/(\d{4})/\d{2}/\d{2}/\d+/10-breakthrough-technologies-(\d{4})/",
            text):
        artikel[int(treffer.group(2))] = treffer.group(0)
    plan = {}
    for jahr in C_JAHRE:
        plan[jahr] = [C_JAHRESSEITE % jahr]
        if jahr in artikel:
            plan[jahr].append(artikel[jahr])
    return archiv_hash, plan


# ── Quelle B: Gartner Hype Cycle for Emerging Technologies ────────────────────

B_MUSTER = re.compile(r"/(\d{4})-\d{2}-\d{2}-[^/]*hype-cycle[^/]*emerging[^/]*/?$", re.I)


def quelle_b_urls():
    hashes, zeilen = cdx_alle("gartner.com/en/newsroom/press-releases/*")
    return hashes, kandidaten(zeilen, B_MUSTER, 1)


B_BILD = re.compile(r'https?://[^"\'<> ]+\.(?:png|jpg|jpeg|gif|svg|webp)', re.I)


def b_bilder(roh_html):
    text = roh_html.decode("utf-8", "replace")
    kandidaten = []
    for url in B_BILD.findall(text):
        kurz = url.lower()
        if "hype" in kurz or "hc_" in kurz or "emerging" in kurz:
            if url not in kandidaten:
                kandidaten.append(url)
    return kandidaten


# ── Befehl: register ──────────────────────────────────────────────────────────

WAYBACK = "http://web.archive.org/web/%sid_/%s"


def _erster_treffer(kandidatenliste, extraktor, quelle, jahrgang, luecken, hoechstens=4):
    """Probiert die Snapshot-Kandidaten in der festgelegten Reihenfolge. Der erste,
    der zehn Titel hergibt, gewinnt. Gibt keiner zehn her, ist der Jahrgang eine
    Luecke - mit Begruendung je Kandidat, damit sichtbar bleibt, WORAN es lag."""
    gruende = []
    for _, zeitstempel, original in kandidatenliste[:hoechstens]:
        rohbytes, status = hole_archiv(WAYBACK % (zeitstempel, original))
        if rohbytes is None:
            gruende.append("%s -> HTTP %s" % (zeitstempel, status))
            continue
        titel = extraktor(rohbytes)
        if len(titel) == 10:
            return {"url": original, "waybackZeitstempel": zeitstempel,
                    "sha256": versiegle("roh", rohbytes), "bytes": len(rohbytes),
                    "titel": titel}, None
        gruende.append("%s -> %d statt 10 Titel" % (zeitstempel, len(titel)))
    return None, "; ".join(gruende) or "kein Snapshot im Index"


def befehl_register(argv):
    """Zieht die Register-Rohbytes. Optional nur einzelne Quellen ("register C").

    Quellenweise, weil das Internet Archive am 19.08.2026 mitten im Lauf komplett
    ausfiel: A und B haengen daran, C nicht. Ein Lauf, der bei jedem Ausfall alles
    verwirft, erzwingt am Ende die schlechte Wahl zwischen "warten" und "Quelle als
    Luecke buchen". Die Zusammenfuehrung ersetzt IMMER den vollstaendigen Bestand
    einer Quelle - nie einzelne Jahrgaenge, sonst koennte ein zweiter Lauf sich die
    besseren Jahrgaenge zusammensuchen."""
    quellen = "".join(argv).upper() or "ABC"
    for zeichen in quellen:
        if zeichen not in "ABC":
            raise Bruch("Unbekannte Quelle: %s (erlaubt sind A, B, C)" % zeichen)
    eintraege = []
    luecken = []

    # Quelle A - Gartner Top 10 Strategic Technology Trends
    if "A" in quellen:
        a_hashes, a_urls = quelle_a_urls()
        eintraege.append({"quelle": "A", "rolle": "index", "url": "wayback-cdx: gartner press-releases",
                          "sha256": a_hashes, "geholtAm": jetzt()})
        for jahrgang in range(2008, 2025):
            treffer, grund = _erster_treffer(a_urls.get(jahrgang, []), quelle_a_titel,
                                             "A", jahrgang, luecken)
            if treffer is None:
                luecken.append({"quelle": "A", "jahrgang": jahrgang, "grund": grund})
                continue
            eintrag = {"quelle": "A", "jahrgang": jahrgang}
            eintrag.update({k: v for k, v in treffer.items() if k != "titel"})
            eintrag["titelAnzahl"] = 10
            eintrag["geholtAm"] = jetzt()
            eintraege.append(eintrag)

    # Quelle B - Hype Cycle for Emerging Technologies. Ohne abrufbare Grafik: Luecke.
    if "B" in quellen:
        b_hashes, b_urls = quelle_b_urls()
        eintraege.append({"quelle": "B", "rolle": "index", "url": "wayback-cdx: gartner press-releases",
                          "sha256": b_hashes, "geholtAm": jetzt()})
        for jahrgang in range(2005, 2025):
            liste = b_urls.get(jahrgang, [])
            if not liste:
                luecken.append({"quelle": "B", "jahrgang": jahrgang,
                                "grund": "Keine Pressemitteilung 'Hype Cycle for Emerging Technologies' "
                                         "unter dem heutigen URL-Muster im Wayback-Index."})
                continue
            _, zeitstempel, original = liste[0]
            rohbytes, status = hole_archiv(WAYBACK % (zeitstempel, original))
            if rohbytes is None:
                luecken.append({"quelle": "B", "jahrgang": jahrgang, "grund": "Snapshot HTTP %s" % status})
                continue
            seite_hash = versiegle("roh", rohbytes)
            bild_hashes = []
            for bild_url in b_bilder(rohbytes)[:4]:
                bild_bytes, _ = hole_archiv(bild_url)
                if bild_bytes is None:
                    continue
                bild_hashes.append({"url": bild_url, "sha256": versiegle("bilder", bild_bytes),
                                    "bytes": len(bild_bytes)})
            eintraege.append({"quelle": "B", "jahrgang": jahrgang, "url": original,
                              "waybackZeitstempel": zeitstempel, "sha256": seite_hash,
                              "bytes": len(rohbytes), "grafiken": bild_hashes,
                              "transkription": [], "geholtAm": jetzt()})
            if not bild_hashes:
                luecken.append({"quelle": "B", "jahrgang": jahrgang,
                                "grund": "Pressemitteilung archiviert, aber keine Grafik im Snapshot - "
                                         "ohne Grafik keine Transkription (Prosa-Extraktion ist verboten)."})

    # Quelle C - MIT Technology Review
    if "C" in quellen:
        c_archiv, c_plan = quelle_c_urls()
        eintraege.append({"quelle": "C", "rolle": "index", "url": C_ARCHIV,
                          "sha256": c_archiv, "geholtAm": jetzt()})
        for jahr in C_JAHRE:
            erfolg = None
            gruende = []
            for url in c_plan[jahr]:
                rohbytes, status = hole(url)
                if rohbytes is None:
                    gruende.append("%s -> HTTP %s" % (url, status))
                    continue
                form, titel = c_titel(rohbytes)
                if len(titel) == 10:
                    erfolg = (url, versiegle("roh", rohbytes), len(rohbytes), form)
                    break
                gruende.append("%s -> %d Titel unter allen drei Formen" % (url, len(titel)))
            if erfolg is None:
                luecken.append({"quelle": "C", "jahrgang": jahr, "grund": "; ".join(gruende) or "keine URL"})
                continue
            url, h, groesse, form = erfolg
            eintraege.append({"quelle": "C", "jahrgang": jahr, "url": url, "sha256": h,
                              "bytes": groesse, "form": form, "titelAnzahl": 10, "geholtAm": jetzt()})

    alt = lies_json(MANIFEST) if os.path.exists(MANIFEST) else {"eintraege": [], "luecken": []}
    behalten = [e for e in alt["eintraege"] if e.get("quelle") not in quellen]
    behalten_l = [l for l in alt["luecken"] if l.get("quelle") not in quellen]
    manifest = {
        "schema": "strang-c-register-manifest/v1",
        "erzeugtAm": jetzt(),
        "regelDatei": "protocol/strang-c/C0-regel.md",
        "speicher": "$%s/strang-c/roh (gzip; gehasht wird der Klartext)" % DATENWURZEL_ENV,
        "zuletztGezogen": quellen,
        "eintraege": sorted(behalten + eintraege,
                            key=lambda e: (e["quelle"], e.get("jahrgang") or 0)),
        "luecken": sorted(behalten_l + luecken, key=lambda l: (l["quelle"], l["jahrgang"])),
    }
    schreib_json(MANIFEST, manifest)
    print(json.dumps({"eintraege": len(eintraege), "luecken": len(luecken),
                      "jeQuelle": {q: sum(1 for e in eintraege if e["quelle"] == q and "jahrgang" in e)
                                   for q in "ABC"}}, ensure_ascii=False, indent=1))
    return 0



# ── Befehl: vokabular ─────────────────────────────────────────────────────────

TRENNER = re.compile(r"/|&|,|\sand\s")
KLAMMER = re.compile(r"\([^)]*\)|\[[^\]]*\]")


def phrasen(titel):
    """Titel -> Suchphrasen. Genau die sechs Schritte aus Abschnitt 2 der Regel,
    in genau dieser Reihenfolge. Kein Synonym, kein Alias, keine Stoppliste."""
    text = html.unescape(titel)
    text = re.sub(r"\s+", " ", text.replace("\u00a0", " ")).strip()
    text = text.lower()
    text = KLAMMER.sub(" ", text)
    ergebnis = []
    for teil in TRENNER.split(text):
        teil = re.sub(r"\s+", " ", teil).strip(" -–—:;.")
        if not teil:
            continue
        if len(teil) <= 3 and teil.isalpha():
            continue
        if teil not in ergebnis:
            ergebnis.append(teil)
    return ergebnis


def titel_aus_manifest(manifest):
    """Liest die Titel aus den VERSIEGELTEN Rohbytes - nie aus dem Netz. Das ist die
    Stelle, an der die Reproduktion haengt: dieselbe Funktion, dieselben Bytes,
    dasselbe Vokabular."""
    aus = []
    for eintrag in manifest["eintraege"]:
        if "jahrgang" not in eintrag:
            continue
        quelle = eintrag["quelle"]
        rohbytes = entsiegle("roh", eintrag["sha256"])
        if quelle == "A":
            titel = quelle_a_titel(rohbytes)
        elif quelle == "C":
            _, titel = c_titel(rohbytes)
        else:
            titel = eintrag.get("transkription", [])
        for t in titel:
            aus.append((quelle, eintrag["jahrgang"], t))
    return aus


def befehl_vokabular(_argv):
    manifest = lies_json(MANIFEST)
    roh = titel_aus_manifest(manifest)
    tabelle = {}
    for quelle, jahrgang, titel in roh:
        for phrase in phrasen(titel):
            eintrag = tabelle.setdefault(phrase, {"phrase": phrase, "herkunft": []})
            spur = {"quelle": quelle, "jahrgang": jahrgang, "titel": titel}
            if spur not in eintrag["herkunft"]:
                eintrag["herkunft"].append(spur)
    vokabular = {
        "schema": "strang-c-vokabular/v1",
        "erzeugtAm": jetzt(),
        "regelAbschnitt": "C0-regel.md Abschnitt 2",
        "titelGesamt": len(roh),
        "phrasenGesamt": len(tabelle),
        "phrasen": [tabelle[k] for k in sorted(tabelle)],
    }
    schreib_json(VOKABULAR, vokabular)
    print(json.dumps({"titel": len(roh), "phrasen": len(tabelle)}, ensure_ascii=False))
    return 0


# ── Befehl: freeze1 ───────────────────────────────────────────────────────────

def dateihash(pfad):
    with open(pfad, "rb") as f:
        return sha256(f.read())


def kanonisch(obj):
    """Die Kanonisierung des Zugriffs-Registers, wortgleich zu lib/studie-verfassung.js:
    json.dumps(obj, sort_keys=True, ensure_ascii=False)."""
    return json.dumps(obj, sort_keys=True, ensure_ascii=False)


def eintragshash(event, previous_hash):
    ohne = {k: v for k, v in event.items() if k != "eventHash"}
    ohne["previousHash"] = previous_hash
    return hashlib.sha256(kanonisch(ohne).encode("utf-8")).hexdigest()


def haenge_an_register(eintrag):
    register = lies_json(LEDGER)
    events = register.get("events", [])
    if any(e.get("runId") == eintrag["runId"] for e in events):
        raise Bruch("runId %s steht schon im Register" % eintrag["runId"])
    vorher = events[-1]["eventHash"] if events else register["genesisSha256"]
    voll = dict(eintrag)
    voll["previousHash"] = vorher
    voll["eventHash"] = eintragshash(voll, vorher)
    register["events"] = events + [voll]
    with open(LEDGER, "w", encoding="utf-8", newline="\n") as f:
        f.write(json.dumps(register, ensure_ascii=False, indent=1) + "\n")
    return voll


def buendelhash(paare):
    """SHA-256 ueber ein benanntes Buendel: die Namen sortiert, je Zeile
    'name  sha256'. Ein Buendelhash ohne die Namen waere gegen Umbenennen blind."""
    zeilen = ["%s  %s" % (name, h) for name, h in sorted(paare)]
    return sha256("\n".join(zeilen).encode("utf-8")), zeilen


def befehl_freeze1(argv):
    zugriff_ab = argv[0] if argv else None
    if not zugriff_ab:
        raise Bruch("freeze1 braucht --zugriff-ab als erstes Argument (ISO-Zeit, spaeter als jetzt)")
    paare = [
        ("protocol/strang-c/C0-regel.md", dateihash(REGEL)),
        ("protocol/strang-c/C0-register-manifest.json", dateihash(MANIFEST)),
        ("protocol/strang-c/C0-vokabular.json", dateihash(VOKABULAR)),
    ]
    gesamt, zeilen = buendelhash(paare)
    freeze = {
        "schema": "strang-c-freeze/v1",
        "stufe": "FREEZE_1",
        "erzeugtAm": jetzt(),
        "bedeutung": "Regeltext, Register-Rohbytes-Manifest und Vokabular sind ab hier eingefroren. "
                     "Jede EDGAR-Zaehlung nach diesem Hash arbeitet auf genau diesem Vokabular.",
        "buendel": zeilen,
        "buendelSha256": gesamt,
    }
    schreib_json(FREEZE1, freeze)
    eintrag = haenge_an_register({
        "runId": "c0-freeze1-2026-08-19",
        "typ": "C0_REGELFREEZE",
        "registeredAt": jetzt(),
        "accessedAt": zugriff_ab,
        "fenster": ["kein Studienfenster - lebende EDGAR-Volltextsuche"],
        "allowedOutputs": ["dokument_treffer", "eindeutige_ciks", "filer_liste", "spike_jahr", "leiter_schritt"],
        "erlaubt": "Zaehlung eindeutiger CIKs in 10-K-Volltexten der lebenden EDGAR-Volltextsuche und die "
                   "daraus abgeleitete Themenliste samt Filer-Listen. Die Filer-Listen sind ausdruecklich "
                   "erlaubt - eine spaetere Etappe leitet daraus Korb-Mitgliedschaften jaehrlich neu ab.",
        "verboten": "Jeder Kurs-, Rendite-, Marktwert- oder Ergebniswert; jeder Zugriff auf den versiegelten "
                    "SEC-Speicher oder auf Schluesselmaterial; jede Aenderung am Vokabular nach diesem Hash.",
        "begruendung": "C0 Strang C - Themenliste per Vorab-Regel. Eingefroren: Regeltext + "
                       "Register-Manifest + Vokabular, Buendel-SHA-256 %s. Die EDGAR-Zaehlung darf erst "
                       "nach der Server-Bestaetigung dieses Eintrags starten." % gesamt,
        "endtestSiegel": "unberuehrt - C0 fasst den versiegelten Speicher nicht an und braucht ihn nicht. "
                         "Gezaehlt wird ausschliesslich im lebenden EDGAR-Volltextdienst.",
    })
    print(json.dumps({"buendelSha256": gesamt, "eventHash": eintrag["eventHash"],
                      "registeredAt": eintrag["registeredAt"], "accessedAt": zugriff_ab},
                     ensure_ascii=False, indent=1))
    return 0


# ── EDGAR ─────────────────────────────────────────────────────────────────────

EFTS = ("https://efts.sec.gov/LATEST/search-index?q=%s&forms=10-K&dateRange=custom"
        "&startdt=%d-01-01&enddt=%d-12-31")


def edgar_url(phrase, jahr, ab=None):
    q = urllib.parse.quote('"%s"' % phrase, safe="")
    url = EFTS % (q, jahr, jahr)
    if ab is not None:
        url += "&from=%d" % ab
    return url


def edgar_hole(phrase, jahr, ab=None, protokoll=None):
    url = edgar_url(phrase, jahr, ab)
    rohbytes, status = hole(url, mindestabstand=0.11)
    if rohbytes is None:
        raise Bruch("EDGAR antwortet HTTP %s auf %s" % (status, url))
    h = versiegle("edgar", rohbytes)
    if protokoll is not None:
        protokoll.write(json.dumps({"phrase": phrase, "jahr": jahr, "from": ab,
                                    "url": url, "sha256": h, "bytes": len(rohbytes),
                                    "geholtAm": jetzt()}, ensure_ascii=False) + "\n")
        protokoll.flush()
    return json.loads(rohbytes.decode("utf-8", "replace")), h


def treffer_gesamt(antwort):
    gesamt = antwort["hits"]["total"]
    if gesamt.get("relation") != "eq":
        raise Bruch("EDGAR liefert keine exakte Trefferzahl (relation=%s)" % gesamt.get("relation"))
    return int(gesamt["value"])


def filer_aus(antwort):
    """Zieht (cik, name, adsh, datum) aus den Treffern. Ein Treffer kann mehrere CIKs
    tragen (Mit-Registranten); alle zaehlen, weil die Regel 'eindeutige CIKs mit
    mindestens einem Filing' sagt."""
    aus = []
    for treffer in antwort["hits"]["hits"]:
        quelle = treffer["_source"]
        if "10-K" not in (quelle.get("root_forms") or []):
            continue
        namen = quelle.get("display_names") or []
        for i, cik in enumerate(quelle.get("ciks") or []):
            aus.append({
                "cik": str(cik).zfill(10),
                "name": namen[i] if i < len(namen) else (namen[0] if namen else ""),
                "adsh": quelle.get("adsh"),
                "datum": quelle.get("file_date"),
                "form": quelle.get("form"),
            })
    return aus


# ── Befehl: screen ────────────────────────────────────────────────────────────

def screen_pfad():
    return os.path.join(rohordner("."), "C0-screen.jsonl")


def query_log_pfad():
    return os.path.join(rohordner("."), "C0-query-log.jsonl")


def gelesen(pfad, schluessel):
    fertig = {}
    if os.path.exists(pfad):
        with open(pfad, "r", encoding="utf-8") as f:
            for zeile in f:
                zeile = zeile.strip()
                if not zeile:
                    continue
                satz = json.loads(zeile)
                fertig[schluessel(satz)] = satz
    return fertig


def befehl_screen(_argv):
    vokabular = lies_json(VOKABULAR)
    freeze = lies_json(FREEZE1)
    # Fail-closed: der Screen laeuft nur auf dem eingefrorenen Vokabular.
    ist = dateihash(VOKABULAR)
    soll = dict(z.rsplit("  ", 1) for z in freeze["buendel"])["protocol/strang-c/C0-vokabular.json"]
    if ist != soll:
        raise Bruch("Das Vokabular weicht vom FREEZE-1-Stand ab (%s statt %s)" % (ist, soll))

    pfad = screen_pfad()
    fertig = gelesen(pfad, lambda s: (s["phrase"], s["jahr"]))
    protokoll = open(query_log_pfad(), "a", encoding="utf-8", newline="\n")
    ausgabe = open(pfad, "a", encoding="utf-8", newline="\n")
    gesamt = len(vokabular["phrasen"]) * len(EDGAR_JAHRE)
    n = 0
    try:
        for eintrag in vokabular["phrasen"]:
            phrase = eintrag["phrase"]
            for jahr in EDGAR_JAHRE:
                n += 1
                if (phrase, jahr) in fertig:
                    continue
                antwort, h = edgar_hole(phrase, jahr, ab=AUTO_PASS_TREFFER, protokoll=protokoll)
                satz = {"phrase": phrase, "jahr": jahr, "treffer": treffer_gesamt(antwort), "sha256": h}
                ausgabe.write(json.dumps(satz, ensure_ascii=False) + "\n")
                ausgabe.flush()
                if n % 500 == 0:
                    sys.stderr.write("screen %d/%d\n" % (n, gesamt))
                    sys.stderr.flush()
    finally:
        ausgabe.close()
        protokoll.close()
    print(json.dumps({"screenZeilen": sum(1 for _ in open(pfad, encoding="utf-8"))}, ensure_ascii=False))
    return 0


# ── Befehl: zaehlen ───────────────────────────────────────────────────────────

def zaehl_pfad():
    return os.path.join(rohordner("."), "C0-zaehlung.jsonl")


def exakt_zaehlen(phrase, jahr, protokoll):
    """D(phrase, jahr) exakt, mit vollstaendiger Filer-Liste. Bei mehr als
    AUTO_PASS_TREFFER Dokument-Treffern gibt EDGAR keine vollstaendige Liste heraus -
    dann gilt die Regel-Sonderklausel und die Filer-Liste ist ausdruecklich
    unvollstaendig (Kennzeichnung 'gedeckelt')."""
    antwort, h = edgar_hole(phrase, jahr, ab=None, protokoll=protokoll)
    gesamt = treffer_gesamt(antwort)
    filer = filer_aus(antwort)
    hashes = [h]
    gedeckelt = False
    if gesamt > AUTO_PASS_TREFFER:
        gedeckelt = True
    else:
        ab = 100
        while ab < gesamt:
            weiter, wh = edgar_hole(phrase, jahr, ab=ab, protokoll=protokoll)
            hashes.append(wh)
            filer.extend(filer_aus(weiter))
            ab += 100
    ciks = sorted({f["cik"] for f in filer})
    max_ciks = 0
    for treffer in antwort["hits"]["hits"]:
        max_ciks = max(max_ciks, len(treffer["_source"].get("ciks") or []))
    return {"phrase": phrase, "jahr": jahr, "treffer": gesamt, "D": len(ciks),
            "gedeckelt": gedeckelt, "ciks": ciks, "filer": filer,
            "maxCiksJeTreffer": max_ciks, "antworten": hashes}


def befehl_zaehlen(_argv):
    screen = gelesen(screen_pfad(), lambda s: (s["phrase"], s["jahr"]))
    if not screen:
        raise Bruch("Kein Screen-Stand vorhanden - erst 'screen' laufen lassen")
    schwelle = BASIS_SCHWELLE
    mindest = max(1, -(-schwelle // SCREEN_RESERVE))
    # Kandidaten: Spike-Jahre, die den Dokument-Screen passieren - plus ihre Basisjahre.
    noetig = set()
    for (phrase, jahr), satz in screen.items():
        if jahr in SPIKE_JAHRE and satz["treffer"] >= mindest:
            noetig.add((phrase, jahr))
            noetig.add((phrase, jahr - BASIS_ABSTAND))
    pfad = zaehl_pfad()
    fertig = gelesen(pfad, lambda s: (s["phrase"], s["jahr"]))
    offen = sorted(k for k in noetig if k not in fertig)
    protokoll = open(query_log_pfad(), "a", encoding="utf-8", newline="\n")
    ausgabe = open(pfad, "a", encoding="utf-8", newline="\n")
    try:
        for i, (phrase, jahr) in enumerate(offen, 1):
            satz = exakt_zaehlen(phrase, jahr, protokoll)
            ausgabe.write(json.dumps(satz, ensure_ascii=False) + "\n")
            ausgabe.flush()
            if i % 100 == 0:
                sys.stderr.write("zaehlen %d/%d\n" % (i, len(offen)))
                sys.stderr.flush()
    finally:
        ausgabe.close()
        protokoll.close()
    print(json.dumps({"noetig": len(noetig), "neu": len(offen), "mindestTreffer": mindest},
                     ensure_ascii=False))
    return 0


# ── Befehl: ableiten ──────────────────────────────────────────────────────────

def spike_jahre(zaehlung, schwelle, faktor):
    """Fuer jede Phrase das frueheste Jahr, das beide Bedingungen erfuellt."""
    treffer = {}
    for phrase in sorted({s["phrase"] for s in zaehlung.values()}):
        for jahr in SPIKE_JAHRE:
            hier = zaehlung.get((phrase, jahr))
            if hier is None:
                continue
            d_t = schwelle if hier["gedeckelt"] else hier["D"]
            if d_t < schwelle:
                continue
            basis = zaehlung.get((phrase, jahr - BASIS_ABSTAND))
            if basis is None:
                # Fail-closed: ohne Basisjahr ist die zweite Bedingung NICHT BERECHENBAR.
                continue
            d_b = basis["D"]
            if d_t >= faktor * (d_b + 1):
                treffer[phrase] = {"jahr": jahr, "D": d_t, "D_basis": d_b,
                                   "gedeckelt": hier["gedeckelt"]}
                break
    return treffer


def jaccard(a, b):
    a, b = set(a), set(b)
    if not a and not b:
        return 0.0
    return len(a & b) / float(len(a | b))


def zusammenlegen(spikes, zaehlung):
    """Union-Find ueber die Paar-Regel. Name = frueher spikender Begriff, bei
    Gleichstand alphabetisch erster - damit haengt das Ergebnis nicht an der
    Reihenfolge des Laufs."""
    phrasen_liste = sorted(spikes)
    eltern = {p: p for p in phrasen_liste}

    def finde(x):
        while eltern[x] != x:
            eltern[x] = eltern[eltern[x]]
            x = eltern[x]
        return x

    paare = []
    for i, a in enumerate(phrasen_liste):
        for b in phrasen_liste[i + 1:]:
            if abs(spikes[a]["jahr"] - spikes[b]["jahr"]) > 2:
                continue
            ja = zaehlung.get((a, spikes[a]["jahr"]), {}).get("ciks", [])
            jb = zaehlung.get((b, spikes[b]["jahr"]), {}).get("ciks", [])
            wert = jaccard(ja, jb)
            if wert >= 0.5:
                paare.append({"a": a, "b": b, "jaccard": round(wert, 4),
                              "abstand": abs(spikes[a]["jahr"] - spikes[b]["jahr"])})
                ra, rb = finde(a), finde(b)
                if ra != rb:
                    eltern[ra] = rb
    gruppen = {}
    for p in phrasen_liste:
        gruppen.setdefault(finde(p), []).append(p)
    themen = []
    for mitglieder in gruppen.values():
        mitglieder.sort(key=lambda p: (spikes[p]["jahr"], p))
        name = mitglieder[0]
        themen.append({"thema": name, "spikeJahr": spikes[name]["jahr"], "D": spikes[name]["D"],
                       "D_basis": spikes[name]["D_basis"], "gedeckelt": spikes[name]["gedeckelt"],
                       "begriffe": mitglieder, "herkunft": "REGEL"})
    themen.sort(key=lambda t: (t["spikeJahr"], t["thema"]))
    return themen, paare


LEITER_PLAN = [
    # (Bedingung auf den Zaehlstand, Beschreibung, neue Schwelle, neuer Faktor)
    ("zu_viele", "Wachstumsfaktor 3 -> 4", BASIS_SCHWELLE, 4.0),
    ("zu_viele", "Wachstumsfaktor 4 -> 5", BASIS_SCHWELLE, 5.0),
    ("zu_viele", "Schwelle 20 -> 30", 30, 5.0),
    ("zu_wenige", "Schwelle 20 -> 15", 15, BASIS_FAKTOR),
    ("zu_wenige", "Faktor 3 -> 2,5", 15, 2.5),
]


def befehl_ableiten(_argv):
    zaehlung = {}
    with open(zaehl_pfad(), "r", encoding="utf-8") as f:
        for zeile in f:
            zeile = zeile.strip()
            if zeile:
                satz = json.loads(zeile)
                zaehlung[(satz["phrase"], satz["jahr"])] = satz

    schritte = []
    schwelle, faktor = BASIS_SCHWELLE, BASIS_FAKTOR
    spikes = spike_jahre(zaehlung, schwelle, faktor)
    themen, paare = zusammenlegen(spikes, zaehlung)
    schritte.append({"schritt": 0, "beschreibung": "Basisregel", "schwelle": schwelle,
                     "faktor": faktor, "themen": len(themen)})
    for art, text, neue_schwelle, neuer_faktor in LEITER_PLAN:
        anzahl = len(themen)
        if HANDLUNGSBAND[0] <= anzahl <= HANDLUNGSBAND[1]:
            break
        gebraucht = "zu_viele" if anzahl > HANDLUNGSBAND[1] else "zu_wenige"
        if gebraucht != art:
            continue
        schwelle, faktor = neue_schwelle, neuer_faktor
        spikes = spike_jahre(zaehlung, schwelle, faktor)
        themen, paare = zusammenlegen(spikes, zaehlung)
        schritte.append({"schritt": len(schritte), "beschreibung": text, "schwelle": schwelle,
                         "faktor": faktor, "themenVorher": anzahl, "themen": len(themen),
                         "ausgeloestDurch": "Zaehlstand %d liegt ausserhalb des Handlungsbandes %s"
                                            % (anzahl, str(HANDLUNGSBAND))})
    leiter = {
        "schema": "strang-c-leiter-log/v1",
        "erzeugtAm": jetzt(),
        "zielband": list(ZIELBAND),
        "handlungsband": list(HANDLUNGSBAND),
        "regel": "Ausgeloest wird ausschliesslich von der ANZAHL der Themen, nie von der Frage, "
                 "welche Themen drin oder draussen sind.",
        "schritte": schritte,
        "endstand": {"schwelle": schwelle, "faktor": faktor, "themen": len(themen)},
        "bandVerfehlt": not (HANDLUNGSBAND[0] <= len(themen) <= HANDLUNGSBAND[1]),
        "befundWennVerfehlt": "Registerklasse zu schmal - die Regel wird berichtet, nicht gebogen.",
    }
    schreib_json(LEITER, leiter)

    # Mandats-Ergaenzung: die Pflicht-Verwechsler, die die Regel nicht selbst erzeugt hat.
    selbst = set()
    for thema in themen:
        for begriff in thema["begriffe"]:
            selbst.add(begriff)
    mandate = []
    for name in PFLICHT_VERWECHSLER:
        erzeugt = [t for t in themen
                   if any(_verwechsler_trifft(name, b) for b in t["begriffe"])]
        if erzeugt:
            for t in erzeugt:
                t.setdefault("pflichtVerwechsler", []).append(name)
            continue
        mandate.append({"thema": name, "spikeJahr": None, "D": None, "begriffe": [],
                        "herkunft": "MANDAT",
                        "grund": "Pflicht-Verwechsler, von der Regel nicht selbst erzeugt. "
                                 "Unloeschbar markiert; jede Marker-Auswertung laeuft einmal "
                                 "mit und einmal ohne Mandats-Themen."})

    liste = {
        "schema": "strang-c-themenliste/v1",
        "erzeugtAm": jetzt(),
        "endparameter": {"schwelle": schwelle, "faktor": faktor},
        "regelThemen": len(themen),
        "mandatsThemen": len(mandate),
        "themen": themen + mandate,
        "zusammenlegungen": paare,
    }
    schreib_json(THEMEN, liste)

    os.makedirs(FILER_DIR, exist_ok=True)
    for alt in os.listdir(FILER_DIR):
        if alt.endswith(".json"):
            os.remove(os.path.join(FILER_DIR, alt))
    for thema in themen:
        zeilen = []
        gesehen = set()
        for begriff in thema["begriffe"]:
            satz = zaehlung.get((begriff, thema["spikeJahr"]))
            if satz is None:
                continue
            for f in satz["filer"]:
                schluessel = (f["cik"], f["adsh"])
                if schluessel in gesehen:
                    continue
                gesehen.add(schluessel)
                zeilen.append(f)
        zeilen.sort(key=lambda f: (f["cik"], f["adsh"] or ""))
        schreib_json(os.path.join(FILER_DIR, _dateiname(thema["thema"]) + ".json"), {
            "schema": "strang-c-filer/v1",
            "thema": thema["thema"],
            "spikeJahr": thema["spikeJahr"],
            "begriffe": thema["begriffe"],
            "gedeckelt": thema["gedeckelt"],
            "filer": zeilen,
        })
    print(json.dumps({"regelThemen": len(themen), "mandate": [m["thema"] for m in mandate],
                      "leiterSchritte": len(schritte) - 1, "endschwelle": schwelle,
                      "endfaktor": faktor}, ensure_ascii=False, indent=1))
    return 0


VERWECHSLER_PHRASEN = {
    "3D-Druck": ["3d printing", "3-d printing", "additive manufacturing", "3d print"],
    "Metaverse": ["metaverse"],
    "Wasserstoff": ["hydrogen", "green hydrogen", "hydrogen economy", "fuel cell"],
    "Cannabis": ["cannabis", "marijuana"],
    "Blockchain": ["blockchain", "distributed ledger"],
}


def _verwechsler_trifft(name, begriff):
    return any(kern in begriff for kern in VERWECHSLER_PHRASEN[name])


def _dateiname(text):
    sicher = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return sicher[:80] or "thema"


# ── Befehl: freeze2 und pruefen ───────────────────────────────────────────────

def buendel2():
    paare = [
        ("protocol/strang-c/C0-themenliste.json", dateihash(THEMEN)),
        ("protocol/strang-c/C0-leiter-log.json", dateihash(LEITER)),
        ("protocol/strang-c/C0-freeze1.json", dateihash(FREEZE1)),
    ]
    for name in sorted(os.listdir(FILER_DIR)):
        if name.endswith(".json"):
            paare.append(("protocol/strang-c/filer/" + name, dateihash(os.path.join(FILER_DIR, name))))
    for name, pfad in (("C0-query-log.jsonl", query_log_pfad()),
                       ("C0-screen.jsonl", screen_pfad()),
                       ("C0-zaehlung.jsonl", zaehl_pfad())):
        paare.append(("$%s/strang-c/%s" % (DATENWURZEL_ENV, name), dateihash(pfad)))
    return buendelhash(paare)


def befehl_freeze2(_argv):
    gesamt, zeilen = buendel2()
    freeze = {
        "schema": "strang-c-freeze/v1",
        "stufe": "FREEZE_2",
        "erzeugtAm": jetzt(),
        "bedeutung": "Themenliste, Filer-Listen, Query-Log und Leiter-Log sind ab hier eingefroren.",
        "buendel": zeilen,
        "buendelSha256": gesamt,
    }
    schreib_json(FREEZE2, freeze)
    eintrag = haenge_an_register({
        "runId": "c0-freeze2-2026-08-19",
        "typ": "C0_REGELFREEZE",
        "registeredAt": jetzt(),
        "accessedAt": jetzt(),
        "fenster": ["kein Studienfenster - lebende EDGAR-Volltextsuche"],
        "allowedOutputs": ["themenliste", "filer_liste", "leiter_log", "query_log"],
        "erlaubt": "Veroeffentlichung der abgeleiteten Themenliste und der Filer-Listen.",
        "verboten": "Jede nachtraegliche Aenderung an Themenliste, Filer-Listen oder Leiter-Log.",
        "begruendung": "C0 FREEZE 2 - Buendel-SHA-256 %s ueber Themenliste, Filer-Listen, "
                       "Query-Log und Leiter-Log." % gesamt,
        "endtestSiegel": "unberuehrt",
    })
    print(json.dumps({"buendelSha256": gesamt, "eventHash": eintrag["eventHash"]},
                     ensure_ascii=False, indent=1))
    return 0


def befehl_pruefen(_argv):
    """Der Waechter. Er nagelt die SACHE fest - den Inhalt des Buendels, nicht ein
    Schreibmuster. Ein umbenanntes Thema aendert den Datei-Hash und faellt auf."""
    freeze = lies_json(FREEZE2)
    gesamt, zeilen = buendel2()
    fehler = []
    soll = dict(z.rsplit("  ", 1) for z in freeze["buendel"])
    ist = dict(z.rsplit("  ", 1) for z in zeilen)
    for name in sorted(set(soll) | set(ist)):
        if soll.get(name) != ist.get(name):
            fehler.append({"datei": name, "soll": soll.get(name), "ist": ist.get(name)})
    if gesamt != freeze["buendelSha256"]:
        fehler.append({"datei": "<buendel>", "soll": freeze["buendelSha256"], "ist": gesamt})
    if fehler:
        print(json.dumps({"status": "ROT", "abweichungen": fehler}, ensure_ascii=False, indent=1))
        return 1
    print(json.dumps({"status": "GRUEN", "buendelSha256": gesamt, "dateien": len(zeilen)},
                     ensure_ascii=False, indent=1))
    return 0


# ── Befehl: reproduzieren ─────────────────────────────────────────────────────

def befehl_reproduzieren(_argv):
    """Leitet Vokabular und Themenliste ein zweites Mal aus den VERSIEGELTEN Bytes ab
    und vergleicht byte-genau. Gegen die Siegel, nicht gegen den lebenden Index."""
    manifest = lies_json(MANIFEST)
    roh = titel_aus_manifest(manifest)
    tabelle = {}
    for quelle, jahrgang, titel in roh:
        for phrase in phrasen(titel):
            eintrag = tabelle.setdefault(phrase, {"phrase": phrase, "herkunft": []})
            spur = {"quelle": quelle, "jahrgang": jahrgang, "titel": titel}
            if spur not in eintrag["herkunft"]:
                eintrag["herkunft"].append(spur)
    vokabular_alt = lies_json(VOKABULAR)
    neu = [tabelle[k] for k in sorted(tabelle)]
    gleich_vok = neu == vokabular_alt["phrasen"]

    # Zaehlung zweitverwerten: aus den versiegelten EDGAR-Antworten neu aufbauen.
    zaehlung_alt = {}
    with open(zaehl_pfad(), "r", encoding="utf-8") as f:
        for zeile in f:
            zeile = zeile.strip()
            if zeile:
                s = json.loads(zeile)
                zaehlung_alt[(s["phrase"], s["jahr"])] = s
    abweichungen = []
    for (phrase, jahr), satz in sorted(zaehlung_alt.items()):
        filer = []
        for h in satz["antworten"]:
            antwort = json.loads(entsiegle("edgar", h).decode("utf-8", "replace"))
            filer.extend(filer_aus(antwort))
        d = len({f["cik"] for f in filer})
        if not satz["gedeckelt"] and d != satz["D"]:
            abweichungen.append({"phrase": phrase, "jahr": jahr, "D_datei": satz["D"], "D_siegel": d})
    print(json.dumps({"vokabularIdentisch": gleich_vok,
                      "zaehlungGeprueft": len(zaehlung_alt),
                      "zaehlungAbweichungen": abweichungen[:20],
                      "status": "GRUEN" if gleich_vok and not abweichungen else "ROT"},
                     ensure_ascii=False, indent=1))
    return 0 if gleich_vok and not abweichungen else 1


BEFEHLE = {
    "register": befehl_register,
    "vokabular": befehl_vokabular,
    "freeze1": befehl_freeze1,
    "screen": befehl_screen,
    "zaehlen": befehl_zaehlen,
    "ableiten": befehl_ableiten,
    "freeze2": befehl_freeze2,
    "pruefen": befehl_pruefen,
    "reproduzieren": befehl_reproduzieren,
}


def haupt(argv):
    if not argv or argv[0] not in BEFEHLE:
        sys.stderr.write("Aufruf: python scripts/studie-c0.py <%s>\n" % "|".join(BEFEHLE))
        return 2
    return BEFEHLE[argv[0]](argv[1:])


if __name__ == "__main__":
    try:
        sys.exit(haupt(sys.argv[1:]))
    except Bruch as fehler:
        sys.stderr.write("REGELBRUCH: %s\n" % fehler)
        sys.exit(1)

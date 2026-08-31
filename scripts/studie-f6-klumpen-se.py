#!/usr/bin/env python3
"""F6-SE-KLUMPEN/v1 - der klumpen-robuste SE des F6-Tors, blind gerechnet.

Eingefroren im Wortlaut durch _COURT-F6-VOLLZUG-2026-08-31 (Frage (d), 3:0),
Auflagen F6-B20 / F6-B22 / F6-B23, ratifiziert Session 07, 2026-08-31 22:19.

WAS DIESES MODUL IST
--------------------
Eine Funktion ueber (m_g, n_g)-Paare. Mehr nicht. Es zaehlt nichts, oeffnet
keine Lueckenliste, kein Prueffenster, kein Panel und keine data/lockbox, und
es kennt kein Ergebnis. Es konkretisiert ausschliesslich die RECHENREALISIERUNG
des bereits eingefrorenen Terms `SE_klumpen-robust` aus
`protocol/early-detection/2.1.0/b4-bandregel-2026-08-30.json`,
`vierGroessen.2_seRechenvorschrift`. Die Regel
`SE* = max(SE_binomial(p-Dach), SE_klumpen-robust)` bleibt Wort fuer Wort
unveraendert; beide SE sind Pflicht, beide werden berichtet (A16), der
groessere entscheidet.

BLIND BY CONSTRUCTION
---------------------
Die Eingabe ist eine UNGEORDNETE Liste von Zahlenpaaren. Das Modul nimmt keine
Firmen-Kennung entgegen - kein CIK, kein adsh, keinen Namen, keine Accession -
und kann deshalb keine sehen. Ein Eintrag, der etwas anderes ist als ein Paar
aus zwei Zahlen, ist ein ABBRUCH, kein Filter. Die Klumpungseinheit selbst
bleibt PIN 3 aus Register-Eintrag 23 (Klumpung nach Signal-Entitaet/Firma) und
wird ausserhalb dieses Moduls gebildet.

WARUM EINE EIGENE DATEI (F6-B22)
--------------------------------
`scripts/studie-vb-b4-band.py` bleibt Byte fuer Byte unangetastet: sein
Erzeugnis ist in Register-Eintrag 23 gepinnt, jede Beruehrung riskiert Drift am
gepinnten Artefakt (Kipp-Bedingung KV-1). Das Band-Modul wird unveraendert mit
`--se-binomial` und `--se-klumpen` aufgerufen; sein `se_stern()` bildet `max()`
ueber zwei bereits gerechnete Zahlen. Auch `scripts/studie-basisraten.py`
(versiegelt, PIN 2) bleibt unberuehrt.

DIE VORSCHRIFT (Wortlaut Ziffern 3 bis 6)
-----------------------------------------
  G       = Zahl verschiedener Klumpen
  n_g     = Zahl der Einheiten in Klumpen g
  m_g     = Summe der y_i in Klumpen g   (y_i = 1, wenn die Einheit REIF ist)
  N       = Summe_g n_g       M = Summe_g m_g       p-Dach = M / N
  S       = Summe_g (m_g - p-Dach * n_g)^2   -- math.fsum, reihenfolge-invariant
  SE      = Wurzel( (G / (G - 1)) * S ) / N

Das ist der gewoehnliche einwegs-klumpen-robuste (Sandwich-/Linearisierungs-)
Schaetzer fuer einen Anteil als Verhaeltnis zweier Klumpen-Summen; der Anteil
ist der KQ-Schaetzer eines reinen Achsenabschnitts, seine Klumpen-Score-
Beitraege sind genau (m_g - p-Dach * n_g).

KLEIN-KLUMPEN-KORREKTUR: GENAU G/(G-1), SONST NICHTS (Ziffer 6)
---------------------------------------------------------------
Stata-Form G/(G-1) * (N-1)/(N-k) mit k = 1; das zweite Glied ist dann identisch
1. Kein CR2/CR3 (Hebel-Korrektur braeuchte eine Designmatrix, die es hier nicht
gibt), keine Endlichkeitskorrektur, keine t-Freiheitsgrad-Ersetzung (die
Bandregel vergleicht gegen fixe 1*SE*, nicht gegen ein t-Quantil), kein
Jackknife, kein Bootstrap, kein Seed, keine Replikate. Der Schaetzer ist
geschlossen, deterministisch und aus den (m_g, n_g) von Hand nachrechenbar.

OFFENLEGUNG DER RICHTUNG (F6-B21 in der berichtigten Fassung, Pflicht)
----------------------------------------------------------------------
Fassung nach ORCHESTRATOR-NACHTRAG 2 zu _COURT-F6-VOLLZUG-2026-08-31
(2026-08-31 23:23 lokal). Die urspruengliche Klammer trug die falsche
ALLGEMEINE Schranke: Wurzel(N/(N-1)) ist nur der Singleton-Fall.

RICHTUNG. Der Faktor G/(G-1) wirkt ausschliesslich nach oben: er vergroessert
SE*, verbreitert das Band, macht NICHT UNTERSCHEIDBAR wahrscheinlicher und kann
ein BESTANDEN nie erzeugen - er erschwert es strikt.

GROESSENORDNUNG. Der Aufschlag auf SE* ist allgemein durch Wurzel(G/(G-1))
beschraenkt, im kleinstzulaessigen Fall G = 2 also durch Wurzel(2) (hoechstens
+41,4 %; G < 2 bricht ab), und faellt monoton mit der Klumpenzahl (+22,5 % bei
G = 3, +5,4 % bei G = 10, +0,5 % bei G = 100); im Entartungsfall ausschliesslich
einelementiger Klumpen (G = N - die nach PIN 3 erwartete Lage, deren Abweichung
KV-6 benennt) betraegt er exakt Wurzel(N/(N-1)) und bei der
Gate-Mindestfallzahl hoechstens +0,25 %.

GRUND. Die Wahl ist blind getroffen und hat zwei Gruende: ohne Faktor liefert
der Schaetzer bei G = 1 still eine Null und erzeugte damit genau den verbotenen
Rueckfall auf den kleineren SE; und ohne Faktor wird die Klumpung untertrieben -
die falschentdeckungs-anfaellige Richtung.

Die Gegenposition CR0 (V1) steht als Dissens DV-2 im Urteil. Keine spaetere
Instanz darf behaupten, die Wahl sei verborgen getroffen worden.

ENTARTUNGSFALL - EIGENSCHAFT DES MESSGERAETS, KEINE PROGNOSE (Ziffer 7, F6-B25)
------------------------------------------------------------------------------
Gilt n_g = 1 fuer alle g (dann G = N), so ist Summe_g (m_g - p-Dach)^2 =
N * p-Dach * (1 - p-Dach) und damit

  SE = Wurzel( p-Dach * (1 - p-Dach) / (N - 1) ) = SE_binomial * Wurzel(N/(N-1))

Der Schaetzer kollabiert dann exakt auf die (N-1)-Fassung des binomialen SE und
liegt nie darunter; SE* faellt konstruktiv auf SE_klumpen-robust, und die
A16-Pflichtangabe "welcher entschied" ist in diesem Fall VORAB determiniert.
Das ist vorab zu berichten, nie hinterher als Befund auszugeben. Echte Klumpen
mit n_g > 1 deckt dieselbe Formel ohne Fallunterscheidung ab. Diese Ziffer sagt
nichts ueber den Ausgang des Laufs.

SE = 0 IST NICHT GLEICH SE = 0 (Abgrenzung, NACHTRAG 2)
-------------------------------------------------------
Zwei verschiedene Nullen, und nur eine ist ein Schaden:
  * G = 1: die Residuen sind PER KONSTRUKTION 0, die Null traegt keine
    Information. Sie waere der verbotene Rueckfall auf den kleineren SE und
    wird deshalb im Korrekturfaktor abgefangen (Abbruch, nie ein Wert).
  * G >= 2 und alle Klumpen exakt auf dem Mittel (z. B. p-Dach in {0,1}):
    das ist eine ECHTE Schaetzung ohne Schadensmechanismus. max() nimmt dann
    den binomialen SE - erlaubt, kein Rueckfall, kein Abbruchgrund. Ziffer 8
    bleibt abschliessend wie ratifiziert.

NICHT BERECHENBAR - FAIL-CLOSED, ABSCHLIESSEND (Ziffer 8)
---------------------------------------------------------
Abbruch bei: G < 2 * ein n_g ist keine ganze Zahl >= 1 * ein m_g ist keine
ganze Zahl in [0, n_g] * Summe_g n_g ungleich dem berichteten N * Summe_g m_g
ungleich dem berichteten Zaehler * eine Nennereinheit ohne genau eine
Klumpen-Kennung (sie wird NIE stillschweigend fallengelassen) * p-Dach
ausserhalb [0,1] * irgendein nicht-endlicher Zwischenwert, wobei bool/NaN/inf
POSITIV ausgeschlossen werden (Muster `_zahl` aus `studie-vb-b4-band.py`).

Folge, unabaenderlich: `BandNichtAuswertbar` -> Zulaessigkeits-Gate gerissen ->
NICHT UNTERSCHEIDBAR, WEITER = 0. KEIN Rueckfall auf den kleineren SE. Dieses
Modul liefert dafuer keinen Wert und keinen Ersatzwert, sondern gar nichts: der
Abbruch geht nach stderr, stdout bleibt leer, der Exit-Code ist 1.

Die Fallzahl-Untergrenze `fallzahlMin` bleibt dort, wo sie eingefroren ist - im
Band-Modul. Sie wird hier NICHT zweitkopiert; zwei Kopien derselben Regel
driften.

Aufruf:
  python scripts/studie-f6-klumpen-se.py se --klumpen <datei.json>
                                            --n <N> --zaehler <M>
  python scripts/studie-f6-klumpen-se.py selbsttest

`<datei.json>` traegt eine ungeordnete Liste von Paaren: [[m_g, n_g], ...].
Ausgabe ist ausschliesslich {se_klumpen_robust, klumpen_anzahl, n, zaehler,
anteil} als JSON. Die Residuenquadratsumme S ist Zwischengroesse und wird NICHT
ausgegeben (F6-B14).
"""

import argparse
import json
import math
import sys


class SeNichtBerechenbar(Exception):
    """Die Vorschrift ist nicht rechenbar. Nie ein Wert, nie ein Ersatzwert."""


def _zahl(x):
    """Eine echte, endliche Zahl - kein bool, kein NaN, kein inf.

    Uebernommen aus `scripts/studie-vb-b4-band.py::_zahl` (Ziffer 8 verlangt
    genau dieses Muster). `bool` ist in Python ein `int`; ohne den Ausschluss
    ginge `True` als 1 durch. Und NaN ist der gefaehrlichste Fall von allen:
    JEDER Vergleich mit NaN ist False, eine Schranke der Form `if x < grenze`
    feuert also NIE. Deshalb wird hier positiv geprueft, was gelten MUSS, statt
    negativ, was nicht gelten darf.
    """
    if not isinstance(x, (int, float)) or isinstance(x, bool):
        return False
    try:
        return math.isfinite(x)
    except OverflowError:
        # Ein Python-int ohne Groessengrenze (10**400) laesst `isfinite`
        # abstuerzen. Ein Absturz waere hier KEIN Abbruch mit Grund, und die
        # Vorschrift verspricht auf jedem Pfad einen. Zu gross ist nicht
        # endlich.
        return False


def _ganzzahl(x):
    """Eine ganze Zahl - als int oder als float ohne Nachkommateil.

    Erst `_zahl`, dann die Ganzzahligkeit: die Reihenfolge ist die Sache. Auf
    NaN/inf ist `is_integer()` False bzw. wirft, auf `True` waere sie True.
    """
    if not _zahl(x):
        return None
    if isinstance(x, int):
        return x
    return int(x) if float(x).is_integer() else None


def _sicher(x):
    """Ein Wert, der in eine Fehlermeldung darf.

    Zahlen gehen als sie selbst hinaus: sie SIND der Grund des Abbruchs, sie
    sind das ganze Eingabe-Vokabular dieses Moduls, und ohne sie waere kein
    Abbruch diagnostizierbar. Alles andere - Zeichenketten, Listen, Objekte -
    wird nur nach Art und Laenge beschrieben. Ein Eintrag wie
    {"cik": 320193, "name": "APPLE INC"} landete sonst woertlich auf stderr,
    und die Verbotsliste (F6-B14) verbietet jede Firmen-Kennung ueberall, nicht
    bloss im Ausgabesatz. Ein Abbruchtext ist auch eine Ausgabeflaeche.
    """
    if isinstance(x, bool) or isinstance(x, (int, float)):
        return repr(x)
    try:
        return type(x).__name__ + " der Laenge " + str(len(x))
    except TypeError:
        return type(x).__name__


def _korrekturfaktor(klumpen_anzahl):
    """Die Klein-Klumpen-Korrektur G/(G-1) - und die G<2-Kante.

    HIER UND NUR HIER steht die Bedingung G < 2. Das ist Absicht, keine
    Schlamperei: der Faktor IST die Kante. Ohne ihn liefert der Schaetzer bei
    G = 1 still eine Null (alle Residuen sind dann per Konstruktion 0) und
    damit genau den Rueckfall auf den kleineren SE, den die Bandregel
    verbietet. Steht die Schranke woanders, laesst sich der Faktor entfernen,
    ohne dass ein Waechter rot wird - und die Bruchprobe aus F6-B23 (Faktor
    einmal entfernen -> T1 UND T4 rot) waere eine Behauptung statt eines
    Beweises.
    """
    if klumpen_anzahl < 2:
        raise SeNichtBerechenbar(
            "F6-SE-KLUMPEN-ABBRUCH: G = " + repr(klumpen_anzahl) + " < 2. Mit "
            "einem einzigen Klumpen ist die Streuung ZWISCHEN Klumpen nicht "
            "schaetzbar; die Klein-Klumpen-Korrektur G/(G-1) ist dort nicht "
            "definiert. Kein Rueckfall auf den kleineren SE.")
    return klumpen_anzahl / (klumpen_anzahl - 1)


def klumpen_se(paare, n_berichtet, zaehler_berichtet):
    """Die Vorschrift F6-SE-KLUMPEN/v1, Ziffern 3 bis 8.

    `paare` ist eine ungeordnete Folge von (m_g, n_g). Rueckgabe ist genau der
    registrierte Ausgabesatz - fuenf Schluessel, kein sechster.
    """
    if not isinstance(paare, (list, tuple)):
        raise SeNichtBerechenbar(
            "F6-SE-KLUMPEN-ABBRUCH: die Klumpen-Datei traegt keine Liste von "
            "Paaren, sondern " + type(paare).__name__ + ".")

    # Die Kreuzprobe-Sollwerte muessen selbst ganze Zahlen sein. bool ist in
    # Python ein int: `True` verglich sich sonst still gleich mit einer Summe
    # von 1 und machte die Kreuzprobe zur Attrappe. Ueber die CLI ist der Fall
    # nicht erreichbar (argparse type=int), ueber den Funktionsaufruf schon -
    # und die Funktion ist der Eintrittspunkt, den der F6-Laeufer benutzt.
    for name, wert in (("--n", n_berichtet), ("--zaehler", zaehler_berichtet)):
        if isinstance(wert, bool) or not isinstance(wert, int):
            raise SeNichtBerechenbar(
                "F6-SE-KLUMPEN-ABBRUCH: " + name + " ist keine ganze Zahl: "
                + _sicher(wert) + ".")

    m_werte = []
    n_werte = []
    for i, eintrag in enumerate(paare):
        # Ein Eintrag ist ein Paar aus zwei Zahlen. Alles andere - ein Objekt
        # mit Feldern, ein Tripel, eine Zeichenkette - ist ein ABBRUCH und kein
        # Filter: genau hier waere die Stelle, an der eine Firmen-Kennung
        # mitreisen koennte.
        if not isinstance(eintrag, (list, tuple)) or len(eintrag) != 2:
            raise SeNichtBerechenbar(
                "F6-SE-KLUMPEN-ABBRUCH: Klumpen " + str(i) + " ist kein Paar "
                "(m_g, n_g), sondern " + _sicher(eintrag) + ". Das Modul nimmt "
                "keine Firmen-Kennung entgegen - auch nicht in dieser Meldung.")
        m_roh, n_roh = eintrag
        n_g = _ganzzahl(n_roh)
        if n_g is None or n_g < 1:
            raise SeNichtBerechenbar(
                "F6-SE-KLUMPEN-ABBRUCH: n_g von Klumpen " + str(i) + " ist "
                "keine ganze Zahl >= 1: " + _sicher(n_roh) + ".")
        m_g = _ganzzahl(m_roh)
        if m_g is None or m_g < 0 or m_g > n_g:
            raise SeNichtBerechenbar(
                "F6-SE-KLUMPEN-ABBRUCH: m_g von Klumpen " + str(i) + " ist "
                "keine ganze Zahl in [0, n_g = " + str(n_g) + "]: "
                + _sicher(m_roh) + ".")
        m_werte.append(m_g)
        n_werte.append(n_g)

    klumpen_anzahl = len(n_werte)
    n_summe = sum(n_werte)
    zaehler_summe = sum(m_werte)

    # Die Kreuzproben. Sie sind die maschinelle Fassung von "eine
    # Nennereinheit ohne genau eine Klumpen-Kennung wird NIE stillschweigend
    # fallengelassen": wer eine Einheit ohne Klumpen hat, meldet ein N, das die
    # Klumpen-Tafel nicht deckt - und faellt hier auf, statt still aus dem
    # Nenner zu verschwinden. (Sie sind zugleich die Antwort auf Dissens DV-1:
    # die Quadratsumme geht nicht hinaus, aber die Summen werden geprueft.)
    if n_summe != n_berichtet:
        raise SeNichtBerechenbar(
            "F6-SE-KLUMPEN-ABBRUCH: Summe_g n_g = " + str(n_summe)
            + " weicht vom berichteten N = " + str(n_berichtet) + " ab. "
            "Entweder traegt eine Nennereinheit keine Klumpen-Kennung, oder "
            "die Tafel gehoert nicht zu diesem Lauf.")
    if zaehler_summe != zaehler_berichtet:
        raise SeNichtBerechenbar(
            "F6-SE-KLUMPEN-ABBRUCH: Summe_g m_g = " + str(zaehler_summe)
            + " weicht vom berichteten Zaehler = " + str(zaehler_berichtet)
            + " ab.")
    if n_summe < 1:
        raise SeNichtBerechenbar(
            "F6-SE-KLUMPEN-ABBRUCH: N = " + str(n_summe) + ". Ohne Einheiten "
            "gibt es keinen Anteil.")

    anteil = zaehler_summe / n_summe
    if not _zahl(anteil) or not 0.0 <= anteil <= 1.0:
        raise SeNichtBerechenbar(
            "F6-SE-KLUMPEN-ABBRUCH: p-Dach = " + repr(anteil)
            + " liegt nicht in [0,1].")

    # Ziffer 4: math.fsum ueber die Residuenquadrate. fsum ist exakt gerundet
    # und damit reihenfolge-invariant - eine gemischte Klumpenliste liefert
    # bit-gleich dasselbe Ergebnis wie eine sortierte.
    #
    # `r * r` statt `r ** 2`: der Potenz-Operator routet fuer float ueber die
    # pow() der libm, und pow ist von IEEE 754 NICHT bitgenau vorgeschrieben.
    # Gemessen kippen 6 von 19998 Tafeln zwischen MSVC und glibc im letzten
    # Bit. Diese Datei wird als fuenfter Pin GEHASHT und ihr Ergebnis geht in
    # ein Tor mit geschlossener Bandkante - ein plattformabhaengiges letztes
    # Bit waere dort ein Ergebnis, das je nach Maschine ein anderes ist. Eine
    # einzelne Multiplikation ist IEEE-exakt vorgeschrieben und ausserdem
    # naeher am eingefrorenen Wortlaut ("Residuenquadrate").
    try:
        quadrate = []
        for m_g, n_g in zip(m_werte, n_werte):
            r = m_g - anteil * n_g
            quadrate.append(r * r)
        residuen_quadratsumme = math.fsum(quadrate)
        if not _zahl(residuen_quadratsumme):
            raise SeNichtBerechenbar(
                "F6-SE-KLUMPEN-ABBRUCH: die Residuenquadratsumme ist nicht "
                "endlich: " + repr(residuen_quadratsumme) + ".")

        # Ziffer 5, der Schaetzer. Der Faktor traegt die G<2-Kante mit sich.
        se = math.sqrt(
            _korrekturfaktor(klumpen_anzahl) * residuen_quadratsumme) / n_summe
    except ArithmeticError as fehler:
        # Ein Ueberlauf (r*r bei Eingaben um 1e200, ein int ohne
        # Groessengrenze im Produkt) ist "nicht berechenbar" wie jede andere
        # Bedingung aus Ziffer 8 - er darf nicht als nackter Traceback
        # herauskommen. Das Modul verspricht auf JEDEM Pfad einen benannten
        # Grund; ein Traceback ist kein Grund, sondern ein Absturz.
        raise SeNichtBerechenbar(
            "F6-SE-KLUMPEN-ABBRUCH: die Rechnung ist nicht durchfuehrbar ("
            + type(fehler).__name__ + "): " + str(fehler)
            + ". Zu gross ist nicht endlich.") from fehler

    if not _zahl(se) or se < 0.0:
        raise SeNichtBerechenbar(
            "F6-SE-KLUMPEN-ABBRUCH: der Schaetzer ist nicht endlich: "
            + repr(se) + ".")

    # Ziffer 9: genau diese fuenf Schluessel. S bleibt Zwischengroesse.
    return {
        "se_klumpen_robust": se,
        "klumpen_anzahl": klumpen_anzahl,
        "n": n_summe,
        "zaehler": zaehler_summe,
        "anteil": anteil,
    }


def lies_klumpen(pfad):
    """Die Klumpen-Tafel. Eine unlesbare Datei ist ein Abbruch, keine leere
    Tafel - sonst waere ein Tippfehler im Pfad still ein G = 0."""
    try:
        with open(pfad, encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError, RecursionError) as fehler:
        # RecursionError gehoert dazu: json.load laeuft auf tief verschachtelter
        # Eingabe (eine Datei aus 60000 offenen Klammern) in die
        # Rekursionsgrenze. Auch dieser Weg braucht einen benannten Grund statt
        # eines Tracebacks.
        raise SeNichtBerechenbar(
            "F6-SE-KLUMPEN-ABBRUCH: Klumpen-Datei nicht lesbar (" + str(pfad)
            + "): " + type(fehler).__name__ + ": " + str(fehler))


def selbsttest():
    ok = fehl = 0

    def pruefe(name, bedingung):
        nonlocal ok, fehl
        if bedingung:
            ok += 1
            print("  ok   " + name)
        else:
            fehl += 1
            print("  FAIL " + name)

    def bricht_ab(paare, n, zaehler):
        return grund(paare, n, zaehler) is not None

    def grund(paare, n, zaehler):
        """Der Abbruchtext, oder None wenn es keinen Abbruch gab. Nur
        SeNichtBerechenbar zaehlt: ein durchgereichter Traceback ist kein
        Abbruch mit Grund, sondern ein Absturz, und faellt hier durch."""
        try:
            klumpen_se(paare, n, zaehler)
            return None
        except SeNichtBerechenbar as fehler:
            return str(fehler)

    # --- Handfixture gegen ein ausgeschriebenes Literal (T2) ---------------
    # (m,n) = (2,3), (1,1), (0,2) -> N = 6, G = 3, p-Dach = 0,5,
    # Residuen 0,5 / 0,5 / -1, S = 1,5 -> se = Wurzel(1,5 * 1,5)/6 = 0,25.
    r = klumpen_se([[2, 3], [1, 1], [0, 2]], 6, 3)
    pruefe("Handfixture (2,3),(1,1),(0,2) -> se = 0,25 exakt",
           r["se_klumpen_robust"] == 0.25)
    pruefe("Handfixture: p-Dach = 0,5 und G = 3",
           r["anteil"] == 0.5 and r["klumpen_anzahl"] == 3)
    pruefe("Ausgabe traegt genau fuenf Schluessel, keinen sechsten",
           set(r) == {"se_klumpen_robust", "klumpen_anzahl", "n", "zaehler",
                      "anteil"})
    pruefe("die Residuenquadratsumme geht NICHT hinaus (F6-B14)",
           "klumpen_quadratsumme" not in r and "s" not in r)

    # --- Gleichheits-Anker im Entartungsfall (T1) ---------------------------
    # Alle n_g = 1 -> se = Wurzel(p(1-p)/(N-1)) = se_binomial * Wurzel(N/(N-1)).
    einzel = [[1, 1]] * 7 + [[0, 1]] * 3
    r1 = klumpen_se(einzel, 10, 7)
    p = 0.7
    erwartet = math.sqrt(p * (1 - p) / 9)
    se_binom = math.sqrt(p * (1 - p) / 10)
    pruefe("Entartungsfall: se = Wurzel(p(1-p)/(N-1)) auf 1e-15",
           abs(r1["se_klumpen_robust"] - erwartet) < 1e-15)
    pruefe("Entartungsfall: se/se_binomial = Wurzel(N/(N-1))",
           abs(r1["se_klumpen_robust"] / se_binom - math.sqrt(10 / 9)) < 1e-15)
    pruefe("Entartungsfall: der Schaetzer liegt NIE unter dem binomialen",
           r1["se_klumpen_robust"] > se_binom)

    # --- Klumpen-Anker (T3) ------------------------------------------------
    # n_g = 2, perfekt korreliert -> Verhaeltnis^2 = 2G/(G-1).
    zweier = [[2, 2]] * 6 + [[0, 2]] * 4
    r3 = klumpen_se(zweier, 20, 12)
    p3 = 0.6
    se_binom3 = math.sqrt(p3 * (1 - p3) / 20)
    verhaeltnis2 = (r3["se_klumpen_robust"] / se_binom3) ** 2
    pruefe("2er-Klumpen, perfekt korreliert: Verhaeltnis^2 = 2G/(G-1)",
           abs(verhaeltnis2 - 2 * 10 / 9) < 1e-12)
    pruefe("ein echter 2er-Klumpen liegt STRIKT ueber dem binomialen SE",
           r3["se_klumpen_robust"] > se_binom3)

    # --- Reihenfolge-Invarianz (T6) ----------------------------------------
    gemischt = [[0, 2], [2, 2], [0, 2], [2, 2], [2, 2], [0, 2], [2, 2],
                [2, 2], [0, 2], [2, 2]]
    pruefe("Reihenfolge-Invarianz: gemischte Liste, bit-gleiche Ausgabe",
           klumpen_se(gemischt, 20, 12) == r3)

    # --- Fail-closed, alle acht Bedingungen (Ziffer 8) ---------------------
    pruefe("Abbruch bei G < 2 (ein einziger Klumpen)",
           bricht_ab([[3, 6]], 6, 3))
    pruefe("G < 2 liefert KEINE Null, sondern gar nichts",
           bricht_ab([[0, 4]], 4, 0))
    pruefe("Abbruch: n_g keine ganze Zahl >= 1",
           bricht_ab([[0, 0], [1, 1]], 1, 1)
           and bricht_ab([[0, 1.5], [1, 1]], 2, 1)
           and bricht_ab([[0, -2], [1, 1]], -1, 1))
    pruefe("Abbruch: m_g keine ganze Zahl in [0, n_g]",
           bricht_ab([[3, 2], [1, 1]], 3, 4)
           and bricht_ab([[-1, 2], [1, 1]], 3, 0)
           and bricht_ab([[0.5, 2], [1, 1]], 3, 1))
    # Die Schranke m_g <= n_g braucht eine Tafel, die OHNE sie durchginge.
    # (3,1),(0,2) hat N = 3 = Summe n_g, M = 3 = Summe m_g und p-Dach = 1,0 -
    # beide Kreuzproben und der p-Gate lassen sie passieren. Die frueheren
    # Fixtures starben am p-Gate, `or m_g > n_g` war damit ersatzlos loeschbar.
    pruefe("Abbruch: m_g > n_g faellt an der KLUMPEN-Schranke, nicht am p-Gate",
           (grund([[3, 1], [0, 2]], 3, 3) or "").find("[0, n_g = 1]") >= 0)
    # Und die leere Tafel: ohne den N<1-Wachposten waere p-Dach = 0/0.
    pruefe("Abbruch: die leere Klumpen-Tafel", bricht_ab([], 0, 0))
    pruefe("Abbruch: bool ist keine Zahl (True ginge sonst als 1 durch)",
           bricht_ab([[True, 1], [0, 1]], 2, 1)
           and bricht_ab([[1, True], [0, 1]], 2, 1))
    pruefe("Abbruch: NaN und inf werden POSITIV ausgeschlossen",
           bricht_ab([[float("nan"), 1], [0, 1]], 2, 0)
           and bricht_ab([[1, float("inf")], [0, 1]], 2, 1)
           and bricht_ab([[float("inf"), 1], [0, 1]], 2, 1))
    pruefe("Abbruch: Summe_g n_g weicht vom berichteten N ab "
           "(Einheit ohne Klumpen-Kennung)",
           bricht_ab([[1, 1], [0, 1]], 3, 1))
    pruefe("Abbruch: Summe_g m_g weicht vom berichteten Zaehler ab",
           bricht_ab([[1, 1], [0, 1]], 2, 2))
    pruefe("Abbruch: die Tafel ist gar keine Liste von Paaren",
           bricht_ab({"cik": 320193}, 1, 1)
           and bricht_ab([{"cik": 320193, "m": 1, "n": 1}, [0, 1]], 2, 1)
           and bricht_ab([[1, 1, 320193], [0, 1]], 2, 1))
    pruefe("ein Klumpen mit 10**400 ist nicht endlich, also ein Abbruch",
           bricht_ab([[0, 10 ** 400], [1, 1]], 10 ** 400 + 1, 1))
    # Ueberlauf im Quadrat: Eingaben um 1e200 sind ganzzahlig und endlich, ihr
    # Produkt ist es nicht mehr. Er muss als BENANNTER Abbruch herauskommen,
    # nicht als Traceback.
    ueberlauf = grund([[0, int(1e200)], [int(1e200), int(1e200)]],
                      2 * int(1e200), int(1e200))
    pruefe("Ueberlauf in der Rechnung ist ein benannter Abbruch, kein Absturz",
           ueberlauf is not None
           and ueberlauf.startswith("F6-SE-KLUMPEN-ABBRUCH:"))
    # Die Kreuzprobe-Sollwerte selbst: bool ist ein int.
    pruefe("Abbruch: --n / --zaehler sind bool statt ganzer Zahl",
           bricht_ab([[1, 1], [0, 1]], True, 1)
           and bricht_ab([[1, 1], [0, 1]], 2, True)
           and bricht_ab([[1, 1], [0, 1]], 2.0, 1))
    # KANAL-PROBE: der Abbruchtext ist auch eine Ausgabeflaeche. Ein Eintrag
    # mit Firmen-Feldern darf nur nach Art und Laenge beschrieben werden -
    # sonst stuende die Kennung woertlich auf stderr (F6-B14 gilt ueberall).
    kanal = grund([{"cik": 320193, "name": "APPLE INC"}, [0, 1]], 2, 1) or ""
    pruefe("Abbruchtext leckt keine Firmen-Kennung (weder Name noch CIK)",
           "APPLE" not in kanal and "320193" not in kanal
           and "cik" not in kanal and "dict" in kanal)

    # --- Gegenprobe: saubere Eingaben gehen durch --------------------------
    pruefe("GEGENPROBE: eine saubere Tafel liefert einen endlichen SE > 0",
           klumpen_se([[1, 2], [0, 3], [2, 2]], 7, 3)[
               "se_klumpen_robust"] > 0.0)

    print("selbsttest: " + str(ok) + " ok, " + str(fehl) + " FAIL")
    return 1 if fehl else 0


def main(argv=None):
    p = argparse.ArgumentParser(
        description="F6-SE-KLUMPEN/v1 - der klumpen-robuste SE des F6-Tors")
    unter = p.add_subparsers(dest="befehl", required=True)
    se = unter.add_parser("se")
    se.add_argument("--klumpen", required=True,
                    help="JSON-Datei mit einer ungeordneten Liste [[m_g, n_g], ...]")
    se.add_argument("--n", type=int, required=True,
                    help="der berichtete Netto-Tornenner N (Kreuzprobe)")
    se.add_argument("--zaehler", type=int, required=True,
                    help="der berichtete Zaehler M (Kreuzprobe)")
    unter.add_parser("selbsttest")
    a = p.parse_args(argv)

    if a.befehl == "selbsttest":
        return selbsttest()

    # Fail-closed bis in die Ausgabe: bei einem Abbruch geht NICHTS nach
    # stdout. Ein halber Wert waere hier schlimmer als kein Wert - die
    # Bandregel verlangt dann NICHT UNTERSCHEIDBAR, nicht den kleineren SE.
    try:
        ergebnis = klumpen_se(lies_klumpen(a.klumpen), a.n, a.zaehler)
    except SeNichtBerechenbar as fehler:
        print(str(fehler), file=sys.stderr)
        print("Folge: BandNichtAuswertbar -> Zulaessigkeits-Gate gerissen -> "
              "NICHT UNTERSCHEIDBAR, WEITER = 0. Kein Rueckfall auf den "
              "kleineren SE.", file=sys.stderr)
        return 1
    print(json.dumps(ergebnis, ensure_ascii=False, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())

'use strict';
/**
 * Hypergrowth Engine — die 9 Achsen-Berechner
 * ===========================================
 * Reine Funktionen ueber einen Snapshot. Lesen Serien AUSSCHLIESSLICH ueber
 * norm() (Schicht 0) und Skalare ueber snapshot.metrics. Jede Achse liefert
 * einen ROH-Signalwert (hoeher = besser) ODER null -> dann droppt die Achse
 * und die Engine renormiert die uebrigen Gewichte (renorm-on-drop, nie Fake-50).
 *
 * q() (engine.js) macht das Ranking cohort-relativ — die Achsen muessen also
 * nicht saettigen/skalieren, nur ein konsistentes, monotones Signal liefern.
 * Monotonie-Klausel (audit/fix Court Fall 2, F47): gilt fuer den ROHEN Achsenwert.
 * capitalEfficiency traegt bewusst einen gegenlaeufigen Zyklus-Peak-Discount
 * (cycleDiscount, Court-Spec, axes.test.js:peak<stable), der NICHT monoton im
 * juengsten OpInc ist — das ist Absicht (Commodity-Peak-Taker-Penalty), kein Vertragsbruch.
 *
 * Die 9 Achsen (Plan v4; #9 marginLevel = 2.12b, nur tech-hardware):
 *  1 revGrowthLevel        Umsatzwachstum (Niveau, TTM YoY)
 *  2 revAcceleration       Umsatz-Beschleunigung (QoQ-Endpunkt-Differenz: juengste minus aelteste QoQ-Rate; audit/fix F7a)
 *  3 gpGrowth              Bruttogewinn-Wachstum (YoY) + GM-Trajektorie
 *  4 ruleOfX               alpha*revGrowth + FCF-Marge (guarded; Unprofit: ohne FCF)
 *  5 marginTrajectory      Operating-Leverage (OpMargin-Slope ueber Quartale)
 *  6 capitalEfficiency     ROIC-Proxy minus Asset-Growth-Penalty
 *  7 revisionsMomentum     Analysten Up/Down-Saldo (0y/+1y, 30/90d)
 *  8 dilution              -(SBC/Rev) Niveau + Trend (niedriger/fallend = besser)
 *  9 marginLevel           Bruttomarge-NIVEAU (Franchise-vs-commodity-Diskriminator, 2.12b)
 */

const { norm, hasPresent, firstPresent, presentValues, metricVal, ratioSeries, jahresVergleichIdx,
  periodeIstQuartal, periodEnds } = require('./snapshot.js');
const { fcfMarginValid } = require('./engine.js');

// --- M-A Kadenz-Waechter (Beschluss Quartalsreihen 16.08.2026 + Nachtrag) ----
// Eine Quartals-Rechnung darf nur auf Perioden laufen, die BESTAETIGT Quartale sind.
// Band und Messung kommen aus snapshot.js (periodeIstQuartal), also aus derselben Quelle
// wie die einmalertrag-Lampe — kein zweiter Schwellwert, keine zweite Wahrheit.
//
// STRIKTE LESART, und sie ist der Kern des Beschlusses: `=== true`. Eine Periode, deren
// Laenge sich NICHT bestaetigen laesst (kein Vorgaenger-Ende, also nicht messbar), zaehlt
// als nicht erfuellt. Nicht erschliessen, nicht aus der Nachbarschaft ableiten.
//
// GLEICHES BAND WIE DIE LAMPE, ENTGEGENGESETZTE FEHLERKOSTEN — Absicht, kein Widerspruch.
// Wer das hier "zur Konsistenz" auf das Lampen-Verhalten zurueckdreht, macht den Fund
// rueckgaengig, wegen dessen M-A ueberhaupt gebaut wurde (gemessen am Vintage 2026-08-16:
// defensiv blieben 1.660 Zweig-Nutzer statt 6, und KEINE einzige intakte Reihe erreichte
// den Zweig — die Asymmetrie "nur kaputte Daten schalten den volatileren Messweg frei"
// bestuende dann weiter):
//   LAMPE (lamps.js einmalertrag): laesst Unmessbares DURCH. Sie ist eine ANKLAGE gegen
//     eine Firma; ein Fehlalarm daempft zu Unrecht. Im Zweifel wird nicht geraten.
//   GATE (hier): laesst Unmessbares NICHT durch. Es ist die ZULASSUNG zum volatileren
//     Quartals-Messweg; ein falsches Ja setzt einen Phantomwert in den Rang, ein falsches
//     Nein kostet nur den traegeren, aber ehrlichen Jahres-Messweg. Im Zweifel kein Zutritt.
//
// EINE AUSNAHME, und sie ist eng, benannt und gemessen — die F-4-KLAUSEL.
// Traegt eine Reihe UEBERHAUPT KEINE Enden, dann liegt nichts vor, worueber zu urteilen
// waere. F-4 (Karl-Mandat 03.08.2026) hat das ausdruecklich entschieden und mit einem
// Vertragstest festgenagelt (tests/scoring/jahresvergleich-datum.test.js: "ohne
// Enden-Reihe: Positionsregel i+4 unveraendert ... byte-identisch zur alten Rechnung").
// Dieser Vertrag wird hier NICHT ueberfahren: ohne Enden bleibt die Positionsregel in
// Kraft und M-A greift nicht.
//
// WAS DAS KOSTET, am Vintage 2026-08-16 ausgezaehlt statt geschaetzt: von 8.490 Zeilen mit
// Werte-Reihe tragen genau DREI keine Enden. Gegen die strikte Variante ohne diese Klausel
// unterscheidet sich das Ergebnis um ZWEI Zeilen (Rechenort 1: 264 statt 266 · Rechenort 2:
// identisch 3.704 · Zweig-Nutzer danach: identisch 6). Die Beschluss-Zielzahlen bleiben
// also erfuellt, und der aeltere Vertrag bleibt stehen — das ist der Grund fuer die Wahl,
// nicht Bequemlichkeit. Die Kollision selbst ist im Beschluss nirgends behandelt: seine
// Begruendung fuer "strikt" nennt ausschliesslich Wertloch (1.300) und Kadenz-Sprung (360).
//
// ⚠ DIE KLAUSEL IST KEIN GENERELLER FREIBRIEF FUER UNMESSBARES. Sie greift NUR, wenn die
// GANZE Enden-Reihe fehlt. Sobald auch nur ein Ende da ist, gilt strikt — insbesondere
// bleibt das aelteste Quartal einer datierten Reihe blockiert, und genau daran haengt das
// Einschlafen des revAcceleration-Zweigs. Wer die Ausnahme auf "jeder unmessbare Index"
// ausweitet, schaltet das Gate praktisch ab (gemessen: Zweig-Nutzer 1.660 statt 6).
// Waechter E1/E2 halten beide Seiten fest.
const ohneEndenReihe = (s) => periodEnds(s, 'revenueQ').every((e) => e === null);
const quartalBestaetigt = (s, i) => ohneEndenReihe(s) || periodeIstQuartal(s, 'revenueQ', i) === true;

// --- kleine Helfer auf normalisierten Serien (luecken-sicher) ---------------

// Letzter present (nicht-null) Wert = aeltestes vorhandenes GJ/Quartal.
function lastPresent(series) {
  if (!Array.isArray(series)) return null;
  for (let i = series.length - 1; i >= 0; i--) {
    if (series[i] !== null && series[i] !== undefined) return series[i];
  }
  return null;
}

// audit/fix (BH-079): Ersatz fuer snapshot.js firstTwoPresent() innerhalb dieser Achsen — firstTwoPresent
// ueberspringt NULL-Luecken OHNE Adjazenz-Pruefung und gibt die ersten zwei present Werte als [neu,alt]
// zurueck, egal wie weit sie im Array auseinanderliegen. Ein YoY-Delta ist aber nur eine ECHTE
// Ein-Jahres-Differenz, wenn Index 0 (juengstes GJ) UND Index 1 (Vorjahr) BEIDE present sind — sonst wird
// entweder ein Mehrjahres-Sprung als 1-Jahres-YoY ausgegeben (Luecke ZWISCHEN den Werten) oder eine
// fuehrende Luecke macht einen Altwert zum vermeintlich "aktuellen" (Store-Belege: AUR 4-Jahres-Sprung,
// HYMC fuehrende Luecke). Nur Index0+Index1 beide present -> [neu,alt]; sonst null (ehrlich droppen,
// renorm-on-drop) statt den Mehrjahres-/Stale-Wert durchzureichen.
function adjacentTwoPresent(series) {
  if (!Array.isArray(series)) return null;
  const a = series[0], b = series[1];
  return (Number.isFinite(a) && Number.isFinite(b)) ? [a, b] : null;
}

// ratioSeries kommt aus snapshot.js (geteilt, finite-/laengen-sicher).

// --- 1. Umsatzwachstum (Niveau) ---------------------------------------------
// Datenrichtigkeits-Fix (14.07.2026, 2.14-v3-Court T1 + 2.6-Retrial): vorher las die
// Achse metrics.revenueGrowthYoY — ein Yahoo-quoteSummary-SKALAR mit belegten Defekten
// (MRNA +260 % bei real kollabierender Umsatzreihe [Stempel Mai], GOLD +244 % vs real
// ~13 %, 20 Namen mit |YoY|>500 % im Level-Top-Dezil, 612 Divergenzen >=20pp gegen die
// eigene annual-Reihe). Jetzt Single-Source aus den ROH-REIHEN (annualRev + revenueQ);
// die Komponenten-Extraktion ist mit growthBoost/robustG geteilt (revYoYComponents),
// die ACHSE selbst behaelt die Skalar-Semantik (Quartals-YoY, s. u.). growthBounds
// (data-learned p1/p99, score.js) klemmt Mini-Basis-/Stub-Komponenten (JOBY-Muster),
// KEIN aufgezwungenes Niveau.
function revAnnualYoY(s) {
  const ar = adjacentTwoPresent(norm(s, 'annualRev'));
  if (!ar || !(ar[1] > 0)) return null;
  const g = ar[0] / ar[1] - 1;
  return Number.isFinite(g) ? g : null;
}
// F-4 (Karl-Mandat 03.08.2026): das Vorjahresquartal wird ueber sein ENDDATUM gewaehlt.
// Bis heute stand hier starr Position 4. Ausgezaehlt ueber 12.543 CI-Snapshots war das bei
// 1.774 von 6.203 pruefbaren Reihen (28,6 %) das falsche Quartal — dort fehlt in der
// Yahoo-Reihe ein Quartal, und Position 4 zeigt dann 455 statt 365 Tage zurueck (CN 51,9 %,
// IN 60,2 %, SE 77,6 % betroffen; US nur 3,2 %). Begruendung der Toleranz: snapshot.js.
// Drei Ausgaenge, alle drei aus jahresVergleichIdx:
//   quelle 'datum'    -> das datierte Jahresquartal, egal an welcher Position.
//   quelle 'position' -> KEIN Enddatum vorhanden: es liegt nichts vor, worueber zu urteilen
//                        waere. Die alte Regel bleibt in Kraft.
//   null              -> datiert, aber kein Quartal im Jahresfenster: der Jahresvergleich
//                        ist nicht bildbar. Behandelt wie bisher "zu wenige Quartale":
//                        das Quartals-Bein droppt, annual-lag1 traegt (revGrowthLevel).
// Der LUECKEN-PROXY (alle Quartale bis zum Vergleichsquartal finit) gilt in BEIDEN Zweigen.
// Tag 518 hatte ihn im Datums-Zweig ersatzlos fallen lassen — begruendbar (das Enddatum
// beweist die Paarung, ein Loch DAVOR stoert sie nicht), aber das ist eine zweite
// Semantik-Aenderung, die als Nebenwirkung eines Datenrichtigkeits-Fixes reingerutscht ist.
// Reproduziert an CRD-A (Werte-Loch an Position 2, Enden luecken-los): die Achse lieferte
// dadurch neu -0,994 % statt wie vorher ehrlich auf die Jahresreihe zurueckzufallen
// (-2,073 %). F-4 aendert ausschliesslich, WELCHES Quartal verglichen wird.
// M-A RECHENORT 1 (16.08.2026): das juengste "Quartal" muss auch eines sein.
// NUR Index 0 wird gegated, und das ist keine Nachlaessigkeit, sondern die Bedingung
// dafuer, dass der Waechter nicht die Anker erschlaegt: der Jahres-PARTNER ist durch die
// 365-Tage-Datumspaarung (jahresVergleichIdx) bereits belegt, und er ist in einer sauberen
// 5-Quartals-Reihe regelmaessig der AELTESTE Index — dessen Periodenlaenge ist per
// Konstruktion nicht messbar. Ihn strikt mitzugaten wuerde jeder intakten 5-Quartals-Reihe
// das Quartals-Bein nehmen, CRDO/NVDA/ALAB/BE/PLTR eingeschlossen (Waechter A4/A5).
function revQuartalsYoY(s) {
  const v = jahresVergleichIdx(s, 'revenueQ', 0);
  if (v === null) return null;
  if (!quartalBestaetigt(s, 0)) return null;
  const rq = norm(s, 'revenueQ');
  if (v.idx >= rq.length) return null;
  if (!rq.slice(0, v.idx + 1).every(Number.isFinite)) return null;
  const a = rq[0], b = rq[v.idx];
  if (!Number.isFinite(a) || !(b > 0)) return null;
  const g = a / b - 1;
  return Number.isFinite(g) ? g : null;
}
function revYoYComponents(s) {
  const comps = [];
  const jahr = revAnnualYoY(s);
  if (jahr !== null) comps.push(jahr);
  const quartal = revQuartalsYoY(s);
  if (quartal !== null) comps.push(quartal);
  return comps; // 0..2 Werte (Bruchteile, nicht %)
}
// CHIRURGISCH, nicht semantisch: das Skalar WAR Yahoos Quartals-YoY (juengstes Quartal
// vs Vorjahres-Quartal) — die Achse rechnet exakt DIESELBE Groesse selbst aus revenueQ
// (CRDO: berechnet 201,5 % == Skalar; gesunde Namen aendern sich nicht). Nur wo die
// Quartalsreihe fehlt, traegt annual-lag1 als dokumentierter Fallback. Ein Wechsel des
// WACHSTUMSBEGRIFFS (z. B. robustG-Blend) waere eine Formel-Verbesserung und gehoert
// vor den Court (2.14-v4), nicht in einen Datenrichtigkeits-Fix — Audit 14.07.: der
// Blend reorderte median 9 Raenge ueber 3354 Namen ohne Anker-/Glitch-Nutzen.
// Quartals-Bein wenn bildbar, sonst annual-lag1, sonst null (Achse droppt ehrlich —
// renorm-on-drop, KEIN Skalar-Fallback; der Skalar ist genau fuer reihen-lose Namen
// unpruefbar). Vorher stand die Auswahlbedingung hier ein ZWEITES Mal (und in score.js
// ein drittes Mal) — jetzt entscheidet revQuartalsYoY an EINER Stelle, ob es ein
// Quartals-Bein gibt.
function revGrowthLevel(s, growthBounds) {
  const quartal = revQuartalsYoY(s);
  let g = (quartal !== null) ? quartal : revAnnualYoY(s);
  if (g === null) return null;
  if (growthBounds) g = Math.max(growthBounds[0], Math.min(growthBounds[1], g));
  return g * 100; // % wie zuvor (negativ rankt natuerlich unten)
}

// audit/fix (Court Phase A Runde 3, Fall C2): Winsor-Clamp gegen near-zero-Nenner-Artefakte.
// Ein winziges Basis-Quartal (JOBY revenueQ[oldest]=15000) blaeht abgeleitete Quartals-Groessen
// (QoQ-Rate, OpMarge) auf tausende auf -> Phantom-Extreme dominieren den Rang. Die Schranken
// werden universe-weit gelernt (p1/p99 in score.js), KEIN aufgezwungenes Niveau; ohne bounds
// (Standalone/Tests) unveraendert. Schwester-Achsen gpGrowth (gm-Clip[0,1]) / dilution (Endpunkt-
// Clamp) sind analog gehaertet — diese zwei wurden uebersehen.
const clampWinsor = (v, bounds) => (bounds ? Math.max(bounds[0], Math.min(bounds[1], v)) : v);

// per-Quartal QoQ-Raten (newest-first), optional auf [lo,hi] winsorisiert.
// audit/fix (BH-080): vorher filterte .filter(v=>v!==null) die NULL-Luecken VOR der Index-Paarung weg
// (Kompaktierung) -> nicht-benachbarte Quartale rutschten im gefilterten Array zusammen und wurden als
// Nachbarn geratet (eine QoQ-Rate ueber eine echte Luecke hinweg). Jetzt auf der ROHEN (luecken-erhaltenden)
// Serie iterieren: ein QoQ-Schritt nur zwischen WIRKLICH aufeinanderfolgenden Quartals-Indizes — eine
// Luecke an i ODER i+1 bricht die Kette (kein Schritt fuer dieses Paar), statt sie zu ueberbruecken.
// Aktuell inert (revenueQ hat 0 Luecken im Store), haertet aber gegen kuenftige Luecken (dieselbe
// Kompaktierungs-Klasse wie BH-079).
function quarterQoQRates(s, bounds) {
  const rq = norm(s, 'revenueQ');
  const g = [];
  for (let i = 0; i < rq.length - 1; i++) {
    const a = rq[i], b = rq[i + 1];
    if (a === null || a === undefined || b === null || b === undefined) continue; // Luecke bricht die Kette
    if (a > 0 && b > 0) g.push(clampWinsor(a / b - 1, bounds)); // beide Quartale positiv
  }
  return g;
}

// --- 2. Umsatz-Beschleunigung (2. Ableitung) --------------------------------
// Beschleunigung = juengste YoY-Wachstumsrate minus aelteste. >0 = beschleunigt.
//
// SAISON-FIX (Tag 437, 26.07.2026 — Court-Urteil + Karl-Entscheid). Vorher bildete die
// Achse QoQ-Raten (Quartal gegen VORQUARTAL) und subtrahierte die aelteste von der
// juengsten. Das vergleicht zwei VERSCHIEDENE Saison-Uebergaenge miteinander, und welche
// das sind, haengt allein davon ab, wie viele Quartale gespeichert sind. Gemessen an einer
// synthetischen Reihe mit exakt konstantem Jahreswachstum (Beschleunigung also beweisbar
// null): -1,6 / -36,2 / +1,6 / +36,2 Prozentpunkte je nach Fiskal-Versatz — 72 Punkte
// Spannweite aus reiner Saison. Schlimmer noch: eine ECHT beschleunigende Reihe
// (20->40->60 % YoY) kam mit negativem Vorzeichen heraus. Die Achse mass keine
// Beschleunigung, sondern die Saisonform. In 8 von 13 Branchenformeln ist sie die
// zweitschwerste Achse.
//
// Jetzt YoY-basiert: rq[i] gegen rq[i+4] ist per Konstruktion DASSELBE Fiskalquartal ein
// Jahr frueher — die Saison kuerzt sich heraus, unabhaengig von Versatz und Reihenlaenge.
// Es ist derselbe Wachstumsbegriff, den revGrowthLevel/revYoYComponents bereits benutzen;
// die Achse erbt ihn damit statt einen zweiten zu fuehren.
//
// KEIN Ticker im Spiel: der Defekt und der Nachweis der Reparatur laufen ueber synthetische
// Reihen (tests/scoring/acceleration-invariance.test.js). Dass sich Raenge echter Firmen
// dadurch verschieben, ist Folge, nicht Ziel.
//
// DATENBEDARF — Stand 16.08.2026, am Vintage 2026-08-16 (9.090 Zeilen) nachgezaehlt.
// Quartalsweise braucht die Achse >=2 YoY-Paare. Yahoo liefert hoechstens 5 Quartale, eine
// saubere 5er-Reihe ergibt genau EIN Paar — sie faellt also auf den Jahres-Zweig.
//
// ⚠ WAS HIER BIS HEUTE STAND UND FALSCH WAR: "der Quartals-Zweig greift bei 1 von 4768
// Namen ... die Achse misst faktisch JAHRES-Beschleunigung". Das war am 26.07. richtig
// gemessen und beschrieb den praeregistrierten Zustand. F-4 (03.08.) hat die Paarung von
// der starren Position i+4 auf das Enddatum umgestellt — seither liefert eine Reihe MIT
// Loch oder Kadenz-Sprung zwei datierte Paare (z. B. 0 gegen 3 UND 1 gegen 4) und laeuft
// in diesen Zweig hinein. Ausgezaehlt: 3.710 von 9.090 Zeilen, und zwar AUSNAHMSLOS Zeilen
// mit Loch oder Kadenz-Sprung — keine einzige lueckenlose Reihe. Kaputte Daten schalteten
// also den volatileren Messweg frei, intakte nicht. Zwoelf Tage lang hat es niemand
// bemerkt, weil dieser Kommentar weiter das Gegenteil behauptete.
//
// SEIT M-A (16.08.) GILT: jede Paar-Seite muss ein BESTAETIGTES Quartal sein (unten,
// quartalBestaetigt). Zwei Paare brauchen damit vier bestaetigte Positionen, und bestaetigt
// werden kann nur eine Position mit Vorgaenger-Ende — praktisch >=7 Quartale Tiefe.
//
// ⛔ DAS IST EINE STILLLEGUNG, UND SIE WIRD SO GENANNT, nicht als Kadenz-Waechter getarnt:
// bei <=6 bestaetigten Quartalen ist dieser Zweig TOT. Am selben Vintage gemessen bleiben
// ~6 von 9.090 Zeilen uebrig (0,07 %); alles andere laeuft ueber den Jahres-Fallback. Das
// ist die Wiederherstellung des am 26.07. praeregistrierten Zustands, kein Formel-Umbau —
// aber eben auch keine Feinjustierung: die Achse misst wieder JAHRES-Beschleunigung.
//
// ER WACHT VON SELBST WIEDER AUF. Ab 7 bestaetigten Quartalen greift der Zweig ohne jede
// Code-Aenderung — mit wachsender SEC-XBRL-Tiefe passiert das absehbar und ungeplant.
// ⚠ SICHTBARES WIEDERAUFLEBEN LOEST EINEN COURT-TERMIN AUS (Beschluss 16.08.): dann laufen
// zwei Populationen mit VERSCHIEDENEM Messbegriff in einem Perzentil-Topf, und ob das
// zulaessig ist, ist neu zu bewerten — nicht stillschweigend hinnehmen, weil "es lief ja
// schon immer so". Waechter B1 haelt den Aufweck-Pfad fest, damit er nicht unbemerkt
// zubetoniert wird.
//
// F-4: der Jahrespartner je Position kommt aus dem Enddatum (jahresVergleichIdx), nicht
// mehr aus i+4. Ohne Enden liefert die Auswahl i+4 zurueck -> byte-identisch zu vorher.
function revAcceleration(s, bounds) {
  const rq = norm(s, 'revenueQ');
  const yoy = [];
  for (let i = 0; i < rq.length; i++) {
    const v = jahresVergleichIdx(s, 'revenueQ', i);
    if (v === null || v.idx >= rq.length) continue; // kein Jahrespartner -> kein Paar
    // M-A RECHENORT 2: dieser Zweig bildet seine Paare SELBST und konsumiert
    // revQuartalsYoY NICHT — die Kadenz-Anforderung muss deshalb hier ein zweites Mal
    // stehen, sonst greift sie fuer die in 7 von 13 Formeln SCHWERSTE Achse ueberhaupt
    // nicht (deshalb bewegte die halbe M-A-Fassung nur 264 statt 3.900 Zeilen).
    // Hier BEIDE Seiten: eine Beschleunigung ist die Differenz zweier YoY-Raten — jede
    // davon muss quartalsrein sein, sonst subtrahiert man Groessen verschiedener
    // Periodenlaenge voneinander.
    if (!quartalBestaetigt(s, i) || !quartalBestaetigt(s, v.idx)) continue;
    const a = rq[i], b = rq[v.idx];
    if (a === null || a === undefined || b === null || b === undefined) continue; // Luecke ueberspringen
    if (a > 0 && b > 0) yoy.push(clampWinsor(a / b - 1, bounds));
  }
  if (yoy.length >= 2) return yoy[0] - yoy[yoy.length - 1];

  // Fallback Jahresreihe: drei present Jahre -> zwei Jahres-Wachstumsraten.
  const ar = norm(s, 'annualRev').filter((v) => v !== null && v !== undefined && v > 0);
  if (ar.length >= 3) {
    const neu = clampWinsor(ar[0] / ar[1] - 1, bounds);
    const alt = clampWinsor(ar[1] / ar[2] - 1, bounds);
    if (Number.isFinite(neu) && Number.isFinite(alt)) return neu - alt;
  }
  return null;
}

// --- 3. Bruttogewinn-Wachstum + GM-Trajektorie ------------------------------
function gpGrowth(s) {
  const gp = norm(s, 'annualGP');
  const two = adjacentTwoPresent(gp);
  if (!two || two[1] <= 0) return null;
  const gpYoY = two[0] / two[1] - 1;
  // GM-Trajektorie (Margenpunkt-Delta neu vs. alt), additiver Tilt
  // audit/fix (Court Fall 1, F9): gm-Endpunkte gegen physikalisch unmoegliche Werte guarden.
  // gm = GP/Rev muss in [0,1] liegen; gm>1 (GP>Rev) bzw. gm<0 sind korrupte Datenjahre, die den
  // kleinen gpYoY-Tilt sonst DOMINIEREN statt zu tilten (TAL: gmOld=2.145 -> gmTraj=-1.746 ->
  // gpGrowth-Perzentil 96.5->0.5). Implausible Jahre verwerfen (null); firstPresent/lastPresent
  // ueberspringen sie. Ratio-Plausibilitaets-Guard, kein aufgezwungenes Niveau -> waehrungs-invariant.
  const gm = ratioSeries(norm(s, 'annualGP'), norm(s, 'annualRev'))
    .map((v) => (v !== null && v >= 0 && v <= 1) ? v : null);
  // audit/fix (Hard-Review NRB-SC-002, BH-080-Analog): firstPresent(gm) ueberspringt eine FUEHRENDE
  // Luecke (annualRev[0] fehlt/0 -> gm[0]=null) und liefert ein AELTERES Jahr als "gmNew" (UAN-Muster:
  // annualRev[0]=0, annualGP[0] present -> gm[0]=null, firstPresent gab bisher gm[1] als "neuestes"
  // Jahr aus). gm[0] muss selbst present sein, sonst ist die Margen-Trajektorie fuers juengste Jahr
  // unbekannt -> neutral (gmTraj=0 unten), analog zum bestehenden Fallback bei fehlendem gmOld/gmNew.
  const gmNew = (gm[0] !== null) ? gm[0] : null, gmOld = lastPresent(gm);
  const gmTraj = (gmNew !== null && gmOld !== null) ? (gmNew - gmOld) : 0;
  return gpYoY + gmTraj;
}

// --- 4. Growth-Efficiency (Rule-of-X, growth-dominant) ----------------------
// alpha*revGrowth(%) + FCF-Marge(%) — FCF-Term nur wenn fcfSignGuard ihn
// validiert UND includeFcf. ACHTUNG (Court 29.07., Richterbefund): includeFcf
// haengt am ECHTEN FCF-Vorzeichen, NICHT am Track — der Aufrufer setzt es in
// score.js rawAxisValue() auf fcfTrack(...) === 'profitable'. Der frueher hier
// stehende Satz "Unprofitable-Track: includeFcf = false" war falsch und hat in
// einer Formel-Pruefung zu einem Fehlschluss gefuehrt. Wo der FCF-Term entfaellt,
// ist ruleOfX eine reine Skalierung von revGrowthLevel (identisches Kohorten-
// Perzentil) — gemessen 41,1 % aller 5.677 gerouteten Zeilen (Stand 28.07.).
// Datenrichtigkeits-Fix 14.07.2026: rev aus der berechneten Reihe (revGrowthLevel),
// nicht mehr aus dem defekten Provider-Skalar — beide Achsen teilen EINEN Wachstumsbegriff.
function ruleOfX(s, alpha = 2.3, includeFcf = true, growthBounds) {
  const rev = revGrowthLevel(s, growthBounds);
  if (rev === null) return null;
  let x = alpha * rev;
  if (includeFcf) {
    const ttm = metricVal(s,'fcfMarginTTM');
    if (fcfMarginValid(ttm, norm(s, 'annualFCF'), norm(s, 'annualOCF'))) x += ttm;
  }
  return x;
}

// per-Quartal OpMargin-Serie opIncQ/revenueQ (newest-first), optional auf [lo,hi] winsorisiert.
// audit/fix (Court Fall 1, F12): NUR Quartale mit revenueQ>0 (negativer Umsatz -> Phantom-Marge,
// Vorzeichen-Flip). audit/fix (Court R3 C2): jede Marge gegen die universe-weiten Tail-Schranken
// winsorisieren (Stub-Quartal-Artefakt, JOBY 15000$-Quartal -> -9991-Marge).
function quarterOpMargins(s, bounds) {
  const oi = norm(s, 'opIncQ'), rev = norm(s, 'revenueQ');
  const present = [];
  const n = Math.max(oi.length, rev.length);
  for (let i = 0; i < n; i++) {
    const r = rev[i], o = oi[i];
    if (!(r > 0)) continue;                                  // revenueQ<=0/null -> Phantom-Marge, verwerfen
    if (o === null || o === undefined || !Number.isFinite(o)) continue;
    present.push(clampWinsor(o / r, bounds));
  }
  return present;
}

// --- 5. Marge-/Operating-Leverage-Trajektorie -------------------------------
// Slope der Quartals-OpMargin (opIncQ/revenueQ), neu minus alt. >0 = Hebel greift.
// Reihenfolge newest-first erhalten; renorm-on-drop bei <2 present Quartalen.
function marginTrajectory(s, bounds) {
  // audit/fix (BH-080): quarterOpMargins() kompaktiert fehlende Quartale weg (present ist eine reine
  // Werteliste, keine Index-Positionen) — bei einer FUEHRENDEN opIncQ-Luecke (juengstes Quartal fehlt)
  // ist present[0] in Wahrheit eine 1-Quartal-alte Marge, wuerde hier aber als "juengste" behandelt
  // (Store-Beleg: 45 Namen mit fuehrender opIncQ-Luecke). Vor der Kompaktierung pruefen, ob Index0
  // (echtes juengstes Quartal) selbst eine valide Marge hat; sonst ist "juengste Marge" unbekannt ->
  // ehrlich droppen (renorm-on-drop) statt eine stale Periode als aktuell auszugeben.
  const rq0 = norm(s, 'revenueQ')[0], oi0 = norm(s, 'opIncQ')[0];
  if (!(rq0 > 0) || oi0 === null || oi0 === undefined || !Number.isFinite(oi0)) return null;
  const present = quarterOpMargins(s, bounds);
  if (present.length < 2) return null;
  return present[0] - present[present.length - 1]; // juengste minus aelteste Marge
}

// --- 6. Kapitaleffizienz / Asset-Disziplin ----------------------------------
// ROIC-Proxy (mean OpInc / mean Invested Capital) minus Asset-Growth-Penalty
// (Asset-Wachstum > Umsatzwachstum = gekauftes Wachstum).
function capitalEfficiency(s) {
  // audit/fix (E1/A1): ROIC mittelte den Zaehler (alle present OpInc-Jahre) und den Nenner
  // (alle invested>0-Jahre) ueber VERSCHIEDENE Jahres-Sets -> bei Laengen-Mismatch (126 Namen)
  // verfaelscht, teils Vorzeichen-Flip (SNDK 3 OpInc- vs 2 invested-Jahre: -0.036 statt +0.0027;
  // BLSH analog). Jetzt pro Fiskaljahr zippen: nur Jahre, in denen OpInc present UND invested>0
  // ist, gehen in BEIDE Mittel. (assets bleibt fuer die Asset-Growth-Penalty unten erhalten.)
  // Auflage 1 / 5.2-Datenfehler-Fix (Tag 434): Yahoo-annualOpInc weicht bei einzelnen
  // Namen material von der SEC-Bilanz ab (MGPI Vorzeichen-Flip, KODK-Betrag) — nur DIESE
  // Achse ist betroffen (Kreuz-Review-verifiziert, ruleOfX/marginTrajectory nicht). Fix:
  // dieselbe Single-Source-Trio-Praeferenz wie roicStability (SEC wo verfuegbar, sonst
  // Yahoo, NIE feldweise gemischt — roicStabilitySource() ist die EINE Quelle dieser
  // Entscheidung, hier wiederverwendet statt eine zweite, potenziell abweichende Kopie
  // zu pflegen). Der Zyklus-Peak-Discount unten (margins/cycleDiscount) bleibt bewusst
  // Yahoo-OpInc+Yahoo-Rev (beide gleiche Quelle, kein Misch-Risiko, nicht Teil des
  // gefundenen Fehlers) — unveraendert.
  const { opInc: opIncS, assets, curLiab } = roicStabilitySource(s);
  const opPaired = [], invPaired = [];
  const nYears = Math.max(opIncS.length, assets.length);
  for (let i = 0; i < nYears; i++) {
    const o = opIncS[i], a = assets[i];
    if (o === null || o === undefined || a === null || a === undefined) continue;
    const c = curLiab[i];
    // audit/fix (Court Phase A Runde 2, Fall 3 / F14): currentLiabilities NICHT mehr zu 0
    // koerzieren. Ein fehlendes curLiab machte invested = totalAssets -> die Achse rechnete
    // still ROA statt ROIC (43.9% des Universums) -> ROA/ROIC-Misch-Bias in den Kohorten-
    // Perzentilen. Jetzt jahres-genauer Drop: ein Jahr zaehlt nur mit PRESENT curLiab UND
    // invested>0. Kein einziges valides Jahr -> opPaired leer -> Achse null -> renorm-on-drop
    // (Kontrakt-konform, KEINE ROA-Maskerade, KEIN Fake-50).
    if (c === null || c === undefined) continue;
    const inv = a - c;
    if (!(inv > 0)) continue;
    opPaired.push(o); invPaired.push(inv);
  }
  if (opPaired.length === 0) return null;
  const mean = (arr) => arr.reduce((p, c) => p + c, 0) / arr.length;
  // audit/fix (Court Inflection, Karl-Direktive): die AELTESTE zusammenhaengende Vor-Profit-Verlust-
  // Serie vor dem Mitteln abschneiden (opPaired ist newest-first; opPaired[end-1] = aeltestes Jahr).
  // Eine gerade-profitable Firma (neuestes OpInc>0, aeltere <0) wurde durch mean(ALLE Jahre) — inkl.
  // der Vor-Profit-Verluste — auf ROIC-Ebene bestraft (Inflection 29. vs reif 53. Perzentil; CRDO 11.,
  // ALAB 18.). Der Trim misst die Rendite im PROFITABLEN Regime. Data-learned (nur das <=0-Vorzeichen-
  // Guard-Muster wie signTrack/penalty, KEINE Magic Number). Reife all-positive Namen: nichts getrimmt
  // -> byte-identisch. Verschlechterer (neuestes OpInc<0): das aelteste Jahr ist profitabel -> Loop
  // trimmt NICHTS -> neutral (kein Rescue; marginTrajectory+cycleDiscount tragen das Verschlechterungs-
  // Signal bereits, capEff-Neutralitaet vermeidet Doppel-Zaehlung).
  // audit/fix (Bug 6): Trim NUR wenn ein profitables Regime existiert (juengstes Jahr >0).
  // Bei durchgehend negativer OpInc-Serie kollabierte der Trim sonst auf das juengste
  // Verlustjahr (roic = opInc[0]/inv[0]) -> Verlust-Verkleinerer gerescued, -Vergroesserer
  // doppelt bestraft. Kein profitables Regime -> voller Mehrjahres-Schnitt (dokumentierter
  // Verschlechterer-Kontrakt: kein Rescue, keine Doppel-Strafe).
  let end = opPaired.length;
  if (opPaired[0] > 0) {
    while (end > 1 && opPaired[end - 1] <= 0) end--;
  }
  const roic = mean(opPaired.slice(0, end)) / mean(invPaired.slice(0, end));

  // Asset-Growth-Penalty (nur wenn beide Wachstumsraten berechenbar)
  let penalty = 0;
  const aTwo = adjacentTwoPresent(assets);
  const rTwo = adjacentTwoPresent(norm(s, 'annualRev'));
  if (aTwo && aTwo[1] > 0 && rTwo && rTwo[1] > 0) {
    const assetGrowth = aTwo[0] / aTwo[1] - 1;
    const revGrowth = rTwo[0] / rTwo[1] - 1;
    penalty = Math.max(0, assetGrowth - revGrowth);
  }
  // Zyklus-Peak-Discount (Court-Spec): roher 4J-ROIC belohnt am Commodity-Peak
  // den Peak (Gold-Miner bei Rekordpreis). Liegt die juengste OpMarge weit ueber
  // dem Eigen-Schnitt -> Discount holt den ROIC auf zyklus-bereinigtes Niveau
  // zurueck. Trough-Recovery/stabil (cur <= histRest) -> Discount 1 (neutral);
  // Software mit stabil hoher Marge unberuehrt. 1/(1+overshoot) bleibt in (0,1].
  const opIncRaw = norm(s, 'annualOpInc'), revRaw = norm(s, 'annualRev');
  const marginsRaw = ratioSeries(opIncRaw, revRaw);
  const margins = presentValues(marginsRaw);
  let cycleDiscount = 1;
  // audit/fix (Hard-Review NRB-SC-002, BH-080-Analog): presentValues() kompaktiert eine FUEHRENDE
  // Luecke weg (annualRev[0] fehlt/0 -> marginsRaw[0]=null) -- margins[0] waere dann eine AELTERE
  // Marge, faelschlich als "cur" (juengste Marge) fuer den Zyklus-Peak-Discount gewertet (UAN-Muster).
  // Discount nur anwenden, wenn die ROHE (nicht-kompaktierte) Marge am Index 0 selbst present ist.
  if (marginsRaw[0] !== null && margins.length >= 3) {
    const cur = margins[0];
    const prev = margins[1];
    const histRest = mean(margins.slice(1));
    if (histRest > 0 && cur > histRest) {
      // audit/fix (Court Phase A Runde 2, Fall 4): das frühere binäre !rising-Gate
      // (cur>prev) togglete den Discount hart (bis Faktor 2) an einer infinitesimalen
      // Margen-Kante. Ersetzt durch eine SELBST-SKALIERENDE stetige Rampe OHNE neuen
      // Parameter: blend = Anteil des Überschusses über histRest, der aus dem jüngsten
      // Anstieg (cur-prev) stammt. Voll steigend (climb>=1) -> blend 1 -> Discount 1
      // (struktureller Durchbruch). Flach/fallend (climb<=0) -> blend 0 -> voller
      // rawDisc (Zyklus-Peak). Extremverhalten identisch zum alten Gate, nur die Kante
      // wird weich. Rampenbreite skaliert mit dem Overshoot selbst -> keine Magic Number.
      const overshoot = cur / histRest - 1;
      const rawDisc = 1 / (1 + Math.max(0, overshoot));
      const climb = (cur - histRest) > 0 ? (cur - prev) / (cur - histRest) : 0;
      const blend = Math.max(0, Math.min(1, climb));
      cycleDiscount = 1 - (1 - rawDisc) * (1 - blend);
    }
  }
  return roic * cycleDiscount - penalty;
}

// --- 7. Analysten-Revisions-Momentum ----------------------------------------
// (up-down)/(up+down) gemittelt ueber 0y/+1y, 30/90-Tage-Fenster. null wenn leer.
// HINWEIS (Karl-Direktive 2026-06-29): diese Achse ist BEWUSST aus ALLEN Formeln entfernt und in
// KEINE Formel verdrahtet — der Screener bewertet auf harten Fundamentaldaten, NICHT auf Wall-Street-
// Analysten-Sentiment (Karl macht seine eigene Bewertung; zudem nur 47% Datenabdeckung, oft stale).
// Die Funktion bleibt als Rechner erhalten (reversibel), wird aber vom Scoring nicht mehr aufgerufen.
function revisionsMomentum(s) {
  const er = s && s.external ? s.external.estimateRevisions : null;
  if (!er) return null;
  const ratios = [];
  for (const horizon of ['0y', '+1y']) {
    const h = er[horizon];
    if (!h) continue;
    for (const [u, d] of [['upLast30Days', 'downLast30Days'], ['upLast90Days', 'downLast90Days']]) {
      const up = h[u], dn = h[d];
      if (Number.isFinite(up) && Number.isFinite(dn) && (up + dn) > 0) {
        ratios.push((up - dn) / (up + dn));
      }
    }
  }
  if (ratios.length === 0) return null;
  return ratios.reduce((p, c) => p + c, 0) / ratios.length;
}

// --- 8. Dilution / SBC-Drag -------------------------------------------------
// Primaerpfad annualSBC/annualRev: Niveau (juengstes GJ) + Trend. Hoeheres
// Signal = niedrigere/fallende Verwaesserung. Kein present SBC -> null (drop+renorm).
function dilution(s) {
  const sbc = norm(s, 'annualSBC');
  if (!hasPresent(sbc)) return null; // CAT/CVX/XOM -> Achse droppt, KEIN Fake-50
  // audit/fix (Court Fall 1, F17 + Runde-2-Regress R2F1): SBC/Rev gegen degenerierte near-zero-Nenner
  // guarden, OHNE die Achse fuer ECHTE Heavy-Diluter zu droppen. Das erste Nullen (v>1 -> null) liess
  // bei realen Heavy-Dilutern (newest SBC/Rev>1) den LEVEL weg -> Achse droppt -> renorm-on-drop -> der
  // Diluter entging der Strafe (Score inflationiert, R2F1 high). Jetzt: LEVEL clampen (nie droppen);
  // SLOPE nur wenn das aelteste SBC/Rev plausibel ist (<=1) — ein near-zero-Nenner-Blowup (IBRX old=167)
  // -> Slope=0 (nur Niveau zaehlt) statt das Ranking zu invertieren. Ratio-Plausibilitaet, kein Niveau.
  const raw = ratioSeries(sbc, norm(s, 'annualRev'));
  // audit/fix (Hard-Review S2-SC-002, BH-080-Analog): firstPresent(raw) ueberspringt eine FUEHRENDE
  // Luecke (annualSBC[0] fehlt) und liefert ein AELTERES Jahr als "level" (EE: annualSBC=[null,null,
  // null,956000,null] -> firstPresent gab das 4 Jahre alte SBC/Rev-Verhaeltnis als aktuelles Niveau
  // aus, dilution~-0.0004 statt "unbekannt"). raw[0] (echtes juengstes GJ) muss selbst present sein,
  // sonst ist das AKTUELLE Dilutions-Niveau unbekannt -> Achse droppen (renorm-on-drop), KEIN aus
  // einem Altjahr abgeleiteter Fake-Wert.
  const levelRaw = raw[0];
  if (levelRaw === null || levelRaw === undefined) return null;
  const level = Math.min(1, Math.max(0, levelRaw));            // clampen, NIE droppen (Heavy-Diluter behaelt Strafe)
  const oldRaw = lastPresent(raw);
  const slope = (oldRaw !== null && oldRaw >= 0 && oldRaw <= 1) ? (level - oldRaw) : 0; // implausibles old -> Slope=0
  return -(level) - slope;
}

// --- 9. Margen-NIVEAU (Bruttomarge, Franchise-vs-commodity-Diskriminator) ----
// GM = firstPresent(annualGP)/firstPresent(annualRev), index-aligned via ratioSeries
// (juengstes gemeinsam present GJ). Misst das NIVEAU (nicht die Trajektorie wie gpGrowth) —
// das einzige Achsen-Signal, das commodity-EMS (GM 8-12%) strukturell unter Franchise
// (GM 37-68%) zieht. Roh-Signal hoeher=besser; null-on-absence (renorm-on-drop, nie Fake-50).
// Guard analog gpGrowth (F9): gm = GP/Rev muss in [0,1] liegen; gm>1 (GP>Rev) bzw. gm<0 sind
// korrupte Datenjahre -> verwerfen, damit das juengste implausible Jahr das Niveau nicht auf
// ein Phantom pinnt. Ratio-Natur => waehrungs-invariant. NUR in tech-hardware.js verdrahtet
// (2.12b); fuer alle anderen Formeln inert (kein axes[]-Eintrag -> nie aufgerufen, wie
// revisionsMomentum).
function marginLevel(s) {
  const gm = ratioSeries(norm(s, 'annualGP'), norm(s, 'annualRev'))
    .map((v) => (v !== null && v >= 0 && v <= 1) ? v : null);
  return firstPresent(gm); // ROH-GM-Niveau [0,1], hoeher=besser; null-on-absence
}

// --- roicStability (3.1 QC-Board, benannt-leer bis Phase 4.1) ----------------
// NEGATIVER Variationskoeffizient (CoV = std/|mean|) der JAEHRLICHEN ROIC-Serie
// (OpInc/invested je FY, invested = totalAssets - currentLiabilities wie in
// capitalEfficiency). Hoeher (naeher 0) = stabiler = besser -> Vorzeichen negiert.
// HART gegated: verlangt >= ROIC_STAB_MIN_YEARS gepaarte (OpInc present, invested>0)-
// Jahre. ROIC_STAB_MIN_YEARS ist ein DATEN-VERFUEGBARKEITS-Gate (analog
// profit-tier LONGTERM_MIN_YEARS=4), KEINE Score-Magic-Number: auf den heutigen
// Yahoo-Daten (~4 GJ, oft fehlendes currentLiabilities) -> praktisch ueberall null
// (renorm-on-drop, kein Fake-50). Misst Mehr-Zyklus-Konsistenz, nicht Niveau
// (das traegt capitalEfficiency). null-on-absence wie marginLevel.
const ROIC_STAB_MIN_YEARS = 6;
// Inline-Leser der tiefen committeten SEC-Serie (snapshot.secAnnual, {value}[] von run-screener
// mergeSecIntoUniverse angehaengt) als Plain-Number-Serie — 1:1 das normSec-Muster (score.js:338-342),
// hier lokal, damit axes.js keine Zirkular-Dependency auf score.js aufbaut (axes.js kennt nur norm).
function secSeries(s, field) {
  const raw = s && s.secAnnual && s.secAnnual[field];
  if (!Array.isArray(raw) || raw.length === 0) return null;
  return raw.map((e) => { const v = (e && typeof e === 'object') ? e.value : e; return Number.isFinite(v) ? v : null; });
}
// Single-Source-Trio (Phase 4.1): OpInc + Assets + CurrLiab ENTWEDER alle aus der tiefen SEC-Serie
// (secAnnual, ~10-15J) ODER alle aus Yahoo (annualBalance ~4J) — NIE feldweise gemischt, sonst entstuende
// eine ROIC-Serie aus zeitlich unverbundenen Fenstern (Yahoo-OpInc-4J vs SEC-Bilanz-15J), genau was
// cycleSeriesPair via useSec verbietet (score.js:358-359). secAnnual-Bilanz liegt in buildAnnual
// index-aligned zu OpInc (dieselbe _fys-Achse) -> FY-kohaerent. useSec gdw alle drei tiefen Serien present,
// Index0 non-null, und die tiefe OpInc mind. so tief wie Yahoo. Kein secAnnual -> Yahoo (byte-identisch).
function roicStabilitySource(s) {
  const opY = norm(s, 'annualOpInc');
  const assetsY = norm(s, 'annualBalance', 'totalAssets');
  const curLiabY = norm(s, 'annualBalance', 'currentLiabilities');
  const opS = secSeries(s, 'annualOpInc');
  const assetsS = secSeries(s, 'annualAssets');
  const curLiabS = secSeries(s, 'annualCurrentLiabilities');
  const useSec = opS && assetsS && curLiabS
    && opS[0] !== null && assetsS[0] !== null && curLiabS[0] !== null
    && opS.length >= opY.length;
  // Tag 561: _source benennt die getroffene Wahl, damit Diagnose-Zaehler (run-screener
  // mergeSecIntoUniverse) die WIRKSAME Abdeckung melden koennen, ohne die useSec-Regel
  // ein zweites Mal nachzubauen. Keine Logik-Aenderung: alle Leser destrukturieren
  // opInc/assets/curLiab namentlich.
  return useSec ? { opInc: opS, assets: assetsS, curLiab: curLiabS, _source: 'sec' }
                : { opInc: opY, assets: assetsY, curLiab: curLiabY, _source: 'yahoo' };
}
function roicStability(s) {
  const { opInc: opIncS, assets, curLiab } = roicStabilitySource(s);
  const roics = [];
  const nYears = Math.max(opIncS.length, assets.length);
  for (let i = 0; i < nYears; i++) {
    const o = opIncS[i], a = assets[i], c = curLiab[i];
    if (o === null || o === undefined || a === null || a === undefined) continue;
    if (c === null || c === undefined) continue;      // jahres-genauer ROIC (kein ROA-Fallback)
    const inv = a - c;
    if (!(inv > 0)) continue;
    roics.push(o / inv);
  }
  if (roics.length < ROIC_STAB_MIN_YEARS) return null; // hartes Daten-Gate -> heute ~ueberall null
  const mean = roics.reduce((p, c) => p + c, 0) / roics.length;
  if (!(Math.abs(mean) > 0)) return null;              // CoV undefiniert bei mean 0
  const variance = roics.reduce((p, c) => p + (c - mean) * (c - mean), 0) / roics.length;
  const cov = Math.sqrt(variance) / Math.abs(mean);
  return -cov;                                         // hoeher (naeher 0) = stabiler = besser
}

module.exports = {
  revGrowthLevel, revAcceleration, gpGrowth, ruleOfX, revYoYComponents,
  revAnnualYoY, revQuartalsYoY, // F-4: die beiden Beine einzeln (Tests/Messung)
  marginTrajectory, capitalEfficiency, revisionsMomentum, dilution, marginLevel, roicStability,
  // U-SC-003: die EINE Quellenwahl fuer OpInc/Assets/CurrLiab — auch die Anzeige-Lampe lowRoic
  // (lamps.js) liest sie, damit Lampe und Achse nie zwei verschiedene ROIC-Quellen benutzen.
  // Reiner Export, keine Logik-Aenderung an der Achse.
  roicStabilitySource,
  // C2: per-Quartal-Rohwerte fuer die universe-weite Winsor-Schranken-Sammlung in score.js
  quarterOpMargins, quarterQoQRates,
  // Helfer fuer Tests/Formeln
  _helpers: { lastPresent },
};

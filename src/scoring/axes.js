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

const { norm, hasPresent, firstPresent, presentValues, metricVal, ratioSeries } = require('./snapshot.js');
const { fcfMarginValid } = require('./engine.js');

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
function revYoYComponents(s) {
  const comps = [];
  const ar = adjacentTwoPresent(norm(s, 'annualRev'));
  if (ar && ar[1] > 0) { const g = ar[0] / ar[1] - 1; if (Number.isFinite(g)) comps.push(g); }
  const rq = norm(s, 'revenueQ');
  if (rq.length >= 5 && rq.slice(0, 5).every(Number.isFinite) && rq[4] > 0) {
    const g = rq[0] / rq[4] - 1; if (Number.isFinite(g)) comps.push(g);
  }
  return comps; // 0..2 Werte (Bruchteile, nicht %)
}
// CHIRURGISCH, nicht semantisch: das Skalar WAR Yahoos Quartals-YoY (juengstes Quartal
// vs Vorjahres-Quartal) — die Achse rechnet exakt DIESELBE Groesse selbst aus revenueQ
// (CRDO: berechnet 201,5 % == Skalar; gesunde Namen aendern sich nicht). Nur wo die
// Quartalsreihe fehlt, traegt annual-lag1 als dokumentierter Fallback. Ein Wechsel des
// WACHSTUMSBEGRIFFS (z. B. robustG-Blend) waere eine Formel-Verbesserung und gehoert
// vor den Court (2.14-v4), nicht in einen Datenrichtigkeits-Fix — Audit 14.07.: der
// Blend reorderte median 9 Raenge ueber 3354 Namen ohne Anker-/Glitch-Nutzen.
function revGrowthLevel(s, growthBounds) {
  const comps = revYoYComponents(s); // [annual-lag1?, quartal-lag4?] (Bruchteile)
  if (!comps.length) return null; // keine Reihe -> Achse droppt ehrlich (renorm-on-drop), KEIN Skalar-Fallback (der Skalar ist genau fuer reihen-lose Namen unpruefbar)
  // Reihenfolge in revYoYComponents: annual zuerst, quartal zweit (wenn beide da).
  const rq = norm(s, 'revenueQ');
  const hasQuarter = rq.length >= 5 && rq.slice(0, 5).every(Number.isFinite) && rq[4] > 0;
  let g = hasQuarter ? comps[comps.length - 1] : comps[0];
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
// DATENBEDARF — und die unbequeme Messung dazu (26.07.2026, ueber 4768 lokale Snapshots):
// Quartalsweise braucht die Achse >=2 YoY-Paare, also >=6 present Quartale. Yahoo liefert
// aber HOECHSTENS 5 (Verteilung ueber 1500 Snapshots: 964x fuenf, 372x vier, nichts
// darueber) — mit 5 Quartalen gibt es genau EIN YoY-Paar und damit keine Aenderungsrate.
// Folge, ehrlich benannt: der Quartals-Zweig greift heute bei 1 von 4768 Namen, 4472
// laufen ueber den JAHRES-Fallback (93,8 % Abdeckung), 295 droppen auf null
// (renorm-on-drop). Die Achse misst damit faktisch JAHRES-Beschleunigung.
//
// Das ist keine Schwaeche der Rechnung, sondern die Grenze der Datenquelle: eine
// saisonsaubere QUARTALS-Beschleunigung ist aus 5 Quartalen nicht konstruierbar. Wer sie
// zurueckwill, braucht tiefere Quartalshistorie (>=8 Quartale) — Kandidat ist die bereits
// vorhandene SEC-XBRL-Schicht, nicht ein Rueckbau auf die kaputte QoQ-Konstruktion.
// Jahresdaten sind saisonfrei, die Groesse ist dieselbe, nur eine Ebene grober und
// traeger (reagiert ein Jahr spaeter).
function revAcceleration(s, bounds) {
  const rq = norm(s, 'revenueQ');
  const yoy = [];
  for (let i = 0; i + 4 < rq.length; i++) {
    const a = rq[i], b = rq[i + 4];
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
  const gmNew = firstPresent(gm), gmOld = lastPresent(gm);
  const gmTraj = (gmNew !== null && gmOld !== null) ? (gmNew - gmOld) : 0;
  return gpYoY + gmTraj;
}

// --- 4. Growth-Efficiency (Rule-of-X, growth-dominant) ----------------------
// alpha*revGrowth(%) + FCF-Marge(%) — FCF-Term nur wenn fcfSignGuard ihn
// validiert UND includeFcf (Profitable-Track). Unprofitable-Track: includeFcf
// = false -> reiner alpha*revGrowth (kein BE-Penalty).
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
  const margins = presentValues(ratioSeries(norm(s, 'annualOpInc'), norm(s, 'annualRev')));
  let cycleDiscount = 1;
  if (margins.length >= 3) {
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
  const levelRaw = firstPresent(raw);
  if (levelRaw === null) return null;
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
  return useSec ? { opInc: opS, assets: assetsS, curLiab: curLiabS }
                : { opInc: opY, assets: assetsY, curLiab: curLiabY };
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
  marginTrajectory, capitalEfficiency, revisionsMomentum, dilution, marginLevel, roicStability,
  // C2: per-Quartal-Rohwerte fuer die universe-weite Winsor-Schranken-Sammlung in score.js
  quarterOpMargins, quarterQoQRates,
  // Helfer fuer Tests/Formeln
  _helpers: { lastPresent },
};

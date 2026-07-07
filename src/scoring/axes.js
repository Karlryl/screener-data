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

const { norm, hasPresent, firstPresent, firstTwoPresent, presentValues, metricVal, ratioSeries } = require('./snapshot.js');
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

// ratioSeries kommt aus snapshot.js (geteilt, finite-/laengen-sicher).

// --- 1. Umsatzwachstum (Niveau) ---------------------------------------------
function revGrowthLevel(s) {
  return metricVal(s,'revenueGrowthYoY'); // % (negativ rankt natuerlich unten)
}

// audit/fix (Court Phase A Runde 3, Fall C2): Winsor-Clamp gegen near-zero-Nenner-Artefakte.
// Ein winziges Basis-Quartal (JOBY revenueQ[oldest]=15000) blaeht abgeleitete Quartals-Groessen
// (QoQ-Rate, OpMarge) auf tausende auf -> Phantom-Extreme dominieren den Rang. Die Schranken
// werden universe-weit gelernt (p1/p99 in score.js), KEIN aufgezwungenes Niveau; ohne bounds
// (Standalone/Tests) unveraendert. Schwester-Achsen gpGrowth (gm-Clip[0,1]) / dilution (Endpunkt-
// Clamp) sind analog gehaertet — diese zwei wurden uebersehen.
const clampWinsor = (v, bounds) => (bounds ? Math.max(bounds[0], Math.min(bounds[1], v)) : v);

// per-Quartal QoQ-Raten (newest-first), optional auf [lo,hi] winsorisiert.
function quarterQoQRates(s, bounds) {
  const rq = norm(s, 'revenueQ').filter((v) => v !== null && v !== undefined);
  const g = [];
  for (let i = 0; i < rq.length - 1; i++) {
    if (rq[i] > 0 && rq[i + 1] > 0) g.push(clampWinsor(rq[i] / rq[i + 1] - 1, bounds)); // beide Quartale positiv
  }
  return g;
}

// --- 2. Umsatz-Beschleunigung (2. Ableitung) --------------------------------
// QoQ-Wachstum ueber aufeinanderfolgende present Quartale (newest-first),
// Beschleunigung = juengstes QoQ minus aeltestes QoQ. >0 = beschleunigt.
function revAcceleration(s, bounds) {
  const rq = norm(s, 'revenueQ').filter((v) => v !== null && v !== undefined);
  if (rq.length < 3) return null; // mind. 2 QoQ-Raten
  const g = quarterQoQRates(s, bounds);
  if (g.length < 2) return null;
  return g[0] - g[g.length - 1];
}

// --- 3. Bruttogewinn-Wachstum + GM-Trajektorie ------------------------------
function gpGrowth(s) {
  const gp = norm(s, 'annualGP');
  const two = firstTwoPresent(gp);
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
function ruleOfX(s, alpha = 2.3, includeFcf = true) {
  const rev = metricVal(s,'revenueGrowthYoY');
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
  const opIncS = norm(s, 'annualOpInc');
  const assets = norm(s, 'annualBalance', 'totalAssets');
  const curLiab = norm(s, 'annualBalance', 'currentLiabilities');
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
  const aTwo = firstTwoPresent(assets);
  const rTwo = firstTwoPresent(norm(s, 'annualRev'));
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

module.exports = {
  revGrowthLevel, revAcceleration, gpGrowth, ruleOfX,
  marginTrajectory, capitalEfficiency, revisionsMomentum, dilution, marginLevel,
  // C2: per-Quartal-Rohwerte fuer die universe-weite Winsor-Schranken-Sammlung in score.js
  quarterOpMargins, quarterQoQRates,
  // Helfer fuer Tests/Formeln
  _helpers: { lastPresent },
};

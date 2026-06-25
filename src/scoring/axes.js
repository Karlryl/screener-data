'use strict';
/**
 * Hypergrowth Engine — die 8 Achsen-Berechner
 * ===========================================
 * Reine Funktionen ueber einen Snapshot. Lesen Serien AUSSCHLIESSLICH ueber
 * norm() (Schicht 0) und Skalare ueber snapshot.metrics. Jede Achse liefert
 * einen ROH-Signalwert (hoeher = besser) ODER null -> dann droppt die Achse
 * und die Engine renormiert die uebrigen Gewichte (renorm-on-drop, nie Fake-50).
 *
 * q() (engine.js) macht das Ranking cohort-relativ — die Achsen muessen also
 * nicht saettigen/skalieren, nur ein konsistentes, monotones Signal liefern.
 *
 * Die 8 Achsen (Plan v4):
 *  1 revGrowthLevel        Umsatzwachstum (Niveau, TTM YoY)
 *  2 revAcceleration       Umsatz-Beschleunigung (QoQ-Slope ueber 5 Quartale)
 *  3 gpGrowth              Bruttogewinn-Wachstum (YoY) + GM-Trajektorie
 *  4 ruleOfX               alpha*revGrowth + FCF-Marge (guarded; Unprofit: ohne FCF)
 *  5 marginTrajectory      Operating-Leverage (OpMargin-Slope ueber Quartale)
 *  6 capitalEfficiency     ROIC-Proxy minus Asset-Growth-Penalty
 *  7 revisionsMomentum     Analysten Up/Down-Saldo (0y/+1y, 30/90d)
 *  8 dilution              -(SBC/Rev) Niveau + Trend (niedriger/fallend = besser)
 */

const { norm, hasPresent, firstPresent, firstTwoPresent, metricVal } = require('./snapshot.js');
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

// Element-weise num/den (newest-first), null wo ein Operand fehlt, kein Array, oder den==0.
function ratioSeries(numS, denS) {
  const a = Array.isArray(numS) ? numS : [];
  const b = Array.isArray(denS) ? denS : [];
  const n = Math.max(a.length, b.length);
  const out = [];
  for (let i = 0; i < n; i++) {
    const x = a[i], y = b[i];
    if (x === null || x === undefined || y === null || y === undefined || y === 0) out.push(null);
    else out.push(x / y);
  }
  return out;
}

// --- 1. Umsatzwachstum (Niveau) ---------------------------------------------
function revGrowthLevel(s) {
  return metricVal(s,'revenueGrowthYoY'); // % (negativ rankt natuerlich unten)
}

// --- 2. Umsatz-Beschleunigung (2. Ableitung) --------------------------------
// QoQ-Wachstum ueber aufeinanderfolgende present Quartale (newest-first),
// Beschleunigung = juengstes QoQ minus aeltestes QoQ. >0 = beschleunigt.
function revAcceleration(s) {
  const rq = norm(s, 'revenueQ').filter((v) => v !== null && v !== undefined);
  if (rq.length < 3) return null; // mind. 2 QoQ-Raten
  const g = [];
  for (let i = 0; i < rq.length - 1; i++) {
    if (rq[i] > 0 && rq[i + 1] > 0) g.push(rq[i] / rq[i + 1] - 1); // beide Quartale positiv
  }
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
  const gm = ratioSeries(norm(s, 'annualGP'), norm(s, 'annualRev'));
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

// --- 5. Marge-/Operating-Leverage-Trajektorie -------------------------------
// Slope der Quartals-OpMargin (opIncQ/revenueQ), neu minus alt. >0 = Hebel greift.
function marginTrajectory(s) {
  const present = ratioSeries(norm(s, 'opIncQ'), norm(s, 'revenueQ'))
    .filter((v) => v !== null && v !== undefined);
  if (present.length < 2) return null;
  return present[0] - present[present.length - 1]; // juengste minus aelteste Marge
}

// --- 6. Kapitaleffizienz / Asset-Disziplin ----------------------------------
// ROIC-Proxy (mean OpInc / mean Invested Capital) minus Asset-Growth-Penalty
// (Asset-Wachstum > Umsatzwachstum = gekauftes Wachstum).
function capitalEfficiency(s) {
  const opInc = norm(s, 'annualOpInc').filter((v) => v !== null);
  const assets = norm(s, 'annualBalance', 'totalAssets');
  const curLiab = norm(s, 'annualBalance', 'currentLiabilities');
  const invested = assets.map((a, i) => {
    if (a === null || a === undefined) return null;
    const c = curLiab[i];
    return a - (c === null || c === undefined ? 0 : c);
  }).filter((v) => v !== null && v > 0);
  if (opInc.length === 0 || invested.length === 0) return null;
  const mean = (arr) => arr.reduce((p, c) => p + c, 0) / arr.length;
  const roic = mean(opInc) / mean(invested);

  // Asset-Growth-Penalty (nur wenn beide Wachstumsraten berechenbar)
  let penalty = 0;
  const aTwo = firstTwoPresent(assets);
  const rTwo = firstTwoPresent(norm(s, 'annualRev'));
  if (aTwo && aTwo[1] > 0 && rTwo && rTwo[1] > 0) {
    const assetGrowth = aTwo[0] / aTwo[1] - 1;
    const revGrowth = rTwo[0] / rTwo[1] - 1;
    penalty = Math.max(0, assetGrowth - revGrowth);
  }
  return roic - penalty;
}

// --- 7. Analysten-Revisions-Momentum ----------------------------------------
// (up-down)/(up+down) gemittelt ueber 0y/+1y, 30/90-Tage-Fenster. null wenn leer.
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
  const r = ratioSeries(sbc, norm(s, 'annualRev'));
  const level = firstPresent(r);
  if (level === null) return null;
  const old = lastPresent(r);
  const slope = (old !== null) ? (level - old) : 0; // steigend = schlechter
  return -(level) - slope;
}

module.exports = {
  revGrowthLevel, revAcceleration, gpGrowth, ruleOfX,
  marginTrajectory, capitalEfficiency, revisionsMomentum, dilution,
  // Helfer fuer Tests/Formeln
  _helpers: { lastPresent, ratioSeries },
};

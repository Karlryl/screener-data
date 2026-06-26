'use strict';
/**
 * Hypergrowth Engine — Schicht 3: Lampen (rank-and-warn)
 * ======================================================
 * Boolesche Warn-Flags, VOLLSTAENDIG getrennt vom Score. Eine Lampe senkt NIE
 * den Score (BE/PLTR ranken trotz Lampe oben) — sie (a) informiert das
 * Entry-Timing fuer den Elliott-Wellen-Chart-Check und (b) kann Track-Routing
 * ausloesen. Jede Lampe liest nur norm()-Serien + metrics. Rueckgabe je Lampe:
 * true (an) / false (aus) / null (nicht bewertbar).
 */

const { norm, hasPresent, firstPresent, firstTwoPresent, presentValues, metricVal, ratioSeries } = require('./snapshot.js');

// Schwellen (bewusst konservativ; Feinkalibrierung in der Formel-/Fixture-Phase)
const TH = {
  WACC_DEFAULT: 0.09,      // ROIC-Hurdle-Proxy
  HIGH_SBC_REV: 0.15,      // SBC/Rev-Niveau, ab dem Verwaesserung warnt
  AR_DIVERGENCE: 0.15,     // AR-Wachstum minus Umsatzwachstum (Channel-Stuffing)
  PEAK_MARGIN_MULT: 1.30,  // aktuelle Marge > 1.3x historischer Schnitt = Peak
  SHORT_RUNWAY_Q: 8,       // < 8 Quartale Cash-Runway = kurz
  HIGH_BETA: 2.5,          // Beta-Crash-Risiko
};

function meanPresent(series) {
  const vals = presentValues(series); // finite-only (faengt NaN/Infinity ab)
  return vals.length ? vals.reduce((p, c) => p + c, 0) / vals.length : null;
}

// 1. Unprofitabel (reine Warnung, KEINE Score-Strafe) ------------------------
function unprofit(s) {
  const op = firstPresent(norm(s, 'annualOpInc'));
  const om = metricVal(s, 'operatingMargin');
  if (op === null && om === null) return null;
  if (op !== null) return op < 0;
  return om < 0;
}

// 2. Burning (juengstes FCF-Jahr negativ) ------------------------------------
function burning(s) {
  const f = firstPresent(norm(s, 'annualFCF'));
  if (f === null) return null;
  return f < 0;
}

// 3. Kurzer Cash-Runway (nur relevant wenn brennend) -------------------------
function shortRunway(s) {
  const f = firstPresent(norm(s, 'annualFCF'));
  if (f === null) return null;
  if (f >= 0) return false; // generiert Cash -> kein Runway-Risiko
  const cash = firstPresent(norm(s, 'annualBalance', 'totalCash'));
  if (cash === null) return null;
  const burnPerQuarter = Math.abs(f) / 4;
  if (burnPerQuarter === 0) return false;
  return (cash / burnPerQuarter) < TH.SHORT_RUNWAY_Q;
}

// 4. Hohe/steigende Verwaesserung (SBC/Rev) ----------------------------------
function highDilution(s) {
  const sbc = norm(s, 'annualSBC');
  if (!hasPresent(sbc)) return null;
  const r = ratioSeries(sbc, norm(s, 'annualRev')); // aligned SBC[i]/Rev[i], nicht unabh. firstPresent
  const lvl = firstPresent(r);
  if (lvl === null) return null;
  return lvl > TH.HIGH_SBC_REV;
}

// 5. Peak-Marge (zyklische Warnung) ------------------------------------------
function peakMargin(s) {
  const om = metricVal(s, 'operatingMargin');
  // historischer Margen-Schnitt aus annualOpInc/annualRev (aligned via ratioSeries)
  const margins = ratioSeries(norm(s, 'annualOpInc'), norm(s, 'annualRev'));
  const cur = (om !== null) ? om / 100 : firstPresent(margins);
  const histRest = meanPresent(margins.slice(1)); // ohne juengstes
  if (cur === null || histRest === null || histRest <= 0) return null;
  return cur > TH.PEAK_MARGIN_MULT * histRest;
}

// 6. ROIC < WACC-Proxy -------------------------------------------------------
function lowRoic(s) {
  // audit/fix (L2): wie capitalEfficiency (E1) — op (alle OpInc-Jahre) und inv (alle assets-Jahre)
  // mittelten ueber verschiedene Jahres-Sets. Jetzt pro Jahr zippen (OpInc present UND assets present).
  const opS = norm(s, 'annualOpInc');
  const assets = norm(s, 'annualBalance', 'totalAssets');
  const curLiab = norm(s, 'annualBalance', 'currentLiabilities');
  const opP = [], invP = [];
  const nYears = Math.max(opS.length, assets.length);
  for (let i = 0; i < nYears; i++) {
    const o = opS[i], a = assets[i];
    if (!Number.isFinite(o) || !Number.isFinite(a)) continue;
    const c = curLiab[i];
    opP.push(o); invP.push(a - (Number.isFinite(c) ? c : 0));
  }
  if (opP.length === 0) return null;
  const mean = (arr) => arr.reduce((p, c) => p + c, 0) / arr.length;
  const inv = mean(invP);
  if (inv <= 0) return null;
  return (mean(opP) / inv) < TH.WACC_DEFAULT;
}

// 7. AR-Divergenz (Forderungen wachsen schneller als Umsatz) -----------------
function arDivergence(s) {
  const ar = firstTwoPresent(norm(s, 'annualBalance', 'accountsReceivable'));
  const rev = firstTwoPresent(norm(s, 'annualRev'));
  if (!ar || !rev || ar[1] <= 0 || rev[1] <= 0) return null;
  const arG = ar[0] / ar[1] - 1;
  const revG = rev[0] / rev[1] - 1;
  return (arG - revG) > TH.AR_DIVERGENCE;
}

// 8. Crash-Risiko (hohe Volatilitaet) ----------------------------------------
function crashRisk(s) {
  const beta = metricVal(s, 'beta');
  if (beta === null) return null;
  return beta > TH.HIGH_BETA;
}

// 9. FCF-Artefakt: positive TTM-FCF-Marge, aber juengstes annualFCF-Jahr ist
// NEGATIV (echtes Vorzeichen-Artefakt wie NVTS +108%). Ein Turnaround mit
// positivem juengstem Jahr (BE/CRDO) ist KEIN Artefakt und wird NICHT geflaggt.
function fcfArtefact(s) {
  const ttm = metricVal(s, 'fcfMarginTTM');
  if (ttm === null || ttm <= 0) return false; // nur positive TTM koennen Artefakt sein
  const f0 = firstPresent(norm(s, 'annualFCF'));
  if (f0 === null) return null; // kein juengstes FCF-Jahr -> nicht bewertbar
  return f0 < 0; // TTM positiv, aber juengstes Jahr negativ = Artefakt
}

// 10. Zyklus-Peak (Court-Spec): schaerfere, Recovery-bewusste Peak-Warnung —
// flaggt NUR, wenn die aktuelle OpMarge weit ueber dem Eigen-Schnitt liegt UND
// nicht mehr steigt (echter Zyklus-Peak, kein struktureller Durchbruch). Damit
// werden Commodity-Peak-Price-Taker (Gold-Miner am Rekordpreis) markiert, ein
// echter Margen-Expandierer (cur>hist aber steigend) NICHT.
function cyclePeak(s) {
  const margins = ratioSeries(norm(s, 'annualOpInc'), norm(s, 'annualRev')); // aligned
  const m = presentValues(margins);
  if (m.length < 3) return null;
  const histRest = meanPresent(m.slice(1));
  if (histRest === null || histRest <= 0) return null;
  const rising = m[0] > m[1];
  return (m[0] > TH.PEAK_MARGIN_MULT * histRest) && !rising;
}

const LAMPS = {
  unprofit, burning, shortRunway, highDilution, peakMargin,
  lowRoic, arDivergence, crashRisk, fcfArtefact, cyclePeak,
};

/**
 * evaluateLamps(s) -> { flags: {name:bool|null}, active: [names mit true] }
 * Reine Anzeige — fliesst NIE in den Score ein.
 */
function evaluateLamps(s) {
  const flags = {};
  const active = [];
  for (const [name, fn] of Object.entries(LAMPS)) {
    const v = fn(s);
    flags[name] = v;
    if (v === true) active.push(name);
  }
  return { flags, active };
}

module.exports = { evaluateLamps, LAMPS, TH, ...LAMPS };

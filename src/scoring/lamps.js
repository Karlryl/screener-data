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

const { norm, hasPresent, firstPresent, firstTwoPresent, metricVal } = require('./snapshot.js');

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
  const vals = (Array.isArray(series) ? series : []).filter((v) => v !== null && v !== undefined);
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
  const rev0 = firstPresent(norm(s, 'annualRev'));
  const sbc0 = firstPresent(sbc);
  if (rev0 === null || rev0 <= 0 || sbc0 === null) return null;
  return (sbc0 / rev0) > TH.HIGH_SBC_REV;
}

// 5. Peak-Marge (zyklische Warnung) ------------------------------------------
function peakMargin(s) {
  const om = metricVal(s, 'operatingMargin');
  // historischer Margen-Schnitt aus annualOpInc/annualRev
  const opS = norm(s, 'annualOpInc');
  const revS = norm(s, 'annualRev');
  const margins = opS.map((v, i) => (v !== null && revS[i] !== null && revS[i] !== 0) ? v / revS[i] : null);
  const cur = (om !== null) ? om / 100 : firstPresent(margins);
  const histRest = meanPresent(margins.slice(1)); // ohne juengstes
  if (cur === null || histRest === null || histRest <= 0) return null;
  return cur > TH.PEAK_MARGIN_MULT * histRest;
}

// 6. ROIC < WACC-Proxy -------------------------------------------------------
function lowRoic(s) {
  const op = meanPresent(norm(s, 'annualOpInc'));
  const assets = norm(s, 'annualBalance', 'totalAssets');
  const curLiab = norm(s, 'annualBalance', 'currentLiabilities');
  const invested = assets.map((a, i) => (a !== null) ? a - (curLiab[i] === null ? 0 : curLiab[i]) : null);
  const inv = meanPresent(invested);
  if (op === null || inv === null || inv <= 0) return null;
  return (op / inv) < TH.WACC_DEFAULT;
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

const LAMPS = {
  unprofit, burning, shortRunway, highDilution, peakMargin,
  lowRoic, arDivergence, crashRisk, fcfArtefact,
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

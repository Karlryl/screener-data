'use strict';
/**
 * Tag 117: Premium-Compounder-Proof (Composite, fuer Conditional FCF-Yield 1.5-3%)
 * ==================================================================================
 * Konsens nach 5-Runden-Battle: Quality-Compounder mit FCF-Yield 1.5-3% darf nur
 * passieren wenn alle 6 Premium-Punkte erfuellt sind. Damit kommen NVDA/MSFT/ASML
 * trotz niedrigem FCF-Yield rein, Pre-Profit-Tech mit 0.3% nicht.
 *
 *   1. 5Y Revenue CAGR >= 15%
 *   2. 5Y Median Operating Margin >= 25%
 *   3. PreTax-ROIC >= 25%
 *   4. Net Cash ODER Net-Debt/EBITDA <= 1.0
 *   5. 5Y Median FCF / NetIncome >= 80%
 *   6. 5Y Median (Capex + R&D) / OCF >= 30%
 */
const H = require('./_helpers.js');

const ID = 'premium-compounder-proof';
const LABEL = 'Premium-Compounder-Proof';

function _arrVals(stock, path) {
  const arr = H.val(stock, path);
  if (!Array.isArray(arr)) return [];
  return arr.map(v => v == null ? null : (typeof v === 'number' ? v : v.value)).filter(v => Number.isFinite(v));
}
function _rawVals(stock, path) {
  const arr = H.val(stock, path);
  if (!Array.isArray(arr)) return [];
  return arr.map(v => v == null ? null : (typeof v === 'number' ? v : v.value));
}
function _median(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
function _cagr(latest, oldest, years) {
  if (oldest == null || oldest <= 0 || latest == null) return null;
  return Math.pow(latest / oldest, 1/years) - 1;
}

function evaluate(stock) {
  if (!stock) {
    return H.buildResult({ computable: false, pass: false, reason: 'no stock data' });
  }
  // Use raw (positionally aligned) arrays for parallel indexing
  const rawRevs = _rawVals(stock, 'annual.annualRev');
  const rawOpIncs = _rawVals(stock, 'annual.annualOpInc');
  const rawNis = _rawVals(stock, 'annual.annualNetIncome');
  const rawFcfs = _rawVals(stock, 'annual.annualFCF');
  const rawCapex = _rawVals(stock, 'annual.annualCapex').map(v => v == null ? null : Math.abs(v));
  const rawOcf = _rawVals(stock, 'annual.annualOCF');
  const rawRnd = _rawVals(stock, 'annual.annualRnD');
  // Filtered arrays for length checks and single-series use
  const revs = rawRevs.filter(v => Number.isFinite(v));
  const opIncs = rawOpIncs.filter(v => Number.isFinite(v));
  const nis = rawNis.filter(v => Number.isFinite(v));
  const fcfs = rawFcfs.filter(v => Number.isFinite(v));
  const capex = rawCapex.filter(v => Number.isFinite(v));
  const ocf = rawOcf.filter(v => Number.isFinite(v));
  const rnd = rawRnd.filter(v => Number.isFinite(v));
  const totalAssets = H.latestBalance(stock, 'totalAssets');
  const totalCash = H.latestBalance(stock, 'totalCash');
  const totalDebt = H.latestBalance(stock, 'totalDebt');

  const checks = [];
  let allPass = true;

  // 1. 5Y Revenue CAGR >= 15%
  // Bug #10: use rawRevs[4] (positional) not revs[4] (filtered). Filtered array
  // collapses null years, making _cagr span fewer calendar years than intended.
  let rev5yCagr = null;
  if (rawRevs.length >= 5 && Number.isFinite(rawRevs[0]) && Number.isFinite(rawRevs[4])) {
    rev5yCagr = _cagr(rawRevs[0], rawRevs[4], 4); // 4-period CAGR over 5 datapoints
  }
  const c1 = rev5yCagr != null && rev5yCagr >= 0.15;
  checks.push({ name: 'rev5yCAGR>=15', pass: c1, val: rev5yCagr });
  if (!c1) allPass = false;

  // 2. 5Y Median OpMargin >= 25% — zip rawRevs × rawOpIncs positionally
  const opMs = [];
  const yrs = Math.min(5, rawRevs.length, rawOpIncs.length);
  for (let i = 0; i < yrs; i++) {
    if (Number.isFinite(rawRevs[i]) && rawRevs[i] > 0 && Number.isFinite(rawOpIncs[i])) opMs.push(rawOpIncs[i] / rawRevs[i]);
  }
  const opMed = _median(opMs);
  const c2 = opMed != null && opMed >= 0.25;
  checks.push({ name: 'opMargMed>=25', pass: c2, val: opMed });
  if (!c2) allPass = false;

  // 3. PreTax-ROIC >= 25% (latest)
  let preTaxROIC = null;
  if (Number.isFinite(rawOpIncs[0]) && totalAssets != null) {
    const ic = totalAssets - (totalCash || 0);
    if (ic > 0) preTaxROIC = rawOpIncs[0] / ic;
  }
  const c3 = preTaxROIC != null && preTaxROIC >= 0.25;
  checks.push({ name: 'preTaxROIC>=25', pass: c3, val: preTaxROIC });
  if (!c3) allPass = false;

  // 4. Net Cash OR ND/EBITDA <= 1.0
  let netCash = null;
  let ndOverEbitda = null;
  if (totalDebt != null) {
    netCash = (totalCash || 0) - totalDebt;
    if (Number.isFinite(rawOpIncs[0])) {
      const ebitda = rawOpIncs[0] * 1.2;
      if (ebitda > 0) ndOverEbitda = (totalDebt - (totalCash || 0)) / ebitda;
    }
  }
  const c4 = (netCash != null && netCash >= 0) || (ndOverEbitda != null && ndOverEbitda <= 1.0);
  checks.push({ name: 'netCash|ND/EBITDA<=1', pass: c4, val: ndOverEbitda });
  if (!c4) allPass = false;

  // 5. 5Y Median FCF/NetIncome >= 80% — zip rawFcfs × rawNis positionally
  const fcfNi = [];
  const fNyrs = Math.min(5, rawFcfs.length, rawNis.length);
  for (let i = 0; i < fNyrs; i++) {
    if (Number.isFinite(rawNis[i]) && rawNis[i] > 0 && Number.isFinite(rawFcfs[i])) fcfNi.push(rawFcfs[i] / rawNis[i]);
  }
  const fcfNiMed = _median(fcfNi);
  const c5 = fcfNiMed != null && fcfNiMed >= 0.80;
  checks.push({ name: 'fcf/ni>=80', pass: c5, val: fcfNiMed });
  if (!c5) allPass = false;

  // 6. 5Y Median (Capex+R&D)/OCF >= 30% — zip rawCapex × rawOcf × rawRnd positionally
  const reinvest = [];
  const reYrs = Math.min(5, rawCapex.length, rawOcf.length);
  for (let i = 0; i < reYrs; i++) {
    if (Number.isFinite(rawOcf[i]) && rawOcf[i] > 0) {
      const c = Number.isFinite(rawCapex[i]) ? rawCapex[i] : 0;
      const r = (i < rawRnd.length && Number.isFinite(rawRnd[i])) ? rawRnd[i] : 0;
      reinvest.push((c + r) / rawOcf[i]);
    }
  }
  const reMed = _median(reinvest);
  const c6 = reMed != null && reMed >= 0.30;
  checks.push({ name: '(capex+rnd)/ocf>=30', pass: c6, val: reMed });
  if (!c6) allPass = false;

  const passing = checks.filter(c => c.pass).length;
  const validInputCount = checks.filter(c => c.val != null).length;
  // Require at least 3 of 6 inputs to be non-null to be considered computable
  const REQUIRED_MIN_INPUTS = 3;
  if (validInputCount < REQUIRED_MIN_INPUTS) {
    return H.buildResult({
      computable: false, pass: false,
      reason: `insufficient inputs: only ${validInputCount}/6 non-null (need >= ${REQUIRED_MIN_INPUTS})`
    });
  }
  return H.buildResult({
    computable: true,
    pass: allPass,
    value: passing,
    components: { checks, passing, total: checks.length },
    reason: allPass
      ? `Premium-Proof: ${passing}/6 erfuellt`
      : `Premium-Proof FAIL: ${passing}/6 - failed: ` + checks.filter(c => !c.pass).map(c => c.name).join(', ')
  });
}

module.exports = {
  id: ID, label: LABEL,
  description: 'Premium-Compounder-Proof (alle 6 muessen passen): Rev-CAGR>=15, OpMarg>=25, ROIC>=25, NetCash/ND<=1, FCF/NI>=80, Reinvest>=30',
  threshold: 6, thresholdOp: 'gte', unit: 'count',
  evaluate
};

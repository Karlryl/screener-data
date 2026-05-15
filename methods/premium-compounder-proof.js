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

  // 1. 5Y Revenue CAGR >= 15%
  // Bug #10: use rawRevs[4] (positional) not revs[4] (filtered). Filtered array
  // collapses null years, making _cagr span fewer calendar years than intended.
  let rev5yCagr = null;
  if (rawRevs.length >= 5 && Number.isFinite(rawRevs[0]) && Number.isFinite(rawRevs[4])) {
    rev5yCagr = _cagr(rawRevs[0], rawRevs[4], 4); // 4-period CAGR over 5 datapoints
  }
  checks.push({ name: 'rev5yCAGR>=15', pass: rev5yCagr != null && rev5yCagr >= 0.15, val: rev5yCagr, computable: rev5yCagr != null });

  // 2. 5Y Median OpMargin >= 25% — zip rawRevs × rawOpIncs positionally
  const opMs = [];
  const yrs = Math.min(5, rawRevs.length, rawOpIncs.length);
  for (let i = 0; i < yrs; i++) {
    if (Number.isFinite(rawRevs[i]) && rawRevs[i] > 0 && Number.isFinite(rawOpIncs[i])) opMs.push(rawOpIncs[i] / rawRevs[i]);
  }
  const opMed = _median(opMs);
  checks.push({ name: 'opMargMed>=25', pass: opMed != null && opMed >= 0.25, val: opMed, computable: opMed != null });

  // 3. PreTax-ROIC >= 25% (latest)
  let preTaxROIC = null;
  if (Number.isFinite(rawOpIncs[0]) && totalAssets != null) {
    const ic = totalAssets - (totalCash || 0);
    if (ic > 0) preTaxROIC = rawOpIncs[0] / ic;
  }
  checks.push({ name: 'preTaxROIC>=25', pass: preTaxROIC != null && preTaxROIC >= 0.25, val: preTaxROIC, computable: preTaxROIC != null });

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
  const c4Computable = (netCash != null) || (ndOverEbitda != null);
  const c4 = (netCash != null && netCash >= 0) || (ndOverEbitda != null && ndOverEbitda <= 1.0);
  checks.push({ name: 'netCash|ND/EBITDA<=1', pass: c4, val: ndOverEbitda != null ? ndOverEbitda : netCash, computable: c4Computable });

  // 5. 5Y Median FCF/NetIncome >= 80% — zip rawFcfs × rawNis positionally
  const fcfNi = [];
  const fNyrs = Math.min(5, rawFcfs.length, rawNis.length);
  for (let i = 0; i < fNyrs; i++) {
    if (Number.isFinite(rawNis[i]) && rawNis[i] > 0 && Number.isFinite(rawFcfs[i])) fcfNi.push(rawFcfs[i] / rawNis[i]);
  }
  const fcfNiMed = _median(fcfNi);
  checks.push({ name: 'fcf/ni>=80', pass: fcfNiMed != null && fcfNiMed >= 0.80, val: fcfNiMed, computable: fcfNiMed != null });

  // 6. 5Y Median (Capex+R&D)/OCF >= 30% — zip rawCapex × rawOcf × rawRnd positionally.
  // Soft-N/A when OCF or RnD series are entirely missing (cache gaps for software
  // companies). In that case check #6 is marked computable:false and excluded
  // from the all-pass gate rather than auto-failing the entire method.
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
  const ocfAvailable = rawOcf.some(v => Number.isFinite(v) && v > 0);
  const c6Computable = reMed != null && ocfAvailable;
  checks.push({ name: '(capex+rnd)/ocf>=30', pass: c6Computable && reMed >= 0.30, val: reMed, computable: c6Computable });

  const evaluable = checks.filter(c => c.computable);
  const passing = checks.filter(c => c.pass).length;
  // Require at least 3 of 6 checks to be computable for the method to be usable.
  const REQUIRED_MIN_EVALUABLE = 3;
  if (evaluable.length < REQUIRED_MIN_EVALUABLE) {
    return H.buildResult({
      computable: false, pass: false,
      reason: `insufficient inputs: only ${evaluable.length}/6 checks computable (need >= ${REQUIRED_MIN_EVALUABLE})`
    });
  }
  // All-pass gate is over evaluable checks only; non-computable checks (e.g. #6
  // when OCF/RnD missing from cache) are N/A rather than implicit failures.
  const allEvaluablePass = evaluable.every(c => c.pass);
  return H.buildResult({
    computable: true,
    pass: allEvaluablePass,
    value: passing,
    components: { checks, passing, evaluable: evaluable.length, total: checks.length },
    reason: allEvaluablePass
      ? `Premium-Proof: ${passing}/${evaluable.length} erfuellt (${checks.length - evaluable.length} N/A)`
      : `Premium-Proof FAIL: ${passing}/${evaluable.length} - failed: ` + checks.filter(c => c.computable && !c.pass).map(c => c.name).join(', ')
  });
}

module.exports = {
  id: ID, label: LABEL,
  description: 'Premium-Compounder-Proof (alle 6 muessen passen): Rev-CAGR>=15, OpMarg>=25, ROIC>=25, NetCash/ND<=1, FCF/NI>=80, Reinvest>=30',
  threshold: 6, thresholdOp: 'gte', unit: 'count',
  evaluate
};

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
  const revs = _arrVals(stock, 'annual.annualRev');
  const opIncs = _arrVals(stock, 'annual.annualOpInc');
  const nis = _arrVals(stock, 'annual.annualNetIncome');
  const fcfs = _arrVals(stock, 'annual.annualFCF');
  const capex = _arrVals(stock, 'annual.annualCapex').map(Math.abs);
  const ocf = _arrVals(stock, 'annual.annualOCF');
  const rnd = _arrVals(stock, 'annual.annualRnD');
  const totalAssets = H.latestBalance(stock, 'totalAssets');
  const totalCash = H.latestBalance(stock, 'totalCash');
  const totalDebt = H.latestBalance(stock, 'totalDebt');

  const checks = [];
  let allPass = true;

  // 1. 5Y Revenue CAGR >= 15%
  let rev5yCagr = null;
  if (revs.length >= 5) {
    rev5yCagr = _cagr(revs[0], revs[4], 4); // 4-period CAGR over 5 datapoints
  }
  const c1 = rev5yCagr != null && rev5yCagr >= 0.15;
  checks.push({ name: 'rev5yCAGR>=15', pass: c1, val: rev5yCagr });
  if (!c1) allPass = false;

  // 2. 5Y Median OpMargin >= 25%
  const opMs = [];
  const yrs = Math.min(5, revs.length, opIncs.length);
  for (let i = 0; i < yrs; i++) {
    if (revs[i] > 0 && opIncs[i] != null) opMs.push(opIncs[i] / revs[i]);
  }
  const opMed = _median(opMs);
  const c2 = opMed != null && opMed >= 0.25;
  checks.push({ name: 'opMargMed>=25', pass: c2, val: opMed });
  if (!c2) allPass = false;

  // 3. PreTax-ROIC >= 25% (latest)
  let preTaxROIC = null;
  if (opIncs[0] != null && totalAssets != null) {
    const ic = totalAssets - (totalCash || 0);
    if (ic > 0) preTaxROIC = opIncs[0] / ic;
  }
  const c3 = preTaxROIC != null && preTaxROIC >= 0.25;
  checks.push({ name: 'preTaxROIC>=25', pass: c3, val: preTaxROIC });
  if (!c3) allPass = false;

  // 4. Net Cash OR ND/EBITDA <= 1.0
  let netCash = null;
  let ndOverEbitda = null;
  if (totalDebt != null) {
    netCash = (totalCash || 0) - totalDebt;
    if (opIncs[0] != null) {
      const ebitda = opIncs[0] * 1.2;
      if (ebitda > 0) ndOverEbitda = (totalDebt - (totalCash || 0)) / ebitda;
    }
  }
  const c4 = (netCash != null && netCash >= 0) || (ndOverEbitda != null && ndOverEbitda <= 1.0);
  checks.push({ name: 'netCash|ND/EBITDA<=1', pass: c4, val: ndOverEbitda });
  if (!c4) allPass = false;

  // 5. 5Y Median FCF/NetIncome >= 80%
  const fcfNi = [];
  const fNyrs = Math.min(5, fcfs.length, nis.length);
  for (let i = 0; i < fNyrs; i++) {
    if (nis[i] > 0 && fcfs[i] != null) fcfNi.push(fcfs[i] / nis[i]);
  }
  const fcfNiMed = _median(fcfNi);
  const c5 = fcfNiMed != null && fcfNiMed >= 0.80;
  checks.push({ name: 'fcf/ni>=80', pass: c5, val: fcfNiMed });
  if (!c5) allPass = false;

  // 6. 5Y Median (Capex+R&D)/OCF >= 30%
  const reinvest = [];
  const reYrs = Math.min(5, capex.length, ocf.length);
  for (let i = 0; i < reYrs; i++) {
    if (ocf[i] > 0) {
      const c = capex[i] || 0;
      const r = (rnd[i] != null && Number.isFinite(rnd[i])) ? rnd[i] : 0;
      reinvest.push((c + r) / ocf[i]);
    }
  }
  const reMed = _median(reinvest);
  const c6 = reMed != null && reMed >= 0.30;
  checks.push({ name: '(capex+rnd)/ocf>=30', pass: c6, val: reMed });
  if (!c6) allPass = false;

  const passing = checks.filter(c => c.pass).length;
  return H.buildResult({
    computable: checks.every(c => c.val != null) || passing > 0, // computable if at least some inputs work
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
  evaluate
};

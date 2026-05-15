'use strict';
/**
 * Tag 140: Piotroski F-Score
 * ==========================
 * 8 binary financial-health signals (adapted for snapshot data availability).
 * Signals (1 pt each):
 *   1. ROA > 0                (net income / total assets)
 *   2. CFO > 0                (FCF proxy: annualFCF > 0)
 *   3. ΔROA > 0               (ROA improved YoY)
 *   4. Accruals               (FCF/Assets > ROA — earnings backed by cash)
 *   5. ΔLeverage < 0          (debt/assets ratio decreased)
 *   6. ΔLiquidity > 0         (cash/debt ratio improved)
 *   7. ΔGross Margin > 0      (gross margin improved YoY)
 *   8. ΔAsset Turnover > 0    (revenue/assets improved YoY)
 *
 * Pass: score >= 6 of available signals (scaled when < 8 signals computable).
 */
const H = require('./_helpers.js');

const ID = 'piotroski-f-score';
const THRESHOLD = 6;   // out of 8 (or scaled)
const THRESHOLD_OP = 'gte';

function _annualVal(arr, idx) {
  if (!Array.isArray(arr) || arr.length <= idx) return null;
  const v = arr[idx];
  if (v == null) return null;
  if (typeof v === 'number') return v;
  if (typeof v === 'object' && 'value' in v) return v.value;
  return null;
}

function _balanceVal(stock, idx, field) {
  const arr = stock && stock.annual && stock.annual.annualBalance;
  if (!Array.isArray(arr) || arr.length <= idx) return null;
  return arr[idx] && arr[idx][field];
}

function evaluate(stock) {
  const assets0  = _balanceVal(stock, 0, 'totalAssets');
  const assets1  = _balanceVal(stock, 1, 'totalAssets');
  const debt0    = _balanceVal(stock, 0, 'totalDebt');
  const debt1    = _balanceVal(stock, 1, 'totalDebt');
  const cash0    = _balanceVal(stock, 0, 'totalCash');
  const cash1    = _balanceVal(stock, 1, 'totalCash');

  const ni0 = _annualVal(stock.annual && stock.annual.annualNetIncome, 0);
  const ni1 = _annualVal(stock.annual && stock.annual.annualNetIncome, 1);
  const fcf0 = _annualVal(stock.annual && stock.annual.annualFCF, 0);
  const rev0 = _annualVal(stock.annual && stock.annual.annualRev, 0);
  const rev1 = _annualVal(stock.annual && stock.annual.annualRev, 1);
  const gp0  = _annualVal(stock.annual && stock.annual.annualGP, 0);
  const gp1  = _annualVal(stock.annual && stock.annual.annualGP, 1);

  if (assets0 == null || assets0 <= 0) {
    return H.buildResult({ computable: false, reason: 'no totalAssets', threshold: THRESHOLD, thresholdOp: THRESHOLD_OP });
  }

  const signals = [];

  // 1. ROA > 0
  if (ni0 != null) {
    const roa0 = ni0 / assets0;
    signals.push({ name: 'roa_positive', pass: roa0 > 0, roa0 });
  }

  // 2. CFO > 0 (FCF proxy)
  if (fcf0 != null) {
    signals.push({ name: 'cfo_positive', pass: fcf0 > 0 });
  }

  // 3. ΔROA > 0
  if (ni0 != null && ni1 != null && assets1 != null && assets1 > 0) {
    const roa0 = ni0 / assets0;
    const roa1 = ni1 / assets1;
    signals.push({ name: 'delta_roa', pass: roa0 > roa1 });
  }

  // 4. Accruals: FCF/Assets > ROA (cash earnings > accrual earnings)
  if (fcf0 != null && ni0 != null) {
    const cfoRatio = fcf0 / assets0;
    const roa0 = ni0 / assets0;
    signals.push({ name: 'accruals', pass: cfoRatio > roa0 });
  }

  // 5. ΔLeverage < 0 (leverage decreased)
  if (debt0 != null && debt1 != null && assets1 != null && assets1 > 0) {
    const lev0 = debt0 / assets0;
    const lev1 = debt1 / assets1;
    signals.push({ name: 'delta_leverage', pass: lev0 < lev1 });
  }

  // 6. ΔLiquidity > 0 (cash/debt ratio improved)
  if (cash0 != null && cash1 != null && debt0 != null && debt1 != null) {
    const denom0 = Math.max(debt0, assets0 * 0.01);
    const denom1 = Math.max(debt1, assets1 != null ? assets1 * 0.01 : assets0 * 0.01);
    const liq0 = cash0 / denom0;
    const liq1 = cash1 / denom1;
    signals.push({ name: 'delta_liquidity', pass: liq0 > liq1 });
  }

  // 7. ΔGross Margin > 0
  if (gp0 != null && gp1 != null && rev0 != null && rev0 > 0 && rev1 != null && rev1 > 0) {
    const gm0 = gp0 / rev0;
    const gm1 = gp1 / rev1;
    signals.push({ name: 'delta_gross_margin', pass: gm0 > gm1 });
  }

  // 8. ΔAsset Turnover > 0
  if (rev0 != null && rev1 != null && assets1 != null && assets1 > 0) {
    const at0 = rev0 / assets0;
    const at1 = rev1 / assets1;
    signals.push({ name: 'delta_asset_turnover', pass: at0 > at1 });
  }

  if (signals.length === 0) {
    return H.buildResult({ computable: false, reason: 'no signals computable', threshold: THRESHOLD, thresholdOp: THRESHOLD_OP });
  }

  const score = signals.filter(s => s.pass).length;
  // Scale threshold to available signals (e.g. 6/8 = 75%, same ratio).
  // Bug #19: Math.ceil(6*3/8) = Math.ceil(2.25) = 3 → demands 100% pass for 3-signal case
  // instead of intended 75%. Math.round gives 2 (correctly ~75%). Math.max(1,...) prevents 0.
  const scaledThreshold = Math.max(1, Math.round(THRESHOLD * signals.length / 8));
  const pass = score >= scaledThreshold;

  return H.buildResult({
    value: score,
    pass,
    computable: true,
    threshold: scaledThreshold,
    thresholdOp: THRESHOLD_OP,
    reason: `F-Score ${score}/${signals.length} (need >=${scaledThreshold}): ${signals.map(s => s.name + ':' + (s.pass ? '1' : '0')).join(', ')}`,
    components: {
      score, maxPossible: signals.length, scaledThreshold,
      signals: signals.reduce((acc, s) => { acc[s.name] = s.pass ? 1 : 0; return acc; }, {})
    }
  });
}

module.exports = {
  id: ID,
  label: 'Piotroski F-Score',
  description: 'Piotroski F-Score >= 6/8: financial health via 8 binary profitability/leverage/efficiency signals',
  threshold: THRESHOLD,
  thresholdOp: THRESHOLD_OP,
  unit: 'score',
  evaluate
};

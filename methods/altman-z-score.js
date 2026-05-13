'use strict';
/**
 * Tag 140: Altman Z″-Score (non-manufacturing / non-US version)
 * =============================================================
 * Z″ = 6.56*X1 + 3.26*X2 + 6.72*X3 + 1.05*X4
 *
 * X1 = Working Capital / Total Assets  (cash proxy: (cash - short-term debt) / assets)
 * X2 = Retained Earnings / Total Assets (sum of recent net incomes / assets)
 * X3 = EBIT / Total Assets              (operating income / assets)
 * X4 = Book Value Equity / Total Debt   ((assets - debt) / max(debt, 1%*assets))
 *
 * Zones:
 *   > 2.6  → SAFE (pass)
 *   1.1–2.6 → GREY (fail — watch zone)
 *   < 1.1  → DISTRESS (fail)
 *
 * Pass threshold: Z″ >= 1.1 (not in distress zone)
 */
const H = require('./_helpers.js');

const ID = 'altman-z-score';
const THRESHOLD = 1.1;
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
  const assets = _balanceVal(stock, 0, 'totalAssets');
  const totalDebt = _balanceVal(stock, 0, 'totalDebt');
  const cash = _balanceVal(stock, 0, 'totalCash');
  const opInc = _annualVal(stock.annual && stock.annual.annualOpInc, 0);

  if (assets == null || assets <= 0) {
    return H.buildResult({ computable: false, reason: 'no totalAssets', threshold: THRESHOLD, thresholdOp: THRESHOLD_OP });
  }

  // X1: Working Capital proxy = (cash - short-term portion of debt) / assets
  // Approximate: cash represents liquid assets, short-term debt ≈ 30% of total debt
  const cashVal = cash || 0;
  const debtVal = totalDebt || 0;
  const shortTermDebtProxy = debtVal * 0.3;
  const workingCapital = cashVal - shortTermDebtProxy;
  const X1 = workingCapital / assets;

  // X2: Retained Earnings proxy = sum of last 3 years net income / assets
  const niArr = stock.annual && stock.annual.annualNetIncome;
  const ni0 = _annualVal(niArr, 0) || 0;
  const ni1 = _annualVal(niArr, 1) || 0;
  const ni2 = _annualVal(niArr, 2) || 0;
  const retainedEarningsProxy = ni0 + ni1 + ni2;
  const X2 = retainedEarningsProxy / assets;

  // X3: EBIT / Total Assets
  if (opInc == null) {
    return H.buildResult({ computable: false, reason: 'no annualOpInc', threshold: THRESHOLD, thresholdOp: THRESHOLD_OP });
  }
  const X3 = opInc / assets;

  // X4: Book Value of Equity / Total Debt
  const bookEquity = assets - debtVal;
  const X4 = bookEquity / Math.max(debtVal, assets * 0.01);

  const zScore = 6.56 * X1 + 3.26 * X2 + 6.72 * X3 + 1.05 * X4;
  const zone = zScore >= 2.6 ? 'SAFE' : zScore >= 1.1 ? 'GREY' : 'DISTRESS';
  const pass = zScore >= THRESHOLD;

  return H.buildResult({
    value: Math.round(zScore * 100) / 100,
    pass,
    computable: true,
    threshold: THRESHOLD,
    thresholdOp: THRESHOLD_OP,
    reason: `Z″=${zScore.toFixed(2)} (${zone}): X1=${X1.toFixed(2)}, X2=${X2.toFixed(2)}, X3=${X3.toFixed(2)}, X4=${X4.toFixed(2)}`,
    components: { zScore, zone, X1, X2, X3, X4, assets, debtVal, cashVal }
  });
}

module.exports = {
  id: ID,
  label: 'Altman Z″-Score',
  description: 'Altman Z″-Score >= 1.1 (not in distress zone): financial solvency via 4-factor model',
  threshold: THRESHOLD,
  thresholdOp: THRESHOLD_OP,
  unit: 'score',
  evaluate
};

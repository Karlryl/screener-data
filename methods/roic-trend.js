'use strict';
/**
 * Tag 200: ROIC-Trend (Year-over-Year Improvement)
 * ==================================================
 * Quality-Compounder signal: ROIC improving year-over-year.
 * Computes ROIC for each of the last 3 fiscal years and reports the
 * year-over-year direction.
 *
 *   roic(y) = annualNetIncome[y] / investedCapital(y)
 *   where investedCapital = totalAssets - totalCash - totalDebt
 *
 *   value    = (roic[0] - roic[1]) * 100    (pp change in latest year)
 *   pass     = value > 0                    (ROIC improved)
 *
 * Distinct from the existing roic.js (which reports current-period ROIC):
 *   - roic.js answers "is current ROIC high enough?"
 *   - roic-trend.js answers "is ROIC moving in the right direction?"
 *
 * Why year-over-year delta and not 3-year trend (like
 * gross-margin-acceleration):
 *   - ROIC requires balance-sheet data; many companies have only 2-3y of
 *     balance data in snapshots — 3y consecutive is too strict.
 *   - The most-recent delta is the leading-indicator signal a QC pick
 *     should satisfy. A long flat ROIC is a "no signal" — exposed via
 *     small delta value.
 *
 * Edge cases:
 *   - investedCapital ≤ 0 (cash > debt + low assets) → incomputable
 *   - missing balance sheet → incomputable
 *
 * Pattern-based, no hardcoded tickers.
 */
const H = require('./_helpers.js');

const ID = 'roic-trend';
const LABEL = 'ROIC-Trend (YoY Δ)';
const THRESHOLD = 0;
const THRESHOLD_OP = 'gt';

function _unwrap(v) {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'object' && Number.isFinite(v.value)) return v.value;
  return null;
}

function _roicAtYear(stock, yearIdx) {
  const niArr = (stock.annual && stock.annual.annualNetIncome) || [];
  const balArr = (stock.annual && stock.annual.annualBalance) || [];
  if (niArr.length <= yearIdx || balArr.length <= yearIdx) return null;
  const ni = _unwrap(niArr[yearIdx]);
  const bal = balArr[yearIdx];
  if (ni == null || !bal) return null;
  // annualBalance entries are objects {totalCash, totalDebt, totalAssets},
  // not envelopes — read directly. Be defensive about missing fields.
  const ta = Number.isFinite(bal.totalAssets) ? bal.totalAssets : null;
  const tc = Number.isFinite(bal.totalCash) ? bal.totalCash : 0;
  const td = Number.isFinite(bal.totalDebt) ? bal.totalDebt : 0;
  if (ta == null) return null;
  const invested = ta - tc - td;
  if (invested <= 0) return null;
  return ni / invested;
}

function evaluate(stock) {
  if (!stock) {
    return H.buildResult({
      computable: false, pass: false, reason: 'no stock data',
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }
  const roic0 = _roicAtYear(stock, 0);
  const roic1 = _roicAtYear(stock, 1);
  if (roic0 == null || roic1 == null) {
    return H.buildResult({
      computable: false,
      reason: 'roic[0]=' + roic0 + ' roic[1]=' + roic1 + ' (need both years)',
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }
  const deltaPp = (roic0 - roic1) * 100;
  // Also compute roic[2] if available — surface 2y trajectory for context.
  const roic2 = _roicAtYear(stock, 2);
  const delta2Pp = roic2 != null ? (roic1 - roic2) * 100 : null;
  const trend2y = delta2Pp != null
    ? (deltaPp > 0 && delta2Pp > 0 ? 'accelerating'
        : deltaPp < 0 && delta2Pp < 0 ? 'decelerating'
        : 'mixed')
    : 'partial';

  return H.buildResult({
    value: deltaPp,
    pass: deltaPp > THRESHOLD,
    computable: true,
    components: {
      roic0: Math.round(roic0 * 10000) / 10000,
      roic1: Math.round(roic1 * 10000) / 10000,
      roic2: roic2 != null ? Math.round(roic2 * 10000) / 10000 : null,
      delta2Pp,
      trend2y
    },
    reason: 'ROIC Y-1=' + (roic1*100).toFixed(1) + '% → Y0=' + (roic0*100).toFixed(1) +
            '% Δ=' + (deltaPp >= 0 ? '+' : '') + deltaPp.toFixed(1) + 'pp (' + trend2y + ')',
    threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
  });
}

module.exports = {
  id: ID, label: LABEL,
  description: 'ROIC verbessert sich Y0 vs Y-1 — Quality-Compounder-Trajektorie',
  threshold: THRESHOLD, thresholdOp: THRESHOLD_OP, unit: 'pp',
  evaluate
};

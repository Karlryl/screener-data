'use strict';
/**
 * Tag 199f: Metric-Divergence DataGuard
 * ======================================
 * Hard-fails when Yahoo's TTM-derived metrics diverge wildly from
 * annual-derived ratios, indicating either:
 *   - Massive one-time impairments hitting TTM but not annual op income
 *     (MSTR pattern — bitcoin write-downs distort metrics.operatingMargin
 *     to -11,641% while annualOpInc/annualRev shows -8.6%)
 *   - Yahoo schema drift or unit mismatch (wrong denominator)
 *   - Restated financials where TTM and annual no longer reconcile
 *
 *   annualMargin = annualOpInc[0] / annualRev[0] * 100  (pp)
 *   ttmMargin    = metrics.operatingMargin              (pp)
 *
 *   divergence = |ttmMargin - annualMargin|
 *
 *   pass = divergence <= 1000pp     (10x is generous; normal TTM/annual
 *                                    drift is < 50pp)
 *
 * Why 1000pp not tighter:
 *   - TTM lags annual by up to 9 months → small mismatches are normal
 *   - Recent margin acceleration / deceleration: ~50-100pp possible
 *   - 1000pp = the metric is broken, not the company
 *
 * Pattern-based: no hardcoded tickers. Catches MSTR today, will catch
 * any future ticker with similar data anomalies.
 *
 * Audit-trace examples:
 *   NVDA  ttm=65.0  annual=60.4  div=4.6   pass
 *   MSFT  ttm=46.3  annual=46.3  div=0.0   pass
 *   ASML  ttm=36.0  annual=33.7  div=2.3   pass
 *   PLTR  ttm=46.2  annual=31.6  div=14.6  pass (recent margin expansion)
 *   MSTR  ttm=-11641.5  annual=-8.6  div=11633  FAIL
 */
const H = require('./_helpers.js');

const ID = 'metric-divergence-guard';
const LABEL = 'Metric-Divergence-Guard';
const THRESHOLD = 1000;
const THRESHOLD_OP = 'lte';

function _unwrap(v) {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'object' && Number.isFinite(v.value)) return v.value;
  return null;
}

function evaluate(stock) {
  if (!stock) {
    return H.buildResult({
      computable: false, pass: false, reason: 'no stock data',
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }
  const ttmMargin = H.metricValue(stock, 'operatingMargin');
  const revArr = (stock.annual && stock.annual.annualRev) || [];
  const oiArr = (stock.annual && stock.annual.annualOpInc) || [];
  const rev0 = _unwrap(revArr[0]);
  const oi0 = _unwrap(oiArr[0]);

  if (ttmMargin == null || rev0 == null || oi0 == null || rev0 <= 0) {
    return H.buildResult({
      computable: false,
      reason: 'inputs: ttmMargin=' + ttmMargin + ' rev0=' + rev0 + ' oi0=' + oi0,
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }

  const annualMargin = oi0 / rev0 * 100;
  const divergence = Math.abs(ttmMargin - annualMargin);
  const pass = divergence <= THRESHOLD;

  return H.buildResult({
    value: divergence,
    pass,
    computable: true,
    components: {
      ttmMargin: Math.round(ttmMargin * 100) / 100,
      annualMargin: Math.round(annualMargin * 100) / 100,
      divergencePp: Math.round(divergence * 100) / 100
    },
    reason: 'ttm=' + ttmMargin.toFixed(1) + ' annual=' + annualMargin.toFixed(1) +
            ' div=' + divergence.toFixed(0) + 'pp (gate: ≤ ' + THRESHOLD + 'pp)',
    threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
  });
}

module.exports = {
  id: ID, label: LABEL,
  description: 'Yahoo TTM vs annual op-margin Divergenz <= 1000pp — catches Impairment-Storm-Pattern (MSTR)',
  threshold: THRESHOLD, thresholdOp: THRESHOLD_OP, unit: 'pp',
  evaluate
};

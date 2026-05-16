'use strict';
/**
 * Tag 200b: Net-Income-Volatility DataGuard
 * ==========================================
 * Hard-fails when single-year annualNetIncome change exceeds annual
 * revenue. Catches non-operating noise — impairments, write-downs,
 * asset-sale gains/losses, restructuring charges — where the volatility
 * lives in NI but not in operating-income-vs-revenue.
 *
 *   for i in 0..len-2:  delta[i] = |NI[i] - NI[i+1]|
 *   value = max(delta) / annualRev[0]
 *   pass  = value < 1.0       (NI swing < 100% of one-year revenue)
 *
 * Why threshold 1.0 (not 0.5):
 *   Tested against anchors:
 *     MSFT 0.06, AMZN 0.05, TSLA 0.08, META 0.12, LLY 0.15
 *     NVDA 0.22, JNJ 0.22 (pharma settlements), PLTR 0.26 (recent flip)
 *   Tested against quarantine candidates:
 *     SOUN 2.00, MARA 2.04, MSTR 6.42
 *   1.0 sits cleanly between the two clusters. 0.5 risks
 *   excluding JNJ-style pharma compounders with periodic large
 *   one-time charges.
 *
 * Complementary to metric-divergence-guard:
 *   - metric-divergence catches when Yahoo's TTM op margin diverges
 *     from annual-derived → "Yahoo reporting anomaly"
 *   - ni-volatility catches when NI itself is unstable across years
 *     → "structural non-operating earnings"
 *   - MSTR fires BOTH (defense in depth).
 *   - A future bitcoin-treasury company with positive recent year
 *     would pass metric-divergence but fail ni-volatility.
 *
 * Pattern-based: no hardcoded tickers. Yahoo schema is stable
 * (annualNetIncome + annualRev are first-class).
 *
 * Requires ≥ 2 net-income points + positive annualRev[0].
 */
const H = require('./_helpers.js');

const ID = 'net-income-volatility-guard';
const LABEL = 'NI-Volatility-Guard';
const THRESHOLD = 1.0;
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
  const niArr = (stock.annual && stock.annual.annualNetIncome) || [];
  const revArr = (stock.annual && stock.annual.annualRev) || [];
  if (niArr.length < 2) {
    return H.buildResult({
      computable: false,
      reason: 'need ≥ 2 annualNetIncome points (got ' + niArr.length + ')',
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }
  const rev0 = _unwrap(revArr[0]);
  if (rev0 == null || rev0 <= 0) {
    return H.buildResult({
      computable: false,
      reason: 'rev0=' + rev0 + ' (need positive revenue for ratio denominator)',
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }

  const nis = [];
  for (const e of niArr) {
    const v = _unwrap(e);
    if (v != null) nis.push(v);
    else break;  // stop at first null to preserve year alignment
  }
  if (nis.length < 2) {
    return H.buildResult({
      computable: false,
      reason: 'fewer than 2 clean NI points after null-cut',
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }

  let maxDelta = 0;
  let maxIdx = 0;
  for (let i = 0; i < nis.length - 1; i++) {
    const d = Math.abs(nis[i] - nis[i+1]);
    if (d > maxDelta) { maxDelta = d; maxIdx = i; }
  }

  const ratio = maxDelta / rev0;
  const pass = ratio < THRESHOLD;

  return H.buildResult({
    value: ratio,
    pass,
    computable: true,
    components: {
      nis: nis.map(v => Math.round(v / 1e6)),  // M
      maxDeltaM: Math.round(maxDelta / 1e6),
      maxDeltaPairIdx: maxIdx,
      rev0M: Math.round(rev0 / 1e6)
    },
    reason: 'max single-year NI swing = ' + (maxDelta/1e9).toFixed(2) + 'B / rev ' +
            (rev0/1e9).toFixed(2) + 'B = ' + ratio.toFixed(2) +
            ' (gate ≤ ' + THRESHOLD + ')',
    threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
  });
}

module.exports = {
  id: ID, label: LABEL,
  description: 'Net-Income-Volatilität (max YoY-Δ / Revenue) < 1.0 — fängt MSTR-style Impairment-Pattern',
  threshold: THRESHOLD, thresholdOp: THRESHOLD_OP, unit: 'ratio',
  evaluate
};

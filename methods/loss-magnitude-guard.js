'use strict';
/**
 * Tag 199: Loss-Magnitude DataGuard
 * ===================================
 * Hard-fails companies whose annual operating loss exceeds 50% of annual
 * revenue. Catches the SOUN/IONQ pattern: micro-revenue narrative stocks
 * burning more cash than they earn, with mcap untethered from
 * commercial reality.
 *
 *   pass = annualOpInc[0] / annualRev[0] >= -0.50
 *
 * Audit-trace examples (Tag 199 anchors / quarantine):
 *   - PLTR: +0.32 → pass (op profit 32% of rev)
 *   - NVDA: +0.60 → pass
 *   - ALAB: +0.20 → pass
 *   - CRDO: +0.087 → pass
 *   - PLTR-pre-2024: ~-0.10 → would have passed (recovering)
 *   - SOUN: -1.10 → FAIL (op loss = 110% of rev)
 *   - IONQ: -4.87 → FAIL (op loss = 487% of rev)
 *
 * Why -0.50 and not -1.00:
 *   -1.00 would only catch already-uneconomic companies (loss > revenue).
 *   -0.50 catches "structurally pre-revenue" — losses still 50%+ of TTM
 *   rev, indicating the company's revenue base hasn't reached operating
 *   leverage yet. Healthy SaaS turnarounds (SHOP/SNOW pre-profit) had
 *   op margins around -10..-20%, well above this gate.
 *
 * Pattern-based: no hardcoded tickers. Yahoo schema is stable here
 * (annualRev + annualOpInc are first-class fields).
 */
const H = require('./_helpers.js');

const ID = 'loss-magnitude-guard';
const LABEL = 'Loss-Magnitude-Guard';
const THRESHOLD = -0.50;
const THRESHOLD_OP = 'gte';

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
  const revArr = (stock.annual && stock.annual.annualRev) || [];
  const oiArr = (stock.annual && stock.annual.annualOpInc) || [];
  const rev0 = _unwrap(revArr[0]);
  const oi0 = _unwrap(oiArr[0]);

  if (rev0 == null || oi0 == null) {
    return H.buildResult({
      computable: false,
      reason: 'missing rev0=' + rev0 + ' oi0=' + oi0,
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }
  if (rev0 <= 0) {
    // Zero/negative revenue — no commerciality at all. Hard fail.
    return H.buildResult({
      value: -Infinity, pass: false, computable: true,
      components: { rev0, oi0, ratio: null },
      reason: 'rev0=' + rev0 + ' (no positive revenue)',
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }

  const ratio = oi0 / rev0;
  const pass = ratio >= THRESHOLD;
  return H.buildResult({
    value: ratio,
    pass,
    computable: true,
    components: { rev0, oi0, ratio },
    reason: 'OpInc/Rev = ' + (oi0/1e6).toFixed(0) + 'M / ' + (rev0/1e6).toFixed(0) + 'M = ' +
            (ratio*100).toFixed(0) + '% (gate: ≥ ' + (THRESHOLD*100).toFixed(0) + '%)',
    threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
  });
}

module.exports = {
  id: ID, label: LABEL,
  description: 'Hard-DataGuard: Operating-Loss darf nicht >50% des Umsatzes sein (Pre-Revenue / Hype-Pattern)',
  threshold: THRESHOLD, thresholdOp: THRESHOLD_OP, unit: 'ratio',
  evaluate
};

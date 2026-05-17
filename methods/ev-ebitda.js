'use strict';
const H = require('./_helpers.js');

const ID = 'ev-ebitda';
const LABEL = 'EV/EBITDA';
const THRESHOLD = 20;
const THRESHOLD_OP = 'lte';

function _unwrapMetric(m) {
  if (m == null) return null;
  if (typeof m === 'number') return Number.isFinite(m) ? m : null;
  if (typeof m === 'object' && Number.isFinite(m.value)) return m.value;
  return null;
}

function evaluate(stock) {
  // Tag 219 (audit F2/F3): prefer Yahoo's native enterpriseToEbitda when
  // available. Yahoo's pre-computed ratio is more accurate than our manual
  // reconstruction (Yahoo includes minority-interest + preferred in EV,
  // and uses real EBITDA rather than opInc*1.2 heuristic). The heuristic
  // systematically biased capital-intensive firms (D&A high → underestimated
  // EBITDA → EV/EBITDA too high → false fails) and SaaS (opposite).
  // Fall back to manual computation only when Yahoo doesn't carry the field
  // (e.g. some international ADRs, recent IPOs).
  const m = stock && stock.metrics;
  const yahooRatio = _unwrapMetric(m && m.enterpriseToEbitda);
  if (yahooRatio != null && yahooRatio > 0) {
    return H.buildResult({
      value: yahooRatio,
      pass: yahooRatio <= THRESHOLD,
      computable: true,
      components: {
        source: 'yahoo.enterpriseToEbitda',
        enterpriseValue: _unwrapMetric(m && m.enterpriseValue),
        ebitda: _unwrapMetric(m && m.ebitda)
      },
      reason: 'EV/EBITDA=' + yahooRatio.toFixed(1) + ' (Yahoo native, EV=' +
        ((_unwrapMetric(m && m.enterpriseValue) || 0) / 1e9).toFixed(1) + 'B, EBITDA=' +
        ((_unwrapMetric(m && m.ebitda) || 0) / 1e9).toFixed(1) + 'B)',
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }

  // Fallback: manual reconstruction with opInc*1.2 heuristic.
  const mcap = stock && stock.marketCap && (typeof stock.marketCap === 'number' ? stock.marketCap : stock.marketCap.value);
  const totalDebt = H.latestBalance(stock, 'totalDebt');
  const totalCash = H.latestBalance(stock, 'totalCash');
  const opInc = H.latestAnnual(stock, 'annualOpInc');
  if (mcap == null || opInc == null || totalDebt == null) {
    return H.buildResult({
      computable: false,
      reason: `missing inputs: mcap=${mcap} opInc=${opInc} debt=${totalDebt}`,
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }
  const ev = mcap + totalDebt - (totalCash || 0);
  // Bug #11: negative EV (net-cash company: cash > mcap+debt) trivially passes any positive threshold.
  // EV/EBITDA is not meaningful when EV <= 0; mark as non-computable to avoid false pass.
  if (ev <= 0) {
    return H.buildResult({
      computable: false,
      reason: `EV <= 0 (mcap=${(mcap/1e9).toFixed(1)}B + debt=${(totalDebt/1e9).toFixed(1)}B - cash=${((totalCash||0)/1e9).toFixed(1)}B = ${(ev/1e9).toFixed(1)}B): net-cash company, EV/EBITDA not meaningful`,
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }
  const ebitda = opInc * 1.2;
  if (ebitda <= 0) {
    return H.buildResult({
      computable: false, reason: 'EBITDA ≤ 0', threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }
  const value = ev / ebitda;
  return H.buildResult({
    value,
    pass: value <= THRESHOLD,
    computable: true,
    components: { source: 'reconstructed', mcap, totalDebt, totalCash: totalCash || 0, ev, ebitda, opInc },
    reason: `EV=${(ev/1e9).toFixed(1)}B / EBITDA=${(ebitda/1e9).toFixed(1)}B = ${value.toFixed(1)} (manual, opInc*1.2 heuristic)`,
    threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
  });
}

module.exports = {
  id: ID, label: LABEL,
  description: 'EV / EBITDA-Approx ≤ 20 (klassische Bewertung)',
  threshold: THRESHOLD, thresholdOp: THRESHOLD_OP, unit: 'composite',
  evaluate
};

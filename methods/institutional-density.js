'use strict';
/**
 * Tag 223a — Institutional Density (Yahoo Broad Holders, Soft Signal)
 * ====================================================================
 * Yahoo's majorHoldersBreakdown.institutionsPercentHeld reflects the
 * aggregate fraction of float held by ALL Form-13F filers (~7,000
 * institutions, broad-based). This is the "broad-density" complement
 * to Tag 213a institutional-ownership-13f.js, which counts a curated
 * smart-money CIK list (~40 institutions, concentration-focused).
 *
 * Why both? The two signals capture different things:
 *   - Tag 213a (13F by-ticker): "Does Berkshire/Pershing-Square/Akre
 *     hold the name?" — concentrated smart-money conviction signal.
 *   - Tag 223a (this): "Is the float >= 50% institutionally owned at
 *     all?" — basic respectability filter that rules out pump-and-dump
 *     retail-only micro-caps, regardless of WHICH institutions are in.
 *
 * Formula:
 *   composite = institutionsPercentHeld * 100  (just rescaled to %)
 *
 * Pass threshold: institutionsPercentHeld >= 0.50 (>=50% of float
 *   institutionally owned). At this threshold the price discovery is
 *   substantially driven by the institutional cohort.
 *
 * Data sources:
 *   - meta.institutionsPercentHeld (required, finite, > 0)
 *   - meta.institutionsCount (optional context)
 *   - meta.insidersPercentHeld (optional context — captures the
 *     "insider + institutional = whole concentrated-ownership picture"
 *     view; some controlled subsidiaries show low institutional% solely
 *     because insiders own most of it)
 *
 * Not computable:
 *   - meta.institutionsPercentHeld null (Yahoo didn't return data)
 *   - meta.institutionsPercentHeld == 0 (treated as no-data per spec;
 *     a clean 0% reading is implausible for any liquid mid/large-cap
 *     and almost always means Yahoo had no breakdown to give)
 *
 * Activated by Tag 220c (majorHoldersBreakdown extraction in pull-yahoo).
 * Pre-Run-#109 snapshots return computable=false universally — fixture-
 * hash safe by construction (not in SCORE_WEIGHTS).
 *
 * DIAGNOSTIC + defaultActive:true.
 *
 * References:
 *   Cohen, R. B., Polk, C., & Silli, B. (2010). "Best Ideas." SSRN
 *     working paper — high-conviction institutional positions outperform.
 *   Chen, H.-L., Jegadeesh, N., & Wermers, R. (2000). "The Value of
 *     Active Mutual Fund Management: An Examination of the Stockholdings
 *     and Trades of Fund Managers." Journal of Financial and Quantitative
 *     Analysis 35(3):343-368 — institutional holdings are informative.
 */
const H = require('./_helpers.js');

const ID = 'institutional-density';
const LABEL = 'Institutional Density';
const THRESHOLD = 0.50;
const THRESHOLD_OP = 'gte';

function _meta(stock, field) {
  if (!stock || !stock.meta) return null;
  const v = stock.meta[field];
  return Number.isFinite(v) ? v : null;
}

function evaluate(stock) {
  const pct = _meta(stock, 'institutionsPercentHeld');
  const count = _meta(stock, 'institutionsCount');
  const insiders = _meta(stock, 'insidersPercentHeld');

  if (pct == null || pct === 0) {
    return H.buildResult({
      computable: false, pass: false,
      reason: 'no meta.institutionsPercentHeld in snapshot (Yahoo majorHoldersBreakdown absent; needs Tag 220c puller)',
      components: {
        institutionsPercentHeld: pct,
        institutionsCount: count,
        insidersPercentHeld: insiders
      },
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
    });
  }

  const pass = pct >= THRESHOLD;
  return H.buildResult({
    value: Math.round(pct * 10000) / 10000,
    pass,
    computable: true,
    components: {
      institutionsPercentHeld: pct,
      institutionsCount: count,
      insidersPercentHeld: insiders
    },
    reason: 'institutions hold ' + (pct * 100).toFixed(1) + '% of float' +
            (count != null ? ' across ' + count + ' filers' : '') +
            (insiders != null ? ', insiders ' + (insiders * 100).toFixed(1) + '%' : '') +
            ' (floor ' + (THRESHOLD * 100) + '%)',
    threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
  });
}

module.exports = {
  id: ID, label: LABEL,
  description: 'Institutional Density >= 50%: meta.institutionsPercentHeld floor (broad-based, ~7k filers; complements Tag 213a smart-money 13F)',
  threshold: THRESHOLD, thresholdOp: THRESHOLD_OP, unit: 'ratio',
  evaluate
};

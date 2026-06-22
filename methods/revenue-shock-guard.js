'use strict';
/**
 * Tag 98h + 102d + 102e: Revenue-Shock-Guard v2 (DATAGUARD)
 * Tag 102d: timeseries.revenueQ statt quarterly.revenue
 * Tag 102e: Q-Schwelle 6→4 (Yahoo liefert oft nur 5Q, sonst Stage-2-Fallback)
 */
const H = require('./_helpers.js');

const ID = 'revenue-shock-guard';
const LABEL = 'Revenue Shock Guard';
// Tag 171: Raised from 4.0 → 4.5 to eliminate false positives on genuine AI-cycle hypergrowth
// (NVDA was scoring z=4.14 — barely above threshold — while showing consistent sequential acceleration).
// A true revenue shock (accounting fraud, one-time event) typically has z >> 5.
const THRESHOLD = 4.5;
const THRESHOLD_OP = 'lte';

// audit F-A-2026-06-22: prevents tier-dependent shock detection when prior-period MAD is zero.
// When prior revenues are identical (MAD==0, common for flat histories), the robust z-score is
// undefined. Previously the annual branch hard-coded a magic `99` sentinel for ratio>5 (so 5.01x
// and 50x scored identically, no graduation) while the quarterly branch silently used z=0 (never
// shocked), so the two code paths treated the same degenerate condition inconsistently. Both branches
// now share this single relative-jump fallback: SHOCK_RATIO_WHEN_NO_DISPERSION is the latest/median
// ratio above which a zero-dispersion jump is treated as a shock, and _zeroDispersionZ() maps the
// ratio onto a graduated pseudo-z (still gated by the materiality floor downstream), so larger jumps
// yield larger |z| instead of a flat sentinel.
const SHOCK_RATIO_WHEN_NO_DISPERSION = 5;
function _zeroDispersionZ(latest, med) {
  // Only meaningful for a positive prior level and a positive jump.
  if (!(med > 0) || !(latest > med)) return 0;
  const ratio = latest / med;
  if (ratio <= SHOCK_RATIO_WHEN_NO_DISPERSION) return 0;
  // Graduated pseudo-z just above THRESHOLD at the ratio cutoff, growing with the jump so a
  // 5.01x and a 50x jump are no longer identical. Replaces the flat `99` sentinel.
  return THRESHOLD + (ratio - SHOCK_RATIO_WHEN_NO_DISPERSION);
}

function _median(arr) {
  const s = arr.slice().sort((a,b)=>a-b);
  const n = s.length;
  return n===0?null:(n%2===0?(s[n/2-1]+s[n/2])/2:s[(n-1)/2]);
}
function _mad(arr, med) { return _median(arr.map(x => Math.abs(x - med))); }

function _arr(stock, path) {
  const a = H.val(stock, path);
  if (!Array.isArray(a) || a.length === 0) return null;
  return a.map(v => (v == null ? null : (typeof v === 'number' ? v : v.value)))
          .filter(v => Number.isFinite(v));
}

function _materialityFloor(stock) {
  const ttmRev = _arr(stock, 'annual.annualRev');
  const ttm = (ttmRev && ttmRev[0]) || 0;
  const mcapField = H.val(stock, 'marketCap');
  const mcap = (typeof mcapField === 'number') ? mcapField : (mcapField && mcapField.value) || 0;
  return Math.max(10000000, 0.08*ttm, 0.0025*mcap);
}

// F-ME-025 (Tag 184): raw extractor — preserve positional alignment so window[0]
// is the latest calendar quarter, not "latest non-null". Filter-then-index could
// re-anchor "latest Q" to Q-1 when current Q is null between earnings releases.
function _rawArr(stock, path) {
  const a = H.val(stock, path);
  if (!Array.isArray(a) || a.length === 0) return null;
  return a.map(v => (v == null ? null : (typeof v === 'number' ? v : v.value)));
}

function evaluate(stock) {
  let qrev = _rawArr(stock, 'timeseries.revenueQ');
  if (!qrev) qrev = _rawArr(stock, 'quarterly.revenue') || _rawArr(stock, 'quarterly.totalRevenue');
  const floor = _materialityFloor(stock);

  if (qrev && qrev.length >= 4) {
    // F-ME-025: require position 0 to be finite (latest calendar quarter present).
    // If latest is null, the snapshot is mid-quarter or has a Yahoo gap — fall through
    // to the annual fallback rather than misreading Q-1 as Q0.
    if (!Number.isFinite(qrev[0])) {
      // fall through to annual block
    } else {
    const latest = qrev[0];  // finite — confirmed by guard above
    // F-ME-005: collect CONSECUTIVE prior quarters (no gap mixing).
    // filter() reindexes across null gaps, mixing non-peer quarters into the
    // prior window and inflating MAD, causing real shocks to slip past.
    const prior = [];
    for (let i = 1; i < qrev.length && prior.length < 7; i++) {
      if (!Number.isFinite(qrev[i])) break;
      prior.push(qrev[i]);
    }
    if (latest <= 0) return H.buildResult({ value: 0, pass: true, computable: true, reason: 'Q0<=0', threshold: THRESHOLD, thresholdOp: THRESHOLD_OP });
    const med = _median(prior);
    const mad = _mad(prior, med);
    // audit F-A-2026-06-22: prevents tier-dependent shock detection when prior-period MAD is zero
    // — share the same relative-jump fallback the annual branch uses instead of silently using z=0.
    const z = (mad > 0) ? (latest - med) / (1.4826 * mad) : _zeroDispersionZ(latest, med);
    const absZ = Math.abs(z);
    const jump = latest - med;
    const shock = absZ > THRESHOLD && jump > floor;
    return H.buildResult({
      value: absZ, pass: !shock, computable: true,
      components: { source: 'quarterly', latest, priorMedian: med, mad, zscore: z, absoluteJump: jump, materialityFloor: floor, shock },
      reason: 'Q0=' + latest.toFixed(0) + ' vs Q-med=' + med.toFixed(0) + ', |z|=' + absZ.toFixed(2),
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP, flags: shock ? ['REVENUE_SHOCK_QUARTERLY'] : []
    });
    }  // close else
  }

  const arev = _arr(stock, 'annual.annualRev');
  if (arev && arev.length >= 3) {
    const y0 = arev[0];
    const prior = arev.slice(1, 4);
    if (y0 <= 0) return H.buildResult({ value: 0, pass: true, computable: true, reason: 'Y0<=0', threshold: THRESHOLD, thresholdOp: THRESHOLD_OP });
    const med = _median(prior);
    const mad = _mad(prior, med);
    // audit F-A-2026-06-22: prevents tier-dependent shock detection when prior-period MAD is zero
    // — replace the magic `99` sentinel with the shared graduated relative-jump fallback so a 5.01x
    // and a 50x jump no longer score identically and the annual/quarterly paths stay consistent.
    const z = (mad > 0) ? (y0 - med) / (1.4826 * mad) : _zeroDispersionZ(y0, med);
    const absZ = Math.abs(z);
    const jump = y0 - med;
    const shock = absZ > THRESHOLD && jump > floor;
    return H.buildResult({
      value: absZ, pass: !shock, computable: true,
      components: { source: 'annual', latest: y0, priorMedian: med, mad, zscore: z, absoluteJump: jump, materialityFloor: floor, shock },
      reason: 'Y0=' + y0.toFixed(0) + ' vs Y-med=' + med.toFixed(0) + ', |z|=' + absZ.toFixed(2),
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP, flags: shock ? ['REVENUE_SHOCK_ANNUAL'] : []
    });
  }

  const yoyG = H.metricValue(stock, 'revenueGrowthYoY');
  if (yoyG != null && yoyG > 500) {
    return H.buildResult({
      value: 99, pass: false, computable: true,
      components: { source: 'metrics_yoy', revenueGrowthYoY: yoyG, materialityFloor: floor, shock: true },
      reason: 'YoY=' + yoyG.toFixed(0) + '% > 500%',
      threshold: THRESHOLD, thresholdOp: THRESHOLD_OP, flags: ['REVENUE_SHOCK_YOY']
    });
  }

  return H.buildResult({
    computable: false,
    reason: 'no quarterly/annual revenue data',
    threshold: THRESHOLD, thresholdOp: THRESHOLD_OP
  });
}

module.exports = { id: ID, label: LABEL, description: 'Robust outlier detection with skalenadaptive materiality', threshold: THRESHOLD, thresholdOp: THRESHOLD_OP, unit: 'z-score', evaluate };

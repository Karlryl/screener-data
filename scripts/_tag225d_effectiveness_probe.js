'use strict';
/**
 * Tag 225d effectiveness probe (one-shot analysis, NOT a permanent script).
 * Random-samples ~500 snapshots + always-includes the 10 anchor tickers,
 * runs the 13 new/promoted methods on each, reports coverage / pass-rate /
 * quintiles / anchor coverage. Writes JSON+MD to outputs/.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SNAP_DIR = path.join(ROOT, 'snapshots');
const OUT_DIR = path.join(ROOT, 'outputs');

const METHOD_IDS = [
  'earnings-power-stability',
  'fcf-conversion-stability',
  'operating-leverage-margin-accel',
  'revenue-quality-cov',
  'institutional-ownership-13f',
  'price-momentum-12-1',
  'sga-revenue-trend',
  'capex-vs-sbc-quality',
  'working-capital-trend',
  'analyst-upside',
  'earnings-surprise-momentum',
  'institutional-density',
  'ohlson-o-score'
];

const ANCHORS = ['NVDA', 'MSFT', 'PLTR', 'CRDO', 'MELI', 'AVGO', 'ASML', 'V', 'MA', 'COST'];

const SAMPLE_TARGET = 500;
// audit F-A-2026-06-21: only iterate methods that actually loaded, so a skipped
// (renamed/missing) method file can't crash downstream loops with undefined.evaluate.
const LOADED_METHOD_IDS = [];

const methods = {};
for (const id of METHOD_IDS) {
  const fileGuess = path.join(ROOT, 'methods', id + '.js');
  // audit F-A-2026-06-21: skip-and-warn instead of process.exit(1) so a renamed/
  // removed method file doesn't hard-abort the whole probe (dead-code / robustness).
  if (!fs.existsSync(fileGuess)) { console.error('missing method file (skipping):', id); continue; }
  methods[id] = require(fileGuess);
  LOADED_METHOD_IDS.push(id);
}

// Build the universe — random sample + always-anchor tickers.
const allFiles = fs.readdirSync(SNAP_DIR).filter(f => f.endsWith('.json'));
const total = allFiles.length;
// Deterministic LCG so repeated runs sample identically
let _seed = 20260517;
function rand() { _seed = (_seed * 1103515245 + 12345) | 0; return ((_seed >>> 0) % 1e9) / 1e9; }

// audit F-A-2026-06-21: replace Bernoulli (rand() < rate) sampling — whose
// realized size was binomial(total, 500/total) and drifted off the 500 target —
// with a deterministic Fisher–Yates shuffle that pins the non-anchor sample to
// exactly (SAMPLE_TARGET - anchorsPresent). Removes the silent sample-size bias.
const sampleSet = new Set();
const anchorFiles = ANCHORS.map(a => a + '.json').filter(fn => allFiles.includes(fn));
for (const fn of anchorFiles) sampleSet.add(fn);

const nonAnchorPool = allFiles.filter(fn => !sampleSet.has(fn));
for (let i = nonAnchorPool.length - 1; i > 0; i--) {
  const j = Math.floor(rand() * (i + 1));
  const tmp = nonAnchorPool[i]; nonAnchorPool[i] = nonAnchorPool[j]; nonAnchorPool[j] = tmp;
}
const nonAnchorTake = Math.max(0, Math.min(nonAnchorPool.length, SAMPLE_TARGET - sampleSet.size));
for (let i = 0; i < nonAnchorTake; i++) sampleSet.add(nonAnchorPool[i]);

console.error('universe total=' + total + '  sampled=' + sampleSet.size);

// Per-method aggregates
const agg = {};
for (const id of LOADED_METHOD_IDS) {
  agg[id] = {
    computableN: 0,
    notComputableN: 0,
    passN: 0,
    failN: 0,
    values: [],
    // audit F-A-2026-06-21: track degraded-path values separately so they don't
    // pollute the proper-path quintile distribution (incompatible value scales).
    degradedValues: [],
    degradedN: 0,
    anchorComputable: 0,
    anchorMap: {},
    sampleErrors: 0,
    errExamples: []
  };
}

let processed = 0;
for (const fname of sampleSet) {
  let stock;
  try { stock = JSON.parse(fs.readFileSync(path.join(SNAP_DIR, fname), 'utf8')); }
  catch (e) { continue; }
  if (!stock || !stock.meta) continue;
  const ticker = stock.meta.ticker || fname.replace('.json','');
  const isAnchor = ANCHORS.includes(ticker);
  processed++;

  for (const id of LOADED_METHOD_IDS) {
    const m = methods[id];
    let res;
    try { res = m.evaluate(stock); }
    catch (e) {
      agg[id].sampleErrors++;
      if (agg[id].errExamples.length < 3) agg[id].errExamples.push(ticker + ': ' + e.message);
      continue;
    }
    if (!res) { agg[id].notComputableN++; continue; }
    if (res.computable === false || res.computable == null) {
      agg[id].notComputableN++;
      if (isAnchor) agg[id].anchorMap[ticker] = { computable: false, reason: res.reason || res.note || null };
      continue;
    }
    agg[id].computableN++;
    if (res.pass === true) agg[id].passN++; else if (res.pass === false) agg[id].failN++;
    // audit F-A-2026-06-21: route degraded-path values (declared via
    // components.pricesUsed === 'degraded52w', a 0..1 positional score) into a
    // separate bucket so they don't blend with proper-path return ratios in the
    // quintile distribution (data-integrity: mixed value scales).
    const pricesUsed = res.components && res.components.pricesUsed;
    const isDegraded = typeof pricesUsed === 'string' && /degraded/i.test(pricesUsed);
    if (Number.isFinite(res.value)) {
      if (isDegraded) { agg[id].degradedValues.push(res.value); agg[id].degradedN++; }
      else agg[id].values.push(res.value);
    } else if (isDegraded) {
      agg[id].degradedN++;
    }
    if (isAnchor) {
      agg[id].anchorComputable++;
      agg[id].anchorMap[ticker] = { computable: true, value: res.value, pass: res.pass };
    }
  }
}

// Compute quintiles
function quantile(sorted, q) {
  if (sorted.length === 0) return null;
  const idx = (sorted.length - 1) * q;
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

const report = {
  generatedAt: new Date().toISOString(),
  universeTotal: total,
  sampleSize: processed,
  anchors: ANCHORS,
  methods: {}
};

for (const id of LOADED_METHOD_IDS) {
  const a = agg[id];
  const n = a.computableN + a.notComputableN;
  const coverage = n > 0 ? a.computableN / n : 0;
  const passRate = a.computableN > 0 ? a.passN / a.computableN : 0;
  // audit F-A-2026-06-21: quintiles computed over proper-path values ONLY;
  // degraded-path values (different scale) are quantiled separately so the two
  // populations are never blended into a single misleading distribution.
  const vals = a.values.slice().sort((x, y) => x - y);
  const q = {
    p10: quantile(vals, 0.10),
    p20: quantile(vals, 0.20),
    p50: quantile(vals, 0.50),
    p80: quantile(vals, 0.80),
    p90: quantile(vals, 0.90)
  };
  const degradedVals = a.degradedValues.slice().sort((x, y) => x - y);
  const degradedQuintiles = {
    p10: quantile(degradedVals, 0.10),
    p20: quantile(degradedVals, 0.20),
    p50: quantile(degradedVals, 0.50),
    p80: quantile(degradedVals, 0.80),
    p90: quantile(degradedVals, 0.90)
  };
  report.methods[id] = {
    label: methods[id].label,
    threshold: methods[id].threshold,
    thresholdOp: methods[id].thresholdOp,
    n: n,
    computableN: a.computableN,
    coverage: coverage,
    passN: a.passN,
    failN: a.failN,
    passRate: passRate,
    quintiles: q,
    // audit F-A-2026-06-21: proper-path sample count + degraded-path metrics
    // surfaced so consumers can discount/segment percentiles (mixed value scales).
    properN: a.values.length,
    degradedN: a.degradedN,
    degradedValueN: a.degradedValues.length,
    degradedQuintiles: degradedQuintiles,
    sampleErrors: a.sampleErrors,
    errExamples: a.errExamples,
    anchorComputable: a.anchorComputable,
    anchorCount: ANCHORS.length,
    anchorMap: a.anchorMap
  };
}

// Flags
function classify(r) {
  const flags = [];
  if (r.coverage < 0.20) flags.push('LOW_COVERAGE(<20%)');
  if (r.passRate > 0.95) flags.push('LOOSE_THRESHOLD(>95%)');
  if (r.passRate < 0.02) flags.push('TIGHT_THRESHOLD(<2%)');
  if (r.anchorComputable < 2) flags.push('ANCHOR_MISS(<2/10)');
  return flags;
}

for (const id of LOADED_METHOD_IDS) report.methods[id].flags = classify(report.methods[id]);

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, 'tag225d-effectiveness.json'), JSON.stringify(report, null, 2));

// Pretty print to console
for (const id of LOADED_METHOD_IDS) {
  const r = report.methods[id];
  console.log(id.padEnd(36) +
    ' cov=' + (r.coverage*100).toFixed(1).padStart(5) + '%' +
    ' pass=' + (r.passRate*100).toFixed(1).padStart(5) + '%' +
    ' anchor=' + r.anchorComputable + '/' + r.anchorCount +
    ' p20=' + (r.quintiles.p20 != null ? r.quintiles.p20.toFixed(3) : '—').padStart(7) +
    ' p50=' + (r.quintiles.p50 != null ? r.quintiles.p50.toFixed(3) : '—').padStart(7) +
    ' p80=' + (r.quintiles.p80 != null ? r.quintiles.p80.toFixed(3) : '—').padStart(7) +
    ' flags=' + (r.flags.join(',') || '-')
  );
  // audit F-A-2026-06-21: warn when degraded-path values exist so quintiles above
  // (proper-path only) are read in context and not mistaken for the full population.
  if (r.degradedN > 0) console.log('  DEGRADED ' + r.degradedN + ' value(s) excluded from quintiles (separate scale)');
  if (r.sampleErrors > 0) console.log('  ERR ' + r.sampleErrors + ' e.g. ' + r.errExamples.join(' | '));
}
console.log('written: outputs/tag225d-effectiveness.json');

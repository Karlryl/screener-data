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

const methods = {};
for (const id of METHOD_IDS) {
  const fileGuess = path.join(ROOT, 'methods', id + '.js');
  if (!fs.existsSync(fileGuess)) { console.error('missing method file', id); process.exit(1); }
  methods[id] = require(fileGuess);
}

// Build the universe — random sample + always-anchor tickers.
const allFiles = fs.readdirSync(SNAP_DIR).filter(f => f.endsWith('.json'));
const total = allFiles.length;
const rate = SAMPLE_TARGET / total;
// Deterministic LCG so repeated runs sample identically
let _seed = 20260517;
function rand() { _seed = (_seed * 1103515245 + 12345) | 0; return ((_seed >>> 0) % 1e9) / 1e9; }

const sampleSet = new Set();
for (const f of allFiles) { if (rand() < rate) sampleSet.add(f); }
for (const a of ANCHORS) {
  const fn = a + '.json';
  if (allFiles.includes(fn)) sampleSet.add(fn);
}

console.error('universe total=' + total + '  sampled=' + sampleSet.size);

// Per-method aggregates
const agg = {};
for (const id of METHOD_IDS) {
  agg[id] = {
    computableN: 0,
    notComputableN: 0,
    passN: 0,
    failN: 0,
    values: [],
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

  for (const id of METHOD_IDS) {
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
    if (Number.isFinite(res.value)) agg[id].values.push(res.value);
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

for (const id of METHOD_IDS) {
  const a = agg[id];
  const n = a.computableN + a.notComputableN;
  const coverage = n > 0 ? a.computableN / n : 0;
  const passRate = a.computableN > 0 ? a.passN / a.computableN : 0;
  const vals = a.values.slice().sort((x, y) => x - y);
  const q = {
    p10: quantile(vals, 0.10),
    p20: quantile(vals, 0.20),
    p50: quantile(vals, 0.50),
    p80: quantile(vals, 0.80),
    p90: quantile(vals, 0.90)
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

for (const id of METHOD_IDS) report.methods[id].flags = classify(report.methods[id]);

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, 'tag225d-effectiveness.json'), JSON.stringify(report, null, 2));

// Pretty print to console
for (const id of METHOD_IDS) {
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
  if (r.sampleErrors > 0) console.log('  ERR ' + r.sampleErrors + ' e.g. ' + r.errExamples.join(' | '));
}
console.log('written: outputs/tag225d-effectiveness.json');

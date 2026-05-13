'use strict';
/**
 * Tag 49: Auto-Compute Sektor-Medianen aus aktuellen Snapshots.
 * Wenn ≥ MIN_STOCKS_PER_SECTOR in einem Sub-Profile, nutze Live-Median.
 * Sonst Fallback auf hardcoded sector-medians.json.
 */
const fs = require('fs');
const path = require('path');

const MIN_STOCKS_PER_SECTOR = 5;

function median(arr) {
  if (!arr.length) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid-1] + sorted[mid]) / 2;
}

// Methoden die Sektor-relativ sind. Returnt Map sub-profile-id → metric-id → value-array
function gatherBySubProfile(stocks, classify) {
  const buckets = {};
  for (const stock of stocks) {
    const sp = classify(stock);
    if (!sp || !sp.id) continue;
    if (!buckets[sp.id]) buckets[sp.id] = { roic: [], roce: [], 'fcf-yield': [] };
    // ROIC
    const ni = stock.annual && stock.annual.annualNetIncome && stock.annual.annualNetIncome[0] && stock.annual.annualNetIncome[0].value;
    const ta = stock.annual && stock.annual.annualBalance && stock.annual.annualBalance[0] && stock.annual.annualBalance[0].totalAssets;
    const cash = stock.annual && stock.annual.annualBalance && stock.annual.annualBalance[0] && stock.annual.annualBalance[0].totalCash;
    if (ni != null && ta != null) {
      const ic = ta - (cash || 0);
      if (ic > 0) buckets[sp.id].roic.push(ni / ic);
    }
    // ROCE
    const oi = stock.annual && stock.annual.annualOpInc && stock.annual.annualOpInc[0] && stock.annual.annualOpInc[0].value;
    if (oi != null && ta != null) {
      const ce = ta - (cash || 0);
      if (ce > 0) buckets[sp.id].roce.push(oi / ce);
    }
    // FCF-Yield
    const fcf = stock.annual && stock.annual.annualFCF && stock.annual.annualFCF[0] && stock.annual.annualFCF[0].value;
    const mc = stock.marketCap && (typeof stock.marketCap === 'number' ? stock.marketCap : stock.marketCap.value);
    if (fcf != null && mc != null && mc > 0) {
      buckets[sp.id]['fcf-yield'].push(fcf / mc);
    }
  }
  return buckets;
}

function computeMedians(stocks, classify) {
  const buckets = gatherBySubProfile(stocks, classify);
  const result = {};
  for (const [spId, metrics] of Object.entries(buckets)) {
    if (spId === 'OTHER') continue;  // Tag-49: OTHER bleibt default-threshold (synthetic + edge-cases)
    result[spId] = {};
    for (const [mid, arr] of Object.entries(metrics)) {
      if (arr.length >= MIN_STOCKS_PER_SECTOR) {
        result[spId][mid] = median(arr);
        result[spId]['_n_' + mid] = arr.length;
      }
    }
  }
  return result;
}

// Merge auto-computed medians INTO sector-medians.json (live values overwrite hardcoded)
function writeAutoMedians(autoMedians) {
  const outPath = path.join(__dirname, 'sector-medians-auto.json');
  fs.writeFileSync(outPath, JSON.stringify({ _generatedAt: new Date().toISOString(), medians: autoMedians }, null, 2));
}

// Tag 133i: Rolling 12-month accumulator. Appends today's medians to a history file
// and recomputes the rolling 12m median per sub-profile × metric.
// Output structure:
//   { _generatedAt, _windowDays: 365,
//     medians: { spId: { metricId: { asOf, values: [{asOf, median, n}], rolling12mMedian } } } }
const ROLLING_WINDOW_DAYS = 365;
function writeRollingMedians(autoMedians) {
  const outPath = path.join(__dirname, 'sector-medians-rolling.json');
  const today = new Date().toISOString().slice(0, 10);
  const cutoff = (() => {
    const d = new Date(); d.setUTCDate(d.getUTCDate() - ROLLING_WINDOW_DAYS);
    return d.toISOString().slice(0, 10);
  })();
  let prior = { medians: {} };
  if (fs.existsSync(outPath)) {
    try { prior = JSON.parse(fs.readFileSync(outPath, 'utf8')) || { medians: {} }; } catch (e) {}
  }
  const merged = prior.medians || {};
  for (const [spId, metrics] of Object.entries(autoMedians)) {
    merged[spId] = merged[spId] || {};
    for (const [mid, val] of Object.entries(metrics)) {
      if (mid.startsWith('_')) continue;
      const n = metrics['_n_' + mid] || 0;
      const entry = merged[spId][mid] = merged[spId][mid] || { values: [], rolling12mMedian: null };
      // de-duplicate today's entry on re-run
      entry.values = entry.values.filter(v => v.asOf !== today && v.asOf >= cutoff);
      entry.values.push({ asOf: today, median: val, n });
      const med = median(entry.values.map(v => v.median).filter(Number.isFinite));
      entry.rolling12mMedian = med;
      entry.asOf = today;
    }
  }
  fs.writeFileSync(outPath, JSON.stringify({
    _generatedAt: new Date().toISOString(),
    _windowDays: ROLLING_WINDOW_DAYS,
    medians: merged
  }, null, 2));
  return merged;
}

module.exports = { computeMedians, writeAutoMedians, writeRollingMedians, MIN_STOCKS_PER_SECTOR };

// CLI mode: when run directly, compute + save
if (require.main === module) {
  const Engine = require('../engine-v7.3.js');
  const snapshotDir = process.argv[2] || './snapshots';
  const files = fs.readdirSync(snapshotDir).filter(f => f.endsWith('.json') && f !== '_manifest.json');
  const stocks = [];
  for (const f of files) {
    try { stocks.push(JSON.parse(fs.readFileSync(path.join(snapshotDir, f), 'utf8'))); } catch (e) {}
  }
  const auto = computeMedians(stocks, (s) => Engine.classifySubProfile(s));
  writeAutoMedians(auto);
  // Tag 133i: also append to rolling 12-month history
  try { writeRollingMedians(auto); console.log('✓ rolling-medians appended (sector-medians-rolling.json)'); }
  catch (e) { console.log('rolling-medians append failed: ' + e.message); }
  console.log('✓ auto-medians written. Sub-profiles:');
  for (const [sp, m] of Object.entries(auto)) {
    const metrics = Object.keys(m).filter(k => !k.startsWith('_'));
    console.log(`  ${sp}: ${metrics.map(k => `${k}=${(m[k]*100).toFixed(1)}% (n=${m['_n_'+k]})`).join(', ')}`);
  }
}

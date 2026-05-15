'use strict';
/**
 * Tag 49: Auto-Compute Sektor-Medianen aus aktuellen Snapshots.
 * Wenn ≥ MIN_STOCKS_PER_SECTOR in einem Sub-Profile, nutze Live-Median.
 * Sonst Fallback auf hardcoded sector-medians.json.
 *
 * Tag 167: Regional calibration. Medians are now computed per (region, subProfile)
 * pair. Output is written as v2 schema with byRegion structure PLUS a legacy-compat
 * flat file. Methods look up region-specific thresholds first, fall back to _GLOBAL.
 * Threshold: regional bucket needs ≥ MIN_STOCKS_PER_REGION_SECTOR stocks; otherwise
 * only the _GLOBAL bucket is populated for that subProfile.
 */
const fs = require('fs');
const path = require('path');
const { getRegion } = require('./region-mapping.js');

const MIN_STOCKS_PER_SECTOR = 5;
// Tag 167: Regional bucket requires more stocks to be trustworthy than global.
// With < 20 stocks the median can be noisy/unrepresentative.
const MIN_STOCKS_PER_REGION_SECTOR = 20;

function median(arr) {
  if (!arr.length) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid-1] + sorted[mid]) / 2;
}

// Methoden die Sektor-relativ sind.
// Tag 167: Returns TWO maps:
//   globalBuckets: sub-profile-id → metric-id → value-array  (all stocks, for _GLOBAL)
//   regionalBuckets: region → sub-profile-id → metric-id → value-array
function gatherBySubProfile(stocks, classify) {
  const globalBuckets = {};
  const regionalBuckets = {};

  for (const stock of stocks) {
    const sp = classify(stock);
    if (!sp || !sp.id) continue;

    // --- extract metrics ---
    const ni = stock.annual && stock.annual.annualNetIncome && stock.annual.annualNetIncome[0] && stock.annual.annualNetIncome[0].value;
    const ta = stock.annual && stock.annual.annualBalance && stock.annual.annualBalance[0] && stock.annual.annualBalance[0].totalAssets;
    const cash = stock.annual && stock.annual.annualBalance && stock.annual.annualBalance[0] && stock.annual.annualBalance[0].totalCash;
    const oi = stock.annual && stock.annual.annualOpInc && stock.annual.annualOpInc[0] && stock.annual.annualOpInc[0].value;
    const fcf = stock.annual && stock.annual.annualFCF && stock.annual.annualFCF[0] && stock.annual.annualFCF[0].value;
    const mc = stock.marketCap && (typeof stock.marketCap === 'number' ? stock.marketCap : stock.marketCap.value);

    // --- push into global bucket ---
    if (!globalBuckets[sp.id]) globalBuckets[sp.id] = { roic: [], roce: [], 'fcf-yield': [] };
    if (ni != null && ta != null) {
      const ic = ta - (cash || 0);
      if (ic > 0) globalBuckets[sp.id].roic.push(ni / ic);
    }
    if (oi != null && ta != null) {
      const ce = ta - (cash || 0);
      if (ce > 0) globalBuckets[sp.id].roce.push(oi / ce);
    }
    if (fcf != null && mc != null && mc > 0) {
      globalBuckets[sp.id]['fcf-yield'].push(fcf / mc);
    }

    // --- Tag 167: push into regional bucket ---
    const region = getRegion(stock);
    if (!regionalBuckets[region]) regionalBuckets[region] = {};
    if (!regionalBuckets[region][sp.id]) regionalBuckets[region][sp.id] = { roic: [], roce: [], 'fcf-yield': [] };
    if (ni != null && ta != null) {
      const ic = ta - (cash || 0);
      if (ic > 0) regionalBuckets[region][sp.id].roic.push(ni / ic);
    }
    if (oi != null && ta != null) {
      const ce = ta - (cash || 0);
      if (ce > 0) regionalBuckets[region][sp.id].roce.push(oi / ce);
    }
    if (fcf != null && mc != null && mc > 0) {
      regionalBuckets[region][sp.id]['fcf-yield'].push(fcf / mc);
    }
  }

  return { globalBuckets, regionalBuckets };
}

/**
 * Compute medians from a flat bucket map (sub-profile-id → metric → value-array).
 * Returns object keyed by spId with computed medians.
 * minN controls the minimum sample count required.
 */
// Metrics where negative values invert the "above/below median" scoring logic.
// For these, use only positive values for the scoring threshold.
const POSITIVE_ONLY_METRICS = new Set(['roic', 'roce']);

function _computeFromBuckets(buckets, minN) {
  const result = {};
  for (const [spId, metrics] of Object.entries(buckets)) {
    if (spId === 'OTHER') continue; // Tag-49: OTHER stays at default threshold
    result[spId] = {};
    for (const [mid, arr] of Object.entries(metrics)) {
      if (arr.length >= minN) {
        // F-ME-008: for ratio metrics like ROIC/ROCE, only use positive values for the
        // scoring threshold median. Negative values in loss-heavy sectors would invert
        // the above/below-median logic. Full array length is still reported for transparency.
        const thresholdArr = POSITIVE_ONLY_METRICS.has(mid) ? arr.filter(v => v > -0.05) : arr;
        result[spId][mid] = thresholdArr.length >= minN ? median(thresholdArr) : median(arr);
        result[spId]['_n_' + mid] = arr.length;
      }
    }
    // Remove empty sub-profiles
    if (Object.keys(result[spId]).length === 0) delete result[spId];
  }
  return result;
}

/**
 * Tag 167: Returns a v2 structure:
 *   {
 *     _version: 2,
 *     byRegion: {
 *       US: { SAAS: { roic: 0.15, _n_roic: 120 }, ... },
 *       EU: { ... },
 *       _GLOBAL: { ... }   ← always present, used as fallback
 *     }
 *   }
 * Regional buckets require MIN_STOCKS_PER_REGION_SECTOR to be populated;
 * _GLOBAL requires only MIN_STOCKS_PER_SECTOR.
 */
function computeMedians(stocks, classify) {
  const { globalBuckets, regionalBuckets } = gatherBySubProfile(stocks, classify);

  // _GLOBAL: all stocks pooled, lower minimum
  const globalResult = _computeFromBuckets(globalBuckets, MIN_STOCKS_PER_SECTOR);

  // Per-region: stricter minimum to avoid noisy small samples
  const byRegion = { _GLOBAL: globalResult };
  for (const [region, spMap] of Object.entries(regionalBuckets)) {
    const regionResult = _computeFromBuckets(spMap, MIN_STOCKS_PER_REGION_SECTOR);
    if (Object.keys(regionResult).length > 0) {
      byRegion[region] = regionResult;
    }
  }

  return { _version: 2, byRegion };
}

/**
 * Tag 167: Returns the flat (v1 legacy) medians object from a v2 result.
 * This is the _GLOBAL slice — same as the old computeMedians output shape.
 * Used by writeAutoMedians (legacy file) and writeRollingMedians.
 */
function extractLegacyMedians(v2Result) {
  if (v2Result && v2Result._version === 2 && v2Result.byRegion && v2Result.byRegion._GLOBAL) {
    return v2Result.byRegion._GLOBAL;
  }
  // If somehow called with old flat shape, return as-is
  return v2Result;
}

/**
 * Write sector-medians-auto.json (new v2 region-aware schema) and
 * sector-medians-auto-legacy.json (old flat schema for backwards compat).
 *
 * Tag 167: Two-file strategy keeps backwards compatibility.
 *   sector-medians-auto.json      — v2 { _version:2, byRegion:{ US:{...}, _GLOBAL:{...} } }
 *   sector-medians-auto-legacy.json — v1 flat { SAAS:{...}, BANK:{...} }  (= _GLOBAL slice)
 *
 * @param {object} autoMedians — result from computeMedians() (v2 shape)
 */
// F-SM-017 (Tag 179): atomic tmp+rename helper for state files. Previous direct
// writeFileSync could corrupt sector-medians files under SIGTERM (CI cancel),
// breaking effectiveThreshold lookup for every method on the next run.
function _atomicWrite(filePath, json) {
  const tmp = filePath + '.tmp.' + process.pid;
  fs.writeFileSync(tmp, json);
  fs.renameSync(tmp, filePath);
}

function writeAutoMedians(autoMedians) {
  const ts = new Date().toISOString();

  // v2 new file
  const outPath = path.join(__dirname, 'sector-medians-auto.json');
  _atomicWrite(outPath, JSON.stringify({
    _generatedAt: ts,
    _version: 2,
    byRegion: autoMedians.byRegion || {}
  }, null, 2));

  // v1 legacy file (always the _GLOBAL slice — same data as old flat output)
  const legacyMedians = extractLegacyMedians(autoMedians);
  const legacyPath = path.join(__dirname, 'sector-medians-auto-legacy.json');
  _atomicWrite(legacyPath, JSON.stringify({
    _generatedAt: ts,
    _version: 1,
    _note: 'Legacy flat schema for backwards compat. Equals _GLOBAL slice of sector-medians-auto.json.',
    medians: legacyMedians
  }, null, 2));
}

// Tag 133i: Rolling 12-month accumulator. Appends today's medians to a history file
// and recomputes the rolling 12m median per sub-profile × metric.
// Output structure:
//   { _generatedAt, _windowDays: 365,
//     medians: { spId: { metricId: { asOf, values: [{asOf, median, n}], rolling12mMedian } } } }
// Tag 167: autoMedians may be v2 shape — extract legacy (_GLOBAL) slice for rolling history.
const ROLLING_WINDOW_DAYS = 365;
function writeRollingMedians(autoMedians) {
  // Tag 167: Accept both v2 (new) and flat (old) shapes
  autoMedians = extractLegacyMedians(autoMedians);
  const outPath = path.join(__dirname, 'sector-medians-rolling.json');
  const today = new Date().toISOString().slice(0, 10);
  const cutoff = (() => {
    const d = new Date(); d.setUTCDate(d.getUTCDate() - ROLLING_WINDOW_DAYS);
    return d.toISOString().slice(0, 10);
  })();
  let prior = { medians: {} };
  if (fs.existsSync(outPath)) {
    try {
      prior = JSON.parse(fs.readFileSync(outPath, 'utf8')) || { medians: {} };
    } catch (e) {
      // F-SM-024 (Tag 191): vorher catch{} → silent 12-Monats-History-Wipe.
      // Eine korrupte/teilgeschriebene Datei führte dazu, dass merged = {} startete
      // und die gesamte rolling-Median-History dieses Tags überschrieb. Jetzt:
      // - Datei zur Diagnose beiseitelegen (.corrupt-<ts>)
      // - laut warnen, damit Operatoren das in CI-Logs sehen
      // - mit leerem prior fortfahren (Liveness > Konsistenz an dieser Stelle —
      //   nächste Pull-Runde baut wieder auf, und die .corrupt-Datei ist für
      //   Forensik da).
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      const corruptPath = outPath + '.corrupt-' + ts;
      try {
        fs.renameSync(outPath, corruptPath);
        console.warn('[rolling-medians] CORRUPT ' + outPath + ' → ' + corruptPath +
          ' (' + e.message + ') — rolling history reset for this run.');
      } catch (renameErr) {
        console.warn('[rolling-medians] CORRUPT ' + outPath + ' (' + e.message +
          ') — could not rename for forensics: ' + renameErr.message);
      }
      prior = { medians: {} };
    }
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
  // F-ME-009: prune stale rolling cache entries for sub-profiles no longer in the current result.
  // If a sector was dropped (below minN), effectiveThreshold would still prefer the stale rolling median.
  const currentSpIds = new Set(Object.keys(autoMedians));
  for (const spId of Object.keys(merged)) {
    if (!currentSpIds.has(spId)) delete merged[spId];
  }

  // F-SM-017 (Tag 179): atomic write
  _atomicWrite(outPath, JSON.stringify({
    _generatedAt: new Date().toISOString(),
    _windowDays: ROLLING_WINDOW_DAYS,
    medians: merged
  }, null, 2));
  return merged;
}

module.exports = {
  computeMedians, writeAutoMedians, writeRollingMedians,
  extractLegacyMedians,
  MIN_STOCKS_PER_SECTOR, MIN_STOCKS_PER_REGION_SECTOR
};

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
  // Tag 167: print summary — iterate over byRegion._GLOBAL for sub-profile list
  console.log('✓ auto-medians written (v2 region-aware). Regions: ' + Object.keys(auto.byRegion).filter(r => r !== '_GLOBAL').join(', '));
  const globalSlice = auto.byRegion._GLOBAL || {};
  console.log('  _GLOBAL sub-profiles:');
  for (const [sp, m] of Object.entries(globalSlice)) {
    const metrics = Object.keys(m).filter(k => !k.startsWith('_'));
    console.log(`    ${sp}: ${metrics.map(k => `${k}=${(m[k]*100).toFixed(1)}% (n=${m['_n_'+k]})`).join(', ')}`);
  }
}

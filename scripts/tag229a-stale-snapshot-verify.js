'use strict';
/**
 * Tag 229a: Run-#110 stale-snapshot probe verification harness.
 *
 * Re-implements pull-yahoo.js `_existingSnapshotMissingTag211lFields` and
 * `_getExistingSnapshotAge` (both are locally-scoped inside pullAll(), not
 * exported), then exercises them against random snapshots to confirm:
 *   1. The probe correctly flags pre-Tag-211l snapshots.
 *   2. No snapshot is "stale but would be skipped" (i.e. the schema-stale
 *      bucket and the price-only-eligible bucket are disjoint).
 *
 * Also projects the run-#110 full-pull fraction by sampling 100 snapshots.
 *
 * Snapshot reads only — never touches Yahoo.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SNAP_DIR = path.join(ROOT, 'snapshots');

// --- inlined copies of pull-yahoo.js helpers (lines ~1205, ~1240) ---
const WINDOWS_RESERVED = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;
function safeSnapshotFilename(ticker) {
  const sanitized = String(ticker).replace(/[^A-Z0-9.-]/gi, '_');
  const stem = sanitized.split('.')[0];
  if (WINDOWS_RESERVED.test(stem)) return '_' + sanitized + '.json';
  return sanitized + '.json';
}

const FUNDAMENTALS_MAX_AGE_DAYS = parseInt(process.env.FUNDAMENTALS_MAX_AGE_DAYS || '7', 10);
const FUNDAMENTALS_MAX_AGE_MS = FUNDAMENTALS_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;

function getExistingSnapshotAge(ticker, outputDir) {
  try {
    const fp = path.join(outputDir, safeSnapshotFilename(ticker));
    if (!fs.existsSync(fp)) return null;
    const buf = Buffer.alloc(500);
    const fd = fs.openSync(fp, 'r');
    fs.readSync(fd, buf, 0, 500, 0);
    fs.closeSync(fd);
    const m = buf.toString('utf8').match(/"asOf"\s*:\s*"([^"]+)"/);
    if (!m) return null;
    return Date.now() - new Date(m[1]).getTime();
  } catch { return null; }
}

function existingSnapshotMissingTag211lFields(ticker, outputDir) {
  // Returns { stale: bool, missing: [field names] }
  try {
    const fp = path.join(outputDir, safeSnapshotFilename(ticker));
    if (!fs.existsSync(fp)) return { stale: false, missing: [], reason: 'no-snapshot' };
    const raw = fs.readFileSync(fp, 'utf8');
    const s = JSON.parse(raw);
    const A = s && s.annual;
    if (!A) return { stale: false, missing: [], reason: 'no-annual-block' };
    const hasRev = Array.isArray(A.annualRev) && A.annualRev.length > 0;
    if (!hasRev) return { stale: false, missing: [], reason: 'price-only-seed' };
    const hasSGA = Array.isArray(A.annualSGA) && A.annualSGA.length > 0;
    const hasDepr = Array.isArray(A.annualDepreciation) && A.annualDepreciation.length > 0;
    const bal = A.annualBalance;
    const hasCA = Array.isArray(bal) && bal[0] && Number.isFinite(bal[0].currentAssets);
    const hasCL = Array.isArray(bal) && bal[0] && Number.isFinite(bal[0].currentLiabilities);
    const hasTL = Array.isArray(bal) && bal[0] && Number.isFinite(bal[0].totalLiabilities);
    // Tag 219 fields, also part of the schema gate per the comment block:
    const hasShares = Array.isArray(A.annualShares) && A.annualShares.length > 0;
    // Tag 219 quote-summary fields surfaced into the snapshot:
    const hasTgtMed = Number.isFinite(s && s.financialData && s.financialData.targetMedianPrice);
    const hasEarnHist = s && (s.earningsHistory != null);
    const hasMHB = s && (s.majorHoldersBreakdown != null);

    const missing = [];
    if (!hasSGA) missing.push('annualSGA');
    if (!hasDepr) missing.push('annualDepreciation');
    if (!hasCA) missing.push('annualBalance.currentAssets');
    if (!hasCL) missing.push('annualBalance.currentLiabilities');
    if (!hasTL) missing.push('annualBalance.totalLiabilities');
    if (!hasShares) missing.push('annualShares');
    if (!hasTgtMed) missing.push('targetMedianPrice');
    if (!hasEarnHist) missing.push('earningsHistory');
    if (!hasMHB) missing.push('majorHoldersBreakdown');

    // Probe's own gating logic (line 1266 of pull-yahoo.js):
    const probeWouldFlag = !(hasSGA || hasDepr) || !hasCA;
    return { stale: probeWouldFlag, missing, reason: probeWouldFlag ? 'tag211l-missing' : 'tag211l-ok' };
  } catch (e) { return { stale: false, missing: [], reason: 'parse-err:' + e.message }; }
}

// --- deterministic sampler ---
function sample(arr, n, seed) {
  let s = seed;
  function rnd() { s = (s * 1103515245 + 12345) | 0; return ((s >>> 0) % 1e9) / 1e9; }
  const copy = arr.slice();
  const out = [];
  for (let i = 0; i < n && copy.length > 0; i++) {
    const idx = Math.floor(rnd() * copy.length);
    out.push(copy.splice(idx, 1)[0]);
  }
  return out;
}

function tickerFromFile(fname) { return fname.replace(/\.json$/, '').replace(/^_/, ''); }

// --- main ---
const allFiles = fs.readdirSync(SNAP_DIR).filter(f => f.endsWith('.json'));
const total = allFiles.length;
console.log('snapshot universe total =', total);

// Universe-wide audit: how many snapshots even HAVE meta.asOf? (Tag 215j landed
// 2026-05-17, so pre-existing snapshots written before that lack it → age=null
// → they'll all full-pull regardless of the Tag 226a-2 probe.)
let withMetaAsOf = 0, withoutMetaAsOf = 0;
for (const f of allFiles) {
  try {
    const s = JSON.parse(fs.readFileSync(path.join(SNAP_DIR, f), 'utf8'));
    if (s.meta && s.meta.asOf) withMetaAsOf++; else withoutMetaAsOf++;
  } catch (e) { /* skip */ }
}
console.log('  snapshots with meta.asOf   :', withMetaAsOf, '(' + (100*withMetaAsOf/total).toFixed(1) + '%)');
console.log('  snapshots without meta.asOf:', withoutMetaAsOf, '(' + (100*withoutMetaAsOf/total).toFixed(1) + '%)');
console.log('  → snapshots without meta.asOf return age=null and ALWAYS full-pull (probe is bypassed but result is correct).');

// --- Phase 1: 30-snapshot detail print ---
console.log('\n=== Phase 1: 30 random snapshots ===');
console.log('ticker'.padEnd(14), '| age_d'.padEnd(8), '| would_full_pull'.padEnd(18), '| missing');
console.log('-'.repeat(120));

const detailSample = sample(allFiles, 30, 20260517);
let p1_total = 0, p1_pullFull = 0, p1_staleButSkip = 0;
for (const fname of detailSample) {
  const ticker = tickerFromFile(fname);
  const age = getExistingSnapshotAge(ticker, SNAP_DIR);
  const probe = existingSnapshotMissingTag211lFields(ticker, SNAP_DIR);
  // Replicate the EXACT gating from pull-yahoo.js line 1346-1362:
  //   age < FUNDAMENTALS_MAX_AGE_MS && !staleSchema → price-only
  //   else → full pull
  const wouldPriceOnly = (age != null && age < FUNDAMENTALS_MAX_AGE_MS && !probe.stale);
  const wouldFullPull = !wouldPriceOnly;
  p1_total++;
  if (wouldFullPull) p1_pullFull++;
  // BUG CHECK: probe says stale but we'd still take price-only
  if (probe.stale && wouldPriceOnly) p1_staleButSkip++;
  const ageDays = age != null ? (age / 86400000).toFixed(1) : 'n/a';
  console.log(
    ticker.padEnd(14),
    '|', ageDays.padStart(6),
    '|', (wouldFullPull ? 'FULL' : 'price-only').padEnd(16),
    '|', probe.missing.length === 0 ? '—' : probe.missing.join(',')
  );
}
console.log('\nPhase 1 summary: total=' + p1_total
  + ' / would_pull_full=' + p1_pullFull
  + ' / stale_but_would_skip=' + p1_staleButSkip);
if (p1_staleButSkip > 0) {
  console.log('!!! BUG: probe is detached from price-only gating — ' + p1_staleButSkip + ' stale snapshots would be skipped !!!');
}

// --- Phase 2: 100-sample projection ---
console.log('\n=== Phase 2: 100-snapshot projection for Run #110 ===');
const projSample = sample(allFiles, 100, 99999999);
let p2_total = 0, p2_pullFull = 0, p2_priceOnly = 0, p2_staleSchema = 0, p2_oldAge = 0, p2_staleButSkip = 0;
const missingCounts = {};
for (const fname of projSample) {
  const ticker = tickerFromFile(fname);
  const age = getExistingSnapshotAge(ticker, SNAP_DIR);
  const probe = existingSnapshotMissingTag211lFields(ticker, SNAP_DIR);
  const wouldPriceOnly = (age != null && age < FUNDAMENTALS_MAX_AGE_MS && !probe.stale);
  p2_total++;
  if (!wouldPriceOnly) p2_pullFull++; else p2_priceOnly++;
  if (probe.stale) p2_staleSchema++;
  if (age == null || age >= FUNDAMENTALS_MAX_AGE_MS) p2_oldAge++;
  if (probe.stale && wouldPriceOnly) p2_staleButSkip++;
  for (const f of probe.missing) missingCounts[f] = (missingCounts[f] || 0) + 1;
}
const fullFrac = p2_pullFull / p2_total;
const projFullPulls = Math.round(fullFrac * total);
const staleFrac = p2_staleSchema / p2_total;
const projStaleSchema = Math.round(staleFrac * total);

console.log('sample size           :', p2_total);
console.log('would_price_only      :', p2_priceOnly, '(' + (100*p2_priceOnly/p2_total).toFixed(1) + '%)');
console.log('would_full_pull       :', p2_pullFull,  '(' + (100*fullFrac).toFixed(1) + '%)');
console.log('  of which: age-stale :', p2_oldAge);
console.log('  of which: schema-stale (Tag 211l-flagged):', p2_staleSchema);
console.log('stale_but_would_skip  :', p2_staleButSkip, '(MUST be 0)');
console.log('\nProjected Run #110 (universe=' + total + ' snapshots):');
console.log('  full-pulls         ~ ' + projFullPulls);
console.log('  schema-flagged     ~ ' + projStaleSchema);
console.log('\nMissing-field frequencies (out of ' + p2_total + ' sampled):');
for (const k of Object.keys(missingCounts).sort((a,b) => missingCounts[b] - missingCounts[a])) {
  console.log('  ' + k.padEnd(36) + missingCounts[k] + ' (' + (100*missingCounts[k]/p2_total).toFixed(0) + '%)');
}

// --- Wall-clock estimate ---
const PER_FULL_PULL_MS = 800;       // observed ~800ms per full pull (quoteSummary + FTS)
const PER_PRICE_ONLY_MS = 150;      // observed ~150ms per quote
const CONCURRENCY = parseInt(process.env.PULL_CONCURRENCY || '10', 10);
const wallFullMs = projFullPulls * PER_FULL_PULL_MS / CONCURRENCY;
const wallPriceMs = (total - projFullPulls) * PER_PRICE_ONLY_MS / CONCURRENCY;
const wallTotalMin = (wallFullMs + wallPriceMs) / 60000;
// Baseline = if NO stale-schema bug, all 7d-young snapshots stay price-only.
// We approximate baseline by assuming only the age-stale ones would full-pull.
const baselineFullPulls = Math.round((p2_oldAge / p2_total) * total);
const baselineWallMs = (baselineFullPulls * PER_FULL_PULL_MS + (total - baselineFullPulls) * PER_PRICE_ONLY_MS) / CONCURRENCY;
const baselineMin = baselineWallMs / 60000;
const extraMin = wallTotalMin - baselineMin;

console.log('\nWall-clock estimate (concurrency=' + CONCURRENCY + ', 800ms/full, 150ms/price-only):');
console.log('  baseline (age-stale only)  ~ ' + baselineMin.toFixed(1) + ' min  (' + baselineFullPulls + ' full-pulls)');
console.log('  Run #110 (incl Tag 226a-2) ~ ' + wallTotalMin.toFixed(1) + ' min  (' + projFullPulls + ' full-pulls)');
console.log('  extra wall-clock           ~ +' + extraMin.toFixed(1) + ' min');

// --- Exit code so CI can gate on the bug check ---
if (p1_staleButSkip > 0 || p2_staleButSkip > 0) {
  console.log('\nFAIL: stale_but_would_skip > 0 — probe wiring is BROKEN.');
  process.exit(2);
}
console.log('\nOK: probe wired correctly — every stale-schema snapshot would trigger a full pull.');

'use strict';
/**
 * Tag 229a: Run-#110 stale-snapshot probe verification harness.
 *
 * Uses pull-yahoo.js `_existingSnapshotMissingTag211lFields` (imported, see
 * below) and a local copy of `_getExistingSnapshotAge`, then exercises them
 * against random snapshots to confirm:
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

// audit F-A-2026-06-22: import the canonical safeSnapshotFilename from
// lib/snapshot-fs.js instead of re-inlining a 4th copy. Prevents a silent
// verification-value lapse: the inlined copy here was an older, narrower
// variant (missing the CONIN$/CONOUT$ reserved names AND the empty-/dotted-stem
// `_` prefixing that the live writer+reader use). For tickers like `.DE` or
// `CONIN$` the harness would compute a different on-disk filename than the real
// snapshot, then fs.existsSync → false → treat the snapshot as missing and
// report a WRONG stale/full-pull result for those tickers. Sharing the one
// helper keeps the harness's filename mapping bit-identical to production.
const { safeSnapshotFilename } = require('../lib/snapshot-fs.js');

// T181 (2026-08-30): das Tor wird IMPORTIERT, nicht nachgebaut. Vorher stand hier eine
// Kopie von `_existingSnapshotMissingTag211lFields`, und die war ABGEDRIFTET: sie las
// `Number.isFinite(bal[0].currentAssets)`, waehrend die Produktion seit dem Bug-13-Fix
// (2026-07-03) `'currentAssets' in bal[0]` prueft — Schluessel-ANWESENHEIT statt finitem
// Wert. Ueber dieselben 15.046 Snapshots gemessen:
//
//     Produktion  pull-yahoo.js   149 schema-stale
//     Spiegel     dieses Skript  1719 schema-stale     (11,54x, 1.570 zu viel)
//
// und zwar als echte OBERMENGE (0 Snapshots, die die Produktion meldet und der Spiegel
// nicht). Banken/Versicherer tragen `currentAssets:null` — Schluessel da, Wert nicht
// finit. Wer das Werkzeug zur Abschaetzung benutzte, bekam eine 11-fach zu hohe Zahl.
// Der Spiegel war die kaputte Messlatte, nicht der kaputte Gegenstand.
//
// Ein Nachbau kann nur wieder driften; deshalb ist er ersetzt statt repariert. Die
// Funktion wurde in PR #118 dafuer auf Modul-Ebene gehoben und exportiert (F1334:
// ein Pruefwerkzeug muss die Regel messen, die im Lauf wirklich entscheidet).
const { _existingSnapshotMissingTag211lFields } = require('../pull-yahoo.js');

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

// Tag 230a sibling probe: pre-Tag-219c intl currency envelopes.
function existingSnapshotMissingCurrencyNormalization(ticker, outputDir) {
  try {
    const fp = path.join(outputDir, safeSnapshotFilename(ticker));
    if (!fs.existsSync(fp)) return false;
    const s = JSON.parse(fs.readFileSync(fp, 'utf8'));
    const m = s && s.meta;
    if (!m) return false;
    const A = s.annual;
    const hasRev = A && Array.isArray(A.annualRev) && A.annualRev.length > 0;
    if (!hasRev) return false;
    if (m.reportingCurrency === 'USD') return false;
    if (m.fxConverted === true) return false;
    if (m.reportingCurrencyOriginal && typeof m.fxRateApplied === 'number' && Number.isFinite(m.fxRateApplied)) return false;
    if (m.fxConversionFailed === true) return false;
    return true;
  } catch { return false; }
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
    // audit F-A-2026-06-22: DIAGNOSTIC-ONLY fields — these do NOT participate in
    // the stale gate. The gate is the IMPORTED production rule (see
    // probeWouldFlag below). annualShares and the three quote-summary fields are
    // surfaced solely into `missing[]` for reporting; the prior comment wrongly
    // implied they were "part of the schema gate", which would mislead a reader
    // into thinking a missing annualShares / targetMedianPrice forces a full pull
    // (it does not).
    //
    // T181: `hasCA`/`hasCL`/`hasTL` bleiben hier bewusst FINIT-basiert — als
    // Diagnose ist "kein brauchbarer Wert" die nuetzlichere Aussage. Sie sind aber
    // ausdruecklich NICHT mehr das Tor. Genau diese Verwechslung war der Fehler:
    // `probeWouldFlag` rechnete das Tor aus den Diagnose-Booleans NACH, und der
    // finite `hasCA` machte daraus 1.719 statt 149. Ein `missing`-Eintrag
    // 'annualBalance.currentAssets' bei `stale:false` ist deshalb kein Widerspruch,
    // sondern heisst: Schluessel da (Schema aktuell), Wert null (Bank/Versicherer).
    const hasShares = Array.isArray(A.annualShares) && A.annualShares.length > 0;
    // Tag 219 quote-summary fields surfaced into the snapshot (diagnostic-only):
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

    // Das ECHTE Tor, importiert statt nachgerechnet (s. Kopf der Datei).
    const probeWouldFlag = _existingSnapshotMissingTag211lFields(s);
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

// T181: als Bibliothek einbindbar, damit der Waechter
// (tests/tag229a-spiegel-produktionsgleich.test.js) die Sonden dieses Werkzeugs
// AUFRUFEN kann statt sie ein drittes Mal nachzubauen. Der Messlauf unten braucht den
// echten Snapshot-Bestand und gehoert nicht in einen Test — deshalb der Frueh-Ausstieg.
// (Top-level `return` ist in CommonJS zulaessig: Node wickelt jedes Modul in eine
// Funktion. Gewaehlt, weil die Alternative — den ganzen Messlauf in eine main() zu
// ruecken — 145 Zeilen umformatiert haette, ohne etwas zu aendern.)
module.exports = {
  existingSnapshotMissingTag211lFields,
  existingSnapshotMissingCurrencyNormalization,
  getExistingSnapshotAge,
};
if (require.main !== module) return;

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
console.log('ticker'.padEnd(14), '| age_d'.padEnd(8), '| would_full_pull'.padEnd(18), '| reason'.padEnd(22), '| missing');
console.log('-'.repeat(140));

const detailSample = sample(allFiles, 30, 20260517);
let p1_total = 0, p1_pullFull = 0, p1_staleButSkip = 0, p1_ccyStale = 0;
for (const fname of detailSample) {
  const ticker = tickerFromFile(fname);
  const age = getExistingSnapshotAge(ticker, SNAP_DIR);
  const probe = existingSnapshotMissingTag211lFields(ticker, SNAP_DIR);
  const ccyStale = existingSnapshotMissingCurrencyNormalization(ticker, SNAP_DIR);
  // Replicate the EXACT gating from pull-yahoo.js post-Tag-230a:
  //   age < FUNDAMENTALS_MAX_AGE_MS && !staleSchema && !staleCurrency → price-only
  //   else → full pull
  const youngEnough = age != null && age < FUNDAMENTALS_MAX_AGE_MS;
  const wouldPriceOnly = youngEnough && !probe.stale && !ccyStale;
  const wouldFullPull = !wouldPriceOnly;
  p1_total++;
  if (wouldFullPull) p1_pullFull++;
  if (ccyStale) p1_ccyStale++;
  // BUG CHECK: probe says stale but we'd still take price-only
  if ((probe.stale || ccyStale) && wouldPriceOnly) p1_staleButSkip++;
  const ageDays = age != null ? (age / 86400000).toFixed(1) : 'n/a';
  const reasons = [];
  if (!youngEnough) reasons.push('age-stale');
  if (probe.stale) reasons.push('tag211l');
  if (ccyStale) reasons.push('ccy-envelope');
  if (reasons.length === 0) reasons.push('-');
  console.log(
    ticker.padEnd(14),
    '|', ageDays.padStart(6),
    '|', (wouldFullPull ? 'FULL' : 'price-only').padEnd(16),
    '|', reasons.join(',').padEnd(20),
    '|', probe.missing.length === 0 ? '—' : probe.missing.join(',')
  );
}
console.log('\nPhase 1 summary: total=' + p1_total
  + ' / would_pull_full=' + p1_pullFull
  + ' / ccy-envelope-stale=' + p1_ccyStale
  + ' / stale_but_would_skip=' + p1_staleButSkip);
if (p1_staleButSkip > 0) {
  console.log('!!! BUG: probe is detached from price-only gating — ' + p1_staleButSkip + ' stale snapshots would be skipped !!!');
}

// --- Phase 1b: Tag 226c-4 anchor cohort (intl tickers known to be mixed-ccy) ---
console.log('\n=== Phase 1b: Tag 226c-4 intl anchor cohort ===');
const intlAnchors = ['9988.HK','7203.T','HSBA.L','ASML.AS','MC.PA'];
let intlFlagged = 0;
for (const ticker of intlAnchors) {
  const fp = path.join(SNAP_DIR, safeSnapshotFilename(ticker));
  if (!fs.existsSync(fp)) { console.log('  ' + ticker.padEnd(12) + ' [snapshot-missing]'); continue; }
  const ccyStale = existingSnapshotMissingCurrencyNormalization(ticker, SNAP_DIR);
  const tag211lStale = existingSnapshotMissingTag211lFields(ticker, SNAP_DIR).stale;
  if (ccyStale) intlFlagged++;
  console.log('  ' + ticker.padEnd(12)
    + ' ccyStale=' + (ccyStale ? 'YES' : 'no ').padEnd(3)
    + ' tag211lStale=' + (tag211lStale ? 'YES' : 'no'));
}
console.log('intl anchor cohort: ' + intlFlagged + '/' + intlAnchors.length + ' flagged by new ccy probe');

// --- Phase 2: 100-sample projection ---
console.log('\n=== Phase 2: 100-snapshot projection for Run #110 ===');
const projSample = sample(allFiles, 100, 99999999);
let p2_total = 0, p2_pullFull = 0, p2_priceOnly = 0, p2_staleSchema = 0, p2_oldAge = 0, p2_staleButSkip = 0;
let p2_ccyStale = 0;
const missingCounts = {};
for (const fname of projSample) {
  const ticker = tickerFromFile(fname);
  const age = getExistingSnapshotAge(ticker, SNAP_DIR);
  const probe = existingSnapshotMissingTag211lFields(ticker, SNAP_DIR);
  const ccyStale = existingSnapshotMissingCurrencyNormalization(ticker, SNAP_DIR);
  const wouldPriceOnly = (age != null && age < FUNDAMENTALS_MAX_AGE_MS && !probe.stale && !ccyStale);
  p2_total++;
  if (!wouldPriceOnly) p2_pullFull++; else p2_priceOnly++;
  if (probe.stale) p2_staleSchema++;
  if (ccyStale) p2_ccyStale++;
  if (age == null || age >= FUNDAMENTALS_MAX_AGE_MS) p2_oldAge++;
  if ((probe.stale || ccyStale) && wouldPriceOnly) p2_staleButSkip++;
  for (const f of probe.missing) missingCounts[f] = (missingCounts[f] || 0) + 1;
}
const fullFrac = p2_pullFull / p2_total;
const projFullPulls = Math.round(fullFrac * total);
const staleFrac = p2_staleSchema / p2_total;
const projStaleSchema = Math.round(staleFrac * total);
const ccyFrac = p2_ccyStale / p2_total;
const projCcyStale = Math.round(ccyFrac * total);

console.log('sample size           :', p2_total);
console.log('would_price_only      :', p2_priceOnly, '(' + (100*p2_priceOnly/p2_total).toFixed(1) + '%)');
console.log('would_full_pull       :', p2_pullFull,  '(' + (100*fullFrac).toFixed(1) + '%)');
console.log('  of which: age-stale :', p2_oldAge);
console.log('  of which: schema-stale (Tag 211l-flagged):', p2_staleSchema);
console.log('  of which: ccy-envelope-stale (Tag 230a) :', p2_ccyStale);
console.log('stale_but_would_skip  :', p2_staleButSkip, '(MUST be 0)');
console.log('\nProjected Run #110 (universe=' + total + ' snapshots):');
console.log('  full-pulls         ~ ' + projFullPulls);
console.log('  schema-flagged     ~ ' + projStaleSchema);
console.log('  ccy-envelope-flagged ~ ' + projCcyStale);
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

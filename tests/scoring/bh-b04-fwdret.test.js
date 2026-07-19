'use strict';
/**
 * BH-101 + BH-112 regression (batch b04-fwdret, lib/forward-returns.js).
 *
 * BH-101: classify() previously read ANY price key >= exitDate as "coverage
 *   reaches the exit region" and called it 'delisted' (-100% downstream).
 *   That inverted the evidence: a close strictly AFTER exitDate proves the
 *   name kept trading — the gap right at exitDate is a data hole, not a
 *   delisting. Only newest === exitDate (unusable close exactly at target)
 *   is a genuine gap/delisting.
 * BH-112: classify() computed exit staleness but not entry staleness/effective
 *   horizon, so a caller pooling windows could not tell a clean t0 entry from
 *   one silently backed up several days.
 *
 * Run standalone: node tests/scoring/bh-b04-fwdret.test.js  (Exit 0/1)
 */
const assert = require('node:assert/strict');
const { classify } = require('../../lib/forward-returns.js');

let pass = 0, fail = 0;
function test(name, fn) { try { fn(); pass++; console.log('  ok   ' + name); } catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); } }

const mapOf = (entries) => new Map(entries);
const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

// ── BH-101 ────────────────────────────────────────────────────────────────
test('BH-101: real close strictly AFTER exitDate -> series_ended, not delisted', () => {
  // Gap right at the exit target (no key in [exitDate-7, exitDate]), but a
  // real (positive) close resumes 5 days later -> proves continued trading.
  const idx = { XYZ: mapOf([
    ['2026-01-05', 100],   // entry
    ['2026-01-25', 108],   // resumes AFTER exitDate -> continued trading
  ]) };
  const r = classify(idx, 'XYZ', '2026-01-05', '2026-01-20');
  assert.equal(r.status, 'series_ended');
  assert.equal(r.newestDate, '2026-01-25');
  assert.notEqual(r.status, 'delisted');
});

test('BH-101: newest === exitDate with unusable close -> still delisted (genuine gap AT target)', () => {
  const idx = { XYZ: mapOf([
    ['2026-01-05', 100],
    ['2026-01-20', 0],    // last-ever row is a 0-close glitch exactly at exitDate
  ]) };
  const r = classify(idx, 'XYZ', '2026-01-05', '2026-01-20');
  assert.equal(r.status, 'delisted');
  assert.equal(r.newestDate, '2026-01-20');
});

test('BH-101 regression guard: series stops well BEFORE exitDate (M&A-shape) -> still series_ended, unchanged', () => {
  // No key at all past t0+30, well short of the t0+84 target — the pre-fix
  // M&A-shortened path in rank-ic.js depends on this branch staying series_ended.
  const t0 = '2026-01-05';
  const idx = { MNA: mapOf([[t0, 10], [addDays(t0, 30), 13.5]]) };
  const r = classify(idx, 'MNA', t0, addDays(t0, 84));
  assert.equal(r.status, 'series_ended');
  assert.equal(r.newestDate, addDays(t0, 30));
});

test('BH-101 exact repro (review DEAD-fixture): last bar t0+89 is a 0-close AFTER exitDate t0+84 -> series_ended/newestDate=t0+89, NOT delisted', () => {
  // This is the literal fixture the Opus review traced through rank-ic.js
  // windowReturns: classify() is correct here (a later date key, even an
  // unusable 0-close, proves the series didn't end AT exitDate). The
  // remaining gap is downstream: rank-ic.js's §8-shortening path (BH-101/
  // BH-112, fixFiles scripts/rank-ic.js + tests/rank-ic.test.js) re-classifies
  // with exitDate=newestDate, which for THIS shape resolves to status
  // 'delisted' (newest===exitDate there too) — windowReturns currently only
  // handles c2.status==='ok' in that branch and drops the -100% case instead
  // of booking it, dropping a real delisting from 'used'. Out of this batch's
  // file scope (lib/forward-returns.js only); pinned here so the rank-ic
  // batch has an exact contract to code against.
  const t0 = '2026-01-05';
  const idx = { DEAD: mapOf([[t0, 10], [addDays(t0, 89), 0]]) };
  const r = classify(idx, 'DEAD', t0, addDays(t0, 84));
  assert.equal(r.status, 'series_ended');
  assert.equal(r.newestDate, addDays(t0, 89));
  assert.notEqual(r.status, 'delisted');
});

// ── BH-112 ────────────────────────────────────────────────────────────────
test('BH-112: clean entry+exit -> entryStaleDays 0, horizonActualDays == nominal', () => {
  const idx = { XYZ: mapOf([['2026-01-05', 100], ['2026-01-20', 110]]) };
  const r = classify(idx, 'XYZ', '2026-01-05', '2026-01-20');
  assert.equal(r.status, 'ok');
  assert.equal(r.resolvedEntryDate, '2026-01-05');
  assert.equal(r.resolvedExitDate, '2026-01-20');
  assert.equal(r.entryStaleDays, 0);
  assert.equal(r.entryStale, false);
  assert.equal(r.horizonActualDays, 15);
});

test('BH-112: entry backward-walked (t0 missing, nearest earlier close used) -> entryStale flagged', () => {
  // No close exactly at the nominal entry date; the ticker's own map only has
  // an earlier close 7 calendar days back (within PRICE_MAX_STALE_DAYS).
  // Previously this silently used a shifted entry with no staleness signal.
  const idx = { XYZ: mapOf([['2025-12-29', 90], ['2026-01-20', 110]]) };
  const r = classify(idx, 'XYZ', '2026-01-05', '2026-01-20');
  assert.equal(r.status, 'ok');
  assert.equal(r.resolvedEntryDate, '2025-12-29');
  assert.equal(r.entryStaleDays, 5); // 5 business days between 2025-12-29 and 2026-01-05
  assert.equal(r.entryStale, true);  // > EXIT_STALE_FLAG_BUSINESS_DAYS (2)
  assert.equal(r.horizonActualDays, 22); // 2025-12-29 -> 2026-01-20
});

console.log(`\nbh-b04-fwdret.test.js: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);

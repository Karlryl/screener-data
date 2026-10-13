'use strict';
/**
 * BH-042/043/045/046/047/048/182/194 regression (batch b06-pullyahoo, pull-yahoo.js).
 * (BH-044 has its own dedicated fixture: tests/sort-cache-order.test.js.)
 *
 * BH-182: --help (or any unknown flag) previously fell through parseArgs silently,
 *   letting main() delete the committed prod manifest and start a full watchlist
 *   pull. parseArgs must flag args.help / args.argError; main() must check both
 *   BEFORE any file mutation.
 * BH-194: a malformed --shard value (flag present, "i/N" invalid) previously only
 *   WARNed and fell back to args.shard=null (full-universe pull) — indistinguishable
 *   from "no --shard flag at all". Must be a distinct args.argError.
 * BH-046: the mapper read marketCap ONLY from summaryDetail; a live Yahoo schema
 *   drift that drops summaryDetail.marketCap (while price.marketCap is still
 *   present) unlinked an otherwise-valid snapshot. Must fall back to price.marketCap.
 * BH-042: opendart-kr.js flags KOSPI/KOSDAQ-ambiguous KR tickers suffixUnsure:true
 *   with a default .KS guess and documents a .KQ retry-on-404 that never existed.
 *   shouldRetryKosdaq() is the extracted pure retry decision.
 * BH-047: a single not-found response immediately set meta.delisted=true, and the
 *   next daily prune-watchlist run removed the ticker irreversibly. Must require
 *   NOT_FOUND_DELIST_STREAK consecutive not-found runs (nextNotFoundState()).
 * BH-043: yf.* requests fired ~6x per ticker with no spacing between them (only the
 *   ticker START was gated) — acquireYfSlot() must space EVERY request globally.
 *
 * Standalone runner (node <datei>, exit 0/1) — no network. BH-043's check does one
 * short (~40ms) real setTimeout wait; everything else is synchronous.
 *
 * Run standalone: node tests/scoring/bh-b06-pullyahoo.test.js
 */
const assert = require('node:assert/strict');
const {
  parseArgs, mapYahooToCanonical, shouldRetryKosdaq, nextNotFoundState,
  acquireYfSlot, _setYfGateSleepMs, YF_REQUESTS_PER_TICKER,
} = require('../../pull-yahoo.js');

let pass = 0, fail = 0;
function test(name, fn) { try { fn(); pass++; console.log('  ok   ' + name); } catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); } }
async function testAsync(name, fn) {
  try { await fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + (e.stack || e.message)); }
}

// ── BH-182: --help / unknown flags must not fall through silently ─────────────
test('BH-182: --help sets args.help (no watchlist/output touched)', () => {
  const args = parseArgs(['node', 'pull-yahoo.js', '--help']);
  assert.equal(args.help, true);
  assert.equal(args.argError, null);
});

test('BH-182: -h is equivalent to --help', () => {
  assert.equal(parseArgs(['node', 'pull-yahoo.js', '-h']).help, true);
});

test('BH-182: an unrecognized flag sets args.argError instead of being silently ignored', () => {
  const args = parseArgs(['node', 'pull-yahoo.js', '--bogus-flag']);
  assert.equal(args.help, false);
  assert.match(args.argError, /Unbekanntes Argument/);
});

test('BH-182: known flags (as used by daily-pull.yml / package.json) parse clean, no argError', () => {
  const args = parseArgs(['node', 'pull-yahoo.js', '--shard', '1/4', '--watchlist', 'watchlist.json', '--output', 'snapshots', '--rate-limit', '2000']);
  assert.equal(args.argError, null);
  assert.equal(args.help, false);
  assert.deepEqual(args.shard, { index: 1, count: 4 });
  assert.equal(args.rateLimit, 2000);
});

// ── BH-194: malformed --shard must be a hard error, distinct from "no --shard" ─
test('BH-194: --shard with out-of-range i/N sets argError (not a silent full-pull fallback)', () => {
  const args = parseArgs(['node', 'pull-yahoo.js', '--shard', '5/3']); // 5 >= 3, invalid
  assert.equal(args.shard, null);
  assert.match(args.argError, /Ungueltiges --shard/);
});

test('BH-194: --shard with non-numeric value sets argError', () => {
  const args = parseArgs(['node', 'pull-yahoo.js', '--shard', 'x/y']);
  assert.equal(args.shard, null);
  assert.match(args.argError, /Ungueltiges --shard/);
});

test('BH-194: NO --shard flag at all is NOT an error (full universe is the documented default)', () => {
  const args = parseArgs(['node', 'pull-yahoo.js', '--watchlist', 'watchlist.json']);
  assert.equal(args.shard, null);
  assert.equal(args.argError, null);
});

// ── BH-046: marketCap fallback price.marketCap when summaryDetail.marketCap absent ─
test('BH-046: summaryDetail.marketCap present -> used (unchanged behavior)', () => {
  const c = mapYahooToCanonical({ summaryDetail: { marketCap: 123 }, price: { marketCap: 999 } }, { ticker: 'T1' }, '2026-01-01T00:00:00Z');
  assert.equal(c.marketCap.value, 123);
});

test('BH-046: summaryDetail.marketCap missing, price.marketCap present -> falls back (was: null -> snapshot unlinked)', () => {
  const c = mapYahooToCanonical({ summaryDetail: {}, price: { marketCap: 999 } }, { ticker: 'T2' }, '2026-01-01T00:00:00Z');
  assert.equal(c.marketCap.value, 999);
});

test('BH-046: both absent -> still null (no fabricated marketCap)', () => {
  const c = mapYahooToCanonical({ summaryDetail: {}, price: {} }, { ticker: 'T3' }, '2026-01-01T00:00:00Z');
  assert.equal(c.marketCap, null);
});

// ── BH-042: KOSDAQ .KS->.KQ retry decision ─────────────────────────────────────
test('BH-042: not-found + suffixUnsure + .KS symbol -> retry', () => {
  assert.equal(shouldRetryKosdaq({ suffixUnsure: true, yahoo_symbol: '005930.KS' }, 'not-found'), true);
});

test('BH-042: suffixUnsure but NOT not-found errClass -> no retry (only 404s trigger it)', () => {
  assert.equal(shouldRetryKosdaq({ suffixUnsure: true, yahoo_symbol: '005930.KS' }, 'rate-limit'), false);
});

test('BH-042: not-found but suffixUnsure not set -> no retry (regular US/other ticker)', () => {
  assert.equal(shouldRetryKosdaq({ yahoo_symbol: 'AAPL' }, 'not-found'), false);
});

test('BH-042: already retried once (_kqRetried) -> no second retry (no infinite recursion)', () => {
  assert.equal(shouldRetryKosdaq({ suffixUnsure: true, yahoo_symbol: '005930.KQ', _kqRetried: true }, 'not-found'), false);
});

test('BH-042: suffixUnsure but symbol already .KQ -> no retry (nothing left to correct)', () => {
  assert.equal(shouldRetryKosdaq({ suffixUnsure: true, yahoo_symbol: '005930.KQ' }, 'not-found'), false);
});

// ── BH-047: not-found streak before delisting ──────────────────────────────────
test('BH-047: first not-found -> streak=1, not yet delisted', () => {
  const r = nextNotFoundState(null);
  assert.equal(r.streak, 1);
  assert.equal(r.delisted, false);
});

test('BH-047: second consecutive not-found -> streak=2, delisted (matches default NOT_FOUND_DELIST_STREAK=2)', () => {
  const r = nextNotFoundState({ notFoundStreak: 1 });
  assert.equal(r.streak, 2);
  assert.equal(r.delisted, true);
});

// ── BH-043: shared request-spacing gate spaces EVERY acquireYfSlot() call ─────
async function run() {
  await testAsync('BH-043: acquireYfSlot() enforces minimum spacing across consecutive calls', async () => {
    const SPACING_MS = 40;
    _setYfGateSleepMs(SPACING_MS);
    const t0 = Date.now();
    await acquireYfSlot(); // first slot: no wait (gate starts idle)
    await acquireYfSlot(); // second slot: must wait ~SPACING_MS
    await acquireYfSlot(); // third slot: must wait ~SPACING_MS more
    const elapsed = Date.now() - t0;
    // 2 enforced gaps of SPACING_MS each = 2*SPACING_MS minimum; generous slack for CI jitter.
    assert.ok(elapsed >= SPACING_MS * 2 - 15, `expected >= ~${SPACING_MS * 2}ms spacing, got ${elapsed}ms`);
    _setYfGateSleepMs(0); // disarm — no-op outside a pullAll() run
  });

  
// -- Tag 436: Dosis-Korrektur zu BH-043 -- --rate-limit ist das Budget PRO TICKER ----
// Regression, die den stillen Durchsatz-Einbruch vom 19.07. gefangen haette: BH-043
// verarbeitete den Wert als Budget pro REQUEST und machte den Pull dadurch ~6x langsamer,
// bis alle Shards in ihren Timeout liefen (n_full 224 -> 0) -- ohne dass CI rot wurde.
test('Tag 436: --rate-limit wird als Ticker-Budget auf die Requests verteilt', () => {
  assert.equal(YF_REQUESTS_PER_TICKER, 6);
  const src = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '..', '..', 'pull-yahoo.js'), 'utf8');
  assert.ok(!/_yfGateSleepMs = rateLimitMs;/.test(src),
    'Gate wird wieder mit dem rohen rateLimitMs armiert - das ist der BH-043-Durchsatzfehler');
  assert.ok(/_yfGateSleepMs = rateLimitMs \/ YF_REQUESTS_PER_TICKER;/.test(src),
    'Gate muss das Ticker-Budget auf die Requests je Ticker verteilen');
  const gates = (src.match(/await acquireYfSlot\(\)/g) || []).length;
  assert.equal(gates, YF_REQUESTS_PER_TICKER + 1,
    gates + " acquireYfSlot()-Stellen, erwartet " + (YF_REQUESTS_PER_TICKER + 1)
    + " (6 Requests + 1 Retry-Pfad) - Konstante mitziehen!");
});
console.log(`\nbh-b06-pullyahoo.test.js: ${pass} ok, ${fail} fail`);
  process.exit(fail ? 1 : 0);
}

run();

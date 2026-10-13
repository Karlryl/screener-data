'use strict';
/**
 * BH-141/146/187/188 (+ BH-186) regression — batch w2-wfp, scripts/walk-forward-perf.js.
 *
 * This legacy backtest script is not wired into any CI workflow (BH-140/185
 * confirmed it orphaned), but its exported helpers are still worth pinning
 * since a future rescue/rewire would otherwise silently re-inherit these bugs.
 *
 * BH-188: returnPct() only guarded p0<=0, not p1<=0 — a nonpositive EXIT
 *   close produced a fantasy return like -150% instead of null.
 * BH-146: nearestTradingDay() was backward-first only PER OFFSET, not across
 *   offsets — a nearer forward (look-ahead) date could beat a farther
 *   backward one.
 * BH-186: _priceAtCanonical() only bounded staleness against the (already
 *   benchmark-shifted) canonical date, not the ticker's ORIGINAL target —
 *   up to 12 days of combined drift instead of the intended 7.
 * BH-187: getRegimeAt() looked back 30 days (now capped at
 *   PRICE_MAX_STALE_DAYS=7) and evaluateVintage() resolved it against the
 *   raw snapshot date `asOf` instead of the shifted `entryDate`.
 * BH-141: mode-level output reused the name `n_evaluated` for a different
 *   quantity than the horizon-level `n_evaluated` (renamed to `n_considered`);
 *   the pooled `vintageCount` didn't apply the same on-window (F-BT-008)
 *   filter as every other summary counter; the coverage diagnostic mixed a
 *   weekend-inclusive `presentVintages` with a weekday-only
 *   `expectedBusinessDays`.
 *
 * Run standalone: node tests/scoring/bh-w2-wfp.test.js  (Exit 0/1)
 */
const assert = require('node:assert/strict');
const WF = require('../../scripts/walk-forward-perf.js');

let pass = 0, fail = 0;
function test(name, fn) { try { fn(); pass++; console.log('  ok   ' + name); } catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); } }

// ── BH-188 ────────────────────────────────────────────────────────────────
test('BH-188: returnPct rejects a nonpositive EXIT price (p1<=0) instead of a fantasy return', () => {
  assert.equal(WF.returnPct(10, -5), null);
  assert.equal(WF.returnPct(10, 0), null);
});
test('BH-188 regression guard: normal positive p0/p1 and the pre-existing p0<=0 guard both still work', () => {
  assert.equal(WF.returnPct(100, 110), 10);
  assert.equal(WF.returnPct(0, 100), null);
});

// ── BH-146 ────────────────────────────────────────────────────────────────
test('BH-146: exhausts ALL backward offsets before trying any forward offset', () => {
  // target = Sat 2020-01-11. Backward-1 (Fri 01-10) missing; backward-2
  // (Thu 01-09) present. Forward-1 (Sun 01-12) also present — the nearer
  // forward candidate must NOT win over the farther backward one.
  const map = new Map([['2020-01-09', 90], ['2020-01-12', 99]]);
  assert.equal(WF.nearestTradingDay('2020-01-11', map), '2020-01-09');
});
test('BH-146 regression guard: forward is still used as a last resort when no backward match exists at all', () => {
  const map = new Map([['2020-01-14', 50]]); // only a forward date (+3 offset)
  assert.equal(WF.nearestTradingDay('2020-01-11', map), '2020-01-14');
});

// ── BH-186 ────────────────────────────────────────────────────────────────
test('BH-186: _priceAtCanonical nulls a price whose staleness against the ORIGINAL target exceeds PRICE_MAX_STALE_DAYS, even if within bound of the (already-shifted) canonical date', () => {
  // canonical = 5 days before the original target (a plausible benchmark
  // backward-snap); the only available close is 3 more days further back
  // from canonical (within 7d of canonical) — but 8 days from the ORIGINAL.
  const map = new Map([['2020-01-02', 77]]); // canonical(01-05) - 3
  const price = WF._priceAtCanonical(map, '2020-01-05', '2020-01-10');
  assert.equal(price, null);
});
test('BH-186 regression guard: staleness within bound of the original target still resolves normally', () => {
  const map = new Map([['2020-01-03', 88]]); // canonical(01-05) - 2
  const price = WF._priceAtCanonical(map, '2020-01-05', '2020-01-08'); // 5d from original
  assert.equal(price, 88);
});
test('BH-186 regression guard: omitting originalTargetDate preserves prior canonical-only behavior (lib/forward-returns.js callers)', () => {
  const map = new Map([['2019-12-31', 42]]); // canonical(01-06) - 6, within 7
  assert.equal(WF._priceAtCanonical(map, '2020-01-06'), 42);
});

// ── BH-187 ────────────────────────────────────────────────────────────────
test('BH-187: getRegimeAt caps lookback at PRICE_MAX_STALE_DAYS (7), returns UNKNOWN beyond it', () => {
  const regimes = { '2020-01-01': { regime: 'BULL' } };
  assert.equal(WF.getRegimeAt(regimes, '2020-01-11'), 'UNKNOWN'); // 10 days later
});
test('BH-187 regression guard: within the 7-day cap still resolves the regime', () => {
  const regimes = { '2020-01-01': { regime: 'BULL' } };
  assert.equal(WF.getRegimeAt(regimes, '2020-01-06'), 'BULL'); // 5 days later
});
test('BH-187: evaluateVintage resolves macroRegime at entryDate (post pre-market shift), not the raw snapshot asOf', () => {
  // Pre-close Friday snapshot (18:00 UTC < 21:00 close) -> getEntryDate shifts
  // entry to the next calendar day (Saturday). Regime data differs on the two
  // dates so a wrong lookup key is directly observable.
  const picksFile = { asOf: '2020-01-10T18:00:00Z', evaluatedTickers: [], modes: {} };
  const regimes = { '2020-01-10': { regime: 'BULL' }, '2020-01-11': { regime: 'BEAR' } };
  const out = WF.evaluateVintage(picksFile, {}, regimes);
  assert.equal(out.macroRegime, 'BEAR');
});

// ── BH-141a: mode-level n_considered vs horizon-level n_evaluated ─────────
test('BH-141a: mode-level output uses n_considered, distinct from the real per-horizon n_evaluated', () => {
  const picksFile = { asOf: '2020-01-06T22:00:00Z', evaluatedTickers: [], modes: { test: [{ ticker: 'AAA' }, { ticker: 'BBB' }, { ticker: 'CCC' }] } };
  const out = WF.evaluateVintage(picksFile, {}, null); // empty priceIndex -> no ticker prices resolve
  const modeData = out.modes.test;
  assert.equal(modeData.n_total, 3);
  assert.equal(modeData.n_considered, 3);
  assert.equal(modeData.n_evaluated, undefined); // no longer a misleading duplicate here
  assert.equal(modeData.horizons['7d'].n_evaluated, 0); // real evaluated count, unambiguous
});

// ── BH-141b: computeHorizonSummary.vintageCount respects onWindow ─────────
test('BH-141b: vintageCount excludes off-window vintages, matching totalPicks/medianAlpha gating', () => {
  const key = '84d';
  const vintages = [
    { asOf: '2020-01-01', macroRegime: null, horizons: { [key]: { status: 'ok', horizonActualDays: 84, n_evaluated: 12, alphaVsUniverse: 1, alphaVsFrozenVintage: 1, alphaVsSpy: 1 } } },
    // off-window: horizonActualDays deviates by 10 days (> HORIZON_TOLERANCE_DAYS=3)
    { asOf: '2020-02-01', macroRegime: null, horizons: { [key]: { status: 'ok', horizonActualDays: 74, n_evaluated: 12, alphaVsUniverse: 1, alphaVsFrozenVintage: 1, alphaVsSpy: 1 } } },
  ];
  const summary = WF.computeHorizonSummary(vintages, 84);
  assert.equal(summary.vintageCount, 1);
});

// ── BH-141c: computeCoverageDiagnostic weekday-only present/expected ──────
test('BH-141c: coverage diagnostic counts only weekday vintages on both present and expected sides', () => {
  // 2020-01-04 is a Saturday (stray weekend snapshot); 2020-01-06 is a Monday.
  const diag = WF.computeCoverageDiagnostic(['2020-01-04.json', '2020-01-06.json']);
  assert.equal(diag.presentVintages, 1);
  assert.equal(diag.expectedBusinessDays, 1);
  assert.equal(diag.missingVintages, 0);
});

console.log(`\nbh-w2-wfp.test.js: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);

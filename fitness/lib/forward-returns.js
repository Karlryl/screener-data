'use strict';
/**
 * fitness/lib/forward-returns.js
 * Classify per-ticker forward returns over a canonical benchmark window.
 *
 * Reuse path: walk-forward-perf.js exports cleanly (guarded by require.main===module),
 * so we reuse its primitives directly rather than copying them.
 *
 * PRICE_MAX_STALE_DAYS (=7) is not exported by walk-forward-perf.js, so we
 * define it here as a local constant mirroring the source.
 */

const wf = require('../../scripts/walk-forward-perf.js');
const { _priceAtCanonical, computeBenchmarkReturn, addDaysIso } = wf;

// Mirror of PRICE_MAX_STALE_DAYS from walk-forward-perf.js (not exported)
const PRICE_MAX_STALE_DAYS = 7;

/**
 * classify(priceIndex, ticker, entryDate, exitDate)
 * Returns { status, ret } where:
 *   status ∈ {'ok','no_series','no_entry_price','delisted'}
 *   ret    = fraction (p1/p0 − 1) or null
 *
 * Uses _priceAtCanonical which walks backward up to PRICE_MAX_STALE_DAYS.
 * ret is a FRACTION (not percent).
 */
function classify(priceIndex, ticker, entryDate, exitDate) {
  const map = priceIndex[ticker];
  if (!map) return { status: 'no_series', ret: null };

  const p0 = _priceAtCanonical(map, entryDate);
  if (p0 === null || p0 === undefined) {
    return { status: 'no_entry_price', ret: null };
  }

  // Check if exit price is available: series' last date must be >= exitDate - PRICE_MAX_STALE_DAYS
  // We use _priceAtCanonical which walks backward, so if it returns null the series ended too early.
  const p1 = _priceAtCanonical(map, exitDate);
  if (p1 === null || p1 === undefined) {
    return { status: 'delisted', ret: null };
  }

  if (p0 <= 0) return { status: 'no_entry_price', ret: null };

  return { status: 'ok', ret: (p1 / p0) - 1 };
}

/**
 * resolveWindow(priceIndex, t0Iso, horizonDays)
 * Uses computeBenchmarkReturn to anchor canonical {entryDate, exitDate}.
 * Returns { insufficient: true } if benchmark can't anchor the window
 * (series too short or benchmark not found).
 * Returns { entryDate, exitDate, benchmarkTicker, horizonActualDays, benchmarkInsufficient:false }
 */
function resolveWindow(priceIndex, t0Iso, horizonDays) {
  // t0Iso may be full ISO timestamp; slice to YYYY-MM-DD
  const t0Date = t0Iso.slice(0, 10);
  const result = computeBenchmarkReturn(priceIndex, t0Date, horizonDays);

  // benchmarkInsufficient=true OR entryDate/exitDate null means we can't anchor
  if (result.benchmarkInsufficient || !result.entryDate || !result.exitDate) {
    return { insufficient: true };
  }

  return {
    insufficient: false,
    entryDate: result.entryDate,
    exitDate: result.exitDate,
    benchmarkTicker: result.ticker,
    horizonActualDays: result.horizonActualDays,
  };
}

module.exports = { classify, resolveWindow, PRICE_MAX_STALE_DAYS };

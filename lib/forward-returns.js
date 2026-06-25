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

const wf = require('../scripts/walk-forward-perf.js'); // audit/fix: relocated fitness/lib -> lib/ (Loop A), path depth -1
const { _priceAtCanonical, computeBenchmarkReturn, addDaysIso, businessDaysSince } = wf;

// Mirror of PRICE_MAX_STALE_DAYS from walk-forward-perf.js (not exported)
const PRICE_MAX_STALE_DAYS = 7;

// audit F-A-2026-06-21: tighter business-day staleness threshold at which an exit
// close is flagged as stale (illiquid/suspended foreign names whose last real
// trade is several days before exitDate). Prevents booking a return against a
// silently-stale close as if it were a clean exit.
const EXIT_STALE_FLAG_BUSINESS_DAYS = 2;

// audit F-A-2026-06-21: newest ISO date key present in a single ticker's price
// Map. Keys are 'YYYY-MM-DD' strings, so lexicographic max == chronological max.
// Used to tell "series ran out (name still alive, just untracked)" apart from
// "real gap around exitDate (delisting)".
function _maxDateInMap(map) {
  let max = null;
  if (!map || typeof map.keys !== 'function') return null;
  for (const k of map.keys()) {
    if (typeof k === 'string' && (max === null || k > max)) max = k;
  }
  return max;
}

// audit F-A-2026-06-21: resolve the actual date _priceAtCanonical would use for
// a target (exact match, else nearest earlier within PRICE_MAX_STALE_DAYS).
// Mirrors _priceAtCanonical's backward walk so we can measure the staleness gap
// without changing that shared primitive. Returns the ISO date or null.
function _resolvedDate(map, canonicalDate) {
  if (!map || !canonicalDate || typeof map.has !== 'function') return null;
  if (map.has(canonicalDate)) return canonicalDate;
  for (let i = 1; i <= PRICE_MAX_STALE_DAYS; i++) {
    const d = new Date(canonicalDate + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() - i);
    const key = d.toISOString().slice(0, 10);
    if (map.has(key)) return key;
  }
  return null;
}

/**
 * classify(priceIndex, ticker, entryDate, exitDate)
 * Returns { status, ret, ... } where:
 *   status ∈ {'ok','no_series','no_entry_price','delisted','series_ended'}
 *   ret    = fraction (p1/p0 − 1) or null
 *
 * Status semantics (audit F-A-2026-06-21):
 *   'delisted'     — series HAS coverage at/after exitDate's region (newest
 *                    date >= exitDate) yet no usable close resolves there: a
 *                    real gap, i.e. an actual delisting/suspension. Only this
 *                    case may map to -100% in a conservative variant.
 *   'series_ended' — the ticker's newest date is before the exit stale window
 *                    (newest < exitDate − PRICE_MAX_STALE_DAYS): the data series
 *                    simply ran out while the name is presumably still alive
 *                    (e.g. untracked foreign listing). Caller MUST drop these
 *                    from both the conservative and optimistic variants — they
 *                    are NOT −100% delistings.
 * When status==='ok', also returns:
 *   exitStaleDays  — business days between the resolved exit close and exitDate
 *   exitStale      — true if exitStaleDays > EXIT_STALE_FLAG_BUSINESS_DAYS
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

  const p1 = _priceAtCanonical(map, exitDate);
  if (p1 === null || p1 === undefined) {
    // audit F-A-2026-06-21: prevents alive-but-untracked foreign names being
    // booked as -100% delistings. Distinguish a true delisting (series still has
    // coverage at/after exitDate but a gap there) from mere series-end staleness
    // (the ticker's data simply ran out before the exit window).
    const newest = _maxDateInMap(map);
    if (newest !== null && newest < exitDate) {
      // Series ended before the exit window opened → name is presumably still
      // alive but untracked. Caller drops it from BOTH variants; never -100%.
      return { status: 'series_ended', ret: null, newestDate: newest };
    }
    // Coverage reaches the exit region yet no usable close → genuine delisting.
    return { status: 'delisted', ret: null, newestDate: newest };
  }

  if (p0 <= 0) return { status: 'no_entry_price', ret: null };

  // audit F-A-2026-06-21: a stale-but-within-7-days close is no longer accepted
  // silently as a clean exit. Record the staleness gap and flag exits beyond a
  // tighter threshold so suspension/illiquid names are visible to the caller.
  const exitResolved = _resolvedDate(map, exitDate);
  const exitStaleDays = exitResolved ? businessDaysSince(exitResolved, exitDate) : 0;

  return {
    status: 'ok',
    ret: (p1 / p0) - 1,
    exitStaleDays,
    exitStale: exitStaleDays > EXIT_STALE_FLAG_BUSINESS_DAYS,
  };
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

// audit F-A-2026-06-21: export EXIT_STALE_FLAG_BUSINESS_DAYS so variant callers
// apply the identical exit-staleness threshold without re-deriving it.
module.exports = { classify, resolveWindow, PRICE_MAX_STALE_DAYS, EXIT_STALE_FLAG_BUSINESS_DAYS };

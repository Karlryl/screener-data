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
 * Status semantics (audit F-A-2026-06-21; boundary corrected BH-101 2026-07-19):
 *   'delisted'     — the ticker's newest date key is EXACTLY exitDate (coverage
 *                    reaches the exit target itself) yet no usable close
 *                    resolves there (e.g. a 0-close glitch on the last-ever
 *                    row): a genuine gap/delisting AT the target. Only this
 *                    case may map to -100% in a conservative variant.
 *   'series_ended' — the newest date key is anything OTHER than exitDate,
 *                    whether earlier (series stopped before the exit window —
 *                    M&A/unknown fate, unchanged) or LATER (a close exists
 *                    strictly after exitDate, which is proof the name kept
 *                    trading — the gap right at exitDate is a data hole, not
 *                    a delisting). BH-101: a later close must never be read as
 *                    evidence of delisting. Caller MUST drop these from both
 *                    the conservative and optimistic variants (or shorten to
 *                    newestDate) — they are NOT −100% delistings.
 * When status==='ok', also returns:
 *   resolvedEntryDate/resolvedExitDate — actual date keys _priceAtCanonical
 *                    used for p0/p1 (may differ from entryDate/exitDate when
 *                    the backward stale-window walk fired).
 *   entryStaleDays/entryStale, exitStaleDays/exitStale — business days between
 *                    the resolved close and the requested date, and whether
 *                    that exceeds EXIT_STALE_FLAG_BUSINESS_DAYS. BH-112: entry
 *                    was previously resolved silently with no staleness signal
 *                    at all, unlike exit — mirrored here so callers can drop/
 *                    normalize instead of pooling heterogeneous windows as a
 *                    uniform horizon.
 *   horizonActualDays — calendar days between resolvedEntryDate and
 *                    resolvedExitDate (the EFFECTIVE window actually measured,
 *                    which can differ from the nominal horizon on either end).
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
  // Bug 25: p0<=0 (0-close data glitch) is not a usable entry price. Guard here,
  // BEFORE the p1 resolution, so a name without a valid entry can never be
  // labeled 'delisted'/'series_ended' (only those may map to -100%).
  if (p0 <= 0) return { status: 'no_entry_price', ret: null };

  const p1 = _priceAtCanonical(map, exitDate);
  // Bug 11: p1<=0 (0-close glitch) is treated like a missing close, so the
  // existing delisted/series_ended distinction applies instead of booking a
  // fabricated -100% as status 'ok'.
  if (p1 === null || p1 === undefined || p1 <= 0) {
    // audit F-A-2026-06-21: prevents alive-but-untracked foreign names being
    // booked as -100% delistings. Distinguish a true delisting (series still has
    // coverage at/after exitDate but a gap there) from mere series-end staleness
    // (the ticker's data simply ran out before the exit window).
    const newest = _maxDateInMap(map);
    // BH-101: newest < exitDate (stopped before the window — M&A/unknown
    // fate) and newest > exitDate (a close exists AFTER the target, proof of
    // continued trading) both belong here, NOT in 'delisted'. Only an exact
    // newest === exitDate — coverage reaches the target itself but the close
    // there is unusable — is a genuine gap/delisting.
    if (newest !== null && newest !== exitDate) {
      return { status: 'series_ended', ret: null, newestDate: newest };
    }
    // Coverage reaches the exit region yet no usable close → genuine delisting.
    return { status: 'delisted', ret: null, newestDate: newest };
  }

  // audit F-A-2026-06-21: a stale-but-within-7-days close is no longer accepted
  // silently as a clean exit. Record the staleness gap and flag exits beyond a
  // tighter threshold so suspension/illiquid names are visible to the caller.
  const exitResolved = _resolvedDate(map, exitDate);
  const exitStaleDays = exitResolved ? businessDaysSince(exitResolved, exitDate) : 0;
  // BH-112: mirror the same staleness measurement on the entry side — entry
  // resolution walks backward up to PRICE_MAX_STALE_DAYS exactly like exit,
  // but previously had no staleness signal at all, so a caller pooling
  // windows could not tell a clean t0 entry from one silently backed up
  // several days (or the effective horizon this actually produced).
  const entryResolved = _resolvedDate(map, entryDate);
  const entryStaleDays = entryResolved ? businessDaysSince(entryResolved, entryDate) : 0;
  let horizonActualDays = null;
  if (entryResolved && exitResolved) {
    const dEntry = new Date(entryResolved + 'T00:00:00Z').getTime();
    const dExit = new Date(exitResolved + 'T00:00:00Z').getTime();
    if (Number.isFinite(dEntry) && Number.isFinite(dExit)) {
      horizonActualDays = Math.round((dExit - dEntry) / 86400000);
    }
  }

  return {
    status: 'ok',
    ret: (p1 / p0) - 1,
    resolvedEntryDate: entryResolved,
    resolvedExitDate: exitResolved,
    entryStaleDays,
    entryStale: entryStaleDays > EXIT_STALE_FLAG_BUSINESS_DAYS,
    exitStaleDays,
    exitStale: exitStaleDays > EXIT_STALE_FLAG_BUSINESS_DAYS,
    horizonActualDays,
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

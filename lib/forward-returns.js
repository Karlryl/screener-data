'use strict';
/**
 * fitness/lib/forward-returns.js
 * Classify per-ticker forward returns over a canonical benchmark window.
 *
 * Reuse path: walk-forward-perf.js exports cleanly (guarded by require.main===module),
 * so we reuse its primitives directly rather than copying them.
 */

const wf = require('../scripts/walk-forward-perf.js'); // audit/fix: relocated fitness/lib -> lib/ (Loop A), path depth -1
const { _priceAtCanonical, computeBenchmarkReturn, addDaysIso, businessDaysSince } = wf;

// Grenzen-Audit C-5 (03.08.2026): hier stand bis heute eine handgepflegte KOPIE der Zahl
// ("not exported by walk-forward-perf.js, so we define it here"). walk-forward-perf.js
// exportiert sie jetzt; wer die Schwelle aendert, aendert damit beide Leser auf einmal.
const { PRICE_MAX_STALE_DAYS } = wf;

// audit F-A-2026-06-21: tighter business-day staleness threshold at which an exit
// close is flagged as stale (illiquid/suspended foreign names whose last real
// trade is several days before exitDate). Prevents booking a return against a
// silently-stale close as if it were a clean exit.
const EXIT_STALE_FLAG_BUSINESS_DAYS = 2;

// Court E-20260720-5 (A-konsistent, ersetzt BH-101-0-Handling): ein 0/negativer
// Bar ist KEIN Preis. Dieselbe usable-Definition wie _priceAtCanonical
// (walk-forward-perf.js, Tag 400) — Preis, gemeldetes Datum und newest-Ende
// muessen aus demselben Praedikat kommen, sonst widersprechen sich Return und
// Metadaten (der Bless-Gate-Fund vom 20.07.).
function _usableClose(v) {
  return typeof v === 'number' && Number.isFinite(v) && v > 0;
}

// audit F-A-2026-06-21: newest ISO date key present in a single ticker's price
// Map. Keys are 'YYYY-MM-DD' strings, so lexicographic max == chronological max.
// Used to tell "series ran out (name still alive, just untracked)" apart from
// "real gap around exitDate (delisting)".
// Court E-20260720-5: nur Bars mit usable Close zaehlen (newest_usable) —
// Grund Preprocessing-Invarianz: dieselbe Serie darf vor/nach dem
// Preis-Store-Putz (Tag 387) nicht unterschiedlich gemessen werden.
function _maxDateInMap(map) {
  let max = null;
  if (!map || typeof map.entries !== 'function') return null;
  for (const [k, v] of map.entries()) {
    if (typeof k !== 'string' || !_usableClose(v)) continue;
    if (max === null || k > max) max = k;
  }
  return max;
}

// Court E-20260720-5: Diagnose-Zaehler — wie viele Bars liegen NACH dem letzten
// usable Close (terminale Nichtpositiv-/Glitch-Bars, die die Messung ignoriert).
// Macht die A-konsistente Korrektur im Ergebnis sichtbar statt still.
function _ignoredTerminalBars(map, newestUsable) {
  let n = 0;
  if (!map || typeof map.keys !== 'function') return 0;
  for (const k of map.keys()) {
    if (typeof k !== 'string') continue;
    if (newestUsable === null || k > newestUsable) n++;
  }
  return n;
}

// audit F-A-2026-06-21: resolve the actual date _priceAtCanonical would use for
// a target (exact match, else nearest earlier within PRICE_MAX_STALE_DAYS).
// Mirrors _priceAtCanonical's backward walk so we can measure the staleness gap
// without changing that shared primitive. Returns the ISO date or null.
// Court E-20260720-5: Bars ohne usable Close werden wie fehlende uebersprungen —
// exakt der Skip, den _priceAtCanonical seit Tag 400 macht. Ohne diesen Spiegel
// meldete classify() den Preis von t1-1, aber resolvedExitDate/exitStaleDays/
// horizonActualDays von t1 (Bless-Gate-Fund 1).
function _resolvedDate(map, canonicalDate) {
  if (!map || !canonicalDate || typeof map.has !== 'function') return null;
  if (map.has(canonicalDate) && _usableClose(map.get(canonicalDate))) return canonicalDate;
  for (let i = 1; i <= PRICE_MAX_STALE_DAYS; i++) {
    const d = new Date(canonicalDate + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() - i);
    const key = d.toISOString().slice(0, 10);
    if (map.has(key) && _usableClose(map.get(key))) return key;
  }
  return null;
}

/**
 * classify(priceIndex, ticker, entryDate, exitDate)
 * Returns { status, ret, ... } where:
 *   status ∈ {'ok','no_series','no_entry_price','delisted','series_ended'}
 *   ret    = fraction (p1/p0 − 1) or null
 *
 * Status semantics (audit F-A-2026-06-21; boundary corrected BH-101 2026-07-19;
 * geaendert per Court E-20260720-5, ersetzt das BH-101-0-Handling — Grund
 * Preprocessing-Invarianz: ein 0/negativer Bar ist KEIN Preis und darf die
 * Messung nicht davon abhaengig machen, ob der Preis-Store-Putz (Tag 387)
 * schon lief; Delisting braucht ein unabhaengiges Event-Label, nie close<=0):
 *   'delisted'     — the ticker's newest USABLE date key (close > 0, finite)
 *                    is EXACTLY exitDate yet no usable close resolves there.
 *                    With the usable-based newest this is a defensive branch:
 *                    a terminal glitch-bar no longer counts as coverage, so a
 *                    0-close at the last-ever row is 'series_ended' (last real
 *                    close), NOT a -100% delisting.
 *   'series_ended' — the newest USABLE date key is anything OTHER than
 *                    exitDate: earlier (series' real closes stop before the
 *                    exit window — M&A/unknown fate/terminal glitch-bars) or
 *                    later (a usable close exists strictly after exitDate —
 *                    proof the name kept trading; the gap at exitDate is a
 *                    data hole). newestDate is the newest USABLE date; any
 *                    trailing non-positive bars are counted in
 *                    ignoredTerminalBars instead of shifting newestDate.
 *                    Caller MUST drop or shorten-to-newestDate these — they
 *                    are NOT −100% delistings.
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
    const newest = _maxDateInMap(map); // Court E-20260720-5: newest USABLE date
    const ignoredTerminalBars = _ignoredTerminalBars(map, newest);
    // BH-101 (boundary), geaendert per Court E-20260720-5: newest ist jetzt der
    // letzte USABLE Close. Ein terminaler 0-Bar zaehlt nicht mehr als Coverage
    // am Ziel — die Serie endet real frueher -> 'series_ended' (letzter realer
    // Kurs), nicht 'delisted'/-100 %. Der delisted-Zweig bleibt defensiv fuer
    // newest === exitDate (praktisch unerreichbar, da ein usable Close am
    // exitDate schon als p1 aufgeloest worden waere).
    if (newest !== null && newest !== exitDate) {
      return { status: 'series_ended', ret: null, newestDate: newest, ignoredTerminalBars };
    }
    return { status: 'delisted', ret: null, newestDate: newest, ignoredTerminalBars };
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

  // Court E-20260720-5: Zaehler auch im ok-Fall ausweisen — ein 0-Glitch am
  // Zieltag, der auf t1-1 aufgeloest wurde, ist sonst unsichtbar.
  const newestUsable = _maxDateInMap(map);
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
    ignoredTerminalBars: _ignoredTerminalBars(map, newestUsable),
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

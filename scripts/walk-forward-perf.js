#!/usr/bin/env node
/**
 * Tag 133e: Walk-Forward Performance Scorer
 * =========================================
 * Iteriert über alle `picks-history/YYYY-MM-DD.json` Vintages und berechnet
 * die mediane Forward-Return jeder Vintage gegen die Mediane des gesamten
 * Universums im gleichen Fenster — das "interne Alpha" der Modi.
 *
 * Benchmark-Wahl: median-of-universe (statt SPY). Begründung:
 *   - keine Abhängigkeit von SPY-Verfügbarkeit in prices/history.json
 *   - global-konsistent (universe ist nicht US-only)
 *   - per Tag 102 OOS-Mentalität: das Universum ist der Benchmark.
 *
 * Output:
 *   outputs/walk-forward.json  — Daten für Dashboard
 *   outputs/walk-forward.md    — Lesefreundliche Tabelle
 */
'use strict';
const fs = require('fs');
const path = require('path');
// Tag 232c-28 (audit F-SM-010 HIGH): same atomic-write routing as
// method-effectiveness.js. walk-forward.json/.md outputs are read by
// methodology-report and snapshot-picks's regression check; a truncated
// half-written file would propagate stale alpha numbers downstream.
const { writeFileAtomic } = require('../lib/atomic-write.js');
// Tag 294: price history is sharded — loadAll merges all shards; the F-BT-001
// freshness gate (maxPriceDate below) then runs over the merged store unchanged.
const priceStore = require('../lib/price-history-store.js');

const PICKS_DIR     = path.join(__dirname, '..', 'picks-history');
const PRICES_DIR    = path.join(__dirname, '..', 'prices');
const PRICES_PATH   = path.join(PRICES_DIR, 'history.json');
const REGIME_PATH   = path.join(__dirname, '..', 'outputs', 'macro-regime.json');
const OUT_DIR       = path.join(__dirname, '..', 'outputs');

const HORIZONS_DAYS = [7, 28, 84]; // 1w / 4w / 12w
const MIN_SAMPLES   = 10;          // F-BT-006: minimum picks for meaningful alpha
// F-BT-008: a vintage is excluded from the pooled summary when its actual
// measured window deviates from the nominal horizon by more than this many
// days (backward-snap to a pre-holiday close can shorten e.g. 84d to 79-82d).
// BH-141: hoisted from the per-mode/per-horizon loop to module scope so
// computeHorizonSummary() below can be a pure, independently testable function.
const HORIZON_TOLERANCE_DAYS = 3;
// F-BT-112 / F-BT-004: minimum number of contributing vintages before a
// pooled median alpha is published (else it's a false-confidence 1-2-vintage
// number). BH-141: hoisted alongside HORIZON_TOLERANCE_DAYS for the same reason.
const MIN_VINTAGES_UNIVERSE = 4;
// F-BT-012: warn when more than this fraction of expected business-day
// picks-history vintages are missing from the corpus (failed crons, partial
// backfills). BH-141: hoisted so computeCoverageDiagnostic() below is pure.
const COVERAGE_MISSING_THRESHOLD = 0.20; // 20%

// F-BT-001 (fail-loud freshness): if the most recent price in prices/history.json
// is older than this many US business days, the price pull is stale and every
// forward-return computed against it is silently wrong (entry/exit prices missing
// at the horizon → cohorts shrink or anchor to old closes). Abort loud instead.
const MAX_PRICE_STALENESS_BUSINESS_DAYS = 3;
// F-BT-002 (fail-loud benchmark length): the benchmark series anchors the canonical
// entry/exit dates for EVERY per-vintage return. If it is shorter than the horizon
// (in trading days) plus this buffer, anchoring to it produces a 2-3-point alpha.
// Refuse to anchor to a too-short benchmark series.
const BENCHMARK_MIN_BUFFER_TRADING_DAYS = 20;
// ~5 trading days per 7 calendar days; used to convert a calendar-day horizon to an
// approximate trading-day length for the benchmark-length assertion.
const TRADING_DAYS_PER_CALENDAR_DAY = 5 / 7;

// F-BT-001 helper: most recent (max) ISO date present across the whole raw history.
// Operates on the raw history object ({ ticker: [{date, close}, ...] }), returns
// 'YYYY-MM-DD' or null if no dated entries exist.
function maxPriceDate(history) {
  let max = null;
  for (const entries of Object.values(history || {})) {
    if (!Array.isArray(entries)) continue;
    for (const e of entries) {
      // Bless-Gate-P2 (2. Runde, 20.07., Court E-20260720-5): ein Bar ohne
      // usable Close ist kein Frische-Beleg — sonst meldet derselbe Store vor
      // dem Putz "frisch" und danach "stale" (Preprocessing-Invarianz).
      if (!e || typeof e.date !== 'string' || !_usableClose(e.close)) continue;
      if (max === null || e.date > max) max = e.date;
    }
  }
  return max;
}

// F-BT-001 helper: count US business days (Mon-Fri; holidays not modelled) strictly
// between two ISO dates, exclusive of the start. Used to measure price staleness.
function businessDaysSince(fromIso, toIso) {
  const from = new Date(fromIso + 'T00:00:00Z');
  const to = new Date(toIso + 'T00:00:00Z');
  if (isNaN(from.getTime()) || isNaN(to.getTime()) || to <= from) return 0;
  let count = 0;
  const cur = new Date(from);
  cur.setUTCDate(cur.getUTCDate() + 1);
  while (cur <= to) {
    const dow = cur.getUTCDay();
    if (dow !== 0 && dow !== 6) count++;
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return count;
}

function loadJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return null; }
}

function median(values) {
  const sorted = values.filter(v => Number.isFinite(v)).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const m = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2;
}

// Tag 134: max-staleness guard. A ticker that hasn't traded in 60+ days (suspension,
// delisting, illiquid foreign exchange) was silently using a stale price as p0,
// pretending the resulting return was signal. Now: drop the lookup if the chosen
// entry is older than PRICE_MAX_STALE_DAYS calendar days from targetDate.
const PRICE_MAX_STALE_DAYS = 7;
function _daysBetween(isoA, isoB) {
  return Math.abs(new Date(isoA + 'T00:00:00Z').getTime() - new Date(isoB + 'T00:00:00Z').getTime()) / 86400000;
}

// F-PF-003: Build per-ticker price Maps before the main loop (O(1) lookup vs O(N) scan).
// Called once in main(); the resulting index is passed down.
function buildPriceIndex(history) {
  const index = {};
  for (const [ticker, entries] of Object.entries(history)) {
    if (!Array.isArray(entries)) continue;
    index[ticker] = new Map(entries.map(e => [e.date, e.close]));
  }
  return index;
}

// F-PF-003: Map-based O(1) lookup.  Falls back to the nearest earlier date within
// PRICE_MAX_STALE_DAYS so the staleness guard is still enforced.
// Backward-compat: if the caller passes a raw history object (value is an Array),
// delegate to priceAtLegacy so existing tests and method-effectiveness callers keep working.
// audit F-A-2026-06-22: @internal — dead production path. Repo-wide grep shows NO
// production caller (walk-forward's main loop, method-effectiveness.js and
// fitness/forward-returns.js all resolve prices via _priceAtCanonical /
// nearestTradingDay). Only tag28-tests.js still calls WF.priceAt, so the export is
// kept solely to satisfy that test — do not rely on it from new code; the canonical
// resolution path is _priceAtCanonical. Failure mode prevented by this note: a future
// caller wiring up a SECOND, divergent price-resolution path that silently disagrees
// with the canonical staleness gate.
function priceAt(priceIndex, ticker, targetDate) {
  const entry = priceIndex[ticker];
  // Backward-compat: raw history has Arrays; new index has Maps
  if (Array.isArray(entry)) return priceAtLegacy(priceIndex, ticker, targetDate);
  const map = entry;
  if (!map || map.size === 0) return null;
  // Exact hit (common case)
  if (map.has(targetDate)) return map.get(targetDate);
  // Walk back up to PRICE_MAX_STALE_DAYS to find nearest earlier entry
  for (let i = 1; i <= PRICE_MAX_STALE_DAYS; i++) {
    const d = new Date(targetDate + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() - i);
    const key = d.toISOString().slice(0, 10);
    if (map.has(key)) return map.get(key);
  }
  return null;
}

// Legacy wrapper kept for callers that pass the raw history object (e.g. method-effectiveness
// which imports this module). It builds a per-call mini-index — not fast, but correct.
// Those callers should migrate to buildPriceIndex + priceAt(index, ...) for performance.
// audit F-A-2026-06-22: @internal — reachable in production only via priceAt's
// backward-compat delegation, and priceAt itself has no production caller (see note
// above). Effectively test-only today; kept exported for tag28-tests.js parity.
function priceAtLegacy(history, ticker, targetDate) {
  const series = history[ticker];
  if (!Array.isArray(series) || series.length === 0) return null;
  let chosen = null;
  for (const entry of series) {
    if (!entry || !entry.date) continue;
    if (entry.date > targetDate) break;
    chosen = entry;
  }
  if (!chosen) return null;
  if (_daysBetween(chosen.date, targetDate) > PRICE_MAX_STALE_DAYS) return null;
  return chosen.close;
}

// BH-188: guard p1<=0 too (mirror lib/forward-returns.js's classify(), the
// sanctioned live path). Previously only p0<=0 was rejected, so a nonpositive
// EXIT close (bad-tick 0/negative rows exist in the store — see BH-051) fell
// through to (p1-p0)/p0*100 and produced a fantasy return like -150% instead
// of being treated as unusable data.
function returnPct(p0, p1) {
  if (!Number.isFinite(p0) || !Number.isFinite(p1) || p0 <= 0 || p1 <= 0) return null;
  return (p1 - p0) / p0 * 100;
}

// Court E-20260720-5 (A-konsistent) + Bless-Gate-P2 20.07.: ein 0/negativer Bar
// ist KEIN Preis — dasselbe usable-Praedikat gilt fuer ALLE Aufloesungspfade
// (_priceAtCanonical UND nearestTradingDay-Fallback). Vorher divergierten die
// Pfade: kanonisch wurde der 0-Bar uebersprungen (Nachbar gebucht), im Fallback
// droppte `map.get(...) || null` denselben Ticker aus der Kohorte — Median/
// Alpha hingen damit an Benchmark-Verfuegbarkeit und Preprocessing-Stand.
function _usableClose(v) {
  return typeof v === 'number' && Number.isFinite(v) && v > 0;
}

function addDaysIso(isoDate, days) {
  const d = new Date(isoDate + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// F-BT-001: When the snapshot asOf timestamp is before US market close (~21:00 UTC),
// the screener ran before the market opened. Use the next calendar day as entry date
// so we don't include the intraday move the screener couldn't have transacted at.
function getEntryDate(asOf) {
  const d = new Date(asOf);
  if (isNaN(d.getTime())) return asOf.slice(0, 10);
  // F-BT-007: always use the conservative 21:00 UTC close threshold.
  // The previous DST branch (20:00 UTC for an approximate Mar-Nov EDT window)
  // misclassified the DST changeover weeks (early-Mar / late-Nov, when the US
  // is actually still on EST / already back on EST) as EDT. That could treat a
  // pre-close snapshot as post-close and select the SAME calendar day as entry
  // — a same-day look-ahead. 21:00 UTC is the EST close and is never earlier
  // than the true close, so it can only ever defer entry to the next day
  // (conservative, no look-ahead). The cost is at most a 1-day entry delay for
  // genuine post-close EDT snapshots between 20:00-21:00 UTC.
  const marketCloseUTC = 21;
  if (d.getUTCHours() < marketCloseUTC) {
    // Pre-market / intraday snapshot: use next day's price
    const next = new Date(d);
    next.setUTCDate(next.getUTCDate() + 1);
    return next.toISOString().slice(0, 10);
  }
  return asOf.slice(0, 10);
}

// F-BT-005: After computing a calendar-day target date, find the nearest available
// trading day in the price map. Returns null if no price exists within 5 days.
//
// Tag 231a-1 (audit HIGH fix): scan BACKWARD before forward.
// The previous alternating forward-first scan introduced look-ahead bias for
// ENTRY dates: when `targetDate` was already T+1 (the post-screener entry,
// per `getEntryDate`), snapping forward another day pulled in T+2 returns,
// leaking up to one additional day of future price movement into the entry
// price. Worse, the same function is used for the BENCHMARK lookup — and
// SPY trades every business day while thinly-traded picks may not — so the
// pick and benchmark could resolve to different dates (pick=Friday backward
// fallback, bench=Monday forward fallback for a Sunday target). That window
// mismatch silently inflated/deflated alpha asymmetrically across vintages.
// Backward-first is conservative: entry uses a known prior close, exit uses
// the latest available close at or before the horizon — both observable at
// the time the trade would have been placed/closed.
// BH-146: exhaust ALL backward offsets before trying ANY forward offset.
// The previous per-offset interleaving (backward-1, forward-1, backward-2,
// forward-2, ...) let a NEARER forward (look-ahead) date win over a FARTHER
// backward date whenever backward missed at an early offset — e.g. a 1-day
// gap on the backward side let a forward match at the same offset return
// before backward-2..5 were ever checked. That contradicts the documented
// "backward-first (no look-ahead)" guarantee. Forward is now a last-resort
// fallback used only when no backward match exists within the whole window.
// Court E-20260720-5 + Bless-Gate-P2: Tage mit unusable Close (0/negativ)
// zaehlen nicht als Trading Day — weitersuchen statt zurueckgeben, damit der
// Fallback-Pfad denselben Nachbarkurs findet wie _priceAtCanonical (BH-146-
// Reihenfolge backward-first bleibt unveraendert).
function nearestTradingDay(targetDate, priceMap) {
  if (!priceMap) return null;
  if (priceMap.has(targetDate) && _usableClose(priceMap.get(targetDate))) return targetDate;
  for (let offset = 1; offset <= 5; offset++) {
    const dBwd = new Date(targetDate + 'T00:00:00Z');
    dBwd.setUTCDate(dBwd.getUTCDate() - offset);
    const keyBwd = dBwd.toISOString().slice(0, 10);
    if (priceMap.has(keyBwd) && _usableClose(priceMap.get(keyBwd))) return keyBwd;
  }
  for (let offset = 1; offset <= 5; offset++) {
    const dFwd = new Date(targetDate + 'T00:00:00Z');
    dFwd.setUTCDate(dFwd.getUTCDate() + offset);
    const keyFwd = dFwd.toISOString().slice(0, 10);
    if (priceMap.has(keyFwd) && _usableClose(priceMap.get(keyFwd))) return keyFwd;
  }
  return null;
}

function listVintages() {
  if (!fs.existsSync(PICKS_DIR)) return [];
  return fs.readdirSync(PICKS_DIR)
    .filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort();
}

// F-BT-012: count US business days (Mon-Fri, holidays not modelled) inclusive
// between two ISO dates. Used to estimate how many picks-history vintages we
// *expected* to find versus how many are actually present, so a silent gap in
// the snapshot pipeline (cron failures, partial backfills) surfaces as a
// coverage diagnostic instead of quietly shrinking the backtest corpus.
function businessDaysBetween(startIso, endIso) {
  const start = new Date(startIso + 'T00:00:00Z');
  const end = new Date(endIso + 'T00:00:00Z');
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || end < start) return 0;
  let count = 0;
  const cur = new Date(start);
  while (cur <= end) {
    const dow = cur.getUTCDay(); // 0=Sun, 6=Sat
    if (dow !== 0 && dow !== 6) count++;
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return count;
}

// F-BT-012: picks-history coverage diagnostic. Compare the number of business
// days spanned by the corpus against the number of vintages actually present,
// and warn when more than COVERAGE_MISSING_THRESHOLD of expected vintages are
// missing — a silent gap (failed crons, partial backfills) otherwise just
// shrinks the backtest corpus without any signal.
// `vintageFilenames` are the raw picks-history filenames (YYYY-MM-DD.json),
// sorted ascending, as returned by listVintages().
// BH-141: extracted from main() (a) so the counter-consistency fix below is
// directly testable and (b) to fix the mixed denominator/numerator bug:
// `presentVintages` previously counted every file found (vintages.length),
// including any that happen to land on a Sat/Sun, against a Mon-Fri-only
// `expectedBusinessDays` — a weekend-inclusive numerator over a weekday-only
// denominator understated (or Math.max-clamped away) the true coverage gap.
// Both sides now count weekday vintages only.
function computeCoverageDiagnostic(vintageFilenames) {
  if (!vintageFilenames || vintageFilenames.length === 0) return null;
  const firstDate = vintageFilenames[0].slice(0, 10);
  const lastDate = vintageFilenames[vintageFilenames.length - 1].slice(0, 10);
  const expectedBusinessDays = businessDaysBetween(firstDate, lastDate);
  const isWeekday = v => {
    const dow = new Date(v.slice(0, 10) + 'T00:00:00Z').getUTCDay();
    return dow !== 0 && dow !== 6;
  };
  const presentVintages = vintageFilenames.filter(isWeekday).length;
  const missingVintages = Math.max(0, expectedBusinessDays - presentVintages);
  const missingPct = expectedBusinessDays > 0
    ? Math.round((missingVintages / expectedBusinessDays) * 1000) / 1000
    : 0;
  const belowThreshold = missingPct > COVERAGE_MISSING_THRESHOLD;
  return {
    firstVintage: firstDate,
    lastVintage: lastDate,
    expectedBusinessDays,
    presentVintages,
    missingVintages,
    missingPct,
    missingThreshold: COVERAGE_MISSING_THRESHOLD,
    coverageWarning: belowThreshold
      ? ('picks-history coverage gap: ' + missingVintages + ' of ' + expectedBusinessDays
         + ' expected business-day vintages missing (' + Math.round(missingPct * 100)
         + '% > ' + Math.round(COVERAGE_MISSING_THRESHOLD * 100) + '% threshold)')
      : undefined
  };
}

// Tag 138: survivor-bias fix. When the picks file has evaluatedTickers[], use that
// list (stocks that were actually in the universe at vintage time) instead of all
// tickers in prices/history.json (which includes stocks added later → upward bias).
// F-BT-003: When evaluatedTickers is missing, log a warning and return null for
// alphaVsUniverse rather than falling back to today's survivor-biased universe.
// Tag 231a-2 (audit HIGH fix): helper that prefers the caller-supplied canonical
// date if the ticker's map has it; otherwise walks backward up to
// PRICE_MAX_STALE_DAYS to find a usable close. Never scans forward (no
// look-ahead). Returns null if no usable price exists — caller drops the
// ticker from the cohort.
// F-BT-115: removed dead `fallbackTargetDate` parameter — no callsite ever passed it.
// BH-186: optional `originalTargetDate` — the ticker's OWN pre-benchmark-snap
// target (asOfDate/futureDate), not the benchmark-anchored `canonicalDate`.
// computeBenchmarkReturn's nearestTradingDay() can already have shifted
// canonicalDate up to 5 days from the original target; this function then
// additionally walked up to PRICE_MAX_STALE_DAYS (7) further back from THAT
// shifted date — up to 12 days of total staleness against the real target,
// silently exceeding the intended PRICE_MAX_STALE_DAYS bound. When the caller
// supplies originalTargetDate, the resolved price date is checked against it
// (not just against canonicalDate) and nulled out if the combined drift is
// too large. Optional + defaults to off so lib/forward-returns.js's classify()
// (which does its own staleness accounting) keeps its exact prior behavior.
function _priceAtCanonical(map, canonicalDate, originalTargetDate) {
  if (!map || !canonicalDate) return null;
  const tooStale = (resolvedDate) => originalTargetDate
    && _daysBetween(resolvedDate, originalTargetDate) > PRICE_MAX_STALE_DAYS;
  // audit/fix (R-Gate Dry Round 2026-07-20, Fund 2): ein 0/negativer Bar ist KEIN
  // brauchbarer Kurs. Vorher gab map.has(key) ihn ungeprüft zurück -> ein 0-Glitch
  // GENAU am Zieltag maskierte einen gültigen Kurs an t-1 im 7-Tage-Lookback: p1=0
  // -> p1<=0-Pfad in forward-returns.classify -> bei newest===exitDate ein falsches
  // -100%-Delisting (bzw. no_entry_price am Einstieg). Jetzt: nicht-positive Bars wie
  // fehlende behandeln und weitersuchen. Bleibt der Lookback leer -> null (korrekt
  // delisted/series_ended). Geteiltes Primitiv (auch computeUniverseMedianReturn).
  const usable = _usableClose; // Court E-20260720-5: ein Praedikat fuer ALLE Pfade
  if (map.has(canonicalDate) && usable(map.get(canonicalDate))) {
    return tooStale(canonicalDate) ? null : map.get(canonicalDate);
  }
  // Walk backward from canonicalDate to find a usable (positive) close within stale window
  for (let i = 1; i <= PRICE_MAX_STALE_DAYS; i++) {
    const d = new Date(canonicalDate + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() - i);
    const key = d.toISOString().slice(0, 10);
    if (map.has(key) && usable(map.get(key))) return tooStale(key) ? null : map.get(key);
  }
  return null;
}

function computeUniverseMedianReturn(priceIndex, asOfDate, horizonDays, evaluatedTickers, canonicalDates) {
  if (!evaluatedTickers || evaluatedTickers.length === 0) {
    // F-BT-003: no evaluatedTickers in this vintage — cannot compute unbiased universe median
    return { median: null, n: 0, survivorBiasCorrected: false, missingEvaluatedTickers: true };
  }
  // F-BT-005: use a reference ticker's map to resolve trading days; fall back to plain addDays
  const futureDate = addDaysIso(asOfDate, horizonDays);
  const returns = [];
  for (const ticker of evaluatedTickers) {
    const map = priceIndex[ticker];
    if (!map) continue;
    let p0, p1;
    // Tag 231a-2 (audit HIGH fix): when canonical dates are provided (benchmark-anchored),
    // use them so every ticker is measured over the same calendar window.
    if (canonicalDates && canonicalDates.entryDate && canonicalDates.exitDate) {
      // BH-186: bound total staleness against the ticker's OWN target dates,
      // not just the (already up-to-5-days-shifted) canonical dates.
      p0 = _priceAtCanonical(map, canonicalDates.entryDate, asOfDate);
      p1 = _priceAtCanonical(map, canonicalDates.exitDate, futureDate);
    } else {
      // Bless-Gate-P2 (2. Runde, 20.07.): derselbe Resolver wie der kanonische
      // Pfad — vorher suchte nearestTradingDay nur 5 Tage zurueck (+5 vorwaerts,
      // Look-ahead!) vs. 7 Tage backward-only in _priceAtCanonical; ein usable
      // Close an t-6/t-7 machte Median/Kohorte damit weiter benchmark-abhaengig.
      p0 = _priceAtCanonical(map, asOfDate, asOfDate);
      p1 = _priceAtCanonical(map, futureDate, futureDate);
    }
    const r = returnPct(p0, p1);
    if (r != null) returns.push(r);
  }
  return { median: median(returns), n: returns.length, survivorBiasCorrected: true };
}

// Tag 134 — Phase 3.2: frozen-vintage benchmark.
// Computes universe-median only over tickers that already appeared in the
// vintage's picks file (any mode). This eliminates the "today's-survivor"
// upward bias of computeUniverseMedianReturn — at the cost of a smaller
// benchmark sample. Both are reported so the reader can see the gap.
function computeFrozenVintageMedianReturn(priceIndex, vintagePicks, asOfDate, horizonDays, canonicalDates) {
  const futureDate = addDaysIso(asOfDate, horizonDays);
  const tickersAtVintage = new Set();
  for (const arr of Object.values(vintagePicks.modes || {})) {
    if (!Array.isArray(arr)) continue;
    for (const p of arr) if (p && p.ticker) tickersAtVintage.add(p.ticker);
  }
  const returns = [];
  for (const ticker of tickersAtVintage) {
    const map = priceIndex[ticker];
    if (!map) continue;
    let p0, p1;
    // Tag 231a-2 (audit HIGH fix): canonical-date anchoring when provided.
    if (canonicalDates && canonicalDates.entryDate && canonicalDates.exitDate) {
      // BH-186: bound total staleness against the original per-ticker target.
      p0 = _priceAtCanonical(map, canonicalDates.entryDate, asOfDate);
      p1 = _priceAtCanonical(map, canonicalDates.exitDate, futureDate);
    } else {
      // Bless-Gate-P2 (2. Runde, 20.07.): einheitlicher Resolver, s. o.
      p0 = _priceAtCanonical(map, asOfDate, asOfDate);
      p1 = _priceAtCanonical(map, futureDate, futureDate);
    }
    const r = returnPct(p0, p1);
    if (r != null) returns.push(r);
  }
  return { median: median(returns), n: returns.length };
}

// Tag 134 — Phase 3.3: SPY/benchmark return.
// F-BT-002: Falls back to QQQ if SPY is absent; emits null + warning if both are absent.
// Tag 231a-2 (audit HIGH fix): also returns the canonical entry/exit date pair
// the benchmark used. Callers thread these into pick/universe/frozen-vintage
// lookups so all per-vintage returns are measured over the SAME calendar
// window. Previously each ticker snapped to its own nearest trading day
// (using its own sparse price map), which meant the pick return was measured
// over (Fri, Fri+28d) while the benchmark was measured over (Mon, Mon+28d) —
// silently injecting up to ±2 days of price-movement noise into every alpha.
function computeBenchmarkReturn(priceIndex, asOfDate, horizonDays) {
  const candidates = ['SPY', 'QQQ', 'IWM'];
  let benchmarkTicker = null;
  for (const t of candidates) {
    if (priceIndex[t]) { benchmarkTicker = t; break; }
  }
  if (!benchmarkTicker) {
    console.warn('[walk-forward-perf] WARNING: SPY/QQQ/IWM not in price history — alphaVsBenchmark will be null. Run pull-historical-prices.js to fix.');
    return { ticker: null, ret: null, entryDate: null, exitDate: null };
  }
  const map = priceIndex[benchmarkTicker];
  // F-BT-002 (fail-loud benchmark length): the canonical entry/exit dates returned
  // here anchor every per-vintage return. If the benchmark series is shorter than the
  // horizon (in trading days) + buffer, anchoring to it would produce a 2-3-point
  // alpha. Do NOT anchor: return entryDate/exitDate=null so the caller falls back to
  // the existing per-ticker nearestTradingDay path, flag benchmarkInsufficient, warn.
  const requiredLen = Math.ceil(horizonDays * TRADING_DAYS_PER_CALENDAR_DAY) + BENCHMARK_MIN_BUFFER_TRADING_DAYS;
  if (map.size < requiredLen) {
    console.warn('::warning::[walk-forward-perf] F-BT-002: benchmark ' + benchmarkTicker
      + ' series too short (' + map.size + ' points < required ' + requiredLen
      + ' for horizon ' + horizonDays + 'd) — NOT anchoring canonical dates; falling back to per-ticker path.');
    return { ticker: benchmarkTicker, ret: null, entryDate: null, exitDate: null, benchmarkInsufficient: true };
  }
  // F-BT-005: snap to nearest trading day (Tag 231a-1: backward-first, no look-ahead)
  const entryDate = nearestTradingDay(asOfDate, map) || asOfDate;
  const futureDate = addDaysIso(asOfDate, horizonDays);
  const exitDate   = nearestTradingDay(futureDate, map) || futureDate;
  const p0 = map.get(entryDate) || null;
  const p1 = map.get(exitDate)  || null;
  // Tag 232c-27 (audit F-BT-004 HIGH): emit horizonActualDays so cross-
  // vintage alpha aggregation can normalize windows. Pre-fix the 84d
  // horizon could silently shorten to 79-82d when backward-snap landed
  // on the nearest pre-holiday close (US Memorial Day, Labor Day, etc.).
  // Comparing 79d returns vs 84d returns across vintages biased the
  // aggregate alpha. Now the actual day-count is observable to callers.
  let horizonActualDays = null;
  if (entryDate && exitDate) {
    const dEntry = new Date(entryDate + 'T00:00:00Z').getTime();
    const dExit  = new Date(exitDate + 'T00:00:00Z').getTime();
    if (Number.isFinite(dEntry) && Number.isFinite(dExit) && dExit >= dEntry) {
      horizonActualDays = Math.round((dExit - dEntry) / 86400000);
    }
  }
  return { ticker: benchmarkTicker, ret: returnPct(p0, p1), entryDate, exitDate, horizonActualDays, horizonNominalDays: horizonDays };
}

// Tag 139: load macro-regime lookup
function loadMacroRegimes() {
  const raw = loadJson(REGIME_PATH);
  if (!raw || !raw.regimes) return null;
  return raw.regimes; // { "YYYY-MM-DD": { regime, price, sma200 } }
}

// audit/fix: schema-tolerant regime read. macro-regime.json's documented legacy schema is a bare
// string ({date: "BULL"}); the current writer emits {date: {regime, price, sma200}}. Reading .regime
// off a legacy string silently yields undefined for dates that DO exist. Unwrap either shape.
function _regimeOf(v) { return (v && typeof v === 'object') ? v.regime : v; }
// Tag 139 / F-BT-010: find closest regime entry for a given date.
// Returns 'UNKNOWN' (not null) if no regime found.
// BH-187: lookback capped at PRICE_MAX_STALE_DAYS (7), reusing the same
// staleness contract already applied to price lookups in this file, instead
// of the previous 30-day window — a regime label 30 days stale at a genuine
// regime change (BULL->BEAR) mislabels every vintage in between.
function getRegimeAt(regimes, isoDate) {
  if (!regimes) return null;
  if (regimes[isoDate]) return _regimeOf(regimes[isoDate]);
  for (let i = 1; i <= PRICE_MAX_STALE_DAYS; i++) {
    const d = new Date(isoDate + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() - i);
    const key = d.toISOString().slice(0, 10);
    if (regimes[key]) return _regimeOf(regimes[key]);
  }
  console.warn('[walk-forward-perf] WARNING: No macro regime found within ' + PRICE_MAX_STALE_DAYS + ' days of ' + isoDate + ' — returning UNKNOWN');
  return 'UNKNOWN';
}

function evaluateVintage(picksFile, priceIndex, regimes) {
  const asOfRaw = picksFile.asOf || '';
  const asOf = asOfRaw.slice(0, 10);
  if (!asOf) return null;

  // F-BT-001: use next-day entry price for pre-market snapshots
  const entryDate = getEntryDate(asOfRaw);
  if (entryDate !== asOf) {
    // Log when we shift the entry date (once per vintage to avoid log spam)
    // console.log('[walk-forward-perf] ' + asOf + ': pre-market snapshot, using entry date ' + entryDate);
  }

  const today = new Date().toISOString().slice(0, 10);
  // BH-187: resolve regime at the actual entry date (post pre-market shift),
  // not the raw snapshot date — asOf and entryDate differ by ~1 day only when
  // getEntryDate() pushed a pre-close snapshot to the next day.
  const macroRegime = getRegimeAt(regimes, entryDate);  // Tag 139
  const out = { asOf, macroRegime, modes: {} };

  // F-BT-003: warn when evaluatedTickers is absent (no survivor-bias correction possible)
  if (!picksFile.evaluatedTickers || picksFile.evaluatedTickers.length === 0) {
    console.warn('[walk-forward-perf] WARNING: vintage ' + asOf + ' has no evaluatedTickers — alphaVsUniverse will be null (survivor-bias uncorrectable)');
  }

  // F-PF-003: hoist universe-median computation outside the per-mode loop (same for all modes)
  const univResultsByHorizon = {};
  // Tag 223c (audit F-222a-7 MEDIUM fix): hoist frozen-vintage + benchmark
  // computations too. Both depend only on (picksFile, entryDate, days) — not
  // on the mode. F-PF-003 hoisted universeMed but missed these two. At 5 modes
  // × 3 horizons that's 15 calls per vintage, only 3 are unique. At 19k corpus
  // × 365 vintages: ~5.5k redundant calls saved.
  const frozenByHorizon = {};
  const benchByHorizon = {};
  // Tag 231a-2 (audit HIGH fix): canonical date pair per horizon, anchored to
  // the benchmark. ALL per-vintage return measurements (pick / universe /
  // frozen-vintage / benchmark) now share this entry/exit pair so alpha is a
  // like-for-like comparison. Previously each ticker independently snapped to
  // its own nearest trading day, which made the pick window and benchmark
  // window drift by up to ±2 days for vintages whose asOf landed on a
  // weekend or holiday — silently biasing alpha sign and magnitude.
  const canonicalDatesByHorizon = {};
  for (const days of HORIZONS_DAYS) {
    const bench = computeBenchmarkReturn(priceIndex, entryDate, days);
    benchByHorizon[days] = bench;
    const canonical = (bench.entryDate && bench.exitDate)
      ? { entryDate: bench.entryDate, exitDate: bench.exitDate }
      : null;
    canonicalDatesByHorizon[days] = canonical;
    univResultsByHorizon[days] = computeUniverseMedianReturn(priceIndex, entryDate, days, picksFile.evaluatedTickers, canonical);
    frozenByHorizon[days] = computeFrozenVintageMedianReturn(priceIndex, picksFile, entryDate, days, canonical);
  }

  for (const [mode, allPicks] of Object.entries(picksFile.modes || {})) {
    if (!Array.isArray(allPicks)) continue;
    // F-BT-012: track truncation explicitly
    const picks = allPicks.slice(0, 100);
    const truncated = picks.length < allPicks.length;

    const horizonResults = {};
    for (const days of HORIZONS_DAYS) {
      const futureDate = addDaysIso(entryDate, days);  // F-BT-001: use entryDate not asOf
      if (futureDate > today) {
        horizonResults[days + 'd'] = { status: 'too-early', n_total: allPicks.length, n_evaluated: 0, truncated };
        continue;
      }
      const pickReturns = [];
      // Tag 231a-2 (audit HIGH fix): use the benchmark's canonical entry/exit
      // dates so pick returns are measured over the SAME calendar window as
      // alphaVsBenchmark. _priceAtCanonical falls back backward (no look-ahead)
      // up to PRICE_MAX_STALE_DAYS — so the existing staleness gate is enforced
      // by construction rather than by post-hoc filtering. When canonical
      // dates aren't available (no benchmark in priceIndex), the legacy
      // per-ticker nearestTradingDay path is used (preserving prior behavior).
      const canonical = canonicalDatesByHorizon[days];
      for (const p of picks) {
        const t = p.ticker;
        const map = priceIndex[t];
        if (!map) continue;
        let p0, p1;
        if (canonical) {
          // BH-186: bound total staleness against the ticker's own
          // (pre-benchmark-snap) target dates, not just the canonical ones.
          p0 = _priceAtCanonical(map, canonical.entryDate, entryDate);
          p1 = _priceAtCanonical(map, canonical.exitDate, futureDate);
        } else {
          // Legacy path: no benchmark available.
          // Bless-Gate-P2 (2. Runde, 20.07.): einheitlicher Resolver — die
          // Tag-216b-Staleness-Symmetrie steckt jetzt im tooStale-Bound von
          // _priceAtCanonical (originalTargetDate = Zieltag selbst).
          p0 = _priceAtCanonical(map, entryDate, entryDate);
          p1 = _priceAtCanonical(map, futureDate, futureDate);
        }
        const r = returnPct(p0, p1);
        if (r != null) pickReturns.push(r);
      }
      // F-PF-003: use pre-computed universe result
      const univResult = univResultsByHorizon[days];
      const universeMed = univResult.median;
      // Tag 223c (audit F-222a-7 MEDIUM fix): reuse hoisted per-horizon
      // computations instead of recomputing them inside the per-mode loop.
      const frozenVintage = frozenByHorizon[days];
      const benchResult = benchByHorizon[days];
      const pickMed = median(pickReturns);
      const n = pickReturns.length;

      // F-BT-006: suppress alpha when n < MIN_SAMPLES
      // audit F-A-2026-06-22: prevents publishing alpha against a thin benchmark leg.
      // Previously every alpha gated ONLY on the pick count `n`, so a universe or
      // frozen-vintage median computed from <MIN_SAMPLES tickers could still be
      // subtracted to form a headline alpha. Gate each alpha on BOTH legs.
      const alphaVsUniverse = (n >= MIN_SAMPLES && univResult.n >= MIN_SAMPLES && pickMed != null && universeMed != null)
        ? pickMed - universeMed : null;
      const alphaVsFrozenVintage = (n >= MIN_SAMPLES && frozenVintage.n >= MIN_SAMPLES && pickMed != null && frozenVintage.median != null)
        ? pickMed - frozenVintage.median : null;
      const benchRet = benchResult.ret;
      // audit F-A-2026-06-22: benchmark is a single instrument (SPY/QQQ/IWM), so its
      // 'n samples' is meaningless — `n` here is the pick count only, by design.
      const alphaVsBenchmark = (n >= MIN_SAMPLES && pickMed != null && benchRet != null)
        ? pickMed - benchRet : null;

      // F-BT-003: null alphaVsUniverse when evaluatedTickers was absent
      const finalAlphaVsUniverse = univResult.missingEvaluatedTickers ? null : alphaVsUniverse;

      horizonResults[days + 'd'] = {
        status: 'ok',
        // F-BT-012: expose truncation info
        n_total: allPicks.length,
        n_evaluated: n,
        truncated,
        coverage: picks.length > 0 ? Math.round(n / picks.length * 100) / 100 : 0,
        pickMedianReturn: pickMed,
        // F-BT-108: expose actual calendar days between canonical entry/exit dates
        // so cross-vintage alpha aggregation can detect shortened windows (holidays etc.)
        horizonActualDays: benchResult.horizonActualDays != null ? benchResult.horizonActualDays : null,
        // F-BT-006: null + note when n < MIN_SAMPLES
        alpha: n >= MIN_SAMPLES ? finalAlphaVsUniverse : null,
        alphaNullReason: n < MIN_SAMPLES ? ('insufficient_samples_n=' + n) : undefined,
        // Three benchmarks side-by-side. The reader picks the one they trust most.
        universeMedianReturn: universeMed,
        universeN: univResult.n,
        survivorBiasCorrected: univResult.survivorBiasCorrected,
        // F-BT-003: flag when evaluatedTickers was absent
        survivorBiasWarning: univResult.missingEvaluatedTickers
          ? 'evaluatedTickers absent in vintage — alphaVsUniverse suppressed' : undefined,
        frozenVintageMedianReturn: frozenVintage.median,
        frozenVintageN: frozenVintage.n,
        // F-BT-002: benchmark is SPY if available, else QQQ/IWM; null if none present
        benchmarkTicker: benchResult.ticker,
        benchmarkReturn: benchRet,
        // F-BT-002: flag when the benchmark series was too short to anchor canonical
        // dates (alpha fell back to the per-ticker path). Only present when true so
        // healthy output is byte-identical except for this diagnostic field.
        benchmarkInsufficient: benchResult.benchmarkInsufficient ? true : undefined,
        // Legacy keys kept for downstream compatibility
        spyReturn: benchRet,
        alphaVsUniverse: n >= MIN_SAMPLES ? finalAlphaVsUniverse : null,
        alphaVsFrozenVintage,
        alphaVsSpy: alphaVsBenchmark,
        // F-BT-011: flag runner version so downstream knows how to interpret stored pass flags
        backtest_runner_version: 'stored_pass'
      };
    }
    // F-BT-012: report n_total/n_considered/truncated at mode level too.
    // BH-141: was named `n_evaluated` here but held picks.length (post-truncation
    // candidate count, BEFORE per-horizon price-availability filtering) — a
    // different quantity than the correctly-named `horizons[days+'d'].n_evaluated`
    // (the actual two-price-resolved count). Renamed to avoid the same key
    // meaning two different things at two nesting levels.
    out.modes[mode] = { n_total: allPicks.length, n_considered: picks.length, truncated, horizons: horizonResults };
  }
  return out;
}

// Tag 134/139 — summary: median alpha per horizon × benchmark, pooled across
// vintages, plus per-regime (BULL/BEAR/SIDEWAYS) breakdown.
// BH-141: extracted from main()'s per-mode/per-horizon aggregation loop (a)
// so it's directly testable and (b) to fix vintageCount not applying the same
// `onWindow` (F-BT-008) filter that every other counter here (totalPicks,
// medianAlpha*) already applies — a vintage whose actual measured window
// deviated from the nominal horizon by more than HORIZON_TOLERANCE_DAYS was
// silently excluded from every median/totalPicks figure but still counted
// toward the headline "N vintages" numbers, overstating sample size.
function computeHorizonSummary(vintages, days) {
  const key = days + 'd';
  const onWindow = v => {
    const h = v.horizons[key];
    if (!h) return false;
    const ad = h.horizonActualDays;
    if (ad == null) return true;
    return Math.abs(ad - days) <= HORIZON_TOLERANCE_DAYS;
  };
  const collect = (field, filterFn) => vintages
    .filter(onWindow)
    .filter(v => !filterFn || filterFn(v))
    .map(v => v.horizons[key] && v.horizons[key][field])
    .filter(a => a != null && Number.isFinite(a));
  const ns = vintages.filter(onWindow).map(v => v.horizons[key] && v.horizons[key].n_evaluated).filter(n => n != null);

  const regimeAlpha = {};
  for (const regime of ['BULL', 'BEAR', 'SIDEWAYS']) {
    const vals = collect('alphaVsSpy', v => v.macroRegime === regime);
    if (vals.length > 0) regimeAlpha[regime] = { medianAlphaVsBenchmark: median(vals), vintages: vals.length };
  }

  const universeAlphaVals = collect('alphaVsUniverse');
  const universeAlphaVintageCount = universeAlphaVals.length;
  const rawMedianAlphaVsUniverse = median(universeAlphaVals);
  const medianAlphaVsUniverseGated = universeAlphaVintageCount < MIN_VINTAGES_UNIVERSE
    ? null : rawMedianAlphaVsUniverse;
  const medianAlphaVsUniverseNote = universeAlphaVintageCount < MIN_VINTAGES_UNIVERSE
    ? ('insufficient vintages (n=' + universeAlphaVintageCount + ')')
    : undefined;

  const frozenAlphaVals = collect('alphaVsFrozenVintage');
  const frozenAlphaVintageCount = frozenAlphaVals.length;
  const medianAlphaVsFrozenVintageGated = frozenAlphaVintageCount < MIN_VINTAGES_UNIVERSE
    ? null : median(frozenAlphaVals);
  const medianAlphaVsFrozenVintageNote = frozenAlphaVintageCount < MIN_VINTAGES_UNIVERSE
    ? ('insufficient vintages (n=' + frozenAlphaVintageCount + ')')
    : undefined;

  const benchmarkAlphaVals = collect('alphaVsSpy');
  const benchmarkAlphaVintageCount = benchmarkAlphaVals.length;
  const medianAlphaVsBenchmarkGated = benchmarkAlphaVintageCount < MIN_VINTAGES_UNIVERSE
    ? null : median(benchmarkAlphaVals);
  const medianAlphaVsBenchmarkNote = benchmarkAlphaVintageCount < MIN_VINTAGES_UNIVERSE
    ? ('insufficient vintages (n=' + benchmarkAlphaVintageCount + ')')
    : undefined;

  return {
    // BH-141: gated on the SAME onWindow filter as totalPicks/medianAlpha*
    // below (was previously ungated — see extraction note above).
    vintageCount: vintages.filter(onWindow).filter(v => v.horizons[key] && v.horizons[key].status === 'ok').length,
    universeAlphaVintageCount,
    medianAlphaVsUniverse: medianAlphaVsUniverseGated,
    medianAlphaVsUniverseNote,
    frozenVintageAlphaVintageCount: frozenAlphaVintageCount,
    medianAlphaVsFrozenVintage: medianAlphaVsFrozenVintageGated,
    medianAlphaVsFrozenVintageNote,
    benchmarkAlphaVintageCount,
    medianAlphaVsBenchmark: medianAlphaVsBenchmarkGated,
    medianAlphaVsBenchmarkNote,
    medianAlphaVsSpy: medianAlphaVsBenchmarkGated, // backwards-compat
    totalPicks: ns.reduce((s, n) => s + n, 0),
    regimeAlpha: Object.keys(regimeAlpha).length > 0 ? regimeAlpha : undefined,
    medianAlpha: medianAlphaVsUniverseGated
  };
}

function main() {
  // Tag 294: merge sharded price history (Legacy-Fallback inside loadAll). A
  // corrupt shard throws → treat as no-data (same graceful skip as before).
  let history;
  try { history = priceStore.loadAll(PRICES_DIR); }
  catch (e) { history = null; }
  if (!history || typeof history !== 'object' || Object.keys(history).length === 0) {
    console.log('No prices/history.json — cannot compute walk-forward.');
    return;
  }

  // F-PF-003: build O(1) price index once, before the main loop
  const priceIndex = buildPriceIndex(history);

  // F-BT-001 (fail-loud freshness): abort if the newest price is stale. Computed
  // numbers on healthy data are unaffected — this only fires when data is too old.
  const todayRef = new Date().toISOString().slice(0, 10);
  const newestPriceDate = maxPriceDate(history);
  if (!newestPriceDate) {
    console.error('::error::[walk-forward-perf] prices/history.json contains no dated entries — cannot validate freshness.');
    console.error('[walk-forward-perf] F-BT-001: no max price date found; aborting.');
    process.exit(1);
  }
  const priceStalenessBizDays = businessDaysSince(newestPriceDate, todayRef);
  if (priceStalenessBizDays > MAX_PRICE_STALENESS_BUSINESS_DAYS) {
    console.error('::error::[walk-forward-perf] F-BT-001: price history is stale — newest price '
      + newestPriceDate + ' is ' + priceStalenessBizDays + ' business days old (max allowed '
      + MAX_PRICE_STALENESS_BUSINESS_DAYS + '). Run pull-historical-prices.js. Aborting to avoid silently wrong forward returns.');
    console.error('[walk-forward-perf] newest price date: ' + newestPriceDate + ', today: ' + todayRef
      + ', staleness(business days): ' + priceStalenessBizDays);
    process.exit(1);
  }

  // Tag 139: load macro-regime data (graceful if not present)
  const regimes = loadMacroRegimes();
  if (regimes) {
    console.log('Macro-regime data loaded: ' + Object.keys(regimes).length + ' dates');
  } else {
    console.log('No macro-regime data (run scripts/macro-regime.js first to enable regime tagging)');
  }

  // F-BT-002: validate that at least one benchmark is present
  const benchPresent = ['SPY', 'QQQ', 'IWM'].some(t => priceIndex[t]);
  if (!benchPresent) {
    console.warn('[walk-forward-perf] WARNING: No benchmark tickers (SPY/QQQ/IWM) in price history. Run pull-historical-prices.js first.');
  }

  const vintages = listVintages();
  if (vintages.length === 0) {
    console.log('No picks-history vintages.');
    return;
  }
  const evaluations = [];
  for (const fname of vintages) {
    const picks = loadJson(path.join(PICKS_DIR, fname));
    if (!picks) continue;
    const ev = evaluateVintage(picks, priceIndex, regimes);
    if (ev) evaluations.push(ev);
  }

  // F-BT-012 / BH-141: picks-history coverage diagnostic (see computeCoverageDiagnostic).
  const coverageDiagnostic = computeCoverageDiagnostic(vintages);
  if (coverageDiagnostic && coverageDiagnostic.coverageWarning) {
    console.warn('::warning::[walk-forward-perf] ' + coverageDiagnostic.coverageWarning);
  }

  // Aggregate per-mode across vintages
  const modes = {};
  for (const ev of evaluations) {
    for (const [mode, modeData] of Object.entries(ev.modes)) {
      modes[mode] = modes[mode] || { vintages: [], summary: {} };
      modes[mode].vintages.push({
        asOf: ev.asOf,
        macroRegime: ev.macroRegime || null,  // Tag 139
        // F-BT-012 / BH-141: expose n_total/n_considered/truncated. The real
        // per-horizon evaluated counts live in horizons[days+'d'].n_evaluated;
        // no separate top-level n/n_evaluated duplicate (see rename above).
        n_total: modeData.n_total,
        n_considered: modeData.n_considered,
        truncated: modeData.truncated,
        horizons: modeData.horizons
      });
    }
  }
  // Summary: median alpha per horizon × benchmark across vintages (see
  // computeHorizonSummary — BH-141 extraction).
  // Tag 134 — Phase 3.2/3.3: reports alpha vs three benchmarks (universe / frozen-vintage / SPY/bench).
  // Tag 139: also computes per-regime (BULL/BEAR/SIDEWAYS) alpha breakdown.
  for (const [mode, data] of Object.entries(modes)) {
    for (const days of HORIZONS_DAYS) {
      data.summary[days + 'd'] = computeHorizonSummary(data.vintages, days);
    }
  }

  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  const today = new Date().toISOString().slice(0, 10);
  // BH-140: this script is not invoked by any GitHub Actions workflow (grep
  // .github/workflows/*.yml for walk-forward-perf.js is empty) — it is a
  // retired/orphaned legacy backtest, superseded by the live scoring path
  // (rank-ic.js / lib/forward-returns.js). `asOf` previously held today's RUN
  // date, which silently overstated freshness on every ad-hoc manual
  // invocation (a report run today against months-old picks-history still
  // said "asOf: today"). Report the actual data end date — the newest
  // evaluated picks-history vintage — as `asOf`, and keep the run date
  // separately as `generatedAt`.
  const dataAsOf = evaluations.length > 0 ? evaluations[evaluations.length - 1].asOf : null;
  const outJson = {
    legacy: true,
    legacyNote: 'Retired/orphaned: not wired into any CI workflow. Manual ad-hoc backtest only — do not treat this report as live pipeline scoring.',
    asOf: dataAsOf || today,
    generatedAt: today,
    vintageCount: evaluations.length,
    // F-BT-012: picks-history coverage diagnostic (new field, existing fields untouched)
    coverageDiagnostic,
    horizonsDays: HORIZONS_DAYS,
    benchmarks: ['SPY-preferred', 'QQQ-fallback', 'IWM-fallback', 'universe-median', 'frozen-vintage-median'],
    // F-BT-011: document runner version semantics
    backtest_runner_note: 'Historical picks used stored pass flags from snapshot date (backtest_runner_version="stored_pass"). Live comparison uses today\'s Runner — version drift is invisible. Do not compare absolute alpha values across Runner-version boundaries.',
    caveat: 'Three benchmarks: universe-median (Tag 138: survivor-bias corrected when evaluatedTickers available, else null — F-BT-003), frozen-vintage-median (only picks at vintage time), SPY/QQQ/IWM (external benchmark — F-BT-002). Tag 139: regimeAlpha shows BULL/BEAR/SIDEWAYS alpha split. F-BT-006: alpha=null when n<' + MIN_SAMPLES + '.',
    modes
  };
  writeFileAtomic(path.join(OUT_DIR, 'walk-forward.json'), JSON.stringify(outJson, null, 2));

  // Markdown report
  let md = '# Walk-Forward Performance — LEGACY/RETIRED (not wired into CI)\n\n';
  md += '**Data as of:** ' + (dataAsOf || today) + ' · **Generated:** ' + today + '\n\n';
  md += '**Benchmarks:** Universe-Median · Frozen-Vintage-Median · SPY/QQQ/IWM. **Vintages:** ' + evaluations.length + '.\n\n';
  md += '_Universe-median uses evaluatedTickers from each vintage (survivor-bias corrected). If evaluatedTickers absent, alphaVsUniverse=null. Frozen-vintage uses only the tickers in that vintage\'s picks. SPY (or QQQ/IWM fallback) is the external US-equity reference._\n\n';
  md += '**F-BT-011 note:** Historical alpha uses stored `pass` flags from snapshot date. Live comparison uses today\'s Runner. Version drift is not tracked — do not compare absolute alpha values across Runner-version boundaries.\n\n';
  for (const [mode, data] of Object.entries(modes)) {
    md += '## ' + mode + '\n\n';
    md += '| Horizon | Vintages | α vs Universe | α vs Frozen-Vintage | α vs Benchmark | Total Picks |\n';
    md += '|---|---|---|---|---|---|\n';
    const fmt = v => v != null ? ((v >= 0 ? '+' : '') + v.toFixed(2) + 'pp') : '—';
    for (const days of HORIZONS_DAYS) {
      const s = data.summary[days + 'd'];
      md += `| ${days}d | ${s.vintageCount} | ${fmt(s.medianAlphaVsUniverse)} | ${fmt(s.medianAlphaVsFrozenVintage)} | ${fmt(s.medianAlphaVsBenchmark)} | ${s.totalPicks} |\n`;
    }
    md += '\n### Per-Vintage (α vs Benchmark shown — most honest)\n\n';
    md += '| asOf | entry | n_considered | n_total | truncated | 1w | 4w | 12w |\n|---|---|---|---|---|---|---|---|\n';
    for (const v of data.vintages) {
      const cells = HORIZONS_DAYS.map(d => {
        const h = v.horizons[d + 'd'];
        if (!h || h.status !== 'ok' || h.alphaVsSpy == null) return '—';
        return (h.alphaVsSpy >= 0 ? '+' : '') + h.alphaVsSpy.toFixed(2) + 'pp';
      });
      // Determine entry date from first horizon (all horizons use same entry date)
      const firstH = v.horizons[HORIZONS_DAYS[0] + 'd'];
      const entryNote = firstH && firstH.backtest_runner_version === 'stored_pass' ? '' : '';
      // BH-141: n_considered (renamed from n_evaluated — see mode-level rename above)
      md += `| ${v.asOf} | ${entryNote}next-day | ${v.n_considered} | ${v.n_total} | ${v.truncated ? 'yes' : 'no'} | ${cells[0]} | ${cells[1]} | ${cells[2]} |\n`;
    }
    md += '\n';
  }
  writeFileAtomic(path.join(OUT_DIR, 'walk-forward.md'), md);

  console.log('Walk-forward report written:');
  console.log('  ' + path.join(OUT_DIR, 'walk-forward.json'));
  console.log('  ' + path.join(OUT_DIR, 'walk-forward.md'));
  console.log('  vintages: ' + evaluations.length);
  for (const [mode, data] of Object.entries(modes)) {
    const s28 = data.summary['28d'];
    // F-BT-117: label explicitly as 'α vs universe' to distinguish from SPY-relative alpha
    if (s28 && s28.medianAlpha != null) {
      console.log('  ' + mode + ' 4w median α vs universe = ' + (s28.medianAlpha >= 0 ? '+' : '') + s28.medianAlpha.toFixed(2) + 'pp (n=' + s28.vintageCount + ')');
    }
  }
}

module.exports = {
  evaluateVintage,
  computeUniverseMedianReturn,
  buildPriceIndex,
  priceAt,
  priceAtLegacy,
  returnPct,
  median,
  addDaysIso,
  getEntryDate,
  nearestTradingDay,
  // Tag 231a-2: exported for canonical-date callers (method-effectiveness.js)
  _priceAtCanonical,
  // Court E-20260720-5 / Bless-Gate-P2: das eine usable-Praedikat fuer alle
  // Preis-/Datums-Anker (rank-ic.js newestPriceDate nutzt es mit).
  _usableClose,
  // Tag 232c-20: export computeBenchmarkReturn so method-effectiveness can
  // share walk-forward's canonical-date anchoring (audit F-BT-002 HIGH).
  computeBenchmarkReturn,
  // F-BT-001: export freshness helpers + threshold so method-effectiveness.js
  // applies the identical staleness guard without duplicating logic.
  maxPriceDate,
  businessDaysSince,
  MAX_PRICE_STALENESS_BUSINESS_DAYS,
  // BH-141/BH-187: exported for direct hermetic testing (bh-w2-wfp.test.js)
  // of the aggregation/regime logic without needing full main() file I/O.
  businessDaysBetween,
  computeCoverageDiagnostic,
  computeHorizonSummary,
  computeFrozenVintageMedianReturn,
  getRegimeAt
};

if (require.main === module) {
  try { main(); } catch (e) { console.error('::error::[walk-forward-perf] failed: ' + ((e && e.stack) || (e && e.message) || e)); process.exit(1); }
}

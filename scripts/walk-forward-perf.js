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

const PICKS_DIR     = path.join(__dirname, '..', 'picks-history');
const PRICES_PATH   = path.join(__dirname, '..', 'prices', 'history.json');
const REGIME_PATH   = path.join(__dirname, '..', 'outputs', 'macro-regime.json');
const OUT_DIR       = path.join(__dirname, '..', 'outputs');

const HORIZONS_DAYS = [7, 28, 84]; // 1w / 4w / 12w
const MIN_SAMPLES   = 10;          // F-BT-006: minimum picks for meaningful alpha

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
function priceAt(priceIndex, ticker, targetDate) {
  const map = priceIndex[ticker];
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

function returnPct(p0, p1) {
  if (!Number.isFinite(p0) || !Number.isFinite(p1) || p0 <= 0) return null;
  return (p1 - p0) / p0 * 100;
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
  if (d.getUTCHours() < 21) {
    // Pre-market / intraday snapshot: use next day's price
    const next = new Date(d);
    next.setUTCDate(next.getUTCDate() + 1);
    return next.toISOString().slice(0, 10);
  }
  return asOf.slice(0, 10);
}

// F-BT-005: After computing a calendar-day target date, find the nearest available
// trading day in the price map (checks target ±1..5 business days, alternating forward
// and backward). Returns null if no price exists within 5 days.
function nearestTradingDay(targetDate, priceMap) {
  if (!priceMap) return null;
  if (priceMap.has(targetDate)) return targetDate;
  for (let offset = 1; offset <= 5; offset++) {
    // Forward
    const dFwd = new Date(targetDate + 'T00:00:00Z');
    dFwd.setUTCDate(dFwd.getUTCDate() + offset);
    const keyFwd = dFwd.toISOString().slice(0, 10);
    if (priceMap.has(keyFwd)) return keyFwd;
    // Backward
    const dBwd = new Date(targetDate + 'T00:00:00Z');
    dBwd.setUTCDate(dBwd.getUTCDate() - offset);
    const keyBwd = dBwd.toISOString().slice(0, 10);
    if (priceMap.has(keyBwd)) return keyBwd;
  }
  return null;
}

function listVintages() {
  if (!fs.existsSync(PICKS_DIR)) return [];
  return fs.readdirSync(PICKS_DIR)
    .filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort();
}

// Tag 138: survivor-bias fix. When the picks file has evaluatedTickers[], use that
// list (stocks that were actually in the universe at vintage time) instead of all
// tickers in prices/history.json (which includes stocks added later → upward bias).
// F-BT-003: When evaluatedTickers is missing, log a warning and return null for
// alphaVsUniverse rather than falling back to today's survivor-biased universe.
function computeUniverseMedianReturn(priceIndex, asOfDate, horizonDays, evaluatedTickers) {
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
    const entryDate = nearestTradingDay(asOfDate, map) || asOfDate;
    const exitDate  = nearestTradingDay(futureDate, map) || futureDate;
    const p0 = map.get(entryDate) || null;
    const p1 = map.get(exitDate)  || null;
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
function computeFrozenVintageMedianReturn(priceIndex, vintagePicks, asOfDate, horizonDays) {
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
    // F-BT-005: snap to nearest trading day
    const entryDate = nearestTradingDay(asOfDate, map) || asOfDate;
    const exitDate  = nearestTradingDay(futureDate, map) || futureDate;
    const p0 = map.get(entryDate) || null;
    const p1 = map.get(exitDate)  || null;
    const r = returnPct(p0, p1);
    if (r != null) returns.push(r);
  }
  return { median: median(returns), n: returns.length };
}

// Tag 134 — Phase 3.3: SPY/benchmark return.
// F-BT-002: Falls back to QQQ if SPY is absent; emits null + warning if both are absent.
function computeBenchmarkReturn(priceIndex, asOfDate, horizonDays) {
  const candidates = ['SPY', 'QQQ', 'IWM'];
  let benchmarkTicker = null;
  for (const t of candidates) {
    if (priceIndex[t]) { benchmarkTicker = t; break; }
  }
  if (!benchmarkTicker) {
    console.warn('[walk-forward-perf] WARNING: SPY/QQQ/IWM not in price history — alphaVsBenchmark will be null. Run pull-historical-prices.js to fix.');
    return { ticker: null, ret: null };
  }
  const map = priceIndex[benchmarkTicker];
  // F-BT-005: snap to nearest trading day
  const entryDate = nearestTradingDay(asOfDate, map) || asOfDate;
  const futureDate = addDaysIso(asOfDate, horizonDays);
  const exitDate   = nearestTradingDay(futureDate, map) || futureDate;
  const p0 = map.get(entryDate) || null;
  const p1 = map.get(exitDate)  || null;
  return { ticker: benchmarkTicker, ret: returnPct(p0, p1) };
}

// Tag 139: load macro-regime lookup
function loadMacroRegimes() {
  const raw = loadJson(REGIME_PATH);
  if (!raw || !raw.regimes) return null;
  return raw.regimes; // { "YYYY-MM-DD": { regime, price, sma200 } }
}

// Tag 139 / F-BT-010: find closest regime entry for a given date.
// Extended lookback to 30 days. Returns 'UNKNOWN' (not null) if no regime found.
function getRegimeAt(regimes, isoDate) {
  if (!regimes) return null;
  if (regimes[isoDate]) return regimes[isoDate].regime;
  // Look back up to 30 days (was 7, F-BT-010)
  for (let i = 1; i <= 30; i++) {
    const d = new Date(isoDate + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() - i);
    const key = d.toISOString().slice(0, 10);
    if (regimes[key]) return regimes[key].regime;
  }
  console.warn('[walk-forward-perf] WARNING: No macro regime found within 30 days of ' + isoDate + ' — returning UNKNOWN');
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
  const macroRegime = getRegimeAt(regimes, asOf);  // Tag 139
  const out = { asOf, macroRegime, modes: {} };

  // F-BT-003: warn when evaluatedTickers is absent (no survivor-bias correction possible)
  if (!picksFile.evaluatedTickers || picksFile.evaluatedTickers.length === 0) {
    console.warn('[walk-forward-perf] WARNING: vintage ' + asOf + ' has no evaluatedTickers — alphaVsUniverse will be null (survivor-bias uncorrectable)');
  }

  // F-PF-003: hoist universe-median computation outside the per-mode loop (same for all modes)
  const univResultsByHorizon = {};
  for (const days of HORIZONS_DAYS) {
    univResultsByHorizon[days] = computeUniverseMedianReturn(priceIndex, entryDate, days, picksFile.evaluatedTickers);
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
      for (const p of picks) {
        const t = p.ticker;
        // F-BT-009: null-safe access to score (older vintages may lack it)
        // const score = p.score != null ? p.score : p.normScore != null ? p.normScore : null; // available on p if needed
        const map = priceIndex[t];
        if (!map) continue;
        // F-BT-005: snap to nearest trading day
        const tEntry = nearestTradingDay(entryDate, map) || entryDate;
        const tExit  = nearestTradingDay(futureDate, map) || futureDate;
        const p0 = map.get(tEntry) || null;
        const p1 = map.get(tExit)  || null;
        const r = returnPct(p0, p1);
        if (r != null) pickReturns.push(r);
      }
      // F-PF-003: use pre-computed universe result
      const univResult = univResultsByHorizon[days];
      const universeMed = univResult.median;
      const frozenVintage = computeFrozenVintageMedianReturn(priceIndex, picksFile, entryDate, days);
      const benchResult = computeBenchmarkReturn(priceIndex, entryDate, days);
      const pickMed = median(pickReturns);
      const n = pickReturns.length;

      // F-BT-006: suppress alpha when n < MIN_SAMPLES
      const alphaVsUniverse = (n >= MIN_SAMPLES && pickMed != null && universeMed != null)
        ? pickMed - universeMed : null;
      const alphaVsFrozenVintage = (n >= MIN_SAMPLES && pickMed != null && frozenVintage.median != null)
        ? pickMed - frozenVintage.median : null;
      const benchRet = benchResult.ret;
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
        // Legacy keys kept for downstream compatibility
        spyReturn: benchRet,
        alphaVsUniverse: n >= MIN_SAMPLES ? finalAlphaVsUniverse : null,
        alphaVsFrozenVintage,
        alphaVsSpy: alphaVsBenchmark,
        // F-BT-011: flag runner version so downstream knows how to interpret stored pass flags
        backtest_runner_version: 'stored_pass'
      };
    }
    // F-BT-012: report n_total/n_evaluated/truncated at mode level too
    out.modes[mode] = { n_total: allPicks.length, n_evaluated: picks.length, truncated, horizons: horizonResults };
  }
  return out;
}

function main() {
  const history = loadJson(PRICES_PATH);
  if (!history || typeof history !== 'object') {
    console.log('No prices/history.json — cannot compute walk-forward.');
    return;
  }

  // F-PF-003: build O(1) price index once, before the main loop
  const priceIndex = buildPriceIndex(history);

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

  // Aggregate per-mode across vintages
  const modes = {};
  for (const ev of evaluations) {
    for (const [mode, modeData] of Object.entries(ev.modes)) {
      modes[mode] = modes[mode] || { vintages: [], summary: {} };
      modes[mode].vintages.push({
        asOf: ev.asOf,
        macroRegime: ev.macroRegime || null,  // Tag 139
        // F-BT-012: expose n_total/n_evaluated/truncated
        n: modeData.n_evaluated,
        n_total: modeData.n_total,
        n_evaluated: modeData.n_evaluated,
        truncated: modeData.truncated,
        horizons: modeData.horizons
      });
    }
  }
  // Summary: median alpha per horizon × benchmark across vintages
  // Tag 134 — Phase 3.2/3.3: now reports alpha vs three benchmarks (universe / frozen-vintage / SPY/bench).
  // Tag 139: also computes per-regime (BULL/BEAR/SIDEWAYS) alpha breakdown.
  for (const [mode, data] of Object.entries(modes)) {
    for (const days of HORIZONS_DAYS) {
      const key = days + 'd';
      const collect = (field, filterFn) => data.vintages
        .filter(v => !filterFn || filterFn(v))
        .map(v => v.horizons[key] && v.horizons[key][field])
        .filter(a => a != null && Number.isFinite(a));
      const ns = data.vintages.map(v => v.horizons[key] && v.horizons[key].n_evaluated).filter(n => n != null);

      // Tag 139: per-regime alpha (BULL/BEAR/SIDEWAYS)
      const regimeAlpha = {};
      for (const regime of ['BULL', 'BEAR', 'SIDEWAYS']) {
        const vals = collect('alphaVsSpy', v => v.macroRegime === regime);
        if (vals.length > 0) regimeAlpha[regime] = { medianAlphaVsBenchmark: median(vals), vintages: vals.length };
      }

      data.summary[key] = {
        vintageCount: collect('alphaVsUniverse').length,
        medianAlphaVsUniverse: median(collect('alphaVsUniverse')),
        medianAlphaVsFrozenVintage: median(collect('alphaVsFrozenVintage')),
        medianAlphaVsBenchmark: median(collect('alphaVsSpy')),
        medianAlphaVsSpy: median(collect('alphaVsSpy')), // backwards-compat
        totalPicks: ns.reduce((s, n) => s + n, 0),
        // Tag 139: alpha by macro regime (only if regime data available)
        regimeAlpha: Object.keys(regimeAlpha).length > 0 ? regimeAlpha : undefined,
        // Backwards-compat (deprecated, prefer medianAlphaVsUniverse):
        medianAlpha: median(collect('alphaVsUniverse'))
      };
    }
  }

  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  const today = new Date().toISOString().slice(0, 10);
  const outJson = {
    asOf: today,
    vintageCount: evaluations.length,
    horizonsDays: HORIZONS_DAYS,
    benchmarks: ['SPY-preferred', 'QQQ-fallback', 'IWM-fallback', 'universe-median', 'frozen-vintage-median'],
    // F-BT-011: document runner version semantics
    backtest_runner_note: 'Historical picks used stored pass flags from snapshot date (backtest_runner_version="stored_pass"). Live comparison uses today\'s Runner — version drift is invisible. Do not compare absolute alpha values across Runner-version boundaries.',
    caveat: 'Three benchmarks: universe-median (Tag 138: survivor-bias corrected when evaluatedTickers available, else null — F-BT-003), frozen-vintage-median (only picks at vintage time), SPY/QQQ/IWM (external benchmark — F-BT-002). Tag 139: regimeAlpha shows BULL/BEAR/SIDEWAYS alpha split. F-BT-006: alpha=null when n<' + MIN_SAMPLES + '.',
    modes
  };
  fs.writeFileSync(path.join(OUT_DIR, 'walk-forward.json'), JSON.stringify(outJson, null, 2));

  // Markdown report
  let md = '# Walk-Forward Performance — ' + today + '\n\n';
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
    md += '| asOf | entry | n_evaluated | n_total | truncated | 1w | 4w | 12w |\n|---|---|---|---|---|---|---|---|\n';
    for (const v of data.vintages) {
      const cells = HORIZONS_DAYS.map(d => {
        const h = v.horizons[d + 'd'];
        if (!h || h.status !== 'ok' || h.alphaVsSpy == null) return '—';
        return (h.alphaVsSpy >= 0 ? '+' : '') + h.alphaVsSpy.toFixed(2) + 'pp';
      });
      // Determine entry date from first horizon (all horizons use same entry date)
      const firstH = v.horizons[HORIZONS_DAYS[0] + 'd'];
      const entryNote = firstH && firstH.backtest_runner_version === 'stored_pass' ? '' : '';
      md += `| ${v.asOf} | ${entryNote}next-day | ${v.n_evaluated} | ${v.n_total} | ${v.truncated ? 'yes' : 'no'} | ${cells[0]} | ${cells[1]} | ${cells[2]} |\n`;
    }
    md += '\n';
  }
  fs.writeFileSync(path.join(OUT_DIR, 'walk-forward.md'), md);

  console.log('Walk-forward report written:');
  console.log('  ' + path.join(OUT_DIR, 'walk-forward.json'));
  console.log('  ' + path.join(OUT_DIR, 'walk-forward.md'));
  console.log('  vintages: ' + evaluations.length);
  for (const [mode, data] of Object.entries(modes)) {
    const s28 = data.summary['28d'];
    if (s28 && s28.medianAlpha != null) {
      console.log('  ' + mode + ' 4w median α = ' + (s28.medianAlpha >= 0 ? '+' : '') + s28.medianAlpha.toFixed(2) + 'pp (n=' + s28.vintageCount + ')');
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
  nearestTradingDay
};

if (require.main === module) {
  try { main(); } catch (e) { console.error('walk-forward-perf failed: ' + e.message); process.exit(0); }
}

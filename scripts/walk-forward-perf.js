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
function priceAt(history, ticker, targetDate) {
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

function listVintages() {
  if (!fs.existsSync(PICKS_DIR)) return [];
  return fs.readdirSync(PICKS_DIR)
    .filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort();
}

// Tag 138: survivor-bias fix. When the picks file has evaluatedTickers[], use that
// list (stocks that were actually in the universe at vintage time) instead of all
// tickers in prices/history.json (which includes stocks added later → upward bias).
function computeUniverseMedianReturn(history, asOfDate, horizonDays, evaluatedTickers) {
  const futureDate = addDaysIso(asOfDate, horizonDays);
  const returns = [];
  const tickerList = (evaluatedTickers && evaluatedTickers.length > 0)
    ? evaluatedTickers
    : Object.keys(history);
  for (const ticker of tickerList) {
    const p0 = priceAt(history, ticker, asOfDate);
    const p1 = priceAt(history, ticker, futureDate);
    const r = returnPct(p0, p1);
    if (r != null) returns.push(r);
  }
  return { median: median(returns), n: returns.length, survivorBiasCorrected: !!(evaluatedTickers && evaluatedTickers.length > 0) };
}

// Tag 134 — Phase 3.2: frozen-vintage benchmark.
// Computes universe-median only over tickers that already appeared in the
// vintage's picks file (any mode). This eliminates the "today's-survivor"
// upward bias of computeUniverseMedianReturn — at the cost of a smaller
// benchmark sample. Both are reported so the reader can see the gap.
function computeFrozenVintageMedianReturn(history, vintagePicks, asOfDate, horizonDays) {
  const futureDate = addDaysIso(asOfDate, horizonDays);
  const tickersAtVintage = new Set();
  for (const arr of Object.values(vintagePicks.modes || {})) {
    if (!Array.isArray(arr)) continue;
    for (const p of arr) if (p && p.ticker) tickersAtVintage.add(p.ticker);
  }
  const returns = [];
  for (const ticker of tickersAtVintage) {
    const p0 = priceAt(history, ticker, asOfDate);
    const p1 = priceAt(history, ticker, futureDate);
    const r = returnPct(p0, p1);
    if (r != null) returns.push(r);
  }
  return { median: median(returns), n: returns.length };
}

// Tag 134 — Phase 3.3: SPY benchmark.
// External US-equity index. Independent of internal universe selection.
// Returns null if SPY not in history (graceful — workflow still produces output).
function computeBenchmarkReturn(history, asOfDate, horizonDays, ticker) {
  const futureDate = addDaysIso(asOfDate, horizonDays);
  const p0 = priceAt(history, ticker, asOfDate);
  const p1 = priceAt(history, ticker, futureDate);
  return returnPct(p0, p1);
}

// Tag 139: load macro-regime lookup
function loadMacroRegimes() {
  const raw = loadJson(REGIME_PATH);
  if (!raw || !raw.regimes) return null;
  return raw.regimes; // { "YYYY-MM-DD": { regime, price, sma200 } }
}

// Tag 139: find closest regime entry for a given date (within 7 days)
function getRegimeAt(regimes, isoDate) {
  if (!regimes) return null;
  if (regimes[isoDate]) return regimes[isoDate].regime;
  // Look back up to 7 days
  for (let i = 1; i <= 7; i++) {
    const d = new Date(isoDate + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() - i);
    const key = d.toISOString().slice(0, 10);
    if (regimes[key]) return regimes[key].regime;
  }
  return null;
}

function evaluateVintage(picksFile, history, regimes) {
  const asOf = (picksFile.asOf || '').slice(0, 10);
  if (!asOf) return null;
  const today = new Date().toISOString().slice(0, 10);
  const macroRegime = getRegimeAt(regimes, asOf);  // Tag 139
  const out = { asOf, macroRegime, modes: {} };

  for (const [mode, picks] of Object.entries(picksFile.modes || {})) {
    if (!Array.isArray(picks)) continue;
    const horizonResults = {};
    for (const days of HORIZONS_DAYS) {
      const futureDate = addDaysIso(asOf, days);
      if (futureDate > today) {
        horizonResults[days + 'd'] = { status: 'too-early', n: 0 };
        continue;
      }
      const pickReturns = [];
      for (const p of picks) {
        const t = p.ticker;
        const p0 = priceAt(history, t, asOf);
        const p1 = priceAt(history, t, futureDate);
        const r = returnPct(p0, p1);
        if (r != null) pickReturns.push(r);
      }
      // Tag 138: pass evaluatedTickers for survivor-bias-corrected universe median
      const univResult = computeUniverseMedianReturn(history, asOf, days, picksFile.evaluatedTickers);
      const universeMed = univResult.median;
      const frozenVintage = computeFrozenVintageMedianReturn(history, picksFile, asOf, days);
      const spyRet = computeBenchmarkReturn(history, asOf, days, 'SPY');
      const pickMed = median(pickReturns);
      horizonResults[days + 'd'] = {
        status: 'ok',
        n: pickReturns.length,
        coverage: picks.length > 0 ? Math.round(pickReturns.length / picks.length * 100) / 100 : 0,
        pickMedianReturn: pickMed,
        // Three benchmarks side-by-side. The reader picks the one they trust most.
        universeMedianReturn: universeMed,                                          // Tag 138: survivor-bias corrected when evaluatedTickers available
        universeN: univResult.n,
        survivorBiasCorrected: univResult.survivorBiasCorrected,
        frozenVintageMedianReturn: frozenVintage.median,                            // vintage-frozen (picks only)
        frozenVintageN: frozenVintage.n,
        spyReturn: spyRet,                                                          // external benchmark
        alphaVsUniverse: (pickMed != null && universeMed != null) ? pickMed - universeMed : null,
        alphaVsFrozenVintage: (pickMed != null && frozenVintage.median != null) ? pickMed - frozenVintage.median : null,
        alphaVsSpy: (pickMed != null && spyRet != null) ? pickMed - spyRet : null,
        // Backwards-compat key (kept so downstream consumers don't break):
        alpha: (pickMed != null && universeMed != null) ? pickMed - universeMed : null
      };
    }
    out.modes[mode] = { n: picks.length, horizons: horizonResults };
  }
  return out;
}

function main() {
  const history = loadJson(PRICES_PATH);
  if (!history || typeof history !== 'object') {
    console.log('No prices/history.json — cannot compute walk-forward.');
    return;
  }
  // Tag 139: load macro-regime data (graceful if not present)
  const regimes = loadMacroRegimes();
  if (regimes) {
    console.log('Macro-regime data loaded: ' + Object.keys(regimes).length + ' dates');
  } else {
    console.log('No macro-regime data (run scripts/macro-regime.js first to enable regime tagging)');
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
    const ev = evaluateVintage(picks, history, regimes);
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
        n: modeData.n,
        horizons: modeData.horizons
      });
    }
  }
  // Summary: median alpha per horizon × benchmark across vintages
  // Tag 134 — Phase 3.2/3.3: now reports alpha vs three benchmarks (universe / frozen-vintage / SPY).
  // Tag 139: also computes per-regime (BULL/BEAR/SIDEWAYS) alpha breakdown.
  for (const [mode, data] of Object.entries(modes)) {
    for (const days of HORIZONS_DAYS) {
      const key = days + 'd';
      const collect = (field, filterFn) => data.vintages
        .filter(v => !filterFn || filterFn(v))
        .map(v => v.horizons[key] && v.horizons[key][field])
        .filter(a => a != null && Number.isFinite(a));
      const ns = data.vintages.map(v => v.horizons[key] && v.horizons[key].n).filter(n => n != null);

      // Tag 139: per-regime alpha (BULL/BEAR/SIDEWAYS)
      const regimeAlpha = {};
      for (const regime of ['BULL', 'BEAR', 'SIDEWAYS']) {
        const vals = collect('alphaVsSpy', v => v.macroRegime === regime);
        if (vals.length > 0) regimeAlpha[regime] = { medianAlphaVsSpy: median(vals), vintages: vals.length };
      }

      data.summary[key] = {
        vintageCount: collect('alphaVsUniverse').length,
        medianAlphaVsUniverse: median(collect('alphaVsUniverse')),
        medianAlphaVsFrozenVintage: median(collect('alphaVsFrozenVintage')),
        medianAlphaVsSpy: median(collect('alphaVsSpy')),
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
    benchmarks: ['universe-median', 'frozen-vintage-median', 'SPY'],
    caveat: 'Three benchmarks: universe-median (Tag 138: survivor-bias corrected when evaluatedTickers available, else today\'s survivors), frozen-vintage-median (only picks at vintage time), SPY (external US-equity index). Tag 139: regimeAlpha shows BULL/BEAR/SIDEWAYS alpha split.',
    modes
  };
  fs.writeFileSync(path.join(OUT_DIR, 'walk-forward.json'), JSON.stringify(outJson, null, 2));

  // Markdown report
  let md = '# Walk-Forward Performance — ' + today + '\n\n';
  md += '**Benchmarks:** Universe-Median · Frozen-Vintage-Median · SPY. **Vintages:** ' + evaluations.length + '.\n\n';
  md += '_Universe-median is upward-biased (today\'s survivors). Frozen-vintage uses only the tickers in that vintage\'s picks. SPY is the external US-equity reference. The honest read is the column-min._\n\n';
  for (const [mode, data] of Object.entries(modes)) {
    md += '## ' + mode + '\n\n';
    md += '| Horizon | Vintages | α vs Universe | α vs Frozen-Vintage | α vs SPY | Total Picks |\n';
    md += '|---|---|---|---|---|---|\n';
    const fmt = v => v != null ? ((v >= 0 ? '+' : '') + v.toFixed(2) + 'pp') : '—';
    for (const days of HORIZONS_DAYS) {
      const s = data.summary[days + 'd'];
      md += `| ${days}d | ${s.vintageCount} | ${fmt(s.medianAlphaVsUniverse)} | ${fmt(s.medianAlphaVsFrozenVintage)} | ${fmt(s.medianAlphaVsSpy)} | ${s.totalPicks} |\n`;
    }
    md += '\n### Per-Vintage (α vs SPY shown — most honest)\n\n';
    md += '| asOf | n picks | 1w | 4w | 12w |\n|---|---|---|---|---|\n';
    for (const v of data.vintages) {
      const cells = HORIZONS_DAYS.map(d => {
        const h = v.horizons[d + 'd'];
        if (!h || h.status !== 'ok' || h.alphaVsSpy == null) return '—';
        return (h.alphaVsSpy >= 0 ? '+' : '') + h.alphaVsSpy.toFixed(2) + 'pp';
      });
      md += `| ${v.asOf} | ${v.n} | ${cells[0]} | ${cells[1]} | ${cells[2]} |\n`;
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

module.exports = { evaluateVintage, computeUniverseMedianReturn, priceAt, returnPct, median, addDaysIso };

if (require.main === module) {
  try { main(); } catch (e) { console.error('walk-forward-perf failed: ' + e.message); process.exit(0); }
}

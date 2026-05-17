#!/usr/bin/env node
/**
 * Tag 102g — Walk-Forward Picks-History
 * Friert die aktuellen Mode-Picks ein als JSON in picks-history/YYYY-MM-DD.json
 * Wird im Workflow nach Modes-Report-Generation ausgefuehrt.
 */
'use strict';
const fs = require('fs');
const path = require('path');

// Server-Layout: methods/ enthaelt alle methods + runner + strategy-modes
const Runner = require('./methods/runner.js');
const SM = require('./methods/strategy-modes.js');
// Tag 189: atomic writes — F-SM-027 / F-SM-028 / F-GC-017.
const { writeFileAtomic } = require('./lib/atomic-write.js');

function parseArgs(argv) {
  const args = { snapshots: './snapshots', out: './picks-history' };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--snapshots' && argv[i+1]) args.snapshots = argv[++i];
    else if (argv[i] === '--out' && argv[i+1]) args.out = argv[++i];
  }
  return args;
}

// F-PF-007: async batch loader to avoid serial fs.readFileSync across 12k+ files.
// Processes files in batches of 200 using Promise.all for parallel I/O scheduling.
async function loadStocksAsync(dir) {
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json') && !f.startsWith('_'));
  const BATCH = 200;
  const results = [];
  for (let i = 0; i < files.length; i += BATCH) {
    const batch = files.slice(i, i + BATCH);
    const loaded = await Promise.all(batch.map(f => {
      try {
        const s = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
        if (s && s.meta && s.meta.ticker) return s;
        return null;
      } catch (e) { return null; }
    }));
    results.push(...loaded.filter(Boolean));
  }
  return results;
}

// Synchronous fallback kept for module.exports.loadStocks callers
function loadStocks(dir) {
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json') && !f.startsWith('_'));
  const stocks = [];
  for (const f of files) {
    try {
      const s = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      if (s && s.meta && s.meta.ticker) stocks.push(s);
    } catch (e) {}
  }
  return stocks;
}

function getMcap(stock) {
  const m = stock.marketCap || (stock.meta && stock.meta.marketCap);
  if (typeof m === 'number') return m;
  if (m && typeof m === 'object' && 'value' in m) return m.value;
  return null;
}

function getProfState(results) {
  const ps = results['profitability-state'];
  return (ps && ps.computable && ps.components && ps.components.state) || 'UNKNOWN';
}

function primaryMetricFor(modeId, results) {
  const sortMethod = (SM.MODES[modeId] && SM.MODES[modeId].defaultSortMethod) || 'rule-of-40';
  const r = results[sortMethod];
  return { id: sortMethod, value: r && r.computable ? r.value : null };
}

// F-PF-001: accepts pre-computed results so evaluateStock is called ONCE per stock,
// not once per mode (was 3 calls per stock across the mode loop).
// F-BT-009: null-safe score access — older vintages may lack score; fall back to normScore.
function pickStockForMode(stock, modeId, results) {
  if (!results) {
    // Legacy path: called without pre-computed results (e.g. from external code)
    try { results = Runner.evaluateStock(stock); }
    catch (e) { return null; }
  }
  const ev = SM.evaluateMode(stock, modeId, results);
  if (!ev || !ev.passed) return null;
  return {
    ticker: stock.meta.ticker,
    name: stock.meta.name || '',
    sector: stock.meta.sector || '',
    industry: stock.meta.industry || '',
    profState: getProfState(results),
    primaryMetric: primaryMetricFor(modeId, results),
    // F-BT-009: null-safe — fall back to normScore for older vintages that lacked score
    score: (ev.score != null) ? Math.round(ev.score * 10) / 10
         : (ev.normScore != null) ? Math.round(ev.normScore * 10) / 10
         : null,
    marketCap: getMcap(stock),
    mustPassCount: ev.mustPassCount,
    mustTotal: ev.mustTotal
  };
}

function dedupePicksByCompany(picks) {
  function norm(s) {
    if (!s) return '';
    return String(s).toLowerCase()
      .replace(/[éèêë]/g, 'e').replace(/[óòôö]/g, 'o').replace(/[áàâä]/g, 'a')
      .replace(/\b(inc|corporation|corp|incorporated|company|co|ltd|limited|plc|sa|ag|nv|holdings|holding|group|sarl|spa)\b/gi, '')
      .replace(/[^a-z0-9]+/g, '').trim();
  }
  const byKey = new Map();
  for (const p of picks) {
    const key = norm(p.name) || p.ticker.split(/[.\-]/)[0].toLowerCase();
    if (!key) continue;
    const existing = byKey.get(key);
    if (!existing) { byKey.set(key, p); continue; }
    const pIsUS = !/\./.test(p.ticker);
    const exIsUS = !/\./.test(existing.ticker);
    if (pIsUS && !exIsUS) byKey.set(key, p);
    else if (pIsUS === exIsUS && (p.score || 0) > (existing.score || 0)) byKey.set(key, p);
  }
  return Array.from(byKey.values());
}

// Tag 134 — Phase 4.1 / F-PF-008: build a per-mode { ticker -> firstSeenAt } map.
// Cache stored in picks-history/_first-seen.json so we only rebuild on first run.
// On subsequent runs, load the cache and update only new tickers from today's picks.
const FIRST_SEEN_CACHE_FILE = '_first-seen.json';

function _loadFirstSeenCache(picksHistDir) {
  const cachePath = path.join(picksHistDir, FIRST_SEEN_CACHE_FILE);
  if (!fs.existsSync(cachePath)) return null;
  try { return JSON.parse(fs.readFileSync(cachePath, 'utf8')); }
  catch (e) { return null; }
}

function _saveFirstSeenCache(picksHistDir, cache) {
  const cachePath = path.join(picksHistDir, FIRST_SEEN_CACHE_FILE);
  // F-SM-027 (Tag 189): atomic — committed file consumed by every subsequent
  // snapshot-picks run; a truncated write made _buildFirstSeenMap fall back to
  // full rebuild + silently lost prior firstSeenAt timestamps for fresh picks.
  writeFileAtomic(cachePath, JSON.stringify(cache));
}

function _buildFirstSeenMap(picksHistDir) {
  const modes = ['HYPERGROWTH', 'QUALITY_COMPOUNDER', 'TURNAROUND'];
  // F-PF-008: try loading the incremental cache first to avoid parsing all vintage files
  const cached = _loadFirstSeenCache(picksHistDir);
  if (cached && modes.every(m => typeof cached[m] === 'object')) {
    return { map: cached, fromCache: true };
  }
  // Full rebuild only on first run or if cache is corrupt
  const map = modes.reduce((m, k) => { m[k] = {}; return m; }, {});
  if (!fs.existsSync(picksHistDir)) return { map, fromCache: false };
  const files = fs.readdirSync(picksHistDir)
    .filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort();
  for (const f of files) {
    let v;
    try { v = JSON.parse(fs.readFileSync(path.join(picksHistDir, f), 'utf8')); }
    catch (e) { continue; }
    const date = (v.asOf || '').slice(0, 10) || f.replace('.json', '');
    for (const mode of modes) {
      const arr = (v.modes && v.modes[mode]) || [];
      for (const p of arr) {
        if (!p || !p.ticker) continue;
        if (!map[mode][p.ticker]) map[mode][p.ticker] = date;
      }
    }
  }
  return { map, fromCache: false };
}

function _weeksBetween(isoA, isoB) {
  return Math.floor(Math.abs(new Date(isoB).getTime() - new Date(isoA).getTime()) / (7 * 86400000));
}

async function main() {
  const args = parseArgs(process.argv);
  if (!fs.existsSync(args.out)) fs.mkdirSync(args.out, { recursive: true });
  console.log('Loading snapshots from', args.snapshots);

  // F-PF-007: use async batch loader (was serial readFileSync per file)
  const stocks = await loadStocksAsync(args.snapshots);
  console.log('  ' + stocks.length + ' stocks loaded');

  // Tag 134 — Phase 4.1 / F-PF-008: load first-seen from cache; avoid full rebuild
  const { map: firstSeenMap, fromCache } = _buildFirstSeenMap(args.out);
  if (fromCache) {
    console.log('  first-seen map: loaded from cache (_first-seen.json)');
  } else {
    console.log('  first-seen map: rebuilt from all vintage files (cache was absent)');
  }
  // Tag 219 (audit F-219b-01): prefer workflow-frozen RUN_DATE_UTC.
  const today = process.env.RUN_DATE_UTC || new Date().toISOString().slice(0, 10);

  // F-PF-001: evaluate each stock ONCE before mode loops (was Runner.evaluateStock called
  // once per mode per stock = 3× for 3 modes, now 1× total).
  const _pipelineFailures = [];
  const evaluations = new Map();
  for (const stock of stocks) {
    const ticker = (stock && stock.meta && stock.meta.ticker) || null;
    if (!ticker) continue;
    try {
      evaluations.set(ticker, Runner.evaluateStock(stock));
    } catch (e) {
      _pipelineFailures.push({ ticker, error: e.message });
    }
  }

  const result = {
    asOf: new Date().toISOString(),
    universeSize: stocks.length,
    modes: {},
    benchmarks: ['SPY', 'QQQ', 'IWM']
  };

  // Tag 138 / F-BT-003: collect ALL evaluated tickers for survivor-bias-free universe median.
  // Built directly from the stocks array so it's never empty even if a mode is disabled.
  const evaluatedTickers = stocks
    .filter(s => s && s.meta && s.meta.ticker)
    .map(s => s.meta.ticker);

  for (const modeId of ['HYPERGROWTH', 'QUALITY_COMPOUNDER', 'TURNAROUND']) {
    const mode = SM.MODES[modeId];
    if (!mode || mode.enabled === false) { result.modes[modeId] = []; continue; }
    const picks = [];
    for (const stock of stocks) {
      try {
        const ticker = stock && stock.meta && stock.meta.ticker;
        if (!ticker) continue;
        // F-PF-001: reuse pre-computed evaluation; no second call to Runner.evaluateStock
        const results = evaluations.get(ticker);
        if (!results) continue;
        const p = pickStockForMode(stock, modeId, results);
        if (p) picks.push(p);
      } catch (e) {
        const ticker = (stock && stock.meta && stock.meta.ticker) || '???';
        _pipelineFailures.push({ ticker, error: e.message });
      }
    }
    picks.sort((a, b) => {
      const sa = a.score, sb = b.score;
      if (sa != null && sb != null) return sb - sa;
      if (sa != null) return -1;
      if (sb != null) return 1;
      const va = a.primaryMetric.value, vb = b.primaryMetric.value;
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      return vb - va;
    });
    const deduped = dedupePicksByCompany(picks);
    const top100 = deduped.slice(0, 100);
    // Tag 134 — Phase 4.1: enrich each pick with firstSeenAt + weeksOnList
    const modeFirstSeen = firstSeenMap[modeId] || {};
    for (const p of top100) {
      const seen = modeFirstSeen[p.ticker];
      p.firstSeenAt = seen || today;
      p.weeksOnList = _weeksBetween(p.firstSeenAt, today);
    }
    result.modes[modeId] = top100;
    console.log('  ' + modeId + ': ' + picks.length + ' picks -> ' + deduped.length + ' deduped -> top ' + top100.length);
  }

  // Tag 138 / F-BT-003: save evaluated tickers for survivor-bias fix in walk-forward
  result.evaluatedTickers = evaluatedTickers;

  const dateStr = result.asOf.slice(0, 10);
  const outFile = path.join(args.out, dateStr + '.json');
  // F-SM-028 / F-GC-017 (Tag 189): atomic vintage + latest write so a kill
  // mid-write can't leave today's date.json truncated (downstream picks-history
  // consumers would treat that as "vintage missing" and silently drop the
  // window from walk-forward).
  writeFileAtomic(outFile, JSON.stringify(result, null, 2));
  console.log('Written: ' + outFile + ' (' + evaluatedTickers.length + ' evaluated tickers)');
  writeFileAtomic(path.join(args.out, 'latest.json'), JSON.stringify(result, null, 2));

  // F-PF-008: update first-seen cache with any newly seen tickers from this run
  let cacheUpdated = false;
  for (const modeId of ['HYPERGROWTH', 'QUALITY_COMPOUNDER', 'TURNAROUND']) {
    if (!firstSeenMap[modeId]) firstSeenMap[modeId] = {};
    for (const p of (result.modes[modeId] || [])) {
      if (!firstSeenMap[modeId][p.ticker]) {
        firstSeenMap[modeId][p.ticker] = p.firstSeenAt || today;
        cacheUpdated = true;
      }
    }
  }
  if (cacheUpdated || !fromCache) {
    _saveFirstSeenCache(args.out, firstSeenMap);
    console.log('  first-seen cache saved');
  }

  // Tag 168: write pipeline-health report and enforce 5% threshold
  // n_total counts stock × mode evaluations (3 modes × universe size)
  const n_total = stocks.length * 3;
  const n_failed = _pipelineFailures.length;
  const n_ok = n_total - n_failed;
  const failure_rate = n_total > 0 ? n_failed / n_total : 0;
  const healthDir = './pipeline-health';
  if (!fs.existsSync(healthDir)) fs.mkdirSync(healthDir, { recursive: true });
  const healthReport = { script: 'snapshot-picks', date: today, n_total, n_ok, n_failed, failure_rate, failures: _pipelineFailures };
  // Tag 217e: atomic write (consistent with the per-pick writeFileAtomic at
  // lines 146/278). Raw writeFileSync risked truncation on SIGKILL.
  writeFileAtomic(path.join(healthDir, 'snapshot-picks.json'), JSON.stringify(healthReport, null, 2));
  console.log('Pipeline health: ' + n_ok + '/' + n_total + ' ok (' + (failure_rate * 100).toFixed(2) + '% failed) — threshold 5%');
  if (failure_rate > 0.05) {
    console.error('::error::snapshot-picks failure rate ' + (failure_rate * 100).toFixed(2) + '% exceeds 5% threshold');
    process.exit(1);
  }
}

if (require.main === module) main().catch(e => { console.error('snapshot-picks failed: ' + e.message); process.exit(1); });
module.exports = { pickStockForMode, loadStocks };

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

function parseArgs(argv) {
  const args = { snapshots: './snapshots', out: './picks-history' };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--snapshots' && argv[i+1]) args.snapshots = argv[++i];
    else if (argv[i] === '--out' && argv[i+1]) args.out = argv[++i];
  }
  return args;
}

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

function pickStockForMode(stock, modeId) {
  let results;
  try { results = Runner.evaluateStock(stock); }
  catch (e) { return null; }
  const ev = SM.evaluateMode(stock, modeId, results);
  if (!ev || !ev.passed) return null;
  return {
    ticker: stock.meta.ticker,
    name: stock.meta.name || '',
    sector: stock.meta.sector || '',
    industry: stock.meta.industry || '',
    profState: getProfState(results),
    primaryMetric: primaryMetricFor(modeId, results),
    score: (ev.score != null) ? Math.round(ev.score * 10) / 10 : null,
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

// Tag 134 — Phase 4.1: build a per-mode { ticker -> firstSeenAt } map by reading
// all prior vintages. Used to enrich each pick with the date it was first seen
// in this mode (for "weeks on list" continuity and pick-stability investigation).
function _buildFirstSeenMap(picksHistDir) {
  const map = { HYPERGROWTH: {}, QUALITY_COMPOUNDER: {}, TURNAROUND: {} };
  if (!fs.existsSync(picksHistDir)) return map;
  const files = fs.readdirSync(picksHistDir)
    .filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort();
  for (const f of files) {
    let v;
    try { v = JSON.parse(fs.readFileSync(path.join(picksHistDir, f), 'utf8')); }
    catch (e) { continue; }
    const date = (v.asOf || '').slice(0, 10) || f.replace('.json', '');
    for (const mode of Object.keys(map)) {
      const arr = (v.modes && v.modes[mode]) || [];
      for (const p of arr) {
        if (!p || !p.ticker) continue;
        if (!map[mode][p.ticker]) map[mode][p.ticker] = date;
      }
    }
  }
  return map;
}

function _weeksBetween(isoA, isoB) {
  return Math.floor(Math.abs(new Date(isoB).getTime() - new Date(isoA).getTime()) / (7 * 86400000));
}

function main() {
  const args = parseArgs(process.argv);
  if (!fs.existsSync(args.out)) fs.mkdirSync(args.out, { recursive: true });
  console.log('Loading snapshots from', args.snapshots);
  const stocks = loadStocks(args.snapshots);
  console.log('  ' + stocks.length + ' stocks loaded');

  // Tag 134 — Phase 4.1: load prior-vintage first-seen map before computing this run's picks.
  const firstSeen = _buildFirstSeenMap(args.out);
  const today = new Date().toISOString().slice(0, 10);

  const result = {
    asOf: new Date().toISOString(),
    universeSize: stocks.length,
    modes: {},
    benchmarks: ['SPY', 'QQQ', 'IWM']
  };

  // Tag 138: collect ALL evaluated tickers for survivor-bias-free universe median.
  // Built directly from the stocks array so it's never empty even if a mode is disabled.
  const evaluatedTickers = stocks
    .filter(s => s && s.meta && s.meta.ticker)
    .map(s => s.meta.ticker);

  // Tag 168: track per-stock failures across all mode loops for pipeline health reporting
  const _pipelineFailures = [];

  for (const modeId of ['HYPERGROWTH', 'QUALITY_COMPOUNDER', 'TURNAROUND']) {
    const mode = SM.MODES[modeId];
    if (!mode || mode.enabled === false) { result.modes[modeId] = []; continue; }
    const picks = [];
    for (const stock of stocks) {
      try {
        const p = pickStockForMode(stock, modeId);
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
    const modeFirstSeen = firstSeen[modeId] || {};
    for (const p of top100) {
      const seen = modeFirstSeen[p.ticker];
      p.firstSeenAt = seen || today;
      p.weeksOnList = _weeksBetween(p.firstSeenAt, today);
    }
    result.modes[modeId] = top100;
    console.log('  ' + modeId + ': ' + picks.length + ' picks -> ' + deduped.length + ' deduped -> top ' + top100.length);
  }

  // Tag 138: save evaluated tickers for survivor-bias fix in walk-forward
  result.evaluatedTickers = evaluatedTickers;

  const dateStr = result.asOf.slice(0, 10);
  const outFile = path.join(args.out, dateStr + '.json');
  fs.writeFileSync(outFile, JSON.stringify(result, null, 2));
  console.log('Written: ' + outFile + ' (' + evaluatedTickers.length + ' evaluated tickers)');
  fs.writeFileSync(path.join(args.out, 'latest.json'), JSON.stringify(result, null, 2));

  // Tag 168: write pipeline-health report and enforce 5% threshold
  // n_total counts stock × mode evaluations (3 modes × universe size)
  const n_total = stocks.length * 3;
  const n_failed = _pipelineFailures.length;
  const n_ok = n_total - n_failed;
  const failure_rate = n_total > 0 ? n_failed / n_total : 0;
  const healthDir = './pipeline-health';
  if (!fs.existsSync(healthDir)) fs.mkdirSync(healthDir, { recursive: true });
  const healthReport = { script: 'snapshot-picks', date: today, n_total, n_ok, n_failed, failure_rate, failures: _pipelineFailures };
  fs.writeFileSync(path.join(healthDir, 'snapshot-picks.json'), JSON.stringify(healthReport, null, 2));
  console.log('Pipeline health: ' + n_ok + '/' + n_total + ' ok (' + (failure_rate * 100).toFixed(2) + '% failed) — threshold 5%');
  if (failure_rate > 0.05) {
    console.error('::error::snapshot-picks failure rate ' + (failure_rate * 100).toFixed(2) + '% exceeds 5% threshold');
    process.exit(1);
  }
}

if (require.main === module) main();
module.exports = { pickStockForMode, loadStocks };

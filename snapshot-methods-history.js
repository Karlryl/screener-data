#!/usr/bin/env node
/**
 * Tag 35 — Methods-History-Snapshot
 * Pro Run: speichert methods-history/YYYY-MM-DD.json mit allen Stock × Methoden Ergebnissen.
 * Über Zeit kummuliert dies → Backtest-Datenbasis.
 *
 * Run: node snapshot-methods-history.js [--snapshots ./snapshots] [--out methods-history/]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const Runner = require('./methods/runner.js');

function parseArgs(argv) {
  const args = { snapshots: './snapshots', out: './methods-history' };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--snapshots' && argv[i+1]) args.snapshots = argv[++i];
    else if (argv[i] === '--out' && argv[i+1]) args.out = argv[++i];
  }
  return args;
}

// F-PF-009 (Tag 179): the previous "async" loader wrapped fs.readFileSync in
// Promise.all — the sync call blocks the event loop so the batch ran serially,
// providing zero speedup. Use fs.promises.readFile to enable real parallel I/O
// (libuv thread pool defaults to 4 workers; UV_THREADPOOL_SIZE can raise it).
async function loadFilesAsync(dir, fileList) {
  const BATCH = 200;
  const results = [];
  for (let i = 0; i < fileList.length; i += BATCH) {
    const batch = fileList.slice(i, i + BATCH);
    const loaded = await Promise.all(batch.map(async f => {
      try {
        const raw = await fs.promises.readFile(path.join(dir, f), 'utf8');
        return { file: f, data: JSON.parse(raw), error: null };
      } catch (e) {
        return { file: f, data: null, error: e.message };
      }
    }));
    results.push(...loaded);
  }
  return results;
}

async function main() {
  const args = parseArgs(process.argv);
  if (!fs.existsSync(args.out)) fs.mkdirSync(args.out, { recursive: true });
  const today = new Date().toISOString().slice(0, 10);
  const outFile = path.join(args.out, `${today}.json`);

  const fileList = fs.readdirSync(args.snapshots).filter(f => f.endsWith('.json') && f !== '_manifest.json');
  const data = { date: today, stocks: {} };
  let allPass = 0, anyComputable = 0;

  // Tag 134 — Phase 3.4: record _quality.grade + input-field digest per stock per vintage.
  // Without this, a Yahoo data-shape change (like the Nov 2024 incomeStatementHistory thinning)
  // silently shifts every method's historical pass rate with no diagnostic trail.
  function _digest(stock) {
    return {
      // Currency normalization (Tag 134 Phase 1): record original currency for audit
      reportingCurrencyOriginal: stock.meta && stock.meta.reportingCurrencyOriginal || null,
      region: stock.meta && stock.meta.region || null,
      sector: stock.meta && stock.meta.sector || null,
      // Key inputs that most methods consume
      marketCapUsd: (stock.marketCap && stock.marketCap.value != null) ? stock.marketCap.value : null,
      revenueGrowthYoY: (stock.metrics && stock.metrics.revenueGrowthYoY && stock.metrics.revenueGrowthYoY.value != null) ? stock.metrics.revenueGrowthYoY.value : null,
      fcfMarginTTM: (stock.metrics && stock.metrics.fcfMarginTTM && stock.metrics.fcfMarginTTM.value != null) ? stock.metrics.fcfMarginTTM.value : null,
      operatingMargin: (stock.metrics && stock.metrics.operatingMargin && stock.metrics.operatingMargin.value != null) ? stock.metrics.operatingMargin.value : null,
      // Series shape (useful when a Yahoo endpoint suddenly returns fewer rows)
      annualRevN: (stock.annual && Array.isArray(stock.annual.annualRev)) ? stock.annual.annualRev.length : 0,
      annualFcfN: (stock.annual && Array.isArray(stock.annual.annualFCF)) ? stock.annual.annualFCF.length : 0,
      revenueQN: (stock.timeseries && Array.isArray(stock.timeseries.revenueQ)) ? stock.timeseries.revenueQ.length : 0
    };
  }

  // Tag 168: track per-stock failures for pipeline health reporting
  const _pipelineFailures = [];

  // F-PF-007: load all files in async batches
  const loaded = await loadFilesAsync(args.snapshots, fileList);

  for (const { file, data: stock, error } of loaded) {
    if (error || !stock) {
      const ticker = file.replace(/\.json$/, '');
      _pipelineFailures.push({ ticker, error: error || 'null data' });
      continue;
    }
    const ticker = (stock.meta && stock.meta.ticker) || file.replace(/\.json$/, '');
    let results;
    try { results = Runner.evaluateStock(stock); }
    catch (e) {
      _pipelineFailures.push({ ticker, error: e.message });
      continue;
    }
    const compact = {};
    let computableCount = 0, passCount = 0;
    for (const [mid, r] of Object.entries(results)) {
      if (!r) continue;
      compact[mid] = { value: r.computable ? r.value : null, pass: r.computable ? r.pass : null };
      if (r.computable) computableCount++;
      if (r.computable && r.pass) passCount++;
    }
    // F-BT-008: ensure quality field is always present (null for stocks without _quality).
    // method-effectiveness.js reads this field for byQuality split; must not be absent.
    const qualityGrade = (stock._quality && stock._quality.grade) ? stock._quality.grade : null;
    data.stocks[ticker] = {
      results: compact,
      computable: computableCount,
      passing: passCount,
      // Tag 134 — Phase 3.4 / F-BT-008: quality is always present (null when _quality absent)
      quality: qualityGrade,
      nanRatio: (stock._quality && stock._quality.nanRatio) != null ? stock._quality.nanRatio : null,
      inputs: _digest(stock)
    };
    if (computableCount > 0) anyComputable++;
    if (computableCount === Object.keys(results).length && passCount === computableCount) allPass++;
  }
  data.summary = {
    totalStocks: fileList.length,
    anyComputable, allPass,
    methodCount: Runner.getMethods().length
  };
  // F-PF-005: use JSON.stringify without indent (machine-readable only file, saves ~30-40% size and ~5-10x stringify time)
  // F-SM-005: atomic write via tmp+rename to prevent unparseable partial-write on SIGKILL
  const tmpFile = outFile + '.tmp';
  fs.writeFileSync(tmpFile, JSON.stringify(data));
  fs.renameSync(tmpFile, outFile);
  console.log(`✓ History-Snapshot: ${outFile}`);
  console.log(`  ${fileList.length} stocks, ${anyComputable} mit ≥1 computable, ${allPass} stocks pass alle Methoden`);

  // Tag 168: write pipeline-health report and enforce 5% threshold
  const n_total = fileList.length;
  const n_failed = _pipelineFailures.length;
  const n_ok = n_total - n_failed;
  const failure_rate = n_total > 0 ? n_failed / n_total : 0;
  const healthDir = './pipeline-health';
  if (!fs.existsSync(healthDir)) fs.mkdirSync(healthDir, { recursive: true });
  const healthReport = { script: 'snapshot-methods-history', date: today, n_total, n_ok, n_failed, failure_rate, failures: _pipelineFailures };
  fs.writeFileSync(path.join(healthDir, 'snapshot-methods-history.json'), JSON.stringify(healthReport, null, 2));
  console.log(`Pipeline health: ${n_ok}/${n_total} ok (${(failure_rate * 100).toFixed(2)}% failed) — threshold 5%`);
  if (failure_rate > 0.05) {
    console.error(`::error::snapshot-methods-history failure rate ${(failure_rate * 100).toFixed(2)}% exceeds 5% threshold`);
    process.exit(1);
  }
}
main().catch(e => { console.error('snapshot-methods-history failed: ' + e.message); process.exit(1); });

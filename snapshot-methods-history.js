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
// Tag 217e: atomic write for pipeline-health output (see line ~140).
const { writeFileAtomic } = require('./lib/atomic-write.js');

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
  // Tag 219 (audit F-219b-01): prefer the workflow-frozen RUN_DATE_UTC so all
  // snapshot-* scripts agree on TODAY even when the Yahoo pull crosses UTC
  // midnight. Falls back to Date.now() for local-dev / manual invocations.
  const today = process.env.RUN_DATE_UTC || new Date().toISOString().slice(0, 10);
  const outFile = path.join(args.out, `${today}.json`);

  // Tag 227c-1 (audit F-227c-01 HIGH fix): exclude ALL '_*' files, not just
  // _manifest.json. snapshots/ contains '_manifest.json' AND '_manifest-full.json'
  // (introduced by pull-yahoo). The pre-Tag 220 substring-match here let
  // _manifest-full.json through, so Runner.evaluateStock({pulled_at,...}) ran on
  // it and the resulting fake "_manifest-full" ticker was written to every
  // methods-history vintage since 2026-05-14 — confirmed in 2026-05-14.json and
  // 2026-05-15.json. Polluted history feeds method-effectiveness analytics with
  // a no-price-data ghost ticker. Mirror generate-modes-report.js's Tag 220 fix
  // (F-GR-002 HIGH): startsWith('_') is the canonical exclusion rule because
  // pull-yahoo never writes a stock snapshot starting with '_'.
  const fileList = fs.readdirSync(args.snapshots).filter(f => f.endsWith('.json') && !f.startsWith('_'));
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
    // Tag 228b-3 (audit F-227c-06 LOW fix): the previous denominator for the
    // allPass check used `Object.keys(results).length`, which counted methods
    // whose result was null/falsy (skipped by `if (!r) continue`). Today
    // runner.evaluateStock always returns a wrapped result, so no null entries
    // appear in practice — but the moment a future method is permitted to
    // return null, allPass would silently undercount (denominator inflated by
    // skipped entries). Count only the methods we actually evaluated.
    const compact = {};
    let computableCount = 0, passCount = 0, totalEval = 0;
    for (const [mid, r] of Object.entries(results)) {
      if (!r) continue;
      totalEval++;
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
    if (totalEval > 0 && computableCount === totalEval && passCount === computableCount) allPass++;
  }
  // Tag 232c-16 (audit F-BT-005 MEDIUM): write generatedAt so method-
  // effectiveness.js's fallback to `(asOf + 'T00:00:00Z')` doesn't always
  // fire. Pre-fix, every methods-history vintage anchored at midnight UTC
  // which silently shifted alpha computations by +T relative to walk-
  // forward's behavior on the SAME vintage date. Now the timestamp
  // reflects when the script actually ran (post-pull, typically late
  // UTC) which aligns with walk-forward's anchor.
  data.generatedAt = new Date().toISOString();
  data.summary = {
    totalStocks: fileList.length,
    anyComputable, allPass,
    methodCount: Runner.getMethods().length
  };
  // F-PF-005: use JSON.stringify without indent (machine-readable only file, saves ~30-40% size and ~5-10x stringify time)
  // Tag 232c-5 (audit F-SM-002 HIGH): route the methods-history vintage (the
  // 14 MB source of truth for every backtest) through lib/atomic-write so the
  // Tag 230c-1 durability guarantees (POSIX parent-dir fsync, Windows EPERM
  // retry, partial-write loop) actually cover the write. Prior hand-rolled
  // tmp+rename missed every one of those.
  writeFileAtomic(outFile, JSON.stringify(data));
  console.log(`✓ History-Snapshot: ${outFile}`);
  console.log(`  ${fileList.length} stocks, ${anyComputable} mit ≥1 computable, ${allPass} stocks pass alle Methoden`);

  // Tag 168: write pipeline-health report and enforce 5% threshold
  const n_total = fileList.length;
  const n_failed = _pipelineFailures.length;
  const n_ok = n_total - n_failed;
  const failure_rate = n_total > 0 ? n_failed / n_total : 0;
  const healthDir = path.join(__dirname, 'pipeline-health');
  if (!fs.existsSync(healthDir)) fs.mkdirSync(healthDir, { recursive: true });
  const healthReport = { script: 'snapshot-methods-history', date: today, n_total, n_ok, n_failed, failure_rate, failures: _pipelineFailures };
  // Tag 217e: atomic write (was raw writeFileSync; on GitHub Actions step
  // timeout SIGKILL mid-write the Pipeline Health Check would treat the
  // truncated file as 'every expected script crashed').
  writeFileAtomic(path.join(healthDir, 'snapshot-methods-history.json'), JSON.stringify(healthReport, null, 2));
  console.log(`Pipeline health: ${n_ok}/${n_total} ok (${(failure_rate * 100).toFixed(2)}% failed) — threshold 5%`);
  if (failure_rate > 0.05) {
    console.error(`::error::snapshot-methods-history failure rate ${(failure_rate * 100).toFixed(2)}% exceeds 5% threshold`);
    process.exit(1);
  }
}
main().catch(e => { console.error('snapshot-methods-history failed: ' + e.message); process.exit(1); });

'use strict';
/**
 * fitness/measure.js
 * Orchestrator/CLI: reads baseline + prices, computes ranking-quality metrics
 * per pre-registered horizon, writes fitness/outputs/measure-<baselineId>.json.
 *
 * PENDING is the expected state when prices haven't yet reached the exit date.
 * Exit 0 always — PENDING is valid.
 *
 * Usage (from screener-data/):
 *   node fitness/measure.js [baselinePath]
 */

const fs   = require('fs');
const path = require('path');

const wf = require('../scripts/walk-forward-perf.js');
const { buildPriceIndex, addDaysIso, maxPriceDate, businessDaysSince } = wf;

const { classify, resolveWindow } = require('./lib/forward-returns.js');
const { rankIC, cohortSpread, hitRate, quintileMonotonicity } = require('./lib/metrics.js');

// ─── Pure helper exported for testing ──────────────────────────────────────────
/**
 * isHorizonPending(newestPriceIso, t0Iso, horizonDays, addDaysIsoFn)
 * Returns true if the price history doesn't yet reach the horizon exit date.
 * Pure — no I/O, no Date.now().
 */
function isHorizonPending(newestPriceIso, t0Iso, horizonDays, addDaysIsoFn) {
  const t0Date    = t0Iso.slice(0, 10);
  const exitTarget = addDaysIsoFn(t0Date, horizonDays);
  return newestPriceIso < exitTarget;
}

// ─── Atomic write ───────────────────────────────────────────────────────────────
function atomicWriteJson(filePath, data) {
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, filePath);
}

// ─── Main ──────────────────────────────────────────────────────────────────────
function main() {
  const baselinePath = process.argv[2] || 'fitness/baselines/saas-v1.0-degraded-2026-06-16.json';

  // 1. Load inputs
  if (!fs.existsSync(baselinePath)) {
    console.error(`[measure] FATAL: baseline not found: ${baselinePath}`);
    process.exit(1);
  }
  const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));

  const historyPath = 'prices/history.json';
  if (!fs.existsSync(historyPath)) {
    console.error(`[measure] FATAL: prices not found: ${historyPath}`);
    process.exit(1);
  }
  const history = JSON.parse(fs.readFileSync(historyPath, 'utf8'));

  // 2. Build price index
  const priceIndex = buildPriceIndex(history);

  // 3. Determine universe and ranking
  let evaluatedTickers = baseline.evaluatedTickers;
  if (!evaluatedTickers || evaluatedTickers.length === 0) {
    if (baseline.ranking && baseline.ranking.length > 0) {
      console.warn('[measure] WARNING: evaluatedTickers missing — falling back to ranking tickers (survivorship bias risk)');
      evaluatedTickers = baseline.ranking.map(r => r.ticker);
    } else {
      console.error('[measure] FATAL: neither evaluatedTickers nor ranking present in baseline');
      process.exit(1);
    }
  }

  const rankingEntries = baseline.ranking.map(r => ({ ticker: r.ticker, score: r.score }));
  const universeSize   = baseline.universeSize || evaluatedTickers.length;

  // 4. Reference timestamps
  const frozenAt   = baseline.frozenAt; // e.g. "2026-06-16"
  const t0Iso      = frozenAt + 'T00:00:00Z';
  const newestPrice = maxPriceDate(history);
  const dataFreshnessBusinessDays = businessDaysSince(newestPrice, frozenAt);

  // 5. Per-horizon computation
  const horizons = (baseline.preRegistration && baseline.preRegistration.horizonsDays) || [28, 84];
  const horizonResults = {};

  for (const horizon of horizons) {
    const exitTarget = addDaysIso(frozenAt, horizon);

    // Check staleness first
    if (isHorizonPending(newestPrice, t0Iso, horizon, addDaysIso)) {
      horizonResults[horizon] = {
        status:       'PENDING_PRICES',
        horizon,
        reason:       `Prices end ${newestPrice}; need through ${exitTarget} for ${horizon}d exit. Pull fresh prices first.`,
        neededThrough: exitTarget,
        newestPrice,
      };
      continue;
    }

    // Resolve canonical window via benchmark
    const window = resolveWindow(priceIndex, t0Iso, horizon);
    if (window.insufficient) {
      horizonResults[horizon] = {
        status:  'PENDING_PRICES',
        horizon,
        reason:  `Benchmark series insufficient for ${horizon}d window anchoring.`,
        neededThrough: exitTarget,
        newestPrice,
      };
      continue;
    }

    const { entryDate, exitDate, benchmarkTicker, horizonActualDays } = window;

    // Classify every evaluated ticker
    const survivorshipCounts = { ok: 0, delisted: 0, no_series: 0, no_entry_price: 0 };
    const returnByTickerNaive        = {}; // drop missing/delisted
    const returnByTickerConservative = {}; // delisted → -1.0

    for (const ticker of evaluatedTickers) {
      const { status, ret } = classify(priceIndex, ticker, entryDate, exitDate);
      survivorshipCounts[status] = (survivorshipCounts[status] || 0) + 1;

      if (status === 'ok') {
        returnByTickerNaive[ticker]        = ret;
        returnByTickerConservative[ticker] = ret;
      } else if (status === 'delisted') {
        // naive: drop; conservative: -1.0
        returnByTickerConservative[ticker] = -1.0;
      }
      // no_series and no_entry_price: dropped from both
    }

    const ok      = survivorshipCounts.ok || 0;
    const delisted = survivorshipCounts.delisted || 0;
    const coverage = (ok + delisted) / universeSize;
    const coverageFlag = coverage < 0.90 ? 'NOT_READY_COVERAGE' : 'ok';

    // Cohort sizes
    const cohortN8       = 8;
    const cohortNDecile  = Math.ceil(0.10 * universeSize);

    // Metrics — naive (drop) variant
    const icNaive        = rankIC(rankingEntries, returnByTickerNaive);
    const spread8Naive   = cohortSpread(rankingEntries, returnByTickerNaive,       { cohortN: cohortN8 });
    const spreadDNaive   = cohortSpread(rankingEntries, returnByTickerNaive,       { cohortN: cohortNDecile, label: 'top-decile' });
    const hitNaive       = hitRate(rankingEntries,      returnByTickerNaive,       cohortN8);
    const quinNaive      = quintileMonotonicity(rankingEntries, returnByTickerNaive);

    // Metrics — conservative (delisted=−100%) variant
    const icConservative      = rankIC(rankingEntries, returnByTickerConservative);
    const spread8Conservative = cohortSpread(rankingEntries, returnByTickerConservative, { cohortN: cohortN8 });
    const spreadDConservative = cohortSpread(rankingEntries, returnByTickerConservative, { cohortN: cohortNDecile, label: 'top-decile' });
    const hitConservative     = hitRate(rankingEntries, returnByTickerConservative, cohortN8);
    const quinConservative    = quintileMonotonicity(rankingEntries, returnByTickerConservative);

    horizonResults[horizon] = {
      status: coverageFlag,
      horizon,
      entryDate,
      exitDate,
      horizonActualDays,
      benchmarkTicker,
      survivorshipCounts,
      coverage: parseFloat(coverage.toFixed(4)),
      cohortDefinition: { cohortN8, cohortNDecile },
      naive: {
        rankIC:               icNaive,
        cohortSpread_top8:    spread8Naive,
        cohortSpread_decile:  spreadDNaive,
        hitRate:              hitNaive,
        quintileMonotonicity: quinNaive,
      },
      conservative: {
        rankIC:               icConservative,
        cohortSpread_top8:    spread8Conservative,
        cohortSpread_decile:  spreadDConservative,
        hitRate:              hitConservative,
        quintileMonotonicity: quinConservative,
      },
    };
  }

  // 6. Write output
  const outputDir = 'fitness/outputs';
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const outFile = path.join(outputDir, `measure-${baseline.baselineId}.json`);
  const output  = {
    baselineId:               baseline.baselineId,
    generatedFor:             t0Iso,
    newestPriceDate:          newestPrice,
    dataFreshnessBusinessDays,
    universeSize,
    horizons:                 horizonResults,
    cohortDefinitionNote:     'top-N by score desc, tie-break ticker.localeCompare; universe=evaluatedTickers',
  };

  atomicWriteJson(outFile, output);

  // 7. Human summary
  console.log('');
  console.log(`Fitness Measurement — ${baseline.baselineId}`);
  console.log(`  t0:          ${frozenAt}`);
  console.log(`  newestPrice: ${newestPrice}`);
  console.log(`  staleness:   ${dataFreshnessBusinessDays} business days`);
  console.log(`  universe:    ${universeSize} tickers`);
  console.log('');
  for (const h of horizons) {
    const r = horizonResults[h];
    if (r.status === 'PENDING_PRICES') {
      console.log(`  Horizon ${h}d: PENDING_PRICES — ${r.reason}`);
    } else {
      console.log(`  Horizon ${h}d: ${r.status} | coverage=${(r.coverage*100).toFixed(1)}%`);
      console.log(`    Rank-IC (naive): ${r.naive.rankIC.ic !== null ? r.naive.rankIC.ic.toFixed(4) : 'null'} (n=${r.naive.rankIC.n})`);
      console.log(`    Spread top-8 (naive): ${r.naive.cohortSpread_top8.spread !== null ? (r.naive.cohortSpread_top8.spread*100).toFixed(2)+'%' : 'null'}`);
    }
  }
  console.log('');
  console.log(`  Output: ${outFile}`);
  console.log('');
}

if (require.main === module) {
  main();
}

module.exports = { isHorizonPending };

#!/usr/bin/env node
/**
 * Tag 39 — Backtest-Pass-vs-Fail Performance
 * Joint methods-history × prices/history.json: für jeden run-date schaut
 * Pass-Stocks vs. Fail-Stocks performance über die folgenden N Tage.
 *
 * Run: node backtest-pass-vs-fail.js [--methods methods-history/] [--prices prices/] [--horizon 30]
 */
'use strict';
const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const args = { methods: './methods-history', prices: './prices', horizon: 30 };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--methods' && argv[i+1]) args.methods = argv[++i];
    else if (argv[i] === '--prices' && argv[i+1]) args.prices = argv[++i];
    else if (argv[i] === '--horizon' && argv[i+1]) args.horizon = parseInt(argv[++i], 10);
  }
  return args;
}

function dateAddDays(dateStr, days) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function runForHorizon(args, horizon) {
  console.log('═'.repeat(70));
  console.log(`Horizon: ${horizon} days`);
  args.horizon = horizon;
  runMain(args);
}

function runMain(args) {
  if (!fs.existsSync(args.methods)) { console.error(`No methods-history at ${args.methods}`); process.exit(1); }
  const histPath = path.join(args.prices, 'history.json');
  if (!fs.existsSync(histPath)) { console.error(`No prices history at ${histPath}`); process.exit(1); }

  const priceHist = JSON.parse(fs.readFileSync(histPath, 'utf8'));
  const methodFiles = fs.readdirSync(args.methods).filter(f => f.endsWith('.json')).sort();

  console.log(`Backtest Horizon: ${args.horizon} days`);
  console.log('─'.repeat(70));
  console.log(`${methodFiles.length} method-snapshot(s) zum Vergleichen verfügbar`);

  if (methodFiles.length === 0) {
    console.log('Keine Daten — pull mehrere Runs erst.');
    return;
  }

  // For each method-snapshot date: define "pass-7+/10" vs "fail" cohort
  for (const f of methodFiles) {
    const data = JSON.parse(fs.readFileSync(path.join(args.methods, f), 'utf8'));
    const date = data.date;
    const targetDate = dateAddDays(date, args.horizon);

    const passCohort = [], failCohort = [];
    for (const [ticker, info] of Object.entries(data.stocks)) {
      const computable = info.computable, passing = info.passing;
      const ratio = computable > 0 ? passing / computable : 0;
      if (ratio >= 0.7) passCohort.push(ticker);
      else if (computable >= 5) failCohort.push(ticker);  // only count fails with sufficient data
    }

    // Compute returns
    function avgReturn(cohort) {
      const returns = [];
      for (const t of cohort) {
        const series = priceHist[t] || [];
        const startEntry = series.find(e => e.date === date) || series.find(e => e.date >= date);
        const endEntry = series.find(e => e.date === targetDate) || series.find(e => e.date >= targetDate);
        if (!startEntry || !endEntry || startEntry === endEntry) continue;
        const ret = (endEntry.close - startEntry.close) / startEntry.close;
        returns.push(ret);
      }
      if (returns.length === 0) return null;
      const avg = returns.reduce((a, b) => a + b, 0) / returns.length;
      return { avg, count: returns.length };
    }

    const passReturn = avgReturn(passCohort);
    const failReturn = avgReturn(failCohort);
    console.log(`\n[${date} → ${targetDate}]`);
    console.log(`  Pass-Cohort (≥70% pass): ${passCohort.length} stocks${passReturn ? `, avg return ${(passReturn.avg*100).toFixed(2)}% (n=${passReturn.count})` : ' — keine Preisdaten'}`);
    console.log(`  Fail-Cohort: ${failCohort.length} stocks${failReturn ? `, avg return ${(failReturn.avg*100).toFixed(2)}% (n=${failReturn.count})` : ' — keine Preisdaten'}`);
    if (passReturn && failReturn) {
      const alpha = passReturn.avg - failReturn.avg;
      console.log(`  Alpha (Pass - Fail): ${(alpha*100).toFixed(2)}%`);
    }
  }
  console.log('Datenpunkt(e):', methodFiles.length);
}

function main() {
  const args = parseArgs(process.argv);
  // Tag-57: dual horizon 30 + 90
  runForHorizon(args, 30);
  runForHorizon(args, 90);
}
main();

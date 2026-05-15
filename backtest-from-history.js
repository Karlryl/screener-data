#!/usr/bin/env node
'use strict';
const fs = require('fs');
const Runner = require('./methods/runner.js');

const HORIZON_DAYS = parseInt(process.argv[2] || '70', 10);
const THRESHOLD_PCT = parseInt(process.argv[3] || '50', 10);

const wl = JSON.parse(fs.readFileSync('./watchlist.json'));
const prices = JSON.parse(fs.readFileSync('./prices/history.json'));

console.log(`10-Wochen Backtest (${HORIZON_DAYS} Tage, threshold ≥${THRESHOLD_PCT}%)`);
console.log('═'.repeat(70));

const stocks = [];
for (const s of wl.stocks) {
  const snapPath = './snapshots/' + s.ticker + '.json';
  if (!fs.existsSync(snapPath)) continue;
  const stockData = JSON.parse(fs.readFileSync(snapPath));
  const r = Runner.evaluateStock(stockData);
  let pass = 0, comp = 0;
  for (const x of Object.values(r)) { if (x.computable) comp++; if (x.computable && x.pass) pass++; }
  if (comp === 0) continue;

  const series = prices[s.ticker];
  if (!series || series.length < 50) continue;
  const startQ = series[0];
  const endQ = series[series.length - 1];
  if (!startQ || !endQ || startQ.close <= 0) continue;
  const ret = (endQ.close - startQ.close) / startQ.close;
  stocks.push({ ticker: s.ticker, sector: stockData.meta && stockData.meta.sector, pass, comp, passRatio: pass/comp, startPrice: startQ.close, endPrice: endQ.close, startDate: startQ.date, endDate: endQ.date, ret });
}

console.log(`${stocks.length} stocks evaluierbar (von ${wl.stocks.length})`);
console.log(`Period: ${stocks[0]?.startDate} → ${stocks[0]?.endDate}`);

const passCohort = stocks.filter(s => s.passRatio * 100 >= THRESHOLD_PCT);
const failCohort = stocks.filter(s => s.passRatio * 100 < THRESHOLD_PCT);

function avg(arr) { return arr.length ? arr.reduce((a,b)=>a+b,0)/arr.length : null; }
function median(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a,b) => a-b); const m = Math.floor(s.length/2);
  return s.length % 2 ? s[m] : (s[m-1] + s[m])/2;
}

console.log('\n─ Pass-Cohort (≥' + THRESHOLD_PCT + '% pass): ' + passCohort.length + ' stocks');
const passReturns = passCohort.map(s => s.ret);
console.log('  Avg return:    ' + (avg(passReturns)*100).toFixed(2) + '%');
console.log('  Median return: ' + (median(passReturns)*100).toFixed(2) + '%');
console.log('  Best: ' + passCohort.sort((a,b)=>b.ret-a.ret).slice(0,3).map(s => `${s.ticker} ${(s.ret*100).toFixed(0)}%`).join(', '));

console.log('\n─ Fail-Cohort: ' + failCohort.length + ' stocks');
const failReturns = failCohort.map(s => s.ret);
console.log('  Avg return:    ' + (avg(failReturns)*100).toFixed(2) + '%');
console.log('  Median return: ' + (median(failReturns)*100).toFixed(2) + '%');
console.log('  Worst: ' + failCohort.sort((a,b)=>a.ret-b.ret).slice(0,3).map(s => `${s.ticker} ${(s.ret*100).toFixed(0)}%`).join(', '));

const alphaAvg = avg(passReturns) - avg(failReturns);
const alphaMed = median(passReturns) - median(failReturns);
console.log('\n═ Alpha (Pass - Fail) ═');
console.log('  Avg:    ' + (alphaAvg*100).toFixed(2) + '%');
console.log('  Median: ' + (alphaMed*100).toFixed(2) + '%');

console.log('\n─── Per-Pass-Bucket ───');
const buckets = { '14-22 (top)': [], '11-13 (high)': [], '7-10 (mid)': [], '0-6 (low)': [] };
for (const s of stocks) {
  if (s.pass >= 14) buckets['14-22 (top)'].push(s);
  else if (s.pass >= 11) buckets['11-13 (high)'].push(s);
  else if (s.pass >= 7) buckets['7-10 (mid)'].push(s);
  else buckets['0-6 (low)'].push(s);
}
console.log('Bucket'.padEnd(20) + 'N'.padEnd(5) + 'Avg-Ret  Median-Ret');
for (const [name, arr] of Object.entries(buckets)) {
  if (!arr.length) continue;
  const a = avg(arr.map(s => s.ret));
  const m = median(arr.map(s => s.ret));
  console.log(name.padEnd(20) + String(arr.length).padEnd(5) + (a*100).toFixed(2).padStart(7) + '%  ' + (m*100).toFixed(2).padStart(7) + '%');
}

console.log('\n─── Top 10 Performer ───');
stocks.sort((a,b) => b.ret - a.ret);
for (const s of stocks.slice(0, 10)) {
  console.log('  ' + s.ticker.padEnd(8) + s.pass + '/' + s.comp + '  ' + (s.ret*100).toFixed(1) + '%');
}

console.log('\n─── Bottom 10 ───');
for (const s of stocks.slice(-10).reverse()) {
  console.log('  ' + s.ticker.padEnd(8) + s.pass + '/' + s.comp + '  ' + (s.ret*100).toFixed(1) + '%');
}

// F-BT-002/F-GC-002 (Tag 179): same look-ahead bias as backtest-10-weeks.js — stamp _bias flag.
fs.writeFileSync('./backtest-10w-result.json', JSON.stringify({
  generatedAt: new Date().toISOString(),
  _bias: {
    lookAheadBias: true,
    reason: 'methods evaluated on TODAY snapshot, returns measured retroactively',
    preferredAlternative: 'walk-forward-perf.js (uses frozen vintage methods-history)'
  },
  horizonDays: HORIZON_DAYS, thresholdPct: THRESHOLD_PCT, alphaAvg, alphaMed,
  passCohort: passCohort.length, failCohort: failCohort.length,
  stocks: stocks.sort((a,b)=>b.ret-a.ret)
}, null, 2));
console.log('\n✓ Saved backtest-10w-result.json');
console.log('\nLimitierung: Forward-Looking-Bias. Methoden-Werte sind HEUTE.');

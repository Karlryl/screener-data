#!/usr/bin/env node
/**
 * Tag 62 — Watchlist-Wachstums-Vorschläge
 * Pulle Universe-Liste, score, find candidates die ≥N/17 pass aber nicht in Karl's WL.
 *
 * Usage: node suggest-watchlist-additions.js --universe path/to/tickers.txt [--threshold 10]
 */
'use strict';
const fs = require('fs');
const path = require('path');
let yf;
try {
  const YF = require('yahoo-finance2').default;
  yf = (typeof YF === 'function') ? new YF() : YF;
} catch (e) { console.error('yahoo-finance2 not installed'); process.exit(1); }

const Runner = require('./methods/runner.js');

function parseArgs(argv) {
  const args = { universe: './universe-candidates.txt', threshold: 10, watchlist: './watchlist.json', rateLimit: 1500 };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--universe' && argv[i+1]) args.universe = argv[++i];
    else if (argv[i] === '--threshold' && argv[i+1]) args.threshold = parseInt(argv[++i], 10);
    else if (argv[i] === '--watchlist' && argv[i+1]) args.watchlist = argv[++i];
  }
  return args;
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function pullStock(ticker) {
  // Minimal pull for evaluation: same fields wie pull-yahoo aber komprimiert
  try {
    const ks = await yf.quoteSummary(ticker, {
      modules: ['price', 'summaryDetail', 'defaultKeyStatistics', 'financialData', 'assetProfile', 'incomeStatementHistory', 'balanceSheetHistory', 'cashflowStatementHistory']
    });
    const period1 = new Date(Date.now() - 5 * 365 * 86400 * 1000);
    const period2 = new Date();
    let annualFin = [], annualCash = [], annualBs = [];
    try { annualFin = await yf.fundamentalsTimeSeries(ticker, { period1, period2, type: 'annual', module: 'financials' }); } catch (e) {}
    try { annualCash = await yf.fundamentalsTimeSeries(ticker, { period1, period2, type: 'annual', module: 'cash-flow' }); } catch (e) {}
    try { annualBs = await yf.fundamentalsTimeSeries(ticker, { period1, period2, type: 'annual', module: 'balance-sheet' }); } catch (e) {}

    function ftsArr(rows, key) {
      return (rows || []).slice().reverse().map(r => r && r[key]).filter(v => v != null);
    }
    const _val = (v) => v != null ? { value: v } : null;

    const rev = ftsArr(annualFin, 'totalRevenue').map(v => ({ value: v, currency: 'USD' }));
    const opInc = ftsArr(annualFin, 'operatingIncome').map(v => ({ value: v }));
    const ni = ftsArr(annualFin, 'netIncome').map(v => ({ value: v }));
    const gp = ftsArr(annualFin, 'grossProfit').map(v => ({ value: v }));
    const fcf = ftsArr(annualCash, 'freeCashFlow').map(v => ({ value: v }));
    const sbc = ftsArr(annualCash, 'stockBasedCompensation');
    const capex = ftsArr(annualCash, 'capitalExpenditure');

    const annualBalance = (annualBs || []).slice().reverse().map(r => {
      if (!r) return null;
      return {
        totalAssets: r.totalAssets,
        totalCash: r.cashAndCashEquivalents || r.cashAndShortTermInvestments,
        totalDebt: (r.currentDebt || 0) + (r.longTermDebt || 0)
      };
    }).filter(Boolean);

    const fd = ks.financialData || {};
    const sd = ks.summaryDetail || {};
    const dks = ks.defaultKeyStatistics || {};
    const ap = ks.assetProfile || {};
    const pr = ks.price || {};

    return {
      meta: { ticker, name: pr.longName || ticker, sector: ap.sector, industry: ap.industry },
      marketCap: pr.marketCap ? { value: pr.marketCap } : null,
      metrics: {
        revenueTTM: fd.totalRevenue ? { value: fd.totalRevenue } : null,
        revenueGrowthYoY: fd.revenueGrowth ? { value: fd.revenueGrowth * 100 } : null,
        fcfMarginTTM: (fd.freeCashflow && fd.totalRevenue) ? { value: (fd.freeCashflow / fd.totalRevenue) * 100 } : null,
        grossMargin: fd.grossMargins ? { value: fd.grossMargins * 100 } : null,
        operatingMargin: fd.operatingMargins ? { value: fd.operatingMargins * 100 } : null,
        forwardPE: dks.forwardPE ? { value: dks.forwardPE } : null,
        pe: sd.trailingPE ? { value: sd.trailingPE } : null,
        insidersOwnership: dks.heldPercentInsiders ? { value: dks.heldPercentInsiders } : null
      },
      annual: {
        annualRev: rev, annualOpInc: opInc, annualNetIncome: ni, annualGP: gp, annualFCF: fcf,
        annualBalance, annualSBC: sbc, annualCapex: capex
      }
    };
  } catch (e) {
    return null;
  }
}

async function main() {
  const args = parseArgs(process.argv);
  if (!fs.existsSync(args.universe)) {
    console.error(`Universe file fehlt: ${args.universe}`);
    console.error('Format: 1 ticker pro Zeile');
    process.exit(1);
  }
  const wl = JSON.parse(fs.readFileSync(args.watchlist, 'utf8'));
  const wlSet = new Set(wl.stocks.map(s => s.ticker));
  const universe = fs.readFileSync(args.universe, 'utf8').split(/\r?\n/).map(s => s.trim().toUpperCase()).filter(s => s && !s.startsWith('#'));
  const candidates = universe.filter(t => !wlSet.has(t));

  console.log(`Scanning ${candidates.length} candidates (universe: ${universe.length}, in WL: ${universe.length - candidates.length})`);
  console.log(`Threshold: ≥${args.threshold} of 17 methods pass`);
  console.log('─'.repeat(60));

  const results = [];
  for (const t of candidates) {
    process.stdout.write(`  ${t}... `);
    const stock = await pullStock(t);
    await sleep(args.rateLimit);
    if (!stock) { console.log('skip (no data)'); continue; }
    const r = Runner.evaluateStock(stock);
    let pass = 0, comp = 0;
    for (const x of Object.values(r)) { if (x.computable) comp++; if (x.computable && x.pass) pass++; }
    console.log(`${pass}/${comp}`);
    results.push({ ticker: t, name: stock.meta.name, sector: stock.meta.sector, pass, comp });
  }

  const winners = results.filter(r => r.pass >= args.threshold).sort((a, b) => b.pass - a.pass);
  console.log('\n' + '═'.repeat(60));
  console.log(`Vorschläge mit ≥${args.threshold}/17 pass:`);
  if (winners.length === 0) {
    console.log('Keine Kandidaten erfüllen die Schwelle.');
  } else {
    for (const w of winners) {
      console.log(`  ${w.ticker.padEnd(8)} ${w.pass}/${w.comp}  ${w.sector || '?'} — ${w.name || ''}`);
    }
  }
  // Save
  const outPath = './suggested-additions.json';
  fs.writeFileSync(outPath, JSON.stringify({ generatedAt: new Date().toISOString(), threshold: args.threshold, candidates: winners }, null, 2));
  console.log(`\n✓ Saved to ${outPath}`);
}
main();

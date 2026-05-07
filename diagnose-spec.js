#!/usr/bin/env node
/**
 * Tag 26: SPEC-Inflation Diagnostic
 * Für 5 representative SPEC-Stocks: alle Engine-Internals dumpen.
 */
'use strict';
const fs = require('fs');
const Engine = require('./engine-v7.3.js');
const Orch = require('./score-orchestrator.js');
const Filters = require('./manipulation-filters.js');

const fxRates = { EUR_USD: 1.07, USD_USD: 1, DKK_USD: 0.143, GBP_USD: 1.27 };
const TICKERS = process.argv.slice(2).length > 0 ? process.argv.slice(2) : ['AAPL', 'KO', 'JNJ', 'BAC', 'JPM'];

function pad(s, w) { return String(s).padEnd(w); }

for (const ticker of TICKERS) {
  const path = `./snapshots/${ticker}.json`;
  if (!fs.existsSync(path)) { console.log(`SKIP ${ticker}: no snapshot`); continue; }
  const stock = JSON.parse(fs.readFileSync(path, 'utf8'));

  console.log(`\n${'═'.repeat(80)}`);
  console.log(`${ticker} — ${stock.meta && stock.meta.name || ''}`);
  console.log(`Sector: ${stock.meta && stock.meta.sector} · Industry: ${stock.meta && stock.meta.industry}`);
  console.log(`MCap: $${stock.marketCap ? (stock.marketCap.value/1e9).toFixed(0) + 'B' : '?'} · RevTTM: $${stock.metrics && stock.metrics.revenueTTM ? (stock.metrics.revenueTTM.value/1e9).toFixed(0) + 'B' : '?'}`);
  console.log(`Growth YoY: ${stock.metrics && stock.metrics.revenueGrowthYoY ? stock.metrics.revenueGrowthYoY.value.toFixed(1) + '%' : '?'}`);
  console.log(`OpMargin: ${stock.metrics && stock.metrics.operatingMargin ? stock.metrics.operatingMargin.value.toFixed(1) + '%' : '?'} · GrossMargin: ${stock.metrics && stock.metrics.grossMargin ? stock.metrics.grossMargin.value.toFixed(1) + '%' : '?'}`);
  console.log('─'.repeat(80));

  // Sub-Profile
  const sp = Engine.classifySubProfile(stock);
  console.log(`Sub-Profile: ${sp.id} (${sp.label})`);

  // Universe-Checks
  const passA = Engine.passesTrackAUniverse(stock, fxRates);
  const passB = Engine.passesTrackBUniverse(stock, fxRates);
  console.log(`Universe: Track-A=${passA ? 'PASS' : 'FAIL'} · Track-B=${passB ? 'PASS' : 'FAIL'}`);

  // Track-A Score
  let sA;
  try {
    sA = Engine.scoreTrackA(stock, { fxRates });
    console.log(`Track-A: score=${(sA.finalScore || 0).toFixed(1)} bucket=${sA.bucket && sA.bucket.id || '—'} action=${sA.actionStatus || '—'}`);
    console.log(`  reasonCodes: ${(sA.reasonCodes || []).slice(0, 8).join(', ')}${(sA.reasonCodes||[]).length > 8 ? '...' : ''}`);
  } catch (e) { console.log(`Track-A: ERROR ${e.message}`); }

  // Track-B Score
  let sB;
  try {
    sB = Engine.scoreTrackB(stock, { fxRates });
    console.log(`Track-B: score=${(sB.finalScore || 0).toFixed(1)} bucket=${sB.bucket && sB.bucket.id || '—'} action=${sB.actionStatus || '—'}`);
    console.log(`  reasonCodes: ${(sB.reasonCodes || []).slice(0, 8).join(', ')}${(sB.reasonCodes||[]).length > 8 ? '...' : ''}`);
  } catch (e) { console.log(`Track-B: ERROR ${e.message}`); }

  // Orchestrator Final
  const score = Orch.scoreSnapshot(stock, { fxRates, engine: Engine, manipulationFilters: Filters });
  console.log(`ORCHESTRATOR: track=${score.track} score=${(score.finalScore || 0).toFixed(1)} bucket=${score.bucket && score.bucket.id || '—'} action=${score.actionStatus || '—'}`);
  if (score.alternativeTrack) {
    console.log(`  alt: ${JSON.stringify(score.alternativeTrack)}`);
  }
}

#!/usr/bin/env node
/**
 * diagnose-spec.js — sub-profile diagnostic for representative snapshots.
 *
 * ADR-001 Phase 3 (2026-06-20): the Track-A/B v7.3 engine + score-orchestrator this
 * script used to dump were retired and DELETED. Trimmed to the still-live sub-profile
 * classifier (lib/sub-profile.js). For live mode/tier scores, run the normal pipeline
 * (score-aggregator) — the legacy bucket/actionStatus scoring no longer exists.
 *
 * Run: node diagnose-spec.js [TICKER ...]
 */
'use strict';
const fs = require('fs');
const { classifySubProfile } = require('./lib/sub-profile.js');

const TICKERS = process.argv.slice(2).length > 0 ? process.argv.slice(2) : ['AAPL', 'KO', 'JNJ', 'BAC', 'JPM'];

for (const ticker of TICKERS) {
  const p = `./snapshots/${ticker}.json`;
  if (!fs.existsSync(p)) { console.log(`SKIP ${ticker}: no snapshot`); continue; }
  const stock = JSON.parse(fs.readFileSync(p, 'utf8'));

  console.log(`\n${'═'.repeat(80)}`);
  console.log(`${ticker} — ${stock.meta && stock.meta.name || ''}`);
  console.log(`Sector: ${stock.meta && stock.meta.sector} · Industry: ${stock.meta && stock.meta.industry}`);
  console.log(`MCap: $${stock.marketCap ? (stock.marketCap.value / 1e9).toFixed(0) + 'B' : '?'} · RevTTM: $${stock.metrics && stock.metrics.revenueTTM ? (stock.metrics.revenueTTM.value / 1e9).toFixed(0) + 'B' : '?'}`);
  console.log('─'.repeat(80));

  const sp = classifySubProfile(stock);
  console.log(`Sub-Profile: ${sp.id} (${sp.label})`);
}

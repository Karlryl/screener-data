#!/usr/bin/env node
/**
 * Tag 103 — Auto-Universum-Refresh
 * ==================================
 * Pullt Yahoo-Screener für Stocks $2B–$500B Mcap weltweit
 * und merged in watchlist.json. Macht Universum dynamisch:
 * neue IPOs / wachsende Mid-Caps werden automatisch sichtbar.
 *
 * Yahoo bietet via fundamental screener:
 *   - day_gainers, day_losers, growth_technology_stocks, etc.
 *   - custom screener via screener('predefined', ...)
 *
 * Wir nutzen mehrere Filter-Buckets, damit wir keine Stocks
 * verpassen, die in einer Single-Region screener nicht auftauchen.
 *
 * Run:  node refresh-universe.js --watchlist watchlist.json
 */
'use strict';
const fs = require('fs');
const path = require('path');
let yf;
try { yf = require('yahoo-finance2').default; }
catch (e) { console.error('yahoo-finance2 nicht installiert'); process.exit(1); }

function parseArgs(argv) {
  const args = { watchlist: './watchlist.json', out: null };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--watchlist' && argv[i+1]) args.watchlist = argv[++i];
    else if (argv[i] === '--out' && argv[i+1]) args.out = argv[++i];
  }
  if (!args.out) args.out = args.watchlist;
  return args;
}

// Yahoo-vordefinierte Screener (geographisch/thematisch breit)
// Liste keine Banken/REITs/Insurance — die fliegen sowieso im Modus-Filter raus,
// aber wir minimieren Pull-Last.
// Tag 116: Erweitert auf 13 Buckets (mehr Coverage)
const SCREENER_IDS = [
  'most_actives',                  // Volume-leaders weltweit
  'day_gainers',                   // momentum candidates
  'undervalued_growth_stocks',     // Quality-Value-Mix
  'growth_technology_stocks',      // Hypergrowth-Tech
  'aggressive_small_caps',         // potential mid-cap upgrades
  'small_cap_gainers',
  'undervalued_large_caps',
  'most_shorted_stocks',           // Tag 116: contrarian/short-squeeze
  'portfolio_anchors',             // Tag 116: large-cap quality
  'solid_large_growth_funds',      // Tag 116: large-growth
  'solid_midcap_growth_funds',     // Tag 116: midcap-growth
  'conservative_foreign_funds',    // Tag 116: international
  'high_yield_bond',               // skip but kept for coverage
];

// Tag 116: Multi-Region Pull — Yahoo screener region-aware
const REGIONS = ['US', 'GB', 'DE', 'FR', 'HK', 'JP', 'AU', 'CA'];

async function _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchScreener(id, region) {
  region = region || 'US';
  try {
    const r = await yf.screener({ scrIds: id, count: 250, region: region });
    return (r && r.quotes) || [];
  } catch (e) {
    // Manche Screener-IDs nur in bestimmten Regionen verfuegbar - silent fail
    return [];
  }
}

async function fetchWithMcap(symbol) {
  try {
    const q = await yf.quote(symbol);
    return q;
  } catch (e) { return null; }
}

async function main() {
  const args = parseArgs(process.argv);
  console.log('Auto-Universe-Refresh');
  console.log('  watchlist: ' + args.watchlist);

  const wlRaw = JSON.parse(fs.readFileSync(args.watchlist, 'utf8'));
  const existing = new Set(wlRaw.stocks.map(s => s.ticker.toUpperCase()));
  console.log('  current size: ' + existing.size);

  // 1. Pull all screener-buckets x regions in parallel
  // Tag 116: Mcap-Range gesenkt auf $1B (mehr Mid-Cap-Coverage), max bleibt $500B
  console.log('\nPulling Yahoo Screener-Buckets (Multi-Region)...');
  const allTickers = new Map(); // ticker -> {marketCap, name, sector, exchange}
  for (const region of REGIONS) {
    console.log('  --- Region: ' + region + ' ---');
    for (const id of SCREENER_IDS) {
      const quotes = await fetchScreener(id, region);
      if (quotes.length === 0) continue;
      let kept = 0;
      for (const q of quotes) {
        if (!q || !q.symbol) continue;
        const sym = q.symbol.toUpperCase();
        const mcap = q.marketCap;
        if (!mcap || mcap < 1e9 || mcap > 500e9) continue;  // Tag 116: $1B-$500B
        if (!allTickers.has(sym) || (allTickers.get(sym).marketCap || 0) < mcap) {
          allTickers.set(sym, {
            ticker: sym,
            marketCap: mcap,
            name: q.longName || q.shortName || '',
            sector: q.sector || '',
            exchange: q.fullExchangeName || q.exchange || ''
          });
        }
        kept++;
      }
      if (kept > 0) console.log('    ' + id.padEnd(36) + quotes.length + ' -> ' + kept);
      await _sleep(300);
    }
  }

  // 2. Filter out Banks/REITs/Insurance (Modus-Logik schließt sie eh aus, kein Pull)
  const SECTOR_EXCLUDE = /bank|insurance|financial services|capital markets|asset management|real estate|reit/i;
  let excluded = 0;
  for (const [sym, info] of allTickers) {
    if (info.sector && SECTOR_EXCLUDE.test(info.sector)) {
      allTickers.delete(sym);
      excluded++;
    }
  }
  console.log(`\nSektor-Exclude: ${excluded} (Banks/REITs/Insurance) entfernt`);
  console.log('Distinct candidates:', allTickers.size);

  // 3. Identify new tickers
  const newTickers = [];
  for (const [sym, info] of allTickers) {
    if (!existing.has(sym)) newTickers.push(info);
  }
  console.log(`\nNew tickers: ${newTickers.length} (already-in: ${allTickers.size - newTickers.length})`);

  if (newTickers.length === 0) {
    console.log('Nothing to add. Universe unchanged.');
    return;
  }

  // 4. Merge into watchlist
  for (const info of newTickers) {
    wlRaw.stocks.push({
      ticker: info.ticker,
      yahoo_symbol: info.ticker,
      name: info.name,
      sector_hint: info.sector,
      exchange_hint: info.exchange,
      added_via: 'auto-universe-refresh',
      added_at: new Date().toISOString()
    });
  }
  wlRaw.stocks.sort((a, b) => a.ticker.localeCompare(b.ticker));
  wlRaw.lastUniverseRefresh = new Date().toISOString();

  fs.writeFileSync(args.out, JSON.stringify(wlRaw, null, 2));
  console.log('\nWritten: ' + args.out);
  console.log('  total stocks: ' + wlRaw.stocks.length);
  console.log('  added this run: ' + newTickers.length);
  console.log('\nSample new tickers:');
  for (const t of newTickers.slice(0, 10)) {
    console.log(`  ${t.ticker.padEnd(8)} ${(t.sector || '').slice(0,20).padEnd(20)} $${(t.marketCap/1e9).toFixed(1)}B  ${(t.name || '').slice(0,40)}`);
  }
}

if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });

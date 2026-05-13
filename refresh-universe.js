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

// Tag 133: Additional discovery sources
const { fetchSecTickers }       = require('./discovery/sec-tickers.js');
const { fetchFinnhubUniverse }  = require('./discovery/finnhub.js');
const { fetchWikipediaIndices } = require('./discovery/wikipedia-indices.js');

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

// Tag 132: Multi-Region Pull — 25 Regionen (+KR/TW/BR/MX/SG/CH/DK/NO/FI/ZA/SA)
const REGIONS = ['US', 'GB', 'DE', 'FR', 'HK', 'JP', 'AU', 'CA', 'CN', 'IN', 'IT', 'NL', 'SE', 'ES', 'KR', 'TW', 'BR', 'MX', 'SG', 'CH', 'DK', 'NO', 'FI', 'ZA', 'SA'];

// Tag 131: Exchange-Code-basierter Custom-Screener (geht über curated Yahoo-Listen hinaus)
// Paginiert über alle Stocks $1B–$500B mcap je Exchange → ~10k+ Coverage möglich
const EXCHANGE_CODES = [
  'NMS',  // NASDAQ Global Select
  'NYQ',  // NYSE
  'NGM',  // NASDAQ Global Market
  'NIM',  // NASDAQ Capital Market
  'ASE',  // NYSE American
  'LSE',  // London
  'FRA',  // Frankfurt
  'PAR',  // Paris (Euronext)
  'AMS',  // Amsterdam
  'MIL',  // Milan
  'STO',  // Stockholm
  'HKG',  // Hong Kong
  'TYO',  // Tokyo
  'SHH',  // Shanghai
  'SHZ',  // Shenzhen
  'BSE',  // Bombay/NSE India
  'KOE',  // Korea
  'TAI',  // Taiwan
  'ASX',  // Australia
  'TOR',  // Toronto
  // Tag 132: Additional exchanges
  'CPH',  // Copenhagen
  'OSL',  // Oslo
  'HEL',  // Helsinki
  'SAO',  // Sao Paulo (B3)
  'MEX',  // Mexico
  'SGX',  // Singapore
  'SWX',  // Swiss Exchange
  'JNB',  // Johannesburg
  'SAU',  // Saudi Arabia (Tadawul)
];

async function _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchScreener(id, region) {
  region = region || 'US';
  try {
    const r = await yf.screener({ scrIds: id, count: 250, region: region });
    return (r && r.quotes) || [];
  } catch (e) {
    return [];
  }
}

// Tag 131: Custom Exchange-Screener mit Pagination.
// Liefert ALLE Stocks je Exchange die $1B-$500B Mcap haben — nicht nur curated Listen.
async function fetchExchangePage(exchangeCode, minMcap, maxMcap, offset) {
  try {
    const r = await yf.screener({
      query: {
        operator: 'AND',
        operands: [
          { operator: 'btwn', operands: ['intradaymarketcap', minMcap, maxMcap] },
          { operator: 'eq', operands: ['exchange', exchangeCode] }
        ]
      },
      count: 250,
      offset: offset || 0,
      sortField: 'intradaymarketcap',
      sortType: 'DESC'
    });
    return (r && r.quotes) || [];
  } catch (e) {
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

  // Tag 131: Custom Exchange-Screener (paginiert) — zusätzlich zu predefined Screener-Buckets.
  // Ziel: 10k+ Stocks statt ~3500. Errors sind non-fatal (silent skip).
  console.log('\nCustom Exchange-Screener (Tag 131)...');
  const MIN_MCAP_CUSTOM = 1e9;
  const MAX_MCAP_CUSTOM = 500e9;
  let customAdded = 0;
  for (const exch of EXCHANGE_CODES) {
    let offset = 0;
    let pageEmpty = false;
    while (!pageEmpty) {
      const quotes = await fetchExchangePage(exch, MIN_MCAP_CUSTOM, MAX_MCAP_CUSTOM, offset);
      if (quotes.length === 0) { pageEmpty = true; break; }
      let kept = 0;
      for (const q of quotes) {
        if (!q || !q.symbol) continue;
        const sym = q.symbol.toUpperCase();
        const mcap = q.marketCap;
        if (!mcap || mcap < MIN_MCAP_CUSTOM || mcap > MAX_MCAP_CUSTOM) continue;
        if (!allTickers.has(sym) || (allTickers.get(sym).marketCap || 0) < mcap) {
          allTickers.set(sym, {
            ticker: sym, marketCap: mcap,
            name: q.longName || q.shortName || '',
            sector: q.sector || '',
            exchange: q.fullExchangeName || q.exchange || exch
          });
          kept++;
          customAdded++;
        }
      }
      if (kept > 0) console.log(`  ${exch} offset=${offset}: ${quotes.length} quotes, ${kept} new`);
      if (quotes.length < 250) { pageEmpty = true; }
      else { offset += 250; await _sleep(400); }
    }
  }
  console.log('Custom-Screener total neue Tickers: ' + customAdded);

  // Tag 133: Merge additional discovery sources into allTickers
  // SEC EDGAR: ~10k US-listed companies (no auth required)
  // Finnhub:   ~20k+ global stocks per exchange (needs FINNHUB_API_KEY secret)
  // Wikipedia: S&P 500 / FTSE 100 / DAX constituents (no auth required)
  console.log('\nDiscovery: Additional Sources (Tag 133)...');
  const discoverySources = await Promise.allSettled([
    fetchSecTickers(),
    fetchFinnhubUniverse(),
    fetchWikipediaIndices()
  ]);
  for (const res of discoverySources) {
    if (res.status === 'rejected') { console.error('  Discovery source error: ' + res.reason); continue; }
    const srcMap = res.value;
    for (const [sym, info] of srcMap) {
      if (!allTickers.has(sym)) {
        allTickers.set(sym, {
          ticker: sym,
          marketCap: null,
          name: info.name || '',
          sector: '',
          exchange: info.exchange || ''
        });
      }
    }
  }

  // 2. No sector-exclude at universe level (Tag 132: modes filter sectors, not discovery)
  // Banks/REITs/Insurance are allowed for Quality-Compounder mode.
  console.log('Distinct candidates after all sources: ' + allTickers.size);

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
      name: info.name || '',
      sector_hint: info.sector || '',
      exchange_hint: info.exchange || '',
      added_via: info.source || 'auto-universe-refresh',
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

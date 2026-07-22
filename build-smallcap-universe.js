#!/usr/bin/env node
'use strict';
/**
 * 5.2 WEG 1b Discovery-Builder (Council + Codex-Duell §4d, 22.07.)
 * ===============================================================
 * Beschafft das US-Small-Cap-Universum ($300-800M) fuer das 5.2-Board aus der
 * VOLLSTAENDIGEN US-Listing-Basis (NASDAQ-Trader nasdaqlisted+otherlisted, ~7k
 * common stocks) — NICHT aus den vier thematischen Yahoo-Screener-Seiten der
 * Messprobe (Codex-Einwand 1: die sind verzerrt/gedeckelt). Batch-MCap-Vorfilter
 * (discovery/mcap-prefilter.js, wiederverwendet) grenzt auf das $300-800M-Band ein.
 *
 * BEWUSST KEINE R1-R6-Operating-Filterung hier: die macht smallcapRoute() zur
 * Score-Zeit (route()+isUS()+Band), plus die Achsen-Coverage. Der Builder liefert
 * nur die Membership-Kandidaten -> watchlist-smallcap.json (committbarer Kontrakt,
 * analog watchlist.json). Der gescopte $300M-Pull auf diese Datei (naechster
 * WEG-1b-Chunk) fuellt snapshots-smallcap/, das loadSmallcapUniverse() liest.
 *
 * Run:  node build-smallcap-universe.js [--limit N] [--out <pfad>]
 *       --limit N  = nur die ersten N Listing-Symbole pruefen (Beleg/Schnelltest)
 */
const fs = require('fs');
const path = require('path');
const { writeFileAtomic } = require('./lib/atomic-write.js');
const { fetchNasdaqAll, isJunkSecurity } = require('./discovery/nasdaq-all.js');
const { prefilterByMcap } = require('./discovery/mcap-prefilter.js');

const MIN_USD = 300e6;
const MAX_USD = 800e6;
const DEFAULT_OUT = path.join(__dirname, 'watchlist-smallcap.json');

function parseArgs(argv) {
  const args = { limit: null, out: DEFAULT_OUT };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--limit' && argv[i + 1]) args.limit = parseInt(argv[++i], 10);
    else if (argv[i] === '--out' && argv[i + 1]) args.out = argv[++i];
  }
  if (args.limit != null && (!Number.isInteger(args.limit) || args.limit < 1)) {
    throw new Error('--limit muss eine positive Ganzzahl sein');
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  console.log(`[smallcap-builder] Band $${MIN_USD / 1e6}M-$${MAX_USD / 1e6}M, out=${args.out}${args.limit ? `, limit=${args.limit}` : ''}`);

  const listing = await fetchNasdaqAll(); // Map<symbol, {name, ...}>
  let symbols = [...listing.keys()].filter((s) => {
    const info = listing.get(s) || {};
    return !isJunkSecurity(s, info.name || '');
  });
  console.log(`[smallcap-builder] ${symbols.length} US-Listing-Symbole nach Junk-Filter`);
  if (args.limit) symbols = symbols.slice(0, args.limit);

  // Batch-MCap-Vorfilter: >= $300M (minUsd). Das Obere Band ($800M) filtern wir aus
  // der zurueckgegebenen USD-Map (prefilterByMcap kennt nur eine Untergrenze).
  const { kept } = await prefilterByMcap(symbols, { minUsd: MIN_USD });
  const band = [...kept.entries()]
    .filter(([, usd]) => usd <= MAX_USD)
    .sort((a, b) => b[1] - a[1]);
  console.log(`[smallcap-builder] ${kept.size} >= $300M, davon ${band.length} im Band <= $800M`);

  const at = new Date().toISOString();
  const stocks = band.map(([sym, usd]) => ({
    ticker: sym,
    yahoo_symbol: sym,
    name: (listing.get(sym) || {}).name || '',
    marketCapUsd: Math.round(usd),
    added_via: 'smallcap-builder',
    added_at: at,
  }));

  const payload = {
    _meta: {
      builder: 'build-smallcap-universe.js (5.2 WEG 1b)',
      band: { minUsd: MIN_USD, maxUsd: MAX_USD },
      source: 'NASDAQ-Trader nasdaqlisted+otherlisted (full US listing) + Batch-MCap-Vorfilter',
      note: 'Operating-Filterung (R1-R6-artig) erfolgt zur Score-Zeit via smallcapRoute, nicht hier.',
      builtAt: at,
      count: stocks.length,
      partial: args.limit != null,
    },
    stocks,
  };
  writeFileAtomic(args.out, JSON.stringify(payload, null, 2));
  console.log(`[smallcap-builder] geschrieben: ${stocks.length} Small-Cap-Kandidaten -> ${args.out}`);
  if (stocks.length) {
    console.log('[smallcap-builder] Top-5 nach MCap: ' +
      stocks.slice(0, 5).map((s) => `${s.ticker}($${(s.marketCapUsd / 1e6).toFixed(0)}M)`).join(', '));
  }
}

main().catch((e) => { console.error('[smallcap-builder] FEHLER: ' + (e && e.message)); process.exit(1); });

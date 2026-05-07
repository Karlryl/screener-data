#!/usr/bin/env node
/**
 * Tag 34 — Watchlist-CLI
 * Verwaltung der watchlist.json ohne JSON-Editing.
 *
 * Usage:
 *   node watchlist-cli.js list
 *   node watchlist-cli.js add TICKER --name "Stock Name" [--position interested|watching|owned] [--track A|B] [--isin ISIN]
 *   node watchlist-cli.js remove TICKER
 *   node watchlist-cli.js position TICKER owned|watching|interested
 *   node watchlist-cli.js info TICKER
 */
'use strict';
const fs = require('fs');

const PATH = './watchlist.json';

function load() {
  return JSON.parse(fs.readFileSync(PATH, 'utf8'));
}
function save(wl) {
  wl._meta = wl._meta || {};
  wl._meta.updated_at = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(PATH, JSON.stringify(wl, null, 2));
}

function cmdList() {
  const wl = load();
  const groups = { owned: [], watching: [], interested: [] };
  for (const s of wl.stocks) {
    (groups[s.position] || (groups[s.position] = [])).push(s);
  }
  for (const pos of ['owned', 'watching', 'interested']) {
    const list = groups[pos] || [];
    console.log(`\n${pos.toUpperCase()} (${list.length}):`);
    for (const s of list) {
      console.log(`  ${s.ticker.padEnd(8)} ${s.name.padEnd(35)} track=${s.track_hint || '?'} ${s.isin || '(no isin)'}`);
    }
  }
  console.log(`\nTotal: ${wl.stocks.length}`);
}

function cmdAdd(ticker, opts) {
  const wl = load();
  if (wl.stocks.find(s => s.ticker === ticker)) {
    console.error(`✗ ${ticker} already exists`);
    process.exit(1);
  }
  const stock = {
    isin: opts.isin || null,
    ticker,
    yahoo_symbol: opts.yahoo || ticker,
    name: opts.name || ticker,
    track_hint: opts.track || 'A',
    position: opts.position || 'interested'
  };
  wl.stocks.push(stock);
  save(wl);
  console.log(`✓ Added ${ticker} (${stock.name}, position=${stock.position})`);
}

function cmdRemove(ticker) {
  const wl = load();
  const idx = wl.stocks.findIndex(s => s.ticker === ticker);
  if (idx < 0) { console.error(`✗ ${ticker} not in watchlist`); process.exit(1); }
  wl.stocks.splice(idx, 1);
  save(wl);
  console.log(`✓ Removed ${ticker}`);
}

function cmdPosition(ticker, position) {
  const wl = load();
  const s = wl.stocks.find(s => s.ticker === ticker);
  if (!s) { console.error(`✗ ${ticker} not in watchlist`); process.exit(1); }
  if (!['owned', 'watching', 'interested'].includes(position)) {
    console.error(`✗ position must be owned|watching|interested`); process.exit(1);
  }
  const old = s.position;
  s.position = position;
  save(wl);
  console.log(`✓ ${ticker}: position ${old} → ${position}`);
}

function cmdInfo(ticker) {
  const wl = load();
  const s = wl.stocks.find(s => s.ticker === ticker);
  if (!s) { console.error(`✗ ${ticker} not in watchlist`); process.exit(1); }
  console.log(JSON.stringify(s, null, 2));
}

function parseFlags(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      const val = argv[i + 1];
      if (val && !val.startsWith('--')) { opts[key] = val; i++; }
      else opts[key] = true;
    }
  }
  return opts;
}

function main() {
  const args = process.argv.slice(2);
  const cmd = args[0];
  switch (cmd) {
    case 'list': cmdList(); break;
    case 'add':
      if (!args[1]) { console.error('Usage: add TICKER [flags]'); process.exit(1); }
      cmdAdd(args[1].toUpperCase(), parseFlags(args.slice(2)));
      break;
    case 'remove': case 'rm':
      if (!args[1]) { console.error('Usage: remove TICKER'); process.exit(1); }
      cmdRemove(args[1].toUpperCase());
      break;
    case 'position': case 'pos':
      if (!args[1] || !args[2]) { console.error('Usage: position TICKER owned|watching|interested'); process.exit(1); }
      cmdPosition(args[1].toUpperCase(), args[2]);
      break;
    case 'info':
      if (!args[1]) { console.error('Usage: info TICKER'); process.exit(1); }
      cmdInfo(args[1].toUpperCase());
      break;
    default:
      console.log('Watchlist-CLI');
      console.log('Commands:');
      console.log('  list                                              — alle Stocks anzeigen');
      console.log('  add TICKER --name "Name" [--position p] [--track A|B] [--isin X] [--yahoo S]');
      console.log('  remove TICKER                                     — Stock entfernen');
      console.log('  position TICKER owned|watching|interested         — Position ändern');
      console.log('  info TICKER                                       — Details zu einem Stock');
  }
}
main();

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
const { writeFileAtomic } = require('./lib/atomic-write.js');

const PATH = './watchlist.json';

// F-GC-007 / F-GC-009 (Tag 184): load needs try/catch — JSON.parse of a
// corrupted watchlist would crash with a cryptic SyntaxError. Save uses
// atomic tmp+rename so a SIGINT during write doesn't leave a half-written
// watchlist (lost-update protection).
function load() {
  try { return JSON.parse(fs.readFileSync(PATH, 'utf8')); }
  catch (e) {
    console.error('✗ watchlist.json unreadable: ' + e.message);
    process.exit(1);
  }
}
function save(wl) {
  wl._meta = wl._meta || {};
  wl._meta.updated_at = new Date().toISOString().slice(0, 10);
  writeFileAtomic(PATH, JSON.stringify(wl, null, 2));
}

function cmdList() {
  const wl = load();
  console.log(`Watchlist (${wl.stocks.length} stocks):`);
  for (const s of wl.stocks) {
    console.log(`  ${s.ticker.padEnd(8)} ${s.name.padEnd(35)} track=${s.track_hint || '?'} ${s.isin || '(no isin)'}`);
  }
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
  };
  wl.stocks.push(stock);
  save(wl);
  // F-GC-007 (Tag 184): success message previously referenced stock.position which is
  // never set on the add path (only track_hint is). Print track instead.
  console.log(`✓ Added ${ticker} (${stock.name}, track=${stock.track_hint})`);
}

function cmdRemove(ticker) {
  const wl = load();
  const idx = wl.stocks.findIndex(s => s.ticker === ticker);
  if (idx < 0) { console.error(`✗ ${ticker} not in watchlist`); process.exit(1); }
  wl.stocks.splice(idx, 1);
  save(wl);
  console.log(`✓ Removed ${ticker}`);
}

function cmdInfo(ticker) {
  const wl = load();
  const s = wl.stocks.find(s => s.ticker === ticker);
  if (!s) { console.error(`✗ ${ticker} not in watchlist`); process.exit(1); }
  console.log(JSON.stringify(s, null, 2));
}


function cmdImport(csvPath) {
  if (!csvPath || !fs.existsSync(csvPath)) { console.error('CSV nicht gefunden'); process.exit(1); }
  const lines = fs.readFileSync(csvPath, 'utf8').split(/\r?\n/).filter(Boolean);
  const wl = load();
  const existing = new Set(wl.stocks.map(s => s.ticker));
  let added = 0, skipped = 0;
  for (const line of lines) {
    if (line.toLowerCase().startsWith('ticker')) continue;
    const parts = line.split(',').map(s => s.trim());
    if (!parts[0]) continue;
    const ticker = parts[0].toUpperCase();
    if (existing.has(ticker)) { skipped++; continue; }
    wl.stocks.push({
      isin: parts[3] || null,
      ticker,
      yahoo_symbol: parts[2] || ticker,
      name: parts[1] || ticker,
      track_hint: parts[4] || 'A'
    });
    existing.add(ticker);
    added++;
  }
  save(wl);
  console.log('✓ ' + added + ' added, ' + skipped + ' skipped (duplicates)');
}

function cmdExport(csvPath) {
  const wl = load();
  const target = csvPath || './watchlist-export.csv';
  const lines = ['ticker,name,yahoo_symbol,isin,track_hint'];
  for (const s of wl.stocks) {
    lines.push([s.ticker, s.name, s.yahoo_symbol, s.isin || '', s.track_hint || 'A'].join(','));
  }
  fs.writeFileSync(target, lines.join('\n'));
  console.log('✓ Exported ' + wl.stocks.length + ' stocks → ' + target);
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
    case 'info':
      if (!args[1]) { console.error('Usage: info TICKER'); process.exit(1); }
      cmdInfo(args[1].toUpperCase());
      break;
    case 'import':
      cmdImport(args[1]);
      break;
    case 'export':
      cmdExport(args[1]);
      break;
    default:
      console.log('Watchlist-CLI');
      console.log('Commands:');
      console.log('  list                                              — alle Stocks anzeigen');
      console.log('  add TICKER --name "Name" [--track A|B] [--isin X] [--yahoo S]');
      console.log('  remove TICKER                                     — Stock entfernen');
          console.log('  info TICKER                                       — Details zu einem Stock');
      console.log('  import path/to/file.csv                            — Bulk-Add aus CSV (ticker,name,yahoo,isin,track)');
      console.log('  export [path/to/file.csv]                          — Watchlist als CSV speichern');
  }
}
main();

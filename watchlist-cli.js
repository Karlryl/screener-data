#!/usr/bin/env node
/**
 * Tag 34 — Watchlist-CLI
 * Verwaltung der watchlist.json ohne JSON-Editing.
 *
 * Usage:
 *   node watchlist-cli.js list
 *   node watchlist-cli.js add TICKER --name "Stock Name" [--track A|B] [--isin ISIN]
 *   node watchlist-cli.js remove TICKER
 *   node watchlist-cli.js info TICKER
 */
'use strict';
const fs = require('fs');
const { writeFileAtomic } = require('./lib/atomic-write.js');

const PATH = './watchlist.json';

// audit BH-196: lib/snapshot-fs.js derives a per-ticker snapshot filename by mapping
// every character outside [A-Z0-9.-] to '_' with no collision check — two distinct
// exotic tickers (e.g. 'ABC/A' and 'ABC:A') can sanitize to the same filename and
// silently overwrite each other's snapshot. Reject such tickers at this trust
// boundary (manual add/import) instead of teaching the sanitizer a registry.
const TICKER_RE = /^[A-Z0-9.-]+$/;

// audit BH-067: cmdImport/cmdExport used to split(',')/join(',') with no quoting —
// a name containing a comma (510 of 11106 watchlist names do) shifted every
// following CSV field. Minimal RFC-4180-style quoting: wrap a field in "..." and
// double internal quotes when it contains a comma/quote/newline.
function csvField(v) {
  const s = String(v == null ? '' : v);
  if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}
function parseCsvLine(line) {
  const out = [];
  let cur = '', inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQuotes = false;
      } else cur += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      out.push(cur); cur = '';
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out.map(s => s.trim());
}

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
  // BH-196: reject at the trust boundary — see TICKER_RE comment above.
  if (!TICKER_RE.test(ticker)) {
    console.error(`✗ ${ticker} contains characters outside [A-Z0-9.-] — rejected (snapshot filename collision risk)`);
    process.exit(1);
  }
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
    // audit F-A-2026-06-21: record add-time so prune-watchlist's no-snapshot grace
    // period (it reads entry.added_at) can actually fire for CLI-added tickers.
    added_at: new Date().toISOString(),
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
  let added = 0, skipped = 0, rejected = 0;
  for (const line of lines) {
    if (line.toLowerCase().startsWith('ticker')) continue;
    const parts = parseCsvLine(line); // BH-067: quote-aware (was naive split(','))
    if (!parts[0]) continue;
    const ticker = parts[0].toUpperCase();
    if (!TICKER_RE.test(ticker)) { rejected++; continue; } // BH-196
    if (existing.has(ticker)) { skipped++; continue; }
    wl.stocks.push({
      isin: parts[3] || null,
      ticker,
      yahoo_symbol: parts[2] || ticker,
      name: parts[1] || ticker,
      track_hint: parts[4] || 'A',
      // BH-068: cmdAdd stamps added_at (F-A-2026-06-21) but cmdImport didn't —
      // prune-watchlist's no-snapshot grace period only fires when added_at is
      // set, so 3341/11106 imported rows could never age out.
      added_at: new Date().toISOString(),
    });
    existing.add(ticker);
    added++;
  }
  save(wl);
  console.log('✓ ' + added + ' added, ' + skipped + ' skipped (duplicates)' +
    (rejected ? ', ' + rejected + ' rejected (invalid ticker chars)' : ''));
}

function cmdExport(csvPath) {
  const wl = load();
  const target = csvPath || './watchlist-export.csv';
  const lines = ['ticker,name,yahoo_symbol,isin,track_hint'];
  for (const s of wl.stocks) {
    lines.push([s.ticker, s.name, s.yahoo_symbol, s.isin || '', s.track_hint || 'A'].map(csvField).join(','));
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
module.exports = { TICKER_RE, csvField, parseCsvLine, cmdAdd, cmdImport, cmdExport };
if (require.main === module) main();

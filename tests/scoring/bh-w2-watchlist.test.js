'use strict';
/**
 * Bug-hunt fixes, batch w2-watchlist (BH-066, BH-067, BH-068, BH-069, BH-070,
 * BH-071, BH-196). Reine Funktionen + tmp-Verzeichnisse + Subprozess-Aufrufe
 * des echten Skripts -> netzwerkfrei. Standalone-Runner: node <datei> (Exit 0/1).
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..', '..');
const CLI = path.join(ROOT, 'watchlist-cli.js');
const { csvField, parseCsvLine, TICKER_RE } = require('../../watchlist-cli.js');
const { isValidScore } = require('../../aktienfinder-import.js');
const fieldCoverage = require('../../field-coverage.js');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + (e.stack || e.message)); }
}
function tmpDir(prefix) { return fs.mkdtempSync(path.join(os.tmpdir(), prefix + '-')); }
function runCli(args, cwd) {
  return spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8' });
}
function writeFixtureWatchlist(dir, stocks) {
  fs.writeFileSync(path.join(dir, 'watchlist.json'), JSON.stringify({ stocks }, null, 2));
}
function readWatchlist(dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, 'watchlist.json'), 'utf8'));
}

// --- BH-066: field-coverage zero-disappearance ---
test('BH-066: base>0 -> cur=0 always alarms even when both are below ABSOLUTE_FLOOR/DROP_THRESHOLD', () => {
  const current = { 'metrics.forwardPE.value': 0 };
  const baseline = { 'metrics.forwardPE.value': 0.10 }; // 10% -> 0%: drop=0.10 < DROP_THRESHOLD(0.20), base < ABSOLUTE_FLOOR(0.50)
  const drifts = fieldCoverage.detectDrift(current, baseline);
  const hit = drifts.find(d => d.field === 'metrics.forwardPE.value');
  assert.ok(hit, 'a sparse field vanishing to 0% must still alarm');
  assert.equal(hit.severity, 'HIGH');
  assert.equal(hit.reason, 'field-vanished');
});
test('BH-066: base=0 -> cur=0 (already-dead field) does not spam a new alarm', () => {
  const drifts = fieldCoverage.detectDrift({ f: 0 }, { f: 0 });
  assert.equal(drifts.length, 0);
});
test('BH-066: no double-report — a field already flagged field-vanished is not also floor/drop-flagged', () => {
  const current = { 'meta.sector': 0 };
  const baseline = { 'meta.sector': 0.9 }; // clears ABSOLUTE_FLOOR too -> would also hit the floor-check
  const drifts = fieldCoverage.detectDrift(current, baseline);
  const hits = drifts.filter(d => d.field === 'meta.sector');
  assert.equal(hits.length, 1, 'exactly one drift entry per field');
  assert.equal(hits[0].reason, 'field-vanished');
});
test('BH-066: ordinary partial baseline-drop (unrelated to zero) still works unchanged', () => {
  const field = 'meta.sector'; // must be a real TRACKED_FIELDS entry — detectDrift only iterates those
  const drifts = fieldCoverage.detectDrift({ [field]: 0.5 }, { [field]: 0.9 }); // drop=0.4 >= 0.20, cur!==0
  assert.equal(drifts.length, 1);
  assert.equal(drifts[0].reason, 'baseline-drop');
});

// --- BH-070: aktienfinder-import score range guard ---
test('BH-070: isValidScore rejects negative, >10, NaN, Infinity; accepts 0..10', () => {
  assert.equal(isValidScore(-1), false);
  assert.equal(isValidScore(99), false);
  assert.equal(isValidScore(NaN), false);
  assert.equal(isValidScore(Infinity), false);
  assert.equal(isValidScore(0), true);
  assert.equal(isValidScore(8.5), true);
  assert.equal(isValidScore(10), true);
});

// --- BH-067: CSV quoting round-trip ---
test('BH-067: csvField quotes a comma-containing name; parseCsvLine reads it back as ONE field', () => {
  const name = 'Applied Aerospace & Defense, Inc.';
  const line = ['AADX', name, 'AADX', 'US123', 'A'].map(csvField).join(',');
  const parts = parseCsvLine(line);
  assert.equal(parts.length, 5, 'comma inside the quoted name must not split into extra fields');
  assert.equal(parts[1], name);
  assert.equal(parts[3], 'US123');
});
test('BH-067: csvField round-trips embedded double-quotes', () => {
  const name = 'The "Big" Company';
  const parsed = parseCsvLine(csvField(name));
  assert.equal(parsed[0], name);
});
test('BH-067: plain fields without special chars pass through unquoted', () => {
  assert.equal(csvField('AAPL'), 'AAPL');
});

// --- BH-068 + BH-196 + BH-067 integration: real cmdImport via subprocess ---
test('BH-068/BH-196/BH-067: import stamps added_at, rejects invalid-char tickers, preserves comma names', () => {
  const dir = tmpDir('wl-import');
  writeFixtureWatchlist(dir, []);
  const csvPath = path.join(dir, 'in.csv');
  const csvLines = [
    'ticker,name,yahoo_symbol,isin,track_hint',
    ['NEWCO', 'New & Co, Inc.', 'NEWCO', 'US999', 'A'].map(csvField).join(','),
    'AB/C,Bad Ticker,AB/C,,A', // BH-196: contains '/' -> must be rejected, not imported
  ];
  fs.writeFileSync(csvPath, csvLines.join('\n'));
  const r = runCli(['import', csvPath], dir);
  assert.equal(r.status, 0, 'import must exit 0: ' + r.stderr);
  const wl = readWatchlist(dir);
  assert.equal(wl.stocks.length, 1, 'only the valid ticker was imported');
  const s = wl.stocks[0];
  assert.equal(s.ticker, 'NEWCO');
  assert.equal(s.name, 'New & Co, Inc.', 'comma-containing name survives export/import quoting');
  assert.ok(s.added_at, 'BH-068: added_at must be stamped on import so prune grace period can fire');
  assert.ok(!wl.stocks.find(x => x.ticker === 'AB/C'), 'BH-196: exotic-char ticker rejected, not stored');
});

// --- BH-196: cmdAdd rejects an exotic-char ticker (subprocess, since it process.exit(1)s) ---
test('BH-196: add rejects a ticker with characters outside [A-Z0-9.-]', () => {
  const dir = tmpDir('wl-add');
  writeFixtureWatchlist(dir, []);
  const r = runCli(['add', 'AB/C', '--name', 'Bad'], dir);
  assert.notEqual(r.status, 0, 'must fail, not silently accept a collision-prone ticker');
  const wl = readWatchlist(dir);
  assert.equal(wl.stocks.length, 0, 'nothing written');
});
test('BH-196 control: add still works for an ordinary [A-Z0-9.-] ticker', () => {
  const dir = tmpDir('wl-add-ok');
  writeFixtureWatchlist(dir, []);
  const r = runCli(['add', 'BRK-B', '--name', 'Berkshire'], dir);
  assert.equal(r.status, 0, r.stderr);
  const wl = readWatchlist(dir);
  assert.equal(wl.stocks.length, 1);
  assert.equal(wl.stocks[0].ticker, 'BRK-B');
});
test('BH-196: TICKER_RE accepts dots/hyphens, rejects slashes/colons/spaces', () => {
  assert.equal(TICKER_RE.test('BRK.B'), true);
  assert.equal(TICKER_RE.test('BRK-B'), true);
  assert.equal(TICKER_RE.test('ABC/A'), false);
  assert.equal(TICKER_RE.test('ABC:A'), false);
  assert.equal(TICKER_RE.test('AB C'), false);
});

console.log('\nbh-w2-watchlist: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);

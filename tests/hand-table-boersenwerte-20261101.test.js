'use strict';
// Guard for the market-cap rows of 01.11.2026. Each row was checked by two independent checkers at a filing or exchange document.
// What was wrong, by kind:
// - Two share classes: Yahoo values all shares at the price of one line. The dearer line then wins the choice of the shown listing, because
//   the choice takes the highest market cap (CNOOC 256.9 instead of about 156 bn USD). A share-count row brings the shown line to the sum of the classes.
//   The other line is held where it is more than 25 % off that sum.
// - Second lines: a thin line abroad carries an old quote (Milan, Swiss, US over the counter), or an ADS price times all ordinary shares (SK hynix). Held; the firm's other line takes over.
// - One count without a document behind it: Galaxy Digital, 589.3 M shares against 388.5 M in the earnings release.
// Values are copied from the stored snapshots of run 41184535364 and run through the REAL lib/market-cap-guard.js.
// Break-once on test data only: `node tests/hand-table-boersenwerte-20261101.test.js --prove-red` runs the presence check on a ticker without a row and must exit 1.
// No wall clock; live files are hashed before and after.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const guard = require('../lib/market-cap-guard.js');
const { snapshots } = require('./fixtures/hand-table-boersenwerte-20261101.json');

const root = path.resolve(__dirname, '..');
const live = ['configs/share-count-hand-table.json', 'lib/market-cap-guard.js', 'lib/ads-hand-table.js', 'tests/fixtures/hand-table-boersenwerte-20261101.json'];
const liveHashes = () => live.map(f => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, f))).digest('hex'));
const beforeHashes = liveHashes();
const packet = t => { const { expect, ...s } = structuredClone(snapshots[t]); return { identifier: { primary: 'ISIN', value: 'TICKER:' + t }, timeseries: {}, annual: {}, ...s }; };
const entries = Object.entries(snapshots);
const held = entries.filter(([, s]) => s.expect.kind === 'hold').map(([t]) => t);
const corrected = entries.filter(([, s]) => s.expect.kind === 'correct').map(([t]) => t);
const HELD_COUNT = 104;
const CORRECTED_LIST = ["001289.SZ","0019.HK","1766.HK","1787.HK","600188.SS","600685.SS","600688.SS","600871.SS","600938.SS","600956.SS","601869.SS","688185.SS","688347.SS","688385.SS","688981.SS","GLXY"];

function expectWithheld(t, s = packet(t)) {
  const out = guard.prepareMarketCap(s);
  assert.equal(out.marketCap.value, null, t + ': the vendor value is still shown');
  assert.equal(out.marketCap.source, 'hand-table:market-cap-hold', t);
  assert.equal(out.marketCap.yahooValue, snapshots[t]?.marketCap.value ?? s.marketCap.yahooValue, t);
  return out;
}

if (process.argv.includes('--prove-red')) {
  const s = packet(held[0]); s.meta.ticker = 'NOROW';
  const out = guard.prepareMarketCap(s);
  assert.equal(out.marketCap.value, null, 'NOROW: the vendor value is still shown');
  console.log('hand-table-boersenwerte-20261101: --prove-red did NOT fire');
  process.exit(0);
}

test('every row is in the table, sourced, dated and in plain German', () => {
  assert.ok(held.length > 0 && corrected.length > 0);
  for (const t of held) {
    const row = guard.holds[t];
    assert.ok(row && !guard.table[t], t + ': a hold, not a share-count row');
    assert.equal(row.reasonComplete, true, t);
    assert.equal(row.reviewBy, '2026-12-31', t + ': this date forces the next look');
  }
  for (const t of corrected) assert.ok(guard.table[t] && !guard.holds[t], t + ': a share-count row, not a hold');
  for (const t of [...held, ...corrected]) {
    const row = guard.holds[t] || guard.table[t];
    assert.ok(row.source.url.startsWith('https://') && row.source.quote && row.source.page, t + ': source');
    assert.equal(row.verifiedAt, '2026-11-01', t);
    assert.doesNotMatch(row.reason, /[–—]| - |kauf|verkauf/i, t + ': dash as punctuation or a trading word');
    assert.match(row.reason, /(\d{2}\.\d{2}\.\d{4})/, t + ': names its day');
  }
});

test('the count of rows is pinned; a row cannot leave together with its fixture', () => {
  assert.equal(held.length, HELD_COUNT);
  assert.deepEqual([...corrected].sort(), CORRECTED_LIST);
  assert.equal(Object.keys(guard.holds).filter(t => snapshots[t]).length, HELD_COUNT, 'every fixture hold is in the table');
  // Yahoo's next count must still be recognised at Hua Hong, whose count changed in September.
  assert.equal(guard.table['688347.SS'].wrongShares.length, 2);
  for (const t of corrected) assert.equal(guard.table[t].reviewBy, t === 'GLXY' ? '2027-03-15' : '2026-12-31', t);
});

test('a reason names the checked value, so a changed number in the fixture or the row goes red', () => {
  const de = x => (x / 1e9).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  for (const t of held) assert.ok(guard.holds[t].reason.includes(de(snapshots[t].expect.usd)), t + ': ' + de(snapshots[t].expect.usd));
});

test('a held line shows no market cap and no ratio built on it, and says why', () => {
  for (const t of held) {
    const s = packet(t);
    s.metrics.priceSales = { value: 9.9, source: 'yahoo_quoteSummary' };
    s.metrics.enterpriseToRevenue = { value: 9.9, source: 'yahoo_quoteSummary' };
    const out = expectWithheld(t, s);
    assert.equal(out.metrics.priceSales, null, t + ': a ratio built on the market cap survives');
    assert.equal(out.metrics.enterpriseToRevenue, null, t + ': EV/revenue survives');
    assert.equal(out.meta.marketCapReason, 'Börsenwert nicht verlässlich: ' + guard.holds[t].reason, t);
  }
});

test('a corrected line lands on the checked value of the firm, and blanks the ratios from the wrong one', () => {
  for (const t of corrected) {
    const { expect } = snapshots[t];
    const s = packet(t);
    s.metrics.priceSales = { value: 9.9, source: 'yahoo_quoteSummary' };
    const out = guard.prepareMarketCap(s);
    assert.equal(out.marketCap.source, 'hand-table:shares', t);
    assert.equal(out.marketCap.yahooValue, expect.mc, t);
    assert.ok(Math.abs(out.marketCap.value / expect.usd - 1) < 0.02, `${t}: ${out.marketCap.value} against ${expect.usd}`);
    assert.equal(out.metrics.priceSales, null, t);
    assert.equal(out.meta.marketCapReason, guard.table[t].reason, t);
  }
});

test('wrong before, right after: each row moved by more than 25 % towards the checked value', () => {
  for (const t of corrected) {
    const { expect } = snapshots[t];
    const before = expect.mc / expect.usd;
    assert.ok(before > 1.25 || before < 0.8, `${t}: ${before} was inside 25 %`);
  }
  for (const t of held) {
    const { expect } = snapshots[t];
    const before = expect.mc / expect.usd;
    if (expect.ratioOnly) { assert.equal(t, 'KXIAY', 'only the Kioxia ADR is held for its ratio'); continue; }
    assert.ok(before > 1.25 || before < 0.8, `${t}: ${before} was inside 25 %`);
  }
});

test('absence: a row without a case keeps its identity; a data day before validFrom stays untouched', () => {
  const other = packet(held[0]); other.meta.ticker = 'NOROW';
  assert.equal(guard.prepareMarketCap(other), other);
  for (const t of [held[0], corrected[0]]) {
    const s = packet(t); s.marketCap.asOf = '2026-09-01T00:00:00.000Z'; s.meta.asOf = s.marketCap.asOf;
    assert.equal(guard.prepareMarketCap(s).marketCap.value, snapshots[t].marketCap.value, t);
  }
});

test('refusal: a count that is neither the issuer count nor a known wrong one leaves the corrected line empty, never multiplied', () => {
  for (const t of corrected) {
    const s = packet(t); s.marketCap.value *= 2;
    const out = guard.prepareMarketCap(s);
    assert.equal(out.marketCap.value, null, t + ': an unknown count must not pass');
    assert.equal(out.marketCap.source, 'hand-table:market-cap-hold', t);
  }
});

test('confirmed: once Yahoo uses the issuer count, the vendor value stays', () => {
  for (const t of corrected) {
    const s = packet(t); s.marketCap.value = s.price.regularMarketPrice * guard.table[t].shares;
    const out = guard.prepareMarketCap(s);
    assert.notEqual(out.marketCap.source, 'hand-table:shares', t);
    assert.ok(Math.abs(out.marketCap.value / s.marketCap.value - 1) < 1e-9, t);
  }
});

test('break-once: the presence check is red on a ticker without a row', () => {
  const child = spawnSync(process.execPath, [__filename, '--prove-red'], { cwd: root, encoding: 'utf8' });
  assert.equal(child.status, 1, child.stdout);
  assert.match(child.stderr, /NOROW: the vendor value is still shown/);
});

test('live files stayed unchanged', () => assert.deepEqual(liveHashes(), beforeHashes));

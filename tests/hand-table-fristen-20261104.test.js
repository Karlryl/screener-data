'use strict';
// Guard for the renewal of the six share-count rows that ran out on Mon 2026-11-16 (source check of 2026-11-04).
// Rows: ISA Energia Brasil ISAE3.SA, Kioxia 285A.T, Tokyo Electron 8035.T, Toppan 7911.T, 3018.TW, QH.
// Each was re-read against the newest issuer filing or exchange register and against what Yahoo shows now:
// - Kioxia: the count is now net of the 48,402,168 treasury shares of 2026-09-30 (the old row was 2.8 % too high, just inside the 3 % tolerance).
// - ISA Energia: the share counts are unchanged, the row follows the price ratio of the two share classes (closes of 2026-11-03).
// - Tokyo Electron, Toppan, 3018.TW, QH: count unchanged, only the date moves. Yahoo is right again at the first three, still wrong at QH.
// What the date means in code: after reviewBy a withholdUnverified row withholds the market cap even when the vendor is right again,
// so letting a row run out is not "back to the vendor value"; a row the vendor has fixed has to be removed on purpose.
// This test fixes (a) the renewed rows, (b) that every row still corrects after the old deadline, confirms a right vendor value and
// refuses an unknown count, (c) that the new date still ends the correction. Values are copied from the stored snapshots of run 41027769596
// and the P205 fixtures and run through the REAL lib/market-cap-guard.js.
// Break-once on test data only: `node tests/hand-table-fristen-20261104.test.js --prove-red` puts the old date back on one row and must exit 1.
// No wall clock; live files are hashed before and after.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const guard = require('../lib/market-cap-guard.js');
const zj = require('./fixtures/hand-table-zahlenjagd-20261030.json').snapshots;
const p205 = require('./fixtures/market-cap-p205.json');

const root = path.resolve(__dirname, '..');
const live = ['configs/share-count-hand-table.json', 'lib/market-cap-guard.js', 'lib/ads-hand-table.js',
  'tests/fixtures/hand-table-zahlenjagd-20261030.json', 'tests/fixtures/market-cap-p205.json'];
const liveHashes = () => live.map(f => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, f))).digest('hex'));
const beforeHashes = liveHashes();

const OLD_DEADLINE = '2026-11-16', DAY_AFTER_OLD = '2026-11-17';
// shares and reviewBy as renewed on 2026-11-04; seen = the count Yahoo implied that day (null: still the wrong count).
const ROWS = {
  'ISAE3.SA': { shares: 583349906, reviewBy: '2026-12-04', seen: null }, // the pull's API field still implied 660,801,338 on 2026-11-04
  '285A.T': { shares: 1597905534, reviewBy: '2026-12-31', seen: 1597905577 },
  '8035.T': { shares: 2280791810, reviewBy: '2026-12-31', seen: 2263548630 },
  '7911.T': { shares: 561108010, reviewBy: '2026-11-30', seen: 561108020 },
  '3018.TW': { shares: 75377715, reviewBy: '2026-11-30', seen: 75377712 },
  QH: { shares: 2750893, reviewBy: '2026-12-15', seen: null },
};
const TICKERS = Object.keys(ROWS);
// About 585.6 M ON equivalents: the figure of Yahoo's key-statistics web page on 2026-11-04 (19.57 bn BRL). It is not a reading of the pull, so it stays out of `seen`.
const ISA_WEB_FIGURE = 585600000;

// Converted non-USD snapshot in the real key shape, as in tests/hand-table-boersenwerte-20261024.test.js.
const synthetic = (ticker, fx, px) => ({
  meta: { ticker, tradingCurrency: 'JPY', tradingCurrencyOriginal: 'JPY', reportingCurrency: 'USD', reportingCurrencyOriginal: 'JPY',
    fxConverted: true, tradingFxRateApplied: fx, fxRateApplied: fx, priceCurrency: 'USD' },
  marketCap: { value: 1, source: 'yahoo_quote', confidence: 0.9 },
  metrics: { priceSales: 10.02, enterpriseValue: 1e11, enterpriseToRevenue: 9.85, enterpriseToEbitda: 30, forwardPE: 8.78 },
  price: { regularMarketPrice: px, currencyUnit: 'USD', currency: 'JPY' },
});
const BASE = {
  'ISAE3.SA': () => zj['ISAE3.SA'], '7911.T': () => zj['7911.T'], QH: () => p205.QH, '3018.TW': () => p205['3018.TW'],
  '8035.T': () => synthetic('8035.T', 0.00636748, 60.22362584), '285A.T': () => synthetic('285A.T', 0.00636748, 81.2172074),
};
/** Snapshot whose vendor market cap implies `count` shares on data day `day`. */
function packet(t, count, day) {
  const s = structuredClone(BASE[t]());
  s.meta.ticker = t;
  s.marketCap = { ...s.marketCap, value: s.price.regularMarketPrice * count, source: 'yahoo_quote', asOf: day + 'T09:00:00.000Z' };
  s.meta.asOf = s.marketCap.asOf;
  delete s.marketCap.yahooValue;
  return s;
}
function quiet(fn) {
  const warn = console.warn; console.warn = () => {};
  try { return fn(); } finally { console.warn = warn; }
}
function expectCorrects(t, day) {
  const row = guard.table[t];
  const s = packet(t, row.wrongShares[0], day);
  const out = quiet(() => guard.prepareMarketCap(s));
  assert.equal(out.marketCap.source, 'hand-table:shares', `${t}: the correction does not apply on ${day}`);
  assert.ok(Math.abs(out.marketCap.value / (s.price.regularMarketPrice * row.shares) - 1) < 1e-9, t);
  return out;
}

if (process.argv.includes('--prove-red')) {
  guard.table['7911.T'].reviewBy = OLD_DEADLINE; // the old date back on one row
  expectCorrects('7911.T', DAY_AFTER_OLD);
  console.log('hand-table-fristen-20261104: --prove-red did NOT fire');
  process.exit(0);
}

test('the six rows are renewed: new date, checked on 2026-11-04, with the evidence of the check', () => {
  for (const t of TICKERS) {
    const row = guard.table[t], want = ROWS[t];
    assert.ok(row && row.withholdUnverified === true, t + ': a strict row');
    assert.equal(row.shares, want.shares, t + ': count');
    assert.equal(row.reviewBy, want.reviewBy, t + ': this date forces the next look');
    assert.ok(row.reviewBy > OLD_DEADLINE, t);
    assert.equal(row.verifiedAt, '2026-11-04', t);
    assert.ok(row.source.url.startsWith('https://') && row.source.quote, t + ': source');
    const r = row.renewal;
    assert.ok(r && r.checkedAt === '2026-11-04' && r.previousReviewBy === OLD_DEADLINE, t + ': renewal record');
    assert.ok(r.reviewByReason && r.vendorSeen && r.newestCount > 0 && /^\d{4}-\d{2}-\d{2}$/.test(r.newestCountAsOf), t + ': renewal reason, vendor reading and newest count');
    assert.doesNotMatch(row.reason, /[–—]| - |kauf|verkauf/i, t + ': dash as punctuation or a trading word');
  }
});

test('no row that withholds on expiry still ends on the old deadline', () => {
  assert.deepEqual(Object.entries(guard.table).filter(([, r]) => r.reviewBy === OLD_DEADLINE).map(([t]) => t), []);
});

test('Kioxia: the count is net of treasury shares and the reason names the day and both numbers', () => {
  const row = guard.table['285A.T'];
  assert.equal(row.shares, 1646307702 - 48402168);
  assert.equal(row.sharesAsOf, '2026-09-30');
  assert.match(row.reason, /Stückzahl zum 30\.09\.2026 laut Kioxia/);
  assert.ok(row.reason.includes('1.597.905.534') && row.reason.includes('1.646.307.702') && row.reason.includes('48.402.168'));
  assert.equal(row.renewal.previousShares, 1644045264);
});

test('ISA Energia: the count is ON plus PN times the price ratio of the closes of 2026-11-03', () => {
  const row = guard.table['ISAE3.SA'];
  assert.equal(row.shares, Math.round(238170004 + 465157744 * (24.799999237060547 / 33.41999816894531)));
  assert.match(row.reason, /Schlusskursen 24,80 und 33,42 BRL vom 03\.11\.2026/);
  assert.equal(row.renewal.previousShares, 564711511);
  // Both vendor counts that can come back stay recognised.
  assert.deepEqual([...row.wrongShares].sort(), [660801338, 703327748]);
});

test('the day after the old deadline every row still corrects the known wrong vendor count', () => {
  for (const t of TICKERS) expectCorrects(t, DAY_AFTER_OLD);
});

test('on its last day a row still applies; the day after it the market cap stays empty with a reason', () => {
  const plusDay = d => new Date(Date.parse(d + 'T00:00:00Z') + 864e5).toISOString().slice(0, 10);
  for (const t of TICKERS) {
    expectCorrects(t, guard.table[t].reviewBy);
    const out = quiet(() => guard.prepareMarketCap(packet(t, guard.table[t].wrongShares[0], plusDay(guard.table[t].reviewBy))));
    assert.equal(out.marketCap.value, null, t + ': the value is still shown after the date');
    assert.equal(out.marketCap.source, 'hand-table:market-cap-hold', t);
    assert.match(out.meta.marketCapReason, /^Börsenwert nicht verlässlich:/, t);
  }
});

test('a vendor value that is right again stays untouched, also after the old deadline', () => {
  for (const t of TICKERS.filter(x => ROWS[x].seen)) {
    const s = packet(t, ROWS[t].seen, DAY_AFTER_OLD);
    const out = quiet(() => guard.prepareMarketCap(s));
    assert.notEqual(out.marketCap.source, 'hand-table:shares', t);
    assert.equal(out.marketCap.value, s.marketCap.value, t + ': vendor value changed');
    assert.equal(out.meta.marketCapReason, undefined, t);
  }
});

test('ISA Energia: a vendor count at the sum of both classes is confirmed, where the count before the renewal would have withheld it', () => {
  const s = packet('ISAE3.SA', ISA_WEB_FIGURE, DAY_AFTER_OLD);
  const out = quiet(() => guard.prepareMarketCap(s));
  assert.notEqual(out.marketCap.source, 'hand-table:shares');
  assert.equal(out.marketCap.value, s.marketCap.value);
  assert.ok(Math.abs(ISA_WEB_FIGURE / 564711511 - 1) > 0.03, 'the old count was outside the 3 % tolerance of this figure');
});

test('a vendor count that matches neither the row nor a known wrong count is withheld, never multiplied', () => {
  for (const t of TICKERS) {
    const out = quiet(() => guard.prepareMarketCap(packet(t, guard.table[t].shares * 1.5, DAY_AFTER_OLD)));
    assert.equal(out.marketCap.value, null, t);
    assert.equal(out.marketCap.source, 'hand-table:market-cap-hold', t);
  }
});

test('break-once: with the old date back on one row the check after the old deadline is red', () => {
  const child = spawnSync(process.execPath, [__filename, '--prove-red'], { cwd: root, encoding: 'utf8' });
  assert.equal(child.status, 1, child.stdout);
  assert.match(child.stderr, /7911\.T: the correction does not apply on 2026-11-17/);
});

test('live files stayed unchanged', () => assert.deepEqual(liveHashes(), beforeHashes));

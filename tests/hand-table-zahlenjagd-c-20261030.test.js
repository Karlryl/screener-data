'use strict';
// Guard for the last repair of the board check of 30.10.2026 (non-US small caps): Etoiles Capital (EFTY), small-cap
// industrials, unprofitable, rank 18. Its Nasdaq trading has been suspended since 2025-10-06, the last close is 15.02 USD
// of 2025-10-03, and Yahoo multiplies it by 20,110,000 shares, the count before the Class B surrender (15,110,000 now).
// No current market cap exists, so this is a hold like the delisted ARX.TO, not a share-count row: the field is empty with
// the reason and the export drops the row. Values below are copied from the stored small-cap snapshot of run 40873805484.
// Break-once on test data only: `node tests/hand-table-zahlenjagd-c-20261030.test.js --prove-red` runs the presence check
// on a ticker without a row and must exit 1. No wall clock; live files are hashed before and after.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const guard = require('../lib/market-cap-guard.js');

const root = path.resolve(__dirname, '..');
const live = ['configs/share-count-hand-table.json', 'lib/market-cap-guard.js', 'lib/ads-hand-table.js', 'scripts/write-findash-export.js'];
const liveHashes = () => live.map(f => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, f))).digest('hex'));
const beforeHashes = liveHashes();

const AS_OF = '2026-10-29T12:36:04.327Z';
const packet = (ticker = 'EFTY') => ({
  identifier: { primary: 'ISIN', value: 'TICKER:' + ticker },
  meta: { ticker, exchangeName: 'NasdaqCM', reportingCurrency: 'USD', tradingCurrency: 'USD', fetchedAt: AS_OF, asOf: AS_OF, sharesOutstanding: 15110000, impliedSharesOutstanding: 20110000 },
  marketCap: { value: 302052224, source: 'yahoo_quoteSummary', confidence: 0.9, asOf: AS_OF },
  metrics: { priceSales: { value: 93.7368, source: 'yahoo_quoteSummary', confidence: 0.9, asOf: AS_OF } },
  timeseries: {}, annual: {},
});

function expectWithheld(ticker) {
  const out = guard.prepareMarketCap(packet(ticker));
  assert.equal(out.marketCap.value, null, 'the vendor value is still shown');
  assert.equal(out.marketCap.missing, true);
  assert.equal(out.marketCap.source, 'hand-table:market-cap-hold');
  assert.equal(out.marketCap.yahooValue, 302052224);
  assert.equal(out.metrics.priceSales, null, 'a ratio built on the market cap survives');
  return out;
}

if (process.argv.includes('--prove-red')) {
  expectWithheld('NOROW');
  console.log('hand-table-zahlenjagd-c-20261030: --prove-red did NOT fire');
  process.exit(0);
}

test('EFTY is held with a source, its reason names both dates and both counts, and no later value is promised', () => {
  const row = guard.holds.EFTY;
  assert.ok(row && !guard.table.EFTY, 'a hold, not a share-count row');
  assert.ok(row.source.url.startsWith('https://www.sec.gov/') && row.source.quote.includes('suspended since October 6, 2025'));
  for (const part of ['06.10.2025', '03.10.2025', '20,11 Mio.', '15,11 Mio.']) assert.ok(row.reason.includes(part), part);
  assert.doesNotMatch(row.reason, / [–—-] /, 'dash as punctuation');
  assert.equal(row.reviewBy, '2026-11-30', 'trading may resume under the same symbol: this date forces the next look');
  const out = expectWithheld('EFTY');
  assert.equal(out.meta.marketCapReason, 'Börsenwert nicht verlässlich: ' + row.reason);
});

test('absence: the same packet under another ticker and EFTY before validFrom stay untouched', () => {
  const other = packet('EFTX');
  assert.equal(guard.prepareMarketCap(other), other, 'a row without a case keeps its identity');
  assert.equal(other.marketCap.value, 302052224);
  const early = packet();
  early.marketCap.asOf = '2026-09-30T00:00:00.000Z';
  assert.equal(guard.prepareMarketCap(early).marketCap.value, 302052224);
});

test('export: the small-cap row of EFTY is dropped with the reason, another small-cap row with the same values stays', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hand-table-efty-'));
  try {
    for (const t of ['EFTY', 'EFTX']) fs.writeFileSync(path.join(dir, t + '.json'), JSON.stringify(packet(t)));
    const child = spawnSync(process.execPath, ['-e', `
      const assert=require('node:assert/strict'),writer=require('./scripts/write-findash-export.js');
      const row=t=>({ticker:t,marketCap:302052224,score:21.5,mcapBand:'micro'});
      for(const mapper of [writer.mapBoardRow,writer.mapOverviewRow]) {
        assert.equal(mapper(row('EFTY'),0,'smallcap',300e6),null);
        assert.equal(mapper(row('EFTX'),0,'smallcap',300e6).marketCap,302052224);
      }`], { cwd: root, env: { ...process.env, FINDASH_SMALLCAP_SNAPSHOTS_DIR: dir }, encoding: 'utf8' });
    assert.equal(child.status, 0, child.stdout + child.stderr);
    assert.match(child.stderr, /::error::EFTY: Exportzeile verworfen\. Börsenwert nicht verlässlich: Der Handel der Aktie von Etoiles Capital/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('live files stayed unchanged', () => assert.deepEqual(liveHashes(), beforeHashes));

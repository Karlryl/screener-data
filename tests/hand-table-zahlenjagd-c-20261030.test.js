'use strict';
// Guard for the last repairs of the board check of 30.10.2026 (non-US small caps and a last-trade scan of US and small-cap rows).
// EFTY, MCTA: Nasdaq trading suspended, last close of 2025-10-03 and 2025-11-11 (EFTY also with the count before the Class B surrender).
// RMAX, FBRX, NATH, SLP, WEAV: listing ended in a merger, the vendor still multiplies the last price by the last count.
// RCIT: a shell quoted at 2,262.50 USD by the vendor, 295.8 bn USD with no support in any filing.
// No current market cap exists for any of them, so these are holds like the delisted ARX.TO, not share-count rows: the field is
// empty with the reason and the export drops the row. Values are copied from the stored snapshots (small-cap run 40873805484, main run 41027769596).
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
const CASES = {
  EFTY: { mc: 302052224, shares: 15110000, implied: 20110000, ex: 'NasdaqCM', floor: 300e6, reason: ['06.10.2025', '03.10.2025', '20,11 Mio.', '15,11 Mio.'], quote: 'suspended since October 6, 2025', reviewBy: '2026-11-30' },
  MCTA: { mc: 445550176, shares: 15178000, implied: 15178000, ex: 'NasdaqCM', floor: 300e6, reason: ['12.11.2025', '11.11.2025'], quote: 'suspended or halted since November 12, 2025', reviewBy: '2026-11-16' },
  RMAX: { mc: 681161536, shares: 21317742, implied: 55110157, ex: 'NYSE', floor: 300e6, reason: ['24.08.2026', 'REAX'], quote: 'halted as of the close of business on August 24, 2026', reviewBy: '2026-11-30' },
  FBRX: { mc: 1634427392, shares: 21229087, implied: 21229087, ex: 'NasdaqCM', reason: ['27.08.2026', '26.08.2026', 'argenx'], quote: 'on August 27, 2026', reviewBy: '2026-11-30' },
  NATH: { mc: 417834048, shares: 4094405, implied: 4094405, ex: 'NasdaqGS', floor: 300e6, reason: ['26.10.2026', '23.10.2026', 'Smithfield'], quote: 'right to receive $102.00 in cash', reviewBy: '2026-11-30' },
  SLP: { mc: 374159488, shares: 20224838, implied: 20224838, ex: 'NasdaqGS', floor: 300e6, reason: ['06.10.2026', 'Altaris'], quote: 'no longer listed on Nasdaq as of October 6, 2026', reviewBy: '2026-11-30' },
  WEAV: { mc: 595333312, shares: 80450446, implied: 80450446, ex: 'NYSE', floor: 300e6, reason: ['26.10.2026', '23.10.2026', 'Francisco Partners'], quote: 'suspended prior to the opening of trading', reviewBy: '2026-11-30' },
  RCIT: { mc: 295782711296, shares: 130732697, implied: 130732697, ex: 'OTC Markets OTCPK', reason: ['2.262,50 USD', '295,8 Mrd. USD', '21.09.2026'], quote: 'Unsolicited quotations', reviewBy: '2026-11-30' },
};
const packet = (ticker, base = CASES[ticker]) => ({
  identifier: { primary: 'ISIN', value: 'TICKER:' + ticker },
  meta: { ticker, exchangeName: base.ex, reportingCurrency: 'USD', tradingCurrency: 'USD', fetchedAt: AS_OF, asOf: AS_OF, sharesOutstanding: base.shares, impliedSharesOutstanding: base.implied },
  marketCap: { value: base.mc, source: 'yahoo_quoteSummary', confidence: 0.9, asOf: AS_OF },
  metrics: { priceSales: { value: 93.7368, source: 'yahoo_quoteSummary', confidence: 0.9, asOf: AS_OF } },
  timeseries: {}, annual: {},
});

function expectWithheld(ticker, base = CASES[ticker]) {
  const out = guard.prepareMarketCap(packet(ticker, base));
  assert.equal(out.marketCap.value, null, ticker + ': the vendor value is still shown');
  assert.equal(out.marketCap.missing, true);
  assert.equal(out.marketCap.source, 'hand-table:market-cap-hold');
  assert.equal(out.marketCap.yahooValue, base.mc);
  assert.equal(out.metrics.priceSales, null, ticker + ': a ratio built on the market cap survives');
  return out;
}

if (process.argv.includes('--prove-red')) {
  expectWithheld('NOROW', CASES.EFTY);
  console.log('hand-table-zahlenjagd-c-20261030: --prove-red did NOT fire');
  process.exit(0);
}

test('every firm is held with a source, its reason names what happened, and no later value is promised', () => {
  for (const [t, c] of Object.entries(CASES)) {
    const row = guard.holds[t];
    assert.ok(row && !guard.table[t], t + ': a hold, not a share-count row');
    assert.ok(row.source.url.startsWith('https://www.sec.gov/') && row.source.quote.includes(c.quote), t + ': source');
    for (const part of c.reason) assert.ok(row.reason.includes(part), t + ': ' + part);
    assert.doesNotMatch(row.reason, / [–—-] /, t + ': dash as punctuation');
    assert.equal(row.reasonComplete, true, t);
    assert.equal(row.reviewBy, c.reviewBy, t + ': this date forces the next look');
    assert.equal(row.verifiedAt, '2026-10-30', t);
    const out = expectWithheld(t);
    assert.equal(out.meta.marketCapReason, 'Börsenwert nicht verlässlich: ' + row.reason, t);
  }
});

test('absence: the same packet under another ticker and a data day before validFrom stay untouched', () => {
  const other = packet('EFTX', CASES.EFTY);
  assert.equal(guard.prepareMarketCap(other), other, 'a row without a case keeps its identity');
  assert.equal(other.marketCap.value, CASES.EFTY.mc);
  for (const t of ['EFTY', 'MCTA', 'NATH']) {
    const early = packet(t);
    early.marketCap.asOf = '2025-01-01T00:00:00.000Z';
    assert.equal(guard.prepareMarketCap(early).marketCap.value, CASES[t].mc, t);
  }
});

test('export: board rows of the held firms are dropped with the reason, a row with the same values stays', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hand-table-holds-'));
  try {
    const small = Object.keys(CASES).filter(t => CASES[t].floor);
    for (const t of small) fs.writeFileSync(path.join(dir, t + '.json'), JSON.stringify(packet(t)));
    fs.writeFileSync(path.join(dir, 'EFTX.json'), JSON.stringify(packet('EFTX', CASES.EFTY)));
    const child = spawnSync(process.execPath, ['-e', `
      const assert=require('node:assert/strict'),writer=require('./scripts/write-findash-export.js');
      const row=(t,mc)=>({ticker:t,marketCap:mc,score:21.5,mcapBand:'micro'});
      for(const mapper of [writer.mapBoardRow,writer.mapOverviewRow]) {
        for(const [t,mc] of ${JSON.stringify(small.map(t => [t, CASES[t].mc]))}) assert.equal(mapper(row(t,mc),0,'smallcap',300e6),null,t);
        assert.equal(mapper(row('EFTX',302052224),0,'smallcap',300e6).marketCap,302052224);
      }`], { cwd: root, env: { ...process.env, FINDASH_SMALLCAP_SNAPSHOTS_DIR: dir }, encoding: 'utf8' });
    assert.equal(child.status, 0, child.stdout + child.stderr);
    assert.match(child.stderr, /::error::EFTY: Exportzeile verworfen\. Börsenwert nicht verlässlich: Der Handel der Aktie von Etoiles Capital/);
    assert.match(child.stderr, /::error::WEAV: Exportzeile verworfen\. Börsenwert nicht verlässlich: Weave Communications wurde/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('survival: the main-store rows of FBRX and RCIT are dropped with the reason', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hand-table-holds-'));
  try {
    for (const t of ['FBRX', 'RCIT']) fs.writeFileSync(path.join(dir, t + '.json'), JSON.stringify(packet(t)));
    const child = spawnSync(process.execPath, ['-e', `
      const assert=require('node:assert/strict'),writer=require('./scripts/write-findash-export.js');
      for(const [t,mc] of [['FBRX',1634427392],['RCIT',295782711296]]) assert.equal(writer.mapSurvivalRow({ticker:t,marketCap:mc,score:20},0),null,t);`],
    { cwd: root, env: { ...process.env, FINDASH_SNAPSHOTS_DIR: dir }, encoding: 'utf8' });
    assert.equal(child.status, 0, child.stdout + child.stderr);
    assert.match(child.stderr, /::error::RCIT: Exportzeile verworfen\./);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('live files stayed unchanged', () => assert.deepEqual(liveHashes(), beforeHashes));

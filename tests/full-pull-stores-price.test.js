'use strict';
// Real pullAll, real mapper and FX converter, real feed writer; provider and file effects are virtual.
// Break-once target is copied production source, never a writing test or live data.
// Why: until 30.10.2026 a full pull stored no price, so d52 in filter/universum.json went empty for that row.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { fixture, snapshot, NOW } = require('./stale-quarter-reload.test.js');
const { buildUniverse } = require('../scripts/write-filter-universe.js');
const { captureSnapshot } = require('../lib/export-provenance.js');

const root = path.resolve(__dirname, '..');
const shareTable = JSON.parse(fs.readFileSync(path.join(root, 'configs', 'share-count-hand-table.json'), 'utf8'));
const source = fs.readFileSync(path.join(root, 'pull-yahoo.js'), 'utf8');
const STAMP_LINE = "      _stampFullPullPrice(canonical, _y(yahoo.price, 'regularMarketPrice'));";
const GENERATED_AT = '2026-10-30T10:00:00.000Z';

// A row without a board or exclusion record only passes the writer with a routing verdict of its own.
const feedRow = snapshot => buildUniverse({ snapshots: [snapshot],
  excluded: new Map([[snapshot.meta.ticker, ['test-row']]]), generatedAt: GENERATED_AT }).rows[0];

async function fullPull({ currency, reporting = currency, price, high, cap = 5e12, pullSource = source }) {
  const summaryResponse = { price: { currency, marketCap: cap, regularMarketPrice: price },
    financialData: { financialCurrency: reporting }, summaryDetail: { marketCap: cap, fiftyTwoWeekHigh: high },
    quoteType: { quoteType: 'EQUITY' }, summaryProfile: { sector: 'Technology', industry: 'Software' } };
  const f = fixture({ summaryResponse, pullSource, snapshots: [snapshot('OLD', '2026-03-31')] });
  const manifest = await f.run();
  assert.equal(manifest.results[0].status, 'ok', 'expected a full pull, got ' + JSON.stringify(manifest.results[0]));
  return f.stored('OLD');
}

async function main() {
  const usd = await fullPull({ currency: 'USD', price: 80, high: 100 });
  assert.equal(usd.price.regularMarketPrice, 80);
  assert.equal(usd.price.currencyUnit, 'USD');
  assert.equal(usd.price.currency, undefined, 'region-mapping reads price.currency; a full pull must not start setting it');
  assert.equal(usd._pullMode, undefined, 'a full pull is not a price-only row');
  assert.equal(feedRow(usd).d52, -20);

  // Quote units: the stored price and the 52-week high carry the same per-share factor, so the ratio stays 0.8.
  for (const [currency, reporting] of [['JPY', 'JPY'], ['GBp', 'EUR'], ['HKD', 'CNY'], ['USD', 'TWD'], ['ZAc', 'USD']]) {
    const s = await fullPull({ currency, reporting, price: 800, high: 1000 });
    assert.ok(Math.abs(s.price.regularMarketPrice / s.metrics.fiftyTwoWeekHigh.value - 0.8) < 1e-9, currency + '/' + reporting);
    assert.equal(s.price.currencyUnit, 'USD');
    if (currency !== 'USD') assert.ok(s.price.regularMarketPrice < 800, currency + ': the stored price must be converted');
    assert.equal(feedRow(s).d52, -20, currency + '/' + reporting);
  }

  // No quote or a zero quote in the answer: the field stays absent and the row stays a gap, nothing is invented.
  for (const price of [null, 0]) {
    const noQuote = await fullPull({ currency: 'USD', price, high: 100 });
    assert.equal(noQuote.price, undefined, 'quote ' + price);
    assert.equal(feedRow(noQuote).d52, undefined, 'quote ' + price);
  }

  // Two days on the real ANDG row of the share-count table: the price-only run refreshes value and market-cap stamp but
  // never price.asOf. A stamp on the stored price would stay a day behind, the provenance would read that old time and
  // the row would stop being reproducible on day 2. Day 1 stays as it was before the fix (no price time, not reproducible).
  const wrong = shareTable.ANDG.wrongShares[0];
  const andg = { price: { currency: 'USD', marketCap: 20 * wrong, regularMarketPrice: 20 }, financialData: { financialCurrency: 'USD' },
    summaryDetail: { marketCap: 20 * wrong, fiftyTwoWeekHigh: 25 }, defaultKeyStatistics: { sharesOutstanding: wrong, impliedSharesOutstanding: wrong },
    quoteType: { quoteType: 'EQUITY' }, summaryProfile: { sector: 'Technology', industry: 'Software' } };
  const dayOne = fixture({ summaryResponse: andg, snapshots: [snapshot('ANDG', '2026-03-31')] });
  assert.equal((await dayOne.run()).results[0].status, 'ok');
  const stored = dayOne.stored('ANDG');
  assert.equal(stored.price.regularMarketPrice, 20);
  const dayTwo = fixture({ snapshots: [stored], quotePrice: 22, quoteMarketCap: 22 * wrong, now: NOW + 864e5 });
  assert.equal((await dayTwo.run()).results[0].status, 'price-only');
  const next = dayTwo.stored('ANDG');
  const proof = captureSnapshot(next);
  assert.equal(proof.marketCap.missingReason, null, 'day 2 must stay reproducible');
  const priceInput = proof.marketCapInputs.find(input => input.fieldPath === 'price.regularMarketPrice');
  assert.equal(priceInput.retrievedAt, next.marketCap.asOf, 'the price time of day 2 is the time of that pull');
  assert.ok(captureSnapshot(stored).marketCap.missingReason, 'day 1 stays as it was before the fix');

  // Break once: without the stamp the feed loses d52 again, which is the state of 29./30.10.2026.
  const lines = source.split(/\r?\n/);
  assert.equal(lines.filter(line => line === STAMP_LINE).length, 1, 'anchor must hit exactly one whole line');
  const broken = lines.filter(line => line !== STAMP_LINE).join('\n');
  const before = await fullPull({ currency: 'USD', price: 80, high: 100, pullSource: broken });
  assert.equal(before.price, undefined);
  assert.equal(feedRow(before).d52, undefined);
  console.log('ok full-pull-stores-price');
}

main().catch(error => { console.error(error); process.exit(1); });

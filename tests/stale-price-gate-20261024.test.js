'use strict';
// Guard for the stale-price gate (formula draft of 2026-10-24, Codex review pending).
//
// FINDING (numbers-trust audit of the 23.10. boards): ARX.TO (delisted 04.09.), 1WAF.MI (Milan quote weeks old)
// and PSKY (Nasdaq line ended 05.10.) showed stale market caps and had to be held by hand. The snapshots carry no
// quote time (meta.asOf and marketCap.asOf are the pull clock), so pull-yahoo.js now stamps Yahoo's own
// regularMarketTime on marketCap, and lib/market-cap-guard.js withholds a value whose quote is more than
// STALE_PRICE_TRADING_DAYS weekdays older than the pull day, on the same hold path as a hand-table hold.
// This guard runs the REAL guard and the REAL mapper on synthetic snapshots in the stored key shape:
//   presence  - a stale quote empties the value with the German reason, presence marker and vendor value kept
//   absence   - a fresh quote, a quote exactly at the limit, a weekend and no quote time leave the row untouched
//   precedence- a hand-table hold keeps its own reason; a hand-table correction on a stale quote is emptied once
//   dup leg   - PSKY (vendor stamps a fresh time on the old price) keeps its value; the dup table still removes its rank
//   pull      - the mapper stamps marketCap.regularMarketTime from price.regularMarketTime (Date or epoch seconds)
// Break-once on test data only: `node tests/stale-price-gate-20261024.test.js --prove-red` feeds the fixture at
// exactly the limit to the presence check and must exit 1. No wall clock; live files are hashed before and after.
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const guard = require('../lib/market-cap-guard.js');
const dup = require('../lib/dup-issuer-shadow-table.js');
const py = require('../pull-yahoo.js');

const LIVE = ['lib/market-cap-guard.js', 'configs/share-count-hand-table.json', 'configs/dup-issuer-shadow-table.json', 'pull-yahoo.js'];
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname, '..', f))).digest('hex');
const hashes = LIVE.map((f) => [f, sha(f)]);

let ok = 0, fail = 0;
function pruefe(name, fn) {
  try { fn(); ok++; } catch (e) { fail++; console.error('FAIL ' + name + ': ' + (e && e.message)); }
}

const AS_OF = '2026-10-23T08:12:46.554Z'; // pull clock of run 39918190374 (Friday)
function snap(ticker, { quoteTime, asOf = AS_OF, mcap = 77595885568, px = 9.5 } = {}) {
  return {
    meta: { ticker, tradingCurrency: 'USD', tradingCurrencyOriginal: 'USD', reportingCurrency: 'USD', reportingCurrencyOriginal: 'USD',
      fxConverted: true, tradingFxRateApplied: 1, fxRateApplied: 1, priceCurrency: 'USD', asOf },
    marketCap: { value: mcap, source: 'yahoo_quoteSummary', confidence: 0.9, asOf, ...(quoteTime ? { regularMarketTime: quoteTime } : {}) },
    metrics: { priceSales: 2.1, enterpriseValue: 1e11, enterpriseToRevenue: 2.5, enterpriseToEbitda: 9, forwardPE: 11.2 },
    price: { regularMarketPrice: px, currencyUnit: 'USD', currency: 'USD' },
  };
}
const LIMIT = guard.STALE_PRICE_TRADING_DAYS;

function expectWithheld(s, priceDay) {
  const before = JSON.stringify(s);
  const out = guard.prepareMarketCap(s);
  assert.notStrictEqual(out, s, 'stale row must be prepared on a copy');
  assert.strictEqual(JSON.stringify(s), before, 'input snapshot mutated');
  assert.strictEqual(out.marketCap.value, null, `${s.meta.ticker}: value shown (quote ${s.marketCap.regularMarketTime})`);
  assert.strictEqual(out.marketCap.missing, true, 'presence marker missing');
  assert.strictEqual(out.marketCap.source, guard.STALE_PRICE_SOURCE);
  assert.strictEqual(out.marketCap.yahooValue, s.marketCap.value, 'vendor value not kept');
  assert.strictEqual(out.meta.marketCapReason, `Letzter Kurs vom ${priceDay}, älter als ${LIMIT} Handelstage; Börsenwert nicht gezeigt.`);
  for (const f of ['priceSales', 'enterpriseValue', 'enterpriseToRevenue', 'enterpriseToEbitda']) assert.strictEqual(out.metrics[f], null, f + ' not blanked');
  assert.strictEqual(out.metrics.forwardPE, 11.2, 'unrelated metric touched');
  // The two board exits every reader uses: export/filter/rule40 drop on reason + empty value, scoring on missing + empty value.
  assert.ok(out.meta.marketCapReason && !Number.isFinite(out.marketCap.value), 'export exit predicate');
  assert.ok(out.marketCap.missing === true && !Number.isFinite(out.marketCap.value), 'scoring exit predicate');
  return out;
}
function expectUntouched(s) {
  const out = guard.prepareMarketCap(s);
  assert.strictEqual(out, s, `${s.meta.ticker}: a row without a case must keep identity (quote ${s.marketCap.regularMarketTime})`);
  assert.ok(!out.meta.marketCapReason, 'reason on an untouched row');
}

// Friday 2026-10-23: quote of Tuesday 2026-10-13 is 8 weekdays old, Wednesday 2026-10-14 exactly 7.
const AT_LIMIT = snap('WBD', { quoteTime: '2026-10-14T20:00:00.000Z' });
if (process.argv.includes('--prove-red')) {
  expectWithheld(AT_LIMIT, '14.10.2026'); // must throw: a quote exactly at the limit is shown
  console.log('stale-price-gate-20261024: --prove-red did NOT fire');
  process.exit(0);
}

pruefe('constant: default limit 7 weekdays, source name of the hold', () => {
  assert.strictEqual(LIMIT, 7);
  assert.strictEqual(guard.STALE_PRICE_SOURCE, 'stale-price:market-cap-hold');
});

pruefe('presence: WBD-like quote of 05.10. on the 23.10. pull is withheld (14 weekdays)', () => {
  expectWithheld(snap('WBD', { quoteTime: '2026-10-05T20:00:01.000Z' }), '05.10.2026');
  assert.strictEqual(guard.priceAge(snap('WBD', { quoteTime: '2026-10-05T20:00:01.000Z' }), 100).age, 14);
});

pruefe('presence: one weekday past the limit is withheld', () => {
  expectWithheld(snap('WBD', { quoteTime: '2026-10-13T20:00:00.000Z' }), '13.10.2026');
});

pruefe('absence: a quote exactly at the limit is shown', () => {
  assert.strictEqual(guard.priceAge(AT_LIMIT).age, 7);
  expectUntouched(AT_LIMIT);
});

pruefe('absence: fresh quote, Saturday pull on Friday quote, Lunar New Year closure of 7 weekdays', () => {
  expectUntouched(snap('AAPL', { quoteTime: '2026-10-22T20:00:01.000Z' }));
  expectUntouched(snap('AAPL', { quoteTime: '2026-10-23T20:00:01.000Z', asOf: '2026-10-24T08:35:49.879Z' }));
  assert.strictEqual(guard.priceAge(snap('AAPL', { quoteTime: '2026-10-23T20:00:01.000Z', asOf: '2026-10-24T08:35:49.879Z' })).age, 0);
  // Taiwan 2026: last bar 11.02., market closed until 23.02.; the Saturday run of 21.02. sees 7 weekdays.
  expectUntouched(snap('2330.TW', { quoteTime: '2026-02-11T05:30:00.000Z', asOf: '2026-02-21T08:40:00.000Z' }));
});

pruefe('absence: no quote time is reported, never held', () => {
  const s = snap('OLD', {});
  expectUntouched(s);
  assert.strictEqual(guard.applyStalePriceGate(structuredClone(s)).status, 'no-quote-time');
  assert.strictEqual(guard.applyStalePriceGate(structuredClone(snap('NUL', { mcap: null }))).status, 'no-value');
});

pruefe('precedence: hand-table holds ARX.TO and 1WAF.MI keep their own reason on a stale quote', () => {
  for (const [t, q] of [['ARX.TO', '2026-09-04T20:00:01.000Z'], ['1WAF.MI', '2026-09-25T07:55:05.000Z']]) {
    const out = guard.prepareMarketCap(snap(t, { quoteTime: q }));
    assert.strictEqual(out.marketCap.source, 'hand-table:market-cap-hold', t + ': gate overwrote the hand-table hold');
    assert.ok(out.meta.marketCapReason.startsWith('Börsenwert nicht verlässlich: ' + guard.holds[t].reason), t + ': reason');
    assert.ok(!out.meta.marketCapReason.includes('Letzter Kurs vom'), t + ': two reasons');
    assert.strictEqual(out.marketCap.value, null);
  }
});

pruefe('precedence: a hand-table correction on a stale quote is emptied with the one stale reason', () => {
  // 8035.T row (withholdUnverified): Yahoo value at the recorded wrong count, as stored on 2026-10-23.
  const tel = (quoteTime) => {
    const s = snap('8035.T', { quoteTime, mcap: 27339565394.16052, px: 60.22362584 });
    Object.assign(s.meta, { tradingCurrency: 'JPY', tradingCurrencyOriginal: 'JPY', reportingCurrencyOriginal: 'JPY', tradingFxRateApplied: 0.00636748, fxRateApplied: 0.00636748 });
    s.price.currency = 'JPY';
    return s;
  };
  const out = expectWithheld(tel('2026-10-01T06:00:00.000Z'), '01.10.2026');
  assert.strictEqual(out.marketCap.yahooValue, 27339565394.16052, 'vendor value, not the corrected one, is kept');
  // Same row with a fresh quote: the correction stands with its own reason, value = price x issuer count.
  const fresh = guard.prepareMarketCap(tel('2026-10-22T06:00:00.000Z'));
  assert.strictEqual(fresh.marketCap.source, 'hand-table:shares');
  assert.ok(Math.abs(fresh.marketCap.value / (60.22362584 * guard.table['8035.T'].shares) - 1) < 1e-9, String(fresh.marketCap.value));
  assert.strictEqual(fresh.meta.marketCapReason, guard.table['8035.T'].reason);
});

pruefe('idempotent: preparing a prepared stale row keeps value, source and reason', () => {
  const once = guard.prepareMarketCap(snap('WBD', { quoteTime: '2026-10-05T20:00:01.000Z' }));
  const twice = guard.prepareMarketCap(once);
  assert.deepStrictEqual(twice, once);
});

pruefe('tally: checked, unstamped and withheld values are counted for the exit line', () => {
  const before = { ...guard.staleTally };
  guard.prepareMarketCap(snap('OLD', {}));
  guard.prepareMarketCap(snap('WBD', { quoteTime: '2026-10-05T20:00:01.000Z' }));
  guard.prepareMarketCap(snap('AAPL', { quoteTime: '2026-10-22T20:00:01.000Z' }));
  assert.deepStrictEqual(Object.fromEntries(Object.keys(before).map((k) => [k, guard.staleTally[k] - before[k]])),
    { checked: 3, noQuoteTime: 1, withheld: 1 });
});

pruefe('dup leg: PSKY keeps its value on a fresh vendor time; the dup table still removes its rank next to SKYD', () => {
  const psky = snap('PSKY', { quoteTime: '2026-10-22T20:00:00.000Z', mcap: 10992190464, px: 9.775 });
  expectUntouched(psky);
  const home = dup.homeListingIndex(dup.loadDupIssuerShadowTable());
  assert.strictEqual(dup.dupIssuerRankGrund('PSKY', home, new Set(['PSKY', 'SKYD'])), 'dupIssuer');
  // A dup leg whose own quote is stale leaves the boards on the market-cap hold; its snapshot carries one reason.
  const stale = expectWithheld(snap('PSKY', { quoteTime: '2026-10-05T20:00:00.000Z', mcap: 10992190464, px: 9.775 }), '05.10.2026');
  assert.ok(!('dupIssuer' in stale), 'gate wrote a dup marker');
});

pruefe('pull: the real mapper stamps marketCap.regularMarketTime from the price module', () => {
  const map = (price) => py.mapYahooToCanonical({ summaryDetail: { marketCap: 19188787200 },
    price: Object.assign({ marketCap: 19188787200, regularMarketPrice: 33.91, currency: 'CAD' }, price) }, { ticker: 'FIXT', name: 'Fixture' }, AS_OF);
  assert.strictEqual(map({ regularMarketTime: new Date('2026-09-04T20:00:01.000Z') }).marketCap.regularMarketTime, '2026-09-04T20:00:01.000Z');
  assert.strictEqual(map({ regularMarketTime: 1788552001 }).marketCap.regularMarketTime, '2026-09-04T20:00:01.000Z');
  assert.ok(!('regularMarketTime' in map({}).marketCap), 'time invented without a vendor field');
  assert.strictEqual(map({}).marketCap.asOf, AS_OF, 'pull clock changed');
});

for (const [f, h] of hashes) if (sha(f) !== h) { fail++; console.error('FAIL live file changed: ' + f); }
console.log(`stale-price-gate-20261024: ${ok} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);

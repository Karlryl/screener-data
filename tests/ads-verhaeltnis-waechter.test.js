'use strict';
// Guard for the ADS hand table (T322, W2 diagnosis 2026-09-26).
//
// FINDING: Yahoo multiplies HSAI's ADS price by the ORDINARY share count (1 ADS = 8 Class B shares
// since 2026-07-10) -> marketCap 20.43 bn instead of ~2.55 bn (2525.HK: 2.56 bn). BSBR is 2x.
// lib/ads-hand-table.js corrects table rows while the error is visible, stamps 'hand-table:ads' and
// blanks the Yahoo fields computed from the wrong marketCap. This guard runs the lib on synthetic
// snapshots in the real key shape, against the REAL configs/ads-hand-table.json:
//   presence  - every row lands within 3 % of its pair leg (delete the HSAI row -> red;
//               a new row without a pair-leg fixture -> red)
//   absence   - LU-like and JBS-like legs byte-identical; a row whose error is gone, an
//               already-corrected row: value untouched (never double-correct), stale stamped
// No wall clock: every date is a fixed string.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadAdsHandTable, applyAdsHandTable, DERIVED_FIELDS, PROVENANCE } = require('../lib/ads-hand-table.js');

let ok = 0, fail = 0;
function pruefe(name, fn) {
  try { fn(); ok++; }
  catch (e) { fail++; console.error('FAIL ' + name + ': ' + (e && e.message)); }
}

const AS_OF = '2026-09-26T08:22:24.537Z';
const m = (value) => ({ value, source: 'yahoo_quoteSummary', confidence: 0.9, asOf: '2026-09-15T08:16:26.064Z' });
// Snapshot leg in the real key shape (meta / marketCap / metrics / price).
function leg({ ticker, px, shares, implied = shares, mcap = px * implied, ccy = 'USD', asOf = AS_OF }) {
  return {
    identifier: { primary: 'ISIN', value: 'TICKER:' + ticker },
    meta: { ticker, exchangeName: 'NasdaqGS', tradingCurrency: 'USD', tradingCurrencyOriginal: ccy,
      sharesOutstanding: shares, impliedSharesOutstanding: implied, asOf, priceCurrency: 'USD' },
    marketCap: { value: mcap, source: 'yahoo_quote', confidence: 0.9, asOf },
    metrics: { priceSales: m(43.1), enterpriseValue: m(-3.27e9), enterpriseToRevenue: m(-6.58),
      enterpriseToEbitda: m(-242.8), forwardPE: m(18.5), sbcRatio: null },
    price: { regularMarketPrice: px, currencyUnit: 'USD', currency: ccy },
    _pullMode: 'price-only',
  };
}
// Pair-leg fixtures (26.09. snapshots): Yahoo ADS price, Yahoo share count, pair-leg marketCap.
// Every table row needs one - a row added without a pair-leg check fails here.
const PAIR = {
  HSAI: { px: 16.25, shares: 1041146800, implied: 1257137688, pairMcap: 2564475148 }, // 2525.HK
  BSBR: { px: 5.76, shares: 7487527435, pairMcap: 21423000000 },                      // SANB3.SA
};
const HK_LEG_MCAP = PAIR.HSAI.pairMcap;
const hsaiLike = () => leg({ ticker: 'HSAI', ...PAIR.HSAI });
const TABLE = loadAdsHandTable();
const unveraendert = (snap, ticker, table = TABLE) => {
  const vorher = JSON.stringify(snap);
  const r = applyAdsHandTable(snap, ticker, snap.price.regularMarketPrice, table);
  assert.strictEqual(JSON.stringify(snap), vorher, `${ticker} changed (status ${r.status})`);
  return r;
};
// Stale: Yahoo's value and every metric stay; only meta._adsHandTableStale is added.
const bleibtStale = (snap, ticker) => {
  const vorher = JSON.stringify(snap);
  const r = applyAdsHandTable(snap, ticker, snap.price.regularMarketPrice, TABLE);
  assert.strictEqual(r.status, 'stale', `${ticker}: expected stale, got ${r.status}`);
  assert.ok(typeof snap.meta._adsHandTableStale === 'string' && snap.meta._adsHandTableStale, 'stale row not stamped in the snapshot');
  delete snap.meta._adsHandTableStale;
  assert.strictEqual(JSON.stringify(snap), vorher, `${ticker}: stale row changed more than the stamp`);
};

pruefe('presence: HSAI-like leg is corrected to within 3 % of the HK leg', () => {
  const s = hsaiLike();
  const r = applyAdsHandTable(s, 'HSAI', s.price.regularMarketPrice, TABLE);
  assert.strictEqual(r.status, 'corrected', 'HSAI row missing or not applied: ' + JSON.stringify(r));
  assert.ok(Math.abs(s.marketCap.value / HK_LEG_MCAP - 1) <= 0.03, 'HSAI ' + s.marketCap.value + ' vs HK ' + HK_LEG_MCAP);
  assert.strictEqual(s.marketCap.source, PROVENANCE);
  assert.strictEqual(s.marketCap.yahooValue, 16.25 * 1257137688);
  for (const f of DERIVED_FIELDS) assert.strictEqual(s.metrics[f], null, f + ' not blanked to null');
  assert.deepStrictEqual(s.metrics.forwardPE, m(18.5), 'a field not derived from marketCap was touched');
  assert.strictEqual(s.metrics.sbcRatio, null);
  assert.ok(!('_adsHandTableStale' in s.meta));
});

pruefe('presence: every table row has a pair-leg fixture and lands within 3 % of it', () => {
  // Both directions: a fixture whose row was deleted from the table (e.g. BSBR) is red too.
  for (const ticker of Object.keys(PAIR)) assert.ok(TABLE[ticker], `required table row ${ticker} missing`);
  for (const ticker of Object.keys(TABLE)) {
    const p = PAIR[ticker];
    assert.ok(p, `table row ${ticker} has no pair-leg fixture (${TABLE[ticker].pairLeg}) in this guard`);
    const s = leg({ ticker, ...p });
    assert.strictEqual(applyAdsHandTable(s, ticker, p.px, TABLE).status, 'corrected', ticker);
    assert.ok(Math.abs(s.marketCap.value / p.pairMcap - 1) <= 0.03, `${ticker} ${s.marketCap.value} vs pair ${p.pairMcap}`);
  }
});

pruefe('absence: LU-like leg (Yahoo shares already ADS-equivalent) stays byte-identical', () => {
  assert.strictEqual(unveraendert(leg({ ticker: 'LU', px: 1.23, shares: 866688892 }), 'LU').status, 'no-row');
});

pruefe('absence: JBS-like leg stays byte-identical', () => {
  assert.strictEqual(unveraendert(leg({ ticker: 'JBS', px: 11.57, shares: 776068594, implied: 1070910861 }), 'JBS').status, 'no-row');
});

pruefe('absence: Yahoo fixed the mcap, shares still ordinary -> stale, not divided again', () => {
  bleibtStale(leg({ ticker: 'HSAI', px: 16.25, shares: 1041146800, implied: 1257137688, mcap: 2.554e9 }), 'HSAI');
});

pruefe('absence: Yahoo switched to the ADS count (LU form) -> stale, not divided again', () => {
  const s = leg({ ticker: 'HSAI', px: 16.25, shares: 1257137688 / 8 });
  assert.ok(Math.abs(s.marketCap.value / (16.25 * s.meta.impliedSharesOutstanding) - 1) < 1e-9, 'fixture: mcap = price x shares');
  bleibtStale(s, 'HSAI');
});

pruefe('absence: already corrected (price-only without new Yahoo mcap) -> not divided again', () => {
  const s = hsaiLike();
  applyAdsHandTable(s, 'HSAI', 16.25, TABLE);
  assert.strictEqual(unveraendert(s, 'HSAI').status, 'already-corrected');
});

pruefe('absence: snapshot dated before validFrom -> stale, unchanged', () => {
  bleibtStale(leg({ ticker: 'HSAI', ...PAIR.HSAI, asOf: '2026-07-09T20:00:00.000Z' }), 'HSAI');
});

pruefe('absence: missing price -> stale, unchanged', () => {
  const s = hsaiLike(); s.price.regularMarketPrice = null;
  bleibtStale(s, 'HSAI');
});

pruefe('3 % tolerance is pinned: mcap/(price*shares) 1.02 corrects, 1.04 stays', () => {
  const nah = leg({ ticker: 'HSAI', ...PAIR.HSAI, mcap: 16.25 * 1257137688 * 1.02 });
  assert.strictEqual(applyAdsHandTable(nah, 'HSAI', 16.25, TABLE).status, 'corrected');
  bleibtStale(leg({ ticker: 'HSAI', ...PAIR.HSAI, mcap: 16.25 * 1257137688 * 1.04 }), 'HSAI');
});

pruefe('share-scale midpoint is pinned: half the ordinary count corrects, a quarter stays', () => {
  // k = 8: midpoint 1/sqrt(8) = 0.354 of the ordinary count. 0.5 is ordinary side, 0.25 ADS side.
  const halb = leg({ ticker: 'HSAI', px: 16.25, shares: 1257137688 * 0.5 });
  assert.strictEqual(applyAdsHandTable(halb, 'HSAI', 16.25, TABLE).status, 'corrected');
  bleibtStale(leg({ ticker: 'HSAI', px: 16.25, shares: 1257137688 * 0.25 }), 'HSAI');
});

pruefe('stale row: a Yahoo-sourced value loses the stamps of an earlier correction', () => {
  const s = leg({ ticker: 'HSAI', ...PAIR.HSAI, mcap: 2.554e9 });
  Object.assign(s.marketCap, { yahooValue: 20428487430, ordinaryPerAds: 8 }); // price-only overwrote value+source only
  assert.strictEqual(applyAdsHandTable(s, 'HSAI', 16.25, TABLE).status, 'stale');
  assert.strictEqual(s.marketCap.value, 2.554e9);
  assert.ok(!('yahooValue' in s.marketCap) && !('ordinaryPerAds' in s.marketCap), JSON.stringify(s.marketCap));
});

pruefe('a later correction clears an earlier stale stamp', () => {
  const s = hsaiLike(); s.meta._adsHandTableStale = 'yesterday';
  assert.strictEqual(applyAdsHandTable(s, 'HSAI', 16.25, TABLE).status, 'corrected');
  assert.ok(!('_adsHandTableStale' in s.meta));
});

pruefe('the guard is not blind: without the HSAI row nothing is corrected', () => {
  const ohne = Object.assign({}, TABLE); delete ohne.HSAI;
  assert.strictEqual(unveraendert(hsaiLike(), 'HSAI', ohne).status, 'no-row');
});

pruefe('loader rejects a malformed row (fail loud, never silently off)', () => {
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ads-ht-')), 't.json');
  fs.writeFileSync(tmp, JSON.stringify({ X: { ordinaryPerAds: 1, validFrom: '2026-01-01', pairLeg: 'X.HK', yahooOrdinaryShares: 1, source: 's', verifiedAt: 'v' } }));
  assert.throws(() => loadAdsHandTable(tmp), /ordinaryPerAds/);
  for (const root of ['[]', 'true', '42', 'null']) {
    fs.writeFileSync(tmp, root);
    assert.throws(() => loadAdsHandTable(tmp), /root must be an object/, 'root ' + root + ' accepted');
  }
});

pruefe('wiring: the helper pull-yahoo.js calls corrects with the real table', () => {
  const py = require('../pull-yahoo.js');
  const s = hsaiLike();
  assert.strictEqual(py._applyAdsHandTable(s, 'HSAI', 16.25).status, 'corrected');
  assert.ok(Math.abs(s.marketCap.value / HK_LEG_MCAP - 1) <= 0.03);
});

pruefe('wiring: both marketCap write sites apply the table before the mcap floor; price-only refuses on stale', () => {
  // _priceOnlyUpdate and the full pull live in pullAll's closure (not callable from outside):
  // the call sites and their price arguments are pinned verbatim.
  const src = fs.readFileSync(path.join(__dirname, '..', 'pull-yahoo.js'), 'utf8');
  const priceOnly = "if (_applyAdsHandTable(existing, stock.ticker, existing.price && existing.price.regularMarketPrice).status === 'stale') {";
  const fullPull = "_applyAdsHandTable(canonical, stock.ticker, _y(yahoo.price, 'regularMarketPrice'));";
  assert.strictEqual([...src.matchAll(/_applyAdsHandTable\((existing|canonical), /g)].length, 2, 'expected exactly 2 call sites');
  for (const txt of [priceOnly, fullPull]) {
    const i = src.indexOf(txt);
    assert.ok(i > 0, 'call site missing: ' + txt);
    const floor = src.indexOf('MIN_MCAP_USD', i);
    assert.ok(floor > i && floor - i < 1500, 'call is not right before the mcap floor: ' + txt);
  }
  const nach = src.slice(src.indexOf(priceOnly), src.indexOf(priceOnly) + 300);
  assert.ok(/throw new Error\('price-only refused: ADS hand table/.test(nach), 'price-only no longer refuses a stale row');
});

console.log('ads-verhaeltnis-waechter: ' + ok + ' ok, ' + fail + ' fail');
if (fail) process.exit(1);

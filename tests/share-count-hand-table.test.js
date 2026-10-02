'use strict';
// Guard for the share-count hand table (Tag 1397, W2 2026-10-02).
//
// FINDING: Yahoo prices some USD lines with a wrong share count. On 2026-10-01 (run 36839128456):
// ABTC 8.48 x 121,819,713 = 1.03 bn (issuer: 72,819,713 after the 1-for-15 reverse split -> 0.62 bn),
// ANDG 54.40 x 18,540,410 Class A only = 1.01 bn (issuer: 112,887,382 Class A + B -> 6.14 bn),
// JBS flips between 1,070,910,8xx (right) and 3,289,363,7xx (17.09., 22.09.: 39.7 bn instead of 12.9 bn).
// lib/ads-hand-table.js applyShareCountTable() corrects only while the vendor value carries a known wrong
// count, confirms the right count untouched and leaves anything else as 'stale'. This guard runs the lib on
// synthetic snapshots in the real key shape, against the REAL configs/share-count-hand-table.json:
//   presence  - every row corrects its recorded wrong state to price x issuer count (delete a row -> red)
//   absence   - right count, rows not in the table: byte-identical; never double-corrected
//   drift     - a vendor count that is neither: Yahoo value kept, stale stamped, price-only refuses
//   break-once on test data: a lib copy without the drift check (full-line anchor) must turn the drift case red
// No wall clock: every date is a fixed string.
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Module, createRequire } = require('module');
const lib = require('../lib/ads-hand-table.js');
const { loadShareCountTable, applyShareCountTable, loadAdsHandTable, DERIVED_FIELDS, SHARES_PROVENANCE } = lib;

const LIB_FILE = path.join(__dirname, '..', 'lib', 'ads-hand-table.js');
const LIVE = ['lib/ads-hand-table.js', 'configs/share-count-hand-table.json', 'configs/ads-hand-table.json'];
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname, '..', f))).digest('hex');
const hashes = LIVE.map((f) => [f, sha(f)]);

let ok = 0, fail = 0, breaks = 0;
function pruefe(name, fn) {
  try { fn(); ok++; }
  catch (e) { fail++; console.error('FAIL ' + name + ': ' + (e && e.message)); }
}

const AS_OF = '2026-10-01T09:35:06.929Z';
const m = (value) => ({ value, source: 'yahoo_quoteSummary', confidence: 0.9, asOf: '2026-09-29T09:17:47.553Z' });
// Snapshot leg in the real key shape; mcap = price x the count the vendor used.
function leg({ ticker, px, vendorShares, mcap = px * vendorShares }) {
  return {
    identifier: { primary: 'ISIN', value: 'TICKER:' + ticker },
    meta: { ticker, exchangeName: 'NasdaqGS', tradingCurrency: 'USD', sharesOutstanding: vendorShares,
      impliedSharesOutstanding: vendorShares, asOf: AS_OF, priceCurrency: 'USD' },
    marketCap: { value: mcap, source: 'yahoo_quote', confidence: 0.9, asOf: AS_OF },
    metrics: { priceSales: m(5.1), enterpriseValue: m(1.2e9), enterpriseToRevenue: m(4.4),
      enterpriseToEbitda: m(-12.0), forwardPE: m(18.5), sbcRatio: null },
    price: { regularMarketPrice: px, currencyUnit: 'USD', currency: 'USD' },
    _pullMode: 'price-only',
  };
}
// Recorded wrong vendor states (stored snapshots / board-history) and the issuer count each row must land on.
const WRONG = {
  ABTC: { px: 8.48, vendorShares: 121819713, mcap: 1033031104, issuer: 72819713 },
  ANDG: { px: 54.4, vendorShares: 18540410, mcap: 1008598336, issuer: 112887382 },
  JBS: { px: 12.029999732971191, vendorShares: 3289363863, mcap: 39571046400, issuer: 1070929187 },
};
const TABLE = loadShareCountTable();
const unveraendert = (snap, ticker, table = TABLE) => {
  const vorher = JSON.stringify(snap);
  const r = applyShareCountTable(snap, ticker, snap.price.regularMarketPrice, table);
  assert.strictEqual(JSON.stringify(snap), vorher, `${ticker} changed (status ${r.status})`);
  return r;
};
const bleibtStale = (snap, ticker, apply = applyShareCountTable) => {
  const vorher = JSON.stringify(snap);
  const r = apply(snap, ticker, snap.price.regularMarketPrice, TABLE);
  assert.strictEqual(r.status, 'stale', `${ticker}: expected stale, got ${r.status}`);
  assert.ok(typeof snap.meta._shareCountHandTableStale === 'string' && snap.meta._shareCountHandTableStale, 'stale row not stamped');
  delete snap.meta._shareCountHandTableStale;
  assert.strictEqual(JSON.stringify(snap), vorher, `${ticker}: stale row changed more than the stamp`);
};

pruefe('presence: every recorded wrong state is corrected to price x issuer count', () => {
  for (const t of Object.keys(WRONG)) assert.ok(TABLE[t], `required table row ${t} missing`);
  for (const t of Object.keys(TABLE)) {
    const w = WRONG[t];
    assert.ok(w, `table row ${t} has no recorded wrong-state fixture in this guard`);
    assert.strictEqual(TABLE[t].shares, w.issuer, `${t}: issuer count changed without updating the guard`);
    const s = leg({ ticker: t, ...w });
    assert.strictEqual(applyShareCountTable(s, t, w.px, TABLE).status, 'corrected', t);
    assert.ok(Math.abs(s.marketCap.value / (w.px * w.issuer) - 1) < 1e-9, `${t} ${s.marketCap.value} vs ${w.px * w.issuer}`);
    assert.strictEqual(s.marketCap.source, SHARES_PROVENANCE);
    assert.strictEqual(s.marketCap.yahooValue, w.mcap);
    for (const f of DERIVED_FIELDS) assert.strictEqual(s.metrics[f], null, f + ' not blanked to null');
    assert.deepStrictEqual(s.metrics.forwardPE, m(18.5), 'a field not derived from marketCap was touched');
    assert.ok(!('_shareCountHandTableStale' in s.meta));
  }
});

pruefe('presence: ABTC lands below the daily pull floor of 800 m USD (leaves the universe), ANDG near 6.1 bn', () => {
  const a = leg({ ticker: 'ABTC', ...WRONG.ABTC }); applyShareCountTable(a, 'ABTC', 8.48, TABLE);
  assert.ok(a.marketCap.value < 8e8, String(a.marketCap.value));
  const n = leg({ ticker: 'ANDG', ...WRONG.ANDG }); applyShareCountTable(n, 'ANDG', 54.4, TABLE);
  assert.ok(Math.abs(n.marketCap.value / 6.141e9 - 1) < 0.001, String(n.marketCap.value));
});

pruefe('absence: JBS on a right day (1,070,910,861 vendor count) is confirmed and byte-identical', () => {
  assert.strictEqual(unveraendert(leg({ ticker: 'JBS', px: 11.29, vendorShares: 1070910861, mcap: 12090583040 }), 'JBS').status, 'confirmed');
});

pruefe('absence: rows not in the table stay byte-identical (PSEC, HSAI, Z98.DE)', () => {
  assert.strictEqual(unveraendert(leg({ ticker: 'PSEC', px: 2.08, vendorShares: 512746556, mcap: 1110339072 }), 'PSEC').status, 'no-row');
  assert.strictEqual(unveraendert(leg({ ticker: 'HSAI', px: 16.25, vendorShares: 1257137688 }), 'HSAI').status, 'no-row');
  assert.strictEqual(unveraendert(leg({ ticker: 'Z98.DE', px: 11.4, vendorShares: 3289363700 }), 'Z98.DE').status, 'no-row');
});

pruefe('absence: already corrected (price-only without a new Yahoo mcap) -> not corrected again', () => {
  const s = leg({ ticker: 'ABTC', ...WRONG.ABTC });
  applyShareCountTable(s, 'ABTC', 8.48, TABLE);
  assert.strictEqual(unveraendert(s, 'ABTC').status, 'already-corrected');
});

pruefe('drift: a vendor count that is neither the issuer count nor a known wrong one -> stale, Yahoo value kept', () => {
  bleibtStale(leg({ ticker: 'ABTC', px: 8.48, vendorShares: 130000000 }), 'ABTC');
  bleibtStale(leg({ ticker: 'JBS', px: 11.29, vendorShares: 2200000000 }), 'JBS');
  // A non-USD line: marketCap in USD, raw price in local currency -> implied count off by the FX factor.
  bleibtStale(leg({ ticker: 'ANDG', px: 54.4 * 5.3, vendorShares: 18540410, mcap: 1008598336 }), 'ANDG');
  const s = leg({ ticker: 'ABTC', ...WRONG.ABTC }); s.price.regularMarketPrice = null;
  bleibtStale(s, 'ABTC');
});

pruefe('3 % tolerance is pinned: wrong count x 1.02 corrects, x 1.04 stays', () => {
  const nah = leg({ ticker: 'ABTC', px: 8.48, vendorShares: 121819713 * 1.02 });
  assert.strictEqual(applyShareCountTable(nah, 'ABTC', 8.48, TABLE).status, 'corrected');
  bleibtStale(leg({ ticker: 'ABTC', px: 8.48, vendorShares: 121819713 * 1.04 }), 'ABTC');
});

pruefe('stale row: a Yahoo-sourced value loses the stamps of an earlier correction', () => {
  const s = leg({ ticker: 'ABTC', px: 8.48, vendorShares: 130000000 });
  Object.assign(s.marketCap, { yahooValue: 1033031104, vendorImpliedShares: 121819713 });
  assert.strictEqual(applyShareCountTable(s, 'ABTC', 8.48, TABLE).status, 'stale');
  assert.ok(!('yahooValue' in s.marketCap) && !('vendorImpliedShares' in s.marketCap), JSON.stringify(s.marketCap));
});

pruefe('the two tables are disjoint (a ticker in both would leave its share row unused)', () => {
  const ads = loadAdsHandTable();
  for (const t of Object.keys(TABLE)) assert.ok(!ads[t], `${t} is in both hand tables`);
});

pruefe('loader rejects malformed rows (fail loud, never silently off)', () => {
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'share-ht-')), 't.json');
  const good = { shares: 100, sharesAsOf: '2026-07-30', wrongShares: [200], source: { url: 'https://x.test/a', quote: 'q' }, verifiedAt: 'v' };
  const cases = [[{ shares: 100.5 }, /shares/], [{ wrongShares: [] }, /wrongShares/], [{ wrongShares: [105] }, /too close/],
    [{ sharesAsOf: '30.07.2026' }, /sharesAsOf/], [{ source: { url: 'https://x.test/a', quote: '' } }, /source/], [{ verifiedAt: '' }, /verifiedAt/]];
  for (const [patch, re] of cases) {
    fs.writeFileSync(tmp, JSON.stringify({ X: Object.assign({}, good, patch) }));
    assert.throws(() => loadShareCountTable(tmp), re, JSON.stringify(patch));
  }
  for (const root of ['[]', 'true', '42', 'null']) {
    fs.writeFileSync(tmp, root);
    assert.throws(() => loadShareCountTable(tmp), /root must be an object/, 'root ' + root + ' accepted');
  }
});

pruefe('wiring: the helper pull-yahoo.js calls at both marketCap sites applies the share table after the ADS table', () => {
  const py = require('../pull-yahoo.js');
  const s = leg({ ticker: 'ABTC', ...WRONG.ABTC });
  assert.strictEqual(py._applyAdsHandTable(s, 'ABTC', 8.48).status, 'corrected');
  assert.ok(Math.abs(s.marketCap.value - 8.48 * 72819713) < 1);
  // The price-only site refuses on 'stale' from either table (pinned verbatim in ads-verhaeltnis-waechter).
  assert.strictEqual(py._applyAdsHandTable(leg({ ticker: 'ABTC', px: 8.48, vendorShares: 130000000 }), 'ABTC', 8.48).status, 'stale');
  assert.strictEqual(py._applyAdsHandTable(leg({ ticker: 'HSAI', px: 16.25, vendorShares: 1257137688 }), 'HSAI', 16.25).status, 'corrected');
});

pruefe('break-once on test data: a lib copy without the drift check turns the drift case red', () => {
  const anchor = '  if (!row.wrongShares.some((w) => near(implied, w))) {';
  const lines = fs.readFileSync(LIB_FILE, 'utf8').split(/\r?\n/);
  assert.strictEqual(lines.filter((l) => l === anchor).length, 1, 'exact whole-line mutation anchor');
  const mod = new Module(LIB_FILE, module);
  mod.filename = LIB_FILE; mod.paths = module.paths; mod.require = createRequire(LIB_FILE);
  mod._compile(lines.map((l) => (l === anchor ? '  if (false) {' : l)).join('\n'), LIB_FILE);
  const broken = mod.exports.applyShareCountTable;
  assert.throws(() => bleibtStale(leg({ ticker: 'ABTC', px: 8.48, vendorShares: 130000000 }), 'ABTC', broken), assert.AssertionError);
  breaks++;
});

for (const [f, before] of hashes) {
  pruefe('live file unchanged: ' + f, () => assert.strictEqual(sha(f), before));
}
console.log(`share-count-hand-table: ${ok} ok, ${fail} fail, ${breaks} break-once fired`);
if (fail || breaks !== 1) process.exit(1);

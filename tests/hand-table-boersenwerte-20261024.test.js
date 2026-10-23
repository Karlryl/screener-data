'use strict';
// Guard for the market-cap entries of 2026-10-24 (numbers-trust audit of the 23.10. boards).
//
// FINDING (snapshots of run 39918190374, data day 2026-10-23): five board lines showed a wrong market cap.
//   8035.T  Tokyo Electron  27.3 bn USD: Yahoo multiplies the post-split price by the pre-split count (1:5 on 2026-10-01)
//   285A.T  Kioxia          43.3 bn USD: same, 1:3 split on 2026-10-01
//   LISN.SW Lindt          114.3 bn USD: registered shares and participation certificates counted 1:1 at the registered price
//   1WAF.MI Siltronic        3.1 bn USD: three-week-old Milan price (home listing WAF.DE: 2.2 bn USD)
//   ARX.TO  ARC Resources   13.7 bn USD: delisted on 2026-09-04 after the Shell takeover
// configs/share-count-hand-table.json now corrects the first three (withholdUnverified rows) and withholds
// 1WAF.MI, ARX.TO and the two Lindt buyback lines LISNE.SW / LISPE.SW (_holds). This guard runs the REAL
// lib/market-cap-guard.js on synthetic snapshots in the real key shape (values copied from the stored snapshots):
//   presence - each corrected row lands on price x issuer count with its German reason; each hold is empty with reason
//   absence  - once Yahoo uses the issuer count, the row is confirmed and the vendor value stays
//   refusal  - a vendor count that matches neither the issuer count nor the recorded wrong count is not corrected
// Break-once on test data only: `node tests/hand-table-boersenwerte-20261024.test.js --prove-red` feeds the refusal
// fixture to the presence check and must exit 1. No wall clock; live files are hashed before and after.
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const guard = require('../lib/market-cap-guard.js');

const LIVE = ['configs/share-count-hand-table.json', 'lib/market-cap-guard.js', 'lib/ads-hand-table.js'];
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname, '..', f))).digest('hex');
const hashes = LIVE.map((f) => [f, sha(f)]);

let ok = 0, fail = 0;
function pruefe(name, fn) {
  try { fn(); ok++; } catch (e) { fail++; console.error('FAIL ' + name + ': ' + (e && e.message)); }
}

const AS_OF = '2026-10-23T08:10:23.224Z';
// Converted non-USD snapshot as the pull stores it: USD price and USD marketCap, trading FX stamped.
function snap({ ticker, ccy, fx, px, mcap, withPrice = true }) {
  return {
    meta: { ticker, tradingCurrency: ccy, tradingCurrencyOriginal: ccy, reportingCurrency: 'USD',
      reportingCurrencyOriginal: ccy, fxConverted: true, tradingFxRateApplied: fx, fxRateApplied: fx,
      priceCurrency: withPrice ? 'USD' : undefined, asOf: AS_OF },
    marketCap: { value: mcap, source: 'yahoo_quote', confidence: 0.9, asOf: AS_OF },
    metrics: { priceSales: 10.02, enterpriseValue: 1e11, enterpriseToRevenue: 9.85, enterpriseToEbitda: 30, forwardPE: 8.78 },
    ...(withPrice ? { price: { regularMarketPrice: px, currencyUnit: 'USD', currency: ccy } } : {}),
  };
}
const CORRECTED = {
  '8035.T': { ccy: 'JPY', fx: 0.00636748, px: 60.22362584, mcap: 27339565394.16052, shares: 2280791810 },
  '285A.T': { ccy: 'JPY', fx: 0.00636748, px: 81.2172074, mcap: 43259141448.56342, shares: 1644045264 },
  'LISN.SW': { ccy: 'CHF', fx: 1.2151407, px: 105231.18462, mcap: 114301055775.69977, shares: 229956 },
};
const HELD = {
  'LISNE.SW': { ccy: 'CHF', fx: 1.2151407, px: 104623.61427, mcap: 113459289044.96088 },
  'LISPE.SW': { ccy: 'CHF', fx: 1.2151407, px: 10195.030473, mcap: 111182869576.96942 },
  '1WAF.MI': { ccy: 'EUR', fx: 1.1199462, px: 93.17952384, mcap: 3074924286.72 },
  'ARX.TO': { ccy: 'CAD', fx: 0.7137249, px: null, mcap: 13695515225.44128, withPrice: false },
};
// Refusal fixture: an 8035.T vendor value implying 1,000,000,000 shares (neither count of the row).
const MISMATCH = { ccy: 'JPY', fx: 0.00636748, px: 60.22362584, mcap: 60.22362584 * 1e9, shares: 2280791810 };

function expectCorrected(t, w) {
  const out = guard.prepareMarketCap(snap({ ticker: t, ...w }));
  assert.strictEqual(out.marketCap.source, 'hand-table:shares', `${t}: not corrected (source ${out.marketCap.source}, value ${out.marketCap.value})`);
  assert.ok(Math.abs(out.marketCap.value / (w.px * w.shares) - 1) < 1e-9, `${t}: ${out.marketCap.value} vs ${w.px * w.shares}`);
  assert.strictEqual(out.marketCap.yahooValue, w.mcap, `${t}: vendor value not kept as yahooValue`);
  assert.strictEqual(out.meta.marketCapReason, guard.table[t].reason, `${t}: German reason missing`);
  for (const f of ['priceSales', 'enterpriseValue', 'enterpriseToRevenue', 'enterpriseToEbitda']) assert.strictEqual(out.metrics[f], null, `${t}: ${f} not blanked`);
  assert.strictEqual(out.metrics.forwardPE, 8.78, `${t}: unrelated metric touched`);
  return out;
}

if (process.argv.includes('--prove-red')) {
  expectCorrected('8035.T', MISMATCH); // must throw: the guard refuses a count it has not recorded
  console.log('hand-table-boersenwerte-20261024: --prove-red did NOT fire');
  process.exit(0);
}

pruefe('table: the five cases and the two Lindt buyback lines are registered, nothing else new', () => {
  for (const t of Object.keys(CORRECTED)) {
    const row = guard.table[t];
    assert.ok(row && row.withholdUnverified === true, `${t}: strict row missing`);
    assert.strictEqual(row.shares, CORRECTED[t].shares, `${t}: issuer count changed without updating the guard`);
    assert.ok(/^https:\/\//.test(row.source.url) && row.source.quote.trim(), `${t}: source`);
  }
  for (const t of Object.keys(HELD)) assert.ok(guard.holds[t] && guard.holds[t].reason && guard.holds[t].source.quote, `${t}: hold missing`);
  assert.deepStrictEqual(Object.keys(guard.holds).sort(), ['1WAF.MI', 'ARX.TO', 'ISBTR.IS', 'LISNE.SW', 'LISPE.SW']);
});

pruefe('presence: 8035.T, 285A.T and LISN.SW land on price x issuer count with reason', () => {
  const v = {};
  for (const [t, w] of Object.entries(CORRECTED)) v[t] = expectCorrected(t, w).marketCap.value;
  // Plausibility against the audit expectation (not copied into the table): TEL and Kioxia above 130 bn, Lindt near 24 bn.
  assert.ok(v['8035.T'] > 130e9 && v['8035.T'] < 145e9, String(v['8035.T']));
  assert.ok(v['285A.T'] > 130e9 && v['285A.T'] < 140e9, String(v['285A.T']));
  assert.ok(v['LISN.SW'] > 23e9 && v['LISN.SW'] < 25e9, String(v['LISN.SW']));
});

pruefe('presence: LISNE.SW, LISPE.SW, 1WAF.MI and ARX.TO are withheld (empty field, presence marker, German reason)', () => {
  for (const [t, w] of Object.entries(HELD)) {
    const out = guard.prepareMarketCap(snap({ ticker: t, ...w }));
    assert.strictEqual(out.marketCap.value, null, `${t}: value shown`);
    assert.strictEqual(out.marketCap.missing, true, `${t}: presence marker missing`);
    assert.strictEqual(out.marketCap.source, 'hand-table:market-cap-hold');
    assert.strictEqual(out.marketCap.yahooValue, w.mcap);
    assert.ok(out.meta.marketCapReason.startsWith('Börsenwert nicht verlässlich: ' + guard.holds[t].reason), `${t}: reason`);
    assert.ok(!/ - | – | — /.test(guard.holds[t].reason), `${t}: dash in reason`);
  }
});

pruefe('absence: once Yahoo uses the issuer count, the row confirms and keeps the vendor value', () => {
  for (const [t, w] of Object.entries(CORRECTED)) {
    const right = w.px * w.shares * 1.004;
    const out = guard.prepareMarketCap(snap({ ticker: t, ...w, mcap: right }));
    assert.strictEqual(out.marketCap.value, right, `${t}: confirmed value changed`);
    assert.strictEqual(out.marketCap.source, 'yahoo_quote');
    assert.ok(!out.meta.marketCapReason, `${t}: reason on a confirmed value`);
  }
});

pruefe('absence: a data day before validFrom leaves the snapshot untouched', () => {
  const s = snap({ ticker: '8035.T', ...CORRECTED['8035.T'] });
  s.marketCap.asOf = s.meta.asOf = '2026-09-29T08:00:00.000Z';
  assert.strictEqual(guard.prepareMarketCap(s).marketCap.value, CORRECTED['8035.T'].mcap);
});

pruefe('refusal: a vendor count matching neither recorded count is withheld, never corrected', () => {
  assert.throws(() => expectCorrected('8035.T', MISMATCH), /not corrected/);
  const out = guard.prepareMarketCap(snap({ ticker: '8035.T', ...MISMATCH }));
  assert.strictEqual(out.marketCap.value, null);
  assert.strictEqual(out.marketCap.source, 'hand-table:market-cap-hold');
});

for (const [f, h] of hashes) if (sha(f) !== h) { fail++; console.error('FAIL live file changed: ' + f); }
console.log(`hand-table-boersenwerte-20261024: ${ok} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);

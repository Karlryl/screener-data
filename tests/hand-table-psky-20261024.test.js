'use strict';
// Guard for Paramount Skydance / Skydance Corporation (numbers-trust audit of the 23.10. boards, entered 2026-10-24).
//
// FINDING (snapshots of run 39918190374, data day 2026-10-23): software-comm-services profitable showed the
// same firm twice, PSKY rank 313 (10.99 bn USD) and SKYD rank 314 (39.28 bn USD), both 45.4. Form 8-K of
// 2026-10-06 (CIK 2041610): the Class B listing moved from Nasdaq to the NYSE and the ticker changed from PSKY
// to SKYD. PSKY is a stale leg, SKYD the home listing.
//   configs/dup-issuer-shadow-table.json  row skydance: PSKY loses its rank (dupIssuer) while SKYD stands in the ranking
//   SKYD keeps the vendor value: 1,093,020,754 Class B (424B5, 2026-10-02) + 3,917,657,246 PIPE Class B (8-K item 3.02)
//   + 31,500,087 Class A (10-Q cover, 2026-07-31) = 5,042,178,087 shares x 7.79 USD = 39,278,567,298 USD.
// This guard runs the REAL lib/dup-issuer-shadow-table.js and lib/market-cap-guard.js on synthetic data in the real shape:
//   presence - PSKY gets rankGrund dupIssuer next to SKYD and the dupIssuer marker pointing to SKYD
//   absence  - SKYD keeps its rank and its vendor market cap (no share-count row, no hold); PSKY alone keeps its rank
// Open (method question, not decided here): a _holds entry for PSKY would make the export drop every PSKY row
// without a snapshot, which the generic tests dup-issuer-rank and dup-issuer-shadow-export do not allow for a table ticker.
// Break-once on test data only: `node tests/hand-table-psky-20261024.test.js --prove-red` feeds a ranking without SKYD
// to the presence check and must exit 1. No wall clock; live files are hashed before and after.
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const dup = require('../lib/dup-issuer-shadow-table.js');
const guard = require('../lib/market-cap-guard.js');

const LIVE = ['configs/dup-issuer-shadow-table.json', 'configs/share-count-hand-table.json', 'lib/market-cap-guard.js', 'lib/dup-issuer-shadow-table.js'];
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname, '..', f))).digest('hex');
const hashes = LIVE.map((f) => [f, sha(f)]);

let ok = 0, fail = 0;
function pruefe(name, fn) {
  try { fn(); ok++; } catch (e) { fail++; console.error('FAIL ' + name + ': ' + (e && e.message)); }
}

const table = dup.loadDupIssuerShadowTable();
const home = dup.homeListingIndex(table);
const AS_OF = '2026-10-23T08:12:46.554Z';
// USD snapshots as stored in run 39918190374 (values copied from the PSKY and SKYD snapshots).
function snap(ticker, px, mcap, asOf = AS_OF) {
  return {
    meta: { ticker, tradingCurrency: 'USD', tradingCurrencyOriginal: 'USD', reportingCurrency: 'USD', reportingCurrencyOriginal: 'USD',
      fxConverted: true, tradingFxRateApplied: 1, fxRateApplied: 1, priceCurrency: 'USD', asOf },
    marketCap: { value: mcap, source: 'yahoo_quote', confidence: 0.9, asOf },
    metrics: { priceSales: 0.38, enterpriseValue: 5e10, forwardPE: 9.1 },
    price: { regularMarketPrice: px, currencyUnit: 'USD', currency: 'USD' },
  };
}
const SKYD = { px: 7.79, mcap: 39278567424 };
const SKYD_SHARES = 1093020754 + 3917657246 + 31500087;

function expectPskyLosesRank(ranking) {
  assert.strictEqual(dup.dupIssuerRankGrund('PSKY', home, ranking), 'dupIssuer', 'PSKY keeps a rank next to ' + [...ranking].join(','));
}

if (process.argv.includes('--prove-red')) {
  expectPskyLosesRank(new Set(['PSKY', 'TMV.DE'])); // must throw: without SKYD in the ranking PSKY keeps its rank
  console.log('hand-table-psky-20261024: --prove-red did NOT fire');
  process.exit(0);
}

pruefe('table: skydance row with SKYD as home listing and a sourced quote', () => {
  const row = table.skydance;
  assert.ok(row, 'skydance row missing');
  assert.deepStrictEqual([row.tickers, row.codeKeeps, row.homeListingProposal], [['SKYD', 'PSKY'], 'SKYD', 'SKYD']);
  assert.ok(row.source.url.startsWith('https://www.sec.gov/Archives/edgar/data/2041610/'), row.source.url);
  assert.ok(row.source.quote.includes('PSKY') && row.source.quote.includes('SKYD'), row.source.quote);
  assert.strictEqual(home.get('PSKY'), 'SKYD');
  assert.ok(!home.has('SKYD'), 'SKYD must not point anywhere');
});

pruefe('presence: PSKY loses its rank while SKYD stands in the same ranking', () => {
  expectPskyLosesRank(new Set(['PSKY', 'SKYD', 'TMV.DE']));
  const index = dup.secondaryIndex(table);
  assert.deepStrictEqual(dup.applyDupIssuerShadow({ ticker: 'PSKY' }, index).dupIssuer,
    { of: 'SKYD', issuer: 'Skydance Corporation', basis: 'hand-table:dup-issuer-shadow' });
});

pruefe('absence: SKYD keeps its rank; PSKY alone keeps its rank', () => {
  assert.strictEqual(dup.dupIssuerRankGrund('SKYD', home, new Set(['PSKY', 'SKYD'])), null);
  assert.strictEqual(dup.dupIssuerRankGrund('PSKY', home, new Set(['PSKY', 'TMV.DE'])), null);
  assert.ok(!dup.applyDupIssuerShadow({ ticker: 'SKYD' }, dup.secondaryIndex(table)).dupIssuer, 'SKYD marked');
});

pruefe('absence: SKYD keeps the vendor market cap, which matches price x the filed share count', () => {
  assert.ok(!guard.table.SKYD && !guard.holds.SKYD, 'SKYD must have no market-cap row');
  assert.ok(!guard.table.PSKY && !guard.holds.PSKY, 'PSKY market-cap row added without updating this guard and the generic dup tests');
  const s = snap('SKYD', SKYD.px, SKYD.mcap);
  assert.strictEqual(guard.prepareMarketCap(s), s, 'SKYD snapshot copied or changed');
  assert.strictEqual(SKYD_SHARES, 5042178087);
  assert.ok(Math.abs(SKYD.mcap / (SKYD.px * SKYD_SHARES) - 1) < 0.001, String(SKYD.px * SKYD_SHARES));
});

pruefe('refusal: the break-once fixture really fails the presence check', () => {
  assert.throws(() => expectPskyLosesRank(new Set(['PSKY', 'TMV.DE'])), /keeps a rank/);
});

for (const [f, h] of hashes) if (sha(f) !== h) { fail++; console.error('FAIL live file changed: ' + f); }
console.log(`hand-table-psky-20261024: ${ok} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);

'use strict';
/**
 * BH-w2-enricher: hermetic regression checks for scripts/enrich-q-revenue.js
 * (batch w2-enricher). Covers BH-017 (YTD-fact leaking into the discrete-Q4
 * quarterly extractor via the fp shortcut) and BH-018 (hardcoded dead
 * Windows ZIP_PATH made configurable via SEC_COMPANYFACTS_ZIP). No network,
 * no frameworks.
 *
 * Usage:  node tests/scoring/bh-w2-enricher.test.js   (Exit 0/1)
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');

let pass = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); }
}

const { isQuarterlyPoint, extractQuarterlyPoints } = require('../../scripts/enrich-q-revenue.js');

// ─── BH-017: fp label alone must not admit a YTD fact as a discrete quarter ───
async function testBH017() {
  await test('BH-017: fp=Q2 with a ~181d (6M-YTD) span is rejected, not admitted as a quarter', () => {
    const sixMonthYtd = { fp: 'Q2', form: '10-Q', start: '2024-01-01', end: '2024-06-30', val: 500 };
    assert.equal(isQuarterlyPoint(sixMonthYtd), false, '6M-YTD tagged fp=Q2 must fail the quarterly gate');
  });

  await test('BH-017: fp=Q3 with a ~272d (9M-YTD) span is rejected, not admitted as a quarter', () => {
    const nineMonthYtd = { fp: 'Q3', form: '10-Q', start: '2024-01-01', end: '2024-09-30', val: 800 };
    assert.equal(isQuarterlyPoint(nineMonthYtd), false, '9M-YTD tagged fp=Q3 must fail the quarterly gate');
  });

  await test('BH-017: a real ~91d discrete quarter (fp=Q1) still passes', () => {
    const discreteQ1 = { fp: 'Q1', form: '10-Q', start: '2024-01-01', end: '2024-03-31', val: 200 };
    assert.equal(isQuarterlyPoint(discreteQ1), true, 'a genuine ~91d quarter must still pass');
  });

  await test('BH-017: end-to-end — a mislabeled 6M-YTD fact no longer corrupts the point series', () => {
    const unitArr = [
      { fp: 'Q1', form: '10-Q', start: '2024-01-01', end: '2024-03-31', val: 200, accn: 'A1' },
      // mislabeled fp=Q2 but actually a 6M cumulative fact (181 days) — must be dropped, not
      // kept as if it were the discrete Q2 (which would corrupt the YoY series with a YTD value).
      { fp: 'Q2', form: '10-Q', start: '2024-01-01', end: '2024-06-30', val: 500, accn: 'A2' },
      { fp: 'Q3', form: '10-Q', start: '2024-07-01', end: '2024-09-30', val: 250, accn: 'A3' },
    ];
    const pts = extractQuarterlyPoints(unitArr);
    const ends = pts.map((p) => p.end);
    assert.ok(!ends.includes('2024-06-30'), 'the mislabeled 6M-YTD point must not appear in the quarterly series');
    assert.deepEqual(ends, ['2024-03-31', '2024-09-30'], 'only the genuine discrete quarters remain');
  });
}

// ─── BH-018: ZIP_PATH must be overridable via SEC_COMPANYFACTS_ZIP, not hardcoded ───
// Mocks discovery/sec-tickers.js (no network) and fs.openSync (no real file access) to
// observe which path main() actually tries to open, without touching disk or SEC.
async function testBH018() {
  await test('BH-018: main() opens SEC_COMPANYFACTS_ZIP when set, not the hardcoded default', async () => {
    const scratchZip = 'Z:/scratch-does-not-exist/companyfacts.zip';
    const enrichPath = require.resolve('../../scripts/enrich-q-revenue.js');
    const secTickersPath = require.resolve('../../discovery/sec-tickers.js');
    const savedEnv = process.env.SEC_COMPANYFACTS_ZIP;
    const savedSecTickersModule = require.cache[secTickersPath];
    const originalOpenSync = fs.openSync;
    let capturedPath = null;

    process.env.SEC_COMPANYFACTS_ZIP = scratchZip;
    delete require.cache[enrichPath]; // force ZIP_PATH to re-read the env var
    require.cache[secTickersPath] = {
      id: secTickersPath, filename: secTickersPath, loaded: true,
      exports: { fetchSecTickers: async () => new Map() }, // empty map -> no per-ticker work, no network
    };
    fs.openSync = (p) => { capturedPath = p; throw Object.assign(new Error('__TEST_STOP__'), { code: 'ETESTSTOP' }); };

    try {
      const enrich = require(enrichPath);
      await enrich.main().catch(() => {}); // openSync throw rejects the .then() chain; swallow it
    } finally {
      fs.openSync = originalOpenSync;
      if (savedSecTickersModule) require.cache[secTickersPath] = savedSecTickersModule;
      else delete require.cache[secTickersPath];
      if (savedEnv === undefined) delete process.env.SEC_COMPANYFACTS_ZIP;
      else process.env.SEC_COMPANYFACTS_ZIP = savedEnv;
      delete require.cache[enrichPath];
    }
    assert.equal(capturedPath, scratchZip, 'fs.openSync must receive the SEC_COMPANYFACTS_ZIP override, not the hardcoded default');
  });
}

(async () => {
  await testBH017();
  await testBH018();
  console.log(`\nbh-w2-enricher.test.js: ${pass} ok, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();

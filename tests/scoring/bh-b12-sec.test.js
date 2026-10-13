'use strict';
/**
 * BH-b12-sec: hermetic regression checks for the SEC-XBRL pull/merge/build
 * trio (batch b12-sec — pull-sec-xbrl.js, merge-sec-xbrl.js,
 * scripts/build-secannual.js). Covers findings BH-005, BH-007, BH-009,
 * BH-010 (BH-006 and BH-197 need no test: decision-skip resp. trivial doc
 * one-liner). No network, no frameworks.
 *
 * Usage:  node tests/scoring/bh-b12-sec.test.js   (Exit 0/1)
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

let pass = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); }
}

// ─── BH-007: merge-sec-xbrl.js buildAnnual() — the Assets/CurrLiab/OpInc trio ──
// must only be paired for a fy when the balance-sheet fact actually shares the
// OpInc fact's accn (filing identity), not just the fiscal year.
const { buildAnnual } = require('../../merge-sec-xbrl.js');

function gaapFixture(rows) {
  const gaap = {};
  for (const [concept, facts] of Object.entries(rows)) {
    gaap[concept] = { units: { USD: facts.map((f) => Object.assign({ form: '10-K', fp: 'FY' }, f)) } };
  }
  return gaap;
}

async function testBH007() {
  await test('BH-007: OpInc/Assets accn mismatch -> Assets cell nulled, matching CurrLiab kept', async () => {
    const gaap = gaapFixture({
      OperatingIncomeLoss: [{ fy: 2024, val: 100, end: '2024-12-31', accn: 'ACCN-A' }],
      Assets: [{ fy: 2024, val: 1000, end: '2024-12-31', accn: 'ACCN-B' }],          // different filing than OpInc
      LiabilitiesCurrent: [{ fy: 2024, val: 300, end: '2024-12-31', accn: 'ACCN-A' }], // same filing as OpInc
    });
    const annual = buildAnnual(gaap);
    assert.equal(annual.annualAssets[0].value, null, 'Assets from a different accn than OpInc must be nulled');
    assert.equal(annual.annualCurrentLiabilities[0].value, 300, 'CurrLiab sharing the OpInc accn is kept');
  });

  await test('BH-007: matching accn across the whole trio -> both balance cells kept', async () => {
    const gaap = gaapFixture({
      OperatingIncomeLoss: [{ fy: 2024, val: 100, end: '2024-12-31', accn: 'ACCN-X' }],
      Assets: [{ fy: 2024, val: 1000, end: '2024-12-31', accn: 'ACCN-X' }],
      LiabilitiesCurrent: [{ fy: 2024, val: 300, end: '2024-12-31', accn: 'ACCN-X' }],
    });
    const annual = buildAnnual(gaap);
    assert.equal(annual.annualAssets[0].value, 1000);
    assert.equal(annual.annualCurrentLiabilities[0].value, 300);
  });

  await test('BH-007: accn absent everywhere (legacy/trimmed fixtures) -> unaffected, cells kept', async () => {
    // Guards the real sec-micron.json fixture (no accn field at all) from regressing.
    const gaap = gaapFixture({
      OperatingIncomeLoss: [{ fy: 2024, val: 100, end: '2024-12-31' }],
      Assets: [{ fy: 2024, val: 1000, end: '2024-12-31' }],
      LiabilitiesCurrent: [{ fy: 2024, val: 300, end: '2024-12-31' }],
    });
    const annual = buildAnnual(gaap);
    assert.equal(annual.annualAssets[0].value, 1000);
    assert.equal(annual.annualCurrentLiabilities[0].value, 300);
  });
}

// ─── BH-009 / BH-010: scripts/build-secannual.js pure helpers ─────────────────
const { bilanzGuardOk, chooseCacheSource, newestPresent } = require('../../scripts/build-secannual.js');

async function testBH009() {
  await test('BH-009: fully-missing CurrLiab (newestPresent=null) rejected, not treated as >=0', async () => {
    assert.equal(bilanzGuardOk(1000, null), false, 'missing CurrLiab must fail the guard');
    assert.equal(bilanzGuardOk(null, 300), false, 'missing Assets must fail the guard');
    assert.equal(bilanzGuardOk(1000, 300), true, 'present, valid pair passes');
    assert.equal(bilanzGuardOk(1000, -5), false, 'negative CurrLiab still fails');
  });
  await test('BH-009: newestPresent still returns null on all-null / empty series (sanity)', async () => {
    assert.equal(newestPresent([{ value: null }, { value: null }]), null);
    assert.equal(newestPresent([]), null);
  });
}

async function testBH010() {
  await test('BH-010: newer tmpFile (explicit SEC_XBRL_CACHE_DIR pull) wins over an older repoCache', async () => {
    assert.equal(chooseCacheSource(true, true, /* repoMtime */ 1000, /* tmpMtime */ 2000), 'tmp');
  });
  await test('BH-010: older tmpFile loses to a newer repoCache', async () => {
    assert.equal(chooseCacheSource(true, true, 2000, 1000), 'repo');
  });
  await test('BH-010: only one cache present -> that one is used; neither -> null (pull from network)', async () => {
    assert.equal(chooseCacheSource(false, true, 0, 5), 'tmp');
    assert.equal(chooseCacheSource(true, false, 5, 0), 'repo');
    assert.equal(chooseCacheSource(false, false, 0, 0), null);
  });
}

// ─── BH-005: pull-sec-xbrl.js main() must record aborted=true AND exit non-zero
// on the errors>50 abort path (previously fell through to a silent exit 0). ───
// Mocks https.get (SEC ticker list + companyfacts) and points SEC_XBRL_CACHE_DIR
// at a scratch dir so the run is fully hermetic; overrides the global setTimeout
// so the per-ticker rate-limit sleep doesn't slow the test down.
async function testBH005() {
  const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bh005-sec-xbrl-'));
  process.env.SEC_XBRL_CACHE_DIR = scratchDir;
  const pullSecXbrl = require('../../pull-sec-xbrl.js'); // reads SEC_XBRL_CACHE_DIR at module load

  const https = require('node:https');
  const originalGet = https.get;
  const originalSetTimeout = global.setTimeout;
  const originalExit = process.exit;
  global.setTimeout = (fn, _ms, ...args) => originalSetTimeout(fn, 0, ...args);

  const TICKERS_URL = 'https://www.sec.gov/files/company_tickers.json';
  const N = 55; // > errors>50 abort threshold, so the abort fires before exhausting the list
  const tickersBody = JSON.stringify(Object.fromEntries(
    Array.from({ length: N }, (_, i) => [String(i), { cik_str: 1000000 + i, ticker: 'T' + String(i).padStart(3, '0'), title: 'Test Co ' + i }])
  ));
  function fakeRes(statusCode, body) {
    const handlers = {};
    return {
      statusCode, headers: {},
      on(ev, fn) { (handlers[ev] = handlers[ev] || []).push(fn); },
      resume() {},
      _emit(ev, arg) { (handlers[ev] || []).forEach((fn) => fn(arg)); },
      _body: body,
    };
  }
  https.get = (url, _opts, cb) => {
    if (url === TICKERS_URL) {
      const res = fakeRes(200, tickersBody);
      cb(res);
      res._emit('data', Buffer.from(tickersBody));
      res._emit('end');
    } else {
      cb(fakeRes(500)); // every companyfacts CIK pull fails -> drives errors past the abort threshold
    }
    return { on() {}, setTimeout() {}, destroy() {} };
  };

  let exitCode = null;
  process.exit = (code) => { exitCode = code; throw new Error('__TEST_PROCESS_EXIT__'); };

  try {
    try {
      await pullSecXbrl.main();
      throw new Error('main() must process.exit(1) on abort, but returned normally');
    } catch (e) {
      if (e.message !== '__TEST_PROCESS_EXIT__') throw e;
    }
    assert.equal(exitCode, 1, 'main() must process.exit(1) when the >50-errors abort triggers');
    const manifest = JSON.parse(fs.readFileSync(path.join(scratchDir, '_manifest.json'), 'utf8'));
    assert.equal(manifest.summary.aborted, true, 'manifest.summary.aborted must be true after the abort');
    assert.ok(manifest.summary.errors > 50, 'errors must exceed the abort threshold');
  } finally {
    https.get = originalGet;
    global.setTimeout = originalSetTimeout;
    process.exit = originalExit;
    fs.rmSync(scratchDir, { recursive: true, force: true });
  }
}

(async () => {
  await testBH007();
  await testBH009();
  await testBH010();
  await test('BH-005: errors>50 abort sets manifest.summary.aborted and exits non-zero', testBH005);
  console.log(`\nbh-b12-sec.test.js: ${pass} ok, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();

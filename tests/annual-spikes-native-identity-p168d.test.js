'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const Module = require('node:module');
const W = require('../scripts/watch-annual-spikes.js');
const B = require('../data-health/annual-spikes-baseline.json');
const F = require('../lib/financial-known-cases.js');

function finding(period, fx = 1) {
  return { ticker: 'KNOWN', reihe: 'annualRev', index: 1,
    links: 100e6 * fx, wert: 1000e6 * fx, rechts: 110e6 * fx,
    nativ: { periode: period, waehrung: 'EUR', werte: [100e6, 1000e6, 110e6] } };
}
function baseline(x) {
  const key = W.stabilerSchluessel(x);
  return { faelle: [key], nativeIdentitaeten: [{ ...x, schluessel: key }] };
}
function known(w, x, b) {
  const keys = new Set(b.faelle), native = b.nativeIdentitaeten;
  return w.istBekannt(x, keys, w.fundeJeReihe([x], keys, native), native);
}
function transition(w, oldPeriod, newPeriod) {
  const old = finding(oldPeriod), current = finding(newPeriod, 1.03), b = baseline(old);
  assert.notEqual(W.stabilerSchluessel(old), W.stabilerSchluessel(current));
  assert.equal(known(w, current, b), true, `${oldPeriod} -> ${newPeriod} survives USD drift`);
  assert.equal(w.fundeJeReihe([current], new Set(b.faelle), b.nativeIdentitaeten).size, 0);
  assert.deepEqual(w.sperrenOhneWirkung([{ sperrschluessel: 'KNOWN|annualRev|1' }],
    [current], new Set(b.faelle), b.nativeIdentitaeten), ['KNOWN|annualRev|1']);
}

test('P168d: native comparison survives both period transitions with drifted USD', () => {
  transition(W, null, '2024-12-31');
  transition(W, '2024-12-31', null);
  for (const [oldPeriod, newPeriod] of [[null, '2024-12-31'], ['2024-12-31', null]]) {
    const b = baseline(finding(oldPeriod));
    for (let i = 0; i < 3; i++) {
      const x = finding(newPeriod); x.nativ.werte[i] += 1;
      assert.equal(W.stabilerSchluessel(x), b.faelle[0]);
      assert.equal(known(W, x, b), false, `changed native value ${i} cannot use identical USD`);
    }
    const currency = finding(newPeriod); currency.nativ.waehrung = 'GBP';
    assert.equal(known(W, currency, b), false);
    const noise = finding(newPeriod, 1.03); noise.nativ.werte[0] += 0.001;
    assert.equal(known(W, noise, b), true, 'ten-significant-digit arithmetic noise still matches');
  }
  for (const fx of [1, 1.03]) assert.equal(known(W, finding('2023-12-31', fx), baseline(finding('2024-12-31'))), false);
  assert.equal(known(W, finding(null, 1.03), baseline(finding('2024-02-30'))), false);
  assert.equal(known(W, finding('2024-02-30', 1.03), baseline(finding(null))), false);
});

test('P168d: break-once removes only period-insensitive recognition and both transitions turn red', () => {
  const root = path.resolve(__dirname, '..');
  const live = path.join(root, 'scripts/watch-annual-spikes.js');
  const liveFiles = [live, path.join(root, 'data-health/annual-spikes-baseline.json'),
    path.join(root, 'configs/financial-known-cases.json')];
  const hashes = () => liveFiles.map(f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex'));
  const before = hashes();
  const lines = fs.readFileSync(live, 'utf8').split(/\r?\n/);
  const anchor = '  if (key && nativeFaelle.some(a => nativerSchluessel(a)';
  assert.equal(lines.filter(line => line === anchor).length, 1, 'one complete-line anchor');
  const tempRoot = fs.realpathSync(os.tmpdir());
  const temp = fs.mkdtempSync(path.join(tempRoot, 'annual-spikes-p168d-'));
  const target = path.resolve(temp, 'mutant.js');
  assert.notEqual(target, live);
  assert.ok(target.startsWith(tempRoot + path.sep));
  lines[lines.indexOf(anchor)] = '  if (false && nativeFaelle.some(a => nativerSchluessel(a)';
  fs.writeFileSync(target, lines.join('\n'));
  try {
    const copy = new Module(target, module);
    copy.filename = target; copy.require = Module.createRequire(live);
    copy._compile(fs.readFileSync(target, 'utf8'), target);
    for (const [oldPeriod, newPeriod] of [[null, '2024-12-31'], ['2024-12-31', null]]) {
      assert.throws(() => transition(copy.exports, oldPeriod, newPeriod), error => {
        assert.equal(error.name, 'AssertionError');
        console.log('BREAK-ONCE RED P168d: ' + error.message);
        return true;
      });
    }
  } finally {
    assert.deepEqual(hashes(), before, 'live watcher, baseline and hand table remain unchanged');
    assert.ok(path.resolve(temp).startsWith(tempRoot + path.sep));
    fs.rmSync(temp, { recursive: true });
  }
});

const genuine = [
  ['AHG', 'annualOpInc', '2025-03-31', 'USD', [-20700332, -166304352, -8638040]],
  ['CREDIA.AT', 'annualNetIncome', null, 'EUR', [15215000, -325459000, 27616000]],
  ...['SFNXF', 'SOF.BR', 'SOF.VI'].map(t => [t, 'annualNetIncome', '2024-12-31', 'EUR', [113001000, 1359505000, -104267000]]),
  ['SYNC.L', 'annualNetIncome', '2025-03-31', 'GBP', [-8805000, -143160000, 3788000]],
];
function checkGenuine(b) {
  for (const [ticker, reihe, periode, waehrung, werte] of genuine) {
    const x = { ticker, reihe, index: 1, links: werte[0], wert: werte[1], rechts: werte[2],
      nativ: { periode, waehrung, werte } };
    assert.equal(known(W, x, b), true, ticker + ' source-confirmed case is known');
    const changed = structuredClone(x); changed.nativ.werte[1] += 1000;
    assert.equal(known(W, changed, b), false, ticker + ' changed native value stays NEW');
  }
}
test('P168d: four genuine events are known, while false and undecidable events stay NEW', () => {
  assert.equal(W.basisGueltig(B, B.snapshotsBeiAufnahme).ok, true);
  checkGenuine(B);
  const withoutSofina = { ...B, faelle: B.faelle.filter(k => !k.startsWith('SFNXF|')),
    nativeIdentitaeten: B.nativeIdentitaeten.filter(x => x.ticker !== 'SFNXF') };
  assert.throws(() => checkGenuine(withoutSofina), { name: 'AssertionError' });
  for (const [ticker, reihe, periode, waehrung, werte] of [
    ['BANPU.BK', 'annualOpInc', '2023-12-31', 'USD', [-28259000, 6003496000, 524803000]],
    ['PCT.L', 'annualRev', '2024-04-30', 'GBP', [122389000, 1118772000, -101774000]],
    // P275 sources PCT.L annualNetIncome FY2024 from the issuer reports (annual-spikes-p275.test.js).
    ...['TSRYF', 'TWE.AX'].map(t => [t, 'annualOpInc', '2025-06-30', 'AUD', [57500000, 518100000, 42600000]]),
  ]) assert.equal(known(W, { ticker, reihe, index: 1, nativ: { periode, waehrung, werte } }, B), false, ticker);
  for (const ticker of ['KINV-A.ST', 'KINV-B.ST', 'MFSL.BO', 'MFSL.NS', 'VPLAY-A.ST']) {
    const x = { ...finding(null), ticker, reihe: 'annualOpInc' };
    assert.equal(known(W, x, baseline(x)), false, ticker + ' calibration cannot be approved');
  }
});

function checkHold(table, ticker, fx) {
  const values = [160800000, 466183100000, 582300000, 311875800000];
  const s = { meta: { ticker, source: 'yahoo', reportingCurrency: 'USD', reportingCurrencyOriginal: 'INR',
    fxConverted: true, fxRateApplied: fx, opIncSource: 'computed-margin' },
  annual: { annualRev: values.map(v => ({ value: v * fx })),
    annualRevEnds: ['2025-03-31', '2024-03-31', '2023-03-31', '2022-03-31'],
    annualOpInc: [1910303.8392, 5538254761.8169, 6917723.4177, 3705084192.124201].map(v => ({ value: v * fx })) } };
  const original = structuredClone(s);
  const result = F.applyFinancialCases(s, { table }).snapshot;
  assert.deepEqual(s, original, 'input is immutable');
  assert.deepEqual(result.annual.annualRev.map(r => r.value), [160800000 * fx, null, null, null]);
  assert.deepEqual(result.annual.annualOpInc.map(r => r.value), [s.annual.annualOpInc[0].value, null, null, null], 'P168f explicitly withholds unsupported operating income');
  assert.equal(result.annual.annualOpInc[1].financialCorrection.caseId, 'p168f-mfsl-2024-03-31-annualOpInc');
  const revenueOnly = { ...table, cases: table.cases.filter(c => c.caseId !== 'p168f-mfsl-2024-03-31-annualOpInc') };
  assert.deepEqual(F.applyFinancialCases(s, { table: revenueOnly }).snapshot.annual.annualOpInc, s.annual.annualOpInc, 'revenue authority alone still cannot change operating income');
  assert.match(F.financialReasons(result).join(' '), /Konzern- und Einzelabschluss/);
  assert.deepEqual(F.applyFinancialCases(result, { table }).snapshot, result, 'hold is idempotent');
  const unrelated = { ...s, meta: { ...s.meta, ticker: 'UNRELATED' } };
  assert.deepEqual(F.applyFinancialCases(unrelated, { table }).snapshot, unrelated);
}
test('P168d: existing annual hold removes mixed-basis MFSL revenue for both listings without bridging the gap', () => {
  checkHold(F.table, 'MFSL.BO', 0.010437869);
  checkHold(F.table, 'MFSL.NS', 0.010432696);
  const removed = { ...F.table, cases: F.table.cases.filter(c => c.caseId !== 'p168d-mfsl-2024-03-31-annualRev') };
  assert.throws(() => checkHold(removed, 'MFSL.BO', 0.010437869), { name: 'AssertionError' });
});

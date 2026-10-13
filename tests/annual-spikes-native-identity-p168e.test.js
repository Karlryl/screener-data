'use strict';
// Break-once targets only an in-memory module, never a writing test or live data.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const Module = require('node:module');
const F = require('../lib/financial-known-cases.js');
const live = path.resolve(__dirname, '../scripts/watch-annual-spikes.js');
const protectedFiles = [live, path.resolve(__dirname, '../configs/financial-known-cases.json'),
  path.resolve(__dirname, '../data-health/annual-spikes-baseline.json')];
const hashes = () => protectedFiles.map(f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex'));
const fixture = (ticker = 'VPLAY-A.ST', fx = 0.099577785) => ({
  meta: { ticker, reportingCurrency: 'USD', reportingCurrencyOriginal: 'SEK', fxConverted: true, fxRateApplied: fx },
  annual: { annualOpInc: [-486e6, -558e6, 10276e6, 413e6].map(value => ({ value: value * fx })),
    annualOpIncEnds: ['2025-12-31', '2024-12-31', '2023-12-31', '2022-12-31'] },
});
function scan(snapshot, table = F.table, breakRecognition = false) {
  const dir = path.resolve(__dirname, 'virtual-p168e');
  const fakeFs = Object.create(fs);
  fakeFs.existsSync = file => file === dir || fs.existsSync(file);
  fakeFs.readdirSync = file => file === dir ? ['snapshot.json'] : fs.readdirSync(file);
  fakeFs.readFileSync = (file, ...args) => file === path.join(dir, 'snapshot.json') ? JSON.stringify(snapshot) : fs.readFileSync(file, ...args);
  let source = fs.readFileSync(live, 'utf8');
  if (breakRecognition) {
    const anchor = '  if (x.handtabellenFall) return true;';
    const lines = source.split(/\r?\n/);
    assert.equal(lines.filter(line => line === anchor).length, 1, 'exact complete-line anchor');
    source = lines.map(line => line === anchor ? '  if (false) return true;' : line).join('\n');
  }
  const mod = new Module(live, module), originalRequire = Module.createRequire(live);
  mod.filename = live;
  mod.require = id => id === 'fs' ? fakeFs : id === '../lib/financial-known-cases.js'
    ? { table, applyFinancialCases: s => F.applyFinancialCases(s, { table }) } : originalRequire(id);
  mod._compile(source, live);
  const W = mod.exports, findings = W.scanSnapshots(dir).funde;
  const keys = new Set(), counts = W.fundeJeReihe(findings, keys);
  return { W, findings, fresh: findings.filter(x => !W.istBekannt(x, keys, counts, [], findings)) };
}

test('P168e: exact applied correction is known; removing its hand-table entry keeps the same spike NEW', () => {
  const raw = fixture(), bytes = JSON.stringify(raw);
  const withCase = scan(raw);
  assert.equal(withCase.findings.length, 1);
  assert.equal(withCase.findings[0].handtabellenFall, 'p168e-vplay-2023-12-31-annualOpInc');
  assert.equal(withCase.fresh.length, 0);
  const without = { ...F.table, cases: F.table.cases.filter(c => !c.caseId.startsWith('p168e-vplay-')) };
  assert.equal(scan(raw, without).fresh.length, 1);
  assert.equal(JSON.stringify(raw), bytes);
});

test('P168e: unrelated ticker, period, currency, unit and changed vendor value stay NEW', () => {
  for (const change of [s => { s.meta.ticker = 'OTHER'; }, s => { s.annual.annualOpIncEnds[2] = '2023-06-30'; },
    s => { s.meta.reportingCurrencyOriginal = 'EUR'; }, s => { s.meta.fxRateApplied *= 2; },
    s => { s.annual.annualOpInc[2].unit = 'shares'; }, s => { s.annual.annualOpInc[2].value += 1; },
    s => { s.annual.annualOpIncEnds[1] = s.annual.annualOpIncEnds[2]; }]) {
    const raw = fixture(); change(raw);
    assert.equal(scan(raw).fresh.length, 1, change.toString());
  }
  const raw = fixture();
  raw.annual.annualNetIncome = [100e6, 106e6, -9747e6, 323e6].map(value => ({ value: value * raw.meta.fxRateApplied }));
  raw.annual.annualNetIncomeEnds = [...raw.annual.annualOpIncEnds];
  assert.deepEqual(scan(raw).fresh.map(x => x.reihe), ['annualNetIncome'], 'other series of a corrected ticker is not approved');
});

test('P168e: both Kinnevik listings apply the exact sourced case without changing revenue', () => {
  for (const [ticker, fx] of [['KINV-A.ST', 0.099577785], ['KINV-B.ST', 0.099898696]]) {
    const raw = fixture(ticker, fx);
    raw.annual.annualOpInc = [0, 21964310, 893851920, 0].map(value => ({ value: value * fx }));
    raw.annual.annualRev = [0, 23e6, 936e6, 0].map(value => ({ value: value * fx }));
    raw.annual.annualRevEnds = [...raw.annual.annualOpIncEnds];
    const result = scan(raw);
    assert.equal(result.findings.find(x => x.reihe === 'annualOpInc').handtabellenFall, 'p168e-kinv-2023-12-31-annualOpInc');
    assert.deepEqual(result.fresh.map(x => x.reihe), ['annualRev']);
    assert.deepEqual(F.applyFinancialCases(raw).snapshot.annual.annualRev, raw.annual.annualRev);
  }
});

test('P168e: source values are exact; the unchanged P177 guard withholds unverified newer-year series', () => {
  for (const [ticker, wrong, correct] of [['VPLAY-A.ST', 10276e6, -10276e6], ['KINV-A.ST', 893851920, -5123e6]]) {
    const c = F.table.cases.find(c => c.ticker === ticker && c.caseId.startsWith('p168e-'));
    assert.deepEqual([c.period, c.expectedBadValue, c.replacementValue, c.sources[0].value], ['2023-12-31', wrong, correct, correct]);
    assert.ok(c.sources[0].page && c.sources[0].quote && c.sources[0].published && c.sources[0].checked);
    const raw = fixture(ticker); raw.annual.annualOpInc[2].value = wrong * raw.meta.fxRateApplied;
    const preConfirmation = { ...F.table, cases: F.table.cases.filter(c => !c.caseId.startsWith('p168f-')) };
    const output = F.applyFinancialCases(raw, { table: preConfirmation });
    assert.ok(output.snapshot.annual.annualOpInc.every(row => row.value === null), 'no invented 2025 confirmation');
    assert.ok(output.events.some(e => e.caseId === c.caseId && e.newValue === correct * raw.meta.fxRateApplied));
    const dated = structuredClone(raw);
    dated.annual.annualOpInc = [raw.annual.annualOpInc[2]];
    dated.annual.annualOpIncEnds = ['2023-12-31'];
    assert.equal(F.applyFinancialCases(dated).snapshot.annual.annualOpInc[0].value, correct * raw.meta.fxRateApplied);
  }
});

test('P168e: revenue-only authority never approves derived operating income or propagated older holds', () => {
  const revenueOnly = { ...F.table, cases: F.table.cases.filter(c => c.caseId !== 'p168f-mfsl-2024-03-31-annualOpInc') };
  const fx = 0.010437869;
  const raw = { meta: { ticker: 'MFSL.BO', reportingCurrency: 'USD', reportingCurrencyOriginal: 'INR', fxConverted: true, fxRateApplied: fx },
    annual: { annualRev: [160800000, 466183100000, 582300000, 311875800000].map(value => ({ value: value * fx })),
      annualRevEnds: ['2025-03-31', '2024-03-31', '2023-03-31', '2022-03-31'],
      annualOpInc: [1910303.8392, 5538254761.8169, 6917723.4177, 3705084192.124201].map(value => ({ value: value * fx })),
      annualOpIncEnds: ['2025-03-31', '2024-03-31', '2023-03-31', '2022-03-31'] } };
  assert.deepEqual(scan(raw, revenueOnly).fresh.map(x => x.reihe), ['annualOpInc']);
  for (const invalid of [{ unit: 'shares' }, { currency: 'EUR' }, { currencyUnit: 'EUR' },
    { multiplier: 1000 }, { periodType: '3M' }, { source: 'other-provider' }]) {
    const wrongContext = structuredClone(raw);
    Object.assign(wrongContext.annual.annualRev[1], invalid);
    assert.equal(scan(wrongContext, revenueOnly).fresh.length, 2, 'null holds also reject ' + JSON.stringify(invalid));
  }
  const duplicatePeriod = structuredClone(raw);
  duplicatePeriod.annual.annualRevEnds[2] = duplicatePeriod.annual.annualRevEnds[1];
  assert.equal(scan(duplicatePeriod, revenueOnly).fresh.length, 2, 'null holds also reject a duplicate target period');
  raw.annual.annualRev.push({ value: 1e6 * fx }); raw.annual.annualRevEnds.push('2021-03-31');
  const findings = scan(raw, revenueOnly);
  assert.equal(findings.findings.find(x => x.reihe === 'annualRev' && x.index === 3).handtabellenFall, undefined);
  assert.ok(findings.fresh.some(x => x.reihe === 'annualRev' && x.index === 3));
});

test('P168e: an already persisted correction stays known only with its current exact authority', () => {
  const raw = fixture();
  raw.annual.annualOpInc = raw.annual.annualOpInc.slice(1);
  raw.annual.annualOpIncEnds = raw.annual.annualOpIncEnds.slice(1);
  const center = F.table.cases.find(c => c.caseId.startsWith('p168e-vplay-'));
  const table = structuredClone(F.table);
  table.cases = table.cases.filter(c => !c.caseId.startsWith('p168f-vplay-')); // Keep this test's independent confirmation authority.
  for (const [index, value] of [[0, -558e6], [2, 413e6]]) {
    const period = raw.annual.annualOpIncEnds[index];
    table.cases.push({ ...structuredClone(center), caseId: 'test-confirm-' + period, index, period,
      expectedBadValue: value, replacementValue: value, reason: 'Betriebsergebnis bestätigt: Testjahr.',
      sources: [{ ...center.sources[0], value, start: period.slice(0, 4) + '-01-01', end: period }] });
  }
  const corrected = F.applyFinancialCases(raw, { table }).snapshot;
  assert.equal(scan(corrected, table).fresh.length, 0);
  const removed = { ...table, cases: table.cases.filter(c => c.ticker !== 'VPLAY-A.ST') };
  assert.equal(scan(corrected, removed).fresh.length, 1, 'a retained marker without authority never approves');
  const stale = structuredClone(corrected); stale.annual.annualOpInc[1].financialCorrection.revision = 'obsolete';
  assert.equal(scan(stale, table).fresh.length, 1);
});

test('P168e: break-once recognition turns red; watcher, baseline and table hashes stay unchanged', () => {
  const before = hashes();
  const guard = broken => assert.equal(scan(fixture(), F.table, broken).fresh.length, 0, 'corrected spike must be known');
  try {
    guard(false);
    assert.throws(() => guard(true), error => {
      assert.equal(error.name, 'AssertionError');
      console.log('BREAK-ONCE RED P168e: ' + error.message);
      return true;
    });
  } finally { assert.deepEqual(hashes(), before); }
});

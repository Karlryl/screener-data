'use strict';
// Real native amounts, memory-only mutations; no external snapshot dependency.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const F = require('../lib/financial-known-cases.js');
const W = require('../scripts/watch-annual-spikes.js');
const B = require('../data-health/annual-spikes-baseline.json');
const { migriereIdentitaeten } = require('../scripts/annual-spikes-migrate-identity.js');
const years = ['2025-12-31', '2024-12-31', '2023-12-31', '2022-12-31'];
const vplay = (fx = 0.099577785) => ({
  meta: { ticker: 'VPLAY-A.ST', reportingCurrency: 'USD', reportingCurrencyOriginal: 'SEK', fxConverted: true, fxRateApplied: fx },
  annual: { annualOpInc: [-486e6, -558e6, 10276e6, 413e6].map(v => ({ value: v * fx })), annualOpIncEnds: years.slice(),
    annualNetIncome: [-1268e6, 106e6, -9747e6, 323e6].map(v => ({ value: v * fx })), annualNetIncomeEnds: years.slice() },
});
const expected = fx => [-486e6, -558e6, -10276e6, 413e6].map(v => v * fx);
const values = s => s.annual.annualOpInc.map(r => r.value);
function oldTable() {
  const table = structuredClone(F.table);
  table.cases = table.cases.filter(c => !c.caseId.startsWith('p168f-'));
  const c = table.cases.find(c => c.caseId === 'p168e-vplay-2023-12-31-annualOpInc');
  c.revision = '2026-10-11-p168e';
  c.reason = c.reason.replace(' Quelle: Viaplay-Geschäftsbericht 2024, Seite 32.', '');
  return table;
}
function finding(snapshot = vplay()) {
  const hit = W.findeAusreisser(snapshot.annual.annualNetIncome)[0];
  return { ticker: snapshot.meta.ticker, reihe: 'annualNetIncome', periode: null, ...hit,
    nativ: W.nativeIdentitaet(snapshot, 'annualNetIncome', hit.index), fxRateApplied: snapshot.meta.fxRateApplied };
}
function known(f, basis = B) {
  const keys = new Set(basis.faelle), native = basis.nativeIdentitaeten;
  return W.istBekannt(f, keys, W.fundeJeReihe([f], keys, native), native, [f]);
}

test('P168f: all four sourced Viaplay years show, including recovery from persisted P168e holds', () => {
  const raw = vplay(), bytes = JSON.stringify(raw), previous = F.applyFinancialCases(raw, { table: oldTable() }).snapshot;
  assert.deepEqual(values(previous), [null, null, null, null]);
  for (const input of [raw, previous, vplay(0.099577785 * 1.03)]) {
    const out = F.applyFinancialCases(input).snapshot;
    assert.deepEqual(values(out), expected(input.meta.fxRateApplied));
    assert.deepEqual(out.annual.annualNetIncome, input.annual.annualNetIncome, 'net-income values are outside the correction');
    const row = out.annual.annualOpInc[2];
    assert.equal(row.financialCorrection.sources[0].value, -10276e6);
    assert.equal(row.financialCorrection.sources[0].page, '32');
    assert.ok(F.financialReasons(out).some(r => r.includes('10.276 Mio. SEK') && r.includes('Geschäftsbericht 2024, Seite 32')));
    assert.deepEqual(F.applyFinancialCases(out).snapshot, out, 'replay is idempotent');
  }
  assert.equal(JSON.stringify(raw), bytes);
});

test('P168f: every confirmation is necessary; unseen years and changed amounts keep the P50 guard', () => {
  for (const c of F.table.cases.filter(c => c.caseId.startsWith('p168f-vplay-'))) {
    const table = { ...F.table, cases: F.table.cases.filter(x => x.caseId !== c.caseId) };
    const out = F.applyFinancialCases(vplay(), { table }).snapshot;
    assert.equal(out.annual.annualOpInc[c.index].value, null, c.caseId);
    assert.notDeepEqual(values(out), expected(vplay().meta.fxRateApplied));
  }
  const changed = vplay(); changed.annual.annualOpInc[0].value += 1;
  assert.deepEqual(values(F.applyFinancialCases(changed).snapshot), [null, null, null, null]);
  const newYear = vplay(); newYear.annual.annualOpInc.unshift({ value: 1 }); newYear.annual.annualOpIncEnds.unshift('2026-12-31');
  assert.deepEqual(values(F.applyFinancialCases(newYear).snapshot), [null, null, null, null, null]);
});

test('P168f: MFSL aliases withhold the exact derived 2024 value and older years, never substitute PBT', () => {
  const c = F.table.cases.find(c => c.caseId === 'p168f-mfsl-2024-03-31-annualOpInc');
  assert.equal(c.expectedBadValue, 466183100000 * 0.011879999);
  assert.equal(c.sources[0].value, 4661832 * 100000, 'lakh conversion is exact');
  assert.equal(c.replacementValue, null);
  for (const [ticker, fx] of [['MFSL.BO', 0.010437869], ['MFSL.NS', 0.010432696]]) {
    const raw = { meta: { ticker, reportingCurrency: 'USD', reportingCurrencyOriginal: 'INR', fxConverted: true, fxRateApplied: fx },
      annual: { annualOpInc: [1910303.8392, c.expectedBadValue, 6917723.4177, 3705084192.124201].map(v => ({ value: v * fx })),
        annualOpIncEnds: ['2025-03-31', '2024-03-31', '2023-03-31', '2022-03-31'] } };
    const out = F.applyFinancialCases(raw).snapshot;
    assert.deepEqual(values(out), [raw.annual.annualOpInc[0].value, null, null, null]);
    assert.equal(out.annual.annualOpInc[1].financialCorrection.caseId, c.caseId);
    assert.ok(F.financialReasons(out).includes(c.reason));
    assert.deepEqual(F.applyFinancialCases(out).snapshot, out);
    const noCase = { ...F.table, cases: F.table.cases.filter(x => x.caseId !== c.caseId) };
    assert.deepEqual(values(F.applyFinancialCases(raw, { table: noCase }).snapshot), values(raw));
    const changed = structuredClone(raw); changed.annual.annualOpInc[1].value += 1;
    assert.deepEqual(values(F.applyFinancialCases(changed).snapshot), [null, null, null, null]);
  }
});

test('P168f: sourced net-loss identity is known across FX; synthetic changed year, currency and amounts remain NEW', () => {
  const entry = B.nativeIdentitaeten.filter(x => x.ticker === 'VPLAY-A.ST' && x.reihe === 'annualNetIncome');
  assert.equal(entry.length, 1);
  assert.deepEqual(entry[0].nativ, { periode: '2023-12-31', waehrung: 'SEK', werte: [106e6, -9747e6, 323e6] });
  assert.ok(B.faelle.includes(entry[0].schluessel));
  assert.ok(B.hinweis.includes('Net income for the year 106 –9,747'));
  assert.equal(known(finding()), true);
  assert.equal(known(finding(vplay(0.099577785 * 1.03))), true);
  for (const mutate of [f => { f.nativ.periode = '2022-12-31'; }, f => { f.nativ.waehrung = 'EUR'; },
    f => { f.nativ.werte[0] += 1e6; }, f => { f.nativ.werte[1] -= 1e6; }, f => { f.nativ.werte[2] += 1e6; },
    f => { f.ticker = 'SYNTHETIC-TWIN'; }]) {
    const twin = finding(); mutate(twin); assert.equal(known(twin), false, mutate.toString());
  }
  const absent = { ...B, nativeIdentitaeten: B.nativeIdentitaeten.filter(x => x !== entry[0]) };
  assert.equal(known(finding(), absent), false, 'the sourced native entry is required for current FX');
  for (const ticker of ['KINV-A.ST', 'KINV-B.ST', 'MFSL.BO', 'MFSL.NS', 'VPLAY-A.ST']) {
    assert.equal(W.istEichfall({ ticker, reihe: 'annualOpInc' }), true);
  }
  const migrated = migriereIdentitaeten(B, { funde: [finding()], parseFehler: 0, gescannt: B.snapshotsBeiAufnahme }, '2026-10-10');
  assert.deepEqual(migrated.baseline.nativeIdentitaeten.find(x => x.schluessel === entry[0].schluessel), entry[0]);
});

test('P168f: removal of either source authority turns its guard red without changing live files', () => {
  const files = ['scripts/watch-annual-spikes.js', 'lib/financial-known-cases.js', 'configs/financial-known-cases.json', 'data-health/annual-spikes-baseline.json'];
  const hashes = () => files.map(f => crypto.createHash('sha256').update(fs.readFileSync(path.resolve(__dirname, '..', f))).digest('hex'));
  const before = hashes();
  const financialGuard = table => assert.deepEqual(values(F.applyFinancialCases(vplay(), { table }).snapshot), expected(vplay().meta.fxRateApplied));
  const nativeGuard = baseline => assert.equal(known(finding(), baseline), true, 'sourced net loss must be known');
  try {
    financialGuard(F.table); nativeGuard(B);
    assert.throws(() => financialGuard(oldTable()), assert.AssertionError);
    assert.throws(() => nativeGuard({ ...B, nativeIdentitaeten: B.nativeIdentitaeten.filter(x => x.ticker !== 'VPLAY-A.ST') }), assert.AssertionError);
    console.log('BREAK-ONCE RED P168f: both source-authority removals caught');
  } finally { assert.deepEqual(hashes(), before); }
});

'use strict';
// Source amounts in CNY yuan; fixtures are independent of external snapshots.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const W = require('../scripts/watch-annual-spikes.js');
const B = require('../data-health/annual-spikes-baseline.json');
const F = require('../lib/financial-known-cases.js');
const years = ['2025-12-31', '2024-12-31', '2023-12-31'];
const amounts = {
  annualOpInc: [16789103.06, -651163336.96, -1528740.02],
  annualNetIncome: [20396737.72, -538648272.66, 22637174.89],
};
const snapshot = (fx = 0.14963564) => ({
  meta: { ticker: '300715.SZ', reportingCurrency: 'USD', reportingCurrencyOriginal: 'CNY',
    fxConverted: true, fxRateApplied: fx, opIncSource: 'yahoo-adjusted' },
  annual: Object.fromEntries(Object.entries(amounts).flatMap(([field, values]) => [
    [field, values.map(v => ({ value: v * fx }))], [field + 'Ends', [...years]],
  ])),
});
function findings(s = snapshot()) {
  return Object.keys(amounts).flatMap(reihe => W.findeAusreisser(s.annual[reihe]).map(hit => ({
    ticker: s.meta.ticker, reihe, periode: null, ...hit, nativ: W.nativeIdentitaet(s, reihe, hit.index),
  })));
}
function known(f, b = B) {
  const keys = new Set(b.faelle), native = b.nativeIdentitaeten;
  return W.istBekannt(f, keys, W.fundeJeReihe([f], keys, native), native, [f]);
}

test('P211: two sourced FY2024 series retain the exact native three-year identity', () => {
  const entries = B.nativeIdentitaeten.filter(e => e.ticker === '300715.SZ');
  assert.equal(entries.length, 2);
  assert.equal(B.faelle.filter(k => k.startsWith('300715.SZ|')).length, 2);
  for (const f of findings()) {
    const e = entries.find(e => e.reihe === f.reihe);
    assert.deepEqual(e.nativ, { periode: '2024-12-31', waehrung: 'CNY',
      werte: amounts[f.reihe].map(v => Number(v.toPrecision(10))) });
    assert.equal(e.schluessel, W.stabilerSchluessel(f));
    assert.ok(B.faelle.includes(e.schluessel));
    assert.equal(e.datenstand, '2026-10-13');
    assert.equal(e.fxRateApplied, 0.14963564);
    assert.equal(e.usdFaktor, 1);
    assert.equal(e.maxRelativeAbweichung, 0);
  }
  for (const token of ['1223143379.PDF', '1225163584.PDF', '1219690891.PDF',
    '营业利润', '归属于母公司股东的净利润', '-651,163,336.96', '-538,648,272.66']) assert.ok(B.hinweis.includes(token), token);
});

test('P211: both losses stay known after FX drift without changing any board input', () => {
  for (const fx of [0.14963564, 0.14963564 * 1.03]) {
    const s = snapshot(fx), before = structuredClone(s), found = findings(s);
    assert.equal(found.length, 2);
    for (const f of found) assert.equal(known(f), true);
    assert.deepEqual(W.faktorGleicheFaelle(found).gleich, [], 'real loss is not an equal-factor artifact');
    assert.deepEqual(F.applyFinancialCases(s).snapshot, s, 'baseline recognition has no hand-table authority');
    assert.deepEqual(s, before);
  }
  assert.equal(F.table.cases.some(c => [c.ticker, ...(c.listingAliases || [])].includes('300715.SZ')), false);
});

test('P211: changed center, either neighbor, currency, year, issuer or field stays NEW', () => {
  for (const f of findings()) {
    for (const mutate of [
      x => { x.nativ.werte[0] += 1000; }, x => { x.nativ.werte[1] -= 1000; },
      x => { x.nativ.werte[2] += 1000; }, x => { x.nativ.waehrung = 'USD'; },
      x => { x.nativ.periode = '2023-12-31'; }, x => { x.ticker = 'P211-UNRELATED'; },
      x => { x.reihe = 'annualRev'; },
    ]) {
      const changed = structuredClone(f); mutate(changed);
      assert.equal(known(changed), false, f.reihe + ': ' + mutate.toString());
    }
  }
});

test('P211: absent authority stays NEW; the existing exact-USD fallback remains bounded', () => {
  const absent = { ...B, faelle: B.faelle.filter(k => !k.startsWith('300715.SZ|')),
    nativeIdentitaeten: B.nativeIdentitaeten.filter(e => e.ticker !== '300715.SZ') };
  for (const f of findings()) {
    assert.equal(known(f, absent), false);
    const legacy = { ...f, nativ: null };
    assert.equal(known(legacy), true, 'existing exact USD fallback, not a new metadata approval');
    legacy.wert -= 1;
    assert.equal(known(legacy), false, 'missing native evidence cannot accept a changed USD value');
  }
  const noNative = { ...B, nativeIdentitaeten: absent.nativeIdentitaeten };
  for (const f of findings(snapshot(0.14963564 * 1.03))) assert.equal(known(f, noNative), false);
});

test('P211: each removed native authority turns the drift guard red in memory only', () => {
  const files = ['scripts/watch-annual-spikes.js', 'data-health/annual-spikes-baseline.json',
    'configs/financial-known-cases.json', 'lib/financial-known-cases.js'];
  const hashes = () => files.map(f => crypto.createHash('sha256').update(fs.readFileSync(path.resolve(__dirname, '..', f))).digest('hex'));
  const before = hashes();
  const guard = b => { for (const f of findings(snapshot(0.14963564 * 1.03))) assert.equal(known(f, b), true, f.reihe); };
  try {
    guard(B);
    for (const reihe of Object.keys(amounts)) {
      const mutant = { ...B, nativeIdentitaeten: B.nativeIdentitaeten.filter(e => !(e.ticker === '300715.SZ' && e.reihe === reihe)) };
      assert.throws(() => guard(mutant), assert.AssertionError);
      console.log('BREAK-ONCE RED P211: missing native authority caught for ' + reihe);
    }
  } finally { assert.deepEqual(hashes(), before, 'live files stay byte-identical'); }
});

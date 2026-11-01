'use strict';
// P299: targeted baseline entry from CI run 41027769596; all break-once mutations stay in memory.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const W = require('../scripts/watch-annual-spikes.js');
const B = require('../data-health/annual-spikes-baseline.json');

// Thousands of USD as printed in the 10-K statements of operations (index 0 = newest year).
const REV = [87371, 380786, 22230];
const COST = [5953 + 118680, 25441, 2993]; // 2024: both lines the issuer labels "Cost of sales".
const GP = [-37262000, 355345000, 19237000];
const ENDS = ['2024-12-31', '2023-12-31', '2022-12-31'];
const KEY = 'AMLX|annualGP|werte:-37262000|355345000|19237000';

const finding = (fx = 1, gp = GP) => {
  const s = { meta: { ticker: 'AMLX', reportingCurrency: 'USD', reportingCurrencyOriginal: 'USD', fxConverted: true, fxRateApplied: fx,
    statementPeriods: { annualGP: ENDS.map(end => ({ end, duration: '12M', currency: 'USD', unit: 'currency' })) } },
  annual: { annualGP: gp.map(value => ({ value })), annualGPEnds: [...ENDS] } };
  const [hit] = W.findeAusreisser(s.annual.annualGP);
  return { ticker: 'AMLX', reihe: 'annualGP', periode: null, ...hit, nativ: W.nativeIdentitaet(s, 'annualGP', hit.index) };
};
function known(f, b = B) {
  const keys = new Set(b.faelle), native = b.nativeIdentitaeten;
  return W.istBekannt(f, keys, W.fundeJeReihe([f], keys, native), native, [f]);
}

test('P299: the stored triple is revenue minus every printed cost-of-sales line, and the entry carries its sources', () => {
  assert.deepEqual(REV.map((r, i) => (r - COST[i]) * 1000), GP);
  const f = finding();
  assert.equal(f.index, 1);
  assert.equal(W.stabilerSchluessel(f), KEY);
  assert.ok(B.faelle.includes(KEY));
  const entries = B.nativeIdentitaeten.filter(e => e.ticker === 'AMLX');
  assert.equal(entries.length, 1);
  assert.deepEqual(entries[0].nativ, { periode: '2023-12-31', waehrung: 'USD', werte: GP });
  for (const token of ['000095017025031309', '000095017024018447', '118,680', '5,953', '25,441', '2,993', '41027769596']) {
    assert.ok(B.hinweis.includes(token), token);
  }
  assert.equal(B.anzahl, B.faelle.length);
  assert.equal(W.basisGueltig(B, 15899).ok, true);
  assert.equal(known(f), true);
});

test('P299: changed center, either neighbour, currency, year, issuer or field stays NEW', () => {
  for (const mutate of [
    x => { x.nativ.werte[0] += 1000; x.links += 1000; }, x => { x.nativ.werte[1] -= 1000; x.wert -= 1000; },
    x => { x.nativ.werte[2] += 1000; x.rechts += 1000; }, x => { x.nativ.waehrung = 'EUR'; },
    x => { x.nativ.periode = '2019-12-31'; }, x => { x.ticker = 'P299-UNRELATED'; }, x => { x.reihe = 'annualOpInc'; },
  ]) {
    const changed = finding(); mutate(changed);
    assert.equal(known(changed), false, mutate.toString());
  }
});

test('P299: PCT.L revenue and 002822.SZ gross profit are not absorbed', () => {
  assert.equal(B.faelle.some(k => /^(PCT\.L\|annualRev|002822\.SZ)\|/.test(k)), false);
  assert.equal(B.nativeIdentitaeten.some(e => e.ticker === '002822.SZ' || (e.ticker === 'PCT.L' && e.reihe === 'annualRev')), false);
  const pctRev = { ticker: 'PCT.L', reihe: 'annualRev', index: 2, wert: 1118772000 * 1.3261017,
    links: 122389000 * 1.3261017, rechts: -101774000 * 1.3261017,
    nativ: { periode: '2024-04-30', waehrung: 'GBP', werte: [122389000, 1118772000, -101774000] } };
  assert.equal(known(pctRev), false, 'PCT.L revenue stays NEW (P276 point 4)');
});

test('P299: the full regeneration stays locked and the thresholds are unchanged', () => {
  assert.throws(() => W.baueNeuenBestand(B, [], 15899), /Nativer Bestand/);
  assert.equal(W.FAKTOR, 8);
  assert.equal(W.MIN_BETRAG, 50e6);
  assert.equal(W.parseMaxNeu(undefined), 5);
  assert.equal(W.POP_TOLERANZ, 0.2);
  assert.equal(W.FAKTOR_GLEICH_TOL, 1.02);
  assert.equal(W.AUSSCHLUSS_MAX_TAGE, 30);
});

test('P299: removing the native authority and the key turns the guard red in memory', () => {
  const files = ['scripts/watch-annual-spikes.js', 'data-health/annual-spikes-baseline.json'];
  const hashes = () => files.map(f => crypto.createHash('sha256').update(fs.readFileSync(path.resolve(__dirname, '..', f))).digest('hex'));
  const before = hashes();
  const guard = b => assert.equal(known(finding(), b), true);
  try {
    guard(B);
    const without = { ...B, faelle: B.faelle.filter(k => k !== KEY),
      nativeIdentitaeten: B.nativeIdentitaeten.filter(e => e.ticker !== 'AMLX') };
    assert.throws(() => guard(without), assert.AssertionError);
    console.log('BREAK-ONCE RED P299: missing AMLX authority caught');
  } finally { assert.deepEqual(hashes(), before, 'live files stay byte-identical'); }
});

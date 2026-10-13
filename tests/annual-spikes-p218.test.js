'use strict';
// Issuer report amounts in CNY yuan; all break-once mutations stay in memory.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const W = require('../scripts/watch-annual-spikes.js');
const B = require('../data-health/annual-spikes-baseline.json');
const F = require('../lib/financial-known-cases.js');
const years = ['2025-12-31', '2024-12-31', '2023-12-31'];
const amounts = {
  annualOpInc: [-264997053.94, -3470528891.53, 243863557.83],
  annualNetIncome: [133746317.81, -2296841255.74, 717031594.87],
};
const snapshot = (fx = 0.14963564) => ({
  meta: { ticker: '000301.SZ', reportingCurrency: 'USD', reportingCurrencyOriginal: 'CNY',
    fxConverted: true, fxRateApplied: fx, opIncSource: 'yahoo-adjusted',
    statementPeriods: Object.fromEntries(Object.keys(amounts).map(field => [field,
      years.map(end => ({ end, duration: '12M', currency: 'CNY', unit: 'currency' }))])) },
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

test('P218: only the sourced FY2024 OpInc triple is anchored, with all three report URLs', () => {
  const entries = B.nativeIdentitaeten.filter(e => e.ticker === '000301.SZ');
  assert.equal(entries.length, 1);
  const [f] = findings();
  assert.equal(findings().length, 1, 'attributable net income does not meet the spike factor');
  assert.equal(f.reihe, 'annualOpInc');
  assert.equal(f.index, 1);
  assert.deepEqual(entries[0], { schluessel: W.stabilerSchluessel(f), ticker: '000301.SZ', reihe: 'annualOpInc',
    nativ: { periode: '2024-12-31', waehrung: 'CNY', werte: [-264997053.9, -3470528892, 243863557.8] },
    datenstand: '2026-10-13', fxRateApplied: 0.14963564, usdFaktor: 1, maxRelativeAbweichung: 0 });
  assert.deepEqual(B.faelle.filter(k => k.startsWith('000301.SZ|')), [entries[0].schluessel]);
  assert.equal(B.ausgeschlossen.some(e => e.sperrschluessel === '000301.SZ|annualOpInc|1'), false);
  for (const token of ['1223385370.PDF', '1225243361.pdf', '1219829278.PDF',
    '-3,470,528,891.53', '-264,997,053.94', '243,863,557.83', 'Seite 98', 'Seite 89', 'Seite 115/242']) {
    assert.ok(B.hinweis.includes(token), token);
  }
  assert.equal(W.basisGueltig(B, 16300).ok, true);
});

test('P218: FX drift remains known with unchanged board input and no hand-table authority', () => {
  for (const fx of [0.14963564, 0.14963564 * 1.03]) {
    const s = snapshot(fx), before = structuredClone(s);
    assert.equal(known(findings(s)[0]), true);
    assert.deepEqual(F.applyFinancialCases(s).snapshot, s);
    assert.deepEqual(s, before);
  }
  assert.equal(F.table.cases.some(c => [c.ticker, ...(c.listingAliases || [])].includes('000301.SZ')), false);
});

test('P218: changed center, either neighbor, currency, year, issuer or field stays NEW', () => {
  for (const mutate of [
    x => { x.nativ.werte[0] += 1000; }, x => { x.nativ.werte[1] -= 1000; },
    x => { x.nativ.werte[2] += 1000; }, x => { x.nativ.waehrung = 'USD'; },
    x => { x.nativ.periode = '2023-12-31'; }, x => { x.ticker = 'P218-UNRELATED'; },
    x => { x.reihe = 'annualNetIncome'; },
  ]) {
    const changed = structuredClone(findings()[0]); mutate(changed);
    assert.equal(known(changed), false, mutate.toString());
  }
});

test('P218: absent authority stays NEW and existing missing-metadata fallbacks stay bounded', () => {
  const absent = { ...B, faelle: B.faelle.filter(k => !k.startsWith('000301.SZ|')),
    nativeIdentitaeten: B.nativeIdentitaeten.filter(e => e.ticker !== '000301.SZ') };
  assert.equal(known(findings()[0], absent), false);
  const exact = { ...findings()[0], nativ: null };
  assert.equal(known(exact), true, 'existing exact-USD fallback, not a new metadata approval');
  exact.wert -= 1;
  assert.equal(known(exact), false);
  const undated = findings(snapshot(0.14963564 * 1.03))[0];
  undated.nativ.periode = null;
  assert.equal(known(undated), true, 'existing undated native-triple fallback is unchanged');
  undated.nativ.werte[1] -= 1000;
  assert.equal(known(undated), false);
});

test('P218: the age boundary remains 30 days and retaining the resolved block is inconsistent', () => {
  assert.equal(W.AUSSCHLUSS_MAX_TAGE, 30);
  assert.equal(W.tageSeit('2026-09-26', new Date('2026-10-26T23:59:59Z')), 30);
  assert.equal(W.tageSeit('2026-09-26', new Date('2026-10-27T00:00:00Z')), 31);
  const f = findings()[0], old = { sperrschluessel: W.sperrSchluessel(f) };
  assert.deepEqual(W.sperrenOhneWirkung([old], [f], new Set(B.faelle), B.nativeIdentitaeten), [old.sperrschluessel]);
  for (const date of ['2026-10-13T12:00:00Z', '2026-10-27T12:00:00Z']) {
    assert.equal(W.ausschlussTelemetrie(B.ausgeschlossen, new Date(date)).anzahl, 0);
  }
  assert.equal(W.FAKTOR, 8);
  assert.equal(W.parseMaxNeu(undefined), 5);
  assert.equal(W.FAKTOR_GLEICH_TOL, 1.02);
  assert.equal(W.MELDEND_BIS.toISOString(), '2026-10-10T00:00:00.000Z');
});

test('P218: removed native authority and restored block each turn the guard red in memory', () => {
  const files = ['scripts/watch-annual-spikes.js', 'data-health/annual-spikes-baseline.json',
    'configs/financial-known-cases.json', 'lib/financial-known-cases.js'];
  const hashes = () => files.map(f => crypto.createHash('sha256').update(fs.readFileSync(path.resolve(__dirname, '..', f))).digest('hex'));
  const before = hashes();
  const guard = b => {
    assert.equal(known(findings(snapshot(0.14963564 * 1.03))[0], b), true);
    assert.equal(b.ausgeschlossen.some(e => e.sperrschluessel === '000301.SZ|annualOpInc|1'), false);
  };
  try {
    guard(B);
    assert.throws(() => guard({ ...B, nativeIdentitaeten: B.nativeIdentitaeten.filter(e => e.ticker !== '000301.SZ') }), assert.AssertionError);
    assert.throws(() => guard({ ...B, ausgeschlossen: [...B.ausgeschlossen, { sperrschluessel: '000301.SZ|annualOpInc|1' }] }), assert.AssertionError);
    console.log('BREAK-ONCE RED P218: missing native authority and restored block caught');
  } finally { assert.deepEqual(hashes(), before, 'live files stay byte-identical'); }
});

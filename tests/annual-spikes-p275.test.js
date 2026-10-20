'use strict';
// P275: issuer-sourced special years from run 39387109481; all break-once mutations stay in memory.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const W = require('../scripts/watch-annual-spikes.js');
const B = require('../data-health/annual-spikes-baseline.json');
const F = require('../lib/financial-known-cases.js');

// Native amounts as printed by the issuers (index 0 = newest year), with the stored FX of 20.10.2026.
const CASES = [
  { ticker: 'TYG', reihe: 'annualNetIncome', cur: 'USD', fx: 1, index: 1,
    ends: ['2025-11-30', '2024-11-30', '2023-11-30', '2022-11-30'],
    values: [19355818, 210921731, -15622613, 103261597], tokens: ['000120677425000062', '210,921,731', '19,355,818', '(15,622,613 )'] },
  { ticker: 'PCT.L', reihe: 'annualNetIncome', cur: 'GBP', fx: 1.3261017, index: 2,
    ends: ['2026-04-30', '2025-04-30', '2024-04-30', '2023-04-30'],
    values: [3752471000, 118355000, 1115437000, -105182000], tokens: ['PCTT_Annual_Report_2024.pdf', 'NI-000124607', '1,115,437', '118,355', '(105,182)'] },
  { ticker: '603822.SS', reihe: 'annualNetIncome', cur: 'CNY', fx: 0.14973421, index: 1,
    ends: ['2025-12-31', '2024-12-31', '2023-12-31', '2022-12-31'],
    values: [31348113.74, -366940285.42, -7540228.65, -32440095.71], tokens: ['1225091341.PDF', '1223386657.PDF', '-366,940,285.42', '31,348,113.74', '-7,540,228.65'] },
];
const snapshot = (c, fx = c.fx) => ({
  meta: { ticker: c.ticker, reportingCurrency: 'USD', reportingCurrencyOriginal: c.cur, fxConverted: true, fxRateApplied: fx,
    statementPeriods: { [c.reihe]: c.ends.map(end => ({ end, duration: '12M', currency: c.cur, unit: 'currency' })) } },
  annual: { [c.reihe]: c.values.map(v => ({ value: v * fx })), [c.reihe + 'Ends']: [...c.ends] },
});
function findings(c, fx = c.fx) {
  const s = snapshot(c, fx);
  return W.findeAusreisser(s.annual[c.reihe]).map(hit => ({ ticker: c.ticker, reihe: c.reihe, periode: null, ...hit,
    nativ: W.nativeIdentitaet(s, c.reihe, hit.index) }));
}
function known(f, b = B) {
  const keys = new Set(b.faelle), native = b.nativeIdentitaeten;
  return W.istBekannt(f, keys, W.fundeJeReihe([f], keys, native), native, [f]);
}
const entryOf = (c, b = B) => b.nativeIdentitaeten.filter(e => e.ticker === c.ticker && e.reihe === c.reihe);

test('P275: each sourced case has exactly one dated native identity with the issuer triple and its sources', () => {
  for (const c of CASES) {
    const fs_ = findings(c);
    assert.equal(fs_.length, 1, c.ticker + ' ' + c.reihe);
    const [f] = fs_, entries = entryOf(c);
    assert.equal(f.index, c.index);
    assert.equal(entries.length, 1, c.ticker + ' ' + c.reihe);
    const triple = [c.index - 1, c.index, c.index + 1].map(i => Number(c.values[i].toPrecision(10)));
    assert.deepEqual(entries[0].nativ, { periode: c.ends[c.index], waehrung: c.cur, werte: triple });
    assert.equal(entries[0].schluessel, W.stabilerSchluessel(f));
    assert.ok(B.faelle.includes(entries[0].schluessel));
    for (const token of c.tokens) assert.ok(B.hinweis.includes(token), token);
  }
  assert.equal(B.anzahl, B.faelle.length);
  assert.equal(W.basisGueltig(B, 16107).ok, true);
});

test('P275: FX drift stays known, board input unchanged, no hand-table authority', () => {
  for (const c of CASES) {
    for (const fx of c.cur === 'USD' ? [1] : [c.fx, c.fx * 1.03]) {
      const s = snapshot(c, fx), before = structuredClone(s);
      assert.equal(known(findings(c, fx)[0]), true, c.ticker + ' ' + fx);
      // Annual values pass the hand table unchanged; TYG keeps its separate 2017-packet quarantine flag.
      assert.deepEqual(F.applyFinancialCases(s).snapshot.annual, s.annual);
      assert.deepEqual(s, before);
    }
    assert.equal(F.table.cases.some(x => [x.ticker, ...(x.listingAliases || [])].includes(c.ticker)), false);
  }
  assert.deepEqual(F.table.quarantines.filter(q => CASES.some(c => c.ticker === q.ticker)).map(q => q.caseId),
    ['tyg-stale-2017-packet-20261001'], 'P275 adds no hand-table authority and leaves the TYG hold untouched');
});

test('P275: changed center, either neighbour, currency, year, issuer or field stays NEW', () => {
  for (const c of CASES) {
    for (const mutate of [
      x => { x.nativ.werte[0] += 1000; }, x => { x.nativ.werte[1] -= 1000; }, x => { x.nativ.werte[2] += 1000; },
      x => { x.nativ.waehrung = x.nativ.waehrung === 'USD' ? 'EUR' : 'USD'; }, x => { x.nativ.periode = '2019-12-31'; },
      x => { x.ticker = 'P275-UNRELATED'; }, x => { x.reihe = 'annualOpInc'; },
    ]) {
      const changed = structuredClone(findings(c)[0]); mutate(changed);
      assert.equal(known(changed), false, c.ticker + ' ' + mutate.toString());
    }
  }
});

test('P275: rejected cases are not absorbed (TWE.AX/TSRYF vendor OpInc, PCT.L vendor revenue, KINV calibration)', () => {
  const rejected = ['TWE.AX', 'TSRYF', 'KINV-A.ST', 'KINV-B.ST'];
  assert.equal(B.nativeIdentitaeten.some(e => rejected.includes(e.ticker)), false);
  assert.equal(B.faelle.some(k => /^(TWE\.AX|TSRYF|PCT\.L\|annualRev)\|/.test(k)), false);
  // PCT.L revenue is no printed line and as a two-series form (ratio 1.031) would sit in the Q1-5 gap.
  const pctRev = { ticker: 'PCT.L', reihe: 'annualRev', index: 2, wert: 1118772000 * 1.3261017,
    links: 122389000 * 1.3261017, rechts: -101774000 * 1.3261017,
    nativ: { periode: '2024-04-30', waehrung: 'GBP', werte: [122389000, 1118772000, -101774000] } };
  assert.equal(known(pctRev), false, 'PCT.L revenue stays NEW');
  assert.equal(B.hinweis.includes('Eichluecke 1,0000-1,0375'), true);
  const kinv = { ticker: 'KINV-A.ST', reihe: 'annualRev', index: 2, wert: 94e6, links: 2.3e6, rechts: 0,
    nativ: { periode: '2023-12-31', waehrung: 'SEK', werte: [23e6, 936e6, 0] } };
  assert.equal(known(kinv), false, 'calibration series stays NEW');
});

test('P275: thresholds and age gate unchanged', () => {
  assert.equal(W.FAKTOR, 8);
  assert.equal(W.MIN_BETRAG, 50e6);
  assert.equal(W.parseMaxNeu(undefined), 5);
  assert.equal(W.FAKTOR_GLEICH_TOL, 1.02);
  assert.equal(W.AUSSCHLUSS_MAX_TAGE, 30);
  assert.equal(W.MELDEND_BIS.toISOString(), '2026-10-10T00:00:00.000Z');
});

test('P275: removing any one native authority turns the guard red in memory', () => {
  const files = ['scripts/watch-annual-spikes.js', 'data-health/annual-spikes-baseline.json',
    'configs/financial-known-cases.json', 'lib/financial-known-cases.js'];
  const hashes = () => files.map(f => crypto.createHash('sha256').update(fs.readFileSync(path.resolve(__dirname, '..', f))).digest('hex'));
  const before = hashes();
  const guard = (c, b) => assert.equal(known(findings(c, c.cur === 'USD' ? 1 : c.fx * 1.03)[0], b), true);
  try {
    for (const c of CASES) {
      guard(c, B);
      const without = { ...B, faelle: B.faelle.filter(k => !entryOf(c).some(e => e.schluessel === k)),
        nativeIdentitaeten: B.nativeIdentitaeten.filter(e => !(e.ticker === c.ticker && e.reihe === c.reihe)) };
      assert.throws(() => guard(c, without), assert.AssertionError, c.ticker + ' ' + c.reihe);
    }
    console.log('BREAK-ONCE RED P275: each missing native authority caught');
  } finally { assert.deepEqual(hashes(), before, 'live files stay byte-identical'); }
});

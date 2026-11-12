'use strict';
// Daylauf 16 (12.11.2026): four sourced baseline entries from CI run 42994757810; break-once mutations stay in memory.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const W = require('../scripts/watch-annual-spikes.js');
const B = require('../data-health/annual-spikes-baseline.json');

// Triples as printed in the issuers' 10-K statements of operations (index 0 = newer neighbour), in USD.
const CASES = [
  { ticker: '1CG.DE', twin: 'CRSP', reihe: 'annualRev', end: '2023-12-31', werte: [37314000, 371206000, 1198000], accn: '000095017025017899' },
  { ticker: '788.DE', twin: 'CPNG', reihe: 'annualNetIncome', end: '2023-12-31', werte: [154000000, 1360000000, -92000000], accn: '000183458425000030' },
  { ticker: '7ZD.DE', twin: 'CORZ', reihe: 'annualOpInc', end: '2022-12-31', werte: [8961000, -2109553000, 131494000], accn: '000162828024010682' },
  { ticker: 'WOOF', twin: null, reihe: 'annualNetIncome', end: '2024-01-31', werte: [-101816000, -1280210000, 90801000], accn: '000095017025047693' },
];

const finding = (c, werte = c.werte, currency = 'USD') => {
  const ends = ['2099-12-31', '2098-12-31', '2097-12-31'].map((e, i) => (i === 1 ? c.end : e));
  const s = { meta: { ticker: c.ticker, reportingCurrency: 'USD', reportingCurrencyOriginal: currency, fxConverted: true, fxRateApplied: 1,
    statementPeriods: { [c.reihe]: ends.map(end => ({ end, duration: '12M', currency, unit: 'currency' })) } },
  annual: { [c.reihe]: werte.map(value => ({ value })), [c.reihe + 'Ends']: ends } };
  const [hit] = W.findeAusreisser(s.annual[c.reihe]);
  return { ticker: c.ticker, reihe: c.reihe, periode: null, ...hit, nativ: W.nativeIdentitaet(s, c.reihe, hit.index) };
};
function known(f, b = B) {
  const keys = new Set(b.faelle), native = b.nativeIdentitaeten;
  return W.istBekannt(f, keys, W.fundeJeReihe([f], keys, native), native, [f]);
}
const keyOf = c => `${c.ticker}|${c.reihe}|werte:${c.werte.join('|')}`;

test('Daylauf 16: each entry is the printed triple, carries its source and matches its known twin', () => {
  for (const c of CASES) {
    const f = finding(c);
    assert.equal(W.stabilerSchluessel(f), keyOf(c));
    assert.ok(B.faelle.includes(keyOf(c)), c.ticker);
    const entries = B.nativeIdentitaeten.filter(e => e.ticker === c.ticker && e.reihe === c.reihe);
    assert.equal(entries.length, 1, c.ticker);
    assert.deepEqual(entries[0].nativ, { periode: c.end, waehrung: 'USD', werte: c.werte });
    assert.ok(B.hinweis.includes(c.accn), c.accn);
    if (c.twin) assert.ok(B.faelle.includes(`${c.twin}|${c.reihe}|werte:${c.werte.join('|')}`), `${c.twin} twin`);
    assert.equal(known(f), true, c.ticker);
  }
  assert.ok(B.hinweis.includes('42994757810'));
  assert.equal(B.anzahl, B.faelle.length);
  assert.equal(W.basisGueltig(B, 16423).ok, true);
});

test('Daylauf 16: changed center, either neighbour, currency or issuer stays NEW', () => {
  for (const c of CASES) {
    for (const i of [0, 1, 2]) {
      const werte = [...c.werte]; werte[i] += 1000;
      assert.equal(known(finding(c, werte)), false, `${c.ticker} value ${i}`);
    }
    assert.equal(known(finding(c, c.werte, 'EUR')), false, `${c.ticker} currency`);
    assert.equal(known({ ...finding(c), ticker: 'DL16-UNRELATED' }), false, `${c.ticker} issuer`);
  }
});

test('Daylauf 16: the Banpu wrong fetch and PCT.L revenue are not absorbed', () => {
  assert.equal(B.faelle.some(k => /^(BANPU\.BK|PCT\.L\|annualRev)\|/.test(k)), false);
  assert.equal(B.nativeIdentitaeten.some(e => e.ticker === 'BANPU.BK' || (e.ticker === 'PCT.L' && e.reihe === 'annualRev')), false);
  const banpu = { ticker: 'BANPU.BK', reihe: 'annualOpInc', index: 2, wert: 6003496000, links: -28259000, rechts: 524803000,
    nativ: { periode: '2023-12-31', waehrung: 'USD', werte: [-28259000, 6003496000, 524803000] } };
  assert.equal(known(banpu), false, 'Banpu Power packet under BANPU.BK stays NEW');
});

test('Daylauf 16: removing one authority turns the guard red in memory, live files stay byte-identical', () => {
  const files = ['scripts/watch-annual-spikes.js', 'data-health/annual-spikes-baseline.json'];
  const hashes = () => files.map(f => crypto.createHash('sha256').update(fs.readFileSync(path.resolve(__dirname, '..', f))).digest('hex'));
  const before = hashes();
  try {
    for (const c of CASES) {
      const without = { ...B, faelle: B.faelle.filter(k => k !== keyOf(c)),
        nativeIdentitaeten: B.nativeIdentitaeten.filter(e => !(e.ticker === c.ticker && e.reihe === c.reihe)) };
      assert.equal(known(finding(c), without), false, c.ticker);
    }
    console.log('BREAK-ONCE RED Daylauf 16: each missing authority caught');
  } finally { assert.deepEqual(hashes(), before, 'live files stay byte-identical'); }
});

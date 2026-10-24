'use strict';
// Run: node tests/watch-annual-spikes-index0.test.js
//
// WHY (Daylauf 7, 24.10.2026; spike-watcher coverage audit 22.10., item 3): findeAusreisser only
// judges inner positions, so the NEWEST annual value (index 0), where a fresh bad vendor value
// lands, was never checked, and annualGP was not scanned at all. findeNeuestenAusreisser adds a
// one-sided check of index 0 against index 1 (same FAKTOR 8 and MIN_BETRAG 50e6).
// Break-once evidence (24.10., mutated copies only, live sha256 unchanged): index-0 call removed
// from scanSnapshots, annualGP removed from REIHEN, JA-2 back on REIHEN.length, Q1 founding-series
// filter removed, inner-spike skip removed, collapse without the both-positive condition, jump
// branch disabled -> each turned at least one test here red; the unmutated copy stayed green.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const W = require('../scripts/watch-annual-spikes.js');

const series = (values) => values.map((value) => (value === null ? null : { value }));

test('the brief fixture: annualRev [4.0e11, 4.6e8, 4.2e8] flags index 0', () => {
  assert.deepEqual(W.findeNeuestenAusreisser(series([4.0e11, 4.6e8, 4.2e8])),
    [{ index: 0, wert: 4.0e11, links: null, rechts: 4.6e8 }]);
});

test('counter fixture: a normal newest year [4.6e8, 4.2e8, 4.0e8] is not flagged', () => {
  assert.deepEqual(W.findeNeuestenAusreisser(series([4.6e8, 4.2e8, 4.0e8])), []);
});

test('a company doubling or halving is not flagged, factor 8 is', () => {
  assert.deepEqual(W.findeNeuestenAusreisser(series([9.2e8, 4.6e8])), [], 'doubling');
  assert.deepEqual(W.findeNeuestenAusreisser(series([2.3e8, 4.6e8])), [], 'halving');
  assert.equal(W.findeNeuestenAusreisser(series([8 * 4.6e8, 4.6e8])).length, 1, 'exactly 8x up');
  assert.equal(W.findeNeuestenAusreisser(series([7.9 * 4.6e8, 4.6e8])).length, 0, '7.9x up');
});

test('collapse: previous year at least 8x the newest, both positive, is flagged', () => {
  assert.deepEqual(W.findeNeuestenAusreisser(series([57.5e6, 518.1e6, 500e6])),
    [{ index: 0, wert: 57.5e6, links: null, rechts: 518.1e6 }]);
  assert.deepEqual(W.findeNeuestenAusreisser(series([65e6, 518.1e6, 500e6])), [], '7.97x down');
});

test('a loss year or a shrinking loss never counts as a collapse', () => {
  assert.deepEqual(W.findeNeuestenAusreisser(series([-50e6, 800e6])), [], 'newest is a loss year');
  assert.deepEqual(W.findeNeuestenAusreisser(series([-50e6, -800e6])), [], 'shrinking loss');
  assert.deepEqual(W.findeNeuestenAusreisser(series([50e6, -800e6])), [], 'turnaround after a big loss');
});

test('small amounts, zeros and gaps produce no finding', () => {
  assert.deepEqual(W.findeNeuestenAusreisser(series([40e6, 4e6])), [], 'jump below MIN_BETRAG');
  assert.deepEqual(W.findeNeuestenAusreisser(series([4e6, 40e6])), [], 'collapse below MIN_BETRAG');
  assert.deepEqual(W.findeNeuestenAusreisser(series([0, 4.6e8])), [], 'zero newest has no ratio');
  assert.deepEqual(W.findeNeuestenAusreisser(series([4.6e8, 0])), [], 'zero previous has no ratio');
  assert.deepEqual(W.findeNeuestenAusreisser(series([null, 4.6e8])), []);
  assert.deepEqual(W.findeNeuestenAusreisser(series([4.0e11])), [], 'no previous year');
  assert.deepEqual(W.findeNeuestenAusreisser([]), []);
  assert.deepEqual(W.findeNeuestenAusreisser(null), []);
});

test('an inner spike at index 1 is not reported a second time as an index-0 collapse', () => {
  const r = series([100e6, 1000e6, 100e6]);
  assert.equal(W.findeAusreisser(r).length, 1, 'the inner rule owns this anomaly');
  assert.deepEqual(W.findeNeuestenAusreisser(r), []);
});

test('scanSnapshots: an index-0 spike reaches the findings, for annualRev and for annualGP', () => {
  assert.ok(W.REIHEN.includes('annualGP'), 'annualGP is scanned');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'annual-spikes-index0-'));
  try {
    const ends = ['2026-06-30', '2025-06-30', '2024-06-30'];
    fs.writeFileSync(path.join(dir, 'REV0.json'), JSON.stringify({ meta: { ticker: 'REV0' }, annual: {
      annualRev: series([4.0e11, 4.6e8, 4.2e8]), annualRevEnds: ends } }));
    fs.writeFileSync(path.join(dir, 'GP0.json'), JSON.stringify({ meta: { ticker: 'GP0' }, annual: {
      annualGP: series([4.0e11, 4.6e8, 4.2e8]), annualGPEnds: ends } }));
    fs.writeFileSync(path.join(dir, 'CLEAN.json'), JSON.stringify({ meta: { ticker: 'CLEAN' }, annual: {
      annualRev: series([4.6e8, 4.2e8, 4.0e8]), annualGP: series([2.3e8, 2.1e8, 2.0e8]) } }));
    const { funde } = W.scanSnapshots(dir);
    const hits = funde.map((x) => `${x.ticker}|${x.reihe}|${x.index}`).sort();
    assert.deepEqual(hits, ['GP0|annualGP|0', 'REV0|annualRev|0']);
    const rev = funde.find((x) => x.ticker === 'REV0');
    assert.equal(rev.links, null);
    assert.equal(rev.rechts, 4.6e8);
    assert.equal(rev.nativ, null, 'index 0 has no three-value native identity');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('JA-2 and Q1 stay on the three founding series when annualGP joins REIHEN', () => {
  const f = (reihe) => ({ ticker: 'CI', reihe, index: 0, wert: 4.0e11, links: null, rechts: 4.6e8 });
  const drei = ['annualOpInc', 'annualRev', 'annualNetIncome'].map(f);
  assert.deepEqual(W.GRUND_REIHEN, ['annualOpInc', 'annualRev', 'annualNetIncome']);
  assert.deepEqual(W.cignaFaelle(drei), ['CI|0'], 'three founding series without GP are the Cigna form');
  assert.deepEqual(W.cignaFaelle([...drei, f('annualGP')]), ['CI|0']);
  assert.deepEqual(W.cignaFaelle([f('annualOpInc'), f('annualRev'), f('annualGP')]), [],
    'GP does not replace a missing founding series');
  assert.deepEqual(W.faktorGleicheFaelle([f('annualOpInc'), f('annualRev'), f('annualGP')]).zweiVonDrei, ['CI|0'],
    'a third GP hit does not move a 2-of-3 form out of Q1');
});

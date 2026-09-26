// tests/annual-spikes-meldend-ablauf.test.js — standalone runner (no framework).
// Run: node tests/annual-spikes-meldend-ablauf.test.js
//
// WHY (D1(c), 26.09.2026): the Q1 gate and the budget gate of watch-annual-spikes.js report
// (::warning::, no exit 1) until MELDEND_BIS and turn hard again on their own afterwards.
// Pinned here on both sides of the expiry, with an INJECTED clock (main's jetzt parameter) —
// never the wall clock: a fixed date against the wall clock is a time bomb in this repo.
// Break-once evidence (26.09.): comparison inverted -> M1/M2/M3 red; expiry shifted to
// 2026-10-11 -> M0-M3 red; JA-2 demoted to a warning -> M5 red; `!== null` instead of
// `instanceof Date` -> M4 red (crash on a numeric expiry); restored -> green.
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const W = require('../scripts/watch-annual-spikes.js');

let fail = 0;
function check(name, fn) {
  try { fn(); console.log('  ok   ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + ': ' + (e && e.message || e)); }
}

// One ticker, Rev and OpInc jump by the same factor at the same index: fires Q1, and with
// ANNUAL_SPIKE_MAX_NEU=0 its one event also exceeds the budget. NetIncome absent, so no JA-2.
const SNAP = { meta: { ticker: 'AAA' }, annual: {
  annualRev: [{ value: 100e6 }, { value: 1000e6 }, { value: 100e6 }],
  annualOpInc: [{ value: 60e6 }, { value: 600e6 }, { value: 60e6 }],
} };
const BASE = { faelle: [], snapshotsBeiAufnahme: 1, ausgeschlossen: [] };

function lauf(jetzt, meldendBis, snap = SNAP) {
  const o = { e: fs.existsSync, r: fs.readdirSync, f: fs.readFileSync, l: console.log, x: console.error,
    a: process.argv, v: process.env.ANNUAL_SPIKE_MAX_NEU };
  const out = [], err = [];
  fs.existsSync = () => true;
  fs.readdirSync = () => ['AAA.json'];
  fs.readFileSync = (file) => {
    const name = path.basename(String(file));
    if (name === 'AAA.json') return JSON.stringify(snap);
    if (name === 'annual-spikes-baseline.json') return JSON.stringify(BASE);
    throw new Error('unexpected read: ' + file);
  };
  console.log = (...a) => out.push(a.join(' '));
  console.error = (...a) => err.push(a.join(' '));
  process.argv = o.a.filter((x) => x !== '--neu-aufnehmen');
  process.env.ANNUAL_SPIKE_MAX_NEU = '0';
  try { return { code: W.main(jetzt, meldendBis), out, err }; }
  finally {
    fs.existsSync = o.e; fs.readdirSync = o.r; fs.readFileSync = o.f;
    console.log = o.l; console.error = o.x; process.argv = o.a;
    if (o.v === undefined) delete process.env.ANNUAL_SPIKE_MAX_NEU; else process.env.ANNUAL_SPIKE_MAX_NEU = o.v;
  }
}
const MARK = '::warning::[meldend bis 2026-10-10] ';
const Q1 = /Ticker mit ZWEI Jahresreihen am selben Index/;
const BUDGET = /NEUE Jahres-Ausreisser-EREIGNISSE \(erlaubt 0\)/;

check('M0: the expiry is 2026-10-10 00:00 UTC', () => {
  assert.strictEqual(W.MELDEND_BIS.toISOString(), '2026-10-10T00:00:00.000Z');
});

const vor = lauf(new Date('2026-10-09T23:59:59Z'), W.MELDEND_BIS);
const ab = lauf(new Date('2026-10-10T00:00:00Z'), W.MELDEND_BIS);

check('M1: 2026-10-09 -> both gates ::warning:: with the marker, exit 0, no ::error::', () => {
  assert.strictEqual(vor.code, 0);
  assert.deepStrictEqual(vor.err, []);
  const w = vor.out.filter((z) => z.startsWith(MARK));
  assert.strictEqual(w.length, 2, w.join('\n'));
  assert.ok(Q1.test(w[0]) && BUDGET.test(w[1]), w.join('\n'));
});
check('M2: 2026-10-10 -> both gates ::error::, exit 1, no marker', () => {
  assert.strictEqual(ab.code, 1);
  assert.strictEqual(ab.err.length, 2, ab.err.join('\n'));
  assert.ok(ab.err[0].startsWith('::error::') && Q1.test(ab.err[0]), ab.err[0]);
  assert.ok(ab.err[1].startsWith('::error::') && BUDGET.test(ab.err[1]), ab.err[1]);
  assert.ok(!ab.out.some((z) => z.includes('meldend bis')));
});
check('M3: the warning carries the same text as the error', () => {
  const w = vor.out.filter((z) => z.startsWith(MARK)).map((z) => z.slice(MARK.length));
  assert.strictEqual(w.length, 2, 'no vacuous match on two empty lists');
  assert.deepStrictEqual(w, ab.err.map((z) => z.slice('::error::'.length)));
});
check('M4: main() without a Date expiry stays hard before the date (every other caller)', () => {
  const r = lauf(new Date('2026-10-09T23:59:59Z'));
  assert.strictEqual(r.code, 1);
  assert.strictEqual(r.err.length, 2);
  assert.strictEqual(lauf(new Date('2026-10-09T23:59:59Z'), Infinity).code, 1, 'a non-Date expiry is hard, not a crash');
});
check('M5: inside the window every OTHER gate stays hard (JA-2 Cigna form -> exit 1)', () => {
  const cigna = { meta: { ticker: 'AAA' }, annual: { ...SNAP.annual,
    annualNetIncome: [{ value: 55e6 }, { value: 700e6 }, { value: 55e6 }] } };
  const r = lauf(new Date('2026-10-09T23:59:59Z'), W.MELDEND_BIS, cigna);
  assert.strictEqual(r.code, 1);
  assert.strictEqual(r.err.length, 1, r.err.join('\n'));
  assert.ok(r.err[0].startsWith('::error::1 Ticker mit ALLEN 3 Jahresreihen'), r.err[0]);
  assert.ok(r.out.some((z) => z.startsWith(MARK) && BUDGET.test(z)), 'budget still reports in the window');
});

if (fail) { console.log('\nFAIL: annual-spikes-meldend-ablauf (' + fail + ')'); process.exit(1); }
console.log('\nOK: annual-spikes-meldend-ablauf (D1(c), expiry 2026-10-10)');

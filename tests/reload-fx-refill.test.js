'use strict';
// tests/reload-fx-refill.test.js — standalone runner (node tests/reload-fx-refill.test.js, exit 0/1).
// Class R (23.11.2026): a stale-quarter reload of a non-USD reporter was rejected as "shared-period fundamentals
// missing" whenever Yahoo left one old cell empty, because preserveReloadHistory refilled only at an identical FX
// rate. Real record: ISAE3.SA of 21.11.2026 (tests/fixtures/reload-fx-refill-isae3.json); the candidate is that
// record at the rate of 23.11.2026 with opIncQ 2025-06-30 empty, as Yahoo returned it that day.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { Module, createRequire } = require('node:module');
const H = require('../lib/reload-history.js');
const F = require('./fixtures/reload-fx-refill-isae3.json');

const ROOT = path.resolve(__dirname, '..'), LIB = path.join(ROOT, 'lib', 'reload-history.js');
const sha = () => crypto.createHash('sha256').update(fs.readFileSync(LIB)).digest('hex');
const liveBefore = sha();
const clone = x => structuredClone(x), v = r => typeof r === 'number' ? r : r?.value;
const FX_NEW = 0.16810113, END = '2025-06-30';
let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); } catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + (e && e.stack || e)); }
}
function libCopy(oldLine, newLine) {
  const src = fs.readFileSync(LIB, 'utf8'), lines = src.split(/\r?\n/);
  assert.equal(lines.filter(l => l === oldLine).length, 1, 'Exact whole-line mutation anchor: ' + oldLine);
  const m = new Module(LIB, module); m.filename = LIB; m.paths = module.paths; m.require = createRequire(LIB);
  m._compile(lines.map(l => l === oldLine ? newLine : l).join('\n'), LIB);
  return m.exports;
}
// The record at the new rate: same BRL values, USD = BRL x new rate; Yahoo's empty cell as null.
function candidate(prior, { emptyField = 'opIncQ', marker = null } = {}) {
  const next = clone(prior), r = FX_NEW / prior.meta.fxRateApplied;
  next.meta.fxRateApplied = FX_NEW;
  for (const f of ['revenueQ', 'opIncQ', 'grossProfitQ', 'netIncomeQ'])
    next.timeseries[f] = next.timeseries[f].map(c => c === null ? null : typeof c === 'number' ? c * r : { ...c, value: v(c) * r });
  const k = next.timeseries.opIncQEnds.indexOf(END);
  next.timeseries[emptyField][k] = null;
  if (marker) prior.timeseries[emptyField][k] = { ...prior.timeseries[emptyField][k], ...marker };
  return next;
}
const prior = () => clone(F.snapshot);

test('ISAE3.SA: the empty opIncQ 2025-06-30 is restored from BRL at the new rate; the reload is no longer thinner', () => {
  const p = prior(), next = candidate(p), k = p.timeseries.opIncQEnds.indexOf(END);
  assert.equal(H.historyIsThinner(next, p), true, 'before the refill the candidate is thinner (the 21.11. rejection)');
  H.preserveReloadHistory(next, p);
  const brl = v(p.timeseries.opIncQ[k]) / p.meta.fxRateApplied;
  assert.ok(Math.abs(v(next.timeseries.opIncQ[k]) - brl * FX_NEW) <= 1e-6, 'BRL value at the new rate');
  assert.notEqual(v(next.timeseries.opIncQ[k]), v(p.timeseries.opIncQ[k]), 'not the USD value at the old rate');
  const kept = next.meta.reloadHistoryRetained.find(r => r.field === 'opIncQ' && r.end === END);
  assert.deepEqual(kept.fxRescaled, { from: p.meta.fxRateApplied, to: FX_NEW });
  assert.equal(H.historyIsThinner(next, p), false);
  // T1: one rate per record, so the margin and growth from that cell are what BRL gives.
  const i0 = next.timeseries.revenueQEnds.indexOf(END), rev = v(next.timeseries.revenueQ[i0]) / FX_NEW;
  assert.ok(Math.abs(v(next.timeseries.opIncQ[k]) / FX_NEW / rev - brl / (v(p.timeseries.revenueQ[i0]) / p.meta.fxRateApplied)) < 1e-12);
});
test('the same rate keeps the old path: refill unchanged and without a rate note', () => {
  const p = prior(), next = clone(p), k = p.timeseries.opIncQEnds.indexOf(END);
  next.timeseries.opIncQ[k] = null;
  H.preserveReloadHistory(next, p);
  assert.equal(v(next.timeseries.opIncQ[k]), v(p.timeseries.opIncQ[k]));
  assert.equal(next.meta.reloadHistoryRetained.find(r => r.field === 'opIncQ').fxRescaled, undefined);
});
test('review 23.11. M1: a record of the statement-currency hand table keeps the identical-rate rule (no refill at a new rate)', () => {
  for (const side of ['prior', 'next']) {
    const p = prior(), next = candidate(p), k = p.timeseries.opIncQEnds.indexOf(END);
    (side === 'prior' ? p : next).meta.statementCurrencyOriginal = 'BRL';
    H.preserveReloadHistory(next, p);
    assert.equal(next.timeseries.opIncQ[k], null, side);
    assert.ok(next.meta.reloadHistoryGaps.some(g => g.field === 'opIncQ' && g.end === END && g.reason === 'statement-basis-unverified'), side);
  }
});
test('no refill at a new rate: other original currency, a sibling revised in BRL, a cell with a marker', () => {
  const ccy = prior(), n1 = candidate(ccy); n1.meta.reportingCurrencyOriginal = 'EUR';
  H.preserveReloadHistory(n1, ccy);
  assert.equal(n1.timeseries.opIncQ[n1.timeseries.opIncQEnds.indexOf(END)], null, 'other currency');
  const rev = prior(), n2 = candidate(rev), i = n2.timeseries.revenueQEnds.indexOf(END);
  n2.timeseries.revenueQ[i] = { value: v(n2.timeseries.revenueQ[i]) * 1.01 };
  H.preserveReloadHistory(n2, rev);
  assert.equal(n2.timeseries.opIncQ[n2.timeseries.opIncQEnds.indexOf(END)], null, 'revenue of that quarter revised by 1 % in BRL');
  assert.ok(n2.meta.reloadHistoryGaps.some(g => g.field === 'opIncQ' && g.end === END && g.reason === 'period-revised'));
  const mk = prior(), n3 = candidate(mk, { marker: { financialCorrection: { source: 'hand-table' } } });
  H.preserveReloadHistory(n3, mk);
  assert.equal(n3.timeseries.opIncQ[n3.timeseries.opIncQEnds.indexOf(END)], null, 'marked cell needs the identical rate');
  assert.ok(n3.meta.reloadHistoryGaps.some(g => g.field === 'opIncQ' && g.reason === 'statement-basis-unverified'));
});
test('break once: without the rate factor, or without the native comparison, the checks turn red', () => {
  const ok = lib => { const p = prior(), next = candidate(p), k = p.timeseries.opIncQEnds.indexOf(END);
    lib.preserveReloadHistory(next, p);
    assert.ok(Math.abs(v(next.timeseries.opIncQ[k]) - v(p.timeseries.opIncQ[k]) / p.meta.fxRateApplied * FX_NEW) <= 1e-6, 'rate factor'); };
  ok(H);
  assert.throws(() => ok(libCopy("  const atNewRate = v => typeof v === 'number' ? v * rescale : { value: v.value * rescale };",
    "  const atNewRate = v => typeof v === 'number' ? v : { value: v.value };")), /rate factor/);
  assert.throws(() => ok(libCopy("        const differs = (k, a, b) => fxPrior !== fxNext && rescale !== null && MONEY.has(k) ? !sameNative(a, b) : a !== b;",
    "        const differs = (k, a, b) => a !== b;")), /rate factor/);
});
// Before/after of 23.11.2026 found LOG.MC: Yahoo switched the revenue line and left FY2025 empty; the stored FY2025 of the old
// line must not be restored into the new series (it produced +664.9 % growth).
test('LOG.MC: a series on another line at the shared years restores nothing, the empty year stays a gap', () => {
  const L = require('./fixtures/reload-fx-refill-logmc.json'), p = clone(L.snapshot), next = clone(p);
  next.meta.fxRateApplied = L.fx20261123;
  const ends = Object.keys(L.yahoo20261123).sort().reverse();
  next.annual.annualRevEnds = ends.slice();
  next.annual.annualRev = ends.map(e => L.yahoo20261123[e] === null ? null : { value: L.yahoo20261123[e] * 1e6 * L.fx20261123 });
  next.meta.statementPeriods = { annualRev: ends.map(e => ({ end: e, duration: '12M', currency: 'EUR', unit: 'currency', basis: 'yahoo-statement' })) };
  H.preserveReloadHistory(next, p);
  assert.equal(next.annual.annualRev[ends.indexOf('2025-09-30')], null, 'old-line FY2025 not restored');
  assert.ok(next.meta.reloadHistoryGaps.some(g => g.field === 'annualRev' && g.end === '2025-09-30' && g.reason === 'statement-basis-unverified'));
});
test('break once: without the series check, the LOG.MC year is restored and the check turns red', () => {
  const L = require('./fixtures/reload-fx-refill-logmc.json');
  const run = lib => { const p = clone(L.snapshot), next = clone(p); next.meta.fxRateApplied = L.fx20261123;
    const ends = Object.keys(L.yahoo20261123).sort().reverse(); next.annual.annualRevEnds = ends.slice();
    next.annual.annualRev = ends.map(e => L.yahoo20261123[e] === null ? null : { value: L.yahoo20261123[e] * 1e6 * L.fx20261123 });
    next.meta.statementPeriods = { annualRev: ends.map(e => ({ end: e, duration: '12M', currency: 'EUR', unit: 'currency', basis: 'yahoo-statement' })) };
    lib.preserveReloadHistory(next, p); assert.equal(next.annual.annualRev[1], null, 'series check'); };
  run(H);
  assert.throws(() => run(libCopy("  const basisOK = seriesBasisAgrees(next, previous, rescale);", "  const basisOK = () => true;")), /series check/);
});
test('live module unchanged by this test run', () => assert.equal(sha(), liveBefore));

console.log(`reload-fx-refill: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

'use strict';
// tests/reload-keep-yago.test.js — standalone runner (node tests/reload-keep-yago.test.js, exit 0/1).
// Class R (A) + diagnosis 5a (23.11.2026): Yahoo's quarterly window slid forward (Q3 2026 in, Q1 and Q2 2025 out), and
// historyIsThinner rejected the whole reload ("more periods dropped than added"). Real record: COFORGE.BO of 21.11.2026;
// the candidate carries the revenue window Yahoo returned on 23.11.2026 (tests/fixtures/reload-keep-yago-coforge.json).
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { Module, createRequire } = require('node:module');
const H = require('../lib/reload-history.js');
const F = require('./fixtures/reload-keep-yago-coforge.json');

const LIB = path.join(path.resolve(__dirname, '..'), 'lib', 'reload-history.js');
const sha = () => crypto.createHash('sha256').update(fs.readFileSync(LIB)).digest('hex');
const liveBefore = sha();
const clone = x => structuredClone(x), v = r => typeof r === 'number' ? r : r?.value;
const Q = ['revenueQ', 'opIncQ', 'grossProfitQ', 'netIncomeQ'];
let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); } catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + (e && e.stack || e)); }
}
function libCopy(oldLine, newLine) {
  const lines = fs.readFileSync(LIB, 'utf8').split(/\r?\n/);
  assert.equal(lines.filter(l => l === oldLine).length, 1, 'Exact whole-line mutation anchor: ' + oldLine);
  const m = new Module(LIB, module); m.filename = LIB; m.paths = module.paths; m.require = createRequire(LIB);
  m._compile(lines.map(l => l === oldLine ? newLine : l).join('\n'), LIB);
  return m.exports;
}
const prior = () => clone(F.snapshot);
// Yahoo's window of 23.11.2026: revenue in million INR at the stored rate (or `fx`); siblings keep the stored value
// where the period is shared, null where it is new.
function candidate(p, fx = p.meta.fxRateApplied) {
  const ends = Object.keys(F.yahoo20261123).sort().reverse(), next = clone(p);
  next.meta.fxRateApplied = fx;
  const r = fx / p.meta.fxRateApplied;
  const shared = (f, e) => { const pe = p.timeseries[f + 'Ends'] || p.timeseries.revenueQEnds, i = pe.indexOf(e);
    return i >= 0 && v(p.timeseries[f][i]) != null ? { value: v(p.timeseries[f][i]) * r } : null; };
  next.timeseries.revenueQ = ends.map(e => ({ value: F.yahoo20261123[e] * 1e6 * fx }));
  for (const f of ['opIncQ', 'grossProfitQ', 'netIncomeQ']) next.timeseries[f] = ends.map(e => shared(f, e));
  for (const f of ['revenueQ', 'opIncQ', 'grossProfitQ']) next.timeseries[f + 'Ends'] = ends.slice();
  for (const f of Q) next.meta.statementPeriods[f] = ends.map(e => ({ end: e, duration: '3M', currency: 'INR', unit: 'currency', basis: 'yahoo-statement', fetchedAt: '2026-11-23T07:07:27.000Z' }));
  return next;
}
const at = (s, f, e) => v(s.timeseries[f][(s.timeseries[f + 'Ends'] || s.timeseries.revenueQEnds).indexOf(e)]);

test('COFORGE.BO: Q2 and Q1 2025 slid out of the window are kept; the reload is no longer thinner; Q3 2026 has its year-ago pair', () => {
  const p = prior(), next = candidate(p);
  assert.equal(H.historyIsThinner(next, p), true, 'before: the 21.11. rejection');
  const window = clone(next.timeseries.revenueQ);
  H.preserveReloadHistory(next, p);
  assert.deepEqual(next.timeseries.revenueQEnds, ['2026-09-30', '2026-06-30', '2026-03-31', '2025-12-31', '2025-09-30', '2025-06-30', '2025-03-31']);
  assert.deepEqual(next.timeseries.revenueQ.slice(0, 5), window, 'the window itself is untouched');
  for (const f of Q) {
    assert.equal(next.timeseries[f].length, 7, f + ' aligned');
    if (next.timeseries[f + 'Ends']) assert.deepEqual(next.timeseries[f + 'Ends'], next.timeseries.revenueQEnds, f + ' ends');
    assert.equal(next.meta.statementPeriods[f].length, 7, f + ' statement periods');
    for (const e of ['2025-06-30', '2025-03-31']) assert.equal(at(next, f, e), at(p, f, e), f + ' ' + e + ' kept from the stored record');
  }
  assert.ok(next.meta.reloadHistoryRetained.some(r => r.field === 'revenueQ' && r.end === '2025-06-30' && r.outsideNewWindow));
  assert.ok(!(next.meta.reloadHistoryGaps || []).some(g => g.reason === 'outside-new-periods' && ['2025-06-30', '2025-03-31'].includes(g.end)));
  assert.equal(H.historyIsThinner(next, p), false, 'after: accepted');
  const g = at(next, 'revenueQ', '2026-09-30') / at(next, 'revenueQ', '2025-09-30') - 1;
  assert.ok(Math.abs(g * 100 - (61708 / 40164 - 1) * 100) < 1e-9, 'Q3 2026 against Q3 2025 from the same window');
});
test('only year-ago partners are kept: a stored quarter that pairs with no window quarter is dropped as before', () => {
  const p = prior();
  for (const f of Q) { p.timeseries[f] = [...p.timeseries[f], { value: 1 }]; if (p.timeseries[f + 'Ends']) p.timeseries[f + 'Ends'] = [...p.timeseries[f + 'Ends'], '2024-06-30'];
    p.meta.statementPeriods[f] = [...p.meta.statementPeriods[f], { end: '2024-06-30', duration: '3M', currency: 'INR', unit: 'currency', basis: 'yahoo-statement' }]; }
  p.timeseries.revenueQEnds = p.timeseries.revenueQEnds.slice(); // revenueQEnds already extended above
  const next = candidate(p); H.preserveReloadHistory(next, p);
  assert.ok(!next.timeseries.revenueQEnds.includes('2024-06-30'));
  assert.equal(next.timeseries.revenueQEnds.at(-1), '2025-03-31');
});
test('a new FX rate restores the kept quarters from INR at the new rate; another original currency keeps nothing', () => {
  const p = prior(), fx = p.meta.fxRateApplied * 0.97, next = candidate(p, fx);
  H.preserveReloadHistory(next, p);
  const inr = at(p, 'revenueQ', '2025-06-30') / p.meta.fxRateApplied;
  assert.ok(Math.abs(at(next, 'revenueQ', '2025-06-30') - inr * fx) <= 1e-6);
  assert.deepEqual(next.meta.reloadHistoryRetained.find(r => r.field === 'revenueQ' && r.end === '2025-06-30').fxRescaled, { from: p.meta.fxRateApplied, to: fx });
  const q = prior(), other = candidate(q); other.meta.reportingCurrencyOriginal = 'EUR';
  H.preserveReloadHistory(other, q);
  assert.equal(other.timeseries.revenueQEnds.at(-1), '2025-09-30');
});
test('break once: without the partner filter or without moving sibling ends, the checks turn red', () => {
  const partner = lib => { const p = prior();
    for (const f of Q) { p.timeseries[f] = [...p.timeseries[f], { value: 1 }]; if (p.timeseries[f + 'Ends']) p.timeseries[f + 'Ends'] = [...p.timeseries[f + 'Ends'], '2024-06-30'];
      p.meta.statementPeriods[f] = [...p.meta.statementPeriods[f], { end: '2024-06-30', duration: '3M', currency: 'INR', unit: 'currency', basis: 'yahoo-statement' }]; }
    const next = candidate(p); lib.preserveReloadHistory(next, p);
    assert.ok(!next.timeseries.revenueQEnds.includes('2024-06-30'), 'partners only'); };
  partner(H);
  assert.throws(() => partner(libCopy("  const slid = [...new Set(pts.revenueQEnds.filter(e => day(e) && e < oldest && partners.has(e)))].sort().reverse();",
    "  const slid = [...new Set(pts.revenueQEnds.filter(e => day(e) && e < oldest))].sort().reverse();")), /partners only/);
  const sib = lib => { const p = prior(), next = candidate(p); lib.preserveReloadHistory(next, p);
    assert.deepEqual(next.timeseries.grossProfitQEnds, next.timeseries.revenueQEnds, 'sibling ends move with revenue'); };
  sib(H);
  assert.throws(() => sib(libCopy("      if (Array.isArray(nts[field + 'Ends'])) nts[field + 'Ends'] = [...nts[field + 'Ends'], end];",
    "      if (field === 'revenueQ') nts[field + 'Ends'] = [...nts[field + 'Ends'], end];")), /sibling ends move with revenue/);
});
test('live module unchanged by this test run', () => assert.equal(sha(), liveBefore));

console.log(`reload-keep-yago: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

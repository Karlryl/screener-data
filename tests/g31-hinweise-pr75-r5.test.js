'use strict';
// PR #75 round 5: checked hints for the pairs the board shows after the exchange fill and the older-pair walk.
// Real packets of the daily run of 31.10.2026; every red probe stays in memory.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { Module, createRequire } = require('node:module');
const X = require('../lib/exchange-quarter-check.js');
const G = require('../lib/g31-recency.js');
const F = require('./fixtures/g31-hinweise-pr75-r5.json');
const table = require('../configs/g31-hinweise.json');

const root = path.resolve(__dirname, '..');
const live = ['lib/g31-recency.js', 'configs/g31-hinweise.json'];
const hashes = () => live.map(f => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, f))).digest('hex'));
const before = hashes();
const context = () => ({ stores: F.store, baseline: { date: F.baseline.date, rows: new Map(Object.entries(F.baseline.rows)) }, warnings: [] });
const withStore = fn => {
  const keep = X.defaultContext;
  X.defaultContext = context;
  try { return fn(); } finally { X.defaultContext = keep; }
};
// The production fill, not a hand-made row: the insertion path of the daily run on the real store and baseline.
const prepared = t => X.applyExchangeCheck(structuredClone(F.snapshots[t]), { mode: 'fill-only', context: context() }).snapshot;
const row = (t, end) => table.entries.find(e => e.ticker === t && e.periodEnd === end);
// A copy of the hint module on another table; loadHinweisTable and its callers stay the production code.
function g31With(entries) {
  const file = path.join(root, 'lib', 'g31-recency.js'), m = new Module(file, module), real = createRequire(file);
  m.filename = file; m.paths = module.paths;
  m.require = id => id === '../configs/g31-hinweise.json' ? { ...table, entries } : real(id);
  m._compile(fs.readFileSync(file, 'utf8'), file);
  return m.exports;
}

test('603991.SS: the September quarter carries the source-checked AAMI hint, the June row is bound to June and lapses', () => withStore(() => {
  const s = prepared('603991.SS'), v = G.g31Shadow(s).v1;
  assert.deepEqual([v.basis, v.sourcePeriodEnd, v.sourcePriorPeriodEnd], ['quarter', '2026-09-30', '2025-09-30']);
  assert.ok(Math.abs(v.pct - 2331.85) < 0.005, 'filed rate 2,331.85 %, got ' + v.pct);
  const h = G.g31Hinweis(s);
  assert.equal(h.code, 'uebernahme');
  assert.equal(h.reason, row('603991.SS', '2026-09-30').reason);
  assert.match(h.reason, /AAMI/); assert.match(h.reason, /30\.09\.2026/); assert.match(h.reason, /2\.331,85 %/);
  assert.ok(!h.reason.includes(row('603991.SS', '2026-06-30').reason), 'the June wording is not reused');

  // Absent: without the September row the same packet shows no checked AAMI hint, so this guard goes red on removal.
  const noSeptember = g31With(table.entries.filter(e => !(e.ticker === '603991.SS' && e.periodEnd === '2026-09-30')));
  assert.equal((noSeptember.g31Hinweis(s)?.reason || '').includes('AAMI'), false);
  // Bound to the listing: an identical packet under another ticker gets nothing from this row.
  const other = structuredClone(s); other.meta.ticker = '603991.SSX';
  assert.equal((G.g31Hinweis(other)?.reason || '').includes('AAMI'), false);
}));

test('DNO.OL, ETERNAL.BO, ETERNAL.NS and 002077.SZ keep the checked hint on the shown June pair, with the older-pair label', () => withStore(() => {
  const want = { 'DNO.OL': ['uebernahme', 194.77, /Sval/], 'ETERNAL.BO': ['bilanzierungswechsel', 182, /Warenbestand/],
    'ETERNAL.NS': ['bilanzierungswechsel', 182, /Warenbestand/], '002077.SZ': ['uebernahme', 35.43, /艾科集成/] };
  for (const [t, [code, pct, text]] of Object.entries(want)) {
    const s = prepared(t), v = G.g31Shadow(s).v1;
    assert.deepEqual([v.basis, v.sourcePeriodEnd, v.sourcePriorPeriodEnd], ['quarter', '2026-06-30', '2025-06-30'], t);
    assert.ok(Math.abs(v.pct - pct) < 0.005, `${t} ${v.pct}`);
    const h = G.g31Hinweis(s), checked = row(t, '2026-06-30');
    assert.equal(h.code, code, t);
    assert.match(h.reason, text, t);
    assert.ok(h.reason.startsWith(checked.reason + ' '), t + ' keeps the checked wording first');
    assert.match(h.reason, /neuere gespeicherte Quartal bis 30\.09\.2026/, t);
    const without = g31With(table.entries.filter(e => e !== checked));
    assert.equal(without.g31Hinweis(s).code, 'aelteres-quartalspaar', t + ' red without the row');
  }
}));

test('hint rows of this round: exact pairs, https sources with page and quote, dated check; the new code is admitted, others are not', () => {
  const own = table.entries.filter(e => /Geprüft am 31\.10\.2026\.$/.test(e.reason));
  assert.deepEqual(own.map(e => [e.ticker, e.periodEnd, e.priorPeriodEnd, e.code]), [
    ['603991.SS', '2026-09-30', '2025-09-30', 'uebernahme'], ['DNO.OL', '2026-06-30', '2025-06-30', 'uebernahme'],
    ['ETERNAL.BO', '2026-06-30', '2025-06-30', 'bilanzierungswechsel'], ['ETERNAL.NS', '2026-06-30', '2025-06-30', 'bilanzierungswechsel'],
    ['002077.SZ', '2026-06-30', '2025-06-30', 'uebernahme']]);
  for (const e of own) assert.ok(e.sources.every(s => s.url.startsWith('https://') && s.page && s.quote), e.ticker);
  assert.equal(row('ETERNAL.BO', '2026-06-30').reason, row('ETERNAL.NS', '2026-06-30').reason, 'one firm, one wording');
  for (const e of own) assert.doesNotMatch(e.reason, / [–—] /, e.ticker + ': no dash as punctuation');
  assert.equal(G.loadHinweisTable(table).length, table.entries.length);
  const bad = structuredClone(table); bad.entries.at(-1).code = 'bilanz';
  assert.throws(() => G.loadHinweisTable(bad), /Invalid G31 hint/);
});

test('red probes leave the production files byte-identical', () => assert.deepEqual(hashes(), before));

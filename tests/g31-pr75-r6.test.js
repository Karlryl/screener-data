'use strict';
// PR #75 round 6, blind number review of 01.11.2026: financial firms outside the exchange check keep the fiscal year unless both
// operands are filed values, and six firms get a checked hint. Real packets of the daily run of 31.10.2026, cut to the cells read.
// Every red probe stays in memory.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { Module, createRequire } = require('node:module');
const G = require('../lib/g31-recency.js');
const H = require('../lib/financial-known-cases.js');
const F = require('./fixtures/g31-pr75-r6.json');
const table = require('../configs/g31-hinweise.json');

const root = path.resolve(__dirname, '..');
const live = ['lib/g31-recency.js', 'configs/g31-hinweise.json'];
const hashes = () => live.map(f => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, f))).digest('hex'));
const before = hashes();
const snap = t => H.applyFinancialCases(structuredClone(F.snapshots[t])).snapshot;
// The hand-table rows of 04.11.2026 (tests/hand-table-zahlen-20261104.test.js) put these three lenders on their filed quarters;
// the lender guard is probed on the table without them, where only the vendor's unchecked quarter exists.
const ZAHLEN2 = '2026-11-04-sdzahlen2';
const preRows = structuredClone(H.table);
const ownTickers = new Set(preRows.cases.filter(c => c.revision === ZAHLEN2).map(c => c.ticker));
preRows.cases = preRows.cases.filter(c => c.revision !== ZAHLEN2);
preRows.coverage = preRows.coverage.flatMap(v => {
  if (!ownTickers.has(v.ticker)) return [v];
  const left = preRows.cases.filter(c => c.ticker === v.ticker && c.field === v.field && c.replacementValue !== null).map(c => c.period).sort();
  return left.length ? [{ ...v, coversThrough: left.at(-1) }] : [];
});
const lenderSnap = t => H.applyFinancialCases(structuredClone(F.snapshots[t]), { table: preRows }).snapshot;
const close = (a, b) => assert.ok(Math.abs(a - b) < 0.01, `${a} != ${b}`);
const GUARD = "  const mustBeFiled = reviewed || (s?.meta?.sector === 'Financial Services' && !EXCHANGE_CHECKED.test(s?.meta?.ticker || ''));";
function mutant(anchor, replacement, stubs = {}) {
  const file = path.join(root, 'lib/g31-recency.js');
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  if (anchor) assert.equal(lines.filter(l => l === anchor).length, 1, 'whole-line anchor occurs exactly once');
  const m = new Module(file, module), real = createRequire(file);
  m.filename = file; m.paths = module.paths; m.require = id => stubs[id] ?? real(id);
  m._compile(lines.map(l => (l === anchor ? replacement : l)).join('\n'), file);
  return m.exports;
}
// The September 2025 quarter of 002980.SZ comes from the exchange fill in the run (tests/exchange-absent-row-r4.test.js); here the filed cell.
const withFill = t => {
  const s = snap(t);
  if (t !== '002980.SZ') return s;
  const ends = s.timeseries.revenueQEnds, at = ends.findIndex(e => e < '2025-09-30');
  ends.splice(at, 0, '2025-09-30');
  s.timeseries.revenueQ.splice(at, 0, { value: 180616496.69 * s.meta.fxRateApplied, exchangeFill: { period: '2025-09-30' } });
  return s;
};

for (const [t, wrong] of [['SHRIRAMFIN.NS', 32.06], ['POONAWALLA.NS', 82.45], ['360ONE.NS', 35.54]]) {
  test(`${t}: a lender keeps the fiscal year; without the guard the unchecked vendor quarter shows ${wrong} %`, () => {
    const s = lenderSnap(t), leg = G.g31Shadow(s).v1;
    assert.equal(leg.basis, 'year');
    assert.equal(leg.sourcePeriodEnd, '2026-03-31');
    const broken = mutant(GUARD, '  const mustBeFiled = reviewed;').g31Shadow(s).v1;
    assert.equal(broken.basis, 'quarter');
    assert.equal(broken.sourcePeriodEnd, '2026-06-30');
    close(broken.pct, wrong);
  });
}

test('JIOFIN.BO: a lender whose two operands are filed values keeps the quarter pair', () => {
  const leg = G.g31Shadow(snap('JIOFIN.BO')).v1;
  assert.equal(leg.basis, 'quarter');
  assert.equal(leg.sourcePeriodEnd, '2026-06-30');
  close(leg.pct, 227.28);
});

test('a non-financial firm is untouched: TCS.NS still takes the older pair, and the hint says where the comparison is missing', () => {
  const s = snap('TCS.NS'), leg = G.g31Shadow(s).v1;
  assert.equal(leg.basis, 'quarter');
  assert.equal(leg.sourcePeriodEnd, '2026-06-30');
  close(leg.pct, 13.93);
  assert.equal(G.g31Hinweis(s).code, 'aelteres-quartalspaar');
  assert.match(G.g31Hinweis(s).reason, /fehlt in den Anbieterdaten ein gültiger Vorjahresvergleich\.$/);
});

test('a financial firm inside the exchange check is not stopped by this guard: the store decides there', () => {
  const s = lenderSnap('SHRIRAMFIN.NS');
  s.meta = { ...s.meta, ticker: '000001.SZ' };
  const agree = { './exchange-quarter-check.js': { stripOwn: x => x, defaultContext: () => ({}), evaluate: () => ({ category: 'agree', withhold: [], pairs: [{ status: 'agree', end: '2026-06-30', priorEnd: '2025-06-30' }] }) } };
  assert.equal(mutant(null, null, agree).g31Shadow(s).v1.sourcePeriodEnd, '2026-06-30');
  const everywhere = mutant(GUARD, "  const mustBeFiled = reviewed || s?.meta?.sector === 'Financial Services';", agree);
  assert.equal(everywhere.g31Shadow(s).v1.basis, 'year', 'red probe: a guard without the market test would stop it');
});

const HINTS = [['002980.SZ', '2026-09-30', 'uebernahme', /Kauf einer Tochter/], ['OFSS.NS', '2026-06-30', 'einmaleffekt', /9\.353 Mio\. INR/], ['JIOFIN.BO', '2026-06-30', 'uebernahme', /508,59 Crore INR/],
  ['CIPLA.BO', '2026-06-30', 'bilanzierungswechsel', /115,24 Crore INR/], ['SONACOMS.NS', '2026-06-30', 'uebernahme', /Escorts Kubota/], ['ADANIPOWER.NS', '2026-06-30', 'uebernahme', /Vidarbha/]];
for (const [t, end, code, text] of HINTS) {
  test(`${t}: the checked hint stands on the shown pair and lapses on another listing`, () => {
    const s = withFill(t), leg = G.g31Shadow(s).v1;
    assert.equal(leg.sourcePeriodEnd, end, 'the board shows this pair');
    const hint = G.g31Hinweis(s);
    assert.equal(hint.code, code);
    assert.match(hint.reason, text);
    const row = table.entries.find(e => e.ticker === t && e.periodEnd === end);
    assert.ok(row.sources.length && row.sources.every(x => x.url.startsWith('https://') && x.page && x.quote));
    assert.match(row.reason, /Geprüft am 01\.11\.2026\.$/);
    assert.match(row.reason, /\d\d\.\d\d\.\d{4}/, 'names a period');
    const other = structuredClone(s);
    other.meta = { ...other.meta, ticker: 'NOTALISTING' };
    assert.notEqual(G.g31Hinweis(other)?.reason, row.reason, 'bound to the listing');
    const without = mutant(null, null, { '../configs/g31-hinweise.json': { ...table, entries: table.entries.filter(e => e !== row) } });
    assert.notEqual(without.g31Hinweis(s)?.reason, row.reason, 'red without the row');
  });
}

test('each twin listing carries the same row, because the shown listing changes daily', () => {
  for (const [a, b] of [['OFSS.NS', 'OFSS.BO'], ['JIOFIN.BO', 'JIOFIN.NS'], ['CIPLA.BO', 'CIPLA.NS'], ['SONACOMS.NS', 'SONACOMS.BO']]) {
    const x = table.entries.find(e => e.ticker === a && e.periodEnd === '2026-06-30'), y = table.entries.find(e => e.ticker === b && e.periodEnd === '2026-06-30');
    assert.ok(x && y, a);
    assert.equal(x.reason, y.reason);
  }
});

test('the hint code is on the checked list; an unknown one is refused', () => {
  const row = table.entries.find(e => e.code === 'einmaleffekt');
  assert.ok(row);
  assert.throws(() => G.loadHinweisTable({ ...table, entries: [{ ...row, code: 'frei' }] }), /Invalid G31 hint entry/);
  assert.doesNotThrow(() => G.loadHinweisTable({ ...table, entries: [row] }));
});

test('all break-once probes leave the production files byte-identical', () => {
  assert.deepEqual(hashes(), before);
});

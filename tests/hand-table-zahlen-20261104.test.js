'use strict';
// Hand table of 04.11.2026 (lane sd-zahlen-2): the financial firms that #75 sent back to the fiscal year, plus the quarters
// Codex asked for on 04.11.2026 (review R03 of #99, finding 2). Two independent readers per cell read the printed total of
// revenue for every quarter and fiscal year the vendor carries; a cell enters only when both give the same value (360 ONE: three
// cells where the readers differed take Codex's independent reading of review R01 as the second one). The vendor showed a net or
// partial line throughout, for example Shriram Finance +32.1 % for June 2026 against a filed +16.2 %, and the fiscal years used
// in the score carried the same definition (Shriram +13.9 % against +15.1 %, 360 ONE +19.1 % against +29.4 %). Years without
// two equal readings stay empty, and so does every older year below them. TVS Holdings now reaches its NSE listing too.
// Real packets: tests/fixtures/hand-table-zahlen-20261104.json (daily run 41805213687) and, for the six firms already corrected
// on 02.11.2026, their raw packets of 31.10.2026 in tests/fixtures/hand-table-zahlen-20261102.json. Every probe changes an
// in-memory copy and the live files are hashed before and after. Break-once on test data:
// `node tests/hand-table-zahlen-20261104.test.js --prove-red` runs the same assertions on the table without these rows and exits 1.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const H = require('../lib/financial-known-cases.js');
const { g31Shadow } = require('../lib/g31-recency.js');
const F = { ...require('./fixtures/hand-table-zahlen-20261102.json').snapshots, ...require('./fixtures/hand-table-zahlen-20261104.json').snapshots,
  ...require('./fixtures/hand-table-zahlen-20261104-bolsa.json').snapshots };

const root = path.resolve(__dirname, '..');
const live = ['configs/financial-known-cases.json', 'tests/fixtures/hand-table-zahlen-20261104.json', 'tests/fixtures/hand-table-zahlen-20261104-bolsa.json'];
const liveHashes = () => live.map(f => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, f))).digest('hex'));
const beforeHashes = liveHashes();
const REV = '2026-11-04-sdzahlen2';
const value = r => (r && typeof r === 'object' ? r.value ?? null : r ?? null);
// The table as it stood before these rows: their cases out, coverage back to the last earlier case or out.
const pre = structuredClone(H.table);
const ownTickers = new Set(pre.cases.filter(c => c.revision === REV).map(c => c.ticker));
pre.cases = pre.cases.filter(c => c.revision !== REV);
pre.coverage = pre.coverage.flatMap(v => {
  if (!ownTickers.has(v.ticker)) return [v];
  const left = pre.cases.filter(c => c.ticker === v.ticker && c.field === v.field && c.replacementValue !== null).map(c => c.period).sort();
  return left.length ? [{ ...v, coversThrough: left.at(-1) }] : [];
});
// These rows also gave the TVS Holdings rows of 02.11.2026 their NSE listing.
for (const x of [...pre.cases, ...pre.coverage]) if (x.ticker === 'TVSHLTD.BO' && x.listingAliases) delete x.listingAliases;
H.validateTable(pre);
const active = process.argv.includes('--prove-red') ? pre : H.table;
const apply = s => H.applyFinancialCases(s, { table: active });
const leg = (t, alias) => { const s = structuredClone(F[t]); if (alias) s.meta.ticker = alias; return s; };

// ticker, other listings, basis before and growth before (vendor), basis after, shown pair, growth after (filed operands).
const ROWS = [
  ['SHRIRAMFIN.NS', [], 'year', 13.9, 'quarter', '2026-06-30', '2025-06-30', 16.1586],
  // 360 ONE June 2026 on the regrouped 1,223.30 crore of the report of 15.10.2026 (Codex T02, row updated 07.11.2026; was 26.8483).
  ['360ONE.NS', ['360ONE.BO'], 'year', 19.06, 'quarter', '2026-06-30', '2025-06-30', 26.5596],
  ['TVSHLTD.BO', ['TVSHLTD.NS'], 'quarter', 34.01, 'quarter', '2026-06-30', '2025-06-30', 34.0129],
  ['NUVAMA.BO', ['NUVAMA.NS'], 'quarter', 22.59, 'quarter', '2026-06-30', '2025-06-30', 22.5867],
  ['SUNDARMFIN.NS', [], 'quarter', 12.57, 'quarter', '2026-06-30', '2025-06-30', 12.5674],
  ['KRU.WA', [], 'quarter', -1.08, 'quarter', '2026-06-30', '2025-06-30', -1.0813],
  ['SBFC.BO', ['SBFC.NS'], 'quarter', 26.52, 'quarter', '2026-06-30', '2025-06-30', 26.5238],
  ['IIFL.BO', ['IIFL.NS'], 'quarter', 32.73, 'quarter', '2026-06-30', '2025-06-30', 32.7252],
  ['ANGELONE.BO', ['ANGELONE.NS'], 'year', 1.36, 'quarter', '2026-06-30', '2025-06-30', 25.3531],
  ['BOLSA/A.MX', [], 'year', 8.27, 'year', '2025-12-31', '2024-12-31', 7.319],
  ['CHOLAFIN.BO', ['CHOLAFIN.NS'], 'year', 25.6, 'quarter', '2026-06-30', '2025-06-30', 21.8733],
  ['CREDITACC.NS', ['CREDITACC.BO'], 'year', 5.31, 'quarter', '2026-06-30', '2025-06-30', 21.9155],
  ['HOMEFIRST.NS', ['HOMEFIRST.BO'], 'year', 24.95, 'quarter', '2026-06-30', '2025-06-30', 18.6055],
  ['IREDA.BO', ['IREDA.NS'], 'year', 22.79, 'quarter', '2026-06-30', '2025-06-30', 15.4986],
  ['LTF.BO', ['LTF.NS'], 'year', 12.63, 'quarter', '2026-06-30', '2025-06-30', 22.3814],
  ['POONAWALLA.NS', [], 'year', 62.25, 'quarter', '2026-06-30', '2025-06-30', 77.3419],
];

test('every listing shows the growth of the filed operands on the newest filed pair', () => {
  for (const [t, aliases, b0, before, b1, end, prior, after] of ROWS) {
    const v0 = g31Shadow(H.applyFinancialCases(leg(t), { table: pre }).snapshot).v1;
    assert.equal(v0.basis, b0, t + ': precondition');
    assert.ok(Math.abs(v0.pct - before) < 0.005, t + ': precondition, the vendor growth ' + v0.pct);
    const field = b1 === 'quarter' ? 'revenueQ' : 'annualRev';
    const cur = H.table.cases.find(c => c.ticker === t && c.field === field && c.period === end);
    const pri = H.table.cases.find(c => c.ticker === t && c.field === field && c.period === prior);
    assert.ok(Math.abs((cur.replacementValue / pri.replacementValue - 1) * 100 - after) < 0.0001, t + ': the literal is the filed ratio');
    for (const x of [t, ...aliases]) {
      const v1 = g31Shadow(apply(leg(t, x)).snapshot).v1;
      assert.deepEqual([v1.basis, v1.periodEnd, v1.priorPeriodEnd], [b1, end, prior], x);
      assert.ok(Math.abs(v1.pct - after) < 0.0001, x + ' ' + v1.pct);
    }
  }
});

test('TVS Holdings: the real NSE packet, which lacks the September quarter, shows the filed June pair', () => {
  const v0 = g31Shadow(H.applyFinancialCases(structuredClone(F['TVSHLTD.NS']), { table: pre }).snapshot).v1;
  assert.ok(Math.abs(v0.pct - 33.22) < 0.01, 'precondition: the board showed the vendor value on TVSHLTD.NS ' + v0.pct);
  const v1 = g31Shadow(apply(structuredClone(F['TVSHLTD.NS'])).snapshot).v1;
  assert.deepEqual([v1.basis, v1.periodEnd], ['quarter', '2026-06-30']);
  assert.ok(Math.abs(v1.pct - 34.0129) < 0.0001);
});

test('fiscal years enter on the filed definition; years without two equal readings and every older one stay empty', () => {
  for (const [t] of ROWS) {
    const cases = H.table.cases.filter(c => c.ticker === t && c.field === 'annualRev' && c.revision === REV);
    if (!cases.length) continue;
    const out = apply(leg(t)).snapshot, ends = out.annual.annualRevEnds, oldest = cases.map(c => c.period).sort()[0];
    ends.forEach((e, i) => {
      const c = cases.find(x => x.period === e);
      if (c) assert.equal(value(out.annual.annualRev[i]), c.replacementValue * leg(t).meta.fxRateApplied, t + ' ' + e);
      else if (e < oldest) assert.equal(value(out.annual.annualRev[i]), null, t + ' ' + e + ' older than the read years');
    });
  }
});

test('a vendor quarter after the covered one is withheld and the filed pair stays on the board', () => {
  const nextEnd = e => ({ '03-31': '06-30', '06-30': '09-30', '09-30': '12-31', '12-31': '03-31' })[e.slice(5)];
  for (const [t, , , , b1, end, , after] of ROWS.filter(r => r[4] === 'quarter')) {
    const v = H.table.coverage.find(x => x.ticker === t && x.field === 'revenueQ');
    const md = nextEnd(v.coversThrough), next = (md === '03-31' ? +v.coversThrough.slice(0, 4) + 1 : v.coversThrough.slice(0, 4)) + '-' + md;
    const s = leg(t);
    s.timeseries.revenueQ = [{ value: 7e8 }, ...s.timeseries.revenueQ];
    s.timeseries.revenueQEnds = [next, ...s.timeseries.revenueQEnds];
    const out = apply(s).snapshot, v1 = g31Shadow(out).v1;
    assert.equal(value(out.timeseries.revenueQ[0]), null, t + ' ' + next);
    assert.equal(out.timeseries.revenueQ[0].financialMissing.reasonCode, 'period-after-coverage', t);
    assert.deepEqual([v1.basis, v1.periodEnd], [b1, end], t);
    assert.ok(Math.abs(v1.pct - after) < 0.0001, t);
  }
});

test('rows: count, one block, exact sources, a reason naming its period, plain German', () => {
  const own = H.table.cases.filter(c => c.revision === REV);
  assert.equal(own.length, 114);
  const at = H.table.cases.findIndex(c => c.revision === REV);
  assert.deepEqual(H.table.cases.slice(at, at + 114), own, 'one block');
  assert.deepEqual([...new Set(own.map(c => c.ticker))].sort(), ROWS.map(r => r[0]).sort());
  for (const c of own) {
    const [y, m, d] = c.period.split('-');
    assert.ok(c.reason.includes(`${d}.${m}.${y}`), c.caseId);
    assert.match(c.reason, c.caseId === '360one.ns-2026-06-30-revenueQ-20261104' ? /Geprüft am 07\.11\.2026\.$/ : /Geprüft am 04\.11\.2026\.$/);
    assert.doesNotMatch(c.reason, /[–—]| - /, c.caseId);
    const s = c.sources[0];
    assert.ok(s.value === c.replacementValue && s.end === c.period && s.currency === c.currency && s.unit === 'currency' && /^\d{4}-\d{2}-01$/.test(s.start), c.caseId + ' leads with its exact source');
    if (c.periodType === '12M') assert.ok(c.sources.every(x => x.value === c.replacementValue && x.end === c.period), c.caseId + ': every annual source states the year');
    assert.ok(c.sources.length >= 2, c.caseId + ': two readings');
  }
});

test('red without the rows: the vendor growth is back on every firm', () => {
  for (const [t, , , before] of ROWS) {
    assert.ok(Math.abs(g31Shadow(H.applyFinancialCases(leg(t), { table: pre }).snapshot).v1.pct - before) < 0.005, t);
  }
});

test('expectations: one per firm whose shown growth changes, bound to the issuer name on the financials board', () => {
  const own = require('../data-health/erwartungen.json').filter(e => e.pr === 102);
  const moved = ROWS.filter(r => Math.abs(r[3] - r[7]) >= 0.05);
  assert.equal(own.length, moved.length);
  for (const [t, , , , , , , after] of moved) {
    const e = own.find(x => x.name === F[t].meta.name);
    assert.ok(e, t);
    assert.deepEqual([e.board, e.feld, e.op, e.ticker, e.gueltigAb], ['full/financials', 'revGrowthYoYPct', 'between', undefined, '2026-11-05'], t);
    assert.ok(e.min < after && after < e.max && e.max - e.min < 0.61, t);
  }
});

test('the live files are unchanged by this test', () => {
  assert.deepEqual(liveHashes(), beforeHashes);
});

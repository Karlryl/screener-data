'use strict';
// Follow-up of #112 (07.11.2026, lane sd-hand-4; Codex re-check P112): the vendor leaves the year-ago quarter 30.09.2025 empty
// (Guotai Haitong, 360 ONE) or omits it (Chennai Petroleum), so the boards showed older pairs although the issuers reported the
// September 2026 quarter: Guotai FY 2025 +87.40 % instead of Q3 -46.35 %, Chennai June +57.14 % instead of September +10.09 %,
// 360 ONE June +26.56 % instead of September +4.17 %. vendorGap rows fill the empty cell or insert the omitted quarter with
// the filed value (lib/financial-known-cases.js); Chennai's fiscal years move to the filed line (78,610.79 and 71,049.95 crore).
// Real packets of daily run 42356903064 (tests/fixtures/hand-table-sdhand4-20261107.json). In-memory probes only; live files
// hashed before and after. Break-once: `--prove-red` runs the same assertions on the table without these rows and exits 1.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const H = require('../lib/financial-known-cases.js');
const { g31Shadow } = require('../lib/g31-recency.js');
const F = require('./fixtures/hand-table-sdhand4-20261107.json').snapshots;

const root = path.resolve(__dirname, '..');
const live = ['configs/financial-known-cases.json', 'data-health/erwartungen.json', 'tests/fixtures/hand-table-sdhand4-20261107.json'];
const liveHashes = () => live.map(f => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, f))).digest('hex'));
const beforeHashes = liveHashes();
const REV = '2026-11-07-sdhand4b';
const pre = structuredClone(H.table);
pre.cases = pre.cases.filter(c => c.revision !== REV);
H.validateTable(pre);
const active = process.argv.includes('--prove-red') ? pre : H.table;
const value = r => (r && typeof r === 'object' ? r.value ?? null : r ?? null);
const pkt = (t, as) => { const s = structuredClone(F[t]); if (as) s.meta.ticker = as; return s; };
const apply = (s, table = active) => H.applyFinancialCases(s, { table }).snapshot;
const pct = (a, b) => (a / b - 1) * 100;

const ROWS = [
  ['601211.SS', ['year', '2025-12-31', 87.3988], pct(11813133439, 22019291518)],
  ['CHENNPETRO.NS', ['quarter', '2026-06-30', 57.1374], pct(22055.45, 20033.62)],
  ['360ONE.NS', ['quarter', '2026-06-30', 26.5596], pct(1143.83, 1098.06)],
];

test('the newest reported quarter leads: September 2026 against September 2025 on every listing', () => {
  for (const [t, [b0, e0, p0], after] of ROWS) {
    const v0 = g31Shadow(apply(pkt(t), pre)).v1;
    assert.deepEqual([v0.basis, v0.periodEnd], [b0, e0], t + ': precondition');
    assert.ok(Math.abs(v0.pct - p0) < 0.0001, t + ': precondition ' + v0.pct);
    for (const as of t === '360ONE.NS' ? [t, '360ONE.BO'] : [t]) {
      const v1 = g31Shadow(apply(pkt(t, as))).v1;
      assert.deepEqual([v1.basis, v1.periodEnd, v1.priorPeriodEnd], ['quarter', '2026-09-30', '2025-09-30'], as);
      assert.ok(Math.abs(v1.pct - after) < 1e-9, as + ' ' + v1.pct);
    }
  }
  assert.deepEqual(ROWS.map(r => +r[2].toFixed(2)), [-46.35, 10.09, 4.17]);
});

test('an empty vendor cell is filled once, a vendor figure that appears later is withheld, a not yet public value is not used', () => {
  const s = apply(pkt('601211.SS')), i = s.timeseries.revenueQEnds.indexOf('2025-09-30'), f = F['601211.SS'].meta.fxRateApplied;
  assert.equal(value(s.timeseries.revenueQ[i]), 22019291518 * f);
  assert.equal(s.timeseries.revenueQ[i].financialCorrection.caseId, '601211.ss-2025-09-30-revenueQ-20261107b');
  assert.deepEqual(apply(structuredClone(s)), s, 'idempotent');
  const later = pkt('601211.SS'); later.timeseries.revenueQ[i] = { value: 3e9 };
  assert.equal(apply(later).timeseries.revenueQ[i].financialMissing?.reasonCode, 'vendor-value-changed');
  const early = pkt('601211.SS'); early.meta.fetchedAt = '2025-10-15T10:00:00.000Z';
  assert.equal(value(apply(early).timeseries.revenueQ[i]), null, 'fetched before the Q3 2025 report of 31.10.2025');
});

test('Chennai: the omitted quarter is inserted between its neighbours, every position-paired series stays aligned', () => {
  const raw = pkt('CHENNPETRO.NS'), s = apply(raw), ts = s.timeseries;
  const ends = ['2026-09-30', '2026-06-30', '2026-03-31', '2025-12-31', '2025-09-30', '2025-06-30'];
  assert.deepEqual(ts.revenueQEnds, ends);
  for (const f of ['grossProfitQ', 'opIncQ']) {
    assert.deepEqual(ts[f + 'Ends'], ends, f);
    assert.equal(ts[f][4], null, f + ': the inserted quarter stays empty, never invented');
    assert.deepEqual(ts[f].filter((_, k) => k !== 4), raw.timeseries[f].map((r, k) => apply(raw, pre).timeseries[f][k]), f + ': other cells unchanged');
  }
  assert.equal(ts.netIncomeQ.length, raw.timeseries.netIncomeQ.length + 1);
  assert.equal(ts.netIncomeQ[4], null);
  assert.equal(value(ts.revenueQ[4]), 200336200000 * raw.meta.fxRateApplied);
  for (const [f, list] of Object.entries(s.meta.statementPeriods || {})) if (Array.isArray(list) && list.length === ts[f]?.length) assert.equal(list[4].end, '2025-09-30', f);
  assert.deepEqual(apply(structuredClone(s)), s, 'idempotent: a stored packet keeps exactly one inserted quarter');
  // Two quarters missing: no insert, logged.
  const hole = pkt('CHENNPETRO.NS'), j = hole.timeseries.revenueQEnds.indexOf('2025-06-30');
  for (const f of ['revenueQ', 'grossProfitQ', 'opIncQ']) { hole.timeseries[f].splice(j, 1); hole.timeseries[f + 'Ends'].splice(j, 1); }
  hole.timeseries.netIncomeQ.splice(j, 1);
  const r = H.applyFinancialCases(hole, { table: active });
  assert.ok(!r.snapshot.timeseries.revenueQEnds.includes('2025-09-30'));
});

test('Chennai fiscal years on the filed line: +10.64 % instead of the vendor +7.22 %, older vendor years withheld', () => {
  const s = apply(pkt('CHENNPETRO.NS')), f = F['CHENNPETRO.NS'].meta.fxRateApplied, a = s.annual;
  assert.deepEqual(a.annualRev.slice(0, 2).map(value), [786107900000 * f, 710499500000 * f]);
  assert.ok(Math.abs(pct(786107900000, 710499500000) - 10.6416) < 0.0001);
  assert.ok(Math.abs(pct(635507500000, 592690100000) - 7.2242) < 0.0001, 'the vendor ratio before');
  assert.deepEqual(a.annualRev.slice(2).map(value), [null, null], 'net-of-excise years are not paired with the filed ones');
});

test('rows: five, one block after every earlier case, sources traced, reasons name their period, plain German', () => {
  const own = H.table.cases.filter(c => c.revision === REV);
  assert.equal(own.length, 5);
  const at = H.table.cases.indexOf(own[0]);
  assert.deepEqual(H.table.cases.slice(at, at + 5), own);
  assert.deepEqual(own.filter(c => c.vendorGap).map(c => [c.ticker, c.period, c.expectedBadValue, c.replacementValue]),
    [['601211.SS', '2025-09-30', null, 22019291518], ['360ONE.NS', '2025-09-30', null, 10980600000], ['CHENNPETRO.NS', '2025-09-30', null, 200336200000]]);
  for (const c of own) {
    const [y, m, d] = c.period.split('-');
    assert.ok(c.reason.includes(`${d}.${m}.${y}`), c.caseId);
    assert.match(c.reason, /Geprüft am 07\.11\.2026\.$/);
    assert.doesNotMatch(c.reason, /[–—]| - |kauf|verkauf/i);
    assert.ok(c.sources.some(s => s.value === c.replacementValue && s.end === c.period && s.start && s.filed), c.caseId);
  }
  const g = own[0].sources;
  assert.equal(g[1].value - g[2].value, own[0].replacementValue, 'nine months minus the half year is the printed quarter');
  for (const bad of [c => { c.expectedBadValue = 1; }, c => { c.field = 'opIncQ'; }, c => { delete c.vendorGap; }]) {
    const t = structuredClone(H.table); bad(t.cases.find(c => c.caseId === own[0].caseId));
    assert.throws(() => H.validateTable(t), /Invalid/);
  }
});

test('expectations from the run of 10.11.2026: the September pairs and Chennai fiscal growth, bound to the issuer name', () => {
  const own = require('../data-health/erwartungen.json').filter(e => e.id.startsWith('sdhand4b-'));
  const names = Object.fromEntries(ROWS.map(([t]) => [t, F[t].meta.name]));
  for (const [t, [, , before], after] of ROWS) {
    const e = own.find(x => x.name === names[t] && x.feld === 'revGrowthYoYPct');
    assert.ok(e, t);
    assert.equal(e.gueltigAb, '2026-11-10');
    assert.ok(e.min < after && after < e.max && !(e.min < before && before < e.max), t);
  }
  assert.equal(own.length, 3);
});

test('the live files are unchanged by this test', () => {
  assert.deepEqual(liveHashes(), beforeHashes);
});

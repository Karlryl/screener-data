'use strict';
// Hand table of 07.11.2026 (lane sd-hand-7, Codex S09 on the export of 03.11.2026, re-measured on 07.11.2026): Hammerson showed
// revenue growth 2025 of +78.49 % (vendor 208.3 against 116.7 M GBP); the filed Revenue line is 211.4 against 121.1, +74.57 %.
// The vendor leaves out the joint-venture management fees in every year (3.1, 4.4, 6.5, 5.5 M GBP, note 4 and the FY2023
// financial review), so all four years go to the filed line and the 3-year growth and the acceleration keep one basis.
// Real packet: tests/fixtures/hand-table-hmso-20261107.json. Probes change in-memory copies; live files are hashed before and
// after. Break-once on test data: `node tests/hand-table-hmso-20261107.test.js --prove-red` checks the table without these rows
// and must exit 1 (two tests red).
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const H = require('../lib/financial-known-cases.js');
const { g31Shadow } = require('../lib/g31-recency.js');
const erwartungen = require('../data-health/erwartungen.json');
const F = require('./fixtures/hand-table-hmso-20261107.json').snapshots;

const root = path.resolve(__dirname, '..');
const live = ['configs/financial-known-cases.json', 'data-health/erwartungen.json', 'tests/fixtures/hand-table-hmso-20261107.json'];
const liveHashes = () => live.map(f => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, f))).digest('hex'));
const beforeHashes = liveHashes();
const REV = '2026-11-07-sdhand7';
const pre = structuredClone(H.table);
pre.cases = pre.cases.filter(c => c.revision !== REV);
H.validateTable(pre);
const active = process.argv.includes('--prove-red') ? pre : H.table;
const value = r => (r && typeof r === 'object' ? r.value ?? null : r ?? null);
const pkt = as => { const s = structuredClone(F['HMSO.L']); if (as) s.meta.ticker = as; return s; };
const native = s => s.annual.annualRev.slice(0, 4).map(r => Math.round(value(r) / s.meta.fxRateApplied));
// Filed Revenue (M GBP x 1e5) and the joint-venture management fees the vendor leaves out.
const FILED = [211400000, 121100000, 134300000, 131400000];
const FEES = [3100000, 4400000, 6500000, 5500000];

test('the vendor revenue is the filed Revenue line less the joint-venture management fees, in every year', () => {
  assert.deepEqual(native(pkt()), FILED.map((v, i) => v - FEES[i]));
  assert.deepEqual(pkt().annual.annualRevEnds.slice(0, 4), ['2025-12-31', '2024-12-31', '2023-12-31', '2022-12-31']);
});

test('both listings show the filed growth 2025 against 2024, all four years on the filed line', () => {
  const v0 = g31Shadow(H.applyFinancialCases(pkt(), { table: pre }).snapshot).v1;
  assert.deepEqual([v0.basis, v0.periodEnd, +v0.pct.toFixed(4)], ['year', '2025-12-31', 78.4919], 'precondition: the vendor growth');
  for (const as of [undefined, 'HMSO.IR']) {
    const s = H.applyFinancialCases(pkt(as), { table: active }).snapshot, v = g31Shadow(s).v1;
    assert.deepEqual(native(s), FILED, as ?? 'HMSO.L');
    assert.deepEqual([v.basis, v.periodEnd, v.priorPeriodEnd], ['year', '2025-12-31', '2024-12-31']);
    assert.ok(Math.abs(v.pct - (211.4 / 121.1 - 1) * 100) < 1e-9, String(v.pct));
  }
  assert.equal(+((211.4 / 121.1 - 1) * 100).toFixed(2), 74.57);
});

test('fail closed: a changed vendor cell is not overwritten by a row that no longer matches', () => {
  const s = pkt();
  s.annual.annualRev[0] = { ...s.annual.annualRev[0], value: value(s.annual.annualRev[0]) * 1.01 };
  const out = H.applyFinancialCases(s, { table: active }).snapshot;
  assert.notEqual(Math.round(value(out.annual.annualRev[0]) / out.meta.fxRateApplied), FILED[0]);
});

test('rows: four years, one revision, every source carries its year and value; the expectations start Tue 10.11.', () => {
  const own = active.cases.filter(c => c.revision === REV);
  assert.deepEqual(own.map(c => [c.period, c.index, c.expectedBadValue, c.replacementValue]),
    FILED.map((v, i) => [`${2025 - i}-12-31`, i, v - FEES[i], v]));
  for (const c of own) {
    assert.deepEqual(c.listingAliases, ['HMSO.IR']);
    assert.ok(c.sources.every(s => s.value === c.replacementValue && s.end === c.period && s.url.startsWith('https://')), c.caseId);
    assert.doesNotMatch(c.reason, /[–—]| - |kauf|verkauf/i);
  }
  const erw = erwartungen.filter(e => e.id.startsWith('sdhand7-HMSO-'));
  assert.ok(erw.length >= 2 && erw.every(e => e.pr === 119 && e.gueltigAb === '2026-11-10' && e.name === 'Hammerson Plc'));
  const g = erw.find(e => e.feld === 'revGrowthYoYPct');
  assert.ok(g.min <= 74.5665 && 74.5665 <= g.max && !(g.min <= 78.4919 && 78.4919 <= g.max), 'the band tells the two figures apart');
});

test('the live files are unchanged by this test', () => {
  assert.deepEqual(liveHashes(), beforeHashes);
});

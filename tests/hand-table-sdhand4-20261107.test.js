'use strict';
// Hand table of 07.11.2026 (lane sd-hand-4): board errors confirmed by two Codex readings on the export of 03.11.2026 and
// re-measured on the export of 07.11.2026, plus the two findings of Codex T02 on #102.
//   Yuanta Futures 70.45 % instead of the filed 39.68 % (vendor line is not Total revenues), Chennai Petroleum 84.77 % instead
//   of 57.14 % (the vendor deducts the excise duty), Spartan Delta 113.20 % instead of 109.18 % (the vendor counts sales before
//   royalties), Guotai Haitong 23.89 % on a mixed base instead of the filed 87.40 % (merger hint), Bure Equity 8.21 % on
//   dividends where the filed total income changes sign (empty field), 360 ONE 26.85 % instead of 26.56 % after the regrouping
//   in the report of 15.10.2026, and Sundaram Finance, whose three quarter rows never acted on the stored packet because the
//   retained vendor row is native while the packet is converted.
// Real packets: tests/fixtures/hand-table-sdhand4-20261107.json (daily run 42356903064). Every probe changes an in-memory copy
// and the live files are hashed before and after. Break-once on test data: `node tests/hand-table-sdhand4-20261107.test.js
// --prove-red` runs the same assertions on the table without these rows (and 360 ONE on its value of 04.11.2026) and exits 1.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const H = require('../lib/financial-known-cases.js');
const { g31Shadow, g31Hinweis } = require('../lib/g31-recency.js');
const hints = require('../configs/g31-hinweise.json');
const erwartungen = require('../data-health/erwartungen.json');
const F = require('./fixtures/hand-table-sdhand4-20261107.json').snapshots;

const root = path.resolve(__dirname, '..');
const live = ['configs/financial-known-cases.json', 'configs/g31-hinweise.json', 'data-health/erwartungen.json', 'tests/fixtures/hand-table-sdhand4-20261107.json'];
const liveHashes = () => live.map(f => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, f))).digest('hex'));
const beforeHashes = liveHashes();
const REV = '2026-11-07-sdhand4';
const RED = process.argv.includes('--prove-red');
const value = r => (r && typeof r === 'object' ? r.value ?? null : r ?? null);
const ONE = '360one.ns-2026-06-30-revenueQ-20261104';
// The table as it stood before these rows: their cases and coverage out, 360 ONE back on the July report.
const pre = structuredClone(H.table);
pre.cases = pre.cases.filter(c => c.revision !== REV);
pre.coverage = pre.coverage.filter(v => !['CHENNPETRO.NS', '6023.TWO', 'SDE.TO', '601211.SS', 'BURE.ST'].includes(v.ticker));
const one0 = pre.cases.find(c => c.caseId === ONE);
one0.replacementValue = 12260900000;
one0.sources = one0.sources.filter(s => s.value === 12260900000);
H.validateTable(pre);
const active = RED ? pre : H.table;
const apply = s => H.applyFinancialCases(s, { table: active });
const pkt = (t, as) => { const s = structuredClone(F[t]); if (as) s.meta.ticker = as; return s; };
const shown = (t, table = active, as) => g31Shadow(H.applyFinancialCases(pkt(t, as), { table }).snapshot).v1;
const pct = (a, b) => (a / b - 1) * 100;

// ticker, vendor growth before (basis, end), filed growth after (basis, end, prior end).
const ROWS = [
  ['6023.TWO', 'quarter', '2026-06-30', 70.4498, 'quarter', '2026-06-30', '2025-06-30', pct(1274427, 912360)],
  ['CHENNPETRO.NS', 'quarter', '2026-06-30', 84.7748, 'quarter', '2026-06-30', '2025-06-30', pct(29358.75, 18683.49)],
  ['SDE.TO', 'quarter', '2026-06-30', 113.1972, 'quarter', '2026-06-30', '2025-06-30', pct(166141, 79425)],
  ['601211.SS', 'year', '2025-12-31', 23.8858, 'year', '2025-12-31', '2024-12-31', pct(63107440954, 33675485600)],
  ['360ONE.NS', 'quarter', '2026-06-30', 26.8483, 'quarter', '2026-06-30', '2025-06-30', pct(12233, 9665.8)],
];

test('the vendor figures are partial or derived lines of the filed statements', () => {
  const raw = (t, end) => { const s = F[t], i = s.timeseries.revenueQEnds.indexOf(end); return value(s.timeseries.revenueQ[i]) / s.meta.fxRateApplied; };
  // Chennai: Revenue from Operations minus excise duty, every quarter (crore INR).
  for (const [end, filed, excise] of [['2026-09-30', 22055.45, 1497.95], ['2026-06-30', 29358.75, 1989.48], ['2026-03-31', 20455.29, 3637.97],
    ['2025-12-31', 19438.39, 3755.22], ['2025-06-30', 18683.49, 3871.26]]) assert.ok(Math.abs(raw('CHENNPETRO.NS', end) / 1e7 - (filed - excise)) < 0.006, end);
  // Spartan: oil and gas sales before royalties plus purchased commodities and processing (CAD thousands).
  assert.ok(Math.abs(raw('SDE.TO', '2026-06-30') / 1e3 - (183698 + 6324 + 1589)) < 0.5);
  assert.ok(Math.abs(raw('SDE.TO', '2025-06-30') / 1e3 - (81004 + 4717 + 4154)) < 0.5);
  // Bure: dividends and interest (SEK M), against a filed total income of 7,628 and -1,225.
  assert.ok(Math.abs(raw('BURE.ST', '2026-06-30') / 1e6 - 211) < 0.01);
  // Guotai: the vendor's 2025 is the CAS total, its 2024 neither the CAS comparative nor the originally reported figure.
  const gy = i => value(F['601211.SS'].annual.annualRev[i]) / F['601211.SS'].meta.fxRateApplied;
  assert.ok(Math.abs(gy(0) - 63107440954) < 10);
  assert.ok(Math.abs(gy(1) - 33675485600) > 1e9 && Math.abs(gy(1) - 43397126485) > 1e9);
});

test('each firm shows the filed growth on the newest pair the board can form', () => {
  for (const [t, b0, e0, before, b1, e1, p1, after] of ROWS) {
    const v0 = shown(t, pre);
    assert.deepEqual([v0.basis, v0.periodEnd], [b0, e0], t + ': precondition');
    assert.ok(Math.abs(v0.pct - before) < 0.0001, t + ': precondition, the vendor growth ' + v0.pct);
    const v1 = shown(t);
    assert.deepEqual([v1.basis, v1.periodEnd, v1.priorPeriodEnd], [b1, e1, p1], t);
    assert.ok(Math.abs(v1.pct - after) < 1e-9, t + ' ' + v1.pct);
  }
  assert.ok(Math.abs(shown('360ONE.NS', active, '360ONE.BO').pct - ROWS[4][7]) < 1e-9, 'the BSE listing too');
  assert.deepEqual(ROWS.map(r => +r[7].toFixed(2)), [39.68, 57.14, 109.18, 87.4, 26.56]);
});

test('Bure Equity: no growth is formed, and the definition hint explains the empty field', () => {
  const v0 = shown('BURE.ST', pre);
  assert.ok(Math.abs(v0.pct - 8.2051) < 0.0001, 'precondition ' + v0.pct);
  const out = apply(pkt('BURE.ST')).snapshot;
  assert.equal(g31Shadow(out).v1.pct, null);
  assert.deepEqual(out.timeseries.revenueQ.map(value), [null, null, null, null, null], 'every vendor quarter held');
  assert.deepEqual(out.annual.annualRev.map(value), [null, null, null, null], 'the fiscal year and every older one held');
  const d = hints.definitionen.find(x => x.ticker === 'BURE.ST');
  assert.match(d.reason, /nicht auf den Wachstums-Boards/);
  assert.match(d.reason, /plus 7\.628 Mio\. SEK nach minus 1\.225 Mio\. SEK/);
  assert.equal(d.verifiedAt, '2026-11-07');
  // Blind review of #112: the next vendor quarter (Q3 2026, reported 05.11.2026) and its year-ago partner stay held, so no
  // dividend growth returns (the probe without the coverage row showed plus 700 %).
  const next = pkt('BURE.ST');
  next.timeseries.revenueQ = [{ value: 24e6 * next.meta.fxRateApplied }, ...next.timeseries.revenueQ];
  next.timeseries.revenueQEnds = ['2026-09-30', ...next.timeseries.revenueQEnds];
  next.timeseries.revenueQ.splice(4, 0, { value: 3e6 * next.meta.fxRateApplied });
  next.timeseries.revenueQEnds.splice(4, 0, '2025-09-30');
  const n = apply(next).snapshot;
  assert.deepEqual(n.timeseries.revenueQ.slice(0, 5).map(value), [null, null, null, null, null]);
  assert.equal(n.timeseries.revenueQ[0].financialMissing.reasonCode, 'period-after-coverage');
  assert.equal(g31Shadow(n).v1.pct, null);
});

test('Guotai Haitong: the merger note sits in the reason of the 2024 cell, the board carries no G31 hint', () => {
  // lib/g31-recency.js is a sealed GQS-00 dependency (tests/scoring/gqs00-freeze.test.js), so no fiscal-year hint entry: the
  // reason of the corrected 2024 cell carries the merger note and travels with exactly that cell.
  const out = apply(pkt('601211.SS')).snapshot;
  assert.ok(Math.abs(g31Shadow(out).v1.pct - ROWS[3][7]) < 1e-9);
  const reason = out.annual.annualRev[1].financialCorrection.reason;
  assert.match(reason, /14.03.2025/);
  assert.match(reason, /11.813 Mio. CNY um 46,35 %/);
  assert.ok(H.financialReasons(out).includes(reason), 'shown with the financial reasons of the row');
  assert.ok(Math.abs(pct(11813133439, 22019291518) + 46.35) < 0.005, 'the quarter ratio in the text');
  assert.ok(!hints.entries.some(e => e.ticker === '601211.SS'));
  assert.equal(g31Hinweis(out), null);
  // The exchange check stands down for a hand-table ticker, so every vendor quarter carries a filed value (or stays empty).
  const gq = apply(pkt('601211.SS')).snapshot.timeseries, f = F['601211.SS'].meta.fxRateApplied;
  assert.deepEqual(gq.revenueQEnds, ['2026-09-30', '2026-06-30', '2026-03-31', '2025-12-31', '2025-09-30', '2025-06-30']);
  assert.deepEqual(gq.revenueQ.map(value), [11813133439, 30930966788, 16232110965, 17215710500, null, 13657584546].map(x => x === null ? null : x * f));
  assert.equal(58976211192 - 47163077753, 11813133439, 'nine months minus the half year is the printed third quarter');
});

test('a vendor quarter after the covered one is withheld and a filed pair stays', () => {
  // Yuanta (exchange-checked listing): the older June pair is not released by the exchange check, so the filed fiscal year shows.
  for (const [t, next, end, filed] of [['6023.TWO', '2026-09-30', '2025-12-31', pct(3666813, 4013452)], ['SDE.TO', '2026-09-30', '2026-06-30', ROWS[2][7]],
    ['CHENNPETRO.NS', '2026-12-31', '2026-06-30', ROWS[1][7]]]) {
    const s = pkt(t);
    s.timeseries.revenueQ = [{ value: 7e8 }, ...s.timeseries.revenueQ];
    s.timeseries.revenueQEnds = [next, ...s.timeseries.revenueQEnds];
    const out = apply(s).snapshot, v = g31Shadow(out).v1;
    assert.equal(out.timeseries.revenueQ[0].financialMissing?.reasonCode, 'period-after-coverage', t);
    assert.equal(v.periodEnd, end, t);
    assert.ok(Math.abs(v.pct - filed) < 1e-9, t + ' ' + v.pct);
  }
  // Chennai's September 2026 is corrected, has no vendor partner, so the June pair is shown with the older-pair hint.
  const c = apply(pkt('CHENNPETRO.NS')).snapshot;
  assert.equal(value(c.timeseries.revenueQ[0]), 220554500000 * F['CHENNPETRO.NS'].meta.fxRateApplied);
  assert.equal(g31Hinweis(c)?.code, 'aelteres-quartalspaar');
  // Unread quarters of Yuanta and Spartan stay withheld (31.12.2025), never shown as vendor figures.
  for (const t of ['6023.TWO', 'SDE.TO']) {
    const o = apply(pkt(t)).snapshot.timeseries, i = o.revenueQEnds.indexOf('2025-12-31');
    assert.equal(o.revenueQ[i].financialMissing?.reasonCode, 'period-not-verified', t);
  }
});

test('Sundaram Finance: the three quarter rows act on the stored packet, whose retained vendor rows are native', () => {
  const s = pkt('SUNDARMFIN.NS'), f = s.meta.fxRateApplied;
  const own = H.table.cases.filter(c => c.ticker === 'SUNDARMFIN.NS' && c.revision === '2026-11-04-sdzahlen2' && c.field === 'revenueQ');
  assert.equal(own.length, 3);
  for (const c of own) {
    const i = s.timeseries.revenueQEnds.indexOf(c.period), held = s.timeseries.revenueQ[i];
    assert.equal(held.financialMissing.reasonCode, 'period-not-verified', 'precondition: held at pull time');
    assert.equal(value(held.financialMissing.originalVendorRow), c.expectedBadValue, 'precondition: the retained row is native INR');
    const out = apply(structuredClone(s)).snapshot.timeseries.revenueQ[i];
    assert.equal(value(out), c.replacementValue * f, c.period);
    assert.equal(out.financialCorrection.caseId, c.caseId);
  }
  assert.ok(Math.abs(g31Shadow(apply(structuredClone(s)).snapshot).v1.pct - 12.567424) < 1e-6, 'the shown June pair is unchanged');
  // Fail closed: a retained native row that is not the checked vendor figure is still withheld.
  const t = structuredClone(s), i = t.timeseries.revenueQEnds.indexOf('2026-03-31');
  t.timeseries.revenueQ[i].financialMissing.originalVendorRow.value = own[0].expectedBadValue + 1e6;
  assert.equal(apply(t).snapshot.timeseries.revenueQ[i].financialMissing.reasonCode, 'vendor-value-changed');
  // Only a hold for want of a checked case, of exactly this period, is brought to packet units; a vendor-value-changed hold
  // keeps needing its explicit legacyNativeHoldRevision (CIG-C, P177), and a hold of another period stays a hold.
  for (const edit of [h => { h.reasonCode = 'vendor-value-changed'; }, h => { h.period = '2025-12-31'; }]) {
    const u = structuredClone(s); edit(u.timeseries.revenueQ[i].financialMissing);
    assert.equal(value(apply(u).snapshot.timeseries.revenueQ[i]), null);
  }
  const r = apply(structuredClone(s)).snapshot;
  assert.deepEqual(apply(structuredClone(r)).snapshot.timeseries.revenueQ.map(value), r.timeseries.revenueQ.map(value), 'idempotent');
});

test('rows: count, one block, exact sources, a reason naming its period, plain German', () => {
  const own = H.table.cases.filter(c => c.revision === REV);
  assert.equal(own.length, 28);
  const at = H.table.cases.findIndex(c => c.revision === REV);
  assert.deepEqual(H.table.cases.slice(at, at + own.length), own, 'one block, appended after every earlier case');
  // Only the 18 Kioxia rows, the three UWMC rows and the four Hammerson rows (sd-hand-7) of the same day follow.
  assert.deepEqual(H.table.cases.slice(at + own.length).map(c => c.revision), [...Array(18).fill('2026-11-07-sdhand5b'), ...Array(3).fill('2026-11-07-sdhand5c'), ...Array(4).fill('2026-11-07-sdhand7')]);
  assert.deepEqual(Object.fromEntries(['CHENNPETRO.NS', '6023.TWO', 'SDE.TO', 'BURE.ST', '601211.SS'].map(t => [t, own.filter(c => c.ticker === t).length])),
    { 'CHENNPETRO.NS': 5, '6023.TWO': 6, 'SDE.TO': 4, 'BURE.ST': 6, '601211.SS': 7 });
  for (const c of [...own, H.table.cases.find(c => c.caseId === ONE)]) {
    const [y, m, d] = c.period.split('-');
    assert.ok(c.reason.includes(`${d}.${m}.${y}`), c.caseId + ' names its period');
    assert.match(c.reason, /Geprüft am 07\.11\.2026\.$/, c.caseId);
    assert.doesNotMatch(c.reason, /[–—]| - |kauf|verkauf/i, c.caseId);
    assert.ok(c.sources.every(s => s.url.startsWith('https://') && s.page && s.quote), c.caseId);
    if (c.replacementValue === null) continue;
    const direct = c.sources.find(s => s.value === c.replacementValue && s.end === c.period);
    assert.ok(direct || H.differenceOperands(c), c.caseId + ': traced to a source value or a documented difference');
    if (direct) assert.ok(direct.currency === c.currency && direct.unit === 'currency' && direct.start, c.caseId);
  }
  assert.equal(H.table.cases.find(c => c.caseId === ONE).sources[0].filed, '2026-10-15', '360 ONE leads with the newer report');
  assert.deepEqual(H.table.coverage.filter(v => ['CHENNPETRO.NS', '6023.TWO', 'SDE.TO', '601211.SS', 'BURE.ST'].includes(v.ticker)).map(v => v.coversThrough), ['2026-09-30', '2026-06-30', '2026-06-30', '2026-09-30', '2026-06-30']);
});

test('expectations: growth of each changed firm, bound to the issuer name, valid from the run of 10.11.2026', () => {
  const own = erwartungen.filter(e => e.id.startsWith('sdhand4-'));
  const names = Object.fromEntries(Object.entries(F).map(([t, s]) => [t, s.meta.name]));
  for (const [t, , , before, , , , after] of ROWS) {
    const e = own.find(x => x.name === names[t] && x.feld === 'revGrowthYoYPct');
    assert.ok(e, t);
    assert.equal(e.gueltigAb, '2026-11-10', t); // 07.11.2026: the next daily run is Tue 10.11. (Tue to Sat), not Sun 08.11.
    assert.ok(e.min < after && after < e.max && !(e.min < before && before < e.max), t + ': the band holds the filed value and excludes the old one');
    assert.ok(e.grund.includes('07.11.2026'), t + ' dates its number');
  }
  // Bure leaves the boards (no revenue, the router excludes it), so its expectation checks the absent row.
  const b = own.find(x => x.name === names['BURE.ST']);
  assert.deepEqual([b.id, b.op, b.board], ['sdhand4-BURE-board', 'absent', 'full/financials']);
  assert.equal(erwartungen.find(e => e.id === 'pr102-360ONENS-wachstum').gueltigBis, '2026-11-07', 'the band of 04.11.2026 held both values; it ends');
});

test('red without the rows: the vendor growth is back', () => {
  for (const [t, , , before] of ROWS) assert.ok(Math.abs(shown(t, pre).pct - before) < 0.0001, t);
  assert.ok(Math.abs(shown('BURE.ST', pre).pct - 8.2051) < 0.0001);
});

test('the live files are unchanged by this test', () => {
  assert.deepEqual(liveHashes(), beforeHashes);
});

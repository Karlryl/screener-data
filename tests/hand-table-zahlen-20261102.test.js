'use strict';
// Hand table of 02.11.2026 (lane sd-zahlen): growth figures on the boards checked against the firms' own filings, two independent
// readings per corrected row (data day 31.10.2026). 22 revenue series showed a vendor sub-line or a net figure instead of the
// printed total revenue (Indian lenders, US and other financial firms, TVS Holdings, Chudenko on its non-consolidated quarter);
// each series is covered through its last verified quarter. Aditya Birla Capital, Bajaj Housing and Sammaan Capital get every
// vendor quarter, so their acceleration axis keeps its second dated pair (with the shown pair only, Aditya Birla fell from
// rank 86 to 306 on a 1.3 point correction). Centurion Accommodation REIT (pro forma years of a dormant trust) and Shanghai Huayi
// (restated 2024 against unrestated 2023) are held. Definition hints for three Chilean pension managers and Hanwha Investment &
// Securities, period hints for BAM, Rocket and Janus Living.
// Real packets of the daily run of 31.10.2026 in tests/fixtures/hand-table-zahlen-20261102.json; every probe changes an in-memory
// copy and the live files are hashed before and after. Break-once on test data: `node tests/hand-table-zahlen-20261102.test.js
// --prove-red` runs the same assertions against the table without these rows and must exit 1.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { applyFinancialCases, financialReasons, validateTable, table, MISSING_REASONS } = require('../lib/financial-known-cases.js');
const { g31Shadow, loadHinweisTable } = require('../lib/g31-recency.js');
const hints = require('../configs/g31-hinweise.json');
const erwartungen = require('../data-health/erwartungen.json');
const F = require('./fixtures/hand-table-zahlen-20261102.json').snapshots;

const root = path.resolve(__dirname, '..');
const live = ['configs/financial-known-cases.json', 'configs/g31-hinweise.json', 'data-health/erwartungen.json', 'tests/fixtures/hand-table-zahlen-20261102.json'];
const liveHashes = () => live.map(f => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, f))).digest('hex'));
const beforeHashes = liveHashes();
const REV = '2026-11-02-sdzahlen';
const value = r => (r && typeof r === 'object' ? r.value ?? null : r ?? null);
const without = structuredClone(table);
without.cases = without.cases.filter(c => c.revision !== REV);
without.coverage = without.coverage.slice(0, -22);
validateTable(without);
const active = process.argv.includes('--prove-red') ? without : table;
const apply = s => applyFinancialCases(s, { table: active });
const leg = (t, alias) => { const s = structuredClone(F[t]); if (alias) s.meta.ticker = alias; return s; };

// ticker, aliases, shown pair, vendor growth before, filed growth after, filed current and prior quarter in native units.
const ROWS = [
  ['TSFINV.NS', [], '2026-06-30', '2025-06-30', 79.62, 70.91, 3055753000, 1787912000],
  ['NUVAMA.BO', ['NUVAMA.NS'], '2026-06-30', '2025-06-30', 9.39, 22.59, 13762200000, 11226500000],
  ['SUNDARMFIN.NS', [], '2026-06-30', '2025-06-30', 18.05, 12.57, 26441300000, 23489300000],
  ['AADHARHFC.BO', ['AADHARHFC.NS'], '2026-06-30', '2025-06-30', 15.56, 17.06, 9928900000, 8481800000],
  ['ABCAPITAL.NS', ['ABCAPITAL.BO'], '2026-06-30', '2025-06-30', 29.49, 28.17, 121795400000, 95026900000],
  ['CGCL.BO', ['CGCL.NS'], '2026-09-30', '2025-09-30', 57.95, 59.18, 17855970000, 11217710000],
  ['SAMMAANCAP.NS', [], '2026-06-30', '2025-06-30', -30.07, -31.18, 16519300000, 24003300000],
  ['BAJAJHFL.NS', ['BAJAJHFL.BO'], '2026-06-30', '2025-06-30', 17.94, 17.23, 30630200000, 26128300000],
  ['IIFL.BO', ['IIFL.NS'], '2026-06-30', '2025-06-30', 26.19, 32.73, 39191500000, 29528300000],
  ['SBFC.BO', ['SBFC.NS'], '2026-06-30', '2025-06-30', 32.4, 26.52, 4914640000, 3884360000],
  ['TVSHLTD.BO', [], '2026-06-30', '2025-06-30', 33.22, 34.01, 170761800000, 127421900000],
  ['1941.T', [], '2026-06-30', '2025-06-30', 12.61, 13.31, 50333000000, 44422000000],
  ['ATLC', [], '2026-06-30', '2025-06-30', 86.07, 88.84, 744323000, 394163000],
  ['PFSI', [], '2026-06-30', '2025-06-30', 4.36, 11.75, 496965000, 444730000],
  ['RKT', [], '2026-06-30', '2025-06-30', 85.96, 91.87, 2784000000, 1451000000],
  ['FIGR', [], '2026-06-30', '2025-06-30', 97.17, 112.66, 225588000, 106077000],
  ['BAM', ['BAM.TO'], '2026-06-30', '2025-06-30', 4.08, 60.83, 1753000000, 1090000000],
  ['SII', [], '2026-06-30', '2025-06-30', 27.8, 23.09, 80222000, 65174000],
  ['XP', [], '2026-06-30', '2025-06-30', 9.71, 8.84, 4849457000, 4455452000],
  ['KRU.WA', [], '2026-06-30', '2025-06-30', 9.21, -1.08, 788874000, 797497000],
  ['MOL.MI', [], '2026-06-30', '2025-06-30', -6.96, -5.01, 160425000, 168881000],
  ['XTB.WA', [], '2026-06-30', '2025-06-30', 69.93, 70.91, 992306000, 580597000],
];
const FULL = ['ABCAPITAL.NS', 'BAJAJHFL.NS', 'SAMMAANCAP.NS'];

test('every listing of the 22 firms shows the filed growth on the filed pair', () => {
  for (const [t, aliases, end, prior, before, after, cur, pri] of ROWS) {
    assert.ok(Math.abs(g31Shadow(leg(t)).v1.pct - before) < 0.005, t + ': precondition, the vendor growth');
    assert.ok(Math.abs(after - (cur / pri - 1) * 100) < 0.005, t + ': the literal is the filed ratio');
    for (const ticker of [t, ...aliases]) {
      const v1 = g31Shadow(apply(leg(t, ticker)).snapshot).v1;
      assert.deepEqual([v1.basis, v1.periodEnd, v1.priorPeriodEnd], ['quarter', end, prior], ticker);
      assert.ok(Math.abs(v1.pct - (cur / pri - 1) * 100) < 1e-9, ticker + ' ' + v1.pct);
    }
  }
});

test('corrected cells carry their marker; unverified vendor quarters are withheld, never shown', () => {
  for (const [t] of ROWS) {
    const raw = leg(t), out = apply(structuredClone(raw)).snapshot, ts = out.timeseries;
    const verified = new Set(active.cases.filter(c => c.ticker === t && c.field === 'revenueQ').map(c => c.period));
    ts.revenueQEnds.forEach((p, i) => {
      if (value(raw.timeseries.revenueQ[i]) === null) return;
      if (verified.has(p)) {
        const c = active.cases.find(x => x.ticker === t && x.field === 'revenueQ' && x.period === p);
        assert.equal(value(ts.revenueQ[i]), c.replacementValue * raw.meta.fxRateApplied, t + ' ' + p);
        assert.equal(ts.revenueQ[i].financialCorrection.caseId, c.caseId);
      } else {
        assert.equal(value(ts.revenueQ[i]), null, t + ' ' + p + ' withheld');
        const through = active.coverage.find(v => v.ticker === t && v.field === 'revenueQ').coversThrough;
        assert.equal(ts.revenueQ[i].financialMissing.reasonCode, p > through ? 'period-after-coverage' : 'period-not-verified', t + ' ' + p);
      }
    });
    assert.deepEqual(apply(structuredClone(out)).snapshot, out, t + ' idempotent');
    assert.deepEqual(raw, F[t], t + ' input unchanged');
  }
  // The three firms with every vendor quarter keep two dated pairs and withhold nothing.
  for (const t of FULL) {
    const out = apply(leg(t)).snapshot;
    assert.ok(out.timeseries.revenueQ.every(r => !r?.financialMissing), t);
    assert.equal(active.cases.filter(c => c.ticker === t && c.field === 'revenueQ').length, 5, t);
  }
});

test('rows: count, revision, exact sources, a reason naming its period, plain German', () => {
  const own = table.cases.filter(c => c.revision === REV);
  assert.equal(own.length, 66);
  assert.deepEqual(table.cases.slice(-66), own, 'appended after every earlier case');
  assert.equal(own.filter(c => c.field === 'revenueQ' && c.replacementValue !== null).length, 53);
  assert.equal(own.filter(c => c.replacementValue === null).length, 13);
  assert.deepEqual(table.coverage.slice(-22).map(v => v.ticker), ROWS.map(r => r[0]));
  for (const [t, aliases, end] of ROWS) {
    const v = table.coverage.find(x => x.ticker === t);
    assert.deepEqual([v.field, v.coversThrough, v.listingAliases || []], ['revenueQ', end, aliases], t);
  }
  for (const c of own) {
    const [y, m, d] = c.period.split('-');
    assert.ok(c.reason.includes(`${d}.${m}.${y}`), c.caseId + ' names its period');
    assert.match(c.reason, /Geprüft am 02\.11\.2026\.$/);
    assert.doesNotMatch(c.reason, /[–—]| - /, c.caseId);
    assert.ok(c.sources.length >= 1 && c.sources.every(s => s.url.startsWith('https://') && s.page && s.quote), c.caseId);
    if (c.replacementValue !== null) {
      // lib/g31-recency.js accepts a reviewed pair only through a source stating the exact three months, value, currency and unit.
      const s = c.sources.find(x => x.value === c.replacementValue);
      assert.ok(s && s.end === c.period && s.currency === c.currency && s.unit === 'currency' && /^\d{4}-\d{2}-01$/.test(s.start), c.caseId);
    }
  }
});

test('a revised vendor value is withheld and reported, not overwritten', () => {
  const s = leg('NUVAMA.BO'), i = s.timeseries.revenueQEnds.indexOf('2026-06-30');
  s.timeseries.revenueQ[i] = { ...s.timeseries.revenueQ[i], value: s.timeseries.revenueQ[i].value * 1.01 };
  const r = apply(s);
  assert.equal(value(r.snapshot.timeseries.revenueQ[i]), null);
  assert.ok(r.events.some(e => e.reasonCode === 'vendor-value-changed' && e.period === '2026-06-30'));
});

test('a quarter after the covered one is withheld and named in the reasons', () => {
  const s = leg('CGCL.BO');
  s.timeseries.revenueQ = [{ value: 5e8 }, ...s.timeseries.revenueQ];
  s.timeseries.revenueQEnds = ['2026-12-31', ...s.timeseries.revenueQEnds];
  const out = apply(s).snapshot;
  assert.equal(value(out.timeseries.revenueQ[0]), null);
  assert.equal(out.timeseries.revenueQ[0].financialMissing.reasonCode, 'period-after-coverage');
  assert.ok(financialReasons(out).includes(MISSING_REASONS['period-after-coverage'] + ' Das betrifft die Periode mit Ende 31.12.2026.'));
  assert.equal(g31Shadow(out).v1.periodEnd, '2026-09-30', 'the board keeps the verified quarter');
  // Series whose filed pair stays in the vendor window after a new quarter keep it (every quarter filed, an older gap in the
  // vendor window, or a vendor that already delivers 30.09.2026); the generic probe of tests/financial-known-cases.test.js leaves them out.
  for (const [t, , end, , , after] of ROWS.filter(r => FULL.includes(r[0]) || ['IIFL.BO', 'SBFC.BO', 'TVSHLTD.BO', '1941.T', 'NUVAMA.BO', 'SUNDARMFIN.NS', 'KRU.WA'].includes(r[0]))) {
    const n = leg(t), ends = n.timeseries.revenueQEnds;
    const next = ends[0] >= '2026-09-30' ? '2026-12-31' : '2026-09-30';
    n.timeseries.revenueQ = [{ value: 7e8 }, ...n.timeseries.revenueQ];
    n.timeseries.revenueQEnds = [next, ...ends];
    const o = apply(n).snapshot, v1 = g31Shadow(o).v1;
    assert.equal(value(o.timeseries.revenueQ[0]), null, t);
    assert.equal(o.timeseries.revenueQ[0].financialMissing.reasonCode, 'period-after-coverage', t);
    assert.deepEqual([v1.periodEnd, +v1.pct.toFixed(2)], [end, after], t);
  }
});

test('holds: Centurion shows no pro forma year, Shanghai Huayi no mixed-basis growth', () => {
  assert.ok(Math.abs(g31Shadow(leg('8C8U.SI')).v1.pct - 25.52) < 0.01, 'precondition');
  assert.ok(Math.abs(g31Shadow(leg('600623.SS')).v1.pct - 20.31) < 0.01, 'precondition');
  const c = apply(leg('8C8U.SI')).snapshot;
  for (const f of ['annualRev', 'annualGP', 'annualOpInc', 'annualNetIncome']) assert.deepEqual(c.annual[f].map(value), [null, null, null], f);
  assert.equal(g31Shadow(c).v1.pct, null);
  const h = apply(leg('600623.SS')).snapshot;
  assert.equal(value(h.annual.annualRev[0]), value(F['600623.SS'].annual.annualRev[0]), 'the restated 2024 stays');
  assert.deepEqual(h.annual.annualRev.slice(1).map(value), [null, null, null], '2023 is held and nothing pairs across it');
  assert.equal(g31Shadow(h).v1.pct, null);
});

test('hints: five definition rows and four period rows load, each quoted and dated', () => {
  assert.equal(loadHinweisTable(hints).length, hints.entries.length);
  const defs = hints.definitionen.filter(d => d.verifiedAt === '2026-11-02');
  assert.deepEqual(defs.map(d => d.ticker), ['CUPRUM.SN', 'AFPCAPITAL.SN', 'PROVIDA.SN', '003535.KS', '003530.KS']);
  const own = hints.entries.filter(e => /Geprüft am 02\.11\.2026\.$/.test(e.reason));
  assert.deepEqual(own.map(e => [e.ticker, e.code]), [['BAM', 'einmaleffekt'], ['BAM.TO', 'einmaleffekt'], ['RKT', 'uebernahme'], ['JAN', 'uebernahme']]);
  for (const d of [...defs, ...own]) {
    assert.equal(d.code === 'abgrenzung', defs.includes(d), d.ticker);
    assert.ok(d.sources.length && d.sources.every(s => s.url.startsWith('https://') && s.page && s.quote && s.form), d.ticker);
    assert.doesNotMatch(d.reason, /[–—]| - |kauf|verkauf/i, d.ticker);
    assert.match(d.reason, /30\.06\.2026/, d.ticker + ' names its period');
  }
  for (const e of own) assert.deepEqual([e.periodEnd, e.priorPeriodEnd], ['2026-06-30', '2025-06-30'], e.ticker);
});

test('expectations: one per corrected firm and both holds, bound to the issuer name', () => {
  const own = erwartungen.filter(e => e.pr === 99);
  assert.equal(own.length, 24);
  const names = new Set([...ROWS.map(r => r[0]), '600623.SS'].map(t => F[t].meta.name));
  assert.deepEqual(new Set(own.filter(e => e.feld === 'revGrowthYoYPct').map(e => e.name)), names);
  for (const e of own) {
    assert.equal(e.ticker, undefined, e.id + ': the shown listing can change, the name stays');
    assert.equal(e.gueltigAb, '2026-11-03');
    if (e.op === 'between') {
      const row = ROWS.find(r => F[r[0]].meta.name === e.name);
      assert.ok(e.min < row[5] && row[5] < e.max && e.max - e.min < 0.61, e.id);
    }
  }
  assert.ok(own.some(e => e.name === F['8C8U.SI'].meta.name && e.board === 'any' && e.op === 'absent'));
});

test('red without the rows: the vendor growth is back on every firm', () => {
  for (const [t, , , , before] of ROWS) {
    assert.ok(Math.abs(g31Shadow(applyFinancialCases(leg(t), { table: without }).snapshot).v1.pct - before) < 0.005, t);
  }
});

test('the live files are unchanged by this test', () => {
  assert.deepEqual(liveHashes(), beforeHashes);
});

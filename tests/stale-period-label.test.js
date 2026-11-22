'use strict';
// Stufe 4 (22.11.2026): a shown period older than a newer published one carries `newerPeriod` (boards) or `np` (filter feed)
// with a fixed reason code; a current row carries none. Label only: the replay of 21.11.2026 changed no other leaf
// (docs/stale-period-label-vorher-nachher-2026-11-22.md). Synthetic snapshots modelled on real rows of that day.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
// The board writer reads the real export-w8 snapshots (DAR.L: Yahoo 30.06.2026, annual figures only; CBDK.JK current).
const W8 = path.join(__dirname, 'fixtures', 'export-w8');
process.env.FINDASH_SNAPSHOTS_DIR = path.join(W8, 'snapshot-files');
process.env.FINDASH_SMALLCAP_SNAPSHOTS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'stale-period-sc-'));
const L = require('../lib/stale-period.js');
const { buildUniverse, validateUniverse } = require('../scripts/write-filter-universe.js');
const wfe = require('../scripts/write-findash-export.js');
const R40 = require('../scripts/write-rule40-export.js');
const { baueExport, boardZeile, snapshot: r40Snapshot } = require('./rule40-fixture.js');
const { maskStaleQuarterSeries } = require('../lib/annual-pairs.js');

const v = x => (x === null ? null : { value: x });
// DNO.OL on 21.11.2026: Q3 2026 stored, Q3 2025 absent at the vendor, so the board shows Q2 2026 against Q2 2025.
const dno = (over = {}) => ({
  meta: { ticker: 'DNOX.OL', mostRecentQuarter: '2026-09-30T00:00:00.000Z', ...over.meta },
  timeseries: {
    revenueQ: [150, 140, 120, 110, 100, 90].map(v), revenueQEnds: ['2026-09-30', '2026-06-30', '2026-03-31', '2025-12-31', '2025-06-30', '2025-03-31'],
    grossProfitQ: [60, 55, 50, 45, 40, 35].map(v), grossProfitQEnds: ['2026-09-30', '2026-06-30', '2026-03-31', '2025-12-31', '2025-06-30', '2025-03-31'],
    ...over.timeseries,
  },
  annual: { annualRev: [v(400), v(300)], annualRevEnds: ['2025-12-31', '2024-12-31'] },
});
// The same company once the vendor has delivered Q3 2025: the newest quarter has its pair, nothing is stale.
const current = () => dno({ timeseries: {
  revenueQ: [150, 140, 120, 110, 105, 100].map(v), revenueQEnds: ['2026-09-30', '2026-06-30', '2026-03-31', '2025-12-31', '2025-09-30', '2025-06-30'] } });

test('a stale growth row gets the label with code, date, evidence and the German hint; a current row gets none', () => {
  const label = L.newerPeriodLabel(L.newerPeriodFacts(dno(), '2026-11-21'), { revGrowth: '2026-06-30' });
  assert.deepEqual(label, { end: '2026-09-30', evidence: 'quarter', fields: { revGrowth: 'vorjahr-fehlt' },
    hint: 'Neuerer Zeitraum veröffentlicht (bis 30.09.2026), hier noch nicht verwendet: Umsatzwachstum, weil das Vorjahresquartal in den Anbieterdaten fehlt.' });
  assert.ok(L.validNewerPeriod(label));
  assert.equal(L.newerPeriodLabel(L.newerPeriodFacts(current(), '2026-11-21'), { revGrowth: '2026-09-30' }), null);
  assert.equal(L.newerPeriodLabel(L.newerPeriodFacts(dno(), '2026-11-21'), { revGrowth: null, grossProfit: null, fcfMargin: null }), null);
});

test('45 days are the slack itself (fiscal quarter ends drift); one day more counts', () => {
  const facts = L.newerPeriodFacts(dno(), '2026-11-21');
  assert.equal(L.newerPeriodLabel(facts, { revGrowth: '2026-08-16' }), null);
  assert.equal(L.newerPeriodLabel(facts, { revGrowth: '2026-08-15' })?.fields.revGrowth, 'vorjahr-fehlt');
});

test('Yahoo-only evidence: annual-only firm (GFI) and a quarterly series behind (7685.T), both said to rest on Yahoo', () => {
  const annualOnly = { meta: { ticker: 'GFIX', mostRecentQuarter: '2026-06-30' }, timeseries: {}, annual: { annualRev: [v(5), v(3)], annualRevEnds: ['2025-12-31', '2024-12-31'] } };
  const a = L.newerPeriodLabel(L.newerPeriodFacts(annualOnly, '2026-11-21'), { revGrowth: '2025-12-31' });
  assert.equal(a.evidence, 'yahoo');
  assert.deepEqual(a.fields, { revGrowth: 'nur-jahreswerte' });
  assert.match(a.hint, /^Neuerer Zeitraum laut Yahoo veröffentlicht \(bis 30\.06\.2026\), .*weil der Anbieter dafür nur Jahreswerte liefert\.$/);
  const behind = dno({ meta: { mostRecentQuarter: '2026-12-31' }, timeseries: { revenueQ: [140, 120, 110, 105, 100].map(v), revenueQEnds: ['2026-06-30', '2026-03-31', '2025-12-31', '2025-09-30', '2025-06-30'] } });
  assert.deepEqual(L.newerPeriodLabel(L.newerPeriodFacts(behind, '2027-01-20'), { revGrowth: '2026-06-30' }).fields, { revGrowth: 'anbieter-verzug' });
  // A Yahoo date after the data day is not published: nothing newer than the shown quarter remains.
  assert.equal(L.newerPeriodLabel(L.newerPeriodFacts(behind, '2026-11-21'), { revGrowth: '2026-06-30' }), null);
});

test('gross profit and FCF periods are labelled with their own codes', () => {
  const noGpPartner = dno({ timeseries: { grossProfitQ: [60, 55, 50, 45, null, 35].map(v) } });
  const label = L.newerPeriodLabel(L.newerPeriodFacts(noGpPartner, '2026-11-21'), { revGrowth: '2026-09-30', grossProfit: '2025-12-31', fcfMargin: '2026-06-30' });
  assert.deepEqual(label.fields, { grossProfit: 'vorjahr-fehlt', fcfMargin: 'fcf-ttm-alt' });
  assert.match(label.hint, /Bruttogewinn-Wachstum, weil .*; FCF-Marge, weil die Zwölfmonatswerte des Free Cashflow noch nicht so weit reichen\.$/);
  // Two fields with the same reason share one clause (DNO.OL: growth and gross profit both lack the year-ago quarter).
  assert.match(L.newerPeriodLabel(L.newerPeriodFacts(dno(), '2026-11-21'), { revGrowth: '2026-06-30', grossProfit: '2025-12-31' }).hint,
    /verwendet: Umsatzwachstum und Bruttogewinn-Wachstum, weil das Vorjahresquartal in den Anbieterdaten fehlt\.$/);
});

test('a present year-ago value that fails a check is paar-gesperrt; an exchange refusal of the older pair is boersenabgleich', () => {
  assert.equal(L.newerPeriodFacts(current(), '2026-11-21').codes.revGrowth, 'paar-gesperrt');
  const X = require('../lib/exchange-quarter-check.js'), real = X.evaluate;
  try {
    X.evaluate = () => ({ category: 'would-withhold' }); // 600120.SS on 21.11.: vendor Q2 2025 deviates from Eastmoney
    const cn = dno({ meta: { ticker: '600120.SS' } });
    assert.equal(L.newerPeriodFacts(cn, '2026-11-21').codes.revGrowth, 'boersenabgleich');
    assert.equal(L.newerPeriodFacts(dno(), '2026-11-21').codes.revGrowth, 'vorjahr-fehlt', 'outside CN/TW the exchange verdict is not read');
    X.evaluate = () => ({ category: 'agree' });
    assert.equal(L.newerPeriodFacts(cn, '2026-11-21').codes.revGrowth, 'vorjahr-fehlt');
  } finally { X.evaluate = real; }
});

test('newestPublished is the shared date rule of the hint neuerer-bericht (AEHR: month-end store vs exact Yahoo date)', () => {
  assert.deepEqual(L.newestPublished({ mostRecentQuarter: '2026-09-25' }, '2026-09-30'), { end: '2026-09-25', evidence: 'quarter' });
  assert.deepEqual(L.newestPublished({ mostRecentQuarter: '2026-06-30' }, '2026-09-30'), { end: '2026-09-30', evidence: 'quarter' });
  assert.deepEqual(L.newestPublished({ mostRecentQuarter: '2026-09-30' }, '2026-06-30'), { end: '2026-09-30', evidence: 'yahoo' });
  assert.equal(L.newestPublished({ mostRecentQuarter: 'kaputt' }, null), null);
  assert.match(wfe.newerReportHint({ mostRecentQuarter: '2026-06-30' }, { basis: 'year', periodEnd: '2025-12-31' }, { storedQuarterEnd: '2026-09-30' }).reason, /Zahlen bis 30\.09\.2026 /);
});

test('compact form and contract: codes come from the fixed list only', () => {
  const label = L.newerPeriodLabel(L.newerPeriodFacts(dno(), '2026-11-21'), { revGrowth: '2026-06-30', fcfMargin: '2026-03-31' });
  assert.equal(L.compactNewerPeriod(label), '2026-09-30:vf:fa');
  assert.deepEqual(L.decodeNewerPeriod('2026-09-30:vf:fa'), { end: '2026-09-30', evidence: 'quarter', fields: { revGrowth: 'vorjahr-fehlt', fcfMargin: 'fcf-ttm-alt' } });
  assert.deepEqual(L.decodeNewerPeriod('2026-06-30y::fa'), { end: '2026-06-30', evidence: 'yahoo', fields: { fcfMargin: 'fcf-ttm-alt' } });
  // Every fixed code survives the round trip through the compact string.
  for (const code of Object.keys(L.REASONS)) {
    const c = L.compactNewerPeriod({ end: '2026-09-30', evidence: 'yahoo', fields: { revGrowth: code } });
    assert.deepEqual(L.decodeNewerPeriod(c).fields, { revGrowth: code }, code);
  }
  assert.ok(L.validNewerPeriod(L.compactNewerPeriod(label), true));
  assert.equal(L.validNewerPeriod({ ...label, fields: { revGrowth: 'geraten' } }), false);
  for (const bad of ['2026-09-30:xx:', '2026-09-30::', '2026-02-30:vf:', '2026-09-30q:vf:', { e: '2026-09-30', b: 'q', g: 'vf' }]) {
    assert.equal(L.validNewerPeriod(bad, true), false, JSON.stringify(bad));
  }
  assert.equal(L.validNewerPeriod(null), true);
  const errors = [];
  wfe.validateFile({ schema: wfe.SCHEMA, generated_at: 'x', boardStatus: 'core', coverage: null, branch: 'energy',
    profitable: [{ newerPeriod: { ...label, end: '2026-02-30' } }], unprofitable: [] }, 'energy', errors);
  assert.ok(errors.some(e => /newerPeriod outside its contract/.test(e)));
});

test('filter feed: np on the stale board row, none on the current one, and the validator rejects a broken np', () => {
  const pay = require('./fixtures/w6/snapshots.json').find(s => s.meta.ticker === 'PAY');
  const stale = { ...pay, meta: { ...pay.meta, ticker: 'OLD', mostRecentQuarter: '2026-09-30' } };
  const fresh = { ...pay, meta: { ...pay.meta, ticker: 'NEW', mostRecentQuarter: '2026-09-30' } };
  const row = end => ({ branch: 'software-comm-services', row: { score: 50, rank: 1, marketCap: 1e9, revGrowthYoYPct: 10, revGrowthPeriodEnd: end } });
  const feed = buildUniverse({ snapshots: [stale, fresh], boards: new Map([['OLD', row('2025-12-31')], ['NEW', row('2026-09-30')]]), generatedAt: '2026-10-10T12:00:00Z' });
  const [neu, alt] = feed.rows;
  assert.equal(alt.np, '2026-09-30y:nj:');
  assert.equal(Object.hasOwn(neu, 'np'), false);
  assert.deepEqual(validateUniverse(feed, Buffer.byteLength(JSON.stringify(feed))), []);
  for (const bad of ['2026-09-30y:zz:', '2026-09-30y::fa']) { // unknown code; FCF label without a shown FCF period
    alt.np = bad;
    assert.ok(validateUniverse(feed, Buffer.byteLength(JSON.stringify(feed))).includes('OLD: invalid np'), bad);
  }
});

// Review B1 (22.11.2026): a quarterly series the age mask (annual-pairs maskStaleQuarterSeries, reasonCode series-stale) nulls still
// came from the vendor; "nur Jahreswerte" was false there (MKS.L, BFIT.AS, FNAC.PA). The vendor row stays in originalVendorRow.
test('a series the age mask nulled is quartale-zu-alt, not nur-jahreswerte', () => {
  const before = process.env.RUN_DATE_UTC;
  process.env.RUN_DATE_UTC = '2026-11-21';
  try {
    const old = dno({ meta: { mostRecentQuarter: '2026-09-30' }, timeseries: {
      revenueQ: [140, 120, 110, 100].map(v), revenueQEnds: ['2025-06-30', '2025-03-31', '2024-12-31', '2024-06-30'],
      grossProfitQ: [50, 45, 40, 35].map(v), grossProfitQEnds: ['2025-06-30', '2025-03-31', '2024-12-31', '2024-06-30'] } });
    const masked = maskStaleQuarterSeries(old);
    assert.equal(masked.timeseries.revenueQ[0].financialMissing.reasonCode, 'series-stale', 'fixture: the mask nulled the series');
    const facts = L.newerPeriodFacts(masked, '2026-11-21');
    assert.deepEqual(facts.codes, { revGrowth: 'quartale-zu-alt', grossProfit: 'quartale-zu-alt' });
    assert.match(L.newerPeriodLabel(facts, { revGrowth: '2025-12-31' }).hint,
      /Umsatzwachstum, weil die Quartalswerte des Anbieters zu alt sind und deshalb nicht verwendet werden\.$/);
    // Without any vendor quarter it stays nur-jahreswerte.
    const annualOnly = { meta: { ticker: 'GFIX', mostRecentQuarter: '2026-06-30' }, timeseries: {}, annual: { annualRev: [v(5), v(3)], annualRevEnds: ['2025-12-31', '2024-12-31'] } };
    assert.equal(L.newerPeriodFacts(maskStaleQuarterSeries(annualOnly), '2026-11-21').codes.revGrowth, 'nur-jahreswerte');
  } finally { if (before === undefined) delete process.env.RUN_DATE_UTC; else process.env.RUN_DATE_UTC = before; }
});

// Review S1: a vendor value our own rules hold back (hand table period-after-coverage, JIOFIN.NS on 21.11.) is not a vendor gap.
test('a newest or year-ago quarter we hold back gets its own code; a non-positive year-ago value says so', () => {
  const hold = (value, reasonCode) => ({ value: null, financialMissing: { reasonCode, originalVendorRow: { value } } });
  const jio = dno({ meta: { ticker: 'JIOX.NS', mostRecentQuarter: '2026-09-30' }, timeseries: {
    revenueQ: [hold(150, 'period-after-coverage'), v(140), v(120), v(110), v(105), v(100)],
    revenueQEnds: ['2026-09-30', '2026-06-30', '2026-03-31', '2025-12-31', '2025-09-30', '2025-06-30'] } });
  const facts = L.newerPeriodFacts(jio, '2026-11-21');
  assert.equal(facts.evidence, 'yahoo', 'the held cell is no stored value');
  assert.equal(facts.codes.revGrowth, 'wert-zurueckgehalten');
  assert.match(L.newerPeriodLabel(facts, { revGrowth: '2026-06-30' }).hint, /weil unsere Datenprüfung den neuesten Quartalswert des Anbieters zurückhält\.$/);
  // Nested holds (a hand-table hold inside the age mask) still count as a vendor value.
  const nested = dno({ timeseries: { revenueQ: [{ value: null, financialMissing: { reasonCode: 'context-changed', originalVendorRow: hold(150, 'zero') } }, v(140), v(120), v(110), v(100), v(90)] } });
  assert.equal(L.newerPeriodFacts(nested, '2026-11-21').codes.revGrowth, 'wert-zurueckgehalten');
  const yearAgoHeld = dno({ timeseries: { revenueQ: [v(150), v(140), v(120), v(110), hold(105, 'period-not-verified'), v(100)],
    revenueQEnds: ['2026-09-30', '2026-06-30', '2026-03-31', '2025-12-31', '2025-09-30', '2025-06-30'] } });
  assert.equal(L.newerPeriodFacts(yearAgoHeld, '2026-11-21').codes.revGrowth, 'vorjahr-zurueckgehalten');
  const negative = dno({ timeseries: { revenueQ: [150, 140, 120, 110, -5, 100].map(v),
    revenueQEnds: ['2026-09-30', '2026-06-30', '2026-03-31', '2025-12-31', '2025-09-30', '2025-06-30'] } });
  assert.equal(L.newerPeriodFacts(negative, '2026-11-21').codes.revGrowth, 'vorjahr-nicht-positiv');
});

// Review nit: Yahoo's date alone is no proof when the report calendar still expects that report after the data day (ZEG.L, ZEGLF).
test('a Yahoo-only period whose report is still due after the data day is not called published', () => {
  const meta = { mostRecentQuarter: '2026-09-30T00:00:00.000Z' };
  assert.equal(L.newestPublished(meta, '2026-06-30', '2026-11-21', '2026-11-24').end, '2026-06-30');
  assert.equal(L.newestPublished(meta, null, '2026-11-21', '2026-11-24'), null);
  assert.equal(L.newestPublished(meta, null, '2026-11-21', '2026-11-12').end, '2026-09-30', 'a report already out does not drop it');
  assert.equal(L.newestPublished(meta, null, '2026-11-21', '2027-01-14').end, '2026-09-30', '106 days later is the next period (JPM)');
  assert.equal(L.newestPublished(meta, null, '2026-11-21', '2027-01-03'), null, '95 days is the limit itself');
  assert.equal(L.newestPublished(meta, null, '2026-11-21', '2027-01-04').end, '2026-09-30', '96 days');
  assert.equal(L.newestPublished(meta, null, null, '2026-11-24').end, '2026-09-30', 'without a data day no calendar check');
  const cal = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'stale-cal-')), 'earnings-calendar.json');
  fs.writeFileSync(cal, JSON.stringify({ 'ZEG.L': { date: '2026-11-24', pulledAt: '2026-11-20' } }));
  const of = L.reportCalendar(cal);
  assert.equal(of('ZEG.L'), '2026-11-24');
  assert.equal(of('NONE'), null);
});

// Review S2: both board writers emit the label (mutating either writer line turned this red once, see the Vorher/Nachher doc).
test('board writer: mapBoardRow labels the stale DAR.L row and leaves the current CBDK.JK row null, label last', () => {
  const rows = JSON.parse(fs.readFileSync(path.join(W8, 'real-estate-rows.json'), 'utf8')).rows;
  const map = t => wfe.mapBoardRow(structuredClone(rows.find(r => r.ticker === t)), 0);
  const dar = map('DAR.L');
  assert.deepEqual(dar.newerPeriod, { end: '2026-06-30', evidence: 'yahoo', fields: { revGrowth: 'nur-jahreswerte' },
    hint: 'Neuerer Zeitraum laut Yahoo veröffentlicht (bis 30.06.2026), hier noch nicht verwendet: Umsatzwachstum, weil der Anbieter dafür nur Jahreswerte liefert.' });
  assert.equal(Object.keys(dar).at(-1), 'newerPeriod');
  const cbdk = map('CBDK.JK');
  assert.equal(cbdk.revGrowthPeriodEnd, '2026-06-30');
  assert.ok(Object.hasOwn(cbdk, 'newerPeriod'));
  assert.equal(cbdk.newerPeriod, null);
});

test('Rule of 40 writer: build labels the stale row (growth and FCF) and leaves the current one null', () => {
  const stale = r40Snapshot({ ticker: 'AAA' });
  stale.meta.mostRecentQuarter = '2026-09-30';
  const f = baueExport([{ row: boardZeile(), snap: stale }, { row: boardZeile({ ticker: 'BBB', name: 'Beta AG', rank: 2, score: 70 }) }]);
  R40.build(f);
  const rows = JSON.parse(fs.readFileSync(path.join(f.outDir, 'overview.json'), 'utf8')).rows;
  const by = t => rows.find(r => r.ticker === t);
  assert.deepEqual(by('AAA').newerPeriod?.fields, { revGrowth: 'anbieter-verzug', fcfMargin: 'fcf-ttm-alt' });
  assert.equal(by('AAA').newerPeriod.end, '2026-09-30');
  assert.equal(by('BBB').newerPeriod, null);
  assert.deepEqual(R40.check(f).errors, []);
});

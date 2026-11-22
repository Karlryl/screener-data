'use strict';
// Stufe 4 (22.11.2026): a shown period older than a newer published one carries `newerPeriod` (boards) or `np` (filter feed)
// with a fixed reason code; a current row carries none. Label only: the replay of 21.11.2026 changed no other leaf
// (docs/stale-period-label-vorher-nachher-2026-11-22.md). Synthetic snapshots modelled on real rows of that day.
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../lib/stale-period.js');
const { buildUniverse, validateUniverse } = require('../scripts/write-filter-universe.js');
const wfe = require('../scripts/write-findash-export.js');

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
  assert.deepEqual(L.compactNewerPeriod(label), { e: '2026-09-30', b: 'q', g: 'vf', f: 'fa' });
  assert.ok(L.validNewerPeriod(L.compactNewerPeriod(label), true));
  assert.equal(L.validNewerPeriod({ ...label, fields: { revGrowth: 'geraten' } }), false);
  assert.equal(L.validNewerPeriod({ e: '2026-09-30', b: 'q', g: 'xx' }, true), false);
  assert.equal(L.validNewerPeriod({ e: '2026-09-30', b: 'q' }, true), false);
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
  assert.deepEqual(alt.np, { e: '2026-09-30', b: 'y', g: 'nj' });
  assert.equal(Object.hasOwn(neu, 'np'), false);
  assert.deepEqual(validateUniverse(feed, Buffer.byteLength(JSON.stringify(feed))), []);
  alt.np = { e: '2026-09-30', b: 'y', g: 'zz' };
  assert.ok(validateUniverse(feed, Buffer.byteLength(JSON.stringify(feed))).includes('OLD: invalid np'));
});

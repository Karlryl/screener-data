'use strict';
// tests/sec-quarter-fill.test.js — standalone runner (exit 0/1). SEC quarter fill (question i of P309): a filed quarter the
// vendor lacks reaches only the growth leg, on the vendor's own definition, in USD, with period, length and derivation proven.
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { spawnSync } = require('node:child_process');
const X = require('../lib/exchange-quarter-check.js');
const { pitSingleQuarters } = require('../lib/sec-pit.js');
const { g31Shadow } = require('../lib/g31-recency.js');
const { revGrowthLeg } = require('../lib/rev-growth-basis.js');
const { financialReasons } = require('../lib/financial-known-cases.js');
const { captureSnapshot } = require('../lib/export-provenance.js');
const axes = require('../src/scoring/axes.js');
const { main } = require('../scripts/fetch-exchange-quarters.js');
const { SEC_CONCEPTS } = X;

let pass = 0, fail = 0;
const pending = [];
function test(name, fn) {
  pending.push(async () => {
    try { await fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + (e && e.stack || e)); }
  });
}

// Amazon, real numbers: the vendor stops at 31.03.2026, the 10-Q to 30.06.2026 was filed on 31.07.2026.
const ENDS = ['2026-03-31', '2025-12-31', '2025-09-30', '2025-06-30', '2025-03-31'];
const VALUES = [181519e6, 213386e6, 180169e6, 167702e6, 155667e6];
const snapshot = (over = {}) => ({
  meta: { ticker: 'AMZNX', fxConverted: true, reportingCurrency: 'USD', reportingCurrencyOriginal: 'USD', fxRateApplied: 1,
    asOf: '2026-10-31T09:03:22.271Z', fetchedAt: '2026-10-30T09:18:42.882Z', ...over.meta },
  timeseries: { revenueQ: VALUES.map(value => ({ value })), revenueQEnds: [...ENDS], opIncQ: VALUES.map(() => ({ value: 1e9 })), opIncQEnds: [...ENDS], ...over.timeseries },
  annual: { annualRev: [{ value: 716924e6 }, { value: 637959e6 }], annualRevEnds: ['2025-12-31', '2024-12-31'] },
  metrics: {}, marketCap: {},
});
const obs = (val, filed = '2026-07-31', extra = {}) => [{ start: 'x', val, filed, form: '10-Q', accn: '0001018724-26-000026', days: 90, derivation: 'reported-3M', confirmedBy: [{ src: 's', fetchedAt: '2026-10-30T13:40:00.000Z', updateDate: filed }], ...extra }];
const quarters = (over = {}) => {
  const q = { '2026-06-30': obs(200606e6) };
  ENDS.forEach((e, i) => { q[e] = obs(VALUES[i], '2026-05-01'); });
  return { ...q, ...over };
};
const store = (group = quarters(), concept = 'RevenueFromContractWithCustomerExcludingAssessedTax') => ({
  schemaVersion: 1, market: 'US', currency: 'USD', sources: { s: { fetchedAt: '2026-10-30T13:40:00.000Z' } }, companies: { AMZNX: { cik: '0001018724', [concept]: group } } });
const run = (s, st = store(), options = {}) => X.applyExchangeCheck(s, { mode: 'fill-only', usFill: true, context: { stores: { us: st }, baseline: { rows: new Map() } }, ...options });
const whyOf = (s, st) => { const r = run(s, st); assert.equal(r.snapshot.meta.secQuarterFill, undefined, 'must not fill'); return r.result.why; };

test('fill: the filed quarter leads the growth, labelled with its period (AMZN 16.6 -> 19.6 %)', () => {
  const before = revGrowthLeg(snapshot());
  assert.equal(before.sourcePeriodEnd, '2026-03-31');
  const { snapshot: s, result } = run(snapshot());
  assert.equal(result.category, 'sec-fill');
  const leg = revGrowthLeg(s);
  assert.equal(leg.basis, 'quarter');
  assert.equal(leg.sourcePeriodEnd, '2026-06-30');
  assert.equal(leg.sourcePriorPeriodEnd, '2025-06-30');
  assert.ok(Math.abs(leg.pct - (200606 / 167702 - 1) * 100) < 1e-9);
  assert.equal(axes.revGrowthLevel(s), (200606e6 / 167702e6 - 1) * 100);
  assert.deepEqual(g31Shadow(s).v1.bonusComponents.length, 2);
});

test('fill: every other reader keeps the vendor rows; the series and the operating margin path stay byte-identical', () => {
  const raw = snapshot();
  const { snapshot: s } = run(raw);
  assert.deepEqual(s.timeseries, raw.timeseries);
  assert.equal(axes.marginTrajectory(s), axes.marginTrajectory(raw));
  assert.equal(axes.revAcceleration(s), axes.revAcceleration(raw));
});

test('fill: the reason names source, form, filing date and period; provenance points at the filing', () => {
  const { snapshot: s } = run(snapshot());
  const text = financialReasons(s).join(' ');
  assert.match(text, /bis 30\.06\.2026/); assert.match(text, /10-Q/); assert.match(text, /eingereicht 31\.07\.2026/);
  assert.doesNotMatch(text, /abgeleitet/);
  const cap = captureSnapshot(s).revenueInputs ?? captureSnapshot(s).inputs;
  assert.equal(cap.length, 2);
  assert.equal(cap[0].sourceType, 'filing');
  assert.equal(cap[0].nativeValue, 200606e6);
  assert.equal(cap[1].nativeValue, 167702e6);
  assert.match(cap[0].documentUrl, /\/1018724\/000101872426000026\/0001018724-26-000026-index\.html$/);
});

test('derived quarter says so, on both legs', () => {
  const q = quarters({ '2026-06-30': obs(200606e6, '2026-07-31', { derivation: 'YTD-minus-YTD' }), '2025-06-30': obs(167702e6, '2026-05-01', { derivation: 'year-minus-9M' }) });
  const { snapshot: s } = run(snapshot(), store(q));
  assert.equal(s.meta.secQuarterFill.derivation, 'YTD-minus-YTD');
  assert.equal(s.meta.secQuarterFill.priorDerivation, 'year-minus-9M');
  const text = financialReasons(s).join(' ');
  assert.match(text, /Der Quartalswert ist aus kumulierten Werten abgeleitet/);
  assert.match(text, /Der Vorjahreswert ist aus kumulierten Werten abgeleitet/);
});

test('no fill: another definition (one stored quarter off by more than the tolerance)', () => {
  assert.equal(whyOf(snapshot(), store(quarters({ '2025-12-31': obs(213386e6 * 1.01, '2026-05-01') }))), 'concept-disagrees');
});
test('no fill: fewer than two quarters prove the definition', () => {
  const q = { '2026-06-30': obs(200606e6), '2025-06-30': obs(167702e6, '2026-05-01') };
  assert.equal(whyOf(snapshot(), store(q)), 'too-few-agreeing-quarters');
});
test('no fill: no year-ago quarter in the window', () => {
  const q = quarters(); delete q['2025-06-30'];
  assert.equal(whyOf(snapshot(), store(q)), 'no-year-ago-quarter');
});
test('no fill: durations differ (a 16-week quarter against 13 weeks)', () => {
  assert.equal(whyOf(snapshot(), store(quarters({ '2026-06-30': obs(200606e6, '2026-07-31', { days: 112 }) }))), 'durations-differ');
});
test('no fill: zero revenue in the quarter or the year ago forms no growth', () => {
  assert.equal(whyOf(snapshot(), store(quarters({ '2026-06-30': obs(0) }))), 'not-positive');
});
test('no fill: another currency, or a USD-converted statement', () => {
  assert.equal(whyOf(snapshot({ meta: { reportingCurrencyOriginal: 'EUR', fxRateApplied: 1.1 } })), 'currency');
});
test('no fill: the same quarter at the vendor under a normalised end (AAP 2026-07-18 stands as 2026-06-30)', () => {
  const raw = snapshot({ timeseries: { revenueQ: [{ value: 200606e6 }, ...VALUES.slice(1).map(value => ({ value }))], revenueQEnds: ['2026-06-30', ...ENDS.slice(1)] } });
  const q = quarters({ '2026-07-18': obs(200606e6, '2026-08-20') });
  assert.equal(whyOf(raw, store(q)), 'no-newer-quarter');
});
test('no fill: a filing later than the data day of the snapshot is not known yet', () => {
  assert.equal(whyOf(snapshot({ meta: { asOf: '2026-07-30T09:00:00.000Z' } })), 'no-newer-quarter');
});
test('the fill lapses by itself once the vendor delivers the quarter', () => {
  const raw = snapshot({ timeseries: { revenueQ: [{ value: 200606e6 }, ...VALUES.map(value => ({ value }))], revenueQEnds: ['2026-06-30', ...ENDS] } });
  assert.equal(whyOf(raw), 'no-newer-quarter');
  assert.equal(revGrowthLeg(raw).sourcePeriodEnd, '2026-06-30');
});
test('a firm without a store entry is untouched; a stale marker in the input never survives', () => {
  const raw = snapshot({ meta: { ticker: 'OTHER' } });
  assert.equal(run(raw).result, null);
  const again = run({ ...raw, meta: { ...raw.meta, secQuarterFill: { end: 'x', current: 1, prior: 1 } } });
  assert.equal(again.snapshot.meta.secQuarterFill, undefined);
  assert.deepEqual(again.snapshot.timeseries, raw.timeseries);
});
test('policy switch off and shadow mode change nothing', () => {
  const raw = snapshot();
  assert.equal(run(raw, store(), { usFill: false }).snapshot.meta.secQuarterFill, undefined);
  assert.equal(run(raw, store(), { mode: 'shadow' }).snapshot.meta.secQuarterFill, undefined);
  assert.equal(run(raw, store(), { mode: 'shadow' }).result.category, 'sec-fill');
});

// ── Derivation ───────────────────────────────────────────────────────────────
const fact = (start, end, val, filed, form = '10-Q', accn = 'a') => ({ start, end, val, filed, form, accn });
test('single quarters: reported three months win over a cumulative difference', () => {
  const q = pitSingleQuarters([fact('2026-01-01', '2026-06-30', 250, '2026-07-31'), fact('2026-04-01', '2026-06-30', 150, '2026-07-31'), fact('2026-01-01', '2026-03-31', 100, '2026-05-01')]);
  assert.deepEqual(q.map(x => [x.end, x.val, x.derivation]), [['2026-06-30', 150, 'reported-3M'], ['2026-03-31', 100, 'reported-3M']]);
  // Codex R2 on #85 (P1-1): when the cumulative difference contradicts the reported quarter (300 - 100 = 200, not 150) the end stays open.
  const bad = pitSingleQuarters([fact('2026-01-01', '2026-06-30', 300, '2026-07-31'), fact('2026-04-01', '2026-06-30', 150, '2026-07-31'), fact('2026-01-01', '2026-03-31', 100, '2026-05-01')]);
  assert.equal(bad.find(x => x.end === '2026-06-30').derivation, 'restatement-conflict');
});
test('single quarters: cumulative minus the earlier cumulative with the same start says so', () => {
  const q = pitSingleQuarters([fact('2026-01-01', '2026-06-30', 300, '2026-09-21'), fact('2026-01-01', '2026-03-31', 100, '2026-05-01')]);
  assert.deepEqual([q[0].end, q[0].val, q[0].derivation, q[0].filed], ['2026-06-30', 200, 'YTD-minus-YTD', '2026-09-21']);
});
test('single quarters: a cumulative fact with another start never pairs', () => {
  const q = pitSingleQuarters([fact('2026-01-01', '2026-06-30', 300, '2026-07-31'), fact('2025-10-01', '2026-03-31', 100, '2026-05-01')]);
  assert.equal(q.length, 0);
});
test('single quarters: year minus nine months, then year minus three quarters', () => {
  const nine = pitSingleQuarters([fact('2025-01-01', '2025-12-31', 400, '2026-02-20', '10-K'), fact('2025-01-01', '2025-09-30', 290, '2025-11-01')]);
  assert.deepEqual([nine[0].end, nine[0].val, nine[0].derivation], ['2025-12-31', 110, 'year-minus-9M']);
  const three = pitSingleQuarters([fact('2025-01-01', '2025-12-31', 400, '2026-02-20', '10-K'), fact('2025-01-01', '2025-03-31', 90, '2025-05-01'), fact('2025-04-01', '2025-06-30', 100, '2025-08-01'), fact('2025-07-01', '2025-09-30', 100, '2025-11-01')]);
  assert.deepEqual([three[0].end, three[0].val, three[0].derivation, three[0].filed], ['2025-12-31', 110, 'year-minus-three-quarters', '2026-02-20']);
});
test('single quarters: later filing wins, a filing after asOf is unknown, other forms are ignored', () => {
  // Codex R2 on #85: no latest-filing-wins any more; a 10-Q/A with another figure (151 against 150) opens the period.
  const rows = [fact('2026-04-01', '2026-06-30', 150, '2026-07-31'), fact('2026-04-01', '2026-06-30', 150.5, '2026-09-01', '10-Q/A'), fact('2026-04-01', '2026-06-30', 999, '2026-09-02', '8-K')];
  assert.deepEqual([pitSingleQuarters(rows)[0].val, pitSingleQuarters(rows)[0].derivation, pitSingleQuarters(rows)[0].filed], [150, 'reported-3M', '2026-07-31'], 'an amendment within 0.5 % is the same figure, dated by its first filing');
  assert.equal(pitSingleQuarters([...rows, fact('2026-04-01', '2026-06-30', 151, '2026-09-03', '10-Q/A')])[0].derivation, 'restatement-conflict');
  // Codex R1 on #85 (3): filed Friday 31.07.2026, known from Monday 03.08. (the first trading day after filing).
  assert.equal(pitSingleQuarters(rows, { asOf: '2026-08-03' })[0].val, 150);
  assert.deepEqual(pitSingleQuarters(rows, { asOf: '2026-08-01' }), [], 'a Saturday after a Friday filing');
});
test('Codex R1 (3) effective day: the filing day itself, a weekend and a holiday do not count, the first trading day after does', () => {
  const { effectiveDay } = require('../lib/sec-pit.js');
  assert.deepEqual(['2026-07-31', '2026-11-10', '2026-11-25', '2026-07-02', '2026-12-24'].map(effectiveDay),
    ['2026-08-03', '2026-11-11', '2026-11-27', '2026-07-06', '2026-12-28']);
  const rows = [fact('2026-04-01', '2026-06-30', 150, '2026-11-25')];
  assert.deepEqual(['2026-11-25', '2026-11-26', '2026-11-27'].map(asOf => pitSingleQuarters(rows, { asOf }).length), [0, 0, 1], 'Thanksgiving 26.11.2026');
  const c = { Revenues: { '2026-06-30': obs(150, '2026-07-31') } };
  assert.deepEqual(['2026-07-31', '2026-08-02', '2026-08-03'].map(d => X.secQuartersKnown(c, 'Revenues', d).length), [0, 0, 1], 'the reader applies the same day');
});
test('Codex R1 (1) a later amendment of any part of a derivation opens the period, also against a reported fourth quarter', () => {
  // amendedAnnual: Q1 to Q4 reported at 100, then a 10-K/A puts the year at 550 instead of 400.
  const year = [fact('2025-01-01', '2025-03-31', 100, '2025-05-01'), fact('2025-04-01', '2025-06-30', 100, '2025-08-01'), fact('2025-07-01', '2025-09-30', 100, '2025-11-01'),
    fact('2025-10-01', '2025-12-31', 100, '2026-02-20', '10-K'), fact('2025-01-01', '2025-12-31', 400, '2026-02-20', '10-K')];
  const q4 = rows => pitSingleQuarters(rows).find(x => x.end === '2025-12-31');
  assert.equal(q4(year).derivation, 'reported-3M', 'consistent year: the reported quarter stays');
  const amended = q4([...year, fact('2025-01-01', '2025-12-31', 550, '2026-04-01', '10-K/A')]);
  assert.equal(amended.derivation, 'restatement-conflict');
  // amendedShorterOperand: a 10-Q/A raises Q1 from 100 to 200; H1 250 and Q2 reported at 150 are older.
  const half = [fact('2026-01-01', '2026-03-31', 100, '2026-05-01'), fact('2026-04-01', '2026-06-30', 150, '2026-08-01'), fact('2026-01-01', '2026-06-30', 250, '2026-08-01')];
  const q2 = rows => pitSingleQuarters(rows).find(x => x.end === '2026-06-30');
  assert.equal(q2(half).derivation, 'reported-3M');
  assert.equal(q2([...half, fact('2026-01-01', '2026-03-31', 200, '2026-09-01', '10-Q/A')]).derivation, 'restatement-conflict');
});
test('Codex R1 (2) two figures filed on the same day leave the period open in any order; the store reads the newest filing, not the last arrival', () => {
  const a = fact('2026-04-01', '2026-06-30', 150, '2026-08-01'), b = fact('2026-04-01', '2026-06-30', 250, '2026-08-01', '10-Q/A');
  for (const rows of [[a, b], [b, a]]) assert.equal(pitSingleQuarters(rows)[0].derivation, 'restatement-conflict');
  assert.equal(pitSingleQuarters([a, { ...a, accn: 'b' }])[0].derivation, 'reported-3M', 'identical figures merge');
  const regressed = { Revenues: { '2026-06-30': [...obs(250, '2026-09-01'), ...obs(150, '2026-08-01')] } };
  assert.equal(X.secQuartersKnown(regressed, 'Revenues', '2026-10-01')[0].val, 250, 'a late older answer never wins');
  const split = { Revenues: { '2026-06-30': [...obs(150, '2026-08-01'), ...obs(250, '2026-08-01')] } };
  assert.equal(X.secQuartersKnown(split, 'Revenues', '2026-10-01')[0].derivation, 'restatement-conflict');
});

// ── Store writer ─────────────────────────────────────────────────────────────
function tempStoreRun(extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sec-q-'));
  const snaps = path.join(dir, 'snaps');
  fs.mkdirSync(snaps);
  fs.writeFileSync(path.join(snaps, 'AMZNX.json'), JSON.stringify({ ...snapshot(), meta: { ...snapshot().meta, country: 'United States', mostRecentQuarter: '2026-06-30T00:00:00.000Z' } }));
  fs.writeFileSync(path.join(snaps, 'FRESH.json'), JSON.stringify({ ...snapshot(), meta: { ...snapshot().meta, ticker: 'FRESH', country: 'United States', mostRecentQuarter: '2026-03-31T00:00:00.000Z' } }));
  // sd-us-kern 12.11.2026: a foreign listing (exchange suffix) of a firm seated abroad; a US listing of such a firm is asked (test below).
  fs.writeFileSync(path.join(snaps, 'ABROAD.DE.json'), JSON.stringify({ ...snapshot(), meta: { ...snapshot().meta, ticker: 'ABROAD.DE', country: 'Germany', mostRecentQuarter: '2026-06-30T00:00:00.000Z' } }));
  const calls = [];
  const secFacts = async (cik) => { calls.push(cik); return { facts: { 'us-gaap': { Revenues: { units: { USD: [fact('2026-04-01', '2026-06-30', 200606e6, '2026-07-31'), fact('2025-04-01', '2025-06-30', 167702e6, '2026-07-31')] } } } } }; };
  // ABROAD.DE has a real CIK, so only the country filter keeps it out; FRESH has none and stays out of the requests here (see the 91-day test).
  const base = { markets: ['us'], dir, tickers: [], priority: new Map(), log: () => {}, snapshotDirs: [snaps], secFacts, secTickers: async () => ({ AMZNX: { cik: '0001018724' }, 'ABROAD.DE': { cik: '0000000099' } }), cikMap: {}, now: () => new Date('2026-10-31T13:47:00Z'), ...extra };
  return { base, dir, calls };
}
test('store: asks SEC only for US firms that miss a quarter, writes append-only, re-reads a satisfied firm weekly', async () => {
  const { base, dir, calls } = tempStoreRun();
  const first = await main(base);
  assert.equal(first.exitCode, 0);
  assert.deepEqual(calls, ['0001018724']);
  const s = JSON.parse(fs.readFileSync(path.join(dir, 'us.json'), 'utf8'));
  assert.equal(s.companies.AMZNX.Revenues['2026-06-30'][0].val, 200606e6);
  assert.equal(s.companies.AMZNX.Revenues['2026-06-30'][0].form, '10-Q');
  assert.equal(Object.keys(s.companies).length, 1);
  await main(base);
  assert.equal(calls.length, 1, 'the store already holds the quarter the vendor names');
  await main({ ...base, now: () => new Date('2026-11-08T13:47:00Z') });
  assert.equal(calls.length, 2, 'weekly re-read');
  const after = JSON.parse(fs.readFileSync(path.join(dir, 'us.json'), 'utf8'));
  assert.equal(after.companies.AMZNX.Revenues['2026-06-30'].length, 1, 'same number, no new observation');
});
test('store: ten failed SEC requests in a row abort and write nothing; dry run writes nothing', async () => {
  const many = {}; for (let i = 0; i < 12; i++) many['T' + i] = { cik: String(i).padStart(10, '0') };
  const { base, dir } = tempStoreRun();
  for (const t of Object.keys(many)) fs.writeFileSync(path.join(base.snapshotDirs[0], t + '.json'), JSON.stringify({ ...snapshot(), meta: { ...snapshot().meta, ticker: t, country: 'United States', mostRecentQuarter: '2026-06-30T00:00:00.000Z' } }));
  const failing = await main({ ...base, secTickers: async () => many, secFacts: async () => { throw new Error('HTTP 503'); } });
  assert.equal(failing.exitCode, 1);
  assert.equal(fs.existsSync(path.join(dir, 'us.json')), false);
  const dry = await main({ ...base, dryRun: true });
  assert.equal(dry.exitCode, 0);
  assert.equal(fs.existsSync(path.join(dir, 'us.json')), false);
});
test('store concepts of the writer and of the reader are the same list', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'fetch-exchange-quarters.js'), 'utf8');
  assert.match(src, /const SEC_CONCEPTS = \[\.\.\.REV_CONCEPTS, 'RevenuesNetOfInterestExpense'\]/);
  assert.deepEqual(SEC_CONCEPTS, [...require('../lib/sec-pit.js').REV_CONCEPTS, 'RevenuesNetOfInterestExpense']);
});
test('every market checks append-only before it writes', () => assert.equal(fs.readFileSync(path.join(__dirname, '..', 'scripts', 'fetch-exchange-quarters.js'), 'utf8').match(/^ {2}S\.assertAppendOnly\(prev, next\);\r?$/gm).length, 4)); // cn, tw, us, br (Brazil since #115)
test('no personal contact or literal SEC identity in the writer; it reads SEC_CONTACT through the project helper', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'fetch-exchange-quarters.js'), 'utf8');
  assert.match(src, /'User-Agent': assertSecContact\(\)/);
  assert.match(src, /pauseMs: RATE_DELAY_MS/);
  assert.doesNotMatch(src, /[\w.]+@[\w.]+\.\w+/);
});

// ── Annual record against the fill: a row uses the fill throughout or not at all ──
// MSC Industrial, real numbers of 31.10.: the 10-K ends the year on 29.08.2026, the vendor's record on 31.08.2026.
const MSC_ENDS = ['2026-05-31', '2026-02-28', '2025-11-30', '2025-08-31', '2025-05-31'];
const MSC_VALUES = [1047083000, 917774000, 965684000, 978175000, 971145000];
const msc = () => ({
  meta: { ticker: 'AMZNX', fxConverted: true, reportingCurrency: 'USD', reportingCurrencyOriginal: 'USD', fxRateApplied: 1, asOf: '2026-10-31T09:02:36.214Z', fetchedAt: '2026-10-24T07:52:45.051Z',
    annualRevNewerYear: { end: '2026-08-31', revenue: 4009703000, priorEnd: '2025-08-31', priorRevenue: 3769521000, currency: 'USD', source: 'quoteSummary', priorStored: 3769521000 } },
  timeseries: { revenueQ: MSC_VALUES.map(value => ({ value })), revenueQEnds: [...MSC_ENDS] },
  annual: { annualRev: [{ value: 3769521000 }, { value: 3820951000 }], annualRevEnds: ['2025-08-31', '2024-08-31'] },
  metrics: {}, marketCap: {},
});
const mscStore = () => {
  const q = { '2026-08-29': obs(1079162000, '2026-10-22', { form: '10-K', days: 91, derivation: 'year-minus-9M' }) };
  MSC_ENDS.forEach((e, i) => { q[e] = obs(MSC_VALUES[i], '2026-07-01'); });
  return store(q);
};
test('same period end: MSC (29.08. at SEC, 31.08. at the vendor) shows the quarter, and its hint and record are true', () => {
  const before = revGrowthLeg(msc());
  assert.equal(before.basis, 'yearNewerRecord');
  const { snapshot: s, result } = run(msc(), mscStore());
  assert.equal(result.category, 'sec-fill');
  const leg = revGrowthLeg(s);
  assert.equal(leg.basis, 'quarter');
  assert.equal(leg.periodEnd, '2026-08-29', 'the label stays the filed end');
  assert.equal(leg.sourcePeriodEnd, '2026-08-31', 'the computational end is the one of the same fiscal period at the vendor');
  assert.equal(Math.round(leg.pct * 10) / 10, 10.3);
  assert.equal(axes.revGrowthLevel(s), leg.pct);
  assert.match(financialReasons(s).join(' '), /Umsatz des Quartals bis 29\.08\.2026/);
  assert.equal(X.exchangeRecord(s).filled[0].period, '2026-08-29');
  const cap = captureSnapshot(s).revenueInputs ?? captureSnapshot(s).inputs;
  assert.equal(cap[0].sourceType, 'filing', 'the shown number is explained by the filing');
  assert.equal(cap[0].periodEnd, '2026-08-29');
});
// Amazon's fill ends 30.06.2026; the fiscal year of the record ends `offset` days after that.
const withRecord = offset => {
  const end = new Date(Date.parse('2026-06-30T00:00:00Z') + offset * 864e5).toISOString().slice(0, 10);
  const priorEnd = (Number(end.slice(0, 4)) - 1) + end.slice(4), older = (Number(end.slice(0, 4)) - 2) + end.slice(4);
  const raw = snapshot({ meta: { annualRevNewerYear: { end, revenue: 800000e6, priorEnd, priorRevenue: 716924e6, currency: 'USD', source: 'quoteSummary', priorStored: 716924e6 } } });
  return { ...raw, annual: { annualRev: [{ value: 716924e6 }, { value: 637959e6 }], annualRevEnds: [priorEnd, older] } };
};
test('a fiscal year truly newer than the fill: no fill, no hint, no record, no bonus input', () => {
  const raw = withRecord(92);
  const { snapshot: s, result } = run(raw);
  assert.equal(result.why, 'annual-newer');
  assert.equal(s.meta.secQuarterFill, undefined);
  assert.equal(revGrowthLeg(s).basis, 'yearNewerRecord');
  assert.doesNotMatch(financialReasons(s).join(' '), /SEC-Bericht/);
  assert.equal(X.exchangeRecord(s), null);
  assert.deepEqual(g31Shadow(s).v1.bonusComponents, g31Shadow(raw).v1.bonusComponents);
});
test('whatever the distance to the fiscal year, a row uses the fill throughout or not at all; the bound is the end tolerance', () => {
  for (const offset of [-30, -1, 0, 1, 2, 15, 16, 60]) {
    const { snapshot: s } = run(withRecord(offset));
    const f = s.meta.secQuarterFill, leg = revGrowthLeg(s), hint = /SEC-Bericht/.test(financialReasons(s).join(' '));
    assert.equal(!!f, offset <= 15, 'offset ' + offset);
    assert.equal(hint, !!f, 'hint at offset ' + offset);
    assert.equal(!!X.exchangeRecord(s), !!f, 'record at offset ' + offset);
    if (f) { assert.equal(leg.basis, 'quarter', 'offset ' + offset); assert.equal(leg.periodEnd, '2026-06-30'); assert.equal(g31Shadow(s).v1.bonusComponents.at(-1), 200606e6 / 167702e6 - 1); }
  }
});
// The commonest case of the rule: no annual record, the row without the fill shows the plain fiscal year.
const addDays = (iso, days) => new Date(Date.parse(iso + 'T00:00:00Z') + days * 864e5).toISOString().slice(0, 10);
const withYear = offset => {
  const end = addDays('2026-06-30', offset);
  return { ...snapshot(), annual: { annualRev: [{ value: 800000e6 }, { value: 716924e6 }], annualRevEnds: [end, addDays(end, -365)] } };
};
test('plain fiscal year without a record: truly newer means no fill at all, within the tolerance the quarter leads', () => {
  for (const offset of [92, 16, 15, 3, 0, -1]) {
    const raw = withYear(offset), end = addDays('2026-06-30', offset), where = 'offset ' + offset;
    assert.equal(revGrowthLeg(raw).basis, 'year', where);
    const { snapshot: s, result } = run(raw);
    const leg = revGrowthLeg(s), hint = /SEC-Bericht/.test(financialReasons(s).join(' '));
    if (offset > 15) {
      assert.equal(result.why, 'annual-newer', where);
      assert.equal(s.meta.secQuarterFill, undefined, where);
      assert.deepEqual([leg.basis, leg.periodEnd], ['year', end], where);
      assert.equal(hint, false, where);
      assert.equal(X.exchangeRecord(s), null, where);
      assert.deepEqual(g31Shadow(s).v1.bonusComponents, g31Shadow(raw).v1.bonusComponents, where);
    } else {
      assert.deepEqual([leg.basis, leg.periodEnd, leg.sourcePeriodEnd], ['quarter', '2026-06-30', offset > 0 ? end : '2026-06-30'], where);
      assert.equal(hint, true, where);
      assert.equal(X.exchangeRecord(s).filled[0].period, '2026-06-30', where);
      assert.equal(g31Shadow(s).v1.bonusComponents.at(-1), 200606e6 / 167702e6 - 1, where);
    }
  }
});
test('an older fiscal year leaves the source end on the fill', () => {
  assert.equal(run(snapshot()).snapshot.meta.secQuarterFill.sourceEnd, '2026-06-30');
  assert.equal(run(withRecord(-1)).snapshot.meta.secQuarterFill.sourceEnd, '2026-06-30');
  assert.equal(run(withRecord(0)).snapshot.meta.secQuarterFill.sourceEnd, '2026-06-30');
  assert.equal(run(withRecord(2)).snapshot.meta.secQuarterFill.sourceEnd, '2026-07-02');
});

// ── Length of the pair in the hint ───────────────────────────────────────────
test('the hint names the days when the two periods differ by more than 3 days (Campbell: 91 against 98), otherwise not', () => {
  const text = (days, priorDays) => run(snapshot(), store(quarters({ '2026-06-30': obs(200606e6, '2026-07-31', { days }), '2025-06-30': obs(167702e6, '2026-05-01', { days: priorDays }) }))).snapshot.meta.secQuarterFill.reason;
  assert.match(text(91, 98), /verschieden lang: 91 Tage gegen 98 Tage im Vorjahr/);
  assert.match(text(94, 90), /94 Tage gegen 90 Tage/);
  assert.doesNotMatch(text(93, 90), /verschieden lang/);
  assert.doesNotMatch(text(91, 91), /verschieden lang/);
});

// ── Guards of evaluateUs ─────────────────────────────────────────────────────
test('hand tables keep authority: a listed ticker, a correction marker, a foreign withheld marker', () => {
  const firstCell = extra => snapshot({ timeseries: { revenueQ: VALUES.map((value, i) => (i === 0 ? { value, ...extra } : { value })), revenueQEnds: [...ENDS] } });
  for (const marker of [{ financialCorrection: { reason: 'x' } }, { yahooQ4Correction: { reason: 'x' } }, { financialMissing: { reasonCode: 'hand', reason: 'x' } }]) {
    assert.equal(whyOf(firstCell(marker)), 'hand-table', JSON.stringify(marker));
  }
  const listed = require('../configs/financial-known-cases.json').cases[0].ticker;
  const st = store();
  assert.equal(whyOf(snapshot({ meta: { ticker: listed } }), { ...st, companies: { [listed]: st.companies.AMZNX } }), 'hand-table');
});
test('no fill: a vendor row with another unit or currency; a series whose ends do not fit', () => {
  const firstCell = extra => snapshot({ timeseries: { revenueQ: VALUES.map((value, i) => (i === 0 ? { value, ...extra } : { value })), revenueQEnds: [...ENDS] } });
  assert.equal(whyOf(firstCell({ currency: 'EUR' })), 'unit');
  assert.equal(whyOf(firstCell({ multiplier: 1000 })), 'unit');
  assert.equal(whyOf(firstCell({ periodType: '6M' })), 'unit');
  assert.equal(whyOf(snapshot({ timeseries: { revenueQ: VALUES.map(value => ({ value })), revenueQEnds: ENDS.slice(1) } })), 'vendor-series');
  assert.equal(whyOf(snapshot({ timeseries: { revenueQ: [], revenueQEnds: [] } })), 'vendor-series');
});
test('the board-history entry names period, value, source and filing date', () => {
  assert.deepEqual(X.exchangeRecord(run(snapshot()).snapshot), { filled: [{ field: 'revenueQ', period: '2026-06-30', nativeValue: 200606e6,
    source: 'SEC 10-Q RevenueFromContractWithCustomerExcludingAssessedTax', dataDate: '2026-07-31', originalVendorValue: null, derivation: 'reported-3M' }], withheld: [] });
  assert.equal(X.exchangeRecord(snapshot()), null);
});
test('the policy needs usFill as a boolean', () => {
  assert.equal(X.policy.usFill, true);
  const { usFill, ...without } = X.policy;
  for (const bad of [without, { ...X.policy, usFill: 'yes' }, { ...X.policy, usFill: 1 }]) assert.throws(() => X.validatePolicy(bad), /Invalid exchange-quarter policy/);
  assert.equal(X.validatePolicy({ ...X.policy, usFill: false }).usFill, false);
});

// ── Store age ────────────────────────────────────────────────────────────────
test('store age only warns: 2 days in the season, 8 days outside, judged by the data day; the fill stays in every case', () => {
  const at = (asOf, written = '2026-10-30T13:40:00.000Z') => run(snapshot({ meta: { asOf } }), { ...store(), sources: { s: { fetchedAt: written } } });
  const expectFill = r => { assert.equal(r.result.category, 'sec-fill'); assert.equal(r.result.why, null); assert.equal(r.snapshot.meta.secQuarterFill.end, '2026-06-30'); };
  const fresh = at('2026-11-01T13:40:00.000Z');
  expectFill(fresh);
  assert.equal(fresh.result.storeWarning, undefined);
  const old = at('2026-11-01T13:41:00.000Z');
  expectFill(old);
  assert.match(old.result.storeWarning, /^SEC store us\.json is 2\.0 days old at the data day \(limit 2\): .*The fills stay/);
  const outside = at('2026-12-09T00:00:00.000Z', '2026-12-01T00:00:00.000Z');
  expectFill(outside);
  assert.equal(outside.result.storeWarning, undefined);
  const outsideOld = at('2026-12-09T00:01:00.000Z', '2026-12-01T00:00:00.000Z');
  expectFill(outsideOld);
  assert.match(outsideOld.result.storeWarning, /8\.0 days old at the data day \(limit 8\)/);
  for (const [asOf, written] of [['2026-10-15T00:00:00.000Z', '2026-10-12T00:00:00.000Z'], ['2026-11-20T00:00:00.000Z', '2026-11-17T00:00:00.000Z']]) assert.match(at(asOf, written).result.storeWarning, /3\.0 days old at the data day \(limit 2\)/);
  const unknown = run(snapshot(), { ...store(), sources: {} });
  expectFill(unknown);
  assert.match(unknown.result.storeWarning, /is of unknown age/);
});
test('a store of 01.08. keeps its fills and the daily path carries one warning with the age; a fresh store carries none', () => {
  const prepare = written => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sec-q-age-'));
    fs.writeFileSync(path.join(dir, 'us.json'), JSON.stringify({ ...store(), sources: { s: { fetchedAt: written } } }));
    fs.writeFileSync(path.join(dir, 'snap.json'), JSON.stringify(snapshot()));
    // The production step in a process of its own: the warning goes out once per process and the context is process-wide.
    const code = `const hand = require(${JSON.stringify(path.join(__dirname, '..', 'lib', 'yahoo-q4-known-cases.js'))});
      const raw = JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8'));
      hand.prepareSnapshot(raw);
      const { revGrowthLeg } = require(${JSON.stringify(path.join(__dirname, '..', 'lib', 'rev-growth-basis.js'))});
      console.log(JSON.stringify(revGrowthLeg(hand.prepareSnapshot(raw))));`;
    const r = spawnSync(process.execPath, ['-e', code, path.join(dir, 'snap.json')], { env: { ...process.env, EXCHANGE_QUARTERS_DIR: dir }, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const leg = JSON.parse(r.stdout.trim().split('\n').pop());
    assert.deepEqual([leg.basis, leg.sourcePeriodEnd], ['quarter', '2026-06-30'], 'the fill stays');
    return r.stderr.split('\n').filter(l => l.includes('SEC store us.json'));
  };
  const old = prepare('2026-08-01T00:00:00.000Z');
  assert.equal(old.length, 1, 'one warning per process');
  // Snapshot data day 31.10.2026 09:03 UTC, 91.4 days after the store; in the season the limit is 2 days.
  assert.match(old[0], /^::warning::\[exchange-check\] SEC store us\.json is 91\.4 days old at the data day \(limit 2\): /);
  assert.deepEqual(prepare('2026-10-30T13:40:00.000Z'), []);
});

// ── Derivation ───────────────────────────────────────────────────────────────
test('single quarters: a year with only two known quarters forms no fourth', () => {
  const y = fact('2025-01-01', '2025-12-31', 400, '2026-02-20', '10-K');
  const q1 = fact('2025-01-01', '2025-03-31', 90, '2025-05-01'), q2 = fact('2025-04-01', '2025-06-30', 100, '2025-08-01'), q3 = fact('2025-07-01', '2025-09-30', 100, '2025-11-01');
  assert.equal(pitSingleQuarters([y, q1, q2]).some(x => x.end === '2025-12-31'), false);
  assert.equal(pitSingleQuarters([y, q1, q2, q3]).some(x => x.end === '2025-12-31'), true);
});

// ── Store writer: candidates ─────────────────────────────────────────────────
const usSnap = (ticker, meta = {}, ends = ENDS) => ({ ...snapshot(), meta: { ...snapshot().meta, ticker, country: 'United States', mostRecentQuarter: '2026-06-30T00:00:00.000Z', ...meta }, timeseries: { revenueQ: ends.map(() => ({ value: 1e9 })), revenueQEnds: [...ends] } });
const addSnap = (base, file, s) => fs.writeFileSync(path.join(base.snapshotDirs[0], file), typeof s === 'string' ? s : JSON.stringify(s));
test('candidates: a snapshot file with the reserved-name prefix is a real firm, metadata files are not read', async () => {
  const { safeSnapshotFilename } = require('../lib/snapshot-fs.js');
  const { base, calls } = tempStoreRun();
  assert.equal(safeSnapshotFilename('CON'), '_CON.json');
  addSnap(base, safeSnapshotFilename('CON'), usSnap('CON'));
  addSnap(base, '_manifest.json', 'not json');
  addSnap(base, '_last_good_disk.json', 'not json');
  const r = await main({ ...base, secTickers: async () => ({ AMZNX: { cik: '0001018724' }, CON: { cik: '0001234567' } }) });
  assert.equal(r.exitCode, 0);
  assert.deepEqual([...calls].sort(), ['0001018724', '0001234567']);
});
test('candidates: only USD statements, no converted figures', async () => {
  const { base, calls } = tempStoreRun();
  addSnap(base, 'EUROX.json', usSnap('EUROX', { reportingCurrencyOriginal: 'EUR', fxRateApplied: 1.1 }));
  addSnap(base, 'RATEX.json', usSnap('RATEX', { reportingCurrencyOriginal: 'USD', fxRateApplied: 1.1 }));
  addSnap(base, 'CADX.json', usSnap('CADX', { fxConverted: false, reportingCurrency: 'CAD', reportingCurrencyOriginal: undefined }));
  addSnap(base, 'USDX.json', usSnap('USDX', { fxConverted: false, reportingCurrency: 'USD' }));
  const cik = { AMZNX: { cik: '0001018724' }, EUROX: { cik: '0000000001' }, RATEX: { cik: '0000000002' }, CADX: { cik: '0000000003' }, USDX: { cik: '0000000004' } };
  await main({ ...base, secTickers: async () => cik });
  assert.deepEqual(calls.sort(), ['0000000004', '0001018724']);
});
test('candidates: no vendor quarter for more than 91 days counts without a newer quarter named (the vendor mostRecentQuarter lags with its series)', async () => {
  // FRESH: the vendor names 31.03.2026 and has it, so only the age can make it a candidate. sd-us-kern 12.11.2026: was 200 days;
  // on 11.11.2026 431 stale US board rows had a vendor mostRecentQuarter equal to the vendor's newest quarter.
  const ask = async now => {
    const { base, calls } = tempStoreRun();
    fs.rmSync(path.join(base.snapshotDirs[0], 'AMZNX.json'));
    await main({ ...base, secTickers: async () => ({ FRESH: { cik: '0000000005' } }), now: () => new Date(now) });
    return calls.length;
  };
  assert.equal(await ask('2026-06-30T13:47:00Z'), 0, '91 days');
  assert.equal(await ask('2026-07-01T13:47:00Z'), 1, '92 days');
});

test('candidates: a firm seated abroad is not asked, also through a US listing (Codex R2 on #85, P2-2: a named gap)', async () => {
  const { base, calls } = tempStoreRun();
  addSnap(base, 'MELIX.json', usSnap('MELIX', { country: 'Uruguay' }));
  await main({ ...base, secTickers: async () => ({ AMZNX: { cik: '0001018724' }, 'ABROAD.DE': { cik: '0000000099' }, MELIX: { cik: '0000000007' } }) });
  assert.deepEqual([...calls].sort(), ['0001018724']);
});
test('queue: over several days a firm off the boards is asked while board firms fill the rest of the cap (Codex R1 on #85, 5)', async () => {
  const { base } = tempStoreRun();
  const secTickers = manyFirms(base, 4), board = new Set(['F000', 'F001', 'F002']), seen = [];
  // SEC holds only the quarter to 31.03.2026, more than 91 days old, so every firm is due every day; the cap of 2 is always full.
  const old = { facts: { 'us-gaap': { Revenues: { units: { USD: [fact('2026-01-01', '2026-03-31', 1e9, '2026-05-01'), fact('2025-01-01', '2025-03-31', 9e8, '2026-05-01')] } } } } };
  for (const day of ['2026-11-02', '2026-11-03', '2026-11-04']) {
    const asked = [];
    await main({ ...base, secTickers, secCap: 2, usBoard: board, now: () => new Date(day + 'T13:47:00Z'), secFacts: async c => { asked.push(c); return old; } });
    seen.push(asked);
  }
  assert.ok(seen.every(d => d.length === 2 && d.filter(c => c === '0000000004').length <= 1));
  assert.ok(seen.flat().includes('0000000004'), 'F003 off the boards was never asked');
  assert.ok(seen.every(d => d.some(c => c !== '0000000004')), 'board firms keep the other call');
});
test('queue: firms on the latest boards are asked first, so the cap never starves them (sd-us-kern 12.11.2026)', async () => {
  const { base } = tempStoreRun();
  const secTickers = manyFirms(base, 5), calls = [];
  // F000..F004 were never read; without the board rule the ticker order would ask F000, F001, F002. Codex R1 on #85 (5): one
  // call of three stays for the firms off the boards.
  await main({ ...base, secTickers, secCap: 3, usBoard: new Set(['F003', 'F004']), secFacts: async c => { calls.push(c); return null; } });
  assert.deepEqual(calls, ['0000000004', '0000000005', '0000000001']);
  const { boardTickers } = require('../scripts/fetch-exchange-quarters.js');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-'));
  for (const [d, t] of [['2026-11-10', 'OLD'], ['2026-11-11', 'NEW']]) {
    fs.mkdirSync(path.join(root, d));
    fs.writeFileSync(path.join(root, d, 'energy.json'), JSON.stringify({ cohort: { profitable: [{ ticker: t, rank: 1 }], unprofitable: [] } }));
  }
  assert.deepEqual([...boardTickers(root)], ['NEW'], 'only the latest day counts');
  assert.equal(boardTickers(path.join(root, 'absent')).size, 0);
});

// ── Store writer: when a firm is due ─────────────────────────────────────────
test('due: weekly while the held quarter is at most 91 days old, then every day, never twice a day', async () => {
  const { base, calls } = tempStoreRun();
  const at = async iso => { const n = calls.length; await main({ ...base, now: () => new Date(iso) }); return calls.length - n; };
  // The held quarter ends 30.06.2026.
  assert.equal(await at('2026-08-15T13:47:00Z'), 1, 'first read');
  assert.equal(await at('2026-08-21T13:47:00Z'), 0, 'six days later, 52 days after the quarter');
  assert.equal(await at('2026-08-22T13:47:00Z'), 1, 'seven days later');
  assert.equal(await at('2026-09-24T13:47:00Z'), 1, 'over a week later');
  assert.equal(await at('2026-09-29T13:47:00Z'), 0, 'five days later, exactly 91 days after the quarter');
  assert.equal(await at('2026-09-30T13:47:00Z'), 1, 'six days later, 92 days after the quarter');
  assert.equal(await at('2026-10-01T09:00:00Z'), 1, 'next calendar day, under 24 hours later');
  assert.equal(await at('2026-10-01T20:00:00Z'), 0, 'same calendar day');
  assert.equal(await at('2026-10-02T13:47:00Z'), 1, 'next day');
});
test('due: a firm lacking the quarter the vendor names is read every day; within 15 days of that end it holds it', async () => {
  // The vendor names 31.03.2026 and stands at 31.12.2025; the store was read yesterday, the held quarter is at most 91 days old, so only the named quarter can make the firm due.
  const asked = async held => {
    const { base, dir, calls } = tempStoreRun();
    addSnap(base, 'AMZNX.json', usSnap('AMZNX', { mostRecentQuarter: '2026-03-31T00:00:00.000Z' }, ENDS.slice(1)));
    fs.writeFileSync(path.join(dir, 'us.json'), JSON.stringify({ schemaVersion: 1, market: 'US', currency: 'USD', unit: 1, about: 'x', sources: {}, companies: { AMZNX: { cik: '0001018724', noData: { readAt: '2026-03-31T13:47:00.000Z' }, Revenues: { [held]: obs(1e9, held) } } } }));
    await main({ ...base, now: () => new Date('2026-04-01T13:47:00Z') });
    return calls.length;
  };
  assert.equal(await asked('2025-12-31'), 1, 'one quarter behind');
  assert.equal(await asked('2026-03-15'), 1, '16 days from the named end');
  assert.equal(await asked('2026-03-16'), 0, '15 days from the named end');
});
test('a run with nothing due still stamps the store, so the age check does not fire on a quiet firm list', async () => {
  const { base, dir, calls } = tempStoreRun();
  await main({ ...base, now: () => new Date('2026-08-15T13:47:00Z') });
  await main({ ...base, now: () => new Date('2026-08-16T13:47:00Z') });
  assert.equal(calls.length, 1);
  const s = JSON.parse(fs.readFileSync(path.join(dir, 'us.json'), 'utf8'));
  assert.deepEqual(Object.values(s.sources).map(x => [x.fetchedAt, x.calls]), [['2026-08-15T13:47:00.000Z', 1], ['2026-08-16T13:47:00.000Z', 0]]);
});

// ── Store writer: limits and failures ────────────────────────────────────────
const manyFirms = (base, n) => {
  const cik = {};
  for (let i = 0; i < n; i++) { const t = 'F' + String(i).padStart(3, '0'); cik[t] = { cik: String(i + 1).padStart(10, '0') }; addSnap(base, t + '.json', usSnap(t)); }
  fs.rmSync(path.join(base.snapshotDirs[0], 'AMZNX.json'));
  return async () => cik;
};
test('failures: at least 5 that are more than 20 % of the calls abort and write nothing; fewer pass', async () => {
  const failing = async n => {
    const { base, dir } = tempStoreRun();
    let call = 0;
    const secTickers = manyFirms(base, n);
    const lines = [];
    const r = await main({ ...base, secTickers, log: m => lines.push(m), secFacts: async () => { if (++call <= 5) throw new Error('HTTP 503'); return null; } });
    return { code: r.exitCode, written: fs.existsSync(path.join(dir, 'us.json')), text: lines.join(' ') };
  };
  const red = await failing(24);
  assert.deepEqual([red.code, red.written], [1, false]);
  assert.match(red.text, /5 of 24 calls failed \(more than 20 %\)/);
  const green = await failing(25);
  assert.deepEqual([green.code, green.written], [0, true]);
});
test('cap: requests stop at the cap and the rest is counted; the production cap is 600', async () => {
  const { base } = tempStoreRun();
  const calls = [], lines = [], secTickers = manyFirms(base, 5);
  const capped = await main({ ...base, secTickers, secCap: 2, log: m => lines.push(m), secFacts: async c => { calls.push(c); return null; } });
  assert.equal(calls.length, 2);
  assert.equal(JSON.parse(lines.find(l => l.startsWith('US: ')).slice(4)).skippedCap, 4, 'six due (five firms and FRESH by age), two asked');
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'scripts', 'fetch-exchange-quarters.js'), 'utf8'), /^const SEC_CAP = 600; /m);
  assert.equal(capped.exitCode, 0, 'a warning, no behaviour change');
  assert.match(lines.join(' '), /::warning::exchange-quarters US: SEC cap of 2 reached, 4 due firms were not asked in this run/);
  const free = [];
  await main({ ...base, secTickers, log: m => free.push(m), secFacts: async () => null });
  assert.doesNotMatch(free.join(' '), /SEC cap/);
});
test('cutoff: quarters older than 820 days are not stored', async () => {
  const { base, dir } = tempStoreRun();
  const rows = [fact('2024-05-04', '2024-08-03', 100, '2024-09-01'), fact('2024-05-01', '2024-07-31', 200, '2024-09-01'), fact('2026-04-01', '2026-06-30', 300, '2026-07-31')];
  // 31.10.2026 minus 820 days is 02.08.2024.
  await main({ ...base, secFacts: async () => ({ facts: { 'us-gaap': { Revenues: { units: { USD: rows } } } } }) });
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(path.join(dir, 'us.json'), 'utf8')).companies.AMZNX.Revenues).sort(), ['2024-08-03', '2026-06-30']);
});
test('real request path: 404 means no data, other errors count as failures, the contact goes into the header', async () => {
  const had = process.env.SEC_CONTACT;
  process.env.SEC_CONTACT = 'screener-data test contact@example.com';
  try {
    const go = async message => {
      const { base, dir } = tempStoreRun();
      const seen = [], lines = [];
      const r = await main({ ...base, secFacts: undefined, log: m => lines.push(m), fetchJson: async (url, o) => { seen.push([url, o]); throw new Error(message); } });
      return { r, seen, summary: JSON.parse(lines.find(l => l.startsWith('US: ')).slice(4)), store: JSON.parse(fs.readFileSync(path.join(dir, 'us.json'), 'utf8')) };
    };
    const missing = await go('HTTP 404');
    assert.equal(missing.r.exitCode, 0);
    assert.deepEqual([missing.summary.noFacts, missing.summary.failed], [1, 0]);
    assert.ok(missing.store.companies.AMZNX.noData.readAt, 'a firm without data is remembered');
    assert.match(missing.seen[0][0], /^https:\/\/data\.sec\.gov\/api\/xbrl\/companyfacts\/CIK0001018724\.json$/);
    assert.equal(missing.seen[0][1].headers['User-Agent'], process.env.SEC_CONTACT);
    const broken = await go('HTTP 503');
    assert.deepEqual([broken.summary.noFacts, broken.summary.failed], [0, 1]);
    assert.equal(broken.store.companies.AMZNX, undefined);
  } finally { if (had === undefined) delete process.env.SEC_CONTACT; else process.env.SEC_CONTACT = had; }
});

// ── A run without snapshots ──────────────────────────────────────────────────
test('no snapshot file at all: red with a clear message, the store stays, the other market still runs', async () => {
  const { base, dir } = tempStoreRun();
  await main(base);
  const before = fs.readFileSync(path.join(dir, 'us.json'), 'utf8');
  const empty = path.join(dir, 'empty');
  fs.mkdirSync(empty);
  fs.writeFileSync(path.join(empty, '_manifest.json'), '{}');
  const lines = [], folders = [empty, path.join(dir, 'never-restored')];
  const r = await main({ ...base, snapshotDirs: folders, log: m => lines.push(m), now: () => new Date('2026-11-01T13:47:00Z') });
  assert.equal(r.exitCode, 1);
  assert.match(lines.join(' '), /::error::exchange-quarters US aborted, store not written: no snapshot file read in /);
  assert.equal(fs.readFileSync(path.join(dir, 'us.json'), 'utf8'), before);
  const both = await main({ ...base, markets: ['us', 'tw'], snapshotDirs: folders, fetchJson: async () => { throw new Error('no call expected'); } });
  assert.equal(both.exitCode, 1);
  assert.equal(both.results.find(x => x.market === 'TW').written, true);
  assert.equal(both.results.find(x => x.market === 'US').aborted.startsWith('no snapshot file read'), true);
});
test('one folder without snapshots: a warning, the other folder still works', async () => {
  const { base, dir, calls } = tempStoreRun();
  const lines = [];
  const r = await main({ ...base, snapshotDirs: [...base.snapshotDirs, path.join(dir, 'never-restored')], log: m => lines.push(m) });
  assert.equal(r.exitCode, 0);
  assert.equal(calls.length, 1);
  assert.match(lines.join(' '), /::warning::exchange-quarters US: no snapshot file in .*never-restored/);
  assert.deepEqual(JSON.parse(lines.find(l => l.startsWith('US: ')).slice(4)).filesRead, [3, 0]);
  const reversed = []; await main({ ...base, snapshotDirs: [path.join(dir, 'never-restored'), ...base.snapshotDirs], log: m => reversed.push(m) }); assert.deepEqual(JSON.parse(reversed.find(l => l.startsWith('US: ')).slice(4)).filesRead, [0, 3]);
});
test('workflow: every US step and the commit run after a red China or Taiwan step; a branch run stays a dry run', () => {
  const yml = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'exchange-quarters.yml'), 'utf8').replace(/\r\n/g, '\n');
  const steps = yml.split(/\n(?=      - )/);
  for (const name of ['Find latest snapshot artifacts', 'Restore snapshots (daily pull)', 'Restore snapshots (small-cap pull)', 'Fetch SEC quarters (US)', 'Commit store + push']) {
    const step = steps.find(s => s.startsWith('      - name: ' + name + '\n'));
    assert.ok(step, name);
    assert.match(step, /^ {8}if: \$\{\{ !cancelled\(\)( && steps\.find_runs\.outputs\.(daily|small) != '')? \}\}$/m, name);
  }
  const us = steps.find(s => s.startsWith('      - name: Fetch SEC quarters (US)\n'));
  assert.match(us, /^ {12}node scripts\/fetch-exchange-quarters\.js --market=us --dry-run$/m);
  assert.match(us, /^ {10}if \[ "\$VEROEFFENTLICHEN" = "true" \]; then$/m);
});

// ── Codex R21 (07.11.2026): admission rebuilt ───────────────────────────────
const groupOf = list => Object.fromEntries(list.map(({ end, ...q }) => [end, [q]]));
test('R21-1 real APLD: a narrower concept is not the whole revenue (services 262.8 against total 341.9 Mio. USD), no fill', () => {
  const facts = require('./fixtures/sec-quarter-fill/apld-revenue-facts.json')['facts']['us-gaap'];
  const company = { cik: '0001144879' };
  for (const c of SEC_CONCEPTS) if (facts[c]) company[c] = groupOf(pitSingleQuarters(facts[c].units.USD, { asOf: '2026-10-31' }));
  assert.equal(company.RevenueFromContractWithCustomerExcludingAssessedTax['2026-08-31'][0].val, 262755000);
  assert.equal(company.Revenues['2026-08-31'][0].val, 341875000);
  const s = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'sec-quarter-fill', 'apld-snapshot-2026-10-31.json'), 'utf8'));
  s.timeseries.revenueQ.shift(); s.timeseries.revenueQEnds.shift(); // the vendor lacks the August quarter, as in the review
  const st = { schemaVersion: 1, market: 'US', currency: 'USD', sources: { s: { fetchedAt: '2026-10-31T10:00:00Z' } }, companies: { [s.meta.ticker]: company } };
  const r = X.applyExchangeCheck(s, { mode: 'fill-only', usFill: true, context: { stores: { us: st }, baseline: { rows: new Map() } } });
  assert.equal(r.snapshot.meta.secQuarterFill, undefined);
  // Codex R2 on #85: APLD restated its contract-revenue quarters, so under the fail-closed derivation those periods are open and
  // too few quarters agree before the part-of-revenue rule is reached; that rule keeps its own synthetic test above.
  assert.ok(['part-of-revenue', 'too-few-agreeing-quarters'].includes(r.result.why), r.result.why);
});
test('R21-1 a larger concept that measurably is another definition than the vendor (disagrees twice) does not block', () => {
  const bigger = {};
  for (const [e, l] of Object.entries(quarters())) bigger[e] = [{ ...l[0], val: l[0].val * 1.1 }];
  const st = store();
  st.companies.AMZNX.Revenues = bigger;
  assert.equal(run(snapshot(), st).result.category, 'sec-fill');
  const unproven = { '2026-06-30': [{ ...quarters()['2026-06-30'][0], val: 250000e6 }] }; // larger now, never compared before
  const st2 = store();
  st2.companies.AMZNX.Revenues = unproven;
  assert.equal(whyOf(snapshot(), st2), 'part-of-revenue');
});
test('R21-2 single quarters: three overlapping periods up to June form no fourth quarter of 184 days', () => {
  const q = pitSingleQuarters([fact('2025-01-01', '2025-12-31', 400, '2026-02-01', '10-K'), fact('2025-01-01', '2025-03-31', 90, '2025-05-01'),
    fact('2025-02-01', '2025-04-30', 100, '2025-06-01'), fact('2025-04-01', '2025-06-30', 110, '2025-08-01')]);
  assert.equal(q.find(x => x.end === '2025-12-31'), undefined);
});
test('R21-2 a stored quarter outside 80 to 110 days never fills, even when both legs are equally long', () => {
  const long = (val, filed) => obs(val, filed, { days: 184, derivation: 'year-minus-three-quarters' });
  assert.equal(whyOf(snapshot(), store(quarters({ '2026-06-30': long(200606e6), '2025-06-30': long(167702e6, '2026-05-01') }))), 'not-a-quarter');
});
test('R21-2 single quarters: a later 10-Q/A cumulative figure that contradicts the reported quarter leaves the period open', () => {
  const rows = [fact('2026-01-01', '2026-03-31', 100, '2026-05-01'), fact('2026-04-01', '2026-06-30', 150, '2026-08-01'),
    fact('2026-01-01', '2026-06-30', 250, '2026-08-01'), fact('2026-01-01', '2026-06-30', 350, '2026-09-15', '10-Q/A')];
  const q2 = pitSingleQuarters(rows).find(x => x.end === '2026-06-30');
  assert.equal(q2.derivation, 'restatement-conflict');
  assert.equal(pitSingleQuarters(rows.slice(0, 3)).find(x => x.end === '2026-06-30').derivation, 'reported-3M', 'a consistent cumulative changes nothing');
  assert.equal(whyOf(snapshot(), store(quarters({ '2026-06-30': obs(250, '2026-09-15', { derivation: 'restatement-conflict' }) }))), 'restatement-open');
});
test('R21-3 another listing of the same firm reads its entry when three quarters agree, never on a ticker alone', () => {
  const other = over => snapshot({ meta: { ticker: 'AMZNX.SW', country: 'United States', ...over } });
  const r = run(other());
  assert.equal(r.result.category, 'sec-fill');
  assert.equal(r.result.fill.aliasOf, 'AMZNX');
  assert.equal(revGrowthLeg(r.snapshot).sourcePeriodEnd, '2026-06-30');
  const off = snapshot({ meta: { ticker: 'AMZNX.SW', country: 'United States' } });
  off.timeseries.revenueQ = VALUES.map((value, i) => ({ value: i === 2 ? value * 1.05 : value }));
  assert.equal(run(off).result, null, 'one vendor quarter off: no link');
  const twoFirms = store();
  twoFirms.companies.TWIN = { cik: '0000000001', RevenueFromContractWithCustomerExcludingAssessedTax: quarters() };
  assert.equal(run(other(), twoFirms).result, null, 'two CIKs match: no link');
  // Codex R2 on #85 (P2-2): figures alone prove no identity, so only listings of US-seated firms link (an issuer seated abroad
  // with the same three quarters stays unlinked).
  assert.equal(run(other({ country: 'Uruguay' })).result, null);
});
test('R21-4 cap: the queue runs oldest read first, so the firm left out yesterday is asked today', async () => {
  const { base } = tempStoreRun();
  const secTickers = manyFirms(base, 3);
  const days = [];
  for (const day of ['2026-10-31', '2026-11-01', '2026-11-02']) {
    const asked = [];
    await main({ ...base, secTickers, secCap: 2, now: () => new Date(day + 'T13:47:00Z'), secFacts: async c => { asked.push(c); return null; } });
    days.push(asked);
  }
  const seen = new Set(days.flat());
  assert.equal(seen.size, 3, 'every firm asked within two days: ' + JSON.stringify(days));
});
test('blind review M1: another listing follows the hand table of the listing whose entry it reads (HTGC listed)', () => {
  const st = store();
  st.companies = { HTGC: st.companies.AMZNX };
  const r = run(snapshot({ meta: { ticker: 'HTGC.VI', country: 'United States' } }), st);
  assert.equal(r.snapshot.meta.secQuarterFill, undefined);
  assert.equal(r.result.why, 'hand-table');
});
test('blind review M2: an open restatement in one concept leaves the period empty for every concept', () => {
  const st = store();
  st.companies.AMZNX.Revenues = { '2026-06-30': obs(250000e6, '2026-09-15', { derivation: 'restatement-conflict' }) };
  assert.equal(whyOf(snapshot(), st), 'restatement-open');
});
test('blind review N1: three quarters with a gap of eleven days do not tile the nine months, no fourth quarter', () => {
  const q = pitSingleQuarters([fact('2025-01-01', '2025-12-31', 400, '2026-02-01', '10-K'), fact('2025-01-01', '2025-03-31', 90, '2025-05-01'),
    fact('2025-04-11', '2025-06-30', 100, '2025-08-01'), fact('2025-07-01', '2025-09-30', 110, '2025-11-01')]);
  assert.equal(q.find(x => x.end === '2025-12-31'), undefined);
});
test('blind review N1: a reported quarter in open restatement is no operand of a fourth quarter', () => {
  const q = pitSingleQuarters([fact('2025-01-01', '2025-12-31', 400, '2026-02-01', '10-K'), fact('2025-01-01', '2025-03-31', 90, '2025-05-01'),
    fact('2025-04-01', '2025-06-30', 100, '2025-08-01'), fact('2025-01-01', '2025-06-30', 190, '2025-08-01'), fact('2025-01-01', '2025-06-30', 230, '2025-09-20', '10-Q/A'),
    fact('2025-07-01', '2025-09-30', 110, '2025-11-01')]);
  assert.equal(q.find(x => x.end === '2025-06-30').derivation, 'restatement-conflict');
  // Codex R2 on #85 (P1-2): the dependent fourth quarter carries a conflict marker of its own (not just no value), so a store
  // that already holds an older derived figure for it leaves it open from the newest filing on.
  assert.deepEqual([q.find(x => x.end === '2025-12-31').derivation, q.find(x => x.end === '2025-12-31').filed], ['restatement-conflict', '2026-02-01'], 'dated by the newest filing involved (the 10-K)');
});
test('blind review N1: two agreeing vendor quarters do not link another listing (three needed)', () => {
  const two = snapshot({ meta: { ticker: 'AMZNX.SW', country: 'United States' } });
  two.timeseries.revenueQ = two.timeseries.revenueQ.slice(0, 2); two.timeseries.revenueQEnds = two.timeseries.revenueQEnds.slice(0, 2);
  assert.equal(run(two).result, null);
});
test('R21 a missing us.json warns when usFill is on', () => {
  const w = [];
  assert.equal(X.loadUsStore(w, fs.mkdtempSync(path.join(os.tmpdir(), 'sec-none-'))), null);
  assert.match(w.join(' '), /us\.json missing/);
});

(async () => {
  for (const run1 of pending) await run1();
  console.log('\nsec-quarter-fill: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();

'use strict';
// tests/sec-quarter-fill.test.js — standalone runner (exit 0/1). SEC quarter fill (question i of P309): a filed quarter the
// vendor lacks reaches only the growth leg, on the vendor's own definition, in USD, with period, length and derivation proven.
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
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
  schemaVersion: 1, market: 'US', currency: 'USD', sources: {}, companies: { AMZNX: { cik: '0001018724', [concept]: group } } });
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
  const q = pitSingleQuarters([fact('2026-01-01', '2026-06-30', 300, '2026-07-31'), fact('2026-04-01', '2026-06-30', 150, '2026-07-31'), fact('2026-01-01', '2026-03-31', 100, '2026-05-01')]);
  assert.deepEqual(q.map(x => [x.end, x.val, x.derivation]), [['2026-06-30', 150, 'reported-3M'], ['2026-03-31', 100, 'reported-3M']]);
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
  const rows = [fact('2026-04-01', '2026-06-30', 150, '2026-07-31'), fact('2026-04-01', '2026-06-30', 151, '2026-09-01', '10-Q/A'), fact('2026-04-01', '2026-06-30', 999, '2026-09-02', '8-K')];
  assert.equal(pitSingleQuarters(rows)[0].val, 151);
  assert.equal(pitSingleQuarters(rows, { asOf: '2026-08-01' })[0].val, 150);
});

// ── Store writer ─────────────────────────────────────────────────────────────
function tempStoreRun(extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sec-q-'));
  const snaps = path.join(dir, 'snaps');
  fs.mkdirSync(snaps);
  fs.writeFileSync(path.join(snaps, 'AMZNX.json'), JSON.stringify({ ...snapshot(), meta: { ...snapshot().meta, country: 'United States', mostRecentQuarter: '2026-06-30T00:00:00.000Z' } }));
  fs.writeFileSync(path.join(snaps, 'FRESH.json'), JSON.stringify({ ...snapshot(), meta: { ...snapshot().meta, ticker: 'FRESH', country: 'United States', mostRecentQuarter: '2026-03-31T00:00:00.000Z' } }));
  fs.writeFileSync(path.join(snaps, 'ABROAD.json'), JSON.stringify({ ...snapshot(), meta: { ...snapshot().meta, ticker: 'ABROAD', country: 'Germany', mostRecentQuarter: '2026-06-30T00:00:00.000Z' } }));
  const calls = [];
  const secFacts = async (cik) => { calls.push(cik); return { facts: { 'us-gaap': { Revenues: { units: { USD: [fact('2026-04-01', '2026-06-30', 200606e6, '2026-07-31'), fact('2025-04-01', '2025-06-30', 167702e6, '2026-07-31')] } } } } }; };
  const base = { markets: ['us'], dir, tickers: [], priority: new Map(), log: () => {}, snapshotDirs: [snaps], secFacts, secTickers: async () => ({ AMZNX: { cik: '0001018724' } }), cikMap: {}, now: () => new Date('2026-10-31T13:47:00Z'), ...extra };
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
test('no personal contact or literal SEC identity in the writer; it reads SEC_CONTACT through the project helper', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'fetch-exchange-quarters.js'), 'utf8');
  assert.match(src, /'User-Agent': assertSecContact\(\)/);
  assert.match(src, /pauseMs: RATE_DELAY_MS/);
  assert.doesNotMatch(src, /[\w.]+@[\w.]+\.\w+/);
});

(async () => {
  for (const run1 of pending) await run1();
  console.log('\nsec-quarter-fill: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();

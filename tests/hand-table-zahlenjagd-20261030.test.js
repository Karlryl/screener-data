'use strict';
// Hand tables from the board-top check of 30.10.2026 (lane zahlenjagd): the top of every board against primary filings.
// Two independent verifiers read each filing; the real vendor packets of run 41027769596 are in
// tests/fixtures/hand-table-zahlenjagd-20261030.json.
// - IOS.DE: Q2 2025 still holds the AdTech unit since classified as discontinued (shown -21.4 %), Q3 2025 is 85.2 instead of
//   324.2. Revenue, gross profit and operating income of both quarters are withheld, and 2023, which still holds AdTech.
// - JIOFIN.BO: annual revenue FY26, FY25 and FY24 match no statement line (shown +136.4 %, filed +72.0 %). Gross profit withheld.
// - ALK.TO, 3471.T: the vendor skips a fiscal year on this listing, a two-year change stood as annual growth
//   (+443.2 %, filed +256.7 %; +50.1 %, period change, no annual comparison proven). The growth stays empty.
// - 601456.SS: annual revenue 2025, 2024 and 2023 match no statement line (shown +107.2 %, filed +186.0 %). Gross profit withheld.
// - 600292.SS: Q2 2025 is pre-merger, Q2 2026 post-merger (shown +278 %, filed comparable +24.7 %). The series is covered through
//   30.06.2026 with the restated quarter, like 300277.SZ; Q4 2025 is a catch-up residual and withheld with its siblings.
// - 0097.KL, ETERNAL.BO, PASS3.SA, PAYTM.BO: annual operating income matches no filed line and not the vendor's own quarters.
// - PARADEEP.NS: annual revenue 101.9 against filed 218.3 bn INR; the board's quarterly growth stays.
// - FAST.AS, ISAE3.SA, 7911.T: market cap from a wrong share count (twice too many; all share classes at the ordinary-share
//   price; the pre-split count against a post-split price).
// Every red probe changes an in-memory copy only; live files are hashed before and after.
// Break-once on test data: `node tests/hand-table-zahlenjagd-20261030.test.js --prove-red` runs the after-check without
// this lane's rows and must exit 1.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { applyFinancialCases, financialReasons, validateTable, table } = require('../lib/financial-known-cases.js');
const { g31Shadow } = require('../lib/g31-recency.js');
const guard = require('../lib/market-cap-guard.js');
const fixtures = require('./fixtures/hand-table-zahlenjagd-20261030.json').snapshots;
const root = path.resolve(__dirname, '..');
const live = ['configs/financial-known-cases.json', 'configs/share-count-hand-table.json', 'lib/financial-known-cases.js', 'lib/market-cap-guard.js', 'tests/fixtures/hand-table-zahlenjagd-20261030.json'];
const liveHashes = () => live.map(f => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, f))).digest('hex'));
const beforeHashes = liveHashes();
const REV = '2026-10-30-sdz1';
const value = row => typeof row === 'number' ? row : row?.value ?? null;
const snap = t => structuredClone(fixtures[t]);
const apply = (t, cfg) => applyFinancialCases(snap(t), cfg && { table: cfg }).snapshot;
const native = (s, box, field) => s[box][field].map(r => value(r) === null ? null : Math.round(value(r) / s.meta.fxRateApplied));
const leg = s => { const v = g31Shadow(s).v1; return [v.basis, v.periodEnd, v.priorPeriodEnd, v.pct === null ? null : Math.round(v.pct * 10) / 10]; };
const ROWS = { 'IOS.DE': 7, 'JIOFIN.BO': 4, 'ALK.TO': 1, '3471.T': 1, '0097.KL': 3, 'ETERNAL.BO': 1, 'PASS3.SA': 1, 'PAYTM.BO': 1, '601456.SS': 4, '600292.SS': 10, 'PARADEEP.NS': 2 };
/** Table copy without this lane's rows: the state of the base commit before the change. */
function before() {
  const copy = structuredClone(table);
  copy.cases = copy.cases.filter(c => c.revision !== REV);
  copy.coverage = copy.coverage.filter(v => v.ticker !== '600292.SS');
  return validateTable(copy);
}
const AFTER = { 'IOS.DE': ['year', '2025-12-31', '2024-12-31', 5.5], 'JIOFIN.BO': ['year', '2026-03-31', '2025-03-31', 72], '601456.SS': ['year', '2025-12-31', '2024-12-31', 186], '600292.SS': ['quarter', '2026-06-30', '2025-06-30', 24.7] };

if (process.argv.includes('--prove-red')) {
  // Without the rows the shown growth must differ from AFTER, so this deepEqual has to throw.
  assert.deepEqual(leg(apply('JIOFIN.BO', before())), AFTER['JIOFIN.BO']);
  console.log('hand-table-zahlenjagd-20261030: --prove-red did NOT fire');
  process.exit(0);
}

const own = table.cases.filter(c => c.revision === REV);

test('35 sourced rows validate; every reason names its period, no substitute 0, no dash as punctuation', () => {
  assert.equal(own.length, 35);
  assert.deepEqual(Object.fromEntries(Object.keys(ROWS).map(t => [t, own.filter(c => c.ticker === t).length])), ROWS);
  for (const c of own) {
    assert.ok(c.sources.length && c.sources.every(s => s.url.startsWith('https://') && s.quote && s.page && s.verifiedAt === '2026-10-30'), c.caseId);
    assert.ok(c.reason.includes(c.period.split('-').reverse().join('.')), c.caseId + ': the period of this cell');
    assert.match(c.reason, /Geprüft am 30\.10\.2026\.$/, c.caseId);
    assert.doesNotMatch(c.reason, / [–—-] /, c.caseId + ': dash as punctuation');
    assert.notEqual(c.replacementValue, 0, c.caseId + ': never a substitute 0');
  }
  // Only SPIC has a quarterly replacement, so only its series carries coverage; newer vendor quarters of the others stay visible.
  assert.deepEqual(own.filter(c => c.periodType === '3M' && c.replacementValue !== null).map(c => c.ticker).filter((t, i, a) => a.indexOf(t) === i), ['600292.SS']);
  assert.deepEqual(table.coverage.filter(v => Object.keys(ROWS).includes(v.ticker)), [{ ticker: '600292.SS', field: 'revenueQ', coversThrough: '2026-06-30' }]);
});

test('IOS.DE: the mixed-basis quarters and 2023 are gone, growth falls back to the year pair (+5.5 %), siblings follow', () => {
  assert.deepEqual(leg(apply('IOS.DE', before())), ['quarter', '2026-06-30', '2025-06-30', -21.4]);
  const out = apply('IOS.DE');
  for (const f of ['revenueQ', 'grossProfitQ', 'opIncQ']) assert.deepEqual(native(out, 'timeseries', f).slice(3), [null, null], f);
  assert.deepEqual(native(out, 'timeseries', 'revenueQ').slice(0, 3), [352747000, 348371000, 336653000]);
  assert.deepEqual(native(out, 'annual', 'annualRev'), [1316894000, 1248070000, null, null]);
  assert.deepEqual(leg(out), AFTER['IOS.DE']);
  assert.ok(financialReasons(out).some(r => r.includes('rund +8,1 %')), 'the comparable growth is named');
  assert.deepEqual(native(apply('IOS.VI'), 'timeseries', 'grossProfitQ').slice(3), [null, null], 'the Vienna listing carries the same packet');
});

test('JIOFIN: filed revenue replaces three years, growth +72.0 % instead of +136.4 %, gross profit is withheld', () => {
  for (const t of ['JIOFIN.BO', 'JIOFIN.NS']) {
    assert.deepEqual(leg(apply(t, before())), ['year', '2026-03-31', '2025-03-31', 136.4], t);
    const out = apply(t);
    assert.deepEqual(native(out, 'annual', 'annualRev'), [35132600000, 20429100000, 18538800000, null], t);
    assert.deepEqual(native(out, 'annual', 'annualGP'), [null, null, null, null], t);
    assert.deepEqual(leg(out), AFTER['JIOFIN.BO'], t);
    assert.deepEqual(native(out, 'timeseries', 'revenueQ'), native(snap(t), 'timeseries', 'revenueQ'), t + ': the quarters stay');
  }
});

test('ALK.TO and 3471.T: the two-year pair is withheld, no growth number remains, the reason says why', () => {
  assert.deepEqual(leg(apply('ALK.TO', before())), ['year', '2026-06-30', '2024-06-30', 443.2]);
  const alk = apply('ALK.TO');
  assert.deepEqual(native(alk, 'annual', 'annualRev'), [939676000, null, null, null]);
  assert.deepEqual(leg(alk), ['none', null, null, null]);
  assert.ok(financialReasons(alk).some(r => r.includes('+256,7 %')));
  assert.deepEqual(leg(apply('3471.T', before())), ['year', '2026-07-31', '2024-07-31', 50.1]);
  const mflp = apply('3471.T');
  assert.deepEqual(native(mflp, 'annual', 'annualRev'), [36417496000, null, null, null]);
  assert.deepEqual(leg(mflp), ['none', null, null, null]);
  assert.ok(financialReasons(mflp).some(r => r.includes('26.382 Mio. JPY')));
});

test('601456.SS: filed revenue gives +186.0 % instead of +107.2 %, gross profit is withheld, 1456.HK follows', () => {
  assert.deepEqual(leg(apply('601456.SS', before())), ['year', '2025-12-31', '2024-12-31', 107.2]);
  for (const t of ['601456.SS', '1456.HK']) {
    const out = apply(t);
    assert.deepEqual(native(out, 'annual', 'annualRev'), [7673396284, 2683134476, 2955461375, null], t);
    assert.deepEqual(native(out, 'annual', 'annualGP'), [null, null, null, null], t);
    assert.deepEqual(leg(out), AFTER['601456.SS'], t);
  }
});

test('600292.SS: the restated quarter gives +24.7 % instead of +278 %; catch-up and pre-merger cells are withheld', () => {
  assert.deepEqual(leg(apply('600292.SS', before())), ['quarter', '2026-06-30', '2025-06-30', 278]);
  const out = apply('600292.SS');
  assert.deepEqual(native(out, 'timeseries', 'revenueQ'), [3580334919, 2474632037, null, null, 2871949343, 3038175647]);
  assert.deepEqual(native(out, 'timeseries', 'grossProfitQ').filter((x, i) => [2, 4].includes(i)), [null, null]);
  assert.deepEqual(native(out, 'timeseries', 'opIncQ').filter((x, i) => [2, 4].includes(i)), [null, null]);
  assert.deepEqual(leg(out), AFTER['600292.SS']);
  assert.deepEqual(native(out, 'annual', 'annualRev').slice(0, 3), [12151993170, 14450212504, null]);
  // A new vendor quarter after the covered period stays empty until it is checked (the Q3 2026 report is out, the vendor
  // had not delivered it on 30.10.2026). The shown growth then falls back to the filed year pair, labelled as such.
  const next = snap('600292.SS');
  next.timeseries.revenueQ.unshift({ value: 1e9 * next.meta.fxRateApplied });
  next.timeseries.revenueQEnds.unshift('2026-09-30');
  const r = applyFinancialCases(next).snapshot;
  assert.equal(value(r.timeseries.revenueQ[0]), null, 'period-after-coverage');
  assert.deepEqual(leg(r), ['year', '2025-12-31', '2024-12-31', -15.9], 'the year pair, never the unchecked quarter');
});

test('annual operating income: filed values replace the vendor line, older years stay empty, no gap is bridged', () => {
  const want = {
    '0097.KL': [181163000, 107377000, 145672000, null],
    'ETERNAL.BO': [-3890000000, null, null, null],
    'ETERNAL.NS': [-3890000000, null, null, null],
    'PASS3.SA': [3726295000, null, null, null],
    'PAYTM.BO': [-660000000, null, null, null],
    'PAYTM.NS': [-660000000, null, null, null],
  };
  for (const [t, cells] of Object.entries(want)) assert.deepEqual(native(apply(t), 'annual', 'annualOpInc'), cells, t);
  assert.deepEqual(native(apply('PASS3.SA', before()), 'annual', 'annualOpInc').slice(0, 1), [-421021000], 'the input showed a loss');
});

test('PARADEEP: filed annual revenue replaces the line without subsidy, gross profit is withheld, the quarterly growth stays', () => {
  for (const t of ['PARADEEP.NS', 'PARADEEP.BO']) {
    const out = apply(t);
    assert.deepEqual(native(out, 'annual', 'annualRev'), [218263400000, null, null, null], t);
    assert.deepEqual(native(out, 'annual', 'annualGP'), [null, null, null, null], t);
    assert.deepEqual(leg(out), leg(apply(t, before())), t + ': growth unchanged');
  }
});

test('a changed vendor value is never replaced by the old correction', () => {
  const s = snap('JIOFIN.BO');
  s.annual.annualRev[0] = { ...s.annual.annualRev[0], value: value(s.annual.annualRev[0]) * 1.1 };
  const out = applyFinancialCases(s).snapshot;
  assert.equal(value(out.annual.annualRev[0]), null, 'the cell turns empty instead of showing a stale value');
});

const CAP = {
  'FAST.AS': { shares: 19752877, usd: 731e6 },
  'ISAE3.SA': { shares: 564711511, usd: 3722e6 },
  '7911.T': { shares: 589412480, usd: 7975e6 },
};
const withImplied = (t, shares) => { const s = snap(t); s.marketCap.value = s.price.regularMarketPrice * shares; return s; };

test('market cap: the three rows land on price x issuer count, with reason, and the derived vendor ratios are blanked', () => {
  for (const [t, w] of Object.entries(CAP)) {
    const out = guard.prepareMarketCap(snap(t));
    assert.equal(out.marketCap.source, 'hand-table:shares', t);
    assert.ok(Math.abs(out.marketCap.value / (out.price.regularMarketPrice * w.shares) - 1) < 1e-9, t);
    assert.ok(Math.abs(out.marketCap.value / w.usd - 1) < 0.01, `${t}: about ${w.usd}`);
    assert.equal(out.marketCap.yahooValue, fixtures[t].marketCap.value, t);
    assert.equal(out.meta.marketCapReason, guard.table[t].reason, t);
    for (const f of ['priceSales', 'enterpriseValue', 'enterpriseToRevenue', 'enterpriseToEbitda']) assert.equal(out.metrics[f] ?? null, null, `${t}: ${f}`);
  }
  assert.equal(guard.correctedBelowFloor(guard.prepareMarketCap(snap('FAST.AS'))), true, 'Fastned falls below the 800 million floor of the main boards');
  assert.equal(guard.correctedBelowFloor(guard.prepareMarketCap(snap('ISAE3.SA'))), false);
});

test('market cap: a fixed vendor count is confirmed; ISAE3.SA also survives the vendor moving to the full share total', () => {
  for (const [t, w] of Object.entries(CAP)) {
    const out = guard.prepareMarketCap(withImplied(t, w.shares));
    assert.notEqual(out.marketCap.source, 'hand-table:shares', t);
    assert.equal(out.meta.marketCapReason, undefined, t);
  }
  assert.equal(guard.prepareMarketCap(withImplied('ISAE3.SA', 703327748)).marketCap.source, 'hand-table:shares');
});

test('market cap: an unknown vendor count is withheld with reason, never corrected blindly', () => {
  for (const t of Object.keys(CAP)) {
    const out = guard.prepareMarketCap(withImplied(t, 3e9));
    assert.equal(out.marketCap.value, null, t);
    assert.equal(out.marketCap.source, 'hand-table:market-cap-hold', t);
    assert.match(out.meta.marketCapReason, /^Börsenwert nicht verlässlich:/, t);
  }
});

test('live files are unchanged by this test', () => {
  assert.deepEqual(liveHashes(), beforeHashes);
});

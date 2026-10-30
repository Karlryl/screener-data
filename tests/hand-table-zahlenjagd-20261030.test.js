'use strict';
// Hand tables from the board-top check of 30.10.2026 (lane zahlenjagd): the top 10 of every board against primary filings.
// Two independent verifiers read each filing; the real vendor packets of run 41027769596 are in
// tests/fixtures/hand-table-zahlenjagd-20261030.json.
// - IOS.DE: Q2 2025 still holds the AdTech unit sold off since (shown -21.4 %); Q3 2025 is 85.2 instead of 324.2. Both withheld.
// - JIOFIN.BO: annual revenue FY26 and FY25 match no statement line (shown +136.4 %, filed +72.0 %).
// - ALK.TO: the vendor skips FY2025 on this listing, a two-year change stood as annual growth (+443.2 %, filed +256.7 %).
// - 601456.SS: annual revenue 2025, 2024 and 2023 match no statement line (shown +107.2 %, filed +186.0 %).
// - 600292.SS: Q2 2025 is pre-merger, Q2 2026 post-merger (shown +278 %, comparable about +24.7 %). Withheld.
// - 0097.KL, ETERNAL.BO, PASS3.SA, PAYTM.BO: annual operating income matches no filed line and not the vendor's own quarters.
// - FAST.AS, ISAE3.SA: market cap from a wrong share count (twice too many; all share classes at the ordinary-share price).
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
const ROWS = { 'IOS.DE': 2, 'JIOFIN.BO': 2, 'ALK.TO': 1, '0097.KL': 3, 'ETERNAL.BO': 1, 'PASS3.SA': 1, 'PAYTM.BO': 1, '601456.SS': 3, '600292.SS': 1 };
/** Table copy without this lane's rows: the state of the base commit before the change. */
function before() {
  const copy = structuredClone(table);
  copy.cases = copy.cases.filter(c => c.revision !== REV);
  return validateTable(copy);
}
const AFTER = { 'IOS.DE': ['year', '2025-12-31', '2024-12-31', 5.5], 'JIOFIN.BO': ['year', '2026-03-31', '2025-03-31', 72], '601456.SS': ['year', '2025-12-31', '2024-12-31', 186], '600292.SS': ['year', '2025-12-31', '2024-12-31', -15.9] };

if (process.argv.includes('--prove-red')) {
  // Without the rows the shown growth must differ from AFTER, so this deepEqual has to throw.
  assert.deepEqual(leg(apply('JIOFIN.BO', before())), AFTER['JIOFIN.BO']);
  console.log('hand-table-zahlenjagd-20261030: --prove-red did NOT fire');
  process.exit(0);
}

const own = table.cases.filter(c => c.revision === REV);

test('15 sourced rows validate; every reason names its period, no substitute 0, no dash as punctuation', () => {
  assert.equal(own.length, 15);
  assert.deepEqual(Object.fromEntries(Object.keys(ROWS).map(t => [t, own.filter(c => c.ticker === t).length])), ROWS);
  for (const c of own) {
    assert.ok(c.sources.length && c.sources.every(s => s.url.startsWith('https://') && s.quote && s.page && s.verifiedAt === '2026-10-30'), c.caseId);
    assert.match(c.reason, /\(Ende \d{2}\.\d{2}\.\d{4}\)/, c.caseId + ': the reason names its period end');
    assert.match(c.reason, /Geprüft am 30\.10\.2026\.$/, c.caseId);
    assert.doesNotMatch(c.reason, / [–—-] /, c.caseId + ': dash as punctuation');
    assert.notEqual(c.replacementValue, 0, c.caseId + ': never a substitute 0');
    // A quarterly replacement would need coverage of the whole series; these two series are withheld cell by cell.
    if (c.periodType === '3M') assert.equal(c.replacementValue, null, c.caseId);
  }
  assert.equal(table.coverage.some(v => Object.keys(ROWS).includes(v.ticker)), false, 'no coverage row: newer vendor quarters stay visible');
});

test('IOS.DE: the mixed-basis quarter is gone, the shown growth falls back to the year pair (+5.5 %)', () => {
  assert.deepEqual(leg(apply('IOS.DE', before())), ['quarter', '2026-06-30', '2025-06-30', -21.4]);
  const out = apply('IOS.DE');
  assert.deepEqual(native(out, 'timeseries', 'revenueQ'), [352747000, 348371000, 336653000, null, null]);
  assert.deepEqual(leg(out), AFTER['IOS.DE']);
  assert.ok(financialReasons(out).some(r => r.includes('rund +8,1 %')), 'the comparable growth is named');
  assert.deepEqual(native(apply('IOS.VI'), 'timeseries', 'revenueQ'), [352747000, 348371000, 336653000, null, null], 'the Vienna listing carries the same packet');
});

test('JIOFIN: filed revenue replaces both years, growth +72.0 % instead of +136.4 %, older years stay empty', () => {
  for (const t of ['JIOFIN.BO', 'JIOFIN.NS']) {
    assert.deepEqual(leg(apply(t, before())), ['year', '2026-03-31', '2025-03-31', 136.4], t);
    const out = apply(t);
    assert.deepEqual(native(out, 'annual', 'annualRev'), [35132600000, 20429100000, null, null], t);
    assert.deepEqual(leg(out), AFTER['JIOFIN.BO'], t);
    assert.deepEqual(native(out, 'timeseries', 'revenueQ'), native(snap(t), 'timeseries', 'revenueQ'), t + ': the quarters stay');
  }
});

test('ALK.TO: the two-year pair is withheld, no growth number remains; the reason names the filed +256.7 %', () => {
  assert.deepEqual(leg(apply('ALK.TO', before())), ['year', '2026-06-30', '2024-06-30', 443.2]);
  const out = apply('ALK.TO');
  assert.deepEqual(native(out, 'annual', 'annualRev'), [939676000, null, null, null]);
  assert.deepEqual(leg(out), ['none', null, null, null]);
  assert.ok(financialReasons(out).some(r => r.includes('+256,7 %')));
});

test('601456.SS: filed revenue gives +186.0 % instead of +107.2 %', () => {
  assert.deepEqual(leg(apply('601456.SS', before())), ['year', '2025-12-31', '2024-12-31', 107.2]);
  const out = apply('601456.SS');
  assert.deepEqual(native(out, 'annual', 'annualRev'), [7673396284, 2683134476, 2955461375, null]);
  assert.deepEqual(leg(out), AFTER['601456.SS']);
});

test('600292.SS: the pre-merger quarter is withheld, +278 % is gone, the filed year pair is shown; the reason names +24.7 %', () => {
  assert.deepEqual(leg(apply('600292.SS', before())), ['quarter', '2026-06-30', '2025-06-30', 278]);
  const out = apply('600292.SS');
  assert.equal(value(out.timeseries.revenueQ[4]), null);
  assert.deepEqual(leg(out), AFTER['600292.SS']);
  assert.ok(financialReasons(out).some(r => r.includes('rund +24,7 %')));
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

test('a changed vendor value is never replaced by the old correction', () => {
  const s = snap('JIOFIN.BO');
  s.annual.annualRev[0] = { ...s.annual.annualRev[0], value: value(s.annual.annualRev[0]) * 1.1 };
  const out = applyFinancialCases(s).snapshot;
  assert.equal(value(out.annual.annualRev[0]), null, 'the cell turns empty instead of showing a stale value');
});

const CAP = {
  'FAST.AS': { shares: 19752877, wrong: 38933085, ok: 19752877 },
  'ISAE3.SA': { shares: 559990445, wrong: 660801338, ok: 559990445 },
};
const withImplied = (t, shares) => { const s = snap(t); s.marketCap.value = s.price.regularMarketPrice * shares; return s; };

test('market cap: the two rows land on price x issuer count, with reason, and the derived vendor ratios are blanked', () => {
  for (const [t, w] of Object.entries(CAP)) {
    const out = guard.prepareMarketCap(snap(t));
    assert.equal(out.marketCap.source, 'hand-table:shares', t);
    assert.ok(Math.abs(out.marketCap.value / (out.price.regularMarketPrice * w.shares) - 1) < 1e-9, t);
    assert.equal(out.marketCap.yahooValue, fixtures[t].marketCap.value, t);
    assert.equal(out.meta.marketCapReason, guard.table[t].reason, t);
    for (const f of ['priceSales', 'enterpriseValue', 'enterpriseToRevenue', 'enterpriseToEbitda']) assert.equal(out.metrics[f] ?? null, null, `${t}: ${f}`);
  }
  assert.ok(Math.abs(guard.prepareMarketCap(snap('FAST.AS')).marketCap.value / 731e6 - 1) < 0.01, 'about 0.73 bn USD');
  assert.ok(Math.abs(guard.prepareMarketCap(snap('ISAE3.SA')).marketCap.value / 3691e6 - 1) < 0.01, 'about 3.69 bn USD');
  assert.equal(guard.correctedBelowFloor(guard.prepareMarketCap(snap('FAST.AS'))), true, 'Fastned falls below the 800 million floor of the main boards');
  assert.equal(guard.correctedBelowFloor(guard.prepareMarketCap(snap('ISAE3.SA'))), false);
});

test('market cap: a fixed vendor count is confirmed; ISAE3.SA also survives the vendor moving to the full share total', () => {
  for (const [t, w] of Object.entries(CAP)) {
    const out = guard.prepareMarketCap(withImplied(t, w.ok));
    assert.notEqual(out.marketCap.source, 'hand-table:shares', t);
    assert.equal(out.meta.marketCapReason, undefined, t);
  }
  assert.equal(guard.prepareMarketCap(withImplied('ISAE3.SA', 703327748)).marketCap.source, 'hand-table:shares');
});

test('market cap: an unknown vendor count is withheld with reason, never corrected blindly', () => {
  for (const t of Object.keys(CAP)) {
    const out = guard.prepareMarketCap(withImplied(t, 1e9));
    assert.equal(out.marketCap.value, null, t);
    assert.equal(out.marketCap.source, 'hand-table:market-cap-hold', t);
    assert.match(out.meta.marketCapReason, /^Börsenwert nicht verlässlich:/, t);
  }
});

test('live files are unchanged by this test', () => {
  assert.deepEqual(liveHashes(), beforeHashes);
});

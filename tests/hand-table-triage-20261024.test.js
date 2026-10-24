'use strict';
// Hand tables from the plausibility triage of 24.10.2026 (lane sd-triage-handtabelle). Every row was checked against the
// issuer document quoted in its sources; the real frozen packets of run 39918190374 (data day 23.10.2026) are in
// tests/fixtures/financial-known-cases.json. Holds:
// - UWMC: the vendor quarter 2026-06-30 is negative (-112.0 million USD; UWM reports 888.0 million). Withheld without a
//   replacement value (the other vendor quarters stand on another basis); the shown growth falls back to the year pair.
// - MPHC.QA: the vendor "revenue" is the equity-method share of results plus interest income of a holding; all five
//   quarters and the newest year are withheld (the no-gap rule withholds the older years).
// - FRNM, ESDS.NS (and ESDS.BO): vendor zeros in revenue and gross profit of the quarter 2026-06-30 are withheld.
// - ROB.WA: the vendor zero as 2025 revenue is withheld; the stale 2017 to 2015 years go with it (no gap is bridged).
// - 2855.TW, 6005.TW: the vendor income lines of both brokers stand on another basis. Revenue (and President's operating
//   profit) is replaced in all five quarters from the issuer statements (fully verified, so the series are covered);
//   gross profit (no issuer line), Capital's operating income and the annual lines are withheld cell by cell.
// Every red probe changes an in-memory table copy only; live files are hashed before and after.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { applyFinancialCases, financialReasons, validateTable, table } = require('../lib/financial-known-cases.js');
const { revQuartalsYoY } = require('../src/scoring/axes.js');
const { g31Shadow } = require('../lib/g31-recency.js');
const fixtures = require('./fixtures/financial-known-cases.json').snapshots;
const root = path.resolve(__dirname, '..');
const live = ['configs/financial-known-cases.json', 'tests/fixtures/financial-known-cases.json', 'lib/financial-known-cases.js'];
const liveHashes = () => live.map(f => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, f))).digest('hex'));
const beforeHashes = liveHashes();
const REV = '2026-10-24-sdtriage';
const value = row => typeof row === 'number' ? row : row?.value ?? null;
const snap = t => structuredClone(fixtures[t]);
const apply = (t, cfg) => applyFinancialCases(snap(t), cfg && { table: cfg }).snapshot;
const native = (s, box, field) => s[box][field].map(r => value(r) === null ? null : Math.round(value(r) / s.meta.fxRateApplied * 100) / 100);
const leg = s => { const v = g31Shadow(s).v1; return [v.basis, v.periodEnd, v.priorPeriodEnd, v.pct === null ? null : Math.round(v.pct * 10) / 10]; };
/** Table copy without this lane's rows: the state of the base commit before the change. */
function before() {
  const copy = structuredClone(table);
  copy.cases = copy.cases.filter(c => c.revision !== REV);
  copy.coverage = copy.coverage.filter(v => !['2855.TW', '6005.TW'].includes(v.ticker));
  return validateTable(copy);
}
const own = table.cases.filter(c => c.revision === REV);

test('48 triage cells and three fully verified coverage rows validate; every reason names its period, no substitute 0', () => {
  assert.equal(own.length, 48);
  assert.deepEqual(Object.fromEntries(['UWMC', 'MPHC.QA', 'FRNM', 'ESDS.NS', 'ROB.WA', '2855.TW', '6005.TW'].map(t => [t, own.filter(c => c.ticker === t).length])),
    { UWMC: 1, 'MPHC.QA': 6, FRNM: 2, 'ESDS.NS': 2, 'ROB.WA': 1, '2855.TW': 18, '6005.TW': 18 });
  assert.deepEqual(table.coverage.filter(v => ['2855.TW', '6005.TW', 'UWMC', 'MPHC.QA'].includes(v.ticker)).map(v => `${v.ticker}|${v.field}|${v.coversThrough}`),
    ['2855.TW|revenueQ|2026-06-30', '2855.TW|opIncQ|2026-06-30', '6005.TW|revenueQ|2026-06-30']);
  for (const c of own) {
    assert.ok(c.sources.length && c.sources.every(s => s.url.startsWith('https://') && s.quote && s.page && s.verifiedAt === '2026-10-24'), c.caseId);
    assert.match(c.reason, /\(Ende \d{2}\.\d{2}\.\d{4}/, c.caseId + ': the reason names its period end');
    assert.match(c.reason, /Geprüft am 24\.10\.2026\.$/, c.caseId);
    assert.notEqual(c.replacementValue, 0, c.caseId + ': never a substitute 0');
    // Covered series: every vendor quarter of the fixture has its own case, so coverage withholds no checked cell.
    if (c.replacementValue !== null) assert.ok(table.coverage.some(v => v.ticker === c.ticker && v.field === c.field), c.caseId);
  }
});

test('UWMC: the negative June quarter 2026 is withheld; the year pair 2025 against 2024 (+11.1 %) is shown', () => {
  const out = apply('UWMC');
  assert.deepEqual(native(out, 'timeseries', 'revenueQ'), [null, 504502000, 522412000, 338597000, 651104000]);
  assert.equal(out.timeseries.revenueQ[0].financialCorrection.caseId, 'uwmc-2026-06-30-revenueQ-20261024');
  assert.equal(revQuartalsYoY(out), null);
  assert.deepEqual(leg(out), ['year', '2025-12-31', '2024-12-31', 11.1]);
  assert.deepEqual(leg(snap('UWMC')), ['quarter', '2026-06-30', '2025-06-30', -117.2], 'the input showed -117.2 %');
});

test('MPHC.QA: all revenue quarters and years are withheld; neither -98.4 % nor -25.3 % appears', () => {
  const out = apply('MPHC.QA');
  assert.deepEqual(native(out, 'timeseries', 'revenueQ'), [null, null, null, null, null]);
  assert.deepEqual(native(out, 'annual', 'annualRev'), [null, null, null, null, null]);
  assert.deepEqual(leg(out), ['none', null, null, null]);
  assert.deepEqual(leg(snap('MPHC.QA')), ['quarter', '2026-06-30', '2025-06-30', -190.4]);
  const reasons = financialReasons(out);
  for (const c of own.filter(c => c.ticker === 'MPHC.QA')) assert.ok(reasons.includes(c.reason), c.caseId);
});

test('FRNM and ESDS: the vendor zeros of the quarter 2026-06-30 are withheld, the shown year growth is unchanged', () => {
  // ESDS.BO carries the identical vendor packet as ESDS.NS (listing alias); the alias leg is the NS packet renamed.
  const packet = t => { if (t !== 'ESDS.BO') return snap(t); const s = snap('ESDS.NS'); s.meta.ticker = t; return s; };
  for (const [t, growth] of [['FRNM', 955.1], ['ESDS.NS', 30.7], ['ESDS.BO', 30.7]]) {
    const input = packet(t), out = applyFinancialCases(input).snapshot;
    for (const f of ['revenueQ', 'grossProfitQ']) {
      assert.equal(value(input.timeseries[f][0]), 0, t + ' ' + f + ' vendor zero in the input');
      assert.equal(value(out.timeseries[f][0]), null, t + ' ' + f);
      assert.equal(out.timeseries[f][0].financialCorrection.originalNativeValue, 0);
    }
    assert.equal(financialReasons(out).length, 2, t);
    assert.deepEqual(leg(out), leg(input), t + ' growth unchanged');
    assert.equal(leg(out)[3], growth, t);
  }
});

test('ROB.WA: the vendor zero as 2025 revenue and the stale years before it are withheld; no growth is shown', () => {
  const out = apply('ROB.WA');
  assert.deepEqual(out.annual.annualRevEnds, ['2025-12-31', '2017-12-31', '2016-12-31', '2015-12-31']);
  assert.deepEqual(native(out, 'annual', 'annualRev'), [null, null, null, null]);
  assert.deepEqual(leg(out), ['none', null, null, null]);
  assert.deepEqual(leg(snap('ROB.WA')), ['year', '2025-12-31', '2017-12-31', -100]);
});

test('2855.TW and 6005.TW: revenue from the issuer statements in all five quarters, vendor gross profit and annual lines withheld', () => {
  const p = apply('2855.TW');
  assert.deepEqual(native(p, 'timeseries', 'revenueQ'), [12058748000, 5486108000, 4925145000, 4576444000, 2311393000]);
  assert.deepEqual(native(p, 'timeseries', 'opIncQ'), [5869930000, 2098581000, 1694145000, 1884389000, 264450000]);
  assert.deepEqual(native(p, 'timeseries', 'grossProfitQ'), [null, null, null, null, null]);
  for (const f of ['annualRev', 'annualGP', 'annualOpInc']) assert.deepEqual(native(p, 'annual', f), [null, null, null, null], '2855.TW ' + f);
  assert.deepEqual(leg(p), ['quarter', '2026-06-30', '2025-06-30', 421.7]);
  const k = apply('6005.TW');
  assert.deepEqual(native(k, 'timeseries', 'revenueQ'), [12066734000, 7131080000, 5295420000, 5493095000, 4453908000]);
  for (const f of ['grossProfitQ', 'opIncQ']) assert.deepEqual(native(k, 'timeseries', f), [null, null, null, null, null], '6005.TW ' + f);
  for (const f of ['annualRev', 'annualGP', 'annualOpInc']) assert.deepEqual(native(k, 'annual', f), [null, null, null, null], '6005.TW ' + f);
  assert.deepEqual(leg(k), ['quarter', '2026-06-30', '2025-06-30', 170.9]);
  // The inputs showed +7,387.5 % and +1,917.4 %.
  assert.deepEqual([leg(snap('2855.TW'))[3], leg(snap('6005.TW'))[3]], [7387.5, 1917.4]);
  // A new vendor quarter after the covered period is withheld (one stale event), the checked quarters stay corrected.
  for (const t of ['2855.TW', '6005.TW']) {
    const s = snap(t), ts = s.timeseries;
    ts.revenueQ = [{ value: 1e9 }, ...ts.revenueQ].slice(0, ts.revenueQ.length);
    ts.revenueQEnds = ['2026-09-30', ...ts.revenueQEnds].slice(0, ts.revenueQEnds.length);
    const r = applyFinancialCases(s);
    assert.equal(value(r.snapshot.timeseries.revenueQ[0]), null, t);
    assert.equal(r.snapshot.timeseries.revenueQ[0].financialMissing.reasonCode, 'period-after-coverage', t);
    assert.equal(r.events.filter(e => e.status === 'stale').length, 1, t);
    assert.equal(revQuartalsYoY(r.snapshot), null, t);
  }
});

test('break-once on test data: without these rows the wrong values are back; a mismatching vendor value is withheld, never replaced', () => {
  const guard = cfg => {
    assert.equal(value(apply('UWMC', cfg).timeseries.revenueQ[0]), null);
    assert.equal(leg(apply('2855.TW', cfg))[3], 421.7);
    assert.equal(value(apply('MPHC.QA', cfg).annual.annualRev[0]), null);
    assert.equal(value(apply('ROB.WA', cfg).annual.annualRev[0]), null);
  };
  guard();
  assert.throws(() => guard(before()), assert.AssertionError);
  assert.deepEqual(leg(apply('2855.TW', before())), ['quarter', '2026-06-30', '2025-06-30', 7387.5]);
  // A quarterly case whose expectedBadValue no longer matches the stored vendor cell: the cell is withheld, not replaced.
  const wrong = structuredClone(table);
  wrong.cases.find(c => c.caseId === '2855.tw-2026-06-30-revenueQ-20261024').expectedBadValue = 1;
  const cell = apply('2855.TW', validateTable(wrong)).timeseries.revenueQ[0];
  assert.equal(cell.value, null);
  assert.equal(cell.financialMissing.reasonCode, 'vendor-value-changed');
  assert.throws(() => guard(validateTable(wrong)), assert.AssertionError);
  // An annual hold on a drifted vendor year withholds the whole series ('annual-value-changed').
  const drift = structuredClone(table);
  drift.cases.find(c => c.caseId === 'mphc.qa-2025-12-31-annualRev-20261024').expectedBadValue = 1;
  const rows = apply('MPHC.QA', validateTable(drift)).annual.annualRev;
  assert.ok(rows.filter(r => value(r) === null && r?.financialMissing).every(r => r.financialMissing.reasonCode === 'annual-value-changed'));
  // A replacement that matches no quoted source value is refused at validation.
  const typo = structuredClone(table);
  typo.cases.find(c => c.caseId === '6005.tw-2026-03-31-revenueQ-20261024').replacementValue += 1000;
  assert.throws(() => validateTable(typo), /Replacement matches no source value/);
  assert.deepEqual(liveHashes(), beforeHashes, 'live files unchanged');
});

// Case group 2 (dup-issuer table): Grupo Aeromexico stood twice on industrials profitable (live export 24.10.2026:
// AERO.MX rank 1457 at 37.5, the NYSE ADS AERO rank 1459 at 37.4). Home listing AERO.MX (20-F 2025: one ADS = 10 shares).
const dup = require('../lib/dup-issuer-shadow-table.js');
test('Aeromexico: the home listing AERO.MX keeps its rank in either tie order, the ADS AERO is marked and unranked', () => {
  const t = dup.loadDupIssuerShadowTable(), home = dup.homeListingIndex(t), marks = dup.secondaryIndex(t);
  assert.deepEqual([t['grupo-aeromexico'].codeKeeps, t['grupo-aeromexico'].homeListingProposal, t['grupo-aeromexico'].markFollowsHomeListing], ['AERO.MX', 'AERO.MX', undefined]);
  assert.deepEqual(marks.get('AERO'), { of: 'AERO.MX', issuer: 'Grupo Aeroméxico', homeListingProposal: 'AERO.MX' });
  assert.equal(marks.has('AERO.MX'), false);
  const rankOf = (order, index) => {
    const ranking = new Set(order); let rank = 0;
    return Object.fromEntries(order.map(x => [x, dup.dupIssuerRankGrund(x, index, ranking) ? null : ++rank]));
  };
  for (const order of [['A', 'AERO.MX', 'AERO', 'B'], ['A', 'AERO', 'AERO.MX', 'B']]) {
    const r = rankOf(order, home);
    assert.equal(r.AERO, null, order.join());
    assert.equal(r['AERO.MX'], 2, order.join());
    assert.equal(r.B, 3, order.join() + ': the row below moves up one place');
  }
  // AERO alone keeps its rank (the firm never vanishes from a ranking).
  assert.equal(dup.dupIssuerRankGrund('AERO', home, new Set(['AERO', 'B'])), null);
  // Break-once on a table copy: with the open proposal of the base commit both rows keep a rank.
  const open = structuredClone(t);
  Object.assign(open['grupo-aeromexico'], { codeKeeps: 'AERO', homeListingProposal: null });
  const r = rankOf(['A', 'AERO.MX', 'AERO', 'B'], dup.homeListingIndex(open));
  assert.deepEqual([r['AERO.MX'], r.AERO], [2, 3]);
  assert.throws(() => assert.equal(r.AERO, null), assert.AssertionError);
});

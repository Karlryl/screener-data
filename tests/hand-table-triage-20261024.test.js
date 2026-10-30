'use strict';
// Hand tables from the plausibility triage of 24.10.2026 (lane sd-triage-handtabelle). Every row was checked against the
// issuer document quoted in its sources; the real frozen packets of run 39918190374 (data day 23.10.2026) are in
// tests/fixtures/financial-known-cases.json. Holds:
// - UWMC: the vendor quarter 2026-06-30 is negative (-112.0 million USD; UWM reports 888.0 million). Withheld without a
//   replacement value (the other vendor quarters stand on another basis); the shown growth falls back to the year pair.
// - MPHC.QA: the vendor "revenue" is the equity-method share of results plus interest income of a holding; all five
//   quarters and the newest year are withheld (the no-gap rule withholds the older years), and the packet is
//   quarantined like 402340.KS so the holding is not placed on the survival list as a firm without revenue.
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

// Fix round (review of #44): with its revenue withheld the engine put MPHC.QA on the survival list (no-revenue) although
// it is an equity-method holding. The 402340.KS precedent (quarantine of the packet) takes it off every board.
test('MPHC.QA: the packet is held as a quarantine; the row is excluded as data-suspect, also from the survival list', () => {
  const score = require('../src/scoring/score.js'), formulas = require('../src/scoring/formulas/index.js');
  const q = table.quarantines.find(x => x.ticker === 'MPHC.QA');
  assert.equal(q.caseId, 'mphc.qa-equity-method-revenue-20261024');
  assert.equal(q.reasonDate, '2026-10-24');
  assert.match(q.reason, /\(zweites Quartal 2026, Ende 30\.06\.2026/);
  assert.ok(q.sources.every(s => s.url.startsWith('https://') && s.quote && s.page));
  assert.deepEqual(table.quarantines.slice(-1), [q], 'appended after the eleven earlier holds');
  const scored = cfg => {
    const r = applyFinancialCases(snap('MPHC.QA'), cfg && { table: cfg });
    return { r, s: score.scoreUniverse([r.snapshot], formulas)[0] };
  };
  const { r, s } = scored();
  assert.equal(r.snapshot.meta.financialDataIssue.caseId, q.caseId);
  assert.ok(!r.events.some(e => e.status === 'stale'), 'the exact packet holds without a drift warning');
  assert.deepEqual([s.action, s.reason, s.score, s.reasonText], ['exclude', 'data-suspect', null, q.reason]);
  assert.ok(financialReasons(r.snapshot).includes(q.reason));
  // A drifted anchor keeps the hold and warns; the same packet under another ticker is not held.
  const drifted = snap('MPHC.QA'); drifted.timeseries.revenueQEnds[0] = '2026-09-30';
  assert.ok(applyFinancialCases(drifted).events.some(e => e.reasonCode === 'quarantine-fingerprint-changed' && e.caseId === q.caseId));
  const other = snap('MPHC.QA'); other.meta.ticker = 'UNLISTED';
  assert.equal(applyFinancialCases(other).snapshot.meta.financialDataIssue, undefined);
  // Break-once on test data: without the quarantine the holding lands on the survival list as a firm without revenue.
  const noHold = structuredClone(table); noHold.quarantines = noHold.quarantines.filter(x => x.ticker !== 'MPHC.QA');
  const without = scored(validateTable(noHold)).s;
  assert.deepEqual([without.action, without.reason], ['survival', 'no-revenue']);
  assert.throws(() => assert.equal(without.action, 'exclude'), assert.AssertionError);
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

test('ROB.WA: the visible hold reason names the annual leg only, because the vendor quarters (repaired on 27.10.2026) now give a quarter growth', () => {
  const c = own.find(x => x.ticker === 'ROB.WA');
  const OK = 'aus den Jahreszahlen wird kein Umsatzwachstum berechnet', OLD = 'und das Umsatzwachstum wird nicht berechnet';
  const pin = reason => { assert.ok(reason.includes(OK)); assert.ok(!reason.includes(OLD)); };
  pin(c.reason);
  assert.ok(financialReasons(apply('ROB.WA')).some(r => r === c.reason), 'the pinned text is the one shown on the board');
  // Break-once on test data: the old sentence in an in-memory copy fails the pin.
  assert.throws(() => pin(c.reason.replace(OK, 'das Umsatzwachstum wird nicht berechnet')), assert.AssertionError);
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

// Case group 3 (G31 hint table, code uebernahme): the shown growth is right but not comparable. Real vendor cells of
// the run 39918190374 (data day 23.10.2026), reduced to the fields the G31 pair reads. Numbers are not changed.
const { Module, createRequire } = require('node:module');
const HINT_SNAPS = {"603991.SS":{"meta":{"ticker":"603991.SS","name":"Shenzhen Leading Semiconductor Industry Co., Ltd.","country":"China","exchangeName":"Shanghai","reportingCurrency":"USD","reportingCurrencyOriginal":"CNY","tradingCurrency":"CNY","tradingCurrencyAssumed":false,"_ccyMissingCompletely":false,"ccyAmbiguous":false,"fxRateApplied":0.14942546,"fxConverted":true,"fetchedAt":"2026-10-14T08:17:24.505Z"},"timeseries":{"revenueQ":[{"value":164965577.68743584},{"value":133855180.68334812},{"value":59729626.843026},{"value":7917406.412696465},{"value":7649180.9938277835}],"revenueQEnds":["2026-06-30","2026-03-31","2025-12-31","2025-06-30","2025-03-31"],"grossProfitQ":[{"value":38796444.921315536},{"value":21467102.517214086},{"value":11386331.605577163},{"value":1006562.3343446023},{"value":498396.33158591506}],"grossProfitQEnds":["2026-06-30","2026-03-31","2025-12-31","2025-06-30","2025-03-31"]},"annual":{"annualRev":[{"value":82227449.12640382},{"value":54474950.69438977},{"value":35775331.50881758},{"value":19354173.94493726}],"annualRevEnds":["2025-12-31","2024-12-31","2023-12-31","2022-12-31"]}},"JOBY":{"meta":{"ticker":"JOBY","name":"Joby Aviation, Inc.","country":"United States","exchangeName":"NYSE","reportingCurrency":"USD","reportingCurrencyOriginal":"USD","tradingCurrency":"USD","tradingCurrencyAssumed":false,"_ccyMissingCompletely":false,"ccyAmbiguous":false,"fxRateApplied":1,"fxConverted":true,"fetchedAt":"2026-10-14T08:32:46.780Z"},"timeseries":{"revenueQ":[{"value":38639000},{"value":24246000},{"value":30836000},{"value":22574000},{"value":15000}],"revenueQEnds":["2026-06-30","2026-03-31","2025-12-31","2025-09-30","2025-06-30"],"grossProfitQ":[{"value":10341000},{"value":5443000},{"value":11578000},{"value":12514000},{"value":5000}],"grossProfitQEnds":["2026-06-30","2026-03-31","2025-12-31","2025-09-30","2025-06-30"]},"annual":{"annualRev":[{"value":53425000},{"value":136000},{"value":1032000},null],"annualRevEnds":["2025-12-31","2024-12-31","2023-12-31","2022-12-31"]}},"QUBT":{"meta":{"ticker":"QUBT","name":"Quantum Computing Inc.","country":"United States","exchangeName":"NasdaqCM","reportingCurrency":"USD","reportingCurrencyOriginal":"USD","tradingCurrency":"USD","tradingCurrencyAssumed":false,"_ccyMissingCompletely":false,"ccyAmbiguous":false,"fxRateApplied":1,"fxConverted":true,"fetchedAt":"2026-10-14T08:39:28.479Z"},"timeseries":{"revenueQ":[{"value":5551000},{"value":3691000},{"value":198000},{"value":384000},{"value":61000}],"revenueQEnds":["2026-06-30","2026-03-31","2025-12-31","2025-09-30","2025-06-30"],"grossProfitQ":[{"value":-1166000},{"value":-721000},{"value":-98000},{"value":126000},{"value":26000}],"grossProfitQEnds":["2026-06-30","2026-03-31","2025-12-31","2025-09-30","2025-06-30"]},"annual":{"annualRev":[{"value":682000},{"value":373000},{"value":358000},{"value":136000}],"annualRevEnds":["2025-12-31","2024-12-31","2023-12-31","2022-12-31"]}},"000656.SZ":{"meta":{"ticker":"000656.SZ","name":"Jinke Property Group Co., Ltd.","country":"China","exchangeName":"Shenzhen","reportingCurrency":"USD","reportingCurrencyOriginal":"CNY","tradingCurrency":"CNY","tradingCurrencyAssumed":false,"_ccyMissingCompletely":false,"ccyAmbiguous":false,"fxRateApplied":0.14942546,"fxConverted":true,"fetchedAt":"2026-10-14T08:07:47.247Z"},"timeseries":{"revenueQ":[{"value":9662166.46373547},{"value":35850604.60072938},{"value":177018017.45561177},{"value":240526166.81117603},{"value":112507787.07111035}],"revenueQEnds":["2026-06-30","2026-03-31","2025-12-31","2025-06-30","2025-03-31"],"grossProfitQ":[{"value":4738428.012631536},{"value":4924102.06002979},{"value":43789352.48658917},{"value":24196781.621384516},{"value":8215261.486718295}],"grossProfitQEnds":["2026-06-30","2026-03-31","2025-12-31","2025-06-30","2025-03-31"]},"annual":{"annualRev":[{"value":1028665225.5989248},{"value":4117392767.123659},{"value":9449402892.80717},{"value":8197761984.381618}],"annualRevEnds":["2025-12-31","2024-12-31","2023-12-31","2022-12-31"]}}};
const G31 = require('../lib/g31-recency.js');
const hintTable = require('../configs/g31-hinweise.json');
/** lib/g31-recency.js compiled with another hint table (in memory; the live file is untouched). */
function g31With(entries) {
  const file = path.join(root, 'lib', 'g31-recency.js'), m = new Module(file, module), real = createRequire(file);
  m.filename = file; m.paths = module.paths;
  m.require = id => id === '../configs/g31-hinweise.json' ? { ...hintTable, entries } : real(id);
  m._compile(fs.readFileSync(file, 'utf8'), file);
  return m.exports;
}
const TRIAGE_HINTS = ['603991.SS', 'JOBY', 'QUBT', '000656.SZ'];
test('hints: 603991.SS, JOBY, QUBT and 000656.SZ carry the checked hint for exactly the shown pair; values unchanged', () => {
  const own = hintTable.entries.filter(e => TRIAGE_HINTS.includes(e.ticker));
  assert.deepEqual(own.map(e => [e.ticker, e.periodEnd, e.priorPeriodEnd, e.code]), [
    ['603991.SS', '2026-06-30', '2025-06-30', 'uebernahme'], ['JOBY', '2026-06-30', '2025-06-30', 'uebernahme'],
    ['JOBY', '2026-09-30', '2025-09-30', 'uebernahme'], ['QUBT', '2026-06-30', '2025-06-30', 'uebernahme'],
    ['000656.SZ', '2026-06-30', '2025-06-30', 'uebernahme']]);
  for (const e of own) {
    assert.match(e.reason, /Geprüft am 24\.10\.2026\.$/, e.ticker);
    assert.ok(e.reason.includes(e.periodEnd.split('-').reverse().join('.')), e.ticker + ' names the period ' + e.periodEnd);
    assert.ok(e.sources.every(s => s.url.startsWith('https://') && s.quote && s.page), e.ticker);
  }
  const pct = { '603991.SS': 1983.6, JOBY: 257493.3, QUBT: 9000, '000656.SZ': -96 };
  for (const t of TRIAGE_HINTS) {
    const s = structuredClone(HINT_SNAPS[t]), v = G31.g31Shadow(s).v1;
    assert.deepEqual([v.basis, v.sourcePeriodEnd, v.sourcePriorPeriodEnd, Math.round(v.pct * 10) / 10], ['quarter', '2026-06-30', '2025-06-30', pct[t]], t);
    const h = G31.g31Export(s).g31Hinweis;
    assert.equal(h.code, 'uebernahme', t);
    assert.equal(h.reason, own.find(e => e.ticker === t && e.periodEnd === '2026-06-30').reason, t);
    // Another listing with the identical packet gets no hint (bound to the listing).
    const other = structuredClone(s); other.meta.ticker = t + 'X';
    assert.equal(G31.g31Export(other).g31Hinweis, null, t);
  }
  // JOBY: the September pair (Blade only from 29.08.2025 in the prior-year quarter) takes the second entry.
  const next = structuredClone(HINT_SNAPS.JOBY), ts = next.timeseries;
  ts.revenueQ = [{ value: 40e6 }, ...ts.revenueQ]; ts.revenueQEnds = ['2026-09-30', ...ts.revenueQEnds];
  const leg = G31.g31Shadow(next).v1;
  assert.deepEqual([leg.sourcePeriodEnd, leg.sourcePriorPeriodEnd], ['2026-09-30', '2025-09-30']);
  assert.equal(G31.g31Export(next).g31Hinweis.reason, own.find(e => e.ticker === 'JOBY' && e.periodEnd === '2026-09-30').reason);
  // A December pair is comparable again: no checked hint.
  const dec = structuredClone(next); dec.timeseries.revenueQ.unshift({ value: 45e6 }); dec.timeseries.revenueQEnds.unshift('2026-12-31');
  assert.notEqual(G31.g31Export(dec).g31Hinweis?.code, 'uebernahme');
  // CHAM.SW stays open: the hint table takes quarter and half-year pairs only, and no code fits one-off condominium sales.
  assert.ok(!hintTable.entries.some(e => e.ticker === 'CHAM.SW'));
});

test('hints break-once on test data: without the triage entries the four rows carry no hint', () => {
  const without = g31With(hintTable.entries.filter(e => !TRIAGE_HINTS.includes(e.ticker)));
  const withAll = g31With(hintTable.entries);
  for (const t of TRIAGE_HINTS) {
    assert.equal(withAll.g31Export(structuredClone(HINT_SNAPS[t])).g31Hinweis.code, 'uebernahme', t);
    assert.throws(() => assert.equal(without.g31Export(structuredClone(HINT_SNAPS[t])).g31Hinweis?.code, 'uebernahme'), assert.AssertionError, t);
  }
  assert.deepEqual(liveHashes(), beforeHashes, 'live files unchanged');
});

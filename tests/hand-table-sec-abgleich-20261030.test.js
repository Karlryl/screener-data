'use strict';
// Hand table 30.10.2026, lane sec-abgleich: every US board firm was compared with SEC raw data by two independent
// scripts; these eleven firms are the confirmed errors, each read again from the printed filing by a separate reader.
// Revenue: EGY (177.9 M against 135.2 M filed, growth 83.6 % instead of 39.5 %, rank 1 on the small-cap energy board),
// FTW (the vendor "quarter" is the successor period 4 March to 30 June), SUNC (both quarters doubled), HRI (a loss
// netted out of the year-ago quarter), AHCO (quarters on no filed basis), GLXY (annual series on another basis), JAN (2025 is the pro forma of the prospectus).
// Operating income with the wrong sign in the vendor year: RDW, WWW, LINE, ANRO. Their fourth quarter is derived from
// that year and is withheld. Real vendor cells of run 41027769596 (small-cap store of run 40873805484) sit in the
// fixtures. Every red probe changes an in-memory table copy only; live files are hashed before and after.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { applyFinancialCases, validateTable, table } = require('../lib/financial-known-cases.js');
const { g31Shadow, g31Hinweis } = require('../lib/g31-recency.js');
const { unprofit } = require('../src/scoring/lamps.js');
const fixture = require('./fixtures/financial-known-cases.json').snapshots;
const control = require('./fixtures/hand-table-sec-abgleich-20261030.json').AAPL;

const root = path.resolve(__dirname, '..');
const live = ['configs/financial-known-cases.json', 'configs/g31-hinweise.json', 'lib/financial-known-cases.js'];
const liveHashes = () => live.map(f => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, f))).digest('hex'));
const beforeHashes = liveHashes();
const REV = '2026-10-30-secabgleich'; // Review of #62: Herc gross profit, Janus net income, AHCO Q1 operating income, SUNC hint.
const FIRMS = ['EGY', 'FTW', 'SUNC', 'HRI', 'AHCO', 'GLXY', 'JAN', 'RDW', 'WWW', 'LINE', 'ANRO'];
const value = row => (row && typeof row === 'object' ? row.value ?? null : row ?? null);
const series = (s, c, f) => (s[c][f] || []).map(value);
const apply = (t, cfg) => applyFinancialCases(structuredClone(fixture[t]), cfg && { table: cfg }).snapshot;
const without = () => { const c = structuredClone(table); c.cases = c.cases.filter(x => x.revision !== REV); c.coverage = c.coverage.filter(v => !['EGY', 'FTW', 'SUNC', 'AHCO'].includes(v.ticker)); return validateTable(c); };
const growth = s => g31Shadow(s).v1;

test('70 rows of this lane, appended last, all eleven firms, four coverage rows, table valid', () => {
  const own = table.cases.filter(c => c.revision === REV);
  assert.equal(own.length, 70);
  const at = table.cases.findIndex(c => c.revision === REV);
  assert.deepEqual(table.cases.slice(at).map(c => c.revision), [...Array(70).fill(REV), ...Array(35).fill('2026-10-30-sdz1'), ...Array(35).fill('2026-10-30-secabgleich-ausland'), ...Array(3).fill('2026-10-30-sdb12')], 'only the board-top rows, the foreign filers and the period-gate holds of 30.10.2026 follow');
  assert.deepEqual([...new Set(own.map(c => c.ticker))].sort(), [...FIRMS].sort());
  assert.deepEqual(table.coverage.filter(v => ['EGY', 'FTW', 'SUNC', 'AHCO'].includes(v.ticker)).map(v => v.ticker + v.coversThrough).sort(),
    ['AHCO2026-06-30', 'EGY2026-06-30', 'FTW2026-06-30', 'SUNC2026-06-30']);
  for (const c of own) {
    assert.ok(c.sources.every(s => /^https:\/\/www\.sec\.gov\/Archives\/edgar\/data\/\d+\//.test(s.url) && s.quote && s.page), c.caseId);
    if (c.replacementValue === c.expectedBadValue) assert.match(c.reason, /^bestätigt:/, c.caseId);
    else assert.doesNotMatch(c.reason, /bestätigt:/, c.caseId);
  }
  assert.equal(validateTable(structuredClone(table)).cases.length, table.cases.length);
});

test('the quotes print the replacement values', () => {
  const k = (id, n) => { const c = table.cases.find(x => x.caseId === id); assert.ok(c, id); assert.ok(c.sources.some(s => s.quote.includes(n)), id + ' ' + JSON.stringify(c.sources.map(s => s.quote))); };
  k('egy-2026-06-30-revenueQ-20261030', '135,166');
  k('ftw-2026-06-30-revenueQ-20261030', '54,000');
  k('sunc-2026-06-30-revenueQ-20261030', '14,259');
  k('sunc-2025-06-30-revenueQ-20261030', '5,390');
  k('hri-2025-12-31-annualRev-20261030', '4,376');
  k('ahco-2026-06-30-revenueQ-20261030', '740,307');
  k('glxy-2025-12-31-annualRev-20261030', '60,406,728');
  k('jan-2025-12-31-annualRev-20261030', '603,989');
  k('rdw-2025-12-31-annualOpInc-20261030', '229,677');
  k('www-2025-12-31-annualOpInc-20261030', '150.2');
  k('line-2025-12-31-annualOpInc-20261030', '181');
  k('anro-2025-12-31-annualOpInc-20261030', '66,364');
});

test('revenue firms: the shown growth is the filed one, the error is back without these rows', () => {
  const old = without();
  // [ticker, growth before, growth after, basis after]
  for (const [t, was, now, basis] of [['EGY', 83.62, 39.5, 'quarter'], ['FTW', 62.69, 26.69, 'quarter'], ['SUNC', 164.55, 164.55, 'quarter'], ['HRI', 26.34, 22.65, 'year'], ['AHCO', 15.19, 12.66, 'quarter']]) {
    const before = growth(apply(t, old)), after = growth(apply(t));
    assert.ok(Math.abs(before.pct - was) < 0.02, `${t} before ${before.pct}`);
    assert.ok(Math.abs(after.pct - now) < 0.02, `${t} after ${after.pct}`);
    assert.equal(after.basis, basis, t);
  }
  assert.deepEqual(series(apply('SUNC'), 'timeseries', 'revenueQ'), [14259000000, 10690000000, null, 5390000000]);
  assert.deepEqual(series(apply('SUNC'), 'timeseries', 'grossProfitQ'), [null, 1403000000, null, null]);
  assert.deepEqual(series(apply('AHCO'), 'timeseries', 'grossProfitQ'), [null, null, null, null, null]);
  assert.deepEqual(series(apply('FTW'), 'timeseries', 'revenueQ'), [54000000, null, null, 42623000, 51942000]);
  assert.deepEqual(series(apply('GLXY'), 'annual', 'annualRev'), [60406728000, 42596673000, 51626779000, null]);
  assert.deepEqual(series(apply('GLXY'), 'annual', 'annualOpInc'), [null, null, null, null]);
  assert.deepEqual(series(apply('HRI'), 'annual', 'annualRev'), [4376000000, 3568000000, 3282000000, null]);
  assert.deepEqual(series(apply('JAN'), 'annual', 'annualRev'), [603989000, 568475000]);
  assert.deepEqual(series(apply('JAN'), 'annual', 'annualOpInc'), [null, null]);
  assert.deepEqual(series(apply('JAN'), 'annual', 'annualNetIncome'), [6349000, -50463000]);
  // Herc: the same 49 M USD sat in the vendor's gross profit; on the filed revenue it would be a mixed basis.
  assert.deepEqual(series(apply('HRI'), 'timeseries', 'grossProfitQ'), [377000000, 326000000, 403000000, 446000000, null]);
  assert.deepEqual(series(apply('HRI'), 'annual', 'annualGP').slice(0, 2), [null, null]);
  const q1 = apply('AHCO').timeseries;
  assert.equal(value(q1.opIncQ[q1.opIncQEnds.indexOf('2026-03-31')]), null);
});

test('operating income: filed sign, derived fourth quarter withheld, the lamp follows', () => {
  for (const [t, want, q4] of [
    ['RDW', [-229677000, -42200000, -15548000, -146448000], 377737000],
    ['WWW', [150200000, 97500000, -66800000, -208400000], -251500000],
    ['LINE', [181000000, -361000000, 398000000, 297000000], -295000000],
    ['ANRO', [-66364000, -68610000, -37809000, -29192000], 115673000],
  ]) {
    const s = apply(t);
    assert.deepEqual(series(s, 'annual', 'annualOpInc'), want, t);
    const i = s.timeseries.opIncQEnds.indexOf('2025-12-31');
    assert.equal(value(s.timeseries.opIncQ[i]), null, t);
    assert.equal(value(fixture[t].timeseries.opIncQ[i]), q4, t + ' vendor cell of the fixture');
  }
  // Wolverine earned money in 2024 and 2025: with the vendor sign it carried the lamp "unprofit".
  assert.equal(Boolean(unprofit(apply('WWW', without()))), true, 'lamp on with the vendor years');
  assert.equal(Boolean(unprofit(apply('WWW'))), false, 'lamp off with the filed years');
});

test('next quarter: covered series withhold it, Herc needs no table row', () => {
  const next = (t, v) => {
    const s = structuredClone(fixture[t]), ts = s.timeseries;
    ts.revenueQ = [{ value: v }, ...ts.revenueQ.slice(0, -1)]; ts.revenueQEnds = ['2026-09-30', ...ts.revenueQEnds.slice(0, -1)];
    return applyFinancialCases(s).snapshot;
  };
  for (const t of ['EGY', 'FTW', 'SUNC', 'AHCO']) {
    const row = next(t, 1e8).timeseries.revenueQ[0];
    assert.equal(value(row), null, t);
    assert.equal(row.financialMissing.reasonCode, 'period-after-coverage', t);
  }
  // Herc: the third quarter pairs with 2025-09-30, the withheld year-ago cell of June drops out by itself.
  const hri = structuredClone(fixture.HRI), ts = hri.timeseries;
  ts.revenueQ = [{ value: 1364000000 }, ...ts.revenueQ]; ts.revenueQEnds = ['2026-09-30', ...ts.revenueQEnds];
  const leg = growth(applyFinancialCases(hri).snapshot);
  assert.equal(leg.basis, 'quarter');
  assert.ok(Math.abs(leg.pct - 4.52) < 0.01, String(leg.pct));
});

test('absence: another listing and an untouched firm stay as they are; review hint names the takeover', () => {
  const other = structuredClone(fixture.EGY); other.meta.ticker = 'UNLISTED';
  assert.equal(applyFinancialCases(other).snapshot, other);
  const c = structuredClone(control);
  assert.equal(JSON.stringify(applyFinancialCases(c).snapshot.annual), JSON.stringify(control.annual));
  assert.equal(JSON.stringify(applyFinancialCases(c).snapshot.timeseries), JSON.stringify(control.timeseries));
  assert.equal(g31Hinweis(apply('FTW'))?.code, 'uebernahme');
  assert.equal(g31Hinweis(apply('SUNC'))?.code, 'uebernahme');
  assert.equal(g31Hinweis(apply('EGY')), null);
});

test('break once on the table copy: a dropped or drifted row turns the checks red', () => {
  const noEgy = structuredClone(table);
  noEgy.cases = noEgy.cases.filter(c => c.ticker !== 'EGY'); noEgy.coverage = noEgy.coverage.filter(v => v.ticker !== 'EGY');
  const leg = growth(applyFinancialCases(structuredClone(fixture.EGY), { table: noEgy }).snapshot);
  assert.ok(Math.abs(leg.pct - 83.62) < 0.02, 'without the rows the vendor growth is back: ' + leg.pct);
  const drift = structuredClone(table);
  drift.cases.find(c => c.caseId === 'rdw-2025-12-31-annualOpInc-20261030').expectedBadValue += 1;
  const s = applyFinancialCases(structuredClone(fixture.RDW), { table: drift }).snapshot;
  assert.equal(value(s.annual.annualOpInc[0]), null, 'a changed vendor value is withheld, never overwritten blindly');
  const bad = structuredClone(table);
  bad.cases.find(c => c.caseId === 'egy-2026-06-30-revenueQ-20261030').replacementValue = 135166001;
  assert.throws(() => validateTable(bad), /Replacement matches no source value/);
});

test('live files unchanged by this test file', () => {
  assert.deepEqual(liveHashes(), beforeHashes);
});

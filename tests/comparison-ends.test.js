'use strict';
// Untangle finding F004 (13.11.2026): every comparison arm a writer exports ends by data day, from one table
// (lib/comparison-ends.js), and no arm may span more than four weeks (Karl's rule, core "Bauen und Prüfen").
// Run: node tests/comparison-ends.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'comparison-ends-'));
process.env.FINDASH_SNAPSHOTS_DIR = path.join(tmp, 'snapshots');
process.env.FINDASH_SMALLCAP_SNAPSHOTS_DIR = path.join(tmp, 'snapshots-smallcap');
fs.mkdirSync(process.env.FINDASH_SNAPSHOTS_DIR); fs.mkdirSync(process.env.FINDASH_SMALLCAP_SNAPSHOTS_DIR);

const { COMPARISON_ARMS, MAX_COMPARISON_DAYS, comparisonShown, comparisonDataDay } = require('../lib/comparison-ends.js');
const { overviewMetric } = require('../src/scoring/overview.js');
const { produceRankings } = require('../src/scoring/score.js');
const axes = require('../src/scoring/axes.js');
const W = require('../scripts/write-findash-export.js');
const { buildExcludedList } = require('../scripts/write-excluded-list.js');
const { safeSnapshotFilename } = require('../lib/snapshot-fs.js');
const fixture = require('./fixtures/g31-switch/cases.json');
const ROOT = path.resolve(__dirname, '..');

const { onDay } = require('./helpers/comparison-day.js');
const R40 = require('../scripts/write-rule40-export.js');
const r40Baseline = require('./fixtures/mcap-classes-shadow/rule40-before.json');

test('every arm is a real date range of at most four weeks', () => {
  const day = s => Date.parse(s + 'T00:00:00Z');
  assert.ok(Object.keys(COMPARISON_ARMS).length >= 3);
  for (const [name, arm] of Object.entries(COMPARISON_ARMS)) {
    for (const d of [arm.start, arm.ends]) assert.match(d, /^\d{4}-\d{2}-\d{2}$/, name);
    const span = (day(arm.ends) - day(arm.start)) / 86400000;
    assert.ok(span > 0 && span <= MAX_COMPARISON_DAYS, `${name}: ${span} days from ${arm.start} to ${arm.ends}`);
  }
  assert.equal(MAX_COMPARISON_DAYS, 28);
});

test('the end is the first data day without the arm; the period-gate helper reads the same table', () => {
  assert.equal(comparisonShown('g31Legacy', '2026-11-15'), true);
  assert.equal(comparisonShown('g31Legacy', '2026-11-16'), false);
  assert.equal(comparisonShown('p290OldRule', '2026-12-09'), true);
  assert.equal(comparisonShown('p290OldRule', '2026-12-10'), false);
  for (const d of ['2026-11-13', '2026-12-03', '2026-12-04', '2027-01-01']) assert.equal(W.periodGateShadowShown(d), comparisonShown('periodGate', d), d);
  assert.throws(() => comparisonShown('noSuchArm', '2026-11-13'), /unknown comparison arm/);
  assert.equal(onDay('2026-11-17', () => comparisonDataDay()), '2026-11-17');
  assert.equal(comparisonDataDay('2026-11-13T09:00:00Z'), '2026-11-13');
});

test('findash rows carry the G31 legacy values before the end and null from the end (real writer)', () => {
  const run = (day, prefix) => onDay(day, () => {
    const s = structuredClone(fixture.cases.find(c => c.ticker === 'DAVE').snapshot);
    s.meta.ticker = prefix + 'DAVE';
    fs.writeFileSync(path.join(process.env.FINDASH_SNAPSHOTS_DIR, safeSnapshotFilename(s.meta.ticker)), JSON.stringify(s));
    const entry = { ticker: s.meta.ticker, action: 'route', formulaId: 'financials', track: 'profitable', score: 60,
      revGrowthYoYPct: axes.revGrowthLevel(s), overview: overviewMetric(s) };
    const ranked = produceRankings([entry]).branches.financials.profitable;
    return W.mapBoardRow(ranked[0], 0, 'main');
  });
  const before = run('2026-11-13', '_CE_A_'), after = run('2026-11-17', '_CE_B_');
  assert.equal(before.overviewValueLegacy, 0.704, 'comparison value still shown on 13.11.2026');
  assert.equal(after.overviewValueLegacy, null, 'comparison value gone from 16.11.2026');
  for (const k of ['revGrowthYoYPctLegacy', 'revGrowthBasisLegacy', 'revGrowthPeriodEndLegacy', 'revGrowthPriorPeriodEndLegacy', 'overviewPeriodLegacy']) {
    assert.ok(Object.hasOwn(after, k), k + ' stays in the contract');
    assert.equal(after[k], null, k);
  }
  assert.deepEqual([after.score, after.rank, after.overview.value], [before.score, before.rank, before.overview.value], 'score, rank and shown value unchanged');
  const errs = []; W.validateBoardRow(after, after.ticker, errs);
  assert.deepEqual(errs.filter(e => /Legacy/.test(e)), []);
});

test('Rule-of-40 rows carry the six G31 legacy fields before the end and null from the end, whatever the inputs carry', () => {
  const legacyKeys = ['revGrowthYoYPctLegacy', 'revGrowthBasisLegacy', 'revGrowthPeriodEndLegacy', 'revGrowthPriorPeriodEndLegacy', 'overviewValueLegacy', 'overviewPeriodLegacy'];
  const candidate = () => {
    const k = structuredClone(r40Baseline.candidates[1]);
    k.wachstumLegacy = { pct: 42.1, basis: 'year', periodEnd: '2025-12-31', priorPeriodEnd: '2024-12-31' };
    k.row = { ...k.row, overviewValueLegacy: 0.704, overviewPeriodLegacy: { basis: 'year', periodEnd: '2025-12-31', priorPeriodEnd: '2024-12-31', reason: null } };
    return k;
  };
  const before = onDay('2026-11-13', () => R40.baueZeilen([candidate()]).rows[0]);
  const after = onDay('2026-11-17', () => R40.baueZeilen([candidate()]).rows[0]);
  assert.deepEqual(legacyKeys.map(k => before[k]), [42.1, 'year', '2025-12-31', '2024-12-31', 0.704, { basis: 'year', periodEnd: '2025-12-31', priorPeriodEnd: '2024-12-31', reason: null }]);
  for (const k of legacyKeys) { assert.ok(Object.hasOwn(after, k), k + ' stays in the contract'); assert.equal(after[k], null, k); }
  assert.deepEqual([after.r40, after.ticker], [before.r40, before.ticker], 'the Rule-of-40 figure is unchanged');
});

test('excluded.json names the old P290 rule before the end and nothing from the end', () => {
  const leg = (t, c, m) => ({ ticker: t, snapshot: { meta: { ticker: t, name: 'Nestle SA', country: c }, marketCap: { value: m } } });
  const sw = leg('NESN.SW', 'Switzerland', 200e9), de = leg('NESR.DE', 'Switzerland', 201e9);
  const results = [{ ticker: 'NESN.SW', action: 'route', score: null, lamps: [] }, { ticker: 'NESR.DE', action: 'exclude', reason: 'dup-issuer', score: null, lamps: [] }];
  const diff = day => onDay(day, () => buildExcludedList(results, [sw.snapshot, de.snapshot], []).homeListing.oldRuleDiffers);
  assert.deepEqual(diff('2026-12-09'), [{ shown: 'NESN.SW', oldRule: 'NESR.DE' }]);
  assert.deepEqual(diff('2026-12-10'), []);
});

test('class guard: every export of an old calculation in scripts/ asks the table', () => {
  const sites = [];
  for (const f of fs.readdirSync(path.join(ROOT, 'scripts')).filter(f => f.endsWith('.js'))) {
    const lines = fs.readFileSync(path.join(ROOT, 'scripts', f), 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (/^\s*(\/\/|\*)/.test(line)) return;
      if (/withG31Variant\('legacy'/.test(line)) sites.push([f, i + 1, line, 'g31Legacy']);
      if (/\.sort\(issuerDedupComparatorOld\)/.test(line)) sites.push([f, i + 1, line, 'p290OldRule']);
    });
  }
  const writers = sites.filter(([f]) => /^write-/.test(f));
  assert.ok(writers.length >= 4, 'the writer sites are found: ' + writers.map(s => s[0] + ':' + s[1]).join(', '));
  for (const [f, n, line, arm] of writers) {
    assert.ok(line.includes(`comparisonShown('${arm}')`), `scripts/${f}:${n} exports the old calculation without comparisonShown('${arm}')`);
    assert.ok(!/comparisonShown\([^)]*\)\s*\|\|/.test(line), `scripts/${f}:${n}: the end is bypassed with ||`);
  }
  // The text guard finds new sites; the behaviour tests above prove the end on the real writers.
});

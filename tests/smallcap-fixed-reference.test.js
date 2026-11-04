'use strict';
// A floor exit may take only that firm off the boards: the small-cap pass reads coverage floor and score calibration
// from the versioned reference, so firms without an error of their own keep their place and their score.
// Files only under the OS temp folder. --break-once compiles each mutant in a child process in memory.
const assert = require('node:assert/strict');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');

const RS = path.join(__dirname, '..', 'src', 'scoring', 'run-screener.js');
const MUTANTS = {
  // Whole line of each guard, whatever the line ending. Each one is the behaviour before this fix.
  'live-calibration': [/^  return scoreUniverse\(universe, smallcapFormulas, \{ classify: smallcapRoute, growthBoost: false, refCalibration: reference\.calibration \}\);(?=\r?$)/m,
    '  return scoreUniverse(universe, smallcapFormulas, { classify: smallcapRoute, growthBoost: false });', /a floor exit must not move another firm's score/],
  'live-floor': [/^  const covFloor = reference\.coverageFloor;(?=\r?$)/m, '  const covFloor = covFloorLive;', /a floor exit must not move the coverage floor/],
  'reference-not-reported': [/^    reference: \{ version: reference\.version, .*(?=\r?$)/m, '    reference: { version: reference.version,', /the export must name the reference in force/],
  // The state before this fix: a thin cohort is skipped although the score reads its union.
  'thin-cohort-unwatched': [/^    if \(firms < MIN_COHORT_N\) \{(?=\r?$)/m, '    if (!own || firms < MIN_COHORT_N) {', /the pooled basis of a thin cohort must be watched/],
  'union-of-one-track': [/^    for \(const key of tracks\(bases, formula\)\) \{(?=\r?$)/m, '    for (const key of tracks(bases, formula).slice(0, 1)) {', /the watched union must be the basis the score reads/],
  'groups-not-exported': [/^      renewalDue, drift: \{ maxKs: .*(?=\r?$)/m, '      renewalDue, drift: { maxKs: Math.round(drift.maxKs * 1000) / 1000, ksThreshold: drift.ksThreshold, axesDrifted: drift.drifted.length } },', /the export must name the reference in force/],
  'group-not-named': [/^    notMonitored: Object\.keys\(notMonitored\)\.sort\(\)\.map\(\(group\) => notMonitored\[group\]\) \};(?=\r?$)/m, '    notMonitored: [] };', /a group too small to watch must be named/],
  'growth-watched': [/^  return \{ \.\.\.calibrationDrift\(\{ cohortBases: watchedLive \}, \{ cohortBases: watched \}\), watched,(?=\r?$)/m, '  return { ...calibrationDrift({ cohortBases: watchedLive, gDistByCohort: live.gDistByCohort }, { cohortBases: watched, gDistByCohort: reference.calibration.gDistByCohort }), watched,', /growth distributions enter no score here/],
  // The decision on the group size, which the score takes on the frozen n and at exactly 15 firms.
  'own-by-live-n': [/^    const own = \(frozen\[key\] \? frozen\[key\]\.n : live\.cohortBases\[key\]\.n\) >= MIN_COHORT_N; .*(?=\r?$)/m, '    const own = (live.cohortBases[key] ? live.cohortBases[key].n : frozen[key].n) >= MIN_COHORT_N;', /the decision reads the frozen n: a big cohort that shrank/],
  'own-above-15-only': [/^    const own = \(frozen\[key\] \? frozen\[key\]\.n : live\.cohortBases\[key\]\.n\) >= MIN_COHORT_N; .*(?=\r?$)/m, '    const own = (frozen[key] ? frozen[key].n : live.cohortBases[key].n) > MIN_COHORT_N;', /exactly 15 firms in one cohort read their own basis/],
  'small-group-up-to-15': [/^    if \(firms < MIN_COHORT_N\) \{(?=\r?$)/m, '    if (firms <= MIN_COHORT_N) {', /exactly 15 firms in one cohort read their own basis/],
  'firms-counted-live': [/^    const firms = own \? .*(?=\r?$)/m, '    const firms = own ? (frozen[key] ? frozen[key].n : 0) : tracks(live.cohortBases, formula).reduce((sum, k) => sum + live.cohortBases[k].n, 0);', /a union of 17 in the reference with 11 in the run stays watched/],
  // The state before this fix: the axis the score splits by profit sign is watched whole.
  'sign-split-ignored': [/^    if \(!\(smallcapFormulas\[formula\] && .*continue;(?=\r?$)/m, '    continue;', /a basis split by profit sign must be watched or named/],
  'whole-axis-kept': [/^    delete watched\[group\]\.axes\[SIGN_SPLIT_AXIS\];(?=\r?$)/m, '', /a basis split by profit sign must be watched or named: never as a whole axis/],
  'sign-live-unsplit': [/^      watchedLive\[name\] = .*;(?=\r?$)/m, '      watchedLive[name] = { axes: { [SIGN_SPLIT_AXIS]: liveBasis.axes[SIGN_SPLIT_AXIS] } };', /a sign sub-basis is built alike on both sides/],
  'sign-by-firms': [/^      if \(values < MIN_COHORT_N\) \{(?=\r?$)/m, '      if (signFirms < MIN_COHORT_N) {', /a sign sub-basis is decided on its usable values, not its firms/],
};

if (process.argv.includes('--break-once')) {
  const hash = () => crypto.createHash('sha256').update(fs.readFileSync(RS)).digest('hex');
  const before = hash();
  for (const [name, [, , expected]] of Object.entries(MUTANTS)) {
    const r = cp.spawnSync(process.execPath, [__filename], { encoding: 'utf8', env: { ...process.env, SC_REF_MUTATION: name } });
    assert.equal(r.status, 1, name + ' must fail, not pass or crash in the runner');
    assert.match(r.stderr, expected);
    assert.equal(hash(), before, 'live run-screener.js hash changed during break-once');
    console.log('BREAK_ONCE ' + name + ' exit=1 detected=true');
  }
  process.exit(0);
}

const compile = Module.prototype._compile;
Module.prototype._compile = function (source, name) {
  const mutant = MUTANTS[process.env.SC_REF_MUTATION];
  if (mutant && name === RS) {
    assert.equal((source.match(new RegExp(mutant[0].source, 'gm')) || []).length, 1, 'mutation anchor must hit exactly one whole line');
    source = source.replace(mutant[0], mutant[1]);
  }
  return compile.call(this, source, name);
};

const { runSmallcapPass, loadSmallcapReference, scoreSmallcapUniverse, smallcapReferenceDrift, SMALLCAP_COVERAGE_FLOOR_PCTL } = require(RS);
const { scoreUniverse, quantile, calibrationDrift } = require('../src/scoring/score.js');
const { q } = require('../src/scoring/engine.js');
const { smallcapRoute } = require('../src/scoring/smallcap-route.js');
const formulas = require('../src/scoring/formulas/smallcap');

const at = '2026-10-29T12:00:00.000Z';
// Numbers differ per firm, so the percentiles depend on who is in the cohort. drop thins out the coverage.
const firm = (i, drop = []) => {
  const g = 1 + 0.02 * i, m = 0.08 + 0.006 * i;
  const annual = { annualRev: [1e9, 1e9 / g, 1e9 / g / g, 1e9 / g / g / g], annualOpInc: [2e8 * g, 1.4e8, 1e8, 6e7 + i * 1e6], annualNetIncome: [1.5e8 * g, 1e8, 7e7, 4e7],
    annualGP: [(0.4 + m) * 1e9, 3.6e8, 2.4e8, 1.6e8], annualFCF: [1.6e8 * g, 1.1e8, 8e7, 5e7], annualOCF: [1.8e8 * g, 1.2e8, 9e7, 6e7], annualSGA: [1e8, 8e7, 6e7, 4e7],
    annualShares: [1e8, 1e8, 1e8, 1e8], annualBalance: [{ currentAssets: 1e9, currentLiabilities: 2e8 + i * 1e6, totalLiabilities: 3e8 }] };
  const snapshot = { meta: { ticker: 'F' + String(i).padStart(2, '0'), name: 'Firm ' + i, country: 'United States', sector: 'Technology', industry: 'Semiconductors', reportingCurrency: 'USD', reportingCurrencyOriginal: 'USD', fxRateApplied: 1, asOf: at, fetchedAt: at, fundamentalsAsOf: at },
    marketCap: { value: 4e8 + i * 1e6, source: 'yahoo_quote', confidence: 0.9, asOf: at }, annual,
    timeseries: { revenueQ: [3e8 * g, 2.6e8, 2.4e8, 2e8, 1.8e8, 1.6e8, 1.5e8, 1.1e8].map(value => ({ value })) }, metrics: {} };
  for (const k of drop) { if (k === 'revenueQ') delete snapshot.timeseries.revenueQ; else delete snapshot.annual[k]; }
  return snapshot;
};
// Coverage steps: the two thinnest firms sit under the floor of the full universe, the next one just above it.
const THIN2 = ['annualOpInc', 'annualFCF', 'annualOCF', 'annualGP', 'annualSGA', 'annualBalance', 'annualShares', 'revenueQ'];
const THIN1 = ['annualOpInc', 'annualFCF', 'annualOCF', 'annualGP', 'annualSGA', 'annualBalance'];
const universe = () => Array.from({ length: 25 }, (_, i) => firm(i, i === 0 || i === 1 ? THIN2 : i === 2 || i === 3 ? THIN1 : []));
const exits = new Set(['F04', 'F05']); // Full coverage, so only the calibration can move through them.
const exitsThin = new Set(['F00', 'F01']); // The two thinnest, so the live floor moves through them.
const below = (u, set) => { for (const s of u) if (set.has(s.meta.ticker)) s.marketCap = { ...s.marketCap, value: 2e8, belowFloor: true, floorUsd: 3e8 }; return u; };

const live = scoreUniverse(universe(), formulas, { classify: smallcapRoute, growthBoost: false });
const scored = r => r.filter(e => e.action === 'route' && e.score !== null);
const floorOf = r => quantile(scored(r).map(e => e.coverageWeight).filter(Number.isFinite), SMALLCAP_COVERAGE_FLOOR_PCTL);
const reference = JSON.parse(JSON.stringify({ version: 'test.1', dataDay: '2026-10-29', renewBy: '2999-01-01', coverageFloor: floorOf(live), calibration: live.calibration }));
assert(floorOf(scoreUniverse(below(universe(), exitsThin), formulas, { classify: smallcapRoute, growthBoost: false })) > reference.coverageFloor, 'test data: leaving firms must move the live floor, else this guard proves nothing');

const log = console.log, warn = console.warn, warnings = [];
const pass = (u, ref = reference) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-reference-'));
  console.log = () => {}; console.warn = (...a) => warnings.push(a.join(' '));
  try { runSmallcapPass(u, 100, dir, ref); } finally { console.log = log; console.warn = warn; }
  const index = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
  const rows = new Map(index.boards.flatMap(b => { const x = JSON.parse(fs.readFileSync(path.join(dir, b + '.json'), 'utf8')); return [...(x.profitable || []), ...(x.unprofitable || [])].map(r => [r.ticker, r]); }));
  return { index, rows };
};
const scores = rows => Object.fromEntries([...rows].map(([t, r]) => [t, r.score]));
const without = (o, set) => Object.fromEntries(Object.entries(o).filter(([t]) => !set.has(t)));

const before = pass(universe());
assert(before.rows.size > 15, 'test data: the board must hold most firms');
assert.equal(before.index.coverageFloor, reference.coverageFloor);
assert.deepEqual(before.index.reference, { version: 'test.1', dataDay: '2026-10-29', renewBy: '2999-01-01', coverageFloor: reference.coverageFloor, renewalDue: false, drift: { maxKs: 0, ksThreshold: 0.15, axesDrifted: 0 }, notMonitored: [] }, 'the export must name the reference in force');
assert.equal(before.index.coverageFloorLive, reference.coverageFloor, 'on its own data the live floor equals the frozen one');

for (const [name, set] of [['full-coverage firms', exits], ['thinnest firms', exitsThin]]) {
  const after = pass(below(universe(), set));
  assert.equal(after.index.coverageFloor, reference.coverageFloor, 'a floor exit must not move the coverage floor: ' + name);
  assert.deepEqual([...before.rows.keys()].filter(t => !after.rows.has(t)).sort(), [...before.rows.keys()].filter(t => set.has(t)).sort(), 'only the measured firms may leave: ' + name);
  assert.deepEqual([...after.rows.keys()].filter(t => !before.rows.has(t)), [], 'nobody enters through a floor exit: ' + name);
  assert.deepEqual(scores(after.rows), without(scores(before.rows), set), "a floor exit must not move another firm's score: " + name);
}
const thin = pass(below(universe(), exitsThin)).index;
assert(thin.coverageFloorLive > thin.coverageFloor, 'the live floor stays visible next to the fixed one');
console.log('PASS floor exits take only the measured firms off the boards: same floor, same scores, nobody enters');

// A firm's own new numbers still count, and only for that firm.
const own = universe(); own[10].annual.annualRev = own[10].annual.annualRev.map((v, i) => (i ? v / 2 : v));
const moved = pass(own);
assert.notEqual(moved.rows.get('F10').score, before.rows.get('F10').score, 'a firm with new numbers must get a new score');
assert.deepEqual(without(scores(moved.rows), new Set(['F10'])), without(scores(before.rows), new Set(['F10'])), 'new numbers of one firm must not move the others');
console.log('PASS new numbers of a firm move that firm alone');

// A new firm is judged like a stored one with the same values: no protection through old membership.
const newcomer = firm(30, THIN2); newcomer.meta.ticker = 'NEW';
const twin = pass([...universe(), newcomer]);
assert.equal(twin.rows.has('NEW'), before.rows.has('F00'), 'same coverage, same verdict, whoever was there first');
console.log('PASS the floor treats a new firm and a stored firm alike');

// Renewal is reported and does nothing else.
warnings.length = 0;
const old = pass(universe(), { ...reference, renewBy: '2000-01-01' });
assert.equal(old.index.reference.renewalDue, true); assert(warnings.some(w => w.startsWith('::warning::') && w.includes('due for renewal')));
assert.deepEqual(scores(old.rows), scores(before.rows), 'the renewal notice must not change a number');
warnings.length = 0;
const shifted = universe();
for (const s of shifted) s.annual.annualRev = s.annual.annualRev.map((v, i) => (i ? v / 3 : v));
const driftRun = pass(shifted);
assert.equal(driftRun.index.reference.renewalDue, true, 'a moved universe must report the renewal');
assert(driftRun.index.reference.drift.maxKs > 0.15 && driftRun.index.reference.drift.axesDrifted > 0);
assert(warnings.some(w => w.includes('due for renewal')));
console.log('PASS the renewal notice fires on age and on drift and changes no number');

// The notice watches the bases the score reads. Two thin tracks of one formula score on their union of 18 firms.
const losing = (i) => { const s = firm(i); s.annual.annualOpInc = [-8e7 - i * 1e6, -6e7, -4e7, -2e7]; return s; };
const tracksOf = (profitable, unprofitable) => [...Array.from({ length: profitable }, (_, i) => firm(i)), ...Array.from({ length: unprofitable }, (_, i) => losing(i + profitable))];
const olderDividedBy100 = (u) => {
  for (const s of u) {
    s.annual.annualRev = s.annual.annualRev.map((v, i) => (i ? v / 100 : v));
    s.timeseries.revenueQ = s.timeseries.revenueQ.map((x, i) => (i >= 4 ? { value: x.value / 100 } : x));
  }
  return u;
};
const referenceOf = (u) => JSON.parse(JSON.stringify({ version: 'test.2', dataDay: '2026-10-29', renewBy: '2999-01-01', coverageFloor: 0.01, calibration: scoreUniverse(u, formulas, { classify: smallcapRoute, growthBoost: false }).calibration }));
const liveOf = (u, ref) => scoreSmallcapUniverse(u, ref).calibrationLive;
const FORMULA = 'smallcap-semiconductors';

const thinRef = referenceOf(tracksOf(10, 8));
assert.deepEqual(Object.values(thinRef.calibration.cohortBases).map((b) => b.n).sort((a, b) => a - b), [8, 10], 'test data: two thin tracks');
const calm = pass(tracksOf(10, 8), thinRef);
assert.equal(calm.index.reference.renewalDue, false); assert.equal(calm.index.reference.drift.maxKs, 0); assert.deepEqual(calm.index.reference.notMonitored, [], 'the pooled basis of a thin cohort must be watched');
assert.deepEqual(Object.keys(smallcapReferenceDrift(liveOf(tracksOf(10, 8), thinRef), thinRef).watched), [FORMULA]);
warnings.length = 0;
const pooledStress = pass(olderDividedBy100(tracksOf(10, 8)), thinRef);
assert.equal(pooledStress.index.reference.renewalDue, true, 'the pooled basis of a thin cohort must be watched');
assert(pooledStress.index.reference.drift.maxKs > 0.15 && pooledStress.index.reference.drift.axesDrifted > 0, 'the pooled basis of a thin cohort must be watched');
assert(warnings.some((w) => w.includes('due for renewal')));
assert.equal(pooledStress.rows.size, 18, 'test data: every firm stands on a board');
const scoredStress = scoreSmallcapUniverse(olderDividedBy100(tracksOf(10, 8)), thinRef);
for (const e of scoredStress) assert.equal(pooledStress.rows.get(e.ticker).score, Math.round(e.score * 10) / 10, 'the notice must not move a score: ' + e.ticker);

// The union rebuilt here is the one parentBasis hands the score: same percentile on every axis of every firm.
const watchedUnion = smallcapReferenceDrift(scoredStress.calibrationLive, thinRef).watched[FORMULA].axes;
let comparedAxes = 0;
for (const key of Object.keys(thinRef.calibration.cohortBases)) {
  scoredStress.filter((e) => e.formulaId + '|' + e.track === key).forEach((e, i) => {
    for (const { key: axis, pct } of pooledStress.rows.get(e.ticker).axisBreakdown) {
      const own = q(scoredStress.calibrationLive.cohortBases[key].axes[axis][i], watchedUnion[axis] ?? []);
      assert.equal(pct, own === null ? null : Math.round(own * 10) / 10, `the watched union must be the basis the score reads: ${e.ticker} ${axis}`);
      if (pct !== null) comparedAxes++;
    }
  });
}
assert(comparedAxes > 50, 'test data: percentiles really compared, ' + comparedAxes);
console.log('PASS a thin cohort is watched on the union its score reads, the notice fires and moves no score');

// Growth distributions enter no score with growthBoost off, so they ring no alarm either.
const growthMoved = structuredClone(thinRef);
for (const key of Object.keys(growthMoved.calibration.gDistByCohort)) growthMoved.calibration.gDistByCohort[key] = growthMoved.calibration.gDistByCohort[key].map((g) => g + 5);
const growthRun = pass(tracksOf(10, 8), growthMoved);
assert.equal(growthRun.index.reference.renewalDue, false, 'growth distributions enter no score here');
assert.deepEqual(scores(growthRun.rows), scores(calm.rows), 'growth distributions enter no score here');
console.log('PASS growth distributions stay out of the notice because they stay out of the score');

// Below 15 firms even together: the group rings no alarm, whatever moves in it, and the export says so.
const tinyRef = referenceOf(tracksOf(5, 3));
const tiny = pass(olderDividedBy100(tracksOf(5, 3)), tinyRef).index.reference;
assert.deepEqual(tiny.notMonitored, [{ group: FORMULA, firms: 8, reasonDe: 'Nur 8 Firmen in der Referenz vom 29.10.2026, zu wenige für eine Abweichungsprüfung.' }], 'a group too small to watch must be named');
assert.equal(tiny.renewalDue, false, 'a group nobody watches rings no alarm');
// A track new since the reference: thin, it scores on the frozen union, which is watched; big, it scores on itself.
const oneTrack = referenceOf(tracksOf(20, 0));
const thinNew = smallcapReferenceDrift(liveOf(tracksOf(20, 3), oneTrack), oneTrack);
assert.deepEqual(Object.keys(thinNew.watched).sort(), [FORMULA, FORMULA + '|profitable']); assert.deepEqual(thinNew.notMonitored, []);
assert.deepEqual(pass(tracksOf(20, 16), oneTrack).index.reference.notMonitored, [{ group: FORMULA + '|unprofitable', firms: 0, reasonDe: 'In der Referenz vom 29.10.2026 nicht enthalten, daher keine Abweichungsprüfung.' }], 'a group too small to watch must be named: new and big');
console.log('PASS a group that cannot be watched is named: too small together, or new and scored on itself');

// The decision itself, on plain numbers. The score decides on the frozen n, so the notice has to, at the exact limit too.
const counted = (o) => Object.fromEntries(Object.entries(o).map(([key, n]) => [key, { n, axes: { a: Array.from({ length: n }, (_, i) => i) } }]));
const decide = (liveN, frozenN) => {
  const d = smallcapReferenceDrift({ cohortBases: counted(liveN) }, { dataDay: '2026-10-31', calibration: { cohortBases: counted(frozenN) } });
  return { watched: Object.keys(d.watched).sort(), named: d.notMonitored.map((g) => g.group + ':' + g.firms) };
};
assert.deepEqual(decide({ 'f|profitable': 15 }, { 'f|profitable': 15 }), { watched: ['f|profitable'], named: [] }, 'exactly 15 firms in one cohort read their own basis');
assert.deepEqual(decide({ 'f|profitable': 10, 'f|unprofitable': 5 }, { 'f|profitable': 10, 'f|unprofitable': 5 }), { watched: ['f'], named: [] }, 'exactly 15 firms together are watched on their union');
assert.deepEqual(decide({ 'f|profitable': 14, 'f|unprofitable': 8 }, { 'f|profitable': 16, 'f|unprofitable': 8 }), { watched: ['f', 'f|profitable'], named: [] }, 'the decision reads the frozen n: a big cohort that shrank keeps its own basis');
assert.deepEqual(decide({ 'f|profitable': 20, 'f|unprofitable': 5 }, { 'f|profitable': 10, 'f|unprofitable': 5 }), { watched: ['f'], named: [] }, 'the decision reads the frozen n: a thin cohort that grew stays on the union');
assert.deepEqual(decide({ 'f|profitable': 8, 'f|unprofitable': 3 }, { 'f|profitable': 11, 'f|unprofitable': 6 }), { watched: ['f'], named: [] }, 'a union of 17 in the reference with 11 in the run stays watched');
console.log('PASS the watch decision follows the frozen n like the score, at exactly 15 firms too');

// A basis the score splits by profit sign: capitalEfficiency of a subCohortByProfit formula, read only against firms of
// the same sign (score.js PASS 2, `signBasis[j] === profitSign[i]`). Each sign is a basis of its own: watched from 15
// usable values, built alike on both sides, else named with firms and usable values apart. The whole axis is read nowhere.
const RE = 'smallcap-real-estate|profitable';
const signed = (signs, capEff) => ({ cohortBases: { [RE]: { n: signs.length, profitSign: signs, axes: { capitalEfficiency: capEff, revGrowthLevel: capEff.map((_, i) => i) } } } });
const signs34 = [...Array(17).fill('profitable'), ...Array(17).fill('unprofitable')];
const capEff34 = signs34.map((s, i) => (s === 'profitable' ? 0.01 * (i + 1) : -0.01 * (i - 16)));
const swapped34 = capEff34.slice();
for (let k = 0; k < 4; k++) [swapped34[k], swapped34[17 + k]] = [swapped34[17 + k], swapped34[k]];
const ref34 = { dataDay: '2026-10-31', calibration: signed(signs34, capEff34) };
const calm34 = smallcapReferenceDrift(signed(signs34, capEff34), ref34);
assert.deepEqual(Object.keys(calm34.watched).sort(), [RE, RE + ' capitalEfficiency sign=profitable', RE + ' capitalEfficiency sign=unprofitable'], 'a basis split by profit sign must be watched or named');
assert(!('capitalEfficiency' in calm34.watched[RE].axes), 'a basis split by profit sign must be watched or named: never as a whole axis');
assert.equal(calm34.maxKs, 0, 'a sign sub-basis is built alike on both sides');
const moved34 = smallcapReferenceDrift(signed(signs34, swapped34), ref34);
assert(moved34.drifted.some((d) => d.cohort === RE + ' capitalEfficiency sign=profitable' && d.ks > 0.15), 'a basis split by profit sign must be watched or named: four swapped pairs');
const thinSign = signs34.map((s, i) => (s === 'unprofitable' && i >= 29 ? NaN : capEff34[i])); // 17 firms, 12 usable values
assert.deepEqual(smallcapReferenceDrift(signed(signs34, thinSign), { dataDay: '2026-10-31', calibration: signed(signs34, thinSign) }).notMonitored,
  [{ group: RE, axis: 'capitalEfficiency', sign: 'unprofitable', firms: 17, values: 12, reasonDe: 'Achse capitalEfficiency, nur verglichen mit Firmen mit Verlust: 17 Firmen, davon 12 mit verwendbarem Wert in der Referenz vom 31.10.2026, zu wenige für eine Abweichungsprüfung.' }],
  'a sign sub-basis is decided on its usable values, not its firms');
console.log('PASS a basis split by profit sign is watched on its own from 15 usable values, else named with firms and values apart');

// The file itself: a broken one stops the pass, the versioned one stays what its before and after measured.
const bad = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sc-reference-bad-')), 'r.json');
for (const broken of [{ ...reference, coverageFloor: '0.58' }, { ...reference, coverageFloor: 0 }, { ...reference, coverageFloor: 1.5 }, { ...reference, version: '' }, { ...reference, calibration: null }, { ...reference, renewBy: undefined }]) {
  fs.writeFileSync(bad, JSON.stringify(broken));
  assert.throws(() => loadSmallcapReference(bad), /reference invalid/);
}
assert.throws(() => loadSmallcapReference(bad + '.absent'), /ENOENT/);
const real = loadSmallcapReference();
// Pinned on purpose: a renewal moves visible scores and changes these lines together with its own before and after.
assert.equal(real.schema, 'smallcap-reference/v1');
assert.equal(real.version, '2026-10-31.1');
assert.equal(real.dataDay, '2026-10-31');
assert.equal(real.coverageFloor, 0.58);
assert.equal(real.calibration.schema, 'calibration/v4');
assert.match(real.storeSha256, /^[0-9a-f]{64}$/);
for (const key of Object.keys(real.calibration.cohortBases)) assert(formulas[key.split('|')[0]], 'reference cohort without a formula: ' + key);
assert.doesNotThrow(() => scoreUniverse(universe(), formulas, { classify: smallcapRoute, growthBoost: false, refCalibration: real.calibration }), 'the versioned reference must fit the current formulas');
// What the notice watches on the versioned reference. Counted: 9 cohorts of at least 15 firms on their own basis, 4 formulas
// with a thin track on their union, 4 formulas of 23 firms together below 15 each, and in real estate (17 firms) the
// three sign sub-bases of capitalEfficiency with 11, 4 and 0 usable values. A renewal changes these lines.
const watchReal = smallcapReferenceDrift(real.calibration, real);
assert.equal(watchReal.maxKs, 0, 'the reference against itself');
assert.deepEqual(Object.keys(watchReal.watched).filter((k) => !k.includes('|')).sort(), ['smallcap-consumer-discretionary', 'smallcap-energy', 'smallcap-financials', 'smallcap-software-comm-services']);
assert.equal(Object.keys(watchReal.watched).filter((k) => k.includes('|')).length, 9);
assert.deepEqual(watchReal.notMonitored.filter((g) => !g.axis).map((g) => [g.group, g.firms]), [['smallcap-it-services', 3], ['smallcap-materials', 12], ['smallcap-semiconductors', 3], ['smallcap-utilities', 5]]);
// Codex's swap probe: four value pairs swapped between the sign groups leave the whole axis exactly as it was (distance 0),
// apart 0.273 and 0.750. Neither sub-basis reaches 15 usable values, so the export has to name both.
const reSwap = structuredClone(real.calibration), reBase = reSwap.cohortBases[RE];
const usable = (sign) => reBase.profitSign.map((s, i) => i).filter((i) => reBase.profitSign[i] === sign && Number.isFinite(reBase.axes.capitalEfficiency[i]));
const [gains, losses] = [usable('profitable'), usable('unprofitable')];
for (let k = 0; k < 4; k++) [reBase.axes.capitalEfficiency[gains[k]], reBase.axes.capitalEfficiency[losses[k]]] = [reBase.axes.capitalEfficiency[losses[k]], reBase.axes.capitalEfficiency[gains[k]]];
const ksOf = (a, b) => calibrationDrift({ cohortBases: { x: { axes: { a } } } }, { cohortBases: { x: { axes: { a: b } } } }, 2).maxKs;
const signPart = (base, sign) => base.axes.capitalEfficiency.filter((_, i) => base.profitSign[i] === sign);
assert.equal(ksOf(reBase.axes.capitalEfficiency, real.calibration.cohortBases[RE].axes.capitalEfficiency), 0, 'test data: the whole axis stays the same');
assert.deepEqual(['profitable', 'unprofitable'].map((s) => Math.round(ksOf(signPart(reBase, s), signPart(real.calibration.cohortBases[RE], s)) * 1000) / 1000), [0.273, 0.75], 'test data: Codex swap probe');
assert.deepEqual(smallcapReferenceDrift(reSwap, real).notMonitored.filter((g) => g.axis).map((g) => [g.group, g.sign, g.firms, g.values]),
  [[RE, 'profitable', 11, 11], [RE, 'unknown', 1, 0], [RE, 'unprofitable', 5, 4]], 'a basis split by profit sign must be watched or named: real estate');
// Energy: 11 and 6 firms, both tracks thin, 17 together. Only that union can see them move.
const energyMoved = structuredClone(real.calibration);
for (const track of ['profitable', 'unprofitable']) {
  const axes = energyMoved.cohortBases['smallcap-energy|' + track].axes;
  axes.revGrowthLevel = axes.revGrowthLevel.map((v) => (Number.isFinite(v) ? v + 1000 : v));
}
assert(smallcapReferenceDrift(energyMoved, real).drifted.some((d) => d.cohort === 'smallcap-energy' && d.axis === 'revGrowthLevel' && d.ks > 0.15), 'the pooled basis of a thin cohort must be watched: energy');
console.log('PASS a broken reference stops the pass; the versioned one is 2026-10-31.1 with floor 0,58 and fits the formulas; its watched and unwatched groups are pinned');

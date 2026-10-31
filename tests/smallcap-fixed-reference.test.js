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

const { runSmallcapPass, loadSmallcapReference, SMALLCAP_COVERAGE_FLOOR_PCTL } = require(RS);
const { scoreUniverse, quantile } = require('../src/scoring/score.js');
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
assert.deepEqual(before.index.reference, { version: 'test.1', dataDay: '2026-10-29', renewBy: '2999-01-01', coverageFloor: reference.coverageFloor, renewalDue: false, drift: { maxKs: 0, ksThreshold: 0.15, axesDrifted: 0 } }, 'the export must name the reference in force');
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
console.log('PASS a broken reference stops the pass; the versioned one is 2026-10-31.1 with floor 0,58 and fits the formulas');

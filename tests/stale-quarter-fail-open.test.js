'use strict';
// Execute real modules with virtual files/fake providers. No live mutations or network.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createRequire } = require('module');
const { fixture, snapshot, NOW, DEFAULT } = require('./stale-quarter-reload.test.js');
const { prepareRanks } = require('../scripts/prepare-stale-quarter-ranks.js');
const { mergeManifests } = require('../scripts/merge-shard-manifests.js');
const root = path.resolve(__dirname, '..');
let passed = 0, failed = 0;
async function check(name, fn) { try { await fn(); passed++; console.log('PASS ' + name); }
  catch (e) { failed++; console.error('FAIL ' + name + ': ' + e.message); } }
function selection(overrides = {}) {
  return { selected: ['OLD'], date: '2026-09-29', maxPerRun: DEFAULT.maxPerRun, shardCount: 1, ...overrides };
}
function job(source, name) {
  const block = source.match(new RegExp('^  ' + name + ':\\r?\\n([\\s\\S]*?)(?=^  [a-z][a-z-]*:|$(?![\\s\\S]))', 'm'));
  assert(block, 'missing workflow job ' + name); return block[1];
}
function jobRuns(block, needs) {
  const condition = block.match(/^    if: (.+)$/m);
  if (!condition) return Object.values(needs).every(n => n.result === 'success');
  const expr = condition[1].replace(/^\$\{\{\s*|\s*\}\}$/g, '');
  return vm.runInNewContext(expr, { needs, always: () => true, cancelled: () => false });
}
function step(block, name) {
  const pos = block.indexOf('- name: ' + name);
  assert(pos >= 0, 'missing step ' + name);
  return block.slice(pos).split(/\r?\n      - /)[0];
}
function script(file, f, extra = {}) {
  const filename = path.join(root, file), req = createRequire(filename), mod = { exports: {} };
  class FixedDate extends Date { constructor(...a) { super(...(a.length ? a : [NOW])); } static now() { return NOW; } }
  const context = { module: mod, exports: mod.exports, __dirname: path.dirname(filename), __filename: filename,
    Date: FixedDate,
    console: { log: s => f.logs.push(s), warn: s => f.logs.push(s), error: s => f.logs.push(s) },
    process: { env: { RUN_DATE_UTC: '2026-09-29' } }, ...extra,
    require: id => id === 'fs' ? f.io : id.endsWith('atomic-write.js') ? { writeFileAtomic: (p, s) => f.io.writeFileSync(p, s) }
      : id === '../pull-yahoo.js' ? f.Y : id.endsWith('stale-quarter-reload.js') ? script('lib/stale-quarter-reload.js', f) : req(id) };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), context, { filename }); return mod.exports;
}
function candidateFixture() {
  const f = fixture();
  f.files.set(path.join(root, 'watchlist.json'), Buffer.from(JSON.stringify({ stocks: [{ ticker: 'OLD', yahoo_symbol: 'OLD' }] })));
  f.files.set(path.join(root, 'snapshots/OLD.json'), Buffer.from(JSON.stringify(snapshot('OLD'))));
  return f;
}
function assertPriceOnly(f, m) {
  assert.equal(m.n_ok, 1); assert.equal(m.n_failed, 0);
  assert.equal(m.n_stale_quarter_selected, 0);
  assert.equal(m.results[0].status, 'price-only'); assert.equal(f.calls[0][1], 'quote');
}
(async () => {
  await check('rank network failure warns and returns empty ranks', async () => {
    const warnings = []; const r = await prepareRanks(async () => { throw new Error('ECONNRESET'); }, s => warnings.push(s));
    assert.deepEqual(r.ranks, {}); assert(warnings.some(s => s.startsWith('::warning::')));
  });
  await check('rank publication across midnight warns but keeps ranks', async () => {
    const warnings = [], get = async f => f === 'index.json' ? { branches: ['energy'], generated_at: '2026-09-29T23:59:59Z' }
      : /index.json$/.test(f) ? null : { generated_at: '2026-09-30T00:00:01Z', rows: [{ ticker: 'OLD', rank: 1 }] };
    assert.equal((await prepareRanks(get, s => warnings.push(s))).ranks.OLD, 1);
    assert(warnings.some(s => s.includes('Mixed board dates')));
  });
  await check('rank step failure leaves prep successful; candidate shard failure does not skip pull', async () => {
    const yaml = fs.readFileSync(path.join(root, '.github/workflows/daily-pull.yml'), 'utf8');
    const rankStep = step(job(yaml, 'prep'), 'Read current board ranks');
    const prep = /continue-on-error: true/.test(rankStep) ? 'success' : 'failure';
    const pull = job(yaml, 'pull');
    for (const planned of ['success', 'failure', 'skipped', 'cancelled']) {
      assert.equal(jobRuns(pull, { prep: { result: prep }, 'quarter-selection': { result: planned } }), true, 'planning=' + planned);
    }
    assert.equal(jobRuns(pull, { prep: { result: 'failure' }, 'quarter-selection': { result: 'success' } }), false);
    assert(/continue-on-error: true/.test(step(pull, 'Download global stale-quarter selection')));
    assert(!pull.includes('STALE_QUARTER_PLAN_REQUIRED'));
    const f = fixture({ env: { STALE_QUARTER_RELOAD: 'planned' } }); assertPriceOnly(f, await f.run());
  });
  await check('candidate shard failure does not skip the daily pull', () => {
    const yaml = fs.readFileSync(path.join(root, '.github/workflows/daily-pull.yml'), 'utf8');
    assert.equal(jobRuns(job(yaml, 'pull'), { prep: { result: 'success' }, 'quarter-selection': { result: 'skipped' } }), true);
  });
  await check('candidate CLI tolerates missing ranks', () => {
    const f = candidateFixture(); f.files.delete(path.join(root, 'outputs/stale-quarter-ranks.json'));
    const plan = script('scripts/plan-stale-quarter-reload.js', f).run(['--candidates', '0/1']);
    assert.equal(plan.candidates.length, 1);
  });
  await check('candidate CLI counts a corrupt snapshot and continues', () => {
    const f = candidateFixture();
    f.files.set(path.join(root, 'snapshots/OLD.json'), Buffer.from('{'));
    const plan = script('scripts/plan-stale-quarter-reload.js', f).run(['--candidates', '0/1']);
    assert.equal(plan.readErrors, 1); assert.equal(plan.candidates.length, 0);
    assert(f.logs.some(s => s.startsWith('::warning::')));
  });
  for (const broken of ['missing', 'json', 'wrong-date', 'config']) await check('plan ' + broken + ' falls back to ordinary pull', async () => {
    const f = fixture({ selection: broken === 'wrong-date' ? selection({ date: '2026-09-28' }) : null,
      env: { STALE_QUARTER_RELOAD: 'planned' } });
    if (broken === 'json') f.files.set(path.join(root, 'outputs/stale-quarter-selection.json'), Buffer.from('{'));
    if (broken === 'config') f.files.set(path.join(root, 'configs/stale-quarter-reload.json'), Buffer.from('{'));
    const m = await f.run(); assertPriceOnly(f, m);
    assert.equal(m._staleQuarterReload.allocation, 'plan-failed'); assert(f.logs.some(s => s.startsWith('::warning::')));
  });
  await check('missing ranks with a valid plan still performs the selected reload', async () => {
    const f = fixture({ selection: selection(), env: {} }); f.files.delete(path.join(root, 'outputs/stale-quarter-ranks.json'));
    assert.equal((await f.run()).n_stale_quarter_pulled, 1);
  });
  await check('corrupt snapshot remains on the existing full-pull healing path', async () => {
    const f = fixture({ selection: selection(), env: {} }); f.files.set(path.join(f.out, 'OLD.json'), Buffer.from('{'));
    const m = await f.run(); assert.equal(m.n_ok, 1); assert.equal(m.n_failed, 0);
    assert.equal(m.n_stale_quarter_selected, 0); assert.equal(m._staleQuarterReload.readErrors, 1);
    assert.equal(f.calls[0][1], 'quoteSummary');
    assert.equal(f.stored('OLD').timeseries.revenueQEnds[0], '2026-03-31');
    assert.equal(f.calls.filter(x => x[1].includes('/')).length, 0, 'ordinary full pull retains its warm-cache behavior');
  });
  await check('frozen run date accepts a pull after midnight', async () => {
    const f = fixture({ selection: selection(), now: Date.parse('2026-09-30T00:05:00Z'),
      env: { RUN_DATE_UTC: '2026-09-29' } });
    assert.equal((await f.run()).n_stale_quarter_pulled, 1);
  });
  for (const failure of ['quarterFails', 'summaryFails', 'ftsFails', 'quarterEmpty']) await check(failure + ': old quarters and clocks survive, price still refreshes', async () => {
    const s = snapshot('OLD');
    for (const field of Object.keys(s.timeseries)) s.timeseries[field] = Array.from({ length: 8 }, () => s.timeseries[field][0]);
    const f = fixture({ snapshots: [s], [failure]: true });
    const cachePath = path.join(root, 'fundamentals-cache/OLD.json'), oldCache = f.files.get(cachePath).toString();
    const old = JSON.stringify(s.timeseries), m = await f.run(), stored = f.stored('OLD');
    assert.equal(JSON.stringify(stored.timeseries), old, 'quarter history overwritten');
    assert.equal(stored.meta.fundamentalsTimeseriesFetchedAt, s.meta.fundamentalsTimeseriesFetchedAt);
    assert.equal(stored.meta.fundamentalsAsOf, s.meta.fundamentalsAsOf);
    assert.equal(stored.meta.asOf, new Date(NOW).toISOString());
    assert.equal(m.n_ok, 1); assert.equal(m.n_failed, 0); assert.equal(m.n_stale_quarter_reload_failed, 1);
    assert.equal(m.results[0].quarterReload.outcome, 'reload-failed');
    assert.equal(f.files.get(cachePath).toString(), oldCache, 'failed reload overwrote the warm cache');
    const slim = JSON.parse(f.files.get(path.join(f.out, '_manifest.json')));
    assert.equal(mergeManifests([slim], 1, 1).n_stale_quarter_reload_failed, 1);
  });
  await check('without plan or explicit opt-in the smallcap/ordinary caller does not reload', async () => {
    const f = fixture({ env: {} }); assertPriceOnly(f, await f.run());
    assert.equal(f.calls.length, 1);
  });
  await check('smallcap workflow explicitly disables reload even if a plan file exists', async () => {
    const yaml = fs.readFileSync(path.join(root, '.github/workflows/smallcap-pull.yml'), 'utf8');
    const mode = step(job(yaml, 'pull'), 'Run Yahoo Pull').match(/STALE_QUARTER_RELOAD: '([^']+)'/);
    assert(mode, 'smallcap must explicitly opt out');
    const f = fixture({ selection: selection(), env: { STALE_QUARTER_RELOAD: mode[1] } });
    const m = await f.run(); assertPriceOnly(f, m); assert.equal(m._staleQuarterReload.allocation, 'disabled');
  });
  await check('snapshot without any reported quarter has a separate counter', async () => {
    const s = snapshot('OLD'); s.timeseries = {};
    const f = fixture({ snapshots: [s] }), m = await f.run();
    assert.equal(m.n_stale_quarter_no_quarter, 1); assert.equal(m.n_stale_quarter_eligible, 0);
    const slim = JSON.parse(f.files.get(path.join(f.out, '_manifest.json')));
    assert.equal(slim.n_stale_quarter_no_quarter, 1);
    assert.equal(mergeManifests([slim], 1, 1).n_stale_quarter_no_quarter, 1);
  });
  console.log(`stale-quarter-fail-open.test.js: ${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
})().catch(e => { console.error(e.message); process.exitCode = 1; });

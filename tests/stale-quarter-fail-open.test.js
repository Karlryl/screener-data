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
const { baueMarker, JOB_REIHENFOLGE } = require('../scripts/pipeline-status.js');
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
function jobRuns(source, name, outcomes = {}, cancelled = false) {
  const cache = new Map();
  const parents = n => (job(source, n).match(/^    needs: (.+)$/m)?.[1] || '')
    .replace(/[\[\]]/g, '').split(',').map(s => s.trim()).filter(Boolean);
  const ancestors = n => [...new Set(parents(n).flatMap(p => [p, ...ancestors(p)]))];
  const result = n => {
    if (outcomes[n]) return outcomes[n].result;
    if (cache.has(n)) return cache.get(n);
    const needs = Object.fromEntries(parents(n).map(p => [p, { result: result(p) }]));
    const success = () => !cancelled && ancestors(n).every(p => result(p) === 'success');
    const condition = job(source, n).match(/^    if: (.+)$/m)?.[1] || 'success()';
    const expr = condition.replace(/^\$\{\{\s*|\s*\}\}$/g, '');
    // GitHub applies implicit success() transitively unless a status function overrides it.
    const runs = (/\b(always|cancelled|failure|success)\s*\(/.test(expr) || success())
      && vm.runInNewContext(expr, { needs, success, always: () => true, cancelled: () => cancelled,
        failure: () => ancestors(n).some(p => result(p) === 'failure') });
    cache.set(n, runs ? 'success' : 'skipped'); return cache.get(n);
  };
  return result(name) === 'success';
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
      assert.equal(jobRuns(yaml, 'pull', { prep: { result: prep }, 'quarter-selection': { result: planned } }), true, 'planning=' + planned);
    }
    assert.equal(jobRuns(yaml, 'pull', { prep: { result: 'failure' }, 'quarter-selection': { result: 'success' } }), false);
    assert(/continue-on-error: true/.test(step(pull, 'Download global stale-quarter selection')));
    assert(!pull.includes('STALE_QUARTER_PLAN_REQUIRED'));
    const f = fixture({ env: { STALE_QUARTER_RELOAD: 'planned' } }); assertPriceOnly(f, await f.run());
  });
  await check('candidate shard failure does not skip the daily pull', () => {
    const yaml = fs.readFileSync(path.join(root, '.github/workflows/daily-pull.yml'), 'utf8');
    assert.equal(jobRuns(yaml, 'pull', { prep: { result: 'success' }, 'quarter-selection': { result: 'skipped' } }), true);
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
  for (const failure of ['quarterFails', 'summaryFails', 'ftsFails', 'quarterEmpty']) await check(failure + ': fundamentals and cache survive, price still refreshes', async () => {
    const s = snapshot('OLD');
    for (const field of Object.keys(s.timeseries)) s.timeseries[field] = Array.from({ length: 8 }, () => s.timeseries[field][0]);
    const f = fixture({ snapshots: [s], [failure]: true, quotePrice: 123, quoteMarketCap: 2e12 });
    const cachePath = path.join(root, 'fundamentals-cache/OLD.json'), oldCache = f.files.get(cachePath).toString();
    const old = JSON.stringify(s.timeseries), m = await f.run(), stored = f.stored('OLD');
    assert.equal(JSON.stringify(stored.timeseries), old, 'quarter history overwritten');
    assert.equal(stored.meta.fundamentalsTimeseriesFetchedAt, s.meta.fundamentalsTimeseriesFetchedAt);
    assert.equal(stored.meta.fundamentalsAsOf, s.meta.fundamentalsAsOf);
    assert.equal(stored.meta.asOf, new Date(NOW).toISOString());
    assert.equal(stored.price.regularMarketPrice, 123); assert.equal(stored.marketCap.value, 2e12);
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
  for (const failed of ['quarter-candidates', 'quarter-selection']) {
    for (const target of ['pull', 'prices', 'merge', 'scoring', 'druckenmiller-guard']) {
      await check(failed + ' failure still runs ' + target + ' through all ancestors', () => {
        const yaml = fs.readFileSync(path.join(root, '.github/workflows/daily-pull.yml'), 'utf8');
        assert.equal(jobRuns(yaml, target, { [failed]: { result: 'failure' } }), true);
      });
    }
  }
  await check('cancellation stops pull, scoring and druckenmiller guard', () => {
    const yaml = fs.readFileSync(path.join(root, '.github/workflows/daily-pull.yml'), 'utf8');
    for (const target of ['pull', 'scoring', 'druckenmiller-guard']) {
      const finished = Object.fromEntries(['prep', 'pull', 'prices', 'merge', 'scoring'].filter(n => n !== target).map(n => [n, { result: 'success' }]));
      assert.equal(jobRuns(yaml, target, finished, true), false, target);
    }
  });
  await check('real data failures still block scoring and its guard', () => {
    const yaml = fs.readFileSync(path.join(root, '.github/workflows/daily-pull.yml'), 'utf8');
    for (const failed of ['prep', 'pull', 'prices', 'merge', 'scoring']) {
      for (const outcome of ['failure', 'skipped', 'cancelled']) {
        const outcomes = { [failed]: { result: outcome } };
        assert.equal(jobRuns(yaml, 'scoring', outcomes), false, failed + '/' + outcome);
        assert.equal(jobRuns(yaml, 'druckenmiller-guard', outcomes), false, failed + '/' + outcome);
      }
    }
  });
  await check('rank step keeps its two-minute limit within the sixty-minute prep budget', () => {
    const yaml = fs.readFileSync(path.join(root, '.github/workflows/daily-pull.yml'), 'utf8');
    assert.match(step(job(yaml, 'prep'), 'Read current board ranks'), /timeout-minutes: 2\b/);
    assert.match(job(yaml, 'prep'), /^    timeout-minutes: 60$/m);
  });
  for (const broken of ['missing', 'corrupt']) await check(broken + ' calendar only removes ordering hints', () => {
    const f = candidateFixture(), file = path.join(root, 'earnings-calendar.json');
    if (broken === 'missing') f.files.delete(file); else f.files.set(file, Buffer.from('{'));
    assert.equal(script('scripts/plan-stale-quarter-reload.js', f).run(['--candidates', '0/1']).candidates.length, 1);
    assert(f.logs.some(s => s.startsWith('::warning::') && s.includes('calendar')));
  });
  await check('disabled reload never reads ranks or warns about their absence', async () => {
    const f = fixture({ env: { STALE_QUARTER_RELOAD: '0' } });
    f.files.delete(path.join(root, 'outputs/stale-quarter-ranks.json'));
    const m = await f.run(); assertPriceOnly(f, m);
    assert(!f.logs.some(s => s.includes('ordering unavailable')));
    assert(!f.reads.includes(path.join(root, 'outputs/stale-quarter-ranks.json')));
  });
  await check('planning-only failures preserve successful run status and current success date', () => {
    for (const result of ['failure', 'skipped', 'cancelled']) {
      const mk = baueMarker({ runId: '123', runAttempt: 1, headSha: 'a'.repeat(40),
        startedAt: '2026-09-29T02:17:00Z', completedAt: '2026-09-29T03:17:00Z',
        jobErgebnisse: JOB_REIHENFOLGE.map(name => ({ name, result: name.startsWith('quarter-') ? result : 'success' })) });
      assert.equal(mk.status, 'success'); assert.equal(mk.failed_job, null);
      assert.equal(mk.last_success_at, mk.completed_at);
      assert(mk.reason.includes('quarter-candidates=' + result));
    }
  });
  for (const reason of ['refresh', 'schema', 'currency', 'earnings', 'manual', 'old-snapshot']) {
    await check('reload never downgrades the existing ' + reason + ' full-pull path', async () => {
      for (const failure of ['quarterFails', 'quarterEmpty', 'summaryFails', 'ftsFails']) {
        const s = snapshot('OLD'); s.meta.sector = 'WRONG';
        if (reason === 'refresh') s.meta.fundamentalsAsOf = '2026-07-01T00:00:00Z';
        if (reason === 'schema') s.annual.annualBalance = [{}];
        if (reason === 'currency') s.meta.reportingCurrency = 'EUR';
        if (reason === 'old-snapshot') s.meta.asOf = '2026-09-10T00:00:00Z';
        const opts = { snapshots: [s], [failure]: true, manual: reason === 'manual' ? ['OLD'] : [],
          calendar: reason === 'earnings' ? { OLD: { date: '2026-09-26' } } : {} };
        const baseline = fixture({ ...opts, env: { STALE_QUARTER_RELOAD: '0' } }), selected = fixture(opts);
        for (const f of [baseline, selected]) f.files.delete(path.join(root, 'fundamentals-cache/OLD.json'));
        const a = await baseline.run(), b = await selected.run();
        assert.equal(b.n_stale_quarter_selected, 1);
        assert.equal(b.n_stale_quarter_reload_failed, 0, failure + ' downgraded an existing full pull');
        assert.equal(b.n_ok, a.n_ok); assert.equal(b.n_failed, a.n_failed);
        assert.deepEqual(b.failures, a.failures);
        const stored = selected.stored('OLD'), ordinary = baseline.stored('OLD');
        // The external grader owns a wall clock outside the pull VM. Compare every data field;
        // normalize only its millisecond execution timestamp after checking both are valid.
        for (const value of [stored, ordinary]) if (value._quality) {
          assert(Number.isFinite(Date.parse(value._quality.computedAt)));
          value._quality.computedAt = new Date(NOW).toISOString();
        }
        assert.deepEqual(stored, ordinary, failure + ' changed full-pull output');
        assert(a.results.every(r => r.status !== 'price-only'), 'baseline must exercise a full pull');
      }
    });
  }
  await check('not-found retains the delisting streak and bypasses price fallback', async () => {
    const f = fixture({ summaryFails: true, summaryError: 'Quote not found', quoteMissing: true });
    for (let i = 1; i <= 2; i++) {
      const m = await f.run(); assert.equal(m.failures[0].errClass, 'not-found');
      assert.equal(f.stored('OLD').meta.notFoundStreak, i);
      assert.equal(m.n_stale_quarter_reload_failed, 0);
    }
    assert.equal(f.stored('OLD').meta.delisted, true);
    assert(!f.calls.some(c => c[1] === 'quote'));
  });
  for (const annualFails of ['financials', 'cash-flow', 'balance-sheet']) await check('annual ' + annualFails + ' failure preserves all stored history', async () => {
    const s = snapshot('OLD'); s.annual.annualRev = [300, 350, 400].map(value => ({ value }));
    s.annual.annualOpInc = [30, 40, 50].map(value => ({ value }));
    const f = fixture({ snapshots: [s], annualFails }), m = await f.run();
    assert.equal(m.results[0].status, 'reload-retained'); assert.equal(m.n_stale_quarter_reload_failed, 1);
    assert.equal(m.n_stale_quarter_fetch_failed, 1); assert.equal(m.n_stale_quarter_newer, 0);
    assert.deepEqual(f.stored('OLD').annual, s.annual); assert.deepEqual(f.stored('OLD').timeseries, s.timeseries);
    assert.equal(f.stored('OLD').meta.fundamentalsTimeseriesFetchedAt, s.meta.fundamentalsTimeseriesFetchedAt);
  });
  for (const answer of ['older', 'thinner']) await check(answer + ' quarterly reply preserves distinct stored quarters and refreshes price', async () => {
    const s = snapshot('OLD');
    const ends = ['2026-03-31', '2025-12-31', '2025-09-30', '2025-06-30', '2025-03-31'];
    for (const field of ['revenueQ', 'opIncQ', 'grossProfitQ', 'netIncomeQ']) {
      s.timeseries[field] = ends.map((_, i) => ({ value: 100 - i }));
      if (field !== 'netIncomeQ') s.timeseries[field + 'Ends'] = ends.slice();
    }
    const quarterlyRows = [{ date: answer === 'older' ? '2025-09-30' : '2026-06-30', totalRevenue: 100, grossProfit: 40, operatingIncome: 20, netIncome: 10 }];
    const f = fixture({ snapshots: [s], quarterlyRows, quotePrice: 123, quoteMarketCap: 2e12 });
    const cachePath = path.join(root, 'fundamentals-cache/OLD.json'), cache = f.files.get(cachePath).toString();
    const m = await f.run(), out = f.stored('OLD');
    assert.equal(m.results[0].status, 'reload-retained');
    assert.equal(m.n_stale_quarter_reload_failed, 1);
    assert.equal(JSON.stringify(out.timeseries), JSON.stringify(s.timeseries));
    assert.equal(JSON.stringify(out.annual), JSON.stringify(s.annual));
    for (const key of ['fetchedAt', 'fundamentalsAsOf', 'fundamentalsTimeseriesFetchedAt']) assert.equal(out.meta[key], s.meta[key]);
    assert.equal(out.price.regularMarketPrice, 123); assert.equal(out.marketCap.value, 2e12);
    assert.equal(out.meta.asOf, new Date(NOW).toISOString());
    assert.equal(f.files.get(cachePath).toString(), cache);
  });
  for (const field of ['annualRev', 'annualOpInc', 'annualNetIncome', 'annualFCF']) {
    for (const annualEmpty of [true, false]) await check(field + ' missing values in shared annual periods (allEmpty=' + annualEmpty + ') preserves history', async () => {
      const s = snapshot('OLD'); s.annual[field] = [{ value: 10 }, { value: null }, { value: 20 }];
      const dates = ['2025-12-31', '2024-12-31', '2023-12-31']; s.annual[field + 'Ends'] = dates;
      const raw = { annualRev: 'totalRevenue', annualOpInc: 'operatingIncome', annualNetIncome: 'netIncome', annualFCF: 'freeCashFlow' }[field];
      const series = dates.map((date, i) => ({ date, totalRevenue: 100, operatingIncome: 20, netIncome: 10, freeCashFlow: 5, operatingCashFlow: 60,
        [raw]: annualEmpty || i === 0 ? null : 20 })).reverse();
      const annualResponses = { financials: series, 'cash-flow': series, 'balance-sheet': series };
      const f = fixture({ snapshots: [s], annualResponses }), m = await f.run();
      assert.equal(m.results[0].status, 'reload-retained'); assert.equal(m.n_stale_quarter_reload_failed, 1);
      assert.equal(m.n_stale_quarter_fetch_failed, 1); assert.equal(m.n_stale_quarter_newer, 0);
      assert.deepEqual(f.stored('OLD').annual, s.annual); assert.deepEqual(f.stored('OLD').timeseries, s.timeseries);
      assert.equal(f.stored('OLD').meta.fundamentalsTimeseriesFetchedAt, s.meta.fundamentalsTimeseriesFetchedAt);
      assert.equal(f.stored('OLD').meta.asOf, new Date(NOW).toISOString());
      const reason = field === 'annualRev' ? 'reported annual or quarterly period regressed' : 'shared-period fundamentals missing';
      assert(f.logs.some(s => s.includes(reason)));
    });
  }
  for (const emptySummary of [false, true]) await check('pure reload recovers fresh quote cap when summary is ' + (emptySummary ? 'empty' : 'missing cap'), async () => {
    for (const summaryMarketCap of [null, NaN, Infinity, -Infinity]) {
      const s = snapshot('OLD'); s.marketCap.missing = true;
      const f = fixture({ snapshots: [s], summaryMarketCap, emptySummary, quoteMarketCap: 2e12 });
      const m = await f.run(), stored = f.stored('OLD');
      assert.equal(m.n_stale_quarter_selected, 1); assert.equal(m.n_stale_quarter_reload_failed, 1);
      assert.equal(m.results[0].status, 'reload-retained'); assert.equal(m.n_missing_mcap, 0);
      assert.equal(m.n_ok, 1); assert.equal(m.n_failed, 0);
      assert.equal(stored.marketCap.value, 2e12); assert.equal(Boolean(stored.marketCap.missing), false);
      assert.equal(stored.meta.asOf, new Date(NOW).toISOString());
      assert.equal(stored.meta.fundamentalsAsOf, s.meta.fundamentalsAsOf);
      assert.deepEqual(stored.annual, s.annual); assert.deepEqual(stored.timeseries, s.timeseries);
      assert.deepEqual(f.calls, [['OLD', 'quoteSummary'], ['OLD', 'quote']]);
    }
  });
  await check('selected reload with no finite cap from summary or quote preserves #390 null observation', async () => {
    for (const summaryMarketCap of [null, NaN, Infinity, -Infinity]) {
      const s = snapshot('OLD'), f = fixture({ snapshots: [s], summaryMarketCap, quoteMarketCap: summaryMarketCap, quarterFails: true });
      const cachePath = path.join(root, 'fundamentals-cache/OLD.json'), cache = f.files.get(cachePath).toString();
      const m = await f.run(), stored = f.stored('OLD');
      assert.equal(m.n_stale_quarter_selected, 1); assert.equal(m.n_stale_quarter_reload_failed, 0);
      assert.equal(m.results[0].status, 'missing-market-cap'); assert.equal(m.n_missing_mcap, 1);
      assert.equal(m.n_ok, 0); assert.equal(m.n_failed, 0); assert.equal(m.n_skipped_mcap, 0);
      assert.equal(stored.marketCap.value, null); assert.equal(stored.marketCap.missing, true);
      assert.deepEqual(stored.meta, s.meta); assert.deepEqual(stored.annual, s.annual); assert.deepEqual(stored.timeseries, s.timeseries);
      assert.equal(f.files.get(cachePath).toString(), cache);
      assert.deepEqual(f.calls, [['OLD', 'quoteSummary'], ['OLD', 'quote']], 'failed price fallback must retain the null path without FTS');
      const slim = JSON.parse(f.files.get(path.join(f.out, '_manifest.json')));
      const merged = mergeManifests([slim], 1, 1);
      assert.equal(merged.n_missing_mcap, 1); assert.equal(merged.n_stale_quarter_selected, 1);
    }
  });
  await check('selected reload with empty summary and no quote cap records null and failure', async () => {
    const s = snapshot('OLD'); s.meta.notFoundStreak = 1;
    const f = fixture({ snapshots: [s], emptySummary: true, quoteMarketCap: null }), m = await f.run();
    assert.equal(m.n_stale_quarter_selected, 1); assert.equal(m.n_stale_quarter_reload_failed, 0);
    assert.equal(m.n_ok, 0); assert.equal(m.n_failed, 1);
    assert.equal(f.stored('OLD').marketCap.value, null); assert.equal(f.stored('OLD').marketCap.missing, true);
    assert.deepEqual(f.stored('OLD').meta, s.meta); assert.deepEqual(f.stored('OLD').timeseries, s.timeseries);
    assert.deepEqual(f.calls, [['OLD', 'quoteSummary'], ['OLD', 'quote']]);
  });
  console.log(`stale-quarter-fail-open.test.js: ${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
})().catch(e => { console.error(e.message); process.exitCode = 1; });

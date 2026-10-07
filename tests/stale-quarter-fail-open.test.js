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
const crypto = require('crypto');
const regression = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'full-pull-period-regression.json'), 'utf8'));
const pullSource = fs.readFileSync(path.join(root, 'pull-yahoo.js'), 'utf8');
const copy = x => JSON.parse(JSON.stringify(x));
const digest = x => crypto.createHash('sha256').update(x).digest('hex');
const regressionNow = Date.parse(regression.conventions.now);
const retainedReason = 'Die neue Yahoo-Antwort enthält ein älteres Berichtsquartal oder Geschäftsjahr als gespeichert. Die bisherigen Fundamentaldaten bleiben erhalten, nur Kurs und Börsenwert wurden aktualisiert.';
const frozenHashes = ['pull-yahoo.js', 'tests/fixtures/full-pull-period-regression.json'].map(p => digest(fs.readFileSync(path.join(root, p))));
const frozenInputHash = digest(JSON.stringify(regression));

// Synthetic provider envelopes from dated canonical values, not archived Yahoo payloads.
// The frozen monetary values are already USD; normalize only the test copies' currency metadata.
function regressionInputs(ticker) {
  const c = copy(regression.cases[ticker]), old = c.old, next = c.candidate;
  Object.assign(old.meta, { reportingCurrency: 'USD', reportingCurrencyOriginal: 'USD', tradingCurrency: 'USD', fxRateApplied: 1, fxConverted: true });
  if (old.price) old.price.currency = 'USD';
  for (const series of Object.values(old.meta.statementPeriods || {})) for (const p of series) if (p) p.currency = 'USD';
  const value = v => v !== null && typeof v === 'object' ? v.value : v;
  function rows(group, fields, initialEnds = []) {
    const byDate = new Map(initialEnds.map(date => [date, { date }]));
    for (const [field, raw, fallback] of fields) {
      const ends = next[group][field + 'Ends'] || (fallback && next[group][fallback])
        || (next.meta.statementPeriods?.[field] || []).map(p => p?.end);
      (next[group][field] || []).forEach((v, i) => {
        const date = ends[i]; if (!date) return;
        if (!byDate.has(date)) byDate.set(date, { date });
        byDate.get(date)[raw] = value(v);
      });
    }
    return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  }
  const incomeFields = [['annualRev', 'totalRevenue'], ['annualGP', 'grossProfit'], ['annualOpInc', 'operatingIncome'],
    ['annualNetIncome', 'netIncome'], ['annualCostOfRevenue', 'costOfRevenue', 'annualRevEnds']];
  const income = rows('annual', incomeFields);
  const financials = rows('annual', [...incomeFields, ['annualSGA', 'sellingGeneralAndAdministration'],
    ['annualRnD', 'researchAndDevelopment'], ['annualShares', 'dilutedAverageShares']], c.supplierConfirmation.annualIncomeRowEnds)
    .filter(r => c.supplierConfirmation.annualIncomeRowEnds.includes(r.date));
  const quarters = rows('timeseries', [['revenueQ', 'totalRevenue'], ['grossProfitQ', 'grossProfit'],
    ['opIncQ', 'operatingIncome'], ['netIncomeQ', 'netIncome']], c.supplierConfirmation.quarterlyIncomeRowEnds);
  const cash = rows('annual', [['annualFCF', 'freeCashFlow'], ['annualOCF', 'operatingCashFlow']]);
  // Debt components cannot be recovered from totalDebt; omit rather than infer a zero.
  const balance = (next.annual.annualBalance || []).flatMap((b, i) => {
    const date = next.annual.annualBalanceEnds?.[i]; if (!date) return [];
    const row = { date };
    for (const [k, raw] of Object.entries({ totalCash: 'cashAndCashEquivalents', totalEquity: 'stockholdersEquity',
      totalLiabilities: 'totalLiabilitiesNetMinorityInterest', currentAssets: 'currentAssets', totalAssets: 'totalAssets',
      currentLiabilities: 'currentLiabilities', accountsReceivable: 'accountsReceivable', netPPE: 'netPPE' })) {
      if (b && Object.hasOwn(b, k)) row[raw] = value(b[k]);
    }
    return [row];
  }).reverse();
  for (const [series, periodType] of [[financials, '12M'], [cash, '12M'], [balance, 'instant'], [quarters, '3M']]) {
    for (const row of series) Object.assign(row, { periodType, currencyCode: 'USD', unit: 'currency', statementBasis: 'yahoo-statement' });
  }
  const summaryRows = series => series.slice().reverse().map(({ date, ...r }) => ({ ...r, endDate: date }));
  const summary = {
    price: { currency: 'USD', regularMarketPrice: regression.conventions.synthetic.quotePrice.value, marketCap: next.marketCap.value },
    summaryDetail: { marketCap: next.marketCap.value }, financialData: { financialCurrency: 'USD' },
    defaultKeyStatistics: { mostRecentQuarter: c.supplierConfirmation.summaryMostRecentQuarter },
    quoteType: { quoteType: regression.conventions.synthetic.quoteType.value },
    incomeStatementHistory: { incomeStatementHistory: summaryRows(income) },
    incomeStatementHistoryQuarterly: { incomeStatementHistory: summaryRows(quarters) },
    cashflowStatementHistory: { cashflowStatements: [] }, balanceSheetHistory: { balanceSheetStatements: [] },
  };
  if (Number.isFinite(next.metrics.revenueTTM?.value)) summary.financialData.totalRevenue = next.metrics.revenueTTM.value;
  return { old, provider: { summary, financials, 'cash-flow': cash, 'balance-sheet': balance, quarters }, quoteMarketCap: c.harness.quoteMarketCap };
}
function regressionFixture(ticker, { source = pullSource, change = () => {}, env = {}, copies = 1 } = {}) {
  const input = regressionInputs(ticker); change(input);
  const f = fixture({ snapshots: Array.from({ length: copies }, () => copy(input.old)), providersByTicker: { [ticker]: input.provider },
    quoteMarketCap: input.quoteMarketCap, quotePrice: regression.conventions.synthetic.quotePrice.value,
    now: regressionNow, env: { ...regression.conventions.env, ...env }, pullSource: source });
  const cp = path.join(root, 'fundamentals-cache', ticker + '.json'), sp = path.join(f.out, ticker + '.json');
  const cache = JSON.parse(f.files.get(cp)); cache.cachedAt = regression.conventions.virtualCacheCachedAt;
  f.files.set(cp, Buffer.from(JSON.stringify(cache)));
  const before = { snapshot: Buffer.from(f.files.get(sp)), cache: Buffer.from(f.files.get(cp)) };
  const writes = [], deletes = [], set = f.files.set.bind(f.files), del = f.files.delete.bind(f.files);
  f.files.set = (p, b) => { writes.push({ path: p, bytes: Buffer.from(b) }); return set(p, b); };
  f.files.delete = p => { deletes.push(p); return del(p); };
  return Object.assign(f, { input, cp, sp, before, writes, deletes });
}
function periodEnds(s) {
  const annualEnd = (s.annual?.annualRevEnds || []).filter((end, i) => end &&
    Number.isFinite(s.annual.annualRev[i]?.value ?? s.annual.annualRev[i]) && Date.parse(end) <= regressionNow).sort().pop() || null;
  return { quarterEnd: require('../lib/stale-quarter-reload.js').latestReportedQuarter(s, regressionNow), annualEnd };
}
function assertRetained(f, m, ticker) {
  const out = f.stored(ticker), old = f.input.old;
  assert.deepEqual(periodEnds(out), periodEnds(old));
  for (const key of ['annual', 'timeseries', 'metrics']) assert.deepEqual(out[key], old[key], ticker + '/' + key);
  for (const key of ['fetchedAt', 'fundamentalsAsOf', 'fundamentalsTimeseriesFetchedAt', 'reportingCurrency', 'statementPeriods']) {
    assert.deepEqual(out.meta[key], old.meta[key], ticker + '/' + key);
  }
  assert.equal(out.price.regularMarketPrice, regression.conventions.synthetic.quotePrice.value);
  assert.equal(out.marketCap.value, regression.cases[ticker].candidate.marketCap.value);
  assert.equal(out.marketCap.source, 'yahoo_quoteSummary');
  assert.equal(out.meta.asOf, new Date(regressionNow).toISOString());
  assert.equal(out.meta.fundamentalsRetainedReason, retainedReason);
  assert(f.files.get(f.cp).equals(f.before.cache));
  assert.equal(m.results[0].status, 'price-only'); assert.equal(m.results[0].fundamentalsRetainedReason, retainedReason);
  assert.equal(m.n_ok, 1); assert.equal(m.n_failed, 0); assert.equal(m.n_full_period_regression_blocked, 1);
  assert.deepEqual(m._fullPeriodRegressions, [{ ticker, outcome: 'blocked', previousQuarterEnd: periodEnds(old).quarterEnd,
    nextQuarterEnd: periodEnds(regression.cases[ticker].candidate).quarterEnd, previousAnnualEnd: periodEnds(old).annualEnd,
    nextAnnualEnd: periodEnds(regression.cases[ticker].candidate).annualEnd, priceUpdated: true, reason: 'period-regression-retained', reasonDe: retainedReason }]);
  for (const k of ['selected', 'pulled', 'newer', 'fetch_failed', 'reload_failed']) assert.equal(m['n_stale_quarter_' + k], 0);
  assert.equal(f.calls.filter(c => c[1].includes('/')).length, 4, 'all four FTS providers must be exercised');
  assert.equal(f.calls.filter(c => c[1] === 'quote').length, ticker === 'EA' ? 2 : 1, 'only ordinary attempt and unrelated IPO quote');
  assert.equal(f.logs.filter(l => l.startsWith('::warning::' + ticker + ' full-pull period regression blocked (')).length, 1);
}
function replaceOnce(source, anchor, replacement) {
  assert.equal(source.split(anchor).length - 1, 1, 'mutation must hit exactly one complete source line: ' + anchor);
  return source.replace(anchor, replacement);
}
function withoutOrdinaryGuard() {
  return replaceOnce(pullSource, '      if (!reloadOnly && !staleSchema && !staleCurrency && _parsedSnapshot) { // P137: ordinary full-pull period guard',
    '      if (false) { // P137: ordinary full-pull period guard disabled in memory');
}
function changedLeaves(a, b, prefix = '') {
  if ((a && typeof a === 'object') || (b && typeof b === 'object')) {
    const keys = [...new Set([...Object.keys(a || {}), ...Object.keys(b || {})])];
    if (!keys.length) return JSON.stringify(a) === JSON.stringify(b) ? [] : [prefix];
    return keys.flatMap(k => changedLeaves(a?.[k], b?.[k], prefix ? prefix + '.' + k : k));
  }
  return Object.is(a, b) ? [] : [prefix];
}
// Named whitelist for quote/FX provenance, price-only markers, quality metadata and the reason.
const retainedLeafWhitelist = /^(?:price(?:\.|$)|marketCap(?:\.|$)|_pullMode(?:At)?$|_quality(?:\.|$)|meta\.(?:asOf|priceCurrency|fxRateSourceTrading|tradingCurrencyOriginal|tradingFxRateApplied|tradingCurrencyAssumed|fundamentalsRetainedReason)$)/;
function financialChanges(a, b) { return changedLeaves(a, b).filter(p => !retainedLeafWhitelist.test(p)); }
function assertNoRefresh(f, m) {
  assert(f.files.get(f.sp).equals(f.before.snapshot)); assert(f.files.get(f.cp).equals(f.before.cache));
  assert.equal(f.writes.filter(w => w.path === f.sp || w.path === f.cp).length, 0);
  assert.equal(f.deletes.length, 0);
  assert.equal(m.n_full_period_regression_blocked, 1); assert.equal(m._fullPeriodRegressions[0].priceUpdated, false);
  assert.equal(m.n_failed, 1); assert.equal(m.n_ok, 0); assert.equal(m.failures[0].ticker, 'EA');
  assert.equal(f.calls.filter(c => c[1] === 'quote').length, 2, 'no guard quote retry');
}
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
    // Tag 1391: the counter stays. An annual-only row whose revenue year is undated (this
    // fixture) is now a candidate on its annual basis (tests/annual-newer-year.test.js).
    assert.equal(m.n_stale_quarter_no_quarter, 1); assert.equal(m.n_stale_quarter_eligible, 1);
    const slim = JSON.parse(f.files.get(path.join(f.out, '_manifest.json')));
    assert.equal(slim.n_stale_quarter_no_quarter, 1);
    assert.equal(mergeManifests([slim], 1, 1).n_stale_quarter_no_quarter, 1);
    // Without any annual revenue there is nothing to refresh: counted, never eligible.
    const bare = snapshot('OLD'); bare.timeseries = {}; bare.annual.annualRev = [];
    const g = await fixture({ snapshots: [bare] }).run();
    assert.equal(g.n_stale_quarter_no_quarter, 1); assert.equal(g.n_stale_quarter_eligible, 0);
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
        // P137: ordinary full pull now protects against a lost reporting period
        if (reason === 'schema' || reason === 'currency') {
          assert(a.results.every(r => r.status !== 'price-only'), 'baseline must exercise a full pull');
        } else {
          assert(a.results.every(r => r.status !== 'reload-retained'), 'ordinary baseline must never be a reload retention');
          for (const r of a.results) if (r.status === 'price-only') {
            assert.equal(a.n_full_period_regression_blocked, 1);
            assert(a._fullPeriodRegressions.some(event => event.ticker === r.ticker));
          }
        }
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
  await check('P137 quarter regression retains the stored bundle for EA, FMS and CACC', async () => {
    for (const ticker of ['EA', 'FMS', 'CACC']) {
      const f = regressionFixture(ticker); assertRetained(f, await f.run(), ticker);
    }
  });
  await check('P137 annual regression retains KCN.AX annual history and cache', async () => {
    const f = regressionFixture('KCN.AX'); assertRetained(f, await f.run(), 'KCN.AX');
  });
  await check('P137 exact quarter checks run only for a raw quarterly regression', async () => {
    const source = replaceOnce(pullSource, "  const reload = require('./lib/stale-quarter-reload.js');",
      "  const reloadBase = require('./lib/stale-quarter-reload.js');\n" +
      "  const reload = { ...reloadBase, latestReportedQuarter(...args) { console.log('P137-exact-quarter-call'); return reloadBase.latestReportedQuarter(...args); } };");
    for (const ticker of Object.keys(regression.cases)) {
      const f = regressionFixture(ticker, { source }), m = await f.run();
      const calls = f.logs.filter(line => line === 'P137-exact-quarter-call').length;
      assert.equal(calls, ['EA', 'FMS', 'CACC'].includes(ticker) ? 2 : 0, ticker);
      assert.equal(m.n_failed, 0);
    }
  });
  for (const repair of ['schema', 'currency']) await check('P137 ' + repair + ' repair rewrites even when the fresh answer loses its newest quarter', async () => {
    const f = regressionFixture('EA', { change: ({ old }) => {
      old.meta.asOf = new Date(regressionNow - 86400000).toISOString();
      if (repair === 'schema') old.annual.annualBalance = [{}];
      else { old.meta.reportingCurrency = 'EUR'; delete old.meta.reportingCurrencyOriginal; delete old.meta.fxConverted; }
    } });
    const m = await f.run(), out = f.stored('EA');
    assert.equal(m.results[0].status, 'ok'); assert.equal(m.n_full_period_regression_blocked, 0);
    assert.deepEqual(m._fullPeriodRegressions, []);
    assert(periodEnds(out).quarterEnd < periodEnds(f.input.old).quarterEnd);
    assert.deepEqual(periodEnds(out), periodEnds(regression.cases.EA.candidate));
    assert.equal(out.meta.fundamentalsAsOf, new Date(regressionNow).toISOString());
    if (repair === 'schema') assert(out.annual.annualBalance.some(row => row && Object.hasOwn(row, 'currentAssets')));
    else assert.equal(out.meta.fxConverted, true);
  });
  await check('P137 a retained disk snapshot without meta gets the reason without losing its history', async () => {
    const f = regressionFixture('EA'), old = JSON.parse(f.before.snapshot);
    delete old.meta; f.files.set(f.sp, Buffer.from(JSON.stringify(old)));
    const m = await f.run(), out = f.stored('EA');
    assert.equal(m.results[0].status, 'price-only'); assert.equal(m.n_full_period_regression_blocked, 1);
    assert.equal(out.meta.fundamentalsRetainedReason, retainedReason);
    assert.deepEqual(out.annual, old.annual); assert.deepEqual(out.timeseries, old.timeseries);
    assert(f.files.get(f.cp).equals(f.before.cache));
  });
  await check('P137 equal-period restatements, newer periods and no-prior healing pass through', async () => {
    for (const newer of [false, true]) {
      const f = regressionFixture('EA', { change: ({ old, provider }) => {
        const end = newer ? '2026-09-30' : periodEnds(old).quarterEnd;
        const row = { ...provider.quarters.at(-1), date: end, totalRevenue: old.timeseries.revenueQ[0].value + 1 };
        provider.quarters.push(row);
        provider.summary.incomeStatementHistoryQuarterly.incomeStatementHistory.unshift({ ...row, endDate: end });
        old.meta.fundamentalsRetainedReason = retainedReason;
      } });
      const m = await f.run(), s = f.stored('EA');
      assert.equal(m.results[0].status, 'ok'); assert.equal(m.n_full_period_regression_blocked, 0);
      assert.deepEqual(m._fullPeriodRegressions, []);
      assert.equal(s.timeseries.revenueQ[0].value, f.input.old.timeseries.revenueQ[0].value + 1);
      assert.equal(periodEnds(s).quarterEnd, newer ? '2026-09-30' : periodEnds(f.input.old).quarterEnd);
      assert.equal(s.meta.fundamentalsRetainedReason, undefined);
      assert.equal(s.meta.fundamentalsAsOf, new Date(regressionNow).toISOString());
      for (const w of f.writes.filter(w => /_manifest(?:-full)?\.json$/.test(w.path))) {
        const manifest = JSON.parse(w.bytes);
        assert.equal(manifest.n_full_period_regression_blocked, 0); assert.deepEqual(manifest._fullPeriodRegressions, []);
      }
    }
    const f = regressionFixture('EA'); f.files.delete(f.sp);
    const m = await f.run(); assert.equal(m.results[0].status, 'ok');
    assert.equal(m.n_full_period_regression_blocked, 0);
    assert.deepEqual(periodEnds(f.stored('EA')), periodEnds(regression.cases.EA.candidate));
  });
  await check('P137 mixed bundle with a newer quarter and regressed fiscal year is retained as a whole', async () => {
    const f = regressionFixture('EA', { change: ({ old, provider }) => {
      const row = { ...provider.quarters.at(-1), date: '2026-09-30' };
      provider.quarters.push(row);
      provider.summary.incomeStatementHistoryQuarterly.incomeStatementHistory.unshift({ ...row, endDate: row.date });
      old.annual.annualRevEnds[0] = '2026-06-30';
    } });
    const m = await f.run(); assert.equal(m.results[0].status, 'price-only');
    assert.deepEqual(f.stored('EA').annual, f.input.old.annual); assert.deepEqual(f.stored('EA').timeseries, f.input.old.timeseries);
    assert(m._fullPeriodRegressions[0].nextQuarterEnd > m._fullPeriodRegressions[0].previousQuarterEnd);
    assert(m._fullPeriodRegressions[0].nextAnnualEnd < m._fullPeriodRegressions[0].previousAnnualEnd);
  });
  await check('P137 annual finite zero counts, future ends do not, and a missing next period is retained', async () => {
    for (const mode of ['zero', 'future', 'missing']) {
      const f = regressionFixture('KCN.AX', { change: ({ old, provider }) => {
        if (mode === 'zero') old.annual.annualRev[0] = { value: 0 };
        if (mode === 'future') {
          old.annual.annualRevEnds = ['2099-06-30']; old.annual.annualRev = [{ value: 1 }];
        }
        if (mode === 'missing') {
          provider.financials = []; provider.summary.incomeStatementHistory.incomeStatementHistory = [];
        }
      } });
      const m = await f.run();
      assert.equal(m.n_full_period_regression_blocked, mode === 'future' ? 0 : 1);
      assert.equal(m.results[0].status, mode === 'future' ? 'ok' : 'price-only');
      if (mode !== 'future') assert.deepEqual(f.stored('KCN.AX').annual, f.input.old.annual);
      if (mode === 'missing') assert.equal(m._fullPeriodRegressions[0].nextAnnualEnd, null);
    }
  });
  await check('P137 unusable summary price or trading currency retains bytes and counts a failed blocked refresh', async () => {
    for (const patch of [{ regularMarketPrice: null }, { regularMarketPrice: 0 }, { regularMarketPrice: Infinity }, { currency: null }]) {
      const f = regressionFixture('EA', { change: ({ provider }) => Object.assign(provider.summary.price, patch) });
      // A cap-less summary exits before this guard via the existing missing-cap path.
      assert(Number.isFinite(f.input.provider.summary.summaryDetail.marketCap));
      assertNoRefresh(f, await f.run());
    }
  });
  await check('P137 wrapped-null summary cap falls back after unwrapping; pence price and cap use distinct factors', async () => {
    const f = regressionFixture('EA', { change: ({ provider }) => {
      provider.summary.price.currency = { raw: 'GBp' };
      provider.summary.price.regularMarketPrice = { raw: regression.conventions.synthetic.quotePrice.value };
      provider.summary.price.marketCap = { raw: regression.cases.EA.candidate.marketCap.value };
      provider.summary.summaryDetail.marketCap = { raw: null };
    } });
    const fx = f.Y._fxFactorFor('GBp'), m = await f.run(), s = f.stored('EA');
    assert.equal(m.results[0].status, 'price-only'); assert.equal(m.n_full_period_regression_blocked, 1);
    assert.equal(s.price.regularMarketPrice, regression.conventions.synthetic.quotePrice.value * fx.factor);
    assert.equal(s.marketCap.value, regression.cases.EA.candidate.marketCap.value * fx.factorMajorUnit);
    assert.equal(fx.factorMajorUnit / fx.factor, 100); assert.equal(s.marketCap.source, 'yahoo_quoteSummary');
    assert.deepEqual(s.annual, f.input.old.annual); assert(f.files.get(f.cp).equals(f.before.cache));
  });
  await check('P137 late first price-only failure cannot contaminate the retained on-disk bundle', async () => {
    const f = regressionFixture('EA', { change: input => {
      input.quoteMarketCap = regression.cases.EA.candidate.marketCap.value;
      input.provider.summary.price.currency = 'GBp';
      delete input.old.price;
    } });
    // Fail the first virtual atomic write after FX, price and cap were assigned, before storing any bytes.
    const set = f.files.set.bind(f.files); let attempted;
    f.files.set = (p, b) => {
      if (p === f.sp && !attempted) { attempted = JSON.parse(Buffer.from(b)); throw new Error('fixture late quote failure'); }
      return set(p, b);
    };
    const m = await f.run(), out = f.stored('EA'), fx = f.Y._fxFactorFor('GBp');
    assert.equal(attempted.price.currency, 'USD'); assert.equal(attempted.meta.asOf, new Date(regressionNow).toISOString());
    assert.equal(attempted.price.regularMarketPrice, regression.conventions.synthetic.quotePrice.value);
    assert.equal(out.price.currency, 'GBp', 'the failed USD attempt must not pollute the pristine prior');
    assert.equal(out.price.regularMarketPrice, regression.conventions.synthetic.quotePrice.value * fx.factor);
    assert.equal(out.marketCap.value, regression.cases.EA.candidate.marketCap.value * fx.factorMajorUnit);
    assert.equal(m.results[0].status, 'price-only'); assert.equal(m.n_failed, 0);
    assert.equal(m._fullPeriodRegressions[0].priceUpdated, true);
    assert.equal(f.calls.filter(c => c[1] === 'quote').length, 2);
    assert(f.logs.some(l => l.includes('fixture late quote failure')));
    assert.deepEqual(financialChanges(f.input.old, out), []);
    assert(f.files.get(f.cp).equals(f.before.cache));
  });
  await check('P137 supplied cap below the floor after ADS correction never unlinks stored files', async () => {
    const shares = regression.cases.EA.candidate.marketCap.value / regression.conventions.synthetic.quotePrice.value;
    // Synthetic table in VM memory only. The candidate lacks shares; the retained copy confirms the correction.
    const source = replaceOnce(pullSource, 'const ADS_HAND_TABLE = loadAdsHandTable();',
      'const ADS_HAND_TABLE = ' + JSON.stringify({ EA: { ordinaryPerAds: 1000, yahooOrdinaryShares: shares, validFrom: '2026-01-01' } }) + ';');
    const f = regressionFixture('EA', { source, env: { MIN_MCAP_USD: '1000000000' }, change: ({ old }) => {
      old.meta.sharesOutstanding = shares; delete old.meta.impliedSharesOutstanding;
    } });
    const m = await f.run(); assertNoRefresh(f, m);
    assert(m.failures[0].error.includes('supplied summary cap below minimum'));
  });
  await check('P137 B/C controls do not trigger the period guard', async () => {
    for (const ticker of ['AUGO', 'SHA1.VI', '290A.T']) {
      const f = regressionFixture(ticker), m = await f.run();
      assert.equal(m.results[0].status, 'ok'); assert.equal(m.n_full_period_regression_blocked, 0);
      assert.deepEqual(m._fullPeriodRegressions, []);
      assert.deepEqual(periodEnds(f.stored(ticker)), periodEnds(regression.cases[ticker].candidate));
    }
  });
  await check('P137 every manifest transports the counter/list and quarantines invalid shard diagnostics', async () => {
    const f = regressionFixture('EA'), m = await f.run();
    const slimWrites = f.writes.filter(w => w.path === path.join(f.out, '_manifest.json')).map(w => JSON.parse(w.bytes));
    const checkpoint = slimWrites.find(w => w.partial === true), slim = slimWrites.find(w => w.partial === false);
    assert(checkpoint, 'a real incremental checkpoint is required'); assert(slim, 'a separate final write is required');
    const full = JSON.parse(f.files.get(path.join(f.out, '_manifest-full.json'))), merged = mergeManifests([slim], 1, 1);
    for (const x of [checkpoint, slim, full, merged]) {
      assert.equal(x.n_full_period_regression_blocked, m.n_full_period_regression_blocked);
      assert.deepEqual(x._fullPeriodRegressions, m._fullPeriodRegressions);
    }
    for (const x of [checkpoint, slim, merged]) {
      assert.equal(x.n_ok, x.n_full + x.n_priceonly + x.n_retained);
      assert.equal(x.n_priceonly, 1); assert.equal(x.n_retained, 0); assert.equal(x.n_full, 0);
      assert.equal(require('../scripts/coverage-gate.js').manifestNumbersSane(x, 1), true);
    }
    const legacy = copy(slim); delete legacy.n_full_period_regression_blocked; delete legacy._fullPeriodRegressions;
    for (const x of [legacy, { ...legacy, n_full_period_regression_blocked: 0, _fullPeriodRegressions: [] }]) {
      const r = mergeManifests([x], 1, 1); assert.equal(r.n_shards_invalid, 0);
      assert.equal(r.n_full_period_regression_blocked, 0); assert.deepEqual(r._fullPeriodRegressions, []);
    }
    const invalid = [-1, 0.5, '1', null, Infinity, Number.MAX_SAFE_INTEGER + 1].map(n => ({ ...slim, n_full_period_regression_blocked: n }));
    invalid.push({ ...legacy, _fullPeriodRegressions: [] }, { ...legacy, n_full_period_regression_blocked: 0 },
      { ...slim, n_full_period_regression_blocked: 0 }, { ...slim, _fullPeriodRegressions: {} },
      { ...slim, n_full_period_regression_blocked: 2, _fullPeriodRegressions: [...slim._fullPeriodRegressions, ...slim._fullPeriodRegressions] });
    const editedReason = 'Die gespeicherten Berichtsperioden bleiben erhalten.';
    const edited = { ...slim, _fullPeriodRegressions: [{ ...slim._fullPeriodRegressions[0], reasonDe: editedReason }] };
    const editedMerge = mergeManifests([edited], 1, 1);
    assert.equal(editedMerge.n_shards_invalid, 0); assert.equal(editedMerge._fullPeriodRegressions[0].reasonDe, editedReason);
    for (const patch of [{ ticker: '' }, { outcome: 'released' }, { priceUpdated: 'yes' }, { reason: 'other' },
      { reasonDe: '' }, { reasonDe: '   ' }, { reasonDe: null },
      { previousQuarterEnd: '2026-6-30' }, { nextQuarterEnd: undefined }, { previousAnnualEnd: 0 }, { nextAnnualEnd: false }]) {
      invalid.push({ ...slim, _fullPeriodRegressions: [{ ...slim._fullPeriodRegressions[0], ...patch }] });
    }
    for (const x of invalid) {
      const r = mergeManifests([x], 1, 1); assert.equal(r.n_shards_invalid, 1);
      assert.equal(r.partial, true); assert.equal(r.n_full_period_regression_blocked, 0); assert.deepEqual(r._fullPeriodRegressions, []);
    }
    const g = regressionFixture('CACC'); await g.run();
    const other = JSON.parse(g.files.get(path.join(g.out, '_manifest.json')));
    const joined = mergeManifests([slim, other], 2, 2);
    assert.equal(joined.n_full_period_regression_blocked, 2);
    assert.deepEqual(joined._fullPeriodRegressions.map(r => r.ticker), ['CACC', 'EA']);
    // Separate valid shards retain both observations, even if their tickers overlap.
    const duplicateAcross = mergeManifests([slim, slim], 2, 2);
    assert.equal(duplicateAcross.n_shards_invalid, 0); assert.equal(duplicateAcross.n_full_period_regression_blocked, 2);
    assert.deepEqual(duplicateAcross._fullPeriodRegressions.map(r => r.ticker), ['EA', 'EA']);
  });
  await check('P137 duplicate input ticker records one block and does not quarantine its shard', async () => {
    const f = regressionFixture('EA', { copies: 2 }), m = await f.run();
    assert.equal(m.n_full_period_regression_blocked, 1); assert.equal(m._fullPeriodRegressions.length, 1);
    const slim = JSON.parse(f.files.get(path.join(f.out, '_manifest.json')));
    assert.equal(mergeManifests([slim], 2, 1).n_shards_invalid, 0);
    assert.equal(f.logs.filter(l => l.startsWith('::warning::EA full-pull period regression blocked (')).length, 1);
  });
  await check('P137 guard-disabled red proof and seven-pair before/after replay', async () => {
    // Seven-pair replay, not a universe-wide proof. Both runs use identical provider/FX/table inputs.
    const disabled = withoutOrdinaryGuard();
    let groupAProtected = 0, unintendedBCBlocks = 0, otherFinancialLeavesChanged = 0;
    console.log('P137-REPLAY-POPULATION ' + JSON.stringify(Object.keys(regression.cases)));
    for (const ticker of Object.keys(regression.cases)) {
      const before = regressionFixture(ticker, { source: disabled }), after = regressionFixture(ticker);
      const mb = await before.run(), ma = await after.run(), b = before.stored(ticker), a = after.stored(ticker);
      const groupA = ['EA', 'FMS', 'CACC', 'KCN.AX'].includes(ticker);
      let changes;
      if (groupA) {
        assert.equal(mb.results[0].status, 'ok');
        assert.deepEqual(periodEnds(b), periodEnds(regression.cases[ticker].candidate));
        assert.throws(() => assert.deepEqual(periodEnds(b), periodEnds(after.input.old)), assert.AssertionError,
          'the same period assertion must fail with only the guard disabled');
        assertRetained(after, ma, ticker); groupAProtected++;
        changes = financialChanges(after.input.old, a);
      } else {
        for (const s of [b, a]) if (s._quality) { assert(Number.isFinite(Date.parse(s._quality.computedAt))); s._quality.computedAt = '<wall-clock>'; }
        changes = changedLeaves(b, a); unintendedBCBlocks += ma.n_full_period_regression_blocked;
      }
      otherFinancialLeavesChanged += changes.length;
      console.log('P137-CHANGED-LEAVES ' + JSON.stringify({ ticker, paths: changedLeaves(after.input.old, a), unexpected: changes }));
      console.log('P137-BEFORE-AFTER ' + JSON.stringify({ ticker, before: periodEnds(b), after: periodEnds(a),
        changedFinancialLeaves: changes.length, quoteChanged: changedLeaves(after.input.old.price, a.price).length > 0 || changedLeaves(after.input.old.marketCap, a.marketCap).length > 0 }));
    }
    const currentHashes = ['pull-yahoo.js', 'tests/fixtures/full-pull-period-regression.json'].map(p => digest(fs.readFileSync(path.join(root, p))));
    const inputHashesUnchanged = JSON.stringify(currentHashes) === JSON.stringify(frozenHashes)
      && digest(JSON.stringify(regression)) === frozenInputHash;
    const result = { groupAProtected, unintendedBCBlocks, otherFinancialLeavesChanged, inputHashesUnchanged };
    console.log('P137-BEFORE-AFTER-SUMMARY ' + JSON.stringify(result));
    assert.deepEqual(result, { groupAProtected: 4, unintendedBCBlocks: 0, otherFinancialLeavesChanged: 0, inputHashesUnchanged: true });
    assert.equal(currentHashes[1], 'a083ab460683d4dad88496166689bd766e2f33221ffeb05a7bb6f191022d8cd9');
  });
  console.log(`stale-quarter-fail-open.test.js: ${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
})().catch(e => { console.error(e.message); process.exitCode = 1; });

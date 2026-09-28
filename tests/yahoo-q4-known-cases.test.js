'use strict';

// Break-once mutates only an in-memory table fixture. Never target a writing test or real data.
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { Module, createRequire } = require('module');
const { applyKnownCases, validateTable } = require('../lib/yahoo-q4-known-cases.js');
const { mapFTSToQuarterly, _convertSnapshotToUSD } = require('../pull-yahoo.js');
const { readScoringSnapshot, loadUniverse, loadSmallcapUniverse } = require('../src/scoring/run-screener.js');
const { norm } = require('../src/scoring/snapshot.js');
const evidence = require('./fixtures/yahoo-q4-known-cases.json');
const table = require('../configs/yahoo-q4-known-cases.json');
const clone = x => JSON.parse(JSON.stringify(x));
const valueOf = x => typeof x === 'number' ? x : x?.value;
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const tablePath = path.resolve(__dirname, '../configs/yahoo-q4-known-cases.json');
const beforeHash = sha(tablePath);
const fields = { revenueQ: ['totalRevenue', 'annualRev'], opIncQ: ['operatingIncome', 'annualOpInc'], grossProfitQ: ['grossProfit', 'annualGP'] };
let pass = 0;
function test(name, fn) { fn(); pass++; console.log(`ok ${name}`); }
function fixture(ticker) {
  const receipt = evidence.receipts[ticker];
  const c = evidence.cells.find(c => c.ticker === ticker);
  const annual = {};
  for (const [source, field] of Object.values(fields)) {
    const rows = receipt.annual.slice().sort((a, b) => b.date.localeCompare(a.date));
    annual[field] = rows.map(r => Number.isFinite(r[source]) ? { value: r[source] } : null);
    annual[field + 'Ends'] = rows.map(r => r.date.slice(0, 10));
  }
  return { meta: { ticker, reportingCurrency: c.currency, tradingCurrency: c.currency, fetchedAt: '2026-09-27T00:00:00Z' },
    timeseries: mapFTSToQuarterly(receipt.quarterly.slice().sort((a, b) => a.date.localeCompare(b.date))), annual };
}
function index(s, c) { return s.timeseries[c.field + 'Ends'].indexOf(c.period); }
// Compile memory-only copies at their original resolution path; never rewrite live source.
function moduleCopy(relative, transform = s => s, overrides = {}) {
  const file = path.resolve(__dirname, '..', relative), m = new Module(file, module);
  const realRequire = createRequire(file);
  m.filename = file; m.paths = module.paths;
  m.require = id => Object.hasOwn(overrides, id) ? overrides[id] : realRequire(id);
  m._compile(transform(fs.readFileSync(file, 'utf8')), file);
  return m.exports;
}

test('table is exactly ten WRONG cases and 27 unique listing cells', () => {
  assert.equal(table.cases.length, 10);
  const keys = table.cases.flatMap(c => c.listingAliases.map(t => `${t}|${c.field}|${c.period}`)).sort();
  assert.deepEqual(keys, evidence.cells.filter(c => c.verdict === 'WRONG').map(c => `${c.ticker}|${c.field}|${c.period}`).sort());
  assert.throws(() => validateTable({}), /Invalid/);
  const bad = clone(table); bad.cases.push(bad.cases[0]); assert.throws(() => validateTable(bad), /Duplicate/);
  const overlap = clone(table); overlap.cases[0].listingAliases.push('PBR-A');
  assert.throws(() => validateTable(overlap), /overlaps statement-currency/);
});

test('malformed authority fails at pull startup; runtime overlay errors cannot become FX failures', () => {
  const file = path.resolve(__dirname, '../pull-yahoo.js');
  const m = new Module(file, module), realRequire = createRequire(file); let yahooLoaded = false;
  m.filename = file; m.paths = module.paths;
  m.require = id => {
    if (id === './lib/yahoo-q4-known-cases.js') return moduleCopy('lib/yahoo-q4-known-cases.js', s => s,
      { '../configs/yahoo-q4-known-cases.json': {} });
    if (id === 'yahoo-finance2') yahooLoaded = true;
    return realRequire(id);
  };
  assert.throws(() => m._compile(fs.readFileSync(file, 'utf8'), file), /Invalid Yahoo Q4 hand table/);
  assert.equal(yahooLoaded, false, 'Startup aborts before the vendor client or any pull');
  const s = fixture('AENA.MC');
  Object.defineProperty(s.timeseries, 'opIncQ', { get() { throw new Error('fixture overlay failure'); } });
  let fxCallback = false;
  assert.throws(() => require('../pull-yahoo.js')._convertSnapshotToUSDGuarded(s, () => { fxCallback = true; }),
    e => e.code === 'YAHOO_Q4_HAND_TABLE_FAILED' && /fixture overlay failure/.test(e.message));
  assert.equal(fxCallback, false); assert.equal(s.meta.fxConversionFailed, undefined);
});

test('prepended FY rows preserve every known bad Q4, native and cached; break-once catches index-zero regression', () => {
  const check = applier => {
    for (const c of table.cases) for (const ticker of c.listingAliases) for (const factor of [1, 1.1587486]) {
      const s = fixture(ticker), field = c.inputFingerprint.annualField;
      if (factor !== 1) {
        for (const container of [s.timeseries, s.annual]) for (const [key, rows] of Object.entries(container)) {
          if (!key.endsWith('Ends')) container[key] = rows.map(r => r == null ? r : { ...r, value: r.value * factor });
        }
        Object.assign(s.meta, { fxConverted: true, reportingCurrency: 'USD', reportingCurrencyOriginal: c.nativeCurrency, fxRateApplied: factor });
      }
      s.annual[field].unshift({ value: 987654321 * factor });
      s.annual[field + 'Ends'].unshift('2026-12-31');
      const expected = c.replacementNativeValue === null ? null : c.replacementNativeValue * factor;
      assert.equal(norm(applier(s).snapshot, c.field)[index(s, c)], expected, ticker + ' dated FY rollover');
      delete s.annual[field + 'Ends'];
      assert.equal(norm(applier(s).snapshot, c.field)[index(s, c)], expected, ticker + ' undated FY rollover');
    }
  };
  const file = path.resolve(__dirname, '../lib/yahoo-q4-known-cases.js'), before = sha(file);
  const broken = moduleCopy('lib/yahoo-q4-known-cases.js', s => {
    assert.ok(s.includes('series.some(matches)'));
    return s.replace('series.some(matches)', 'matches(series[0])').replace("process.once('exit', emitRuntimeSummary);", '');
  });
  check(applyKnownCases); assert.throws(() => check(broken.applyKnownCases), assert.AssertionError); check(applyKnownCases);
  assert.equal(sha(file), before);
});

test('source precision belongs to each document, not its issuer', () => {
  for (const c of table.cases.filter(c => c.issuerId === 'chipmos')) {
    assert.equal(c.sourcePrecisionNative, 1000, 'Primary FY/9M financial statements use thousands');
    assert.equal(c.sources.find(s => s.url.endsWith('en_ir_income_4850693036.pdf')).unit, 'TWD thousands');
    assert.equal(c.sources.find(s => s.url.endsWith('en_ir_income_3828614009.pdf')).unit, 'TWD thousands');
    assert.equal(c.sources.find(s => s.url.endsWith('en_ir_lawsaid_2850608037.pdf')).unit, 'TWD millions');
  }
});

for (const c of evidence.cells) test(`${c.verdict}: ${c.ticker} ${c.field}`, () => {
  const original = fixture(c.ticker), before = JSON.stringify(original), i = index(original, c);
  assert.equal(valueOf(original.timeseries[c.field][i]), c.vendorNative, 'Retained vendor receipt');
  const result = applyKnownCases(original), out = result.snapshot;
  assert.equal(norm(out, c.field)[i], c.expectedNative);
  assert.equal(JSON.stringify(original), before, 'Input never mutated');
  assert.equal(JSON.stringify(applyKnownCases(out).snapshot), JSON.stringify(out), 'Idempotent');
  if (c.verdict !== 'WRONG') assert.deepEqual(out.timeseries[c.field][i], original.timeseries[c.field][i]);
  else assert.equal(out.timeseries[c.field][i].yahooQ4Correction.originalVendorNativeValue, c.vendorNative);
  const converted = clone(original);
  _convertSnapshotToUSD(converted); // The actual production pre-FX hook, not a helper simulation.
  const expectedUSD = c.expectedNative === null ? null : c.expectedNative * converted.meta.fxRateApplied;
  assert.equal(norm(converted, c.field)[i], expectedUSD, 'Applied before existing FX exactly once');
  if (c.verdict === 'WRONG') {
    const provenance = converted.timeseries[c.field][i].yahooQ4Correction;
    assert.equal(provenance.currencyAtCorrection, c.currency);
    assert.equal(provenance.fxFactorAtCorrection, 1, 'Describes native input at correction, not the later USD value');
    assert.equal(provenance.appliedToCurrency, undefined);
  }
  const bytes = JSON.stringify(converted); _convertSnapshotToUSD(converted);
  assert.equal(JSON.stringify(converted), bytes, 'No double conversion');
  assert.equal(JSON.stringify(applyKnownCases(converted).snapshot), bytes, 'Scoring after pull is idempotent');
});

for (const c of table.cases) test(`absence controls: ${c.caseId}`, () => {
  const base = fixture(c.listingAliases[0]), i = index(base, c);
  for (const [label, mutate] of [
    ['true zero', s => { s.timeseries[c.field][i].value = 0; }],
    ['stale value', s => { s.timeseries[c.field][i].value += 1; }],
    ['other period', s => { s.timeseries[c.field + 'Ends'][i] = '2024-12-31'; }],
    ['other issuer', s => { s.meta.ticker = 'UNLISTED'; }],
    ['currency', s => { s.meta.reportingCurrency = 'GBP'; }],
    ['unit', s => { s.timeseries[c.field][i].unit = 'millions'; }],
    ['multiplier', s => { s.timeseries[c.field][i].multiplier = 1000; }],
    ['period type', s => { s.timeseries[c.field][i].periodType = '12M'; }],
    ['provider', s => { s.timeseries[c.field][i].source = 'SEC'; }],
    ['annual fingerprint', s => { s.annual[c.inputFingerprint.annualField][0].value += 1; }],
    ['annual unit', s => { s.annual[c.inputFingerprint.annualField][0].unit = 'millions'; }],
    ['FX proof missing', s => { Object.assign(s.meta, { fxConverted: true, reportingCurrency: 'USD', reportingCurrencyOriginal: c.nativeCurrency }); }],
    ['already corrected', s => { s.timeseries[c.field][i].value = c.replacementNativeValue; }],
  ]) {
    const s = clone(base); mutate(s);
    // Other verified fields of this issuer may still be corrected; the target cell must not move.
    const before = JSON.stringify(s.timeseries[c.field]?.[i]);
    const out = applyKnownCases(s);
    assert.equal(JSON.stringify(out.snapshot.timeseries[c.field]?.[i]), before, label);
    if (label === 'stale value' || label === 'annual fingerprint') assert.ok(out.stats.stale > 0, label);
  }
  const s = clone(base);
  s.timeseries.otherQ = clone(s.timeseries[c.field]);
  s.timeseries.otherQEnds = [...s.timeseries[c.field + 'Ends']];
  const before = JSON.stringify(s.timeseries.otherQ);
  const out = applyKnownCases(s).snapshot;
  assert.equal(valueOf(out.timeseries[c.field][i]), c.replacementNativeValue, 'Original target remains present and is corrected');
  assert.equal(JSON.stringify(out.timeseries.otherQ), before, 'Other field is unchanged');
});

test('unlisted incomplete subtraction logs and counts, without changing any value', () => {
  const s = fixture('AENA.MC'); s.meta.ticker = 'UNLISTED';
  const events = [], before = JSON.stringify(s);
  const r = applyKnownCases(s, { onEvent: e => events.push(e) });
  assert.ok(r.stats.observed > 0); assert.equal(events.length, r.stats.observed);
  assert.equal(JSON.stringify(r.snapshot), before);
});

test('real scoring loaders and normalized cache reader apply immediately', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yahoo-q4-scoring-test-'));
  const c = evidence.cells.find(c => c.ticker === 'AENA.MC' && c.verdict === 'WRONG');
  const s = fixture(c.ticker), factor = 1.1587486;
  // A legacy USD cache predates this correction; retain its original vendor value.
  for (const container of [s.timeseries, s.annual]) for (const [key, rows] of Object.entries(container)) {
    if (!key.endsWith('Ends')) container[key] = rows.map(r => r == null ? r : { ...r, value: r.value * factor });
  }
  Object.assign(s.meta, { reportingCurrency: 'USD', reportingCurrencyOriginal: 'EUR', fxConverted: true, fxRateApplied: factor });
  const file = path.join(dir, 'AENA.MC.json'), watchlist = path.join(dir, 'watchlist.fixture');
  assert.notEqual(path.resolve(dir), path.resolve(process.env.SCREENER_SNAPSHOTS_DIR || 'snapshots'));
  fs.writeFileSync(file, JSON.stringify(s));
  fs.writeFileSync(watchlist, JSON.stringify({ stocks: [{ ticker: c.ticker }] }));
  const h = sha(file);
  for (const out of [readScoringSnapshot(file), ...loadUniverse(dir, watchlist), ...loadSmallcapUniverse(dir, watchlist)]) {
    assert.equal(norm(out, c.field)[index(out, c)], c.expectedNative * factor);
  }
  assert.equal(sha(file), h);
});

test('process summary is emitted once, warnings do not fail a run, manifests retain counts', () => {
  const { mergeManifests } = require('../scripts/merge-shard-manifests.js');
  const shard = { n_ok: 1, n_full: 1, n_priceonly: 0, n_failed: 0, partial: false };
  for (const invalid of [null, [], '2', { observed: '2' }, { observed: -1 }, { missing: 0.5 }, { stale: Infinity }]) {
    const merged = mergeManifests([{ ...shard, yahooQ4HandTable: invalid }, shard], 2);
    assert.equal(merged.n_shards_invalid, 1); assert.equal(merged.partial, true);
  }
  assert.throws(() => mergeManifests([
    { ...shard, yahooQ4HandTable: { observed: Number.MAX_SAFE_INTEGER } },
    { ...shard, yahooQ4HandTable: { observed: 1 } }
  ], 2), /safe integer range/);
  assert.equal(mergeManifests([shard], 1).yahooQ4HandTable.observed, 0, 'Older manifests remain valid');
  for (const status of ['corrected', 'stale', 'observed']) {
    const run = spawnSync(process.execPath, ['-e', `
      const q = require('./lib/yahoo-q4-known-cases.js');
      require('./lib/yahoo-q4-known-cases.js');
      q.prepareSnapshot({ meta: { ticker: 'UNLISTED' } });
      q.prepareSnapshot({ meta: { ticker: 'UNLISTED' } }); q.runtimeCounters.${status} = 2;
    `], { cwd: path.resolve(__dirname, '..'), encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    const lines = run.stderr.trim().split(/\r?\n/);
    assert.equal(lines.length, 1); assert.match(lines[0], /yahoo-q4-hand-table-summary/);
    assert.equal(lines[0].startsWith('::warning::'), status !== 'corrected');
    assert.equal(JSON.parse(lines[0].slice(lines[0].indexOf('{')))[status], 2);
  }
  // Reuse the real pull's virtual-filesystem fixture; no writes/network reach live paths.
  const run = spawnSync(process.execPath, ['-e', `
    const assert = require('assert/strict'), path = require('path');
    const { fixture } = require('./tests/stale-quarter-reload.test.js');
    const q = require('./lib/yahoo-q4-known-cases.js');
    (async () => {
      const f = fixture({ manual: ['OLD'], quarterlyRows: [
        { date: '2025-03-31', totalRevenue: 110 }, { date: '2025-12-31', totalRevenue: 290 }] });
      const m = await f.run();
      assert.ok(m.yahooQ4HandTable.observed > 0);
      assert.equal(m.n_failed, 0);
      for (const name of ['_manifest.json', '_manifest-full.json']) {
        const stored = JSON.parse(f.files.get(path.resolve(f.out, name)));
        assert.deepEqual(stored.yahooQ4HandTable, JSON.parse(JSON.stringify(m.yahooQ4HandTable)));
      }
      const merged = require('./scripts/merge-shard-manifests.js').mergeManifests([
        { ...JSON.parse(JSON.stringify(m)), n_full: m.n_ok, n_priceonly: 0 },
        { ...JSON.parse(JSON.stringify(m)), n_full: m.n_ok, n_priceonly: 0 }], 2);
      assert.equal(merged.yahooQ4HandTable.observed, 2 * m.yahooQ4HandTable.observed);
      const failed = fixture({ manual: ['OLD'] });
      const before = Buffer.from(failed.files.get(path.resolve(failed.out, 'OLD.json')));
      q.prepareSnapshot = () => { const e = new Error('fixture runtime failure'); e.code = q.FAILURE_CODE; throw e; };
      await assert.rejects(failed.run, e => e.code === q.FAILURE_CODE);
      assert.deepEqual(failed.files.get(path.resolve(failed.out, 'OLD.json')), before, 'No deletion on overlay failure');
      assert.ok(!failed.logs.some(s => /skipped: fx-unknown/.test(s)));
    })().catch(e => { console.error(e); process.exitCode = 1; });
  `], { cwd: path.resolve(__dirname, '..'), encoding: 'utf8', timeout: 60000 });
  assert.equal(run.status, 0, run.stdout + run.stderr);
});

test('board PIT, coverage and reload readers use corrected cells; reader copy break-once is red', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yahoo-q4-readers-'));
  assert.notEqual(path.resolve(root), path.resolve(process.env.SCREENER_SNAPSHOTS_DIR || 'snapshots'));
  const dir = path.join(root, 'snapshots'); fs.mkdirSync(dir);
  const tickers = ['IDR.MC', 'GEST.MC', '8150.TW', 'AENA.MC'];
  for (const ticker of tickers) fs.writeFileSync(path.join(dir, ticker + '.json'), JSON.stringify(fixture(ticker)));
  const source = path.resolve(__dirname, '../scripts/write-board-history.js'), before = sha(source);
  const hashes = tickers.map(t => sha(path.join(dir, t + '.json')));
  const check = writer => {
    writer._setPaths(root);
    try {
      const v = writer.buildBoardVintage('fixture', tickers.map(ticker => ({ ticker, score: 50 })), '2026-09-28', {});
      for (const row of v.cohort.profitable) {
        const raw = fixture(row.ticker), corrected = applyKnownCases(raw).snapshot;
        for (const field of ['revenueQ', 'grossProfitQ']) assert.deepEqual(row.pit[field], norm(corrected, field));
        assert.deepEqual(row.pit.revenueQEnds, raw.timeseries.revenueQEnds, 'Period labels unchanged');
      }
    } finally { writer._setPaths(); }
  };
  const writer = require('../scripts/write-board-history.js');
  check(writer);
  const broken = moduleCopy('scripts/write-board-history.js', s => {
    assert.ok(s.includes('return prepareSnapshot(readJsonOrNull(fp));'));
    return s.replace('return prepareSnapshot(readJsonOrNull(fp));', 'return readJsonOrNull(fp);');
  });
  assert.throws(() => check(broken), assert.AssertionError); check(writer);
  const s = fixture('GEST.MC'), i = s.timeseries.revenueQEnds.indexOf('2025-12-31');
  // Isolate one known-wrong latest quarter. Retain no other finite latest field.
  s.timeseries = { revenueQ: [s.timeseries.revenueQ[i]], revenueQEnds: ['2025-12-31'] };
  assert.equal(require('../lib/stale-quarter-reload.js').latestReportedQuarter(s), null);
  s.meta.ticker = 'UNLISTED';
  assert.equal(require('../lib/stale-quarter-reload.js').latestReportedQuarter(s), '2025-12-31');
  const report = path.join(root, 'coverage.md');
  const run = spawnSync(process.execPath, [path.resolve(__dirname, '../scripts/data-quality-report.js'), '--snapshots', dir, '--out', report], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  const expected = tickers.filter(t => norm(applyKnownCases(fixture(t)).snapshot, 'revenueQ').filter(Number.isFinite).length >= 4).length;
  assert.match(fs.readFileSync(report, 'utf8'), new RegExp('revenueQ>=4\\s*\\|\\s*' + expected + '\\s*\\|'));
  assert.equal(sha(source), before);
  assert.deepEqual(tickers.map(t => sha(path.join(dir, t + '.json'))), hashes);
});

test('enumerated production quarterly readers have active hooks or an explicit exemption; new/bypassed readers fail', () => {
  const root = path.resolve(__dirname, '..'), policy = require('./fixtures/yahoo-q4-reader-policy.json');
  const files = new Map();
  const read = relative => files.set(relative, fs.readFileSync(path.join(root, relative), 'utf8'));
  function walk(dir) {
    for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const p = dir + '/' + e.name;
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.js') && !/test/.test(e.name)) read(p);
    }
  }
  for (const dir of ['lib', 'methods', 'src', 'scripts']) walk(dir);
  for (const e of fs.readdirSync(root, { withFileTypes: true })) if (e.isFile() && e.name.endsWith('.js') && !/test/.test(e.name)) read(e.name);
  const scan = source => /revenueQ|opIncQ|grossProfitQ/.test(source) ||
    [...source.matchAll(/require\(([^;]+?)\)/g)].some(m =>
      /['"/](?:snapshot|router|score|run-screener|smallcap-route|quality-route)(?:\.js)?['"]/.test(m[1]));
  const guard = sources => {
    const found = [...sources].filter(([file, source]) => file === 'src/scoring/run-screener.js' || scan(source)).map(([file]) => file).sort();
    assert.deepEqual(found, Object.keys(policy).sort(), 'Every quarterly reader/import must be classified');
    for (const [file, p] of Object.entries(policy)) {
      assert.ok(['hook', 'upstream', 'exempt'].includes(p.mode) && p.reason.length > 20, file + ' reason');
      if (p.mode === 'hook') {
        const code = sources.get(file).replace(/\/\*[\s\S]*?\*\//g, '').split(/\r?\n/).filter(line => !line.trim().startsWith('//')).join('\n');
        assert.ok(code.includes(p.hook), file + ' bypasses the overlay');
      }
    }
  };
  guard(files);
  const broken = new Map(files), reader = 'scripts/write-board-history.js';
  broken.set(reader, broken.get(reader).replace('return prepareSnapshot(readJsonOrNull(fp));', 'return readJsonOrNull(fp);'));
  assert.throws(() => guard(broken), /bypasses the overlay/);
  const unknown = new Map(files); unknown.set('scripts/unregistered-reader.js', 'snapshot.timeseries.revenueQ');
  assert.throws(() => guard(unknown), /Every quarterly reader/);
  unknown.set('scripts/unregistered-reader.js', "const { route } = require(path.join(ROOT, 'src', 'scoring', 'router.js')); route(raw);");
  assert.throws(() => guard(unknown), /Every quarterly reader/, 'Composed imports cannot evade enumeration');
  guard(files);
  for (const [file, source] of files) assert.equal(fs.readFileSync(path.join(root, file), 'utf8'), source, 'Live source unchanged: ' + file);
});

test('break-once: fixture row loss turns the presence guard red, live table SHA unchanged', () => {
  const broken = clone(table); broken.cases = broken.cases.filter(c => c.caseId !== 'aena-2025-q4-opIncQ');
  const input = fixture('AENA.MC');
  const qi = input.timeseries.opIncQEnds.indexOf('2025-12-31');
  const guard = config => assert.equal(norm(applyKnownCases(input, { table: config }).snapshot, 'opIncQ')[qi], 736818000);
  guard(table); assert.throws(() => guard(broken), assert.AssertionError); guard(table);
  assert.equal(sha(tablePath), beforeHash);
});

test('display evidence count and Rule40 use the same cached-snapshot correction', () => {
  const F = require('./rule40-fixture.js');
  const raw = fixture('GEST.MC');
  const s = F.snapshot({ ticker: 'GEST.MC', sector: 'Consumer Cyclical', industry: 'Auto Parts', revenueTTM: 11e9 });
  Object.assign(s.meta, raw.meta);
  Object.assign(s.annual, raw.annual);
  s.timeseries = raw.timeseries;
  const f = F.baueExport([{ row: F.boardZeile({ ticker: 'GEST.MC' }), snap: s, branch: 'consumer-discretionary', reihe: false }]);
  const file = path.join(f.snapshotsDir, 'GEST.MC.json'), before = sha(file);
  const priorEnv = process.env.FINDASH_SNAPSHOTS_DIR;
  process.env.FINDASH_SNAPSHOTS_DIR = f.snapshotsDir;
  const writerPath = require.resolve('../scripts/write-findash-export.js');
  delete require.cache[writerPath];
  try {
    const w = require(writerPath);
    const out = w.mapBoardRow(F.boardZeile({ ticker: 'GEST.MC' }), 0);
    assert.equal(out.qPunkte, w.belegPunkte(s.timeseries).qPunkte - 1, 'Missing Q4 is not counted as a revenue observation');
    const r = require('../scripts/write-rule40-export.js').sammleKandidaten({ v1Dir: f.v1Dir, snapshotsDir: f.snapshotsDir });
    const candidates = r.kandidaten;
    const candidate = candidates.find(c => c.ticker === 'GEST.MC');
    assert.ok(candidate, 'Fixture passes the real Rule40 route');
    const axes = require('../src/scoring/axes.js');
    assert.equal(candidate.wachstumRoh, axes.revGrowthLevel(applyKnownCases(s).snapshot));
    assert.notEqual(candidate.wachstumRoh, axes.revGrowthLevel(s), 'Reader hook has a measurable effect');
  } finally {
    if (priorEnv === undefined) delete process.env.FINDASH_SNAPSHOTS_DIR;
    else process.env.FINDASH_SNAPSHOTS_DIR = priorEnv;
    delete require.cache[writerPath];
    assert.equal(sha(file), before);
  }
});

if (process.env.SCREENER_SNAPSHOTS_DIR && fs.existsSync(process.env.SCREENER_SNAPSHOTS_DIR)) {
  test('real snapshot replay: exactly 27 changes, 44 controls, all other bytes and source hashes unchanged', () => {
    const r = require('../scripts/yahoo-q4-known-cases-replay.js').replay(process.env.SCREENER_SNAPSHOTS_DIR);
    console.log(`Real replay: ${r.snapshots} snapshots, ${r.changedCells} cells, ${r.controlsUnchanged} controls`);
  });
} else console.log('SKIP real snapshot replay: SCREENER_SNAPSHOTS_DIR not supplied/available');
console.log(`${pass} tests passed; break-once fired and restored.`);

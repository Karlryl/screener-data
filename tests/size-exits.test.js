'use strict';
// All writes and removals below are virtual. Break-once mutates source in memory, never writing tests or live files.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const vm = require('node:vm');
const crypto = require('node:crypto');
const cp = require('node:child_process');
const ROOT = path.resolve(__dirname, '..');
const readSource = fs.readFileSync.bind(fs);

if (process.argv.includes('--break-once')) {
  const targets = ['lib/size-exits.js', 'pull-yahoo.js', 'scripts/filter-snapshot-merge.js', 'src/scoring/run-screener.js'];
  const hashes = () => targets.map(p => crypto.createHash('sha256').update(readSource(path.join(ROOT, p))).digest('hex'));
  const before = hashes();
  for (const mutation of ['floor', 'record', 'merge', 'metadata', 'generation']) {
    const r = cp.spawnSync(process.execPath, [__filename], { cwd: ROOT, encoding: 'utf8',
      env: { ...process.env, SIZE_EXIT_MUTATION: mutation } });
    assert.equal(r.status, 1, mutation + ' must turn the guard red');
    assert.match(r.stderr, /AssertionError/, 'mutation must fail an assertion');
    assert.deepEqual(hashes(), before, 'live source changed during break-once');
    console.log('BREAK_ONCE ' + mutation + ' exit=1 detected=true liveHashesUnchanged=true');
  }
  process.exit(0);
}

const mutations = {
  floor: ['lib/size-exits.js', '  const text = String(floorUsd / 1e9);', '  const text = (floorUsd / 1e9).toFixed(0);'],
  record: ['pull-yahoo.js', '  _sizeExits.set(ticker, record);', '  // mutant: lose the recorded exit'],
  merge: ['scripts/filter-snapshot-merge.js', '  writeFileAtomic(path.join(ziel, SIZE_EXITS_FILE), JSON.stringify(sizeExits));', '  // mutant: lose the merged exits'],
  metadata: ['src/scoring/run-screener.js', "    if (f.startsWith('_manifest') || f === '_last_good_disk.json') continue;", '    // mutant: parse metadata as snapshots'],
  generation: ['scripts/filter-snapshot-merge.js', '    return match && match[1] === sizeExitTag;', '    return match;'],
};
function mutate(source, file) {
  const row = mutations[process.env.SIZE_EXIT_MUTATION];
  if (!row || file !== path.join(ROOT, row[0])) return source;
  const lines = source.split(/\r?\n/);
  const hits = lines.filter(line => line === row[1]).length;
  assert.equal(hits, row[0].includes('run-screener') ? 2 : 1, 'complete-line mutation anchor');
  return lines.map(line => line === row[1] ? row[2] : line).join('\n');
}
const compile = Module.prototype._compile;
Module.prototype._compile = function(source, file) { return compile.call(this, mutate(source, file), file); };

process.env.MIN_MCAP_USD = '800000000';
process.env.PULL_CONCURRENCY = '1';
process.env.STALE_QUARTER_RELOAD = '0';
process.env.GITHUB_RUN_ID = '123456';
process.env.GITHUB_RUN_ATTEMPT = '2';
delete process.env.VOLL_PULL_TICKER;
delete process.env.MISSING_CAP_CARRIER;
global.fetch = () => { throw new Error('NO NETWORK'); };
const now = Date.parse('2026-10-07T12:00:00.000Z');
const RealDate = Date;
global.Date = class extends RealDate {
  constructor(...args) { super(...(args.length ? args : [now])); }
  static now() { return now; }
};

const virtualRoot = path.join(ROOT, '_scratch', 'size-exits-virtual');
const out = path.join(virtualRoot, 'snapshots');
const incoming = path.join(virtualRoot, 'incoming');
const merged = path.join(virtualRoot, 'merged');
const ticker = 'SIZETEST';
const cachePath = path.join(ROOT, 'fundamentals-cache', ticker + '.json');
const files = new Map(), fds = new Map(), logs = [];
let failDelete = null;
let failSecondTicker = false;
const norm = p => path.resolve(String(p));
const virtual = p => norm(p).startsWith(virtualRoot + path.sep) || norm(p) === virtualRoot || norm(p) === cachePath;
const original = {};
for (const k of ['existsSync', 'readFileSync', 'readdirSync', 'openSync', 'readSync', 'closeSync']) original[k] = fs[k].bind(fs);
fs.existsSync = p => files.has(norm(p)) || [out, incoming, merged].includes(norm(p)) || (!virtual(p) && original.existsSync(p));
fs.readFileSync = (p, ...args) => {
  if (files.has(norm(p))) return files.get(norm(p));
  if (norm(p) === path.join(ROOT, 'earnings-calendar.json')) return '{}';
  if (virtual(p)) throw Object.assign(new Error('Virtual file absent'), { code: 'ENOENT' });
  return original.readFileSync(p, ...args);
};
fs.readdirSync = (p, ...args) => virtual(p) ? [...files.keys()].filter(f => path.dirname(f) === norm(p)).map(f => path.basename(f)) : original.readdirSync(p, ...args);
let nextFd = 900000;
fs.openSync = (p, ...args) => {
  if (files.has(norm(p))) { const fd = nextFd++; fds.set(fd, Buffer.from(files.get(norm(p)))); return fd; }
  if (virtual(p)) throw new Error('Virtual file absent');
  return original.openSync(p, ...args);
};
fs.readSync = (fd, buffer, offset, length, pos) => fds.has(fd) ? fds.get(fd).copy(buffer, offset, pos ?? 0, (pos ?? 0) + length) : original.readSync(fd, buffer, offset, length, pos);
fs.closeSync = fd => fds.has(fd) ? fds.delete(fd) : original.closeSync(fd);
fs.mkdirSync = p => assert(virtual(p) || norm(p) === path.dirname(cachePath), 'unexpected mkdir');
fs.unlinkSync = p => {
  assert(virtual(p), 'unexpected unlink');
  if ((failDelete === 'cache' && norm(p) === cachePath) ||
      (failDelete === 'snapshot' && norm(p) === path.join(out, ticker + '.json'))) throw new Error('EACCES fixture');
  files.delete(norm(p));
};
fs.copyFileSync = (from, to) => { assert(virtual(from) && virtual(to), 'copy must remain virtual'); files.set(norm(to), files.get(norm(from))); };
for (const k of ['writeFileSync', 'appendFileSync', 'renameSync', 'rmSync']) fs[k] = () => { throw new Error('NO DISK WRITE: ' + k); };
const atomic = (p, raw) => { assert(virtual(p), 'unexpected atomic write'); files.set(norm(p), raw); };
let cap = 790000000, fullCap;
class FakeYahoo {
  async quote() { return { symbol: ticker, currency: 'USD', regularMarketPrice: 100, marketCap: cap }; }
  async quoteSummary(symbol) {
    if (failSecondTicker && symbol === 'SECOND') {
      const err = new Error('Interrupted shard fixture');
      err.code = require('../lib/yahoo-q4-known-cases.js').FAILURE_CODE;
      throw err;
    }
    return { price: { symbol: ticker, currency: 'USD', marketCap: fullCap === undefined ? cap : fullCap, regularMarketPrice: 100 },
    financialData: { financialCurrency: 'USD' }, summaryProfile: { sector: 'Technology', industry: 'Semiconductors', country: 'United States' } }; }
  async fundamentalsTimeSeries() { return []; }
}
const load = Module._load;
Module._load = function(req, parent, ...rest) {
  if (req === 'yahoo-finance2') return { default: FakeYahoo };
  if (/[/\\]atomic-write\.js$/.test(req)) return { writeFileAtomic: atomic, writeJsonAtomic: (p, value) => atomic(p, JSON.stringify(value)) };
  return load.call(this, req, parent, ...rest);
};
const print = console.log.bind(console);
console.log = console.warn = console.error = (...args) => logs.push(args.join(' '));
const helpers = require('../lib/size-exits.js');
const { formatSizeFloor, buildSizeExit, mergeSizeExits, sizeExitReasonDe, sizeExitRunTag, SIZE_EXITS_FILE, SIZE_EXIT_SHARD_PATTERN } = helpers;
const { pullAll, recordSizeExit, mergeSmallcapSnapshots } = require('../pull-yahoo.js');
const { loadUniverse, loadSmallcapUniverse } = require('../src/scoring/run-screener.js');
const { isMetadataSnapshot } = require('../lib/snapshot-fs.js');
const { teileEingang } = require('../scripts/filter-snapshot-merge.js');
const day = 86400000;
const iso = days => new Date(now - days * day).toISOString();
const seed = {
  meta: { ticker, name: 'Size fixture issuer', country: 'United States', sector: 'Technology', industry: 'Semiconductors', reportingCurrency: 'USD', reportingCurrencyOriginal: 'USD', fxRateApplied: 1, asOf: iso(1), fetchedAt: iso(10), fundamentalsAsOf: iso(10) },
  marketCap: { value: 5e9, source: 'yahoo_quote', confidence: 0.9, asOf: iso(1) },
  price: { regularMarketPrice: 100, currency: 'USD', currencyUnit: 'USD' },
  annual: { annualRev: [1e9, 8e8, 6e8, 4e8], annualOpInc: [2e8, 1.4e8, 1e8, 6e7], annualNetIncome: [1.5e8, 1e8, 7e7, 4e7], annualGP: [5e8, 3.6e8, 2.4e8, 1.6e8], annualFCF: [1.6e8, 1.1e8, 8e7, 5e7], annualOCF: [1.8e8, 1.2e8, 9e7, 6e7], annualSGA: [1e8, 8e7, 6e7, 4e7], annualShares: [1e8, 1e8, 1e8, 1e8], annualBalance: [{ currentAssets: 1e9, currentLiabilities: 2e8, totalLiabilities: 3e8 }] },
  timeseries: { revenueQ: [3e8, 2.6e8, 2.4e8, 2e8, 1.8e8, 1.6e8, 1.5e8, 1.1e8].map(value => ({ value })) }, metrics: {},
};
const stock = { ticker, yahoo_symbol: ticker, name: seed.meta.name, sector: 'Technology' };
const report = shard => path.join(out, `_manifest-size-exits.shard-${shard}.run-123456-2.json`);

// Execute the filename predicates at their production call sites, rather than copying their logic.
function closingParen(source, open) {
  let depth = 0, quote = '', escape = false;
  for (let i = open; i < source.length; i++) {
    const c = source[i];
    if (quote) {
      if (escape) escape = false;
      else if (c === '\\') escape = true;
      else if (c === quote) quote = '';
    } else if (c === "'" || c === '"' || c === '`') quote = c;
    else if (c === '(') depth++;
    else if (c === ')' && --depth === 0) return i;
  }
  throw new Error('Unclosed predicate');
}
function checkReaderPredicates(names) {
  const readers = [
    'scripts/check-pull-stats.js', 'scripts/coverage-gate.js', 'scripts/data-quality-report.js',
    'scripts/plan-check.js', 'scripts/verify-freshness.js', 'scripts/watch-annual-spikes.js',
    'scripts/watch-exchange-coverage.js', 'scripts/watch-fx-sanity.js', 'scripts/watch-unrouted-quote.js',
    'scripts/write-rule40-export.js', 'scripts/druckenmiller-13f.js', 'scripts/exchange-check-report.js',
    'scripts/einmalertrag-trefferquote.js', 'scripts/financial-corrections-replay.js',
    'scripts/opinc-source-migrate.js', 'scripts/roic-reliability.js', 'scripts/value-spot-check.js',
    'scripts/f1-rekonstruktions-kipppunkte.js', 'scripts/probe-fingerprint-zensus.js',
    'scripts/probe-issuer-branchenkonflikt.js', 'scripts/probe-issuer-strict-key-punct.js',
    'scripts/probe-jahresreihen-alter.js', 'scripts/t322-ads-verhaeltnis-optionen.js',
    'scripts/yahoo-q4-known-cases-replay.js', 'scripts/yahoo-q4-known-cases-board-replay.js',
    'scripts/build-secannual.js', 'scripts/build-secannual-smallcap.js', 'scripts/fetch-secbulk.js',
    'scripts/build-findash-name-map.js', 'scripts/gqs00-equivalence.js',
    'scripts/p115-jahrespaare-vorher-nachher.js', 'scripts/write-findash-export.js',
    'scripts/filter-snapshot-merge.js', 'scripts/merge-shard-manifests.js',
    'tests/scoring/anchors.rank.test.js', 'tests/scoring/score-breakdown.test.js',
    'tests/scoring/calib-parity.test.js', 'tests/scoring/calibration.test.js',
    'tests/scoring/calibration-ref.test.js', 'tests/scoring/quality-board.test.js',
    'tests/waehrung-ausliefer-waechter.test.js',
  ];
  let checked = 0;
  for (const reader of readers) {
    const source = readSource(path.join(ROOT, reader), 'utf8');
    const predicates = [];
    for (const match of source.matchAll(/\.filter\(|\bif\s*\(/g)) {
      const open = match.index + match[0].lastIndexOf('(');
      const body = source.slice(open + 1, closingParen(source, open));
      if (!/isMetadataSnapshot\(|\.startsWith\(['"]_manifest/.test(body)) continue;
      if (body.includes('\n') || body.includes('fs.readdirSync')) continue;
      predicates.push({ body, filter: match[0].startsWith('.filter') });
    }
    assert(predicates.length, reader + ': metadata predicate must be at a reader call site');
    for (const { body, filter } of predicates) {
      for (const name of [...names, 'AAPL.json']) {
        const context = { isMetadataSnapshot, path, f: name, n: name, name, file: name, filename: name,
          fn: name, entry: { name }, snap: name, fileName: name };
        for (const binding of body.matchAll(/(?:isMetadataSnapshot\((\w+)\)|\b(\w+)\.(?:endsWith|startsWith)\()/g)) {
          context[binding[1] || binding[2]] = name;
        }
        const dirent = { name, isFile: () => true };
        context.candidate = /\.name\b|\.isFile\(/.test(body) ? dirent : name;
        for (const binding of body.matchAll(/\b(\w+)\.(?:name\b|isFile\()/g)) context[binding[1]] = dirent;
        const result = vm.runInNewContext(filter ? `(${body})(candidate)` : body, context);
        assert.equal(Boolean(result), filter ? name === 'AAPL.json' : name !== 'AAPL.json', reader + ': ' + name);
        checked++;
      }
    }
  }
  const { filenameMayBeCandidate } = require('../lib/druckenmiller/universe.js');
  for (const name of names) assert.equal(filenameMayBeCandidate(name), false);
  print(`PASS reader predicates: ${readers.length} source readers, ${checked} executed filename checks and Druckenmiller prefilter`);
}
async function pull(prior, value, age = 1, shard = 0, full, deletionFailure = null) {
  files.clear(); logs.length = 0; cap = value; fullCap = full;
  failDelete = deletionFailure;
  if (deletionFailure === 'cache') files.set(cachePath, '{}');
  if (prior) { const s = structuredClone(seed); s.meta.asOf = iso(age); files.set(path.join(out, ticker + '.json'), JSON.stringify(s)); }
  const result = await pullAll({ stocks: [stock], _pullShard: { index: shard, count: 17 } }, out, 0);
  assert(files.has(report(shard)), 'completed pulls must write a report even when empty');
  const data = JSON.parse(files.get(report(shard)));
  assert.equal(data.n_missing_mcap, result.n_missing_mcap, 'manifest counter pin must remain unchanged');
  return { result, records: data.sizeExits };
}

async function run() {
  for (const [usd, en, de] of [[8e8, '0.8', '0,8'], [1e9, '1', '1'], [1.5e9, '1.5', '1,5']]) {
    assert.equal(formatSizeFloor(usd), en); assert.equal(formatSizeFloor(usd, true), de);
  }
  const exit = buildSizeExit('SKS.AX', 790000000, 800000000, iso(0), 'full-pull');
  assert.deepEqual(exit, { ticker: 'SKS.AX', marketCapUsd: 790000000, floorUsd: 800000000, date: '2026-10-07', source: 'full-pull' });
  assert.equal(sizeExitReasonDe(exit), 'unter der Gr\u00f6\u00dfengrenze von 0,8 Mrd. USD am 07.10.2026');
  const immx = buildSizeExit('IMMX', 799999999, 8e8, iso(0), 'price-only');
  assert.deepEqual(mergeSizeExits([[exit, immx], [{ ...immx, source: 'full-pull' }]]), [{ ...immx, source: 'full-pull' }, exit]);
  assert.deepEqual(mergeSizeExits([]), []); assert.deepEqual(mergeSizeExits([[], []]), []);
  assert.throws(() => mergeSizeExits([null]), /array/);
  assert.throws(() => buildSizeExit('BAD', 1, 8e8, '2026-02-30', 'full-pull'), /Invalid/);
  assert.throws(() => buildSizeExit('BAD', 8e8, 8e8, iso(0), 'full-pull'), /Invalid/);
  assert.equal(sizeExitRunTag({ GITHUB_RUN_ID: '123456', GITHUB_RUN_ATTEMPT: '2' }), '123456-2');
  assert.equal(sizeExitRunTag({}), null);
  print('PASS size-exit helpers: exact floors, German reason, dates, dedupe, sort and empty input');

  let r = await pull(true, 790000000);
  assert.equal(r.result.results[0].status, 'skipped-mcap');
  assert.deepEqual(r.records, [{ ticker, marketCapUsd: 790000000, floorUsd: 8e8, date: '2026-10-07', source: 'full-pull' }]);
  const priceLog = logs.find(line => line.includes('price-only floor: mcap='));
  const fullLog = logs.find(line => line.includes('skipped: mcap='));
  for (const line of [priceLog, fullLog]) { assert(line, 'both floor paths must execute'); assert.match(line, /mcap=0\.79B < \$0\.8B/); assert(!line.includes('$1B')); }
  assert(!files.has(path.join(out, ticker + '.json')));
  assert.equal(recordSizeExit(ticker, 8e8, 8e8, iso(0), 'full-pull'), null);
  print('PASS actual pull: both paths print $0.8B and jointly record one full-pull exit');

  r = await pull(true, 799999999, 40);
  assert.equal(r.records[0].marketCapUsd, 799999999);
  assert.equal(r.records[0].source, 'full-pull');
  r = await pull(false, 790000000);
  assert.deepEqual(r.records, []); assert.equal(r.result.results[0].status, 'skipped-mcap');
  assert.equal(recordSizeExit('NEVERSEEN', 1, 8e8, iso(0), 'full-pull'), null);
  r = await pull(true, 8e8);
  assert.deepEqual(r.records, []); assert.equal(r.result.results[0].status, 'price-only');
  assert(files.has(path.join(out, ticker + '.json')));
  r = await pull(true, 790000000, 1, 1, 9e8);
  assert.equal(r.records[0].source, 'price-only'); assert.equal(r.records.length, 1);
  assert.equal(r.result.results[0].status, 'ok');
  assert.notEqual(report(0), report(1));
  r = await pull(true, null);
  assert.deepEqual(r.records, []); assert.equal(r.result.results[0].status, 'missing-market-cap');
  r = await pull(true, 790000000, 40, 0, undefined, 'cache');
  assert.equal(r.result.results[0].status, 'failed-delete');
  assert.equal(r.records.length, 1, 'removed snapshot must be reported even if cache cleanup failed');
  assert(!files.has(path.join(out, ticker + '.json'))); assert(files.has(cachePath));
  r = await pull(true, 790000000, 40, 0, undefined, 'snapshot');
  assert.equal(r.result.results[0].status, 'failed-delete');
  assert.deepEqual(r.records, [], 'failed snapshot removal is not an exit');
  failDelete = null;
  files.clear(); cap = 790000000; fullCap = undefined;
  const oldSeed = structuredClone(seed); oldSeed.meta.asOf = iso(40);
  files.set(path.join(out, ticker + '.json'), JSON.stringify(oldSeed));
  files.set(path.join(out, 'SECOND.json'), JSON.stringify({ ...oldSeed, meta: { ...oldSeed.meta, ticker: 'SECOND' } }));
  failSecondTicker = true;
  await assert.rejects(pullAll({ stocks: [stock, { ...stock, ticker: 'SECOND', yahoo_symbol: 'SECOND' }], _pullShard: { index: 0, count: 17 } }, out, 0), /Interrupted shard fixture/);
  failSecondTicker = false;
  assert.equal(JSON.parse(files.get(report(0))).sizeExits.length, 1, 'interrupted shard must retain completed exits');
  assert(!files.has(path.join(out, ticker + '.json')));
  print('PASS interrupted/deletion controls: removed snapshot checkpoint survives abort and cache failure, failed snapshot removal is not an exit');
  print('PASS actual pull controls: no prior snapshot, exact floor, missing cap, run reset, shard uniqueness and price-only exit');

  files.clear();
  const names = [SIZE_EXITS_FILE, path.basename(report(0)), path.basename(report(1))];
  files.set(path.join(out, ticker + '.json'), JSON.stringify(seed));
  const wl = path.join(virtualRoot, 'watchlist.json');
  files.set(wl, JSON.stringify({ stocks: [stock, { ticker: 'METADATA' }] }));
  for (const name of names) {
    assert(isMetadataSnapshot(name));
    // A valid fake ticker catches loading metadata even if a parser tolerates an array.
    files.set(path.join(out, name), JSON.stringify({ ...seed, meta: { ...seed.meta, ticker: 'METADATA' } }));
  }
  assert(!isMetadataSnapshot('_CON.json'));
  assert.deepEqual(loadUniverse(out, wl).map(s => s.meta.ticker), [ticker]);
  assert.deepEqual(loadSmallcapUniverse(out, wl).map(s => s.meta.ticker), [ticker]);
  const split = teileEingang([...names, ticker + '.json'], new Set([ticker + '.json']));
  assert.equal(split.gescannt, 1); assert.deepEqual(split.uebersprungen, []);
  for (const name of names) files.set(path.join(incoming, name), '{not-json');
  files.set(path.join(incoming, ticker + '.json'), JSON.stringify(seed));
  mergeSmallcapSnapshots(incoming, merged);
  assert.deepEqual(fs.readdirSync(merged), [ticker + '.json']);
  // Execute the real merge-manifest count expression against the same virtual directory.
  const countSource = readSource(path.join(ROOT, 'scripts/merge-shard-manifests.js'), 'utf8');
  const count = countSource.match(/onDisk = (fs\.readdirSync\(snapDir\)\.filter\([^\n]+?\)\.length);/);
  assert(count, 'on-disk count seam missing');
  assert.equal(vm.runInNewContext(count[1], { fs, snapDir: out, isMetadataSnapshot }), 1);
  checkReaderPredicates(names);
  print('PASS metadata: main/smallcap loaders, main merge count/filter and SmallCap merge ignore all exit files');

  files.clear();
  const current = path.basename(report(0));
  const oldRun = current.replace('123456-2', '123455-2');
  const oldAttempt = current.replace('123456-2', '123456-1');
  const emptyShard = path.basename(report(1));
  for (const [name, value] of [[current, [exit, immx]], [emptyShard, []], [oldRun, [buildSizeExit('OLD', 1, 8e8, iso(1), 'full-pull')]], [oldAttempt, [buildSizeExit('RETRY', 1, 8e8, iso(0), 'full-pull')]], [SIZE_EXITS_FILE, [exit]]]) {
    files.set(path.join(incoming, name), JSON.stringify({ n_missing_mcap: 0, sizeExits: value }));
  }
  files.set(path.join(incoming, ticker + '.json'), JSON.stringify(seed));
  const filterSource = mutate(readSource(path.join(ROOT, 'scripts/filter-snapshot-merge.js'), 'utf8'), path.join(ROOT, 'scripts/filter-snapshot-merge.js'));
  const start = filterSource.indexOf('  const sizeExitTag = sizeExitRunTag(process.env);');
  const end = filterSource.indexOf('  // DAS EINZIGE LOCH', start);
  assert(start >= 0 && end > start, 'real merge block missing');
  const mergeBlock = '{\n' + filterSource.slice(start, end) + '\n}';
  const context = { fs, path, process, console, eingang: incoming, ziel: merged, files: fs.readdirSync(incoming),
    uebernehmen: fs.readdirSync(incoming), writeFileAtomic: atomic, ...helpers };
  vm.runInNewContext(mergeBlock, context);
  assert(files.has(path.join(merged, SIZE_EXITS_FILE)), 'shard merge must write the consolidated report');
  assert.deepEqual(JSON.parse(files.get(path.join(merged, SIZE_EXITS_FILE))), [immx, exit]);
  assert.deepEqual(fs.readdirSync(merged).sort(), [ticker + '.json', SIZE_EXITS_FILE].sort());
  for (const name of [current, oldRun, oldAttempt]) assert(SIZE_EXIT_SHARD_PATTERN.test(name));
  for (const file of fs.readdirSync(merged)) files.delete(path.join(merged, file));
  files.set(path.join(incoming, current), '{"n_missing_mcap":0,"sizeExits":[]}');
  vm.runInNewContext(mergeBlock, context);
  assert.deepEqual(JSON.parse(files.get(path.join(merged, SIZE_EXITS_FILE))), []);
  files.set(path.join(merged, SIZE_EXITS_FILE), JSON.stringify([exit]));
  const noCurrent = { ...context, files: [oldRun, oldAttempt, ticker + '.json'], uebernehmen: [oldRun, oldAttempt, ticker + '.json'] };
  vm.runInNewContext(mergeBlock, noCurrent);
  assert.deepEqual(JSON.parse(files.get(path.join(merged, SIZE_EXITS_FILE))), [], 'a prior merged report must not survive a pull with no completed current report');
  print('PASS shard merge: dedupe/sort, empty completion, old run/attempt rejection and no shard reports copied');
  print('size-exits.test.js: all passed; diskWrites=0 networkCalls=0');
}
run().catch(e => { process.stderr.write(e.stack + '\n'); process.exitCode = 1; });

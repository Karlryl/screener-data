'use strict';
// All mutation targets and writes are virtual. No network or live store writes.
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Module = require('node:module');
const N = require('../lib/nse-quarters');
const A = require('../scripts/build-inannual');
const R = require('../scripts/nse-shadow-report');
const ROOT = path.resolve(__dirname, '..');
const FETCH = 'scripts/fetch-nse-quarters.js';
const STORE = path.join(ROOT, 'external-data/exchange-quarters/in.json');
const VIRTUAL = path.join(__dirname, '.virtual-nse', 'in.json');
const DIR = path.join(__dirname, 'fixtures/nse-quarters');
const manifest = require('./fixtures/nse-quarters/manifest.json');
const originalList = JSON.parse(fs.readFileSync(path.join(DIR, manifest.lists.LUPIN), 'utf8'));
const current = originalList.data.find(r => r.seq_Id === '209216');
const currentXml = fs.readFileSync(path.join(DIR, manifest.filings[current.seq_Id]), 'utf8');
const digest = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const protectedFiles = [STORE, FETCH, 'lib/nse-quarters.js', 'scripts/nse-shadow-report.js',
  'lib/exchange-quarter-check.js', 'lib/g31-recency.js'].map(f => path.resolve(ROOT, f));
let hashes;
beforeEach(() => { hashes = protectedFiles.map(digest); });
afterEach(() => assert.deepEqual(protectedFiles.map(digest), hashes, 'Live bytes changed'));

function copy(relative, mutation, overrides = {}) {
  const file = path.join(ROOT, relative);
  let source = fs.readFileSync(file, 'utf8');
  if (mutation) {
    const [needle, transform] = mutation;
    const lines = source.split('\n'), hits = lines.map((l, i) => l.includes(needle) ? i : -1).filter(i => i >= 0);
    assert.equal(hits.length, 1, 'Mutation must match exactly one whole line: ' + needle);
    lines[hits[0]] = transform(lines[hits[0]]);
    source = lines.join('\n');
  }
  const m = new Module(file, module);
  m.filename = file; m.paths = Module._nodeModulePaths(path.dirname(file));
  const actual = Module.createRequire(file);
  m.require = name => Object.hasOwn(overrides, name) ? overrides[name] : actual(name);
  m._compile(source, file);
  return m.exports;
}

function fixture({ mutation, stocks = ['A', 'B', 'C', 'D', 'E', 'F'].map(t => ({ ticker: t + '.NS' })),
  seed = null, adapter = A, nse = N, concurrent = false } = {}) {
  assert.notEqual(path.resolve(VIRTUAL), path.resolve(STORE));
  let bytes = seed ? JSON.stringify(seed) : null, reads = 0, writes = 0;
  const fakeFs = { ...fs, readFileSync(file) {
    assert.equal(path.resolve(file), path.resolve(VIRTUAL), 'Virtual reads must stay at the explicit test path');
    reads++;
    if (concurrent && reads === 2) bytes = JSON.stringify({ ...JSON.parse(bytes), concurrent: true });
    if (bytes === null) { const e = new Error('absent'); e.code = 'ENOENT'; throw e; }
    return bytes;
  } };
  const f = copy(FETCH, mutation, {
    'node:fs': fakeFs, './build-inannual': adapter, '../lib/nse-quarters': nse,
    '../lib/watchlist-fs': { loadWatchlist: () => ({ stocks, shape: 'stocks' }) },
    '../lib/fetch-retry': { fetchBuffer: () => { throw new Error('NETWORK FORBIDDEN'); } },
    '../lib/atomic-write': { writeFileAtomic(file, value) {
      assert.notEqual(path.resolve(file), path.resolve(STORE)); assert.equal(file, VIRTUAL);
      assert.ok(!mutation, 'Mutants may never write, even to the virtual filesystem');
      bytes = value; writes++;
    } },
  });
  return { f, get bytes() { return bytes; }, get writes() { return writes; },
    run: opts => f.main({ out: VIRTUAL, asOf: '2026-11-12', now: '2026-11-12T14:00:00Z',
      pause: 0, log() {}, ...opts }) };
}

function network({ failAt = [], failData = false, response, cookies = true } = {}) {
  const calls = [];
  return { calls, fetchBuffer: async (url, opts) => {
    calls.push({ url, opts });
    assert.equal(opts.pauseMs, 1500); assert.equal(opts.versuche, 1);
    if (failAt.includes(calls.length) || (failData && /\/api\/|\/corporate\//.test(url))) {
      const e = new Error('socket hang up'); e.code = 'ECONNRESET'; throw e;
    }
    if (!/\/api\/|\/corporate\//.test(url)) return { body: Buffer.from('html'),
      headers: cookies ? { 'set-cookie': ['bm_sz=session' + calls.length + '; Path=/'] } : {} };
    return response ? response(url, opts) : { body: Buffer.from('{"data":[],"totalCount":0}'), headers: {} };
  } };
}
async function brokenOnce(mutation, check, options = {}) {
  await check(fixture(options));
  await assert.rejects(() => check(fixture({ ...options, mutation })), assert.AssertionError);
  await check(fixture(options));
}

test('three consecutive source failures stop, save partial evidence, stay pending and restart first; break-once', async () => {
  const check = async f => {
    const net = network({ failData: true });
    const result = await f.run({ ...net, dryRun: true });
    assert.equal(result.ok, false);
    assert.equal(net.calls.filter(c => c.url.includes('/api/')).length, 3);
    assert.equal(result.run.recoveries.length, 1);
    assert.deepEqual(result.run.attempted, []);
    assert.deepEqual(result.run.pending.map(s => s.split(':')[0]), ['A.NS', 'B.NS']);
  };
  await brokenOnce(['if (sourceFailures >= 3) { run.issues.push', l => l.replace('sourceFailures >= 3', 'false')], check);
  const first = fixture(), net = network({ failData: true });
  const failed = await first.run(net);
  assert.equal(first.writes, 1); assert.deepEqual(JSON.parse(first.bytes), failed.store);
  const next = network();
  await first.run({ ...next, symbols: 1, now: '2026-11-12T15:00:00Z' });
  assert.match(next.calls[2].url, /symbol=A&/);
});

test('one ECONNRESET rewarms once, retries only that URL with fresh cookies and counts every call', async () => {
  const net = network({ failAt: [3] });
  const r = await fixture().run({ ...net, symbols: 2 });
  assert.equal(r.ok, true); assert.equal(r.run.calls, 7); assert.equal(r.run.recoveries.length, 1);
  assert.equal(net.calls[2].url, net.calls[5].url);
  assert.match(net.calls[5].opts.headers.Cookie, /session5/);
  assert.deepEqual(r.run.attempted, ['A.NS', 'B.NS']); assert.deepEqual(r.run.pending, []);
  const counts = new Map();
  for (const { url } of net.calls) counts.set(url, (counts.get(url) || 0) + 1);
  assert.deepEqual([...counts.values()].sort(), [1, 2, 2, 2]);
});

test('recovery call cap remains hard at both warm-up pages and the retry', async () => {
  for (const cap of [3, 4, 5]) {
    const net = network({ failAt: [3] });
    const r = await fixture().run({ ...net, cap });
    assert.equal(net.calls.length, cap); assert.equal(r.run.calls, cap);
    assert.deepEqual(r.run.attempted, []); assert.match(r.run.pending[0], /^A.NS: Abruflimit/);
  }
});

test('a source failure during rewarm counts and is never retried recursively', async () => {
  const net = network({ failAt: [3, 4, 5] });
  const r = await fixture().run(net);
  assert.equal(r.run.calls, 5); assert.equal(r.run.recoveries.length, 1);
  assert.equal(r.ok, false); assert.deepEqual(r.run.attempted, []);
  assert.equal(r.run.pending.length, 2); assert.match(r.run.issues.at(-1), /dreimal/);
});

test('successful quarters survive a later source outage and are reused on resume', async () => {
  const stocks = [{ ticker: 'LUPIN.NS' }, { ticker: 'Z.NS' }];
  const net = network({ failAt: [5, 8], response: url => ({ body: Buffer.from(url.includes('/api/')
    ? JSON.stringify({ data: [current], totalCount: 1 }) : currentXml), headers: {} }) });
  const f = fixture({ stocks });
  const r = await f.run(net);
  assert.equal(r.run.read.length, 1); assert.deepEqual(r.run.attempted, ['LUPIN.NS']);
  assert.equal(r.store.companies['LUPIN.NS'].quarterly['2026-09-30'][0].revenue, 78272600000);
  assert.match(r.run.pending[0], /^Z.NS:/); assert.equal(f.writes, 1);
  const next = network({ response: url => ({ body: Buffer.from(JSON.stringify(url.includes('symbol=LUPIN&')
    ? { data: [current], totalCount: 1 } : { data: [], totalCount: 0 })), headers: {} }) });
  const resumed = await f.run({ ...next, now: '2026-11-12T15:00:00Z' });
  assert.match(next.calls[2].url, /symbol=Z&/);
  assert.ok(!next.calls.some(c => c.url.includes('/corporate/')));
  N.assertStore(r.store, resumed.store);
});

test('failed file stays pending even after a successful list; oldest attempt wins within pending', async () => {
  const stocks = [{ ticker: 'LUPIN.NS' }, { ticker: 'AAA.NS' }];
  const seed = N.emptyStore(N.listingMap(stocks));
  seed.sources.old = { fetchedAt: '2026-11-10T00:00:00Z', attempted: ['AAA.NS'] };
  const first = fixture({ stocks, seed });
  const net = network({ failAt: [4, 7], response: url => ({ body: Buffer.from(url.includes('/api/')
    ? JSON.stringify({ data: [current], totalCount: 1 }) : currentXml), headers: {} }) });
  const r = await first.run({ ...net, symbols: 1 });
  assert.equal(r.run.read.length, 0); assert.deepEqual(r.run.attempted, []);
  assert.match(r.run.pending[0], /^LUPIN.NS:/);
  const next = network(); await first.run({ ...next, symbols: 1, now: '2026-11-12T15:00:00Z' });
  assert.match(next.calls[2].url, /symbol=LUPIN&/);
  const ordered = N.emptyStore(N.listingMap(stocks));
  ordered.sources.a = { fetchedAt: '2026-11-09T00:00:00Z', attempted: ['LUPIN.NS'] };
  ordered.sources.b = { fetchedAt: '2026-11-10T00:00:00Z', attempted: ['AAA.NS'] };
  ordered.sources.c = { fetchedAt: '2026-11-11T00:00:00Z', pending: ['AAA.NS: timeout', 'LUPIN.NS: timeout'] };
  const retry = network(); await fixture({ stocks, seed: ordered }).run({ ...retry, symbols: 1 });
  assert.match(retry.calls[2].url, /symbol=LUPIN&/);
});

test('legacy throttled and formerly rejected Revision tickers regain priority without rewriting history', async () => {
  for (const message of ['ECONNRESET', 'Unbekannte Meldungsfassung']) {
    const seed = N.emptyStore(N.listingMap([{ ticker: 'A.NS' }, { ticker: 'Z.NS' }]));
    seed.sources.old = { fetchedAt: '2026-11-12T12:00:00Z', attempted: ['Z.NS'], issues: ['Z.NS: ' + message] };
    const original = JSON.stringify(seed.sources), net = network();
    const r = await fixture({ seed, stocks: [{ ticker: 'A.NS' }, { ticker: 'Z.NS' }] }).run({ ...net, symbols: 1 });
    assert.match(net.calls[2].url, /symbol=Z&/); assert.equal(JSON.stringify({ old: r.store.sources.old }), original);
  }
});

test('successful lists reset the consecutive failure counter; later failures do not rewarm again', async () => {
  const net = network({ failAt: [3, 6, 8, 10] });
  const r = await fixture().run(net);
  assert.equal(r.run.recoveries.length, 1); assert.equal(r.run.calls, 11);
  assert.deepEqual(r.run.attempted, ['B.NS', 'D.NS', 'F.NS']);
  assert.equal(r.run.pending.length, 3); assert.ok(!r.run.issues.some(s => s.includes('dreimal')));
});

test('API cookies update the next API request but never leak to the archive host', async () => {
  const net = network({ response: url => ({ body: Buffer.from(url.includes('/api/')
    ? JSON.stringify({ data: [current], totalCount: 1 }) : currentXml), headers: { 'set-cookie': ['bm_sz=api-new; Path=/'] } }) });
  const f = fixture({ stocks: [{ ticker: 'LUPIN.NS' }, { ticker: 'Z.NS' }] });
  await f.run(net);
  assert.equal(net.calls[3].url, current.xbrl); assert.equal(net.calls[3].opts.headers.Cookie, undefined);
  assert.match(net.calls[4].opts.headers.Cookie, /bm_sz=api-new/);
});

test('cookie age stops before the next request; break-once', async () => {
  const adapter = { ...A, neuerJar: () => ({ ...A.neuerJar(), alterMs: () => A.JAR_MAX_ALTER_MS + 1 }) };
  await brokenOnce(['if (jar.alterMs() > A.JAR_MAX_ALTER_MS)', l => l.replace('jar.alterMs() > A.JAR_MAX_ALTER_MS', 'false')], async f => {
    const net = network(), r = await f.run({ ...net, dryRun: true });
    assert.equal(net.calls.length, 2); assert.match(r.run.pending[0], /Cookie-Sitzung/);
    assert.deepEqual(r.run.attempted, []);
  }, { adapter });
});

test('host allowlist blocks foreign, non-HTTPS, credentialed and port URLs before fetching; break-once', async () => {
  for (const url of ['https://example.com/', 'http://nsearchives.nseindia.com/a', 'https://u@www.nseindia.com/', 'https://www.nseindia.com:444/']) {
    const adapter = { ...A, aufwaermen: (_jar, request) => request(url) };
    await brokenOnce(["throw new Error('Host nicht erlaubt')", () => '    // Test mutant: allow every host.'], async f => {
      const net = network(), r = await f.run({ ...net, dryRun: true });
      assert.equal(net.calls.length, 0); assert.equal(r.ok, false); assert.match(r.run.issues[0], /Host nicht erlaubt/);
    }, { adapter });
  }
});

test('pre-write compare-and-swap rejects a concurrently changed store; break-once', async () => {
  await brokenOnce(["if (JSON.stringify(loadStore(out))", () => '  // Test mutant: no concurrency check.'], async f => {
    await assert.rejects(f.run({ ...network(), dryRun: true }), /waehrend des Laufs/);
    assert.equal(f.writes, 0);
  }, { seed: N.emptyStore(), concurrent: true });
});

test('pre-write assertStore rejects lost provenance; break-once', async () => {
  const seed = N.emptyStore(); seed.sources.receipt = { fetchedAt: '2026-11-11T00:00:00Z' };
  const nse = { ...N, extendAliases(s, mapping) { N.extendAliases(s, mapping); delete s.sources.receipt; } };
  await brokenOnce(['  N.assertStore(before, store);', () => '  // Test mutant: no append-only validation.'], async f => {
    await assert.rejects(f.run({ ...network(), dryRun: true }), /source|Quelle/i);
    assert.equal(f.writes, 0);
  }, { seed, nse });
});

test('exactly one pair hole is required, with positive and negative controls; break-once', () => {
  const check = report => {
    for (const holes of [0, 1, 2]) {
      const rows = ['2026-09-30', '2025-09-30', '2026-06-30'].map((periodEnd, i) => ({ periodEnd,
        category: i < holes ? 'nse-only' : 'agree', nseINR: 1, yahooUSD: i < holes ? null : 1 }));
      assert.equal(report.pairStatus(rows, '2026-09-30', '2025-09-30').wouldFillBeforeGlobalGate, holes === 1);
    }
  };
  check(R);
  assert.throws(() => check(copy('scripts/nse-shadow-report.js', ['wouldFillBeforeGlobalGate: available', l => l.replace('holes === 1', 'true')])), assert.AssertionError);
  check(R);
});

test('future quarter is excluded before inspecting unpublished filing metadata; break-once', () => {
  const check = nse => {
    assert.equal(nse.selectFilings([current], 'LUPIN', '2026-11-12').length, 1);
    assert.doesNotThrow(() => assert.deepEqual(nse.selectFilings([{ ...current, qe_Date: '31-DEC-2026', type_Sub: 'Unknown' }], 'LUPIN', '2026-11-12'), []));
  };
  check(N);
  assert.throws(() => check(copy('lib/nse-quarters.js', ['if (end > asOf) continue;', () => '    // Test mutant: future period accepted.'])), assert.AssertionError);
  check(N);
});

test('default is twelve firms with a configurable 2000 ms pause, independent of the 1500 ms host floor', async () => {
  const stocks = Array.from({ length: 14 }, (_, i) => ({ ticker: 'S' + String(i).padStart(2, '0') + '.NS' }));
  for (const pause of [undefined, 2500]) {
    const delays = [], f = fixture({ stocks });
    const r = await f.run({ ...network(), pause, sleep: async ms => delays.push(ms) });
    assert.equal(r.run.attempted.length, 12); assert.deepEqual(delays, Array(11).fill(pause ?? 2000));
  }
  assert.deepEqual(fixture().f.cli(['--pause=2500']), { pause: '2500' });
  for (const pause of [-1, 60001, 'NaN']) await assert.rejects(fixture().run({ pause }), /Firmenpause/);
});

test('shadow boundary permits only the two tools and smoke workflow; injected scoring reader turns red', () => {
  const sources = new Map();
  const walk = dir => {
    for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const file = dir ? dir + '/' + e.name : e.name;
      if (e.isDirectory()) walk(file);
      else if (/\.(js|yml|yaml)$/.test(file) && !/test/.test(e.name)) sources.set(file, fs.readFileSync(path.join(ROOT, file), 'utf8'));
    }
  };
  for (const dir of ['lib', 'src', 'scripts', 'methods', '.github/workflows']) walk(dir);
  for (const e of fs.readdirSync(ROOT, { withFileTypes: true })) if (e.isFile() && e.name.endsWith('.js') && !/test/.test(e.name)) sources.set(e.name, fs.readFileSync(path.join(ROOT, e.name), 'utf8'));
  const guard = files => {
    const allowed = new Set([FETCH, 'scripts/nse-shadow-report.js', '.github/workflows/nse-quarters.yml']);
    for (const [file, source] of files) if (/nse-quarters|nse-shadow-report|exchange-quarters[/\\]in\.json/.test(source)
      || (/exchange-quarters/.test(source) && /['"]in\.json['"]/.test(source))) assert.ok(allowed.has(file), 'Unexpected NSE shadow reader: ' + file);
  };
  guard(sources);
  const broken = new Map(sources); broken.set('src/scoring/injected.js', "require('../../lib/nse-quarters');");
  assert.throws(() => guard(broken), /Unexpected NSE shadow reader/); guard(sources);
  const paths = [], dir = path.dirname(VIRTUAL);
  const exchange = copy('lib/exchange-quarter-check.js', null, { fs: { ...fs, readFileSync(file, ...args) {
    if (path.dirname(file) !== dir) return fs.readFileSync(file, ...args);
    paths.push(path.basename(file)); const e = new Error('virtual absent store'); e.code = 'ENOENT'; throw e;
  } } });
  exchange.loadStores(dir);
  assert.deepEqual(paths, ['cn.json', 'tw.json'], 'Dynamic production loader must not read the India store');
});

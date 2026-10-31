'use strict';
// P280 guard (22.10.2026): the form4 cache never loses a row without archiving it first.
// Run standalone: node tests/p280-form4-archive.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { spawnSync } = require('node:child_process');

const A = require('../lib/form4-cache-archive.js');
const F4 = require('../scripts/pull-insider-form4.js');
const daily = require('../scripts/pull-insider-form4-daily.js');

const DAY = 86400000;
const NOW = Date.parse('2026-10-22T12:00:00Z');
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
const rel = { isDirector: true, isOfficer: false, isTenPercentOwner: false, isOther: false, officerTitle: null };
const row = (acc, ageDays, extra = {}) => Object.assign({
  transactionDate: iso(NOW - ageDays * DAY), transactionCode: 'S', acquiredDisposed: 'D',
  transactionShares: 100, transactionPricePerShare: 10, sharesOwnedFollowingTransaction: 900,
  reportingPersonName: 'Doe, Jane', reportingPersonRelationship: rel,
  owners: [{ name: 'Doe, Jane', relationship: rel }], issuerTradingSymbol: 'AAA',
  periodOfReport: iso(NOW - ageDays * DAY), isTenB5One: false, accessionNumber: acc,
  filingDate: iso(NOW - ageDays * DAY)
}, extra);
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'p280-'));
const archived = (dir) => A.readArchive(A.archiveFileFor(dir, NOW));
const has = (lines, ticker, r) =>
  lines.some(l => l.ticker === ticker && JSON.stringify(l.row) === JSON.stringify(r));

test('P280 guard: every row that leaves the cache is in the archive, with identical content', () => {
  const dir = tmp();
  const fresh = row('A-fresh', 10);
  const old = row('A-old', 200);
  const quiet = row('B-old', 300, { issuerTradingSymbol: 'BBB' });
  const purged = row('C-purged', 20, { issuerTradingSymbol: 'CCC' });
  const byTicker = {
    AAA: { ticker: 'AAA', transactions: [fresh, old] },
    BBB: { ticker: 'BBB', transactions: [quiet] },          // quiet ticker: no new filing at all
    CCC: { ticker: 'CCC', transactions: [purged] },
  };
  const baseline = A.snapshotRows(byTicker);
  byTicker.CCC.transactions = [];                           // e.g. a 4/A purge
  const res = A.archiveThenCap({ byTicker, baseline, archiveDir: dir, lookbackDays: 180, now: NOW });
  const lines = archived(dir);
  for (const [t, r] of [['AAA', old], ['BBB', quiet], ['CCC', purged]]) {
    assert.ok(has(lines, t, r), 'pruned row ' + r.accessionNumber + ' is missing from the archive');
  }
  assert.deepEqual(byTicker.AAA.transactions, [fresh], 'the fresh row stays in the cache');
  assert.deepEqual(byTicker.BBB.transactions, [], 'the 180-day cap applies to quiet tickers too');
  assert.equal(res.expired, 2);
  assert.equal(res.dropped, 1);
  assert.deepEqual(lines.map(l => l.reason).sort(), ['dropped', 'expired', 'expired']);
});

test('P280 guard: archive failure throws and prunes nothing', () => {
  const dir = tmp();
  const blocker = path.join(dir, 'not-a-dir');
  fs.writeFileSync(blocker, 'x');                            // archiveDir is a file -> write fails
  const old = row('A-old', 200);
  const byTicker = { AAA: { transactions: [old] } };
  assert.throws(() => A.archiveThenCap({ byTicker, baseline: A.snapshotRows(byTicker),
    archiveDir: blocker, lookbackDays: 180, now: NOW }));
  assert.deepEqual(byTicker.AAA.transactions, [old], 'no row may be removed when the archive failed');
});

test('P280 guard: the archive is append-only and does not duplicate rows', () => {
  const dir = tmp();
  const r1 = row('A-1', 200);
  const r2 = row('A-2', 250);
  const run = (rows) => A.archiveThenCap({ byTicker: { AAA: { transactions: rows } },
    baseline: new Map(), archiveDir: dir, lookbackDays: 180, now: NOW });
  run([r1]);
  const file = A.archiveFileFor(dir, NOW);
  const before = fs.readFileSync(file);
  run([r1, r2]);
  const after = fs.readFileSync(file);
  assert.ok(after.subarray(0, before.length).equals(before), 'old archive bytes must stay untouched');
  assert.deepEqual(archived(dir).map(l => l.row.accessionNumber), ['A-1', 'A-2'], 'r1 must not be archived twice');
  assert.equal(path.basename(file), '2026-10.json.gz');
});

test('P280: compacted cache rows expand to the exact original rows', () => {
  const joint = [{ name: 'Doe, Jane', relationship: rel }, { name: 'Doe, John', relationship: rel }];
  const rows = [
    row('dup-owner-and-symbol', 5),
    row('joint', 5, { owners: joint }),
    row('other-symbol', 5, { issuerTradingSymbol: 'aaa' }),
    row('null-symbol', 5, { issuerTradingSymbol: null }),
  ];
  const noOwners = row('no-owners', 5);
  delete noOwners.owners;
  const noSymbol = row('no-symbol', 5);
  delete noSymbol.issuerTradingSymbol;
  rows.push(noOwners, noSymbol);
  const cache = { lookbackDays: 180, byTicker: { AAA: { ticker: 'AAA', transactions: rows } } };
  const text = A.serializeCache(cache);
  const first = JSON.parse(text).byTicker.AAA.transactions[0];
  assert.equal(first._c, 'os', 'duplicated owners and symbol are dropped from the first row');
  assert.ok(!('owners' in first) && !('issuerTradingSymbol' in first));
  assert.deepEqual(A.expandCache(JSON.parse(text)).byTicker.AAA.transactions, rows);
  const p = path.join(tmp(), 'cache.json');
  fs.writeFileSync(p, text);
  assert.deepEqual(F4.ladeForm4Cache(p).byTicker.AAA.transactions, rows, 'the shared loader expands');
});

test('P280: daily mergeTransactions no longer drops rows silently', () => {
  const byTicker = { AAA: { transactions: [row('A-old', 400)] } };
  const added = daily.mergeTransactions(byTicker, 'AAA', '0000000001', 'A', [row('A-late', 300)]);
  assert.equal(added, 1, 'a late filing with an old date is kept for the archive step');
  assert.equal(byTicker.AAA.transactions.length, 2, 'merge itself prunes nothing');
});

test('P280: per-ticker main archives replaced and expired rows before it writes the capped cache', async () => {
  const dir = tmp();
  const cachePath = path.join(dir, 'sec-form4-cache.json');
  const now = Date.now();
  const at = (d) => new Date(now - d * DAY).toISOString().slice(0, 10);
  const dated = (r, d) => Object.assign(r, { transactionDate: at(d), filingDate: at(d), periodOfReport: at(d) });
  const keepRow = dated(row('K', 0), 5);
  const goneRow = dated(row('G', 0), 30);
  const oldRow = dated(row('O', 0, { issuerTradingSymbol: 'QQQ' }), 250);
  const existing = { byTicker: {
    AAA: { ticker: 'AAA', fetchedAt: null, transactions: [keepRow, goneRow] },
    QQQ: { ticker: 'QQQ', fetchedAt: new Date(now).toISOString(), transactions: [oldRow] },
  } };
  const res = await F4.main({
    externalDir: dir, cachePath, sampleLimit: null, existing,
    watchlist: { stocks: [{ ticker: 'AAA' }, { ticker: 'QQQ' }] },
    tickerCikMap: { AAA: { cik: '0000000001', name: 'A' }, QQQ: { cik: '0000000002', name: 'Q' } },
    pullTickerForm4: async () => ({ transactions: [JSON.parse(JSON.stringify(keepRow))], filingsScanned: 1 }),
    exit: (c) => { throw new Error('exit ' + c); },
  });
  assert.equal(res.fetched, 1);
  const lines = A.readArchive(A.archiveFileFor(path.join(dir, 'archive', 'sec-form4'), now));
  assert.ok(has(lines, 'AAA', goneRow), 'row replaced by the re-pull must be archived');
  assert.ok(has(lines, 'QQQ', oldRow), 'expired row of a skipped (fresh) ticker must be archived');
  assert.ok(!has(lines, 'AAA', keepRow), 'a row that is still in the cache is not archived');
  const written = F4.ladeForm4Cache(cachePath);
  assert.deepEqual(written.byTicker.QQQ.transactions, []);
  assert.deepEqual(written.byTicker.AAA.transactions, [keepRow]);
  assert.ok(fs.readFileSync(cachePath, 'utf8').includes('"_c":"os"'), 'cache file is written compacted');
});

test('P280: the prep-state artifact carries the archive folder next to the cache', () => {
  const wf = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'daily-pull.yml'), 'utf8');
  assert.match(wf, /^ {12}external-data\/sec-form4-cache\.json\r?\n {12}external-data\/archive\/sec-form4\/\r?$/m,
    'without the archive in prep-state the merge job commits a trimmed cache and loses the archived rows');
});

test('P280: the daily writer archives before it writes', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'pull-insider-form4-daily.js'), 'utf8');
  const body = src.slice(src.indexOf('function writeCache('), src.indexOf('async function main('));
  const a = body.search(/^ {2}const arch = archiveThenCap\(\{ byTicker, baseline: cacheBaseline, archiveDir: FORM4_ARCHIVE_DIR,$/m);
  const w = body.search(/^ {2}writeFileAtomic\(FORM4_CACHE_PATH, serializeCache\(\{$/m);
  assert.ok(a >= 0 && w > a, 'writeCache must call archiveThenCap before writeFileAtomic');
});

test('P280 guard: a row loaded from disk equals the same row freshly parsed (key order ignored)', async () => {
  const dir = tmp();
  const cachePath = path.join(dir, 'sec-form4-cache.json');
  const now = Date.now();
  const at = (d) => new Date(now - d * DAY).toISOString().slice(0, 10);
  const dated = (r, d) => Object.assign(r, { transactionDate: at(d), filingDate: at(d), periodOfReport: at(d) });
  // row() builds the parser key order: owners and issuerTradingSymbol sit in the middle.
  const parsed = [dated(row('X-1', 0), 5), dated(row('X-2', 0), 9)];
  fs.writeFileSync(cachePath, A.serializeCache({ byTicker: {
    AAA: { ticker: 'AAA', fetchedAt: null, transactions: parsed } } }));
  const loaded = F4.ladeForm4Cache(cachePath).byTicker.AAA.transactions[0];
  assert.notEqual(Object.keys(loaded).join(), Object.keys(parsed[0]).join(), 'fixture must differ in key order');
  await F4.main({
    externalDir: dir, cachePath, sampleLimit: null,
    watchlist: { stocks: [{ ticker: 'AAA' }] },
    tickerCikMap: { AAA: { cik: '0000000001', name: 'A' } },
    pullTickerForm4: async () => ({ transactions: structuredClone(parsed), filingsScanned: 1 }),
    exit: (c) => { throw new Error('exit ' + c); },
  });
  const lines = A.readArchive(A.archiveFileFor(path.join(dir, 'archive', 'sec-form4'), now));
  assert.deepEqual(lines.map(l => l.reason + ':' + l.row.accessionNumber), [],
    'an unchanged re-pulled row must not be archived as dropped');
  assert.deepEqual(F4.ladeForm4Cache(cachePath).byTicker.AAA.transactions, parsed);
});

test('P280 guard: archive dedupe ignores key order', () => {
  const dir = tmp();
  const r = row('A-1', 200);
  const reordered = Object.fromEntries(Object.entries(r).reverse());
  const run = (x) => A.archiveThenCap({ byTicker: { AAA: { transactions: [x] } },
    baseline: new Map(), archiveDir: dir, lookbackDays: 180, now: NOW });
  run(r);
  run(reordered);
  assert.equal(archived(dir).length, 1, 'the same row in another key order is archived once');
});

test('P280 guard: the daily writer archives a 4/A-purged row before it writes the cache', async () => {
  const { loadDaily } = require('./helpers/form4-daily-harness');
  const old = row('0000000001-26-000001', 0, { transactionDate: '2026-09-01', filingDate: '2026-09-02',
    periodOfReport: '2026-09-01', transactionShares: 100 });
  const h = loadDaily({
    now: '2026-09-26T07:00:00Z', cursor: '20260924', formType: '4/A',
    byTicker: { AAA: { ticker: 'AAA', cik: '0000000001', name: 'Fixture issuer', transactions: [old] } },
    parse: () => [Object.assign(structuredClone(old), { transactionShares: 120 })],
  });
  const result = await h.run();
  assert.equal(result.exit, 0);
  const lines = A.readArchive(A.archiveFileFor(h.archiveDir, Date.parse('2026-09-26T07:00:00Z')));
  assert.ok(lines.some(l => l.reason === 'dropped' && l.ticker === 'AAA' &&
    A.canon(l.row) === A.canon(old)), 'the row purged by the 4/A must be in the archive as dropped');
  assert.equal(h.order[0], 'archive', 'the archive is written before the first cache write');
  assert.ok(h.order.includes('cache'));
  const cached = A.expandCache(result.writes.at(-1)).byTicker.AAA.transactions;
  assert.deepEqual(cached.map(t => t.transactionShares), [120], 'the cache holds only the amended row');
});

test('P280 review: the per-ticker puller checkpoints every 50 processed tickers and once at the end', async () => {
  const dir = tmp();
  const tickers = Array.from({ length: 51 }, (_, i) => 'T' + String(i + 1).padStart(2, '0'));
  const writes = [];
  await F4.main({
    externalDir: dir, cachePath: path.join(dir, 'sec-form4-cache.json'), archiveDir: path.join(dir, 'archive'),
    sampleLimit: null, existing: { byTicker: {} },
    watchlist: { stocks: tickers.map(ticker => ({ ticker })) },
    tickerCikMap: Object.fromEntries(tickers.map((t, i) => [t, { cik: String(i + 1).padStart(10, '0'), name: t }])),
    pullTickerForm4: async () => ({ transactions: [], filingsScanned: 0 }),
    writeFileAtomic: (p, body) => writes.push(Object.keys(JSON.parse(body).byTicker).length),
    exit: (c) => { throw new Error('exit ' + c); },
  });
  assert.deepEqual(writes, [50, 51], 'one checkpoint after ticker 50, one after the loop');
});

test('P280 guard: a damaged archive fails loud, prunes nothing and starts no fresh file', () => {
  const line = JSON.stringify({ archivedAt: 'x', reason: 'expired', ticker: 'AAA', row: row('A-1', 200) }) + '\n';
  const good = zlib.gzipSync(Buffer.from(line));
  const damaged = {
    empty: Buffer.alloc(0),
    garbage: Buffer.from('not gzip at all'),
    truncated: good.subarray(0, good.length - 6),
    garbageAfterMember: Buffer.concat([good, Buffer.from('xxxx')]),
    badJsonLine: zlib.gzipSync(Buffer.from('{"ticker":"AAA"\n')),
  };
  for (const [name, bytes] of Object.entries(damaged)) {
    const dir = tmp();
    const file = A.archiveFileFor(dir, NOW);
    fs.writeFileSync(file, bytes);
    const old = row('A-new', 200);
    const byTicker = { AAA: { transactions: [old] } };
    assert.throws(() => A.archiveThenCap({ byTicker, baseline: A.snapshotRows(byTicker), archiveDir: dir,
      lookbackDays: 180, now: NOW }), undefined, name + ': a damaged archive must throw');
    assert.deepEqual(byTicker.AAA.transactions, [old], name + ': no row may leave the cache');
    assert.ok(fs.readFileSync(file).equals(bytes), name + ': the damaged file keeps its bytes');
  }
});

test('P280 guard: rows behind a zero-padded tail are unreadable, so the read-back refuses the prune', () => {
  // gunzip silently ignores whatever follows a member when it starts with 0x00. A row
  // appended behind such a tail is on disk but not restorable; it must not leave the cache.
  const dir = tmp();
  const file = A.archiveFileFor(dir, NOW);
  const line = JSON.stringify({ archivedAt: 'x', reason: 'expired', ticker: 'AAA', row: row('A-1', 200) }) + '\n';
  const bytes = Buffer.concat([zlib.gzipSync(Buffer.from(line)), Buffer.alloc(8)]);
  fs.writeFileSync(file, bytes);
  const old = row('A-new', 200);
  const byTicker = { AAA: { transactions: [old] } };
  assert.throws(() => A.archiveThenCap({ byTicker, baseline: A.snapshotRows(byTicker), archiveDir: dir,
    lookbackDays: 180, now: NOW }), /not restorable/);
  assert.deepEqual(byTicker.AAA.transactions, [old]);
  assert.ok(fs.readFileSync(file).subarray(0, bytes.length).equals(bytes), 'the old bytes stay in front');
});

test('P280 guard: a new month opens a new file and leaves the old month byte-identical', () => {
  const dir = tmp();
  const run = (r, now) => A.archiveThenCap({ byTicker: { AAA: { transactions: [r] } }, baseline: new Map(),
    archiveDir: dir, lookbackDays: 180, now });
  run(row('A-oct', 200), NOW);
  const oct = A.archiveFileFor(dir, NOW);
  const before = fs.readFileSync(oct);
  const NOV = Date.parse('2026-11-01T08:00:00Z');
  run(row('A-nov', 250), NOV);
  assert.equal(path.basename(A.archiveFileFor(dir, NOV)), '2026-11.json.gz');
  assert.ok(fs.readFileSync(oct).equals(before), 'the closed month is never rewritten');
  assert.deepEqual(A.readArchive(A.archiveFileFor(dir, NOV)).map(l => l.row.accessionNumber), ['A-nov']);
});

test('P280 guard: what the prep job archives reaches main (one writer, merge downloads and stages it, not ignored)', () => {
  const root = path.join(__dirname, '..');
  const wfDir = path.join(root, '.github', 'workflows');
  const wf = fs.readFileSync(path.join(wfDir, 'daily-pull.yml'), 'utf8');
  const job = (name, next) => wf.slice(wf.search(new RegExp('^  ' + name + ':\\r?$', 'm')),
    wf.search(new RegExp('^  ' + next + ':\\r?$', 'm')));
  const prep = job('prep', 'entdeckungs-waechter');
  const merge = job('merge', 'earnings-transport-waechter');

  // A second writer (a shard, another workflow) would need its own archive path to main.
  const writers = fs.readdirSync(wfDir).filter(f => /\.ya?ml$/.test(f)).flatMap(f =>
    fs.readFileSync(path.join(wfDir, f), 'utf8').match(/^.*node scripts\/pull-insider-form4[^\s]*.*$/gm) || []);
  assert.equal(writers.length, 1, 'exactly one workflow step may run a form4 writer: ' + writers.join(' | '));
  assert.ok(prep.includes(writers[0]), 'the form4 writer must run in the prep job');
  assert.ok(prep.indexOf('name: Pull Insider Form-4 (daily)') < prep.indexOf('name: prep-state'),
    'prep-state must be uploaded after the writer ran');

  assert.match(merge, /^ {6}- name: Download prep state\r?\n.*\r?\n {8}with:\r?\n {10}name: prep-state\r?\n {10}path: \.\r?$/m,
    'the merge job must restore prep-state at the repo root');
  const commit = merge.slice(merge.indexOf('- name: Commit Snapshots'));
  assert.match(commit.slice(0, commit.indexOf('\n      - name:', 1)), /^ {10}git add -A\r?$/m,
    'a narrower git add would lose the archive without any error');

  // A never-tracked month on purpose: check-ignore skips tracked files, and each new month
  // starts as an untracked file, so an ignore rule would only hit it from that day on.
  const ignored = spawnSync('git', ['check-ignore', '-q', '--no-index', 'external-data/archive/sec-form4/2099-12.json.gz'], { cwd: root });
  assert.equal(ignored.status, 1, 'the archive path must not be ignored (exit 1 = not ignored)');
});

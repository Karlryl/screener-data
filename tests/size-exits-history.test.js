'use strict';
// All I/O is virtual. Mutations target source in memory, never live files or writing tests.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), crypto = require('node:crypto');
const ROOT = path.resolve(__dirname, '..');
const targets = ['lib/size-exits.js', 'scripts/filter-snapshot-merge.js'];
const sources = targets.map(f => fs.readFileSync(path.join(ROOT, f), 'utf8'));
const hashes = () => targets.map(f => crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, f))).digest('hex'));
const before = hashes();
const virtual = path.join(ROOT, '_scratch', 'size-exits-history-virtual');
const historyPath = path.join(virtual, 'history.json');
const incoming = path.join(virtual, 'incoming'), output = path.join(virtual, 'output');
const now = Date.parse('2026-10-08T12:00:00Z'), day = 86400000;
class FixedDate extends Date { static now() { return now; } }
const plain = value => JSON.parse(JSON.stringify(value));
const record = (ticker, age = 0, cap = 1) => ({ ticker, marketCapUsd: cap, floorUsd: 8e8,
  date: new Date(now - age * day).toISOString().slice(0, 10), source: 'full-pull' });
const history = exits => JSON.stringify({ schema: 'size-exits-history/v1', exits });

function check(libSource, mergeSource) {
  const files = new Map(), writes = [], reads = [];
  let readError;
  const guard = p => assert(path.resolve(p).startsWith(virtual + path.sep), 'I/O must never reach the live history');
  const io = {
    readFileSync(p) { guard(p); reads.push(p); if (readError) throw readError;
      if (!files.has(p)) throw Object.assign(new Error('missing'), { code: 'ENOENT' }); return files.get(p); },
    mkdirSync(p) { assert(p === virtual || p.startsWith(virtual + path.sep)); },
    copyFileSync(from, to) { guard(from); guard(to); files.set(to, files.get(from)); },
    writeFileSync() { assert.fail('History must use the atomic-write helper'); },
  };
  const atomic = (p, raw) => { guard(p); writes.push(p); files.set(p, raw); };
  const module = { exports: {} };
  vm.runInNewContext(libSource, { module, __dirname: path.join(ROOT, 'lib'), Date: FixedDate, console,
    require(id) { if (id === 'fs') return io; if (id === 'path') return path;
      if (id === './atomic-write.js') return { writeFileAtomic: atomic }; assert.fail('Unexpected import ' + id); } });
  const h = module.exports;
  assert.equal(h.SIZE_EXITS_HISTORY_FILE, 'state/size-exits-history.json');
  assert.equal(h.sizeExitsHistoryPath(), path.join(ROOT, h.SIZE_EXITS_HISTORY_FILE));
  assert.equal(h.sizeExitsHistoryPath(['--size-exits-history', historyPath]), historyPath);
  assert.throws(() => h.sizeExitsHistoryPath(['--size-exits-history']), /path/);
  assert.throws(() => h.sizeExitsHistoryPath(['--size-exits-history', '--ziel']), /path/);
  assert.equal(h.sizeExitRunDay({ RUN_DATE_UTC: '2026-10-07' }, () => now), '2026-10-07');
  assert.equal(h.sizeExitRunDay({ RUN_DATE_UTC: 'yesterday' }, () => now), '2026-10-08');
  assert.equal(h.sizeExitRunDay({}, () => Date.parse('2026-10-09T00:00:00Z')), '2026-10-09');
  assert.deepEqual(plain(h.readSizeExitHistory(historyPath)), { exits: [], raw: null });
  readError = Object.assign(new Error('denied'), { code: 'EACCES' });
  assert.throws(() => h.readSizeExitHistory(historyPath), /denied/); readError = null;
  for (const raw of ['{broken', JSON.stringify({ schema: 'wrong', exits: [] }), '[]', 'null',
    JSON.stringify({ schema: 'size-exits-history/v1', exits: null }),
    history([{ ...record('BAD'), marketCapUsd: 8e8 }]), history([{ ...record('BAD'), date: '2026-02-30' }]),
    history([{ ...record('BAD'), date: '2026-10-08T00:00:00Z' }]), history([{ ...record('BAD'), extra: true }])]) {
    files.set(historyPath, raw);
    assert.throws(() => h.updateSizeExitHistory([], '2026-10-08', { historyPath }), /./);
    assert.equal(files.get(historyPath), raw, 'invalid history is never overwritten');
    assert.equal(writes.length, 0, 'invalid history never reaches the writer');
  }
  const old = record('REEXIT', 10), latest = record('REEXIT', 1, 2), today = record('REEXIT', 1, 3);
  assert.deepEqual(plain(h.mergeSizeExitHistory([latest], [old], '2026-10-08')), [latest], 'later date wins');
  assert.deepEqual(plain(h.mergeSizeExitHistory([latest], [today], '2026-10-08')), [today], 'today wins equal dates');
  assert.deepEqual(plain(h.mergeSizeExitHistory([old], [latest], '2026-10-08')), [latest], 'ticker re-exit replaces its older exit');
  const retained = [record('BOUNDARY', 90), record('A', 2), record('Z', 2), today];
  assert.deepEqual(plain(h.mergeSizeExitHistory([record('Z', 2), record('DROP', 91), old, record('BOUNDARY', 90)],
    [today, record('A', 2)], '2026-10-08')), retained, 'inclusive cap and date/ticker order');
  files.set(historyPath, history([old]));
  assert.deepEqual(plain(h.updateSizeExitHistory([latest], '2026-10-08', { historyPath })), [latest]);
  assert.deepEqual(writes, [historyPath], 'existing atomic helper is used exactly once');
  const saved = files.get(historyPath);
  assert.equal(saved, history([latest]), 'exact clock-free history schema');
  h.updateSizeExitHistory([], '2026-10-09', { historyPath });
  assert.equal(files.get(historyPath), saved, 'a day without exits keeps identical bytes');
  assert.deepEqual(writes, [historyPath], 'unchanged history is not rewritten');

  const start = mergeSource.indexOf('  const sizeExitTag = sizeExitRunTag(process.env);');
  const end = mergeSource.indexOf('  // DAS EINZIGE LOCH', start);
  assert(start >= 0 && end > start, 'real merge block anchors');
  const block = '{\n' + mergeSource.slice(start, end) + '\n}';
  const report = '_manifest-size-exits.shard-0.run-123456-2.json';
  const manifestPath = path.join(output, h.SIZE_EXITS_FILE);
  const logs = [];
  const ctx = { ...h, fs: io, path, console: { log: s => logs.push(s) }, writeFileAtomic: atomic,
    argv: ['node', 'filter-snapshot-merge.js', '--size-exits-history', historyPath],
    process: { env: { GITHUB_RUN_ID: '123456', GITHUB_RUN_ATTEMPT: '2', RUN_DATE_UTC: '2026-10-08' } },
    eingang: incoming, ziel: output, files: [report, 'AAPL.json'], uebernehmen: [report, 'AAPL.json'] };
  files.set(path.join(incoming, report), JSON.stringify({ sizeExits: [record('NEW')] }));
  files.set(path.join(incoming, 'AAPL.json'), '{"snapshot":"unchanged"}');
  vm.runInNewContext(block, ctx);
  const expected = { schema: 'size-exits/v2', known: true, runDate: '2026-10-08', exits: [latest, record('NEW')] };
  assert.deepEqual(JSON.parse(files.get(manifestPath)), expected);
  assert.deepEqual(plain(h.validateSizeExitManifest(JSON.parse(files.get(manifestPath)))), expected, 'consumer validates the real producer output');
  assert.equal(files.get(historyPath), history(expected.exits), 'merge actually persists the injected history');
  assert.equal(files.get(path.join(output, 'AAPL.json')), files.get(path.join(incoming, 'AAPL.json')));
  assert(!files.has(path.join(output, report)), 'shard report is not copied');
  const historyWrites = writes.filter(p => p === historyPath).length;
  for (const overrides of [{ files: [], uebernehmen: [] }, { process: { env: { RUN_DATE_UTC: '2026-10-08' } } }]) {
    vm.runInNewContext(block, { ...ctx, ...overrides });
    assert.deepEqual(JSON.parse(files.get(manifestPath)), { ...expected, known: false }, 'unknown run retains remembered exits');
  }
  assert.equal(writes.filter(p => p === historyPath).length, historyWrites, 'unknown run does not rewrite unchanged history');
  files.set(path.join(incoming, report), '{"sizeExits":[]}');
  vm.runInNewContext(block, ctx);
  assert.equal(JSON.parse(files.get(manifestPath)).known, true, 'an empty completed report is known');
  const aged = [record('Z', 91), record('A', 90)];
  const noncanonical = JSON.stringify({ schema: 'size-exits-history/v1', exits: aged }, null, 2) + '\n';
  files.set(historyPath, noncanonical);
  const beforeUnknown = writes.filter(p => p === historyPath).length;
  for (const overrides of [{ files: [], uebernehmen: [] }, { process: { env: { RUN_DATE_UTC: '2026-10-08' } } }]) {
    vm.runInNewContext(block, { ...ctx, ...overrides });
    assert.equal(files.get(historyPath), noncanonical, 'unknown runs must not age, sort or rewrite history');
    assert.deepEqual(JSON.parse(files.get(manifestPath)), { ...expected, known: false, exits: aged });
  }
  assert.equal(writes.filter(p => p === historyPath).length, beforeUnknown);
  vm.runInNewContext(block, ctx);
  assert.deepEqual(JSON.parse(files.get(historyPath)).exits, [record('A', 90)], 'a known empty run applies the cap');
  files.delete(historyPath);
  const beforeMissing = writes.filter(p => p === historyPath).length;
  vm.runInNewContext(block, { ...ctx, files: [], uebernehmen: [] });
  assert(!files.has(historyPath), 'unknown run without history must not seed it');
  assert.equal(writes.filter(p => p === historyPath).length, beforeMissing);
  assert.deepEqual(JSON.parse(files.get(manifestPath)).exits, []);
  files.set(path.join(incoming, report), '{broken');
  const preCorruptWrites = writes.length;
  assert.throws(() => vm.runInNewContext(block, ctx), /JSON|Unexpected|position|property/i);
  assert.equal(writes.length, preCorruptWrites, 'corrupt shard fails before history or manifest writes');
  for (const invalid of [[], {}, { ...expected, schema: 'wrong' }, { ...expected, known: 0 },
    { ...expected, runDate: '2026-02-30' }, { ...expected, exits: null }]) {
    assert.throws(() => h.validateSizeExitManifest(invalid), /size-exits\/v2/);
  }
  assert(reads.every(p => p.startsWith(virtual + path.sep)));
}

check(...sources);
console.log('PASS history: read/validation, later and equal dates, re-exit, 90/91 days, deterministic bytes, no rewrite and atomic helper');
console.log('PASS real merge block: injected history option, v2 known/unknown, runDate, clock fallback and remembered exits');
if (process.argv.includes('--break-once')) {
  const mutations = [
    ['missing', 0, "  catch (e) { if (e.code === 'ENOENT') return { exits: [], raw: null }; throw e; }", '  catch (e) { throw e; }'],
    ['corrupt', 0, '  const history = JSON.parse(raw);', "  const history = { schema: 'size-exits-history/v1', exits: [] };"],
    ['schema', 0, "  if (!history || history.schema !== 'size-exits-history/v1') throw new TypeError('Invalid size-exits-history/v1 history');", '  // mutant: accept any history schema'],
    ['invalid-record', 0, '    return buildSizeExit(r.ticker, r.marketCapUsd, r.floorUsd, r.date, r.source);', '    return r;'],
    ['later-date', 0, '    if (!previous || r.date >= previous.date) records.set(r.ticker, r);', '    records.set(r.ticker, r);'],
    ['equal-date', 0, '    if (!previous || r.date >= previous.date) records.set(r.ticker, r);', '    if (!previous || r.date > previous.date) records.set(r.ticker, r);'],
    ['re-exit', 0, '    if (!previous || r.date >= previous.date) records.set(r.ticker, r);', '    if (!previous) records.set(r.ticker, r);'],
    ['day90', 0, '  return [...records.values()].filter(r => Date.parse(runDate) - Date.parse(r.date) <= 90 * DAY_MS)', '  return [...records.values()].filter(r => Date.parse(runDate) - Date.parse(r.date) < 90 * DAY_MS)'],
    ['day91', 0, '  return [...records.values()].filter(r => Date.parse(runDate) - Date.parse(r.date) <= 90 * DAY_MS)', '  return [...records.values()].filter(r => Date.parse(runDate) - Date.parse(r.date) <= 91 * DAY_MS)'],
    ['sort', 0, '    .sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : a.ticker < b.ticker ? -1 : a.ticker > b.ticker ? 1 : 0);', '    .sort(() => 0);'],
    ['no-rewrite', 0, '  if (raw !== previous.raw) {', '  if (true) {'],
    ['atomic', 0, '    (options.writeFileAtomic || writeFileAtomic)(historyPath, raw);', '    io.writeFileSync(historyPath, raw);'],
    ['option', 0, '  return path.resolve(argv[i + 1]);', "  return path.resolve(__dirname, '..', SIZE_EXITS_HISTORY_FILE);"],
    ['run-day', 1, '  const runDate = sizeExitRunDay(process.env);', "  const runDate = '2026-10-01';"],
    ['manifest', 1, "  writeFileAtomic(path.join(ziel, SIZE_EXITS_FILE), JSON.stringify({ schema: 'size-exits/v2', known, runDate, exits }));", '  writeFileAtomic(path.join(ziel, SIZE_EXITS_FILE), JSON.stringify(exits));'],
    ['known-false', 1, '  const known = Boolean(sizeExitTag && sizeExitFiles.length);', '  const known = false;'],
    ['known-true', 1, '  const known = Boolean(sizeExitTag && sizeExitFiles.length);', '  const known = true;'],
    ['unknown-history', 1, '    : readSizeExitHistory(historyPath, fs).exits;', '    : updateSizeExitHistory(sizeExits, runDate, { historyPath, fs, writeFileAtomic });'],
  ];
  for (const [name, index, from, to] of mutations) {
    const copy = sources.slice(), lines = copy[index].split(/\r?\n/);
    assert.equal(lines.filter(l => l === from).length, 1, 'whole-line anchor ' + name);
    copy[index] = lines.map(l => l === from ? to : l).join('\n');
    // Missing-file mutants may throw the deliberate fixture error rather than an assertion.
    assert.throws(() => check(...copy), /AssertionError|missing/);
    assert.deepEqual(hashes(), before, 'live sources unchanged after ' + name);
    console.log('BREAK_ONCE history ' + name + ' detected=true liveHashesUnchanged=true');
  }
}
assert.deepEqual(hashes(), before);
console.log('size-exits-history.test.js: all passed; diskWrites=0 networkCalls=0');

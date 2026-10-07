'use strict';
// tests/exchange-check-report.test.js — standalone runner (exit 0/1). Tag 1403 (G2b): the shadow report reads a
// snapshot dir, the scoring outputs and the store, writes only --out, lists every would-withhold board row, the
// 16 + 5 check and the H-share twins; inputs stay byte-identical. Temp fixtures only.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { Module, createRequire } = require('node:module');
const F = require('./fixtures/exchange-quarter-check.json');
const reportLib = require('../scripts/exchange-check-report.js');

const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0, breaks = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + (e && e.stack || e)); }
}
const write = (f, j) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(j)); };
const tree = d => fs.readdirSync(d, { recursive: true }).filter(f => fs.statSync(path.join(d, f)).isFile()).sort()
  .map(f => [f, crypto.createHash('sha256').update(fs.readFileSync(path.join(d, f))).digest('hex')]);

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xq-report-'));
assert.notEqual(path.resolve(root), ROOT);
const snaps = path.join(root, 'snapshots'), outputs = path.join(root, 'outputs'), store = path.join(root, 'store'), bh = path.join(root, 'board-history');
const tickers = Object.keys(F.snapshots);
for (const t of tickers) write(path.join(snaps, t + '.json'), F.snapshots[t]);
write(path.join(snaps, '_manifest.json'), { pulled_at: '2026-10-03T09:24:24.454Z' });
// An H-share twin of 000002.SZ: same CNY quarters, own listing.
const twin = structuredClone(F.snapshots['000002.SZ']); twin.meta.ticker = '2202.HK';
write(path.join(snaps, '2202.HK.json'), twin);
// Exported lists (findash-export/v1): 000599.SZ only on a quality board, 6949.TW only on the full list (and in
// excluded.json, which is not a ranked list), 1101.TW on no list.
const v1 = path.join(outputs, 'findash-export', 'v1');
const ranked = ts => ts.map((ticker, i) => ({ rank: i + 1, ticker, score: 50 }));
const board = [...tickers.filter(t => !['1101.TW', '000599.SZ', '6949.TW'].includes(t)), '2202.HK'];
write(path.join(v1, 'real-estate.json'), { generated_at: '2026-10-03T09:31:17.057Z', profitable: ranked(board), unprofitable: [] });
write(path.join(v1, 'quality', 'real-estate.json'), { profitable: ranked(['000599.SZ']) });
write(path.join(v1, 'full', 'real-estate.json'), { profitable: ranked([...board, '000599.SZ', '6949.TW']), unprofitable: [] });
write(path.join(v1, 'excluded.json'), { rows: [{ ticker: '6949.TW' }] });
write(path.join(v1, 'rule40', 'overview.json'), { rows: [] });
write(path.join(store, 'cn.json'), F.store.cn); write(path.join(store, 'tw.json'), F.store.tw);
write(path.join(bh, F.baseline.date, 'real-estate.json'), { generated_at: '2026-07-29T09:38:18.526Z', cohort: { profitable: Object.entries(F.baseline.rows).map(([ticker, pit]) => ({ ticker, pit })), unprofitable: [] } });
const before = tree(root);
const out = path.join(root, 'report', 'exchange-check-shadow.json');
const run = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'exchange-check-report.js'), '--out', out, '--snapshots', snaps,
  '--outputs', outputs, '--store', store, '--board-history', bh, '--must-withhold', F.mustWithhold.filter(t => t !== '000688.SZ').join(',')], { encoding: 'utf8', timeout: 120000 });
const R = run.status === 0 ? JSON.parse(fs.readFileSync(out, 'utf8')) : null;

test('runs, writes only --out, inputs byte-identical', () => {
  assert.equal(run.status, 0, run.stderr);
  const after = tree(root).filter(([f]) => !f.startsWith('report'));
  assert.deepEqual(after, before);
  assert.equal(R.schema, 'exchange-check-shadow/v1'); assert.equal(R.mode, 'shadow'); assert.equal(R.committedMode, 'fill-only');
  assert.equal(R.inputs.baselineDate, F.baseline.date); assert.deepEqual(R.warnings, []);
});
test('the 16 wrong board rows and the 5 risers: 21/21 would-withhold, none unchecked', () => {
  assert.equal(R.mustWithholdPass, '20/20'); // P138: 000688.SZ is corrected by the hand table now, so 20 of the 21 stay in the must-withhold list
  assert.ok(R.mustWithhold.every(x => x.pass && x.category !== 'unchecked' && x.onBoard));
});
test('census: every would-withhold board row is listed with pairs, values and reader effects', () => {
  const held = R.boardRows.filter(r => r.category.startsWith('would-withhold'));
  const n = Object.entries(R.counts.board).filter(([k]) => k.startsWith('would-withhold')).reduce((s, [, c]) => s + c, 0);
  assert.equal(held.length, n);
  for (const r of held) {
    assert.ok(r.withhold.length && r.pairs.some(p => p.status === 'mixed'), r.ticker);
    assert.ok(r.effects.growth.before && r.effects.growth.after && r.effects.lamps, r.ticker);
    assert.ok(['real-estate', 'quality/real-estate'].includes(r.boards[0].board) && r.boards[0].rank > 0);
  }
  const fill = R.boardRows.find(r => r.ticker === '000002.SZ');
  assert.equal(fill.category, 'would-fill');
  assert.equal(fill.effects.growth.before.basis, 'year'); assert.equal(fill.effects.growth.after.basis, 'quarter');
  assert.ok(R.counts['board:broker'] && R.counts['board:CN'] && R.counts['board:TW'], 'per stratum and market');
  assert.equal(R.gapBlockedBoardRows.wouldFill, R.boardRows.filter(r => r.category === 'would-fill').length);
});
test('census: every would-* row of every exported list (quality board, full list) and of the cohort is listed', () => {
  const q = R.boardRows.find(r => r.ticker === '000599.SZ');
  assert.deepEqual(q.boards, [{ board: 'quality/real-estate', track: 'profitable', rank: 1, position: 1 }]);
  assert.ok(!R.boardRows.some(r => r.ticker === '6949.TW'), 'full list and excluded.json are not boards');
  const would = Object.entries(R.counts.all).filter(([k]) => k.startsWith('would-')).reduce((s, [, c]) => s + c, 0);
  assert.equal(R.census.length, would);
  assert.ok(R.census.every(r => r.category.startsWith('would-') && r.effects && r.effects.growth), 'effects on every census row');
  const off = R.census.find(r => r.ticker === '6949.TW');
  assert.equal(off.category, 'would-fill'); assert.equal(off.onBoard, false); assert.equal(off.fullRank.board, 'full/real-estate');
  assert.ok(R.census.find(r => r.ticker === '000599.SZ').onBoard);
});
test('H-share twins of a checked A-share are counted, not guarded', () => {
  assert.deepEqual(R.twins.map(x => [x.ticker, x.twinOf]), [['2202.HK', '000002.SZ']]);
  assert.ok(!R.boardRows.some(r => r.ticker === '2202.HK'));
});
test('missing store: rows unchecked plus a warning, exit 0', () => {
  const empty = path.join(root, 'nostore'); fs.mkdirSync(empty);
  const o2 = path.join(root, 'report', 'nostore.json');
  const r2 = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'exchange-check-report.js'), '--out', o2, '--snapshots', snaps,
    '--outputs', outputs, '--store', empty, '--board-history', bh], { encoding: 'utf8', timeout: 120000 });
  assert.equal(r2.status, 0, r2.stderr);
  const j = JSON.parse(fs.readFileSync(o2, 'utf8'));
  assert.equal(j.warnings.length, 2);
  assert.ok(Object.keys(j.counts.board).every(k => k === 'unchecked(store-missing)'));
});

test('store older than the limit: rows unchecked(store-old) plus one warning, exit 0', () => {
  const old = path.join(root, 'oldstore'), o3 = path.join(root, 'report', 'oldstore.json');
  for (const k of ['cn', 'tw']) {
    const st = structuredClone(F.store[k]);
    for (const src of Object.values(st.sources)) src.fetchedAt = '2026-01-01T00:00:00.000Z';
    for (const c of Object.values(st.companies)) for (const list of Object.values(c.ytd || c.seasons)) for (const o of list) for (const x of o.confirmedBy) x.fetchedAt = '2026-01-01T00:00:00.000Z';
    write(path.join(old, k + '.json'), st);
  }
  const r3 = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'exchange-check-report.js'), '--out', o3, '--snapshots', snaps,
    '--outputs', outputs, '--store', old, '--board-history', bh], { encoding: 'utf8', timeout: 120000 });
  assert.equal(r3.status, 0, r3.stderr);
  const j = JSON.parse(fs.readFileSync(o3, 'utf8'));
  assert.ok(Object.keys(j.counts.board).every(k => k === 'unchecked(store-old)'), JSON.stringify(j.counts.board));
  assert.equal(j.warnings.filter(w => /store-old/.test(w)).length, 1, JSON.stringify(j.warnings));
});

test('fill-only CLI: measured counts, every board membership, growth legs, input hashes and exact reconciliation', () => {
  const md = path.join(root, 'report', 'fill-only.md'), csv = md.replace(/\.md$/, '.csv');
  const inputBefore = [snaps, outputs, store, bh].map(tree);
  const result = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'exchange-check-report.js'), '--mode', 'fill-only',
    '--out', md, '--reference', out, '--snapshots', snaps, '--outputs', outputs, '--store', store, '--board-history', bh],
    { encoding: 'utf8', timeout: 120000 });
  assert.equal(result.status, 0, result.stderr);
  const summary = JSON.parse(result.stdout.split('\n').find(s => s.startsWith('[exchange-fill-only] ')).slice('[exchange-fill-only] '.length));
  const expected = R.census.filter(r => r.category === 'would-fill');
  assert.equal(summary.counts.all.filled, expected.length);
  assert.equal(summary.counts.board.filled, expected.filter(r => r.onBoard).length);
  assert.equal(summary.counts.all.rows, tickers.length + 1, 'includes the H-share outside CN/TW');
  for (const k of ['all', 'board']) {
    assert.equal(summary.counts[k].withheld, 0); assert.equal(summary.counts[k].otherChanged, 0);
  }
  assert.deepEqual(summary.differences, []);
  assert.deepEqual([snaps, outputs, store, bh].map(tree), inputBefore);
  const text = fs.readFileSync(md, 'utf8');
  assert.ok(text.startsWith('> **Auf einen Blick**'));
  assert.ok(text.includes('Exportdateien erzeugt von 2026-10-03T09:31:17.057Z bis 2026-10-03T09:31:17.057Z'));
  assert.ok(text.includes(crypto.createHash('sha256').update(fs.readFileSync(out)).digest('hex')));
  assert.ok(text.includes(path.join(bh, F.baseline.date, 'real-estate.json')));
  const lines = fs.readFileSync(csv, 'utf8').trimEnd().split('\n');
  const values = lines.slice(1).map(line => line.match(/"(?:[^"]|"")*"/g).map(s => s.slice(1, -1).replace(/""/g, '"')));
  assert.equal(values.length, expected.reduce((n, r) => n + r.boards.length, 0));
  for (const r of values) {
    assert.equal(r.length, 22);
    const source = expected.find(e => e.ticker === r[0]);
    assert.ok(source.boards.some(b => b.board === r[2] && (b.track || '') === r[3]));
    assert.equal(r[4], '2025-09-30'); assert.equal(Number(r[5]).toFixed(4), source.fill.nativeValue.toFixed(4));
    assert.equal(r[9], source.fill.source); assert.ok(r[11]);
    for (const [offset, leg] of [[14, source.effects.growth.before], [18, source.effects.growth.after]]) {
      assert.equal(r[offset], String(leg.pct ?? '')); assert.equal(r[offset + 1], leg.basis);
      assert.equal(r[offset + 2], leg.periodEnd || ''); assert.equal(r[offset + 3], leg.priorPeriodEnd || '');
    }
  }
});

const reportFile = path.join(ROOT, 'scripts', 'exchange-check-report.js');
const reportHash = crypto.createHash('sha256').update(fs.readFileSync(reportFile)).digest('hex');
function reportCopy(oldLine, newLine, overrides = {}) {
  const source = fs.readFileSync(reportFile, 'utf8'), lines = source.split(/\r?\n/);
  assert.equal(lines.filter(l => l === oldLine).length, 1, 'exact whole-line anchor');
  const m = new Module(reportFile, module), real = createRequire(reportFile);
  m.filename = reportFile; m.paths = module.paths;
  m.require = id => Object.hasOwn(overrides, id) ? overrides[id] : real(id);
  m._compile(lines.map(l => l === oldLine ? newLine : l).join('\n') + '\nmodule.exports.run = main;', reportFile);
  return m.exports;
}
test('cell measurement detects fills, withheld numbers and unrelated changes; all counters broken once in memory', () => {
  const check = lib => {
    const a = structuredClone(F.snapshots['000002.SZ']), b = structuredClone(a);
    const k = a.timeseries.revenueQEnds.indexOf('2025-09-30');
    b.timeseries.revenueQ[k] = { value: 123, exchangeFill: { source: 'test' } };
    assert.deepEqual(lib.cellChanges(a, b), { filled: 1, withheld: 0, otherChanged: 0 });
    b.timeseries.revenueQ[0].value = null;
    assert.deepEqual(lib.cellChanges(a, b), { filled: 1, withheld: 1, otherChanged: 0 });
    b.meta.reportingCurrency = 'EUR';
    b.annual.annualRev[0].value += 1;
    b.timeseries.revenueQ[1].unit = 'wrong';
    assert.deepEqual(lib.cellChanges(a, b), { filled: 1, withheld: 1, otherChanged: 3 });
    assert.deepEqual(lib.cellChanges(a, a), { filled: 0, withheld: 0, otherChanged: 0 });
  };
  check(reportLib);
  for (const [oldLine, newLine] of [
    ["        a.get(key) == null && Number.isFinite(b.get(key))) out.filled++;", "        a.get(key) == null && Number.isFinite(b.get(key))) out.filled += 0;"],
    ['    else if (Number.isFinite(a.get(key)) && b.get(key) == null) out.withheld++;', '    else if (Number.isFinite(a.get(key)) && b.get(key) == null) out.withheld += 0;'],
    ['    else out.otherChanged++;', '    else out.otherChanged += 0;']
  ]) { assert.throws(() => check(reportCopy(oldLine, newLine)), assert.AssertionError); check(reportLib); breaks++; }
});
test('report preparation leaves out the committed exchange step; missing bypass turns red in memory', () => {
  const oldLine = "const beforeExchange = raw => X.applyExchangeCheck(prepareSnapshot(X.stripOwn(raw), { atPull: true }), { mode: 'off' }).snapshot;";
  const overrides = { '../lib/yahoo-q4-known-cases.js': { prepareSnapshot: (s, o = {}) => {
    assert.equal(o.atPull, true, 'default exchange context must never be used by the report'); return s;
  } } };
  const check = lib => assert.doesNotThrow(() => lib.beforeExchange(F.snapshots['000002.SZ']));
  check(reportCopy(oldLine, oldLine, overrides));
  assert.throws(() => check(reportCopy(oldLine,
    "const beforeExchange = raw => X.applyExchangeCheck(prepareSnapshot(X.stripOwn(raw)), { mode: 'off' }).snapshot;", overrides)), assert.AssertionError);
  breaks++;
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(reportFile)).digest('hex'), reportHash);
});

test('export date excludes the historical baseline; the original date-mixing bug turns red in a memory copy', () => {
  const oldLine = "    const value = JSON.parse(bytes.toString('utf8'));";
  const broken = reportCopy(oldLine, oldLine + '\n    if (value?.generated_at) exportDates.add(value.generated_at);');
  const md = path.join(root, 'report', 'broken-date.md');
  assert.notEqual(path.dirname(md), path.join(ROOT, 'docs'), 'mutation output must stay in the temporary fixture');
  const argv = process.argv, log = console.log, inputBefore = [snaps, outputs, store, bh].map(tree);
  try {
    process.argv = [process.execPath, reportFile, '--mode', 'fill-only', '--out', md, '--reference', out,
      '--snapshots', snaps, '--outputs', outputs, '--store', store, '--board-history', bh];
    console.log = () => {};
    broken.run();
  } finally { process.argv = argv; console.log = log; }
  const check = text => assert.ok(text.includes('Exportdateien erzeugt von 2026-10-03T09:31:17.057Z bis 2026-10-03T09:31:17.057Z'));
  assert.throws(() => check(fs.readFileSync(md, 'utf8')), assert.AssertionError); breaks++;
  check(fs.readFileSync(path.join(root, 'report', 'fill-only.md'), 'utf8'));
  assert.deepEqual([snaps, outputs, store, bh].map(tree), inputBefore);
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(reportFile)).digest('hex'), reportHash);
});

console.log(`exchange-check-report: ${pass} passed, ${fail} failed, ${breaks} break-once red`);
process.exit(fail ? 1 : 0);

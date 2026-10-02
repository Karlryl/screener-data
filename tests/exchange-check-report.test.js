'use strict';
// tests/exchange-check-report.test.js — standalone runner (exit 0/1). Tag 1403 (G2b): the shadow report reads a
// snapshot dir, the scoring outputs and the store, writes only --out, lists every would-withhold board row, the
// 16 + 5 check and the H-share twins; inputs stay byte-identical. Temp fixtures only.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const F = require('./fixtures/exchange-quarter-check.json');

const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
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
// An H-share twin of 000002.SZ: same CNY quarters, own listing.
const twin = structuredClone(F.snapshots['000002.SZ']); twin.meta.ticker = '2202.HK';
write(path.join(snaps, '2202.HK.json'), twin);
// Exported lists (findash-export/v1): 000599.SZ only on a quality board, 6949.TW only on the full list (and in
// excluded.json, which is not a ranked list), 1101.TW on no list.
const v1 = path.join(outputs, 'findash-export', 'v1');
const ranked = ts => ts.map((ticker, i) => ({ rank: i + 1, ticker, score: 50 }));
const board = [...tickers.filter(t => !['1101.TW', '000599.SZ', '6949.TW'].includes(t)), '2202.HK'];
write(path.join(v1, 'real-estate.json'), { profitable: ranked(board), unprofitable: [] });
write(path.join(v1, 'quality', 'real-estate.json'), { profitable: ranked(['000599.SZ']) });
write(path.join(v1, 'full', 'real-estate.json'), { profitable: ranked([...board, '000599.SZ', '6949.TW']), unprofitable: [] });
write(path.join(v1, 'excluded.json'), { rows: [{ ticker: '6949.TW' }] });
write(path.join(v1, 'rule40', 'overview.json'), { rows: [] });
write(path.join(store, 'cn.json'), F.store.cn); write(path.join(store, 'tw.json'), F.store.tw);
write(path.join(bh, F.baseline.date, 'real-estate.json'), { cohort: { profitable: Object.entries(F.baseline.rows).map(([ticker, pit]) => ({ ticker, pit })), unprofitable: [] } });
const before = tree(root);
const out = path.join(root, 'report', 'exchange-check-shadow.json');
const run = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'exchange-check-report.js'), '--out', out, '--snapshots', snaps,
  '--outputs', outputs, '--store', store, '--board-history', bh, '--must-withhold', F.mustWithhold.join(',')], { encoding: 'utf8', timeout: 120000 });
const R = run.status === 0 ? JSON.parse(fs.readFileSync(out, 'utf8')) : null;

test('runs, writes only --out, inputs byte-identical', () => {
  assert.equal(run.status, 0, run.stderr);
  const after = tree(root).filter(([f]) => !f.startsWith('report'));
  assert.deepEqual(after, before);
  assert.equal(R.schema, 'exchange-check-shadow/v1'); assert.equal(R.mode, 'shadow'); assert.equal(R.committedMode, 'off');
  assert.equal(R.inputs.baselineDate, F.baseline.date); assert.deepEqual(R.warnings, []);
});
test('the 16 wrong board rows and the 5 risers: 21/21 would-withhold, none unchecked', () => {
  assert.equal(R.mustWithholdPass, '21/21');
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

console.log(`exchange-check-report: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

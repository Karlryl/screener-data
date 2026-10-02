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
const board = [...tickers.filter(t => t !== '1101.TW'), '2202.HK'];
write(path.join(outputs, 'hypergrowth', 'index.json'), { branches: ['real-estate'] });
const list = { profitable: board.map(ticker => ({ ticker, score: 50 })), unprofitable: [] };
write(path.join(outputs, 'hypergrowth', 'real-estate.json'), list);
write(path.join(outputs, 'hypergrowth', 'full', 'real-estate.json'), list);
write(path.join(outputs, 'hypergrowth', 'overview.json'), []);
write(path.join(outputs, 'findash-export', 'v1', 'rule40', 'overview.json'), { rows: [] });
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
    assert.ok(r.boards[0].board === 'real-estate' && r.boards[0].rank > 0);
  }
  const fill = R.boardRows.find(r => r.ticker === '000002.SZ');
  assert.equal(fill.category, 'would-fill');
  assert.equal(fill.effects.growth.before.basis, 'year'); assert.equal(fill.effects.growth.after.basis, 'quarter');
  assert.ok(R.counts['board:broker'] && R.counts['board:CN'] && R.counts['board:TW'], 'per stratum and market');
  assert.equal(R.gapBlockedBoardRows.wouldFill, R.boardRows.filter(r => r.category === 'would-fill').length);
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

console.log(`exchange-check-report: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

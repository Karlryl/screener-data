'use strict';
// S11 monthly quality meter: draw (scripts/qualitaetsmesser-ziehen.js) and aggregation (scripts/qualitaetsmesser-auswerten.js).
// Both scripts reproduced the baseline of 22.11.2026 byte for byte (sample.json sha256 445399e8..., ergebnis.json identical)
// on its saved export; this test pins the parts that keep later months comparable: the generator, the draw rules, and
// the "both rounds must agree" counting rule.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Z = require('../scripts/qualitaetsmesser-ziehen.js');
const A = require('../scripts/qualitaetsmesser-auswerten.js');

let passed = 0, failed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log('PASS ' + name); }
  catch (e) { failed++; console.error('FAIL ' + name + ': ' + (e.stack || e.message)); }
}

// Synthetic export: 2 HyperGrowth lists x 2 tracks x 25 rows (rank > 20 must never be drawn), 130 Rule of 40 rows
// (rank > 100 must never be drawn), 60 filter rows, overlapping tickers so the "a firm at most once" rule is exercised.
const hgRow = (t, i) => ({ ticker: t, name: 'N' + t, country: i % 3 ? 'United States' : 'China', revGrowthYoYPct: 10 + i, marketCap: 1e9 + i,
  overview: i % 2 ? { kind: 'gp', value: 0.1 * i, period: { basis: 'quarter', periodEnd: '2026-09-30' } } : { kind: 'rev', value: 1 } });
function pages(root, { hgRows = 25, r40Rows = 130, filterRows = 60 } = {}) {
  const v1 = path.join(root, 'outputs', 'findash-export', 'v1'), hg = path.join(root, 'outputs', 'hypergrowth');
  for (const d of [path.join(v1, 'rule40'), path.join(v1, 'filter'), hg]) fs.mkdirSync(d, { recursive: true });
  const w = (f, j) => fs.writeFileSync(f, JSON.stringify(j));
  for (const list of ['alpha', 'beta']) {
    const rows = track => Array.from({ length: hgRows }, (_, i) => hgRow(`${list}-${track}-${i}`, i));
    w(path.join(hg, list + '.json'), { profitable: rows('p'), unprofitable: rows('u') });
  }
  w(path.join(hg, 'index.json'), { profitable: [hgRow('NEVER-INDEX', 1), hgRow('NEVER-INDEX2', 3)] });
  w(path.join(v1, 'alpha.json'), { profitable: [{ ticker: 'alpha-p-1', revGrowthBasis: 'quarter', revGrowthPeriodEnd: '2026-09-30', revGrowthPriorPeriodEnd: '2025-09-30' }] });
  w(path.join(v1, 'index.json'), { generated_at: '2026-11-21T11:22:31.786Z' });
  w(path.join(v1, 'rule40', 'overview.json'), { rows: Array.from({ length: r40Rows }, (_, i) => ({ ticker: i < 5 ? `alpha-p-${i}` : 'r40-' + i, name: 'R' + i,
    country: 'Germany', rank: i + 1, revGrowthYoYPct: i, fcfMarginPct: i % 4 ? 5 : null, ebitdaMarginPct: 7 })) });
  w(path.join(v1, 'filter', 'universum.json'), { rows: Array.from({ length: filterRows }, (_, i) => ({ t: 'f-' + i, n: 'F' + i, c: 'Japan',
    g: i, g3: i % 2 ? 3 : null, gm: 40, pe: null, mc: 5e8, asOf: '2026-11-20', s: 'Tech', aus: [] })) });
  return root;
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qmesser-'));
const root = pages(path.join(tmp, 'ok'));

check('generator: mulberry32 with the baseline seed gives the pinned first values (changing it breaks month-to-month comparability)', () => {
  const R = Z.rng(20261122);
  assert.deepEqual([R(), R(), R()], [0.8369944463483989, 0.10530598578043282, 0.0031693943310528994]);
});

check('draw: 100 values, 50 firms, 34/34/32 per list, two different fields per firm, only visible ranks', () => {
  const s = Z.draw(Z.readPages(root), 20261122, '2026-11-21');
  assert.equal(s.length, 100);
  assert.deepEqual(s.map(x => x.id), Array.from({ length: 100 }, (_, i) => i + 1));
  const byFirm = new Map();
  for (const x of s) byFirm.set(x.ticker, [...(byFirm.get(x.ticker) || []), x]);
  assert.equal(byFirm.size, 50);
  for (const [t, xs] of byFirm) { assert.equal(xs.length, 2, t); assert.notEqual(xs[0].field, xs[1].field, t); }
  const count = p => s.filter(x => x.stratum.startsWith(p)).length;
  assert.deepEqual([count('HyperGrowth/'), count('Rule40/'), count('Filter')], [34, 34, 32]);
  for (const x of s.filter(x => x.stratum.startsWith('HyperGrowth/'))) {
    assert.ok(Number(x.ticker.split('-').at(-1)) < 20, 'HyperGrowth only from the visible top 20: ' + x.ticker);
    assert.ok(!x.ticker.startsWith('NEVER'), 'index lists are not a frame');
  }
  for (const x of s.filter(x => x.stratum.startsWith('Rule40/'))) assert.ok(Number(x.stratum.slice('Rule40/rank'.length)) <= 100, x.stratum);
  const mc = s.find(x => x.field === 'marketCapUSD');
  if (mc) assert.equal(mc.period.asOf, 'export 2026-11-21 (price of prior trading day)');
});

check('draw: same seed same sample, another seed another sample', () => {
  const input = Z.readPages(root);
  assert.deepEqual(Z.draw(input, 20261222, '2026-12-19'), Z.draw(input, 20261222, '2026-12-19'));
  assert.notDeepEqual(Z.draw(input, 20261222, '2026-12-19').map(x => x.ticker), Z.draw(input, 20261122, '2026-12-19').map(x => x.ticker));
});

check('draw: a frame with too few firms is refused instead of looping forever', () => {
  const small = Z.readPages(pages(path.join(tmp, 'small'), { filterRows: 10 }));
  assert.throws(() => Z.draw(small, 20261122, '2026-11-21'), /Filter: only 10 candidate firms, 16 needed/);
});

check('main: exit 2 without arguments, 1 on a missing export, 0 writes sample.json', () => {
  const err = console.error; console.error = () => {};
  try {
    assert.equal(Z.main([]), 2);
    assert.equal(Z.main(['--pages', path.join(tmp, 'nothing'), '--seed', '20261122', '--out', path.join(tmp, 'o1')]), 1);
  } finally { console.error = err; }
  const log = console.log; console.log = () => {};
  try { assert.equal(Z.main(['--pages', root, '--seed', '20261122', '--out', path.join(tmp, 'o2')]), 0); } finally { console.log = log; }
  assert.equal(JSON.parse(fs.readFileSync(path.join(tmp, 'o2', 'sample.json'), 'utf8')).length, 100);
});

check('count rule: an error only where both rounds see wrong or stale; disagreement and one-sided not_verifiable are disputed', () => {
  const cases = [
    ['correct', null, 'correct'], ['stale', null, 'stale'], ['wrong', 'wrong', 'wrong'], ['stale', 'stale', 'stale'],
    ['wrong', 'stale', 'wrong-or-stale'], ['stale', 'correct', 'disputed'], ['correct', 'wrong', 'disputed'],
    ['wrong', 'not_verifiable', 'disputed'], ['not_verifiable', 'not_verifiable', 'not_verifiable'], ['correct', 'correct', 'correct'],
  ];
  for (const [a, b, want] of cases) assert.equal(A.finalClass(a, b), want, `${a}/${b}`);
});

check('aggregate: disputed and not verifiable leave the denominator; Wilson as in the baseline (19 of 95: 13.2 to 29.1 %)', () => {
  const sample = Array.from({ length: 6 }, (_, i) => ({ id: i + 1, ticker: 'T' + i, field: 'f', stratum: 'Filter', country: 'United States' }));
  const r1 = ['wrong', 'stale', 'correct', 'stale', 'not_verifiable', 'correct'].map((classification, i) => ({ id: i + 1, classification }));
  const r2 = [{ id: 1, classification: 'wrong' }, { id: 2, classification: 'stale' }, { id: 4, classification: 'correct' }, { id: 3, classification: 'correct' }];
  const g = A.aggregate(sample, r1, r2).gesamt;
  assert.deepEqual([g.err, g.n, g.disputed, g.not_verifiable, g.rate], [2, 4, 1, 1, 50]);
  assert.deepEqual(A.wilson(19, 95).map(x => +x.toFixed(1)), [13.2, 29.1]);
});

check('aggregate: refuses an id outside the sample, an unknown class, a doubled id and a sample id round 1 never checked', () => {
  const sample = [{ id: 1, ticker: 'A', field: 'f', stratum: 'Filter', country: 'X' }, { id: 2, ticker: 'B', field: 'f', stratum: 'Filter', country: 'X' }];
  const ok = [{ id: 1, classification: 'correct' }, { id: 2, classification: 'correct' }];
  assert.throws(() => A.aggregate(sample, ok, [{ id: 3, classification: 'wrong' }]), /round 2: id 3 is not in the sample/);
  assert.throws(() => A.aggregate(sample, [ok[0], { id: 2, classification: 'falsch' }], []), /class "falsch"/);
  assert.throws(() => A.aggregate(sample, [...ok, ok[0]], []), /id 1 twice/);
  assert.throws(() => A.aggregate(sample, [ok[0]], []), /round 1 misses ids 2/);
});

check('readRound: files in numeric order (g10 after g2), other files ignored', () => {
  const d = path.join(tmp, 'rounds'); fs.mkdirSync(d);
  fs.writeFileSync(path.join(d, 'check-g10.json'), JSON.stringify([{ id: 10 }]));
  fs.writeFileSync(path.join(d, 'check-g2.json'), JSON.stringify([{ id: 2 }]));
  fs.writeFileSync(path.join(d, 'check-g2.json.bak'), JSON.stringify([{ id: 99 }]));
  assert.deepEqual(A.readRound(d, /^check-g(\d+)\.json$/).map(x => x.id), [2, 10]);
});

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`qualitaetsmesser: ${passed} passed, ${failed} failed`);
if (failed) process.exitCode = 1;

'use strict';
// W8 EX-01 (28.10.2026): index.json and smallcap/index.json carry profitSplit, an explicit boolean per board that
// says whether the board's formula splits its cohort into a profitable and an unprofitable track. It comes from the
// formula definition (splitMetric, the switch in src/scoring/score.js trackOf), never from row counts.
// Fixtures: the real index.json and smallcap/index.json of the export of 28.10.2026 (gh-pages, 09:51 UTC).
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const FIX = path.join(__dirname, 'fixtures', 'export-w8');
const W = require('../scripts/write-findash-export.js');
const formulas = require('../src/scoring/formulas');
const smallcapFormulas = require('../src/scoring/formulas/smallcap');

let passed = 0, failed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log('PASS ' + name); }
  catch (e) { failed++; console.error('FAIL ' + name + ': ' + e.message); }
}
const readFix = (f) => JSON.parse(fs.readFileSync(path.join(FIX, f), 'utf8'));
const NO_SPLIT = ['consumer-staples', 'it-services', 'materials', 'real-estate'];

check('S1 the four boards without a profit split are false, the nine others true', () => {
  const map = W.profitSplitMap(W.BRANCHES, formulas);
  assert.deepEqual(Object.keys(map), W.BRANCHES);
  for (const id of W.BRANCHES) assert.equal(map[id], !NO_SPLIT.includes(id), id);
});

check('S2 every value follows the formula definition, not a count', () => {
  const map = W.profitSplitMap(W.BRANCHES, formulas);
  for (const id of W.BRANCHES) assert.equal(map[id], ['FCF', 'OpInc', 'NetIncome'].includes(formulas[id].splitMetric), id);
  // A split board whose unprofitable track happens to be empty stays a split board: the map never reads rows.
  const idx = readFix('index.json');
  const emptyUnprofitable = W.BRANCHES.filter((id) => idx.counts[id].unprofitable === 0);
  assert.deepEqual([...emptyUnprofitable].sort(), [...NO_SPLIT].sort(), 'today exactly the four no-split boards have no unprofitable rows');
});

check('S3 a board without a formula gets null, never a guessed boolean', () => {
  assert.deepEqual(W.profitSplitMap(['real-estate', 'no-such-board'], formulas), { 'real-estate': false, 'no-such-board': null });
});

check('S4 buildIndex on the real index writes profitSplit as the last key and changes no other key', () => {
  const src = readFix('index.json');
  const out = W.buildIndex(src.coverage, src);
  const keys = Object.keys(out);
  assert.equal(keys.at(-1), 'profitSplit');
  assert.deepEqual(out.profitSplit, W.profitSplitMap(W.BRANCHES, formulas));
  for (const k of ['generatedFromSnapshots', 'branches', 'boardStatus', 'counts', 'survivalCount', 'excluded']) assert.deepEqual(out[k], src[k], k);
  const errs = [];
  W.validateFile(out, 'index', errs, { requireCohortCounts: true });
  assert.deepEqual(errs, []);
});

check('S5 buildSmallcapIndex keys profitSplit like boardStatus (smallcap-<sector>)', () => {
  const src = readFix('smallcap-index.json');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'w8-split-'));
  fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify(src));
  const out = W.buildSmallcapIndex(src.coverage, dir);
  assert.deepEqual(Object.keys(out.profitSplit), src.boards);
  assert.deepEqual(Object.keys(out.profitSplit), Object.keys(src.boardStatus));
  for (const b of src.boards) assert.equal(out.profitSplit[b], !NO_SPLIT.includes(b.replace(/^smallcap-/, '')), b);
  assert.equal(out.profitSplit['smallcap-real-estate'], false);
  assert.equal(Object.hasOwn(out.profitSplit, 'smallcap-tech-hardware'), false, 'no small-cap tech-hardware board exists');
  assert.equal(out.profitSplit['smallcap-utilities'], smallcapFormulas['smallcap-utilities'].splitMetric === 'OpInc');
  const errs = [];
  W.validateSmallcapIndex(out, errs);
  assert.deepEqual(errs, []);
});

check('S6 --check catches a flipped, a missing, an extra and a non-object profitSplit; absence stays legal', () => {
  const src = readFix('index.json');
  const good = W.buildIndex(src.coverage, src);
  const run = (mk) => { const errs = []; W.validateFile(mk, 'index', errs, {}); return errs; };
  assert.deepEqual(run(good), []);
  assert.match(run({ ...good, profitSplit: { ...good.profitSplit, 'real-estate': true } }).join(';'), /profitSplit\.real-estate=true, formula says false/);
  const missing = { ...good.profitSplit }; delete missing.materials;
  assert.match(run({ ...good, profitSplit: missing }).join(';'), /profitSplit\.materials=undefined/);
  assert.match(run({ ...good, profitSplit: { ...good.profitSplit, extra: true } }).join(';'), /profitSplit\.extra=true, formula says undefined/);
  assert.match(run({ ...good, profitSplit: [] }).join(';'), /profitSplit not an object/);
  const old = { ...good }; delete old.profitSplit;
  assert.deepEqual(run(old), [], 'an older export without the key still passes');
  const sc = readFix('smallcap-index.json');
  const errs = [];
  W.validateSmallcapIndex({ ...sc, profitSplit: { ...W.profitSplitMap(sc.boards, smallcapFormulas), 'smallcap-materials': true } }, errs);
  assert.match(errs.join(';'), /smallcap\/index: profitSplit\.smallcap-materials=true/);
});

console.log(`\nexport-w8-profit-split: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

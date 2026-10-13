'use strict';
/**
 * Batch w2-export — hermetische Checks fuer BH-078, BH-160, BH-180 (Audit-Welle 2).
 * Reine Regressions-Assertions gegen die bereits im Writer-Selftest bewiesene Logik; hier
 * NUR am Modul-Export gegengeprueft (kein CLI-Subprozess), damit ein spaeterer Refactor,
 * der --selftest umgeht, trotzdem sofort auffliegt.
 *
 * Usage:  node tests/scoring/bh-w2-export.test.js   (Exit 0/1)
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const wfe = require('../../scripts/write-findash-export.js');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); }
}

const mkIdx = (over = {}) => ({
  schema: wfe.SCHEMA, generated_at: 'x', coverage: null, generatedFromSnapshots: 1,
  branches: wfe.BRANCHES,
  boardStatus: Object.fromEntries(wfe.BRANCHES.map((b) => [b, 'core'])),
  counts: {}, survivalCount: 0, excluded: {}, ...over,
});
const mkQHull = (over = {}) => ({
  schema: wfe.SCHEMA, generated_at: 'x', boardStatus: 'diagnostic', coverage: null,
  branch: 'semiconductors', profitable: [], unprofitable: [], ...over,
});

// ---- BH-078: index.boardStatus map completeness (missing/extra key) --------------------------
test('BH-078: index boardStatus missing a branch key must trip', () => {
  const partial = Object.fromEntries(wfe.BRANCHES.slice(1).map((b) => [b, 'core']));
  const e = []; wfe.validateFile(mkIdx({ boardStatus: partial }), 'index', e);
  assert.ok(e.some((x) => /boardStatus missing key/.test(x)), JSON.stringify(e));
});
test('BH-078: index boardStatus with a stray extra key must trip', () => {
  const extra = { ...Object.fromEntries(wfe.BRANCHES.map((b) => [b, 'core'])), ghost: 'core' };
  const e = []; wfe.validateFile(mkIdx({ boardStatus: extra }), 'index', e);
  assert.ok(e.some((x) => /boardStatus unexpected key/.test(x)), JSON.stringify(e));
});
test('BH-078: clean index boardStatus (exact key set) validates clean', () => {
  const e = []; wfe.validateFile(mkIdx(), 'index', e);
  assert.deepEqual(e, []);
});

// ---- BH-078: quality/index.json boardStatus — 'diagnostic'-only + key completeness -----------
test("BH-078: QC index boardStatus value 'core' must trip (QC-only-diagnostic)", () => {
  const idx = { schema: wfe.SCHEMA, generated_at: 'x', coverage: null, generatedFromSnapshots: 1, boards: ['quality-energy'], boardStatus: { 'quality-energy': 'core' }, counts: {}, excluded: {} };
  const e = []; wfe.validateQualityIndex(idx, e);
  assert.ok(e.some((x) => /boardStatus\.quality-energy/.test(x)), JSON.stringify(e));
});
test('BH-078: QC index boardStatus missing an entry for a listed board must trip', () => {
  const idx = { schema: wfe.SCHEMA, generated_at: 'x', coverage: null, generatedFromSnapshots: 1, boards: ['quality-energy', 'quality-financials'], boardStatus: { 'quality-energy': 'diagnostic' }, counts: {}, excluded: {} };
  const e = []; wfe.validateQualityIndex(idx, e);
  assert.ok(e.some((x) => /boardStatus missing key quality-financials/.test(x)), JSON.stringify(e));
});

// ---- BH-160: QC board file boardStatus pinned to 'diagnostic' under forceDiagnostic ----------
test("BH-160: QC board file boardStatus='core' trips under forceDiagnostic:true", () => {
  const e = []; wfe.validateFile(mkQHull({ boardStatus: 'core' }), 'semiconductors', e, { forceDiagnostic: true });
  assert.ok(e.some((x) => /boardStatus=/.test(x)), JSON.stringify(e));
});
test('BH-160: clean QC board file (boardStatus diagnostic) validates clean under forceDiagnostic:true', () => {
  const e = []; wfe.validateFile(mkQHull(), 'semiconductors', e, { forceDiagnostic: true });
  assert.deepEqual(e, []);
});
test("BH-160: plain validateFile (no opts) still allows 'core' — HG boards stay unaffected", () => {
  const e = []; wfe.validateFile(mkQHull({ boardStatus: 'core' }), 'semiconductors', e);
  assert.deepEqual(e, [], 'validateFile without forceDiagnostic must NOT regress HG boardStatus=core');
});

// ---- BH-180: shared contract fixture carries cohortN/cohortFallback as required ---------------
test('BH-180: contract.json requiredBoardRow/requiredOverviewRow include cohortN + cohortFallback', () => {
  const p = path.join(__dirname, '..', '..', 'docs', 'findash-export-v1.contract.json');
  const c = JSON.parse(fs.readFileSync(p, 'utf8'));
  for (const field of ['cohortN', 'cohortFallback']) {
    assert.ok(c.requiredBoardRow.includes(field), `requiredBoardRow missing ${field}`);
    assert.ok(c.requiredOverviewRow.includes(field), `requiredOverviewRow missing ${field}`);
  }
});

console.log(`\nbh-w2-export.test.js: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);

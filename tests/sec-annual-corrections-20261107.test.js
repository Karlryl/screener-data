'use strict';
// SEC annual store corrections of 07.11.2026 (lane sd-hand-4 item 4): Galiano Gold's SEC operating income for 2024 was the
// figure as first filed (43,607 thousand USD, without the gold hedge loss of 23,121), next to 2025 on the new basis (36,543).
// The restated 2024 of the 2025 statements is 20,486 (hand-table case gau-2024-12-31-annualOpInc-20261031, Codex R08 of
// 04.11.2026). The capital-efficiency axis reads this SEC trio. Real entry: tests/fixtures/sec-annual-corrections-gau-20261107.json
// (the store of origin/main 8671bb3d69). Probes change in-memory copies; live files are hashed before and after. Break-once:
// `node tests/sec-annual-corrections-20261107.test.js --prove-red` runs the same assertions without the correction row and exits 1.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const S = require('../lib/sec-annual-corrections.js');
const H = require('../lib/financial-known-cases.js');
const cfg = require('../configs/sec-annual-corrections.json');
const GAU = require('./fixtures/sec-annual-corrections-gau-20261107.json').GAU;

const root = path.resolve(__dirname, '..');
const live = ['configs/sec-annual-corrections.json', 'external-data/sec-secannual-smallcap.json', 'external-data/sec-secannual.json', 'configs/financial-known-cases.json'];
const liveHashes = () => live.map(f => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, f))).digest('hex'));
const beforeHashes = liveHashes();
const RED = process.argv.includes('--prove-red');
const rows = RED ? [] : S.ROWS;
const value = r => (r && typeof r === 'object' ? r.value ?? null : r ?? null);
const apply = e => S.applySecAnnualCorrections('GAU', structuredClone(e), rows);

test('the row binds to the filed hand-table year and to the exact as-filed SEC figure', () => {
  assert.equal(S.ROWS.length, 1);
  const [r] = S.ROWS, h = H.table.cases.find(c => c.caseId === r.handCaseId);
  assert.deepEqual([r.ticker, r.field, r.fiscalYear, r.expectedBadValue, r.replacementValue], ['GAU', 'annualOpInc', 2024, 43607000, 20486000]);
  assert.equal(h.sources[0].quote, 'Income from operations and joint venture 36,543 20,486');
  assert.ok(h.sources[0].url.startsWith('https://www.sec.gov/Archives/edgar/data/1377757/'));
  assert.equal(43607000 - 20486000, 23121000, 'the difference is the gold hedge loss of 2024');
  assert.match(r.reason, /31\.12\.2024/);
  assert.match(r.reason, /Geprüft am 07\.11\.2026\.$/);
  assert.doesNotMatch(r.reason, /[–—]| - |kauf|verkauf/i);
  for (const bad of [c => { c.handCaseId = 'missing'; }, c => { c.fiscalYear = 2023; }, c => { c.expectedBadValue = 20486000; }, c => { c.field = 'annualFCF'; }]) {
    const copy = structuredClone(cfg); bad(copy.cases[0]);
    assert.throws(() => S.validate(copy), /Invalid SEC annual correction/);
  }
});

test('the stored entry: 2024 becomes the restated figure, every other year and series stays as stored', () => {
  assert.equal(GAU.nfy, 2025);
  assert.deepEqual(GAU.annualOpInc.slice(0, 4).map(value), [36543000, 43607000, 20122000, 39419000], 'precondition: the store of 07.11.2026');
  const r = apply(GAU), e = r.entry;
  assert.deepEqual(e.annualOpInc.map(value), [36543000, 20486000, ...GAU.annualOpInc.slice(2).map(value)]);
  assert.deepEqual(e.annualOpInc[1].secAnnualCorrection, { caseId: 'gau-sec-2024-annualOpInc-20261107', originalValue: 43607000, handCaseId: 'gau-2024-12-31-annualOpInc-20261031' });
  for (const k of Object.keys(GAU).filter(k => k !== 'annualOpInc')) assert.deepEqual(e[k], GAU[k], k);
  assert.deepEqual(S.applySecAnnualCorrections('GAU', structuredClone(e), rows).entry, e, 'idempotent');
  assert.equal(S.applySecAnnualCorrections('OTHER', GAU, rows).entry, GAU, 'another ticker is untouched');
});

test('a different SEC figure in that cell is withheld, never kept and never replaced; a missing year is reported', () => {
  const moved = structuredClone(GAU); moved.annualOpInc[1] = { value: 44000000 };
  const r = apply(moved);
  assert.equal(value(r.entry.annualOpInc[1]), null);
  assert.equal(r.entry.annualOpInc[1].secAnnualCorrection.reasonCode, 'sec-value-changed');
  assert.equal(S.applySecAnnualCorrections('GAU', r.entry, rows).entry, r.entry, 'idempotent on the hold');
  // A rebuild after a new fiscal year (nfy 2026) shifts the positions; the row follows the year, not the index.
  const shifted = structuredClone(GAU); shifted.nfy = 2026; shifted.annualOpInc = [{ value: 50000000 }, ...shifted.annualOpInc];
  assert.equal(value(apply(shifted).entry.annualOpInc[2]), 20486000);
  const short = structuredClone(GAU); short.annualOpInc = short.annualOpInc.slice(0, 1);
  assert.equal(apply(short).events[0].reasonCode, 'year-absent');
});

test('the committed store carries the correction, and both builders apply it right before they write', () => {
  const store = JSON.parse(fs.readFileSync(path.join(root, 'external-data/sec-secannual-smallcap.json'), 'utf8'));
  if (!RED) assert.deepEqual(store.GAU, apply(GAU).entry, 'the committed GAU entry is exactly the corrected stored entry');
  assert.deepEqual(Object.keys(store.GAU), Object.keys(GAU));
  const line = "  require(path.join(ROOT, 'lib/sec-annual-corrections.js')).applyToStore(out);";
  const check = src => {
    const lines = src.split('\n'), at = lines.indexOf(line);
    assert.ok(at > 0, 'the builder applies the corrections');
    assert.equal(lines[at + 1], '  writeFileAtomic(OUT, JSON.stringify(out));', 'right before the store is written');
  };
  for (const f of ['scripts/build-secannual.js', 'scripts/build-secannual-smallcap.js']) {
    const src = fs.readFileSync(path.join(root, f), 'utf8');
    check(src);
    assert.throws(() => check(src.replace(line + '\n', '')), assert.AssertionError, f + ': break-once without the call');
  }
});

test('expectation: Galiano on the small-cap overview, the band holds the replayed score and excludes the old one', () => {
  const e = require('../data-health/erwartungen.json').find(x => x.id === 'sdhand4-GAU-score');
  assert.deepEqual([e.name, e.board, e.feld, e.op, e.gueltigAb], ['Galiano Gold Inc.', 'smallcap/overview', 'score', 'between', '2026-11-08']);
  assert.ok(e.min < 42.58 && 42.58 < e.max && !(e.min < 46.9 && 46.9 < e.max));
  assert.ok(e.grund.includes('31.10.2026') && e.grund.includes('07.11.2026'), 'dates its numbers');
});

test('the live files are unchanged by this test', () => {
  assert.deepEqual(liveHashes(), beforeHashes);
});

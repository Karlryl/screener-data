'use strict';
// P109: the heartbeat check on temp export trees only; no live file is read or written.
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const p = require('../lib/export-provenance.js');
const { checkExport, CONTRACT_SINCE } = require('../scripts/heartbeat-provenance.js');

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log('ok ' + name); };
const AFTER = new Date(CONTRACT_SINCE + 3600e3).toISOString();
const BEFORE = new Date(CONTRACT_SINCE - 3600e3).toISOString();
const row = () => ({ ticker: 'TEST', marketCap: 1000, revGrowthYoYPct: null, revGrowthBasis: 'none',
  revGrowthPeriodEnd: null, revGrowthPriorPeriodEnd: null });

/** A one-board export tree: index.json + energy.json, optionally with provenance written by the real helper. */
function tree(generatedAt, withProvenance) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hb-prov-test-'));
  fs.writeFileSync(path.join(root, 'index.json'), JSON.stringify({ schema: 'findash-export/v1', generated_at: generatedAt, branches: ['energy'] }));
  const board = { schema: 'findash-export/v1', branch: 'energy', profitable: [row()], unprofitable: [] };
  if (withProvenance) p.writeProvenance([board], { outDir: root, board: 'hypergrowth' });
  fs.writeFileSync(path.join(root, 'energy.json'), JSON.stringify(board));
  return root;
}

test('fixture ok: valid headers, manifest and ok marker -> green', () => {
  const r = checkExport(tree(AFTER, true));
  assert.equal(r.ok, true, r.lines.join(' | '));
  assert.match(r.lines[0], /^OK: Herkunft gültig/);
});

test('fixture failed marker: published status failed -> red with the reason', () => {
  const root = tree(AFTER, false);
  p.writeProvenanceFailure(root, 'hypergrowth', new Error('forced helper failure'));
  const r = checkExport(root);
  assert.equal(r.ok, false);
  assert.ok(r.lines.some(l => /Herkunft zurückgehalten \(hypergrowth\): forced helper failure/.test(l)), r.lines.join(' | '));
});

test('fixture header mismatch: board run id or sha differs from manifest/marker -> red', () => {
  for (const edit of [b => { b.provenanceManifestSha256 = '0'.repeat(64); }, b => { b.provenanceRunId = 'another-run'; }]) {
    const root = tree(AFTER, true), file = path.join(root, 'energy.json');
    const board = JSON.parse(fs.readFileSync(file, 'utf8')); edit(board); fs.writeFileSync(file, JSON.stringify(board));
    const r = checkExport(root);
    assert.equal(r.ok, false);
    assert.ok(r.lines.some(l => /^Herkunft ungültig: /.test(l)), r.lines.join(' | '));
  }
});

test('transition: an export older than the contract without headers or markers stays green with a note', () => {
  const r = checkExport(tree(BEFORE, false));
  assert.equal(r.ok, true);
  assert.match(r.lines[0], /älter als der Herkunftsvertrag/);
});

test('silent loss: a newer export without headers or markers is red', () => {
  const r = checkExport(tree(AFTER, false));
  assert.equal(r.ok, false);
  assert.match(r.lines[0], /Herkunft fehlt still/);
});

test('an ok marker cannot excuse boards that lost their provenance', () => {
  const root = tree(AFTER, true), file = path.join(root, 'energy.json');
  const board = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const k of p.HEADER_FIELDS) delete board[k];
  for (const r of p.rowsOf(board)) for (const k of p.ROW_FIELDS) delete r[k];
  fs.writeFileSync(file, JSON.stringify(board));
  assert.equal(checkExport(root).ok, false);
});

console.log(`heartbeat-provenance: ${passed} passed, 0 failed`);

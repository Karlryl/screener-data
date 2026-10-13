'use strict';
// P109: the heartbeat check on temp export trees only; no live file is read or written.
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const p = require('../lib/export-provenance.js');
const { checkExport, fetchExport, CONTRACT_SINCE, OVERVIEW_SINCE } = require('../scripts/heartbeat-provenance.js');

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log('ok ' + name); };
const AFTER = new Date(CONTRACT_SINCE + 3600e3).toISOString();
const BEFORE = new Date(CONTRACT_SINCE - 3600e3).toISOString();
const AFTER_OVERVIEW = new Date(OVERVIEW_SINCE + 3600e3).toISOString();
const row = () => ({ ticker: 'TEST', marketCap: 1000, revGrowthYoYPct: null, revGrowthBasis: 'none',
  revGrowthPeriodEnd: null, revGrowthPriorPeriodEnd: null });

/** A one-board export tree, optionally with overview and provenance written by the real helper. */
function tree(generatedAt, withProvenance, withOverview = false) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hb-prov-test-'));
  fs.writeFileSync(path.join(root, 'index.json'), JSON.stringify({ schema: 'findash-export/v1', generated_at: generatedAt, branches: ['energy'] }));
  const board = { schema: 'findash-export/v1', branch: 'energy', profitable: [row()], unprofitable: [] };
  const overview = { schema: 'findash-export/v1', rows: [row()] };
  if (withProvenance) p.writeProvenance(withOverview ? [board, overview] : [board], { outDir: root, board: 'hypergrowth' });
  fs.writeFileSync(path.join(root, 'energy.json'), JSON.stringify(board));
  if (withOverview) fs.writeFileSync(path.join(root, 'overview.json'), JSON.stringify(overview));
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

test('overview: valid provenance at and after the cutoff -> green with two files', () => {
  for (const generatedAt of [new Date(OVERVIEW_SINCE).toISOString(), AFTER_OVERVIEW]) {
    const r = checkExport(tree(generatedAt, true, true));
    assert.equal(r.ok, true, r.lines.join(' | '));
    assert.match(r.lines[0], /^OK: Herkunft gültig für 2 Board-Dateien/);
  }
});

test('overview: altered run id or unparsable JSON -> red', () => {
  const root = tree(AFTER_OVERVIEW, true, true), file = path.join(root, 'overview.json');
  const overview = JSON.parse(fs.readFileSync(file, 'utf8'));
  overview.provenanceRunId = 'another-run';
  fs.writeFileSync(file, JSON.stringify(overview));
  const r = checkExport(root);
  assert.equal(r.ok, false);
  assert.ok(r.lines.some(l => /^Herkunft ungültig: /.test(l)), r.lines.join(' | '));
  for (const generatedAt of [AFTER, AFTER_OVERVIEW]) {
    const broken = tree(generatedAt, true, true);
    fs.writeFileSync(path.join(broken, 'overview.json'), '{');
    const result = checkExport(broken);
    assert.equal(result.ok, false);
    assert.ok(result.lines.some(l => /^Herkunft ungültig: overview\.json: /.test(l)), result.lines.join(' | '));
  }
});

test('overview: altered manifest hash before the cutoff is still checked -> red', () => {
  const root = tree(AFTER, true, true), file = path.join(root, 'overview.json');
  const overview = JSON.parse(fs.readFileSync(file, 'utf8'));
  overview.provenanceManifestSha256 = '0'.repeat(64);
  fs.writeFileSync(file, JSON.stringify(overview));
  const r = checkExport(root);
  assert.equal(r.ok, false);
  assert.ok(r.lines.some(l => /^Herkunft ungültig: /.test(l)), r.lines.join(' | '));
  for (const header of p.HEADER_FIELDS) {
    const older = tree(BEFORE, false);
    fs.writeFileSync(path.join(older, 'overview.json'), JSON.stringify({
      schema: 'findash-export/v1', rows: [row()], [header]: overview[header],
    }));
    assert.equal(checkExport(older).ok, false, `A lone ${header} must not bypass validation before the contract`);
  }
});

test('overview: older generation without overview provenance stays green', () => {
  const root = tree(AFTER, true);
  fs.writeFileSync(path.join(root, 'overview.json'), JSON.stringify({ schema: 'findash-export/v1', rows: [row()] }));
  const r = checkExport(root);
  assert.equal(r.ok, true, r.lines.join(' | '));
});

test('overview: newer generation stripped of all provenance is red despite an ok marker', () => {
  const root = tree(AFTER_OVERVIEW, true, true), file = path.join(root, 'overview.json');
  const overview = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const k of p.HEADER_FIELDS) delete overview[k];
  for (const r of p.rowsOf(overview)) for (const k of p.ROW_FIELDS) delete r[k];
  fs.writeFileSync(file, JSON.stringify(overview));
  const r = checkExport(root);
  assert.equal(r.ok, false);
  assert.ok(r.lines.some(l => /^Herkunft ungültig: overview\.json: /.test(l)), r.lines.join(' | '));
});

test('overview: newer generation missing overview is red', () => {
  const r = checkExport(tree(AFTER_OVERVIEW, true));
  assert.equal(r.ok, false);
  assert.ok(r.lines.some(l => /^Herkunft ungültig: overview\.json: /.test(l)), r.lines.join(' | '));
});

const testAsync = async (name, fn) => { await fn(); passed++; console.log('ok ' + name); };
(async () => {
  await testAsync('overview: fetchExport downloads and checks overview before the cutoff', async () => {
    const source = tree(AFTER, true, true), file = path.join(source, 'overview.json');
    const overview = JSON.parse(fs.readFileSync(file, 'utf8'));
    overview.provenanceRunId = 'another-run';
    fs.writeFileSync(file, JSON.stringify(overview));
    const files = new Set(['index.json', 'energy.json', 'overview.json', 'provenance/hypergrowth.json', 'provenance/_failed.json']);
    const server = http.createServer((req, res) => {
      const rel = req.url.slice(1), target = path.join(source, rel);
      if (!files.has(rel) || !fs.existsSync(target)) { res.writeHead(404); res.end(); return; }
      res.end(fs.readFileSync(target));
    });
    try {
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
      const root = await fetchExport(`http://127.0.0.1:${server.address().port}`);
      const r = checkExport(root);
      assert.equal(r.ok, false);
      assert.ok(r.lines.some(l => /^Herkunft ungültig: /.test(l)), r.lines.join(' | '));
    } finally {
      await new Promise(resolve => server.close(resolve));
    }
  });
  console.log(`heartbeat-provenance: ${passed} passed, 0 failed`);
})().catch(e => { console.error(e); process.exitCode = 1; });

#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { loadDupIssuerShadowTable, secondaryIndex, applyDupIssuerShadow } = require('../lib/dup-issuer-shadow-table.js');
const { applyDupIssuerShadowRows } = require('./write-rule40-export.js');

const FROZEN_DIR = path.join(__dirname, '..', 'outputs', 'findash-export', 'v1-frozen-20261003');
const INDEX_SHA256 = '2b785612ce8ffafcfe64d06a7bad51885785abfbac260642700e49a3dcdebe3b';
const GENERATED_AT = '2026-10-03T09:31:17.258Z';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

/**
 * Visits ticker-bearing row occurrences, including nested diagnostic rows.
 * @param {object|Array} value Export document or nested value.
 * @param {Function} visit Callback receiving the row and containing array name.
 * @param {string} [track] Containing array name.
 * @returns {void} Calls the visitor in document order.
 */
function visitRows(value, visit, track = 'rows') {
  if (Array.isArray(value)) {
    for (const item of value) {
      if (item && typeof item === 'object' && Object.hasOwn(item, 'ticker')) visit(item, track);
      visitRows(item, visit, track);
    }
  } else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) visitRows(child, visit, key);
  }
}

function jsonFiles(dir, prefix = '') {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    assert.ok(!entry.isSymbolicLink(), `symlink not allowed: ${prefix}${entry.name}`);
    if (entry.isDirectory()) {
      assert.ok(!prefix && ['full', 'quality', 'smallcap', 'rule40', 'druckenmiller'].includes(entry.name),
        `unexpected frozen directory: ${prefix}${entry.name}`);
      files.push(...jsonFiles(path.join(dir, entry.name), entry.name + '/'));
    } else if (entry.name.endsWith('.json')) files.push(prefix + entry.name);
  }
  return files.sort();
}

/**
 * Verifies and compares all 63 frozen files using only the production marker steps.
 * @returns {object} Temporary after-directory, per-file counts and exact changed row occurrences.
 */
function run() {
  const manifestBytes = fs.readFileSync(path.join(FROZEN_DIR, 'SHA256SUMS.txt'));
  const manifest = new Map();
  for (const line of manifestBytes.toString('utf8').trim().split(/\r?\n/)) {
    const match = /^([a-f\d]{64}) [ *](?:\.\/)?((?:(?:full|quality|smallcap|rule40|druckenmiller)\/)?[a-z\d-]+\.json)$/.exec(line);
    assert.ok(match, `invalid SHA256SUMS entry: ${line}`);
    assert.ok(!manifest.has(match[2]), `duplicate SHA256SUMS entry: ${match[2]}`);
    manifest.set(match[2], match[1]);
  }
  const files = jsonFiles(FROZEN_DIR);
  assert.deepEqual(files, [...manifest.keys()].sort(), 'SHA256SUMS must cover every JSON file');
  assert.equal(files.length, 63, 'the frozen generation contains exactly 63 JSON files');
  for (const file of ['rule40/index.json', 'rule40/overview.json', 'quality/utilities.json']) {
    assert.ok(manifest.has(file), `missing frozen file: ${file}`);
  }
  const originals = new Map();
  // Verify all bytes before parsing a single export file or creating any after file.
  for (const file of files) {
    const bytes = fs.readFileSync(path.join(FROZEN_DIR, file));
    assert.equal(hash(bytes), manifest.get(file), `SHA256 mismatch: ${file}`);
    originals.set(file, bytes);
  }
  assert.equal(manifest.get('index.json'), INDEX_SHA256, 'wrong frozen index');
  assert.equal(JSON.parse(originals.get('index.json')).generated_at, GENERATED_AT);
  const index = secondaryIndex(loadDupIssuerShadowTable());
  const afterDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dup-issuer-shadow-after-'));
  const changes = [];
  const fileCounts = {};
  let rowsCompared = 0;
  for (const [file, bytes] of originals) {
    const before = JSON.parse(bytes);
    const after = structuredClone(before);
    // These two feeds have separate writers with no shadow step. Compare them unchanged;
    // excluded.json even contains GE.VI twice (row + diagnostic leg), neither is a board row.
    const shadowBoard = file !== 'excluded.json' && !file.startsWith('druckenmiller/');
    visitRows(before, (row) => {
      assert.ok(!Object.hasOwn(row, 'dupIssuer'), `${file}/${row.ticker}: frozen row already has dupIssuer`);
    });
    if (file === 'rule40/overview.json') applyDupIssuerShadowRows(after.rows, index);
    else if (shadowBoard) visitRows(after, (row) => applyDupIssuerShadow(row, index));
    fileCounts[file] = 0;
    visitRows(after, (row, track) => {
      rowsCompared++;
      const expected = shadowBoard ? index.get(row.ticker) : undefined;
      if (expected) {
        assert.deepEqual(row.dupIssuer, { of: expected.of, issuer: expected.issuer, basis: 'hand-table:dup-issuer-shadow' });
        fileCounts[file]++;
        changes.push({ file, track, ticker: row.ticker, rank: row.rank, 'dupIssuer.of': row.dupIssuer.of });
      } else assert.ok(!Object.hasOwn(row, 'dupIssuer'), `${row.ticker}: unexpected flag`);
    });
    const target = path.resolve(afterDir, file);
    assert.ok(target.startsWith(afterDir + path.sep) && !target.startsWith(path.resolve(FROZEN_DIR) + path.sep), 'unsafe after path');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify(after) === JSON.stringify(before) ? bytes : JSON.stringify(after, null, 2) + '\n');
    const written = JSON.parse(fs.readFileSync(target, 'utf8'));
    assert.deepEqual(written, after, `${file}: after-file round trip changed data`);
    visitRows(written, (row) => { delete row.dupIssuer; });
    assert.deepEqual(written, before, `${file}: difference beyond added dupIssuer`);
    assert.equal(JSON.stringify(written), JSON.stringify(before), `${file}: row or key order changed`);
    if (fileCounts[file] === 0) assert.deepEqual(fs.readFileSync(target), bytes, `${file}: unmarked file bytes changed`);
  }
  // Source files and their checksum manifest must remain byte-identical.
  for (const [file, expected] of manifest) assert.equal(hash(fs.readFileSync(path.join(FROZEN_DIR, file))), expected, `frozen file changed: ${file}`);
  assert.equal(hash(fs.readFileSync(path.join(FROZEN_DIR, 'SHA256SUMS.txt'))), hash(manifestBytes));
  console.log(`SHA256 verified: ${files.length} files; index.json ${INDEX_SHA256}`);
  console.log(`Generation: ${GENERATED_AT}`);
  console.log(`Files compared: ${files.length}; rows compared: ${rowsCompared}; rows changed: ${changes.length}; other differences: 0`);
  for (const [file, count] of Object.entries(fileCounts)) console.log(`${file}: ${count} flagged rows`);
  console.log(`Total flagged rows: ${changes.length}`);
  console.log(`Rule40 changed rows: ${fileCounts['rule40/overview.json']}`);
  const counts = { full: 0, shortLists: 0, overview: 0, survival: 0, quality: 0, smallcap: 0, rule40: 0 };
  for (const change of changes) {
    const feed = change.file.includes('/') ? change.file.split('/')[0]
      : change.file === 'overview.json' ? 'overview' : change.file === 'survival.json' ? 'survival' : 'shortLists';
    counts[feed]++;
    console.log(JSON.stringify(change));
  }
  console.log(`Changed rows by feed: ${JSON.stringify(counts)}`);
  console.log('Only added key: dupIssuer; no rank, score, name or membership changed.');
  console.log('Unchanged feeds: excluded.json and druckenmiller/ (separate writers, no shadow step).');
  console.log(`After directory: ${afterDir}`);
  return { afterDir, filesCompared: files.length, rowsCompared, changes, counts, fileCounts };
}

if (require.main === module) {
  try { run(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { run, visitRows };

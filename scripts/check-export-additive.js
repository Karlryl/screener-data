#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { HEADER_FIELDS, ROW_FIELDS, MANIFEST_PATHS, expandRecord, sha256 } = require('../lib/export-provenance.js');

/** List JSON paths without following symbolic links.
 * @param {string} root Export directory.
 * @param {string} prefix Relative subdirectory.
 * @returns {string[]} Sorted relative paths.
 */
function jsonFiles(root, prefix = '') {
  return fs.readdirSync(path.join(root, prefix), { withFileTypes: true }).flatMap(entry => {
    const relative = path.posix.join(prefix, entry.name);
    if (entry.isSymbolicLink()) throw new Error('Symbolic link in export tree: ' + relative);
    return entry.isDirectory() ? jsonFiles(root, relative) : entry.name.endsWith('.json') ? [relative] : [];
  }).sort();
}

function provenanceNormalizer(root, files) {
  const manifests = new Map(), unknownReferences = new Set();
  const blank = (object, keys) => {
    for (const key of keys) if (Object.hasOwn(object, key)) object[key] = null;
  };
  function reference(id, ids, keys) {
    if (ids.has(id)) return ids.get(id);
    if (typeof id === 'string') unknownReferences.add(JSON.stringify(keys));
    return id;
  }
  for (const relative of Object.values(MANIFEST_PATHS)) {
    if (!files.has(relative)) continue;
    // Parsed copies only: neither export tree is ever written by this checker.
    const manifest = JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));
    const records = manifest.records.map(expandRecord), byId = new Map(), ids = new Map(), visiting = new Set();
    for (const record of records) {
      if (typeof record.id !== 'string' || !record.id || byId.has(record.id)) {
        throw new Error(relative + ': invalid or duplicate evidence id');
      }
      byId.set(record.id, record);
    }
    function dependencies(record, resolve) {
      const derivation = { ...record.derivation };
      for (const key of ['inputIds', 'cohortInputIds']) {
        if (Array.isArray(derivation[key])) derivation[key] = derivation[key].map((id, index) => resolve(id, key, index));
      }
      return { ...record, derivation };
    }
    function canonicalId(id) {
      if (!byId.has(id)) return id;
      if (ids.has(id)) return ids.get(id);
      if (visiting.has(id)) throw new Error(relative + ': evidence dependency cycle at ' + id);
      visiting.add(id);
      const content = dependencies(byId.get(id), canonicalId);
      for (const key of ['id', 'creatorSessionId', 'createdAt']) delete content[key];
      const canonical = sha256(JSON.stringify(content));
      visiting.delete(id);
      ids.set(id, canonical);
      return canonical;
    }
    records.forEach(record => canonicalId(record.id));
    manifest.records = records.map((record, index) => ({ ...dependencies(record,
      (id, key, i) => reference(id, ids, [relative, 'records', index, 'derivation', key, i])),
      id: ids.get(record.id), creatorSessionId: null, createdAt: null }));
    for (const [index, review] of manifest.reviews.entries()) {
      if (Array.isArray(review.evidenceIds)) review.evidenceIds = review.evidenceIds.map((id, i) =>
        reference(id, ids, [relative, 'reviews', index, 'evidenceIds', i]));
    }
    blank(manifest, ['runId', 'generatedAt']);
    manifests.set(relative, { manifest, ids });
  }
  function replaceLists(value, ids, keys) {
    if (Array.isArray(value)) return value.map((item, i) => typeof item === 'string'
      ? reference(item, ids, [...keys, i]) : replaceLists(item, ids, [...keys, i]));
    if (value && typeof value === 'object') {
      for (const key of Object.keys(value)) value[key] = replaceLists(value[key], ids, [...keys, key]);
    }
    return value;
  }
  const normalize = (relative, file) => {
    if (manifests.has(relative)) return manifests.get(relative).manifest;
    if (!file || typeof file !== 'object' || Array.isArray(file)) return file;
    blank(file, ['provenanceRunId', 'provenanceManifestSha256']);
    if (relative === 'provenance/_failed.json' || relative === 'rule40/provenance/_failed.json') blank(file, ['at']);
    const ids = manifests.get(relative.startsWith('rule40/') ? MANIFEST_PATHS.rule40 : MANIFEST_PATHS.hypergrowth)?.ids;
    if (ids) for (const key of ['rows', 'profitable', 'unprofitable']) {
      if (!Array.isArray(file[key])) continue;
      for (const [index, row] of file[key].entries()) {
        if (!row || typeof row !== 'object') continue;
        if (row.provenance && typeof row.provenance === 'object') {
          for (const field of Object.keys(row.provenance)) {
            const list = row.provenance[field];
            if (Array.isArray(list)) row.provenance[field] = list.map((id, i) =>
              reference(id, ids, [relative, key, index, 'provenance', field, i]));
          }
        }
        if (Object.hasOwn(row, 'verification')) row.verification = replaceLists(row.verification, ids, [relative, key, index, 'verification']);
      }
    }
    return file;
  };
  return { normalize, unknownReferences };
}

/** Compare existing export content, allowing only the documented additive fields.
 * @param {string} baseDir Baseline export directory.
 * @param {string} headDir Candidate export directory.
 * @param {Function} log Difference and summary sink.
 * @param {{provenanceContent?: boolean}} options Optional content-based evidence comparison.
 * @returns {{files: number, rows: number, leafValues: number, differences: number}} Comparison counts.
 */
function compareExports(baseDir, headDir, log = console.log, options = {}) {
  const baseFiles = jsonFiles(baseDir), headFiles = new Set(jsonFiles(headDir));
  const normalizeBase = options.provenanceContent ? provenanceNormalizer(baseDir, new Set(baseFiles)) : null;
  const normalizeHead = options.provenanceContent ? provenanceNormalizer(headDir, headFiles) : null;
  const stats = { files: 0, rows: 0, leafValues: 0, differences: 0 }, details = [];
  function diff(where, reason) {
    stats.differences++;
    if (details.length < 20) details.push(where + ': ' + reason);
  }
  for (const relative of baseFiles) {
    stats.files++;
    if (!headFiles.has(relative)) { diff(relative, 'file missing'); continue; }
    const baseBytes = fs.readFileSync(path.join(baseDir, relative));
    const headBytes = fs.readFileSync(path.join(headDir, relative));
    if (relative.startsWith('full/') && !baseBytes.equals(headBytes)) diff(relative, 'full file bytes changed');
    const base = normalizeBase ? normalizeBase.normalize(relative, JSON.parse(baseBytes)) : JSON.parse(baseBytes);
    const head = normalizeHead ? normalizeHead.normalize(relative, JSON.parse(headBytes)) : JSON.parse(headBytes);
    const board = /^[^/]+\.json$/.test(relative) &&
      base.branch === path.posix.basename(relative, '.json') && Array.isArray(base.profitable) && Array.isArray(base.unprofitable);
    const r40 = relative === 'rule40/overview.json';
    const overview = relative === 'overview.json'; // P118: flat {rows[]} feed, annotated like rule40
    function allowed(keys, key) {
      if (!board && !r40 && !overview) return false;
      if (!keys.length) return HEADER_FIELDS.includes(key);
      return keys.length === 2 && Number.isInteger(keys[1]) && ROW_FIELDS.includes(key) &&
        (board ? ['profitable', 'unprofitable'].includes(keys[0]) : keys[0] === 'rows');
    }
    function compare(a, b, keys) {
      const where = relative + ':' + keys.join('.');
      if (normalizeBase) {
        // An unresolved raw ID must not impersonate an equal canonical content hash.
        const referencePath = JSON.stringify([relative, ...keys]);
        if (normalizeBase.unknownReferences.has(referencePath) !== normalizeHead.unknownReferences.has(referencePath)) {
          diff(where, 'evidence reference resolution changed');
        }
      }
      if (a && typeof a === 'object' && Object.hasOwn(a, 'ticker')) stats.rows++;
      if (a === null || typeof a !== 'object' || Object.keys(a).length === 0) {
        stats.leafValues++;
        if (JSON.stringify(a) !== JSON.stringify(b)) diff(where, 'leaf value changed');
        return;
      }
      if (!b || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) {
        // Still visit all base leaves: counts never shrink just because the head lost a subtree.
        diff(where, 'container changed'); b = Array.isArray(a) ? [] : {};
      }
      if (Array.isArray(a)) {
        if (a.length !== b.length) diff(where, 'array length changed');
        a.forEach((v, i) => compare(v, b[i], [...keys, i]));
      } else {
        for (const key of Object.keys(a)) compare(a[key], b[key], [...keys, key]);
        for (const key of Object.keys(b)) if (!Object.hasOwn(a, key) && !allowed(keys, key)) diff(where + '.' + key, 'unapproved new key');
      }
    }
    compare(base, head, []);
  }
  const baseSet = new Set(baseFiles);
  for (const relative of headFiles) if (!baseSet.has(relative) &&
    !/^(?:provenance\/(?:hypergrowth|_failed)|rule40\/provenance\/(?:rule40|_failed))\.json$/.test(relative)) diff(relative, 'unapproved new file');
  for (const detail of details) log(detail);
  log(`Compared ${stats.files} files, ${stats.rows} rows, ${stats.leafValues} leaf values; differences: ${stats.differences}`);
  return stats;
}

if (require.main === module) {
  try {
    const args = process.argv.slice(2), provenanceContent = args[0] === '--provenance-content';
    if (provenanceContent) args.shift();
    const [base, head] = args;
    if (!base || !head || args.length !== 2) throw new Error('Usage: node scripts/check-export-additive.js [--provenance-content] <baseDir> <headDir>');
    process.exitCode = compareExports(base, head, console.log, { provenanceContent }).differences ? 1 : 0;
  } catch (e) { console.error(e.message); process.exitCode = 1; }
}
module.exports = { compareExports, jsonFiles };

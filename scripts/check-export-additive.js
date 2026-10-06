#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { HEADER_FIELDS, ROW_FIELDS } = require('../lib/export-provenance.js');

function jsonFiles(root, prefix = '') {
  return fs.readdirSync(path.join(root, prefix), { withFileTypes: true }).flatMap(entry => {
    const relative = path.posix.join(prefix, entry.name);
    if (entry.isSymbolicLink()) throw new Error('Symbolic link in export tree: ' + relative);
    return entry.isDirectory() ? jsonFiles(root, relative) : entry.name.endsWith('.json') ? [relative] : [];
  }).sort();
}

function compareExports(baseDir, headDir, log = console.log) {
  const baseFiles = jsonFiles(baseDir), headFiles = new Set(jsonFiles(headDir));
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
    const base = JSON.parse(baseBytes);
    const head = JSON.parse(headBytes);
    const board = /^[^/]+\.json$/.test(relative) &&
      base.branch === path.posix.basename(relative, '.json') && Array.isArray(base.profitable) && Array.isArray(base.unprofitable);
    const r40 = relative === 'rule40/overview.json';
    function allowed(keys, key) {
      if (!board && !r40) return false;
      if (!keys.length) return HEADER_FIELDS.includes(key);
      return keys.length === 2 && Number.isInteger(keys[1]) && ROW_FIELDS.includes(key) &&
        (board ? ['profitable', 'unprofitable'].includes(keys[0]) : keys[0] === 'rows');
    }
    function compare(a, b, keys) {
      const where = relative + ':' + keys.join('.');
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
  for (const relative of headFiles) if (!baseSet.has(relative) && !/^provenance\/[^/]+\.json$/.test(relative)) diff(relative, 'unapproved new file');
  for (const detail of details) log(detail);
  log(`Compared ${stats.files} files, ${stats.rows} rows, ${stats.leafValues} leaf values; differences: ${stats.differences}`);
  return stats;
}

if (require.main === module) {
  try {
    const [base, head] = process.argv.slice(2);
    if (!base || !head || process.argv.length !== 4) throw new Error('Usage: node scripts/check-export-additive.js <baseDir> <headDir>');
    process.exitCode = compareExports(base, head).differences ? 1 : 0;
  } catch (e) { console.error(e.message); process.exitCode = 1; }
}
module.exports = { compareExports, jsonFiles };

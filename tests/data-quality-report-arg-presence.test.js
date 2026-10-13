'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const SCRIPT = path.resolve(__dirname, '..', 'scripts', 'data-quality-report.js');
const originalLoad = Module._load;
let interceptionCount = 0;
let graderCalls = 0;
let reportModule;

try {
  Module._load = function (request, parent, isMain) {
    if (request === '../methods/data-quality.js') {
      assert.ok(parent && parent.filename, 'denied import must have a parent filename');
      assert.equal(
        path.resolve(parent.filename).toLowerCase(),
        SCRIPT.toLowerCase(),
        'denied import must come only from the report script'
      );
      interceptionCount++;
      return {
        gradeSnapshot() {
          graderCalls++;
          return { grade: 'unknown', missingFields: [] };
        },
        _hasMetric() {
          graderCalls++;
          return false;
        },
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  reportModule = require(SCRIPT);
} finally {
  Module._load = originalLoad;
}

const { main, parseArgs } = reportModule;
const DEFAULT_SNAPSHOTS = path.resolve(__dirname, '..', 'snapshots');
const DEFAULT_OUT = path.resolve(__dirname, '..', 'outputs', 'data-quality-report.md');

test('loads with one exact denied-module interception and restores the loader', () => {
  assert.equal(interceptionCount, 1);
  assert.equal(graderCalls, 0);
  assert.strictEqual(Module._load, originalLoad);
});

test('exports main and the pure argument parser', () => {
  assert.equal(typeof main, 'function');
  assert.equal(typeof parseArgs, 'function');
});

test('parses arguments before every productive filesystem operation', () => {
  const source = fs.readFileSync(SCRIPT, 'utf8');
  const mainStart = source.indexOf('function main() {');
  const mainEnd = source.indexOf('\n}\n\nif (require.main === module)', mainStart);
  assert.ok(mainStart >= 0 && mainEnd > mainStart, 'main source must be locatable');
  const mainSource = source.slice(mainStart, mainEnd);
  const parseIndex = mainSource.indexOf('const args = parseArgs(process.argv);');
  assert.ok(parseIndex >= 0, 'main must parse process.argv');
  for (const anchor of [
    'fs.existsSync(args.snapshots)',
    'fs.readdirSync(args.snapshots)',
    "fs.readFileSync(fp, 'utf8')",
    'fs.existsSync(outDir)',
    'fs.mkdirSync(outDir',
    'writeFileAtomic(args.out',
  ]) {
    const index = mainSource.indexOf(anchor);
    assert.ok(index > parseIndex, anchor + ' must remain after argument parsing');
  }
});

test('keeps productive defaults when both flags are omitted', () => {
  assert.deepEqual(parseArgs(['node', 'script']), {
    snapshots: DEFAULT_SNAPSHOTS,
    out: DEFAULT_OUT,
  });
});

test('accepts both documented path flags', () => {
  assert.deepEqual(
    parseArgs(['node', 'script', '--snapshots', 'fixtures/snapshots', '--out', 'reports/quality.md']),
    { snapshots: 'fixtures/snapshots', out: 'reports/quality.md' }
  );
});

test('accepts documented flags in reverse order', () => {
  assert.deepEqual(
    parseArgs(['node', 'script', '--out', 'reports/quality.md', '--snapshots', 'fixtures/snapshots']),
    { snapshots: 'fixtures/snapshots', out: 'reports/quality.md' }
  );
});

test('preserves whitespace and Windows path values byte-for-byte', () => {
  const snapshots = '  C:\\Data Folder\\snapshots  ';
  const out = ' D:\\Reports\\quality report.md ';
  assert.deepEqual(
    parseArgs(['node', 'script', '--snapshots', snapshots, '--out', out]),
    { snapshots, out }
  );
});

test('keeps numeric-looking and unrelated dash-leading values valid', () => {
  assert.deepEqual(
    parseArgs(['node', 'script', '--snapshots', '-7.5', '--out', 'Infinity']),
    { snapshots: '-7.5', out: 'Infinity' }
  );
  assert.deepEqual(
    parseArgs(['node', 'script', '--snapshots', '--archive', '--out', '--report.md']),
    { snapshots: '--archive', out: '--report.md' }
  );
});

test('continues to ignore unknown arguments', () => {
  assert.deepEqual(
    parseArgs(['node', 'script', '--unknown', 'value', '--snapshots', 'snap', '--quiet', '--out', 'report']),
    { snapshots: 'snap', out: 'report' }
  );
});

test('keeps last recognized value when flags repeat', () => {
  assert.deepEqual(
    parseArgs([
      'node', 'script', '--snapshots', 'first', '--out', 'one',
      '--snapshots', 'second', '--out', 'two',
    ]),
    { snapshots: 'second', out: 'two' }
  );
});

test('rejects trailing --snapshots after a valid output', () => {
  assert.throws(
    () => parseArgs(['node', 'script', '--out', 'report', '--snapshots']),
    /--snapshots/
  );
});

test('rejects trailing --out after a valid snapshot path', () => {
  assert.throws(
    () => parseArgs(['node', 'script', '--snapshots', 'snap', '--out']),
    /--out/
  );
});

test('rejects an empty --snapshots value', () => {
  assert.throws(() => parseArgs(['node', 'script', '--snapshots', '']), /--snapshots/);
});

test('rejects a whitespace-only --snapshots value', () => {
  assert.throws(() => parseArgs(['node', 'script', '--snapshots', ' \t ']), /--snapshots/);
});

test('rejects an empty --out value', () => {
  assert.throws(() => parseArgs(['node', 'script', '--out', '']), /--out/);
});

test('rejects a whitespace-only --out value', () => {
  assert.throws(() => parseArgs(['node', 'script', '--out', ' \t ']), /--out/);
});

test('rejects --out consumed as the --snapshots value', () => {
  assert.throws(
    () => parseArgs(['node', 'script', '--snapshots', '--out', 'report']),
    /--snapshots/
  );
});

test('rejects --snapshots consumed as the --out value', () => {
  assert.throws(
    () => parseArgs(['node', 'script', '--out', '--snapshots', 'snap']),
    /--out/
  );
});

test('rejects --snapshots consumed as its own value', () => {
  assert.throws(
    () => parseArgs(['node', 'script', '--snapshots', '--snapshots', 'snap']),
    /--snapshots/
  );
});

test('rejects --out consumed as its own value', () => {
  assert.throws(
    () => parseArgs(['node', 'script', '--out', '--out', 'report']),
    /--out/
  );
});

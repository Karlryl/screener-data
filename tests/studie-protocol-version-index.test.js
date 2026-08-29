'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.join(__dirname, '..');
const PROTOCOL_DIR = path.join(ROOT, 'protocol', 'early-detection');
const INDEX_PATH = path.join(PROTOCOL_DIR, 'README.md');
const VERSION_LINE = /^- `(\d+\.\d+\.\d+)`: (.+)$/;
const NO_RELABEL = 'No result obtained under one version may be re-labelled as confirmatory under another version.';
const EXPECTED_STATUS_LINES = new Map([
  [
    '1.2.0',
    '- `1.2.0`: corrected final candidate. It becomes active only after final independent re-review, a real freeze timestamp, an immutable hash manifest and a green verification run. It is now historical, superseded by `2.0.0`, and must not be executed.',
  ],
  [
    '2.0.0',
    '- `2.0.0`: current protocol version. Its versioned records govern execution eligibility; this index is descriptive only and neither activates nor authorizes a run.',
  ],
]);

const compareSemver = (left, right) => {
  const a = left.split('.').map(Number);
  const b = right.split('.').map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
};

const versionDirectories = () => fs.readdirSync(PROTOCOL_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && /^\d+\.\d+\.\d+$/.test(entry.name))
  .map((entry) => entry.name)
  .sort(compareSemver);

const indexedEntries = (text) => text
  .split(/\r?\n/)
  .map((line) => ({ line, match: VERSION_LINE.exec(line) }))
  .filter(({ match }) => match !== null)
  .map(({ line, match }) => ({ version: match[1], line }));

const verifyIndex = (text, directories) => {
  const entries = indexedEntries(text);
  const versions = entries.map(({ version }) => version);
  const uniqueVersions = new Set(versions);

  assert.equal(uniqueVersions.size, versions.length, 'each version must have exactly one index entry');
  assert.deepEqual(versions, [...versions].sort(compareSemver), 'index entries must be in numeric SemVer order');
  assert.deepEqual(versions, directories, 'index entries and direct SemVer directories must match in both directions');

  for (const [version, expectedLine] of EXPECTED_STATUS_LINES) {
    const entry = entries.find((candidate) => candidate.version === version);
    assert.equal(entry?.line, expectedLine, `${version} status must remain exact`);
  }

  const invariantCount = text.split(NO_RELABEL).length - 1;
  assert.equal(invariantCount, 1, 'the no-relabel invariant must occur exactly once');
  const finalNonblankLine = text.split(/\r?\n/).filter((line) => line.trim() !== '').at(-1);
  assert.equal(finalNonblankLine, NO_RELABEL, 'the no-relabel invariant must remain the final sentence');
};

const realIndex = fs.readFileSync(INDEX_PATH, 'utf8');
const realDirectories = versionDirectories();

test('protocol version index bijectively covers every direct SemVer directory', () => {
  verifyIndex(realIndex, realDirectories);
});

test('protocol version index rejects a directory without an index entry', () => {
  const missing = realIndex.replace(EXPECTED_STATUS_LINES.get('2.0.0'), '');
  assert.throws(() => verifyIndex(missing, realDirectories), /match in both directions/);
});

test('protocol version index keeps the missing-entry guard under CRLF', () => {
  const crlf = realIndex.replace(/\r?\n/g, '\r\n');
  verifyIndex(crlf, realDirectories);
  const missing = crlf.replace(EXPECTED_STATUS_LINES.get('2.0.0'), '');
  assert.throws(() => verifyIndex(missing, realDirectories), /match in both directions/);
});

test('protocol version index rejects an index entry without a directory', () => {
  const orphan = realIndex.replace(`\n${NO_RELABEL}`, `\n- \`9.9.9\`: orphan entry.\n\n${NO_RELABEL}`);
  assert.throws(() => verifyIndex(orphan, realDirectories), /match in both directions/);
});

test('protocol version index rejects duplicate version entries', () => {
  const duplicate = realIndex.replace(
    EXPECTED_STATUS_LINES.get('2.0.0'),
    `${EXPECTED_STATUS_LINES.get('2.0.0')}\n${EXPECTED_STATUS_LINES.get('2.0.0')}`,
  );
  assert.throws(() => verifyIndex(duplicate, realDirectories), /exactly one index entry/);
});

test('protocol version index rejects status relabelling', () => {
  const relabelled = realIndex.replace('It is now historical', 'It is active');
  assert.throws(() => verifyIndex(relabelled, realDirectories), /1\.2\.0 status must remain exact/);
});

test('protocol version index rejects mutation of the no-relabel invariant', () => {
  const mutated = realIndex.replace('may be re-labelled', 'may be relabelled');
  assert.throws(() => verifyIndex(mutated, realDirectories), /no-relabel invariant/);
});

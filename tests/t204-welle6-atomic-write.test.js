'use strict';

/**
 * T204 Welle 6 — Waechter fuer die zwei zuletzt umgestellten Schreibstellen.
 *
 * Die Kampagne stand seit Welle 5 mit der Begruendung "keine lokale Messebene"
 * still. Sie existiert: die Fixture-Messebene aus Welle 3/4
 * (tests/fixtures/t204-remainder/preload.js) klemmt sich VOR den Prozess und
 * beweist beides ohne echten Lauf —
 *   (a) die Zieldatei wird nie direkt beschrieben (ET204DIRECT bei writeFileSync),
 *   (b) ein fehlschlagendes rename laesst die alten Bytes unangetastet stehen.
 *
 * Gegenstand:
 *   scripts/gqs00-equivalence.js  -> writeEvidenceArtifact() (Gleichwertigkeits-Beleg)
 *   watchlist-cli.js              -> cmdExport() (CSV-Export, echter CLI-Prozess)
 *
 * Bruchprobe: writeFileAtomic in der jeweiligen Datei wieder durch
 * fs.writeFileSync ersetzen -> beide "normal"-Faelle werden rot (directWrites),
 * beide EIO-Faelle ebenfalls (Zieldatei traegt dann die neuen Bytes).
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const ROOT = path.join(__dirname, '..');
const FIXTURE_DIR = path.join(__dirname, 'fixtures', 't204-remainder');
const PRELOAD = path.join(FIXTURE_DIR, 'preload.js');
const RUNNER = path.join(FIXTURE_DIR, 'fixture-runner.js');
const SENTINEL = Buffer.from('T204 Welle 6 sentinel: keep on rename failure\n', 'utf8');

function temporaryDirectory(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `t204-welle6-${label}-`));
}

function cleanup(dir) {
  const resolved = path.resolve(dir);
  const tempRoot = `${path.resolve(os.tmpdir())}${path.sep}`;
  assert.ok(resolved.startsWith(tempRoot), `refusing cleanup outside OS temp: ${resolved}`);
  fs.rmSync(resolved, { recursive: true, force: true });
}

function tempNames(target) {
  const prefix = `${path.basename(target)}.tmp.`;
  return fs.readdirSync(path.dirname(target)).filter((name) => name.startsWith(prefix));
}

// Startet einen echten Prozess mit vorgeschaltetem Fault-Preload und liest die
// Spur (opens/renames/unlinks/directWrites), die der Preload beim Exit ablegt.
function runGuarded({ args, target, dir, fault = '', input = null, cwd = ROOT }) {
  const trace = path.join(dir, `${path.basename(target)}.${fault || 'normal'}.trace.json`);
  const child = spawnSync(process.execPath, ['--require', PRELOAD, ...args], {
    encoding: 'utf8',
    cwd,
    env: {
      ...process.env,
      T204_TARGET: target,
      T204_TRACE: trace,
      T204_FAULT: fault,
      T204_INPUT: JSON.stringify(input),
    },
  });
  return { child, target, trace: JSON.parse(fs.readFileSync(trace, 'utf8')) };
}

function assertSiblingTemp(target, tempPath) {
  assert.equal(path.dirname(tempPath), path.dirname(target), 'temporary file must be a sibling');
  assert.ok(tempPath.startsWith(`${target}.tmp.`), `unexpected temporary path: ${tempPath}`);
}

function assertNormalAtomic(result, expected) {
  assert.equal(result.child.status, 0, result.child.stderr || result.child.stdout);
  assert.deepEqual(fs.readFileSync(result.target), expected, 'published bytes drifted from old writer semantics');
  assert.deepEqual(result.trace.directWrites, [], 'target was written directly instead of through sibling rename');
  const writeOpens = result.trace.opens.filter((open) => open.flags === 'w');
  assert.equal(writeOpens.length, 1, 'normal write must open exactly one target-related path for writing');
  assertSiblingTemp(result.target, writeOpens[0].path);
  assert.equal(result.trace.renames.length, 1, 'normal write must publish with one rename');
  assertSiblingTemp(result.target, result.trace.renames[0].from);
  assert.equal(result.trace.renames[0].to, result.target);
  assert.deepEqual(tempNames(result.target), [], 'normal write left sibling temp residue');
}

function assertRenameFailure(result) {
  assert.notEqual(result.child.status, 0, 'injected rename EIO must surface as a failing process');
  assert.match(`${result.child.stderr}\n${result.child.stdout}`, /T204_RENAME_EIO|EIO/);
  assert.deepEqual(fs.readFileSync(result.target), SENTINEL, 'failed rename changed the prior target bytes');
  assert.deepEqual(result.trace.directWrites, [], 'failure path bypassed the atomic helper');
  assert.ok(result.trace.renames.length >= 1, 'failure path never reached rename');
  assert.equal(result.trace.unlinks.length, result.trace.renames.length, 'each failed rename temp must be unlinked');
  assert.deepEqual(tempNames(result.target), [], 'rename failure left sibling temp residue');
}

// ── scripts/gqs00-equivalence.js: Evidence-Artefakt ───────────────────────────
const EVIDENCE = {
  schema: 'gqs-equivalence-evidence/v1',
  measuredInput: { snapshotFiles: 3, loadedUniverse: 2 },
  frozenCodeComparison: { rawScoreMismatches: 0 },
  publishedComparison: { tickerMismatches: 0, tracks: [] },
};
const EVIDENCE_BYTES = Buffer.from(`${JSON.stringify(EVIDENCE, null, 2)}\n`, 'utf8');

function runGqs(dir, fault) {
  const target = path.join(dir, 'gqs-equivalence-evidence.json');
  fs.writeFileSync(target, SENTINEL);
  return runGuarded({ args: [RUNNER, 'gqs', ROOT, target], target, dir, fault, input: EVIDENCE });
}

test('gqs00-equivalence: evidence artefact publishes through one sibling rename', () => {
  const dir = temporaryDirectory('gqs-normal');
  try {
    assertNormalAtomic(runGqs(dir, ''), EVIDENCE_BYTES);
  } finally {
    cleanup(dir);
  }
});

test('gqs00-equivalence: rename EIO surfaces and preserves the prior evidence', () => {
  const dir = temporaryDirectory('gqs-eio');
  try {
    assertRenameFailure(runGqs(dir, 'rename-eio'));
  } finally {
    cleanup(dir);
  }
});

// ── watchlist-cli.js export: echter CLI-Prozess ───────────────────────────────
const WATCHLIST = {
  stocks: [
    { ticker: 'AAA', name: 'Alpha, Inc.', yahoo_symbol: 'AAA', isin: 'US0000000001', track_hint: 'A' },
    { ticker: 'BBB', name: 'Beta AG', yahoo_symbol: 'BBB.DE', isin: null, track_hint: 'B' },
  ],
};
const EXPORT_BYTES = Buffer.from([
  'ticker,name,yahoo_symbol,isin,track_hint',
  'AAA,"Alpha, Inc.",AAA,US0000000001,A',
  'BBB,Beta AG,BBB.DE,,B',
].join('\n'), 'utf8');

function runExport(dir, fault) {
  fs.writeFileSync(path.join(dir, 'watchlist.json'), JSON.stringify(WATCHLIST, null, 2));
  const target = path.join(dir, 'watchlist-export.csv');
  fs.writeFileSync(target, SENTINEL);
  return runGuarded({
    args: [path.join(ROOT, 'watchlist-cli.js'), 'export', target],
    target,
    dir,
    fault,
    cwd: dir,
  });
}

test('watchlist-cli export: CSV publishes through one sibling rename', () => {
  const dir = temporaryDirectory('watchlist-normal');
  try {
    assertNormalAtomic(runExport(dir, ''), EXPORT_BYTES);
  } finally {
    cleanup(dir);
  }
});

test('watchlist-cli export: rename EIO surfaces and preserves the prior CSV', () => {
  const dir = temporaryDirectory('watchlist-eio');
  try {
    assertRenameFailure(runExport(dir, 'rename-eio'));
  } finally {
    cleanup(dir);
  }
});

'use strict';

// Public-tree guard (A0/S1, 14.10.2026): screener-data and its GitHub Pages export are PUBLIC, the contrarian (antizyklisch)
// signals and fund names are private. Three checks, run standalone (node tests/kein-signal-im-oeffentlichen-baum.test.js,
// exit 0/1), by the test gate, and as a hard step in the scoring job right before the Pages deploy:
//   1. no tracked path contains "contrarian-history" or "antizyklisch";
//   2. no JSON key (any depth, any case) of outputs/findash-export/v1 is a signal or judgement key. Keys, not free text: the
//      word "contrarian" stands harmlessly in a few tracked data files, a text search would be red from day one;
//   3. no tracked text file and no file of the export tree contains a guarded term (lib/guard-terms.js: PII_GUARD_TERMS plus
//      FONDS_GUARD_TERMS). The terms never sit in the repository; without them check 3 skips loudly.
// Output is limited to paths and key names. The break-once tests plant a key, a path and a term in temporary directories only.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { spawnSync } = require('node:child_process');
const { guardTerms, guardArmed, filesContaining } = require('../lib/guard-terms');

const REPO = path.join(__dirname, '..');
const EXPORT_DIR = path.join(REPO, 'outputs', 'findash-export', 'v1');
const FORBIDDEN_PATH = /contrarian-history|antizyklisch/i;
// Lower-case; the check lower-cases every key before it looks here (so pEp and rangAntizyklisch are covered).
const FORBIDDEN_KEYS = new Set(['signal', 'signale', 'testsignal', 'signal_available_at', 'urteil', 'judgement', 'verdict',
  'einstieg', 'ampel', 'fakten_ampel', 'hauptliste', 'kandidat', 'schatten', 'kaufprofil', 'antizyklisch', 'contrarian',
  'pep', 'rangantizyklisch']);

function trackedPaths(cwd) {
  const r = spawnSync('git', ['ls-files', '-z'], { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  assert.equal(r.status, 0, `git ls-files failed (${r.status})`);
  return r.stdout.split('\0').filter(Boolean);
}

function filesUnder(dir) {
  const out = [];
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.isFile()) out.push(p);
    }
  }
  return out.sort();
}

// "relative/path.json: key, key" for every JSON file under dir with a forbidden key at any depth. A file that does not parse
// cannot be inspected and counts as an offender too.
function keyOffenders(dir) {
  const out = [];
  for (const file of filesUnder(dir).filter((f) => /\.json$/i.test(f))) {
    const rel = path.relative(dir, file).split(path.sep).join('/');
    let json;
    try { json = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { out.push(`${rel}: not parseable`); continue; }
    const found = new Set();
    const stack = [json];
    while (stack.length) {
      const v = stack.pop();
      if (Array.isArray(v)) stack.push(...v);
      else if (v && typeof v === 'object') {
        for (const [k, child] of Object.entries(v)) {
          if (FORBIDDEN_KEYS.has(k.toLowerCase())) found.add(k);
          stack.push(child);
        }
      }
    }
    if (found.size) out.push(`${rel}: ${[...found].sort().join(', ')}`);
  }
  return out;
}

// Relative paths of the files under dir that contain one of the terms (lower-case), as plain case-insensitive text.
function exportFilesContaining(terms, dir) {
  return filesUnder(dir).filter((file) => {
    const text = fs.readFileSync(file, 'utf8').toLowerCase();
    return terms.some((t) => text.includes(t));
  }).map((file) => path.relative(dir, file).split(path.sep).join('/'));
}

const exportExists = fs.existsSync(EXPORT_DIR);
if (!exportExists) console.log('NOTE: no export tree at outputs/findash-export/v1, only the tracked-path and tracked-file checks run here');
else if (!filesUnder(EXPORT_DIR).some((f) => /\.json$/i.test(f))) console.log('NOTE: outputs/findash-export/v1 holds no JSON file, the key check inspects nothing');

const terms = guardArmed() ? guardTerms() : [];
const skip = terms.length ? false : 'public-tree term guard not armed: PII_GUARD_TERMS / FONDS_GUARD_TERMS (or *_FILE) missing';
if (skip && process.env.GITHUB_ACTIONS) console.log('::warning::' + skip);

test('no tracked path contains contrarian-history or antizyklisch', () => {
  const offenders = trackedPaths(REPO).filter((p) => FORBIDDEN_PATH.test(p));
  assert.deepEqual(offenders, [], 'Contrarian path(s) tracked: ' + offenders.join(', '));
});

test('no JSON key of the export tree is a signal or judgement key', { skip: exportExists ? false : 'no export tree' }, () => {
  const offenders = keyOffenders(EXPORT_DIR);
  assert.deepEqual(offenders, [], 'Forbidden key(s) in the export tree: ' + offenders.join(' | '));
});

test('no tracked file and no export file carries a guarded term', { skip }, () => {
  const offenders = [...filesContaining(terms).map((p) => 'tracked ' + p),
    ...(exportExists ? exportFilesContaining(terms, EXPORT_DIR).map((p) => 'export ' + p) : [])];
  assert.deepEqual(offenders, [], 'Guarded term in file(s): ' + offenders.join(', '));
});

test('the key guard goes red on a planted key and ignores free text (break once, temporary export tree)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tree-guard-keys-'));
  try {
    fs.mkdirSync(path.join(dir, 'sub'));
    fs.writeFileSync(path.join(dir, 'rows.json'), JSON.stringify({ rows: [{ signal: 1 }] }));
    fs.writeFileSync(path.join(dir, 'sub', 'deep.json'), JSON.stringify({ a: { b: [{ Verdict: 2, pEp: 3 }] } }));
    fs.writeFileSync(path.join(dir, 'text.json'), JSON.stringify({ note: 'signal contrarian hauptliste', contrarianish: 1 }));
    assert.deepEqual(keyOffenders(dir), ['rows.json: signal', 'sub/deep.json: Verdict, pEp']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the path and term guards find a planted path and term (break once, temporary git repository)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tree-guard-repo-'));
  const planted = 'zz-planted-guard-term-0001';
  try {
    const git = (...a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8' });
    git('init', '-q');
    fs.mkdirSync(path.join(dir, 'data', 'Antizyklisch'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'data', 'Antizyklisch', 'x.txt'), 'x\n');
    fs.writeFileSync(path.join(dir, 'probe.txt'), 'prefix ' + planted.toUpperCase() + ' suffix\n');
    git('add', '-A');
    // Like the real export tree: present on disk, not tracked, so only the plain scan of the directory can see it.
    fs.mkdirSync(path.join(dir, 'export'));
    fs.writeFileSync(path.join(dir, 'export', 'a.json'), JSON.stringify({ name: 'Prefix ' + planted.toUpperCase() }));
    assert.deepEqual(trackedPaths(dir).filter((p) => FORBIDDEN_PATH.test(p)), ['data/Antizyklisch/x.txt']);
    assert.deepEqual(filesContaining([planted], dir), ['probe.txt']);
    assert.deepEqual(exportFilesContaining([planted], path.join(dir, 'export')), ['a.json']);
    assert.deepEqual(filesContaining(['zz-absent-term-0002'], dir), []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('guardTerms is the union of PII_GUARD_TERMS and FONDS_GUARD_TERMS, as variable and as file', () => {
  const names = ['PII_GUARD_TERMS', 'FONDS_GUARD_TERMS', 'PII_GUARD_TERMS_FILE', 'FONDS_GUARD_TERMS_FILE'];
  const saved = Object.fromEntries(names.map((n) => [n, process.env[n]]));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tree-guard-terms-'));
  try {
    for (const n of names) delete process.env[n];
    assert.equal(guardArmed(), false);
    process.env.PII_GUARD_TERMS = 'zz-pii-term-0003\nshort';
    process.env.FONDS_GUARD_TERMS = 'ZZ-Fonds-Term-0004\r\n';
    assert.equal(guardArmed(), true);
    const both = guardTerms();
    assert.ok(both.includes('zz-pii-term-0003') && both.includes('zz-fonds-term-0004'), 'one secret is missing from the union');
    assert.ok(!both.includes('short'), 'terms under six characters must be dropped');
    delete process.env.PII_GUARD_TERMS;
    delete process.env.FONDS_GUARD_TERMS;
    const file = path.join(dir, 'fonds.txt');
    fs.writeFileSync(file, 'zz-fonds-file-0005\n');
    process.env.FONDS_GUARD_TERMS_FILE = file;
    assert.equal(guardArmed(), true);
    assert.ok(guardTerms().includes('zz-fonds-file-0005'), 'FONDS_GUARD_TERMS_FILE is not read');
  } finally {
    for (const n of names) { if (saved[n] === undefined) delete process.env[n]; else process.env[n] = saved[n]; }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

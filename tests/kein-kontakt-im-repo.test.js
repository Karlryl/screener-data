'use strict';

// PII guard (26.09.2026, rebuilt 13.10.2026): this repo is PUBLIC. The SEC User-Agent contact is read only at runtime from
// process.env.SEC_CONTACT (lib/sec-user-agent.js) and must never sit in a tracked file.
//
// The terms this guard looks for (the maintainer's private address and full name) are never stored in the repository, not even
// as a fingerprint: an unsalted sha256 of a name plus its word lengths could be reversed by trying names (blind review 13.10.2026).
// They come from the environment: PII_GUARD_TERMS (an Actions secret, one term per line) or, on the maintainer's machine, the file
// named in PII_GUARD_TERMS_FILE. Addresses in SEC_CONTACT are added. Without terms the guard skips loudly instead of passing
// silently. Only paths are ever printed.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { spawnSync } = require('node:child_process');

const REPO = path.join(__dirname, '..');
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

function guardTerms() {
  let raw = process.env.PII_GUARD_TERMS || '';
  if (!raw && process.env.PII_GUARD_TERMS_FILE && fs.existsSync(process.env.PII_GUARD_TERMS_FILE)) {
    raw = fs.readFileSync(process.env.PII_GUARD_TERMS_FILE, 'utf8');
  }
  const fromContact = (process.env.SEC_CONTACT || '').match(EMAIL) || [];
  return [...new Set([...raw.split(/\r?\n/), ...fromContact]
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length >= 6 && !/@example\.|\.invalid$|\.test$/.test(s)))];
}

// Every tracked text file that contains one of the terms, case-insensitive, as plain text. The terms go to git through a
// temporary file that is removed again; they never reach the output.
function filesContaining(terms) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pii-guard-'));
  try {
    const list = path.join(dir, 'terms.txt');
    fs.writeFileSync(list, terms.join('\n') + '\n', { mode: 0o600 });
    const r = spawnSync('git', ['grep', '-I', '-i', '-F', '-l', '-z', '-f', list],
      { cwd: REPO, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
    if (r.status === 1) return []; // git grep: 1 = no match
    assert.equal(r.status, 0, `git grep failed (${r.status})`);
    return r.stdout.split('\0').filter(Boolean);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

// Armed only by explicit terms: an address in SEC_CONTACT alone is not the maintainer's data (blind review 13.10.2026).
const armed = Boolean(process.env.PII_GUARD_TERMS || (process.env.PII_GUARD_TERMS_FILE && fs.existsSync(process.env.PII_GUARD_TERMS_FILE)));
const terms = armed ? guardTerms() : [];
const skip = terms.length ? false : 'PII guard not armed: PII_GUARD_TERMS / PII_GUARD_TERMS_FILE missing';
if (skip && process.env.GITHUB_ACTIONS) console.log('::warning::' + skip);

test('no tracked file carries the maintainer\'s private address or full name', { skip }, () => {
  const offenders = filesContaining(terms);
  assert.deepEqual(offenders, [], 'Private contact data in tracked file(s): ' + offenders.join(', '));
});

test('the guard finds a planted term (break once, in a temporary repository)', { skip }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pii-guard-repo-'));
  try {
    const git = (...a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8' });
    git('init', '-q');
    fs.writeFileSync(path.join(dir, 'probe.txt'), 'prefix ' + terms[0].toUpperCase() + ' suffix\n');
    git('add', 'probe.txt');
    const r = spawnSync('git', ['grep', '-I', '-i', '-F', '-l', '-e', terms[0]], { cwd: dir, encoding: 'utf8' });
    assert.equal(r.status, 0, 'a planted term was not found');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

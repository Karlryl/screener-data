'use strict';

// tests/helpers/history-anchor.js: a pinned commit is found again after a rewrite that keeps
// dates and subjects, and nothing else is accepted. Synthetic repositories and synthetic
// identities only.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { spawnSync } = require('node:child_process');

const { ANCHORS, resolveCommit } = require('./helpers/history-anchor');

const DATE = '1700000000 +0200';
const made = [];
test.after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });

function git(cwd, args, identity = 'Alpha Tester') {
  const env = { ...process.env, GIT_AUTHOR_DATE: DATE, GIT_COMMITTER_DATE: DATE };
  for (const k of Object.keys(env)) if (/^GIT_(DIR|WORK_TREE|INDEX_FILE)$/.test(k)) delete env[k];
  const mail = `${identity.split(' ')[0].toLowerCase()}@example.invalid`;
  const r = spawnSync('git', ['-c', `user.name=${identity}`, '-c', `user.email=${mail}`,
    '-c', 'commit.gpgsign=false', '-c', 'init.defaultBranch=main', ...args], { cwd, env, encoding: 'utf8' });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

function repoWithCommit(prefix, identity, content = 'same bytes\n') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  made.push(dir);
  git(dir, ['init', '-q']);
  fs.writeFileSync(path.join(dir, 'a.txt'), content);
  git(dir, ['add', 'a.txt']);
  git(dir, ['commit', '-q', '-m', 'Synthetic anchor subject'], identity);
  return { dir, id: git(dir, ['rev-parse', 'HEAD']) };
}

const anchorFor = (id, subject = 'Synthetic anchor subject') =>
  [{ id, authorDate: DATE, committerDate: DATE, subject }];

test('registry: unique ids and fingerprints; every anchor in this clone matches it', () => {
  assert.equal(new Set(ANCHORS.map((a) => a.id)).size, ANCHORS.length);
  assert.equal(new Set(ANCHORS.map((a) => [a.authorDate, a.committerDate, a.subject].join('\0'))).size, ANCHORS.length);
  const missing = [];
  for (const a of ANCHORS) {
    assert.match(a.id, /^[0-9a-f]{40}$/);
    const resolved = resolveCommit(a.id); // throws on a fingerprint mismatch
    if (resolved === a.id && spawnSync('git', ['cat-file', '-e', `${a.id}^{commit}`],
      { cwd: path.join(__dirname, '..') }).status !== 0) missing.push(a.id.slice(0, 10));
  }
  // Never silent: an anchor this clone does not carry is named.
  if (missing.length) console.log(`history anchors not in this clone: ${missing.join(', ')}`);
});

test('a rewritten copy (other identity, same dates and subject) is found by fingerprint', () => {
  const before = repoWithCommit('anchor-before-', 'Alpha Tester');
  const after = repoWithCommit('anchor-after-', 'Beta Tester');
  assert.notEqual(before.id, after.id, 'the synthetic rewrite must change the id');
  const anchors = anchorFor(before.id);
  assert.equal(resolveCommit(before.id.slice(0, 10), { repo: before.dir, anchors }), before.id.slice(0, 10));
  assert.equal(resolveCommit(before.id.slice(0, 10), { repo: after.dir, anchors }), after.id);
});

test('an existing pinned commit with another fingerprint is rejected', () => {
  const r = repoWithCommit('anchor-mismatch-', 'Alpha Tester');
  assert.throws(() => resolveCommit(r.id, { repo: r.dir, anchors: anchorFor(r.id, 'Another subject') }),
    /fingerprint differs/);
});

test('two candidates with the same fingerprint are rejected, never guessed', () => {
  const pinned = repoWithCommit('anchor-pinned-', 'Alpha Tester').id;
  const r = repoWithCommit('anchor-twice-', 'Beta Tester');
  git(r.dir, ['checkout', '-q', '--orphan', 'other']);
  fs.writeFileSync(path.join(r.dir, 'a.txt'), 'other bytes\n');
  git(r.dir, ['add', 'a.txt']);
  git(r.dir, ['commit', '-q', '-m', 'Synthetic anchor subject'], 'Beta Tester');
  assert.throws(() => resolveCommit(pinned, { repo: r.dir, anchors: anchorFor(pinned) }), /2 commits share/);
});

test('no candidate: the pinned id comes back unchanged; an unregistered pin throws', () => {
  const pinned = repoWithCommit('anchor-gone-', 'Alpha Tester').id;
  const r = repoWithCommit('anchor-unrelated-', 'Beta Tester');
  git(r.dir, ['commit', '-q', '--amend', '-m', 'Unrelated subject'], 'Beta Tester');
  assert.equal(resolveCommit(pinned, { repo: r.dir, anchors: anchorFor(pinned) }), pinned);
  assert.throws(() => resolveCommit('0123456789', { repo: r.dir, anchors: anchorFor(pinned) }), /not registered/);
  assert.throws(() => resolveCommit(pinned.slice(0, 6), { repo: r.dir, anchors: anchorFor(pinned) }), /not registered/);
});

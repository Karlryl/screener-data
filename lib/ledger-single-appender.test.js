'use strict';

// API contracts on synthetic Git topology only; never reads a real register.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { checkSingleAppender, resolveBaseRef, SingleAppenderViolation } = require('./ledger-single-appender.js');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (error) { fail++; console.error('FAIL   ' + name + '\n' + error.stack); }
}

const tempBase = fs.realpathSync(os.tmpdir());
const owned = fs.realpathSync(fs.mkdtempSync(path.join(tempBase, 's02-appender-')));
const repoDir = path.join(owned, 'repo');
const ledgers = ['unit-ledgers/first.txt', 'unit-ledgers/second.txt'];
const gitEnv = {
  ...process.env,
  GIT_AUTHOR_NAME: 'S02 synthetic fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
  GIT_COMMITTER_NAME: 'S02 synthetic fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
  GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: path.join(owned, 'absent-global-config'),
  GIT_TERMINAL_PROMPT: '0',
};
function git(...args) {
  return execFileSync('git', [
    '-c', 'core.hooksPath=' + path.join(owned, 'no-hooks'),
    '-c', 'core.autocrlf=false', '-c', 'commit.gpgsign=false', ...args,
  ], { cwd: repoDir, env: gitEnv, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
function write(rel, value) {
  const target = path.join(repoDir, ...rel.split('/'));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, value, 'utf8');
}
function commit(subject) {
  git('add', '--all');
  git('commit', '--quiet', '-m', 'S02 synthetic fixture: ' + subject,
    '-m', 'Codex-Build: 01a0d6ba-4f55-7493-8d26-77c2bf5f7311');
}

try {
  fs.mkdirSync(repoDir);
  git('init', '--quiet', '-b', 'fixture-base');
  write('notes/base.txt', 'synthetic base\n');
  for (const ledger of ledgers) write(ledger, 'synthetic initial contents\n');
  commit('base');
  const base = git('rev-parse', 'HEAD');
  git('checkout', '--quiet', '-b', 'fixture-head');

  test('an empty head range returns empty evidence, using the default HEAD', () => {
    assert.deepEqual(checkSingleAppender({ repoDir, baseRef: 'fixture-base', ledgerRels: ledgers }),
      { verdict: 'NO_LEDGER_APPEND', changed: [], foreignPaths: [] });
  });

  write('notes/change.txt', 'synthetic non-ledger work\n');
  commit('other work');
  test('a non-ledger range reports its exact changed path without a violation', () => {
    assert.deepEqual(checkSingleAppender({ repoDir, baseRef: 'fixture-base', ledgerRels: ledgers }),
      { verdict: 'NO_LEDGER_APPEND', changed: ['notes/change.txt'], foreignPaths: [] });
  });

  test('base resolution preserves candidate order and rejects a blob as a commit', () => {
    assert.equal(resolveBaseRef(repoDir, []), null);
    assert.equal(resolveBaseRef(repoDir, ['missing-one', 'missing-two']), null);
    assert.equal(resolveBaseRef(repoDir, ['missing', 'fixture-base', 'fixture-head']), 'fixture-base');
    assert.equal(resolveBaseRef(repoDir, ['fixture-head', 'fixture-base']), 'fixture-head');
    assert.equal(resolveBaseRef(repoDir, [base, 'fixture-head']), base);
    const blob = git('rev-parse', 'HEAD:notes/base.txt');
    assert.equal(resolveBaseRef(repoDir, [blob, 'fixture-base']), 'fixture-base');
  });

  for (const ledger of ledgers) write(ledger, 'synthetic appended contents\n');
  commit('append in a separate commit');
  test('a mixed range exposes complete typed evidence for caller-supplied ledgers', () => {
    assert.throws(() => checkSingleAppender({ repoDir, baseRef: 'fixture-base', ledgerRels: ledgers }), error => {
      assert.ok(error instanceof SingleAppenderViolation);
      assert.equal(error.name, 'SingleAppenderViolation');
      assert.deepEqual(error.changed, ['notes/change.txt', ...ledgers]);
      assert.deepEqual(error.foreignPaths, ['notes/change.txt']);
      assert.match(error.message, /fixture-base\.\.\.HEAD touches unit-ledgers\/first\.txt, unit-ledgers\/second\.txt/);
      assert.match(error.message, /1 other path\(s\) \[notes\/change\.txt\]/);
      return true;
    });
  });

  git('checkout', '--quiet', '-b', 'fixture-mini', base);
  for (const ledger of ledgers) write(ledger, 'synthetic mini-PR contents\n');
  commit('two-ledger mini-PR');
  test('a custom two-ledger mini-PR is allowed and single-path override takes precedence', () => {
    assert.deepEqual(checkSingleAppender({ repoDir, baseRef: 'fixture-base', ledgerRels: ledgers }),
      { verdict: 'LEDGER_ONLY_MINI_PR', changed: ledgers, foreignPaths: [] });
    assert.throws(() => checkSingleAppender({ repoDir, baseRef: 'fixture-base', ledgerRel: ledgers[0], ledgerRels: ledgers }), error => {
      assert.ok(error instanceof SingleAppenderViolation);
      assert.deepEqual(error.changed, ledgers);
      assert.deepEqual(error.foreignPaths, [ledgers[1]]);
      return true;
    });
  });

  git('checkout', '--quiet', 'fixture-base');
  write('notes/base-only.txt', 'synthetic base advances independently\n');
  commit('independent base work');
  test('independent base changes do not contaminate the head range', () => {
    let result;
    assert.doesNotThrow(() => {
      result = checkSingleAppender({ repoDir, baseRef: 'fixture-base', headRef: 'fixture-mini', ledgerRels: ledgers });
    }, 'three-dot comparison must ignore work made only on the base');
    assert.deepEqual(result, { verdict: 'LEDGER_ONLY_MINI_PR', changed: ledgers, foreignPaths: [] });
  });

  test('invalid arguments and an unusable repository fail loudly', () => {
    assert.throws(() => checkSingleAppender({ baseRef: 'HEAD' }),
      { name: 'TypeError', message: 'checkSingleAppender: repoDir is required' });
    assert.throws(() => checkSingleAppender({ repoDir }),
      { name: 'TypeError', message: 'checkSingleAppender: baseRef is required' });
    assert.throws(() => checkSingleAppender({ repoDir, baseRef: 'HEAD', ledgerRels: ['unit-ledgers\\first.txt'] }),
      { name: 'TypeError', message: 'checkSingleAppender: ledgerRel must use forward slashes, got unit-ledgers\\first.txt' });
    assert.throws(() => resolveBaseRef(path.join(owned, 'missing-repo'), ['fixture-base']),
      error => error.code === 'ENOENT' && typeof error.status !== 'number');
  });
} catch (error) {
  fail++;
  console.error('FAIL   synthetic Git fixture setup\n' + error.stack);
} finally {
  try {
    assert.equal(fs.realpathSync(owned), owned, 'cleanup root must still be the directory we created');
    assert.equal(path.dirname(owned), tempBase, 'cleanup must stay directly within the chosen temp directory');
    assert.ok(path.basename(owned).startsWith('s02-appender-'));
    fs.rmSync(owned, { recursive: true, force: true, maxRetries: 3, retryDelay: 20 });
    assert.equal(fs.existsSync(owned), false, 'the entire owned Git fixture must be removed');
  } catch (error) {
    fail++;
    console.error('FAIL   owned Git fixture cleanup\n' + error.stack);
  }
}
console.log(`ledger-single-appender.test.js: ${pass} ok, ${fail} fail`);
process.exitCode = fail ? 1 : 0;

'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
test('the real history-anchor suite passes with inherited synthetic author and committer identities', () => {
  const env = { ...process.env, GIT_AUTHOR_NAME: 'Inherited Test', GIT_AUTHOR_EMAIL: 'inherited@example.invalid',
    GIT_COMMITTER_NAME: 'Inherited Test', GIT_COMMITTER_EMAIL: 'inherited@example.invalid',
    GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
  delete env.NODE_TEST_CONTEXT;
  const r = spawnSync(process.execPath, ['--test', '--test-reporter=tap', require.resolve('./history-anchor.test')], { env, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /# fail 0/);
});

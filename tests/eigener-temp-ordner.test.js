'use strict';
/**
 * Guard for tests/hilfen/eigener-temp-ordner.js (P97, 06.10.2026).
 * Each case runs a small producer in a child process whose TMP/TEMP/TMPDIR point at a
 * private root, so the user's real %TEMP% is never read or swept. After the child ends,
 * the private root must hold no directory the helper created: after success, after a
 * failed assertion, after an uncaught setup error and after process.exit(1).
 * Break-once: delete the process.once('exit', ...) registration (or the rmSync) in the
 * helper and the first four cases turn red.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { eigenerTempOrdner } = require('./hilfen/eigener-temp-ordner.js');

const HELFER = path.join(__dirname, 'hilfen', 'eigener-temp-ordner.js');
let fail = 0;
function check(name, fn) {
  try { fn(); console.log('  ok   ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + ': ' + (e && e.message || e)); }
}

// One private root per case, itself owned by the helper (removed when this file ends).
function lauf(koerper) {
  const root = eigenerTempOrdner('bh-waechter-');
  const code = `const { eigenerTempOrdner } = require(${JSON.stringify(HELFER)});
const fs = require('node:fs'), path = require('node:path');
const d = eigenerTempOrdner('bh-probe-'); fs.mkdirSync(path.join(d, 'tief', 'er'), { recursive: true });
fs.writeFileSync(path.join(d, 'tief', 'er', 'x.json'), '{}');
${koerper}`;
  const env = { ...process.env, TMP: root, TEMP: root, TMPDIR: root };
  const r = spawnSync(process.execPath, ['-e', code], { env, encoding: 'utf8' });
  return { root, status: r.status, rest: fs.readdirSync(root), stderr: r.stderr };
}

check('success: the owned directory is gone after a normal end', () => {
  const r = lauf('');
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.rest, []);
});

check('failed assertion (exitCode 1): the owned directory is still removed', () => {
  const r = lauf("process.exitCode = 1; console.log('FAIL simulated');");
  assert.equal(r.status, 1);
  assert.deepEqual(r.rest, []);
});

check('uncaught error during setup: the owned directory is still removed', () => {
  const r = lauf("eigenerTempOrdner('bh-zweit-'); throw new Error('setup broke');");
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /setup broke/);
  assert.deepEqual(r.rest, []);
});

check('process.exit(1) in a check()-style runner: the owned directory is still removed', () => {
  const r = lauf('process.exit(1);');
  assert.equal(r.status, 1);
  assert.deepEqual(r.rest, []);
});

check('a directory the helper did not create stays untouched', () => {
  const r = lauf("fs.mkdirSync(path.join(require('node:os').tmpdir(), 'fremd-ordner'));");
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.rest, ['fremd-ordner']);
});

check('the guard sees a leftover: without the exit registration the directory remains', () => {
  // Simulates the broken helper inside the child only; the helper file is not changed.
  const r = lauf("process.removeAllListeners('exit');");
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.rest.length, 1);
  assert.match(r.rest[0], /^bh-probe-/);
});

console.log(`eigener-temp-ordner: ${6 - fail} ok, ${fail} fail`);
if (fail) process.exitCode = 1;

'use strict';
// Fixture for tests/clock-shift-gate.test.js. NOT a gate test (tests/fixtures/ is not discovered).
// A child process spawned by the test reads the clock: the shift must reach it through NODE_OPTIONS.
// Red under the guard only if the child inherited the shifted clock.
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');

test('child process clock is the real clock', () => {
  const r = spawnSync(process.execPath, ['-e', 'console.log(Date.now())'], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  const childNow = Number(r.stdout.trim());
  const realNow = performance.timeOrigin + performance.now();
  assert.ok(Math.abs(childNow - realNow) < 864e5, `child clock is ${((childNow - realNow) / 864e5).toFixed(1)} days from the real clock`);
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { beurteile } = require('../scripts/live-universum-gate.js');

test('preserves a termination signal as the failure reason', () => {
  const result = beurteile('worker.test.js', 1, '', { signal: 'SIGKILL' });

  assert.equal(result.status, 'fail');
  assert.equal(result.grund, 'Signal SIGKILL');
});

test('uses the exit code when no signal metadata exists', () => {
  const result = beurteile('worker.test.js', 2, '', {});

  assert.equal(result.status, 'fail');
  assert.equal(result.grund, 'Exitcode 2');
});

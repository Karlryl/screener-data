'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { beurteile } = require('../scripts/live-universum-gate.js');

test('preserves the process error code in the failure reason', () => {
  const result = beurteile('worker.test.js', 1, '', { code: 'ENOBUFS' });

  assert.equal(result.status, 'fail');
  assert.match(result.grund, /\bENOBUFS\b/);
});

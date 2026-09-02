'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { validateMarker, SCHEMA } = require('../scripts/pipeline-status.js');

const VALID_MARKER = {
  schema: SCHEMA,
  status: 'success',
  attempt_run_id: '31769403945',
  run_attempt: 1,
  head_sha: 'a'.repeat(40),
  started_at: '2026-09-02T00:00:00Z',
  completed_at: '2026-09-02T00:01:00Z',
  last_success_at: null,
  failed_job: null,
  reason: null,
};

test('accepts an integer pipeline run attempt', () => {
  assert.deepEqual(validateMarker(VALID_MARKER), []);
});

test('rejects a positive fractional pipeline run attempt', () => {
  const errors = validateMarker({ ...VALID_MARKER, run_attempt: 1.5 });

  assert.equal(errors.length, 1);
  assert.match(errors[0], /^run_attempt=/);
});

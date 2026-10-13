'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { SCHEMA, validateMarker } = require('../scripts/pipeline-status');

function marker(headSha) {
  return {
    schema: SCHEMA,
    status: 'success',
    attempt_run_id: '31769403945',
    run_attempt: 1,
    head_sha: headSha,
    started_at: '2026-08-16T05:00:00Z',
    completed_at: '2026-08-16T05:37:00Z',
    failed_job: null,
    reason: null,
    last_success_at: '2026-08-16T05:37:00Z',
  };
}

test('pipeline status accepts a 40-character hexadecimal head SHA', () => {
  assert.deepEqual(validateMarker(marker('a'.repeat(40))), []);
});

test('pipeline status rejects a 40-character non-hexadecimal head SHA', () => {
  const errors = validateMarker(marker('a'.repeat(39) + 'g'));

  assert.equal(errors.length, 1);
  assert.match(errors[0], /^head_sha=/);
});

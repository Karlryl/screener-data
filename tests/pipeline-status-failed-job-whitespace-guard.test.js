'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { validateMarker, SCHEMA } = require('../scripts/pipeline-status.js');

const VALID_FAILURE = Object.freeze({
  schema: SCHEMA,
  status: 'failure',
  attempt_run_id: '31769403945',
  run_attempt: 1,
  head_sha: 'a'.repeat(40),
  started_at: '2026-09-02T01:00:00Z',
  completed_at: '2026-09-02T01:05:00Z',
  failed_job: 'merge',
  reason: 'merge=failure',
  last_success_at: null,
});

test('a failure marker with a named failed job remains valid', () => {
  assert.deepEqual(validateMarker(VALID_FAILURE), []);
});

for (const [name, failedJob] of [
  ['space', ' '],
  ['tab', '\t'],
  ['line break', '\r\n'],
]) {
  test(`a ${name}-only failed job is rejected`, () => {
    const errors = validateMarker({ ...VALID_FAILURE, failed_job: failedJob });
    assert.equal(errors.length, 1);
    assert.match(errors[0], /failed_job fehlt bei status=failure/);
  });
}

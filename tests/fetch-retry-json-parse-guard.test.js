'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { fetchJson } = require('../lib/fetch-retry.js');

function inMemoryResponse(body) {
  return {
    pauseMs: 0,
    _get: async () => ({ code: 200, body: Buffer.from(body), headers: {} }),
    _schlaf: async () => { throw new Error('unexpected retry sleep'); },
  };
}

test('parses a valid JSON response body', async () => {
  const result = await fetchJson(
    'https://fetch-json-valid.invalid/payload',
    inMemoryResponse('{"ok":true}'),
  );

  assert.deepEqual(result, { ok: true });
});

test('rejects a malformed JSON response body instead of returning a fallback', async () => {
  await assert.rejects(
    fetchJson(
      'https://fetch-json-malformed.invalid/payload',
      inMemoryResponse('{"ok":'),
    ),
    /Antwort ist kein JSON/,
  );
});

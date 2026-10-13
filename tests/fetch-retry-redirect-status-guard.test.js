'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { fetchBuffer, _internals } = require('../lib/fetch-retry.js');

function response(code, headers = {}) {
  return { code, body: Buffer.alloc(0), headers };
}

function harness(result) {
  let getCalls = 0;
  let sleepCalls = 0;

  return {
    opts: {
      pauseMs: 0,
      versuche: 3,
      _get: async () => {
        getCalls += 1;
        return result;
      },
      _schlaf: async () => {
        sleepCalls += 1;
      },
    },
    getCalls: () => getCalls,
    sleepCalls: () => sleepCalls,
  };
}

async function withCleanHost(url, run) {
  try {
    await run();
  } finally {
    _internals.letzterAbruf.delete(new URL(url).host);
  }
}

test('HTTP 200 returns the injected response without retrying', async () => {
  const url = 'https://redirect-control.invalid/data';
  const ok = response(200);
  const h = harness(ok);

  await withCleanHost(url, async () => {
    assert.equal((await fetchBuffer(url, h.opts)).code, 200);
    assert.equal(h.getCalls(), 1);
    assert.equal(h.sleepCalls(), 0);
  });
});

test('HTTP 302 fails fast instead of returning a redirect response', async () => {
  const url = 'https://redirect-status-guard.invalid/data';
  const redirect = response(302, { location: 'https://redirect-target.invalid/' });
  const h = harness(redirect);

  await withCleanHost(url, async () => {
    await assert.rejects(() => fetchBuffer(url, h.opts), /HTTP 302/);
    assert.equal(h.getCalls(), 1);
    assert.equal(h.sleepCalls(), 0);
  });
});

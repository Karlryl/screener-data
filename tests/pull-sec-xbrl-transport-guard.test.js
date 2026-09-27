'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const https = require('node:https');
const test = require('node:test');
const { _get: get } = require('../pull-sec-xbrl.js');

const SEC_URL = 'https://data.sec.gov/api/xbrl/companyfacts/CIK0000000001.json';
const TARGET_URL = 'https://data.sec.gov/api/xbrl/companyfacts/CIK0000320193.json';
const LAST_MODIFIED = 'Thu, 24 Sep 2026 12:00:00 GMT';
const BODY = '{"facts":{"us-gaap":{}}}';

// Each test owns the module-object stub until its request chain settles.
async function withTransport(steps, verify) {
  const originalGet = https.get;
  const calls = [];
  try {
    https.get = (url, options, onResponse) => {
      const step = steps[calls.length];
      assert.ok(step, 'unexpected HTTPS request: ' + url);
      const call = { url, headers: { ...options.headers }, destroyed: false, resumed: false };
      calls.push(call);
      const request = new EventEmitter();
      request.setTimeout = (ms, onTimeout) => {
        call.timeoutMs = ms;
        if (step.timeout) onTimeout();
        return request;
      };
      request.destroy = () => { call.destroyed = true; return request; };

      if (!step.timeout) queueMicrotask(() => {
        const response = new EventEmitter();
        response.statusCode = step.statusCode;
        response.headers = step.headers || {};
        response.resume = () => { call.resumed = true; return response; };
        onResponse(response);
        if (step.statusCode === 200) {
          for (const chunk of step.chunks || [Buffer.from(BODY)]) response.emit('data', chunk);
          response.emit('end');
        }
      });
      return request;
    };

    await verify(calls);
    assert.equal(calls.length, steps.length, 'all scripted responses must be consumed');
  } finally {
    https.get = originalGet;
  }
}

test('302 relative Location resolves against the request URL', async () => {
  await withTransport([
    { statusCode: 302, headers: { location: '/api/xbrl/companyfacts/CIK0000320193.json' } },
    { statusCode: 200 },
  ], async calls => {
    assert.deepEqual(await get(SEC_URL), { body: BODY, lastModified: null });
    assert.deepEqual(calls.map(call => call.url), [SEC_URL, TARGET_URL]);
    assert.equal(calls[0].resumed, true, 'redirect response must be drained');
  });
});

test('302 absolute Location reaches the unchanged absolute URL', async () => {
  await withTransport([
    { statusCode: 302, headers: { location: TARGET_URL } },
    { statusCode: 200 },
  ], async calls => {
    assert.deepEqual(await get(SEC_URL), { body: BODY, lastModified: null });
    assert.deepEqual(calls.map(call => call.url), [SEC_URL, TARGET_URL]);
    assert.equal(calls[0].resumed, true);
  });
});

test('five redirect hops succeed and a sixth rejects before another request', async () => {
  const redirects = Array.from({ length: 6 }, (_, index) => ({
    statusCode: 302, headers: { location: 'https://data.sec.gov/redirect-' + (index + 1) },
  }));
  await withTransport([...redirects.slice(0, 5), { statusCode: 200 }], async calls => {
    assert.deepEqual(await get(SEC_URL), { body: BODY, lastModified: null });
    assert.equal(calls.length, 6);
    assert.equal(calls[5].url, 'https://data.sec.gov/redirect-5');
  });
  await withTransport(redirects, async calls => {
    await assert.rejects(get(SEC_URL), /too many redirects/);
    assert.deepEqual(calls.map(call => call.url), [
      SEC_URL, ...Array.from({ length: 5 }, (_, index) => 'https://data.sec.gov/redirect-' + (index + 1)),
    ]);
    assert.equal(calls.every(call => call.resumed), true);
  });
});

test('302 without Location rejects without another request', async () => {
  await withTransport([{ statusCode: 302 }], async calls => {
    await assert.rejects(get(SEC_URL), /redirect without Location/);
    assert.equal(calls[0].resumed, true);
  });
});

test('malformed Location rejects asynchronously with the source and Location', async () => {
  await withTransport([{ statusCode: 302, headers: { location: 'http://[' } }], async () => {
    await assert.rejects(get(SEC_URL), error => {
      assert.match(error.message, /invalid redirect Location/);
      assert.equal(error.message, 'invalid redirect Location "http://[" from ' + SEC_URL);
      return true;
    });
  });
});

test('304 returns the notModified sentinel', async () => {
  await withTransport([{ statusCode: 304 }], async () => {
    assert.deepEqual(await get(SEC_URL), { notModified: true });
  });
});

test('404 returns the notFound sentinel', async () => {
  await withTransport([{ statusCode: 404 }], async () => {
    assert.deepEqual(await get(SEC_URL), { notFound: true });
  });
});

test('500 rejection preserves its HTTP status code', async () => {
  await withTransport([{ statusCode: 500 }], async () => {
    await assert.rejects(get(SEC_URL), error => {
      assert.equal(error.message, 'HTTP 500');
      assert.equal(error.statusCode, 500);
      return true;
    });
  });
});

test('200 joins body chunks and returns Last-Modified or null', async () => {
  for (const lastModified of [LAST_MODIFIED, null]) {
    await withTransport([{
      statusCode: 200,
      headers: lastModified ? { 'last-modified': lastModified } : {},
      chunks: [Buffer.from(BODY.slice(0, 12)), Buffer.from(BODY.slice(12))],
    }], async () => {
      assert.deepEqual(await get(SEC_URL), { body: BODY, lastModified });
    });
  }
});

test('If-Modified-Since is present only when supplied and survives redirects', async () => {
  for (const ifModifiedSince of [undefined, LAST_MODIFIED]) {
    await withTransport([
      { statusCode: 302, headers: { location: TARGET_URL } },
      { statusCode: 200 },
    ], async calls => {
      await get(SEC_URL, ifModifiedSince);
      for (const call of calls) {
        assert.equal(Object.hasOwn(call.headers, 'If-Modified-Since'), ifModifiedSince !== undefined);
        assert.equal(call.headers['If-Modified-Since'], ifModifiedSince);
        assert.equal(call.headers.Accept, 'application/json');
      }
    });
  }
});

test('30-second timeout destroys the request and rejects', async () => {
  await withTransport([{ timeout: true }], async calls => {
    await assert.rejects(get(SEC_URL), /timeout/);
    assert.equal(calls[0].timeoutMs, 30000);
    assert.equal(calls[0].destroyed, true);
  });
});

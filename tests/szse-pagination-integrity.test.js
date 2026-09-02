#!/usr/bin/env node
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const https = require('https');
const { EventEmitter } = require('events');
const { fetchSzseUniverse } = require('../discovery/szse-cn.js');

function row(code, name = `Name ${code}`) {
  return { agdm: code, agjc: `<a><u>${name}</u></a>`, agssrq: '2020-01-01', bk: '主板' };
}

function pageBody(pagecount, recordcount, rows) {
  const metadata = {};
  if (pagecount !== undefined) metadata.pagecount = pagecount;
  if (recordcount !== undefined) metadata.recordcount = recordcount;
  return [{ metadata, data: rows }];
}

async function runFixture(specForPage) {
  const originalGet = https.get;
  const originalSetTimeout = global.setTimeout;
  const originalConsole = {
    log: console.log,
    warn: console.warn,
    error: console.error
  };
  const calls = [];
  const attempts = new Map();
  const unexpected = [];
  const messages = { log: [], warn: [], error: [] };

  https.get = (url, options, callback) => {
    const match = String(url).match(/[?&]PAGENO=(\d+)/);
    if (!match) throw new Error(`network tripwire: unexpected URL ${url}`);
    const page = Number(match[1]);
    const attempt = (attempts.get(page) || 0) + 1;
    attempts.set(page, attempt);
    calls.push(page);

    assert.equal(options.headers.Referer, 'https://www.szse.cn/');
    const spec = typeof specForPage === 'function'
      ? specForPage(page, attempt)
      : specForPage[page];
    if (!spec) {
      unexpected.push(page);
      throw new Error(`network tripwire: page ${page} was not configured`);
    }

    const request = new EventEmitter();
    request.setTimeout = () => request;
    request.destroy = () => {};

    process.nextTick(() => {
      if (spec.error) {
        request.emit('error', spec.error);
        return;
      }

      const response = new EventEmitter();
      response.statusCode = spec.statusCode === undefined ? 200 : spec.statusCode;
      response.headers = spec.headers || {};
      response.resume = () => {};
      callback(response);

      if (response.statusCode === 200) {
        process.nextTick(() => {
          const payload = spec.raw === undefined ? JSON.stringify(spec.body) : spec.raw;
          response.emit('data', Buffer.from(payload));
          response.emit('end');
        });
      }
    });

    return request;
  };

  // Keep the real request path under test while making production backoffs and
  // inter-page courtesy delays instantaneous.
  global.setTimeout = (fn, _ms, ...args) => {
    process.nextTick(() => fn(...args));
    return 0;
  };
  console.log = (...args) => messages.log.push(args.join(' '));
  console.warn = (...args) => messages.warn.push(args.join(' '));
  console.error = (...args) => messages.error.push(args.join(' '));

  let result;
  try {
    result = await fetchSzseUniverse();
  } finally {
    https.get = originalGet;
    global.setTimeout = originalSetTimeout;
    console.log = originalConsole.log;
    console.warn = originalConsole.warn;
    console.error = originalConsole.error;
  }

  assert.equal(https.get, originalGet, 'https.get must be restored after every fixture');
  assert.equal(global.setTimeout, originalSetTimeout, 'setTimeout must be restored after every fixture');
  assert.equal(console.log, originalConsole.log, 'console.log must be restored after every fixture');
  assert.equal(console.warn, originalConsole.warn, 'console.warn must be restored after every fixture');
  assert.equal(console.error, originalConsole.error, 'console.error must be restored after every fixture');
  assert.ok(calls.length > 0, 'network interceptor must be exercised');
  assert.deepEqual(unexpected, [], 'no request may escape the configured offline fixture');
  return { result, calls, attempts, messages };
}

test('healthy string counters retain the established complete result', async () => {
  const { result, calls, messages } = await runFixture({
    1: { body: pageBody('2', '3', [row('000001'), row('000002')]) },
    2: { body: pageBody('2', '3', [row('300001')]) }
  });

  assert.deepEqual(calls, [1, 2]);
  assert.deepEqual([...result.keys()], ['000001.SZ', '000002.SZ', '300001.SZ']);
  assert.notEqual(result.partial, true);
  assert.equal(messages.warn.length, 0);
});

test('an empty expected page is partial and does not hide a later page', async () => {
  const { result, calls } = await runFixture({
    1: { body: pageBody(3, 2, [row('000001')]) },
    2: { body: pageBody(3, 2, []) },
    3: { body: pageBody(3, 2, [row('300001')]) }
  });

  assert.deepEqual(calls, [1, 2, 3]);
  assert.deepEqual([...result.keys()], ['000001.SZ', '300001.SZ']);
  assert.equal(result.partial, true);
});

test('an empty declared final page contradicts pagecount even when raw total is met', async () => {
  const { result, calls } = await runFixture({
    1: { body: pageBody(2, 1, [row('000001')]) },
    2: { body: pageBody(2, 1, []) }
  });

  assert.deepEqual(calls, [1, 2]);
  assert.equal(result.size, 1);
  assert.equal(result.partial, true);
});

test('a malformed expected page is partial while later valid rows survive', async () => {
  const { result, calls } = await runFixture({
    1: { body: pageBody(3, 2, [row('000001')]) },
    2: { body: [{ metadata: { pagecount: 3, recordcount: 2 }, data: null }] },
    3: { body: pageBody(3, 2, [row('300001')]) }
  });

  assert.deepEqual(calls, [1, 2, 3]);
  assert.deepEqual([...result.keys()], ['000001.SZ', '300001.SZ']);
  assert.equal(result.partial, true);
});

test('pagecount drift never shortens the previously declared tail', async () => {
  const { result, calls } = await runFixture({
    1: { body: pageBody(3, 3, [row('000001')]) },
    2: { body: pageBody(2, 3, [row('000002')]) },
    3: { body: pageBody(3, 3, [row('300001')]) }
  });

  assert.deepEqual(calls, [1, 2, 3]);
  assert.equal(result.size, 3);
  assert.equal(result.partial, true);
});

test('upward pagecount drift is retained but remains visibly inconsistent', async () => {
  const { result, calls } = await runFixture({
    1: { body: pageBody(2, 3, [row('000001')]) },
    2: { body: pageBody(3, 3, [row('000002')]) },
    3: { body: pageBody(3, 3, [row('300001')]) }
  });

  assert.deepEqual(calls, [1, 2, 3]);
  assert.equal(result.size, 3);
  assert.equal(result.partial, true);
});

test('recordcount drift is visible while the conservative maximum is retained', async () => {
  const { result } = await runFixture({
    1: { body: pageBody(2, 2, [row('000001')]) },
    2: { body: pageBody(2, 1, [row('000002')]) }
  });

  assert.equal(result.size, 2);
  assert.equal(result.partial, true);
});

test('recordcount undercoverage is visible even when pagecount says done', async () => {
  const { result, calls } = await runFixture({
    1: { body: pageBody(1, 3, [row('000001')]) }
  });

  assert.deepEqual(calls, [1]);
  assert.equal(result.size, 1);
  assert.equal(result.partial, true);
});

test('recordcount overcoverage is also a visible contradiction', async () => {
  const { result } = await runFixture({
    1: { body: pageBody(1, 1, [row('000001'), row('000002')]) }
  });

  assert.equal(result.size, 2);
  assert.equal(result.partial, true);
});

test('malformed page counts fail closed without discarding valid rows', async t => {
  const badValues = [0, -1, 1.5, true, {}, Number.MAX_SAFE_INTEGER + 1, '1e2'];
  for (const value of badValues) {
    await t.test(`pagecount=${JSON.stringify(value)}`, async () => {
      const { result } = await runFixture({
        1: { body: pageBody(value, 1, [row('000001')]) },
        2: { body: pageBody(value, 1, []) }
      });
      assert.equal(result.size, 1);
      assert.equal(result.partial, true);
    });
  }
});

test('malformed record counts fail closed without discarding valid rows', async t => {
  const badValues = [-1, 1.5, true, {}, Number.MAX_SAFE_INTEGER + 1, 'Infinity'];
  for (const value of badValues) {
    await t.test(`recordcount=${JSON.stringify(value)}`, async () => {
      const { result } = await runFixture({
        1: { body: pageBody(1, value, [row('000001')]) }
      });
      assert.equal(result.size, 1);
      assert.equal(result.partial, true);
    });
  }
});

test('one valid counter is sufficient, but no counters cannot certify completeness', async () => {
  const pageOnly = await runFixture({
    1: { body: pageBody(1, undefined, [row('000001')]) }
  });
  assert.notEqual(pageOnly.result.partial, true);

  const recordOnly = await runFixture({
    1: { body: pageBody(undefined, 1, [row('000001')]) }
  });
  assert.notEqual(recordOnly.result.partial, true);

  const neither = await runFixture({
    1: { body: [{ data: [row('000001')] }] },
    2: { body: [{ data: [] }] }
  });
  assert.equal(neither.result.size, 1);
  assert.equal(neither.result.partial, true);
});

test('the existing page cap becomes visible when a declared tail remains', async () => {
  const { result, calls } = await runFixture(page => {
    if (page > 300) return null;
    return { body: pageBody(301, undefined, [row(String(page).padStart(6, '0'))]) };
  });

  assert.equal(calls.length, 300);
  assert.equal(result.size, 300);
  assert.equal(result.partial, true);
});

test('a later network failure remains partial and does not discard the tail', async () => {
  const { result, calls, attempts, messages } = await runFixture(page => {
    if (page === 1) return { body: pageBody(3, 2, [row('000001')]) };
    if (page === 2) return { error: new Error('fixture reset') };
    if (page === 3) return { body: pageBody(3, 2, [row('300001')]) };
    return null;
  });

  assert.equal(attempts.get(2), 4);
  assert.deepEqual(calls, [1, 2, 2, 2, 2, 3]);
  assert.deepEqual([...result.keys()], ['000001.SZ', '300001.SZ']);
  assert.equal(result.partial, true);
  assert.equal(messages.warn.length, 1);
});

test('an unbounded later network failure stops after retries', async () => {
  const { result, calls, attempts, messages } = await runFixture(page => {
    if (page === 1) return { body: [{ data: [row('000001')] }] };
    if (page === 2) return { error: new Error('fixture reset') };
    return null;
  });

  assert.equal(attempts.get(2), 4);
  assert.deepEqual(calls, [1, 2, 2, 2, 2]);
  assert.deepEqual([...result.keys()], ['000001.SZ']);
  assert.equal(result.partial, true);
  assert.equal(messages.warn.length, 1);
});

test('transport completeness counts same-page raw rows rather than unique Map keys', async () => {
  const { result } = await runFixture({
    1: { body: pageBody(1, 2, [row('000001'), row('000001')]) }
  });

  assert.equal(result.size, 1);
  assert.notEqual(result.partial, true);
});

test('a cross-page duplicate exposes an unstable pagination snapshot', async () => {
  const { result, calls } = await runFixture({
    1: { body: pageBody(2, 2, [row('000001')]) },
    2: { body: pageBody(2, 2, [row('000001')]) }
  });

  assert.deepEqual(calls, [1, 2]);
  assert.deepEqual([...result.keys()], ['000001.SZ']);
  assert.equal(result.partial, true);
});

test('an unrepresentable source row is visible as partial', async () => {
  const { result } = await runFixture({
    1: { body: pageBody(1, 2, [row('000001'), row('broken')]) }
  });

  assert.deepEqual([...result.keys()], ['000001.SZ']);
  assert.equal(result.partial, true);
});

test('a genuine zero-record response remains a compatible empty result', async () => {
  const { result, calls } = await runFixture({
    1: { body: pageBody(1, 0, []) }
  });

  assert.deepEqual(calls, [1]);
  assert.equal(result.size, 0);
  assert.notEqual(result.partial, true);
});

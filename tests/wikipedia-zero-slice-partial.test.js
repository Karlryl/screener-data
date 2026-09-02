'use strict';

const assert = require('node:assert/strict');
const https = require('node:https');
const { Readable } = require('node:stream');
const {
  fetchWikipediaIndices,
  extractTickersFromWikitext,
} = require('../discovery/wikipedia-indices.js');

const ORIGINAL_GLOBALS = {
  get: https.get,
  setTimeout: global.setTimeout,
  log: console.log,
  error: console.error,
};

let pass = 0;
let fail = 0;
async function test(name, fn) {
  try {
    await fn();
    pass++;
    console.log('  ok   ' + name);
  } catch (e) {
    fail++;
    console.error('FAIL   ' + name + '\n       ' + (e && e.stack || e));
  }
}

function table(symbol) {
  return [
    '{| class="wikitable"',
    '! Company !! Symbol',
    '|-',
    '| Example plc || ' + symbol,
    '|}',
  ].join('\n');
}

function apiBody(wikitext) {
  return JSON.stringify({ parse: { wikitext } });
}

function assertGlobalsRestored() {
  assert.equal(https.get, ORIGINAL_GLOBALS.get);
  assert.equal(global.setTimeout, ORIGINAL_GLOBALS.setTimeout);
  assert.equal(console.log, ORIGINAL_GLOBALS.log);
  assert.equal(console.error, ORIGINAL_GLOBALS.error);
}

async function withFakeWikipedia(bodies, fn) {
  const realGet = https.get;
  const realSetTimeout = global.setTimeout;
  const realConsole = { log: console.log, error: console.error };
  const calls = [];
  const logs = [];
  const errors = [];

  https.get = (url, options, callback) => {
    const cb = typeof options === 'function' ? options : callback;
    const index = calls.length;
    calls.push(String(url));
    const body = bodies[index];
    const req = {
      on() { return req; },
      once() { return req; },
      setTimeout() { return req; },
      destroy() {},
      end() {},
    };
    queueMicrotask(() => {
      if (body === undefined) throw new Error('unexpected Wikipedia request #' + (index + 1));
      const res = Readable.from([Buffer.from(body, 'utf8')]);
      res.statusCode = 200;
      res.headers = {};
      cb(res);
    });
    return req;
  };
  global.setTimeout = (callback, _ms, ...args) => {
    queueMicrotask(() => callback(...args));
    return 0;
  };
  console.log = (...args) => logs.push(args.join(' '));
  console.error = (...args) => errors.push(args.join(' '));

  try {
    return await fn({ calls, logs, errors });
  } finally {
    https.get = realGet;
    global.setTimeout = realSetTimeout;
    console.log = realConsole.log;
    console.error = realConsole.error;
  }
}

(async () => {
  await test('recognized ticker header with zero valid symbols is a parser failure', () => {
    assert.throws(
      () => extractTickersFromWikitext(table('N/A'), ''),
      /ticker-column header found but no valid tickers parsed/i,
    );
  });

  await test('one zero slice retains both healthy neighbors and marks the Map partial', async () => {
    await withFakeWikipedia([
      apiBody(table('AAPL')),
      apiBody(table('N/A')),
      apiBody(table('SAP')),
    ], async ({ calls, logs, errors }) => {
      const result = await fetchWikipediaIndices();
      assert.ok(result instanceof Map);
      assert.deepEqual([...result.keys()], ['AAPL', 'SAP.DE']);
      assert.equal(result.partial, true);
      assert.equal(Object.prototype.hasOwnProperty.call(result, 'partial'), true);
      assert.equal(calls.length, 3, 'the failed middle slice must not suppress the later DAX request');
      assert.match(calls[0], /List_of_S%26P_500_companies/);
      assert.match(calls[1], /FTSE_100/);
      assert.match(calls[2], /page=DAX/);
      assert.equal(errors.length, 1, errors.join('\n'));
      assert.match(errors[0], /\[Wikipedia\] FTSE100 failed:.*no valid tickers/i);
      assert.match(logs.join('\n'), /\[Wikipedia\] Total: 2 tickers/);
    });
    assertGlobalsRestored();
  });

  await test('one valid ticker per configured slice is complete and remains unmarked', async () => {
    await withFakeWikipedia([
      apiBody(table('AAPL')),
      apiBody(table('VOD')),
      apiBody(table('SAP')),
    ], async ({ calls, errors }) => {
      const result = await fetchWikipediaIndices();
      assert.deepEqual([...result.keys()], ['AAPL', 'VOD.L', 'SAP.DE']);
      assert.equal(result.partial, undefined);
      assert.ok(!Object.prototype.hasOwnProperty.call(result, 'partial'));
      assert.equal(calls.length, 3);
      assert.deepEqual(errors, []);
    });
    assertGlobalsRestored();
  });

  await test('fake globals are restored when the helper callback rejects', async () => {
    const sentinel = new Error('intentional callback failure');
    await assert.rejects(
      withFakeWikipedia([], async () => { throw sentinel; }),
      (e) => e === sentinel,
    );
    assertGlobalsRestored();
  });

  console.log(`\nwikipedia-zero-slice-partial: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e && e.stack || e);
  process.exit(1);
});

'use strict';
// Offline stream regressions. All HTTP is stubbed; only owned os.tmpdir fixtures
// are read/written. Importing the script never runs its CLI or real stores.
const rawAssert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const { EventEmitter, once } = require('events');
const { PassThrough } = require('stream');
const {
  downloadBulk, getDoc, oeffneAppendStrom, schliesseAppendStrom, HTTP_TIMEOUT_MS,
} = require('../scripts/d2-submissions-bulk.js');

let assertions = 0, passed = 0;
const assert = new Proxy(rawAssert, {
  get(target, key) {
    const value = target[key];
    return typeof value === 'function'
      ? (...args) => { assertions++; return value(...args); } : value;
  },
});
const settle = (promise) => promise.then((value) => ({ value }), (error) => ({ error }));
const nextTurn = () => new Promise((resolve) => setImmediate(resolve));

async function within(promise) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Stream operation did not settle within 2000 ms')), 2000);
      }),
    ]);
  } finally { clearTimeout(timer); }
}

async function test(name, run) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'd2-submissions-netz-'));
  const originalGet = https.get, originalCreate = fs.createWriteStream;
  const requests = [], writers = [], responses = [];
  https.get = (options, receive) => {
    const req = new EventEmitter();
    req.options = options;
    req.receive = receive;
    req.setTimeout = (ms, callback) => { req.timeoutMs = ms; req.timeout = callback; return req; };
    req.destroy = (error) => { req.destroyError = error; req.emit('error', error); return req; };
    requests.push(req);
    return req;
  };
  fs.createWriteStream = (...args) => {
    const ws = originalCreate(...args);
    writers.push(ws);
    return ws;
  };
  const reply = (req, headers = {}, status = 200) => {
    const res = new PassThrough();
    res.statusCode = status;
    res.headers = headers;
    responses.push(res);
    req.receive(res);
    return res;
  };
  try {
    await within(run({ tmp, requests, writers, reply }));
    passed++;
    console.log('  ok  ' + name);
  } finally {
    https.get = originalGet;
    fs.createWriteStream = originalCreate;
    for (const res of responses) res.destroy();
    await within(Promise.all(writers.map((ws) => {
      if (ws.closed) return Promise.resolve();
      return new Promise((resolve) => { ws.once('close', resolve); ws.destroy(); });
    })));
    const relative = path.relative(os.tmpdir(), tmp);
    rawAssert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative), 'Owned temp-directory guard');
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function noPartial(dest) {
  assert.strictEqual(fs.existsSync(dest + '.part'), false, 'Failed download must remove its .part before rejection');
}

async function main() {
  console.log('tests/d2-submissions-bulk-netz.test.js');
  await test('request error keeps its original identity; late response creates no file', async ({ tmp, requests, writers, reply }) => {
    const dest = path.join(tmp, 'bulk.zip'), cause = new Error('request failed');
    const result = settle(downloadBulk('fixture-agent', dest));
    const req = requests[0];
    assert.deepStrictEqual(req.options, {
      host: 'www.sec.gov', path: '/Archives/edgar/daily-index/bulkdata/submissions.zip',
      headers: { 'User-Agent': 'fixture-agent', 'Accept-Encoding': 'identity' },
    });
    assert.strictEqual(req.timeoutMs, HTTP_TIMEOUT_MS);
    req.emit('error', cause);
    assert.strictEqual((await result).error, cause);
    reply(req).end('late');
    await nextTurn();
    assert.strictEqual(writers.length, 0);
    assert.strictEqual(fs.existsSync(dest), false);
    noPartial(dest);
  });

  await test('timeout rejects with the exact destroy error and closes the partial', async ({ tmp, requests, writers, reply }) => {
    const dest = path.join(tmp, 'timeout.zip');
    const result = settle(downloadBulk('fixture-agent', dest));
    const req = requests[0], res = reply(req, { 'content-length': '10' });
    await once(writers[0], 'open');
    res.write('12345');
    req.timeout();
    assert.strictEqual((await result).error, req.destroyError);
    assert.match(req.destroyError.message, /^Download-Timeout: 30000 ms ohne Bytes$/);
    assert.strictEqual(writers[0].closed, true);
    assert.strictEqual(fs.existsSync(dest), false);
    noPartial(dest);
  });

  await test('response error before file open waits for close and preserves the first error', async ({ tmp, requests, writers, reply }) => {
    const dest = path.join(tmp, 'opening.zip'), cause = new Error('body interrupted before open');
    const result = settle(downloadBulk('fixture-agent', dest));
    const res = reply(requests[0], { 'content-length': '10' });
    assert.strictEqual(writers[0].pending, true, 'Fixture must exercise an open still in flight');
    res.write('12345');
    res.emit('error', cause);
    requests[0].emit('error', new Error('later socket error'));
    assert.strictEqual((await result).error, cause);
    assert.strictEqual(writers[0].closed, true);
    assert.strictEqual(fs.existsSync(dest), false);
    noPartial(dest);
    await nextTurn();
    noPartial(dest);
  });

  await test('response error during writing removes the partial and preserves an existing destination', async ({ tmp, requests, writers, reply }) => {
    const dest = path.join(tmp, 'existing.zip'), cause = new Error('body interrupted after open');
    fs.writeFileSync(dest, 'previous complete archive');
    const result = settle(downloadBulk('fixture-agent', dest));
    const res = reply(requests[0], { 'content-length': '10' });
    await once(writers[0], 'open');
    res.write('12345');
    assert.strictEqual(fs.existsSync(dest + '.part'), true);
    res.emit('error', cause);
    assert.strictEqual((await result).error, cause);
    assert.strictEqual(writers[0].closed, true);
    assert.strictEqual(fs.readFileSync(dest, 'utf8'), 'previous complete archive');
    noPartial(dest);
  });

  await test('complete response publishes matching bytes, hash and metadata', async ({ tmp, requests, reply }) => {
    const dest = path.join(tmp, 'complete.zip'), body = Buffer.from('0123456789');
    const result = settle(downloadBulk('fixture-agent', dest));
    const modified = 'Thu, 24 Sep 2026 01:02:03 GMT', etag = 'fixture-etag';
    reply(requests[0], { 'content-length': '10', 'last-modified': modified, etag }).end(body);
    const outcome = await result;
    assert.strictEqual(outcome.error, undefined);
    assert.deepStrictEqual(outcome.value, {
      bytes: 10, sha256: crypto.createHash('sha256').update(body).digest('hex'),
      contentLength: 10, lastModified: modified, etag,
    });
    assert.deepStrictEqual(fs.readFileSync(dest), body);
    noPartial(dest);
  });

  await test('short completed response is rejected and its partial removed', async ({ tmp, requests, reply }) => {
    const dest = path.join(tmp, 'short.zip');
    const result = settle(downloadBulk('fixture-agent', dest));
    reply(requests[0], { 'content-length': '10' }).end('12345');
    assert.match((await result).error.message, /^Abbruch: 5 von 10 Bytes empfangen$/);
    assert.strictEqual(fs.existsSync(dest), false);
    noPartial(dest);
  });

  await test('download file-open failure rejects instead of hanging', async ({ tmp, requests, reply }) => {
    const dest = path.join(tmp, 'missing', 'bulk.zip');
    const result = settle(downloadBulk('fixture-agent', dest));
    reply(requests[0], { 'content-length': '5' }).end('12345');
    assert.strictEqual((await result).error.code, 'ENOENT');
    assert.strictEqual(fs.existsSync(dest), false);
    noPartial(dest);
  });

  await test('document body error returns status 0 with no uncaught exception', async ({ requests, reply }) => {
    let uncaught = null, reportUncaught;
    const uncaughtResult = new Promise((resolve) => { reportUncaught = resolve; });
    const onUncaught = (error) => { uncaught = error; reportUncaught({ error }); };
    process.once('uncaughtException', onUncaught);
    try {
      const result = settle(getDoc('fixture-agent', '0000000123', '0001-02-003', 'xslF25X02/primary_doc.xml'));
      const req = requests[0], res = reply(req);
      assert.deepStrictEqual(req.options, {
        host: 'www.sec.gov', path: '/Archives/edgar/data/123/000102003/primary_doc.xml',
        headers: { 'User-Agent': 'fixture-agent', 'Accept-Encoding': 'identity' },
      });
      assert.strictEqual(req.timeoutMs, HTTP_TIMEOUT_MS);
      res.write('<partial>');
      setImmediate(() => res.emit('error', new Error('document body interrupted')));
      const outcome = await Promise.race([result, uncaughtResult]);
      assert.strictEqual(uncaught, null, 'Response errors must not escape to uncaughtException');
      assert.deepStrictEqual(outcome.value, { status: 0, body: null });
    } finally { process.removeListener('uncaughtException', onUncaught); }
  });

  await test('document success and HTTP failure keep their existing contracts', async ({ requests, reply }) => {
    const good = settle(getDoc('fixture-agent', 123, 'a-b', 'primary_doc.xml'));
    reply(requests[0]).end('<complete/>');
    assert.deepStrictEqual((await good).value, { status: 200, body: '<complete/>' });
    const bad = settle(getDoc('fixture-agent', 123, 'a-b', 'primary_doc.xml'));
    const res = reply(requests[1], {}, 404);
    res.emit('error', new Error('failed error-response body'));
    assert.deepStrictEqual((await bad).value, { status: 404, body: null });
  });

  await test('append close rejects ENOENT while opening, within 2 seconds', async ({ tmp }) => {
    const ws = oeffneAppendStrom(path.join(tmp, 'missing', 'append.jsonl'));
    const outcome = await settle(schliesseAppendStrom(ws));
    assert.strictEqual(outcome.error.code, 'ENOENT');
  });

  await test('append remembers errors emitted before closing', async ({ tmp }) => {
    const ws = oeffneAppendStrom(path.join(tmp, 'missing', 'append.jsonl'));
    const [cause] = await once(ws, 'error');
    const outcome = await settle(schliesseAppendStrom(ws));
    assert.strictEqual(cause.code, 'ENOENT');
    assert.strictEqual(outcome.error, cause);
  });

  await test('append error during end wins the finish/error race', async ({ tmp }) => {
    const ws = oeffneAppendStrom(path.join(tmp, 'failed.jsonl'));
    await once(ws, 'open');
    ws.write('pending\n');
    const cause = new Error('fixture disk write failure');
    const result = settle(schliesseAppendStrom(ws));
    ws.destroy(cause);
    assert.strictEqual((await result).error, cause);
  });

  await test('append close flushes two lines and reopening preserves them', async ({ tmp }) => {
    const dest = path.join(tmp, 'append.jsonl');
    const ws = oeffneAppendStrom(dest);
    ws.write('first\n'); ws.write('second\n');
    assert.strictEqual((await settle(schliesseAppendStrom(ws))).error, undefined);
    assert.strictEqual(fs.readFileSync(dest, 'utf8'), 'first\nsecond\n');
    const reopened = oeffneAppendStrom(dest);
    reopened.write('third\n');
    assert.strictEqual((await settle(schliesseAppendStrom(reopened))).error, undefined);
    assert.strictEqual(fs.readFileSync(dest, 'utf8'), 'first\nsecond\nthird\n');
  });
  console.log('PASS: ' + passed + ' cases, ' + assertions + ' assertions');
}

main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });

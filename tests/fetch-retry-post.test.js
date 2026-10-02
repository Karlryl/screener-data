'use strict';
// tests/fetch-retry-post.test.js — the POST option of lib/fetch-retry.js (Tag 1399, MOPS t164sb04).
// Presence: a body turns the call into a POST with Content-Type/Content-Length and the body on the wire.
// Absence: without a body the request still goes through https.get with the same arguments as before.
// No live network: https.get and https.request are replaced for the whole file.
const assert = require('node:assert/strict');
const https = require('node:https');
const { EventEmitter } = require('node:events');

const origGet = https.get, origRequest = https.request;
let calls = [];
function fakeReq() {
  const req = new EventEmitter();
  req.written = [];
  req.setTimeout = () => req;
  req.destroy = () => {};
  req.end = (chunk) => { if (chunk != null) req.written.push(String(chunk)); req.ended = true; };
  return req;
}
function respond(cb, body) {
  const res = new EventEmitter();
  res.statusCode = 200; res.headers = {};
  setImmediate(() => { cb(res); res.emit('data', Buffer.from(body)); res.emit('end'); });
}
https.get = (url, opts, cb) => { const req = fakeReq(); calls.push({ fn: 'get', url, opts, req }); respond(cb, '{"via":"get"}'); return req; };
https.request = (url, opts, cb) => { const req = fakeReq(); calls.push({ fn: 'request', url, opts, req }); respond(cb, '{"via":"post"}'); return req; };

const { fetchJson } = require('../lib/fetch-retry.js');

let pass = 0, fail = 0;
async function test(name, fn) {
  calls = [];
  try { await fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + (e && e.stack || e)); }
}

(async () => {
  await test('a body sends a POST with JSON content type, exact length and the body', async () => {
    const body = JSON.stringify({ companyId: '6446', dataType: '2', season: '3', year: '114', subsidiaryCompanyId: '' });
    const j = await fetchJson('https://post.example.test/mops/api/t164sb04', {
      pauseMs: 0, body, headers: { 'User-Agent': 'test-agent', 'Content-Type': 'application/json' },
    });
    assert.deepEqual(j, { via: 'post' });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].fn, 'request');
    assert.equal(calls[0].opts.method, 'POST');
    assert.equal(calls[0].opts.headers['Content-Type'], 'application/json');
    assert.equal(calls[0].opts.headers['Content-Length'], Buffer.byteLength(body));
    assert.equal(calls[0].opts.headers['User-Agent'], 'test-agent');
    assert.deepEqual(calls[0].req.written, [body]);
  });

  await test('without a body the call stays a plain https.get with only the headers (GET unchanged)', async () => {
    const j = await fetchJson('https://get.example.test/x', { pauseMs: 0, headers: { 'User-Agent': 'test-agent' } });
    assert.deepEqual(j, { via: 'get' });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].fn, 'get');
    assert.deepEqual(calls[0].opts, { headers: { 'User-Agent': 'test-agent' } });
    assert.equal(calls[0].req.ended, undefined, 'https.get ends the request itself; nothing extra is written');
  });

  await test('a test seam _get receives the body as fourth argument only for POST', async () => {
    const seen = [];
    const _get = async (...args) => { seen.push(args.length); return { code: 200, body: Buffer.from('{}'), headers: {} }; };
    await fetchJson('https://seam.example.test/a', { pauseMs: 0, _get });
    await fetchJson('https://seam.example.test/b', { pauseMs: 0, _get, body: '{}' });
    assert.deepEqual(seen, [3, 4]);
  });

  https.get = origGet; https.request = origRequest;
  console.log('\nfetch-retry-post: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();

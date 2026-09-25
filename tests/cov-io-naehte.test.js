'use strict';
// Isolated platform/HTTPS seams; no live requests or repository data.
// Run: node tests/cov-io-naehte.test.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { EventEmitter } = require('node:events');

const ROOT = path.resolve(__dirname, '..');
const TEMP_BASE = path.resolve(os.tmpdir());
const PREFIX = 'cov-io-naehte-';

function cleanOwnedDirectory(dir, parent) {
  assert.equal(path.dirname(path.resolve(dir)), path.resolve(parent), 'cleanup stays in its owner');
  fs.rmSync(dir, { recursive: true, force: true });
  assert.equal(fs.existsSync(dir), false, 'temporary fixture was removed');
}

function renameCase(dir, kind) {
  const target = path.join(dir, 'state.txt');
  fs.writeFileSync(target, 'before');
  const platform = Object.getOwnPropertyDescriptor(process, 'platform');
  const originalRename = fs.renameSync;
  const originalSab = globalThis.SharedArrayBuffer;
  let calls = 0;
  try {
    // The fixture and os.tmpdir() must be resolved before changing platform.
    Object.defineProperty(process, 'platform', { value: 'win32' });
    if (kind === 'spin') globalThis.SharedArrayBuffer = undefined;
    fs.renameSync = (source, destination) => {
      calls++;
      assert.equal(destination, target);
      assert.equal(path.dirname(source), dir, 'rename uses a sibling temporary file');
      let code;
      if (kind === 'busy') code = 'EBUSY';
      else if (kind === 'missing') code = calls === 1 ? 'EPERM' : 'ENOENT';
      else if (kind === 'access' && calls === 1) code = 'EACCES';
      else if (kind !== 'access' && calls <= 2) code = 'EPERM';
      if (code) throw Object.assign(new Error('rename attempt ' + calls), { code });
      return originalRename(source, destination);
    };
    const { writeFileAtomic, atomicWriteStats } = require(path.join(ROOT, 'lib/atomic-write.js'));
    const before = atomicWriteStats.renameRetries;
    let error = null;
    const started = Date.now();
    try { writeFileAtomic(target, 'after'); }
    catch (e) { error = { code: e.code, message: e.message }; }
    return {
      error, calls, elapsedMs: Date.now() - started,
      retries: atomicWriteStats.renameRetries - before,
      contents: fs.readFileSync(target, 'utf8'),
      files: fs.readdirSync(dir),
    };
  } finally {
    fs.renameSync = originalRename;
    globalThis.SharedArrayBuffer = originalSab;
    Object.defineProperty(process, 'platform', platform);
  }
}

function posixDirectoryCase(dir) {
  const platform = Object.getOwnPropertyDescriptor(process, 'platform');
  const original = { open: fs.openSync, fsync: fs.fsyncSync, close: fs.closeSync, warn: console.warn };
  // A synthetic directory handle avoids relying on Windows directory-fsync support.
  const directoryFd = 0x7fffffff;
  const warnings = [];
  let rejectDirectory = false, opens = 0, syncs = 0, closes = 0;
  try {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    fs.openSync = (filename, ...args) => {
      if (path.resolve(String(filename)) !== dir) return original.open(filename, ...args);
      opens++;
      if (rejectDirectory) throw new Error('fixture directory is not syncable');
      return directoryFd;
    };
    fs.fsyncSync = (fd) => {
      if (fd === directoryFd) { syncs++; return; }
      return original.fsync(fd);
    };
    fs.closeSync = (fd) => {
      if (fd === directoryFd) { closes++; return; }
      return original.close(fd);
    };
    console.warn = (message) => warnings.push(message);
    const { writeFileAtomic, atomicWriteStats } = require(path.join(ROOT, 'lib/atomic-write.js'));
    const target = path.join(dir, 'state.txt');
    writeFileAtomic(target, 'durable');
    rejectDirectory = true;
    writeFileAtomic(target, 'first failure');
    writeFileAtomic(target, 'second failure');
    return {
      opens, syncs, closes, warnings,
      contents: fs.readFileSync(target, 'utf8'),
      files: fs.readdirSync(dir),
      stats: { ...atomicWriteStats },
    };
  } finally {
    fs.openSync = original.open;
    fs.fsyncSync = original.fsync;
    fs.closeSync = original.close;
    console.warn = original.warn;
    Object.defineProperty(process, 'platform', platform);
  }
}

async function httpsCase() {
  const https = require('node:https');
  const originalGet = https.get;
  const originalTimer = globalThis.setTimeout;
  const requests = [], queued = [], sleepDelays = [];
  try {
    globalThis.setTimeout = (fn, ms, ...args) => {
      sleepDelays.push(ms);
      return originalTimer(fn, ms, ...args);
    };
    // Installed BEFORE requiring fetch-retry; no route ever calls originalGet.
    https.get = (url, options, callback) => {
      assert.ok(queued.length > 0, 'every HTTPS request needs a queued offline response');
      const scenario = queued.shift();
      const record = { url, headers: options.headers, timeoutMs: null, destroyed: 0, at: Date.now() };
      requests.push(record);
      const req = new EventEmitter();
      let timeout;
      req.destroy = () => { record.destroyed++; return req; };
      req.setTimeout = (ms, fn) => { record.timeoutMs = ms; timeout = fn; return req; };
      setImmediate(() => {
        if (scenario === 'request-error') { req.emit('error', new Error('ECONNRESET')); return; }
        if (scenario === 'timeout') { timeout(); return; }
        const res = Object.assign(new EventEmitter(), { statusCode: 200, headers: { 'x-h': '1' } });
        callback(res);
        if (scenario === 'response-error') { res.emit('error', new Error('response stream broke')); return; }
        res.emit('data', Buffer.from('{"ok":'));
        res.emit('data', Buffer.from('true}'));
        res.emit('end');
      });
      return req;
    };
    const { fetchBuffer, fetchJson } = require(path.join(ROOT, 'lib/fetch-retry.js'));
    const headers = { 'x-request': 'offline-fixture' };
    queued.push('success');
    const json = await fetchJson('https://json.invalid/data', { pauseMs: 1, headers });
    queued.push('success');
    const buffer = await fetchBuffer('https://buffer.invalid/data', { pauseMs: 1 });

    queued.push('request-error', 'request-error');
    let requestError;
    try {
      await fetchBuffer('https://reset.invalid/data', { pauseMs: 0, versuche: 2, backoffMs: 1 });
    } catch (e) { requestError = e.message; }
    const backoffDelays = [...sleepDelays];

    queued.push('timeout');
    let timeoutError;
    try {
      await fetchBuffer('https://timeout.invalid/data', { pauseMs: 0, timeoutMs: 5, versuche: 1 });
    } catch (e) { timeoutError = e.message; }

    queued.push('response-error');
    let responseError;
    try {
      await fetchBuffer('https://stream.invalid/data', { pauseMs: 0, versuche: 1 });
    } catch (e) { responseError = e.message; }

    queued.push('success', 'success');
    const pauseStarted = Date.now();
    const first = await fetchBuffer('https://pause.invalid/one', { pauseMs: 30 });
    const second = await fetchBuffer('https://pause.invalid/two', { pauseMs: 30 });
    const pauseElapsedMs = Date.now() - pauseStarted;

    const statusErrors = [];
    for (const code of [402, 404]) {
      let calls = 0, message;
      try {
        await fetchBuffer('https://status-' + code + '.invalid/data', {
          pauseMs: 0, versuche: 3,
          _get: async () => { calls++; return { code }; },
        });
      } catch (e) { message = e.message; }
      statusErrors.push({ code, calls, message });
    }
    return {
      json, buffer: { code: buffer.code, body: buffer.body.toString('utf8'), headers: buffer.headers },
      requestError, timeoutError, responseError, backoffDelays,
      pauseElapsedMs, pauseBodies: [first.body.toString(), second.body.toString()],
      statusErrors, requests, queued: queued.length,
    };
  } finally {
    https.get = originalGet;
    globalThis.setTimeout = originalTimer;
  }
}

async function runChild(kind, root) {
  assert.equal(path.dirname(path.resolve(root)), TEMP_BASE);
  assert.ok(path.basename(root).startsWith(PREFIX));
  const dir = fs.mkdtempSync(path.join(root, 'child-'));
  let result;
  try {
    if (kind === 'https') result = await httpsCase();
    else if (kind === 'posix') result = posixDirectoryCase(dir);
    else result = renameCase(dir, kind);
  } finally {
    cleanOwnedDirectory(dir, root);
  }
  return { ...result, cleaned: true };
}

function main() {
  const root = fs.mkdtempSync(path.join(TEMP_BASE, PREFIX));
  let pass = 0, fail = 0;
  function test(name, fn) {
    try { fn(); pass++; console.log('  ok   ' + name); }
    catch (e) { fail++; console.error('FAIL   ' + name + '\n' + e.stack); }
  }
  function child(kind) {
    const result = spawnSync(process.execPath, [__filename, '--child', kind, root], {
      cwd: root, env: { ...process.env }, encoding: 'utf8', timeout: 6000,
    });
    assert.equal(result.error, undefined, 'child starts and finishes: ' + kind);
    assert.equal(result.status, 0, 'child ' + kind + ': ' + result.stderr);
    const data = JSON.parse(result.stdout);
    assert.equal(data.cleaned, true, 'child fixture cleanup completed');
    return data;
  }
  try {
    for (const kind of ['atomics', 'spin']) {
      test('Windows EPERM recovery uses ' + kind + ' sleep', () => {
        const r = child(kind);
        assert.equal(r.error, null);
        assert.equal(r.contents, 'after');
        assert.equal(r.calls, 3);
        assert.equal(r.retries, 2);
        assert.ok(r.elapsedMs >= 30, '10 + 20 ms retry ladder must actually wait');
        assert.deepEqual(r.files, ['state.txt']);
      });
    }
    test('Windows persistent EBUSY exhausts five retries and preserves the old file', () => {
      const r = child('busy');
      assert.deepEqual(r.error, { code: 'EBUSY', message: 'rename attempt 6' });
      assert.equal(r.calls, 6);
      assert.equal(r.retries, 5);
      assert.equal(r.contents, 'before');
      assert.deepEqual(r.files, ['state.txt']);
    });
    test('Windows ENOENT after the first retry stops immediately', () => {
      const r = child('missing');
      assert.deepEqual(r.error, { code: 'ENOENT', message: 'rename attempt 2' });
      assert.equal(r.calls, 2);
      assert.equal(r.retries, 1);
      assert.equal(r.contents, 'before');
      assert.deepEqual(r.files, ['state.txt']);
    });
    test('Windows EACCES also retries and replaces the target', () => {
      const r = child('access');
      assert.equal(r.error, null);
      assert.equal(r.calls, 2);
      assert.equal(r.retries, 1);
      assert.equal(r.contents, 'after');
      assert.deepEqual(r.files, ['state.txt']);
    });
    test('POSIX directory fsync failures stay observable, warn once and preserve writes', () => {
      const r = child('posix');
      assert.equal(r.opens, 3);
      assert.equal(r.syncs, 1);
      assert.equal(r.closes, 1);
      assert.equal(r.stats.dirFsyncFailures, 2);
      assert.equal(r.stats.lastDirFsyncError, 'fixture directory is not syncable');
      assert.equal(r.stats.renameRetries, 0);
      assert.equal(r.warnings.length, 1);
      assert.match(r.warnings[0], /dir-fsync failed.*fixture directory is not syncable/);
      assert.equal(r.contents, 'second failure');
      assert.deepEqual(r.files, ['state.txt']);
    });

    const { writeFileAtomic, writeJsonAtomic } = require('../lib/atomic-write.js');
    test('Uint8Array writes all three exact bytes through the fallback path', () => {
      const target = path.join(root, 'typed-array.bin');
      writeFileAtomic(target, new Uint8Array([1, 2, 3]));
      assert.deepEqual(fs.readFileSync(target), Buffer.from([1, 2, 3]));
      assert.equal(fs.statSync(target).size, 3);
      assert.deepEqual(fs.readdirSync(root).filter(f => f.includes('.tmp.')), []);
    });
    test('the caller replacer removes fields before the finite-number guard', () => {
      const target = path.join(root, 'replaced.json');
      writeJsonAtomic(target, { x: 1, y: 2 }, { replacer: (key, value) => key === 'y' ? undefined : value });
      assert.deepEqual(JSON.parse(fs.readFileSync(target, 'utf8')), { x: 1 });
      writeJsonAtomic(target, { x: Infinity }, { replacer: (key, value) => key === 'x' ? 3 : value });
      assert.deepEqual(JSON.parse(fs.readFileSync(target, 'utf8')), { x: 3 });
      assert.throws(() => writeJsonAtomic(target, { x: 1 }, { replacer: () => NaN }), /non-finite/);
      assert.deepEqual(JSON.parse(fs.readFileSync(target, 'utf8')), { x: 3 });
      assert.deepEqual(fs.readdirSync(root).filter(f => f.includes('.tmp.')), []);
    });
    test('HTTPS event streams, request errors, timeout, real waits and fail-fast statuses', () => {
      const r = child('https');
      assert.deepEqual(r.json, { ok: true });
      assert.deepEqual(r.buffer, { code: 200, body: '{"ok":true}', headers: { 'x-h': '1' } });
      assert.deepEqual(r.requests[0].headers, { 'x-request': 'offline-fixture' });
      assert.equal(r.requests[0].timeoutMs, 45000);
      assert.match(r.requestError, /nach 2 Versuchen aufgegeben: ECONNRESET$/);
      assert.equal(r.requests.filter(q => q.url === 'https://reset.invalid/data').length, 2);
      assert.deepEqual(r.backoffDelays, [1]);
      assert.match(r.timeoutError, /nach 1 Versuchen aufgegeben: timeout nach 5ms$/);
      const timedOut = r.requests.filter(q => q.url === 'https://timeout.invalid/data');
      assert.equal(timedOut.length, 1);
      assert.equal(timedOut[0].timeoutMs, 5);
      assert.equal(timedOut[0].destroyed, 1);
      assert.equal(r.requests.reduce((sum, q) => sum + q.destroyed, 0), 1);
      assert.match(r.responseError, /nach 1 Versuchen aufgegeben: response stream broke$/);
      assert.deepEqual(r.pauseBodies, ['{"ok":true}', '{"ok":true}']);
      assert.ok(r.pauseElapsedMs >= 30, 'same-host requests respect a real 30 ms pause');
      const paused = r.requests.filter(q => q.url.startsWith('https://pause.invalid/'));
      assert.equal(paused.length, 2);
      assert.ok(paused[1].at - paused[0].at >= 30, 'actual request starts remain spaced');
      assert.equal(r.statusErrors[0].calls, 1);
      assert.match(r.statusErrors[0].message, /HTTP 402: Gratis-Kontingent/);
      assert.equal(r.statusErrors[1].calls, 1);
      assert.match(r.statusErrors[1].message, /HTTP 404 \(nicht wiederholbar\)/);
      assert.equal(r.requests.length, 8);
      assert.equal(r.queued, 0);
    });
  } finally {
    cleanOwnedDirectory(root, TEMP_BASE);
  }
  console.log(`\ncov-io-naehte.test.js: ${pass} ok, ${fail} fail`);
  process.exitCode = fail ? 1 : 0;
}

if (process.argv[2] === '--child') {
  runChild(process.argv[3], process.argv[4]).then(
    result => console.log(JSON.stringify(result)),
    error => { console.error(error.stack); process.exitCode = 1; },
  );
} else {
  main();
}

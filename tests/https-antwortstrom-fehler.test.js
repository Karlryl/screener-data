'use strict';

// Standalone SEC response-stream regression test. All requests are synthetic;
// successful writes stay inside this test's isolated temporary cache.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const https = require('node:https');
const { EventEmitter } = require('node:events');

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'https-antwortstrom-'));
  const originalGet = https.get, originalRequest = https.request;
  const originalArgv = process.argv;
  const originalCache = new Map(Object.entries(require.cache));
  const envKeys = ['SEC_CONTACT', 'SEC_XBRL_CACHE_DIR', 'SEC_COMPANYFACTS_ZIP'];
  const originalEnv = new Map(envKeys.map((key) => [key, process.env[key]]));
  const fsNames = ['readFileSync', 'openSync', 'writeFileSync', 'mkdirSync', 'renameSync', 'unlinkSync'];
  const originalFs = new Map(fsNames.map((name) => [name, fs[name]]));
  const consoleNames = ['log', 'error', 'warn', 'info', 'debug'];
  const originalConsole = new Map(consoleNames.map((name) => [name, console[name]]));
  const requests = [], writes = [], uncaught = [], calendarAccesses = [];
  let plan = null, rejectUncaught = null, passed = 0;
  const onUncaught = (error) => {
    uncaught.push(error);
    if (rejectUncaught) rejectUncaught(new Error('Unhandled response error: ' + error.message));
  };

  function guardPath(file, writing = false) {
    if (typeof file !== 'string') return;
    if (path.basename(file) === 'earnings-calendar.json') {
      calendarAccesses.push(file);
      throw new Error('Calendar I/O is forbidden in this test');
    }
    if (writing) {
      const relative = path.relative(tmp, path.resolve(file));
      assert.ok(relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative),
        'A fixture write must stay inside the temporary directory: ' + file);
      writes.push(file);
    }
  }

  // Keep a real timer alive: an unhandled EventEmitter error or an unsettled
  // fake request must fail loudly, not let Node exit with a pending Promise.
  async function bounded(fn) {
    let timer;
    try {
      return await Promise.race([
        new Promise((_, reject) => {
          rejectUncaught = reject;
          timer = setTimeout(() => reject(new Error('Synthetic request did not settle')), 1000);
        }),
        Promise.resolve().then(fn),
      ]);
    } finally {
      clearTimeout(timer);
      rejectUncaught = null;
    }
  }

  async function test(name, fn) {
    await fn();
    assert.equal(uncaught.length, 0, 'No uncaughtException is allowed');
    passed++;
    console.log('ok ' + passed + ' - ' + name);
  }

  try {
    process.once('uncaughtException', onUncaught);
    process.argv = [process.execPath, __filename];
    process.env.SEC_CONTACT = 'test@example.com';
    process.env.SEC_XBRL_CACHE_DIR = path.join(tmp, 'cache');
    process.env.SEC_COMPANYFACTS_ZIP = path.join(tmp, 'unused-companyfacts.zip');
    fs.readFileSync = (file, ...args) => {
      guardPath(file);
      return originalFs.get('readFileSync')(file, ...args);
    };
    fs.openSync = (file, flags, ...args) => {
      guardPath(file, typeof flags === 'number'
        ? Boolean(flags & (fs.constants.O_WRONLY | fs.constants.O_RDWR | fs.constants.O_CREAT))
        : /[wa+]/.test(flags));
      return originalFs.get('openSync')(file, flags, ...args);
    };
    for (const name of ['writeFileSync', 'mkdirSync', 'unlinkSync']) {
      fs[name] = (file, ...args) => {
        guardPath(file, true);
        return originalFs.get(name)(file, ...args);
      };
    }
    fs.renameSync = (from, to) => {
      guardPath(from, true);
      guardPath(to, true);
      return originalFs.get('renameSync')(from, to);
    };

    // Install on the shared HTTPS module BEFORE requiring any target script.
    https.request = () => { throw new Error('Real HTTPS requests are forbidden'); };
    https.get = (...args) => {
      if (!plan) throw new Error('Unexpected HTTPS request');
      const current = plan;
      plan = null;
      const req = new EventEmitter();
      req.destroyed = false;
      req.destroyCalls = 0;
      req.destroy = (error) => {
        req.destroyed = true;
        req.destroyCalls++;
        if (error) process.nextTick(() => req.emit('error', error));
        return req;
      };
      req.setTimeout = (ms, callback) => {
        req.timeoutMs = ms;
        if (current.timeout) callback();
        return req;
      };
      requests.push(req);
      if (!current.timeout) process.nextTick(() => {
        if (current.requestError) return req.emit('error', current.requestError);
        const res = new EventEmitter();
        res.statusCode = current.status || 200;
        res.headers = {};
        res.resume = () => { req.resumed = true; };
        args[args.length - 1](res);
        if (current.body != null) res.emit('data', Buffer.from(current.body));
        if (current.error) res.emit('error', current.error);
        else res.emit('end');
      });
      return req;
    };

    const imports = ['../scripts/b1-validate.js', '../scripts/druckenmiller-13f.js',
      '../scripts/sec-pit-check.js', '../lib/sec-pit.js'];
    for (const name of imports) delete require.cache[require.resolve(name)];
    let fetchSubmissions, hole, downloadTickers;
    await test('require is silent and does not start a request or write', async () => {
      const output = [];
      for (const name of consoleNames) console[name] = (...args) => output.push([name, ...args]);
      try {
        await bounded(async () => {
          ({ fetchSubmissions } = require('../scripts/b1-validate.js'));
          ({ hole } = require('../scripts/druckenmiller-13f.js'));
          const sec = require('../scripts/sec-pit-check.js');
          ({ downloadTickers } = sec);
          assert.equal(typeof sec.universeTickers, 'function');
          await new Promise((resolve) => setImmediate(resolve));
        });
        assert.equal(requests.length, 0);
        assert.equal(writes.length, 0);
        assert.deepEqual(output, []);
      } finally {
        for (const [name, fn] of originalConsole) console[name] = fn;
      }
    });

    const cikFile = path.join(tmp, 'cache', 'submissions', 'CIK9999999999.json');
    const dest = path.join(tmp, 'tickers.json');
    await test('fetchSubmissions returns null after a partial response, without a cache write', async () => {
      plan = { body: '{"sic":', error: new Error('aborted submissions body') };
      assert.equal(await bounded(() => fetchSubmissions(9999999999, 'x')), null);
      assert.equal(fs.existsSync(cikFile), false);
      assert.equal(writes.length, 0);
    });
    await test('hole rejects the original response error', async () => {
      const error = Object.assign(new Error('aborted 13F body'), { code: 'ECONNRESET' });
      plan = { body: '<partial>', error };
      await assert.rejects(bounded(() => hole('www.sec.gov', '/x')), (actual) => actual === error);
    });
    await test('downloadTickers rejects the original response error without writing', async () => {
      const error = new Error('aborted ticker body');
      plan = { body: '{"0":', error };
      await assert.rejects(bounded(() => downloadTickers(dest)), (actual) => actual === error);
      assert.equal(fs.existsSync(dest), false);
      assert.equal(writes.length, 0);
    });
    await test('a silent ticker request times out at 60000 ms and is destroyed', async () => {
      plan = { timeout: true };
      await assert.rejects(bounded(() => downloadTickers(dest)),
        /Zeitueberschreitung bei https:\/\/www\.sec\.gov\/files\/company_tickers\.json/);
      const req = requests[requests.length - 1];
      assert.equal(req.timeoutMs, 60000);
      assert.equal(req.destroyCalls, 1);
      assert.equal(req.destroyed, true);
      assert.equal(fs.existsSync(dest), false);
      assert.equal(writes.length, 0);
    });
    await test('request errors keep all three existing rejection contracts', async () => {
      const error = new Error('request failure');
      plan = { requestError: error };
      assert.equal(await bounded(() => fetchSubmissions(9999999999, 'x')), null);
      plan = { requestError: error };
      await assert.rejects(bounded(() => hole('www.sec.gov', '/x')), (actual) => actual === error);
      plan = { requestError: error };
      await assert.rejects(bounded(() => downloadTickers(dest)), (actual) => actual === error);
      assert.equal(writes.length, 0);
    });
    await test('a response error after HTTP rejection is handled while the original result wins', async () => {
      const failure = { status: 503, error: new Error('aborted HTTP error body') };
      plan = failure;
      assert.equal(await bounded(() => fetchSubmissions(9999999999, 'x')), null);
      assert.equal(requests[requests.length - 1].resumed, true);
      plan = failure;
      await assert.rejects(bounded(() => hole('www.sec.gov', '/x')), /antwortete 503/);
      assert.equal(requests[requests.length - 1].resumed, true);
      plan = failure;
      await assert.rejects(bounded(() => downloadTickers(dest)), /HTTP 503/);
      assert.equal(requests[requests.length - 1].resumed, true);
      assert.equal(writes.length, 0);
    });
    await test('successful submissions still return and cache the lean record in the fixture', async () => {
      plan = { body: '{"sic":"1234","sicDescription":"Fixture","tickers":["TEST"],"ignored":true}' };
      const expected = { cik: 9999999999, sic: '1234', sicDescription: 'Fixture', tickers: ['TEST'] };
      assert.deepEqual(await bounded(() => fetchSubmissions(9999999999, 'x')), expected);
      assert.deepEqual(JSON.parse(fs.readFileSync(cikFile, 'utf8')), expected);
    });
    await test('successful hole responses still return the body text', async () => {
      plan = { body: 'synthetic 13F text' };
      assert.equal(await bounded(() => hole('www.sec.gov', '/x')), 'synthetic 13F text');
    });
    await test('invalid ticker JSON is rejected before the destination is written', async () => {
      const before = writes.length;
      plan = { body: '{"incomplete":' };
      await assert.rejects(bounded(() => downloadTickers(dest)), SyntaxError);
      assert.equal(fs.existsSync(dest), false);
      assert.equal(writes.length, before);
    });
    await test('successful ticker JSON keeps its bytes and byte-count result', async () => {
      const body = '{"0":{"ticker":"TEST","cik_str":9999999999}}';
      plan = { body };
      assert.equal(await bounded(() => downloadTickers(dest)), Buffer.byteLength(body));
      assert.equal(fs.readFileSync(dest, 'utf8'), body);
    });
    assert.deepEqual(calendarAccesses, [], 'No calendar read or write was attempted');
    assert.equal(uncaught.length, 0, 'No uncaughtException was observed');
    console.log(passed + ' response-stream cases passed; no real network or calendar I/O.');
  } finally {
    https.get = originalGet;
    https.request = originalRequest;
    for (const [name, fn] of originalFs) fs[name] = fn;
    for (const [name, fn] of originalConsole) console[name] = fn;
    process.argv = originalArgv;
    for (const [key, value] of originalEnv) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    for (const key of Object.keys(require.cache)) {
      if (!originalCache.has(key)) delete require.cache[key];
    }
    for (const [key, value] of originalCache) require.cache[key] = value;
    process.removeListener('uncaughtException', onUncaught);
    assert.equal(path.dirname(tmp), path.resolve(os.tmpdir()), 'Cleanup is limited to the owned temp fixture');
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });

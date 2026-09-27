'use strict';
// Offline stream regression tests. Run: node tests/fetch-secbulk-strom.test.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Writable } = require('node:stream');
const { finished } = require('node:stream/promises');
const { schreibeZeile, beendeStrom } = require('../scripts/fetch-secbulk.js');

let pass = 0, fail = 0;
const streams = [];
const tempRoot = path.resolve(os.tmpdir());
const temp = fs.mkdtempSync(path.join(tempRoot, 'fetch-secbulk-strom-'));
const track = (stream) => { streams.push(stream); return stream; };
const nextTurn = () => new Promise((resolve) => setImmediate(resolve));

async function within(promise, ms = 2000) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Stream did not settle within ' + ms + ' ms')), ms);
    })]);
  } finally { clearTimeout(timer); }
}

async function check(name, fn, ms = 2000) {
  try { await within(Promise.resolve().then(fn), ms); pass++; console.log('  ok   ' + name); }
  catch (err) { fail++; console.error('FAIL   ' + name + '\n       ' + err.message); }
}

async function run() {
  await check('both stream helpers are exported', () => {
    assert.equal(typeof schreibeZeile, 'function');
    assert.equal(typeof beendeStrom, 'function');
  });

  await check('missing parent rejects ENOENT within 2 s without an uncaught exception', async () => {
    const uncaught = [];
    const spy = (err) => { uncaught.push(err); };
    process.once('uncaughtException', spy);
    try {
      const stream = track(fs.createWriteStream(path.join(temp, 'gibt-es-nicht', 'x.jsonl')));
      const started = Date.now();
      await assert.rejects(within(beendeStrom(stream)), { code: 'ENOENT' });
      await nextTurn();
      assert.ok(Date.now() - started < 2000, 'failure must reject before the deadline');
      assert.deepEqual(uncaught, [], 'stream errors must not reach uncaughtException');
    } finally {
      await nextTurn();
      process.removeListener('uncaughtException', spy);
    }
  });

  await check('three JSONL lines are preserved exactly after finish', async () => {
    const file = path.join(temp, 'three.jsonl');
    const stream = track(fs.createWriteStream(file));
    const lines = ['{"ticker":"AAA"}\n', '{"ticker":"BBB"}\n', '{"ticker":"CCC"}\n'];
    for (const line of lines) await schreibeZeile(stream, line);
    await within(beendeStrom(stream));
    assert.equal(stream.writableFinished, true);
    assert.equal(fs.readFileSync(file, 'utf8'), lines.join(''));
  });

  await check('1000 lines survive real file backpressure at highWaterMark 16', async () => {
    const file = path.join(temp, 'backpressure.jsonl');
    const stream = track(fs.createWriteStream(file, { highWaterMark: 16 }));
    const write = stream.write;
    let blocked = 0, drained = 0;
    stream.write = function (...args) {
      // Coalesce each pressure window into a real writev instead of many tiny disk writes.
      this.cork();
      process.nextTick(() => this.uncork());
      const accepted = write.apply(this, args);
      if (!accepted) blocked++;
      return accepted;
    };
    stream.on('drain', () => { drained++; });
    const lines = Array.from({ length: 1000 }, (_, i) => i + '\n');
    for (const line of lines) await schreibeZeile(stream, line);
    await within(beendeStrom(stream));
    assert.ok(blocked > 0, 'the real stream must apply backpressure');
    assert.ok(blocked < lines.length, 'the fixture must exercise accepted and blocked writes');
    assert.equal(drained, blocked, 'each blocked write must drain before the next line');
    assert.equal(fs.readFileSync(file, 'utf8'), lines.join(''));
    assert.equal(stream.writableFinished, true);
  }, 4000); // The bulk success case shares the <5 s suite budget; ENOENT keeps its 2 s limit.

  await check('a blocked write stays pending until drain and removes its listeners', async () => {
    let release;
    const stream = track(new Writable({ highWaterMark: 1, write(_chunk, _encoding, callback) { release = callback; } }));
    let resolved = false;
    const writing = schreibeZeile(stream, 'line\n').then(() => { resolved = true; });
    await Promise.resolve();
    assert.equal(resolved, false, 'write(false) must not resolve before drain');
    release();
    await within(writing);
    assert.equal(resolved, true);
    assert.equal(stream.listenerCount('drain'), 0);
    assert.equal(stream.listenerCount('error'), 0);
    await within(beendeStrom(stream));
  });

  await check('an asynchronous write error rejects the drain wait and cleans listeners', async () => {
    const failure = Object.assign(new Error('synthetic disk failure'), { code: 'EIO' });
    const stream = track(new Writable({
      highWaterMark: 1,
      write(_chunk, _encoding, callback) { setImmediate(() => callback(failure)); },
    }));
    await assert.rejects(within(schreibeZeile(stream, 'line\n')), (err) => err === failure);
    assert.equal(stream.listenerCount('drain'), 0);
    assert.equal(stream.listenerCount('error'), 0);
  });

  await check('a synchronous write failure cannot fall between write and error monitoring', async () => {
    const failure = new Error('synchronous write failure');
    const stream = track(new Writable({
      highWaterMark: 1,
      write(_chunk, _encoding, callback) { callback(failure); },
    }));
    await assert.rejects(within(schreibeZeile(stream, 'line\n')), (err) => err === failure);
    assert.equal(stream.listenerCount('drain'), 0);
  });

  await check('closing before drain rejects rather than hanging', async () => {
    const stream = track(new Writable({ highWaterMark: 1, write() {} }));
    const writing = schreibeZeile(stream, 'line\n');
    stream.destroy();
    await assert.rejects(within(writing), { code: 'ERR_STREAM_PREMATURE_CLOSE' });
    assert.equal(stream.listenerCount('drain'), 0);
  });

  await check('an error in the drain turn is observed before the write helper resolves', async () => {
    const failure = new Error('error during drain');
    let release;
    const stream = track(new Writable({ highWaterMark: 1, write(_chunk, _encoding, callback) { release = callback; } }));
    // run() owns a permanent error listener while asynchronous network work is in progress.
    stream.on('error', () => {});
    stream.once('drain', () => { stream.destroy(failure); });
    const writing = schreibeZeile(stream, 'line\n');
    release();
    await assert.rejects(within(writing), (err) => err === failure);
    assert.equal(stream.listenerCount('drain'), 0);
  });

  await check('a previously failed stream rejects before another write is attempted', async () => {
    const stream = track(fs.createWriteStream(path.join(temp, 'missing', 'after-error.jsonl')));
    await assert.rejects(within(beendeStrom(stream)), { code: 'ENOENT' });
    const failure = stream.errored;
    let writes = 0;
    const write = stream.write;
    stream.write = function (...args) { writes++; return write.apply(this, args); };
    await assert.rejects(schreibeZeile(stream, 'must not be written\n'), (err) => err === failure);
    assert.equal(writes, 0);
  });

  await check('ending waits for the final flush before reporting success', async () => {
    let release;
    const stream = track(new Writable({
      write(_chunk, _encoding, callback) { callback(); },
      final(callback) { release = callback; },
    }));
    await schreibeZeile(stream, 'line\n');
    let resolved = false;
    const ending = beendeStrom(stream).then(() => { resolved = true; });
    await Promise.resolve();
    assert.equal(resolved, false, 'finish must not be reported before the final flush');
    release();
    await within(ending);
    assert.equal(stream.writableFinished, true);
  });

  await check('a final flush error rejects instead of allowing publication', async () => {
    const failure = Object.assign(new Error('final flush failed'), { code: 'EIO' });
    const stream = track(new Writable({
      write(_chunk, _encoding, callback) { callback(); },
      final(callback) { callback(failure); },
    }));
    await assert.rejects(within(beendeStrom(stream)), (err) => err === failure);
    assert.equal(stream.writableFinished, false);
  });

  await check('run awaits stream completion before calling the existing publication gate', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'fetch-secbulk.js'), 'utf8');
    const runStart = source.indexOf('async function run()');
    const ending = source.indexOf('await beendeStrom(strom)', runStart);
    const publishing = source.indexOf('veroeffentliche(OUT', runStart);
    assert.ok(runStart >= 0 && ending > runStart && publishing > ending);
    assert.match(source.slice(runStart, publishing), /await schreibeZeile\(strom,/);
    assert.match(source.slice(runStart, publishing), /strom\.on\('error'/);
  });
}

(async () => {
  try { await run(); }
  finally {
    const closing = streams.map((stream) => finished(stream).catch(() => {}));
    for (const stream of streams) stream.destroy();
    await within(Promise.all(closing));
    assert.equal(path.dirname(path.resolve(temp)), tempRoot, 'cleanup must stay inside the temp root');
    assert.ok(path.basename(temp).startsWith('fetch-secbulk-strom-'));
    fs.rmSync(temp, { recursive: true, force: true });
  }
  console.log('\nfetch-secbulk-strom: ' + pass + ' ok, ' + fail + ' fail');
  process.exitCode = fail ? 1 : 0;
})().catch((err) => { console.error(err); process.exitCode = 1; });

'use strict';
// Six real writers race one reader; fixtures and subprocesses are always owned.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const CHILDREN = 6;
const WRITES = 40;
const PAYLOAD = 'x'.repeat(20000);
const READ_ERRORS = new Set(['ENOENT', 'EBUSY', 'EPERM', 'EACCES']);
const childCode = `
  'use strict';
  (async () => {
    const { writeJsonAtomic, atomicWriteStats } = require(process.env.ATOMIC_LIB);
    const waitFor = (wanted) => new Promise(resolve => {
      const listener = message => {
        if (message === wanted) { process.off('message', listener); resolve(); }
      };
      process.on('message', listener);
    });
    const start = waitFor('start');
    const resume = waitFor('continue');
    let kontention = 0;
    process.send('ready');
    await start;
    for (let i = 0; i < 40; i++) {
      try {
        writeJsonAtomic(process.env.ATOMIC_ZIEL, { pid: process.pid, i, payload: 'x'.repeat(20000) });
      } catch (error) {
        if (process.platform === 'win32' && ['EPERM', 'EBUSY', 'EACCES'].includes(error.code)) kontention++;
        else throw error;
      }
      if (i === 19) { process.send('checkpoint'); await resume; }
      await new Promise(resolve => setTimeout(resolve, 1));
    }
    console.log(JSON.stringify({ renameRetries: atomicWriteStats.renameRetries, kontention }));
  })().catch(error => {
    console.error(error.stack || error);
    process.exitCode = 1;
  }).finally(() => {
    if (process.connected) process.disconnect();
  });
`;

async function main() {
  const tempRoot = fs.realpathSync(os.tmpdir());
  const dir = fs.mkdtempSync(path.join(tempRoot, 'atomic-concurrency-'));
  const target = path.join(dir, 'state.json');
  const states = [];
  const allowedReadErrors = Object.fromEntries([...READ_ERRORS].map(code => [code, 0]));
  let reader, deadline, started = false, resumed = false, timedOut = false;
  let reads = 0, midrunReads = 0, fragments = 0, readerError = null, firstFragment = '';

  function killChildren() {
    for (const state of states) {
      if (!state.exited && state.child.pid) state.child.kill('SIGKILL');
    }
  }
  function sendToAll(message) {
    for (const state of states) {
      state.child.send(message, error => {
        if (error) { state.error = error; killChildren(); }
      });
    }
  }
  function releaseCheckpoint() {
    // All writers still have twenty attempts left when this observation is made.
    // Corrupt reads also release the barrier so they fail the fragment assertion,
    // rather than being disguised as a timeout.
    if (!resumed && states.length === CHILDREN && states.every(state => state.checkpoint)
      && (midrunReads > 0 || fragments > 0)) {
      resumed = true;
      sendToAll('continue');
    }
  }
  function validRecord(record) {
    return record && states.some(state => state.child.pid === record.pid)
      && Number.isInteger(record.i) && record.i >= 0 && record.i < WRITES
      && typeof record.payload === 'string' && record.payload.length === 20000
      && record.payload === PAYLOAD;
  }
  function sample() {
    let text;
    try { text = fs.readFileSync(target, 'utf8'); }
    catch (error) {
      if (READ_ERRORS.has(error.code)) allowedReadErrors[error.code]++;
      else { readerError = error; killChildren(); }
      return;
    }
    try {
      const record = JSON.parse(text);
      if (!validRecord(record)) throw new Error('invalid writer identity, sequence or 20000-byte payload');
      reads++;
      if (!resumed && record.i < WRITES / 2) midrunReads++;
    } catch (error) {
      fragments++;
      if (!firstFragment) firstFragment = String(error.message).slice(0, 160);
    }
    releaseCheckpoint();
  }

  try {
    reader = setInterval(sample, 5);
    deadline = setTimeout(() => { timedOut = true; killChildren(); }, 60000);
    for (let index = 0; index < CHILDREN; index++) {
      const child = spawn(process.execPath, ['-e', childCode], {
        cwd: dir,
        env: { ...process.env, ATOMIC_LIB: path.join(__dirname, 'atomic-write.js'), ATOMIC_ZIEL: target },
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true,
      });
      const state = { child, ready: false, checkpoint: false, exited: false, error: null, stdout: '', stderr: '' };
      states.push(state);
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', text => { state.stdout += text; });
      child.stderr.on('data', text => { state.stderr += text; });
      state.closed = new Promise(resolve => child.once('close', resolve));
      state.finished = new Promise(resolve => {
        child.once('error', error => {
          state.error = error;
          state.exited = true;
          killChildren();
          resolve();
        });
        child.once('exit', (code, signal) => {
          state.code = code;
          state.signal = signal;
          state.exited = true;
          if (code !== 0 || signal) killChildren();
          resolve();
        });
      });
      child.on('message', message => {
        if (message === 'ready') {
          state.ready = true;
          if (!started && states.length === CHILDREN && states.every(item => item.ready)) {
            started = true;
            sendToAll('start');
          }
        } else if (message === 'checkpoint') {
          state.checkpoint = true;
          releaseCheckpoint();
        }
      });
    }
    await Promise.all(states.map(state => state.finished));
    clearInterval(reader);
    await Promise.all(states.map(state => state.closed));
    clearTimeout(deadline);
    assert.equal(timedOut, false, 'concurrent writers exceeded the 60-second deadline');
    assert.equal(readerError, null, 'reader encountered an unexpected filesystem error');
    const summaries = states.map((state, index) => {
      for (const line of state.stderr.trim().split(/\r?\n/).filter(Boolean)) {
        console.error('child ' + state.child.pid + ': ' + line);
      }
      assert.equal(state.error, null, 'child ' + index + ' transport: ' + state.stderr);
      assert.equal(state.code, 0, 'child ' + index + ' failed: ' + state.stderr);
      assert.equal(state.signal, null, 'child ' + index + ' was terminated');
      const summary = JSON.parse(state.stdout.trim().split(/\r?\n/).at(-1));
      assert.ok(Number.isInteger(summary.renameRetries) && summary.renameRetries >= 0, 'invalid retry counter');
      assert.ok(Number.isInteger(summary.kontention) && summary.kontention >= 0 && summary.kontention <= WRITES,
        'invalid exhausted-contention counter');
      return summary;
    });
    const renameRetries = summaries.reduce((sum, row) => sum + row.renameRetries, 0);
    const kontention = summaries.reduce((sum, row) => sum + row.kontention, 0);
    console.log(JSON.stringify({ children: states.length, writesPerChild: WRITES, reads, midrunReads,
      fragments, allowedReadErrors, renameRetries, kontention }));
    assert.equal(fragments, 0, 'reader observed a partial or invalid JSON write: ' + firstFragment);
    assert.ok(midrunReads > 0, 'reader must observe a complete value while all writers have work remaining');
    assert.ok(resumed, 'writers must complete both concurrent halves');
    if (process.platform !== 'win32') assert.equal(kontention, 0, 'POSIX must not swallow write failures');
    const final = JSON.parse(fs.readFileSync(target, 'utf8'));
    assert.ok(validRecord(final), 'final JSON must be a complete payload from one of the six child PIDs');
    assert.equal(new Set(states.map(state => state.child.pid)).size, CHILDREN, 'six distinct writers ran');
    assert.deepEqual(fs.readdirSync(dir).filter(name => /\.tmp\.\d+\.\d+$/.test(name)), [], 'no atomic-write temp remains');
  } finally {
    clearInterval(reader);
    clearTimeout(deadline);
    killChildren();
    await Promise.all(states.map(state => state.closed));
    assert.equal(path.dirname(dir), tempRoot, 'cleanup must remain inside the real temp root');
    assert.ok(path.basename(dir).startsWith('atomic-concurrency-'), 'cleanup must target the owned fixture');
    fs.rmSync(dir, { recursive: true, force: true });
    assert.equal(fs.existsSync(dir), false, 'owned concurrency fixture was removed');
  }
}

main().then(() => {
  console.log('atomic-write.concurrency.test.js: 1 ok, 0 fail');
  process.exit(0);
}, error => {
  console.error('FAIL atomic-write.concurrency.test.js: ' + error.stack);
  console.log('atomic-write.concurrency.test.js: 0 ok, 1 fail');
  process.exit(1);
});

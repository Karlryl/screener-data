'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');

const backfill = require('../scripts/backfill-prices-max.js');
const sourcePath = require.resolve('../scripts/backfill-prices-max.js');

function runHarness(source) {
  const result = spawnSync(process.execPath, ['-e', source, sourcePath], {
    encoding: 'utf8',
    env: process.env,
    timeout: 5000,
  });
  assert.equal(result.status, 0, `child failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  return result.stdout;
}

test('valid progress manifests preserve completion data and unrelated metadata', () => {
  const manifest = {
    done: { A: { at: '2026-09-01', bars: 12 } },
    lastAttemptedTicker: 'Z',
    metadata: { owner: 'local-backfill' },
  };

  assert.deepEqual(backfill.normalizeProgressManifest(manifest), manifest);
});

test('an empty legacy done array is canonicalized before JSON checkpointing', () => {
  let manifest = backfill.normalizeProgressManifest(JSON.parse('{"done":[]}'));
  manifest.done.A = { at: '2026-09-01', bars: 12 };

  manifest = backfill.normalizeProgressManifest(JSON.parse(JSON.stringify(manifest)));

  assert.equal(Array.isArray(manifest.done), false);
  assert.deepEqual(manifest.done.A, { at: '2026-09-01', bars: 12 });
});

test('corrupt JSON and destructive manifest shapes fail before checkpoint writes', () => {
  assert.throws(
    () => backfill.parseProgressManifest('{"done":', 'fixture-manifest'),
    /Corrupt progress manifest fixture-manifest/,
  );
  assert.throws(
    () => backfill.normalizeProgressManifest([], 'fixture-manifest'),
    /progress manifest fixture-manifest must be an object/,
  );
  assert.throws(
    () => backfill.normalizeProgressManifest({}, 'fixture-manifest'),
    /fixture-manifest\.done must be an object/,
  );
  assert.throws(
    () => backfill.normalizeProgressManifest({ done: ['A'] }, 'fixture-manifest'),
    /fixture-manifest\.done must be an object/,
  );
});

test('successful capped runs advance through a canonicalized legacy manifest', () => {
  const universe = ['A', 'B', 'C'];
  const state = { entries: {} };
  const seen = [];
  let manifest = backfill.normalizeProgressManifest(JSON.parse('{"done":[]}'));

  for (let run = 0; run < universe.length; run++) {
    const todo = backfill.selectPendingTickers(universe, manifest, state, {}, 1);
    const ticker = todo[0];
    seen.push(ticker);
    state.entries[ticker] = { needsReseed: false };
    manifest.done[ticker] = { at: '2026-09-01', bars: 12 };
    backfill.recordAttemptCursor(manifest, todo, 1);
    manifest = backfill.normalizeProgressManifest(JSON.parse(JSON.stringify(manifest)));
  }

  assert.deepEqual(seen, universe);
  assert.deepEqual(Object.keys(manifest.done), universe);
});

test('persistent failures survive JSON checkpoints and rotate instead of starving later tickers', () => {
  const universe = ['A', 'B', 'C'];
  const state = { entries: {} };
  let manifest = { done: {} };
  const seen = [];

  for (let run = 0; run < universe.length + 1; run++) {
    const todo = backfill.selectPendingTickers(universe, manifest, state, {}, 1);
    seen.push(todo[0]);
    backfill.recordAttemptCursor(manifest, todo, 1);
    manifest = JSON.parse(JSON.stringify(manifest));
  }

  assert.deepEqual(seen, ['A', 'B', 'C', 'A']);
  assert.deepEqual(manifest.done, {});
  assert.equal(manifest.lastAttemptedTicker, 'A');
});

test('duplicate explicit tickers cannot trap capped cursor rotation', () => {
  const universe = ['A', 'A', 'B'];
  const state = { entries: {} };
  let manifest = { done: {} };

  const first = backfill.selectPendingTickers(universe, manifest, state, {}, 1);
  backfill.recordAttemptCursor(manifest, first, 1);
  manifest = JSON.parse(JSON.stringify(manifest));
  const second = backfill.selectPendingTickers(universe, manifest, state, {}, 1);

  assert.deepEqual(first, ['A']);
  assert.deepEqual(second, ['B']);
});

test('unlimited runs retain the original pending order and ignore the capped cursor', () => {
  const universe = ['A', 'B', 'B', 'C', 'D'];
  const manifest = {
    done: { A: { at: '2026-09-01', bars: 12 } },
    lastAttemptedTicker: 'C',
  };
  const state = { entries: { A: { needsReseed: false } } };

  assert.deepEqual(
    backfill.selectPendingTickers(universe, manifest, state, {}, 0),
    ['B', 'B', 'C', 'D'],
  );
  backfill.recordAttemptCursor(manifest, ['D'], 0);
  assert.equal(manifest.lastAttemptedTicker, 'C');
});

test('helper import stays testable when yahoo-finance2 is unavailable', () => {
  const stdout = runHarness(String.raw`
    const assert = require('node:assert/strict');
    const Module = require('node:module');
    const sourcePath = process.argv[1];
    const originalLoad = Module._load;
    Module._load = function(request) {
      if (request === 'yahoo-finance2') throw new Error('dependency intentionally unavailable');
      return originalLoad.apply(this, arguments);
    };
    const moduleUnderTest = require(sourcePath);
    assert.equal(typeof moduleUnderTest.normalizeProgressManifest, 'function');
    process.stdout.write('IMPORT_OK');
  `);

  assert.match(stdout, /IMPORT_OK/);
});

test('a fully resumed no-op does not load Yahoo or write a checkpoint', () => {
  const stdout = runHarness(String.raw`
    const assert = require('node:assert/strict');
    const Module = require('node:module');
    const sourcePath = process.argv[1];
    const originalLoad = Module._load;
    const normalized = (file) => String(file).replaceAll('\\', '/');
    const fakeFs = {
      mkdirSync() {},
      readFileSync(file) {
        const name = normalized(file);
        if (name.endsWith('/prices-max/_manifest.json')) {
          return '{"done":{"A":{"at":"2026-09-01","bars":12}}}';
        }
        if (name.endsWith('/external-data/ath-state.json')) {
          return '{"asOf":"2026-09-01","entries":{"A":{"needsReseed":false}}}';
        }
        throw new Error('unexpected read: ' + name);
      },
    };
    Module._load = function(request, parent) {
      if (parent && parent.filename === sourcePath && request === 'fs') return fakeFs;
      if (parent && parent.filename === sourcePath && request === '../lib/atomic-write.js') {
        return { writeFileAtomic() { throw new Error('no-op must not write'); } };
      }
      if (request === 'yahoo-finance2') throw new Error('no-op must not load Yahoo');
      return originalLoad.apply(this, arguments);
    };

    (async () => {
      const moduleUnderTest = require(sourcePath);
      process.argv = ['node', sourcePath, '--tickers', 'A'];
      await moduleUnderTest.main();
      assert.notEqual(process.exitCode, 1);
      process.stdout.write('NOOP_OK');
    })().catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
  `);

  assert.match(stdout, /NOOP_OK/);
});

test('main wiring persists fair capped restart state and rejects corrupt bytes unchanged', () => {
  const stdout = runHarness(String.raw`
    const assert = require('node:assert/strict');
    const Module = require('node:module');
    const sourcePath = process.argv[1];
    const originalLoad = Module._load;
    let manifestRaw = '{"done":[]}';
    let stateRaw = '{"asOf":null,"entries":{}}';
    const attempts = [];
    const writes = [];
    const normalized = (file) => String(file).replaceAll('\\', '/');
    const fakeFs = {
      mkdirSync() {},
      readFileSync(file) {
        const name = normalized(file);
        if (name.endsWith('/prices-max/_manifest.json')) return manifestRaw;
        if (name.endsWith('/external-data/ath-state.json')) return stateRaw;
        const error = new Error('unexpected read: ' + name);
        error.code = 'ENOENT';
        throw error;
      },
    };
    const fakeAtomic = {
      writeFileAtomic(file, raw) {
        const name = normalized(file);
        writes.push(name);
        if (name.endsWith('/prices-max/_manifest.json')) manifestRaw = raw;
        else if (name.endsWith('/external-data/ath-state.json')) stateRaw = raw;
        else throw new Error('unexpected write: ' + name);
      },
    };
    class FakeYahooFinance {
      async chart(ticker) {
        attempts.push(ticker);
        return { quotes: [] };
      }
    }
    Module._load = function(request, parent) {
      if (parent && parent.filename === sourcePath && request === 'fs') return fakeFs;
      if (parent && parent.filename === sourcePath && request === '../lib/atomic-write.js') return fakeAtomic;
      if (request === 'yahoo-finance2') return { default: FakeYahooFinance };
      return originalLoad.apply(this, arguments);
    };

    (async () => {
      const moduleUnderTest = require(sourcePath);
      process.argv = ['node', sourcePath, '--tickers', 'A,B', '--limit', '1'];

      await moduleUnderTest.main();
      assert.equal(process.exitCode, 1);
      process.exitCode = 0;
      assert.deepEqual(attempts, ['A']);
      let checkpoint = JSON.parse(manifestRaw);
      assert.equal(Array.isArray(checkpoint.done), false);
      assert.equal(checkpoint.lastAttemptedTicker, 'A');

      await moduleUnderTest.main();
      assert.equal(process.exitCode, 1);
      process.exitCode = 0;
      assert.deepEqual(attempts, ['A', 'B']);
      checkpoint = JSON.parse(manifestRaw);
      assert.equal(checkpoint.lastAttemptedTicker, 'B');

      const corrupt = '{"done":';
      manifestRaw = corrupt;
      attempts.length = 0;
      writes.length = 0;
      await assert.rejects(moduleUnderTest.main(), /Corrupt progress manifest/);
      assert.equal(manifestRaw, corrupt);
      assert.deepEqual(attempts, []);
      assert.deepEqual(writes, []);
      process.stdout.write('MAIN_WIRING_OK');
    })().catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
  `);

  assert.match(stdout, /MAIN_WIRING_OK/);
});

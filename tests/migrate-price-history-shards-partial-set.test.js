'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

  const REPO_ROOT = path.join(__dirname, '..');
  const OFFLINE_GUARD = path.join(REPO_ROOT, 'tests', 'helpers', 'offline-network-guard.js');
  const SUITE_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'migrate-price-history-h59-'));
  let fixtureNumber = 0;
  let childNumber = 0;

  function makeMiniRepo(label) {
    fixtureNumber += 1;
    const root = path.join(SUITE_ROOT, String(fixtureNumber).padStart(2, '0') + '-' + label);
    const scriptsDir = path.join(root, 'scripts');
    const libDir = path.join(root, 'lib');
    const pricesDir = path.join(root, 'prices');
    fs.mkdirSync(scriptsDir, { recursive: true });
    fs.mkdirSync(libDir, { recursive: true });
    fs.mkdirSync(pricesDir, { recursive: true });
    fs.copyFileSync(
      path.join(REPO_ROOT, 'scripts', 'migrate-price-history-shards.js'),
      path.join(scriptsDir, 'migrate-price-history-shards.js'),
    );
    for (const name of ['price-history-store.js', 'atomic-write.js', 'read-json.js']) {
      fs.copyFileSync(path.join(REPO_ROOT, 'lib', name), path.join(libDir, name));
    }
    return {
      root,
      pricesDir,
      script: path.join(scriptsDir, 'migrate-price-history-shards.js'),
      store: require(path.join(libDir, 'price-history-store.js')),
    };
  }

  function sampleHistory() {
    return {
      SPY: [{ date: '2026-08-29', close: 646.31 }],
      NVDA: [{ date: '2026-08-29', close: 184.17 }],
    };
  }

  function writeLegacy(fixture, history = sampleHistory()) {
    const legacy = fixture.store.legacyPath(fixture.pricesDir);
    const bytes = JSON.stringify(history);
    fs.writeFileSync(legacy, bytes);
    return { legacy, bytes, history };
  }

  function writeCompleteShardsWithoutMeta(fixture, history = sampleHistory()) {
    const partitions = Array.from(
      { length: fixture.store.SHARD_COUNT },
      () => ({}),
    );
    for (const [ticker, series] of Object.entries(history)) {
      partitions[fixture.store.shardOf(ticker)][ticker] = series;
    }
    for (let n = 0; n < fixture.store.SHARD_COUNT; n++) {
      fixture.store.saveShard(fixture.pricesDir, n, partitions[n]);
    }
    return history;
  }

  function shardFiles(fixture) {
    const historyDir = path.join(fixture.pricesDir, 'history');
    if (!fs.existsSync(historyDir)) return [];
    return fs.readdirSync(historyDir)
      .filter(name => /^history-[0-9]{2}\.json$/.test(name))
      .sort();
  }

  function snapshotTree(root) {
    const snapshot = {};
    function visit(dir) {
      if (!fs.existsSync(dir)) return;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const absolute = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          visit(absolute);
        } else {
          const relative = path.relative(root, absolute).split(path.sep).join('/');
          snapshot[relative] = fs.readFileSync(absolute).toString('base64');
        }
      }
    }
    visit(root);
    return snapshot;
  }

  function writeLateStatePreload(fixture) {
    const preload = path.join(fixture.root, 'late-state-preload.js');
    fs.writeFileSync(preload, [
      "'use strict';",
      "const fs = require('node:fs');",
      "const path = require('node:path');",
      "const originalReadFileSync = fs.readFileSync;",
      "let injected = false;",
      "fs.readFileSync = function (...args) {",
      "  const result = originalReadFileSync.apply(this, args);",
      "  if (!injected && path.resolve(String(args[0])) === path.resolve(process.env.H59_LEGACY_PATH)) {",
      "    injected = true;",
      "    const shardPath = process.env.H59_LATE_SHARD_PATH;",
      "    fs.mkdirSync(path.dirname(shardPath), { recursive: true });",
      "    fs.writeFileSync(shardPath, '{}');",
      "  }",
      "  return result;",
      "};",
      '',
    ].join('\n'));
    return preload;
  }

  function runCli(fixture, label, options = {}) {
    childNumber += 1;
    const marker = path.join(
      SUITE_ROOT,
      'network-' + String(childNumber).padStart(2, '0') + '-' + label + '.log',
    );
    const args = ['--require', OFFLINE_GUARD];
    for (const preload of options.preloads || []) args.push('--require', preload);
    args.push(fixture.script);
    const run = spawnSync(process.execPath, args, {
      cwd: fixture.root,
      encoding: 'utf8',
      env: {
        ...process.env,
        SCREENER_OFFLINE_NETWORK_MARKER: marker,
        ...(options.env || {}),
      },
      shell: false,
      windowsHide: true,
      timeout: 30000,
      maxBuffer: 4 * 1024 * 1024,
    });
    return {
      status: run.status,
      signal: run.signal,
      output: (run.stdout || '') + (run.stderr || ''),
      attempts: fs.existsSync(marker)
        ? fs.readFileSync(marker, 'utf8').trim().split(/\r?\n/).filter(Boolean)
        : [],
    };
  }

  function assertOffline(run) {
    assert.deepEqual(run.attempts, [], 'migration attempted network I/O: ' + run.attempts.join(', '));
  }

  test('pristine legacy store migrates all 32 shards and preserves legacy bytes', () => {
    const fixture = makeMiniRepo('bootstrap');
    const { legacy, bytes, history } = writeLegacy(fixture);
    const run = runCli(fixture, 'bootstrap');

    assert.equal(run.status, 0, run.output);
    assert.match(run.output, /VERIFY ok: 2 tickers/);
    assert.equal(shardFiles(fixture).length, fixture.store.SHARD_COUNT);
    assert.equal(fs.existsSync(fixture.store.metaPath(fixture.pricesDir)), true);
    assert.deepEqual(fixture.store.loadAll(fixture.pricesDir), history);
    assert.equal(fs.readFileSync(legacy, 'utf8'), bytes);
    assertOffline(run);
  });

  test('pristine no-input state remains a genuine no-op', () => {
    const fixture = makeMiniRepo('no-input');
    const before = snapshotTree(fixture.pricesDir);
    const run = runCli(fixture, 'no-input');

    assert.equal(run.status, 0, run.output);
    assert.match(run.output, /nothing to migrate/);
    assert.deepEqual(snapshotTree(fixture.pricesDir), before);
    assertOffline(run);
  });

  test('complete pre-A7 shard layout without metadata remains an idempotent no-op', () => {
    const fixture = makeMiniRepo('complete-no-meta');
    const { legacy, bytes, history } = writeLegacy(fixture);
    writeCompleteShardsWithoutMeta(fixture, history);
    const before = snapshotTree(fixture.pricesDir);
    const run = runCli(fixture, 'complete-no-meta');

    assert.equal(run.status, 0, run.output);
    assert.deepEqual(snapshotTree(fixture.pricesDir), before);
    assert.deepEqual(fixture.store.loadAll(fixture.pricesDir), history);
    assert.equal(fs.readFileSync(legacy, 'utf8'), bytes);
    assertOffline(run);
  });

  test('complete stamped store with equal ticker count remains a byte-identical no-op', () => {
    const fixture = makeMiniRepo('complete-equal-meta');
    fixture.store.saveAll(fixture.pricesDir, sampleHistory());
    const before = snapshotTree(fixture.pricesDir);
    const run = runCli(fixture, 'complete-equal-meta');

    assert.equal(run.status, 0, run.output);
    assert.deepEqual(snapshotTree(fixture.pricesDir), before);
    assertOffline(run);
  });

  test('complete pre-A7 layout missing a legacy ticker fails closed without writes', () => {
    const fixture = makeMiniRepo('complete-no-meta-shrink');
    const { legacy, bytes, history } = writeLegacy(fixture);
    writeCompleteShardsWithoutMeta(fixture, history);
    const target = 'SPY';
    const targetShard = fixture.store.shardOf(target);
    const shard = fixture.store.loadShard(fixture.pricesDir, targetShard);
    const reduced = Object.fromEntries(
      Object.entries(shard).filter(([ticker]) => ticker !== target),
    );
    fixture.store.saveShard(fixture.pricesDir, targetShard, reduced);
    const before = snapshotTree(fixture.pricesDir);
    const run = runCli(fixture, 'complete-no-meta-shrink');

    assert.equal(run.status, 1, run.output);
    assert.match(run.output, /lost 1 legacy ticker\(s\)|directional shrinkage/i);
    assert.equal(fs.readFileSync(legacy, 'utf8'), bytes);
    assert.deepEqual(snapshotTree(fixture.pricesDir), before);
    assertOffline(run);
  });

  test('complete store may grow beyond stale metadata and remains a byte-identical no-op', () => {
    const fixture = makeMiniRepo('complete-growth');
    fixture.store.saveAll(fixture.pricesDir, sampleHistory());
    const metaPath = fixture.store.metaPath(fixture.pricesDir);
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    meta.tickerCount = 1;
    fs.writeFileSync(metaPath, JSON.stringify(meta));
    const before = snapshotTree(fixture.pricesDir);
    const run = runCli(fixture, 'complete-growth');

    assert.equal(run.status, 0, run.output);
    assert.deepEqual(snapshotTree(fixture.pricesDir), before);
    assert.equal(Object.keys(fixture.store.loadAll(fixture.pricesDir)).length, 2);
    assert.equal(JSON.parse(fs.readFileSync(metaPath, 'utf8')).tickerCount, 1);
    assertOffline(run);
  });

  for (const count of [1, 31]) {
    test('partial ' + count + '/32 shard layout fails closed without changing legacy or shards', () => {
      const fixture = makeMiniRepo('partial-' + count);
      const { legacy, bytes } = writeLegacy(fixture);
      for (let n = 0; n < count; n++) fixture.store.saveShard(fixture.pricesDir, n, {});
      const before = snapshotTree(fixture.pricesDir);
      const run = runCli(fixture, 'partial-' + count);

      assert.equal(run.status, 1, run.output);
      assert.match(run.output, new RegExp('partial shard store.*' + count + '/32', 'i'));
      assert.equal(shardFiles(fixture).length, count);
      assert.equal(fs.existsSync(fixture.store.metaPath(fixture.pricesDir)), false);
      assert.equal(fs.readFileSync(legacy, 'utf8'), bytes);
      assert.deepEqual(snapshotTree(fixture.pricesDir), before);
      assert.doesNotMatch(run.output, /VERIFY ok/);
      assertOffline(run);
    });
  }

  test('metadata without any shards fails closed before frozen legacy can be replayed', () => {
    const fixture = makeMiniRepo('meta-without-shards');
    const { legacy, bytes } = writeLegacy(fixture);
    const metaPath = fixture.store.metaPath(fixture.pricesDir);
    fs.mkdirSync(path.dirname(metaPath), { recursive: true });
    fs.writeFileSync(metaPath, JSON.stringify({
      schema: 'price-history-store/1',
      updatedAt: '2026-08-01T00:00:00.000Z',
      tickerCount: 0,
      shardsWritten: fixture.store.SHARD_COUNT,
    }));
    const before = snapshotTree(fixture.pricesDir);
    const run = runCli(fixture, 'meta-without-shards');

    assert.equal(run.status, 1, run.output);
    assert.match(run.output, /partial shard store.*0\/32/i);
    assert.equal(fs.readFileSync(legacy, 'utf8'), bytes);
    assert.deepEqual(snapshotTree(fixture.pricesDir), before);
    assertOffline(run);
  });

  test('complete but shrunken store fails through loadAll and remains byte-identical', () => {
    const fixture = makeMiniRepo('shrunken');
    fixture.store.saveAll(fixture.pricesDir, {
      SPY: [{ date: '2026-08-29', close: 646.31 }],
    });
    const metaPath = fixture.store.metaPath(fixture.pricesDir);
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    meta.tickerCount = 2;
    fs.writeFileSync(metaPath, JSON.stringify(meta));
    const before = snapshotTree(fixture.pricesDir);
    const run = runCli(fixture, 'shrunken');

    assert.equal(run.status, 1, run.output);
    assert.match(run.output, /complete shard set carries 1 ticker\(s\).*stamps 2|truncated\/incomplete/i);
    assert.deepEqual(snapshotTree(fixture.pricesDir), before);
    assertOffline(run);
  });

  test('complete shards with corrupt metadata fail closed and remain byte-identical', () => {
    const fixture = makeMiniRepo('corrupt-meta');
    fixture.store.saveAll(fixture.pricesDir, sampleHistory());
    fs.writeFileSync(fixture.store.metaPath(fixture.pricesDir), '{"tickerCount":');
    const before = snapshotTree(fixture.pricesDir);
    const run = runCli(fixture, 'corrupt-meta');

    assert.equal(run.status, 1, run.output);
    assert.match(run.output, /present.*unreadable|vorhanden.*unlesbar|Unexpected end of JSON input/i);
    assert.deepEqual(snapshotTree(fixture.pricesDir), before);
    assertOffline(run);
  });

  test('state appearing after legacy read fails before saveAll can overwrite it', () => {
    const fixture = makeMiniRepo('late-state');
    const { legacy, bytes } = writeLegacy(fixture);
    const preload = writeLateStatePreload(fixture);
    const lateShard = fixture.store.shardPath(fixture.pricesDir, 0);
    const run = runCli(fixture, 'late-state', {
      preloads: [preload],
      env: {
        H59_LEGACY_PATH: legacy,
        H59_LATE_SHARD_PATH: lateShard,
      },
    });

    assert.equal(run.status, 1, run.output);
    assert.match(run.output, /state appeared during migration preflight/i);
    assert.equal(shardFiles(fixture).length, 1);
    assert.equal(fs.existsSync(fixture.store.metaPath(fixture.pricesDir)), false);
    assert.equal(fs.readFileSync(legacy, 'utf8'), bytes);
    assert.doesNotMatch(run.output, /VERIFY ok/);
    assertOffline(run);
  });

  test('offline preload blocks a real network probe', () => {
    const marker = path.join(SUITE_ROOT, 'network-self-probe.log');
    const probe = spawnSync(process.execPath, [
      '--require',
      OFFLINE_GUARD,
      '--eval',
      "require('node:https').get('https://example.invalid')",
    ], {
      encoding: 'utf8',
      env: {
        ...process.env,
        SCREENER_OFFLINE_NETWORK_MARKER: marker,
      },
      shell: false,
      windowsHide: true,
      timeout: 30000,
      maxBuffer: 1024 * 1024,
    });

    assert.equal(probe.status, 1, (probe.stdout || '') + (probe.stderr || ''));
    assert.match((probe.stdout || '') + (probe.stderr || ''), /blocked network API: https\.get/);
    assert.match(fs.readFileSync(marker, 'utf8').trim(), /^[0-9]+:https\.get$/);
  });

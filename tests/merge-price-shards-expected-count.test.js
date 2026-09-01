'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const REPO_ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(REPO_ROOT, 'scripts', 'merge-price-shards.js');
const TRIPWIRE_MODE_ENV = 'MERGE_PRICE_SHARDS_IO_TRIPWIRE_MODE';
const TRIPWIRE_ROOT_ENV = 'MERGE_PRICE_SHARDS_IO_TRIPWIRE_ROOT';
const TRIPWIRE_MODE = 'h10-self-preload-v1';

function installPriceIoTripwire() {
  const guarded = path.resolve(process.env[TRIPWIRE_ROOT_ENV]);
  const pathArgCounts = {
    accessSync: 1,
    appendFileSync: 1,
    copyFileSync: 2,
    existsSync: 1,
    lstatSync: 1,
    mkdirSync: 1,
    openSync: 1,
    readFileSync: 1,
    readdirSync: 1,
    renameSync: 2,
    rmSync: 1,
    rmdirSync: 1,
    statSync: 1,
    truncateSync: 1,
    unlinkSync: 1,
    writeFileSync: 1,
  };
  for (const [method, pathArgCount] of Object.entries(pathArgCounts)) {
    const original = fs[method];
    fs[method] = function (...args) {
      for (const candidate of args.slice(0, pathArgCount)) {
        if (typeof candidate !== 'string') continue;
        const resolved = path.resolve(candidate);
        if (resolved === guarded || resolved.startsWith(guarded + path.sep)) {
          process.stderr.write(`FS_TRIPWIRE_ATTEMPT:${method}:${resolved}\n`);
          throw new Error(`FS_TRIPWIRE:${method}:${resolved}`);
        }
      }
      return original.apply(this, args);
    };
  }
}

function unusedPricesPath(label) {
  return path.join(
    os.tmpdir(),
    `merge-price-shards-count-${label}-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );
}

if (process.env[TRIPWIRE_MODE_ENV] === TRIPWIRE_MODE && process.env[TRIPWIRE_ROOT_ENV]) {
  installPriceIoTripwire();
} else {
  const { MAX_EXPECTED_SHARDS, parseArgs, parseExpectedShards } = require(SCRIPT);

  test('expected-shards parser preserves the default and accepts bounded positive integers', () => {
    assert.equal(MAX_EXPECTED_SHARDS, 4096, 'the operational safety ceiling is policy, not a derived value');
    assert.equal(parseExpectedShards(['node', SCRIPT]), undefined);
    assert.equal(parseArgs(['node', SCRIPT]).expected, 4);
    for (const value of ['1', '4', '17', '4096']) {
      assert.equal(
        parseExpectedShards(['node', SCRIPT, '--expected-shards', value]),
        Number(value),
      );
      assert.equal(
        parseArgs(['node', SCRIPT, '--expected-shards', value]).expected,
        Number(value),
      );
    }
  });

  test('expected-shards parser rejects missing, malformed, unsafe, excessive, and repeated values', () => {
    for (const args of [
      ['--expected-shards'],
      ['--expected-shards', '0'],
      ['--expected-shards', '-1'],
      ['--expected-shards', '1.5'],
      ['--expected-shards', '17junk'],
    ]) {
      assert.throws(
        () => parseExpectedShards(['node', SCRIPT, ...args]),
        /positive integer/,
        args.join(' '),
      );
    }

    assert.throws(
      () => parseExpectedShards(['node', SCRIPT, '--expected-shards', '9007199254740992']),
      /safe positive integer/,
    );

    assert.throws(
      () => parseExpectedShards([
        'node',
        SCRIPT,
        '--expected-shards',
        '4097',
      ]),
      /at most 4096/,
    );

    assert.throws(
      () => parseExpectedShards([
        'node',
        SCRIPT,
        '--expected-shards',
        '1',
        '--expected-shards',
        '4',
      ]),
      /must not be repeated/,
    );
  });

  test('invalid expected count exits before any price-directory I/O', () => {
    const pricesDir = unusedPricesPath('invalid');
    const date = '2026-08-31';
    const run = spawnSync(process.execPath, [
      '--require', __filename,
      SCRIPT,
      '--prices', pricesDir,
      '--date', date,
      '--expected-shards', '1.5',
    ], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: {
        ...process.env,
        [TRIPWIRE_MODE_ENV]: TRIPWIRE_MODE,
        [TRIPWIRE_ROOT_ENV]: pricesDir,
      },
    });

    assert.equal(run.status, 1);
    assert.match(run.stderr, /::error::merge-price-shards - .*positive integer/);
    assert.doesNotMatch(run.stderr, /FS_TRIPWIRE(?:_ATTEMPT)?/);
    assert.equal(fs.existsSync(path.join(pricesDir, `${date}.json`)), false);
    assert.equal(fs.existsSync(path.join(pricesDir, 'history', '_meta.json')), false);
  });

  test('price-directory I/O tripwire proves that the preload guard can fire', () => {
    const pricesDir = unusedPricesPath('tripwire-control');
    const probePath = path.join(pricesDir, 'probe.json');
    const run = spawnSync(process.execPath, [
      '--require', __filename,
      '--eval', "require('node:fs').existsSync(process.env.MERGE_PRICE_SHARDS_IO_PROBE_PATH)",
    ], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: {
        ...process.env,
        [TRIPWIRE_MODE_ENV]: TRIPWIRE_MODE,
        [TRIPWIRE_ROOT_ENV]: pricesDir,
        MERGE_PRICE_SHARDS_IO_PROBE_PATH: probePath,
      },
    });

    assert.equal(run.status, 1);
    assert.match(run.stderr, /FS_TRIPWIRE_ATTEMPT:existsSync:/);
    assert.match(run.stderr, /FS_TRIPWIRE:existsSync:/);
    assert.equal(fs.existsSync(probePath), false);
  });

  test('valid expected count controls the CLI merge loop', () => {
    const pricesDir = unusedPricesPath('valid');
    const run = spawnSync(process.execPath, [
      '--require', __filename,
      SCRIPT,
      '--prices', pricesDir,
      '--date', '2026-08-31',
      '--expected-shards', '1',
    ], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: {
        ...process.env,
        [TRIPWIRE_MODE_ENV]: TRIPWIRE_MODE,
        [TRIPWIRE_ROOT_ENV]: path.join(REPO_ROOT, 'prices'),
      },
    });

    assert.equal(run.status, 1);
    assert.match(run.stdout, /Shard\(s\) 0 \u2014/);
    assert.doesNotMatch(run.stdout, /Shard\(s\) 0, 1/);
    assert.doesNotMatch(run.stderr, /FS_TRIPWIRE(?:_ATTEMPT)?/);
  });
}

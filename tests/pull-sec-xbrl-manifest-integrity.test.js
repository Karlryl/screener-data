'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const https = require('node:https');
const path = require('node:path');

const xbrl = require('../pull-sec-xbrl.js');

function requireIntegrityApi() {
  assert.equal(typeof xbrl.loadManifest, 'function', 'the strict manifest loader must be exported');
  assert.equal(typeof xbrl.validateManifest, 'function', 'the shape validator must be exported');
  assert.equal(typeof xbrl.main, 'function');
}

function reader(valueOrError, effects, expectedFile) {
  return {
    readFileSync(file, encoding) {
      effects.push('read');
      if (expectedFile !== undefined) assert.equal(file, expectedFile);
      assert.equal(encoding, 'utf8');
      if (valueOrError instanceof Error) throw valueOrError;
      return valueOrError;
    },
  };
}

test('array-backed entries silently discard zero-padded CIK properties when serialized', () => {
  const entries = [];
  entries['0000320193'] = { ticker: 'AAPL' };

  assert.equal(entries['0000320193'].ticker, 'AAPL', 'the in-memory assignment appears to work');
  assert.equal(JSON.stringify(entries), '[]', 'JSON persistence loses the progress completely');
});

test('loadManifest bootstraps only an absent manifest', () => {
  requireIntegrityApi();

  const missing = Object.assign(new Error('missing'), { code: 'ENOENT' });
  const missingEffects = [];
  assert.deepEqual(xbrl.loadManifest('missing.json', reader(missing, missingEffects)), { entries: {} });
  assert.deepEqual(missingEffects, ['read']);

  for (const code of ['EACCES', 'EIO']) {
    const error = Object.assign(new Error(code), { code });
    assert.throws(
      () => xbrl.loadManifest('present.json', reader(error, [])),
      /cannot read SEC XBRL manifest/i,
      `${code} must not be treated as a first run`,
    );
  }

  assert.throws(
    () => xbrl.loadManifest('present.json', reader('{"entries":', [])),
    /SEC XBRL manifest is corrupt.*invalid JSON/i,
  );
});

test('valid manifests preserve unknown root and entry fields without normalization', () => {
  requireIntegrityApi();

  const expected = {
    entries: {
      '0000320193': {
        ticker: 'AAPL',
        fetchedAt: '2026-08-31T00:00:00.000Z',
        futureEntryField: { keep: true },
      },
    },
    lastRun: '2026-08-31',
    futureRootField: ['keep', 7],
  };
  const loaded = xbrl.loadManifest('present.json', reader(JSON.stringify(expected), []));

  assert.deepEqual(loaded, expected);
  assert.deepEqual(xbrl.loadManifest('empty.json', reader('{"entries":{}}', [])), { entries: {} });
  assert.deepEqual(xbrl.loadManifest('legacy.json', reader('{"entries":{"1":{}}}', [])), {
    entries: { 1: {} },
  });
});

test('invalid root, entries, inherited entries, and entry values fail closed', () => {
  requireIntegrityApi();

  const invalidJson = [
    ['null root', 'null'],
    ['array root', '[]'],
    ['boolean root', 'false'],
    ['number root', '7'],
    ['string root', '"manifest"'],
    ['missing entries', '{}'],
    ['entries null', '{"entries":null}'],
    ['entries array', '{"entries":[]}'],
    ['entries boolean', '{"entries":false}'],
    ['entries number', '{"entries":7}'],
    ['entries string', '{"entries":"bad"}'],
    ['entry null', '{"entries":{"1":null}}'],
    ['entry array', '{"entries":{"1":[]}}'],
    ['entry primitive', '{"entries":{"1":"bad"}}'],
    ['invalid middle entry', '{"entries":{"good":{},"bad":[],"after":{}}}'],
  ];

  for (const [name, raw] of invalidJson) {
    assert.throws(
      () => xbrl.loadManifest('present.json', reader(raw, [])),
      /SEC XBRL manifest is corrupt/i,
      name,
    );
  }

  const inherited = Object.create({ entries: {} });
  assert.throws(
    () => xbrl.validateManifest(inherited, 'memory'),
    /own entries object/i,
    'prototype state must not satisfy a persisted-state contract',
  );
});

test('main validates existing state before mkdir, ticker fetch, transport, or writes', async () => {
  requireIntegrityApi();

  for (const raw of ['{"entries":[]}', '{"entries":{"good":{},"bad":null}}', '{"entries":']) {
    const effects = [];
    const originalBytes = Buffer.from(raw, 'utf8');
    const cacheDir = 'C:\\virtual\\sec-xbrl';
    const manifestPath = path.join(cacheDir, '_manifest.json');
    const fsProbe = {
      ...reader(originalBytes.toString('utf8'), effects, manifestPath),
      existsSync() { effects.push('exists'); return false; },
      mkdirSync() { effects.push('mkdir'); },
    };

    await assert.rejects(
      () => xbrl.main({
        argv: ['node', 'pull-sec-xbrl.js'],
        cacheDir,
        fs: fsProbe,
        fetchSecTickers: async () => { effects.push('fetch'); return new Map(); },
        get: async () => { effects.push('get'); throw new Error('transport reached'); },
        sleep: async () => { effects.push('sleep'); },
        writeFileAtomic: () => { effects.push('write'); },
      }),
      /SEC XBRL manifest is corrupt/i,
    );
    assert.deepEqual(effects, ['read'], `unexpected side effect for ${raw}`);
    assert.equal(originalBytes.toString('utf8'), raw, 'the rejected source bytes changed');
  }
});

test('ENOENT bootstraps before setup, while a valid run preserves unknown fields', async () => {
  requireIntegrityApi();

  const sentinel = new Error('ticker sentinel');
  const missing = Object.assign(new Error('missing'), { code: 'ENOENT' });
  const bootstrapEffects = [];
  const bootstrapCacheDir = 'C:\\virtual\\bootstrap-sec-xbrl';
  const bootstrapManifestPath = path.join(bootstrapCacheDir, '_manifest.json');
  const bootstrapFs = {
    ...reader(missing, bootstrapEffects, bootstrapManifestPath),
    existsSync(file) { bootstrapEffects.push(`exists:${file}`); return false; },
    mkdirSync(dir) { bootstrapEffects.push(`mkdir:${dir}`); },
  };
  await assert.rejects(
    () => xbrl.main({
      argv: ['node', 'pull-sec-xbrl.js'],
      cacheDir: bootstrapCacheDir,
      fs: bootstrapFs,
      fetchSecTickers: async () => { bootstrapEffects.push('fetch'); throw sentinel; },
      get: async () => { bootstrapEffects.push('get'); throw new Error('transport reached'); },
      sleep: async () => { bootstrapEffects.push('sleep'); },
      writeFileAtomic: () => { bootstrapEffects.push('write'); },
    }),
    error => error === sentinel,
  );
  assert.deepEqual(bootstrapEffects, [
    'read',
    `exists:${bootstrapCacheDir}`,
    `mkdir:${bootstrapCacheDir}`,
    'fetch',
  ]);

  const cacheDir = 'C:\\virtual\\sec-xbrl';
  const manifestPath = path.join(cacheDir, '_manifest.json');
  const manifest = {
    entries: {
      '0000320193': {
        ticker: 'AAPL',
        fetchedAt: '2999-01-01T00:00:00.000Z',
        futureEntryField: 'preserve',
      },
    },
    futureRootField: { preserve: true },
  };
  const effects = [];
  const writes = [];
  const fsProbe = {
    ...reader(JSON.stringify(manifest), effects, manifestPath),
    existsSync(file) { effects.push(`exists:${file}`); return true; },
    mkdirSync() { effects.push('mkdir'); },
  };

  await xbrl.main({
    argv: ['node', 'pull-sec-xbrl.js'],
    cacheDir,
    fs: fsProbe,
    fetchSecTickers: async () => {
      effects.push('fetch');
      return new Map([['AAPL', { ticker: 'AAPL', cik: '0000320193' }]]);
    },
    get: async () => { effects.push('get'); throw new Error('fresh entry reached transport'); },
    sleep: async () => { effects.push('sleep'); },
    writeFileAtomic(file, body) { effects.push(`write:${file}`); writes.push([file, body]); },
  });

  assert.equal(effects.includes('get'), false);
  assert.equal(effects.includes('sleep'), false);
  assert.equal(effects.includes('mkdir'), false);
  assert.equal(writes.length, 1);
  assert.equal(writes[0][0], manifestPath);
  assert.deepEqual(effects, [
    'read',
    `exists:${cacheDir}`,
    'fetch',
    `exists:${path.join(cacheDir, '0000320193.json')}`,
    `write:${manifestPath}`,
  ]);
  const persisted = JSON.parse(writes[0][1]);
  assert.deepEqual(persisted.futureRootField, { preserve: true });
  assert.equal(persisted.entries['0000320193'].futureEntryField, 'preserve');
  assert.equal(persisted.summary.skippedFresh, 1);
  assert.equal(persisted.summary.totalKnown, 1);
});

test('a stale HTTP-200 refresh preserves unknown fields and clears known retry state', async () => {
  requireIntegrityApi();

  const cacheDir = 'C:\\virtual\\stale-sec-xbrl';
  const manifestPath = path.join(cacheDir, '_manifest.json');
  const cik = '0000320193';
  const oldFetchedAt = '2000-01-01T00:00:00.000Z';
  const responseBody = '{"facts":{}}';
  const manifest = {
    entries: {
      [cik]: {
        ticker: 'OLD',
        fetchedAt: oldFetchedAt,
        lastModified: 'old',
        bytes: 1,
        notFound: true,
        notFoundStreak: 4,
        lastNotFoundAt: '2000-01-02T00:00:00.000Z',
        lastError: 'old failure',
        futureEntryField: { preserve: true },
      },
    },
    futureRootField: 'preserve',
  };
  const effects = [];
  const writes = [];
  const fsProbe = {
    ...reader(JSON.stringify(manifest), effects, manifestPath),
    existsSync(file) { effects.push(`exists:${file}`); return true; },
    mkdirSync() { effects.push('mkdir'); },
  };

  await xbrl.main({
    argv: ['node', 'pull-sec-xbrl.js'],
    cacheDir,
    fs: fsProbe,
    fetchSecTickers: async () => {
      effects.push('fetch');
      return new Map([['AAPL', { ticker: 'AAPL', cik }]]);
    },
    get: async () => {
      effects.push('get');
      return { body: responseBody, lastModified: 'new' };
    },
    sleep: async () => { effects.push('sleep'); },
    writeFileAtomic(file, body) { effects.push(`write:${file}`); writes.push([file, body]); },
  });

  assert.equal(writes.length, 2, 'one companyfacts body and one final manifest are expected');
  assert.equal(writes[1][0], manifestPath);
  const persisted = JSON.parse(writes[1][1]);
  const refreshed = persisted.entries[cik];
  assert.deepEqual(refreshed.futureEntryField, { preserve: true });
  assert.equal(persisted.futureRootField, 'preserve');
  assert.equal(refreshed.ticker, 'AAPL');
  assert.equal(refreshed.lastModified, 'new');
  assert.notEqual(refreshed.fetchedAt, oldFetchedAt);
  assert.equal(Number.isFinite(Date.parse(refreshed.fetchedAt)), true);
  assert.equal(refreshed.bytes, Buffer.byteLength(responseBody, 'utf8'));
  for (const staleField of ['notFound', 'notFoundStreak', 'lastNotFoundAt', 'lastError']) {
    assert.equal(Object.prototype.hasOwnProperty.call(refreshed, staleField), false, staleField);
  }
  assert.equal(effects.includes('get'), true);
  assert.equal(effects.includes('sleep'), true);
  assert.deepEqual(effects, [
    'read',
    `exists:${cacheDir}`,
    'fetch',
    'get',
    `write:${path.join(cacheDir, cik + '.json')}`,
    'sleep',
    `write:${manifestPath}`,
  ]);
});

test('the no-argument production path validates before default filesystem or HTTPS effects', async () => {
  requireIntegrityApi();

  const originalReadFileSync = fs.readFileSync;
  const originalExistsSync = fs.existsSync;
  const originalMkdirSync = fs.mkdirSync;
  const originalHttpsGet = https.get;
  const effects = [];
  const expectedCacheDir = process.env.SEC_XBRL_CACHE_DIR
    || path.join(__dirname, '..', 'external-data', 'sec-xbrl');
  const expectedManifestPath = path.join(expectedCacheDir, '_manifest.json');
  try {
    fs.readFileSync = (file, encoding) => {
      assert.equal(path.resolve(String(file)), path.resolve(expectedManifestPath));
      assert.equal(encoding, 'utf8');
      effects.push('read-manifest');
      return '{"entries":[]}';
    };
    fs.existsSync = () => { effects.push('exists'); return false; };
    fs.mkdirSync = () => { effects.push('mkdir'); };
    https.get = () => { effects.push('https'); throw new Error('HTTPS must not be reached'); };

    await assert.rejects(() => xbrl.main(), /SEC XBRL manifest is corrupt/i);
    assert.deepEqual(effects, ['read-manifest']);
  } finally {
    fs.readFileSync = originalReadFileSync;
    fs.existsSync = originalExistsSync;
    fs.mkdirSync = originalMkdirSync;
    https.get = originalHttpsGet;
  }
});

test('SEC_XBRL_CACHE_DIR controls the no-argument manifest path at module load', async () => {
  const modulePath = require.resolve('../pull-sec-xbrl.js');
  const originalModule = require.cache[modulePath];
  const originalEnv = process.env.SEC_XBRL_CACHE_DIR;
  const originalReadFileSync = fs.readFileSync;
  const originalExistsSync = fs.existsSync;
  const originalMkdirSync = fs.mkdirSync;
  const originalHttpsGet = https.get;
  const envCacheDir = 'C:\\virtual\\env-sec-xbrl';
  const expectedManifestPath = path.join(envCacheDir, '_manifest.json');
  const effects = [];
  try {
    process.env.SEC_XBRL_CACHE_DIR = envCacheDir;
    delete require.cache[modulePath];
    const envXbrl = require('../pull-sec-xbrl.js');

    fs.readFileSync = (file, encoding) => {
      assert.equal(path.resolve(String(file)), path.resolve(expectedManifestPath));
      assert.equal(encoding, 'utf8');
      effects.push('read-manifest');
      return '{"entries":[]}';
    };
    fs.existsSync = () => { effects.push('exists'); return false; };
    fs.mkdirSync = () => { effects.push('mkdir'); };
    https.get = () => { effects.push('https'); throw new Error('HTTPS must not be reached'); };

    await assert.rejects(() => envXbrl.main(), /SEC XBRL manifest is corrupt/i);
    assert.deepEqual(effects, ['read-manifest']);
  } finally {
    fs.readFileSync = originalReadFileSync;
    fs.existsSync = originalExistsSync;
    fs.mkdirSync = originalMkdirSync;
    https.get = originalHttpsGet;
    if (originalEnv === undefined) delete process.env.SEC_XBRL_CACHE_DIR;
    else process.env.SEC_XBRL_CACHE_DIR = originalEnv;
    delete require.cache[modulePath];
    if (originalModule) require.cache[modulePath] = originalModule;
  }
});

test('the real CLI bootstrap exits nonzero on corruption without filesystem or network effects', () => {
  const scriptPath = path.join(__dirname, '..', 'pull-sec-xbrl.js');
  const virtualCacheDir = path.join(path.parse(scriptPath).root, `codex-virtual-sec-xbrl-${process.pid}`);
  const expectedManifestPath = path.join(virtualCacheDir, '_manifest.json');
  const preloadSource = `
    import fs from 'node:fs';
    import https from 'node:https';
    import path from 'node:path';
    const cacheDir = process.env.SEC_XBRL_CACHE_DIR;
    const manifestPath = path.join(cacheDir, '_manifest.json');
    const originalReadFileSync = fs.readFileSync.bind(fs);
    const originalExistsSync = fs.existsSync.bind(fs);
    const originalMkdirSync = fs.mkdirSync.bind(fs);
    const isCachePath = file => {
      const resolved = path.resolve(String(file));
      const root = path.resolve(cacheDir);
      return resolved === root || resolved.startsWith(root + path.sep);
    };
    fs.readFileSync = (file, encoding, ...rest) => {
      if (path.resolve(String(file)) === path.resolve(manifestPath)) {
        if (encoding !== 'utf8') throw new Error('ENCODING_TRIPWIRE');
        process.stdout.write('CLI_MANIFEST_READ=' + path.resolve(String(file)) + '\\n');
        return '{"entries":[]}';
      }
      return originalReadFileSync(file, encoding, ...rest);
    };
    fs.existsSync = file => {
      if (isCachePath(file)) throw new Error('FILESYSTEM_TRIPWIRE');
      return originalExistsSync(file);
    };
    fs.mkdirSync = (file, ...args) => {
      if (isCachePath(file)) throw new Error('FILESYSTEM_TRIPWIRE');
      return originalMkdirSync(file, ...args);
    };
    https.get = () => { throw new Error('NETWORK_TRIPWIRE'); };
    globalThis.fetch = async () => { throw new Error('NETWORK_TRIPWIRE'); };
  `;
  const preloadUrl = 'data:text/javascript;base64,' + Buffer.from(preloadSource).toString('base64');
  const run = spawnSync(process.execPath, ['--import', preloadUrl, scriptPath], {
    cwd: path.join(__dirname, '..'),
    encoding: 'utf8',
    timeout: 10000,
    env: {
      ...process.env,
      SEC_XBRL_CACHE_DIR: virtualCacheDir,
      SEC_CONTACT: process.env.SEC_CONTACT || 'manifest-test@example.invalid',
    },
  });
  const output = (run.stdout || '') + (run.stderr || '');

  assert.equal(run.signal, null, output);
  assert.equal(run.status, 1, output);
  assert.match(output, /SEC XBRL manifest is corrupt/i);
  assert.equal(output.includes('CLI_MANIFEST_READ=' + path.resolve(expectedManifestPath)), true, output);
  assert.doesNotMatch(output, /NETWORK_TRIPWIRE|FILESYSTEM_TRIPWIRE|ENCODING_TRIPWIRE/);
});

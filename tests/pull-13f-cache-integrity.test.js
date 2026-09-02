#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const puller = require('../scripts/pull-13f-institutional.js');
const internals = puller._internals || {};

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

function loader() {
  assert.strictEqual(typeof internals.loadInstitutionCache, 'function',
    'strict SEC 13F cache loader must be exported through _internals');
  return internals.loadInstitutionCache;
}

function readFixture(value, expectedPath = 'fixture.json') {
  let calls = 0;
  return {
    deps: {
      readFileSync(actualPath, encoding) {
        calls++;
        assert.strictEqual(actualPath, expectedPath);
        assert.strictEqual(encoding, 'utf8');
        return typeof value === 'string' ? value : JSON.stringify(value);
      }
    },
    calls: () => calls
  };
}

function loadValue(value) {
  const fixture = readFixture(value);
  const result = loader()('fixture.json', fixture.deps);
  assert.strictEqual(fixture.calls(), 1, 'cache must be read exactly once');
  return result;
}

function rejectsValue(value, pattern) {
  assert.throws(() => loadValue(value), pattern);
}

function validPosition(overrides = {}) {
  return Object.assign({ cusip: '123456789', nameOfIssuer: 'Fixture Issuer' }, overrides);
}

async function assertMainRejectsBeforeEffects(cacheBytes, pattern) {
  assert.strictEqual(typeof internals.main, 'function',
    'production main must be exposed through the test seam');
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sec-13f-cache-integrity-'));
  const cachePath = path.join(tempDir, 'retained.json');
  const derivedPath = puller.deriveByTickerPath(cachePath);
  const derivedSentinel = 'derived sentinel';
  fs.writeFileSync(cachePath, cacheBytes, 'utf8');
  fs.writeFileSync(derivedPath, derivedSentinel, 'utf8');
  const trace = [];

  await assert.rejects(() => internals.main({
    argv: ['node', 'pull-13f-institutional.js', '--out', cachePath,
      '--cik-list', '0001067983'],
    ensureDirFn() { trace.push('ensure'); },
    async pullInstitutionFn() {
      trace.push('pull');
      return { positions: [], error: 'tripwire' };
    },
    writeFileAtomicFn() { trace.push('write'); }
  }), pattern);

  assert.deepStrictEqual(trace, [], 'corruption must fail before any filesystem setup or side effect');
  assert.strictEqual(fs.readFileSync(cachePath, 'utf8'), cacheBytes);
  assert.strictEqual(fs.readFileSync(derivedPath, 'utf8'), derivedSentinel);
}

test('strict cache loader is reachable through the production module', () => {
  assert.strictEqual(typeof internals.loadInstitutionCache, 'function');
});

test('ENOENT alone bootstraps an empty byInstitution map', () => {
  const missing = Object.assign(new Error('missing'), { code: 'ENOENT' });
  const result = loader()('missing.json', {
    readFileSync() { throw missing; }
  });
  assert.deepStrictEqual(result, { byInstitution: {} });
});

test('a non-ENOENT read failure is never treated as an empty first run', () => {
  const denied = Object.assign(new Error('denied'), { code: 'EACCES' });
  assert.throws(() => loader()('denied.json', {
    readFileSync() { throw denied; }
  }), /unable to read SEC 13F cache.*denied/);
});

for (const [label, text] of [
  ['empty bytes', ''],
  ['invalid JSON', '{broken']
]) {
  test(label + ' fails closed', () => rejectsValue(text, /SEC 13F cache is not valid JSON/));
}

for (const [label, value] of [
  ['null', null],
  ['array', []],
  ['string', '"cache"'],
  ['number', 7],
  ['boolean', false]
]) {
  test(label + ' root fails closed', () => rejectsValue(value, /root must be an object/));
}

for (const value of [{}, { ByInstitution: {} }]) {
  test('root without own byInstitution fails closed: ' + JSON.stringify(value), () => {
    rejectsValue(value, /must own an object-valued byInstitution/);
  });
}

test('an inherited byInstitution cannot impersonate persisted cache state', () => {
  Object.defineProperty(Object.prototype, 'byInstitution', {
    configurable: true,
    enumerable: false,
    value: {}
  });
  try {
    rejectsValue({}, /must own an object-valued byInstitution/);
  } finally {
    delete Object.prototype.byInstitution;
  }
});

for (const [label, value] of [
  ['null', null],
  ['array', []],
  ['string', 'entries'],
  ['number', 3],
  ['boolean', true]
]) {
  test(label + ' byInstitution fails closed', () => {
    rejectsValue({ byInstitution: value }, /byInstitution must be an object/);
  });
}

test('an inherited positions field is ignored when the entry owns no positions', () => {
  Object.defineProperty(Object.prototype, 'positions', {
    configurable: true,
    enumerable: false,
    value: null
  });
  try {
    const value = { byInstitution: { alpha: { error: 'first-run failure' } } };
    const loaded = loadValue(value);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(loaded.byInstitution.alpha, 'positions'), false);
  } finally {
    delete Object.prototype.positions;
  }
});

test('an inherited quarters field is ignored when the entry owns no quarters', () => {
  Object.defineProperty(Object.prototype, 'quarters', {
    configurable: true,
    enumerable: false,
    value: null
  });
  try {
    const value = { byInstitution: { alpha: { error: 'first-run failure' } } };
    const loaded = loadValue(value);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(loaded.byInstitution.alpha, 'quarters'), false);
  } finally {
    delete Object.prototype.quarters;
  }
});

test('empty byInstitution is a valid retained-cache state', () => {
  assert.deepStrictEqual(loadValue({ byInstitution: {} }), { byInstitution: {} });
});

test('arbitrary keys and an entry without positions remain valid', () => {
  const value = { byInstitution: { 'not-a-cik': { error: 'thrown: timeout' } } };
  assert.deepStrictEqual(loadValue(value), value);
});

test('unknown root, entry and position fields are preserved', () => {
  const value = {
    futureRoot: { keep: true },
    byInstitution: {
      alpha: {
        futureEntry: 17,
        positions: [validPosition({ futurePosition: ['keep'] })]
      }
    }
  };
  assert.deepStrictEqual(loadValue(value), value);
});

for (const [label, value] of [
  ['null', null],
  ['array', []],
  ['string', 'entry'],
  ['number', 4],
  ['boolean', false]
]) {
  test(label + ' institution entry fails closed', () => {
    rejectsValue({ byInstitution: { bad: value } }, /institution bad must be an object/);
  });
}

test('every quarter entry is validated, not only the first or last', () => {
  rejectsValue({
    byInstitution: {
      alpha: {
        quarters: {
          first: { positions: [validPosition({ cusip: 'FIRST' })] },
          middle: null,
          last: { positions: [validPosition({ cusip: 'LAST' })] }
        }
      }
    }
  }, /institution alpha quarter middle must be an object/);
});

test('every institution entry is validated, not only the first or last', () => {
  rejectsValue({
    byInstitution: {
      first: { positions: [] },
      middle: null,
      last: { positions: [] }
    }
  }, /institution middle must be an object/);
});

for (const [label, value] of [
  ['null', null],
  ['object', {}],
  ['string', 'positions'],
  ['number', 5],
  ['boolean', true]
]) {
  test(label + ' own positions value fails closed', () => {
    rejectsValue({ byInstitution: { bad: { positions: value } } },
      /institution bad positions must be an array/);
  });
}

for (const [label, value] of [
  ['null', null],
  ['array', []],
  ['string', 'position'],
  ['number', 6],
  ['boolean', false]
]) {
  test(label + ' position element fails closed', () => {
    rejectsValue({ byInstitution: { bad: { positions: [value] } } },
      /institution bad position 0 must be an object/);
  });
}

test('every position element is validated, not only the first or last', () => {
  rejectsValue({
    byInstitution: {
      alpha: { positions: [validPosition({ cusip: 'A' }), null, validPosition({ cusip: 'C' })] }
    }
  }, /institution alpha position 1 must be an object/);
});

for (const field of ['cusip', 'nameOfIssuer']) {
  for (const [label, value, omit] of [
    ['missing', undefined, true],
    ['null', null, false],
    ['empty', '', false],
    ['whitespace-only', '   ', false],
    ['object', {}, false],
    ['array', [], false],
    ['number', 6, false],
    ['boolean', false, false]
  ]) {
    test(label + ' position ' + field + ' fails closed', () => {
      const position = validPosition();
      if (omit) delete position[field];
      else position[field] = value;
      rejectsValue({ byInstitution: { bad: { positions: [position] } } },
        new RegExp('institution bad position 0 ' + field + ' must be a non-empty string'));
    });
  }
}

for (const [label, value] of [
  ['null', null],
  ['array', []],
  ['string', 'quarters'],
  ['number', 8],
  ['boolean', true]
]) {
  test(label + ' own quarters value fails closed', () => {
    rejectsValue({ byInstitution: { bad: { quarters: value } } },
      /institution bad quarters must be an object/);
  });
}

for (const [label, value] of [
  ['null', null],
  ['array', []],
  ['string', 'quarter'],
  ['number', 9],
  ['boolean', false]
]) {
  test(label + ' quarter entry fails closed', () => {
    rejectsValue({ byInstitution: { bad: { quarters: { '2026-06-30': value } } } },
      /institution bad quarter 2026-06-30 must be an object/);
  });
}

for (const [label, value, omit] of [
  ['missing', undefined, true],
  ['null', null, false],
  ['object', {}, false],
  ['string', 'positions', false],
  ['number', 10, false],
  ['boolean', true, false]
]) {
  test(label + ' quarter positions value fails closed', () => {
    const quarter = {};
    if (!omit) quarter.positions = value;
    rejectsValue({ byInstitution: { bad: { quarters: { period: quarter } } } },
      /institution bad quarter period positions must be an array/);
  });
}

test('quarter position elements use the same object boundary', () => {
  rejectsValue({
    byInstitution: { bad: { quarters: { period: { positions: [null] } } } }
  }, /institution bad quarter period position 0 must be an object/);
});

test('quarter position identifiers use the same consumer-safe boundary', () => {
  rejectsValue({
    byInstitution: {
      bad: { quarters: { period: { positions: [validPosition({ cusip: {} })] } } }
    }
  }, /institution bad quarter period position 0 cusip must be a non-empty string/);
});

test('valid quarter history and unknown fields are preserved', () => {
  const value = {
    byInstitution: {
      alpha: {
        quarters: {
          arbitrary: {
            positions: [validPosition({ futurePosition: 11 })],
            futureQuarter: true
          }
        }
      }
    }
  };
  assert.deepStrictEqual(loadValue(value), value);
});

test('the current committed cache satisfies the structural boundary', () => {
  const currentPath = path.join(__dirname, '..', 'external-data', 'sec-13f-cache.json');
  const current = loader()(currentPath);
  assert(current && current.byInstitution && !Array.isArray(current.byInstitution));
});

test('production main rejects malformed retained state before pull or either writer', async () => {
  const malformedBytes = '{broken retained cache';
  await assertMainRejectsBeforeEffects(malformedBytes, /SEC 13F cache is not valid JSON/);
});

test('production main rejects malformed quarter history before pull or either writer', async () => {
  const malformedBytes = JSON.stringify({
    byInstitution: { '0001067983': { quarters: [] } }
  });
  await assertMainRejectsBeforeEffects(malformedBytes,
    /institution 0001067983 quarters must be an object/);
});

test('production main uses every injected dependency on a healthy path', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sec-13f-cache-integrity-healthy-'));
  const cachePath = path.join(tempDir, 'retained.json');
  const derivedPath = puller.deriveByTickerPath(cachePath);
  const cacheSentinel = JSON.stringify({ byInstitution: {} });
  const derivedSentinel = 'derived sentinel';
  fs.writeFileSync(cachePath, cacheSentinel, 'utf8');
  fs.writeFileSync(derivedPath, derivedSentinel, 'utf8');
  const trace = [];

  await internals.main({
    argv: ['node', 'pull-13f-institutional.js', '--out', cachePath,
      '--cik-list', '0001067983'],
    ensureDirFn(actualPath) {
      trace.push('ensure');
      assert.strictEqual(actualPath, path.join(__dirname, '..', 'external-data'));
    },
    async pullInstitutionFn(cik) {
      trace.push('pull:' + cik);
      return {
        name: 'Fixture Institution',
        filingDate: '2026-08-14',
        reportPeriod: '2026-06-30',
        positions: [validPosition()]
      };
    },
    writeFileAtomicFn(targetPath, bytes) {
      const parsed = JSON.parse(bytes);
      if (targetPath === cachePath) {
        trace.push('write:cache');
        assert.strictEqual(parsed.byInstitution['0001067983'].positions.length, 1);
      } else if (targetPath === derivedPath) {
        trace.push('write:derived');
        assert.strictEqual(parsed.cusipCount, 1);
      } else {
        assert.fail('unexpected writer target: ' + targetPath);
      }
    }
  });

  assert.deepStrictEqual(trace,
    ['ensure', 'pull:0001067983', 'write:cache', 'write:derived']);
  assert.strictEqual(fs.readFileSync(cachePath, 'utf8'), cacheSentinel);
  assert.strictEqual(fs.readFileSync(derivedPath, 'utf8'), derivedSentinel);
});

test('the real CLI exits nonzero on corruption without changing either artifact', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sec-13f-cache-integrity-cli-'));
  const cachePath = path.join(tempDir, 'retained.json');
  const derivedPath = puller.deriveByTickerPath(cachePath);
  const malformedBytes = '{broken retained cache';
  const derivedSentinel = 'derived sentinel';
  fs.writeFileSync(cachePath, malformedBytes, 'utf8');
  fs.writeFileSync(derivedPath, derivedSentinel, 'utf8');

  const result = spawnSync(process.execPath, [
    path.join(__dirname, '..', 'scripts', 'pull-13f-institutional.js'),
    '--out', cachePath,
    '--cik-list', '0001067983'
  ], { encoding: 'utf8' });

  assert.strictEqual(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /SEC 13F cache is not valid JSON/);
  assert.strictEqual(fs.readFileSync(cachePath, 'utf8'), malformedBytes);
  assert.strictEqual(fs.readFileSync(derivedPath, 'utf8'), derivedSentinel);
});

(async () => {
  let passed = 0;
  let failed = 0;
  for (const { name, fn } of tests) {
    try {
      await fn();
      passed++;
      console.log('  ok  ', name);
    } catch (error) {
      failed++;
      console.error('FAIL  ', name);
      console.error('      ', error && error.stack ? error.stack : error);
    }
  }
  console.log(`\npull-13f-cache-integrity: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
})();

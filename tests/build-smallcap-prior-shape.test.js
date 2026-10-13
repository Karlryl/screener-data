'use strict';

// H56: A present Small-Cap watchlist with a malformed `stocks` member must not
// be treated like a missing file. This test uses one virtual path only: it does
// not create, read, overwrite, or delete a repository/productive artifact.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { state: offlineState } = require('./helpers/offline-network-guard.js');

const TARGET = path.join(__dirname, '__virtual__', 'watchlist-smallcap-prior-shape.json');
const PRODUCT_BASENAME = 'watchlist-smallcap.json';
const MISSING = Symbol('missing');
const originalReadFileSync = fs.readFileSync;
let fixture = MISSING;

fs.readFileSync = function readVirtualPrior(filePath, ...args) {
  const resolvedPath = path.resolve(String(filePath));
  if (resolvedPath !== path.resolve(TARGET)) {
    if (path.basename(resolvedPath).toLowerCase() === PRODUCT_BASENAME) {
      throw new Error(`TEST: productive Small-Cap watchlist read blocked: ${resolvedPath}`);
    }
    return originalReadFileSync.call(fs, filePath, ...args);
  }
  if (fixture === MISSING) {
    const error = new Error(`ENOENT: no such file or directory, open '${TARGET}'`);
    error.code = 'ENOENT';
    error.path = TARGET;
    throw error;
  }
  return fixture;
};

const { pruefeMindestbestand } = require('../build-smallcap-universe.js');

let pass = 0;
let fail = 0;

function test(name, fn) {
  try {
    fn();
    assert.deepEqual(offlineState.attempts, [], 'the shape check must stay offline');
    pass++;
    console.log('  ok   ' + name);
  } catch (error) {
    fail++;
    console.error('FAIL   ' + name + '\n       ' + (error && error.stack ? error.stack : error));
  }
}

function check(rawJson, countNew = 600) {
  fixture = rawJson;
  return pruefeMindestbestand(countNew, TARGET);
}

function captureError(rawJson) {
  try {
    check(rawJson);
    return null;
  } catch (error) {
    return error;
  }
}

for (const [label, rawJson] of [
  ['missing stocks', '{}'],
  ['null stocks', '{"stocks":null}'],
  ['object stocks', '{"stocks":{}}'],
  ['string stocks', '{"stocks":"bad"}'],
]) {
  test(`present prior with ${label} is corrupt, not a first install`, () => {
    const error = captureError(rawJson);
    assert.ok(error, 'malformed prior state silently became vorher=0');
    assert.ok(String(error.message).includes(TARGET), 'diagnostic must name the rejected path');
    assert.match(String(error.message), /stocks ist kein Array/,
      'diagnostic must identify the malformed stocks member');
    assert.equal(error.jsonPath, TARGET, 'machine-readable error must carry the JSON path');
    assert.equal(error.corrupt, true, 'machine-readable error must mark corrupt content');
  });
}

test('valid wrapped prior keeps the percentage floor', () => {
  const stocks = Array.from({ length: 600 }, (_, index) => ({ ticker: `T${index}` }));
  assert.deepEqual(check(JSON.stringify({ _meta: { count: 600 }, stocks })), {
    vorher: 600,
    noetig: 300,
  });
});

test('valid empty stocks array keeps the absolute floor', () => {
  assert.deepEqual(check('{"stocks":[]}', 200), { vorher: 0, noetig: 200 });
});

test('ENOENT remains the only first-install path', () => {
  fixture = MISSING;
  assert.deepEqual(pruefeMindestbestand(200, TARGET), { vorher: 0, noetig: 200 });
});

fs.readFileSync = originalReadFileSync;
console.log(`\n${pass} ok, ${fail} fail`);
process.exitCode = fail ? 1 : 0;

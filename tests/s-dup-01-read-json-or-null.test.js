'use strict';
// Offline behavior pin. Run: node tests/s-dup-01-read-json-or-null.test.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readJsonOrNull, readJsonOr, readJsonExistingOrThrow, FEHLT } = require('../lib/read-json.js');
let pass = 0, fail = 0, assertions = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (error) { fail++; console.error('FAIL   ' + name + '\n' + error.stack); }
}
function check(method, ...args) { assertions++; assert[method](...args); }
// Exact old tolerant bodies, independent of the new shared implementation.
function alt(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) { return null; } }
function altOr(p, fallback) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) { return fallback; } }
const tmpRoot = path.resolve(os.tmpdir());
const dir = fs.mkdtempSync(path.join(tmpRoot, 's-dup-01-read-json-'));
const fallback = { fixture: 'same object' };
try {
  const cases = [
    ['missing', undefined, null, true],
    ['object', '{"a":1,"nested":{"b":true}}', { a: 1, nested: { b: true } }, false],
    ['syntax', '{"a":', null, true],
    ['null', 'null', null, false],
    ['array', '[]', [], false],
    ['number', '5', 5, false],
    ['directory', undefined, null, true],
  ];
  for (const [name, content, expected, failedRead] of cases) {
    test(name + ': tolerant readers preserve the old behavior', () => {
      const file = path.join(dir, name + '.json');
      if (name === 'directory') fs.mkdirSync(file);
      else if (content !== undefined) fs.writeFileSync(file, content, 'utf8');
      let actual;
      check('doesNotThrow', () => { actual = readJsonOrNull(file); });
      check('deepEqual', actual, expected);
      check('deepEqual', alt(file), actual);
      const withFallback = readJsonOr(file, fallback);
      check('deepEqual', altOr(file, fallback), withFallback);
      if (failedRead) check('strictEqual', withFallback, fallback, 'fallback identity is preserved');
      else check('deepEqual', withFallback, expected, 'valid non-object JSON never selects fallback');
      if (name === 'missing') check('strictEqual', readJsonExistingOrThrow(file), FEHLT);
      else if (name === 'object') check('deepEqual', readJsonExistingOrThrow(file), expected);
      else check('throws', () => readJsonExistingOrThrow(file), 'the required-file reader stays strict');
    });
  }
  test('explicit null and omitted fallback keep their exact values', () => {
    const missing = path.join(dir, 'never-created.json');
    check('strictEqual', readJsonOr(missing, null), null);
    check('strictEqual', readJsonOr(missing), undefined);
    check('deepEqual', fallback, { fixture: 'same object' });
  });
} finally {
  const owned = path.resolve(dir);
  assert.equal(path.dirname(owned), tmpRoot, 'cleanup stays directly inside OS temp');
  assert.ok(path.basename(owned).startsWith('s-dup-01-read-json-'), 'cleanup owns this fixture');
  fs.rmSync(owned, { recursive: true, force: true });
}
console.log(`\ns-dup-01-read-json-or-null: ${pass} ok, ${fail} fail, ${assertions} assertions`);
process.exit(fail ? 1 : 0);

'use strict';
/** Standalone, offline coverage. Run: node lib/sec-user-agent.test.js */
const assert = require('node:assert/strict');

let passed = 0;
let failed = 0;
let assertions = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (error) { failed++; console.error('FAIL   ' + name + '\n' + error.stack); }
}
function equal(actual, expected, message) {
  assertions++;
  assert.equal(actual, expected, message);
}
function rejectsContact(fn) {
  assertions++;
  assert.throws(fn, /SEC_CONTACT.*Kontakt-Mail/);
}
function withContact(value, fn) {
  const hadContact = Object.hasOwn(process.env, 'SEC_CONTACT');
  const previous = process.env.SEC_CONTACT;
  try {
    if (value === undefined) delete process.env.SEC_CONTACT;
    else process.env.SEC_CONTACT = value;
    fn();
  } finally {
    if (hadContact) process.env.SEC_CONTACT = previous;
    else delete process.env.SEC_CONTACT;
  }
}

let api;
test('import is safe without SEC_CONTACT; fail-fast is explicit', () => {
  withContact(undefined, () => {
    assertions++;
    assert.doesNotThrow(() => { api = require('./sec-user-agent.js'); });
    equal(typeof api.secUserAgent, 'function');
    equal(typeof api.assertSecContact, 'function');
    equal(api.secUserAgent(), '');
    rejectsContact(api.assertSecContact);
  });
});

test('normal contact is returned by both exports', () => {
  withContact('Example screener-data reader@example.com', () => {
    equal(api.secUserAgent(), 'Example screener-data reader@example.com');
    equal(api.assertSecContact(), 'Example screener-data reader@example.com');
  });
});

test('leading and trailing whitespace is trimmed', () => {
  withContact(' \t Example screener-data reader@example.com \r\n', () => {
    equal(api.secUserAgent(), 'Example screener-data reader@example.com');
    equal(api.assertSecContact(), 'Example screener-data reader@example.com');
  });
});

test('empty and whitespace-only contacts remain import-safe but fail guard', () => {
  for (const value of ['', ' \t\r\n ']) {
    withContact(value, () => {
      equal(api.secUserAgent(), '');
      rejectsContact(api.assertSecContact);
    });
  }
});

test('missing mail and string representations of null, NaN and negative values fail guard', () => {
  // Environment variables are strings; do not rely on deprecated implicit coercion.
  for (const value of ['Example screener-data', 'null', 'NaN', '-1']) {
    withContact(value, () => {
      equal(api.secUserAgent(), value);
      rejectsContact(api.assertSecContact);
    });
  }
});

test('contacts are read at call time instead of captured during import', () => {
  withContact('First first@example.com', () => {
    equal(api.secUserAgent(), 'First first@example.com');
    equal(api.assertSecContact(), 'First first@example.com');
    process.env.SEC_CONTACT = 'Second second@example.com';
    equal(api.secUserAgent(), 'Second second@example.com');
    equal(api.assertSecContact(), 'Second second@example.com');
    delete process.env.SEC_CONTACT;
    equal(api.secUserAgent(), '');
    rejectsContact(api.assertSecContact);
  });
});

test('current guard is only an at-sign check, not full email validation', () => {
  // Current limitation: a bare at-sign passes the guard. No production fix here.
  withContact(' @ ', () => {
    equal(api.secUserAgent(), '@');
    equal(api.assertSecContact(), '@');
  });
});

console.log(`\nsec-user-agent.test.js: ${passed} ok, ${failed} fail, ${assertions} assertions`);
process.exitCode = failed ? 1 : 0;

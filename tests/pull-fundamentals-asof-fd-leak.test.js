// Real-file fixture: {"fundamentalsAsOf":"2026-01-01T00:00:00.000Z"}
'use strict';
const assert = require('assert');
const fs = require('fs');
const P = require('../pull-yahoo.js');
const NOW = Date.parse('2026-01-03T00:00:00.000Z');
const EXPECTED_AGE = 172800000;
let passed = 0, failed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log('PASS ' + name); }
  catch (error) { failed++; console.error('FAIL ' + name + ': ' + error.message); }
}

check('readSync throws once: null and the opened fd is closed', () => {
  const original = { open: fs.openSync, read: fs.readSync, close: fs.closeSync };
  let opened, readCalls = 0;
  const closed = [];
  try {
    fs.openSync = (...args) => { opened = original.open(...args); return opened; };
    fs.readSync = (...args) => {
      if (++readCalls === 1) throw Object.assign(new Error('simulated read failure'), { code: 'EIO' });
      return original.read(...args);
    };
    fs.closeSync = (fd) => { closed.push(fd); return original.close(fd); };
    assert.strictEqual(P.fundamentalsAsOfAgeFromFile(__filename, NOW), null);
    assert.strictEqual(readCalls, 1);
    assert.strictEqual(typeof opened, 'number');
    assert.deepStrictEqual(closed, [opened], 'closeSync must receive the opened fd');
  } finally {
    fs.openSync = original.open; fs.readSync = original.read; fs.closeSync = original.close;
    // Also clean up when the deliberately broken implementation leaks its handle.
    if (typeof opened === 'number' && !closed.includes(opened)) original.close(opened);
  }
});

check('normal file: unchanged known fundamentals age and one close', () => {
  const originalClose = fs.closeSync;
  const closed = [];
  try {
    fs.closeSync = (fd) => { closed.push(fd); return originalClose(fd); };
    assert.strictEqual(P.fundamentalsAsOfAgeFromFile(__filename, NOW), EXPECTED_AGE);
    assert.strictEqual(closed.length, 1);
  } finally { fs.closeSync = originalClose; }
});

check('openSync throws: null and no close', () => {
  const originalOpen = fs.openSync, originalClose = fs.closeSync;
  let openCalls = 0;
  const closed = [];
  try {
    fs.openSync = () => { openCalls++; throw Object.assign(new Error('simulated open failure'), { code: 'EBUSY' }); };
    fs.closeSync = (fd) => { closed.push(fd); };
    assert.strictEqual(P.fundamentalsAsOfAgeFromFile(__filename, NOW), null);
    assert.strictEqual(openCalls, 1);
    assert.deepStrictEqual(closed, []);
  } finally { fs.openSync = originalOpen; fs.closeSync = originalClose; }
});

console.log('pull-fundamentals-asof-fd-leak.test.js: ' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exitCode = 1;

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const zip = require('../lib/zip-stream.js');

function entryBlock(method, payload) {
  const localHeader = Buffer.alloc(30);
  localHeader.writeUInt32LE(zip._sig.LFH_SIG, 0);
  localHeader.writeUInt16LE(method, 8);
  localHeader.writeUInt16LE(0, 26);
  localHeader.writeUInt16LE(0, 28);
  return Buffer.concat([localHeader, payload]);
}

function entry(method, payload) {
  return {
    name: 'CIK-test.json',
    methode: method,
    compressedSize: payload.length,
  };
}

test('a complete stored entry still returns its declared payload', () => {
  const payload = Buffer.from('{"ok":true}', 'utf8');
  assert.deepEqual(zip.entpackeEintrag(entryBlock(0, payload), entry(0, payload)), payload);
});

test('an unsupported compression method fails at the ZIP decoder boundary', () => {
  const payload = Buffer.from('{"ok":true}', 'utf8');
  assert.throws(
    () => zip.entpackeEintrag(entryBlock(99, payload), entry(99, payload)),
    (error) => {
      assert.equal(error.message, 'zip: unbekanntes Verfahren 99 bei CIK-test.json');
      return true;
    },
  );
});

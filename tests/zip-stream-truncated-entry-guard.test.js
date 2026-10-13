'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const zip = require('../lib/zip-stream.js');

function storedEntryBlock(payload) {
  const localHeader = Buffer.alloc(30);
  localHeader.writeUInt32LE(zip._sig.LFH_SIG, 0);
  localHeader.writeUInt16LE(0, 26);
  localHeader.writeUInt16LE(0, 28);
  return Buffer.concat([localHeader, payload]);
}

test('complete stored entry returns every declared payload byte', () => {
  const payload = Buffer.from('abc', 'utf8');
  const entry = {
    name: 'CIK-test.json',
    methode: 0,
    compressedSize: payload.length,
  };

  assert.deepEqual(zip.entpackeEintrag(storedEntryBlock(payload), entry), payload);
});

test('truncated stored entry fails loudly with observed and declared byte counts', () => {
  const payload = Buffer.from('abc', 'utf8');
  const entry = {
    name: 'CIK-test.json',
    methode: 0,
    compressedSize: 5,
  };

  assert.throws(
    () => zip.entpackeEintrag(storedEntryBlock(payload), entry),
    (error) => {
      assert.equal(
        error.message,
        'zip: Daten unvollstaendig bei CIK-test.json (3 von 5)',
      );
      return true;
    },
  );
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const zip = require('../lib/zip-stream.js');

function storedEntryBlock(signature, payload) {
  const localHeader = Buffer.alloc(30);
  localHeader.writeUInt32LE(signature, 0);
  localHeader.writeUInt16LE(0, 8);
  localHeader.writeUInt16LE(0, 26);
  localHeader.writeUInt16LE(0, 28);
  return Buffer.concat([localHeader, payload]);
}

function entry(payload) {
  return {
    name: 'CIK-test.json',
    methode: 0,
    compressedSize: payload.length,
  };
}

test('a stored entry with the local-header signature returns its payload', () => {
  const payload = Buffer.from('{"ok":true}', 'utf8');
  assert.deepEqual(zip.entpackeEintrag(storedEntryBlock(zip._sig.LFH_SIG, payload), entry(payload)), payload);
});

test('a corrupt local-header signature fails before payload interpretation', () => {
  const payload = Buffer.from('{"ok":true}', 'utf8');
  const corruptSignature = zip._sig.LFH_SIG ^ 1;
  assert.throws(
    () => zip.entpackeEintrag(storedEntryBlock(corruptSignature, payload), entry(payload)),
    (error) => {
      assert.equal(error.message, 'zip: lokaler Kopf fehlt bei CIK-test.json');
      return true;
    },
  );
});

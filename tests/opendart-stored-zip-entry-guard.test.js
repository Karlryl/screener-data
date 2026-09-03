'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const { unzipFirstEntry } = require('../discovery/opendart-kr.js');

function localEntry(method, raw) {
  const name = Buffer.from('CORPCODE.xml');
  const compressed = method === 8 ? zlib.deflateRawSync(raw) : raw;
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0, 6);
  header.writeUInt16LE(method, 8);
  header.writeUInt32LE(compressed.length, 18);
  header.writeUInt32LE(raw.length, 22);
  header.writeUInt16LE(name.length, 26);
  header.writeUInt16LE(0, 28);
  return Buffer.concat([header, name, compressed]);
}

test('an OpenDART STORED local entry returns its bytes unchanged', () => {
  const payload = Buffer.from('<result><status>000</status></result>');

  assert.deepEqual(unzipFirstEntry(localEntry(0, payload)), payload);
});

test('an empty OpenDART DEFLATE entry remains a valid control', () => {
  const payload = Buffer.alloc(0);

  assert.deepEqual(unzipFirstEntry(localEntry(8, payload)), payload);
});

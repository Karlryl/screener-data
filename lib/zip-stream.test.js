'use strict';

// Classic ZIP roundtrips only. Corruption guards and ZIP64 have their own suites.
const assert = require('node:assert/strict');
const zip = require('./zip-stream.js');
const { baueZip } = require('../tests/helpers/zip-fixture.js');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (error) { fail++; console.error('FAIL   ' + name + '\n' + error.stack); }
}

const files = [
  { name: 'empty.txt', inhalt: '' },
  { name: 'folder/gr\u00fc\u00dfe.txt', inhalt: 'Gr\u00fc\u00dfe \u2603\n'.repeat(40) },
  { name: 'binary.bin', inhalt: Buffer.from([0x00, 0x7f, 0xff, 0x80, 0x01]) },
];

for (const stored of [true, false]) {
  test((stored ? 'Store' : 'Deflate') + ' roundtrip preserves empty, Unicode and binary entries', () => {
    const archive = baueZip(files, { gespeichert: stored });
    const original = Buffer.from(archive);
    const cdSize = files.reduce((sum, file) => sum + 46 + Buffer.byteLength(file.name), 0);
    const pointer = zip.leseVerzeichnisZeiger(archive.subarray(-22), archive.length);
    assert.deepEqual(pointer, { cdOffset: archive.length - 22 - cdSize, cdGroesse: cdSize, anzahl: 3, zip64: false });
    const entries = zip.leseVerzeichnis(archive.subarray(pointer.cdOffset, pointer.cdOffset + pointer.cdGroesse), pointer.anzahl);
    assert.equal(entries.length, files.length);
    assert.deepEqual(entries.map(entry => entry.name), files.map(file => file.name));

    let expectedOffset = 0;
    for (let i = 0; i < files.length; i++) {
      const entry = entries[i];
      const expected = Buffer.from(files[i].inhalt);
      assert.equal(entry.methode, stored ? 0 : 8, 'compression method must match the fixture option');
      assert.equal(entry.uncompressedSize, expected.length, 'sizes count bytes, not characters');
      assert.equal(entry.lfhOffset, expectedOffset, 'entries retain their original local-header order');
      if (stored) assert.equal(entry.compressedSize, expected.length);
      else assert.ok(entry.compressedSize > 0, 'even empty deflate has an encoded stream');
      expectedOffset += 30 + Buffer.byteLength(files[i].name) + entry.compressedSize;
      const block = archive.subarray(entry.lfhOffset, expectedOffset);
      const actual = zip.entpackeEintrag(block, entry);
      assert.ok(Buffer.isBuffer(actual), 'roundtrip result is a Buffer for ' + entry.name);
      assert.equal(actual.length, expected.length, 'roundtrip length for ' + entry.name);
      assert.deepEqual(actual, expected, 'roundtrip bytes for ' + entry.name);
    }
    assert.equal(expectedOffset, pointer.cdOffset, 'the last payload ends at the central directory');
    assert.deepEqual(archive, original, 'reading an archive must preserve its bytes');
  });
}

console.log(`zip-stream.test.js: ${pass} ok, ${fail} fail`);
process.exitCode = fail ? 1 : 0;

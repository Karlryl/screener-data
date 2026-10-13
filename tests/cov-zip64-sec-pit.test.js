'use strict';
// ZIP64 byte layout, parser failures and isolated SEC ticker lookup; no network.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { spawnSync } = require('node:child_process');
const zip = require('../lib/zip-stream.js');
const secPit = require('../lib/sec-pit.js');
const { baueZip } = require('./helpers/zip-fixture.js');

let assertions = 0;
function same(actual, expected, message) {
  assert.deepStrictEqual(actual, expected, message);
  assertions++;
}
function throws(fn, pattern, message) {
  assert.throws(fn, pattern, message);
  assertions++;
}

// Calculate expected positions from input bytes, never from either ZIP parser.
function layout(files, foreign = false, comment = '') {
  let cdOffset = 0, cdGroesse = 0;
  const entries = files.map((file) => {
    const raw = Buffer.from(file.inhalt);
    const entry = {
      name: file.name,
      methode: file.gespeichert ? 0 : 8,
      compressedSize: file.gespeichert ? raw.length : zlib.deflateRawSync(raw).length,
      uncompressedSize: raw.length,
      lfhOffset: cdOffset,
    };
    cdOffset += 30 + Buffer.byteLength(file.name) + (file.zusatzLen || 0) + entry.compressedSize;
    cdGroesse += 46 + Buffer.byteLength(file.name) + 28 + (foreign ? 8 : 0)
      + (file.cdZusatzLen || 0) + Buffer.byteLength(file.cdKommentar || '');
    return entry;
  });
  const record = cdOffset + cdGroesse;
  return { entries, cdOffset, cdGroesse, record, locator: record + 56, eocd: record + 76,
    size: record + 76 + 22 + Buffer.byteLength(comment) };
}

function checkLayout(buf, files, foreign, comment) {
  const want = layout(files, foreign, comment);
  same(buf.length, want.size, 'ZIP64 record/locator lengths and EOCD comment');
  same(buf.readUInt32LE(want.eocd), 0x06054b50, 'EOCD signature');
  same(buf.readUInt16LE(want.eocd + 8), 0xffff, 'EOCD disk count sentinel');
  same(buf.readUInt16LE(want.eocd + 10), 0xffff, 'EOCD total count sentinel');
  same(buf.readUInt32LE(want.eocd + 12), 0xffffffff, 'EOCD CD-size sentinel');
  same(buf.readUInt32LE(want.eocd + 16), 0xffffffff, 'EOCD CD-offset sentinel');
  same(buf.readUInt32LE(want.record), 0x06064b50, 'ZIP64 EOCD signature');
  same(buf.readBigUInt64LE(want.record + 4), 44n, 'ZIP64 EOCD payload size');
  same(buf.readUInt16LE(want.record + 12), 45, 'ZIP64 creator version');
  same(buf.readUInt16LE(want.record + 14), 45, 'ZIP64 required version');
  same(buf.readUInt32LE(want.record + 16), 0, 'ZIP64 disk number');
  same(buf.readUInt32LE(want.record + 20), 0, 'ZIP64 CD disk');
  // sec-pit reads +24; zip-stream reads +32. Both must contain the real count.
  same(buf.readBigUInt64LE(want.record + 24), BigInt(files.length), 'ZIP64 entries on disk');
  same(buf.readBigUInt64LE(want.record + 32), BigInt(files.length), 'ZIP64 entries in total');
  same(buf.readBigUInt64LE(want.record + 40), BigInt(want.cdGroesse), 'ZIP64 CD size');
  same(buf.readBigUInt64LE(want.record + 48), BigInt(want.cdOffset), 'ZIP64 CD offset');
  same(buf.readUInt32LE(want.locator), 0x07064b50, 'locator immediately precedes EOCD');
  same(buf.readUInt32LE(want.locator + 4), 0, 'locator disk');
  same(buf.readBigUInt64LE(want.locator + 8), BigInt(want.record), 'locator record offset');
  same(buf.readUInt32LE(want.locator + 16), 1, 'single-disk archive');
  let cd = want.cdOffset;
  for (let i = 0; i < files.length; i++) {
    const file = files[i], entry = want.entries[i];
    const nameLen = Buffer.byteLength(file.name);
    let extra = cd + 46 + nameLen;
    same(buf.readUInt32LE(cd), 0x02014b50, 'CD signature: ' + file.name);
    same(buf.readUInt16LE(cd + 10), entry.methode, 'CD compression method');
    same(buf.readUInt32LE(cd + 20), 0xffffffff, 'CD compressed-size sentinel');
    same(buf.readUInt32LE(cd + 24), 0xffffffff, 'CD uncompressed-size sentinel');
    same(buf.readUInt32LE(cd + 42), 0xffffffff, 'CD local-offset sentinel');
    same(buf.readUInt16LE(cd + 30), 28 + (foreign ? 8 : 0) + (file.cdZusatzLen || 0), 'CD extra length');
    if (foreign) {
      same(buf.readUInt16LE(extra), 0x7075, 'foreign field precedes ZIP64');
      same(buf.readUInt16LE(extra + 2), 4, 'foreign payload length');
      extra += 8;
    }
    same(buf.readUInt16LE(extra), 1, 'ZIP64 extra-field ID');
    same(buf.readUInt16LE(extra + 2), 24, 'three u64 values');
    same(buf.readBigUInt64LE(extra + 4), BigInt(entry.uncompressedSize), 'uncompressed size first');
    same(buf.readBigUInt64LE(extra + 12), BigInt(entry.compressedSize), 'compressed size second');
    same(buf.readBigUInt64LE(extra + 20), BigInt(entry.lfhOffset), 'local offset third');
    cd += 46 + nameLen + 28 + (foreign ? 8 : 0)
      + (file.cdZusatzLen || 0) + Buffer.byteLength(file.cdKommentar || '');
  }
  same(cd, want.record, 'CD ends exactly at ZIP64 EOCD');
  return want;
}

function mutate(buf, offset, value, bytes = 4) {
  const result = Buffer.from(buf);
  if (bytes === 2) result.writeUInt16LE(value, offset);
  else result.writeUInt32LE(value, offset);
  return result;
}

const parentCache = process.env.SEC_XBRL_CACHE_DIR;
const tempRoot = fs.realpathSync(os.tmpdir());
const tmp = fs.mkdtempSync(path.join(tempRoot, 'cov-zip64-sec-pit-'));
function writeFixture(name, data) {
  const file = path.join(tmp, name);
  fs.writeFileSync(file, data);
  return file;
}
function withStore(file, fn) {
  const store = secPit.openStore(file);
  try { return fn(store); } finally { store.close(); }
}
function rejectsStore(name, buf, pattern) {
  const file = writeFixture(name, buf);
  throws(() => withStore(file, () => assert.fail('invalid archive opened')), pattern, name);
}

const started = process.hrtime.bigint();
try {
  const files = [
    { name: 'stored.txt', inhalt: 'stored payload', gespeichert: true, zusatzLen: 7, cdKommentar: 'stored' },
    { name: 'deflated.txt', inhalt: 'deflate payload '.repeat(24), gespeichert: false,
      zusatzLen: 17, cdZusatzLen: 5, cdKommentar: 'deflated' },
  ];
  for (const foreign of [false, true]) {
    const comment = 'zip64 archive comment';
    const buf = baueZip(files, { zip64: true, fremdesZusatzfeld: foreign, kommentar: comment });
    const want = checkLayout(buf, files, foreign, comment);
    same(zip.leseVerzeichnisZeiger(buf, buf.length), {
      zip64: true, anzahl: 2, cdOffset: want.cdOffset, cdGroesse: want.cdGroesse,
    }, 'ZIP64 pointer uses the real sizes, count and absolute offset');
    // A true suffix exercises conversion from the absolute locator to the tail offset.
    same(zip.leseVerzeichnisZeiger(buf.subarray(want.record), buf.length), {
      zip64: true, anzahl: 2, cdOffset: want.cdOffset, cdGroesse: want.cdGroesse,
    }, 'ZIP64 pointer also accepts a nonzero tail origin');
    const entries = zip.leseVerzeichnis(buf.subarray(want.cdOffset, want.record), 2);
    same(entries, want.entries, 'ZIP64 extra fields supply both sizes and local offsets');
    for (let i = 0; i < entries.length; i++) {
      same(zip.entpackeEintrag(buf.subarray(entries[i].lfhOffset), entries[i]),
        Buffer.from(files[i].inhalt), 'mixed store/deflate roundtrip: ' + files[i].name);
    }
    withStore(writeFixture('mixed-' + foreign + '.zip', buf), (store) => {
      same(store.entryCount, 2, 'SEC reader indexes both ZIP64 entries');
      for (const file of files) same(store.readEntryByName(file.name), Buffer.from(file.inhalt), 'SEC mixed roundtrip');
    });
  }

  // Seeded random-looking bytes make the missing-EOCD case reproducible.
  let seed = 0x13579bdf;
  const junk = Buffer.from(Array.from({ length: 200 }, () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed >>> 24;
  }));
  throws(() => zip.leseVerzeichnisZeiger(junk, junk.length), /kein End-of-Central-Directory/, 'missing EOCD');
  const plain = baueZip(files, { zip64: true });
  const plainLayout = layout(files);
  throws(() => zip.leseVerzeichnisZeiger(mutate(plain, plainLayout.locator, 0), plain.length), /kein Locator/, 'bad locator');
  throws(() => zip.leseVerzeichnisZeiger(plain.subarray(-42), plain.length), /ausserhalb des gelesenen Schwanzes/, 'record outside tail');
  throws(() => zip.leseVerzeichnisZeiger(mutate(plain, plainLayout.record, 0), plain.length), /ZIP64-Signatur falsch/, 'bad ZIP64 record');

  const q1 = { start: '2025-01-01', end: '2025-03-31', val: 100, filed: '2025-05-01', form: '10-Q', fy: 2025, fp: 'Q1' };
  const q2 = { start: '2025-04-01', end: '2025-06-30', val: 130, filed: '2025-08-01', form: '10-Q', fy: 2025, fp: 'Q2' };
  const company = { cik: 1234567, entityName: 'Testcorp', facts: { 'us-gaap': {
    Revenues: { units: { USD: [q2] } },
    SalesRevenueNet: { units: { USD: [q1, q2] } },
  } } };
  const companyFiles = [{ name: 'CIK0001234567.json', inhalt: JSON.stringify(company) }];
  const companyZip = baueZip(companyFiles, { zip64: true });
  const companyLayout = layout(companyFiles);
  const companyPath = writeFixture('companyfacts.zip', companyZip);
  for (const foreign of [false, true]) {
    const buf = baueZip(companyFiles, { zip64: true, fremdesZusatzfeld: foreign });
    withStore(writeFixture('company-' + foreign + '.zip', buf), (store) => {
      same(store.entryCount, 1, 'one company in ZIP64 store');
      same(store.entryNames(), ['CIK0001234567.json'], 'company entry name');
      same(store.factsForCik(1234567), company, 'companyfacts parsed from ZIP64');
    });
  }
  rejectsStore('no-eocd.zip', Buffer.alloc(4096), /EOCD signature not found/);
  rejectsStore('bad-locator.zip', mutate(companyZip, companyLayout.locator, 0), /ZIP64 locator not found/);
  rejectsStore('bad-record.zip', mutate(companyZip, companyLayout.record, 0), /ZIP64 EOCD not found/);
  const method9 = mutate(mutate(companyZip, companyLayout.cdOffset + 10, 9, 2), 8, 9, 2);
  same(method9.readUInt16LE(companyLayout.cdOffset + 10), 9, 'mutated CD method');
  same(method9.readUInt16LE(8), 9, 'mutated local method');
  withStore(writeFixture('unsupported.zip', method9), (store) => {
    throws(() => store.readEntryByName('CIK0001234567.json'), /Unsupported compression method: 9/, 'SEC method failure');
  });

  writeFixture('company_tickers.json', JSON.stringify({
    0: { cik_str: 1234567, ticker: 'TST', title: 'Testcorp' },
  }));
  // CACHE_DIR is captured at module load: set it only inside this fresh child.
  const child = spawnSync(process.execPath, ['-e', `
    process.env.SEC_XBRL_CACHE_DIR = process.argv[1];
    const secPit = require(process.argv[2]);
    const store = secPit.openStore(process.argv[3]);
    try {
      process.stdout.write(JSON.stringify({
        cache: secPit.CACHE_DIR,
        index: secPit.TICKER_INDEX_PATH,
        cik: store.cikForTicker('tst'),
        missingCik: store.cikForTicker('NOPE'),
        facts: store.factsForTicker('TST'),
        missingFacts: store.factsForTicker('NOPE'),
      }));
    } finally { store.close(); }
  `, tmp, require.resolve('../lib/sec-pit.js'), companyPath], {
    cwd: tmp, env: { ...process.env }, encoding: 'utf8', timeout: 3000, windowsHide: true,
  });
  same(child.error, undefined, 'ticker child completed before timeout');
  same(child.status, 0, 'ticker child exit: ' + child.stderr);
  same(child.stderr, '', 'ticker child has no unexpected diagnostics');
  const result = JSON.parse(child.stdout);
  same(result.cache, tmp, 'ticker cache is the private temp directory');
  same(result.index, path.join(tmp, 'company_tickers.json'), 'ticker index is isolated');
  same(result.cik, 1234567, 'case-insensitive ticker lookup');
  same(result.missingCik, null, 'unknown ticker has no CIK');
  same(result.facts, company, 'ticker lookup returns the complete companyfacts object');
  same(result.missingFacts, null, 'unknown ticker has no facts');
  same(process.env.SEC_XBRL_CACHE_DIR, parentCache, 'parent cache environment is unchanged');
  throws(() => secPit.loadTickerMap(path.join(tmp, 'fehlt.json')), /company_tickers.json fehlt/, 'missing index');
  throws(() => secPit.loadTickerMap(writeFixture('empty-tickers.json', '{}')), /leer\/unerwartetes Format/, 'empty index');
  throws(() => secPit.openStore(path.join(tmp, 'missing.zip')), /companyfacts.zip fehlt/, 'missing archive');

  const concepts = ['Revenues', 'SalesRevenueNet'];
  const best = secPit.pitQuarterlyWithDerivedQ4(company, concepts, { asOf: '2025-09-01' });
  same(best.concept, 'SalesRevenueNet', 'equal newest end: longer second concept wins');
  same(best.series.map((point) => [point.end, point.val]), [['2025-06-30', 130], ['2025-03-31', 100]], 'winning series remains newest first');
  same(secPit.pitQuarterlyWithDerivedQ4(company, concepts.slice().reverse()).concept,
    'SalesRevenueNet', 'longer series wins in either concept order');
  const equalLength = { facts: { 'us-gaap': {
    Revenues: company.facts['us-gaap'].Revenues,
    SalesRevenueNet: company.facts['us-gaap'].Revenues,
  } } };
  same(secPit.pitQuarterlyWithDerivedQ4(equalLength, concepts).concept, 'Revenues', 'exact tie preserves first concept');
} finally {
  if (path.dirname(tmp) !== tempRoot || !path.basename(tmp).startsWith('cov-zip64-sec-pit-')) {
    throw new Error('Unsafe ZIP64 fixture cleanup path');
  }
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log('cov-zip64-sec-pit.test.js: ' + assertions + ' assertions passed in '
  + (Number(process.hrtime.bigint() - started) / 1e6).toFixed(1) + ' ms');

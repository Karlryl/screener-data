'use strict';
/**
 * HKEX discovery adapter - hermetic contract tests.
 *
 * No live request is made by default. Set HKEX_LIVE_TEST=1 for the retained
 * endpoint smoke check; the deterministic suite remains the release oracle.
 */
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');
const https = require('https');
const zlib = require('node:zlib');

const ADAPTER_PATH = require.resolve('../../discovery/hkex-hk.js');
const ENDPOINT = 'https://www.hkex.com.hk/eng/services/trading/securities/securitieslists/ListOfSecurities.xlsx';
const originalHttpsGet = https.get;
let importCalls = 0;

https.get = () => {
  importCalls++;
  throw new Error('unexpected live HKEX transport');
};
delete require.cache[ADAPTER_PATH];
const { fetchHkexUniverse, parseSheet } = require(ADAPTER_PATH);

test.after(() => {
  https.get = originalHttpsGet;
  delete require.cache[ADAPTER_PATH];
});

function row(n, code, name, category, isin = '') {
  return '<x:row r="' + n + '">' +
    '<x:c r="A' + n + '" t="str"><x:v>' + code + '</x:v></x:c>' +
    '<x:c r="B' + n + '" t="str"><x:v>' + name + '</x:v></x:c>' +
    '<x:c r="C' + n + '" t="str"><x:v>' + category + '</x:v></x:c>' +
    '<x:c r="F' + n + '" t="str"><x:v>' + isin + '</x:v></x:c>' +
    '</x:row>';
}

const HEALTHY_SHEET = [
  row(2, '700', 'TENCENT &amp; HOLDINGS', 'Equity', 'KYG875721634'),
  row(3, '9988', 'ALIBABA GROUP', 'Equity', 'KYG017191142'),
  row(4, '89988', 'RMB COUNTER', 'Equity'),
  row(5, '823', 'LINK REIT', 'REIT', 'HK0823032773'),
  row(6, '700', 'DUPLICATE', 'Equity', 'KYG875721634')
].join('');

function zipSignatureOnly() {
  return Buffer.from([0x50, 0x4b, 0x03, 0x04]);
}

function deflatedZipEntry(name, body) {
  const nameBytes = Buffer.from(name, 'utf8');
  const bodyBytes = Buffer.from(body, 'utf8');
  const compressed = zlib.deflateRawSync(bodyBytes);
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0, 6);
  header.writeUInt16LE(8, 8);
  header.writeUInt32LE(compressed.length, 18);
  header.writeUInt32LE(bodyBytes.length, 22);
  header.writeUInt16LE(nameBytes.length, 26);
  header.writeUInt16LE(0, 28);
  return Buffer.concat([header, nameBytes, compressed]);
}

function assertHealthy(map, expectedSize = 2) {
  assert.ok(map instanceof Map, 'returns a Map');
  assert.equal(map.size, expectedSize);
  assert.equal(Object.hasOwn(map, 'partial'), false, 'healthy result has no partial marker');
}

function assertPartial(map) {
  assert.ok(map instanceof Map, 'failure still returns a Map');
  assert.equal(map.size, 0, 'failure does not leak a parsed prefix');
  assert.equal(Object.hasOwn(map, 'partial'), true, 'failure owns its marker');
  assert.equal(map.partial, true);
}

async function muted(run) {
  const oldLog = console.log;
  const oldError = console.error;
  console.log = () => {};
  console.error = () => {};
  try {
    return await run();
  } finally {
    console.log = oldLog;
    console.error = oldError;
  }
}

test('module import is side-effect free', () => {
  assert.equal(importCalls, 0);
});

test('parseSheet maps equities and preserves filtering/deduplication', () => {
  const parsed = parseSheet(HEALTHY_SHEET);
  assertHealthy(parsed);
  assert.deepEqual(parsed.get('0700.HK'), {
    ticker: '0700.HK',
    name: 'TENCENT & HOLDINGS',
    exchange: 'HKEX',
    source: 'hkex',
    country: 'Hong Kong',
    isin: 'KYG875721634'
  });
  assert.equal(parsed.get('9988.HK').name, 'ALIBABA GROUP');
  assert.equal(parsed.has('89988.HK'), false, 'five-digit RMB counter is dropped');
  assert.equal(parsed.has('0823.HK'), false, 'non-equity category is dropped');
});

test('malformed numeric prefixes cannot steal a valid ticker during dedupe', () => {
  const parsed = parseSheet([
    row(2, '700junk', 'WRONG SUFFIX', 'Equity'),
    row(3, '700.5', 'WRONG DECIMAL', 'Equity'),
    row(4, '7e2', 'WRONG EXPONENT', 'Equity'),
    row(5, '700', 'RIGHT TENCENT', 'Equity', 'KYG875721634')
  ].join(''));
  assert.equal(parsed.size, 1);
  assert.equal(parsed.get('0700.HK').name, 'RIGHT TENCENT');
  assert.equal(parsed.get('0700.HK').isin, 'KYG875721634');
});

test('parseSheet rejects a structurally missing row stream', () => {
  assert.throws(() => parseSheet('<x:worksheet><x:sheetData/></x:worksheet>'), /row/i);
});

test('injected healthy fetch uses the exact endpoint once', async () => {
  let getCalls = 0;
  let extractCalls = 0;
  const map = await muted(() => fetchHkexUniverse({
    getBufferFn: async url => {
      getCalls++;
      assert.equal(url, ENDPOINT);
      return zipSignatureOnly();
    },
    extractZipEntryFn: (buffer, name) => {
      extractCalls++;
      assert.equal(buffer.readUInt32LE(0), 0x04034b50);
      assert.equal(name, 'xl/worksheets/sheet1.xml');
      return Buffer.from(HEALTHY_SHEET);
    }
  }));
  assertHealthy(map);
  assert.equal(getCalls, 1);
  assert.equal(extractCalls, 1);
  assert.equal(importCalls, 0, 'injection never reaches the default transport');
});

test('structurally valid zero-equity sheet stays healthy without a count floor', async () => {
  const nonEquitySheet = row(2, '823', 'LINK REIT', 'REIT', 'HK0823032773');
  const map = await muted(() => fetchHkexUniverse({
    getBufferFn: async () => zipSignatureOnly(),
    extractZipEntryFn: () => Buffer.from(nonEquitySheet)
  }));
  assertHealthy(map, 0);
});

test('transport rejection is an observable total-source failure', async () => {
  const map = await muted(() => fetchHkexUniverse({
    getBufferFn: async () => { throw new Error('offline'); }
  }));
  assertPartial(map);
});

test('non-XLSX payload is partial and never reaches extraction', async () => {
  let extractCalls = 0;
  const map = await muted(() => fetchHkexUniverse({
    getBufferFn: async () => Buffer.from('<html>blocked</html>'),
    extractZipEntryFn: () => { extractCalls++; return Buffer.from(HEALTHY_SHEET); }
  }));
  assertPartial(map);
  assert.equal(extractCalls, 0);
});

test('missing worksheet is an observable total-source failure', async () => {
  const map = await muted(() => fetchHkexUniverse({
    getBufferFn: async () => zipSignatureOnly(),
    extractZipEntryFn: () => null
  }));
  assertPartial(map);
});

test('malformed worksheet and extractor errors fail all-or-nothing', async t => {
  await t.test('structurally malformed worksheet', async () => {
    const map = await muted(() => fetchHkexUniverse({
      getBufferFn: async () => zipSignatureOnly(),
      extractZipEntryFn: () => Buffer.from('<x:worksheet/>')
    }));
    assertPartial(map);
  });
  await t.test('row stream without required A/B/C columns', async () => {
    const malformedRows = [
      ['missing C', '<x:c r="A2" t="str"><x:v>700</x:v></x:c><x:c r="B2" t="str"><x:v>TENCENT</x:v></x:c>'],
      ['missing B', '<x:c r="A2" t="str"><x:v>700</x:v></x:c><x:c r="C2" t="str"><x:v>Equity</x:v></x:c>'],
      ['missing A', '<x:c r="B2" t="str"><x:v>TENCENT</x:v></x:c><x:c r="C2" t="str"><x:v>Equity</x:v></x:c>'],
      ['unrelated D only', '<x:c r="D2" t="str"><x:v>Equity</x:v></x:c>']
    ];
    for (const [label, cells] of malformedRows) {
      const wrongColumns = '<x:row r="2">' + cells + '</x:row>';
      const map = await muted(() => fetchHkexUniverse({
        getBufferFn: async () => zipSignatureOnly(),
        extractZipEntryFn: () => Buffer.from(wrongColumns)
      }));
      assert.equal(Object.hasOwn(map, 'partial'), true, label);
      assertPartial(map);
    }
  });
  await t.test('extractor exception', async () => {
    const map = await muted(() => fetchHkexUniverse({
      getBufferFn: async () => zipSignatureOnly(),
      extractZipEntryFn: () => { throw new Error('bad deflate stream'); }
    }));
    assertPartial(map);
  });
});

test('no-argument path keeps the real transport and ZIP parser wired', async () => {
  const zip = deflatedZipEntry('xl/worksheets/sheet1.xml', HEALTHY_SHEET);
  let calls = 0;
  const bomb = https.get;
  https.get = (url, options, callback) => {
    calls++;
    assert.equal(url, ENDPOINT);
    assert.equal(options.headers.Referer, 'https://www.hkex.com.hk/');
    assert.match(options.headers['User-Agent'], /screener-data/);
    const req = new EventEmitter();
    req.setTimeout = () => req;
    req.destroy = () => {};
    queueMicrotask(() => {
      const res = new EventEmitter();
      res.statusCode = 200;
      res.headers = {};
      callback(res);
      queueMicrotask(() => {
        res.emit('data', zip);
        res.emit('end');
      });
    });
    return req;
  };
  try {
    const map = await muted(() => fetchHkexUniverse());
    assertHealthy(map);
    assert.equal(calls, 1);
  } finally {
    https.get = bomb;
  }
});

test('no-argument HTTP failure reaches the partial marker through real transport', async () => {
  let calls = 0;
  let resumeCalls = 0;
  const bomb = https.get;
  https.get = (url, options, callback) => {
    calls++;
    assert.equal(url, ENDPOINT);
    const req = new EventEmitter();
    req.setTimeout = () => req;
    req.destroy = () => {};
    queueMicrotask(() => {
      const res = new EventEmitter();
      res.statusCode = 503;
      res.headers = {};
      res.resume = () => { resumeCalls++; };
      callback(res);
    });
    return req;
  };
  try {
    const map = await muted(() => fetchHkexUniverse());
    assertPartial(map);
    assert.equal(calls, 1);
    assert.equal(resumeCalls, 1);
  } finally {
    https.get = bomb;
  }
});

if (process.env.HKEX_LIVE_TEST === '1') {
  test('optional live endpoint smoke', async () => {
    https.get = originalHttpsGet;
    try {
      const map = await fetchHkexUniverse();
      assertHealthy(map, map.size);
      assert.ok(map.size > 1000, `rowCount>1000 (got ${map.size})`);
      assert.ok(map.has('0700.HK'), 'Tencent 0700.HK present');
      assert.ok(map.has('9988.HK'), 'Alibaba 9988.HK present');
    } finally {
      https.get = () => { throw new Error('unexpected live HKEX transport'); };
    }
  });
}

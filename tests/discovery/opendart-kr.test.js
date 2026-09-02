'use strict';
/**
 * opendart-kr discovery adapter test.
 *
 * Three layers:
 *  1. OFFLINE (always runs, no key/network): builds a real single-entry ZIP
 *     with zlib.deflateRawSync and drives unzipFirstEntry + parseCorpCodeXml.
 *     Asserts: listed rows kept, unlisted (empty stock_code) dropped, suffix
 *     form is <6-digit>.KS, suffixUnsure flag + KRX/South Korea metadata.
 *  2. ADAPTER STATES (always runs, injected buffers/no network): distinguishes
 *     an intentional no-key skip and valid ZIPs from transport, ZIP and XML
 *     failures, which must return a Map marked as partial.
 *  3. LIVE (only when OPENDART_KEY set): real fetch, asserts rowCount>0 and
 *     every yahooTicker matches /^\d{6}\.KS$/. Skipped cleanly without a key.
 *
 * Usage:  node tests/discovery/opendart-kr.test.js   (Exit 0/1)
 */
const assert = require('node:assert/strict');
const https = require('https');
const zlib = require('zlib');
const { fetchOpenDartKr, unzipFirstEntry, parseCorpCodeXml } = require('../../discovery/opendart-kr.js');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); }
}

async function asyncTest(name, fn) {
  try { await fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); }
}

function hasOwnPartial(value) {
  return Object.prototype.hasOwnProperty.call(value, 'partial');
}

// --- Build a real ZIP (local file header + DEFLATE entry) around the XML ---
function makeZip(xml) {
  const name = Buffer.from('CORPCODE.xml');
  const raw = Buffer.from(xml, 'utf8');
  const comp = zlib.deflateRawSync(raw);
  const h = Buffer.alloc(30);
  h.writeUInt32LE(0x04034b50, 0);   // local file header signature
  h.writeUInt16LE(20, 4);           // version needed
  h.writeUInt16LE(0, 6);            // flags
  h.writeUInt16LE(8, 8);            // method = DEFLATE
  h.writeUInt32LE(0, 10);           // mod time/date
  h.writeUInt32LE(0, 14);           // crc32 (unchecked by our reader)
  h.writeUInt32LE(comp.length, 18); // compressed size
  h.writeUInt32LE(raw.length, 22);  // uncompressed size
  h.writeUInt16LE(name.length, 26); // name length
  h.writeUInt16LE(0, 28);           // extra length
  return Buffer.concat([h, name, comp]);
}

const SAMPLE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<result>
  <list><corp_code>00126380</corp_code><corp_name>삼성전자</corp_name><stock_code>005930</stock_code><modify_date>20240101</modify_date></list>
  <list><corp_code>00164779</corp_code><corp_name>SK하이닉스</corp_name><stock_code>000660</stock_code><modify_date>20240101</modify_date></list>
  <list><corp_code>01234567</corp_code><corp_name>Unlisted Filer Co</corp_name><stock_code> </stock_code><modify_date>20240101</modify_date></list>
  <list><corp_code>00999999</corp_code><corp_name><![CDATA[에코프로비엠]]></corp_name><stock_code>247540</stock_code><modify_date>20240101</modify_date></list>
</result>`;

// --- OFFLINE ---
test('unzipFirstEntry inflates a DEFLATE single-entry ZIP', () => {
  const xml = unzipFirstEntry(makeZip(SAMPLE_XML)).toString('utf8');
  assert.match(xml, /삼성전자/);
});

test('unzipFirstEntry on non-ZIP surfaces the OpenDART status envelope', () => {
  const err = Buffer.from('<result><status>020</status><message>usage limit</message></result>');
  assert.throws(() => unzipFirstEntry(err), /not a ZIP.*020/);
});

test('parseCorpCodeXml keeps only 6-digit stock_code rows', () => {
  const m = parseCorpCodeXml(SAMPLE_XML);
  assert.equal(m.size, 3, 'unlisted (empty stock_code) row must be dropped');
});

test('suffix form is <6-digit>.KS and flagged unsure', () => {
  const m = parseCorpCodeXml(SAMPLE_XML);
  for (const [t, info] of m) {
    assert.match(t, /^\d{6}\.KS$/, 'bad suffix form: ' + t);
    assert.equal(info.ticker, t);
    assert.equal(info.exchange, 'KRX');
    assert.equal(info.country, 'South Korea');
    assert.equal(info.source, 'opendart');
    assert.equal(info.suffixUnsure, true);
  }
  assert.ok(m.has('005930.KS'), 'Samsung 005930.KS expected');
  assert.equal(m.get('005930.KS').name, '삼성전자');
  assert.equal(m.get('005930.KS').corpCode, '00126380');
});

// --- LIVE (opt-in via key) — asserted in the async block below ---
if (!process.env.OPENDART_KEY) {
  console.log('  skip LIVE fetch (OPENDART_KEY not set)');
}

(async () => {
  // Inject every keyed response so these state-contract tests never use the
  // network, even when the surrounding process has OPENDART_KEY configured.
  const originalHttpsGet = https.get;
  let blockedHttpsRequests = 0;
  try {
    https.get = () => {
      blockedHttpsRequests++;
      throw new Error('unexpected live network request');
    };

  await asyncTest('fetchOpenDartKr skips without a key and stays unmarked', async () => {
    let requests = 0;
    const m = await fetchOpenDartKr({
      key: '',
      getBufferFn: async () => {
        requests++;
        throw new Error('no-key request must not happen');
      }
    });
    assert.equal(requests, 0);
    assert.equal(m.size, 0);
    assert.equal(hasOwnPartial(m), false);
    assert.equal(m.partial, undefined);
  });

  await asyncTest('fetchOpenDartKr keeps a valid ZIP healthy and populated', async () => {
    let requests = 0;
    const m = await fetchOpenDartKr({
      key: 'fixture-key',
      getBufferFn: async url => {
        requests++;
        assert.match(url, /crtfc_key=fixture-key$/);
        return makeZip(SAMPLE_XML);
      }
    });
    assert.equal(requests, 1);
    assert.equal(m.size, 3);
    assert.equal(hasOwnPartial(m), false);
    assert.equal(m.partial, undefined);
  });

  await asyncTest('fetchOpenDartKr accepts exactly one listed stock', async () => {
    let requests = 0;
    const xml = '<result><list><corp_code>00000001</corp_code>' +
      '<corp_name>One Listed Co</corp_name><stock_code>000001</stock_code></list></result>';
    const m = await fetchOpenDartKr({
      key: 'fixture-key',
      getBufferFn: async () => { requests++; return makeZip(xml); }
    });
    assert.equal(requests, 1);
    assert.equal(m.size, 1);
    assert.equal(m.has('000001.KS'), true);
    assert.equal(hasOwnPartial(m), false);
    assert.equal(m.partial, undefined);
  });

  await asyncTest('fetchOpenDartKr reads the production key when none is injected', async () => {
    const hadKey = Object.prototype.hasOwnProperty.call(process.env, 'OPENDART_KEY');
    const previousKey = process.env.OPENDART_KEY;
    let requests = 0;
    try {
      process.env.OPENDART_KEY = 'env fixture/key';
      const m = await fetchOpenDartKr({
        getBufferFn: async url => {
          requests++;
          assert.match(url, /crtfc_key=env%20fixture%2Fkey$/);
          return makeZip(SAMPLE_XML);
        }
      });
      assert.equal(requests, 1);
      assert.equal(m.size, 3);
      assert.equal(hasOwnPartial(m), false);
      assert.equal(m.partial, undefined);
    } finally {
      if (hadKey) process.env.OPENDART_KEY = previousKey;
      else delete process.env.OPENDART_KEY;
    }
  });

  await asyncTest('fetchOpenDartKr keeps the production transport wired by default', async () => {
    const hadKey = Object.prototype.hasOwnProperty.call(process.env, 'OPENDART_KEY');
    const previousKey = process.env.OPENDART_KEY;
    const requestsBefore = blockedHttpsRequests;
    try {
      process.env.OPENDART_KEY = 'default-transport-key';
      const m = await fetchOpenDartKr();
      assert.equal(blockedHttpsRequests, requestsBefore + 1);
      assert.equal(m.size, 0);
      assert.equal(hasOwnPartial(m), true);
      assert.equal(m.partial, true);
    } finally {
      if (hadKey) process.env.OPENDART_KEY = previousKey;
      else delete process.env.OPENDART_KEY;
    }
  });

  await asyncTest('fetchOpenDartKr marks a transport failure partial', async () => {
    const m = await fetchOpenDartKr({
      key: 'fixture-key',
      getBufferFn: async () => { throw new Error('ECONNRESET'); }
    });
    assert.equal(m.size, 0);
    assert.equal(hasOwnPartial(m), true);
    assert.equal(m.partial, true);
  });

  await asyncTest('fetchOpenDartKr marks status 020 XML partial', async () => {
    const envelope = Buffer.from(
      '<result><status>020</status><message>usage limit</message></result>'
    );
    const m = await fetchOpenDartKr({
      key: 'fixture-key',
      getBufferFn: async () => envelope
    });
    assert.equal(m.size, 0);
    assert.equal(hasOwnPartial(m), true);
    assert.equal(m.partial, true);
  });

  await asyncTest('fetchOpenDartKr marks an unsupported ZIP method partial', async () => {
    const zip = makeZip(SAMPLE_XML);
    zip.writeUInt16LE(99, 8);
    const m = await fetchOpenDartKr({
      key: 'fixture-key',
      getBufferFn: async () => zip
    });
    assert.equal(m.size, 0);
    assert.equal(hasOwnPartial(m), true);
    assert.equal(m.partial, true);
  });

  await asyncTest('fetchOpenDartKr marks a ZIP without list records partial', async () => {
    const m = await fetchOpenDartKr({
      key: 'fixture-key',
      getBufferFn: async () => makeZip('<result><unexpected/></result>')
    });
    assert.equal(m.size, 0);
    assert.equal(hasOwnPartial(m), true);
    assert.equal(m.partial, true);
  });

  await asyncTest('fetchOpenDartKr marks an all-unlisted full register partial', async () => {
    let requests = 0;
    const xml = '<result><list><corp_code>00000001</corp_code>' +
      '<corp_name>Private Co</corp_name><stock_code> </stock_code></list></result>';
    const m = await fetchOpenDartKr({
      key: 'fixture-key',
      getBufferFn: async () => { requests++; return makeZip(xml); }
    });
    assert.equal(requests, 1);
    assert.equal(m.size, 0);
    assert.equal(hasOwnPartial(m), true);
    assert.equal(m.partial, true);
  });

  } finally {
    https.get = originalHttpsGet;
  }

  // Run the real network assertion outside the sync harness when key present.
  if (process.env.OPENDART_KEY) {
    try {
      const m = await fetchOpenDartKr();
      assert.ok(m.size > 0, 'LIVE rowCount must be > 0');
      for (const t of m.keys()) assert.match(t, /^\d{6}\.KS$/, 'LIVE bad suffix: ' + t);
      console.log('  ok   LIVE fetch: ' + m.size + ' rows, all <6-digit>.KS');
      pass++;
    } catch (e) {
      console.error('FAIL   LIVE fetch\n       ' + (e && e.message ? e.message : e));
      fail++;
    }
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();

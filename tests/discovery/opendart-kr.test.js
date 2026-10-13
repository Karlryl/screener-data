'use strict';
/**
 * opendart-kr discovery adapter test.
 *
 * Two layers:
 *  1. OFFLINE (always runs, no key/network): builds a real single-entry ZIP
 *     with zlib.deflateRawSync and drives unzipFirstEntry + parseCorpCodeXml.
 *     Asserts: listed rows kept, unlisted (empty stock_code) dropped, suffix
 *     form is <6-digit>.KS, suffixUnsure flag + KRX/South Korea metadata.
 *  2. LIVE (only when OPENDART_KEY set): real fetch, asserts rowCount>0 and
 *     every yahooTicker matches /^\d{6}\.KS$/. Skipped cleanly without a key.
 *
 * Usage:  node tests/discovery/opendart-kr.test.js   (Exit 0/1)
 */
const assert = require('node:assert/strict');
const zlib = require('zlib');
const { fetchOpenDartKr, unzipFirstEntry, parseCorpCodeXml } = require('../../discovery/opendart-kr.js');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); }
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

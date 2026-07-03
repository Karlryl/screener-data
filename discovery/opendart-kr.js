#!/usr/bin/env node
/**
 * OpenDART (KR) Universe Discovery — South Korea via corpCode.xml
 * ==============================================================
 * Source: https://opendart.fss.or.kr/api/corpCode.xml?crtfc_key=KEY
 *   → returns a ZIP (application/x-msdownload) containing a single
 *     CORPCODE.xml with one <list> block per registered corporation.
 * Requires OPENDART_KEY env var — silently returns an empty Map if unset
 * (fail-silent, mirrors finnhub.js).
 *
 * Only entries with a non-empty <stock_code> (6-digit) are exchange-listed;
 * the rest are unlisted filers (private/dissolved) and are skipped.
 *
 * KOSPI (.KS) vs KOSDAQ (.KQ) problem
 * -----------------------------------
 * corpCode.xml carries NO market segment. There is no second FREE OpenDART
 * field and no built-in-only KRX list that reliably maps stock_code → market
 * without a fragile OTP-token scrape. Per the discovery contract we do NOT
 * blindly emit both .KS and .KQ (that doubles the universe with 50% noise).
 * Instead we emit .KS as the default suffix and flag every row
 * `suffixUnsure: true`, so the downstream Yahoo pull can drop the clean 404
 * (and retry .KQ) rather than trusting a guessed suffix as signal.
 *
 * Only Node built-ins: https, zlib, Buffer. No ZIP/XML npm dependency.
 * Returns Map<yahooTicker, {ticker,name,exchange,source,country,corpCode,suffixUnsure}>
 */
'use strict';
const https = require('https');
const zlib = require('zlib');

const CORPCODE_URL = 'https://opendart.fss.or.kr/api/corpCode.xml?crtfc_key=';

// Mirror the sibling adapters' hardened redirect+timeout GET, but resolve to a
// Buffer (the payload is a binary ZIP, not text).
const MAX_REDIRECTS = 5;
function getBuffer(url, redirectsLeft = MAX_REDIRECTS) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'screener-data/1.0 (github.com/Karlryl/screener-data)',
        // OpenDART's WAF returns HTML/403 to header-less clients; a Referer to
        // its own host is the reliable unblock (contract note).
        'Referer': 'https://opendart.fss.or.kr/',
        'Accept': '*/*'
      }
    }, res => {
      if (res.statusCode === 301 || res.statusCode === 302 ||
          res.statusCode === 307 || res.statusCode === 308) {
        res.resume(); // drain before following redirect
        const loc = res.headers.location;
        if (!loc) return reject(new Error('HTTP ' + res.statusCode + ' without Location header'));
        if (redirectsLeft <= 0) return reject(new Error('too many redirects'));
        let nextUrl;
        try { nextUrl = new URL(loc, url).toString(); }
        catch (e) { return reject(new Error('invalid redirect Location: ' + loc)); }
        return getBuffer(nextUrl, redirectsLeft - 1).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        res.resume(); // drain non-200 body to free the socket
        return reject(new Error('HTTP ' + res.statusCode));
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

/**
 * Extract the first file from a ZIP archive using only zlib.
 * OpenDART returns a single-entry ZIP (CORPCODE.xml, DEFLATE = method 8, or
 * STORED = method 0). We read the local file header at offset 0 rather than
 * the central directory — the archive has exactly one member.
 * Local file header layout (little-endian):
 *   0  sig 0x04034b50 | 8 method | 18 compSize | 22 uncompSize | 26 nameLen | 28 extraLen | 30 name...
 */
function unzipFirstEntry(buf) {
  if (buf.length < 30 || buf.readUInt32LE(0) !== 0x04034b50) {
    // Not a ZIP — OpenDART sends a plain-XML error envelope (e.g. bad key) as
    // <result><status>...</status></result>. Surface it so the caller logs it.
    const head = buf.slice(0, 400).toString('utf8');
    const status = /<status>([^<]*)<\/status>/.exec(head);
    const message = /<message>([^<]*)<\/message>/.exec(head);
    throw new Error('not a ZIP' + (status ? ' — status ' + status[1] +
      (message ? ' (' + message[1].trim() + ')' : '') : ''));
  }
  const method = buf.readUInt16LE(8);
  const compSize = buf.readUInt32LE(18);
  const nameLen = buf.readUInt16LE(26);
  const extraLen = buf.readUInt16LE(28);
  const dataStart = 30 + nameLen + extraLen;
  // ponytail: single-entry ZIP only; if OpenDART ever multi-files this, read
  // the central directory instead. Data-descriptor case (compSize==0) falls
  // back to slicing to the next signature.
  let comp;
  if (compSize > 0) {
    comp = buf.slice(dataStart, dataStart + compSize);
  } else {
    // streamed entry: no size in header — take everything up to the central dir.
    const cdIdx = buf.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]), dataStart);
    comp = buf.slice(dataStart, cdIdx > 0 ? cdIdx : undefined);
  }
  if (method === 0) return comp;                    // STORED
  if (method === 8) return zlib.inflateRawSync(comp); // DEFLATE
  throw new Error('unsupported ZIP method ' + method);
}

// One <list>…</list> block per corp. Fields we need: corp_code, corp_name,
// stock_code. Values are plain text (occasionally CDATA-wrapped). We parse with
// a scoped regex per block rather than a full XML lib (built-ins only).
const LIST_RE = /<list>([\s\S]*?)<\/list>/g;
function field(block, tag) {
  const m = new RegExp('<' + tag + '>\\s*(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?\\s*<\\/' + tag + '>').exec(block);
  return m ? m[1].trim() : '';
}

function parseCorpCodeXml(xml) {
  const result = new Map();
  let m;
  while ((m = LIST_RE.exec(xml)) !== null) {
    const block = m[1];
    const stockCode = field(block, 'stock_code');
    // Unlisted filers carry an empty stock_code (OpenDART emits a single space);
    // only 6-digit codes are exchange-listed.
    if (!/^\d{6}$/.test(stockCode)) continue;
    const name = field(block, 'corp_name');
    const corpCode = field(block, 'corp_code');
    // Default suffix .KS (KOSPI); flagged unsure because corpCode.xml has no
    // KOSPI/KOSDAQ segment. Downstream Yahoo pull drops the 404 / retries .KQ.
    const yahooTicker = stockCode + '.KS';
    result.set(yahooTicker, {
      ticker: yahooTicker,
      name,
      exchange: 'KRX',
      source: 'opendart',
      country: 'South Korea',
      corpCode: corpCode || null,
      suffixUnsure: true
    });
  }
  return result;
}

async function fetchOpenDartKr() {
  const result = new Map();
  const key = process.env.OPENDART_KEY;
  if (!key) {
    console.log('  [OpenDART] OPENDART_KEY not set — skipping');
    return result;
  }
  try {
    console.log('  [OpenDART] Fetching corpCode.xml...');
    const zip = await getBuffer(CORPCODE_URL + encodeURIComponent(key));
    const xml = unzipFirstEntry(zip).toString('utf8');
    const parsed = parseCorpCodeXml(xml);
    for (const [t, info] of parsed) result.set(t, info);
    console.log(`  [OpenDART] ${result.size} listed KR stocks (stock_code set)`);
  } catch (e) {
    console.error('  [OpenDART] Failed: ' + e.message);
  }
  return result;
}

module.exports = { fetchOpenDartKr, unzipFirstEntry, parseCorpCodeXml };

if (require.main === module) {
  fetchOpenDartKr().then(m => {
    console.log('Total:', m.size);
    const sample = [...m.entries()].slice(0, 8);
    for (const [t, info] of sample) console.log(' ', t, '-', info.name, '(corp', info.corpCode + ')');
  }).catch(console.error);
}

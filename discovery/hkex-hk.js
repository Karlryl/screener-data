#!/usr/bin/env node
/**
 * HKEX List of Securities — Hong Kong equity universe (keyless)
 * ============================================================
 * Source: https://www.hkex.com.hk/eng/services/trading/securities/securitieslists/ListOfSecurities.xlsx
 * No API key. Updated daily by HKEX. Requires a Referer header (else 403).
 *
 * The .xlsx is a ZIP (deflate, method 8). We parse it with Node built-ins only:
 *   - walk the ZIP local-file headers (sig 0x04034b50), inflateRawSync each entry
 *   - the worksheet stores every cell as t="str" with an inline <x:v> value
 *     (verified live: sharedStrings holds only template placeholders, so NO
 *     shared-strings lookup is needed — each data row is self-contained).
 *
 * Columns (verified 2026-07-03): A=Stock Code  B=Name  C=Category  D=Sub-Category
 *   E=Board Lot  F=ISIN ...
 * Only Category === "Equity" rows are kept (drops Derivative Warrants, CBBCs,
 * Debt Securities, ETPs, REITs).
 *
 * Yahoo ticker: stock code is stored zero-padded to 5 digits (e.g. "00001",
 * "89988"). Yahoo uses the base 4-digit code with leading zeros ("0001.HK",
 * "0700.HK"). Codes with numeric value > 9999 are the "8xxxx" RMB dual-counters
 * (SHK PPT-R, SENSETIME-WR, ...) which Yahoo does not list — dropped.
 *
 * Returns Map<yahooTicker, {ticker, name, exchange, source, country, isin}>.
 * NEVER throws — on any error returns an empty Map (fail-silent).
 */
'use strict';
const https = require('https');
const zlib = require('zlib');

const XLSX_URL = 'https://www.hkex.com.hk/eng/services/trading/securities/securitieslists/ListOfSecurities.xlsx';

// Mirror the redirect/timeout hardening of the sibling discovery adapters, but
// resolve a Buffer (binary .xlsx) rather than a string.
const MAX_REDIRECTS = 5;
function getBuffer(url, redirectsLeft = MAX_REDIRECTS) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'screener-data/1.0 (github.com/Karlryl/screener-data)',
        'Accept': '*/*',
        // HKEX returns 403 without a Referer from its own host.
        'Referer': 'https://www.hkex.com.hk/'
      }
    }, res => {
      if (res.statusCode === 301 || res.statusCode === 302 ||
          res.statusCode === 307 || res.statusCode === 308) {
        res.resume();
        const loc = res.headers.location;
        if (!loc) return reject(new Error('HTTP ' + res.statusCode + ' with no Location header'));
        if (redirectsLeft <= 0) return reject(new Error('too many redirects'));
        let nextUrl;
        try { nextUrl = new URL(loc, url).toString(); }
        catch (e) { return reject(new Error('invalid redirect Location: ' + loc)); }
        return getBuffer(nextUrl, redirectsLeft - 1).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
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

// Extract one named entry from a ZIP by walking local-file headers.
// ponytail: linear scan of local headers, no central-directory read — fine for
// a 12-entry xlsx; switch to the central directory if entry count ever explodes.
function extractZipEntry(buf, wantName) {
  let off = 0;
  while (off + 30 <= buf.length && buf.readUInt32LE(off) === 0x04034b50) {
    const method = buf.readUInt16LE(off + 8);
    const compSize = buf.readUInt32LE(off + 18);
    const nameLen = buf.readUInt16LE(off + 26);
    const extraLen = buf.readUInt16LE(off + 28);
    const name = buf.slice(off + 30, off + 30 + nameLen).toString('utf8');
    const dataStart = off + 30 + nameLen + extraLen;
    if (name === wantName) {
      const comp = buf.slice(dataStart, dataStart + compSize);
      return method === 8 ? zlib.inflateRawSync(comp) : comp; // 0 = stored, 8 = deflate
    }
    off = dataStart + compSize;
  }
  return null;
}

// Minimal XML entity unescape for the five predefined entities.
function unescapeXml(s) {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
          .replace(/&amp;/g, '&'); // &amp; last so we don't double-decode
}

// Pull the column-letter -> value map out of one <x:row> chunk. Every cell in
// this sheet is t="str" with an inline <x:v>; empty cells are self-closing.
const CELL_RE = /<x:c r="([A-Z]+)\d+"[^>]*?(?:\/>|>(?:<x:v>([\s\S]*?)<\/x:v>)?<\/x:c>)/g;
function parseRow(rowXml) {
  const cells = {};
  let m;
  CELL_RE.lastIndex = 0;
  while ((m = CELL_RE.exec(rowXml))) {
    cells[m[1]] = m[2] !== undefined ? unescapeXml(m[2]) : '';
  }
  return cells;
}

async function fetchHkexUniverse() {
  const result = new Map();
  try {
    console.log('  [HKEX] Fetching ListOfSecurities.xlsx...');
    const xlsx = await getBuffer(XLSX_URL);
    if (!xlsx || xlsx.length < 4 || xlsx.readUInt32LE(0) !== 0x04034b50) {
      console.error('  [HKEX] not a ZIP/xlsx payload — skipping');
      return result;
    }
    const sheet = extractZipEntry(xlsx, 'xl/worksheets/sheet1.xml');
    if (!sheet) {
      console.error('  [HKEX] sheet1.xml not found in xlsx — skipping');
      return result;
    }
    const rows = sheet.toString('utf8').split('<x:row ').slice(1);
    let added = 0;
    for (const r of rows) {
      const c = parseRow(r);
      if (c['C'] !== 'Equity') continue;            // only equity securities
      const num = parseInt(c['A'], 10);
      if (!Number.isFinite(num) || num < 1 || num > 9999) continue; // skip 8xxxx RMB counters
      const yahoo = String(num).padStart(4, '0') + '.HK';
      if (result.has(yahoo)) continue;
      const isin = (c['F'] || '').trim();
      const entry = { ticker: yahoo, name: (c['B'] || '').trim(), exchange: 'HKEX', source: 'hkex', country: 'Hong Kong' };
      if (isin) entry.isin = isin;
      result.set(yahoo, entry);
      added++;
    }
    console.log(`  [HKEX] ${added} equity tickers`);
  } catch (e) {
    console.error('  [HKEX] failed: ' + e.message);
    return new Map(); // fail-silent per contract
  }
  return result;
}

module.exports = { fetchHkexUniverse };

if (require.main === module) {
  fetchHkexUniverse().then(m => {
    console.log('Total:', m.size);
    for (const [sym, info] of [...m.entries()].slice(0, 6)) {
      console.log(' ', sym, '-', info.name, '(', info.isin || 'no-isin', ')');
    }
  }).catch(console.error);
}

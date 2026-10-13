#!/usr/bin/env node
/**
 * EDINET (Japan / FSA) — full listed-company universe, keyless.
 * =================================================================
 * Source: https://disclosure2dl.edinet-fsa.go.jp/searchdocument/codelist/Edinetcode.zip
 * No API key required. The FSA publishes the EDINET code list as a single
 * deflate-compressed ZIP containing one Shift_JIS CSV (EdinetcodeDlInfo.csv).
 *
 * The ZIP holds exactly one entry, DEFLATE (method 8) → zlib.inflateRawSync.
 * The CSV's line 1 is a download-metadata banner; line 2 is the column header.
 * Columns used (matched by header name, not fixed index, so a column shuffle
 * doesn't corrupt the parse): 上場区分 (listing flag), 提出者名（英字）(EN name),
 * 証券コード (securities code).
 *
 * Only rows with 上場区分 == "上場" (listed) are kept. The securities code is a
 * 4-char JPX code plus a reserved security-type character (13770 → 1377).
 * Since 2024 new IPOs use an alphanumeric 4-char code (285A0 → 285A = Kioxia),
 * and the fifth position is not assumed to be numeric. yahooTicker = code4 + '.T'.
 *
 * This source has no ISIN/currency; only the EDINET code + corporate number.
 * marketCap is intentionally NOT set (Yahoo fills it later).
 *
 * Returns Map<yahooTicker, {ticker, name, exchange, source, country}>.
 * Fail-silent: any error → empty Map (never throws), per the discovery contract.
 */
'use strict';
const https = require('https');
const zlib = require('zlib');

const CODELIST_URL =
  'https://disclosure2dl.edinet-fsa.go.jp/searchdocument/codelist/Edinetcode.zip';

const MAX_REDIRECTS = 5;

// The FSA download host 403s requests without a Referer from the disclosure site.
function get(url, redirectsLeft = MAX_REDIRECTS) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'screener-data/1.0 (github.com/Karlryl/screener-data)',
        'Referer': 'https://disclosure2.edinet-fsa.go.jp/',
        'Accept': '*/*',
      },
    }, res => {
      if (res.statusCode === 301 || res.statusCode === 302 ||
          res.statusCode === 307 || res.statusCode === 308) {
        res.resume(); // drain before following redirect
        const loc = res.headers.location;
        if (!loc) return reject(new Error('HTTP ' + res.statusCode + ' with no Location header'));
        if (redirectsLeft <= 0) return reject(new Error('too many redirects'));
        let nextUrl;
        try { nextUrl = new URL(loc, url).toString(); }
        catch (e) { return reject(new Error('invalid redirect Location: ' + loc)); }
        return get(nextUrl, redirectsLeft - 1).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        res.resume(); // drain non-200 body to avoid socket leak
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

// Extract the single DEFLATE entry from a minimal ZIP (local file header only).
// ponytail: no generic ZIP lib — the FSA file is one deflate entry, so a fixed
// local-header read is enough. Add a proper reader only if the layout ever changes.
function unzipSingleEntry(buf) {
  if (buf.readUInt32LE(0) !== 0x04034b50) throw new Error('not a ZIP (bad signature)');
  const method = buf.readUInt16LE(8);
  const compSize = buf.readUInt32LE(18);
  const nameLen = buf.readUInt16LE(26);
  const extraLen = buf.readUInt16LE(28);
  const dataStart = 30 + nameLen + extraLen;
  const compData = buf.slice(dataStart, dataStart + compSize);
  if (method === 0) return compData;            // stored
  if (method === 8) return zlib.inflateRawSync(compData); // deflate
  throw new Error('unsupported ZIP compression method ' + method);
}

// Parse one CSV record into fields. Handles double-quoted fields, escaped ""
// quotes, and commas inside quotes. Records never span newlines in this file.
function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } // escaped quote
        else inQuotes = false;
      } else cur += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') { out.push(cur); cur = ''; }
      else cur += c;
    }
  }
  out.push(cur);
  return out;
}

function parseCodeList(csvText) {
  const result = new Map();
  const lines = csvText.split(/\r?\n/);
  if (lines.length < 3) return result; // banner + header + >=1 row expected

  const header = parseCsvLine(lines[1]); // line 0 is the download banner
  const iListing = header.findIndex(h => h.includes('上場区分'));
  const iName    = header.findIndex(h => h.includes('英字'));       // EN name
  const iCode    = header.findIndex(h => h.includes('証券コード'));
  if (iListing < 0 || iName < 0 || iCode < 0) return result; // layout changed → bail silently

  for (let i = 2; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const f = parseCsvLine(lines[i]);
    if ((f[iListing] || '').trim() !== '上場') continue; // listed only
    const code = (f[iCode] || '').trim();
    // 5-char code = 4-char JPX code + reserved security-type character. Keep
    // every position alphanumeric; the fifth position is not numeric-only.
    if (!/^[0-9A-Z]{5}$/i.test(code)) continue;
    const yahooTicker = code.slice(0, 4).toUpperCase() + '.T';
    if (result.has(yahooTicker)) continue;
    result.set(yahooTicker, {
      ticker: yahooTicker,
      name: (f[iName] || '').trim(),
      exchange: 'TSE',
      source: 'edinet-jp',
      country: 'Japan',
    });
  }
  return result;
}

async function fetchEdinetJapan(options = {}) {
  const result = new Map();
  const download = options.get || get;
  const unzip = options.unzip || unzipSingleEntry;
  const decode = options.decode || (payload => new TextDecoder('shift_jis').decode(payload));
  try {
    console.log('  [EDINET-JP] Fetching EDINET code list...');
    const zip = await download(CODELIST_URL);
    const csv = decode(unzip(zip));
    const parsed = parseCodeList(csv);
    for (const [k, v] of parsed) result.set(k, v);
    if (result.size === 0) result.partial = true;
    console.log(`  [EDINET-JP] Total listed TSE stocks: ${result.size}`);
  } catch (e) {
    console.error('  [EDINET-JP] failed: ' + e.message);
    const failed = new Map();
    failed.partial = true;
    return failed; // fail-silent per contract
  }
  return result;
}

module.exports = { fetchEdinetJapan };

if (require.main === module) {
  fetchEdinetJapan().then(m => {
    console.log('Total:', m.size);
    const sample = [...m.entries()].slice(0, 8);
    for (const [sym, info] of sample) console.log(' ', sym, '-', info.name);
  }).catch(console.error);
}

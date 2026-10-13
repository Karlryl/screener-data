#!/usr/bin/env node
/**
 * SZSE (Shenzhen Stock Exchange) A-share Universe Discovery
 * =========================================================
 * Source: official SZSE "A股列表" report API (keyless, live-verified 2026-07-03).
 *   https://www.szse.cn/api/report/ShowReport/data?SHOWTYPE=JSON&CATALOGID=1110&TABKEY=tab1&PAGENO=N
 * REQUIRES a `Referer: https://www.szse.cn/` header — the endpoint returns
 * non-200 without it. ~2895 records across ~145 pages of 20 rows each.
 * Covers 主板 (Main Board) and 创业板 (ChiNext, 300/301xxxx).
 *
 * JSON shape: [ { metadata:{pagecount,recordcount,...}, data:[ {agdm,agjc,agssrq,bk}, ... ] }, ... ]
 *   agdm    = 6-digit A-share code (e.g. 000001)   → yahooTicker = agdm + '.SZ'
 *   agjc    = short name, HTML-wrapped <a>..<u>NAME</u></a> → tags stripped
 *   agssrq  = listing date (YYYY-MM-DD) — informational, not stored (contract has no field)
 *   bk      = board (主板 / 创业板)
 *
 * Contract: Node built-ins only, MAX_REDIRECTS=5, 30s timeout, never throws.
 * A first-page or unexpected total failure returns an empty Map(); later gaps
 * preserve valid rows and set Map.partial=true. marketCap NOT set.
 *
 * Returns Map<yahooTicker, {ticker, name, exchange, source, country}>
 */
'use strict';
const https = require('https');

const BASE = 'https://www.szse.cn/api/report/ShowReport/data'
  + '?SHOWTYPE=JSON&CATALOGID=1110&TABKEY=tab1&PAGENO=';
const REFERER = 'https://www.szse.cn/';
// Safety cap: metadata reports ~145 pages; cap higher so growth doesn't truncate.
// Valid completeness counters normally stop the loop first. ponytail: hard ceiling,
// raise if SZSE > ~4000 listings.
const MAX_PAGES = 300;

const MAX_REDIRECTS = 5;
function get(url, redirectsLeft = MAX_REDIRECTS) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'Referer': REFERER,
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (screener-data; +github.com/Karlryl/screener-data)'
      }
    }, res => {
      if (res.statusCode === 301 || res.statusCode === 302 ||
          res.statusCode === 307 || res.statusCode === 308) {
        res.resume(); // drain the body before following redirect
        const loc = res.headers.location;
        if (!loc) return reject(new Error('HTTP ' + res.statusCode + ' without Location header'));
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
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// agjc arrives as <a href=...><u>平安银行</u></a> — strip tags and collapse whitespace.
function cleanName(raw) {
  return String(raw || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

function readCount(metadata, key, allowZero) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata) ||
      !Object.prototype.hasOwnProperty.call(metadata, key) ||
      metadata[key] === null || metadata[key] === undefined) {
    return { present: false, value: null };
  }

  const raw = metadata[key];
  let value = raw;
  if (typeof raw === 'string') {
    const text = raw.trim();
    if (!/^\d+$/.test(text)) return { present: true, value: null };
    value = Number(text);
  }
  const minimum = allowZero ? 0 : 1;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) {
    return { present: true, value: null };
  }
  return { present: true, value };
}

// One page, retried a few times on transient network blips (ECONNRESET/timeout
// are common against this endpoint). Returns parsed JSON or throws after retries.
async function getPage(page) {
  const RETRIES = 3;
  let lastErr;
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    try {
      return JSON.parse(await get(BASE + page));
    } catch (e) {
      lastErr = e;
      if (attempt < RETRIES) await sleep(1000 * (attempt + 1)); // 1s,2s,3s backoff
    }
  }
  throw lastErr;
}

async function fetchSzseUniverse() {
  const result = new Map();
  const firstSeenPageByTicker = new Map();
  console.log('  [SZSE] Fetching Shenzhen A-share list...');
  let expectedPages = null;
  let expectedRecords = null;
  let lastPageCount = null;
  let lastRecordCount = null;
  let rawRows = 0;
  let invalidRows = 0;
  let termination = 'page-cap';
  const partialReasons = new Set();
  // audit/fix BH-059: a later page dying after retries used to just log+skip —
  // the accumulated Map still came back nonempty/green with no signal that a
  // page (and its ~20 tickers) was dropped from the register. Count skips and
  // stamp the return value so a genuine partial pull isn't mistaken for a
  // complete one (mirrors the otc-markets.js pageErrors pattern).
  let skippedPages = 0;
  try {
    for (let page = 1; page <= MAX_PAGES; page++) {
      let json;
      try {
        json = await getPage(page);
      } catch (e) {
        // One bad page shouldn't kill the whole pull.
        console.error(`  [SZSE] page ${page} failed after retries: ${e.message}`);
        // If the very first page fails, the endpoint is down/blocked — bail to empty.
        if (page === 1) return new Map();
        // A later page died even after retries: skip it and keep going so a
        // single transient reset can't drop the entire tail (incl. ChiNext).
        skippedPages++;
        partialReasons.add('page-fetch-failure');
        if (expectedPages !== null && page >= expectedPages) {
          termination = 'failed-final-page';
          break;
        }
        if (expectedPages === null && expectedRecords === null) {
          termination = 'unbounded-page-failure';
          break;
        }
        await sleep(200);
        continue;
      }

      const block = Array.isArray(json) && json.length > 0 && json[0] &&
        typeof json[0] === 'object' && !Array.isArray(json[0]) ? json[0] : null;
      const metadata = block && block.metadata && typeof block.metadata === 'object' &&
        !Array.isArray(block.metadata) ? block.metadata : null;
      const pageCount = readCount(metadata, 'pagecount', false);
      const recordCount = readCount(metadata, 'recordcount', true);

      if (pageCount.present && pageCount.value === null) {
        partialReasons.add('invalid-pagecount');
      } else if (pageCount.value !== null) {
        if (lastPageCount !== null && pageCount.value !== lastPageCount) {
          partialReasons.add('pagecount-drift');
        }
        lastPageCount = pageCount.value;
        expectedPages = Math.max(expectedPages === null ? 0 : expectedPages, pageCount.value);
      }
      if (recordCount.present && recordCount.value === null) {
        partialReasons.add('invalid-recordcount');
      } else if (recordCount.value !== null) {
        if (lastRecordCount !== null && recordCount.value !== lastRecordCount) {
          partialReasons.add('recordcount-drift');
        }
        lastRecordCount = recordCount.value;
        expectedRecords = Math.max(expectedRecords === null ? 0 : expectedRecords, recordCount.value);
      }

      if (!block || !Array.isArray(block.data)) {
        partialReasons.add('malformed-page');
        if (expectedPages !== null && page < expectedPages) {
          await sleep(200);
          continue;
        }
        termination = 'malformed-page';
        break;
      }

      const rows = block.data;
      if (rows.length === 0) {
        const provenZero = page === 1 && expectedPages === 1 && expectedRecords === 0;
        if (expectedPages !== null && page <= expectedPages && !provenZero) {
          partialReasons.add('empty-declared-page');
        }
        if (expectedPages !== null && page < expectedPages) {
          partialReasons.add('early-empty-page');
          await sleep(200);
          continue;
        }
        if (expectedRecords !== null && rawRows < expectedRecords) {
          partialReasons.add('early-empty-page');
        }
        termination = 'empty-page';
        break;
      }

      rawRows += rows.length;

      for (const r of rows) {
        const code = String(r && r.agdm || '').trim();
        if (!/^\d{6}$/.test(code)) {
          invalidRows++;
          continue;
        }
        const yahooTicker = code + '.SZ';
        const firstSeenPage = firstSeenPageByTicker.get(yahooTicker);
        if (firstSeenPage !== undefined) {
          if (firstSeenPage !== page) partialReasons.add('cross-page-duplicate-code');
          continue;
        }
        firstSeenPageByTicker.set(yahooTicker, page);
        result.set(yahooTicker, {
          ticker: yahooTicker,
          name: cleanName(r.agjc),
          exchange: 'SZSE',
          source: 'szse-cn',
          country: 'China'
        });
      }

      if (expectedPages !== null && page >= expectedPages) {
        termination = 'pagecount';
        break;
      }
      if (expectedPages === null && expectedRecords !== null && rawRows >= expectedRecords) {
        termination = 'recordcount';
        break;
      }
      await sleep(200); // gentle on the official endpoint
    }
  } catch (e) {
    console.error('  [SZSE] unexpected failure: ' + e.message);
    return new Map();
  }

  if (termination === 'page-cap') partialReasons.add('page-cap');
  if (expectedPages === null && expectedRecords === null) {
    partialReasons.add('missing-completeness-counts');
  }
  if (expectedRecords !== null && rawRows !== expectedRecords) {
    partialReasons.add('recordcount-mismatch');
  }
  if (invalidRows > 0) partialReasons.add('invalid-code-row');

  if (partialReasons.size > 0) {
    console.warn(
      `  [SZSE] WARNING: universe is PARTIAL (${result.size} tickers, ${rawRows} raw rows; ` +
      `${[...partialReasons].join(', ')}${skippedPages > 0 ? `; ${skippedPages} page failure(s)` : ''}).`
    );
    result.partial = true;
  }
  console.log(`  [SZSE] Total: ${result.size} A-share tickers`);
  return result;
}

module.exports = { fetchSzseUniverse };

if (require.main === module) {
  fetchSzseUniverse().then(m => {
    console.log('Total:', m.size);
    const sample = [...m.entries()].slice(0, 5);
    for (const [sym, info] of sample) console.log(' ', sym, '-', info.name, '(', info.exchange, ')');
  }).catch(console.error);
}

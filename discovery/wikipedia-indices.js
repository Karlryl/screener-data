#!/usr/bin/env node
/**
 * Tag 133: Wikipedia Index Constituents Discovery
 * Fetches current members of major stock indices via Wikipedia API.
 * Covers: S&P 500, FTSE 100, DAX 40.
 * Returns Map<yahooTicker, {ticker, name, index, source}>
 */
'use strict';
const https = require('https');

// Index → {page, yahooSuffix}
// yahooSuffix applied only when symbols don't already have a period.
const INDICES = [
  { name: 'SP500',   page: 'List_of_S%26P_500_companies', suffix: '' },
  { name: 'FTSE100', page: 'FTSE_100',                    suffix: '.L' },
  { name: 'DAX',     page: 'DAX',                         suffix: '.DE' },
];

// audit/fix: relative-Location ERR_INVALID_URL + uncapped recursion + 307/308 silently wiped this discovery source (mirror nasdaq-api hardening)
const MAX_REDIRECTS = 5;
function get(url, redirectsLeft = MAX_REDIRECTS) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'screener-data/1.0 (github.com/Karlryl/screener-data)',
        'Accept': 'application/json'
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

// audit F-A-2026-06-21: prevents index-membership drift from wikitext dialect
// changes and frozen denylists. The previous implementation scanned EVERY cell of
// EVERY row with a bare-token regex, then leaned on two hand-maintained tables
// (a NOT_TICKERS denylist and a SINGLE_LETTER whitelist) to suppress false
// positives. That approach (a) missed any exchange-prefixed or templated symbol
// such as `[[NYSE: AAPL|AAPL]]` or `{{NYSE|AAPL}}` because the regex only matched
// a bare token after markup strip, and (b) drifted the moment NYSE re-issued a
// single-letter ticker or a new acronym appeared in a caption. Both hand tables
// are removed below: we now locate the ticker COLUMN by its header and read only
// that column, so neither false-positive suppression nor single-letter
// whitelisting is needed.

// Header labels (lower-cased, markup-stripped) that identify the ticker column.
// Different index articles use different wording; matching the header — not the
// cell content — is what removes the denylist/whitelist guesswork.
const TICKER_HEADER_PATTERNS = [
  'symbol', 'ticker', 'ticker symbol', 'trading symbol',
  'code', 'epic', 'epic code', 'ric',
];

// Strip wiki/HTML markup from a single cell or header, resolving piped links and
// common ticker templates to their displayed/value text.
// audit F-A-2026-06-21: resolves templated/prefixed symbols ([[NYSE: AAPL|AAPL]],
// {{NYSE|AAPL}}, {{NASDAQ|MSFT}}) that the old bare-token regex silently dropped.
function cleanCell(cell) {
  let s = cell;
  // {{Exchange|SYM}} / {{Tkr|SYM}} style templates: keep the LAST positional arg
  // (the symbol), dropping the exchange/template name.
  s = s.replace(/\{\{[^{}]*\}\}/g, (m) => {
    const inner = m.slice(2, -2);
    const parts = inner.split('|').map(p => p.trim()).filter(Boolean);
    if (parts.length === 0) return '';
    // Ignore named params (key=value); take the last bare positional token.
    const positional = parts.filter(p => !p.includes('='));
    return positional.length ? positional[positional.length - 1] : '';
  });
  // [[Target|Display]] or [[NYSE: AAPL|AAPL]] → displayed text (after the pipe).
  s = s.replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1');
  // Bold/italic apostrophes, HTML tags, references.
  s = s.replace(/<ref[^>]*>.*?<\/ref>/gis, '')
       .replace(/<ref[^>]*\/>/gi, '')
       .replace(/'{2,3}/g, '')
       .replace(/<[^>]+>/g, '')
       .replace(/&nbsp;/gi, ' ');
  // An exchange prefix may survive as plain text, e.g. "NYSE: AAPL" or "NASDAQ: MSFT".
  s = s.replace(/^\s*(?:NYSE|NASDAQ|NYSEARCA|LSE|FWB|XETRA|ETR)\s*:\s*/i, '');
  return s.trim();
}

// A normalized ticker pattern. Allows dotted/hyphenated share-class suffixes
// (BRK.B, BF.B) that index tables routinely carry.
const TICKER_RE = /^[A-Z][A-Z0-9]{0,4}(?:[.\-][A-Z0-9]{1,3})?$/;

// Parse one `{| ... |}` wikitable. Returns the array of ticker strings found in
// the column whose header matches TICKER_HEADER_PATTERNS, or null if this table
// has no recognizable ticker column (so the caller can skip non-constituent
// tables instead of scraping them blindly).
function extractTickersFromTable(tableText, suffix, out) {
  // Split the table body into rows on the wikitable row separator `|-`.
  const rawRows = tableText.split(/^\s*\|-.*$/m);
  let headerCols = null;
  let tickerColIdx = -1;

  for (const rawRow of rawRows) {
    const trimmed = rawRow.trim();
    if (!trimmed) continue;

    // Header cells start with `!`; a row may pack several with `!!`.
    if (headerCols === null && /(^|\n)\s*!/.test(rawRow)) {
      const cells = [];
      for (const line of rawRow.split('\n')) {
        const t = line.trim();
        if (!t.startsWith('!')) continue;
        // Drop a leading scope=... attribute segment before the cell text.
        for (let part of t.replace(/^!+/, '').split('!!')) {
          const pipeIdx = part.indexOf('|');
          if (pipeIdx !== -1 && !/\[\[|\{\{/.test(part.slice(0, pipeIdx))) {
            part = part.slice(pipeIdx + 1);
          }
          cells.push(cleanCell(part).toLowerCase());
        }
      }
      if (cells.length) {
        headerCols = cells;
        tickerColIdx = headerCols.findIndex(h => TICKER_HEADER_PATTERNS.includes(h));
      }
      continue;
    }

    // Data rows: cells start with `|` (and `||` separates multiple on one line).
    if (headerCols === null || tickerColIdx < 0) continue;
    const cells = [];
    for (const line of rawRow.split('\n')) {
      const t = line.trim();
      if (!t.startsWith('|') || t.startsWith('|+') || t.startsWith('|}')) continue;
      for (let part of t.replace(/^\|+/, '').split('||')) {
        // Strip a leading cell-attribute segment (style=...| ) before the value,
        // but never split inside a link/template.
        const pipeIdx = part.indexOf('|');
        if (pipeIdx !== -1 && !/\[\[|\{\{/.test(part.slice(0, pipeIdx))) {
          part = part.slice(pipeIdx + 1);
        }
        cells.push(part);
      }
    }
    if (cells.length <= tickerColIdx) continue;
    const sym = cleanCell(cells[tickerColIdx]).toUpperCase();
    if (!TICKER_RE.test(sym)) continue;
    let final = sym;
    if (suffix && !final.includes('.')) final = final + suffix;
    out.add(final);
  }
  return tickerColIdx >= 0;
}

function extractTickersFromWikitext(wikitext, suffix) {
  const tickers = new Set();
  // audit F-A-2026-06-21: prevents conflating row-splitting across the whole
  // article. We isolate each `{| ... |}` wikitable and only mine the one(s) that
  // expose a ticker-column header, instead of splitting the entire page on `|-`.
  const tableRe = /\{\|[\s\S]*?\|\}/g;
  let m;
  let matchedAny = false;
  while ((m = tableRe.exec(wikitext)) !== null) {
    if (extractTickersFromTable(m[0], suffix, tickers)) matchedAny = true;
  }
  // If no table advertised a ticker-column header, surface that loudly rather
  // than silently returning a partial/empty set from cell-scanning fallbacks.
  if (!matchedAny) {
    throw new Error('no ticker-column header found in any wikitable (wikitext dialect changed?)');
  }
  return tickers;
}

async function fetchIndexTickers(indexDef) {
  const url = `https://en.wikipedia.org/w/api.php?action=parse&page=${indexDef.page}&prop=wikitext&formatversion=2&format=json`;
  const body = await get(url);
  const parsed = JSON.parse(body);
  const wikitext = parsed && parsed.parse && parsed.parse.wikitext;
  if (!wikitext) throw new Error('No wikitext returned for ' + indexDef.page);
  return extractTickersFromWikitext(wikitext, indexDef.suffix);
}

async function fetchWikipediaIndices() {
  const result = new Map();
  for (const idx of INDICES) {
    try {
      console.log(`  [Wikipedia] Fetching ${idx.name}...`);
      const tickers = await fetchIndexTickers(idx);
      let added = 0;
      for (const sym of tickers) {
        if (!result.has(sym)) {
          result.set(sym, { ticker: sym, name: '', index: idx.name, source: 'wikipedia' });
          added++;
        }
      }
      console.log(`  [Wikipedia] ${idx.name}: ${added} tickers`);
    } catch (e) {
      console.error(`  [Wikipedia] ${idx.name} failed: ` + e.message);
    }
    await sleep(500);
  }
  console.log(`  [Wikipedia] Total: ${result.size} tickers`);
  return result;
}

module.exports = { fetchWikipediaIndices };

if (require.main === module) {
  fetchWikipediaIndices().then(m => console.log('Total:', m.size)).catch(console.error);
}

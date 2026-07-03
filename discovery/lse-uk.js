#!/usr/bin/env node
/**
 * LSE London (Main Market + AIM) — full listed-equity universe, keyless.
 * =====================================================================
 * Source: the live price-explorer JSON gateway the LSE website itself uses
 *   https://api.londonstockexchange.com/api/v1/pages
 *     ?path=live-markets/market-data-dashboard/price-explorer
 *     &parameters=<double-url-encoded "markets=..&categories=EQUITY&size=..&page=..">
 *
 * No API key. The gateway 403s nothing here, but the price-explorer path needs
 * a Referer from the live-markets page. The `parameters` query value is
 * DOUBLE url-encoded (the site encodes the already-encoded querystring), which
 * is what makes the endpoint return rows instead of an empty [].
 *
 * This is a VOLLREGISTER, not an index: MAINMARKET EQUITY (~1016) + AIM EQUITY
 * (~617), every listed ordinary line incl. fresh IPOs. Paginated; we walk all
 * pages at size=500. The instrument rows live at
 *   components[0].content[1].value.content[]
 * with fields: tidm, issuername, isin, category, islse. We keep category==EQUITY
 * and islse==true.
 *
 * tidm → Yahoo mapping (verified against Yahoo search 2026-07-03):
 *   plain      AAL   → AAL.L
 *   trail-dot  BP.   → BP.L      (LSE marks ordinary line with trailing '.')
 *   share-cls  BT.A  → BT-A.L    (dot-before-class becomes hyphen on Yahoo)
 *   rule: replace '.' with '-', strip a trailing '-', append '.L'.
 *
 * marketCap is intentionally NOT set (Yahoo fills it; .L is pence-quoted and
 * Yahoo handles the mcap unit itself).
 *
 * Node built-ins only. Never throws — returns whatever it gathered (empty Map
 * on total failure), per the discovery contract.
 *
 * Returns Map<yahooTicker, {ticker, name, exchange, source, country, isin?}>.
 */
'use strict';
const https = require('https');

const API = 'https://api.londonstockexchange.com/api/v1/pages';
const REFERER = 'https://www.londonstockexchange.com/live-markets/market-data-dashboard/price-explorer';
const PAGE_SIZE = 500;
const MAX_PAGES = 40; // ponytail: hard cap so a runaway totalPages can't loop forever (~1700 rows today → <4 pages/market)
const MARKETS = ['MAINMARKET', 'AIM'];

const MAX_REDIRECTS = 5;
function get(url, redirectsLeft = MAX_REDIRECTS) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json,*/*',
        'Referer': REFERER,
      },
    }, res => {
      if (res.statusCode === 301 || res.statusCode === 302 ||
          res.statusCode === 307 || res.statusCode === 308) {
        res.resume(); // drain body before following redirect
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

function pageUrl(market, page) {
  const params = `markets=${market}&categories=EQUITY&size=${PAGE_SIZE}&page=${page}`;
  // The gateway wants the parameters value DOUBLE url-encoded.
  return API +
    '?path=' + encodeURIComponent('live-markets/market-data-dashboard/price-explorer') +
    '&parameters=' + encodeURIComponent(encodeURIComponent(params));
}

// LSE tidm → Yahoo .L symbol. See header for the mapping rules.
function toYahooTicker(tidm) {
  const t = String(tidm || '').toUpperCase().trim();
  if (!t) return null;
  const base = t.replace(/\./g, '-').replace(/-+$/, ''); // BP.→BP , BT.A→BT-A
  if (!base || !/^[A-Z0-9-]+$/.test(base)) return null;
  return base + '.L';
}

// Pull the instrument array out of the gateway page response, defensively.
function extractRows(body) {
  const j = JSON.parse(body);
  const comps = Array.isArray(j.components) ? j.components : [];
  for (const comp of comps) {
    const content = comp && Array.isArray(comp.content) ? comp.content : [];
    for (const block of content) {
      const v = block && block.value;
      if (v && Array.isArray(v.content) && v.content.length &&
          v.content[0] && ('tidm' in v.content[0])) {
        return { rows: v.content, totalPages: Number(v.totalPages) || 1 };
      }
    }
  }
  return { rows: [], totalPages: 1 };
}

async function fetchLseUniverse() {
  const result = new Map();
  for (const market of MARKETS) {
    try {
      let page = 0;
      let totalPages = 1;
      let added = 0;
      do {
        const body = await get(pageUrl(market, page));
        const { rows, totalPages: tp } = extractRows(body);
        totalPages = tp;
        for (const r of rows) {
          if (!r || r.category !== 'EQUITY' || r.islse !== true) continue;
          const yt = toYahooTicker(r.tidm);
          if (!yt || result.has(yt)) continue;
          const info = {
            ticker: yt,
            name: String(r.issuername || r.description || '').trim(),
            exchange: market === 'AIM' ? 'AIM' : 'LSE',
            source: 'lse',
            country: 'United Kingdom',
          };
          const isin = String(r.isin || '').trim();
          if (isin) info.isin = isin;
          result.set(yt, info);
          added++;
        }
        page++;
      } while (page < totalPages && page < MAX_PAGES);
      console.log(`  [LSE-UK] ${market}: ${added} equities (${totalPages} pages)`);
    } catch (e) {
      console.error(`  [LSE-UK] ${market} failed: ` + e.message);
      // fail-soft per market — keep whatever the other market gathered
    }
  }
  console.log(`  [LSE-UK] Total: ${result.size} tickers`);
  return result;
}

module.exports = { fetchLseUniverse, toYahooTicker };

if (require.main === module) {
  fetchLseUniverse().then(m => {
    console.log('Total:', m.size);
    const sample = [...m.values()].slice(0, 10);
    for (const info of sample) console.log(' ', info.ticker, '-', info.name, '(' + info.exchange + ')');
  }).catch(console.error);
}

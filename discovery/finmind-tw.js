#!/usr/bin/env node
/**
 * Taiwan Universe Discovery — FinMind TaiwanStockInfo
 * ===================================================
 * Source: https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockInfo
 * No API key required (keyless-limited free tier). Returns JSON { status, msg, data[] }.
 *
 * Each data row: { stock_id, stock_name, type, industry_category, date }
 *   type: 'twse' (上市 → Yahoo suffix .TW) | 'tpex' (上櫃/OTC → .TWO) | 'emerging' (興櫃)
 *
 * Filtering (live-verified 2026-07-03):
 *   - Keep only 4-digit numeric stock_id — the canonical TWSE/TPEx common-stock
 *     convention. 5-/6-digit ids are ETFs (00xxx), ETNs, and warrants (7xxxxx).
 *   - Drop ETF / ETN / DR (存託憑證) / beneficiary-cert (受益證券) / index rows by
 *     industry_category — a handful of these ALSO carry 4-digit ids (0050, 9110-DR).
 *   - Drop 'emerging' (興櫃): live Yahoo probe showed ~7/8 pure-emerging ids 404 on
 *     both suffixes, so they'd inject dead tickers. Emerging stocks that also list
 *     on a real board appear again under twse/tpex and are kept there.
 *
 * Suffix (live-verified against query1.finance.yahoo.com):
 *   twse → 2330.TW OK / 2330.TWO 404     tpex → 6488.TWO OK / 6488.TW 404
 *
 * Contract: Map<yahooTicker, {ticker, name, exchange, source, country}>.
 * marketCap NOT set (comes from Yahoo later). Node built-ins only. Never throws -
 * failures return an empty Map with partial=true so callers can expose degraded
 * discovery instead of treating a provider failure as a healthy empty result.
 */
'use strict';
const https = require('https');

const ENDPOINT_URL = 'https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockInfo';

// Non-common-stock security types keyed off industry_category. These slip past the
// 4-digit filter (DRs like 9110, ETF 0050), so name them explicitly.
// 指數/大盤/Index = index pseudo-rows; 所有證券 = warrant bucket ("... 購/售 ...").
const NON_STOCK_CAT_RE = /ETF|ETN|存託憑證|受益證券|指數|大盤|Index|所有證券/i;

const MAX_REDIRECTS = 5;
function get(url, redirectsLeft = MAX_REDIRECTS) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        // A Referer is often required for this endpoint from server IPs.
        'Accept': 'application/json',
        'User-Agent': 'screener-data/1.0 (+https://github.com/Karlryl/screener-data)',
        'Referer': 'https://finmindtrade.com/',
      },
    }, res => {
      if (res.statusCode === 301 || res.statusCode === 302 ||
          res.statusCode === 307 || res.statusCode === 308) {
        res.resume(); // drain before redirect
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

async function fetchTaiwanUniverse({ getFn = get } = {}) {
  const result = new Map();
  try {
    const body = await getFn(ENDPOINT_URL);
    const json = JSON.parse(body);
    const statusOk = json && (json.status === 200 || json.status === '200');
    if (!statusOk) {
      const hasStatus = json && Object.prototype.hasOwnProperty.call(json, 'status');
      const status = hasStatus ? JSON.stringify(json.status) : '<missing>';
      const message = json && typeof json.msg === 'string' && json.msg.trim();
      throw new Error('provider status ' + status + (message ? ': ' + message : ''));
    }

    const data = json.data;
    if (!Array.isArray(data)) {
      throw new Error('unexpected response shape: data must be an array');
    }
    for (const s of data) {
      if (!s || !s.stock_id) continue;
      const id = String(s.stock_id).trim();
      if (!/^[0-9]{4}$/.test(id)) continue;                       // real common-stock ids only
      const type = String(s.type || '').toLowerCase();
      let suffix, exchange;
      if (type === 'twse') { suffix = '.TW'; exchange = 'TWSE'; }
      else if (type === 'tpex') { suffix = '.TWO'; exchange = 'TPEx'; }
      else continue;                                              // drop emerging + anything unknown
      if (NON_STOCK_CAT_RE.test(s.industry_category || '')) continue; // drop ETF/ETN/DR/index
      const sym = id + suffix;
      if (result.has(sym)) continue;
      result.set(sym, {
        ticker: sym,
        name: (s.stock_name || '').trim(),
        exchange,
        source: 'finmind-tw',
        country: 'Taiwan',
      });
    }
    console.log(`  [FinMind-TW] ${result.size} Taiwan common stocks (.TW/.TWO)`);
  } catch (e) {
    console.error('  [FinMind-TW] failed: ' + e.message);
    const partial = new Map();
    partial.partial = true;
    return partial;
  }
  return result;
}

module.exports = { fetchTaiwanUniverse };

if (require.main === module) {
  fetchTaiwanUniverse().then(m => {
    console.log('Total:', m.size);
    for (const [sym, info] of [...m.entries()].slice(0, 8)) {
      console.log(' ', sym, '-', info.name, '(' + info.exchange + ')');
    }
  }).catch(console.error);
}

'use strict';
/**
 * tv-scanner.js — Parametrisierter TradingView-Scanner-Adapter (Bau-Plan 2026-07-03).
 * ================================================================================
 * EIN Adapter erschlaegt ZWEI kaputte (JP-Register via edinet-jp.js liefert nur Filings;
 * SZSE via szse-cn.js egress-geblockt) UND ~10 fehlende Maerkte (Euronext, Schweiz, SE-Asien,
 * Osteuropa, Brasilien, Mexiko). Quelle: POST scanner.tradingview.com/<land>/scan (keyless).
 *
 * Response-Form (live verifiziert 2026-07-03):
 *   { totalCount, data: [ { s:"EXCHANGE:TICKER", d:[name, mcap, ccy, description, type, subtype, exchange, country] } ] }
 *   d[0]=Ticker-Code, d[1]=market_cap_basic (LISTING-Waehrung), d[2]=currency, d[3]=Firmenname,
 *   d[4]=type (nur 'stock'), d[5]=subtype ('common' vs preferred/dr), d[6]=exchange, d[7]=country (Domizil).
 *
 * Nur ENUMERIERUNG: der exakte >= $2B-USD-Gate + quoteType-Doppelpruefung passiert danach in
 * mcap-prefilter.js (live Yahoo-quote). Der TV-mcap-Cut hier ist nur ein grober Vorfilter, damit
 * nicht tausende Kleinwerte in den Yahoo-Re-Pricing-Batch laufen.
 *
 * Fail-silent: jeder Markt einzeln try/catch -> leere Map bei non-200/Timeout/Parse-Fehler.
 * Anker: liegt in discovery/, nur Node-built-ins (https/fs/path) + toUsd aus mcap-prefilter. Keine neue Dependency.
 */
const https = require('https');
const fs = require('fs');
const path = require('path');
const { toUsd } = require('./mcap-prefilter.js');

const MIN_USD_PRECUT = parseFloat(process.env.TV_PRECUT_USD || '1.8e9'); // grob unter $2B (FX-Schlupf); exakter Gate spaeter
const RANGE = parseInt(process.env.TV_SCAN_RANGE || '1200', 10);         // sortiert mcap-desc -> $2B-Namen sind oben
const COL = ['name', 'market_cap_basic', 'currency', 'description', 'type', 'subtype', 'exchange', 'country'];
const I = { code: 0, mcap: 1, ccy: 2, name: 3, type: 4, subtype: 5, exch: 6, country: 7 };

// Markt-Konfiguration. suffix = Yahoo-Suffix; exch (optional) = nur diese Boersen (Dedup/Routing:
// JP nur TSE-Primaer, CN nur SZSE — SSE deckt sse-cn.js schon); domicile (optional) = nur dieses
// Domizil aufnehmen (Brasilien BDR / Mexiko SIC = auslands-domizilierte Doppel raus). canon = Foreign-Slot-Token.
const MARKETS = {
  'tv-szse':      { endpoint: 'china',       suffix: '.SZ', exch: ['SZSE'], canon: 'tvsz', country: 'CN' }, // Fix kaputtes szse-cn.js
  'tv-japan':     { endpoint: 'japan',       suffix: '.T',  exch: ['TSE'],  canon: 'tvjp', country: 'JP' }, // Fix kaputtes edinet-jp.js
  'tv-france':    { endpoint: 'france',      suffix: '.PA', canon: 'tvfr', country: 'FR' },
  'tv-amsterdam': { endpoint: 'netherlands', suffix: '.AS', canon: 'tvnl', country: 'NL' },
  'tv-brussels':  { endpoint: 'belgium',     suffix: '.BR', canon: 'tvbe', country: 'BE' },
  'tv-milan':     { endpoint: 'italy',       suffix: '.MI', canon: 'tvit', country: 'IT' },
  'tv-dublin':    { endpoint: 'ireland',     suffix: '.IR', canon: 'tvie', country: 'IE' },
  'tv-lisbon':    { endpoint: 'portugal',    suffix: '.LS', canon: 'tvpt', country: 'PT' },
  'tv-swiss':     { endpoint: 'switzerland', suffix: '.SW', canon: 'tvch', country: 'CH' },
  'tv-brazil':    { endpoint: 'brazil',      suffix: '.SA', canon: 'tvbr', country: 'BR', domicile: 'Brazil' },
  'tv-mexico':    { endpoint: 'mexico',      suffix: '.MX', canon: 'tvmx', country: 'MX', domicile: 'Mexico' },
  'tv-singapore': { endpoint: 'singapore',   suffix: '.SI', canon: 'tvsg', country: 'SG' },
  'tv-thailand':  { endpoint: 'thailand',    suffix: '.BK', canon: 'tvth', country: 'TH' },
  'tv-malaysia':  { endpoint: 'malaysia',    suffix: '.KL', canon: 'tvmy', country: 'MY' },
  'tv-indonesia': { endpoint: 'indonesia',   suffix: '.JK', canon: 'tvid', country: 'ID' },
  'tv-vietnam':   { endpoint: 'vietnam',     suffix: '.VN', canon: 'tvvn', country: 'VN' },
  'tv-poland':    { endpoint: 'poland',      suffix: '.WA', canon: 'tvpl', country: 'PL' },
  'tv-spain':     { endpoint: 'spain',       suffix: '.MC', canon: 'tves', country: 'ES' },
  'tv-turkey':    { endpoint: 'turkey',      suffix: '.IS', canon: 'tvtr', country: 'TR' },
  'tv-austria':   { endpoint: 'austria',     suffix: '.VI', canon: 'tvat', country: 'AT' },
  'tv-greece':    { endpoint: 'greece',      suffix: '.AT', canon: 'tvgr', country: 'GR' },
};

function loadRates() {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fx-rates.json'), 'utf8')).rates || { USD: 1 }; }
  catch (_) { return { USD: 1 }; }
}

function postScan(endpoint) {
  return new Promise((resolve) => {
    const payload = JSON.stringify({
      filter: [{ left: 'market_cap_basic', operation: 'egreater', right: 2000000000 }],
      options: { lang: 'en' },
      columns: COL,
      sort: { sortBy: 'market_cap_basic', sortOrder: 'desc' },
      range: [0, RANGE],
    });
    let req;
    try {
      req = https.request(`https://scanner.tradingview.com/${endpoint}/scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' },
      }, (res) => {
        let b = '';
        res.on('data', (d) => { b += d; });
        res.on('end', () => {
          if (res.statusCode !== 200) { resolve(null); return; }
          try { resolve(JSON.parse(b)); } catch (_) { resolve(null); }
        });
      });
    } catch (_) { resolve(null); return; }
    req.on('error', () => resolve(null));
    req.setTimeout(30000, () => { try { req.destroy(); } catch (_) {} resolve(null); });
    req.write(payload);
    req.end();
  });
}

// EIN Markt -> Map<yahooTicker,{ticker,name,exchange,source,country}>. Fail-silent (leere Map).
async function scanMarket(key, cfg, rates) {
  const out = new Map();
  let j;
  try { j = await postScan(cfg.endpoint); } catch (_) { return out; }
  if (!j || !Array.isArray(j.data)) return out;
  const seen = new Set();
  for (const row of j.data) {
    const d = row && row.d;
    if (!Array.isArray(d)) continue;
    if (d[I.type] !== 'stock') continue;                          // ETF/Fund/Bond/Index raus
    if (d[I.subtype] && d[I.subtype] !== 'common') continue;      // preferred/DR raus (Wertpapiertyp an der Quelle)
    if (cfg.exch && !cfg.exch.includes(d[I.exch])) continue;      // Boersen-Routing (JP=TSE, CN=SZSE), killt zugleich NAG/FSE-Dubletten
    if (cfg.domicile && d[I.country] !== cfg.domicile) continue;  // BR/MX: auslands-domizilierte BDR/SIC raus
    const usd = toUsd(d[I.mcap], d[I.ccy], rates);                // grober USD-Vorcut; null (unbekannte ccy) -> durchlassen
    if (usd != null && usd < MIN_USD_PRECUT) continue;
    const code = d[I.code];
    if (!code || seen.has(code)) continue;                        // Intra-Markt-Dedup pro Code
    seen.add(code);
    const yt = code + cfg.suffix;
    out.set(yt, { ticker: yt, name: d[I.name] || code, exchange: d[I.exch] || cfg.endpoint, source: key, country: cfg.country || cfg.endpoint });
  }
  return out;
}

/**
 * discoverTvScanner({markets?}) -> Map<yahooTicker, meta> ueber alle (oder Teilmenge) TV-Maerkte.
 * markets: optionale Liste von MARKETS-Keys (Default: alle). Fail-silent pro Markt.
 */
async function discoverTvScanner(opts = {}) {
  const rates = loadRates();
  const keys = Object.keys(MARKETS).filter((k) => !opts.markets || opts.markets.includes(k));
  const results = await Promise.all(keys.map((k) => scanMarket(k, MARKETS[k], rates).catch(() => new Map())));
  const merged = new Map();
  const summary = [];
  for (let i = 0; i < keys.length; i++) {
    const m = results[i];
    for (const [k, v] of m) if (!merged.has(k)) merged.set(k, v);
    summary.push(`${keys[i].replace('tv-', '')}:${m.size}`);
  }
  console.log(`[tv-scanner] ${merged.size} Kandidaten aus ${keys.length} Maerkten (${summary.join(' ')})`);
  return merged;
}

// Foreign-Canon-Beitrag: {source-string: canon-token} fuer FOREIGN_SOURCE_CANON in refresh-universe.js.
const TV_FOREIGN_CANON = Object.fromEntries(Object.entries(MARKETS).map(([k, c]) => [k, c.canon]));

module.exports = { discoverTvScanner, scanMarket, MARKETS, TV_FOREIGN_CANON };

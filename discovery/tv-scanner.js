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

const MIN_USD_PRECUT = parseFloat(process.env.TV_PRECUT_USD || '1.5e9'); // permissiver Client-Cut; exakter $2B-Gate spaeter (Yahoo)
const RANGE = parseInt(process.env.TV_SCAN_RANGE || '2500', 10);         // sortiert mcap-desc; hoch genug, dass kein $2B-Name (v.a. CN/JP) truncatet
const COL = ['name', 'market_cap_basic', 'currency', 'description', 'type', 'subtype', 'exchange', 'country'];
const I = { code: 0, mcap: 1, ccy: 2, name: 3, type: 4, subtype: 5, exch: 6, country: 7 };

// Markt-Konfiguration. suffix = Yahoo-Suffix; exch (optional) = nur diese Boersen (Dedup/Routing:
// JP nur TSE-Primaer, CN nur SZSE — SSE deckt sse-cn.js schon); domicile (optional) = nur dieses
// Domizil aufnehmen (Brasilien BDR / Mexiko SIC = auslands-domizilierte Doppel raus). canon = Foreign-Slot-Token.
// ccy = Listing-Waehrung des Endpoints -> per-Markt USD-aequivalente TV-Filterschwelle (sonst waere
// right:2e9 nur 2 Mrd LOKAL = ~$24M bei INR/~$275M bei CNY -> Top-Range truncatet die kleineren $2B-Namen).
const MARKETS = {
  'tv-szse':      { endpoint: 'china',       suffix: '.SZ', ccy: 'CNY', exch: ['SZSE'], canon: 'tvsz', country: 'CN' }, // Fix kaputtes szse-cn.js
  'tv-japan':     { endpoint: 'japan',       suffix: '.T',  ccy: 'JPY', exch: ['TSE'],  canon: 'tvjp', country: 'JP' }, // Fix kaputtes edinet-jp.js
  'tv-france':    { endpoint: 'france',      suffix: '.PA', ccy: 'EUR', canon: 'tvfr', country: 'FR' },
  'tv-amsterdam': { endpoint: 'netherlands', suffix: '.AS', ccy: 'EUR', canon: 'tvnl', country: 'NL' },
  'tv-brussels':  { endpoint: 'belgium',     suffix: '.BR', ccy: 'EUR', canon: 'tvbe', country: 'BE' },
  'tv-milan':     { endpoint: 'italy',       suffix: '.MI', ccy: 'EUR', canon: 'tvit', country: 'IT' },
  'tv-dublin':    { endpoint: 'ireland',     suffix: '.IR', ccy: 'EUR', canon: 'tvie', country: 'IE' },
  'tv-lisbon':    { endpoint: 'portugal',    suffix: '.LS', ccy: 'EUR', canon: 'tvpt', country: 'PT' },
  'tv-swiss':     { endpoint: 'switzerland', suffix: '.SW', ccy: 'CHF', canon: 'tvch', country: 'CH' },
  'tv-brazil':    { endpoint: 'brazil',      suffix: '.SA', ccy: 'BRL', canon: 'tvbr', country: 'BR', domicile: 'Brazil' },
  'tv-mexico':    { endpoint: 'mexico',      suffix: '.MX', ccy: 'MXN', canon: 'tvmx', country: 'MX', domicile: 'Mexico' },
  'tv-singapore': { endpoint: 'singapore',   suffix: '.SI', ccy: 'SGD', canon: 'tvsg', country: 'SG' },
  'tv-thailand':  { endpoint: 'thailand',    suffix: '.BK', ccy: 'THB', canon: 'tvth', country: 'TH' },
  'tv-malaysia':  { endpoint: 'malaysia',    suffix: '.KL', ccy: 'MYR', canon: 'tvmy', country: 'MY' },
  'tv-indonesia': { endpoint: 'indonesia',   suffix: '.JK', ccy: 'IDR', canon: 'tvid', country: 'ID' },
  'tv-vietnam':   { endpoint: 'vietnam',     suffix: '.VN', ccy: 'VND', canon: 'tvvn', country: 'VN' },
  'tv-poland':    { endpoint: 'poland',      suffix: '.WA', ccy: 'PLN', canon: 'tvpl', country: 'PL' },
  'tv-spain':     { endpoint: 'spain',       suffix: '.MC', ccy: 'EUR', canon: 'tves', country: 'ES' },
  'tv-turkey':    { endpoint: 'turkey',      suffix: '.IS', ccy: 'TRY', canon: 'tvtr', country: 'TR' },
  'tv-austria':   { endpoint: 'austria',     suffix: '.VI', ccy: 'EUR', canon: 'tvat', country: 'AT' },
  'tv-greece':    { endpoint: 'greece',      suffix: '.AT', ccy: 'EUR', canon: 'tvgr', country: 'GR' },
  // Afrika (Workflow-verifiziert): Suedafrika TV-erreichbar, ZAc sauber behandelt. Saudi = separater Adapter (TV /saudi = 404).
  // Israel BEWUSST NICHT: TASE-market_cap_basic kommt in ILA(Agorot) mit unzuverlaessiger Skalierung (dual-listing-verzerrt);
  // die echten israelischen Tech-Namen (CYBR/MNDY/GLBE/NICE) notieren primaer US -> schon ueber US-Adapter gedeckt. Deferred (Dead-Zone-Report).
  'tv-rsa':       { endpoint: 'rsa',         suffix: '.JO', ccy: 'ZAR', canon: 'tvza', country: 'ZA' },
};

function loadRates() {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fx-rates.json'), 'utf8')).rates || { USD: 1 }; }
  catch (_) { return { USD: 1 }; }
}

function postScan(endpoint, right) {
  return new Promise((resolve) => {
    const payload = JSON.stringify({
      filter: [{ left: 'market_cap_basic', operation: 'egreater', right: right }],
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
  // Server-Filterschwelle in LISTING-Waehrung = permissiver USD-Precut / FX-Rate. Bewusst PERMISSIV
  // (1.5e9 statt 2e9), damit FX-Schlupf keinen echten $2B-Namen am Rand wegschneidet — der exakte
  // $2B-USD-Gate + quoteType passiert danach in mcap-prefilter (live Yahoo). Unbekannte ccy -> 2e9 lokal.
  const rate = rates[cfg.ccy];
  const right = (cfg.ccy && Number.isFinite(rate) && rate > 0) ? Math.round(1.5e9 / rate) : 2000000000;
  let j;
  try { j = await postScan(cfg.endpoint, right); } catch (_) { return out; }
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

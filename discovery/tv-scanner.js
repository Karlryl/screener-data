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
  // Bau-Plan (Karl "alles bauen"): restliche Laender, Ertragscheck-verifiziert (scorebar >=$2B via Yahoo).
  // Domizilfilter fuer CEDEAR/DR-schwere Maerkte (Chile/Kolumbien/Argentinien voller Auslands-Listings wie NVDA).
  // 6 getestete Maerkte als Dead-Zones ENTFERNT (0 scorebar — Yahoo loest Suffix nicht auf): UAE/ADX (.AD, IHC/ADNOC
  // nicht auf Yahoo), Peru (.LM), Aegypten (.CA), Marokko (.CS), Pakistan (.KA), Philippinen (.PS). Siehe Coverage-Report.
  'tv-saudi':      { endpoint: 'ksa',        suffix: '.SR', ccy: 'SAR', canon: 'tvksa', country: 'SA' }, // TV /saudi=404, /ksa=OK; 60 scorebar
  'tv-qatar':      { endpoint: 'qatar',      suffix: '.QA', ccy: 'QAR', canon: 'tvqa', country: 'QA' },  // 20
  'tv-newzealand': { endpoint: 'newzealand', suffix: '.NZ', ccy: 'NZD', canon: 'tvnz', country: 'NZ' },  // 18
  'tv-chile':      { endpoint: 'chile',      suffix: '.SN', ccy: 'CLP', canon: 'tvcl', country: 'CL', domicile: 'Chile' },      // 26
  'tv-colombia':   { endpoint: 'colombia',   suffix: '.CL', ccy: 'COP', canon: 'tvco', country: 'CO', domicile: 'Colombia' },  // 12
  'tv-argentina':  { endpoint: 'argentina',  suffix: '.BA', ccy: 'ARS', canon: 'tvar', country: 'AR', domicile: 'Argentina' }, // 9 (CEDEARs gefiltert)
  'tv-romania':    { endpoint: 'romania',    suffix: '.RO', ccy: 'RON', canon: 'tvro', country: 'RO', domicile: 'Romania' },   // 8
  'tv-hungary':    { endpoint: 'hungary',    suffix: '.BD', ccy: 'HUF', canon: 'tvhu', country: 'HU', domicile: 'Hungary' },   // 2
  'tv-czech':      { endpoint: 'czech',      suffix: '.PR', ccy: 'CZK', canon: 'tvcz', country: 'CZ', domicile: 'Czech Republic' }, // 5
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

// Server-Filterschwelle in LISTING-Waehrung = permissiver USD-Precut / FX-Rate. Bewusst PERMISSIV
// (MIN_USD_PRECUT statt 2e9), damit FX-Schlupf keinen echten $2B-Namen am Rand wegschneidet — der
// exakte $2B-USD-Gate + quoteType passiert danach in mcap-prefilter (live Yahoo). Unbekannte ccy -> 2e9 lokal.
// audit/fix BH-065: this used to hardcode the literal 1.5e9 instead of reading
// MIN_USD_PRECUT, so TV_PRECUT_USD could raise the client-side cut (still
// applied in scanMarket below) but never LOWER the server-side one below
// 1.5e9 — the two knobs disagreed. Deriving `right` from MIN_USD_PRECUT makes
// both follow the same env value. Factored out (rather than inlined) so the
// formula is directly unit-testable without a network call.
function serverFloor(ccy, rate) {
  return (ccy && Number.isFinite(rate) && rate > 0) ? Math.round(MIN_USD_PRECUT / rate) : 2000000000;
}

// EIN Markt -> Map<yahooTicker,{ticker,name,exchange,source,country}>. Fail-silent (leere Map).
async function scanMarket(key, cfg, rates) {
  const out = new Map();
  const rate = rates[cfg.ccy];
  const right = serverFloor(cfg.ccy, rate);
  let j;
  try { j = await postScan(cfg.endpoint, right); } catch (_) { return out; }
  if (!j || !Array.isArray(j.data)) return out;
  // audit/fix BH-060: range:[0,RANGE] was never checked against the endpoint's
  // own j.totalCount, so a market with more matches than RANGE truncated
  // silently (the mcap-desc sort means the truncated tail is the SMALLER —
  // but still potentially >=$2B — names). Stamp partial on the returned Map.
  if (Number.isFinite(j.totalCount) && j.totalCount > j.data.length) {
    out.partial = true;
    out.totalCount = j.totalCount;
  }
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

// audit/fix BH-060: all ~34 markets used to fire via a single Promise.all — a
// burst against scanner.tradingview.com with no pool. Small worker pool bounds
// in-flight requests instead; per-market fail-silent behaviour is unchanged.
const TV_SCAN_CONCURRENCY = parseInt(process.env.TV_SCAN_CONCURRENCY || '6', 10);

// Work-stealing pool: runs fn(items[i]) for every index, at most `concurrency`
// in flight, results[i] lines up with items[i] regardless of completion order.
// Factored out (not inlined in discoverTvScanner) so it's unit-testable without
// a network call — see tests/scoring/bh-b14-discovery.test.js.
async function runPooled(items, concurrency, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  const poolSize = Math.min(Math.max(concurrency, 1), items.length) || 1;
  await Promise.all(Array.from({ length: poolSize }, worker));
  return results;
}

/**
 * discoverTvScanner({markets?}) -> Map<yahooTicker, meta> ueber alle (oder Teilmenge) TV-Maerkte.
 * markets: optionale Liste von MARKETS-Keys (Default: alle). Fail-silent pro Markt.
 */
async function discoverTvScanner(opts = {}) {
  const rates = loadRates();
  const keys = Object.keys(MARKETS).filter((k) => !opts.markets || opts.markets.includes(k));
  const results = await runPooled(keys, TV_SCAN_CONCURRENCY,
    (k) => scanMarket(k, MARKETS[k], rates).catch(() => new Map()));
  const merged = new Map();
  const summary = [];
  const partialMarkets = [];
  for (let i = 0; i < keys.length; i++) {
    const m = results[i];
    for (const [k, v] of m) if (!merged.has(k)) merged.set(k, v);
    const label = keys[i].replace('tv-', '');
    summary.push(`${label}:${m.size}${m.partial ? '!' : ''}`);
    if (m.partial) partialMarkets.push(label);
  }
  console.log(`[tv-scanner] ${merged.size} Kandidaten aus ${keys.length} Maerkten (${summary.join(' ')})`);
  if (partialMarkets.length > 0) {
    console.warn(`[tv-scanner] WARNING: truncated (rows < totalCount) in ${partialMarkets.length} market(s): ${partialMarkets.join(', ')} — some >=2B names may be missing.`);
    merged.partial = true;
  }
  return merged;
}

// Foreign-Canon-Beitrag: {source-string: canon-token} fuer FOREIGN_SOURCE_CANON in refresh-universe.js.
const TV_FOREIGN_CANON = Object.fromEntries(Object.entries(MARKETS).map(([k, c]) => [k, c.canon]));

module.exports = { discoverTvScanner, scanMarket, serverFloor, runPooled, MARKETS, TV_FOREIGN_CANON };

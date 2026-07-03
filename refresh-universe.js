#!/usr/bin/env node
/**
 * Tag 165 — Auto-Universum-Refresh
 * ==================================
 * Pullt Yahoo-Screener für Stocks $2B–$500B Mcap weltweit
 * und merged in watchlist.json. Macht Universum dynamisch:
 * neue IPOs / wachsende Mid-Caps werden automatisch sichtbar.
 *
 * Yahoo bietet via fundamental screener:
 *   - day_gainers, day_losers, growth_technology_stocks, etc.
 *   - custom screener via screener('predefined', ...)
 *
 * Wir nutzen mehrere Filter-Buckets, damit wir keine Stocks
 * verpassen, die in einer Single-Region screener nicht auftauchen.
 *
 * Run:  node refresh-universe.js --watchlist watchlist.json
 */
'use strict';
const fs = require('fs');
const path = require('path');
// Tag 189: F-SM-021 / F-DP-046 — atomic watchlist write.
const { writeFileAtomic } = require('./lib/atomic-write.js');
let yf;
try {
  const YF = require('yahoo-finance2').default;
  // Tag 211c: silence yahoo-finance2 schema-validation logging.
  // Yahoo periodically adds new response fields (e.g. impliedSharesOutstanding
  // in May 2026); the library validates strictly and logs the ENTIRE failing
  // payload via console.log BEFORE throwing. On the screener() endpoint that
  // produced ~50MB of log spam per run, masking real errors (Run #104-#105
  // diagnosis required downloading 130MB+ logs). validation.logErrors=false
  // suppresses the noisy logger; our existing try/catch around yf.screener
  // still converts the throw into an empty-quotes return so coverage is
  // unaffected. Constructor-level option (setGlobalConfig is not exposed in
  // yahoo-finance2 v3.14.x — only constructor options work).
  yf = (typeof YF === 'function')
    ? new YF({
        suppressNotices: ['yahooSurvey'],
        validation: { logErrors: false, logOptionsErrors: false }
      })
    : YF;
}
catch (e) { console.error('yahoo-finance2 nicht installiert'); process.exit(1); }

// Tag 133: Additional discovery sources
const { fetchSecTickers }       = require('./discovery/sec-tickers.js');
const { fetchFinnhubUniverse }  = require('./discovery/finnhub.js');
const { fetchWikipediaIndices } = require('./discovery/wikipedia-indices.js');
// Tag 135: NASDAQ Trader exchange files — all US common stocks, no auth required
const { fetchNasdaqAll }        = require('./discovery/nasdaq-all.js');
// Tag 165: OTC Markets (OTCQX/OTCQB/Expert) + NASDAQ Screener API — ~5k additional US tickers
const { fetchOTCMarkets }       = require('./discovery/otc-markets.js');
const { fetchNasdaqApiList }    = require('./discovery/nasdaq-api.js');
// Foreign-exchange discovery (keyless, live-verified 2026-07-03): JP/TW/KR/CN/HK.
// These arrive with marketCap:null; the null-mcap slot protection in the cap block
// (FOREIGN_SOURCES) reserves slots for them so the US-OTC null-mcap mass can't starve
// them. See FOREIGN_SOURCE_CANON below — the cap matches on canonical tokens
// (edinet/finmind/opendart/sse/szse/hkex), so we normalize each row's source at merge.
const { fetchEdinetJapan }      = require('./discovery/edinet-jp.js');
const { fetchTaiwanUniverse }   = require('./discovery/finmind-tw.js');
const { fetchOpenDartKr }       = require('./discovery/opendart-kr.js');
const { fetchSseUniverse }      = require('./discovery/sse-cn.js');
const { fetchSzseUniverse }     = require('./discovery/szse-cn.js');
const { fetchHkexUniverse }     = require('./discovery/hkex-hk.js');
// EU + Rest-Welt (keyless, live-verified 2026-07-03): DE/Nordics/Oslo/India/UK/Canada/Australia.
const { fetchXetraUniverse }    = require('./discovery/xetra.js');
const { fetchNordicUniverse }   = require('./discovery/nordic.js');
const { fetchOsloUniverse }     = require('./discovery/oslo.js');
const { fetchNseIndia }         = require('./discovery/nse-in.js');
const { fetchLseUniverse }      = require('./discovery/lse-uk.js');
const { fetchTsxCanada }        = require('./discovery/tsx-ca.js');
const { fetchAsxUniverse }      = require('./discovery/asx-au.js');
// Bau-Plan 2026-07-03: parametrisierter TradingView-Scanner. EIN Adapter fixt JP-Register
// (edinet-jp lieferte nur Filings) + SZSE (szse-cn egress-blockiert) UND deckt ~10 fehlende Maerkte
// (Euronext/Schweiz/SE-Asien/Osteuropa/Brasilien/Mexiko). Fail-silent pro Land.
const { discoverTvScanner, TV_FOREIGN_CANON } = require('./discovery/tv-scanner.js');
// Marktkap-Vorpruefung (Karl-Sizing-Fix): filtert die Auslands-null-mcap-Zeilen VOR dem teuren Pull
// billig auf >= $2B USD (Batch-Yahoo-quote). Nur die Ueberlebenden gehen in den Fundamental-Pull.
const { prefilterByMcap }       = require('./discovery/mcap-prefilter.js');
// Map each foreign adapter's emitted source string onto a canonical foreign token. Used by (a) the
// mcap-prefilter to identify foreign null-mcap rows and (b) the cap block's FOREIGN_SOURCES fallback
// for any row the prefilter could not price (network miss -> stays null-mcap -> slot-protected).
const FOREIGN_SOURCE_CANON = {
  'edinet-jp': 'edinet', 'finmind-tw': 'finmind', 'opendart': 'opendart',
  'sse-cn': 'sse', 'szse-cn': 'szse', 'hkex': 'hkex',
  'xetra': 'xetra', 'nordic': 'nordic', 'oslo': 'oslo', 'nse-in': 'nse', 'lse': 'lse', 'tsx': 'tsx', 'asx': 'asx',
  // Bau-Plan: per-Land TV-Scanner-Tokens (tv-japan->tvjp, tv-szse->tvsz, ...). Jedes landet ueber
  // FOREIGN_CANON_SET automatisch im Foreign-Slot-Schutz (FIX-3) und wird von mcap-prefilter gepreist.
  ...TV_FOREIGN_CANON
};
const FOREIGN_CANON_SET = new Set(Object.values(FOREIGN_SOURCE_CANON));

function parseArgs(argv) {
  const args = { watchlist: './watchlist.json', out: null };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--watchlist' && argv[i+1]) args.watchlist = argv[++i];
    else if (argv[i] === '--out' && argv[i+1]) args.out = argv[++i];
  }
  if (!args.out) args.out = args.watchlist;
  return args;
}

// Yahoo-vordefinierte Screener (geographisch/thematisch breit)
// Liste keine Banken/REITs/Insurance — die fliegen sowieso im Modus-Filter raus,
// aber wir minimieren Pull-Last.
// Tag 116: Erweitert auf 13 Buckets (mehr Coverage)
const SCREENER_IDS = [
  'most_actives',                  // Volume-leaders weltweit
  'day_gainers',                   // momentum candidates
  'undervalued_growth_stocks',     // Quality-Value-Mix
  'growth_technology_stocks',      // Hypergrowth-Tech
  'aggressive_small_caps',         // potential mid-cap upgrades
  'small_cap_gainers',
  'undervalued_large_caps',
  'most_shorted_stocks',           // Tag 116: contrarian/short-squeeze
  'portfolio_anchors',             // Tag 116: large-cap quality
  'solid_large_growth_funds',      // Tag 116: large-growth
  'solid_midcap_growth_funds',     // Tag 116: midcap-growth
  'conservative_foreign_funds',    // Tag 116: international
  'high_yield_bond',               // skip but kept for coverage
];

// Tag 132: Multi-Region Pull — 25 Regionen (+KR/TW/BR/MX/SG/CH/DK/NO/FI/ZA/SA)
const REGIONS = ['US', 'GB', 'DE', 'FR', 'HK', 'JP', 'AU', 'CA', 'CN', 'IN', 'IT', 'NL', 'SE', 'ES', 'KR', 'TW', 'BR', 'MX', 'SG', 'CH', 'DK', 'NO', 'FI', 'ZA', 'SA'];

// Tag 131: Exchange-Code-basierter Custom-Screener (geht über curated Yahoo-Listen hinaus)
// Paginiert über alle Stocks $1B–$500B mcap je Exchange → ~10k+ Coverage möglich
const EXCHANGE_CODES = [
  'NMS',  // NASDAQ Global Select
  'NYQ',  // NYSE
  'NGM',  // NASDAQ Global Market
  'NIM',  // NASDAQ Capital Market
  'ASE',  // NYSE American
  'LSE',  // London
  'FRA',  // Frankfurt
  'PAR',  // Paris (Euronext)
  'AMS',  // Amsterdam
  'MIL',  // Milan
  'STO',  // Stockholm
  'HKG',  // Hong Kong
  'TYO',  // Tokyo
  'SHH',  // Shanghai
  'SHZ',  // Shenzhen
  'BSE',  // Bombay/NSE India
  'KOE',  // Korea
  'TAI',  // Taiwan
  'ASX',  // Australia
  'TOR',  // Toronto
  // Tag 132: Additional exchanges
  'CPH',  // Copenhagen
  'OSL',  // Oslo
  'HEL',  // Helsinki
  'SAO',  // Sao Paulo (B3)
  'MEX',  // Mexico
  'SGX',  // Singapore
  'SWX',  // Swiss Exchange
  'JNB',  // Johannesburg
  'SAU',  // Saudi Arabia (Tadawul)
];

// audit/fix (BUG HIGH — US class-share dot→dash for Yahoo): US class-share
// tickers are stored in DOT form (BRK.B, BF.A, HEI.A) but Yahoo Finance's API
// requires DASH form (BRK-B, BF-A, HEI-A). pull-yahoo passes yahoo_symbol
// verbatim to yf.quote()/quoteSummary, so a dot-form yahoo_symbol is a permanent
// silent 404. We must convert ONLY genuine US class shares — and must NOT touch
// foreign exchange suffixes that share the same single-letter shape (RIO.L London,
// 7203.T Tokyo, TKE.F Frankfurt, ABBN.SW Swiss, SHOP.TO Toronto, NESN.SW, ...).
//
// Determining US-ness (conservative — if uncertain, do NOT convert):
//   - The US-only discovery sources are sec-tickers(sec-edgar), nasdaq-all
//     (nasdaq-trader) and nasdaq-api(nasdaq-api). Rows from auto-universe-refresh
//     that carry a US exchange string are US too.
//   - A US exchange string is NASDAQ / NYSE / NYSE American / NYSE Arca / AMEX /
//     BATS / CBOE / the bare 'US' marker sec-edgar emits, plus the Yahoo
//     exchange codes for those venues (NMS/NGM/NCM/NIM/ASE/PCX).
// On the merged candidate objects the relevant fields are `exchange` and `source`;
// on EXISTING watchlist rows they are `exchange_hint` and `added_via`. _looksUS
// accepts whichever pair the caller has.
const _US_SOURCES = new Set(['sec-edgar', 'nasdaq-trader', 'nasdaq-api', 'auto-universe-refresh']);
// Includes both human-readable venue names AND Yahoo exchange CODES used by the
// custom exchange-screener (EXCHANGE_CODES): NMS/NGM/NIM/NCM (NASDAQ tiers),
// NYQ (NYSE), ASE (NYSE American), PCX (NYSE Arca). 'US' is the bare marker
// sec-edgar emits. Anchored on word boundaries so 'LSE'/'OSL' never match 'US'.
// audit/fix (BUG MEDIUM): the bare case-insensitive `NASDAQ` alternation matched the
// word "Nasdaq" inside the NON-US Nordic venue strings ("Nasdaq Helsinki/Stockholm/
// Copenhagen", "NASDAQ OMX") - a latent false-positive. The literal "NASDAQ" IS
// load-bearing for genuine US rows (discovery/nasdaq-all.js emits exchange:'NASDAQ';
// discovery/nasdaq-api.js emits label 'NASDAQ'), so we keep it but add a negative
// lookahead rejecting a following space + Nordic/OMX locale token. US 'NASDAQ' is
// bare (no trailing locale) so the lookahead never fires on it.
const _NORDIC_NASDAQ = 'OMX|Helsinki|Stockholm|Copenhagen|Reykjavik|Iceland|Riga|Tallinn|Vilnius|Baltic|Nordic';
const _US_EXCHANGE_RE = new RegExp(
  '\\b(NASDAQ(?! +(?:' + _NORDIC_NASDAQ + '))|NYSE|NYSE ARCA|NYSE AMERICAN|AMEX|BATS|CBOE|NMS|NGM|NCM|NIM|NYQ|ASE|PCX|US)\\b',
  'i'
);
// audit/fix (BUG MEDIUM): Yahoo's q.fullExchangeName is spaceless camelCase
// ("NasdaqGS/GM/CM", "NYSEArca", "NYSEAmerican") which the word-boundary RE above
// can't match. These case-SENSITIVE alternations require the tier letter to follow
// IMMEDIATELY (no space): so they flag "NasdaqGS" etc. but NOT the Nordic "Nasdaq
// Helsinki" (space breaks `Nasdaq[A-Z]`). Kept outside /i so casing is enforced.
const _US_EXCHANGE_CAMEL_RE = /Nasdaq[A-Z]|NYSE(?:Arca|American)/;
function _looksUS(exchange, source) {
  const ex = String(exchange || '').trim();
  const src = String(source || '').trim().toLowerCase();
  // audit/fix (BUG MEDIUM): test both the word-boundary RE (codes + spaced venue
  // names) AND the case-sensitive camelCase RE (Yahoo's NasdaqGS/NYSEArca forms).
  if (ex && (_US_EXCHANGE_RE.test(ex) || _US_EXCHANGE_CAMEL_RE.test(ex))) return true;
  if (src && _US_SOURCES.has(src)) return true;
  return false;
}
// audit/fix: class-share suffix is restricted to A/B/C — the real Yahoo class-share
// letters present in the live universe (BRK-A, BRK-B, BF-A, CIG-C). It deliberately
// EXCLUDES '.V': on NASDAQ-Trader '.V' is a when-issued / rights artifact (FDX.V,
// MKC.V, NVRI.V, TYG.V — all have a plain base symbol FDX/MKC/NVRI/TYG already in
// the universe), so converting .V→-V would fabricate a symbol Yahoo also 404s on.
const _CLASS_SHARE_RE = /^[A-Z]{1,5}\.[ABC]$/;
// audit/fix: convert a US class-share ticker from dot to dash for Yahoo. Returns
// the ticker UNCHANGED unless it is US-listed AND matches the class-share shape.
function toYahooClassShare(ticker, isUS) {
  if (!ticker || typeof ticker !== 'string') return ticker;
  if (!isUS) return ticker;                       // foreign or unknown → never touch
  if (!_CLASS_SHARE_RE.test(ticker)) return ticker;
  return ticker.replace('.', '-');
}
// audit/fix: the dedup KEY for a merged candidate. Collapses a US class-share dot
// form onto its dash twin (BRK.B & BRK-B → BRK-B) so they never enter as two rows;
// foreign keys pass through unchanged. exchange/source pin US-ness conservatively.
function dedupKey(ticker, exchange, source) {
  return toYahooClassShare(ticker, _looksUS(exchange, source));
}

async function _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchScreener(id, region) {
  region = region || 'US';
  // F-DP-011 / F-DP-010: 3 attempts total, i.e. up to 2 retries on 429 with linear
  // back-off (5s before attempt 1, 10s before attempt 2). The final attempt (2) is
  // not retried — on its failure we fall through and log.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await yf.screener({ scrIds: id, count: 250, region: region });
      return (r && r.quotes) || [];
    } catch (e) {
      const is429 = (e && e.statusCode === 429) || (e && e.message && e.message.includes('429'));
      if (is429 && attempt < 2) {
        await _sleep((attempt + 1) * 5000);
        continue;
      }
      // F-DP-009 (Tag 233b): log screener failures so CI can detect Yahoo screener outages.
      // Previously silent [] returns masked 429s and schema breaks — universe shrank undetected.
      // F-DP-010: distinguish a rate-limit exhaustion (all retries spent on 429) from
      // other failures, so CI can tell "Yahoo throttled us" apart from a schema/outage break.
      const cause = is429 ? '429 rate-limit exhausted after ' + (attempt + 1) + ' attempts' : (e && e.message || String(e));
      console.warn('  [WARN] fetchScreener [' + id + '/' + region + '] failed: ' + cause);
      return [];
    }
  }
}

// Tag 131: Custom Exchange-Screener mit Pagination.
// Liefert ALLE Stocks je Exchange die $1B-$500B Mcap haben — nicht nur curated Listen.
//
// F-DP-037 (Tag 190): vorher schluckte der catch-Branch jede Yahoo-screener-Fehlermeldung
// silent → wenn LSE/SHA/HKG einen 429 / Schema-Break hatten, fiel die exchange einfach raus
// und coverage-gate maß gegen das geschrumpfte Universum, ohne Alarm. Jetzt:
//   - return value ist {quotes, error}
//   - 429-Antwort triggert ein retry-with-backoff (max 3 attempts)
//   - error wird vom Caller geloggt & in den per-exchange-Stats summiert
async function fetchExchangePage(exchangeCode, minMcap, maxMcap, offset, attempt) {
  attempt = attempt || 1;
  const MAX_ATTEMPTS = 3;
  try {
    const r = await yf.screener({
      query: {
        operator: 'AND',
        operands: [
          { operator: 'btwn', operands: ['intradaymarketcap', minMcap, maxMcap] },
          { operator: 'eq', operands: ['exchange', exchangeCode] }
        ]
      },
      count: 250,
      offset: offset || 0,
      sortField: 'intradaymarketcap',
      sortType: 'DESC'
    });
    return { quotes: (r && r.quotes) || [], error: null };
  } catch (e) {
    const msg = String(e && e.message || e);
    const is429 = /429|too many requests|rate limit/i.test(msg);
    if (is429 && attempt < MAX_ATTEMPTS) {
      const backoffMs = 1000 * Math.pow(2, attempt);
      console.warn('  [' + exchangeCode + '] 429 (attempt ' + attempt + '/' + MAX_ATTEMPTS +
        ') — backoff ' + backoffMs + 'ms');
      await new Promise(r => setTimeout(r, backoffMs));
      return fetchExchangePage(exchangeCode, minMcap, maxMcap, offset, attempt + 1);
    }
    return { quotes: [], error: msg };
  }
}

async function fetchWithMcap(symbol) {
  try {
    const q = await yf.quote(symbol);
    return q;
  } catch (e) { return null; }
}

async function main() {
  const args = parseArgs(process.argv);
  console.log('Auto-Universe-Refresh');
  console.log('  watchlist: ' + args.watchlist);

  const wlRaw = JSON.parse(fs.readFileSync(args.watchlist, 'utf8'));
  // audit F-A-2026-06-21: a single watchlist row with a null/undefined ticker
  // would throw TypeError on .toUpperCase() and abort the entire universe
  // refresh (one bad row -> frozen universe). Drop ticker-less rows from the
  // existing-set instead of crashing.
  // audit/fix (BUG HIGH — dedup key must be class-share-normalized): key the
  // existing-set on the dash-normalized form so an incoming dash candidate
  // (BRK-B from sec-edgar) is recognized as already-present against a stored
  // dot row (BRK.B) — and vice-versa — instead of entering as a second row.
  // Only US class-share dots are folded; foreign keys pass through unchanged.
  const existing = new Set(
    wlRaw.stocks
      .filter(s => s && s.ticker)
      .map(s => dedupKey(String(s.ticker).toUpperCase(), s.exchange_hint, s.added_via))
  );
  console.log('  current size: ' + existing.size);

  // 1. Pull all screener-buckets x regions in parallel
  // Tag 116: Mcap-Range gesenkt auf $1B (mehr Mid-Cap-Coverage), max bleibt $500B
  console.log('\nPulling Yahoo Screener-Buckets (Multi-Region)...');
  const allTickers = new Map(); // ticker -> {marketCap, name, sector, exchange}
  for (const region of REGIONS) {
    console.log('  --- Region: ' + region + ' ---');
    for (const id of SCREENER_IDS) {
      const quotes = await fetchScreener(id, region);
      if (quotes.length === 0) continue;
      let kept = 0;
      for (const q of quotes) {
        if (!q || !q.symbol) continue;
        const sym = q.symbol.toUpperCase();
        // Tag 221 (audit Tag 221a): filter junk-suffix tickers. NASDAQ-Trader
        // and some Yahoo screener responses include preferred-stock variants
        // (ABR$D, ACP$A — 375 such entries in pre-Tag-221 watchlist) that
        // Yahoo's quoteSummary doesn't recognize. They cycle through pull-yahoo
        // every day eating rate-limit budget for nothing. Filter at the
        // discovery stage so they never enter the watchlist.
        if (/[$]/.test(sym)) continue;        // preferred-stock variants
        if (/[/\\\s]/.test(sym)) continue;    // path-separators or whitespace = corrupt
        if (sym.length > 12) continue;        // longer than any real ticker — likely a name
        const mcap = q.marketCap;
        if (!mcap || mcap < 1e9 || mcap > 500e9) continue;  // Tag 101: $1B+ Mid/Large-Cap universe
        // audit/fix: key the candidate map on the class-share-normalized symbol so a
        // US class-share dot collapses onto its dash twin; foreign keys unchanged.
        // audit/fix (BUG MEDIUM): prefer the exchange CODE (q.exchange = NMS/NYQ/ASE,
        // which _US_EXCHANGE_RE matches) over the camelCase display name
        // (q.fullExchangeName = "NasdaqGS"/"NYSEArca") so _looksUS=true fires at
        // dedup time and the class-share collapse happens HERE, not only later.
        const exForKey = q.exchange || q.fullExchangeName || '';
        const key = dedupKey(sym, exForKey, '');
        if (!allTickers.has(key) || (allTickers.get(key).marketCap || 0) < mcap) {
          allTickers.set(key, {
            ticker: key,
            marketCap: mcap,
            name: q.longName || q.shortName || '',
            sector: q.sector || '',
            exchange: q.fullExchangeName || q.exchange || ''
          });
        }
        kept++;
      }
      if (kept > 0) console.log('    ' + id.padEnd(36) + quotes.length + ' -> ' + kept);
      await _sleep(300);
    }
  }

  // Tag 131: Custom Exchange-Screener (paginiert) — zusätzlich zu predefined Screener-Buckets.
  // Ziel: 10k+ Stocks statt ~3500.
  console.log('\nCustom Exchange-Screener (Tag 131)...');
  const MIN_MCAP_CUSTOM = 1e9;  // $1B+ minimum (Tag 170 reverted)
  const MAX_MCAP_CUSTOM = 500e9;
  let customAdded = 0;
  // F-DP-037 (Tag 190): per-exchange statistics so we can surface silent
  // breakage. Without this, a 429 or schema break on one exchange just made
  // the exchange disappear with zero diagnostic.
  const exchangeStats = {};
  for (const exch of EXCHANGE_CODES) {
    let offset = 0;
    let pageEmpty = false;
    let pageErrors = 0;
    let totalQuotes = 0;
    let totalKept = 0;
    while (!pageEmpty) {
      const { quotes, error } = await fetchExchangePage(exch, MIN_MCAP_CUSTOM, MAX_MCAP_CUSTOM, offset);
      if (error) {
        pageErrors++;
        console.warn('  [' + exch + ' offset=' + offset + '] FAIL: ' + error);
        // F-DP-037: don't pretend the page was empty — break to next exchange
        // but record the error.
        pageEmpty = true;
        break;
      }
      if (quotes.length === 0) { pageEmpty = true; break; }
      totalQuotes += quotes.length;
      let kept = 0;
      for (const q of quotes) {
        if (!q || !q.symbol) continue;
        const sym = q.symbol.toUpperCase();
        // Tag 221: same junk-suffix filter as the screener-buckets loop above.
        if (/[$]/.test(sym)) continue;
        if (/[/\\\s]/.test(sym)) continue;
        if (sym.length > 12) continue;
        const mcap = q.marketCap;
        if (!mcap || mcap < MIN_MCAP_CUSTOM || mcap > MAX_MCAP_CUSTOM) continue;
        // audit/fix: class-share-normalize the map key. `exch` is the Yahoo
        // exchange CODE (NMS/NYQ/ASE = US; LSE/FRA/etc = foreign), so US class
        // shares pulled here fold onto their dash twin; foreign codes pass through.
        // audit/fix (BUG MEDIUM): prefer the CODE (q.exchange / exch, both match
        // _US_EXCHANGE_RE for US venues) over the camelCase q.fullExchangeName
        // ("NasdaqGS"/"NYSEArca") so _looksUS=true at dedup time; the camelCase RE
        // now also covers fullExchangeName as a belt-and-braces fallback.
        const exForKey = q.exchange || q.fullExchangeName || exch;
        const key = dedupKey(sym, exForKey, '');
        if (!allTickers.has(key) || (allTickers.get(key).marketCap || 0) < mcap) {
          allTickers.set(key, {
            ticker: key, marketCap: mcap,
            name: q.longName || q.shortName || '',
            sector: q.sector || '',
            exchange: q.fullExchangeName || q.exchange || exch
          });
          kept++;
          customAdded++;
        }
      }
      totalKept += kept;
      if (kept > 0) console.log(`  ${exch} offset=${offset}: ${quotes.length} quotes, ${kept} new`);
      if (quotes.length < 250) { pageEmpty = true; }
      else { offset += 250; await _sleep(400); }
    }
    exchangeStats[exch] = { totalQuotes, totalKept, pageErrors };
  }
  console.log('Custom-Screener total neue Tickers: ' + customAdded);
  // F-DP-037: per-exchange summary + soft alert when an exchange returned 0 quotes.
  // If a previously-productive exchange suddenly returns 0 (and no error was raised),
  // that's the silent-shrink scenario — log it conspicuously.
  const totalsByExch = Object.entries(exchangeStats)
    .map(([e, s]) => `${e}=${s.totalQuotes}/${s.totalKept}n${s.pageErrors > 0 ? ' ERR:' + s.pageErrors : ''}`)
    .join(' ');
  console.log('  Per-exchange (totalQuotes/newKept): ' + totalsByExch);
  const zeroQuoteExchanges = Object.entries(exchangeStats)
    .filter(([_, s]) => s.totalQuotes === 0 && s.pageErrors === 0)
    .map(([e]) => e);
  if (zeroQuoteExchanges.length > 0) {
    console.warn('[WARN] Exchanges with 0 quotes and no error (possible silent failure): ' +
      zeroQuoteExchanges.join(', '));
  }

  // Tag 133/135: Merge additional discovery sources into allTickers
  // NASDAQ-Trader: ~7k–8k US common stocks (no auth required) — Tag 135
  // SEC EDGAR:     ~10k US-listed companies (no auth required)
  // Finnhub:       ~20k+ global stocks per exchange (needs FINNHUB_API_KEY secret)
  // Wikipedia:     S&P 500 / FTSE 100 / DAX constituents (no auth required)
  // Tag 165: OTC Markets OTCQX/OTCQB/Expert — ~3k–5k additional US OTC tickers (no auth required)
  // Tag 165: NASDAQ Screener API — NASDAQ/NYSE/AMEX with sector/mcap hints (no auth required)
  console.log('\nDiscovery: Additional Sources (Tag 133/135/165)...');
  // audit/fix: name the sources in call-order so per-source observability below
  // can attribute a non-empty/empty/failed result to the right discovery module.
  const DISCOVERY_SOURCE_NAMES = [
    'nasdaq-all', 'sec-tickers', 'finnhub', 'wikipedia-indices', 'otc-markets', 'nasdaq-api',
    'edinet-jp', 'finmind-tw', 'opendart-kr', 'sse-cn', 'szse-cn', 'hkex-hk',
    'xetra', 'nordic', 'oslo', 'nse-in', 'lse-uk', 'tsx-ca', 'asx-au',
    'tv-scanner'
  ];
  const discoverySources = await Promise.allSettled([
    fetchNasdaqAll(),
    fetchSecTickers(),
    fetchFinnhubUniverse(),
    fetchWikipediaIndices(),
    fetchOTCMarkets(),
    fetchNasdaqApiList(),
    fetchEdinetJapan(),
    fetchTaiwanUniverse(),
    fetchOpenDartKr(),
    fetchSseUniverse(),
    fetchSzseUniverse(),
    fetchHkexUniverse(),
    fetchXetraUniverse(),
    fetchNordicUniverse(),
    fetchOsloUniverse(),
    fetchNseIndia(),
    fetchLseUniverse(),
    fetchTsxCanada(),
    fetchAsxUniverse(),
    discoverTvScanner()
  ]);
  // audit/fix (BUG HIGH — silent total-discovery-outage): every source returns an
  // empty Map() on total failure instead of rejecting, so Promise.allSettled sees
  // them all 'fulfilled' and the rejected-branch is dead for the common-outage case.
  // Track, per source, whether it contributed a NON-EMPTY map and how many raw
  // candidate rows it yielded, so a degraded run can be detected after the merge.
  const discoveryYield = {};   // sourceName -> raw candidate count (-1 = rejected/failed)
  let nonEmptySources = 0;
  let totalDiscoveryCandidates = 0;
  for (let i = 0; i < discoverySources.length; i++) {
    const res = discoverySources[i];
    const srcName = DISCOVERY_SOURCE_NAMES[i] || ('source#' + i);
    if (res.status === 'rejected') {
      console.error('  Discovery source error [' + srcName + ']: ' + res.reason);
      discoveryYield[srcName] = -1;
      continue;
    }
    const srcMap = res.value;
    // audit/fix (SECONDARY MEDIUM): the merge loop trusted res.value to be an
    // iterable of [sym,info] pairs. A source ever returning a non-Map (or a
    // non-iterable) would throw mid-loop and — because the sources are merged
    // sequentially — silently discard every LATER source's tickers too. Guard
    // each result: log+skip a non-conforming source instead of aborting the merge.
    if (!(srcMap instanceof Map)) {
      console.error('  Discovery source [' + srcName + '] returned a non-Map (' +
        (srcMap === null ? 'null' : typeof srcMap) + ') — skipping it');
      discoveryYield[srcName] = -1;
      continue;
    }
    discoveryYield[srcName] = srcMap.size;
    totalDiscoveryCandidates += srcMap.size;
    if (srcMap.size > 0) nonEmptySources++;
    for (const [sym, info] of srcMap) {
      // Normalize the foreign adapter's source token (edinet-jp -> edinet, etc.) to
      // the canonical form the cap block's FOREIGN_SOURCES set reserves null-mcap
      // slots for. Non-foreign sources pass through unchanged. Mutating info.source
      // here means BOTH the set-branch and the else-union-branch below carry the
      // canonical token, so the row survives the slot-cap.
      if (info && FOREIGN_SOURCE_CANON[info.source]) info.source = FOREIGN_SOURCE_CANON[info.source];
      // audit/fix: class-share-normalize the merge key so a discovery dash form
      // (sec-edgar BRK-B) folds onto an already-seen dot form (and vice-versa),
      // and so this source's US class shares collapse onto their dash twin.
      // info.exchange/info.source pin US-ness; foreign keys pass through.
      const key = dedupKey(sym, info.exchange, info.source);
      if (!allTickers.has(key)) {
        allTickers.set(key, {
          ticker: key,
          // Tag 165: carry marketCap hint from NASDAQ API when available
          // audit F-A-2026-06-21: coerce non-finite/NaN/Infinity/<=0 marketCap
          // hints to null on ingest. A bad source value of Infinity would sort
          // to the top of the rank-cap (line ~390) and crowd out real names;
          // null routes it correctly into the bounded null-mcap bucket.
          marketCap: (Number.isFinite(info.marketCap) && info.marketCap > 0) ? info.marketCap : null,
          name: info.name || '',
          sector: info.sector || '',
          exchange: info.exchange || '',
          // F-DP-015: preserve source attribution from discovery source
          source: info.source || 'unknown'
        });
      } else {
        // F-DP-015: ticker already seen — concatenate source field so attribution is not lost.
        // F-217a-04: dedupe via Set so re-runs / multi-source overlaps don't accumulate
        // duplicate entries like "sec-edgar,sec-edgar,nasdaq-api".
        const existing = allTickers.get(key);
        const newSource = info.source || 'unknown';
        if (newSource) {
          const sources = new Set(
            (existing.source ? String(existing.source).split(',') : [])
              .map(s => s.trim())
              .filter(Boolean)
          );
          sources.add(newSource);
          existing.source = Array.from(sources).join(',');
        }
        // audit/fix (BUG 3 MEDIUM — first-source-wins lost sector/mcap): the
        // first-seen source won the row and the else-branch only unioned `source`.
        // So nasdaq-all (no sector, no mcap) beat nasdaq-api (has both) whenever it
        // merged first, silently dropping usable metadata. Backfill ONLY fields that
        // are still empty on the kept row — never overwrite a non-empty value.
        if ((existing.marketCap == null) && Number.isFinite(info.marketCap) && info.marketCap > 0) {
          existing.marketCap = info.marketCap;
        }
        if (!existing.sector && info.sector) existing.sector = info.sector;
        if (!existing.name && info.name) existing.name = info.name;
        if (!existing.exchange && info.exchange) existing.exchange = info.exchange;
      }
    }
  }

  // audit/fix (BUG HIGH — discovery-yield observability + fail-loud signal):
  // surface per-source yield so a partial degradation is visible even when the run
  // stays above the hard floor.
  const yieldSummary = DISCOVERY_SOURCE_NAMES
    .map(n => n + '=' + (discoveryYield[n] === -1 ? 'FAIL' : (discoveryYield[n] || 0)))
    .join(' ');
  console.log('  Discovery per-source yield: ' + yieldSummary +
    '  (non-empty sources: ' + nonEmptySources + '/' + DISCOVERY_SOURCE_NAMES.length +
    ', total raw candidates: ' + totalDiscoveryCandidates + ')');

  // audit/fix (BUG HIGH — fail-loud on silent total-discovery-outage):
  // because all six sources return an empty Map() rather than rejecting, a day when
  // SEC(403)+NASDAQ-trader+OTC+Yahoo-screener all fail looks GREEN: the additive merge
  // re-writes the existing ~15,734-row watchlist verbatim, the round-1 size-floor
  // (stocks.length < 200) is a no-op, and CI "Watchlist Sanity" (>=200) + the
  // continue-on-error refresh step never notice that ZERO new tickers entered.
  // Thresholds (justified):
  //   MIN_NONEMPTY_SOURCES = 2 — on a healthy day all six contribute; 6 of 6 are
  //     written to swallow their own errors, so requiring >=2 non-empty catches the
  //     systemic-outage case (shared rate-limit / network / CI-IP-block) while
  //     tolerating 1-2 independent source flakes that the additive merge survives fine.
  //   MIN_DISCOVERY_CANDIDATES = 1000 — a single healthy source (NASDAQ-Trader alone
  //     is ~7k–8k US commons) clears this comfortably; the existing universe is
  //     ~15,734, so 1000 raw candidates is a deliberately conservative floor that only
  //     trips on a near-total discovery collapse, not on normal day-to-day variance.
  // exit(1) is intentional even though the CI step is continue-on-error: it won't abort
  // the daily pull, but it flips the step to FAILED and writes a ::error:: annotation —
  // turning a silent green into a visible degraded-discovery signal in the run log.
  const MIN_NONEMPTY_SOURCES = parseInt(process.env.MIN_DISCOVERY_SOURCES || '2', 10);
  const MIN_DISCOVERY_CANDIDATES = parseInt(process.env.MIN_DISCOVERY_CANDIDATES || '1000', 10);
  if (nonEmptySources < MIN_NONEMPTY_SOURCES || totalDiscoveryCandidates < MIN_DISCOVERY_CANDIDATES) {
    console.error('::error::Degraded discovery — only ' + nonEmptySources + '/' +
      DISCOVERY_SOURCE_NAMES.length + ' sources returned data (' + totalDiscoveryCandidates +
      ' raw candidates; floors: >=' + MIN_NONEMPTY_SOURCES + ' sources, >=' +
      MIN_DISCOVERY_CANDIDATES + ' candidates). Per-source: ' + yieldSummary +
      '. The additive merge silently re-writes the existing universe unchanged — ' +
      'no new tickers entered. Likely SEC/NASDAQ-trader/OTC/Yahoo-screener outage or CI-IP block.');
    process.exit(1);
  }

  // Tag 147: Hard-cap universe by marketCap rank. Finnhub/SEC/NASDAQ/OTC add tickers
  // without mcap filter — without this cap the universe can explode to 25k+, causing
  // Node OOM and Yahoo rate-limiting in pull-yahoo.js.
  // Tag 165: cap raised from 10000 to 13000 to accommodate OTC + NASDAQ API additions.
  // Tag 227a (silent-cap audit): raised 13000 -> 25000. Today's watchlist is
  // already 15,734 — the 13k cap was effectively dropping every newly-IPO'd
  // ticker on the bottom rung since the cap was lower than the existing
  // universe size. Pull-yahoo's price-only fast-path (Tag 166) keeps the
  // per-run runtime tractable; the 20% null-mcap proportional split below
  // already prevents OOM by keeping low-confidence discoveries bounded.
  // Override via env MAX_UNIVERSE for tighter local-dev runs.
  // Marktkap-Vorpruefung (Karl-Sizing-Fix 2026-07-03): die Auslands-Vollregister (~25k) kommen mit
  // marketCap:null. Statt sie ALLE teuer zu pullen (10x Verschwendung, die meisten < $2B), hier VOR dem
  // Pull billig auf >= $2B USD filtern (Batch-Yahoo-quote, ~200/Aufruf, Minuten). Ueberlebende bekommen
  // ihre USD-mcap gesetzt (-> withMcap-Zweig unten, korrekt nach Groesse einsortiert); der Rest wird
  // verworfen. Fail-safe: bei Ausfall bleibt eine Zeile null-mcap und faellt in die bestehende Slot-Logik
  // zurueck (kein Regress). Ergebnis: Universum bleibt $2B+-schlank -> KEIN Pull-Sharding noetig.
  try {
    const foreignNull = [...allTickers.entries()].filter(([, v]) =>
      v && !v.marketCap && v.source && String(v.source).split(',').some((s) => FOREIGN_CANON_SET.has(s.trim())));
    if (foreignNull.length) {
      const keptUsd = await prefilterByMcap(foreignNull.map(([k]) => k));
      for (const [key, v] of foreignNull) {
        const usd = keptUsd.get(key);
        if (Number.isFinite(usd)) v.marketCap = usd;   // >= $2B: USD-mcap setzen -> withMcap-Zweig
        else allTickers.delete(key);                    // < $2B oder keine Antwort: verwerfen
      }
    }
  } catch (e) { console.warn('[refresh-universe] mcap-prefilter uebersprungen:', e.message); }

  // MAX_UNIVERSE: mit der Vorpruefung bleibt das Universum $2B+-schlank (US ~15,7k + Ausland-$2B ~4k +
  // Wachstum); 30000 gibt reichlich Headroom. Env-tunbar. Die Foreign-First-Slot-Quote unten schuetzt
  // etwaige nicht-bepreiste Rest-Null-mcap-Auslandszeilen (Netzwerk-Miss der Vorpruefung).
  const MAX_UNIVERSE = parseInt(process.env.MAX_UNIVERSE || '30000', 10);
  if (allTickers.size > MAX_UNIVERSE) {
    // F-DP-016: null-mcap tickers (often intentional small-cap additions) were previously
    // sorted to the bottom and silently dropped first. Fix: segregate null-mcap tickers and
    // keep a proportional share of them alongside known-mcap tickers.
    const withMcap    = [...allTickers.entries()].filter(([, v]) => v.marketCap != null && v.marketCap > 0);
    const withoutMcap = [...allTickers.entries()].filter(([, v]) => !v.marketCap);

    // Sort known-mcap by descending mcap
    withMcap.sort((a, b) => b[1].marketCap - a[1].marketCap);

    // Foreign-slot protection (Team-A infra): foreign-exchange discoveries
    // (EDINET/FinMind/OpenDART/SSE/SZSE/HKEX) arrive with marketCap:null and land in
    // the same null-mcap bucket as the huge US-OTC mass. In raw discovery order the
    // OTC rows dominate, so a 20%-capped slice() would drop every foreign row before
    // it ever reached the watchlist. Fix: (1) STABLE-sort withoutMcap so foreign-source
    // rows come first (ties keep original discovery order — the sort is index-keyed),
    // and (2) reserve an exclusive foreign sub-quota that the OTC mass cannot consume.
    // The withMcap branch above is untouched — this only reorders/quotas the null bucket.
    // FIX-3 (Bau-Plan Welle 0): EINE Quelle der Wahrheit. Die alte 6-Token-Handliste war schon fuer
    // xetra/nordic/oslo/nse/lse/tsx/asx veraltet -> die bereits gebauten EU/CA/AU/IN-Adapter waren im
    // Cap-Block slot-UNGESCHUETZT (bei Yahoo-429 null-mcap wurden ihre Zeilen von der US-OTC-Masse
    // verdraengt = stiller vorbestehender Verlust). FOREIGN_CANON_SET (Z.84) haelt alle 13 Tokens; jeder
    // neue Adapter (inkl. tv-scanner per-Land-Token) ist automatisch geschuetzt, sobald sein Token in
    // FOREIGN_SOURCE_CANON steht.
    const FOREIGN_SOURCES = FOREIGN_CANON_SET;
    const isForeign = ([, v]) => {
      if (!v || !v.source) return false;
      return String(v.source).split(',').some(s => FOREIGN_SOURCES.has(s.trim()));
    };
    const FOREIGN_SUBQUOTA = parseInt(process.env.FOREIGN_NULLMCAP_SLOTS || '2000', 10);
    // Stable sort: decorate with original index, foreign-first, index tiebreak.
    const decorated = withoutMcap.map((e, i) => ({ e, i, f: isForeign(e) ? 0 : 1 }));
    decorated.sort((a, b) => (a.f - b.f) || (a.i - b.i));
    for (let j = 0; j < decorated.length; j++) withoutMcap[j] = decorated[j].e;

    // Proportional share: null-mcap entries get at most 20% of MAX_UNIVERSE slots
    const maxNullMcap    = Math.round(MAX_UNIVERSE * 0.20);
    const maxWithMcap    = MAX_UNIVERSE - Math.min(withoutMcap.length, maxNullMcap);
    const keptWithMcap   = withMcap.slice(0, maxWithMcap);
    // Total null-mcap slots available after mcap rows are placed. Guarantee at least
    // min(available, FOREIGN_SUBQUOTA, #foreign) go to foreign rows: because foreign rows
    // now sort first, a plain slice() already realizes that guarantee — but the subquota
    // is enforced explicitly so a future reorder can't silently starve foreign rows.
    const nullSlots      = MAX_UNIVERSE - keptWithMcap.length;
    const foreignCount   = decorated.reduce((n, d) => n + (d.f === 0 ? 1 : 0), 0);
    const foreignReserve = Math.min(FOREIGN_SUBQUOTA, foreignCount, nullSlots);
    const keptForeign    = withoutMcap.slice(0, foreignReserve);
    const remainingSlots = nullSlots - keptForeign.length;
    const keptOther      = withoutMcap.slice(foreignReserve, foreignReserve + remainingSlots);
    const keptNullMcap   = [...keptForeign, ...keptOther];

    const capped = new Map([...keptWithMcap, ...keptNullMcap]);
    console.log(`Universe-Cap: ${allTickers.size} -> ${capped.size} (top ${maxWithMcap} by mcap + ${keptNullMcap.length} null-mcap, of which ${keptForeign.length} foreign-reserved)`);
    allTickers.clear();
    for (const [k, v] of capped) allTickers.set(k, v);
  }

  // 2. No sector-exclude at universe level (Tag 132: modes filter sectors, not discovery)
  // Banks/REITs/Insurance are allowed for Quality-Compounder mode.
  // Tag 165: target raised to 12k+ with OTC + NASDAQ API sources
  console.log('Distinct candidates after all sources: ' + allTickers.size + ' (target: 12000+)');

  // 3. Identify new tickers
  const newTickers = [];
  for (const [sym, info] of allTickers) {
    if (!existing.has(sym)) newTickers.push(info);
  }
  console.log(`\nNew tickers: ${newTickers.length} (already-in: ${allTickers.size - newTickers.length})`);

  // audit/fix (A2 2026-06-26): do NOT early-return here on newTickers===0. The in-place
  // class-share repair below (the dot->dash fix for the ~24 BRK.A/BF.A/HEI.A-style rows that
  // pull-yahoo 404s daily) lives AFTER this point, so an early return on the common
  // steady-state run (nothing new discovered) left those rows permanently un-pullable. We now
  // flow through: the merge loop is a harmless no-op when newTickers is empty, the repair
  // always runs, and the final write is gated on (newTickers OR a repair) just below it.

  // Tag 228c: source-attribution summary. F-DP-015 (Tag 169) added source-
  // preservation through the merge pipeline, but a future regression that
  // silently drops `info.source` would land 100% of new tickers under
  // `auto-universe-refresh` without any other red flag (this happened in
  // the pre-Tag-169 watchlist — 10 858 entries with no source attribution
  // until the 2026-05-17 audit caught it). Log new-ticker counts per source
  // before write so any zero-count for a known source is immediately visible.
  const newBySource = {};
  for (const info of newTickers) {
    const src = info.source || 'auto-universe-refresh';
    newBySource[src] = (newBySource[src] || 0) + 1;
  }
  const srcSummary = Object.entries(newBySource).sort((a, b) => b[1] - a[1])
    .map(([s, n]) => `${s}=${n}`).join(' ');
  console.log('  new-ticker source attribution: ' + srcSummary);

  // 4. Merge into watchlist
  for (const info of newTickers) {
    // audit F-A-2026-06-21: skip any discovery-source entry without a ticker
    // so a ticker-less row can never reach the null-unsafe sort below and
    // freeze the whole universe refresh.
    if (!info.ticker) continue;
    // audit/fix (BUG HIGH — yahoo_symbol must be Yahoo's dash form): derive
    // yahoo_symbol via toYahooClassShare so a US class share gets the DASH form
    // Yahoo's API requires (BRK.B→BRK-B). info.ticker is already key-normalized to
    // dash above, but we re-apply against this row's own exchange/source to be
    // explicit and self-contained; foreign tickers pass through unchanged.
    const isUS = _looksUS(info.exchange, info.source);
    wlRaw.stocks.push({
      ticker: info.ticker,
      yahoo_symbol: toYahooClassShare(info.ticker, isUS),
      name: info.name || '',
      sector_hint: info.sector || '',
      exchange_hint: info.exchange || '',
      added_via: info.source || 'auto-universe-refresh',
      added_at: new Date().toISOString()
    });
  }
  // audit/fix (BUG HIGH — repair EXISTING dead rows + collapse dot/dash twins):
  // The live watchlist holds ~24 US class-share rows stored in DOT form (BRK.B,
  // BF.A, HEI.A, …) whose yahoo_symbol is ALSO the dot form → pull-yahoo 404s them
  // every day. Repair them in place, and where a dash twin already exists as a
  // separate row, collapse the pair into one (keep the dash/Yahoo-valid ticker,
  // backfill complementary metadata, drop the redundant dot row).
  //
  // SAFETY (no legitimate row may be dropped):
  //   - A row is only ever REMOVED if it is a genuine US class-share DOT row
  //     (_looksUS AND /^[A-Z]{1,5}\.[ABC]$/) whose dash twin is ALSO present.
  //     Foreign rows (.L/.T/.SW/…), single-listing US dots without a twin, and
  //     every dash row are untouched as rows.
  //   - The dot→dash repair of yahoo_symbol on a twin-less US class share keeps
  //     the row; only its yahoo_symbol changes (dot→dash) so it becomes pullable.
  let repaired = 0, collapsed = 0;
  {
    const dashIndex = new Map();   // dash ticker -> row (built over current stocks)
    for (const s of wlRaw.stocks) {
      if (s && s.ticker) dashIndex.set(String(s.ticker).toUpperCase(), s);
    }
    const dropSet = new Set();     // rows (object identity) to remove after collapse
    for (const s of wlRaw.stocks) {
      if (!s || !s.ticker) continue;
      const t = String(s.ticker).toUpperCase();
      const isUS = _looksUS(s.exchange_hint, s.added_via);
      const dash = toYahooClassShare(t, isUS);
      if (dash === t) {
        // not a US class-share dot (foreign / plain / dash already): still make
        // sure yahoo_symbol is at least populated, but never alter the ticker.
        if (!s.yahoo_symbol) s.yahoo_symbol = t;
        continue;
      }
      // genuine US class-share dot row.
      const twin = dashIndex.get(dash);
      if (twin && twin !== s) {
        // collapse: keep the dash twin, backfill any metadata it lacks from the
        // dot row, then drop the dot row. Twin's ticker is already Yahoo-valid.
        if (!twin.name && s.name) twin.name = s.name;
        if (!twin.sector_hint && s.sector_hint) twin.sector_hint = s.sector_hint;
        if (!twin.exchange_hint && s.exchange_hint) twin.exchange_hint = s.exchange_hint;
        if (!twin.isin && s.isin) twin.isin = s.isin;
        if (!twin.added_via && s.added_via) twin.added_via = s.added_via;
        twin.yahoo_symbol = dash;   // ensure the survivor is pullable
        dropSet.add(s);
        collapsed++;
      } else {
        // no twin yet → repair this row in place so it becomes pullable, and
        // promote the ticker itself to the Yahoo-valid dash form.
        s.ticker = dash;
        s.yahoo_symbol = dash;
        dashIndex.set(dash, s);
        repaired++;
      }
    }
    if (dropSet.size > 0) {
      wlRaw.stocks = wlRaw.stocks.filter(s => !dropSet.has(s));
    }
    console.log(`  Class-share repair: ${repaired} dot rows promoted to dash, ${collapsed} dot/dash twins collapsed.`);
  }

  // audit/fix (A2 2026-06-26): gate the write on an actual change. With the early-return
  // removed above, a run that discovered nothing new AND repaired nothing must still leave the
  // universe untouched (no needless rewrite / timestamp churn).
  if (newTickers.length === 0 && repaired === 0 && collapsed === 0) {
    console.log('Nothing to add, nothing to repair. Universe unchanged.');
    return;
  }

  // audit F-A-2026-06-21: null-safe sort key — a single null/undefined ticker
  // (from a pre-existing bad watchlist row) would throw on .localeCompare and
  // abort the refresh after the merge work was already done.
  wlRaw.stocks.sort((a, b) => (a.ticker || '').localeCompare(b.ticker || ''));
  wlRaw.lastUniverseRefresh = new Date().toISOString();

  // audit/fix: internal watchlist size-floor (was CI-only, post-write) — refuse to overwrite with a degenerate universe
  if (wlRaw.stocks.length < 200) {
    console.error(`::error::watchlist size ${wlRaw.stocks.length} < 200 — refusing to overwrite with a degenerate universe`);
    process.exit(1);
  }

  // F-SM-021 / F-DP-046 (Tag 189): watchlist.json is pull-yahoo's entry point;
  // a truncated mid-write here aborts the entire daily pull on parse-error
  // and recovery needs a git revert.
  writeFileAtomic(args.out, JSON.stringify(wlRaw, null, 2));
  console.log('\nWritten: ' + args.out);
  console.log('  total stocks: ' + wlRaw.stocks.length);
  console.log('  added this run: ' + newTickers.length);
  console.log('\nSample new tickers:');
  for (const t of newTickers.slice(0, 10)) {
    console.log(`  ${t.ticker.padEnd(8)} ${(t.sector || '').slice(0,20).padEnd(20)} $${(t.marketCap/1e9).toFixed(1)}B  ${(t.name || '').slice(0,40)}`);
  }
}

// audit/fix: export the class-share normalizer helpers so they can be unit-tested
// in isolation against the live watchlist (the require() below executes only the
// definitions, never main(), because main() is gated on require.main === module).
module.exports = { toYahooClassShare, _looksUS, dedupKey };

if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });

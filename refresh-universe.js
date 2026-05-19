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

async function _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchScreener(id, region) {
  region = region || 'US';
  try {
    const r = await yf.screener({ scrIds: id, count: 250, region: region });
    return (r && r.quotes) || [];
  } catch (e) {
    // F-DP-009 (Tag 233b): log screener failures so CI can detect Yahoo screener outages.
    // Previously silent [] returns masked 429s and schema breaks — universe shrank undetected.
    console.warn('  [WARN] fetchScreener [' + id + '/' + region + '] failed: ' + (e && e.message || String(e)));
    return [];
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
  const existing = new Set(wlRaw.stocks.map(s => s.ticker.toUpperCase()));
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
        if (!allTickers.has(sym) || (allTickers.get(sym).marketCap || 0) < mcap) {
          allTickers.set(sym, {
            ticker: sym,
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
        if (!allTickers.has(sym) || (allTickers.get(sym).marketCap || 0) < mcap) {
          allTickers.set(sym, {
            ticker: sym, marketCap: mcap,
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
  const discoverySources = await Promise.allSettled([
    fetchNasdaqAll(),
    fetchSecTickers(),
    fetchFinnhubUniverse(),
    fetchWikipediaIndices(),
    fetchOTCMarkets(),
    fetchNasdaqApiList()
  ]);
  for (const res of discoverySources) {
    if (res.status === 'rejected') { console.error('  Discovery source error: ' + res.reason); continue; }
    const srcMap = res.value;
    for (const [sym, info] of srcMap) {
      if (!allTickers.has(sym)) {
        allTickers.set(sym, {
          ticker: sym,
          // Tag 165: carry marketCap hint from NASDAQ API when available
          marketCap: info.marketCap || null,
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
        const existing = allTickers.get(sym);
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
      }
    }
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
  const MAX_UNIVERSE = parseInt(process.env.MAX_UNIVERSE || '25000', 10);
  if (allTickers.size > MAX_UNIVERSE) {
    // F-DP-016: null-mcap tickers (often intentional small-cap additions) were previously
    // sorted to the bottom and silently dropped first. Fix: segregate null-mcap tickers and
    // keep a proportional share of them alongside known-mcap tickers.
    const withMcap    = [...allTickers.entries()].filter(([, v]) => v.marketCap != null && v.marketCap > 0);
    const withoutMcap = [...allTickers.entries()].filter(([, v]) => !v.marketCap);

    // Sort known-mcap by descending mcap
    withMcap.sort((a, b) => b[1].marketCap - a[1].marketCap);

    // Proportional share: null-mcap entries get at most 20% of MAX_UNIVERSE slots
    const maxNullMcap    = Math.round(MAX_UNIVERSE * 0.20);
    const maxWithMcap    = MAX_UNIVERSE - Math.min(withoutMcap.length, maxNullMcap);
    const keptWithMcap   = withMcap.slice(0, maxWithMcap);
    const keptNullMcap   = withoutMcap.slice(0, MAX_UNIVERSE - keptWithMcap.length);

    const capped = new Map([...keptWithMcap, ...keptNullMcap]);
    console.log(`Universe-Cap: ${allTickers.size} -> ${capped.size} (top ${maxWithMcap} by mcap + ${keptNullMcap.length} null-mcap)`);
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

  if (newTickers.length === 0) {
    console.log('Nothing to add. Universe unchanged.');
    return;
  }

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
    wlRaw.stocks.push({
      ticker: info.ticker,
      yahoo_symbol: info.ticker,
      name: info.name || '',
      sector_hint: info.sector || '',
      exchange_hint: info.exchange || '',
      added_via: info.source || 'auto-universe-refresh',
      added_at: new Date().toISOString()
    });
  }
  wlRaw.stocks.sort((a, b) => a.ticker.localeCompare(b.ticker));
  wlRaw.lastUniverseRefresh = new Date().toISOString();

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

if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });

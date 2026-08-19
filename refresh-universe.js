#!/usr/bin/env node
/**
 * Tag 165 — Auto-Universum-Refresh
 * ==================================
 * Pullt Yahoo-Screener für Stocks $800M–$500B Mcap weltweit (F-11, 04.08.2026)
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
const { writeFileAtomic, writeJsonAtomic } = require('./lib/atomic-write.js');
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
const { isWhenIssuedSecurity }  = require('./discovery/when-issued.js');
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
// T562-M1: isUnpriceable trennt "Waehrung fehlt in fx-rates.json" von "kein bewertbares
// marketCap" — ohne diese Trennung sagt der Leerlauf-Alarm unten nur "nichts behalten".
const { prefilterByMcap, toUsd, isUnpriceable } = require('./discovery/mcap-prefilter.js');
// Bug 4: Yahoo liefert q.marketCap in der LISTING-Waehrung. Das $800M/$500B-Gate ist in USD
// definiert -> vor dem Vergleich mit toUsd() (fx-rates.json) konvertieren, sonst verschiebt
// der FX-Faktor das Fenster (JP akzeptiert ~$6M-$3B, KR ~$0.65M-$327M).
// BH-041: a missing/corrupt fx-rates.json used to fall back to {USD:1} — every non-USD
// marketCap then converts to null (toUsd), and downstream code conflated "unpriceable"
// with "priced and below threshold", deleting rows that were never actually evaluated.
// Track the load failure here; main() aborts on it before any data work instead of
// silently mispricing (or mass-deleting) every non-USD row.
let _fxRatesLoadFailed = false;
const _FX_RATES = (() => {
  try { return (JSON.parse(fs.readFileSync(path.join(__dirname, 'fx-rates.json'), 'utf8')).rates) || { USD: 1 }; }
  catch (_) { _fxRatesLoadFailed = true; return { USD: 1 }; }
})();
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

// BH-193: numeric env-var parser with fail-closed validation. Plain parseInt/parseFloat
// silently produces NaN (typo, e.g. MAX_UNIVERSE=foo) or a truncated number (silent
// truncation, e.g. '25o00' -> 25) on an operator mistake; every downstream numeric
// comparison against NaN evaluates false, so the floor/cap/gate it was meant to enforce
// just switches itself off instead of erroring. Number() (not parseInt) rejects the
// truncation case too. Aborts loud (::error:: + process.exit) instead of running with an
// unvalidated threshold.
function numEnv(name, defaultVal, opts) {
  opts = opts || {};
  const raw = process.env[name];
  if (raw == null || raw === '') return defaultVal;
  const n = Number(raw);
  if (!Number.isFinite(n) || (opts.min != null && n < opts.min) || (opts.max != null && n > opts.max)) {
    console.error('::error::Ungueltiger Wert fuer ' + name + '="' + raw + '" (erwartet endliche Zahl' +
      (opts.min != null ? ' >= ' + opts.min : '') + (opts.max != null ? ' <= ' + opts.max : '') +
      '). Abbruch vor jeder Datenarbeit statt stillem NaN-Deaktivieren des Gates.');
    process.exit(1);
  }
  return n;
}

// Yahoo-vordefinierte Screener (geographisch/thematisch breit)
// Liste keine Banken/REITs/Insurance — die fliegen sowieso im Modus-Filter raus,
// aber wir minimieren Pull-Last.
// Tag 116: Erweitert auf 13 Buckets (mehr Coverage)
const SCREENER_IDS = [
  'most_actives',                  // Volume-leaders weltweit
  'day_gainers',                   // momentum candidates
  'undervalued_growth_stocks',     // Quality-Value-Mix
  // T565-M3 (Messung 04.08.2026): der EINZIGE Bucket, der auch unter yahoo-finance2 3.15.4
  // tot bleibt — 3 von 3 Runden warfen einen oneOf-Schema-Fehler (die anderen 12 Buckets
  // lieferten nach dem Upgrade wieder Quotes). Also kein Zufallsausfall, sondern eine
  // Feld-Form, die das Schema der Bibliothek in DIESEM Bucket nicht kennt. Bleibt in der
  // Liste: er kostet nur einen Aufruf, und ein Heilen faellt so von selbst auf.
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

// ── Tag 576: Exchange-Kanal, gemessen neu aufgesetzt ──────────────────────────────
// Der Kanal (Tag 131) hat NIE gelaufen — nicht einen Tag: yahoo-finance2 kennt in
// ScreenerOptions kein `query`, der Aufruf warf deterministisch vor jedem Netzzugriff
// (Verifikation _BEFUND-EXCHANGE-KANAL-2026-08-04.md; Repro am IST in Tag 576 Commit).
// Der Umbau geht auf den rohen POST-Screener; drei Messbefunde aus der CI-Probe
// (Laeufe 30868618833 / 30869012795 / 30869143397, alle vom GitHub-Runner) tragen die
// Liste hier — nichts davon ist geschaetzt:
//
// (1) VIER DER 29 CODES WAREN TOT und lieferten auch am funktionierenden Endpunkt 0:
//     TYO -> richtig JPX · NIM -> richtig NCM · SWX -> richtig EBS · SGX -> richtig SES.
//     Dazu ein fuenfter, schwererer Fehler: `KOE` ist KOSDAQ (gemessen 69 Firmen),
//     NICHT "Korea". Der koreanische Grossmarkt liegt unter KSC (KOSPI, 236) — Samsung,
//     SK Hynix und der Rest fehlten dem Kanal also selbst dann, wenn er gelaufen waere.
//     Und `BSE` (Bombay, 675) trug den Kommentar "Bombay/NSE India", obwohl NSE eine
//     eigene Boerse mit eigenem Code ist (NSI, 661).
//
// (2) YAHOOS SERVERSEITIGER `intradaymarketcap`-FILTER RECHNET IN LISTING-WAEHRUNG,
//     nicht in USD. Beleg: mit dem USD-Literal 800e6..500e9 lieferte JPX exakt den
//     USD-Bereich 487M..3,2 Mrd — 500e9 JPY SIND $3,2 Mrd, der Deckel traf punktgenau.
//     Bei KOE war der Deckel 500e9 KRW = $362M, also lag die GESAMTE koreanische
//     Ausbeute oberhalb des Deckels. Dieselbe Falle hat discovery/tv-scanner.js schon
//     geloest ("sonst waere right:2e9 nur 2 Mrd LOKAL"). Deshalb traegt jede Zeile hier
//     ihre Listing-Waehrung; die Schranken werden je Boerse umgerechnet.
//
// (3) ZWEITLISTUNGEN VERDRAENGEN im 25.000er-Cap. Gemessen als Anteil der Zeilen, deren
//     Berichtswaehrung von der Notierungswaehrung abweicht oder die Yahoo als
//     `market: dr_market` (Hinterlegungsschein) fuehrt — das Aequivalent zum
//     domicile/subtype-Filter in tv-scanner.js. Frankfurt: 100,0 % von 6185 Zeilen,
//     also 6185 Cap-Slots fuer NULL neue Firmen. Mexiko 89,8 %, Hongkong 79,5 %,
//     Sao Paulo 77,1 %, Mailand 69,0 %, London 67,2 %, Oslo 54,5 %.
//     AUFGENOMMEN wird nur, wessen gemessener Anteil <= 25 % liegt. Die Ausgeschlossenen
//     sind samt und sonders schon durch einen eigenen Adapter gedeckt (xetra/FRA,
//     lse-uk/LSE, hkex-hk/HKG, tsx-ca/TOR, oslo/OSL, tv-milan, tv-brazil, tv-mexico,
//     tv-swiss, tv-singapore, tv-rsa) — es geht nichts verloren ausser der Bequemlichkeit,
//     die Marktkapitalisierung gratis mitgeliefert zu bekommen.
//
// `boden` = Abnahme-Untergrenze fuer totalBandOk je Boerse: die HALBE Erstlauf-Ausbeute
// aus der Probe (Zeilen im USD-Band NACH dem Zweitlistungs-Filter). Bewusst nicht an
// Neuzugaengen gemessen — die gehen im eingeschwungenen Betrieb korrekt gegen null,
// ein Boden darauf waere ab Tag zwei ein Dauer-Falschalarm.
const EXCHANGE_KANAELE = [
  // code   ccy    zweit%  erstlauf  boden   Boerse
  { code: 'NYQ', ccy: 'USD', zweit: 0.100, erstlauf: 1439, boden: 719 },  // NYSE
  { code: 'SHZ', ccy: 'CNY', zweit: 0.007, erstlauf: 1429, boden: 714 },  // Shenzhen
  { code: 'SHH', ccy: 'CNY', zweit: 0.004, erstlauf: 1387, boden: 693 },  // Shanghai
  { code: 'NMS', ccy: 'USD', zweit: 0.048, erstlauf:  867, boden: 433 },  // NASDAQ Global Select
  { code: 'JPX', ccy: 'JPY', zweit: 0.002, erstlauf:  851, boden: 425 },  // Tokio (war faelschlich TYO)
  { code: 'BSE', ccy: 'INR', zweit: 0.003, erstlauf:  673, boden: 336 },  // Bombay
  { code: 'NSI', ccy: 'INR', zweit: 0.003, erstlauf:  659, boden: 329 },  // NSE Indien (fehlte ganz)
  { code: 'TAI', ccy: 'TWD', zweit: 0.010, erstlauf:  278, boden: 139 },  // Taiwan
  { code: 'KSC', ccy: 'KRW', zweit: 0.004, erstlauf:  233, boden: 116 },  // KOSPI (fehlte ganz)
  { code: 'ASX', ccy: 'AUD', zweit: 0.243, erstlauf:  201, boden: 100 },  // Australien
  { code: 'STO', ccy: 'SEK', zweit: 0.129, erstlauf:  175, boden:  87 },  // Stockholm
  { code: 'PAR', ccy: 'EUR', zweit: 0.043, erstlauf:  166, boden:  83 },  // Paris
  { code: 'NGM', ccy: 'USD', zweit: 0.045, erstlauf:  147, boden:  73 },  // NASDAQ Global Market
  { code: 'NCM', ccy: 'USD', zweit: 0.063, erstlauf:  104, boden:  52 },  // NASDAQ Capital Market (war faelschlich NIM)
  { code: 'SAU', ccy: 'SAR', zweit: 0.010, erstlauf:   98, boden:  49 },  // Tadawul
  { code: 'KOE', ccy: 'KRW', zweit: 0.000, erstlauf:   69, boden:  34 },  // KOSDAQ
  { code: 'AMS', ccy: 'EUR', zweit: 0.131, erstlauf:   53, boden:  26 },  // Amsterdam
  { code: 'HEL', ccy: 'EUR', zweit: 0.087, erstlauf:   42, boden:  21 },  // Helsinki
  { code: 'ASE', ccy: 'USD', zweit: 0.119, erstlauf:   29, boden:  14 },  // NYSE American
];
// AUSGESCHLOSSEN (gemessener Zweitlistungs-Anteil > 25 %, je mit eigenem Adapter gedeckt):
//   FRA 100,0 % · JNB 100,0 % · MEX 89,8 % · HKG 79,5 % · SAO 77,1 % · MIL 69,0 %
//   LSE 67,2 % · OSL 54,5 % · SES 37,1 % · EBS 35,9 % · TOR 35,3 % · CPH 27,5 %
const EXCHANGE_CODES = EXCHANGE_KANAELE.map((k) => k.code);
// Summe der Erstlauf-Ausbeute: 8900 Zeilen ueber 47 Seiten. Zum Vergleich der Anspruch
// von Tag 131 ("10k+ statt ~3500") — erreicht wird er ohne die Zweitlistungs-Flut.

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
// BH-039: SCREENER_IDS deliberately includes fund/bond buckets (solid_large_growth_funds,
// solid_midcap_growth_funds, conservative_foreign_funds, high_yield_bond) whose results are
// ETF/MUTUALFUND/BOND rows, not equities — this is an equity universe. The exchange-code
// screener has no security-type constraint of its own either. Fail-open on a missing field
// (bulk screener responses aren't guaranteed to carry it) but reject an explicit non-EQUITY
// type, mirroring the R1 rule in scripts/probe-smallcap-coverage.js. Shared by both intake
// loops so the policy lives in one place.
function _isNonEquityQuote(q) {
  return !!(q && q.quoteType && q.quoteType !== 'EQUITY');
}
// T567-W3 (Konvergenz-Check Tag 567): alle Verwerfungen VOR dem Mcap-Gate an einer Stelle.
// Beide Ingest-Schleifen fuhren dieselben fuenf continue-Zeilen (Tag 221 Junk-Suffixe +
// BH-039 Nicht-Equity) doppelt — und keine davon war gezaehlt. Fuer kanalLeerlaufAlarm ist
// das der Unterschied zwischen "am Groessen-Gate ist alles verworfen worden" und "es kam nie
// eine Zeile am Gate an": die vier bewusst nicht-Equity-Buckets (solid_*_funds,
// conservative_foreign_funds, high_yield_bond) koennen einen Bucket komplett vor dem Gate
// leeren, und der Alarm behauptete dann eine FX-/Band-Ursache, die es nie gab.
// Tag 221 (audit Tag 221a): Junk-Suffixe. NASDAQ-Trader und manche Yahoo-Screener-Antworten
// liefern Vorzugsaktien-Varianten (ABR$D, ACP$A — 375 Stueck in der Pre-Tag-221-Watchlist),
// die Yahoos quoteSummary nicht kennt; sie kosten taeglich Rate-Limit-Budget fuer nichts.
// Deshalb schon in der Entdeckung raus, damit sie nie in die Watchlist kommen.
function _vorGateVerworfen(q) {
  if (!q || !q.symbol) return true;
  const sym = String(q.symbol).toUpperCase();
  if (isWhenIssuedSecurity(q.longName || q.shortName || '')) return true;
  if (/[$]/.test(sym)) return true;        // preferred-stock variants
  if (/[/\\\s]/.test(sym)) return true;    // path-separators or whitespace = corrupt
  if (sym.length > 12) return true;        // longer than any real ticker — likely a name
  return _isNonEquityQuote(q);             // BH-039: explizite Nicht-Equity-Zeilen
}
// BH-038: yahoo-finance2 v3.14's screener() schema accepts only {scrIds}; the query-based
// exchange-screener call throws this message deterministically, before any network I/O, on
// every single exchange — a permanent config incompatibility, not a transient per-exchange
// outage. Named/exported so the classification itself is unit-testable.
const EXCHANGE_SCREENER_SCHEMA_ERROR_RE = /invalid options|invalidoptions|additionalproperties|scrids/i;
// T569-F3 (Review Tag 569): die Regel oben ist die RETRY-Frage ("noch 28 Boersen probieren?")
// und bleibt bewusst breit. Fuer die ROT-Frage war sie zu breit: unter EXCHANGE_KANAL_BEKANNT_
// DEFEKT lief damit JEDER kuenftige Schema-Bruch dieses Kanals als "bekannter Dauerdefekt"
// still mit. Der bekannte Fall ist eng belegbar — yahoo-finance2 3.15.4 nennt in seiner
// Invalid-options-Meldung woertlich das verbotene Zusatzfeld `query` (eigene Messung 04.08.
// gegen die installierte Version: additionalProperties -> {"query": …}). Fehlt `query`, ist es
// ein ANDERER Bruch und der Lauf wird wieder rot.
const EXCHANGE_SCHEMA_QUERY_RE = /\bquery\b/i;
function exchangeDefektIstDerBekannte(fehler) {
  const m = String(fehler == null ? '' : fehler);
  return EXCHANGE_SCREENER_SCHEMA_ERROR_RE.test(m) && EXCHANGE_SCHEMA_QUERY_RE.test(m);
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
// Liefert ALLE Stocks je Exchange die $800M-$500B Mcap haben — nicht nur curated Listen (F-11).
//
// F-DP-037 (Tag 190): vorher schluckte der catch-Branch jede Yahoo-screener-Fehlermeldung
// silent → wenn LSE/SHA/HKG einen 429 / Schema-Break hatten, fiel die exchange einfach raus
// und coverage-gate maß gegen das geschrumpfte Universum, ohne Alarm. Jetzt:
//   - return value ist {quotes, error}
//   - 429-Antwort triggert ein retry-with-backoff (max 3 attempts)
//   - error wird vom Caller geloggt & in den per-exchange-Stats summiert
// Tag 576: der Aufruf geht ueber yf._fetch statt ueber yf.screener(). Das ist die
// gesamte Reparatur — Cookie-Beschaffung, Crumb, Drossel-Warteschlange und
// Fehlerklassifikation liegen damit weiter in der Bibliothek und nicht in dieser Datei.
// yf._fetch(urlBase, params, moduleOpts, func, needsCrumb) haengt die params als
// Query-String an, uebernimmt moduleOpts.fetchOptions in den fetch-Aufruf (also Methode
// POST und den JSON-Rumpf) und wirft bei Yahoo-Fehlerobjekten bzw. non-200 von selbst.
// `${YF_QUERY_HOST}` ist eine Platzhalter-Variable der Bibliothek (substituteVariables),
// KEIN Template-Literal — die einfachen Anfuehrungszeichen sind hier Absicht.
//
// FALLBACK, falls yf._fetch je verschwindet (die Funktion ist nicht Teil der oeffentlichen
// API; tests/refresh-universe.test.js haelt deshalb einen Guard darauf): der Weg ohne
// Bibliothek waere ein roher https-POST mit eigenem Crumb-Vorlauf. Er ist aber NICHT die
// "~40 Zeilen", als die er im Befund veranschlagt war — die CI-Probe hat ihn gemessen:
// Cookie von finance.yahoo.com/quote/AAPL holen und damit /v1/test/getcrumb rufen
// antwortet vom GitHub-Runner mit HTTP 429. Was fehlt, ist der vollstaendige
// GUCE-Consent-Durchlauf (guce.yahoo.com -> collectConsent -> Formular-POST -> copyConsent
// -> Redirect zurueck), den getCrumb.js der Bibliothek ueber ~120 Zeilen abwickelt. Wer
// diesen Fallback baut, baut also diesen Consent-Fluss nach, nicht einen POST.
const EXCHANGE_SCREENER_URL = 'https://${YF_QUERY_HOST}/v1/finance/screener';
const EXCHANGE_SEITE = 250;

// ── T576 Deadline-Guard fuer den Exchange-Block ───────────────────────────────────
// HERLEITUNG (keine Magic Number), gerechnet gegen die beiden Budgets, die es schon gibt:
//
//   Schritt "Refresh Universe" in .github/workflows/daily-pull.yml: timeout-minutes: 20
//                                                                    = 1200 s
//   davon belegt (Tag 575, discovery/zeitbudget.js):
//     otc-markets  300 s Budget + 30 s Socket-Timeout-Ueberstand  =  330 s
//     nasdaq-api   300 s Budget + 45 s Socket-Timeout-Ueberstand  =  345 s
//     (die Ueberstaende sind der R575-3-Befund: mitBudget prueft VOR einem Versuch und
//      kann einen laufenden nicht abschneiden)
//     Predefined-Yahoo-Kanal, gemessen im Lauf 91606250192 am 03.08.       =  104 s
//   Exchange-Kanal NEU                                                     =  240 s
//   ------------------------------------------------------------------------------
//   Summe im pessimistischsten Fall (alle Decken gleichzeitig ausgereizt)  = 1019 s
//   Reserve bis zum Schritt-Timeout fuer Mcap-Prefilter, Dedup, Cap, Schreiben = 181 s
//
// Diese Summe ist ABSICHTLICH pessimistisch: die beiden Adapter laufen in
// Promise.allSettled parallel, der Wanduhr-Fall ist also max(330, 345) = 345 s statt 675 s.
// Real bleiben damit 1200 - 345 - 104 - 240 = 511 s Reserve. Selbst die pessimistische
// Rechnung traegt — das ist der Punkt der Herleitung.
//
// Warum 240 s reichen: die CI-Probe (Lauf 30869143397) hat die 19 Boersen dieses Kanals
// voll durchpaginiert — 47 Seiten, gemessen 200-620 ms je Seite. Mit den 400 ms Pause
// zwischen zwei Seiten derselben Boerse ergibt das rund 35 s. Das Budget ist also das
// ~7-Fache des gemessenen Bedarfs und greift erst, wenn Yahoo klemmt.
const EXCHANGE_BUDGET_MS = numEnv('EXCHANGE_BUDGET_MS', 240000, { min: 1000 });

// Abnahme-Messung (T576): jede Boerse gegen ihre Erstlauf-Untergrenze. Gemessen wird
// totalBandOk — die Zeilen, die das USD-Band und den Zweitlistungs-Filter ueberlebt haben.
// AUSDRUECKLICH NICHT Neuzugaenge: die gehen im eingeschwungenen Betrieb korrekt gegen
// null (das Universum kennt die Namen dann schon), ein Boden darauf waere ab dem zweiten
// Tag ein Dauer-Falschalarm — und ein Dauer-Falschalarm ist genau der Zustand, aus dem
// dieser Kanal gerade herausgeholt wird. Reine Funktion, damit sie ohne Netz pruefbar ist.
function boersenUnterBoden(exchangeStats, kanaele) {
  const unter = [];
  for (const k of kanaele || []) {
    const s = (exchangeStats || {})[k.code];
    const ist = s && Number.isFinite(s.totalBandOk) ? s.totalBandOk : 0;
    if (ist < k.boden) unter.push({ code: k.code, ist: ist, boden: k.boden, erstlauf: k.erstlauf });
  }
  return unter;
}

// Review-Befund 1 ueber Tag 579: die Nachsicht fuer ein gerissenes Zeitbudget gilt JE BOERSE.
// Vorher entschied ein prozessweites Bool — riss das Budget bei IRGENDEINER Boerse, wurde der
// Alarm fuer ALLE heruntergestuft, auch fuer die, die Minuten vorher vollstaendig durchgelaufen
// waren. Ein echter Einbruch auf NYQ waere still geblieben, weil zufaellig ASE am Ende der
// Liste abgeschnitten wurde. Reine Funktion, damit genau diese Trennung ohne main() pruefbar
// ist — als Quelltext-Pin war sie es nicht (die Ausbau-Probe hat den Pin ausgetrickst).
function abnahmeUrteil(unterBoden, budgetOpfer) {
  const opfer = budgetOpfer instanceof Set ? budgetOpfer : new Set(budgetOpfer || []);
  return {
    echt: (unterBoden || []).filter((u) => !opfer.has(u.code)),
    budgetErklaert: (unterBoden || []).filter((u) => opfer.has(u.code)),
  };
}

// Der Crumb-Vorlauf muss EINMAL ueber einen normalen Bibliotheks-Aufruf laufen, bevor der
// erste POST rausgeht. Grund, an der Quelle nachgelesen (yahooFinanceFetch.js): die
// Bibliothek baut `fetchOptionsBase` inklusive moduleOpts.fetchOptions und reicht es an
// getCrumb WEITER. Ein POST-fetchOptions-Objekt geht damit an die HTML-Seite
// finance.yahoo.com/quote/AAPL, die darauf ohne set-cookie antwortet — getCrumb wirft,
// bevor der Screener ueberhaupt drankommt. Gemessen im ersten CI-Probelauf (30868439516):
// 20 von 20 Boersen tot mit "No set-cookie header present in Yahoo's response".
// Nach dem Vorwaermen liefert getCrumb den zwischengespeicherten Crumb zurueck, OHNE noch
// einmal zu fetchen — der Leck-Pfad ist dann gar nicht mehr erreichbar.
//
// ponytail: BEKANNTE DECKE (Review-Befund 3 ueber Tag 579, an der Quelle nachgelesen):
// Ein einmal abgelaufener Crumb laesst sich INNERHALB dieses Prozesses NICHT erneuern.
// getCrumb.js haelt `crumb` UND das laufende `promise` modulglobal und setzt das promise
// ausschliesslich im .catch zurueck — nach einem erfolgreichen Abruf liefert jeder weitere
// getCrumb-Aufruf dasselbe memoisierte Promise, unabhaengig von Cookie-Jar oder Instanz.
// Ein erneutes crumbVorwaermen() waere also ein Heilungs-Pfad, der nur so AUSSIEHT (genau
// die Klasse Fehler, gegen die dieser ganze Umbau gebaut ist) — deshalb gibt es ihn nicht.
// Was stattdessen passiert: der Fehler gilt als transient, wird dreimal wiederholt, und
// bleibt er, faellt die betroffene Boerse mit gezaehltem Seitenfehler aus. Die
// Abnahme-Messung unten faerbt den Lauf dann rot. Das ist die richtige Lautstaerke — die
// Watchlist von gestern bleibt gueltig, der naechste Lauf hat einen frischen Prozess.
// UPGRADE-PFAD, falls das je oefter vorkommt: getCrumb.js exportiert getCrumbClear(jar),
// das beide Modul-Variablen zuruecksetzt. Es steht nicht in den package-exports, waere also
// ein gezielter Griff nach node_modules-Interna — bewusst nicht gemacht, solange der
// Kanal 35 s laeuft und ein Crumb Stunden haelt.
let _crumbVorgewaermt = false;
async function crumbVorwaermen() {
  if (_crumbVorgewaermt) return;
  await yf.quote('AAPL');          // needsCrumb:true, fuellt Cookie-Jar + Crumb-Cache
  _crumbVorgewaermt = true;
}

// Vertragsbrueche gelten fuer ALLE Boersen gleich und beenden den Kanal; alles Transiente
// wird per Boerse wiederholt. Der Unterschied ist der Grund, warum es zwei Klassen gibt:
// 29 Boersen nacheinander gegen einen kaputten Vertrag laufen zu lassen kostet Zeit und
// erzeugt 29-mal dieselbe Meldung.
const EXCHANGE_FATAL_STATUS = new Set([400, 401, 403, 404, 405, 410, 422]);
const EXCHANGE_VERTRAGSBRUCH_RE = /\b(bad request|unauthorized|forbidden|not found|method not allowed|unprocessable)\b/i;
// Transiente Klassen: Drossel, Netz, und der abgelaufene Crumb (pull-yahoo.js fuehrt
// "Invalid Crumb" seit langem als transiente auth-Klasse — dieselbe Einstufung hier).
const EXCHANGE_TRANSIENT_RE = /429|too many requests|rate limit|invalid crumb|no set-cookie|etimedout|econnreset|econnrefused|socket hang up|network|fetch failed|\b5\d\d\b/i;
function exchangeFehlerIstFatal(meldung, httpStatus) {
  const m = String(meldung == null ? '' : meldung);
  // REIHENFOLGE IST TRAGEND (Review-Befund 2 ueber Tag 579): die Transient-Pruefung steht
  // VOR der Status-Pruefung, sonst gilt die dokumentierte Regel "transient schlaegt
  // Vertragsbruch" nur auf dem Papier. Der belegte Schadensfall: yahooFinanceFetch.js setzt
  // error.code = response.status fuer JEDE non-200-Antwort, also auch fuer den 401, mit dem
  // Yahoo einen rotierten Crumb quittiert. Stand die Status-Pruefung zuerst, brach eine
  // gewoehnliche, selbstheilende Crumb-Rotation den GESAMTEN 19-Boersen-Kanal ab
  // (exchangeScreenerFatal -> break) und faerbte den Tag rot. Gemessen:
  //   exchangeFehlerIstFatal('Invalid Crumb', 401) === true
  //   exchangeFehlerIstTransient('Invalid Crumb', 401) === true   <- Widerspruch
  // Jetzt gewinnt der Text: ein 401, der von Crumb/Cookie spricht, ist transient; ein 401
  // ohne diesen Text bleibt Vertragsbruch.
  if (EXCHANGE_TRANSIENT_RE.test(m)) return false;
  if (EXCHANGE_FATAL_STATUS.has(Number(httpStatus))) return true;
  if (EXCHANGE_VERTRAGSBRUCH_RE.test(m)) return true;
  // Und der ALTE Dauerdefekt: wer den Aufruf auf yf.screener() zurueckbaut, faellt wieder
  // in die Schema-Validierung der Bibliothek. Das bleibt fatal — und ab Tag 576 ROT,
  // weil EXCHANGE_KANAL_BEKANNT_DEFEKT nicht mehr traegt.
  return EXCHANGE_SCREENER_SCHEMA_ERROR_RE.test(m);
}
function exchangeFehlerIstTransient(meldung, httpStatus) {
  const s = Number(httpStatus);
  if (s === 429 || (s >= 500 && s < 600)) return true;
  return EXCHANGE_TRANSIENT_RE.test(String(meldung == null ? '' : meldung));
}

// Die USD-Schranken in die LISTING-Waehrung der Boerse umrechnen (Messbefund 2, siehe
// EXCHANGE_KANAELE). toUsd(1, ccy, rates) liefert den USD-Wert EINER Einheit und kennt
// dabei die Sub-Einheiten (GBp/ZAc) — die Umrechnung wird deshalb nicht nachgebaut,
// sondern ueber dieselbe Funktion gefuehrt, die spaeter auch das USD-Gate rechnet.
// Fehlt der Kurs, gibt es keine sinnvollen Schranken: null zurueck, der Aufrufer
// ueberspringt die Boerse LAUT statt sie mit falschen Grenzen abzufragen.
function lokaleSchranken(ccy, rates) {
  const kurs = toUsd(1, ccy, rates);
  if (!Number.isFinite(kurs) || kurs <= 0) return null;
  return { min: Math.floor(MIN_MCAP_DISCOVERY / kurs), max: Math.ceil(MAX_MCAP_DISCOVERY / kurs) };
}

// Zweitlistungs-Erkennung — das Aequivalent zum domicile/subtype-Filter in
// discovery/tv-scanner.js, gebaut auf die Felder, die der Yahoo-Screener tatsaechlich
// mitliefert (nachgesehen an einer echten Antwort, nicht geraten):
//   market === 'dr_market'   -> Hinterlegungsschein (Frankfurt: 6185 von 6185 Zeilen)
//   financialCurrency !== currency -> die Firma berichtet in einer anderen Waehrung als
//     der, in der sie hier notiert. Das ist der Trager-Fall fuer Mailand (1MA.MI =
//     Mastercard), Sao Paulo (D1DG34.SA = Datadog) und Mexiko (ZM.MX = Zoom), die Yahoo
//     alle als lokalen Markt fuehrt und die `market` deshalb NICHT faengt.
// Bewusste Fehlerrichtung: die Regel verwirft auch echte Lokal-Firmen, die in Fremdwaehrung
// bilanzieren (STMicroelectronics in Mailand berichtet in USD). Diese Faelle sind fast
// ausnahmslos zusaetzlich in den USA notiert und damit ueber die US-Quellen ohnehin im
// Universum — die Verwerfung kostet also nichts, waehrend die Gegenrichtung (Zweitlistung
// durchlassen) einen Cap-Slot fuer eine bereits bekannte Firma verbrennt.
function istZweitlistung(q) {
  if (!q) return false;
  if (q.market === 'dr_market') return true;
  return !!(q.currency && q.financialCurrency && q.currency !== q.financialCurrency);
}

async function fetchExchangePage(kanal, minLokal, maxLokal, offset, attempt) {
  attempt = attempt || 1;
  const MAX_ATTEMPTS = 3;
  try {
    await crumbVorwaermen();
    const rumpf = {
      size: EXCHANGE_SEITE,
      offset: offset || 0,
      sortField: 'intradaymarketcap',
      sortType: 'DESC',
      quoteType: 'EQUITY',
      query: {
        operator: 'AND',
        operands: [
          { operator: 'btwn', operands: ['intradaymarketcap', minLokal, maxLokal] },
          { operator: 'eq', operands: ['exchange', kanal.code] }
        ]
      },
      userId: '', userIdType: 'guid'
    };
    const antwort = await yf._fetch(
      EXCHANGE_SCREENER_URL,
      { lang: 'en-US', region: 'US', formatted: 'false' },
      { fetchOptions: { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(rumpf) } },
      'json', true);
    const r = antwort && antwort.finance && antwort.finance.result && antwort.finance.result[0];
    if (!r || !Array.isArray(r.quotes)) {
      // Antwortform gebrochen. NICHT als leere Seite durchwinken: genau so sieht ein
      // Schema-Wechsel aus, und genau so wuerde er still das Universum schrumpfen.
      return { quotes: [], total: null, error: 'Antwortform gebrochen: finance.result[0].quotes ist kein Array', fatal: true };
    }
    return { quotes: r.quotes, total: Number.isFinite(r.total) ? r.total : null, error: null };
  } catch (e) {
    const msg = String((e && e.message) || e);
    const status = e && e.code;
    if (exchangeFehlerIstTransient(msg, status) && attempt < MAX_ATTEMPTS) {
      // KEIN Zuruecksetzen von _crumbVorgewaermt: das waere ein Heilungs-Pfad, der nicht
      // heilt (Decke an crumbVorwaermen erklaert, warum). Wiederholt wird die ANFRAGE —
      // die haeufigen transienten Faelle (429, Netz-Aussetzer, 5xx) heilen genau dadurch.
      const backoffMs = 1000 * Math.pow(2, attempt);
      console.warn('  [' + kanal.code + '] transient (Versuch ' + attempt + '/' + MAX_ATTEMPTS +
        ', ' + msg.slice(0, 80) + ') — backoff ' + backoffMs + 'ms');
      await new Promise((r) => setTimeout(r, backoffMs));
      return fetchExchangePage(kanal, minLokal, maxLokal, offset, attempt + 1);
    }
    return { quotes: [], total: null, error: msg, httpStatus: status };
  }
}

async function fetchWithMcap(symbol) {
  try {
    const q = await yf.quote(symbol);
    return q;
  } catch (e) { return null; }
}

// FIX 1 (Karl-Audit univ-cap, 2026-07-18): dead-registry eviction MUST run before the
// MAX_UNIVERSE cap slices allTickers down. Previously the cap ran first, so a dead ticker
// could occupy a cap slot and only got deleted afterwards — the universe then ended up
// UNDER the cap even though live candidates were available. Extracted to a pure function
// (mutates the passed-in allTickers Map) so the order-sensitive logic is unit-testable
// without the full network/file main() flow. Cap math itself is UNCHANGED (F-DP-016 /
// Bug 27 foreign-slot logic) — only the ordering relative to dead-eviction moved.
function applyDeadRegistryAndCap(allTickers, deadRegistry, MAX_UNIVERSE) {
  // 0.12: dead-ticker eviction FIRST — before any cap slot accounting.
  let deadCandidatesBlocked = 0;
  for (const sym of [...allTickers.keys()]) {
    if (deadRegistry[String(sym).toUpperCase()]) { allTickers.delete(sym); deadCandidatesBlocked++; }
  }
  if (deadCandidatesBlocked) console.log('  Dead-Registry: ' + deadCandidatesBlocked + ' tote Kandidaten geblockt (0.12).');

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
    const FOREIGN_SUBQUOTA = numEnv('FOREIGN_NULLMCAP_SLOTS', 2000, { min: 0 }); // BH-193
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
    // Bug 27: der 20%-Deckel (maxNullMcap) wurde bisher nur zur RESERVIERUNG bei maxWithMcap
    // verrechnet, aber die Slot-VERGABE lief ungedeckelt ueber MAX_UNIVERSE - keptWithMcap.length.
    // Bei wenig withMcap (< maxWithMcap) konnten so null-mcap-Zeilen weit ueber 20% belegen
    // (Beispiel Befund: 67% statt 20%). Slots hart auf maxNullMcap deckeln.
    const nullSlots      = Math.min(MAX_UNIVERSE - keptWithMcap.length, maxNullMcap);
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
  return deadCandidatesBlocked;
}

// Tag 642: gibt jetzt die Liste der WEGEN DER SCHWELLE geloeschten Zeilen zurueck.
// WARUM: `allTickers.delete(eff)` war der stillste Pfad der ganzen Entdeckung — eine
// Auslandszeile verschwand ohne Grund, ohne Marktwert, ohne Ticker-Spur; die einzige
// Zahl war die Aggregat-Logzeile in mcap-prefilter.js. Karls Direktive "nichts
// verschwindet" ist auf Datenebene nur haltbar, wenn jeder Ausschluss seinen Beleg
// mitbringt. Rueckgabe statt Seiteneffekt, damit die Funktion pruefbar bleibt.
// Review-Befund zu Tag 642 (nicht atomar): die Loeschung passierte in der Schleife, die
// Rueckgabe erst am Ende. Wirft die Schleife in der Mitte, faengt der aeussere try/catch das
// ab — und das Protokoll behauptet "0 Ausschluesse", obwohl schon Ticker weg sind. Deshalb
// nimmt die Funktion das Protokoll-Array jetzt ENTGEGEN und fuellt es fortlaufend: was
// geloescht wurde, steht bereits drin, egal wo abgebrochen wird.
function applyForeignPrefilterOutcome(allTickers, foreignNull, result, verworfen) {
  const { kept: keptUsd, answered, renamed, unpriceable, belowUsd, nichtAktie } = result;
  if (!Array.isArray(verworfen)) verworfen = [];
  for (const [key, v] of foreignNull) {
    const eff = (renamed && renamed.get(key)) || key;
    if (eff !== key) {
      allTickers.delete(key);
      v.ticker = eff;
      allTickers.set(eff, v);
    }
    const usd = keptUsd.get(eff);
    if (Number.isFinite(usd)) v.marketCap = usd;
    else if (answered.has(eff) && !(unpriceable && unpriceable.has(eff))) {
      allTickers.delete(eff);
      const gemessen = belowUsd && belowUsd.get(eff);
      const istKeineAktie = !!(nichtAktie && nichtAktie.has(eff));
      verworfen.push({
        ticker: eff,
        quelle: (v && v.source) || null,
        land: (v && v.country) || null,
        // null heisst hier ehrlich "unbekannt" — nicht "0 Dollar".
        mcapUsd: Number.isFinite(gemessen) ? Math.round(gemessen) : null,
        // Drei verschiedene Gruende, die man nicht verwechseln darf:
        //   unter-schwelle  = Marktwert gemessen, liegt unter der Grenze (Groessen-Befund)
        //   kein-aktien-typ = Yahoo sagt Fonds/Vorzug/Warrant — kein Groessen-Befund
        //   ohne-marktwert  = beantwortet, aber kein brauchbarer Marktwert
        grund: Number.isFinite(gemessen) ? 'unter-schwelle'
          : (istKeineAktie ? 'kein-aktien-typ' : 'ohne-marktwert'),
      });
    }
  }
  return verworfen;
}

// Tag 642: das Ausschluss-Protokoll der Entdeckungs-Schicht als REINE Funktion (Zahlen
// rein, Objekt raus) — damit es ohne Netz und ohne main() pruefbar ist.
// Zwei Tore, beide sichtbar:
//   Tor 1 = discovery/tv-scanner.js  (Vorschnitt TV_PRECUT_USD, ~31 Maerkte)
//   Tor 2 = discovery/mcap-prefilter.js (MCAP_PREFILTER_MIN_USD, alle Auslandsquellen)
// Die Tore sind IN REIHE geschaltet: fuer die TV-Laender entscheidet Tor 1 zuerst, und
// was dort faellt, sieht Tor 2 nie. Wer nur eine der beiden Schwellen senkt, aendert
// fuer diese Laender nichts — genau darum stehen beide Schwellen in dieser Datei.
function baueAusschlussProtokoll(tvProtokoll, prefilterVerworfen, schwellen) {
  const tv = Array.isArray(tvProtokoll) ? tvProtokoll : [];
  const pf = Array.isArray(prefilterVerworfen) ? prefilterVerworfen : [];
  const jeQuelle = {};
  for (const r of pf) {
    const k = (r && r.quelle) || '(ohne Quelle)';
    const e = jeQuelle[k] || (jeQuelle[k] = {
      land: (r && r.land) || null, verworfen: 0, abAchthundertMio: 0,
      unterSchwelle: 0, keinAktienTyp: 0, ohneMarktwert: 0 });
    e.verworfen++;
    if (Number.isFinite(r && r.mcapUsd) && r.mcapUsd >= 800e6) e.abAchthundertMio++;
    const g = (r && r.grund) || 'ohne-marktwert';
    if (g === 'unter-schwelle') e.unterSchwelle++;
    else if (g === 'kein-aktien-typ') e.keinAktienTyp++;
    else e.ohneMarktwert++;
  }
  return {
    _doc: 'Ausschluss-Protokoll der Entdeckungs-Schicht (Tag 642). Wer wurde von welchem Tor ' +
      'mit welchem Marktwert verworfen. NICHT die Scoring-Ausschluesse aus outputs/<board>/index.json ' +
      '(die entstehen erst nach der Aufnahme, in src/scoring/router.js). Wird bei jedem Refresh ' +
      'ueberschrieben. abAchthundertMio = Zeilen, die bei einer 800-Mio-Untergrenze geblieben waeren.',
    erzeugtAm: new Date().toISOString(),
    schwellen: schwellen || {},
    tor1_tvScannerVorschnitt: {
      _doc: 'Der SERVER filtert bereits nach schwelleLokal — Namen darunter kommen nie ueber die ' +
        'Leitung und koennen hier nicht namentlich stehen. Beleg ist deshalb die wirksame Schwelle ' +
        'je Markt; unterSchwelle traegt nur den Client-Nachcut. truncated=true heisst: der ' +
        'Zeilendeckel TV_SCAN_RANGE hat zusaetzlich abgeschnitten (weiterer stiller Verlust).',
      maerkte: tv,
      summeUnterSchwelleClient: tv.reduce((n, m) => n + ((m && m.unterSchwelle && m.unterSchwelle.length) || 0), 0),
      truncierteMaerkte: tv.filter((m) => m && m.truncated).map((m) => m.markt),
    },
    tor2_mcapPrefilter: {
      _doc: 'Hier steht jede verworfene Zeile namentlich, weil ihr Marktwert gemessen vorlag.',
      jeQuelle,
      verworfen: pf,
      summe: pf.length,
    },
  };
}

// BH-040: applyDeadRegistryAndCap() only caps the raw discovery candidate map; existing
// watchlist rows never go through any cap at all, so the persisted union(existing,
// newTickers) could grow past MAX_UNIVERSE over time (only prune-watchlist ever shrinks
// it). Existing rows carry no marketCap (pull-yahoo.js fetches that separately and never
// writes it back into watchlist.json), so they can't be mcap-ranked for eviction without
// inventing a policy for data we don't have — instead cap ADMISSION of new tickers to the
// remaining MAX_UNIVERSE budget, reusing the exact same mcap/foreign-slot priority the
// candidate cap already applies. Pure function (list in, list out) — unit-testable
// without main()'s network/file flow.
function capNewTickerAdmission(newTickers, existingSize, maxUniverse) {
  const remainingBudget = maxUniverse - existingSize;
  if (newTickers.length <= remainingBudget) return newTickers;
  const budgetMap = new Map(newTickers.map(info => [info.ticker, info]));
  applyDeadRegistryAndCap(budgetMap, {}, Math.max(remainingBudget, 0));
  return newTickers.filter(info => budgetMap.has(info.ticker));
}

// Bug 17 (ADR-Dedup) als REINE Funktion, damit die Praesenz-Bedingung einzeln pruefbar ist:
// ADR-Zeile aus der persistierten Watchlist droppen, wenn die Heimat-Zeile vorhanden ist;
// komplementaere Metadaten vorher auf die Heimat-Zeile backfillen.
//
// R1-SK-012 (P0-Haertung 4, 09.08.2026): die Praesenz-Bedingung lautete
// `!!homeRow || allTickers.has(home) || existing.has(home)`. allTickers ist die
// KANDIDATEN-Map dieses Laufs und wird vom Persistenz-Cap (capNewTickerAdmission, kappt
// nur newTickers) NICHT beschnitten — eine vom Cap verworfene Heimatzeile galt damit als
// "present", die ADR-Zeile flog raus und die Heimat kam nie herein: die Firma verschwand
// still aus dem Universum. Praesenz kann nur EINES heissen: es gibt eine echte Zeile in
// der Liste, die gleich geschrieben wird. Deshalb sieht diese Funktion die Kandidaten-Map
// gar nicht mehr — der Fehler ist per Signatur nicht mehr formulierbar.
function repariereAdrBestand(stocks, adrPairs) {
  // Index der aktuellen Zeilen (nach Class-Share-Repair) nach Ticker.
  const rowIndex = new Map();
  for (const s of stocks) {
    if (s && s.ticker) rowIndex.set(String(s.ticker).toUpperCase(), s);
  }
  const adrDropSet = new Set();
  let dropped = 0;
  for (const [adr, home] of Object.entries(adrPairs || {})) {
    if (adr.startsWith('_')) continue; // _comment ueberspringen
    const adrKey = String(adr).toUpperCase();
    const homeKey = String(home).toUpperCase();
    const adrRow = rowIndex.get(adrKey);
    if (!adrRow) continue; // ADR nicht in der Watchlist -> nichts zu tun
    const homeRow = rowIndex.get(homeKey);
    if (!homeRow) continue; // Heimat nicht persistiert -> Firma nicht verlieren
    // Metadaten auf die Heimat-Watchlist-Zeile backfillen.
    if (homeRow !== adrRow) {
      if (!homeRow.name && adrRow.name) homeRow.name = adrRow.name;
      if (!homeRow.sector_hint && adrRow.sector_hint) homeRow.sector_hint = adrRow.sector_hint;
      if (!homeRow.isin && adrRow.isin) homeRow.isin = adrRow.isin;
    }
    adrDropSet.add(adrRow);
    dropped++;
  }
  return { stocks: adrDropSet.size > 0 ? stocks.filter(s => !adrDropSet.has(s)) : stocks, dropped };
}

// R1-SK-010 (P1-Welle 1, 09.08.2026): letzte Dublettenklasse neben Class-Share und ADR —
// zwei Zeilen mit VERSCHIEDENEM ticker, aber demselben yahoo_symbol. pull-yahoo zieht je
// Zeile ueber yahoo_symbol und legt die Snapshot-Datei unter TICKER ab: aus einer Abfrage
// entstehen zwei byte-gleiche Snapshots, derselbe Emittent steht zweimal im Board und zaehlt
// zweimal in jeder Kohorte/Perzentil-Basis. Live belegt: HRMS.PA und RMS.PA zeigten beide
// auf 'RMS.PA' (Hermes) — zwei identische Snapshots (178,8 Mrd., Consumer Cyclical).
// Es gibt keinen legitimen Fall: gleiche Quelle heisst zwangslaeufig gleiche Daten.
//
// Ueberleben darf die PULLBARE Identitaet (ticker === yahoo_symbol) — dieselbe Regel wie
// beim Class-Share-Collapse ("keep the dash/Yahoo-valid ticker"). Gibt es die nicht, bleibt
// die erste Zeile (stabil, reihenfolgetreu). Komplementaere Metadaten wandern vorher auf den
// Ueberlebenden, damit kein Wissen verloren geht.
function kollabiereYahooDubletten(stocks) {
  const nachSymbol = new Map();
  for (const s of stocks) {
    if (!s || !s.yahoo_symbol) continue;
    const k = String(s.yahoo_symbol).toUpperCase();
    if (!nachSymbol.has(k)) nachSymbol.set(k, []);
    nachSymbol.get(k).push(s);
  }
  const dropSet = new Set();
  let dropped = 0;
  for (const [sym, zeilen] of nachSymbol) {
    if (zeilen.length < 2) continue;
    const ueberlebt = zeilen.find((s) => String(s.ticker || '').toUpperCase() === sym) || zeilen[0];
    // "kein Name" heisst hier auch: der Name IST nur das Symbol (Platzhalter aus einem
    // Discovery-Kanal ohne Klarnamen). Sonst behielte der Ueberlebende den Platzhalter,
    // waehrend der Klarname mit der verworfenen Zeile verschwindet — pull-yahoo nutzt
    // watchlistEntry.name als Anzeige-Fallback, wenn Yahoo keinen longName liefert.
    const platzhalter = (s) => !s.name || String(s.name).toUpperCase() === String(s.ticker || '').toUpperCase()
      || String(s.name).toUpperCase() === sym;
    for (const s of zeilen) {
      if (s === ueberlebt) continue;
      if (platzhalter(ueberlebt) && !platzhalter(s)) ueberlebt.name = s.name;
      if (!ueberlebt.sector_hint && s.sector_hint) ueberlebt.sector_hint = s.sector_hint;
      if (!ueberlebt.exchange_hint && s.exchange_hint) ueberlebt.exchange_hint = s.exchange_hint;
      if (!ueberlebt.isin && s.isin) ueberlebt.isin = s.isin;
      dropSet.add(s);
      dropped++;
    }
  }
  return { stocks: dropSet.size > 0 ? stocks.filter((s) => !dropSet.has(s)) : stocks, dropped };
}

function entferneWhenIssuedBestand(stocks) {
  // Review-Fix (PR #43): fail-closed statt stillem []-Fallback. Ein wlRaw ohne
  // .stocks-Array (korrupte watchlist.json, falscher --watchlist-Pfad) lief sonst
  // als "leere Watchlist" weiter, Discovery fuellte tausende "neue" Ticker nach
  // und ueberschrieb den kuratierten Bestand — genau die BH-041-Bugklasse.
  if (!Array.isArray(stocks)) {
    throw new TypeError('watchlist.stocks ist kein Array — Abbruch statt stillem Weiterlauf mit leerer Watchlist (BH-041 fail-closed)');
  }
  const kept = stocks.filter((s) => !(s && isWhenIssuedSecurity(s.name || '')));
  return { stocks: kept, dropped: stocks.length - kept.length };
}

function sollUniverseSchreiben(delta) {
  // Review-Fix (PR #43): yahooDropped bewusst NICHT im Gate — vor diesem PR schrieb
  // ein reiner Yahoo-Dubletten-Lauf die Watchlist nicht ("Nothing to add..."), und
  // dieser PR aendert das Verhalten normaler Instrumente nicht (Invariante).
  return ['newTickers', 'repaired', 'collapsed', 'adrDropped', 'deadDropped', 'whenIssuedDropped']
    .some((key) => Number(delta && delta[key]) > 0);
}

// Tag 510: die Bedingung des Doppelausfall-Waechters als REINE Funktion, damit sie
// einzeln pruefbar ist (der Waechter selbst sitzt mitten in main() hinter Netzaufrufen).
// Wahr genau dann, wenn BEIDE Yahoo-Kanaele im selben Lauf nichts geliefert haben:
//   - Predefined-Screener: 0 nicht-leere Buckets
//   - Exchange-Screener:   Schema-Fehler (fatal) ODER 0 neue Tickers
// Der Exchange-Teil braucht BEIDE Formen: ein Schema-Bruch bricht die Schleife ab
// (customAdded bleibt 0), ein stiller Ausfall liefert 0 ohne Fehler. Wer nur auf
// exchangeScreenerFatal prueft, uebersieht den stillen Fall.
function beideYahooKanaeleLeer(predefinedNonEmpty, exchangeScreenerFatal, customAdded) {
  return predefinedNonEmpty === 0 && (exchangeScreenerFatal === true || customAdded === 0);
}

// DT-3 (Verifikation Exchange-Kanal 2026-08-04): die "0 Quotes und KEIN Fehler"-Warnung
// als reine Funktion — sie sass als Ausdruck mitten in main() hinter Netzaufrufen und war
// damit nur per Volllauf pruefbar. Genau das hat den Befund verdeckt: der Schema-Zweig
// zaehlte pageErrors nicht hoch, die Warnung nannte deshalb ausgerechnet die Boerse, die
// geworfen hatte, als "kein Fehler" (Lauf 91606250192: "... possible silent failure: NMS").
// Der Sinn der Warnung ist der STILLE Ausfall: 0 Quotes, obwohl nichts schiefging. Eine
// Boerse mit gezaehltem Fehler gehoert hier nie hinein — die meldet sich selbst.
function nullQuotenOhneFehler(exchangeStats) {
  return Object.entries(exchangeStats || {})
    .filter(([, s]) => s && s.totalQuotes === 0 && s.pageErrors === 0)
    .map(([e]) => e);
}

// T566-H2 (Review Tag 566): die BH-100-Wache sprach erst bei predefinedNonEmpty === 0 an.
// Genau die Bugklasse, die F-12-R2 (filter-snapshot-merge.js) eine Stufe frueher schon hatte:
// ein Ausfall, der "nur" die Haelfte erwischt, laeuft still durch. Real belegt am 04.08. an
// derselben 5er-Stichprobe: unter yahoo-finance2 3.14 waren 5/5 Aufrufe tot, unter 3.15.4
// noch 1/5 — ein Rueckfall auf z. B. 3.15.0 oder ein Yahoo-Feld-Wechsel, der nur einen Teil
// der Buckets zerlegt, landet also mitten zwischen "alles tot" und "gesund" und war bis hier
// unsichtbar. 0.30: der gesunde Stand liegt bei ~80 % nicht-leeren Buckets (4/5), die reale
// Bandbreite ueber Regionen/Buckets ist gross (kleine Regionen liefern legitim leere Buckets),
// aber unter einem Drittel ist kein Regions-Effekt mehr, sondern Bruch.
const MIN_PREDEFINED_NONEMPTY_ANTEIL = 0.30;

// T566-H2, zweite Haelfte: der Exit-Code dieses Skripts bekommt mit Tag 569 einen HARTEN
// Konsumenten (daily-pull.yml, Job "entdeckungs-waechter" -> rotes X). Damit dieser Konsument
// etwas aussagt, darf kein DAUERZUSTAND ihn setzen. Genau das tut aber der Schema-Fatal-Pfad
// des Custom-Exchange-Kanals: yahoo-finance2 akzeptiert im screener()-Schema ausschliesslich
// scrIds (nachgesehen in der installierten 3.15.4: ScreenerOptions kennt kein `query`,
// additionalProperties:false) — der query-basierte Exchange-Call wirft seit Tag 248 (05.07.)
// bei JEDEM Lauf, zuletzt belegt im Lauf 30788278952 vom 03.08. Waere das rot, waere Karls
// rotes X ab sofort jeden Tag rot und damit wertlos.
// Deshalb: die ::error::-Annotation bleibt unveraendert (Sichtbarkeit im Schritt-Log), aber
// dieser EINE bekannte Dauerdefekt faerbt den Lauf nicht rot.
// ABNAHME DES FIXES: wer den Exchange-Kanal auf einen 3.15-kompatiblen Aufruf umbaut, setzt
// diesen Schalter auf false — dann ist ein erneuter Schema-Bruch wieder sofort rot.
//
// ── TAG 576: ABGENOMMEN, SCHALTER AUF false ──────────────────────────────────────
// Der Umbau ist erfolgt (fetchExchangePage geht ueber yf._fetch auf den POST-Screener,
// CI-Probe 30869143397 vom GitHub-Runner: 19 Boersen, 47 Seiten, alle HTTP 200). Damit
// gibt es keinen bekannten Dauerdefekt mehr, den dieser Schalter decken duerfte — jeder
// Vertragsbruch dieses Kanals faerbt den Lauf ab sofort wieder rot.
//
// NEBENBEFUND, der die Umstellung ohnehin erzwungen haette: die T569-F3-Verengung hat seit
// Tag 569 NICHT MEHR GEGRIFFEN. Sie verlangt, dass die Fehlermeldung woertlich das verbotene
// Feld `query` nennt — gemessen wurde das aber gegen eine Bibliothek mit eingeschalteter
// Optionsprotokollierung. refresh-universe.js baut seinen Client mit
// validation.logOptionsErrors=false; die Meldung lautet dann nur noch
//   "yahooFinance.screener called with invalid options."
// und enthaelt kein `query`. exchangeDefektIstDerBekannte() lieferte damit im ECHTEN Lauf
// false, der Lauf wurde also taeglich rot — genau der Dauer-Falschalarm, den der Schalter
// verhindern sollte. Lokal am HEAD 850a0aec58 reproduziert (Tag 576, Commit-Beleg).
// Der Schalter und die Funktion bleiben stehen: sie sind der Weg zurueck, falls der Kanal
// je wieder belegt dauerhaft ausfaellt. Wer ihn erneut auf true setzt, muss die
// Messgrundlage neu belegen — tests/refresh-universe.test.js bindet ihn an die im
// package-lock stehende yahoo-finance2-Version.
const EXCHANGE_KANAL_BEKANNT_DEFEKT = false;

// Reine Funktion (Zaehler rein, Urteil raus), damit sie ohne Netz pruefbar ist.
function predefinedKanalEingebrochen(nonEmpty, attempted, minAnteil = MIN_PREDEFINED_NONEMPTY_ANTEIL) {
  return attempted > 0 && nonEmpty < minAnteil * attempted;
}

// S4-DISC-001: die Ertragszeile des Discovery-Merges. `quelle=1234` wie bisher,
// `quelle=1234!` wenn die Quelle nur einen TEIL ihrer Scheiben geliefert hat,
// `quelle=FAIL` bei komplettem Ausfall. Einzeln pruefbar, weil sie sonst nur im
// Rumpf von main() lebte und kein Waechter an sie herankaeme.
function discoveryErtragsZeile(namen, ertrag, degradiert) {
  const d = new Set(degradiert || []);
  return namen
    .map(n => n + '=' + (ertrag[n] === -1 ? 'FAIL' : (ertrag[n] || 0)) + (d.has(n) ? '!' : ''))
    .join(' ');
}

// F-11 (Karl-Entscheid 2026-08-04): Untergrenze des Entdeckungs-Kanals $1 Mrd -> $800 Mio.
// WARUM: pull-yahoo.js laeuft in .github/workflows/daily-pull.yml seit 2026-06 mit
// MIN_MCAP_USD=800000000 — der Pull haette Firmen ab $800M genommen. Die beiden
// Yahoo-Entdeckungskanaele hier schnitten aber weiter bei $1 Mrd ab, jeder mit seinem
// EIGENEN Zahlen-Boden (Zeile ~545 als Literal, Zeile ~595 als MIN_MCAP_CUSTOM). Damit
// war das Band $800M-$1B ueber diese Kanaele unerreichbar: was der Pull akzeptiert haette,
// schlug die Entdeckung nie vor. Ein Boden an EINER Stelle statt zwei, damit die naechste
// Verschiebung nicht wieder nur die Haelfte trifft.
// Der Deckel $500 Mrd bleibt UNVERAENDERT — Karl hat ihn ausdruecklich nicht gewaehlt.
const MIN_MCAP_DISCOVERY = 800e6;
const MAX_MCAP_DISCOVERY = 500e9;

// Der Gate als reine Funktion, damit er ohne Netz/main() pruefbar ist.
// T562-L2 (Praezisierung): deckungsgleich mit dem alten `!mcap || mcap < MIN || mcap > MAX`
// fuer alle Werte, die toUsd() ueberhaupt liefern kann — null oder endlich positiv; `!mcap`
// fing null/0/NaN, das uebernimmt hier Number.isFinite + > 0. Fuer NICHT-Zahlen ist die
// Funktion bewusst STRENGER als der alte Ausdruck: ein Objekt ({raw: 2e9}) machte dort beide
// Vergleiche NaN-falsch und rutschte durch, ein Zahl-String wurde still gecastet. Beides
// faellt jetzt raus. toUsd() gibt so etwas nie zurueck, aber der Gate ist exportiert und
// wird auch direkt aufgerufen — die strengere Form ist die richtige Fehlerrichtung.
function inDiscoveryMcapBand(mcapUsd) {
  return Number.isFinite(mcapUsd) && mcapUsd > 0 &&
    mcapUsd >= MIN_MCAP_DISCOVERY && mcapUsd <= MAX_MCAP_DISCOVERY;
}

// T562-M1 (Hard-Review Tag 562): ein Entdeckungskanal kann am Mcap-Gate LAUTLOS komplett
// leerlaufen. toUsd() liefert null, sobald q.currency fehlt oder einen unbekannten Code
// traegt (Schema-Bruch-Klasse, kein Ladefehler — BH-041 greift also nicht), und dann
// verwirft inDiscoveryMcapBand() JEDE Zeile. Kein bestehender Waechter sieht das:
//   - Tag 510 (beideYahooKanaeleLeer) zaehlt nicht-leere BUCKETS, also ABGEHOLTES,
//   - die 0-Quotes-Warnung des Exchange-Kanals prueft totalQuotes — das ist hier > 0,
//   - MIN_DISCOVERY_CANDIDATES (BH-193) kennt die beiden Yahoo-Kanaele gar nicht:
//     DISCOVERY_SOURCE_NAMES listet nur die 20 Adapter.
// Ergebnis waere: volle Buckets, 0 Kandidaten, Lauf gruen. Seit Tag 566 ist der
// Predefined-Kanal wieder scharf, die Lage ist also nicht mehr theoretisch.
// Reine Funktion (Zaehler rein, Meldung raus), damit sie ohne Netz pruefbar ist — und
// damit BEIDE Kanaele dieselbe Wache rufen statt jeder seine eigene zu bauen.
// T567-W3 (Konvergenz-Check Tag 567): die Ursachen-Behauptung war ungedeckt. Der Alarm kannte
// nur "abgeholt" und "behalten" und schloss daraus auf FX-Luecke ODER Band-Entscheidung — aber
// zwischen beiden liegt der Vor-Gate-Filter (_vorGateVerworfen: Junk-Suffixe, Nicht-Equity).
// Die vier bewusst nicht-Equity-Buckets (solid_*_funds, conservative_foreign_funds,
// high_yield_bond) koennen einen Kanal komplett VOR dem Gate leeren; die Meldung haette dann
// eine Waehrungs- oder Groessen-Ursache behauptet, die es nie gab, und die naechste
// Debug-Runde in die falsche Richtung geschickt.
// Jetzt wird zerlegt: abgeholt = vorFilterVerworfen + (behalten + fxLuecken + bandDrops).
// Weil `behalten === 0` die Alarmbedingung ist, faellt bandDrops als Rest heraus. Die Rechnung
// ist nur deshalb vollstaendig, weil es in beiden Ingest-Schleifen GENAU ZWEI verwerfende
// Pfade gibt (Vor-Gate-Helfer + Band-Gate) — tests/refresh-universe.test.js pinnt das am
// Objekt. Geht die Zerlegung trotzdem nicht auf, wird KEINE Ursache behauptet.
// T576: vierter Term `zweitlistungen`. Der Exchange-Kanal hat mit dem Zweitlistungs-Filter
// einen DRITTEN verwerfenden Pfad bekommen. Bliebe er hier unbekannt, wanderte er still in
// die bandDrops-Restmenge — und die Meldung behauptete wieder eine Groessen-Ursache, die es
// nicht gibt (genau der T567-W3-Befund, nur mit anderem Verursacher). Der Predefined-Kanal
// hat diesen Pfad nicht und uebergibt nichts; der Vorgabewert 0 haelt seine Rechnung gleich.
function kanalLeerlaufAlarm(kanal, abgeholt, behalten, fxLuecken, vorFilterVerworfen, zweitlistungen) {
  if (!(abgeholt > 0 && behalten === 0)) return null;
  const zweit = zweitlistungen === undefined ? 0 : zweitlistungen;
  const kopf = '::error::' + kanal + ' hat ' + abgeholt + ' Quotes abgeholt und davon KEINE EINZIGE behalten. ';
  const schluss = ' Der Kanal LAEUFT und meldet trotzdem nichts: der Tag-510-Waechter misst abgeholte Buckets statt ' +
    'Behaltenes, und MIN_DISCOVERY_CANDIDATES sieht die Yahoo-Kanaele nicht (DISCOVERY_SOURCE_NAMES ' +
    'listet nur die Adapter).';
  const gateErreicht = abgeholt - vorFilterVerworfen - zweit;
  const bandDrops = gateErreicht - behalten - fxLuecken;
  if (!Number.isFinite(vorFilterVerworfen) || !(vorFilterVerworfen >= 0) ||
      !Number.isFinite(zweit) || !(zweit >= 0) || gateErreicht < 0 || bandDrops < 0) {
    return kopf + 'Die Zerlegung geht nicht auf (' + abgeholt + ' abgeholt gegen ' + vorFilterVerworfen +
      ' vor dem Gate + ' + zweit + ' Zweitlistungen + ' + fxLuecken + ' FX-Luecken + ' + behalten +
      ' behalten) — Ursache offen, es gibt einen ungezaehlten Verwerfungs-Pfad in der Ingest-Schleife.' + schluss;
  }
  const vorFilterSatz = (vorFilterVerworfen > 0
    ? vorFilterVerworfen + ' Zeilen fielen VOR dem Gate (Nicht-Equity/Junk-Symbole). ' : '') +
    (zweit > 0 ? zweit + ' Zeilen waren Zweitlistungen (Hinterlegungsscheine/fremde Berichtswaehrung). ' : '');
  if (gateErreicht === 0) {
    return kopf + vorFilterSatz + 'KEINE EINZIGE Zeile hat das Groessen-Gate ueberhaupt erreicht — das ist ' +
      'keine Waehrungs- und keine Groessen-Frage. Bei den bewusst nicht-Equity-Buckets (Fonds/Anleihen) ' +
      'ist genau das der Normalfall; sonst hat sich die Form der Quotes geaendert (Symbol-Feld, quoteType).' +
      schluss;
  }
  return kopf + vorFilterSatz + (fxLuecken > 0
    ? fxLuecken + ' Zeilen hatten ein echtes marketCap, aber fx-rates.json kennt ihre Handelswaehrung ' +
      'nicht — FX-Artefakt-Luecke, keine Groessen-Entscheidung.'
    : 'Keine FX-Luecke: entweder fehlt/aendert sich das Waehrungsfeld der Quotes (dann liefert toUsd() ' +
      'null und das Band-Gate verwirft alles), oder wirklich jede der ' + bandDrops + ' Zeilen am Gate lag ' +
      'ausserhalb $' + (MIN_MCAP_DISCOVERY / 1e6) + 'M-$' + (MAX_MCAP_DISCOVERY / 1e9) + 'B.') +
    schluss;
}

async function main() {
  const args = parseArgs(process.argv);
  console.log('Auto-Universe-Refresh');
  console.log('  watchlist: ' + args.watchlist);

  // BH-041: fail-closed on a missing/corrupt fx-rates.json instead of silently running
  // with the {USD:1} fallback (mis-converts every non-USD row and, downstream, gets
  // misread as "priced and below $2B" — deleting Auslandszeilen that were never actually
  // evaluated). Abort before any screener pull / file write.
  if (_fxRatesLoadFailed) {
    console.error('::error::fx-rates.json fehlt oder ist nicht lesbar/parsebar — Nicht-USD-Marktkapitalisierungen ' +
      'wuerden faelschlich als USD (Faktor 1.0) behandelt und Auslandszeilen faelschlich als "< $2B" verworfen. ' +
      'Abbruch vor jeder Datenarbeit statt stillem {USD:1}-Fallback.');
    process.exit(1);
  }

  const wlRaw = JSON.parse(fs.readFileSync(args.watchlist, 'utf8'));
  const whenIssuedRepair = entferneWhenIssuedBestand(wlRaw.stocks);
  wlRaw.stocks = whenIssuedRepair.stocks;
  const whenIssuedDropped = whenIssuedRepair.dropped;
  if (whenIssuedDropped) {
    console.log('  When-issued repair: ' + whenIssuedDropped + ' temporary row(s) removed from the existing watchlist.');
  }
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
  // F-11 (04.08.2026): Untergrenze weiter auf $800M — gleicher Boden wie der Pull.
  console.log('\nPulling Yahoo Screener-Buckets (Multi-Region)...');
  const allTickers = new Map(); // ticker -> {marketCap, name, sector, exchange}
  // BH-100: this predefined-bucket channel (13 SCREENER_IDS x 25 REGIONS) had no
  // success/failure aggregate at all — fetchScreener() already logs individual
  // failures, but a channel-wide collapse (every bucket empty) produced no signal
  // distinguishable from a normal day where these buckets mostly overlap with other
  // sources. Track it the same way exchangeStats/discoveryYield already do below.
  let predefinedAttempted = 0, predefinedNonEmpty = 0, predefinedTotalQuotes = 0;
  // T562-M1: abgeholt ist nicht behalten. Ohne diese beiden Zaehler kann der Kanal 325 volle
  // Buckets melden und trotzdem 0 Kandidaten liefern, ohne dass irgendetwas rot wird.
  // T567-W3: dritter Zaehler — was schon vor dem Gate rausfiel (Junk/Nicht-Equity).
  let predefinedKept = 0, predefinedFxLuecke = 0, predefinedVorFilter = 0;
  for (const region of REGIONS) {
    console.log('  --- Region: ' + region + ' ---');
    for (const id of SCREENER_IDS) {
      const quotes = await fetchScreener(id, region);
      predefinedAttempted++;
      if (quotes.length === 0) continue;
      predefinedNonEmpty++;
      predefinedTotalQuotes += quotes.length;
      let kept = 0;
      for (const q of quotes) {
        // T567-W3: EIN gezaehlter Vor-Gate-Pfad (siehe _vorGateVerworfen) statt fuenf
        // ungezaehlter continue-Zeilen — sonst kann der Leerlauf-Alarm unten nicht sagen,
        // ob am Gate etwas verworfen wurde oder ob nie eine Zeile bis dorthin kam.
        if (_vorGateVerworfen(q)) { predefinedVorFilter++; continue; }
        const sym = q.symbol.toUpperCase();
        // Bug 4: q.marketCap ist in q.currency (Listing-Waehrung), das Gate in USD.
        // Nach USD konvertieren, gegen $800M/$500B pruefen und den USD-Wert speichern.
        const mcap = toUsd(q.marketCap, q.currency, _FX_RATES);
        // T562-M1: Drop-Grund trennen, BEVOR das Gate verwirft — "Waehrung fehlt in
        // fx-rates.json" ist ein Artefakt-Problem, "ausserhalb des Bands" eine Entscheidung.
        if (isUnpriceable(q.marketCap, q.currency, _FX_RATES)) predefinedFxLuecke++;
        if (!inDiscoveryMcapBand(mcap)) continue;  // F-11: $800M+ Mid/Large-Cap universe
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
      predefinedKept += kept;  // T562-M1: hier zaehlt `kept` die Band-Durchlaeufer (nicht nur Neuzugaenge)
      await _sleep(300);
    }
  }
  console.log('  Predefined-Buckets: ' + predefinedNonEmpty + '/' + predefinedAttempted +
    ' nicht-leer, ' + predefinedTotalQuotes + ' Quotes gesamt.');
  if (predefinedKanalEingebrochen(predefinedNonEmpty, predefinedAttempted)) {
    // BH-100: total collapse of this channel — surface it, but don't abort.
    //
    // Tag 510 KORREKTUR der Begruendung: hier stand "redundant coverage (EXCHANGE_CODES
    // + the discovery adapters cover the same ground)". Auf EXCHANGE_CODES darf sich
    // diese Stelle NICHT stuetzen — jener Kanal ist seit Tag 248 (05.07.2026) permanent
    // kaputt (v3.14-Schema, siehe BH-038 unten), und BH-038 begruendete seinen eigenen
    // Nicht-Abbruch umgekehrt mit "see BH-100 above". Ein Zirkelschluss: zwei
    // Begruendungen, die sich gegenseitig als Auffangnetz nennen, und beide leer.
    //
    // Der tragende Schutz ist AUSSCHLIESSLICH MIN_DISCOVERY_CANDIDATES weiter unten
    // (BH-193) — er prueft die Entdeckung als Ganzes und ist von beiden Yahoo-Kanaelen
    // unabhaengig. Nur darauf stuetzt sich der Nicht-Abbruch hier.
    // Dass BEIDE Yahoo-Kanaele im selben Lauf leer laufen, meldet der Waechter nach
    // dem Exchange-Block (Tag 510) — keiner der beiden Kanaele kann das fuer sich sehen.
    //
    // T566-H2: die Schwelle ist ein ANTEIL, nicht mehr "0" (Begruendung an der Konstanten),
    // und der Befund faerbt den Lauf rot (process.exitCode) statt nur eine Annotation zu
    // hinterlassen. Kein Prozess-Abbruch: der Rest von main() (Laenderadapter, Watchlist-
    // Write) soll laufen, damit ein halb kaputter Entdeckungstag nicht das Universum
    // einfriert — aber der Tag ist danach nicht mehr gruen.
    console.error('::error::Predefined-Screener-Kanal (SCREENER_IDS x REGIONS) liefert nur ' +
      predefinedNonEmpty + ' nicht-leere Buckets ueber ' + predefinedAttempted + ' Aufrufe (' +
      (predefinedAttempted > 0 ? (predefinedNonEmpty / predefinedAttempted * 100).toFixed(1) : '0.0') +
      ' %, unter der Schwelle ' + (MIN_PREDEFINED_NONEMPTY_ANTEIL * 100).toFixed(0) + ' %) — ' +
      'moeglicher Yahoo-Schema-Bruch/Teilausfall dieses Kanals (Bibliotheks-Rueckfall unter ' +
      'yahoo-finance2 3.15.0 sieht genau so aus). Kein Prozess-Abbruch (Rest von main() laeuft ' +
      'weiter), aber der Lauf endet rot.');
    process.exitCode = 1;
  }
  // T562-M1: der andere Totalausfall — Buckets kommen an, aber am Mcap-Gate bleibt nichts uebrig.
  const predefinedLeerlauf = kanalLeerlaufAlarm('Predefined-Screener-Kanal (SCREENER_IDS x REGIONS)',
    predefinedTotalQuotes, predefinedKept, predefinedFxLuecke, predefinedVorFilter);
  if (predefinedLeerlauf) { console.error(predefinedLeerlauf); process.exitCode = 1; }

  // Tag 131 / Tag 576: Custom Exchange-Screener (paginiert) — zusätzlich zu predefined Buckets.
  console.log('\nCustom Exchange-Screener (Tag 131, Tag 576 neu aufgesetzt)...');
  // F-11: derselbe Boden wie im Predefined-Kanal — EINE Quelle, kein zweiter Zahlen-Boden.
  // Sie gehen NICHT mehr direkt als Query-Grenzen raus: Yahoos serverseitiger Filter rechnet
  // in Listing-Waehrung, die Umrechnung macht lokaleSchranken() je Boerse (Messbefund 2).
  let customAdded = 0;
  const exchangeT0 = Date.now();
  // Review-Befund 1 ueber Tag 579: das war ein einziges prozessweites Bool, und die
  // Abnahme-Messung unten stufte damit ALLE Boersen auf "nur Warnung" herunter, sobald
  // IRGENDEINE das Budget riss — auch die, die Minuten vorher vollstaendig durchgelaufen
  // waren. Ein echter Einbruch auf NYQ waere still geblieben, weil zufaellig ASE am Ende
  // der Liste in die Deadline lief. Jetzt wird ATTRIBUIERT: nur wer vom Budget
  // abgeschnitten oder gar nicht mehr gefragt wurde, bekommt die Nachsicht.
  const exchangeBudgetOpfer = new Set();
  // F-DP-037 (Tag 190): per-exchange statistics so we can surface silent
  // breakage. Without this, a 429 or schema break on one exchange just made
  // the exchange disappear with zero diagnostic.
  const exchangeStats = {};
  // BH-038: this is a permanent yahoo-finance2 v3.14 schema incompatibility, not a
  // transient per-exchange failure — every exchange will throw the identical error (see
  // Bug-3 comment below). The channel used to process.exit(1) HERE, before the country
  // adapters and the watchlist write (further down in main()) ever ran, freezing the
  // ENTIRE universe refresh on one broken channel.
  // Fail loud but let the rest of main() run: mark the channel fatal, stop retrying it,
  // and flip the eventual process exit code without aborting execution.
  //
  // Tag 510 KORREKTUR der Begruendung: hier stand "(and redundant — see BH-100 above)".
  // BH-100 stuetzte sich seinerseits auf GENAU DIESEN Kanal. Der Verweis ist entfernt;
  // der Nicht-Abbruch stuetzt sich allein auf MIN_DISCOVERY_CANDIDATES (BH-193), das
  // von beiden Yahoo-Kanaelen unabhaengig ist. Den gleichzeitigen Ausfall beider
  // Kanaele meldet der Waechter am Ende dieses Blocks.
  let exchangeScreenerFatal = false;
  // T562-M1: FX-Luecken ueber alle Boersen — Drop-Grund fuer den Leerlauf-Alarm unten.
  let exchangeFxLuecke = 0;
  // T567-W3: dritter Zaehler wie im Predefined-Kanal (Junk/Nicht-Equity vor dem Gate).
  let exchangeVorFilter = 0;
  // T576: Zweitlistungen als eigener, GEZAEHLTER Verwerfungs-Pfad (siehe istZweitlistung).
  let exchangeZweitlistung = 0;
  for (const kanal of EXCHANGE_KANAELE) {
    const exch = kanal.code;
    if (exchangeScreenerFatal) break;
    // T576 Deadline-Guard: die Boersen-Schleife darf den Schritt nicht toeten. Sie prueft
    // VOR jeder Boerse, nicht nur am Ende — eine Boerse mit vielen Seiten soll gar nicht
    // erst anfangen, wenn das Budget schon aufgebraucht ist.
    if (Date.now() - exchangeT0 >= EXCHANGE_BUDGET_MS) {
      // Diese Boerse UND alle dahinter wurden nie gefragt — sie alle sind Budget-Opfer.
      for (const rest of EXCHANGE_CODES.slice(EXCHANGE_CODES.indexOf(exch))) exchangeBudgetOpfer.add(rest);
      console.error('::error::EXCHANGE-ZEITBUDGET GERISSEN: ' + Math.round(EXCHANGE_BUDGET_MS / 1000) +
        's aufgebraucht (' + Math.round((Date.now() - exchangeT0) / 1000) + 's verbraucht) vor Boerse ' +
        exch + '. Die restlichen Boersen (' + EXCHANGE_CODES.slice(EXCHANGE_CODES.indexOf(exch)).join(',') +
        ') werden NICHT abgefragt; der Kanal liefert einen Teilbestand. Kein Abbruch — die ' +
        'Laenderadapter und der Watchlist-Write danach sollen laufen (T576, Herleitung an ' +
        'EXCHANGE_BUDGET_MS).');
      break;
    }
    const schranken = lokaleSchranken(kanal.ccy, _FX_RATES);
    if (!schranken) {
      // LAUT ueberspringen statt mit falschen Grenzen abzufragen: ohne Kurs waeren die
      // Schranken NaN, Yahoo lieferte irgendetwas, und niemand saehe den Unterschied.
      exchangeStats[exch] = { totalQuotes: 0, totalKept: 0, totalBandOk: 0, pageErrors: 1, zweitlistung: 0 };
      console.error('::error::[' + exch + '] kein FX-Kurs fuer die Listing-Waehrung ' + kanal.ccy +
        ' in fx-rates.json — die serverseitigen Schranken waeren NaN. Boerse uebersprungen; ' +
        'sie faellt unten zusaetzlich unter ihren Abnahme-Boden.');
      process.exitCode = 1;
      continue;
    }
    let offset = 0;
    let pageEmpty = false;
    let pageErrors = 0;
    let totalQuotes = 0;
    let totalKept = 0;
    let zweitlistung = 0;
    // T562-M1: eigener Zaehler noetig — `totalKept` zaehlt NEUZUGAENGE (kept++ steht im
    // has()-Zweig), nicht Band-Durchlaeufer. Eine Boerse, die nur schon Bekanntes liefert,
    // haette sonst faelschlich als "alles verworfen" gegolten.
    let totalBandOk = 0;
    while (!pageEmpty) {
      if (Date.now() - exchangeT0 >= EXCHANGE_BUDGET_MS) {
        exchangeBudgetOpfer.add(exch);   // nur DIESE Boerse wurde abgeschnitten
        pageErrors++;
        console.error('::error::EXCHANGE-ZEITBUDGET GERISSEN mitten in ' + exch + ' (offset=' + offset +
          '). Diese Boerse liefert einen Teilbestand und faellt damit womoeglich unter ihren ' +
          'Abnahme-Boden — das ist gewollt sichtbar, nicht kaschiert.');
        break;
      }
      const { quotes, total, error, httpStatus, fatal } = await fetchExchangePage(kanal, schranken.min, schranken.max, offset);
      if (error) {
        pageErrors++;
        // T576: der Fatal-Zweig ist RETARGETIERT. Bis Tag 575 suchte er die Meldung
        // "called with invalid options" der Bibliotheks-Schemapruefung — die kann es nach
        // dem Umbau auf yf._fetch gar nicht mehr geben, der Zweig waere also tot gewesen
        // und jeder Vertragsbruch waere als gewoehnlicher Seitenfehler durchgelaufen.
        // Jetzt entscheidet exchangeFehlerIstFatal() ueber HTTP-Status (400/401/403/404/
        // 405/410/422), ueber Yahoos Fehlerbeschreibung (finance.error.description, die
        // yahoo-finance2 als message durchreicht) und ueber `fatal` aus der gebrochenen
        // Antwortform. Die alte Schema-Regex bleibt EINE der Bedingungen: wer den Aufruf
        // auf yf.screener() zurueckbaut, faellt wieder in genau sie hinein.
        if (fatal || exchangeFehlerIstFatal(error, httpStatus)) {
          console.error('::error::Custom-Exchange-Screener: VERTRAGSBRUCH bei ' + exch +
            ' (HTTP ' + (httpStatus == null ? '-' : httpStatus) + '): "' + error + '". ' +
            'Das ist kein transienter Ausfall — er trifft alle ' + EXCHANGE_CODES.length +
            ' Boersen gleich, deshalb bricht der Kanal hier ab statt ihn ' +
            (EXCHANGE_CODES.length - 1) + '-mal zu wiederholen. Der Lauf wird rot. ' +
            'NAECHSTER SCHRITT: tests/yahoo-schema-canary.js gegen den Screener laufen lassen — ' +
            'er nennt das gebrochene Feld.');
          exchangeScreenerFatal = true;
          // T566-H2/T569-F3: der Dauerdefekt-Schalter durfte den Lauf gruen halten, solange
          // der Kanal belegt tot war. Seit Tag 576 ist er false — jeder Vertragsbruch faerbt
          // wieder rot. Die Bedingung bleibt AUSGESCHRIEBEN stehen (statt sie zu loeschen),
          // damit sichtbar ist, was der Schalter gedeckt hat und wann er wieder greifen wuerde.
          if (!(EXCHANGE_KANAL_BEKANNT_DEFEKT && exchangeDefektIstDerBekannte(error))) {
            process.exitCode = 1;
          } else {
            console.error('::error::Dieser Bruch ist der als Dauerdefekt eingetragene Fall — der ' +
              'Lauf bleibt gruen. Wenn Sie das hier lesen, steht EXCHANGE_KANAL_BEKANNT_DEFEKT ' +
              'wieder auf true und die Abnahme von Tag 576 ist zurueckgenommen worden.');
          }
          pageEmpty = true;
          break;
        }
        console.warn('  [' + exch + ' offset=' + offset + '] FAIL: ' + error);
        // F-DP-037: don't pretend the page was empty — break to next exchange
        // but record the error.
        pageEmpty = true;
        break;
      }
      // T576 Schema-Kanarienvogel im Betrieb: Yahoo meldet `total` und liefert trotzdem
      // keine Zeile. Das ist kein leeres Ergebnis, sondern ein Formwechsel — und es ist
      // genau der Fall, den eine "0 Quotes"-Pruefung als legitimes Seitenende durchwinkt.
      if (quotes.length === 0 && Number.isFinite(total) && total > offset) {
        pageErrors++;
        console.error('::error::[' + exch + ' offset=' + offset + '] Yahoo meldet total=' + total +
          ', liefert aber 0 Zeilen. Das ist ein Formwechsel der Antwort, kein Seitenende — ' +
          'die Paginierung wuerde hier still abbrechen und die Boerse als "fertig" gelten.');
        process.exitCode = 1;
        pageEmpty = true;
        break;
      }
      if (quotes.length === 0) { pageEmpty = true; break; }
      totalQuotes += quotes.length;
      let kept = 0;
      for (const q of quotes) {
        // T567-W3: derselbe gezaehlte Vor-Gate-Pfad wie im Predefined-Kanal.
        if (_vorGateVerworfen(q)) { exchangeVorFilter++; continue; }
        // T576: Zweitlistungen VOR dem Mcap-Gate raus und gezaehlt. Vor dem Gate, weil sie
        // sonst als Band-Durchlaeufer in totalBandOk landen und den Abnahme-Boden mit
        // Zeilen fuellen wuerden, die gar nicht ins Universum sollen.
        if (istZweitlistung(q)) { zweitlistung++; exchangeZweitlistung++; continue; }
        const sym = q.symbol.toUpperCase();
        // Bug 4: USD-konvertieren vor dem Gate (die Schwellen sind USD-Schwellen).
        const mcap = toUsd(q.marketCap, q.currency, _FX_RATES);
        if (isUnpriceable(q.marketCap, q.currency, _FX_RATES)) exchangeFxLuecke++;  // T562-M1
        if (!inDiscoveryMcapBand(mcap)) continue;  // F-11: identischer Boden wie oben
        totalBandOk++;  // T562-M1: Band-Durchlaeufer, unabhaengig davon ob schon bekannt
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
      if (quotes.length < EXCHANGE_SEITE) { pageEmpty = true; }
      else { offset += EXCHANGE_SEITE; await _sleep(400); }
    }
    exchangeStats[exch] = { totalQuotes, totalKept, totalBandOk, pageErrors, zweitlistung };
  }
  console.log('Custom-Screener total neue Tickers: ' + customAdded +
    ' (Zweitlistungen verworfen: ' + exchangeZweitlistung + ', Laufzeit ' +
    Math.round((Date.now() - exchangeT0) / 1000) + 's von ' + Math.round(EXCHANGE_BUDGET_MS / 1000) + 's)');
  // F-DP-037: per-exchange summary + soft alert when an exchange returned 0 quotes.
  // If a previously-productive exchange suddenly returns 0 (and no error was raised),
  // that's the silent-shrink scenario — log it conspicuously.
  const totalsByExch = Object.entries(exchangeStats)
    .map(([e, s]) => `${e}=${s.totalQuotes}/${s.totalBandOk}b/${s.totalKept}n${s.zweitlistung ? ' Z:' + s.zweitlistung : ''}${s.pageErrors > 0 ? ' ERR:' + s.pageErrors : ''}`)
    .join(' ');
  console.log('  Per-exchange (totalQuotes/bandOk/newKept): ' + totalsByExch);

  // ── T576 ABNAHME: jede Boerse gegen ihre Erstlauf-Untergrenze ───────────────────
  // Der Sinn: der Kanal war fuenf Monate tot, ohne dass es jemandem auffiel, weil nichts
  // eine ERWARTUNG an ihn hatte. Eine Aggregat-Zahl haette das auch nicht gefangen — solange
  // die grossen Boersen liefern, verschwindet der Ausfall einer kleinen im Rauschen. Deshalb
  // je Boerse, gegen die Haelfte der gemessenen Erstlauf-Ausbeute.
  const unterBoden = boersenUnterBoden(exchangeStats, EXCHANGE_KANAELE);
  // Review-Befund 1: die Nachsicht gilt JE BOERSE, nicht fuer den ganzen Lauf. Eine Boerse,
  // die vollstaendig durchgelaufen ist und trotzdem unter ihrem Boden liegt, ist ein echter
  // Befund — auch dann, wenn eine ANDERE Boerse spaeter ins Zeitbudget gelaufen ist.
  const { echt: echtUnterBoden, budgetErklaert } = abnahmeUrteil(unterBoden, exchangeBudgetOpfer);
  if (budgetErklaert.length > 0) {
    console.warn('::warning::' + budgetErklaert.length + ' Boersen unter ihrem Abnahme-Boden, aber vom ' +
      'Zeitbudget abgeschnitten oder gar nicht mehr gefragt (' +
      budgetErklaert.map((u) => u.code).join(', ') + ') — der Teilbestand erklaert die ' +
      'Unterschreitung, dafuer gibt es kein zweites rotes X (das Budget hat sich oben gemeldet).');
  }
  if (echtUnterBoden.length > 0) {
    console.error('::error::EXCHANGE-ABNAHME VERFEHLT bei ' + echtUnterBoden.length + ' von ' +
      EXCHANGE_KANAELE.length + ' Boersen: ' +
      echtUnterBoden.map((u) => u.code + ' ' + u.ist + '<' + u.boden + ' (Erstlauf ' + u.erstlauf + ')').join(', ') +
      '. Diese Boersen sind VOLLSTAENDIG abgefragt worden — das Zeitbudget erklaert hier nichts. ' +
      'Gemessen werden Zeilen im USD-Band NACH dem Zweitlistungs-Filter, nicht Neuzugaenge. ' +
      'Faellt EINE Boerse unter die Haelfte ihrer Erstlauf-Ausbeute, ist das entweder ein ' +
      'geaenderter Boersencode, ein Waehrungs-/Einheitenwechsel in Yahoos Filter oder ein ' +
      'Ausfall genau dieses Marktes — alle drei sind sonst unsichtbar, weil die grossen ' +
      'Boersen den Aggregat-Wert halten. NAECHSTER SCHRITT: Per-exchange-Zeile darueber.');
    process.exitCode = 1;
  } else if (unterBoden.length === 0) {
    console.log('  Exchange-Abnahme: alle ' + EXCHANGE_KANAELE.length +
      ' Boersen ueber ihrer Erstlauf-Untergrenze.');
  }
  const zeroQuoteExchanges = nullQuotenOhneFehler(exchangeStats);
  if (zeroQuoteExchanges.length > 0) {
    console.warn('[WARN] Exchanges with 0 quotes and no error (possible silent failure): ' +
      zeroQuoteExchanges.join(', '));
  }
  // T562-M1: die Gegenrichtung zur 0-Quotes-Warnung — Quotes kamen ueber ALLE Boersen an,
  // und keine einzige ueberlebte das Mcap-Gate. Aggregiert, weil eine einzelne Boerse auch
  // legitim leer sein kann; ueber alle 29 hinweg ist das Breakage.
  const exchangeQuotesGesamt = Object.values(exchangeStats).reduce((s, x) => s + x.totalQuotes, 0);
  const exchangeBandOkGesamt = Object.values(exchangeStats).reduce((s, x) => s + x.totalBandOk, 0);
  const exchangeLeerlauf = kanalLeerlaufAlarm('Custom-Exchange-Screener (' + EXCHANGE_CODES.length + ' Boersen)',
    exchangeQuotesGesamt, exchangeBandOkGesamt, exchangeFxLuecke, exchangeVorFilter, exchangeZweitlistung);
  if (exchangeLeerlauf) { console.error(exchangeLeerlauf); process.exitCode = 1; }

  // Tag 510: BEIDE Yahoo-Kanaele gleichzeitig auf 0 — die Redundanz-Begruendungen
  // beider Kanaele verweisen AUFEINANDER und laufen dann zusammen leer.
  //
  // BH-100 (oben, Predefined) begruendet den Nicht-Abbruch mit "redundant coverage
  // (EXCHANGE_CODES + the discovery adapters)". BH-038 (oben, Exchange) begruendet
  // ihn mit "redundant — see BH-100 above". Jede Begruendung nennt die andere als
  // Auffangnetz. Fallen beide im SELBEN Lauf aus, ist keine der beiden Begruendungen
  // mehr gedeckt — und bis hierher sagt das niemand, weil jeder Kanal nur sich selbst
  // prueft. Genau die Lage am 2026-07-30 (Lauf 30516194703): Predefined 0/325,
  // Exchange-Kanal fatal (v3.14-Schema, seit Tag 248 am 05.07. bekannt).
  //
  // Das ist KEIN Abbruch: der tragende Schutz ist MIN_DISCOVERY_CANDIDATES weiter
  // unten (BH-193), der unabhaengig von beiden Kanaelen prueft, ob die Entdeckung
  // insgesamt zusammengebrochen ist. Der bleibt die Reissleine. Dieser Waechter
  // sagt etwas anderes: die BREITE ausserhalb der US-Quellen faellt aus, ohne dass
  // ein Kanal fuer sich das melden kann.
  if (beideYahooKanaeleLeer(predefinedNonEmpty, exchangeScreenerFatal, customAdded)) {
    console.error('::error::BEIDE Yahoo-Entdeckungskanaele liefern 0 im selben Lauf — Predefined-Screener ' +
      '(' + predefinedAttempted + ' Aufrufe, 0 nicht-leere Buckets) UND Custom-Exchange-Screener ' +
      '(' + EXCHANGE_CODES.length + ' Boersen, ' + (exchangeScreenerFatal ? 'Schema-Fehler' : '0 neue Tickers') + '). ' +
      'Die Redundanz-Begruendung JEDES der beiden Kanaele nennt den ANDEREN als Auffangnetz (BH-100 / BH-038) — ' +
      'zusammen ist keine der beiden gedeckt. Die Entdeckung laeuft nur noch auf den Discovery-Adaptern, also ' +
      'US-lastig; der Exchange-Kanal war fuer die globale Breite gebaut (Tag 131: "10k+ statt ~3500"). ' +
      'Kein Abbruch — MIN_DISCOVERY_CANDIDATES unten bleibt die Reissleine.');
    process.exitCode = 1;
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
  // S4-DISC-001 (Block-5-Verifikation 2026-08-03): fuenf Adapter stempeln seit jeher
  // `partial` auf die zurueckgegebene Map, wenn sie nur einen TEIL ihrer Scheiben
  // (Seiten/Maerkte/Kategorien/Indizes) bekommen haben. Gelesen wurde das Feld hier
  // nirgends — die Zeile unten zeigte nur .size, und eine halbierte Quelle war von
  // einer gesunden nicht zu unterscheiden. KEINE Rot-Schwelle: ab welchem Anteil das
  // den Lauf kippen soll, ist eine Schwellen-Frage und gehoert vor den Rat.
  const degradedSources = [];
  let tvProtokoll = [];        // Tag 642: Tor 1 (tv-scanner) — je Markt Schwelle + Ertrag
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
    if (srcMap.partial) degradedSources.push(srcName);   // S4-DISC-001
    // Tag 642: das Tor-1-Protokoll des TV-Scanners hierher durchreichen (der Adapter
    // stempelt es auf die zurueckgegebene Map, genau wie `partial` daneben).
    if (Array.isArray(srcMap.protokoll)) tvProtokoll = srcMap.protokoll;
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
          source: info.source || 'unknown',
          // Bug 5: den KOSDAQ/KOSPI-Suffix-Unsicherheits-Flag durch den Merge tragen (wurde
          // bisher abgestreift). Der KR-Adapter emittiert Default .KS mit suffixUnsure:true;
          // ohne Weiterreichung kann kein Downstream-Schritt den .KQ-Requote (siehe
          // maybeRequoteKosdaq in mcap-prefilter.js) fuer diese Zeilen ausloesen.
          suffixUnsure: info.suffixUnsure || false
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

  // FIX-2 (Bau-Plan): Cross-Listing/ADR-Dedup. Statisch verifizierte ADR<->Heimat-Paare
  // (discovery/adr-dedup.json). Wenn BEIDE Zeilen im Universum sind (US-ADR + Heimat-Listing, das ein
  // Auslands-Adapter sammelt), die ADR-Zeile fallen lassen (Heimat behalten) -> keine Firma doppelt.
  // KONDITIONAL: nur droppen, wenn Heimat wirklich present ist (sonst Firma nicht verlieren; faengt auch
  // Vorzugsaktien-Edge-Cases ab, wo die Heimat-PN-Zeile vom subtype-Filter gedroppt wurde). A/H und
  // US-primaere Namen sind bewusst NICHT in der Liste. Daten, kein Merge-Umbau -> anker-sicher.
  try {
    const adrPairs = JSON.parse(fs.readFileSync(path.join(__dirname, 'discovery', 'adr-dedup.json'), 'utf8'));
    let dropped = 0;
    for (const [adr, home] of Object.entries(adrPairs)) {
      if (adr.startsWith('_')) continue; // _comment ueberspringen
      if (allTickers.has(adr) && allTickers.has(home)) { allTickers.delete(adr); dropped++; }
    }
    if (dropped) console.log('  ADR-Dedup: ' + dropped + ' US-ADR-Zeilen entfernt (Heimat-Listing present)');
  } catch (e) { console.warn('  ADR-Dedup uebersprungen:', e.message); }

  // audit/fix (BUG HIGH — discovery-yield observability + fail-loud signal):
  // surface per-source yield so a partial degradation is visible even when the run
  // stays above the hard floor.
  const yieldSummary = discoveryErtragsZeile(DISCOVERY_SOURCE_NAMES, discoveryYield, degradedSources);
  console.log('  Discovery per-source yield: ' + yieldSummary +
    '  (non-empty sources: ' + nonEmptySources + '/' + DISCOVERY_SOURCE_NAMES.length +
    ', total raw candidates: ' + totalDiscoveryCandidates + ')');
  if (degradedSources.length) {
    console.log('  Discovery Teilausfaelle (im Ertrag mit ! markiert): ' + degradedSources.length +
      ' von ' + DISCOVERY_SOURCE_NAMES.length + ' Quellen lieferten nur einen TEIL ihrer Scheiben — ' +
      degradedSources.join(', ') + '. Die Zahl vor dem ! ist damit eine Untergrenze, nicht der Bestand: ' +
      'was diese Quellen heute nicht mitgebracht haben, fehlt im Universum, ohne dass irgendwo etwas rot wird.');
  }

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
  const MIN_NONEMPTY_SOURCES = numEnv('MIN_DISCOVERY_SOURCES', 2, { min: 0 }); // BH-193
  const MIN_DISCOVERY_CANDIDATES = numEnv('MIN_DISCOVERY_CANDIDATES', 1000, { min: 0 }); // BH-193
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
  // Vorinitialisiert und HINEINGEREICHT (nicht als Rueckgabe eingesammelt): bricht die
  // Zuordnung in der Mitte ab, steht trotzdem drin, was bis dahin geloescht wurde.
  const prefilterVerworfen = [];
  try {
    const foreignNull = [...allTickers.entries()].filter(([, v]) =>
      v && !v.marketCap && v.source && String(v.source).split(',').some((s) => FOREIGN_CANON_SET.has(s.trim())));
    if (foreignNull.length) {
      const prefilterResult = await prefilterByMcap(foreignNull.map(([k]) => k));
      applyForeignPrefilterOutcome(allTickers, foreignNull, prefilterResult, prefilterVerworfen);
    }
  } catch (e) { console.warn('[refresh-universe] mcap-prefilter uebersprungen:', e.message); }

  // Tag 642: BEIDE Tore der Entdeckungs-Schicht schreiben ihr Ausschluss-Protokoll.
  // Bewusst NACH dem Prefilter und VOR dem Cap: hier ist die Schwellen-Entscheidung
  // gefallen, spaetere Loeschungen (Cap, Dead-Registry, ADR-Dedup) haben andere Gruende
  // und gehoeren nicht in dieselbe Akte. Fail-soft — ein Protokoll darf Karls Lauf nie
  // faellen, aber sein Ausfall wird laut (::warning::), nicht still.
  try {
    const protokoll = baueAusschlussProtokoll(tvProtokoll, prefilterVerworfen, {
      tor1_TV_PRECUT_USD: parseFloat(process.env.TV_PRECUT_USD || '1.5e9'),
      tor2_MCAP_PREFILTER_MIN_USD: parseFloat(process.env.MCAP_PREFILTER_MIN_USD || '2e9'),
      usKanaele_MIN_MCAP_DISCOVERY: MIN_MCAP_DISCOVERY,
      // Die ABRUF-Schwelle (pull-yahoo.js) wird in einem ANDEREN Workflow-Schritt gesetzt und
      // ist in diesem Prozess normalerweise gar nicht sichtbar. Hier den Vorgabewert 1e9
      // hinzuschreiben waere eine Falschaussage — der Tageslauf faehrt mit 800 Mio. Also:
      // nur melden, wenn wirklich gesetzt, sonst ehrlich null.
      abruf_MIN_MCAP_USD: process.env.MIN_MCAP_USD ? parseFloat(process.env.MIN_MCAP_USD) : null,
    });
    const ziel = path.join(__dirname, 'data-health', 'entdeckungs-ausschluss.json');
    fs.mkdirSync(path.dirname(ziel), { recursive: true });
    writeJsonAtomic(ziel, protokoll);
    console.log('[entdeckungs-ausschluss] Tor 1 (tv-scanner): ' + protokoll.tor1_tvScannerVorschnitt.maerkte.length +
      ' Maerkte, Schwelle $' + (protokoll.schwellen.tor1_TV_PRECUT_USD / 1e9).toFixed(2) + 'B; ' +
      'Tor 2 (mcap-prefilter): ' + protokoll.tor2_mcapPrefilter.summe + ' Zeilen verworfen, Schwelle $' +
      (protokoll.schwellen.tor2_MCAP_PREFILTER_MIN_USD / 1e9).toFixed(2) + 'B -> ' + ziel);
  } catch (e) {
    console.warn('::warning::[entdeckungs-ausschluss] Protokoll nicht geschrieben (' + e.message +
      ') — die Schwellen-Ausschluesse dieses Laufs sind damit unbelegt.');
  }

  // MAX_UNIVERSE: mit der Vorpruefung bleibt das Universum $2B+-schlank (US ~15,7k + Ausland-$2B ~4k +
  // Wachstum); 30000 gibt reichlich Headroom. Env-tunbar. Die Foreign-First-Slot-Quote unten schuetzt
  // etwaige nicht-bepreiste Rest-Null-mcap-Auslandszeilen (Netzwerk-Miss der Vorpruefung).
  const MAX_UNIVERSE = numEnv('MAX_UNIVERSE', 30000, { min: 1 }); // BH-193

  // Task 0.12 (Fail-Ticker-Klassifizierung): belegt-tote Ticker sind in
  // data-health/dead-tickers.json registriert (Klasse + Beleg-Verfahren im
  // Registry-Header; Klassen-Report reports/fail-ticker-klassen-2026-07-10.md).
  // Zwei Wirkungen: (a) tote Kandidaten werden nie (wieder) aufgenommen,
  // (b) noch vorhandene tote Bestandszeilen werden unten in-place entfernt.
  // Fail-open: fehlende/kaputte Registry = leere Registry (kein Austrag).
  let deadRegistry = {};
  try {
    const reg = JSON.parse(fs.readFileSync(path.join(__dirname, 'data-health', 'dead-tickers.json'), 'utf8'));
    if (reg && reg.tickers && typeof reg.tickers === 'object') deadRegistry = reg.tickers;
  } catch (e) { console.warn('  dead-tickers-Registry nicht lesbar (' + e.message + ') — kein Austrag.'); }

  // FIX 1 (Karl-Audit univ-cap): Austrag + Cap sind order-sensitive (s. Kommentar an der
  // Funktionsdefinition oben) — deshalb EIN Aufruf statt zwei separater Bloecke.
  applyDeadRegistryAndCap(allTickers, deadRegistry, MAX_UNIVERSE);

  // 2. No sector-exclude at universe level (Tag 132: modes filter sectors, not discovery)
  // Banks/REITs/Insurance are allowed for Quality-Compounder mode.
  // Tag 165: target raised to 12k+ with OTC + NASDAQ API sources
  console.log('Distinct candidates after all sources: ' + allTickers.size + ' (target: 12000+)');

  // 3. Identify new tickers
  let newTickers = [];
  for (const [sym, info] of allTickers) {
    if (!existing.has(sym)) newTickers.push(info);
  }
  console.log(`\nNew tickers: ${newTickers.length} (already-in: ${allTickers.size - newTickers.length})`);

  // BH-040: final persistence cap — see capNewTickerAdmission() above for the rationale.
  {
    const beforeBudgetCap = newTickers.length;
    newTickers = capNewTickerAdmission(newTickers, existing.size, MAX_UNIVERSE);
    if (newTickers.length !== beforeBudgetCap) {
      console.log(`  Persistence-Cap: ${beforeBudgetCap} -> ${newTickers.length} neue Ticker admittiert ` +
        `(MAX_UNIVERSE=${MAX_UNIVERSE}, bestehend=${existing.size}).`);
    }
  }

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

  // Bug 17: ADR-Dedup als IN-PLACE-Repair auf wlRaw.stocks (analog Class-Share-Collapse oben).
  // Die allTickers-Dedup (Z.591ff) wirkt nur auf die Kandidaten-Map dieses Runs; Bestands-ADRs
  // (BABA, SONY, TM, SAP, ASML, ...) blieben additiv fuer immer doppelt neben ihrem neu entdeckten
  // Heimat-Listing. Hier: ADR-Zeile aus der persistierten Watchlist droppen, wenn die Heimat-Zeile
  // in (existing ∪ allTickers) present ist; komplementaere Metadaten auf die Heimat-Zeile backfillen.
  let adrDropped = 0;
  {
    let adrPairs = {};
    try { adrPairs = JSON.parse(fs.readFileSync(path.join(__dirname, 'discovery', 'adr-dedup.json'), 'utf8')); }
    catch (e) { console.warn('  ADR-Watchlist-Repair uebersprungen:', e.message); adrPairs = {}; }
    const r = repariereAdrBestand(wlRaw.stocks, adrPairs);
    wlRaw.stocks = r.stocks;
    adrDropped = r.dropped;
    if (adrDropped) console.log('  ADR-Watchlist-Repair: ' + adrDropped + ' Bestands-ADR-Zeilen entfernt (Heimat-Listing present).');
  }

  // R1-SK-010: NACH Class-Share- und ADR-Collapse (beide aendern yahoo_symbol) als letztes
  // Netz — was danach noch dieselbe Yahoo-Abfrage teilt, ist zwangslaeufig eine Dublette.
  {
    const r = kollabiereYahooDubletten(wlRaw.stocks);
    wlRaw.stocks = r.stocks;
    if (r.dropped) console.log('  Yahoo-Dubletten-Collapse: ' + r.dropped + ' Zeile(n) entfernt (gleiches yahoo_symbol, gleiche Daten).');
  }

  // Task 0.12 (b): tote Bestandszeilen austragen (in-place-Repair, analog ADR-Dedup).
  // Snapshots bleiben unangetastet — der 0.8-Boersen-Waechter zaehlt Snapshots,
  // nicht Watchlist-Zeilen, und kippt dadurch nicht.
  let deadDropped = 0;
  if (Object.keys(deadRegistry).length > 0) {
    const before012 = wlRaw.stocks.length;
    wlRaw.stocks = wlRaw.stocks.filter(s => !(s && s.ticker && deadRegistry[String(s.ticker).toUpperCase()]));
    deadDropped = before012 - wlRaw.stocks.length;
    if (deadDropped) console.log('  Dead-Registry: ' + deadDropped + ' tote Bestandszeilen ausgetragen (0.12).');
  }

  // audit/fix (A2 2026-06-26): gate the write on an actual change. With the early-return
  // removed above, a run that discovered nothing new AND repaired nothing must still leave the
  // universe untouched (no needless rewrite / timestamp churn).
  if (!sollUniverseSchreiben({ newTickers: newTickers.length, repaired, collapsed, adrDropped, deadDropped, whenIssuedDropped })) {
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
// numEnv/capNewTickerAdmission/_isNonEquityQuote/EXCHANGE_SCREENER_SCHEMA_ERROR_RE added
// for BH-193/BH-040/BH-039/BH-038 test coverage.
module.exports = {
  toYahooClassShare, _looksUS, dedupKey, applyDeadRegistryAndCap,
  applyForeignPrefilterOutcome,
  baueAusschlussProtokoll,   // Tag 642: Ausschluss-Protokoll beider Entdeckungs-Tore
  numEnv, capNewTickerAdmission, _isNonEquityQuote, EXCHANGE_SCREENER_SCHEMA_ERROR_RE,
  repariereAdrBestand,    // R1-SK-012: ADR-Drop nur gegen echte Watchlist-Zeilen, einzeln pruefbar
  kollabiereYahooDubletten, // R1-SK-010: ein yahoo_symbol = eine Zeile (sonst Board-Dublette)
  entferneWhenIssuedBestand, sollUniverseSchreiben,
  _vorGateVerworfen,      // T567-W3: EIN gezaehlter Vor-Gate-Pfad fuer beide Ingest-Schleifen
  beideYahooKanaeleLeer,  // Tag 510: Doppelausfall-Waechter, einzeln pruefbar
  predefinedKanalEingebrochen, MIN_PREDEFINED_NONEMPTY_ANTEIL,  // T566-H2: Anteil statt "== 0"
  EXCHANGE_KANAL_BEKANNT_DEFEKT,                                // T566-H2: bekannter Dauerdefekt
  exchangeDefektIstDerBekannte,                                 // T569-F3: nur der BELEGTE Fall
  kanalLeerlaufAlarm,     // T562-M1: Kanal holt Quotes ab und behaelt keine einzige
  nullQuotenOhneFehler,   // DT-3: "0 Quotes und kein Fehler" — nur noch echte STILLE Faelle
  discoveryErtragsZeile,  // S4-DISC-001: Teilausfaelle sichtbar machen, einzeln pruefbar
  inDiscoveryMcapBand, MIN_MCAP_DISCOVERY, MAX_MCAP_DISCOVERY, // F-11: $800M-$500B-Band
  // ── T576: der neu aufgesetzte Exchange-Kanal, Stueck fuer Stueck einzeln pruefbar ──
  EXCHANGE_KANAELE, EXCHANGE_CODES, EXCHANGE_SCREENER_URL, EXCHANGE_SEITE, EXCHANGE_BUDGET_MS,
  lokaleSchranken,             // USD-Band -> Listing-Waehrung (Yahoos Filter rechnet lokal)
  istZweitlistung,             // domicile/subtype-Aequivalent auf den Screener-Feldern
  exchangeFehlerIstFatal, exchangeFehlerIstTransient,  // retargetierter Klassifizierer
  boersenUnterBoden, abnahmeUrteil,  // Abnahme je Boerse + Budget-Nachsicht je Boerse
  // Der Netzaufruf selbst — exportiert NUR, damit die CI-Probe den GEBAUTEN Code gegen den
  // echten Endpunkt fahren kann statt einen Nachbau. Ein Nachbau haette genau die Abweichung
  // nicht gefunden, um die es geht (der erste Probelauf hat das vorgefuehrt: er mass seinen
  // eigenen Crumb-Fehler). Kein Test im Gate ruft ihn — das Gate bleibt netzfrei.
  fetchExchangePage, crumbVorwaermen
};

if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });

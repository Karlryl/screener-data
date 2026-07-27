#!/usr/bin/env node
/**
 * Tag 13: Yahoo-Pull-Skript (v2 — mit yahoo-finance2)
 * ====================================================
 *
 * Liest watchlist.json, pullt für jede ISIN Yahoo-quoteSummary, mappt zu canonicalInput
 * (siehe engine-v7.3) und schreibt JSON-Files pro ISIN in den output-Ordner.
 *
 * Run:
 *   node pull-yahoo.js [--watchlist watchlist.json] [--output ./snapshots] [--rate-limit 1500]
 *
 * Dependencies:
 *   yahoo-finance2 (npm install yahoo-finance2). Yahoo blockt anonyme quoteSummary
 *   seit ~2024; yahoo-finance2 handhabt den Crumb/Cookie-Flow intern.
 *
 * Setup für GitHub-Actions:
 *   - package.json mit yahoo-finance2 als Dependency
 *   - actions/setup-node@v4 + npm ci im Workflow
 *   - rate-limit ≥1500ms gegen Yahoo-403/Blocking
 */

'use strict';

const fs = require('fs');
const path = require('path');

// Tag 133c: data-quality grading (per-snapshot A/B/C/D)
const { gradeSnapshot } = require('./methods/data-quality.js');
// Tag 189: F-DP-052 — atomic FTS-cache + snapshot writes.
const { writeFileAtomic } = require('./lib/atomic-write.js');

// Tag 134: Windows reserved-name sanitization. Continental AG (`CON.DE`) collides
// with the Windows reserved device name CON; the file can't be written on Windows,
// breaking `git checkout` and `git pull` for any Windows developer. Prefix such
// tickers with `_` so the filename is portable. The ticker inside the JSON is
// unchanged — only the on-disk filename differs.
// audit/fix: inline safeSnapshotFilename diverged from lib (writer/reader mismatch on reserved/dotted stems) — use canonical lib/snapshot-fs.js
const { safeSnapshotFilename } = require('./lib/snapshot-fs.js');
const { detectNewestQtrSuspect } = require('./lib/newest-qtr-guard.js');
const { detectAnnualCurrencyLeak } = require('./lib/annual-currency-guard.js');

let YahooFinance;
try {
  YahooFinance = require('yahoo-finance2').default;
} catch (e) {
  // Fallback: lokale node_modules (z.B. /tmp während Dev)
  try { YahooFinance = require('/tmp/node_modules/yahoo-finance2').default; }
  catch (e2) {
    console.error('FATAL: yahoo-finance2 nicht installiert. Run: npm install yahoo-finance2');
    process.exit(1);
  }
}

// Tag 147: yf-queue concurrency now reads PULL_CONCURRENCY env (same as outer batch).
// Hard-coding 8 made PULL_CONCURRENCY=20 a no-op for actual HTTP parallelism.
const _YF_CONC = parseInt(process.env.PULL_CONCURRENCY || '10', 10);
// Tag 211c: silence yahoo-finance2 schema-validation logging (see
// refresh-universe.js for full rationale). Constructor-level option since
// yahoo-finance2 v3.14.x does not expose setGlobalConfig.
const yf = new YahooFinance({
  suppressNotices: ['yahooSurvey'],
  queue: { concurrency: _YF_CONC },
  validation: { logErrors: false, logOptionsErrors: false },
  // Quick-Win 2026-06-10 (improvement plan): yahoo-finance2 emits a per-call
  // logger.warn that the legacy quoteSummary statement submodules are empty
  // since Nov 2024. We know — the FTS merge IS the primary source — and at
  // 15.7k tickers/run that one warning drowns the pull log. It bypasses
  // suppressNotices (plain logger.warn, not a notice), so filter exactly this
  // message at the logger layer; everything else passes through unchanged.
  logger: {
    info: (...a) => console.log(...a),
    warn: (...a) => {
      if (typeof a[0] === 'string' && a[0].includes('have provided almost no data since Nov 2024')) return;
      console.warn(...a);
    },
    error: (...a) => console.error(...a),
    debug: () => {},
    dir: (obj, opts) => console.dir(obj, opts)
  }
});

// Tag 166: Frequenztrennung — price-only mode for recent snapshots.
// Tickers with existing snapshot < FUNDAMENTALS_MAX_AGE_DAYS get a cheap yf.quote()
// update (~1s) instead of the full quoteSummary+fundamentalsTimeSeries pull (~6 calls, ~5s).
// Composes with Tag 164 staleness-sort: oldest first → full pull, recent → price-only.
const FUNDAMENTALS_MAX_AGE_DAYS = parseInt(process.env.FUNDAMENTALS_MAX_AGE_DAYS || '7', 10);
const FUNDAMENTALS_MAX_AGE_MS = FUNDAMENTALS_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;

// audit/fix F3 (2026-06-25): SEPARATE full-pull clock. The price-only fast path
// resets meta.asOf on every daily run, and the price-only eligibility gate reads
// that SAME meta.asOf (age < FUNDAMENTALS_MAX_AGE_MS) — so once a snapshot has the
// current schema, asOf is bumped to "today" each day and the age never crosses 7d,
// meaning a FULL pull (the only path that refreshes annual/metrics/FTS) NEVER runs
// again → fundamentals freeze indefinitely while asOf shows "today". Fix: stamp
// meta.fundamentalsAsOf ONLY on a successful full pull, NEVER touch it in
// _priceOnlyUpdate, and force a full pull when it ages past FUNDAMENTALS_REFRESH_DAYS.
const FUNDAMENTALS_REFRESH_DAYS = parseInt(process.env.FUNDAMENTALS_REFRESH_DAYS || '30', 10);
const FUNDAMENTALS_REFRESH_MS = FUNDAMENTALS_REFRESH_DAYS * 24 * 60 * 60 * 1000;

// audit/fix F3-budget (2026-06-25): per-run cap on TIME-based fundamentals-stale
// forced full pulls. The F3 fix forces a slow full pull whenever fundamentalsAsOf
// (or fetchedAt) ages past FUNDAMENTALS_REFRESH_DAYS. Because the schema-stale wave
// clustered a large cohort's seed timestamps, that cohort can re-expire together and
// all take the slow full-pull path in ONE run — collapsing n_ok below the coverage
// gate floor (max(2500, total*0.13), a hard CI fail). Since pullAll processes
// oldest-staleness-first, we honor time-based forced fulls only while a per-run
// counter is under budget; once exhausted, the remaining time-stale tickers fall
// back to price-only and are caught next run (still oldest-first). Schema-stale and
// currency-stale forced fulls are correctness-critical and rare — they are NEVER
// budgeted. Generous default so normal runs are unaffected; only a mass re-expiry
// stampede ever hits the cap.
// TASK 0.9 (Pull-Diät): budget cut 4000 → 1500. The full pulls are the run's
// bottleneck (run today: only 1368/23692 finished before the 165-min timeout).
// The budget caps ONLY sole-cause time-based fulls (schema/currency/earnings
// fulls ride free). Lowering it does NOT starve anyone: the oldest-first
// staleness rotation means the 1500 most-overdue tickers refresh each run and
// the rest rotate in over the following days, and the two-stage coverage gate
// now deploys degraded (price-only) results, so a smaller budget no longer
// hard-blocks. Earnings-flagged tickers (new financials) bypass the budget
// entirely via needsFullPull, so freshness where it matters is unaffected.
// ponytail: 1500 sized to fit the 165-min step at the observed full-pull rate,
// raise via env FUNDAMENTALS_REFRESH_BUDGET if the step grows or speeds up.
const FUNDAMENTALS_REFRESH_BUDGET = (() => {
  const v = parseInt(process.env.FUNDAMENTALS_REFRESH_BUDGET || '', 10);
  return (Number.isFinite(v) && v >= 0) ? v : 1500;
})();
let _fundamentalsRefreshUsed = 0;   // per-run counter, reset at the top of pullAll
let _fundamentalsRefreshDeferred = 0; // tickers deferred to price-only this run (logged)

// TASK 0.11 (Stille-Fehler-Härtung): per-run silent-error counters. Every catch that
// previously SWALLOWED a real error now bumps one of these, so its AUSFALL is countable
// (surfaced in the manifest _silentErrors object + a pullAll summary log — H4/0.7 fail-loud).
// Behaviour is UNCHANGED: a lamp/cache/parse fault still never crashes the pull; it just
// stops being silent. All reset at the top of pullAll. See ledger §0.11.
let _lampErrors = 0;            // lamp/advisory-tally detectors that threw (data stays faithful)
let _needsFullPullThrew = 0;    // needsFullPull hit its (near-unreachable) catch on exotic input
let _corruptYoungSnapshots = 0; // a young cached snapshot failed to JSON.parse (treated as no-cache)
let _ftsCacheParseErrors = 0;   // an FTS cache file failed to JSON.parse (treated as cache-miss)

// TASK 0.11: run a non-fatal "lamp"/advisory detector safely. On throw: count it
// (run-level _lampErrors + per-snapshot meta._lampErrors, so the offending ticker is
// self-describing), log a WARN, and CONTINUE — a lamp must never break the pull, but its
// failure is now LOUD instead of silent. Values stay faithful; Loop-B disposition unchanged.
function runLamp(name, meta, fn) {
  try { fn(); }
  catch (e) {
    _lampErrors++;
    if (meta && typeof meta === 'object') {
      meta._lampErrors = (meta._lampErrors || 0) + 1;
      (meta._lampErrorNames = meta._lampErrorNames || []).push(name);
    }
    _log('WARN', `lamp '${name}' threw (non-fatal, data faithful): ${e && e.message}`);
  }
}

function _applyCurrencyConsistencyGuard(canonical) {
  const result = detectAnnualCurrencyLeak(canonical);
  if (result.suspect && canonical && canonical.meta) {
    canonical.meta._annualCurrencyLeakSuspect = true;
    canonical.meta._annualCurrencyLeakReason = result.reason;
    canonical.meta._currencyInconsistencySuspect = true;
    canonical.meta._currencyInconsistencyReason = result.reason;
  }
  return result;
}

// Market-cap floor (USD). Env-configurable so a wider universe sweep — e.g.
// "screen every US company" — can lower it without a code edit, and so the
// local fill-pull and the daily CI pull stay consistent (otherwise CI's $1B
// floor would re-purge sub-$1B names on the next staleness refresh). Default
// $1B preserves prior behaviour. Set MIN_MCAP_USD in dollars, e.g.
// 800000000 = $800M. Used by BOTH the price-only floor and the full-pull floor.
const MIN_MCAP_USD = (() => {
  const v = parseFloat(process.env.MIN_MCAP_USD || '');
  return (Number.isFinite(v) && v >= 0) ? v : 1e9;
})();

// audit fix BH-047: a single not-found response (transient 404 / momentarily-empty
// fundamentals) must not permanently delist a ticker — the very next daily
// prune-watchlist run removes anything flagged meta.delisted, irreversibly. Require
// NOT_FOUND_DELIST_STREAK consecutive not-found runs before flagging.
const NOT_FOUND_DELIST_STREAK = parseInt(process.env.NOT_FOUND_DELIST_STREAK || '2', 10);

/**
 * Tag 466 — die Ueberspring-Entscheidung der Small-Cap-Eigentumsgrenze, als reine Funktion
 * herausgezogen (gleiches Muster wie nextNotFoundState darunter: pruefbar ohne Platte).
 *
 * WARUM DAS EINEN EIGENEN WAECHTER BRAUCHT: an genau dieser Bedingung haengt, ob eine Firma,
 * die ueber die Bandgrenze waechst, im Hauptboard sichtbar ist. Die aeltere Fassung lautete
 * "steht auf der Small-Cap-Liste -> ueberspringen" und machte Aufsteiger bis zu eine Woche
 * unsichtbar. Tag 456 hat das auf "steht drauf UND hat KEINE eigene Kursdatei" verschaerft.
 *
 * Der Unterschied ist von aussen unsichtbar: beide Fassungen laufen gruen, beide melden
 * plausible Zahlen. Erst am 27.07. wurde am CI-Bestand nachgemessen, dass mit der neuen
 * Bedingung NULL von fuenf Aufsteigern uebersprungen werden — vorher waeren es fuenf gewesen.
 * Ohne Waechter faellt ein Rueckbau also niemandem auf, und die Luecke kaeme lautlos zurueck.
 * Festgenagelt in tests/smallcap-eigentumsgrenze.test.js.
 */
function ueberspringtSmallcapTicker({ aufSmallcapListe, hatSnapshot }) {
  if (!aufSmallcapListe) return false;   // gehoert dem Hauptlauf — immer ziehen
  return !hatSnapshot;                   // ohne eigene Kursdatei holt sie der Small-Cap-Lauf
}

// audit fix BH-047: pure decision extracted so it's unit-testable without touching disk.
function nextNotFoundState(existingMeta) {
  const streak = ((existingMeta && existingMeta.notFoundStreak) || 0) + 1;
  return { streak, delisted: streak >= NOT_FOUND_DELIST_STREAK };
}

// audit fix BH-042: pure decision extracted so it's unit-testable without a yf mock.
function shouldRetryKosdaq(stock, errClass) {
  return errClass === 'not-found' && !!(stock && stock.suffixUnsure) && !stock._kqRetried
    && /\.KS$/i.test((stock && stock.yahoo_symbol) || '');
}

// Modules die wir brauchen für canonicalInput-Mapping
const MODULES = [
  'summaryDetail',                      // marketCap, priceToSalesTrailing12Months, forwardPE, trailingPE
  'financialData',                      // profitMargins, operatingMargins, grossMargins, freeCashflow, totalRevenue, revenueGrowth
  'defaultKeyStatistics',               // sharesOutstanding, beta, enterpriseValue
  'incomeStatementHistory',             // annual rev/OpInc/NetInc/grossProfit
  'balanceSheetHistory',                // cash, debt, totalAssets
  'cashflowStatementHistory',           // OpCash, capex
  'incomeStatementHistoryQuarterly',    // quartal-rev/OpInc — für Acceleration-Detection
  'price',                              // currency, exchange
  'assetProfile',                       // sector, industry
  'insiderTransactions',                // Tag 137: Form 4 insider buy/sell activity
  'earningsTrend',                      // Tag 211h: epsRevisions per period — activates analyst-revision-breadth
  // Tag 220c (audit F-219c-F6 MEDIUM): majorHoldersBreakdown — institutionsPercentHeld,
  // institutionsCount, insidersPercentHeld. Free fallback for institutional-ownership-13f
  // when the SEC 13F by-ticker cache is missing or hasn't been refreshed yet.
  'majorHoldersBreakdown',
  // Tag 220c (audit F-219c-F7 MEDIUM): earningsHistory — last 4 quarters with
  // epsActual / epsEstimate / epsDifference / surprisePercent / quarter.
  // Exposed via stock.external.earningsHistory; no new method (data lake build).
  'earningsHistory'
];

// ─── Task 0.13 (Tag 288): Schema-Salvage für falsch-negative Validator-Rejects ──
// Befund 0.12/0.13: 1.126 LEBENDE Ticker (ADYEN.AS, 4188.T Mitsubishi Chemical,
// 5101.T Yokohama Rubber, ALOT, …) scheiterten client-seitig am strikten
// yahoo-finance2-Schema: Yahoo lässt in earningsHistory.history[i] die Keys
// epsActual/epsEstimate/epsDifference/surprisePercent für Quartale ohne
// Estimate/Actual GANZ WEG (typisch JP/EU-Titel), das Schema verlangt die Keys
// aber als required (number|null — identisch bis v3.15.4, Library-Update fixt
// nichts). Ein Loch im unkritischen Enrichment-Modul riss so den kompletten
// 13-Module-Payload ab → Ticker zählte als schema-fail, obwohl Kurs, MCap und
// Jahres-GuV vollständig da sind.
//
// Vorsicht F-A-2026-06-21 (audit-reports/2026-06-21-round1-raw-findings.json,
// A-pull-yahoo-02-Verdict) bleibt gewahrt — validateResult wird NICHT (auch
// nicht per Call) abgeschaltet: der Validator läuft unverändert und wirft
// weiter; die {raw,fmt}→Number/Date-Koerzierung passiert in-place VOR dem
// Throw (empirisch verifiziert 2026-07-10: e.result trägt plain numbers +
// echte Date-Instanzen). Gerettet wird NUR, wenn alle drei Bedingungen halten:
//   1. ALLE Validator-Fehler liegen in SALVAGEABLE_MODULES — Enrichment-Module,
//      deren Konsumenten (_v/_y/_normTxTs) ohnehin defensiv unwrappen/nullen.
//      Fehler in price/summaryDetail/financialData/Statements → weiter Reject.
//   2. Ein whitelisted Modul mit einem ANDEREN Fehler als "Missing required
//      properties" (z. B. Typ-Mismatch à la Issue #839) wird KOMPLETT aus dem
//      Payload entfernt (fehlendes Modul = null bei allen Konsumenten). Es
//      bleibt also nie schema-invalides Material im geretteten Payload —
//      Löcher bleiben Löcher, Müll fliegt raus.
//   3. Pflichtfeld-Check: price.regularMarketPrice finite > 0 UND
//      price.currency non-empty string. Das lasttragende Paar (Kurs = Herz des
//      Snapshots, currency treibt die gesamte FX-Skalierung). Eine leere Hülle
//      / ein kaputter Payload bleibt ein Fail.
const SALVAGEABLE_MODULES = new Set([
  'earningsHistory', 'earningsTrend', 'insiderTransactions', 'majorHoldersBreakdown'
]);
function salvageValidationReject(e) {
  if (!e || e.name !== 'FailedYahooValidationError') return null;
  const res = e.result;
  const errs = e.errors;
  if (!res || typeof res !== 'object' || !Array.isArray(errs) || errs.length === 0) return null;
  const seen = new Set();
  const dropModules = new Set();
  for (const err of errs) {
    const mod = String((err && err.instancePath) || '').split('/')[1] || '';
    if (!SALVAGEABLE_MODULES.has(mod)) return null; // Fehler außerhalb Enrichment → echter Fail
    seen.add(mod);
    if (!/^Missing required propert/.test(String((err && err.message) || ''))) dropModules.add(mod);
  }
  const p = res.price;
  const px = p && p.regularMarketPrice;
  if (!p || !Number.isFinite(px) || px <= 0) return null;
  if (typeof p.currency !== 'string' || p.currency.length === 0) return null;
  for (const m of dropModules) delete res[m];
  return { result: res, salvagedModules: [...seen].sort() };
}

// ─── Logger ───────────────────────────────────────────────────────


// Tag-87c / Tag-133b: FX-Rates für Currency-Conversion (USD-base).
// Live-Rates aus fx-rates.json (refresh-fx.js Workflow-Step) wenn vorhanden + frisch (≤14d).
// Fallback: hardgecodete Tabelle (kann Monate stale sein — flagged via _log WARN).
// F-DQ-007 (Tag 188): FX_FALLBACK expanded to match refresh-fx.js CURRENCIES list.
// One missed CI run >14 days ago previously left TRY/IDR/EM tickers silently
// fxConversionFailed (no rate at all → meta.fxRateApplied=null) — universe
// effectively shrank without alarm. Hardcoded fallbacks are stale 2026-Q1 ish;
// flagged via FX_PROVENANCE='fallback-hardcoded' so downstream code can warn.
const FX_FALLBACK = {
  USD: 1.0, EUR: 1.08, GBP: 1.27, CHF: 1.10,
  SEK: 0.095, NOK: 0.092, DKK: 0.145,
  JPY: 0.0067, HKD: 0.128, CNY: 0.139,
  AUD: 0.65, CAD: 0.74, KRW: 0.00074, INR: 0.012,
  TWD: 0.031, BRL: 0.20, MXN: 0.058, ZAR: 0.054,
  SGD: 0.74,
  // F-DQ-007 additions — currencies refresh-fx now fetches but FX_FALLBACK lacked.
  PLN: 0.25, TRY: 0.029, THB: 0.029, IDR: 0.000063,
  MYR: 0.22, PHP: 0.018, VND: 0.000040, CZK: 0.044,
  HUF: 0.0028, RON: 0.22, AED: 0.27, SAR: 0.27,
  QAR: 0.27, ILS: 0.27
};
const FX_STALE_DAYS = 14;
let FX_TO_USD = FX_FALLBACK;
let FX_SOURCE = 'fallback-hardcoded';
// F-DQ-003 (Tag 181): track per-currency provenance so a per-stock conversion can
// report whether its specific rate was live or 2024-hardcoded. Without this,
// Object.assign(FX_FALLBACK, raw.rates) for a partial-refresh leaked stale 2024
// values into snapshots whose fxRateSource reported "live".
const FX_PROVENANCE = {};   // key uppercase currency → 'live' | 'fallback-hardcoded'
for (const k of Object.keys(FX_FALLBACK)) FX_PROVENANCE[k] = 'fallback-hardcoded';
(function loadFx() {
  try {
    const fxPath = require('path').join(__dirname, 'fx-rates.json');
    if (!require('fs').existsSync(fxPath)) return;
    const raw = JSON.parse(require('fs').readFileSync(fxPath, 'utf8'));
    if (!raw || !raw.rates || typeof raw.rates !== 'object') return;
    const fetchedAt = raw.fetchedAt ? new Date(raw.fetchedAt) : null;
    const ageDays = fetchedAt ? (Date.now() - fetchedAt.getTime()) / 86400000 : Infinity;
    if (ageDays > FX_STALE_DAYS) {
      console.log('[FX] fx-rates.json is ' + ageDays.toFixed(1) + 'd old — using fallback');
      return;
    }
    // F-DP-008: raw.rates may carry verbatim casing (e.g. "Eur", "gbp") while
    // every lookup uppercases the currency (FX_TO_USD[ccy.toUpperCase()]). An
    // Object.assign of raw.rates verbatim leaves lower/mixed-case keys that the
    // uppercased reads never hit — the rate is silently ignored and the value
    // falls through to FX_FALLBACK (or stale). Seed the table uppercased.
    FX_TO_USD = Object.assign({}, FX_FALLBACK);
    for (const [k, rate] of Object.entries(raw.rates)) {
      FX_TO_USD[k.toUpperCase()] = rate;
    }
    FX_SOURCE = 'fx-rates.json @ ' + (raw.fetchedAt || 'unknown');
    // F-DP-051 / F-DQ-008 (Tag 188): per-currency staleness gate.
    // refresh-fx now writes currencyMeta[c].lastSuccessAt per-currency, but the
    // top-level fetchedAt only fails the freshness check above if EVERY currency
    // failed >14d. If TRY/IDR/EM-currency individually has been failing for 30d
    // while majors succeed, fetchedAt looks fresh and the stale per-currency rate
    // is silently applied — whole EM legs mis-priced. Honor lastSuccessAt: drop
    // rates whose per-currency last success is older than FX_STALE_DAYS so the
    // fallback table (with provenance='fallback-hardcoded') takes over.
    const currencyMeta = raw.currencyMeta || {};
    const failedList = Array.isArray(raw.failed) ? raw.failed : [];
    let staleCount = 0;
    let inFailedButFreshCount = 0;
    for (const k of Object.keys(raw.rates)) {
      const up = k.toUpperCase();
      const meta = currencyMeta[k] || currencyMeta[up] || null;
      const lastSuccess = meta && meta.lastSuccessAt ? new Date(meta.lastSuccessAt) : fetchedAt;
      const perCurAgeDays = lastSuccess
        ? (Date.now() - lastSuccess.getTime()) / 86400000
        : Infinity;
      const inFailedList = failedList.includes(k) || failedList.includes(up);
      if (perCurAgeDays > FX_STALE_DAYS) {
        // F-DP-051 / F-DQ-008: revert to FX_FALLBACK; mark provenance so
        // snapshot-side ratios that depend on this currency can flag
        // fxRateSource accordingly.
        if (FX_FALLBACK[up] != null) {
          FX_TO_USD[up] = FX_FALLBACK[up];
        } else {
          delete FX_TO_USD[up];  // no fallback at all → conversion will fail loudly
        }
        FX_PROVENANCE[up] = 'fallback-hardcoded';
        staleCount++;
        console.log('[FX] ' + up + ' stale (' + perCurAgeDays.toFixed(1) +
          'd since last success) → using fallback');
      } else {
        FX_PROVENANCE[up] = 'live';
        FX_TO_USD[up] = raw.rates[k];  // ensure uppercase key lookup hits
        // F-DP-034 (Tag 190): if the latest refresh-fx run failed THIS currency
        // but last-success is still within FX_STALE_DAYS, the rate is OK for
        // now — but worth flagging so operators see drift before it tips over
        // into the hard stale branch.
        if (inFailedList) {
          inFailedButFreshCount++;
          console.warn('[FX] ' + up + ' in failed[] of latest refresh-fx run; ' +
            'rate still fresh (' + perCurAgeDays.toFixed(1) + 'd) — monitor');
        }
      }
    }
    const liveCount = Object.values(FX_PROVENANCE).filter(v => v === 'live').length;
    const fallbackCount = Object.values(FX_PROVENANCE).filter(v => v === 'fallback-hardcoded').length;
    console.log('[FX] Loaded ' + Object.keys(raw.rates).length + ' rates from fx-rates.json (' +
      liveCount + ' live, ' + fallbackCount + ' fallback' +
      (staleCount > 0 ? ', ' + staleCount + ' reverted from stale per-currency' : '') +
      (inFailedButFreshCount > 0 ? ', ' + inFailedButFreshCount + ' in failed[] but fresh' : '') + ')');
  } catch (e) {
    console.log('[FX] fx-rates.json load failed: ' + e.message + ' — using fallback');
  }
})();
// Tag 134: stable region enum derived from currency + exchangeName.
// Replaces the prior bug where meta.region held Yahoo's raw exchangeName
// like "NasdaqGS" / "Frankfurt", which the engine then compared against
// "US" / "EU" — never matched, fell through to 0.25 tax rate fallback.
const REGION_BY_CURRENCY = {
  USD: 'US', CAD: 'CA',
  EUR: 'EU', GBP: 'UK', GBp: 'UK', CHF: 'CH',
  SEK: 'SE', NOK: 'NO', DKK: 'DK', PLN: 'EU',
  JPY: 'JP', HKD: 'HK', CNY: 'CN', KRW: 'KR', TWD: 'TW',
  SGD: 'SG', INR: 'IN', THB: 'EM', IDR: 'EM',
  AUD: 'AU', NZD: 'AU',
  BRL: 'EM', MXN: 'EM', ZAR: 'EM', RUB: 'EM', TRY: 'EM',
  SAR: 'EM', AED: 'EM', ILS: 'EM'
};
function normalizeRegion(currency, exchangeName) {
  if (currency) {
    const cur = String(currency);
    const region = REGION_BY_CURRENCY[cur] || REGION_BY_CURRENCY[cur.toUpperCase()];
    if (region) return region;
  }
  const exch = String(exchangeName || '').toLowerCase();
  if (/nasdaq|nyse|amex|otc|pink|bats/.test(exch)) return 'US';
  if (/london|lse/.test(exch)) return 'UK';
  if (/frankfurt|xetra|stuttgart|berlin|munich|tradegate/.test(exch)) return 'EU';
  if (/paris|euronext|amsterdam|brussels|lisbon|milan/.test(exch)) return 'EU';
  if (/tokyo|osaka/.test(exch)) return 'JP';
  if (/hong ?kong|hkex/.test(exch)) return 'HK';
  if (/shanghai|shenzhen/.test(exch)) return 'CN';
  if (/toronto|tsx/.test(exch)) return 'CA';
  if (/sydney|asx|aussie/.test(exch)) return 'AU';
  return 'OTHER';
}

// Tag 134: single-pass USD normalization applied at end of mapper.
// Closes the structural defect where marketCap was USD but annual/quarterly
// series were left in reportingCurrency — silently corrupting every ratio
// (fcf-yield, ev/ebitda, etc.) for non-USD stocks.
// Bug 1 (audit 2026-07-03): trading-currency scaling for marketCap + analyst
// targets, extracted so it runs in BOTH the USD-reporter and non-USD-reporter
// branches of _convertSnapshotToUSD. Yahoo returns marketCap and
// targetMean/MedianPrice in the TRADING currency (snap.price.currency /
// snap.meta.tradingCurrency), which for a USD-REPORTING but foreign-LISTED
// ticker (e.g. 1299.HK: financialCurrency='USD', price.currency='HKD') differs
// from the reporting currency. Previously the USD branch early-returned before
// this check, so those fields stayed in the trading currency while the snapshot
// claimed 'USD, converted' → mcap ~7.8× overstated (HKD), every mcap ratio and
// analyst upside corrupted, and a flip-flop vs the price-only fast path.
//
// financialFactor is the reporting→USD factor already applied to annual/metrics
// (1.0 in the USD branch). Returns:
//   { ok: true }               → marketCap/targets scaled in place (no-op when
//                                trading ccy == reporting ccy, factor unchanged)
//   { ok: false }              → fail-closed: trading ccy differs but FX_TO_USD
//                                has no finite rate; caller must flag+return.
function _applyTradingScale(snap, financialFactor) {
  const origCurrency = snap.meta.reportingCurrency || 'USD';
  const tradingCcyRaw = (snap.price && snap.price.currency)
    ? String(snap.price.currency)
    : ((snap.meta && snap.meta.tradingCurrency) ? String(snap.meta.tradingCurrency) : null);
  let tradingFactor = financialFactor; // default: no divergence → identity vs financial factor
  if (tradingCcyRaw && tradingCcyRaw.toUpperCase() !== origCurrency.toUpperCase()) {
    // Match ONLY genuine pence: 'GBp' (lowercase p) or 'GBX' (uppercase X).
    const tradingPence = tradingCcyRaw === 'GBp' || tradingCcyRaw === 'GBX' || tradingCcyRaw.toUpperCase() === 'GBPENCE';
    const tradingKey = tradingPence ? 'GBP' : tradingCcyRaw.toUpperCase();
    const tradingRate = FX_TO_USD[tradingKey];
    if (tradingRate != null && Number.isFinite(tradingRate)) {
      tradingFactor = tradingPence ? tradingRate / 100 : tradingRate;
      snap.meta.tradingCurrencyOriginal = tradingCcyRaw;
      snap.meta.tradingFxRateApplied = tradingFactor;
    } else {
      // FAIL CLOSED — trading ccy differs but no finite rate; do not persist a
      // silently mis-scaled marketCap (mirrors the reporting-missing branch).
      snap.meta.tradingCurrencyOriginal = tradingCcyRaw;
      snap.meta.tradingFxRateApplied = null;
      snap.meta.tradingFxMissing = true;
      snap.meta.fxConversionFailed = true;
      snap.meta.fxConverted = false;
      return { ok: false };
    }
  }
  const scaleTrading = (item) => {
    if (item == null) return item;
    if (typeof item === 'number') return Number.isFinite(item) ? item * tradingFactor : item;
    if (typeof item !== 'object') return item;
    if ('value' in item) {
      const out = Object.assign({}, item);
      if (typeof item.value === 'number' && Number.isFinite(item.value)) out.value = item.value * tradingFactor;
      return out;
    }
    const out = {};
    for (const [k, v] of Object.entries(item)) {
      out[k] = (typeof v === 'number' && Number.isFinite(v)) ? v * tradingFactor : v;
    }
    return out;
  };
  if (snap.marketCap) snap.marketCap = scaleTrading(snap.marketCap);
  if (snap.metrics) {
    for (const k of ['targetMeanPrice', 'targetMedianPrice']) {
      if (snap.metrics[k]) snap.metrics[k] = scaleTrading(snap.metrics[k]);
    }
  }
  return { ok: true };
}

function _convertSnapshotToUSD(snap) {
  if (!snap || !snap.meta) return snap;
  // F-DP-008: idempotency guard — if already converted, return immediately to prevent double-scaling
  if (snap.meta.fxConverted === true) return snap;
  const origCurrency = snap.meta.reportingCurrency || 'USD';
  if (origCurrency === 'USD') {
    // F-NY-004 (audit 2026-06-08): 'USD' here may be a GUESS — when Yahoo returns
    // no financialCurrency, the mapper falls back to the trading currency and sets
    // ccyAmbiguous. For OTC/pink-sheet listings that combination almost always
    // means a foreign issuer whose financials are in a third currency (NEXHY→EUR,
    // RKWAF→DKK observed live): annual.* would stay local-ccy while marketCap is
    // USD — a silent mixed-currency snapshot. Fail closed instead: flag
    // fxConversionFailed so the pull loop skips the ticker (3 of 4680 snapshots
    // affected as of 2026-06-10). Exchange-listed tickers (NYSE/NASDAQ) keep the
    // USD assumption — US filers report USD.
    if (snap.meta.ccyAmbiguous === true && /otc|pnk|pink/i.test(snap.meta.exchangeName || '')) {
      snap.meta.reportingCurrencyOriginal = 'USD?';
      snap.meta.fxRateApplied = null;
      snap.meta.fxConversionFailed = true;
      snap.meta.fxConverted = false;
      return snap;
    }
    // Bug 1 (audit 2026-07-03): even for a USD REPORTER, marketCap + analyst
    // targets are in the TRADING currency, which for a foreign-LISTED USD
    // reporter (1299.HK etc.) is NOT USD. Scale them here (financial factor = 1.0)
    // before the early return, mirroring the non-USD branch. No-op when the
    // ticker actually trades in USD (tradingFactor = 1.0). Fail-closed if the
    // trading ccy differs but has no finite rate.
    if (!_applyTradingScale(snap, 1.0).ok) return snap;
    snap.meta.reportingCurrencyOriginal = 'USD';
    snap.meta.fxRateApplied = 1.0;
    snap.meta.fxConverted = true;
    return snap;
  }

  // Tag 148: British pence (GBp/GBX) — Yahoo quotes some UK shares in pence, not pounds.
  // marketCap and financial values are already 100x too small relative to GBP.
  // Divide by 100 first to convert pence → pounds, then apply the GBP→USD rate.
  // audit/fix GBP-pence (2026-06-25): case-SENSITIVE pence test. The previous
  // /^GB[Xp]$/i used the /i flag, so the char class [Xp] also matched the uppercase
  // 'P' in 'GBP' → GBP (pounds) was misclassified as pence → factor = GBP_rate/100
  // → ALL GBP-reported financials (revenue/EBITDA/EV, every annual & timeseries
  // series) came out 100× too small. Genuine pence currencies are 'GBp' (lowercase p)
  // and 'GBX' (uppercase X); pounds is 'GBP'. Match ONLY genuine pence, exactly.
  const isPence = origCurrency === 'GBp' || origCurrency === 'GBX' || origCurrency.toUpperCase() === 'GBPENCE';
  const fxKey = isPence ? 'GBP' : origCurrency.toUpperCase();

  const rate = FX_TO_USD[fxKey];
  if (rate == null) {
    // unknown currency — keep values as-is, flag for diagnostics
    snap.meta.reportingCurrencyOriginal = origCurrency;
    snap.meta.fxRateApplied = null;
    snap.meta.fxConversionFailed = true;
    snap.meta.fxConverted = false; // F-DP-008: not converted
    return snap;
  }
  // F-DP-024 / F-DQ-003 (Tag 181): per-currency provenance — even when FX_SOURCE
  // is fx-rates.json overall, a specific currency that wasn't in raw.rates is
  // still on the 2024 hardcoded fallback. Report that accurately per snapshot.
  const perCurrency = FX_PROVENANCE[fxKey] || 'fallback-hardcoded';
  if (FX_SOURCE === 'fallback-hardcoded' || perCurrency === 'fallback-hardcoded') {
    if (FX_SOURCE === 'fallback-hardcoded') {
      console.warn(`FX-FALLBACK: using hardcoded 2024 rates for ${fxKey} — may be stale. Consider running refresh-fx.js`);
    }
    snap.meta.fxRateSource = perCurrency === 'live' ? FX_SOURCE : 'hardcoded-fallback';
  } else {
    snap.meta.fxRateSource = FX_SOURCE;
  }

  // Combined factor: pence→pounds (÷100) then pounds→USD (*rate), or just *rate for normal currencies.
  const factor = isPence ? rate / 100 : rate;

  // Tag 232c-8 (audit F-DP-005 HIGH): detect the ADR pattern where Yahoo
  // returns marketCap and price.regularMarketPrice in the TRADING currency
  // (e.g. USD for NYSE-listed TSM/BABA/NU) while the financial reporting
  // currency is foreign (TWD/CNY/HKD). The financial-ccy factor (`factor`
  // above) is correct for annual/quarterly/metrics — those are in reporting
  // currency. But scaling trading-ccy mcap/price by the financial factor
  // produces ~32× too small numbers, then the $1B mcap floor at
  // pull-yahoo.js:1647 silently unlinks the snapshot. Companion fix to
  // Tag 232a-4 which closed the same gap in the price-only fast path.
  //
  // tradingCcy comes from snap.price.currency (Yahoo's quote response,
  // captured by the mapper). When it differs from origCurrency, the
  // ticker is an ADR-class and trading-fx-rate applies to mcap/price.
  // NEW-2/NEW-3 (2026-06-13 audit): snap.price is ONLY present on the
  // price-only fast-path; the full-pull mapper never builds snap.price, so
  // tradingCcyRaw was always null on full pulls and the ADR trading-factor
  // override (and the F-DQ-001 analyst-target fix that depends on it) were
  // dead — ADR marketCap/targets were silently scaled by the reporting-ccy
  // factor (~32× off for TWD-reporting ADRs like TSM). Fall back to
  // snap.meta.tradingCurrency (mapper line 814), which carries the trading
  // quote currency on every full pull.
  const tradingCcyRaw = (snap.price && snap.price.currency)
    ? String(snap.price.currency)
    : ((snap.meta && snap.meta.tradingCurrency) ? String(snap.meta.tradingCurrency) : null);
  let tradingFactor = factor;  // default: equals financial factor (no special handling)
  let tradingOverride = false;
  if (tradingCcyRaw && tradingCcyRaw.toUpperCase() !== origCurrency.toUpperCase()) {
    // audit/fix GBP-pence (2026-06-25): case-SENSITIVE pence test (see ~line 313).
    // /^GB[Xp]$/i matched the 'P' in 'GBP' under /i → GBP trading ccy was treated as
    // pence → trading marketCap/price scaled by GBP_rate/100 (100× too small).
    // Match ONLY genuine pence: 'GBp' (lowercase p) or 'GBX' (uppercase X).
    const tradingPence = tradingCcyRaw === 'GBp' || tradingCcyRaw === 'GBX' || tradingCcyRaw.toUpperCase() === 'GBPENCE';
    const tradingKey = tradingPence ? 'GBP' : tradingCcyRaw.toUpperCase();
    const tradingRate = FX_TO_USD[tradingKey];
    if (tradingRate != null && Number.isFinite(tradingRate)) {
      tradingFactor = tradingPence ? tradingRate / 100 : tradingRate;
      tradingOverride = true;
      snap.meta.tradingCurrencyOriginal = tradingCcyRaw;
      snap.meta.tradingFxRateApplied = tradingFactor;
    } else {
      // audit/fix F4 (2026-06-25): FAIL CLOSED. The trading currency differs from the
      // reporting currency (ADR-class) but FX_TO_USD has no finite rate for it. The
      // old code silently left tradingFactor = reporting `factor`, so marketCap (and
      // analyst targets) got scaled by the WRONG rate and the snapshot was written
      // with a mis-scaled mcap and NO flag — exactly the silent corruption the
      // reporting-missing branch (~line 306) already guards against. Mirror that
      // branch: flag fxConversionFailed (+ a directional tradingFxMissing marker) and
      // return so the full-pull loop's fxConversionFailed skip (~line 2088) DROPS the
      // ticker instead of persisting a silently mis-scaled marketCap.
      snap.meta.tradingCurrencyOriginal = tradingCcyRaw;
      snap.meta.tradingFxRateApplied = null;
      snap.meta.tradingFxMissing = true;
      snap.meta.fxConversionFailed = true;
      snap.meta.fxConverted = false;
      return snap;
    }
  }

  function scale(item) {
    if (item == null) return item;
    if (typeof item === 'number') return Number.isFinite(item) ? item * factor : item;
    if (typeof item !== 'object') return item;
    if ('value' in item) {
      const out = Object.assign({}, item);
      if (typeof item.value === 'number' && Number.isFinite(item.value)) out.value = item.value * factor;
      return out;
    }
    // balance-sheet rows: { totalCash, totalDebt, totalAssets }
    const out = {};
    for (const [k, v] of Object.entries(item)) {
      out[k] = (typeof v === 'number' && Number.isFinite(v)) ? v * factor : v;
    }
    return out;
  }

  // Tag 232c-8: dedicated scaler for trading-currency values (mcap, price).
  // Identical math to scale() but uses tradingFactor; identity when
  // tradingFactor === factor (the non-ADR common case, zero overhead).
  function scaleTrading(item) {
    if (item == null) return item;
    if (typeof item === 'number') return Number.isFinite(item) ? item * tradingFactor : item;
    if (typeof item !== 'object') return item;
    if ('value' in item) {
      const out = Object.assign({}, item);
      if (typeof item.value === 'number' && Number.isFinite(item.value)) out.value = item.value * tradingFactor;
      return out;
    }
    const out = {};
    for (const [k, v] of Object.entries(item)) {
      out[k] = (typeof v === 'number' && Number.isFinite(v)) ? v * tradingFactor : v;
    }
    return out;
  }

  // Tag 232c-8: route marketCap through the trading scaler. Equivalent to
  // scale() when ticker is not ADR-class (tradingFactor === factor, no-op).
  // We intentionally do NOT scale snap.price here — the pre-Tag-232c-8 code
  // never scaled price either (price stays in trading currency by design,
  // consumed by callers that know how to combine it with the converted mcap).
  // Changing that invariant is out of scope for an HIGH-severity targeted fix.
  if (snap.marketCap) snap.marketCap = scaleTrading(snap.marketCap);
  // Tag 204 (Bug #2 — architectural, LOW severity): explicit metrics.* allow-list.
  // The previous code only scaled `metrics.revenueTTM` ad-hoc; any future
  // currency-denominated metrics field (e.g. fcfTTM, ebitda, enterpriseValue,
  // bookValuePerShare) would silently bypass FX conversion and stay in local ccy.
  // We enumerate explicitly here so additions are reviewed at this single site.
  // RATIOS (margin/growth/pe/priceSales/sbcRatio/insidersOwnership) and counts
  // (cashRunway in months) are NOT included — they are unit-less or cancel out.
  const CCY_DENOMINATED_METRICS = [
    'revenueTTM',
    'fcfTTM',            // currently absent from metrics.* but reserved
    'ebitda',            // POPULATED (Tag 219, financialData.ebitda) — reporting ccy, scaled by `factor` here. Correct: EBITDA is an income-statement quantity in the reporting currency.
    // POPULATED (Tag 219, defaultKeyStatistics.enterpriseValue) — scaled by reporting `factor` here.
    // F2 (audit 2026-06-25) flagged a SUSPECTED mis-scale for dual-non-USD ADRs (trading HKD /
    // reporting CNY): EV is market-derived (mcap + net debt) and Yahoo MAY report it in the TRADING
    // currency like marketCap (which uses scaleTrading/tradingFactor). The comment asked for
    // NEEDS-LIVE-CONFIRMATION before moving EV to the trading-factor list.
    //
    // >>> LIVE-CONFIRMATION LIEGT VOR (2026-07-27, gemessen am snapshots-Artefakt des CI-Laufs
    // 30213797442, 12 321 Snapshots). F2 ist BESTAETIGT, aber nur fuer eine klar umrissene
    // Teilmenge: Namen mit reportingCurrency === 'USD' UND tradingCurrency !== 'USD'. Dort ist der
    // reporting `factor` = 1, EV wird also unveraendert durchgereicht — Yahoo liefert es aber in der
    // TRADING-Waehrung. Das Verhaeltnis EV/marketCap ist dann exakt der Wechselkurs:
    //   .JK (IDR): 26 Namen, Faktor 17 968-17 970  (IDR/USD)
    //   .SN (CLP): 12 Namen, Faktor  949-  954     (CLP/USD)
    //   .NS (INR),  .IS (TRY),  .T (JPY): einzelne Namen mit dem jeweiligen Kurs
    // Beispiel MEDC.JK: tc=IDR, rc=USD, mcap 1,82 Mrd, EV 32 705 Mrd.
    //
    // NICHT geaendert, bewusst: der Umbau auf den trading-Faktor betraefe JEDEN nicht-USD-Namen,
    // und fuer die Gegenrichtung (reporting non-USD, trading non-USD) fehlt der Beleg weiterhin —
    // eine pauschale Umstellung koennte dort korrekte Werte kaputt machen. WIRKUNG heute begrenzt:
    // enterpriseValue fliesst in KEINE Score-Achse (src/scoring/axes.js kennt das Feld nicht);
    // Konsument ist lib/e1-compression.js (EV/Sales), das noch nicht scharf verdrahtet ist.
    // Naechster Schritt waere ein gezielter Fix genau fuer die Teilmenge oben plus ein Test, der
    // das Verhaeltnis EV/marketCap gegen fx-rates.json prueft. Karl-Frage dazu im Nachtlauf-Protokoll.
    'enterpriseValue',
    'bookValuePerShare', // currently absent — reserved
    'cashPerShare'       // currently absent — reserved
  ];
  if (snap.metrics) {
    for (const k of CCY_DENOMINATED_METRICS) {
      if (snap.metrics[k]) snap.metrics[k] = scale(snap.metrics[k]);
    }
    // F-DQ-001 (Tag 233d): analyst price targets are quoted in TRADING currency
    // (same as `price`/`marketCap`), NOT the financial-reporting currency. Route
    // them through scaleTrading() (tradingFactor), mirroring how marketCap is
    // handled — scale()'s reporting `factor` mis-prices targets for ADR-class
    // tickers where tradingFactor !== factor. (Non-ADR: tradingFactor === factor,
    // so this is a no-op; the analyst-upside ratio vs currentPrice stays correct.)
    const CCY_DENOMINATED_TRADING_METRICS = ['targetMeanPrice', 'targetMedianPrice'];
    for (const k of CCY_DENOMINATED_TRADING_METRICS) {
      if (snap.metrics[k]) snap.metrics[k] = scaleTrading(snap.metrics[k]);
    }
  }
  if (snap.annual) {
    for (const key of Object.keys(snap.annual)) {
      // NEW-4 (2026-06-13 audit): annualShares is a unit-less share COUNT, not a
      // currency amount. FX-scaling it inflated absolute share counts by the FX
      // factor for non-USD reporters (corrupting dcf-intrinsic-value's per-share
      // math) and desynced it from the unscaled meta.sharesOutstanding. YoY-ratio
      // consumers cancel the factor and are unaffected either way. Skip scaling.
      if (key === 'annualShares') continue;
      if (Array.isArray(snap.annual[key])) snap.annual[key] = snap.annual[key].map(scale);
    }
  }
  if (snap.timeseries) {
    for (const key of Object.keys(snap.timeseries)) {
      // audit/fix A10: *Ends sind ISO-Datums-Strings (Perioden-Enden), keine
      // Währungsbeträge — nicht durch scale() jagen (das würde sie zu NaN machen).
      if (key.endsWith('Ends')) continue;
      if (Array.isArray(snap.timeseries[key])) snap.timeseries[key] = snap.timeseries[key].map(scale);
    }
  }
  snap.meta.reportingCurrencyOriginal = origCurrency;
  snap.meta.reportingCurrency = 'USD';
  // For GBp: store the effective combined factor (pence→USD = GBP_rate/100).
  // fxRateApplied reflects what was actually multiplied so callers can reverse if needed.
  snap.meta.fxRateApplied = factor;
  // F-DP-008: mark as converted to prevent double-scaling on subsequent calls
  snap.meta.fxConverted = true;
  return snap;
}

function _ts() { return new Date().toISOString(); }
function _log(level, msg) { console.log(`[${_ts()}] [${level}] ${msg}`); }

// ─── Mapper-Helpers ───────────────────────────────────────────────

function _y(obj, ...keys) {
  let cur = obj;
  for (const k of keys) {
    if (cur == null) return null;
    cur = cur[k];
  }
  // yahoo-finance2 unwrappt {raw, fmt} schon zu Number — meistens.
  if (cur && typeof cur === 'object' && 'raw' in cur) return cur.raw;
  return cur;
}

function _metric(value, source, confidence, asOf) {
  if (value == null || (typeof value === 'number' && !Number.isFinite(value))) return null;
  return { value, source, confidence, asOf };
}

// bug-fix (audit 2026-06-21): trim only TRAILING nulls, preserving interior null years so sibling
// annual arrays stay positionally aligned (methods zip annualRev[i] with annualOpInc[i]/annualFCF[i]
// /annualOCF[i] by index). The old .filter(Boolean) compacted nulls per-array, desyncing the index
// across fields. Matches the FTS path (_ftsExtractByYear) and annualRnD, which already null-preserve.
function _trimTrailingNull(mapped) {
  let end = mapped.length;
  while (end > 0 && mapped[end - 1] == null) end--;
  return mapped.slice(0, end);
}

function _arr(history, key) {
  if (!Array.isArray(history)) return [];
  return _trimTrailingNull(history.map(r => {
    const v = _y(r, key);
    return v == null ? null : { value: v };
  }));
}

// audit/fix A10 (2.3-Vorbedingung, §4b Fundamental-Delivery-IC): das Perioden-Ende
// eines Quartals als ISO-Tag "YYYY-MM-DD". Akzeptiert Date, {raw:epoch}, epoch-Zahl
// (Sekunden ODER ms) und "YYYY-MM-DD…"-String. null wo unbekannt — nie fabrizieren.
function _isoDay(v) {
  if (v == null) return null;
  if (typeof v === 'object' && !(v instanceof Date) && 'raw' in v) v = v.raw;
  if (v instanceof Date) return Number.isFinite(v.getTime()) ? v.toISOString().slice(0, 10) : null;
  if (typeof v === 'number' && Number.isFinite(v)) {
    const ms = v < 1e12 ? v * 1000 : v;   // Yahoo-Epochs sind Sekunden, nicht ms
    const d = new Date(ms);
    return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : null;
  }
  if (typeof v === 'string') {
    const m = v.match(/^\d{4}-\d{2}-\d{2}/);
    return m ? m[0] : null;
  }
  return null;
}

// audit/fix A10: Ends-Array index-aligned und LÄNGENGLEICH zu seiner value-Serie
// halten. Fehlt es (z. B. FTS-Cache-Treffer VOR A10 hat keine Enden) → ehrliche
// null-Serie gleicher Länge, kein Fabrizieren. Geschwister-Feld, ändert value-Shape nie.
function _alignEnds(ends, values) {
  const n = Array.isArray(values) ? values.length : 0;
  if (Array.isArray(ends) && ends.length === n) return ends;
  return new Array(n).fill(null);
}

// ─── Tag 203: Fintech-aware OpInc fallback ────────────────────────
// Yahoo's `incomeStatementHistory.operatingIncome` (and FTS counterpart) is
// null for many Financial-Services tickers — banks (JPM, BAC), credit (UPST,
// SOFI, NU), insurance (LMND) — because the bank/insurance income statement
// uses a different chart-of-accounts (net interest income, premiums,
// provisions). Downstream methods that depend on annualOpInc (loss-magnitude-
// guard, metric-divergence-guard, ni-volatility-guard) then silently exit
// `computable:false`, preventing profitable fintech (NU) from being scored.
//
// This helper derives a per-year OpInc estimate from fields that ARE present
// in the canonical payload, only when:
//   (a) sector === 'Financial Services'  (sector-gated; never fires for tech)
//   (b) annualOpInc is empty after both quoteSummary + FTS paths
//
// Three derivation paths, tried in order:
//   1. "computed-bank":      OpInc[y] = totalRev[y] − totalOpEx[y] − provisionForCreditLosses[y]
//   2. "computed-insurance": OpInc[y] = totalRev[y] − costOfRev[y] − SG&A[y]
//   3. "computed-margin":    OpInc[y] = totalRev[y] × (operatingMargins TTM)
// Path 3 is the universal fallback — it works whenever Yahoo provides revenue
// and an operatingMargin metric (almost always true), even though it folds
// year-by-year volatility into a single TTM margin. Methods can flag this
// as derived via `meta.opIncSource`.
//
// Returns { values: [{value:n}, ...]  // latest-first, _arr-compatible
//         , source: 'computed-bank' | 'computed-insurance' | 'computed-margin' | null }
// `null` source means no fallback was possible (annualRev empty AND no margin).
function _deriveOpIncForFinancials(isHist, annualRev, operatingMarginsRaw) {
  // Path 1 & 2: try per-year line-item extraction from raw isHist rows.
  // Banks: totalRev − totalOperatingExpenses − provisionForLoanLeasesAndCreditLosses.
  // Insurance: totalRev − costOfRevenue − sellingGeneralAdministrative.
  // Yahoo legacy isHist rarely populates these for financials (as of 2026),
  // but if it ever does we prefer the line-item derivation over margin × rev.
  const rows = Array.isArray(isHist) ? isHist : [];
  const bankYearly = [];
  const insYearly = [];
  let bankNonNull = 0;
  let insNonNull = 0;
  for (const r of rows) {
    const rev = _y(r, 'totalRevenue');
    if (rev == null) { bankYearly.push(null); insYearly.push(null); continue; }
    // Bank pattern.
    // Tag 206j (Bug-Hunt Agent D MEDIUM F4): only emit a bank-derived OpInc
    // when BOTH operatingExpenses AND provisionForCreditLosses are present.
    // Previously `provisionForCreditLosses ?? 0` defaulted to zero, which
    // SILENTLY OVERSTATES OpInc by 5-15% of revenue for credit-heavy banks
    // where Yahoo omits the provision line (JPM, BAC, C class). Without the
    // provision the bank-pattern math is incomplete — better to push null and
    // let the insurance or margin-fallback paths handle the year.
    const opEx = _y(r, 'totalOperatingExpenses') ?? _y(r, 'operatingExpense');
    const provCL = _y(r, 'provisionForLoanLeasesAndCreditLosses')
                ?? _y(r, 'provisionForCreditLosses');  // NO fallback to 0
    if (opEx != null && provCL != null) {
      bankYearly.push({ value: rev - opEx - provCL });
      bankNonNull++;
    } else {
      bankYearly.push(null);
    }
    // Insurance pattern
    const cor = _y(r, 'costOfRevenue');
    const sga = _y(r, 'sellingGeneralAdministrative');
    if (cor != null && sga != null) {
      insYearly.push({ value: rev - cor - sga });
      insNonNull++;
    } else {
      insYearly.push(null);
    }
  }
  // Prefer the path with the most non-null derived years.
  // F-004 (audit 2026-06-08): keep null placeholders — .filter(Boolean) compressed
  // the array, so annualOpInc[i] referenced a DIFFERENT fiscal year than
  // annualRev[i] for any bank/insurer with a gap year (JPM/BAC/NU/SOFI pattern).
  // Same alignment rule as the FTS path (F-DP-003); consumers null-check entries.
  if (bankNonNull > 0 && bankNonNull >= insNonNull) {
    return { values: bankYearly, source: 'computed-bank' };
  }
  if (insNonNull > 0) {
    return { values: insYearly, source: 'computed-insurance' };
  }

  // Path 3 (universal): margin × revenue. operatingMarginsRaw is a fraction
  // (Yahoo: 0.43741 = 43.741%). Skip if either input missing.
  if (typeof operatingMarginsRaw !== 'number' || !Number.isFinite(operatingMarginsRaw)) {
    return { values: [], source: null };
  }
  if (!Array.isArray(annualRev) || annualRev.length === 0) {
    return { values: [], source: null };
  }
  const derived = annualRev
    .map(r => (r && typeof r.value === 'number' && Number.isFinite(r.value))
        ? { value: r.value * operatingMarginsRaw }
        : null);
  // F-004: null placeholders preserved here too (same mechanism as the bank/
  // insurance paths above) — emptiness now means "no non-null entry".
  if (!derived.some(Boolean)) return { values: [], source: null };
  return { values: derived, source: 'computed-margin' };
}

// ─── Mapper ────────────────────────────────────────────────────────

function mapYahooToCanonical(yahoo, watchlistEntry, asOf) {
  const SRC = 'yahoo_quoteSummary';
  const CONF = 0.9;
  const sd = yahoo.summaryDetail || {};
  const fd = yahoo.financialData || {};
  const ks = yahoo.defaultKeyStatistics || {};
  const ap = yahoo.assetProfile || {};
  const pr = yahoo.price || {};
  const isHist = (yahoo.incomeStatementHistory && yahoo.incomeStatementHistory.incomeStatementHistory) || [];
  const isHistQ = (yahoo.incomeStatementHistoryQuarterly && yahoo.incomeStatementHistoryQuarterly.incomeStatementHistory) || [];
  const cfHist = (yahoo.cashflowStatementHistory && yahoo.cashflowStatementHistory.cashflowStatements) || [];
  const bsHist = (yahoo.balanceSheetHistory && yahoo.balanceSheetHistory.balanceSheetStatements) || [];

  const revGrowth = _y(fd, 'revenueGrowth');
  const revGrowthYoY = revGrowth != null ? revGrowth * 100 : null;

  // Annual-Arrays (latest first)
  const annualRev = _arr(isHist, 'totalRevenue');
  let annualOpInc = _arr(isHist, 'operatingIncome');
  const annualNetIncome = _arr(isHist, 'netIncome');
  const annualGP = _arr(isHist, 'grossProfit');

  // Tag 203: sector-aware OpInc fallback for Financial Services.
  // Yahoo's incomeStatementHistory.operatingIncome is null for banks (JPM,
  // BAC), credit (UPST, SOFI, NU), and insurance (LMND) because the bank/
  // insurance chart-of-accounts differs from industrials. Compute a per-year
  // OpInc estimate so downstream methods (loss-magnitude-guard, ni-volatility-
  // guard, metric-divergence-guard) become computable on profitable fintech.
  // SECTOR-GATED: never fires for non-financial sectors. Source recorded in
  // meta.opIncSource so methods can flag derived data. The FTS-merge in
  // pullAll re-applies this fallback if FTS also produced empty (see line ~990).
  let opIncSource = annualOpInc.length > 0 ? 'native' : null;
  const _sectorRaw = _y(ap, 'sector') || null;
  const _opMargRaw = _y(fd, 'operatingMargins');
  // Tag 206f (Bug-Hunt Agent D HIGH F3): Yahoo occasionally returns 'Financials'
  // (singular) instead of 'Financial Services' for holding-co's (BX, KKR class).
  // Strict equality missed those — fallback never ran for them.
  const _isFinancialSector = (_sectorRaw === 'Financial Services' || _sectorRaw === 'Financials');
  if (annualOpInc.length === 0 && _isFinancialSector) {
    const derived = _deriveOpIncForFinancials(isHist, annualRev, _opMargRaw);
    if (derived.values.length > 0 && derived.source) {
      annualOpInc = derived.values;
      opIncSource = derived.source;
    }
  }
  // Tag 202: annualRnD backfill from quoteSummary.incomeStatementHistory.
  // Bug #25 added FTS-based extraction, but Yahoo's FTS `financials` module
  // omits R&D for some tickers (ASML, V, MA, MSFT, NVDA, GOOG observed).
  // The legacy `incomeStatementHistory.researchDevelopment` field is still
  // populated for those names → use it as a primary source and let FTS
  // override below only when FTS has strictly more non-null entries.
  // Preserves positional alignment with annualRev (same isHist iteration).
  // Stored as raw numbers (latest-first) to match the FTS annualRnD shape.
  const annualRnDFromQS = (isHist || []).map(r => {
    const v = _y(r, 'researchDevelopment');
    return v != null ? v : null;
  });
  // P0-Fix Tag 13: capex-fallback `|| 0` ist gefährlich.
  // NVDA hat real $35B Capex/Jahr — wegfallen lassen verfälscht FCF um Milliarden.
  // Wenn capex unknown, FCF=null statt overstated.
  const annualFCF = _trimTrailingNull((cfHist || []).map(r => {
    const op = _y(r, 'totalCashFromOperatingActivities');
    const capex = _y(r, 'capitalExpenditures');
    if (op == null || capex == null) return null;  // interior null preserved (positional alignment)
    return { value: op + capex };  // Yahoo capex ist negativ → echte Subtraktion
  }));
  // Bug #23: annualOCF never written to snapshot — premium-compounder-proof check #6
  // ((Capex+R&D)/OCF) was always computable:false. Extract OCF directly from cfHist.
  const annualOCF = _trimTrailingNull((cfHist || []).map(r => {
    const op = _y(r, 'totalCashFromOperatingActivities');
    return op != null ? { value: op } : null;  // interior null preserved (positional alignment)
  }));
  // P0-Fix Tag 13: 0+0 wenn beide undefined ist semantisch falsch — Engine sieht Debt=0 statt null.
  // Plus: Yahoo-Field-Name-Drift seit Nov 2024 — multi-fallback für cash.
  const annualBalance = _trimTrailingNull((bsHist || []).map(r => {
    const cash = _y(r, 'cash')
              ?? _y(r, 'cashAndCashEquivalents')
              ?? _y(r, 'cashAndShortTermInvestments');
    const std = _y(r, 'shortLongTermDebt');
    const ltd = _y(r, 'longTermDebt');
    // F-NY-002 (audit 2026-06-08, decided 2026-06-10): absence-as-zero summing is
    // KEPT deliberately — 12.4% of live snapshots carry _debtPartial (568/4589),
    // almost always a genuinely absent current-debt line item; nulling totalDebt
    // when either component is missing would destroy leverage data for all of them.
    // The understatement risk is surfaced instead: _debtPartial is persisted and
    // net-debt-ebitda exposes it as debtPartialFlag in its components.
    // audit F-A-2026-06-21: the _debtPartial flag's consumer-contract risk —
    // it is a boolean that says NOTHING about which leg is missing, so every
    // downstream method must individually opt in to size the understatement and
    // most don't. Hardening (summing itself is out-of-scope / forbidden to change):
    // also persist _debtPartialReason so consumers can tell a missing current-debt
    // line (usually benign) from a missing long-term-debt line (materially
    // understates leverage). Failure mode prevented: silent leverage
    // understatement going unsized because the partial-debt signal carried no
    // direction.
    const totalDebt = (std == null && ltd == null) ? null : (std || 0) + (ltd || 0);
    const _debtPartial = totalDebt != null && (std == null || ltd == null); // F-DQ-001
    const _debtPartialReason = _debtPartial ? (std == null ? 'no-current-debt' : 'no-long-term-debt') : null; // audit F-A-2026-06-21
    const totalAssets = _y(r, 'totalAssets');
    if (cash == null && totalDebt == null && totalAssets == null) return null;  // interior null preserved
    return { totalCash: cash, totalDebt, totalAssets, ...(_debtPartial ? { _debtPartial: true, _debtPartialReason } : {}) };
  }));

  // Quartalsweise Timeseries (latest first → wir flippen NICHT, Engine erwartet latest=index 0)
  const revenueQ = _arr(isHistQ, 'totalRevenue');
  const opIncQ = _arr(isHistQ, 'operatingIncome');
  const grossProfitQ = _arr(isHistQ, 'grossProfit');
  // audit/fix A10 (2.3-Vorbedingung, §4b Delivery-IC): Perioden-Ende je Quartal aus
  // DERSELBEN isHistQ-Row (endDate), index-aligned & längengleich zu revenueQ (das
  // _arr trailing-null-getrimmt hat → slice auf revenueQ.length hält den Index).
  const revenueQEnds = isHistQ.slice(0, revenueQ.length).map(r => _isoDay(_y(r, 'endDate')));
  // A10-Symmetrie: grossProfitQ trimmt via _arr unabhängig von revenueQ → eigenes slice
  // auf grossProfitQ.length (beide newest-anchored an isHistQ[0], Index bleibt aligned).
  const grossProfitQEnds = isHistQ.slice(0, grossProfitQ.length).map(r => _isoDay(_y(r, 'endDate')));

  // FCF-Margin TTM
  // Tag 206b (Bug-Hunt Agent B HIGH-4): Yahoo's fcfMarginTTM is sometimes
  // mathematically implausible — values >200% are virtually always a one-time
  // event (asset sale, divestiture, tax-refund, REIT fair-value movement, M&A
  // working-capital flush). Examples observed: GPT.AX 598%, ASX.AX 275%,
  // 600816.SS 280%. Propagating these inflates R40, pbScore, score-aggregator
  // ratios — every downstream consumer is poisoned.
  //
  // Pattern-based bound: |fcfMargin| > 200% is the smoking gun. Real anchors
  // top out around 50% (MSFT 30, NVDA 27, MA 50, GOOG 25, V 50). Even
  // CRDO/NVDA at extreme growth never exceed 50%. The 200% threshold leaves
  // a very wide margin of safety while catching the obvious artifacts.
  //
  // When fcfMargin exceeds the bound, we null it (forcing downstream methods
  // to use annual.annualFCF / annual.annualRev[0] as the fallback path —
  // which is what rule-of-40.js Tag 201c already does). The validation array
  // gets a structured warning so the audit pipeline can flag affected tickers.
  const fcfTTM = _y(fd, 'freeCashflow');
  const revTTM = _y(fd, 'totalRevenue');
  let fcfMarginTTM = (fcfTTM != null && revTTM && revTTM !== 0) ? (fcfTTM / revTTM) * 100 : null;
  let fcfMarginTTMSuppressed = false;
  if (fcfMarginTTM != null && Math.abs(fcfMarginTTM) > 200) {
    fcfMarginTTMSuppressed = true;
    fcfMarginTTM = null;
  }

  // SBC-Ratio: nicht in Default-Modules — TODO Tag-14: separater financials-Module-Pull
  const sbcRatio = null;

  // Tag 137: Insider transaction activity (last 90 days, open-market buys)
  const insiderActivity = (function() {
    const it = yahoo.insiderTransactions;
    const txns = it && it.transactions;
    if (!txns || !Array.isArray(txns) || txns.length === 0) return null;
    const cutoffMs = Date.now() - 90 * 86400 * 1000;
    let buyCount = 0, sellCount = 0, netShares = 0, lastBuyDate = null;
    // F-DP-053 (Tag 190): normalize startDate via dedicated helper + sanity range.
    // Yahoo has historically passed insider startDate as either seconds, ms, or
    // a parsed Date instance. yahoo-finance2 sometimes converts (depending on
    // schema declaration). A silent unit flip (s vs ms) would shift every
    // timestamp by 1000× — epoch-zero or year-50000 — and the 90d cutoff would
    // silently drop or include the wrong set, flipping the cluster signal.
    // Reject anything outside [2000-01-01, now+1d]; treat as missing.
    const MIN_VALID_MS = Date.UTC(2000, 0, 1);
    const MAX_VALID_MS = Date.now() + 86400 * 1000;
    function _normTxTs(raw) {
      if (raw == null) return null;
      let ms;
      if (raw instanceof Date) ms = raw.getTime();
      else if (typeof raw === 'number') {
        // Heuristic: <1e12 is seconds (1970..~5138 in s), >=1e12 is ms.
        ms = raw < 1e12 ? raw * 1000 : raw;
      } else {
        const parsed = new Date(raw).getTime();
        ms = isNaN(parsed) ? null : parsed;
      }
      if (ms == null || !Number.isFinite(ms)) return null;
      if (ms < MIN_VALID_MS || ms > MAX_VALID_MS) return null;
      return ms;
    }
    // F-DP-038 (Tag 182): "cluster" buys should count UNIQUE insider filers, not
    // total transactions. A single insider buying in 5 separate transactions is
    // momentum-noise, not a cluster signal. Previously clusterBuys90d ≡ buyCount90d
    // which made the "cluster" name misleading. Now: dedupe by filer name.
    const uniqueBuyFilers = new Set();
    for (const tx of txns) {
      const ts = _normTxTs(tx.startDate);
      if (!ts || ts < cutoffMs) continue;
      const text = String(tx.transactionText || '').toLowerCase();
      const shares = (tx.shares && typeof tx.shares === 'object') ? tx.shares.raw : (tx.shares || 0);
      const filer = String(tx.filerName || tx.filerRelation || '').trim();
      // Open-market purchase: text contains "purchase" but NOT "automatic", "grant", "option", "award"
      const isOpenBuy = /purchase/i.test(text) && !/automatic|option|grant|award|vest|exercise/i.test(text);
      const isOpenSell = /sale|sell/i.test(text) && !/automatic/i.test(text);
      if (isOpenBuy) {
        buyCount++;
        netShares += (shares || 0);
        if (filer) uniqueBuyFilers.add(filer);
        const d = new Date(ts).toISOString().slice(0, 10);
        if (!lastBuyDate || d > lastBuyDate) lastBuyDate = d;
      } else if (isOpenSell) {
        sellCount++;
        netShares -= Math.abs(shares || 0);
      }
    }
    return {
      clusterBuys90d: uniqueBuyFilers.size,    // unique filers (cluster signal)
      buyCount90d: buyCount,                    // total open-market buy transactions
      sellCount90d: sellCount,
      netShares90d: netShares,
      lastBuyDate
    };
  })();

  // Tag 204 (Bug #1): ADR-class fix — prefer price.financialCurrency over price.currency
  // when both are present and differ. Yahoo's `price.currency` is the trading-quote ccy
  // (TSM=USD, BABA=USD, 9988.HK=HKD) but financials are reported in the local ccy
  // (TWD, CNY, CNY respectively). Before Tag 204, reportingCurrency was set from
  // `price.currency` → _convertSnapshotToUSD early-returned for ADRs because origCcy
  // matched 'USD', leaving annual.* in trillions of local ccy and corrupting
  // fcf-yield / ev-ebitda / p/s by ~30× for the affected names.
  //
  // Tag 219 (audit F-219c-1 CRITICAL fix): Yahoo's `price` module no longer
  // returns `financialCurrency` (live verified 2026-05-17 on TSM/BABA/9988.HK
  // — all return undefined). Tag 204's intent was to read it from price.
  // The field MOVED to financialData.financialCurrency at some unknown date,
  // making Tag 204 silently dead. ADRs again get the wrong reporting ccy and
  // their financials are mis-FX'd by the ratio of trading-ccy to reporting-ccy.
  // Fix: fall back to financialData.financialCurrency.
  const _fc = _y(pr, 'financialCurrency') || _y(yahoo.financialData, 'financialCurrency');
  const _tc = _y(pr, 'currency');
  const rcOriginal = (_fc && _fc !== _tc) ? _fc : (_tc || 'USD');
  const tradingCurrency = _tc || rcOriginal; // NEW: trading-quote ccy for downstream visibility
  // Tag 206f (Bug-Hunt Agent D HIGH C2): if Yahoo returns null financialCurrency,
  // we fall back to trading-currency — which is correct for native listings
  // (USD/USD) but WRONG for OTC pink-sheets where annual.* may be in a third
  // currency. Flag this case so the audit pipeline can surface affected tickers.
  // We can't detect the actual financialCurrency without external data, but we
  // CAN flag the uncertainty.
  const _ccyAmbiguous = (_fc == null && _tc != null);
  const exchangeName = _y(pr, 'exchangeName') || '';
  return {
    identifier: { primary: 'ISIN', value: watchlistEntry.isin || `TICKER:${watchlistEntry.ticker}` },
    meta: {
      ticker: watchlistEntry.ticker,
      name: _y(pr, 'longName') || watchlistEntry.name || watchlistEntry.ticker,
      sector: _y(ap, 'sector') || null,
      industry: _y(ap, 'industry') || null,
      region: normalizeRegion(rcOriginal, exchangeName),  // Tag 134: enum, not Yahoo string
      exchangeName: exchangeName || null,                  // Tag 134: preserved for diagnostics
      reportingCurrency: rcOriginal,                       // overwritten to 'USD' by _convertSnapshotToUSD
      tradingCurrency,                                     // Tag 204: trading-quote ccy (may differ from reporting for ADRs)
      fetchedAt: asOf,
      // Tag 215j: also write `asOf` for the F-CI-016 Verify Snapshot Freshness
      // gate. The gate scans for the `"asOf"` JSON key but pull-yahoo had only
      // ever set `fetchedAt`. Result: every full-pull snapshot was counted as
      // "unparseable" by the freshness gate. Run #107 showed the gate firing
      // a WARN ('continue-on-error: true' so non-blocking) but the underlying
      // bug needed fixing — without asOf the gate could never validate freshness
      // correctly. Same timestamp as fetchedAt so the two are synonyms post-fix;
      // existing consumers that read fetchedAt continue to work.
      asOf,
      filingDate: null,  // Yahoo liefert kein Filing-Datum für TTM
      firstTradeDate: null,  // wird unten aus yf.quote() gesetzt (Tag 106)
      ipoYear: null,
      // Tag 203: provenance for annualOpInc. 'native' = Yahoo isHist/FTS,
      // 'computed-bank' / 'computed-insurance' = per-year line-item derivation,
      // 'computed-margin' = annualRev × operatingMargin TTM (universal fallback
      // for Financial Services when line-items absent). null = no OpInc at all.
      opIncSource,
      // Tag 206b: fcfMarginTTM was suppressed because |raw value| > 200%.
      // Downstream methods (rule-of-40 etc.) will use the annual-FCF fallback
      // path or report computable:false. Flag preserved so audit pipeline can
      // surface affected tickers without re-deriving the bound.
      fcfMarginTTMSuppressed,
      // Tag 206f: Yahoo returned no financialCurrency — we used trading
      // currency as a best-effort proxy. Audit flag for OTC/pink-sheet edge.
      ccyAmbiguous: _ccyAmbiguous,
      // Tag 219 (audit F5 HIGH): Yahoo ships shares fields in
      // defaultKeyStatistics; the MODULES header lists "sharesOutstanding"
      // but the mapper never extracted it. buyback-yield.js docstring
      // lists meta.sharesOutstanding as a fallback that was never wired.
      sharesOutstanding:        _y(ks, 'sharesOutstanding'),
      floatShares:              _y(ks, 'floatShares'),
      impliedSharesOutstanding: _y(ks, 'impliedSharesOutstanding'),
      // Tag 220c (audit F-219c-F6 MEDIUM): majorHoldersBreakdown — institutional
      // ownership data, free fallback for institutional-ownership-13f.js when the
      // SEC 13F by-ticker cache is missing or hasn't been refreshed yet.
      // Priority: SEC 13F cache (curated CIK list, smart-money concentrated) →
      // Yahoo aggregate (broad-based, ~7k institutions, Form 13F-aggregated).
      institutionsPercentHeld:  _y(yahoo.majorHoldersBreakdown, 'institutionsPercentHeld'),
      institutionsCount:        _y(yahoo.majorHoldersBreakdown, 'institutionsCount'),
      insidersPercentHeld:      _y(yahoo.majorHoldersBreakdown, 'insidersPercentHeld'),
      // Tag 220c (audit F-219c-F9 LOW): mostRecentQuarter is the actual fiscal
      // quarter-end date, a more reliable dataAsOf source than fetchedAt (which
      // reflects API CALL time, not data time). Additive only — _dataAsOfFromStock
      // continues to prefer meta.fetchedAt for now; methods may opt in.
      mostRecentQuarter:        (function() {
        const v = _y(ks, 'mostRecentQuarter');
        if (v == null) return null;
        if (v instanceof Date) return v.toISOString();
        try { return new Date(v).toISOString(); } catch (_) { return null; }
      })(),
      // Tag 220c (audit F-219c-F11 LOW): assetProfile fields. Skip
      // longBusinessSummary — at 200-1000 chars × ~19k stocks it would bloat
      // snapshots by 4-20MB on disk; UI tooltip can re-fetch on demand.
      country:                  _y(ap, 'country'),
      fullTimeEmployees:        _y(ap, 'fullTimeEmployees')
    },
    // Tag 134: marketCap stored in reportingCurrency at mapper level;
    // _convertSnapshotToUSD applies FX conversion uniformly across all currency-denominated fields.
    // audit fix BH-046: fall back to price.marketCap when summaryDetail.marketCap is
    // absent (Live-Yahoo-Schema-Drift) — previously a null here unlinked an otherwise
    // valid snapshot (skipped-mcap) even though the price module (already loaded, see
    // MODULES) carried the value.
    marketCap: _metric(_y(sd, 'marketCap') ?? _y(pr, 'marketCap'), SRC, CONF, asOf),
    metrics: {
      revenueTTM:       _metric(revTTM, SRC, CONF, asOf),
      revenueGrowthYoY: _metric(revGrowthYoY, SRC, CONF, asOf),
      grossMargin:      _metric(_y(fd, 'grossMargins') != null ? _y(fd, 'grossMargins') * 100 : null, SRC, CONF, asOf),
      operatingMargin:  _metric(_y(fd, 'operatingMargins') != null ? _y(fd, 'operatingMargins') * 100 : null, SRC, CONF, asOf),
      fcfMarginTTM:     _metric(fcfMarginTTM, SRC, CONF, asOf),
      sbcRatio:         _metric(sbcRatio, SRC, 0.5, asOf),
      insidersOwnership: _metric(_y(ks, 'heldPercentInsiders'), SRC, 0.7, asOf),  // Tag-56
      cashRunway:       null,
      priceSales:       _metric(_y(sd, 'priceToSalesTrailing12Months'), SRC, CONF, asOf),
      forwardPE:        _metric(_y(sd, 'forwardPE'), SRC, CONF, asOf),
      pe:               _metric(_y(sd, 'trailingPE'), SRC, CONF, asOf),
      // Tag 219 (audit F2/F3 HIGH): Yahoo provides true EBITDA + Enterprise
      // Value pre-computed; ev-ebitda.js currently uses opInc*1.2 heuristic
      // and reconstructs EV from mcap+totalDebt-totalCash. Native fields are
      // more accurate (Yahoo's EV includes minority interest + preferred).
      ebitda:              _metric(_y(fd, 'ebitda'), SRC, CONF, asOf),
      ebitdaMargins:       _metric(_y(fd, 'ebitdaMargins') != null ? _y(fd, 'ebitdaMargins') * 100 : null, SRC, CONF, asOf),
      enterpriseValue:     _metric(_y(ks, 'enterpriseValue'),    SRC, CONF, asOf),
      enterpriseToEbitda:  _metric(_y(ks, 'enterpriseToEbitda'), SRC, CONF, asOf),
      enterpriseToRevenue: _metric(_y(ks, 'enterpriseToRevenue'),SRC, CONF, asOf),
      beta:                _metric(_y(ks, 'beta'),               SRC, 0.8,  asOf),
      // Tag 220c (audit F-219c-F8 MEDIUM): financialData ratios — all already
      // pulled in the financialData module; only the extraction was missing.
      // None are currency-denominated (ratios + counts + analyst price targets),
      // so no FX implication. SRC tag identifies provenance distinctly from
      // the SRC = 'yahoo_quoteSummary' above to aid downstream filtering.
      debtToEquity:         _metric(_y(fd, 'debtToEquity'),         'yahoo.financialData', 0.7, asOf),
      currentRatio:         _metric(_y(fd, 'currentRatio'),         'yahoo.financialData', 0.7, asOf),
      quickRatio:           _metric(_y(fd, 'quickRatio'),           'yahoo.financialData', 0.7, asOf),
      returnOnEquity:       _metric(_y(fd, 'returnOnEquity') != null ? _y(fd, 'returnOnEquity') * 100 : null,  'yahoo.financialData', 0.7, asOf),
      returnOnAssets:       _metric(_y(fd, 'returnOnAssets') != null ? _y(fd, 'returnOnAssets') * 100 : null,  'yahoo.financialData', 0.7, asOf),
      targetMeanPrice:      _metric(_y(fd, 'targetMeanPrice'),      'yahoo.financialData', 0.7, asOf),
      targetMedianPrice:    _metric(_y(fd, 'targetMedianPrice'),    'yahoo.financialData', 0.7, asOf),
      numberOfAnalystOpinions: _metric(_y(fd, 'numberOfAnalystOpinions'), 'yahoo.financialData', 0.7, asOf),
      recommendationMean:   _metric(_y(fd, 'recommendationMean'),   'yahoo.financialData', 0.7, asOf),
      recommendationKey:    _metric(_y(fd, 'recommendationKey'),    'yahoo.financialData', 0.7, asOf)
    },
    external: {
      // aktienfinderScore via Bookmarklet manuell synced
      // Tag 211h: estimateRevisions from yahoo.earningsTrend — activates
      // methods/analyst-revision-breadth.js (Tag 210d) which was returning
      // computable=false universally before this field was persisted. Keyed
      // by Yahoo period code ('0q','+1q','0y','+1y'); the method picks the
      // first period with non-null upLast30days/downLast30days.
      estimateRevisions: (function() {
        const et = yahoo.earningsTrend;
        const trend = et && Array.isArray(et.trend) ? et.trend : null;
        if (!trend || trend.length === 0) return null;
        const out = {};
        for (const t of trend) {
          if (!t || typeof t !== 'object') continue;
          const pk = t.period;
          if (!pk || typeof pk !== 'string') continue;
          const er = t.epsRevisions;
          if (!er || typeof er !== 'object') continue;
          // Yahoo varies casing ('upLast7days' vs 'upLast7Days'). Coalesce
          // both spellings so the consumer sees a single normalized shape.
          // Unwrap {value:n} envelopes if yahoo-finance2 returns wrapped.
          const _v = (x) => {
            if (x == null) return null;
            if (typeof x === 'number') return Number.isFinite(x) ? x : null;
            if (typeof x === 'object' && Number.isFinite(x.value)) return x.value;
            return null;
          };
          const pick = (a, b) => {
            const va = _v(er[a]); if (va != null) return va;
            return _v(er[b]);
          };
          const row = {
            upLast7Days:    pick('upLast7days',  'upLast7Days'),
            downLast7Days:  pick('downLast7days','downLast7Days'),
            upLast30Days:   pick('upLast30days', 'upLast30Days'),
            downLast30Days: pick('downLast30days','downLast30Days'),
            upLast60Days:   pick('upLast60days', 'upLast60Days'),
            downLast60Days: pick('downLast60days','downLast60Days'),
            upLast90Days:   pick('upLast90days', 'upLast90Days'),
            downLast90Days: pick('downLast90days','downLast90Days')
          };
          // Only emit periods that carry at least one non-null window —
          // saves bytes on snapshots when Yahoo returns empty epsRevisions.
          const hasData = Object.values(row).some(v => v != null);
          if (hasData) out[pk] = row;
        }
        return (Object.keys(out).length > 0) ? out : null;
      })(),
      // Tag 220c (audit F-219c-F7 MEDIUM): earningsHistory — last 4 quarters
      // with epsActual / epsEstimate / epsDifference / surprisePercent / quarter.
      // Persisted as data lake (no method consumes it yet); useful future input
      // for earnings-surprise momentum / PEAD diagnostic. Same pattern as
      // estimateRevisions above — only emit non-empty rows.
      earningsHistory: (function() {
        const eh = yahoo.earningsHistory;
        const hist = eh && Array.isArray(eh.history) ? eh.history : null;
        if (!hist || hist.length === 0) return null;
        const _v = (x) => {
          if (x == null) return null;
          if (typeof x === 'number') return Number.isFinite(x) ? x : null;
          if (typeof x === 'object' && Number.isFinite(x.value)) return x.value;
          if (typeof x === 'object' && Number.isFinite(x.raw)) return x.raw;
          return null;
        };
        const out = [];
        for (const q of hist) {
          if (!q || typeof q !== 'object') continue;
          const row = {
            quarter:         q.quarter ? (q.quarter instanceof Date ? q.quarter.toISOString() : String(q.quarter)) : null,
            period:          q.period || null,
            epsActual:       _v(q.epsActual),
            epsEstimate:     _v(q.epsEstimate),
            epsDifference:   _v(q.epsDifference),
            surprisePercent: _v(q.surprisePercent)
          };
          const hasData = row.epsActual != null || row.epsEstimate != null;
          if (hasData) out.push(row);
        }
        return out.length > 0 ? out : null;
      })()
    },
    timeseries: {
      // audit/fix A10: revenueQEnds ist ein ADDITIVES Geschwister-Feld — value-Shapes
      // (revenueQ=[{value:N}]) bleiben unangetastet; norm()/FIELD_REGISTRY lesen es nie.
      revenueQ, opIncQ, grossProfitQ, revenueQEnds, grossProfitQEnds
    },
    annual: {
      annualRev, annualOpInc, annualNetIncome, annualGP, annualFCF, annualOCF, annualBalance,
      // Tag 202: quoteSummary-derived RnD (primary). FTS path may overwrite below
      // when FTS has strictly more non-null entries (see post-FTS merge in main pull).
      annualRnD: annualRnDFromQS
    },
    // Tag 137: insider buy/sell activity (90d window, open-market only)
    insiderActivity: insiderActivity || null
  };
}

// ─── Tag-14: fundamentalsTimeSeries-Pull (für annualOpInc/FCF/opIncQ) ───
// Yahoo's incomeStatementHistory Submodule liefern seit Nov 2024 fast nichts.
// fundamentalsTimeSeries ist die neue API mit annual + quarterly Income/CashFlow.

async function fetchFundamentalsTS(symbol, signal) {
  // Period: 5y back, jetzt
  const period1 = new Date(Date.now() - 5 * 365 * 86400 * 1000);
  const period2 = new Date();
  const out = { annualFin: [], quarterlyFin: [], annualCash: [], annualBs: [] };
  // F-PY-102: thread the abort signal into every FTS fetch so a wrapper timeout
  // cancels the in-flight request and frees the yahoo-finance2 queue slot.
  const mo = signal ? { fetchOptions: { signal } } : undefined;
  // Defensive: jeder Aufruf eigener try/catch, Teilausfall darf nicht alles töten.
  // audit fix BH-043: acquireYfSlot() before EACH of these 4 sequential HTTP calls —
  // previously only the ticker's first request (quoteSummary) was gated.
  try {
    await acquireYfSlot();
    out.annualFin = await yf.fundamentalsTimeSeries(symbol, { period1, period2, type: 'annual', module: 'financials' }, mo);
  } catch (e) { _log('WARN', `  fundamentalsTimeSeries annual financials failed for ${symbol}: ${e.message}`); }
  try {
    await acquireYfSlot();
    out.quarterlyFin = await yf.fundamentalsTimeSeries(symbol, { period1, period2, type: 'quarterly', module: 'financials' }, mo);
  } catch (e) { _log('WARN', `  fundamentalsTimeSeries quarterly financials failed for ${symbol}: ${e.message}`); }
  try {
    await acquireYfSlot();
    out.annualCash = await yf.fundamentalsTimeSeries(symbol, { period1, period2, type: 'annual', module: 'cash-flow' }, mo);
  } catch (e) { _log('WARN', `  fundamentalsTimeSeries annual cash-flow failed for ${symbol}: ${e.message}`); }
  // Tag-28: Balance-Sheet via fundamentalsTimeSeries (für ROIC/Sloan/Net-Debt-EBITDA).
  try {
    await acquireYfSlot();
    out.annualBs = await yf.fundamentalsTimeSeries(symbol, { period1, period2, type: 'annual', module: 'balance-sheet' }, mo);
  } catch (e) { _log('WARN', `  fundamentalsTimeSeries annual balance-sheet failed for ${symbol}: ${e.message}`); }
  return out;
}

function _ftsValue(row, ...keys) {
  // F-DP-041 (Tag 184): also try snake_case variants. Some Yahoo FTS edge nodes
  // emit `total_revenue` instead of `totalRevenue`, etc. — previously the entire
  // FTS payload read as null for those rows. Convert each requested key to its
  // snake_case equivalent and try as fallback.
  if (!row) return null;
  for (const k of keys) {
    if (row[k] != null) return row[k];
    // camelCase → snake_case fallback
    const snake = k.replace(/[A-Z]/g, m => '_' + m.toLowerCase());
    if (snake !== k && row[snake] != null) return row[snake];
  }
  return null;
}

// Mappt fundamentalsTimeSeries-Rows zu engine-Schema-Arrays (latest first).
// Bug #26 fix: preserve null entries for years where the field is absent so that
// annualSBC[i] and annualCapex[i] stay positionally aligned with annualRev[i].
// Previously, null-year rows were silently compacted, causing year-index drift.
function _ftsExtractByYear(rows, fieldNames) {
  const sorted = (rows || []).slice().reverse();  // oldest→latest, reverse → latest first
  const out = [];
  for (const r of sorted) {
    // Push null for empty/missing rows to preserve year-alignment
    const v = (r != null) ? _ftsValue(r, ...fieldNames) : null;
    out.push(v != null ? v : null);
  }
  return out;
}

// Bug 21 (audit 2026-07-03): re-align an FTS-anchored side-series to a QS-won
// income bundle. The FTS side-series (annualSBC/Capex/RnD/SGA/Depreciation,
// annualBalance) are latest-first and anchored on the FTS newest FY; when the
// income bundle was won by QS whose newest FY is ONE fiscal year NEWER, index 0
// of the FTS series belongs at index 1 relative to the income bundle. Insert a
// single leading null so positional readers pair the same fiscal year.
//   diverges=false → return the array unchanged (the common, aligned case).
//   diverges=true  → prepend one null (renorm-on-shift; downstream null-checks).
// Empty arrays are returned as-is (nothing to align, no phantom leading null).
function _realignFtsAnchoredSeries(arr, diverges) {
  if (!diverges) return arr;
  if (!Array.isArray(arr) || arr.length === 0) return arr;
  return [null, ...arr];
}

function mapFTSToAnnual(annualRows, cashRows) {
  // Rows kommen oldest first → wir wollen latest first.
  // F-DP-030/031 (Tag 180): previously this skipped rows where rev==null
  // ("filtere wenn keine totalRevenue"), but _ftsExtractByYear preserves nulls
  // for annualSBC/Capex/RnD. The two conventions disagreed → annualRev[i] and
  // annualSBC[i] referenced DIFFERENT calendar years whenever a row had no rev.
  // Fix: push null placeholders here too so all annual arrays share positional
  // alignment with annualSBC/Capex/RnD. Downstream methods already null-check.
  // Trailing pure-null rows (no rev/oi/gp/ni at all) are trimmed to keep arrays
  // tight — preserved nulls only matter when surrounding data exists.
  const sorted = (annualRows || []).slice().reverse();
  const annualRev = [];
  const annualOpInc = [];
  const annualGP = [];
  const annualNetIncome = [];
  for (const r of sorted) {
    const rev = _ftsValue(r, 'totalRevenue', 'TotalRevenue');
    const oi = _ftsValue(r, 'operatingIncome', 'OperatingIncome', 'totalOperatingIncomeAsReported');
    const gp = _ftsValue(r, 'grossProfit', 'GrossProfit');
    const ni = _ftsValue(r, 'netIncome', 'NetIncome', 'netIncomeContinuousOperations');
    // audit/fix F1 (2026-06-25): was `continue` on an all-empty income row. But
    // annualRnD/SGA/Depreciation/Shares are built by _ftsExtractByYear over the
    // SAME fts.annualFin rows WITHOUT any skip (null-preserving). So an interior
    // income-empty-but-RnD-present year was dropped from annualRev/OpInc/GP/NI
    // while kept in annualRnD/SGA/Shares → year-index drift between arrays read
    // off identical rows. Push null placeholders for ALL four income arrays (the
    // same no-skip convention as mapFTSToBalance/mapFTSToQuarterly/_ftsExtractByYear),
    // then trim trailing all-null rows below. Consumers already null-check in place.
    annualRev.push(rev != null ? { value: rev } : null);
    annualOpInc.push(oi != null ? { value: oi } : null);
    annualGP.push(gp != null ? { value: gp } : null);
    annualNetIncome.push(ni != null ? { value: ni } : null);
  }
  // audit/fix F1 (2026-06-25): trim trailing all-null income rows (oldest) — no
  // information to contribute; mirrors mapFTSToQuarterly's trailing-null trim so
  // the arrays stay tight while interior nulls (which carry alignment) are kept.
  while (annualRev.length > 0 &&
         annualRev[annualRev.length - 1] == null &&
         annualOpInc[annualOpInc.length - 1] == null &&
         annualGP[annualGP.length - 1] == null &&
         annualNetIncome[annualNetIncome.length - 1] == null) {
    annualRev.pop(); annualOpInc.pop(); annualGP.pop(); annualNetIncome.pop();
  }
  // FCF + OCF aus cash-flow-Module.
  // F-DP-101 (audit 2026-06-11): the old `continue` on pure-empty rows COMPACTED
  // annualOCF/annualFCF, while annualCapex is built null-preservingly by
  // _ftsExtractByYear over the SAME cashRows. reinvestment-rate (a QC MUST-gate)
  // zips annualCapex[j] against annualOCF[j] positionally — a single OCF-empty
  // mid-window year shifted every older OCF entry by one, pairing capex with the
  // wrong fiscal year's OCF. Now push a null placeholder for empty rows (no
  // `continue`), so annualOCF/annualFCF stay index-aligned with annualCapex and
  // annualBalance. Consumers already finite-filter, so their filtered results are
  // unchanged; only the cross-array positional alignment is fixed. (Currently
  // ~0 live incidence because Yahoo's missing year is almost always the oldest —
  // but the mechanism is real and fragile; same null-preservation rule as
  // mapFTSToBalance/mapFTSToQuarterly.)
  const annualFCF = [];
  const annualOCF = [];
  const cashSorted = (cashRows || []).slice().reverse();
  for (const r of cashSorted) {
    const op = (r != null) ? _ftsValue(r, 'operatingCashFlow', 'OperatingCashFlow') : null;
    let fcf = (r != null) ? _ftsValue(r, 'freeCashFlow', 'FreeCashFlow') : null;
    if (fcf == null && r != null) {
      const capex = _ftsValue(r, 'capitalExpenditure', 'CapitalExpenditure');
      if (op != null && capex != null) fcf = op + capex;  // capex ist negativ
    }
    annualOCF.push(op != null ? { value: op } : null);
    annualFCF.push(fcf != null ? { value: fcf } : null);
  }
  return { annualRev, annualOpInc, annualGP, annualNetIncome, annualFCF, annualOCF };
}

function mapFTSToBalance(bsRows) {
  // Tag-28: Pulled balance-sheet rows from fundamentalsTimeSeries → array of {totalCash, totalDebt, totalAssets}, latest first.
  // Tag 211l: Extended with accountsReceivable, netPPE, currentAssets,
  // currentLiabilities, totalLiabilities — unblocks beneish-m-score (Tag 209d)
  // and ohlson-o-score (Tag 210a) which were both returning computable=false
  // universally because these fields weren't persisted.
  //
  // F-DP-003 (Tag 233c): push null placeholders for all-null rows instead of skipping.
  // Previous `continue` caused annualBalance[i] to reference a DIFFERENT fiscal year
  // than annualRev[i] when mapFTSToAnnual kept a row that mapFTSToBalance skipped
  // (because each function has a different "empty row" skip condition).
  // Pattern matches _ftsExtractByYear which always preserves positional alignment.
  // Methods accessing annualBalance[i] must null-check each entry; if null,
  // wrapEvaluate catches the resulting TypeError → computable:false (correct,
  // not a wrong value from a misaligned year).
  const sorted = (bsRows || []).slice().reverse();
  const annualBalance = [];
  for (const r of sorted) {
    if (!r) {
      annualBalance.push(null);
      continue;
    }
    // Yahoo FTS field names: totalAssets, cashAndCashEquivalents, shortTermDebt, longTermDebt
    const cash = _ftsValue(r, 'cashAndCashEquivalents', 'cashCashEquivalentsAndShortTermInvestments', 'cashAndShortTermInvestments');
    const std = _ftsValue(r, 'currentDebt', 'shortLongTermDebt', 'shortTermDebt');
    const ltd = _ftsValue(r, 'longTermDebt');
    // F-NY-002: absence-as-zero kept deliberately — see the quoteSummary-mapper
    // twin site for the full rationale (12.4% of snapshots are _debtPartial).
    // audit F-A-2026-06-21: mirror the twin site's _debtPartialReason so the
    // partial-debt signal carries direction (which leg is missing) — same
    // consumer-contract failure mode (unsized leverage understatement).
    const totalDebt = (std == null && ltd == null) ? null : (std || 0) + (ltd || 0);
    const _debtPartial = totalDebt != null && (std == null || ltd == null); // F-DQ-001
    const _debtPartialReason = _debtPartial ? (std == null ? 'no-current-debt' : 'no-long-term-debt') : null; // audit F-A-2026-06-21
    const totalAssets = _ftsValue(r, 'totalAssets');
    // Tag 211l extensions (Beneish/Ohlson inputs). All nullable.
    const accountsReceivable = _ftsValue(r, 'accountsReceivable', 'receivables');
    const netPPE = _ftsValue(r, 'netPPE', 'propertyPlantAndEquipmentNet', 'netTangibleAssets');
    const currentAssets = _ftsValue(r, 'currentAssets', 'totalCurrentAssets');
    const currentLiabilities = _ftsValue(r, 'currentLiabilities', 'totalCurrentLiabilities');
    const totalLiabilities = _ftsValue(r, 'totalLiabilitiesNetMinorityInterest', 'totalLiabilities');
    const totalEquity = _ftsValue(r, 'stockholdersEquity', 'commonStockEquity', 'totalEquity', 'stockholdersEquityApplicableToCommonShareholders');
    if (cash == null && totalDebt == null && totalAssets == null &&
        accountsReceivable == null && currentAssets == null &&
        currentLiabilities == null && totalLiabilities == null && netPPE == null) {
      annualBalance.push(null);  // null placeholder — preserves year alignment
      continue;
    }
    annualBalance.push({
      totalCash: cash,
      totalDebt,
      totalAssets,
      accountsReceivable,
      netPPE,
      currentAssets,
      currentLiabilities,
      totalLiabilities,
      totalEquity,
      ...(_debtPartial ? { _debtPartial: true, _debtPartialReason } : {}) // audit F-A-2026-06-21: persist which debt leg is absent
    });
  }
  // Trim trailing nulls — no information to contribute, keeps arrays tidy.
  while (annualBalance.length > 0 && annualBalance[annualBalance.length - 1] === null) {
    annualBalance.pop();
  }
  return annualBalance;
}

function mapFTSToQuarterly(quarterlyRows) {
  const sorted = (quarterlyRows || []).slice().reverse();
  const revenueQ = [];
  const opIncQ = [];
  const grossProfitQ = [];
  const revenueQEnds = []; // audit/fix A10: Perioden-Enden, index-aligned zu revenueQ
  const grossProfitQEnds = []; // A10-Symmetrie: dieselbe Row-Periode wie grossProfitQ
  // F-002 (audit 2026-06-08): a null-revenue row must keep its placeholder in ALL
  // three series. Previously revenueQ was skipped (`continue`) while opIncQ/
  // grossProfitQ got a null pushed — every null-rev row shifted revenueQ left
  // relative to its siblings AND broke the qRev[i] vs qRev[i+4] same-quarter-YoY
  // assumption in quarterly methods (deceleration-guard, q-spike-dataguard,
  // revenue-acceleration-yoy). Null placeholders preserve calendar positions;
  // consumers finite-check each entry (Bug #26 / F-DP-003 pattern).
  for (const r of sorted) {
    const rev = _ftsValue(r, 'totalRevenue', 'TotalRevenue');
    revenueQ.push(rev != null ? { value: rev } : null);
    const oi = _ftsValue(r, 'operatingIncome', 'OperatingIncome');
    opIncQ.push(oi != null ? { value: oi } : null);
    const gp = _ftsValue(r, 'grossProfit', 'GrossProfit');
    grossProfitQ.push(gp != null ? { value: gp } : null);
    // audit/fix A10: Quartals-Ende aus DERSELBEN FTS-Row. FTS-Rows tragen das Datum
    // als `date` (fallback asOfDate/endDate); fehlt es → null, nicht fabrizieren.
    const _end = _isoDay(r ? (r.date ?? r.asOfDate ?? r.endDate ?? null) : null);
    revenueQEnds.push(_end);
    grossProfitQEnds.push(_end); // dieselbe FTS-Row → dieselbe Periode
  }
  // Trim trailing all-null quarters (oldest) — no information to contribute;
  // mirrors mapFTSToBalance's trailing-null trim.
  while (revenueQ.length > 0 &&
         revenueQ[revenueQ.length - 1] == null &&
         opIncQ[opIncQ.length - 1] == null &&
         grossProfitQ[grossProfitQ.length - 1] == null) {
    revenueQ.pop(); opIncQ.pop(); grossProfitQ.pop(); revenueQEnds.pop(); grossProfitQEnds.pop(); // A10: Ends in Lockstep
  }
  return { revenueQ, opIncQ, grossProfitQ, revenueQEnds, grossProfitQEnds };
}

// ─── Main Pull ─────────────────────────────────────────────────────

async function _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// audit fix BH-043: MODULE-scope request-spacing gate shared by every yf.* call site
// (quoteSummary, quote, fundamentalsTimeSeries) — not just once per ticker. The old
// runWorkerPool gate reserved ONE slot per ticker before processOneFn started, but a
// single ticker fires ~6 sequential yf requests (quoteSummary + quote + 4x
// fundamentalsTimeSeries) with NO spacing between them — the "minimum spacing between
// consecutive Yahoo requests" the Tag-163 comment promised was never enforced per-request.
// pullAll() arms _yfGateSleepMs from its rateLimitMs param at the start of each run;
// acquireYfSlot() is a no-op (sleepMs<=0) outside a pullAll() run.
// ponytail: module-level mutable gate instead of threading a gate object through the
// 3 nested + 1 top-level fetch helpers — only one pullAll() runs per process. Revisit
// if concurrent pullAll() calls in one process ever become a real need.
// Tag 436: Wie viele yf.*-Requests ein Ticker im Vollzug abfeuert — quoteSummary + quote
// + 4x fundamentalsTimeSeries (die 7 acquireYfSlot()-Stellen decken 6 Requests je Ticker
// ab; die 7. ist der Retry-Pfad derselben quoteSummary). Der --rate-limit-Wert ist das
// Budget PRO TICKER und wird hierdurch geteilt, damit die mittlere Anfragerate die des
// grün laufenden Vorzustands bleibt. Aendert sich die Zahl der Requests je Ticker, MUSS
// dieser Wert mitgezogen werden — sonst driftet die Anfragerate still.
const YF_REQUESTS_PER_TICKER = 6;

let _yfGateSleepMs = 0;
let _yfGateNextSlotAt = 0;
async function acquireYfSlot() {
  if (!(_yfGateSleepMs > 0)) return;
  const now = Date.now();
  const slot = Math.max(now, _yfGateNextSlotAt);
  _yfGateNextSlotAt = slot + _yfGateSleepMs;
  const waitMs = slot - now;
  if (waitMs > 0) await _sleep(waitMs);
}

// audit F-A-2026-06-21: _withTimeout removed — dead code fully superseded by
// _withAbortTimeout (F-PY-102). The non-aborting Promise.race variant left
// timed-out yahoo-finance2 calls occupying their queue slot as zombies; every
// call site (quoteSummaryWithRetry, quote, FTS) already uses _withAbortTimeout.
// Failure mode prevented: a stray future call site re-using the non-cancelling
// wrapper and re-introducing the queue-zombie throughput collapse.

// F-PY-102 (audit 2026-06-11): the plain Promise.race above stops WAITING for a
// hung request but does NOT cancel it — yahoo-finance2 runs every fetch inside an
// internal concurrency queue (queue.concurrency), so a timed-out call keeps its
// queue slot occupied (a "zombie") until the socket finally dies. Under Yahoo
// throttling every call exceeds the timeout, the queue fills with zombies, and the
// retry-on-timeout path stacks fresh jobs behind them → throughput collapse (the
// real mechanism behind the documented F-003 429-storms). This variant drives an
// AbortController: `makePromise(signal)` must forward the signal to yahoo-finance2
// via its moduleOptions.fetchOptions, so firing the timeout actually aborts the
// underlying fetch and frees the queue slot immediately.
function _withAbortTimeout(makePromise, ms, label) {
  const ac = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      try { ac.abort(); } catch (_) {}
      reject(new Error(`ETIMEDOUT after ${ms}ms (${label})`));
    }, ms);
  });
  return Promise.race([makePromise(ac.signal), timeout]).finally(() => clearTimeout(timer));
}

// Tag 164: sort by staleness — oldest snapshots pulled first so timeouts
// always refresh the most-stale data. Guarantees full universe coverage over ~3 days.
// Reads only the first 300 bytes of each snapshot to extract meta.asOf without
// parsing the full JSON — keeps overhead low even for 12k-file universes.
//
// Tag 218 (audit F-217a-08 perf fix): precompute ages ONCE into a Map before
// sorting. Previous implementation called getAge() inside the sort comparator,
// which invoked the (3-syscall) staleness probe O(N log N) times — that's
// ~340k sync file opens for a 15k-stock universe and the same ticker's age
// was recomputed dozens of times. Now: one O(N) precompute pass, then sort
// reads from the cached Map in O(1).
//
// Also accept BOTH meta.asOf and meta.fetchedAt — pre-Tag-215j snapshots
// only had fetchedAt; post-Tag-215j have both. Without this dual-read,
// old snapshots looked timestamp-0 and would be pulled first wastefully.
// audit fix BH-044: asOf is preferred, fetchedAt is only the fallback. Both fields
// are present post-Tag-215j, but fetchedAt is written BEFORE asOf in the mapper
// (see mapYahooToCanonical meta) and price-only refreshes update ONLY asOf — a
// single "first match of either" regex always found fetchedAt first (earlier byte
// offset) regardless of which is actually fresher, understating a price-only'd
// ticker's true freshness. A two-stage match makes the priority explicit instead
// of an accident of field order.
function sortByStaleness(stocks, outputDir, earningsCalendar, today) {
  const ageCache = new Map();
  const asOfRegex = /"asOf"\s*:\s*"([^"]+)"/;
  const fetchedAtRegex = /"fetchedAt"\s*:\s*"([^"]+)"/;
  // TASK 0.9 (Pull-Diät): prefer the SEPARATE full-pull clock for the earnings
  // check so a daily-reset asOf doesn't hide a report as "already pulled".
  const fundAsOfRegex = /"fundamentalsAsOf"\s*:\s*"([^"]+)"/;
  const cal = earningsCalendar || {};
  for (const stock of stocks) {
    const ticker = stock.ticker;
    if (ageCache.has(ticker)) continue;
    // TASK 0.9 STRUKTUR-FIX (Tag 260): un-snapshotted tickers sort LAST (MAX age), not
    // first. Mit der Cross-Run-Snapshot-Persistenz (Tag 259) zaehlt die Sortier-Reihenfolge
    // endlich: die gecachten jungen Snapshots MUESSEN zuerst price-only'd werden (schnell,
    // haelt sie frisch UND zaehlt sie in n_ok), BEVOR das 165-min-Budget in un-gecachte
    // Ticker (langsame Voll-Pulls) fliesst. Vorher (age=0 fuer un-gecacht) flutete die
    // Front mit langsamen Fulls und verhungerte die schnellen Price-onlys -> n_ok
    // akkumulierte nie ueber ~1 Full-Batch -> der Tag-259-Cache blieb wirkungslos.
    // has-snapshot -> age = Timestamp (oder 0 fuer earnings-forward/oldest); kein Snapshot
    // -> MAX (Universum-Expansion nur mit Rest-Budget).
    let age = Number.MAX_SAFE_INTEGER;
    try {
      const fp = path.join(outputDir, safeSnapshotFilename(ticker));
      if (fs.existsSync(fp)) {
        age = 0; // hat einen Snapshot: default "aeltester" (refresh), bis ein echter Timestamp gelesen wird
        const buf = Buffer.alloc(1024);
        const fd = fs.openSync(fp, 'r');
        fs.readSync(fd, buf, 0, 1024, 0);
        fs.closeSync(fd);
        const hdr = buf.toString('utf8');
        const m = hdr.match(asOfRegex) || hdr.match(fetchedAtRegex);
        if (m) {
          const t = new Date(m[1]).getTime();
          if (Number.isFinite(t)) age = t;
        }
        // TASK 0.9 (Pull-Diät): if this ticker reported earnings since its last
        // full pull, pull it FORWARD (age 0 = oldest) so the freshness promise
        // holds even when the budget caps how far down the list we get. Reuses
        // the same pure needsFullPull decision the processOne gate uses.
        const fm = hdr.match(fundAsOfRegex);
        const metaForCheck = { fundamentalsAsOf: (fm ? fm[1] : (m ? m[1] : undefined)) };
        if (needsFullPull(metaForCheck, cal[ticker], today) === 'full') age = 0;
      }
    } catch {}
    ageCache.set(ticker, age);
  }
  return stocks.slice().sort((a, b) =>
    (ageCache.get(a.ticker) || 0) - (ageCache.get(b.ticker) || 0)
  );
}

// F1 (Codex-Fund, T2): n_skipped_mcap MUSS ausschliesslich echte mcap-Skips zaehlen —
// exakt wie das Fail-Ratio-Gate bei ~Z.3026. Frueher gebildet als
// results.length - (ok+price-only), was fx-unknown MITzaehlte und sie so aus dem
// adressierbaren Coverage-Nenner (n_addressable = n_total - n_skipped_mcap) warf ->
// coverage-gate honestPct blieb bei Teil-FX-Ausfall faelschlich ~100%. Eine geteilte
// reine Funktion, damit beide Schreibpfade (inkrementell + final) nicht wieder driften.
function countSkippedMcap(results) {
  return results.filter(r => r && r.status === 'skipped-mcap').length;
}

async function pullAll(watchlist, outputDir, rateLimitMs) {
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
  // audit/fix F3-budget (2026-06-25): reset the per-run time-based fundamentals-stale
  // counters so the budget is fresh each pullAll invocation.
  _fundamentalsRefreshUsed = 0;
  _fundamentalsRefreshDeferred = 0;
  // TASK 0.11: reset the silent-error counters so each pullAll reports its own tally.
  _lampErrors = 0;
  _needsFullPullThrew = 0;
  _corruptYoungSnapshots = 0;
  _ftsCacheParseErrors = 0;
  // TASK 0.9 (Pull-Diät): load the earnings calendar ONCE, in scope for
  // processOne and the staleness sort. Format { ticker: { date, pulledAt } }.
  // READ ONLY — never written here. {} on any failure so a missing/corrupt
  // file degrades to the pre-diet behaviour (no earnings-forced fulls).
  let _earningsCalendar = {};
  try {
    _earningsCalendar = JSON.parse(fs.readFileSync(path.join(__dirname, 'earnings-calendar.json'), 'utf8')) || {};
  } catch (e) {
    _log('WARN', `earnings-calendar.json not loaded (${e.message}) — earnings-forced fulls disabled this run`);
  }
  const _today = new Date();
  const results = [];
  const failures = [];
  // audit fix BH-043: (re)arm the shared per-request spacing gate for this run.
  //
  // Tag 436 (Dosis-Korrektur zu BH-043): BH-043 hat die GLIEDERUNG richtig gestellt
  // (jeder yf.*-Request wird einzeln getaktet statt nur der erste je Ticker), dabei
  // aber die BEDEUTUNG von --rate-limit still verschoben: der Wert war historisch das
  // Budget PRO TICKER, wurde danach aber als Budget PRO REQUEST verarbeitet — ohne dass
  // ein Aufrufer seinen Wert anpasste. Da der Gate global serialisiert, sank der
  // effektive Durchsatz um den Faktor YF_REQUESTS_PER_TICKER: bei --rate-limit 2000
  // von ~3 Req/s auf 0,5 Req/s. Folge (gemessen): ~1,93 s -> ~18,2 s je Ticker, alle 17
  // Shards liefen ab dem 21.07. in ihren 165-Minuten-Timeout und meldeten wegen
  // continue-on-error trotzdem "success"; frische Fundamentaldaten fielen von 224 (18.07.)
  // auf 0, und der veroeffentlichte Board stand ab da auf dem Stand vom 18.07. fest.
  //
  // KEIN Revert von BH-043: das Glaetten der Bursts ist richtig und schuetzt gegen genau
  // die Cloudflare-Drosselung, die Tag 430 zum 87-%-Fehlschlag fuehrte. Stattdessen wird
  // das Ticker-Budget auf die Requests eines Tickers verteilt. Ergebnis: dieselbe mittlere
  // Anfragerate wie vor BH-043 (die monatelang gruen lief), aber gleichmaessig verteilt
  // statt in Buendeln — strikt besser als beide Vorzustaende.
  _yfGateSleepMs = rateLimitMs / YF_REQUESTS_PER_TICKER;
  _yfGateNextSlotAt = 0;
  // Tag-80: Parallel pulls in batches of CONCURRENCY
  // audit fix BH-048: validate like args.rateLimit (parseArgs) — but fail-FAST rather
  // than silently falling back to a default. An invalid value here (0/negative/NaN)
  // made runWorkerPool spawn zero workers → empty results → n_ok=0, n_failed=0 →
  // failRatio=0 → exit 0, i.e. a no-op run that reports success while touching nothing.
  const CONCURRENCY = parseInt(process.env.PULL_CONCURRENCY || '10', 10);
  if (!(Number.isFinite(CONCURRENCY) && CONCURRENCY > 0)) {
    _log('ERROR', `Invalid PULL_CONCURRENCY="${process.env.PULL_CONCURRENCY}" (must be a positive integer) — aborting instead of a silent no-op run`);
    process.exit(1);
  }
  _log('INFO', `Parallel pulls: ${CONCURRENCY} concurrent. Total: ${watchlist.stocks.length} stocks.`);
  // Tag 164: sort by staleness — oldest snapshots pulled first so timeouts
  // always refresh the most-stale data. Guarantees full universe coverage over ~3 days.
  watchlist.stocks = sortByStaleness(watchlist.stocks, outputDir, _earningsCalendar, _today);
  _log('INFO', `Sorted ${watchlist.stocks.length} stocks by staleness (oldest first)`);
  // Tag 154: exponential-backoff retry for rate-limit errors.
  // Yahoo 429s are transient — one retry after 10–30s usually succeeds.
  // Max 3 attempts: initial + 2 retries with 10s / 25s sleep.
  // Tag 163: reduced timeouts (30s→12s) and delays (10s/25s→5s/12s) to unblock
  // the worker pool faster — stalled tickers no longer hold up other workers.
  //
  // Tag 215f: extended retry budget to 15s/45s/90s (4 attempts total).
  // Run #107 produced 7,210 rate-limit failures even with retry — Yahoo's
  // Cloudflare Edge throttle needs LONGER backoff than Tag 163's 5s/12s
  // (CDN Retry-After is typically 30-60s). Combined with PULL_CONCURRENCY 8
  // (down from 20) this should drop the rate-limit fail rate dramatically.
  async function quoteSummaryWithRetry(symbol, label) {
    const DELAYS = [15000, 45000, 90000];
    let lastErr;
    for (let attempt = 0; attempt <= DELAYS.length; attempt++) {
      try {
        // audit fix BH-043: acquire the shared spacing slot before EACH attempt
        // (including retries) — this is the request the gate is meant to space.
        await acquireYfSlot();
        // F-PY-102: pass the abort signal through moduleOptions.fetchOptions so a
        // timeout cancels the fetch and frees the yahoo-finance2 queue slot.
        return await _withAbortTimeout(
          (signal) => yf.quoteSummary(symbol, { modules: MODULES }, { fetchOptions: { signal } }),
          12000, label);
      } catch (e) {
        // Task 0.13 (Tag 288): falsch-negativer Validator-Reject (Fehler nur in
        // Enrichment-Modulen, Pflichtfelder intakt) → Payload retten statt failen.
        const salvaged = salvageValidationReject(e);
        if (salvaged) {
          _log('INFO', `  ${label} [schema-salvage]: Validator-Fehler nur in ${salvaged.salvagedModules.join('+')} — Payload gerettet`);
          return salvaged.result;
        }
        lastErr = e;
        const msg = String(e.message || '');
        const isRateLimit = /429|too many request|rate.?limit/i.test(msg);
        // F-DP-048 (Tag 182): previously only `timeout` literal matched. yahoo-finance2
        // raises TimeoutError with message "Operation timed out" — the regex missed
        // it and the request was not retried. Match name + common variants.
        const isTimeout =
          (e.name === 'TimeoutError') ||
          (e.constructor && /timeout/i.test(e.constructor.name || '')) ||
          /timeout|timed out|ETIMEDOUT|ESOCKETTIMEDOUT|EAI_AGAIN/i.test(msg);
        if ((isRateLimit || isTimeout) && attempt < DELAYS.length) {
          const delay = DELAYS[attempt];
          _log('WARN', `  ${label} rate-limited (attempt ${attempt + 1}) — retrying in ${delay / 1000}s`);
          await _sleep(delay);
        } else {
          throw e;
        }
      }
    }
    throw lastErr;
  }

  // Tag 155: incremental manifest write — flushes _manifest.json after every ~100 tickers
  // so a mid-run SIGKILL (GitHub Actions 165-min step timeout) leaves an accurate manifest
  // on disk reflecting snapshots actually written. Without this the downstream Verify Pull
  // Coverage gate sees n_ok=0/n_total=0 even though hundreds of snapshot files exist.
  // F-DP-012: boolean mutex prevents concurrent workers from racing this write.
  let _manifestWriting = false;
  let _manifestPending = false;
  // F-DP-039 (Tag 182): previously a concurrent call while mutex was set
  // returned silently, losing the second flush. Boundary writes (every 100
  // tickers) could be missed entirely. Now: if mutex set, mark pending and
  // re-trigger a single follow-up write when the current one finishes.
  function writeManifestIncremental() {
    if (_manifestWriting) { _manifestPending = true; return; }
    _manifestWriting = true;
    try {
      // F-DP-047 (Tag 192): n_ok previously equaled results.length, but results
      // includes 'skipped-mcap' entries where the snapshot was explicitly
      // deleted (line ~1036). That inflated n_ok and let Verify Pull Coverage
      // pass when actual on-disk snapshot count was much lower. Now: count
      // only entries whose status reflects a real snapshot write.
      const okResults = results.filter(r =>
        r && (r.status === 'ok' || r.status === 'price-only'));
      const skippedMcap = countSkippedMcap(results);
      // TASK 0.9 (Pull-Diät): split full vs price-only so the diet's effect is
      // readable even on a TIMED-OUT run — the incremental manifest is flushed to
      // disk every ~100 tickers, so these survive a mid-flight SIGKILL. n_full is
      // the expensive full-pull count (the bottleneck the budget caps).
      const nFull = okResults.filter(r => r.status === 'ok').length;
      const nPriceOnly = okResults.length - nFull;
      const slim = {
        pulled_at: new Date().toISOString(),
        watchlist_version: watchlist._meta && watchlist._meta.version,
        n_total: watchlist.stocks.length,
        n_ok: okResults.length,
        n_full: nFull,
        n_priceonly: nPriceOnly,
        n_skipped_mcap: skippedMcap,
        // Tag 464: vor dem Abruf aus DIESER Scheibe entfernt (Small-Cap-Eigentumsgrenze).
        // n_total oben ist bereits ohne sie; der Merge braucht die Zahl, weil er n_total
        // durch das volle Universum ersetzt.
        n_skipped_owned: (watchlist._skippedOwned || 0),
        n_failed: failures.length,
        _silentErrors: { lamp: _lampErrors, needsFullPull: _needsFullPullThrew, corruptYoung: _corruptYoungSnapshots, ftsCacheParse: _ftsCacheParseErrors },
        partial: true
      };
      const mPath = path.join(outputDir, '_manifest.json');
      writeFileAtomic(mPath, JSON.stringify(slim));
    } catch (e) {
      _log('WARN', `Incremental manifest write failed: ${e.message}`);
    } finally {
      _manifestWriting = false;
      if (_manifestPending) {
        _manifestPending = false;
        // Don't recurse synchronously — defer one tick so we don't burn CPU on a tight ticker loop.
        setImmediate(writeManifestIncremental);
      }
    }
  }

  // Tag 166: read existing snapshot's asOf to decide price-only vs full pull
  function _getExistingSnapshotAge(ticker) {
    try {
      const fp = path.join(outputDir, safeSnapshotFilename(ticker));
      if (!fs.existsSync(fp)) return null;
      const buf = Buffer.alloc(500);
      const fd = fs.openSync(fp, 'r');
      fs.readSync(fd, buf, 0, 500, 0);
      fs.closeSync(fd);
      const m = buf.toString('utf8').match(/"asOf"\s*:\s*"([^"]+)"/);
      if (!m) return null;
      const age = Date.now() - new Date(m[1]).getTime();
      return age;
    } catch { return null; }
  }

  // Tag 226a-2: detect snapshots that pre-date Tag 211l (annualSGA /
  // annualDepreciation / currentAssets / currentLiabilities / totalLiabilities)
  // or Tag 219 (annualShares). The price-only fast-path keeps a snapshot
  // young (<7d) indefinitely by refreshing meta.asOf without touching the
  // annual.* block — so a stock pulled before these tags would NEVER pick
  // them up unless we force a full pull on schema detection.
  //
  // Cost: one ~50KB JSON.parse per ticker (only on the snapshots that pass
  // the age gate, so ~3500 reads). Probe Tag 225d showed 0/100 random
  // snapshots had Tag 211l fields → roughly 98% of the universe will trip
  // this once, then settle into normal price-only cadence on subsequent runs.
  //
  // Constraint: must NOT bump FTS_CACHE_VERSION (per pull-yahoo invariants
  // — many fundamentals caches are <28d old and rebuilding them all would
  // multiply this run's Yahoo load). Instead: snapshot-level schema gate
  // here forces the full-pull code path, which then sees the stale FTS
  // cache lacks ftsAnnualSGA and falls through to a fresh FTS fetch via
  // the existing `cached._cacheVersion !== FTS_CACHE_VERSION` branch (the
  // cache file's _cacheVersion is `undefined` for pre-Tag-211l caches, so
  // that branch already handles the FTS-cache side correctly).
  // audit F-A-2026-06-21: accepts an already-parsed snapshot object instead of
  // re-reading+re-parsing the file. The schema-stale and currency-stale probes
  // plus _priceOnlyUpdate previously each did a full readFileSync+JSON.parse —
  // 3× parse per fast-path ticker on the ~80%-hit price-only path. Single parse
  // is now shared across all three (see processOne). Failure mode prevented:
  // wasteful triple-parse CPU/IO blowup on the hottest code path.
  function _existingSnapshotMissingTag211lFields(s) {
    try {
      if (!s) return false;
      const A = s && s.annual;
      if (!A) return false;
      // If the snapshot has no annualRev at all, it's a price-only seed
      // (no fundamentals yet). Don't force full-pull just to add Tag 211l
      // fields — the full-pull path will eventually run via normal age
      // expiry. We only care about snapshots that DO have annual data but
      // are missing the newer fields.
      const hasRev = Array.isArray(A.annualRev) && A.annualRev.length > 0;
      if (!hasRev) return false;
      // Tag 211l fields: annualSGA, annualDepreciation, and the extended
      // balance-sheet rows (currentAssets/currentLiabilities/totalLiabilities).
      const hasSGA = Array.isArray(A.annualSGA) && A.annualSGA.length > 0;
      const hasDepr = Array.isArray(A.annualDepreciation) && A.annualDepreciation.length > 0;
      const bal = A.annualBalance;
      // Bug 13 (audit 2026-07-03): key-PRESENCE, not finite-value. Banks/insurers
      // (mapFTSToBalance writes currentAssets:null) and placeholder balance rows
      // structurally never carry a finite currentAssets → hasCA stayed false after
      // EVERY full pull → the schema-stale probe re-fired each run → permanent
      // full-pull loop (budget drain, bypasses FUNDAMENTALS_REFRESH_BUDGET). Once a
      // post-Tag-211l full pull has written the row, the currentAssets KEY exists
      // (even if its value is null), which is the true "schema is current" signal.
      const hasCA = Array.isArray(bal) && bal[0] && ('currentAssets' in bal[0]);
      // A snapshot is "stale-schema" if it lacks EITHER SGA/Depr OR the
      // extended balance fields. We use AND on the balance row + OR with
      // the income/cash items to avoid false-positives on companies that
      // legitimately have null SGA (some financial filers) but DO have
      // current-asset data persisted.
      return !(hasSGA || hasDepr) || !hasCA;
    } catch { return false; }
  }

  // Tag 230a: catch pre-Tag-219c snapshots that carry a non-USD `reportingCurrency`
  // but were written before `_convertSnapshotToUSD` existed (or before it ran on
  // them). The defect (Tag 226c-4): 1,640 intl snapshots have `marketCap` in USD
  // (Yahoo already returned USD-converted quote fields) but `revenueTTM`,
  // `annual.*`, and `annualBalance` still in local reporting currency — every
  // ratio (fcf-yield, ev/ebitda, ROIC, …) is silently wrong.
  //
  // Detection: a normalized snapshot must satisfy ONE of
  //   (a) meta.reportingCurrency === 'USD'                (US-domiciled, no FX)
  //   (b) meta.fxConverted === true                       (Tag 134+ marker)
  //   (c) meta.reportingCurrencyOriginal is set AND       (older Tag 134/148
  //       meta.fxRateApplied is a finite number            converted snapshot)
  // If NONE of the three hold AND the snapshot has any annual data, it's a
  // mixed-currency envelope and must be re-pulled so `_convertSnapshotToUSD`
  // runs on the fresh canonical. Price-only-seed snapshots (no annualRev)
  // are skipped — they'll get fundamentals + FX on their first full pull.
  //
  // Safe: snapshots that legitimately failed FX (meta.fxConversionFailed=true)
  // are NOT re-flagged here — they already carry the failure marker and
  // would just fail again. The full-pull path's existing fxConversionFailed
  // skip filters them out cleanly.
  // audit F-A-2026-06-21: accepts an already-parsed snapshot object (see the
  // schema probe twin above) — shares the single parse done in processOne
  // instead of a second readFileSync+JSON.parse. Failure mode prevented:
  // redundant parse on the fast-path ticker.
  function _existingSnapshotMissingCurrencyNormalization(s) {
    try {
      if (!s) return false;
      const m = s && s.meta;
      if (!m) return false;
      // Price-only seeds (no annualRev) carry no FX-denominated series yet —
      // leave them alone; the next full pull will normalize.
      const A = s.annual;
      const hasRev = A && Array.isArray(A.annualRev) && A.annualRev.length > 0;
      if (!hasRev) return false;
      // (a) USD reporter: no FX to apply.
      if (m.reportingCurrency === 'USD') return false;
      // (b) explicit Tag 134+ converted marker.
      if (m.fxConverted === true) return false;
      // (c) older converted snapshot: original ccy preserved AND finite rate applied.
      if (m.reportingCurrencyOriginal
          && typeof m.fxRateApplied === 'number'
          && Number.isFinite(m.fxRateApplied)) return false;
      // (d) prior FX failure — don't loop on it.
      if (m.fxConversionFailed === true) return false;
      // Otherwise the snapshot's annual.* + revenueTTM are in local ccy while
      // marketCap is USD → mixed envelope, force full pull.
      return true;
    } catch { return false; }
  }

  // Tag 166: lightweight price-only update — preserves fundamentals from previous snapshot
  // audit F-A-2026-06-21: accepts an optional pre-parsed snapshot (preParsed) so
  // the fast-path doesn't parse the file a THIRD time after the schema/currency
  // probes already parsed it. Falls back to read+parse when called without one
  // (preserves the original contract for any other caller). Failure mode
  // prevented: triple JSON.parse per fast-path ticker.
  async function _priceOnlyUpdate(stock, outputDir, preParsed) {
    const fp = path.join(outputDir, safeSnapshotFilename(stock.ticker));
    let existing = preParsed;
    if (existing == null) {
      if (!fs.existsSync(fp)) throw new Error('no existing snapshot to update');
      existing = JSON.parse(fs.readFileSync(fp, 'utf8'));
    }
    await acquireYfSlot(); // audit fix BH-043
    const q = await _withAbortTimeout((signal) => yf.quote(stock.yahoo_symbol, undefined, { fetchOptions: { signal } }), 8000, stock.ticker + '/quote-only'); // F-PY-102: abortable
    if (!q) throw new Error('quote returned null');
    // audit fix BH-047: a successful quote (this call didn't throw not-found) breaks
    // any prior not-found streak — the ticker is confirmed alive.
    if (existing.meta && existing.meta.notFoundStreak) delete existing.meta.notFoundStreak;
    // Update only fields that change daily
    const newAsOf = new Date().toISOString();
    // Tag 232a-4 (audit F-DP-002 CRITICAL): yf.quote() returns regularMarketPrice
    // and marketCap in TRADING currency, NOT financial-reporting currency. The
    // pre-Tag-232a-4 path multiplied by meta.fxRateApplied (the financial→USD
    // rate); for ADRs where trading ccy != financial ccy this produced prices
    // ~32× too small (TSM @ $200 × TWD→USD 0.031 = $6.20). Then the MIN_MCAP
    // floor below silently unlinked the snapshot, dropping every small/mid-cap
    // ADR from the universe on every price-only refresh (~80% of pulls).
    //
    // Fix: derive the TRADING rate from q.currency (Yahoo's quote response).
    // q.currency='USD' for NYSE ADRs (TSM/BABA/NU) → factor=1 → no scaling.
    // q.currency='HKD' for 9988.HK → factor=HKD→USD → correct scale.
    // q.currency='GBp' for LSE pence stocks → factor=(GBP→USD)/100 → correct.
    // Fallback to legacy fxApplied behavior when q.currency is missing.
    //
    // F-DQ-002 (Tag 179): refuse price-only when origCcy non-USD AND fxApplied
    // is missing — still useful as a safety net for the rare q.currency-also-
    // missing corner case where we'd fall back to fxApplied anyway.
    const origCcy = existing.meta && existing.meta.reportingCurrencyOriginal;
    const fxAppliedRaw = existing.meta && existing.meta.fxRateApplied;
    if (origCcy && origCcy !== 'USD' && (fxAppliedRaw == null || !Number.isFinite(fxAppliedRaw))) {
      throw new Error('price-only refused: non-USD original (' + origCcy + ') with no fxRateApplied — full pull needed');
    }
    const fxApplied = Number.isFinite(fxAppliedRaw) ? fxAppliedRaw : 1;
    // Compute trading-currency-to-USD factor independent of fxApplied.
    const tradingCcyRaw = (q.currency || (existing.price && existing.price.currency) || '').toString();
    let tradingFactor;
    if (tradingCcyRaw) {
      // audit/fix GBP-pence (2026-06-25): case-SENSITIVE pence test (see ~line 313).
      // Same /^GB[Xp]$/i defect in the price-only fast path — under /i it misclassified
      // 'GBP' (pounds) trading quotes as pence, scaling price/marketCap by GBP_rate/100.
      // Match ONLY genuine pence: 'GBp' (lowercase p) or 'GBX' (uppercase X).
      const isPence = tradingCcyRaw === 'GBp' || tradingCcyRaw === 'GBX' || tradingCcyRaw.toUpperCase() === 'GBPENCE';
      const tradingFxKey = isPence ? 'GBP' : tradingCcyRaw.toUpperCase();
      const tradingRate = FX_TO_USD[tradingFxKey];
      if (tradingRate != null && Number.isFinite(tradingRate)) {
        tradingFactor = isPence ? tradingRate / 100 : tradingRate;
      }
    }
    if (tradingFactor == null) {
      // q.currency missing or unrate-able. Fall back to legacy fxApplied path —
      // correct when trading ccy == financial ccy (the bulk of the universe),
      // wrong only for ADRs in this corner case (which the refused-throw above
      // catches when origCcy is also broken).
      tradingFactor = (fxApplied !== 1 && origCcy !== 'USD') ? fxApplied : 1;
    }
    if (q.regularMarketPrice != null) {
      // audit fix BH-045: stamp asOf only when a price was actually written. The
      // unconditional stamp (moved) previously marked the F-CI-016 freshness gate's
      // asOf fresh even for a sparse quote ({currency:'USD'} etc.) that updated
      // nothing — a no-op refresh looked like a successful one.
      if (existing.meta) existing.meta.asOf = newAsOf;
      existing.price = existing.price || {};
      // audit F-A-2026-06-21: prevented failure mode — "price-field currency
      // drifts between full-pull and price-only refreshes". The price-only path
      // converts price to USD (`* tradingFactor`), while the full-pull mapper
      // never builds snap.price and _convertSnapshotToUSD deliberately leaves any
      // price in trading currency (see lines ~411-414). So consumers reading
      // existing.price.regularMarketPrice could not tell whether the number was
      // USD (after a price-only refresh) or trading-ccy/absent (after a full
      // pull). We fix the invariant to "stored regularMarketPrice is USD" (the
      // behavior price-only already had and downstream price-only consumers rely
      // on) and record it explicitly in meta so consumers interpret the field
      // from meta.priceCurrency instead of guessing — closing the drift.
      const usdPrice = q.regularMarketPrice * tradingFactor;
      if (!Number.isFinite(usdPrice)) {
        // Never write a non-finite price; that would corrupt the invariant just
        // asserted (USD numeric). Refuse the fast-path so a full pull recomputes.
        throw new Error('price-only refused: non-finite USD price (raw=' + q.regularMarketPrice + ', tradingFactor=' + tradingFactor + ')');
      }
      existing.price.regularMarketPrice = usdPrice;
      // audit F-A-2026-06-21: assert + record the price unit on write so the
      // field is self-describing and the full-pull/price-only ambiguity is gone.
      existing.price.currencyUnit = 'USD';
      existing.meta = existing.meta || {};
      existing.meta.priceCurrency = 'USD';
      // F-DP-040 (Tag 182): previously this overwrote existing.price.currency with
      // Yahoo's live value, flipping GBp ↔ GBP and breaking the invariant against
      // meta.reportingCurrencyOriginal. The snapshot's reporting currency is set
      // at full-pull time and must remain stable; only update if the existing
      // field is missing. NOTE: price.currency is the ORIGINAL trading-quote ccy
      // (provenance of the raw quote); the stored regularMarketPrice number is in
      // USD per meta.priceCurrency — these are intentionally distinct.
      if (existing.price.currency == null) existing.price.currency = q.currency;
    }
    if (q.marketCap != null) {
      existing.marketCap = existing.marketCap || {};
      existing.marketCap.value = q.marketCap * tradingFactor;
    }
    // F-DQ-009 (Tag 183): price-only path previously skipped the MIN_MCAP floor —
    // a stock that drifted below $1B post-last-full-pull stayed in the universe
    // (survivor bias on the small-cap side). Re-check the floor here; if violated,
    // delete the snapshot and report skipped-mcap-by-priceonly.
    const MIN_MCAP = MIN_MCAP_USD;
    const mcapNow = existing.marketCap && existing.marketCap.value;
    if (mcapNow != null && mcapNow < MIN_MCAP) {
      try { fs.unlinkSync(fp); } catch (_) {}
      throw new Error('price-only floor: mcap=' + (mcapNow/1e9).toFixed(2) + 'B < $' + (MIN_MCAP/1e9).toFixed(0) + 'B — snapshot removed');
    }
    // Mark mode for downstream visibility
    existing._pullMode = 'price-only';
    existing._pullModeAt = newAsOf;
    // Tag 232c-12 (audit F-DQ-004 HIGH): preserve _quality.grade across price-
    // only refreshes. Pre-fix, F-DQ-009/F-DP-036 nulled grade + nanRatio +
    // missingFields after price-only, intending to surface "data not re-
    // evaluated" — but score-aggregator's tier-cap check did
    // `if (dataQuality.grade)` which silently skipped the cap on null,
    // hollowing DATAQUALITY_ENFORCE for the ~80%-hit fast path. Price-only
    // doesn't change FIELD presence (only price/mcap), so the grade is still
    // VALID even though it was computed from the last full pull's snapshot
    // shape. Keeping it preserves the dq-enforcement contract without re-
    // grading on every price-only refresh.
    //
    // Still nuke nanRatio + missingFields — those were point-in-time stats
    // that DO go stale (rolling field-coverage history evolves), so leaving
    // them as-is would mislead the data-quality-report. The grade itself
    // is a categorical bucket that's robust to that.
    //
    // staleSincePriceOnly remains as the audit signal: downstream code that
    // needs an exact freshness anchor (rare — only inputDigest-style hashing)
    // can branch on it.
    if (existing._quality) {
      existing._quality.nanRatio = null;
      existing._quality.missingFields = null;
      existing._quality.staleSincePriceOnly = newAsOf;
      // existing._quality.grade preserved on purpose — see Tag 232c-12 above.
    }
    // F-DP-032 (Tag 179) → factored into lib/atomic-write.js in Tag 189.
    // ~80% of daily pulls go through this fast-path; atomic write protects
    // against SIGTERM corruption on CI cancellation.
    // Tag 232c-6 (audit F-PF-002 HIGH): drop the 2-indent. Same anti-pattern
    // as the Tag 222 OOM fix in pull-historical-prices.js. With ~20K snapshots
    // written per pull (and this path the 80%-hit fast-path), pretty-print
    // adds ~30-40% file size + ~5-10× stringify time. Snapshots are read by
    // generators (machine consumers), not humans — no readability cost.
    writeFileAtomic(fp, JSON.stringify(existing));
    return { ticker: stock.ticker, status: 'price-only', mcap: q.marketCap, price: q.regularMarketPrice };
  }

  async function processOne(stock) {

    try {
      // Tag 166: price-only fast-path if recent snapshot exists
      // Tag 226a-2: but ONLY if the snapshot already carries the Tag 211l
      // schema (annualSGA / annualDepreciation / extended balance fields).
      // Pre-Tag-211l snapshots that pass the 7-day age gate would otherwise
      // be price-only-refreshed forever, keeping methods/sga-revenue-trend,
      // working-capital-trend, and ohlson-o-score at <2% coverage indefinitely.
      const age = _getExistingSnapshotAge(stock.ticker);
      const youngEnough = age != null && age < FUNDAMENTALS_MAX_AGE_MS;
      // audit F-A-2026-06-21: parse the young snapshot ONCE here and share the
      // object across both staleness probes AND _priceOnlyUpdate. Previously
      // each of the three did its own readFileSync+JSON.parse → 3× parse per
      // fast-path ticker (the ~80%-hit path). Failure mode prevented: redundant
      // triple parse of every young snapshot.
      let _parsedSnapshot = null;
      if (youngEnough) {
        try {
          const _fp = path.join(outputDir, safeSnapshotFilename(stock.ticker));
          if (fs.existsSync(_fp)) _parsedSnapshot = JSON.parse(fs.readFileSync(_fp, 'utf8'));
        } catch (e) {
          // TASK 0.11: a corrupt young snapshot was silently treated as no-cache. Keep that
          // (the staleness probes then re-fetch, self-healing) but COUNT+log it so disk
          // corruption becomes visible instead of silent.
          _parsedSnapshot = null;
          _corruptYoungSnapshots++;
          _log('WARN', `young snapshot parse failed for ${stock.ticker} (→ no-cache, re-fetch): ${e && e.message}`);
        }
      }
      const staleSchema = youngEnough
        ? _existingSnapshotMissingTag211lFields(_parsedSnapshot)
        : false;
      // Tag 230a: separate sibling probe for mixed-currency envelopes.
      const staleCurrency = youngEnough
        ? _existingSnapshotMissingCurrencyNormalization(_parsedSnapshot)
        : false;
      // audit/fix F3 (2026-06-25): time-based fundamentals-refresh probe. Reads the
      // SEPARATE full-pull clock (meta.fundamentalsAsOf, stamped only on full pulls)
      // — NOT meta.asOf, which _priceOnlyUpdate resets daily. If fundamentals are
      // older than FUNDAMENTALS_REFRESH_DAYS, force a full pull so annual/metrics/FTS
      // actually refresh instead of freezing behind an ever-young asOf.
      // Backward-compat: snapshots written before this fix carry no fundamentalsAsOf.
      // Fall back to meta.fetchedAt — NOT meta.asOf. asOf is RESET to "today" by
      // _priceOnlyUpdate on every daily refresh, so a pre-existing snapshot that is
      // schema- and currency-current would price-only forever, keep asOf < 30d
      // indefinitely, and NEVER force a full pull → fundamentalsAsOf is never seeded
      // and fundamentals freeze permanently (the exact bug F3 targets, for the exact
      // ~pre-existing population it targets). meta.fetchedAt, by contrast, is written
      // ONLY by the full-pull mapper (mapYahooToCanonical, ~line 872) and is NEVER
      // touched by _priceOnlyUpdate, so it is a faithful "last full pull" clock. As a
      // pre-existing snapshot's fetchedAt naturally ages past FUNDAMENTALS_REFRESH_DAYS
      // it forces one full pull, which seeds fundamentalsAsOf; thereafter the real
      // fundamentalsAsOf clock governs. No day-1 stampede: fetchedAt values are spread
      // across the universe's last-full-pull dates, so only the genuinely-overdue
      // (>30d) fraction force-fulls on any given run — verified ~39% (1837/4681) on
      // the live universe, not 100%. Missing/unparseable timestamp → not forced.
      const staleFundamentals = (youngEnough && _parsedSnapshot && _parsedSnapshot.meta)
        ? (() => {
            const m = _parsedSnapshot.meta;
            const anchor = m.fundamentalsAsOf || m.fetchedAt;
            if (!anchor) return false;
            const t = new Date(anchor).getTime();
            if (!Number.isFinite(t)) return false;
            return (Date.now() - t) > FUNDAMENTALS_REFRESH_MS;
          })()
        : false;
      // audit/fix F3-budget (2026-06-25): apply the per-run budget to TIME-based
      // forced fulls only. If this ticker is ALSO schema- or currency-stale, it takes
      // the full pull for correctness regardless (free ride) and must not consume the
      // time budget. Otherwise — when staleFundamentals is the SOLE reason — honor it
      // only while under budget; once the budget is exhausted this run, defer the
      // ticker to price-only (caught next run, oldest-first) so a clustered re-expiry
      // wave can't starve the coverage gate. Counter incremented only on a forced
      // time-based full that we actually honor.
      // TASK 0.9 (Pull-Diät): earnings free-ride. If this ticker reported earnings
      // since its last full pull, new financials exist → force an UNBUDGETED full
      // pull (same free-ride path as staleSchema/staleCurrency). Reporters stay
      // fresh regardless of the time-based budget. needsFullPull is pure and never
      // throws; snapshotMeta is the once-parsed snapshot's meta (carries the
      // separate fundamentalsAsOf full-pull clock).
      const staleEarnings = (youngEnough && _parsedSnapshot)
        ? (needsFullPull(_parsedSnapshot.meta, _earningsCalendar[stock.ticker], _today) === 'full')
        : false;
      let forceFundamentalsFull = staleFundamentals || staleEarnings;
      // Budget applies ONLY when time-staleness is the SOLE reason. If the ticker
      // is also schema-, currency-, or earnings-stale it takes the full pull for
      // correctness (free ride) and must not consume the time budget.
      if (staleFundamentals && !staleSchema && !staleCurrency && !staleEarnings) {
        if (_fundamentalsRefreshUsed < FUNDAMENTALS_REFRESH_BUDGET) {
          _fundamentalsRefreshUsed++;
        } else {
          forceFundamentalsFull = false; // budget exhausted → fall back to price-only
          _fundamentalsRefreshDeferred++;
        }
      }
      if (youngEnough && !staleSchema && !staleCurrency && !forceFundamentalsFull) {
        try {
          const r = await _priceOnlyUpdate(stock, outputDir, _parsedSnapshot);
          results.push(r);
          _log('INFO', `  ✓ ${stock.ticker} [price-only]: mcap=${r.mcap}, price=${r.price}`);
          return;
        } catch (e) {
          _log('WARN', `  price-only failed for ${stock.ticker}, falling through to full pull: ${e.message}`);
          // fall through to full pull below
        }
      } else if (staleSchema) {
        _log('INFO', `  ${stock.ticker} [schema-stale]: forcing full pull to backfill Tag 211l fields`);
      } else if (staleCurrency) {
        _log('INFO', `  ${stock.ticker} [currency-stale]: forcing full pull to normalize pre-Tag-219c FX envelope`);
      } else if (staleEarnings) {
        _log('INFO', `  ${stock.ticker} [earnings-stale]: forcing unbudgeted full pull (reported since last full pull)`);
      } else if (forceFundamentalsFull) {
        _log('INFO', `  ${stock.ticker} [fundamentals-stale]: forcing full pull (fundamentalsAsOf > ${FUNDAMENTALS_REFRESH_DAYS}d)`);
      }

      _log('INFO', `Pulling ${stock.ticker} (${stock.yahoo_symbol})…`);
      const yahoo = await quoteSummaryWithRetry(stock.yahoo_symbol, stock.ticker);
      const asOf = new Date().toISOString();
      const canonical = mapYahooToCanonical(yahoo, stock, asOf);

      // Tag 106: IPO-Datum via separates yf.quote() — quoteSummary.price hat das Feld nicht.
      try {
        await acquireYfSlot(); // audit fix BH-043
        const q = await _withAbortTimeout((signal) => yf.quote(stock.yahoo_symbol, undefined, { fetchOptions: { signal } }), 8000, stock.ticker + '/quote'); // Tag 163: 15s→8s; F-PY-102: abortable
        if (q && q.firstTradeDateMilliseconds) {
          const ftd = new Date(q.firstTradeDateMilliseconds);
          canonical.meta.firstTradeDate = ftd.toISOString();
          canonical.meta.ipoYear = ftd.getUTCFullYear();
        }
      } catch (e) { console.warn('IPO-DATE-FETCH:', stock.ticker, e.message); }

      // Tag-85: Smart-Cache — skip FTS-Pull wenn cache <28 Tage alt
      // F-DP-025: { recursive: true } makes mkdirSync idempotent
      const cacheDir = path.join(__dirname, 'fundamentals-cache');
      fs.mkdirSync(cacheDir, { recursive: true });
      const cachePath = path.join(cacheDir, safeSnapshotFilename(stock.ticker));
      const CACHE_TTL_MS = 28 * 86400 * 1000;
      const CACHE_PARTIAL_TTL_MS = 86400 * 1000; // F-DP-005: 24h for partial results
      const FTS_CACHE_VERSION = 2; // F-DP-019: bump when FTS schema changes (v2: null-alignment fix, added annualRnD)
      // Tag 232c-3 (audit F-DP-001 CRITICAL): when the schema-stale or
      // currency-stale probe forces a full pull, ALSO bypass the FTS cache so
      // the fetch actually retrieves fresh data with the Tag 211l/219c fields.
      // Without this guard, the cache's pre-Tag-211l payload is re-merged into
      // the new snapshot, the new fields stay empty, and the probe fires again
      // on the next run — the infinite full-pull loop the F-DP-001 audit
      // documented. Bumping FTS_CACHE_VERSION would be the cleaner invalidation
      // but Karl's operating constraints forbid it (see fixture_hash_invariant
      // memory). useCache=false on schema/currency-stale tickers is the
      // alternative the audit explicitly endorsed. Cumulative effect: each
      // successfully fully-pulled ticker gets Tag 211l fields persisted →
      // tomorrow's probe doesn't fire on it → fast-path returns → over a few
      // days the schema-stale set drains to ~0 and the universe lands back in
      // the daily Yahoo Pull budget.
      let useCache = false;
      let cached = null;
      let cacheBypassReason = null;
      if (fs.existsSync(cachePath)) {
        try {
          cached = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
          // F-DP-019: reject cache if version key is missing or differs.
          if (cached._cacheVersion !== FTS_CACHE_VERSION) {
            if (typeof global.__ftsCacheInvalidations === 'undefined') global.__ftsCacheInvalidations = 0;
            global.__ftsCacheInvalidations++;
            cached = null;
          } else {
            const age = Date.now() - new Date(cached.cachedAt).getTime();
            const ttl = cached._ftsPartial ? CACHE_PARTIAL_TTL_MS : CACHE_TTL_MS;
            if (age < ttl) useCache = true;
          }
        } catch (e) {
          // TASK 0.11: a corrupt FTS cache file was silently treated as cache-miss. Keep
          // that safe degradation (fresh fetch) but COUNT+log it so disk corruption becomes
          // visible instead of silently costing a fresh fetch every run.
          cached = null;
          _ftsCacheParseErrors++;
          _log('WARN', `FTS cache parse failed (${path.basename(cachePath)}) → fresh fetch: ${e && e.message}`);
        }
      }
      // Tag 232c-3 (audit F-DP-001 CRITICAL) — refined Tag 232c-19:
      // The audit's "set useCache=false when staleSchema=true" is correct
      // intent but applying it BLINDLY to every stale-schema ticker (~98% of
      // universe per the first run after Tag 211l rollout) forces a fresh
      // FTS fetch on each one. At 4-10s per fresh FTS fetch × 20K tickers /
      // 8 concurrent = far over the 165-min Yahoo Pull budget → n_ok crashes
      // below the coverage gate, pipeline still blocked.
      //
      // Smarter test: bypass cache only if the CACHE ITSELF lacks the Tag
      // 211l fields. Caches written after the Tag 211l puller rollout DO
      // carry ftsAnnualSGA/Depreciation/Shares; re-merging those into the
      // snapshot fills the schema-stale gap WITHOUT a re-fetch. Caches that
      // pre-date Tag 211l do require a fresh FTS hit — those are a smaller
      // subset (the genuine pre-Tag-211l population).
      // Tag 232c-32 — remove the currency-stale cache-bypass entirely. The
      // currency-stale probe (Tag 230a) is about price/marketCap envelope
      // format, which is fixed in mapYahooToCanonical + _convertSnapshotToUSD
      // on every full pull regardless of FTS cache use. Re-fetching FTS data
      // for currency-stale tickers doesn't help (FTS is annual/quarterly/
      // balance time-series, not price). With ~46% of universe currency-
      // stale per audit Tag 230a, the unnecessary bypass added ~75 min of
      // pure overhead — meaningful in the 165-min Yahoo Pull budget.
      if (useCache && cached && cached.payload) {
        const cacheHasTag211l =
          Array.isArray(cached.payload.ftsAnnualSGA) && cached.payload.ftsAnnualSGA.length > 0 ||
          Array.isArray(cached.payload.ftsAnnualDepreciation) && cached.payload.ftsAnnualDepreciation.length > 0;
        if (staleSchema && !cacheHasTag211l) {
          cacheBypassReason = 'schema-stale + cache-pre-Tag-211l';
        }
      } else if (staleSchema) {
        // No cache to use anyway — re-fetch is happening regardless.
        cacheBypassReason = 'schema-stale (no cache)';
      }
      if (cacheBypassReason) {
        if (typeof global.__ftsCacheStaleBypasses === 'undefined') global.__ftsCacheStaleBypasses = 0;
        global.__ftsCacheStaleBypasses++;
        useCache = false;
      }
      let ftsAnnual, ftsQuarterly, ftsBalance, ftsAnnualSBC, ftsAnnualCapex, ftsAnnualRnD;
      let ftsAnnualSGA, ftsAnnualDepreciation, ftsAnnualShares;
      let ftsQuarterlyNI;
      if (useCache && cached.payload) {
        ftsAnnual = cached.payload.ftsAnnual;
        ftsQuarterly = cached.payload.ftsQuarterly;
        ftsBalance = cached.payload.ftsBalance;
        ftsAnnualSBC = cached.payload.ftsAnnualSBC;
        ftsAnnualCapex = cached.payload.ftsAnnualCapex;
        ftsAnnualRnD = cached.payload.ftsAnnualRnD || [];  // Bug #25: added in cache v2
        ftsQuarterlyNI = cached.payload.ftsQuarterlyNI || [];
        // Tag 211l: SGA + Depreciation added without FTS_CACHE_VERSION bump.
        // Old caches will return undefined → default to empty array. Stocks get
        // these fields after their cache expires (CACHE_TTL_MS) and re-pulls.
        ftsAnnualSGA = cached.payload.ftsAnnualSGA || [];
        ftsAnnualDepreciation = cached.payload.ftsAnnualDepreciation || [];
        // Tag 219 (audit F4 HIGH): annualShares added — same gradual-rollout
        // pattern as Tag 211l SGA/Depreciation.
        ftsAnnualShares = cached.payload.ftsAnnualShares || [];
      } else {
        // Tag-14: fundamentalsTimeSeries-Pull für annualOpInc/FCF/opIncQ.
        // F-DP-003: timeout raised to 60s (4 sequential HTTP calls inside);
        //   one retry on timeout/ECONNRESET before propagating.
        let fts;
        let ftsFetchFailed = false;
        let ftsLastErr = null;
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            fts = await _withAbortTimeout((signal) => fetchFundamentalsTS(stock.yahoo_symbol, signal), 60000, stock.ticker + '/fts'); // F-PY-102: abortable
            break;
          } catch (e) {
            ftsLastErr = e;
            // Bug 12 (audit 2026-07-03): case-INSENSITIVE match — _withAbortTimeout
            // throws 'ETIMEDOUT after 60000ms', which case-sensitive includes('timeout')
            // never matched, so the single retry was dead code. Align with the
            // F-DP-048 quoteSummaryWithRetry pattern.
            if (attempt === 0 && (/timeout|timed out|ETIMEDOUT|ECONNRESET/i.test(String(e.message)) || e.code === 'ECONNRESET')) continue;
            ftsFetchFailed = true;
            break;
          }
        }
        // Bug 12: append the original error message so the final throw carries a
        // 'timeout'/'ECONNRESET' token → correct errClass ('timeout'/'network')
        // instead of 'other' in the catch classifier.
        if (ftsFetchFailed || !fts) throw new Error('FTS fetch failed for ' + stock.ticker + (ftsLastErr ? ': ' + ftsLastErr.message : ''));
        ftsAnnual = mapFTSToAnnual(fts.annualFin, fts.annualCash);
        ftsQuarterly = mapFTSToQuarterly(fts.quarterlyFin);
        ftsBalance = mapFTSToBalance(fts.annualBs);
        ftsAnnualSBC = _ftsExtractByYear(fts.annualCash, ['stockBasedCompensation']);
        ftsAnnualCapex = _ftsExtractByYear(fts.annualCash, ['capitalExpenditure', 'capitalExpenditures']);
        // Bug #25: annualRnD was never extracted — reinvestment-rate always computed Capex-only
        ftsAnnualRnD = _ftsExtractByYear(fts.annualFin, ['researchAndDevelopment', 'ResearchAndDevelopment', 'researchAndDevelopmentExpenses']);
        // Tag 211l: SGA (income statement) + Depreciation (cash flow) — unblocks
        // beneish-m-score (Tag 209d) which needs SGA + Depreciation, and
        // ohlson-o-score (Tag 210a) which needs OCF (already had). Field names
        // verified live against NVDA: 'sellingGeneralAndAdministration' on
        // annualFin and 'depreciationAndAmortization' on annualCash.
        ftsAnnualSGA = _ftsExtractByYear(fts.annualFin, ['sellingGeneralAndAdministration', 'SellingGeneralAndAdministration']);
        ftsAnnualDepreciation = _ftsExtractByYear(fts.annualCash, ['depreciationAndAmortization', 'depreciationAmortizationDepletion', 'DepreciationAndAmortization']);
        // Tag 219 (audit F4 HIGH): shares per year — unblocks methods/buyback-yield.js
        // which has been computable=false universally because annual.annualShares
        // never existed. Tries dilutedAverageShares (more conservative — counts
        // options/RSUs) first, falls back to basicAverageShares, then to FTS
        // annualBs ordinarySharesNumber. methods/capital-allocation-quality.js
        // will scale 4/4 instead of 3/4 once this lands.
        ftsAnnualShares = _ftsExtractByYear(fts.annualFin,
          ['dilutedAverageShares', 'basicAverageShares']);
        if (!ftsAnnualShares.some(v => v != null)) {
          ftsAnnualShares = _ftsExtractByYear(fts.annualBs,
            ['ordinarySharesNumber', 'shareIssued']);
        }
        // Tag-90: Quarterly NetIncome (8-Quarter-Earnings-Stability)
        ftsQuarterlyNI = (fts.quarterlyFin || []).slice().reverse()
          .map(r => r && r.netIncome != null ? r.netIncome : null);
        // F-DP-005: detect partial FTS result — any module that returned empty array
        const ftsPartial = (
          (fts.annualFin || []).length === 0 ||
          (fts.quarterlyFin || []).length === 0 ||
          (fts.annualCash || []).length === 0 ||
          (fts.annualBs || []).length === 0
        );
        try {
          // F-DP-052 (Tag 189): atomic FTS-cache write; worker pool can hit
          // same ticker if a retry races, and a truncated cache fails downstream
          // _ftsExtractByYear silently → quarterly-NI series goes empty.
          writeFileAtomic(cachePath, JSON.stringify({
            _cacheVersion: FTS_CACHE_VERSION,
            _ftsPartial: ftsPartial,
            cachedAt: new Date().toISOString(),
            payload: { ftsAnnual, ftsQuarterly, ftsBalance, ftsAnnualSBC, ftsAnnualCapex, ftsAnnualRnD, ftsQuarterlyNI, ftsAnnualSGA, ftsAnnualDepreciation, ftsAnnualShares }
          }));
        } catch (e) { _log('WARN', 'FTS cache write failed for ' + (stock && stock.ticker) + ': ' + e.message); }
        if (ftsPartial) canonical._ftsPartial = true;
      }
      // audit F-A-2026-06-21: the FTS-vs-quoteSummary merge below was 7 copies of
      // the same per-field "FTS wins iff it has more data" comparison, each with a
      // slightly different filter predicate (count vs length) and override
      // condition — the structural source of the year-index-drift bug class
      // (annualGP even used a bare .length>0, NOT the non-null count its siblings
      // use). Extracted into two helpers so every field uses identical semantics.
      // Failure mode prevented: divergent per-field predicates silently letting a
      // sparser FTS array overwrite a richer QS array (or vice-versa), drifting
      // the year index between annualRev / annualOpInc / annualGP / annualNetIncome.
      //
      // _nonNullCount: counts entries that hold an actual value (handles both raw
      // numbers and {value:n} wrappers, the two shapes these arrays carry).
      const _nonNullCount = arr => (arr || []).filter(v => v != null && (v.value != null || typeof v === 'number')).length;
      // mergePreferRicher: returns ftsArr iff it is strictly richer than qsArr.
      //   mode:'count'  → compare non-null element counts (preserves null-placeholder
      //                   year alignment; the correct default for value series).
      //   mode:'length' → compare raw array lengths (legacy behaviour for series
      //                   where mapFTSToAnnual emits no null placeholders).
      const mergePreferRicher = (qsArr, ftsArr, opts) => {
        const mode = (opts && opts.mode) || 'count';
        if (mode === 'length') {
          return (ftsArr || []).length > 0 ? ftsArr : qsArr;
        }
        return _nonNullCount(ftsArr) > _nonNullCount(qsArr) ? ftsArr : qsArr;
      };
      // mergeQuarterTriplet: moves revenueQ + opIncQ + grossProfitQ as ONE unit so
      // the three quarter series always come from the SAME source (F-010). Picks
      // the source whose revenueQ has more non-null quarters; siblings follow
      // unconditionally (even if empty) to avoid stale cross-source leftovers.
      const mergeQuarterTriplet = (qsTrip, ftsTrip) => (
        _nonNullCount(ftsTrip.revenueQ) > _nonNullCount(qsTrip.revenueQ) ? ftsTrip : qsTrip
      );
      // audit/fix F2 (2026-06-25): the annual INCOME bundle (Rev/OpInc/GP/NI) must
      // come from ONE source. Previously annualRev (mergePreferRicher), annualOpInc
      // (its own non-null compare), annualGP (mergePreferRicher) and annualNetIncome
      // (its own compare) each picked QS-vs-FTS INDEPENDENTLY by non-null count.
      // EQUAL count does NOT imply equal year anchor: QS is ~4yr anchored at the
      // latest FY (e.g. FY2025) while FTS is ~5yr anchored one year earlier (FY2024).
      // So grossMargin[0]=annualGP[0]/annualRev[0] could divide a QS gross profit
      // (FY2025) by an FTS revenue (FY2024) — different fiscal years. Mirror the
      // mergeQuarterTriplet pattern: decide ONCE off the revenue array's non-null
      // count (tiebreak on total bundle density so an equal-revenue tie still
      // resolves deterministically toward the richer overall source), then move all
      // four arrays from the SAME source together. Null placeholders within each
      // array are preserved (no filtering) so positional year-alignment survives.
      const _incomeBundleDensity = b =>
        _nonNullCount(b.annualRev) + _nonNullCount(b.annualOpInc) +
        _nonNullCount(b.annualGP) + _nonNullCount(b.annualNetIncome);
      const mergeAnnualIncomeBundle = (qsB, ftsB) => {
        const qsRev = _nonNullCount(qsB.annualRev);
        const ftsRev = _nonNullCount(ftsB.annualRev);
        if (ftsRev !== qsRev) return ftsRev > qsRev ? ftsB : qsB;
        // revenue tie → fall back to total bundle density; FTS only wins on strictly
        // richer (preserves the prior "QS keeps it on a tie" default).
        return _incomeBundleDensity(ftsB) > _incomeBundleDensity(qsB) ? ftsB : qsB;
      };

      // Override leere annual-Arrays aus quoteSummary mit FTS-Daten wenn FTS welche hat.
      // audit/fix F2 (2026-06-25): single-source the whole income bundle.
      // Bug 21 (audit 2026-07-03): the FTS-anchored side-series (annualSBC/Capex/
      // RnD/SGA/Depreciation) and annualBalance are ALWAYS set from FTS below,
      // but the income bundle here can be won by QS. QS is ~4yr anchored at the
      // latest FY while FTS is ~5yr anchored one year earlier (documented ~line
      // 2086). When QS wins, positional readers (axes/overview/lamps zip index-
      // for-index) then pair e.g. SBC(FTS-FY2024) with Rev(QS-FY2025) — a fiscal-
      // year mismatch. We capture whether QS won + the anchor-divergence signal
      // (FTS strictly longer than QS) so the side-series can be re-aligned/dropped.
      let _incomeWinnerIsQS = false;
      let _ftsAnchorDiverges = false;
      {
        const _qsIncome = {
          annualRev: canonical.annual.annualRev,
          annualOpInc: canonical.annual.annualOpInc,
          annualGP: canonical.annual.annualGP,
          annualNetIncome: canonical.annual.annualNetIncome,
        };
        const _ftsIncome = {
          annualRev: ftsAnnual.annualRev,
          annualOpInc: ftsAnnual.annualOpInc,
          annualGP: ftsAnnual.annualGP,
          annualNetIncome: ftsAnnual.annualNetIncome,
        };
        const _winner = mergeAnnualIncomeBundle(_qsIncome, _ftsIncome);
        _incomeWinnerIsQS = (_winner === _qsIncome);
        // Anchor-divergence signal: the FTS income series is strictly longer than
        // the QS income series it lost to. Per the documented anchor convention
        // (FTS ~5yr one FY earlier, QS ~4yr latest FY) this is the exact shape in
        // which the FTS side-series' newest entry is one fiscal year OLDER than
        // QS' newest — so index-0 of the FTS side-series does NOT line up with
        // index-0 of the (QS-won) income bundle.
        _ftsAnchorDiverges = _incomeWinnerIsQS &&
          (_ftsIncome.annualRev || []).length > (_qsIncome.annualRev || []).length;
        // Tag 206f: move siblings WITHOUT filtering nulls — null placeholders keep
        // annualOpInc[i]/annualNetIncome[i] aligned with annualRev[i] by fiscal year
        // (a bank's [3,null,2,null] OpInc must stay 4-long, not collapse to [3,2]).
        canonical.annual.annualRev = _winner.annualRev;
        canonical.annual.annualOpInc = _winner.annualOpInc;
        canonical.annual.annualGP = _winner.annualGP;
        canonical.annual.annualNetIncome = _winner.annualNetIncome;
        // Tag 203: when the FTS bundle wins and actually carries OpInc, that OpInc is
        // native Yahoo data — record provenance. If QS wins (or FTS OpInc is empty)
        // leave opIncSource as mapYahooToCanonical set it; the post-merge sector-aware
        // fallback below re-derives a margin-based OpInc when the winner left it empty.
        if (_winner === _ftsIncome &&
            (ftsAnnual.annualOpInc || []).some(v => v != null && (typeof v !== 'object' || v.value != null))) {
          if (canonical.meta) canonical.meta.opIncSource = 'native';
        }
      }
      // Bug 21 (audit 2026-07-03): when QS won the income bundle with a newer FY
      // anchor, shift every FTS-anchored series by one leading null so their
      // index 0 no longer collides with the income bundle's newer index 0. Done
      // ONCE here, before all the FTS→canonical assignments below consume them,
      // so annualBalance + SBC/Capex/RnD/SGA/Depreciation are all aligned to the
      // same fiscal-year axis as annualRev/OpInc/GP/NI. No-op when aligned.
      if (_ftsAnchorDiverges) {
        ftsBalance             = _realignFtsAnchoredSeries(ftsBalance, true);
        ftsAnnualSBC           = _realignFtsAnchoredSeries(ftsAnnualSBC, true);
        ftsAnnualCapex         = _realignFtsAnchoredSeries(ftsAnnualCapex, true);
        ftsAnnualRnD           = _realignFtsAnchoredSeries(ftsAnnualRnD, true);
        ftsAnnualSGA           = _realignFtsAnchoredSeries(ftsAnnualSGA, true);
        ftsAnnualDepreciation  = _realignFtsAnchoredSeries(ftsAnnualDepreciation, true);
      }
      // Tag-28: annualBalance aus FTS überschreiben wenn FTS mehr nicht-null Werte hat
      // F-DQ-011: extend usability check to include Tag 211l fields so FTS rows that
      // carry accountsReceivable/currentAssets/currentLiabilities/totalLiabilities/netPPE
      // (but lack legacy totalDebt/totalCash/totalAssets) are still counted as usable.
      // Without this, QS can win even though FTS is richer in Tag 211l data.
      // F-001 fix: guard `r != null` first. mapFTSToBalance pushes explicit null
      // placeholder rows for all-empty balance years (year-alignment), and a plain
      // `r.totalDebt` deref on those threw "Cannot read properties of null (reading
      // 'totalDebt')" — the [mapper-bug] that silently dropped the whole ticker's
      // snapshot. Short-circuit on null so placeholder rows count as not-usable.
      const _balanceUsable = r => r != null && (r.totalDebt != null || r.totalCash != null || r.totalAssets != null ||
        r.currentAssets != null || r.currentLiabilities != null || r.totalLiabilities != null ||
        r.accountsReceivable != null || r.netPPE != null);
      const oldBalanceUsable = (canonical.annual.annualBalance || []).filter(_balanceUsable).length;
      const newBalanceUsable = ftsBalance.filter(_balanceUsable).length;
      if (newBalanceUsable > oldBalanceUsable) canonical.annual.annualBalance = ftsBalance;
      // Tag-43: annualSBC aus FTS hinzufügen
      canonical.annual.annualSBC = ftsAnnualSBC;
      // Tag-44: annualCapex aus FTS hinzufügen
      canonical.annual.annualCapex = ftsAnnualCapex;
      // Bug #25: annualRnD war nie geschrieben — reinvestment-rate nutzte immer nur Capex
      // Tag 202: prefer FTS-extracted RnD only when it has strictly more non-null
      // entries than the quoteSummary-derived RnD already on canonical.annual.
      // Yahoo FTS `financials` omits researchAndDevelopment for many large caps
      // (ASML, V, MA, MSFT, NVDA, GOOG observed) — without this guard the FTS
      // empty-array overwrites the legacy isHist values and (Capex+0)/OCF stays
      // below the 20% reinvestment-rate gate.
      const qsRnDNonNull = (canonical.annual.annualRnD || []).filter(v => v != null).length;
      const ftsRnDNonNull = (ftsAnnualRnD || []).filter(v => v != null).length;
      if (ftsRnDNonNull > qsRnDNonNull) {
        canonical.annual.annualRnD = ftsAnnualRnD;
      } else if (qsRnDNonNull === 0 && (ftsAnnualRnD || []).length > 0) {
        // Both empty/null — keep FTS shape for downstream length-alignment.
        canonical.annual.annualRnD = ftsAnnualRnD;
      }
      // else: keep canonical.annual.annualRnD as set by mapYahooToCanonical (quoteSummary).
      // Tag 211l: annualSGA + annualDepreciation surfacing — only set if non-empty,
      // mirrors the additive pattern used for annualSBC/annualCapex.
      if ((ftsAnnualSGA || []).length > 0)          canonical.annual.annualSGA = ftsAnnualSGA;
      if ((ftsAnnualDepreciation || []).length > 0) canonical.annual.annualDepreciation = ftsAnnualDepreciation;
      // Tag 219: shares per year — see Tag 219c agent F4 fix. Unblocks
      // methods/buyback-yield.js + makes capital-allocation-quality 4/4.
      if ((ftsAnnualShares || []).length > 0)       canonical.annual.annualShares = ftsAnnualShares;
      // Tag-90: quarterlyNI in timeseries
      // F-NY-001 (audit 2026-06-08): nulls were wrapped as {value:null}, so length-
      // based "computable" checks saw N entries that could be entirely empty. Keep
      // RAW null placeholders instead (Bug #26 pattern): positional alignment stays,
      // but finite-counting (_arrLen) and v!=null checks now see the truth.
      canonical.timeseries.netIncomeQ = (ftsQuarterlyNI || []).map(v => v != null ? { value: v } : null);
      // audit/fix F2 (2026-06-25): annualGP and annualNetIncome are now moved as part
      // of the single-source income bundle above (alongside annualRev/annualOpInc) so
      // grossMargin / net-margin can never pair a QS gross/net with an FTS revenue from
      // a different fiscal year. (Previously these were two more independent per-array
      // non-null-count merges here — removed.)
      // audit/fix F2 (2026-06-25): bundle the FCF/OCF pair onto ONE source too. OCF and
      // FCF come from the SAME cash-flow rows (FCF often = OCF + capex), and consumers
      // like fcf-conversion zip annualFCF[i] against annualOCF[i] positionally — an
      // independent per-array merge could pick FCF from FTS and OCF from QS with
      // different year anchors. Decide once off OCF's non-null count (FCF density as
      // tiebreak) and move both together; null placeholders preserved for alignment.
      {
        const _qsCash = { annualFCF: canonical.annual.annualFCF, annualOCF: canonical.annual.annualOCF };
        const _ftsCash = { annualFCF: ftsAnnual.annualFCF, annualOCF: ftsAnnual.annualOCF };
        const _qsOcf = _nonNullCount(_qsCash.annualOCF);
        const _ftsOcf = _nonNullCount(_ftsCash.annualOCF);
        let _cashWinner;
        if (_ftsOcf !== _qsOcf) {
          _cashWinner = _ftsOcf > _qsOcf ? _ftsCash : _qsCash;
        } else {
          // OCF tie → break on FCF density; FTS only wins on strictly richer.
          _cashWinner = _nonNullCount(_ftsCash.annualFCF) > _nonNullCount(_qsCash.annualFCF) ? _ftsCash : _qsCash;
        }
        canonical.annual.annualFCF = _cashWinner.annualFCF;
        canonical.annual.annualOCF = _cashWinner.annualOCF;
      }
      const _ftsRevQNonNull = (ftsQuarterly.revenueQ||[]).filter(v=>v!=null&&(v.value!=null||typeof v==='number')).length;
      const _qsRevQNonNull = (canonical.timeseries.revenueQ||[]).filter(v=>v!=null&&(v.value!=null||typeof v==='number')).length;
      // F-010 (audit 2026-06-08): opIncQ/grossProfitQ must come from the SAME source
      // as revenueQ. Previously FTS opIncQ/grossProfitQ overwrote unconditionally —
      // when quoteSummary kept revenueQ, methods zipped QS revenue quarters against
      // FTS opInc quarters (different windows/lengths → wrong-quarter ratios). The
      // three series now move as one unit: FTS wins revenueQ → FTS siblings replace
      // QS siblings (even when empty, to avoid stale cross-source leftovers); QS
      // keeps revenueQ → QS siblings stay. Trade-off: a ticker whose opIncQ only
      // exists in the losing source goes incomputable instead of misaligned.
      if (_ftsRevQNonNull > _qsRevQNonNull) {
        canonical.timeseries.revenueQ = ftsQuarterly.revenueQ;
        canonical.timeseries.opIncQ = ftsQuarterly.opIncQ;
        canonical.timeseries.grossProfitQ = ftsQuarterly.grossProfitQ;
        // audit/fix A10: Ends bewegen sich als EINE Einheit mit revenueQ. FTS-Cache-
        // Einträge VOR A10 haben keine revenueQEnds → _alignEnds liefert ehrliche
        // null-Serie in revenueQ-Länge (kein Fabrizieren, index/länge konsistent).
        canonical.timeseries.revenueQEnds = _alignEnds(ftsQuarterly.revenueQEnds, ftsQuarterly.revenueQ);
        canonical.timeseries.grossProfitQEnds = _alignEnds(ftsQuarterly.grossProfitQEnds, ftsQuarterly.grossProfitQ);
      }

      // Tag 203: post-FTS sector-aware OpInc fallback. After both quoteSummary
      // and FTS merges, if annualOpInc is still empty AND sector is Financial
      // Services, derive an estimate from operatingMargin × annualRev. Must run
      // BEFORE _convertSnapshotToUSD so the derived values are FX-converted
      // alongside the rest of annual.*. Idempotent — only fires when needed.
      // The fallback in mapYahooToCanonical already ran on quoteSummary fields,
      // but a partial FTS merge can leave annualOpInc shorter than annualRev;
      // this re-derivation guarantees a complete series when the metric exists.
      runLamp('opIncFinancialsFallback', canonical.meta, () => {
        const _postSector = canonical.meta && canonical.meta.sector;
        const _postRev = canonical.annual && canonical.annual.annualRev || [];
        const _postOpInc = canonical.annual && canonical.annual.annualOpInc || [];
        const _postOpIncNonNull = _postOpInc.filter(v => v != null && (typeof v !== 'object' || v.value != null)).length;
        const _postOpMarg = canonical.metrics && canonical.metrics.operatingMargin && canonical.metrics.operatingMargin.value;
        // operatingMargin.value is in percent (43.741); convert back to fraction.
        const _opMargFrac = (typeof _postOpMarg === 'number' && Number.isFinite(_postOpMarg)) ? _postOpMarg / 100 : null;
        // Tag 206f: accept both Financial Services and Financials variant (same fix as mapper line).
        const _postIsFinancial = (_postSector === 'Financial Services' || _postSector === 'Financials');
        if (_postOpIncNonNull === 0 && _postIsFinancial && _postRev.length > 0) {
          const _retry = _deriveOpIncForFinancials([], _postRev, _opMargFrac);
          if (_retry.values.length > 0 && _retry.source) {
            canonical.annual.annualOpInc = _retry.values;
            canonical.meta.opIncSource = _retry.source;
          }
        }
      });

      // audit/fix (A2 council+court+anchor-fixture, 2026-06-26): newest-quarter source-corruption LAMP.
      // Yahoo intermittently serves a corrupted newest quarter (confirmed 005930.KS: opIncQ[0]/revenueQ[0]
      // ~42.8% vs ~10% trailing, co-corrupting financialData TTM -> a bogus revenueGrowthYoY ~69%). Detecting
      // this internal physical inconsistency is a data-QUALITY concern (Loop A); values stay FAITHFUL and the
      // disposition (down-weight/exclude) is delegated to Loop B per the §6 boundary + ledger §4 — the
      // non-destructive _debtPartial / _quality.grade pattern (NOT value-nulling fcfMarginTTMSuppressed). The
      // within-quarter trigger uses NO annual data (immune to the annual-scaling/TTM-fallback bugs) and was
      // tuned on 2715 real snapshots: flags 005930.KS + SNDK with ZERO legitimate-cyclical leaks (MU/FRO/INSW/
      // DHT/AG/NGD/NVDA all clean). Ratios are FX-invariant, so running pre-conversion is equivalent. Known-
      // shape detector — limited recall by design (see lib/newest-qtr-guard.js + ledger §4).
      runLamp('newestQtrSuspect', canonical.meta, () => {
        const _nqs = detectNewestQtrSuspect(canonical.timeseries);
        if (_nqs.suspect && canonical.meta) {
          canonical.meta._newestQtrSuspect = true;
          canonical.meta._newestQtrSuspectReason = _nqs.reason;
        }
      });

      // Tag 134: single-pass USD conversion across marketCap + revenueTTM + all annual/quarterly series.
      // Must run AFTER FTS overrides (FTS values are also in reporting currency) and BEFORE mcap filter
      // (which compares against $1B USD floor). Fixes the structural currency mismatch where mcap was USD
      // but annual.* was local — silently corrupting fcf-yield, ev/ebitda, ROIC and every other ratio.
      try { _convertSnapshotToUSD(canonical); }
      catch (e) { _log('WARN', `  FX conversion failed for ${stock.ticker}: ${e.message}`); }

      // Annual-revenue currency-leak LAMP. Besides cross-currency leaks, T027 covers the
      // INFY class where reporting + trading both claim USD but annualRev remains INR-sized.
      // Runs after conversion so the envelope metadata is final. Non-destructive: values
      // stay FAITHFUL; only suspect flags are persisted and Loop B owns disposition.
      runLamp('annualCurrencyLeak', canonical.meta, () => {
        _applyCurrencyConsistencyGuard(canonical);
      });

      // F-DQ-002: skip tickers where FX conversion failed — mcap is in local currency and would
      // pass or fail the USD mcap filter incorrectly.
      // F-DQ-016: mirror the skipped-mcap pattern — delete stale snapshot so it doesn't
      // persist and get scored with wrong currency data. Track via results (status
      // 'fx-unknown') rather than failures[] so it doesn't inflate the CI fail-ratio.
      if (canonical.meta && canonical.meta.fxConversionFailed === true) {
        _log('INFO', `  ⊘ ${stock.ticker} skipped: fx-unknown (currency=${canonical.meta.reportingCurrencyOriginal})`);
        const fxFilename = safeSnapshotFilename(stock.ticker);
        const fxOutPath = path.join(outputDir, fxFilename);
        if (fs.existsSync(fxOutPath)) {
          try { fs.unlinkSync(fxOutPath); } catch (e) {}
        }
        results.push({ ticker: stock.ticker, status: 'fx-unknown', reason: `currency=${canonical.meta.reportingCurrencyOriginal}` });
        return;
      }

      // Tag-87a: MarketCap-Filter — skip Stocks außerhalb Karl's Mid/Large-Cap-Range
      // Tag 170 (reverted): $1B min — Mid-Cap coverage preserved per user decision.
      const MIN_MCAP = MIN_MCAP_USD;   // env-configurable (MIN_MCAP_USD), default $1B
      const MAX_MCAP = Infinity;       // Tag 101: kein Mega-Cap-Cut mehr
      const mcapVal = canonical.marketCap && canonical.marketCap.value;
      // F-DQ-001 (Tag 179): null mcap previously short-circuited and passed through
      // the floor — admitting stocks with missing market-cap data into the universe.
      // Now: treat null/missing as below-floor and skip with a distinct reason.
      const mcapMissing = (mcapVal == null);
      const mcapOutOfRange = mcapVal != null && (mcapVal < MIN_MCAP || mcapVal > MAX_MCAP);
      if (mcapMissing || mcapOutOfRange) {
        const reason = mcapMissing
          ? `mcap=null (skip; no marketCap from Yahoo)`
          : (mcapVal < MIN_MCAP ? `mcap=${(mcapVal/1e9).toFixed(2)}B < $${(MIN_MCAP/1e9).toFixed(0)}B (Small-Cap)` : `mcap=${(mcapVal/1e9).toFixed(0)}B > $${MAX_MCAP === Infinity ? 'Infinity' : (MAX_MCAP/1e12).toFixed(0)+'T'} (Mega-Cap)`);
        _log('INFO', `  ⊘ ${stock.ticker} skipped: ${reason}`);
        // Remove existing snapshot if was previously included
        const filename = safeSnapshotFilename(stock.ticker);
        const outPath = path.join(outputDir, filename);
        if (fs.existsSync(outPath)) {
          try { fs.unlinkSync(outPath); } catch (e) {}
        }
        // Tag 134: also clean up the legacy un-sanitized name if it exists (migration step)
        const legacyFilename = `${stock.ticker.replace(/[^A-Z0-9.-]/gi, '_')}.json`;
        if (legacyFilename !== filename) {
          const legacyPath = path.join(outputDir, legacyFilename);
          if (fs.existsSync(legacyPath)) { try { fs.unlinkSync(legacyPath); } catch (e) {} }
        }
        // F-DP-035 (Tag 183): also clean up the 28-day FTS cache. Without this,
        // a ticker cycling around the $1B boundary gets fresh price mixed with
        // stale fundamentals when it bumps back above.
        const fundCachePath = path.join(__dirname, 'fundamentals-cache', filename);
        if (fs.existsSync(fundCachePath)) {
          try { fs.unlinkSync(fundCachePath); } catch (e) {}
        }
        results.push({ ticker: stock.ticker, status: 'skipped-mcap', reason });
        return;  // skip this stock
      }
      // Tag 133c: data-quality grade — A/B/C/D nach Anteil fehlender kritischer Felder.
      // Wird in jeden Snapshot geschrieben; score-aggregator nutzt es optional (DATAQUALITY_ENFORCE=1).
      try { canonical._quality = gradeSnapshot(canonical); }
      catch (e) {
        // F-DP-045 (Tag 182): previously the exception was swallowed and grade=D
        // attributed to "data quality" — masking grader bugs as missing data.
        // Log the actual error message so a grader regression becomes visible
        // instead of presenting as a wave of bad-data tickers.
        _log('WARN', `gradeSnapshot threw for ${stock.ticker}: ${e.message}`);
        canonical._quality = {
          grade: 'D', nanRatio: 1.0,
          missingFields: ['<grade-error: ' + e.message + '>'],
          computedAt: new Date().toISOString()
        };
      }

      // audit F-A-2026-06-21: emit a snapshot-level count of how many annual-
      // balance years carry an absence-as-zero (partial) totalDebt. The per-row
      // _debtPartial flag alone forces every downstream method to opt in to
      // notice the understatement; a meta-level tally lets score-aggregator
      // tier-cap on the magnitude of the gap without re-walking the array.
      // Failure mode prevented: leverage-based scores silently trusting
      // understated totalDebt across multiple years with no aggregate signal.
      runLamp('debtUnderstatedTally', canonical.meta, () => {
        const _bal = (canonical.annual && canonical.annual.annualBalance) || [];
        const _understatedYears = _bal.filter(b => b && b._debtPartial === true).length;
        if (_understatedYears > 0) {
          canonical.meta = canonical.meta || {};
          canonical.meta._debtUnderstatedYears = _understatedYears;
        }
      });

      const filename = safeSnapshotFilename(stock.ticker);
      const outPath = path.join(outputDir, filename);
      // Tag 134: migrate from legacy un-sanitized name (one-time)
      const legacyFilename = `${stock.ticker.replace(/[^A-Z0-9.-]/gi, '_')}.json`;
      if (legacyFilename !== filename) {
        const legacyPath = path.join(outputDir, legacyFilename);
        if (fs.existsSync(legacyPath)) { try { fs.unlinkSync(legacyPath); } catch (e) {} }
      }
      // F-DP-047 (Tag 192): atomic snapshot write. Vorher: direct writeFileSync
      // konnte unter SIGTERM (CI cancel @165min) eine truncated snapshot-Datei
      // hinterlassen; nächste Pull-Runde liest dann eine korrupte JSON beim
      // price-only-Check (line 801 _priceOnlyUpdate) und wirft, was die teure
      // full-pull-Branch trotz noch-frischer Daten triggert.
      // Tag 232c-6 (audit F-PF-002 HIGH): drop the 2-indent — same rationale
      // as the price-only write above. Full-pull is the slow path (~2s/ticker
      // with retries) so the stringify savings are smaller percentage-wise
      // here, but consistent format across all snapshot writes simplifies
      // downstream parsing assumptions and prevents the 267-MB methods-report
      // class of regressions (Tag 220b).
      // audit/fix F3 (2026-06-25): stamp the SEPARATE full-pull clock here — this is
      // the only point a full pull (fresh annual/metrics/FTS) actually lands on disk.
      // _priceOnlyUpdate NEVER writes this field, so it records the true age of the
      // fundamentals (not the daily-reset meta.asOf), and the eligibility gate uses it
      // to force a full refresh every FUNDAMENTALS_REFRESH_DAYS.
      canonical.meta = canonical.meta || {};
      canonical.meta.fundamentalsAsOf = canonical.meta.asOf || new Date().toISOString();
      writeFileAtomic(outPath, JSON.stringify(canonical));
      const revStr = canonical.metrics.revenueTTM ? '$' + (canonical.metrics.revenueTTM.value / 1e9).toFixed(1) + 'B' : 'no-rev';
      const growthStr = canonical.metrics.revenueGrowthYoY ? canonical.metrics.revenueGrowthYoY.value.toFixed(1) + '%' : '-';
      // P1-Fix Tag 13: data-completeness pro Stock loggen, damit downstream-Filter
      // selbst entscheiden können bei leeren annual/timeseries-Arrays.
      const completeness = {
        annualRev: canonical.annual.annualRev.length,
        annualOpInc: canonical.annual.annualOpInc.length,
        annualNetIncome: canonical.annual.annualNetIncome.length,
        annualGP: canonical.annual.annualGP.length,
        annualFCF: canonical.annual.annualFCF.length,
        revenueQ: canonical.timeseries.revenueQ.length,
        opIncQ: canonical.timeseries.opIncQ.length
      };
      results.push({ ticker: stock.ticker, status: 'ok', file: filename, revenue: revStr, growth: growthStr, completeness });
      _log('INFO', `  ✓ ${stock.ticker}: revenue=${revStr}, growth=${growthStr}, sector=${canonical.meta.sector}`);
    } catch (e) {
      // Tag 134 — Phase 5.3: classify error type so pull-stats-check can alert on
      // patterns (e.g. >5% rate-limit suggests a Yahoo policy change vs >5% 404
      // suggests universe contains dead tickers).
      const msg = String(e.message || '');
      // F-DP-006: surface programming errors (TypeError/ReferenceError) separately from transient Yahoo failures
      let errClass = 'other';
      if (e.constructor && (e.constructor.name === 'TypeError' || e.constructor.name === 'ReferenceError')) {
        errClass = 'mapper-bug';
        console.error('MAPPER-BUG', e.stack);
      } else if (/429|too many request|rate.?limit/i.test(msg)) errClass = 'rate-limit';
      // Bug 2 (audit 2026-07-03): 'Invalid Crumb'/'Invalid Cookie' are Yahoo
      // session/auth failures from the crumb flow — NOT a statement about the
      // symbol. They typically hit many tickers of a run at once when the crumb
      // expires mid-run. Previously they matched the not-found regex below and
      // set meta.delisted=true → prune-watchlist permanently removed live tickers.
      // Classify as a transient 'auth' class (like rate-limit) that never enters
      // the delisted branch, so the ticker is simply retried on the next run.
      else if (/invalid (cookie|crumb)/i.test(msg)) errClass = 'auth';
      else if (/404|not found|invalid symbol|no data found|no fundamentals data found/i.test(msg)) errClass = 'not-found';
      else if (/timeout|ETIMEDOUT|ESOCKETTIMEDOUT/i.test(msg)) errClass = 'timeout';
      else if (/ENOTFOUND|ECONNREFUSED|ECONNRESET|EAI_AGAIN|network/i.test(msg)) errClass = 'network';
      else if (/parse|unexpected token|JSON/i.test(msg)) errClass = 'parse';
      // audit F-A-2026-06-21: Yahoo schema-validation failures get their OWN
      // 'schema-fail' class and are NO LONGER reclassified as not-found.
      // Prevents valid international tickers with partial-but-valid payloads
      // from being permanently marked delisted (survivorship attrition of
      // non-US names). Tag 215h originally folded these into not-found so the
      // snapshot got delisted — but the multi-module quoteSummary call only
      // failing the library's strict-shape validator does NOT prove the symbol
      // is gone; many of these are real, listed, internationally-domiciled
      // companies whose payload is merely incomplete for one requested region.
      // 'schema-fail' is still counted in `failures` (so pull-stats-check can
      // monitor the schema-vs-not-found ratio as the sentinel Tag 215h intended)
      // but does NOT enter the delisted branch below → the ticker is retried on
      // the next run instead of being silently dropped from the universe.
      // The delisted flag is reserved for the unambiguous not-found regex above
      // (literal 404 / "no data found" / "invalid symbol").
      else if (/Failed Yahoo Schema validation|schema validation/i.test(msg)) errClass = 'schema-fail';

      // audit fix BH-042: opendart-kr.js (KR universe adapter) flags KOSPI/KOSDAQ-
      // ambiguous tickers with suffixUnsure:true + a default ".KS" guess (corpCode.xml
      // carries no market-segment field) and documents this exact retry as the
      // promised downstream correction ("the downstream Yahoo pull can drop the clean
      // 404 and retry .KQ") — it never existed anywhere in this file. A clean not-found
      // on an unsure .KS symbol very likely means the ticker is actually KOSDAQ (.KQ);
      // retry once with the corrected suffix before falling into the not-found/delisted
      // handling below. _kqRetried guards against re-recursing if .KQ ALSO 404s.
      // ponytail: the corrected suffix is not persisted back to watchlist.json
      // (pull-yahoo.js never writes it) — costs one extra request per affected ticker
      // per run, acceptable given the KR adapter is currently dormant (OPENDART_KEY
      // unset in CI).
      if (shouldRetryKosdaq(stock, errClass)) {
        const kqSymbol = stock.yahoo_symbol.replace(/\.KS$/i, '.KQ');
        _log('INFO', `  ${stock.ticker}: suffixUnsure .KS not-found — retrying as ${kqSymbol}`);
        return processOne(Object.assign({}, stock, { yahoo_symbol: kqSymbol, _kqRetried: true }));
      }

      // Tag 148: mark snapshot as delisted when Yahoo definitively rejects the symbol
      // (not-found class only — transient errors like rate-limit/timeout/network must NOT set this flag).
      if (errClass === 'not-found') {
        const filename = safeSnapshotFilename(stock.ticker);
        const outPath = path.join(outputDir, filename);
        try {
          let existing = fs.existsSync(outPath) ? JSON.parse(fs.readFileSync(outPath, 'utf8')) : null;
          if (existing && existing.meta) {
            // audit fix BH-047: require NOT_FOUND_DELIST_STREAK consecutive not-found
            // runs before setting the delisted flag — the next prune-watchlist run
            // removes anything flagged delisted, irreversibly, so a single transient
            // 404/missing-fundamentals response must not trigger it.
            const { streak, delisted } = nextNotFoundState(existing.meta);
            existing.meta.notFoundStreak = streak;
            if (delisted) {
              existing.meta.delisted = true;
              existing.meta.delistedAt = new Date().toISOString();
            }
            // F-DP-028 → factored into writeFileAtomic (Tag 189).
            // Tag 232c-6: compact stringify; see fast-path note above.
            writeFileAtomic(outPath, JSON.stringify(existing));
            _log('INFO', delisted
              ? `  Marked ${stock.ticker} as delisted in snapshot (not-found streak ${streak})`
              : `  ${stock.ticker} not-found (streak ${streak}/${NOT_FOUND_DELIST_STREAK}) — not yet delisted`);
          }
        } catch (writeErr) {
          _log('WARN', `  Could not update delisted flag for ${stock.ticker}: ${writeErr.message}`);
        }
      }

      failures.push({ ticker: stock.ticker, error: msg, errClass });
      _log('ERROR', `  ✗ ${stock.ticker}: [${errClass}] ${msg}`);
    }

    }
  // Tag 163: p-limit style worker pool — each worker independently loops through tickers.
  // A stalled ticker blocks only its own worker, not all CONCURRENCY workers.
  // Replaces batch Promise.all which gated all workers on the slowest ticker.
  // A rate-limited ticker (up to ~29s total: 12s + 5s + 12s timeouts/delays) blocks
  // only its own slot; the other workers keep pulling uninterrupted.
  //
  // audit F-A-2026-06-21: GLOBAL request-spacing gate (prevented failure mode:
  // anti-429 throttle defeated by concurrency — effective request rate was
  // concurrency × the intended rate). The old per-worker `_sleep(sleepMs)` after
  // every ticker meant each of the CONCURRENCY workers independently spaced ITS
  // OWN pulls by rateLimitMs, so aggregate issue rate was ~concurrency/rateLimitMs
  // req/s (e.g. 20 / 1.5s ≈ 13 req/s) — the 1500ms "rate limit" was never a global
  // request spacing and Yahoo saw bursts that tripped 429s.
  //
  // audit fix BH-043: the gate ITSELF (formerly a local `acquireSlot()` reserving
  // one slot per ticker, right here, before processOneFn) moved to the MODULE-scope
  // acquireYfSlot() and is now called before EACH individual yf.* request (quote,
  // quoteSummary, the 4 fundamentalsTimeSeries calls) — a ticker fires ~6 sequential
  // requests, and gating only the ticker START never actually spaced them. Sub-slot
  // reservation logic unchanged (Math.max(now, nextSlotAt) + no-await-between-read-
  // and-write == atomic under Node's single thread); it just now lives where every
  // real request routes through it, instead of once per ticker here.
  async function runWorkerPool(stocks, processOneFn, concurrency, sleepMs, writeManifestFn) {
    let idx = 0;
    async function worker() {
      while (true) {
        const myIdx = idx++;
        if (myIdx >= stocks.length) break;
        const stock = stocks[myIdx];
        await processOneFn(stock).catch(e => _log('WARN', `Worker error ${stock.ticker}: ${e.message}`));
        // flush manifest every 100 tickers using the captured local index
        if (myIdx > 0 && myIdx % 100 === 0) writeManifestFn();
      }
    }
    await Promise.all(Array.from({ length: concurrency }, () => worker()));
  }

  await runWorkerPool(watchlist.stocks, processOne, CONCURRENCY, rateLimitMs, writeManifestIncremental);
  writeManifestIncremental(); // final incremental flush before full manifest

  // audit/fix F3-budget (2026-06-25): report time-based fundamentals-refresh usage so a
  // mass re-expiry stampede that hit the cap is visible. Deferred tickers fell back to
  // price-only this run and will be picked up next run (oldest-first).
  if (_fundamentalsRefreshDeferred > 0) {
    _log('INFO', `Fundamentals-refresh budget: ${_fundamentalsRefreshUsed}/${FUNDAMENTALS_REFRESH_BUDGET} time-based full pulls used; ${_fundamentalsRefreshDeferred} ticker(s) deferred to price-only (caught next run, oldest-first) to protect the coverage gate.`);
  } else {
    _log('INFO', `Fundamentals-refresh budget: ${_fundamentalsRefreshUsed}/${FUNDAMENTALS_REFRESH_BUDGET} time-based full pulls used; none deferred.`);
  }

  // F-DP-047 (Tag 192): same n_ok-vs-skipped-mcap fix as in the incremental
  // writeManifestIncremental() — final manifest must agree with the snapshot
  // count actually on disk.
  const okResultsFinal = results.filter(r =>
    r && (r.status === 'ok' || r.status === 'price-only'));
  const skippedMcapFinal = countSkippedMcap(results);
  // TASK 0.11: surface the silent-error tally in the run log so it is visible even on a
  // clean run (the manifest carries it too, but the log survives regardless of write path).
  const _silentErrors = { lamp: _lampErrors, needsFullPull: _needsFullPullThrew, corruptYoung: _corruptYoungSnapshots, ftsCacheParse: _ftsCacheParseErrors };
  _log('INFO', `Silent-error tally (0.11): lamp=${_lampErrors} needsFullPull=${_needsFullPullThrew} corruptYoung=${_corruptYoungSnapshots} ftsCacheParse=${_ftsCacheParseErrors}`);
  const manifest = {
    pulled_at: new Date().toISOString(),
    watchlist_version: watchlist._meta && watchlist._meta.version,
    n_total: watchlist.stocks.length,
    n_ok: okResultsFinal.length,
    n_skipped_mcap: skippedMcapFinal,
    n_failed: failures.length,
    _silentErrors,
    results,
    failures
  };
  // Tag 153: write slim manifest (n_ok/n_failed only) to committed _manifest.json.
  // Full manifest (with per-ticker results/failures) goes to gitignored _manifest-full.json.
  // Saves ~1.4 MB per daily commit (95% of the committed file was diagnostics-only).
  // Tag 155: partial:false signals clean end-of-run write (incremental writes during loop set partial:true).
  // TASK 0.9 (Pull-Diät): carry n_full/n_priceonly on the clean-run slim too, so
  // the coverage step reads the same fields whether the run timed out (partial
  // incremental manifest) or finished (this write).
  const nFullFinal = okResultsFinal.filter(r => r.status === 'ok').length;
  // Task 0.12: n_addressable = ehrlicher Coverage-Nenner (Universum minus mcap-Skips;
  // belegt-tote Ticker sind bereits auf Watchlist-Ebene ausgetragen, siehe
  // data-health/dead-tickers.json). coverage-gate misst die 90%-Latte hiergegen.
  // Tag 464: n_skipped_owned wird hier NICHT von n_addressable abgezogen — n_total ist in
  // diesem Manifest bereits die gefilterte Liste. Nur der Merge, der n_total durch das volle
  // Universum ersetzt, muss die Zahl abziehen. Doppelt abziehen hiesse: Nenner zu klein,
  // Coverage zu optimistisch — und genau das schaltete Karls einzigen Alarm still.
  const slim = { pulled_at: manifest.pulled_at, watchlist_version: manifest.watchlist_version, n_total: manifest.n_total, n_ok: manifest.n_ok, n_full: nFullFinal, n_priceonly: okResultsFinal.length - nFullFinal, n_skipped_mcap: manifest.n_skipped_mcap, n_skipped_owned: (watchlist._skippedOwned || 0), n_addressable: manifest.n_total - manifest.n_skipped_mcap, n_failed: manifest.n_failed, _silentErrors, partial: false };
  // Tag 189: factored into writeFileAtomic helper.
  const slimPath = path.join(outputDir, '_manifest.json');
  writeFileAtomic(slimPath, JSON.stringify(slim));
  const fullPath = path.join(outputDir, '_manifest-full.json');
  writeFileAtomic(fullPath, JSON.stringify(manifest));
  _log('INFO', `Pull complete: ${okResultsFinal.length}/${watchlist.stocks.length} ok (${skippedMcapFinal} skipped-mcap), ${failures.length} failed`);
  return manifest;
}

// 0.2/0.9 Sharding (Tag 279): deterministischer djb2-Hash je Ticker -> STABILE Shard-Zuordnung. Ein Ticker
// landet unabhaengig von Watchlist-Groesse/Reihenfolge immer im selben Shard -> sein Cache bleibt im selben
// Shard konsistent (kein Cache-Miss beim Universe-Wachstum), und die N Shards partitionieren das Universum
// vollstaendig + disjunkt + ~gleichverteilt. Reine Funktion (TDD).
function shardHash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (((h << 5) + h) + s.charCodeAt(i)) >>> 0; // djb2, unsigned 32-bit
  return h;
}
// Behaelt aus stocks nur die des Shards index/count (hash(ticker) % count === index). shard null -> alle.
function shardStocks(stocks, shard) {
  if (!shard) return stocks;
  return stocks.filter((s) => shardHash(String((s && (s.ticker || s.isin)) || '')) % shard.count === shard.index);
}

function parseArgs(argv) {
  // audit fix BH-182/BH-194: `help` and `argError` added. parseArgs previously ignored
  // BOTH unknown flags (so "--help" silently fell through to a full watchlist pull that
  // starts by deleting the committed prod manifest — a real documented incident) AND a
  // malformed-but-present --shard value (WARN + null shard → silent full-universe pull
  // instead of the intended shard slice). main() must check args.help/args.argError
  // BEFORE any file mutation.
  const args = { watchlist: 'watchlist.json', output: './snapshots', rateLimit: 1500, shard: null, help: false, argError: null };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--help' || argv[i] === '-h') args.help = true;
    else if (argv[i] === '--watchlist' && argv[i+1]) args.watchlist = argv[++i];
    else if (argv[i] === '--output' && argv[i+1]) args.output = argv[++i];
    else if (argv[i] === '--rate-limit' && argv[i+1]) {
      const n = parseInt(argv[++i], 10);
      args.rateLimit = (Number.isFinite(n) && n > 0) ? n : 1500;  // P1-Fix Tag 13
    }
    // 0.2/0.9 Sharding: --shard i/N -> nur den i-ten von N Shards ziehen (0<=i<N).
    // BH-194: malformed (flag present, value invalid) is now a hard argError — distinct
    // from "no --shard flag at all" (args.shard stays null, full universe, as designed).
    else if (argv[i] === '--shard' && argv[i+1]) {
      const raw = argv[++i];
      const [idx, cnt] = String(raw).split('/').map((x) => parseInt(x, 10));
      if (Number.isInteger(idx) && Number.isInteger(cnt) && cnt > 0 && idx >= 0 && idx < cnt) args.shard = { index: idx, count: cnt };
      else if (!args.argError) args.argError = `Ungueltiges --shard "${raw}" (erwartet i/N, 0<=i<N)`;
    }
    else if (!args.argError) args.argError = `Unbekanntes Argument "${argv[i]}"`;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  // BH-182: bail BEFORE the manifest-delete/watchlist-load/full-pull below.
  if (args.help) {
    console.log('Usage: node pull-yahoo.js [--watchlist FILE] [--output DIR] [--rate-limit MS] [--shard i/N]');
    process.exit(0);
  }
  if (args.argError) {
    _log('ERROR', args.argError);
    process.exit(1);
  }
  if (!fs.existsSync(args.watchlist)) {
    _log('ERROR', `Watchlist not found: ${args.watchlist}`);
    process.exit(1);
  }
  // Tag 153: delete committed _manifest.json before the pull so a mid-run SIGKILL cannot
  // leave yesterday's stale n_ok on disk, causing the quality gate to pass on partial data.
  const manifestPath = path.join(args.output, '_manifest.json');
  if (fs.existsSync(manifestPath)) {
    try { fs.unlinkSync(manifestPath); _log('INFO', 'Deleted stale _manifest.json'); }
    catch (e) { _log('WARN', 'Could not delete stale _manifest.json: ' + e.message); }
  }
  const watchlist = JSON.parse(fs.readFileSync(args.watchlist, 'utf8'));
  if (!watchlist.stocks || !Array.isArray(watchlist.stocks)) {
    _log('ERROR', 'Watchlist must have .stocks array');
    process.exit(1);
  }
  // 0.2/0.9 Sharding: nur die Ticker DIESES Shards ziehen (parallele Matrix-Jobs decken je eine Scheibe ab;
  // zusammen das volle Universum). n_total im Manifest ist dann die SHARD-Groesse — der Merge-/Coverage-Gate
  // im Sammel-Job zaehlt das zusammengefuehrte Universum.
  // REIHENFOLGE (Tag 464): das Sharding steht bewusst VOR der Eigentumsgrenze. shardStocks teilt
  // per Ticker-Hash auf (shardHash(ticker) % count), ist also unabhaengig von Reihenfolge und
  // Laenge der Liste (festgenagelt in tests/pull-shard.test.js: "Universe-Wachstum verschiebt
  // bestehende Ticker NICHT in andere Shards") — die Scheiben sind exakt dieselben wie vorher.
  // Gewonnen ist, dass jeder
  // Shard nur die uebersprungenen Namen SEINER Scheibe zaehlt und die Summe ueber alle Shards
  // genau die globale Zahl ergibt. Filtert man zuerst, meldet jeder der 17 Shards dieselbe
  // globale Zahl und der Merge wuerde sie 17-fach vom Nenner abziehen.
  if (args.shard) {
    const before = watchlist.stocks.length;
    watchlist.stocks = shardStocks(watchlist.stocks, args.shard);
    _log('INFO', `Shard ${args.shard.index}/${args.shard.count}: ${watchlist.stocks.length}/${before} Ticker in dieser Scheibe`);
  }

  // 5.2 Auflage 6 / Karl-Entscheid 27.07.2026 ("A — die Small-Cap-Liste besitzt das Band"):
  // 583 der 775 Small-Cap-Ticker standen AUCH in der Hauptliste. Beide Laeufe holten sie
  // taeglich getrennt bei Yahoo ab — der Hauptlauf verwarf sie danach unterhalb seiner
  // 800-Mio.-Grenze. Das ist die Doppellast, die der Council bei Einwand 8 verhindern wollte.
  //
  // Bewusst als FILTER beim Abruf, NICHT als Loeschung aus watchlist.json: die Mitgliedschaft
  // bleibt unveraendert erhalten, der Hauptlauf ueberspringt diese Ticker nur. Damit ist der
  // Schritt jederzeit rueckgaengig (Datei weg = alter Zustand) und es geht keine Historie
  // verloren. Greift NUR, wenn der Hauptlauf mit der Hauptliste laeuft — der Small-Cap-Lauf
  // uebergibt seine eigene Liste per --watchlist und darf sich nicht selbst leerfiltern.
  const SMALLCAP_LISTE = 'watchlist-smallcap.json';
  if (path.resolve(args.watchlist) !== path.resolve(SMALLCAP_LISTE) && fs.existsSync(SMALLCAP_LISTE)) {
    try {
      const sc = JSON.parse(fs.readFileSync(SMALLCAP_LISTE, 'utf8'));
      const scTicker = new Set(
        (Array.isArray(sc) ? sc : (sc.stocks || []))
          .map((e) => (typeof e === 'string' ? e : e && e.ticker))
          .filter(Boolean),
      );
      // ⚠ KORREKTUR (unabhaengige Pruefung 27.07., am Bestand reproduziert): NICHT jeden Namen
      // der Small-Cap-Liste ueberspringen. Karls Entscheid 2 gibt der Small-Cap-Liste das BAND
      // 300–800 Mio. — nicht die Namen, die inzwischen darueber liegen. Wer die pauschal
      // ueberspringt, schaltet fuer sie auch den mcap-Skip-Pfad ab, der ihre Snapshot-Datei
      // sonst pflegt: sie wird weder aktualisiert noch entfernt. Ergebnis waere ein
      // EINGEFRORENER Snapshot, der im Hauptboard weiter mitgescort wird — sichtbar falsch ist
      // schlimmer als unsichtbar. Kein Gate faengt das: die Frische-Pruefung arbeitet auf der
      // Aggregatquote, und ein paar hundert von 12.300 reissen sie nicht.
      // Lokal gemessen: 26 Namen stehen in beiden Listen UND liegen bei >= 800 Mio.
      //
      // Uebersprungen wird deshalb nur, wer nach dem EIGENEN letzten Stand des Hauptlaufs
      // wirklich im Band liegt. Ohne Snapshot wird uebersprungen (der Small-Cap-Lauf holt ihn),
      // mit Snapshot ueber der Grenze wird weiter gezogen.
      // ⚠ ZWEITE KORREKTUR derselben Stelle (unabhaengige Pruefung 27.07., Fund zur
      // Survivor-Bias-Bereinigung): uebersprungen wird nur, wer in snapshots/ GAR KEINE Datei
      // (mehr) hat. Grund: der Hauptlauf loescht die Datei selbst, sobald ein Ticker unter die
      // 800-Mio.-Schwelle faellt — ein Pfad, der ausdruecklich gegen Survivor-Bias gebaut wurde.
      // Wer pauschal uebersprungen wird, erreicht diesen Pfad nie: seine Datei wird weder
      // aktualisiert noch entfernt und bleibt als eingefrorener Stand im Board stehen.
      // Am Bestand gemessen: 98 Ticker stehen in beiden Listen UND haben eine Datei — 26 davon
      // ueber der Schwelle (die bleiben ohnehin, s. o.), 72 darunter, also 72 potenzielle
      // Karteileichen mit eingefrorenen Kursen.
      //
      // Diese Fassung braucht KEINEN neuen Loeschcode: die Namen laufen einmal durch den
      // normalen Weg, der bestehende mcap-Skip raeumt ihre Datei ab, und ab dem naechsten Lauf
      // greift das Ueberspringen von selbst. Einmalig ~98 Abrufe mehr, danach null.
      const ohneStand = (t) => {
        try {
          return !fs.existsSync(path.join(args.output, safeSnapshotFilename(t)));
        } catch (_) { return true; }                          // im Zweifel ueberspringen wie bisher
      };
      if (scTicker.size) {
        const vorher = watchlist.stocks.length;
        let behaltenMitStand = 0;
        watchlist.stocks = watchlist.stocks.filter((e) => {
          const t = typeof e === 'string' ? e : (e && e.ticker);
          const aufSmallcapListe = Boolean(t && scTicker.has(t));
          const hatSnapshot = aufSmallcapListe ? !ohneStand(t) : false;
          // Tag 466: Entscheidung ueber die reine Funktion, damit sie einen Waechter hat.
          if (ueberspringtSmallcapTicker({ aufSmallcapListe, hatSnapshot })) return false;
          if (aufSmallcapListe && hatSnapshot) behaltenMitStand++;
          return true;
        });
        if (behaltenMitStand > 0) {
          _log('INFO', `Small-Cap-Eigentumsgrenze: ${behaltenMitStand} Ticker BLEIBEN im Hauptlauf, weil sie noch eine Snapshot-Datei haben (sonst friere sie ein; der normale mcap-Skip raeumt sie ab)`);
        }
        const weg = vorher - watchlist.stocks.length;
        // Tag 464: die Zahl MUSS ins Manifest. Diese Ticker werden nie versucht, verschwinden im
        // Merge-Schritt aber NICHT aus dem Nenner — der ersetzt n_total durch das volle Universum
        // aus watchlist.json (siehe merge-shard-manifests.js), waehrend n_ok sie nicht enthaelt.
        // Gemessen am Lauf 30230485209: 10.672/12.956 = 82,4 % statt ehrlich 10.672/12.373 = 86,3 %.
        // Wichtig: n_total DIESES Manifests ist bereits um `weg` reduziert (es wird in pullAll aus
        // der gefilterten Liste genommen) — nur der Merge, der n_total ersetzt, zieht sie ab.
        watchlist._skippedOwned = (watchlist._skippedOwned || 0) + weg;
        if (weg > 0) _log('INFO', `Small-Cap-Eigentumsgrenze: ${weg} Ticker uebersprungen (gehoeren ${SMALLCAP_LISTE}); ${watchlist.stocks.length}/${vorher} bleiben`);
      }
    } catch (e) {
      // Fail-soft: eine unlesbare Small-Cap-Liste darf den Hauptlauf nicht stoppen —
      // dann wird eben wie bisher alles geholt (Doppellast, aber keine Datenluecke).
      _log('WARN', `Small-Cap-Liste nicht lesbar (${e.message}) — Hauptlauf holt unveraendert alles`);
    }
  }

  const manifest = await pullAll(watchlist, args.output, args.rateLimit);
  // Tag 147: threshold is relative to "attempted" (excludes skipped-mcap which never
  // hit the network). Counting skipped-mcap in n_total inflated the denominator and
  // made the 75% guard meaningless for large universes with many micro-cap tickers.
  const skippedMcap = (manifest.results || []).filter(r => r.status === 'skipped-mcap').length;
  // F-DQ-016: exclude fx-unknown from the attempted denominator — these are not network/data
  // failures but missing FX rates; conflating them inflates the fail-ratio and can trip CI.
  const skippedFx = (manifest.results || []).filter(r => r.status === 'fx-unknown').length;
  const attempted = Math.max(1, manifest.n_total - skippedMcap - skippedFx);
  const failRatio = manifest.n_failed / attempted;
  _log('INFO', `Fail-ratio: ${(failRatio * 100).toFixed(1)}% (${manifest.n_failed} fail / ${attempted} attempted; ${skippedMcap} skipped-mcap, ${skippedFx} fx-unknown)`);
  // F-DP-008 (Tag 233b): mapper-bug (TypeError/ReferenceError in mapYahooToCanonical) is
  // a programming error — not a transient Yahoo failure. Even 1 means the mapper is broken
  // for some ticker shape. Exit 1 immediately so CI catches the regression before it
  // gets absorbed into the overall fail-ratio (which only gates at >75%).
  const mapperBugCount = (manifest.failures || []).filter(f => f.errClass === 'mapper-bug').length;
  if (mapperBugCount > 0) {
    _log('ERROR', `MAPPER-BUG: ${mapperBugCount} TypeError/ReferenceError in mapYahooToCanonical — programming error, not transient Yahoo failure`);
    process.exit(1);
  }
  process.exit(failRatio > 0.75 ? 1 : 0);
}

// TASK 0.9 (Pull-Diät): pure decision fn — did this ticker report earnings since
// its last full pull? If so it MUST take an UNBUDGETED full pull (new financials
// exist), like staleSchema/staleCurrency — NOT via FUNDAMENTALS_REFRESH_BUDGET.
// Contract: 'full' iff earningsEntry.date exists AND date <= today AND
// date > meta.fundamentalsAsOf; else 'price-only'. Never throws (returns 'price-only' on
// any bad input); the catch is unreachable on valid input, so the fn is pure/deterministic
// for all VALID inputs (what pull-diet.test.js exercises). TASK 0.11: the catch now
// logs+counts instead of swallowing an exotic throw silently.
// All inputs are treated as untrusted (garbage in → 'price-only', not a throw).
// ponytail: string-compares the two dates by parsing to epoch, not lexical —
// fundamentalsAsOf is a full ISO timestamp, earnings date a YYYY-MM-DD day.
function needsFullPull(snapshotMeta, earningsEntry, today) {
  try {
    const earnDate = earningsEntry && earningsEntry.date;
    if (!earnDate) return 'price-only';
    const earnT = new Date(earnDate).getTime();
    if (!Number.isFinite(earnT)) return 'price-only';

    const todayT = (today instanceof Date) ? today.getTime() : new Date(today).getTime();
    if (!Number.isFinite(todayT)) return 'price-only';
    // Not-yet-reported earnings (future date) carry no new financials → price-only.
    if (earnT > todayT) return 'price-only';

    // No last-full-pull clock → cannot prove the report is newer than our data.
    // Be conservative: don't force an unbudgeted full on missing/garbage meta.
    const asOf = snapshotMeta && snapshotMeta.fundamentalsAsOf;
    if (!asOf) return 'price-only';
    const asOfT = new Date(asOf).getTime();
    if (!Number.isFinite(asOfT)) return 'price-only';

    // Earnings-Datum ist tags-genau (parst als UTC-Mitternacht). Ein Voll-Pull am
    // Earnings-TAG VOR der Veröffentlichung (asOf 02:39Z, Release 08:00) darf den
    // Trigger nicht dauerhaft löschen — Live-Beleg 16.07.: GS/FAST/ERIC (date 07-14,
    // asOf 07-14T02:39Z) bekamen nie einen Earnings-Refresh. Deshalb zählt das ENDE
    // des Earnings-Tages; kostet je Reporter höchstens einen redundanten Voll-Pull.
    const earnEndT = earnT + 86400000;
    return (earnEndT > asOfT) ? 'full' : 'price-only';
  } catch (e) {
    // TASK 0.11: near-unreachable — every untrusted path above returns a defined
    // 'price-only' WITHOUT throwing. If an exotic input (e.g. a throwing valueOf) ever
    // reaches here, make it LOUD (count + log) instead of swallowing it. Still returns
    // 'price-only'; the rolling FUNDAMENTALS_REFRESH_DAYS sweep guarantees the ticker is
    // never permanently frozen out of full pulls. See ledger §0.11.
    _needsFullPullThrew++;
    _log('WARN', `needsFullPull threw on exotic input (non-fatal → price-only): ${e && e.message}`);
    return 'price-only';
  }
}

if (require.main === module) {
  main().catch(e => {
    _log('FATAL', e.stack || e.message);
    process.exit(1);
  });
}

module.exports = { mapYahooToCanonical, pullAll, normalizeRegion, _convertSnapshotToUSD, safeSnapshotFilename, _realignFtsAnchoredSeries, needsFullPull, sortByStaleness,
  // 0.2/0.9 Sharding (Tag 279): fuer TDD
  shardHash, shardStocks, parseArgs,
  // F1 (Codex-Fund): ehrlicher mcap-Skip-Zaehler (schliesst fx-unknown aus) — fuer TDD
  countSkippedMcap,
  // Tag 466: Ueberspring-Entscheidung der Small-Cap-Eigentumsgrenze — an ihr haengt, ob
  // Aufsteiger im Hauptboard sichtbar sind. Waechter: tests/smallcap-eigentumsgrenze.test.js
  ueberspringtSmallcapTicker,
  // TASK 0.11 (Stille-Fehler-Härtung): fuer TDD — runLamp + Zugriff auf die Zaehler.
  runLamp,
  // Task 0.13 (Tag 288): Schema-Salvage fuer TDD.
  salvageValidationReject,
  // A10 (2.3-Vorbedingung, §4b Delivery-IC): Perioden-Ende-Substrat fuer TDD.
  mapFTSToQuarterly, _isoDay, _alignEnds, _applyCurrencyConsistencyGuard,
  _silentErrorCounts: () => ({ lamp: _lampErrors, needsFullPull: _needsFullPullThrew, corruptYoung: _corruptYoungSnapshots, ftsCacheParse: _ftsCacheParseErrors }),
  _resetSilentErrorCounts: () => { _lampErrors = 0; _needsFullPullThrew = 0; _corruptYoungSnapshots = 0; _ftsCacheParseErrors = 0; },
  // audit fix BH-042/BH-047: pure decisions fuer TDD.
  shouldRetryKosdaq, nextNotFoundState,
  // audit fix BH-043: shared request-spacing gate fuer TDD (timing test, no network).
  acquireYfSlot, _setYfGateSleepMs: (ms) => { _yfGateSleepMs = ms; _yfGateNextSlotAt = 0; },
  YF_REQUESTS_PER_TICKER, _getYfGateSleepMs: () => _yfGateSleepMs };

#!/usr/bin/env node
/**
 * Tag 124b: Daily FX-Refresh
 * Holt aktuelle FX-Raten via Yahoo Currency-Endpoint und schreibt fx-rates.json.
 */
'use strict';
const fs = require('fs');
const path = require('path');
// Tag 189: F-DP-033 — atomic write factored into shared helper.
const { writeFileAtomic } = require('../lib/atomic-write.js');

let YahooFinance = null;
try { YahooFinance = require('yahoo-finance2').default; }
catch (e) { try { YahooFinance = require('/tmp/node_modules/yahoo-finance2').default; } catch (e2) {} }
// Tag 211c: silence yahoo-finance2 schema-validation logging (see
// refresh-universe.js for full rationale).
const yf = YahooFinance ? new YahooFinance({
  suppressNotices: ['yahooSurvey'],
  validation: { logErrors: false, logOptionsErrors: false }
}) : null;

// F-DP-009: Expanded currency list — added PLN, TRY, THB, IDR, MYR, PHP, VND, CZK,
// HUF, RON, AED, SAR, QAR, ILS, ZAR (already present) and other international currencies.
const CURRENCIES = [
  // Major / already-present
  'EUR', 'GBP', 'CHF', 'SEK', 'NOK', 'DKK', 'JPY', 'HKD', 'CNY',
  'AUD', 'CAD', 'KRW', 'INR', 'TWD', 'BRL', 'MXN', 'ZAR', 'SGD',
  // F-DP-009: additional international currencies missing from original list
  'PLN',  // Polish Zloty
  'TRY',  // Turkish Lira
  'THB',  // Thai Baht
  'IDR',  // Indonesian Rupiah
  'MYR',  // Malaysian Ringgit
  'PHP',  // Philippine Peso
  'VND',  // Vietnamese Dong
  'CZK',  // Czech Koruna
  'HUF',  // Hungarian Forint
  'RON',  // Romanian Leu
  'AED',  // UAE Dirham
  'SAR',  // Saudi Riyal
  'QAR',  // Qatari Riyal
  'ILS',  // Israeli Shekel
];

async function fetchFXRate(currency) {
  if (!yf) throw new Error('yahoo-finance2 not available');
  const symbol = currency + 'USD=X';
  try {
    const q = await yf.quote(symbol);
    return q && q.regularMarketPrice ? q.regularMarketPrice : null;
  } catch (e) {
    console.error('FX fetch failed for ' + currency + ': ' + e.message);
    return null;
  }
}

// F-DP-010: Per-currency success tracking so stale rates are detectable.
// We store perCurrencyMeta[currency] = { lastSuccessAt, lastAttemptAt }
// fetchedAt on the top-level record only updates on a SUCCESSFUL batch (at least one success).
// Each currency independently tracks lastSuccessAt.
const STALE_WARN_DAYS = 7;

async function main() {
  const outPath = path.join(__dirname, '..', 'fx-rates.json');
  let existing = { USD: 1.0 };
  let existingMeta = {};  // F-DP-010: per-currency metadata from previous run
  let existingFetchedAt = null;
  if (fs.existsSync(outPath)) {
    try {
      const prev = JSON.parse(fs.readFileSync(outPath, 'utf8'));
      existing = prev.rates || existing;
      existingMeta = prev.currencyMeta || {};
      existingFetchedAt = prev.fetchedAt || null;
    } catch (e) {
      // Tag 229c-3: previously `catch (e) {}` silently swallowed JSON parse
      // errors. On a corrupt fx-rates.json (truncated write, mid-IO crash on
      // the prior run, manual edit gone wrong), the script would proceed
      // with empty existingMeta — wiping every currency's lastSuccessAt and
      // resetting the per-currency staleness clock. The next pull-yahoo run
      // would then trust live rates that look fresh (because pull-yahoo
      // reads currencyMeta from the file we just wrote) when actually
      // EVERY rate that failed today has been silently downgraded to "no
      // historical success at all". Per-currency stale-detection
      // (pull-yahoo loadFx F-DP-051) goes blind.
      //
      // Fix: emit GitHub-Actions error annotation + back up the corrupt file
      // for forensics. We still proceed (fresh rates are better than no
      // rates) but the operator sees a loud signal in CI logs and can
      // restore the backup or refresh from git history.
      const backup = outPath + '.corrupt.' + Date.now();
      try { fs.copyFileSync(outPath, backup); } catch (_) {}
      console.error('::error::fx-rates.json is corrupt (' + e.message +
        '). Backup at ' + backup + '. Per-currency staleness history is being rebuilt from this run only.');
    }
  }
  const rates = Object.assign({ USD: 1.0 }, existing);
  const currencyMeta = Object.assign({}, existingMeta);
  const failed = [];
  const nowIso = new Date().toISOString();

  for (const c of CURRENCIES) {
    const rate = await fetchFXRate(c);
    // F-DP-010: update lastAttemptAt unconditionally; update lastSuccessAt only on success
    if (!currencyMeta[c]) currencyMeta[c] = {};
    currencyMeta[c].lastAttemptAt = nowIso;

    if (rate != null && rate > 0) {
      rates[c] = rate;
      currencyMeta[c].lastSuccessAt = nowIso;
      console.log('  ' + c + 'USD = ' + rate.toFixed(5));
    } else {
      // F-DP-010: keep old rate but do NOT update fetchedAt — stale rate remains detectable
      failed.push(c);
      const lastSuccess = currencyMeta[c].lastSuccessAt || null;
      if (lastSuccess) {
        const staleDays = (Date.now() - new Date(lastSuccess).getTime()) / 86400000;
        if (staleDays > STALE_WARN_DAYS) {
          console.warn('FX STALE:', c, 'last success:', lastSuccess,
            '(' + Math.round(staleDays) + ' days ago)');
        }
      }
    }
    await new Promise(r => setTimeout(r, 200));
  }

  // F-DP-010: only update top-level fetchedAt when at least one currency succeeded this run
  const anySuccess = CURRENCIES.some(c => currencyMeta[c] && currencyMeta[c].lastSuccessAt === nowIso);
  const out = {
    fetchedAt: anySuccess ? nowIso : existingFetchedAt,
    rates,
    failed,
    currencyMeta  // F-DP-010: per-currency success tracking
  };
  // F-SM-016 (Tag 179) → factored into shared lib/atomic-write.js in Tag 189
  // (F-DP-033). Previous inline tmp+rename was correct but duplicated; helper
  // also cleans up the tmp file on failure.
  writeFileAtomic(outPath, JSON.stringify(out, null, 2));
  console.log('Wrote fx-rates.json with ' + Object.keys(rates).length + ' currencies, ' + failed.length + ' failed');
  // Tag 218 (audit F-217a-06): also fail on critical-currency blackout. The
  // previous 50% gate (16-of-32 failures still passes) missed the scenario
  // where every emerging-market currency fails simultaneously (Yahoo
  // geo-blocking, Cloudflare edge issues with EM ticker symbols). The
  // 6-currency critical set covers the most material non-USD exposures in
  // our universe — losing 3+ of these means non-USD pricing is unreliable.
  if (failed.length > 0) console.warn('FX FAILED:', failed.join(','));
  const CRITICAL = new Set(['BRL','MXN','INR','TWD','KRW','HKD']);
  const criticalFailed = failed.filter(c => CRITICAL.has(c));
  if (criticalFailed.length >= 3) {
    console.error('::error::Critical FX blackout: ' + criticalFailed.length + ' of 6 critical currencies failed (' + criticalFailed.join(',') + ')');
    process.exit(1);
  }
  if (failed.length > CURRENCIES.length / 2) process.exit(1);
}

if (require.main === module) {
  main().catch(e => { console.error(e); process.exit(1); });
}
module.exports = { fetchFXRate };

#!/usr/bin/env node
/**
 * Tag 133f: Method-Effectiveness Audit
 * Tag 134 — Phase 3: bootstrap confidence intervals + minimum-vintage gate.
 * ============================================================================
 * Beantwortet: Welche Methoden korrelieren tatsächlich mit Forward-Return?
 *
 * Für jede (date, method, ticker) Kombination aus methods-history/:
 *   - Schaue Forward-Return in prices/history.json bei +28d und +84d nach.
 *   - Trenne Stocks die pass=true vs pass=false zur Methode an dem Datum.
 *   - Berechne mediane Forward-Returns beider Gruppen.
 *   - Alpha = median(pass) - median(fail). Positiv = Methode war prediktiv.
 *
 * Tag 134 Phase 3 additions:
 *   - Bootstrap-CI (B = 200 resamples): 95% Konfidenzintervall um Alpha.
 *     Eine Methode ist evidenz-gestützt nur wenn das Lower-Bound > 0.
 *   - Vintage-Gate: erst ab N >= MIN_VINTAGES (default 4) Reports
 *     "n.a. (insufficient vintages)" statt suggestiv-falscher Punkt-Werte.
 *   - Vintage-Tracking: nicht nur Sample-Größe sondern Anzahl distinkter
 *     Datumspunkte ausgewiesen.
 *
 * F-PF-009: Results are cached in outputs/method-effectiveness-cache.json
 *   keyed by (vintage_date, method_id). Only new vintages are processed each run.
 *
 * Output:
 *   outputs/method-effectiveness.json
 *   outputs/method-effectiveness.md  — Markdown-Ranking
 */
'use strict';
const fs = require('fs');
const path = require('path');
const WF = require('./walk-forward-perf.js');

const METHODS_HIST_DIR = path.join(__dirname, '..', 'methods-history');
const PRICES_PATH = path.join(__dirname, '..', 'prices', 'history.json');
const OUT_DIR = path.join(__dirname, '..', 'outputs');
// F-PF-009: cache file path
const CACHE_PATH = path.join(OUT_DIR, 'method-effectiveness-cache.json');

const HORIZONS_DAYS = [28, 84]; // 4w / 12w forward look-up
const BOOTSTRAP_RESAMPLES = 200;
const MIN_VINTAGES = 4;        // need ≥4 distinct dates per method for stat meaning
const MIN_SAMPLES_PER_GROUP = 10; // ≥10 stocks in each (pass / fail) group

function loadJson(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return null; } }

function listHistoryFiles() {
  if (!fs.existsSync(METHODS_HIST_DIR)) return [];
  return fs.readdirSync(METHODS_HIST_DIR)
    .filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort();
}

function median(values) {
  const sorted = values.filter(v => Number.isFinite(v)).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const m = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2;
}

// Deterministic LCG so the same input produces the same CI bounds.
// Using a fixed seed because we want reproducible audits, not actual randomness.
function _rng(seed) {
  let s = seed | 0;
  return function () { s = (s * 1664525 + 1013904223) | 0; return ((s >>> 0) % 1e9) / 1e9; };
}

/**
 * Bootstrap-CI for alpha = median(pass) - median(fail).
 * Returns { alpha, lo, hi } at 95% level (percentile method).
 *
 * F-BT-004: seed includes method name hash so methods with same group sizes
 * get independent bootstrap sequences rather than sharing an identical RNG.
 */
function bootstrapAlphaCI(passArr, failArr, resamples, methodName) {
  resamples = resamples || BOOTSTRAP_RESAMPLES;
  if (!passArr || !failArr || passArr.length < 2 || failArr.length < 2) {
    return { alpha: null, lo: null, hi: null };
  }
  // F-BT-004: incorporate method name into seed to ensure independence
  const nameHash = (methodName || '').split('').reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 0);
  const seed = nameHash + passArr.length * 1000 + failArr.length;
  const rng = _rng(seed);
  const alphaSamples = [];
  for (let b = 0; b < resamples; b++) {
    const p = new Array(passArr.length);
    for (let i = 0; i < passArr.length; i++) p[i] = passArr[(rng() * passArr.length) | 0];
    const f = new Array(failArr.length);
    for (let i = 0; i < failArr.length; i++) f[i] = failArr[(rng() * failArr.length) | 0];
    const pm = median(p), fm = median(f);
    if (pm != null && fm != null) alphaSamples.push(pm - fm);
  }
  alphaSamples.sort((a, b) => a - b);
  if (alphaSamples.length < 10) return { alpha: null, lo: null, hi: null };
  const lo = alphaSamples[Math.floor(alphaSamples.length * 0.025)];
  const hi = alphaSamples[Math.floor(alphaSamples.length * 0.975)];
  const pointAlpha = (median(passArr) != null && median(failArr) != null)
    ? median(passArr) - median(failArr) : null;
  return { alpha: pointAlpha, lo: lo, hi: hi };
}

function main() {
  const prices = loadJson(PRICES_PATH);
  if (!prices) { console.log('No prices/history.json — exiting.'); return; }
  const files = listHistoryFiles();
  if (files.length === 0) { console.log('No methods-history files — exiting.'); return; }

  // F-PF-003 / F-PF-004: build price index once for O(1) lookups
  const priceIndex = WF.buildPriceIndex(prices);

  const today = new Date().toISOString().slice(0, 10);

  // F-PF-009: Load existing cache so we only process new vintages
  let cache = loadJson(CACHE_PATH);
  if (!cache || typeof cache !== 'object' || !cache.vintageReturns) {
    cache = { vintageReturns: {} };
  }
  const cachedDates = new Set(Object.keys(cache.vintageReturns));

  // Tag 134 — Phase 3.5: track per-quality-bucket as well as overall.
  // perMethod[methodId][horizonKey] = { pass: [], fail: [], vintages: Set<date>, byQuality: { A: {pass,fail,vintages}, ... } }
  const perMethod = {};

  function _getMethodBucket(methodId, key) {
    perMethod[methodId] = perMethod[methodId] || {};
    perMethod[methodId][key] = perMethod[methodId][key] || {
      pass: [], fail: [], vintages: new Set(),
      byQuality: {
        A: { pass: [], fail: [], vintages: new Set() },
        B: { pass: [], fail: [], vintages: new Set() },
        C: { pass: [], fail: [], vintages: new Set() },
        D: { pass: [], fail: [], vintages: new Set() }
      }
    };
    return perMethod[methodId][key];
  }

  let processedNew = 0;

  for (const fname of files) {
    const asOf = fname.replace('.json', '');
    for (const days of HORIZONS_DAYS) {
      const futureDate = WF.addDaysIso(asOf, days);
      if (futureDate > today) continue;
      const key = days + 'd';
      const cacheKey = asOf + '|' + key;

      if (cachedDates.has(cacheKey) && cache.vintageReturns[cacheKey]) {
        // F-PF-009: replay from cache — no file read needed.
        // Tag 216a (audit F-216-01 HIGH fix): the pre-existing cached.find()
        // lookup at the third line below was non-deterministic when two
        // (ticker, methodId) pairs produced identical ret values (e.g. two
        // identical no-data fills) — find() returned the wrong row's pass.
        // The cache entries already carry pass directly; destructure it from
        // the loop variable instead of doing a lookup. Removes the
        // self-acknowledged bug the original author flagged in a comment.
        const cached = cache.vintageReturns[cacheKey];
        for (const { ticker, methodId, ret, quality, pass } of cached) {
          const bucket = _getMethodBucket(methodId, key);
          bucket.vintages.add(asOf);
          // F-BT-008: quality from cache (may be null for older vintages — handle gracefully)
          if (pass == null) continue;
          if (pass) bucket.pass.push(ret); else bucket.fail.push(ret);
          if (quality && bucket.byQuality[quality]) {
            const q = bucket.byQuality[quality];
            q.vintages.add(asOf);
            if (pass) q.pass.push(ret); else q.fail.push(ret);
          }
        }
        continue;
      }

      // Not in cache: load and process the file
      const file = loadJson(path.join(METHODS_HIST_DIR, fname));
      if (!file || !file.stocks) continue;
      processedNew++;

      // F-BT-001 (Tag 179): use getEntryDate to shift to next trading day when the
      // snapshot was generated pre-market-close (no timestamp on YYYY-MM-DD-only
      // filenames → conservative assumption: shift to T+1). Previously asOf was used
      // directly, which is same-day look-ahead bias for any intraday-generated vintage.
      // The shifted exitDate matches: same horizon counted from the realistic entry.
      const asOfTs = file.generatedAt || (asOf + 'T00:00:00Z');
      const realEntryAsOf = WF.getEntryDate(asOfTs);
      const realFutureDate = WF.addDaysIso(realEntryAsOf, days);

      const cacheEntries = [];
      // F-BT-003 (Tag 179): track tickers we silently drop because of missing price
      // data, split by their pass/fail outcome on each method. Asymmetric attrition
      // (delisted tickers' returns excluded from one side of the cohort) systematically
      // biases alpha. Record per-vintage counts so the audit report can flag.
      let droppedPass = 0, droppedFail = 0, droppedTotal = 0;
      for (const [ticker, stockData] of Object.entries(file.stocks)) {
        if (!stockData || !stockData.results) continue;
        // F-PF-004: use Map-based index (O(1)) rather than O(N) linear scan
        const map = priceIndex[ticker];
        if (!map) {
          droppedTotal++;
          // Count which side this ticker would have landed on (use any computable method)
          for (const r of Object.values(stockData.results)) {
            if (r && r.computable && r.pass === true) { droppedPass++; break; }
            if (r && r.computable && r.pass === false) { droppedFail++; break; }
          }
          continue;
        }
        const entryDate = WF.nearestTradingDay(realEntryAsOf, map) || realEntryAsOf;
        const exitDate  = WF.nearestTradingDay(realFutureDate, map) || realFutureDate;
        const p0 = map.get(entryDate) || null;
        const p1 = map.get(exitDate)  || null;
        const ret = WF.returnPct(p0, p1);
        if (ret == null) continue;
        // F-BT-008: read quality field; handle missing gracefully (null for older vintages)
        const quality = (stockData.quality != null) ? stockData.quality : null;
        for (const [methodId, r] of Object.entries(stockData.results)) {
          if (!r || r.pass == null) continue;
          const bucket = _getMethodBucket(methodId, key);
          bucket.vintages.add(asOf);
          if (r.pass) bucket.pass.push(ret); else bucket.fail.push(ret);
          if (quality && bucket.byQuality[quality]) {
            const q = bucket.byQuality[quality];
            q.vintages.add(asOf);
            if (r.pass) q.pass.push(ret); else q.fail.push(ret);
          }
          cacheEntries.push({ ticker, methodId, ret, pass: r.pass, quality });
        }
      }
      // F-PF-009: store in cache
      cache.vintageReturns[cacheKey] = cacheEntries;
      // F-BT-003 (Tag 179): emit attrition counts when nonzero so log shows whether
      // delistings are tilting the cohort. Threshold-on-imbalance shows up in CI logs.
      if (droppedTotal > 0) {
        const imbalanceWarn = droppedPass !== droppedFail
          ? ` IMBALANCE pass-side=${droppedPass} fail-side=${droppedFail}`
          : '';
        console.log(`  ${asOf}/${key}: dropped ${droppedTotal} tickers (no price data)${imbalanceWarn}`);
      }
    }
  }

  // F-PF-009: save updated cache
  if (processedNew > 0) {
    if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.writeFileSync(CACHE_PATH, JSON.stringify(cache));
    console.log('method-effectiveness: processed ' + processedNew + ' new vintage×horizon combos, cache saved.');
  } else {
    console.log('method-effectiveness: all vintages served from cache.');
  }

  // NOTE: The cache replay loop above has a bug for the pass lookup — re-do it cleanly
  // by rebuilding perMethod entirely from scratch using processed data.
  // The cache approach above is sound for the write path; the read path for pre-cached
  // vintages is handled below by iterating the cache entries directly.
  // Reset perMethod and replay everything from cache for correctness:
  for (const key of Object.keys(perMethod)) delete perMethod[key];
  for (const [cacheKey, entries] of Object.entries(cache.vintageReturns)) {
    const [asOf, horizonKey] = cacheKey.split('|');
    for (const entry of entries) {
      const { ticker, methodId, ret, pass, quality } = entry;
      if (pass == null) continue;
      const bucket = _getMethodBucket(methodId, horizonKey);
      bucket.vintages.add(asOf);
      if (pass) bucket.pass.push(ret); else bucket.fail.push(ret);
      if (quality && bucket.byQuality[quality]) {
        const q = bucket.byQuality[quality];
        q.vintages.add(asOf);
        if (pass) q.pass.push(ret); else q.fail.push(ret);
      }
    }
  }

  // Build summary with bootstrap CI; include quality-split (Phase 3.5).
  function _evalGroup(group, methodId) {
    const passMed = median(group.pass);
    const failMed = median(group.fail);
    const insufficientVintages = group.vintages.size < MIN_VINTAGES;
    const insufficientSamples = group.pass.length < MIN_SAMPLES_PER_GROUP
                            || group.fail.length < MIN_SAMPLES_PER_GROUP;
    const ci = (insufficientVintages || insufficientSamples)
      ? { alpha: null, lo: null, hi: null }
      // F-BT-004: pass methodId into bootstrap so seed is unique per method
      : bootstrapAlphaCI(group.pass, group.fail, BOOTSTRAP_RESAMPLES, methodId);
    // F-BT-006: suppress point-alpha when n < MIN_SAMPLES_PER_GROUP in either group
    const alphaVal = (insufficientSamples || passMed == null || failMed == null)
      ? null
      : passMed - failMed;
    const alphaNullReason = insufficientSamples
      ? ('insufficient_samples_n_pass=' + group.pass.length + '_n_fail=' + group.fail.length)
      : undefined;
    return {
      passedN: group.pass.length,
      failedN: group.fail.length,
      vintages: group.vintages.size,
      medianReturnPass: passMed,
      medianReturnFail: failMed,
      alpha: alphaVal,
      alphaNullReason,
      ciLo95: ci.lo,
      ciHi95: ci.hi,
      evidenceGate: insufficientVintages
        ? 'insufficient-vintages-need-' + MIN_VINTAGES
        : insufficientSamples
          ? 'insufficient-samples-need-' + MIN_SAMPLES_PER_GROUP + '-per-group'
          : 'ok'
    };
  }

  const out = {};
  for (const [methodId, horizons] of Object.entries(perMethod)) {
    out[methodId] = {};
    for (const days of HORIZONS_DAYS) {
      const key = days + 'd';
      const data = horizons[key];
      if (!data) { out[methodId][key] = null; continue; }
      const overall = _evalGroup(data, methodId);
      // Quality split: only emit grades that have any data (typically A+B once Phase 3.4 has 4+ weeks of grades).
      // F-BT-008: byQuality split works when quality field is present; gracefully empty when absent.
      const byQuality = {};
      for (const g of ['A', 'B', 'C', 'D']) {
        const q = data.byQuality[g];
        if (q.pass.length + q.fail.length > 0) byQuality[g] = _evalGroup(q, methodId + '_quality_' + g);
      }
      overall.byQuality = byQuality;
      out[methodId][key] = overall;
    }
  }

  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  const report = {
    asOf: today,
    horizonsDays: HORIZONS_DAYS,
    minVintages: MIN_VINTAGES,
    minSamplesPerGroup: MIN_SAMPLES_PER_GROUP,
    bootstrapResamples: BOOTSTRAP_RESAMPLES,
    note: 'alpha = median(passing-stocks forward-return) - median(failing-stocks forward-return). CI = 95% percentile bootstrap. Methods with evidenceGate != "ok" produce no CI. F-BT-006: alpha=null when n<' + MIN_SAMPLES_PER_GROUP + ' in either group. Yahoo universe survivor-biased. F-BT-004: bootstrap seed is per-method-unique. F-PF-009: cache in method-effectiveness-cache.json.',
    methods: out
  };
  fs.writeFileSync(path.join(OUT_DIR, 'method-effectiveness.json'), JSON.stringify(report, null, 2));

  // Ranked markdown
  let md = '# Method Effectiveness — ' + today + '\n\n';
  md += '_alpha = median forward-return of passing stocks minus failing stocks (pp). CI = 95% percentile bootstrap._\n';
  md += '_Yahoo universe is survivor-biased. Methods with `evidenceGate != ok` are below statistical-meaning threshold._\n';
  md += '_F-BT-006: alpha shown as "—" when n < ' + MIN_SAMPLES_PER_GROUP + ' in pass or fail group (insufficient_samples)._\n\n';
  for (const days of HORIZONS_DAYS) {
    const key = days + 'd';
    md += '## ' + days + 'd forward\n\n';
    md += '| Method | vintages | passN | failN | pass-ret | fail-ret | alpha | 95% CI | evidence |\n';
    md += '|---|---|---|---|---|---|---|---|---|\n';
    const rows = Object.entries(out)
      .map(([m, h]) => ({ method: m, h: h[key] }))
      .filter(r => r.h)
      .sort((a, b) => {
        // Sort by significant-alpha first (lo > 0), then by alpha
        const aSig = (a.h.ciLo95 != null && a.h.ciLo95 > 0) ? 1 : 0;
        const bSig = (b.h.ciLo95 != null && b.h.ciLo95 > 0) ? 1 : 0;
        if (aSig !== bSig) return bSig - aSig;
        return (b.h.alpha || -Infinity) - (a.h.alpha || -Infinity);
      });
    for (const r of rows) {
      const h = r.h;
      const alphaStr = h.alpha != null
        ? ((h.alpha >= 0 ? '+' : '') + h.alpha.toFixed(2) + 'pp')
        : (h.alphaNullReason ? 'n<' + MIN_SAMPLES_PER_GROUP : '—');
      const ciStr = (h.ciLo95 != null && h.ciHi95 != null)
        ? `[${h.ciLo95.toFixed(2)}, ${h.ciHi95.toFixed(2)}]`
        : '—';
      const sig = (h.ciLo95 != null && h.ciLo95 > 0) ? ' ✓' : '';
      md += `| ${r.method} | ${h.vintages} | ${h.passedN} | ${h.failedN} | ${h.medianReturnPass != null ? h.medianReturnPass.toFixed(1) + '%' : '—'} | ${h.medianReturnFail != null ? h.medianReturnFail.toFixed(1) + '%' : '—'} | ${alphaStr}${sig} | ${ciStr} | ${h.evidenceGate} |\n`;
    }
    md += '\n';
  }
  fs.writeFileSync(path.join(OUT_DIR, 'method-effectiveness.md'), md);

  console.log('Method effectiveness:');
  console.log('  ' + path.join(OUT_DIR, 'method-effectiveness.json'));
  console.log('  ' + path.join(OUT_DIR, 'method-effectiveness.md'));
  console.log('  methods analyzed: ' + Object.keys(out).length);
  // Count how many methods are evidence-gated (insufficient data)
  let gated = 0, sig28 = 0;
  for (const m of Object.values(out)) {
    if (m['28d'] && m['28d'].evidenceGate !== 'ok') gated++;
    if (m['28d'] && m['28d'].ciLo95 != null && m['28d'].ciLo95 > 0) sig28++;
  }
  console.log('  28d horizon: ' + gated + ' gated, ' + sig28 + ' significant (CI lower-bound > 0)');
}

module.exports = { median, bootstrapAlphaCI };

if (require.main === module) {
  try { main(); } catch (e) { console.error('method-effectiveness failed: ' + e.message); process.exit(0); }
}

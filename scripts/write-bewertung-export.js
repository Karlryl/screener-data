#!/usr/bin/env node
'use strict';

// Additive, display-only valuation feature file (A5 package S2).
// Raw per-ticker ratios from the saved snapshots only: no rank, no percentile, no score, no signal.
// It sits next to filter/universum.json and never touches it.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { writeJsonAtomic } = require('../lib/atomic-write.js');
const { isMetadataSnapshot } = require('../lib/snapshot-fs.js');
const { prepareSnapshot } = require('../lib/yahoo-q4-known-cases.js');
const { loadWatchlist } = require('../lib/watchlist-fs.js');
const { norm, metricVal } = require('../src/scoring/snapshot.js');
const { filterToAuthorizedUniverse } = require('../src/scoring/run-screener.js');
const { beurteileWaehrungsbeleg } = require('./write-findash-export.js');

const ROOT = path.resolve(__dirname, '..');
const SCHEMA = 'findash-export/v1';
const MAX_BYTES = 4_000_000;
const ROW_KEYS = 't ep cp bp nd ndSt gj q4 asOf ohne'.split(' ');
const NUMBER_KEYS = ['ep', 'cp', 'bp', 'nd'];
const VALUE_KEYS = ['ep', 'cp', 'bp', 'nd', 'q4'];
const ND_STATES = ['geprueft', 'nicht-geprueft'];
// A row with `ohne` carries no value at all, only the reason why: the data packet is quarantined, the reporting
// currency looks mislabelled, or listing and reporting currency differ and nothing can cross-check the numerators.
const OHNE = ['datenpaket-gesperrt', 'waehrung-unplausibel', 'waehrung-ungeprueft'];
// Mislabelled-reporting-currency guard (P231 fix round 1; band measured on the 14.10.2026 snapshots, see docs 17.1):
// r = ep x trailing PE / 100 is annual over trailing earnings and normally sits near 1. A statement kept in the
// listing currency but labelled USD inflates ep by the cross rate (HCLTECH.NS r 86.6 vs cross 95.1; PTTEP.BK 29.0
// vs 33.6; 9911.HK 5.85 vs 7.85). Withheld when the cross rate is at least CROSS_MIN, r is above 3 and within
// CROSS_TOL of it, and the vendor PE itself is plausible (implied yield 1.5 to 50 %); a garbage PE (genuine USD
// reporter listed in a weak currency) gives the same r but an implausible yield and is not touched.
const CROSS_MIN = 3, CROSS_TOL = 2.5, R_MIN = 3, YIELD_MIN = 1.5, YIELD_MAX = 50;
// Listing units that are a hundredth of the currency; tradingFxRateApplied is per unit, market cap uses the major unit.
const SUBUNITS = new Set(['GBp', 'GBX', 'GBPENCE', 'ZAc', 'ILA']);
const finite = Number.isFinite;
// ponytail: copy of round() in write-filter-universe.js (not exported there, and that writer stays untouched).
const round = v => {
  if (!finite(v)) return null;
  const rounded = Math.round(v * 100) / 100;
  return rounded === 0 && v !== 0 ? Number(v.toPrecision(2)) : rounded;
};
const text = v => typeof v === 'string' && v.trim() ? v.trim().replace(/\s+/g, ' ') : null;
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const snapshotFiles = dir => fs.readdirSync(dir).filter(f => f.endsWith('.json') && !isMetadataSnapshot(f)).sort();
// A real calendar day (YYYY-MM-DD) taken from a day or a full ISO timestamp; anything else is null.
const day = v => {
  const d = typeof v === 'string' ? v.slice(0, 10) : null;
  if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  const t = Date.parse(d);
  return finite(t) && new Date(t).toISOString().slice(0, 10) === d ? d : null;
};
// An exact zero from a statement is treated like the other placeholder zeros (T2): withheld, never shown as 0 %.
const usable = v => finite(v) && v !== 0;

/**
 * Plausibility verdict against a mislabelled reporting currency, using the vendor's own trailing PE as the only
 * independent number (it is computed from the listing price in one currency).
 * @param {object} snapshot Prepared canonical snapshot.
 * @param {number|null} ep Earnings yield in percent before rounding, or null when there is no usable net income.
 * @param {string|null} listing Listing (trading) currency as labelled.
 * @param {boolean} differs True when listing and reporting currency are not provably the same.
 * @returns {string|null} 'waehrung-unplausibel', 'waehrung-ungeprueft' or null when the ratios may be shown.
 */
function currencyVerdict(snapshot, ep, listing, differs) {
  const pe = metricVal(snapshot, 'pe');
  // Nothing to cross-check against (loss, no trailing PE): with differing currencies an empty field beats a guess.
  if (!(ep > 0 && pe > 0)) return differs ? 'waehrung-ungeprueft' : null;
  const reporting = snapshot.meta.fxRateApplied, trading = snapshot.meta.tradingFxRateApplied;
  if (!(finite(reporting) && reporting > 0 && finite(trading) && trading > 0)) return null;
  const cross = reporting / (trading * (SUBUNITS.has(listing) ? 100 : 1)), r = ep * pe / 100, yld = 100 / pe;
  return cross >= CROSS_MIN && r > R_MIN && r >= cross / CROSS_TOL && r <= cross * CROSS_TOL && yld >= YIELD_MIN && yld <= YIELD_MAX
    ? 'waehrung-unplausibel' : null;
}

/**
 * Compute the display-only ratio row of one prepared snapshot.
 * @param {object} snapshot Prepared canonical snapshot (hand tables and market-cap guard already applied).
 * @returns {object|null} Row with only the present keys; `{t, ohne}` when the values are withheld (quarantined packet or currency
 *   verdict); null when there is nothing to show.
 */
function rowFor(snapshot) {
  const meta = snapshot?.meta || {}, ticker = text(meta.ticker);
  if (!ticker) throw new Error('Snapshot without ticker');
  // A quarantined data packet shows no value at all (same rule as write-excluded-list.js).
  if (meta.financialDataIssue) return { t: ticker, ohne: 'datenpaket-gesperrt' };
  const annual = snapshot.annual || {}, mc = snapshot.marketCap?.value;
  // Market-cap based ratios need the same currency proof as the filter feed; the other figures do not use it.
  const priced = beurteileWaehrungsbeleg(meta).ok && finite(mc) && mc > 0;
  const income = norm(snapshot, 'annualNetIncome')[0], ocf = norm(snapshot, 'annualOCF')[0];
  const listing = text(meta.tradingCurrencyOriginal || meta.tradingCurrency), reporting = text(meta.reportingCurrencyOriginal || meta.reportingCurrency);
  // Equal only when both are known, spelled alike (GBp is not GBP) and the listing currency is not a guess.
  const sameCurrency = listing !== null && listing === reporting && meta.tradingCurrencyAssumed !== true;
  const verdict = priced ? currencyVerdict(snapshot, usable(income) ? income / mc * 100 : null, listing, !sameCurrency) : null;
  const equity = norm(snapshot, 'annualBalance', 'totalEquity')[0];
  const debt = norm(snapshot, 'annualBalance', 'totalDebt')[0], cash = norm(snapshot, 'annualBalance', 'totalCash')[0];
  const end = key => day(annual[key]?.[0]);
  const gj = end('annualNetIncomeEnds'), ocfEnd = end('annualOCFEnds'), balanceEnd = end('annualBalanceEnds');
  // One period label (gj) serves ep, cp and bp, so a statement that provably belongs to another year is withheld.
  const clash = (a, b) => a !== null && b !== null && a !== b;
  const ep = priced && usable(income) ? round(income / mc * 100) : null;
  const cp = priced && usable(ocf) && !clash(gj, ocfEnd) ? round(ocf / mc * 100) : null;
  const bp = priced && usable(equity) && !clash(gj, balanceEnd) ? round(equity / mc * 100) : null;
  // Partial debt rows miss one debt leg (absence counted as zero upstream): net debt would be understated.
  const checked = finite(debt) && finite(cash) && finite(ocf) && ocf > 0
    && annual.annualBalance?.[0]?._debtPartial !== true && !clash(ocfEnd, balanceEnd);
  const nd = checked ? round((debt - cash) / ocf) : null;
  const ndSt = nd !== null ? 'geprueft' : finite(ocf) ? 'nicht-geprueft' : null;
  // earningsHistory is stored oldest first and is NOT FX-converted: its EPS is per share in the reporting currency.
  // Shown only when listing and reporting currency are equal, so the unit is the listing currency (prices/<day>.json
  // `currency`). The window is the four newest dated quarters; an exact zero EPS is a placeholder like the annual
  // zeros and leaves a visible gap (the quarter dates show it) instead of pulling an older quarter in.
  const history = Array.isArray(snapshot.external?.earningsHistory) ? snapshot.external.earningsHistory : [];
  const seen = new Set(), recent = history.map(r => ({ q: day(r?.quarter), eps: r?.epsActual }))
    .filter(r => r.q !== null && !seen.has(r.q) && seen.add(r.q))
    .sort((a, b) => b.q.localeCompare(a.q)).slice(0, 4);
  const quarters = recent.filter(r => usable(r.eps)).map(r => ({ q: r.q, eps: round(r.eps) }));
  const q4 = sameCurrency && quarters.length ? quarters : null;
  // Same oldest-source rule as the universe feed (without the ATH date, which this file does not use).
  const dates = [meta.fundamentalsAsOf || meta.asOf, ...Object.values(snapshot.metrics || {}).map(m => m?.asOf)]
    .filter(d => typeof d === 'string' && finite(Date.parse(d))).sort((a, b) => Date.parse(a) - Date.parse(b));
  const row = Object.fromEntries(Object.entries({
    t: ticker, ep, cp, bp, nd, ndSt, gj, q4,
    asOf: dates.length ? new Date(dates[0]).toISOString().slice(0, 10) : null,
  }).filter(([, value]) => value !== null));
  if (!VALUE_KEYS.some(key => Object.hasOwn(row, key))) return null;
  // The verdict withholds every value; it only matters where there would have been something to show.
  return verdict ? { t: ticker, ohne: verdict } : row;
}

/**
 * Build the v1 envelope for a set of prepared snapshots.
 * @param {object} input Prepared snapshots and the generation (generated_at) copied from the board index.
 * @returns {object} Envelope with rows sorted by ticker; the input is never mutated.
 */
function buildFeed({ snapshots, generatedAt }) {
  if (!text(generatedAt) || !finite(Date.parse(generatedAt))) throw new Error('Invalid generation');
  const rows = snapshots.map(rowFor).filter(Boolean).sort((a, b) => a.t.localeCompare(b.t, 'en'));
  return { schema: SCHEMA, generated_at: generatedAt, snapshotCount: snapshots.length, rows };
}

/**
 * Check the contract of a parsed bewertung file, including the uncompressed size budget.
 * @param {object} feed Parsed filter/bewertung.json.
 * @param {number} bytes Exact UTF-8 file size.
 * @param {string} [generatedAt] generated_at of the board index next to the file; any other generation is a breach.
 * @returns {string[]} Contract breaches; an empty array means valid.
 */
function validate(feed, bytes, generatedAt) {
  const errors = [], seen = new Set();
  if (!Number.isInteger(bytes) || bytes < 1 || bytes > MAX_BYTES) errors.push('Size must be between 1 and ' + MAX_BYTES + ' bytes');
  if (feed?.schema !== SCHEMA || !text(feed?.generated_at) || !finite(Date.parse(feed.generated_at))) errors.push('Invalid envelope');
  if (generatedAt !== undefined && feed?.generated_at !== generatedAt) errors.push('Generation mismatch with the board index');
  if (!Array.isArray(feed?.rows)) return errors.concat('Missing rows');
  if (!Number.isInteger(feed.snapshotCount) || feed.snapshotCount <= 0 || feed.rows.length > feed.snapshotCount) errors.push('Snapshot count mismatch');
  for (const row of feed.rows) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) { errors.push('Invalid row'); continue; }
    const where = text(row.t) || '?';
    if (Object.keys(row).some(k => !ROW_KEYS.includes(k)) || Object.values(row).some(v => v === null || v === undefined)) errors.push(where + ': row shape');
    if (!text(row.t) || seen.has(row.t)) errors.push(where + ': missing/duplicate ticker');
    seen.add(row.t);
    if (Object.hasOwn(row, 'ohne')) {
      if (!OHNE.includes(row.ohne) || Object.keys(row).sort().join() !== 'ohne,t') errors.push(where + ': invalid ohne row');
      continue;
    }
    if (!VALUE_KEYS.some(key => Object.hasOwn(row, key))) errors.push(where + ': row without value');
    for (const key of NUMBER_KEYS) if (Object.hasOwn(row, key) && !finite(row[key])) errors.push(where + ': ' + key + ' not finite');
    if ((row.ndSt !== undefined && !ND_STATES.includes(row.ndSt)) || (row.nd !== undefined) !== (row.ndSt === 'geprueft')) errors.push(where + ': inconsistent ndSt');
    for (const key of ['gj', 'asOf']) if (Object.hasOwn(row, key) && day(row[key]) !== row[key]) errors.push(where + ': invalid ' + key);
    if (Object.hasOwn(row, 'q4')) {
      const q4 = row.q4;
      if (!Array.isArray(q4) || q4.length < 1 || q4.length > 4) { errors.push(where + ': q4 length'); continue; }
      for (let i = 0; i < q4.length; i++) {
        const item = q4[i];
        if (!item || typeof item !== 'object' || Object.keys(item).sort().join() !== 'eps,q' || !finite(item.eps) || item.eps === 0 || day(item.q) !== item.q) errors.push(where + ': invalid q4 item');
        else if (i > 0 && !(q4[i - 1].q > item.q)) errors.push(where + ': q4 not newest first');
      }
    }
  }
  return errors;
}

/**
 * Read one generation of snapshots and atomically write filter/bewertung.json.
 * @param {object} options Snapshot and v1 directories plus the scoring watchlist file.
 * @returns {object} Written feed and its exact byte size.
 */
function build({ snapshotsDir, v1Dir, watchlistFile = path.join(ROOT, 'watchlist.json') }) {
  const index = readJson(path.join(v1Dir, 'index.json'));
  if (index.schema !== SCHEMA || !text(index.generated_at)) throw new Error('Invalid board index');
  // The filter step removes its folder when it fails; this file must not bring the folder back on its own.
  if (!fs.existsSync(path.join(v1Dir, 'filter'))) throw new Error('filter/ folder missing (filter universe step failed); not recreating it');
  const snapshots = snapshotFiles(snapshotsDir).map(file => prepareSnapshot(readJson(path.join(snapshotsDir, file))));
  const watchlist = loadWatchlist(watchlistFile);
  if (watchlist.error) throw new Error('Invalid scoring watchlist: ' + watchlist.error);
  // Same generation guard as the universe feed: the snapshots must be the ones the boards were built from.
  const { filtered } = filterToAuthorizedUniverse(snapshots, watchlist.stocks);
  if (index.generatedFromSnapshots !== filtered.length) throw new Error('Snapshot/board population mismatch');
  const feed = buildFeed({ snapshots, generatedAt: index.generated_at });
  const bytes = Buffer.byteLength(JSON.stringify(feed));
  const errors = validate(feed, bytes);
  if (errors.length) throw new Error(errors.slice(0, 10).join('; ') + ' (measured ' + bytes + ' bytes)');
  const target = path.join(v1Dir, 'filter', 'bewertung.json');
  writeJsonAtomic(target, feed, { indent: 0 });
  return { feed, bytes };
}

/**
 * Offline self-check on one hand snapshot (net income 100, market cap 1000 gives ep 10) and one tampered copy.
 * @returns {void} Throws an assertion error when the arithmetic or the validator is wrong.
 */
function selfTest() {
  const hand = { meta: { ticker: 'HAND', tradingCurrency: 'USD', reportingCurrency: 'USD' }, marketCap: { value: 1000 }, annual: { annualNetIncome: [{ value: 100 }] } };
  const feed = buildFeed({ snapshots: [hand], generatedAt: '2026-10-14T00:00:00Z' });
  assert.equal(feed.rows[0].ep, 10);
  assert.deepEqual(validate(feed, Buffer.byteLength(JSON.stringify(feed))), []);
  feed.rows[0].rank = 1;
  assert.ok(validate(feed, 1000).length);
}

/**
 * Run the offline writer, the read-only validator or the self-test.
 * @param {string[]} argv CLI arguments.
 * @returns {number} Zero on success, one on a source or contract error.
 */
function main(argv) {
  try {
    const options = { snapshotsDir: process.env.FINDASH_SNAPSHOTS_DIR || path.join(ROOT, 'snapshots'), v1Dir: path.join(ROOT, 'outputs', 'findash-export', 'v1') };
    const names = { '--snapshots': 'snapshotsDir', '--v1-dir': 'v1Dir', '--watchlist': 'watchlistFile' };
    let check = false, self = false;
    for (let i = 0; i < argv.length; i++) {
      if (argv[i] === '--check') check = true;
      else if (argv[i] === '--selftest') self = true;
      else if (names[argv[i]] && argv[i + 1] && !argv[i + 1].startsWith('--')) options[names[argv[i]]] = path.resolve(argv[++i]);
      else throw new Error('Unknown/incomplete argument ' + argv[i]);
    }
    if (self) { selfTest(); console.log('[bewertung] selftest OK'); }
    else if (check) {
      const bytes = fs.readFileSync(path.join(options.v1Dir, 'filter', 'bewertung.json'));
      const errors = validate(JSON.parse(bytes.toString('utf8')), bytes.length, readJson(path.join(options.v1Dir, 'index.json')).generated_at);
      if (errors.length) throw new Error(errors.slice(0, 10).join('; '));
      console.log('[bewertung] check OK (' + bytes.length + ' bytes)');
    } else {
      const result = build(options);
      console.log('[bewertung] ' + result.feed.rows.length + ' rows of ' + result.feed.snapshotCount + ' snapshots, ' + result.bytes + ' bytes');
    }
    return 0;
  } catch (error) { console.error('[bewertung] ' + error.message); return 1; }
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));
module.exports = { rowFor, buildFeed, validate, build, selfTest, main, ROW_KEYS, MAX_BYTES };

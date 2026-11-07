'use strict';
// P1 (Codex, 04.11.2026): a firm with two or more listed share classes (A and H, A and B) was shown with
// Yahoo's value of one line, which prices every share of every class at that line's price (3.9 to 25.1 %
// too high on 31.10.), or with a hand-table row that froze the price ratio of 30.10. into "H equivalents".
// The class sum values each class with its own issuer-verified share count and its own close of ONE common
// trading day from the run's price store, converted with the run's FX rates, and writes that one firm value
// into every class line the pull left unheld. It runs in the merge job after the price merge, on the merged
// snapshot generation, before the snapshots artifact goes to scoring and exports.
const fs = require('node:fs');
const path = require('node:path');
const { DERIVED_FIELDS } = require('./ads-hand-table.js');
const { holds } = require('./market-cap-guard.js');
const store = require('./price-history-store.js');
const { safeSnapshotFilename } = require('./snapshot-fs.js');
const { writeJsonAtomic } = require('./atomic-write.js');

const SOURCE = 'class-sum';
const HOLD = 'hand-table:market-cap-hold';
// ponytail: fixed lag; a common close older than this (long suspension of one class) empties the value instead.
const MAX_CLOSE_AGE_DAYS = 10;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const positive = (n) => Number.isFinite(n) && n > 0;
const ageDays = (from, to) => Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 864e5);
const de = (d) => `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}`;
const mio = (n) => (n / 1e6).toLocaleString('de-DE', { maximumFractionDigits: 1 });

const CONFIG = path.join(__dirname, '..', 'configs', 'mcap-class-sum.json');

/**
 * Loads the issuers whose market cap is the class sum; a malformed entry throws with its name.
 * @param {string} [file] Config path (default configs/mcap-class-sum.json).
 * @returns {object[]} Entries {name, issuer, classes:[{ticker, class, shares}], sharesAsOf, verifiedAt, reviewBy, sources}.
 */
function loadClassSumEntries(file = CONFIG) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const out = [], seen = new Set();
  for (const [name, e] of Object.entries(raw)) {
    if (name.startsWith('_')) continue;
    const bad = (why) => { throw new Error(`${file}: ${name}: ${why}`); };
    if (!e || typeof e !== 'object' || !e.issuer) bad('issuer missing');
    for (const k of ['sharesAsOf', 'verifiedAt', 'reviewBy']) if (!DAY.test(e[k] || '')) bad(`${k} must be YYYY-MM-DD`);
    if (!Array.isArray(e.classes) || e.classes.length < 2) bad('at least two listed classes');
    for (const l of e.classes) {
      if (!l || !/^[A-Z0-9][A-Z0-9./-]*$/.test(l.ticker || '') || !l.class || !Number.isSafeInteger(l.shares) || l.shares <= 0) bad('class needs ticker, class and a positive integer share count');
      if (!/^[A-Z]{3}$/.test(l.currency || '')) bad(`${l.ticker}: currency must be a three-letter code`);
      if (l.asOf !== undefined && !(DAY.test(l.asOf) && l.asOf >= e.sharesAsOf)) bad(`${l.ticker}: asOf must be a day not before sharesAsOf`);
      if (seen.has(l.ticker)) bad(`ticker ${l.ticker} twice`);
      seen.add(l.ticker);
    }
    if (!Array.isArray(e.sources) || !e.sources.length || e.sources.some((s) => !/^https?:\/\//.test(s?.url || '') || !s.quote)) bad('every source needs url and quote');
    out.push({ name, ...e });
  }
  if (!out.length) throw new Error(`${file}: no issuer`);
  return out;
}

/**
 * Class sum of one issuer on the newest trading day on which every class has a close.
 * @param {object} entry Class-sum config entry.
 * @param {Object<string, Array<{date: string, close: number}>>} closes Price-store series by ticker.
 * @param {Object<string, string|null>} currencies Trading currency per class ticker from its snapshot, a cross-check only (missing is fine).
 * @param {Object<string, number>} fx USD per unit, from fx-rates.json of the same run.
 * @param {string} dataDay Run date YYYY-MM-DD; closes after it are ignored.
 * @returns {{value: number|null, date: string|null, legs: object[], reason: string|null}} Firm value in USD or the reason it is empty.
 */
function computeClassSum(entry, closes, currencies, fx, dataDay) {
  const problems = [];
  const series = entry.classes.map(({ ticker }) => new Map((closes[ticker] || [])
    .filter((p) => p && DAY.test(p.date) && p.date <= dataDay && positive(p.close)).map((p) => [p.date, p.close])));
  entry.classes.forEach(({ ticker }, i) => { if (!series[i].size) problems.push(`${ticker}: keine Schlusskurse im Kursspeicher`); });
  const common = problems.length ? [] : [...series[0].keys()].filter((d) => series.every((s) => s.has(d))).sort();
  const date = common.length ? common[common.length - 1] : null;
  if (!problems.length && !date) problems.push('kein gemeinsamer Handelstag aller Klassen im Kursspeicher');
  if (date && ageDays(date, dataDay) > MAX_CLOSE_AGE_DAYS) problems.push(`letzter gemeinsamer Handelstag ${de(date)} liegt mehr als ${MAX_CLOSE_AGE_DAYS} Tage zurück`);
  const legs = entry.classes.map(({ ticker, class: cls }, i) => {
    const currency = entry.classes[i].currency;
    const usdPerUnit = positive(fx[currency]) ? fx[currency] : null;
    if (currencies[ticker] && currencies[ticker] !== currency) problems.push(`${ticker}: Snapshot nennt ${currencies[ticker]} statt ${currency}`);
    if (usdPerUnit === null) problems.push(`${ticker}: kein Devisenkurs für ${currency}`);
    const close = date ? series[i].get(date) : null;
    const shares = entry.classes[i].shares;
    return { ticker, class: cls, shares, close, currency, usdPerUnit,
      valueUsd: positive(close) && usdPerUnit !== null ? shares * close * usdPerUnit : null };
  });
  const value = legs.reduce((sum, l) => sum + (l.valueUsd ?? 0), 0);
  if (!problems.length && !positive(value)) problems.push('Klassensumme nicht positiv');
  return { value: problems.length ? null : value, date, legs, reason: problems.length ? problems.join('; ') : null };
}

const lastAsOf = (entry) => entry.classes.reduce((d, l) => (l.asOf && l.asOf > d ? l.asOf : d), entry.sharesAsOf);

/** German hint for the board: what the value is and from which day and counts.
 * @param {object} entry Class-sum config entry.
 * @param {object} result computeClassSum result.
 * @returns {string} Sentence for meta.marketCapReason.
 */
function reasonText(entry, result) {
  if (result.value === null) return `Börsenwert nicht verlässlich: Die Summe der Aktienklassen (${entry.classes.map((l) => l.class).join(', ')}) ist heute nicht berechenbar (${result.reason}).`;
  const parts = result.legs.map((l) => `${mio(l.shares)} Mio. ${l.class}-Aktien zu ${l.close.toLocaleString('de-DE', { maximumFractionDigits: 3 })} ${l.currency}`);
  return `Börsenwert als Summe der Aktienklassen, jede zu ihrem eigenen Schlusskurs vom ${de(result.date)}: ${parts.join(' plus ')} ` +
    `(Aktienzahlen laut Firma vom ${de(entry.sharesAsOf)}${lastAsOf(entry) > entry.sharesAsOf ? ' bis ' + de(lastAsOf(entry)) : ''}).`;
}

const priorValue = (s) => s.marketCap?.source === SOURCE ? s.marketCap.yahooValue ?? null : s.marketCap?.value ?? null;
function stamp(snap, value, reason, result, fxFetchedAt) {
  const prev = snap.marketCap || {};
  snap.marketCap = { ...prev, value, source: SOURCE, yahooValue: priorValue(snap),
    classSum: { date: result.date, fxFetchedAt, legs: result.legs, reason: result.reason } };
  if (value === null) snap.marketCap.missing = true; else delete snap.marketCap.missing;
  delete snap.marketCap.vendorImpliedShares;
  snap.meta.marketCapReason = reason;
  delete snap.meta._shareCountHandTableStale;
  if (snap.metrics) for (const f of DERIVED_FIELDS) if (snap.metrics[f] != null) snap.metrics[f] = null;
}

/**
 * Puts one firm's class sum into its class snapshots, in place, without changing which line the board shows.
 * The sum goes into the line the scoring's own listing choice (issuerDedupComparator) picks on the pull's values; every
 * other unheld line is emptied with a reason naming that line, so no line with a one-price value can take the board on a
 * day the scoring excludes the line with the sum. Without a sum every unheld line is emptied with the reason.
 * Held lines and missing snapshots are left alone.
 * @param {Object<string, object|null>} snaps Class snapshots by ticker.
 * @param {object} entry Class-sum config entry.
 * @param {object} result computeClassSum result.
 * @param {string|null} fxFetchedAt Stamp of the FX file used.
 * @returns {{shown: string|null, written: string[]}} The line that carries the sum and every changed ticker.
 */
function writeFirm(snaps, entry, result, fxFetchedAt) {
  const { issuerDedupComparator } = require('../src/scoring/score.js');
  const open = Object.values(snaps).filter((s) => s?.meta?.ticker && !holds[s.meta.ticker] && s.marketCap?.source !== HOLD);
  const priced = open.filter((s) => positive(priorValue(s)))
    .map((s) => ({ ticker: s.meta.ticker, s, snapshot: { ...s, marketCap: { ...s.marketCap, value: priorValue(s) } } }))
    .sort(issuerDedupComparator);
  // ponytail: no line with a pull value at all -> every unheld line carries the sum and the ticker order decides.
  const targets = priced.length ? [priced[0].s] : open;
  const text = reasonText(entry, result), written = [];
  for (const s of open) {
    if (targets.includes(s) || result.value === null) stamp(s, result.value, text, result, fxFetchedAt);
    else stamp(s, null, `Börsenwert nicht verlässlich: Der Börsenwert der Firma steht an der Zeile ${targets[0].meta.ticker}. ${text}`, result, fxFetchedAt);
    written.push(s.meta.ticker);
  }
  return { shown: result.value === null ? null : targets.length === 1 ? targets[0].meta.ticker : null, written };
}

/**
 * Writes the class sum into the snapshots of one merged generation, in place on disk.
 * Held lines keep their hold; a missing class snapshot only means that line gets no value (the sum needs only the closes).
 * @param {{snapshotsDir: string, pricesDir: string, fxFile: string, dataDay: string, configFile?: string, log?: Function}} opts Paths and run date.
 * @returns {object[]} One line per issuer: name, value or reason, written tickers.
 */
function applyClassSums({ snapshotsDir, pricesDir, fxFile, dataDay, configFile, log = console.log }) {
  if (!DAY.test(dataDay || '')) throw new Error('applyClassSums: dataDay must be YYYY-MM-DD');
  const fxDoc = JSON.parse(fs.readFileSync(fxFile, 'utf8'));
  const fx = fxDoc.rates;
  if (!fx || typeof fx !== 'object') throw new Error(`${fxFile}: rates missing`);
  const entries = loadClassSumEntries(configFile);
  const tickers = entries.flatMap((e) => e.classes.map((l) => l.ticker));
  const history = store.loadAll(pricesDir);
  const closes = Object.fromEntries(tickers.map((t) => [t, history[t] || []]));
  const file = (t) => path.join(snapshotsDir, safeSnapshotFilename(t));
  const report = [];
  for (const entry of entries) {
    const snaps = Object.fromEntries(entry.classes.map(({ ticker }) => {
      try { return [ticker, JSON.parse(fs.readFileSync(file(ticker), 'utf8'))]; } catch (e) { if (e.code === 'ENOENT') return [ticker, null]; throw e; }
    }));
    const currencies = Object.fromEntries(Object.entries(snaps).map(([t, s]) => [t, s?.meta?.tradingCurrencyOriginal || s?.meta?.tradingCurrency || null]));
    const result = computeClassSum(entry, closes, currencies, fx, dataDay);
    if (dataDay > entry.reviewBy) log(`::warning::${entry.issuer}: Aktienzahlen der Klassensumme vom ${entry.sharesAsOf}, reviewBy ${entry.reviewBy} überschritten; Wert wird weiter gerechnet, Zahlen neu belegen.`);
    if (result.value === null) log(`::warning::${entry.issuer}: Klassensumme leer: ${result.reason}`);
    const { shown, written } = writeFirm(snaps, entry, result, fxDoc.fetchedAt ?? null);
    for (const ticker of written) writeJsonAtomic(file(ticker), snaps[ticker], { indent: 0 });
    report.push({ issuer: entry.issuer, value: result.value, date: result.date, reason: result.reason, shown, written });
  }
  return report;
}

module.exports = { loadClassSumEntries, computeClassSum, reasonText, writeFirm, applyClassSums, SOURCE, MAX_CLOSE_AGE_DAYS };

'use strict';
/** Read-only NSE/Yahoo comparison. Never attaches data to a vendor snapshot.
 * Usage: node scripts/nse-shadow-report.js --snapshots=<dir> --as-of=2026-11-11
 *        [--store=...] [--watchlist=...] [--cohort=...] [--json=<new-file>]
 */
const fs = require('node:fs');
const path = require('node:path');
const N = require('../lib/nse-quarters');
const { quarterEndsBefore } = require('../lib/exchange-quarter-store');
const { loadWatchlist } = require('../lib/watchlist-fs');
const { safeSnapshotFilename } = require('../lib/snapshot-fs');
const { loadStore, DEFAULT_OUT } = require('./fetch-nse-quarters');
const ROOT = path.resolve(__dirname, '..');
const CATEGORIES = ['agree', 'disagree', 'nse-only', 'yahoo-only', 'unchecked'];

function yahooQuarters(snapshot) {
  const values = snapshot?.timeseries?.revenueQ, ends = snapshot?.timeseries?.revenueQEnds;
  const marks = snapshot?.meta?.statementPeriods?.revenueQ;
  if (!Array.isArray(values) || !Array.isArray(ends) || values.length !== ends.length) {
    return { error: 'Yahoo-Quartale oder Perioden fehlen', quarters: new Map() };
  }
  const quarters = new Map();
  for (let i = 0; i < ends.length; i++) {
    const end = typeof ends[i] === 'string' ? ends[i].slice(0, 10) : null;
    if (!N.validDate(end) || quarters.has(end)) return { error: 'Yahoo-Perioden ungueltig oder doppelt', quarters: new Map() };
    const value = typeof values[i] === 'object' && values[i] !== null ? values[i].value : values[i];
    const mark = marks?.[i];
    quarters.set(end, { value, error: mark?.end !== end || mark?.duration !== '3M' || mark?.currency !== 'INR'
      ? 'Yahoo-Periodenbeleg fehlt oder ist nicht 3M/INR' : null });
  }
  return { quarters };
}

function latestAvailable(observations, asOf) {
  const revisionTime = o => Math.max(0, ...[o.broadcastDate, o.creationDate, o.revisedDate]
    .map(t => N.timestamp(t)?.ms || 0));
  return (observations || []).filter(o => N.validDate(o.availableAfter) && o.availableAfter < asOf)
    .sort((a, b) => b.availableAfter.localeCompare(a.availableAfter)
      || revisionTime(b) - revisionTime(a)
      || ((BigInt(b.filingId) > BigInt(a.filingId)) ? 1 : (b.filingId === a.filingId ? 0 : -1)))[0] || null;
}

function compareTicker(ticker, snapshot, store, asOf, ends) {
  const canonical = store.aliases[ticker] || null;
  const observations = store.companies[canonical]?.quarterly || {};
  const parsed = yahooQuarters(snapshot);
  const meta = snapshot?.meta || {}, fx = meta.fxRateApplied;
  const baseError = !snapshot ? 'Snapshot fehlt' : meta.ticker !== ticker ? 'Snapshot-Ticker widerspricht Dateiname'
    : meta.reportingCurrencyOriginal !== 'INR' || meta.reportingCurrency !== 'USD' ? 'Yahoo-Waehrungsbasis ist nicht INR nach USD'
      : !Number.isFinite(fx) || fx <= 0 ? 'fxRateApplied fehlt oder ist ungueltig' : parsed.error;
  const rows = [];
  for (const end of ends) {
    const stored = observations[end] || [], nse = latestAvailable(stored, asOf), yahoo = parsed.quarters.get(end);
    const value = yahoo?.value;
    const hasYahoo = Number.isFinite(value) && value >= 0;
    const row = { ticker, canonical, periodEnd: end, category: 'unchecked', reason: null,
      nseINR: nse?.revenue ?? null, yahooUSD: hasYahoo ? value : null, nseUSD: null, relativeDifference: null };
    if (baseError) row.reason = baseError;
    else if (!canonical) row.reason = 'Keine eindeutige NSE-Zuordnung';
    else if (stored.length && !nse) row.reason = 'Meldung erst ab folgendem NSE-Handelstag verwendbar';
    else if (yahoo?.error && hasYahoo) row.reason = yahoo.error;
    else if (value != null && !hasYahoo) row.reason = 'Yahoo-Umsatz ungueltig';
    else if (!nse && !hasYahoo) row.reason = 'Beide Quellen ohne Quartalswert';
    else if (!nse) row.category = 'yahoo-only';
    else if (nse.currency !== 'INR' || nse.duration !== '3M' || !nse.consolidated
        || nse.element !== 'RevenueFromOperations' || nse.multiplier !== 1 || !Number.isFinite(nse.revenue) || nse.revenue < 0) {
      row.reason = 'NSE-Beobachtung verletzt Einheit, Periode oder Umsatzbegriff';
    } else if (!hasYahoo) row.category = 'nse-only';
    else {
      row.nseUSD = nse.revenue * fx;
      row.relativeDifference = value === 0 ? (row.nseUSD === 0 ? 0 : null) : Math.abs(row.nseUSD - value) / Math.abs(value);
      row.category = row.relativeDifference != null && row.relativeDifference <= 0.01 + 1e-12 ? 'agree' : 'disagree';
    }
    rows.push(row);
  }
  return rows;
}

function summarize(rows) {
  const counts = Object.fromEntries(CATEGORIES.map(k => [k, rows.filter(r => r.category === k).length]));
  const comparable = counts.agree + counts.disagree;
  return { ...counts, comparable, agreeShare: comparable ? counts.agree / comparable : null,
    thresholdPassed: comparable > 0 && counts.agree / comparable >= 0.95 };
}

function pairStatus(rows, current, yearAgo) {
  const a = rows.find(r => r.periodEnd === current), b = rows.find(r => r.periodEnd === yearAgo);
  const available = r => r && ['agree', 'nse-only', 'yahoo-only'].includes(r.category);
  const holes = [a, b].filter(r => r?.category === 'nse-only').length;
  // Every existing vendor quarter in the window must have a matching NSE control.
  // Empty on both sides is not a control, but it is also not a stored quarter.
  const controls = rows.filter(r => ![current, yearAgo].includes(r.periodEnd) && (r.nseINR != null || r.yahooUSD != null));
  const pairedControls = [a, b].filter(r => r && r.category !== 'nse-only');
  const guards = controls.concat(pairedControls);
  return { pairAvailable: available(a) && available(b), emptyQuarterCount: holes,
    companyGatePassed: guards.length > 0 && guards.every(r => r.category === 'agree'),
    wouldFillBeforeGlobalGate: available(a) && available(b) && holes === 1 && guards.length > 0 && guards.every(r => r.category === 'agree') };
}

function buildReport({ store, stocks, snapshotFor, cohort, asOf, current = '2026-09-30' }) {
  if (!N.validDate(asOf) || !N.validDate(current)) throw new Error('Berichtsdatum ungueltig');
  const tomorrow = new Date(Date.parse(asOf) + 86400000).toISOString().slice(0, 10);
  const ends = quarterEndsBefore(tomorrow, 8);
  if (!ends.includes(current)) throw new Error('Zielquartal liegt ausserhalb der letzten acht Quartale');
  const yearAgo = String(Number(current.slice(0, 4)) - 1) + current.slice(4);
  const tickers = [...new Set(stocks.filter(s => /\.(NS|BO)$/.test(s.ticker)).map(s => s.ticker))].sort();
  const allTickers = [...new Set([...tickers, ...cohort.tickers])];
  const byTicker = new Map(allTickers.map(t => [t, compareTicker(t, snapshotFor(t), store, asOf, ends)]));
  const watchlistRows = tickers.flatMap(t => byTicker.get(t));
  const cohortRows = cohort.tickers.flatMap(t => byTicker.get(t));
  // One denominator per company/quarter. Prefer its native NSE listing, never count
  // the same filing twice merely because both .NS and .BO occur in the watchlist.
  const canonicalTickers = tickers.filter(t => store.aliases[t] === t);
  const canonicalRows = canonicalTickers.flatMap(t => byTicker.get(t));
  const companySummary = summarize(canonicalRows);
  const pairs = cohort.tickers.map(ticker => ({ ticker,
    ...pairStatus(byTicker.get(ticker), current, yearAgo) }));
  return { mode: 'shadow', asOf, current, yearAgo, cohortDataDate: cohort.dataDate,
    cohortTickers: cohort.tickers.length, watchlistTickers: tickers.length, canonicalCompanies: canonicalTickers.length,
    watchlistSummary: summarize(watchlistRows), companySummary, cohortSummary: summarize(cohortRows),
    pairAvailable: pairs.filter(p => p.pairAvailable).length,
    wouldFillBeforeGlobalGate: pairs.filter(p => p.wouldFillBeforeGlobalGate).length,
    wouldFill: companySummary.thresholdPassed ? pairs.filter(p => p.wouldFillBeforeGlobalGate).length : 0,
    step3Enabled: false, pairs, cohortRows, watchlistRows };
}

function render(report) {
  const percent = n => n == null ? 'nicht messbar' : (n * 100).toFixed(2).replace('.', ',') + ' %';
  const lines = ['# NSE-Schattenvergleich', '', `Stand ${report.asOf}; Zielquartal ${report.current}; keine Board-Aenderung.`, '',
    '| Auswahl | agree | disagree | nse-only | yahoo-only | unchecked | Anteil agree |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: |'];
  for (const [label, s] of [['Firmen, je Quartal einmal', report.companySummary],
    [`Beobachtungsliste (${report.watchlistTickers} Notierungen)`, report.watchlistSummary],
    [`Befund (${report.cohortTickers} Zeilen)`, report.cohortSummary]]) {
    lines.push(`| ${label} | ${CATEGORIES.map(k => s[k]).join(' | ')} | ${percent(s.agreeShare)} |`);
  }
  lines.push('', `Septemberpaar vorhanden: ${report.pairAvailable}/${report.cohortTickers}.`,
    `Mit allen Firmenkontrollen fuellbar: ${report.wouldFillBeforeGlobalGate}/${report.cohortTickers}; nach 95-%-Tor: ${report.wouldFill}/${report.cohortTickers}.`,
    'Der Anteil misst nur vergleichbare Firmenquartale. Fehlende Gegenwerte stehen getrennt in nse-only und yahoo-only; unchecked nennt den Grund.',
    'T7: Kein Wert am Meldetag. availableAfter beruecksichtigt Revisionen; der spaetere Leser muss den NSE-Handelskalender beachten.',
    'Schritt 3 ist nicht aktiviert. Ein kleiner Ausschnitt ersetzt keinen vollstaendigen Quellenlauf.', '');
  for (const [title, rows] of [['Befundzeilen', report.cohortRows], ['Gesamte indische Beobachtungsliste', report.watchlistRows]]) {
    lines.push('## ' + title, '', '| Ticker | Quartal | Kategorie | Abweichung | Grund |', '| --- | --- | --- | ---: | --- |');
    for (const row of rows) lines.push(`| ${row.ticker} | ${row.periodEnd} | ${row.category} | ${percent(row.relativeDifference)} | ${row.reason || ''} |`);
    lines.push('');
  }
  return lines.join('\n');
}

function main(opts = {}) {
  const store = loadStore(opts.store || DEFAULT_OUT);
  if (!store) throw new Error('NSE-Speicher fehlt');
  const wl = loadWatchlist(opts.watchlist || path.join(ROOT, 'watchlist.json'));
  if (wl.error || wl.shape === 'invalid') throw new Error('Beobachtungsliste unlesbar');
  const cohort = JSON.parse(fs.readFileSync(opts.cohort || path.join(ROOT, 'tests/fixtures/nse-quarters/cohort-2026-11-11.json'), 'utf8'));
  if (!Array.isArray(cohort.tickers) || new Set(cohort.tickers).size !== cohort.tickers.length) throw new Error('Befundliste ungueltig');
  const snapshots = opts.snapshots || path.join(ROOT, 'snapshots');
  const snapshotFor = ticker => {
    try { return JSON.parse(fs.readFileSync(path.join(snapshots, safeSnapshotFilename(ticker)), 'utf8')); }
    catch (e) { if (e.code === 'ENOENT') return null; throw e; }
  };
  const report = buildReport({ store, stocks: wl.stocks, snapshotFor, cohort,
    asOf: opts.asOf || new Date().toISOString().slice(0, 10), current: opts.current });
  // Reports are evidence: never overwrite an earlier run.
  if (opts.json) fs.writeFileSync(opts.json, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  (opts.log || console.log)(render(report));
  return report;
}

if (require.main === module) {
  try {
    const opts = {}, allowed = new Set(['store', 'watchlist', 'cohort', 'snapshots', 'as-of', 'current', 'json']);
    for (const arg of process.argv.slice(2)) {
      const m = /^--([^=]+)=(.+)$/.exec(arg);
      if (!m || !allowed.has(m[1])) throw new Error('Unbekanntes Argument: ' + arg);
      opts[m[1] === 'as-of' ? 'asOf' : m[1]] = m[2];
    }
    main(opts);
  } catch (e) { console.error(e.message); process.exitCode = 1; }
}
module.exports = { yahooQuarters, latestAvailable, compareTicker, summarize, pairStatus, buildReport, render, main };

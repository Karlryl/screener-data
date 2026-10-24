#!/usr/bin/env node
'use strict';

// Additive filter feed. Official scores and ranks are copied, never recomputed.
const fs = require('node:fs');
const path = require('node:path');
const { writeJsonAtomic } = require('../lib/atomic-write.js');
const { isMetadataSnapshot } = require('../lib/snapshot-fs.js');
const { prepareSnapshot } = require('../lib/yahoo-q4-known-cases.js');
const { correctedBelowFloor, table: marketCapCases } = require('../lib/market-cap-guard.js');
const { norm, metricVal } = require('../src/scoring/snapshot.js');
const { normalizeCountry } = require('../src/scoring/country.js');
const { fcfMarginValid } = require('../src/scoring/engine.js');
const { revGrowthLevel, ruleOfX } = require('../src/scoring/axes.js');
const { winsorTailBounds } = require('../src/scoring/score.js');
const { route } = require('../src/scoring/router.js');
const { beurteileWaehrungsbeleg } = require('./write-findash-export.js');
const r40 = require('./write-rule40-export.js');
const { displayFor } = require('./update-ath-state.js');
const { mischVal, mischVerhaeltnisUnkorrigiert } = require('./write-board-history.js');
const { loadWatchlist } = require('../lib/watchlist-fs.js');
const { filterToAuthorizedUniverse } = require('../src/scoring/run-screener.js');

const ROOT = path.resolve(__dirname, '..');
const SCHEMA = 'findash-export/v1';
// The master approved 6 MB for the complete universe; retain all fields.
const MAX_BYTES = 6_000_000;
const ROW_KEYS = 't n b sc rk c rg s mc g g3 ps evs pe peSt fpe dy dySt po roe fcf r40 gm d52 ath asOf aus'.split(' ');
const NUMBER_KEYS = 'sc rk mc g g3 ps evs pe fpe dy po roe fcf r40 gm d52 ath'.split(' ');
const STRING_KEYS = 'n b c rg s asOf'.split(' ');
const finite = Number.isFinite;
const round = v => {
  if (!finite(v)) return null;
  const rounded = Math.round(v * 100) / 100;
  return rounded === 0 && v !== 0 ? Number(v.toPrecision(2)) : rounded;
};
const text = v => typeof v === 'string' && v.trim() ? v.trim().replace(/\s+/g, ' ') : null;
// Plausibility ceilings (G2/T2: a value beyond them is withheld with a reason, never clipped or replaced).
const GM_MAX_ABS_PCT = 100;   // gross profit cannot exceed revenue; below -100 % the vendor margin is unverifiable
const DY_MAX_PCT = 50;        // 25-50 % exists (shipping, special dividends); above 50 % every seen case was a unit/currency error
const PO_MAX_PCT = 100000;    // unit errors only (BANPU.BK 2,788,100); high real ratios (SLG 15375) stay, findash caps ranking at 100
const EV_FACTOR_MIN = Math.E; // with EV_MARGIN 1.0 a factor inside 1/e..e can never win the balance comparison
const EV_MARGIN = 1.0;        // one reading must beat the other by a factor e (ln distance 1.0)
const EV_IMPLAUSIBLE_LN = 1.5; // EV is mcap + debt - cash by definition; beyond a factor e^1.5 it is impossible
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const snapshotFiles = dir => fs.readdirSync(dir).filter(f => f.endsWith('.json') && !isMetadataSnapshot(f)).sort();

/**
 * Calculate three-year revenue CAGR without compacting missing annual slots.
 * @param {object} snapshot Canonical snapshot, newest annual values first.
 * @returns {number|null} Percentage CAGR, or null without two positive endpoints.
 */
function growth3(snapshot) {
  const revenue = norm(snapshot, 'annualRev');
  const ends = snapshot.annual?.annualRevEnds;
  if (ends?.[0] && ends?.[3] && new Date(ends[0]).getUTCFullYear() - new Date(ends[3]).getUTCFullYear() !== 3) return null;
  return revenue[0] > 0 && revenue[3] > 0 ? round((Math.cbrt(revenue[0] / revenue[3]) - 1) * 100) : null;
}

function dividend(snapshot) {
  const value = metricVal(snapshot, 'dividendYield');
  const status = snapshot.metrics?.dividendStatus?.value;
  if (finite(value) && value > 0 && (status == null || status === 'zahlt')) {
    return value > DY_MAX_PCT ? { dy: null, dySt: 'unbekannt', implausible: true } : { dy: round(value), dySt: 'zahlt' };
  }
  // Old nulls cannot prove that summaryDetail answered.
  return { dy: null, dySt: status === 'keine' && value == null ? 'keine' : 'unbekannt' };
}

function mixedCurrency(meta) {
  const reporting = text(meta.reportingCurrencyOriginal || meta.reportingCurrency);
  const trading = text(meta.tradingCurrencyOriginal || meta.tradingCurrency);
  // Deliberately stricter than PIT mischVal: an FX factor does not verify ADR EPS.
  return Boolean(reporting && trading && reporting !== trading);
}

/**
 * Detect an EV/S that Yahoo built from an enterprise value in the REPORTING currency while the pull multiplied it
 * by the trading/reporting factor (USD-listed ADR/OTC lines of JPY, CNY, KRW, ARS ... reporters, e.g. KXIAY 292).
 * Evidence: the vendor EV is compared with mcap + debt - cash from the latest annual balance, once as is and once
 * times the pull factor; the better reading wins only by a clear margin (T5). Without balance data the EV/mcap
 * ratio decides when it is implausible as is but plausible divided by the factor.
 * @param {object} snapshot Prepared snapshot.
 * @returns {boolean} True when the EV/S must be withheld.
 */
function evInReportingCurrency(snapshot) {
  const factor = snapshot.meta?.mischVerhaeltnisFaktor, mcap = snapshot.marketCap?.value, ev = metricVal(snapshot, 'enterpriseValue');
  if (!(factor > 0) || !(factor >= EV_FACTOR_MIN || factor <= 1 / EV_FACTOR_MIN) || !(mcap > 0) || !(ev > 0)) return false;
  const debt = norm(snapshot, 'annualBalance', 'totalDebt')[0], cash = norm(snapshot, 'annualBalance', 'totalCash')[0];
  if (finite(debt) && finite(cash)) {
    const check = Math.max(mcap + debt - cash, 0.1 * mcap);
    return Math.abs(Math.log(ev / (check * factor))) < Math.abs(Math.log(ev / check)) - EV_MARGIN;
  }
  const q = ev / mcap;
  return (q < 0.1 || q > 10) && q / factor >= 0.1 && q / factor <= 10;
}

/**
 * Detect an enterprise value that fits no reading (KAJMF EV/mcap 23): with balance data the vendor EV must lie within a
 * factor e^1.5 of mcap + debt - cash, or, for factor < 1 (HCLTECH.NS: balance in INR, EV in USD), of
 * mcap + (debt - cash) * factor. Checked only after evInReportingCurrency did not fire.
 * @param {object} snapshot Prepared snapshot.
 * @returns {boolean} True when the EV/S must be withheld as implausible.
 */
function evImplausible(snapshot) {
  const mcap = snapshot.marketCap?.value, ev = metricVal(snapshot, 'enterpriseValue');
  const debt = norm(snapshot, 'annualBalance', 'totalDebt')[0], cash = norm(snapshot, 'annualBalance', 'totalCash')[0];
  if (!(mcap > 0) || !(ev > 0) || !finite(debt) || !finite(cash)) return false;
  const far = check => Math.abs(Math.log(ev / Math.max(check, 0.1 * mcap))) > EV_IMPLAUSIBLE_LN;
  const factor = snapshot.meta?.mischVerhaeltnisFaktor;
  // ponytail: with factor >= 1 a check3 fit can be USD mcap plus reporting-currency net debt (KAJMF); real fix is EV scaling in pull-yahoo.js.
  return far(mcap + debt - cash) && !(factor > 0 && factor < 1 && !far(mcap + (debt - cash) * factor));
}

function usableFcf(snapshot) {
  const margin = metricVal(snapshot, 'fcfMarginTTM');
  return !snapshot.meta?.fcfMarginTTMSuppressed
    && margin <= r40.MAX_FCF_MARGIN_PCT
    && fcfMarginValid(margin, norm(snapshot, 'annualFCF'), norm(snapshot, 'annualOCF')) ? margin : null;
}

/**
 * Sales multiples are shown only when positive and computed on positive revenue (T2).
 * Yahoo divides market cap and EV by trailing revenue. Holding companies that book fair-value losses
 * as revenue (Kinnevik, Exor, Reinet) get a negative divisor: P/S turns negative and EV/S takes the
 * wrong sign (positive when EV is negative too). A non-positive EV/S on positive revenue means EV <= 0.
 * @param {object} snapshot Prepared snapshot.
 * @param {boolean} withheld Currency verdict that already withholds both ratios.
 * @returns {{ps: number|null, evs: number|null, reason: string|null}} Shown values and the presence reason.
 */
function salesMultiples(snapshot, withheld) {
  const ps = mischVal(snapshot.metrics?.priceSales, withheld), evs = mischVal(snapshot.metrics?.enterpriseToRevenue, withheld);
  if (ps === null && evs === null) return { ps: null, evs: null, reason: null };
  const revenue = metricVal(snapshot, 'revenueTTM');
  // ponytail: revenue exactly 0 is treated as a placeholder (T2), only a negative divisor proves the sign.
  if ((revenue !== null && revenue < 0) || (ps !== null && ps <= 0)) return { ps: null, evs: null, reason: 'umsatz-negativ' };
  return { ps: round(ps), evs: evs !== null && evs > 0 ? round(evs) : null, reason: evs !== null && evs <= 0 ? 'ev-negativ' : null };
}

function usableRule40(snapshot, generatedAt) {
  const growth = revGrowthLevel(snapshot), margin = usableFcf(snapshot);
  if (!finite(growth) || margin === null || r40.datenSuspekt(snapshot)
      || r40.SEKTOR_AUSSCHLUSS.includes(snapshot.meta?.sector)) return false;
  if (r40.r40SchattenTor({ value: margin, grund: 'ok' }, growth, snapshot) !== 'ok') return false;
  const quarter = r40.basisQuartal(snapshot), revenue = metricVal(snapshot, 'revenueTTM');
  if (quarter !== null && finite(revenue) && revenue > 0
      && quarter < r40.MIN_BASE_QUARTER_SHARE * revenue / 4) return false;
  const year = r40.basisJahr(snapshot);
  if (year && year.basis < r40.MIN_BASE_YEAR_SHARE * year.aktuell) return false;
  const end = r40.neuestesQuartalsEnde(snapshot);
  return end !== null && (Date.parse(generatedAt) - end) / 86400000 <= r40.MAX_FISCAL_AGE_DAYS;
}

/**
 * Join every supplied snapshot with detached official board and exclusion records.
 * @param {object} input Prepared snapshots, board map, exclusion map, ATH entries and generation.
 * @returns {object} Compact v1 envelope; no score, input or board is mutated.
 */
function buildUniverse({ snapshots, boards = new Map(), excluded = new Map(), athEntries = {}, generatedAt }) {
  if (!text(generatedAt) || !finite(Date.parse(generatedAt))) throw new Error('Invalid generation');
  const eligible = new Set(snapshots.filter(s => usableRule40(s, generatedAt)));
  const bounds = eligible.size >= r40.MIN_WINSOR_SAMPLE
    ? winsorTailBounds([...eligible].map(s => revGrowthLevel(s))) : null;
  // axes clamps fractional growth; the Rule40 writer learns percentage bounds.
  const growthBounds = bounds?.map(value => value / 100);
  let marketCapDropped = 0;
  const rows = snapshots.map(snapshot => {
    const meta = snapshot.meta || {}, ticker = text(meta.ticker);
    if (!ticker) throw new Error('Snapshot without ticker');
    const official = boards.get(ticker), board = official?.row;
    if (board && (correctedBelowFloor(snapshot) || (meta.marketCapReason && !finite(snapshot.marketCap?.value)))) {
      marketCapDropped++;
      console.error('::error::' + ticker + ': Filterzeile verworfen. ' + (meta.marketCapReason || 'Belegter Börsenwert liegt unter der Mindestgröße.'));
      return null;
    }
    const geo = normalizeCountry(meta), mixed = mixedCurrency(meta);
    const aus = [...new Set(excluded.get(ticker) || [])];
    if (!board && !aus.length) {
      const routing = route(snapshot);
      if (routing.action === 'route') throw new Error('Missing board/exclusion record for ' + ticker);
      aus.push(routing.reason || routing.action);
    }
    if (meta.marketCapReason && (!board || !finite(snapshot.marketCap?.value))) aus.push(meta.marketCapReason);
    if (r40.datenSuspekt(snapshot)) aus.push('data-suspect');
    if (board?.dupIssuer) aus.push('dup-issuer');
    if (mixed) aus.push('mischwaehrung');
    if (board?.rankGrund) aus.push(board.rankGrund);
    const salesMixed = mischVerhaeltnisUnkorrigiert(meta);
    const ratio = (name, withheld) => mischVal(snapshot.metrics?.[name], withheld);
    const sales = salesMultiples(snapshot, salesMixed);
    if (sales.reason) aus.push(sales.reason);
    const evsCurrency = sales.evs !== null && evInReportingCurrency(snapshot);
    if (evsCurrency) aus.push('evs-waehrung');
    const evsBad = sales.evs !== null && !evsCurrency && evImplausible(snapshot);
    if (evsBad) aus.push('evs-implausible');
    const trailing = ratio('pe', mixed);
    const pe = finite(trailing) && trailing > 0 ? round(trailing) : null;
    // Same rule as pe: a zero or negative forward P/E is a forecast loss, not the cheapest stock; it stays missing.
    const forward = ratio('forwardPE', mixed);
    const fpe = finite(forward) && forward > 0 ? round(forward) : null;
    const netIncome = norm(snapshot, 'annualNetIncome')[0];
    const high = metricVal(snapshot, 'fiftyTwoWeekHigh'), price = snapshot.price?.regularMarketPrice;
    const highRatio = finite(price) && price > 0 && finite(high) && high > 0 ? price / high : null;
    const highImplausible = highRatio !== null && (highRatio > 1.20 || highRatio < 0.05);
    if (highImplausible) aus.push('d52-implausible');
    const ath = board?.ath ?? displayFor(athEntries[ticker]);
    const metricDates = Object.values(snapshot.metrics || {}).map(m => m?.asOf);
    const dates = [meta.fundamentalsAsOf || meta.asOf, ...metricDates, ath?.lastDate]
      .filter(d => typeof d === 'string' && finite(Date.parse(d))).sort((a, b) => Date.parse(a) - Date.parse(b));
    const { implausible: dyBad, ...div } = dividend(snapshot), payout = metricVal(snapshot, 'payoutRatio');
    const grossMargin = metricVal(snapshot, 'grossMargin');
    const gmBad = finite(grossMargin) && Math.abs(round(grossMargin)) > GM_MAX_ABS_PCT;
    // Only a negative payout or a unit error is withheld; the vendor yield, not the payout, is the broken field (000059.SZ).
    const poBad = finite(payout) && (payout > PO_MAX_PCT || payout < 0);
    if (gmBad) aus.push('gm-implausible');
    if (dyBad) aus.push('dy-implausible');
    if (poBad) aus.push('po-implausible');
    return Object.fromEntries(Object.entries({
      t: ticker, n: text(board?.name ?? meta.name), b: official?.branch ?? null,
      sc: finite(board?.score) ? board.score : null, rk: finite(board?.rank) ? board.rank : null,
      c: text(board?.country ?? geo.country), rg: text(board?.region ?? geo.region), s: text(board?.sector ?? meta.sector),
      mc: meta.marketCapReason || marketCapCases[ticker] ? (finite(snapshot.marketCap?.value) ? round(snapshot.marketCap.value) : null) : board ? (finite(board.marketCap) ? board.marketCap : null)
        : (beurteileWaehrungsbeleg(meta).ok ? round(snapshot.marketCap?.value) : null),
      g: board ? round(board.revGrowthYoYPct) : round(revGrowthLevel(snapshot)), g3: growth3(snapshot),
      ps: sales.ps, evs: evsCurrency || evsBad ? null : sales.evs,
      pe, peSt: mixed ? 'waehrung' : pe !== null ? 'vorhanden' : finite(netIncome) && netIncome < 0 ? 'verlust' : 'unbekannt',
      fpe,
      ...div, po: poBad || (payout === 0 && (div.dySt === 'zahlt' || dyBad)) ? null : round(payout), roe: round(metricVal(snapshot, 'returnOnEquity')),
      fcf: round(usableFcf(snapshot)),
      // The prior gate prevents ruleOfX from silently falling back to growth alone.
      r40: eligible.has(snapshot) ? round(ruleOfX(snapshot, 1, true, growthBounds)) : null,
      gm: grossMargin === 0 || gmBad ? null : round(grossMargin),
      // A slightly newer price may exceed the high; implausible scale differences stay missing.
      d52: highRatio !== null && !highImplausible ? round(Math.min(0, (highRatio - 1) * 100)) : null,
      ath: round(ath?.distancePct), asOf: dates.length ? new Date(dates[0]).toISOString().slice(0, 10) : null,
      aus: [...new Set(aus)],
    }).filter(([, value]) => value !== null));
  }).filter(Boolean).sort((a, b) => a.t.localeCompare(b.t, 'en'));
  return { schema: SCHEMA, generated_at: generatedAt, snapshotCount: snapshots.length, ...(marketCapDropped ? { marketCapDropped } : {}), rows };
}

/**
 * Check both directions of value/status invariants and the uncompressed size budget.
 * @param {object} feed Parsed filter universe.
 * @param {number} bytes Exact UTF-8 file size, including whitespace.
 * @returns {string[]} Contract breaches; an empty array means valid.
 */
function validateUniverse(feed, bytes) {
  const errors = [], seen = new Set();
  if (!Number.isInteger(bytes) || bytes < 1 || bytes > MAX_BYTES) errors.push('Size must be between 1 and ' + MAX_BYTES + ' bytes');
  if (feed?.schema !== SCHEMA || !text(feed?.generated_at) || !finite(Date.parse(feed.generated_at))) errors.push('Invalid envelope');
  if (!Array.isArray(feed?.rows)) return errors.concat('Missing rows');
  const dropped = feed.marketCapDropped ?? 0;
  if (!Number.isInteger(dropped) || dropped < 0 || !Number.isInteger(feed.snapshotCount) || feed.snapshotCount <= 0 || feed.rows.length + dropped !== feed.snapshotCount) errors.push('Snapshot count mismatch');
  for (const row of feed.rows) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) { errors.push('Invalid row'); continue; }
    const where = text(row.t) || '?';
    if (Object.keys(row).some(k => !ROW_KEYS.includes(k)) || Object.values(row).some(v => v === null)) errors.push(where + ': row shape');
    if (!text(row.t) || seen.has(row.t)) errors.push(where + ': missing/duplicate ticker');
    seen.add(row.t);
    for (const key of NUMBER_KEYS) if (Object.hasOwn(row, key) && !finite(row[key])) errors.push(where + ': ' + key + ' not finite');
    for (const key of STRING_KEYS) if (Object.hasOwn(row, key) && !text(row[key])) errors.push(where + ': ' + key + ' not string');
    if (row.asOf != null && (typeof row.asOf !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(row.asOf)
        || !finite(Date.parse(row.asOf)) || new Date(row.asOf).toISOString().slice(0, 10) !== row.asOf)) errors.push(where + ': invalid asOf');
    if (row.rk != null && (!Number.isInteger(row.rk) || row.rk < 1)) errors.push(where + ': invalid rank');
    if (!Array.isArray(row.aus) || row.aus.some(a => !text(a)) || new Set(row.aus).size !== row.aus.length) { errors.push(where + ': invalid aus'); continue; }
    if (row.b == null && (row.sc != null || row.rk != null || !row.aus.length)) errors.push(where + ': unscored row lacks reason');
    if (row.b != null && row.sc == null) errors.push(where + ': board without score');
    if (!['vorhanden', 'verlust', 'unbekannt', 'waehrung'].includes(row.peSt)
        || (row.pe != null) !== (row.peSt === 'vorhanden') || (row.pe != null && row.pe <= 0)) errors.push(where + ': inconsistent peSt');
    if (row.fpe != null && row.fpe <= 0) errors.push(where + ': non-positive forward P/E');
    if (!['zahlt', 'keine', 'unbekannt'].includes(row.dySt)
        || (row.dy != null) !== (row.dySt === 'zahlt') || (row.dy != null && row.dy <= 0)) errors.push(where + ': inconsistent dySt');
    const mixed = row.aus.includes('mischwaehrung');
    if (mixed !== (row.peSt === 'waehrung') || (mixed && ['pe', 'fpe'].some(k => row[k] != null))) errors.push(where + ': currency guard');
    if (row.po === 0 && row.dySt === 'zahlt') errors.push(where + ': placeholder payout');
    if (row.gm === 0) errors.push(where + ': placeholder gross margin');
    if (row.gm != null && Math.abs(row.gm) > GM_MAX_ABS_PCT) errors.push(where + ': gross margin beyond ceiling');
    if (row.aus.includes('gm-implausible') && row.gm != null) errors.push(where + ': inconsistent gm reason');
    if (row.dy != null && row.dy > DY_MAX_PCT) errors.push(where + ': dividend yield beyond ceiling');
    if (row.aus.includes('dy-implausible') && (row.dy != null || row.dySt !== 'unbekannt')) errors.push(where + ': inconsistent dy reason');
    if (row.po != null && (row.po > PO_MAX_PCT || row.po < 0)) errors.push(where + ': payout beyond ceiling');
    if (row.aus.includes('po-implausible') && row.po != null) errors.push(where + ': inconsistent po reason');
    if (row.aus.includes('evs-waehrung') && row.evs != null) errors.push(where + ': inconsistent ev currency reason');
    if (row.aus.includes('evs-implausible') && (row.evs != null || row.aus.includes('evs-waehrung'))) errors.push(where + ': inconsistent ev implausible reason');
    if (['ps', 'evs'].some(k => row[k] != null && row[k] <= 0)) errors.push(where + ': non-positive sales multiple');
    if (row.aus.includes('umsatz-negativ') && (row.ps != null || row.evs != null)) errors.push(where + ': sales multiple on negative revenue');
    if (row.aus.includes('ev-negativ') && row.evs != null) errors.push(where + ': inconsistent ev reason');
    if (row.d52 != null && (row.d52 < -100 || row.d52 > 0)) errors.push(where + ': invalid d52');
    if (row.aus.includes('d52-implausible') && row.d52 != null) errors.push(where + ': inconsistent d52 reason');
    if (row.fcf != null && row.fcf > r40.MAX_FCF_MARGIN_PCT) errors.push(where + ': invalid fcf');
    if (row.r40 != null && (row.g == null || row.fcf == null)) errors.push(where + ': incomplete rule of 40');
  }
  return errors;
}

/**
 * Read one generation of boards and snapshots and atomically write the additive file.
 * @param {object} options Snapshot/v1 directories, optional ATH file and scoring watchlist.
 * @returns {object} Written feed and its exact byte size.
 */
function build({ snapshotsDir, v1Dir, athFile = path.join(ROOT, 'external-data', 'ath-state.json'), watchlistFile = path.join(ROOT, 'watchlist.json') }) {
  const index = readJson(path.join(v1Dir, 'index.json'));
  if (index.schema !== SCHEMA || !Array.isArray(index.branches) || !index.branches.length) throw new Error('Invalid board index');
  const boards = new Map(), excluded = new Map();
  for (const branch of index.branches) {
    if (!/^[a-z0-9-]+$/.test(branch)) throw new Error('Invalid board path');
    const file = readJson(path.join(v1Dir, 'full', branch + '.json'));
    if (file.schema !== SCHEMA || file.generated_at?.slice(0, 10) !== index.generated_at?.slice(0, 10)) throw new Error('Mixed board generation');
    for (const track of ['profitable', 'unprofitable']) {
      if (!Array.isArray(file[track])) throw new Error('Missing board track');
      for (const row of file[track]) {
        if (boards.has(row.ticker)) throw new Error('Duplicate official ticker ' + row.ticker);
        boards.set(row.ticker, { branch, row });
      }
    }
  }
  const exclusionFile = readJson(path.join(v1Dir, 'excluded.json'));
  if (exclusionFile.schema !== SCHEMA || exclusionFile.generated_at?.slice(0, 10) !== index.generated_at?.slice(0, 10) || !Array.isArray(exclusionFile.rows)) throw new Error('Invalid exclusion generation');
  for (const group of exclusionFile.rows) {
    for (const leg of group.beine || []) {
      if (!text(leg.ticker) || !text(leg.reason)) throw new Error('Invalid exclusion leg');
      excluded.set(leg.ticker, [leg.reason]);
    }
  }
  const snapshots = snapshotFiles(snapshotsDir).map(file => prepareSnapshot(readJson(path.join(snapshotsDir, file))));
  const watchlist = loadWatchlist(watchlistFile);
  if (watchlist.error) throw new Error('Invalid scoring watchlist: ' + watchlist.error);
  const { filtered } = filterToAuthorizedUniverse(snapshots, watchlist.stocks);
  if (index.generatedFromSnapshots !== filtered.length || exclusionFile.generatedFromSnapshots !== filtered.length) throw new Error('Snapshot/board population mismatch');
  const active = new Set(filtered.map(s => s.meta?.ticker));
  for (const snapshot of snapshots) {
    const ticker = snapshot.meta?.ticker;
    if (!active.has(ticker) && !boards.has(ticker) && !excluded.has(ticker)) excluded.set(ticker, ['outside-watchlist']);
  }
  const tickers = new Set(snapshots.map(s => s.meta?.ticker));
  for (const ticker of boards.keys()) if (!tickers.has(ticker)) throw new Error('Board ticker absent from snapshots: ' + ticker);
  let athEntries = {};
  try { athEntries = readJson(athFile).entries || {}; }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const feed = buildUniverse({ snapshots, boards, excluded, athEntries, generatedAt: index.generated_at });
  const bytes = Buffer.byteLength(JSON.stringify(feed));
  const errors = validateUniverse(feed, bytes);
  if (errors.length) throw new Error(errors.slice(0, 10).join('; ') + ' (measured ' + bytes + ' bytes)');
  const target = path.join(v1Dir, 'filter', 'universum.json');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  writeJsonAtomic(target, feed, { indent: 0 });
  return { feed, bytes };
}

/**
 * Run the offline writer or read-only validator with explicit input directories.
 * @param {string[]} argv CLI arguments.
 * @returns {number} Zero on success, one on a source or contract error.
 */
function main(argv) {
  try {
    const options = { snapshotsDir: process.env.FINDASH_SNAPSHOTS_DIR || path.join(ROOT, 'snapshots'), v1Dir: path.join(ROOT, 'outputs', 'findash-export', 'v1') };
    const names = { '--snapshots': 'snapshotsDir', '--v1-dir': 'v1Dir', '--ath-file': 'athFile' };
    let check = false;
    for (let i = 0; i < argv.length; i++) {
      if (argv[i] === '--check') check = true;
      else if (names[argv[i]] && argv[i + 1] && !argv[i + 1].startsWith('--')) options[names[argv[i]]] = path.resolve(argv[++i]);
      else throw new Error('Unknown/incomplete argument ' + argv[i]);
    }
    if (check) {
      const bytes = fs.readFileSync(path.join(options.v1Dir, 'filter', 'universum.json'));
      const errors = validateUniverse(JSON.parse(bytes.toString('utf8')), bytes.length);
      if (errors.length) throw new Error(errors.slice(0, 10).join('; '));
      console.log('[filter] check OK (' + bytes.length + ' bytes)');
    } else {
      const result = build(options);
      console.log('[filter] ' + result.feed.rows.length + ' snapshots, ' + result.bytes + ' bytes');
    }
    return 0;
  } catch (error) { console.error('[filter] ' + error.message); return 1; }
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));
module.exports = { evInReportingCurrency, evImplausible, GM_MAX_ABS_PCT, DY_MAX_PCT, PO_MAX_PCT, buildUniverse, growth3, salesMultiples, validateUniverse, build, main, ROW_KEYS, NUMBER_KEYS, MAX_BYTES };

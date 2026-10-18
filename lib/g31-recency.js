'use strict';

const { norm, periodEnds, jahresVergleichIdx, jahresFensterAusgerichtet,
  JAHRESVERGLEICH_TOLERANZ_TAGE } = require('../src/scoring/snapshot.js');
const { annualPeriodEnds, checkAnnualPair, checkNewerAnnualPair, annualPairPasses, annualPairRuleEnabled,
  _tagesnummer } = require('./annual-pairs.js');

// G31 (Karl 11.10.2026), switch built 18.10.2026 and active from its reviewed delivery: production runs the v1 arm
// (newest labelled quarter or validated fiscal year). null is the pre-G31 calculation, reachable
// only through withG31Variant('legacy', fn) for the comparison export; v2 stays a measurement arm.
let activeVariant = 'v1';

/** Read the active arm: v1 in production, v2 inside a measurement, null inside the legacy comparison.
 * @param {void} none No arguments.
 * @returns {string|null} v1, v2, or null (legacy).
 */
function g31Variant() { return activeVariant; }

/** Run a synchronous calculation in another arm without changing the production default.
 * @param {string} variant v1, v2, or legacy (the pre-G31 calculation).
 * @param {Function} fn Synchronous scoring/export calculation.
 * @returns {*} Calculation result, restoring the previous arm on every exit.
 */
function withG31Variant(variant, fn) {
  if (!['v1', 'v2', 'legacy'].includes(variant) || typeof fn !== 'function' || fn.constructor.name === 'AsyncFunction') {
    throw new TypeError('G31 requires v1/v2/legacy and a synchronous calculation');
  }
  const previous = activeVariant;
  try {
    activeVariant = variant === 'legacy' ? null : variant;
    const result = fn();
    if (result && typeof result.then === 'function') throw new TypeError('G31 does not accept thenables');
    return result;
  } finally { activeVariant = previous; }
}

const iso = value => _tagesnummer(value) === null ? null : value.slice(0, 10);
const missing = reason => ({ basis: 'none', pct: null, periodEnd: null, priorPeriodEnd: null,
  sourcePeriodEnd: null, sourcePriorPeriodEnd: null, label: 'Zeitraum nicht verfügbar', reason,
  current: null, prior: null });

function candidate(basis, current, prior, end, priorEnd, sourceEnd = end, sourcePriorEnd = priorEnd) {
  if (!Number.isFinite(current) || !(prior > 0) || !Number.isFinite(current / prior)) {
    return missing('Kein gültiges Wertepaar mit positivem Vorjahreswert vorhanden.');
  }
  const periodEnd = iso(end), priorPeriodEnd = iso(priorEnd);
  const prefix = basis === 'quarter' ? 'Quartal' : basis === 'halfYear' ? 'Halbjahr' : basis === 'ttm' ? 'Vier Quartale' : 'Geschäftsjahr';
  return { basis, pct: (current / prior - 1) * 100, periodEnd, priorPeriodEnd,
    sourcePeriodEnd: iso(sourceEnd), sourcePriorPeriodEnd: iso(sourcePriorEnd),
    label: periodEnd ? `${prefix} bis ${periodEnd.slice(8, 10)}.${periodEnd.slice(5, 7)}.${periodEnd.slice(0, 4)}`
      : `${prefix}, Periodenende unbekannt`,
    reason: periodEnd && priorPeriodEnd ? null : 'Periodenenden fehlen; die Aktualität ist nicht belegbar.', current, prior };
}

/** Check explicit operand currencies without filling or converting missing evidence.
 * @param {object} s Prepared snapshot.
 * @param {string} container annual or timeseries.
 * @param {string} field Stored series name.
 * @param {Array<number>} indices Consumed positions only.
 * @returns {boolean} Whether all explicit currency markers agree.
 */
function currenciesMatch(s, container, field, indices) {
  const currencies = indices.flatMap(i => {
    const row = s?.[container]?.[field]?.[i];
    return [row?.currency, row?.currencyUnit].filter(v => typeof v === 'string');
  });
  return new Set(currencies).size <= 1;
}

/** Stored statement duration of one cell (P267). Metadata counts only when its list is as long as the series
 * and its end equals the cell's own source end; otherwise the duration is unknown (null), never invented.
 * @param {object} s Prepared snapshot.
 * @param {string} field Quarterly series name.
 * @param {number} i Position in the series.
 * @param {string|null} sourceEnd ISO source end of that position.
 * @returns {string|null} Duration such as 3M or 6M, or null.
 */
function periodDuration(s, field, i, sourceEnd) {
  const list = s?.meta?.statementPeriods?.[field];
  if (!Array.isArray(list) || list.length !== norm(s, field).length || !sourceEnd) return null;
  const p = list[i];
  return p && typeof p.duration === 'string' && iso(p.end) === sourceEnd ? p.duration : null;
}

/** Select only the latest quarter and its existing date-matched year-ago partner.
 * @param {object} s Prepared snapshot; held cells must already be null.
 * @param {string} field Quarterly series name.
 * @returns {object} Unclamped percentage and both display/source periods, or a German missing reason.
 */
function quarterCandidate(s, field = 'revenueQ') {
  const values = norm(s, field), pair = jahresVergleichIdx(s, field, 0), ends = periodEnds(s, field);
  if (!pair || pair.idx >= values.length || (pair.quelle === 'position'
      && !values.slice(0, pair.idx + 1).every(Number.isFinite))) {
    return missing('Das Vorjahresquartal fehlt oder die undatierte Quartalsreihe hat eine Lücke.');
  }
  if (!currenciesMatch(s, 'timeseries', field, [0, pair.idx])) return missing('Die Währungen der Quartalswerte stimmen nicht überein.');
  // P267: explicitly different durations (6M against 3M) form no pair; two half years stay valid as half years.
  const durations = [periodDuration(s, field, 0, iso(ends[0])), periodDuration(s, field, pair.idx, iso(ends[pair.idx]))];
  if (durations[0] && durations[1] && durations[0] !== durations[1]) return missing('Die beiden Werte umfassen unterschiedlich lange Zeiträume.');
  const duration = durations[0] || durations[1];
  if (duration && !['3M', '6M'].includes(duration)) return missing('Der gespeicherte Zeitraum ist weder ein Quartal noch ein Halbjahr.');
  const reported = field === 'revenueQ' ? s?.timeseries?.reportedRevenueQEnds : null;
  const labels = Array.isArray(reported) && reported.length === values.length ? reported : [];
  return candidate(duration === '6M' ? 'halfYear' : 'quarter', values[0], values[pair.idx], iso(labels[0]) || ends[0],
    iso(labels[pair.idx]) || ends[pair.idx], ends[0], ends[pair.idx]);
}

function annualCandidate(s) {
  // Defer axes to avoid an initialization cycle; its fingerprint guard stays the authority.
  const record = require('../src/scoring/axes.js').annualLegNewerYear(s);
  if (record) {
    if (annualPairRuleEnabled('growth') && !annualPairPasses(checkNewerAnnualPair(s, record))) return missing('Die neueren Geschäftsjahre liegen nicht hintereinander.');
    return candidate('yearNewerRecord', record.revenue, record.priorRevenue, record.end, record.priorEnd);
  }
  const values = norm(s, 'annualRev'), ends = annualPeriodEnds(s, 'annualRev');
  if (annualPairRuleEnabled('growth') && !annualPairPasses(checkAnnualPair(s, 'annualRev', 0, 1))) return missing('Die Geschäftsjahre liegen nicht hintereinander.');
  if (!currenciesMatch(s, 'annual', 'annualRev', [0, 1])) return missing('Die Währungen der Jahreswerte stimmen nicht überein.');
  return candidate('year', values[0], values[1], ends[0], ends[1]);
}

function trailingCandidate(s) {
  const values = norm(s, 'revenueQ'), ends = periodEnds(s, 'revenueQ');
  if (values.length < 8 || !values.slice(0, 8).every(Number.isFinite)) {
    return missing('Für V2 fehlen acht vollständige Quartalswerte; kein Ersatz durch einen Jahreswert.');
  }
  if (!jahresFensterAusgerichtet(s, 'revenueQ', 4) || ends.slice(0, 8).some((end, i) => {
    if (i === 0 || !end || !ends[i - 1]) return false;
    return Math.abs((_tagesnummer(ends[i - 1]) - _tagesnummer(end)) - 365 / 4) > JAHRESVERGLEICH_TOLERANZ_TAGE;
  })) return missing('Die acht Quartale bilden keine lückenlosen vergleichbaren Jahresfenster.');
  if (!currenciesMatch(s, 'timeseries', 'revenueQ', [0, 1, 2, 3, 4, 5, 6, 7])) {
    return missing('Die Währungen der acht Quartalswerte stimmen nicht überein.');
  }
  const sum = start => values.slice(start, start + 4).reduce((a, b) => a + b, 0);
  const reported = s?.timeseries?.reportedRevenueQEnds;
  const labels = Array.isArray(reported) && reported.length === values.length ? reported : [];
  return candidate('ttm', sum(0), sum(4), iso(labels[0]) || ends[0], iso(labels[4]) || ends[4], ends[0], ends[4]);
}

/** Build both G31 growth variants (v1 is the production candidate of the G31 switch); no snapshot is changed.
 * @param {object|null} s Prepared snapshot.
 * @returns {object} v1/v2 growth, basis, period, and German missing reasons plus bonus components.
 */
function g31Shadow(s) {
  const annual = annualCandidate(s), quarter = quarterCandidate(s);
  const newerAnnual = annual.pct !== null && quarter.pct !== null && annual.sourcePeriodEnd && quarter.sourcePeriodEnd
    && annual.sourcePeriodEnd > quarter.sourcePeriodEnd;
  const v1 = quarter.pct === null || newerAnnual ? annual : quarter;
  const v2 = trailingCandidate(s);
  // Fractions from the operands (the legacy expression), so an unchanged pair stays bit-identical.
  const components = leg => [annual, leg].filter(c => c.pct !== null).map(c => c.current / c.prior - 1);
  return { v1: { ...v1, bonusComponents: components(quarter) },
    v2: { ...v2, bonusComponents: v2.pct === null ? [] : components(v2) } };
}

/** Evidence table of checked review hints (configs/g31-hinweise.json, P268 primary-source check): bound to one
 * listing and to the exact source ends of the shown pair, so it lapses by itself when a newer quarter arrives.
 * Diagnostic only; a wrong value is held through the financial hand table, never here.
 * @param {object} table Parsed table.
 * @returns {Array<object>} Validated entries.
 */
function loadHinweisTable(table) {
  if (table?.schemaVersion !== 1 || !table.revision || !Array.isArray(table.entries)) throw new Error('Invalid G31 hint table');
  const seen = new Set();
  for (const e of table.entries) {
    const key = `${e?.ticker}|${e?.periodEnd}|${e?.priorPeriodEnd}`;
    if (!e?.ticker || iso(e.periodEnd) !== e.periodEnd || iso(e.priorPeriodEnd) !== e.priorPeriodEnd || !['uebernahme', 'saisonbasis'].includes(e.code)
        || typeof e.reason !== 'string' || !e.reason || !Array.isArray(e.sources) || !e.sources.length
        || e.sources.some(src => typeof src?.url !== 'string' || !src.url.startsWith('http') || !src.page || !src.quote) || seen.has(key)) {
      throw new Error('Invalid G31 hint entry: ' + key);
    }
    seen.add(key);
  }
  return table.entries;
}
const HINWEISE = loadHinweisTable(require('../configs/g31-hinweise.json'));

const pctDe = x => (Math.round(x * 1000) / 10).toLocaleString('de-DE', { maximumFractionDigits: 1 }) + ' %';
const dayDe = d => `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}`;

/** Review hint for the shown interim growth pair (P267 rule 1, master decision 18.10.2026). Diagnostic only: it never
 * blocks or changes a value; hard holds come only from hand-table rows with evidence. A checked entry of the hint
 * table for exactly this pair wins. Otherwise only a newly admitted B1 pair is examined: dated, with an empty
 * quarter between its endpoints (the pre-G31 gap rule rejected it). A is the positive revenue of the matching full
 * fiscal year: its end lies on or after the year-ago end and before the current end, the year-ago period ends after
 * the previous fiscal-year end, both years pass the existing adjacency check and no explicit currency marker
 * disagrees. Hints: current > 0.75 x A, year-ago < A / 16, or the stored quarters of that fiscal year summing to
 * more than 1.25 x A (mixed bases, Codex's consistency check).
 * @param {object|null} s Prepared snapshot.
 * @returns {object|null} {code, reason} or null.
 */
function g31Hinweis(s) {
  const leg = g31Shadow(s).v1;
  if (!['quarter', 'halfYear'].includes(leg.basis) || !leg.sourcePeriodEnd || !leg.sourcePriorPeriodEnd) return null;
  const checked = HINWEISE.find(e => e.ticker === s?.meta?.ticker && e.periodEnd === leg.sourcePeriodEnd && e.priorPeriodEnd === leg.sourcePriorPeriodEnd);
  if (checked) return { code: checked.code, reason: checked.reason };
  const values = norm(s, 'revenueQ'), pair = jahresVergleichIdx(s, 'revenueQ', 0), qEnds = periodEnds(s, 'revenueQ');
  if (!pair || pair.quelle !== 'datum' || values.slice(0, pair.idx + 1).every(Number.isFinite)) return null;
  const annual = norm(s, 'annualRev'), ends = annualPeriodEnds(s, 'annualRev');
  const marks = (container, field, i) => {
    const row = s?.[container]?.[field]?.[i];
    return [row?.currency, row?.currencyUnit].filter(v => typeof v === 'string');
  };
  for (let k = 0; k + 1 < annual.length; k++) {
    const end = ends[k], previous = ends[k + 1];
    if (!(annual[k] > 0) || !end || !previous) continue;
    if (!(end >= leg.sourcePriorPeriodEnd && end < leg.sourcePeriodEnd && leg.sourcePriorPeriodEnd > previous)) continue;
    if (checkAnnualPair(s, 'annualRev', k, k + 1).code !== 'adjacent') continue;
    if (new Set([...marks('timeseries', 'revenueQ', 0), ...marks('timeseries', 'revenueQ', pair.idx), ...marks('annual', 'annualRev', k)]).size > 1) continue;
    const share = leg.current / annual[k], priorShare = leg.prior / annual[k];
    const inYear = values.filter((v, i) => Number.isFinite(v) && iso(qEnds[i]) && iso(qEnds[i]) > previous && iso(qEnds[i]) <= end);
    const sumShare = inYear.length >= 2 ? inYear.reduce((a, b) => a + b, 0) / annual[k] : null;
    const flags = [share > 0.75 && ['aktuell-gross', `das neueste ${leg.basis === 'halfYear' ? 'Halbjahr' : 'Quartal'} entspricht ${pctDe(share)} des Jahresumsatzes (Hinweisgrenze 75 %)`],
      priorShare < 1 / 16 && ['vorjahr-klein', `der Vorjahreswert entspricht nur ${pctDe(priorShare)} des Jahresumsatzes (Hinweisgrenze 6,25 %)`],
      sumShare !== null && sumShare > 1.25 && ['quartalssumme', `die gespeicherten Quartale dieses Geschäftsjahres ergeben zusammen ${pctDe(sumShare)} des Jahresumsatzes (Hinweisgrenze 125 %), die Reihe mischt wahrscheinlich Basen`]]
      .filter(Boolean);
    if (!flags.length) return null;
    return { code: flags.map(x => x[0]).join('+'),
      reason: `Prüfhinweis zum Geschäftsjahr bis ${dayDe(end)}: ${flags.map(x => x[1]).join('; ').replace(/^./, c => c.toUpperCase())}. Der Wert ist nicht gesperrt und nicht gegen den Firmenbericht geprüft.` };
  }
  return null;
}

function compactPeriod(leg) {
  const out = { basis: leg.basis, periodEnd: leg.periodEnd };
  const prior = leg.periodEnd ? `${Number(leg.periodEnd.slice(0, 4)) - 1}${leg.periodEnd.slice(4)}` : null;
  if (leg.priorPeriodEnd !== prior) out.priorPeriodEnd = leg.priorPeriodEnd;
  if (leg.sourcePeriodEnd !== leg.periodEnd) out.sourcePeriodEnd = leg.sourcePeriodEnd;
  if (leg.sourcePriorPeriodEnd !== leg.priorPeriodEnd) out.sourcePriorPeriodEnd = leg.sourcePriorPeriodEnd;
  if (leg.reason) out.reason = leg.reason;
  return out;
}

/** Project additive export candidates, isolating every shadow failure from live fields.
 * @param {object|null} s Prepared snapshot from either snapshot store.
 * @returns {object} Compact growth and overview shadows; failures carry null and a German reason.
 */
function g31Export(s) {
  try {
    const growth = g31Shadow(s), g31ShadowExport = {};
    for (const variant of ['v1', 'v2']) {
      const leg = growth[variant];
      if (variant === 'v2' && leg.pct === null) continue;
      g31ShadowExport[variant] = { pct: leg.pct, ...compactPeriod(leg) };
    }
    const { overviewShadow } = require('../src/scoring/overview.js');
    const g31Overview = {};
    for (const kind of ['gp', 'revenue-badge']) {
      const shadow = overviewShadow(s, kind);
      g31Overview[kind] = { value: shadow.value, period: compactPeriod(shadow.period) };
    }
    return { g31Shadow: g31ShadowExport, g31Overview, g31Hinweis: g31Hinweis(s) };
  } catch {
    const reason = 'G31-Schatten nicht verfügbar: Berechnung fehlgeschlagen.';
    return { g31Shadow: { v1: null, reason },
      g31Overview: { gp: { value: null, reason }, 'revenue-badge': { value: null, reason } }, g31Hinweis: null };
  }
}

// Additive G31 keys, kept behind every older key in this order: the comparison fields of the
// switch (18.10.2026, at most four weeks), then the two P184 shadows.
const G31_TRAILING_KEYS = Object.freeze(['overviewPeriod', 'revGrowthYoYPctLegacy', 'revGrowthBasisLegacy', 'revGrowthPeriodEndLegacy',
  'revGrowthPriorPeriodEndLegacy', 'overviewValueLegacy', 'overviewPeriodLegacy', 'g31Hinweis', 'g31Shadow', 'g31OverviewShadow']);

/** Append only G31 fields after every older key, preserving the older key order.
 * @param {object} row Export row, modified in place.
 * @returns {object} The same row with its additive G31 fields last.
 */
function g31Last(row) {
  for (const key of G31_TRAILING_KEYS) {
    if (!Object.hasOwn(row, key)) continue;
    const value = row[key]; delete row[key]; row[key] = value;
  }
  return row;
}

module.exports = { g31Variant, withG31Variant, quarterCandidate, g31Shadow, g31Export, g31Hinweis, currenciesMatch, g31Last, G31_TRAILING_KEYS };

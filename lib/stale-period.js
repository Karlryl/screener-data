'use strict';
// Stufe 4 (22.11.2026, G31 with G2): a board row whose shown period is older than a newer period that is demonstrably
// published (a stored quarter with a value, or Yahoo's meta.mostRecentQuarter) says so with a fixed reason code.
// Label only: no value, score, rank or membership reads it, and nothing is guessed for the newer period.
const fs = require('fs');
const { norm, periodEnds, jahresVergleichIdx } = require('../src/scoring/snapshot.js');

const DAY = 864e5;
// Fiscal quarter ends drift by a few days (27.09. against 30.09.), the next period is about 90 days later. Same slack as the
// existing hint `neuerer-bericht` (scripts/write-findash-export.js newerReportHint), which reads newestPublished() too.
const NEWER_PERIOD_DAYS = 45;
// A report the calendar still expects after the data day, at most this long after Yahoo's date, is taken as the report of that
// period (ZEG.L on 21.11.2026: Yahoo 30.09.2026, report due 24.11.2026). Measured on 21.11.2026 over every Yahoo date with a
// calendar date after the data day: 4 lie 54 to 58 days later (the report of that period), the next at 99 days and more (the report
// of the following period, US banks 106, Korea 117 to 128, after a Q3 report already out in October). Quarterly reports are due
// within about 60 days, half-year reports within three months; an annual report later than 95 days is not caught (ceiling).
const REPORT_LAG_DAYS = 95;
// A calendar report date this many days after a shown period end is the report of a later period (newerPeriodLabel, evidence kalender).
const CALENDAR_LATER_DAYS = 105;

/** Fixed reason list: code -> [compact code of the filter feed, German reason (subordinate clause after "weil")]. */
const REASONS = Object.freeze({
  'vorjahr-fehlt': ['vf', 'das Vorjahresquartal in den Anbieterdaten fehlt'],
  boersenabgleich: ['ba', 'das Vorjahresquartal in den Anbieterdaten fehlt und der Börsenabgleich bei einem älteren Quartal eine Abweichung von der Börsenmeldung findet'],
  'vorjahr-zurueckgehalten': ['vz', 'unsere Datenprüfung das Vorjahresquartal des Anbieters zurückhält'],
  'vorjahr-nicht-positiv': ['vn', 'der Vorjahreswert des Anbieters null oder negativ ist und sich daraus kein Wachstum in Prozent rechnen lässt'],
  'paar-gesperrt': ['pg', 'der Vorjahresvergleich in den Anbieterdaten eine Datenprüfung nicht besteht'],
  'anbieter-verzug': ['av', 'die Quartalswerte des Anbieters noch nicht so weit reichen'],
  'wert-zurueckgehalten': ['wz', 'unsere Datenprüfung den neuesten Quartalswert des Anbieters zurückhält'],
  'quartale-zu-alt': ['qa', 'die Quartalswerte des Anbieters zu alt sind und deshalb nicht verwendet werden'],
  'nur-jahreswerte': ['nj', 'der Anbieter dafür nur Jahreswerte liefert'],
  'fcf-ttm-alt': ['fa', 'die Zwölfmonatswerte des Free Cashflow noch nicht so weit reichen'],
});
/** Labelled fields: export key -> German name. */
const FIELDS = Object.freeze({ revGrowth: 'Umsatzwachstum', grossProfit: 'Bruttogewinn-Wachstum', fcfMargin: 'FCF-Marge' });

const day = d => {
  if (typeof d !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(d)) return null;
  const t = Date.parse(d.slice(0, 10) + 'T00:00:00Z');
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === d.slice(0, 10) ? d.slice(0, 10) : null;
};
const after = (a, b) => Date.parse(a) - Date.parse(b) > NEWER_PERIOD_DAYS * DAY;

/**
 * Newest period end that our data prove published: Yahoo's meta.mostRecentQuarter or the newest stored quarter with a value.
 * A stored end is rounded to the month end (AEHR: stored 30.09.2026, reported 25.09.2026), so it beats Yahoo's exact date only
 * when it lies more than NEWER_PERIOD_DAYS later. A date after the data day is not published and is dropped, and so is Yahoo's date
 * when the report calendar still expects the report of that period after the data day (REPORT_LAG_DAYS).
 * @param {object|null} meta Snapshot meta (mostRecentQuarter).
 * @param {string|null} storedQuarterEnd Newest stored quarter end with a value.
 * @param {string|null} [today] Data day (ISO); null = no upper bound and no calendar check.
 * @param {string|null} [nextReport] Report date of earnings-calendar.json for this ticker (reportCalendar()).
 * @returns {{end:string, evidence:string}|null} evidence `quarter` (a stored value carries the period) or `yahoo` (date only).
 */
function newestPublished(meta, storedQuarterEnd, today = null, nextReport = null) {
  const bound = day(today), ok = d => d && (!bound || d <= bound) ? d : null, next = day(nextReport);
  let yahoo = ok(day(meta?.mostRecentQuarter));
  const stored = ok(day(storedQuarterEnd));
  if (yahoo && bound && next > bound && Date.parse(next) - Date.parse(yahoo) <= REPORT_LAG_DAYS * DAY) yahoo = null;
  const end = yahoo && stored ? (after(stored, yahoo) ? stored : yahoo) : yahoo || stored;
  if (!end) return null;
  return { end, evidence: stored && !after(end, stored) ? 'quarter' : 'yahoo' };
}

// Newest stored quarter end with a value, read exactly like derivations.neuestesQuartal of scripts/write-findash-export.js,
// so this label and the hint `neuerer-bericht` name the same date.
function newestValued(s, field) {
  const ends = s?.timeseries?.[field + 'Ends'] || [], cells = s?.timeseries?.[field] || [];
  return ends.filter((e, i) => typeof e === 'string' && Number.isFinite(typeof cells[i] === 'number' ? cells[i] : cells[i]?.value)).sort().at(-1) ?? null;
}

// A cell our own rules hold back (hand table, zero guard, exchange check, the age mask series-stale) keeps the vendor row in
// financialMissing.originalVendorRow: that is a value the vendor delivered, not a vendor gap.
function vendorValue(cell, depth = 0) {
  const v = typeof cell === 'number' ? cell : cell?.value;
  if (Number.isFinite(v)) return v;
  const original = cell?.financialMissing?.originalVendorRow;
  return original != null && depth < 8 ? vendorValue(original, depth + 1) : null;
}

// Why the quarterly series `field` has no shown pair at `end`. Order: no usable value at that period (age mask, our hold, vendor
// behind, annual only), then the year-ago quarter (our hold, not positive, another check, absent).
function seriesCode(s, field, end) {
  const values = norm(s, field), ends = periodEnds(s, field).map(day), rows = s?.timeseries?.[field] || [];
  const near = i => !!ends[i] && Math.abs(Date.parse(ends[i]) - Date.parse(end)) <= NEWER_PERIOD_DAYS * DAY;
  const held = i => !Number.isFinite(values[i]) && Number.isFinite(vendorValue(rows[i]));
  const k = values.findIndex((v, i) => near(i) && Number.isFinite(v));
  if (k < 0) {
    if (rows.some(c => c?.financialMissing?.reasonCode === 'series-stale')) return 'quartale-zu-alt';
    if (values.some((v, i) => near(i) && held(i))) return 'wert-zurueckgehalten';
    return values.some((v, i) => Number.isFinite(v) || held(i)) ? 'anbieter-verzug' : 'nur-jahreswerte';
  }
  const pair = jahresVergleichIdx(s, field, k);
  if (pair && pair.idx < values.length) {
    if (Number.isFinite(values[pair.idx])) return values[pair.idx] > 0 ? 'paar-gesperrt' : 'vorjahr-nicht-positiv';
    if (held(pair.idx)) return 'vorjahr-zurueckgehalten';
  }
  return field === 'revenueQ' && exchangeDeviates(s) ? 'boersenabgleich' : 'vorjahr-fehlt';
}

// The exchange cross-check (lib/exchange-quarter-check.js, its own verdict, mode unchanged) finds a vendor quarter of this listing
// that deviates from the exchange filing (would-withhold*); G31 then also keeps the older quarter pair closed. Read the same way as
// lib/g31-recency.js exchangeWithholds (GQS-00 sealed, so not changed here); CN/TW listings only, fails closed to false.
function exchangeDeviates(s) {
  if (!/\.(SS|SZ|TW|TWO)$/.test(s?.meta?.ticker || '')) return false;
  try {
    const X = require('./exchange-quarter-check.js'), { withoutOlderPair } = require('./g31-recency.js');
    return /^would-withhold/.test(withoutOlderPair(() => X.evaluate(X.stripOwn(s), X.defaultContext()))?.category || '');
  } catch { return false; }
}

/**
 * Snapshot facts for the label, computed once per snapshot: the newest published period and, per quarterly series, why it
 * carries no shown pair. Compact on purpose (writers cache it per ticker).
 * @param {object|null} s Prepared snapshot (prepareSnapshot), the one the board reads.
 * @param {string|null} [today] Data day (ISO).
 * @param {string|null} [nextReport] Report date of earnings-calendar.json for this ticker (reportCalendar()).
 * @returns {{end:(string|null), evidence:(string|null), codes:(object|null), calendar:(object|null)}|null} null without any evidence.
 *   `calendar` (23.11.2026): a report date of earnings-calendar.json on or before the data day, with the series codes at that date.
 */
function newerPeriodFacts(s, today = null, nextReport = null) {
  if (!s) return null;
  const pub = newestPublished(s.meta, newestValued(s, 'revenueQ'), today, nextReport);
  const bound = day(today), due = day(nextReport);
  const calendar = bound && due && due <= bound
    ? { date: due, codes: { revGrowth: seriesCode(s, 'revenueQ', due), grossProfit: seriesCode(s, 'grossProfitQ', due) } } : null;
  if (!pub && !calendar) return null;
  return { end: pub ? pub.end : null, evidence: pub ? pub.evidence : null,
    codes: pub ? { revGrowth: seriesCode(s, 'revenueQ', pub.end), grossProfit: seriesCode(s, 'grossProfitQ', pub.end) } : null, calendar };
}

const deDay = iso => iso.split('-').reverse().join('.');
function sentence(fields) {
  const byCode = new Map();
  for (const [key, code] of Object.entries(fields)) byCode.set(code, [...(byCode.get(code) || []), FIELDS[key]]);
  return [...byCode].map(([code, names]) => `${names.join(' und ')}, weil ${REASONS[code][1]}`).join('; ');
}

/**
 * The export label: every shown period end more than NEWER_PERIOD_DAYS before the newest published period gets its code.
 * Without such a period (23.11.2026, evidence `kalender`): a report the calendar expected on or before the data day and more than
 * CALENDAR_LATER_DAYS after a shown period end is the report of a later period, so that shown value is older than a report that is
 * due; the label then names the report date, not a period end (none is known). Yahoo or stored evidence wins: the calendar is read
 * only when it labels no field.
 * ponytail: one cut for every basis. Measured on 21.11.2026 (all v1 files): the 96 to 105 day range held the report of the shown
 * period itself (GDS.PA final annual results 06.10. for the year to 30.06., 98 days; EXA.PA postponed half-year report 09.10.,
 * 101 days), from 106 days every sampled case was a later period (NVDA, ROST, WMT, ENI.MI, DELTA.BK); no year-basis board row lay
 * at 106 to 125 days. Ceiling: an annual or half-year report later than 105 days is labelled wrongly; if that shows up, pass the
 * shown basis and use a longer cut for year and half-year periods.
 * @param {object|null} facts newerPeriodFacts() of the row's snapshot.
 * @param {{revGrowth?:string|null, grossProfit?:string|null, fcfMargin?:string|null}} shown Shown period ends (display ends).
 * @returns {{end:string, evidence:string, fields:object, hint:string}|null} null when every shown period is current.
 */
function newerPeriodLabel(facts, shown) {
  if (!facts) return null;
  const pick = (stale, codes) => {
    const fields = {};
    for (const key of Object.keys(FIELDS)) {
      const end = day(shown?.[key]);
      if (end && stale(end)) fields[key] = key === 'fcfMargin' ? 'fcf-ttm-alt' : codes[key];
    }
    return Object.keys(fields).length ? fields : null;
  };
  const fields = facts.end ? pick(end => after(facts.end, end), facts.codes) : null;
  if (fields) {
    return { end: facts.end, evidence: facts.evidence, fields,
      hint: `Neuerer Zeitraum ${facts.evidence === 'yahoo' ? 'laut Yahoo ' : ''}veröffentlicht (bis ${deDay(facts.end)}), hier noch nicht verwendet: ${sentence(fields)}.` };
  }
  const cal = facts.calendar;
  const due = cal ? pick(end => Date.parse(cal.date) - Date.parse(end) > CALENDAR_LATER_DAYS * DAY, cal.codes) : null;
  if (!due) return null;
  return { end: cal.date, evidence: 'kalender', fields: due,
    hint: `Neuerer Bericht laut Termin-Kalender am ${deDay(cal.date)} erwartet, hier noch nicht verwendet: ${sentence(due)}.` };
}

/**
 * Report dates per ticker from earnings-calendar.json ({ticker: {date}}), read once on first use. A missing or broken file warns
 * once and checks nothing (the label then rests on Yahoo's date alone).
 * @param {string} file Path of earnings-calendar.json.
 * @returns {function(string): (string|null)} Lookup ticker -> report date.
 */
function reportCalendar(file) {
  let table;
  return ticker => {
    if (table === undefined) {
      try { table = JSON.parse(fs.readFileSync(file, 'utf8')) || {}; }
      catch (e) { table = {}; console.warn(`::warning::[stale-period] ${file}: ${e.message}; Yahoo-only periods are not checked against the report calendar.`); }
    }
    return typeof table[ticker]?.date === 'string' ? table[ticker].date : null;
  };
}

// Compact feed string: end, `y` when only Yahoo's date carries it or `k` when it is the calendar's report date (23.11.2026), then
// the growth and the FCF code (empty when that field is current).
const COMPACT = /^(\d{4}-\d{2}-\d{2})([yk]?):([a-z]{2})?:([a-z]{2})?$/;
const EVIDENCE_FLAG = Object.freeze({ quarter: '', yahoo: 'y', kalender: 'k' });
/**
 * Compact form for the filter feed (byte budget): one string `<end>[y|k]:<g code>:<f code>`, for example `2026-09-30:vf:`,
 * `2026-09-30y:nj:fa` or `2026-11-05k:av:`; decodeNewerPeriod() reads it back through REASONS.
 * @param {object|null} label newerPeriodLabel() result (fields revGrowth and fcfMargin only).
 * @returns {string|null} Compact label or null.
 */
function compactNewerPeriod(label) {
  if (!label) return null;
  const code = key => (label.fields[key] ? REASONS[label.fields[key]][0] : '');
  return `${label.end}${EVIDENCE_FLAG[label.evidence]}:${code('revGrowth')}:${code('fcfMargin')}`;
}
/**
 * Decodes the compact feed string.
 * @param {*} x Exported `np`.
 * @returns {{end:string, evidence:string, fields:object}|null} null when it is not a valid compact label.
 */
function decodeNewerPeriod(x) {
  const m = typeof x === 'string' ? COMPACT.exec(x) : null;
  if (!m || day(m[1]) !== m[1] || (!m[3] && !m[4])) return null;
  const byCompact = new Map(Object.entries(REASONS).map(([code, r]) => [r[0], code])), fields = {};
  for (const [key, c] of [['revGrowth', m[3]], ['fcfMargin', m[4]]]) {
    if (!c) continue;
    if (!byCompact.has(c)) return null;
    fields[key] = byCompact.get(c);
  }
  return { end: m[1], evidence: m[2] === 'y' ? 'yahoo' : m[2] === 'k' ? 'kalender' : 'quarter', fields };
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
/**
 * Shape check of an exported label, full (`newerPeriod`) or compact (`np`); null is valid (no label).
 * @param {*} x Exported value.
 * @param {boolean} [compact] Check the compact filter form.
 * @returns {boolean} Whether the value fits the contract.
 */
function validNewerPeriod(x, compact = false) {
  if (x === null) return true;
  if (compact) return decodeNewerPeriod(x) !== null;
  if (!x || typeof x !== 'object' || Array.isArray(x)) return false;
  const f = x.fields;
  return Object.keys(x).join() === 'end,evidence,fields,hint' && ISO.test(x.end) && day(x.end) === x.end && Object.hasOwn(EVIDENCE_FLAG, x.evidence)
    && !!f && typeof f === 'object' && Object.keys(f).length > 0 && Object.entries(f).every(([k, c]) => Object.hasOwn(FIELDS, k) && Object.hasOwn(REASONS, c))
    && typeof x.hint === 'string' && x.hint.startsWith(x.evidence === 'kalender' ? 'Neuerer Bericht laut Termin-Kalender ' : 'Neuerer Zeitraum ');
}

module.exports = { NEWER_PERIOD_DAYS, REPORT_LAG_DAYS, CALENDAR_LATER_DAYS, REASONS, FIELDS, newestPublished, newerPeriodFacts, newerPeriodLabel, reportCalendar,
  compactNewerPeriod, decodeNewerPeriod, validNewerPeriod };

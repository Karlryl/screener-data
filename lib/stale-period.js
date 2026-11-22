'use strict';
// Stufe 4 (22.11.2026, G31 with G2): a board row whose shown period is older than a newer period that is demonstrably
// published (a stored quarter with a value, or Yahoo's meta.mostRecentQuarter) says so with a fixed reason code.
// Label only: no value, score, rank or membership reads it, and nothing is guessed for the newer period.
const { norm, periodEnds, jahresVergleichIdx } = require('../src/scoring/snapshot.js');

const DAY = 864e5;
// Fiscal quarter ends drift by a few days (27.09. against 30.09.), the next period is about 90 days later. Same slack as the
// existing hint `neuerer-bericht` (scripts/write-findash-export.js newerReportHint), which reads newestPublished() too.
const NEWER_PERIOD_DAYS = 45;

/** Fixed reason list: code -> [compact code of the filter feed, German reason (subordinate clause after "weil")]. */
const REASONS = Object.freeze({
  'vorjahr-fehlt': ['vf', 'das Vorjahresquartal in den Anbieterdaten fehlt'],
  boersenabgleich: ['ba', 'das Vorjahresquartal in den Anbieterdaten fehlt und der Börsenabgleich bei einem älteren Quartal eine Abweichung zur Börsenmeldung findet'],
  'paar-gesperrt': ['pg', 'der Vorjahresvergleich in den Anbieterdaten eine Datenprüfung nicht besteht'],
  'anbieter-verzug': ['av', 'die Quartalswerte des Anbieters noch nicht so weit reichen'],
  'nur-jahreswerte': ['nj', 'der Anbieter dafür nur Jahreswerte liefert'],
  'fcf-ttm-alt': ['fa', 'die Zwölfmonatswerte des Free Cashflow noch nicht so weit reichen'],
});
/** Labelled fields: export key -> [compact key of the filter feed, German name]. */
const FIELDS = Object.freeze({ revGrowth: ['g', 'Umsatzwachstum'], grossProfit: ['gp', 'Bruttogewinn-Wachstum'], fcfMargin: ['f', 'FCF-Marge'] });

const day = d => {
  if (typeof d !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(d)) return null;
  const t = Date.parse(d.slice(0, 10) + 'T00:00:00Z');
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === d.slice(0, 10) ? d.slice(0, 10) : null;
};
const after = (a, b) => Date.parse(a) - Date.parse(b) > NEWER_PERIOD_DAYS * DAY;

/**
 * Newest period end that our data prove published: Yahoo's meta.mostRecentQuarter or the newest stored quarter with a value.
 * A stored end is rounded to the month end (AEHR: stored 30.09.2026, reported 25.09.2026), so it beats Yahoo's exact date only
 * when it lies more than NEWER_PERIOD_DAYS later. A date after the data day is not published and is dropped.
 * @param {object|null} meta Snapshot meta (mostRecentQuarter).
 * @param {string|null} storedQuarterEnd Newest stored quarter end with a value.
 * @param {string|null} [today] Data day (ISO); null = no upper bound.
 * @returns {{end:string, evidence:string}|null} evidence `quarter` (a stored value carries the period) or `yahoo` (date only).
 */
function newestPublished(meta, storedQuarterEnd, today = null) {
  const bound = day(today), ok = d => d && (!bound || d <= bound) ? d : null;
  const yahoo = ok(day(meta?.mostRecentQuarter)), stored = ok(day(storedQuarterEnd));
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

// Why the quarterly series `field` has no shown pair at `end`. Order: no value at that period, no year-ago value, any other check.
function seriesCode(s, field, end) {
  const values = norm(s, field), ends = periodEnds(s, field).map(day);
  const k = ends.findIndex((e, i) => e && Number.isFinite(values[i]) && Math.abs(Date.parse(e) - Date.parse(end)) <= NEWER_PERIOD_DAYS * DAY);
  if (k < 0) return values.some(Number.isFinite) ? 'anbieter-verzug' : 'nur-jahreswerte';
  const pair = jahresVergleichIdx(s, field, k);
  if (pair && pair.idx < values.length && Number.isFinite(values[pair.idx])) return 'paar-gesperrt';
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
 * @returns {{end:string, evidence:string, codes:{revGrowth:string, grossProfit:string}}|null} null without any evidence.
 */
function newerPeriodFacts(s, today = null) {
  if (!s) return null;
  const pub = newestPublished(s.meta, newestValued(s, 'revenueQ'), today);
  if (!pub) return null;
  return { ...pub, codes: { revGrowth: seriesCode(s, 'revenueQ', pub.end), grossProfit: seriesCode(s, 'grossProfitQ', pub.end) } };
}

/**
 * The export label: every shown period end more than NEWER_PERIOD_DAYS before the newest published period gets its code.
 * @param {object|null} facts newerPeriodFacts() of the row's snapshot.
 * @param {{revGrowth?:string|null, grossProfit?:string|null, fcfMargin?:string|null}} shown Shown period ends (display ends).
 * @returns {{end:string, evidence:string, fields:object, hint:string}|null} null when every shown period is current.
 */
function newerPeriodLabel(facts, shown) {
  if (!facts) return null;
  const fields = {};
  for (const key of Object.keys(FIELDS)) {
    const end = day(shown?.[key]);
    if (end && after(facts.end, end)) fields[key] = key === 'fcfMargin' ? 'fcf-ttm-alt' : facts.codes[key];
  }
  if (!Object.keys(fields).length) return null;
  const byCode = new Map();
  for (const [key, code] of Object.entries(fields)) byCode.set(code, [...(byCode.get(code) || []), FIELDS[key][1]]);
  const parts = [...byCode].map(([code, names]) => `${names.join(' und ')}, weil ${REASONS[code][1]}`);
  return { end: facts.end, evidence: facts.evidence, fields,
    hint: `Neuerer Zeitraum ${facts.evidence === 'yahoo' ? 'laut Yahoo ' : ''}veröffentlicht (bis ${facts.end.split('-').reverse().join('.')}), hier noch nicht verwendet: ${parts.join('; ')}.` };
}

/**
 * Compact form for the filter feed (byte budget): {e: end, b: 'q'|'y', g|gp|f: compact code}; findash maps codes via REASONS.
 * @param {object|null} label newerPeriodLabel() result.
 * @returns {object|null} Compact label or null.
 */
function compactNewerPeriod(label) {
  if (!label) return null;
  const out = { e: label.end, b: label.evidence === 'yahoo' ? 'y' : 'q' };
  for (const [key, code] of Object.entries(label.fields)) out[FIELDS[key][0]] = REASONS[code][0];
  return out;
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
  if (!x || typeof x !== 'object' || Array.isArray(x)) return false;
  if (compact) {
    const codes = new Set(Object.values(REASONS).map(r => r[0])), keys = new Set(Object.values(FIELDS).map(f => f[0]));
    const rest = Object.keys(x).filter(k => k !== 'e' && k !== 'b');
    return ISO.test(x.e) && day(x.e) === x.e && ['q', 'y'].includes(x.b) && rest.length > 0 && rest.every(k => keys.has(k) && codes.has(x[k]));
  }
  const f = x.fields;
  return Object.keys(x).join() === 'end,evidence,fields,hint' && ISO.test(x.end) && day(x.end) === x.end && ['quarter', 'yahoo'].includes(x.evidence)
    && !!f && typeof f === 'object' && Object.keys(f).length > 0 && Object.entries(f).every(([k, c]) => Object.hasOwn(FIELDS, k) && Object.hasOwn(REASONS, c))
    && typeof x.hint === 'string' && x.hint.startsWith('Neuerer Zeitraum ');
}

module.exports = { NEWER_PERIOD_DAYS, REASONS, FIELDS, newestPublished, newerPeriodFacts, newerPeriodLabel, compactNewerPeriod, validNewerPeriod };

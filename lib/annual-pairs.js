'use strict';

const { isDeepStrictEqual } = require('node:util');
const { norm, jahresVergleichIdx, JAHR_TAGE, JAHRESVERGLEICH_TOLERANZ_TAGE } = require('../src/scoring/snapshot.js');

// Keep the identical snapshot.js round-trip check here: that source file is sealed.
const MS_PRO_TAG = 86400000;
/** Converts a round-trip validated ISO day to UTC days. @param {*} iso Stored end. @returns {number|null} Day number or null. */
function _tagesnummer(iso) {
  if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return null;
  const t = Date.parse(iso.slice(0, 10) + 'T00:00:00Z');
  if (!Number.isFinite(t)) return null;
  return (new Date(t).toISOString().slice(0, 10) === iso.slice(0, 10)) ? t / MS_PRO_TAG : null;
}

/**
 * Reads aligned annual ends using the same date validation as F-4.
 * @param {object} snapshot Prepared snapshot.
 * @param {string} field Annual value field registered in norm().
 * @returns {Array<string|null>} Valid ISO days, or null at undated positions.
 */
function annualPeriodEnds(snapshot, field) {
  const values = norm(snapshot, field);
  const ends = snapshot && snapshot.annual && snapshot.annual[field + 'Ends'];
  if (!Array.isArray(ends) || ends.length !== values.length) return values.map(() => null);
  return ends.map((end) => _tagesnummer(end) === null ? null : end.slice(0, 10));
}

// P115-M: 16,148 snapshots, CI run 37439518589 (2026-10-06). Of 20,114
// consecutive dated annual pairs, 19,996 are exactly 365/366 days apart (Yahoo
// month ends). None are 337..364 or 367..455. In 300..349: 304 (2 true short
// periods), 335 (1), 336 (2), including ABF.L/ASBFF and 4291.SR 52/53-week
// reporters. Next longer distance is 456 (transition); 77 pairs are >=700.
// 334..397 leaves zero gapless series falsely empty. This tests the DISTANCE
// between year ends, NOT a 357..378-day statement period length.
const ANNUAL_PAIR_MIN_DAYS = 334;
const ANNUAL_PAIR_MAX_DAYS = 397;
const MISSING_YEAR_MIN_DAYS = 700;
// Period gate (Daylauf 7, 24.10.2026, formula draft for the Codex review): a growth pair counts only when its
// two period ends are one year apart. Annual pairs use the P115 window above (334..397 days: 52/53-week years
// and month-end jitter pass, a 91-day REIT "year" or a two-year jump does not). Quarter, half-year and
// four-quarter pairs use the F-4 window of snapshot.js (365 +- 15 = 350..380 days), the window jahresVergleichIdx
// already picks the partner in; the gate states it once more at the pair itself.
// Round 2 (30.10.2026, after Codex's NOT RELEASED on #40): a missing end empties the pair too.
// Round 3 (30.10.2026, Codex on #72): the gate reads only the pair's own ends and durations. The distance to a third stored
// end measures the history, not the period (1729.HK, 8279.HK, ARYN.SW, SIG.AX are full years). A true short or long year
// inside the window is a hand-table hold with a source; the stored labels cannot decide it either (63,478 annual cells of
// 30.10. all say 12M, also NESTLEIND.BO's 15 months to 31.03.2024).
const YOY_PAIR_MIN_DAYS = JAHR_TAGE - JAHRESVERGLEICH_TOLERANZ_TAGE;
const YOY_PAIR_MAX_DAYS = JAHR_TAGE + JAHRESVERGLEICH_TOLERANZ_TAGE;
const PERIOD_GATE_WINDOWS = Object.freeze({
  year: [ANNUAL_PAIR_MIN_DAYS, ANNUAL_PAIR_MAX_DAYS], yearNewerRecord: [ANNUAL_PAIR_MIN_DAYS, ANNUAL_PAIR_MAX_DAYS],
  quarter: [YOY_PAIR_MIN_DAYS, YOY_PAIR_MAX_DAYS], halfYear: [YOY_PAIR_MIN_DAYS, YOY_PAIR_MAX_DAYS], ttm: [YOY_PAIR_MIN_DAYS, YOY_PAIR_MAX_DAYS],
});
const dayDe = (iso) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;

// Comparison of the period gate until 04.12.2026 (Karl's rule: the old formula stays visible as a comparison for at most four
// weeks). Inside withoutPeriodGate the date windows of periodGateReason and the zero-year rule of annualAccelerationGatePasses are
// off; a pair without an end stays empty (the growth label needs an end), and the export reads it for periodGateShadow only. The undated-quarter and duration filters in src/scoring/axes.js stay on (sealed; same as before #72's
// round 2 only where those filters do not decide). Remove with the comparison.
let periodGateOff = false;
/**
 * Runs fn with the period gate off.
 * @param {Function} fn Synchronous calculation.
 * @returns {*} Its result; the previous state is restored on every exit.
 */
function withoutPeriodGate(fn) {
  const previous = periodGateOff;
  periodGateOff = true;
  try { return fn(); } finally { periodGateOff = previous; }
}

/**
 * Period gate: German reason when a growth pair is not two dated periods one year apart.
 * @param {string} basis year or yearNewerRecord (annual window); quarter, halfYear or ttm (year-over-year window).
 * @param {*} end Newer period end of the pair.
 * @param {*} priorEnd Older period end of the pair.
 * @returns {string|null} Reason naming the periods, or null when the pair may be shown.
 */
function periodGateReason(basis, end, priorEnd) {
  if (!Object.hasOwn(PERIOD_GATE_WINDOWS, basis)) throw new TypeError('Period gate: unknown basis ' + basis);
  const window = PERIOD_GATE_WINDOWS[basis];
  const newer = _tagesnummer(end), older = _tagesnummer(priorEnd);
  if (newer === null && older === null) return 'Periodenenden fehlen, der Zeitraum ist nicht belegt; Wachstum nicht gezeigt.';
  if (newer === null) return `Periodenende des neueren Werts fehlt (Vorjahr bis ${dayDe(priorEnd)}); Wachstum nicht gezeigt.`;
  if (older === null) return `Periodenende des Vorjahres fehlt (Zeitraum bis ${dayDe(end)}); Wachstum nicht gezeigt.`;
  if (periodGateOff) return null;
  const days = newer - older;
  if (days >= window[0] && days <= window[1]) return null;
  return `Perioden ${dayDe(end)} und ${dayDe(priorEnd)} liegen ${Math.abs(days)} Tage auseinander, kein Jahrespaar; Wachstum nicht gezeigt.`;
}

// P286, P287 (limits: PR text, before and after on one data day): a figure further behind the data day than this is no current
// figure. Measured on the younger period end only: a year-ago partner is old by nature. An annual pair gets longer, the next
// annual report comes only once a year. The limit day itself still passes. `axis` is the annual anchor of gross profit, acceleration
// and the capital penalty, with the same 550 days as the shown annual figure (Codex R16 and Claude, 04.11.2026): a vendor gap is
// filled with the published year, not bridged by an older one (Energean's 2024 gross profit +68.6 % against a filed -26.3 % for 2025).
const STALE_DAYS = Object.freeze({ quarter: 365, halfYear: 365, ttm: 365, year: 550, yearNewerRecord: 550, axis: 550 });
const STALE_SERIES = Object.freeze([['revenueQ', 'revenueQEnds', 'Quartalsumsatz'], ['grossProfitQ', 'grossProfitQEnds', 'Quartalsbruttogewinn'],
  ['opIncQ', 'opIncQEnds', 'Quartalsbetriebsergebnis']]);
/** The run's frozen date (daily-pull.yml, job scoring). Outside a run there is no data day, so no age rule: tests, tools, the sealed proof. @returns {string|null} ISO day. */
function dataDay() {
  const day = process.env.RUN_DATE_UTC;
  return _tagesnummer(day) === null ? null : day.slice(0, 10);
}
// Codex R16 (04.11.2026): a process that writes board numbers needs its data day, or the age rule is off without a word. The entry
// is the started script; a deliberately historical run says so with AGE_RULE_OFF=1. Each writer calls this first, outside every
// catch (Codex R22: inside prepareSnapshot the error was wrapped and swallowed by the export); the call in maskStaleQuarterSeries
// stays as the second net. ponytail: started scripts only, a writer required from another entry (node -e, a harness) is not seen.
const BOARD_WRITERS = /[\\/](src[\\/]scoring[\\/]run-screener|scripts[\\/]write-(findash-export|excluded-list|rule40-export|filter-universe|bewertung-export|board-history))(?:\.js)?$/i; // with or without .js, any case (Windows)
/**
 * Fails loudly when a board-writing script runs without a valid RUN_DATE_UTC.
 * @param {?string} [entry] Started script, default process.argv[1].
 * @returns {void}
 */
function requireDataDay(entry = process.argv[1]) {
  if (dataDay() !== null || !entry || !BOARD_WRITERS.test(entry) || process.env.AGE_RULE_OFF === '1') return;
  throw new Error(`[age-rule] ${String(entry).split(/[\\/]/).pop()} schreibt Board-Zahlen ohne gültiges RUN_DATE_UTC; ohne Datenstand gilt die Altersregel nicht. Für einen bewusst historischen Lauf AGE_RULE_OFF=1 setzen.`);
}
/**
 * Age rule of one growth pair.
 * @param {string} basis Key of PERIOD_GATE_WINDOWS.
 * @param {*} end Younger period end of the pair.
 * @returns {string|null} German reason, or null when it may count; an undated end has an unknown age and no verdict here.
 */
function staleReason(basis, end) {
  const today = _tagesnummer(dataDay()), newer = _tagesnummer(end);
  if (today === null || newer === null || today - newer <= STALE_DAYS[basis]) return null;
  return `Periodenstand veraltet: Das neueste Wertepaar endet am ${dayDe(end)}, mehr als ${STALE_DAYS[basis]} Tage vor dem Datenstand; Wachstum nicht gezeigt.`;
}
/**
 * P286: a dated quarterly series whose newest value is too old counts as not present in the current view. Each series is judged
 * on its own ends; a series without usable ends has an unknown age and stays. The vendor row stays in the marker, a true zero
 * in a fresh series stays, and nothing is ever replaced by 0.
 * @param {object} snapshot Prepared snapshot.
 * @returns {object} The same object when nothing is stale, otherwise a copy with the stale cells empty.
 */
function maskStaleQuarterSeries(snapshot) {
  requireDataDay();
  const today = _tagesnummer(dataDay());
  if (today === null || !snapshot?.timeseries || sealedEraSnapshot(snapshot)) return snapshot;
  let out = snapshot;
  for (const [field, endsField, label] of STALE_SERIES) {
    const rows = snapshot.timeseries[field], ends = snapshot.timeseries[endsField];
    if (!Array.isArray(rows) || !Array.isArray(ends) || ends.length !== rows.length) continue;
    // The sealed router reads empty revenue as a firm without revenue. Without any annual revenue the old cells stay as the proof that it has
    // some (EYDAP.AT, 364.7 million EUR in 2025, annual cells withheld): no list without revenue, and candidate() still shows no growth from them.
    if (field === 'revenueQ' && !norm(snapshot, 'annualRev').some((v) => Number.isFinite(v) && v !== 0)) continue;
    const value = (row) => (row && typeof row === 'object' ? row.value : row);
    const dated = rows.flatMap((row, i) => (Number.isFinite(value(row)) && _tagesnummer(ends[i]) !== null ? [ends[i].slice(0, 10)] : []));
    if (!dated.length) continue;
    const newest = dated.sort().at(-1);
    if (today - _tagesnummer(newest) <= STALE_DAYS.quarter) continue;
    const reason = `${label} fehlt: Die neueste Zahl dieser Reihe endet am ${dayDe(newest)}, mehr als ${STALE_DAYS.quarter} Tage vor dem Datenstand; Periodenstand veraltet.`;
    const held = rows.map((row, i) => (Number.isFinite(value(row)) ? { value: null, financialMissing: { reasonCode: 'series-stale', reason, period: ends[i] ?? null, originalVendorRow: row } } : row));
    out = { ...out, timeseries: { ...out.timeseries, [field]: held } };
  }
  return out;
}

/**
 * Period gate of one stored annual pair: the one guard for every reader of annualRev, annualGP and the like.
 * @param {object} snapshot Prepared snapshot.
 * @param {string} field Annual field registered in norm().
 * @param {number} iNew Selected newer position.
 * @param {number} iOld Selected older position.
 * @returns {string|null} German reason, or null when the pair may be shown.
 */
function annualPairGateReason(snapshot, field, iNew, iOld) {
  const ends = annualPeriodEnds(snapshot, field);
  return periodGateReason('year', ends[iNew], ends[iOld]) || (sealedEraSnapshot(snapshot) ? null : staleReason('year', ends[iNew]));
}

// The 25 sealed golden fixtures of GQS-00@1.1.0 carry no annual end lists, and verify() needs one of them above a score of 100.
// So the score axes do not judge an undated pair on exactly these snapshots: ticker plus own fetch time, to the millisecond.
// A date alone would also excuse any other old snapshot (Codex on #72, restored stores and replays), so no date rule here.
// tests/period-gate.test.js pins this list against the fixture file. The export warns [period-gate-undated] if a row ever matches.
// Codex on #72 (04.11.2026): ticker and fetch time name a fixture, they do not prove its content. The exemption also needs the
// statements (annual and timeseries) to equal the sealed raw snapshot, read from the fixture file on the first matching name only.
const SEALED_FIXTURES = new Set([
  'ALNY|2026-08-02T15:08:52.192Z', 'BMI|2026-08-08T04:10:34.584Z', 'STB.OL|2026-08-16T12:41:39.603Z',
  'GRGD.TO|2026-07-26T18:46:42.928Z', 'ATHERENERG.NS|2026-07-26T18:45:09.360Z', '278470.KS|2026-08-06T05:54:13.716Z',
  'CHENNPETRO.NS|2026-07-26T18:46:11.385Z', 'VNOM|2026-08-03T06:24:20.672Z', 'GDG.AX|2026-08-04T06:00:46.388Z',
  'LQDA|2026-08-13T04:52:01.338Z', '8996.TW|2026-07-26T18:42:42.284Z', 'QXO|2026-08-04T05:51:26.112Z',
  '3317.HK|2026-07-26T18:39:44.237Z', 'AUGO|2026-08-06T05:54:35.356Z', '2548.TW|2026-08-04T05:56:28.862Z',
  '688256.SS|2026-07-26T18:41:59.247Z', '688110.SS|2026-07-26T18:41:54.109Z', 'DAVE|2026-08-06T05:54:22.510Z',
  'NBIS|2026-08-07T05:00:57.432Z', '002151.SZ|2026-07-26T18:36:37.353Z', 'SJVN.BO|2026-08-04T06:06:43.402Z',
  'XIFR|2026-08-04T05:51:08.383Z', '000002.SZ|2026-07-26T18:36:20.224Z', '000006.SZ|2026-08-04T05:54:42.766Z',
  '001236.SZ|2026-08-04T05:54:59.393Z',
]);
let sealedStatements = null;
/** Whether a snapshot is one of the sealed golden fixtures. @param {object|null} snapshot Snapshot. @returns {boolean} True only for the exact ticker, fetch time and statements. */
function sealedEraSnapshot(snapshot) {
  const id = `${snapshot?.meta?.ticker}|${snapshot?.meta?.fetchedAt}`;
  if (!SEALED_FIXTURES.has(id)) return false;
  if (!sealedStatements) {
    sealedStatements = new Map(require('../protocol/gqs-00/1.1.0/golden-fixtures.json').cases
      .map(({ rawSnapshot: r }) => [`${r.meta.ticker}|${r.meta.fetchedAt}`, { annual: r.annual, timeseries: r.timeseries }]));
  }
  return isDeepStrictEqual({ annual: snapshot.annual, timeseries: snapshot.timeseries }, sealedStatements.get(id));
}

/**
 * Period gate of one stored annual pair on a score axis.
 * @param {object} snapshot Prepared snapshot.
 * @param {string} field Annual field registered in norm().
 * @param {number} iNew Selected newer position.
 * @param {number} iOld Selected older position.
 * @returns {boolean} True when the axis must drop.
 */
function axisPairBlocked(snapshot, field, iNew, iOld) {
  const ends = annualPeriodEnds(snapshot, field);
  if ((_tagesnummer(ends[iNew]) === null || _tagesnummer(ends[iOld]) === null) && sealedEraSnapshot(snapshot)) return false;
  if (iNew === 0 && !sealedEraSnapshot(snapshot) && staleReason('axis', ends[0])) return true; // P287: only the newest anchor is judged for age
  return periodGateReason('year', ends[iNew], ends[iOld]) !== null;
}
let active = { growth: false, acceleration: false };

/**
 * Temporarily enables annual pair checks. Unspecified parts retain their previous state.
 * @param {{growth?:boolean, acceleration?:boolean}} parts Parts to override.
 * @param {Function} fn Synchronous calculation; promises and thenables are rejected.
 * @returns {*} The synchronous result, with the previous state restored even on failure.
 */
function withAnnualPairRule(parts, fn) {
  if (!parts || typeof parts !== 'object' || typeof fn !== 'function'
      || Object.entries(parts).some(([key, value]) => !Object.hasOwn(active, key) || typeof value !== 'boolean')) {
    throw new TypeError('Annual pair rule requires boolean parts and a synchronous function');
  }
  const previous = active;
  let result;
  try {
    active = { ...previous, ...parts };
    result = fn();
  } finally {
    active = previous;
  }
  if (result != null && typeof result.then === 'function') {
    throw new TypeError('Annual pair rule requires a synchronous function, not a thenable');
  }
  return result;
}

/** Reads one rule part; production defaults to false. @param {string} part Part name. @returns {boolean} Whether enabled. */
function annualPairRuleEnabled(part) { return active[part] === true; }

/** Tests a pair verdict without coercing missing data. @param {object} pair Verdict. @returns {boolean} Whether today's pair may pass. */
function annualPairPasses(pair) { return pair.code === 'adjacent' || pair.code === 'undated'; }

function checkEnds(newEnd, oldEnd, priorEnd) {
  const newer = _tagesnummer(newEnd), older = _tagesnummer(oldEnd), prior = _tagesnummer(priorEnd);
  const priorLengthDays = older !== null && prior !== null ? older - prior : null;
  if (newer === null || older === null) return { code: 'undated', distanceDays: null, priorLengthDays };
  const distanceDays = newer - older;
  const code = distanceDays >= MISSING_YEAR_MIN_DAYS ? 'missing-year'
    : distanceDays > ANNUAL_PAIR_MAX_DAYS ? 'long-period'
    : distanceDays < ANNUAL_PAIR_MIN_DAYS ? 'short-period'
    : priorLengthDays !== null && priorLengthDays < ANNUAL_PAIR_MIN_DAYS ? 'short-prior-period'
    : priorLengthDays > ANNUAL_PAIR_MAX_DAYS && priorLengthDays < MISSING_YEAR_MIN_DAYS ? 'long-prior-period'
    : 'adjacent';
  return { code, distanceDays, priorLengthDays };
}

/**
 * Finds the next stored position after duplicates of one fixed annual entry.
 * @param {Array<number|null>} values Annual values normalized by norm().
 * @param {Array<string|null>} ends Aligned annual period ends.
 * @param {number} index Selected older position, retained as the duplicate anchor.
 * @returns {number} First nonduplicate position, or values.length if none remains.
 */
function nextDistinctAnnualIndex(values, ends, index) {
  const older = _tagesnummer(ends[index]);
  let next = index + 1;
  while (Number.isFinite(values[index]) && values[next] === values[index] && older !== null) {
    const prior = _tagesnummer(ends[next]);
    if (prior === null || Math.abs(older - prior) >= ANNUAL_PAIR_MIN_DAYS) break;
    next++;
  }
  return next;
}

/**
 * Judges only the two selected annual positions, never searches for a replacement.
 * @param {object} snapshot Prepared snapshot.
 * @param {string} field Annual field, e.g. annualRev or annualGP.
 * @param {number} iNew Selected newer position.
 * @param {number} iOld Selected older position.
 * @returns {{code:string, distanceDays:number|null, priorLengthDays:number|null}} Date verdict.
 */
function checkAnnualPair(snapshot, field, iNew, iOld) {
  const ends = annualPeriodEnds(snapshot, field);
  return checkEnds(ends[iNew], ends[iOld], ends[nextDistinctAnnualIndex(norm(snapshot, field), ends, iOld)]);
}

/**
 * Judges the existing newer-year record, including its stored prior-year length if dated.
 * @param {object} snapshot Prepared snapshot.
 * @param {object} record Already validated by annualLegNewerYear.
 * @returns {{code:string, distanceDays:number|null, priorLengthDays:number|null}} Date verdict.
 */
function checkNewerAnnualPair(snapshot, record) {
  const ends = annualPeriodEnds(snapshot, 'annualRev');
  const priorDay = _tagesnummer(record.priorEnd);
  const index = priorDay === null ? -1 : ends.findIndex((end) => _tagesnummer(end) === priorDay);
  return checkEnds(record.end, record.priorEnd,
    index < 0 ? null : ends[nextDistinctAnnualIndex(norm(snapshot, 'annualRev'), ends, index)]);
}

const emptyCheck = (code) => ({ code, distanceDays: null, priorLengthDays: null });

// The two pairs of today's annual acceleration fallback, newer pair first; null without three positive years.
function annualAccelerationPairs(snapshot) {
  const values = norm(snapshot, 'annualRev');
  const used = values.map((v, i) => v > 0 ? i : null).filter((i) => i !== null).slice(0, 3);
  if (used.length < 3) return null;
  return used.slice(0, 2).map((iNew, i) => {
    const iOld = used[i + 1];
    const skipped = values.slice(iNew + 1, iOld);
    const zeroIndex = !skipped.includes(null) ? values.findIndex((v, j) => j > iNew && j < iOld && v !== null && v <= 0) : -1;
    const verdict = checkAnnualPair(snapshot, 'annualRev', iNew, iOld);
    return { ...verdict, code: zeroIndex >= 0 ? 'zero-year' : verdict.code, iNew, iOld, zeroIndex };
  });
}

/**
 * Period gate of the annual acceleration fallback: each pair on its own ends, no reported zero year skipped.
 * @param {object} snapshot Prepared snapshot.
 * @returns {boolean} True when the axis may use both pairs.
 */
function annualAccelerationGatePasses(snapshot) {
  const pairs = annualAccelerationPairs(snapshot);
  if (pairs === null) return false;
  // The first used year may sit below a vendor zero or a gap (AGTF.TO: 2025 zero, then 2018): the age is judged there, not only at position 0.
  if (!sealedEraSnapshot(snapshot) && staleReason('axis', annualPeriodEnds(snapshot, 'annualRev')[pairs[0].iNew])) return false;
  return pairs.every((pair) => (periodGateOff || pair.zeroIndex < 0) && !axisPairBlocked(snapshot, 'annualRev', pair.iNew, pair.iOld)); // zero-year rule: part of the gate comparison
}

/**
 * Checks both pairs of today's annual acceleration fallback, newer pair first.
 * @param {object} snapshot Prepared snapshot.
 * @returns {object} First failure, otherwise first verdict, with selected indices for explanation.
 */
function checkAnnualAcceleration(snapshot) {
  const pairs = annualAccelerationPairs(snapshot);
  if (!pairs) return emptyCheck('no-annual-pair');
  // An undated pair passes, but must stay visible for the [period-gate-undated] watcher of the export.
  return pairs.find((pair) => !annualPairPasses(pair)) || pairs.find((pair) => pair.code === 'undated') || pairs[0];
}

// Same branch eligibility as revAcceleration; no quarterly partner or formula is changed. Returns the source of the
// branch: 'position' when a counted pair has no dated partner, 'datum' otherwise, null when the annual fallback carries.
// ponytail: the shadow ignores revAcceleration's 6M against 3M test; no such quarter exists on 30.10. (70,546 cells all 3M).
function quarterlyAccelerationSource(snapshot) {
  const values = norm(snapshot, 'revenueQ');
  let pairs = 0, source = 'datum';
  for (let i = 0; i < values.length; i++) {
    const partner = jahresVergleichIdx(snapshot, 'revenueQ', i);
    if (partner && values[i] > 0 && values[partner.idx] > 0) {
      pairs++;
      if (partner.quelle === 'position') source = 'position';
    }
  }
  return pairs >= 2 ? source : null;
}

function reasonFor(axis, pair, ends, values) {
  const prefix = axis === 'acceleration' ? 'Keine Beschleunigung' : axis === 'grossProfit' ? 'Kein Bruttogewinnwachstum' : 'Kein Jahreswachstum';
  const year = (end) => _tagesnummer(end) === null ? null : end.slice(0, 4);
  const newer = year(ends[pair.iNew ?? 0]), older = year(ends[pair.iOld ?? 1]);
  const months = Math.round(pair.distanceDays / 30.44);
  const priorMonths = Math.round(pair.priorLengthDays / 30.44);
  switch (pair.code) {
    case 'no-snapshot': return 'Kein gespeicherter Datenstand vorhanden, die Jahrespaare sind nicht prüfbar.';
    case 'snapshot-unreadable': return 'Der gespeicherte Datenstand ist nicht lesbar, die Jahrespaare sind nicht prüfbar.';
    case 'no-annual-pair': return 'Die heutige Rechnung bildet für diese Achse kein Jahrespaar, daher ist kein Jahresvergleich zu prüfen.';
    case 'undated': return 'Ohne gültige Periodenenden beim Anbieter ist der Zeitraum nicht belegt; kein Wert.';
    case 'adjacent': return `Benachbarte volle Geschäftsjahre ${newer} und ${older} (${months} Monate).`;
    case 'missing-year': return `${prefix}: Zwischen den Geschäftsjahren ${newer} und ${older} fehlt mindestens ein Jahresende beim Anbieter, der Vergleich ginge über ${months} Monate.`;
    case 'long-period': return `${prefix}: Der Vergleich der Geschäftsjahre ${newer} und ${older} ginge über ${months} Monate und ist zu lang für einen Jahresvergleich.`;
    case 'short-period': return `${prefix}: Der Vergleich der Geschäftsjahre ${newer} und ${older} umfasst nur ${months} Monate und ist ein Rumpfzeitraum.`;
    case 'short-prior-period': return `${prefix}: Das Vorjahr ${older} beim Vergleich ${newer} gegen ${older} ist ein Rumpfzeitraum von ${priorMonths} Monaten.`;
    case 'long-prior-period': return `${prefix}: Das Vorjahr ${older} beim Vergleich ${newer} gegen ${older} umfasst ${priorMonths} Monate und ist kein voller Jahreszeitraum.`;
    case 'zero-year': {
      const zeroYear = year(ends[pair.zeroIndex]);
      return `${prefix}: Der Umsatz ${zeroYear || 'im undatierten übersprungenen Geschäftsjahr'} war ${values[pair.zeroIndex]} (gemeldeter Wert, keine Datenlücke), ein Vergleich über dieses Jahr ist kein Jahresvergleich.`;
    }
    default: throw new Error('Unknown annual pair code: ' + pair.code);
  }
}

/**
 * Builds the additive annualPairsShadow object; never changes the snapshot or scores.
 * @param {object|null} snapshot Prepared snapshot, or null when unavailable.
 * @param {Array<number>|null} bounds Acceleration winsorBounds.qoq from calibration.
 * @param {string} missingCode no-snapshot or snapshot-unreadable when unavailable.
 * @returns {object} Window and three axis verdicts with raw today/shadow values and German reasons.
 */
function annualPairsShadow(snapshot, bounds = null, missingCode = 'no-snapshot') {
  // Deferred dependencies avoid axes -> annual-pairs -> axes initialization cycles.
  const axes = require('../src/scoring/axes.js');
  const { revGrowthLeg } = require('./rev-growth-basis.js');
  return withAnnualPairRule({ growth: false, acceleration: false }, () => {
    const ends = annualPeriodEnds(snapshot, 'annualRev');
    const gpEnds = annualPeriodEnds(snapshot, 'annualGP');
    const values = norm(snapshot, 'annualRev');
    const record = axes.revQuartalsYoY(snapshot) === null ? axes.annualLegNewerYear(snapshot) : null;
    const growth = record ? checkNewerAnnualPair(snapshot, record)
      : axes.revAnnualYoY(snapshot) === null ? emptyCheck('no-annual-pair') : checkAnnualPair(snapshot, 'annualRev', 0, 1);
    const gp = norm(snapshot, 'annualGP');
    const grossProfit = Number.isFinite(gp[0]) && gp[1] > 0 ? checkAnnualPair(snapshot, 'annualGP', 0, 1) : emptyCheck('no-annual-pair');
    const quarterly = quarterlyAccelerationSource(snapshot);
    const acceleration = quarterly === 'position' ? emptyCheck('undated') : quarterly ? emptyCheck('no-annual-pair') : checkAnnualAcceleration(snapshot);
    let accelerationBasis = null;
    const read = () => ({ growth: revGrowthLeg(snapshot).pct, grossProfit: axes.gpGrowth(snapshot),
      acceleration: axes.revAcceleration(snapshot, bounds, basis => { accelerationBasis = basis; }) });
    const today = snapshot ? read() : { growth: null, grossProfit: null, acceleration: null };
    const shadow = snapshot ? withAnnualPairRule({ growth: true, acceleration: true }, read) : today;
    const out = { windowDays: [ANNUAL_PAIR_MIN_DAYS, ANNUAL_PAIR_MAX_DAYS] };
    for (const [axis, verdict, dates] of [
      ['growth', growth, record ? [record.end, record.priorEnd] : ends],
      ['grossProfit', grossProfit, gpEnds], ['acceleration', acceleration, ends],
    ]) {
      const pair = snapshot ? verdict : emptyCheck(missingCode);
      out[axis] = { code: pair.code, reason: reasonFor(axis, pair, dates, values),
        distanceDays: pair.distanceDays, priorLengthDays: pair.priorLengthDays, today: today[axis], shadow: shadow[axis] };
    }
    // Explain the same operands the axes actually used, rather than labelling FY2025 as FY2024.
    const sourced = require('./sourced-annual-years.js').resolveSourcedAnnualYear(snapshot);
    if (sourced.status === 'available') {
      const r = sourced.record;
      if (accelerationBasis === 'sourcedYearRestatedPrior') {
        out.acceleration = { ...out.acceleration, code: 'restated-prior', distanceDays: null, priorLengthDays: null,
          reason: `Keine Beschleunigung: Das Vorjahr ${r.priorEnd.slice(0, 4)} wurde neu dargestellt (restated); ein älteres Umsatzjahr auf derselben Vergleichsbasis ist nicht belegt.` };
      }
      for (const axis of ['grossProfit', ...(accelerationBasis === 'sourcedYear' ? ['acceleration'] : [])]) {
        if (today[axis] === null) continue;
        const priorEnds = axis === 'grossProfit' ? gpEnds : ends;
        out[axis] = { ...out[axis], code: 'adjacent',
          reason: `Geprüfter Abschluss ${r.end.slice(0, 4)} gegen ${r.priorEnd.slice(0, 4)}; die Anbieterreihe endet noch im Vorjahr.`,
          distanceDays: _tagesnummer(r.end) - _tagesnummer(r.priorEnd),
          priorLengthDays: priorEnds[0] && priorEnds[1] ? _tagesnummer(priorEnds[0]) - _tagesnummer(priorEnds[1]) : null };
      }
    }
    return out;
  });
}

module.exports = { ANNUAL_PAIR_MIN_DAYS, ANNUAL_PAIR_MAX_DAYS, MISSING_YEAR_MIN_DAYS, YOY_PAIR_MIN_DAYS, YOY_PAIR_MAX_DAYS, periodGateReason, withoutPeriodGate,
  annualPairGateReason, SEALED_FIXTURES, sealedEraSnapshot, axisPairBlocked, dataDay, requireDataDay, staleReason, maskStaleQuarterSeries, STALE_DAYS, annualAccelerationGatePasses,
  _tagesnummer, annualPeriodEnds, withAnnualPairRule, annualPairRuleEnabled, annualPairPasses, nextDistinctAnnualIndex, checkAnnualPair,
  checkNewerAnnualPair, checkAnnualAcceleration, annualPairsShadow };

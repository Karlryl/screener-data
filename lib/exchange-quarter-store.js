'use strict';
/**
 * lib/exchange-quarter-store.js — pure helpers for the exchange-quarters store
 * (external-data/exchange-quarters/{cn,tw}.json, written by scripts/fetch-exchange-quarters.js).
 *
 * NOTHING READS THE STORE YET (Tag 1399). These helpers are not wired into prepareSnapshot or any
 * reader; the guard and the fill that will use them are a separate change. No board number moves.
 *
 * What lives here:
 *   - the period windows (which quarter ends / MOPS seasons a run fetches),
 *   - the China report seasons (daily fetch inside, weekly outside),
 *   - cumulative -> single quarter for China, with the report-type chain check,
 *   - MOPS season columns -> values for Taiwan (column order per season, YTD starts on 01-01,
 *     Q4 = FY - 9M, thousand TWD),
 *   - the append-only merge with confirmations and its guard, and the line-per-company serialiser.
 */
const { dekumuliere } = require('../scripts/build-cnannual.js');

const QUARTER_ENDS = ['03-31', '06-30', '09-30', '12-31'];
// Eastmoney GINCOME/SINCOME REPORT_TYPE per period end of a December fiscal year. Measured on
// 000958.SZ (PROBE-china 1.3): 一季报 = 3 months, 中报 = 6, 三季报 = 9, 年报 = 12, all year to date.
const CN_REPORT_TYPE = { '03-31': '一季报', '06-30': '中报', '09-30': '三季报', '12-31': '年报' };
const CN_REPORT_TYPES = new Set(Object.values(CN_REPORT_TYPE));
const CN_LINES = { total: 'total', operate: 'operate' };
// MOPS t164sb04 prints amounts in thousand TWD (新台幣仟元; PROBE-taiwan 2a: 6446 Q2-2026 6,855,431
// equals the vendor quarter / fx / 1000 and the filing's "$6,855,431").
const TW_UNIT = 1000;
const ROC_OFFSET = 1911;

const iso = (y, md) => y + '-' + md;

/** The n quarter ends strictly before `todayIso`, newest first. */
function quarterEndsBefore(todayIso, n) {
  const out = [];
  let y = Number(todayIso.slice(0, 4));
  let i = QUARTER_ENDS.length - 1;
  while (out.length < n) {
    const d = iso(y, QUARTER_ENDS[i]);
    if (d < todayIso) out.push(d);
    i -= 1;
    if (i < 0) { i = QUARTER_ENDS.length - 1; y -= 1; }
  }
  return out;
}

/** China: the last 7 quarter ends before today plus the fiscal-year end before the oldest one
 *  (spec S2: on 02.10.2026 that is 2024-12-31 next to 2025-03-31 .. 2026-09-30). The FY end is
 *  needed for the annual-pair check of G2b and is fetched even when it is not one of the 7. */
function chinaPeriodWindow(todayIso) {
  const q = quarterEndsBefore(todayIso, 7);
  const fyBefore = iso(Number(q[q.length - 1].slice(0, 4)) - 1, '12-31');
  return q.includes(fyBefore) ? q : [...q, fyBefore];
}

/** Taiwan: the last 5 quarter ends before today as MOPS (ROC year, season) keys. On 02.10.2026:
 *  115Q3 (not filed yet, answers 406), 115Q2, 115Q1, 114Q4 (full year only), 114Q3. 114Q3 is
 *  needed twice: for Q3-2025/Q3-2024 and as the 9M operand of Q4-2025 = FY - 9M. */
function taiwanSeasonWindow(todayIso) {
  return quarterEndsBefore(todayIso, 5).map((periodEnd) => {
    const year = Number(periodEnd.slice(0, 4));
    const season = QUARTER_ENDS.indexOf(periodEnd.slice(5)) + 1;
    const rocYear = year - ROC_OFFSET;
    return { key: rocYear + 'Q' + season, rocYear, season, periodEnd };
  });
}

/** A-share report seasons (spec S3): 15.03.-05.05., 15.07.-05.09., 15.10.-20.11., inclusive. */
function inChinaReportSeason(todayIso) {
  const md = todayIso.slice(5);
  return (md >= '03-15' && md <= '05-05') || (md >= '07-15' && md <= '09-05') || (md >= '10-15' && md <= '11-20');
}

/**
 * China cumulative (year to date) -> single quarters.
 * @param {Object<string,{reportType:string,total?:number,operate?:number}>} ytd period end -> observation
 * @param {'total'|'operate'} line TOTAL_OPERATE_INCOME or OPERATE_INCOME
 * @returns {Object<string,number|null>|null} null when the chain is not 一季报 -> 中报 -> 三季报 -> 年报 at
 *   03-31/06-30/09-30/12-31 (e.g. a non-December fiscal year): then the company is unchecked.
 */
function chinaSingleQuarters(ytd, line) {
  if (!CN_LINES[line]) throw new Error('chinaSingleQuarters: unknown line ' + JSON.stringify(line));
  const years = new Map();
  for (const [period, o] of Object.entries(ytd)) {
    const md = period.slice(5);
    if (!o || CN_REPORT_TYPE[md] !== o.reportType) return null;
    const y = period.slice(0, 4);
    if (!years.has(y)) years.set(y, [null, null, null, null]);
    const v = o[line];
    years.get(y)[QUARTER_ENDS.indexOf(md)] = Number.isFinite(v) ? v : null;
  }
  const out = {};
  for (const [y, arr] of years) {
    const single = dekumuliere(arr);
    for (let i = 0; i < 4; i += 1) {
      const period = iso(y, QUARTER_ENDS[i]);
      if (period in ytd) out[period] = Number.isFinite(single[i]) ? single[i] : null;
    }
  }
  return out;
}

/** "3,893,772" -> 3893772; "" -> null; anything else throws (no silent NaN). */
function parseMopsNumber(s) {
  const t = String(s == null ? '' : s).trim();
  if (t === '') return null;
  if (!/^-?\d{1,3}(,\d{3})*$/.test(t)) throw new Error('MOPS number unparseable: ' + JSON.stringify(s));
  return Number(t.replace(/,/g, ''));
}

const pad2 = (n) => String(n).padStart(2, '0');
const qLabel = (roc, s) => roc + '年第' + s + '季';
const ytdLabel = (roc, s) => {
  const md = QUARTER_ENDS[s - 1];
  return roc + '年01月01日至' + roc + '年' + md.slice(0, 2) + '月' + md.slice(3) + '日';
};
const fyLabel = (roc) => roc + '年度';

/**
 * Values of one MOPS season answer, checked against the column titles printed by MOPS.
 * Season 1: [YTD, quarter, prior YTD, prior quarter] or [YTD, prior YTD]; seasons 2/3: [quarter,
 * prior quarter, YTD, prior YTD]; season 4: [FY, prior FY] (PROBE-taiwan 2a, verified on 6446; the
 * two-column season 1 seen on the first full run). The YTD title must
 * start on 01-01; any other title (another fiscal year, another order) -> null = unchecked.
 * @returns {{quarter,priorQuarter,ytd,priorYtd}|{fy,priorFy}|null} amounts in TWD
 */
function taiwanSeasonValues(obs, rocYear, season) {
  if (!obs || !Array.isArray(obs.columns)) return null;
  const p = rocYear - 1;
  // Season 1 also comes as [YTD, prior YTD] only (33 of 150 answers on 02.10.2026, e.g. 3081.TWO,
  // 6023.TWO): YTD 01-01..03-31 is the first quarter itself.
  if (season === 1 && obs.columns.length === 2) {
    return taiwanSeasonValues({ columns: [obs.columns[0], [qLabel(rocYear, 1), obs.columns[0][1]], obs.columns[1], [qLabel(p, 1), obs.columns[1][1]]] }, rocYear, 1);
  }
  const expected = {
    1: [['ytd', ytdLabel(rocYear, 1)], ['quarter', qLabel(rocYear, 1)], ['priorYtd', ytdLabel(p, 1)], ['priorQuarter', qLabel(p, 1)]],
    2: [['quarter', qLabel(rocYear, 2)], ['priorQuarter', qLabel(p, 2)], ['ytd', ytdLabel(rocYear, 2)], ['priorYtd', ytdLabel(p, 2)]],
    3: [['quarter', qLabel(rocYear, 3)], ['priorQuarter', qLabel(p, 3)], ['ytd', ytdLabel(rocYear, 3)], ['priorYtd', ytdLabel(p, 3)]],
    4: [['fy', fyLabel(rocYear)], ['priorFy', fyLabel(p)]],
  }[season];
  if (!expected || obs.columns.length !== expected.length) return null;
  const out = {};
  for (let i = 0; i < expected.length; i += 1) {
    const [label, value] = obs.columns[i];
    if (label !== expected[i][1]) return null;
    out[expected[i][0]] = Number.isFinite(value) ? value * TW_UNIT : null;
  }
  return out;
}

const periodEndOf = (rocYear, season) => iso(rocYear + ROC_OFFSET, QUARTER_ENDS[season - 1]);

/**
 * Taiwan single quarters (TWD) from the latest observation per season key ('114Q3' -> obs).
 * Seasons 1-3 give the printed quarter and prior-year quarter; Q4 = FY - 9M of the same year
 * (6446: 15,634,777 - 10,753,539 = 4,881,238). A newer filing's comparative wins over an older one.
 */
function taiwanSingleQuarters(seasons) {
  const vals = {};
  for (const [key, obs] of Object.entries(seasons)) {
    const m = /^(\d+)Q([1-4])$/.exec(key);
    if (!m) continue;
    const v = taiwanSeasonValues(obs, Number(m[1]), Number(m[2]));
    if (v) vals[key] = { roc: Number(m[1]), season: Number(m[2]), v };
  }
  const out = {};
  const put = (period, value, rank) => {
    if (!Number.isFinite(value)) return;
    if (!out[period] || out[period].rank < rank) out[period] = { value, rank };
  };
  for (const { roc, season, v } of Object.values(vals)) {
    const rank = roc * 10 + season;
    if (season <= 3) {
      put(periodEndOf(roc, season), v.quarter, rank);
      put(periodEndOf(roc - 1, season), v.priorQuarter, rank);
    } else {
      const nine = vals[roc + 'Q3'];
      if (nine && Number.isFinite(v.fy) && Number.isFinite(nine.v.ytd)) put(periodEndOf(roc, 4), v.fy - nine.v.ytd, rank);
      if (nine && Number.isFinite(v.priorFy) && Number.isFinite(nine.v.priorYtd)) put(periodEndOf(roc - 1, 4), v.priorFy - nine.v.priorYtd, rank);
    }
  }
  return Object.fromEntries(Object.entries(out).map(([k, o]) => [k, o.value]));
}

// ── Append-only merge ────────────────────────────────────────────────────────
const META = new Set(['confirmedBy']);
const identity = (o) => JSON.stringify(Object.keys(o).filter((k) => !META.has(k)).sort().map((k) => [k, o[k]]));

/**
 * Merge one fresh reading into an observation list (mutates `list`).
 * Same numbers as the last observation: no new observation; a confirmation {src, fetchedAt,
 * updateDate} is appended only when updateDate differs from the last confirmation. Every other
 * re-reading is recorded once per run in the source entry (China: `periods` minus `absent`,
 * Taiwan: `read`), see lastConfirmedAt(). Spec S1 asked for one confirmation per fetch; measured
 * on the first China pass that would rewrite every company line on every run (about 2.2 MB more
 * per run on an 8 MB file and a full-file git delta each day), so the plain re-readings live in
 * the run log instead. Different numbers: a new observation is appended (restatement signal).
 * Nothing is ever removed.
 * @returns {'new'|'confirmed'|'changed'}
 */
function mergeObservation(list, fresh, conf) {
  const last = list[list.length - 1];
  if (last && identity(last) === identity(fresh)) {
    const lc = last.confirmedBy[last.confirmedBy.length - 1];
    if (!lc || lc.updateDate !== conf.updateDate) last.confirmedBy.push({ ...conf });
    return 'confirmed';
  }
  list.push({ ...fresh, confirmedBy: [{ ...conf }] });
  return last ? 'changed' : 'new';
}

/**
 * fetchedAt of the newest run that read the latest observation of (ticker, key) again.
 * China key = period end: a run covers it when `periods` lists it and `absent[key]` does not list
 * the ticker. Taiwan key = season ('115Q2'): the run's `read` list holds 'ticker key'.
 * @returns {string|null}
 */
function lastConfirmedAt(store, tk, key) {
  let best = null;
  for (const s of Object.values(store.sources || {})) {
    const hit = store.market === 'CN'
      ? (s.periods || []).includes(key) && !((s.absent || {})[key] || []).includes(tk)
      : (s.read || []).includes(tk + ' ' + key);
    if (hit && (!best || s.fetchedAt > best)) best = s.fetchedAt;
  }
  return best;
}

const stable = (v) => JSON.stringify(v);
function fail(path, why) {
  throw new Error('append-only violated at ' + path + ': ' + why + '. Nothing is written.');
}

/**
 * Throws when `next` loses or changes anything of `prev`: a source, a company, a period, an
 * observation or a confirmation. Mutable bookkeeping outside
 * observations (Taiwan `noData`) is not part of the guarantee.
 */
function assertAppendOnly(prev, next) {
  if (!prev) return;
  for (const s of Object.keys(prev.sources || {})) {
    if (!next.sources || stable(next.sources[s]) !== stable(prev.sources[s])) fail('sources.' + s, 'source entry removed or changed');
  }
  for (const [tk, pc] of Object.entries(prev.companies || {})) {
    const nc = next.companies && next.companies[tk];
    if (!nc) fail(tk, 'company removed');
    for (const group of Object.keys(pc)) {
      const pg = pc[group];
      if (!pg || typeof pg !== 'object' || Array.isArray(pg)) {
        if (group !== 'noData' && stable(nc[group]) !== stable(pg)) fail(tk + '.' + group, 'company field changed');
        continue;
      }
      if (group === 'noData') continue;
      for (const [period, plist] of Object.entries(pg)) {
        const nlist = nc[group] && nc[group][period];
        if (!Array.isArray(nlist)) fail(tk + '.' + group + '.' + period, 'period removed');
        if (nlist.length < plist.length) fail(tk + '.' + group + '.' + period, 'observation removed');
        plist.forEach((po, i) => {
          const no = nlist[i];
          const where = tk + '.' + group + '.' + period + '[' + i + ']';
          if (identity(no) !== identity(po)) fail(where, 'observation changed');
          if (no.confirmedBy.length < po.confirmedBy.length
            || stable(no.confirmedBy.slice(0, po.confirmedBy.length)) !== stable(po.confirmedBy)) fail(where, 'confirmation removed or changed');
        });
      }
    }
  }
}

/** JSON with one source and one company per line (readable diffs), keys sorted. Ends with \n. */
function serialiseStore(store) {
  const head = Object.keys(store).filter((k) => k !== 'sources' && k !== 'companies');
  const block = (obj) => Object.keys(obj).sort().map((k) => JSON.stringify(k) + ':' + JSON.stringify(obj[k])).join(',\n');
  const parts = head.map((k) => JSON.stringify(k) + ':' + JSON.stringify(store[k]));
  parts.push('"sources":{\n' + block(store.sources || {}) + '\n}');
  parts.push('"companies":{\n' + block(store.companies || {}) + '\n}');
  return '{' + parts.join(',\n') + '}\n';
}

module.exports = {
  QUARTER_ENDS, CN_REPORT_TYPE, CN_REPORT_TYPES, TW_UNIT, ROC_OFFSET,
  quarterEndsBefore, chinaPeriodWindow, taiwanSeasonWindow, inChinaReportSeason,
  chinaSingleQuarters, parseMopsNumber, taiwanSeasonValues, taiwanSingleQuarters,
  mergeObservation, lastConfirmedAt, assertAppendOnly, serialiseStore,
};

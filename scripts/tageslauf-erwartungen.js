#!/usr/bin/env node
'use strict';
/**
 * Daily-run expectations: checks the predictions that number-changing PRs committed to
 * data-health/erwartungen.json against the published findash export, in seconds and without helpers.
 *
 *   node scripts/tageslauf-erwartungen.js [--export <dir | https base url>] [--erwartungen <file>]
 *                                         [--datum YYYY-MM-DD] [--out <json file>]
 *
 * Defaults: the gh-pages export v1 and the committed file. An entry is due when gueltigAb <= the export's
 * data day (Europe/Berlin date of index.json generated_at), never the calendar date; --datum overrides that
 * day (for example to check yesterday's export against today's entries).
 * Exit 0: every due expectation is erfüllt or abgelaufen. Exit 1: at least one is nicht erfüllt or
 * nicht messbar (a missing field or an unloadable board file is never counted as erfüllt). Exit 2:
 * index.json could not be loaded, or the expectation file or --datum is invalid.
 *
 * Entry: {id, pr, gueltigAb, gueltigBis?, grund, board, op, feld?, ticker | name | zaehle, track?,
 *         wert?, min?, max?, toleranz?, muster?, gruppe?}
 *   board  export file without .json ("full/semiconductors", "rule40/overview", "quality/materials",
 *          "filter/universum", "overview") or "any" (all full/<branch> boards of index.json; the row
 *          must then exist exactly once across them).
 *   ticker | name  selects exactly one row (track narrows it); 0 or several rows fail a value check.
 *   zaehle  instead of a row: the measured value is the number of rows whose feld equals or contains it.
 *   op     between (min..max) | eq (wert, numeric ± toleranz) | null | notNull | contains (wert as
 *          substring or muster as regex, on a string or any element of an array) | absent | present (row).
 *   gruppe entries sharing it form one expectation (name must not be another entry's id); one erfüllt
 *          member is enough, and once a member is abgelaufen the group can no longer fail.
 *   gueltigAb  first data day the effect is live; later entries are listed as noch nicht fällig.
 *   gueltigBis after it the entry is only reported as abgelaufen, never failed (set it on drifting values
 *          such as rank, market-cap, score or growth ranges).
 */
const fs = require('fs');
const path = require('path');
const { writeJsonAtomic } = require('../lib/atomic-write.js');

const DEFAULT_EXPORT = 'https://raw.githubusercontent.com/Karlryl/screener-data/gh-pages/outputs/findash-export/v1';
const DEFAULT_ERWARTUNGEN = path.join(__dirname, '..', 'data-health', 'erwartungen.json');
const OPS = ['between', 'eq', 'null', 'notNull', 'absent', 'present', 'contains'];
const ROW_OPS = ['absent', 'present'];
// filter/universum.json omits null-valued keys by contract (docs/findash-export-v1.md, "an absent key means
// null"); there a key that some row carries is null where it is absent. Everywhere else absent = nicht messbar.
const NULL_DROPPED = new Set(['filter/universum']);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MISSING = Symbol('missing');
const ERFUELLT = 'erfüllt', NICHT = 'nicht erfüllt', NM = 'nicht messbar', ABGELAUFEN = 'abgelaufen';

/** @param {string} iso Timestamp. @returns {string} Its date in Europe/Berlin (YYYY-MM-DD). */
const berlinDay = iso => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin' }).format(new Date(iso));

/**
 * Lazy, cached loader: each export file is read or fetched at most once.
 * @param {string} base Local export directory or http(s) base URL of findash-export/v1.
 * @returns {(rel: string) => Promise<object>} Parsed JSON per relative path.
 */
function loader(base) {
  const cache = new Map();
  const remote = /^https?:\/\//.test(base);
  const read = async rel => {
    if (!remote) return fs.readFileSync(path.join(base, rel), 'utf8');
    const res = await fetch(base.replace(/\/$/, '') + '/' + rel, { signal: AbortSignal.timeout(60000) });
    if (!res.ok) throw new Error(`${rel}: HTTP ${res.status}`);
    return res.text();
  };
  return rel => {
    if (!cache.has(rel)) cache.set(rel, read(rel).then(JSON.parse));
    return cache.get(rel);
  };
}

/**
 * Validates the hand-edited expectation file; throws with the entry id on the first problem.
 * @param {unknown} list Parsed erwartungen.json.
 * @returns {object[]} The same entries.
 */
function validate(list) {
  if (!Array.isArray(list)) throw new Error('Erwartungsdatei ist kein Array');
  if (!list.length) throw new Error('Erwartungsdatei ist leer');
  const ids = new Set(list.map(e => e && e.id));
  for (const e of list) if (e && e.gruppe !== undefined && ids.has(e.gruppe)) throw new Error(`Erwartung ${e.id}: gruppe ${e.gruppe} ist zugleich die id einer Erwartung`);
  ids.clear();
  for (const e of list) {
    const bad = msg => { throw new Error(`Erwartung ${e && e.id}: ${msg}`); };
    if (!e || typeof e.id !== 'string' || !e.id) bad('id fehlt');
    if (ids.has(e.id)) bad('id doppelt');
    ids.add(e.id);
    if (!Number.isInteger(e.pr)) bad('pr fehlt');
    if (!DATE.test(e.gueltigAb || '')) bad('gueltigAb fehlt');
    if (e.gueltigBis !== undefined && !(DATE.test(e.gueltigBis) && e.gueltigBis >= e.gueltigAb)) bad('gueltigBis ungültig oder vor gueltigAb');
    if (typeof e.grund !== 'string' || !e.grund.trim()) bad('grund fehlt');
    if (typeof e.board !== 'string' || !e.board || e.board.endsWith('.json')) bad('board fehlt oder endet auf .json');
    if (!OPS.includes(e.op)) bad('op unbekannt: ' + e.op);
    const selectors = ['ticker', 'name', 'zaehle'].filter(k => e[k] !== undefined);
    if (selectors.length !== 1) bad('genau eines von ticker, name, zaehle nötig');
    if (e.zaehle !== undefined && !['between', 'eq'].includes(e.op)) bad('zaehle nur mit between oder eq');
    if (e.zaehle !== undefined && e.track !== undefined) bad('zaehle zählt alle Zeilen, track ist dort nicht erlaubt');
    if (!ROW_OPS.includes(e.op) && (typeof e.feld !== 'string' || !e.feld)) bad('feld fehlt');
    if (e.op === 'between' && !(Number.isFinite(e.min) && Number.isFinite(e.max) && e.min <= e.max)) bad('min/max ungültig');
    if (e.op === 'eq' && !Object.hasOwn(e, 'wert')) bad('wert fehlt');
    if (e.toleranz !== undefined && !(Number.isFinite(e.toleranz) && e.toleranz >= 0 && typeof e.wert === 'number')) bad('toleranz ungültig');
    if (e.op === 'contains') {
      if (typeof e.muster === 'string' && e.muster) new RegExp(e.muster);
      else if (typeof e.wert !== 'string' || !e.wert || e.muster !== undefined) bad('contains braucht einen nicht leeren wert oder ein nicht leeres muster');
    }
  }
  return list;
}

/** @param {object} file Parsed export file. @param {string} rel Its name. @returns {object[]} Board tracks or flat rows. */
function rowsOf(file, rel) {
  const lists = ['profitable', 'unprofitable', 'rows'].filter(k => Array.isArray(file && file[k]));
  if (!lists.length) throw new Error(`${rel}: keine Zeilenliste`);
  return lists.flatMap(k => file[k]);
}

const keySets = new WeakMap();
const fileHasKey = (rows, k) => {
  if (!keySets.has(rows)) keySets.set(rows, new Set(rows.flatMap(r => Object.keys(r))));
  return keySets.get(rows).has(k);
};

/** Reads a dot path; MISSING when a key is absent (null-dropping files: null if another row has the key). */
function read(row, feld, rows, rel) {
  let v = row;
  for (const k of feld.split('.')) {
    if (v === null || typeof v !== 'object' || !Object.hasOwn(v, k)) {
      // ponytail: "some row carries the key" stands in for the writer's key list, catches typos without duplicating it
      return NULL_DROPPED.has(rel) && !feld.includes('.') && fileHasKey(rows, feld) ? null : MISSING;
    }
    v = v[k];
  }
  return v;
}

/** @returns {boolean} Whether the measured value satisfies the entry's op. */
function holds(e, v) {
  switch (e.op) {
    case 'between': return typeof v === 'number' && v >= e.min && v <= e.max;
    case 'eq': return typeof v === 'number' && typeof e.wert === 'number' ? Math.abs(v - e.wert) <= (e.toleranz || 0) : v === e.wert;
    case 'null': return v === null;
    case 'notNull': return v !== null;
    case 'contains': {
      const re = typeof e.muster === 'string' ? new RegExp(e.muster) : null;
      return (Array.isArray(v) ? v : [v]).some(s => typeof s === 'string' && (re ? re.test(s) : s.includes(e.wert)));
    }
    default: throw new Error('op ' + e.op);
  }
}

/**
 * Measures one entry against the export.
 * @returns {Promise<{urteil: string, gemessen: unknown}>}
 */
async function measure(e, load, index) {
  const files = e.board === 'any' ? index.branches.map(b => 'full/' + b) : [e.board];
  const perFile = [];
  for (const rel of files) {
    // A missing or broken board file makes only its own checks nicht messbar; index.json is the only hard stop.
    try { perFile.push({ rel, rows: rowsOf(await load(rel + '.json'), rel) }); }
    catch (err) { return { urteil: NM, gemessen: `Datei ${rel}.json nicht ladbar (${err.message})` }; }
  }
  if (e.zaehle !== undefined) {
    const values = perFile.flatMap(({ rel, rows }) => rows.map(r => read(r, e.feld, rows, rel))).filter(v => v !== MISSING);
    if (!values.length) return { urteil: NM, gemessen: `Feld ${e.feld} fehlt` };
    const n = values.filter(v => (Array.isArray(v) ? v.includes(e.zaehle) : v === e.zaehle)).length;
    return { urteil: holds(e, n) ? ERFUELLT : NICHT, gemessen: n };
  }
  const hits = [];
  for (const { rel, rows } of perFile) {
    for (const r of rows) {
      const same = e.ticker !== undefined ? (r.ticker ?? r.t) === e.ticker : (r.name ?? r.n) === e.name;
      if (same && (e.track === undefined || r.track === e.track)) hits.push({ rel, rows, r });
    }
  }
  if (e.op === 'absent') return { urteil: hits.length ? NICHT : ERFUELLT, gemessen: hits.length ? `${hits.length} Zeile(n)` : 'keine Zeile' };
  if (e.op === 'present') return { urteil: hits.length ? ERFUELLT : NICHT, gemessen: hits.length ? `${hits.length} Zeile(n)` : 'keine Zeile' };
  if (hits.length !== 1) return { urteil: NICHT, gemessen: hits.length ? `${hits.length} Zeilen statt einer` : 'keine Zeile' };
  const { rel, rows, r } = hits[0];
  const v = read(r, e.feld, rows, rel);
  if (v === MISSING) return { urteil: NM, gemessen: `Feld ${e.feld} fehlt` };
  // A long hint list shows only the element that matched.
  const shown = e.op === 'contains' && Array.isArray(v) ? (v.find(s => holds(e, s)) ?? v) : v;
  return { urteil: holds(e, v) ? ERFUELLT : NICHT, gemessen: shown };
}

const fmtNum = v => (Math.abs(v) >= 1e9
  ? (v / 1e9).toLocaleString('de-DE', { maximumFractionDigits: 2 }) + ' Mrd.'
  : v.toLocaleString('de-DE', { maximumFractionDigits: 2 }));
/** German display of a measured value. */
function fmt(v) {
  if (v === null) return 'leer';
  if (typeof v === 'number') return fmtNum(v);
  if (Array.isArray(v)) return v.map(fmt).join(' / ');
  if (typeof v === 'string') return v;
  return JSON.stringify(v);
}
function describe(e) {
  const who = e.ticker ?? (e.name !== undefined ? `„${e.name}“` : `Zeilen mit ${e.feld} = ${e.zaehle}`);
  const where = e.board + (e.track ? ' ' + e.track : '');
  const feld = e.zaehle !== undefined ? 'Anzahl' : e.feld;
  const what = {
    between: () => `${feld} zwischen ${fmtNum(e.min)} und ${fmtNum(e.max)}`,
    eq: () => `${feld} = ${fmt(e.wert)}${e.toleranz ? ' ± ' + fmtNum(e.toleranz) : ''}`,
    null: () => `${feld} leer`,
    notNull: () => `${feld} belegt`,
    contains: () => `${feld} enthält ${e.muster !== undefined ? 'Muster /' + e.muster + '/' : '„' + e.wert + '“'}`,
    absent: () => 'Zeile nicht vorhanden',
    present: () => 'Zeile vorhanden',
  }[e.op]();
  return `${who} · ${where} · ${what}`;
}
const cell = s => String(s).replace(/\|/g, '\\|').replace(/\s+/g, ' ');

/**
 * Evaluates every due expectation.
 * @param {{exportBase: string, erwartungen: string, datum?: string}} opts datum overrides the export's data day.
 * @returns {Promise<{code: number, lines: string[], report: object|null}>}
 */
async function run({ exportBase, erwartungen, datum: override }) {
  if (override !== undefined && !DATE.test(override)) return { code: 2, lines: ['--datum muss YYYY-MM-DD sein: ' + override], report: null };
  let list;
  try {
    list = validate(JSON.parse(fs.readFileSync(erwartungen, 'utf8')));
  } catch (err) {
    return { code: 2, lines: ['Erwartungsdatei nicht prüfbar: ' + err.message], report: null };
  }
  const load = loader(exportBase);
  let index;
  try {
    index = await load('index.json');
    if (!Array.isArray(index.branches) || !index.branches.length) throw new Error('index.json ohne branches');
    if (!Number.isFinite(Date.parse(index.generated_at))) throw new Error('index.json ohne generated_at');
  } catch (err) {
    return { code: 2, lines: ['Export nicht ladbar: ' + err.message], report: null };
  }
  const exportDay = berlinDay(index.generated_at);
  const datum = override ?? exportDay;
  const due = list.filter(e => e.gueltigAb <= datum);
  const later = list.filter(e => e.gueltigAb > datum);
  const checks = new Map(); // gruppe (or id) -> member results, in file order
  for (const e of due) {
    const res = e.gueltigBis !== undefined && datum > e.gueltigBis ? { urteil: ABGELAUFEN, gemessen: 'nicht gemessen' } : await measure(e, load, index);
    const key = e.gruppe ?? e.id;
    if (!checks.has(key)) checks.set(key, []);
    checks.get(key).push({ e, ...res });
  }
  const results = [...checks.values()].map(members => {
    const u = members.map(m => m.urteil);
    // An OR with an expired alternative cannot be failed any more (gueltigBis: never nicht erfüllt).
    const urteil = u.includes(ERFUELLT) ? ERFUELLT : u.includes(ABGELAUFEN) ? ABGELAUFEN : u.includes(NM) ? NM : NICHT;
    return { id: members.map(m => m.e.id).join(' + '), pr: members[0].e.pr, urteil, members };
  });
  const count = u => results.filter(r => r.urteil === u).length;
  const laterChecks = new Set(later.map(e => e.gruppe ?? e.id)).size; // counted like results: a group is one
  const lines = [
    `${count(ERFUELLT)} von ${results.length} Erwartungen erfüllt, ${count(NICHT)} nicht erfüllt, ${count(NM)} nicht messbar, ` +
      `${count(ABGELAUFEN)} abgelaufen; ${laterChecks} noch nicht fällig (Export vom ${index.generated_at}, Datentag ${exportDay}` +
      (override !== undefined && override !== exportDay ? `, geprüft wie am ${override} per --datum` : '') + ').',
  ];
  lines.push('', '| Erwartung | gemessen | Urteil | Grund |', '|---|---|---|---|');
  for (const r of results) {
    lines.push(`| ${cell(`PR ${r.pr}: ` + r.members.map(m => describe(m.e)).join(' oder '))} | ${cell(r.members.map(m => fmt(m.gemessen)).join(' / '))} | ${r.urteil} | ${cell(r.members[0].e.grund)} |`);
  }
  if (later.length) lines.push('', 'Noch nicht fällig: ' + later.map(e => `${e.id} (ab ${e.gueltigAb})`).join(', '));
  const report = {
    datum, datentag: exportDay, export: exportBase, exportGeneratedAt: index.generated_at,
    zusammenfassung: { erfuellt: count(ERFUELLT), nichtErfuellt: count(NICHT), nichtMessbar: count(NM), abgelaufen: count(ABGELAUFEN), nochNichtFaellig: laterChecks },
    ergebnisse: results.map(r => ({ id: r.id, pr: r.pr, urteil: r.urteil, teile: r.members.map(m => ({ id: m.e.id, urteil: m.urteil, gemessen: m.gemessen })) })),
    nochNichtFaellig: later.map(e => e.id),
  };
  const ok = results.every(r => r.urteil === ERFUELLT || r.urteil === ABGELAUFEN);
  return { code: ok ? 0 : 1, lines, report };
}

async function main(argv) {
  const at = flag => { const i = argv.indexOf(flag); return i >= 0 ? (argv[i + 1] ?? '') : undefined; };
  const opts = {
    exportBase: at('--export') || DEFAULT_EXPORT,
    erwartungen: path.resolve(at('--erwartungen') || DEFAULT_ERWARTUNGEN),
    datum: at('--datum'),
  };
  const out = at('--out') && path.resolve(at('--out'));
  const inside = (dir, p) => { const r = path.relative(dir, p); return r === '' || (!r.startsWith('..') && !path.isAbsolute(r)); };
  // The report is the only write: never onto the expectation file or into a local export tree.
  if (out && (out === opts.erwartungen || (!/^https?:\/\//.test(opts.exportBase) && inside(path.resolve(opts.exportBase), out)))) {
    console.log('--out zeigt auf die Erwartungsdatei oder in den Export: ' + out);
    return 2;
  }
  const { code, lines, report } = await run(opts);
  console.log(lines.join('\n'));
  if (out && report) {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    writeJsonAtomic(out, report, { indent: 2 });
  }
  return code;
}

if (require.main === module) main(process.argv.slice(2)).then(code => { process.exitCode = code; });
module.exports = { run, validate, main };

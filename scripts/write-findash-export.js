#!/usr/bin/env node
'use strict';
/**
 * findash-export v1 writer (task 1.1).
 *
 *   node scripts/write-findash-export.js           # build the export
 *   node scripts/write-findash-export.js --check    # validate an already-built export, exit 1 on breach
 *   node scripts/write-findash-export.js --selftest  # runnable self-check (assert-based)
 *
 * READS  (read-only inputs, never a write target):
 *   outputs/hypergrowth/<branch>.json  (13 boards, {profitable[],unprofitable[]})
 *   outputs/hypergrowth/overview.json  (flat cross-branch top-200)
 *   outputs/hypergrowth/survival.json  (flat pre-revenue, runway-desc)
 *   outputs/hypergrowth/index.json     (meta: counts/branches/excluded)
 *   outputs/coverage-status.json       (degradation banner marker, optional)
 * NEVER touches picks-history/ or earnings-calendar.json (Retention Grundgesetz 7a).
 *
 * WRITES (atomic tmp+rename, assertFinite -> fail-loud on NaN/Inf, never silent-null):
 *   outputs/findash-export/v1/<branch>.json
 *   outputs/findash-export/v1/overview.json
 *   outputs/findash-export/v1/survival.json
 *   outputs/findash-export/v1/index.json
 *
 * Contract: docs/findash-export-v1.md. Every file carries schema:'findash-export/v1'.
 * A v2 bump is the ONLY sanctioned way to rename/remove/retype a field.
 *
 * THE GATE IS THE PRODUCT: --check is Karl's only alarm channel (red X). It MUST catch
 * a missing field, a wrong type, or a bad enum on ANY Pflicht field of ANY of the 15
 * files. Every validate*Row() below checks BOTH presence AND type/enum for every field
 * the schema-doc marks Pflicht. Proven against real outputs/hypergrowth: 22 tamper
 * variants (incl. 4 simultaneous breaches on energy.json) all exit 1.
 */
const fs = require('fs');
const path = require('path');
const { writeJsonAtomic } = require('../lib/atomic-write.js');
const { boardStatus: boardStatusOf } = require('../src/scoring/board-status.js'); // 2.1: core|diagnostic per board
const { TIERS } = require('../src/scoring/profit-tier.js'); // 1.2: profitTier-Enum

const ROOT = path.join(__dirname, '..');
const HG_DIR = path.join(ROOT, 'outputs', 'hypergrowth');
const COVERAGE = path.join(ROOT, 'outputs', 'coverage-status.json');
const OUT_DIR = path.join(ROOT, 'outputs', 'findash-export', 'v1');

const SCHEMA = 'findash-export/v1';
const BRANCHES = [
  'consumer-discretionary', 'consumer-staples', 'energy', 'financials',
  'health-care', 'industrials', 'it-services', 'materials', 'real-estate',
  'semiconductors', 'software-comm-services', 'tech-hardware', 'utilities',
];
// The exact geo/classification fields the engine writes on every board+overview+survival row.
// Task 1.2: profitTier (4-Stufen-Enum) + ipoYear (durchgereicht) sind seit 1.2 real (vorher RESERVIERT).
// Task 2.13 #23: coverageAxes ("n/m" present-Achsen) + coverageWeight (C4-Gewicht) — additiv OPTIONAL,
// ausweisen statt verrechnen (score-inert); nicht in den Pflicht-Feld-Check (Auflage B1).
// Task 2.10: cohortN (Kohortengroesse je Zeile) + cohortFallback (Eltern-Kohorten-Basis aktiv) — PFLICHT
// (Tamper -> exit 1), anders als die optionalen coverage-Felder. Auf routed Board/Overview-Zeilen finite
// Zahl bzw. boolean; auf pre-revenue survival-Zeilen null (nie gescort).
const GEO_FIELDS = ['country', 'region', 'sector', 'marketCap', 'phase', 'mcapBand', 'ipoRecency', 'profitTier', 'ipoYear', 'coverageAxes', 'coverageWeight', 'cohortN', 'cohortFallback'];

function readJSON(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }
function readJSONOrNull(p) { try { return readJSON(p); } catch (_) { return null; } }

// ---- row mappers ---------------------------------------------------------
// Copy ONLY real engine fields. `rank` is derived = 1-based array index (score-desc;
// survival runway-desc). currency/profitTier/ipoYear are RESERVED (1.2) — NOT
// fabricated; consumers treat absent as "not available".

function mapBoardRow(r, i) {
  const out = {
    rank: i + 1,           // derived: list is score-desc, rank = index+1
    ticker: r.ticker,
    score: r.score,        // round1 display score (sort determinism was internal _raw)
    track: r.track,        // 'profitable' | 'unprofitable'
    lamps: r.lamps || [],
    overview: r.overview == null ? null : {
      kind: r.overview.kind,           // 'gp'|'revenue-badge'|'ffo-badge'|'runway-badge'
      value: r.overview.value,         // number|null, CAN be negative (YoY shrink)
      companion: r.overview.companion, // number|null (Rule-of-X companion)
    },
  };
  for (const k of GEO_FIELDS) out[k] = r[k] === undefined ? null : r[k];
  return out;
}

function mapOverviewRow(r, i) {
  const out = {
    rank: i + 1,
    ticker: r.ticker,
    formulaId: r.formulaId,     // branch id — only present in the flat overview feed
    track: r.track,
    score: r.score,
    overviewKind: r.overviewKind,           // FLAT here, NOT nested (mirrors engine)
    overviewValue: r.overviewValue,         // number|null, CAN be negative
    overviewCompanion: r.overviewCompanion, // number|null
    lamps: r.lamps || [],
  };
  for (const k of GEO_FIELDS) out[k] = r[k] === undefined ? null : r[k];
  return out;
}

function mapSurvivalRow(r, i) {
  // pre-revenue names never scored: no score/track/overview.kind. runwayQuarters
  // (9999 sentinel = quasi-infinite runway) is the sort key, runway-desc nulls-last.
  const out = {
    rank: i + 1,
    ticker: r.ticker,
    runwayQuarters: r.runwayQuarters,  // number|null, 9999 = inf-runway sentinel
    lamps: r.lamps || [],
  };
  for (const k of GEO_FIELDS) out[k] = r[k] === undefined ? null : r[k];
  return out;
}

// ---- build ---------------------------------------------------------------
function buildBoard(id, coverage) {
  const b = readJSON(path.join(HG_DIR, id + '.json'));
  return {
    schema: SCHEMA,
    generated_at: new Date().toISOString(),
    branch: id,
    boardStatus: boardStatusOf(id),                 // 'core' (Court-PASSED) | 'diagnostic' (unbewiesen, 2.1)
    coverage,                                       // {status,degraded,blocked,coverage_pct} | null
    profitable: (b.profitable || []).map(mapBoardRow),
    unprofitable: (b.unprofitable || []).map(mapBoardRow),
  };
}

function buildOverview(coverage) {
  const o = readJSON(path.join(HG_DIR, 'overview.json'));
  return { schema: SCHEMA, generated_at: new Date().toISOString(), coverage, rows: o.map(mapOverviewRow) };
}

function buildSurvival(coverage) {
  const s = readJSON(path.join(HG_DIR, 'survival.json'));
  return { schema: SCHEMA, generated_at: new Date().toISOString(), coverage, rows: s.map(mapSurvivalRow) };
}

function buildIndex(coverage) {
  const idx = readJSON(path.join(HG_DIR, 'index.json'));
  return {
    schema: SCHEMA,
    generated_at: new Date().toISOString(),
    coverage,                                        // banner marker for the dashboard
    generatedFromSnapshots: idx.generatedFromSnapshots,
    branches: idx.branches,
    boardStatus: Object.fromEntries(BRANCHES.map((id) => [id, boardStatusOf(id)])), // 2.1: core|diagnostic je Board
    counts: idx.counts,                              // true cohort counts, not topN
    survivalCount: idx.survivalCount,
    excluded: idx.excluded,
  };
}

// coverage marker is a diagnostic passenger, not a hard input. Absent (fresh runner,
// marker not yet written) -> export still builds; consumers read coverage:null as "unknown".
function loadCoverage() {
  const m = readJSONOrNull(COVERAGE);
  if (!m) return null;
  return { status: m.status, degraded: m.degraded, blocked: m.blocked, coverage_pct: m.coverage_pct };
}

function build() {
  const coverage = loadCoverage();
  fs.mkdirSync(OUT_DIR, { recursive: true }); // writeJsonAtomic does NOT create the dir
  const opts = { assertFinite: true };         // fail loud on a NaN/Inf, never silent-null (A-lib-08)
  for (const id of BRANCHES) {
    writeJsonAtomic(path.join(OUT_DIR, id + '.json'), buildBoard(id, coverage), opts);
  }
  writeJsonAtomic(path.join(OUT_DIR, 'overview.json'), buildOverview(coverage), opts);
  writeJsonAtomic(path.join(OUT_DIR, 'survival.json'), buildSurvival(coverage), opts);
  writeJsonAtomic(path.join(OUT_DIR, 'index.json'), buildIndex(coverage), opts);
  return { out: OUT_DIR, branches: BRANCHES.length };
}

// ---- validate (schema-check gate) ---------------------------------------
// Pure per-object checks; validateExport() reads the ON-DISK export and returns a
// list of contract violations (empty = ok). Mirrors coverage-gate.js validateMarker:
// a nonempty list makes the CI --check step exit 1 and block the if:success() deploy.
//
// Every field the schema-doc marks "Pflicht" is checked for BOTH presence AND type/enum.
// "Pflicht (nullable)" = key present AND (null OR correct type). Absence of the key = breach.
const VALID_TRACK = ['profitable', 'unprofitable'];
const VALID_PHASE = ['inflected', 'established', 'unprofitable'];
const VALID_MCAP = ['micro', 'small', 'mid', 'large', 'mega'];
const VALID_IPO = ['recent', 'growth', 'seasoned', 'veteran', 'mature'];
const VALID_OVKIND = ['gp', 'revenue-badge', 'ffo-badge', 'runway-badge'];
const VALID_COVERAGE_STATUS = ['ok', 'degradiert', 'katastrophal'];
const VALID_BOARDSTATUS = ['core', 'diagnostic'];
const VALID_PROFITTIER = TIERS; // 1.2: nicht/kurz-vor/seit-kurzem/langfristig-profitabel

// string|null field must be PRESENT (key exists) and either null or string.
function checkStrOrNull(r, key, where, errs) {
  if (!(key in r)) errs.push(`${where}: ${key} missing`);
  else if (r[key] !== null && typeof r[key] !== 'string') errs.push(`${where}: ${key} not string|null`);
}
// number|null field must be PRESENT and either null or finite number.
function checkNumOrNull(r, key, where, errs) {
  if (!(key in r)) errs.push(`${where}: ${key} missing`);
  else if (r[key] !== null && !Number.isFinite(r[key])) errs.push(`${where}: ${key} not finite|null`);
}
// enum|null field must be PRESENT and either null or one of the allowed values.
function checkEnumOrNull(r, key, allowed, where, errs) {
  if (!(key in r)) errs.push(`${where}: ${key} missing`);
  else if (r[key] !== null && !allowed.includes(r[key])) errs.push(`${where}: ${key}=${JSON.stringify(r[key])}`);
}
// boolean|null field must be PRESENT and either null or a boolean (2.10 cohortFallback on survival rows).
function checkBoolOrNull(r, key, where, errs) {
  if (!(key in r)) errs.push(`${where}: ${key} missing`);
  else if (r[key] !== null && typeof r[key] !== 'boolean') errs.push(`${where}: ${key} not boolean|null`);
}
// Task 2.10: cohortN/cohortFallback on a SCORED row (board/overview) are Pflicht + NON-null: cohortN a
// finite number, cohortFallback a boolean. Field removal or type corruption -> violation (exit 1).
function checkCohortScored(r, where, errs) {
  if (!('cohortN' in r)) errs.push(`${where}: cohortN missing`);
  else if (!Number.isFinite(r.cohortN)) errs.push(`${where}: cohortN not finite`);
  if (!('cohortFallback' in r)) errs.push(`${where}: cohortFallback missing`);
  else if (typeof r.cohortFallback !== 'boolean') errs.push(`${where}: cohortFallback not boolean`);
}

// The 7 geo/classification fields carried by board + overview + survival rows.
// All are "Pflicht (nullable)" per schema-doc 3/4/5.
function validateGeo(r, where, errs) {
  checkStrOrNull(r, 'country', where, errs);
  checkStrOrNull(r, 'region', where, errs);
  checkStrOrNull(r, 'sector', where, errs);
  checkNumOrNull(r, 'marketCap', where, errs);
  checkEnumOrNull(r, 'phase', VALID_PHASE, where, errs);
  checkEnumOrNull(r, 'mcapBand', VALID_MCAP, where, errs);
  checkEnumOrNull(r, 'ipoRecency', VALID_IPO, where, errs);
  checkEnumOrNull(r, 'profitTier', VALID_PROFITTIER, where, errs); // 1.2
  checkNumOrNull(r, 'ipoYear', where, errs);                       // 1.2 (durchgereicht)
}

function validateBoardRow(r, where, errs) {
  if (!r || typeof r !== 'object') { errs.push(`${where}: not an object`); return; }
  if (typeof r.ticker !== 'string' || !r.ticker) errs.push(`${where}: ticker`);
  if (!Number.isFinite(r.score)) errs.push(`${where}: score not finite`);
  if (!Number.isInteger(r.rank) || r.rank < 1) errs.push(`${where}: rank`);
  if (!VALID_TRACK.includes(r.track)) errs.push(`${where}: track=${JSON.stringify(r.track)}`);
  if (!Array.isArray(r.lamps)) errs.push(`${where}: lamps not array`);
  // overview: Pflicht (nullable). Key must be present. If object, kind/value/companion checked.
  if (!('overview' in r)) errs.push(`${where}: overview missing`);
  else if (r.overview !== null) {
    if (typeof r.overview !== 'object') errs.push(`${where}: overview not object|null`);
    else {
      if (!VALID_OVKIND.includes(r.overview.kind)) errs.push(`${where}: overview.kind=${JSON.stringify(r.overview.kind)}`);
      if (!('value' in r.overview)) errs.push(`${where}: overview.value missing`);
      else if (r.overview.value !== null && !Number.isFinite(r.overview.value)) errs.push(`${where}: overview.value not finite|null`);
      if (!('companion' in r.overview)) errs.push(`${where}: overview.companion missing`);
      else if (r.overview.companion !== null && !Number.isFinite(r.overview.companion)) errs.push(`${where}: overview.companion not finite|null`);
    }
  }
  validateGeo(r, where, errs);
  checkCohortScored(r, where, errs); // 2.10: cohortN finite + cohortFallback boolean (Pflicht)
}

function validateOverviewRow(r, where, errs) {
  if (!r || typeof r !== 'object') { errs.push(`${where}: not an object`); return; }
  if (!Number.isInteger(r.rank) || r.rank < 1) errs.push(`${where}: rank`);
  if (typeof r.ticker !== 'string' || !r.ticker) errs.push(`${where}: ticker`);
  if (typeof r.formulaId !== 'string' || !r.formulaId) errs.push(`${where}: formulaId`);
  if (!VALID_TRACK.includes(r.track)) errs.push(`${where}: track=${JSON.stringify(r.track)}`);
  if (!Number.isFinite(r.score)) errs.push(`${where}: score not finite`);
  // FLAT overview badge fields (Pflicht nullable): kind enum, value/companion number|null.
  checkEnumOrNull(r, 'overviewKind', VALID_OVKIND, where, errs);
  checkNumOrNull(r, 'overviewValue', where, errs);
  checkNumOrNull(r, 'overviewCompanion', where, errs);
  if (!Array.isArray(r.lamps)) errs.push(`${where}: lamps not array`);
  validateGeo(r, where, errs);
  checkCohortScored(r, where, errs); // 2.10: cohortN finite + cohortFallback boolean (Pflicht)
}

function validateSurvivalRow(r, where, errs) {
  if (!r || typeof r !== 'object') { errs.push(`${where}: not an object`); return; }
  if (!Number.isInteger(r.rank) || r.rank < 1) errs.push(`${where}: rank`);
  if (typeof r.ticker !== 'string' || !r.ticker) errs.push(`${where}: ticker`);
  if (!('runwayQuarters' in r)) errs.push(`${where}: runwayQuarters missing`);
  else if (r.runwayQuarters !== null && !Number.isFinite(r.runwayQuarters)) errs.push(`${where}: runwayQuarters not finite|null`);
  if (!Array.isArray(r.lamps)) errs.push(`${where}: lamps not array`);
  validateGeo(r, where, errs);
  // 2.10: survival-Zeilen sind NIE gescort -> cohortN/cohortFallback nullable (present + null|Typ).
  checkNumOrNull(r, 'cohortN', where, errs);
  checkBoolOrNull(r, 'cohortFallback', where, errs);
}

// Hull-level coverage marker: Pflicht (value nullable). Key must be present; if
// present-and-nonnull it must be a well-typed object (schema-doc 2).
function validateCoverage(mk, kind, errs) {
  if (!('coverage' in mk)) { errs.push(`${kind}: coverage missing`); return; }
  const c = mk.coverage;
  if (c === null) return;
  if (typeof c !== 'object') { errs.push(`${kind}: coverage not object|null`); return; }
  if (!VALID_COVERAGE_STATUS.includes(c.status)) errs.push(`${kind}: coverage.status=${JSON.stringify(c.status)}`);
  if (typeof c.degraded !== 'boolean') errs.push(`${kind}: coverage.degraded not boolean`);
  if (typeof c.blocked !== 'boolean') errs.push(`${kind}: coverage.blocked not boolean`);
  if (!Number.isFinite(c.coverage_pct)) errs.push(`${kind}: coverage.coverage_pct not finite`);
}

function validateFile(mk, kind, errs) {
  if (!mk || typeof mk !== 'object') { errs.push(`${kind}: not an object`); return; }
  if (mk.schema !== SCHEMA) errs.push(`${kind}: schema=${JSON.stringify(mk.schema)}`);
  if (typeof mk.generated_at !== 'string') errs.push(`${kind}: generated_at`);
  validateCoverage(mk, kind, errs);
  if (kind === 'index') {
    if (!Number.isFinite(mk.generatedFromSnapshots)) errs.push('index: generatedFromSnapshots');
    if (!Array.isArray(mk.branches) || mk.branches.length !== BRANCHES.length) errs.push('index: branches');
    if (!mk.boardStatus || typeof mk.boardStatus !== 'object') errs.push('index: boardStatus map missing');
    else for (const [k, v] of Object.entries(mk.boardStatus)) {
      if (!VALID_BOARDSTATUS.includes(v)) errs.push(`index: boardStatus.${k}=${JSON.stringify(v)}`);
    }
    if (!mk.counts || typeof mk.counts !== 'object') errs.push('index: counts');
    if (!Number.isFinite(mk.survivalCount)) errs.push('index: survivalCount');
    if (!mk.excluded || typeof mk.excluded !== 'object') errs.push('index: excluded');
    return;
  }
  if (kind === 'survival') {
    if (!Array.isArray(mk.rows)) { errs.push('survival: rows not array'); return; }
    mk.rows.forEach((r, i) => validateSurvivalRow(r, `survival[${i}]`, errs));
    return;
  }
  if (kind === 'overview') {
    if (!Array.isArray(mk.rows)) { errs.push('overview: rows not array'); return; }
    mk.rows.forEach((r, i) => validateOverviewRow(r, `overview[${i}]`, errs));
    return;
  }
  // board file: branch (Pflicht, = filename) + profitable/unprofitable arrays of BoardRow.
  if (typeof mk.branch !== 'string' || mk.branch !== kind) errs.push(`${kind}: branch=${JSON.stringify(mk.branch)}`);
  if (!VALID_BOARDSTATUS.includes(mk.boardStatus)) errs.push(`${kind}: boardStatus=${JSON.stringify(mk.boardStatus)}`);
  if (!Array.isArray(mk.profitable)) errs.push(`${kind}: profitable not array`);
  if (!Array.isArray(mk.unprofitable)) errs.push(`${kind}: unprofitable not array`);
  (mk.profitable || []).forEach((r, i) => validateBoardRow(r, `${kind}.profitable[${i}]`, errs));
  (mk.unprofitable || []).forEach((r, i) => validateBoardRow(r, `${kind}.unprofitable[${i}]`, errs));
}

// Validate the ON-DISK export (what CI just wrote). Missing/unreadable file = breach.
function validateExport() {
  const errs = [];
  for (const id of BRANCHES) {
    const mk = readJSONOrNull(path.join(OUT_DIR, id + '.json'));
    if (!mk) { errs.push(`${id}: missing/unreadable`); continue; }
    validateFile(mk, id, errs);
  }
  for (const [name, kind] of [['overview.json', 'overview'], ['survival.json', 'survival'], ['index.json', 'index']]) {
    const mk = readJSONOrNull(path.join(OUT_DIR, name));
    if (!mk) { errs.push(`${kind}: missing/unreadable`); continue; }
    validateFile(mk, kind, errs);
  }
  return errs;
}

// ---- runnable self-check: node scripts/write-findash-export.js --selftest ----
// Exercises the ACTUAL gate blind spots the Court proved (not just trivial cases):
// every Pflicht field on every row shape must trip a violation when tampered.
function selftest() {
  const assert = require('assert');
  const cleanBoard = {
    ticker: 'NVDA', score: 88.2, track: 'profitable', lamps: ['peakMargin'],
    overview: { kind: 'gp', value: -0.055, companion: 89.1 },
    country: 'United States', region: 'North America', sector: 'Technology',
    marketCap: 5457368842240, phase: 'established', mcapBand: 'mega', ipoRecency: 'mature',
    profitTier: 'langfristig-profitabel', ipoYear: 1999,
    cohortN: 90, cohortFallback: false, // 2.10
  };
  const cleanOv = {
    ticker: 'NVDA', formulaId: 'semiconductors', track: 'profitable', score: 94.9,
    overviewKind: 'gp', overviewValue: -1.17, overviewCompanion: 195.3, lamps: [],
    country: 'United States', region: 'North America', sector: 'Technology',
    marketCap: 33018304599.802, phase: 'inflected', mcapBand: 'large', ipoRecency: 'growth',
    cohortN: 90, cohortFallback: false, // 2.10
  };
  const cleanSv = {
    ticker: 'PAH3.DE', runwayQuarters: 9999, lamps: ['burning'],
    country: 'Germany', region: 'Europe', sector: 'Consumer Cyclical',
    marketCap: null, phase: null, mcapBand: 'small', ipoRecency: null,
    cohortN: null, cohortFallback: null, // 2.10: survival nie gescort -> nullable
  };
  const cleanErrs = (fn, mapped) => { const e = []; fn(mapped, 'r', e); return e; };
  assert.strictEqual(cleanErrs(validateBoardRow, mapBoardRow(cleanBoard, 0)).length, 0, 'clean board must validate');
  assert.strictEqual(cleanErrs(validateOverviewRow, mapOverviewRow(cleanOv, 0)).length, 0, 'clean overview must validate');
  assert.strictEqual(cleanErrs(validateSurvivalRow, mapSurvivalRow(cleanSv, 0)).length, 0, 'clean survival must validate');
  // negative overview.value + null companion round-trip
  assert.strictEqual(mapBoardRow({ ...cleanBoard, overview: { kind: 'gp', value: -1.17, companion: null } }, 5).overview.value, -1.17);

  // tamper matrix — each MUST produce >=1 violation. If any slips through with 0, the gate is blind.
  const trip = (fn, row, label) => { const e = []; fn(row, 't', e); assert.ok(e.length > 0, `TAMPER SLIPPED: ${label}`); };
  const b0 = mapBoardRow(cleanBoard, 0);
  trip(validateBoardRow, { ...b0, score: NaN }, 'board score NaN');
  trip(validateBoardRow, { ...b0, track: 'ghost' }, 'board track bad enum');
  trip(validateBoardRow, { ...b0, rank: undefined }, 'board rank removed');
  const bNoCountry = { ...b0 }; delete bNoCountry.country; trip(validateBoardRow, bNoCountry, 'board country missing');
  trip(validateBoardRow, { ...b0, sector: 12345 }, 'board sector number');
  const bNoRegion = { ...b0 }; delete bNoRegion.region; trip(validateBoardRow, bNoRegion, 'board region missing');
  trip(validateBoardRow, { ...b0, marketCap: 'GARBAGE' }, 'board marketCap string');
  trip(validateBoardRow, { ...b0, phase: 'zombie' }, 'board phase bad enum');
  trip(validateBoardRow, { ...b0, mcapBand: 'huge' }, 'board mcapBand bad enum');
  trip(validateBoardRow, { ...b0, ipoRecency: 'ancient' }, 'board ipoRecency bad enum');
  trip(validateBoardRow, { ...b0, overview: { kind: 'TOTALLY-BOGUS', value: 1, companion: 1 } }, 'board overview.kind garbage');
  trip(validateBoardRow, { ...b0, overview: { kind: 'gp', value: NaN, companion: 1 } }, 'board overview.value NaN');
  trip(validateBoardRow, { ...b0, overview: { kind: 'gp', value: 1, companion: 'X' } }, 'board overview.companion garbage');
  trip(validateBoardRow, { ...b0, overview: { value: 1, companion: 1 } }, 'board overview.kind removed');
  trip(validateBoardRow, { ...b0, profitTier: 'zombie-tier' }, 'board profitTier bad enum');     // 1.2
  trip(validateBoardRow, { ...b0, ipoYear: 'GARBAGE' }, 'board ipoYear string');                 // 1.2
  const bNoTier = { ...b0 }; delete bNoTier.profitTier; trip(validateBoardRow, bNoTier, 'board profitTier missing'); // 1.2
  // 2.10: cohortN/cohortFallback Pflicht auf gescorten Zeilen (Tamper -> exit 1).
  trip(validateBoardRow, { ...b0, cohortN: 'GARBAGE' }, 'board cohortN string');
  const bNoN = { ...b0 }; delete bNoN.cohortN; trip(validateBoardRow, bNoN, 'board cohortN missing');
  trip(validateBoardRow, { ...b0, cohortFallback: 'yes' }, 'board cohortFallback non-boolean');
  const bNoFb = { ...b0 }; delete bNoFb.cohortFallback; trip(validateBoardRow, bNoFb, 'board cohortFallback missing');

  const o0 = mapOverviewRow(cleanOv, 0);
  trip(validateOverviewRow, { ...o0, track: 'ghost' }, 'overview track bad enum');
  trip(validateOverviewRow, { ...o0, overviewKind: 999 }, 'overview overviewKind number');
  trip(validateOverviewRow, { ...o0, overviewCompanion: 'GARBAGE' }, 'overview companion garbage');
  trip(validateOverviewRow, { ...o0, phase: 'zombie' }, 'overview phase bad enum');
  const oNoRank = { ...o0 }; delete oNoRank.rank; trip(validateOverviewRow, oNoRank, 'overview rank removed');
  const oNoN = { ...o0 }; delete oNoN.cohortN; trip(validateOverviewRow, oNoN, 'overview cohortN missing'); // 2.10
  trip(validateOverviewRow, { ...o0, cohortN: null }, 'overview cohortN null (scored row)');                 // 2.10

  const s0 = mapSurvivalRow(cleanSv, 0);
  const sNoRank = { ...s0 }; delete sNoRank.rank; trip(validateSurvivalRow, sNoRank, 'survival rank removed');
  trip(validateSurvivalRow, { ...s0, marketCap: 'GARBAGE' }, 'survival marketCap garbage');
  trip(validateSurvivalRow, { ...s0, phase: 'zombie' }, 'survival phase bad enum');

  // hull-level: coverage key missing / bad status, branch mismatch, boardStatus (2.1).
  const mkHull = (over = {}) => ({ schema: SCHEMA, generated_at: 'x', boardStatus: 'core', coverage: null, branch: 'energy', profitable: [], unprofitable: [], ...over });
  const mkIdx = (over = {}) => ({ schema: SCHEMA, generated_at: 'x', coverage: null, generatedFromSnapshots: 1, branches: BRANCHES, boardStatus: Object.fromEntries(BRANCHES.map(b => [b, 'core'])), counts: {}, survivalCount: 0, excluded: {}, ...over });
  let e, m;
  e = []; validateFile(mkHull(), 'energy', e); assert.strictEqual(e.length, 0, 'clean board hull must validate');
  m = mkHull(); delete m.coverage; e = []; validateFile(m, 'energy', e);
  assert.ok(e.some(x => /coverage missing/.test(x)), 'coverage key missing must trip');
  e = []; validateFile(mkHull({ branch: 'WRONG' }), 'energy', e);
  assert.ok(e.some(x => /branch=/.test(x)), 'branch mismatch must trip');
  e = []; validateFile(mkHull({ coverage: { status: 'bogus', degraded: true, blocked: false, coverage_pct: 20 } }), 'energy', e);
  assert.ok(e.some(x => /coverage\.status/.test(x)), 'bad coverage.status must trip');
  // 2.1 boardStatus gate: missing / bad enum on a board file must trip.
  m = mkHull(); delete m.boardStatus; e = []; validateFile(m, 'energy', e);
  assert.ok(e.some(x => /boardStatus/.test(x)), 'board boardStatus missing must trip');
  e = []; validateFile(mkHull({ boardStatus: 'bogus' }), 'energy', e);
  assert.ok(e.some(x => /boardStatus=/.test(x)), 'board boardStatus bad enum must trip');
  // index boardStatus map: clean passes, missing map / bad value trip.
  e = []; validateFile(mkIdx(), 'index', e); assert.strictEqual(e.length, 0, 'clean index must validate');
  e = []; validateFile(mkIdx({ boardStatus: { energy: 'bogus' } }), 'index', e);
  assert.ok(e.some(x => /boardStatus\.energy/.test(x)), 'index boardStatus bad enum must trip');
  m = mkIdx(); delete m.boardStatus; e = []; validateFile(m, 'index', e);
  assert.ok(e.some(x => /boardStatus map missing/.test(x)), 'index boardStatus map missing must trip');

  console.log('selftest OK');
}

if (require.main === module) {
  if (process.argv.includes('--selftest')) { selftest(); process.exit(0); }
  if (process.argv.includes('--check')) {
    const errs = validateExport();
    if (errs.length) {
      console.error(`::error::findash-export/v1 schema contract violation (${errs.length}): ${errs.slice(0, 20).join('; ')}`);
      process.exit(1);
    }
    console.log('findash-export/v1 schema OK.');
    process.exit(0);
  }
  const r = build();
  console.log(`findash-export/v1 written: ${r.branches} boards + overview + survival + index -> ${r.out}`);
}

module.exports = {
  build, validateExport, validateFile, validateBoardRow, validateOverviewRow, validateSurvivalRow,
  mapBoardRow, mapOverviewRow, mapSurvivalRow, SCHEMA, BRANCHES,
};
// tests/value-flags.test.js — standalone runner (node tests/value-flags.test.js, exit 0/1).
//
// Tag 1401 (value-gate rebuild PR3): a row whose ticker has an OPEN item in
// data-health/value-open-items.json carries an additive `valueFlags` list in the findash export
// (scripts/write-findash-export.js, the one applier ergaenzeWaehrungsbeleg) and in the stored
// vintage row (scripts/write-board-history.js buildBoardVintage). The flag only MARKS: no value,
// score, rank or growth changes, rows without an open item carry no key at all, closed items give
// no flag, and a missing or unreadable list means no flags plus a ::warning:: line (never a throw).
// Every case asserts presence AND absence. Hermetic: temp dirs only (L4).
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmpDirs = [];
process.once('exit', () => { for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true }); });
function mkTmp(p) { const d = fs.mkdtempSync(path.join(os.tmpdir(), p)); tmpDirs.push(d); return d; }
function writeJson(p, o) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(o)); }

// Export snapshots with a currency proof (traded in USD), so the fixture's marketCap SURVIVES the
// mapper: a mutant that blanks a flagged value is then visible (review 53c8f49, LOW test gap).
// Set before the require: write-findash-export.js reads FINDASH_SNAPSHOTS_DIR at load time.
const SNAP = mkTmp('vfs-');
for (const t of ['AAA', 'BBB', 'CLOSED']) writeJson(path.join(SNAP, t + '.json'), { meta: { tradingCurrency: 'USD', tradingCurrencyAssumed: false } });
process.env.FINDASH_SNAPSHOTS_DIR = SNAP;

const V = require('../lib/value-open-items.js');
const X = require('../scripts/write-findash-export.js');
const W = require('../scripts/write-board-history.js');
const R40 = require('../scripts/write-rule40-export.js');
const { snapshot: r40Snapshot, boardZeile, baueExport } = require('./rule40-fixture.js');

let fail = 0;
function check(name, fn) {
  try { fn(); console.log('  ok   ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + ': ' + (e && e.message || e)); }
}

// A list state in the shape scripts/value-open-items.js writes (docs/value-open-items.md).
function item(o) {
  return {
    id: o.company + '|' + o.field + '|' + o.firstSeen, company: o.company, board: 'energy', field: o.field,
    periodEnd: o.cells[0].periodEnd, acceptedValue: o.cells[0].acceptedValue, newValue: o.cells[0].newValue,
    factor: o.cells[0].factor, firstSeen: o.firstSeen, lastSeen: '2026-10-01',
    cells: o.cells.map((c) => ({ acceptedFrom: '2026-09-24', lastSeen: '2026-10-01', ...c })),
    labels: o.labels || [], status: o.status || 'open', closedBy: o.status === 'closed' ? 'acceptance:1' : null,
    closedAt: o.status === 'closed' ? '2026-10-01' : null,
  };
}
const STATE = {
  schema: V.SCHEMA, factor: 3, updatedFor: '2026-10-01',
  items: [
    item({ company: 'AAA', field: 'revenueQ', firstSeen: '2026-09-29', labels: ['korrigiert-von-uns'], cells: [
      { periodEnd: '2026-06-30', acceptedValue: 100, newValue: 400, factor: 4, firstSeen: '2026-09-29' },
      { periodEnd: '2026-03-31', acceptedValue: 90, newValue: 0, factor: null, firstSeen: '2026-09-30' },
    ] }),
    item({ company: 'AAA', field: 'marketCap', firstSeen: '2026-09-30', cells: [
      { periodEnd: null, acceptedValue: 5e9, newValue: 1e9, factor: 5, firstSeen: '2026-09-30', acceptedShares: null, newShares: 2 },
    ] }),
    item({ company: 'CLOSED', field: 'grossProfitQ', firstSeen: '2026-09-20', status: 'closed', cells: [
      { periodEnd: '2026-06-30', acceptedValue: 10, newValue: 50, factor: 5, firstSeen: '2026-09-20', closedValue: 50 },
    ] }),
  ],
};
const AAA_FLAGS = [
  { field: 'revenueQ', periodEnd: '2026-06-30', acceptedValue: 100, newValue: 400, factor: 4, firstSeen: '2026-09-29', labels: ['korrigiert-von-uns'] },
  { field: 'revenueQ', periodEnd: '2026-03-31', acceptedValue: 90, newValue: 0, factor: null, firstSeen: '2026-09-30', labels: ['korrigiert-von-uns'] },
  { field: 'marketCap', periodEnd: null, acceptedValue: 5e9, newValue: 1e9, factor: 5, firstSeen: '2026-09-30', labels: [] },
];
const FLAG_KEYS = ['field', 'periodEnd', 'acceptedValue', 'newValue', 'factor', 'firstSeen', 'labels'];

// ── 1) the helper (lib/value-open-items.js) ─────────────────────────────────
check('F1 valueFlagsByTicker: one entry per cell of every OPEN item, exact keys; closed item and unknown ticker give nothing', () => {
  const m = V.valueFlagsByTicker(STATE);
  assert.deepStrictEqual([...m.keys()], ['AAA'], 'only the ticker with an open item');
  assert.deepStrictEqual(m.get('AAA'), AAA_FLAGS);
  for (const f of m.get('AAA')) assert.deepStrictEqual(Object.keys(f), FLAG_KEYS, 'key list and order');
  assert.strictEqual(m.has('CLOSED'), false, 'a closed item gives no flag');
  m.get('AAA')[0].labels.push('x');
  assert.deepStrictEqual(STATE.items[0].labels, ['korrigiert-von-uns'], 'flags are copies, the state is not touched');
});

check('F2 readValueFlags: missing, unreadable, wrong schema -> empty map + ::warning:: line, never a throw', () => {
  const dir = mkTmp('vf-');
  const ok = path.join(dir, 'ok.json'); writeJson(ok, STATE);
  const bad = path.join(dir, 'bad.json'); fs.writeFileSync(bad, '{ not json');
  const wrong = path.join(dir, 'wrong.json'); writeJson(wrong, { schema: 'other', items: [] });
  const warns = [];
  const w = (s) => warns.push(s);
  assert.deepStrictEqual([...V.readValueFlags(ok, w).keys()], ['AAA']);
  assert.strictEqual(warns.length, 0, 'a good list warns nothing');
  for (const f of [path.join(dir, 'absent.json'), bad, wrong]) {
    const n = warns.length;
    const m = V.readValueFlags(f, w);
    assert.strictEqual(m.size, 0, 'no flags from ' + path.basename(f));
    assert.strictEqual(warns.length, n + 1, 'one warning for ' + path.basename(f));
    assert.ok(warns[n].startsWith('::warning::'), 'warning line: ' + warns[n]);
  }
});

check('F3 readAcceptances: acceptedAt must be a real calendar day (round trip), not only the YYYY-MM-DD shape', () => {
  const entry = (acceptedAt) => ({ itemId: 'A|revenueQ|2026-09-29', value: 100, acceptedAt, reason: 'r' });
  const r = V.readAcceptances({ acceptances: [entry('2026-13-45'), entry('2026-02-30'), entry('2026-02-28'), entry('2028-02-29'), entry('2026-9-01')] });
  assert.deepStrictEqual(r.entries.map((e) => e.acceptedAt), ['2026-02-28', '2028-02-29'], 'only real days are kept');
  assert.strictEqual(r.warnings.length, 3, 'one warning per rejected entry');
  assert.ok(r.warnings.every((w) => w.includes('real calendar day')), 'warning names the rule: ' + r.warnings[0]);
});

check('F4 readValueFlags: a malformed CELL in a schema-valid list is dropped with a ::warning::, the other cells stay', () => {
  const dir = mkTmp('vfm-');
  const st = JSON.parse(JSON.stringify(STATE));
  st.items[0].cells[0].firstSeen = '01.10.2026';
  const file = path.join(dir, 'l.json'); writeJson(file, st);
  V.validateState(JSON.parse(fs.readFileSync(file, 'utf8')));   // the list itself is schema-valid
  const warns = [];
  const m = V.readValueFlags(file, (s) => warns.push(s));
  assert.deepStrictEqual(m.get('AAA'), AAA_FLAGS.slice(1), 'only the bad cell is dropped');
  assert.strictEqual(warns.length, 1, 'one warning: ' + warns.join(' | '));
  assert.ok(warns[0].startsWith('::warning::') && warns[0].includes('AAA'), warns[0]);
  for (const f of m.get('AAA')) assert.deepStrictEqual(V.valueFlagProblems(f), [], 'kept flags pass the contract rule');
  // every cell bad -> the ticker carries no key at all (absence, never an empty list)
  st.items[0].cells[1].firstSeen = 'x'; st.items[1].cells[0].factor = 2;
  writeJson(file, st);
  assert.strictEqual(V.readValueFlags(file, () => {}).has('AAA'), false);
});

check('F5 readValueFlags: a list not written for the run day warns (stale list), flags still mark', () => {
  const dir = mkTmp('vfd-');
  const file = path.join(dir, 'l.json'); writeJson(file, STATE);
  const warns = [];
  assert.strictEqual(V.readValueFlags(file, (s) => warns.push(s), '2026-10-01').size, 1);
  assert.strictEqual(warns.length, 0, 'same day: no warning');
  assert.strictEqual(V.readValueFlags(file, (s) => warns.push(s), '2026-10-02').size, 1, 'stale list still marks');
  assert.strictEqual(warns.length, 1);
  assert.ok(warns[0].startsWith('::warning::') && warns[0].includes('2026-10-01') && warns[0].includes('2026-10-02'), warns[0]);
});

// ── 2) the export (scripts/write-findash-export.js) ─────────────────────────
const boardRow = (ticker) => ({
  ticker, name: 'Fixture ' + ticker, score: 88.2, track: 'profitable', lamps: [],
  overview: { kind: 'gp', value: 0.4, companion: 50 }, country: 'United States', region: 'North America',
  sector: 'Technology', marketCap: 5e9, phase: 'established', mcapBand: 'mega', ipoRecency: 'mature',
  profitTier: 'langfristig-profitabel', ipoYear: 1999, cohortN: 90, cohortFallback: false, coverageAxes: '7/7',
  revGrowthYoYPct: 25,
});
const ovRow = (ticker) => ({ ...boardRow(ticker), formulaId: 'energy', overviewKind: 'gp', overviewValue: 0.4, overviewCompanion: 50, overview: undefined });
const svRow = (ticker) => ({ ticker, name: 'Fixture ' + ticker, runwayQuarters: 9999, lamps: [], country: 'Germany', region: 'Europe',
  sector: 'Consumer Cyclical', marketCap: null, phase: null, mcapBand: 'small', ipoRecency: null, cohortN: null, cohortFallback: null });
const without = (r) => { const c = { ...r }; delete c.valueFlags; return c; };

check('E1 export rows: flagged ticker carries valueFlags (all three mappers), others have no key; everything else identical', () => {
  const dir = mkTmp('vfx-');
  const file = path.join(dir, 'value-open-items.json'); writeJson(file, STATE);
  const cases = [[X.mapBoardRow, boardRow], [X.mapOverviewRow, ovRow], [X.mapSurvivalRow, svRow]];
  X.ladeValueFlags(path.join(dir, 'absent.json'), () => {});
  const plain = cases.map(([fn, mk]) => [fn(mk('AAA'), 0), fn(mk('BBB'), 1), fn(mk('CLOSED'), 2)]);
  assert.strictEqual(X.ladeValueFlags(file, () => {}), 1, 'one flagged ticker loaded');
  const flagged = cases.map(([fn, mk]) => [fn(mk('AAA'), 0), fn(mk('BBB'), 1), fn(mk('CLOSED'), 2)]);
  for (let i = 0; i < cases.length; i++) {
    const [a, b, c] = flagged[i];
    assert.deepStrictEqual(a.valueFlags, AAA_FLAGS, 'flagged row carries the open cells');
    assert.strictEqual(Object.keys(a).filter((k) => k === 'valueFlags').length, 1);
    assert.strictEqual('valueFlags' in b, false, 'row without an item: no key (absence, not an empty array)');
    assert.strictEqual('valueFlags' in c, false, 'closed item: no key');
    assert.deepStrictEqual(without(a), plain[i][0], 'only valueFlags differs');
    assert.strictEqual(JSON.stringify(without(a)), JSON.stringify(plain[i][0]), 'byte-identical without the key');
    assert.deepStrictEqual(b, plain[i][1]); assert.deepStrictEqual(c, plain[i][2]);
    for (const k of ['valueFlags']) assert.strictEqual(k in plain[i][0], false, 'no list loaded -> no key');
    if (i < 2) {   // board + overview mapper: the flagged values survive, so blanking them would show
      assert.strictEqual(a.marketCap, 5e9, 'flagged marketCap kept, not blanked');
      assert.strictEqual(a.revGrowthYoYPct, 25, 'flagged growth kept, not blanked');
    }
  }
  X.ladeValueFlags(path.join(dir, 'absent.json'), () => {});
  assert.strictEqual('valueFlags' in X.mapBoardRow(boardRow('AAA'), 0), false, 'reloading a missing list clears the flags');
});

check('E2 export --check: valid valueFlags pass, absence passes, malformed lists trip (both directions)', () => {
  const dir = mkTmp('vfc-');
  const file = path.join(dir, 'value-open-items.json'); writeJson(file, STATE);
  X.ladeValueFlags(file, () => {});
  const a = X.mapBoardRow(boardRow('AAA'), 0);
  X.ladeValueFlags(path.join(dir, 'absent.json'), () => {});
  const errsOf = (r) => { const e = []; X.validateBoardRow(r, 'r', e); return e; };
  assert.deepStrictEqual(errsOf(a), [], 'flagged row validates');
  assert.deepStrictEqual(errsOf(without(a)), [], 'row without the key validates');
  const f0 = a.valueFlags[0];
  const bad = [
    [[], 'empty array'], ['x', 'not an array'], [[{ ...f0, field: 'score' }], 'unknown field'],
    [[{ ...f0, periodEnd: '2026-6-30' }], 'periodEnd not an ISO day'], [[{ ...f0, periodEnd: null }], 'quarterly cell without periodEnd'],
    [[{ ...a.valueFlags[2], periodEnd: '2026-06-30' }], 'marketCap cell with periodEnd'], [[{ ...f0, acceptedValue: 0 }], 'acceptedValue 0'],
    [[{ ...f0, newValue: -1 }], 'newValue negative'], [[{ ...f0, factor: 2 }], 'factor below 3'], [[{ ...f0, factor: null }], 'factor null with newValue > 0'],
    [[{ ...f0, firstSeen: 'gestern' }], 'firstSeen not a day'], [[{ ...f0, labels: ['frei erfunden'] }], 'unknown label'],
    [[{ ...f0, labels: undefined }], 'labels missing'],
  ];
  for (const [vf, label] of bad) assert.ok(errsOf({ ...a, valueFlags: vf }).length > 0, 'TAMPER SLIPPED: ' + label);
  const ov = X.mapOverviewRow(ovRow('BBB'), 0);
  const e = []; X.validateOverviewRow({ ...ov, valueFlags: 'x' }, 'o', e);
  assert.ok(e.length > 0, 'overview rows are checked too');
  const s = []; X.validateSurvivalRow({ ...X.mapSurvivalRow(svRow('BBB'), 0), valueFlags: [] }, 's', s);
  assert.ok(s.length > 0, 'survival rows are checked too');
});

// ── 3) the stored vintage row (scripts/write-board-history.js) ───────────────
function bhBase() {
  const base = mkTmp('vfb-');
  fs.mkdirSync(path.join(base, 'snapshots'), { recursive: true });
  writeJson(path.join(base, 'outputs', 'calibration.json'), { schema: 'calibration/v4', generated_at: 'x' });
  const row = (ticker, score) => ({ ticker, score, track: 'profitable', coverageAxes: '7/7', lamps: [] });
  writeJson(path.join(base, 'outputs', 'hypergrowth', 'full', 'energy.json'),
    { profitable: [row('AAA', 90), row('BBB', 80), row('CLOSED', 70)], unprofitable: [] });
  return base;
}
const readV = (base) => JSON.parse(fs.readFileSync(path.join(base, 'board-history', '2026-07-13', 'energy.json'), 'utf8'));
const rowsOf = (v) => v.cohort.profitable;

check('B1 buildBoardVintage: flags map -> valueFlags as LAST key of the flagged row only; no map -> no key anywhere', () => {
  const data = { profitable: [{ ticker: 'AAA', score: 90 }, { ticker: 'BBB', score: 80 }], unprofitable: [{ ticker: 'CLOSED', score: 20 }] };
  const plain = W.buildBoardVintage('energy', data, '2026-07-13', {}, null);
  const flagged = W.buildBoardVintage('energy', data, '2026-07-13', {}, null, V.valueFlagsByTicker(STATE));
  const [a, b] = flagged.cohort.profitable; const c = flagged.cohort.unprofitable[0];
  assert.deepStrictEqual(a.valueFlags, AAA_FLAGS);
  const keys = Object.keys(a);
  assert.strictEqual(keys[keys.length - 1], 'valueFlags', 'last key');
  assert.strictEqual('valueFlags' in b, false); assert.strictEqual('valueFlags' in c, false);
  for (const r of [...plain.cohort.profitable, ...plain.cohort.unprofitable]) assert.strictEqual('valueFlags' in r, false, 'no map -> no key');
  assert.strictEqual(JSON.stringify(without(a)), JSON.stringify(plain.cohort.profitable[0]), 'row byte-identical without the key');
  const strip = (v) => JSON.stringify({ ...v, cohort: { profitable: v.cohort.profitable.map(without), unprofitable: v.cohort.unprofitable.map(without) } });
  assert.strictEqual(strip(flagged), JSON.stringify(plain), 'vintage byte-identical except valueFlags');
});

check('B2 run(): reads data-health/value-open-items.json of the same base; flags only the open-item row', () => {
  const base = bhBase();
  writeJson(path.join(base, 'data-health', 'value-open-items.json'), STATE);
  W.run({ baseDir: base, date: '2026-07-13' });
  const [a, b, c] = rowsOf(readV(base));
  assert.deepStrictEqual(a.valueFlags, AAA_FLAGS);
  assert.strictEqual('valueFlags' in b, false); assert.strictEqual('valueFlags' in c, false, 'closed item: no flag');
});

check('B3 run(): missing or unreadable list -> vintage written without any valueFlags, ::warning:: logged, no throw', () => {
  for (const content of [null, '{ broken']) {
    const base = bhBase();
    if (content !== null) { fs.mkdirSync(path.join(base, 'data-health'), { recursive: true }); fs.writeFileSync(path.join(base, 'data-health', 'value-open-items.json'), content); }
    const logs = [];
    const orig = console.warn; console.warn = (s) => logs.push(String(s));
    let res;
    try { res = W.run({ baseDir: base, date: '2026-07-13' }); } finally { console.warn = orig; }
    assert.strictEqual(res.exitCode, 0, 'run still succeeds');
    assert.ok(rowsOf(readV(base)).every((r) => !('valueFlags' in r)), 'no row flagged');
    assert.ok(logs.some((l) => l.startsWith('::warning::') && l.includes('value-open-items')), 'warning line logged: ' + logs.join(' | '));
  }
});

check('B4 run(): the flagged row keeps its pit values (marketCap, revenueQ); the vintage equals an unflagged run except valueFlags', () => {
  const runOnce = (withList) => {
    const base = bhBase();
    writeJson(path.join(base, 'snapshots', 'AAA.json'), { meta: {}, marketCap: { value: 7e9 },
      timeseries: { revenueQ: [{ value: 400 }, { value: 100 }], revenueQEnds: ['2026-06-30', '2026-03-31'] } });
    if (withList) writeJson(path.join(base, 'data-health', 'value-open-items.json'), STATE);
    const orig = console.warn; console.warn = () => {};
    try { W.run({ baseDir: base, date: '2026-07-13' }); } finally { console.warn = orig; }
    return readV(base);
  };
  const plain = runOnce(false);
  const flagged = runOnce(true);
  const a = rowsOf(flagged)[0];
  assert.deepStrictEqual(a.valueFlags, AAA_FLAGS);
  assert.strictEqual(a.pit.marketCap, 7e9, 'flagged pit.marketCap kept, not blanked');
  assert.strictEqual(a.pit.revenueQ[0], 400, 'flagged pit.revenueQ kept, not blanked');
  const strip = (v) => JSON.stringify({ ...v, cohort: { ...v.cohort, profitable: v.cohort.profitable.map(without), unprofitable: v.cohort.unprofitable.map(without) } });
  assert.strictEqual(strip(flagged), strip(plain), 'vintage identical except valueFlags');
});

// ── 4) the rule40 board (scripts/write-rule40-export.js, review 53c8f49 MEDIUM) ───────────
// On-board names inherit the flags of their full-board row (written by the main export from the
// same list); names without a board row get them from the list file; absence otherwise.
function r40Fixture(withFlagsOnRow) {
  const f = baueExport([
    { row: boardZeile({ ticker: 'AAA', revGrowthYoYPct: 60, ...(withFlagsOnRow ? { valueFlags: AAA_FLAGS } : {}) }) },
    { row: boardZeile({ ticker: 'BBB', revGrowthYoYPct: 40, name: 'Beta AG' }) },
  ]);
  tmpDirs.push(f.dir);
  for (const t of ['OFF', 'CLOSED']) {   // no board row: off-board names of the routed universe
    const s = r40Snapshot({ ticker: t }); s.meta.name = t + ' Corp';
    writeJson(path.join(f.snapshotsDir, t + '.json'), s);
  }
  return f;
}
const OFF_FLAG = { field: 'grossProfitQ', periodEnd: '2026-06-30', acceptedValue: 10, newValue: 60, factor: 6, firstSeen: '2026-09-28', labels: ['nicht-auf-board'] };
const STATE_R40 = { ...STATE, items: [...STATE.items, item({ company: 'OFF', field: 'grossProfitQ', firstSeen: '2026-09-28', labels: ['nicht-auf-board'], cells: [
  { periodEnd: '2026-06-30', acceptedValue: 10, newValue: 60, factor: 6, firstSeen: '2026-09-28' }] })] };
const r40Rows = (f) => JSON.parse(fs.readFileSync(path.join(f.outDir, 'overview.json'), 'utf8')).rows;

check('R1 rule40 rows: on-board flags from the board row, off-board flags from the list; no key otherwise; nothing else changes', () => {
  const f = r40Fixture(true);
  const list = path.join(f.dir, 'value-open-items.json'); writeJson(list, STATE_R40);
  R40.build({ v1Dir: f.v1Dir, snapshotsDir: f.snapshotsDir, outDir: f.outDir, valueOpenItemsFile: list });
  const rows = r40Rows(f);
  const by = new Map(rows.map((r) => [r.ticker, r]));
  assert.deepStrictEqual([...by.keys()].sort(), ['AAA', 'BBB', 'CLOSED', 'OFF'], 'fixture: all four on the board');
  assert.deepStrictEqual(by.get('AAA').valueFlags, AAA_FLAGS, 'on-board row carries its flags');
  assert.deepStrictEqual(by.get('OFF').valueFlags, [OFF_FLAG], 'off-board row carries the list flags');
  assert.strictEqual('valueFlags' in by.get('BBB'), false, 'no item: no key');
  assert.strictEqual('valueFlags' in by.get('CLOSED'), false, 'closed item: no key');
  const res = R40.check({ v1Dir: f.v1Dir, outDir: f.outDir });
  assert.ok(res.ok, 'check accepts valid valueFlags: ' + (res.errors || []).join(' | '));
  // same inputs without any flag source: identical board except valueFlags
  const g = r40Fixture(false);
  R40.build({ v1Dir: g.v1Dir, snapshotsDir: g.snapshotsDir, outDir: g.outDir });
  assert.deepStrictEqual(rows.map(without), r40Rows(g), 'only valueFlags differs');
});

check('R2 rule40 --check: a malformed valueFlags on a written row trips the gate', () => {
  const f = r40Fixture(true);
  R40.build({ v1Dir: f.v1Dir, snapshotsDir: f.snapshotsDir, outDir: f.outDir });
  const p = path.join(f.outDir, 'overview.json');
  const ov = JSON.parse(fs.readFileSync(p, 'utf8'));
  ov.rows.find((r) => r.ticker === 'AAA').valueFlags = [];
  fs.writeFileSync(p, JSON.stringify(ov));
  const res = R40.check({ v1Dir: f.v1Dir, outDir: f.outDir });
  assert.ok(!res.ok && res.errors.some((e) => e.includes('valueFlags')), 'TAMPER SLIPPED: ' + JSON.stringify(res.errors));
});

check('R3 rule40 CLI main(): reads the open-items list (off-board flags reach the written board)', () => {
  const f = r40Fixture(false);
  const list = path.join(f.dir, 'value-open-items.json'); writeJson(list, STATE_R40);
  const env = { ...process.env };
  Object.assign(process.env, { RULE40_V1_DIR: f.v1Dir, RULE40_SNAPSHOTS_DIR: f.snapshotsDir, RULE40_OUT_DIR: f.outDir });
  const log = console.log, warn = console.warn; console.log = () => {}; console.warn = () => {};
  let rc;
  try {
    // the default path is taken at load time: load a fresh copy with the seam set
    process.env.RULE40_VALUE_OPEN_ITEMS_FILE = list;
    delete require.cache[require.resolve('../scripts/write-rule40-export.js')];
    rc = require('../scripts/write-rule40-export.js').main([]);
  } finally {
    console.log = log; console.warn = warn;
    for (const k of ['RULE40_V1_DIR', 'RULE40_SNAPSHOTS_DIR', 'RULE40_OUT_DIR', 'RULE40_VALUE_OPEN_ITEMS_FILE']) {
      if (k in env) process.env[k] = env[k]; else delete process.env[k];
    }
  }
  assert.strictEqual(rc, 0);
  const by = new Map(r40Rows(f).map((r) => [r.ticker, r]));
  assert.deepStrictEqual(by.get('OFF').valueFlags, [OFF_FLAG], 'CLI passes the list to build()');
  assert.strictEqual('valueFlags' in by.get('BBB'), false);
});

// ── 5) total read path (review 6a64562 N1 MEDIUM) ─────────────────────────────
// Owner rule: the list can NEVER fail or change the export, the rule40 board or the vintage.
// Every shape surprise gives no flag for the affected cell / item (or for the whole list when it
// cannot be read), one ::warning:: line, and never a throw. Each variant runs through the reader,
// the export mapper, the rule40 build seam and the vintage writer.
const cellA = STATE.items[0].cells[0];
const noPeriodEnd = { ...cellA }; delete noPeriodEnd.periodEnd;
const plus = (fn) => { const s = JSON.parse(JSON.stringify(STATE_R40)); fn(s); return JSON.stringify(s); };
const BBB_ITEM = () => item({ company: 'BBB', field: 'revenueQ', firstSeen: '2026-09-29', cells: [cellA] });
const VARIANTS = [
  // [name, file content, expected flags (true = AAA and OFF keep their valid flags), warnings]
  ['null cell', plus((s) => s.items[0].cells.push(null)), true, 1],
  ['string cell', plus((s) => s.items[0].cells.push('x')), true, 1],
  ['cell without periodEnd', plus((s) => s.items[0].cells.push(noPeriodEnd)), true, 1],
  ['null item', plus((s) => s.items.push(null)), true, 1],
  ['cells not an array', plus((s) => { const b = BBB_ITEM(); b.cells = 'x'; s.items.push(b); }), true, 1],
  ['item without company', plus((s) => { const b = BBB_ITEM(); delete b.company; s.items.push(b); }), true, 1],
  ['UTF-8 BOM', '﻿' + JSON.stringify(STATE_R40), true, 0],
  ['empty file', '', false, 1],
];
for (const [name, content, keeps, nWarn] of VARIANTS) {
  check('T1 ' + name + ': reader, export mapper, rule40 and vintage do not throw and attach only valid flags', () => {
    const dir = mkTmp('vft-');
    const file = path.join(dir, 'value-open-items.json'); fs.writeFileSync(file, content);
    // reader
    const warns = [];
    let m;
    assert.doesNotThrow(() => { m = V.readValueFlags(file, (s) => warns.push(s)); }, 'reader throws');
    assert.deepStrictEqual([...m.keys()].sort(), keeps ? ['AAA', 'OFF'] : [], 'flagged tickers');
    if (keeps) { assert.deepStrictEqual(m.get('AAA'), AAA_FLAGS); assert.deepStrictEqual(m.get('OFF'), [OFF_FLAG]); }
    for (const fl of m.values()) for (const f of fl) assert.deepStrictEqual(V.valueFlagProblems(f), [], 'only valid flags');
    assert.strictEqual(warns.length, nWarn, 'warnings: ' + warns.join(' | '));
    assert.ok(warns.every((w) => w.startsWith('::warning::')), warns.join(' | '));
    // export mapper
    assert.doesNotThrow(() => X.ladeValueFlags(file, () => {}), 'export load throws');
    const a = X.mapBoardRow(boardRow('AAA'), 0);
    if (keeps) assert.deepStrictEqual(a.valueFlags, AAA_FLAGS); else assert.strictEqual('valueFlags' in a, false);
    assert.strictEqual('valueFlags' in X.mapBoardRow(boardRow('BBB'), 1), false, 'BBB never flagged');
    const e = []; X.validateBoardRow(a, 'r', e); assert.deepStrictEqual(e, [], 'export row passes --check');
    X.ladeValueFlags(path.join(dir, 'absent.json'), () => {});
    // rule40 seam (off-board flags come from the list)
    const f = r40Fixture(false);
    const warn = console.warn; console.warn = () => {};
    try { R40.build({ v1Dir: f.v1Dir, snapshotsDir: f.snapshotsDir, outDir: f.outDir, valueOpenItemsFile: file }); } finally { console.warn = warn; }
    const by = new Map(r40Rows(f).map((r) => [r.ticker, r]));
    if (keeps) assert.deepStrictEqual(by.get('OFF').valueFlags, [OFF_FLAG]); else assert.strictEqual('valueFlags' in by.get('OFF'), false);
    assert.strictEqual('valueFlags' in by.get('BBB'), false);
    assert.ok(R40.check({ v1Dir: f.v1Dir, outDir: f.outDir }).ok, 'rule40 --check stays green');
    // vintage writer
    const base = bhBase();
    fs.mkdirSync(path.join(base, 'data-health'), { recursive: true });
    fs.writeFileSync(path.join(base, 'data-health', 'value-open-items.json'), content);
    let res;
    console.warn = () => {};
    try { res = W.run({ baseDir: base, date: '2026-07-13' }); } finally { console.warn = warn; }
    assert.strictEqual(res.exitCode, 0, 'vintage exit code unchanged');
    const [va, vb] = rowsOf(readV(base));
    if (keeps) assert.deepStrictEqual(va.valueFlags, AAA_FLAGS); else assert.strictEqual('valueFlags' in va, false);
    assert.strictEqual('valueFlags' in vb, false);
  });
}

// ── 6) stale-warning wiring in the callers (review 6a64562 N2 LOW) ────────────
const staleWarns = (logs) => logs.filter((l) => l.startsWith('::warning::value flags') && l.includes('not for the run day'));

check('W1 vintage run(): passes the run date to the reader (a list for another day warns, the same day does not)', () => {
  for (const [updatedFor, n] of [['2026-07-13', 0], ['2026-07-12', 1]]) {
    const base = bhBase();
    writeJson(path.join(base, 'data-health', 'value-open-items.json'), { ...STATE, updatedFor });
    const logs = [];
    const orig = console.warn; console.warn = (s) => logs.push(String(s));
    try { W.run({ baseDir: base, date: '2026-07-13' }); } finally { console.warn = orig; }
    const st = staleWarns(logs);
    assert.strictEqual(st.length, n, 'list for ' + updatedFor + ': ' + logs.join(' | '));
    if (n) assert.ok(st[0].includes('2026-07-13'), st[0]);
    assert.deepStrictEqual(rowsOf(readV(base))[0].valueFlags, AAA_FLAGS, 'flags still mark');
  }
});

check('W2 export build(): loads the list before the mappers and passes the run day (stale warning)', () => {
  const dir = mkTmp('vfw-');
  const file = path.join(dir, 'value-open-items.json');
  const missingIndex = path.join(dir, 'no-index.json');   // stops build() right after the load, before any write
  for (const [updatedFor, n] of [['2026-10-02', 0], ['2026-10-01', 1]]) {
    writeJson(file, { ...STATE, updatedFor });
    X.ladeValueFlags(path.join(dir, 'absent.json'), () => {});
    const logs = [];
    const w = console.warn, l = console.log; console.warn = (s) => logs.push(String(s)); console.log = () => {};
    try {
      assert.throws(() => X.build({ valueOpenItemsFile: file, now: new Date('2026-10-02T12:00:00Z'), sourceIndexFile: missingIndex }), /ENOENT|no-index/);
    } finally { console.warn = w; console.log = l; }
    const st = staleWarns(logs);
    assert.strictEqual(st.length, n, 'list for ' + updatedFor + ': ' + logs.join(' | '));
    if (n) assert.ok(st[0].includes('2026-10-02'), st[0]);
    assert.deepStrictEqual(X.mapBoardRow(boardRow('AAA'), 0).valueFlags, AAA_FLAGS, 'build() loaded the list');
  }
  X.ladeValueFlags(path.join(dir, 'absent.json'), () => {});
});

W._setPaths();
console.log(fail ? `\n${fail} FAIL` : '\nall ok');
process.exit(fail ? 1 : 0);

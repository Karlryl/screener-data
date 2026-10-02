// tests/value-open-items.test.js — standalone runner (node tests/value-open-items.test.js, exit 0/1).
//
// Tag 1398 (value-gate rebuild PR2): sticky open-items list for stored values that jump by more
// than factor 3 against their last accepted value (lib/value-open-items.js, scripts/value-open-items.js).
// Every case asserts presence AND absence. Synthetic cases are hermetic (temp dirs, L4); the
// real-data cases read the committed board-history and skip visibly when it is absent (L12).
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const V = require('../lib/value-open-items.js');
const S = require('../scripts/value-open-items.js');

const REPO = path.resolve(__dirname, '..');
let fail = 0, skipped = 0;
function check(name, fn) {
  try { fn(); console.log('  ok   ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + ': ' + (e && e.message || e)); }
}
function skip(name, why) { skipped++; console.log('  SKIP ' + name + ': ' + why); }

const fixtureDirs = [];
process.once('exit', () => { for (const d of fixtureDirs) fs.rmSync(d, { recursive: true, force: true }); });

// ── helpers ─────────────────────────────────────────────────────────────────
// pit({ rev: [[end, v]...], gp: [[end, v]...], mcap, shares })
function pit(o) {
  const p = { revenueQ: [], revenueQEnds: [], grossProfitQ: [], grossProfitQEnds: [], marketCap: o.mcap === undefined ? null : o.mcap };
  for (const [e, v] of o.rev || []) { p.revenueQEnds.push(e); p.revenueQ.push(v); }
  for (const [e, v] of o.gp || []) { p.grossProfitQEnds.push(e); p.grossProfitQ.push(v); }
  if (o.shares !== undefined) p.sharesOutstanding = o.shares;
  return p;
}
// board file: rows = { TICKER: pitObject }
function boardFile(rows, board = 'energy', gate) {
  return { board, gate: gate || { suspect: false, reasons: [] },
    cohort: { profitable: Object.entries(rows).map(([ticker, p]) => ({ ticker, pit: p })), unprofitable: [] } };
}
const rowsOf = (rows) => V.dayRows([boardFile(rows)]);
const NO_TABLES = V.buildTables({});

// One run over in-memory days: history = [[date, rows]...] (oldest first), today = rows.
function step(prior, date, today, history, opts = {}) {
  const index = new Map();
  for (const [d, rows] of history) V.indexVintage(index, rowsOf(rows), d);
  return V.updateOpenItems({ date, today: opts.todayRows || rowsOf(today), index, prior: prior || V.emptyState(),
    acceptances: opts.acceptances || [], tables: opts.tables || NO_TABLES });
}
const openItems = (s) => s.items.filter((it) => it.status === 'open');
const Q = '2026-06-30';

// ── 1) the hit rule ─────────────────────────────────────────────────────────
check('H1 factor 3.01 opens, exactly 3.0 does not (both directions)', () => {
  const hist = [['2026-09-01', { UP: pit({ rev: [[Q, 100]] }), DOWN: pit({ rev: [[Q, 301]] }), EQ: pit({ rev: [[Q, 100]] }), EQD: pit({ rev: [[Q, 300]] }) }]];
  const r = step(null, '2026-09-02', { UP: pit({ rev: [[Q, 301]] }), DOWN: pit({ rev: [[Q, 100]] }), EQ: pit({ rev: [[Q, 300]] }), EQD: pit({ rev: [[Q, 100]] }) }, hist);
  const ids = r.state.items.map((it) => it.company).sort();
  assert.deepStrictEqual(ids, ['DOWN', 'UP'], 'only the strict >3 moves open');
  const up = r.state.items.find((it) => it.company === 'UP');
  assert.strictEqual(up.acceptedValue, 100); assert.strictEqual(up.newValue, 301); assert.strictEqual(up.factor, 3.01);
  assert.strictEqual(up.periodEnd, Q); assert.strictEqual(up.status, 'open'); assert.strictEqual(up.id, 'UP|revenueQ|2026-09-02');
});

check('H2 value to 0 opens (factor null); value null, negative, fill, new period, unseen ticker do not', () => {
  const hist = [['2026-09-01', {
    ZERO: pit({ gp: [[Q, 50]] }), NUL: pit({ gp: [[Q, 50]] }), NEG: pit({ gp: [[Q, 50]] }),
    FILL0: pit({ gp: [[Q, 0]] }), FILLN: pit({ gp: [[Q, null]] }), NEWP: pit({ gp: [[Q, 50]] }),
  }]];
  const r = step(null, '2026-09-02', {
    ZERO: pit({ gp: [[Q, 0]] }), NUL: pit({ gp: [[Q, null]] }), NEG: pit({ gp: [[Q, -40]] }),
    FILL0: pit({ gp: [[Q, 900]] }), FILLN: pit({ gp: [[Q, 900]] }), NEWP: pit({ gp: [[Q, 50], ['2026-09-30', 999]] }),
    UNSEEN: pit({ gp: [[Q, 1e9]] }),
  }, hist);
  assert.deepStrictEqual(r.state.items.map((it) => it.company), ['ZERO'], 'only the zero opens');
  assert.strictEqual(r.state.items[0].factor, null, 'factor null for a zero');
  assert.strictEqual(r.state.items[0].newValue, 0);
});

check('H3 marketCap key without period; one item per ticker+field, several quarters join as cells', () => {
  const hist = [['2026-09-01', { A: pit({ rev: [[Q, 100], ['2026-03-31', 90]], mcap: 1e9 }) }]];
  const r = step(null, '2026-09-02', { A: pit({ rev: [[Q, 500], ['2026-03-31', 900]], mcap: 5e9 }) }, hist);
  const rev = r.state.items.find((it) => it.field === 'revenueQ');
  const mc = r.state.items.find((it) => it.field === 'marketCap');
  assert.strictEqual(r.state.items.length, 2, 'one revenue item + one marketCap item');
  assert.strictEqual(rev.cells.length, 2, 'both quarters are cells of ONE item');
  assert.strictEqual(rev.periodEnd, '2026-03-31', 'headline = cell with the largest factor (10 > 5)');
  assert.strictEqual(rev.factor, 10);
  assert.strictEqual(mc.periodEnd, null); assert.strictEqual(mc.cells[0].periodEnd, null);
});

// ── 2) sticky ───────────────────────────────────────────────────────────────
check('S1 sticky: next day still bad -> no second item, compared to acceptedValue (not to the new base)', () => {
  const d1 = { A: pit({ rev: [[Q, 400]] }) };
  const r1 = step(null, '2026-09-02', d1, [['2026-09-01', { A: pit({ rev: [[Q, 100]] }) }]]);
  // Day 3: 450 is 4.5x the accepted 100 but only 1.1x the stored base 400.
  const r2 = step(r1.state, '2026-09-03', { A: pit({ rev: [[Q, 450]] }) }, [['2026-09-01', { A: pit({ rev: [[Q, 100]] }) }], ['2026-09-02', d1]]);
  assert.strictEqual(r2.state.items.length, 1, 'no second item');
  const it = r2.state.items[0];
  assert.strictEqual(it.acceptedValue, 100, 'accepted value unchanged');
  assert.strictEqual(it.newValue, 450, 'compared to acceptedValue: still a hit, newValue follows');
  assert.strictEqual(it.factor, 4.5);
  assert.strictEqual(it.lastSeen, '2026-09-03');
  assert.strictEqual(it.firstSeen, '2026-09-02');
  assert.strictEqual(r2.summary.new, 0);
});

check('S2 return to the accepted value -> label zurueckgekehrt, item stays open; leaving again drops the label', () => {
  const h = [['2026-09-01', { A: pit({ rev: [[Q, 100]] }) }]];
  const r1 = step(null, '2026-09-02', { A: pit({ rev: [[Q, 400]] }) }, h);
  const r2 = step(r1.state, '2026-09-03', { A: pit({ rev: [[Q, 105]] }) }, h);
  assert.strictEqual(r2.state.items[0].status, 'open', 'returning never closes');
  assert.deepStrictEqual(r2.state.items[0].labels, ['zurueckgekehrt']);
  assert.strictEqual(r2.state.items[0].lastSeen, '2026-09-02', 'lastSeen = last day still more than factor 3 away');
  const r3 = step(r2.state, '2026-09-04', { A: pit({ rev: [[Q, 400]] }) }, h);
  assert.deepStrictEqual(r3.state.items[0].labels, [], 'label describes today only');
  assert.strictEqual(r3.state.items.length, 1);
});

check('S3 400 days later still open (never closed by time), absent ticker gets nicht-auf-board', () => {
  const h = [['2026-09-01', { A: pit({ mcap: 1e9 }) }]];
  const r1 = step(null, '2026-09-02', { A: pit({ mcap: 9e9 }) }, h);
  const later = step(r1.state, '2027-10-07', { B: pit({ mcap: 1 }) }, h);
  assert.strictEqual(later.state.items[0].status, 'open', 'still open after 400 days');
  assert.strictEqual(later.state.items[0].closedBy, null);
  assert.deepStrictEqual(later.state.items[0].labels, ['nicht-auf-board']);
  const back = step(r1.state, '2027-10-07', { A: pit({ mcap: 9e9 }) }, h);
  assert.strictEqual(back.state.items[0].status, 'open');
  assert.ok(!back.state.items[0].labels.includes('nicht-auf-board'), 'present ticker has no nicht-auf-board');
});

// ── 3) B1: last accepted value from ANY earlier vintage; structural skip ─────
check('B1 a value that returns after an absence is compared with its last value before the gap', () => {
  const hist = [['2026-09-15', { X: pit({ rev: [[Q, 1.8e9]] }) }], ['2026-09-17', { OTHER: pit({ rev: [[Q, 1]] }) }], ['2026-09-29', { OTHER: pit({ rev: [[Q, 1]] }) }]];
  const r = step(null, '2026-09-30', { X: pit({ rev: [[Q, 9.26e9]] }) }, hist);
  assert.strictEqual(r.state.items.length, 1, 'return after absence opens');
  assert.strictEqual(r.state.items[0].cells[0].acceptedFrom, '2026-09-15');
  // Absence counterpart: never seen before -> fill, no item.
  const r2 = step(null, '2026-09-30', { Y: pit({ rev: [[Q, 9.26e9]] }) }, hist);
  assert.strictEqual(r2.state.items.length, 0);
});

function mkBase() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'voi-'));
  fixtureDirs.push(base);
  fs.mkdirSync(path.join(base, 'board-history'), { recursive: true });
  return base;
}
function writeJson(p, o) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(o)); }
function storeDay(base, date, rows, gate) { writeJson(path.join(base, 'board-history', date, 'energy.json'), boardFile(rows, 'energy', gate)); }

check('B2 structurally flagged stored board files are no comparison source; p99-only files are', () => {
  for (const [gate, expectHit] of [[{ suspect: true, reasons: ['nan-break'] }, true], [{ suspect: true, reasons: ['p99-delta-exceeds-threshold'] }, false], [{ suspect: false, reasons: [] }, false]]) {
    const base = mkBase();
    storeDay(base, '2026-09-01', { A: pit({ rev: [[Q, 100]] }) });
    storeDay(base, '2026-09-02', { A: pit({ rev: [[Q, 400]] }) }, gate);
    const r = S.runDaily({ base, date: '2026-09-03', today: rowsOf({ A: pit({ rev: [[Q, 410]] }) }), dryRun: true });
    assert.strictEqual(r.state.items.length, expectHit ? 1 : 0, JSON.stringify(gate.reasons) + ': ' + (expectHit ? 'compared with 09-01 (structural day skipped)' : 'compared with 09-02'));
    if (expectHit) assert.strictEqual(r.state.items[0].cells[0].acceptedFrom, '2026-09-01');
  }
});

check('B3 globally excluded stored days are no comparison source', () => {
  const base = mkBase();
  storeDay(base, '2026-09-01', { A: pit({ rev: [[Q, 100]] }) });
  storeDay(base, '2026-09-02', { A: pit({ rev: [[Q, 400]] }) });
  writeJson(path.join(base, 'board-history', '_excluded.json'), { excluded: [{ date: '2026-09-02', board: null, reason: 't' }] });
  const r = S.runDaily({ base, date: '2026-09-03', today: rowsOf({ A: pit({ rev: [[Q, 410]] }) }), dryRun: true });
  assert.strictEqual(r.state.items.length, 1, '09-02 excluded -> compared with 09-01');
  writeJson(path.join(base, 'board-history', '_excluded.json'), { excluded: [] });
  const r2 = S.runDaily({ base, date: '2026-09-03', today: rowsOf({ A: pit({ rev: [[Q, 410]] }) }), dryRun: true });
  assert.strictEqual(r2.state.items.length, 0, 'not excluded -> compared with 09-02');
});

check('B4 catch-up: a stored day after updatedFor that the step never saw is compared, not silently the base', () => {
  const base = mkBase();
  storeDay(base, '2026-09-01', { A: pit({ rev: [[Q, 100]] }) });
  storeDay(base, '2026-09-02', { A: pit({ rev: [[Q, 900]] }) });   // jump happened on a day the list missed
  writeJson(path.join(base, 'data-health', 'value-open-items.json'), { ...V.emptyState(), updatedFor: '2026-09-01' });
  const r = S.runDaily({ base, date: '2026-09-03', today: rowsOf({ A: pit({ rev: [[Q, 900]] }) }), dryRun: true });
  assert.deepStrictEqual(r.catchUp, ['2026-09-02']);
  assert.strictEqual(r.state.items.length, 1, 'jump of 09-02 found');
  assert.strictEqual(r.state.items[0].firstSeen, '2026-09-02');
  assert.strictEqual(r.state.updatedFor, '2026-09-03');
  // Without an updatedFor (no list yet) there is nothing to catch up: day over day against history.
  fs.unlinkSync(path.join(base, 'data-health', 'value-open-items.json'));
  const r2 = S.runDaily({ base, date: '2026-09-03', today: rowsOf({ A: pit({ rev: [[Q, 900]] }) }), dryRun: true });
  assert.deepStrictEqual(r2.catchUp, []);
  assert.strictEqual(r2.state.items.length, 0);
});

// ── 4) closing ──────────────────────────────────────────────────────────────
const fkc = (cases, quarantines = []) => ({ cases, coverage: [], quarantines });
// replacementValue null = a withhold-only case (the real table requires null or a number).
const kase = (ticker, field, period, extra) => ({ caseId: ticker.toLowerCase() + '-' + period + '-' + field, ticker, field, period, replacementValue: null, ...(extra || {}) });

check('C1 a financial-known-cases row for the exact key closes; a row for another period does not', () => {
  const h = [['2026-09-01', { A: pit({ gp: [[Q, 100]] }) }]];
  const today = { A: pit({ gp: [[Q, 469]] }) };
  const in469 = { replacementValue: 469 };
  const other = step(null, '2026-09-02', today, h, { tables: V.buildTables({ fkc: fkc([kase('A', 'grossProfitQ', '2025-06-30', in469)]) }) });
  assert.strictEqual(other.state.items[0].status, 'open', 'other period does not close');
  assert.deepStrictEqual(other.state.items[0].labels, ['korrigiert-von-uns'], 'but the label describes the table row');
  const wrongField = step(null, '2026-09-02', today, h, { tables: V.buildTables({ fkc: fkc([kase('A', 'revenueQ', Q, in469)]) }) });
  assert.strictEqual(wrongField.state.items[0].status, 'open', 'other field does not close');
  const exact = step(null, '2026-09-02', today, h, { tables: V.buildTables({ fkc: fkc([kase('A', 'grossProfitQ', Q, in469)]) }) });
  assert.strictEqual(exact.state.items[0].status, 'closed');
  assert.strictEqual(exact.state.items[0].closedBy, 'hand-table:a-2026-06-30-grossProfitQ');
  assert.strictEqual(exact.state.items[0].closedAt, '2026-09-02');
  const alias = step(null, '2026-09-02', today, h, { tables: V.buildTables({ fkc: fkc([kase('A.PRIMARY', 'grossProfitQ', Q, { listingAliases: ['A'], ...in469 })]) }) });
  assert.strictEqual(alias.state.items[0].status, 'closed', 'a listing alias closes too');
});

check('C2 every cell must be covered: a multi-quarter item with one covered quarter stays open', () => {
  const h = [['2026-09-01', { A: pit({ rev: [[Q, 100], ['2026-03-31', 100]] }) }]];
  const today = { A: pit({ rev: [[Q, 500], ['2026-03-31', 500]] }) };
  const in500 = { replacementValue: 500 };
  const one = step(null, '2026-09-02', today, h, { tables: V.buildTables({ fkc: fkc([kase('A', 'revenueQ', Q, in500)]) }) });
  assert.strictEqual(one.state.items[0].status, 'open');
  const both = step(null, '2026-09-02', today, h, { tables: V.buildTables({ fkc: fkc([kase('A', 'revenueQ', Q, in500), kase('A', 'revenueQ', '2026-03-31', in500)]) }) });
  assert.strictEqual(both.state.items[0].status, 'closed');
  assert.strictEqual(both.state.items[0].closedBy, 'hand-table:a-2026-06-30-revenueQ + hand-table:a-2026-03-31-revenueQ');
});

check('C3 a quarantine closes every item of the ticker, and only that ticker', () => {
  const h = [['2026-09-01', { A: pit({ rev: [[Q, 100]], gp: [[Q, 50]], mcap: 1e9 }), B: pit({ mcap: 1e9 }) }]];
  const r = step(null, '2026-09-02', { A: pit({ rev: [[Q, 900]], gp: [[Q, 0]], mcap: 9e9 }), B: pit({ mcap: 9e9 }) }, h,
    { tables: V.buildTables({ fkc: fkc([], [{ caseId: 'a-q', ticker: 'A' }]) }) });
  const a = r.state.items.filter((it) => it.company === 'A');
  assert.strictEqual(a.length, 3);
  assert.ok(a.every((it) => it.status === 'closed' && it.closedBy === 'hand-table:quarantine:a-q'));
  assert.strictEqual(r.state.items.find((it) => it.company === 'B').status, 'open', 'other ticker untouched');
});

check('C4 marketCap closes by an ADS or share-count row for the ticker only while today\'s snapshot carries it (both shapes)', () => {
  const h = [['2026-09-01', { HS: pit({ mcap: 20e9 }), JB: pit({ mcap: 14e9 }), NO: pit({ mcap: 1e9 }) }]];
  const tables = V.buildTables({
    ads: { _doku: ['x'], HS: { ordinaryPerAds: 8 } },
    shares: { _doku: ['x'], JB: { shares: 1, wrongShares: [3] } },   // PR #406 shape
  });
  const today = (applied) => {
    const rows = rowsOf({ HS: pit({ mcap: 2.4e9 }), JB: pit({ mcap: 44e9 }), NO: pit({ mcap: 9e9 }) });
    if (applied !== undefined) for (const t of ['HS', 'JB', 'NO']) rows.get(t).mcapHandTableApplied = applied;
    return rows;
  };
  const r = step(null, '2026-09-02', null, h, { tables, todayRows: today(true) });
  const by = Object.fromEntries(r.state.items.map((it) => [it.company, it]));
  assert.strictEqual(by.HS.closedBy, 'hand-table:ads:HS');
  assert.strictEqual(by.JB.closedBy, 'hand-table:shares:JB');
  assert.strictEqual(by.NO.status, 'open', 'no row, stays open');
  // Counterpart: the same rows while the correction is not in today's value (stale row) or unknown (stored day).
  for (const applied of [false, undefined]) {
    const s = step(null, '2026-09-02', null, h, { tables, todayRows: today(applied) });
    assert.ok(s.state.items.every((it) => it.status === 'open' && it.closedBy === null), 'membership alone never closes (' + applied + ')');
  }
  // A revenue item of a ticker with an ADS row is not closed by it.
  const r2 = step(null, '2026-09-02', { HS: pit({ rev: [[Q, 900]] }) }, [['2026-09-01', { HS: pit({ rev: [[Q, 100]] }) }]], { tables });
  assert.strictEqual(r2.state.items[0].status, 'open');
  assert.deepStrictEqual(r2.state.items[0].labels, ['korrigiert-von-uns']);
});

check('C5 an acceptance closes; one more than factor 3 away from today closes AND reopens with acceptedValue = value', () => {
  const h = [['2026-09-01', { A: pit({ mcap: 1e9 }) }]];
  const r1 = step(null, '2026-09-02', { A: pit({ mcap: 5e9 }) }, h);
  const id = r1.state.items[0].id;
  const acc = (value, extra) => V.readAcceptances({ acceptances: [{ itemId: id, value, acceptedAt: '2026-09-03', reason: 'issuer filing', ...(extra || {}) }] }).entries;
  const ok = step(r1.state, '2026-09-03', { A: pit({ mcap: 5.1e9 }) }, h, { acceptances: acc(5e9) });
  assert.strictEqual(ok.state.items.length, 1, 'no new item');
  assert.strictEqual(ok.state.items[0].status, 'closed');
  assert.strictEqual(ok.state.items[0].closedBy, 'acceptance:1');
  const far = step(r1.state, '2026-09-03', { A: pit({ mcap: 5.1e9 }) }, h, { acceptances: acc(1.2e9) });
  assert.strictEqual(far.state.items.length, 2, 'closed + reopened');
  assert.strictEqual(far.state.items[0].status, 'closed');
  const re = far.state.items[1];
  assert.strictEqual(re.status, 'open');
  assert.strictEqual(re.acceptedValue, 1.2e9, 'reopened against the accepted value');
  assert.strictEqual(re.cells[0].acceptedFrom, 'acceptance:1');
  assert.strictEqual(re.id, 'A|marketCap|2026-09-03');
  assert.strictEqual(far.summary.reopened, 1);
});

check('C6 acceptance without reason or for an unknown item: warning, ignored, no crash', () => {
  const h = [['2026-09-01', { A: pit({ mcap: 1e9 }) }]];
  const r1 = step(null, '2026-09-02', { A: pit({ mcap: 5e9 }) }, h);
  const parsed = V.readAcceptances({ acceptances: [{ itemId: r1.state.items[0].id, value: 5e9, acceptedAt: '2026-09-03', reason: '' }, { itemId: 'NOPE|marketCap|2026-01-01', value: 1, acceptedAt: '2026-09-03', reason: 'x' }] });
  assert.strictEqual(parsed.entries.length, 1);
  assert.ok(parsed.warnings.some((w) => /entry 1 ignored/.test(w)));
  const r2 = step(r1.state, '2026-09-03', { A: pit({ mcap: 5e9 }) }, h, { acceptances: parsed.entries });
  assert.strictEqual(r2.state.items[0].status, 'open');
  assert.ok(r2.warnings.some((w) => /unknown itemId NOPE/.test(w)));
});

check('C7 a close accepts the value it saw: a quarantined series stuck at 0 does not reopen next day', () => {
  const tables = V.buildTables({ fkc: fkc([], [{ caseId: 'o-q', ticker: 'O' }]) });
  const h = [['2026-08-09', { O: pit({ gp: [[Q, 75]] }) }]];
  const r1 = step(null, '2026-08-16', { O: pit({ gp: [[Q, 0]] }) }, h, { tables });
  assert.strictEqual(r1.state.items[0].status, 'closed');
  assert.strictEqual(r1.state.items[0].cells[0].closedValue, 0);
  const h2 = [...h, ['2026-08-16', { O: pit({ gp: [[Q, 0]] }) }]];
  const r2 = step(r1.state, '2026-08-18', { O: pit({ gp: [[Q, 0]] }) }, h2, { tables });
  assert.strictEqual(r2.state.items.length, 1, 'no daily reopen against the old 75');
  // Counterpart: a move away from the value seen at the close is compared again.
  const r3 = step(r1.state, '2026-08-18', { O: pit({ gp: [[Q, 0]] }), P: pit({}) }, h2, { tables: NO_TABLES });
  assert.strictEqual(r3.state.items.length, 1);
  const h3 = [...h2, ['2026-08-18', { O: pit({ gp: [[Q, 10]] }) }]];
  const r4 = step(r1.state, '2026-08-19', { O: pit({ gp: [[Q, 40]] }) }, h3, { tables: NO_TABLES });
  assert.strictEqual(r4.state.items.length, 2, '10 -> 40 is a new jump');
});

check('C8 an acceptance applied while the company is off the board keeps the accepted value: the old wrong value opens again on return', () => {
  const h = [['2026-09-01', { A: pit({ rev: [[Q, 100]] }) }], ['2026-09-02', { A: pit({ rev: [[Q, 400]] }) }]];
  const r1 = step(null, '2026-09-02', { A: pit({ rev: [[Q, 400]] }) }, h.slice(0, 1));
  const acc = V.readAcceptances({ acceptances: [{ itemId: r1.state.items[0].id, value: 100, acceptedAt: '2026-09-03', reason: 'old value is right' }] }).entries;
  const absent = step(r1.state, '2026-09-03', { B: pit({ rev: [[Q, 1]] }) }, h, { acceptances: acc });
  assert.strictEqual(absent.state.items[0].status, 'closed');
  assert.strictEqual(absent.state.items[0].cells[0].closedValue, 100, 'closedValue = accepted value when today has none');
  assert.strictEqual(absent.state.items.length, 1, 'nothing to compare today, no reopen yet');
  const back = step(absent.state, '2026-09-04', { A: pit({ rev: [[Q, 400]] }) }, h, { acceptances: acc });
  assert.strictEqual(back.state.items.length, 2, 'return with the rejected 400 opens a new item');
  assert.strictEqual(back.state.items[1].acceptedValue, 100);
  assert.strictEqual(back.state.items[1].status, 'open');
  // Counterpart: returning with the accepted value opens nothing.
  const fine = step(absent.state, '2026-09-04', { A: pit({ rev: [[Q, 105]] }) }, h, { acceptances: acc });
  assert.strictEqual(fine.state.items.length, 1);
  // A hand-table close on an absent day still records no value (the table row governs the key).
  const t = V.buildTables({ fkc: fkc([kase('A', 'revenueQ', Q)]) });
  const ht = step(r1.state, '2026-09-03', { B: pit({ rev: [[Q, 1]] }) }, h, { tables: t });
  assert.strictEqual(ht.state.items[0].cells[0].closedValue, null);
});

check('C9 an acceptance covers only cells the item had on its acceptedAt day; acceptedAt is required', () => {
  const Q2 = '2026-03-31';
  const h = [['2026-09-01', { A: pit({ rev: [[Q, 100], [Q2, 100]] }) }]];
  const r1 = step(null, '2026-09-02', { A: pit({ rev: [[Q, 400], [Q2, 100]] }) }, h);
  const id = r1.state.items[0].id;
  const h2 = [...h, ['2026-09-02', { A: pit({ rev: [[Q, 400], [Q2, 100]] }) }]];
  const acc = V.readAcceptances({ acceptances: [{ itemId: id, value: 400, acceptedAt: '2026-09-02', reason: 'restated, 400 is right' }] }).entries;
  // Q2 joins on 09-03 (after acceptedAt) in the same run that applies the acceptance.
  const r2 = step(r1.state, '2026-09-03', { A: pit({ rev: [[Q, 400], [Q2, 350]] }) }, h2, { acceptances: acc });
  assert.strictEqual(r2.state.items[0].cells.length, 2, 'Q2 joined');
  assert.strictEqual(r2.state.items[0].status, 'open', 'Q2 was never reviewed: stays open');
  // Counterpart: an acceptance dated on or after the join covers both cells.
  const acc2 = V.readAcceptances({ acceptances: [{ itemId: id, value: 400, acceptedAt: '2026-09-03', reason: 'both reviewed' }] }).entries;
  const r3 = step(r1.state, '2026-09-03', { A: pit({ rev: [[Q, 400], [Q2, 350]] }) }, h2, { acceptances: acc2 });
  assert.strictEqual(r3.state.items[0].status, 'closed');
  const noDate = V.readAcceptances({ acceptances: [{ itemId: id, value: 400, reason: 'x' }, { itemId: id, value: 400, acceptedAt: '3.10.2026', reason: 'x' }] });
  assert.strictEqual(noDate.entries.length, 0, 'missing or malformed acceptedAt is ignored');
  assert.strictEqual(noDate.warnings.length, 2);
});

// Round 4 (Codex review of PR #407): closing needs the correction in today's value; acceptances act
// from their acceptedAt on; a new same-day jump after a same-day close opens; replay --dry-run writes nothing.
const AS_OF = '2026-10-02T09:35:06.929Z';
const snapOf = (ticker, px, mcap, extra) => ({ meta: { ticker, impliedSharesOutstanding: mcap / px, asOf: AS_OF },
  marketCap: { value: mcap, source: 'yahoo_quote', asOf: AS_OF, ...((extra && extra.mc) || {}) },
  price: { regularMarketPrice: px, currency: 'USD' }, metrics: {} });
const REAL = S.loadTables(REPO);   // the committed ADS and share-count rows (HSAI, BSBR / ABTC, ANDG, JBS)

check('C10 mcapHandTableApplied runs the real table functions: corrected or confirmed counts, stale or uncorrected does not', () => {
  const JBS = 1070929187, JBS_WRONG = 3289363700, px = 13.07;
  assert.strictEqual(V.mcapHandTableApplied(snapOf('JBS', px, px * JBS), 'JBS', REAL), true, 'vendor uses the issuer count: confirmed');
  assert.strictEqual(V.mcapHandTableApplied(snapOf('JBS', px, 70e9), 'JBS', REAL), false, 'Codex case 14 -> 70 bn: stale, vendor value kept');
  assert.strictEqual(V.mcapHandTableApplied(snapOf('JBS', px, px * JBS_WRONG), 'JBS', REAL), false, 'snapshot still carries the wrong count');
  assert.strictEqual(V.mcapHandTableApplied(snapOf('JBS', px, px * JBS, { mc: { source: 'hand-table:shares' } }), 'JBS', REAL), true, 'corrected snapshot');
  assert.strictEqual(V.mcapHandTableApplied(snapOf('HSAI', 16.25, 2.55e9, { mc: { source: 'hand-table:ads' } }), 'HSAI', REAL), true, 'ADS corrected');
  assert.strictEqual(V.mcapHandTableApplied(snapOf('HSAI', 16.25, 2.55e9), 'HSAI', REAL), false, 'ADS row with the error no longer visible: stale');
  assert.strictEqual(V.mcapHandTableApplied(null, 'JBS', REAL), false, 'no snapshot');
  assert.strictEqual(V.mcapHandTableApplied(snapOf('NOROW', 1, 1e9), 'NOROW', REAL), false, 'no row');
  const s = snapOf('JBS', px, 70e9); const before = JSON.stringify(s);
  V.mcapHandTableApplied(s, 'JBS', REAL);
  assert.strictEqual(JSON.stringify(s), before, 'the snapshot itself is not touched');
});

check('C11 the daily run closes a marketCap item by its row only when today\'s snapshot is corrected or confirmed (Codex JBS case)', () => {
  const run = (snapMcap, histMcap) => {
    const base = mkBase();
    storeDay(base, '2026-10-01', { JBS: pit({ mcap: histMcap }) });
    writeJson(path.join(base, 'outputs', 'hypergrowth', 'full', 'consumer-staples.json'), { profitable: [{ ticker: 'JBS', score: 50 }], unprofitable: [] });
    writeJson(path.join(base, 'snapshots', 'JBS.json'), snapOf('JBS', 13.07, snapMcap));
    fs.mkdirSync(path.join(base, 'configs'), { recursive: true });
    fs.copyFileSync(path.join(REPO, 'configs', 'share-count-hand-table.json'), path.join(base, 'configs', 'share-count-hand-table.json'));
    return S.runDaily({ base, date: '2026-10-02', dryRun: true }).state.items;
  };
  const stale = run(70e9, 14e9);
  assert.strictEqual(stale.length, 1);
  assert.strictEqual(stale[0].status, 'open', '14 -> 70 bn with a stale row stays open');
  assert.strictEqual(stale[0].closedBy, null);
  const confirmed = run(13.07 * 1070929187, 44.9e9);
  assert.strictEqual(confirmed.length, 1);
  assert.strictEqual(confirmed[0].status, 'closed', 'wrong-count day -> issuer count today: closed by the row');
  assert.strictEqual(confirmed[0].closedBy, 'hand-table:shares:JBS');
});

check('C12 a financial case closes only when today\'s value is its replacement (FX included) or, withhold-only, empty', () => {
  const h = [['2026-09-01', { A: pit({ gp: [[Q, 100]] }) }]];
  const t = (extra) => V.buildTables({ fkc: fkc([kase('A', 'grossProfitQ', Q, extra)]) });
  const st = (today, extra) => step(null, '2026-09-02', today, h, { tables: t(extra) }).state.items[0];
  assert.strictEqual(st({ A: pit({ gp: [[Q, 469]] }) }, { replacementValue: 469 }).status, 'closed', 'replacement shown');
  assert.strictEqual(st({ A: pit({ gp: [[Q, 2444]] }) }, { replacementValue: 469 }).status, 'open', 'vendor value still shown (stored day before the row)');
  const fxPit = pit({ gp: [[Q, 656027000 * 0.19184652]] }); fxPit.fxRateApplied = 0.19184652;
  assert.strictEqual(st({ A: fxPit }, { replacementValue: 656027000 }).status, 'closed', 'replacement x fxRateApplied (stored USD)');
  const fxOther = pit({ gp: [[Q, 656027000 * 0.2]] }); fxOther.fxRateApplied = 0.19184652;
  assert.strictEqual(st({ A: fxOther }, { replacementValue: 656027000 }).status, 'open', 'other value under conversion');
  assert.strictEqual(st({ A: pit({ gp: [[Q, 0]] }) }, { replacementValue: null }).status, 'open', 'withhold-only case but the vendor 0 is still shown');
  // A replacing case that went stale is withheld (empty): the item opened on the old wrong value stays open.
  const r1 = step(null, '2026-09-02', { A: pit({ gp: [[Q, 2444]] }) }, h);
  const stale = step(r1.state, '2026-09-03', { A: pit({ gp: [[Q, null]] }) }, h, { tables: t({ replacementValue: 469 }) });
  assert.strictEqual(stale.state.items[0].status, 'open', 'stale case: cell withheld, item stays open');
  const held = step(r1.state, '2026-09-03', { A: pit({ gp: [[Q, null]] }) }, h, { tables: t({ replacementValue: null }) });
  assert.strictEqual(held.state.items[0].status, 'closed', 'withhold-only case in effect: closed');
});

check('C13 an acceptance acts only from its acceptedAt on: a caught-up earlier day keeps the item open, its own day closes it (Codex case)', () => {
  const base = mkBase();
  storeDay(base, '2026-10-01', { A: pit({ rev: [[Q, 100]] }) });
  storeDay(base, '2026-10-02', { A: pit({ rev: [[Q, 400]] }) });
  storeDay(base, '2026-10-03', { A: pit({ rev: [[Q, 100]] }) });
  const prior = step(null, '2026-10-02', { A: pit({ rev: [[Q, 400]] }) }, [['2026-10-01', { A: pit({ rev: [[Q, 100]] }) }]]).state;
  const id = prior.items[0].id;
  writeJson(path.join(base, 'data-health', 'value-open-items.json'), prior);
  writeJson(path.join(base, 'data-health', 'value-acceptances.json'), { schema: 'value-acceptances/v1',
    acceptances: [{ itemId: id, value: 400, acceptedAt: '2026-10-06', reason: '400 is the issuer value' }] });
  const r = S.runDaily({ base, date: '2026-10-06', today: rowsOf({ A: pit({ rev: [[Q, 400]] }) }), dryRun: true });
  assert.deepStrictEqual(r.catchUp, ['2026-10-03']);
  assert.strictEqual(r.state.items.length, 1, 'no new item against 400 on the caught-up day');
  assert.strictEqual(r.state.items[0].status, 'closed');
  assert.strictEqual(r.state.items[0].closedAt, '2026-10-06', 'closed on the acceptance day, not on 10-03');
  assert.strictEqual(r.state.items[0].cells[0].closedValue, 400);
  // Opposite direction (L10): the future-dated entry is not lost; on 10-05 it is still pending, the item open.
  const early = S.runDaily({ base, date: '2026-10-05', today: rowsOf({ A: pit({ rev: [[Q, 400]] }) }), dryRun: true });
  assert.strictEqual(early.state.items.length, 1);
  assert.strictEqual(early.state.items[0].status, 'open', 'acceptance of 10-06 does not act on 10-05');
  assert.ok(!early.warnings.some((w) => /unknown itemId/.test(w)), 'a pending entry gives no unknown-item warning');
});

check('C14 after a same-day open and close, an unchanged rerun adds nothing and a new jump opens a new item (Codex case)', () => {
  const D = '2026-10-02';
  const h = [['2026-10-01', { A: pit({ rev: [[Q, 100]] }) }]];
  const r1 = step(null, D, { A: pit({ rev: [[Q, 400]] }) }, h);
  const acc = V.readAcceptances({ acceptances: [{ itemId: r1.state.items[0].id, value: 400, acceptedAt: D, reason: '400 is right' }] }).entries;
  const r2 = step(r1.state, D, { A: pit({ rev: [[Q, 400]] }) }, h, { acceptances: acc });
  assert.strictEqual(r2.state.items[0].status, 'closed');
  const same = step(r2.state, D, { A: pit({ rev: [[Q, 400]] }) }, h, { acceptances: acc });
  assert.strictEqual(same.state.items.length, 1, 'unchanged repetition: no second item');
  const jump = step(r2.state, D, { A: pit({ rev: [[Q, 1600]] }) }, h, { acceptances: acc });
  assert.strictEqual(jump.state.items.length, 2, '1600 against the closedValue 400 opens');
  const n = jump.state.items[1];
  assert.strictEqual(n.id, 'A|revenueQ|' + D + '#2', 'new id');
  assert.strictEqual(n.status, 'open');
  assert.strictEqual(n.acceptedValue, 400);
  assert.strictEqual(n.newValue, 1600);
  V.assertAppendOnly(r2.state, jump.state);
});

// ── 5) labels ───────────────────────────────────────────────────────────────
check('L1 korrigiert-von-uns and kapitalmassnahme are present but never close the item', () => {
  const tables = V.buildTables({ statementCurrency: { _doku: [], A: {} } });
  const h = [['2026-09-01', { A: pit({ mcap: 2e9, shares: 100 }) }]];
  const r = step(null, '2026-09-02', { A: pit({ mcap: 8e9, shares: 405 }) }, h, { tables });
  assert.deepStrictEqual(r.state.items[0].labels, ['korrigiert-von-uns', 'kapitalmassnahme']);
  assert.strictEqual(r.state.items[0].status, 'open', 'labels never close');
  assert.strictEqual(r.state.items[0].cells[0].acceptedShares, 100);
  assert.strictEqual(r.state.items[0].cells[0].newShares, 405);
});

check('L2 share count unchanged -> no kapitalmassnahme; share count unknown -> not computable, logged', () => {
  const h = [['2026-09-01', { A: pit({ mcap: 2e9, shares: 100 }), B: pit({ mcap: 2e9 }) }]];
  const r = step(null, '2026-09-02', { A: pit({ mcap: 8e9, shares: 100 }), B: pit({ mcap: 8e9, shares: 400 }) }, h);
  const by = Object.fromEntries(r.state.items.map((it) => [it.company, it]));
  assert.deepStrictEqual(by.A.labels, [], 'unchanged count, no label');
  assert.deepStrictEqual(by.B.labels, [], 'base without count, no label');
  assert.ok(r.notes.some((n) => /kapitalmassnahme not computable for 1 /.test(n)), 'logged');
  assert.ok(!V.buildTables({}).korrigiert.has('A'), 'no table, no korrigiert-von-uns');
});

// ── 6) append-only guard ────────────────────────────────────────────────────
check('G1 append-only guard throws on a changed acceptedValue, a removed item, a changed cell, a reopened item', () => {
  const r = step(null, '2026-09-02', { A: pit({ rev: [[Q, 900], ['2026-03-31', 900]] }) }, [['2026-09-01', { A: pit({ rev: [[Q, 100], ['2026-03-31', 100]] }) }]]);
  const prior = r.state;
  const mut = (fn) => { const n = JSON.parse(JSON.stringify(prior)); fn(n); return n; };
  assert.throws(() => V.assertAppendOnly(prior, mut((n) => { n.items[0].acceptedValue = 1; })), /changed acceptedValue/);
  assert.throws(() => V.assertAppendOnly(prior, mut((n) => { n.items = []; })), /item removed/);
  assert.throws(() => V.assertAppendOnly(prior, mut((n) => { n.items[0].cells[1].acceptedValue = 5; })), /cell 2026-03-31 changed acceptedValue/);
  assert.throws(() => V.assertAppendOnly(prior, mut((n) => { n.items[0].cells[0].firstSeen = '2026-01-01'; })), /changed firstSeen/);
  assert.throws(() => V.assertAppendOnly(prior, mut((n) => { n.items[0].cells.pop(); })), /cell removed/);
  const closed = mut((n) => { n.items[0].status = 'closed'; });
  assert.throws(() => V.assertAppendOnly(closed, prior), /reopened/);
  // Absence: allowed changes pass.
  V.assertAppendOnly(prior, mut((n) => { n.items[0].newValue = 7; n.items[0].lastSeen = '2026-09-09'; n.items[0].labels = ['x']; n.items.push({ ...n.items[0], id: 'new' }); }));
  V.assertAppendOnly(prior, step(prior, '2026-09-03', { A: pit({ rev: [[Q, 950], ['2026-03-31', 120]] }) }, [['2026-09-01', { A: pit({ rev: [[Q, 100], ['2026-03-31', 100]] }) }]]).state);
});

check('G2 the CLI writes nothing and exits 1 on an unreadable state or acceptances file', () => {
  for (const rel of ['data-health/value-open-items.json', 'data-health/value-acceptances.json']) {
    const base = mkBase();
    storeDay(base, '2026-09-01', { A: pit({ rev: [[Q, 100]] }) });
    const broken = path.join(base, rel);
    fs.mkdirSync(path.dirname(broken), { recursive: true });
    fs.writeFileSync(broken, '{ not json');
    const state = path.join(base, 'data-health', 'value-open-items.json');
    const before = fs.existsSync(state) ? fs.readFileSync(state, 'utf8') : null;
    const p = spawnSync(process.execPath, [path.join(REPO, 'scripts', 'value-open-items.js'), '--base', base, '--date', '2026-09-02'], { encoding: 'utf8' });
    assert.strictEqual(p.status, 1, rel + ': exit 1');
    assert.ok(/::error::value-open-items: unreadable input/.test(p.stdout), rel + ': loud ::error:: line');
    assert.strictEqual(fs.existsSync(state) ? fs.readFileSync(state, 'utf8') : null, before, rel + ': nothing written');
  }
});

check('G3 the CLI exits 1 without FULL_DIR (unreadable input) and 0 with readable inputs, writing the list', () => {
  const base = mkBase();
  storeDay(base, '2026-09-01', { A: pit({ rev: [[Q, 100]] }) });
  const cli = (args) => spawnSync(process.execPath, [path.join(REPO, 'scripts', 'value-open-items.js'), '--base', base, ...args], { encoding: 'utf8' });
  assert.strictEqual(cli(['--date', '2026-09-02']).status, 1, 'no outputs/hypergrowth/full -> exit 1');
  assert.ok(!fs.existsSync(path.join(base, 'data-health', 'value-open-items.json')));
  const rep = cli(['--replay', '--from', '2026-09-01']);
  assert.strictEqual(rep.status, 0, rep.stdout + rep.stderr);
  const seeded = JSON.parse(fs.readFileSync(path.join(base, 'data-health', 'value-open-items.json'), 'utf8'));
  assert.strictEqual(seeded.seed, 'replay');
  assert.strictEqual(seeded.seedInputs.command, 'node scripts/value-open-items.js --replay --from 2026-09-01 --to 2026-09-01');
});

check('G4 daily run and replay call the append-only guard: a violating result throws and nothing is written', () => {
  // Daily: a prior list with a duplicate id can only come out duplicated -> the guard must reject it.
  const base = mkBase();
  storeDay(base, '2026-09-01', { A: pit({ rev: [[Q, 100]] }) });
  const r = step(null, '2026-09-01', { A: pit({ rev: [[Q, 900]] }) }, [['2026-08-31', { A: pit({ rev: [[Q, 100]] }) }]]);
  const dup = { ...r.state, items: [r.state.items[0], r.state.items[0]] };
  const state = path.join(base, 'data-health', 'value-open-items.json');
  writeJson(state, dup);
  const before = fs.readFileSync(state, 'utf8');
  assert.throws(() => S.runDaily({ base, date: '2026-09-02', today: rowsOf({ A: pit({ rev: [[Q, 900]] }) }) }), /append-only violation: duplicate item/);
  assert.strictEqual(fs.readFileSync(state, 'utf8'), before, 'daily: nothing written');
  // Counterpart: the same base with a clean list writes.
  writeJson(state, r.state);
  S.runDaily({ base, date: '2026-09-02', today: rowsOf({ A: pit({ rev: [[Q, 900]] }) }) });
  assert.strictEqual(JSON.parse(fs.readFileSync(state, 'utf8')).updatedFor, '2026-09-02', 'daily: clean list written');
  // Replay: a step result that drops an item must be rejected before --out is written.
  storeDay(base, '2026-09-02', { A: pit({ rev: [[Q, 900]] }) });
  storeDay(base, '2026-09-03', { A: pit({ rev: [[Q, 900]] }) });
  const out = path.join(base, 'replay-out.json');
  const orig = V.updateOpenItems;
  V.updateOpenItems = (a) => { const res = orig(a); if (a.date === '2026-09-03') res.state.items = []; return res; };
  try {
    assert.throws(() => S.runReplay({ base, from: '2026-09-01', out }), /append-only violation: item removed/);
  } finally { V.updateOpenItems = orig; }
  assert.ok(!fs.existsSync(out), 'replay: nothing written');
  S.runReplay({ base, from: '2026-09-01', out });
  assert.ok(fs.existsSync(out), 'replay: written without the violation');
});

check('G5 --dry-run writes no file on the daily path and on the replay path (also with an empty range)', () => {
  const crypto = require('crypto');
  for (const args of [['--replay', '--from', '2026-09-01'], ['--replay', '--from', '2099-01-01'], ['--replay', '--from', '2026-09-01', '--out', 'x.json']]) {
    const base = mkBase();
    storeDay(base, '2026-09-01', { A: pit({ rev: [[Q, 100]] }) });
    storeDay(base, '2026-09-02', { A: pit({ rev: [[Q, 900]] }) });
    const state = path.join(base, 'data-health', 'value-open-items.json');
    writeJson(state, step(null, '2026-09-02', { A: pit({ rev: [[Q, 900]] }) }, [['2026-09-01', { A: pit({ rev: [[Q, 100]] }) }]]).state);
    const sha = () => crypto.createHash('sha256').update(fs.readFileSync(state)).digest('hex');
    const files = () => [fs.readdirSync(base).sort().join(','), fs.readdirSync(path.join(base, 'data-health')).sort().join(',')].join(' | ');
    const before = [sha(), files()];
    const p = spawnSync(process.execPath, [path.join(REPO, 'scripts', 'value-open-items.js'), '--dry-run', '--base', base, ...args], { encoding: 'utf8', cwd: base });
    assert.strictEqual(p.status, 0, args.join(' ') + ': ' + p.stdout + p.stderr);
    assert.ok(/dry run, nothing written/.test(p.stdout), args.join(' ') + ': says so');
    assert.deepStrictEqual([sha(), files()], before, args.join(' ') + ': state byte-identical, no new file');
    // Counterpart: without --dry-run the replay writes (to a file that does not exist yet).
    if (args.length === 3) {
      const fresh = path.join(base, 'fresh-out.json');
      const w = spawnSync(process.execPath, [path.join(REPO, 'scripts', 'value-open-items.js'), '--base', base, ...args, '--out', fresh], { encoding: 'utf8', cwd: base });
      assert.strictEqual(w.status, 0, w.stdout + w.stderr);
      assert.ok(fs.existsSync(fresh), args.join(' ') + ': written without --dry-run');
    }
  }
  // Daily path: dryRun leaves the state untouched too.
  const base = mkBase();
  storeDay(base, '2026-09-01', { A: pit({ rev: [[Q, 100]] }) });
  S.runDaily({ base, date: '2026-09-02', today: rowsOf({ A: pit({ rev: [[Q, 900]] }) }), dryRun: true });
  assert.ok(!fs.existsSync(path.join(base, 'data-health')), 'daily dry run: nothing written');
});

check('G6 a replay never replaces an existing list: a live list never, a seed only with --replace-seed', () => {
  const crypto = require('crypto');
  const base = mkBase();
  storeDay(base, '2026-09-01', { A: pit({ rev: [[Q, 100]] }) });
  storeDay(base, '2026-09-02', { A: pit({ rev: [[Q, 900]] }), B: pit({ rev: [[Q, 100]] }) });
  storeDay(base, '2026-09-03', { A: pit({ rev: [[Q, 900]] }), B: pit({ rev: [[Q, 900]] }) });
  const state = path.join(base, 'data-health', 'value-open-items.json');
  const sha = () => crypto.createHash('sha256').update(fs.readFileSync(state)).digest('hex');
  const cli = (args) => spawnSync(process.execPath, [path.join(REPO, 'scripts', 'value-open-items.js'), '--base', base, ...args], { encoding: 'utf8', cwd: base });
  // No file yet: the first seed is written.
  assert.strictEqual(cli(['--replay', '--from', '2026-09-01']).status, 0);
  const seed = JSON.parse(fs.readFileSync(state, 'utf8'));
  assert.strictEqual(seed.seed, 'replay'); assert.strictEqual(seed.items.length, 2);
  // Existing seed, shorter range (the reviewer's case): refused without the switch, the file is unchanged.
  const s0 = sha();
  const short = cli(['--replay', '--from', '2026-09-03']);
  assert.strictEqual(short.status, 1, short.stdout);
  assert.ok(/refuses to overwrite the existing seed/.test(short.stdout), short.stdout);
  assert.strictEqual(sha(), s0, 'seed untouched');
  // The same through the API (no CLI default involved).
  assert.throws(() => S.runReplay({ base, from: '2026-09-03', out: state }), /refuses to overwrite the existing seed/);
  assert.strictEqual(sha(), s0);
  // With the switch the seed is replaced (deliberate regeneration after a rule change).
  assert.strictEqual(cli(['--replay', '--from', '2026-09-01', '--replace-seed']).status, 0);
  assert.strictEqual(JSON.parse(fs.readFileSync(state, 'utf8')).items.length, 2);
  // Live list (the daily run removed the seed marker): never replaced, with or without the switch.
  S.runDaily({ base, date: '2026-09-04', today: rowsOf({ A: pit({ rev: [[Q, 900]] }), B: pit({ rev: [[Q, 900]] }) }) });
  assert.strictEqual(JSON.parse(fs.readFileSync(state, 'utf8')).seed, undefined);
  const s1 = sha();
  for (const extra of [[], ['--replace-seed']]) {
    const p = cli(['--replay', '--from', '2026-09-01', ...extra]);
    assert.strictEqual(p.status, 1, p.stdout);
    assert.ok(/refuses to replace the live list/.test(p.stdout), p.stdout);
    assert.strictEqual(sha(), s1, 'live list untouched');
  }
  // An unreadable existing file is treated like a live list.
  const junk = path.join(base, 'junk.json'); fs.writeFileSync(junk, '{"items":[');
  assert.throws(() => S.runReplay({ base, from: '2026-09-01', out: junk, replaceSeed: true }), /refuses to replace the live list/);
  // Writing to a new file stays possible at any time.
  const side = path.join(base, 'side.json');
  assert.strictEqual(cli(['--replay', '--from', '2026-09-01', '--out', side]).status, 0);
  assert.ok(fs.existsSync(side)); assert.strictEqual(sha(), s1);
});

// ── 7) real stored history (skips visibly without it, L12) ─────────────────
const H = path.join(REPO, 'board-history');
const haveDays = (...ds) => ds.every((d) => fs.existsSync(path.join(H, d)));
const ELEVEN = ['002128.SZ', '1196.HK', 'BANPU.BK', 'BLSH', 'CLSC3.SA', 'EMBJ', 'HSAI', 'PBR-A', 'SLCE3.SA', 'VALE3.SA', 'YPF'];
function storedRows(d) {
  const { istStrukturell } = require('../lib/board-history-flag.js');
  const files = fs.readdirSync(path.join(H, d)).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(fs.readFileSync(path.join(H, d, f), 'utf8'))).filter((v) => v.cohort);
  return { all: V.dayRows(files), source: V.dayRows(files.filter((v) => !istStrukturell(v.gate))) };
}
if (!haveDays('2026-09-24', '2026-09-29')) {
  skip('R1 real 24.09. -> 29.09.', 'board-history/2026-09-24 or 2026-09-29 not in this checkout');
} else {
  check('R1 real 24.09. -> 29.09.: exactly the 11 companies of the report, SIVE.ST (value -> negative) not', () => {
    const index = new Map();
    V.indexVintage(index, storedRows('2026-09-24').source, '2026-09-24');
    const r = V.updateOpenItems({ date: '2026-09-29', today: storedRows('2026-09-29').all, index, prior: V.emptyState(), acceptances: [], tables: S.loadTables(REPO) });
    const companies = [...new Set(r.state.items.map((it) => it.company))].sort();
    assert.deepStrictEqual(companies, ELEVEN);
    assert.ok(!companies.includes('SIVE.ST'));
  });
  check('R2 real 29.09. with rule B1 (any earlier vintage): the 11 plus OLPX and 8020.T (a 0 against the last value before the zeros)', () => {
    const W = require('../scripts/write-board-history.js');
    W._setPaths(REPO);
    const ex = W.excludedDates();
    const index = new Map();
    for (const d of fs.readdirSync(H).filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x) && x < '2026-09-29' && !ex.has(x)).sort()) V.indexVintage(index, storedRows(d).source, d);
    const r = V.updateOpenItems({ date: '2026-09-29', today: storedRows('2026-09-29').all, index, prior: V.emptyState(), acceptances: [], tables: S.loadTables(REPO) });
    const companies = [...new Set(r.state.items.map((it) => it.company))].sort();
    assert.deepStrictEqual(companies, [...ELEVEN, '8020.T', 'OLPX'].sort());
    const extra = r.state.items.filter((it) => ['8020.T', 'OLPX'].includes(it.company));
    assert.ok(extra.every((it) => it.cells.every((c) => c.newValue === 0)), 'both extras are moves to 0');
  });
}

const seedFile = path.join(REPO, 'data-health', 'value-open-items.json');
const committed = fs.existsSync(seedFile) ? JSON.parse(fs.readFileSync(seedFile, 'utf8')) : null;
if (!committed || committed.seed !== 'replay') {
  skip('R3 seed replay reproduces the committed seed', 'the committed list is no longer the seed (the live run has moved on)');
} else if (!haveDays(committed.seedInputs.from, committed.seedInputs.to)) {
  skip('R3 seed replay reproduces the committed seed', 'stored history ' + committed.seedInputs.from + '..' + committed.seedInputs.to + ' not in this checkout');
} else if (JSON.stringify(S.inputFingerprint(REPO)) !== JSON.stringify(committed.seedInputs.files)) {
  skip('R3 seed replay reproduces the committed seed', 'hand tables or acceptances changed since the seed (fingerprint differs)');
} else {
  check('R3 seed replay reproduces the committed seed; XVALO.MC opens on 30.09.; existing rows close their items', () => {
    const r = S.runReplay({ base: REPO, from: committed.seedInputs.from, to: committed.seedInputs.to });
    assert.deepStrictEqual(r.state.items, committed.items, 'replay = committed seed');
    assert.ok(committed.items.some((it) => it.company === 'XVALO.MC' && it.firstSeen === '2026-09-30'), 'XVALO.MC on 30.09.');
    const closedBy = committed.items.filter((it) => it.status === 'closed').map((it) => it.company);
    for (const t of ['OLPX', 'BANPU.BK', 'SLCE3.SA', 'CLSC3.SA', 'ARCC', 'BXSL', 'BBDC']) assert.ok(closedBy.includes(t), t + ' closed by its hand-table row');
    assert.ok(!committed.items.some((it) => it.company === 'SIVE.ST'), 'SIVE.ST never opens');
  });
}

// ── 8) e1/e2 label line ─────────────────────────────────────────────────────
check('E1 e1/e2 name a read board that carries gate.suspect, and only then', () => {
  const E1 = require('../lib/e1-compression.js');
  const E2 = require('../lib/e2-earnings-blowout.js');
  for (const [name, run] of [['e1', (o) => E1.runE1(o)], ['e2', (o) => E2.runE2(o)]]) {
    for (const flagged of [true, false]) {
      const base = mkBase();
      writeJson(path.join(base, 'board-history', '2026-09-02', 'energy.json'), boardFile({}, 'energy', { suspect: flagged, reasons: flagged ? ['p99-delta-exceeds-threshold'] : [] }));
      const r = run({ baseDir: base, date: '2026-09-02', noWrite: true, statePath: path.join(base, 'st.json'), outPath: path.join(base, 'out.json') });
      const hasLine = r.lines.some((l) => /Wert-Tor-Kennzeichen \(gate\.suspect\) auf: energy/.test(l));
      assert.strictEqual(hasLine, flagged, name + ' flagged=' + flagged);
    }
  }
});

console.log(fail ? 'FAIL: ' + fail + ' Test(s)' : 'Alle value-open-items-Tests gruen' + (skipped ? ' (' + skipped + ' sichtbar uebersprungen)' : ''));
process.exit(fail ? 1 : 0);

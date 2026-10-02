// tests/wertgate-umbau-pr1.test.js — standalone runner (node tests/wertgate-umbau-pr1.test.js, exit 0/1).
//
// Tag 1396 (value-gate rebuild, PR1): every daily vintage is committed with its verdict in each
// board file. A new derived class `gate.structural` separates structural breaks (cohort-empty,
// overlap collapse, NaN break, coverage collapse, integrity decay, p99 on a daten-schub transition
// with a broken fan-out cap) from p99-only flags:
//   - writer exit 2 only for a structural board; a p99-only flag is written, flagged, exit 0;
//   - the per-board prior walk skips structural days as comparison base, p99-only days are a base;
//   - the registered massstab-bruch binds only where the board's prior IS the global prior;
//   - GATE FLAG line replaces the old coupling line; GATE SERIE names the board with the max gap;
//   - rank-ic skips flagged boards by default, keeps them with includeFlagged.
// Every case asserts presence AND absence. Fixtures are hermetic temp dirs (L4).
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const W = require('../scripts/write-board-history.js');
const F = require('../lib/board-history-flag.js');
const ric = require('../scripts/rank-ic.js');

let fail = 0;
function check(name, fn) {
  try { fn(); console.log('  ok   ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + ': ' + (e && e.message || e)); }
}

const fixtureDirs = [];
process.once('exit', () => { for (const d of fixtureDirs) fs.rmSync(d, { recursive: true, force: true }); });
function mkBase() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'wg-pr1-'));
  fixtureDirs.push(base);
  fs.mkdirSync(path.join(base, 'outputs', 'hypergrowth', 'full'), { recursive: true });
  fs.mkdirSync(path.join(base, 'snapshots'), { recursive: true });
  writeJson(path.join(base, 'outputs', 'calibration.json'), { schema: 'calibration/v4', generated_at: 'x' });
  return base;
}
function writeJson(p, o) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(o)); }
function row(ticker, score) {
  return { ticker, score, track: 'profitable', scoreBase: score, scoreShrunk: score, coverageAxes: '7/7',
    lamps: [], axisBreakdown: [{ key: 'revGrowthLevel', pct: 80, weight: 1.7 }] };
}
function writeBoard(base, board, rows) {
  writeJson(path.join(base, 'outputs', 'hypergrowth', 'full', board + '.json'), { profitable: rows, unprofitable: [] });
}
function readVintage(base, date, board) {
  return JSON.parse(fs.readFileSync(path.join(base, 'board-history', date, board + '.json'), 'utf8'));
}
const P99 = 'p99-delta-exceeds-threshold';

// ── writer: p99-only, clean, structural ─────────────────────────────────────
check('W1 p99-only day: written, flagged, structural false, exit 0, GATE FLAG names it as value warning', () => {
  const base = mkBase();
  writeBoard(base, 'semiconductors', [row('AAA', 50), row('BBB', 60)]);
  assert.strictEqual(W.run({ baseDir: base, date: '2026-08-03' }).exitCode, 0);
  writeBoard(base, 'semiconductors', [row('AAA', 95), row('BBB', 60)]);   // +45 >> floor 11.5
  const res = W.run({ baseDir: base, date: '2026-08-04' });
  assert.strictEqual(res.exitCode, 0, 'a p99-only flag must not turn the run red');
  const v = readVintage(base, '2026-08-04', 'semiconductors');
  assert.strictEqual(v.gate.suspect, true, 'flag kept in the file');
  assert.deepStrictEqual(v.gate.reasons, [P99]);
  assert.strictEqual(v.gate.structural, false);
  assert.strictEqual(res.boards[0].structural, false);
  const z = W.kopplungProtokollZeilen(res);
  const flag = z.find((s) => /GATE FLAG/.test(s)) || '';
  assert.ok(/^::warning::GATE FLAG fuer 2026-08-04: gespeichert mit Kennzeichen: semiconductors \(Wert-Warnung\); strukturell: keines$/.test(flag), flag);
  assert.ok(!z.some((s) => /gesperrt|KOPPLUNG/.test(s)), 'no "gesperrt"/coupling wording any more: ' + z.join(' | '));
});

check('W2 clean day: suspect false, structural false, exit 0, no GATE FLAG line', () => {
  const base = mkBase();
  writeBoard(base, 'semiconductors', [row('AAA', 50), row('BBB', 60)]);
  W.run({ baseDir: base, date: '2026-08-03' });
  writeBoard(base, 'semiconductors', [row('AAA', 50.5), row('BBB', 60.2)]);
  const res = W.run({ baseDir: base, date: '2026-08-04' });
  assert.strictEqual(res.exitCode, 0);
  const v = readVintage(base, '2026-08-04', 'semiconductors');
  assert.strictEqual(v.gate.suspect, false);
  assert.strictEqual(v.gate.structural, false);
  assert.strictEqual(W.kopplungProtokollZeilen(res).filter((s) => /GATE FLAG/.test(s)).length, 0);
});

check('W3 NaN day: structural true, exit 2, file written, GATE FLAG lists it as structural', () => {
  const base = mkBase();
  writeBoard(base, 'semiconductors', [row('AAA', 50), row('BBB', 60)]);
  writeBoard(base, 'energy', [row('CCC', 50), row('DDD', 60)]);
  W.run({ baseDir: base, date: '2026-08-03' });
  writeBoard(base, 'semiconductors', [row('AAA', null), row('BBB', 60)]);
  const res = W.run({ baseDir: base, date: '2026-08-04' });
  assert.strictEqual(res.exitCode, 2);
  const v = readVintage(base, '2026-08-04', 'semiconductors');
  assert.ok(v.gate.reasons.includes('nan-break'));
  assert.strictEqual(v.gate.structural, true);
  assert.strictEqual(readVintage(base, '2026-08-04', 'energy').gate.structural, false, 'sibling board is not structural');
  const flag = W.kopplungProtokollZeilen(res).find((s) => /GATE FLAG/.test(s)) || '';
  assert.ok(/gespeichert mit Kennzeichen: keines \(Wert-Warnung\); strukturell: semiconductors$/.test(flag), flag);
  assert.ok(!/energy/.test(flag), 'an unflagged sibling is not named: ' + flag);
});

// ── the shared rule ─────────────────────────────────────────────────────────
check('L1 istStrukturell: old file without `structural` is derived from reasons; an explicit boolean wins', () => {
  assert.strictEqual(F.istStrukturell({ suspect: true, reasons: [P99] }), false, 'p99 only = value warning');
  assert.strictEqual(F.istStrukturell({ suspect: true, reasons: ['nan-break'] }), true);
  assert.strictEqual(F.istStrukturell({ suspect: true, reasons: [P99, 'coverage-collapse:beta'] }), true);
  assert.strictEqual(F.istStrukturell({ suspect: false, reasons: [] }), false);
  assert.strictEqual(F.istStrukturell(null), false);
  assert.strictEqual(F.istStrukturell({ suspect: true, structural: true, reasons: [P99] }), true, 'stored boolean wins');
  assert.strictEqual(F.istGeflaggt({ gate: { suspect: true } }), true);
  assert.strictEqual(F.istGeflaggt({ gate: { suspect: false } }), false);
  assert.strictEqual(F.istGeflaggt({}), false);
});

// fan-out: daten-schub transition, 300 rows; `n` rows jump +40 (fan-out n/300 against cap 8 %).
function datenSchubGate(n) {
  const zeile = (t, s) => ({ ticker: t, score: s, coverageAxes: '7/7', lamps: ['lowRoic'],
    axisBreakdown: [{ key: 'revGrowthLevel', pct: 50, weight: 1 }],
    pit: { revenueQ: [120, 110], revenueQEnds: ['2026-03-31', '2025-12-31'], grossProfitQ: [60, 55], grossProfitQEnds: ['2026-03-31', '2025-12-31'] } });
  const vor = [], nach = [];
  for (let i = 0; i < 300; i++) { vor.push(zeile('T' + i, 50)); nach.push(zeile('T' + i, i < n ? 90 : 50.3)); }
  const v = (rows) => ({ date: null, pitCoverage: { beta: 1 }, cohort: { profitable: rows, unprofitable: [] } });
  const eintrag = { tag: 'Tag X', typ: 'daten-schub', letztesAltesVintage: '2026-09-01', boards: new Set(['energy']), erklaerendeLampe: null };
  return W.evaluateGate(v(nach), v(vor), { dailyP99Samples: [], sampleDates: [], threshold: null, frozen: false }, eintrag, 'energy', {});
}
check('L2 fan-out: daten-schub, cap broken, p99 over the normal threshold -> structural; cap held -> not structural', () => {
  const gebrochen = datenSchubGate(30);   // 10 % > 8 %
  assert.ok(gebrochen.reasons.includes(P99), gebrochen.reasons.join(','));
  assert.strictEqual(gebrochen.fanOutHaelt, false);
  assert.strictEqual(F.istStrukturell(gebrochen), true);
  const gehalten = datenSchubGate(20);    // 6.67 % <= 8 %, p99 40 > deckel 23
  assert.ok(gehalten.reasons.includes(P99), gehalten.reasons.join(','));
  assert.strictEqual(gehalten.fanOutHaelt, true);
  assert.strictEqual(F.istStrukturell(gehalten), false);
});

// ── per-board prior walk ────────────────────────────────────────────────────
check('P1 after a p99-flagged day the next day compares against that day (priorDate = it, gapDays 1)', () => {
  const base = mkBase();
  writeBoard(base, 'semiconductors', [row('AAA', 50), row('BBB', 60)]);
  W.run({ baseDir: base, date: '2026-08-03' });
  writeBoard(base, 'semiconductors', [row('AAA', 95), row('BBB', 60)]);
  W.run({ baseDir: base, date: '2026-08-04' });
  const res = W.run({ baseDir: base, date: '2026-08-05' });
  const v = readVintage(base, '2026-08-05', 'semiconductors');
  assert.strictEqual(v.gate.priorDate, '2026-08-04');
  assert.strictEqual(v.gate.gapDays, 1);
  assert.strictEqual(v.gate.suspect, false, 'same values as the flagged day: no new flag');
  assert.notStrictEqual(v.gate.priorDate, '2026-08-03');
  assert.strictEqual(res.exitCode, 0);
});

check('P2 after a structural day the board skips it (gapDays 2) while a sibling compares against it; bruch binds only on the global prior', () => {
  const base = mkBase();
  writeBoard(base, 'semiconductors', [row('AAA', 50), row('BBB', 60)]);
  writeBoard(base, 'energy', [row('CCC', 50), row('DDD', 60)]);
  W.run({ baseDir: base, date: '2026-08-03' });
  writeBoard(base, 'semiconductors', [row('AAA', null), row('BBB', 60)]);   // structural (nan-break)
  assert.strictEqual(W.run({ baseDir: base, date: '2026-08-04' }).exitCode, 2);
  // a daten-schub entry bound to the global prior 2026-08-04, naming both boards
  const exclFile = path.join(base, 'board-history', '_excluded.json');
  const excl = JSON.parse(fs.readFileSync(exclFile, 'utf8'));
  excl._massstab_brueche = [{ tag: 'Tag T', typ: 'daten-schub', letztes_altes_vintage: '2026-08-04', boards: ['semiconductors', 'energy'] }];
  fs.writeFileSync(exclFile, JSON.stringify(excl));
  writeBoard(base, 'semiconductors', [row('AAA', 50), row('BBB', 60)]);
  const res = W.run({ baseDir: base, date: '2026-08-05' });
  assert.strictEqual(res.priorDate, '2026-08-04', 'global prior unchanged');
  const semi = readVintage(base, '2026-08-05', 'semiconductors');
  const en = readVintage(base, '2026-08-05', 'energy');
  assert.strictEqual(semi.gate.priorDate, '2026-08-03', 'structural day skipped as base');
  assert.strictEqual(semi.gate.gapDays, 2);
  assert.strictEqual(semi.gate.suspect, false, 'compared against the sane state: no nan-break carried over');
  assert.strictEqual(en.gate.priorDate, '2026-08-04', 'sibling compares against the structural day');
  assert.strictEqual(en.gate.gapDays, 1);
  assert.ok(en.gate.bruchGrenze && en.gate.bruchGrenze.typ === 'daten-schub', 'bruch applied where board prior = global prior');
  assert.strictEqual(semi.gate.bruchGrenze, null, 'bruch NOT applied where the board prior differs from the global prior');
  assert.strictEqual(res.exitCode, 0);
});

// ── GATE SERIE: maximum gap, named board ────────────────────────────────────
check('S1 GATE SERIE uses the maximum finite gapDays and names that board', () => {
  const res = { date: '2026-09-05', priorDate: '2026-09-04', boards: [
    { board: 'utilities', suspect: false, gapDays: 1, priorDate: '2026-09-04' },
    { board: 'energy', suspect: false, gapDays: 5, priorDate: '2026-08-31' },
    { board: 'materials', suspect: false, gapDays: null, priorDate: null }] };
  const z = W.kopplungProtokollZeilen(res);
  assert.strictEqual(z.length, 1, z.join(' | '));
  assert.ok(/^::warning::GATE SERIE: 5 Tage ohne gelandetes Vintage \(Vorgaenger 2026-08-31, Schwelle 3 Tage/.test(z[0]), z[0]);
  assert.ok(/Board energy/.test(z[0]), z[0]);
  assert.ok(!/utilities|GATE SERIE: 1 Tage/.test(z[0]), 'the first board (gap 1) must not hide the larger gap: ' + z[0]);
  assert.ok(!/jede weitere SUSPECT-Nacht/.test(z[0]), 'old tail claimed SUSPECT nights lengthen the gap: ' + z[0]);
});

// ── rank-ic: flagged boards skipped by default ──────────────────────────────
function ricFixture() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wg-pr1-ric-'));
  fixtureDirs.push(tmp);
  const hist = path.join(tmp, 'board-history');
  const dates = ['2026-01-02', '2026-01-30', '2026-02-27'];
  const rows = Array.from({ length: 12 }, (_, i) => ({ ticker: 'T' + i, score: i, pit: {} }));
  for (const d of dates) {
    for (const board of ['b1', 'b2']) {
      const gate = (d === dates[1] && board === 'b1') ? { suspect: true, structural: false, reasons: [P99] } : { suspect: false, structural: false, reasons: [] };
      writeJson(path.join(hist, d, board + '.json'), { date: d, board, gate, cohort: { profitable: rows, unprofitable: [] } });
    }
  }
  const priceIndex = {};
  for (const r of rows) {
    const m = new Map();
    for (let i = 0; i <= 300; i++) { const dt = new Date(Date.UTC(2026, 0, 2 + i)).toISOString().slice(0, 10); m.set(dt, 100 * (1 + 0.0005 * r.score * i)); }
    priceIndex[r.ticker] = m;
  }
  return { hist, dates, priceIndex };
}
const FAMILY = {
  schemaVersion: 1, familyId: 'wg-pr1-g1', generation: 1, hypothesisId: 'wg-pr1', artifactCreatedAt: '2026-01-01',
  provenance: { registration: { specifiedAt: '2025-12-01', confirmedAt: '2025-12-02', source: 'test' }, thresholdFreeze: { frozenAt: '2025-12-03', source: 'test' } },
  firstEligibleVintage: '2026-01-01',
  methodContract: { protocolVersion: 'rank-ic-confirmatory-v1', horizonsDays: [28, 84], decisionHorizonDays: 84,
    testDefinition: 'x', correction: { method: 'benjamini-yekutieli', q: 0.10 }, minimumNeff: 8, ciLevel: 0.90,
    bootstrapIterations: 10000, bootstrapBlockLength: 2, threshold28: 0.03, threshold84: 0.05 },
  boards: ['b1', 'b2'], payloadHash: 'sha256:test',
};
check('R1 rank-ic: flagged board on D excluded by default (listed with reason), unflagged sibling kept; includeFlagged keeps both', () => {
  const { hist, dates, priceIndex } = ricFixture();
  const D = dates[1];
  const rep = ric.evaluate(hist, priceIndex, { B: 50, families: [FAMILY] });
  assert.deepStrictEqual(rep.boardVintagesExcluded, [{ date: D, board: 'b1', reason: 'gate-suspect: ' + P99 }]);
  assert.deepStrictEqual(rep.boards.b1.datesExcluded, [D]);
  assert.deepStrictEqual(rep.boards.b2.datesExcluded, [], 'unflagged sibling on D is kept');
  assert.ok(rep.familyHealth.exclusions.some((e) => e.board === 'b1' && e.dates.includes(D)));
  assert.deepStrictEqual(rep.vintagesExcluded, [], 'a board flag is never a global exclusion');
  const mit = ric.evaluate(hist, priceIndex, { B: 50, families: [FAMILY], includeFlagged: true });
  assert.deepStrictEqual(mit.boardVintagesExcluded, []);
  assert.deepStrictEqual(mit.boards.b1.datesExcluded, []);
  assert.strictEqual(mit.familyHealth.exclusions.length, 0);
});

check('R2 rank-ic: a flag on a globally excluded date adds nothing (global exclusion wins)', () => {
  const { hist, dates, priceIndex } = ricFixture();
  writeJson(path.join(hist, '_excluded.json'), { _doc: 't', excluded: [{ date: dates[1], reason: 'global' }] });
  const rep = ric.evaluate(hist, priceIndex, { B: 50, families: [FAMILY] });
  assert.deepStrictEqual(rep.vintagesExcluded, [dates[1]]);
  assert.deepStrictEqual(rep.boardVintagesExcluded, []);
});

if (fail) { console.log('\nFAIL: wertgate-umbau-pr1 (' + fail + ')'); process.exit(1); }
console.log('\nOK: wertgate-umbau-pr1 (Tag 1396)');

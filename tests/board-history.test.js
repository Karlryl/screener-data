// tests/board-history.test.js — Standalone-Runner (framework-los: assert + process.exit).
// Deckt scripts/write-board-history.js (Masterplan 2.3 Vintage-Writer) ab:
//   (a) Vintage-Schreibpfad + §7-PIT-Felder + pitCoverage (A9)
//   (b) Wert-Gate: künstlich wertfalsches Folge-Vintage → suspect:true + exit 2
//   (c) Backdate-Fixture: --compact greift, Archiv-Kopie existiert, Kern bleibt, PIT gestrippt (A12)
//   (d) _excluded-Gerüst wird angelegt (Writer schreibt nie Einträge)
//   (e) picks-history unberührt (Verzeichnis-Diff vor/nach) + assertNoPicksHistory-Guard
// Fixtures sind EINGEBETTET (L4 — keine Abhängigkeit von echten snapshots/outputs).
// Run: node tests/board-history.test.js
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const W = require('../scripts/write-board-history.js');

let fail = 0;
function check(name, fn) {
  try { fn(); console.log('  ok   ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + ': ' + (e && e.message || e)); }
}

// ── Fixture-Helfer ───────────────────────────────────────────────────────────
function mkBase() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-'));
  fs.mkdirSync(path.join(base, 'outputs', 'hypergrowth', 'full'), { recursive: true });
  fs.mkdirSync(path.join(base, 'snapshots'), { recursive: true });
  return base;
}
function writeJson(p, o) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(o)); }

// Snapshot mit voller Kontroll-Feld-Ausstattung (Beta/EV-Sales/priceSales/GM + Serien + Enden).
function snapFull(ticker, opts) {
  opts = opts || {};
  return {
    meta: { ticker, fetchedAt: '2026-07-10T12:00:00.000Z', asOf: '2026-07-13T06:00:00.000Z' },
    metrics: {
      beta: opts.noBeta ? null : { value: 1.5 },
      enterpriseToRevenue: { value: 8.2 },
      priceSales: { value: 10.0 },
      grossMargin: { value: 50.0 },   // → priceGrossProfit = 10/0.5 = 20
    },
    timeseries: {
      revenueQ: [{ value: 120 }, { value: 110 }, { value: 100 }],
      grossProfitQ: [{ value: 60 }, { value: 55 }, { value: 50 }],
      // revenueQEnds nur wenn opts.withEnds (A10: kommt parallel via pull-yahoo)
      ...(opts.withEnds ? { revenueQEnds: ['2026-04-30', '2026-01-31', '2025-10-31'], grossProfitQEnds: ['2026-04-30', '2026-01-31', '2025-10-31'] } : {}),
    },
  };
}
// Board-Zeile in Board-JSON-Form (wie outputs/hypergrowth/full/<board>.json).
function row(ticker, score) {
  return {
    ticker, score, track: 'profitable',
    scoreBase: score - 1, scoreShrunk: score - 0.5, coverageAxes: '7/7',
    lamps: ['x'], axisBreakdown: [{ key: 'revGrowthLevel', pct: 80, weight: 1.7 }],
  };
}
function writeBoard(base, board, rows) {
  writeJson(path.join(base, 'outputs', 'hypergrowth', 'full', board + '.json'), { profitable: rows, unprofitable: [] });
}
function readVintage(base, date, board) {
  return JSON.parse(fs.readFileSync(path.join(base, 'board-history', date, board + '.json'), 'utf8'));
}

// ── (a) Vintage-Schreibpfad + §7-PIT + pitCoverage ───────────────────────────
check('(a) schreibt Vintage mit §7-PIT-Feldern + pitCoverage + boardStatus', () => {
  const base = mkBase();
  // 3 Namen: ABC voll (mit Enden), DEF ohne Beta (Missing-Beta-Regel), GHI ohne Snapshot.
  writeJson(path.join(base, 'snapshots', 'ABC.json'), snapFull('ABC', { withEnds: true }));
  writeJson(path.join(base, 'snapshots', 'DEF.json'), snapFull('DEF', { noBeta: true }));
  // GHI: kein Snapshot → pit null + pitGaps snapshot-missing
  writeBoard(base, 'semiconductors', [row('ABC', 90), row('DEF', 80), row('GHI', 70)]);
  writeJson(path.join(base, 'outputs', 'calibration.json'), { schema: 'calibration/v4', generated_at: '2026-07-13T20:00:00Z' });

  const res = W.run({ baseDir: base, date: '2026-07-13' });
  assert.strictEqual(res.exitCode, 0, 'exit 0 ohne suspect');
  const v = readVintage(base, '2026-07-13', 'semiconductors');

  assert.strictEqual(v.date, '2026-07-13');
  assert.strictEqual(v.board, 'semiconductors');
  assert.strictEqual(v.boardStatus, 'core');          // semiconductors ist ein core-Board
  assert.strictEqual(v.formulaVersion, 'calibration/v4');
  assert.strictEqual(v.cohortCount.profitable, 3);

  const abc = v.cohort.profitable[0];
  assert.strictEqual(abc.ticker, 'ABC');
  assert.strictEqual(abc.rank, 1);
  // §7-Kontroll-Felder present:
  assert.strictEqual(abc.pit.beta, 1.5);
  assert.strictEqual(abc.pit.evSales, 8.2);
  assert.strictEqual(abc.pit.priceGrossProfit, 20);   // 10 / (50/100)
  assert.strictEqual(abc.pit.fetchedAt, '2026-07-10T12:00:00.000Z');
  assert.deepStrictEqual(abc.pit.revenueQ, [120, 110, 100]);
  assert.deepStrictEqual(abc.pit.revenueQEnds, ['2026-04-30', '2026-01-31', '2025-10-31']);

  const def = v.cohort.profitable[1];
  assert.strictEqual(def.pit.beta, null, 'Missing-Beta-Regel: fehlende Beta explizit null');
  assert.strictEqual(def.pit.evSales, 8.2);

  const ghi = v.cohort.profitable[2];
  assert.strictEqual(ghi.pit, null, 'kein Snapshot → pit null');
  assert.ok(v.pitGaps.includes('snapshot-missing'), 'pitGaps notiert fehlenden Snapshot');
  assert.ok(v.pitGaps.includes('grossProfitQEnds-missing'), 'pitGaps notiert fehlende Enden (DEF/GHI)');

  // pitCoverage: beta present bei 1/3 (nur ABC), evSales bei 2/3.
  assert.ok(Math.abs(v.pitCoverage.beta - 1 / 3) < 1e-9, 'beta-Coverage 1/3');
  assert.ok(Math.abs(v.pitCoverage.evSales - 2 / 3) < 1e-9, 'evSales-Coverage 2/3');
  assert.strictEqual(v.gate.calibrating, true, 'Vintage #1 ist Kalibrierphase');

  // Seiten-Artefakte:
  assert.ok(fs.existsSync(path.join(base, 'board-history', '2026-07-13', 'calibration.json')), 'calibration-Kopie');
  assert.ok(fs.existsSync(path.join(base, 'board-history', '2026-07-13', 'regime.json')), 'regime.json');
});

// ── (b) Wert-Gate: wertfalsches Folge-Vintage → suspect + exit 2 ──────────────
check('(b) wertfalsches Folge-Vintage → suspect:true + exit 2', () => {
  const base = mkBase();
  writeJson(path.join(base, 'snapshots', 'ABC.json'), snapFull('ABC', { withEnds: true }));
  writeJson(path.join(base, 'outputs', 'calibration.json'), { schema: 'calibration/v4', generated_at: 'x' });

  // Tag 1: normales Vintage.
  writeBoard(base, 'semiconductors', [row('ABC', 90)]);
  const r1 = W.run({ baseDir: base, date: '2026-07-13' });
  assert.strictEqual(r1.exitCode, 0);

  // Schwelle künstlich einfrieren (simuliert abgeschlossene Kalibrierphase, Ledger P99×2).
  writeJson(path.join(base, 'board-history', '_gate-calibration.json'),
    { _doc: 'test', boards: { semiconductors: { dailyP99Samples: [0.5, 0.4, 0.5], threshold: 1.0, frozen: true } } });

  // Tag 2: Score springt um +40 (>> Schwelle 1.0) = wertfalsch.
  writeBoard(base, 'semiconductors', [row('ABC', 130)]);
  const r2 = W.run({ baseDir: base, date: '2026-07-14' });
  assert.strictEqual(r2.exitCode, 2, 'exit 2 bei suspect');
  const v2 = readVintage(base, '2026-07-14', 'semiconductors');
  assert.strictEqual(v2.gate.suspect, true, 'suspect-Flag gesetzt');
  assert.strictEqual(v2.gate.calibrating, false, 'nicht mehr in Kalibrierphase (Schwelle frozen)');
  assert.ok(v2.gate.reasons.includes('p99-delta-exceeds-threshold'), 'Grund: Schwellen-Bruch');
  // NIE still: das suspect-Vintage wird trotzdem GESCHRIEBEN (keine Löschung).
  assert.ok(fs.existsSync(path.join(base, 'board-history', '2026-07-14', 'semiconductors.json')));
});

check('(b2) NaN-Einbruch → suspect auch in Kalibrierphase', () => {
  const base = mkBase();
  writeJson(path.join(base, 'snapshots', 'ABC.json'), snapFull('ABC', { withEnds: true }));
  writeJson(path.join(base, 'outputs', 'calibration.json'), { schema: 'calibration/v4', generated_at: 'x' });
  writeBoard(base, 'semiconductors', [row('ABC', 90)]);
  W.run({ baseDir: base, date: '2026-07-13' });
  // Tag 2: Score wird NaN/null (Datenbruch).
  writeBoard(base, 'semiconductors', [{ ...row('ABC', 90), score: null }]);
  const r2 = W.run({ baseDir: base, date: '2026-07-14' });
  assert.strictEqual(r2.exitCode, 2, 'exit 2 bei NaN-Einbruch');
  const v2 = readVintage(base, '2026-07-14', 'semiconductors');
  assert.ok(v2.gate.reasons.includes('nan-break'), 'nan-break auch trotz calibrating');
});

// ── (c) Backdate → --compact greift, Archiv-Kopie, Kern bleibt, PIT gestrippt ─
check('(c) --compact archiviert + strippt Vintages älter als t0+2Q', () => {
  const base = mkBase();
  const RET = W._const.RETENTION_DAYS;
  // Backdate-Vintage: RET+10 Tage vor heute.
  const today = '2026-07-13';
  const oldMs = new Date(today + 'T00:00:00Z').getTime() - (RET + 10) * 86400000;
  const oldDate = new Date(oldMs).toISOString().slice(0, 10);
  const oldVintage = {
    date: oldDate, board: 'semiconductors', boardStatus: 'core', compacted: false,
    cohort: { profitable: [{ rank: 1, ticker: 'ABC', score: 90, scoreBase: 89, pit: { beta: 1.5, revenueQ: [120, 110] } }], unprofitable: [] },
  };
  writeJson(path.join(base, 'board-history', oldDate, 'semiconductors.json'), oldVintage);

  const res = W.run({ baseDir: base, compact: true, date: today });
  assert.strictEqual(res.exitCode, 0);
  assert.ok(res.compacted.length >= 1, 'mindestens 1 Vintage kompaktiert');

  // Archiv-Kopie existiert MIT vollem PIT (GG7c, außerhalb board-history/).
  const archived = JSON.parse(fs.readFileSync(path.join(base, 'board-history-archive', oldDate, 'semiconductors.json'), 'utf8'));
  assert.ok(archived.cohort.profitable[0].pit, 'Archiv trägt vollen PIT-Snapshot');
  assert.strictEqual(archived.cohort.profitable[0].pit.beta, 1.5);

  // Kern-Version: pit gestrippt, rank/score bleiben.
  const lean = readVintage(base, oldDate, 'semiconductors');
  assert.strictEqual(lean.compacted, true);
  assert.strictEqual(lean.cohort.profitable[0].pit, undefined, 'PIT aus Kern-Version entfernt');
  assert.strictEqual(lean.cohort.profitable[0].score, 90, 'Score bleibt');
  assert.strictEqual(lean.cohort.profitable[0].rank, 1, 'Rang bleibt');
  assert.ok(lean.archivedTo && lean.archivedTo.includes('board-history-archive'), 'Verweis auf Archiv');
});

check('(c2) frische Vintages (jünger als t0+2Q) bleiben von --compact unberührt', () => {
  const base = mkBase();
  const today = '2026-07-13';
  const recent = new Date(new Date(today + 'T00:00:00Z').getTime() - 30 * 86400000).toISOString().slice(0, 10);
  writeJson(path.join(base, 'board-history', recent, 'semiconductors.json'),
    { date: recent, board: 'semiconductors', compacted: false, cohort: { profitable: [{ rank: 1, ticker: 'ABC', score: 90, pit: { beta: 1.5 } }], unprofitable: [] } });
  const res = W.run({ baseDir: base, compact: true, date: today });
  assert.strictEqual(res.compacted.length, 0, 'nichts kompaktiert');
  const v = readVintage(base, recent, 'semiconductors');
  assert.ok(v.cohort.profitable[0].pit, 'PIT bleibt bei frischem Vintage');
});

// ── (d) _excluded-Gerüst ─────────────────────────────────────────────────────
check('(d) legt _excluded.json-Gerüst an (leer), Writer schreibt nie Einträge', () => {
  const base = mkBase();
  writeJson(path.join(base, 'snapshots', 'ABC.json'), snapFull('ABC', { withEnds: true }));
  writeJson(path.join(base, 'outputs', 'calibration.json'), { schema: 'calibration/v4', generated_at: 'x' });
  writeBoard(base, 'semiconductors', [row('ABC', 90)]);
  W.run({ baseDir: base, date: '2026-07-13' });
  const ex = JSON.parse(fs.readFileSync(path.join(base, 'board-history', '_excluded.json'), 'utf8'));
  assert.deepStrictEqual(ex.excluded, [], 'Gerüst ist leer');
  assert.ok(/rank-ic/i.test(ex._doc), 'Doku verweist auf rank-ic als Konsument');
});

// ── (e) picks-history unberührt ──────────────────────────────────────────────
check('(e) picks-history bleibt byte-identisch (Verzeichnis-Diff vor/nach)', () => {
  const base = mkBase();
  // picks-history mit einer Datei simulieren.
  const ph = path.join(base, 'picks-history');
  writeJson(path.join(ph, '2026-07-02.json'), { frozen: true, picks: [1, 2, 3] });
  const before = fs.readFileSync(path.join(ph, '2026-07-02.json'), 'utf8');
  const beforeList = fs.readdirSync(ph).sort();

  writeJson(path.join(base, 'snapshots', 'ABC.json'), snapFull('ABC', { withEnds: true }));
  writeJson(path.join(base, 'outputs', 'calibration.json'), { schema: 'calibration/v4', generated_at: 'x' });
  writeBoard(base, 'semiconductors', [row('ABC', 90)]);
  W.run({ baseDir: base, date: '2026-07-13' });

  const afterList = fs.readdirSync(ph).sort();
  const after = fs.readFileSync(path.join(ph, '2026-07-02.json'), 'utf8');
  assert.deepStrictEqual(afterList, beforeList, 'picks-history-Verzeichnis unverändert');
  assert.strictEqual(after, before, 'picks-history-Datei byte-identisch');
});

check('(e2) assertNoPicksHistory blockt jeden picks-history-Pfad strukturell', () => {
  assert.throws(() => W.assertNoPicksHistory('/x/picks-history/2026.json'), /picks-history/);
  assert.throws(() => W.assertNoPicksHistory('picks-history\\a.json'), /picks-history/);
  // Nicht-picks-history-Pfad geht durch:
  assert.strictEqual(W.assertNoPicksHistory('/x/board-history/2026.json'), '/x/board-history/2026.json');
});

// ── Gate-Kalibrierungs-Mechanik (Unit) ───────────────────────────────────────
check('updateGateCalibration friert Schwelle nach 3 Samples = max×2 ein', () => {
  const gc = { boards: {} };
  W.updateGateCalibration(gc, 'b', 0.4);
  W.updateGateCalibration(gc, 'b', 0.6);
  assert.strictEqual(gc.boards.b.frozen, false, 'nach 2 Samples noch nicht frozen');
  W.updateGateCalibration(gc, 'b', 0.5);
  assert.strictEqual(gc.boards.b.frozen, true, 'nach 3 Samples frozen');
  assert.strictEqual(gc.boards.b.threshold, 1.2, 'Schwelle = max(0.6)*2');
  // Nach frozen keine weiteren Samples:
  W.updateGateCalibration(gc, 'b', 99);
  assert.strictEqual(gc.boards.b.threshold, 1.2, 'Schwelle bleibt eingefroren');
});

console.log(fail ? ('\nFAIL: ' + fail + ' Test(s)') : '\nAlle board-history-Tests grün');
process.exit(fail ? 1 : 0);

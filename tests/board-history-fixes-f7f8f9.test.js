// tests/board-history-fixes-f7f8f9.test.js — Regressionstests für die Codex-Funde
// F7/F8/F9 in scripts/write-board-history.js (framework-los: assert + process.exit,
// hermetisch gegen Temp-Fixtures — kein echtes snapshots/outputs/board-history nötig).
//
//   F7  regimeForDate: exakter Key-Lookup verfehlt Wochenend-/Vor-Handelsschluss-Läufe
//       → 'unknown' statt letztem gültigen Regime. Fix: jüngster Key <= Datum, mit
//       begründeter Max-Staleness (zu alt = ehrlich 'unknown' mit Grund, keine stille Lüge).
//   F8  updateGateCalibration: blindes Array-Append ohne Dedup nach Vintage-Datum →
//       mehrere Läufe DESSELBEN Kalendertags zählen als mehrere Live-Vintages und können
//       die Schwelle aus EINEM Tag einfrieren. Fix: je Vintage-Datum genau ein Sample.
//   F9  compact(): Sidecars (calibration.json/regime.json, kein '_') bekamen beim Lean-Write
//       ein leeres cohort injiziert → rank-ic.js zählt sie als Phantom-Boards. Fix: nur
//       Dateien kompaktieren, die bereits ein cohort-Objekt tragen.
//
// Run: node tests/board-history-fixes-f7f8f9.test.js
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

// ── Fixture-Helfer (self-contained; gleiche Form wie board-history.test.js) ────
function mkBase() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'bhfix-'));
  fs.mkdirSync(path.join(base, 'outputs', 'hypergrowth', 'full'), { recursive: true });
  fs.mkdirSync(path.join(base, 'snapshots'), { recursive: true });
  return base;
}
function writeJson(p, o) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(o)); }
function snapFull(ticker) {
  return {
    meta: { ticker, fetchedAt: '2026-07-10T12:00:00.000Z', asOf: '2026-07-13T06:00:00.000Z' },
    metrics: { beta: { value: 1.5 }, enterpriseToRevenue: { value: 8.2 }, priceSales: { value: 10.0 }, grossMargin: { value: 50.0 } },
    timeseries: {
      revenueQ: [{ value: 120 }, { value: 110 }, { value: 100 }],
      grossProfitQ: [{ value: 60 }, { value: 55 }, { value: 50 }],
      revenueQEnds: ['2026-04-30', '2026-01-31', '2025-10-31'],
      grossProfitQEnds: ['2026-04-30', '2026-01-31', '2025-10-31'],
    },
  };
}
function row(ticker, score) {
  return { ticker, score, track: 'profitable', scoreBase: score - 1, scoreShrunk: score - 0.5, coverageAxes: '7/7', lamps: ['x'], axisBreakdown: [{ key: 'revGrowthLevel', pct: 80, weight: 1.7 }] };
}
function writeBoard(base, board, rows) { writeJson(path.join(base, 'outputs', 'hypergrowth', 'full', board + '.json'), { profitable: rows, unprofitable: [] }); }
function readVintage(base, date, board) { return JSON.parse(fs.readFileSync(path.join(base, 'board-history', date, board + '.json'), 'utf8')); }
function readGateCalib(base) { return JSON.parse(fs.readFileSync(path.join(base, 'board-history', '_gate-calibration.json'), 'utf8')); }

// ── F7: Regime-Fallback auf jüngsten Key <= Datum + Staleness-Wächter ─────────
check('(F7a) Wochenend-/Vor-Handelsschluss-Datum erbt das letzte gültige Regime', () => {
  const base = mkBase();
  // macro-regime.json ist nach SPY-Handelsdatum gekeyt. Neuester Key = Fr 2026-07-10.
  writeJson(path.join(base, 'outputs', 'macro-regime.json'), {
    asOf: '2026-07-10T22:00:00Z', ticker: 'SPY',
    regimes: {
      '2026-07-09': { regime: 'BULL', price: 498, sma200: 470 },
      '2026-07-10': { regime: 'BULL', price: 502, sma200: 480 },
    },
  });
  W._setPaths(base);
  // Sa 2026-07-11: KEIN exakter Key → muss Fr 2026-07-10 erben (nicht 'unknown').
  const sat = W.regimeForDate('2026-07-11');
  assert.strictEqual(sat.label, 'BULL', 'Wochenend-Lauf erbt letztes Regime statt unknown');
  assert.strictEqual(sat.asOf, '2026-07-10', 'Sidecar weist ehrlich aus, WELCHER Tag geerbt wurde');
  assert.strictEqual(sat.price, 502, 'geerbte Kennzahlen stammen vom letzten gültigen Tag');
  // Exakter Treffer bleibt exakt (asOf == date).
  const exact = W.regimeForDate('2026-07-10');
  assert.strictEqual(exact.label, 'BULL');
  assert.strictEqual(exact.asOf, '2026-07-10');
  W._setPaths(); // Modul-State zurücksetzen (Default = REPO_ROOT)
});

check('(F7b) Staleness-Wächter: zu altes Regime → ehrlich unknown mit Grund, keine stille Lüge', () => {
  const base = mkBase();
  writeJson(path.join(base, 'outputs', 'macro-regime.json'), {
    regimes: { '2026-07-10': { regime: 'BULL', price: 502, sma200: 480 } },
  });
  W._setPaths(base);
  // 7 Kalendertage nach dem letzten Key: noch innerhalb der Grenze → erbt.
  const atBound = W.regimeForDate('2026-07-17');
  assert.strictEqual(atBound.label, 'BULL', 'genau an der 7-Tage-Grenze noch geerbt');
  // 8 Kalendertage: über der Grenze → unknown, aber MIT Grund (nicht als Regime getarnt).
  const stale = W.regimeForDate('2026-07-18');
  assert.strictEqual(stale.label, 'unknown', 'zu alt → unknown statt stiller Alt-Lüge');
  assert.ok(/stale/.test(stale.source), 'Grund im Sidecar ausgewiesen: ' + stale.source);
  assert.ok(stale.staleDays >= 8, 'Alter transparent geloggt: ' + stale.staleDays);
  W._setPaths();
});

// ── F8: Kalibrier-Samples je Vintage-Datum (Dedup gegen Workflow-Reruns) ──────
check('(F8) drei Reruns DESSELBEN Tags zählen als EIN Live-Vintage (kein Freeze aus 1 Tag)', () => {
  const base = mkBase();
  writeJson(path.join(base, 'snapshots', 'ABC.json'), snapFull('ABC'));
  writeJson(path.join(base, 'outputs', 'calibration.json'), { schema: 'calibration/v4', generated_at: 'x' });

  // Tag 1 (Vintage #1, kein Vorgänger → kein messbares Delta → kein Sample).
  writeBoard(base, 'semiconductors', [row('ABC', 90)]);
  W.run({ baseDir: base, date: '2026-07-13' });
  assert.deepStrictEqual(readGateCalib(base).boards.semiconductors.dailyP99Samples, [],
    'Vintage #1 liefert kein Sample (kein Vorgänger)');

  // Tag 2: Score springt 90→130 (Delta 40). Workflow wird 3× am SELBEN UTC-Tag gefahren
  // (cron + zwei manuelle Re-runs). Jeder Lauf vergleicht gegen denselben Vortag.
  writeBoard(base, 'semiconductors', [row('ABC', 130)]);
  let lastVintage;
  for (let i = 0; i < 3; i++) {
    W.run({ baseDir: base, date: '2026-07-14' });
    lastVintage = readVintage(base, '2026-07-14', 'semiconductors');
  }

  const gc = readGateCalib(base).boards.semiconductors;
  assert.strictEqual(gc.dailyP99Samples.length, 1,
    'ein Kalendertag = genau EIN Sample, egal wie oft der Workflow lief (F8)');
  assert.strictEqual(gc.frozen, false,
    'aus EINEM bewegten Tag darf keine Schwelle einfrieren (Tag-325-Zusammenspiel: >=3 DISTINKTE Tage nötig)');
  assert.strictEqual(lastVintage.gate.calibrationSamples, 1,
    'die deklarierte Live-Vintage-Zählung = distinkte Vintage-Tage, nicht Lauf-Anzahl');
});

check('(F8b) drei DISTINKTE bewegte Tage frieren regulär ein (Fix engt nur Reruns ein)', () => {
  const base = mkBase();
  writeJson(path.join(base, 'snapshots', 'ABC.json'), snapFull('ABC'));
  writeJson(path.join(base, 'outputs', 'calibration.json'), { schema: 'calibration/v4', generated_at: 'x' });
  // 4 aufeinanderfolgende Tage mit je echter Bewegung: #1 ohne Delta, #2/#3/#4 mit Delta.
  const days = [['2026-07-13', 90], ['2026-07-14', 92], ['2026-07-15', 95], ['2026-07-16', 99]];
  for (const [d, s] of days) { writeBoard(base, 'semiconductors', [row('ABC', s)]); W.run({ baseDir: base, date: d }); }
  const gc = readGateCalib(base).boards.semiconductors;
  assert.strictEqual(gc.dailyP99Samples.length, 3, 'drei distinkte messbare Tage → drei Samples');
  assert.strictEqual(gc.frozen, true, 'drei distinkte bewegte Tage frieren die Schwelle regulär ein');
});

// ── F9: compact() lässt Sidecars unberührt (kein injiziertes cohort) ──────────
check('(F9) compact() injiziert Sidecars KEIN cohort → keine Phantom-Boards', () => {
  const base = mkBase();
  const RET = W._const.RETENTION_DAYS;
  const today = '2026-07-13';
  const oldMs = new Date(today + 'T00:00:00Z').getTime() - (RET + 10) * 86400000;
  const oldDate = new Date(oldMs).toISOString().slice(0, 10);

  // Echtes Board-Vintage (mit cohort) + zwei Sidecars (ohne cohort), wie run() sie ablegt.
  writeJson(path.join(base, 'board-history', oldDate, 'semiconductors.json'), {
    date: oldDate, board: 'semiconductors', boardStatus: 'core', compacted: false,
    cohort: { profitable: [{ rank: 1, ticker: 'ABC', score: 90, scoreBase: 89, pit: { beta: 1.5, revenueQ: [120, 110] } }], unprofitable: [] },
  });
  writeJson(path.join(base, 'board-history', oldDate, 'calibration.json'), { schema: 'calibration/v4', generated_at: 'x' });
  writeJson(path.join(base, 'board-history', oldDate, 'regime.json'), { date: oldDate, label: 'BULL', source: 'macro-regime.json' });

  W.run({ baseDir: base, compact: true, date: today });

  // rank-ic.js boardsOf erkennt Boards inhaltsbasiert über !!(v && v.cohort) — genau
  // dieses Feld darf compact() den Sidecars NIE anhängen.
  const isBoard = (v) => !!(v && v.cohort);
  const calib = JSON.parse(fs.readFileSync(path.join(base, 'board-history', oldDate, 'calibration.json'), 'utf8'));
  const regime = JSON.parse(fs.readFileSync(path.join(base, 'board-history', oldDate, 'regime.json'), 'utf8'));
  assert.ok(!('cohort' in calib), 'calibration.json bleibt ohne cohort (kein Phantom-Board)');
  assert.ok(!('cohort' in regime), 'regime.json bleibt ohne cohort (kein Phantom-Board)');
  assert.strictEqual(isBoard(calib), false, 'rank-ic würde calibration.json nicht als Board zählen');
  assert.strictEqual(isBoard(regime), false, 'rank-ic würde regime.json nicht als Board zählen');
  assert.strictEqual(calib.compacted, undefined, 'Sidecar wird gar nicht erst als Vintage angefasst');

  // Regression: das ECHTE Board-Vintage wird weiterhin regulär kompaktiert + PIT gestrippt.
  const lean = readVintage(base, oldDate, 'semiconductors');
  assert.strictEqual(lean.compacted, true, 'echtes Board wird kompaktiert');
  assert.strictEqual(lean.cohort.profitable[0].pit, undefined, 'PIT aus Kern-Version entfernt');
  assert.strictEqual(lean.cohort.profitable[0].score, 90, 'Score bleibt');
});

console.log(fail ? ('\nFAIL: ' + fail + ' Test(s)') : '\nAlle F7/F8/F9-Regressionstests grün');
process.exit(fail ? 1 : 0);

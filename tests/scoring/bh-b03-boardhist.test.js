'use strict';
/**
 * tests/scoring/bh-b03-boardhist.test.js — Batch b03-boardhist Audit-Fixes.
 * Standalone-Runner (framework-los: assert + process.exit), Muster wie
 * tests/board-history.test.js und tests/scoring/*.test.js. Fixtures EINGEBETTET
 * (L4 — kein Netzzugriff, kein Bezug zu echten snapshots/outputs).
 *
 * Deckt die scripts/write-board-history.js-Fixes ab:
 *   BH-105 formulaCommit (GITHUB_SHA) additiv neben formulaVersion
 *   BH-108 reportingCurrencyOriginal/fxRateApplied additiv im PIT-Block
 *   BH-109 revenueQEndsFresh/grossProfitQEndsFresh (Frische-Coverage, ~2Q-Boden)
 *   BH-111 Kohorten-Mindestgröße + Überlappungs-Boden + suspect-Tage kalibrieren nicht
 *   BH-147 --date-Format/Zukunfts-Guard + Pfad-Escape-Guard + Backfill-Vertrag
 *   BH-154 ARCHIVE_DIR außerhalb REPO_ROOT im Produktionspfad (env-konfigurierbar)
 *   BH-155 calibration.json-Sidecar-Dedup (sameAs-Kette) statt Volldupe je Tag
 *
 * Run: node tests/scoring/bh-b03-boardhist.test.js
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const W = require('../../scripts/write-board-history.js');

let fail = 0;
function check(name, fn) {
  try { fn(); console.log('  ok   ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + ': ' + (e && e.message || e)); }
}

// ── Fixture-Helfer (dupliziert aus tests/board-history.test.js, bewusst lokal) ─
function mkBase() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-b03-'));
  fs.mkdirSync(path.join(base, 'outputs', 'hypergrowth', 'full'), { recursive: true });
  fs.mkdirSync(path.join(base, 'snapshots'), { recursive: true });
  return base;
}
function writeJson(p, o) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(o)); }
function snapFull(ticker, opts) {
  opts = opts || {};
  return {
    meta: {
      ticker, fetchedAt: '2026-07-10T12:00:00.000Z', asOf: '2026-07-13T06:00:00.000Z',
      ...(opts.currency ? { reportingCurrencyOriginal: opts.currency } : {}),
      ...(opts.fxRate != null ? { fxRateApplied: opts.fxRate } : {}),
    },
    metrics: {
      beta: { value: 1.5 },
      enterpriseToRevenue: { value: 8.2 },
      priceSales: { value: 10.0, asOf: '2026-07-09T00:00:00.000Z' },
      grossMargin: { value: 50.0 },
    },
    timeseries: {
      revenueQ: [{ value: 120 }, { value: 110 }, { value: 100 }],
      grossProfitQ: [{ value: 60 }, { value: 55 }, { value: 50 }],
      revenueQEnds: opts.revenueQEnds !== undefined ? opts.revenueQEnds : ['2026-04-30', '2026-01-31', '2025-10-31'],
      grossProfitQEnds: opts.revenueQEnds !== undefined ? opts.revenueQEnds : ['2026-04-30', '2026-01-31', '2025-10-31'],
    },
  };
}
function row(ticker, score) {
  return { ticker, score, track: 'profitable', scoreBase: score - 1, scoreShrunk: score - 0.5, coverageAxes: '7/7' };
}
function writeBoard(base, board, rows) {
  writeJson(path.join(base, 'outputs', 'hypergrowth', 'full', board + '.json'), { profitable: rows, unprofitable: [] });
}
function readVintage(base, date, board) {
  return JSON.parse(fs.readFileSync(path.join(base, 'board-history', date, board + '.json'), 'utf8'));
}
function setup1(base, date, ticker, snapOpts) {
  writeJson(path.join(base, 'snapshots', ticker + '.json'), snapFull(ticker, snapOpts));
  writeJson(path.join(base, 'outputs', 'calibration.json'), { schema: 'calibration/v4', generated_at: date });
  writeBoard(base, 'semiconductors', [row(ticker, 90)]);
}

// ── BH-105: formulaCommit (GITHUB_SHA) ───────────────────────────────────────
check('BH-105: formulaCommit = GITHUB_SHA (additiv, formulaVersion unveraendert)', () => {
  const base = mkBase();
  setup1(base, '2026-07-13', 'ABC');
  const prevSha = process.env.GITHUB_SHA;
  try {
    process.env.GITHUB_SHA = 'deadbeef1234567890';
    W.run({ baseDir: base, date: '2026-07-13' });
    const v = readVintage(base, '2026-07-13', 'semiconductors');
    assert.equal(v.formulaCommit, 'deadbeef1234567890', 'formulaCommit aus GITHUB_SHA');
    assert.equal(v.formulaVersion, 'calibration/v4', 'formulaVersion bleibt Bestandsfeld');
  } finally {
    if (prevSha === undefined) delete process.env.GITHUB_SHA; else process.env.GITHUB_SHA = prevSha;
  }
});
check('BH-105: formulaCommit null ohne GITHUB_SHA (lokaler Lauf)', () => {
  const base = mkBase();
  setup1(base, '2026-07-13', 'ABC');
  const prevSha = process.env.GITHUB_SHA;
  try {
    delete process.env.GITHUB_SHA;
    W.run({ baseDir: base, date: '2026-07-13' });
    const v = readVintage(base, '2026-07-13', 'semiconductors');
    assert.equal(v.formulaCommit, null, 'kein GITHUB_SHA -> null, kein Crash');
  } finally {
    if (prevSha === undefined) delete process.env.GITHUB_SHA; else process.env.GITHUB_SHA = prevSha;
  }
});

// ── BH-108: FX-Provenienz im PIT-Block ───────────────────────────────────────
check('BH-108: pit traegt reportingCurrencyOriginal/fxRateApplied additiv', () => {
  const base = mkBase();
  setup1(base, '2026-07-13', 'MKS', { currency: 'GBP', fxRate: 1.27 });
  W.run({ baseDir: base, date: '2026-07-13' });
  const v = readVintage(base, '2026-07-13', 'semiconductors');
  const mks = v.cohort.profitable[0];
  assert.equal(mks.pit.reportingCurrencyOriginal, 'GBP');
  assert.equal(mks.pit.fxRateApplied, 1.27);
  // Bestehende Reihenfolge/Feldern bleiben unberuehrt (Byte-Additivitaet):
  assert.equal(mks.pit.priceSales, 10.0);
  assert.equal(mks.pit.priceSalesAsOf, '2026-07-09T00:00:00.000Z');
  const keys = Object.keys(mks.pit);
  assert.equal(keys[keys.length - 2], 'priceSales', 'priceSales bleibt vorletztes Feld');
  assert.equal(keys[keys.length - 1], 'priceSalesAsOf', 'priceSalesAsOf bleibt letztes Feld');
});
check('BH-108: fehlende FX-Provenienz -> beide Felder null (kein Crash)', () => {
  const base = mkBase();
  setup1(base, '2026-07-13', 'USX');   // kein currency/fxRate in snapOpts
  W.run({ baseDir: base, date: '2026-07-13' });
  const v = readVintage(base, '2026-07-13', 'semiconductors');
  const usx = v.cohort.profitable[0];
  assert.equal(usx.pit.reportingCurrencyOriginal, null);
  assert.equal(usx.pit.fxRateApplied, null);
});

// ── BH-109: Frische-Coverage (~2Q-Boden, RETENTION_DAYS) ─────────────────────
check('BH-109: revenueQEndsFresh unterscheidet frisches von uraltem Ende', () => {
  const base = mkBase();
  // FRISH: Ende 2026-04-30, Vintage-Datum 2026-07-13 (~74 Tage, < RETENTION_DAYS=180).
  setup1(base, '2026-07-13', 'FRESH');
  writeBoard(base, 'semiconductors', [row('FRESH', 90), row('STALE', 80)]);
  // STALE: juengstes Ende > 1 Jahr alt (Audit-Muster: MKS.L 2023-03-31 etc.).
  writeJson(path.join(base, 'snapshots', 'STALE.json'), snapFull('STALE', { revenueQEnds: ['2023-03-31', '2022-12-31'] }));
  W.run({ baseDir: base, date: '2026-07-13' });
  const v = readVintage(base, '2026-07-13', 'semiconductors');

  // Bestehende Present-Semantik unveraendert: BEIDE zaehlen als present (Bestandsverhalten).
  assert.equal(v.pitCoverage.revenueQEnds, 1, 'present zaehlt weiterhin jedes nicht-null Ende (unveraendert)');
  // Neue Fresh-Metrik: nur FRESH zaehlt (1/2 = 0.5), STALE faellt raus.
  assert.ok(Math.abs(v.pitCoverage.revenueQEndsFresh - 0.5) < 1e-9, 'Fresh-Coverage 1/2 (nur FRESH)');
  assert.ok(Math.abs(v.pitCoverage.grossProfitQEndsFresh - 0.5) < 1e-9, 'grossProfitQEndsFresh analog');

  const fresh = v.cohort.profitable.find((r) => r.ticker === 'FRESH');
  const stale = v.cohort.profitable.find((r) => r.ticker === 'STALE');
  assert.ok(fresh.pit.revenueQEnds, 'FRESH pit unveraendert vorhanden');
  assert.ok(stale.pit.revenueQEnds, 'STALE zaehlt weiterhin als present (Bestandsfeld)');
});

// ── BH-111: Kohorten-Mindestgroesse + Ueberlappungs-Boden ────────────────────
check('BH-111: leeres Board (0 Zeilen) -> suspect cohort-empty', () => {
  const base = mkBase();
  writeJson(path.join(base, 'outputs', 'calibration.json'), { schema: 'calibration/v4', generated_at: 'x' });
  writeBoard(base, 'semiconductors', []);   // leere Kohorte
  const res = W.run({ baseDir: base, date: '2026-07-13' });
  assert.equal(res.exitCode, 2, 'leeres Board loest suspect aus');
  const v = readVintage(base, '2026-07-13', 'semiconductors');
  assert.ok(v.gate.reasons.includes('cohort-empty'));
});
check('BH-111: Kohorten-Verlust >50% gegen Vortag -> suspect cohort-overlap-collapse', () => {
  const base = mkBase();
  writeJson(path.join(base, 'outputs', 'calibration.json'), { schema: 'calibration/v4', generated_at: 'x' });
  for (const t of ['A', 'B', 'C', 'D']) writeJson(path.join(base, 'snapshots', t + '.json'), snapFull(t));
  writeBoard(base, 'semiconductors', [row('A', 90), row('B', 80), row('C', 70), row('D', 60)]);
  const r1 = W.run({ baseDir: base, date: '2026-07-13' });
  assert.equal(r1.exitCode, 0, 'Tag 1: 4 Ticker, gesund');

  // Tag 2: nur noch 1 von 4 Tickern uebrig (75% Verlust, weit unter dem 50%-Boden).
  writeBoard(base, 'semiconductors', [row('A', 91)]);
  const r2 = W.run({ baseDir: base, date: '2026-07-14' });
  assert.equal(r2.exitCode, 2, '75% Kohorten-Verlust loest suspect aus');
  const v2 = readVintage(base, '2026-07-14', 'semiconductors');
  assert.ok(v2.gate.reasons.includes('cohort-overlap-collapse'));
});
check('BH-111: normale Tages-Churn (Overlap >=50%) bleibt gesund', () => {
  const base = mkBase();
  writeJson(path.join(base, 'outputs', 'calibration.json'), { schema: 'calibration/v4', generated_at: 'x' });
  for (const t of ['A', 'B', 'C', 'D']) writeJson(path.join(base, 'snapshots', t + '.json'), snapFull(t));
  writeBoard(base, 'semiconductors', [row('A', 90), row('B', 80), row('C', 70), row('D', 60)]);
  W.run({ baseDir: base, date: '2026-07-13' });
  // Tag 2: 3 von 4 bleiben (75% Overlap) -> kein Trigger.
  writeBoard(base, 'semiconductors', [row('A', 91), row('B', 81), row('C', 71)]);
  const r2 = W.run({ baseDir: base, date: '2026-07-14' });
  const v2 = readVintage(base, '2026-07-14', 'semiconductors');
  assert.ok(!v2.gate.reasons.includes('cohort-overlap-collapse'), 'normale Churn loest keinen Fehlalarm aus');
  assert.equal(r2.exitCode, 0);
});
check('BH-111: suspect-Tag (Kohorten-Kollaps) speist die Kalibrierschwelle NICHT', () => {
  const base = mkBase();
  writeJson(path.join(base, 'outputs', 'calibration.json'), { schema: 'calibration/v4', generated_at: 'x' });
  for (const t of ['A', 'B', 'C', 'D']) writeJson(path.join(base, 'snapshots', t + '.json'), snapFull(t));
  writeBoard(base, 'semiconductors', [row('A', 90), row('B', 80), row('C', 70), row('D', 60)]);
  W.run({ baseDir: base, date: '2026-07-13' });   // Tag 1: kein Vortag -> kein Sample

  writeBoard(base, 'semiconductors', [row('A', 90.5), row('B', 80.3), row('C', 70.2), row('D', 60.1)]);
  W.run({ baseDir: base, date: '2026-07-14' });   // Tag 2: kleine, gesunde Deltas -> Sample 1 (p99=0.5)

  // Tag 3: Kohorte kollabiert auf 1/4 (Overlap-Boden verletzt) UND der verbliebene
  // Ticker springt gewaltig — der Delta ist rechnerisch vorhanden (A ist in beiden
  // Maps), aber der Tag ist bereits als suspect erkannt (cohort-overlap-collapse)
  // und darf die Schwelle nicht mit dem kontaminierten Delta mitziehen.
  writeBoard(base, 'semiconductors', [row('A', 200)]);
  const r3 = W.run({ baseDir: base, date: '2026-07-15' });
  assert.equal(r3.exitCode, 2);
  const v3 = readVintage(base, '2026-07-15', 'semiconductors');
  assert.ok(v3.gate.reasons.includes('cohort-overlap-collapse'));
  assert.ok(v3.gate.p99Delta > 100, 'p99Delta ist rechnerisch riesig (kontaminiert)');

  const gc = JSON.parse(fs.readFileSync(path.join(base, 'board-history', '_gate-calibration.json'), 'utf8'));
  assert.equal(gc.boards.semiconductors.dailyP99Samples.length, 1, 'nur Tag-2-Sample; der suspect-Tag speiste nichts');
  assert.ok(!gc.boards.semiconductors.dailyP99Samples.some((d) => d > 50), 'der kontaminierte Delta (>100) ist NICHT in den Samples');
});

// ── BH-147: --date Format/Zukunft/Pfad-Escape + Backfill-Vertrag ────────────
check('BH-147: ungueltiges --date-Format wirft (kein Pfad-Escape moeglich)', () => {
  const base = mkBase();
  setup1(base, '2026-07-13', 'ABC');
  assert.throws(() => W.run({ baseDir: base, date: '../evil' }), /invalid --date/);
  assert.throws(() => W.run({ baseDir: base, date: 'not-a-date' }), /invalid --date/);
  assert.throws(() => W.run({ baseDir: base, date: '2026/07/13' }), /invalid --date/);
  // 2020-13-99 ist formal YYYY-MM-DD-foermig (Regex prueft nur die Form, nicht den
  // Kalender — so in der fixSketch spezifiziert) und liegt nicht in der Zukunft;
  // laeuft daher durch die Datums-Guards durch (kein Format-/Zukunfts-Fehler).
  assert.doesNotThrow(() => W.run({ baseDir: base, date: '2020-13-99' }));
});
check('BH-147: Zukunfts-Datum wirft', () => {
  const base = mkBase();
  setup1(base, '2026-07-13', 'ABC');
  assert.throws(() => W.run({ baseDir: base, date: '2099-01-01' }), /future/);
});
check('BH-147: gueltiges Vergangenheits-Datum laeuft weiterhin (Backfill-API bleibt offen)', () => {
  const base = mkBase();
  setup1(base, '2026-07-13', 'ABC');
  const res = W.run({ baseDir: base, date: '2020-01-01' });
  assert.equal(res.exitCode, 0, 'run() selbst verlangt keinen --allow-backfill-Vertrag (CLI-Grenze, nicht API-Grenze)');
});
check('BH-147: requiresBackfillContract (CLI-Entscheidungslogik, hermetisch)', () => {
  const today = new Date().toISOString().slice(0, 10);
  assert.equal(W.requiresBackfillContract(null, false, false), false, 'kein --date -> kein Vertrag noetig');
  assert.equal(W.requiresBackfillContract(today, false, false), false, 'heutiges Datum -> kein Vertrag noetig');
  assert.equal(W.requiresBackfillContract('2020-01-01', false, false), true, 'Vergangenheits-Datum ohne Vertrag -> blockiert');
  assert.equal(W.requiresBackfillContract('2020-01-01', true, false), false, '--allow-backfill erfuellt den Vertrag');
  assert.equal(W.requiresBackfillContract('2020-01-01', false, true), false, '--dry-run braucht keinen Vertrag');
});
check('BH-147: isValidDateStr grenzt exakt YYYY-MM-DD ab', () => {
  assert.equal(W.isValidDateStr('2026-07-13'), true);
  assert.equal(W.isValidDateStr('2026-7-13'), false);
  assert.equal(W.isValidDateStr('../foo'), false);
  assert.equal(W.isValidDateStr('board-history/../../etc'), false);
  assert.equal(W.isValidDateStr(null), false);
});

// ── BH-154: ARCHIVE_DIR ausserhalb REPO_ROOT (Produktionspfad, env-konfigurierbar) ─
check('BH-154: ARCHIVE_DIR liegt im Produktionspfad NICHT unter REPO_ROOT', () => {
  const prevEnv = process.env.BOARD_HISTORY_ARCHIVE_DIR;
  try {
    delete process.env.BOARD_HISTORY_ARCHIVE_DIR;
    const repoRoot = path.resolve(__dirname, '..', '..');
    const p = W.resolvePaths(repoRoot);   // Default-Base = Produktionspfad
    assert.ok(!p.ARCHIVE_DIR.startsWith(repoRoot + path.sep), 'ARCHIVE_DIR ausserhalb des Checkouts: ' + p.ARCHIVE_DIR);
  } finally {
    if (prevEnv === undefined) delete process.env.BOARD_HISTORY_ARCHIVE_DIR; else process.env.BOARD_HISTORY_ARCHIVE_DIR = prevEnv;
  }
});
check('BH-154: BOARD_HISTORY_ARCHIVE_DIR-Env wird respektiert', () => {
  const prevEnv = process.env.BOARD_HISTORY_ARCHIVE_DIR;
  try {
    const custom = path.join(os.tmpdir(), 'bh-archive-override-test');
    process.env.BOARD_HISTORY_ARCHIVE_DIR = custom;
    const repoRoot = path.resolve(__dirname, '..', '..');
    const p = W.resolvePaths(repoRoot);
    assert.equal(p.ARCHIVE_DIR, custom);
  } finally {
    if (prevEnv === undefined) delete process.env.BOARD_HISTORY_ARCHIVE_DIR; else process.env.BOARD_HISTORY_ARCHIVE_DIR = prevEnv;
  }
});
check('BH-154: Test-Hermetik (_setPaths/baseDir) bleibt base-relativ (unveraendert)', () => {
  const base = mkBase();
  const p = W.resolvePaths(base);
  assert.equal(p.ARCHIVE_DIR, path.join(base, 'board-history-archive'), 'Sandkasten-Basis unveraendert (board-history.test.js Check (c) haengt daran)');
});

// ── BH-155: calibration.json-Sidecar-Dedup ───────────────────────────────────
check('BH-155: unveraenderte Kalibrierung -> Folgetag bekommt sameAs-Verweis statt Vollkopie', () => {
  const base = mkBase();
  setup1(base, '2026-07-13', 'ABC');   // calibration.json bleibt fuer beide Tage identisch
  W.run({ baseDir: base, date: '2026-07-13' });
  writeBoard(base, 'semiconductors', [row('ABC', 91)]);
  W.run({ baseDir: base, date: '2026-07-14' });

  const day1 = JSON.parse(fs.readFileSync(path.join(base, 'board-history', '2026-07-13', 'calibration.json'), 'utf8'));
  const day2 = JSON.parse(fs.readFileSync(path.join(base, 'board-history', '2026-07-14', 'calibration.json'), 'utf8'));
  assert.equal(day1.sameAs, undefined, 'erster Tag ohne Vorgaenger -> volle Kopie');
  assert.equal(day1.schema, 'calibration/v4');
  assert.equal(day2.sameAs, '2026-07-13', 'zweiter Tag mit identischer Kalibrierung -> Verweis statt Vollkopie');
  assert.equal(day2.schema, undefined, 'Stub traegt KEINE Vollkopie-Felder');
});
check('BH-155: geaenderte Kalibrierung -> volle Kopie (kein falsches Dedup)', () => {
  const base = mkBase();
  setup1(base, '2026-07-13', 'ABC');
  W.run({ baseDir: base, date: '2026-07-13' });
  // Kalibrierung aendert sich vor Tag 2:
  writeJson(path.join(base, 'outputs', 'calibration.json'), { schema: 'calibration/v5', generated_at: 'geaendert' });
  writeBoard(base, 'semiconductors', [row('ABC', 91)]);
  W.run({ baseDir: base, date: '2026-07-14' });
  const day2 = JSON.parse(fs.readFileSync(path.join(base, 'board-history', '2026-07-14', 'calibration.json'), 'utf8'));
  assert.equal(day2.sameAs, undefined, 'geaenderte Kalibrierung -> volle Kopie, kein Verweis');
  assert.equal(day2.schema, 'calibration/v5');
});
check('BH-155: resolveFullCalibration folgt einer sameAs-Kette bis zur echten Vollkopie', () => {
  const base = mkBase();
  setup1(base, '2026-07-13', 'ABC');
  W.run({ baseDir: base, date: '2026-07-13' });
  writeBoard(base, 'semiconductors', [row('ABC', 91)]);
  W.run({ baseDir: base, date: '2026-07-14' });   // -> sameAs 2026-07-13
  writeBoard(base, 'semiconductors', [row('ABC', 92)]);
  W.run({ baseDir: base, date: '2026-07-15' });   // -> sollte via Kette ebenfalls dedupen

  const day3 = JSON.parse(fs.readFileSync(path.join(base, 'board-history', '2026-07-15', 'calibration.json'), 'utf8'));
  assert.equal(day3.sameAs, '2026-07-13', 'Kette zeigt auf die ORIGINALE Vollkopie, nicht auf den Zwischen-Stub');

  W._setPaths(base);
  const resolved = W.resolveFullCalibration('2026-07-15');
  assert.equal(resolved.date, '2026-07-13');
  assert.equal(JSON.parse(resolved.json).schema, 'calibration/v4');
});

console.log(fail ? ('\nFAIL: ' + fail + ' Test(s)') : '\nAlle bh-b03-boardhist-Tests gruen');
process.exit(fail ? 1 : 0);

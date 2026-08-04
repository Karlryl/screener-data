// tests/board-history-p99-sidecar.test.js — Standalone-Runner (framework-los).
// Run: node tests/board-history-p99-sidecar.test.js
//
// WOFUER (F-9 Stufe 1, Rat-gedeckt, REINE MESSUNG): write-board-history.js loggt je
// Board die p99Δ/thr/beta-cov-Zeile ("utilities: 331 Zeilen, p99Δ=53.70, thr=11.50 ...")
// nur ins fluechtige Lauf-Protokoll — nach dem naechsten Runner-Teardown ist sie weg.
// Diese Aenderung schreibt dieselben Tageswerte je Board ZUSAETZLICH in eine committete
// Sidecar-Datei (data-health/p99-delta-history.json), AUCH an SUSPECT-Tagen: die
// Sidecar-Commits laufen an Suspect-Tagen ohnehin ("chore: nur Sidecars"-Pfad in
// .github/workflows/daily-pull.yml, git add board-history/ + newcomer-log/ + ticker-map/
// unabhaengig vom rc) — diese Datei faehrt in genau diesem Pfad mit.
//
// HART: kein Gate-Verhalten, keine rc-Semantik, kein Commit-Pfad-Wechsel — nur
// zusaetzlich messen+schreiben. Deshalb pruefen die Tests unten explizit, dass exitCode/
// suspect/threshold-Verhalten UNVERAENDERT bleibt (Regression), und dass die Sidecar-
// Werte exakt aus denselben Feldern stammen, die auch das Lauf-Protokoll ausgibt
// (b.wirksameSchwelle als "thr", b.pitCoverage.beta als "betaCov") — nicht neu berechnet.
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

function mkBase() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-p99-'));
  fs.mkdirSync(path.join(base, 'outputs', 'hypergrowth', 'full'), { recursive: true });
  fs.mkdirSync(path.join(base, 'snapshots'), { recursive: true });
  return base;
}
function writeJson(p, o) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(o)); }
function row(ticker, score) {
  return {
    ticker, score, track: 'profitable',
    scoreBase: score - 1, scoreShrunk: score - 0.5, coverageAxes: '7/7',
    lamps: [], axisBreakdown: [{ key: 'revGrowthLevel', pct: 80, weight: 1.7 }],
  };
}
function writeBoard(base, board, rows) {
  writeJson(path.join(base, 'outputs', 'hypergrowth', 'full', board + '.json'), { profitable: rows, unprofitable: [] });
}
function readSidecar(base) {
  return JSON.parse(fs.readFileSync(path.join(base, 'data-health', 'p99-delta-history.json'), 'utf8'));
}

console.log('board-history: p99Δ-Sidecar-Messreihe (F-9 Stufe 1)');

// ── 1. erstes Vintage ueberhaupt: Sidecar wird trotzdem geschrieben ─────────
check('(1) erstes Vintage -> Sidecar traegt das Datum, Werte = Log-Quellfelder', () => {
  const base = mkBase();
  writeBoard(base, 'semiconductors', [row('AAA', 50), row('BBB', 60)]);
  const res = W.run({ baseDir: base, date: '2026-08-01' });
  assert.strictEqual(res.exitCode, 0, 'Vorbedingung: kein suspect am ersten Tag');
  const sc = readSidecar(base);
  assert.ok(sc.byDate['2026-08-01'], 'Datum fehlt im Sidecar');
  const entry = sc.byDate['2026-08-01'].semiconductors;
  const b = res.boards.find((x) => x.board === 'semiconductors');
  assert.strictEqual(entry.p99Delta, b.p99Delta, 'p99Delta muss identisch zum Lauf-Ergebnis sein');
  assert.strictEqual(entry.thr, b.wirksameSchwelle, 'thr muss dieselbe Zahl sein wie "thr=" im Lauf-Protokoll (wirksameSchwelle)');
  assert.strictEqual(entry.betaCov, b.pitCoverage.beta, 'betaCov muss aus pitCoverage.beta stammen (Log: beta-cov=)');
  assert.strictEqual(entry.suspect, false);
});

// ── 2. ROT-Beleg: Sidecar wird AUCH an einem SUSPECT-Tag geschrieben ────────
check('(2) suspect-Folgetag -> Sidecar traegt den Tag TROTZDEM, suspect:true sichtbar', () => {
  const base = mkBase();
  writeBoard(base, 'semiconductors', [row('AAA', 50), row('BBB', 60)]);
  W.run({ baseDir: base, date: '2026-08-01' });
  // Tag 2: massiver Sprung -> p99Delta > wirksameSchwelle (Kalibrier-Boden 11.5) -> suspect.
  writeBoard(base, 'semiconductors', [row('AAA', 95), row('BBB', 60)]);
  const res2 = W.run({ baseDir: base, date: '2026-08-02' });
  assert.strictEqual(res2.exitCode, 2, 'Vorbedingung: der Tag muss wirklich suspect sein');
  const b2 = res2.boards.find((x) => x.board === 'semiconductors');
  assert.strictEqual(b2.suspect, true, 'Vorbedingung: suspect-Flag gesetzt');
  const sc = readSidecar(base);
  assert.ok(sc.byDate['2026-08-02'], 'GATE-DEFEKT (Rot-Beleg): Sidecar-Eintrag fehlt am SUSPECT-Tag — '
    + 'die Messreihe darf an Suspect-Tagen NICHT luecken, sonst ist "gemessen" wieder nicht von '
    + '"nicht gemessen" zu unterscheiden (dieselbe Fehlerklasse wie GATE BLIND).');
  const entry = sc.byDate['2026-08-02'].semiconductors;
  assert.strictEqual(entry.suspect, true, 'suspect muss im Sidecar sichtbar true sein, nicht verschwiegen');
  assert.strictEqual(entry.p99Delta, b2.p99Delta);
  assert.strictEqual(entry.thr, b2.wirksameSchwelle);
  // ── Ausbau-Probe: Tag 1 bleibt erhalten (Merge, kein Ueberschreiben der Reihe) ──
  assert.ok(sc.byDate['2026-08-01'], 'Tag 1 darf beim Schreiben von Tag 2 nicht verloren gehen');
});

// ── 3. Rerun desselben Datums ersetzt den Tag, dupliziert ihn nicht ────────
check('(3) Rerun desselben Vintage-Tags -> ersetzt den Sidecar-Eintrag, keine Dopplung', () => {
  const base = mkBase();
  writeBoard(base, 'semiconductors', [row('AAA', 50), row('BBB', 60)]);
  W.run({ baseDir: base, date: '2026-08-01' });
  writeBoard(base, 'semiconductors', [row('AAA', 51), row('BBB', 61)]);
  W.run({ baseDir: base, date: '2026-08-01' });
  const sc = readSidecar(base);
  assert.strictEqual(Object.keys(sc.byDate).length, 1, 'derselbe Tag darf nur einmal stehen');
});

// ── 4. --dry-run schreibt NICHTS (wie die uebrigen Seiten-Artefakte) ────────
check('(4) --dry-run schreibt keinen Sidecar (dieselbe Regel wie calibration.json/regime.json)', () => {
  const base = mkBase();
  writeBoard(base, 'semiconductors', [row('AAA', 50), row('BBB', 60)]);
  W.run({ baseDir: base, date: '2026-08-01', dryRun: true });
  assert.ok(!fs.existsSync(path.join(base, 'data-health', 'p99-delta-history.json')),
    'dry-run darf keine Datei anlegen');
});

// ── 5. HART: kein Gate-/rc-Verhaltenseingriff — Regression gegen den Bestand ─
// Derselbe Suspect-Fall wie tests/board-history.test.js (eingefrorene Schwelle,
// Folgetag darueber) muss exitCode/suspect UNVERAENDERT liefern. Ein Sidecar-Bug,
// der versehentlich die Gate-Auswertung selbst veraendert (z. B. weil er vor statt
// nach evaluateGate liest), wuerde hier auffallen.
check('(5) Sidecar-Schreiben veraendert Gate-Ergebnis/rc nicht (Regression)', () => {
  const base = mkBase();
  writeBoard(base, 'semiconductors', [row('AAA', 50), row('BBB', 60)]);
  const r1 = W.run({ baseDir: base, date: '2026-08-01' });
  assert.strictEqual(r1.exitCode, 0);
  writeJson(path.join(base, 'board-history', '_gate-calibration.json'),
    { _doc: 'test', boards: { semiconductors: { dailyP99Samples: Array(20).fill(2), sampleDates: Array(20).fill(0).map((_, i) => 'd' + i), threshold: 4, frozen: true } } });
  writeBoard(base, 'semiconductors', [row('AAA', 90), row('BBB', 60)]);
  const r2 = W.run({ baseDir: base, date: '2026-08-02' });
  assert.strictEqual(r2.exitCode, 2, 'exit 2 bei suspect bleibt unveraendert');
  const sc = readSidecar(base);
  assert.strictEqual(sc.byDate['2026-08-02'].semiconductors.suspect, true);
});

console.log(fail ? '\nFAILED: ' + fail : '\nalle gruen');
process.exit(fail ? 1 : 0);

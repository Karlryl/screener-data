// tests/board-history-massstabbruch.test.js — Standalone-Runner (framework-los).
// Run: node tests/board-history-massstabbruch.test.js
//
// WOFUER: Aendert sich die Score-DEFINITION (Tag 467-469: Anteilsklassen zaehlen als EIN
// Emittent), vergleicht das Wert-Gate am Folgetag Neu-gegen-Alt und misst damit zwei
// verschiedene Massstaebe. Belegt am 27.07.2026 durch einen A/B-Lauf: derselbe
// Kalendertag, dieselbe Vergleichsbasis, dieselben Marktdaten, nur der Code anders ->
// p99-Delta sprang von 0,10 auf 1,10 bei eingefrorener Schwelle 1,00 (Board
// software-comm-services, Kohorte 456 -> 426 Zeilen).
//
// OHNE AUSNAHME waere das Folge-Vintage suspect geblieben und nicht committet worden;
// der naechste Tag haette wieder gegen denselben alten Stand verglichen und dasselbe
// Urteil gefaellt. Ergebnis: dauerhaft rotes CI (Karls einziger Alarmkanal) und eine
// stillstehende Messreihe.
//
// WAS HIER FESTGENAGELT WIRD, ist nicht die Ausnahme, sondern ihre GRENZEN. Drei
// Bedingungen muessen ZUSAMMEN erfuellt sein — Datum registriert, Board NAMENTLICH
// registriert, Kohorte messbar geschrumpft — und die Hoehe der Grenze kommt aus den
// verglichenen Vintages, nicht aus dem Register (eine von Hand eingetragene Messzahl
// waere eine ungeprueft uebernommene Selbstauskunft).
//
// GEGENPROBE (durchgefuehrt): jede der drei Bedingungen einzeln entfernt -> die normale
// Schwelle gilt wieder und derselbe Wert ist suspect. Ohne diese drei Tests waere nicht
// pruefbar, ob die Ausnahme eng ist oder faktisch ein Dauerfreibrief.
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
// Minimales Vintage-Gerippe: evaluateGate liest fuer die Schwellen-Entscheidung nur
// cohort.{profitable,unprofitable}[].{ticker,score} und pitCoverage.
function vintageMit(paare) {
  return {
    pitCoverage: { beta: 1 },
    cohort: { profitable: paare.map(([ticker, score]) => ({ ticker, score })), unprofitable: [] },
  };
}
// Eingefrorene Schwelle 1,00 — exakt der Live-Stand von software-comm-services
// (board-history/_gate-calibration.json, Stichproben 0.3/0.5/0.0).
const GATE_1_00 = { dailyP99Samples: [0.3, 0.5, 0.0], threshold: 1.0, frozen: true };
const BRUCH = { tag: 'Tag 467-469', letztesAltesVintage: '2026-07-27', boards: new Set(['software-comm-services']) };

// 456 Zeilen vorher, `weg` davon fallen weg, die Ueberlebenden bewegen sich um `bewegung`.
// weg=30 entspricht exakt dem echten Bruch (30 von 456 = 6,58 %).
function lage(weg, bewegung) {
  const vorher = []; for (let i = 0; i < 456; i++) vorher.push(['T' + i, 50]);
  const nachher = []; for (let i = weg; i < 456; i++) nachher.push(['T' + i, 50 + bewegung]);
  return { vorher: vintageMit(vorher), nachher: vintageMit(nachher) };
}

// Fixture fuer die Register-Tests, die durch run() gehen muessen (Verdrahtung, nicht nur Logik).
function row(ticker, score) {
  return {
    ticker, score, track: 'profitable',
    scoreBase: score - 1, scoreShrunk: score - 0.5, coverageAxes: '7/7',
    lamps: ['x'], axisBreakdown: [{ key: 'revGrowthLevel', pct: 80, weight: 1.7 }],
  };
}
// vorhandeneVintages: Datums-Verzeichnisse, die schon in board-history/ liegen — damit
// steuert der Test, welchen Vorgaenger priorVintageDate() findet.
function mkBaseMitRegister(brueche, vorhandeneVintages) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-bruch-'));
  fs.mkdirSync(path.join(base, 'outputs', 'hypergrowth', 'full'), { recursive: true });
  fs.mkdirSync(path.join(base, 'snapshots'), { recursive: true });
  fs.mkdirSync(path.join(base, 'board-history'), { recursive: true });
  fs.writeFileSync(path.join(base, 'outputs', 'hypergrowth', 'full', 'software-comm-services.json'),
    JSON.stringify({ profitable: [row('AAA', 50), row('BBB', 60)], unprofitable: [] }));
  fs.writeFileSync(path.join(base, 'outputs', 'calibration.json'),
    JSON.stringify({ schema: 'calibration/v4', generated_at: 'x' }));
  fs.writeFileSync(path.join(base, 'board-history', '_excluded.json'),
    JSON.stringify({ excluded: [], _massstab_brueche: brueche }));
  for (const d of (vorhandeneVintages || [])) {
    fs.mkdirSync(path.join(base, 'board-history', d), { recursive: true });
    fs.writeFileSync(path.join(base, 'board-history', d, 'software-comm-services.json'), JSON.stringify({
      pitCoverage: { beta: 1 }, cohortCount: { profitable: 2, unprofitable: 0 },
      cohort: { profitable: [{ ticker: 'AAA', score: 50 }, { ticker: 'BBB', score: 60 }], unprofitable: [] },
    }));
  }
  return base;
}

console.log('board-history: Massstab-Bruch-Grenze');

// ── 1. Die Ausnahme greift, wo sie soll ──────────────────────────────────────

check('Bruch-Tag: Bewegung unter der Tagesschwelle ist NICHT suspect', () => {
  // 30 von 456 weg = 6,58 % -> Strukturgrenze 6,58, gedeckelt auf 2 x 1,00 = 2,00.
  // Bewegung 1,30 liegt UEBER der normalen Schwelle 1,00, aber unter 2,00.
  const { vorher, nachher } = lage(30, 1.3);
  const g = W.evaluateGate(nachher, vorher, GATE_1_00, BRUCH, 'software-comm-services');
  assert.strictEqual(g.suspect, false, 'p99Δ 1,30 unter Tagesschwelle 2,00 darf nicht suspect sein');
  assert.strictEqual(g.bruchGrenze.tagesschwelle, 2.0);
  assert.strictEqual(g.bruchGrenze.normaleSchwelle, 1.0);
  assert.strictEqual(g.bruchGrenze.zeilenVorher, 456);
  assert.strictEqual(g.bruchGrenze.zeilenNachher, 426);
  assert.strictEqual(g.threshold, 1.0, 'im Vintage bleibt die KALIBRIERTE Schwelle stehen (Historie ehrlich)');
});

check('die Grenze beisst weiter: Bewegung ueber der Tagesschwelle ist suspect', () => {
  const { vorher, nachher } = lage(30, 2.5);
  const g = W.evaluateGate(nachher, vorher, GATE_1_00, BRUCH, 'software-comm-services');
  assert.strictEqual(g.suspect, true, 'p99Δ 2,50 ueber Tagesschwelle 2,00 MUSS suspect sein');
  assert.ok(g.reasons.includes('p99-delta-exceeds-threshold'));
});

check('der Deckel begrenzt: auch massive Schrumpfung hebt nie ueber 2x die Schwelle', () => {
  // 200 von 456 weg = 43,9 % -> Strukturgrenze 43,86. Ohne Deckel waere die Grenze 43,86
  // und das Gate an diesem Tag faktisch abgeschaltet.
  const { vorher, nachher } = lage(200, 3.0);
  const g = W.evaluateGate(nachher, vorher, GATE_1_00, BRUCH, 'software-comm-services');
  assert.ok(g.bruchGrenze.strukturgrenze > 40, 'Strukturgrenze muss hier gross sein: ' + g.bruchGrenze.strukturgrenze);
  assert.strictEqual(g.bruchGrenze.tagesschwelle, 2.0, 'Deckel muss auf 2 x 1,00 kappen');
  assert.strictEqual(g.suspect, true, 'Bewegung 3,00 ueber dem Deckel bleibt suspect');
});

// ── 2. Gegenproben: jede der drei Bedingungen einzeln entfernt ───────────────

check('Gegenprobe BOARD: ein nicht namentlich registriertes Board bekommt die normale Schwelle', () => {
  const { vorher, nachher } = lage(30, 1.3);
  const g = W.evaluateGate(nachher, vorher, GATE_1_00, BRUCH, 'health-care');
  assert.strictEqual(g.bruchGrenze, null, 'nicht registriertes Board darf keine Bruch-Grenze bekommen');
  assert.strictEqual(g.suspect, true, 'mit normaler Schwelle 1,00 ist 1,30 suspect');
});

check('Gegenprobe DATUM: ohne Bruch-Eintrag gilt die normale Schwelle', () => {
  const { vorher, nachher } = lage(30, 1.3);
  const g = W.evaluateGate(nachher, vorher, GATE_1_00, null, 'software-comm-services');
  assert.strictEqual(g.bruchGrenze, null);
  assert.strictEqual(g.suspect, true);
});

check('Gegenprobe SCHRUMPFUNG: waechst die Kohorte, gibt es keine Bruch-Grenze', () => {
  const vorher = []; for (let i = 0; i < 400; i++) vorher.push(['T' + i, 50]);
  const nachher = []; for (let i = 0; i < 456; i++) nachher.push(['T' + i, 51.3]);
  const g = W.evaluateGate(vintageMit(nachher), vintageMit(vorher), GATE_1_00, BRUCH, 'software-comm-services');
  assert.strictEqual(g.bruchGrenze, null, 'ohne Schrumpfung keine Ausnahme');
  assert.strictEqual(g.suspect, true);
});

check('winzige Schrumpfung weicht nichts auf — und macht auch nichts strenger', () => {
  // 1 von 456 weg = 0,22 % -> Strukturgrenze 0,22 < normale Schwelle 1,00. max() haelt die
  // Grenze bei 1,00 (kein Fehlalarm), min() haelt sie dort (keine Aufweichung).
  const { vorher, nachher } = lage(1, 1.3);
  const g = W.evaluateGate(nachher, vorher, GATE_1_00, BRUCH, 'software-comm-services');
  assert.ok(g.bruchGrenze.strukturgrenze < 1.0, 'Strukturgrenze war ' + g.bruchGrenze.strukturgrenze);
  assert.strictEqual(g.bruchGrenze.tagesschwelle, 1.0);
  assert.strictEqual(g.suspect, true);
});

check('in der Kalibrierphase (keine eingefrorene Schwelle) gibt es keine Bruch-Grenze', () => {
  const { vorher, nachher } = lage(30, 1.3);
  const roh = { dailyP99Samples: [0.3], sampleDates: ['a'], threshold: null, frozen: false };
  const g = W.evaluateGate(nachher, vorher, roh, BRUCH, 'software-comm-services');
  assert.strictEqual(g.calibrating, true);
  assert.strictEqual(g.bruchGrenze, null, 'ohne Bezugsschwelle waere jeder Deckel erfunden');
});

// ── 3. Die uebrigen Pruefungen bleiben am Bruch-Tag scharf ───────────────────

check('am Bruch-Tag feuert nan-break unveraendert', () => {
  const vorher = vintageMit([['A', 50], ['B', 50], ['C', 50], ['D', 50]]);
  const nachher = vintageMit([['A', 50], ['B', NaN], ['C', 50]]);   // D+ weg -> Schrumpfung, B kaputt
  const g = W.evaluateGate(nachher, vorher, GATE_1_00, BRUCH, 'software-comm-services');
  assert.ok(g.reasons.includes('nan-break'), 'nan-break muss trotz Bruch-Grenze feuern');
  assert.strictEqual(g.suspect, true);
});

check('am Bruch-Tag feuert der Kohorten-Ueberlappungsboden unveraendert', () => {
  const vorher = []; for (let i = 0; i < 100; i++) vorher.push(['T' + i, 50]);
  const nachher = []; for (let i = 0; i < 30; i++) nachher.push(['T' + i, 50]);
  const g = W.evaluateGate(vintageMit(nachher), vintageMit(vorher), GATE_1_00, BRUCH, 'software-comm-services');
  assert.ok(g.reasons.includes('cohort-overlap-collapse'), '70 % Kohortenverlust muss weiter auffallen');
  assert.strictEqual(g.suspect, true);
});

// ── 4. Register-Leser: fail-closed, kein stiller Merge (durch run() verdrahtet) ──

check('zwei Bruch-Eintraege mit demselben letztes_altes_vintage brechen HART ab', () => {
  const base = mkBaseMitRegister([
    { tag: 'A', letztes_altes_vintage: '2026-07-19', boards: ['software-comm-services'] },
    { tag: 'B', letztes_altes_vintage: '2026-07-19', boards: ['health-care', 'energy'] },
  ], ['2026-07-19']);
  assert.throws(() => W.run({ baseDir: base, date: '2026-07-20', dryRun: true }), /mehrdeutig/,
    'zwei Eintraege fuer denselben Vorgaenger duerfen nicht still gemergt werden');
});

check('Bruch-Eintrag ohne Board-Liste ergibt KEINE Ausnahme (fail-closed)', () => {
  const base = mkBaseMitRegister([{ tag: 'A', letztes_altes_vintage: '2026-07-19' }], ['2026-07-19']);
  const res = W.run({ baseDir: base, date: '2026-07-20', dryRun: true });
  assert.strictEqual(res.bruch, null, 'ohne benannte Boards darf kein Bruch aktiv werden');
});

check('leere Board-Liste ergibt ebenfalls KEINE Ausnahme', () => {
  const base = mkBaseMitRegister([{ tag: 'A', letztes_altes_vintage: '2026-07-19', boards: [] }], ['2026-07-19']);
  const res = W.run({ baseDir: base, date: '2026-07-20', dryRun: true });
  assert.strictEqual(res.bruch, null);
});

check('Bruch-Eintrag fuer einen ANDEREN Vorgaenger bleibt wirkungslos', () => {
  const base = mkBaseMitRegister([{ tag: 'A', letztes_altes_vintage: '2026-09-01', boards: ['software-comm-services'] }], ['2026-07-19']);
  const res = W.run({ baseDir: base, date: '2026-07-20', dryRun: true });
  assert.strictEqual(res.priorDate, '2026-07-19');
  assert.strictEqual(res.bruch, null);
});

check('Gegenprobe DATENLUECKE: ein AELTERER Vorgaenger als registriert aktiviert nichts', () => {
  // Registriert ist der 19.07. als letzter alter Stand. Faellt genau der aus und liegt nur
  // der 17.07. vor, waere der Vergleich ueber mehrere Tage kumuliert — dann MUSS die
  // strengere normale Schwelle gelten, nicht die erhoehte.
  const base = mkBaseMitRegister([{ tag: 'A', letztes_altes_vintage: '2026-07-19', boards: ['software-comm-services'] }], ['2026-07-17']);
  const res = W.run({ baseDir: base, date: '2026-07-20', dryRun: true });
  assert.strictEqual(res.priorDate, '2026-07-17', 'Vorbedingung: der registrierte Vorgaenger fehlt');
  assert.strictEqual(res.bruch, null, 'unerwartete Vergleichsbasis -> normale Schwelle');
});

check('ueberlebt einen ausgefallenen Bruch-Tag: der Folgetag bekommt die Ausnahme erneut', () => {
  // Der Commit-Schritt nimmt bei rc=2 das GANZE Tagesverzeichnis raus — ein fremdes Board
  // kann den Bruch-Tag also mitreissen, obwohl das geschuetzte Board sauber war. Waere die
  // Ausnahme an ein Kalenderdatum gebunden, waere sie dann verbraucht und die Dauersperre
  // zurueck. Am exakten Vorgaenger haengt sie so lange, bis der Bruch wirklich ueberbrueckt ist.
  const base = mkBaseMitRegister([{ tag: 'A', letztes_altes_vintage: '2026-07-19', boards: ['software-comm-services'] }], ['2026-07-19']);
  const tag1 = W.run({ baseDir: base, date: '2026-07-20', dryRun: true });
  const tag2 = W.run({ baseDir: base, date: '2026-07-21', dryRun: true });   // 20.07. nie gelandet
  assert.ok(tag1.bruch, 'Bruch-Tag selbst muss die Ausnahme bekommen');
  assert.ok(tag2.bruch, 'Folgetag ebenfalls, solange der Vergleich noch Neu-gegen-Alt ist');
  assert.strictEqual(tag2.priorDate, '2026-07-19');
});

check('endet von selbst, sobald ein Vintage im neuen Massstab gelandet ist', () => {
  const base = mkBaseMitRegister([{ tag: 'A', letztes_altes_vintage: '2026-07-19', boards: ['software-comm-services'] }], ['2026-07-19', '2026-07-20']);
  const res = W.run({ baseDir: base, date: '2026-07-21', dryRun: true });
  assert.strictEqual(res.priorDate, '2026-07-20', 'jetzt ist der Vorgaenger schon im neuen Massstab');
  assert.strictEqual(res.bruch, null, 'ab hier vergleicht das Gate Gleiches mit Gleichem — keine Ausnahme mehr');
});

check('ohne Vergleichsstand (erstes Vintage ueberhaupt) bleibt der Bruch wirkungslos', () => {
  const base = mkBaseMitRegister([{ tag: 'A', letztes_altes_vintage: '2026-07-19', boards: ['software-comm-services'] }], []);
  const res = W.run({ baseDir: base, date: '2026-07-20', dryRun: true });
  assert.strictEqual(res.priorDate, null, 'Vorbedingung: kein Vorgaenger-Vintage im Fixture');
  assert.strictEqual(res.bruch, null);
});

// ── 5. Der Bruch-Tag darf die Schwelle nicht dauerhaft hochziehen ────────────

check('ein Bruch-Tag liefert KEINE Kalibrier-Stichprobe', () => {
  // Sonst zoege genau der Massstab-Wechsel die eingefrorene Schwelle fuer alle Zukunft
  // hoch — dieselbe Falle, die BH-111 fuer suspect-Tage schon geschlossen hat.
  const calib = { boards: {} };
  const nachNull = W.updateGateCalibration(calib, 'software-comm-services', null, '2026-07-28');
  assert.strictEqual(nachNull.dailyP99Samples.length, 0, 'null-Sample darf nichts anhaengen');
  const nachWert = W.updateGateCalibration(calib, 'software-comm-services', 0.4, '2026-07-29');
  assert.strictEqual(nachWert.dailyP99Samples.length, 1, 'ein echter Wert wird sehr wohl gesammelt');
});

console.log(fail === 0 ? 'ALLE GRUEN' : fail + ' FEHLER');
process.exit(fail === 0 ? 0 : 1);

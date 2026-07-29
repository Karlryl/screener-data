// tests/board-history-gate-blind.test.js — Standalone-Runner (framework-los).
// Run: node tests/board-history-gate-blind.test.js
//
// WOFUER: Am 2026-07-29 standen ALLE Vorgaenger-Vintages auf der Ausschlussliste
// (14.-18.07. wegen Tag 437, 26.-28.07. wegen Tag 489). priorVintageDate() lieferte
// null — richtig so, das ist Karl-Entscheid 10 ("ueber den Bruch hinweg wird nicht
// verglichen"). Die FOLGE war aber unsichtbar: das Wert-Gate hat an diesem Tag nichts
// geprueft, und im geschriebenen Vintage steht dann p99Delta: null, suspect: false.
// Genau dasselbe Bild wie nach einer bestandenen Pruefung.
//
// Nachgesehen im echten Bestand (board-history/2026-07-29/*.json): alle 14 Boards
// tragen p99Delta null und priorDate null. Im Lauf-Protokoll stand davon nur ein
// beilaeufiges "prior=null" in der Kopfzeile — kein Alarmwort, keine Begruendung.
// Karls einziger Alarmkanal ist dieses Protokoll; der Kommentar an der GATE-Kopfzeile
// im CLI-Teil sagt es fuer den Bruch-Fall bereits woertlich ("sonst ist gruen nicht von
// Gate uebergangen zu unterscheiden"). Der Fall "gar keine Vergleichsbasis" fehlte dort.
//
// WAS HIER FESTGENAGELT WIRD ist die SACHE, nicht der Wortlaut: ein Lauf, der ohne
// Vergleichsbasis schreibt, OBWOHL Vorgaenger existieren, muss das melden — und ein
// Lauf, der eine Basis hat oder der allererste ist, darf es NICHT melden. Beide
// Richtungen, sonst waere ein Wachhund, der immer bellt, ebenso "gruen".
//
// Geprueft wird auf zwei Ebenen, weil eine allein nicht traegt:
//   (1) run() liefert das Feld korrekt   — die Logik
//   (2) der echte Prozessaufruf gibt ::warning:: aus — der KANAL. Ein Feld, das
//       niemand ausgibt, waere eine Erkennung ohne Wirkung; genau diese Klasse
//       ("Lampe brennt, wirkt aber nirgends") ist in diesem Repo schon aufgefallen.
//
// GEGENPROBE (durchgefuehrt, jede einzeln, danach zurueckgesetzt und wieder gruen):
//   Alarmwort ::warning:: entfernt          -> Test 5 rot (Test 4 bleibt gruen: der
//                                              Treiber baut den Zweig nach — genau
//                                              deshalb braucht es BEIDE Anker)
//   Bedingung priorDate===null ausgehebelt  -> Tests 1 und 4 rot
//   Meldezweig im CLI-Teil abgeschaltet     -> Test 5 rot
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const W = require('../scripts/write-board-history.js');

let fail = 0;
function check(name, fn) {
  try { fn(); console.log('  ok   ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + ': ' + (e && e.message || e)); }
}

function row(ticker, score) {
  return {
    ticker, score, track: 'profitable',
    scoreBase: score - 1, scoreShrunk: score - 0.5, coverageAxes: '7/7',
    lamps: [], axisBreakdown: [{ key: 'revGrowthLevel', pct: 80, weight: 1.7 }],
  };
}

// vorhandeneVintages: Datums-Verzeichnisse, die in board-history/ liegen.
// ausgeschlossene: Teilmenge davon, die in _excluded.json landet.
function mkBase(vorhandeneVintages, ausgeschlossene) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-blind-'));
  fs.mkdirSync(path.join(base, 'outputs', 'hypergrowth', 'full'), { recursive: true });
  fs.mkdirSync(path.join(base, 'snapshots'), { recursive: true });
  fs.mkdirSync(path.join(base, 'board-history'), { recursive: true });
  fs.writeFileSync(path.join(base, 'outputs', 'hypergrowth', 'full', 'software-comm-services.json'),
    JSON.stringify({ profitable: [row('AAA', 50), row('BBB', 60)], unprofitable: [] }));
  fs.writeFileSync(path.join(base, 'outputs', 'calibration.json'),
    JSON.stringify({ schema: 'calibration/v4', generated_at: 'x' }));
  fs.writeFileSync(path.join(base, 'board-history', '_excluded.json'), JSON.stringify({
    excluded: (ausgeschlossene || []).map((d) => ({ date: d, board: null, reason: 'Testfixture' })),
    _massstab_brueche: [],
  }));
  for (const d of (vorhandeneVintages || [])) {
    fs.mkdirSync(path.join(base, 'board-history', d), { recursive: true });
    fs.writeFileSync(path.join(base, 'board-history', d, 'software-comm-services.json'), JSON.stringify({
      pitCoverage: { beta: 1 }, cohortCount: { profitable: 2, unprofitable: 0 },
      cohort: { profitable: [{ ticker: 'AAA', score: 50 }, { ticker: 'BBB', score: 60 }], unprofitable: [] },
    }));
  }
  return base;
}

console.log('board-history: blindes Wert-Gate wird gemeldet');

// ── 1. Der reale Fall vom 29.07.: Vorgaenger da, alle ausgeschlossen ─────────
check('alle Vorgaenger ausgeschlossen -> ohneVergleichsbasis nennt sie', () => {
  const alle = ['2026-07-26', '2026-07-27', '2026-07-28'];
  const base = mkBase(alle, alle);
  const res = W.run({ baseDir: base, date: '2026-07-29', dryRun: true });
  assert.strictEqual(res.priorDate, null, 'Vorbedingung: kein zulaessiger Vorgaenger');
  assert.deepStrictEqual(res.ohneVergleichsbasis, alle,
    'die uebersprungenen Vorgaenger muessen NAMENTLICH gemeldet werden, nicht nur als Zahl');
  // und das Vintage selbst zeigt dann eben KEINE Messung — das ist der Zustand,
  // der ohne Meldung wie eine bestandene Pruefung aussaehe.
  assert.strictEqual(res.boards[0].p99Delta, null);
  assert.strictEqual(res.boards[0].suspect, false);
});

// ── 2. Gegenrichtung A: gueltige Basis -> KEINE Meldung ─────────────────────
check('gueltiger Vorgaenger vorhanden -> keine Meldung (kein Dauerbellen)', () => {
  const base = mkBase(['2026-07-27', '2026-07-28'], ['2026-07-27']);
  const res = W.run({ baseDir: base, date: '2026-07-29', dryRun: true });
  assert.strictEqual(res.priorDate, '2026-07-28', 'der nicht ausgeschlossene Tag ist die Basis');
  assert.strictEqual(res.ohneVergleichsbasis, null,
    'mit Vergleichsbasis darf nichts gemeldet werden — sonst ist die Meldung wertlos');
});

// ── 3. Gegenrichtung B: allererster Lauf -> KEINE Meldung ───────────────────
check('allererstes Vintage ueberhaupt -> keine Meldung (kein Vorgaenger ist normal)', () => {
  const base = mkBase([], []);
  const res = W.run({ baseDir: base, date: '2026-07-29', dryRun: true });
  assert.strictEqual(res.priorDate, null);
  assert.strictEqual(res.ohneVergleichsbasis, null,
    '"es gab noch nie ein Vintage" ist etwas anderes als "alle Vorgaenger verworfen"');
});

// ── 4. Der KANAL: der echte Prozess gibt die Warnung wirklich aus ───────────
check('CLI-Lauf schreibt ::warning:: GATE BLIND ins Protokoll', () => {
  const alle = ['2026-07-26', '2026-07-27', '2026-07-28'];
  const base = mkBase(alle, alle);
  // Der Writer laeuft gegen baseDir nur ueber run(); der CLI-Teil nutzt REPO_ROOT.
  // Deshalb wird hier ein kleiner Treiber gestartet, der genau den CLI-Ausgabepfad
  // benutzt — das ist der Unterschied zwischen "Feld gesetzt" und "Karl sieht es".
  const treiber = path.join(base, 'treiber.js');
  const skript = path.resolve(__dirname, '..', 'scripts', 'write-board-history.js').replace(/\\/g, '\\\\');
  fs.writeFileSync(treiber, [
    'const W = require("' + skript + '");',
    'const res = W.run({ baseDir: ' + JSON.stringify(base) + ', date: "2026-07-29", dryRun: true });',
    // exakt der Ausgabe-Zweig aus dem CLI-Teil, ueber das Ergebnisfeld angesteuert
    'if (res.ohneVergleichsbasis) {',
    '  console.log("::warning::GATE BLIND fuer " + res.date + ": keine Vergleichsbasis — alle "',
    '    + res.ohneVergleichsbasis.length + " Vorgaenger stehen auf der Ausschlussliste.");',
    '}',
  ].join('\n'));
  const aus = execFileSync(process.execPath, [treiber], { encoding: 'utf8' });
  assert.ok(/::warning::/.test(aus), 'die Meldung muss im GitHub-Warnkanal stehen, nicht als stille Zeile');
  assert.ok(/GATE BLIND/.test(aus), 'sie muss benennen, was passiert ist');
  assert.ok(/2026-07-29/.test(aus), 'und fuer welchen Tag');
});

// ── 5. Der Ausgabe-Zweig existiert im echten Skript, nicht nur im Treiber ───
// Ohne diesen Anker koennte Test 4 gruen bleiben, waehrend die Meldung im Skript
// selbst geloescht wurde — der Treiber baut sie ja nach. Geprueft wird deshalb der
// Quelltext an der Sache: die Bedingung auf dem Ergebnisfeld UND das Alarmwort.
check('das Skript selbst enthaelt den Meldezweig (nicht nur der Testtreiber)', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'scripts', 'write-board-history.js'), 'utf8');
  assert.ok(/if \(res\.ohneVergleichsbasis\)/.test(src),
    'der CLI-Teil muss auf res.ohneVergleichsbasis reagieren');
  assert.ok(/::warning::GATE BLIND/.test(src),
    'und zwar im Warnkanal — eine console.log-Zeile ohne ::warning:: geht in der Lauf-Ausgabe unter');
});

console.log(fail ? '\nFAILED: ' + fail : '\nalle gruen');
process.exit(fail ? 1 : 0);

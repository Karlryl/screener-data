// tests/board-history-gate-neukalibrierung.test.js — Standalone-Runner (framework-los).
// Run: node tests/board-history-gate-neukalibrierung.test.js
//
// WOFUER: Das Wert-Gate hat seit dem 30.07.2026 jeden neuen Messpunkt verworfen. Nicht
// wegen kaputter Daten — wegen kaputter Schwellen. Zwei Live-Laeufe belegen es:
//
//   Lauf 30516194703 (Vintage 2026-07-30, Vorgaenger 29.07., EIN Tag Abstand)
//     Bewegung 0,40 .. 5,30 (Median 2,00) -> 4 von 13 Boards SUSPECT.
//     health-care 2,20 gegen 1,00 · materials 1,60 gegen 1,40 ·
//     software-comm-services 2,50 gegen 1,00 · utilities 5,30 gegen 1,20.
//     Gleichzeitig ging real-estate mit der GROESSEREN Bewegung 4,30 durch (Schwelle 5,80)
//     und it-services haette bis 40,20 alles durchgelassen.
//   Lauf 30752200575 (Vintage 2026-08-02, derselbe Vorgaenger 29.07., VIER Tage Abstand)
//     Bewegung 1,70 .. 22,90 -> 8 von 13 Boards SUSPECT.
//
// Der zweite Lauf zeigt zusaetzlich die Selbstverstaerkung: jeder verworfene Messpunkt
// vergroessert den Abstand des naechsten Vergleichs, also auch dessen Bewegung — die
// Sperre zieht sich selbst fest.
//
// WAS HIER FESTGENAGELT WIRD (jede Zusicherung ist eine Sache, kein Schreibmuster):
//   1. Normale Tagesbewegung ist kein Datenfehler — geprueft an den 26 echten
//      Messwerten der beiden Laeufe gegen die AUSGELIEFERTE Kalibrierdatei.
//   2. Das Gate beisst weiter — auch ohne board-eigene Schwelle (Groessenordnungssprung).
//   3. Der Tagesabstand geht in die Grenze ein (keine Selbstverstaerkung mehr).
//   4. Jenseits eines vollen Wochenabstands wird nicht mehr geurteilt, sondern LAUT
//      abgestanden — der Weg zurueck in die Dauersperre ist strukturell zu.
//   5. Die Kalibrierung lernt pro TAG, nicht pro Lauf-Abstand.
//   6. Keine ausgelieferte Schwelle darf aus ausgeschlossenen Vintages stammen.
//   7. Eingefroren wird erst nach N echten Stichproben, und EINE Ausreisser-Stichprobe
//      darf die Schwelle nicht mehr allein setzen.
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

const REPO = path.resolve(__dirname, '..');
const HIST = path.join(REPO, 'board-history');
const BODEN = W._const.MIN_GATE_THRESHOLD;

// ── Messwerte der beiden Live-Laeufe (aus den Lauf-Protokollen abgeschrieben, nicht
// geschaetzt: gh run view <id> --log, Schritt "Write board-history vintage (2.3)").
// survival ist in beiden Laeufen ungegatet (p99Δ=—) und steht deshalb nicht hier.
const LAUF_30_07_GAP1 = {   // Lauf 30516194703
  'consumer-discretionary': 3.00, 'consumer-staples': 0.40, 'energy': 0.80,
  'financials': 2.60, 'health-care': 2.20, 'industrials': 1.80, 'it-services': 2.00,
  'materials': 1.60, 'real-estate': 4.30, 'semiconductors': 0.90,
  'software-comm-services': 2.50, 'tech-hardware': 0.40, 'utilities': 5.30,
};
const LAUF_02_08_GAP4 = {   // Lauf 30752200575
  'consumer-discretionary': 6.40, 'consumer-staples': 8.40, 'energy': 13.90,
  'financials': 5.20, 'health-care': 4.20, 'industrials': 9.30, 'it-services': 1.70,
  'materials': 5.10, 'real-estate': 7.60, 'semiconductors': 7.50,
  'software-comm-services': 4.50, 'tech-hardware': 2.80, 'utilities': 22.90,
};

// ── Fixture-Helfer ───────────────────────────────────────────────────────────
// evaluateGate liest fuer die Schwellen-Entscheidung cohort.{profitable,unprofitable}[]
// .{ticker,score}, pitCoverage und (neu) date.
function vintageMit(datum, paare) {
  return {
    date: datum,
    pitCoverage: { beta: 1 },
    cohort: { profitable: paare.map(([ticker, score]) => ({ ticker, score })), unprofitable: [] },
  };
}
// Kohorte, in der sich JEDE Zeile um `bewegung` verschiebt -> p99 des Tagesdeltas
// ist exakt `bewegung` (nearest-rank ueber lauter gleiche Werte).
function paar(datumVorher, datumNachher, bewegung, n) {
  const zeilen = n || 40;
  const vorher = [], nachher = [];
  for (let i = 0; i < zeilen; i++) { vorher.push(['T' + i, 50]); nachher.push(['T' + i, 50 + bewegung]); }
  return { vorher: vintageMit(datumVorher, vorher), nachher: vintageMit(datumNachher, nachher) };
}

function ausgelieferteKalibrierung() {
  return JSON.parse(fs.readFileSync(path.join(HIST, '_gate-calibration.json'), 'utf8'));
}

console.log('board-history: Wert-Gate Neukalibrierung');

// ── 1. Normale Tagesbewegung ist kein Datenfehler ────────────────────────────
// Gegen die AUSGELIEFERTE Kalibrierdatei geprueft, nicht gegen eine Test-Schwelle:
// dieser Test faellt, sobald wieder eine Schwelle ausgeliefert wird, die unter der
// gemessenen Normalbewegung liegt. Genau das war der Defekt.
check('(1) die 13 gemessenen Bewegungen vom 30.07. (1 Tag) sind KEIN Fund', () => {
  const kal = ausgelieferteKalibrierung();
  const treffer = [];
  for (const [board, bewegung] of Object.entries(LAUF_30_07_GAP1)) {
    const { vorher, nachher } = paar('2026-07-29', '2026-07-30', bewegung);
    const g = W.evaluateGate(nachher, vorher, kal.boards[board], null, board);
    if (g.suspect) treffer.push(board + ' ' + bewegung.toFixed(2) + ' > ' + g.wirksameSchwelle);
  }
  assert.deepStrictEqual(treffer, [], 'normale Tagesbewegung darf nicht als Datenfehler gelten: ' + treffer.join(' · '));
});

check('(1b) dieselbe Pruefung fuer den 4-Tages-Lauf vom 02.08.', () => {
  const kal = ausgelieferteKalibrierung();
  const treffer = [];
  for (const [board, bewegung] of Object.entries(LAUF_02_08_GAP4)) {
    const { vorher, nachher } = paar('2026-07-29', '2026-08-02', bewegung);
    const g = W.evaluateGate(nachher, vorher, kal.boards[board], null, board);
    if (g.suspect) treffer.push(board + ' ' + bewegung.toFixed(2) + ' > ' + g.wirksameSchwelle);
  }
  assert.deepStrictEqual(treffer, [], 'ueber vier Tage kumulierte Normalbewegung ist kein Datenfehler: ' + treffer.join(' · '));
});

// ── 2. Das Gate beisst weiter ────────────────────────────────────────────────
check('(2) Groessenordnungssprung feuert AUCH ohne board-eigene Schwelle', () => {
  // Nach der Neukalibrierung hat kein Board eine eigene eingefrorene Schwelle. Waere
  // die Wert-Achse dann stumm, haette die Reparatur das Gate abgeschaltet statt es
  // zu richten — und survival waere weiterhin ueberhaupt nie geprueft.
  const roh = { dailyP99Samples: [], sampleDates: [], threshold: null, frozen: false };
  const { vorher, nachher } = paar('2026-08-02', '2026-08-03', BODEN * 1.5);
  const g = W.evaluateGate(nachher, vorher, roh, null, 'survival');
  assert.strictEqual(g.calibrating, true, 'Vorbedingung: kein board-eigenes Mass vorhanden');
  assert.strictEqual(g.suspect, true, 'ein Sprung ueber dem gemessenen Boden MUSS auffallen');
  assert.ok(g.reasons.includes('p99-delta-exceeds-threshold'), 'Grund: Schwellen-Bruch');
});

check('(2b) knapp unter dem Boden bleibt still (der Boden ist eine Grenze, kein Dauerfeuer)', () => {
  const roh = { dailyP99Samples: [], sampleDates: [], threshold: null, frozen: false };
  const { vorher, nachher } = paar('2026-08-02', '2026-08-03', BODEN * 0.99);
  const g = W.evaluateGate(nachher, vorher, roh, null, 'survival');
  assert.strictEqual(g.suspect, false);
});

check('(2c) der Boden liegt ueber jeder gemessenen Normalbewegung, aber weit unter einem Bruch', () => {
  // Groesste je auf dem heutigen Massstab gemessene Tagesbewegung: utilities 5,30 (30.07.,
  // 1 Tag) bzw. 22,90/4 = 5,73 (02.08., 4 Tage). Groesste in der committeten Historie
  // gemessene EIN-Tages-Bewegung eines Bruchtags: industrials 19,50 (16.->17.07.).
  assert.ok(BODEN > 5.73, 'Boden muss ueber der groessten gemessenen Normalbewegung liegen: ' + BODEN);
  assert.ok(BODEN < 19.5, 'Boden muss unter der kleinsten gemessenen Bruch-Bewegung liegen: ' + BODEN);
});

// ── 3. Tagesabstand geht in die Grenze ein ───────────────────────────────────
check('(3) dieselbe Bewegung: ueber 4 Tage erlaubt, an EINEM Tag verdaechtig', () => {
  const roh = { dailyP99Samples: [], sampleDates: [], threshold: null, frozen: false };
  const bewegung = BODEN * 3;   // 3x die Tagesgrenze
  const vier = paar('2026-07-29', '2026-08-02', bewegung);
  const eins = paar('2026-08-02', '2026-08-03', bewegung);
  const gVier = W.evaluateGate(vier.nachher, vier.vorher, roh, null, 'utilities');
  const gEins = W.evaluateGate(eins.nachher, eins.vorher, roh, null, 'utilities');
  assert.strictEqual(gVier.gapDays, 4, 'Abstand wird aus den Vintage-Daten gelesen');
  assert.strictEqual(gEins.gapDays, 1);
  assert.strictEqual(gVier.suspect, false, 'ueber 4 Tage kumulierte 3-fache Tagesbewegung ist normal');
  assert.strictEqual(gEins.suspect, true, 'dieselbe Bewegung an EINEM Tag ist es nicht');
});

check('(3b) die Grenze waechst genau mit dem Abstand, nicht sprunghaft', () => {
  const roh = { dailyP99Samples: [], sampleDates: [], threshold: null, frozen: false };
  for (const [von, bis, tage] of [['2026-08-02', '2026-08-03', 1], ['2026-07-31', '2026-08-03', 3], ['2026-07-29', '2026-08-03', 5]]) {
    const { vorher, nachher } = paar(von, bis, 0.1);
    const g = W.evaluateGate(nachher, vorher, roh, null, 'utilities');
    assert.strictEqual(g.gapDays, tage, von + '->' + bis);
    assert.ok(Math.abs(g.wirksameSchwelle - BODEN * tage) < 1e-9,
      'Grenze bei ' + tage + ' Tagen muss ' + (BODEN * tage) + ' sein, war ' + g.wirksameSchwelle);
  }
});

// ── 4. Jenseits eines Wochenabstands wird abgestanden, nicht gesperrt ────────
check('(4) Abstand groesser als das Maximum: Wert-Achse urteilt NICHT (Anti-Dauersperre)', () => {
  const roh = { dailyP99Samples: [], sampleDates: [], threshold: null, frozen: false };
  const maxTage = W._const.GATE_MAX_ABSTAND_TAGE;
  const bis = new Date(Date.parse('2026-08-03T00:00:00Z') + (maxTage + 1) * 86400000).toISOString().slice(0, 10);
  const { vorher, nachher } = paar('2026-08-03', bis, 90);   // absurd grosse Bewegung
  const g = W.evaluateGate(nachher, vorher, roh, null, 'utilities');
  assert.strictEqual(g.gapDays, maxTage + 1);
  assert.strictEqual(g.abstandZuGross, true, 'jenseits des Maximums gibt es keinen Tages-Massstab mehr');
  assert.ok(!g.reasons.includes('p99-delta-exceeds-threshold'),
    'sonst faellt die Messreihe genau dann in die Dauersperre, wenn sie am laengsten still stand');
  assert.strictEqual(g.wirksameSchwelle, null, 'keine erfundene Grenze ausweisen');
  assert.ok(g.p99Delta > 0, 'das Delta wird trotzdem protokolliert (nicht "sauber", sondern "nicht geprueft")');
});

check('(4b) die uebrigen Integritaetspruefungen bleiben auch bei grossem Abstand scharf', () => {
  const roh = { dailyP99Samples: [], sampleDates: [], threshold: null, frozen: false };
  const maxTage = W._const.GATE_MAX_ABSTAND_TAGE;
  const bis = new Date(Date.parse('2026-08-03T00:00:00Z') + (maxTage + 1) * 86400000).toISOString().slice(0, 10);
  const vorher = vintageMit('2026-08-03', [['A', 50], ['B', 50], ['C', 50], ['D', 50]]);
  const nachher = vintageMit(bis, [['A', 50], ['B', NaN], ['C', 50], ['D', 50]]);
  const g = W.evaluateGate(nachher, vorher, roh, null, 'utilities');
  assert.strictEqual(g.abstandZuGross, true);
  assert.ok(g.reasons.includes('nan-break'), 'NaN-Einbruch ist kein Tages-Massstab-Thema');
  assert.strictEqual(g.suspect, true);
});

// ── 5. Die Kalibrierung lernt pro TAG ────────────────────────────────────────
check('(5) ein 4-Tages-Vergleich liefert die Stichprobe PRO TAG, nicht roh', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-gate-'));
  fs.mkdirSync(path.join(base, 'outputs', 'hypergrowth', 'full'), { recursive: true });
  fs.mkdirSync(path.join(base, 'snapshots'), { recursive: true });
  fs.writeFileSync(path.join(base, 'outputs', 'calibration.json'), JSON.stringify({ schema: 'calibration/v4', generated_at: 'x' }));
  const board = (score) => fs.writeFileSync(path.join(base, 'outputs', 'hypergrowth', 'full', 'utilities.json'),
    JSON.stringify({ profitable: [{ ticker: 'AAA', score }], unprofitable: [] }));
  board(50);
  W.run({ baseDir: base, date: '2026-07-29' });
  board(54);                                     // +4 ueber 4 Kalendertage
  W.run({ baseDir: base, date: '2026-08-02' });
  const gc = JSON.parse(fs.readFileSync(path.join(base, 'board-history', '_gate-calibration.json'), 'utf8'));
  assert.strictEqual(gc.boards.utilities.dailyP99Samples.length, 1);
  assert.ok(Math.abs(gc.boards.utilities.dailyP99Samples[0] - 1) < 1e-9,
    'Delta 4 ueber 4 Tage = Tagesstichprobe 1, war ' + gc.boards.utilities.dailyP99Samples[0]);
});

// ── 6. Keine Schwelle aus ausgeschlossenen Vintages ──────────────────────────
check('(6) keine ausgelieferte Schwelle stammt aus ausgeschlossenen oder unbekannten Vintages', () => {
  // Der eigentliche Defekt: ALLE eingefrorenen Schwellen stammten aus den Vintages
  // 2026-07-14..18 (+ 07-26 fuer it-services) — jedes einzelne davon steht in
  // board-history/_excluded.json. Das Projekt vergleicht ueber einen Massstabsbruch
  // hinweg nicht; eine Schwelle, die genau daraus gelernt wurde, ist unbrauchbar.
  const kal = ausgelieferteKalibrierung();
  const excl = JSON.parse(fs.readFileSync(path.join(HIST, '_excluded.json'), 'utf8'));
  const ausgeschlossen = new Set((excl.excluded || []).filter((e) => e && !e.board && e.date).map((e) => e.date));
  assert.ok(ausgeschlossen.size > 0, 'Vorbedingung: es gibt ueberhaupt ausgeschlossene Vintages');
  const verstoesse = [];
  for (const [board, st] of Object.entries(kal.boards || {})) {
    if (!st || !st.frozen) continue;
    const daten = Array.isArray(st.sampleDates) ? st.sampleDates : [];
    if (daten.length !== (st.dailyP99Samples || []).length) { verstoesse.push(board + ': Stichproben ohne Datum'); continue; }
    for (const d of daten) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) verstoesse.push(board + ': Stichprobe ohne echtes Datum (' + d + ')');
      else if (ausgeschlossen.has(d)) verstoesse.push(board + ': Stichprobe aus ausgeschlossenem Vintage ' + d);
    }
  }
  assert.deepStrictEqual(verstoesse, [], verstoesse.join(' · '));
});

check('(6b) der naechste Lauf ueberschreibt die Herleitung nicht', () => {
  // write-board-history.js liest _gate-calibration.json und schreibt sie am Ende komplett
  // zurueck. Faellt dabei die Herleitung heraus, waere die Neukalibrierung nach einem
  // einzigen Lauf undokumentiert — und niemand merkte es, weil die Boards weiter stimmen.
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-gate6b-'));
  fs.mkdirSync(path.join(base, 'outputs', 'hypergrowth', 'full'), { recursive: true });
  fs.mkdirSync(path.join(base, 'snapshots'), { recursive: true });
  fs.mkdirSync(path.join(base, 'board-history'), { recursive: true });
  fs.writeFileSync(path.join(base, 'outputs', 'calibration.json'), JSON.stringify({ schema: 'calibration/v4', generated_at: 'x' }));
  fs.writeFileSync(path.join(base, 'outputs', 'hypergrowth', 'full', 'utilities.json'),
    JSON.stringify({ profitable: [{ ticker: 'AAA', score: 50 }], unprofitable: [] }));
  fs.copyFileSync(path.join(HIST, '_gate-calibration.json'), path.join(base, 'board-history', '_gate-calibration.json'));
  W.run({ baseDir: base, date: '2026-08-03' });
  const nachher = JSON.parse(fs.readFileSync(path.join(base, 'board-history', '_gate-calibration.json'), 'utf8'));
  for (const key of ['_boden_herleitung', '_neukalibrierung_2026_08_03', '_verworfen']) {
    assert.ok(nachher[key], key + ' muss den Schreib-Durchlauf ueberleben');
  }
  assert.ok(nachher._verworfen.boards['it-services'].dailyP99Samples.includes(20.099999999999994),
    'die verworfenen Rohmessungen bleiben unveraendert erhalten');
});

// ── 7. Einfrieren erst nach N echten Stichproben, robust gegen einen Ausreisser ──
check('(7) N Stichproben noetig — und EINE Ausreisser-Stichprobe setzt die Schwelle nicht mehr allein', () => {
  const N = W._const.CALIBRATION_SAMPLES;
  assert.ok(N >= 20, 'drei Stichproben waren nachweislich zu wenig (8 von 13 Boards falsch), N ist jetzt ' + N);
  const gc = { boards: {} };
  for (let i = 0; i < N - 1; i++) W.updateGateCalibration(gc, 'b', 1, '2026-01-' + String(i + 1).padStart(2, '0'));
  assert.strictEqual(gc.boards.b.frozen, false, 'N-1 Stichproben frieren noch nicht ein');
  W.updateGateCalibration(gc, 'b', 999, '2026-02-01');   // ein einzelner Bruchtag
  assert.strictEqual(gc.boards.b.frozen, true, 'jetzt N Stichproben -> eingefroren');
  assert.ok(gc.boards.b.threshold < 999,
    'ein einzelner Bruchtag darf die Schwelle nicht mehr setzen (war genau der Fehler bei it-services 40,20), war ' + gc.boards.b.threshold);
  assert.ok(gc.boards.b.dailyP99Samples.includes(999), 'die Rohmessung bleibt trotzdem unveraendert stehen');
});

console.log(fail === 0 ? 'ALLE GRUEN' : fail + ' FEHLER');
process.exit(fail === 0 ? 0 : 1);

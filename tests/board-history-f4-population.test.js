// tests/board-history-f4-population.test.js — Standalone-Runner (assert + process.exit).
//
// Waechter fuer die Zaehlung UND das Gate der F-4-Ausnahme-Population (Review 16.08.).
//
// Die Sache, die hier festgenagelt wird, ist nicht ein Feldname, sondern: WAECHST die
// Population der Zeilen ohne zuordenbares Perioden-Ende, faellt das auf. Vorher fiel es
// nicht auf — der einzige vorhandene Alarm (COVERAGE_COLLAPSE_DROP) misst Praesenz-Quoten
// gegen 25 Prozentpunkte und haette bei einer Baseline von 3 aus 8.490 Zeilen erst bei
// ueber 2.100 neuen Zeilen gefeuert. Ein Wachstum von 3 auf 900 war unsichtbar.
//
// (a) die Zaehlung benutzt DIESELBE Klausel wie das Kadenz-Gate, nicht eine nachgebaute
// (b) unter beiden Decken bleibt es gruen  <- sonst prueft (c)/(d) nur, dass alles rot ist
// (c) ueber der absoluten Decke wird es rot
// (d) der Sprung unter der Decke wird rot — und zwar an der Vervielfachung, nicht an 50
// (e) Decken kommen aus den KONSTANTEN, nicht aus abgeschriebenen Zahlen
//
// Run: node tests/board-history-f4-population.test.js
'use strict';
const assert = require('assert');
const W = require('../scripts/write-board-history.js');
const axes = require('../src/scoring/axes.js');

const { F4_OHNE_ENDEN_MAX, F4_OHNE_ENDEN_FAKTOR, F4_OHNE_ENDEN_SPRUNG_AB } = W._const;

let fail = 0;
function check(name, fn) {
  try { fn(); console.log('  ok   ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + ': ' + (e && e.message || e)); }
}

// Eine PIT-Zeile, wie buildPit sie ablegt: revenueQ ist eine flache Zahlenreihe,
// revenueQEnds das Roh-Array oder null.
const zeile = (ticker, revenueQ, revenueQEnds) => ({ ticker, pit: { revenueQ, revenueQEnds } });
const WERTE = [120, 110, 100];
const ENDEN = ['2026-06-30', '2026-03-31', '2025-12-31'];

// Minimal-Vintage, das an allen ANDEREN Gate-Gruenden vorbeikommt (nicht leer, gleiche
// Ticker wie der Vorgaenger, gleiche Coverage, ein Tag Abstand) — was rot wird, wird
// dann nachweislich an dieser einen Achse rot.
function vintage(date, anzahl, mitWertereihe = 8490) {
  return {
    date,
    pitCoverage: { beta: 1 },
    f4OhneEnden: { anzahl, mitWertereihe },
    cohort: { profitable: [{ ticker: 'AAA', score: 50, lamps: [] }], unprofitable: [] },
  };
}
const gruende = (jetzt, vorher) => W.evaluateGate(jetzt, vorher, null, null, 'hg').reasons;
const f4Gruende = (jetzt, vorher) => gruende(jetzt, vorher).filter((r) => r.startsWith('f4-ohne-enden'));

// ── (a) Zaehlung an der Klausel, nicht daneben ───────────────────────────────
check('(a) f4OhneEndenBlock zaehlt genau die Population der F-4-Klausel', () => {
  const rows = [
    zeile('MIT-ENDEN', WERTE, ENDEN),                       // datiert -> zaehlt NICHT
    zeile('OHNE-ENDEN', WERTE, null),                       // Werte, keine Enden -> zaehlt
    zeile('NULL-ENDEN', WERTE, [null, null, null]),         // Enden-Reihe ohne Datum -> zaehlt
    zeile('MISMATCH', WERTE, ['2026-06-30']),               // Laengen-Mismatch -> zaehlt
    zeile('EIN-ENDE', WERTE, ['2026-06-30', null, null]),   // ein Ende genuegt -> zaehlt NICHT
    zeile('KEINE-WERTE', [], null),                         // nichts zu datieren -> gar nicht dabei
    { ticker: 'KEIN-PIT', pit: null },                      // Snapshot fehlt -> gar nicht dabei
  ];
  const z = W.f4OhneEndenBlock(rows);
  assert.strictEqual(z.anzahl, 3, 'OHNE-ENDEN, NULL-ENDEN und MISMATCH sind die Population');
  assert.strictEqual(z.mitWertereihe, 5, 'Nenner sind die Zeilen MIT Werte-Reihe');

  // Die eigentliche Zusicherung: gezaehlt wird mit der importierten Klausel selbst.
  // Laeuft die Klausel je auseinander, muss diese Zeile mitgehen — nicht still weiterzaehlen.
  for (const r of rows) {
    if (!r.pit || !r.pit.revenueQ || !r.pit.revenueQ.length) continue;
    const s = { timeseries: { revenueQ: r.pit.revenueQ, revenueQEnds: r.pit.revenueQEnds } };
    const zaehltMit = W.f4OhneEndenBlock([r]).anzahl === 1;
    assert.strictEqual(zaehltMit, axes.ohneEndenReihe(s),
      r.ticker + ': Zaehlung und axes.js#ohneEndenReihe muessen dieselbe Antwort geben');
  }
});

// ── (b) die gueltige Form muss DURCHGEHEN ────────────────────────────────────
check('(b) Baseline-Population bleibt gruen (heutiger Stand: 3 Zeilen)', () => {
  assert.deepStrictEqual(f4Gruende(vintage('2026-08-16', 3), vintage('2026-08-15', 3)), []);
  assert.deepStrictEqual(f4Gruende(vintage('2026-08-16', F4_OHNE_ENDEN_MAX), vintage('2026-08-15', F4_OHNE_ENDEN_MAX)), [],
    'exakt auf der Decke ist noch gruen — die Decke ist eine Obergrenze, keine Sperre');
  assert.deepStrictEqual(f4Gruende(vintage('2026-08-16', 3), null), [],
    'ohne Vorgaenger darf der Sprung-Zweig nicht raten');
});

// ── (c) ueber der absoluten Decke: rot ───────────────────────────────────────
check('(c) schleichendes Wachstum ueber die absolute Decke wird rot', () => {
  // Vorgaenger knapp darunter -> der Faktor-Zweig greift NICHT, es ist wirklich die Decke.
  const r = f4Gruende(vintage('2026-08-16', F4_OHNE_ENDEN_MAX + 1), vintage('2026-08-15', F4_OHNE_ENDEN_MAX));
  assert.deepStrictEqual(r, ['f4-ohne-enden-population:' + (F4_OHNE_ENDEN_MAX + 1)]);
  assert.ok(W.evaluateGate(vintage('2026-08-16', 900), vintage('2026-08-15', 3), null, null, 'hg').suspect,
    'der benannte Schadensfall 3 -> 900 MUSS suspect sein');
});

// ── (d) Sprung UNTER der Decke: rot, und zwar am Faktor ──────────────────────
check('(d) Sprung unter der Decke wird rot (Faktor, nicht Decke)', () => {
  // Kleinstmoeglicher Stand, der den Boden erreicht und die Decke NICHT reisst (20 bei 20/50),
  // dazu ein Vorgaenger knapp unter jetzt/FAKTOR — dann kann nur der Faktor-Zweig feuern.
  const jetzt = F4_OHNE_ENDEN_SPRUNG_AB;
  const klein = Math.floor((jetzt - 1) / F4_OHNE_ENDEN_FAKTOR);
  assert.ok(jetzt <= F4_OHNE_ENDEN_MAX, 'Testaufbau: der Stand muss unter der absoluten Decke bleiben');
  const r = f4Gruende(vintage('2026-08-16', jetzt), vintage('2026-08-15', klein));
  assert.ok(r.some((x) => x.startsWith('f4-ohne-enden-sprung')),
    `Sprung ${klein} -> ${jetzt} muss den Faktor-Zweig ausloesen, bekam: ` + JSON.stringify(r));
  assert.ok(!r.some((x) => x.startsWith('f4-ohne-enden-population')),
    'bei diesem Stand darf NICHT die absolute Decke der Grund sein — sonst prueft der Test sie doppelt');

  // Gegenrichtung: EXAKT der Faktor ist noch kein Sprung (strikt groesser).
  assert.deepStrictEqual(
    f4Gruende(vintage('2026-08-16', jetzt), vintage('2026-08-15', jetzt / F4_OHNE_ENDEN_FAKTOR)),
    [], 'genau Faktor ' + F4_OHNE_ENDEN_FAKTOR + ' ist noch kein Sprung',
  );
  // Und der Boden haelt: kleine absolute Bewegungen schreien nicht.
  assert.deepStrictEqual(f4Gruende(vintage('2026-08-16', F4_OHNE_ENDEN_SPRUNG_AB - 1), vintage('2026-08-15', 0)), [],
    'unter dem Boden darf ein Vortag mit 0 kein Dauer-Alarm sein');
});

// ── (e) die Decken kommen aus den Konstanten ─────────────────────────────────
check('(e) Gate haengt an den Konstanten, nicht an abgeschriebenen Zahlen', () => {
  for (const [n, v] of Object.entries({ F4_OHNE_ENDEN_MAX, F4_OHNE_ENDEN_FAKTOR, F4_OHNE_ENDEN_SPRUNG_AB })) {
    assert.ok(Number.isFinite(v) && v > 0, n + ' muss exportiert und positiv sein');
  }
  // Der Sprung-Boden muss unter der absoluten Decke liegen, sonst ist der Faktor-Zweig
  // unerreichbar (die Decke haette immer vorher gefeuert) und (d) waere Theater.
  assert.ok(F4_OHNE_ENDEN_SPRUNG_AB < F4_OHNE_ENDEN_MAX,
    'Sprung-Boden ueber der Decke macht den Faktor-Zweig tot');
});

console.log(fail ? `\n${fail} FAILED` : '\nalle gruen');
process.exit(fail ? 1 : 0);

// tests/board-history-score-definitions-bruch.test.js — Standalone-Runner (framework-los).
// Run: node tests/board-history-score-definitions-bruch.test.js
//
// WOFUER: Der bestehende Massstabbruch-Zweig (tests/board-history-massstabbruch.test.js)
// deckt nur Brueche ab, bei denen die KOHORTE SCHRUMPFT — er verlangt woertlich
// nowMap.size < priorMap.size. Die Einmalertrag-Verdrahtung (Urteil 16.08.2026) verliert
// keine einzige Zeile, sie aendert nur Scores: 3.393 von 3.428 Zeilen bleiben
// byte-identisch, die 35 Zeilen mit der Lampe wandern zum Kohorten-Median (health-care
// p99-Delta 25,78 gegen den Boden 11,5 — SUSPECT im ersten Lauf mit neuem Code).
// Ohne Ausnahme waere das Vintage nicht committet worden, der Folgetag haette wieder
// gegen denselben alten Stand verglichen: dauerhaft rotes CI und stillstehende Messreihe,
// direkt nach der Ausfallwoche.
//
// DIE AUSNAHME HEBT KEINE SCHWELLE AN. Der Register-Eintrag benennt die LAMPE; genau die
// Zeilen, die sie vorher oder nachher tragen, bleiben aus dem p99 heraus. Ein Zuschlag
// waere hier gefaehrlich — er muesste 28-37 Punkte abdecken und liesse in derselben Nacht
// jeden echten Wertfehler mit durch.
//
// WAS HIER FESTGENAGELT WIRD, ist nicht die Ausnahme, sondern ihre GRENZEN:
//   1. ohne Register-Eintrag gilt die normale Schwelle,
//   2. ohne das Board NAMENTLICH im Eintrag gilt die normale Schwelle,
//   3. ohne benannte Lampe (Alt-Eintrag vom Schrumpfungs-Typ) gilt die normale Schwelle,
//   4. eine unerklaerte Bewegung in derselben Nacht faellt WEITERHIN auf — das ist der
//      Unterschied zwischen "erklaerte Zeilen herausrechnen" und "Freibrief",
//   5. herausgerechnet wird sichtbar (erklaerteZeilen), nicht still.
'use strict';
const assert = require('assert');
const W = require('../scripts/write-board-history.js');

let fail = 0;
function check(name, fn) {
  try { fn(); console.log('  ok   ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + ': ' + (e && e.message || e)); }
}

const BODEN = W._const.MIN_GATE_THRESHOLD;
const GATE_BODEN = { dailyP99Samples: [], sampleDates: [], threshold: BODEN, frozen: true };
const BOARD = 'health-care';
// Eintrag wie im Register: Board namentlich + erklaerende Lampe, KEINE Zahl.
const BRUCH = { tag: 'Tag 938', letztesAltesVintage: '2026-08-16', boards: new Set([BOARD]), erklaerendeLampe: 'einmalertrag' };
// Alt-Eintrag vom Schrumpfungs-Typ: dieselbe Form, aber ohne Lampe.
const BRUCH_OHNE_LAMPE = { ...BRUCH, erklaerendeLampe: null };

const ZEILEN = 143;                 // health-care-Kohorte am Messtag
const LAMPEN_ZEILEN = 18;           // gemessen: so viele tragen die Lampe
const BEWEGUNG = 3 * BODEN;         // deutlich ueber dem Boden — ohne Ausnahme sicher suspect

// Kohorte gleicher GROESSE vorher/nachher (genau der Fall, den der Schrumpfungs-Zweig
// nicht sieht). Die ersten `lampen` Zeilen bewegen sich um `bewegung` und tragen die
// Lampe; `stoerung` bewegt zusaetzlich eine Zeile OHNE Lampe.
function lage({ lampen = LAMPEN_ZEILEN, bewegung = BEWEGUNG, stoerung = 0, lampenName = 'einmalertrag' } = {}) {
  const vorher = [], nachher = [];
  for (let i = 0; i < ZEILEN; i++) {
    const istLampe = i < lampen;
    vorher.push({ ticker: 'T' + i, score: 50, lamps: [] });
    nachher.push({
      ticker: 'T' + i,
      score: 50 + (istLampe ? bewegung : (i === ZEILEN - 1 ? stoerung : 0)),
      lamps: istLampe ? [lampenName] : [],
    });
  }
  const v = (rows) => ({ date: null, pitCoverage: { beta: 1 }, cohort: { profitable: rows, unprofitable: [] } });
  return { vorher: v(vorher), nachher: v(nachher) };
}
const gate = (l, bruch, board) => W.evaluateGate(l.nachher, l.vorher, GATE_BODEN, bruch, board);

check('Vorbedingung: gleiche Zeilenzahl -> der Schrumpfungs-Zweig greift NICHT', () => {
  const l = lage();
  const g = gate(l, BRUCH, BOARD);
  assert.strictEqual(l.vorher.cohort.profitable.length, l.nachher.cohort.profitable.length, 'Fixture verliert Zeilen');
  assert.strictEqual(g.bruchGrenze, null, 'bruchGrenze darf hier nicht greifen (keine Schrumpfung)');
});

check('OHNE Ausnahme ist die Definitionsaenderung suspect (der zu verhindernde Zustand)', () => {
  const g = gate(lage(), null, BOARD);
  assert.ok(g.suspect, 'ohne Register-Eintrag muesste das Gate anschlagen');
  assert.ok(g.reasons.includes('p99-delta-exceeds-threshold'), 'Grund: ' + g.reasons.join(','));
});

check('MIT Ausnahme laeuft der registrierte Uebergang durch', () => {
  const g = gate(lage(), BRUCH, BOARD);
  assert.ok(!g.suspect, 'suspect trotz registriertem Bruch: ' + g.reasons.join(','));
  assert.strictEqual(g.erklaerteZeilen, LAMPEN_ZEILEN, 'erklaerte Zeilen falsch gezaehlt');
  assert.strictEqual(g.erklaerendeLampe, 'einmalertrag', 'Lampe muss im Ergebnis stehen (sichtbar, nicht still)');
  assert.strictEqual(g.p99Delta, 0, 'ohne die Lampen-Zeilen bewegt sich nichts -> p99 0');
});

check('GRENZE 1: anderes Board -> normale Schwelle, suspect', () => {
  const g = gate(lage(), BRUCH, 'materials');   // nicht in bruch.boards
  assert.ok(g.suspect, 'ein nicht registriertes Board darf die Ausnahme nicht erben');
  assert.strictEqual(g.erklaerteZeilen, 0);
});

check('GRENZE 2: Eintrag ohne erklaerende Lampe (Schrumpfungs-Typ) -> normale Schwelle, suspect', () => {
  const g = gate(lage(), BRUCH_OHNE_LAMPE, BOARD);
  assert.ok(g.suspect, 'ein Alt-Eintrag ohne Lampe darf nicht plötzlich Zeilen herausrechnen');
  assert.strictEqual(g.erklaerteZeilen, 0);
});

check('GRENZE 3: andere Lampe an den Zeilen -> nichts wird erklaert, suspect', () => {
  const g = gate(lage({ lampenName: 'peakMargin' }), BRUCH, BOARD);
  assert.ok(g.suspect, 'nur die REGISTRIERTE Lampe darf herausrechnen');
  assert.strictEqual(g.erklaerteZeilen, 0);
});

check('GRENZE 4: unerklaerte Bewegung in derselben Nacht faellt weiterhin auf', () => {
  // Alle 143 Zeilen ohne Lampe bewegen sich — das ist KEINE Folge der Verdrahtung.
  const l = lage({ lampen: 0, bewegung: 0 });
  for (const r of l.nachher.cohort.profitable) r.score = 50 + BEWEGUNG;
  const g = gate(l, BRUCH, BOARD);
  assert.ok(g.suspect, 'die Ausnahme darf keine unabhaengige Drift durchlassen');
  assert.strictEqual(g.erklaerteZeilen, 0);
});

check('GRENZE 5: Lampen-Zeilen erklaert, EINE fremde Zeile reisst trotzdem', () => {
  // Genau der Fall, den ein pauschaler Zuschlag verschluckt haette: 18 erklaerte Zeilen
  // PLUS ein echter Wertfehler auf einer nicht markierten Zeile.
  // p99 ueber 125 unerklaerte Zeilen erreicht den Ausreisser nicht -> ueber die halbe
  // Kohorte stoeren, damit das p99 ihn wirklich sieht.
  const l = lage();
  const rows = l.nachher.cohort.profitable;
  for (let i = LAMPEN_ZEILEN; i < ZEILEN; i++) rows[i].score = 50 + BEWEGUNG;
  const g = gate(l, BRUCH, BOARD);
  assert.strictEqual(g.erklaerteZeilen, LAMPEN_ZEILEN, 'die erklaerten Zeilen bleiben erklaert');
  assert.ok(g.suspect, 'ein Wertfehler neben dem Bruch muss weiterhin auffallen');
});

check('Register: der Eintrag ist gepflegt und traegt Lampe + Boards, aber KEINE Zahl', () => {
  const reg = require('../board-history/_excluded.json')._massstab_brueche;
  const e = reg.find((x) => x && x.typ === 'score-definitions-bruch');
  assert.ok(e, 'kein Eintrag vom Typ score-definitions-bruch im Register');
  assert.strictEqual(e.erklaerende_lampe, 'einmalertrag');
  assert.strictEqual(e.letztes_altes_vintage, '2026-08-16', 'Bindung an den exakten Vorgaenger');
  assert.ok(Array.isArray(e.boards) && e.boards.includes('health-care'), 'health-care fehlt (reisst als einziges den Boden)');
  // Keine Groessenangabe: die Hoehe darf nirgends aus dem Register kommen.
  for (const k of ['allowance', 'tagesschwelle', 'schwelle', 'grenze', 'hoehe']) {
    assert.ok(!(k in e), 'Register traegt eine Zahl (' + k + ') — die Hoehe muss gemessen werden');
  }
  // Und die Verdrahtung: massstabBruchFuer muss die Lampe wirklich durchreichen.
  const b = W.massstabBruchFuer('2026-08-16');
  assert.ok(b, 'massstabBruchFuer findet den Eintrag nicht');
  assert.strictEqual(b.erklaerendeLampe, 'einmalertrag', 'Lampe kommt nicht am Gate an');
  assert.ok(b.boards.has('health-care'));
});

// ── Tag 951: der Lautmacher an der Bindung ───────────────────────────────────
// Die Bindung ist fail-closed — und genau das war bis Tag 951 ihr Problem: ein Eintrag,
// der auf das falsche Vintage zeigt, lieferte STILL null. Gate suspect, Tagesverzeichnis
// weg, kein Wort im Protokoll. Festgenagelt werden beide Richtungen: dass die passende
// Bindung greift OHNE Fehlalarm, und dass die unpassende null bleibt und dabei laut wird.
function mitProtokoll(fn) {
  const zeilen = [];
  const orig = console.log;
  console.log = (...a) => zeilen.push(a.join(' '));
  try { return { wert: fn(), zeilen }; } finally { console.log = orig; }
}
const laute = (zeilen) => zeilen.filter((z) => z.includes('GATE-BINDUNG VERFEHLT'));
// Aus dem Register gelesen, nicht wiederholt: sonst prüft der Test seine eigene Kopie.
const GEBUNDEN = require('../board-history/_excluded.json')._massstab_brueche
  .find((x) => x && x.typ === 'score-definitions-bruch').letztes_altes_vintage;

check('BINDUNG PASST: Ausnahme greift, und das Protokoll bleibt still', () => {
  const r = mitProtokoll(() => W.massstabBruchFuer(GEBUNDEN));
  assert.ok(r.wert, 'die Ausnahme muss beim gebundenen Vorgaenger greifen');
  assert.strictEqual(r.wert.erklaerendeLampe, 'einmalertrag');
  assert.strictEqual(laute(r.zeilen).length, 0, 'Fehlalarm bei passender Bindung: ' + laute(r.zeilen).join(' | '));
});

check('BINDUNG VERFEHLT: null wie bisher UND die Warnung nennt beide Daten', () => {
  // Ein Tag VOR dem gebundenen Vintage — genau die Lage, die am Di 18.08. entstanden
  // waere, haette niemand die Bindung von 2026-08-18 auf 2026-08-16 nachgezogen.
  const tatsaechlich = '2026-08-15';
  const r = mitProtokoll(() => W.massstabBruchFuer(tatsaechlich));
  assert.strictEqual(r.wert, null, 'Verhalten muss unveraendert fail-closed bleiben (null)');
  const l = laute(r.zeilen);
  assert.strictEqual(l.length, 1, 'genau eine Warnung erwartet, bekam ' + l.length);
  assert.ok(l[0].startsWith('::warning::'), 'falscher Kanal — muss der ::warning::-Kanal des Tageslaufs sein');
  assert.ok(l[0].includes(GEBUNDEN), 'das gebundene Vintage ' + GEBUNDEN + ' fehlt im Warntext');
  assert.ok(l[0].includes(tatsaechlich), 'der tatsaechliche Vorgaenger ' + tatsaechlich + ' fehlt im Warntext');
  assert.ok(/Tag 938|score-definitions-bruch/.test(l[0]), 'der Eintrag wird nicht benannt');
  assert.ok(/greift.{0,20}NICHT/.test(l[0]), 'der Satz "Ausnahme greift NICHT" fehlt');
});

check('KEIN Dauerlaerm: verbrauchte Eintraege hinter der Vergleichsfront schweigen', () => {
  // Nach dem Uebergang liegt der Vorgaenger hinter JEDEM Eintrag. Ein Lautmacher, der
  // dann taeglich schreit, waere in Karls einzigem Alarmkanal schlechter als keiner.
  const r = mitProtokoll(() => W.massstabBruchFuer('2026-09-30'));
  assert.strictEqual(r.wert, null);
  assert.strictEqual(laute(r.zeilen).length, 0, 'verbrauchte Eintraege duerfen nicht dauerhaft warnen: ' + laute(r.zeilen).join(' | '));
});

console.log(fail ? `\nFAIL: ${fail}` : '\nOK: score-definitions-bruch');
process.exit(fail ? 1 : 0);

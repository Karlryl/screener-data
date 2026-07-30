'use strict';
/** tests/vintage-commit-text.test.js — Standalone-Runner (node tests/vintage-commit-text.test.js, Exit 0/1).
 *
 * Nagelt fest, dass Commit-Betreff und Erfolgsmeldung des Vintage-Commits SAGEN, WAS
 * WIRKLICH DRIN IST. Der Fehler (Lauf 30516194703, 2026-07-30): bei rc=2 nahm der
 * Schritt das Tagesverzeichnis korrekt per :(exclude) aus, schrieb aber trotzdem
 * "chore: board-history vintage 2026-07-30" und "✓ board-history vintage committed to
 * main". In `git log` sah der blockierte Tag aus wie ein gelandeter.
 *
 * WARUM NICHT PER GREP AUF daily-pull.yml: ein Waechter, der das Schreibmuster in der
 * Workflow-Datei prueft, prueft nur seine eigene Abschrift der Wahrheit (dieselbe Falle
 * wie test/lamp-legend.test.js, das eine Handkopie der Lampenliste prueft und deshalb
 * gruen blieb, waehrend zwei Lampen ohne Erklaerung ausgeliefert wurden). Hier wird das
 * VERHALTEN geprueft: welcher Text kommt bei welchem Rueckgabewert heraus.
 *
 * Jede Zusicherung ist EINZELN brechbar - siehe die Gegenprobe im Commit von Tag 512.
 */
const assert = require('node:assert/strict');
const t = require('../scripts/vintage-commit-text.js');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); }
}

const D = '2026-07-30';

// ── Die Entscheidung selbst ───────────────────────────────────────────────────
test('rc "2" heisst blockiert', () => {
  assert.equal(t.vintageBlockiert('2'), true);
});

test('rc "0" heisst nicht blockiert', () => {
  assert.equal(t.vintageBlockiert('0'), false);
});

test('rc mit Leerzeichen wird getrimmt ("2 " ist blockiert)', () => {
  // Workflow-Outputs koennen Whitespace tragen; ein ungetrimmter Vergleich haette
  // den Ausschluss-Fall als "committet" beschriftet.
  assert.equal(t.vintageBlockiert('2 '), true);
});

test('leeres rc gilt NICHT als blockiert - spiegelt [ "$VINTAGE_RC" = "2" ]', () => {
  // Bewusst: die Funktion muss dieselbe Entscheidung treffen wie die Shell-Bedingung,
  // die das Verzeichnis ausnimmt. Waere hier Number('') === 0 -> falsch verglichen,
  // liefen Text und Ausschluss auseinander.
  assert.equal(t.vintageBlockiert(''), false);
  assert.equal(t.vintageBlockiert('1'), false);
});

// ── Der Betreff darf bei rc=2 KEINEN gelandeten Vintage behaupten ─────────────
test('rc=2: Betreff nennt SUSPECT und NICHT committet', () => {
  const s = t.subject('2', D);
  assert.match(s, /SUSPECT/, 'muss SUSPECT nennen');
  assert.match(s, /NICHT committet/, 'muss sagen, dass es nicht committet wurde');
  assert.match(s, /Sidecars/, 'muss sagen, was stattdessen drin ist');
});

test('rc=2: Betreff sieht NICHT aus wie ein gelandetes Vintage', () => {
  // Die eigentliche Zusicherung: der alte Betreff lautete genau so.
  assert.notEqual(t.subject('2', D), `chore: board-history vintage ${D}`);
});

test('rc=0: Betreff nennt das Vintage als Inhalt', () => {
  assert.equal(t.subject('0', D), `chore: board-history vintage ${D}`);
});

// ── Die Erfolgsmeldung darf der Warnung nicht widersprechen ───────────────────
test('rc=2: Erfolgsmeldung sagt, dass das Vintage ausgeschlossen blieb', () => {
  const d = t.done('2', D);
  assert.match(d, /ausgeschlossen/, 'muss den Ausschluss benennen');
  assert.doesNotMatch(d, /vintage 2026-07-30 committet/, 'darf das Vintage nicht als committet melden');
});

test('rc=0: Erfolgsmeldung nennt das Vintage als committet', () => {
  assert.match(t.done('0', D), /vintage 2026-07-30 committet/);
});

// ── Das Datum kommt aus dem Argument, nicht von heute ─────────────────────────
test('Datum kommt aus dem Argument (Backfill/Mitternacht)', () => {
  // Der alte Code nahm $(date -u +%F). Bei --date-Backfill oder einem Lauf ueber
  // Mitternacht nannte der Commit ein anderes Datum als das geschriebene Vintage.
  const fremd = '2026-01-15';
  assert.match(t.subject('0', fremd), /2026-01-15/);
  assert.match(t.done('2', fremd), /2026-01-15/);
  assert.doesNotMatch(t.subject('0', fremd), /2026-07-30/);
});

console.log(`\nvintage-commit-text.test.js: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);

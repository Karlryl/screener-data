'use strict';
/** tests/vintage-commit-text.test.js — Standalone-Runner (node tests/vintage-commit-text.test.js, Exit 0/1).
 *
 * Nagelt fest, dass Commit-Betreff und Erfolgsmeldung des Vintage-Commits SAGEN, WAS
 * WIRKLICH DRIN IST. Tag 1396: rc=2 heisst seitdem "committet MIT strukturellem Kennzeichen". Der Fehler (Lauf 30516194703, 2026-07-30): bei rc=2 nahm der
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
// Tag 1396: rc=2 heisst "committet MIT strukturellem Kennzeichen" (das Tagesverzeichnis
// wird nicht mehr ausgenommen). Die Texte muessen genau das sagen.
test('rc "2" heisst strukturell geflaggt', () => {
  assert.equal(t.strukturGeflaggt('2'), true);
  assert.equal(t.vintageBlockiert, undefined, 'the old "blocked" export is gone');
});

test('rc "0" heisst nicht strukturell geflaggt', () => {
  assert.equal(t.strukturGeflaggt('0'), false);
});

test('rc mit Leerzeichen wird getrimmt ("2 " ist geflaggt)', () => {
  // Workflow-Outputs koennen Whitespace tragen; ein ungetrimmter Vergleich haette
  // den Flag-Fall als "ohne Flag" beschriftet.
  assert.equal(t.strukturGeflaggt('2 '), true);
});

test('leeres rc gilt NICHT als geflaggt - spiegelt [ "$VINTAGE_RC" = "2" ]', () => {
  // Bewusst: die Funktion muss dieselbe Entscheidung treffen wie die Shell-Bedingung
  // im Schritt "Value gate verdict". Waere hier Number('') === 0 -> falsch verglichen,
  // liefen Text und Urteil auseinander.
  assert.equal(t.strukturGeflaggt(''), false);
  assert.equal(t.strukturGeflaggt('1'), false);
});

// ── rc=2: der Betreff sagt "committet, mit Kennzeichen" ─────────────────────────
test('rc=2: Betreff nennt das Vintage UND das strukturelle Kennzeichen', () => {
  const s = t.subject('2', D);
  assert.equal(s, `chore: board-history vintage ${D} (strukturell geflaggt)`);
});

test('rc=2: Betreff behauptet keinen Ausschluss mehr (alte Texte weg)', () => {
  const s = t.subject('2', D);
  assert.doesNotMatch(s, /NICHT committet/);
  assert.doesNotMatch(s, /nur Sidecars/);
  assert.doesNotMatch(s, /ausgeschlossen/);
});

test('rc=0: Betreff nennt das Vintage als Inhalt', () => {
  assert.equal(t.subject('0', D), `chore: board-history vintage ${D}`);
  assert.doesNotMatch(t.subject('0', D), /geflaggt/);
});

// ── Die Erfolgsmeldung ────────────────────────────────────────────────────────
test('rc=2: Erfolgsmeldung sagt committet mit strukturellem Kennzeichen', () => {
  const d = t.done('2', D);
  assert.match(d, /vintage 2026-07-30 committet, mit strukturellem Kennzeichen/);
  assert.doesNotMatch(d, /ausgeschlossen|NICHT committet|nur Sidecars|Sidecars committet/);
});

test('rc=0: Erfolgsmeldung nennt das Vintage als committet', () => {
  assert.match(t.done('0', D), /vintage 2026-07-30 committet/);
  assert.doesNotMatch(t.done('0', D), /Kennzeichen/);
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

/**
 * Waechter zur Lineal-Gegenprobe (Rat 23.08., Weichen B1/B2).
 *
 * Festgenagelt wird eine SACHE, kein Textmuster: zwischen zwei eingecheckten Board-Vintages
 * muss eine Zeile, deren fundamentaler Eingang sich nicht um ein Byte geaendert hat, ihr
 * Achsen-Perzentil EXAKT reproduzieren, sobald man ihren Rohwert gegen das eingefrorene
 * Lineal des frueheren Tages perzentiliert - auf jeder Achse, deren Rohwert nicht selbst vom
 * Lineal des Tages beschnitten wird. Bricht das, hat sich etwas bewegt, das kein Artefakt
 * aufzeichnet: entweder ist das Scoring nicht mehr deterministisch, oder der Vintage-Schreiber
 * hat aufgehoert, den Eingang vollstaendig mitzuschreiben. Beides muss laut sein.
 *
 * Drei Aussagen, jede fuer sich rot-faehig:
 *   1. Exaktheit    - schranken-freie Achsen: 100,00 %, keine Schwelle, kein Spielraum.
 *   2. Nicht-leer   - die Messung darf nicht trivial bestehen: die beiden Lineale MUESSEN sich
 *                     unterscheiden, sonst prueft die Gegenprobe nichts (Skip ist nicht Pass).
 *   3. Positiv-Kontrolle - ein verbogenes Referenz-Lineal MUSS die Quote einbrechen lassen.
 *                     Ein Waechter, den nie jemand hat scheitern sehen, ist ein ungemessenes
 *                     Instrument.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { gegenprobe, OHNE_SCHRANKEN } = require('../scripts/lineal-gegenprobe.js');

const REPO = path.resolve(__dirname, '..');
// Zwei benachbarte Vintages mit unterschiedlichem Lineal. Fehlen sie, ist das ein Befund und
// kein Grund zum Ueberspringen - die Datei ist Teil des Messsubstrats.
const A = '2026-08-07', B = '2026-08-09';

const vorhanden = (d) => fs.existsSync(path.join(REPO, 'board-history', d, 'calibration.json'));

test('Mess-Substrat: beide Vintages liegen im Repo', () => {
  assert.ok(vorhanden(A), `board-history/${A}/calibration.json fehlt - Gegenprobe ohne Substrat`);
  assert.ok(vorhanden(B), `board-history/${B}/calibration.json fehlt - Gegenprobe ohne Substrat`);
});

test('die beiden Lineale unterscheiden sich (sonst prueft die Gegenprobe nichts)', () => {
  const lade = (d) => JSON.parse(fs.readFileSync(path.join(REPO, 'board-history', d, 'calibration.json'), 'utf8'));
  const ca = lade(A), cb = lade(B);
  const bewegt = ['winsorBounds', 'growthBounds', 'mcapBounds']
    .filter((k) => JSON.stringify(ca[k]) !== JSON.stringify(cb[k]));
  assert.ok(bewegt.length > 0,
    `Die Lineale von ${A} und ${B} sind identisch - die Gegenprobe waere ein Selbstgespraech.`);
});

test('unveraenderter Eingang reproduziert sein Perzentil exakt unter dem eingefrorenen Lineal', () => {
  const r = gegenprobe(REPO, A, B);
  assert.ok(r.zeilen > 1000, `zu wenig vergleichbare Zeilen (${r.zeilen}) - Messung nicht aussagekraeftig`);
  assert.ok(r.ohneSchranken.n > 1000, `zu wenig schranken-freie Achsen (${r.ohneSchranken.n})`);
  assert.equal(r.ohneSchranken.ok, r.ohneSchranken.n,
    `${r.ohneSchranken.n - r.ohneSchranken.ok} von ${r.ohneSchranken.n} schranken-freien Perzentilen `
    + 'lassen sich NICHT aus dem eingefrorenen Lineal rekonstruieren. Entweder ist das Scoring nicht '
    + 'mehr deterministisch, oder der Vintage-Schreiber zeichnet den Eingang nicht mehr vollstaendig auf.');
  // Jede schranken-freie Achse einzeln - eine Achse, die still auf 0 Faelle faellt, waere sonst
  // von den anderen gedeckt.
  for (const k of OHNE_SCHRANKEN) {
    const a = r.proAchse[k];
    assert.ok(a && a.n > 0, `Achse ${k} liefert keine vergleichbaren Faelle mehr`);
    assert.equal(a.ok, a.n, `Achse ${k}: nur ${a.ok}/${a.n} rekonstruierbar`);
  }
});

test('Positiv-Kontrolle: verbogenes Referenz-Lineal laesst die Quote einbrechen', () => {
  // Referenz-Basis um 5 % gestreckt und verschoben -> dieselben Rohwerte muessen jetzt fast
  // ueberall ein anderes Perzentil bekommen. Bleibt die Quote hoch, misst die Gegenprobe nicht
  // das Lineal, sondern sich selbst.
  const r = gegenprobe(REPO, A, B, { refBasisFilter: (v) => (Number.isFinite(v) ? v * 1.05 + 0.01 : v) });
  const quote = r.ohneSchranken.n ? r.ohneSchranken.ok / r.ohneSchranken.n : 1;
  assert.ok(quote < 0.10,
    `Positiv-Kontrolle versagt: mit verbogenem Lineal liegen immer noch ${(100 * quote).toFixed(1)} % `
    + 'der Perzentile richtig. Die Gegenprobe haengt dann nicht am Lineal.');
});

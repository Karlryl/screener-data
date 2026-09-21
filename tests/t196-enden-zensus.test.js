'use strict';
/**
 * Waechter fuer den T196-Zensus (scripts/t196-enden-zensus.js).
 *
 * DIE SACHE: der Bericht reports/t196-revenueqends-registerfrage-2026-09-19.md stuetzt seine
 * Empfehlung auf zwei NULLEN — keine Laengen-Abweichung, kein unmoegliches Datum. Eine Null
 * ist nur dann ein Befund, wenn der Zaehler ueberhaupt zaehlen KANN. Geprueft wird deshalb
 * beides: die Datums-Probe muss die kaputten Faelle fangen (nicht nur die guten durchlassen),
 * und der Zensus muss auf dem echten Bestand in sich stimmen.
 *
 * Usage: node tests/t196-enden-zensus.test.js   (Exit 0/1)
 */
const assert = require('node:assert/strict');
const { zensus, datumBrauchbar } = require('../scripts/t196-enden-zensus.js');
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); }
}

check('echte Perioden-Enden gelten als brauchbar', () => {
  for (const d of ['2026-06-30', '2025-12-31', '2024-02-29']) {
    assert.equal(datumBrauchbar(d), true, d + ' ist ein echtes Datum');
  }
});

check('ROUND-TRIP: kalendarisch unmoegliche Tage fallen durch (Date.parse rollt sie still weiter)', () => {
  // 2025-02-30 -> 2. Maerz, 2025-11-31 -> 1. Dezember. Zwei Tage Versatz kippen bei einer
  // Toleranz von 15 Tagen eine Jahresvergleichs-Entscheidung.
  for (const d of ['2025-02-30', '2025-11-31', '2025-13-01', '2025-00-10']) {
    assert.equal(datumBrauchbar(d), false, d + ' darf nicht als Datum durchgehen');
  }
});

check('Nicht-Strings und Muell fallen durch', () => {
  for (const d of [null, undefined, 20260630, '', 'Q2/2026', '2026-6-30']) {
    assert.equal(datumBrauchbar(d), false, String(d) + ' ist kein ISO-Tag');
  }
});

check('der Zensus laeuft auf dem juengsten echten Bestand und ist in sich stimmig', () => {
  const base = path.join(__dirname, '..', 'board-history');
  const tage = fs.readdirSync(base).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  assert.ok(tage.length > 0, 'board-history traegt keinen datierten Stand');
  const z = zensus(tage[tage.length - 1]);
  assert.ok(z.pitZeilen > 0, 'kein einziger PIT-Block gelesen — der Zaehler zaehlt nicht');
  assert.ok(z.mitEnds > 0, 'kein einziger revenueQEnds gefunden — die Nullen waeren wertlos');
  assert.ok(z.mitEnds <= z.pitZeilen, 'mehr Enden-Zeilen als PIT-Zeilen ist unmoeglich');
  assert.equal(z.vierBrauchbar + z.wenigerAlsVier, z.mitEnds,
    'jede Zeile mit Enden faellt in genau einen der beiden Eimer');
  assert.ok(z.laengeUngleichRevenueQ <= z.mitEnds, 'Teilmenge, nicht mehr');
  assert.ok(Number.isInteger(z.formatFehler), 'der Formfehler-Zaehler (Duell-Einwand E1) fehlt');
  assert.equal(z.pitZeilen + z.zeilenOhnePit, z.zeilenGesamt,
    'der Nenner muss ausgewiesen sein: jede Board-Zeile hat einen PIT-Block oder keinen');
});

check('FORMFEHLER: ein nicht-ISO-Eintrag wird gezaehlt und nicht als Datum verbucht', () => {
  // Der dritte Unterschied zwischen Rohzugriff und periodEnds() (Bericht §5): ein String wie
  // "garbage" ist truthy, passiert die Lampen-Bedingung und stirbt erst an Date.parse —
  // periodEnds() nullt ihn dagegen sofort. Wer ihn nicht zaehlt, meldet eine falsche Null.
  assert.equal(datumBrauchbar('garbage'), false, 'kein ISO-Praefix, kein Datum');
  assert.equal(datumBrauchbar('2026-06'), false, 'Monatsangabe ist kein Perioden-Ende');
});

console.log('\nt196-enden-zensus: ' + pass + ' ok, ' + fail + ' fail');
process.exit(fail ? 1 : 0);

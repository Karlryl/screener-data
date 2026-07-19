'use strict';
/**
 * bh-w2-fxfollow — Test-Gate fuer BH-041 (Batch w2-fxfollow: discovery/mcap-prefilter.js,
 * refresh-universe.js).
 * ============================================================================
 * BH-041: "answered" (Yahoo hat eine Quote geliefert) wurde mit "bewertbar" verwechselt.
 * Fehlt in einer sonst validen fx-rates.json nur EINE Waehrung, lieferte toUsd() fuer
 * genau diese Zeilen still null -> der Caller loeschte sie faelschlich wie "geprueft und
 * < $2B", obwohl sie nie bepreist werden konnten. Ein einzelner FX-Artefaktfehler konnte so
 * ganze Laender aus der Watchlist wischen.
 *
 * Standalone-Runner, keine Frameworks, kein Netz.
 * Usage:  node tests/scoring/bh-w2-fxfollow.test.js   (Exit 0/1)
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { toUsd, isUnpriceable } = require('../../discovery/mcap-prefilter.js');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); }
}

// --- Kernszenario aus dem Finding: fx-rates.json ist ansonsten valide, nur EINE
// Waehrung (hier EUR) fehlt. Ein deutscher Titel mit echtem, positivem marketCap
// muss als "unbewertbar" markiert werden, NICHT als "geprueft und < Schwelle".
test('BH-041: fehlende einzelne Waehrung in sonst valider fx-rates.json -> unpriceable', () => {
  const rates = { USD: 1, JPY: 0.0067, KRW: 0.00073 }; // EUR fehlt
  assert.equal(toUsd(3e9, 'EUR', rates), null, 'toUsd liefert null (kann nicht umrechnen)');
  assert.equal(isUnpriceable(3e9, 'EUR', rates), true, 'muss als FX-Luecke markiert werden, nicht als unter Schwelle');
});

// --- Gegenprobe: bekannte Waehrung, echtes marketCap unter der Schwelle -> das ist
// ein legitimer "geprueft und zu klein"-Fall und darf NICHT als unpriceable gelten
// (sonst wuerde der Cap-Filter wirkungslos, siehe BH-040-Nachbarschaft).
test('BH-041: bekannte Waehrung + marketCap vorhanden -> NICHT unpriceable (legitimer Unter-Schwelle-Fall)', () => {
  const rates = { USD: 1, EUR: 0.92 };
  const usd = toUsd(1e9, 'EUR', rates); // < $2B Schwelle
  assert.ok(Number.isFinite(usd) && usd < 2e9);
  assert.equal(isUnpriceable(1e9, 'EUR', rates), false);
});

// --- Echt fehlendes/nulles marketCap ist KEIN FX-Problem -> nicht als "unpriceable"
// im BH-041-Sinn markieren (sonst wuerde jede Yahoo-Antwort ohne Cap-Feld faelschlich
// als FX-Luecke statt als "keine Daten" durchgehen).
test('BH-041: fehlendes/null/negatives marketCap -> NICHT unpriceable (kein FX-Fall)', () => {
  const rates = { USD: 1 }; // EUR fehlt zwar auch, aber kein marketCap vorhanden
  assert.equal(isUnpriceable(null, 'EUR', rates), false);
  assert.equal(isUnpriceable(undefined, 'EUR', rates), false);
  assert.equal(isUnpriceable(0, 'EUR', rates), false);
  assert.equal(isUnpriceable(-5, 'EUR', rates), false);
});

test('BH-041: fehlende Waehrungsangabe -> NICHT unpriceable', () => {
  assert.equal(isUnpriceable(3e9, null, { USD: 1 }), false);
  assert.equal(isUnpriceable(3e9, undefined, { USD: 1 }), false);
});

// --- Subunit-Waehrungen (GBp/GBX/ZAc/ILA) muessen VOR dem Rate-Lookup auf die
// Basiswaehrung gemappt werden (Konsistenz mit toUsd) — sonst wuerde ein Pence-Titel
// mit vorhandener GBP-Rate faelschlich als unpriceable durchgehen.
test('BH-041: Subunit-Waehrung (GBp) mit vorhandener Basis-Rate (GBP) -> NICHT unpriceable', () => {
  const rates = { USD: 1, GBP: 1.27 };
  assert.equal(isUnpriceable(500000, 'GBp', rates), false);
  assert.ok(Number.isFinite(toUsd(500000, 'GBp', rates)));
});
test('BH-041: Subunit-Waehrung (GBp), aber Basiswaehrung (GBP) fehlt in rates -> unpriceable', () => {
  const rates = { USD: 1 }; // GBP fehlt
  assert.equal(isUnpriceable(500000, 'GBp', rates), true);
  assert.equal(toUsd(500000, 'GBp', rates), null);
});

// --- Totalausfall-Regression (der urspruengliche BH-041-Trigger): faellt fx-rates.json
// komplett auf {USD:1} zurueck, muss JEDE Nicht-USD-Zeile als unpriceable gelten statt
// geloescht zu werden -> genau das verhindert das "ganze Laender verschwinden"-Symptom.
test('BH-041: Totalausfall-Fallback {USD:1} markiert jede Fremdwaehrung als unpriceable (kein Massenloeschen)', () => {
  const fallbackRates = { USD: 1 };
  for (const [cur, mcap] of [['EUR', 3e9], ['JPY', 500e9], ['KRW', 800e9]]) {
    assert.equal(toUsd(mcap, cur, fallbackRates), null);
    assert.equal(isUnpriceable(mcap, cur, fallbackRates), true, `${cur} muss bei {USD:1}-Fallback unpriceable sein`);
  }
});

// --- Wiring-Regression: refresh-universe.js darf eine 'answered'-Zeile nur loeschen,
// wenn sie NICHT in 'unpriceable' steht. Reiner Quelltext-Pin gegen ein versehentliches
// Zurueckrollen auf die alte "answered => delete"-Bedingung (kein Netz noetig).
test('BH-041 Wiring: refresh-universe.js prueft unpriceable, bevor eine answered-Zeile geloescht wird', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'refresh-universe.js'), 'utf8');
  assert.match(src, /const \{ kept: keptUsd, answered, renamed, unpriceable \} = await prefilterByMcap/,
    'prefilterByMcap-Aufruf muss unpriceable destructuren');
  assert.match(src, /answered\.has\(eff\)\s*&&\s*!\(unpriceable\s*&&\s*unpriceable\.has\(eff\)\)/,
    'Loesch-Bedingung muss unpriceable ausschliessen, nicht nur answered pruefen');
});

console.log(`\nbh-w2-fxfollow.test.js: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);

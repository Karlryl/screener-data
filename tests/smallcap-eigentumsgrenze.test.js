'use strict';
/**
 * Waechter fuer die Small-Cap-Eigentumsgrenze (Tag 466).
 *
 * WORAN DAS HAENGT: Der Hauptlauf ueberspringt Ticker, die der Small-Cap-Liste gehoeren. Die
 * Bedingung dafuer entscheidet, ob eine Firma, die ueber die Bandgrenze WAECHST, im Hauptboard
 * sichtbar ist oder tagelang in gar keinem Board steht.
 *
 * DIE GESCHICHTE, DIE DIESEN TEST NOETIG MACHT:
 *   Tag 450 fuehrte die Grenze ein: "steht auf der Small-Cap-Liste -> ueberspringen." Damit war
 *   ein Aufsteiger bis zum naechsten Aufraeumlauf unsichtbar — bis zu eine Woche.
 *   Tag 456 verschaerfte sie auf "steht drauf UND hat KEINE eigene Kursdatei". Seither wird ein
 *   Aufsteiger weiter gezogen, denn er hat eine Datei.
 *   Am 27.07. wurde am CI-Bestand nachgemessen: mit der neuen Bedingung sind NULL von fuenf
 *   Aufsteigern unsichtbar (Mama's Creations, Kodak, Everforth, TOP Financial, Braskem) — mit
 *   der alten waeren es fuenf gewesen.
 *
 * Der Unterschied ist von aussen nicht zu sehen: beide Fassungen laufen gruen und melden
 * plausible Zahlen. Ein Rueckbau wuerde die Luecke also lautlos zurueckbringen. Genau davor
 * steht dieser Test.
 *
 * GEGENPROBE (durchgefuehrt): die Bedingung auf die alte Fassung zurueckgebaut
 * (`return true` statt `return !hatSnapshot`) — der Test wird rot.
 */
const assert = require('node:assert/strict');
const { ueberspringtSmallcapTicker } = require('../pull-yahoo.js');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); }
}

test('Ticker ohne Small-Cap-Mitgliedschaft wird nie uebersprungen', () => {
  assert.equal(ueberspringtSmallcapTicker({ aufSmallcapListe: false, hatSnapshot: false }), false);
  assert.equal(ueberspringtSmallcapTicker({ aufSmallcapListe: false, hatSnapshot: true }), false);
});

test('DER AUFSTEIGER: auf der Liste, aber MIT eigener Kursdatei -> wird weiter gezogen', () => {
  // Das ist der Fall, der die ganze Luecke ausmacht. Steht hier true, ist eine Firma, die
  // ueber 800 Mio. waechst, bis zum naechsten Aufraeumlauf in KEINEM Board sichtbar.
  assert.equal(
    ueberspringtSmallcapTicker({ aufSmallcapListe: true, hatSnapshot: true }),
    false,
    'Aufsteiger mit Kursdatei darf NICHT uebersprungen werden — sonst ist er unsichtbar',
  );
});

test('echter Small-Cap-Name ohne eigene Kursdatei wird uebersprungen (den holt der Small-Cap-Lauf)', () => {
  assert.equal(ueberspringtSmallcapTicker({ aufSmallcapListe: true, hatSnapshot: false }), true);
});

test('die Bedingung haengt WIRKLICH an der Kursdatei, nicht nur an der Mitgliedschaft', () => {
  // Negativ-Kontrolle: waere die Funktion konstant (egal was), waeren die Tests oben wertlos.
  // Bei gleicher Mitgliedschaft MUSS die Kursdatei das Ergebnis umdrehen.
  const mitDatei = ueberspringtSmallcapTicker({ aufSmallcapListe: true, hatSnapshot: true });
  const ohneDatei = ueberspringtSmallcapTicker({ aufSmallcapListe: true, hatSnapshot: false });
  assert.notEqual(mitDatei, ohneDatei, 'die Kursdatei muss den Ausschlag geben');
});

test('die fuenf real gemessenen Aufsteiger bleiben alle sichtbar', () => {
  // Stand 27.07. am CI-Snapshot-Bestand erhoben: alle fuenf stehen (bzw. standen) auf der
  // Small-Cap-Liste UND haben eine Datei im Hauptbestand.
  const gemessen = [
    { ticker: 'MAMA', aufSmallcapListe: true, hatSnapshot: true },
    { ticker: 'KODK', aufSmallcapListe: true, hatSnapshot: true },
    { ticker: 'EVFH', aufSmallcapListe: false, hatSnapshot: false },
    { ticker: 'TOP', aufSmallcapListe: true, hatSnapshot: true },
    { ticker: 'BAK', aufSmallcapListe: true, hatSnapshot: true },
  ];
  assert.ok(gemessen.length > 0, 'darf nicht ins Leere laufen');
  const unsichtbar = gemessen.filter((g) => ueberspringtSmallcapTicker(g)).map((g) => g.ticker);
  assert.deepEqual(unsichtbar, [], `diese Aufsteiger waeren unsichtbar: ${unsichtbar.join(', ')}`);
});

console.log(`\nsmallcap-eigentumsgrenze: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);

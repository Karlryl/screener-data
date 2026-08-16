// tests/gqs00-uebergang-fixtures-wachposten.test.js — Standalone-Runner.
//
// Wachposten fuer den Golden-Fixture-Zweig des 1.1.0-Uebergangsfensters.
// =====================================================================
// Das Fenster war fuer QUELLDATEIEN gebaut (dort gilt: Siegel-Hash ODER pending-Hash,
// zwei erlaubte Varianten). M-A brauchte dasselbe fuer ERWARTUNGEN — und da darf es
// gerade KEINE zwei Wege geben, sonst waere jede spaetere Score-Bewegung durch das Loch
// gerutscht. Geprueft wird pendingTraceErwartung() direkt, mit synthetischen Traces:
// protocol/gqs-00/1.0.0/ wird dabei nicht angefasst.
//
// (1) genau EINE Erwartung je Fall: gelistet -> pending, sonst -> Siegel
// (2) ein NICHT gelisteter Fall, den das Artefakt bewegt, ist rot
// (3) ein gelisteter Fall, der sich GAR NICHT bewegt, ist rot (Genehmigung fuer nichts)
// (4) ein vertippter Ticker ist rot
// (5) die dokumentierte Zielzahl IST die Genehmigung — falsche Zahl ist rot, fehlende auch
// (6) leere/fehlende Liste -> gar keine Lockerung (fail-closed)
//
// Run: node tests/gqs00-uebergang-fixtures-wachposten.test.js
'use strict';
const assert = require('node:assert/strict');
const { pendingTraceErwartung } = require('../scripts/gqs00-freeze.js');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + (e && e.message ? e.message : e)); }
}
// Der Zweig liest nur .ticker und .score.unroundedFinal — mehr braucht der Wachposten nicht.
const trace = (ticker, wert) => ({ ticker, score: { unroundedFinal: wert } });
const SIEGEL = [trace('AAA', 10.5), trace('BBB', 20.25), trace('CCC', 30)];
const doc = (faelle) => ({ status: 'pending', goldenFixtureImpact: { geaenderteFaelle: faelle } });
// pendingTraceErwartung liest das Artefakt von der Platte. Fuer den Wachposten wird es
// stattdessen ueber die echte Datei gefahren — deshalb wird hier NUR der Fall geprueft,
// der ohne Artefakt auskommt, plus die Faelle ueber eine eingeschleuste Datei.
const fs = require('node:fs');
const path = require('node:path');
const ARTEFAKT = path.join(__dirname, '..', 'protocol', 'gqs-00', '1.1.0-pending', 'score-traces.json');
const ECHT = fs.readFileSync(ARTEFAKT);
function mitArtefakt(traces, fn) {
  fs.writeFileSync(ARTEFAKT, JSON.stringify({ traces }, null, 2) + '\n');
  try { return fn(); } finally { fs.writeFileSync(ARTEFAKT, ECHT); }
}
const rot = (traces, faelle, teil) => mitArtefakt(traces, () => {
  assert.throws(() => pendingTraceErwartung(doc(faelle), SIEGEL), (e) => {
    assert.match(String(e.message), teil, 'falscher Grund: ' + e.message);
    return true;
  });
});

// ── (6) fail-closed zuerst: ohne Liste gibt es keine Lockerung ───────────────
test('(6) leere/fehlende Liste -> null, also gilt allein das Siegel', () => {
  assert.equal(pendingTraceErwartung(doc([]), SIEGEL), null);
  assert.equal(pendingTraceErwartung({ status: 'pending' }, SIEGEL), null);
  assert.equal(pendingTraceErwartung(null, SIEGEL), null);
});

// ── (1) die gueltige Form muss DURCHGEHEN ────────────────────────────────────
test('(1) gueltiger Uebergang: gelisteter Fall -> pending, Rest -> Siegel', () => {
  const pending = [trace('AAA', 10.5), trace('BBB', 99.125), trace('CCC', 30)];
  const r = mitArtefakt(pending, () => pendingTraceErwartung(
    doc([{ ticker: 'BBB', unroundedFinalAlt: 20.25, unroundedFinalNeu: 99.125 }]), SIEGEL,
  ));
  assert.deepEqual(r.traces, pending, 'die Erwartung ist das pending-Artefakt');
  assert.deepEqual([...r.namen], ['BBB'], 'nur der gelistete Fall ist freigegeben');
  // Und das ist die Ein-Erwartungs-Zusicherung: der ALTE Siegel-Wert von BBB ist kein
  // gueltiger Ausgang mehr — er steht nirgends mehr in der Soll-Liste.
  assert.notEqual(r.traces[1].score.unroundedFinal, SIEGEL[1].score.unroundedFinal);
});

// ── (2)–(5) die Brueche ──────────────────────────────────────────────────────
test('(2) Artefakt bewegt einen NICHT gelisteten Fall -> rot', () => {
  rot([trace('AAA', 11.5), trace('BBB', 99.125), trace('CCC', 30)],
    [{ ticker: 'BBB', unroundedFinalAlt: 20.25, unroundedFinalNeu: 99.125 }],
    /bewegt den NICHT gelisteten Fall AAA/);
});

test('(3) gelisteter Fall bewegt sich gar nicht -> rot (Genehmigung fuer nichts)', () => {
  rot([trace('AAA', 10.5), trace('BBB', 20.25), trace('CCC', 30)],
    [{ ticker: 'BBB', unroundedFinalAlt: 20.25, unroundedFinalNeu: 20.25 }],
    /listet BBB als geaendert, das pending-Artefakt aendert dort aber nichts/);
});

test('(4) vertippter Ticker -> rot', () => {
  rot([trace('AAA', 10.5), trace('BBB', 99.125), trace('CCC', 30)],
    [{ ticker: 'BBB', unroundedFinalAlt: 20.25, unroundedFinalNeu: 99.125 }, { ticker: 'BBBB' }],
    /listet einen Ticker, den es unter den Golden-Fixtures nicht gibt: BBBB/);
});

test('(5a) falsche Zielzahl in der Liste -> rot', () => {
  rot([trace('AAA', 10.5), trace('BBB', 99.125), trace('CCC', 30)],
    [{ ticker: 'BBB', unroundedFinalAlt: 20.25, unroundedFinalNeu: 42 }],
    /behauptet fuer BBB unroundedFinalNeu=42/);
});

test('(5b) falscher AUSGANGS-Wert in der Liste -> rot', () => {
  rot([trace('AAA', 10.5), trace('BBB', 99.125), trace('CCC', 30)],
    [{ ticker: 'BBB', unroundedFinalAlt: 1, unroundedFinalNeu: 99.125 }],
    /behauptet fuer BBB unroundedFinalAlt=1/);
});

test('(5c) Bewegung ganz ohne genannte Zielzahl -> rot', () => {
  rot([trace('AAA', 10.5), trace('BBB', 99.125), trace('CCC', 30)],
    [{ ticker: 'BBB' }],
    /ohne unroundedFinalAlt/);
});

test('(x) Artefakt anders sortiert als das Siegel -> rot', () => {
  rot([trace('BBB', 99.125), trace('AAA', 10.5), trace('CCC', 30)],
    [{ ticker: 'BBB', unroundedFinalAlt: 20.25, unroundedFinalNeu: 99.125 }],
    /anders sortiert als das Siegel/);
});

// Die echte Datei muss unveraendert zurueckliegen — sonst hinterlaesst der Test genau den
// Schaden, gegen den er wacht.
test('(z) das echte pending-Artefakt liegt byte-identisch zurueck', () => {
  assert.ok(fs.readFileSync(ARTEFAKT).equals(ECHT), 'Wachposten hat das Artefakt veraendert');
});

console.log(fail ? `\n${fail} FAILED` : `\nalle gruen (${pass})`);
process.exit(fail ? 1 : 0);

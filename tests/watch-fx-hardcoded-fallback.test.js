'use strict';
/**
 * Waechter: wurde in diesem Lauf ueberhaupt mit HARTKODIERTEN FX-Kursen gerechnet?
 *
 * DIE LUECKE (Grenzen-Audit C-3, reproduziert):
 *   pull-yahoo.js FX_STALE_DAYS = 14 — ist fx-rates.json aelter, wird die Datei KOMPLETT
 *   verworfen und die 2024er Hartkodierung rechnet weiter (INR liegt damit bis 14,5 %
 *   daneben, und zwar still: der Snapshot traegt fxConverted:true).
 *   .github/workflows/daily-pull.yml wird aber erst bei > 30 Tagen hart rot, ab > 7 nur
 *   eine Warnung. Zwischen Tag 15 und Tag 30 liegen 16 Tage, in denen JEDER Nicht-USD-Titel
 *   falsch bewertet wird und NICHTS rot wird. Genau dieses Fenster schliesst der Waechter
 *   hier — aber nicht, indem er noch eine dritte Alters-Zahl einfuehrt.
 *
 * WARUM AN DER WIRKUNG UND NICHT AM DATEIALTER: das Dateialter ist nur EINER von mehreren
 * Wegen in die Hartkodierung. Fehlt fx-rates.json ganz, warnt die CI ebenfalls bloss; und
 * eine Waehrung, die im frischen Feed fehlt, faellt auch bei tagesfrischer Datei auf die
 * 2024er Zahl zurueck (pull-yahoo.js FX_PROVENANCE). Ein Alters-Schwellwert kann keinen
 * dieser Faelle sehen. meta.fxRateSource === 'hardcoded-fallback' sieht sie alle: der
 * Marker steht genau dann im Snapshot, wenn wirklich mit einem hartkodierten Kurs
 * umgerechnet wurde. Kein Scoring-Wert, reiner Betriebs-Waechter.
 *
 * FALSCH-ROT-RISIKO ausgezaehlt statt geschaetzt: im lokalen Bestand (4.768 Snapshots,
 * davon 2.967 wirklich umgerechnet) traegt KEIN EINZIGER den Marker. Ein Auftreten ist
 * damit ein Ereignis, keine Grundlast.
 *
 * Usage:  node tests/watch-fx-hardcoded-fallback.test.js   (Exit 0/1)
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { countHardcodedFallback, befunde, exitCodeFor } = require('../scripts/watch-fx-sanity.js');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); }
}

// Wegwerf-Korpus im Temp-Verzeichnis — der echte snapshots/-Ordner wird nie angefasst.
function korpus(snaps) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fxfallback-'));
  snaps.forEach((s, i) => fs.writeFileSync(path.join(dir, 'T' + i + '.json'), JSON.stringify(s)));
  return dir;
}
const live = (ccy) => ({ meta: { ticker: 'L' + ccy, fxConverted: true, reportingCurrencyOriginal: ccy, fxRateSource: 'fx-rates.json @ 2026-08-02T14:50:41.233Z' }, marketCap: { value: 5e9 } });
const usd = () => ({ meta: { ticker: 'USDT', fxConverted: true, reportingCurrencyOriginal: 'USD' }, marketCap: { value: 5e9 } });
const hart = (ccy) => ({ meta: { ticker: 'H' + ccy, fxConverted: true, reportingCurrencyOriginal: ccy, fxRateSource: 'hardcoded-fallback' }, marketCap: { value: 5e9 } });

test('sauberer Lauf: kein Snapshot mit hartkodiertem Kurs -> 0', () => {
  const d = korpus([live('EUR'), live('JPY'), usd(), usd()]);
  const r = countHardcodedFallback(d);
  assert.equal(r.n, 0);
  assert.deepEqual(r.jeWaehrung, {});
});

test('ein einziger hartkodiert umgerechneter Snapshot wird gezaehlt — mit Waehrung', () => {
  const d = korpus([live('EUR'), hart('INR'), usd()]);
  const r = countHardcodedFallback(d);
  assert.equal(r.n, 1, 'genau ein Treffer');
  assert.deepEqual(r.jeWaehrung, { INR: 1 });
});

test('der Ausfall der ganzen FX-Datei (Tag 15..30) trifft ganze Waehrungs-Kohorten', () => {
  // So sieht ein Lauf aus, in dem fx-rates.json 20 Tage alt ist: pull-yahoo verwirft sie
  // komplett, jeder Nicht-USD-Titel bekommt den Marker. Die CI sagt dazu heute nur "warning".
  const d = korpus([hart('EUR'), hart('EUR'), hart('INR'), hart('JPY'), usd(), usd(), usd()]);
  const r = countHardcodedFallback(d);
  assert.equal(r.n, 4);
  assert.deepEqual(r.jeWaehrung, { EUR: 2, INR: 1, JPY: 1 });
});

test('unlesbare/leere Dateien zaehlen nicht mit und werfen nicht', () => {
  const d = korpus([hart('INR')]);
  fs.writeFileSync(path.join(d, 'kaputt.json'), '{ das ist kein JSON');
  fs.writeFileSync(path.join(d, '_intern.json'), JSON.stringify(hart('EUR')));  // '_'-Praefix = intern
  const r = countHardcodedFallback(d);
  assert.equal(r.n, 1, 'nur der echte Treffer');
});

test('fehlendes Verzeichnis -> 0 statt Absturz (Waechter darf den Lauf nicht sprengen)', () => {
  const r = countHardcodedFallback(path.join(os.tmpdir(), 'gibt-es-nicht-' + Date.now()));
  assert.equal(r.n, 0);
});

// ── die Verdrahtung: der Befund muss im Alarm-Kanal ankommen ────────────────────────────
const keinSprung = { usOver: 100, foreignOver: 50 };
const basislinie = { last: { usOver: 100, foreignOver: 50 }, prev: null, date: '2026-08-02' };

test('VERDRAHTUNG: ein Treffer erzeugt einen Befund (und damit exit 1)', () => {
  const p = befunde(keinSprung, basislinie, { n: 812, jeWaehrung: { EUR: 400, INR: 212, JPY: 200 } });
  assert.ok(p.length > 0, 'kein Befund trotz 812 hartkodiert umgerechneter Snapshots');
  assert.ok(p.some((x) => /hartkodiert/i.test(x)), 'Befund benennt die Ursache nicht: ' + p.join('; '));
  assert.ok(p.some((x) => /812/.test(x) && /INR/.test(x)), 'Befund nennt weder Anzahl noch Waehrungen: ' + p.join('; '));
});

// Ein gesunder Lauf muss jetzt SAGEN, wieviel er gesehen hat — siehe Scan-Umfang unten.
const gesunderScan = { n: 0, jeWaehrung: {}, gescannt: 4768, parseFehler: 0 };

test('VERDRAHTUNG: sauberer Lauf bleibt still (kein Falsch-Rot)', () => {
  assert.deepEqual(befunde(keinSprung, basislinie, gesunderScan), []);
});

test('VERDRAHTUNG: der bestehende Sprung-Befund bleibt unberuehrt', () => {
  const p = befunde({ usOver: 200, foreignOver: 50 }, basislinie, gesunderScan);
  assert.equal(p.length, 1, 'genau der Sprung-Befund');
  assert.ok(/usOver/.test(p[0]), p[0]);
});

// ── Scan-Umfang: "0 Treffer" ist ohne "wieviel gesehen" keine Entwarnung ────────────────
// Reproduziert (03.08.2026): bei fehlendem UND bei leerem snapshots/ liefern countOverCap
// und countHardcodedFallback identisch 0 — und befunde() sagte dazu []. Ein Waechter, der
// bei "nichts gescannt" gruen meldet, ist genau dann still, wenn er am noetigsten waere.
test('SCAN-UMFANG: 0 gescannte Dateien ist ein eigener Befund', () => {
  const p = befunde(keinSprung, basislinie, { n: 0, jeWaehrung: {}, gescannt: 0, parseFehler: 0 });
  assert.ok(p.some((x) => /gescannt|keine Snapshots/i.test(x)), 'kein Befund bei 0 gescannten Dateien: ' + JSON.stringify(p));
});

test('SCAN-UMFANG: fehlende Scan-Angabe ist ein eigener Befund (nicht stille Entwarnung)', () => {
  assert.ok(befunde(keinSprung, basislinie, { n: 0, jeWaehrung: {} }).length > 0, 'ohne gescannt-Zahl darf nicht [] herauskommen');
  assert.ok(befunde(keinSprung, basislinie).length > 0, 'ganz ohne Scan-Objekt erst recht nicht');
});

// ── Parse-Fehler: loadJson schluckte sie still ──────────────────────────────────────────
// Grundlast ausgezaehlt (nicht geschaetzt): 0 Parse-Fehler in 17.367 Snapshots ueber drei
// Baeume (snapshots/ 4.768, snapshots-smallcap/ 101, CI-Baum 12.498). Wie beim
// hartkodiert-Marker ist damit jedes Auftreten ein Ereignis -> Schwelle "mindestens einer".
test('PARSE-FEHLER: werden gezaehlt statt still verschluckt', () => {
  const d = korpus([hart('INR'), live('EUR')]);
  fs.writeFileSync(path.join(d, 'kaputt.json'), '{ das ist kein JSON');
  const r = countHardcodedFallback(d);
  assert.equal(r.gescannt, 3, 'alle drei Dateien wurden angefasst');
  assert.equal(r.parseFehler, 1, 'die kaputte Datei wird gezaehlt');
  assert.equal(r.n, 1, 'der Treffer-Zaehler bleibt unveraendert');
});

test('PARSE-FEHLER: erzeugen einen Befund', () => {
  const p = befunde(keinSprung, basislinie, { n: 0, jeWaehrung: {}, gescannt: 4768, parseFehler: 3 });
  assert.ok(p.some((x) => /nicht lesbar|Parse/i.test(x)), 'kein Befund bei 3 Parse-Fehlern: ' + JSON.stringify(p));
});

test('SCAN-UMFANG: countOverCap meldet denselben Umfang', () => {
  const d = korpus([live('EUR'), usd()]);
  const r = countHardcodedFallback(d);
  assert.equal(r.gescannt, 2);
  assert.equal(r.parseFehler, 0);
});

// ── die letzte ungetestete Zeile von main(): Befund -> Exit-Code ────────────────────────
test('EXIT-CODE: Befunde ergeben 1, Stille ergibt 0', () => {
  assert.equal(exitCodeFor([]), 0);
  assert.equal(exitCodeFor(['irgendein Befund']), 1);
  assert.equal(exitCodeFor(undefined), 1, 'kein Befund-Array = kaputter Aufrufer, nicht "gesund"');
});

console.log(`\nwatch-fx-hardcoded-fallback: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);

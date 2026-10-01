'use strict';
/**
 * Waechter zum Vintage-Paar des Basis-Fixtures (T197).
 *
 * T150 hat das Basis-Fixture mit einer ehrlichen Grenze gebaut: "das Fixture erbt das Alter
 * seines Substrats ... Nach dem ersten vollen Pull neu schreiben." Der volle Pull liegt vor
 * (alle 15.044 lokalen Snapshots tragen `meta.asOf` 2026-08-29), das Fixture ist neu
 * geschrieben, der alte Stand bleibt als Vintage liegen. Damit existieren erstmals ZWEI echte
 * Datenstaende gegen DASSELBE Lineal - die Lage, fuer die der Fussabdruck-Vertrag gebaut wurde.
 *
 * Was dieser Waechter pinnt - am Ding, nicht am Text:
 *   1. das Vintage ist da und misst gegen dasselbe Lineal (sonst vergleicht man Lineale)
 *   2. es ist wirklich ein ANDERER Datenstand (Abwesenheits-Probe gegen eine blosse Kopie)
 *   3. der gemessene Befund: unter dem Eingangs-Hash-Tor ueberlebt NULL gemeinsame Zeile.
 *      Wird das je > 0, ist der Fussabdruck ueber zwei Datenstaende erstmals wirklich
 *      messbar - dann gehoert der Bericht neu geschrieben, nicht dieser Test geloescht.
 *
 * Laeuft immer: liest zwei eingecheckte Dateien, kein Snapshot-Verzeichnis noetig.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { fussabdruck } = require('../scripts/fussabdruck.js');

const NEU = path.join(__dirname, 'fixtures', 'fussabdruck-basis.json');
const VINTAGE = path.join(__dirname, 'fixtures', 'fussabdruck-basis-vintage-20260823.json');
const lade = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

test('das Vintage liegt vor und misst gegen dasselbe Lineal', () => {
  assert.ok(fs.existsSync(VINTAGE),
    'tests/fixtures/fussabdruck-basis-vintage-20260823.json fehlt - ohne den alten Stand gibt es '
    + 'keinen zweiten Datenstand und T197 ist gegenstandslos.');
  const alt = lade(VINTAGE), neu = lade(NEU);
  assert.equal(alt.schema, 'fussabdruck-basis/v1');
  assert.equal(alt.linealHash, neu.linealHash,
    `Vintage-Lineal ${alt.linealHash} != aktuelles ${neu.linealHash} - dann misst der Vergleich `
    + 'Lineal- statt Datenwirkung und die Fussabdruck-Aussage ist ungueltig.');
});

test('Vintage und aktuelles Fixture sind verschiedene Datenstaende, nicht dieselbe Datei', () => {
  const alt = lade(VINTAGE), neu = lade(NEU);
  assert.notEqual(alt.universum, neu.universum,
    'gleiches Universum in beiden Staenden - dann ist das "Vintage" eine Kopie, kein zweiter Stand.');
  const gemeinsam = Object.keys(alt.zeilen).filter((t) => neu.zeilen[t]);
  assert.ok(gemeinsam.length >= 1000,
    `nur ${gemeinsam.length} gemeinsame Ticker - zu duenn fuer eine Aussage ueber zwei Staende.`);
  const bewegterEingang = gemeinsam.filter((t) => neu.zeilen[t][1] !== alt.zeilen[t][1]).length;
  assert.ok(bewegterEingang > 0,
    'kein einziger Eingangs-Hash bewegt sich - dann sind die beiden Dateien derselbe Datenstand.');
});

test('BEFUND T197: unter dem Eingangs-Tor ueberlebt keine gemeinsame Zeile', () => {
  const alt = lade(VINTAGE), neu = lade(NEU);
  const basis = {}, kand = {}, tor = {};
  for (const [t, [score, stabil]] of Object.entries(alt.zeilen)) {
    basis[t] = score;
    const n = neu.zeilen[t];
    if (!n) continue;
    kand[t] = n[0];
    if (n[1] === stabil) tor[t] = stabil;   // nur unbewegter Eingang ist vergleichbar
  }
  const f = fussabdruck(basis, kand, tor);
  assert.equal(f.verglichen, 0,
    `${f.verglichen} vergleichbare Zeilen statt 0 - der Fussabdruck ueber zwei echte Datenstaende `
    + 'ist damit erstmals messbar. Das ist eine gute Nachricht und macht den Bericht '
    + 'agent-reports/daylauf-2026-09-19/lane-d-T197.md falsch: neu messen, dann diesen Test '
    + 'auf die neue Zahl stellen.');
  assert.equal(f.anteilBewegt, null,
    'Bei null verglichenen Zeilen meldet der Anteil null - eine 0 hier waere die gefaehrlichere '
    + 'Zahl (leere Messung sieht aus wie "nichts bewegt"). Pinnt den Befund, nicht den Wunsch.');
});

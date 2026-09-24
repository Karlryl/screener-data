'use strict';
/**
 * Gate fuer lib/artifact-path.js. Matcht `lib/*test.js` aus GATE_GLOB, laeuft also
 * im selben Job wie die uebrigen lib-Tests. Standalone, kein Netz.
 * Run: node lib/artifact-path.test.js
 */
const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { baseName, toPosix } = require('./artifact-path.js');

const WIN = 'C:\\Users\\Anwender\\Documents\\Codex\\build_identity_transition_dossiers_v1.py';

test('Windows-Pfad wird zerlegt — auch dort, wo path.basename es nicht taete', () => {
  assert.equal(baseName(WIN), 'build_identity_transition_dossiers_v1.py');
  // Der Kern-Fund: auf ubuntu-latest (path.posix) gibt path.basename den GANZEN String
  // zurueck. Dieser Test pinnt den Dateinamen, damit der Helfer nie wieder auf
  // path.basename zurueckfaellt.
  assert.equal(path.posix.basename(WIN), WIN);
  assert.notEqual(baseName(WIN), path.posix.basename(WIN));
});

test('POSIX-Pfad, blosser Dateiname, gemischte Trenner, Trenner am Ende, Leerstring', () => {
  assert.equal(baseName('/a/b/x.py'), 'x.py');
  assert.equal(baseName('x.py'), 'x.py');
  assert.equal(baseName('C:\\a/b\\c/x.json'), 'x.json');
  assert.equal(baseName('C:\\a\\b\\'), 'b');
  assert.equal(baseName('/a/b/'), 'b');
  assert.equal(baseName(''), '');
  assert.equal(baseName('\\'), '');
});

test('toPosix normalisiert einen ganzen Windows-Pfad', () => {
  assert.equal(toPosix(WIN), 'C:/Users/Anwender/Documents/Codex/build_identity_transition_dossiers_v1.py');
  assert.equal(toPosix('/a/b/x.py'), '/a/b/x.py');
});

// ---------------------------------------------------------------------------------------
// Edge-Faelle (S38, 2026-09-24). Quelle NICHT angefasst — hier werden nur bestehende
// Eigenschaften gepinnt, damit ein spaeterer Umbau sie nicht still veraendert.
// ---------------------------------------------------------------------------------------

// BEWUSST GEPINNTE QUIRK: lib/artifact-path.js:24 macht per `String(p)` aus null -> 'null',
// undefined -> 'undefined', 42 -> '42'. Der Konsument
// tests/early-detection-identity-transition-dossiers.test.js (baseName(item.path) in find-
// Callbacks) verlaesst sich darauf, dass baseName NIE wirft — ein fehlendes `path`-Feld im
// Artefakt fuehrt zu einem stillen Nicht-Treffer ('undefined' matcht keinen Dateinamen) und
// damit zu assert.ok(entry)-Rot, nicht zu einem TypeError irgendwo im Callback. Nichts aendern.
test('Nicht-Strings werden stringifiziert, nie geworfen: null/undefined/42 (gepinnte Quirk)', () => {
  assert.equal(baseName(null), 'null');
  assert.equal(baseName(undefined), 'undefined');
  assert.equal(baseName(42), '42');
  assert.equal(toPosix(null), 'null');
  assert.equal(toPosix(undefined), 'undefined');
  assert.equal(toPosix(42), '42');
  assert.doesNotThrow(() => baseName({}));
});

test('UNC-Pfad (\\\\srv\\share\\x.py) -> x.py; toPosix haelt den doppelten Trenner am Anfang', () => {
  const UNC = '\\\\srv\\share\\x.py';
  assert.equal(baseName(UNC), 'x.py');
  assert.equal(toPosix(UNC), '//srv/share/x.py');
});

test("Sonderfaelle: '/a/..' -> '..', 'C:' -> 'C:', '///' -> '' (nur Trenner = leer)", () => {
  assert.equal(baseName('/a/..'), '..');
  assert.equal(baseName('C:'), 'C:');
  assert.equal(baseName('///'), '');
  assert.equal(baseName('\\\\\\'), '');
  assert.equal(baseName('/'), '');
});

test('Unicode-Namen und Leerzeichen bleiben erhalten; trailing Whitespace wird NICHT getrimmt', () => {
  assert.equal(baseName('/ä/ö ü.json'), 'ö ü.json');
  assert.equal(baseName('C:\\日本\\報告.json'), '報告.json');
  assert.equal(baseName('x.py '), 'x.py ', 'kein implizites trim — Vergleiche muessen exakt bleiben');
  assert.equal(baseName(' x.py'), ' x.py');
});

test('toPosix: Leerstring bleibt leer, POSIX-Pfad unveraendert, idempotent', () => {
  assert.equal(toPosix(''), '');
  assert.equal(toPosix('/a/b/x.py'), '/a/b/x.py');
  assert.equal(toPosix('x.py'), 'x.py');
  for (const x of [WIN, '\\\\srv\\share\\x.py', 'C:\\a/b\\c/x.json', '/a/b/', '']) {
    const einmal = toPosix(x);
    assert.equal(toPosix(einmal), einmal, 'toPosix(toPosix(x)) === toPosix(x) fuer ' + JSON.stringify(x));
    assert.ok(!einmal.includes('\\'), 'nach toPosix kein Backslash mehr in ' + JSON.stringify(x));
  }
});

// Eigenschaft: der Namensteil haengt nicht davon ab, ob der Pfad vorher normalisiert wurde.
// Genau das macht baseName separator-neutral — wuerde eine Seite nur `/` kennen, braeche
// die Gleichheit fuer jeden Windows-Pfad.
test('Eigenschaft: baseName(toPosix(x)) === baseName(x) ueber alle Fixture-Pfade', () => {
  const fixtures = [
    WIN,
    '\\\\srv\\share\\x.py',
    'C:\\a/b\\c/x.json',
    'C:\\a\\b\\',
    '/a/b/x.py',
    '/a/b/',
    '/a/..',
    'C:',
    '///',
    '/ä/ö ü.json',
    'x.py ',
    'x.py',
    '',
    '\\',
    'reports\\early-detection\\research-corpus-gate-decision-2026-08-10-v40.json',
  ];
  assert.ok(fixtures.length >= 8, 'mindestens 8 Fixture-Pfade');
  for (const x of fixtures) {
    assert.equal(baseName(toPosix(x)), baseName(x), 'Eigenschaft verletzt fuer ' + JSON.stringify(x));
  }
});

test('baseName nimmt den LETZTEN Namensteil, auch bei mehrfachen Trennern und Verzeichnis-Suffix', () => {
  assert.equal(baseName('C:\\\\a\\\\b\\\\x.py'), 'x.py');
  assert.equal(baseName('/a//b//x.py'), 'x.py');
  assert.equal(baseName('/a/b/x.py/'), 'x.py');
  assert.equal(baseName('a\\b/c\\d/e.json'), 'e.json');
});

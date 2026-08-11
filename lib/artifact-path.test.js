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

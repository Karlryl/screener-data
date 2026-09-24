'use strict';
// lib/env-key.test.js — Standalone-Runner (framework-los).
// Run: node lib/env-key.test.js
//
// WOFUER (S25): auf Windows heisst der Environment-Schluessel `Path`, nicht `PATH`. `{ ...process.env,
// PATH: … }` erzeugt dort ein Objekt mit BEIDEN Schreibweisen, und welche davon das Kind sieht, sichert
// Node nicht zu. lib/env-key.js setzt genau EINEN Schluessel (vorhandene Schreibweise, sonst `name`).
// Alle Faelle laufen ueber den injizierten `platform`-Parameter, NICHT ueber process.platform — der
// Test ist damit auf Linux, macOS und Windows gleich scharf.
const assert = require('assert');
const { findeEnvSchluessel, mitEnv } = require('./env-key.js');

let fail = 0;
function check(name, fn) {
  try { fn(); console.log('  ok   ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + ': ' + (e && e.message || e)); }
}
const keys = (o) => Object.keys(o).sort();

// --- findeEnvSchluessel -------------------------------------------------------------------------
check('E1: win32 — vorhandene Schreibweise `Path` wird fuer `PATH` gefunden', () => {
  assert.strictEqual(findeEnvSchluessel({ Path: 'a' }, 'PATH', 'win32'), 'Path');
  assert.strictEqual(findeEnvSchluessel({ path: 'a' }, 'PATH', 'win32'), 'path');
  assert.strictEqual(findeEnvSchluessel({ X: '1', Path: 'a' }, 'PATH', 'win32'), 'Path');
});
check('E2: linux — exakter Vergleich, `Path` ist NICHT `PATH`', () => {
  assert.strictEqual(findeEnvSchluessel({ Path: 'a' }, 'PATH', 'linux'), 'PATH');
  assert.strictEqual(findeEnvSchluessel({ PATH: 'a' }, 'PATH', 'linux'), 'PATH');
  assert.strictEqual(findeEnvSchluessel({ Path: 'a' }, 'PATH', 'darwin'), 'PATH');
});
check('E3: nicht vorhanden -> `name` (win32 wie linux), auch bei leerem/fehlendem env', () => {
  assert.strictEqual(findeEnvSchluessel({}, 'PATH', 'win32'), 'PATH');
  assert.strictEqual(findeEnvSchluessel({}, 'PATH', 'linux'), 'PATH');
  assert.strictEqual(findeEnvSchluessel({ HOME: '/h' }, 'PATH', 'win32'), 'PATH');
  assert.strictEqual(findeEnvSchluessel(null, 'PATH', 'win32'), 'PATH');
  assert.strictEqual(findeEnvSchluessel(undefined, 'PATH', 'linux'), 'PATH');
});
check('E4: win32 mit Duplikaten — exakte Schreibweise gewinnt vor der Case-Variante', () => {
  assert.strictEqual(findeEnvSchluessel({ Path: 'a', PATH: 'c' }, 'PATH', 'win32'), 'PATH');
  assert.strictEqual(findeEnvSchluessel({ Path: 'a', PATH: 'c' }, 'Path', 'win32'), 'Path');
});
check('E5: platform-Default ist process.platform (Aufruf ohne 3. Argument funktioniert, exakter Treffer ueberall)', () => {
  assert.strictEqual(findeEnvSchluessel({ PATH: 'a' }, 'PATH'), 'PATH');
  assert.strictEqual(findeEnvSchluessel({}, 'GH_TOKEN'), 'GH_TOKEN');
});

// --- mitEnv ------------------------------------------------------------------------------------
check('M1: win32 — `Path` wird ueberschrieben, KEIN zweiter `PATH`-Schluessel entsteht, Eingabe unveraendert', () => {
  const eingabe = { Path: 'a', X: '1' };
  const vorher = JSON.stringify(eingabe);
  const r = mitEnv(eingabe, 'PATH', 'b', 'win32');
  assert.deepStrictEqual(keys(r), ['Path', 'X']);
  assert.strictEqual(Object.keys(r).length, 2);
  assert.strictEqual(r.Path, 'b');
  assert.strictEqual(r.X, '1');
  assert.strictEqual('PATH' in r, false);
  assert.strictEqual(JSON.stringify(eingabe), vorher, 'Eingabe mutiert');
  assert.notStrictEqual(r, eingabe, 'keine flache Kopie');
});
check('M2: win32 mit Duplikaten { Path, PATH } -> genau EIN Schluessel fuer den Pfad, mit dem neuen Wert', () => {
  const eingabe = { Path: 'a', PATH: 'c', X: '1' };
  const vorher = JSON.stringify(eingabe);
  const r = mitEnv(eingabe, 'PATH', 'b', 'win32');
  const pfadSchluessel = Object.keys(r).filter(k => k.toUpperCase() === 'PATH');
  assert.strictEqual(pfadSchluessel.length, 1, 'Pfad-Schluessel: ' + pfadSchluessel.join(','));
  assert.strictEqual(r[pfadSchluessel[0]], 'b');
  assert.strictEqual(Object.keys(r).length, 2);
  assert.strictEqual(r.X, '1');
  assert.strictEqual(JSON.stringify(eingabe), vorher, 'Eingabe mutiert');
  // drei Varianten -> ebenfalls genau eine
  const r3 = mitEnv({ Path: 'a', PATH: 'c', path: 'd' }, 'PATH', 'b', 'win32');
  assert.strictEqual(Object.keys(r3).filter(k => k.toUpperCase() === 'PATH').length, 1);
  assert.strictEqual(Object.values(r3)[0], 'b');
});
check('M3: linux — `Path` und `PATH` sind verschiedene Variablen: beide bleiben (zwei Schluessel)', () => {
  const eingabe = { Path: 'a' };
  const r = mitEnv(eingabe, 'PATH', 'b', 'linux');
  assert.deepStrictEqual(keys(r), ['PATH', 'Path']);
  assert.strictEqual(Object.keys(r).length, 2);
  assert.strictEqual(r.Path, 'a');
  assert.strictEqual(r.PATH, 'b');
  assert.deepStrictEqual(eingabe, { Path: 'a' }, 'Eingabe mutiert');
});
check('M4: linux — exakt vorhandener Schluessel wird ueberschrieben, nicht verdoppelt', () => {
  const r = mitEnv({ PATH: 'a', HOME: '/h' }, 'PATH', 'b', 'linux');
  assert.deepStrictEqual(r, { PATH: 'b', HOME: '/h' });
});
check('M5: nicht vorhanden -> Schluessel `name` wird angelegt (win32 wie linux), andere Werte bleiben', () => {
  assert.deepStrictEqual(mitEnv({ X: '1' }, 'PATH', 'b', 'win32'), { X: '1', PATH: 'b' });
  assert.deepStrictEqual(mitEnv({ X: '1' }, 'PATH', 'b', 'linux'), { X: '1', PATH: 'b' });
  assert.deepStrictEqual(mitEnv({}, 'GH_TOKEN', 't', 'win32'), { GH_TOKEN: 't' });
});
check('M6: Praxisfall des gh-Stubs — win32-Env aus `{ ...process.env, GITHUB_OUTPUT, GH_TOKEN }` bekommt genau einen Pfad', () => {
  const basis = { Path: 'C:\\Windows', SystemRoot: 'C:\\Windows', GITHUB_OUTPUT: 'out.txt', GH_TOKEN: 't' };
  const r = mitEnv(basis, 'PATH', 'C:\\stub;' + basis.Path, 'win32');
  assert.deepStrictEqual(keys(r), ['GH_TOKEN', 'GITHUB_OUTPUT', 'Path', 'SystemRoot']);
  assert.strictEqual(r.Path, 'C:\\stub;C:\\Windows');
  assert.strictEqual(r.GH_TOKEN, 't');
});
check('M7: Rueckgabe ist ein Plain-Object mit eigenen Schluesseln (spawnSync-tauglich), Prototyp-Schluessel werden nicht erfunden', () => {
  const r = mitEnv({ Path: 'a' }, 'PATH', 'b', 'win32');
  assert.ok(Object.prototype.hasOwnProperty.call(r, 'Path'));
  assert.strictEqual(Object.getPrototypeOf(r), Object.prototype);
  assert.strictEqual(findeEnvSchluessel({}, 'constructor', 'win32'), 'constructor');
  assert.strictEqual(findeEnvSchluessel({}, 'toString', 'linux'), 'toString');
});

if (fail) { console.log('FAIL: env-key (' + fail + ')'); process.exit(1); }
console.log('OK: env-key (S25)');

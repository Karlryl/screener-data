'use strict';
/**
 * Fail-loud-JSON-Leser fuer Pflichtdateien (P0-Haertung 2026-08-09, Bugklasse
 * F-CGPT-005/007/008/019/060: "korrupte Pflichtdatei -> als Erstanlage behandeln ->
 * mit einem Teilstand ueberschreiben -> Exit 0").
 *
 * Die EINE Unterscheidung, um die es geht:
 *   - Datei existiert NICHT  -> echte Erstanlage, legitim  -> null (Aufrufer bootstrappt)
 *   - Datei existiert, ist aber unlesbar/kaputt -> KEINE Erstanlage -> wirft
 *
 * Das uebliche `try { JSON.parse(readFileSync(p)) } catch (_) { return null }` wirft genau
 * diese beiden Faelle zusammen. Der Aufrufer legt danach einen frischen Zustand an und
 * schreibt ihn ueber den (noch vorhandenen, nur ungelesenen) Altbestand — Historie weg,
 * Prozess gruen.
 *
 * Run: node lib/read-json.js   (Selbsttest)
 */
const fs = require('fs');

function readJsonExistingOrThrow(p) {
  let roh;
  try {
    roh = fs.readFileSync(p, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return null;   // echte Erstanlage
    e.jsonPath = p;
    throw e;                                 // EISDIR/EACCES/EPERM: da, aber nicht lesbar
  }
  try {
    return JSON.parse(roh);
  } catch (e) {
    const err = new Error(p + ' ist vorhanden, aber unlesbar (' + e.message
      + ') — kein Erstanlage-Fall, refusing to overwrite');
    err.jsonPath = p;
    err.corrupt = true;
    throw err;
  }
}

module.exports = { readJsonExistingOrThrow };

if (require.main === module) {
  const assert = require('node:assert/strict');
  const os = require('os');
  const path = require('path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'read-json-'));
  assert.equal(readJsonExistingOrThrow(path.join(dir, 'weg.json')), null, 'fehlend -> null');
  fs.writeFileSync(path.join(dir, 'gut.json'), '{"a":1}');
  assert.deepEqual(readJsonExistingOrThrow(path.join(dir, 'gut.json')), { a: 1 });
  fs.writeFileSync(path.join(dir, 'kaputt.json'), '{"a":');
  assert.throws(() => readJsonExistingOrThrow(path.join(dir, 'kaputt.json')), /unlesbar/);
  fs.mkdirSync(path.join(dir, 'ordner.json'));
  assert.throws(() => readJsonExistingOrThrow(path.join(dir, 'ordner.json')));
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('lib/read-json.js selftest: ok');
}

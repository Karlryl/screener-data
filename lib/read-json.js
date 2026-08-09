'use strict';
/**
 * Fail-loud-JSON-Leser fuer Pflichtdateien (P0-Haertung 2026-08-09, Bugklasse
 * F-CGPT-005/007/008/019/060: "korrupte Pflichtdatei -> als Erstanlage behandeln ->
 * mit einem Teilstand ueberschreiben -> Exit 0").
 *
 * Die EINE Unterscheidung, um die es geht:
 *   - Datei existiert NICHT  -> echte Erstanlage, legitim  -> Sentinel FEHLT
 *   - Datei existiert, ist aber unlesbar/kaputt -> KEINE Erstanlage -> wirft
 *
 * WARUM EIN SENTINEL UND NICHT null (Review-Fund 2026-08-09): gaebe es fuer "fehlt" ein
 * null zurueck, waere es von einer Datei mit dem Inhalt `null` nicht zu unterscheiden — der
 * Aufrufer muesste die Existenz per zweitem existsSync nachpruefen, und genau in diesem
 * Zeitfenster kann ein gueltiger, bereits gelesener Bestand als "fehlt" durchgehen und vom
 * Erstanlage-Pfad ueberschrieben werden. Also: nur EIN Filesystem-Zugriff, ein eindeutiger
 * Rueckgabewert. `null`, `[]`, `5`, `"x"` sind Inhalte einer VORHANDENEN Datei und damit
 * dieselbe Klasse wie Syntaxmuell -> Wurf.
 *
 * Das uebliche `try { JSON.parse(readFileSync(p)) } catch (_) { return null }` wirft genau
 * diese beiden Faelle zusammen. Der Aufrufer legt danach einen frischen Zustand an und
 * schreibt ihn ueber den (noch vorhandenen, nur ungelesenen) Altbestand — Historie weg,
 * Prozess gruen.
 *
 * Run: node lib/read-json.js   (Selbsttest)
 */
const fs = require('fs');

const FEHLT = Symbol('datei-fehlt');

function readJsonExistingOrThrow(p) {
  let roh;
  try {
    roh = fs.readFileSync(p, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return FEHLT;   // echte Erstanlage
    e.jsonPath = p;
    throw e;                                 // EISDIR/EACCES/EPERM: da, aber nicht lesbar
  }
  const wirf = (grund) => {
    const err = new Error(p + ' ist vorhanden, aber unlesbar (' + grund
      + ') — kein Erstanlage-Fall, refusing to overwrite');
    err.jsonPath = p;
    err.corrupt = true;
    throw err;
  };
  let wert;
  try { wert = JSON.parse(roh); } catch (e) { wirf(e.message); }
  if (!wert || typeof wert !== 'object' || Array.isArray(wert)) {
    wirf('kein JSON-Objekt, sondern ' + (wert === null ? 'null' : Array.isArray(wert) ? 'Array' : typeof wert));
  }
  return wert;
}

module.exports = { readJsonExistingOrThrow, FEHLT };

if (require.main === module) {
  const assert = require('node:assert/strict');
  const os = require('os');
  const path = require('path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'read-json-'));
  assert.equal(readJsonExistingOrThrow(path.join(dir, 'weg.json')), FEHLT, 'fehlend -> FEHLT');
  fs.writeFileSync(path.join(dir, 'gut.json'), '{"a":1}');
  assert.deepEqual(readJsonExistingOrThrow(path.join(dir, 'gut.json')), { a: 1 });
  fs.writeFileSync(path.join(dir, 'kaputt.json'), '{"a":');
  assert.throws(() => readJsonExistingOrThrow(path.join(dir, 'kaputt.json')), /unlesbar/);
  for (const [name, inhalt] of [['null.json', 'null'], ['liste.json', '[]'], ['zahl.json', '5']]) {
    fs.writeFileSync(path.join(dir, name), inhalt);
    assert.throws(() => readJsonExistingOrThrow(path.join(dir, name)), /kein JSON-Objekt/,
      name + ' ist eine vorhandene Datei, kein Erstanlage-Fall');
  }
  fs.mkdirSync(path.join(dir, 'ordner.json'));
  assert.throws(() => readJsonExistingOrThrow(path.join(dir, 'ordner.json')));
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('lib/read-json.js selftest: ok');
}

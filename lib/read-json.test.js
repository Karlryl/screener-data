'use strict';
/**
 * Gate fuer lib/read-json.js (Review-Nachzug P0-Haertung, 2026-08-09).
 *
 * Der Modul-Selbsttest (`node lib/read-json.js`) endet nicht auf `test.js` und lief damit
 * in KEINEM CI-Job — genau die beiden neuen Zweige ("gueltiges JSON, aber kein Objekt" und
 * "existiert, ist aber nicht lesbar") waren ungegatet. Diese Datei matcht `lib/*test.js`
 * aus GATE_GLOB. Der Selbsttest im Modul bleibt als Direktlauf bestehen.
 *
 * Standalone-Runner, kein Netz. Run: node lib/read-json.test.js
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readJsonExistingOrThrow, FEHLT } = require('./read-json.js');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.stack); }
}

const tmpDirs = [];
function tmp() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'read-json-'));
  tmpDirs.push(d);
  return d;
}

test('fehlende Datei -> Sentinel FEHLT (echte Erstanlage)', () => {
  assert.equal(readJsonExistingOrThrow(path.join(tmp(), 'weg.json')), FEHLT);
});

test('gueltiges Objekt kommt unveraendert zurueck', () => {
  const p = path.join(tmp(), 'gut.json');
  fs.writeFileSync(p, '{"a":1}');
  assert.deepEqual(readJsonExistingOrThrow(p), { a: 1 });
});

test('Syntaxmuell wirft (kein Erstanlage-Fall)', () => {
  const p = path.join(tmp(), 'kaputt.json');
  fs.writeFileSync(p, '{"a":');
  assert.throws(() => readJsonExistingOrThrow(p), /unlesbar/);
});

// Der Kern-Fund: JSON.parse wirft bei 'null'/'[]'/'5' NICHT. Ohne diesen Zweig kaeme
// ein null/Array/Zahl aus einer VORHANDENEN Datei als vermeintlicher Zustand heraus und
// der Aufrufer schriebe seinen Erstanlage-Stand darueber.
test('gueltiges JSON, aber kein Objekt (null/[]/5/"x") wirft — mit jsonPath und corrupt-Flag', () => {
  const dir = tmp();
  for (const [name, inhalt] of [['null.json', 'null'], ['liste.json', '[]'], ['zahl.json', '5'], ['string.json', '"SPY"']]) {
    const p = path.join(dir, name);
    fs.writeFileSync(p, inhalt);
    let gefangen = null;
    assert.throws(() => readJsonExistingOrThrow(p), (e) => { gefangen = e; return /kein JSON-Objekt/.test(e.message); },
      name + ' ist eine vorhandene Datei, kein Erstanlage-Fall');
    assert.equal(gefangen.jsonPath, p, 'der Aufrufer muss die Datei zuordnen koennen');
    assert.equal(gefangen.corrupt, true);
  }
});

// Existiert, aber nicht lesbar (hier: Verzeichnis statt Datei -> EISDIR/EPERM). Darf
// NIEMALS als FEHLT durchgehen, sonst ueberschreibt der Erstanlage-Pfad den Bestand.
test('vorhanden aber unlesbar (Verzeichnis) wirft statt FEHLT zurueckzugeben', () => {
  const p = path.join(tmp(), 'ordner.json');
  fs.mkdirSync(p);
  let gefangen = null;
  assert.throws(() => readJsonExistingOrThrow(p), (e) => { gefangen = e; return true; });
  assert.notEqual(gefangen.code, 'ENOENT', 'kein Erstanlage-Fall');
  assert.equal(gefangen.jsonPath, p);
});

for (const d of tmpDirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {} }
console.log(`\nread-json.test.js: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);

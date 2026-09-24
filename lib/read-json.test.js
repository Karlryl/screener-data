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

test('Syntaxmuell wirft (kein Erstanlage-Fall) — mit jsonPath und corrupt-Flag', () => {
  const p = path.join(tmp(), 'kaputt.json');
  fs.writeFileSync(p, '{"a":');
  let gefangen = null;
  assert.throws(() => readJsonExistingOrThrow(p), (e) => { gefangen = e; return /unlesbar/.test(e.message); });
  assert.equal(gefangen.jsonPath, p, 'der Aufrufer muss die Datei zuordnen koennen');
  assert.equal(gefangen.corrupt, true);
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


// ---------------------------------------------------------------------------------------
// Edge-Faelle (S38, 2026-09-24): Grenzinhalte einer VORHANDENEN Datei. Jeder Wurf-Fall
// pinnt jsonPath UND corrupt, damit der Aufrufer die Datei zuordnen kann und den Fall nie
// mit einer echten Erstanlage (FEHLT) verwechselt.
// ---------------------------------------------------------------------------------------

// Hilfsfunktion: erwartet einen Wurf, prueft Meldung + jsonPath + corrupt, gibt den Fehler zurueck.
function erwarteWurf(p, muster) {
  let gefangen = null;
  assert.throws(() => readJsonExistingOrThrow(p), (e) => { gefangen = e; return muster.test(e.message); },
    p + ' muss werfen und auf ' + muster + ' passen');
  assert.equal(gefangen.jsonPath, p, 'jsonPath zeigt auf die kaputte Datei');
  assert.equal(gefangen.corrupt, true, 'corrupt-Flag gesetzt');
  return gefangen;
}

test('0-Byte-Datei wirft /unlesbar/ (Unexpected end), corrupt + jsonPath — NICHT FEHLT', () => {
  const p = path.join(tmp(), 'leer.json');
  fs.writeFileSync(p, '');
  assert.equal(fs.statSync(p).size, 0, 'Vorbedingung: wirklich 0 Byte');
  const e = erwarteWurf(p, /unlesbar/);
  assert.match(e.message, /Unexpected end/);
});

test('nur Whitespace wirft /unlesbar/, corrupt + jsonPath — NICHT FEHLT', () => {
  const p = path.join(tmp(), 'whitespace.json');
  fs.writeFileSync(p, ' \n\t\r\n ');
  const e = erwarteWurf(p, /unlesbar/);
  assert.match(e.message, /Unexpected end/);
});

// Doku-Fund: JSON.parse akzeptiert kein UTF-8-BOM. Die atomaren Writer des Repos schreiben
// nie ein BOM, deshalb ist das kein Produktions-Bug — aber eine von Hand (Editor/PowerShell
// Out-File) erzeugte Datei mit BOM wird als korrupt behandelt, nicht still als leer gelesen.
test('UTF-8-BOM vor gueltigem Objekt wirft /unlesbar/ mit corrupt + jsonPath (Doku-Fund)', () => {
  const p = path.join(tmp(), 'bom.json');
  fs.writeFileSync(p, '﻿{"a":1}');
  assert.equal(fs.readFileSync(p)[0], 0xEF, 'Vorbedingung: BOM-Byte steht wirklich in der Datei');
  erwarteWurf(p, /unlesbar/);
});

test("'true' und 'false' wirft /kein JSON-Objekt, sondern boolean/ mit corrupt + jsonPath", () => {
  const dir = tmp();
  for (const [name, inhalt] of [['wahr.json', 'true'], ['falsch.json', 'false']]) {
    const p = path.join(dir, name);
    fs.writeFileSync(p, inhalt);
    erwarteWurf(p, /kein JSON-Objekt, sondern boolean/);
  }
});

test("'{}' ist ein gueltiges (leeres) Objekt -> {} zurueck, kein FEHLT, kein Wurf", () => {
  const p = path.join(tmp(), 'leeres-objekt.json');
  fs.writeFileSync(p, '{}');
  const wert = readJsonExistingOrThrow(p);
  assert.notEqual(wert, FEHLT, 'vorhandene Datei ist nie eine Erstanlage');
  assert.deepEqual(wert, {});
  assert.equal(Object.keys(wert).length, 0);
});

test('trailing garbage hinter gueltigem Objekt wirft /unlesbar/, corrupt + jsonPath', () => {
  const p = path.join(tmp(), 'trailing.json');
  fs.writeFileSync(p, '{"a":1}x');
  erwarteWurf(p, /unlesbar/);
});

test('Unicode-Inhalt (Umlaut-Ticker, CJK) kommt deepEqual zurueck', () => {
  const p = path.join(tmp(), 'unicode.json');
  const erwartet = { tickers: ['MÜV2.DE', '日本'] };
  fs.writeFileSync(p, JSON.stringify(erwartet), 'utf8');
  assert.deepEqual(readJsonExistingOrThrow(p), erwartet);
});

test('verschachteltes Objekt kommt deepEqual zurueck (Arrays, null-Werte, Zahlen, Strings)', () => {
  const p = path.join(tmp(), 'nested.json');
  const erwartet = { meta: { version: 3, tags: ['a', 'b'], leer: null }, rows: [{ t: 'SPY', v: 1.5 }, { t: 'QQQ', v: -2 }] };
  fs.writeFileSync(p, JSON.stringify(erwartet));
  assert.deepEqual(readJsonExistingOrThrow(p), erwartet);
});

// Der Sentinel-Vertrag aus dem Modul-Kopf: FEHLT ist ein Symbol, damit es von KEINEM
// moeglichen Dateiinhalt (auch nicht `null`) verwechselt werden kann.
test('FEHLT ist ein Symbol und !== null (vom Dateiinhalt `null` unterscheidbar)', () => {
  assert.equal(typeof FEHLT, 'symbol');
  assert.notEqual(FEHLT, null);
  assert.notEqual(FEHLT, undefined);
  assert.notEqual(FEHLT, false);
  assert.equal(FEHLT.description, 'datei-fehlt');
});

test('Fehlermeldung beginnt mit dem Pfad (message.startsWith(p)) — fuer alle Wurf-Klassen', () => {
  const dir = tmp();
  for (const [name, inhalt] of [['syntax.json', '{"a":'], ['null.json', 'null'], ['leer.json', ''], ['bool.json', 'true']]) {
    const p = path.join(dir, name);
    fs.writeFileSync(p, inhalt);
    const e = erwarteWurf(p, /unlesbar/);
    assert.ok(e.message.startsWith(p), name + ': Meldung muss mit dem Pfad beginnen: ' + e.message);
    assert.match(e.message, /refusing to overwrite/);
  }
});

for (const d of tmpDirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {} }
console.log(`\nread-json.test.js: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);

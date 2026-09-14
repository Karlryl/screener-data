'use strict';
/** tests/druckenmiller/f16-guard.test.js — Standalone-Runner.
 *
 * DIE ZUSICHERUNG: dieses Modul faellt nicht in die gesperrte F-16-Klasse.
 * scripts/filter-snapshot-merge.js:1449-1453 sperrt bis Ende Oktober ausdruecklich
 * "KEINE Listing-Waehrungs-Logik, KEINE Umrechnungsregel, KEINE Boersen-Identitaet je
 * Firma, KEIN exchanges[]". Der Rat hat U (D4) genau deshalb auf das Vertragsfeld
 * `country` plus einen reinen String-Test auf den Punkt gelegt.
 *
 * WARUM ES DIESEN TEST GIBT (Anklage A1, Punkt 2, Gericht 2026-09-14): die F-16-Grenze
 * stand in der Spezifikation als BEHAUPTUNG, mit fuenf Waechtern daneben, von denen
 * keiner sie prueft. Eine Grenze ohne ausgefuehrten Test ist keine Grenze.
 *
 * ER LIEST DEN QUELLTEXT, NICHT DAS VERHALTEN — samt Kommentaren: ein Kommentar, der
 * eine Boersen-Identitaet vorbereitet, ist die Saat des naechsten Bruchs.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO = path.resolve(__dirname, '..', '..');
const MODUL_DIR = path.join(REPO, 'lib', 'druckenmiller');
const DATEIEN = fs.readdirSync(MODUL_DIR).filter((f) => f.endsWith('.js'))
  .map((f) => path.join(MODUL_DIR, f))
  .concat([path.join(REPO, 'scripts', 'druckenmiller-log-internals.js')]);

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + (e && e.message)); }
}

// Verbotene Bezeichner der gesperrten Klasse.
const VERBOTEN = [
  'currency', 'waehrung', 'fxrate', 'fxconverted', 'exchangename', 'exchanges',
  'listing', 'crossnotiz', 'kreuznotiz', 'isin', 'mic ',
];

// EINE benannte Ausnahme, exakt und begruendet: `_annualCurrencyLeakSuspect` ist der
// Name einer bestehenden Daten-Verdachts-LAMPE (pull-yahoo.js:4237), die D4 als
// Ausschluss-Kriterium nennt. Das Modul LIEST das Flag, es rechnet nichts um. Die
// Ausnahme ist genau dieser eine String — jede andere Schreibweise faellt weiter durch.
const AUSNAHMEN = ['_annualCurrencyLeakSuspect', 'annualCurrencyLeak'];

function gesaeubert(quelle) {
  let s = quelle;
  for (const a of AUSNAHMEN) s = s.split(a).join('«ausnahme»');
  return s.toLowerCase();
}

test('F1 kein Waehrungs-, FX- oder Boersen-Identitaets-Bezeichner im ganzen Modul', () => {
  const treffer = [];
  for (const datei of DATEIEN) {
    const s = gesaeubert(fs.readFileSync(datei, 'utf8'));
    for (const w of VERBOTEN) if (s.includes(w)) treffer.push(path.basename(datei) + ' -> ' + w);
  }
  assert.deepEqual(treffer, [], 'gesperrte F-16-Klasse beruehrt: ' + treffer.join(' · '));
  assert.ok(DATEIEN.length >= 4, 'der Waechter hat kaum Dateien gesehen — dann prueft er nichts');
});

test('F2 BRUCHPROBE: derselbe Waechter faengt einen eingeschmuggelten Bezeichner', () => {
  const sabotage = "const kurs = row.tradingCurrency === 'EUR' ? umrechnen(x) : x;";
  const s = gesaeubert(sabotage);
  assert.ok(VERBOTEN.some((w) => s.includes(w)),
    'eine Zeile mit tradingCurrency laeuft durch — der Waechter ist Dekoration');
  // und die Ausnahme rettet NUR sich selbst, nicht ihre Nachbarschaft:
  assert.ok(!VERBOTEN.some((w) => gesaeubert('if (meta._annualCurrencyLeakSuspect) return "suspect";').includes(w)));
  assert.ok(VERBOTEN.some((w) => gesaeubert('const c = meta.reportingCurrency;').includes(w)));
});

test('F3 der Suffix-Test bleibt ein String-Test — kein Zerlegen, kein Suffix-Katalog', () => {
  const zerlegung = [/split\(\s*['"]\./, /lastIndexOf\(\s*['"]\./, /match\(\s*\/\\\./, /\.pop\(\)/];
  const treffer = [];
  for (const datei of DATEIEN) {
    const s = fs.readFileSync(datei, 'utf8');
    for (const rx of zerlegung) if (rx.test(s)) treffer.push(path.basename(datei) + ' -> ' + rx);
  }
  assert.deepEqual(treffer, [], 'hier wird ein Ticker-Suffix zerlegt statt nur getestet: ' + treffer.join(' · '));
  const U = require('../../lib/druckenmiller/universe.js');
  // Verhaltens-Gegenprobe: ein Suffix wird NICHT interpretiert, nur bemerkt.
  assert.equal(U.hasSuffix('GS.VI'), true);
  assert.equal(U.hasSuffix('GS.TO'), true);
  assert.equal(U.candidateReason({ ticker: 'GS.VI', country: 'United States' }, 300), 'suffix');
});

test('F4 U haengt am Vertragsfeld country und an nichts sonst', () => {
  const U = require('../../lib/druckenmiller/universe.js');
  assert.equal(U.candidateReason({ ticker: 'AAA', country: 'United States' }, 300), null);
  assert.equal(U.candidateReason({ ticker: 'AAA', country: 'USA' }, 300), 'country',
    'kein Alias-Mapping: der Vertrag schreibt "United States", und nur das gilt');
  assert.equal(U.candidateReason({ ticker: 'AAA', country: null }, 300), 'country');
});

console.log('\nf16-guard.test.js: ' + pass + ' ok, ' + fail + ' fail');
process.exit(fail ? 1 : 0);

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

const REPO = path.resolve(__dirname, '..');
const MODUL_DIR = path.join(REPO, 'lib', 'druckenmiller');
// [REV7-4]: der Scan laeuft auf BEIDEN Seiten des Moduls. Hier die screener-data-Seite:
// lib/druckenmiller/** UND scripts/*druckenmiller* — als GLOB, nicht als Namensliste. Eine
// Liste haette den Schreiber aus Chunk 1 stillschweigend nicht gesehen (die findash-Seite,
// data-layer/druckenmiller.js und web/src/components/druckenmiller.tsx, prueft Chunk 5/6
// im eigenen Repo).
const SKRIPTE = fs.readdirSync(path.join(REPO, 'scripts'))
  .filter((f) => f.includes('druckenmiller') && f.endsWith('.js'))
  .map((f) => path.join(REPO, 'scripts', f));
const DATEIEN = fs.readdirSync(MODUL_DIR).filter((f) => f.endsWith('.js'))
  .map((f) => path.join(MODUL_DIR, f))
  .concat(SKRIPTE);

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + (e && e.message)); }
}

// Verbotene Bezeichner der gesperrten Klasse.
//
// REVIEW-FUND (Chunk 1): die Liste hatte vier Loecher, die ein Reviewer einzeln durch den
// Waechter geschickt hat — `row.waehrung` mit UMLAUT ("währung" stand nicht drin), `fx.rate`
// (nur 'fxrate' ohne Punkt stand drin), `row.exchange` und `row.exchangeTimezoneName` (nur
// 'exchangename'/'exchanges'). Seit [REV7-4] deckt dieser Waechter beide Skripte ab, also
// zaehlt jedes Loch doppelt. Ergaenzt: der Umlaut, 'exchange' als Stamm (schluckt
// exchangeName/exchanges/exchangeTimezoneName) und 'fx.'.
const VERBOTEN = [
  'currency', 'waehrung', 'w\u00e4hrung', 'fxrate', 'fx.', 'fxconverted', 'exchange',
  'listing', 'crossnotiz', 'kreuznotiz', 'isin', 'mic ',
];

// EINE benannte Ausnahme, exakt und begruendet: `_annualCurrencyLeakSuspect` ist der
// Name einer bestehenden Daten-Verdachts-LAMPE (pull-yahoo.js:4237), die D4 als
// Ausschluss-Kriterium nennt. Das Modul LIEST das Flag, es rechnet nichts um. Die
// Ausnahme ist genau dieser eine String — jede andere Schreibweise faellt weiter durch.
// Zweite Ausnahme (Chunk 1, gefunden beim ersten Lauf des erweiterten Globs): der
// stumpfe Teilstring-Test sieht in `Number.isInteger` das Wertpapier-Kennzeichen ISIN.
// Der Test bleibt bewusst stumpf — statt ihn mit Wortgrenzen zu verfeinern (was die
// echten Treffer aufweichen wuerde) wird genau dieser eine Bezeichner benannt.
// DRITTE Ausnahme, und die einzige, die inhaltlich etwas zu sagen hat: das Rats-Etikett
// (D7, woertlich) nennt "Währungen" — als AUSSAGE, dass dieses Modul sie NICHT behandelt.
// Genau der Satz, den F-16 verlangt, faellt sonst durch den F-16-Waechter. Ausgenommen ist
// die woertliche Wendung, nicht das Wort: `row.währungsKurs` faellt weiter durch (Test F2).
const AUSNAHMEN = ['_annualCurrencyLeakSuspect', 'annualCurrencyLeak', 'Number.isInteger',
  'Positionsgr\u00f6\u00dfen, Hebel, W\u00e4hrungen, Anleihen'];

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
  assert.ok(DATEIEN.length >= 5, 'der Waechter hat kaum Dateien gesehen — dann prueft er nichts');
  assert.ok(SKRIPTE.length >= 2, 'der Glob findet den Export-Schreiber nicht — dann ist er ungeprueft');
});

test('F2 BRUCHPROBE: derselbe Waechter faengt einen eingeschmuggelten Bezeichner', () => {
  const sabotage = "const kurs = row.tradingCurrency === 'EUR' ? umrechnen(x) : x;";
  const s = gesaeubert(sabotage);
  assert.ok(VERBOTEN.some((w) => s.includes(w)),
    'eine Zeile mit tradingCurrency laeuft durch — der Waechter ist Dekoration');
  // und die Ausnahme rettet NUR sich selbst, nicht ihre Nachbarschaft:
  assert.ok(!VERBOTEN.some((w) => gesaeubert('if (meta._annualCurrencyLeakSuspect) return "suspect";').includes(w)));
  assert.ok(VERBOTEN.some((w) => gesaeubert('const c = meta.reportingCurrency;').includes(w)));
  // Dasselbe fuer die zweite Ausnahme: sie rettet Number.isInteger, nicht die ISIN.
  assert.ok(!VERBOTEN.some((w) => gesaeubert('if (Number.isInteger(n)) return n;').includes(w)));
  assert.ok(VERBOTEN.some((w) => gesaeubert('const x = row.isinCode;').includes(w)),
    'eine echte ISIN laeuft durch — die Ausnahme ist zu breit');
  // Die vier Loecher, die ein Reviewer einzeln durch den alten Waechter geschickt hat:
  for (const sabotage of [
    'const w\u00e4hrung = row.fx;',
    'const w = row.w\u00e4hrungsKurs * x;',
    'const r = fx.rate;',
    'const e = row.exchange;',
    'const s = row.exchangeTimezoneName;',
  ]) {
    assert.ok(VERBOTEN.some((w) => gesaeubert(sabotage).includes(w)),
      'laeuft durch: ' + sabotage);
  }
  // Und das Rats-Etikett bleibt erlaubt — es sagt ja gerade, dass es KEINE Waehrungen gibt.
  const etikett = 'Ohne Positionsgr\u00f6\u00dfen, Hebel, W\u00e4hrungen, Anleihen.';
  assert.ok(!VERBOTEN.some((w) => gesaeubert(etikett).includes(w)),
    'das woertliche Rats-Etikett faellt durch den eigenen Waechter');
});

test('F3 der Suffix-Test bleibt ein String-Test — kein Zerlegen, kein Suffix-Katalog', () => {
  const zerlegung = [/split\(\s*['"]\./, /lastIndexOf\(\s*['"]\./, /match\(\s*\/\\\./, /\.pop\(\)/];
  const treffer = [];
  for (const datei of DATEIEN) {
    const s = fs.readFileSync(datei, 'utf8');
    for (const rx of zerlegung) if (rx.test(s)) treffer.push(path.basename(datei) + ' -> ' + rx);
  }
  assert.deepEqual(treffer, [], 'hier wird ein Ticker-Suffix zerlegt statt nur getestet: ' + treffer.join(' · '));
  const U = require('../lib/druckenmiller/universe.js');
  // Verhaltens-Gegenprobe: ein Suffix wird NICHT interpretiert, nur bemerkt.
  assert.equal(U.hasSuffix('GS.VI'), true);
  assert.equal(U.hasSuffix('GS.TO'), true);
  assert.equal(U.candidateReason({ ticker: 'GS.VI', country: 'United States' }, 300), 'suffix');
});

test('F4 U haengt am Vertragsfeld country und an nichts sonst', () => {
  const U = require('../lib/druckenmiller/universe.js');
  assert.equal(U.candidateReason({ ticker: 'AAA', country: 'United States' }, 300), null);
  assert.equal(U.candidateReason({ ticker: 'AAA', country: 'USA' }, 300), 'country',
    'kein Alias-Mapping: der Vertrag schreibt "United States", und nur das gilt');
  assert.equal(U.candidateReason({ ticker: 'AAA', country: null }, 300), 'country');
});

console.log('\nf16-guard.test.js: ' + pass + ' ok, ' + fail + ' fail');
process.exit(fail ? 1 : 0);

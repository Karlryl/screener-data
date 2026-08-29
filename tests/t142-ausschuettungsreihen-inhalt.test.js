'use strict';
/**
 * Waechter T142 (Master-Task-Inbox, @klasse:auto @art:bau) — die Ausschuettungs-Reihen
 * werden nach INHALT geschrieben, nicht nach LAENGE.
 *
 * BEFUND (gemessen 2026-08-29 im Rahmen von T142, gefixt 2026-08-30): in pull-yahoo.js
 * stand die Wache der drei F-1-Reihen auf `(ftsAnnualX || []).length > 0`, waehrend der
 * Kommentar daneben ausdruecklich "nur setzen wenn nicht leer" beanspruchte. Das ist nicht
 * dasselbe: `_ftsExtractByYear` schiebt fuer jedes Geschaeftsjahr OHNE Cash-Flow-Zeile einen
 * null-Platzhalter ein (Bug-#26-Muster, damit die Jahres-Indizes ausgerichtet bleiben). Eine
 * Reihe `[null, null, null]` hat also Laenge 3 und lief durch — das Feld landete durchgehend
 * leer im Schema und behauptete eine Abdeckung, die es nicht gibt.
 *
 * Am Live-Bestand gemessen (15.046 Snapshots, Vintage 2026-08-29):
 *     annualRepurchase              6.842 Null-Reihen gegen  7.237 mit Werten
 *     annualDividendsPaid           2.272 Null-Reihen gegen 11.807 mit Werten
 *     annualNetCommonStockIssuance  4.656 Null-Reihen gegen  9.423 mit Werten
 *
 * Dieselbe Laengen-statt-Inhalt-Klasse wie F-NY-001 (zwoelf Zeilen weiter unten in derselben
 * Datei) und wie der annualRevEnds-Fund aus T134 ("Feld VORHANDEN, aber LEER").
 *
 * WAS DIESER WAECHTER PINNT — die Sache, nicht ein Textmuster:
 *   1. die ECHTE Regel: `_nonNullCount` wird aus pull-yahoo.js IMPORTIERT und in beide
 *      Richtungen geprueft (leer/nur-null -> 0, mindestens ein Wert -> > 0). Ein Nachbau
 *      waere Fehler F1334 — die Wache wuerde gegen eine andere Regel messen als die,
 *      die spaeter wirklich entscheidet.
 *   2. die VERDRAHTUNG: die drei Zuweisungen `canonical.annual.<Feld> = fts<Feld>` liegen
 *      mitten im Netzwerkpfad von pullAll() und haben keinen aufrufbaren Einstieg (gleiche
 *      Lage und gleiche Begruendung wie tests/scoring/f1-ausschuettungsfelder.test.js:130).
 *      Geprueft wird deshalb die Bedingung, die VOR der jeweiligen Zuweisung steht — und
 *      zwar an der Zuweisung aufgesucht, nicht an einer Zeilennummer.
 *   3. die GEGENPROBE: derselbe Parser, auf die ALTE Fassung der Zeile angesetzt, muss rot
 *      werden. Ohne sie wuerde Punkt 2 auch dann gruen bleiben, wenn er gar nichts findet.
 *
 * Usage:  node tests/t142-ausschuettungsreihen-inhalt.test.js   (Exit 0/1), netzwerkfrei.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'pull-yahoo.js'), 'utf8');
const { _nonNullCount } = require('../pull-yahoo.js');

const FELDER = ['annualRepurchase', 'annualDividendsPaid', 'annualNetCommonStockIssuance'];

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + (e.stack || e.message)); }
}

/**
 * Sucht die Bedingung, die unmittelbar vor `canonical.annual.<feld> = <variable>` steht.
 * Anker ist die ZUWEISUNG (das Objekt), nicht eine Zeilennummer und nicht der Wortlaut der
 * Bedingung — deshalb ueberlebt der Waechter jede Umformatierung, die die Sache nicht aendert.
 * Rueckgabe: der Bedingungstext, oder null wenn die Zuweisung ohne `if (...)` davor steht.
 */
function bedingungVor(quelle, feld) {
  const variable = 'ftsAnnual' + feld.slice('annual'.length);
  const re = new RegExp(
    `if\\s*\\(([^\\n]*?)\\)\\s*canonical\\.annual\\.${feld}\\s*=\\s*${variable}\\s*;`,
  );
  const m = re.exec(quelle);
  if (m) return m[1].trim();
  // Zuweisung ohne vorangestellte Bedingung? Dann ist sie zwar vorhanden, aber ungewacht.
  const roh = new RegExp(`canonical\\.annual\\.${feld}\\s*=\\s*${variable}\\s*;`);
  assert.ok(roh.test(quelle),
    `${feld}: die Zuweisung canonical.annual.${feld} = ${variable} fehlt ganz — `
    + 'dann bekommt der Snapshot die Reihe nie (das prueft zusaetzlich der versiegelte '
    + 'tests/scoring/f1-ausschuettungsfelder.test.js).');
  return null;
}

// --- 1. Die ECHTE Regel, beide Richtungen ----------------------------------

test('_nonNullCount ist exportiert und zaehlt INHALT, nicht Laenge', () => {
  assert.equal(typeof _nonNullCount, 'function',
    '_nonNullCount muss aus pull-yahoo.js exportiert sein — sonst misst dieser Waechter '
    + 'einen Nachbau statt der Produktionsregel (F1334)');
  // ABWESENHEIT von Inhalt -> 0 (genau die Faelle, die frueher durchliefen)
  assert.equal(_nonNullCount(undefined), 0, 'undefined');
  assert.equal(_nonNullCount(null), 0, 'null');
  assert.equal(_nonNullCount([]), 0, 'leere Reihe');
  assert.equal(_nonNullCount([null, null, null]), 0,
    'DER Fall: drei Jahres-Platzhalter ohne einen einzigen Wert — Laenge 3, Inhalt 0');
  assert.equal(_nonNullCount([{ value: null }, { value: null }]), 0,
    'dieselbe Luecke in der {value}-Huelle (Bug-#26-Platzhalter)');
  // ANWESENHEIT von Inhalt -> > 0
  assert.equal(_nonNullCount([-300, null, -100]), 2,
    'echte Ausschuettungs-Reihe mit Luecke in der Mitte (Form aus _ftsExtractByYear)');
  assert.equal(_nonNullCount([null, null, -7]), 1, 'ein einziger Wert genuegt');
  assert.equal(_nonNullCount([0]), 1,
    'NULL EURO IST EINE ZAHL: eine Firma, die nachweislich nichts zurueckkauft, hat Daten — '
    + 'wer das wegfiltert, macht aus einer Aussage eine Luecke');
  assert.equal(_nonNullCount([{ value: 5 }, { value: null }]), 1, '{value}-Huelle mit einem Wert');
});

// --- 2. Die VERDRAHTUNG: alle drei Wachen zaehlen Inhalt --------------------

test('alle drei Ausschuettungs-Reihen werden ueber _nonNullCount gewacht, nicht ueber .length', () => {
  for (const feld of FELDER) {
    const bed = bedingungVor(SRC, feld);
    assert.ok(bed !== null,
      `${feld}: die Zuweisung steht ohne Wache da — ein leerer FTS-Cache schreibt dann `
      + 'unbesehen ins Schema.');
    assert.ok(/_nonNullCount\s*\(/.test(bed),
      `${feld}: die Wache benutzt _nonNullCount nicht (steht da: "${bed}") — dann misst sie `
      + 'wieder etwas anderes als der FTS-Merge daneben.');
    assert.ok(!/\.length\b/.test(bed),
      `${feld}: die Wache liest wieder die LAENGE (steht da: "${bed}") — genau der T142-Fund: `
      + '[null,null,null] hat Laenge 3 und schreibt ein durchgehend leeres Feld ins Schema.');
  }
});

// --- 3. GEGENPROBE: derselbe Parser wird an der ALTEN Fassung rot -----------

test('Gegenprobe (absichtlicher Bruch): die alte .length-Fassung faellt auf', () => {
  // Die alte Zeile wortwoertlich wieder eingesetzt — der Parser oben MUSS sie finden und
  // verwerfen. Ohne diese Probe koennte Test 2 auch dann gruen bleiben, wenn bedingungVor()
  // gar nichts mehr trifft.
  const alt = SRC.replace(
    /if\s*\([^\n]*?\)\s*canonical\.annual\.annualRepurchase\s*=\s*ftsAnnualRepurchase\s*;/,
    'if ((ftsAnnualRepurchase || []).length > 0)              '
    + 'canonical.annual.annualRepurchase = ftsAnnualRepurchase;',
  );
  assert.notEqual(alt, SRC, 'die Ersetzung hat nicht gegriffen — die Gegenprobe waere wirkungslos');
  const bed = bedingungVor(alt, 'annualRepurchase');
  assert.ok(bed !== null && /\.length\b/.test(bed) && !/_nonNullCount\s*\(/.test(bed),
    'der Parser muss die alte Laengen-Wache als solche erkennen');
});

test('Gegenprobe (absichtlicher Bruch): eine ganz fehlende Zuweisung faellt auf', () => {
  const ohne = SRC.replace(
    /if\s*\([^\n]*?\)\s*canonical\.annual\.annualDividendsPaid\s*=\s*ftsAnnualDividendsPaid\s*;/,
    '',
  );
  assert.notEqual(ohne, SRC, 'die Ersetzung hat nicht gegriffen');
  assert.throws(() => bedingungVor(ohne, 'annualDividendsPaid'),
    'eine verschwundene Zuweisung MUSS diesen Waechter rot machen');
});

console.log(`\nt142-ausschuettungsreihen-inhalt.test.js: ${pass} ok, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);

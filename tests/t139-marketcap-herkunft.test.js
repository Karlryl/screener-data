'use strict';
/**
 * Waechter T139 — das Messartefakt scripts/t139-marketcap-herkunft.js zaehlt die Sache,
 * nicht ein Textmuster.
 *
 * WARUM ER EXISTIERT: der Befund T139 ("7.226 von 8.313 Zeilen unterscheiden sich in
 * marketCap und in sonst gar nichts") ist zweimal an der MESSEBENE gescheitert, nicht an
 * der Rechnung — einmal am findash-Export, der die Perioden-Enden gar nicht fuehrt. Der
 * Zaehler selbst muss deshalb beweisbar zwischen "nur marketCap bewegt sich" und "ein
 * Kursfeld bewegt sich mit" unterscheiden, sonst ist jede Quote aus ihm wertlos.
 *
 * WAS GEPINNT WIRD:
 *   1. die Produktionsschwelle: mcapKlasseOf kommt aus src/scoring/score.js; ein Nachbau
 *      im Messskript wuerde stillschweigend abdriften (F1334).
 *   2. beide Richtungen des Zaehlers an einem hermetischen Vintage-Paar: eine Zeile, die
 *      NUR marketCap bewegt; eine, die priceSales mitbewegt; eine, die still steht.
 *   3. der Klassen-Kipp haengt am Wert, nicht an der Bewegung.
 *   4. Gegenprobe: waere die Kursfeld-Unterscheidung blind, MUSS dieser Waechter rot werden.
 *
 * Usage: node tests/t139-marketcap-herkunft.test.js   (Exit 0/1), netzwerkfrei, kein Substrat.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { mess, pitDiff, pruefeErgebnis } = require('../scripts/t139-marketcap-herkunft.js');
const { mcapKlasseOf, MCAP_KLASSEN_USD } = require('../src/scoring/score.js');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + (e.stack || e.message)); }
}

// --- hermetisches Vintage-Paar ------------------------------------------------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 't139-'));
function zeile(ticker, marketCap, priceSales, rank, fetchedAt) {
  return {
    rank, ticker, score: 50,
    pit: { marketCap, priceSales, fetchedAt: fetchedAt || '2026-08-01T00:00:00.000Z', beta: 1 },
  };
}
function schreibe(vintage, rows) {
  const dir = path.join(tmp, vintage);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'energy.json'), JSON.stringify({ date: vintage, cohort: { profitable: rows } }));
  // Nicht-Board-Dateien duerfen die Zeilenzahl nicht verfaelschen.
  fs.writeFileSync(path.join(dir, 'calibration.json'), JSON.stringify({ lineal: true }));
  return dir;
}
// NUR_MCAP: marketCap bewegt sich, sonst nichts im pit — aber der rank wandert (Zeilen-Ebene).
// MIT_PS: ein KURSFELD bewegt sich mit. MIT_FETCH: ein NICHT-Kursfeld (fetchedAt) bewegt sich
// mit — ohne diese Zeile ueberlebt eine Mutation, die "nur marketCap" als "priceSales steht
// still" fehldefiniert (Fund der Codex-Gegenpruefung). STILL: nichts bewegt sich.
// KIPP: marketCap bewegt sich ueber die micro/small-Grenze, Zeile sonst identisch.
const grenze = MCAP_KLASSEN_USD.micro;
const SPAETER = '2026-08-02T00:00:00.000Z';
const dirA = schreibe('2026-01-01', [
  zeile('NUR_MCAP', 1e9, 2, 1), zeile('MIT_PS', 1e9, 2, 2), zeile('STILL', 1e9, 2, 3),
  zeile('KIPP', grenze - 1, 2, 4), zeile('MIT_FETCH', 1e9, 2, 5),
]);
const dirB = schreibe('2026-01-02', [
  zeile('NUR_MCAP', 1.1e9, 2, 9), zeile('MIT_PS', 1.1e9, 2.2, 2), zeile('STILL', 1e9, 2, 3),
  zeile('KIPP', grenze + 1, 2, 4), zeile('MIT_FETCH', 1.1e9, 2, 5, SPAETER),
]);
const r = mess(dirA, dirB);

test('1. mcapKlasseOf stammt aus src/scoring/score.js, nicht aus einem Nachbau', () => {
  assert.equal(typeof mcapKlasseOf, 'function');
  const quelle = fs.readFileSync(path.join(__dirname, '..', 'scripts', 't139-marketcap-herkunft.js'), 'utf8');
  assert.ok(/require\([^)]*src['"],\s*['"]scoring['"],\s*['"]score\.js['"][^)]*\)/.test(quelle)
    || /mcapKlasseOf\s*\}\s*=\s*require/.test(quelle),
    'das Messskript muss die Klassen-Schwelle importieren, nicht nachbauen');
  assert.ok(!/MCAP_KLASSEN_USD\s*=\s*\{/.test(quelle), 'keine eigene Schwellen-Tabelle im Messskript');
});

test('2. Zaehler unterscheidet "nur marketCap" von "Kursfeld bewegt sich mit"', () => {
  assert.equal(r.gemeinsam, 5, 'calibration.json darf nicht als Board-Datei zaehlen');
  assert.equal(r.mcapGeaendert, 4);
  assert.equal(r.mcapUnveraendert, 1, 'die stillstehende Zeile');
  assert.equal(r.nurMcapImPit, 2, 'NUR_MCAP und KIPP — nicht MIT_PS, nicht MIT_FETCH');
  assert.equal(r.mcapGeaendertKursfelderIdentisch, 3, 'MIT_PS bewegt priceSales mit');
  assert.equal(r.mcapGeaendertFetchedAtIdentisch, 3, 'MIT_FETCH bewegt fetchedAt mit');
  assert.equal(r.mcapOhnePriceSales, 3);
  // Zeilen-Ebene: von den zwei nur-marketCap-Zeilen bleibt nur KIPP auch sonst gleich.
  // Ohne diese Erwartung ueberlebt eine Mutation, die den Zeilen-Diff ganz weglaesst.
  assert.equal(r.nurMcapUndZeileSonstIdentisch, 1, 'NUR_MCAP wandert im rank');
});

test('3. Klassen-Kipp haengt am WERT, nicht an der Bewegung', () => {
  assert.equal(r.klasseGekippt, 1, 'nur KIPP ueberschreitet die Grenze');
  assert.equal(r.klasseKippBeispiele[0].zeile, 'energy|profitable|KIPP');
  assert.equal(mcapKlasseOf(grenze - 1), 'micro');
  assert.equal(mcapKlasseOf(grenze + 1), 'small');
});

test('4. pitDiff vergleicht ANWESENHEIT und Wert, nicht die Serialisierung', () => {
  assert.deepEqual(pitDiff({ pit: { a: 1 } }, { pit: { a: 1, b: 2 } }), ['b']);
  assert.deepEqual(pitDiff({ pit: { a: 1 } }, { pit: { a: 1 } }), []);
  // Die drei Wege, auf denen JSON.stringify Ungleiches gleich macht:
  assert.deepEqual(pitDiff({ pit: { x: null } }, { pit: {} }), ['x'], 'null vs. fehlender Schluessel');
  assert.deepEqual(pitDiff({ pit: { x: -0 } }, { pit: { x: 0 } }), ['x'], '-0 vs. 0');
  assert.deepEqual(pitDiff({ pit: { x: NaN } }, { pit: { x: null } }), ['x'], 'NaN vs. null');
  // ... und der Weg, auf dem es Gleiches ungleich macht:
  assert.deepEqual(pitDiff({ pit: { o: { a: 1, b: 2 } } }, { pit: { o: { b: 2, a: 1 } } }), [],
    'Schluesselreihenfolge ist kein Unterschied');
});

test('5. Gegenprobe: eine kursfeld-blinde Zaehlung MUSS auffallen', () => {
  // Bewegt sich in der MIT_PS-Zeile NUR noch priceSales (marketCap steht), darf sie in
  // keinem der marketCap-Zaehler mehr auftauchen. Ein Zaehler, der pit-Felder nicht
  // einzeln aufloest, wuerde sie weiterhin mitzaehlen.
  const dirC = schreibe('2026-01-03', [
    zeile('NUR_MCAP', 1e9, 2, 1), zeile('MIT_PS', 1e9, 2.2, 2), zeile('STILL', 1e9, 2, 3),
    zeile('KIPP', grenze - 1, 2, 4), zeile('MIT_FETCH', 1e9, 2, 5),
  ]);
  const r2 = mess(dirA, dirC);
  assert.equal(r2.mcapGeaendert, 0, 'kein marketCap bewegt sich in diesem Paar');
  assert.equal(r2.nurMcapImPit, 0);
  assert.equal(r2.mcapUnveraendert, 5);
});

test('6. survival.json ist eine bewusste Weiche, kein stiller Ausschluss', () => {
  // survival.json traegt echte Kohorten-Zeilen (Pre-Revenue/Biotech). Der Default laesst sie
  // aus, damit die Zahl mit dem Ursprungsbefund vergleichbar bleibt — das MUSS sichtbar und
  // umschaltbar sein, sonst wandert eine Quote ohne ihren Geltungsbereich weiter.
  const dirS = path.join(tmp, '2026-02-01');
  fs.mkdirSync(dirS, { recursive: true });
  fs.writeFileSync(path.join(dirS, 'energy.json'), JSON.stringify({ cohort: { profitable: [zeile('NUR_MCAP', 1e9, 2, 1)] } }));
  fs.writeFileSync(path.join(dirS, 'survival.json'), JSON.stringify({ cohort: { profitable: [zeile('BIO', 1e9, 2, 1)] } }));
  const dirT = path.join(tmp, '2026-02-02');
  fs.mkdirSync(dirT, { recursive: true });
  fs.writeFileSync(path.join(dirT, 'energy.json'), JSON.stringify({ cohort: { profitable: [zeile('NUR_MCAP', 1.1e9, 2, 1)] } }));
  fs.writeFileSync(path.join(dirT, 'survival.json'), JSON.stringify({ cohort: { profitable: [zeile('BIO', 1.1e9, 2, 1)] } }));
  const ohne = mess(dirS, dirT);
  const mit = mess(dirS, dirT, { mitSurvival: true });
  assert.equal(ohne.survivalEnthalten, false);
  assert.equal(ohne.gemeinsam, 1, 'ohne Weiche bleibt die Survival-Zeile draussen');
  assert.equal(mit.survivalEnthalten, true);
  assert.equal(mit.gemeinsam, 2, 'mit Weiche zaehlt sie mit');
  assert.equal(mit.mcapGeaendert, 2);
});

test('7. "0 von 0" ist ein lauter Messausfall, kein gruener Lauf', () => {
  const leer = schreibe('2026-03-01', [zeile('NUR_HIER', 1e9, 2, 1)]);
  const anders = schreibe('2026-03-02', [zeile('NUR_DORT', 1e9, 2, 1)]);
  assert.equal(mess(leer, anders).gemeinsam, 0, 'die Lage, die laut werden muss');
  assert.throws(() => pruefeErgebnis(mess(leer, anders)), /Messausfall/,
    'ein Lauf ohne gemeinsame Zeilen darf NIE stumm durchgehen');
  // Gegenrichtung: ein Paar MIT gemeinsamen Zeilen darf die Wache nicht ausloesen.
  assert.equal(pruefeErgebnis(r).gemeinsam, 5);
});

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\nt139-marketcap-herkunft.test.js: ${pass} ok, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);

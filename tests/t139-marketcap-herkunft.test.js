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

const { mess, pitDiff, pruefeErgebnis, ladeVintage } = require('../scripts/t139-marketcap-herkunft.js');
const { spawnSync } = require('node:child_process');
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
  // Das Verhaeltnis ist NEU/ALT, nicht ALT/NEU — ohne diese Erwartung ueberlebt ein
  // vertauschter Quotient (1,1 wuerde still zu 0,909).
  assert.ok(Math.abs(r.verhaeltnis.max - 1.1) < 1e-9, `max muss 1,1 sein, ist ${r.verhaeltnis.max}`);
  assert.equal(r.verhaeltnis.n, 4);
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

test('8. die Wache haengt am CLI, nicht nur an der Funktion', () => {
  // Ohne diesen Test ueberlebt eine Mutation, die NUR den Aufruf von pruefeErgebnis() in
  // main() entfernt: Pruefung 7 wuerde weiter gruen bleiben und die CLI wieder Null-Quoten
  // mit Exit 0 ausgeben. Gemessen wird deshalb der Prozess-Exit, nicht die Funktion.
  const r2 = spawnSync(process.execPath,
    [path.join(__dirname, '..', 'scripts', 't139-marketcap-herkunft.js'), '--a', '2026-03-01', '--b', '2026-03-02'],
    { env: { ...process.env, T139_BOARD_ROOT: tmp }, encoding: 'utf8' });
  assert.equal(r2.status, 1, `die CLI muss bei 0 gemeinsamen Zeilen Exit 1 liefern (war ${r2.status})`);
  assert.match(r2.stderr, /Messausfall/);
  // Gegenrichtung: ein gueltiges Paar laeuft durch und gibt die Messung aus.
  const ok = spawnSync(process.execPath,
    [path.join(__dirname, '..', 'scripts', 't139-marketcap-herkunft.js'), '--a', '2026-01-01', '--b', '2026-01-02'],
    { env: { ...process.env, T139_BOARD_ROOT: tmp }, encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(JSON.parse(ok.stdout).gemeinsam, 5);
});

test('9. Abwesenheit wird nie als Stabilitaet gezaehlt', () => {
  const ohnePitA = path.join(tmp, '2026-04-01');
  const ohnePitB = path.join(tmp, '2026-04-02');
  for (const [d, mc] of [[ohnePitA, 1e9], [ohnePitB, 1.1e9]]) {
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'energy.json'), JSON.stringify({
      cohort: {
        profitable: [
          { rank: 1, ticker: 'OHNE_PIT', score: 1 },                       // gar kein pit
          { rank: 2, ticker: 'OHNE_MCAP', score: 1, pit: { priceSales: 2 } }, // pit ohne Marktwert
          { rank: 3, ticker: 'NULL_MCAP', score: 1, pit: { marketCap: mc === 1e9 ? 1e9 : null, priceSales: 2 } },
        ],
      },
    }));
  }
  const x = mess(ohnePitA, ohnePitB);
  assert.equal(x.gemeinsam, 3);
  assert.equal(x.paareOhnePit, 1, 'die Zeile ohne pit ist unmessbar, nicht unveraendert');
  assert.equal(x.mcapUnbrauchbar, 2, 'fehlender und null-Marktwert zaehlen beide als unbrauchbar');
  assert.equal(x.mcapGeaendert, 0, 'null ist kein neuer Marktwert');
  assert.equal(x.klasseGekippt, 0, 'small -> null ist kein Klassenwechsel');
  assert.equal(x.verhaeltnis.n, 0, 'ohne gueltiges Paar gibt es kein Verhaeltnis');
  assert.equal(x.anteilKlasseGekippt, null, '0/0 ist nicht bestimmbar, nicht 0 %');
  assert.throws(() => pruefeErgebnis(x), /ohne pit-Block/);
});

test('10. kaputte Kohorten-Liste und doppelter Schluessel gehen nie still durch', () => {
  const kaputtA = path.join(tmp, '2026-05-01');
  fs.mkdirSync(kaputtA, { recursive: true });
  fs.writeFileSync(path.join(kaputtA, 'energy.json'), JSON.stringify({ cohort: { profitable: [zeile('X', 1e9, 2, 1)] } }));
  fs.writeFileSync(path.join(kaputtA, 'tech.json'), JSON.stringify({ cohort: { profitable: { ticker: 'Y' } } }));
  const kaputtB = path.join(tmp, '2026-05-02');
  fs.mkdirSync(kaputtB, { recursive: true });
  fs.writeFileSync(path.join(kaputtB, 'energy.json'), JSON.stringify({ cohort: { profitable: [zeile('X', 1e9, 2, 1)] } }));
  fs.writeFileSync(path.join(kaputtB, 'tech.json'), JSON.stringify({ cohort: { profitable: { ticker: 'Y' } } }));
  const k = mess(kaputtA, kaputtB);
  assert.equal(k.kaputteEintraege, 2, 'eine Kohorte, die kein Array ist, wird gezaehlt');
  assert.throws(() => pruefeErgebnis(k), /keine Zeilenliste/);

  const doppelA = path.join(tmp, '2026-06-01');
  fs.mkdirSync(doppelA, { recursive: true });
  fs.writeFileSync(path.join(doppelA, 'energy.json'), JSON.stringify({
    cohort: { profitable: [zeile('X', 1e9, 2, 1), zeile('X', 2e9, 2, 2)] },
  }));
  assert.throws(() => ladeVintage(doppelA, false), /Doppelter Schluessel/,
    'stilles Ueberschreiben machte das Ergebnis von der Zeilenreihenfolge abhaengig');
});

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\nt139-marketcap-herkunft.test.js: ${pass} ok, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);

'use strict';
/**
 * Waechter fuer den taeglichen Mitschnitt der Ticker-Landkarte.
 *
 * Der Mitschnitt hat eine Eigenschaft, die ihn heikler macht als normalen Code:
 * ein Fehler ist NICHT nachtraeglich reparierbar. NASDAQ und SEC ueberschreiben ihre
 * Verzeichnisse taeglich; ein Tag, der falsch oder gar nicht geschrieben wurde, ist weg.
 * Die Waechter zielen deshalb auf genau die Fehler, die still bleiben wuerden.
 *
 * Usage:  node tests/ticker-map.test.js   (Exit 0/1)
 */
const assert = require('node:assert/strict');
const T = require('../scripts/snapshot-ticker-map.js');

let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); }
}

const NASDAQ_KOPF = 'Symbol|Security Name|Market Category|Test Issue|Financial Status|Round Lot Size|ETF|NextShares';
const OTHER_KOPF = 'ACT Symbol|Security Name|Exchange|CQS Symbol|ETF|Round Lot Size|Test Issue|NASDAQ Symbol';

const rohMit = (nasdaqZeilen, otherZeilen, sec) => ({
  nasdaq: [NASDAQ_KOPF, ...nasdaqZeilen, 'File Creation Time: 0728202614:00'].join('\n'),
  other: [OTHER_KOPF, ...otherZeilen, 'File Creation Time: 0728202614:00'].join('\n'),
  sec: JSON.stringify(sec || {}),
});

check('die ROHEN Kennzeichen bleiben erhalten, nicht das gefilterte Ergebnis', () => {
  // Der ganze Zweck: die Junk-Regel (isJunkSecurity) hat sich schon geaendert und wird es
  // wieder. Wer gefiltert archiviert, schreibt mit jeder Regel-Aenderung die Vergangenheit
  // um. Deshalb muessen ETF- und Test-Kennzeichen im Archiv stehen.
  const k = T.baueKarte(rohMit(
    ['AAPL|Apple Inc. - Common Stock|Q|N|N|100|N|N', 'TESTZ|Test Issue|Q|Y|N|100|N|N'],
    ['SPY|SPDR S&P 500 ETF Trust|P|SPY|Y|100|N|SPY'],
  ));
  assert.equal(k.get('AAPL').t, 'N');
  assert.equal(k.get('TESTZ').t, 'Y', 'Test-Kennzeichen muss erhalten bleiben');
  assert.equal(k.get('SPY').e, 'Y', 'ETF-Kennzeichen muss erhalten bleiben');
  assert.ok(k.has('TESTZ'), 'Junk darf NICHT weggefiltert werden — das entscheidet der spaetere Leser');
});

check('steht ein Symbol in beiden Dateien, gewinnt die echte Boerse', () => {
  const k = T.baueKarte(rohMit(
    ['XYZ|Doppel AG|Q|N|N|100|N|N'],
    ['XYZ|Doppel AG|N|XYZ|N|100|N|XYZ'],
  ));
  assert.equal(k.get('XYZ').b, 'N', 'otherlisted traegt NYSE/AMEX/ARCA und ist hier mehr wert');
});

check('die SEC ergaenzt die CIK, ohne den Namen zu ueberschreiben', () => {
  const k = T.baueKarte(rohMit(
    ['AAPL|Apple Inc. - Common Stock|Q|N|N|100|N|N'], [],
    { 0: { cik_str: 320193, ticker: 'AAPL', title: 'Apple Inc.' } },
  ));
  assert.equal(k.get('AAPL').c, '0000320193');
  assert.equal(k.get('AAPL').n, 'Apple Inc. - Common Stock', 'der Boersen-Name bleibt stehen');
});

check('SEC-Namen ohne Boersen-Eintrag bekommen einen eigenen Datensatz', () => {
  const k = T.baueKarte(rohMit([], [], { 0: { cik_str: 99, ticker: 'NURSEC', title: 'Nur bei der SEC' } }));
  assert.equal(k.get('NURSEC').b, 'SEC');
  assert.equal(k.get('NURSEC').c, '0000000099');
});

check('kaputtes SEC-JSON kippt nicht die ganze Karte', () => {
  const k = T.baueKarte({ nasdaq: [NASDAQ_KOPF, 'AAPL|Apple|Q|N|N|100|N|N'].join('\n'), other: '', sec: '{ kaputt' });
  assert.equal(k.size, 1, 'die Boersen-Eintraege muessen trotzdem ankommen');
});

check('diff erkennt neu, weg und geaendert — und verwechselt sie nicht', () => {
  const alt = new Map([['A', { n: 'A AG', b: 'Q' }], ['B', { n: 'B AG', b: 'Q' }]]);
  const neu = new Map([['A', { n: 'A AG', b: 'Q' }], ['C', { n: 'C AG', b: 'N' }], ['B', { n: 'B AG NEU', b: 'Q' }]]);
  const d = T.diff(alt, neu);
  assert.deepEqual(Object.keys(d.hinzu), ['C']);
  assert.deepEqual(d.weg, []);
  assert.deepEqual(Object.keys(d.geaendert), ['B']);
});

check('eine Umbenennung ist "geaendert", kein Paar aus weg+neu', () => {
  // Sonst laese sich ein blosser Namenszusatz spaeter wie eine Delistung plus Neunotiz —
  // und genau danach sucht der "frueher finden"-Katalog.
  const alt = new Map([['A', { n: 'Alt AG', b: 'Q' }]]);
  const d = T.diff(alt, new Map([['A', { n: 'Neu SE', b: 'Q' }]]));
  assert.equal(d.weg.length, 0);
  assert.equal(Object.keys(d.hinzu).length, 0);
  assert.equal(d.geaendert.A.n, 'Neu SE');
});

check('Abspielen von Grundbild + Tageszeilen ergibt den Stand von damals', () => {
  // Die Kernfaehigkeit: "welche Ticker gab es am 15.?" muss exakt beantwortbar sein.
  const grundbild = { A: { n: 'A AG', b: 'Q' }, B: { n: 'B AG', b: 'Q' } };
  const zeilen = [
    { datum: '2026-07-10', hinzu: { C: { n: 'C AG', b: 'N' } }, weg: [], geaendert: {} },
    { datum: '2026-07-15', hinzu: {}, weg: ['A'], geaendert: { B: { n: 'B SE', b: 'Q' } } },
    { datum: '2026-07-20', hinzu: { D: { n: 'D AG', b: 'Q' } }, weg: [], geaendert: {} },
  ];
  const am12 = T.zustandAus(grundbild, zeilen, '2026-07-12');
  assert.deepEqual([...am12.keys()].sort(), ['A', 'B', 'C'], 'am 12. gab es A, B und C');
  const am15 = T.zustandAus(grundbild, zeilen, '2026-07-15');
  assert.deepEqual([...am15.keys()].sort(), ['B', 'C'], 'A ist am 15. weg');
  assert.equal(am15.get('B').n, 'B SE');
  const heute = T.zustandAus(grundbild, zeilen);
  assert.deepEqual([...heute.keys()].sort(), ['B', 'C', 'D']);
});

check('ein wiederholter Lauf am selben Tag darf den Stand nicht verdoppeln', () => {
  // Der Job kann zweimal laufen (Nachlauf, workflow_dispatch). Haenge die Zeile blind an,
  // haengt der rekonstruierte Stand davon ab, WIE OFT der Job lief.
  const src = require('fs').readFileSync(require.resolve('../scripts/snapshot-ticker-map.js'), 'utf8');
  assert.ok(/filter\(\(z\) => z\.trim\(\) && !z\.includes\('"datum":"' \+ datum \+ '"'\)\)/.test(src),
    'die Tageszeile muss ersetzt statt angehaengt werden');
  assert.ok(/z\.datum < datum/.test(src),
    'der Vergleichsstand muss die HEUTIGE Zeile ausklammern, sonst diffed der zweite Lauf gegen sich selbst');
});

check('eine kaputte Quelle schreibt KEINEN Tag, statt einen leeren zu schreiben', () => {
  // NASDAQ liefert bei Wartung schon mal eine HTML-Seite mit HTTP 200. Ein leer
  // geschriebener Tag saehe spaeter aus wie ein Massen-Delisting.
  const src = require('fs').readFileSync(require.resolve('../scripts/snapshot-ticker-map.js'), 'utf8');
  const m = src.match(/neu\.size < (\d+)/);
  assert.ok(m, 'die Untergrenze fehlt');
  assert.ok(Number(m[1]) >= 1000, 'eine Untergrenze von ' + m[1] + ' faengt eine Wartungsseite nicht');
  assert.ok(/Tag NICHT geschrieben/.test(src), 'der Abbruch muss benennen, was er verhindert');
});

check('eine kaputte Zeile in einer Monatsdatei kippt nicht das Abspielen', () => {
  const fs = require('fs'), path = require('path'), os = require('os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tmap-'));
  fs.writeFileSync(path.join(dir, '2026-07.jsonl'),
    ['{"datum":"2026-07-01","hinzu":{},"weg":[],"geaendert":{}}', '{ kaputt', '',
      '{"datum":"2026-07-02","hinzu":{},"weg":[],"geaendert":{}}'].join('\n'));
  const z = T.alleZeilen(dir);
  fs.rmSync(dir, { recursive: true, force: true });
  assert.equal(z.length, 2);
});

check('die Zeilen kommen chronologisch, egal wie das Dateisystem sortiert', () => {
  const fs = require('fs'), path = require('path'), os = require('os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tmap2-'));
  fs.writeFileSync(path.join(dir, '2026-08.jsonl'), '{"datum":"2026-08-01","hinzu":{},"weg":[],"geaendert":{}}\n');
  fs.writeFileSync(path.join(dir, '2026-07.jsonl'), '{"datum":"2026-07-31","hinzu":{},"weg":[],"geaendert":{}}\n');
  const z = T.alleZeilen(dir);
  fs.rmSync(dir, { recursive: true, force: true });
  assert.deepEqual(z.map((x) => x.datum), ['2026-07-31', '2026-08-01']);
});

check('der Mitschnitt fasst picks-history NICHT an', () => {
  const src = require('fs').readFileSync(require.resolve('../scripts/snapshot-ticker-map.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/picks-history/.test(src));
});

check('der Tageslauf ruft den Mitschnitt auf UND committet ihn', () => {
  // Ohne diese beiden Zeilen laeuft das Skript nirgends oder schreibt in den Papierkorb
  // des Runners — beides sieht von aussen aus wie "es gibt halt keine Daten".
  const fs = require('fs'), path = require('path');
  const wf = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'daily-pull.yml'), 'utf8');
  assert.ok(wf.includes('node scripts/snapshot-ticker-map.js'), 'der Aufruf fehlt im Tageslauf');
  assert.ok(wf.includes('git add external-data/ticker-map/'), 'das Ergebnis wird nicht committet');
  const i = wf.indexOf('- name: Snapshot ticker map');
  assert.ok(i > 0);
  const bis = wf.indexOf('- name:', i + 10);
  // Kein continue-on-error: ein verpasster Tag ist nicht nachholbar und gehoert ins rote X.
  assert.ok(!/continue-on-error/.test(wf.slice(i, bis > 0 ? bis : undefined)),
    'ein verpasster Tag ist unwiederbringlich — der Schritt darf nicht stillschweigend scheitern');
  assert.ok(i < wf.indexOf('- name: Commit board-history vintage'),
    'der Schritt laeuft nach dem Commit — dann faengt der Commit ihn nicht');
});

console.log('\nticker-map: ' + pass + ' ok, ' + fail + ' fail');
process.exit(fail ? 1 : 0);

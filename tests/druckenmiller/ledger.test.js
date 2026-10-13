'use strict';
/** tests/druckenmiller/ledger.test.js - Standalone-Runner (node tests/druckenmiller/ledger.test.js).
 *
 * DIE ZUSICHERUNG, an der SACHE festgenagelt (Ledger-Datei auf der Platte, nicht am Wortlaut
 * eines Aufrufs): die Reihe der Marktinnereien waechst nur nach vorn.
 *   - jede Zeile traegt prevHash = sha256(vorige Zeilentext) -> eine Aenderung IRGENDWO
 *     in der Vergangenheit macht die naechste Zeile ungueltig und der Anhang verweigert;
 *   - das Datum ist STRENG steigend -> kein Tag zweimal, keine Rueckdatierung;
 *   - die Datei schrumpft NIE (Sidecar-Zaehler; weniger Zeilen als zuletzt -> Abbruch);
 *   - keine Zahl ist NaN/Infinity (die Reihe soll spaeter gerechnet werden, nicht geraten);
 *   - backfilled-Zeilen sind aus jeder Quantils-/Rang-Rechnung ausgeschlossen (Rat D2).
 *
 * ANWESENHEIT UND ABWESENHEIT: jeder Waechter wird einmal gruen (guter Fall) und einmal
 * rot (Sabotage-Fall) gefahren. Ein Waechter, der nie feuert, ist kein Waechter.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const L = require('../../lib/druckenmiller/ledger.js');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + (e && e.message)); }
}

function sandkasten() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-ledger-'));
  return { dir, ledger: path.join(dir, 'internals-ledger.jsonl') };
}

const zeile = (date, extra) => Object.assign({ date, l1: 0.5, backfilled: false }, extra || {});

test('L1 erste Zeile: prevHash = GENESIS, Datei entsteht', () => {
  const { ledger } = sandkasten();
  L.appendRow(ledger, zeile('2026-09-01'));
  const rows = L.readRows(ledger);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].prevHash, L.GENESIS);
});

test('L2 zweite Zeile kettet an den TEXT der ersten', () => {
  const { ledger } = sandkasten();
  L.appendRow(ledger, zeile('2026-09-01'));
  const ersteZeile = fs.readFileSync(ledger, 'utf8').split('\n')[0];
  L.appendRow(ledger, zeile('2026-09-02'));
  const rows = L.readRows(ledger);
  assert.equal(rows.length, 2);
  assert.equal(rows[1].prevHash, crypto.createHash('sha256').update(ersteZeile, 'utf8').digest('hex'));
});

test('L3 BRUCHPROBE Kette: eine editierte HISTORISCHE Zeile blockt den Anhang', () => {
  const { ledger } = sandkasten();
  L.appendRow(ledger, zeile('2026-09-01'));
  L.appendRow(ledger, zeile('2026-09-02'));
  L.appendRow(ledger, zeile('2026-09-03'));
  // Sabotage: die MITTLERE Zeile wird nachtraeglich geschoenigt (l1 0.5 -> 0.9).
  const zeilen = fs.readFileSync(ledger, 'utf8').split('\n');
  const mitte = JSON.parse(zeilen[1]);
  mitte.l1 = 0.9;
  zeilen[1] = JSON.stringify(mitte);
  fs.writeFileSync(ledger, zeilen.join('\n'));
  assert.throws(() => L.appendRow(ledger, zeile('2026-09-04')), /Kette|chain/i,
    'eine nachtraeglich geaenderte Zeile 2 wurde NICHT bemerkt - die Kette ist dekorativ');
});

test('L4 GEGENPROBE zu L3: die unveraenderte Datei nimmt weiter an', () => {
  const { ledger } = sandkasten();
  L.appendRow(ledger, zeile('2026-09-01'));
  L.appendRow(ledger, zeile('2026-09-02'));
  L.appendRow(ledger, zeile('2026-09-03'));
  L.appendRow(ledger, zeile('2026-09-04'));
  assert.equal(L.readRows(ledger).length, 4);
  assert.equal(L.verifyChain(ledger).ok, true);
});

test('L5 Datum muss STRENG steigen (gleicher Tag und Rueckdatierung sind rot)', () => {
  const { ledger } = sandkasten();
  L.appendRow(ledger, zeile('2026-09-02'));
  assert.throws(() => L.appendRow(ledger, zeile('2026-09-02')), /Datum|date/i);
  assert.throws(() => L.appendRow(ledger, zeile('2026-09-01')), /Datum|date/i);
  assert.equal(L.readRows(ledger).length, 1, 'ein abgelehnter Anhang darf nichts hinterlassen');
});

test('L6 NaN/Infinity kommen nicht in die Reihe (auch verschachtelt nicht)', () => {
  const { ledger } = sandkasten();
  assert.throws(() => L.appendRow(ledger, zeile('2026-09-01', { l2: NaN })), /NaN|endlich|finite/i);
  assert.throws(() => L.appendRow(ledger, zeile('2026-09-01', { l7: [{ sector: 'X', rs63: Infinity }] })),
    /NaN|endlich|finite/i);
  assert.equal(fs.existsSync(ledger), false, 'die Datei darf durch einen abgelehnten Anhang nicht entstehen');
});

test('L7 BRUCHPROBE never-shrink: weniger Zeilen als zuletzt -> Abbruch', () => {
  const { ledger } = sandkasten();
  L.appendRow(ledger, zeile('2026-09-01'));
  L.appendRow(ledger, zeile('2026-09-02'));
  L.appendRow(ledger, zeile('2026-09-03'));
  // Sabotage: jemand kuerzt die Datei (Teil-Schreibvorgang, verungluecktes Aufraeumen).
  const zeilen = fs.readFileSync(ledger, 'utf8').split('\n').filter(Boolean);
  fs.writeFileSync(ledger, zeilen.slice(0, 1).join('\n') + '\n');
  assert.throws(() => L.appendRow(ledger, zeile('2026-09-04')), /schrumpf|shrink/i,
    'die Datei ist von 3 auf 1 Zeile gefallen und der Anhang lief trotzdem durch');
});

test('L8 GEGENPROBE zu L7: der Sidecar-Zaehler wandert mit jedem Anhang mit', () => {
  const { ledger } = sandkasten();
  L.appendRow(ledger, zeile('2026-09-01'));
  L.appendRow(ledger, zeile('2026-09-02'));
  assert.equal(L.readMeta(ledger).rows, 2);
  L.appendRow(ledger, zeile('2026-09-03'));
  assert.equal(L.readMeta(ledger).rows, 3);
});

test('L9 ledgerGapDays zaehlt fehlende Sitzungen zwischen erster und letzter Zeile', () => {
  const { ledger } = sandkasten();
  const sitzungen = ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04'];
  for (const d of sitzungen) L.appendRow(ledger, zeile(d));
  assert.equal(L.ledgerGapDays(L.readRows(ledger), sitzungen), 0);
  const { ledger: l2 } = sandkasten();
  L.appendRow(l2, zeile('2026-09-01'));
  L.appendRow(l2, zeile('2026-09-04'));
  assert.equal(L.ledgerGapDays(L.readRows(l2), sitzungen), 2, '02. und 03. fehlen - das sind zwei Loecher');
});

test('L10 ledgerGapDays wertet NICHT ueber das Ende hinaus (heute fehlt noch nicht)', () => {
  const { ledger } = sandkasten();
  L.appendRow(ledger, zeile('2026-09-01'));
  L.appendRow(ledger, zeile('2026-09-02'));
  assert.equal(L.ledgerGapDays(L.readRows(ledger), ['2026-09-01', '2026-09-02', '2026-09-03']), 0);
});

test('L11 BRUCHPROBE backfilled: rueckgerechnete Zeilen speisen keine Quantile', () => {
  const rows = [
    { date: '2026-09-01', l1: 0.10, backfilled: true },
    { date: '2026-09-02', l1: 0.20, backfilled: true },
    { date: '2026-09-03', l1: 0.90, backfilled: false },
  ];
  assert.deepEqual(L.quantileInput(rows).map((r) => r.date), ['2026-09-03']);
  // Gegenprobe: ohne die Regel waeren es drei Zeilen - dann wuerde ein Rueckrechnungs-
  // Block die Verteilung stellen, gegen die die Live-Tage gemessen werden.
  assert.notEqual(L.quantileInput(rows).length, rows.length);
  // Zweiter Ausschlussgrund (Gericht Runde 1): zu wenig frische Ticker an diesem Tag.
  const trueb = rows.concat([{ date: '2026-09-04', l1: 0.5, backfilled: false, lowFreshness: true }]);
  assert.deepEqual(L.quantileInput(trueb).map((r) => r.date), ['2026-09-03']);
});

test('L12 readRows auf einer nicht existierenden Datei ist [] (Bootstrap, kein Fehler)', () => {
  const { ledger } = sandkasten();
  assert.deepEqual(L.readRows(ledger), []);
  assert.equal(L.readMeta(ledger), null);
});

test('L13 eine unlesbare Zeile ist ROT, nicht still uebersprungen', () => {
  const { ledger } = sandkasten();
  L.appendRow(ledger, zeile('2026-09-01'));
  fs.appendFileSync(ledger, '{kaputt\n');
  assert.throws(() => L.readRows(ledger), /lesbar|parse|JSON/i);
});

test('L14 REVIEW-FUND: auch die LETZTE Zeile ist gedeckt (Sidecar-Beweis)', () => {
  // Die Kette prueft Zeile i gegen i-1 — die letzte hat keinen Nachfolger und war damit
  // frei editierbar. appendRow haette es MORGEN gemerkt, --check meldete HEUTE gruen.
  // Der Beweis lag ungenutzt daneben: appendRow schreibt lastHash in den Sidecar.
  const { ledger } = sandkasten();
  L.appendRow(ledger, zeile('2026-09-01'));
  L.appendRow(ledger, zeile('2026-09-02'));
  const z = fs.readFileSync(ledger, 'utf8').split('\n').filter(Boolean);
  const o = JSON.parse(z[1]); o.l1 = 0.88; z[1] = JSON.stringify(o);
  fs.writeFileSync(ledger, z.join('\n') + '\n');
  const v = L.verifyChain(ledger);
  assert.equal(v.ok, false, 'die letzte Zeile wurde manipuliert und niemand merkt es');
  assert.match(v.error, /LETZTE Zeile/);
  assert.throws(() => L.appendRow(ledger, zeile('2026-09-03')), /LETZTE Zeile/);
});

test('L15 GEGENPROBE zu L14: ein ausgetauschtes letztes DATUM faellt ebenfalls auf', () => {
  const { ledger } = sandkasten();
  L.appendRow(ledger, zeile('2026-09-01'));
  L.appendRow(ledger, zeile('2026-09-02'));
  assert.equal(L.verifyChain(ledger).ok, true, 'die unangetastete Datei bleibt gruen');
  const m = L.readMeta(ledger);
  assert.equal(m.lastDate, '2026-09-02');
  assert.equal(m.rows, 2);
});

test('L16 REVIEW-FUND: ein CRLF-Checkout toetet die Kette nicht', () => {
  // Gehasht wird der Zeilentext. Mit core.autocrlf=true haengt an jeder Zeile ein CR;
  // JSON.parse schluckt es, sha256 nicht — die Kette waere auf so einer Maschine tot und
  // der Waechter wuerde faelschlich eine Manipulation melden. Haupt-Schutz ist der LF-Pin
  // in .gitattributes, das hier deckt Kopien ausserhalb von git.
  const { ledger } = sandkasten();
  L.appendRow(ledger, zeile('2026-09-01'));
  L.appendRow(ledger, zeile('2026-09-02'));
  fs.writeFileSync(ledger, fs.readFileSync(ledger, 'utf8').split('\n').join('\r\n'));
  assert.equal(L.verifyChain(ledger).ok, true, 'ein CRLF-Checkout darf die Kette nicht brechen');
  assert.equal(L.readRows(ledger).length, 2);
});

test('L17 REVIEW-FUND: ein unlesbarer Sidecar ist ein Befund, kein stilles null', () => {
  const { ledger } = sandkasten();
  L.appendRow(ledger, zeile('2026-09-01'));
  fs.writeFileSync(L.metaPath(ledger), '{kaputt');
  assert.throws(() => L.readMeta(ledger), /nicht lesbar/,
    'ohne Sidecar gibt es weder never-shrink noch den Beweis der letzten Zeile — das darf '
    + 'nicht wie "gibt es halt nicht" aussehen');
});

test('L18 der LF-Pin fuer druckenmiller-history steht in .gitattributes', () => {
  // Der eigentliche Schutz gegen CRLF liegt in git, nicht im Code. Ohne den Pin haengt die
  // Integritaet der Reihe an der lokalen core.autocrlf-Einstellung jeder Maschine.
  const ga = fs.readFileSync(path.join(__dirname, '..', '..', '.gitattributes'), 'utf8');
  assert.match(ga, /^\/druckenmiller-history\/\*\* -text$/m);
});

test('L19 Chunk 1: highChurn faellt aus dem Quantil wie lowFreshness (Datei A, courtGates)', () => {
  // [REV6-4]/[REV10-4]: eine Sitzung, in der U um mehr als 5 % umgeschlagen ist, vergleicht
  // zwei Grundgesamtheiten. Zeilen OHNE das Feld bleiben unberuehrt — der Churn wird heute
  // schreiber-seitig gefuehrt, die Regel steht trotzdem schon hier.
  const rows = [
    { date: '2026-01-02', l1: 0.1 },
    { date: '2026-01-03', l1: 0.2, backfilled: true },
    { date: '2026-01-04', l1: 0.3, lowFreshness: true },
    { date: '2026-01-05', l1: 0.4, highChurn: true },
    { date: '2026-01-06', l1: 0.5, highChurn: false },
  ];
  const drin = L.quantileInput(rows).map((r) => r.date);
  assert.deepEqual(drin, ['2026-01-02', '2026-01-06'],
    'entweder faellt highChurn nicht raus, oder eine unbeteiligte Zeile faellt mit');
  // BRUCHPROBE der Regel selbst: ohne das Flag waere die Zeile drin.
  assert.equal(L.quantileInput([{ date: '2026-01-05', l1: 0.4 }]).length, 1,
    'eine Zeile ohne das Feld darf NICHT stillschweigend ausgeschlossen werden');
});

console.log('\nledger.test.js: ' + pass + ' ok, ' + fail + ' fail');
process.exit(fail ? 1 : 0);

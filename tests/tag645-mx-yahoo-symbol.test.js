'use strict';
/**
 * Tag 645 — belegter Datenfehler 19.08.2026: 47 mexikanische Ticker fragten Yahoo
 * mit einem Schraegstrich vor der Klassen-/Serien-Kennung an (z.B. "GFNORTE/O.MX"),
 * den Yahoo nicht kennt -> 404 bei jedem Pull. Live gegen Yahoo verifiziert:
 *   "GFNORTE/O.MX"  -> KEIN Treffer
 *   "GFNORTEO.MX"   -> Treffer: "Grupo Financiero Banorte, Equity"
 *
 * normalizeYahooSymbol() ist der EINE Seam in pull-yahoo.js, durch den processOne()
 * jeden yahoo_symbol-Wert schickt, bevor irgendein Yahoo-Aufruf (quoteSummary,
 * quote, FTS) stattfindet. Dieser Waechter nagelt die SACHE fest (die Werte muessen
 * sich nachweislich unterscheiden), nicht ein Schreibmuster im Quelltext.
 *
 * Standalone runner (node <datei>, exit 0/1) — kein Netz, keine Framework-Abhaengigkeit.
 * Run: node tests/tag645-mx-yahoo-symbol.test.js
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { normalizeYahooSymbol, _silentErrorCounts, _resetSilentErrorCounts } = require('../pull-yahoo.js');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); }
}

// ── Kernfall: der live-verifizierte belegte Fehler ─────────────────────────────
test('GFNORTE/O.MX (Schraegstrich) wird zu GFNORTEO.MX normalisiert', () => {
  assert.equal(normalizeYahooSymbol('GFNORTE/O.MX'), 'GFNORTEO.MX');
});

test('Sabotage-Beweis: GFNORTE/O.MX und GFNORTEO.MX sind unterschiedliche Werte -- die Normalisierung ist es, die sie angleicht', () => {
  const mitSlash = 'GFNORTE/O.MX';
  const ohneSlash = 'GFNORTEO.MX';
  assert.notEqual(mitSlash, ohneSlash, 'Testvoraussetzung: die beiden Rohwerte muessen sich unterscheiden');
  assert.equal(normalizeYahooSymbol(mitSlash), ohneSlash);
});

// ── Gegenrichtung: eine Kennung OHNE Schraegstrich bleibt unveraendert ─────────
test('GFNORTEO.MX (bereits ohne Schraegstrich) bleibt unveraendert', () => {
  assert.equal(normalizeYahooSymbol('GFNORTEO.MX'), 'GFNORTEO.MX');
});

test('CEMEX/CPO.MX -> CEMEXCPO.MX (zweiter Realfall, mehrsegmentige Klassenkennung)', () => {
  assert.equal(normalizeYahooSymbol('CEMEX/CPO.MX'), 'CEMEXCPO.MX');
});

// ── Chirurgische Enge: der Guard darf NUR .MX-Kennungen mit Schraegstrich anfassen ──
test('Schraegstrich AUSSERHALB von .MX bleibt unangetastet (kein globaler Schraegstrich-Strip)', () => {
  assert.equal(normalizeYahooSymbol('AAPL/A'), 'AAPL/A');
  assert.equal(normalizeYahooSymbol('BRK/A.US'), 'BRK/A.US');
});

test('normale US-Dash-Form (BRK-B) und andere Boersen-Suffixe (.KS/.T/.L) laufen unveraendert durch', () => {
  assert.equal(normalizeYahooSymbol('BRK-B'), 'BRK-B');
  assert.equal(normalizeYahooSymbol('005930.KS'), '005930.KS');
  assert.equal(normalizeYahooSymbol('7203.T'), '7203.T');
  assert.equal(normalizeYahooSymbol('III.L'), 'III.L');
});

test('.MX-Kennung ohne Schraegstrich (die ueberwiegende Mehrheit) bleibt unveraendert', () => {
  assert.equal(normalizeYahooSymbol('WALMEX.MX'), 'WALMEX.MX');
});

// ── Review-Fund (silent-failure-hunter, Tag 645): NIE raten bei mehrdeutiger Form.
// Der belegte Fall hat immer GENAU EINEN Schraegstrich. Ein globaler Strip haette
// eine unbekannte Mehrfach-Schraegstrich-Form still auf einen GERATENEN Namen
// zusammengefaltet -- im schlimmsten Fall die Kennung einer ANDEREN Firma. Bei
// Mehrdeutigkeit lieber unveraendert durchreichen (bleibt 404, wie vor dem Fix)
// statt einen unbelegten Fall zu erraten.
test('zwei Schraegstriche (unbekannte/unbelegte Form) bleiben unangetastet -- kein Raten', () => {
  assert.equal(normalizeYahooSymbol('AB/CD/EF.MX'), 'AB/CD/EF.MX');
});

// ── Fail-loud-Zaehler (review-fund: eine WARN-Zeile allein geht in ~21k INFO-Zeilen
// pro Lauf unter). symbolsNormalized folgt exakt dem TASK-0.11-Muster der anderen
// Zaehler (z.B. manifestCheckpoint) -- ueber _silentErrorCounts()/_resetSilentErrorCounts()
// von aussen pruefbar, ohne dass processOne() (kein Netz-Mock in diesem Test) laufen muss.
test('symbolsNormalized-Zaehler ist im Laufzaehler-Objekt verankert und resetbar', () => {
  assert.ok('symbolsNormalized' in _silentErrorCounts(),
    'der Zaehler muss im Laufzaehler-Objekt stehen, sonst ist er von aussen nicht pruefbar');
  _resetSilentErrorCounts();
  assert.equal(_silentErrorCounts().symbolsNormalized, 0);
});

// ── Defensiv: kein Crash auf Nicht-Strings ─────────────────────────────────────
test('null/undefined/Zahl werden unveraendert durchgereicht (kein Crash)', () => {
  assert.equal(normalizeYahooSymbol(null), null);
  assert.equal(normalizeYahooSymbol(undefined), undefined);
  assert.equal(normalizeYahooSymbol(42), 42);
});

// ── Bestandsprobe an der ECHTEN watchlist.json. Die urspruengliche Fassung fror
// hier die am 19.08.2026 gegriffene Zahl 47 ein. Das ist die falsche Sache: die
// watchlist ist ein LEBENDER Bestand, den der taegliche Yahoo-Pull fortschreibt.
// Der Pull vom 20.08. (Commit 8ff70815f1) hat das Universum von 20.973 auf 17.719
// Zeilen abgeglichen und dabei zwei der 47 mitgenommen (MEGA/CPO.MX, NEXT/25.MX)
// -- ein regulaerer Bestandsabgleich, kein Defekt. Der eingefrorene Zaehler machte
// daraus ab dem 21.08. drei rote Tagesläufe am blockierenden pre-pull-Test-Gate.
// Festgenagelt wird deshalb die SACHE, nicht der Zaehlerstand:
//   (a) Anwesenheit -- es MUSS betroffene Zeilen geben, sonst prueft die Schleife
//       darunter stillschweigend nichts mehr und der Waechter wird zur Attrappe;
//   (b) jede einzelne davon ist .MX und wird schraegstrichfrei normalisiert.
test('watchlist.json: jede yahoo_symbol-Zeile mit Schraegstrich ist .MX und normalisiert schraegstrichfrei (Bestand nicht leer)', () => {
  const wlPath = path.join(__dirname, '..', 'watchlist.json');
  const wl = JSON.parse(fs.readFileSync(wlPath, 'utf8'));
  const betroffen = wl.stocks.filter(s => s && typeof s.yahoo_symbol === 'string' && s.yahoo_symbol.includes('/'));
  assert.ok(betroffen.length > 0,
    'kein einziger Schraegstrich-Fall mehr im Bestand -- diese Bestandsprobe pruefte damit nichts; '
    + 'entweder ist der Befund erledigt (dann Test bewusst entfernen) oder die watchlist ist kaputt');
  for (const s of betroffen) {
    assert.match(s.yahoo_symbol, /\.MX$/i, `unerwartete Nicht-.MX-Zeile mit Schraegstrich: ${s.ticker}`);
    const normalized = normalizeYahooSymbol(s.yahoo_symbol);
    assert.ok(!normalized.includes('/'), `${s.ticker}: "${s.yahoo_symbol}" -> "${normalized}" behaelt einen Schraegstrich`);
  }
});

console.log(fail === 0 ? '\nTag 645 MX-Schraegstrich: ALL PASS' : `\nTag 645 MX-Schraegstrich: ${fail} FAIL`);
process.exit(fail ? 1 : 0);

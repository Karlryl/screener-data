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
const { normalizeYahooSymbol } = require('../pull-yahoo.js');

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

// ── Defensiv: kein Crash auf Nicht-Strings ─────────────────────────────────────
test('null/undefined/Zahl werden unveraendert durchgereicht (kein Crash)', () => {
  assert.equal(normalizeYahooSymbol(null), null);
  assert.equal(normalizeYahooSymbol(undefined), undefined);
  assert.equal(normalizeYahooSymbol(42), 42);
});

// ── Gezaehlt statt geschaetzt: die reale watchlist.json trägt exakt 47 betroffene
// Zeilen (grep-verifiziert 19.08.2026). Dieser Test friert die Zahl ein UND beweist,
// dass jede einzelne davon nach der Normalisierung schraegstrichfrei ist.
test('watchlist.json: exakt 47 yahoo_symbol-Zeilen mit Schraegstrich, alle .MX, alle normalisieren schraegstrichfrei', () => {
  const wlPath = path.join(__dirname, '..', 'watchlist.json');
  const wl = JSON.parse(fs.readFileSync(wlPath, 'utf8'));
  const betroffen = wl.stocks.filter(s => s && typeof s.yahoo_symbol === 'string' && s.yahoo_symbol.includes('/'));
  assert.equal(betroffen.length, 47, 'erwartete Anzahl betroffener Zeilen laut Befund');
  for (const s of betroffen) {
    assert.match(s.yahoo_symbol, /\.MX$/i, `unerwartete Nicht-.MX-Zeile mit Schraegstrich: ${s.ticker}`);
    const normalized = normalizeYahooSymbol(s.yahoo_symbol);
    assert.ok(!normalized.includes('/'), `${s.ticker}: "${s.yahoo_symbol}" -> "${normalized}" behaelt einen Schraegstrich`);
  }
});

console.log(fail === 0 ? '\nTag 645 MX-Schraegstrich: ALL PASS' : `\nTag 645 MX-Schraegstrich: ${fail} FAIL`);
process.exit(fail ? 1 : 0);

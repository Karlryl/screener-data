// Tag 561 — SEC-Merge-Log in src/scoring/run-screener.js: zwei Sichtbarkeits-Loecher.
//
// (a) mergeSecIntoUniverse stieg bei fehlendem/leerem SEC-Store OHNE jede Ausgabe aus,
//     und die Erfolgszeile lief nur `if (keys > 0)`. Im Log war damit "0 Abdeckung"
//     nicht von "der Schritt lief gar nicht" zu unterscheiden — die Tag-520-Lehre.
//     Der geprueft Umfang (Universumsgroesse) fehlte in beiden Faellen komplett.
//
// (b) Die geloggte Trio-Zahl zaehlte LOCKERER als die produktive Regel: das Log
//     verlangte nur "irgendwo eine finite Zahl" in OpInc/Assets/CurrLiab (hasFiniteSeries),
//     die Achsen verlangen zusaetzlich Index 0 non-null und eine SEC-Reihe, die
//     mindestens so tief ist wie die Yahoo-Reihe (axes.js roicStabilitySource, useSec).
//     Gemessen: 81 nach Log-Regel, 74 wirklich wirksam. Beide Zahlen stehen jetzt
//     getrennt in der Zeile — und die wirksame kommt aus dem EXPORT, nicht aus einer
//     zweiten Kopie der Regel.
//
// Standalone-Runner, keine Frameworks, kein Netz, Temp-Fixtures.
// Run: node tests/scoring/tag561-sec-merge-log.test.js
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { mergeSecIntoUniverse } = require('../../src/scoring/run-screener.js');
const { roicStabilitySource } = require('../../src/scoring/axes.js');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.stack); }
}

// console.log einsammeln statt umleiten-und-hoffen: die Zeile IST das Pruefobjekt.
function fange(fn) {
  const zeilen = [];
  const orig = console.log;
  console.log = (...a) => zeilen.push(a.join(' '));
  try { fn(); } finally { console.log = orig; }
  return zeilen.filter((z) => z.includes('mergeSecIntoUniverse'));
}

const V = (a) => a.map((x) => (x == null ? null : { value: x }));

// Snapshot mit Yahoo-Jahresreihen der Laenge n (die Tiefe, gegen die useSec vergleicht).
const snap = (ticker, n) => ({
  meta: { ticker },
  annual: {
    annualOpInc: V(Array.from({ length: n }, (_, i) => 1000 + i)),
    annualBalance: Array.from({ length: n }, () => ({ totalAssets: 9000, currentLiabilities: 1000 })),
  },
  timeseries: {},
});

// TIEF: 5 SEC-Jahre, Index 0 belegt -> die Achsen nehmen SEC (wirksam).
// LOCH: Index 0 null -> hasFiniteSeries sagt weiterhin true (es gibt spaeter Zahlen),
//       die produktive Regel sagt nein. Genau die 81-vs-74-Luecke.
const STORE = {
  TIEF: {
    annualRev: V([9, 8, 7, 6, 5]),
    annualOpInc: V([500, 480, 460, 440, 420]),
    annualAssets: V([9000, 8800, 8600, 8400, 8200]),
    annualCurrentLiabilities: V([1000, 980, 960, 940, 920]),
  },
  LOCH: {
    annualRev: V([9, 8, 7, 6, 5]),
    annualOpInc: V([null, 480, 460, 440, 420]),
    annualAssets: V([null, 8800, 8600, 8400, 8200]),
    annualCurrentLiabilities: V([null, 980, 960, 940, 920]),
  },
};

function storeDatei() {
  const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tag561-')), 'sec-secannual.json');
  fs.writeFileSync(p, JSON.stringify(STORE), 'utf8');
  return p;
}

// ── (a) leerer/fehlender Store: die Zeile MUSS kommen, mit Umfang ────────────────
test('(a) kein Store -> genau eine Zeile, sagt 0 Namen UND nennt den geprueften Umfang', () => {
  const u = [snap('TIEF', 4), snap('LOCH', 4)];
  const zeilen = fange(() => mergeSecIntoUniverse(u, []));
  assert.equal(zeilen.length, 1, 'ein stiller return ist genau das Loch: nicht gelaufen sieht aus wie 0 Abdeckung');
  assert.match(zeilen[0], /0 Namen/);
  assert.match(zeilen[0], /fehlt|leer/i, 'die Zeile muss den GRUND nennen (Store fehlt/leer), nicht nur die 0');
  assert.match(zeilen[0], /2 Universum/, 'ohne den Scan-Umfang ist die 0 nicht einzuordnen (Tag-520-Lehre)');
});

test('(a) Store da, aber kein Ticker trifft -> 0 Abdeckung ist von "nicht gelaufen" unterscheidbar', () => {
  const u = [snap('FREMD1', 4), snap('FREMD2', 4)];
  const zeilen = fange(() => mergeSecIntoUniverse(u, [storeDatei()]));
  assert.equal(zeilen.length, 1);
  assert.equal(/fehlt|leer/i.test(zeilen[0]), false,
    'ein vorhandener Store mit 0 Treffern darf NICHT wie ein fehlender Store klingen');
  assert.match(zeilen[0], /2 Universum/);
});

// ── (b) voller Fixture-Store: die Zahlen folgen der produktiven Regel ────────────
test('(b) voller Store -> Trio nach Log-Regel 2, wirksam nach Achsen-Regel 1', () => {
  const u = [snap('TIEF', 4), snap('LOCH', 4)];
  const zeilen = fange(() => mergeSecIntoUniverse(u, [storeDatei()]));
  assert.equal(zeilen.length, 1);
  assert.match(zeilen[0], /roicTrio=2/, 'die lockere Zaehlung sieht beide Namen (irgendwo eine finite Zahl)');
  assert.match(zeilen[0], /wirksam=1/, 'wirksam ist nur TIEF — LOCH hat Index 0 null, die Achsen fallen auf Yahoo zurueck');
  assert.match(zeilen[0], /2 Universum/);
});

test('(b) die wirksam-Zahl deckt sich mit dem, was die Achsen tatsaechlich waehlen', () => {
  const u = [snap('TIEF', 4), snap('LOCH', 4)];
  fange(() => mergeSecIntoUniverse(u, [storeDatei()]));
  assert.equal(roicStabilitySource(u[0])._source, 'sec');
  assert.equal(roicStabilitySource(u[1])._source, 'yahoo',
    'Index 0 null -> die Achsen nehmen Yahoo, obwohl hasFiniteSeries true sagt');
});

test('(b) tiefere Yahoo-Reihe als SEC-Reihe -> die Achsen bleiben bei Yahoo, das Log auch', () => {
  // useSec verlangt opS.length >= opY.length. Yahoo mit 6 Jahren gegen 5 SEC-Jahre.
  const u = [snap('TIEF', 6)];
  const zeilen = fange(() => mergeSecIntoUniverse(u, [storeDatei()]));
  assert.equal(roicStabilitySource(u[0])._source, 'yahoo');
  assert.match(zeilen[0], /roicTrio=1/);
  assert.match(zeilen[0], /wirksam=0/);
});

// ── Anti-Drift: die produktive Regel darf nicht nachgebaut werden ────────────────
const SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'scoring', 'run-screener.js'), 'utf8');
test('Anti-Drift: run-screener liest roicStabilitySource, statt useSec zu kopieren', () => {
  assert.match(SRC, /roicStabilitySource/, 'ohne den Export waere die Zahl eine zweite, driftende Kopie');
  assert.equal(/useSec/.test(SRC), false,
    'die Quellenwahl-Regel gehoert genau einmal in axes.js — Kopien-Drift ist die Bugklasse dieses Tags');
});

console.log(`\ntag561-sec-merge-log.test.js: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);

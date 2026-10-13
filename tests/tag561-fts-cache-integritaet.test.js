// Tag 561: zwei Loecher im FTS-Pfad von pull-yahoo.js.
//
// PUNKT 1 — der Cache-Treffer uebernahm cached.payload.ftsQuarterly UNGEPRUEFT.
//   Gemessen am lokalen Bestand (fundamentals-cache/, Stand 03.08.2026):
//   2.044 von 5.054 Eintraegen (40 %) tragen die Verschiebung aus der Zeit VOR F-002
//   (revenueQ uebersprang null-Umsatz-Rows, opIncQ/grossProfitQ nicht) — die drei
//   Reihen sind dort ungleich lang, Index i meint in jeder Reihe ein anderes Quartal.
//   15 der 23 Namen aus dem Tag-559-Waechter sind darunter (CLDX rev=4 oi=5 gp=5,
//   TSHA rev=3 oi=7 gp=7, 3888.HK rev=1 oi=5 gp=5). Seit Tag 559 laeuft NRB-SK-001
//   auf der Gewinner-Umsatzreihe und prueft dann gegen ein FREMDES Quartals-GP/OpInc.
//
// PUNKT 2 — die Quartals-Nettoergebnis-Reihe las nur `r.netIncome`, waehrend die
//   Jahres-Seite (pull-yahoo.js ~:1687) drei Schluessel probiert. Rows, die Yahoo mit
//   grossem `NetIncome` oder als `netIncomeContinuousOperations` liefert, kamen als
//   null an. Seit Tag 559 entscheidet die Quartals-NI ueber die Buendel-DICHTE mit —
//   eine fehlende Reihe verschiebt dort die QUELLENWAHL, nicht nur eine Kennzahl.
//
// Standalone-Runner, keine Frameworks, kein Netz.
// Run: node tests/tag561-fts-cache-integritaet.test.js
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const PY = require('../pull-yahoo.js');
const { _quarterSeriesMisaligned, _mapFTSQuarterlyNI, mapFTSToQuarterly } = PY;

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.stack); }
}

const V = a => a.map(x => (x == null ? null : { value: x }));
const SRC = fs.readFileSync(path.join(__dirname, '..', 'pull-yahoo.js'), 'utf8');

// ── PUNKT 1 (a): ungleiche Laengen -> Cache verworfen, mit Meldung ───────────────
// ECHT: die Laengen stammen aus den lokalen Cache-Dateien, nicht aus einer erfundenen
// Konstellation. CLDX fuehrt 4 Umsatz- gegen 5 OpInc-/GP-Quartale.
test('(1a) CLDX-Cache-Form (rev=4 oi=5 gp=5): erkannt, und die Meldung nennt die drei Laengen', () => {
  const cached = {
    revenueQ: V([15000, 121000, 0, 730000]),
    opIncQ: V([-84435000, -87153000, null, -63857000, -62739000]),
    grossProfitQ: V([null, null, null, null, null]),
  };
  const meldung = _quarterSeriesMisaligned(cached);
  assert.ok(meldung, 'die Laengendrift muss erkannt werden — sonst rechnet NRB-SK-001 gegen ein fremdes Quartal');
  assert.match(String(meldung), /rev=4/);
  assert.match(String(meldung), /oi=5/);
  assert.match(String(meldung), /gp=5/);
});

test('(1a) TSHA (rev=3 oi=7 gp=7) und 3888.HK (rev=1 oi=5 gp=5) — beide echte Alt-Cache-Formen', () => {
  assert.ok(_quarterSeriesMisaligned({
    revenueQ: V([5485000, 1986000, 2302000]),
    opIncQ: V([null, -28300000, null, -26753000, -21421000, null, -19000000]),
    grossProfitQ: V([null, null, null, null, null, null, null]),
  }));
  assert.ok(_quarterSeriesMisaligned({
    revenueQ: V([2307412000]),
    opIncQ: V([null, null, 382658000, null, null]),
    grossProfitQ: V([null, null, 1853628000, null, null]),
  }));
});

test('(1a) auch die Extremform rev=5 oi=0 gp=0 (Geschwister komplett leer) faellt auf', () => {
  // 000776.SZ im lokalen Bestand. Nach F-002 kann mapFTSToQuarterly das nicht mehr
  // erzeugen (jede Row schreibt in ALLE drei Reihen) -> sicherer Alt-Cache-Nachweis.
  assert.ok(_quarterSeriesMisaligned({
    revenueQ: V([1, 2, 3, 4, 5]), opIncQ: [], grossProfitQ: [],
  }));
});

// ── PUNKT 1 (b): gleiche Laengen -> Cache wird genutzt wie bisher ────────────────
test('(1b) gleiche Laengen (MSFT rev=5 oi=5 gp=5) -> null, der Cache bleibt in Gebrauch', () => {
  assert.equal(_quarterSeriesMisaligned({
    revenueQ: V([82886000000, 81273000000, 77673000000, 76441000000, 70066000000]),
    opIncQ: V([38398000000, 38275000000, 37961000000, 34323000000, 32000000000]),
    grossProfitQ: V([56058000000, 55295000000, 53630000000, 52427000000, 48147000000]),
  }), null);
});

test('(1b) alle drei leer (8015.T rev=0 oi=0 gp=0) -> null, kein neuer Bypass fuer leere Caches', () => {
  assert.equal(_quarterSeriesMisaligned({ revenueQ: [], opIncQ: [], grossProfitQ: [] }), null);
});

test('(1b) Alt-Cache ganz ohne ftsQuarterly -> null (unveraendertes Verhalten, keine Neu-Fetch-Welle)', () => {
  assert.equal(_quarterSeriesMisaligned(undefined), null);
  assert.equal(_quarterSeriesMisaligned(null), null);
});

test('(1b) F-002-Invariante: FRISCH gemappte Quartale sind nie ungleich lang -> der Neu-Fetch heilt', () => {
  // Genau die Row-Mischung, an der die Vor-F-002-Verschiebung entstand: fehlender
  // Umsatz, fehlendes OpInc, fehlendes GP. Waere die Invariante hier verletzt, wuerde
  // der Waechter frische Daten verwerfen und eine Endlos-Neu-Fetch-Schleife bauen.
  const rows = [
    { date: '2024-03-31', totalRevenue: 100, grossProfit: 40, operatingIncome: 10 },
    { date: '2024-06-30', grossProfit: 45, operatingIncome: 12 },
    { date: '2024-09-30', totalRevenue: 120, grossProfit: 50 },
    { date: '2024-12-31', totalRevenue: 130 },
  ];
  assert.equal(_quarterSeriesMisaligned(mapFTSToQuarterly(rows)), null);
  assert.equal(_quarterSeriesMisaligned(mapFTSToQuarterly([])), null);
});

// ── PUNKT 1: Verdrahtung — der Fund muss den Neu-Fetch-Pfad wirklich ausloesen ────
// Der Verhaltenstest oben kann nicht sehen, ob die Pruefung im Produktivpfad haengt.
// Deshalb ein Check AM OBJEKT (der Cache-Vertrauensentscheidung), nicht an einem
// Schreibmuster: die Pruefung muss das Ergebnis in cacheBypassReason schreiben, und
// cacheBypassReason muss weiterhin useCache abschalten.
test('(1) Verdrahtung: der Cache-Treffer-Pfad ruft die Pruefung auf und setzt cacheBypassReason', () => {
  const call = SRC.match(/_quarterSeriesMisaligned\(cached\.payload\.ftsQuarterly\)/);
  assert.ok(call, 'die Pruefung laeuft nicht am Cache-Payload -> der Fix ist im Produktivpfad tot');
  const block = SRC.slice(SRC.indexOf('_quarterSeriesMisaligned(cached.payload.ftsQuarterly)'));
  assert.match(block.slice(0, 600), /cacheBypassReason\s*=/,
    'der Fund muss in cacheBypassReason landen — nur der schaltet den Cache ab');
});

test('(1) Verdrahtung: cacheBypassReason schaltet useCache ab (Neu-Fetch-Pfad)', () => {
  assert.match(SRC, /if \(cacheBypassReason\) \{[\s\S]{0,400}?useCache = false;/,
    'ohne useCache = false wuerde der kaputte Cache trotz Fund weiterbenutzt');
});

test('(1) Verdrahtung: der Fund wird gemeldet, mit Ticker (nicht still)', () => {
  const i = SRC.indexOf('_quarterSeriesMisaligned(cached.payload.ftsQuarterly)');
  const block = SRC.slice(i, i + 600);
  assert.match(block, /_log\('WARN'/, 'ein stiller Cache-Wurf ist genau die Bugklasse, die hier geschlossen wird');
  assert.match(block, /stock\.ticker/, 'die Meldung muss den Ticker nennen, sonst ist sie nicht nachverfolgbar');
});

// ── PUNKT 2: Quartals-Nettoergebnis, drei Schluessel wie auf der Jahres-Seite ────
test('(2) Row mit NUR grossem `NetIncome` -> der Wert kommt an (vorher: null)', () => {
  assert.deepEqual(_mapFTSQuarterlyNI([{ NetIncome: 4200 }]), [4200]);
});

test('(2) Gegenprobe: die ALTE Ein-Schluessel-Lesung liefert an derselben Row null', () => {
  const rows = [{ NetIncome: 4200 }];
  const alt = rows.slice().reverse().map(r => (r && r.netIncome != null ? r.netIncome : null));
  assert.deepEqual(alt, [null], 'genau hier verlor die Quartals-NI ihre Werte');
});

test('(2) alle drei Schluessel + snake_case, und die Reihenfolge bleibt newest-first', () => {
  // FTS liefert oldest-first; die Reihe muss gedreht ankommen, sonst steht sie im
  // Buendel-Merge index-verkehrt neben revenueQ.
  const rows = [
    { netIncomeContinuousOperations: 1 },   // aeltestes
    { NetIncome: 2 },
    { netIncome: 3 },                        // juengstes
  ];
  assert.deepEqual(_mapFTSQuarterlyNI(rows), [3, 2, 1]);
  assert.deepEqual(_mapFTSQuarterlyNI([{ net_income: 7 }]), [7], 'snake_case-Edge-Nodes (F-DP-041)');
});

test('(2) fehlende/leere Rows bleiben null bzw. leer — kein Fabrizieren', () => {
  assert.deepEqual(_mapFTSQuarterlyNI([{ totalRevenue: 5 }]), [null]);
  assert.deepEqual(_mapFTSQuarterlyNI([null]), [null]);
  assert.deepEqual(_mapFTSQuarterlyNI([]), []);
  assert.deepEqual(_mapFTSQuarterlyNI(undefined), []);
});

test('(2) Verdrahtung: der Produktivpfad benutzt den Helfer, nicht mehr die rohe .netIncome-Lesung', () => {
  assert.match(SRC, /ftsQuarterlyNI = _mapFTSQuarterlyNI\(fts\.quarterlyFin\)/,
    'sonst laeuft die Drei-Schluessel-Lesung im Pull gar nicht');
  assert.equal(/r\.netIncome != null \? r\.netIncome : null/.test(SRC), false,
    'die alte Ein-Schluessel-Lesung darf nicht zurueckkommen');
});

console.log(`\ntag561-fts-cache-integritaet.test.js: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);

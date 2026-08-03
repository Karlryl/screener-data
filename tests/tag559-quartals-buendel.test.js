// Tag 559 (Interleaving-Wurzel Teil 2): QUARTALS-Buendel-Merge in pull-yahoo.js.
//
// Die Jahresseite wurde am 25.06.2026 mit fba7f69f3f geheilt (mergeAnnualIncomeBundle:
// EINE Quelle fuer Rev/OpInc/GP/NI). Die Quartalsseite trug dieselbe Defektklasse
// weiter:
//   (a) die Gewinner-Zaehlung war NULL-BLIND — eine literale 0 zaehlte als Datum, also
//       traten nullgepolsterte quoteSummary-Quartale (Halbjahres-Melder JP/HK/CN/EU/SG)
//       als volle Quartale gegen die echten FTS-Quartale an und gewannen;
//   (b) netIncomeQ wurde BEDINGUNGSLOS aus FTS gesetzt, waehrend rev/opInc/gp dem
//       Zaehl-Vergleich folgten — gewann quoteSummary, stand ein FTS-Nettoergebnis
//       Index-fuer-Index neben quoteSummary-Umsatzquartalen.
//
// Alle Zahlen unten sind ECHTE Reihen aus dem lokalen Bestand (snapshots/ +
// fundamentals-cache/, Stand 03.08.2026), keine erfundenen Konstellationen.
//
// Standalone-Runner, keine Frameworks, kein Netz.
// Run: node tests/tag559-quartals-buendel.test.js
'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { _mergeQuarterBundle, _nonZeroCount } = require('../pull-yahoo.js');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.stack); }
}

// Wert-Serie in der Form, die die Pipeline traegt ({value:n}); null bleibt roh.
const V = a => a.map(x => (x == null ? null : { value: x }));
const raw = a => (a || []).map(x => (x == null ? null : (typeof x === 'number' ? x : x.value)));

// ── (b) Null-Blindheit: die literale 0 darf den Gewinner nicht mehr entscheiden ──
// ECHT: CLDX (Celldex). quoteSummary traegt [15.000, 121.000, 0, 730.000] — die 0 sitzt
// an der Stelle, an der FTS 730.000 fuehrt; die ganze Reihe ist danach um ein Quartal
// verrutscht. Alte Regel: nicht-null 4 (FTS) > nicht-null 4 (QS) ist FALSCH -> QS behielt
// die Reihe samt eingeschobener Null. Neue Regel: 4 echte gegen 3 echte -> FTS gewinnt.
const CLDX_QS = {
  revenueQ: V([15000, 121000, 0, 730000]),
  opIncQ: V([-84435000, -87153000, null, -63857000, -62739000]),
  grossProfitQ: V([null, null, null, null, null]),
  netIncomeQ: V([-78685000, -81317000, -67044000, -56600000]),
  revenueQEnds: [], grossProfitQEnds: [], opIncQEnds: [],
};
const CLDX_FTS = {
  revenueQ: V([15000, 121000, 730000, 695000]),
  opIncQ: V([-84435000, -87153000, null, -63857000, -62739000]),
  grossProfitQ: V([null, null, null, null, null]),
  netIncomeQ: V([-78685000, -81317000, -67044000, -56600000, -53796000]),
  revenueQEnds: [], grossProfitQEnds: [], opIncQEnds: [],
};

test('(b) CLDX: eine literale 0 zaehlt NICHT als Quartal -> FTS gewinnt, kein eingeschobener 0-Wert mehr', () => {
  const out = _mergeQuarterBundle(CLDX_QS, CLDX_FTS);
  assert.equal(out._source, 'fts',
    'FTS fuehrt 4 echte Quartale, quoteSummary nur 3 (die 4. ist eine Polsterungs-Null)');
  assert.deepEqual(raw(out.revenueQ), [15000, 121000, 730000, 695000]);
  assert.ok(!raw(out.revenueQ).includes(0), 'keine eingestreute Null mehr in der Umsatzreihe');
});

test('(b) dieselbe Konstellation unter der ALTEN, null-blinden Zaehlung waere bei quoteSummary geblieben', () => {
  const nonNull = a => (a || []).filter(v => v != null && (v.value != null || typeof v === 'number')).length;
  assert.equal(nonNull(CLDX_FTS.revenueQ), 4);
  assert.equal(nonNull(CLDX_QS.revenueQ), 4);   // die 0 zaehlte mit
  assert.equal(nonNull(CLDX_FTS.revenueQ) > nonNull(CLDX_QS.revenueQ), false,
    'genau hier scheiterte die alte Regel: 4 > 4 ist falsch, also behielt quoteSummary die Reihe mit der Null');
  assert.equal(_nonZeroCount(CLDX_QS.revenueQ), 3);
  assert.equal(_nonZeroCount(CLDX_FTS.revenueQ), 4);
});

// ECHT: TSHA (Taysha Gene Therapies). Hier entscheidet AUSSCHLIESSLICH die
// Null-Blindheit — die Buendel-Dichte kann nichts retten, weil quoteSummary mit vier
// nicht-null Eintraegen gegen drei von FTS vorne laege. Alte Regel: FTS 3 > QS 4 ist
// falsch -> quoteSummary behaelt [0, 5.485.000, 0, 1.986.000]. Neue Regel: 3 echte
// gegen 2 echte -> FTS gewinnt mit [5.485.000, 1.986.000, 2.302.000].
const TSHA_QS = {
  revenueQ: V([0, 5485000, 0, 1986000]),
  opIncQ: V([null, -28300000, null, -26753000, -21421000]),
  grossProfitQ: V([null, null, null, null, null]),
  netIncomeQ: V([-42410000, -27851000, -32733000, -26882000]),
  revenueQEnds: [], grossProfitQEnds: [], opIncQEnds: [],
};
const TSHA_FTS = {
  revenueQ: V([5485000, 1986000, 2302000]),
  opIncQ: V([null, -28300000, null, -26753000, -21421000]),
  grossProfitQ: V([null, null, null, null, null]),
  netIncomeQ: V([-42410000, -27851000, -32733000, -26882000, -21529000]),
  revenueQEnds: [], grossProfitQEnds: [], opIncQEnds: [],
};

test('(b) TSHA: hier entscheidet NUR die Null-Blindheit — 3 echte FTS-Quartale schlagen 2 echte + 2 Polster-Nullen', () => {
  const nonNull = a => (a || []).filter(v => v != null && (v.value != null || typeof v === 'number')).length;
  assert.equal(nonNull(TSHA_FTS.revenueQ) > nonNull(TSHA_QS.revenueQ), false,
    'alte Regel: 3 > 4 ist falsch, quoteSummary behielt die Reihe mit den zwei Nullen');
  const out = _mergeQuarterBundle(TSHA_QS, TSHA_FTS);
  assert.equal(out._source, 'fts');
  assert.deepEqual(raw(out.revenueQ), [5485000, 1986000, 2302000]);
  assert.ok(!raw(out.revenueQ).includes(0), 'keine Polster-Null mehr in der Umsatzreihe');
  assert.deepEqual(raw(out.netIncomeQ), [-42410000, -27851000, -32733000, -26882000, -21529000],
    'das Nettoergebnis folgt derselben Quelle wie der Umsatz');
});

test('_nonZeroCount: 0 und null zaehlen nicht, negative Werte (Verlustquartale) zaehlen, beide Wertformen', () => {
  assert.equal(_nonZeroCount([{ value: 0 }, { value: 5 }]), 1);
  assert.equal(_nonZeroCount([{ value: 0 }, { value: 0 }, null]), 0);
  assert.equal(_nonZeroCount([{ value: -84435000 }, { value: -62739000 }]), 2,
    'ein Verlustquartal ist ein Datum — sonst verlieren opInc/ni jede Stimme');
  assert.equal(_nonZeroCount([0, 7, null, 3]), 2, 'rohe Zahlen wie in ftsQuarterlyNI');
  assert.equal(_nonZeroCount(undefined), 0);
});

// ── (a) FTS-Quartalsumsatz unbrauchbar + quoteSummary mit Nullen ──────────────────
// ECHT: 3888.HK (Kingsoft). FTS fuehrt genau EIN Quartal (2.307.412.000), quoteSummary
// vier (eines davon 0). quoteSummary gewinnt also zu Recht — aber vorher wurde
// netIncomeQ TROTZDEM aus FTS gesetzt: eine 5-lange FTS-Reihe neben einer 4-langen
// quoteSummary-Umsatzreihe. Genau der Fremd-Einschub, den der Jahres-Fix beseitigt hat.
const KINGSOFT_QS = {
  revenueQ: V([357459620, 0, 341292746, 413039581]),
  opIncQ: V([56599514, null, 61200000, 70100000]),
  grossProfitQ: V([274172879, null, 260100000, 300400000]),
  netIncomeQ: V([78753993, null, 80100000, 91200000]),
  revenueQEnds: ['2026-03-31', '2025-12-31', '2025-09-30', '2025-06-30'],
  grossProfitQEnds: ['2026-03-31', '2025-12-31', '2025-09-30', '2025-06-30'],
  opIncQEnds: ['2026-03-31', '2025-12-31', '2025-09-30', '2025-06-30'],
};
const KINGSOFT_FTS = {
  revenueQ: V([2307412000]),
  opIncQ: V([null, null, 382658000, null, null]),
  grossProfitQ: V([null, null, 1853628000, null, null]),
  netIncomeQ: V([null, null, 532440000, null, null]),
  revenueQEnds: [], grossProfitQEnds: [], opIncQEnds: [],
};

test('(a) 3888.HK: quoteSummary gewinnt — das Ergebnis traegt KEINE FTS-Reihe mehr (auch nicht bei netIncomeQ)', () => {
  const out = _mergeQuarterBundle(KINGSOFT_QS, KINGSOFT_FTS);
  assert.equal(out._source, 'quoteSummary');
  assert.deepEqual(raw(out.netIncomeQ), [78753993, null, 80100000, 91200000],
    'netIncomeQ muss aus derselben Quelle wie revenueQ kommen — vorher stand hier die FTS-Reihe');
  assert.notDeepEqual(raw(out.netIncomeQ), raw(KINGSOFT_FTS.netIncomeQ));
  // Alle vier Wert-Reihen aus EINER Quelle: gleiche Laenge, gleicher Quartals-Index.
  for (const f of ['revenueQ', 'opIncQ', 'grossProfitQ', 'netIncomeQ']) {
    assert.equal(out[f].length, 4, f + ' muss die 4 Quartale der Gewinner-Quelle tragen');
  }
});

test('(a) Ends bleiben laengengleich zu ihrer Wert-Serie (A10/NRE-SC-001), auch wenn die Quelle keine fuehrt', () => {
  const out = _mergeQuarterBundle(KINGSOFT_QS, KINGSOFT_FTS);
  assert.equal(out.revenueQEnds.length, out.revenueQ.length);
  assert.equal(out.grossProfitQEnds.length, out.grossProfitQ.length);
  assert.equal(out.opIncQEnds.length, out.opIncQ.length);
  const fromFts = _mergeQuarterBundle(CLDX_QS, CLDX_FTS);
  assert.deepEqual(fromFts.revenueQEnds, [null, null, null, null],
    'FTS-Cache ohne Perioden-Enden -> ehrliche null-Serie in Serien-Laenge, kein Fabrizieren');
});

// ── NRB-SK-001 auf der Quartalsseite ─────────────────────────────────────────────
// ECHT: NTGY.MC (Naturgy). Die quoteSummary-Umsatzreihe traegt an Index 2 eine 0,
// waehrend fuer dasselbe Quartal ein Bruttoergebnis von 1.853.000.000 gemeldet ist.
// GP = Umsatz - COGS mit COGS >= 0: ein positives GP verlangt positiven Umsatz.
test('NRB-SK-001 quartalsweise: 0-Umsatz mit positivem GP im SELBEN Quartal wird null (unbekannt), nicht 0', () => {
  const qs = {
    revenueQ: V([5101000000, 4869000000, 0, 6954000000]),
    opIncQ: V([938000000, 1153000000, 870000000, 900000000]),
    grossProfitQ: V([1909000000, 2035000000, 1853000000, 1800000000]),
    netIncomeQ: V([530000000, 641000000, 506000000, 500000000]),
    revenueQEnds: [], grossProfitQEnds: [], opIncQEnds: [],
  };
  const fts = { revenueQ: [], opIncQ: [], grossProfitQ: [], netIncomeQ: [], revenueQEnds: [], grossProfitQEnds: [], opIncQEnds: [] };
  const out = _mergeQuarterBundle(qs, fts);
  assert.equal(out._source, 'quoteSummary');
  assert.deepEqual(raw(out.revenueQ), [5101000000, 4869000000, null, 6954000000],
    'das widersprochene Quartal wird unbekannt, die Nachbarn bleiben stehen');
});

test('NRB-SK-001 quartalsweise: ein echtes 0-Umsatz-Quartal OHNE Widerspruch bleibt 0 (Pre-Revenue-Biotech)', () => {
  const qs = {
    revenueQ: V([0, 0, 0, 0]),
    opIncQ: V([-12000000, -11000000, -10000000, -9000000]),
    grossProfitQ: V([0, 0, 0, 0]),
    netIncomeQ: V([-11000000, -10500000, -9800000, -8900000]),
    revenueQEnds: [], grossProfitQEnds: [], opIncQEnds: [],
  };
  const fts = { revenueQ: [], opIncQ: [], grossProfitQ: [], netIncomeQ: [], revenueQEnds: [], grossProfitQEnds: [], opIncQEnds: [] };
  const out = _mergeQuarterBundle(qs, fts);
  assert.deepEqual(raw(out.revenueQ), [0, 0, 0, 0],
    'kein neues Prinzip: nur das schon zugelassene GP/OpInc-Widerspruchskriterium raeumt Nullen weg');
});

// ── (a2) FTS wirklich leer: die dokumentierte GRENZE dieses Fixes ────────────────
// ECHT: 8015.T (Toyota Tsusho). FTS fuehrt gar keine Quartale, quoteSummary traegt
// [0, 2.967G, 0, 2.594G] mit einem Bruttoergebnis von 0 in ALLEN vier Quartalen. Es
// gibt keine zweite Quelle und keinen Widerspruch — die Nullen bleiben deshalb stehen.
// Der Fix beseitigt hier nur den quellfremden Rest, nicht die Nullen selbst. Der Test
// haelt diese Grenze fest, damit sie nicht mit "erledigt" verwechselt wird.
test('(a2) 8015.T: FTS leer + GP ueberall 0 -> Nullen bleiben (dokumentierte Grenze), aber kein FTS-Rest', () => {
  const qs = {
    revenueQ: V([0, 2967216000000, 0, 2593820000000]),
    opIncQ: [],
    grossProfitQ: V([0, 0, 0, 0]),
    netIncomeQ: [],
    revenueQEnds: [], grossProfitQEnds: [], opIncQEnds: [],
  };
  const fts = { revenueQ: [], opIncQ: [], grossProfitQ: [], netIncomeQ: [], revenueQEnds: [], grossProfitQEnds: [], opIncQEnds: [] };
  const out = _mergeQuarterBundle(qs, fts);
  assert.equal(out._source, 'quoteSummary');
  assert.deepEqual(raw(out.revenueQ), [0, 2967216000000, 0, 2593820000000],
    'GP ist hier ebenfalls 0 — kein Widerspruch, also kein Eingriff. Diese Klasse braucht datierte Quartale, keinen Merge-Fix.');
  assert.deepEqual(out.netIncomeQ, [], 'nichts aus der leeren FTS-Seite darf hier landen');
});

// ── (c) gesunde Konstellation: Ausgabe unveraendert (gepinnter Hash) ─────────────
// ECHT: MSFT. FTS fuehrt 5 volle Quartale, quoteSummary 4 — FTS gewinnt unter der
// alten wie unter der neuen Regel, und zwar mit demselben Ergebnis. Der Hash haelt
// die komplette Ausgabe fest (alle sieben Reihen + Quelle).
test('(c) MSFT: gesunde Konstellation -> Ausgabe byte-gleich zum gepinnten Stand', () => {
  const qs = {
    revenueQ: V([82886000000, 81273000000, 77673000000, 76441000000]),
    opIncQ: V([38398000000, 38275000000, 37961000000, 34323000000]),
    grossProfitQ: V([56058000000, 55295000000, 53630000000, 52427000000]),
    netIncomeQ: V([31778000000, 38458000000, 27747000000, 27233000000]),
    revenueQEnds: ['2026-03-31', '2025-12-31', '2025-09-30', '2025-06-30'],
    grossProfitQEnds: ['2026-03-31', '2025-12-31', '2025-09-30', '2025-06-30'],
    opIncQEnds: ['2026-03-31', '2025-12-31', '2025-09-30', '2025-06-30'],
  };
  const fts = {
    revenueQ: V([82886000000, 81273000000, 77673000000, 76441000000, 70066000000]),
    opIncQ: V([38398000000, 38275000000, 37961000000, 34323000000, 32000000000]),
    grossProfitQ: V([56058000000, 55295000000, 53630000000, 52427000000, 48147000000]),
    netIncomeQ: V([31778000000, 38458000000, 27747000000, 27233000000, 25824000000]),
    revenueQEnds: [], grossProfitQEnds: [], opIncQEnds: [],
  };
  const out = _mergeQuarterBundle(qs, fts);
  const sha = crypto.createHash('sha256').update(JSON.stringify(out)).digest('hex');
  assert.equal(sha, '6ee2d8dce7d1f7f7bb024c24608bdd538f88f5bbf3eab99954e7502cd58284ca',
    'die Ausgabe der gesunden Konstellation hat sich geaendert — jede Aenderung hier verschiebt Boards');
});

test('Eingaben werden nicht mutiert (die FTS-Seite ist oft das geparste Cache-Objekt)', () => {
  const qs = {
    revenueQ: V([100, 0, 300]), opIncQ: V([10, 20, 30]), grossProfitQ: V([40, 50, 60]),
    netIncomeQ: V([5, 6, 7]), revenueQEnds: [], grossProfitQEnds: [], opIncQEnds: [],
  };
  const fts = {
    revenueQ: V([100, 0, 300, 400]), opIncQ: V([10, 20, 30, 40]), grossProfitQ: V([40, 50, 60, 70]),
    netIncomeQ: V([5, 6, 7, 8]), revenueQEnds: [], grossProfitQEnds: [], opIncQEnds: [],
  };
  const before = JSON.stringify({ qs, fts });
  _mergeQuarterBundle(qs, fts);
  assert.equal(JSON.stringify({ qs, fts }), before);
});

// ── Verdrahtung: netIncomeQ darf NIE wieder an der Buendel-Entscheidung vorbei ────
// Der Verhaltenstest oben kann nicht sehen, ob jemand in pullAll erneut eine
// bedingungslose Zuweisung einbaut. Deshalb ein Check AM OBJEKT (dem Feld), nicht an
// einem Schreibmuster: jede Zuweisung an canonical.timeseries.netIncomeQ muss vom
// Buendel-Gewinner kommen.
const SRC = fs.readFileSync(path.join(__dirname, '..', 'pull-yahoo.js'), 'utf8');
test('Verdrahtung: jede Zuweisung an canonical.timeseries.netIncomeQ kommt aus dem Buendel-Gewinner', () => {
  const hits = SRC.match(/canonical\.timeseries\.netIncomeQ\s*=\s*[^;\n]+/g) || [];
  assert.equal(hits.length, 1, 'erwartet genau EINE Zuweisung; gefunden: ' + hits.length + ' -> ' + JSON.stringify(hits));
  assert.match(hits[0], /_qWinner\.netIncomeQ/,
    'netIncomeQ darf nicht wieder bedingungslos aus FTS gesetzt werden: ' + hits[0]);
});

test('Verdrahtung: der Quartals-Merge in pullAll ruft _mergeQuarterBundle auf (kein zweiter Zaehl-Vergleich)', () => {
  assert.ok(/_mergeQuarterBundle\(_qsQuarters, _ftsQuarters\)/.test(SRC),
    'der Aufruf im Voll-Pull fehlt — dann laeuft der Fix im Produktivpfad gar nicht');
  assert.equal(/_ftsRevQNonNull/.test(SRC), false,
    'der alte null-blinde Zaehl-Vergleich darf nicht zurueckkommen');
});

console.log(`\ntag559-quartals-buendel.test.js: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);

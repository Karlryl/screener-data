'use strict';
/** tests/druckenmiller/internals.test.js — Standalone-Runner.
 *
 * DIE ZUSICHERUNG: was in einer Ledger-Zeile als "Breite" steht, ist auf HANDNACHRECHENBAREN
 * Serien genau das, was die Operationalisierung §2 definiert — und es misst MARKT, nicht
 * CI-Durchsatz (Anklage A3, 2026-09-14): jede Zeile nennt den modalen Balken-Tag, den Anteil
 * abweichender Ticker und rechnet L1–L4 NUR auf der Teilmenge mit einem Balken am
 * Sitzungstag; die uebrigen werden gezaehlt, nicht stillschweigend mitgemittelt.
 *
 * Alle Zahlen hier sind von Hand gesetzt, damit ein Rechenfehler auffaellt und nicht die
 * Erwartung dem Code hinterherzieht.
 */
const assert = require('node:assert/strict');
const I = require('../../lib/druckenmiller/internals.js');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + (e && e.message)); }
}
const nah = (a, b, eps, msg) => assert.ok(Math.abs(a - b) < (eps || 1e-9), `${msg || ''} ${a} != ${b}`);

/** Serie mit n Balken, Schlusskurs f(i), Datumsstempel D0000..D9999 (sortierbar wie ISO). */
function serie(n, f, ende) {
  const bis = ende === undefined ? n - 1 : ende;
  const out = [];
  for (let i = 0; i <= bis; i++) out.push({ date: 'D' + String(i).padStart(4, '0'), close: f(i) });
  return out;
}
const TAG = (i) => 'D' + String(i).padStart(4, '0');

test('I1 tickerMetrics: SMA, 252-Hoch/Tief und 63-Tage-Rendite auf einer geraden Rampe', () => {
  // close = 100 + i, 300 Balken, Sitzung = letzter Balken (i = 299).
  const m = I.tickerMetrics(serie(300, (i) => 100 + i), TAG(299));
  assert.equal(m.bars, 300);
  assert.equal(m.close, 399);
  // SMA50 = Mittel von i=250..299 -> 100 + 274.5 ; SMA200 = Mittel i=100..299 -> 100 + 199.5
  nah(m.sma50, 374.5, 1e-9, 'sma50');
  nah(m.sma200, 299.5, 1e-9, 'sma200');
  assert.equal(m.high252, 399);
  assert.equal(m.low252, 100 + (299 - 251));
  // 63-Tage-Rendite: close(299)/close(236) - 1
  nah(m.ret63, 399 / 336 - 1, 1e-12, 'ret63');
  assert.equal(m.lastBarDate, TAG(299));
});

test('I2 tickerMetrics ohne Balken AM Sitzungstag -> null (kein Weiterschleppen von gestern)', () => {
  const s = serie(300, (i) => 100 + i);
  assert.equal(I.tickerMetrics(s, TAG(400)), null, 'ein Ticker ohne Balken heute darf heute nicht zaehlen');
  // ... aber ein historischer Sitzungstag wird korrekt aus der Vergangenheit gerechnet:
  const m = I.tickerMetrics(s, TAG(280));
  assert.equal(m.close, 380);
  assert.equal(m.bars, 281);
  assert.equal(m.lastBarDate, TAG(299), 'lastBarDate bleibt der LETZTE Balken des Tickers (Frische-Beleg)');
});

test('I3 tickerMetrics: zu wenige Balken -> die betroffenen Felder sind null, nicht 0', () => {
  const m = I.tickerMetrics(serie(120, (i) => 100 + i), TAG(119));
  assert.equal(m.bars, 120);
  assert.equal(m.sma200, null);
  assert.equal(m.high252, null);
  assert.ok(Number.isFinite(m.sma50));
});

test('I4 L1/L2: Anteil ueber der eigenen SMA — von Hand ausgezaehlt', () => {
  const rows = [
    { ticker: 'A', close: 10, sma50: 9, sma200: 8 },
    { ticker: 'B', close: 10, sma50: 11, sma200: 8 },
    { ticker: 'C', close: 10, sma50: 11, sma200: 12 },
    { ticker: 'D', close: 10, sma50: 9, sma200: null },
  ];
  nah(I.shareAbove(rows, 'sma50'), 2 / 4, 1e-12, 'L2');
  // D hat keine SMA200 -> nicht im Nenner (Abdeckung wird getrennt geloggt)
  nah(I.shareAbove(rows, 'sma200'), 2 / 3, 1e-12, 'L1');
  assert.equal(I.shareAbove([], 'sma50'), null, 'ohne Zeilen gibt es keinen Anteil, nur null');
});

test('I5 L3: Neue Hochs minus neue Tiefs mit dem eingefrorenen 3-%-Band', () => {
  const rows = [
    { close: 100, high252: 101, low252: 50 },   // 0.99 -> innerhalb 3 % des Hochs
    { close: 100, high252: 110, low252: 99 },   // am Tief (1.01) -> innerhalb 3 % des Tiefs
    { close: 100, high252: 130, low252: 60 },   // weder noch
    { close: 100, high252: null, low252: null },// keine 252 Balken -> zaehlt nicht mit
  ];
  nah(I.newHighsMinusLows(rows, 0.03), 1 / 3 - 1 / 3, 1e-12, 'Band 3 %');
  const rows2 = rows.concat([{ close: 100, high252: 100.5, low252: 40 }]);
  nah(I.newHighsMinusLows(rows2, 0.03), 2 / 4 - 1 / 4, 1e-12, 'ein Hoch mehr');
  nah(I.newHighsMinusLows(rows2, 0.001), 0 / 4 - 0 / 4, 1e-12, 'ein sehr enges Band trifft nichts mehr');
  assert.equal(I.newHighsMinusLows([{ close: 1, high252: null, low252: null }], 0.03), null);
});

test('I6 L4: zyklisch minus defensiv, gleich- UND kapitalgewichtet, mit sichtbarem Rest-Eimer', () => {
  const rows = [
    { sector: 'Industrials', ret63: 0.10, marketCap: 100 },
    { sector: 'Energy', ret63: 0.20, marketCap: 300 },
    { sector: 'Healthcare', ret63: 0.02, marketCap: 100 },
    { sector: 'Utilities', ret63: 0.04, marketCap: 100 },
    { sector: 'Technology', ret63: 0.90, marketCap: 999 }, // nicht zugeordnet — darf nirgends einfliessen
  ];
  const l4 = I.cyclicalsMinusDefensives(rows);
  nah(l4.ew, (0.10 + 0.20) / 2 - (0.02 + 0.04) / 2, 1e-12, 'L4 ew');
  nah(l4.cw, (0.10 * 100 + 0.20 * 300) / 400 - (0.02 * 100 + 0.04 * 100) / 200, 1e-12, 'L4 cw');
  assert.equal(l4.nCyclical, 2);
  assert.equal(l4.nDefensive, 2);
  assert.equal(l4.unassigned, 1);
});

test('I7 L4b: sein namentlicher Korb minus dem defensiven Korb, mit n', () => {
  const rows = [
    { sector: 'Industrials', industry: 'Trucking', ret63: 0.12, marketCap: 1 },
    { sector: 'Consumer Cyclical', industry: 'Residential Construction', ret63: 0.08, marketCap: 1 },
    { sector: 'Healthcare', industry: 'Biotechnology', ret63: 0.02, marketCap: 1 },
  ];
  const b = I.namedBasketSpread(rows);
  nah(b.value, (0.12 + 0.08) / 2 - 0.02, 1e-12);
  assert.equal(b.n, 2);
  assert.equal(I.namedBasketSpread([{ sector: 'Healthcare', ret63: 0.02 }]).value, null,
    'ohne einen einzigen Korb-Namen gibt es keinen Spread');
});

test('I8 L5: Revisions-Breite mit ausgewiesener Abdeckung', () => {
  const rows = [
    { netRevision30: 3 }, { netRevision30: -1 }, { netRevision30: 0 }, { netRevision30: null },
  ];
  const l5 = I.revisionBreadth(rows);
  nah(l5.value, 1 / 3, 1e-12, 'nur positive zaehlen, nur die Abgedeckten sind im Nenner');
  nah(l5.coverage, 3 / 4, 1e-12);
  assert.equal(I.revisionBreadth([{ netRevision30: null }]).value, null);
});

test('I9 L7: Sektor-RS gegen SPY, Rang und Persistenz gegen die Vorzeile', () => {
  const rows = [
    { sector: 'Energy', ret63: 0.20 }, { sector: 'Energy', ret63: 0.10 },
    { sector: 'Utilities', ret63: 0.01 }, { sector: 'Healthcare', ret63: -0.04 },
  ];
  const t = I.sectorRs(rows, 0.05);
  assert.deepEqual(t.map((r) => r.sector), ['Energy', 'Utilities', 'Healthcare']);
  nah(t[0].rs63, 0.15 - 0.05, 1e-12, 'Median von Energy ist 0.15');
  assert.equal(t[0].rank, 1);
  assert.equal(t[2].rank, 3);
  // Persistenz: identische Reihenfolge -> +1, umgedrehte -> -1
  assert.equal(I.rankPersistence(t, t), 1);
  const gedreht = [{ sector: 'Energy', rank: 3 }, { sector: 'Utilities', rank: 2 }, { sector: 'Healthcare', rank: 1 }];
  assert.equal(I.rankPersistence(t, gedreht), -1);
  assert.equal(I.rankPersistence(t, null), null, 'ohne Vorzeile gibt es keine Persistenz');
  // Unter drei gemeinsamen Sektoren gibt lib/spearman.js null zurueck — nicht eine
  // Scheinkorrelation aus zwei Punkten, die immer +-1 waere.
  assert.equal(I.rankPersistence(t.slice(0, 2), t.slice(0, 2)), null);
});

test('I10 L8: Fuehrungs-Verengung = kapitalgewichtet minus gleichgewichtet + Top-Dezil-Anteil', () => {
  const rows = [];
  for (let i = 0; i < 10; i++) rows.push({ ret63: 0.01, marketCap: 1 });
  rows.push({ ret63: 1.00, marketCap: 1000 }); // ein Riese traegt den Gewinn
  const l8 = I.leadershipNarrowing(rows);
  assert.ok(l8.capMinusEqual > 0.5, 'der Riese muss die Kapitalgewichtung nach oben ziehen');
  assert.ok(l8.topDecileShare > 0.9, 'fast der ganze Gewinn kommt aus dem obersten Dezil');
  nah(I.leadershipNarrowing([{ ret63: 0.1, marketCap: 1 }]).topDecileShare, 1, 1e-12);
  assert.equal(I.leadershipNarrowing([]).capMinusEqual, null);
});

test('I11 A3-WAECHTER: der modale Balken-Tag und der Anteil abweichender Ticker stehen in der Zeile', () => {
  const heute = TAG(299);
  const frisch = serie(300, (i) => 100 + i);
  const alt = serie(300, (i) => 100 + i).slice(0, 297); // letzter Balken 3 Sitzungen alt
  const kandidaten = new Map([
    ['A', { ticker: 'A', sector: 'Industrials', industry: null, marketCap: 1, netRevision30: 1 }],
    ['B', { ticker: 'B', sector: 'Healthcare', industry: null, marketCap: 1, netRevision30: 1 }],
    ['C', { ticker: 'C', sector: 'Industrials', industry: null, marketCap: 1, netRevision30: 1 }],
  ]);
  const serien = new Map([['A', frisch], ['B', frisch], ['C', alt]]);
  const roh = I.perTickerRows(kandidaten, serien, heute);
  assert.equal(roh.length, 3, 'auch der veraltete Ticker bekommt eine Roh-Zeile (Frische ist ein Befund)');
  assert.equal(roh.find((r) => r.ticker === 'C').atSession, false);
  const zeile = I.buildRow({ date: heute, rawRows: roh, backfilled: false, spyState: 'BULL',
    spyRet63: 0.05, iwmRet63: 0.07, prevRow: null, history: [] });
  assert.equal(zeile.barDateMode, heute);
  nah(zeile.mixedBarDateShare, 1 / 3, 1e-12, 'ein von drei Tickern ist nicht auf dem modalen Tag');
  assert.equal(zeile.nAtSession, 2);
  assert.equal(zeile.excludedNoBar, 1);
  assert.equal(zeile.universeSize, 3);
  // L1 laeuft NUR ueber die zwei frischen Ticker
  nah(zeile.l1, 1, 1e-12);
});

test('I11b Frische-Tor: freshShare, nExcludedStale und lowFreshness stehen in der Zeile', () => {
  const heute = TAG(299);
  const frisch = serie(300, (i) => 100 + i);
  const alt = serie(300, (i) => 100 + i).slice(0, 297);
  const bauen = (nAlt, nGesamt) => {
    const k = new Map(), ser = new Map();
    for (let i = 0; i < nGesamt; i++) {
      k.set('T' + i, { ticker: 'T' + i, sector: 'Industrials', marketCap: 1, netRevision30: 1 });
      ser.set('T' + i, i < nAlt ? alt : frisch);
    }
    return I.buildRow({ date: heute, rawRows: I.perTickerRows(k, ser, heute), backfilled: false,
      spyState: null, spyRet63: null, iwmRet63: null, prevRow: null, history: [] });
  };
  const knappDrueber = bauen(1, 100);   // 99 % frisch
  assert.equal(knappDrueber.lowFreshness, false);
  nah(knappDrueber.freshShare, 0.99, 1e-12);
  assert.equal(knappDrueber.nExcludedStale, 1);
  const knappDrunter = bauen(6, 100);   // 94 % frisch
  assert.equal(knappDrunter.lowFreshness, true, 'unter 95 % ist die Zeile eine Aussage ueber den Runner');
  nah(knappDrunter.freshShare, 0.94, 1e-12);
});

test('I12 GEGENPROBE zu I11: ohne veraltete Ticker ist der Anteil 0 und nichts wird ausgeschlossen', () => {
  const heute = TAG(299);
  const frisch = serie(300, (i) => 100 + i);
  const kandidaten = new Map([['A', { ticker: 'A', sector: 'Industrials', marketCap: 1, netRevision30: 1 }]]);
  const zeile = I.buildRow({
    date: heute, backfilled: false, spyState: null, spyRet63: null, iwmRet63: null, prevRow: null, history: [],
    rawRows: I.perTickerRows(kandidaten, new Map([['A', frisch]]), heute),
  });
  assert.equal(zeile.mixedBarDateShare, 0);
  assert.equal(zeile.excludedNoBar, 0);
});

test('I13 die Zeile traegt genau die eingefrorenen Felder — keins mehr, keins weniger', () => {
  const heute = TAG(299);
  const zeile = I.buildRow({
    date: heute, backfilled: true, spyState: 'BULL', spyRet63: 0.05, iwmRet63: 0.06, prevRow: null, history: [],
    rawRows: I.perTickerRows(
      new Map([['A', { ticker: 'A', sector: 'Industrials', marketCap: 1, netRevision30: 1 }]]),
      new Map([['A', serie(300, (i) => 100 + i)]]), heute),
  });
  assert.deepEqual(Object.keys(zeile), I.LEDGER_ROW_FIELDS);
  assert.equal(zeile.backfilled, true);
});

test('I14 keine Zahl der Zeile ist NaN, auch wenn ALLES fehlt', () => {
  const zeile = I.buildRow({ date: 'D0001', rawRows: [], backfilled: false, spyState: null,
    spyRet63: null, iwmRet63: null, prevRow: null, history: [] });
  const nan = [];
  (function walk(v, p) {
    if (typeof v === 'number' && !Number.isFinite(v)) nan.push(p);
    else if (Array.isArray(v)) v.forEach((x, i) => walk(x, p + '[' + i + ']'));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, p + '.' + k);
  })(zeile, 'row');
  assert.deepEqual(nan, [], 'ein leerer Tag muss null schreiben, nicht NaN');
  assert.equal(zeile.universeSize, 0);
});

test('I15 R-INT bleibt null, solange die Reihe kuerzer als 250 Live-Tage ist (Rat D3)', () => {
  const basis = { date: 'D9999', rawRows: [], backfilled: false, spyState: null, spyRet63: null,
    iwmRet63: null, prevRow: null };
  assert.equal(I.buildRow(Object.assign({}, basis, { history: [] })).rInt, null);
  const kurz = Array.from({ length: 249 }, (_, i) => ({ date: TAG(i), l1: 0.5, l2: 0.5, l3: 0, l4ew: 0, backfilled: false }));
  assert.equal(I.buildRow(Object.assign({}, basis, { history: kurz })).rInt, null,
    'der Zustand wird vor 250 geloggten Tagen NICHT veroeffentlicht — auch nicht als Zahl im Ledger');
});

console.log('\ninternals.test.js: ' + pass + ' ok, ' + fail + ' fail');
process.exit(fail ? 1 : 0);

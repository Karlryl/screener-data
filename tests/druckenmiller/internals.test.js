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
  // Der Korb muss die registrierte Mindestgroesse erreichen (Datei A: l4bMinBasketN = 20),
  // sonst ist der "Branchen-Spread" eine Handvoll Einzelaktien. Deshalb hier 20 Korb-Zeilen.
  const korb = [];
  for (let i = 0; i < I.L4B_MIN_BASKET; i++) {
    korb.push({ sector: 'Industrials', industry: i % 2 ? 'Trucking' : 'Residential Construction',
      ret63: i % 2 ? 0.12 : 0.08, marketCap: 1 });
  }
  const rows = korb.concat([{ sector: 'Healthcare', industry: 'Biotechnology', ret63: 0.02, marketCap: 1 }]);
  const b = I.namedBasketSpread(rows);
  nah(b.value, (0.12 + 0.08) / 2 - 0.02, 1e-12);
  assert.equal(b.n, I.L4B_MIN_BASKET);
  assert.equal(I.namedBasketSpread([{ sector: 'Healthcare', ret63: 0.02 }]).value, null,
    'ohne einen einzigen Korb-Namen gibt es keinen Spread');
});

test('I7b Chunk 1: der registrierte Mindestkorb wird ERZWUNGEN, nicht nur registriert', () => {
  // Klasse des Chunk-0-Befunds H1: eine eingefrorene Zahl, die nirgends greift, ist keine
  // Regel. Ein Korb knapp unter der Schwelle liefert KEINEN Wert — aber sein n bleibt
  // sichtbar, damit ein Leser "zu klein" von "gibt es nicht" unterscheiden kann.
  const def = { sector: 'Healthcare', industry: 'Biotechnology', ret63: 0.02, marketCap: 1 };
  const mach = (n) => {
    const rows = [def];
    for (let i = 0; i < n; i++) rows.push({ sector: 'Industrials', industry: 'Trucking', ret63: 0.12, marketCap: 1 });
    return I.namedBasketSpread(rows);
  };
  const knappDrunter = mach(I.L4B_MIN_BASKET - 1);
  assert.equal(knappDrunter.value, null, 'ein Korb unter der Mindestgroesse liefert trotzdem einen Wert');
  assert.equal(knappDrunter.n, I.L4B_MIN_BASKET - 1, 'die Korbgroesse muss sichtbar bleiben');
  assert.ok(Number.isFinite(mach(I.L4B_MIN_BASKET).value), 'genau auf der Schwelle muss es einen Wert geben');
  assert.equal(I.L4B_MIN_BASKET, 20, 'die Schwelle ist Datei A (councilD3.l4bMinBasketN) — nicht frei waehlbar');
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

test('I10 L8: Verengung und Top-Dezil, Dezilgroesse von Hand ausgezaehlt', () => {
  // Der alte Test prueft nur "> 0.9" — das gilt fuer JEDE Dezilgroesse von 1 bis 11 und
  // liess damit genau die Zeile ungeprueft, in der ein off-by-one plausibel waere
  // (Review-Fund). 20 Zeilen, Dezil = ceil(20/10) = 2, alle Werte handverlesen:
  const rows = [];
  for (let i = 0; i < 14; i++) rows.push({ ret63: 0.01, marketCap: 1 });   // 14 kleine Gewinner
  rows.push({ ret63: 0.50, marketCap: 1 }, { ret63: 0.30, marketCap: 1 }); // die beiden groessten
  for (let i = 0; i < 4; i++) rows.push({ ret63: -0.05, marketCap: 1 });   // 4 Verlierer
  const l8 = I.leadershipNarrowing(rows);
  assert.equal(l8.nWinners, 16);
  // Summe der Gewinne = 14*0.01 + 0.50 + 0.30 = 0.94 ; Top-2 = 0.80
  nah(l8.topDecileShare, 0.80 / 0.94, 1e-12, 'Top-Dezil von 20 Zeilen sind genau 2');
});

test('I10b BRUCHPROBE Saettigung: weniger Gewinner als Dezilgroesse -> null statt 1', () => {
  // Der Anteil wird ueber die GEWINNER gebildet, das Dezil ueber U. Sind weniger Titel im
  // Plus als das Dezil gross ist, umfasst "das oberste Dezil" alle Gewinner und der Wert
  // waere konstruktionsbedingt 1 — ausgerechnet an den Tagen, an denen die Frage nach der
  // Verengung interessant ist. Zwei voellig verschiedene Tage haetten dieselbe 1 geloggt.
  const wenige = [];
  for (let i = 0; i < 95; i++) wenige.push({ ret63: -0.02, marketCap: 1 });
  for (let i = 0; i < 5; i++) wenige.push({ ret63: 0.10, marketCap: 1 });
  const l8 = I.leadershipNarrowing(wenige);
  assert.equal(l8.topDecileShare, null, '5 Gewinner bei Dezilgroesse 10 sind nicht messbar, nicht 1');
  assert.equal(l8.nWinners, 5, 'die Zahl der Gewinner steht daneben, damit der Grund lesbar ist');
  // Gegenprobe: genug Gewinner -> echter Wert
  const viele = [];
  for (let i = 0; i < 40; i++) viele.push({ ret63: 0.01, marketCap: 1 });
  for (let i = 0; i < 60; i++) viele.push({ ret63: -0.01, marketCap: 1 });
  assert.ok(Number.isFinite(I.leadershipNarrowing(viele).topDecileShare));
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
  assert.equal(zeile.nCandidates, 3);
  assert.equal(zeile.universeSize, 2, 'U ist die Menge, auf der die Achsen rechnen');
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

test('I16 REVIEW-FUND: unter 250 Balken faellt ein Ticker aus ALLEN Achsen (Rat D4)', () => {
  // Reproduziert an den echten Saat-Daten: 86 von 2.288 Tickern lagen darunter, 69 davon
  // mit einer 63-Tage-Rendite — sie sassen in L4, L4b, L7 und L8, obwohl D4 sie ausschliesst.
  const heute = TAG(299);
  const lang = serie(300, () => 100);            // 300 Balken, flach
  const kurz = serie(300, (i) => (i < 200 ? 100 : 100)).slice(200); // nur 100 Balken
  // kurz endet am selben Tag, hat aber < 250 Balken:
  const kurzAmTag = serie(300, () => 50).slice(200);
  const k = new Map([
    ['LANG', { ticker: 'LANG', sector: 'Industrials', marketCap: 1, netRevision30: 1 }],
    ['KURZ', { ticker: 'KURZ', sector: 'Industrials', marketCap: 1, netRevision30: 1 }],
  ]);
  const zeile = I.buildRow({ date: heute, backfilled: false, spyState: null, spyRet63: 0,
    iwmRet63: null, prevRow: null, history: [],
    rawRows: I.perTickerRows(k, new Map([['LANG', lang], ['KURZ', kurzAmTag]]), heute) });
  assert.equal(zeile.nAtSession, 2, 'beide haben einen Balken am Sitzungstag');
  assert.equal(zeile.excludedFewBars, 1);
  assert.equal(zeile.universeSize, 1, 'nur LANG erfuellt die 250-Balken-Regel');
  assert.ok(!kurz.length || true);
});

test('I17 REVIEW-FUND: ein Kandidat OHNE Preisserie verschwindet nicht mehr lautlos', () => {
  // Vorher bekam er gar keine Zeile: nicht in universeSize, nicht in excludedNoBar, nicht
  // im Frische-Anteil. Ein fehlender Preis-Shard schrumpfte U still, und die Tageszeile sah
  // kerngesund aus (freshShare 1,0).
  const heute = TAG(299);
  const k = new Map([
    ['A', { ticker: 'A', sector: 'Industrials', marketCap: 1, netRevision30: 1 }],
    ['OHNE', { ticker: 'OHNE', sector: 'Industrials', marketCap: 1, netRevision30: 1 }],
  ]);
  const roh = I.perTickerRows(k, new Map([['A', serie(300, (i) => 100 + i)]]), heute);
  assert.equal(roh.length, 2, 'auch der Ticker ohne Serie bekommt eine Roh-Zeile');
  const zeile = I.buildRow({ date: heute, rawRows: roh, backfilled: false, spyState: null,
    spyRet63: 0, iwmRet63: null, prevRow: null, history: [], snapshotUnreadable: 3 });
  assert.equal(zeile.nCandidates, 2);
  assert.equal(zeile.nNoSeries, 1);
  assert.equal(zeile.universeSize, 1);
  assert.equal(zeile.nSnapshotUnreadable, 3, 'unlesbare Snapshots werden gezaehlt, nicht verschluckt');
  assert.equal(zeile.freshShare, 1, 'die Frische misst nur Ticker MIT Serie — der Rest steht in nNoSeries');
});

test('I18 REVIEW-FUND: ohne SPY gibt es kein L7 — nicht die absolute Sektor-Rendite', () => {
  const rows = [{ sector: 'Energy', ret63: 0.20 }, { sector: 'Utilities', ret63: 0.01 },
    { sector: 'Healthcare', ret63: -0.04 }];
  assert.deepEqual(I.sectorRs(rows, null), [], 'relative Staerke ohne Referenz gibt es nicht');
  assert.deepEqual(I.sectorRs(rows, undefined), []);
  assert.equal(I.sectorRs(rows, 0.05).length, 3, 'Gegenprobe: mit SPY entsteht die Tabelle');
});

test('I19 REVIEW-FUND: bei Gleichstand entscheidet der Name, nicht die Einlesereihenfolge', () => {
  const a = [{ sector: 'Zulu', ret63: 0.1 }, { sector: 'Alpha', ret63: 0.1 }, { sector: 'Mike', ret63: 0.1 }];
  const b = [{ sector: 'Mike', ret63: 0.1 }, { sector: 'Zulu', ret63: 0.1 }, { sector: 'Alpha', ret63: 0.1 }];
  assert.deepEqual(I.sectorRs(a, 0).map((r) => r.sector), I.sectorRs(b, 0).map((r) => r.sector),
    'derselbe Datenstand ergibt zwei verschiedene Rangvektoren — l7Persistence haengt daran');
  assert.deepEqual(I.sectorRs(a, 0).map((r) => r.sector), ['Alpha', 'Mike', 'Zulu']);
});

test('I20 REVIEW-FUND: R-INT ist ein echter Rang-Mittelwert, keine hartkodierte 0', () => {
  // Vorher: `liveTage >= 250 ? 0 : null`. In rund 250 Handelstagen haette die Reihe
  // angefangen, eine plausible neutrale Null zu schreiben, die niemand spaeter von einer
  // Messung unterscheiden koennte. Der alte Test pinnte nur die null-Seite.
  assert.equal(I.percentileRank([1, 2, 3, 4], 4), 0.875);
  assert.equal(I.percentileRank([1, 1, 1], 1), 0.5, 'Gleichstand bekommt den Mittelrang');
  assert.equal(I.percentileRank([], 1), null);
  const hist = (n, wert) => Array.from({ length: n }, (_, i) => ({
    date: TAG(i), backfilled: false, lowFreshness: false, l1: wert, l2: wert, l3: wert, l4ew: wert }));
  assert.equal(I.rIntRankMean(hist(249, 0.5), { l1: 0.9, l2: 0.9, l3: 0.9, l4ew: 0.9 }), null,
    'vor 250 Live-Tagen gibt es keinen Zustand (Rat D3)');
  const hoch = I.rIntRankMean(hist(250, 0.5), { l1: 0.9, l2: 0.9, l3: 0.9, l4ew: 0.9 });
  const tief = I.rIntRankMean(hist(250, 0.5), { l1: 0.1, l2: 0.1, l3: 0.1, l4ew: 0.1 });
  assert.ok(hoch > 0.99 && tief < 0.01, 'der Rang muss die Lage abbilden: ' + hoch + ' / ' + tief);
  assert.notEqual(hoch, 0);
  // Rueckgerechnete und truebe Zeilen speisen den Rang nicht (Rat D2 + Gericht):
  const gemischt = hist(250, 0.5).map((r, i) => (i < 240 ? Object.assign({}, r, { backfilled: true }) : r));
  assert.equal(I.rIntRankMean(gemischt, { l1: 0.9, l2: 0.9, l3: 0.9, l4ew: 0.9 }), null);
});

test('I21 REVIEW-FUND: ein gleichmaessig veralteter Store ist NICHT frisch', () => {
  // freshShare misst Streuung der Balken-Tage. Haengen ALLE Ticker gleich weit zurueck,
  // ist die Streuung 0 und die Zeile saehe sauber aus — obwohl kein einziger Balken vom
  // Sitzungstag stammt. Deshalb faellt das Tor auch, wenn der modale Tag nicht der Tag ist.
  const heute = TAG(299);
  const alt = serie(300, (i) => 100 + i).slice(0, 297);
  const k = new Map([['A', { ticker: 'A', sector: 'Industrials', marketCap: 1, netRevision30: 1 }],
    ['B', { ticker: 'B', sector: 'Healthcare', marketCap: 1, netRevision30: 1 }]]);
  const zeile = I.buildRow({ date: heute, backfilled: false, spyState: null, spyRet63: 0,
    iwmRet63: null, prevRow: null, history: [],
    rawRows: I.perTickerRows(k, new Map([['A', alt], ['B', alt]]), heute) });
  assert.equal(zeile.freshShare, 1, 'die Streuung ist tatsaechlich 0 …');
  assert.equal(zeile.lowFreshness, true, '… aber der modale Balken-Tag ist nicht der Sitzungstag');
  assert.equal(zeile.nAtSession, 0);
  assert.equal(zeile.universeSize, 0);
});

console.log('\ninternals.test.js: ' + pass + ' ok, ' + fail + ' fail');
process.exit(fail ? 1 : 0);

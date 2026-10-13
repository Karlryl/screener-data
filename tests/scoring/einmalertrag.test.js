'use strict';
/**
 * Waechter fuer die Einmalertrags-Lampe (Tag 474).
 *
 * DER BEFUND: Zealand Pharma stand am 27.07.2026 auf Rang 1 der Uebersicht, Score 100,1, mit
 * SECHS Achsen ueber dem 99. Perzentil - Umsatzniveau 99,5 · Beschleunigung 99,7 ·
 * Rohertragswachstum 99,9 · Rule-of-X 99,9 · Kapitaleffizienz 99 · Verwaesserung 99,5.
 * Grundlage waren die Quartalsumsaetze 5 / 10 / 8 / 1.382 Mio. USD: ein einziger
 * Lizenzertrag, gebucht als Umsatz. Karl fiel das beim Draufschauen auf, dem Screener nicht.
 *
 * WARUM UEBER QUARTALE UND NICHT UEBER DIE JAHRESREIHE: ein echter Hypergrowth kann auch das
 * Fuenffache wachsen - aus der Jahresreihe allein sind beide Faelle nicht zu trennen. Der
 * Unterschied ist die WIEDERHOLBARKEIT, und die steht in den Quartalen.
 *
 * GEMESSEN am ausgelieferten Bestand des 27.07. (151 Zeilen mit vier verwertbaren Quartalen):
 * Median 0,301 · p90 0,374 · nur FUENF Zeilen ueber 0,50. Die Firmen, die Karl sehen WILL,
 * liegen alle im Normalbereich: CRDO 0,327 · ALAB 0,308 · BE 0,318 · NVDA 0,322 · PLTR 0,313.
 *
 * DIE LAMPE VERRECHNET NICHTS (nicht in DATA_SUSPECT_LAMPS): kein Score-, kein
 * Exclude-Effekt. Sie macht den Fall zuerst SICHTBAR; ob er den Score druecken soll, ist eine
 * eigene Frage mit Gauntlet-Pflicht.
 *
 * GEGENPROBE (durchgefuehrt): Schwelle entfernt -> die echten Wachstumsfirmen feuern mit und
 * der Test wird rot; Saison-Schutz entfernt -> der Einzelhandels-Fall wird rot.
 *
 * Usage:  node tests/scoring/einmalertrag.test.js   (Exit 0/1)
 */
const assert = require('node:assert/strict');
const { einmalertrag, evaluateLamps } = require('../../src/scoring/lamps.js');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); }
}

// revenueQ liegt newest-first. Baut einen Snapshot mit genau dieser Reihe.
const snap = (quartale) => ({ timeseries: { revenueQ: quartale.map((v) => (v === null ? null : { value: v })) } });

test('der echte Zealand-Fall feuert', () => {
  // Die Zahlen aus dem ausgelieferten Stand vom 27.07., in Mio. USD.
  //
  // ⚠ KORRIGIERT 28.07.: hier stand [1382, 8, 10, 5], also 1382 als NEUESTES Quartal.
  // Das ist verdreht. Der Snapshot fuehrt revenueQEnds ["2026-03-31","2025-12-31",
  // "2025-09-30","2025-06-30"] — das 1382er-Quartal endete am 30.06.2025 und ist das
  // AELTESTE der vier; das neueste liegt bei 5 Mio. Der Lizenzertrag rollt also im
  // naechsten Quartal aus dem Fenster. Fuer die Konzentration (groesstes/Summe) war die
  // Reihenfolge egal, weshalb der Fehler nie aufflog — fuer den Anlauf-Schutz unten
  // waere er entscheidend geworden.
  assert.equal(einmalertrag(snap([5, 10, 8, 1382])), true);
});

test('ein Anlauf feuert NICHT — auch wenn er die 50-%-Marke reisst', () => {
  // Echte Reihen aus der CI-Kohorte vom 27.07. (newest-first, Mio.). Beide liegen ueber
  // der Konzentrations-Schwelle und sind trotzdem kein Einmalertrag, sondern ein
  // Anstieg ueber vier Quartale. Vor dieser Regel trug 2451.TW die Lampe auf Rang 28
  // der Uebersicht.
  const anlaeufe = {
    '2451.TW': [422, 211, 100, 92],
    ONDS: [50, 30, 10, 6],
    BMNR: [47, 11, 2, 1],
  };
  for (const [name, q] of Object.entries(anlaeufe)) {
    assert.equal(einmalertrag(snap(q)), false, `${name} ist ein Anlauf und darf nicht feuern`);
  }
});

test('ein Anlauf MIT Delle bleibt ein Einmalertrag', () => {
  // Gegenprobe zum Anlauf-Schutz: ein einziges faellendes Quartal genuegt, damit die
  // Reihe nicht mehr monoton ist. Sonst wuerde die Regel zu viel verschlucken.
  // BEAM real: 8 -> 10 -> 114 -> 32 (aelteste zuerst) — steigt, faellt, feuert.
  assert.equal(einmalertrag(snap([32, 114, 10, 8])), true, 'BEAM muss weiter feuern');
  assert.equal(einmalertrag(snap([300, 10, 20, 5])), true, 'Delle in der Mitte -> feuert');
});

test('der echte ABUS-Fall feuert', () => {
  assert.equal(einmalertrag(snap([179, 1, 1, 11])), true);
});

test('die Firmen, die Karl sehen will, feuern NICHT', () => {
  // Echte Quartalsreihen vom 27.07. - faellt einer dieser Faelle, ist die Lampe unbrauchbar,
  // weil sie genau die Namen trifft, um die es Karl geht.
  const echte = {
    CRDO: [437, 407, 268, 223],
    ALAB: [308, 271, 231, 192],
    BE: [751, 778, 519, 401],
    NVDA: [81615, 68127, 57006, 46743],
    PLTR: [1633, 1407, 1181, 1004],
    CELH: [783, 722, 725, 739],
    DAVE: [158, 164, 151, 132],
  };
  for (const [name, q] of Object.entries(echte)) {
    assert.equal(einmalertrag(snap(q)), false, `${name} darf nicht feuern`);
  }
});

test('vier gleich grosse Quartale feuern nie', () => {
  assert.equal(einmalertrag(snap([100, 100, 100, 100])), false);
});

test('genau an der Schwelle feuert es, knapp darunter nicht', () => {
  // 50 % heisst: ein Quartal traegt so viel wie die anderen drei zusammen.
  //
  // ⚠ Reihen entdrallt 28.07. (waren [100, 40, 30, 30] und [99, 40, 31, 30]): beide liefen
  // aeltestes -> neuestes monoton durch und haetten am Anlauf-Schutz gehangen statt an der
  // Schwelle. Beim zweiten Fall waere der Test dadurch aus dem FALSCHEN Grund gruen
  // geblieben - er haette nicht mehr die Schwelle geprueft. Nur die mittleren Quartale
  // sind getauscht; Summe (200) und groesstes Quartal bleiben gleich, die gemessene
  // Konzentration also auch.
  assert.equal(einmalertrag(snap([100, 30, 40, 30])), true, 'genau 0,50 muss feuern');
  assert.equal(einmalertrag(snap([99, 31, 40, 30])), false, 'knapp darunter darf nicht feuern');
});

test('Saison feuert NICHT - dasselbe Quartal dominiert auch im Vorjahr', () => {
  // Einzelhaendler mit Weihnachtsgeschaeft: Q4 ist beide Jahre das groesste, jeweils ueber
  // der Schwelle. Das ist keine Einmalzahlung, sondern das Geschaeftsmodell.
  assert.equal(einmalertrag(snap([600, 200, 100, 100, 580, 190, 95, 95])), false);
});

test('ein Ausreisser OHNE Vorjahres-Entsprechung feuert trotz acht Quartalen', () => {
  // Dieselbe Laenge, aber im Vorjahr war die Verteilung normal -> echter Einmaleffekt.
  //
  // ⚠ Reihe angepasst 28.07. (war [600, 200, 100, 100, …]): die alte lief aeltestes ->
  // neuestes glatt 100 -> 100 -> 200 -> 600 durch und ist damit selbst ein ANLAUF, den
  // der neue Schutz abschaltet. Diese drei Tests pruefen den SAISON-Schutz, nicht den
  // Anlauf-Schutz — die mittleren zwei Quartale sind deshalb getauscht, damit die Reihe
  // eine Delle hat. Konzentration (600/1000) und Vorjahr bleiben unveraendert.
  assert.equal(einmalertrag(snap([600, 100, 200, 100, 110, 105, 100, 95])), true);
});

test('ein glatter Anlauf feuert auch mit Vorjahr nicht — bewusste Verhaltensaenderung', () => {
  // Haelt die Entscheidung vom 28.07. fest, damit sie nicht in einem Fixture versteckt
  // liegt: 100 -> 100 -> 200 -> 600 (aeltestes zuerst) reisst die 50-%-Marke, ist aber
  // ein Anstieg ueber vier Quartale. Bis Tag 476 feuerte die Lampe hier. Sie tut es
  // jetzt nicht mehr, und das ist gewollt: genau diese Form haben die Firmen, die Karl
  // finden will.
  assert.equal(einmalertrag(snap([600, 200, 100, 100])), false);
  assert.equal(einmalertrag(snap([600, 200, 100, 100, 110, 105, 100, 95])), false,
    'auch mit vollstaendigem Vorjahr bleibt der Anlauf ein Anlauf');
});

test('dominiert im Vorjahr ein ANDERES Quartal, ist es kein Saisonmuster', () => {
  assert.equal(einmalertrag(snap([600, 100, 200, 100, 95, 580, 190, 95])), true);
});

test('unvollstaendige oder unbrauchbare Reihen ergeben null, nicht false', () => {
  // "Nicht bewertbar" ist etwas anderes als "sauber" - eine Lampe, die bei fehlenden Daten
  // Entwarnung gibt, ist schlimmer als keine.
  assert.equal(einmalertrag(snap([100, 100, 100])), null, 'nur drei Quartale');
  assert.equal(einmalertrag(snap([100, null, 100, 100])), null, 'Luecke in den letzten vier');
  assert.equal(einmalertrag(snap([100, 0, 100, 100])), null, 'Nullquartal ist kein Umsatz');
  assert.equal(einmalertrag(snap([100, -5, 100, 100])), null, 'negativer Umsatz');
  assert.equal(einmalertrag(snap([])), null, 'leere Reihe');
  assert.equal(einmalertrag({}), null, 'kein timeseries-Container');
});

test('fehlt das RELEVANTE Vorjahresquartal, bleibt der Verdacht stehen', () => {
  // Ohne den Vorjahres-Wert DERSELBEN Periode kann Saison nicht ausgeschlossen werden -
  // dann bleibt es beim Verdacht. Der umgekehrte Weg (Entwarnung bei fehlenden Daten)
  // waere gefaehrlich.
  //
  // GEAENDERT 29.07.: der Fall trug vorher [600,100,200,100,580,null,95,95] und erwartete
  // true. Dort steht an Position 4 - dem Vorjahresquartal der Spitze - eine 580 gegen eine
  // Spitze von 600. Das IST Saison, positiv belegt und nicht nur "nicht ausschliessbar";
  // die Luecke stand an Position 5 und war fuer die Frage irrelevant. Der Fall nagelte
  // damit den BLOCK-Test fest (vier vollstaendige Vorjahresquartale) statt der Sache
  // (ist dieses Quartal jedes Jahr gross?). Jetzt fehlt die Position, auf die es ankommt.
  assert.equal(einmalertrag(snap([600, 100, 200, 100, null, 580, 95, 95])), true);
});

test('das Vorjahresquartal der Spitze entlastet auch OHNE volles Vorjahr', () => {
  // Der Grund fuer den Teil-1-Schutz: der Block-Test verlangt vier verwertbare
  // Vorjahresquartale, der Bestand traegt aber meist nur fuenf Quartale insgesamt -
  // gemessen an 3.491 auswertbaren Fenstern greift der Block-Test in NULL Faellen.
  // Belegt an H&R Block: 2.398 / 199 / 204 / 1.111 / 2.277 Mio, Anteil 0,60 -> Lampe an,
  // obwohl das Vorjahresquartal 95 % der Spitze erreicht. Steuersaison, kein Einmalertrag.
  assert.equal(einmalertrag(snap([2398, 199, 204, 1111, 2277])), false, 'HRB-Form: Saison');
  // Die Gegenrichtung, damit der Schutz nicht zum Freibrief wird: liegt das
  // Vorjahresquartal deutlich unter der Haelfte, bleibt die Lampe an.
  assert.equal(einmalertrag(snap([2398, 199, 204, 1111, 300])), true, 'Vorjahr nur 13 % der Spitze');
  // Und der Anlassfall bleibt betroffen: Zealands Spitze liegt an Position 3, das
  // Vorjahresquartal waere Position 7 und fehlt -> keine Entlastung.
  assert.equal(einmalertrag(snap([5, 10, 8, 1382, 1])), true, 'Zealand-Form bleibt geflaggt');
});

test('die Lampe ist registriert und laeuft im normalen Durchlauf mit', () => {
  const r = evaluateLamps(snap([5, 10, 8, 1382]));
  assert.ok('einmalertrag' in r.flags, 'Lampe fehlt in der Auswertung');
  assert.ok(r.active.includes('einmalertrag'), 'Lampe steht nicht in der aktiven Liste');
});

test('die Lampe excludiert NICHT - sie ist keine data-suspect-Lampe (aber sie ist folgenreich)', () => {
  // ⚠ INTENT INVERTIERT AM 16.08.2026 (Gerichtsurteil, F-16-Einzelfreigabe Karl).
  // Dieser Test hiess bis heute "die Lampe druckt den Score NICHT" und begruendete das mit
  // "sichtbar machen, nichts verrechnen". Das ist seit dem Urteil FALSCH: brennt die Lampe,
  // droppt score.js die fuenf vom Sprung getragenen Achsen dieser Zeile (EINMALERTRAG_BLIND),
  // und renorm-on-drop + C4-Shrinkage ziehen den Score Richtung Kohorten-Median. Der Test
  // wird hier ausdruecklich umgeschrieben statt still angepasst - er verankerte woertlich das
  // Gegenteil des jetzigen Verhaltens, und ein Waechter, der eine ueberholte Zusage haelt,
  // ist schlimmer als keiner.
  //
  // WAS UNVERAENDERT WAHR BLEIBT und deshalb hier stehen bleibt: einmalertrag ist KEINE
  // data-suspect-Lampe. Ein Lizenzertrag ist echter, korrekt gemeldeter Umsatz, kein
  // fabriziertes Quartal - die Zeile bleibt sichtbar und geroutet. Stuende die Lampe in
  // DATA_SUSPECT_LAMPS, verschwaenden BNTX/ASTS/LUNR ganz aus dem Ranking.
  const { einmalertrag: _, ...rest } = require('../../src/scoring/lamps.js').LAMPS;
  assert.ok(rest, 'LAMPS lesbar');
  const score = require('../../src/scoring/score.js');
  assert.ok(!String(score.DATA_SUSPECT_LAMPS || '').includes('einmalertrag'),
    'einmalertrag darf NICHT in DATA_SUSPECT_LAMPS stehen - sichtbar bleiben, nicht ausschliessen');
  // Die Score-Wirkung selbst nagelt tests/scoring/einmalertrag-konsequenz.test.js fest
  // (W-A Achsen + Ergebnis-Klammer, W-B Anlauf-Schutz, W-C Anker am echten Board).
});

test('der dritte Zustand ist sichtbar: nicht bewertbar mit Grund', () => {
  // Sichtbarkeits-Stufe des Urteils: einmalertrag() hatte immer drei Ausgaenge, findash sah
  // nur zwei. Reine Anzeige - der Rueckgabe-Vertrag der Lampe ist unangetastet.
  const { einmalertragBewertbarkeit } = require('../../src/scoring/lamps.js');
  const mitEnden = (q, ends) => ({ timeseries: {
    revenueQ: q.map((v) => (v === null ? null : { value: v })), revenueQEnds: ends,
  } });
  assert.equal(einmalertragBewertbarkeit(snap([5, 10, 8, 1382])), null, 'Lampe an -> bewertbar, nichts anzuzeigen');
  assert.equal(einmalertragBewertbarkeit(snap([100, 90, 80, 70])), null, 'Lampe aus -> geprueft und sauber');
  assert.equal(einmalertragBewertbarkeit(snap([100, null, 100, 100])), 'zuWenigQuartale');
  assert.equal(einmalertragBewertbarkeit(snap([100, 0, 100, 100])), 'zuWenigQuartale', 'Nullquartal ist kein Umsatz');
  assert.equal(einmalertragBewertbarkeit(snap([])), 'zuWenigQuartale', 'leere Reihe');
  // 3/6/3-Monatsraster (Halbjahres-Eimer) - der Fall 2548.TW / 298380.KQ
  assert.equal(einmalertragBewertbarkeit(mitEnden([100, 550, 150, 200],
    ['2026-03-31', '2025-12-31', '2025-06-30', '2025-03-31'])), 'ungleicheKadenz');
  assert.equal(einmalertragBewertbarkeit(mitEnden([100, 550, 150, 200],
    ['kaputt', '2025-12-31', '2025-09-30', '2025-06-30'])), 'ungleicheKadenz', 'unlesbares Datum');
  // Gegenprobe: saubere Kadenz darf NICHT als nicht-bewertbar durchgehen
  assert.equal(einmalertragBewertbarkeit(mitEnden([100, 550, 150, 200],
    ['2026-03-31', '2025-12-31', '2025-09-30', '2025-06-30'])), null, 'saubere Kadenz ist bewertbar');
});


test('ungleiche Quartalslaengen sind nicht bewertbar - der Halbjahres-Eimer', () => {
  // 29.07.: Bei chinesischen A-Aktien und weiteren fehlt das September-Quartal. Der
  // Eintrag zum 31.12. deckt dann ein HALBJAHR ab, ist mechanisch doppelt so gross und
  // reisst die 50-%-Marke ohne jeden Einmalertrag. An den CI-Kohorten gemessen: von 48
  // geflaggten Zeilen erloeschen 19, darunter BURE.ST auf Rang 1 (financials),
  // 688336.SS auf Rang 3 (health-care) und GODREJPROP.NS auf Rang 17.
  const mitEnden = (q, ends) => ({ timeseries: {
    revenueQ: q.map((v) => ({ value: v })), revenueQEnds: ends,
  } });
  // 3/6/3 Monate -> nicht bewertbar, obwohl der Anteil 0,55 betraegt
  assert.equal(einmalertrag(mitEnden([100, 550, 150, 200],
    ['2026-03-31', '2025-12-31', '2025-06-30', '2025-03-31'])), null,
  'ungleiche Kadenz muss null ergeben (nicht bewertbar), nicht false (sauber)');
  // dieselbe Reihe mit sauberer Kadenz -> die Lampe MUSS anschlagen
  assert.equal(einmalertrag(mitEnden([100, 550, 150, 200],
    ['2026-03-31', '2025-12-31', '2025-09-30', '2025-06-30'])), true,
  'bei gleichen Quartalsabstaenden bleibt der Befund bestehen - die Sperre darf kein Freibrief sein');
  // fehlende Enden: NICHT raten, sondern wie bisher bewerten (Alt-Snapshots tragen sie nicht)
  assert.equal(einmalertrag(mitEnden([100, 550, 150, 200], null)), true,
    'ohne Enden wird nicht geraten - sonst waere eine ganze Alt-Population stumm');
  // unlesbares Datum -> nicht bewertbar
  assert.equal(einmalertrag(mitEnden([100, 550, 150, 200],
    ['kaputt', '2025-12-31', '2025-09-30', '2025-06-30'])), null);
  // der Anlassfall traegt saubere Kadenz und bleibt erkannt
  assert.equal(einmalertrag(mitEnden([5, 10, 8, 1382],
    ['2026-03-31', '2025-12-31', '2025-09-30', '2025-06-30'])), true, 'Zealand-Form bleibt geflaggt');
});


// ── Die zwei Schutzschichten, die eine Einzelzeilen-Pruefung NICHT leisten kann ─────────
// einmalertragBewertbarkeit reist ueber drei Stationen: lamps.js (Erzeuger) -> score.js
// rowMeta (Mapping) -> write-findash-export.js ROW_FIELDS (Writer). Faellt EINE davon aus,
// steht das Feld auf JEDER Zeile null — und checkEinmalertragBewertbarkeit bleibt gruen,
// weil null der legitime Normalfall ist (~90 % aller Zeilen). Genau so war mcapKlasse in
// JEDEM ausgelieferten Export null, ohne dass etwas rot wurde (score.js rowMeta-Kommentar).
// Deshalb pruefen die beiden Tests unten WERTE am Ende der Kette und Homogenitaet ueber die
// Datei — gespiegelt von tests/einmalertrag-prognose.test.js, wo dasselbe Feldmuster haengt.
const { scoreUniverse, produceRankings } = require('../../src/scoring/score.js');
const formulas = require('../../src/scoring/formulas/index.js');
const { mapBoardRow, validateFile } = require('../../scripts/write-findash-export.js');

const V = (arr) => arr.map((v) => (v === null ? null : { value: v }));
function kettenSnap(ticker, revQ, ends) {
  const s = {
    meta: { name: ticker + ' Inc.', sector: 'Technology', industry: 'Semiconductors', region: 'US', ticker },
    marketCap: { value: 5e9 },
    metrics: { revenueTTM: { value: 1670 } },
    annual: { annualRev: V([1670, 900]), annualGP: V([900, 500]), annualOpInc: V([300, 150]) },
    timeseries: { revenueQ: V(revQ), opIncQ: V([60, 50, 40, 30, 20]), grossProfitQ: V([100, 90, 80, 70, 60]) },
  };
  if (ends) s.timeseries.revenueQEnds = ends;
  return s;
}
const QUARTALSRASTER = ['2026-03-31', '2025-12-31', '2025-09-30', '2025-06-30', '2025-03-31'];
const HALBJAHRESEIMER = ['2026-03-31', '2025-12-31', '2025-06-30', '2025-03-31', '2024-12-31'];

test('KETTE: der Bewertbarkeits-Grund ueberlebt scoreUniverse -> produceRankings -> mapBoardRow', () => {
  const universum = [
    // Luecke in den letzten vier -> nicht bewertbar, Grund zuWenigQuartale
    kettenSnap('FAKELUECKE', [1400, null, 100, 90, 70], QUARTALSRASTER),
    // vier verwertbare Quartale, aber 3/6/3-Monatsraster -> Grund ungleicheKadenz
    kettenSnap('FAKEKADENZ', [200, 180, 160, 140, 120], HALBJAHRESEIMER),
    // saubere Reihe, Lampe aus -> bewertbar -> null
    kettenSnap('FAKEGLATT', [200, 180, 160, 140, 120], QUARTALSRASTER),
    // Lampe AN -> die Lampe hat geurteilt -> ebenfalls null (und nie ein Grund)
    kettenSnap('FAKESPITZE', [1400, 80, 100, 90, 70], QUARTALSRASTER),
  ];
  // Vorbedingungen sichtbar machen, sonst prueft der Test nach einer Routing-Aenderung nichts mehr.
  assert.equal(einmalertrag(universum[3]), true, 'FAKESPITZE: Lampen-Vorbedingung');
  assert.equal(einmalertrag(universum[2]), false, 'FAKEGLATT: muss geprueft und sauber sein');

  const results = scoreUniverse(universum, formulas);
  assert.equal(results.filter((r) => r.action === 'route').length, 4,
    'alle vier Testzeilen muessen geroutet sein, sonst misst die Kette nichts');
  const rk = produceRankings(results, { topN: 50 });
  const alleZeilen = [].concat(...Object.values(rk.branches).map((b) => [].concat(b.profitable || [], b.unprofitable || [])));

  const erwartet = { FAKELUECKE: 'zuWenigQuartale', FAKEKADENZ: 'ungleicheKadenz', FAKEGLATT: null, FAKESPITZE: null };
  for (const [ticker, soll] of Object.entries(erwartet)) {
    const zeile = alleZeilen.find((r) => r.ticker === ticker);
    assert.ok(zeile, ticker + ' fehlt in den Board-Zeilen');
    // Station 2: score.js rowMeta
    assert.equal(zeile.einmalertragBewertbarkeit, soll, ticker + ': Wert nach dem score.js-Mapping');
    // Station 3: der Writer muss das Feld FUEHREN, nicht nur die Zeile durchreichen.
    const exportiert = mapBoardRow(zeile, 0);
    assert.ok('einmalertragBewertbarkeit' in exportiert, ticker + ': Feld faellt im Export-Writer heraus');
    assert.equal(exportiert.einmalertragBewertbarkeit, soll, ticker + ': Wert am Ende der Kette');
    // Gegenrichtung: ein Grund darf nie neben der Lampe stehen.
    if (soll !== null) assert.ok(!exportiert.lamps.includes('einmalertrag'), ticker + ': Grund UND Lampe');
  }
});

test('DATEI-WAECHTER: das Bewertbarkeits-Feld ist auf allen Zeilen da oder auf keiner', () => {
  // checkEinmalertragBewertbarkeit kehrt bei fehlendem Feld um ("Abwesenheit legitim") — fuer
  // eine EINZELNE Zeile richtig (Altbestand), ueber die ganze Datei aber unmoeglich: der
  // Writer fuehrt das Feld in ROW_FIELDS und setzt es auf JEDER Zeile. Halb da = halb kaputter
  // Erzeuger, und genau das sieht keine Einzelzeilen-Pruefung.
  const basisZeile = {
    ticker: 'NVDA', name: 'NVIDIA Corporation', score: 88.2, track: 'profitable', lamps: [],
    overview: { kind: 'gp', value: 0.2, companion: 89.1 },
    country: 'United States', region: 'North America', sector: 'Technology',
    marketCap: 5e12, phase: 'established', mcapBand: 'mega', ipoRecency: 'mature',
    profitTier: 'langfristig-profitabel', ipoYear: 1999, cohortN: 90, cohortFallback: false,
  };
  const datei = (rows) => ({ schema: 'findash-export/v1', branch: 'semiconductors', boardStatus: 'core',
    profitable: rows, unprofitable: [] });
  const mitFeld = mapBoardRow({ ...basisZeile, einmalertragBewertbarkeit: 'ungleicheKadenz' }, 0);
  const ohneFeld = mapBoardRow(basisZeile, 1); delete ohneFeld.einmalertragBewertbarkeit;

  const gemischt = [];
  validateFile(datei([mitFeld, ohneFeld]), 'semiconductors', gemischt);
  assert.ok(gemischt.some((x) => /einmalertragBewertbarkeit/.test(x)),
    'halb verdrahtete Datei blieb unbemerkt: ' + JSON.stringify(gemischt));

  // Kein Falsch-Rot: neue Datei (Feld ueberall) und Altbestand (Feld nirgends) gehen durch.
  const alleMit = [];
  validateFile(datei([mitFeld, mapBoardRow({ ...basisZeile, einmalertragBewertbarkeit: null }, 1)]), 'semiconductors', alleMit);
  assert.ok(!alleMit.some((x) => /einmalertragBewertbarkeit/.test(x)), 'neue Datei falsch-rot: ' + JSON.stringify(alleMit));

  const alleOhne = [];
  const ohne2 = mapBoardRow(basisZeile, 1); delete ohne2.einmalertragBewertbarkeit;
  validateFile(datei([ohneFeld, ohne2]), 'semiconductors', alleOhne);
  assert.ok(!alleOhne.some((x) => /einmalertragBewertbarkeit/.test(x)), 'Altbestand falsch-rot: ' + JSON.stringify(alleOhne));
});


console.log(`\neinmalertrag: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);

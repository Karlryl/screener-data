'use strict';
/**
 * Waechter fuer den Prognose-Zustand der Einmalertrags-Lampe (F-2 Stufe 1).
 *
 * WAS HIER GESICHERT WIRD: findash zeigt seit dem 03.08.2026 zu jeder Zeile mit der Lampe
 * 'einmalertrag' einen Prognose-Zustand an und liest ihn aus rows[].einmalertragPrognose
 * (findash/data-layer/lamp-legend.js, einmalertragZustand()). Der Erzeuger sitzt hier.
 *
 * ⛔ DIE SCHWELLEN-SPERRE IST DER KERN DIESES TESTS. Die beiden URTEILENDEN Zustaende
 * 'bestaetigt'/'eingebrochen' verlangen eine Einbruchs-Schwelle. Eine solche Schwelle ist
 * heute NICHT gelernt und NICHT praeregistriert — und scripts/einmalertrag-trefferquote.js
 * hat am 29.07. gezeigt, wohin eine frei gewaehlte Schwelle fuehrt: das Vorzeichen des
 * "Befunds" haengt daran, wo man sie hinlegt. Stufe 1 liefert deshalb AUSSCHLIESSLICH
 * schwellenfreie Verfuegbarkeits-Zustaende. Der Test unten faehrt die volle Datenmatrix
 * durch und besteht darauf, dass KEIN Eingabefall ein Urteil erzeugt.
 *
 * WARUM DER KETTEN-TEST (L26/L30): das Feld reist ueber drei Stationen —
 * lamps.js (Erzeuger) -> score.js rowMeta (Mapping) -> write-findash-export.js ROW_FIELDS
 * (Writer). Faellt EINE Station aus, ist das Feld auf ALLEN Zeilen null und ein
 * Anwesenheits-Check bleibt gruen (genau so war mcapKlasse in jedem ausgelieferten Export
 * null). Deshalb prueft der Test hier WERTE am Ende der Kette, nicht Anwesenheit.
 *
 * Usage:  node tests/einmalertrag-prognose.test.js   (Exit 0/1)
 */
const assert = require('node:assert/strict');
const { einmalertrag, einmalertragPrognose } = require('../src/scoring/lamps.js');
const { scoreUniverse, produceRankings } = require('../src/scoring/score.js');
const formulas = require('../src/scoring/formulas/index.js');
const { mapBoardRow, mapOverviewRow, validateBoardRow, validateOverviewRow, validateFile } = require('../scripts/write-findash-export.js');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); }
}

const V = (arr) => arr.map((v) => ({ value: v }));
// Quartalsreihe mit einem Ausreisser, der die Lampe sicher zuendet: Spitze 1.400 gegen
// Basis ~90 -> Anteil 0,84 (Schwelle 0,50); das Vorjahresquartal (Position 4) liegt weit
// unter der halben Spitze, der Saison-Schutz greift also nicht. Die Reihe ist bewusst
// NICHT monoton steigend (80 nach 100), sonst greift der Anlauf-Schutz der Lampe.
const SPITZE = [1400, 80, 100, 90, 70];
// Dieselbe Reihe geglaettet: kein Ausreisser -> Lampe aus.
const GLATT = [200, 180, 160, 140, 120];

function snap(ticker, revQ, external) {
  const s = {
    meta: { name: ticker + ' Inc.', sector: 'Technology', industry: 'Semiconductors', region: 'US', ticker },
    marketCap: { value: 5e9 },
    annual: { annualRev: V([1670, 900]), annualGP: V([900, 500]), annualOpInc: V([300, 150]) },
    timeseries: { revenueQ: V(revQ), opIncQ: V([60, 50, 40, 30, 20]), grossProfitQ: V([100, 90, 80, 70, 60]) },
  };
  if (external) s.external = external;
  return s;
}
const est = (o) => ({ revenueEstimates: { '+1y': o } });

// ── 1. Erzeuger: die schwellenfreien Zustaende, jeder aus den DATEN abgeleitet ──────────
test('Lampe aus -> null, auch bei vollstaendiger Prognose (nur markierte Zeilen tragen einen Zustand)', () => {
  assert.equal(einmalertragPrognose(snap('X', GLATT, est({ avg: 1e9, growth: 0.4, numberOfAnalysts: 9 })), false), null);
  assert.equal(einmalertragPrognose(snap('X', GLATT), false), null);
});

test('Lampe an + gar keine Prognose -> nichtPruefbar', () => {
  assert.equal(einmalertragPrognose(snap('X', SPITZE), true), 'nichtPruefbar');
  assert.equal(einmalertragPrognose(snap('X', SPITZE, {}), true), 'nichtPruefbar');
  assert.equal(einmalertragPrognose(snap('X', SPITZE, { revenueEstimates: null }), true), 'nichtPruefbar');
});

test('Lampe an + Prognose ohne die naechste Geschaeftsjahres-Periode -> nichtPruefbar', () => {
  // '+1y' ist der Periodenschluessel des naechsten Geschaeftsjahres (nachgesehen am lokalen
  // Bestand: 0q/+1q/0y/+1y, +1y auf 2.309 von 2.314 abgedeckten Titeln). Nur diese Periode
  // beantwortet die Frage "kommt so etwas wieder".
  const s = snap('X', SPITZE, { revenueEstimates: { '0y': { avg: 1e9, growth: 0.2, numberOfAnalysts: 5 } } });
  assert.equal(einmalertragPrognose(s, true), 'nichtPruefbar');
});

test('Lampe an + Fehlstelle statt Prognose (avg 0 / keine Analysten) -> nichtPruefbar', () => {
  assert.equal(einmalertragPrognose(snap('X', SPITZE, est({ avg: 0, growth: null, numberOfAnalysts: 0 })), true), 'nichtPruefbar');
  assert.equal(einmalertragPrognose(snap('X', SPITZE, est({ avg: 1e9, growth: 0.2, numberOfAnalysts: 0 })), true), 'nichtPruefbar');
  assert.equal(einmalertragPrognose(snap('X', SPITZE, est({ avg: 0, growth: 0.2, numberOfAnalysts: 7 })), true), 'nichtPruefbar');
});

test('Lampe an + Schaetzung da, aber die Quelle liefert keine Veraenderung -> nichtAnwendbar', () => {
  // pull-yahoo.js benennt genau diesen Fall: "growth === null heisst NICHT keine Abdeckung"
  // (LFTO: 14 Analysten, gefuellter avg, growth null — ein Rechenartefakt der Quelle).
  // Deckungsgleich mit findashs Legendentext zu nichtAnwendbar.
  assert.equal(einmalertragPrognose(snap('X', SPITZE, est({ avg: 1e9, growth: null, numberOfAnalysts: 14 })), true), 'nichtAnwendbar');
  assert.equal(einmalertragPrognose(snap('X', SPITZE, est({ avg: 1e9, growth: NaN, numberOfAnalysts: 14 })), true), 'nichtAnwendbar');
});

// ── 2. Die Schwellen-Sperre ────────────────────────────────────────────────────────────
test('SPERRE: kein Eingabefall erzeugt heute ein Urteil (bestaetigt/eingebrochen)', () => {
  const avgs = [0, 1, 1e6, 1e9, 1e12];
  const growths = [null, NaN, -0.99, -0.5, -0.001, 0, 0.001, 0.5, 12];
  const ns = [0, 1, 7, 200];
  let n = 0;
  for (const avg of avgs) for (const growth of growths) for (const numberOfAnalysts of ns) {
    for (const lampe of [true, false]) {
      const z = einmalertragPrognose(snap('X', lampe ? SPITZE : GLATT, est({ avg, growth, numberOfAnalysts })), lampe);
      assert.ok(z === null || z === 'nichtPruefbar' || z === 'nichtAnwendbar',
        `Urteil ohne praeregistrierte Schwelle: ${JSON.stringify(z)} bei avg=${avg} growth=${growth} n=${numberOfAnalysts}`);
      n++;
    }
  }
  assert.equal(n, avgs.length * growths.length * ns.length * 2, 'Matrix vollstaendig durchlaufen');
});

test('vollstaendige Prognose -> null: das Urteil bleibt der Stufe 2 vorbehalten', () => {
  // Nicht 'nichtPruefbar' und nicht 'nichtAnwendbar': beides waere eine falsche Aussage
  // (die Prognose IST da und IST vergleichbar). null heisst "kein Urteil" — findash faellt
  // dafuer auf seinen dokumentierten Fall D zurueck. Genau diese Zeilen fuellt Stufe 2.
  assert.equal(einmalertragPrognose(snap('X', SPITZE, est({ avg: 1e9, growth: -0.6, numberOfAnalysts: 12 })), true), null);
  assert.equal(einmalertragPrognose(snap('X', SPITZE, est({ avg: 1e9, growth: 0.3, numberOfAnalysts: 12 })), true), null);
});

// ── 3. Die ganze Kette: Erzeuger -> score.js-Mapping -> Export-Writer ───────────────────
test('KETTE: der Zustand ueberlebt scoreUniverse -> produceRankings -> mapBoardRow', () => {
  const universum = [
    snap('FAKEPRUEF', SPITZE),                                                       // Lampe an, keine Prognose
    snap('FAKEANW', SPITZE, est({ avg: 2e9, growth: null, numberOfAnalysts: 11 })),   // Lampe an, growth null
    snap('FAKEOFFEN', SPITZE, est({ avg: 2e9, growth: -0.7, numberOfAnalysts: 11 })), // Lampe an, alles da
    snap('FAKEGLATT', GLATT, est({ avg: 2e9, growth: 0.3, numberOfAnalysts: 11 })),   // keine Lampe
  ];
  // Vorbedingung sichtbar machen, sonst prueft der Test bei einer Routing-Aenderung nichts mehr.
  for (const s of universum) assert.equal(einmalertrag(s) === true, s.meta.ticker !== 'FAKEGLATT', s.meta.ticker + ': Lampen-Vorbedingung');

  const results = scoreUniverse(universum, formulas);
  const gescort = results.filter((r) => r.action === 'route');
  assert.equal(gescort.length, 4, 'alle vier Testzeilen muessen geroutet sein, sonst misst die Kette nichts');

  const rk = produceRankings(results, { topN: 50 });
  const alleZeilen = [].concat(...Object.values(rk.branches).map((b) => [].concat(b.profitable || [], b.unprofitable || [])));
  const erwartet = { FAKEPRUEF: 'nichtPruefbar', FAKEANW: 'nichtAnwendbar', FAKEOFFEN: null, FAKEGLATT: null };
  for (const [ticker, soll] of Object.entries(erwartet)) {
    const zeile = alleZeilen.find((r) => r.ticker === ticker);
    assert.ok(zeile, ticker + ' fehlt in den Board-Zeilen');
    assert.equal(zeile.einmalertragPrognose, soll, ticker + ': Wert nach dem score.js-Mapping');
    // Station 3: der Writer muss das Feld FUEHREN, nicht nur die Zeile durchreichen.
    const exportiert = mapBoardRow(zeile, 0);
    assert.ok('einmalertragPrognose' in exportiert, ticker + ': Feld faellt im Export-Writer heraus');
    assert.equal(exportiert.einmalertragPrognose, soll, ticker + ': Wert am Ende der Kette');
    // Und der Konsument muss es finden koennen: Zustand nur mit Lampe.
    if (soll !== null) assert.ok(exportiert.lamps.includes('einmalertrag'), ticker + ': Zustand ohne Lampe');
  }
  const ovZeile = rk.overview.find((r) => r.ticker === 'FAKEANW');
  assert.ok(ovZeile, 'FAKEANW fehlt in der Uebersicht');
  assert.equal(mapOverviewRow(ovZeile, 0).einmalertragPrognose, 'nichtAnwendbar', 'Uebersichts-Zeile traegt den Zustand ebenfalls');
});

// ── 4. Der Waechter im --check: beide Richtungen ────────────────────────────────────────
const basisZeile = {
  ticker: 'NVDA', name: 'NVIDIA Corporation', score: 88.2, track: 'profitable', lamps: ['einmalertrag'],
  overview: { kind: 'gp', value: 0.2, companion: 89.1 },
  country: 'United States', region: 'North America', sector: 'Technology',
  marketCap: 5e12, phase: 'established', mcapBand: 'mega', ipoRecency: 'mature',
  profitTier: 'langfristig-profitabel', ipoYear: 1999, cohortN: 90, cohortFallback: false,
};
const errsOf = (row) => { const e = []; validateBoardRow(row, 'r', e); return e; };

test('WAECHTER: jede gueltige Form geht durch (sonst faerbt der Waechter Karls Alarmkanal falsch-rot)', () => {
  for (const z of ['bestaetigt', 'eingebrochen', 'nichtAnwendbar', 'nichtPruefbar']) {
    const e = errsOf(mapBoardRow({ ...basisZeile, einmalertragPrognose: z }, 0));
    assert.equal(e.length, 0, `Zustand ${z} muss durchgehen -> ${e.join('; ')}`);
  }
  assert.equal(errsOf(mapBoardRow({ ...basisZeile, einmalertragPrognose: null }, 0)).length, 0, 'null geht durch');
  assert.equal(errsOf(mapBoardRow(basisZeile, 0)).length, 0, 'Abwesenheit im Erzeuger geht durch');
  // Zeile ohne Lampe UND ohne Zustand — der Normalfall fuer ~99 % aller Zeilen.
  assert.equal(errsOf(mapBoardRow({ ...basisZeile, lamps: [], einmalertragPrognose: null }, 0)).length, 0, 'Zeile ohne Lampe, Feld null');
});

test('WAECHTER: unbekannter Zustand fliegt auf', () => {
  for (const kaputt of ['bestätigt', 'confirmed', 'nichtpruefbar', '', 0, 1, true, {}, ['nichtPruefbar'], 'toString']) {
    const e = errsOf(mapBoardRow({ ...basisZeile, einmalertragPrognose: kaputt }, 0));
    assert.ok(e.some((x) => /einmalertragPrognose/.test(x)), 'unbemerkt durch: ' + JSON.stringify(kaputt));
  }
});

test('WAECHTER: ein Zustand auf einer Zeile OHNE die Lampe fliegt auf', () => {
  for (const z of ['bestaetigt', 'eingebrochen', 'nichtAnwendbar', 'nichtPruefbar']) {
    const e = errsOf(mapBoardRow({ ...basisZeile, lamps: ['peakMargin'], einmalertragPrognose: z }, 0));
    assert.ok(e.some((x) => /einmalertragPrognose/.test(x)), `Zustand ${z} ohne Lampe blieb unbemerkt`);
  }
  // gleiche Pruefung auf der Uebersichts-Zeilenform
  const ov = { ticker: 'NVDA', name: 'NVIDIA Corporation', formulaId: 'semiconductors', track: 'profitable', score: 94.9,
    overviewKind: 'gp', overviewValue: 1.1, overviewCompanion: 195.3, lamps: [],
    country: 'United States', region: 'North America', sector: 'Technology', marketCap: 5e12,
    phase: 'inflected', mcapBand: 'large', ipoRecency: 'growth', cohortN: 90, cohortFallback: false,
    einmalertragPrognose: 'nichtPruefbar' };
  const e = []; validateOverviewRow(mapOverviewRow(ov, 0), 'o', e);
  assert.ok(e.some((x) => /einmalertragPrognose/.test(x)), 'Uebersichts-Zeile ohne Lampe blieb unbemerkt');
});

// ── 5. Die Luecke, die eine ZEILE strukturell nicht sehen kann ──────────────────────────
// checkEinmalertragPrognose kehrt bei fehlendem Feld sofort um ("Abwesenheit legitim
// (Altbestand)"). Das ist fuer eine EINZELNE Zeile richtig — alte Exporte tragen das Feld
// nicht. Ueber die ganze DATEI hinweg ist Uneinheitlichkeit aber unmoeglich: der Writer
// fuehrt das Feld in ROW_FIELDS und setzt es auf JEDER Zeile (r[k] === undefined -> null).
// Traegt eine Datei es auf einigen Zeilen und auf anderen nicht, ist der Erzeuger halb
// kaputt — und genau das sieht keine Einzelzeilen-Pruefung.
// KEIN Falsch-Rot-Risiko: alte Dateien haben es auf KEINER Zeile, neue auf JEDER.
// (Warum hier nicht "Lampe ⟹ non-null" steht: null IST auf einer Lampen-Zeile der
//  Soll-Zustand, sobald die Prognose vollstaendig ist. Die Verdrahtung selbst sichert der
//  KETTE-Test oben mit 'nichtPruefbar' — einem Wert, der nie null sein darf; gegengeprobt
//  am 03.08. durch Ausbau aller drei Stationen: ROW_FIELDS 3 fail, score.js rowMeta 1 fail,
//  lamps.js Erzeuger 5 fail.)
test('DATEI-WAECHTER: das Feld ist entweder auf allen Zeilen da oder auf keiner', () => {
  const mitFeld = mapBoardRow({ ...basisZeile, einmalertragPrognose: 'nichtPruefbar' }, 0);
  const ohneFeld = mapBoardRow(basisZeile, 1);
  delete ohneFeld.einmalertragPrognose;
  const datei = (rows) => ({ schema: 'findash-export/v1', branch: 'semiconductors', boardStatus: 'core',
    profitable: rows, unprofitable: [] });

  const gemischt = [];
  validateFile(datei([mitFeld, ohneFeld]), 'semiconductors', gemischt);
  assert.ok(gemischt.some((x) => /einmalertragPrognose/.test(x)),
    'halb verdrahtete Datei blieb unbemerkt: ' + JSON.stringify(gemischt));

  const alleMit = [];
  validateFile(datei([mitFeld, mapBoardRow({ ...basisZeile, einmalertragPrognose: null }, 1)]), 'semiconductors', alleMit);
  assert.ok(!alleMit.some((x) => /einmalertragPrognose/.test(x)), 'neue Datei falsch-rot: ' + JSON.stringify(alleMit));

  const alleOhne = [];
  const ohne2 = mapBoardRow(basisZeile, 1); delete ohne2.einmalertragPrognose;
  validateFile(datei([ohneFeld, ohne2]), 'semiconductors', alleOhne);
  assert.ok(!alleOhne.some((x) => /einmalertragPrognose/.test(x)), 'Altbestand falsch-rot: ' + JSON.stringify(alleOhne));
});

console.log(`\neinmalertrag-prognose: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);

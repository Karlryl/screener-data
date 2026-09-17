'use strict';
/** tests/rule40/contract.test.js — Standalone-Runner.
 *
 * DIE ZUSICHERUNG: was write-rule40-export.js schreibt, kann findash lesen. Nicht
 * "sieht aus wie", sondern: genau die Felder, die data-layer/screener-contract.js
 * (requiredHull/requiredOverviewRow) und data-layer/screener.js (shapeOverviewRow,
 * checkGeneration, die boardStatus-Suche ueber formulaId) verlangen.
 *
 * WARUM ES DIESEN TEST GIBT: der Vertrag steht in EINEM Repo und wird im ANDEREN
 * gelesen. Zwischen beiden liegt gh-pages — ein fehlendes Pflichtfeld faellt sonst erst
 * auf, wenn das Brett in findash als error-Envelope ankommt, also Stunden spaeter und
 * ohne Hinweis auf die Ursache. Die Pflichtfeld-Liste steht hier ABSICHTLICH noch einmal
 * woertlich: eine zweite Quelle, die auffaellt, wenn das geteilte Fixture sich bewegt.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const W = require('../../scripts/write-rule40-export.js');
const { snapshot, boardZeile, baueExport, laeufer } = require('./fixture.js');

const { test, bilanz } = laeufer();

// Woertlich aus findash/data-layer/findash-export-v1.contract.json (Stand 17.09.2026).
const HUELLE = ['schema', 'generated_at', 'coverage'];
const ZEILE = ['rank', 'ticker', 'formulaId', 'track', 'score', 'overviewKind', 'overviewValue',
  'overviewCompanion', 'lamps', 'country', 'region', 'sector', 'marketCap', 'phase',
  'mcapBand', 'ipoRecency', 'profitTier', 'ipoYear', 'cohortN', 'cohortFallback'];

function baue(eintraege, opts) {
  const f = baueExport(eintraege, opts);
  const res = W.build({ v1Dir: f.v1Dir, snapshotsDir: f.snapshotsDir, outDir: f.outDir });
  const overview = JSON.parse(fs.readFileSync(path.join(f.outDir, 'overview.json'), 'utf8'));
  const index = JSON.parse(fs.readFileSync(path.join(f.outDir, 'index.json'), 'utf8'));
  return { f, res, overview, index };
}

/** Drei gesunde Zeilen mit fallendem r40, zwei Gruppen. */
function dreiGesunde() {
  return [
    { row: boardZeile({ ticker: 'AAA', revGrowthYoYPct: 60 }), snap: snapshot({ fcfMarginTTM: 30 }) },      // 90
    { row: boardZeile({ ticker: 'BBB', revGrowthYoYPct: 40 }), snap: snapshot({ fcfMarginTTM: 25 }) },      // 65
    { row: boardZeile({ ticker: 'CCC', revGrowthYoYPct: 30, sector: 'Industrials' }),
      snap: snapshot({ fcfMarginTTM: 15, industry: 'Specialty Industrial Machinery' }),
      branch: 'industrials' },                                                                              // 45
  ];
}

test('Huelle: overview.json und index.json tragen schema/generated_at/coverage', () => {
  const { f, overview, index } = baue(dreiGesunde());
  for (const feld of HUELLE) {
    assert.ok(feld in overview, 'overview.json ohne ' + feld);
    assert.ok(feld in index, 'index.json ohne ' + feld);
  }
  assert.equal(overview.schema, 'findash-export/v1');
  assert.equal(index.schema, 'findash-export/v1');
  f.aufraeumen();
});

test('generated_at wird aus dem index.json DESSELBEN Laufs kopiert, nicht neu gestempelt', () => {
  const { f, overview, index } = baue(dreiGesunde());
  assert.equal(overview.generated_at, f.generatedAt);
  assert.equal(index.generated_at, f.generatedAt);
  f.aufraeumen();
});

test('jede Zeile traegt jedes Pflichtfeld der OverviewRow', () => {
  const { f, overview } = baue(dreiGesunde());
  assert.ok(overview.rows.length >= 3);
  for (const r of overview.rows) {
    for (const feld of ZEILE) assert.ok(feld in r, r.ticker + ' ohne Pflichtfeld ' + feld);
  }
  f.aufraeumen();
});

test('overview{}-Objekt der Vollboard-Zeile wird zur flachen quality-Form', () => {
  const { f, overview } = baue(dreiGesunde());
  const r = overview.rows[0];
  assert.equal(r.overviewKind, 'gp');
  assert.equal(r.overviewValue, 2.5);
  assert.equal(r.overviewCompanion, 180.4);
  assert.ok(!('overview' in r), 'die verschachtelte overview-Form darf nicht mitreisen');
  f.aufraeumen();
});

test('score bleibt der Engine-Score und wird nie von r40 ueberschrieben', () => {
  const { f, overview } = baue(dreiGesunde());
  const aaa = overview.rows.find((r) => r.ticker === 'AAA');
  assert.equal(aaa.score, 80);
  assert.equal(aaa.r40, 90);
  f.aufraeumen();
});

test('r40 = revGrowthPctUsed + fcfMarginPct, nachrechenbar in jeder Zeile', () => {
  const { f, overview } = baue(dreiGesunde());
  for (const r of overview.rows) {
    assert.ok(Math.abs((r.revGrowthPctUsed + r.fcfMarginPct) - r.r40) <= 0.11,
      r.ticker + ': ' + r.revGrowthPctUsed + ' + ' + r.fcfMarginPct + ' != ' + r.r40);
  }
  f.aufraeumen();
});

test('Rang laeuft 1..n und folgt fallendem r40', () => {
  const { f, overview } = baue(dreiGesunde());
  overview.rows.forEach((r, i) => assert.equal(r.rank, i + 1, r.ticker + ' hat Rang ' + r.rank));
  for (let i = 1; i < overview.rows.length; i++) {
    assert.ok(overview.rows[i].r40 <= overview.rows[i - 1].r40, 'nicht nach r40 sortiert');
  }
  f.aufraeumen();
});

test('r40Group trennt Software von Rest nach meta.industry', () => {
  const { f, overview } = baue(dreiGesunde());
  assert.equal(overview.rows.find((r) => r.ticker === 'AAA').r40Group, 'software');
  assert.equal(overview.rows.find((r) => r.ticker === 'CCC').r40Group, 'other');
  f.aufraeumen();
});

test('boardStatus traegt jeden vorkommenden formulaId als diagnostic (die Suche in shapeOverviewRow)', () => {
  const { f, overview, index } = baue(dreiGesunde());
  for (const r of overview.rows) {
    assert.equal(index.boardStatus[r.formulaId], 'diagnostic',
      'kein diagnostic-Status fuer formulaId ' + r.formulaId);
  }
  assert.equal(index.boardStatus.rule40, 'diagnostic');
  for (const s of Object.values(index.boardStatus)) {
    assert.ok(s === 'core' || s === 'diagnostic', 'unerlaubter boardStatus ' + s);
  }
  f.aufraeumen();
});

test('index.counts traegt profitable/unprofitable (screener-sync prueft boardStatus UND counts)', () => {
  const eintraege = dreiGesunde();
  eintraege[2].row.track = 'unprofitable';
  const { f, index } = baue(eintraege);
  assert.equal(index.counts.rule40.profitable, 2);
  assert.equal(index.counts.rule40.unprofitable, 1);
  f.aufraeumen();
});

test('Aufnahmeschwelle: r40 unter 40 kommt nicht ins Brett', () => {
  const { f, overview } = baue([
    { row: boardZeile({ ticker: 'AAA', revGrowthYoYPct: 60 }), snap: snapshot({ fcfMarginTTM: 30 }) },
    { row: boardZeile({ ticker: 'LOW', revGrowthYoYPct: 10 }), snap: snapshot({ fcfMarginTTM: 5 }) },  // 15
  ]);
  assert.ok(overview.rows.some((r) => r.ticker === 'AAA'));
  assert.ok(!overview.rows.some((r) => r.ticker === 'LOW'), 'r40 = 15 darf nicht im Brett stehen');
  f.aufraeumen();
});

test('--check ist auf dem frisch geschriebenen Brett gruen', () => {
  const { f } = baue(dreiGesunde());
  const res = W.check({ v1Dir: f.v1Dir, outDir: f.outDir });
  assert.equal(res.ok, true, 'check meldet: ' + JSON.stringify(res.errors));
  f.aufraeumen();
});

test('ein v2-Bump des Haupt-Index haelt das Brett an, statt es still weiterzubauen', () => {
  const f = baueExport(dreiGesunde(), { schema: 'findash-export/v2' });
  assert.throws(() => W.build({ v1Dir: f.v1Dir, snapshotsDir: f.snapshotsDir, outDir: f.outDir }),
    /Schema/);
  f.aufraeumen();
});

test('JEDE Gruppe bekommt ihre eigenen TOP_N — Software darf die Rest-Gruppe nicht verdraengen', () => {
  // Rueckfall-Waechter zum Befund vom 17.09.: 'other' musste sich ueber die GESAMT-Liste
  // qualifizieren. Weil Software das Mass dominiert, fiel die ganze Rest-Gruppe heraus,
  // obwohl jede ihrer Zeilen ueber der Aufnahmeschwelle lag — Karls zweite Ansicht waere
  // leer gewesen. Der Test baut genau diese Konstellation.
  const eintraege = [];
  for (let i = 0; i < W.TOP_N + 50; i++) {
    eintraege.push({
      row: boardZeile({ ticker: 'SW' + i, revGrowthYoYPct: 50 + (i % 40) }),
      snap: snapshot({ fcfMarginTTM: 30 }),
    });
  }
  for (let i = 0; i < 100; i++) {
    eintraege.push({
      row: boardZeile({ ticker: 'IN' + i, revGrowthYoYPct: 15 + (i % 10), sector: 'Industrials' }),
      snap: snapshot({ fcfMarginTTM: 28, industry: 'Specialty Industrial Machinery' }),
      branch: 'industrials',
    });
  }
  const { f, overview } = baue(eintraege);
  const software = overview.rows.filter((r) => r.r40Group === 'software');
  const other = overview.rows.filter((r) => r.r40Group === 'other');
  assert.equal(software.length, W.TOP_N, 'die Software-Gruppe muss ihre vollen TOP_N bekommen');
  assert.equal(other.length, 100, 'jede zulaessige Zeile der Rest-Gruppe muss im Brett stehen, hier ' + other.length);
  for (const r of other) assert.ok(r.r40 >= 40);
  f.aufraeumen();
});

bilanz('tests/rule40/contract.test.js');

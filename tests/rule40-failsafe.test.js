'use strict';
/** tests/rule40-failsafe.test.js — Standalone-Runner.
 *
 * DIE ZUSICHERUNG: wenn dieses Brett scheitert, sagt es das — statt den Stand von gestern
 * als den von heute zu servieren. Das ist keine Kosmetik: findash fasst einen 404 als
 * "noch nicht publiziert" auf und laesst seinen lokalen Spiegel stehen
 * (screener-sync.js:203-213). Ohne den _failed-Marker zeigte das Dashboard morgen frueh
 * ein Brett, das heute Nacht gar nicht gerechnet wurde, und niemand saehe es.
 *
 * Und: --check muss ein KAPUTTES Brett auch dann fangen, wenn es schon auf der Platte
 * liegt. Ein Tor, das nur gruene Bretter kennt, ist kein Tor. Jede Probe hier verbiegt
 * genau EINE Eigenschaft und erwartet genau EINE Meldung.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const W = require('../scripts/write-rule40-export.js');
const { snapshot, boardZeile, baueExport, laeufer } = require('./rule40-fixture.js');

const { test, bilanz } = laeufer();

function gesundesBrett() {
  const f = baueExport([
    { row: boardZeile({ ticker: 'AAA', revGrowthYoYPct: 60 }), snap: snapshot({ fcfMarginTTM: 30 }) },
    { row: boardZeile({ ticker: 'BBB', revGrowthYoYPct: 40 }), snap: snapshot({ fcfMarginTTM: 25 }) },
  ]);
  W.build({ v1Dir: f.v1Dir, snapshotsDir: f.snapshotsDir, outDir: f.outDir });
  return f;
}

/** Brett auf der Platte verbiegen und schauen, ob --check es meldet. */
function pruefeNachEingriff(eingriff, erwarteterTextteil) {
  const f = gesundesBrett();
  const p = path.join(f.outDir, 'overview.json');
  const overview = JSON.parse(fs.readFileSync(p, 'utf8'));
  eingriff(overview, f);
  fs.writeFileSync(p, JSON.stringify(overview, null, 2));
  const res = W.check({ v1Dir: f.v1Dir, outDir: f.outDir });
  f.aufraeumen();
  assert.equal(res.ok, false, 'check blieb gruen, obwohl das Brett verbogen wurde');
  assert.ok(res.errors.some((e) => e.includes(erwarteterTextteil)),
    'erwartet eine Meldung mit "' + erwarteterTextteil + '", bekommen: ' + JSON.stringify(res.errors));
}

test('_failed ersetzt das Brett, statt den Ordner zu loeschen', () => {
  const f = gesundesBrett();
  assert.ok(fs.existsSync(path.join(f.outDir, 'overview.json')));
  W.schreibeFehlmarker(f.outDir, 'Testausfall');
  const dateien = fs.readdirSync(f.outDir);
  assert.deepEqual(dateien, ['_failed'], 'nach dem Marker darf NUR _failed liegen, gefunden: ' + dateien);
  const marker = JSON.parse(fs.readFileSync(path.join(f.outDir, '_failed'), 'utf8'));
  assert.equal(marker.schema, 'findash-export/v1');
  assert.equal(marker.failed, true);
  assert.equal(marker.board, 'rule40');
  assert.ok(marker.reason.includes('Testausfall'), 'der Grund muss im Marker stehen');
  assert.ok(typeof marker.generated_at === 'string');
  f.aufraeumen();
});

test('--check meldet einen liegenden _failed-Marker als Ausfall', () => {
  const f = gesundesBrett();
  W.schreibeFehlmarker(f.outDir, 'Testausfall');
  const res = W.check({ v1Dir: f.v1Dir, outDir: f.outDir });
  f.aufraeumen();
  assert.equal(res.ok, false);
  assert.equal(res.failedMarker, true);
});

test('ein unlesbarer Haupt-Index schreibt den Marker, statt still zu enden (CLI-Weg)', () => {
  const f = baueExport([
    { row: boardZeile({ ticker: 'AAA', revGrowthYoYPct: 60 }), snap: snapshot({ fcfMarginTTM: 30 }) },
  ]);
  fs.writeFileSync(path.join(f.v1Dir, 'index.json'), '{ kaputt');
  const alt = { V1: process.env.RULE40_V1_DIR, S: process.env.RULE40_SNAPSHOTS_DIR, O: process.env.RULE40_OUT_DIR };
  process.env.RULE40_V1_DIR = f.v1Dir;
  process.env.RULE40_SNAPSHOTS_DIR = f.snapshotsDir;
  process.env.RULE40_OUT_DIR = f.outDir;
  const code = W.main([]);
  if (alt.V1 === undefined) delete process.env.RULE40_V1_DIR; else process.env.RULE40_V1_DIR = alt.V1;
  if (alt.S === undefined) delete process.env.RULE40_SNAPSHOTS_DIR; else process.env.RULE40_SNAPSHOTS_DIR = alt.S;
  if (alt.O === undefined) delete process.env.RULE40_OUT_DIR; else process.env.RULE40_OUT_DIR = alt.O;
  const dateien = fs.readdirSync(f.outDir);
  f.aufraeumen();
  assert.equal(code, 1, 'ein gescheiterter Build muss einen Fehlercode liefern');
  assert.deepEqual(dateien, ['_failed']);
});

test('--check faengt eine falsche Rangfolge', () => {
  pruefeNachEingriff((o) => { const t = o.rows[0]; o.rows[0] = o.rows[1]; o.rows[1] = t; }, 'rank');
});

test('--check faengt eine Summe, die nicht aufgeht', () => {
  pruefeNachEingriff((o) => { o.rows[0].r40 = o.rows[0].r40 + 7; }, '!=');
});

test('--check faengt eine Zeile unter der Aufnahmeschwelle', () => {
  pruefeNachEingriff((o) => {
    o.rows[1].r40 = 10;
    o.rows[1].revGrowthPctUsed = 5;
    o.rows[1].fcfMarginPct = 5;
  }, 'Aufnahmeschwelle');
});

test('--check faengt ein generated_at, das nicht aus diesem Lauf stammt', () => {
  pruefeNachEingriff((o) => { o.generated_at = '2020-01-01T00:00:00.000Z'; }, 'generated_at');
});

test('--check faengt ein fehlendes Pflichtfeld der Zeile', () => {
  pruefeNachEingriff((o) => { delete o.rows[0].cohortFallback; }, 'cohortFallback');
});

test('--check faengt einen doppelten Ticker', () => {
  pruefeNachEingriff((o) => { o.rows[1].ticker = o.rows[0].ticker; }, 'zweimal');
});

test('--check faengt einen v2-Bump der geschriebenen Datei', () => {
  pruefeNachEingriff((o) => { o.schema = 'findash-export/v2'; }, 'Schema');
});

test('--check faengt ein verschwundenes r40 (nicht nachrechenbar)', () => {
  pruefeNachEingriff((o) => { delete o.rows[0].revGrowthPctUsed; }, 'nicht nachrechenbar');
});

test('ein gescheiterter --check ueber die CLI setzt den Marker (der CI-Schritt laeuft fail-soft)', () => {
  const f = gesundesBrett();
  const p = path.join(f.outDir, 'overview.json');
  const overview = JSON.parse(fs.readFileSync(p, 'utf8'));
  overview.rows[0].r40 = overview.rows[0].r40 + 7;          // Summe geht nicht mehr auf
  fs.writeFileSync(p, JSON.stringify(overview, null, 2));

  const alt = { V1: process.env.RULE40_V1_DIR, O: process.env.RULE40_OUT_DIR };
  process.env.RULE40_V1_DIR = f.v1Dir;
  process.env.RULE40_OUT_DIR = f.outDir;
  const code = W.main(['--check']);
  if (alt.V1 === undefined) delete process.env.RULE40_V1_DIR; else process.env.RULE40_V1_DIR = alt.V1;
  if (alt.O === undefined) delete process.env.RULE40_OUT_DIR; else process.env.RULE40_OUT_DIR = alt.O;

  const dateien = fs.readdirSync(f.outDir);
  f.aufraeumen();
  assert.equal(code, 1);
  assert.deepEqual(dateien, ['_failed'],
    'ein Brett, das sein Tor nicht besteht, darf nicht als gueltiges Brett liegen bleiben');
});

bilanz('tests/rule40-failsafe.test.js');

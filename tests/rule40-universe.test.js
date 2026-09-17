'use strict';
/** tests/rule40-universe.test.js — Standalone-Runner.
 *
 * DIE ZUSICHERUNG: das Brett steht auf dem GEROUTETEN Universum, nicht auf den Brett-Zeilen,
 * und die drei Regeln, die dabei neu dazukommen, halten: das Margen-Tor ohne G3, der
 * Sektor-Ausschluss und der Emittenten-Dedup.
 *
 * WARUM ES DIESEN TEST GIBT: die Vollboards sind die besten 150 je Branche NACH ENGINE-SCORE.
 * Eine Rule-of-40-Liste, die durch genau die Formel vorgefiltert ist, an der Karl zweifelt,
 * waere keine Gegenprobe — und reife Namen mit hoher Marge und massvollem Wachstum fehlten
 * darin. Der Weg ueber snapshots/ + router.route() holt sie zurueck, bringt aber drei
 * Nebenwirkungen mit, die vorher niemand hatte. Jede bekommt hier ihren Waechter.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const W = require('../scripts/write-rule40-export.js');
const { fcfMarginValid } = require('../src/scoring/engine.js');
const { norm } = require('../src/scoring/snapshot.js');
const { snapshot, boardZeile, baueExport, setzeWachstum, laeufer } = require('./rule40-fixture.js');

const { test, bilanz } = laeufer();

function baue(eintraege) {
  const f = baueExport(eintraege);
  const res = W.build({ v1Dir: f.v1Dir, snapshotsDir: f.snapshotsDir, outDir: f.outDir });
  const overview = JSON.parse(fs.readFileSync(path.join(f.outDir, 'overview.json'), 'utf8'));
  const index = JSON.parse(fs.readFileSync(path.join(f.outDir, 'index.json'), 'utf8'));
  return { f, res, overview, index };
}

// --- Margen-Tor: G0-G2 ohne G3 ---------------------------------------------
test('PARITAET: was die Engine akzeptiert, akzeptiert der Schreiber auch — die Differenz ist genau G3', () => {
  // Die Kopie im Schreiber ist Absicht (engine.js exportiert die Tore nicht einzeln). Damit
  // sie nicht davonlaeuft, wird sie hier gegen das Original gehalten: fuer jede Kombination
  // muss gelten "Engine gueltig => Schreiber gueltig", und jeder Unterschied muss G3 sein
  // (Summe der zwei juengsten present FCF-Jahre < 0).
  const faelle = [];
  const margen = [30, -30, 0.0001, -0.0001, null, NaN];
  const fcfReihen = [[120e6, 100e6], [-120e6, -100e6], [-50e6, 30e6], [30e6, -50e6], [], [null, null], [null, 80e6]];
  const ocfReihen = [[150e6, 130e6], [-150e6, -130e6], [], [null, null]];
  for (const m of margen) for (const f of fcfReihen) for (const o of ocfReihen) faelle.push([m, f, o]);

  let g3Differenzen = 0;
  for (const [m, f, o] of faelle) {
    const s = { annual: { annualFCF: f.map((v) => ({ value: v })), annualOCF: o.map((v) => ({ value: v })) } };
    const nf = norm(s, 'annualFCF'), no = norm(s, 'annualOCF');
    const engine = fcfMarginValid(m, nf, no);
    const schreiber = W.fcfMargeVertrauenswuerdig(m, nf, no);
    if (engine) {
      assert.equal(schreiber, true,
        'Engine akzeptiert, Schreiber nicht — das Tor ist STRENGER geworden: ' + JSON.stringify([m, f, o]));
    }
    if (schreiber && !engine) {
      // Der einzige erlaubte Unterschied: G3 (juengstes 2-Jahres-Fenster negativ).
      const summe = (arr) => arr.filter((v) => Number.isFinite(v)).slice(0, 2).reduce((a, b) => a + b, 0);
      const rFcf = nf.some(Number.isFinite) ? summe(nf) : null;
      const rOcf = no.some(Number.isFinite) ? summe(no) : null;
      assert.ok(!((rFcf !== null && rFcf >= 0) || (rOcf !== null && rOcf >= 0)),
        'Schreiber akzeptiert etwas, das NICHT an G3 liegt: ' + JSON.stringify([m, f, o]));
      g3Differenzen++;
    }
  }
  assert.ok(g3Differenzen > 0, 'kein einziger G3-Fall geprueft — der Test waere blind');
});

test('ein wachsender Name mit juengstem Cash-Burn bleibt im Brett (G3 wuerde ihn werfen)', () => {
  // Der Regelfall, um den es geht: hohe Wachstumsrate, negative FCF-Marge, negative
  // juengste FCF-Jahre. Die Engine wirft ihn (G3), Rule of 40 will ihn sehen.
  const s = snapshot({ fcfMarginTTM: -20, annualFCF: [-50e6, -60e6, -70e6], annualOCF: [-40e6, -50e6, -60e6] });
  assert.equal(fcfMarginValid(-20, norm(s, 'annualFCF'), norm(s, 'annualOCF')), false, 'G3 muss hier greifen');
  assert.equal(W.fcfMargeVertrauenswuerdig(-20, norm(s, 'annualFCF'), norm(s, 'annualOCF')), true);
  const { f, overview } = baue([{ row: boardZeile({ ticker: 'BURN', revGrowthYoYPct: 80 }), snap: s }]);
  const burn = overview.rows.find((r) => r.ticker === 'BURN');
  assert.ok(burn, 'der wachsende Cash-Verbrenner fehlt im Brett');
  assert.equal(burn.r40, 60);        // 80 - 20
  f.aufraeumen();
});

test('das Vorzeichen-Tor G2 bleibt scharf — es ist eine Daten-, keine Wirtschaftsaussage', () => {
  const s = snapshot({ fcfMarginTTM: 30, annualFCF: [-50e6, -60e6, -70e6] });
  assert.equal(W.fcfMargeVertrauenswuerdig(30, norm(s, 'annualFCF'), norm(s, 'annualOCF')), false);
});

// --- Sektor-Ausschluss -----------------------------------------------------
test('Finanzwerte und Immobilien fliegen im SCHREIBER raus, nicht erst in der Oberflaeche', () => {
  const eintraege = [
    { row: boardZeile({ ticker: 'AAA', revGrowthYoYPct: 60 }), snap: snapshot({ fcfMarginTTM: 30 }) },
    { row: boardZeile({ ticker: 'REIT', revGrowthYoYPct: 90, sector: 'Real Estate' }),
      snap: snapshot({ fcfMarginTTM: 80, sector: 'Real Estate', industry: 'REIT - Healthcare Facilities' }),
      branch: 'real-estate' },
    { row: boardZeile({ ticker: 'BANKY', revGrowthYoYPct: 85, sector: 'Financial Services' }),
      snap: snapshot({ fcfMarginTTM: 70, sector: 'Financial Services', industry: 'Asset Management' }),
      branch: 'financials' },
  ];
  const { f, overview, index } = baue(eintraege);
  const ticker = overview.rows.map((r) => r.ticker);
  assert.ok(ticker.includes('AAA'));
  assert.ok(!ticker.includes('REIT'), 'ein REIT mit 80 % FCF-Marge haette das Brett angefuehrt');
  assert.ok(!ticker.includes('BANKY'));
  assert.equal(index.rule40.counts.excludedSector, 2);
  assert.deepEqual(index.rule40.sectorExclusions, ['Financial Services', 'Real Estate']);
  f.aufraeumen();
});

// --- Emittenten-Dedup ------------------------------------------------------
test('mehrere Notierungen desselben Emittenten werden auf EINE Zeile reduziert', () => {
  // Am Stand 2026-08-29 stand Palantir sechsmal im Brett (PLTR, PLTR.SW, PLTR.VI, PLTR.WA,
  // PTX.DE, 1PLTR.MI) — und mit ZWEI verschiedenen r40-Werten, weil die Beine unterschiedlich
  // gute Daten tragen. Das geroutete Universum enthaelt jede NOTIERUNG; die Vollboards waren
  // bereits dedupliziert, dieser Weg ist es nicht.
  const eintraege = [
    { row: boardZeile({ ticker: 'XYZ', revGrowthYoYPct: 60 }),
      snap: snapshot({ fcfMarginTTM: 30, name: 'Xyz Technologies Inc' }) },
    { row: boardZeile({ ticker: 'XYZ.SW', revGrowthYoYPct: 70 }),
      snap: snapshot({ fcfMarginTTM: 30, name: 'Xyz Technologies Inc', exchangeName: 'Swiss', country: 'Switzerland', region: 'CH' }) },
    { row: boardZeile({ ticker: 'XYZ.VI', revGrowthYoYPct: 65 }),
      snap: snapshot({ fcfMarginTTM: 30, name: 'Xyz Technologies Inc', exchangeName: 'Vienna', country: 'Austria', region: 'AT' }) },
  ];
  const { f, overview, index } = baue(eintraege);
  const xyz = overview.rows.filter((r) => /^XYZ/.test(r.ticker));
  assert.equal(xyz.length, 1, 'erwartet EINE Zeile, gefunden: ' + xyz.map((r) => r.ticker).join(', '));
  assert.equal(xyz[0].ticker, 'XYZ', 'das US-primaer gelistete Bein muss gewinnen');
  assert.equal(index.rule40.counts.excludedDuplicateIssuer, 2);
  f.aufraeumen();
});

test('zwei verschiedene Firmen werden NICHT verschmolzen', () => {
  const { f, overview } = baue([
    { row: boardZeile({ ticker: 'AAA', revGrowthYoYPct: 60 }), snap: snapshot({ fcfMarginTTM: 30, name: 'Alpha Inc' }) },
    { row: boardZeile({ ticker: 'BBB', revGrowthYoYPct: 55 }), snap: snapshot({ fcfMarginTTM: 30, name: 'Beta Inc' }) },
  ]);
  assert.equal(overview.rows.length, 2);
  f.aufraeumen();
});

// --- Zaehler ---------------------------------------------------------------
test('index.json traegt den Erklaer-Kasten: Universumsbasis, Schranken und jeden Ausschlussgrund', () => {
  const { f, index } = baue([
    { row: boardZeile({ ticker: 'AAA', revGrowthYoYPct: 60 }), snap: snapshot({ fcfMarginTTM: 30 }) },
    { row: boardZeile({ ticker: 'BBB', revGrowthYoYPct: 40 }), snap: snapshot({ fcfMarginTTM: 25 }) },
  ]);
  const c = index.rule40.counts;
  assert.equal(c.universeBasis, 'routed');
  assert.equal(index.rule40.universeBasis, 'routed');
  for (const feld of ['universe', 'onBoard', 'computable', 'above40', 'exported', 'excludedNotRouted',
    'excludedSector', 'excludedOutlier', 'excludedStale', 'excludedTinyBase', 'excludedFcfAboveRevenue',
    'excludedDuplicateIssuer', 'noValidMargin', 'noGrowth', 'noRank', 'unreadableSnapshot', 'missingFullBoard']) {
    assert.equal(typeof c[feld], 'number', 'Zaehler ' + feld + ' fehlt');
  }
  assert.equal(c.exported, 2);
  assert.equal(c.above40, 2);
  // growthBounds ist null, solange zu wenige Kandidaten fuer einen 1-%-Rand da sind —
  // und das muss SICHTBAR sein, nicht stillschweigend.
  assert.ok('growthBounds' in index.rule40);
  f.aufraeumen();
});

test('die Winsor-Schranken stehen als p1/p99 in der index.json, sobald geklemmt wird', () => {
  const eintraege = [];
  for (let i = 0; i < W.MIN_WINSOR_SAMPLE + 20; i++) {
    const s = snapshot({ fcfMarginTTM: 30, name: 'Firma ' + i + ' Inc' });
    setzeWachstum(s, 20 + (i % 50));
    eintraege.push({ row: boardZeile({ ticker: 'T' + i, revGrowthYoYPct: 20 + (i % 50) }), snap: s });
  }
  const { f, index } = baue(eintraege);
  assert.ok(index.rule40.growthBounds, 'ab MIN_WINSOR_SAMPLE muessen Schranken dastehen');
  assert.equal(typeof index.rule40.growthBounds.p1, 'number');
  assert.equal(typeof index.rule40.growthBounds.p99, 'number');
  assert.ok(index.rule40.growthBounds.p1 < index.rule40.growthBounds.p99);
  f.aufraeumen();
});

bilanz('tests/rule40-universe.test.js');

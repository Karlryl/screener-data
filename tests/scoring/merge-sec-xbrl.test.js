'use strict';
/**
 * EDGAR-Merge-Test (AUFGABE 1): tiefe SEC-ANNUAL-Serien aus companyfacts.
 * Fixture = getrimmte echte Micron-companyfacts (tests/scoring/fixtures/sec-micron.json,
 * nur 10-K/FY-Eintraege) -> KEIN Netzwerk. Prueft: 15-Jahres-Tiefe inkl. 2023-Zyklusverlust,
 * Umsatz-Multi-Konzept-Union, FCF=OCF-Capex mit null-Luecken, Index-Alignment, sowie den
 * namespace- (additiv) vs replace-Merge und die norm()-Transparenz.
 *
 * Usage:  node tests/scoring/merge-sec-xbrl.test.js   (Exit 0/1)
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { extractSecSeries, mergeSecIntoSnapshot, overlapDivergence } = require('../../merge-sec-xbrl.js');
const { norm } = require('../../src/scoring/snapshot.js');

let pass = 0, fail = 0;
function test(name, fn) { try { fn(); pass++; console.log('  ok   ' + name); } catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); } }

const micron = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'sec-micron.json'), 'utf8'));
const sec = extractSecSeries(micron);
const vals = (arr) => arr.map((x) => x.value);

// --- Tiefe: 15 Fiskaljahre 2011-2025 ---------------------------------------
test('annual: 15 Fiskaljahre 2011-2025 newest-first', () => {
  assert.deepEqual(sec.annual._fys, [2025, 2024, 2023, 2022, 2021, 2020, 2019, 2018, 2017, 2016, 2015, 2014, 2013, 2012, 2011]);
});

// --- OpInc inkl. dem 2023er Zyklus-Verlust ----------------------------------
test('annualOpInc: 15 Punkte, newest 9.77B, 2023 negativ (Zyklusverlust)', () => {
  const oi = vals(sec.annual.annualOpInc);
  assert.equal(oi.length, 15);
  assert.equal(oi[0], 9770000000);
  assert.equal(oi[2], -5745000000);          // FY2023 operativer Verlust
  assert.ok(oi[2] < 0, '2023 muss negativ sein');
  assert.equal(oi[13], -618000000);          // FY2012 (zweiter Zyklus-Verlust tief in der Historie)
});

// --- NetIncome ebenfalls tief inkl. 2023 -----------------------------------
test('annualNetIncome: 15 Punkte, 2023 negativ', () => {
  const ni = vals(sec.annual.annualNetIncome);
  assert.equal(ni.length, 15);
  assert.ok(ni[2] < 0, '2023 NetIncome negativ');
});

// --- Umsatz: Multi-Konzept-Union ueber die Zeit (RFCWCEAT ∪ Revenues ∪ SalesRevenueNet) ---
test('annualRev: Multi-Konzept-Union, 15 Punkte, keine Luecke', () => {
  const rev = vals(sec.annual.annualRev);
  assert.equal(rev.length, 15);
  assert.ok(rev.every((v) => Number.isFinite(v)), 'kein Umsatz-Jahr darf null sein (Union deckt alle 15J)');
  assert.equal(rev[0], 37378000000);         // FY2025 (RevenueFromContractWithCustomer...)
  assert.equal(rev[7], 30391000000);         // FY2018 (Revenues-Konzept, Uebergangsjahr)
  assert.equal(rev[14], 8788000000);         // FY2011 (SalesRevenueNet)
});

// --- FCF = OCF - Capex, null-Luecke wo OCF fehlt (2013-2016) -----------------
test('annualFCF: OCF-Capex, newest 1.668B, null-Luecke statt 0 wo OCF fehlt', () => {
  const fcf = vals(sec.annual.annualFCF);
  assert.equal(fcf.length, 15);
  assert.equal(fcf[0], 1668000000);          // 17.52B OCF - 15.86B Capex
  // OCF fehlt fuer 2013-2016 (Indizes 9..12) -> null (NICHT 0)
  assert.equal(fcf[9], null);
  assert.equal(fcf[12], null);
});

// --- Index-Alignment ueber die annual-Serien --------------------------------
test('annual: alle emittierten Serien index-aligned auf 15 Jahre', () => {
  for (const f of ['annualRev', 'annualOpInc', 'annualNetIncome', 'annualFCF', 'annualOCF', 'annualGP']) {
    assert.equal(sec.annual[f].length, 15, f + ' laenge');
  }
});

// --- overlapDivergence: SEC vs Yahoo (fuehrende Jahre) ----------------------
test('overlapDivergence: identische fuehrende Jahre -> 0', () => {
  const yahoo = sec.annual.annualRev.slice(0, 4); // simuliere Yahoo = SEC-Fuehrung
  const d = overlapDivergence(yahoo, sec.annual.annualRev);
  assert.equal(d.compared, 4);
  assert.ok(d.maxRel < 1e-9);
});

// --- Merge: namespace-Modus ist rein additiv (Scoring-Felder unberuehrt) -----
test('merge namespace: additiv, annual-Standardfeld unberuehrt, secAnnual gesetzt', () => {
  const snap = { annual: { annualOpInc: [{ value: 9809000000 }, { value: 1305000000 }, { value: -5405000000 }, { value: 9709000000 }] } };
  const before = JSON.stringify(snap.annual.annualOpInc);
  const rep = mergeSecIntoSnapshot(snap, sec, { mode: 'namespace' });
  assert.equal(rep.mode, 'namespace');
  assert.equal(JSON.stringify(snap.annual.annualOpInc), before, 'Standard-annualOpInc darf sich NICHT aendern');
  assert.equal(snap.secAnnual.annualOpInc.length, 15, 'tiefe Serie unter secAnnual');
});

// --- Merge: replace-Modus vertieft das Standardfeld (score-aendernd) + norm()-Transparenz ---
test('merge replace: annualOpInc auf 15J vertieft, norm() liest transparent', () => {
  const snap = { annual: { annualOpInc: [{ value: 9809000000 }, { value: 1305000000 }, { value: -5405000000 }, { value: 9709000000 }],
                           annualRev: [{ value: 37378000000 }, { value: 25111000000 }, { value: 15540000000 }, { value: 30758000000 }] } };
  const rep = mergeSecIntoSnapshot(snap, sec, { mode: 'replace' });
  assert.equal(rep.mode, 'replace');
  assert.equal(snap.annual.annualOpInc.length, 15, 'replace vertieft auf 15 Jahre');
  const series = norm(snap, 'annualOpInc');
  assert.equal(series.length, 15);
  assert.equal(series[2], -5745000000, 'norm() liefert den tiefen SEC-2023-Verlust');
});

// --- Merge: grobe Overlap-Divergenz flaggt + behaelt Yahoo im replace-Modus ---
test('merge replace: grobe Divergenz -> Feld NICHT ersetzt, geflaggt', () => {
  const snap = { annual: { annualRev: [{ value: 1000 }, { value: 900 }, { value: 800 }, { value: 700 }] } }; // absurd klein
  const rep = mergeSecIntoSnapshot(snap, sec, { mode: 'replace' });
  assert.ok(rep.divergences.annualRev > 0.12, 'Divergenz geflaggt');
  assert.equal(snap.annual.annualRev.length, 4, 'divergentes Feld bleibt bei Yahoo (nicht ersetzt)');
});

// --- Bug 14: reine SEC-Null-Serie (Konzept fehlt) darf echte Yahoo-Werte NICHT ueberschreiben ---
test('merge replace [Bug14]: SEC-Null-Serie ueberschreibt echte Yahoo-Serie nicht', () => {
  const snap = { annual: { annualOpInc: [{ value: 40 }, { value: 35 }] } };
  const secNull = { annual: { annualOpInc: [{ value: null }, { value: null }], _fys: [2024, 2023] } };
  mergeSecIntoSnapshot(snap, secNull, { mode: 'replace' });
  assert.deepEqual(vals(snap.annual.annualOpInc), [40, 35], 'Yahoo [40,35] darf nicht [null,null] werden');
});

// --- Bug 15: annualOCF/annualFCF werden jetzt auf Divergenz geprueft (vorher toter Guard) ---
test('merge replace [Bug15]: OCF 50 vs SEC 500 (10x) -> geflaggt, NICHT ersetzt', () => {
  const snap = { annual: { annualOCF: [{ value: 50 }] } };
  const secOcf = { annual: { annualOCF: [{ value: 500 }], _fys: [2024] } };
  const rep = mergeSecIntoSnapshot(snap, secOcf, { mode: 'replace' });
  assert.ok(rep.divergences.annualOCF > 0.12, 'annualOCF-Divergenz muss geflaggt sein');
  assert.deepEqual(vals(snap.annual.annualOCF), [50], 'OCF 50 darf nicht durch 500 ersetzt werden');
});

// --- Bug 14: fehlt Yahoo das Feld ganz, darf SEC weiterhin vertiefen (compared===0 ist kein Konflikt) ---
test('merge replace [Bug14]: Yahoo-freies Feld wird aus SEC vertieft', () => {
  const snap = { annual: { annualRev: [{ value: 37378000000 }, { value: 25111000000 }, { value: 15540000000 }, { value: 30758000000 }] } };
  mergeSecIntoSnapshot(snap, sec, { mode: 'replace' });
  assert.equal(snap.annual.annualOCF.length, 15, 'annualOCF (bei Yahoo abwesend) wird auf SEC-Tiefe gesetzt');
});

console.log(`\nmerge-sec-xbrl.test.js: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);

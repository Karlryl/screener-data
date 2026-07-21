'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { shareGrowthRate, buildShareGrowthPctlFn, shareCountDilution, LAMPS } = require('../../src/scoring/lamps.js');

// Echte SEC-annual-Aktienzahl-Serien (external-data/sec-secannual.json, 2026-07-21-Regen), newest-first,
// als {value}-Objekte wie run-screener.js sie in snapshot.secAnnual.annualShares anliefert.
const asShares = (arr) => arr.map((v) => ({ value: v }));
function snap(annualShares) { return { secAnnual: { annualShares: asShares(annualShares) } }; }

// NVAX: 15 Jahre, ENTHAELT einen echten 1:~14.4-Reverse-Split (382850125 -> 26577433 zwischen zwei GJ)
// UND nachhaltige echte Verwaesserung in den uebrigen Jahren (Novavax' bekannte Secondary-Historie).
const NVAX = [162498995, 160184994, 118790222, 78503952, 75608073, 63659952, 26577433, 382850125,
  313616221, 271245967, 269858393, 238477974, 208510739, 147941442, 114971796];
// MMI: 13 Jahre, praktisch flache Aktienzahl (kein aktives Verwaesserungs-/Buyback-Programm) -> Negativ-Fixture.
const MMI = [38922604, 38823704, 38384569, 39365723, 39667728, 39376477, 39132236, 38651360,
  38140801, 37616243, 37117674, 36623781, 36600897];
// GME: 17 Jahre, ENTHAELT den bekannten 4-fuer-1-Split (Juli 2022): 304578070 -> 76350781 (Ratio~3.989).
const GME = [448009480, 446800365, 305514315, 304578070, 76350781, 69746960, 65922283, 101967550,
  101304394, 101874578, 104670330, 108515426, 115810737, 121180041, 136424174, 151396983, 164767330];

test('shareGrowthRate: Split/Reverse-Split-Beine werden ausgefiltert, organische Beine bleiben', () => {
  // NVAX-Reverse-Split-Bein waere -93% (26577433/382850125-1) -- Median bleibt deutlich positiv, kein
  // Verzerrungs-Ausreisser durch den Split.
  const gNvax = shareGrowthRate(snap(NVAX));
  assert.ok(gNvax > 0.1, `NVAX Median-Wachstum sollte trotz Reverse-Split klar positiv sein, war ${gNvax}`);
  // GME-4:1-Split waere +299% (304578070/76350781-1) -- ohne Gate wuerde das den Median komplett kippen.
  const gGme = shareGrowthRate(snap(GME));
  assert.ok(gGme < 0.05, `GME Median-Wachstum sollte nach Split-Filter klein/negativ sein (Buyback-Historie), war ${gGme}`);
  const gMmi = shareGrowthRate(snap(MMI));
  assert.ok(Math.abs(gMmi) < 0.02, `MMI sollte nahezu flach sein, war ${gMmi}`);
});

test('shareCountDilution: Positiv-Fixture (NVAX) leuchtet, Negativ-Fixture (MMI) nicht, im selben Kohorten-Kontext', () => {
  const cohort = [snap(NVAX), snap(MMI), snap(GME)];
  const pctlFn = buildShareGrowthPctlFn(cohort);
  assert.ok(typeof pctlFn === 'function', 'Kohorte mit 3 distinkten Werten sollte eine Perzentil-Funktion liefern');
  const ctx = { shareGrowthPctlFn: pctlFn };
  assert.equal(shareCountDilution(snap(NVAX), ctx), true, 'NVAX (staerkste organische Verwaesserung der Kohorte) muss feuern');
  assert.equal(shareCountDilution(snap(MMI), ctx), false, 'MMI (flach) darf nicht feuern');
});

test('shareCountDilution: ohne Kohorten-Kontext (HG/QC-Boards) nicht bewertbar (null), byte-identisches Verhalten dort', () => {
  assert.equal(shareCountDilution(snap(NVAX), undefined), null);
  assert.equal(shareCountDilution(snap(NVAX), {}), null);
});

test('shareCountDilution: fehlende secAnnual.annualShares -> nicht bewertbar (null)', () => {
  assert.equal(shareGrowthRate({}), null);
  assert.equal(shareCountDilution({}, { shareGrowthPctlFn: () => 0.9 }), null);
});

test('evaluateLamps: bestehende 14 Lampen ignorieren den neuen ctx-Parameter (arity 1, byte-identisch)', () => {
  const { evaluateLamps } = require('../../src/scoring/lamps.js');
  const s = { meta: {}, secAnnual: { annualShares: asShares(MMI) } };
  const withoutCtx = evaluateLamps(s);
  const withCtx = evaluateLamps(s, { shareGrowthPctlFn: () => 0.99 });
  for (const name of Object.keys(LAMPS)) {
    if (name === 'shareCountDilution') continue;
    assert.equal(withCtx.flags[name], withoutCtx.flags[name], `Lampe ${name} darf sich durch ctx nicht aendern`);
  }
});

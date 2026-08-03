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

// --- Reichweite (Review-Befund 03.08.2026) ----------------------------------
// Die Lampe las NUR secAnnual (~100 Namen) und war fuer 99 % des Universums stumm — am
// lokalen Baum sogar fuer 100 % (0 von 3.042 gerouteten Zeilen hatten ueberhaupt eine
// Wachstumsrate). Yahoo liefert dieselbe Groesse fuer 12.418 von 12.501 Snapshots, nur
// flacher (~4 GJ statt 10-15). GATE VOR DEM UMBAU: die Lampe hat KEINEN Score-Effekt —
// sie steht nicht in DATA_SUSPECT_LAMPS und wird in runSmallcapPass erst NACH
// scoreUniverse angehaengt. Deshalb darf sie ausgeweitet werden.
test('shareGrowthRate: faellt auf die Yahoo-Jahresreihe zurueck, wenn secAnnual fehlt', () => {
  // Yahoo speichert annualShares als SKALAR-Array (FIELD_REGISTRY), newest-first.
  const yahooSnap = (arr) => ({ annual: { annualShares: arr } });
  const g = shareGrowthRate(yahooSnap([110, 105, 100, 100]));
  assert.ok(g !== null, 'die Yahoo-Reihe muss gelesen werden');
  assert.ok(g > 0.02 && g < 0.06, `Median der Beine ~4,8 %/4,8 %/0 % erwartet, war ${g}`);
  // Ohne JEDE Quelle bleibt es null (unveraendert).
  assert.equal(shareGrowthRate({ annual: {} }), null);
});

test('shareGrowthRate: die TIEFE SEC-Reihe hat Vorrang vor der flachen Yahoo-Reihe', () => {
  const beides = { secAnnual: { annualShares: asShares(MMI) }, annual: { annualShares: [200, 100] } };
  // Yahoo allein waere +100 % — kommt die flache Reihe durch, ist der Vorrang gebrochen.
  const g = shareGrowthRate(beides);
  assert.ok(Math.abs(g) < 0.02, `MMI (flach) muss gewinnen, war ${g}`);
});

test('shareGrowthRate: der Split-Guard wirkt auch auf der Yahoo-Reihe', () => {
  // 4-fuer-1-Split zwischen den zwei juengsten Jahren (Ratio 4) plus zwei organische Beine.
  const g = shareGrowthRate({ annual: { annualShares: [400, 100, 98, 96] } });
  assert.ok(g !== null && g < 0.05,
    `das Split-Bein (Ratio 4) muss ausgefiltert werden, sonst kippt der Median; war ${g}`);
});

test('FIELD_REGISTRY kennt annualShares als annual/scalar (sonst wirft norm)', () => {
  const { FIELD_REGISTRY, norm } = require('../../src/scoring/snapshot.js');
  assert.deepEqual(FIELD_REGISTRY.annualShares, ['annual', 'scalar']);
  assert.deepEqual(norm({ annual: { annualShares: [10, null, 8] } }, 'annualShares'), [10, null, 8]);
});

// --- Erreichbarkeit (Review-Befund 03.08.2026, der schwerere Teil) ----------
// Die Nachbearbeitung in runSmallcapPass las e.snapshot — das loescht scoreUniverse aber am
// Ende jedes Laufs (score.js :1242). Sie bekam also fuer JEDE Zeile undefined,
// buildShareGrowthPctlFn lieferte fuer JEDE Kohorte null, und die Lampe konnte seit ihrer
// Verdrahtung strukturell NIE feuern. Unsichtbar war das, weil "keine Lampe" genauso aussieht
// wie "keine Verwaesserung". Dieser Waechter fuehrt die echte Produktionsfunktion aus.
test('lampeBNachruesten: die Lampe erreicht die Ergebniszeilen wirklich (Ergebniszeilen OHNE .snapshot)', () => {
  const { lampeBNachruesten } = require('../../src/scoring/run-screener.js');
  const universum = [
    { meta: { ticker: 'NVAXT' }, secAnnual: { annualShares: asShares(NVAX) } },
    { meta: { ticker: 'MMIT' }, secAnnual: { annualShares: asShares(MMI) } },
    { meta: { ticker: 'GMET' }, secAnnual: { annualShares: asShares(GME) } },
  ];
  // GENAU die Form, die scoreUniverse zurueckgibt: mit ticker, OHNE snapshot.
  const zeilen = ['NVAXT', 'MMIT', 'GMET'].map((t, i) => ({
    ticker: t, action: 'route', score: 50 - i, formulaId: 'testformel', track: 'profitable', lamps: [],
  }));
  const gefeuert = lampeBNachruesten(zeilen, universum);
  assert.equal(gefeuert, 1, 'genau der staerkste Verwaesserer der Kohorte muss feuern');
  assert.deepEqual(zeilen[0].lamps, ['shareCountDilution'], 'NVAXT (p75+) muss die Lampe tragen');
  assert.deepEqual(zeilen[1].lamps, [], 'MMIT (flach) darf sie nicht tragen');
});

test('lampeBNachruesten: nicht-geroutete Zeilen bleiben unberuehrt', () => {
  const { lampeBNachruesten } = require('../../src/scoring/run-screener.js');
  const universum = [{ meta: { ticker: 'NVAXT' }, secAnnual: { annualShares: asShares(NVAX) } },
    { meta: { ticker: 'MMIT' }, secAnnual: { annualShares: asShares(MMI) } }];
  const zeilen = [
    { ticker: 'NVAXT', action: 'exclude', score: null, formulaId: null, track: null, lamps: [] },
    { ticker: 'MMIT', action: 'route', score: 10, formulaId: 'f', track: 'profitable', lamps: [] },
  ];
  assert.equal(lampeBNachruesten(zeilen, universum), 0, 'eine Kohorte aus einem Namen hat keine Verteilung');
  assert.deepEqual(zeilen[0].lamps, []);
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

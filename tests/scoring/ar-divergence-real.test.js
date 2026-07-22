'use strict';
/**
 * 5.2 Karls Auflage 2b: Manipulations-Lampe SEPARAT von Lampe B (Verwaesserung, Tag 423)
 * bewiesen. Mechanismus (vor dem Test benannt): arDivergence (lamps.js #7) - Forderungen
 * (accountsReceivable) wachsen deutlich schneller als der Umsatz -> klassisches Channel-
 * Stuffing-/vorzeitige-Umsatzrealisierungs-Warnsignal. Eigener Datenweg (Yahoo-Bilanz),
 * eigene Schwelle (TH.AR_DIVERGENCE=0.15, unveraendert), komplett getrennt von Lampe B
 * (SEC-annualShares). Die Lampe selbst existiert bereits (nicht neu gebaut) - dieser Test
 * hebt ihren Beweis von synthetisch (tests/scoring/lamps.test.js) auf ECHTE Faelle, wie es
 * Auflage 2a fuer Lampe B verlangt hatte.
 *
 * Echte SEC/Yahoo-Bilanzdaten aus snapshots/{IPI,MCFT}.json (5.2-Bootstrap-Pull 2026-07-21):
 *   Positiv: Intrepid Potash (IPI) - AR +50.3% (22.465M->33.776M) vs Umsatz +17.1%
 *     (254.694M->298.328M) im selben Jahr -> 33.2 Prozentpunkte Divergenz.
 *   Negativ: Carriage Services (CSV) FY2018 - Umsatz WAECHST +3.8% (258.139M->267.992M)
 *     waehrend AR FAELLT -3.9% (19.655M->18.897M) -> genau das GEGENTEIL des Manipulations-
 *     Musters (echte SEC-10-K-Werte, CIK 0001016281).
 *   Kreuz-Review-Korrektur (Codex 2026-07-22): die urspruengliche MCFT-Fixture war
 *     newest-first FALSCH etikettiert — dort FIEL der Umsatz (322.351M->284.203M), der Test
 *     pruefte also NICHT den benannten "Umsatz waechst"-Fall. CSV FY2018 zeigt ihn real.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { arDivergence } = require('../../src/scoring/lamps.js');

test('arDivergence: Positiv-Fixture Intrepid Potash (IPI) - AR waechst 33pp schneller als Umsatz -> true', () => {
  const s = { annual: {
    annualRev: [{ value: 298328000 }, { value: 254694000 }, { value: 279083000 }],
    annualBalance: [{ accountsReceivable: 33776000 }, { accountsReceivable: 22465000 }, { accountsReceivable: 22077000 }],
  } };
  assert.equal(arDivergence(s), true);
});

test('arDivergence: Negativ-Fixture Carriage Services (CSV) FY2018 - Umsatz waechst +3.8%, AR faellt -3.9% -> false', () => {
  // newest-first: [FY2018, FY2017]. Umsatz 267.992M > 258.139M (waechst), AR 18.897M < 19.655M (faellt).
  // arG(-3.9%) - revG(+3.8%) = -7.7% << AR_DIVERGENCE(0.15) -> false (kein Channel-Stuffing).
  const s = { annual: {
    annualRev: [{ value: 267992000 }, { value: 258139000 }],
    annualBalance: [{ accountsReceivable: 18897000 }, { accountsReceivable: 19655000 }],
  } };
  assert.equal(arDivergence(s), false);
});

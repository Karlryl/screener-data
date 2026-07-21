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
 *   Negativ: MasterCraft Boat Holdings (MCFT) - AR FAELLT -64.3% (11.455M->4.086M)
 *     waehrend der Umsatz +13.4% waechst (genau das GEGENTEIL des Manipulations-Musters).
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

test('arDivergence: Negativ-Fixture MasterCraft (MCFT) - AR faellt, Umsatz waechst -> false', () => {
  const s = { annual: {
    annualRev: [{ value: 284203000 }, { value: 322351000 }, { value: 609903000 }],
    annualBalance: [{ accountsReceivable: 4086000 }, { accountsReceivable: 11455000 }, { accountsReceivable: 15741000 }],
  } };
  assert.equal(arDivergence(s), false);
});

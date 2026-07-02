'use strict';
/**
 * Branchen-Formel: IT-Services (VIELLEICHT, formulaCount 1, Split=none).
 * Dossier: people-leveraged (Umsatz ~ Koepfe x Auslastung x Rate) -> Wachstum
 * gedeckelt (einstellig bis niedrig-zweistellig); echte 10-Bagger selten,
 * compounder-artig statt power-law. Strukturell durchweg profitabel -> kein
 * Profit-Split (leerer Unprofit-Bucket). EIN Track.
 * audit/fix (Formel-Audit): Beschleunigung fuehrte (revAcceleration 2.6 > revGrowthLevel 2.0)
 * -> in diesem NIEDRIG-Wachstums-Sektor hob das Einstellig-Wachser mit QoQ-Blip (WISE.L 9%,
 * Otsuka 9%) UEBER echte Level-Wachser (SCSK 44%, FIS 30%) und laeuft Karls Ziel entgegen
 * ('Wachstums-NIVEAU dominiert'). revGrowthLevel 2.0 -> 2.8 gesetzt: das Umsatz-NIVEAU fuehrt
 * jetzt, die wenigen echten Wachser ranken oben; revAcceleration bleibt sekundaerer Tiebreaker.
 */
module.exports = {
  id: 'it-services',
  splitMetric: 'none',
  subCohortByProfit: true, // capEff-Niveau-ROIC darf Verlust-Wachser nicht demovieren (Iron-Rule 2)
  alpha: 2.0,
  axes: [
    { key: 'revGrowthLevel', w: { profitable: 2.8, unprofitable: 2.8 } },
    { key: 'revAcceleration', w: { profitable: 2.6, unprofitable: 2.6 } },
    { key: 'gpGrowth', w: { profitable: 1.3, unprofitable: 1.3 } },
    { key: 'ruleOfX', w: { profitable: 1, unprofitable: 1 } },
    { key: 'marginTrajectory', w: { profitable: 0.8, unprofitable: 0.8 } },
    { key: 'capitalEfficiency', w: { profitable: 2, unprofitable: 2 } },
    { key: 'dilution', w: { profitable: 0.8, unprofitable: 0.8 } },
  ],
};

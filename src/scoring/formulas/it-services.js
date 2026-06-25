'use strict';
/**
 * Branchen-Formel: IT-Services (VIELLEICHT, formulaCount 1, Split=none).
 * Dossier: people-leveraged (Umsatz ~ Koepfe x Auslastung x Rate) -> Wachstum
 * gedeckelt (einstellig bis niedrig-zweistellig); echte 10-Bagger selten,
 * compounder-artig statt power-law. Strukturell durchweg profitabel -> kein
 * Profit-Split (leerer Unprofit-Bucket). EIN Track; Beschleunigung findet die
 * wenigen Ausreisser.
 */
module.exports = {
  id: 'it-services',
  splitMetric: 'none',
  subCohortByProfit: true, // capEff-Niveau-ROIC darf Verlust-Wachser nicht demovieren (Iron-Rule 2)
  alpha: 2.0,
  axes: [
    { key: 'revGrowthLevel', w: { profitable: 2, unprofitable: 2 } },
    { key: 'revAcceleration', w: { profitable: 2.6, unprofitable: 2.6 } },
    { key: 'gpGrowth', w: { profitable: 1.3, unprofitable: 1.3 } },
    { key: 'ruleOfX', w: { profitable: 1, unprofitable: 1 } },
    { key: 'marginTrajectory', w: { profitable: 0.8, unprofitable: 0.8 } },
    { key: 'capitalEfficiency', w: { profitable: 2, unprofitable: 2 } },
    { key: 'revisionsMomentum', w: { profitable: 1.2, unprofitable: 1.2 } },
    { key: 'dilution', w: { profitable: 0.8, unprofitable: 0.8 } },
  ],
};

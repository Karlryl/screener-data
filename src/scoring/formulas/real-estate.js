'use strict';
/**
 * Branchen-Formel: Real Estate / REITs (VIELLEICHT, formulaCount 1, Split=none).
 * Dossier: kein klassisches Umsatz-Hypergrowth; Multibagger fast ausschliesslich
 * aus Secular-Sub-Types (Data-Center, Cell-Tower, Industrial/Logistics, Self-
 * Storage). Profit-Split ist Anti-Pattern (GAAP-Verlust = Abschreibungs-Artefakt).
 * Overview nutzt FFO-Proxy-Badge (NetIncome+Depreciation), NICHT GP. EIN Track.
 */
module.exports = {
  id: 'real-estate',
  splitMetric: 'none',
  subCohortByProfit: true, // GAAP-Verlust=Abschreibungs-Artefakt; capEff darf REITs nicht demovieren (Iron-Rule 2)
  alpha: 1.8,
  axes: [
    { key: 'revGrowthLevel', w: { profitable: 1.3, unprofitable: 1.3 } },
    { key: 'revAcceleration', w: { profitable: 0.6, unprofitable: 0.6 } },
    { key: 'gpGrowth', w: { profitable: 1.5, unprofitable: 1.5 } },
    { key: 'ruleOfX', w: { profitable: 1.6, unprofitable: 1.6 } },
    { key: 'marginTrajectory', w: { profitable: 0.8, unprofitable: 0.8 } },
    { key: 'capitalEfficiency', w: { profitable: 1.6, unprofitable: 1.6 } },
    { key: 'revisionsMomentum', w: { profitable: 0.5, unprofitable: 0.5 } },
    { key: 'dilution', w: { profitable: 1, unprofitable: 1 } },
  ],
};

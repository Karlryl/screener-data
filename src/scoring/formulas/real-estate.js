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
  alpha: 1.8,
  axes: [
    { key: 'revGrowthLevel',     w: { profitable: 1.5, unprofitable: 1.5 } },
    { key: 'revAcceleration',    w: { profitable: 2.2, unprofitable: 2.2 } },
    { key: 'gpGrowth',           w: { profitable: 1.0, unprofitable: 1.0 } },
    { key: 'ruleOfX',            w: { profitable: 1.0, unprofitable: 1.0 } },
    { key: 'marginTrajectory',   w: { profitable: 1.0, unprofitable: 1.0 } },
    { key: 'capitalEfficiency',  w: { profitable: 1.2, unprofitable: 1.2 } },
    { key: 'revisionsMomentum',  w: { profitable: 0.5, unprofitable: 0.5 } },
    { key: 'dilution',           w: { profitable: 0.6, unprofitable: 0.6 } },
  ],
};

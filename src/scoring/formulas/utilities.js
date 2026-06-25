'use strict';
/**
 * Branchen-Formel: Utilities (VIELLEICHT, formulaCount 2, Split @ OpInc).
 * Dossier: regulierte Utilities sind KEIN Hypergrowth (Rate-Case-gedeckelt, ~1%
 * der 10-Bagger). Der eigentliche Schnitt ist regulated vs merchant/clean
 * (routing-/lampen-seitig); Profit-Split sekundaer. Clean-Energy-Utility-Burner
 * fallen in den Unprofit-Track. Kapitaleffizienz hoch (gegen capex-Aufblaehung).
 */
module.exports = {
  id: 'utilities',
  splitMetric: 'OpInc',
  alpha: 1.8,
  axes: [
    { key: 'revGrowthLevel',     w: { profitable: 1.5, unprofitable: 2.0 } },
    { key: 'revAcceleration',    w: { profitable: 2.0, unprofitable: 2.5 } },
    { key: 'gpGrowth',           w: { profitable: 1.0, unprofitable: 1.0 } },
    { key: 'ruleOfX',            w: { profitable: 1.0, unprofitable: 0.8 } },
    { key: 'marginTrajectory',   w: { profitable: 1.0, unprofitable: 1.0 } },
    { key: 'capitalEfficiency',  w: { profitable: 1.3, unprofitable: 0.5 } },
    { key: 'revisionsMomentum',  w: { profitable: 0.5, unprofitable: 0.5 } },
    { key: 'dilution',           w: { profitable: 0.6, unprofitable: 0.5 } },
  ],
};

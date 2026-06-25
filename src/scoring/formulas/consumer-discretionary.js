'use strict';
/**
 * Branchen-Formel: Consumer Discretionary (DTC-E-Commerce, Fast-Casual,
 * Athleisure, strukturelle Marken-Compounder). Verdict JA. Split @ OpInc
 * (Inventar-/Working-Capital macht FCF zyklisch). Asset-Disziplin wichtig
 * (Store-Wachstum vs. Umsatz). Beschleunigung fuehrt.
 */
module.exports = {
  id: 'consumer-discretionary',
  splitMetric: 'OpInc',
  alpha: 2.2,
  axes: [
    { key: 'revGrowthLevel',     w: { profitable: 1.8, unprofitable: 2.2 } },
    { key: 'revAcceleration',    w: { profitable: 2.5, unprofitable: 3.0 } },
    { key: 'gpGrowth',           w: { profitable: 1.3, unprofitable: 1.3 } },
    { key: 'ruleOfX',            w: { profitable: 1.2, unprofitable: 0.8 } },
    { key: 'marginTrajectory',   w: { profitable: 1.2, unprofitable: 1.2 } },
    { key: 'capitalEfficiency',  w: { profitable: 1.0, unprofitable: 0.4 } },
    { key: 'revisionsMomentum',  w: { profitable: 0.5, unprofitable: 0.5 } },
    { key: 'dilution',           w: { profitable: 0.6, unprofitable: 0.5 } },
  ],
};

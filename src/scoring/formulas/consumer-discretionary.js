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
    { key: 'revGrowthLevel', w: { profitable: 1.45, unprofitable: 1.9 } },
    { key: 'revAcceleration', w: { profitable: 2.65, unprofitable: 3 } },
    { key: 'gpGrowth', w: { profitable: 1.5, unprofitable: 1.4 } },
    { key: 'ruleOfX', w: { profitable: 0.55, unprofitable: 0.8 } },
    { key: 'marginTrajectory', w: { profitable: 0.35, unprofitable: 0.9 } },
    { key: 'capitalEfficiency', w: { profitable: 2.3, unprofitable: 0.9 } },
    { key: 'dilution', w: { profitable: 0.6, unprofitable: 1.2 } },
  ],
};

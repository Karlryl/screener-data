'use strict';
/**
 * Branchen-Formel: Financials — NUR Income-Statement (Boersen/Exchanges,
 * Asset-Manager, Fintech/Payments, Neobanken-Broker). Bilanz-Banken/Versicherer/
 * Lender sind Router-Hard-Exclude. Verdict JA. Split @ OpInc (Kreditbuch-/WC-
 * Rauschen macht FCF instabil). GP weniger zentral (Boersen ~ Nettoertrag).
 */
module.exports = {
  id: 'financials',
  splitMetric: 'OpInc',
  alpha: 2.0,
  axes: [
    { key: 'revGrowthLevel', w: { profitable: 1, unprofitable: 1.2 } },
    { key: 'revAcceleration', w: { profitable: 2.7, unprofitable: 2.7 } },
    { key: 'gpGrowth', w: { profitable: 1.8, unprofitable: 1.7 } },
    { key: 'ruleOfX', w: { profitable: 0.7, unprofitable: 0.4 } },
    { key: 'marginTrajectory', w: { profitable: 0.6, unprofitable: 1.3 } },
    { key: 'capitalEfficiency', w: { profitable: 1.5, unprofitable: 1.7 } },
    { key: 'revisionsMomentum', w: { profitable: 1.2, unprofitable: 1 } },
    { key: 'dilution', w: { profitable: 0.9, unprofitable: 0.6 } },
  ],
};

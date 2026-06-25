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
    { key: 'revGrowthLevel',     w: { profitable: 1.8, unprofitable: 2.2 } },
    { key: 'revAcceleration',    w: { profitable: 2.2, unprofitable: 2.8 } },
    { key: 'gpGrowth',           w: { profitable: 1.0, unprofitable: 1.0 } },
    { key: 'ruleOfX',            w: { profitable: 1.2, unprofitable: 0.8 } },
    { key: 'marginTrajectory',   w: { profitable: 1.2, unprofitable: 1.2 } },
    { key: 'capitalEfficiency',  w: { profitable: 1.0, unprofitable: 0.4 } },
    { key: 'revisionsMomentum',  w: { profitable: 0.8, unprofitable: 0.8 } },
    { key: 'dilution',           w: { profitable: 0.6, unprofitable: 0.5 } },
  ],
};

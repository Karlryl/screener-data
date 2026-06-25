'use strict';
/**
 * Branchen-Formel: Software & Communication Services (SaaS, Internet, Plattformen).
 * Verdict JA. Anker PLTR. Split @ FCF (kapital-leichte, cash-generative Modelle;
 * Rule-of-X-kanonische Trennlinie). alpha hoch (hohe GM, FCF-Hebel). Dilution
 * staerker gewichtet (SBC ist in Software gross).
 */
module.exports = {
  id: 'software-comm-services',
  splitMetric: 'FCF',
  alpha: 3.0,
  axes: [
    { key: 'revGrowthLevel',     w: { profitable: 1.5, unprofitable: 2.0 } },
    { key: 'revAcceleration',    w: { profitable: 2.5, unprofitable: 3.0 } },
    { key: 'gpGrowth',           w: { profitable: 1.5, unprofitable: 1.5 } },
    { key: 'ruleOfX',            w: { profitable: 2.0, unprofitable: 1.0 } },
    { key: 'marginTrajectory',   w: { profitable: 1.0, unprofitable: 1.0 } },
    { key: 'capitalEfficiency',  w: { profitable: 0.8, unprofitable: 0.3 } },
    { key: 'revisionsMomentum',  w: { profitable: 0.5, unprofitable: 0.5 } },
    { key: 'dilution',           w: { profitable: 1.0, unprofitable: 0.7 } },
  ],
};

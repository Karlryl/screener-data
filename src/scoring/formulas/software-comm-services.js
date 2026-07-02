'use strict';
/**
 * Branchen-Formel: Software & Communication Services (SaaS, Internet, Plattformen).
 * Verdict JA. Anker PLTR. Split @ FCF (kapital-leichte, cash-generative Modelle;
 * Rule-of-X-kanonische Trennlinie). alpha hoch (hohe GM, FCF-Hebel). Dilution
 * track-spezifisch (Unprofit 1.3 > Profitable 0.8 — SBC-Verwaesserung trifft Burner
 * haerter); kalibriert fuehrt revAcceleration, gpGrowth/capitalEfficiency als Quality.
 */
module.exports = {
  id: 'software-comm-services',
  splitMetric: 'FCF',
  alpha: 3.0,
  axes: [
    { key: 'revGrowthLevel', w: { profitable: 1.1, unprofitable: 1.2 } },
    { key: 'revAcceleration', w: { profitable: 2.9, unprofitable: 2.8 } },
    { key: 'gpGrowth', w: { profitable: 2.2, unprofitable: 2 } },
    { key: 'ruleOfX', w: { profitable: 1.8, unprofitable: 1.2 } },
    { key: 'marginTrajectory', w: { profitable: 0.4, unprofitable: 0.4 } },
    { key: 'capitalEfficiency', w: { profitable: 2, unprofitable: 1.6 } },
    { key: 'dilution', w: { profitable: 0.8, unprofitable: 1.3 } },
  ],
};

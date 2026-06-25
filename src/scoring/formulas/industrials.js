'use strict';
/**
 * Branchen-Formel: Industrials (Electrical Equipment/Grid/Elektrifizierung,
 * A&D, sekulaere Wachstums-Taschen). Verdict JA. Anker BE/Bloom Energy
 * (Electrical Equipment, Turnaround -> Profitable-Track). Split @ OpInc
 * (Anzahlungen/WC machen FCF instabil). Operating-Leverage + Asset-Disziplin
 * staerker gewichtet (kapitalintensiv).
 */
module.exports = {
  id: 'industrials',
  splitMetric: 'OpInc',
  alpha: 2.0,
  axes: [
    { key: 'revGrowthLevel', w: { profitable: 1.9, unprofitable: 2 } },
    { key: 'revAcceleration', w: { profitable: 2.4, unprofitable: 2.8 } },
    { key: 'gpGrowth', w: { profitable: 2.1, unprofitable: 2 } },
    { key: 'ruleOfX', w: { profitable: 1.4, unprofitable: 0.9 } },
    { key: 'marginTrajectory', w: { profitable: 0.9, unprofitable: 0.8 } },
    { key: 'capitalEfficiency', w: { profitable: 1.6, unprofitable: 0.9 } },
    { key: 'revisionsMomentum', w: { profitable: 0.6, unprofitable: 0.6 } },
    { key: 'dilution', w: { profitable: 0.6, unprofitable: 0.6 } },
  ],
};

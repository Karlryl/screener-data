'use strict';
/**
 * Branchen-Formel: Health Care (GLP-1/Pharma-Launches, Life-Science-Tools,
 * Genomik, Chirurgie-Robotik, Medtech). Verdict JA. Split @ FCF (gesunde
 * kommerzielle HC-Modelle sind cash-generativ). GP-Wachstum hoch gewichtet
 * (qualitaets-bereinigtes Wachstum).
 */
module.exports = {
  id: 'health-care',
  splitMetric: 'FCF',
  alpha: 2.6,
  axes: [
    { key: 'revGrowthLevel',     w: { profitable: 1.5, unprofitable: 2.0 } },
    { key: 'revAcceleration',    w: { profitable: 2.2, unprofitable: 2.8 } },
    { key: 'gpGrowth',           w: { profitable: 1.8, unprofitable: 1.6 } },
    { key: 'ruleOfX',            w: { profitable: 1.5, unprofitable: 1.0 } },
    { key: 'marginTrajectory',   w: { profitable: 1.0, unprofitable: 1.0 } },
    { key: 'capitalEfficiency',  w: { profitable: 1.0, unprofitable: 0.3 } },
    { key: 'revisionsMomentum',  w: { profitable: 0.6, unprofitable: 0.6 } },
    { key: 'dilution',           w: { profitable: 0.8, unprofitable: 0.6 } },
  ],
};

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
    { key: 'revGrowthLevel', w: { profitable: 1.7, unprofitable: 2 } },
    { key: 'revAcceleration', w: { profitable: 2.5, unprofitable: 2.8 } },
    { key: 'gpGrowth', w: { profitable: 2, unprofitable: 1.8 } },
    { key: 'ruleOfX', w: { profitable: 1.1, unprofitable: 1 } },
    { key: 'marginTrajectory', w: { profitable: 0.7, unprofitable: 0.8 } },
    { key: 'capitalEfficiency', w: { profitable: 2.3, unprofitable: 0.4 } },
    { key: 'revisionsMomentum', w: { profitable: 0.5, unprofitable: 0.5 } },
    { key: 'dilution', w: { profitable: 0.6, unprofitable: 0.5 } },
  ],
};

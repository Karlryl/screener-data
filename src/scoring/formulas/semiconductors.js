'use strict';
/**
 * Branchen-Formel: Halbleiter/Hardware (fabless networking-silicon & Co.)
 * Verdict JA. Heimathafen der Anker CRDO/ALAB. Split @ OpInc (annualOpInc-Vorzeichen).
 *
 * Duenne Daten-Deklaration: nur Achsen-Gewichte je Track, splitMetric, alpha.
 * Die gesamte Mechanik (Routing, q(), renorm-on-drop, Track, Lampen) steckt in
 * der generischen Engine. Gewichte sind growth-dominant; Beschleunigung fuehrt.
 * Gewichte muessen NICHT auf 1 summieren — weightedScore renormiert.
 */
module.exports = {
  id: 'semiconductors',
  splitMetric: 'OpInc',
  alpha: 3.0, // Rule-of-X: hohe Software-/Design-aehnliche Margen-Hebel
  axes: [
    { key: 'revGrowthLevel', w: { profitable: 1.7, unprofitable: 2.3 } },
    { key: 'revAcceleration', w: { profitable: 2.6, unprofitable: 2.5 } },
    { key: 'gpGrowth', w: { profitable: 1.8, unprofitable: 2.1 } },
    { key: 'ruleOfX', w: { profitable: 1.6, unprofitable: 1.7 } },
    { key: 'marginTrajectory', w: { profitable: 0.3, unprofitable: 0.7 } },
    { key: 'capitalEfficiency', w: { profitable: 0.8, unprofitable: 0.4 } },
    { key: 'dilution', w: { profitable: 0.7, unprofitable: 0.5 } },
  ],
};

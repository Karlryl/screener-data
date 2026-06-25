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
    // key,                profitable, unprofitable
    { key: 'revGrowthLevel',     w: { profitable: 1.5, unprofitable: 2.0 } },
    { key: 'revAcceleration',    w: { profitable: 2.5, unprofitable: 3.0 } }, // hoechstes Hypergrowth-Signal
    { key: 'gpGrowth',           w: { profitable: 1.5, unprofitable: 1.5 } },
    { key: 'ruleOfX',            w: { profitable: 1.5, unprofitable: 1.0 } }, // FCF-Term nur im Profitable-Track
    { key: 'marginTrajectory',   w: { profitable: 1.0, unprofitable: 1.0 } }, // Unprofit: Pfad-zur-Profitabilitaet
    { key: 'capitalEfficiency',  w: { profitable: 1.0, unprofitable: 0.3 } },
    { key: 'revisionsMomentum',  w: { profitable: 0.5, unprofitable: 0.5 } },
    { key: 'dilution',           w: { profitable: 0.8, unprofitable: 0.5 } },
  ],
};

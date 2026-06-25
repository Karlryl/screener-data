'use strict';
/**
 * Branchen-Formel: Consumer Staples (VIELLEICHT, formulaCount 1, Split=none).
 * Dossier: strukturell Low-Growth-Compounder (Inkumbenten 2-5%, meist preis-
 * getrieben). Echtes Hypergrowth nur in duenner Challenger-Bande (v.a. Getraenke).
 * Profit-Split ist nicht der Hebel (fast alle profitabel) — Schnitt waere Sub-
 * Branche. EIN Track; Beschleunigung findet die Challenger.
 */
module.exports = {
  id: 'consumer-staples',
  splitMetric: 'none',
  alpha: 1.8,
  axes: [
    { key: 'revGrowthLevel',     w: { profitable: 1.8, unprofitable: 1.8 } },
    { key: 'revAcceleration',    w: { profitable: 2.5, unprofitable: 2.5 } }, // Challenger-Detektor
    { key: 'gpGrowth',           w: { profitable: 1.5, unprofitable: 1.5 } },
    { key: 'ruleOfX',            w: { profitable: 1.0, unprofitable: 1.0 } },
    { key: 'marginTrajectory',   w: { profitable: 1.0, unprofitable: 1.0 } },
    { key: 'capitalEfficiency',  w: { profitable: 0.8, unprofitable: 0.8 } },
    { key: 'revisionsMomentum',  w: { profitable: 0.5, unprofitable: 0.5 } },
    { key: 'dilution',           w: { profitable: 0.5, unprofitable: 0.5 } },
  ],
};

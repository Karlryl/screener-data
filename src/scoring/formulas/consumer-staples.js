'use strict';
/**
 * Branchen-Formel: Consumer Staples (VIELLEICHT, formulaCount 1, Split=none).
 * Dossier: strukturell Low-Growth-Compounder (Inkumbenten 2-5%, meist preis-
 * getrieben). Echtes Hypergrowth nur in duenner Challenger-Bande (v.a. Getraenke).
 * Profit-Split ist nicht der Hebel (fast alle profitabel) — Schnitt waere Sub-
 * Branche. EIN Track. EMPIRISCH (Red-Team): NIVEAU-Wachstum (revGrowthLevel),
 * nicht Beschleunigung, hebt die echten Challenger (CELH/MNST verzoegern gerade);
 * dilution + capitalEfficiency trennen Education-/Diluter-Junk stabil heraus.
 */
module.exports = {
  id: 'consumer-staples',
  splitMetric: 'none',
  alpha: 1.8,
  axes: [
    { key: 'revGrowthLevel', w: { profitable: 4.2, unprofitable: 4.2 } },
    { key: 'revAcceleration', w: { profitable: 0.5, unprofitable: 0.5 } },
    { key: 'gpGrowth', w: { profitable: 1.8, unprofitable: 1.8 } },
    { key: 'ruleOfX', w: { profitable: 0.6, unprofitable: 0.6 } },
    { key: 'marginTrajectory', w: { profitable: 0.3, unprofitable: 0.3 } },
    { key: 'capitalEfficiency', w: { profitable: 2, unprofitable: 2 } },
    { key: 'dilution', w: { profitable: 2.4, unprofitable: 2.4 } },
  ],
};

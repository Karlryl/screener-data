'use strict';
/**
 * Branchen-Formel: Energy. Verdict JA (Karl-Entscheid 2026-06-25: Clean-Energy-
 * Hypergrowth wie BE/PLUG/RUN/FCEL sind ausdruecklich erwuenscht). Split @ OpInc
 * (Projekt-Capex/Zins macht FCF zyklisch). Asset-Disziplin hoch gewichtet, um
 * capex-/preisgetriebenes Schein-Wachstum (commodity-Peak) von echtem
 * Compounding zu trennen. Beschleunigung fuehrt; Unprofit-Track fuer Clean-Burn.
 */
module.exports = {
  id: 'energy',
  splitMetric: 'OpInc',
  alpha: 2.0,
  axes: [
    { key: 'revGrowthLevel',     w: { profitable: 1.5, unprofitable: 2.0 } },
    { key: 'revAcceleration',    w: { profitable: 2.5, unprofitable: 3.0 } },
    { key: 'gpGrowth',           w: { profitable: 1.3, unprofitable: 1.3 } },
    { key: 'ruleOfX',            w: { profitable: 1.0, unprofitable: 0.8 } },
    { key: 'marginTrajectory',   w: { profitable: 1.2, unprofitable: 1.2 } },
    { key: 'capitalEfficiency',  w: { profitable: 1.3, unprofitable: 0.5 } },
    { key: 'revisionsMomentum',  w: { profitable: 0.5, unprofitable: 0.5 } },
    { key: 'dilution',           w: { profitable: 0.6, unprofitable: 0.5 } },
  ],
};

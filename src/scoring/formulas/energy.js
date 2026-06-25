'use strict';
/**
 * Branchen-Formel: Energy (GICS-Energy = Oil&Gas E&P/Midstream/Services, kalibriert
 * fuehren RRC/EQT/AR). Verdict JA (Karl-Entscheid 2026-06-25). HINWEIS: die genannten
 * Clean-Energy-Hypergrowth-Namen routen GICS-seitig groesstenteils NICHT hierher
 * (BE/PLUG -> Industrials, FSLR/ENPH oft Technology) — Energy-Carve-out greift nur fuer
 * GICS-Energy-Clean (z.B. Uranium/Biofuels). Split @ OpInc
 * (Projekt-Capex/Zins macht FCF zyklisch). Asset-Disziplin hoch gewichtet, um
 * capex-/preisgetriebenes Schein-Wachstum (commodity-Peak) von echtem
 * Compounding zu trennen. Beschleunigung fuehrt; Unprofit-Track fuer Clean-Burn.
 */
module.exports = {
  id: 'energy',
  splitMetric: 'OpInc',
  alpha: 2.0,
  axes: [
    { key: 'revGrowthLevel', w: { profitable: 0.8, unprofitable: 2 } },
    { key: 'revAcceleration', w: { profitable: 3, unprofitable: 3 } },
    { key: 'gpGrowth', w: { profitable: 1.8, unprofitable: 1.3 } },
    { key: 'ruleOfX', w: { profitable: 1.5, unprofitable: 0.8 } },
    { key: 'marginTrajectory', w: { profitable: 0.4, unprofitable: 1.2 } },
    { key: 'capitalEfficiency', w: { profitable: 2.4, unprofitable: 0.5 } },
    { key: 'revisionsMomentum', w: { profitable: 0.4, unprofitable: 0.5 } },
    { key: 'dilution', w: { profitable: 0.55, unprofitable: 0.5 } },
  ],
};

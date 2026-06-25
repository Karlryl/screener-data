'use strict';
/**
 * Branchen-Formel: Materials (VIELLEICHT, formulaCount 1, Split=none).
 * Dossier-Kernwarnung: sichtbares Umsatzwachstum korreliert NEGATIV mit Qualitaet
 * — die schnellsten Wachser sind Price-Taker am Zyklus-PEAK (Gold/Chem-Spread).
 * Ein Profit-Split waere die falsche Achse (wuerde invertieren). Daher EIN Track,
 * Wachstum bewusst NIEDRIG gewichtet, Kapitaleffizienz/Zyklus-Qualitaet DOMINANT
 * (ROIC + Asset-Growth-Penalty trennt Compounder vom Peak-Price-Taker).
 * peakMargin/lowRoic-Lampen warnen zusaetzlich.
 */
module.exports = {
  id: 'materials',
  splitMetric: 'none',
  alpha: 1.5,
  axes: [
    { key: 'revGrowthLevel',     w: { profitable: 0.8, unprofitable: 0.8 } }, // bewusst niedrig (Peak-Falle)
    { key: 'revAcceleration',    w: { profitable: 1.2, unprofitable: 1.2 } },
    { key: 'gpGrowth',           w: { profitable: 1.2, unprofitable: 1.2 } },
    { key: 'ruleOfX',            w: { profitable: 0.8, unprofitable: 0.8 } },
    { key: 'marginTrajectory',   w: { profitable: 1.5, unprofitable: 1.5 } },
    { key: 'capitalEfficiency',  w: { profitable: 2.0, unprofitable: 2.0 } }, // dominant: Zyklus-Qualitaet
    { key: 'revisionsMomentum',  w: { profitable: 0.5, unprofitable: 0.5 } },
    { key: 'dilution',           w: { profitable: 0.5, unprofitable: 0.5 } },
  ],
};

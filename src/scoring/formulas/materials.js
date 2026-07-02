'use strict';
/**
 * Branchen-Formel: Materials (VIELLEICHT, formulaCount 1, Split=none).
 * Dossier-Kernwarnung: sichtbares Umsatzwachstum korreliert NEGATIV mit Qualitaet
 * — die schnellsten Wachser sind Price-Taker am Zyklus-PEAK (Gold/Chem-Spread).
 * Ein Profit-Split waere die falsche Achse (wuerde invertieren). Daher EIN Track,
 * Wachstum bewusst NIEDRIG gewichtet, Kapitaleffizienz/Zyklus-Qualitaet DOMINANT
 * (ROIC + Asset-Growth-Penalty trennt Compounder vom Peak-Price-Taker).
 * peakMargin/lowRoic-Lampen warnen zusaetzlich. Kalibrierte Gewichte: capital-
 * Efficiency ~28% UND revisionsMomentum ~23% sind die zwei groessten Achsen;
 * Wachstum bewusst niedrig (Regel-5-Ausnahme, dossier-begruendet quality-dominant).
 */
module.exports = {
  id: 'materials',
  splitMetric: 'none',
  alpha: 1.5,
  axes: [
    { key: 'revGrowthLevel', w: { profitable: 0.5, unprofitable: 0.5 } },
    { key: 'revAcceleration', w: { profitable: 1.9, unprofitable: 1.9 } },
    { key: 'gpGrowth', w: { profitable: 0.8, unprofitable: 0.8 } },
    { key: 'ruleOfX', w: { profitable: 0.6, unprofitable: 0.6 } },
    { key: 'marginTrajectory', w: { profitable: 0.4, unprofitable: 0.4 } },
    { key: 'capitalEfficiency', w: { profitable: 2.9, unprofitable: 2.9 } },
    { key: 'dilution', w: { profitable: 0.8, unprofitable: 0.8 } },
  ],
};

'use strict';
/**
 * Branchen-Formel: Materials (VIELLEICHT, formulaCount 1, Split=none).
 * Dossier-Kernwarnung: sichtbares Umsatzwachstum korreliert NEGATIV mit Qualitaet
 * — die schnellsten Wachser sind Price-Taker am Zyklus-PEAK (Gold/Chem-Spread).
 * Ein Profit-Split waere die falsche Achse (wuerde invertieren). Daher EIN Track,
 * Wachstum bewusst NIEDRIG gewichtet, Kapitaleffizienz/Zyklus-Qualitaet DOMINANT
 * (ROIC + Asset-Growth-Penalty trennt Compounder vom Peak-Price-Taker).
 * peakMargin/lowRoic-Lampen warnen zusaetzlich.
 * audit/fix (Formel-Audit): nach der revisionsMomentum-Entfernung (Karl-Direktive)
 * blaehte der proportionale Renorm die groesste Achse capitalEfficiency von den
 * kalibrierten ~28% auf ~37% auf (revisionsMomentum w=2.4 war die 2.-groesste Achse).
 * capitalEfficiency 2.9 -> 2.0 zurueckgesetzt -> Anteil wieder ~28% (2.0/7.0), damit
 * KEINE Einzel-Achse die Formel unplausibel dominiert. capEff bleibt bewusst die
 * schwerste Achse (dossier-begruendet quality-dominant, Regel-5-Ausnahme), nicht aufgeblaeht.
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
    { key: 'capitalEfficiency', w: { profitable: 2.0, unprofitable: 2.0 } },
    { key: 'dilution', w: { profitable: 0.8, unprofitable: 0.8 } },
  ],
};

'use strict';
/**
 * Branchen-Formel: Utilities (VIELLEICHT, formulaCount 2, Split @ OpInc).
 * Dossier: regulierte Utilities sind KEIN Hypergrowth (Rate-Case-gedeckelt, ~1%
 * der 10-Bagger). Der eigentliche Schnitt ist regulated vs merchant/clean
 * (routing-/lampen-seitig); Profit-Split sekundaer. Clean-Energy-Utility-Burner
 * fallen in den Unprofit-Track. EMPIRISCH (Red-Team): die Merchant-Signatur liegt
 * auf revGrowthLevel+ruleOfX (CEG/TLN/VST oben); capitalEfficiency/gpGrowth NIEDRIG,
 * weil hohe Margen/Kapitalintensitaet bei Regulierten ein Pass-Through-Artefakt sind.
 */
module.exports = {
  id: 'utilities',
  splitMetric: 'OpInc',
  alpha: 1.8,
  axes: [
    { key: 'revGrowthLevel', w: { profitable: 2.2, unprofitable: 2.2 } },
    { key: 'revAcceleration', w: { profitable: 0.5, unprofitable: 1 } },
    { key: 'gpGrowth', w: { profitable: 0.4, unprofitable: 1.4 } },
    { key: 'ruleOfX', w: { profitable: 2.2, unprofitable: 1.6 } },
    { key: 'marginTrajectory', w: { profitable: 0.6, unprofitable: 0.9 } },
    { key: 'capitalEfficiency', w: { profitable: 0.5, unprofitable: 0.5 } },
    { key: 'dilution', w: { profitable: 0.5, unprofitable: 0.4 } },
  ],
};

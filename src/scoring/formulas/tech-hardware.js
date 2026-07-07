'use strict';
/**
 * Branchen-Formel: Technology-Hardware / EMS / Peripherie (P1-Carve-out 2.12a).
 * Faengt die 201 Namen, die zuvor faelschlich in software-comm-services lagen
 * (Electronic Components, Computer Hardware, Communication Equipment, Scientific &
 * Technical Instruments, Consumer Electronics, Solar, Electronics & Computer Distribution).
 *
 * STATUS DIAGNOSTIC (board-status.js): der generische 7-Achsen-Satz trennt Franchise
 * (ANET/APH/MSI/GRMN, GM 37-68%) noch NICHT zuverlaessig von commodity-EMS (Foxconn/
 * Celestica/Sanmina, GM 8-12%), weil keine reine Margen-NIVEAU-Achse existiert
 * (Vault _P1-FORMEL-DESIGN §2.3: Simulation rankt TW-EMS oben). Die Margen-Niveau-Achse
 * ist Folge-Task 2.12b (Engine-Weiche, axes.js) — erst dann Court-Aufstieg auf 'core'.
 *
 * Achsen-Wahl (Design §2.4, best-erreichbar im 7-Achsen-Rahmen): gpGrowth + capitalEfficiency
 * dominant (traegt die Margen-Trajektorie/ROIC = einziges vorhandenes Margen-nahes Signal),
 * Wachstums-Achsen gedaempft (Hardware waechst strukturell langsamer; hohe Wachstums-Gewichtung
 * bevorzugt commodity-EMS-Umsatzschuebe). Split @ OpInc (kapital-intensiv, OpInc-Vorzeichen
 * trennt Profitable sauberer als lumpy-Capex-FCF). alpha 2.3 (Engine-Default, KEIN Software-
 * Margen-Hebel wie semiconductors/software-comm 3.0 — sonst blaeht margen-blinder ruleOfX auf).
 * Global, keine mcap-Grenze (Router laeuft global; Achsen sind waehrungs-invariant).
 */
module.exports = {
  id: 'tech-hardware',
  splitMetric: 'OpInc',
  alpha: 2.3,
  axes: [
    { key: 'gpGrowth', w: { profitable: 2.6, unprofitable: 2.4 } },
    { key: 'capitalEfficiency', w: { profitable: 2.4, unprofitable: 1.0 } },
    { key: 'revAcceleration', w: { profitable: 1.4, unprofitable: 2.2 } },
    { key: 'ruleOfX', w: { profitable: 1.2, unprofitable: 1.0 } },
    { key: 'revGrowthLevel', w: { profitable: 0.9, unprofitable: 1.2 } },
    { key: 'dilution', w: { profitable: 0.8, unprofitable: 1.1 } },
    { key: 'marginTrajectory', w: { profitable: 0.6, unprofitable: 0.7 } },
  ],
};

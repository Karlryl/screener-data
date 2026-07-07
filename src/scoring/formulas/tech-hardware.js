'use strict';
/**
 * Branchen-Formel: Technology-Hardware / EMS / Peripherie (P1-Carve-out 2.12a).
 * Faengt die 201 Namen, die zuvor faelschlich in software-comm-services lagen
 * (Electronic Components, Computer Hardware, Communication Equipment, Scientific &
 * Technical Instruments, Consumer Electronics, Solar, Electronics & Computer Distribution).
 *
 * 8 Achsen. Der 2.12a-7-Achsen-Satz + marginLevel (2.12b, GM-NIVEAU). Die Margen-Niveau-Achse
 * zieht jeden echten commodity-EMS (GM<15%) ins unterste Fuenftel und hebt die Franchises ins
 * oberste: Top-15 des profitable-Boards ist damit commodity-EMS<15%-frei (Baseline hatte 3 in
 * den Top-9), ANET steigt #18->#6 (Vault _P1-2.12b-MARGEN-ACHSE-DESIGN, V2-Kalibrierung).
 * EHRLICH: das "Marquee-Vollhaus" (MSI/FTV oben) ist mit einer MONOTONEN Achse bewusst NICHT
 * erzwungen — MSI/FTV sind reife Slow-Grower (RevG 7-8%), die in einem HYPERGROWTH-Screener
 * korrekt mittig ranken (Direktive-4-Logik: kein Compounder ueber echtes Hypergrowth). Das
 * messbare Ziel — commodity-Blechbieger aus der Spitze — ist erreicht; das ist der Punkt.
 *
 * Achsen-Wahl: gpGrowth + capitalEfficiency + marginLevel dominant (Margen-Niveau/-Trajektorie/
 * ROIC = Qualitaets-Signale), Wachstums-Achsen gedaempft (Hardware waechst strukturell langsamer;
 * hohe Wachstums-Gewichtung bevorzugt commodity-EMS-Umsatzschuebe). Split @ OpInc (kapital-
 * intensiv, OpInc-Vorzeichen trennt Profitable sauberer als lumpy-Capex-FCF). alpha 2.3 (Engine-
 * Default, KEIN Software-Margen-Hebel wie semiconductors/software-comm 3.0). Global, keine
 * mcap-Grenze (Router laeuft global; Achsen sind waehrungs-invariant).
 */
module.exports = {
  id: 'tech-hardware',
  splitMetric: 'OpInc',
  alpha: 2.3,
  axes: [
    { key: 'gpGrowth', w: { profitable: 2.6, unprofitable: 2.4 } },
    { key: 'capitalEfficiency', w: { profitable: 2.4, unprofitable: 1.0 } },
    { key: 'marginLevel', w: { profitable: 2.6, unprofitable: 2.6 } }, // 2.12b: GM-NIVEAU (Franchise-vs-commodity)
    { key: 'revAcceleration', w: { profitable: 1.4, unprofitable: 2.2 } },
    { key: 'ruleOfX', w: { profitable: 1.2, unprofitable: 1.0 } },
    { key: 'revGrowthLevel', w: { profitable: 0.9, unprofitable: 1.2 } },
    { key: 'dilution', w: { profitable: 0.8, unprofitable: 1.1 } },
    { key: 'marginTrajectory', w: { profitable: 0.6, unprofitable: 0.7 } },
  ],
};

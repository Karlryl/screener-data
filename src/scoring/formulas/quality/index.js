'use strict';
/**
 * QC-Board (3.1) — Formel-Registry (DIAGNOSTIC, additiv).
 * ======================================================
 * EIN sektor-invariantes QC_FORMULA-Template ueber die 11 unterstuetzten Sektoren
 * (die 13 HG-formulaIds minus financials/real-estate). Die Membership (qualityRoute)
 * mappt jeden Compounder auf 'quality-<sector>', die Engine scored ihn durch DENSELBEN
 * Pfad wie HG (nur mit growthBoost:false + eigener classify).
 *
 * splitMetric:'none' -> trackOf() gibt IMMER 'profitable' -> alle QC-Achsen tragen
 * die w-shape { profitable: X } (NIE ein Skalar-w — die Engine liest ax.w[track]).
 *
 * Achsen (5 LIVE + 1 benannt-leer). GRUND: QC-Fingerabdruck vs HG — capitalEfficiency
 * (ROIC-Niveau) + marginLevel (Margen-Niveau) fuehren, Wachstum bewusst schwach
 * gewichtet (revGrowthLevel 0.8 = messbare Inversion gegen HG). BEWUSST ausgeschlossen:
 * revAcceleration/ruleOfX/marginTrajectory (HG-Leitachsen/Rausch fuer reife Compounder).
 * roicStability w:0 (benannt-leer): eine null-schwere Achse wuerde ueber die C4-Coverage-
 * Shrinkage das Board Richtung Median stauchen; mit w=0 ueberspringen die engine-Guards
 * sie (nicht in totalW) -> keine Kompression, sichtbar in axisBreakdown {pct:null,weight:0}.
 * Auto-Aufleuchten bei Phase 4.1: Gewicht 0 -> ~1.5 in EINER Zeile.
 *
 * Gewichte als benannte Konstanten (keine Magic Numbers). Die Saeulen-RANGFOLGE ist
 * Doktrin (wie die HG-Formeln); die Groessenordnung lernt q()/winsor data-relativ.
 */
const baseFormulas = require('../index.js');

// Saeulen-Rangfolge: ROIC-Niveau >= Margen-Niveau > Margen-Konsistenz >= Reinvest-Disziplin > organisches Wachstum.
const W_CAPITAL_EFFICIENCY = 2.6;  // ANKER: ROIC-Niveau
const W_MARGIN_LEVEL       = 2.2;  // rohes Brutto-Margen-Niveau (Franchise-vs-commodity)
const W_GP_GROWTH          = 1.5;  // Margen-Konsistenz auf 4J
const W_DILUTION           = 1.2;  // Pro-Aktie-Disziplin (SBC/Rev Niveau+Trend)
const W_REV_GROWTH_LEVEL   = 0.8;  // organisches Wachstum (bewusst niedrigstes aktives Gewicht)
const W_ROIC_STABILITY     = 0;    // benannt-leer bis Phase 4.1 (heute ~ueberall null)

const QC_FORMULA = {
  id: 'quality',
  splitMetric: 'none', // BAU-GATE 2: none/absent zwingend -> track immer 'profitable'
  axes: [
    { key: 'capitalEfficiency', w: { profitable: W_CAPITAL_EFFICIENCY } },
    { key: 'marginLevel',       w: { profitable: W_MARGIN_LEVEL } },
    { key: 'gpGrowth',          w: { profitable: W_GP_GROWTH } },
    { key: 'dilution',          w: { profitable: W_DILUTION } },
    { key: 'revGrowthLevel',    w: { profitable: W_REV_GROWTH_LEVEL } },
    { key: 'roicStability',     w: { profitable: W_ROIC_STABILITY } },
  ],
};

// Die 11 QC-Sektoren = HG-formulaIds minus financials/real-estate (aus der HG-Registry abgeleitet,
// damit ein neuer HG-Sektor nicht still am QC-Board vorbeilaeuft).
const QC_UNSUPPORTED = new Set(['financials', 'real-estate']);
const QC_SECTORS = Object.keys(baseFormulas).filter((id) => !QC_UNSUPPORTED.has(id));

module.exports = Object.fromEntries(QC_SECTORS.map((s) => ['quality-' + s, QC_FORMULA]));
// Nebenexporte fuer Tests/Skripte (non-enumerable -> stoert die formulaId-Iteration nicht).
Object.defineProperty(module.exports, 'QC_FORMULA', { value: QC_FORMULA, enumerable: false });
Object.defineProperty(module.exports, 'QC_SECTORS', { value: QC_SECTORS, enumerable: false });

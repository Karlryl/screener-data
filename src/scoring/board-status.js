'use strict';
/**
 * Board-Court-Status je formulaId:
 *   'core'       = Court-PASSED, bewiesen — zaehlt als geprueft.
 *   'diagnostic' = gebaut, aber Court NICHT bestanden — laeuft sichtbar als "unbewiesen"
 *                  mit, zaehlt nicht als geprueft (Board-NO-GO-Ausweg, Masterplan
 *                  Grundgesetz 2a). Wird NICHT deregistriert.
 *
 * Quelle: 2.1 VIELLEICHT-Sektoren Court-Audit (2026-07-06, Vault-Ledger §2.1).
 * Warum diagnostic statt Deregistrierung: die 3 EXCLUDE-Sektoren tragen zusammen 532
 * Ticker = 15,9% des gerouteten Universums; sie aus src/scoring/index.js zu entfernen
 * kippte sie auf 'unrouted' (kein Score, aus allen Boards raus) und riss die
 * 2.1-Akzeptanz unrouted < 5%. Also bleiben sie geroutet + gescort, aber ehrlich als
 * 'diagnostic' geflaggt; das findash-export/v1 traegt den Status, das Dashboard (1.3)
 * badged ihn. Namen-Drop / Deregistrierung nur mit Karl-OK oder nach Fallback-Sammel-Board.
 *
 *   diagnostic: consumer-staples (REWORK — Junk-Filter versagt, TAL/EDU #2/#3),
 *               materials, real-estate, it-services (EXCLUDE — kein Hypergrowth-Terrain)
 *   core:       die 7 JA-Sektoren + utilities (2.1 KEEP — Merchant/Nuklear-IPP-Schnitt)
 *
 * BH-077/BH-159-Fix: CORE ist eine explizite Allowlist. Jede hier NICHT gelistete
 * formulaId (Tippfehler, neue Formel ohne Registry-Eintrag, Nicht-Formel-IDs wie
 * 'survival') faellt fail-closed auf 'diagnostic' — nie mehr stumm 'core'. Neue
 * Formeln starten laut Governance ohnehin DIAGNOSTIC (CLAUDE.md); Aufnahme in CORE
 * ist ein bewusster Schritt hier in dieser Datei, kein Default.
 */
// tech-hardware (P1-Carve-out 2.12a): 8-Achsen-Satz (marginLevel/2.12b ist gebaut, s.
// formulas/tech-hardware.js), bleibt aber diagnostic bis zum Walk-forward-/Court-Nachweis
// (BH-085: der urspruengliche "fehlende Margen-Achse"-Grund ist ueberholt).
const DIAGNOSTIC = new Set(['consumer-staples', 'materials', 'real-estate', 'it-services', 'tech-hardware']);

// Die 8 Court-PASSED HG-Sektoren (2.1 KEEP + JA-Sektoren). Einzige Quelle fuer 'core'.
const CORE = new Set([
  'consumer-discretionary', 'energy', 'financials', 'health-care',
  'industrials', 'semiconductors', 'software-comm-services', 'utilities',
]);

function boardStatus(formulaId) {
  // 3.1 QC-Board: jede quality-*-Formel ist per Konstruktion DIAGNOSTIC (Court-PASSED-AS-DIAGNOSTIC)
  // -> aktuell IMMER diagnostic; eine Core-Promotion erfordert einen kuenftigen Code-Change,
  // gated auf rho<0,4 + rankIC (Masterplan 3.1, docs/findash-export-v1.md).
  if (typeof formulaId === 'string' && formulaId.startsWith('quality-')) return 'diagnostic';
  // 5.2 Small-Cap-Board: per Praereg DIAGNOSTIC-Start, kein Court-Nachweis vor Karls 5 Auflagen.
  if (typeof formulaId === 'string' && formulaId.startsWith('smallcap-')) return 'diagnostic';
  return CORE.has(formulaId) ? 'core' : 'diagnostic';
}

module.exports = { boardStatus, CORE, DIAGNOSTIC };

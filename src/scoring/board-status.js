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
 * 'core' ist der Default fuer jede hier nicht genannte formulaId.
 */
// tech-hardware (P1-Carve-out 2.12a): gebaut, aber Court noch NICHT bestanden — der 7-Achsen-Satz
// trennt Franchise nicht sauber von commodity-EMS (Margen-Niveau-Achse = Folge-Task 2.12b). Bis dahin
// diagnostic (laeuft sichtbar als unbewiesen mit, zaehlt nicht als geprueft).
const DIAGNOSTIC = new Set(['consumer-staples', 'materials', 'real-estate', 'it-services', 'tech-hardware']);

function boardStatus(formulaId) {
  return DIAGNOSTIC.has(formulaId) ? 'diagnostic' : 'core';
}

module.exports = { boardStatus, DIAGNOSTIC };

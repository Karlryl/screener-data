'use strict';
/**
 * 5.2 Small-Cap-Board — Formel-Registry (DIAGNOSTIC, additiv).
 * ==============================================================
 * Praereg (protocol/5.2-smallcap-registered-20260721.md): "7 Achsen — die HG-Achsen
 * OHNE revisionsMomentum". KEIN neues Formel-Template (anders als QC) -- die 5.2-Formel
 * je Sektor ist BYTE-IDENTISCH zur bestehenden HG-Formel desselben Sektors (dieselben
 * Achsen+Gewichte+alpha+splitMetric); nur formulaId+Praefix aendern sich, damit
 * scoreUniverse ueber cohortKey=formulaId+'|'+track EIGENE Kohorten bildet (Praereg-
 * Auflage "eigene Kohorten"), getrennt von den All-Cap-HG-Kohorten.
 *
 * tech-hardware bewusst AUSGESCHLOSSEN: seine Formel traegt 8 Achsen (marginLevel,
 * 2.12b), waere ein Bruch der Praereg-Invariante "7 Achsen" fuer genau eine Kohorte.
 * tech-hardware ist ohnehin schon HG-seitig DIAGNOSTIC (board-status.js) -- kein
 * Terrain-Verlust, nur ein sauberer Fixpunkt fuer die Achsen-Anzahl ueber alle
 * Small-Cap-Kohorten hinweg.
 */
const baseFormulas = require('../index.js');

const SMALLCAP_EXCLUDED_SECTORS = new Set(['tech-hardware']);
const SMALLCAP_SECTORS = Object.keys(baseFormulas).filter((id) => !SMALLCAP_EXCLUDED_SECTORS.has(id));

module.exports = Object.fromEntries(SMALLCAP_SECTORS.map((s) => ['smallcap-' + s, baseFormulas[s]]));
Object.defineProperty(module.exports, 'SMALLCAP_SECTORS', { value: SMALLCAP_SECTORS, enumerable: false });

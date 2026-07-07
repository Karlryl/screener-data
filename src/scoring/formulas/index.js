'use strict';
/**
 * Formel-Registry: formulaId (= router sectorRoute-Output) -> Branchen-Formel.
 * JA-Branchen (eigene Formel, 2 Tracks). VIELLEICHT-Branchen folgen; ihr
 * Routing-Output ohne Registry-Eintrag faellt im Orchestrator auf 'unrouted'
 * (kein Score), bis ihre Formel gebaut ist.
 */
module.exports = {
  // JA-Branchen (2 Tracks profit/unprofit)
  semiconductors: require('./semiconductors.js'),
  'software-comm-services': require('./software-comm-services.js'),
  'tech-hardware': require('./tech-hardware.js'), // P1-Carve-out 2.12a (startet DIAGNOSTIC, s. board-status.js)
  'health-care': require('./health-care.js'),
  'consumer-discretionary': require('./consumer-discretionary.js'),
  industrials: require('./industrials.js'),
  financials: require('./financials.js'),
  energy: require('./energy.js'),
  // VIELLEICHT-Branchen (branchen-spezifischer Schnitt)
  utilities: require('./utilities.js'),
  'consumer-staples': require('./consumer-staples.js'),
  materials: require('./materials.js'),
  'real-estate': require('./real-estate.js'),
  'it-services': require('./it-services.js'),
};

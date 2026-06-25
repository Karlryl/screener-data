'use strict';
/**
 * Formel-Registry: formulaId (= router sectorRoute-Output) -> Branchen-Formel.
 * JA-Branchen (eigene Formel, 2 Tracks). VIELLEICHT-Branchen folgen; ihr
 * Routing-Output ohne Registry-Eintrag faellt im Orchestrator auf 'unrouted'
 * (kein Score), bis ihre Formel gebaut ist.
 */
module.exports = {
  semiconductors: require('./semiconductors.js'),
  'software-comm-services': require('./software-comm-services.js'),
  'health-care': require('./health-care.js'),
  'consumer-discretionary': require('./consumer-discretionary.js'),
  industrials: require('./industrials.js'),
  financials: require('./financials.js'),
  energy: require('./energy.js'),
};

'use strict';
/**
 * 5.2 Small-Cap-Board — Membership-Funktion (DIAGNOSTIC, additiv).
 * =================================================================
 * Praereg protocol/5.2-smallcap-registered-20260721.md: "US-Operating-Companies,
 * Marktkapital-Floor $300M, Small/Micro-Cap", "Universe-Filter + US-Filter wie
 * 5.1-Probe (probe-smallcap-*.js R1-R6)".
 *
 * smallcapRoute(s) delegiert zwingend an route() (erbt ALLE struct/non-operating-
 * Excludes) und ergaenzt zwei eigene Gates:
 *   1) isUS(s) (router.js) -> route() allein laesst per Weltweit-Pivot (A3-Stufe-2)
 *      auch foreign-LISTED Namen durch; 5.2 ist explizit US-only -> exclude 'smallcap-non-us'.
 *   2) Marktkapital-Band [MIN_MCAP, MAX_MCAP] — WOERTLICH aus scripts/probe-smallcap-
 *      coverage.js uebernommen (dieselben Konstanten, kein neuer Wert): das ist die
 *      5.1-Probe, auf die die Praereg fuer den Universe-Filter verweist. ANNAHME
 *      (dokumentiert, da die Praereg nur den Floor explizit nennt): die Praereg-Formel
 *      "Small/Micro-Cap" braucht auch eine Obergrenze (sonst waeren NVDA/AAPL etc. mit
 *      $300M-Floor-only im Board) -- ohne eigene neue Zahl zu erfinden (Invariante 3) wird
 *      die bereits Court-bekannte 5.1-Probe-Grenze $800M woertlich wiederverwendet. Falls
 *      Karl eine andere/offene Obergrenze will: 1-Zeilen-Parameter-Aenderung hier.
 * route -> formulaId 'smallcap-<sector>'. Survival/exclude von route() -> exclude.
 */
const { route, isUS } = require('./router.js');
const { MIN_MCAP, MAX_MCAP } = require('../../scripts/probe-smallcap-coverage.js');

function smallcapRoute(s) {
  const r = route(s);
  if (r.action !== 'route') return { action: 'exclude', reason: r.reason || r.action };
  if (!isUS(s)) return { action: 'exclude', reason: 'smallcap-non-us' };
  const mcRaw = s && s.marketCap;
  const mc = (mcRaw && Number.isFinite(mcRaw.value)) ? mcRaw.value : null;
  if (!Number.isFinite(mc) || mc < MIN_MCAP || mc > MAX_MCAP) return { action: 'exclude', reason: 'smallcap-mcap-out-of-band' };
  return { action: 'route', formulaId: 'smallcap-' + r.formulaId };
}

module.exports = { smallcapRoute, MIN_MCAP, MAX_MCAP };

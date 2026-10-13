'use strict';
/**
 * bh-dryround-zeroclose-fallback.test.js
 *
 * Bless-Gate-P2 (Codex, 20.07.2026) zu Court E-20260720-5 (A-konsistent):
 * Der No-Canonical-Fallback (nearestTradingDay + map.get) akzeptierte bzw.
 * droppte 0-Bars anders als der kanonische Pfad (_priceAtCanonical): fuer
 * [100 am Einstieg, 110 am Vortag, 0 am Zieltag] lieferte kanonisch 10 %/n=1,
 * der Fallback null/n=0. Median-/Alpha-Kohorte hing damit an Benchmark-
 * Verfuegbarkeit und Preprocessing-Stand — genau die Pfad-Divergenz, die das
 * Court-Argument Preprocessing-Invarianz verbietet. Fix: dasselbe
 * _usableClose-Praedikat in nearestTradingDay.
 */
const assert = require('node:assert/strict');
const { computeUniverseMedianReturn, nearestTradingDay } = require('../../scripts/walk-forward-perf.js');

const asOf = '2026-01-05';
const horizon = 84;
const t1 = '2026-03-30'; // asOf + 84
const canonical = { entryDate: asOf, exitDate: t1 };

// ── Integrationstest: 0-Glitch am Zieltag, gueltiger Vortagskurs ──
const mkIdx = (exitClose) => ({ T: new Map([[asOf, 100], ['2026-03-29', 110], [t1, exitClose]]) });

const viaCanonical = computeUniverseMedianReturn(mkIdx(0), asOf, horizon, ['T'], canonical);
const viaFallback = computeUniverseMedianReturn(mkIdx(0), asOf, horizon, ['T'], null);
assert.equal(viaCanonical.n, 1, 'kanonischer Pfad bucht den Vortagskurs (n=1)');
assert.ok(Math.abs(viaCanonical.median - 10) < 1e-9, 'kanonisch: 110/100-1 = 10 %');
assert.equal(viaFallback.n, 1, 'Fallback-Pfad bucht denselben Ticker (n=1) — keine Pfad-Divergenz mehr');
assert.ok(Math.abs(viaFallback.median - viaCanonical.median) < 1e-9, 'beide Pfade liefern identische Mediane');

// ── negativer Bar verhaelt sich wie 0-Bar (usable ist strikt > 0) ──
const negFallback = computeUniverseMedianReturn(mkIdx(-5), asOf, horizon, ['T'], null);
assert.equal(negFallback.n, 1, 'negativer Glitch-Bar wird wie 0 uebersprungen');
assert.ok(Math.abs(negFallback.median - 10) < 1e-9);

// ── kleiner Positivkurs bleibt gueltig (kein Ueber-Skip) ──
const tiny = computeUniverseMedianReturn(mkIdx(0.0001), asOf, horizon, ['T'], null);
assert.equal(tiny.n, 1);
assert.ok(tiny.median < -99.99, 'kleiner Positivkurs ist usable und wird echt gebucht');

// ── nearestTradingDay direkt: 0-Bar am Ziel -> Vortag; ganz ohne usable -> null ──
assert.equal(nearestTradingDay(t1, mkIdx(0).T), '2026-03-29', '0-Bar zaehlt nicht als Trading Day');
assert.equal(nearestTradingDay(t1, new Map([[t1, 0]])), null, 'nur unusable Bars im Fenster -> null (kein Erfinden)');
assert.equal(nearestTradingDay(t1, mkIdx(7).T), t1, 'usable Close am Zieltag gewinnt unveraendert');

// ── Bless-Gate-P2 Runde 2: Fenster-Vereinheitlichung — usable Close liegt 6
// Kalendertage vor dem 0-Ziel-Bar. Kanonisch (7-Tage-Fenster) bucht ihn; der
// alte 5-Tage-Fallback droppte -> jetzt identisch (gleicher Resolver).
const idx6d = { T: new Map([[asOf, 100], ['2026-03-24', 110], [t1, 0]]) };
const farCanon = computeUniverseMedianReturn(idx6d, asOf, horizon, ['T'], canonical);
const farFb = computeUniverseMedianReturn(idx6d, asOf, horizon, ['T'], null);
assert.equal(farCanon.n, farFb.n, 'gleiches Lookback-Fenster in beiden Pfaden');
assert.equal(farFb.n, 1, 'usable Close an t-6 wird auch im Fallback gebucht');

// ── kein Look-ahead mehr im Fallback: einziger Exit-Kurs liegt NACH t1 ->
// beide Pfade droppen (vorher snappte der Fallback bis 5 Tage nach vorn).
const idxFwd = { T: new Map([[asOf, 100], ['2026-04-02', 120]]) };
const fwdFb = computeUniverseMedianReturn(idxFwd, asOf, horizon, ['T'], null);
assert.equal(fwdFb.n, 0, 'Fallback nutzt keinen Zukunftskurs (kein Look-ahead, kanonische Parität)');

// ── Anker-Konsistenz (Bless-Gate-P2 Runde 2): terminale Glitch-Bars sind kein
// Reife-/Frische-Beleg.
const ric = require('../../scripts/rank-ic.js');
const wf = require('../../scripts/walk-forward-perf.js');
assert.equal(
  ric.newestPriceDate({ SPY: new Map([['2026-03-29', 100], ['2026-03-30', 0]]) }),
  '2026-03-29', 'newestPriceDate: terminaler 0-Bar reift kein Fenster');
assert.equal(
  wf.maxPriceDate({ SPY: [{ date: '2026-03-29', close: 100 }, { date: '2026-03-30', close: 0 }] }),
  '2026-03-29', 'maxPriceDate: terminaler 0-Bar ist kein Frische-Beleg');
assert.equal(
  wf.maxPriceDate({ SPY: [{ date: '2026-03-30', close: 0 }] }),
  null, 'maxPriceDate: Store ohne usable Close -> null (fail-loud statt frisch)');

console.log('PASS bh-dryround-zeroclose-fallback: kanonisch==Fallback (0/negativ uebersprungen, 7-Tage-Fenster vereinheitlicht, kein Look-ahead, Anker usable-basiert)');
process.exit(0);

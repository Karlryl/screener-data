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

console.log('PASS bh-dryround-zeroclose-fallback: kanonisch==Fallback (0/negativ uebersprungen, kleiner Positivkurs gebucht)');
process.exit(0);

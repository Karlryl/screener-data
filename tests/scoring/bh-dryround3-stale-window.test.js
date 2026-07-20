'use strict';
/**
 * bh-dryround3-stale-window.test.js — Dry Round #3 Fund T2 (20.07.2026).
 *
 * windowReturns poolte Fenster mit still verschobenen Entry-/Exit-Daten als
 * nominale 28d/84d-Punkte: _priceAtCanonical loest bis 7 Kalendertage
 * rueckwaerts auf; classify() liefert entryStale/exitStale (BH-112, Schwelle
 * EXIT_STALE_FLAG_BUSINESS_DAYS=2 Geschaeftstage) genau als Drop-Signal —
 * hatte aber keinen Produktions-Konsumenten. Ein Entry-Rueckgriff buchte
 * zudem einen an t0 nicht handelbaren Vor-Pause-Kurs (Wiedereroeffnungs-
 * Bewegung floss in den Score-IC). Fix: stale Fenster fliegen als
 * excluded_stale_window raus (Ausweis in unusableRate), auch im
 * par.8-Verkuerzungspfad. Toleranz = die BESTEHENDE lib-Schwelle, analog
 * HORIZON_TOLERANCE in walk-forward-perf.js (keine neue Erfindung).
 */
const assert = require('node:assert/strict');
const ric = require('../../scripts/rank-ic.js');

const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const t0 = '2026-01-05'; // Montag
const t1 = addDays(t0, 84);
const mkDense = (start, days, price) => { const m = new Map(); for (let i = 0; i <= days; i++) m.set(addDays(start, i), price); return m; };
const rows = (ts) => ts.map((t, i) => ({ ticker: t, score: 90 - i, pit: null }));

// ── Fall A: Entry-Luecke > 2 Geschaeftstage (Handelspause um t0) -> excluded ──
// Serie hat Kurse bis t0-7 und ab t0+6 (Feiertagswoche): Entry loest auf t0-7,
// entryStaleDays = 5 Geschaeftstage > 2 -> Fenster fliegt raus.
const idxA = { SPY: mkDense(addDays(t0, -120), 220, 500), GAP: (() => {
  const m = mkDense(addDays(t0, -120), 113, 100); // ...bis t0-7
  for (let i = 6; i <= 120; i++) m.set(addDays(t0, i), 130); // ab t0+6 weiter
  return m;
})() };
const wA = ric.windowReturns(idxA, rows(['GAP']), t0, 84);
assert.equal(wA.quota.excluded_stale_window, 1, 'Entry-Pause > Schwelle wird ausgeschlossen, nicht als 84d-Punkt gebucht');
assert.equal(wA.used.length, 0);
assert.ok(wA.unusableRate === 1, 'Ausschluss ist im unusableRate-Ausweis sichtbar');

// ── Fall B: dichte Serie (Entry/Exit exakt) -> weiter ok, kein Ueber-Filter ──
const idxB = { CLEAN: mkDense(addDays(t0, -120), 250, 100) };
const wB = ric.windowReturns(idxB, rows(['CLEAN']), t0, 84);
assert.equal(wB.quota.ok, 1, 'dichte Serie bleibt ok');
assert.equal(wB.quota.excluded_stale_window, 0);

// ── Fall C: Wochenend-/Kleinst-Luecke (<= 2 Geschaeftstage) bleibt ok ──
// Serie ohne Wochenenden: t0 ist Montag und vorhanden; Exit t1 fehlt, letzter
// Kurs am Freitag davor (1 Geschaeftstag Abstand) -> innerhalb Schwelle -> ok.
const idxC = { WKND: (() => {
  const m = new Map();
  for (let i = -120; i <= 120; i++) { const d = addDays(t0, i); const dow = new Date(d + 'T00:00:00Z').getUTCDay(); if (dow !== 0 && dow !== 6 && d !== t1) m.set(d, 100); }
  return m;
})() };
const wC = ric.windowReturns(idxC, rows(['WKND']), t0, 84);
assert.equal(wC.quota.ok, 1, 'Luecke innerhalb der bestehenden 2-Geschaeftstage-Schwelle bleibt messbar');
assert.equal(wC.quota.excluded_stale_window, 0);

console.log('PASS bh-dryround3-stale-window: stale Fenster raus, dichte + Kleinst-Luecken bleiben');
process.exit(0);

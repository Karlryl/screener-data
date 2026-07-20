'use strict';
/**
 * bh-dryround-zeroclose-mask.test.js
 *
 * Regression für den R-Gate-Dry-Round-Fund 2 (20.07.2026, Codex-Bless-Gate),
 * vervollständigt per Court E-20260720-5 („A-konsistent", Karl-ratifiziert):
 * ein 0/negativer Bar ist KEIN Preis — _priceAtCanonical, _resolvedDate und
 * _maxDateInMap (newest_usable) überspringen ihn mit derselben usable-
 * Definition (>0, finite). Ein terminaler 0-Glitch ist kein Delisting-Beleg
 * mehr (ersetzt das BH-101-0-Handling; Grund Preprocessing-Invarianz: dieselbe
 * Serie darf vor/nach dem Preis-Store-Putz Tag 387 nicht anders messen).
 * Delisting (-100 %) braucht ein unabhängiges Event-Label, nie close<=0.
 *
 * Fälle: A Bug-Repro Exit / B kein usable im Lookback / C Entry-Seite /
 * D Metadaten-Konsistenz (Bless-Gate-Fund 1) / E kleiner Positivkurs bleibt
 * gültig / F mehrere terminale 0-Bars + Zähler / G Mid-Life-0 /
 * H kein close<=0-Delisting.
 */
const assert = require('node:assert/strict');
const { classify } = require('../../lib/forward-returns.js');

const t0 = '2026-01-05';
const t1 = '2026-03-30'; // 84 Kalendertage

// ── Fall A (der Bug): 0-Glitch GENAU am Exit, gültiger Kurs an t1-1 (Vortag) ──
// Vor dem Fix: p1 = map.get(t1) = 0 -> p1<=0 -> newest===t1
// -> 'delisted' (-100%). Nach dem Fix: 0 überspringen -> t1-1=130 -> 'ok', +30%.
const idxA = { T: new Map([[t0, 100], ['2026-03-29', 130], [t1, 0]]) };
const a = classify(idxA, 'T', t0, t1);
assert.equal(a.status, 'ok', '0-Glitch am Exit darf keinen validen Vortagskurs maskieren (kein Falsch-Delisting)');
assert.ok(Math.abs(a.ret - 0.3) < 1e-9, 'Return nutzt den gültigen t1-1-Kurs 130/100-1 = 0.3');

// ── Fall D (Metadaten-Konsistenz, Bless-Gate-Fund 1): resolvedExitDate muss den
// TATSÄCHLICH genutzten Tag melden (t1-1), nicht t1 — Preis und Metadaten aus
// demselben usable-Prädikat. horizonActualDays entsprechend 83, nicht 84.
assert.equal(a.resolvedExitDate, '2026-03-29', 'resolvedExitDate meldet den real genutzten Tag (t1-1), nicht den 0-Bar-Tag');
assert.equal(a.resolvedEntryDate, t0);
assert.equal(a.horizonActualDays, 83, 'effektives Fenster = t0..t1-1 = 83 Tage');
assert.equal(a.ignoredTerminalBars, 1, 'der ignorierte terminale 0-Bar wird gezählt, nicht verschwiegen');

// ── Fall B (Regressionsschutz): 0-Glitch am Exit, KEIN gültiger Kurs im 7-Tage-
// Lookback (letzter echter Kurs > 7 Tage vor t1). Court E-20260720-5: die Serie
// endet real am letzten usable Close -> 'series_ended' (letzter realer Kurs),
// NIE 'ok' und NIE 'delisted'/-100 %.
const idxB = { T: new Map([[t0, 100], ['2026-01-06', 105], [t1, 0]]) };
const b = classify(idxB, 'T', t0, t1);
assert.notEqual(b.status, 'ok', 'ohne gültigen Kurs im Lookback bleibt es series_ended, nie ok');
assert.equal(b.status, 'series_ended', 'terminaler 0-Bar ist kein Coverage-/Delisting-Beleg (Court E-20260720-5)');
assert.equal(b.newestDate, '2026-01-06', 'newestDate = letzter USABLE Close');
assert.equal(b.ignoredTerminalBars, 1);

// ── Fall H (kein close<=0-Delisting mehr): dieselbe Form, die unter BH-101 als
// 'delisted' (-100 %) gebucht worden wäre (newest===t1 mit 0-Close), ist jetzt
// series_ended — Delisting nur per unabhängigem Event-Label.
assert.notEqual(b.status, 'delisted', '-100% darf nie mehr aus close<=0 abgeleitet werden');

// ── Fall C (Entry-Seite): 0-Glitch am Einstieg, gültiger Kurs an t0-1 ──
const idxC = { T: new Map([['2026-01-04', 98], [t0, 0], [t1, 120]]) };
const c = classify(idxC, 'T', t0, t1);
assert.equal(c.status, 'ok', '0-Glitch am Einstieg darf keinen validen Vortagskurs maskieren');
assert.ok(Math.abs(c.ret - (120 / 98 - 1)) < 1e-9, 'Einstieg nutzt den gültigen t0-1-Kurs 98');
assert.equal(c.resolvedEntryDate, '2026-01-04', 'Entry-Metadaten konsistent zum genutzten Kurs');

// ── Fall E (Codex-Pflichtfall): kleiner Positivkurs bleibt gültig — usable ist
// strikt >0, ein Penny-/Micro-Kurs ist ein echter Preis und wird NICHT übersprungen.
const idxE = { T: new Map([[t0, 100], [t1, 0.0001]]) };
const e = classify(idxE, 'T', t0, t1);
assert.equal(e.status, 'ok', 'kleiner Positivkurs (0.0001) ist usable');
assert.ok(Math.abs(e.ret - (0.0001 / 100 - 1)) < 1e-9, 'Return nutzt den kleinen Positivkurs unverändert');

// ── Fall F (Codex-Pflichtfall): MEHRERE terminale 0-Bars — Lookback läuft über
// alle Glitch-Bars hinweg bis zum letzten usable Close; Zähler = 2.
const idxF = { T: new Map([[t0, 100], ['2026-03-28', 120], ['2026-03-29', 0], [t1, 0]]) };
const f = classify(idxF, 'T', t0, t1);
assert.equal(f.status, 'ok', 'mehrere terminale 0-Bars werden alle übersprungen');
assert.ok(Math.abs(f.ret - 0.2) < 1e-9, 'Return nutzt den letzten usable Close 120');
assert.equal(f.resolvedExitDate, '2026-03-28');
assert.equal(f.ignoredTerminalBars, 2, 'beide ignorierten terminalen 0-Bars werden gezählt');

// ── Fall G (Codex-Pflichtfall): Mid-Life-0 — ein 0-Bar MITTEN in der Serie
// (nicht an Entry/Exit) beeinflusst weder Klassifikation noch newest_usable.
const idxG = { T: new Map([[t0, 100], ['2026-02-10', 0], [t1, 150]]) };
const g = classify(idxG, 'T', t0, t1);
assert.equal(g.status, 'ok', 'Mid-Life-0 stört die Messung nicht');
assert.ok(Math.abs(g.ret - 0.5) < 1e-9);
assert.equal(g.ignoredTerminalBars, 0, 'Mid-Life-0 liegt vor dem letzten usable Close -> kein terminaler Zähler');

console.log('PASS bh-dryround-zeroclose-mask: A/D Exit+Metadaten, B/H series_ended statt Delisting, C Entry, E kleiner Positivkurs, F Mehrfach-0+Zähler, G Mid-Life-0');
process.exit(0);

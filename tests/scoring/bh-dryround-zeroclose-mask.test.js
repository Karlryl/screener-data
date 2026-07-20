'use strict';
/**
 * bh-dryround-zeroclose-mask.test.js
 *
 * Regression für den R-Gate-Dry-Round-Fund 2 (20.07.2026, Codex-Bless-Gate):
 * _priceAtCanonical (walk-forward-perf.js) gibt den Wert des ersten vorhandenen
 * Datums-Bars zurück, AUCH wenn er 0/negativ ist. Ein 0-Kurs-Glitch genau am
 * Zieltag maskiert damit einen gültigen Kurs an t-1 im erlaubten 7-Tage-Lookback:
 * p1=0 -> p1<=0-Pfad -> bei newest===exitDate ein falsches -100%-Delisting.
 *
 * Korrekt: ein 0/negativer Bar ist KEIN brauchbarer Kurs; wie ein fehlender
 * behandeln und im Lookback weitersuchen. Betrifft ein geteiltes Primitiv
 * (auch computeUniverseMedianReturn) -> volle Suite ist der Wächter.
 */
const assert = require('node:assert/strict');
const { classify } = require('../../lib/forward-returns.js');

const t0 = '2026-01-05';
const t1 = '2026-03-30'; // 84 Kalendertage

// ── Fall A (der Bug): 0-Glitch GENAU am Exit, gültiger Kurs an t1-1 (Vortag) ──
// t1-1 = 2026-03-29. Vor dem Fix: p1 = map.get(t1) = 0 -> p1<=0 -> newest===t1
// -> 'delisted' (-100%). Nach dem Fix: 0 überspringen -> t1-1=130 -> 'ok', +30%.
const idxA = { T: new Map([[t0, 100], ['2026-03-29', 130], [t1, 0]]) };
const a = classify(idxA, 'T', t0, t1);
assert.equal(a.status, 'ok', '0-Glitch am Exit darf keinen validen Vortagskurs maskieren (kein Falsch-Delisting)');
assert.ok(Math.abs(a.ret - 0.3) < 1e-9, 'Return nutzt den gültigen t1-1-Kurs 130/100-1 = 0.3');

// ── Fall B (Regressionsschutz): 0-Glitch am Exit, KEIN gültiger Kurs im 7-Tage-
// Lookback (letzter echter Kurs > 7 Tage vor t1). Muss weiter als delisted/
// series_ended behandelt werden — der Fix darf hier NICHT fälschlich 'ok' machen.
const idxB = { T: new Map([[t0, 100], ['2026-01-06', 105], [t1, 0]]) };
const b = classify(idxB, 'T', t0, t1);
assert.notEqual(b.status, 'ok', 'ohne gültigen Kurs im Lookback bleibt es delisted/series_ended, nie ok');

// ── Fall C (Entry-Seite): 0-Glitch am Einstieg, gültiger Kurs an t0-1 ──
// Vor dem Fix: p0=0 -> no_entry_price (Titel faellt raus). Nach dem Fix: t0-1
// wird genutzt -> gültiger Einstieg.
const idxC = { T: new Map([['2026-01-04', 98], [t0, 0], [t1, 120]]) };
const c = classify(idxC, 'T', t0, t1);
assert.equal(c.status, 'ok', '0-Glitch am Einstieg darf keinen validen Vortagskurs maskieren');
assert.ok(Math.abs(c.ret - (120 / 98 - 1)) < 1e-9, 'Einstieg nutzt den gültigen t0-1-Kurs 98');

console.log('PASS bh-dryround-zeroclose-mask: A Vortag genutzt, B kein Falsch-ok, C Entry-Vortag genutzt');
process.exit(0);

'use strict';
/**
 * t174-loosesanity-ganzserie.test.js — Waechter zur T174-Haertung.
 *
 * Befund (T168/CWCO, 29.08.2026): looseSanity() prueft die Umsatz-Skala nur im
 * JUENGSTEN Jahr. Die falsche Tag-Wahl (IncludingAssessedTax vor Revenues) stand in
 * den VORJAHREN und blieb damit unsichtbar.
 *
 * Gebaut wird die VERENGTE Variante (ENTSCHIED 14 Punkt 2): Umsatz-Skala ueber die
 * ganze Reihe, OpInc-Vorzeichen weiter newest-only. Vorbedingung des Wiederaufgriffs
 * (reports/t168-t174-schicht-diff-2026-08-29.md, "Was T174 wirklich braucht"): eine
 * AUSRICHTUNGS-REGEL vor dem positionsweisen Vergleich — 4 der 5 gemessenen Kipp-Faelle
 * (ASM -1, BVC -2, VIR -2, WDC -1) waren Jahres-Versatz-Fehlalarme, kein Befund.
 *
 * Der Waechter haengt am OBJEKT (looseSanity/besterVersatz), nicht an einem Textmuster,
 * und nagelt BEIDE Richtungen fest:
 *   (1) Altjahr-Abweichung schlaegt an   — und die alte newest-only-Wache saehe sie NICHT
 *   (2) saubere Serie bleibt gruen
 *   (3) Jahres-Versatz kippt NICHT       — die Ausrichtung faengt ihn ab
 *   (4) ohne belegte Ausrichtung kein Urteil (H5: leere Messmenge ist kein Negativbefund)
 *   (5) Luecken verschieben die Positionen nicht
 * dazu die Alt-Regeln, die die Haertung nicht kaputtmachen darf.
 *
 * Usage: node tests/t174-loosesanity-ganzserie.test.js   (Exit 0/1)
 */
const assert = require('node:assert/strict');
const { looseSanity, besterVersatz, plainMitLuecken } = require('../scripts/build-secannual.js');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); }
}

const M = (n) => n * 1e6;
// Zellen-Form wie in der Schicht: {value, fy}. Die Wache muss beide Formen lesen
// (blanke Zahlen wie in manchen Snapshots, Objekte wie aus extractSecSeries).
const zellen = (vals, fy0 = 2024) => vals.map((v, i) => ({ value: v, fy: fy0 - i }));

// ── (1) Altjahr-Abweichung schlaegt an ───────────────────────────────────────
// CWCO-Signatur, aber ueber der Schwelle: juengstes Jahr deckungsgleich (die alte Wache
// sagt gruen), ein Vorjahr steht um Faktor 3 daneben.
test('Altjahr-Abweichung > Faktor 2 schlaegt an, obwohl das juengste Jahr passt', () => {
  const yRev = [M(500), M(480), M(460), M(440)];
  const sRev = zellen([M(500), M(480), M(150), M(440)]);
  assert.equal(besterVersatz(yRev, sRev).lage, 'null-versatz', 'Ausrichtung muss belegt sein');
  assert.equal(looseSanity([M(50)], zellen([M(50)]), yRev, sRev), false);
});
test('dieselbe Reihe waere unter der ALTEN newest-only-Regel gruen gelaufen', () => {
  // Alte Regel woertlich: nur das juengste Umsatzpaar. 500 gegen 500 -> Faktor 1.
  const yNeu = M(500), sNeu = M(500);
  assert.ok(Math.max(yNeu, sNeu) / Math.min(yNeu, sNeu) <= 2,
    'Beleg, dass der neue Rot-Fall NUR durch die Ganzserien-Pruefung entsteht');
});

// ── (2) saubere Serie bleibt gruen ───────────────────────────────────────────
test('deckungsgleiche Reihe bleibt gruen', () => {
  const yRev = [M(500), M(480), M(460), M(440)];
  assert.equal(looseSanity([M(50)], zellen([M(50)]), yRev, zellen([M(500), M(480), M(460), M(440)])), true);
});
test('kleine Abweichungen unter Faktor 2 bleiben gruen (Schwelle unveraendert)', () => {
  const yRev = [M(500), M(480), M(460), M(440)];
  const sRev = zellen([M(500), M(480), M(300), M(440)]); // 1,53x — die T168-Blindzone
  assert.equal(looseSanity([M(50)], zellen([M(50)]), yRev, sRev), true,
    'kein Schwellen-Wechsel: die Blindzone 1,04x-2,0x bleibt Sache von T168, nicht dieser Wache');
});

// ── (3) Jahres-Versatz ist KEIN Befund ───────────────────────────────────────
test('Jahres-Versatz kippt nicht: die Ausrichtung verschiebt den Vergleich mit', () => {
  const yRev = [M(500), M(480), M(460), M(440)];
  // SEC traegt ein Jahr mehr am jungen Ende -> Versatz +1 (y[i] passt zu s[i+1]).
  const sRev = zellen([M(620), M(500), M(480), M(460), M(440)], 2025);
  const vs = besterVersatz(yRev, sRev);
  assert.equal(vs.lage, 'versatz');
  assert.equal(vs.off, 1);
  assert.equal(looseSanity([M(50)], zellen([M(50)]), yRev, sRev), true);
});
test('ohne Ausrichtung waere genau dieser Fall ein Fehlalarm gewesen', () => {
  // Gebaut wie die echten Fehlalarme: unter der ALTEN Wache gruen (juengstes Paar
  // 500 gegen 560 = 1,12x), aber positionsweise OHNE Ausrichtung rot (200 gegen 480).
  const yRev = [M(500), M(480), M(200)];
  const sRev = zellen([M(560), M(500), M(480), M(200)], 2025);
  assert.equal(besterVersatz(yRev, sRev).off, 1);
  assert.ok(M(480) / M(200) > 2, 'Vorbedingung: ohne Ausrichtung kippte dieses Paar');
  assert.equal(looseSanity([M(50)], zellen([M(50)]), yRev, sRev), true,
    'mit Ausrichtung gruen — genau die Klasse der 4 Fehlalarme ASM/BVC/VIR/WDC');
});

// ── (4) keine belegte Ausrichtung -> kein Urteil ─────────────────────────────
test('ohne belegte Ausrichtung faellt die Wache auf newest-only zurueck', () => {
  const yRev = [M(500), M(480), M(460)];
  const sRev = zellen([M(499), M(300), M(100)]); // nur 1 passendes Paar -> zu wenig
  const vs = besterVersatz(yRev, sRev);
  assert.equal(vs.lage, 'unaufgeloest');
  assert.equal(looseSanity([M(50)], zellen([M(50)]), yRev, sRev), true,
    'H5/ENTSCHIED 52: eine leere oder mehrdeutige Messmenge belegt NICHTS');
});
test('leere Messmenge liefert kein erfundenes -2', () => {
  const leer = besterVersatz([], zellen([]));
  assert.equal(leer.lage, 'unaufgeloest');
  assert.equal(leer.off, null);
});

// ── (5) Luecken verschieben nichts ───────────────────────────────────────────
test('plainMitLuecken haelt die Position einer Innenluecke', () => {
  assert.deepEqual(plainMitLuecken([{ value: 1 }, { value: null }, { value: 3 }]), [1, null, 3]);
});
test('Innenluecke in der SEC-Reihe verschiebt die Folgejahre nicht', () => {
  const yRev = [M(500), M(480), M(460), M(440)];
  const sRev = zellen([M(500), null, M(460), M(440)]);
  assert.equal(looseSanity([M(50)], zellen([M(50)]), yRev, sRev), true,
    'wuerde plain() filtern, laege 460 auf Position 1 gegen 480 — und 440 gegen 460');
});

// ── Alt-Regeln, die die Haertung nicht kaputtmachen darf ─────────────────────
test('Vorzeichen-Regel (newest OpInc) bleibt', () => {
  assert.equal(looseSanity([M(50)], zellen([-M(50)]), [M(500)], zellen([M(500)])), false);
});
test('OpInc-Vorzeichen bleibt newest-only (Altjahr-Vorzeichen kippt NICHT)', () => {
  // BB/CODI/CORZ/SFD-Klasse: gehoert ans T164/165/166-Gericht, nicht in diese Wache.
  const yRev = [M(500), M(480), M(460)];
  const sRev = zellen([M(500), M(480), M(460)]);
  assert.equal(looseSanity([M(50), -M(10), M(5)], zellen([M(50), M(10), -M(5)]), yRev, sRev), true);
});
test('neuester Umsatz > Faktor 2 bleibt rot', () => {
  assert.equal(looseSanity([M(50)], zellen([M(50)]), [M(738)], zellen([M(141)])), false);
});
test('isolierter V-Dip (10x unter beiden Nachbarn) bleibt rot', () => {
  const s = zellen([M(829), M(3.5), M(240)]);
  assert.equal(looseSanity([M(50)], zellen([M(50)]), [M(829), M(3.5), M(240)], s), false);
});

console.log(`\nt174-loosesanity-ganzserie.test.js: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);

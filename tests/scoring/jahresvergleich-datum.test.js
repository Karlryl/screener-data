// F-4 (Karl-Mandat 03.08.2026): Das Vorjahresquartal wird ueber sein ENDDATUM gewaehlt,
// nicht ueber die Listenposition i+4. Waechter fuer:
//   - snapshot.js  jahresVergleichIdx / jahresFensterAusgerichtet (die Auswahl selbst)
//   - axes.js      revGrowthLevel / revYoYComponents / revAcceleration (die Wachstumszahl)
//   - lamps.js     einmalertrag-Saisonschutz, newestQtrSuspect-Saison-Leg
//   - overview.js  grossProfitGrowthYoY (TTM-Block gegen TTM-Block)
// Und die Gegenrichtung: OHNE Perioden-Enden bleibt alles byte-identisch zur Positionsregel.
// Run: node tests/scoring/jahresvergleich-datum.test.js
'use strict';
const assert = require('assert');
const {
  jahresVergleichIdx, jahresFensterAusgerichtet, periodEnds, JAHRESVERGLEICH_TOLERANZ_TAGE,
} = require('../../src/scoring/snapshot.js');
const { revGrowthLevel, revYoYComponents, revAcceleration, revQuartalsYoY } = require('../../src/scoring/axes.js');
const { LAMPS } = require('../../src/scoring/lamps.js');
const { overviewMetric } = require('../../src/scoring/overview.js');

let fail = 0;
function check(name, fn) {
  try { fn(); console.log(`  ok   ${name}`); }
  catch (e) { fail++; console.log(`  FAIL ${name}: ${e.message}`); }
}

const q = (arr) => arr.map((value) => ({ value }));
function snap(revenueQ, revenueQEnds, annualRev, extra = {}) {
  return {
    meta: { ticker: 'TEST' },
    annual: { annualRev: q(annualRev || []) },
    timeseries: Object.assign({ revenueQ: q(revenueQ), ...(revenueQEnds ? { revenueQEnds } : {}) }, extra),
  };
}

// ── Der Anlassfall: 000962.SZ, echte Werte aus dem CI-Lauf 30787450668 ──────────────
// Enden 2026-03-31 / 2025-12-31 / 2025-06-30 / 2025-03-31 / 2024-12-31 — das
// September-Quartal fehlt. Position 4 (2024-12-31) liegt 455 Tage zurueck, das echte
// Jahresquartal (2025-03-31, exakt 365 Tage) steht an Position 3.
const SZ_WERTE = [70548764.50391889, 50942521.85387381, 67835005.89772414, 50007133.86872475, 57008860.497434005];
const SZ_ENDEN = ['2026-03-31', '2025-12-31', '2025-06-30', '2025-03-31', '2024-12-31'];

check('000962.SZ-Muster: Auswahl trifft Position 3 (365 Tage), nicht 4 (455 Tage)', () => {
  const v = jahresVergleichIdx(snap(SZ_WERTE, SZ_ENDEN), 'revenueQ', 0);
  assert.deepStrictEqual(v, { idx: 3, quelle: 'datum' });
});

check('000962.SZ-Muster: revGrowthLevel rechnet gegen das 365-Tage-Quartal', () => {
  const g = revGrowthLevel(snap(SZ_WERTE, SZ_ENDEN));
  const erwartet = (SZ_WERTE[0] / SZ_WERTE[3] - 1) * 100;   // +41,08 %
  const alt = (SZ_WERTE[0] / SZ_WERTE[4] - 1) * 100;        // +23,75 % (die Positionsregel)
  assert.ok(Math.abs(g - erwartet) < 1e-9, `g=${g} erwartet ${erwartet}`);
  assert.ok(Math.abs(g - alt) > 10, 'muss sich vom alten Positions-Ergebnis unterscheiden');
});

// ── Fehlendes Datum ist KEIN Beweis: die Positionsregel bleibt in Kraft ─────────────
check('ohne Enden-Reihe: Positionsregel i+4 unveraendert', () => {
  const s = snap(SZ_WERTE, null);
  assert.deepStrictEqual(jahresVergleichIdx(s, 'revenueQ', 0), { idx: 4, quelle: 'position' });
  const g = revGrowthLevel(s);
  assert.ok(Math.abs(g - (SZ_WERTE[0] / SZ_WERTE[4] - 1) * 100) < 1e-9, 'byte-identisch zur alten Rechnung');
});

check('Enden vorhanden, aber Position i ohne Datum -> Positionsregel', () => {
  const enden = [null, '2025-12-31', '2025-06-30', '2025-03-31', '2024-12-31'];
  assert.deepStrictEqual(jahresVergleichIdx(snap(SZ_WERTE, enden), 'revenueQ', 0), { idx: 4, quelle: 'position' });
});

check('Enden-Laenge passt nicht zur Wert-Serie -> ehrliche null-Serie, Positionsregel', () => {
  const s = snap(SZ_WERTE, ['2026-03-31']);
  assert.deepStrictEqual(periodEnds(s, 'revenueQ'), [null, null, null, null, null]);
  assert.deepStrictEqual(jahresVergleichIdx(s, 'revenueQ', 0), { idx: 4, quelle: 'position' });
});

// ── Echtes Loch: datiert, aber kein Quartal im Fenster -> nicht bildbar ─────────────
check('kein Jahrespartner im Fenster -> null (wie "zu wenige Quartale")', () => {
  const enden = ['2026-03-31', '2025-12-31', '2025-09-30', '2025-06-30'];  // aeltestes nur 274 Tage zurueck
  const s = snap([100, 90, 80, 70], enden, [400, 300]);
  assert.strictEqual(jahresVergleichIdx(s, 'revenueQ', 0), null);
  // Quartals-Bein droppt -> annual traegt (400/300-1 = +33,33 %), kein Quartals-Wert
  assert.deepStrictEqual(revYoYComponents(s).length, 1);
  assert.ok(Math.abs(revGrowthLevel(s) - 33.333333333333336) < 1e-9);
});

check('gar kein Jahres-Kandidat UND kein annual -> null (Achse droppt ehrlich)', () => {
  const s = snap([100, 90, 80, 70], ['2026-03-31', '2025-12-31', '2025-09-30', '2025-06-30'], []);
  assert.strictEqual(revGrowthLevel(s), null);
});

// ── Werte-Loch bei vollstaendigen Enden: die Luecken-Regel gilt in BEIDEN Zweigen ───
// CRD-A-Muster (echte Reihe aus snapshots/CRD-A.json): revenueQ traegt an Position 2 ein
// Loch, die Enden-Reihe ist LUECKENLOS und bestaetigt Position 4 als Jahresquartal. Die
// Vollfinit-Regel bleibt trotzdem in Kraft — F-4 aendert ausschliesslich, WELCHES Quartal
// verglichen wird, nicht ob eine loechrige Reihe ueberhaupt ein Quartals-Bein bekommt.
const CRDA_WERTE = [320126000, 320086000, null, 334595000, 323339000, 358318000];
const CRDA_ENDEN = ['2026-03-31', '2025-12-31', '2025-09-30', '2025-06-30', '2025-03-31', '2024-12-31'];

check('Werte-Loch trotz vollstaendiger Enden: Quartals-Bein droppt, Jahresreihe traegt', () => {
  const s = snap(CRDA_WERTE, CRDA_ENDEN, [800, 1000]);
  assert.deepStrictEqual(jahresVergleichIdx(s, 'revenueQ', 0), { idx: 4, quelle: 'datum' });
  assert.strictEqual(revQuartalsYoY(s), null, 'loechrige Reihe darf keine Quartalszahl liefern');
  assert.strictEqual(revYoYComponents(s).length, 1, 'nur das Jahres-Bein');
  assert.ok(Math.abs(revGrowthLevel(s) - (-20)) < 1e-9, `revGrowthLevel=${revGrowthLevel(s)} erwartet -20 (Jahresreihe)`);
});

check('Gegenprobe: dieselbe Reihe OHNE Loch liefert das Quartals-Bein', () => {
  const gefuellt = CRDA_WERTE.slice(); gefuellt[2] = 330000000;
  const s = snap(gefuellt, CRDA_ENDEN, [800, 1000]);
  const erwartet = (CRDA_WERTE[0] / CRDA_WERTE[4] - 1) * 100;   // -0,99 %
  assert.ok(Math.abs(revQuartalsYoY(s) * 100 - erwartet) < 1e-9, 'gueltige Form muss durchgehen');
  assert.ok(Math.abs(revGrowthLevel(s) - erwartet) < 1e-9, `revGrowthLevel=${revGrowthLevel(s)}`);
});

// ── Toleranz: aus den Daten begruendet, nicht gesetzt ───────────────────────────────
check(`Toleranz ${JAHRESVERGLEICH_TOLERANZ_TAGE} Tage: 366 Tage zaehlen, 455 Tage nicht`, () => {
  assert.ok(JAHRESVERGLEICH_TOLERANZ_TAGE >= 2 && JAHRESVERGLEICH_TOLERANZ_TAGE <= 29,
    'Schwelle muss in der gemessenen leeren Bank 2..29 liegen');
  // 2026-04-01 minus 366 Tage = 2025-03-31 -> im Fenster
  const nah = snap([1, 1, 1, 1, 1], ['2026-04-01', '2025-12-31', '2025-09-30', '2025-03-31', '2024-12-31']);
  assert.strictEqual(jahresVergleichIdx(nah, 'revenueQ', 0).idx, 3);
  // nur das 455-Tage-Quartal uebrig -> ausserhalb -> null
  const fern = snap([1, 1], ['2026-03-31', '2024-12-31']);
  assert.strictEqual(jahresVergleichIdx(fern, 'revenueQ', 0), null);
});

// ── Block-Vergleiche (TTM gegen TTM) ────────────────────────────────────────────────
check('jahresFensterAusgerichtet: sauberes 8-Quartals-Fenster -> true', () => {
  const enden = ['2026-03-31', '2025-12-31', '2025-09-30', '2025-06-30',
    '2025-03-31', '2024-12-31', '2024-09-30', '2024-06-30'];
  assert.strictEqual(jahresFensterAusgerichtet(snap(new Array(8).fill(1), enden), 'revenueQ', 4), true);
});
check('jahresFensterAusgerichtet: fehlendes Quartal -> false', () => {
  const enden = ['2026-03-31', '2025-12-31', '2025-06-30', '2025-03-31',
    '2024-12-31', '2024-09-30', '2024-06-30', '2024-03-31'];
  assert.strictEqual(jahresFensterAusgerichtet(snap(new Array(8).fill(1), enden), 'revenueQ', 4), false);
});
check('jahresFensterAusgerichtet: ohne Enden -> true (byte-identisch zu vorher)', () => {
  assert.strictEqual(jahresFensterAusgerichtet(snap(new Array(8).fill(1), null), 'revenueQ', 4), true);
});

check('overview grossProfitGrowthYoY: schiefes Fenster faellt auf annualGP zurueck', () => {
  const gpEnden = ['2026-03-31', '2025-12-31', '2025-06-30', '2025-03-31',
    '2024-12-31', '2024-09-30', '2024-06-30', '2024-03-31'];
  const basis = {
    meta: { ticker: 'T' },
    annual: { annualRev: q([100, 90]), annualGP: q([50, 40]) },
    timeseries: { revenueQ: q([1, 1]), grossProfitQ: q([40, 30, 30, 30, 10, 10, 10, 10]), grossProfitQEnds: gpEnden },
  };
  const m = overviewMetric(basis, 'software-comm-services', 'profitable');
  // TTM-Block waere 130/40-1 = +225 %; ausgerichtet ist er nicht -> annualGP 50/40-1 = +25 %
  assert.ok(Math.abs(m.value - 0.25) < 1e-9, `value=${m.value}`);
});

// ── Lampen ─────────────────────────────────────────────────────────────────────────
check('einmalertrag: kein Freispruch durch ein FALSCHES Vorjahresquartal', () => {
  // Die vier juengsten Quartale haben saubere Quartalskadenz (der Kadenz-Waechter vom
  // 29.07. greift also nicht). Die Spitze liegt an Position 1 (2025-12-31); ihr echtes
  // Vorjahresquartal (2024-12-31) FEHLT in der Reihe. Position 5 traegt 2024-09-30 —
  // ein anderes Quartal, und ausgerechnet ein grosses.
  const werte = [200, 900, 200, 200, 200, 800, 200];
  const enden = ['2026-03-31', '2025-12-31', '2025-09-30', '2025-06-30',
    '2025-03-31', '2024-09-30', '2024-06-30'];
  // Ohne Enden spricht Position 5 (800 >= 0,5*900) die Zeile frei — mit dem falschen Quartal.
  assert.strictEqual(LAMPS.einmalertrag(snap(werte, null)), false);
  // Mit Enden gibt es kein Quartal im Jahresfenster -> kein Freispruch, die Lampe brennt.
  assert.strictEqual(LAMPS.einmalertrag(snap(werte, enden)), true);
});

check('newestQtrSuspect: Saison-Leg nimmt das datierte Jahresquartal', () => {
  // Alle vier Verdachts-Legs feuern. Die OpMarge des juengsten Quartals (0,60) gleicht der
  // des ECHTEN Jahresquartals an Position 3 (0,60), nicht der von Position 4 (0,01).
  const enden = ['2026-03-31', '2025-12-31', '2025-06-30', '2025-03-31', '2024-12-31'];
  const reihen = { opIncQ: q([120, 10, 1, 60, 1]), grossProfitQ: q([130, 10, 10, 10, 10]) };
  const werte = [200, 100, 100, 100, 100];
  // Ohne Enden vergleicht das Saison-Leg gegen Position 4 (0,01) -> nicht saisonal -> Lampe an.
  assert.strictEqual(LAMPS.newestQtrSuspect(snap(werte, null, [], reihen)), true);
  // Mit Enden gegen Position 3 (0,60) -> Saison erkannt -> de-fire.
  const mitDatum = snap(werte, enden, [], reihen);
  assert.strictEqual(jahresVergleichIdx(mitDatum, 'revenueQ', 0).idx, 3);
  assert.strictEqual(LAMPS.newestQtrSuspect(mitDatum), false);
});

// ── revAcceleration ────────────────────────────────────────────────────────────────
check('revAcceleration: YoY-Paare ueber Datum, nicht ueber i+4', () => {
  // 9 Quartale, das Q3 des juengsten Jahres fehlt -> positional waeren die Paare falsch.
  const enden = ['2026-03-31', '2025-12-31', '2025-06-30', '2025-03-31',
    '2024-12-31', '2024-09-30', '2024-06-30', '2024-03-31', '2023-12-31'];
  const werte = [200, 150, 130, 100, 75, 70, 65, 50, 37.5];
  const s = snap(werte, enden);
  // juengstes Paar: 200 (2026-03-31) gegen 100 (2025-03-31) = +100 %
  // aeltestes Paar: 75 (2024-12-31) gegen 37.5 (2023-12-31) = +100 %  -> Beschleunigung 0
  assert.ok(Math.abs(revAcceleration(s)) < 1e-9, `acc=${revAcceleration(s)}`);
});

console.log(fail === 0 ? '\nF-4 Jahresvergleich: ALL PASS' : `\nF-4 Jahresvergleich: ${fail} FAIL`);
process.exit(fail ? 1 : 0);

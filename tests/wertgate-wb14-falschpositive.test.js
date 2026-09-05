// tests/wertgate-wb14-falschpositive.test.js — Standalone-Runner (framework-los).
// Run: node tests/wertgate-wb14-falschpositive.test.js            (Klassen-Proben UEBERSPRUNGEN, Exit 0)
//      node tests/wertgate-wb14-falschpositive.test.js --scharf   (Klassen-Proben LIVE — heute ROT)
//
// WOFUER: Die drei am 2026-09-04 GEMESSENEN Falsch-Positiv-Klassen des Integritaets-Vorrangs
// (scripts/write-board-history.js integritaetsVerfall, Court 02.09.2026 WB-4) als Fixtures.
// Sie dokumentieren den Defekt: die Implementierung zaehlt JEDE verlorene Lampe und JEDEN
// coverageAxes-Rueckgang als Verfall, die Gerichtsfassung nennt Quell-Lampen, geleerte
// Reihen und Achsenverlust. Am ersten Live-Tag der Regel waren 14 von 15 Treffern falsch
// (Anker agent-reports/orchestrator-2026-09-05-tag.md N3). Die Regel selbst wird NICHT hier
// geaendert: sie geht als WB-14-Wiedervorlage an den Rat (Council 05.09.), Ratifikation
// durch den Master; bis dahin bleibt WB-4 unveraendert und diese Proben laufen nur mit
// --scharf. Sobald die ratifizierte Fassung landet, wird SCHARF auf true gesetzt und die
// Proben werden zum Waechter.
//
// Jede Probe: registrierter daten-schub-Eintrag (also GENAU der Fall, in dem der Vorrang
// heute urteilt), ruhige Nacht, eine Zeile mit dem gemessenen Muster. Erwartung: NICHT
// suspect, kein Grund integritaets-verfall.
'use strict';
const assert = require('assert');
const W = require('../scripts/write-board-history.js');

const SCHARF = process.argv.includes('--scharf');   // bis WB-14 ratifiziert ist: false
let fail = 0;
function check(name, fn) {
  if (!SCHARF) { console.log('  skip ' + name + '  [WB-14 Wiedervorlage, Council 05.09. — mit --scharf live]'); return; }
  try { fn(); console.log('  ok   ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + ': ' + (e && e.message || e)); }
}

const GATE_BODEN = { dailyP99Samples: [], sampleDates: [], threshold: null, frozen: false };
const BOARD = 'energy';
const EINTRAG = { tag: 'Tag X', typ: 'daten-schub', letztesAltesVintage: '2026-09-01', boards: new Set([BOARD]), erklaerendeLampe: null };

function zeile(ticker, score, ueberschreib) {
  return Object.assign({
    ticker, score, coverageAxes: '7/7', lamps: ['lowRoic', 'opIncYahooAdjusted'],
    pit: { revenueQ: [120, 110, 100, 95, 90], revenueQEnds: ['2026-03-31', '2025-12-31', '2025-09-30', '2025-06-30', '2025-03-31'],
      grossProfitQ: [60, 55, 50, 48, 45], grossProfitQEnds: ['2026-03-31', '2025-12-31', '2025-09-30', '2025-06-30', '2025-03-31'] },
  }, ueberschreib || {});
}
function lage(vorherFelder, nachherFelder) {
  const vorher = [], nachher = [];
  for (let i = 0; i < 300; i++) { vorher.push(zeile('T' + i, 50)); nachher.push(zeile('T' + i, 50.3)); }
  Object.assign(vorher[0], vorherFelder || {});
  Object.assign(nachher[0], nachherFelder || {});
  const v = (rows) => ({ date: null, pitCoverage: { beta: 1 }, cohort: { profitable: rows, unprofitable: [] } });
  return { vorher: v(vorher), nachher: v(nachher) };
}
const gate = (l) => W.evaluateGate(l.nachher, l.vorher, GATE_BODEN, EINTRAG, BOARD);
const nichtSuspect = (g, was) => {
  assert.ok(!g.reasons.some((r) => /integritaets-verfall/.test(r)), was + ' als Verfall gezaehlt: ' + g.reasons.join(',') + ' / ' + JSON.stringify(g.verfallsZeilen));
  assert.ok(!g.suspect, was + ' macht das Board suspect: ' + g.reasons.join(','));
};

// Klasse (2) — Diagnose-Lampe durch frische Daten erloschen. Gemessen: PDN.TO unprofit
// (opMargin -0,57 -> +5,46 %), BKV shortRunway (FCF -329,6 -> -24,7 Mio), fcfArtefact x4,
// peakMargin x2. Keine dieser Lampen benennt eine Quelle (src/scoring/lamps.js:54/78/100/178).
check('Klasse (2): Diagnose-Lampe (fcfArtefact) erlischt durch frische Daten -> KEIN Verfall', () => {
  const l = lage({ lamps: ['lowRoic', 'fcfArtefact', 'opIncYahooAdjusted'] }, { lamps: ['lowRoic', 'opIncYahooAdjusted'] });
  nichtSuspect(gate(l), 'erloschene Diagnose-Lampe');
});

// Klasse (3) — Quell-Upgrade Yahoo -> SEC-GAAP. Gemessen: FET, WKC (nicht neu gezogen; SEC-
// Serie kam am 01.09. hinzu, opinc-source-migrate.js etikettiert sec-gaap, lamps.js:823 false).
// HINWEIS: die Gerichtsfassung nennt "Quell-Lampe geht verloren" als Verfall — ob ein
// UPGRADE darunter faellt, entscheidet der Rat (WB-14). Erwartung hier = Messbefund 05.09.
check('Klasse (3): Quell-Lampe opIncYahooAdjusted erlischt durch Upgrade auf SEC-GAAP -> KEIN Verfall', () => {
  const l = lage({ lamps: ['lowRoic', 'opIncYahooAdjusted'] }, { lamps: ['lowRoic'] });
  nichtSuspect(gate(l), 'Quell-Upgrade');
});

// Klasse (4) — fuehrende Null-Quartalsluecke: Yahoo liefert das neue Quartal als Slot mit
// leeren Werten (revenueQ[0] = null, Enden gesetzt) -> marginTrajectory ehrlich null
// (src/scoring/axes.js:288-301) -> coverageAxes -1. Gemessen: DUK, PPL, AVA, ENB. Die Reihe
// ist NICHT geleert (vier gefuellte Quartale bleiben), sie ist um einen leeren Slot laenger.
check('Klasse (4): fuehrender Null-Slot 2026-06-30, coverageAxes 7/7 -> 6/7 -> KEIN Verfall', () => {
  const l = lage({}, {
    coverageAxes: '6/7',
    pit: { revenueQ: [null, 120, 110, 100, 95], revenueQEnds: ['2026-06-30', '2026-03-31', '2025-12-31', '2025-09-30', '2025-06-30'],
      grossProfitQ: [null, 60, 55, 50, 48], grossProfitQEnds: ['2026-06-30', '2026-03-31', '2025-12-31', '2025-09-30', '2025-06-30'] },
  });
  nichtSuspect(gate(l), 'fuehrender Null-Slot');
});

// Gegenprobe, laeuft IMMER: die FTI-Klasse (Reihe geleert, Achsen weg, beide Lampen weg) muss
// unter jeder Fassung SUSPECT bleiben — sonst waere die Wiedervorlage eine Abschaltung.
(function () {
  const l = lage({ coverageAxes: '6/7', lamps: ['peakMargin', 'opIncYahooAdjusted'] },
    { coverageAxes: '4/7', lamps: [], pit: { revenueQ: [120, 110, 100, 95, 90], revenueQEnds: ['2026-03-31', '2025-12-31', '2025-09-30', '2025-06-30', '2025-03-31'], grossProfitQ: [], grossProfitQEnds: [] } });
  const g = gate(l);
  try {
    assert.ok(g.reasons.some((r) => /integritaets-verfall/.test(r)) && g.suspect, 'FTI-Klasse muss SUSPECT bleiben: ' + g.reasons.join(','));
    console.log('  ok   Klasse (1) FTI (Reihe geleert, 6/7 -> 4/7, Lampen weg) bleibt SUSPECT — laeuft immer');
  } catch (e) { fail++; console.log('  FAIL Klasse (1): ' + e.message); }
})();

if (fail) { console.log('\nFAIL: wertgate-wb14-falschpositive (' + fail + ')'); process.exit(1); }
console.log('\nOK: wertgate-wb14-falschpositive' + (SCHARF ? ' (scharf)' : ' (Klassen-Proben uebersprungen bis WB-14)'));

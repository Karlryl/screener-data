// tests/wertgate-261-entbunden.test.js — Standalone-Runner (framework-los).
// Run: node tests/wertgate-261-entbunden.test.js
//
// WOFUER: Waechter zur ENTBINDUNG des Registereintrags Tag 1204 (#261, typ daten-schub,
// letztes_altes_vintage 2026-09-01) am 2026-09-05 (Master-Ratifikation unter der Delegation
// vom 29.08., Anker agent-reports/orchestrator-2026-09-05-tag.md N3/N6).
//
// DER BEFUND, gemessen am Vintage 2026-09-04 gegen 2026-09-01 (Snapshots-Artefakte der Laeufe
// 33493908237 / 33903266385, Live-Zeilen aus gh-pages): 15 Verfallszeilen, davon 14 falsch-
// positiv — Lampen durch frische Daten erloschen (8), Quell-Upgrade Yahoo->SEC-GAAP (FET, WKC),
// fuehrende Null-Quartalsluecke 2026-06-30 -> marginTrajectory null (DUK, PPL, AVA, ENB).
// Der einzige echte Schaden (FTI) wird per voll_pull_ticker=FTI VOR dem Landen geheilt.
// Weil die drei Falsch-Positiv-Klassen gegen den Vorgaenger 2026-09-01 dauerhaft bestehen,
// landet unter der Bindung nie ein Vintage, der Eintrag wird nie verbraucht, und der
// Commit-Schritt nimmt jeden Tag das ganze Tagesverzeichnis heraus: Dauersperre aller 13
// Boards. Die Entbindung (boards -> null, Praezedenz Tag 579) loest genau das.
//
// WAS DIESER WAECHTER PINNT (die Sache, nicht die Schreibweise):
//   1. Der Eintrag bleibt im Register (Historie, Q3 des Court 02.09.: "#261 bleibt"), traegt
//      aber KEINE aktive Board-Bindung mehr; die alte Liste steht als boards_bis_2026-09-05.
//   2. Am Objekt: massstabBruchFuer('2026-09-01') liefert null — kein Eintrag bindet Boards
//      fuer diesen Vorgaenger.
//   3. Am Gate: ohne bindenden Eintrag laeuft der Integritaets-Vorrang NICHT (verfallsZeilen
//      leer, datenSchub false), auch wenn eine Zeile eine Lampe verloren hat — und die
//      Gegenprobe zeigt, dass derselbe Verfall MIT Bindung weiterhin SUSPECT ergibt (WB-4 im
//      Code unveraendert fuer den naechsten registrierten Datenschub).
// Sabotage-Nachweis (einmal absichtlich gebrochen, Anker N6): boards wieder auf die Liste ->
// Pruefungen 2/3 rot; `if (boards.length === 0) return null` in massstabBruchFuer entfernt ->
// Pruefung 3 rot.
'use strict';
const assert = require('assert');
const W = require('../scripts/write-board-history.js');

let fail = 0;
function check(name, fn) {
  try { fn(); console.log('  ok   ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + ': ' + (e && e.message || e)); }
}

const GATE_BODEN = { dailyP99Samples: [], sampleDates: [], threshold: null, frozen: false };
const BOARD = 'energy';
const GEBUNDEN = { tag: 'Tag 1204', typ: 'daten-schub', letztesAltesVintage: '2026-09-01', boards: new Set([BOARD]), erklaerendeLampe: null };

function zeile(ticker, score, ueberschreib) {
  return Object.assign({
    ticker, score, coverageAxes: '6/7', lamps: ['peakMargin', 'opIncYahooAdjusted'],
    pit: { revenueQ: [120, 110, 100], revenueQEnds: ['2026-06-30', '2026-03-31', '2025-12-31'],
      grossProfitQ: [60, 55, 50], grossProfitQEnds: ['2026-06-30', '2026-03-31', '2025-12-31'] },
  }, ueberschreib || {});
}
// Ruhige Nacht (alle Zeilen +0,30), eine Zeile verliert eine Lampe (genau die Klasse, die am
// 04.09. 14 von 15 Treffern stellte). Ohne Bindung darf das kein Urteil tragen.
function lage() {
  const vorher = [], nachher = [];
  for (let i = 0; i < 300; i++) { vorher.push(zeile('T' + i, 50)); nachher.push(zeile('T' + i, 50.3)); }
  nachher[0].lamps = ['peakMargin'];                      // 'opIncYahooAdjusted' verloren
  const v = (rows) => ({ date: null, pitCoverage: { beta: 1 }, cohort: { profitable: rows, unprofitable: [] } });
  return { vorher: v(vorher), nachher: v(nachher) };
}

// ── 1. Register: Eintrag bleibt, Bindung weg ─────────────────────────────────
check('REGISTER: Tag 1204/#261 steht weiter im Register, typ daten-schub, Vorgaenger 2026-09-01 (Historie bleibt)', () => {
  const reg = require('../board-history/_excluded.json')._massstab_brueche;
  const e = reg.find((x) => x && x.tag === 'Tag 1204');
  assert.ok(e, 'Eintrag Tag 1204 fehlt — die Historie darf nicht geloescht werden');
  assert.strictEqual(e.typ, 'daten-schub');
  assert.strictEqual(e.letztes_altes_vintage, '2026-09-01');
  assert.ok(typeof e.wirkung_gemessen === 'string' && e.wirkung_gemessen.length > 0, 'Dokumentationsfeld wirkung_gemessen fehlt');
  assert.ok(!('erklaerende_lampe' in e), 'WB-9: daten-schub darf nie blenden');
});

check('REGISTER: Tag 1204 traegt KEINE aktive Board-Bindung mehr (boards === null), alte Liste + Begruendung dokumentiert', () => {
  const reg = require('../board-history/_excluded.json')._massstab_brueche;
  const e = reg.find((x) => x && x.tag === 'Tag 1204');
  assert.strictEqual(e.boards, null, 'boards muss null sein (Praezedenz Tag 579), ist: ' + JSON.stringify(e.boards));
  assert.deepStrictEqual(e['boards_bis_2026-09-05'], ['energy', 'it-services', 'utilities'], 'die frueher gebundenen Boards bleiben nachlesbar');
  const doc = e['entbunden_2026-09-05'];
  assert.ok(typeof doc === 'string' && /14 von 15/.test(doc) && /FTI/.test(doc) && /Kipp-Bedingung/.test(doc),
    'Begruendung muss Messung (14 von 15), FTI-Heilung und Kipp-Bedingung nennen');
  // Kein zweiter Eintrag darf denselben Vorgaenger binden (sonst greift die Ausnahme durch die Hintertuer).
  const bindend = reg.filter((x) => x && x.letztes_altes_vintage === '2026-09-01' && Array.isArray(x.boards) && x.boards.length);
  assert.strictEqual(bindend.length, 0, 'ein anderer Eintrag bindet 2026-09-01: ' + bindend.map((x) => x.tag).join(','));
});

// ── 2. Am Objekt: massstabBruchFuer sieht keine Bindung ─────────────────────
check('OBJEKT: massstabBruchFuer("2026-09-01") liefert null — kein Eintrag bindet Boards fuer diesen Vorgaenger', () => {
  assert.strictEqual(W.massstabBruchFuer('2026-09-01'), null);
});

// ── 3. Am Gate: ohne Bindung kein Integritaets-Vorrang; mit Bindung weiterhin ─
check('GATE: ohne bindenden Eintrag laeuft integritaetsVerfall NICHT (verfallsZeilen leer, datenSchub false, kein suspect)', () => {
  const l = lage();
  const g = W.evaluateGate(l.nachher, l.vorher, GATE_BODEN, null, BOARD);
  assert.strictEqual(g.datenSchub, false);
  assert.strictEqual(g.verfallsZeilen.length, 0, 'Verfall wurde gescannt, obwohl nichts bindet');
  assert.ok(!g.reasons.some((r) => /integritaets-verfall/.test(r)), 'Grund integritaets-verfall ohne Bindung: ' + g.reasons.join(','));
  assert.ok(!g.suspect, 'ruhige Nacht ohne Bindung darf nicht suspect sein: ' + g.reasons.join(','));
});

check('GEGENPROBE: derselbe Lampenverlust MIT bindendem daten-schub-Eintrag bleibt SUSPECT (WB-4 unveraendert im Code)', () => {
  const l = lage();
  const g = W.evaluateGate(l.nachher, l.vorher, GATE_BODEN, GEBUNDEN, BOARD);
  assert.strictEqual(g.datenSchub, true);
  assert.strictEqual(g.verfallsZeilen.length, 1);
  assert.ok(g.reasons.includes('integritaets-verfall:1'), 'Grund: ' + g.reasons.join(','));
  assert.ok(g.suspect);
});

if (fail) { console.log('\nFAIL: wertgate-261-entbunden (' + fail + ')'); process.exit(1); }
console.log('\nOK: wertgate-261-entbunden (Entbindung #261, 2026-09-05)');

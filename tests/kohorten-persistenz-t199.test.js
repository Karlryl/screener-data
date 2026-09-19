// tests/kohorten-persistenz-t199.test.js — Waechter zur Kohorten-MITGLIEDSCHAFT (T199).
//
// HERKUNFT: T199 verlangte den Bau der Mitgliedsliste ("die Menge fehlt im Vintage").
// Die Praemisse ist FALSCH: scripts/write-board-history.js schreibt die Menge seit
// 1322c80804 (13.07.2026) als cohort.profitable/cohort.unprofitable, und sie deckt sich
// in ALLEN committeten Vintages exakt mit cohortCount (Messung 19.09.2026, unabhaengig
// nachgezaehlt: 420 Board-Dateien, 229.875 Mitgliederzeilen). Gebaut wird darum nicht die
// Liste, sondern ihr fehlender Waechter — genau der, den das Design-Memo (Falle 1) als
// "trivial und zwingend" benannte und den niemand gesetzt hat.
//
// Gepinnt wird die SACHE (die Mitgliedschaft ist aufloesbar), nicht ein Textmuster:
//   (a) Writer-Ebene: buildBoardVintage gibt JE TRACK exakt die Eingabemenge zurueck
//       (kein Top-N-Deckel) und cohortCount zaehlt je Track dieselbe Liste.
//   (b) Archiv-Ebene: dieselbe Identitaet ueber JEDE committete Vintage-Datei, plus
//       nicht-leerer, je Sektor eindeutiger Ticker in jeder Zeile.
//
// GRENZE, ausdruecklich (Codex-Gegenreview 19.09.): Zeilenzahl === Zaehler beweist keine
// historische TREUE. Wuerden Liste UND Zaehler gemeinsam gekuerzt oder ein Ticker ersetzt,
// bliebe dieser Test gruen — dagegen schuetzt die Git-Historie der Vintages, nicht ein Test.
// Ebenso ungeprueft bleibt hier der Serialisierungs-Pfad (scripts/write-board-history.js
// :1495); den deckt tests/board-history.test.js ab.
// Run: node tests/kohorten-persistenz-t199.test.js
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const W = require('../scripts/write-board-history.js');

// Sidecars im Vintage-Ordner, die KEIN Board sind. Abschliessende Liste: alles andere
// MUSS eine vollstaendige Kohorte tragen. (Frueher wurde "kein cohortCount" als Sidecar
// gelesen — damit machte genau der Schaden, den dieser Test sucht, die Datei unsichtbar.)
const SIDECARS = new Set(['calibration.json', 'regime.json']);
// Bekannter Bestand am 19.09.2026. Boeden, keine Sollwerte: sie duerfen wachsen, nie fallen
// — ein verschwundener Vintage-Tag oder ein fehlendes Board faellt sonst durch "gruen mangels
// Datei" durch (reproduziert: nur EIN sichtbarer Tag liess den Test mit 14 Dateien gruen).
const MIN_TAGE = 30;
const MIN_BOARDS_JE_TAG = 14;

let fail = 0;
function check(name, fn) {
  try { fn(); console.log('  ok   ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + ': ' + (e && e.message || e)); }
}

function row(ticker, score) { return { ticker, score, runwayQuarters: null }; }
const CALIB = { formulaVersion: 'calibration/v4', generatedAt: '2026-09-19T06:00:00.000Z' };

// ── (a) Writer-Ebene ─────────────────────────────────────────────────────────
check('buildBoardVintage: je Track die volle Eingabemenge, Zaehler zaehlt dieselbe Liste', () => {
  // Bewusst 8 + 3 Zeilen: ein Top-N-Deckel (5 oder 10) wuerde hier BEISSEN. Mit 3 + 2
  // Zeilen waere derselbe Test gegen einen Deckel blind gewesen.
  const prof = ['AAA', 'BBB', 'CCC', 'DDD', 'EEE', 'FFF', 'GGG', 'HHH'];
  const unprof = ['III', 'JJJ', 'KKK'];
  const v = W.buildBoardVintage('materials', {
    profitable: prof.map((t, i) => row(t, 90 - i)),
    unprofitable: unprof.map((t, i) => row(t, 40 - i)),
  }, '2026-09-19', CALIB, null);
  assert.deepStrictEqual(v.cohort.profitable.map(r => r.ticker), prof, 'profitable-Track unvollstaendig');
  assert.deepStrictEqual(v.cohort.unprofitable.map(r => r.ticker), unprof, 'unprofitable-Track unvollstaendig');
  // Je Track, nicht nur in der Summe: gegensinnig verschobene Zaehler faellen sonst durch.
  assert.strictEqual(v.cohortCount.profitable, v.cohort.profitable.length);
  assert.strictEqual(v.cohortCount.unprofitable, v.cohort.unprofitable.length);
  assert.strictEqual(v.cohortCount.profitable, 8);
  assert.strictEqual(v.cohortCount.unprofitable, 3);
});

check('buildBoardVintage: flache Liste (survival) landet vollstaendig im profitable-Track', () => {
  const flach = ['AAA', 'BBB', 'CCC', 'DDD', 'EEE', 'FFF'];
  const v = W.buildBoardVintage('survival', flach.map(t => row(t, null)), '2026-09-19', CALIB, null);
  assert.deepStrictEqual(v.cohort.profitable.map(r => r.ticker), flach);
  assert.deepStrictEqual(v.cohort.unprofitable, []);
  assert.strictEqual(v.cohortCount.profitable, flach.length);  // nicht 0 — leere Kohorte
  assert.strictEqual(v.cohortCount.unprofitable, 0);           // waere sonst still gruen
});

// ── (b) Archiv-Ebene ─────────────────────────────────────────────────────────
check('Archiv: in JEDEM Vintage deckt sich die Mitgliedsliste je Track mit cohortCount', () => {
  const root = path.join(__dirname, '..', 'board-history');
  assert.ok(fs.existsSync(root), 'board-history/ fehlt');
  let geprueft = 0;
  let tage = 0;
  for (const tag of fs.readdirSync(root)) {
    const dir = path.join(root, tag);
    if (!fs.statSync(dir).isDirectory()) continue;
    tage++;
    let boards = 0;
    for (const datei of fs.readdirSync(dir)) {
      if (!datei.endsWith('.json') || SIDECARS.has(datei)) continue;
      const wo = tag + '/' + datei;
      const v = JSON.parse(fs.readFileSync(path.join(dir, datei), 'utf8'));
      assert.ok(v && typeof v === 'object', 'leeres Vintage-Objekt: ' + wo);
      assert.ok(v.cohortCount && Number.isFinite(v.cohortCount.profitable)
        && Number.isFinite(v.cohortCount.unprofitable), 'ohne cohortCount: ' + wo);
      assert.ok(v.cohort && Array.isArray(v.cohort.profitable) && Array.isArray(v.cohort.unprofitable),
        'ohne Mitgliedsliste: ' + wo);
      assert.strictEqual(v.cohort.profitable.length, v.cohortCount.profitable, 'profitable-Zahl != Liste in ' + wo);
      assert.strictEqual(v.cohort.unprofitable.length, v.cohortCount.unprofitable, 'unprofitable-Zahl != Liste in ' + wo);
      const tickers = new Set();
      for (const r of v.cohort.profitable.concat(v.cohort.unprofitable)) {
        assert.ok(r && typeof r.ticker === 'string' && r.ticker.trim().length > 0, 'unbenannte Zeile in ' + wo);
        assert.ok(!tickers.has(r.ticker), 'doppelter Ticker ' + r.ticker + ' in ' + wo);
        tickers.add(r.ticker);
      }
      boards++; geprueft++;
    }
    assert.ok(boards >= MIN_BOARDS_JE_TAG, tag + ' traegt nur ' + boards + ' Boards (Boden ' + MIN_BOARDS_JE_TAG + ')');
  }
  assert.ok(tage >= MIN_TAGE, 'nur ' + tage + ' Vintage-Tage sichtbar (Boden ' + MIN_TAGE + ')');
  console.log('       geprueft: ' + geprueft + ' Board-Dateien in ' + tage + ' Vintage-Tagen');
});

console.log(fail === 0 ? 'kohorten-persistenz-t199: alle Checks gruen' : 'kohorten-persistenz-t199: ' + fail + ' FAIL');
process.exit(fail === 0 ? 0 : 1);

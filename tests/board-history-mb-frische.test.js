// tests/board-history-mb-frische.test.js — Standalone-Runner (assert + process.exit).
//
// Waechter fuer M-B Stufe 1 (Beschluss Quartalsreihen 16.08.2026, Punkt 3):
// Frische-Kennzeichnung der Quartalsreihe + Zaehlung, mit NULL RANG-WIRKUNG.
//
// (a) Grenze ist RETENTION_DAYS — und zwar DIESELBE Konstante, nicht dieselbe Zahl
// (b) drei Ausgaenge: veraltet / frisch / keine datierte Reihe (null ist KEINE Leiche)
// (c) die Zaehlung trennt Quartalspflicht-Maerkte von den uebrigen
// (d) RANG-NEUTRALITAET, bewiesen statt behauptet: zwei Laeufe, die sich AUSSCHLIESSLICH
//     im Alter der Perioden-Enden unterscheiden, liefern byte-identische Rang-, Score-,
//     Achsen- und Lampen-Felder. Nur das neue Feld und der Zaehlblock duerfen abweichen.
//
// Run: node tests/board-history-mb-frische.test.js
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const W = require('../scripts/write-board-history.js');

let fail = 0;
function check(name, fn) {
  try { fn(); console.log('  ok   ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + ': ' + (e && e.message || e)); }
}

const TAG = 86400000;
const VINTAGE = '2026-08-16';
const minusTage = (n) => new Date(Date.parse(VINTAGE + 'T00:00:00Z') - n * TAG).toISOString().slice(0, 10);

function mkBase() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'mb-frische-'));
  fs.mkdirSync(path.join(base, 'snapshots'), { recursive: true });
  return base;
}
function snapMit(ticker, enden) {
  return {
    meta: { ticker },
    metrics: { beta: { value: 1.1 }, enterpriseToRevenue: { value: 5 }, priceSales: { value: 4 }, grossMargin: { value: 40 } },
    timeseries: {
      revenueQ: [{ value: 120 }, { value: 110 }, { value: 100 }],
      ...(enden ? { revenueQEnds: enden } : {}),
    },
  };
}
function boardRow(ticker, score) {
  return {
    ticker, score, track: 'profitable', scoreBase: score - 1, scoreShrunk: score - 0.5,
    coverageAxes: '7/7', lamps: ['unprofit'],
    axisBreakdown: [{ key: 'revGrowthLevel', pct: 80, weight: 1.7 }],
  };
}
// Baut ein Vintage aus (ticker -> juengstes Ende in Tagen vor dem Vintage | null).
function vintageMit(alterJeTicker) {
  const base = mkBase();
  const rows = [];
  let score = 90;
  for (const [ticker, alter] of alterJeTicker) {
    const enden = alter === null ? null : [minusTage(alter), minusTage(alter + 91), minusTage(alter + 183)];
    fs.writeFileSync(path.join(base, 'snapshots', ticker.replace(/[^A-Za-z0-9.\-_]/g, '_') + '.json'),
      JSON.stringify(snapMit(ticker, enden)));
    rows.push(boardRow(ticker, score));
    score -= 1;
  }
  W._setPaths(base);
  try {
    return W.buildBoardVintage('semiconductors', { profitable: rows, unprofitable: [] }, VINTAGE,
      { formulaVersion: 'calibration/v4', generatedAt: VINTAGE });
  } finally { W._setPaths(null); }
}
const zeile = (v, ticker) => v.cohort.profitable.find((r) => r.ticker === ticker);

// ── (a) + (b) Grenze und drei Ausgaenge ──────────────────────────────────────

check('(a) die Grenze IST RETENTION_DAYS, nicht nur zufaellig 180', () => {
  assert.strictEqual(W._const.RETENTION_DAYS, 180, 'Bestandskonstante unveraendert');
  const v = vintageMit([['AAA', 180], ['BBB', 181]]);
  assert.strictEqual(v.quartalsreiheFrische.grenzeTage, W._const.RETENTION_DAYS,
    'der Zaehlblock muss die Konstante ausweisen, damit ein Verstellen sichtbar wird');
  assert.strictEqual(zeile(v, 'AAA').quartalsreiheVeraltet, false, 'exakt an der Grenze = noch frisch');
  assert.strictEqual(zeile(v, 'BBB').quartalsreiheVeraltet, true, 'einen Tag darueber = veraltet');
});

check('(b) keine datierte Reihe ist NICHT "veraltet", sondern null', () => {
  const v = vintageMit([['HALB.L', null]]);
  assert.strictEqual(zeile(v, 'HALB.L').quartalsreiheVeraltet, null,
    'ein Halbjahresberichter ohne Quartalsreihe darf nicht als Leiche gezaehlt werden');
  assert.strictEqual(v.quartalsreiheFrische.ohneDatierteReihe, 1);
  assert.strictEqual(v.quartalsreiheFrische.veraltet, 0);
});

// ── (c) die Trennung, wegen der M-B Stufe 1 ueberhaupt mitfaehrt ─────────────

check('(c) Zaehlung trennt Quartalspflicht-Maerkte von den uebrigen', () => {
  const v = vintageMit([
    ['2548.TW', 400], ['7203.T', 400], ['600000.SS', 400],   // Quartalspflicht -> Abruf-Verdacht
    ['FAST.AS', 400], ['1530.HK', 4900],                     // uebrige -> Leichen-Verdacht
    ['CRDO', 100],                                           // frisch
    ['NOEND.L', null],                                       // keine datierte Reihe
  ]);
  const z = v.quartalsreiheFrische;
  assert.strictEqual(z.veraltet, 5);
  assert.strictEqual(z.veraltetQuartalspflichtMarkt, 3, '.TW/.T/.SS gehoeren in den Abruf-Verdacht');
  assert.strictEqual(z.veraltetSonstigeMaerkte, 2, '.AS/.HK gehoeren in den Leichen-Verdacht');
  assert.strictEqual(z.frisch, 1);
  assert.strictEqual(z.ohneDatierteReihe, 1);
  assert.strictEqual(z.veraltet + z.frisch + z.ohneDatierteReihe, v.cohort.profitable.length,
    'die Zaehlung muss die Kohorte vollstaendig aufteilen — keine Zeile faellt unter den Tisch');
});

// ── (d) NULL RANG-WIRKUNG, bewiesen ──────────────────────────────────────────

check('(d) Alter der Reihe aendert KEIN Rang-, Score-, Achsen- oder Lampen-Feld', () => {
  const frisch = vintageMit([['AAA', 10], ['BBB', 20], ['CCC', 30]]);
  const alt = vintageMit([['AAA', 4000], ['BBB', 4000], ['CCC', 4000]]);
  const RANGFELDER = ['rank', 'ticker', 'track', 'score', 'runwayQuarters', 'scoreBase',
    'scoreShrunk', 'coverageAxes', 'axisBreakdown', 'lamps'];
  assert.strictEqual(frisch.cohort.profitable.length, alt.cohort.profitable.length);
  for (let i = 0; i < frisch.cohort.profitable.length; i++) {
    const a = frisch.cohort.profitable[i], b = alt.cohort.profitable[i];
    for (const f of RANGFELDER) {
      assert.deepStrictEqual(b[f], a[f], `Feld ${f} von ${a.ticker} haengt am Reihen-Alter — das waere Rang-Wirkung`);
    }
  }
  // Gegenprobe, damit (d) nicht deshalb gruen ist, weil gar nichts passiert ist:
  assert.strictEqual(frisch.quartalsreiheFrische.veraltet, 0);
  assert.strictEqual(alt.quartalsreiheFrische.veraltet, 3, 'der Lauf MUSS sich im neuen Feld unterscheiden');
});

console.log(fail ? `\n${fail} FAILED` : '\nalle gruen');
process.exit(fail ? 1 : 0);

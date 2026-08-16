'use strict';
/**
 * Waechter: die Einmalertrags-Lampe ist FOLGENREICH (Urteil 16.08.2026, F-16-Einzelfreigabe).
 *
 * Die Lampe markierte bis heute nur. Zealand Pharma stand mit 5 / 10 / 8 / 1.382 Mio.
 * Quartalsumsatz - einem einzigen Lizenzertrag - auf Rang 1 des health-care-Boards, mit
 * Lampe UND mit sieben vollen Achsen. Das Urteil verdrahtet die Lampe: brennt sie, sind die
 * fuenf Achsen, die der Sprung nachweislich traegt, fuer diese Zeile NICHT BEWERTBAR und
 * werden gedroppt. Renorm-on-drop und die bestehende C4-Coverage-Shrinkage erledigen den
 * Rest - kein neuer Schwellwert, keine neue Konstante ausser der Achsenliste selbst.
 *
 * DIESER TEST NAGELT DIE SACHE FEST, NICHT DAS SCHREIBMUSTER:
 *   W-A  brennt die Lampe -> genau die fuenf Achsen null, marginTrajectory + dilution
 *        present, coverageWeight < 1 -- UND die Ergebnis-Klammer: dieselbe Zeile mit
 *        gleicher Jahressumme, gleichverteilt, traegt keine Lampe, hat 7/7 und liegt mehr
 *        als 25 Punkte HOEHER. Die Differenz-Assertion ueberlebt jeden spaeteren Umbau des
 *        Daempfungsmechanismus - nur ein Ausbau des Schutzes reisst sie.
 *   W-B  brennt sie nicht (Anlauf-Formen ONDS und NUVB) -> alle Achsen present,
 *        coverageWeight === 1. Das ist der Waechter ueber den Anlauf-Schutz: verschwindet
 *        er still, feuert die Verdrahtung auf echte Wachstumsfirmen und dieser Test wird rot.
 *   W-C  Anker am echten Board: jede Lampen-Zeile hat die fuenf Achsen null und
 *        coverageWeight < 1, und keine Lampen-Zeile steht auf Rang 1 eines Boards.
 *
 * BEWUSST KEINE RANG-QUOTEN als Assertion (Zaehler der Art "hoechstens X % Bewegung"): die
 * sind pull-abhaengig und braechen bei legitimen Datenaenderungen - ein falsch-rotes Gate.
 *
 * AUSBAU-PROBE (durchgefuehrt, Urteil Abschnitt 3): Verdrahtung auskommentiert -> W-A UND
 * W-C rot. Wird nur einer rot, nagelt der Test das Schreibmuster statt der Sache.
 *
 * Usage:  node tests/scoring/einmalertrag-konsequenz.test.js   (Exit 0/1)
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { scoreUniverse, produceRankings } = require('../../src/scoring/score.js');
const { evaluateLamps } = require('../../src/scoring/lamps.js');
const formulas = require('../../src/scoring/formulas/index.js');

let pass = 0, fail = 0, skip = 0;
// Rumpf-Skip-Ehrlichkeit (R2.R): ein Test, der erst im Rumpf merkt, dass seine Voraussetzung
// fehlt, darf NICHT als pass zaehlen - sonst meldet das Gate gruen, ohne geprueft zu haben.
const SKIP = Symbol('skip-body');
function skipBody(grund) { const e = new Error(grund); e[SKIP] = true; throw e; }
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) {
    if (e && e[SKIP]) { skip++; console.log('  skip ' + name + ' (' + e.message + ')'); return; }
    fail++; console.error('FAIL   ' + name + '\n       ' + e.message);
  }
}

// Die fuenf Achsen, die der Sprung traegt. Bewusst hier WOERTLICH wiederholt statt aus
// score.js importiert: ein Waechter, der seine Erwartung aus dem Pruefling bezieht, kann
// nicht mehr rot werden, wenn der Pruefling die Liste leert.
const FUENF = ['revGrowthLevel', 'revAcceleration', 'gpGrowth', 'ruleOfX', 'capitalEfficiency'];

// ── synthetische Kohorte ────────────────────────────────────────────────────────────────
// health-care traegt genau die sieben Achsen des Urteils. k in [0,1] ist ein Qualitaets-
// Regler ueber Marge, Kapitalrendite und SBC-Last - er erzeugt Streuung ueber ALLE Achsen,
// damit die Perzentile nicht auf 50 kollabieren und die Kohorte >= MIN_COHORT_N bleibt.
const V = (a) => a.map((v) => ({ value: v }));
const ENDS = ['2026-03-31', '2025-12-31', '2025-09-30', '2025-06-30', '2025-03-31'];
const MIO = 1e6;
function mk(ticker, q, k) {
  const jahr = q.slice(0, 4).reduce((a, b) => a + b, 0);
  const marge = 0.30 + 0.55 * k;
  const w = 1.35 + 0.9 * k;
  return {
    meta: { name: ticker + ' Bio', sector: 'Healthcare', industry: 'Biotechnology', region: 'US',
      ticker, exchangeName: 'NasdaqGS', tradingCurrency: 'USD' },
    marketCap: { value: 3e9 },
    metrics: { revenueTTM: { value: jahr } },
    annual: {
      annualRev: V([jahr, jahr / w, jahr / w ** 2, jahr / w ** 3]),
      annualGP: V([jahr * marge, jahr / w * (marge - 0.05), jahr / w ** 2 * (marge - 0.09), jahr / w ** 3 * (marge - 0.12)]),
      annualOpInc: V([jahr * (marge - 0.35), jahr / w * (marge - 0.42), jahr / w ** 2 * (marge - 0.5), jahr / w ** 3 * (marge - 0.58)]),
      annualShares: V([100e6, 100e6 - k * 4e6, 96e6 - k * 6e6, 90e6 - k * 8e6]),
      annualSBC: [jahr * (0.16 - 0.13 * k), jahr * (0.17 - 0.13 * k), jahr * (0.18 - 0.13 * k), jahr * (0.19 - 0.13 * k)],
      annualBalance: [0, 1, 2, 3].map((i) => ({
        totalAssets: jahr * (2.2 + i * 0.35) * (1.6 - 0.8 * k),
        currentLiabilities: jahr * (0.55 + i * 0.05),
      })),
    },
    timeseries: {
      revenueQ: V(q), revenueQEnds: ENDS.slice(0, q.length),
      grossProfitQ: V(q.map((v) => v * marge)), grossProfitQEnds: ENDS.slice(0, q.length),
      opIncQ: V(q.map((v) => v * marge - jahr * 0.1)),
    },
  };
}
// 90-Tage-Raster (ENDS) - ohne saubere Kadenz waere die Lampe null statt true.
const ZEAL = [5.2, 10.5, 7.5, 1382.4, 1.2].map((v) => v * MIO);
const JAHRESSUMME = ZEAL.slice(0, 4).reduce((a, b) => a + b, 0);   // 1.405,6 Mio.
// Gleiche Jahressumme, gleichverteilt (4 x ~351,4). Das VORJAHRESQUARTAL (Index 4) bleibt
// unveraendert - sonst waere der Zwilling nicht "dieselbe Zeile ohne Sprung", sondern eine
// ohne Wachstum, und die Klammer maesse den falschen Unterschied.
const GLEICH = [JAHRESSUMME / 4, JAHRESSUMME / 4, JAHRESSUMME / 4, JAHRESSUMME / 4, ZEAL[4]];
// Anlauf-Formen aus dem Urteil, newest-first (die Reihe liegt so im Snapshot):
// ONDS 4,2 -> 6,3 -> 10,1 -> 30,1 -> 50,1 und NUVB 3,1 -> 4,8 -> 13,1 -> 41,9 -> 83,2.
const ONDS = [50.1, 30.1, 10.1, 6.3, 4.2].map((v) => v * MIO);
const NUVB = [83.2, 41.9, 13.1, 4.8, 3.1].map((v) => v * MIO);

function baueKohorte() {
  const u = [mk('TSTZEAL', ZEAL, 0.9), mk('TSTGLEICH', GLEICH, 0.9), mk('TSTONDS', ONDS, 0.9), mk('TSTNUVB', NUVB, 0.9)];
  for (let i = 0; i < 18; i++) {
    const b = (20 + i * 31) * MIO;
    const g = 1.02 + (i % 6) * 0.05;
    u.push(mk('FILL' + i, [b * g ** 3, b * g ** 2, b * g, b, b / (1 + (i % 5) * 0.12)], (i % 9) / 8));
  }
  return u;
}
const kohorte = baueKohorte();
const gescort = Object.fromEntries(scoreUniverse(kohorte, formulas).map((e) => [e.ticker, e]));
const achse = (e, key) => (e._axes || []).find((a) => a.key === key);

// ── W-A: Anwesenheit ────────────────────────────────────────────────────────────────────
test('W-A: brennende Lampe -> genau die fuenf Achsen sind nicht bewertbar', () => {
  const z = gescort['TSTZEAL'];
  assert.ok(evaluateLamps(kohorte[0]).active.includes('einmalertrag'), 'Fixture traegt die Lampe nicht mehr - Fixture pruefen, nicht den Test aufweichen');
  assert.equal(z.action, 'route', 'die Zeile muss geroutet bleiben: gedaempft, nicht ausgeschlossen');
  assert.equal(z.cohortN >= 15, true, 'Kohorte unter MIN_COHORT_N - die Eltern-Basis wuerde messen, nicht die eigene');
  for (const k of FUENF) {
    const a = achse(z, k);
    assert.ok(a, `Achse ${k} fehlt in der Formel - Fixture passt nicht mehr zu health-care`);
    assert.equal(a.pct, null, `Achse ${k} traegt trotz Lampe einen Perzentilwert (${a.pct})`);
  }
  for (const k of ['marginTrajectory', 'dilution']) {
    const a = achse(z, k);
    assert.ok(a && a.pct !== null, `Achse ${k} darf NICHT gedroppt werden - der Sprung bewegt sie nicht`);
  }
  assert.ok(z.coverageWeight < 1, `coverageWeight muss < 1 sein (ist ${z.coverageWeight}) - sonst greift die C4-Shrinkage nicht`);
});

test('W-A Ergebnis-Klammer: der gleichverteilte Zwilling liegt mehr als 25 Punkte hoeher', () => {
  const z = gescort['TSTZEAL'], g = gescort['TSTGLEICH'];
  assert.ok(!evaluateLamps(kohorte[1]).active.includes('einmalertrag'), 'der Zwilling darf keine Lampe tragen');
  assert.equal(g.coverageWeight, 1, 'der Zwilling muss 7/7 Achsen haben');
  assert.equal(g.coverageAxes, '7/7');
  const diff = g.score - z.score;
  assert.ok(diff > 25,
    `gleiche Jahressumme, nur anders verteilt: der saubere Zwilling muss >25 Punkte ueber der `
    + `Sprung-Zeile liegen, liegt aber nur ${diff.toFixed(2)} darueber `
    + `(Sprung ${z.score.toFixed(2)} / gleichverteilt ${g.score.toFixed(2)})`);
});

// ── W-B: Abwesenheit (Waechter ueber den Anlauf-Schutz) ─────────────────────────────────
for (const [name, idx] of [['ONDS', 2], ['NUVB', 3]]) {
  test(`W-B: ${name}-Anlaufform behaelt alle Achsen (Anlauf-Schutz)`, () => {
    const e = gescort['TST' + name];
    assert.ok(!evaluateLamps(kohorte[idx]).active.includes('einmalertrag'),
      `${name} traegt die Lampe - der Anlauf-Schutz ist weg, die Verdrahtung trifft echtes Wachstum`);
    for (const a of e._axes) {
      assert.notEqual(a.pct, null, `Achse ${a.key} wurde bei ${name} gedroppt, obwohl keine Lampe brennt`);
    }
    assert.equal(e.coverageWeight, 1, `${name}: coverageWeight muss 1 bleiben (ist ${e.coverageWeight})`);
  });
}

// ── W-C: Anker am echten Board ──────────────────────────────────────────────────────────
// Das Board wird aus dem committeten Snapshot-Bestand NEU gerechnet (wie
// score.integration.test.js). Im pre-pull-Gate ist snapshots/ leer -> ehrlicher skip,
// lokal und nach dem Pull laeuft der Anker voll durch.
const SNAP_DIR = process.env.SCREENER_SNAPSHOTS_DIR || path.join(__dirname, '..', '..', 'snapshots');
function liveBoards() {
  if (!fs.existsSync(SNAP_DIR)) return null;
  const universe = [];
  for (const f of fs.readdirSync(SNAP_DIR).filter((x) => x.endsWith('.json'))) {
    try {
      const s = JSON.parse(fs.readFileSync(path.join(SNAP_DIR, f), 'utf8'));
      if (s && s.meta && s.meta.ticker) universe.push(s);
    } catch (_) { /* defekte/teil-Snapshots ueberspringen */ }
  }
  if (!universe.length) return null;
  return produceRankings(scoreUniverse(universe, formulas), { topN: 200 }).full;
}
const boards = liveBoards();

test('W-C: jede Lampen-Zeile im echten Board hat die fuenf Achsen gedroppt', () => {
  if (!boards) skipBody('kein Snapshot-Universum - pre-pull-Gate');
  const verletzt = [];
  let gesehen = 0;
  for (const [id, branch] of Object.entries(boards)) {
    for (const [track, liste] of Object.entries(branch)) {
      for (const row of liste) {
        if (!(row.lamps || []).includes('einmalertrag')) continue;
        gesehen++;
        const ab = row.axisBreakdown || [];
        const offen = FUENF.filter((k) => {
          const a = ab.find((x) => x.key === k);
          return a && a.pct !== null;
        });
        if (offen.length || !(row.coverageWeight < 1)) {
          verletzt.push(`${row.ticker} ${id}/${track}: offen=[${offen.join(',')}] coverageWeight=${row.coverageWeight}`);
        }
      }
    }
  }
  if (!gesehen) skipBody('keine Lampen-Zeile im Universum');
  assert.equal(verletzt.length, 0,
    `${verletzt.length} von ${gesehen} Lampen-Zeilen sind nicht gedaempft:\n       ` + verletzt.slice(0, 10).join('\n       '));
});

test('W-C: keine Lampen-Zeile steht auf Rang 1 eines echten Boards', () => {
  if (!boards) skipBody('kein Snapshot-Universum - pre-pull-Gate');
  const spitze = [];
  for (const [id, branch] of Object.entries(boards)) {
    for (const [track, liste] of Object.entries(branch)) {
      const erste = liste[0];
      if (!erste || !(erste.lamps || []).includes('einmalertrag')) continue;
      // Duenne Kohorte (cohortFallback === die Engine-eigene Entscheidung n < MIN_COHORT_N,
      // nicht hier nachgebaut): dort ist "Rang 1" keine Aussage. Die Daempfung zieht die
      // Zeile zum KOHORTEN-MEDIAN, und in einer Drei-Namen-Kohorte IST der Median oben —
      // utilities/unprofitable n=3: NRGV faellt 73,2 -> 49,2 und steht danach immer noch
      // vorn. Sie darunter zu druecken ginge nur mit einer Nur-nach-unten-Shrinkage, und
      // die hat dasselbe Urteil ausdruecklich verboten. Der Waechter prueft deshalb die
      // Boards, in denen ein Rang etwas heisst; die Daempfung selbst prueft der Test darueber
      // fuer JEDE Lampen-Zeile, auch die in duennen Kohorten.
      if (erste.cohortFallback === true) continue;
      spitze.push(`${erste.ticker} ${id}/${track} score=${erste.score} n=${erste.cohortN}`);
    }
  }
  assert.equal(spitze.length, 0, 'Lampen-Zeile(n) auf Rang 1: ' + spitze.join(' | '));
});

console.log(`\neinmalertrag-konsequenz: ${pass} ok, ${fail} fail, ${skip} skip`);
process.exit(fail ? 1 : 0);

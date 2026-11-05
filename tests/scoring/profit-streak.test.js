'use strict';
/**
 * Waechter fuer die belegte Gewinn-Serienlaenge (Task 4.5, Teil 1).
 *
 * Usage:  node tests/scoring/profit-streak.test.js   (Exit 0/1)
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const S = require('../../src/scoring/profit-streak.js');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); }
}

const wert = (v) => ({ value: v });
const reihe = (arr) => arr.map(wert);

test('zaehlt ab dem juengsten Jahr, nicht ab dem aeltesten', () => {
  // _fys ist absteigend: [2025, 2024, 2023, 2022]. Der Verlust liegt 2023.
  const r = S.profitStreak('X', {
    _fys: [2025, 2024, 2023, 2022],
    annualOpInc: reihe([100, 90, -5, 80]),
  });
  assert.equal(r.jahre, 2);
  assert.equal(r.letzterVerlust, 2023);
  assert.equal(r.mindestens, false);
});

test('a GAP ends the count but is no loss year', () => {
  // Ein Jahr ohne Zahl ist kein belegtes Gewinnjahr — und "belegt" ist der ganze Zweck.
  // Wuerde die Luecke uebersprungen, entstuende eine Serie, die niemand nachweisen kann.
  // F-02 (blind review 31.10.2026): the data end here, nothing proves a loss. Paycom had 15.7 M USD
  // operating income in its gap year 2014 and would have shown "Verlustjahr (2014)".
  const r = S.profitStreak('X', {
    _fys: [2025, 2024, 2023, 2022],
    annualOpInc: reihe([100, 90, null, 80]),
  });
  assert.equal(r.jahre, 2);
  assert.equal(r.mindestens, true);
  assert.equal(r.tiefe, 2, 'the series vouches only for the years up to the gap');
  assert.equal(r.letzterVerlust, null);
});

test('a gap in the newest year gives null, not "currently not profitable"', () => {
  assert.equal(S.profitStreak('X', { _fys: [2025, 2024], annualOpInc: reihe([null, 5]), annualNetIncome: reihe([null, 5]) }), null);
  assert.equal(S.profitStreak('X', { _fys: [2025], annualNetIncome: reihe([null]) }), null);
});

test('a real loss stays, behind or before a gap', () => {
  const beforeGap = S.profitStreak('X', { _fys: [2025, 2024, 2023], annualOpInc: reihe([100, -5, null]) });
  assert.deepEqual([beforeGap.jahre, beforeGap.tiefe, beforeGap.mindestens, beforeGap.letzterVerlust], [1, 3, false, 2024]);
  const behindGap = S.profitStreak('X', { _fys: [2025, 2024, 2023], annualOpInc: reihe([100, null, -5]) });
  assert.deepEqual([behindGap.jahre, behindGap.tiefe, behindGap.mindestens, behindGap.letzterVerlust], [1, 1, true, null],
    'nothing is proven beyond the gap, not even a loss');
});

test('no series of profit, loss and gap ever reports a gap as a loss', () => {
  // Exhaustive: every series of up to 5 years over {profit, loss, gap}, with the schema rules of
  // write-findash-export.js checkOptionalProfitStreak.
  const fys = [2025, 2024, 2023, 2022, 2021];
  let geprueft = 0;
  const pruefe = (werte) => {
    const r = S.profitStreak('X', { _fys: fys.slice(0, werte.length), annualOpInc: reihe(werte) });
    geprueft += 1;
    const wo = JSON.stringify(werte);
    if (werte[0] === null) { assert.equal(r, null, wo); return; }
    const ende = werte.findIndex((w) => w === null || w < 0);
    assert.equal(r.jahre, ende < 0 ? werte.length : ende, wo);
    assert.ok(r.jahre <= r.tiefe && r.tiefe >= 1, wo);
    if (r.letzterVerlust !== null) {
      assert.ok(werte[fys.indexOf(r.letzterVerlust)] < 0, 'no real loss in ' + r.letzterVerlust + ': ' + wo);
      assert.equal(r.mindestens, false, wo);
    }
    if (ende >= 0 && werte[ende] < 0) assert.equal(r.letzterVerlust, fys[ende], wo);
    else assert.equal(r.mindestens, true, wo);
    if (r.jahre === 0) assert.ok(werte[0] < 0, '"aktuell nicht" only on a real loss: ' + wo);
  };
  const baue = (praefix, n) => { if (n === 0) { if (praefix.length) pruefe(praefix); return; } for (const w of [10, -10, null]) baue([...praefix, w], n - 1); };
  for (let n = 1; n <= fys.length; n++) baue([], n);
  assert.equal(geprueft, 3 + 9 + 27 + 81 + 243);
});

test('laeuft die Serie bis zum Reihenanfang, wird das als "mindestens" markiert', () => {
  // Sonst laege die Aussage "8 Jahre" naeher als die Wahrheit "mindestens 8, die Daten
  // enden hier" — bei einer Firma mit 30 Jahren Historie ein handfester Unterschied.
  const r = S.profitStreak('X', { _fys: [2025, 2024, 2023], annualOpInc: reihe([10, 20, 30]) });
  assert.equal(r.jahre, 3);
  assert.equal(r.mindestens, true);
  assert.equal(r.letzterVerlust, null);
});

test('faellt auf das Nettoergebnis zurueck — aber nur, wenn das juengste OpInc-Jahr fehlt', () => {
  // Dieselbe Vorrangregel wie annualProfitSeries() in profit-tier.js. Waere sie anders,
  // verglichen Etikett und Serienlaenge zwei verschiedene Groessen.
  const ohneOp = S.profitStreak('X', {
    _fys: [2025, 2024], annualOpInc: reihe([null, 50]), annualNetIncome: reihe([7, 8]),
  });
  assert.equal(ohneOp.basis, 'netIncome');
  assert.equal(ohneOp.jahre, 2);

  const mitOp = S.profitStreak('X', {
    _fys: [2025, 2024], annualOpInc: reihe([5, -1]), annualNetIncome: reihe([7, 8]),
  });
  assert.equal(mitOp.basis, 'opInc', 'vorhandenes juengstes OpInc darf NICHT vom NetIncome verdraengt werden');
  assert.equal(mitOp.jahre, 1);
});

test('ein Verlust im juengsten Jahr ergibt Serie 0, nicht null', () => {
  const r = S.profitStreak('X', { _fys: [2025, 2024], annualOpInc: reihe([-3, 50]) });
  assert.equal(r.jahre, 0);
  assert.equal(r.letzterVerlust, 2025);
});

test('null bei fehlender oder leerer Reihe — nie eine erfundene Null', () => {
  assert.equal(S.profitStreak('X', null), null);
  assert.equal(S.profitStreak('X', { _fys: [], annualOpInc: [], annualNetIncome: [] }), null);
});

test('genau null ist profitabel (Grenzfall)', () => {
  const r = S.profitStreak('X', { _fys: [2025, 2024], annualOpInc: reihe([0, 5]) });
  assert.equal(r.jahre, 2);
});

test('eine kaputte Zeile in der Quelldatei kippt nicht den ganzen Lauf', () => {
  const tmp = path.join(require('os').tmpdir(), 'streak-test-' + process.pid + '.jsonl');
  fs.writeFileSync(tmp, [
    JSON.stringify({ ticker: 'AAA', annual: { _fys: [2025], annualOpInc: [{ value: 1 }] } }),
    '{ das ist kein JSON',
    '',
    JSON.stringify({ ticker: 'BBB', annual: { _fys: [2025], annualOpInc: [{ value: -1 }] } }),
  ].join('\n'));
  const m = S.ladeKarte(tmp);
  fs.unlinkSync(tmp);
  assert.equal(m.size, 2, 'beide guten Zeilen muessen ankommen');
});

test('fehlt die Quelldatei, ist das Ergebnis null — kein Absturz', () => {
  // Der Normalfall in den Fixtures und bei jedem frischen Checkout.
  assert.equal(S.ladeKarte(path.join(require('os').tmpdir(), 'gibt-es-nicht-' + process.pid)).size, 0);
});

test('das Etikett profitTier wird NICHT angefasst', () => {
  // Bewusste Grenze: die Quellenfrage (Yahoo widerspricht der SEC bei 10,3 % im Vorzeichen)
  // liegt bei Rat und Gericht. Bis dahin wird die Zahl ausgewiesen, nicht verrechnet.
  // Wer das aendert, muss diesen Waechter bewusst anfassen.
  const tier = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'scoring', 'profit-tier.js'), 'utf8');
  assert.ok(!/profit-streak/.test(tier), 'profit-tier.js darf die Langhistorie (noch) nicht lesen');
});

test('am ECHTEN Datenbestand: American Airlines traegt das Etikett zu Unrecht', () => {
  // Der Ankerfall des Befunds. Laeuft nur, wenn die Langhistorie da ist (CI: ja, frischer
  // Checkout ohne external-data: uebersprungen statt rot).
  if (!fs.existsSync(S.QUELLE)) { console.log('       (uebersprungen — keine Langhistorie im Checkout)'); return; }
  const r = S.profitStreakOf('AAL');
  assert.ok(r, 'AAL fehlt in der Langhistorie');
  assert.ok(r.jahre >= 1 && r.jahre <= 6,
    'AAL sollte eine kurze Serie haben (COVID-Verluste 2020/21), gemessen: ' + r.jahre);
  assert.equal(r.mindestens, false, 'bei AAL muss ein Verlustjahr in Sicht sein');
});

test('on the REAL long history: every letzterVerlust year carries a real negative value', () => {
  if (!fs.existsSync(S.QUELLE)) { console.log('       (skipped, no long history in this checkout)'); return; }
  let verluste = 0, luecken = 0;
  for (const [t, annual] of S.ladeKarte()) {
    const r = S.profitStreak(t, annual);
    if (!r) continue;
    const zeile = (r.basis === 'opInc' ? annual.annualOpInc : annual.annualNetIncome)[r.jahre];
    if (r.mindestens && zeile && zeile.value == null) luecken += 1;
    if (r.letzterVerlust === null) continue;
    const korrektur = (r.financialCorrections || []).find((c) => c.fiscalYear === r.letzterVerlust);
    const wert = korrektur ? korrektur.value : (r.basis === 'opInc' ? annual.annualOpInc : annual.annualNetIncome)[annual._fys.indexOf(r.letzterVerlust)].value;
    assert.ok(wert < 0, t + ': letzterVerlust ' + r.letzterVerlust + ' carries ' + wert);
    verluste += 1;
  }
  assert.ok(verluste > 500, 'too few loss years checked: ' + verluste);
  assert.ok(luecken > 0, 'the long history holds series ending at a gap; this check must see them');
});

console.log('\nprofit-streak.test.js: ' + pass + ' ok, ' + fail + ' fail');
process.exit(fail ? 1 : 0);

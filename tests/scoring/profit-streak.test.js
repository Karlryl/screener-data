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

test('eine LUECKE beendet die Serie genauso wie ein Verlust', () => {
  // Ein Jahr ohne Zahl ist kein belegtes Gewinnjahr — und "belegt" ist der ganze Zweck.
  // Wuerde die Luecke uebersprungen, entstuende eine Serie, die niemand nachweisen kann.
  const r = S.profitStreak('X', {
    _fys: [2025, 2024, 2023, 2022],
    annualOpInc: reihe([100, 90, null, 80]),
  });
  assert.equal(r.jahre, 2);
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

console.log('\nprofit-streak.test.js: ' + pass + ' ok, ' + fail + ' fail');
process.exit(fail ? 1 : 0);

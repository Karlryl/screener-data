'use strict';
/**
 * t168-rev-priority.test.js — Regressionsanker zum T168-Prioritaets-Dreh.
 *
 * Befund (ENTSCHIED 13, 29.08.2026): REV_CONCEPTS priorisierte
 * 'RevenueFromContractWithCustomerIncludingAssessedTax' VOR 'Revenues'. Die Annahme
 * dahinter ("gleiche Groesse, andere Steuer-Behandlung") haelt nur fuer Filer, die NUR
 * das Including-Tag fuehren. Fuehrt ein Filer BEIDE, ist Including haeufig eine kleinere
 * TEILGROESSE — und die bestehende Faktor-2-Wache in annualRevUnion() sieht Abweichungen
 * von 1,04x bis 2,0x nicht. Fix: 'Revenues' rueckt eine Stufe hoch.
 *
 * Diese Datei nagelt BEIDE Richtungen fest:
 *   (1) der Dreh greift, wo beide Tags dasselbe fy tragen  -> Revenues gewinnt
 *   (2) der Fallback bleibt, wo NUR Including existiert    -> Including gewinnt weiter
 * und dazu die zwei Haertungen, die der Dreh nicht kaputtmachen darf (AAR, ARGX).
 *
 * Alle Zahlen sind an echten companyfacts gemessen (data.sec.gov, 29.08.2026), nicht
 * erfunden — Belege in agent-reports/diagnose-t168-ratioscan-2026-08-29.md und im
 * Schicht-Diff unter reports/.
 *
 * Usage: node tests/t168-rev-priority.test.js   (Exit 0/1)
 */
const assert = require('node:assert/strict');
const {
  annualRevUnion, extractSecSeries, TAXONOMIEN,
} = require('../merge-sec-xbrl.js');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); }
}

// Gleiches Fixture-Muster wie tests/g-sec-union-test.js.
function gaapFixture(rows) {
  const gaap = {};
  for (const [concept, facts] of Object.entries(rows)) {
    gaap[concept] = { units: { USD: facts.map((f) => Object.assign({ form: '10-K', fp: 'FY' }, f)) } };
  }
  return gaap;
}
function stumm(fn) {
  const orig = console.warn;
  const lines = [];
  console.warn = (...a) => lines.push(a.join(' '));
  try { fn(); } finally { console.warn = orig; }
  return lines;
}
const INCL = 'RevenueFromContractWithCustomerIncludingAssessedTax';
const EXCL = 'RevenueFromContractWithCustomerExcludingAssessedTax';

// ── Die Reihenfolge selbst ────────────────────────────────────────────────────
// Ein Wachhund am OBJEKT, nicht an einem Textmuster: waere die Liste je wieder
// umsortiert (oder 'Revenues' entfernt), faellt dieser Test, nicht erst der Schicht-Diff.
test('REV_CONCEPTS: Revenues steht VOR IncludingAssessedTax, Excluding bleibt erster', () => {
  const l = TAXONOMIEN['us-gaap'].rev;
  assert.ok(l.indexOf('Revenues') > -1, 'Revenues fehlt ganz in REV_CONCEPTS');
  assert.ok(l.indexOf(INCL) > -1, 'IncludingAssessedTax darf NICHT entfernt werden - es ist der Fallback der Incl-only-Filer');
  assert.ok(l.indexOf('Revenues') < l.indexOf(INCL),
    'T168: Revenues muss vor IncludingAssessedTax stehen, tatsaechlich: ' + JSON.stringify(l));
  assert.equal(l[0], EXCL, 'ExcludingAssessedTax bleibt hoechste Prioritaet - T168 dreht nur die zwei dahinter');
});

test('Haertung bleibt: Umsatz-BESTANDTEILE stehen weiterhin NICHT in REV_CONCEPTS', () => {
  // Ein Filer, der Waren und Dienste getrennt ausweist, wuerde sonst still nur seinen
  // Warenanteil melden (Begruendung im Modulkopf, Beleg AAR).
  for (const c of ['SalesRevenueGoodsNet', 'SalesRevenueServicesNet']) {
    assert.ok(!TAXONOMIEN['us-gaap'].rev.includes(c), c + ' darf kein Gesamtumsatz-Konzept sein');
  }
});

// ── Richtung 1: der Dreh greift ───────────────────────────────────────────────
test('Koexistenz in der Blind-Zone (CWCO fy2023, Faktor 1,654) -> Revenues gewinnt', () => {
  const gaap = gaapFixture({
    [INCL]: [{ fy: 2023, val: 108952682, end: '2023-12-31' }],
    Revenues: [{ fy: 2023, val: 180211233, end: '2023-12-31' }],
  });
  const out = annualRevUnion(gaap, 'CWCO');
  assert.equal(out.get(2023).val, 180211233,
    'vor T168 stand hier die Teilgroesse 108.952.682 - die Faktor-2-Wache sieht 1,654 nicht');
});

test('Koexistenz knapp unter Faktor 2 (EXE fy2018, 1,972) -> Revenues gewinnt', () => {
  const gaap = gaapFixture({
    [INCL]: [{ fy: 2018, val: 5189000000, end: '2018-12-31' }],
    Revenues: [{ fy: 2018, val: 10231000000, end: '2018-12-31' }],
  });
  assert.equal(annualRevUnion(gaap, 'EXE').get(2018).val, 10231000000);
});

test('Koexistenz dicht beieinander (HE fy2025, Faktor 1,004) -> Revenues gewinnt trotzdem', () => {
  // Bewusst mitgetestet: der Ratio-Scan legte (1,0-1,05] als "harmlos" ab, die Zellen
  // bewegen sich aber. Die Regel ist "Revenues bei Koexistenz", nicht "Revenues ab
  // Schwelle X" - eine Schwelle waere die naechste blinde Zone.
  const gaap = gaapFixture({
    [INCL]: [{ fy: 2025, val: 3075344000, end: '2025-12-31' }],
    Revenues: [{ fy: 2025, val: 3086896000, end: '2025-12-31' }],
  });
  assert.equal(annualRevUnion(gaap, 'HE').get(2025).val, 3086896000);
});

test('ExcludingAssessedTax schlaegt weiterhin BEIDE (Prioritaet 1 unangetastet)', () => {
  const gaap = gaapFixture({
    [EXCL]: [{ fy: 2024, val: 1000000000, end: '2024-12-31' }],
    Revenues: [{ fy: 2024, val: 1020000000, end: '2024-12-31' }],
    [INCL]: [{ fy: 2024, val: 1010000000, end: '2024-12-31' }],
  });
  assert.equal(annualRevUnion(gaap, 'PRIO1').get(2024).val, 1000000000);
});

// ── Richtung 2: der Fallback bleibt ───────────────────────────────────────────
test('AAR-Klasse: Filer OHNE Revenues behaelt alle Including-Jahre (Fallback lebt)', () => {
  const gaap = gaapFixture({
    [INCL]: [
      { fy: 2025, val: 500000000, end: '2025-05-31' },
      { fy: 2024, val: 480000000, end: '2024-05-31' },
      { fy: 2023, val: 460000000, end: '2023-05-31' },
    ],
  });
  const out = annualRevUnion(gaap, 'AAR');
  assert.equal(out.size, 3, 'ein blinder Flip ohne Fallback wuerde diesem Filer alle Umsatzjahre nehmen');
  assert.equal(out.get(2025).val, 500000000);
});

// Echte Messwerte der vier Incl-only-Namen aus ENTSCHIED 13 (companyfacts 29.08.2026).
// Kein Jahr davon hat ein koexistierendes 'Revenues' -> keiner darf sich bewegen.
const INCL_ONLY = {
  CALX: { incl: [[2021, 679394000], [2020, 541239000], [2019, 424330000], [2018, 441320000]],
    revenues: [[2017, 510367000], [2016, 458787000]] },          // fruehere Jahre, KEINE Ueberschneidung
  CEVA: { incl: [[2025, 109598000], [2024, 106939000], [2023, 97419000], [2018, 77877000]],
    revenues: [[2017, 87507000], [2016, 72653000]] },
  COHU: { incl: [[2025, 452956000], [2024, 401779000], [2023, 636322000], [2018, 451768000]],
    revenues: [] },                                              // fuehrt gar kein Revenues
  LITE: { incl: [[2023, 1767000000], [2022, 1712600000], [2021, 1742800000], [2020, 1678600000]],
    revenues: [[2018, 1247700000]] },
};
test('Incl-only-Namen CALX/CEVA/COHU/LITE behalten JEDEN Wert (Regressionsanker ENTSCHIED 13)', () => {
  for (const [tk, f] of Object.entries(INCL_ONLY)) {
    const rows = { [INCL]: f.incl.map(([fy, val]) => ({ fy, val, end: fy + '-12-31' })) };
    if (f.revenues.length) rows.Revenues = f.revenues.map(([fy, val]) => ({ fy, val, end: fy + '-12-31' }));
    const out = annualRevUnion(gaapFixture(rows), tk);
    for (const [fy, val] of f.incl) {
      assert.ok(out.has(fy), `${tk} FY${fy} ist nach dem Dreh verschwunden`);
      assert.equal(out.get(fy).val, val, `${tk} FY${fy} hat den Wert gewechselt`);
    }
    for (const [fy, val] of f.revenues) assert.equal(out.get(fy).val, val, `${tk} FY${fy} (Revenues-Altjahr)`);
  }
});

test('LITE fy2019: die Faktor-2-Wache verwirft die Ueberschneidung vor UND nach dem Dreh', () => {
  // Incl 1.565,3 Mio. gegen Revenues 404,6 Mio. = Faktor 3,87. Der Dreh tauscht nur,
  // WER Gewinner und wer Verlierer der Meldung ist - verworfen wird das Jahr weiterhin.
  const gaap = gaapFixture({
    [INCL]: [{ fy: 2019, val: 1565300000, end: '2019-06-29' }],
    Revenues: [{ fy: 2019, val: 404600000, end: '2019-06-29' }],
  });
  let out;
  const warns = stumm(() => { out = annualRevUnion(gaap, 'LITE'); });
  assert.equal(out.has(2019), false, 'Faktor-2-Wache muss weiter greifen - sie ist von T168 nicht beruehrt');
  assert.ok(warns.join(' ').includes('Umsatz-Konflikt LITE FY2019'), 'Konflikt muss weiter laut sein');
});

// ── ARGX-Haertung (IFRS): vom Dreh nicht beruehrt, aber mitgeprueft ───────────
test('ARGX-Haertung: ifrs-full fuehrt NUR Revenue - Bestandteile bleiben draussen', () => {
  assert.deepEqual(TAXONOMIEN['ifrs-full'].rev, ['Revenue'],
    'RevenueFromContractsWithCustomers (Bestandteil, Faktor 35 zu niedrig) und RevenueAndOperatingIncome ' +
    '(Umsatz PLUS sonstige Ertraege) duerfen nicht daneben stehen');
});

test('ARGX-Fall end-to-end: kein Umsatzjahr aus SEC, uebrige Reihen kommen an', () => {
  const companyfacts = { facts: { 'ifrs-full': {
    RevenueFromContractsWithCustomers: { units: { USD: [{ fy: 2023, val: 35500000, end: '2023-12-31', form: '20-F', fp: 'FY' }] } },
    RevenueAndOperatingIncome: { units: { USD: [{ fy: 2023, val: 1268600000, end: '2023-12-31', form: '20-F', fp: 'FY' }] } },
    ProfitLossFromOperatingActivities: { units: { USD: [{ fy: 2023, val: -220000000, end: '2023-12-31', form: '20-F', fp: 'FY' }] } },
  } } };
  const sec = extractSecSeries(companyfacts, 'ARGX');
  assert.equal(sec.taxonomie, 'ifrs-full');
  const i = sec.annual._fys.indexOf(2023);
  assert.equal(sec.annual.annualRev[i].value, null, 'ein Bestandteil darf nie als Gesamtumsatz durchgehen');
  assert.equal(sec.annual.annualOpInc[i].value, -220000000, 'die uebrigen Reihen muessen ankommen');
});

console.log(`\nt168-rev-priority.test.js: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);

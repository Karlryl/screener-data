'use strict';
/**
 * g-sec-union-test.js — S4-SEC-001: merge-sec-xbrl.js annualRevUnion()
 *
 * Befund: REV_CONCEPTS ist eine Prioritaets-Liste; annualRevUnion() nahm bisher blind
 * den ERSTEN Treffer je Geschaeftsjahr, ohne ihn gegen niedriger priorisierte Konzepte
 * fuer dasselbe fy zu pruefen. Bei Firmen, die zwei Konzepte fuer dasselbe fy melden
 * (z.B. ein falsch getaggtes Segment neben dem echten Gesamtumsatz), kann das um
 * Groessenordnungen danebenliegen (Beleg: 58,1 Mio. statt 805,7 Mio.).
 *
 * Fix: Kandidaten je fy quervergleichen; weicht ein niedriger priorisiertes Konzept um
 * mehr als Faktor 2 ab, wird das fy verworfen (fail closed) statt geraten, fail-loud
 * geloggt (Ticker + beide Konzepte + Werte).
 *
 * Usage: node tests/g-sec-union-test.js   (Exit 0/1)
 */
const assert = require('node:assert/strict');
const { annualRevUnion, buildAnnual, extractSecSeries } = require('../merge-sec-xbrl.js');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); }
}

// Gleiches Fixture-Muster wie tests/scoring/bh-b12-sec.test.js.
function gaapFixture(rows) {
  const gaap = {};
  for (const [concept, facts] of Object.entries(rows)) {
    gaap[concept] = { units: { USD: facts.map((f) => Object.assign({ form: '10-K', fp: 'FY' }, f)) } };
  }
  return gaap;
}

// Warn-Zeilen mitschneiden statt auf stderr durchzulassen.
function captureWarnings(fn) {
  const orig = console.warn;
  const lines = [];
  console.warn = (...args) => lines.push(args.join(' '));
  try { fn(); } finally { console.warn = orig; }
  return lines;
}

test('Konflikt >Faktor 2 (Repro Befund: 58,1 Mio. vs 805,7 Mio.) -> fy verworfen, nicht die kleine Zahl', () => {
  // ExcludingAssessedTax (Prio 1) fehlt fuer FY2022 -> IncludingAssessedTax (Prio 2, 58,1 Mio.)
  // waere der bisherige "erste Treffer". Revenues (Prio 3) meldet fuer dasselbe FY 805,7 Mio.
  const gaap = gaapFixture({
    RevenueFromContractWithCustomerIncludingAssessedTax: [{ fy: 2022, val: 58100000, end: '2022-12-31' }],
    Revenues: [{ fy: 2022, val: 805700000, end: '2022-12-31' }],
  });
  let out;
  const warnings = captureWarnings(() => { out = annualRevUnion(gaap, 'TESTCO'); });
  assert.equal(out.has(2022), false, 'FY2022 muss bei >Faktor-2-Konflikt verworfen werden, nicht die 58,1-Mio-Zahl uebernehmen');
  assert.ok(warnings.some((l) => l.includes('TESTCO') && l.includes('FY2022') && l.includes('58100000') && l.includes('805700000')),
    'Konflikt-Log muss Ticker + FY + beide Werte enthalten, tatsaechlich: ' + JSON.stringify(warnings));
});

test('kein Konflikt: nur EIN Konzept meldet das fy (AAR-Corp-Fall) -> normal uebernommen', () => {
  const gaap = gaapFixture({
    RevenueFromContractWithCustomerIncludingAssessedTax: [{ fy: 2019, val: 500000000, end: '2019-05-31' }],
  });
  const out = annualRevUnion(gaap, 'AAR');
  assert.equal(out.get(2019).val, 500000000);
});

test('kein Konflikt: zwei Konzepte melden dasselbe fy nah beieinander (<Faktor 2) -> hoechste Prioritaet gewinnt', () => {
  const gaap = gaapFixture({
    RevenueFromContractWithCustomerExcludingAssessedTax: [{ fy: 2023, val: 1000000, end: '2023-12-31' }],
    Revenues: [{ fy: 2023, val: 1050000, end: '2023-12-31' }], // +5%, plausible Restatement-Differenz
  });
  const out = annualRevUnion(gaap, 'TESTCO2');
  assert.equal(out.get(2023).val, 1000000, 'bei geringer Abweichung gewinnt weiterhin das hoechst-priorisierte Konzept');
});

test('buildAnnual/extractSecSeries: verworfenes fy ergibt null-Zelle in annualRev, andere fys unberuehrt', () => {
  const gaap = gaapFixture({
    RevenueFromContractWithCustomerIncludingAssessedTax: [
      { fy: 2021, val: 700000000, end: '2021-12-31' },
      { fy: 2022, val: 58100000, end: '2022-12-31' },
    ],
    Revenues: [{ fy: 2022, val: 805700000, end: '2022-12-31' }],
    // Haelt fy2022 auf der gemeinsamen _fys-Achse (buildAnnual bildet die Union ueber ALLE Serien) -
    // sonst wuerde das verworfene annualRev-fy schlicht fehlen statt als null-Zelle sichtbar zu sein.
    OperatingIncomeLoss: [{ fy: 2022, val: 1000000, end: '2022-12-31' }],
  });
  const companyfacts = { facts: { 'us-gaap': gaap } };
  let sec;
  captureWarnings(() => { sec = extractSecSeries(companyfacts, 'TESTCO3'); });
  const idx2022 = sec.annual._fys.indexOf(2022);
  const idx2021 = sec.annual._fys.indexOf(2021);
  assert.equal(sec.annual.annualRev[idx2022].value, null, 'FY2022 (Konflikt) muss null sein');
  assert.equal(sec.annual.annualRev[idx2021].value, 700000000, 'FY2021 (kein Konflikt) bleibt unberuehrt');
});

test('ohne ticker-Argument (Rueckwaertskompatibel fuer Alt-Aufrufer) -> Log faellt auf "unknown" zurueck, wirft nicht', () => {
  const gaap = gaapFixture({
    RevenueFromContractWithCustomerIncludingAssessedTax: [{ fy: 2022, val: 58100000, end: '2022-12-31' }],
    Revenues: [{ fy: 2022, val: 805700000, end: '2022-12-31' }],
    OperatingIncomeLoss: [{ fy: 2022, val: 1000000, end: '2022-12-31' }],
  });
  let out;
  const warnings = captureWarnings(() => { out = buildAnnual(gaap, {}); }); // kein 3. Arg
  assert.equal(out.annualRev[out._fys.indexOf(2022)].value, null);
  assert.ok(warnings.some((l) => l.includes('unknown')));
});

test('Review-Fund 02.08.: eine Null gegen einen echten Umsatz ist ein Konflikt, kein Gleichstand', () => {
  // Die erste Fassung der Pruefung verlangte a > 0 UND b > 0. Meldet der hoeher priorisierte
  // Tag eine 0 und der andere den echten Umsatz, war der Faktor damit nicht berechenbar, der
  // Konflikt blieb unbemerkt und die 0 ging als Jahresumsatz in die Union — ausgerechnet der
  // schaedlichste Fall war ausgenommen. Ein Nullumsatz vergiftet jede Wachstums- und
  // Margen-Achse staerker als der Konzept-Mismatch, den die Pruefung fangen soll.
  const gaap = gaapFixture({
    RevenueFromContractWithCustomerExcludingAssessedTax: [{ fy: 2023, val: 0, end: '2023-12-31' }],
    Revenues: [{ fy: 2023, val: 805700000, end: '2023-12-31' }],
  });
  let u;
  const warns = captureWarnings(() => { u = annualRevUnion(gaap, 'NULLFALL'); });
  assert.equal(u.get(2023), undefined, 'die 0 wurde als Jahresumsatz uebernommen');
  assert.ok(warns.join(' ').includes('Umsatz-Konflikt NULLFALL FY2023'), 'kein lauter Hinweis');
});

test('Review-Fund 02.08.: entgegengesetzte Vorzeichen sind ein Konflikt, kein Faktor 1', () => {
  // Math.abs verglich -805 Mio. gegen +805 Mio. als Faktor 1 — ein Vorzeichenfehler im Tag
  // waere unbemerkt als Jahresumsatz durchgegangen.
  const gaap = gaapFixture({
    RevenueFromContractWithCustomerExcludingAssessedTax: [{ fy: 2023, val: -805700000, end: '2023-12-31' }],
    Revenues: [{ fy: 2023, val: 805700000, end: '2023-12-31' }],
  });
  let u;
  const warns = captureWarnings(() => { u = annualRevUnion(gaap, 'VORZEICHEN'); });
  assert.equal(u.get(2023), undefined, 'der negative Umsatz wurde uebernommen');
  assert.ok(warns.join(' ').includes('Umsatz-Konflikt VORZEICHEN FY2023'), 'kein lauter Hinweis');
});

console.log(`\ng-sec-union-test.js: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);

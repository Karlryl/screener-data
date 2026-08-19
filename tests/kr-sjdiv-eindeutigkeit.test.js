'use strict';
/**
 * kr-sjdiv-eindeutigkeit — Waechter fuer die sj_div-Haertung in scripts/build-krannual.js.
 *
 * DER BEFUND (19.08.2026, live an OpenDART gemessen): `account_id` ist in der Antwort von
 * fnlttSinglAcntAll NICHT eindeutig. SK Hynix FY2025 liefert 'ifrs-full_Equity' NEUN Mal und
 * 'ifrs-full_ProfitLoss' ebenfalls neun Mal — je einmal aus der Bilanz (sj_div=BS) bzw. der
 * Gesamtergebnisrechnung (CIS), die uebrigen acht aus dem Eigenkapitalspiegel (SCE) mit voellig
 * anderen Werten. Der alte Zugriff `list.find(x => x.account_id === id)` traf den richtigen Wert
 * nur deshalb, weil BS und CIS in der Antwort VOR SCE stehen — eine Reihenfolge, die OpenDART
 * nirgends zusichert. Mit der Ausweitung auf Bilanzsumme/Eigenkapital/Nettoergebnis waere das
 * genau die stille Datenkorruption, die sonst kein Test faengt.
 *
 * DIESER WAECHTER NAGELT DIE SACHE FEST, NICHT EIN SCHREIBMUSTER: er ruft das echte `pick()`
 * gegen eine ECHTE (nur gekuerzte) OpenDART-Antwort auf und prueft den ZAHLENWERT. Er prueft
 * beide Richtungen — die gueltige Form muss durchgehen, die kaputte muss auffliegen.
 *
 * Fixture: tests/fixtures/kr-opendart-hynix-fy2025.json (echte Antwort, auf die sieben
 * betroffenen Konten gekuerzt, sj_div/sj_nm/thstrm_amount unveraendert).
 *
 * Run: node tests/kr-sjdiv-eindeutigkeit.test.js   (Exit 0/1)
 */
const assert = require('node:assert/strict');
const { pick, numOf, KR_FELDER } = require('../scripts/build-krannual.js');

const FIX = require('./fixtures/kr-opendart-hynix-fy2025.json');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); }
}

// Amtliche Werte aus der echten Antwort (SK Hynix, Geschaeftsjahr 2025, KRW).
const BS_EIGENKAPITAL = 120666751000000;
const CIS_NETTOERGEBNIS = 42947902000000;
const CIS_UMSATZ = 97146675000000;
const BS_BILANZSUMME = 176107659000000;
const CF_OCF = 53373126000000;

// ── Voraussetzung: die Mehrdeutigkeit ist real, sonst prueft dieser Test Luft ──────────
test('VORAUSSETZUNG: account_id ist in der echten Antwort mehrdeutig (sonst waere der Filter unnoetig)', () => {
  const eq = FIX.list.filter((x) => x.account_id === 'ifrs-full_Equity');
  const pl = FIX.list.filter((x) => x.account_id === 'ifrs-full_ProfitLoss');
  assert.equal(eq.length, 9, 'ifrs-full_Equity muss 9x vorkommen (BS + 8x SCE)');
  assert.equal(pl.length, 9, 'ifrs-full_ProfitLoss muss 9x vorkommen (CIS + 8x SCE)');
  const sce = eq.filter((x) => x.sj_div === 'SCE').map((x) => numOf(x));
  assert.ok(sce.some((v) => v !== BS_EIGENKAPITAL),
    'mindestens eine SCE-Zeile muss einen ANDEREN Wert tragen — sonst waere die Verwechslung folgenlos');
});

// ── Anwesenheit: die gueltige Form muss den richtigen Wert liefern ─────────────────────
test('Eigenkapital kommt aus der BILANZ (BS), nicht aus dem Eigenkapitalspiegel', () => {
  const v = numOf(pick(FIX.list, 'ifrs-full_Equity', 'BS', /^자본총계$/));
  assert.equal(v, BS_EIGENKAPITAL);
});

test('Nettoergebnis kommt aus der GESAMTERGEBNISRECHNUNG (CIS), nicht aus dem Eigenkapitalspiegel', () => {
  const v = numOf(pick(FIX.list, 'ifrs-full_ProfitLoss', 'CIS', /^당기순이익/));
  assert.equal(v, CIS_NETTOERGEBNIS);
});

test('die eindeutigen Konten bleiben unveraendert richtig (keine Ueberkorrektur)', () => {
  assert.equal(numOf(pick(FIX.list, 'ifrs-full_Revenue', 'CIS', /^매출액$/)), CIS_UMSATZ);
  assert.equal(numOf(pick(FIX.list, 'ifrs-full_Assets', 'BS', /^자산총계$/)), BS_BILANZSUMME);
  assert.equal(numOf(pick(FIX.list, 'ifrs-full_CashFlowsFromUsedInOperatingActivities', 'CF', /^영업활동/)), CF_OCF);
});

test('alle acht Kennzahl-Definitionen greifen gegen die echte Antwort', () => {
  for (const [feld, def] of Object.entries(KR_FELDER)) {
    const v = numOf(pick(FIX.list, def.id, def.sj, def.re));
    assert.ok(Number.isFinite(v), `${feld} (${def.id}, sj_div=${def.sj}) liefert keinen Wert`);
  }
});

// ── Abwesenheit: die kaputte Form muss auffliegen ──────────────────────────────────────
test('GEGENPROBE: ein Konto im FALSCHEN Abschluss-Teil liefert gar nichts', () => {
  // Bilanzsumme steht ausschliesslich in der Bilanz. Wer sie in der Gesamtergebnis-
  // rechnung sucht, muss LEER ausgehen — nicht zufaellig irgendeine Zeile treffen.
  assert.equal(pick(FIX.list, 'ifrs-full_Assets', 'CIS', /^자산총계$/), undefined);
  // und umgekehrt: der operative Cashflow gibt es nur in der Kapitalflussrechnung.
  assert.equal(pick(FIX.list, 'ifrs-full_CashFlowsFromUsedInOperatingActivities', 'BS', /^영업활동/), undefined);
});

test('GEGENPROBE: der Eigenkapitalspiegel traegt BESTANDTEILE, die als Eigenkapital falsch waeren', () => {
  // Die erste SCE-Zeile ist die Summenzeile und stimmt zufaellig mit der Bilanz ueberein —
  // gefaehrlich sind die acht folgenden Bestandteils-Zeilen (Kapitalrücklage, Minderheiten …).
  // Genau die wuerde ein reihenfolge-abhaengiger Zugriff erwischen.
  const sceWerte = FIX.list
    .filter((x) => x.account_id === 'ifrs-full_Equity' && x.sj_div === 'SCE')
    .map((x) => numOf(x));
  assert.ok(sceWerte.every(Number.isFinite), 'alle SCE-Zeilen muessen als Zahl lesbar sein (sonst prueft der Test nichts)');
  const abweichend = sceWerte.filter((v) => v !== BS_EIGENKAPITAL);
  assert.ok(abweichend.length >= 5,
    `mindestens 5 SCE-Zeilen muessen vom Bilanzwert abweichen (gefunden: ${abweichend.length})`);
  // Kleinster abweichender Bestandteil in dieser echten Antwort: 150.573.000.000 KRW —
  // rund 800x kleiner als das Eigenkapital von 120.666.751.000.000. Ihn als Eigenkapital
  // zu schreiben waere ein Faktor-800-Fehler, den kein Plausibilitaets-Blick faengt.
  assert.ok(Math.min(...abweichend.map(Math.abs)) < BS_EIGENKAPITAL / 100,
    'mindestens eine SCE-Zeile ist um Groessenordnungen kleiner — sie als Eigenkapital zu schreiben waere stille Korruption');
});

test('GEGENPROBE: der ALTE Zugriff (nur account_id) ist beweisbar mehrdeutig', () => {
  // Genau der Zugriff, der vorher im Code stand. Er ist nur richtig, solange BS/CIS vor SCE
  // stehen. Diese Zeile stellt die Abhaengigkeit von der Reihenfolge nach: dreht man die
  // Liste um, liefert der alte Zugriff einen ANDEREN Wert — der Filter ist also tragend.
  const umgedreht = [...FIX.list].reverse();
  const altUmgedreht = umgedreht.find((x) => x.account_id === 'ifrs-full_Equity');
  assert.notEqual(numOf(altUmgedreht), BS_EIGENKAPITAL,
    'bei umgedrehter Reihenfolge muss der ungefilterte Zugriff danebengreifen — das ist der Befund');
  // und mit Filter ist die Reihenfolge egal:
  const neuUmgedreht = numOf(pick(umgedreht, 'ifrs-full_Equity', 'BS', /^자본총계$/));
  assert.equal(neuUmgedreht, BS_EIGENKAPITAL,
    'mit sj_div-Filter muss der Wert reihenfolge-unabhaengig stimmen');
});

test('Test-Seam bleibt nutzbar: Zeilen OHNE sj_div werden weiter gefunden', () => {
  // tests/p0-haertung3 stubbt nur account_id/thstrm_amount. Der Filter darf diesen Seam
  // nicht zerstoeren; gegen die echte Quelle (die sj_div immer traegt) wirkt er trotzdem strikt.
  const stub = [{ account_id: 'ifrs-full_Revenue', thstrm_amount: '1234' }];
  assert.equal(numOf(pick(stub, 'ifrs-full_Revenue', 'CIS', /^매출액$/)), 1234);
});

console.log(`\nkr-sjdiv-eindeutigkeit.test.js: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);

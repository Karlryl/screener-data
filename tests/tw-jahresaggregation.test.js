'use strict';
/**
 * tw-jahresaggregation — Waechter fuer scripts/build-twannual.js.
 *
 * DER BEFUND (19.08.2026, an echten FinMind-Antworten gemessen): die Quelle mischt ZWEI
 * Perioden-Konventionen in EINEM Feed.
 *   - GuV  (TaiwanStockFinancialStatements)  ist QUARTALS-DISKRET  -> Jahr = Summe der 4 Quartale
 *   - Cashflow (TaiwanStockCashFlowsStatement) ist YTD-KUMULIERT   -> Jahr = die 12-31-Zeile
 * Wer den Cashflow wie die GuV summiert, liegt bei 8996.TW FY2024 um Faktor 2,3 daneben
 * (2.391.967.000 statt 1.041.283.000 TWD). Die Recherche verlangt dafuer ausdruecklich einen
 * Waechter statt eines Kommentars — das ist er.
 *
 * Er prueft die SACHE (die Zahl), nicht ein Schreibmuster, und beide Richtungen: die gueltige
 * Form muss durchgehen, die verdrehte muss auffliegen.
 *
 * Fixture: tests/fixtures/tw-finmind-8996.json (echte FinMind-Antworten fuer 8996.TW,
 * auf 2023-2025 und die verwendeten Felder gekuerzt; Werte unveraendert). Kein Netz.
 *
 * Run: node tests/tw-jahresaggregation.test.js   (Exit 0/1)
 */
const assert = require('node:assert/strict');
const { bauJahre, IFRS_AB_JAHR } = require('../scripts/build-twannual.js');

const FIX = require('./fixtures/tw-finmind-8996.json');
const TK = '8996.TW';

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); }
}
const wert = (j, feld, fy) => j[feld][j.fys.indexOf(fy)].value;

// Amtlich nachrechenbare Werte aus der echten Antwort (8996.TW, TWD).
const FY = 2024;
const Q_UMSATZ_2024 = [797922000, 1000082000, 1209670000, 995766000]; // Q1..Q4, diskret
const JAHR_UMSATZ_2024 = 4003440000;   // = Summe der vier
const JAHR_OCF_2024 = 1041283000;      // = 12-31-Zeile, NICHT die Summe
const OCF_FALSCH_SUMMIERT = 310309000 + 396039000 + 644336000 + 1041283000; // 2.391.967.000

const basis = () => bauJahre(FIX.gu, FIX.bs, FIX.cf, TK);

// ── Anwesenheit: die richtige Rechnung ─────────────────────────────────────────────────
test('GuV-Jahreswert ist die SUMME der vier diskreten Quartale', () => {
  assert.equal(Q_UMSATZ_2024.reduce((a, b) => a + b, 0), JAHR_UMSATZ_2024, 'Fixture-Kontrolle');
  assert.equal(wert(basis(), 'annualRev', FY), JAHR_UMSATZ_2024);
});

test('Cashflow-Jahreswert ist die 12-31-Zeile — und NICHT die Summe der vier Zeilen', () => {
  const j = basis();
  assert.equal(wert(j, 'annualOCF', FY), JAHR_OCF_2024);
  assert.notEqual(wert(j, 'annualOCF', FY), OCF_FALSCH_SUMMIERT,
    `summiert waeren es ${OCF_FALSCH_SUMMIERT} — Faktor 2,3 zu hoch, genau die Falle`);
});

test('alle acht Kennzahlen kommen fuer ein volles Jahr an', () => {
  const j = basis();
  for (const f of ['annualRev', 'annualGrossProfit', 'annualOpInc', 'annualNetIncome',
    'annualAssets', 'annualEquity', 'annualOCF', 'annualShares']) {
    assert.ok(Number.isFinite(wert(j, f, FY)), `${f} fehlt fuer FY${FY}`);
  }
});

test('Aktienzahl ist Grundkapital / 10 (NT$10 Nennwert)', () => {
  const j = basis();
  const kap = FIX.bs.find((r) => r.date === `${FY}-12-31` && r.type === 'CapitalStock').value;
  assert.equal(wert(j, 'annualShares', FY), kap / 10);
});

// ── Abwesenheit: die kaputten Formen muessen auffliegen ────────────────────────────────
test('GEGENPROBE: fehlt EIN Quartal, ist das Jahr null — keine Teilsumme', () => {
  const ohneQ3 = FIX.gu.filter((r) => !(r.date === `${FY}-09-30` && r.type === 'Revenue'));
  const j = bauJahre(ohneQ3, FIX.bs, FIX.cf, TK);
  assert.equal(wert(j, 'annualRev', FY), null,
    'ein fehlendes Quartal darf NIE zu einer Drei-Quartals-Summe fuehren');
});

test('GEGENPROBE: wird der Cashflow quartalsdiskret, wirft der Waechter', () => {
  // Diskret nachgestellt: Anfangsbestand(Q+1) := Endbestand(Q) statt Anfangsbestand(Q).
  const proDatum = new Map();
  for (const r of FIX.cf) {
    if (!proDatum.has(r.date)) proDatum.set(r.date, {});
    proDatum.get(r.date)[r.type] = r.value;
  }
  const Q = ['03-31', '06-30', '09-30', '12-31'];
  const diskret = FIX.cf.map((r) => ({ ...r }));
  for (const r of diskret) {
    if (r.type !== 'CashBalancesBeginningOfPeriod') continue;
    const i = Q.indexOf(r.date.slice(5));
    if (i <= 0) continue;
    const vor = proDatum.get(r.date.slice(0, 4) + '-' + Q[i - 1]);
    if (vor && Number.isFinite(vor.CashBalancesEndOfPeriod)) r.value = vor.CashBalancesEndOfPeriod;
  }
  assert.throws(() => bauJahre(FIX.gu, FIX.bs, diskret, TK), /Cashflow-Konvention verletzt/);
});

test('GEGENPROBE: fehlt der Kassen-Anker ganz, wird nicht geraten sondern geworfen', () => {
  const ohneAnker = FIX.cf.filter((r) => r.type !== 'CashBalancesBeginningOfPeriod');
  assert.throws(() => bauJahre(FIX.gu, FIX.bs, ohneAnker, TK), /NICHT pruefbar/);
});

test('GEGENPROBE: wird die GuV kumuliert, wirft der Waechter', () => {
  // YTD nachgestellt: Umsatz innerhalb jedes Jahres aufaddieren -> faellt nie mehr.
  const proJahr = {};
  const ytd = FIX.gu.map((r) => {
    if (r.type !== 'Revenue') return { ...r };
    const j = r.date.slice(0, 4);
    proJahr[j] = (proJahr[j] || 0) + r.value;
    return { ...r, value: proJahr[j] };
  });
  assert.throws(() => bauJahre(FIX.gu.filter((r) => r.type !== 'Revenue').concat(ytd.filter((r) => r.type === 'Revenue')), FIX.bs, FIX.cf, TK),
    /GuV-Konvention verdaechtig/);
});

test('das angebrochene Jahr faellt raus — Index 0 ist NIE komplett leer', () => {
  // axes.js roicStabilitySource verlangt opS[0]/assetsS[0]/curLiabS[0] !== null, score.js liest
  // ab Index 0. Ein leeres laufendes Jahr an Index 0 wuerde den tiefen Pfad still abschalten.
  // Fixture 8996.TW enthaelt 2025-Quartale bis 12-31, dazu haengen wir ein angebrochenes 2026 an.
  const angebrochen = FIX.gu.filter((r) => r.date === '2025-03-31' || r.date === '2025-06-30')
    .map((r) => ({ ...r, date: r.date.replace('2025', '2026') }));
  const j = bauJahre(FIX.gu.concat(angebrochen), FIX.bs, FIX.cf, TK);
  assert.ok(!j.fys.includes(2026), `FY2026 ist unvollstaendig und darf nicht in fys stehen (fys=${j.fys})`);
  const felder = ['annualRev', 'annualGrossProfit', 'annualOpInc', 'annualNetIncome',
    'annualAssets', 'annualEquity', 'annualOCF', 'annualShares'];
  assert.ok(felder.some((f) => Number.isFinite(j[f][0].value)),
    'Index 0 muss mindestens einen Wert tragen, sonst schaltet axes.js den tiefen Pfad ab');
});

test('eine Luecke MITTEN in der Reihe bleibt als null stehen (Achse darf nicht verrutschen)', () => {
  // Nur komplett leere Jahre werden geschnitten — ein einzelnes fehlendes Quartal in einem
  // sonst belegten Jahr muss die gemeinsame Achse behalten, sonst paaren Verbraucher
  // Index i von zwei Feldern ueber verschiedene Geschaeftsjahre.
  const ohneQ3 = FIX.gu.filter((r) => !(r.date === '2024-09-30' && r.type === 'Revenue'));
  const j = bauJahre(ohneQ3, FIX.bs, FIX.cf, TK);
  assert.ok(j.fys.includes(2024), 'FY2024 hat noch Bilanz/Cashflow -> bleibt auf der Achse');
  assert.equal(wert(j, 'annualRev', 2024), null, 'nur der Umsatz faellt weg');
  assert.ok(Number.isFinite(wert(j, 'annualAssets', 2024)), 'die Bilanz steht weiterhin an derselben Stelle');
});

test('GEGENPROBE: Vor-IFRS-Jahre (< 2013) landen nie in der Ausgabe', () => {
  const alt = FIX.gu.concat(FIX.gu.filter((r) => r.date.startsWith('2024'))
    .map((r) => ({ ...r, date: r.date.replace('2024', '2009') })));
  const j = bauJahre(alt, FIX.bs, FIX.cf, TK);
  assert.equal(IFRS_AB_JAHR, 2013);
  assert.ok(j.fys.every((y) => y >= IFRS_AB_JAHR),
    `fys enthaelt ein Vor-IFRS-Jahr: ${j.fys.filter((y) => y < IFRS_AB_JAHR).join(',')}`);
});

console.log(`\ntw-jahresaggregation.test.js: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);

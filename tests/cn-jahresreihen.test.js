'use strict';
/**
 * cn-jahresreihen — Waechter fuer scripts/build-cnannual.js (China A + Hongkong).
 *
 * Fixture: tests/fixtures/cn-eastmoney.json — ECHTE Eastmoney-Rohantworten vom 19.08.2026,
 * Werte unveraendert, nur nach SECUCODE gruppiert. Kein Netz.
 *
 * Jeder Waechter wird in BEIDE Richtungen geprueft: die gueltige Form muss durchgehen, die
 * kaputte muss auffliegen. Und die Gegenproben sind so gewaehlt, dass sich die Werte
 * NACHWEISLICH unterscheiden — ein Testfall, bei dem beide Rechenwege dieselbe Zahl liefern,
 * kann einen Fehler gar nicht zeigen (Lehre vom 19.08.: drei Sabotagen blieben gruen).
 *
 * Run: node tests/cn-jahresreihen.test.js   (Exit 0/1)
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const B = require('../scripts/build-cnannual.js');
const FIX = require('./fixtures/cn-eastmoney.json');

// Der Laeufer sammelt erst und fuehrt dann SEQUENZIELL mit await aus. Ein `try { fn() }` ohne
// await haette bei den async-Faellen jede Zusicherung als bestanden gezaehlt und die Ablehnung
// als unbehandelte Promise-Ablehnung verschluckt — genau die Fehlerklasse, gegen die hier
// getestet wird.
let pass = 0, fail = 0;
const faelle = [];
function test(name, fn) { faelle.push([name, fn]); }
const tiefKopie = (x) => JSON.parse(JSON.stringify(x));
const a = (sec) => tiefKopie(FIX.a[sec]);
const hk = (sec) => tiefKopie(FIX.hk[sec]);
const wert = (j, feld, fy) => {
  const i = j.fys.indexOf(fy);
  assert.ok(i >= 0, 'FY' + fy + ' fehlt in fys=' + j.fys.join(','));
  return j[feld][i].value;
};
const rund = (x) => Math.round(x * 100) / 100;

// =====================================================================================
// A) FALLE 1 — YTD-KUMULIERUNG UND DEKUMULIERUNG
// =====================================================================================
// Die vier echten Cambricon-Zeilen des Geschaeftsjahres 2025 (CNY, aus der Fixture).
const CAM_YTD_2025 = [1111398926.80, 2880643471.09, 4607424363.66, 6497196198.68];
const CAM_JAHR_2025 = 6497196198.68;
const CAM_SUMME_FALSCH = CAM_YTD_2025.reduce((x, y) => x + y, 0);   // 15.096.663.960,23

test('VORAUSSETZUNG: die vier Quartalszeilen sind verschieden gross und steigen (sonst zeigt kein Test etwas)', () => {
  const zeilen = a('688256.SH').inc
    .filter((z) => z.REPORT_DATE.startsWith('2025'))
    .sort((x, y) => x.REPORT_DATE.localeCompare(y.REPORT_DATE))
    .map((z) => z.TOTAL_OPERATE_INCOME);
  assert.deepEqual(zeilen.map(rund), CAM_YTD_2025.map(rund), 'Fixture-Kontrolle: echte YTD-Reihe');
  for (let i = 1; i < zeilen.length; i += 1) assert.ok(zeilen[i] > zeilen[i - 1] * 1.2,
    'die Zeilen muessen deutlich verschieden sein, sonst kann eine Verwechslung nicht auffallen');
});

test('dekumuliere() macht aus der YTD-Reihe die echten Quartale — Q3 ist 1,73 Mrd, nicht 4,61 Mrd', () => {
  const q = B.dekumuliere(CAM_YTD_2025);
  assert.equal(rund(q[0]), rund(1111398926.80));
  assert.equal(rund(q[1]), rund(1769244544.29));
  assert.equal(rund(q[2]), rund(1726780892.57));
  assert.equal(rund(q[3]), rund(1889771835.02));
  assert.ok(CAM_YTD_2025[2] / q[2] > 2.6,
    'die YTD-Zeile ist Faktor ' + (CAM_YTD_2025[2] / q[2]).toFixed(2) + ' groesser als das echte Quartal');
  assert.equal(rund(q.reduce((x, y) => x + y, 0)), rund(CAM_JAHR_2025),
    'die vier echten Quartale ergeben zusammen wieder das Jahr');
});

test('dekumuliere(): eine Luecke bricht die Kette, statt eine falsche Differenz zu erfinden', () => {
  assert.deepEqual(B.dekumuliere([100, null, 400]), [100, null, null]);
});

test('der Jahreswert ist die 12-31-Zeile — NICHT die Summe der vier YTD-Zeilen', () => {
  const j = B.bauAJahre(a('688256.SH'), '688256.SS');
  assert.equal(wert(j, 'annualRev', 2025), CAM_JAHR_2025);
  assert.notEqual(rund(wert(j, 'annualRev', 2025)), rund(CAM_SUMME_FALSCH),
    'summiert waeren es ' + CAM_SUMME_FALSCH.toFixed(2) + ' — Faktor 2,3 zu hoch');
});

test('das angebrochene Jahr 2026 (nur Q1/Halbjahr) landet NIE als Jahr in der Reihe', () => {
  const roh = a('688256.SH');
  assert.ok(roh.inc.some((z) => z.REPORT_DATE.startsWith('2026')), 'Fixture enthaelt 2026-Zwischenzeilen');
  const j = B.bauAJahre(roh, '688256.SS');
  assert.ok(!j.fys.includes(2026), 'fys=' + j.fys.join(','));
});

test('GEGENPROBE: wird die A-GuV quartalsdiskret, wirft der Waechter', () => {
  const roh = a('688256.SH');
  const proJahr = {};
  for (const z of roh.inc.slice().sort((x, y) => x.REPORT_DATE.localeCompare(y.REPORT_DATE))) {
    const jahr = z.REPORT_DATE.slice(0, 4);
    const vorher = proJahr[jahr];
    const ytd = z.TOTAL_OPERATE_INCOME;
    proJahr[jahr] = ytd;
    if (Number.isFinite(ytd) && Number.isFinite(vorher)) z.TOTAL_OPERATE_INCOME = ytd - vorher;
  }
  assert.throws(() => B.bauAJahre(roh, '688256.SS'), /YTD-Konvention der GuV verletzt/);
});

test('GEGENPROBE: wird der A-Cashflow periodendiskret, wirft der Waechter', () => {
  const roh = a('688256.SH');
  const proJahr = new Map();
  for (const z of roh.cf) {
    const jahr = z.REPORT_DATE.slice(0, 4);
    if (!proJahr.has(jahr)) proJahr.set(jahr, []);
    proJahr.get(jahr).push(z);
  }
  let gedreht = 0;
  for (const [, zs] of proJahr) {
    const s = zs.filter((z) => Number.isFinite(z.BEGIN_CASH) && Number.isFinite(z.END_CASH))
      .sort((x, y) => x.REPORT_DATE.localeCompare(y.REPORT_DATE));
    for (let i = 1; i < s.length; i += 1) { s[i].BEGIN_CASH = s[i - 1].END_CASH; gedreht += 1; }
  }
  assert.ok(gedreht >= 3, 'die Sabotage muss ueberhaupt greifen (gedreht=' + gedreht + ')');
  assert.throws(() => B.bauAJahre(roh, '688256.SS'), /Cashflows verletzt/);
});

test('GEGENPROBE: ohne Zwischenberichte ist die YTD-Konvention unbelegt — dann wird geworfen', () => {
  // Diese Luecke fiel erst bei der Sabotage-Gegenprobe auf: der Wurf bei zu wenigen Belegen war
  // von keinem Test gedeckt. Ohne ihn liefe eine Firma, die NUR Jahreszeilen liefert, ohne
  // jeden Beweis durch — und genau dort waere ein Konventionswechsel unsichtbar.
  const roh = a('688256.SH');
  roh.inc = roh.inc.filter((z) => z.REPORT_TYPE === '年报');
  assert.ok(roh.inc.length >= 5, 'die Jahreszeilen bleiben ja da (' + roh.inc.length + ')');
  assert.throws(() => B.bauAJahre(roh, '688256.SS'), /GuV NICHT pruefbar/);
});

test('GEGENPROBE: fehlt der Kassen-Anker ganz, wird nicht geraten sondern geworfen', () => {
  const roh = a('688256.SH');
  for (const z of roh.cf) z.BEGIN_CASH = null;
  assert.throws(() => B.bauAJahre(roh, '688256.SS'), /NICHT pruefbar/);
});

test('Hongkong: START_DATE belegt die YTD-Konvention — der Q1-2026-Bericht startet am 01.01.', () => {
  const q1 = hk('03308.HK').main.find((z) => z.REPORT_DATE.startsWith('2026-03-31'));
  assert.ok(q1, 'Fixture enthaelt einen Zwischenbericht');
  assert.equal(q1.START_DATE.slice(0, 10), '2026-01-01',
    'unter YTD startet auch ein Quartalsbericht am Geschaeftsjahres-Anfang');
  assert.doesNotThrow(() => B.pruefeYtdHk('3308.HK', hk('03308.HK').main));
});

test('GEGENPROBE HK: startet ein Zwischenbericht am Quartalsanfang, wirft der Waechter', () => {
  const roh = hk('03308.HK');
  const q1 = roh.main.find((z) => z.REPORT_DATE.startsWith('2026-03-31'));
  q1.START_DATE = '2026-01-01 00:00:00';
  const q = roh.main.find((z) => z.REPORT_DATE.startsWith('2025-03-31'));
  q.START_DATE = '2025-01-01 00:00:00';
  // erst der gueltige Zustand …
  assert.doesNotThrow(() => B.pruefeYtdHk('3308.HK', roh.main));
  // … dann derselbe Bericht als diskretes Quartal
  q1.START_DATE = '2026-01-01 00:00:00';
  const roh2 = tiefKopie(roh);
  roh2.main.find((z) => z.REPORT_DATE.startsWith('2026-03-31')).START_DATE = '2026-04-01 00:00:00';
  assert.throws(() => B.pruefeYtdHk('3308.HK', roh2.main), /YTD-Konvention verletzt/);
});

test('GEGENPROBE HK: umspannt der "Jahresabschluss" nur ein Halbjahr, wirft der Waechter', () => {
  const roh = hk('09992.HK');
  const jahr = roh.main.find((z) => z.DATE_TYPE_CODE === '001' && z.REPORT_DATE.startsWith('2025-12-31'));
  jahr.START_DATE = '2025-07-01 00:00:00';
  assert.throws(() => B.pruefeYtdHk('9992.HK', roh.main), /YTD-Konvention verletzt/);
});

// =====================================================================================
// B) FALLE 2 — A+H-DOPPELLISTUNG: DIE A-SEITE GEWINNT
// =====================================================================================
test('VORAUSSETZUNG: A- und H-Seite derselben Firma unterscheiden sich messbar', () => {
  const jA = B.bauAJahre(a('300308.SZ'), '300308.SZ');
  const jH = B.bauHkJahre(hk('03308.HK'), '3308.HK');
  assert.ok(jA.fys.length >= 15 && jH.fys.length <= 5,
    'Tiefe: A=' + jA.fys.length + ' Jahre gegen H=' + jH.fys.length + ' Jahre');
  assert.notEqual(wert(jA, 'annualGrossProfit', 2025), wert(jH, 'annualGrossProfit', 2025));
  assert.equal(rund(wert(jA, 'annualGrossProfit', 2025)), 16074398513.90);
  assert.equal(wert(jH, 'annualGrossProfit', 2025), 15875882000);
  assert.equal(jA.waehrung, 'CNY');
  assert.equal(jH.standard, 'IFRS');
});

test('Phantom-A-Codes werden als Zwilling abgelehnt, echte akzeptiert', () => {
  assert.equal(B.istEchterACode('300308.SZ'), true);
  assert.equal(B.istEchterACode('688256.SH'), true);
  assert.equal(B.istEchterACode('A20211.SZ'), false, 'Platzhalter fuer ein nicht geliefertes A-Listing');
  assert.equal(B.istEchterACode('A16324.SH'), false);
  assert.equal(B.istEchterACode('900932.SH'), false, 'B-Aktie, notiert in USD');
  assert.equal(B.istEchterACode('200725.SZ'), false, 'B-Aktie, notiert in HKD');
});

test('GEGENPROBE: liefert die ORG_CODE-Suche NUR einen Phantom-Code, gibt es keinen Zwilling', async () => {
  const nurPhantom = async () => ({
    success: true, code: 0, message: 'ok',
    result: { pages: 1, count: 1, data: [{ SECUCODE: 'A20211.SZ', ORG_CODE: '10000075121', REPORT_DATE: '2025-12-31 00:00:00', REPORT_TYPE: '年报' }] },
  });
  const paare = await B.loeseAhAuf(new Map([['06181.HK', '10000075121']]), nurPhantom);
  assert.equal(paare.size, 0, 'ein Phantom darf keine A-Herkunft begruenden');
  const echt = async () => ({
    success: true, code: 0, message: 'ok',
    result: { pages: 1, count: 1, data: [{ SECUCODE: '300308.SZ', ORG_CODE: '10196554', REPORT_DATE: '2025-12-31 00:00:00', REPORT_TYPE: '年报' }] },
  });
  const paare2 = await B.loeseAhAuf(new Map([['03308.HK', '10196554']]), echt);
  assert.equal(paare2.get('03308.HK'), '300308.SZ');
});

// Fake-Quelle: bedient main() aus der Fixture, ohne Netz.
function fakeQuelle(fixture) {
  return async (url) => {
    const u = new URL(url);
    const rn = u.searchParams.get('reportName');
    const cols = u.searchParams.get('columns').split(',');
    const filter = u.searchParams.get('filter');
    const werteAus = (feld) => {
      const m = new RegExp('\\(' + feld + ' in \\(([^)]*)\\)\\)').exec(filter);
      return m ? [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]) : null;
    };
    const secs = werteAus('SECUCODE');
    const orgs = werteAus('ORG_CODE');
    let quelle = [];
    if (rn === 'RPT_F10_FINANCE_GINCOME') quelle = Object.values(fixture.a).flatMap((x) => x.inc);
    else if (rn === 'RPT_F10_FINANCE_GBALANCE') quelle = Object.values(fixture.a).flatMap((x) => x.bal);
    else if (rn === 'RPT_F10_FINANCE_GCASHFLOW') quelle = Object.values(fixture.a).flatMap((x) => x.cf);
    else if (rn === 'RPT_HKF10_FN_MAININDICATOR') quelle = Object.values(fixture.hk).flatMap((x) => x.main);
    else if (rn === 'RPT_HKF10_FN_INCOME') quelle = Object.values(fixture.hk).flatMap((x) => x.inc);
    else if (rn === 'RPT_HKF10_FN_BALANCE') quelle = Object.values(fixture.hk).flatMap((x) => x.bal);
    else throw new Error('Fake kennt ' + rn + ' nicht');
    let data = quelle;
    if (secs) data = data.filter((z) => secs.includes(z.SECUCODE));
    if (orgs) data = data.filter((z) => orgs.includes(z.ORG_CODE));
    if (/\(REPORT_TYPE="年报"\)/.test(filter)) data = data.filter((z) => z.REPORT_TYPE === '年报');
    data = data.map((z) => Object.fromEntries(cols.map((c) => [c, c in z ? z[c] : null])));
    return { success: true, code: 0, message: 'ok', result: { pages: 1, count: data.length, data } };
  };
}

test('A+H: 3308.HK wird ueber die A-Seite gebaut — 18 Jahre statt 3, CAS/CNY, Herkunft benannt', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cnannual-'));
  const out = path.join(dir, 'cn-secannual.json');
  await B.main({ fetchJson: fakeQuelle(FIX), out, aTickers: ['688256.SS'], hkTickers: ['3308.HK'] });
  const store = JSON.parse(fs.readFileSync(out, 'utf8'));
  const e = store['3308.HK'];
  assert.ok(e, 'Store: ' + Object.keys(store).join(','));
  assert.equal(e.listing, 'A');
  assert.equal(e.preferredListing, 'A');
  assert.equal(e.sourceListing, '300308.SZ');
  assert.equal(e.secucode, '300308.SZ');
  assert.equal(e.accountingStandard, 'CAS');
  assert.equal(e.reportingCurrencyOriginal, 'CNY');
  assert.ok(e.fys.length >= 15, 'Tiefe der A-Seite: ' + e.fys.length + ' Jahre');
  assert.equal(rund(e.annualGrossProfit[e.fys.indexOf(2025)].value), 16074398513.90,
    'die Zahlen stammen von der A-Seite, nicht von der H-Seite (dort 15.875.882.000)');
  assert.equal(store['688256.SS'].listing, 'A');
  assert.equal(store['688256.SS'].sourceListing, undefined, 'ein reiner A-Name traegt keine Fremdherkunft');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('GEGENPROBE: ohne A+H-Vorrang saehe 3308.HK anders aus — die kurze H-Reihe', () => {
  const jH = B.bauHkJahre(hk('03308.HK'), '3308.HK');
  assert.equal(jH.fys.length, 3, 'die H-Seite traegt nur ' + jH.fys.length + ' Jahre');
  assert.notEqual(jH.standard, 'CAS');
});

// =====================================================================================
// C) FALLE 3 — BILANZIERUNGSSTANDARD IST PFLICHTFELD
// =====================================================================================
test('VORAUSSETZUNG: die beiden HK-Testfirmen melden nachweislich VERSCHIEDENE Standards', () => {
  const roh1 = hk('03750.HK'), roh2 = hk('01585.HK');
  assert.equal(roh1.inc[0].ACCOUNT_STANDARD, '大陆会计准则');
  assert.equal(roh2.inc[0].ACCOUNT_STANDARD, '香港会计准则');
  assert.notEqual(roh1.inc[0].ACCOUNT_STANDARD, roh2.inc[0].ACCOUNT_STANDARD);
});

test('der Standard steht je Firma in der Ausgabe: CAS gegen HKFRS', () => {
  assert.equal(B.bauHkJahre(hk('03750.HK'), '3750.HK').standard, 'CAS');
  assert.equal(B.bauHkJahre(hk('01585.HK'), '1585.HK').standard, 'HKFRS');
  assert.equal(B.bauHkJahre(hk('09992.HK'), '9992.HK').standard, 'IFRS');
});

test('GEGENPROBE: ein unbekannter Standard faerbt die Firma rot statt still durchzugehen', () => {
  const roh = hk('01585.HK');
  for (const z of roh.inc) z.ACCOUNT_STANDARD = 'марсианские стандарты';
  for (const z of roh.bal) z.ACCOUNT_STANDARD = 'марсианские стандарты';
  assert.throws(() => B.bauHkJahre(roh, '1585.HK'), /unbekannter Bilanzierungsstandard/);
});

test('GEGENPROBE: fehlt der Standard ganz, wird NICHTS geschrieben', () => {
  const roh = hk('01585.HK');
  for (const z of roh.inc) z.ACCOUNT_STANDARD = null;
  for (const z of roh.bal) z.ACCOUNT_STANDARD = null;
  assert.throws(() => B.bauHkJahre(roh, '1585.HK'), /nicht feststellbar|keinen etikettierten Posten/);
});

test('GEGENPROBE: wechselt der Standard mitten in der Reihe, wird abgeschnitten statt gemischt', () => {
  // ECHTER FALL: 03750.HK meldet 2024/2025 nach 大陆会计准则, 2022/2023 nach 国际会计准则.
  const roh = hk('03750.HK');
  const alt = new Set(roh.inc.filter((z) => z.ACCOUNT_STANDARD === '国际会计准则')
    .map((z) => z.REPORT_DATE.slice(0, 10)));
  assert.ok(alt.size >= 2, 'Fixture-Kontrolle: es gibt aeltere Jahre mit anderem Standard');
  const j = B.bauHkJahre(roh, '3750.HK');
  for (const d of alt) assert.ok(!j.fys.includes(Number(d.slice(0, 4))),
    'FY' + d.slice(0, 4) + ' hat einen anderen Standard und darf nicht in derselben Reihe stehen');
  assert.equal(j.abgeschnitten, alt.size);
});

// =====================================================================================
// D) FALLE 4 — WAEHRUNG IST PFLICHTFELD UND WIRD NIE GEMISCHT
// =====================================================================================
test('VORAUSSETZUNG: die HK-Testfirmen melden nachweislich VERSCHIEDENE Waehrungen', () => {
  assert.equal(hk('09992.HK').inc[0].CURRENCY_CODE, 'CNY', 'Pop Mart meldet in CNY, nicht in HKD');
  assert.equal(hk('03918.HK').inc[0].CURRENCY_CODE, 'USD');
});

test('die Waehrung steht je Firma in der Ausgabe und wird nicht umgerechnet', () => {
  assert.equal(B.bauHkJahre(hk('09992.HK'), '9992.HK').waehrung, 'CNY');
  assert.equal(B.bauHkJahre(hk('03918.HK'), '3918.HK').waehrung, 'USD');
  assert.equal(B.bauAJahre(a('688256.SH'), '688256.SS').waehrung, 'CNY');
});

test('ECHTER WAEHRUNGSWECHSEL: 1208.HK wechselte 2009 von HKD auf USD — die HKD-Jahre fallen raus', () => {
  const roh = hk('01208.HK');
  const hkdJahre = new Set(roh.inc.filter((z) => z.CURRENCY_CODE === 'HKD')
    .map((z) => Number(z.REPORT_DATE.slice(0, 4))));
  const usdJahre = new Set(roh.inc.filter((z) => z.CURRENCY_CODE === 'USD')
    .map((z) => Number(z.REPORT_DATE.slice(0, 4))));
  assert.ok(hkdJahre.size >= 5 && usdJahre.size >= 5,
    'Fixture-Kontrolle: beide Waehrungsblöcke sind vorhanden (HKD ' + hkdJahre.size + ', USD ' + usdJahre.size + ')');
  const j = B.bauHkJahre(roh, '1208.HK');
  assert.equal(j.waehrung, 'USD');
  for (const y of hkdJahre) assert.ok(!j.fys.includes(y),
    'FY' + y + ' steht in HKD und darf nicht neben USD-Jahren stehen');
  assert.ok(j.fys.length >= 10, 'die USD-Jahre bleiben vollstaendig erhalten: ' + j.fys.length);
});

test('LUEGEN-SPALTE: der umgerechnete Cashflow wird verworfen statt in fremder Waehrung geschrieben', () => {
  const j = B.bauHkJahre(hk('03918.HK'), '3918.HK');
  const rohOcf = hk('03918.HK').main.find((z) => z.DATE_TYPE_CODE === '001' && z.REPORT_DATE.startsWith('2025-12-31'));
  assert.ok(Number.isFinite(rohOcf.NETCASH_OPERATE), 'die Quelle LIEFERT einen Cashflow …');
  assert.equal(j.ocfBrauchbar, false);
  assert.equal(wert(j, 'annualOCF', 2025), null, '… er wird aber nicht uebernommen, weil er umgerechnet ist');
  assert.match(j.ocfGrund, /anderen Waehrung/);
  // Gegenrichtung: bei einer Firma, deren Kennzahlen-Bericht dieselbe Waehrung fuehrt, kommt er an.
  const jOk = B.bauHkJahre(hk('09992.HK'), '9992.HK');
  assert.equal(jOk.ocfBrauchbar, true);
  assert.equal(wert(jOk, 'annualOCF', 2025), 10865152000);
});

test('GEGENPROBE: wird der Umsatz des Kennzahlen-Berichts verstellt, faellt der Cashflow weg', () => {
  const roh = hk('09992.HK');
  for (const z of roh.main) if (Number.isFinite(z.OPERATE_INCOME)) z.OPERATE_INCOME *= 7.029;
  const j = B.bauHkJahre(roh, '9992.HK');
  assert.equal(j.ocfBrauchbar, false);
  assert.equal(wert(j, 'annualOCF', 2025), null);
});

test('GEGENPROBE: fehlt die Waehrung ganz, wird NICHTS geschrieben (A und HK)', () => {
  const rohA = a('688256.SH');
  for (const z of rohA.inc) z.CURRENCY = null;
  assert.throws(() => B.bauAJahre(rohA, '688256.SS'), /keine Berichtswaehrung/);
  const rohH = hk('09992.HK');
  for (const z of rohH.inc) z.CURRENCY_CODE = null;
  for (const z of rohH.bal) z.CURRENCY_CODE = null;
  assert.throws(() => B.bauHkJahre(rohH, '9992.HK'), /nicht feststellbar|keinen etikettierten Posten/);
});

// =====================================================================================
// E) SCHEMA-WAECHTER — DER KANAL IST INOFFIZIELL
// =====================================================================================
test('pruefeSchema: eine verschwundene Spalte ist ein Fehler, keine Null-Reihe', () => {
  const gut = [{ SECUCODE: 'X', TOTAL_OPERATE_INCOME: 5 }];
  assert.doesNotThrow(() => B.pruefeSchema(gut, ['SECUCODE', 'TOTAL_OPERATE_INCOME'], 'test'));
  assert.throws(() => B.pruefeSchema([{ SECUCODE: 'X' }], ['SECUCODE', 'TOTAL_OPERATE_INCOME'], 'test'),
    /Spalte TOTAL_OPERATE_INCOME fehlt/);
});

test('pruefeSchema: eine Zahl-Spalte, die ploetzlich Text liefert, ist ein Fehler (sonst NaN)', () => {
  assert.throws(() => B.pruefeSchema([{ SECUCODE: 'X', TOTAL_OPERATE_INCOME: '1,234' }],
    ['SECUCODE', 'TOTAL_OPERATE_INCOME'], 'test'), /statt Zahl\/null/);
  assert.doesNotThrow(() => B.pruefeSchema([{ SECUCODE: 'X', TOTAL_OPERATE_INCOME: null }],
    ['SECUCODE', 'TOTAL_OPERATE_INCOME'], 'test'), 'null ist erlaubt — fehlender Wert, kein Typbruch');
});

test('holeBericht: Quellenfehler, unvollstaendige Blaetterung und Doppel-Zeilen werfen', async () => {
  const antwort = (o) => async () => o;
  await assert.rejects(() => B.holeBericht('R', ['SECUCODE'], '(x)', 'F10', null,
    antwort({ success: false, code: 9501, message: 'TOTAL_OPERATE_INCOME返回字段不存在' })), /Quelle meldet Fehler/);
  // ECHTER FALL vom 19.08.: der A-Endpunkt liefert hoechstens 500 Zeilen je Seite und meldet
  // count=552. Bleibt die zweite Seite leer, fehlen 52 Perioden — das muss auffallen.
  let seite = 0;
  const abgeschnitten = async () => {
    seite += 1;
    const data = seite === 1 ? Array.from({ length: 500 }, (_, i) => ({ SECUCODE: 'A' + i })) : [];
    return { success: true, result: { count: 552, data } };
  };
  await assert.rejects(() => B.holeBericht('R', ['SECUCODE'], '(x)', 'HSF10', null, abgeschnitten),
    /geblaettert kamen 500 Zeilen/);
  // Gleichrangige Sortierschluessel BEIM BLAETTERN: dieselbe Zeile zweimal, eine andere gar
  // nicht. Die Gesamtzahl stimmt — nur die Eindeutigkeit deckt es auf.
  let s3 = 0;
  const geblaettertDoppelt = async () => {
    s3 += 1;
    const data = s3 === 1
      ? Array.from({ length: 500 }, (_, i) => ({ SECUCODE: 'A' + Math.min(i, 498) }))
      : Array.from({ length: 52 }, (_, i) => ({ SECUCODE: 'B' + i }));
    return { success: true, result: { count: 552, data } };
  };
  await assert.rejects(() => B.holeBericht('R', ['SECUCODE'], '(x)', 'HSF10', null, geblaettertDoppelt),
    /nur 551 verschieden/);
  // Auf EINER Seite ist eine Dublette dagegen eine Eigenschaft der Quelle, kein Transportfehler —
  // sie darf nicht den ganzen Batch kosten, sondern wird firmenweise behandelt (Test unten).
  assert.equal((await B.holeBericht('R', ['SECUCODE'], '(x)', 'F10', null,
    antwort({ success: true, result: { count: 2, data: [{ SECUCODE: 'A' }, { SECUCODE: 'A' }] } }))).length, 2);
  // Leerer Treffer ist KEIN Fehler.
  assert.deepEqual(await B.holeBericht('R', ['SECUCODE'], '(x)', 'F10', null,
    antwort({ success: false, code: 9201, message: '返回数据为空' })), []);
  // Vollstaendige Blaetterung ueber zwei Seiten geht durch.
  let s2 = 0;
  const zweiSeiten = async () => {
    s2 += 1;
    const data = s2 === 1
      ? Array.from({ length: 500 }, (_, i) => ({ SECUCODE: 'A' + i }))
      : Array.from({ length: 52 }, (_, i) => ({ SECUCODE: 'B' + i }));
    return { success: true, result: { count: 552, data } };
  };
  assert.equal((await B.holeBericht('R', ['SECUCODE'], '(x)', 'HSF10', null, zweiSeiten)).length, 552);
});

test('ECHTER FALL 6880.HK: zwei Jahreszeilen mit verschiedenen Zahlen — die Firma wird verworfen', () => {
  // Gemessen 19.08.2026: die Quelle fuehrt fuer FY2023 zwei Jahresabschluss-Zeilen. Eine meldet
  // Umsatz 742.745.000 und einen operativen Mittelabfluss von 1,07 Mrd, die andere 135.185.368,50
  // und einen Zufluss von 1,9 Mio. "Die erste gewinnt" waere eine stille Wahl zwischen Gewinn
  // und Verlust.
  const zeilen = [
    { REPORT_DATE: '2023-12-31 00:00:00', OPERATE_INCOME: 742745000, NETCASH_OPERATE: -1068557000 },
    { REPORT_DATE: '2023-12-31 00:00:00', OPERATE_INCOME: 135185368.5, NETCASH_OPERATE: 1910311.76 },
  ];
  assert.notEqual(zeilen[0].OPERATE_INCOME, zeilen[1].OPERATE_INCOME, 'VORAUSSETZUNG: die Zeilen widersprechen sich');
  let e = null;
  try { B.eindeutigOderWurf(zeilen, ['OPERATE_INCOME', 'NETCASH_OPERATE'], '6880.HK', 'der HK-Kennzahlen-Bericht'); }
  catch (x) { e = x; }
  assert.ok(e, 'zwei widerspruechliche Zeilen muessen werfen');
  assert.match(e.message, /nicht entscheidbar/);
  assert.equal(e.nichtBaubar, true, 'als "nicht baubar" markiert — das ist eine Dateneigenschaft, kein Konventionsbruch');
  // Identische Dubletten sind harmlos.
  assert.doesNotThrow(() => B.eindeutigOderWurf([zeilen[0], { ...zeilen[0] }],
    ['OPERATE_INCOME', 'NETCASH_OPERATE'], '6880.HK', 'der HK-Kennzahlen-Bericht'));
});

test('bekannt nicht baubare Namen stehen namentlich mit Begruendung im Code', () => {
  for (const [tk, grund] of Object.entries(B.CN_NICHT_BAUBAR)) {
    assert.ok(grund && grund.length > 40, tk + ': die Begruendung muss den Grund nennen, nicht nur "geht nicht"');
    assert.match(grund, /gemessen/, tk + ': die Begruendung muss auf einer Messung beruhen');
  }
});

test('ECHTER FALL 3931.HK: GuV meldet IFRS, die Bilanz derselben Periode CAS — die Bilanz faellt weg', () => {
  const roh = hk('03931.HK');
  const incStd = roh.inc.filter((z) => z.REPORT_DATE.startsWith('2025-12-31'))[0].ACCOUNT_STANDARD;
  const balStd = roh.bal.filter((z) => z.REPORT_DATE.startsWith('2025-12-31'))[0].ACCOUNT_STANDARD;
  assert.equal(incStd, '国际会计准则');
  assert.equal(balStd, '大陆会计准则');
  assert.notEqual(incStd, balStd, 'VORAUSSETZUNG: die beiden Berichte widersprechen sich wirklich');
  const j = B.bauHkJahre(roh, '3931.HK');
  assert.equal(j.standard, 'IFRS');
  assert.ok(Number.isFinite(wert(j, 'annualRev', 2025)), 'die GuV-Reihe bleibt erhalten');
  assert.equal(wert(j, 'annualAssets', 2025), null, 'die CAS-Bilanz darf nicht neben die IFRS-GuV');
  assert.equal(wert(j, 'annualEquity', 2025), null);
  assert.ok(Number.isFinite(wert(j, 'annualAssets', 2024)), 'FY2024 ist einheitlich und bleibt vollstaendig');
  assert.equal(j.bilanzVerworfen, 1);
});

test('ECHTER FALL 002314.SZ: Berichtigungen im Kassenbestand sind KEIN Konventionsbruch', () => {
  // 17 Perioden-Paare, davon 8 eindeutig YTD und 0 eindeutig periodendiskret; die uebrigen sind
  // nachtraeglich berichtigte Anfangsbestaende. Eine feste Trefferquote haette die Firma
  // verworfen, obwohl kein einziges Paar fuer die Gegenthese spricht.
  const roh = a('002314.SZ');
  const w = B.pruefeYtdA('002314.SZ', roh.inc, roh.cf);
  assert.equal(w.diskretTreffer, 0, 'kein einziges Paar spricht fuer periodendiskret');
  assert.ok(w.ytdTreffer >= 3, 'genug positive Belege: ' + w.ytdTreffer);
  assert.ok(w.ytdTreffer < w.cfPaare * 0.6, 'und trotzdem unter der alten starren Quote ('
    + w.ytdTreffer + ' von ' + w.cfPaare + ') — genau der Fall, der frueher falsch rot war');
  assert.ok(B.bauAJahre(roh, '002314.SZ').fys.length >= 10);
});

test('GEGENPROBE: verschwindet eine Spalte in der echten Antwort, bricht der Abruf ab', async () => {
  const ohneUmsatz = async (url) => {
    const roh = await fakeQuelle(FIX)(url);
    for (const z of roh.result.data) delete z.TOTAL_OPERATE_INCOME;
    return roh;
  };
  await assert.rejects(() => B.holeBericht('RPT_F10_FINANCE_GINCOME', B.A_INC,
    '(SECUCODE in ("688256.SH"))', 'HSF10', 'REPORT_DATE', ohneUmsatz), /Spalte TOTAL_OPERATE_INCOME fehlt/);
});

// =====================================================================================
// F) AKTIENZAHL — DER NENNWERT DARF NICHT GERATEN WERDEN
// =====================================================================================
test('VORAUSSETZUNG: die beiden Testfirmen haben nachweislich VERSCHIEDENE Nennwerte', () => {
  assert.equal(B.bauAJahre(a('688256.SH'), '688256.SS').nennwert, 1);
  assert.equal(B.bauAJahre(a('601899.SH'), '601899.SS').nennwert, 0.1);
});

test('601899.SH: die Aktienzahl ist 26,59 Mrd — NICHT der Nennbetrag 2,66 Mrd (Faktor 10)', () => {
  const j = B.bauAJahre(a('601899.SH'), '601899.SS');
  const kapital = a('601899.SH').bal
    .find((z) => z.REPORT_TYPE === '年报' && z.REPORT_DATE.startsWith('2025-12-31')).SHARE_CAPITAL;
  assert.equal(kapital, 2658973314, 'Fixture-Kontrolle: der rohe Nennbetrag');
  assert.equal(wert(j, 'annualShares', 2025), 26589733140);
  assert.notEqual(wert(j, 'annualShares', 2025), kapital,
    'den Nennbetrag als Stueckzahl zu nehmen waere Faktor 10 daneben');
});

test('GEGENPROBE: passt zu keinem ueblichen Nennwert, bleibt die Aktienzahl leer statt geraten', () => {
  const roh = a('688256.SH');
  for (const z of roh.inc) if (Number.isFinite(z.BASIC_EPS)) z.BASIC_EPS *= 3.7;   // Nennwert 3,7 gibt es nicht
  const j = B.bauAJahre(roh, '688256.SS');
  assert.equal(j.nennwert, null);
  assert.ok(j.annualShares.every((e) => e.value === null), 'kein geratener Nennwert, kein Wert');
  assert.ok(Number.isFinite(wert(j, 'annualRev', 2025)), 'die uebrigen Felder bleiben unberuehrt');
});

test('Hongkong bekommt bewusst KEINE Aktienzahl — die Quelle hat dort keine Reihe', () => {
  const roh = hk('09992.HK');
  const werte = new Set(roh.main.filter((z) => z.DATE_TYPE_CODE === '001')
    .map((z) => z.ISSUED_COMMON_SHARES));
  assert.equal(werte.size, 1,
    'Beleg: ueber alle Jahre EIN Wert (' + [...werte] + ') — der heutige Stand, in die Vergangenheit kopiert');
  const j = B.bauHkJahre(roh, '9992.HK');
  assert.ok(j.annualShares.every((e) => e.value === null),
    'eine flache Linie behauptete "keine Verwaesserung" — schlimmer als kein Wert');
});

// =====================================================================================
// G) ROHERTRAGS-PLATZHALTER
// =====================================================================================
test('VORAUSSETZUNG: 1208.HK meldet Rohertrag == Umsatz (Platzhalter, keine 100-%-Marge)', () => {
  const jahr = hk('01208.HK').inc.filter((z) => z.REPORT_DATE.startsWith('2025-12-31'));
  const rev = jahr.find((z) => z.STD_ITEM_CODE === B.HK_INC_ITEMS.annualRev).AMOUNT;
  const gp = jahr.find((z) => z.STD_ITEM_CODE === B.HK_INC_ITEMS.annualGrossProfit).AMOUNT;
  assert.equal(rev, gp, 'Fixture-Kontrolle: beide 6.218.000.000');
});

test('der Platzhalter wird verworfen — und ein echter Rohertrag bleibt stehen', () => {
  assert.equal(wert(B.bauHkJahre(hk('01208.HK'), '1208.HK'), 'annualGrossProfit', 2025), null);
  assert.equal(wert(B.bauHkJahre(hk('09992.HK'), '9992.HK'), 'annualGrossProfit', 2025), 26764916000);
  assert.equal(B.rohertrag(100, 100), null);
  assert.equal(B.rohertrag(100, 99), 99);
});

// =====================================================================================
// H) DIE ANKER AUS DER RECHERCHE (Sollwerte vom 19.08.2026)
// =====================================================================================
test('Anker 688256.SS Cambricon FY2025', () => {
  const j = B.bauAJahre(a('688256.SH'), '688256.SS');
  assert.equal(wert(j, 'annualRev', 2025), 6497196198.68);
  assert.equal(rund(wert(j, 'annualGrossProfit', 2025)), 3583313004.19);
  assert.equal(wert(j, 'annualOpInc', 2025), 2061390034.78);
  assert.equal(wert(j, 'annualNetIncome', 2025), 2059228538.67);
});

test('Anker 300308.SZ Innolight FY2025', () => {
  const j = B.bauAJahre(a('300308.SZ'), '300308.SZ');
  assert.equal(wert(j, 'annualRev', 2025), 38239935640.67);
  assert.equal(rund(wert(j, 'annualGrossProfit', 2025)), 16074398513.90);
  assert.equal(wert(j, 'annualNetIncome', 2025), 10797254300.45);
});

test('Anker 9992.HK Pop Mart FY2025', () => {
  const j = B.bauHkJahre(hk('09992.HK'), '9992.HK');
  assert.equal(wert(j, 'annualRev', 2025), 37120052000);
  assert.equal(wert(j, 'annualGrossProfit', 2025), 26764916000);
  assert.equal(wert(j, 'annualAssets', 2025), 32101354000);
  assert.equal(wert(j, 'annualEquity', 2025), 22277735000);
  assert.equal(wert(j, 'annualOCF', 2025), 10865152000);
});

// =====================================================================================
// I) AUSGABEFORMAT — dieselbe Form wie tw-/kr-/jp-secannual.json
// =====================================================================================
test('Ausgabeschema: Pflichtfelder vorhanden, Serien als {value}-Objekte, newest-first', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cnannual-'));
  const out = path.join(dir, 'cn-secannual.json');
  await B.main({ fetchJson: fakeQuelle(FIX), out, aTickers: ['688256.SS'], hkTickers: ['9992.HK'] });
  const store = JSON.parse(fs.readFileSync(out, 'utf8'));
  for (const tk of ['688256.SS', '9992.HK']) {
    const e = store[tk];
    assert.ok(e, tk + ' fehlt im Store');
    for (const f of ['source', 'accountingStandard', 'consolidation', 'reportingCurrencyOriginal',
      'nfy', 'generatedAt', 'fys']) {
      assert.ok(e[f] != null, tk + ': Pflichtfeld ' + f + ' fehlt');
    }
    assert.equal(e.nfy, e.fys[0], tk + ': nfy muss das juengste Jahr sein');
    for (let i = 1; i < e.fys.length; i += 1) {
      assert.ok(e.fys[i] < e.fys[i - 1], tk + ': fys muss newest-first sein');
    }
    for (const f of B.FELD_NAMEN) {
      assert.ok(Array.isArray(e[f]), tk + ': ' + f + ' fehlt');
      assert.equal(e[f].length, e.fys.length, tk + ': ' + f + ' liegt nicht auf der fys-Achse');
      for (const s of e[f]) {
        assert.ok(s && typeof s === 'object' && 'value' in s, tk + ': ' + f + ' braucht {value}-Objekte');
        assert.ok(s.value === null || Number.isFinite(s.value), tk + ': ' + f + ' nur Zahl oder null');
      }
    }
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

test('Altbestand bleibt erhalten: ein zweiter Lauf ueberschreibt keine fremden Namen', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cnannual-'));
  const out = path.join(dir, 'cn-secannual.json');
  fs.writeFileSync(out, JSON.stringify({ 'FREMD.SS': { source: 'alt', fys: [2024] } }));
  await B.main({ fetchJson: fakeQuelle(FIX), out, aTickers: ['688256.SS'], hkTickers: [] });
  const store = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.ok(store['FREMD.SS'], 'der Altbestand wurde weggeschrieben');
  assert.ok(store['688256.SS'], 'der neue Name fehlt');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('Ticker-Uebersetzung Yahoo <-> Eastmoney in beide Richtungen', () => {
  assert.equal(B.secucodeFuerYahoo('688256.SS'), '688256.SH');
  assert.equal(B.secucodeFuerYahoo('300308.SZ'), '300308.SZ');
  assert.equal(B.secucodeFuerYahoo('9992.HK'), '09992.HK');
  assert.equal(B.secucodeFuerYahoo('0666.HK'), '00666.HK');
  assert.equal(B.yahooFuerSecucode('688256.SH'), '688256.SS');
  assert.equal(B.yahooFuerSecucode('09992.HK'), '9992.HK');
  assert.equal(B.yahooFuerSecucode('00666.HK'), '0666.HK');
});

// ---------------------------------------------------------------------------------------
(async () => {
  for (const [name, fn] of faelle) {
    try { await fn(); pass += 1; console.log('  ok   ' + name); }
    catch (e) { fail += 1; console.error('FAIL   ' + name + '\n       ' + (e && e.message)); }
  }
  console.log('\ncn-jahresreihen.test.js: ' + pass + ' ok, ' + fail + ' fail');
  process.exit(fail ? 1 : 0);
})();

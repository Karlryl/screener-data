'use strict';
/**
 * build-cnannual.js — OFFLINE-Generator fuer China A (Festland) und Hongkong.
 * ==========================================================================
 * Zieht die Jahresreihen aus dem Eastmoney-Datacenter (F10, ohne Schluessel) und schreibt
 * external-data/cn-secannual.json im secAnnual-Format, das run-screener.js liest
 * (SECANNUAL_FILES; Schluessel = Yahoo-Ticker wie 688256.SS / 300308.SZ / 9992.HK).
 *
 * QUELLE UND IHR CHARAKTER: Eastmoney ist KEIN Amt und hat keinen veroeffentlichten Vertrag.
 * Der Kanal kann sich unangekuendigt aendern. Karl-Entscheid 19.08.2026: "voll nutzen wie jede
 * andere Quelle". Die Konsequenz steht im Code, nicht im Kommentar:
 *   - Es werden IMMER explizite `columns=` angefordert, nie `columns=ALL`. Live geprueft:
 *     eine unbekannte Spalte beantwortet die Quelle mit `success:false,
 *     "<SPALTE>返回字段不存在"` — eine umbenannte Spalte wird damit zum LAUTEN Fehler.
 *     Mit `columns=ALL` waere dieselbe Umbenennung ein stilles `undefined` -> Nullen.
 *   - Zusaetzlich prueft pruefeSchema() jede Zeile gegen die angeforderte Spaltenliste
 *     (Anwesenheit UND Typ), und der Antwort-Umschlag wird auf success/Array/Vollstaendigkeit
 *     geprueft. Ein abgeschnittener Batch (count > pageSize) bricht ab statt halb zu liefern.
 *   - Schonende Abrufrate ueber lib/fetch-retry.js (Pause je Host), Batches von 10 Tickern.
 *
 * =======================================================================================
 *  FALLE 1 — QUARTALSZAHLEN SIND KUMULIERT (YTD), IN BEIDEN MAERKTEN
 * =======================================================================================
 * Live gemessen an 688256.SS (Cambricon), Geschaeftsjahr 2025, Umsatz in CNY:
 *     31.03.  1.111.398.926,80      (Q1)
 *     30.06.  2.880.643.471,09      (Q1+Q2)
 *     30.09.  4.607.424.363,66      (Q1..Q3)
 *     31.12.  6.497.196.198,68      (Jahr)
 * Wer die 30.09.-Zeile als "drittes Quartal" liest, liegt um Faktor 2,7 daneben; das echte
 * Q3 sind 1.726.780.892,57. dekumuliere() rechnet das um und ist die Grundlage der Waechter.
 *
 * FUER DIE JAHRESREIHE HEISST DAS: der Jahreswert ist die 12-31-Zeile DIREKT (sie IST schon
 * das ganze Jahr), niemals die Summe der vier Zeilen — summiert waere Cambricons FY2025
 * 15.096.663.960,23 statt 6.497.196.198,68, also 2,3x zu hoch. Und ein angebrochenes Jahr
 * (2026 hat nur Q1/H1) darf NIE als Jahr durchgehen.
 * Genau deshalb haengt alles an der Konvention — dreht die Quelle still auf quartalsdiskret,
 * waere die 12-31-Zeile nur noch das vierte Quartal und JEDER Jahreswert ~3x zu niedrig.
 * Darum wird die Konvention bei JEDEM Lauf an den geholten Daten neu belegt:
 *   A-Aktien  (a) Umsatz faellt innerhalb eines Jahres nie   -> pruefeYtdA, GuV-Teil
 *             (b) BEGIN_CASH ist innerhalb eines Jahres konstant (jede Zeile startet am
 *                 01.01.) statt gleich dem Vorquartals-END_CASH -> pruefeYtdA, Cashflow-Teil.
 *                 Gemessen an 688256.SS 2025: Halbjahr und Jahr melden beide
 *                 BEGIN_CASH 1.971.973.830,69, waehrend END_CASH(Halbjahr) 1.938.967.108,51
 *                 ist — die beiden Faelle sind trennscharf.
 *   Hongkong  START_DATE ist der Anfang des GESCHAEFTSJAHRES, nicht des Quartals. Live an
 *             03308.HK: das Q1 2026 traegt START_DATE 2026-01-01, nicht 2026-01-01..03-31 als
 *             Quartalsfenster. Ein Jahresabschluss muss ~12 Monate umspannen; tut er das nicht,
 *             ist er kein Jahr mehr -> Abbruch. Das ist der direkteste Beleg von allen.
 *
 * =======================================================================================
 *  FALLE 2 — A+H-DOPPELLISTUNG: IMMER DIE A-SEITE
 * =======================================================================================
 * 03308.HK und 300308.SZ sind DIESELBE Firma (Innolight/中际旭创). Die H-Seite hat 3 Jahres-
 * perioden, die A-Seite 64 Perioden zurueck bis 2008. Ueber den HK-Code zu ziehen kostet
 * 15 Jahre Historie. Der Zusammenhang wird nicht geraten: Eastmoney fuehrt beide Listings unter
 * demselben ORG_CODE (10196554), und der A-Endpunkt laesst sich nach ORG_CODE filtern.
 * ⚠ ABER: die ORG_CODE-Suche liefert auch PHANTOM-Codes. Gemessen an unserer Liste kamen
 * `A20211.SZ` (06181.HK), `A22361.SZ`, `A23216.SH`, `A22400.SZ`, `A16324.SH` zurueck — das sind
 * Platzhalter fuer nicht (mehr) gelistete A-Vorhaben, keine handelbaren Ticker. Nur ein
 * sechsstelliger Zifferncode ist eine echte A-Notierung (istEchterACode); B-Aktien (900xxx.SH,
 * 200xxx.SZ) sind ausgeschlossen, weil sie in USD/HKD notieren.
 *
 * =======================================================================================
 *  FALLE 3 — HONGKONG MISCHT VIER BILANZIERUNGSSTANDARDS
 * =======================================================================================
 * Ueber die 500 umsatzstaerksten HK-Jahresabschluesse 2025 ausgezaehlt (nicht geschaetzt):
 *   香港会计准则 HKFRS 219 · 国际会计准则 IFRS 188 · 大陆会计准则 CAS 66 ·
 *   美国会计准则 US-GAAP 20 · 国际及香港会计准则 6 · 新加坡会计准则 1
 * Der Standard kommt als Feld ACCOUNT_STANDARD mit und ist PFLICHT. Regel: eine Quelle, die
 * den Standard nicht kenntlich macht, ist schlimmer als keine Quelle — ist er nicht lesbar
 * oder unbekannt, wird fuer diese Firma NICHTS geschrieben.
 * A-Aktien tragen kein solches Feld; dort ist CAS die Rechtsgrundlage der Inlandsmeldung, und
 * das ist belegbar: derselbe Konzern meldet auf beiden Seiten verschiedene Zahlen (Falle 5).
 *
 * =======================================================================================
 *  FALLE 4 — WAEHRUNG, DIE HAERTESTE HK-FALLE (und eine Luegenspalte)
 * =======================================================================================
 * Verteilung derselben 500 Abschluesse: CNY 401 · HKD 87 · USD 12. Pop Mart (09992.HK) meldet
 * in CNY, nicht in HKD. Waehrung wird mitgefuehrt und NIE gemischt.
 *
 * ⚠ SELBST GEFUNDEN, UND ES IST SCHLIMMER ALS ERWARTET: der Kennzahlen-Bericht
 * (RPT_HKF10_FN_MAININDICATOR) ist WAEHRUNGS-UNEINHEITLICH.
 *   - Fuer Pop Mart und Innolight (CNY-Melder) stehen dort die CNY-Betraege des Abschlusses,
 *     waehrend seine Spalte CURRENCY "HKD" behauptet.
 *   - Fuer 03918.HK (金界控股, USD-Melder) steht dort 4.988.149.582,4 — der Abschluss meldet
 *     709.673.000. Faktor 7,03: das ist der HKD/USD-Kurs. Diese Zeile ist UMGERECHNET.
 * Ein Bericht, in dem manche Firmen roh und andere umgerechnet stehen, und dessen Waehrungs-
 * spalte in beiden Faellen dasselbe sagt, taugt nicht als Zahlenquelle. Wer ihn trotzdem nimmt,
 * baut den Befund vom 03.07. nach (KRW-Zaehler gegen USD-Nenner, capitalEfficiency ~1000x daneben).
 *
 * KONSEQUENZ IM CODE: alle HK-Werte kommen aus dem RECHENWERK selbst (RPT_HKF10_FN_INCOME /
 * RPT_HKF10_FN_BALANCE), das Standard, Waehrung und Betrag in derselben Zeile fuehrt. Aus dem
 * Kennzahlen-Bericht wird NUR der operative Cashflow genommen — es gibt fuer Hongkong keinen
 * Cashflow-Bericht (RPT_HKF10_FN_CASHFLOW & Varianten: "报表配置不存在"). Und er wird nur
 * uebernommen, wenn sein Umsatz derselben Periode EXAKT dem Umsatz des Rechenwerks entspricht;
 * damit ist bewiesen, dass beide in derselben Waehrung stehen. Weicht er ab (der 7,03-Fall),
 * bleibt annualOCF null — lieber ein Feld weniger als ein Feld in der falschen Waehrung.
 * Zusaetzlich wird die Reihe am WAEHRUNGS- UND STANDARD-WECHSEL abgeschnitten: nur der
 * juengste zusammenhaengende Block gleicher Waehrung und gleichen Standards kommt in die Datei.
 *
 * ⚠ ZWEITER FUND IM RECHENWERK: bei Firmen ohne ausgewiesene Umsatzkosten fuellt die Quelle
 * den Rohertrag mit dem UMSATZ auf. Live an 01208.HK (五矿资源) FY2025: 营运收入 6.218.000.000
 * und 毛利 6.218.000.000, auf den Dollar gleich — ein Bergbaukonzern mit 100 % Rohmarge waere
 * eine Sensation, es ist ein Platzhalter. Rohertrag == Umsatz wird darum verworfen (null),
 * nicht als Rekordmarge in die Marge-Achsen gelassen. Gilt fuer A und HK gleichermassen.
 *
 * =======================================================================================
 *  FALLE 5 — ROHERTRAG IST ZWISCHEN CAS UND IFRS NICHT VERGLEICHBAR
 * =======================================================================================
 * Innolight FY2025, identischer Umsatz und identisches Nettoergebnis, aber:
 *     300308.SZ (CAS)  Rohertrag 16.074.398.513,90
 *     03308.HK (IFRS)  Rohertrag 15.875.882.000      -> 1,24 % Unterschied
 * Das wird gekennzeichnet (accountingStandard je Firma), nicht geglaettet. Es ist zugleich der
 * Beleg dafuer, dass der A-Endpunkt ein EIGENES, CAS-gerechnetes Werk ist und nicht dieselbe
 * Zahl unter anderem Namen.
 *
 * =======================================================================================
 *  FALLE 6 — DIE AKTIENZAHL: EIN FAKTOR-10-FEHLER, DER STILL WAERE (selbst gefunden)
 * =======================================================================================
 * A-Aktien: SHARE_CAPITAL (股本) ist der NENNBETRAG, nicht die Stueckzahl. Der Nennwert ist
 * ueblich 1,00 CNY — aber nicht immer. Live gemessen an 601899.SH (紫金矿业) FY2025:
 *     SHARE_CAPITAL 2.658.973.314   gegen   Ergebnis/EPS = 26.552.475.787 Aktien
 * Nennwert 0,10 CNY. Wer SHARE_CAPITAL blind als Stueckzahl nimmt, liegt bei dieser Firma um
 * Faktor 10 daneben — ohne Fehler, ohne Warnung, mitten in der Verwaesserungs-Achse. Darum
 * wird der Nennwert je Firma AUS DEN DATEN bestimmt (Median von SHARE_CAPITAL / (Ergebnis/EPS)
 * ueber alle Jahre, auf einen der ueblichen Nennwerte gerundet). Passt nichts, bleibt die
 * Aktienzahl null — kein geratener Nennwert.
 * Hongkong: es gibt KEINE Aktienzahl-Reihe. ISSUED_COMMON_SHARES ist ueber ALLE Jahre
 * identisch (Pop Mart traegt fuer 2017 dieselben 1.331.779.203 wie fuer 2025, obwohl die Firma
 * erst Ende 2020 an die Boerse ging) — das ist der heutige Stand, in die Vergangenheit kopiert.
 * Auch Eigenkapital/BPS ergibt exakt dieselbe Konstante. Die einzige echte Reihe waere
 * Ergebnis/EPS, aber EPS ist auf zwei Nachkommastellen gerundet; bei kleinen EPS sind das
 * zweistellige Prozentfehler — als Verwaesserungssignal unbrauchbar. Also: HK ohne Aktienzahl,
 * ausdruecklich und begruendet, statt einer flachen Linie, die "keine Verwaesserung" behauptet.
 *
 * WAEHRUNG ROH, KEINE UMRECHNUNG — wie bei TW/KR/JP. Der secAnnual-Kanal wird von vorzeichen-
 * und verhaeltnisbasierten Signalen gelesen (cycleSeriesPair, roicStability), die waehrungs-
 * invariant sind. reportingCurrencyOriginal traegt die Waehrung mit.
 *
 * DETERMINISMUS wie build-twannual/build-krannual/build-jpannual: Netz NUR hier (offline).
 * Die committete cn-secannual.json ist die deterministische Quelle; run-screener.js liest sie
 * ohne Netz.
 */
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'external-data', 'cn-secannual.json');
const { writeFileAtomic } = require(path.join(ROOT, 'lib/atomic-write.js'));
const { readJsonExistingOrThrow, FEHLT } = require(path.join(ROOT, 'lib/read-json.js'));
const { fetchJson } = require(path.join(ROOT, 'lib/fetch-retry.js'));

const API = 'https://datacenter.eastmoney.com/securities/api/data/v1/get';
// Eine Antwortseite muss den ganzen Batch tragen — sonst waere die Seitengrenze bei
// gleichrangigen Sortierschluesseln eine stille Verlustquelle. count > PAGE_SIZE -> Abbruch.
const PAGE_SIZE = 2000;
const BATCH = 10;              // Ticker je Abruf; 10 x 64 Perioden bleibt weit unter PAGE_SIZE
const PAUSE_MS = 1500;         // schonender als der lib-Standard (1200) — inoffizieller Kanal
const MIN_JAHRE = 3;           // wie TW/KR/JP: weniger ist keine Reihe

// ---------------------------------------------------------------------------------------
// Ticker-Listen. Bewusst EXPLIZIT (wie build-twannual), nicht aus board-history abgeleitet:
// der Board-Stand aendert sich taeglich, der Generator soll deterministisch bleiben.
// Quelle: board-history/2026-08-19, die 60 bestbewerteten Festland- und 40 bestbewerteten
// Hongkong-Namen ueber alle Branchen. Erweiterbar.
// ---------------------------------------------------------------------------------------
const CN_A = [
  '301358.SZ', '688256.SS', '688257.SS', '688110.SS', '688443.SS', '002558.SZ', '688062.SS',
  '603061.SS', '301603.SZ', '002487.SZ', '300972.SZ', '301717.SZ', '300573.SZ', '688627.SS',
  '300308.SZ', '301345.SZ', '002842.SZ', '688692.SS', '301128.SZ', '300438.SZ', '688416.SS',
  '002192.SZ', '688155.SS', '301568.SZ', '300073.SZ', '603045.SS', '000899.SZ', '603486.SS',
  '688275.SS', '600961.SS', '688411.SS', '688428.SS', '301338.SZ', '603985.SS', '688578.SS',
  '688309.SS', '002256.SZ', '600064.SS', '605499.SS', '688778.SS', '002709.SZ', '300443.SZ',
  '001337.SZ', '002997.SZ', '300502.SZ', '300475.SZ', '301265.SZ', '603991.SS', '605599.SS',
  '002460.SZ', '688535.SS', '002314.SZ', '301607.SZ', '301310.SZ', '002653.SZ', '300604.SZ',
  '605016.SS', '001389.SZ', '301232.SZ', '301377.SZ',
];
const CN_HK = [
  '1530.HK', '1585.HK', '9633.HK', '9992.HK', '1318.HK', '2228.HK', '3308.HK', '1081.HK',
  '2097.HK', '6181.HK', '7666.HK', '3317.HK', '3939.HK', '6656.HK', '2589.HK', '1208.HK',
  '1548.HK', '3931.HK', '1377.HK', '6887.HK', '1735.HK', '2162.HK', '2359.HK', '3918.HK',
  '1357.HK', '1729.HK', '1768.HK', '3750.HK', '6880.HK', '9630.HK', '1929.HK', '6618.HK',
  '2269.HK', '0668.HK', '9863.HK', '0666.HK', '3355.HK', '2476.HK', '3277.HK', '3986.HK',
];

// ---------------------------------------------------------------------------------------
// Ticker-Uebersetzung Yahoo <-> Eastmoney.
// Yahoo: 688256.SS (Shanghai) · 300308.SZ (Shenzhen) · 9992.HK / 0666.HK (Hongkong, 4-stellig)
// Eastmoney: 688256.SH · 300308.SZ · 09992.HK / 00666.HK (Hongkong, 5-stellig)
// ---------------------------------------------------------------------------------------
function secucodeFuerYahoo(tk) {
  if (/\.SS$/.test(tk)) return tk.replace(/\.SS$/, '.SH');
  if (/\.SZ$/.test(tk)) return tk;
  if (/\.HK$/.test(tk)) return tk.replace(/\.HK$/, '').padStart(5, '0') + '.HK';
  throw new Error('unbekannte Ticker-Endung: ' + tk);
}
function yahooFuerSecucode(sec) {
  if (/\.SH$/.test(sec)) return sec.replace(/\.SH$/, '.SS');
  if (/\.SZ$/.test(sec)) return sec;
  if (/\.HK$/.test(sec)) return String(Number(sec.replace(/\.HK$/, ''))).padStart(4, '0') + '.HK';
  throw new Error('unbekannte Secucode-Endung: ' + sec);
}
/** Echte, handelbare A-Notierung: sechs Ziffern. `A20211.SZ` ist ein Phantom (siehe Falle 2). */
function istEchterACode(sec) {
  if (!/^\d{6}\.(SH|SZ)$/.test(sec)) return false;
  // B-Aktien notieren in USD (900xxx.SH) bzw. HKD (200xxx.SZ) — anderer Waehrungsraum.
  if (/^900\d{3}\.SH$/.test(sec) || /^200\d{3}\.SZ$/.test(sec)) return false;
  return true;
}

// ---------------------------------------------------------------------------------------
// Spaltenlisten. IMMER explizit anfordern (siehe Kopf) — eine umbenannte Spalte wird dadurch
// zum lauten Quellenfehler statt zu stillen Nullen.
// ---------------------------------------------------------------------------------------
const A_INC = ['SECUCODE', 'ORG_CODE', 'SECURITY_NAME_ABBR', 'REPORT_DATE', 'REPORT_TYPE', 'CURRENCY',
  'TOTAL_OPERATE_INCOME', 'OPERATE_COST', 'OPERATE_PROFIT', 'PARENT_NETPROFIT', 'BASIC_EPS'];
const A_BAL = ['SECUCODE', 'REPORT_DATE', 'REPORT_TYPE', 'CURRENCY',
  'TOTAL_ASSETS', 'TOTAL_PARENT_EQUITY', 'TOTAL_CURRENT_LIAB', 'SHARE_CAPITAL'];
const A_CF = ['SECUCODE', 'REPORT_DATE', 'REPORT_TYPE', 'CURRENCY',
  'NETCASH_OPERATE', 'BEGIN_CASH', 'END_CASH'];
// Kennzahlen-Bericht: NUR fuer den operativen Cashflow (es gibt keinen HK-Cashflow-Bericht) und
// als YTD-Beleg ueber START_DATE. OPERATE_INCOME dient ausschliesslich der Waehrungs-Gegenprobe.
// CURRENCY wird bewusst NICHT angefordert — die Spalte ist unzuverlaessig (siehe Falle 4).
const HK_MAIN = ['SECUCODE', 'ORG_CODE', 'SECURITY_NAME_ABBR', 'REPORT_DATE', 'START_DATE',
  'DATE_TYPE_CODE', 'FISCAL_YEAR', 'OPERATE_INCOME', 'NETCASH_OPERATE', 'ISSUED_COMMON_SHARES'];
const HK_INC = ['SECUCODE', 'REPORT_DATE', 'DATE_TYPE_CODE', 'STD_ITEM_CODE', 'ITEM_NAME',
  'ACCOUNT_STANDARD', 'CURRENCY_CODE', 'AMOUNT'];
const HK_BAL = ['SECUCODE', 'REPORT_DATE', 'DATE_TYPE_CODE', 'STD_ITEM_CODE', 'ITEM_NAME',
  'ACCOUNT_STANDARD', 'CURRENCY_CODE', 'AMOUNT'];

// Spalten, die eine Zahl oder null sein MUESSEN. Kommt hier ein String an ("1,234"), waere das
// ein stiller NaN weiter unten.
const ZAHL_SPALTEN = new Set([
  'TOTAL_OPERATE_INCOME', 'OPERATE_COST', 'OPERATE_PROFIT', 'PARENT_NETPROFIT', 'BASIC_EPS',
  'TOTAL_ASSETS', 'TOTAL_PARENT_EQUITY', 'TOTAL_CURRENT_LIAB', 'SHARE_CAPITAL',
  'NETCASH_OPERATE', 'BEGIN_CASH', 'END_CASH',
  'OPERATE_INCOME', 'GROSS_PROFIT', 'HOLDER_PROFIT', 'ISSUED_COMMON_SHARES', 'AMOUNT',
]);

const JAHR_A = '年报';                 // A-Aktien: Jahresabschluss
const HK_JAHR_TYP = '001';             // Hongkong: DATE_TYPE_CODE des Jahresabschlusses
// Posten des HK-Rechenwerks. Live gegen alle vier vorkommenden Standards geprueft (IFRS/HKFRS/
// CAS/US-GAAP) und gegen CNY/HKD/USD — dieselben Codes tragen ueberall dieselbe Bedeutung.
const HK_INC_ITEMS = {
  annualRev: '004001999',        // 营运收入
  annualGrossProfit: '004007999', // 毛利
  annualOpInc: '004010999',       // 经营溢利
  annualNetIncome: '004025002',   // 股东应占溢利 — Ergebnis der Anteilseigner, ohne Minderheiten
};
const HK_BAL_ITEMS = {
  annualAssets: '004009999',              // 总资产
  annualEquity: '004030999',              // 股东权益 — Eigenkapital der Anteilseigner
  annualCurrentLiabilities: '004011999',  // 流动负债合计
};

// Bilanzierungsstandard: Rohwert der Quelle -> Kurzform. Eine NICHT gelistete Auspraegung
// faerbt die Firma rot (Falle 3) — nie stillschweigend durchwinken.
const STANDARD = {
  国际会计准则: 'IFRS',
  香港会计准则: 'HKFRS',
  国际及香港会计准则: 'IFRS+HKFRS',
  大陆会计准则: 'CAS',
  美国会计准则: 'US-GAAP',
  新加坡会计准则: 'SG-GAAP',
};
// Uebliche A-Aktien-Nennwerte in CNY. Was zu keinem davon passt, bekommt keine Aktienzahl.
const NENNWERTE = [1, 0.5, 0.2, 0.1];
const NENNWERT_TOLERANZ = 0.15;

const FELD_NAMEN = ['annualRev', 'annualGrossProfit', 'annualOpInc', 'annualNetIncome',
  'annualAssets', 'annualEquity', 'annualCurrentLiabilities', 'annualOCF', 'annualShares'];

// ---------------------------------------------------------------------------------------
// Kleinkram
// ---------------------------------------------------------------------------------------
function zahl(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
const tag = (s) => String(s || '').slice(0, 10);           // '2025-12-31 00:00:00' -> '2025-12-31'
const jahrVon = (s) => Number(String(s || '').slice(0, 4));
const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * DEKUMULIERUNG (Falle 1). Aus der YTD-Reihe eines Geschaeftsjahres die echten Perioden-
 * werte machen: [Q1, Q1+Q2, Q1..Q3, Jahr] -> [Q1, Q2, Q3, Q4].
 * Reine Funktion, exportiert, und die Grundlage der YTD-Waechter: unter YTD ist jeder
 * dekumulierte Umsatz >= 0; wird die Quelle quartalsdiskret, entstehen negative Werte.
 * Luecken (null) unterbrechen die Kette — danach ist kein Periodenwert mehr ableitbar.
 */
function dekumuliere(ytd) {
  const out = [];
  let vorher = 0, vorherGesetzt = true;
  for (const v of ytd) {
    if (!Number.isFinite(v)) { out.push(null); vorherGesetzt = false; continue; }
    out.push(vorherGesetzt ? v - vorher : null);
    vorher = v; vorherGesetzt = true;
  }
  return out;
}

/**
 * ROHERTRAGS-PLATZHALTER AUSSORTIEREN. Ein Rohertrag, der auf den Cent dem Umsatz entspricht,
 * ist kein gemessener Rohertrag, sondern ein Fuellwert der Quelle (belegt an 01208.HK FY2025:
 * 营运收入 und 毛利 beide 6.218.000.000). Als 100-%-Rohmarge liefe er direkt in gpGrowth und
 * marginTrajectory. Also null statt Rekordmarge.
 */
function rohertrag(rev, gp) {
  if (!Number.isFinite(gp)) return null;
  if (Number.isFinite(rev) && rev === gp) return null;
  return gp;
}

/**
 * SCHEMA-WAECHTER (Falle "inoffizieller Kanal"). Prueft die geparsten Zeilen gegen die
 * ANGEFORDERTE Spaltenliste: jede Spalte muss auf jeder Zeile existieren, und Zahl-Spalten
 * muessen Zahl oder null sein. Wirft — ein fehlendes Feld waere sonst `undefined` und
 * spaeter eine stille null-Reihe.
 */
function pruefeSchema(zeilen, spalten, kontext) {
  if (!Array.isArray(zeilen)) throw new Error(kontext + ': Antwort ist keine Zeilenliste');
  for (let i = 0; i < zeilen.length; i += 1) {
    const z = zeilen[i];
    if (!z || typeof z !== 'object') throw new Error(kontext + ': Zeile ' + i + ' ist kein Objekt');
    for (const sp of spalten) {
      if (!(sp in z)) {
        throw new Error(kontext + ': Spalte ' + sp + ' fehlt in der Antwort (Zeile ' + i + '). '
          + 'Der Kanal ist inoffiziell — eine verschwundene Spalte wuerde sonst als stille Null-Reihe '
          + 'durchgehen. Abbruch statt Nullen.');
      }
      if (ZAHL_SPALTEN.has(sp) && z[sp] !== null && typeof z[sp] !== 'number') {
        throw new Error(kontext + ': Spalte ' + sp + ' liefert ' + JSON.stringify(z[sp])
          + ' statt Zahl/null (Zeile ' + i + '). Ein String wuerde als NaN weiterlaufen. Abbruch.');
      }
    }
  }
  return zeilen;
}

// ---------------------------------------------------------------------------------------
// Abruf
// ---------------------------------------------------------------------------------------
function baueUrl(reportName, spalten, filter, source, sortColumn) {
  return API
    + '?reportName=' + encodeURIComponent(reportName)
    + '&columns=' + spalten.join(',')
    + '&filter=' + encodeURIComponent(filter)
    + '&pageNumber=1&pageSize=' + PAGE_SIZE
    + (sortColumn ? '&sortTypes=-1&sortColumns=' + sortColumn : '')
    + '&source=' + source + '&client=PC';
}

/**
 * Holt EINEN Bericht. Wirft bei allem, was nicht eindeutig eine vollstaendige Antwort ist.
 * `success:false` mit "返回数据为空" (Code 9201) ist KEIN Fehler, sondern "zu diesem Filter
 * gibt es nichts" — das kommt bei jungen Firmen und bei Bilanzposten vor, die eine Branche
 * nicht fuehrt, und liefert eine leere Liste.
 */
async function holeBericht(reportName, spalten, filter, source, sortColumn, holen) {
  const url = baueUrl(reportName, spalten, filter, source, sortColumn);
  const j = await holen(url, { pauseMs: PAUSE_MS });
  if (!j || typeof j !== 'object') throw new Error(reportName + ': Antwort ist kein Objekt');
  if (j.success !== true) {
    if (j.code === 9201) return [];   // leerer Treffer, kein Fehler
    throw new Error(reportName + ': Quelle meldet Fehler (code=' + j.code + ', message='
      + JSON.stringify(j.message) + '). Bei einer umbenannten Spalte steht der Spaltenname in '
      + 'der Meldung — dann ist das Schema gewandert.');
  }
  const r = j.result;
  if (!r || !Array.isArray(r.data)) throw new Error(reportName + ': result.data fehlt oder ist kein Array');
  if (Number.isFinite(r.count) && r.count > PAGE_SIZE) {
    throw new Error(reportName + ': ' + r.count + ' Zeilen > pageSize ' + PAGE_SIZE
      + ' — der Batch waere abgeschnitten worden. BATCH verkleinern statt halbe Reihen zu schreiben.');
  }
  if (Number.isFinite(r.count) && r.data.length !== r.count) {
    throw new Error(reportName + ': Quelle meldet count=' + r.count + ', liefert aber '
      + r.data.length + ' Zeilen — unvollstaendige Antwort, Abbruch.');
  }
  return pruefeSchema(r.data, spalten, reportName);
}

const inFilter = (feld, werte) => '(' + feld + ' in (' + werte.map((w) => '"' + w + '"').join(',') + '))';
const gruppiere = (zeilen, feld) => {
  const m = new Map();
  for (const z of zeilen) {
    if (!m.has(z[feld])) m.set(z[feld], []);
    m.get(z[feld]).push(z);
  }
  return m;
};
const stuecke = (arr, n) => {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
};

// =======================================================================================
//  A-AKTIEN
// =======================================================================================

/**
 * WAECHTER DER YTD-KONVENTION, A-Seite. Zwei unabhaengige Belege, beide an den tatsaechlich
 * geholten Zeilen (nicht an einer Behauptung im Kommentar).
 *
 * (a) GuV: unter YTD kann der Umsatz innerhalb eines Geschaeftsjahres nie fallen — jeder
 *     dekumulierte Quartalsumsatz ist >= 0. Wird die Quelle quartalsdiskret, faellt die Reihe
 *     regelmaessig (Cambricon 2025 waere diskret 1.111 / 1.769 / 1.727 / 1.890 Mio.), und die
 *     12-31-Zeile ist dann nur noch ein Viertel des Jahres.
 * (b) Cashflow: unter YTD startet JEDE Zeile am 01.01., also ist BEGIN_CASH innerhalb eines
 *     Jahres konstant. Unter diskreten Perioden waere BEGIN_CASH der naechsten Periode gleich
 *     END_CASH der vorherigen. Beides gleichzeitig geht nur bei einer Nullperiode -> trennscharf.
 *     (A-Aktien fuellen BEGIN_CASH nur im Halbjahr und im Jahr — ein Paar je Jahr, ueber die
 *     Historie also reichlich.)
 * Beide Teile verlangen eine MINDEST-Beweislast; ohne Belege wird nicht vermutet, sondern
 * geworfen.
 */
function pruefeYtdA(tk, incZeilen, cfZeilen) {
  // (a) GuV
  const proJahr = new Map();
  for (const z of incZeilen) {
    const fy = jahrVon(z.REPORT_DATE);
    if (!Number.isFinite(fy)) continue;
    if (!proJahr.has(fy)) proJahr.set(fy, []);
    proJahr.get(fy).push(z);
  }
  let guPaare = 0;
  const guVerstoesse = [];
  for (const [fy, zs] of proJahr) {
    const sortiert = [...zs].sort((a, b) => tag(a.REPORT_DATE).localeCompare(tag(b.REPORT_DATE)));
    const werte = sortiert.map((z) => zahl(z.TOTAL_OPERATE_INCOME));
    const diskret = dekumuliere(werte);
    for (let i = 1; i < diskret.length; i += 1) {
      if (!Number.isFinite(diskret[i]) || !Number.isFinite(werte[i - 1])) continue;
      guPaare += 1;
      if (diskret[i] < 0) {
        guVerstoesse.push(fy + '/' + tag(sortiert[i].REPORT_DATE) + ': ' + werte[i]
          + ' nach ' + werte[i - 1]);
      }
    }
  }
  if (guPaare < 3) {
    throw new Error(tk + ': YTD-Konvention der GuV NICHT pruefbar — nur ' + guPaare
      + ' aufeinanderfolgende Perioden im Jahr (mind. 3 noetig). Ohne Beleg waere der Jahreswert '
      + 'geraten statt belegt.');
  }
  if (guVerstoesse.length) {
    throw new Error(tk + ': YTD-Konvention der GuV verletzt — der aufgelaufene Umsatz FAELLT in '
      + guVerstoesse.length + ' Faellen innerhalb des Jahres (' + guVerstoesse.slice(0, 3).join(' · ')
      + '). Der Adapter nimmt die 12-31-Zeile als ganzes Jahr; bei quartalsdiskreten Zeilen waere '
      + 'jeder Jahreswert nur ein Quartal, also rund 3x zu niedrig. Abbruch statt stiller Fehlzahl.');
  }

  // (b) Cashflow
  const cfProJahr = new Map();
  for (const z of cfZeilen) {
    const fy = jahrVon(z.REPORT_DATE);
    if (!Number.isFinite(fy)) continue;
    if (!cfProJahr.has(fy)) cfProJahr.set(fy, []);
    cfProJahr.get(fy).push(z);
  }
  let cfPaare = 0, ytdTreffer = 0, diskretTreffer = 0;
  for (const [, zs] of cfProJahr) {
    const sortiert = [...zs]
      .filter((z) => Number.isFinite(zahl(z.BEGIN_CASH)) && Number.isFinite(zahl(z.END_CASH)))
      .sort((a, b) => tag(a.REPORT_DATE).localeCompare(tag(b.REPORT_DATE)));
    for (let i = 1; i < sortiert.length; i += 1) {
      const aAnfang = zahl(sortiert[i - 1].BEGIN_CASH);
      const aEnde = zahl(sortiert[i - 1].END_CASH);
      const bAnfang = zahl(sortiert[i].BEGIN_CASH);
      cfPaare += 1;
      if (bAnfang === aAnfang) ytdTreffer += 1;
      if (bAnfang === aEnde) diskretTreffer += 1;
    }
  }
  if (cfPaare < 3) {
    throw new Error(tk + ': YTD-Konvention des Cashflows NICHT pruefbar — nur ' + cfPaare
      + ' Perioden-Paare mit Kassen-Anfangs-/Endbestand (mind. 3 noetig). Der Adapter nimmt die '
      + '12-31-Zeile als Jahres-Cashflow; ohne diesen Anker waere das geraten.');
  }
  if (!(ytdTreffer > diskretTreffer && ytdTreffer >= cfPaare * 0.6)) {
    throw new Error(tk + ': YTD-Konvention des Cashflows verletzt — von ' + cfPaare
      + ' Paaren sprechen nur ' + ytdTreffer + ' fuer YTD, aber ' + diskretTreffer
      + ' fuer periodendiskret. Bei diskreten Zeilen waere der Jahres-Cashflow um bis zu Faktor 4 '
      + 'zu niedrig. Abbruch statt stiller Fehlzahl.');
  }
  return { guPaare, cfPaare, ytdTreffer, diskretTreffer };
}

/**
 * NENNWERT AUS DEN DATEN (Falle 6). SHARE_CAPITAL ist ein Nennbetrag; die Stueckzahl ergibt
 * sich erst durch den Nennwert. Referenz ist die aus dem Ergebnis je Aktie implizierte
 * Stueckzahl (Ergebnis der Mutter / EPS) — sie ist ein gewichteter Jahresdurchschnitt und damit
 * ungenau, aber der Abstand zwischen 1,00 und 0,10 ist Faktor 10 und dadurch trennscharf.
 * Median ueber alle brauchbaren Jahre, damit ein einzelnes Kapitalerhoehungsjahr nichts kippt.
 * @returns {number|null} Nennwert in CNY oder null (dann wird KEINE Aktienzahl geschrieben)
 */
function nennwertAusDaten(jahresIncZeilen, kapitalJeFy) {
  const quotienten = [];
  for (const z of jahresIncZeilen) {
    const fy = jahrVon(z.REPORT_DATE);
    const kap = kapitalJeFy.get(fy);
    const ni = zahl(z.PARENT_NETPROFIT);
    const eps = zahl(z.BASIC_EPS);
    if (!Number.isFinite(kap) || kap <= 0 || !Number.isFinite(ni) || !Number.isFinite(eps) || eps === 0) continue;
    const implizit = ni / eps;
    if (!(implizit > 0)) continue;   // Vorzeichen-Mischmasch (EPS auf 0,00 gerundet) -> unbrauchbar
    quotienten.push(kap / implizit);
  }
  if (!quotienten.length) return null;
  const med = median(quotienten);
  for (const n of NENNWERTE) if (Math.abs(med - n) / n <= NENNWERT_TOLERANZ) return n;
  return null;
}

/**
 * Baut die Jahresreihen EINER A-Firma. Reine Funktion — testbar ohne Netz.
 * @param {{inc:object[], bal:object[], cf:object[]}} roh  Zeilen NUR dieser Firma
 * @param {string} tk  Yahoo-Ticker, fuer Fehlermeldungen
 */
function bauAJahre(roh, tk) {
  const waechter = pruefeYtdA(tk, roh.inc, roh.cf);

  const istJahr = (z) => z.REPORT_TYPE === JAHR_A && /-12-31$/.test(tag(z.REPORT_DATE));
  const jahresInc = roh.inc.filter(istJahr).sort((a, b) => tag(b.REPORT_DATE).localeCompare(tag(a.REPORT_DATE)));
  if (!jahresInc.length) throw new Error(tk + ': keine Jahresabschluss-Zeile (REPORT_TYPE ' + JAHR_A + ') im Feed');

  // WAEHRUNGS-REGIME (Falle 4): nur der juengste zusammenhaengende Block gleicher Waehrung.
  // Ein Waehrungswechsel mitten in der Reihe waere sonst ein erfundener Wachstumssprung.
  const leitWaehrung = jahresInc[0].CURRENCY;
  if (!leitWaehrung) throw new Error(tk + ': keine Berichtswaehrung im juengsten Jahresabschluss — '
    + 'ohne Waehrung wird kein Wert geschrieben.');
  const behalten = [];
  for (const z of jahresInc) {
    if (z.CURRENCY !== leitWaehrung) break;
    behalten.push(z);
  }
  const abgeschnitten = jahresInc.length - behalten.length;

  const fys = behalten.map((z) => jahrVon(z.REPORT_DATE));
  const balJeFy = new Map();
  for (const z of roh.bal) {
    if (z.REPORT_TYPE !== JAHR_A || !/-12-31$/.test(tag(z.REPORT_DATE))) continue;
    if (z.CURRENCY !== leitWaehrung) continue;
    balJeFy.set(jahrVon(z.REPORT_DATE), z);
  }
  const cfJeFy = new Map();
  for (const z of roh.cf) {
    if (z.REPORT_TYPE !== JAHR_A || !/-12-31$/.test(tag(z.REPORT_DATE))) continue;
    if (z.CURRENCY !== leitWaehrung) continue;
    cfJeFy.set(jahrVon(z.REPORT_DATE), z);
  }

  const kapitalJeFy = new Map();
  for (const [fy, z] of balJeFy) {
    const k = zahl(z.SHARE_CAPITAL);
    if (Number.isFinite(k)) kapitalJeFy.set(fy, k);
  }
  const nennwert = nennwertAusDaten(behalten, kapitalJeFy);

  const serien = {};
  for (const f of FELD_NAMEN) serien[f] = [];
  for (let i = 0; i < behalten.length; i += 1) {
    const fy = fys[i];
    const inc = behalten[i];
    const bal = balJeFy.get(fy) || null;
    const cf = cfJeFy.get(fy) || null;
    const rev = zahl(inc.TOTAL_OPERATE_INCOME);
    const kosten = zahl(inc.OPERATE_COST);
    const kap = bal ? zahl(bal.SHARE_CAPITAL) : null;
    serien.annualRev.push({ value: rev });
    // Rohertrag ist im CAS-Werk nicht ausgewiesen, sondern Umsatz minus Umsatzkosten.
    // Fehlt eines von beiden, bleibt er null — nie eine Haelfte der Rechnung.
    serien.annualGrossProfit.push({ value: rohertrag(rev, (Number.isFinite(rev) && Number.isFinite(kosten)) ? rev - kosten : null) });
    serien.annualOpInc.push({ value: zahl(inc.OPERATE_PROFIT) });
    serien.annualNetIncome.push({ value: zahl(inc.PARENT_NETPROFIT) });
    serien.annualAssets.push({ value: bal ? zahl(bal.TOTAL_ASSETS) : null });
    serien.annualEquity.push({ value: bal ? zahl(bal.TOTAL_PARENT_EQUITY) : null });
    serien.annualCurrentLiabilities.push({ value: bal ? zahl(bal.TOTAL_CURRENT_LIAB) : null });
    serien.annualOCF.push({ value: cf ? zahl(cf.NETCASH_OPERATE) : null });
    serien.annualShares.push({ value: (nennwert && Number.isFinite(kap)) ? kap / nennwert : null });
  }

  return Object.assign({
    fys,
    standard: 'CAS',
    waehrung: leitWaehrung,
    nennwert,
    abgeschnitten,
    _waechter: waechter,
  }, serien);
}

// =======================================================================================
//  HONGKONG
// =======================================================================================

/**
 * WAECHTER DER YTD-KONVENTION, HK-Seite — und zugleich der Beweis, dass ein "Jahresabschluss"
 * wirklich ein Jahr umspannt. START_DATE ist der Anfang des GESCHAEFTSJAHRES, nicht der Anfang
 * der Periode: 03308.HK meldet fuer das erste Quartal 2026 START_DATE 2026-01-01. Stellt die
 * Quelle auf periodendiskrete Zeilen um, wandert START_DATE mit — und der Jahresabschluss
 * umspannt ploetzlich sechs Monate statt zwoelf.
 * Geprueft wird an den Zeilen, die als Jahresabschluss gelten (DATE_TYPE_CODE=001): die Spanne
 * START_DATE..REPORT_DATE muss zwischen 330 und 400 Tagen liegen (Geschaeftsjahre sind nicht
 * exakt 365 Tage, aber nie ein Halbjahr).
 */
const TAG_MS = 24 * 3600 * 1000;
const JAHR_SPANNE_MIN = 330;
const JAHR_SPANNE_MAX = 400;
function spanneTage(start, ende) {
  const a = Date.parse(tag(start) + 'T00:00:00Z');
  const b = Date.parse(tag(ende) + 'T00:00:00Z');
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / TAG_MS) + 1;   // inklusive beider Randtage
}
function pruefeYtdHk(tk, zeilen) {
  let geprueft = 0;
  const verstoesse = [];
  const jahresStarts = new Set();     // Monat-Tag der Geschaeftsjahres-Anfaenge
  for (const z of zeilen) {
    if (z.DATE_TYPE_CODE !== HK_JAHR_TYP) continue;
    const sp = spanneTage(z.START_DATE, z.REPORT_DATE);
    if (sp == null) {
      verstoesse.push(tag(z.REPORT_DATE) + ': START_DATE ' + JSON.stringify(z.START_DATE) + ' unlesbar');
      continue;
    }
    geprueft += 1;
    jahresStarts.add(tag(z.START_DATE).slice(5));
    if (sp < JAHR_SPANNE_MIN || sp > JAHR_SPANNE_MAX) {
      verstoesse.push(tag(z.START_DATE) + '..' + tag(z.REPORT_DATE) + ' = ' + sp + ' Tage');
    }
  }
  if (!geprueft) {
    throw new Error(tk + ': keine als Jahresabschluss gefuehrte Periode (DATE_TYPE_CODE='
      + HK_JAHR_TYP + ') mit lesbarem START_DATE — ohne diesen Beleg ist nicht entscheidbar, '
      + 'welche Zeile ein ganzes Jahr ist.');
  }
  // Zweiter, unabhaengiger Beleg AUS DEN ZWISCHENBERICHTEN: unter YTD startet auch ein
  // Quartals-/Halbjahresbericht am Anfang des GESCHAEFTSJAHRES (03308.HK meldet fuer das erste
  // Quartal 2026 START_DATE 2026-01-01). Waeren die Perioden diskret, stuende dort der
  // Quartalsanfang (07-01 fuer Q3) — und die Jahreszeile waere nur noch das Schlussquartal.
  let zwischen = 0;
  for (const z of zeilen) {
    if (z.DATE_TYPE_CODE === HK_JAHR_TYP) continue;
    const md = tag(z.START_DATE).slice(5);
    if (!md) continue;
    zwischen += 1;
    if (!jahresStarts.has(md)) {
      verstoesse.push('Zwischenbericht ' + tag(z.REPORT_DATE) + ' startet ' + md
        + ' statt am Geschaeftsjahres-Anfang (' + [...jahresStarts].join('/') + ')');
    }
  }
  if (verstoesse.length) {
    throw new Error(tk + ': YTD-Konvention verletzt — ' + verstoesse.slice(0, 3).join(' · ')
      + (verstoesse.length > 3 ? ' (+' + (verstoesse.length - 3) + ' weitere)' : '')
      + '. Die Quelle liefert aufgelaufene (YTD) Perioden; stellt sie auf periodendiskrete um, '
      + 'waere jeder "Jahres"-Wert nur ein Teil des Jahres. Abbruch statt stiller Fehlzahl.');
  }
  return { jahresPerioden: geprueft, zwischenPerioden: zwischen };
}

/**
 * Baut die Jahresreihen EINER HK-Firma. Reine Funktion — testbar ohne Netz.
 *
 * ALLE WERTE AUS DEM RECHENWERK, weil dort Standard, Waehrung und Betrag in DERSELBEN Zeile
 * stehen. Aus dem Kennzahlen-Bericht kommt nur der operative Cashflow (es gibt keinen HK-
 * Cashflow-Bericht) — und nur, wenn dessen Umsatz derselben Periode exakt dem Umsatz des
 * Rechenwerks entspricht. Diese Gleichheit ist der Beweis, dass beide dieselbe Waehrung
 * fuehren; bei 03918.HK (USD-Melder) unterscheiden sie sich um Faktor 7,03 (Falle 4).
 *
 * @param {{main:object[], inc:object[], bal:object[]}} roh  Zeilen NUR dieser Firma
 * @param {string} tk  Yahoo-Ticker
 */
function bauHkJahre(roh, tk) {
  const waechter = pruefeYtdHk(tk, roh.main);

  // Rechenwerk-Zeilen nach Stichtag und Posten aufschluesseln. Zwei verschiedene Werte fuer
  // denselben Stichtag UND denselben Posten sind nicht entscheidbar -> Wurf (wie TW/JP).
  const posten = new Map();      // 'YYYY-MM-DD' -> {STD_ITEM_CODE -> AMOUNT}
  const etikett = new Map();     // 'YYYY-MM-DD' -> {standardRoh, waehrung}
  const uebernehmen = (z) => {
    if (z.DATE_TYPE_CODE !== HK_JAHR_TYP) return;
    const d = tag(z.REPORT_DATE);
    if (!posten.has(d)) posten.set(d, {});
    const v = zahl(z.AMOUNT);
    const vorher = posten.get(d)[z.STD_ITEM_CODE];
    if (vorher !== undefined && v !== null && vorher !== v) {
      throw new Error(tk + ' ' + d + '/' + z.STD_ITEM_CODE + ': zwei verschiedene Werte ('
        + vorher + ' und ' + v + '). Welcher gilt, ist nicht entscheidbar — Abbruch statt '
        + 'stiller Auswahl.');
    }
    if (v !== null) posten.get(d)[z.STD_ITEM_CODE] = v;
    const std = String(z.ACCOUNT_STANDARD || '').trim();
    const ccy = String(z.CURRENCY_CODE || '').trim();
    if (!std || !ccy) return;
    const alt = etikett.get(d);
    if (alt && (alt.standardRoh !== std || alt.waehrung !== ccy)) {
      throw new Error(tk + ' ' + d + ': dieselbe Periode traegt zwei Etiketten ('
        + alt.standardRoh + '/' + alt.waehrung + ' gegen ' + std + '/' + ccy + '). '
        + 'Ein Abschluss hat genau einen Standard und eine Waehrung — Abbruch.');
    }
    if (!alt) etikett.set(d, { standardRoh: std, waehrung: ccy });
  };
  for (const z of roh.inc) uebernehmen(z);
  for (const z of roh.bal) uebernehmen(z);

  // Zeitachse: die Jahresabschluesse des Kennzahlen-Berichts (dort stehen FISCAL_YEAR und der
  // Cashflow), aber nur solche, die im Rechenwerk auch ein Etikett haben.
  const jahre = roh.main
    .filter((z) => z.DATE_TYPE_CODE === HK_JAHR_TYP)
    .sort((a, b) => tag(b.REPORT_DATE).localeCompare(tag(a.REPORT_DATE)));
  if (!jahre.length) throw new Error(tk + ': keine Jahresabschluss-Zeile im Kennzahlen-Bericht');

  const kopf = etikett.get(tag(jahre[0].REPORT_DATE));
  if (!kopf) {
    throw new Error(tk + ': zum juengsten Jahresabschluss (' + tag(jahre[0].REPORT_DATE) + ') gibt es '
      + 'keinen etikettierten Posten im Rechenwerk — damit sind Bilanzierungsstandard und Waehrung '
      + 'nicht feststellbar. Eine Quelle, die den Standard nicht kenntlich macht, ist schlimmer als '
      + 'keine Quelle: es wird nichts geschrieben. (Typisch fuer Banken/Versicherer, die den '
      + 'Standardposten nicht fuehren.)');
  }
  const standardRoh = kopf.standardRoh;
  const standard = STANDARD[standardRoh];
  if (!standard) {
    throw new Error(tk + ': unbekannter Bilanzierungsstandard ' + JSON.stringify(standardRoh)
      + '. Bekannt sind ' + Object.keys(STANDARD).join('/') + '. Ein unbekannter Standard wird nicht '
      + 'stillschweigend als "irgendein IFRS" verbucht — Abbruch.');
  }
  const waehrung = kopf.waehrung;

  // Regime-Schnitt: nur der juengste zusammenhaengende Block gleicher Waehrung UND gleichen
  // Standards. Ein Wechsel mitten in der Reihe waere ein erfundener Wachstumssprung.
  const behalten = [];
  for (const z of jahre) {
    const e = etikett.get(tag(z.REPORT_DATE));
    if (!e || e.standardRoh !== standardRoh || e.waehrung !== waehrung) break;
    behalten.push(z);
  }
  const abgeschnitten = jahre.length - behalten.length;

  // Waehrungs-Gegenprobe fuer den Cashflow (siehe Kopf). Firmenweit, nicht je Jahr: ein
  // umgerechneter Kennzahlen-Bericht ist eine Eigenschaft der Firma, nicht eines Jahres.
  let ocfBrauchbar = true, ocfGrund = null, ocfGeprueft = 0;
  for (const z of behalten) {
    const revMain = zahl(z.OPERATE_INCOME);
    const revWerk = (posten.get(tag(z.REPORT_DATE)) || {})[HK_INC_ITEMS.annualRev];
    if (!Number.isFinite(revMain) || !Number.isFinite(revWerk)) continue;
    ocfGeprueft += 1;
    if (revMain !== revWerk) {
      ocfBrauchbar = false;
      ocfGrund = 'Kennzahlen-Bericht meldet zum ' + tag(z.REPORT_DATE) + ' einen Umsatz von '
        + revMain + ', das Rechenwerk ' + revWerk + ' (Faktor '
        + (revWerk ? (revMain / revWerk).toFixed(3) : '?') + ') — der Bericht steht in einer '
        + 'anderen Waehrung als der Abschluss. Ein Cashflow in fremder Waehrung neben Umsatz und '
        + 'Bilanz in Berichtswaehrung ist genau die Mischung, die verboten ist.';
      break;
    }
  }
  if (!ocfGeprueft && behalten.length) {
    ocfBrauchbar = false;
    ocfGrund = 'die Waehrungs-Gegenprobe (Umsatz im Kennzahlen-Bericht gegen Umsatz im Rechenwerk) '
      + 'war fuer kein Jahr durchfuehrbar — ohne sie ist nicht belegt, dass der Cashflow in der '
      + 'Berichtswaehrung steht.';
  }

  const fys = behalten.map((z) => jahrVon(z.REPORT_DATE));
  const serien = {};
  for (const f of FELD_NAMEN) serien[f] = [];
  for (const z of behalten) {
    const p = posten.get(tag(z.REPORT_DATE)) || {};
    const w = (code) => (Number.isFinite(p[code]) ? p[code] : null);
    const rev = w(HK_INC_ITEMS.annualRev);
    serien.annualRev.push({ value: rev });
    serien.annualGrossProfit.push({ value: rohertrag(rev, w(HK_INC_ITEMS.annualGrossProfit)) });
    serien.annualOpInc.push({ value: w(HK_INC_ITEMS.annualOpInc) });
    serien.annualNetIncome.push({ value: w(HK_INC_ITEMS.annualNetIncome) });
    serien.annualAssets.push({ value: w(HK_BAL_ITEMS.annualAssets) });
    serien.annualEquity.push({ value: w(HK_BAL_ITEMS.annualEquity) });
    serien.annualCurrentLiabilities.push({ value: w(HK_BAL_ITEMS.annualCurrentLiabilities) });
    serien.annualOCF.push({ value: ocfBrauchbar ? zahl(z.NETCASH_OPERATE) : null });
    // Aktienzahl: bewusst NICHT (Falle 6). ISSUED_COMMON_SHARES ist der heutige Stand, in alle
    // Jahre kopiert — eine flache Linie behauptete "keine Verwaesserung".
    serien.annualShares.push({ value: null });
  }

  // Wenn die Quelle irgendwann doch eine echte Reihe liefert, soll das auffallen — aber es waere
  // eine VERBESSERUNG, kein Fehler: darum laut loggen, nicht werfen.
  const stueckzahlen = new Set(behalten.map((z) => z.ISSUED_COMMON_SHARES).filter((v) => v != null));
  if (stueckzahlen.size > 1) {
    console.log(tk + ': HINWEIS — ISSUED_COMMON_SHARES ist nicht mehr konstant ('
      + stueckzahlen.size + ' verschiedene Werte). Die Quelle koennte jetzt eine echte '
      + 'Aktienzahl-Reihe liefern; der Adapter kann dann erweitert werden.');
  }

  return Object.assign({
    fys,
    standard,
    standardRoh,
    waehrung,
    fiscalYearEnd: String(jahre[0].FISCAL_YEAR || '').trim() || null,
    abgeschnitten,
    ocfBrauchbar,
    ocfGrund,
    _waechter: waechter,
  }, serien);
}

// =======================================================================================
//  Zusammenbau
// =======================================================================================
const zaehle = (arr) => arr.filter((e) => Number.isFinite(e && e.value)).length;

async function holeABatch(secucodes, holen) {
  const f = inFilter('SECUCODE', secucodes);
  const inc = await holeBericht('RPT_F10_FINANCE_GINCOME', A_INC, f, 'HSF10', 'REPORT_DATE', holen);
  const bal = await holeBericht('RPT_F10_FINANCE_GBALANCE', A_BAL, f, 'HSF10', 'REPORT_DATE', holen);
  const cf = await holeBericht('RPT_F10_FINANCE_GCASHFLOW', A_CF, f, 'HSF10', 'REPORT_DATE', holen);
  return { inc: gruppiere(inc, 'SECUCODE'), bal: gruppiere(bal, 'SECUCODE'), cf: gruppiere(cf, 'SECUCODE') };
}

async function holeHkBatch(secucodes, holen) {
  const f = inFilter('SECUCODE', secucodes);
  // Kennzahlen-Bericht ueber ALLE Periodenarten: die Zwischenberichte sind der zweite YTD-Beleg
  // (START_DATE muss auch dort der Geschaeftsjahres-Anfang sein).
  const main = await holeBericht('RPT_HKF10_FN_MAININDICATOR', HK_MAIN, f, 'F10', 'STD_REPORT_DATE', holen);
  // Rechenwerk nur fuer Jahresabschluesse — mehr braucht die Jahresreihe nicht.
  const jahr = '(DATE_TYPE_CODE="' + HK_JAHR_TYP + '")';
  const inc = await holeBericht('RPT_HKF10_FN_INCOME', HK_INC,
    f + jahr + inFilter('STD_ITEM_CODE', Object.values(HK_INC_ITEMS)), 'F10', 'REPORT_DATE', holen);
  const bal = await holeBericht('RPT_HKF10_FN_BALANCE', HK_BAL,
    f + jahr + inFilter('STD_ITEM_CODE', Object.values(HK_BAL_ITEMS)), 'F10', 'REPORT_DATE', holen);
  return { main: gruppiere(main, 'SECUCODE'), inc: gruppiere(inc, 'SECUCODE'), bal: gruppiere(bal, 'SECUCODE') };
}

/**
 * A+H-Aufloesung (Falle 2). Sucht zu den ORG_CODEs der HK-Namen echte A-Notierungen.
 * @returns {Map<string,string>} hkSecucode -> aSecucode (nur echte, handelbare A-Codes)
 */
async function loeseAhAuf(orgJeHk, holen) {
  const paare = new Map();
  const orgs = [...new Set([...orgJeHk.values()].filter(Boolean))];
  if (!orgs.length) return paare;
  const aJeOrg = new Map();
  for (const teil of stuecke(orgs, 25)) {
    const zeilen = await holeBericht('RPT_F10_FINANCE_GINCOME',
      ['SECUCODE', 'ORG_CODE', 'REPORT_DATE', 'REPORT_TYPE'],
      inFilter('ORG_CODE', teil) + '(REPORT_TYPE="' + JAHR_A + '")', 'HSF10', 'REPORT_DATE', holen);
    for (const z of zeilen) {
      if (!istEchterACode(z.SECUCODE)) continue;   // Phantom-Codes wie A20211.SZ aussortieren
      if (!aJeOrg.has(z.ORG_CODE)) aJeOrg.set(z.ORG_CODE, z.SECUCODE);
    }
  }
  for (const [hk, org] of orgJeHk) {
    const a = aJeOrg.get(org);
    if (a) paare.set(hk, a);
  }
  return paare;
}

const GEMEINSAM = (standard, waehrung) => ({
  source: 'Eastmoney Datacenter F10 (inoffizieller Kanal, schema-gewacht)',
  accountingStandard: standard,
  consolidation: 'CFS',              // Konzernabschluss — beide Endpunkte liefern nur diesen
  reportingCurrencyOriginal: waehrung,
});

async function main(opts = {}) {
  const holen = opts.fetchJson || fetchJson;
  const outPfad = opts.out || OUT;
  const aTicker = opts.aTickers || CN_A;
  const hkTicker = opts.hkTickers || CN_HK;

  const vorher = readJsonExistingOrThrow(outPfad);
  const out = vorher === FEHLT ? {} : vorher;
  const gescheitert = [];
  const zeitStart = Date.now();

  // ---- 1) HK-Stammdaten holen (ORG_CODE fuer die A+H-Aufloesung) -----------------------
  const hkSec = hkTicker.map(secucodeFuerYahoo);
  const hkRoh = new Map();
  for (const teil of stuecke(hkSec, BATCH)) {
    let b;
    try { b = await holeHkBatch(teil, holen); }
    catch (e) {
      gescheitert.push('HK-Batch ' + teil.join(',') + ': ' + e.message);
      console.warn('HK-Batch ' + teil[0] + '…: Abruf fehlgeschlagen (' + e.message + ') -> Altbestand bleibt');
      continue;
    }
    for (const s of teil) {
      hkRoh.set(s, { main: b.main.get(s) || [], inc: b.inc.get(s) || [], bal: b.bal.get(s) || [] });
    }
  }
  const orgJeHk = new Map();
  for (const [s, r] of hkRoh) {
    const org = (r.main[0] && r.main[0].ORG_CODE) || (r.inc[0] && r.inc[0].ORG_CODE) || null;
    if (org) orgJeHk.set(s, org);
  }
  let ahPaare = new Map();
  try { ahPaare = await loeseAhAuf(orgJeHk, holen); }
  catch (e) {
    // Ohne die A+H-Aufloesung wuerden dual gelistete Namen ueber die kurze H-Historie gebaut —
    // das ist genau der Fehler, den Falle 2 beschreibt. Lieber laut abbrechen.
    throw new Error('A+H-Aufloesung fehlgeschlagen (' + e.message + '). Ohne sie wuerden dual '
      + 'gelistete Firmen ueber die kurze H-Seite gebaut (3308.HK: 3 statt 64 Perioden). Abbruch.');
  }

  // ---- 2) A-Seite: eigene Liste + die A-Zwillinge der HK-Namen -------------------------
  const aSecucodes = new Set(aTicker.map(secucodeFuerYahoo));
  for (const a of ahPaare.values()) aSecucodes.add(a);
  const aRoh = new Map();
  for (const teil of stuecke([...aSecucodes], BATCH)) {
    let b;
    try { b = await holeABatch(teil, holen); }
    catch (e) {
      gescheitert.push('A-Batch ' + teil.join(',') + ': ' + e.message);
      console.warn('A-Batch ' + teil[0] + '…: Abruf fehlgeschlagen (' + e.message + ') -> Altbestand bleibt');
      continue;
    }
    for (const s of teil) {
      aRoh.set(s, { inc: b.inc.get(s) || [], bal: b.bal.get(s) || [], cf: b.cf.get(s) || [] });
    }
  }

  // ---- 3) Schreiben -------------------------------------------------------------------
  let geschrieben = 0, periodenGesamt = 0;
  const schreibe = (tk, satz, protokoll) => {
    out[tk] = satz;
    geschrieben += 1;
    periodenGesamt += satz.fys.length;
    console.log(protokoll);
  };

  const bauA = (secucode, tk, herkunft) => {
    const roh = aRoh.get(secucode);
    if (!roh || !roh.inc.length) {
      gescheitert.push(tk + ': keine A-Daten fuer ' + secucode);
      console.warn(tk + ': keine A-Daten fuer ' + secucode + ' -> uebersprungen');
      return;
    }
    let j;
    try { j = bauAJahre(roh, tk); }
    catch (e) { gescheitert.push(tk + ': ' + e.message); console.warn(tk + ': ' + e.message); return; }
    const serien = {};
    for (const f of FELD_NAMEN) serien[f] = j[f];
    if (zaehle(serien.annualRev) < MIN_JAHRE) {
      gescheitert.push(tk + ': nur ' + zaehle(serien.annualRev) + ' Jahre Umsatz (mind. ' + MIN_JAHRE + ')');
      console.warn(tk + ': zu wenig Jahre (Umsatz=' + zaehle(serien.annualRev) + ') -> uebersprungen');
      return;
    }
    const satz = Object.assign({
      listing: 'A',
      secucode,
      orgCode: (roh.inc[0] && roh.inc[0].ORG_CODE) || null,
      name: (roh.inc[0] && roh.inc[0].SECURITY_NAME_ABBR) || null,
    }, GEMEINSAM(j.standard, j.waehrung), {
      accountingStandardQuelle: 'A-Aktien melden im Inland nach CAS (Rechtsgrundlage); belegt durch '
        + 'die gemessene Abweichung zur H-Seite desselben Konzerns (300308.SZ 16.074.398.513,90 gegen '
        + '03308.HK 15.875.882.000 Rohertrag FY2025, 1,24 %)',
      fiscalYearEnd: '12-31',
      derived: {
        annualGrossProfit: 'TOTAL_OPERATE_INCOME - OPERATE_COST (CAS weist keinen Rohertrag aus)',
        annualShares: j.nennwert
          ? 'SHARE_CAPITAL / ' + j.nennwert + ' CNY Nennwert (aus den Daten bestimmt, nicht angenommen)'
          : 'NICHT geschrieben — der Nennwert liess sich aus den Daten nicht eindeutig bestimmen',
      },
    }, herkunft || {}, {
      nfy: j.fys[0],
      generatedAt: new Date().toISOString(),
      fys: j.fys,
    }, serien);
    schreibe(tk, satz, tk + ': ' + j.fys.length + ' Jahre [A/' + j.standard + '/' + j.waehrung + ']'
      + (herkunft && herkunft.sourceListing ? ' via ' + herkunft.sourceListing : '')
      + ' — rev=' + zaehle(serien.annualRev) + ' gp=' + zaehle(serien.annualGrossProfit)
      + ' op=' + zaehle(serien.annualOpInc) + ' ni=' + zaehle(serien.annualNetIncome)
      + ' assets=' + zaehle(serien.annualAssets) + ' eq=' + zaehle(serien.annualEquity)
      + ' curliab=' + zaehle(serien.annualCurrentLiabilities) + ' ocf=' + zaehle(serien.annualOCF)
      + ' shares=' + zaehle(serien.annualShares)
      + (j.abgeschnitten ? ' (' + j.abgeschnitten + ' Jahre wegen Waehrungswechsel abgeschnitten)' : ''));
  };

  for (const tk of aTicker) bauA(secucodeFuerYahoo(tk), tk, null);

  for (const tk of hkTicker) {
    const sec = secucodeFuerYahoo(tk);
    const aZwilling = ahPaare.get(sec);
    if (aZwilling) {
      // A+H: die A-Seite gewinnt IMMER (Falle 2) — dieselbe Firma, aber die lange Historie.
      bauA(aZwilling, tk, {
        preferredListing: 'A',
        sourceListing: yahooFuerSecucode(aZwilling),
        listingNote: 'A+H-Doppellistung: die Reihe stammt von der A-Notierung ('
          + yahooFuerSecucode(aZwilling) + '), weil die H-Seite nur wenige Jahre zurueckreicht. '
          + 'Standard und Waehrung sind darum die der A-Seite (CAS/CNY), nicht die der H-Seite.',
      });
      continue;
    }
    const roh = hkRoh.get(sec);
    if (!roh || !roh.main.length) {
      gescheitert.push(tk + ': keine HK-Daten fuer ' + sec);
      console.warn(tk + ': keine HK-Daten fuer ' + sec + ' -> uebersprungen');
      continue;
    }
    let j;
    try { j = bauHkJahre(roh, tk); }
    catch (e) { gescheitert.push(tk + ': ' + e.message); console.warn(tk + ': ' + e.message); continue; }
    const serien = {};
    for (const f of FELD_NAMEN) serien[f] = j[f];
    if (zaehle(serien.annualRev) < MIN_JAHRE) {
      gescheitert.push(tk + ': nur ' + zaehle(serien.annualRev) + ' Jahre Umsatz (mind. ' + MIN_JAHRE + ')');
      console.warn(tk + ': zu wenig Jahre (Umsatz=' + zaehle(serien.annualRev) + ') -> uebersprungen');
      continue;
    }
    const satz = Object.assign({
      listing: 'HK',
      secucode: sec,
      orgCode: orgJeHk.get(sec) || null,
      name: (roh.main[0] && roh.main[0].SECURITY_NAME_ABBR) || null,
    }, GEMEINSAM(j.standard, j.waehrung), {
      accountingStandardRaw: j.standardRoh,
      accountingStandardQuelle: 'Feld ACCOUNT_STANDARD des HK-Rechenwerks (Pflichtfeld: ohne '
        + 'erkennbaren Standard wird nichts geschrieben)',
      fiscalYearEnd: j.fiscalYearEnd,
      derived: {
        annualShares: 'NICHT geschrieben — die Quelle fuehrt fuer Hongkong keine Aktienzahl-REIHE. '
          + 'ISSUED_COMMON_SHARES ist der heutige Stand, in alle Jahre kopiert (09992.HK traegt fuer '
          + '2017 dieselbe Zahl wie fuer 2025, obwohl die Firma erst Ende 2020 notiert wurde). Eine '
          + 'flache Linie behauptete "keine Verwaesserung" — das waere schlimmer als kein Wert.',
        annualOCF: j.ocfBrauchbar
          ? 'Kennzahlen-Bericht (einziger HK-Cashflow-Fundort); Waehrungsgleichheit mit dem '
            + 'Rechenwerk je Jahr ueber den Umsatz nachgewiesen'
          : 'NICHT geschrieben — ' + j.ocfGrund,
      },
    }, {
      nfy: j.fys[0],
      generatedAt: new Date().toISOString(),
      fys: j.fys,
    }, serien);
    schreibe(tk, satz, tk + ': ' + j.fys.length + ' Jahre [HK/' + j.standard + '/' + j.waehrung + ']'
      + ' — rev=' + zaehle(serien.annualRev) + ' gp=' + zaehle(serien.annualGrossProfit)
      + ' op=' + zaehle(serien.annualOpInc) + ' ni=' + zaehle(serien.annualNetIncome)
      + ' assets=' + zaehle(serien.annualAssets) + ' eq=' + zaehle(serien.annualEquity)
      + ' curliab=' + zaehle(serien.annualCurrentLiabilities) + ' ocf=' + zaehle(serien.annualOCF)
      + (j.abgeschnitten ? ' (' + j.abgeschnitten + ' Jahre wegen Standard-/Waehrungswechsel abgeschnitten)' : ''));
  }

  writeFileAtomic(outPfad, JSON.stringify(out, null, 1));
  console.log('geschrieben: ' + outPfad + ' (' + Object.keys(out).length + ' Namen; dieser Lauf: '
    + geschrieben + ' Namen, ' + periodenGesamt + ' Perioden, ' + gescheitert.length + ' Fehler, '
    + ((Date.now() - zeitStart) / 1000).toFixed(1) + ' s)');
  // Erst schreiben (Merge erhaelt den Altbestand), dann rot werden.
  if (gescheitert.length) {
    throw new Error('build-cnannual unvollstaendig — ' + gescheitert.join('; ')
      + ' (Altbestand erhalten, aber der Lauf hat NICHT vollstaendig aktualisiert)');
  }
}

if (require.main === module) main().catch((e) => { console.error('::error::' + e.message); process.exit(1); });

module.exports = {
  main, bauAJahre, bauHkJahre, pruefeYtdA, pruefeYtdHk, pruefeSchema, dekumuliere, rohertrag,
  nennwertAusDaten, secucodeFuerYahoo, yahooFuerSecucode, istEchterACode, spanneTage,
  loeseAhAuf, holeBericht, CN_A, CN_HK, STANDARD, NENNWERTE, FELD_NAMEN, MIN_JAHRE,
  A_INC, A_BAL, A_CF, HK_MAIN, HK_INC, HK_BAL, HK_INC_ITEMS, HK_BAL_ITEMS, HK_JAHR_TYP,
  JAHR_A, PAGE_SIZE, BATCH,
};

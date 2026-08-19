'use strict';
/**
 * build-twannual.js — OFFLINE-Generator fuer Taiwan (analog scripts/build-krannual.js).
 * =====================================================================================
 * Zieht tiefe taiwanische Jahresreihen von FinMind (gratis, ohne Schluessel) und schreibt
 * external-data/tw-secannual.json im secAnnual-Format, das run-screener.js bereits liest
 * (SECANNUAL_FILES kennt 'tw-secannual.json' seit dem globalen-Adapter-Slot).
 *
 * WARUM FINMIND UND NICHT DIE BOERSE SELBST: Das amtliche TWSE-OpenAPI liefert nur EINE
 * Periode (laufendes Quartal, YTD-kumuliert) — als Historie unbrauchbar. FinMind reicht
 * dieselbe TWSE/TPEx-Amtszahl durch, aber bis zu 21 Jahre tief. Live gegengeprueft
 * 19.08.2026 an 2360.TW (Chroma ATE), H1 2026, auf die letzte Stelle identisch:
 *   Umsatz            FinMind Q1+Q2 11.859.669.000 + 13.529.459.000 = 25.389.128.000 TWD
 *                     TWSE amtlich  25.389.128 Tsd. TWD
 *   Rohertrag          7.424.059.000 +  8.185.188.000 = 15.609.247.000 | TWSE 15.609.247
 *   Betriebsergebnis   4.797.366.000 +  5.241.403.000 = 10.038.769.000 | TWSE 10.038.769
 * FinMind ist damit keine Drittanbieter-Schaetzung, sondern die durchgereichte Amtszahl.
 *
 * DIE ZENTRALE FALLE — ZWEI KONVENTIONEN IN EINER QUELLE (selbst gemessen, nicht angenommen):
 *   - GuV (TaiwanStockFinancialStatements) ist QUARTALS-DISKRET.
 *     8996.TW 2024: Q1 797.922.000 · Q2 1.000.082.000 · Q3 1.209.670.000 · Q4 995.766.000
 *     (Q4 < Q3 -> kann nicht kumuliert sein). Jahreswert = SUMME der vier Quartale.
 *   - Cashflow (TaiwanStockCashFlowsStatement) ist YTD-KUMULIERT.
 *     8996.TW 2024: 310.309.000 -> 396.039.000 -> 644.336.000 -> 1.041.283.000, und
 *     'CashBalancesBeginningOfPeriod' ist innerhalb des Jahres KONSTANT (590.937.000 in
 *     allen vier Quartalen) — das ist der strukturelle Beweis der Kumulierung.
 *     Jahreswert = die 12-31-Zeile DIREKT. Wer hier summiert, liegt um Faktor ~2,3 daneben.
 * Beide Konventionen werden bei jedem Lauf per Waechter nachgeprueft (pruefeKonventionen).
 * Dreht die Quelle stillschweigend um, wird der Lauf ROT statt still falsch.
 *
 * VERGLEICHBARKEIT: TW-IFRS (von der FSC uebernommen, keine Wahlfreiheit), Konzernabschluss.
 * Standard/Konsolidierungskreis/Waehrung stehen als Pflichtfelder je Firma in der Ausgabe —
 * eine Quelle, die den Standard nicht kenntlich macht, ist schlimmer als keine Quelle.
 *
 * WAEHRUNG: TWD, roh, KEINE Umrechnung. Der secAnnual-Kanal wird von vorzeichen- und
 * verhaeltnisbasierten Signalen gelesen (cycleSeriesPair, roicStability) — die sind
 * waehrungs-invariant. Absolute Niveaus gegen einen USD-Nenner zu rechnen bleibt verboten
 * (Befund 03.07.: KRW-Zaehler gegen USD-Nenner verfaelschte capitalEfficiency um ~1000x).
 * Darum traegt jede Firma reportingCurrencyOriginal — dieselbe Feldbezeichnung, die
 * pull-yahoo.js/write-board-history.js schon benutzen.
 *
 * DETERMINISMUS wie build-krannual/build-secannual: Netz NUR hier (offline). Die committete
 * tw-secannual.json ist die deterministische Quelle; run-screener.js liest sie ohne Netz.
 */
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'external-data', 'tw-secannual.json');
const { writeFileAtomic } = require(path.join(ROOT, 'lib/atomic-write.js'));
const { readJsonExistingOrThrow, FEHLT } = require(path.join(ROOT, 'lib/read-json.js'));
const { fetchJson } = require(path.join(ROOT, 'lib/fetch-retry.js'));

const API = 'https://api.finmindtrade.com/api/v4/data';
const START = '2005-01-01';

// Die 21 taiwanischen Top-20-Plaetze aus Karls Boards (board-history/2026-08-19, Track
// profitable). Bewusst eine EXPLIZITE Liste statt einer Ableitung aus board-history:
// der Board-Stand aendert sich taeglich, der Generator soll deterministisch bleiben.
// Erweiterbar — data_id ist der Ticker ohne .TW/.TWO.
const TW = [
  '8996.TW', '2404.TW', '6691.TW', '2467.TW',
  '2548.TW', '2501.TW',
  '8271.TW', '3131.TWO', '6531.TW', '5269.TW', '3260.TWO', '2449.TW',
  '2360.TW', '3017.TW', '6805.TW', '2451.TW', '2383.TW',
];

// ⛔ BEWUSST NICHT DABEI — und warum. Diese vier stehen ebenfalls in Karls Top 20, lassen sich
// aber heute NICHT ehrlich zu Jahreswerten verrechnen. Sie sind junge TPEx-Notierungen, die vor
// 2025 nur HALBJAEHRLICH gemeldet haben; der Feed liefert dann Perioden zum 30.06. und 31.12.,
// aber keine zum 31.03./30.09. (live nachgesehen 19.08.2026):
//   6831.TW  2020-12-31 · 2021-06-30 · 2021-12-31 · … · 2024-12-31, dann ab 2025 quartalsweise
//   6944.TW  2022-06-30 · 2022-12-31 · … · 2024-12-31, dann ab 2025 quartalsweise
//   7769.TW / 7822.TW  erst ab 2023-12-31 ueberhaupt vorhanden
// FinMind gibt die Perioden-LAENGE nicht mit. Eine 30.06.-Zeile als Halbjahr zu deuten, waere
// geraten — deutet man falsch, ist der Jahresumsatz entweder rund halbiert oder verdoppelt.
// Darum: nicht bauen statt schaetzen. Sie kommen von selbst dazu, sobald vier Quartale eines
// Jahres vorliegen (fuer alle vier ist das FY2025 bereits der Fall, aber eine Reihe aus einem
// einzigen Jahr unterschreitet die Mindesttiefe von drei Jahren).
// Der Lauf bleibt dadurch GRUEN: ein bekanntes, begruendetes Nicht-Koennen ist kein Fehlalarm.
const TW_NICHT_BAUBAR = ['6831.TW', '6944.TW', '7769.TW', '7822.TW'];
const dataId = (tk) => tk.replace(/\.(TW|TWO)$/, '');

const DATASETS = {
  gu: 'TaiwanStockFinancialStatements',
  bs: 'TaiwanStockBalanceSheet',
  cf: 'TaiwanStockCashFlowsStatement',
};

// Feld-Auswahl. Reihenfolge = Vorrang; der erste Treffer mit finitem Wert gewinnt.
// Nettoergebnis und Eigenkapital bewusst MUTTERGESELLSCHAFT (ohne Minderheiten) —
// FinMinds 'Equity' ist inkl. Minderheiten und passt sonst nicht zum Nettoergebnis.
// Hinweis: 'EquityAttributableToOwnersOfParent' kommt in BEIDEN Datensaetzen vor
// (GuV = Ergebnis der Mutter, Bilanz = Eigenkapital der Mutter). Kein Konflikt, weil
// je Kennzahl nur EIN Datensatz gelesen wird.
const GU_FELDER = {
  annualRev: ['Revenue'],
  annualGrossProfit: ['GrossProfit'],
  annualOpInc: ['OperatingIncome'],
  annualNetIncome: ['EquityAttributableToOwnersOfParent', 'IncomeAfterTaxes', 'IncomeAfterTax'],
};
const BS_FELDER = {
  annualAssets: ['TotalAssets'],
  annualEquity: ['EquityAttributableToOwnersOfParent'],
};
const CF_FELDER = {
  annualOCF: ['NetCashInflowFromOperatingActivities', 'CashFlowsFromOperatingActivities'],
};
const KAPITAL_FELD = 'CapitalStock';
// Taiwanische Stammaktien haben durchgaengig NT$10 Nennwert; die Aktienzahl steht nicht
// als Rohwert im Feed. HERLEITUNG, kein Ausweis — darum unten in `derived` gekennzeichnet.
const NENNWERT_TWD = 10;

const QUARTALE = ['03-31', '06-30', '09-30', '12-31'];

// ⚠ STANDARD-SCHNITT. Taiwan hat IFRS fuer Boersennotierte zum Geschaeftsjahr 2013
// eingefuehrt; davor galt ROC-GAAP. FinMind liefert die Vor-Ära trotzdem mit (2360.TW
// reicht bis 2005 zurueck) — dieselben Feldnamen, anderer Bilanzierungsstandard.
// EMPIRISCH BESTAETIGT statt angenommen: das IFRS-Vokabular taucht in der GuV auf den
// Tag genau zum 2013-03-31 erstmals auf ('IncomeAfterTaxes', 'EquityAttributableTo-
// OwnersOfParent'), die Bilanz beginnt mit der IFRS-Eroeffnungsbilanz 2012-12-31.
// Die Vor-Ära zu uebernehmen hiesse, zwei Standards unter EIN Feld zu mischen — genau
// das, was die Vergleichbarkeits-Auflage verbietet. 13 saubere Jahre (2013-2025) sind
// tiefer als der SEC-Kanal (10) und eindeutig; die Tiefe ist den Standardbruch nicht wert.
const IFRS_AB_JAHR = 2013;

function zahl(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** date -> {type -> value} fuer EINEN Datensatz. */
function nachDatum(rows) {
  const m = new Map();
  for (const r of rows || []) {
    if (!r || typeof r.date !== 'string' || typeof r.type !== 'string') continue;
    if (!m.has(r.date)) m.set(r.date, {});
    const v = zahl(r.value);
    if (v != null) m.get(r.date)[r.type] = v;
  }
  return m;
}

const ersterTreffer = (zeile, namen) => {
  for (const n of namen) if (zeile && Number.isFinite(zeile[n])) return zeile[n];
  return null;
};

/**
 * WAECHTER (Auflage 3 der Recherche: "YTD vs diskret gehoert in einen Waechter,
 * nicht in einen Kommentar"). Prueft beide Konventionen an den tatsaechlich geholten
 * Daten. Wirft — kein stiller Fallback, keine Warnung, die niemand liest.
 */
function pruefeKonventionen(tk, guNachDatum, cfNachDatum) {
  // (a) Cashflow MUSS kumuliert sein. Der ENTSCHEIDENDE Unterschied steht im
  //     Kassen-Anfangsbestand zweier aufeinanderfolgender Quartale desselben Jahres:
  //       YTD     -> Anfang(Q+1) == Anfang(Q)     (jede Zeile startet am 01.01.)
  //       diskret -> Anfang(Q+1) == Ende(Q)       (jede Zeile startet am Quartalsanfang)
  //     Beides gleichzeitig geht nur bei einem Nullquartal, ist also trennscharf.
  //     WARUM NICHT "Anfang ist im Jahr konstant": das faellt auf echte Restatements herein.
  //     Belegt an 8996.TW 2016 — der Anfangsbestand wurde unterjaehrig von 896.060.000 auf
  //     845.610.000 korrigiert (2015er Schlussbestand nachtraeglich berichtigt). Das ist eine
  //     Berichtigung, keine Konventionsaenderung. Gemessen ueber 6 Ticker: 235 von 238 Paaren
  //     YTD-Treffer, 0 diskret-Treffer — die 3 Fehlenden sind genau solche Berichtigungen.
  let ytdTreffer = 0, diskretTreffer = 0, cfPaare = 0;
  const cfJahre = new Set([...cfNachDatum.keys()].map((d) => d.slice(0, 4)));
  for (const j of cfJahre) {
    for (let i = 0; i < QUARTALE.length - 1; i += 1) {
      const a = cfNachDatum.get(j + '-' + QUARTALE[i]);
      const b = cfNachDatum.get(j + '-' + QUARTALE[i + 1]);
      if (!a || !b) continue;
      const aAnfang = a.CashBalancesBeginningOfPeriod;
      const aEnde = a.CashBalancesEndOfPeriod;
      const bAnfang = b.CashBalancesBeginningOfPeriod;
      if (![aAnfang, aEnde, bAnfang].every(Number.isFinite)) continue;
      cfPaare += 1;
      if (bAnfang === aAnfang) ytdTreffer += 1;
      if (bAnfang === aEnde) diskretTreffer += 1;
    }
  }
  if (cfPaare < 3) {
    throw new Error(tk + ': Cashflow-Konvention NICHT pruefbar — nur ' + cfPaare + ' Quartalspaare mit '
      + 'Kassen-Anfangs-/Endbestand im Feed (mind. 3 noetig). Ohne diesen Anker ist YTD vs. diskret '
      + 'nicht entscheidbar; der Jahreswert waere geraten statt belegt.');
  }
  if (!(ytdTreffer > diskretTreffer && ytdTreffer >= cfPaare * 0.6)) {
    throw new Error(
      tk + ': Cashflow-Konvention verletzt — von ' + cfPaare + ' Quartalspaaren sprechen nur '
      + ytdTreffer + ' fuer YTD, aber ' + diskretTreffer + ' fuer quartalsdiskret. Der Adapter nimmt '
      + 'die 12-31-Zeile als Jahreswert; bei diskreten Zeilen waere der Jahres-Cashflow um bis zu '
      + 'Faktor 4 zu niedrig. Abbruch statt stiller Fehlzahl.');
  }

  // (b) GuV MUSS diskret sein: bei kumulierten Zeilen koennte der Umsatz innerhalb eines
  //     Jahres NIE fallen (Umsatz ist nicht negativ). Ueber die ganze Historie einer Firma
  //     tritt mindestens ein Quartalsrueckgang auf. Kein einziger -> Konvention verdaechtig.
  let rueckgaenge = 0, paare = 0;
  const jahre = new Set([...guNachDatum.keys()].map((d) => d.slice(0, 4)));
  for (const j of jahre) {
    let vorher = null;
    for (const q of QUARTALE) {
      const z = guNachDatum.get(j + '-' + q);
      const v = z ? z.Revenue : undefined;
      if (!Number.isFinite(v)) { vorher = null; continue; }
      if (vorher != null) { paare += 1; if (v < vorher) rueckgaenge += 1; }
      vorher = v;
    }
  }
  if (paare >= 8 && rueckgaenge === 0) {
    throw new Error(
      tk + ': GuV-Konvention verdaechtig — in ' + paare + ' aufeinanderfolgenden Quartalspaaren faellt '
      + 'der Umsatz KEIN EINZIGES Mal. Der Datensatz galt als quartalsdiskret (Jahreswert = Summe '
      + 'der vier Quartale). Ist er auf YTD umgestellt, waere jeder Jahresumsatz ~2,5x zu hoch. '
      + 'Abbruch statt stiller Fehlzahl.');
  }
  return { cfPaare, ytdTreffer, diskretTreffer, guPaare: paare, guRueckgaenge: rueckgaenge };
}

/**
 * Baut die Jahreswerte EINER Firma. Reine Funktion (testbar ohne Netz).
 * Fehlt etwas, bleibt es null — nie 0, nie geschaetzt, nie aus einem Nachbarjahr.
 */
function bauJahre(guRows, bsRows, cfRows, tk) {
  const gu = nachDatum(guRows), bs = nachDatum(bsRows), cf = nachDatum(cfRows);
  const waechter = pruefeKonventionen(tk, gu, cf);

  const jahre = new Set();
  for (const m of [gu, bs, cf]) for (const d of m.keys()) jahre.add(Number(d.slice(0, 4)));
  // Vor-IFRS-Jahre fallen HIER raus (siehe IFRS_AB_JAHR) — nicht spaeter beim Verbraucher.
  const fys = [...jahre].filter((y) => Number.isFinite(y) && y >= IFRS_AB_JAHR).sort((a, b) => b - a); // newest-first

  const out = {};
  for (const f of [...Object.keys(GU_FELDER), ...Object.keys(BS_FELDER), ...Object.keys(CF_FELDER), 'annualShares']) out[f] = [];

  for (const fy of fys) {
    const q = QUARTALE.map((s) => gu.get(fy + '-' + s) || null);
    const ende = fy + '-12-31';
    const bsE = bs.get(ende) || null;
    const cfE = cf.get(ende) || null;

    // Flussgroessen GuV: Summe der VIER diskreten Quartale. Fehlt eines -> null.
    for (const feld of Object.keys(GU_FELDER)) {
      const namen = GU_FELDER[feld];
      const werte = q.map((z) => (z ? ersterTreffer(z, namen) : null));
      const vollstaendig = werte.every((v) => Number.isFinite(v));
      out[feld].push({ value: vollstaendig ? werte.reduce((a, b) => a + b, 0) : null });
    }
    // Bestandsgroessen Bilanz: Stichtag 31.12.
    for (const feld of Object.keys(BS_FELDER)) {
      out[feld].push({ value: bsE ? ersterTreffer(bsE, BS_FELDER[feld]) : null });
    }
    // Cashflow: YTD-Zeile zum 31.12. = Jahreswert. NICHT summieren.
    for (const feld of Object.keys(CF_FELDER)) {
      out[feld].push({ value: cfE ? ersterTreffer(cfE, CF_FELDER[feld]) : null });
    }
    // Aktienzahl: Grundkapital / NT$10 Nennwert. Herleitung, siehe `derived`.
    const kap = bsE ? ersterTreffer(bsE, [KAPITAL_FELD]) : null;
    out.annualShares.push({ value: Number.isFinite(kap) ? kap / NENNWERT_TWD : null });
  }

  // ⚠ LAUFENDES JAHR AUSSCHNEIDEN. fys entsteht aus den vorhandenen QUARTALS-Datumsangaben,
  // also enthaelt es auch das angebrochene Jahr (2026 hat Q1/Q2, aber weder vier Quartale
  // noch eine 31.12.-Bilanz) — dort ist JEDES der acht Felder null. Ein solcher Leerslot an
  // Index 0 ist nicht bloss haesslich, er schaltet den tiefen Pfad ab: axes.js verlangt fuer
  // roicStabilitySource ausdruecklich `opS[0] !== null && assetsS[0] !== null && …`, und
  // score.js liest die Serien ebenso ab Index 0. Gemessen: vor diesem Schnitt hatten ALLE 17
  // taiwanischen Namen ein komplett leeres FY2026 an Index 0. Ausserdem waere `nfy` sonst eine
  // Frische-Behauptung fuer ein Jahr, zu dem nichts vorliegt.
  // Es werden nur Jahre entfernt, in denen ALLE acht Felder leer sind — eine echte Luecke
  // MITTEN in der Reihe bleibt als null stehen (die gemeinsame Achse darf nicht verrutschen).
  const felderListe = Object.keys(out);
  const behalten = fys.map((_, i) => felderListe.some((f) => Number.isFinite(out[f][i] && out[f][i].value)));
  const fysGetrimmt = fys.filter((_, i) => behalten[i]);
  const outGetrimmt = {};
  for (const f of felderListe) outGetrimmt[f] = out[f].filter((_, i) => behalten[i]);
  return Object.assign({ fys: fysGetrimmt, _waechter: waechter }, outGetrimmt);
}

const zaehle = (arr) => arr.filter((e) => Number.isFinite(e && e.value)).length;

async function holeDatensatz(tk, ds, holen) {
  const u = API + '?dataset=' + ds + '&data_id=' + encodeURIComponent(dataId(tk)) + '&start_date=' + START;
  const j = await holen(u);
  if (!j || j.msg !== 'success' || !Array.isArray(j.data)) {
    throw new Error(tk + '/' + ds + ': FinMind-Antwort nicht verwertbar (msg=' + (j && j.msg) + ', status=' + (j && j.status) + ')');
  }
  return j.data;
}

// opts = Test-Seam (wie SEC_SNAPSHOTS_DIR in build-secannual, getJSON in build-krannual).
async function main(opts = {}) {
  const holen = opts.fetchJson || fetchJson;
  const outPfad = opts.out || OUT;
  const tickers = opts.tickers || TW;

  const vorher = readJsonExistingOrThrow(outPfad);
  const out = vorher === FEHLT ? {} : vorher;
  const gescheitert = [];

  for (const tk of tickers) {
    let guRows, bsRows, cfRows;
    try {
      guRows = await holeDatensatz(tk, DATASETS.gu, holen);
      bsRows = await holeDatensatz(tk, DATASETS.bs, holen);
      cfRows = await holeDatensatz(tk, DATASETS.cf, holen);
    } catch (e) {
      gescheitert.push(tk + ': ' + e.message);
      console.warn(tk + ': Abruf fehlgeschlagen (' + e.message + ') -> Altbestand bleibt unveraendert');
      continue;
    }
    let j;
    try {
      j = bauJahre(guRows, bsRows, cfRows, tk);
    } catch (e) {
      // Waechter-Wurf: Konvention der Quelle hat sich geaendert. NICHT schreiben.
      gescheitert.push(tk + ': ' + e.message);
      console.warn(tk + ': ' + e.message);
      continue;
    }
    const fys = j.fys;
    const serien = {};
    for (const k of Object.keys(j)) if (k !== 'fys' && k !== '_waechter') serien[k] = j[k];
    if (zaehle(serien.annualRev) < 3) {
      gescheitert.push(tk + ': nur ' + zaehle(serien.annualRev) + ' Jahre Umsatz (mind. 3 noetig)');
      console.warn(tk + ': zu wenig Jahre (Umsatz=' + zaehle(serien.annualRev) + ') -> uebersprungen');
      continue;
    }
    out[tk] = Object.assign({
      source: 'FinMind (durchgereichte TWSE/TPEx-Amtszahl)',
      accountingStandard: 'TW-IFRS',    // durchgaengig — Vor-IFRS-Jahre (<2013) sind ausgeschnitten
      accountingStandardFrom: IFRS_AB_JAHR,
      consolidation: 'CFS',             // Konzernabschluss, nie Einzelabschluss
      reportingCurrencyOriginal: 'TWD', // roh, keine Umrechnung
      derived: { annualShares: 'CapitalStock / ' + NENNWERT_TWD + ' (NT$' + NENNWERT_TWD + ' Nennwert) — Herleitung, kein Ausweis' },
      nfy: fys[0],
      generatedAt: new Date().toISOString(),
      fys,
    }, serien);
    console.log(tk + ': ' + fys.length + ' Jahre — rev=' + zaehle(serien.annualRev)
      + ' gp=' + zaehle(serien.annualGrossProfit) + ' op=' + zaehle(serien.annualOpInc)
      + ' ni=' + zaehle(serien.annualNetIncome) + ' assets=' + zaehle(serien.annualAssets)
      + ' eq=' + zaehle(serien.annualEquity) + ' ocf=' + zaehle(serien.annualOCF)
      + ' shares=' + zaehle(serien.annualShares));
  }

  writeFileAtomic(outPfad, JSON.stringify(out, null, 1));
  console.log('geschrieben: ' + outPfad + ' (' + Object.keys(out).length + ' Namen)');
  // Erst schreiben (Merge erhaelt den Altbestand), dann rot werden.
  if (gescheitert.length) {
    throw new Error('build-twannual unvollstaendig — ' + gescheitert.join('; ')
      + ' (Altbestand erhalten, aber der Lauf hat NICHT vollstaendig aktualisiert)');
  }
}

if (require.main === module) main().catch((e) => { console.error('::error::' + e.message); process.exit(1); });

module.exports = { bauJahre, pruefeKonventionen, nachDatum, dataId, main, TW, TW_NICHT_BAUBAR, GU_FELDER, BS_FELDER, CF_FELDER, NENNWERT_TWD, IFRS_AB_JAHR };

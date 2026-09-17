#!/usr/bin/env node
'use strict';
/**
 * scripts/write-rule40-export.js — das Rule-of-40-Brett als eigenes Neben-Board.
 *
 * WO ER LAEUFT: im scoring-Job, NACH write-findash-export.js (er liest dessen Ergebnis)
 * und VOR dem Pages-Deploy. Er rechnet KEINE Achse und KEINEN Score neu — er laeuft ueber
 * snapshots/, laesst jeden Namen durch src/scoring/router.js route(), holt sich Wachstum
 * und FCF-Marge aus denselben Funktionen wie das Scoring und schreibt
 * outputs/findash-export/v1/rule40/{index.json,overview.json} in derselben Huelle und
 * Zeilenform wie quality/ und smallcap/.
 *
 * WARUM DAS GEROUTETE UNIVERSUM UND NICHT DIE BRETT-ZEILEN: die Vollboards sind die besten
 * 150 je Branche NACH ENGINE-SCORE. Eine Rule-of-40-Liste, die durch genau die Formel
 * vorgefiltert ist, gegen die sie die Gegenprobe sein soll, waere keine — und reife Namen
 * mit hoher Marge und massvollem Wachstum fehlten darin. Wer zusaetzlich auf einem Vollboard
 * steht, erbt von dort score/lamps/axisBreakdown/Kohorte und das geprueft umgerechnete
 * marketCap; alle anderen tragen onBoard:false, score:null und marketCap:null.
 *
 * R40 = Umsatzwachstum (%) + FCF-Marge TTM (%). Das ist ruleOfX mit alpha = 1
 * (src/scoring/axes.js:257). Der Unterschied zur Achse: hier steht die ZAHL im Brett,
 * nicht ihr Kohorten-Perzentil. Deshalb ist das Brett boardStatus='diagnostic' — eine
 * durchsichtige Arithmetik neben dem Score, nie im Score.
 *
 * FUENF REGELN, DIE DIESE DATEI TRAEGT
 *  1. NICHTS NEU RECHNEN, WAS ES SCHON GIBT. Wachstum kommt aus revGrowthLevel (axes.js,
 *     derselbe Aufruf wie score.js:1348), die FCF-Marge laeuft durch die Datentore G0-G2
 *     von fcfMarginValid (engine.js:106-131) statt roh aus metrics, der Emittenten-Dedup
 *     durch issuerDedupGroups/-Comparator (score.js). Alles read-only; diese Datei fasst
 *     src/scoring/ nicht an.
 *  2. DER EXPORTIERTE WACHSTUMSWERT IST NICHT WINSORISIERT. score.js:1348 ruft
 *     revGrowthLevel(snapshot) ABSICHTLICH ohne growthBounds auf: fuer die ANZEIGE
 *     waere ein geklemmter Wert eine stille Verfaelschung. Fuer eine RANGLISTE ist er
 *     es nicht — ungeklemmt fuehrt ein Stub-Basisquartal die Liste an (gemessen am
 *     Stand 2026-08-29: 2548.TW mit +29.049 % gegen p99 = +117,7 %). Deshalb klemmt
 *     dieses Brett den Wachstumsterm mit den universe-eigenen p1/p99-Schranken
 *     (winsorTailBounds, dieselbe Funktion wie die Achse) und legt BEIDE Zahlen in die
 *     Zeile: revGrowthYoYPct (roh, wie im Rest des Exports) und revGrowthPctUsed
 *     (geklemmt, der Term in r40). Wer nachrechnet, sieht welchen.
 *  3. EIN STUB-BASISQUARTAL IST KEIN WACHSTUM. revQuartalsYoY prueft nur b > 0
 *     (axes.js:102) — ein Basisquartal von 1,4 Mio. gegen 693 Mio. TTM ist eine
 *     Teilmeldung, keine Vervielfachung. MIN_BASE_QUARTER_SHARE wirft solche Zeilen
 *     aus dem Brett, statt sie an die Winsor-Schranke zu kleben.
 *  4. NIE NaN. writeJsonAtomic laeuft mit assertFinite; eine nicht endliche Zahl wuerde
 *     als null geschrieben und hiesse dann "nicht gemessen".
 *  5. VIER DATEIEN ODER EIN MARKER. Faellt der Lauf, wird der Ordner NICHT geloescht,
 *     sondern auf den _failed-Marker zurueckgesetzt (die Konvention, die
 *     findash/data-layer/screener-sync.js:228 probt und screener.js:739 liest).
 *     Sonst servierte findash den Stand von gestern als den von heute.
 *
 * Das Brett aendert keinen Score und keine Methode. Es waehlt aus, was der Export
 * ohnehin enthaelt, und nennt eine Summe zweier exportierter Prozentzahlen.
 */
const fs = require('node:fs');
const path = require('node:path');

const { writeJsonAtomic } = require('../lib/atomic-write.js');
const { isMetadataSnapshot } = require('../lib/snapshot-fs.js');
const { norm, metricVal, jahresVergleichIdx } = require('../src/scoring/snapshot.js');
const { fcfMarginValid } = require('../src/scoring/engine.js');
const { winsorTailBounds, issuerDedupGroups, issuerDedupComparator, isDataSuspect } = require('../src/scoring/score.js');
const { newestQtrSuspect, annualCurrencyLeak } = require('../src/scoring/lamps.js');
const { route } = require('../src/scoring/router.js');
const axesFns = require('../src/scoring/axes.js');

const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_V1_DIR = path.join(REPO_ROOT, 'outputs', 'findash-export', 'v1');
// FINDASH_SNAPSHOTS_DIR ist die Naht, die write-findash-export.js:175 benutzt. Beide
// Schreiber MUESSEN dieselbe Snapshot-Menge sehen: laufen sie auseinander, rechnet dieses
// Brett gegen eine andere Population als der Export, und das faellt niemandem auf.
const DEFAULT_SNAPSHOTS_DIR = process.env.FINDASH_SNAPSHOTS_DIR || path.join(REPO_ROOT, 'snapshots');

const SCHEMA = 'findash-export/v1';        // Schema-Pin des Konsumenten (screener-contract.js:53)
const BOARD_ID = 'rule40';
const BOARD_STATUS = 'diagnostic';         // durchsichtige Arithmetik, nie im 0-100-Score
const FAILED_NAME = '_failed';             // findash probt genau diesen Namen (screener-sync.js:228)

/**
 * Software/SaaS/Internet nach meta.industry (Yahoo-Strings). Karls Standard-Schnitt oeffnet
 * auf dieser Gruppe; "Internet Retail" gehoert bewusst NICHT dazu (Handel, keine Software).
 */
const SOFTWARE_INDUSTRIES = Object.freeze([
  'Software - Application',
  'Software - Infrastructure',
  'Information Technology Services',
  'Internet Content & Information',
]);

/** Aufnahme-Schwelle des Bretts. Karls Ansicht schaltet darueber (40/50/60) — das Brett liefert ab 40. */
const R40_MIN = 40;
/**
 * Je Gruppe die besten TOP_N UNTERHALB der Anzeige-Grenze; oberhalb wird nicht gekappt.
 * Warum zweigeteilt: der Tab oeffnet mit einem sichtbaren, umstellbaren Vorfilter
 * "Marktkap. >= 1 Mrd. USD" — ein Investmentmanager liest einen 11-Mio.-Wert neben
 * Palantir als Rauschen. Waere die Export-Kappe eine einzige Liste, fuellten die kleinen
 * Werte sie auf und die Standard-Ansicht liefe leer.
 */
const TOP_N = 100;
/**
 * ANZEIGE-Konvention dieses Bretts, kein Scoring-Niveau und kein Waechter: oberhalb dieser
 * Marktkapitalisierung wird jede Zeile mit r40 >= R40_MIN exportiert, unterhalb nur die
 * besten TOP_N je Gruppe. Die Zahl entscheidet ueber die VOLLSTAENDIGKEIT der
 * Standard-Ansicht, nicht ueber die Aufnahme einer einzelnen Zeile — jede Zeile unterhalb
 * kann weiterhin ins Brett kommen, sie konkurriert nur um die 100 Plaetze.
 * Zeilen ohne belegte USD-Marktkap (alle Namen ohne Vollboard-Zeile, siehe unten) zaehlen
 * zur unteren Gruppe: ohne Beleg gibt es keine Groessen-Behauptung.
 */
const DISPLAY_LARGE_MCAP_USD = 1e9;
/**
 * Das Vorjahresquartal muss mindestens dieser Anteil eines Durchschnittsquartals (revenueTTM/4)
 * sein — darunter ist es eine Teilmeldung/Umstellung und die YoY-Zahl ein Meldeartefakt.
 * Gemessen am Stand 2026-08-29 ueber 4.603 Zeilen mit Quartalsbein: der gesunde Koerper liegt
 * bei p5 = 0,59 / p50 = 0,92, die Phantomzeilen bei 0,001-0,16.
 */
const MIN_BASE_QUARTER_SHARE = 0.25;
/**
 * Das juengste Quartalsende einer Zeile darf gegenueber generated_at nicht aelter sein als das.
 *
 * Der Anker ist das Ende der Quartalsreihe (neuestesQuartalsEnde), NICHT der Abrufzeitpunkt —
 * die Begruendung steht dort. Deshalb ist der Wert auch kein Abruf-Mass mehr: gemessen ueber
 * die 11.210 gerouteten Namen des Stands 2026-08-29 liegt der gesunde Koerper bei p50 = 151
 * und p95 = 151 Tagen (ein Quartalsmelder haengt hoechstens ein Quartal plus Meldefrist
 * zurueck). Danach kommt eine Luecke, und der Schwanz aendert sich kaum noch: 4,1 % liegen
 * ueber 180, 2,4 % ueber 550, 2,2 % ueber 730 Tagen — es sind weitgehend DIESELBEN Namen,
 * bis hinauf zu 8.003 Tagen (LTC: juengstes Quartal laut mostRecentQuarter 2020-09-30).
 * 550 Tage (rund 18 Monate) laesst jeden Jahres- und Halbjahresmelder samt spaeter Einreichung
 * durch — die 241-Tage-Faelle, die N5/E2 als normal eingestuft hat, bleiben drin — und faellt
 * erst dort, wo keine Meldekadenz den Abstand mehr erklaert und die Abdeckung tot ist.
 */
const MAX_FISCAL_AGE_DAYS = 550;
/**
 * Oekonomischer Deckel des Margen-Terms, in Reihe mit OPMARGIN_CAP = 1.0 (score.js:457,
 * "opInc-Kern <= Umsatz"): freier Cashflow UEBER dem Umsatz ist keine operative Marge,
 * sondern Bilanz-/Einheiten-Artefakt (Mieterloes-Rechnung, Beteiligungsertrag, Verkauf).
 * Solche Zeilen werden VERWORFEN statt geklemmt — ein geklemmtes "100 %" waere in einem
 * Brett, dessen ganzer Zweck die nachrechenbare Summe ist, eine erfundene Zahl.
 * Gemessen am Stand 2026-08-29: trifft 23 von 247 Zeilen, davon 2 in der Software-Gruppe.
 */
const MAX_FCF_MARGIN_PCT = 100;
/**
 * Unter so vielen Kandidaten wird der Wachstumsterm NICHT geklemmt. Ein 1-%-Rand braucht
 * mindestens ein paar Beobachtungen, um ein Rand zu sein; bei 3 Kandidaten IST die
 * "p99-Schranke" die oberste Beobachtung selbst, und das Klemmen wuerde genau die Zeile
 * beschneiden, die es schuetzen soll. Der Produktionslauf liegt bei rund 5.500 Kandidaten
 * (Stand 2026-08-29), also weit darueber; getroffen wird nur ein bereits kaputter Lauf,
 * und dann steht growthWinsorBounds: null sichtbar in der index.json.
 */
const MIN_WINSOR_SAMPLE = 200;
/**
 * Sektoren, in denen eine FCF-Marge nichts ueber das operative Geschaeft sagt (Mieterloese,
 * Zinsertrag, Beteiligungsverkaeufe) — und die Karls Ansage „alle Branchen ohne Finanzwerte"
 * ohnehin ausschliesst. Der Ausschluss gehoert in den SCHREIBER und nicht in die Oberflaeche:
 * sonst verbrauchen diese Zeilen die Top-150-Plaetze und der Gesamt-Blick liefe leer.
 * Der Router nimmt nur Bilanz-Banken, Versicherer und mREITs heraus; Immobilien-REITs,
 * Vermoegensverwalter und Boersenbetreiber bleiben und fuehrten die Liste an.
 */
const SEKTOR_AUSSCHLUSS = Object.freeze(['Financial Services', 'Real Estate']);

/** Zeilenfelder, die 1:1 aus der Vollboard-Zeile uebernommen werden (Reihenfolge = quality/-Zeile). */
const PASSTHROUGH_FIELDS = Object.freeze([
  'name', 'country', 'region', 'sector', 'marketCap', 'phase', 'mcapBand', 'mcapKlasse',
  'ipoRecency', 'profitTier', 'ipoYear', 'coverageAxes', 'coverageWeight', 'cohortN',
  'cohortFallback', 'scoreBase', 'scoreShrunk', 'factors', 'axisBreakdown', 'revGrowthYoYPct',
  'profitStreak', 'einmalertragPrognose', 'einmalertragBewertbarkeit', 'shareDilution',
  'ath', 'marketCapCurrency', 'tradingFxRateApplied',
]);

/** Pflichtfelder der overview-Zeile aus dem geteilten Fixture (docs/findash-export-v1.contract.json). */
const REQUIRED_OVERVIEW_ROW = Object.freeze([
  'rank', 'ticker', 'formulaId', 'track', 'score', 'overviewKind', 'overviewValue',
  'overviewCompanion', 'lamps', 'country', 'region', 'sector', 'marketCap', 'phase',
  'mcapBand', 'ipoRecency', 'profitTier', 'ipoYear', 'cohortN', 'cohortFallback',
]);

const istZahl = (v) => typeof v === 'number' && Number.isFinite(v);
const round1 = (v) => Math.round(v * 10) / 10;

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function readJsonOrNull(p) {
  try { return readJson(p); } catch (_) { return null; }
}

/**
 * Das Vorjahresquartal, gegen das revQuartalsYoY rechnet (axes.js:95-105) — dieselbe
 * Index-Wahl, damit der Waechter genau die Zahl prueft, die in den Wachstumswert eingeht.
 * null, wenn dieser Name gar kein Quartalsbein hat (dann traegt der Jahres-Fallback).
 */
function basisQuartal(snapshot) {
  const v = jahresVergleichIdx(snapshot, 'revenueQ', 0);
  if (v === null) return null;
  const rq = norm(snapshot, 'revenueQ');
  if (v.idx >= rq.length) return null;
  const b = rq[v.idx];
  return (istZahl(b) && b > 0) ? b : null;
}

/**
 * Dezimal-statt-Prozent-Signatur, woertlich uebernommen aus dem Fix 98290452c7
 * (methods/rule-of-x.js): beide Terme in (-1,1), ihre Summe unter 1, und nicht beide null.
 * Eine echt fast-flache Prozent-Paarung (+0,8 % / +0,5 %) bleibt damit rechenbar.
 */
function einheitenVerdacht(growth, fcfMargin) {
  return Math.abs(growth) < 1 && Math.abs(fcfMargin) < 1
    && Math.abs(growth) + Math.abs(fcfMargin) < 1
    && (growth !== 0 || fcfMargin !== 0);
}

/**
 * Das Ende des JUENGSTEN Quartals der Reihe, aus der der Wachstumsterm gerechnet wird.
 *
 * Das ist der einzige ehrliche Frische-Anker dieses Bretts. `meta.fundamentalsAsOf` ist es
 * NICHT: es ist auf jedem geprueften Snapshot byte-gleich mit `meta.fetchedAt`, misst also den
 * Zeitpunkt des ABRUFS und nicht den Zeitraum, ueber den die Zahl etwas sagt — ein Waechter
 * darauf feuerte nie (Befund N5/E2, 17.09.2026, an LTC/PLTR/CRM/RYN/SII nachgemessen).
 * `meta.mostRecentQuarter` ist es auch nicht: bei LTC steht dort 2020-09-30, waehrend
 * `revenueQEnds[0]` desselben Snapshots 2026-03-31 nennt und die Quartalsreihe frisch ist —
 * ein Waechter darauf wuerde Zeilen wegwerfen, deren Zahlen stimmen.
 * revenueQEnds[0] kann der Rechnung per Konstruktion nicht widersprechen: es IST ihr Zeitraum.
 */
function neuestesQuartalsEnde(snapshot) {
  const ts = (snapshot && snapshot.timeseries) || {};
  const an = (snapshot && snapshot.annual) || {};
  // Quartalsreihe zuerst, sonst die Jahresreihe: wer nur jaehrlich meldet (annualRev-Fallback
  // in revGrowthLevel), hat trotzdem einen Zeitraum — er stand nur bisher nicht zur Verfuegung,
  // und der Waechter uebersprang die Zeile stillschweigend.
  for (const reihe of [ts.revenueQEnds, an.annualRevEnds]) {
    if (!Array.isArray(reihe) || !reihe.length) continue;
    const t = Date.parse(reihe[0]);
    if (Number.isFinite(t)) return t;
  }
  return null;
}

/**
 * Datenvertrauens-Tore der FCF-Marge: G0-G2 von fcfMarginValid (engine.js:106-131),
 * BEWUSST OHNE G3.
 *
 * G0 (Marge fehlt/nicht endlich), G1 (weder FCF- noch OCF-Reihe vorhanden) und G2 (Vorzeichen
 * der TTM-Marge widerspricht dem juengsten present FCF-Jahr) sind Aussagen ueber die DATEN:
 * fallen sie, ist die Zahl nicht vertrauenswuerdig. G3 (Summe der zwei juengsten Jahre >= 0)
 * ist dagegen ein WIRTSCHAFTLICHES Urteil — es wirft profitable-Track-Kandidaten mit
 * juengstem Cash-Burn heraus. Genau die will dieses Brett zeigen: hohes Wachstum bei
 * negativer Marge ist ein voellig regulaerer Rule-of-40-Fall, und ihn stillschweigend
 * wegzufiltern waere eine Meinung, keine Datenpruefung.
 *
 * Die Kopie ist Absicht (engine.js exportiert die Tore nicht einzeln) und wird von
 * tests/rule40/gate-parity.test.js an das Original gehalten: jede von der Engine
 * akzeptierte Zeile muss auch hier akzeptiert sein, und die Differenz ist exakt G3.
 */
function fcfMargeVertrauenswuerdig(fcfMarginTTM, normFCF, normOCF) {
  if (!istZahl(fcfMarginTTM)) return false;                                   // G0
  const present = (a) => Array.isArray(a) && a.some((v) => istZahl(v));
  const ersterPresent = (a) => (Array.isArray(a) ? a.find((v) => istZahl(v)) : undefined);
  if (!present(normFCF) && !present(normOCF)) return false;                   // G1
  if (!present(normFCF)) return false;                                        // G2 braucht ein FCF-Jahr
  const vz = (x) => (x > 0 ? 1 : (x < 0 ? -1 : 0));
  if (vz(fcfMarginTTM) !== vz(ersterPresent(normFCF))) return false;          // G2
  return true;
}

/**
 * ebitdaMargins in PROZENT. Nachgemessen am 17.09.2026 auf sieben Namen (CRM 30,1 /
 * NOW 19,7 / PLTR 38,6 / MSFT 58,5 / ADBE 38,6 / SNOW -22,4 / NVDA 65,3) — dieselbe
 * Einheit wie grossMargin/operatingMargin/fcfMarginTTM. NICHT skalieren.
 * Der Waechter ist die Gegenprobe auf genau diese Annahme: sieht der Wert wie ein
 * BRUCHTEIL aus (dieselbe Signatur, die den Dezimal-statt-Prozent-Fehler erkennt),
 * dann faellt die Zusatzspalte auf null statt eine um Faktor 100 falsche Zahl
 * anzuzeigen. r40 selbst haengt nicht daran — nur r40Ebitda.
 */
function ebitdaMargePct(snapshot, wachstumRoh) {
  const e = metricVal(snapshot, 'ebitdaMargins');
  if (!istZahl(e)) return null;
  if (einheitenVerdacht(wachstumRoh, e)) return null;
  return e;
}

/**
 * Disqualifizierende Datenqualitaets-Signale — mit der Entscheidung der Produktion.
 *
 * scoreUniverse() wirft Namen mit einer FABRIKATIONS-Lampe (erfundenes juengstes Quartal,
 * annual-currency-Leak) oder Grade D aus dem Ranking; sonst koennte ein Auslandsname auf
 * fabriziertem Wachstum die Liste anfuehren. Dieses Brett ruft scoreUniverse() nicht auf —
 * es routet nur — und sah diese Signale deshalb fuer Namen OHNE Brett-Zeile nie
 * (Befund N5/E2 Runde 2: alle Nicht-Brett-Zeilen trugen lamps:[], was nicht "sauber"
 * hiess, sondern "nie geprueft"). Heute ist das folgenlos (0 von 8 betroffen), mit
 * wachsendem Nicht-Brett-Anteil waere es genau die Luecke, die das Gate schliessen soll.
 *
 * Reimplementiert wird nichts: die beiden Lampen sind reine Funktionen des Snapshots
 * (lamps.js), und ueber Ausschluss oder Nicht-Ausschluss entscheidet isDataSuspect
 * (score.js) mit allen dort ausgeurteilten Ausnahmen.
 */
function datenSuspekt(snapshot) {
  const lampen = [];
  if (newestQtrSuspect(snapshot)) lampen.push('newestQtrSuspect');
  if (annualCurrencyLeak(snapshot)) lampen.push('annualCurrencyLeak');
  return isDataSuspect(snapshot, lampen, 'route');
}

function r40GruppeVon(industry) {
  return SOFTWARE_INDUSTRIES.includes(industry) ? 'software' : 'other';
}

// ---------------------------------------------------------------------------
// Sammeln
// ---------------------------------------------------------------------------
/**
 * Liest die Vollboards + Snapshots und liefert die rechenbaren Kandidaten samt einer
 * Abweisungs-Statistik. Die Statistik ist kein Schmuck: ohne sie sieht "kleines Brett"
 * genauso aus wie "Snapshots fehlen".
 */
function sammleKandidaten(opts = {}) {
  const v1Dir = opts.v1Dir || DEFAULT_V1_DIR;
  const snapshotsDir = opts.snapshotsDir || DEFAULT_SNAPSHOTS_DIR;

  const index = readJson(path.join(v1Dir, 'index.json'));
  if (index.schema !== SCHEMA) {
    throw new Error('[rule40] index.json traegt Schema "' + index.schema + '", erwartet "' + SCHEMA
      + '" — ein v2-Bump muss hier nachgezogen werden, bevor dieses Brett weiterlaeuft.');
  }
  if (typeof index.generated_at !== 'string' || !Number.isFinite(Date.parse(index.generated_at))) {
    throw new Error('[rule40] index.generated_at ist kein lesbares Datum ('
      + JSON.stringify(index.generated_at) + ') — ohne Herkunft darf kein Brett daraus entstehen.');
  }
  const branches = Array.isArray(index.branches) ? index.branches : [];
  if (!branches.length) {
    throw new Error('[rule40] index.json nennt keine branches — es gibt kein Vollboard zu lesen.');
  }

  const generatedMs = Date.parse(index.generated_at);

  // Die Vollboard-Zeilen, nach Ticker greifbar. Sie sind hier NICHT das Universum, sondern
  // die Quelle der Engine-Beigaben (score, lamps, axisBreakdown, Kohorte, geprueftes marketCap)
  // fuer die Namen, die es auf ein Brett geschafft haben.
  const boardZeilen = new Map();
  let keinVollboard = 0;
  for (const branch of branches) {
    const board = readJsonOrNull(path.join(v1Dir, 'full', branch + '.json'));
    if (!board) { keinVollboard++; continue; }
    for (const track of ['profitable', 'unprofitable']) {
      for (const row of (Array.isArray(board[track]) ? board[track] : [])) {
        if (row && typeof row.ticker === 'string' && !boardZeilen.has(row.ticker)) {
          boardZeilen.set(row.ticker, { row, branch, track });
        }
      }
    }
  }

  const kandidaten = [];
  const abgewiesen = {
    keinVollboard, nichtGeroutet: 0, datenSuspekt: 0, sektorAusgeschlossen: 0, keinWachstum: 0,
    fcfUnterdrueckt: 0, fcfUngueltig: 0, fcfUeberUmsatz: 0, einheitenVerdacht: 0,
    basisQuartalStub: 0, veraltet: 0, frischeUnbekannt: 0, ohneRang: 0, snapshotUnlesbar: 0,
    dupEmittent: 0,
  };
  let gelesen = 0;

  // NICHT `!f.startsWith('_')`: Ticker, deren Name unter Windows reserviert ist (CON, PRN,
  // AUX ...), liegen als `_CON.json` auf der Platte. Der Blanket-Filter warf sie still aus
  // dem Universum; isMetadataSnapshot (lib/snapshot-fs.js) kennt genau die zwei echten
  // Metadaten-Dateien. Waechter: tests/p1-welle8-metadata-filter.test.js.
  const dateien = fs.readdirSync(snapshotsDir).filter((f) => f.endsWith('.json') && !isMetadataSnapshot(f));
  for (const datei of dateien) {
    gelesen++;
    const ticker = datei.slice(0, -5);
    const snapshot = readJsonOrNull(path.join(snapshotsDir, datei));
    // Ein UNLESBARER Snapshot ist etwas anderes als ein fehlender: er wird gezaehlt, damit
    // ein kaputter Pull nicht als "kleines Universum" durchgeht.
    if (!snapshot) { abgewiesen.snapshotUnlesbar++; continue; }
    const meta = snapshot.meta || {};

    // Universum = das GEROUTETE Universum, nicht die Brett-Zeilen. Die Vollboards sind die
    // besten 150 je Branche NACH ENGINE-SCORE — eine R40-Liste, die durch genau die Formel
    // vorgefiltert ist, an der Karl zweifelt, waere keine Gegenprobe, und reife Namen mit
    // hoher Marge und massvollem Wachstum fehlten.
    const r = route(snapshot);
    if (!r || r.action !== 'route') { abgewiesen.nichtGeroutet++; continue; }

    if (datenSuspekt(snapshot)) { abgewiesen.datenSuspekt++; continue; }

    const sector = typeof meta.sector === 'string' ? meta.sector : null;
    if (sector !== null && SEKTOR_AUSSCHLUSS.includes(sector)) {
      abgewiesen.sektorAusgeschlossen++; continue;
    }

    const auchAufBrett = boardZeilen.get(ticker) || null;
    // Das Belegbarkeits-Gate (18.08.2026) hat dieser Zeile den Rang verweigert. Wer nicht
    // genug belegte Achsen hat, bekommt auch hier keinen Rang — das Brett ist keine
    // Hintertuer um dieses Gate herum. Fuer Namen OHNE Brett-Zeile gibt es kein Urteil,
    // also auch keinen Ausschluss.
    if (auchAufBrett && auchAufBrett.row.rankGrund !== null && auchAufBrett.row.rankGrund !== undefined) {
      abgewiesen.ohneRang++; continue;
    }

    // EIN Wachstumsbegriff fuer alle: derselbe Aufruf wie score.js:1348 (ohne growthBounds).
    // Fuer Brett-Namen ist das per Konstruktion dieselbe Zahl wie ihr revGrowthYoYPct.
    const wachstumRoh = axesFns.revGrowthLevel(snapshot);
    if (!istZahl(wachstumRoh)) { abgewiesen.keinWachstum++; continue; }

    if (meta.fcfMarginTTMSuppressed) { abgewiesen.fcfUnterdrueckt++; continue; }
    const fcf = metricVal(snapshot, 'fcfMarginTTM');
    if (!fcfMargeVertrauenswuerdig(fcf, norm(snapshot, 'annualFCF'), norm(snapshot, 'annualOCF'))) {
      abgewiesen.fcfUngueltig++; continue;
    }
    if (einheitenVerdacht(wachstumRoh, fcf)) { abgewiesen.einheitenVerdacht++; continue; }
    if (fcf > MAX_FCF_MARGIN_PCT) { abgewiesen.fcfUeberUmsatz++; continue; }

    const revenueTTM = metricVal(snapshot, 'revenueTTM');
    const basis = basisQuartal(snapshot);
    if (basis !== null && istZahl(revenueTTM) && revenueTTM > 0
        && basis < MIN_BASE_QUARTER_SHARE * (revenueTTM / 4)) {
      abgewiesen.basisQuartalStub++; continue;
    }

    const quartalsEndeMs = neuestesQuartalsEnde(snapshot);
    if (quartalsEndeMs === null) {
      // ANZEIGE-Regel, keine Waechter-Logik: "unbekannt" ist nach wie vor nicht "veraltet",
      // und der Frische-Waechter faellt hier ausdruecklich KEIN Urteil. Aber wenn niemand
      // sagen kann, ueber welchen Zeitraum eine Zahl spricht, gehoert sie nicht in eine
      // Rangliste, die einem Profi gezeigt wird — er kann sie nicht nachpruefen.
      // Weiterhin gezaehlt, damit der Unterschied zu "geprueft und in Ordnung" sichtbar ist.
      abgewiesen.frischeUnbekannt++; continue;
    }
    if ((generatedMs - quartalsEndeMs) / 86400000 > MAX_FISCAL_AGE_DAYS) {
      abgewiesen.veraltet++; continue;
    }

    kandidaten.push({
      ticker,
      // Nur was der Emittenten-Dedup braucht: meta (Name, Boerse, Domizil, Waehrungen) und
      // marketCap. Die vollen Snapshots von 7.500 Namen im Speicher zu halten waere teuer
      // und unnoetig — issuerKeyLoose/isUS/isUsPrimaryListing/fxSuspect lesen meta,
      // mcapOf liest s.marketCap.
      snapshot: { meta, marketCap: snapshot.marketCap },
      row: auchAufBrett ? auchAufBrett.row : null,
      branch: auchAufBrett ? auchAufBrett.branch : r.formulaId,
      // Track ohne Brett-Zeile aus dem Vorzeichen der (hier per G0-G2 belegten) Marge —
      // genau die Regel, die fcfTrack bei gueltiger Marge anwendet.
      track: auchAufBrett ? auchAufBrett.track : (fcf >= 0 ? 'profitable' : 'unprofitable'),
      onBoard: !!auchAufBrett,
      // NUR die belegte USD-Marktkap der Vollboard-Zeile. Ohne Vollboard-Zeile gibt es
      // keinen Handelskurs-Beleg (write-findash-export.js:298-311) und damit keine
      // Groessen-Behauptung — die Zeile faellt in die untere Gruppe.
      marketCap: auchAufBrett && istZahl(auchAufBrett.row.marketCap) ? auchAufBrett.row.marketCap : null,
      meta,
      wachstumRoh,
      fcfMarginPct: fcf,
      ebitdaMarginPct: ebitdaMargePct(snapshot, wachstumRoh),
      industry: typeof meta.industry === 'string' ? meta.industry : null,
      quartalsEnde: quartalsEndeMs === null ? null : new Date(quartalsEndeMs).toISOString(),
    });
  }

  // EMITTENTEN-DEDUP, mit der Funktion der Produktion (score.js) statt einer zweiten Regel.
  // Das geroutete Universum enthaelt jede NOTIERUNG; die Vollboards waren bereits dedupliziert,
  // dieser Weg ist es nicht. Ohne das stand Palantir am Stand 2026-08-29 sechsmal im Brett
  // (PLTR, PLTR.SW, PLTR.VI, PLTR.WA, PTX.DE, 1PLTR.MI) — und zwar mit ZWEI verschiedenen
  // r40-Werten (127,9 und 118,3), weil die Beine unterschiedlich gute Daten tragen.
  // Gewinner-Regel wie im Scoring: US-Primaerlisting, dann US-Domizil, dann FX-Vertrauen,
  // dann groesste marketCap, dann Ticker.
  const verloren = new Set();
  for (const gruppe of issuerDedupGroups(kandidaten)) {
    if (gruppe.length < 2) continue;
    gruppe.sort(issuerDedupComparator);
    for (const k of gruppe.slice(1)) verloren.add(k.ticker);
  }
  abgewiesen.dupEmittent = verloren.size;
  const entdoppelt = kandidaten.filter((k) => !verloren.has(k.ticker));

  return { index, kandidaten: entdoppelt, abgewiesen, gelesen, aufBrett: boardZeilen.size };
}

// ---------------------------------------------------------------------------
// Zeilen bauen
// ---------------------------------------------------------------------------
/**
 * Aus den Kandidaten das Brett bauen: Wachstumsterm klemmen (p1/p99 des eigenen Universums),
 * r40 rechnen, ab R40_MIN aufnehmen, je Gruppe TOP_N, Vereinigung, nach r40 durchnummerieren.
 */
function baueZeilen(kandidaten) {
  const bounds = kandidaten.length >= MIN_WINSOR_SAMPLE
    ? winsorTailBounds(kandidaten.map((k) => k.wachstumRoh))
    : null;
  const klemme = (g) => (bounds ? Math.max(bounds[0], Math.min(bounds[1], g)) : g);

  const mitR40 = kandidaten.map((k) => {
    const wachstum = klemme(k.wachstumRoh);
    const r40 = wachstum + k.fcfMarginPct;
    const r40Ebitda = k.ebitdaMarginPct === null ? null : wachstum + k.ebitdaMarginPct;
    return Object.assign({}, k, { wachstum, r40, r40Ebitda, gruppe: r40GruppeVon(k.industry) });
  }).filter((k) => k.r40 >= R40_MIN);

  const nachR40 = (a, b) => b.r40 - a.r40 || a.ticker.localeCompare(b.ticker);
  mitR40.sort(nachR40);
  // JE GRUPPE zwei Toepfe: oberhalb der Anzeige-Grenze ALLES, unterhalb die besten TOP_N.
  // Vorher bekam nur 'software' eine eigene Liste und 'other' musste sich ueber die
  // Gesamtliste qualifizieren — dominiert Software das Mass (und das tut es), fiel die ganze
  // Rest-Gruppe heraus: 200 Software-Zeilen und 100 zulaessige Industrie-Zeilen ergaben 150
  // Zeilen, davon 0 'other' (Befund JS-Review 17.09., nachgestellt).
  const grossGenug = (k) => istZahl(k.marketCap) && k.marketCap >= DISPLAY_LARGE_MCAP_USD;
  const jeGruppe = new Map();
  let gross = 0, klein = 0;
  for (const k of mitR40) {
    if (!jeGruppe.has(k.gruppe)) jeGruppe.set(k.gruppe, { gross: [], klein: [] });
    const toepfe = jeGruppe.get(k.gruppe);
    if (grossGenug(k)) { toepfe.gross.push(k); gross++; }
    else if (toepfe.klein.length < TOP_N) { toepfe.klein.push(k); klein++; }
  }

  const gewaehlt = new Map();
  // Beide Listen sind nach r40 fallend: der ERSTE Treffer eines Tickers ist der beste.
  // set() wuerde ihn durch den schlechteren ueberschreiben.
  for (const t of jeGruppe.values()) {
    for (const k of t.gross.concat(t.klein)) {
      if (!gewaehlt.has(k.ticker)) gewaehlt.set(k.ticker, k);
    }
  }
  const ausgewaehlt = Array.from(gewaehlt.values()).sort(nachR40);

  return {
    bounds,
    ueber40: mitR40.length,
    grossExportiert: gross,
    kleinExportiert: klein,
    rows: ausgewaehlt.map((k, i) => {
      const row = k.row || {};
      const ov = row.overview || {};
      const zeile = {
        rank: i + 1,
        rankGrund: null,               // das Brett fuehrt nur Zeilen, die die Achsenbelege haben
        ticker: k.ticker,
        formulaId: k.branch,           // Herkunftsbrett bzw. Router-Formel; traegt den boardStatus-Schluessel
        track: k.track,
        // Engine-Score, unveraendert — und NULL fuer Namen, die auf keinem Brett stehen.
        // Eine 0 waere dort eine Behauptung ueber die Firma, die niemand aufgestellt hat.
        score: k.onBoard && istZahl(row.score) ? row.score : null,
        overviewKind: typeof ov.kind === 'string' ? ov.kind : null,
        overviewValue: istZahl(ov.value) ? ov.value : null,
        overviewCompanion: istZahl(ov.companion) ? ov.companion : null,
        lamps: Array.isArray(row.lamps) ? row.lamps : [],
      };
      for (const f of PASSTHROUGH_FIELDS) zeile[f] = (f in row) ? row[f] : null;
      if (!k.onBoard) {
        // Ohne Brett-Zeile kommen die Stammdaten aus dem Snapshot. marketCap bleibt
        // BEWUSST null: der v1-Vertrag sagt marketCap ist IMMER USD, und der Beleg fuer die
        // Handelskurs-Umrechnung liegt im Haupt-Schreiber (write-findash-export.js:298-311),
        // nicht hier. Eine ungeprueft durchgereichte Lokalwaehrungs-Zahl saehe aus wie USD.
        zeile.name = typeof k.meta.longName === 'string' ? k.meta.longName
          : (typeof k.meta.shortName === 'string' ? k.meta.shortName : null);
        zeile.country = typeof k.meta.country === 'string' ? k.meta.country : null;
        zeile.sector = typeof k.meta.sector === 'string' ? k.meta.sector : null;
        zeile.marketCap = null;
        zeile.marketCapCurrency = 'USD';
        zeile.tradingFxRateApplied = null;
      }
      // Additiv, nur dieses Brett:
      zeile.r40 = round1(k.r40);
      zeile.revGrowthPctUsed = round1(k.wachstum);   // geklemmt; r40 = dieser Wert + fcfMarginPct
      zeile.revGrowthYoYPct = round1(k.wachstumRoh); // roh, EIN Begriff fuer Brett- und Nicht-Brett-Namen
      zeile.fcfMarginPct = round1(k.fcfMarginPct);
      zeile.ebitdaMarginPct = k.ebitdaMarginPct === null ? null : round1(k.ebitdaMarginPct);
      zeile.r40Ebitda = k.r40Ebitda === null ? null : round1(k.r40Ebitda);
      zeile.industry = k.industry;
      zeile.r40Group = k.gruppe;
      zeile.onBoard = k.onBoard;
      zeile.quartalsEnde = k.quartalsEnde;
      return zeile;
    }),
  };
}

// ---------------------------------------------------------------------------
// Huellen
// ---------------------------------------------------------------------------
function buildOverview(index, rows) {
  return {
    schema: SCHEMA,
    generated_at: index.generated_at,   // aus DEMSELBEN Lauf — findash prueft das (screener.js:364)
    coverage: index.coverage === undefined ? null : index.coverage,
    rows,
  };
}

function buildIndex(index, rows, meta) {
  const boardStatus = { [BOARD_ID]: BOARD_STATUS };
  for (const r of rows) boardStatus[r.formulaId] = BOARD_STATUS;
  const counts = { profitable: 0, unprofitable: 0 };
  for (const r of rows) {
    if (r.track === 'profitable') counts.profitable++;
    else if (r.track === 'unprofitable') counts.unprofitable++;
  }
  return {
    schema: SCHEMA,
    generated_at: index.generated_at,
    coverage: index.coverage === undefined ? null : index.coverage,
    generatedFromSnapshots: index.generatedFromSnapshots === undefined ? null : index.generatedFromSnapshots,
    boards: [BOARD_ID],
    boardStatus,
    counts: { [BOARD_ID]: counts },
    rule40: {
      universeBasis: meta.universeBasis,     // 'routed' = geroutetes Universum, 'boards' = nur Brett-Zeilen
      r40Min: R40_MIN,
      topN: TOP_N,
      minBaseQuarterShare: MIN_BASE_QUARTER_SHARE,
      maxFiscalAgeDays: MAX_FISCAL_AGE_DAYS,
      maxFcfMarginPct: MAX_FCF_MARGIN_PCT,
      minWinsorSample: MIN_WINSOR_SAMPLE,
      displayLargeMcapUsd: DISPLAY_LARGE_MCAP_USD,
      sectorExclusions: SEKTOR_AUSSCHLUSS,
      softwareIndustries: SOFTWARE_INDUSTRIES,
      // p1/p99 des eigenen Kandidaten-Universums — damit die Oberflaeche sagen kann, wo
      // der Deckel sitzt, statt ihn zu verschweigen. null = nicht geklemmt.
      growthBounds: meta.bounds ? { p1: meta.bounds[0], p99: meta.bounds[1] } : null,
      // Zaehler fuer den Erklaer-Kasten. Ohne sie sieht "kleines Brett" aus wie "Daten fehlen".
      counts: {
        universeBasis: meta.universeBasis,
        universe: meta.gelesen,
        onBoard: meta.aufBrett,
        computable: meta.kandidaten,
        above40: meta.ueber40,
        exported: rows.length,
        exportedLargeCap: meta.grossExportiert,
        exportedSmallCap: meta.kleinExportiert,
        excludedNotRouted: meta.abgewiesen.nichtGeroutet,
        excludedDataSuspect: meta.abgewiesen.datenSuspekt,
        excludedSector: meta.abgewiesen.sektorAusgeschlossen,
        excludedOutlier: meta.abgewiesen.einheitenVerdacht,
        excludedStale: meta.abgewiesen.veraltet,
        excludedNoPeriod: meta.abgewiesen.frischeUnbekannt,
        excludedTinyBase: meta.abgewiesen.basisQuartalStub,
        excludedFcfAboveRevenue: meta.abgewiesen.fcfUeberUmsatz,
        excludedDuplicateIssuer: meta.abgewiesen.dupEmittent,
        noValidMargin: meta.abgewiesen.fcfUngueltig + meta.abgewiesen.fcfUnterdrueckt,
        noGrowth: meta.abgewiesen.keinWachstum,
        noRank: meta.abgewiesen.ohneRang,
        unreadableSnapshot: meta.abgewiesen.snapshotUnlesbar,
        missingFullBoard: meta.abgewiesen.keinVollboard,
      },
      rejected: meta.abgewiesen,
    },
  };
}

// ---------------------------------------------------------------------------
// Schreiben
// ---------------------------------------------------------------------------
/**
 * Vor jedem rmSync: der Zielordner MUSS der rule40-Ordner unter dem v1-Verzeichnis sein.
 * leereVerzeichnis loescht rekursiv und wird auch auf dem FEHLER-Weg aufgerufen — ein
 * falsch gesetztes RULE40_OUT_DIR (z. B. auf v1 selbst oder die Repo-Wurzel) wuerde den
 * ganzen Haupt-Export loeschen, und `|| true` im Workflow hielte den Lauf dabei gruen
 * (Befund F10). Geprueft wird NUR der Ordnername: ein eigener Ausgabe-Ort (Fixture-Lauf,
 * Schattenlauf) ist legitim, ein Loeschen ausserhalb eines rule40-Ordners nie. Eine
 * strengere Regel (muss unter v1 liegen) hat im Versuch genau das Gegenteil bewirkt —
 * sie verhinderte auf dem FEHLER-Weg das Schreiben des Markers.
 */
function pruefeZielordner(dir) {
  const ziel = path.resolve(dir);
  if (path.basename(ziel) !== BOARD_ID) {
    throw new Error('[rule40] Zielordner "' + ziel + '" heisst nicht "' + BOARD_ID
      + '" — hier wird rekursiv geloescht, das passiert nur im eigenen Ordner.');
  }
  return ziel;
}

function leereVerzeichnis(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
}

function schreibeBrett(outDir, overview, indexDatei) {
  pruefeZielordner(outDir);
  leereVerzeichnis(outDir);
  writeJsonAtomic(path.join(outDir, 'overview.json'), overview);
  writeJsonAtomic(path.join(outDir, 'index.json'), indexDatei);
}

/**
 * Fehl-Marker statt Alt-Stand. Der Ordner wird geleert und traegt danach NUR _failed:
 * findash ersetzt seinen lokalen Spiegel dann durch den Ausfall-Stub, statt das Brett von
 * gestern als das von heute zu servieren (screener-sync.js:203-213).
 */
function schreibeFehlmarker(outDir, grund) {
  pruefeZielordner(outDir);
  leereVerzeichnis(outDir);
  writeJsonAtomic(path.join(outDir, FAILED_NAME), {
    schema: SCHEMA,
    generated_at: new Date().toISOString(),
    failed: true,
    board: BOARD_ID,
    reason: String(grund),
  });
}

function build(opts = {}) {
  const v1Dir = opts.v1Dir || DEFAULT_V1_DIR;
  const outDir = opts.outDir || path.join(v1Dir, BOARD_ID);
  const { index, kandidaten, abgewiesen, gelesen, aufBrett } = sammleKandidaten(opts);
  if (!kandidaten.length) {
    throw new Error('[rule40] kein einziger rechenbarer Kandidat aus ' + gelesen + ' Zeilen ('
      + JSON.stringify(abgewiesen) + ') — ein leeres Brett waere eine Aussage, die niemand belegt hat.');
  }
  const { rows, bounds, ueber40, grossExportiert, kleinExportiert } = baueZeilen(kandidaten);
  // Die Leer-Pruefung sitzt HINTER der Auswahl, nicht davor: Kandidaten zu haben und trotzdem
  // keine Zeile ueber der Schwelle ist derselbe unbelegte Zustand wie gar keine Kandidaten —
  // er wuerde sonst als leeres, gueltiges Brett mit Exit 0 veroeffentlicht (Befund F6).
  if (!rows.length) {
    throw new Error('[rule40] kein einziger Kandidat ueber r40 >= ' + R40_MIN + ' (' + kandidaten.length
      + ' rechenbar aus ' + gelesen + ' gelesen, ' + JSON.stringify(abgewiesen)
      + ') — ein leeres Brett waere eine Aussage, die niemand belegt hat.');
  }
  const overview = buildOverview(index, rows);
  const indexDatei = buildIndex(index, rows, {
    bounds, kandidaten: kandidaten.length, gelesen, abgewiesen, aufBrett, ueber40,
    grossExportiert, kleinExportiert, universeBasis: 'routed',
  });
  schreibeBrett(outDir, overview, indexDatei);
  return { outDir, rows: rows.length, kandidaten: kandidaten.length, gelesen, abgewiesen, bounds, ueber40, aufBrett };
}

// ---------------------------------------------------------------------------
// --check
// ---------------------------------------------------------------------------
/**
 * Prueft das GESCHRIEBENE Brett gegen den Vertrag und gegen sich selbst. Das Tor sitzt
 * bewusst hinter dem Schreiben: was hier faellt, hat es bis auf die Platte geschafft und
 * muss den Deploy anhalten (bzw. den Marker bekommen).
 */
function check(opts = {}) {
  const v1Dir = opts.v1Dir || DEFAULT_V1_DIR;
  const outDir = opts.outDir || path.join(v1Dir, BOARD_ID);
  const fehler = [];
  const melde = (m) => fehler.push(m);

  if (fs.existsSync(path.join(outDir, FAILED_NAME))) {
    return { ok: false, failedMarker: true, errors: ['[rule40] ' + FAILED_NAME + ' liegt im Ordner — der Lauf hat sich selbst als gescheitert markiert.'] };
  }

  const hauptIndex = readJsonOrNull(path.join(v1Dir, 'index.json'));
  const overview = readJsonOrNull(path.join(outDir, 'overview.json'));
  const idx = readJsonOrNull(path.join(outDir, 'index.json'));
  if (!overview) melde('[rule40] overview.json fehlt oder ist kein gueltiges JSON.');
  if (!idx) melde('[rule40] index.json fehlt oder ist kein gueltiges JSON.');
  if (!overview || !idx) return { ok: false, errors: fehler };

  for (const [name, datei] of [['overview.json', overview], ['index.json', idx]]) {
    if (datei.schema !== SCHEMA) melde('[rule40] ' + name + ': Schema "' + datei.schema + '" statt "' + SCHEMA + '".');
    for (const f of ['schema', 'generated_at', 'coverage']) {
      if (!(f in datei)) melde('[rule40] ' + name + ': Pflichtfeld "' + f + '" der Huelle fehlt.');
    }
  }
  if (hauptIndex && overview.generated_at !== hauptIndex.generated_at) {
    melde('[rule40] overview.generated_at (' + overview.generated_at + ') != index.json des Laufs ('
      + hauptIndex.generated_at + ') — findash wuerde die Bretter als aus verschiedenen Laeufen melden.');
  }
  if (idx.generated_at !== overview.generated_at) {
    melde('[rule40] index.generated_at != overview.generated_at — dasselbe Brett mit zwei Herkuenften.');
  }
  if (!idx.boardStatus || typeof idx.boardStatus !== 'object') {
    melde('[rule40] index.boardStatus fehlt — findash liest daraus den Status jeder Zeile.');
  } else {
    for (const [b, s] of Object.entries(idx.boardStatus)) {
      if (s !== 'core' && s !== 'diagnostic') melde('[rule40] boardStatus.' + b + ' = "' + s + '" ist kein erlaubter Wert.');
    }
  }
  if (!idx.counts || typeof idx.counts !== 'object') {
    melde('[rule40] index.counts fehlt — der Konsument prueft genau boardStatus UND counts (screener-sync.js:127).');
  }

  const rows = Array.isArray(overview.rows) ? overview.rows : null;
  if (!rows) { melde('[rule40] overview.rows ist kein Array.'); return { ok: false, errors: fehler }; }
  if (!rows.length) melde('[rule40] overview.rows ist leer.');

  const gesehen = new Set();
  let letzterR40 = Infinity;
  rows.forEach((r, i) => {
    for (const f of REQUIRED_OVERVIEW_ROW) {
      if (!(f in r)) melde('[rule40] Zeile ' + i + ' (' + r.ticker + '): Pflichtfeld "' + f + '" fehlt.');
    }
    if (r.track !== 'profitable' && r.track !== 'unprofitable') {
      melde('[rule40] Zeile ' + i + ' (' + r.ticker + '): track "' + r.track + '" ist kein erlaubter Wert.');
    }
    if (gesehen.has(r.ticker)) melde('[rule40] Ticker ' + r.ticker + ' steht zweimal im Brett.');
    gesehen.add(r.ticker);
    if (r.rank !== i + 1) melde('[rule40] Zeile ' + i + ' (' + r.ticker + '): rank ' + r.rank + ' statt ' + (i + 1) + '.');
    if (!istZahl(r.r40)) melde('[rule40] Zeile ' + i + ' (' + r.ticker + '): r40 ist keine endliche Zahl.');
    else {
      if (r.r40 > letzterR40 + 1e-9) melde('[rule40] Zeile ' + i + ' (' + r.ticker + '): r40 ' + r.r40 + ' > vorige Zeile ' + letzterR40 + ' — nicht nach r40 sortiert.');
      letzterR40 = r.r40;
      if (r.r40 < R40_MIN - 1e-9) melde('[rule40] Zeile ' + i + ' (' + r.ticker + '): r40 ' + r.r40 + ' unter der Aufnahmeschwelle ' + R40_MIN + '.');
      // Die Arithmetik muss aufgehen, sonst ist "durchsichtig" ein leeres Wort.
      if (istZahl(r.revGrowthPctUsed) && istZahl(r.fcfMarginPct)) {
        const summe = round1(r.revGrowthPctUsed + r.fcfMarginPct);
        if (Math.abs(summe - r.r40) > 0.11) {
          melde('[rule40] Zeile ' + i + ' (' + r.ticker + '): r40 ' + r.r40 + ' != revGrowthPctUsed '
            + r.revGrowthPctUsed + ' + fcfMarginPct ' + r.fcfMarginPct + ' (= ' + summe + ').');
        }
      } else melde('[rule40] Zeile ' + i + ' (' + r.ticker + '): revGrowthPctUsed/fcfMarginPct fehlen — r40 waere nicht nachrechenbar.');
    }
    // Die EBITDA-Spalte ist eine Nebenspalte, aber sie behauptet dieselbe Arithmetik.
    // Ohne diese Zeile koennte ein Rechenfehler in ihr unbemerkt ausgeliefert werden.
    if (istZahl(r.r40Ebitda) && istZahl(r.revGrowthPctUsed) && istZahl(r.ebitdaMarginPct)) {
      const summeE = round1(r.revGrowthPctUsed + r.ebitdaMarginPct);
      if (Math.abs(summeE - r.r40Ebitda) > 0.11) {
        melde('[rule40] Zeile ' + i + ' (' + r.ticker + '): r40Ebitda ' + r.r40Ebitda
          + ' != revGrowthPctUsed ' + r.revGrowthPctUsed + ' + ebitdaMarginPct '
          + r.ebitdaMarginPct + ' (= ' + summeE + ').');
      }
    }
    if (r.r40Group !== 'software' && r.r40Group !== 'other') {
      melde('[rule40] Zeile ' + i + ' (' + r.ticker + '): r40Group "' + r.r40Group + '" ist kein erlaubter Wert.');
    }
  });

  return { ok: fehler.length === 0, errors: fehler, rows: rows.length };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
function main(argv) {
  const v1Dir = process.env.RULE40_V1_DIR || DEFAULT_V1_DIR;
  const snapshotsDir = process.env.RULE40_SNAPSHOTS_DIR || DEFAULT_SNAPSHOTS_DIR;
  const outDir = process.env.RULE40_OUT_DIR || path.join(v1Dir, BOARD_ID);
  const opts = { v1Dir, snapshotsDir, outDir };

  if (argv.includes('--check')) {
    const res = check(opts);
    if (res.ok) {
      console.log('[rule40] --check ok (' + res.rows + ' Zeilen).');
      return 0;
    }
    for (const e of res.errors) console.error('::error::' + e);
    // Ein Brett, das sein eigenes Tor nicht besteht, darf nicht als gueltiges Brett
    // veroeffentlicht werden — auch dann nicht, wenn der CI-Schritt fail-soft laeuft
    // (`|| true`). Der Marker macht aus "durchgewunken" ein sichtbares "ausgefallen".
    if (!res.failedMarker) {
      try {
        schreibeFehlmarker(outDir, 'check failed: ' + res.errors.join(' | '));
        console.error('::warning::[rule40] ' + FAILED_NAME + ' geschrieben — das Brett faellt sichtbar aus, statt fehlerhaft ausgeliefert zu werden.');
      } catch (e) {
        console.error('::error::[rule40] konnte nach dem gescheiterten --check keinen Fehl-Marker schreiben: ' + (e && e.message ? e.message : e));
      }
    }
    return 1;
  }

  try {
    const res = build(opts);
    console.log('[rule40] ' + res.rows + ' Zeilen aus ' + res.kandidaten + ' Kandidaten ('
      + res.gelesen + ' gelesen) -> ' + res.outDir);
    console.log('[rule40] Winsor-Schranken Wachstum: ' + JSON.stringify(res.bounds));
    console.log('[rule40] abgewiesen: ' + JSON.stringify(res.abgewiesen));
    return 0;
  } catch (e) {
    console.error('::error::[rule40] Build gescheitert: ' + (e && e.message ? e.message : e));
    try {
      schreibeFehlmarker(outDir, (e && e.message) || e);
      console.error('::warning::[rule40] ' + FAILED_NAME + ' geschrieben — findash zeigt das Brett als ausgefallen statt den Stand von gestern.');
    } catch (e2) {
      console.error('::error::[rule40] konnte nicht einmal den Fehl-Marker schreiben: ' + (e2 && e2.message ? e2.message : e2));
    }
    return 1;
  }
}

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}

module.exports = {
  SCHEMA, BOARD_ID, BOARD_STATUS, FAILED_NAME, SOFTWARE_INDUSTRIES,
  R40_MIN, TOP_N, DISPLAY_LARGE_MCAP_USD, MIN_BASE_QUARTER_SHARE, MAX_FISCAL_AGE_DAYS, MAX_FCF_MARGIN_PCT,
  MIN_WINSOR_SAMPLE, SEKTOR_AUSSCHLUSS,
  REQUIRED_OVERVIEW_ROW, PASSTHROUGH_FIELDS,
  basisQuartal, einheitenVerdacht, ebitdaMargePct, r40GruppeVon, datenSuspekt,
  neuestesQuartalsEnde, fcfMargeVertrauenswuerdig,
  sammleKandidaten, baueZeilen, buildOverview, buildIndex,
  schreibeBrett, schreibeFehlmarker, pruefeZielordner, build, check, main,
};

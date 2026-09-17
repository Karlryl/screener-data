#!/usr/bin/env node
'use strict';
/**
 * scripts/write-rule40-export.js — das Rule-of-40-Brett als eigenes Neben-Board.
 *
 * WO ER LAEUFT: im scoring-Job, NACH write-findash-export.js (er liest dessen Ergebnis)
 * und VOR dem Pages-Deploy. Er rechnet KEINE Achse und KEINEN Score neu — er liest die
 * fertigen Vollboards, holt sich den einen fehlenden Term (die FCF-Marge) aus den
 * Snapshots und schreibt outputs/findash-export/v1/rule40/{index.json,overview.json}
 * in derselben Huelle und Zeilenform wie quality/ und smallcap/.
 *
 * R40 = Umsatzwachstum (%) + FCF-Marge TTM (%). Das ist ruleOfX mit alpha = 1
 * (src/scoring/axes.js:257). Der Unterschied zur Achse: hier steht die ZAHL im Brett,
 * nicht ihr Kohorten-Perzentil. Deshalb ist das Brett boardStatus='diagnostic' — eine
 * durchsichtige Arithmetik neben dem Score, nie im Score.
 *
 * FUENF REGELN, DIE DIESE DATEI TRAEGT
 *  1. NICHTS NEU RECHNEN, WAS ES SCHON GIBT. Wachstum kommt aus revGrowthYoYPct des
 *     Exports (quartals-YoY mit Jahres-Fallback, F-4), die FCF-Marge laeuft durch
 *     fcfMarginValid() (engine.js:106-131) statt roh aus metrics. Beide Quellen sind
 *     read-only; diese Datei fasst src/scoring/ nicht an.
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
const { norm, metricVal, jahresVergleichIdx } = require('../src/scoring/snapshot.js');
const { fcfMarginValid } = require('../src/scoring/engine.js');
const { winsorTailBounds } = require('../src/scoring/score.js');

const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_V1_DIR = path.join(REPO_ROOT, 'outputs', 'findash-export', 'v1');
const DEFAULT_SNAPSHOTS_DIR = path.join(REPO_ROOT, 'snapshots');

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
/** Je Gruppe die besten TOP_N; das Brett ist die Vereinigung beider Listen. */
const TOP_N = 150;
/**
 * Das Vorjahresquartal muss mindestens dieser Anteil eines Durchschnittsquartals (revenueTTM/4)
 * sein — darunter ist es eine Teilmeldung/Umstellung und die YoY-Zahl ein Meldeartefakt.
 * Gemessen am Stand 2026-08-29 ueber 4.603 Zeilen mit Quartalsbein: der gesunde Koerper liegt
 * bei p5 = 0,59 / p50 = 0,92, die Phantomzeilen bei 0,001-0,16.
 */
const MIN_BASE_QUARTER_SHARE = 0.25;
/**
 * Aelter als das darf der Fundamentalstand einer Zeile gegenueber generated_at nicht sein —
 * eine TTM-Marge aus einem halbjahresalten Snapshot ist keine Aussage ueber heute. Gemessen
 * am selben Stand: p99 = 27 Tage, Maximum 52 Tage, also rund doppelter Abstand zum Normalfall.
 */
const MAX_FUNDAMENTALS_AGE_DAYS = 120;
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
  const kandidaten = [];
  const abgewiesen = {
    keinVollboard: 0, keinWachstum: 0, keinSnapshot: 0, fcfUnterdrueckt: 0,
    fcfUngueltig: 0, fcfUeberUmsatz: 0, einheitenVerdacht: 0, basisQuartalStub: 0,
    veraltet: 0, ohneRang: 0,
  };
  let gelesen = 0;

  for (const branch of branches) {
    const boardPfad = path.join(v1Dir, 'full', branch + '.json');
    const board = readJsonOrNull(boardPfad);
    if (!board) { abgewiesen.keinVollboard++; continue; }

    for (const track of ['profitable', 'unprofitable']) {
      const zeilen = Array.isArray(board[track]) ? board[track] : [];
      for (const row of zeilen) {
        gelesen++;
        // Das Belegbarkeits-Gate (18.08.2026) hat dieser Zeile den Rang verweigert. Wer nicht
        // genug belegte Achsen hat, bekommt auch hier keine Rangnummer — sonst waere das Brett
        // die Hintertuer um ein Gate herum.
        if (row.rankGrund !== null && row.rankGrund !== undefined) { abgewiesen.ohneRang++; continue; }

        const wachstumRoh = row.revGrowthYoYPct;
        if (!istZahl(wachstumRoh)) { abgewiesen.keinWachstum++; continue; }

        const snapshot = readJsonOrNull(path.join(snapshotsDir, row.ticker + '.json'));
        if (!snapshot) { abgewiesen.keinSnapshot++; continue; }
        const meta = snapshot.meta || {};

        if (meta.fcfMarginTTMSuppressed) { abgewiesen.fcfUnterdrueckt++; continue; }
        const fcf = metricVal(snapshot, 'fcfMarginTTM');
        if (!fcfMarginValid(fcf, norm(snapshot, 'annualFCF'), norm(snapshot, 'annualOCF'))) {
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

        const asOf = typeof meta.fundamentalsAsOf === 'string' ? meta.fundamentalsAsOf : null;
        if (asOf !== null) {
          const alterTage = (generatedMs - Date.parse(asOf)) / 86400000;
          if (Number.isFinite(alterTage) && alterTage > MAX_FUNDAMENTALS_AGE_DAYS) {
            abgewiesen.veraltet++; continue;
          }
        }

        kandidaten.push({
          row,
          branch,
          track,
          wachstumRoh,
          fcfMarginPct: fcf,
          ebitdaMarginPct: ebitdaMargePct(snapshot, wachstumRoh),
          industry: typeof meta.industry === 'string' ? meta.industry : null,
          fundamentalsAsOf: asOf,
        });
      }
    }
  }

  return { index, kandidaten, abgewiesen, gelesen };
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

  const nachR40 = (a, b) => b.r40 - a.r40 || a.row.ticker.localeCompare(b.row.ticker);
  mitR40.sort(nachR40);
  // JE GRUPPE die besten TOP_N, dann die Vereinigung. Vorher bekam nur 'software' eine
  // eigene Liste und 'other' musste sich ueber die Gesamtliste qualifizieren — dominiert
  // Software das Mass (und das tut es), fiel die ganze Rest-Gruppe heraus: 200 Software-
  // Zeilen und 100 zulaessige Industrie-Zeilen ergaben 150 Zeilen, davon 0 'other',
  // obwohl alle 100 ueber der Aufnahmeschwelle lagen. Karls zweite Ansicht waere leer
  // gewesen (Befund JS-Review 17.09., nachgestellt). Die Gesamt-Top-150 ist in dieser
  // Vereinigung enthalten: wer gesamt vorne liegt, liegt auch in seiner Gruppe vorne.
  const jeGruppe = new Map();
  for (const k of mitR40) {
    if (!jeGruppe.has(k.gruppe)) jeGruppe.set(k.gruppe, []);
    const liste = jeGruppe.get(k.gruppe);
    if (liste.length < TOP_N) liste.push(k);
  }

  const gewaehlt = new Map();
  // Beide Listen sind nach r40 fallend: der ERSTE Treffer eines Tickers ist der beste.
  // set() wuerde ihn durch den schlechteren ueberschreiben, falls derselbe Ticker aus zwei
  // Branchen-Dateien kaeme (Sektor-Umhaengung, halb geschriebene Datei).
  for (const k of Array.from(jeGruppe.values()).flat()) {
    if (!gewaehlt.has(k.row.ticker)) gewaehlt.set(k.row.ticker, k);
  }
  const ausgewaehlt = Array.from(gewaehlt.values()).sort(nachR40);

  return {
    bounds,
    rows: ausgewaehlt.map((k, i) => {
      const row = k.row;
      const ov = row.overview || {};
      const zeile = {
        rank: i + 1,
        rankGrund: null,               // das Brett fuehrt nur Zeilen, die die Achsenbelege haben
        ticker: row.ticker,
        formulaId: k.branch,           // Herkunftsbrett; traegt den boardStatus-Schluessel
        track: row.track,
        score: row.score,              // Engine-Score, unveraendert
        overviewKind: typeof ov.kind === 'string' ? ov.kind : null,
        overviewValue: istZahl(ov.value) ? ov.value : null,
        overviewCompanion: istZahl(ov.companion) ? ov.companion : null,
        lamps: Array.isArray(row.lamps) ? row.lamps : [],
      };
      for (const f of PASSTHROUGH_FIELDS) zeile[f] = (f in row) ? row[f] : null;
      // Additiv, nur dieses Brett:
      zeile.r40 = round1(k.r40);
      zeile.revGrowthPctUsed = round1(k.wachstum);   // geklemmt; r40 = dieser Wert + fcfMarginPct
      zeile.fcfMarginPct = round1(k.fcfMarginPct);
      zeile.ebitdaMarginPct = k.ebitdaMarginPct === null ? null : round1(k.ebitdaMarginPct);
      zeile.r40Ebitda = k.r40Ebitda === null ? null : round1(k.r40Ebitda);
      zeile.industry = k.industry;
      zeile.r40Group = k.gruppe;
      zeile.fundamentalsAsOf = k.fundamentalsAsOf;
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
      r40Min: R40_MIN,
      topN: TOP_N,
      minBaseQuarterShare: MIN_BASE_QUARTER_SHARE,
      maxFundamentalsAgeDays: MAX_FUNDAMENTALS_AGE_DAYS,
      maxFcfMarginPct: MAX_FCF_MARGIN_PCT,
      minWinsorSample: MIN_WINSOR_SAMPLE,
      growthWinsorBounds: meta.bounds,       // p1/p99 des eigenen Universums, oder null
      candidates: meta.kandidaten,
      rowsRead: meta.gelesen,
      rejected: meta.abgewiesen,
      softwareIndustries: SOFTWARE_INDUSTRIES,
    },
  };
}

// ---------------------------------------------------------------------------
// Schreiben
// ---------------------------------------------------------------------------
/**
 * Vor jedem rmSync: der Zielordner MUSS der rule40-Ordner unter dem v1-Verzeichnis sein.
 * leereVerzeichnis loescht rekursiv und wird auch auf dem FEHLER-Weg aufgerufen — ein
 * falsch gesetztes RULE40_OUT_DIR (z. B. auf v1 selbst) wuerde den ganzen Haupt-Export
 * loeschen, und `|| true` im Workflow hielte den Lauf dabei gruen (Befund F10).
 */
function pruefeZielordner(dir, v1Dir) {
  const ziel = path.resolve(dir);
  if (path.basename(ziel) !== BOARD_ID) {
    throw new Error('[rule40] Zielordner "' + ziel + '" heisst nicht "' + BOARD_ID
      + '" — hier wird rekursiv geloescht, das passiert nur im eigenen Ordner.');
  }
  if (v1Dir) {
    const wurzel = path.resolve(v1Dir);
    if (path.dirname(ziel) !== wurzel) {
      throw new Error('[rule40] Zielordner "' + ziel + '" liegt nicht direkt unter "' + wurzel + '".');
    }
  }
  return ziel;
}

function leereVerzeichnis(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
}

function schreibeBrett(outDir, overview, indexDatei, v1Dir) {
  pruefeZielordner(outDir, v1Dir);
  leereVerzeichnis(outDir);
  writeJsonAtomic(path.join(outDir, 'overview.json'), overview);
  writeJsonAtomic(path.join(outDir, 'index.json'), indexDatei);
}

/**
 * Fehl-Marker statt Alt-Stand. Der Ordner wird geleert und traegt danach NUR _failed:
 * findash ersetzt seinen lokalen Spiegel dann durch den Ausfall-Stub, statt das Brett von
 * gestern als das von heute zu servieren (screener-sync.js:203-213).
 */
function schreibeFehlmarker(outDir, grund, v1Dir) {
  pruefeZielordner(outDir, v1Dir);
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
  const { index, kandidaten, abgewiesen, gelesen } = sammleKandidaten(opts);
  if (!kandidaten.length) {
    throw new Error('[rule40] kein einziger rechenbarer Kandidat aus ' + gelesen + ' Zeilen ('
      + JSON.stringify(abgewiesen) + ') — ein leeres Brett waere eine Aussage, die niemand belegt hat.');
  }
  const { rows, bounds } = baueZeilen(kandidaten);
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
    bounds, kandidaten: kandidaten.length, gelesen, abgewiesen,
  });
  schreibeBrett(outDir, overview, indexDatei, v1Dir);
  return { outDir, rows: rows.length, kandidaten: kandidaten.length, gelesen, abgewiesen, bounds };
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
        schreibeFehlmarker(outDir, 'check failed: ' + res.errors.join(' | '), v1Dir);
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
      schreibeFehlmarker(outDir, (e && e.message) || e, v1Dir);
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
  R40_MIN, TOP_N, MIN_BASE_QUARTER_SHARE, MAX_FUNDAMENTALS_AGE_DAYS, MAX_FCF_MARGIN_PCT,
  MIN_WINSOR_SAMPLE,
  REQUIRED_OVERVIEW_ROW, PASSTHROUGH_FIELDS,
  basisQuartal, einheitenVerdacht, ebitdaMargePct, r40GruppeVon,
  sammleKandidaten, baueZeilen, buildOverview, buildIndex,
  schreibeBrett, schreibeFehlmarker, pruefeZielordner, build, check, main,
};

#!/usr/bin/env node
'use strict';
/**
 * findash-export v1 writer (task 1.1).
 *
 *   node scripts/write-findash-export.js           # build the export
 *   node scripts/write-findash-export.js --check    # validate an already-built export, exit 1 on breach
 *   node scripts/write-findash-export.js --selftest  # runnable self-check (assert-based)
 *
 * READS  (read-only inputs, never a write target):
 *   outputs/hypergrowth/<branch>.json  (13 boards, {profitable[],unprofitable[]})
 *   outputs/hypergrowth/overview.json  (flat cross-branch top-200)
 *   outputs/hypergrowth/survival.json  (flat pre-revenue, runway-desc)
 *   outputs/hypergrowth/index.json     (meta: counts/branches/excluded)
 *   outputs/coverage-status.json       (degradation banner marker, optional)
 * NEVER touches picks-history/ or earnings-calendar.json (Retention Grundgesetz 7a).
 *
 * WRITES (atomic tmp+rename, assertFinite -> fail-loud on NaN/Inf, never silent-null):
 *   outputs/findash-export/v1/<branch>.json
 *   outputs/findash-export/v1/overview.json
 *   outputs/findash-export/v1/survival.json
 *   outputs/findash-export/v1/index.json
 *   outputs/findash-export/v1/quality/<id>.json  (3.2: QC-Board, DIAGNOSTIC — additive subdir)
 *   outputs/findash-export/v1/quality/overview.json
 *   outputs/findash-export/v1/quality/index.json
 * The quality/ subdir mirrors outputs/quality/ (produced by run-screener runQualityPass).
 * Optional-when-absent: an old local run without outputs/quality/ writes NO quality files
 * (loud warning, no crash); but once quality/index.json exists it is fully --check-validated.
 *
 * Contract: docs/findash-export-v1.md. Every file carries schema:'findash-export/v1'.
 * A v2 bump is the ONLY sanctioned way to rename/remove/retype a field.
 *
 * THE GATE IS THE PRODUCT: --check is Karl's only alarm channel (red X). It MUST catch
 * a missing field, a wrong type, or a bad enum on ANY Pflicht field of ANY of the 15
 * files. Every validate*Row() below checks BOTH presence AND type/enum for every field
 * the schema-doc marks Pflicht. Proven against real outputs/hypergrowth: 22 tamper
 * variants (incl. 4 simultaneous breaches on energy.json) all exit 1.
 */
const fs = require('fs');
const path = require('path');
const { writeJsonAtomic } = require('../lib/atomic-write.js');
const { boardStatus: boardStatusOf } = require('../src/scoring/board-status.js'); // 2.1: core|diagnostic per board
const { TIERS } = require('../src/scoring/profit-tier.js'); // 1.2: profitTier-Enum

const ROOT = path.join(__dirname, '..');
const HG_DIR = path.join(ROOT, 'outputs', 'hypergrowth');
const QUALITY_DIR = path.join(ROOT, 'outputs', 'quality'); // 3.2: QC-Board source (runQualityPass)
const SMALLCAP_DIR = path.join(ROOT, 'outputs', 'smallcap'); // 5.2: Small-Cap-Board source (runSmallcapPass)
const COVERAGE = path.join(ROOT, 'outputs', 'coverage-status.json');
// Court-Auflage 27.07.2026 (Antrag 1 DENIED, rettende Auflage): Die Groessenklasse allein
// ('mega') ist eine Aussage ueber die LISTE, nicht ueber die Firma — sie sagt nur 'oberstes
// Fuenftel dieses Universums'. Das Gericht hat den Umbau der Klassifikation und den
// Board-Umzug abgelehnt, aber genau EINE Massnahme freigegeben: die absoluten Grenzen
// mitliefern, damit die Klasse lesbar wird ('Mega (ab 27,8 Mrd.)'). Voller Informationswert,
// kein neuer Zustand, kein neuer Widerspruch. Quelle sind die data-learned Quintil-Grenzen
// aus outputs/calibration.json (score.js mcapBounds) — es wird NICHTS neu gerechnet.
const CALIBRATION_FILE = path.join(ROOT, 'outputs', 'calibration.json');
// [p20, p40, p60, p80] in USD | null, wenn die Datei fehlt oder das Feld unbrauchbar ist.
// Fehlt sie, entfaellt die Spanne in der Anzeige — kein Abbruch, keine geratenen Grenzen.
function readMcapBounds() {
  try {
    const c = JSON.parse(fs.readFileSync(CALIBRATION_FILE, 'utf8'));
    const b = c && c.mcapBounds;
    if (!Array.isArray(b) || b.length !== 4 || !b.every((x) => Number.isFinite(x) && x > 0)) return null;
    // Monoton steigend — sonst waere die Zuordnung Klasse->Spanne sinnlos.
    for (let i = 1; i < b.length; i++) if (!(b[i] > b[i - 1])) return null;
    return b;
  } catch (_) { return null; }
}
const OUT_DIR = path.join(ROOT, 'outputs', 'findash-export', 'v1');
const QOUT_DIR = path.join(OUT_DIR, 'quality'); // 3.2: QC-Board export subdir
const SCOUT_DIR = path.join(OUT_DIR, 'smallcap'); // 5.2: Small-Cap-Board export subdir

const SCHEMA = 'findash-export/v1';
const BRANCHES = [
  'consumer-discretionary', 'consumer-staples', 'energy', 'financials',
  'health-care', 'industrials', 'it-services', 'materials', 'real-estate',
  'semiconductors', 'software-comm-services', 'tech-hardware', 'utilities',
];
// The exact descriptive fields the engine writes on every board+overview+survival row.
// Task 1.2: profitTier (4-Stufen-Enum) + ipoYear (durchgereicht) sind seit 1.2 real (vorher RESERVIERT).
// Task 2.13 #23: coverageAxes ("n/m" present-Achsen) + coverageWeight (C4-Gewicht) — additiv OPTIONAL,
// ausweisen statt verrechnen (score-inert); nicht in den Pflicht-Feld-Check (Auflage B1).
// Task 2.10: cohortN (Kohortengroesse je Zeile) + cohortFallback (Eltern-Kohorten-Basis aktiv) — PFLICHT
// (Tamper -> exit 1), anders als die optionalen coverage-Felder. Auf routed Board/Overview-Zeilen finite
// Zahl bzw. boolean; auf pre-revenue survival-Zeilen null (nie gescort).
// Task 2.11 Stufe A: scoreBase + scoreShrunk (number|null) + factors ({burn,growth,cycle}|null) — additiv OPTIONAL
// (Score-Transparenz, wie coverageAxes NICHT im --check, damit legitime Abwesenheit/alte Consumer nicht brechen).
// F-5 (Karl 26.07.): revGrowthYoYPct = Umsatzwachstum als ANZEIGE-Spalte in findash.
// Reine Anzeige, kein Score-Input. Quelle ist derselbe selbst gerechnete Wert, den auch die
// Achse revGrowthLevel sieht (score.js) — NICHT Yahoos metrics.revenueGrowthYoY, das wegen
// belegter Defekte am 14.07. aus der Achse entfernt wurde. Additiv OPTIONAL wie die
// coverage-Felder: alte Consumer und legitime Abwesenheit brechen nicht.
// K-3 (Karl 27.07., Sichtabnahme): mcapKlasse = ABSOLUTE Groessenklasse (micro/small/mid/
// large/mega) nach Marktstandard. Neben dem bestehenden mcapBand, das aus dem Universum
// GELERNT wird und deshalb mit ihm wandert — am 27.07. fielen CRDO (39,8 Mrd.) und NVIDIA
// (5.010 Mrd.) in dieselbe gelernte Klasse. findash filtert nach mcapKlasse, die Kohorten
// und das Scoring nutzen weiter mcapBand. Additiv OPTIONAL wie die coverage-Felder.
// F-2 Stufe 1 (Karl-Mandat, 03.08.): einmalertragPrognose = Prognose-Zustand zur Lampe
// 'einmalertrag' (string|null), erzeugt in src/scoring/lamps.js einmalertragPrognose().
// Additiv OPTIONAL wie revGrowthYoYPct. NUR Zeilen, die die Lampe tragen, duerfen einen
// Zustand fuehren — das prueft checkEinmalertragPrognose in BEIDE Richtungen.
const ROW_FIELDS = ['name', 'country', 'region', 'sector', 'marketCap', 'phase', 'mcapBand', 'mcapKlasse', 'ipoRecency', 'profitTier', 'ipoYear', 'coverageAxes', 'coverageWeight', 'cohortN', 'cohortFallback', 'scoreBase', 'scoreShrunk', 'factors', 'axisBreakdown', 'revGrowthYoYPct', 'profitStreak', 'einmalertragPrognose'];
// Task 4.5: profitStreak = {jahre, basis, tiefe, mindestens, letzterVerlust} | null.
// Additiv OPTIONAL wie revGrowthYoYPct. Belegte Laenge der ununterbrochenen Gewinnserie
// aus der SEC-Langhistorie — NEBEN profitTier, nicht statt dessen. Grund: profitTier sieht
// nur Yahoos ~4 Jahre, und in vier sauberen Jahren ist jede Firma 'langfristig profitabel'
// (gemessen 28.07.: 380 von 1.353 tragen das Etikett trotz Serienabriss binnen 8 Jahren,
// darunter American Airlines und Autodesk). REINE ANZEIGE, kein Score-Input.

// Task 2.2: ATH-Anzeige (Karl-A6-Lösung) — additiv OPTIONAL je Zeile: ath = {distancePct,
// athDate, monthsAgo} | null. Quelle = external-data/ath-state.json (committeter Vertrag,
// geseedet vom lokalen Max-Batch, täglich billig fortgeschrieben; Split-Wächter -> null).
// Reine ANZEIGE, nie Score-Input (Grundgesetz 1). --check validiert die FORM wenn present
// (nicht Pflicht — Abwesenheit ist legitim, Präzedenz coverageAxes/B1).
const { displayFor } = require('./update-ath-state.js');
let _athEntries = null;
function athFor(ticker) {
  if (_athEntries === null) {
    const st = readJSONOrNull(path.join(__dirname, '..', 'external-data', 'ath-state.json'));
    _athEntries = (st && st.entries) || {};
  }
  return displayFor(_athEntries[ticker]);
}

function readJSON(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }
function readJSONOrNull(p) { try { return readJSON(p); } catch (_) { return null; } }

function normalizeName(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized || null;
}

// ---- row mappers ---------------------------------------------------------
// Copy ONLY real engine fields. `rank` is derived = 1-based array index (score-desc;
// survival runway-desc). currency/profitTier/ipoYear are RESERVED (1.2) — NOT
// fabricated; consumers treat absent as "not available".

function mapBoardRow(r, i) {
  const out = {
    rank: i + 1,           // derived: list is score-desc, rank = index+1
    ticker: r.ticker,
    score: r.score,        // round1 display score (sort determinism was internal _raw)
    track: r.track,        // 'profitable' | 'unprofitable'
    lamps: r.lamps || [],
    overview: r.overview == null ? null : {
      kind: r.overview.kind,           // 'gp'|'revenue-badge'|'ffo-badge'|'runway-badge'
      value: r.overview.value,         // number|null, CAN be negative (YoY shrink)
      companion: r.overview.companion, // number|null (Rule-of-X companion)
    },
  };
  for (const k of ROW_FIELDS) out[k] = k === 'name' ? normalizeName(r[k]) : (r[k] === undefined ? null : r[k]);
  out.ath = athFor(r.ticker); // 2.2: ATH-Anzeige (null wenn nicht geseedet/Split-Wächter)
  return out;
}

function mapOverviewRow(r, i) {
  const out = {
    rank: i + 1,
    ticker: r.ticker,
    formulaId: r.formulaId,     // branch id — only present in the flat overview feed
    track: r.track,
    score: r.score,
    overviewKind: r.overviewKind,           // FLAT here, NOT nested (mirrors engine)
    overviewValue: r.overviewValue,         // number|null, CAN be negative
    overviewCompanion: r.overviewCompanion, // number|null
    lamps: r.lamps || [],
  };
  for (const k of ROW_FIELDS) out[k] = k === 'name' ? normalizeName(r[k]) : (r[k] === undefined ? null : r[k]);
  out.ath = athFor(r.ticker); // 2.2
  return out;
}

function mapSurvivalRow(r, i) {
  // pre-revenue names never scored: no score/track/overview.kind. runwayQuarters
  // (9999 sentinel = quasi-infinite runway) is the sort key, runway-desc nulls-last.
  const out = {
    rank: i + 1,
    ticker: r.ticker,
    runwayQuarters: r.runwayQuarters,  // number|null, 9999 = inf-runway sentinel
    lamps: r.lamps || [],
  };
  for (const k of ROW_FIELDS) out[k] = k === 'name' ? normalizeName(r[k]) : (r[k] === undefined ? null : r[k]);
  out.ath = athFor(r.ticker); // 2.2
  return out;
}

// ---- build ---------------------------------------------------------------
function buildBoard(id, coverage) {
  const b = readJSON(path.join(HG_DIR, id + '.json'));
  return {
    schema: SCHEMA,
    generated_at: new Date().toISOString(),
    branch: id,
    boardStatus: boardStatusOf(id),                 // 'core' (Court-PASSED) | 'diagnostic' (unbewiesen, 2.1)
    coverage,                                       // {status,degraded,blocked,coverage_pct} | null
    mcapBounds: readMcapBounds(),                   // [p20,p40,p60,p80] USD | null — macht mcapBand lesbar
    profitable: (b.profitable || []).map(mapBoardRow),
    unprofitable: (b.unprofitable || []).map(mapBoardRow),
  };
}

function buildOverview(coverage) {
  const o = readJSON(path.join(HG_DIR, 'overview.json'));
  return { schema: SCHEMA, generated_at: new Date().toISOString(), coverage, mcapBounds: readMcapBounds(), rows: o.map(mapOverviewRow) };
}

function buildSurvival(coverage) {
  const s = readJSON(path.join(HG_DIR, 'survival.json'));
  return { schema: SCHEMA, generated_at: new Date().toISOString(), coverage, rows: s.map(mapSurvivalRow) };
}

function buildIndex(coverage) {
  const idx = readJSON(path.join(HG_DIR, 'index.json'));
  return {
    schema: SCHEMA,
    generated_at: new Date().toISOString(),
    coverage,                                        // banner marker for the dashboard
    generatedFromSnapshots: idx.generatedFromSnapshots,
    branches: idx.branches,
    boardStatus: Object.fromEntries(BRANCHES.map((id) => [id, boardStatusOf(id)])), // 2.1: core|diagnostic je Board
    counts: idx.counts,                              // true cohort counts, not topN
    survivalCount: idx.survivalCount,
    excluded: idx.excluded,
  };
}

// ---- QC-Board (quality/) — 3.2 ------------------------------------------
// QC rows are the SAME shape as HG board/overview rows (verified against outputs/quality/*):
// board files carry {profitable[],unprofitable[]} of BoardRow, overview.json is a flat
// OverviewRow[] array, index.json is {schema,generatedFromSnapshots,boards,boardStatus,
// counts,excluded}. So mapBoardRow/mapOverviewRow are reused verbatim; no new mapper.
// Board files are named quality-<stem>.json; the export drops the prefix (quality/<stem>.json,
// branch=<stem>). Board count is discovered, never hardcoded (11 today, may drift).
// FIX 3 (Karl-Audit wfe-orphan-source): the board LIST is index-authoritative (buildQuality
// export branch below reads qualityDir/index.json), not directory-listing-authoritative —
// a stray quality-*.json in qualityDir that isn't in index.boards must never surface.
function qualityStem(file) { return file.replace(/^quality-/, '').replace(/\.json$/, ''); }

function buildQualityBoard(file, coverage, qualityDir) {
  const stem = qualityStem(file);
  const b = readJSON(path.join(qualityDir || QUALITY_DIR, file));
  return {
    schema: SCHEMA,
    generated_at: new Date().toISOString(),
    branch: stem,                                   // = filename stem (prefix dropped)
    boardStatus: boardStatusOf('quality-' + stem),  // always 'diagnostic' by construction (board-status.js)
    coverage,
    profitable: (b.profitable || []).map(mapBoardRow),
    unprofitable: (b.unprofitable || []).map(mapBoardRow),
  };
}

function buildQualityOverview(coverage, qualityDir) {
  const o = readJSON(path.join(qualityDir || QUALITY_DIR, 'overview.json'));
  return { schema: SCHEMA, generated_at: new Date().toISOString(), coverage, rows: o.map(mapOverviewRow) };
}

function buildQualityIndex(coverage, qualityDir) {
  const idx = readJSON(path.join(qualityDir || QUALITY_DIR, 'index.json'));
  return {
    schema: SCHEMA,                                  // pinned to the export contract, not quality/diagnostic-v1
    generated_at: new Date().toISOString(),
    coverage,
    generatedFromSnapshots: idx.generatedFromSnapshots,
    boards: idx.boards,                              // 'quality-'-prefixed ids, mirrored as-is
    boardStatus: idx.boardStatus,                    // {[quality-id]: 'diagnostic'}
    counts: idx.counts,
    excluded: idx.excluded,
  };
}

// F11: QC-Export-Entscheidung aus dem Quell-Zustand (rein, testbar). 'export' = gueltiges
// Board-Set (quality/index.json da, QC-Pass lief durch); 'failed' = QC-Fehl-Marker (_failed,
// von run-screener im catch) OHNE index -> QC-Pass scheiterte; 'absent' = weder noch (alter
// Lokallauf ohne QC). index gewinnt ueber den Marker: ein spaeterer Erfolgslauf schreibt einen
// frischen index, ein stale _failed eines Vorlaufs darf ihn nicht ueberstimmen.
function qualityExportMode(qualityDir) {
  if (fs.existsSync(path.join(qualityDir, 'index.json'))) return 'export';
  if (fs.existsSync(path.join(qualityDir, '_failed'))) return 'failed';
  return 'absent';
}

// Optional-when-absent -> explizites Fehlsignal (F11). Drei Zustaende statt "Datei da/nicht da":
//   export  -> QC-Boards spiegeln (wie bisher);
//   failed  -> NUR den _failed-Marker in den Export durchreichen (KEIN evtl. stales Board),
//              damit der Deploy den QC-Ausfall sichtbar macht statt still das Alt-Board weiter
//              zu servieren. HG liefert unveraendert weiter (fail-soft);
//   absent  -> nichts schreiben, laut warnen (alter Lokallauf ohne QC-Ordner).
// Einmal geschrieben, ist jede quality/index.json voll --check-validiert (validateQualityExport).
function buildQuality(coverage, opts = {}) {
  const qualityDir = opts.qualityDir || QUALITY_DIR;
  const qoutDir = opts.qoutDir || QOUT_DIR;
  const mode = qualityExportMode(qualityDir);
  if (mode === 'failed') {
    const failed = readJSONOrNull(path.join(qualityDir, '_failed')) || {};
    // T2: symmetrisch zum export-Zweig (X4/Tag 349) — qoutDir ERST leeren, DANN neu schreiben.
    // Sonst blieben Board-Dateien + index.json eines FRUEHEREN erfolgreichen Laufs liegen,
    // validateQualityExport/Deploy haetten sie stillschweigend als gueltig weiterserviert.
    fs.rmSync(qoutDir, { recursive: true, force: true });
    fs.mkdirSync(qoutDir, { recursive: true });
    writeJsonAtomic(path.join(qoutDir, '_failed'), { schema: SCHEMA, generated_at: new Date().toISOString(), ...failed });
    console.warn('::warning::findash-export: QC-Pass FAILED (quality/_failed) — quality/ nur als _failed-Marker exportiert, KEINE (evtl. stale) QC-Boards.');
    return { boards: 0, failed: true };
  }
  if (mode === 'absent') {
    // Karl-Entscheid: absent raeumt wie failed (T2/Tag 349-Muster) — sonst blieb ein
    // QC-Board-Stand eines FRUEHEREN erfolgreichen Laufs im qoutDir liegen, obwohl
    // dieser Lauf gar kein quality/ hat. validateQualityExport haette das stale
    // index.json weiter als gueltig gelesen (derselbe Stale-QC-Feed-Klasse wie X4/T2).
    fs.rmSync(qoutDir, { recursive: true, force: true });
    fs.mkdirSync(qoutDir, { recursive: true });
    console.warn('::warning::findash-export: outputs/quality/index.json absent — QC board (quality/) NOT exported (optional feed, older local run).');
    return { boards: 0 };
  }
  // mode === 'export': gueltiges QC-Board-Set spiegeln.
  // X4 (Tag 348): qoutDir ERST leeren, DANN neu schreiben. Vorher blieb eine Board-Datei
  // eines seither entfernten/umbenannten QC-Boards aus einem frueheren Lauf liegen —
  // validateQualityExport iteriert nur idx.boards (das FRISCHE index.json), sieht die
  // Karteileiche also nie und der Deploy haette sie stillschweigend mitpubliziert.
  // FIX 3 (Karl-Audit wfe-orphan-source, 2026-07-18): die Board-Liste kam bisher aus einem
  // Verzeichnis-Listing (qualityBoardFiles/readdirSync) statt aus dem Quell-Index. Ein
  // Folgepass mit WENIGER Boards laesst eine alte quality-*.json im Quellordner liegen
  // (clearStaleQualityIndex, run-screener.js, entfernt nur index.json) — das Listing nahm sie
  // wieder auf und kopierte sie in den Export, obwohl validateQualityExport nur idx.boards
  // sieht (stiller Re-Publish einer Board-Leiche). Index-autoritativ statt Verzeichnis-autoritativ:
  // idx.boards traegt bereits die 'quality-'-praefixten IDs ohne .json (verifiziert gegen
  // buildQualityIndex + eine echte outputs/quality/index.json).
  const idx = readJSONOrNull(path.join(qualityDir, 'index.json'));
  const files = (idx && Array.isArray(idx.boards) ? idx.boards : []).map((id) => id + '.json');
  fs.rmSync(qoutDir, { recursive: true, force: true });
  fs.mkdirSync(qoutDir, { recursive: true });
  const wo = { assertFinite: true };
  for (const f of files) writeJsonAtomic(path.join(qoutDir, qualityStem(f) + '.json'), buildQualityBoard(f, coverage, qualityDir), wo);
  writeJsonAtomic(path.join(qoutDir, 'overview.json'), buildQualityOverview(coverage, qualityDir), wo);
  writeJsonAtomic(path.join(qoutDir, 'index.json'), buildQualityIndex(coverage, qualityDir), wo);
  return { boards: files.length };
}

// ---- 5.2 Small-Cap-Board (smallcap/) -------------------------------------
// Byte-fuer-Byte dasselbe Muster wie QC (quality/) oben — bewusst dupliziert statt
// parametrisiert (buildQualityBoard haengt intern boardStatusOf('quality-'+stem) fest an
// das QC-Praefix; ein gemeinsamer Helper braeuchte den Praefix als weiteren Parameter durch
// alle vier Funktionen, fuer zwei Nutzer kein Gewinn). runSmallcapPass schreibt
// outputs/smallcap/{smallcap-<sektor>,overview,index}.json; boardStatus ist IMMER
// 'diagnostic' (board-status.js: 'smallcap-'-Praefix), Praereg-DIAGNOSTIC-Start.
function smallcapStem(file) { return file.replace(/^smallcap-/, '').replace(/\.json$/, ''); }

function buildSmallcapBoard(file, coverage, smallcapDir) {
  const stem = smallcapStem(file);
  const b = readJSON(path.join(smallcapDir || SMALLCAP_DIR, file));
  return {
    schema: SCHEMA,
    generated_at: new Date().toISOString(),
    branch: stem,
    boardStatus: boardStatusOf('smallcap-' + stem), // always 'diagnostic' by construction (board-status.js)
    coverage,
    profitable: (b.profitable || []).map(mapBoardRow),
    unprofitable: (b.unprofitable || []).map(mapBoardRow),
  };
}

function buildSmallcapOverview(coverage, smallcapDir) {
  const o = readJSON(path.join(smallcapDir || SMALLCAP_DIR, 'overview.json'));
  return { schema: SCHEMA, generated_at: new Date().toISOString(), coverage, rows: o.map(mapOverviewRow) };
}

function buildSmallcapIndex(coverage, smallcapDir) {
  const idx = readJSON(path.join(smallcapDir || SMALLCAP_DIR, 'index.json'));
  return {
    schema: SCHEMA,
    generated_at: new Date().toISOString(),
    coverage,
    generatedFromSnapshots: idx.generatedFromSnapshots,
    boards: idx.boards,
    boardStatus: idx.boardStatus,
    counts: idx.counts,
    excluded: idx.excluded,
    coverageFloor: idx.coverageFloor ?? null, // 5.2 Auflage 3: Coverage-Gate-Beleg durchreichen
  };
}

function smallcapExportMode(smallcapDir) {
  if (fs.existsSync(path.join(smallcapDir, 'index.json'))) return 'export';
  if (fs.existsSync(path.join(smallcapDir, '_failed'))) return 'failed';
  return 'absent';
}

// Optional-when-absent, identisches 3-Zustands-Muster wie buildQuality (F11).
function buildSmallcap(coverage, opts = {}) {
  const smallcapDir = opts.smallcapDir || SMALLCAP_DIR;
  const scoutDir = opts.scoutDir || SCOUT_DIR;
  const mode = smallcapExportMode(smallcapDir);
  if (mode === 'failed') {
    const failed = readJSONOrNull(path.join(smallcapDir, '_failed')) || {};
    fs.rmSync(scoutDir, { recursive: true, force: true });
    fs.mkdirSync(scoutDir, { recursive: true });
    writeJsonAtomic(path.join(scoutDir, '_failed'), { schema: SCHEMA, generated_at: new Date().toISOString(), ...failed });
    console.warn('::warning::findash-export: Small-Cap-Pass FAILED (smallcap/_failed) — smallcap/ nur als _failed-Marker exportiert, KEINE (evtl. stale) Boards.');
    return { boards: 0, failed: true };
  }
  if (mode === 'absent') {
    fs.rmSync(scoutDir, { recursive: true, force: true });
    fs.mkdirSync(scoutDir, { recursive: true });
    console.warn('::warning::findash-export: outputs/smallcap/index.json absent — Small-Cap-Board (smallcap/) NOT exported (optional feed, older local run).');
    return { boards: 0 };
  }
  const idx = readJSONOrNull(path.join(smallcapDir, 'index.json'));
  const files = (idx && Array.isArray(idx.boards) ? idx.boards : []).map((id) => id + '.json');
  fs.rmSync(scoutDir, { recursive: true, force: true });
  fs.mkdirSync(scoutDir, { recursive: true });
  const wo = { assertFinite: true };
  for (const f of files) writeJsonAtomic(path.join(scoutDir, smallcapStem(f) + '.json'), buildSmallcapBoard(f, coverage, smallcapDir), wo);
  writeJsonAtomic(path.join(scoutDir, 'overview.json'), buildSmallcapOverview(coverage, smallcapDir), wo);
  writeJsonAtomic(path.join(scoutDir, 'index.json'), buildSmallcapIndex(coverage, smallcapDir), wo);
  return { boards: files.length };
}

// coverage marker is a diagnostic passenger, not a hard input. Absent (fresh runner,
// marker not yet written) -> export still builds; consumers read coverage:null as "unknown".
function loadCoverage() {
  const m = readJSONOrNull(COVERAGE);
  if (!m) return null;
  return { status: m.status, degraded: m.degraded, blocked: m.blocked, coverage_pct: m.coverage_pct };
}

function build() {
  const coverage = loadCoverage();
  fs.mkdirSync(OUT_DIR, { recursive: true }); // writeJsonAtomic does NOT create the dir
  const opts = { assertFinite: true };         // fail loud on a NaN/Inf, never silent-null (A-lib-08)
  for (const id of BRANCHES) {
    writeJsonAtomic(path.join(OUT_DIR, id + '.json'), buildBoard(id, coverage), opts);
  }
  writeJsonAtomic(path.join(OUT_DIR, 'overview.json'), buildOverview(coverage), opts);
  writeJsonAtomic(path.join(OUT_DIR, 'survival.json'), buildSurvival(coverage), opts);
  writeJsonAtomic(path.join(OUT_DIR, 'index.json'), buildIndex(coverage), opts);
  const q = buildQuality(coverage); // 3.2: QC-Board subdir (optional-when-absent)
  const sc = buildSmallcap(coverage); // 5.2: Small-Cap-Board subdir (optional-when-absent)
  return { out: OUT_DIR, branches: BRANCHES.length, qualityBoards: q.boards, smallcapBoards: sc.boards };
}

// ---- validate (schema-check gate) ---------------------------------------
// Pure per-object checks; validateExport() reads the ON-DISK export and returns a
// list of contract violations (empty = ok). Mirrors coverage-gate.js validateMarker:
// a nonempty list makes the CI --check step exit 1 and block the if:success() deploy.
//
// Every field the schema-doc marks "Pflicht" is checked for BOTH presence AND type/enum.
// "Pflicht (nullable)" = key present AND (null OR correct type). Absence of the key = breach.
const VALID_TRACK = ['profitable', 'unprofitable'];
const VALID_PHASE = ['inflected', 'established', 'unprofitable'];
const VALID_MCAP = ['micro', 'small', 'mid', 'large', 'mega'];
const VALID_IPO = ['recent', 'growth', 'seasoned', 'veteran', 'mature'];
const VALID_OVKIND = ['gp', 'revenue-badge', 'ffo-badge', 'runway-badge'];
const VALID_COVERAGE_STATUS = ['ok', 'degradiert', 'katastrophal'];
const VALID_BOARDSTATUS = ['core', 'diagnostic'];
const VALID_PROFITTIER = TIERS; // 1.2: nicht/kurz-vor/seit-kurzem/langfristig-profitabel

// string|null field must be PRESENT (key exists) and either null or string.
function checkStrOrNull(r, key, where, errs) {
  if (!(key in r)) errs.push(`${where}: ${key} missing`);
  else if (r[key] !== null && typeof r[key] !== 'string') errs.push(`${where}: ${key} not string|null`);
}
// Der neue Producer emittiert name immer. Der geteilte v1-Consumer-Vertrag bleibt
// dagegen additiv/optional, damit bereits gespeicherte v1-Dateien ohne name lesbar bleiben.
function checkProducerName(r, where, errs) {
  if (!('name' in r)) errs.push(`${where}: name missing`);
  else if (r.name !== null && typeof r.name !== 'string') errs.push(`${where}: name not string|null`);
  else if (r.name !== null && normalizeName(r.name) !== r.name) errs.push(`${where}: name not normalized`);
}
// number|null field must be PRESENT and either null or finite number.
function checkNumOrNull(r, key, where, errs) {
  if (!(key in r)) errs.push(`${where}: ${key} missing`);
  else if (r[key] !== null && !Number.isFinite(r[key])) errs.push(`${where}: ${key} not finite|null`);
}
// ADDITIV OPTIONAL: Abwesenheit ist legitim (alter Export, Altbestands-Consumer) und darf
// den --check NICHT rot faerben — Karls einziger Alarmkanal haengt daran. Ist das Feld da,
// wird es voll geprueft (null oder endliche Zahl). Praezedenz: coverageAxes/scoreBase.
function checkOptionalNumOrNull(r, key, where, errs) {
  if (!(key in r)) return;
  if (r[key] !== null && !Number.isFinite(r[key])) errs.push(where + ": " + key + " not finite|null");
}
// 4.5: profitStreak additiv OPTIONAL — Abwesenheit/null legitim; WENN present, muss die
// Form stimmen. Wie bei revGrowthYoYPct bewusst nicht Pflicht: Karls einziger Alarmkanal
// (das rote X) darf nicht an einem additiven Anzeigefeld haengen.
function checkOptionalProfitStreak(r, where, errs) {
  if (!('profitStreak' in r) || r.profitStreak === null) return;
  const p = r.profitStreak;
  if (typeof p !== 'object') { errs.push(where + ': profitStreak not object|null'); return; }
  if (!Number.isInteger(p.jahre) || p.jahre < 0) errs.push(where + ': profitStreak.jahre not a non-negative integer');
  if (!Number.isInteger(p.tiefe) || p.tiefe < 1) errs.push(where + ': profitStreak.tiefe not a positive integer');
  if (Number.isInteger(p.jahre) && Number.isInteger(p.tiefe) && p.jahre > p.tiefe) {
    errs.push(where + ': profitStreak.jahre > tiefe (Serie laenger als die Reihe)');
  }
  if (p.basis !== 'opInc' && p.basis !== 'netIncome') errs.push(where + ': profitStreak.basis bad enum');
  if (typeof p.mindestens !== 'boolean') errs.push(where + ': profitStreak.mindestens not boolean');
  if (p.letzterVerlust !== null && !Number.isInteger(p.letzterVerlust)) errs.push(where + ': profitStreak.letzterVerlust not int|null');
  // Innere Widerspruchsfreiheit: laeuft die Serie bis zum Reihenanfang, KANN es kein
  // sichtbares Verlustjahr geben — und umgekehrt.
  if (p.mindestens === true && p.letzterVerlust !== null) errs.push(where + ': profitStreak mindestens=true, aber letzterVerlust gesetzt');
}
// F-2 Stufe 1: einmalertragPrognose — additiv OPTIONAL, aber in BEIDE Richtungen gepruefte
// WERTE (nicht Anwesenheit): (1) nur die vier gepflegten Zustaende sind erlaubt, sonst faellt
// findash still auf 'nichtPruefbar' zurueck und ein Tippfehler im Erzeuger bliebe unsichtbar;
// (2) ein Zustand auf einer Zeile OHNE die Lampe ist eine Aussage ueber eine Firma, ueber die
// nichts auszusagen war — der Konsument (lamp-legend.js einmalertragZustand) wuerde ihn nie
// zeigen, und genau deshalb faellt so ein Fehler sonst niemandem auf.
// Die Wertemenge traegt bereits 'bestaetigt'/'eingebrochen' fuer Stufe 2; heute emittiert der
// Erzeuger sie nie (Sperre + Waechter in tests/einmalertrag-prognose.test.js).
const EINMALERTRAG_LAMPE = 'einmalertrag';
const VALID_EINMALERTRAG_PROGNOSE = ['bestaetigt', 'eingebrochen', 'nichtAnwendbar', 'nichtPruefbar'];
// ⚠ WARUM HIER KEIN "Lampe ⟹ non-null" STEHT (Review-Befund 2, 03.08.2026): null IST auf
// einer Lampen-Zeile der SOLL-Zustand, sobald die Prognose vollstaendig und vergleichbar
// ist (lamps.js einmalertragPrognose, letzte Zeile; docs/findash-export-v1.md). Eine solche
// Regel wuerde also genau die am besten belegten Zeilen falsch-rot faerben.
// WO DIE VERDRAHTUNG STATTDESSEN HAENGT: tests/einmalertrag-prognose.test.js, Block "KETTE"
// — er faehrt ein Fixture MIT unvollstaendiger Prognose durch scoreUniverse ->
// produceRankings -> mapBoardRow und verlangt am ENDE 'nichtPruefbar', einen Wert, der nie
// null sein darf. Gegengeprobt am 03.08. durch Ausbau JEDER der drei Stationen:
// ROW_FIELDS -> 3 fail, score.js rowMeta -> 1 fail, lamps.js Erzeuger -> 5 fail.
// Was eine EINZELNE Zeile strukturell nicht sehen kann, prueft checkPrognoseFeldHomogen.
function checkEinmalertragPrognose(r, where, errs) {
  if (!('einmalertragPrognose' in r)) return;   // Abwesenheit legitim (Altbestand)
  const v = r.einmalertragPrognose;
  if (v === null) return;
  if (typeof v !== 'string' || !VALID_EINMALERTRAG_PROGNOSE.includes(v)) {
    errs.push(`${where}: einmalertragPrognose=${JSON.stringify(v)} unbekannter Zustand`);
    return;
  }
  if (!Array.isArray(r.lamps) || !r.lamps.includes(EINMALERTRAG_LAMPE)) {
    errs.push(`${where}: einmalertragPrognose=${JSON.stringify(v)} auf Zeile OHNE Lampe '${EINMALERTRAG_LAMPE}'`);
  }
}
// Datei-Ebene: das Feld ist entweder auf ALLEN Zeilen da oder auf KEINER. Die Zeilen-Pruefung
// oben laesst Abwesenheit durch (Altbestand trug das Feld nie) und kann deshalb einen halb
// verdrahteten Erzeuger nicht sehen. Der Writer fuehrt einmalertragPrognose in ROW_FIELDS und
// setzt es auf JEDER Zeile (undefined -> null) — Uneinheitlichkeit innerhalb einer Datei ist
// damit kein legitimer Zustand, sondern ein kaputter Producer. Kein Falsch-Rot-Risiko: alte
// Dateien haben es auf keiner Zeile, neue auf jeder.
function checkPrognoseFeldHomogen(rows, where, errs) {
  if (!Array.isArray(rows) || rows.length < 2) return;
  const mit = rows.filter((r) => r && typeof r === 'object' && 'einmalertragPrognose' in r).length;
  if (mit !== 0 && mit !== rows.length) {
    errs.push(`${where}: einmalertragPrognose nur auf ${mit} von ${rows.length} Zeilen vorhanden — halb verdrahteter Producer (das Feld steht in ROW_FIELDS und muss auf jeder Zeile stehen)`);
  }
}
// enum|null field must be PRESENT and either null or one of the allowed values.
function checkEnumOrNull(r, key, allowed, where, errs) {
  if (!(key in r)) errs.push(`${where}: ${key} missing`);
  else if (r[key] !== null && !allowed.includes(r[key])) errs.push(`${where}: ${key}=${JSON.stringify(r[key])}`);
}
// boolean|null field must be PRESENT and either null or a boolean (2.10 cohortFallback on survival rows).
function checkBoolOrNull(r, key, where, errs) {
  if (!(key in r)) errs.push(`${where}: ${key} missing`);
  else if (r[key] !== null && typeof r[key] !== 'boolean') errs.push(`${where}: ${key} not boolean|null`);
}
// Task 2.10: cohortN/cohortFallback on a SCORED row (board/overview) are Pflicht + NON-null: cohortN a
// finite number, cohortFallback a boolean. Field removal or type corruption -> violation (exit 1).
function checkCohortScored(r, where, errs) {
  if (!('cohortN' in r)) errs.push(`${where}: cohortN missing`);
  else if (!Number.isFinite(r.cohortN)) errs.push(`${where}: cohortN not finite`);
  if (!('cohortFallback' in r)) errs.push(`${where}: cohortFallback missing`);
  else if (typeof r.cohortFallback !== 'boolean') errs.push(`${where}: cohortFallback not boolean`);
}

// Pflicht-Metadaten carried by board + overview + survival rows.
// All are "Pflicht (nullable)" per schema-doc 3/4/5.
function validateGeo(r, where, errs) {
  checkProducerName(r, where, errs);
  checkStrOrNull(r, 'country', where, errs);
  checkStrOrNull(r, 'region', where, errs);
  checkStrOrNull(r, 'sector', where, errs);
  checkNumOrNull(r, 'marketCap', where, errs);
  checkOptionalNumOrNull(r, 'revGrowthYoYPct', where, errs);
  checkOptionalProfitStreak(r, where, errs);                       // 4.5 additiv OPTIONAL
  checkEinmalertragPrognose(r, where, errs);                       // F-2 Stufe 1 additiv OPTIONAL
  checkEnumOrNull(r, 'phase', VALID_PHASE, where, errs);
  checkEnumOrNull(r, 'mcapBand', VALID_MCAP, where, errs);
  checkEnumOrNull(r, 'ipoRecency', VALID_IPO, where, errs);
  checkEnumOrNull(r, 'profitTier', VALID_PROFITTIER, where, errs); // 1.2
  checkNumOrNull(r, 'ipoYear', where, errs);                       // 1.2 (durchgereicht)
  // 2.2: ath additiv OPTIONAL — Abwesenheit/null legitim; WENN present, muss die Form stimmen.
  if ('ath' in r && r.ath !== null) {
    if (typeof r.ath !== 'object') errs.push(`${where}: ath not object|null`);
    else {
      if (!Number.isFinite(r.ath.distancePct)) errs.push(`${where}: ath.distancePct not finite`);
      if (typeof r.ath.athDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(r.ath.athDate)) errs.push(`${where}: ath.athDate`);
      if (!Number.isFinite(r.ath.monthsAgo) || r.ath.monthsAgo < 0) errs.push(`${where}: ath.monthsAgo`);
    }
  }
}

function validateBoardRow(r, where, errs) {
  if (!r || typeof r !== 'object') { errs.push(`${where}: not an object`); return; }
  if (typeof r.ticker !== 'string' || !r.ticker) errs.push(`${where}: ticker`);
  if (!Number.isFinite(r.score)) errs.push(`${where}: score not finite`);
  if (!Number.isInteger(r.rank) || r.rank < 1) errs.push(`${where}: rank`);
  if (!VALID_TRACK.includes(r.track)) errs.push(`${where}: track=${JSON.stringify(r.track)}`);
  if (!Array.isArray(r.lamps)) errs.push(`${where}: lamps not array`);
  // overview: Pflicht (nullable). Key must be present. If object, kind/value/companion checked.
  if (!('overview' in r)) errs.push(`${where}: overview missing`);
  else if (r.overview !== null) {
    if (typeof r.overview !== 'object') errs.push(`${where}: overview not object|null`);
    else {
      if (!VALID_OVKIND.includes(r.overview.kind)) errs.push(`${where}: overview.kind=${JSON.stringify(r.overview.kind)}`);
      if (!('value' in r.overview)) errs.push(`${where}: overview.value missing`);
      else if (r.overview.value !== null && !Number.isFinite(r.overview.value)) errs.push(`${where}: overview.value not finite|null`);
      if (!('companion' in r.overview)) errs.push(`${where}: overview.companion missing`);
      else if (r.overview.companion !== null && !Number.isFinite(r.overview.companion)) errs.push(`${where}: overview.companion not finite|null`);
    }
  }
  validateGeo(r, where, errs);
  checkCohortScored(r, where, errs); // 2.10: cohortN finite + cohortFallback boolean (Pflicht)
}

function validateOverviewRow(r, where, errs) {
  if (!r || typeof r !== 'object') { errs.push(`${where}: not an object`); return; }
  if (!Number.isInteger(r.rank) || r.rank < 1) errs.push(`${where}: rank`);
  if (typeof r.ticker !== 'string' || !r.ticker) errs.push(`${where}: ticker`);
  if (typeof r.formulaId !== 'string' || !r.formulaId) errs.push(`${where}: formulaId`);
  if (!VALID_TRACK.includes(r.track)) errs.push(`${where}: track=${JSON.stringify(r.track)}`);
  if (!Number.isFinite(r.score)) errs.push(`${where}: score not finite`);
  // FLAT overview badge fields (Pflicht nullable): kind enum, value/companion number|null.
  checkEnumOrNull(r, 'overviewKind', VALID_OVKIND, where, errs);
  checkNumOrNull(r, 'overviewValue', where, errs);
  checkNumOrNull(r, 'overviewCompanion', where, errs);
  if (!Array.isArray(r.lamps)) errs.push(`${where}: lamps not array`);
  validateGeo(r, where, errs);
  checkCohortScored(r, where, errs); // 2.10: cohortN finite + cohortFallback boolean (Pflicht)
}

function validateSurvivalRow(r, where, errs) {
  if (!r || typeof r !== 'object') { errs.push(`${where}: not an object`); return; }
  if (!Number.isInteger(r.rank) || r.rank < 1) errs.push(`${where}: rank`);
  if (typeof r.ticker !== 'string' || !r.ticker) errs.push(`${where}: ticker`);
  if (!('runwayQuarters' in r)) errs.push(`${where}: runwayQuarters missing`);
  else if (r.runwayQuarters !== null && !Number.isFinite(r.runwayQuarters)) errs.push(`${where}: runwayQuarters not finite|null`);
  if (!Array.isArray(r.lamps)) errs.push(`${where}: lamps not array`);
  validateGeo(r, where, errs);
  // 2.10: survival-Zeilen sind NIE gescort -> cohortN/cohortFallback nullable (present + null|Typ).
  checkNumOrNull(r, 'cohortN', where, errs);
  checkBoolOrNull(r, 'cohortFallback', where, errs);
}

// Hull-level coverage marker: Pflicht (value nullable). Key must be present; if
// present-and-nonnull it must be a well-typed object (schema-doc 2).
function validateCoverage(mk, kind, errs) {
  if (!('coverage' in mk)) { errs.push(`${kind}: coverage missing`); return; }
  const c = mk.coverage;
  if (c === null) return;
  if (typeof c !== 'object') { errs.push(`${kind}: coverage not object|null`); return; }
  if (!VALID_COVERAGE_STATUS.includes(c.status)) errs.push(`${kind}: coverage.status=${JSON.stringify(c.status)}`);
  if (typeof c.degraded !== 'boolean') errs.push(`${kind}: coverage.degraded not boolean`);
  if (typeof c.blocked !== 'boolean') errs.push(`${kind}: coverage.blocked not boolean`);
  if (!Number.isFinite(c.coverage_pct)) errs.push(`${kind}: coverage.coverage_pct not finite`);
}

// R2.18: rank is Number.isInteger(>=1)-checked above but that alone is tautological — rank
// is derived as i+1 from array position (mapBoardRow/mapOverviewRow/mapSurvivalRow), so a
// type check can never contradict a broken sort. Two INDEPENDENT value checks close that gap:
//   checkRankSequence  — rank must equal 1-based index within ITS list (pins the derivation
//                         promise; catches rank getting decoupled from array position).
//   checkScoreDescending — score must be non-increasing (score.js produceRankings' byScore
//                         sort). Independent of rank: a broken upstream sort leaves rank=i+1
//                         internally consistent but scores out of order, so this is the check
//                         that actually catches a broken sort. Only wired where score.js
//                         GUARANTEES score-desc order (board tracks + overview.json) — survival
//                         is runway-desc and its rows carry no .score field at all.
function checkRankSequence(rows, where, errs) {
  (rows || []).forEach((r, i) => { if (r && r.rank !== i + 1) errs.push(`${where}[${i}]: rank!=index+1 (rank=${JSON.stringify(r.rank)})`); });
}
function checkScoreDescending(rows, where, errs) {
  for (let i = 1; i < (rows || []).length; i++) {
    const prev = rows[i - 1], cur = rows[i];
    if (prev && cur && Number.isFinite(cur.score) && Number.isFinite(prev.score) && cur.score > prev.score + 1e-9) {
      errs.push(`${where}[${i}]: score-Ordnung gebrochen (${cur.score} > ${prev.score})`);
    }
  }
}

// opts.forceDiagnostic (BH-160): true when the caller KNOWS mk is a QC board (quality/*, only
// reachable via validateQualityExport, which reads the file list off the QC index). QC boards
// are 'diagnostic' by construction (board-status.js) and can never legitimately be 'core' — a
// plain enum check lets a tampered 'core' slip through silently. validateFile stays reusable
// for HG boards (where 'core' is legitimate) by defaulting the flag off.
function validateFile(mk, kind, errs, opts = {}) {
  if (!mk || typeof mk !== 'object') { errs.push(`${kind}: not an object`); return; }
  if (mk.schema !== SCHEMA) errs.push(`${kind}: schema=${JSON.stringify(mk.schema)}`);
  if (typeof mk.generated_at !== 'string') errs.push(`${kind}: generated_at`);
  validateCoverage(mk, kind, errs);
  if (kind === 'index') {
    if (!Number.isFinite(mk.generatedFromSnapshots)) errs.push('index: generatedFromSnapshots');
    if (!Array.isArray(mk.branches) || mk.branches.length !== BRANCHES.length) errs.push('index: branches');
    if (!mk.boardStatus || typeof mk.boardStatus !== 'object') errs.push('index: boardStatus map missing');
    else {
      for (const [k, v] of Object.entries(mk.boardStatus)) {
        if (!VALID_BOARDSTATUS.includes(v)) errs.push(`index: boardStatus.${k}=${JSON.stringify(v)}`);
      }
      // BH-078: the loop above only checks PRESENT entries' enum value, never completeness —
      // a boardStatus map missing a branch (or carrying a stray extra key) slipped through with
      // zero violations. Pin exact key-set equality against BRANCHES.
      const bsKeys = new Set(Object.keys(mk.boardStatus));
      for (const b of BRANCHES) if (!bsKeys.has(b)) errs.push(`index: boardStatus missing key ${b}`);
      for (const k of bsKeys) if (!BRANCHES.includes(k)) errs.push(`index: boardStatus unexpected key ${k}`);
    }
    if (!mk.counts || typeof mk.counts !== 'object') errs.push('index: counts');
    if (!Number.isFinite(mk.survivalCount)) errs.push('index: survivalCount');
    if (!mk.excluded || typeof mk.excluded !== 'object') errs.push('index: excluded');
    return;
  }
  if (kind === 'survival') {
    if (!Array.isArray(mk.rows)) { errs.push('survival: rows not array'); return; }
    mk.rows.forEach((r, i) => validateSurvivalRow(r, `survival[${i}]`, errs));
    checkRankSequence(mk.rows, 'survival.rows', errs); // R2.18 (a) — runway-desc, no .score -> no (b) here
    return;
  }
  if (kind === 'overview') {
    if (!Array.isArray(mk.rows)) { errs.push('overview: rows not array'); return; }
    mk.rows.forEach((r, i) => validateOverviewRow(r, `overview[${i}]`, errs));
    checkRankSequence(mk.rows, 'overview.rows', errs);     // R2.18 (a)
    checkScoreDescending(mk.rows, 'overview.rows', errs);  // R2.18 (b) — overview.json is globally score-desc
    return;
  }
  // board file: branch (Pflicht, = filename) + profitable/unprofitable arrays of BoardRow.
  if (typeof mk.branch !== 'string' || mk.branch !== kind) errs.push(`${kind}: branch=${JSON.stringify(mk.branch)}`);
  // BH-160: QC boards (opts.forceDiagnostic) are pinned to 'diagnostic' only — 'core' is
  // enum-legal for HG but a QC board can never be core (board-status.js:42).
  const allowedBoardStatus = opts.forceDiagnostic ? ['diagnostic'] : VALID_BOARDSTATUS;
  if (!allowedBoardStatus.includes(mk.boardStatus)) errs.push(`${kind}: boardStatus=${JSON.stringify(mk.boardStatus)}`);
  if (!Array.isArray(mk.profitable)) errs.push(`${kind}: profitable not array`);
  if (!Array.isArray(mk.unprofitable)) errs.push(`${kind}: unprofitable not array`);
  (mk.profitable || []).forEach((r, i) => validateBoardRow(r, `${kind}.profitable[${i}]`, errs));
  (mk.unprofitable || []).forEach((r, i) => validateBoardRow(r, `${kind}.unprofitable[${i}]`, errs));
  checkPrognoseFeldHomogen([].concat(mk.profitable || [], mk.unprofitable || []), kind, errs);
  // R2.18: each track is its OWN score-desc list (score.js rankBy/byScore sorts profitable and
  // unprofitable separately), so rank(a)+score(b) are checked per track, not across both.
  checkRankSequence(mk.profitable, `${kind}.profitable`, errs);
  checkScoreDescending(mk.profitable, `${kind}.profitable`, errs);
  checkRankSequence(mk.unprofitable, `${kind}.unprofitable`, errs);
  checkScoreDescending(mk.unprofitable, `${kind}.unprofitable`, errs);
}

// Validate the ON-DISK export (what CI just wrote). Missing/unreadable file = breach.
function validateExport() {
  const errs = [];
  for (const id of BRANCHES) {
    const mk = readJSONOrNull(path.join(OUT_DIR, id + '.json'));
    if (!mk) { errs.push(`${id}: missing/unreadable`); continue; }
    validateFile(mk, id, errs);
  }
  for (const [name, kind] of [['overview.json', 'overview'], ['survival.json', 'survival'], ['index.json', 'index']]) {
    const mk = readJSONOrNull(path.join(OUT_DIR, name));
    if (!mk) { errs.push(`${kind}: missing/unreadable`); continue; }
    validateFile(mk, kind, errs);
  }
  return errs.concat(validateQualityExport())  // 3.2: QC-Board (empty when quality/ absent)
             .concat(validateSmallcapExport()); // 5.2: Small-Cap-Board (empty when smallcap/ absent)
}

// ---- QC-Board validation (3.2) ------------------------------------------
// QC index is the HG index MINUS branches/survivalCount (QC has no survival board and a
// dynamic board set). Small dedicated check; the board+overview ROWS reuse validateFile /
// validateBoardRow / validateOverviewRow verbatim (no parallel row-validator).
function validateQualityIndex(mk, errs) {
  const kind = 'quality/index';
  if (!mk || typeof mk !== 'object') { errs.push(`${kind}: not an object`); return; }
  if (mk.schema !== SCHEMA) errs.push(`${kind}: schema=${JSON.stringify(mk.schema)}`);
  if (typeof mk.generated_at !== 'string') errs.push(`${kind}: generated_at`);
  validateCoverage(mk, kind, errs);
  if (!Number.isFinite(mk.generatedFromSnapshots)) errs.push(`${kind}: generatedFromSnapshots`);
  if (!Array.isArray(mk.boards) || !mk.boards.length) errs.push(`${kind}: boards`);
  if (!mk.boardStatus || typeof mk.boardStatus !== 'object') errs.push(`${kind}: boardStatus map missing`);
  else {
    // BH-078: QC boardStatus values are restricted to 'diagnostic' only (not the shared
    // VALID_BOARDSTATUS enum) — a manipulated 'core' in the QC index is a real breach, unlike
    // on an HG index where 'core' is legitimate.
    for (const [k, v] of Object.entries(mk.boardStatus)) {
      if (v !== 'diagnostic') errs.push(`${kind}: boardStatus.${k}=${JSON.stringify(v)}`);
    }
    // BH-078: exact key-set match against mk.boards — completeness, not just per-entry enum
    // (a missing or stray extra key previously produced zero violations).
    if (Array.isArray(mk.boards)) {
      const bsKeys = new Set(Object.keys(mk.boardStatus));
      for (const b of mk.boards) if (!bsKeys.has(b)) errs.push(`${kind}: boardStatus missing key ${b}`);
      for (const k of bsKeys) if (!mk.boards.includes(k)) errs.push(`${kind}: boardStatus unexpected key ${k}`);
    }
  }
  if (!mk.counts || typeof mk.counts !== 'object') errs.push(`${kind}: counts`);
  if (!mk.excluded || typeof mk.excluded !== 'object') errs.push(`${kind}: excluded`);
}

// Optional-when-absent: no quality/index.json on disk -> nothing to validate ([]). Once it
// exists, every board it lists + overview become Pflicht and are fully validated. All labels
// carry a 'quality/' prefix so the alarm channel never confuses a QC breach with an HG one.
function validateQualityExport() {
  const raw = [];
  const idx = readJSONOrNull(path.join(QOUT_DIR, 'index.json'));
  if (!idx) return raw; // quality/ absent -> optional, no breach
  validateQualityIndex(idx, raw);
  const boards = Array.isArray(idx.boards) ? idx.boards : [];
  for (const id of boards) {
    const stem = String(id).replace(/^quality-/, '');
    const mk = readJSONOrNull(path.join(QOUT_DIR, stem + '.json'));
    if (!mk) { raw.push(`quality/${stem}: missing/unreadable`); continue; }
    // BH-160: forceDiagnostic — this file is KNOWN to be a QC board (came off idx.boards), so
    // boardStatus is pinned to 'diagnostic' here, unlike the HG board-file call below.
    validateFile(mk, stem, raw, { forceDiagnostic: true }); // reuses board-file check: branch===stem, boardStatus enum, every BoardRow
  }
  const ov = readJSONOrNull(path.join(QOUT_DIR, 'overview.json'));
  if (!ov) raw.push('quality/overview: missing/unreadable');
  else validateFile(ov, 'overview', raw); // reuses OverviewRow check
  return raw.map((e) => (e.startsWith('quality/') ? e : 'quality/' + e));
}

// ---- Small-Cap-Board validation (5.2) -----------------------------------
// Identisches Muster wie validateQualityIndex/validateQualityExport (dupliziert statt
// parametrisiert, s. Kommentar bei buildSmallcap). 'smallcap-'-Praefix statt 'quality-'.
function validateSmallcapIndex(mk, errs) {
  const kind = 'smallcap/index';
  if (!mk || typeof mk !== 'object') { errs.push(`${kind}: not an object`); return; }
  if (mk.schema !== SCHEMA) errs.push(`${kind}: schema=${JSON.stringify(mk.schema)}`);
  if (typeof mk.generated_at !== 'string') errs.push(`${kind}: generated_at`);
  validateCoverage(mk, kind, errs);
  if (!Number.isFinite(mk.generatedFromSnapshots)) errs.push(`${kind}: generatedFromSnapshots`);
  if (!Array.isArray(mk.boards) || !mk.boards.length) errs.push(`${kind}: boards`);
  if (!mk.boardStatus || typeof mk.boardStatus !== 'object') errs.push(`${kind}: boardStatus map missing`);
  else {
    for (const [k, v] of Object.entries(mk.boardStatus)) {
      if (v !== 'diagnostic') errs.push(`${kind}: boardStatus.${k}=${JSON.stringify(v)}`);
    }
    if (Array.isArray(mk.boards)) {
      const bsKeys = new Set(Object.keys(mk.boardStatus));
      for (const b of mk.boards) if (!bsKeys.has(b)) errs.push(`${kind}: boardStatus missing key ${b}`);
      for (const k of bsKeys) if (!mk.boards.includes(k)) errs.push(`${kind}: boardStatus unexpected key ${k}`);
    }
  }
  if (!mk.counts || typeof mk.counts !== 'object') errs.push(`${kind}: counts`);
  if (!mk.excluded || typeof mk.excluded !== 'object') errs.push(`${kind}: excluded`);
  // 5.2 Auflage 3: coverageFloor ist Pflicht (nullable) — der Beleg-Wert des data-abgeleiteten
  // Coverage-Gates dieses Laufs muss im Export ankommen, sonst ist Auflage 3 nicht nachpruefbar.
  if (!('coverageFloor' in mk)) errs.push(`${kind}: coverageFloor missing`);
  else if (mk.coverageFloor !== null && !Number.isFinite(mk.coverageFloor)) errs.push(`${kind}: coverageFloor not finite|null`);
}

function validateSmallcapExport() {
  const raw = [];
  const idx = readJSONOrNull(path.join(SCOUT_DIR, 'index.json'));
  if (!idx) return raw; // smallcap/ absent -> optional, no breach
  validateSmallcapIndex(idx, raw);
  const boards = Array.isArray(idx.boards) ? idx.boards : [];
  for (const id of boards) {
    const stem = String(id).replace(/^smallcap-/, '');
    const mk = readJSONOrNull(path.join(SCOUT_DIR, stem + '.json'));
    if (!mk) { raw.push(`smallcap/${stem}: missing/unreadable`); continue; }
    validateFile(mk, stem, raw, { forceDiagnostic: true });
  }
  const ov = readJSONOrNull(path.join(SCOUT_DIR, 'overview.json'));
  if (!ov) raw.push('smallcap/overview: missing/unreadable');
  else validateFile(ov, 'overview', raw);
  return raw.map((e) => (e.startsWith('smallcap/') ? e : 'smallcap/' + e));
}

// ---- runnable self-check: node scripts/write-findash-export.js --selftest ----
// Exercises the ACTUAL gate blind spots the Court proved (not just trivial cases):
// every Pflicht field on every row shape must trip a violation when tampered.
function selftest() {
  const assert = require('assert');
  const cleanBoard = {
    ticker: 'NVDA', name: 'NVIDIA Corporation', score: 88.2, track: 'profitable', lamps: ['peakMargin'],
    overview: { kind: 'gp', value: -0.055, companion: 89.1 },
    country: 'United States', region: 'North America', sector: 'Technology',
    marketCap: 5457368842240, phase: 'established', mcapBand: 'mega', ipoRecency: 'mature',
    profitTier: 'langfristig-profitabel', ipoYear: 1999,
    cohortN: 90, cohortFallback: false, // 2.10
  };
  const cleanOv = {
    ticker: 'NVDA', name: 'NVIDIA Corporation', formulaId: 'semiconductors', track: 'profitable', score: 94.9,
    overviewKind: 'gp', overviewValue: -1.17, overviewCompanion: 195.3, lamps: [],
    country: 'United States', region: 'North America', sector: 'Technology',
    marketCap: 33018304599.802, phase: 'inflected', mcapBand: 'large', ipoRecency: 'growth',
    cohortN: 90, cohortFallback: false, // 2.10
  };
  const cleanSv = {
    ticker: 'PAH3.DE', name: 'Porsche Automobil Holding SE', runwayQuarters: 9999, lamps: ['burning'],
    country: 'Germany', region: 'Europe', sector: 'Consumer Cyclical',
    marketCap: null, phase: null, mcapBand: 'small', ipoRecency: null,
    cohortN: null, cohortFallback: null, // 2.10: survival nie gescort -> nullable
  };
  const cleanErrs = (fn, mapped) => { const e = []; fn(mapped, 'r', e); return e; };
  assert.strictEqual(cleanErrs(validateBoardRow, mapBoardRow(cleanBoard, 0)).length, 0, 'clean board must validate');
  assert.strictEqual(cleanErrs(validateOverviewRow, mapOverviewRow(cleanOv, 0)).length, 0, 'clean overview must validate');
  assert.strictEqual(cleanErrs(validateSurvivalRow, mapSurvivalRow(cleanSv, 0)).length, 0, 'clean survival must validate');
  // negative overview.value + null companion round-trip
  assert.strictEqual(mapBoardRow({ ...cleanBoard, overview: { kind: 'gp', value: -1.17, companion: null } }, 5).overview.value, -1.17);

  // tamper matrix — each MUST produce >=1 violation. If any slips through with 0, the gate is blind.
  const trip = (fn, row, label) => { const e = []; fn(row, 't', e); assert.ok(e.length > 0, `TAMPER SLIPPED: ${label}`); };
  // Gegenstueck zu trip(): ein additiv-OPTIONALES Feld muss in seiner gueltigen Form
  // DURCHGEHEN. Ohne diese Richtung wuerde ein zu strenger Waechter unbemerkt Karls
  // einzigen Alarmkanal rot faerben, sobald das Feld einmal wirklich gefuellt ist.
  const pass_ = (fn, row, label) => { const e = []; fn(row, 't', e); assert.equal(e.length, 0, `FALSCH-ROT: ${label} -> ${e.join('; ')}`); };
  const b0 = mapBoardRow(cleanBoard, 0);
  trip(validateBoardRow, { ...b0, score: NaN }, 'board score NaN');
  trip(validateBoardRow, { ...b0, track: 'ghost' }, 'board track bad enum');
  trip(validateBoardRow, { ...b0, rank: undefined }, 'board rank removed');
  const bNoCountry = { ...b0 }; delete bNoCountry.country; trip(validateBoardRow, bNoCountry, 'board country missing');
  const bNoName = { ...b0 }; delete bNoName.name; trip(validateBoardRow, bNoName, 'board name missing');
  trip(validateBoardRow, { ...b0, name: 12345 }, 'board name number');
  trip(validateBoardRow, { ...b0, sector: 12345 }, 'board sector number');
  const bNoRegion = { ...b0 }; delete bNoRegion.region; trip(validateBoardRow, bNoRegion, 'board region missing');
  trip(validateBoardRow, { ...b0, marketCap: 'GARBAGE' }, 'board marketCap string');
  trip(validateBoardRow, { ...b0, phase: 'zombie' }, 'board phase bad enum');
  trip(validateBoardRow, { ...b0, mcapBand: 'huge' }, 'board mcapBand bad enum');
  trip(validateBoardRow, { ...b0, ipoRecency: 'ancient' }, 'board ipoRecency bad enum');
  trip(validateBoardRow, { ...b0, overview: { kind: 'TOTALLY-BOGUS', value: 1, companion: 1 } }, 'board overview.kind garbage');
  trip(validateBoardRow, { ...b0, overview: { kind: 'gp', value: NaN, companion: 1 } }, 'board overview.value NaN');
  trip(validateBoardRow, { ...b0, overview: { kind: 'gp', value: 1, companion: 'X' } }, 'board overview.companion garbage');
  trip(validateBoardRow, { ...b0, overview: { value: 1, companion: 1 } }, 'board overview.kind removed');
  trip(validateBoardRow, { ...b0, profitTier: 'zombie-tier' }, 'board profitTier bad enum');     // 1.2
  trip(validateBoardRow, { ...b0, ipoYear: 'GARBAGE' }, 'board ipoYear string');                 // 1.2
  const bNoTier = { ...b0 }; delete bNoTier.profitTier; trip(validateBoardRow, bNoTier, 'board profitTier missing'); // 1.2
  // 2.10: cohortN/cohortFallback Pflicht auf gescorten Zeilen (Tamper -> exit 1).
  trip(validateBoardRow, { ...b0, cohortN: 'GARBAGE' }, 'board cohortN string');
  const bNoN = { ...b0 }; delete bNoN.cohortN; trip(validateBoardRow, bNoN, 'board cohortN missing');
  trip(validateBoardRow, { ...b0, cohortFallback: 'yes' }, 'board cohortFallback non-boolean');
  const bNoFb = { ...b0 }; delete bNoFb.cohortFallback; trip(validateBoardRow, bNoFb, 'board cohortFallback missing');

  // 4.5 profitStreak — additiv OPTIONAL: Abwesenheit und null muessen DURCHGEHEN,
  // eine kaputte Form nicht. Beide Richtungen, sonst prueft der Waechter nur die haelfte.
  const bStreakOk = { ...b0, profitStreak: { jahre: 9, basis: 'opInc', tiefe: 16, mindestens: false, letzterVerlust: 2016 } };
  pass_(validateBoardRow, bStreakOk, 'board profitStreak valide Form geht durch');
  pass_(validateBoardRow, { ...b0, profitStreak: null }, 'board profitStreak null geht durch');
  pass_(validateBoardRow, b0, 'board ohne profitStreak geht durch');
  trip(validateBoardRow, { ...bStreakOk, profitStreak: { ...bStreakOk.profitStreak, jahre: -1 } }, 'board profitStreak jahre negativ');
  trip(validateBoardRow, { ...bStreakOk, profitStreak: { ...bStreakOk.profitStreak, basis: 'ebitda' } }, 'board profitStreak basis bad enum');
  trip(validateBoardRow, { ...bStreakOk, profitStreak: { ...bStreakOk.profitStreak, mindestens: 'ja' } }, 'board profitStreak mindestens non-boolean');
  // Die beiden inneren Widersprueche: eine Serie kann nicht laenger sein als die Reihe,
  // und wer bis zum Reihenanfang durchlaeuft, kann kein Verlustjahr in Sicht haben.
  trip(validateBoardRow, { ...bStreakOk, profitStreak: { ...bStreakOk.profitStreak, jahre: 20 } }, 'board profitStreak jahre > tiefe');
  trip(validateBoardRow, { ...bStreakOk, profitStreak: { ...bStreakOk.profitStreak, mindestens: true } }, 'board profitStreak mindestens+letzterVerlust');

  // F-2 Stufe 1 einmalertragPrognose — beide Richtungen. cleanBoard traegt lamps:['peakMargin'],
  // also KEINE Einmalertrags-Lampe: dort muss jeder Zustand auffliegen. Mit Lampe muss jeder der
  // vier gepflegten Zustaende durchgehen, ein unbekannter nicht.
  const bLampe = mapBoardRow({ ...cleanBoard, lamps: ['einmalertrag'] }, 0);
  for (const z of VALID_EINMALERTRAG_PROGNOSE) {
    pass_(validateBoardRow, { ...bLampe, einmalertragPrognose: z }, 'board einmalertragPrognose ' + z + ' mit Lampe geht durch');
    trip(validateBoardRow, { ...b0, einmalertragPrognose: z }, 'board einmalertragPrognose ' + z + ' OHNE Lampe');
  }
  pass_(validateBoardRow, { ...bLampe, einmalertragPrognose: null }, 'board einmalertragPrognose null geht durch');
  pass_(validateBoardRow, b0, 'board ohne einmalertragPrognose geht durch');
  trip(validateBoardRow, { ...bLampe, einmalertragPrognose: 'bestätigt' }, 'board einmalertragPrognose Umlaut-Variante');
  trip(validateBoardRow, { ...bLampe, einmalertragPrognose: 'toString' }, 'board einmalertragPrognose Prototyp-Name');
  trip(validateBoardRow, { ...bLampe, einmalertragPrognose: 1 }, 'board einmalertragPrognose Zahl');

  const o0 = mapOverviewRow(cleanOv, 0);
  trip(validateOverviewRow, { ...o0, track: 'ghost' }, 'overview track bad enum');
  trip(validateOverviewRow, { ...o0, overviewKind: 999 }, 'overview overviewKind number');
  trip(validateOverviewRow, { ...o0, overviewCompanion: 'GARBAGE' }, 'overview companion garbage');
  trip(validateOverviewRow, { ...o0, phase: 'zombie' }, 'overview phase bad enum');
  const oNoRank = { ...o0 }; delete oNoRank.rank; trip(validateOverviewRow, oNoRank, 'overview rank removed');
  const oNoN = { ...o0 }; delete oNoN.cohortN; trip(validateOverviewRow, oNoN, 'overview cohortN missing'); // 2.10
  trip(validateOverviewRow, { ...o0, cohortN: null }, 'overview cohortN null (scored row)');                 // 2.10

  const s0 = mapSurvivalRow(cleanSv, 0);
  const sNoRank = { ...s0 }; delete sNoRank.rank; trip(validateSurvivalRow, sNoRank, 'survival rank removed');
  trip(validateSurvivalRow, { ...s0, marketCap: 'GARBAGE' }, 'survival marketCap garbage');
  trip(validateSurvivalRow, { ...s0, phase: 'zombie' }, 'survival phase bad enum');

  // hull-level: coverage key missing / bad status, branch mismatch, boardStatus (2.1).
  const mkHull = (over = {}) => ({ schema: SCHEMA, generated_at: 'x', boardStatus: 'core', coverage: null, branch: 'energy', profitable: [], unprofitable: [], ...over });
  const mkIdx = (over = {}) => ({ schema: SCHEMA, generated_at: 'x', coverage: null, generatedFromSnapshots: 1, branches: BRANCHES, boardStatus: Object.fromEntries(BRANCHES.map(b => [b, 'core'])), counts: {}, survivalCount: 0, excluded: {}, ...over });
  let e, m;
  e = []; validateFile(mkHull(), 'energy', e); assert.strictEqual(e.length, 0, 'clean board hull must validate');
  m = mkHull(); delete m.coverage; e = []; validateFile(m, 'energy', e);
  assert.ok(e.some(x => /coverage missing/.test(x)), 'coverage key missing must trip');
  e = []; validateFile(mkHull({ branch: 'WRONG' }), 'energy', e);
  assert.ok(e.some(x => /branch=/.test(x)), 'branch mismatch must trip');
  e = []; validateFile(mkHull({ coverage: { status: 'bogus', degraded: true, blocked: false, coverage_pct: 20 } }), 'energy', e);
  assert.ok(e.some(x => /coverage\.status/.test(x)), 'bad coverage.status must trip');
  // 2.1 boardStatus gate: missing / bad enum on a board file must trip.
  m = mkHull(); delete m.boardStatus; e = []; validateFile(m, 'energy', e);
  assert.ok(e.some(x => /boardStatus/.test(x)), 'board boardStatus missing must trip');
  e = []; validateFile(mkHull({ boardStatus: 'bogus' }), 'energy', e);
  assert.ok(e.some(x => /boardStatus=/.test(x)), 'board boardStatus bad enum must trip');
  // index boardStatus map: clean passes, missing map / bad value trip.
  e = []; validateFile(mkIdx(), 'index', e); assert.strictEqual(e.length, 0, 'clean index must validate');
  e = []; validateFile(mkIdx({ boardStatus: { energy: 'bogus' } }), 'index', e);
  assert.ok(e.some(x => /boardStatus\.energy/.test(x)), 'index boardStatus bad enum must trip');
  m = mkIdx(); delete m.boardStatus; e = []; validateFile(m, 'index', e);
  assert.ok(e.some(x => /boardStatus map missing/.test(x)), 'index boardStatus map missing must trip');
  // BH-078: boardStatus map completeness — a missing key (branch dropped from the map, values
  // otherwise all valid) or an unexpected extra key must trip, not just a bad per-entry enum.
  e = []; validateFile(mkIdx({ boardStatus: Object.fromEntries(BRANCHES.slice(1).map(b => [b, 'core'])) }), 'index', e);
  assert.ok(e.some(x => /boardStatus missing key/.test(x)), 'index boardStatus missing key must trip');
  e = []; validateFile(mkIdx({ boardStatus: { ...Object.fromEntries(BRANCHES.map(b => [b, 'core'])), ghost: 'core' } }), 'index', e);
  assert.ok(e.some(x => /boardStatus unexpected key/.test(x)), 'index boardStatus extra key must trip');

  // ---- 3.2 QC-Board (quality/) ------------------------------------------------
  // QC rows are the SAME shape as HG board/overview rows -> row validators reused; only the
  // QC-specific invariants are asserted here.
  assert.strictEqual(boardStatusOf('quality-semiconductors'), 'diagnostic', 'QC board must be diagnostic by construction');
  assert.strictEqual(boardStatusOf('quality-anything'), 'diagnostic', 'every quality-* id is diagnostic');
  // QC board hull: validateQualityExport calls validateFile with forceDiagnostic:true (BH-160)
  // — simulate that here. Plain validateFile (no opts) stays enum-permissive since it is reused
  // for HG boards too, where 'core' is legitimate (see mkHull tests above).
  const mkQHull = (over = {}) => ({ schema: SCHEMA, generated_at: 'x', boardStatus: 'diagnostic', coverage: null, branch: 'semiconductors', profitable: [mapBoardRow(cleanBoard, 0)], unprofitable: [], ...over });
  e = []; validateFile(mkQHull(), 'semiconductors', e, { forceDiagnostic: true }); assert.strictEqual(e.length, 0, 'clean QC board hull must validate');
  // BH-160: 'core' is enum-legal HG-wide but QC boards are always diagnostic (board-status.js:42)
  // — under forceDiagnostic it now MUST trip (previously slipped through silently).
  e = []; validateFile(mkQHull({ boardStatus: 'core' }), 'semiconductors', e, { forceDiagnostic: true });
  assert.ok(e.some(x => /boardStatus=/.test(x)), "BH-160: QC boardStatus 'core' must trip under forceDiagnostic");
  m = mkQHull(); delete m.boardStatus; e = []; validateFile(m, 'semiconductors', e, { forceDiagnostic: true });
  assert.ok(e.some(x => /boardStatus/.test(x)), 'QC boardStatus missing must trip');
  e = []; validateFile(mkQHull({ boardStatus: 'bogus' }), 'semiconductors', e, { forceDiagnostic: true });
  assert.ok(e.some(x => /boardStatus=/.test(x)), 'QC boardStatus bogus must trip');
  // cohortN tamper on a QC row trips (row validator reused).
  trip(validateBoardRow, { ...b0, cohortN: 'GARBAGE' }, 'QC board cohortN string');
  // QC index validator: clean passes; boardStatus bogus / map removed trip.
  const mkQIdx = (over = {}) => ({ schema: SCHEMA, generated_at: 'x', coverage: null, generatedFromSnapshots: 1, boards: ['quality-semiconductors'], boardStatus: { 'quality-semiconductors': 'diagnostic' }, counts: {}, excluded: {}, ...over });
  e = []; validateQualityIndex(mkQIdx(), e); assert.strictEqual(e.length, 0, 'clean QC index must validate');
  e = []; validateQualityIndex(mkQIdx({ boardStatus: { 'quality-semiconductors': 'bogus' } }), e);
  assert.ok(e.some(x => /boardStatus\.quality-semiconductors/.test(x)), 'QC index boardStatus bogus must trip');
  m = mkQIdx(); delete m.boardStatus; e = []; validateQualityIndex(m, e);
  assert.ok(e.some(x => /boardStatus map missing/.test(x)), 'QC index boardStatus map missing must trip');
  // BH-078: QC boardStatus map values are restricted to 'diagnostic' only — 'core' is enum-legal
  // on the shared VALID_BOARDSTATUS list but must trip here (QC can never be core).
  e = []; validateQualityIndex(mkQIdx({ boardStatus: { 'quality-semiconductors': 'core' } }), e);
  assert.ok(e.some(x => /boardStatus\.quality-semiconductors/.test(x)), 'QC index boardStatus core must trip (QC-only-diagnostic)');
  // BH-078: key-set completeness against mk.boards — a board present in `boards` but missing
  // from the boardStatus map (or a stray extra key) must trip.
  e = []; validateQualityIndex(mkQIdx({ boards: ['quality-semiconductors', 'quality-energy'] }), e);
  assert.ok(e.some(x => /boardStatus missing key quality-energy/.test(x)), 'QC index boardStatus missing key must trip');
  e = []; validateQualityIndex(mkQIdx({ boardStatus: { 'quality-semiconductors': 'diagnostic', 'quality-ghost': 'diagnostic' } }), e);
  assert.ok(e.some(x => /boardStatus unexpected key/.test(x)), 'QC index boardStatus extra key must trip');

  // ---- 5.2 Small-Cap-Board (smallcap/) — identisches Muster wie QC, lean (Row-Validatoren
  // sind bereits gegen jeden Tamper bewiesen; hier nur die smallcap-spezifischen Invarianten:
  // boardStatus-Praefix, coverageFloor-Pflichtfeld).
  assert.strictEqual(boardStatusOf('smallcap-semiconductors'), 'diagnostic', 'Small-Cap-Board muss diagnostic sein');
  const mkScIdx = (over = {}) => ({ schema: SCHEMA, generated_at: 'x', coverage: null, generatedFromSnapshots: 1, boards: ['smallcap-semiconductors'], boardStatus: { 'smallcap-semiconductors': 'diagnostic' }, counts: {}, excluded: {}, coverageFloor: 0.42, ...over });
  e = []; validateSmallcapIndex(mkScIdx(), e); assert.strictEqual(e.length, 0, 'clean Small-Cap-index must validate');
  m = mkScIdx(); delete m.coverageFloor; e = []; validateSmallcapIndex(m, e);
  assert.ok(e.some(x => /coverageFloor missing/.test(x)), 'Small-Cap coverageFloor missing must trip (Auflage 3 Beleg-Pflicht)');
  e = []; validateSmallcapIndex(mkScIdx({ coverageFloor: 'GARBAGE' }), e);
  assert.ok(e.some(x => /coverageFloor not finite/.test(x)), 'Small-Cap coverageFloor garbage must trip');
  e = []; validateSmallcapIndex(mkScIdx({ coverageFloor: null }), e);
  assert.strictEqual(e.length, 0, 'Small-Cap coverageFloor null is legit (Degenerations-Guard, quantile() liefert null)');
  e = []; validateSmallcapIndex(mkScIdx({ boardStatus: { 'smallcap-semiconductors': 'core' } }), e);
  assert.ok(e.some(x => /boardStatus\.smallcap-semiconductors/.test(x)), 'Small-Cap boardStatus core must trip (nur-diagnostic)');

  console.log('selftest OK');
}

if (require.main === module) {
  if (process.argv.includes('--selftest')) { selftest(); process.exit(0); }
  if (process.argv.includes('--check')) {
    const errs = validateExport();
    if (errs.length) {
      console.error(`::error::findash-export/v1 schema contract violation (${errs.length}): ${errs.slice(0, 20).join('; ')}`);
      process.exit(1);
    }
    console.log('findash-export/v1 schema OK.');
    process.exit(0);
  }
  const r = build();
  console.log(`findash-export/v1 written: ${r.branches} boards + overview + survival + index + ${r.qualityBoards} QC boards (quality/) + ${r.smallcapBoards} Small-Cap boards (smallcap/) -> ${r.out}`);
}

module.exports = {
  build, validateExport, validateFile, validateBoardRow, validateOverviewRow, validateSurvivalRow,
  validateQualityExport, validateQualityIndex, buildQuality, qualityExportMode,
  validateSmallcapExport, validateSmallcapIndex, buildSmallcap, smallcapExportMode,
  mapBoardRow, mapOverviewRow, mapSurvivalRow, SCHEMA, BRANCHES,
};

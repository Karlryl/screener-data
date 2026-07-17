'use strict';
/**
 * CLI: Hypergrowth-Screener ueber das volle Snapshot-Universum laufen lassen und
 * dashboard-integrierbares JSON schreiben (outputs/hypergrowth/).
 *
 *   node src/scoring/run-screener.js [--topN 100]
 *
 * Schreibt: <branche>.json (gerankt je Track), overview.json (cross-branch),
 * survival.json (Pre-Revenue-Biotech), index.json (Zaehlung/Meta).
 */
const fs = require('fs');
const path = require('path');
const { scoreUniverse, produceRankings, calibrationDrift } = require('./score.js');
const formulas = require('./formulas/index.js');
// 3.1 QC-Board (DIAGNOSTIC, additiv): eigener Membership-Router + eigene Formel-Registry + Board-Status.
const { qualityRoute } = require('./quality-route.js');
const qcFormulas = require('./formulas/quality/index.js');
const { boardStatus } = require('./board-status.js');
// audit/fix (C2): Outputs atomar schreiben (tmp+rename), wie das ganze Daten-Fundament —
// plain fs.writeFileSync hinterlaesst bei Crash/CI-Timeout truncated JSON fuers Dashboard.
const { writeJsonAtomic } = require('../../lib/atomic-write.js');

const ROOT = path.join(__dirname, '..', '..');
const SNAP_DIR = path.join(ROOT, 'snapshots');
const OUT_DIR = path.join(ROOT, 'outputs', 'hypergrowth');
const QC_OUT_DIR = path.join(ROOT, 'outputs', 'quality'); // 3.1 QC-Board (DIAGNOSTIC), getrennter Ordner

// audit/fix (Court Phase A Runde 3, Fall C1): Coverage-Floor gegen eine SELF-BASELINE.
// Weil das Scoring kohorten-relativ perzentil-normiert, verschiebt ein still geschrumpftes
// Universum (defekte/nicht-parsbare Snapshots) lautlos ALLE Perzentile. Der R2-Fall-7-Floor
// verglich on-disk (lokal akkumulierte Snapshot-Union) gegen manifest.n_ok (OK-Count des
// LETZTEN Pulls) — zwei DESYNCHRONISIERTE Populationen (n_ok git-volatil 3978..11827 -> 20%
// der juengsten Manifeste haetten einen GESUNDEN Lauf falsch abgebrochen). Jetzt: Schwelle
// = COVERAGE_FLOOR_RATIO * Self-Baseline (= zuletzt erfolgreich geladener on-disk-Count,
// High-Water in snapshots/_last_good_disk.json) — disk-jetzt vs disk-zuletzt-gesund, DIESELBE
// lokal akkumulierende Population. KEINE absolute Magic Number, skaliert mit dem Universum.
// manifest.n_ok ist nur noch console.warn-Diagnose. COVERAGE_FLOOR_RATIO=0.95 bleibt kalibriert.
const COVERAGE_FLOOR_RATIO = 0.95;
const LAST_GOOD_DISK = path.join(SNAP_DIR, '_last_good_disk.json'); // git-ignored (wie snapshots/)

/**
 * Wirft (Fail-Loud), wenn die geladene Snapshot-Anzahl unter den Self-Baseline-relativen
 * Coverage-Floor faellt. Reine Funktion (testbar, kein I/O). Ohne verwertbare Baseline
 * (Erstlauf: fehlt/0/NaN) ist der relative Floor nicht berechenbar -> kein throw (fail-open).
 */
function assertCoverageFloor(loadedCount, baseline, floorRatio = COVERAGE_FLOOR_RATIO) {
  if (!Number.isFinite(baseline) || baseline <= 0) return; // keine Baseline (Erstlauf) -> nicht erzwingbar
  const floor = Math.ceil(floorRatio * baseline);
  if (loadedCount < floor) {
    throw new Error(
      `[run-screener] loadUniverse: nur ${loadedCount} Snapshots on-disk, unter Coverage-Floor ` +
      `${floor} (= ${floorRatio} x Self-Baseline ${baseline}, zuletzt-gesunder on-disk-Count). Universum ` +
      `geschrumpft — Kohorten-Perzentile waeren unzuverlaessig. Lauf abgebrochen (defekte/fehlende ` +
      `Snapshots pruefen; bei legitimem Schrumpfen snapshots/_last_good_disk.json loeschen zum Reset).`
    );
  }
}

/**
 * Self-Baseline (High-Water) wird MONOTON angehoben (nie gesenkt): ein gewachsenes Universum
 * hebt die Baseline, ein kleiner Dip (>Floor) haelt sie -> echtes Schrumpfen ZWISCHEN Laeufen
 * wirft weiterhin hart. Reine Funktion. Erstlauf/unbrauchbare Baseline -> der frische loaded-Wert.
 */
function nextHighWater(prevBaseline, loadedCount) {
  const prev = Number.isFinite(prevBaseline) && prevBaseline > 0 ? prevBaseline : 0;
  return Math.max(prev, loadedCount);
}

function loadUniverse() {
  const u = [];
  let parseFail = 0, skippedNoMeta = 0;
  for (const f of fs.readdirSync(SNAP_DIR)) {
    if (!f.endsWith('.json')) continue;
    // audit/fix (C3): NUR die Manifeste (_manifest.json/_manifest-full.json) explizit skippen,
    // NICHT pauschal jedes "_"-Praefix — safeSnapshotFilename praefixt Windows-Reserved-Ticker
    // (CON/PRN/AUX/NUL/COM1..LPT9 -> z.B. _CON.json), das sind ECHTE Snapshots mit meta.ticker.
    if (f.startsWith('_manifest') || f === '_last_good_disk.json') continue;
    let s;
    try {
      s = JSON.parse(fs.readFileSync(path.join(SNAP_DIR, f), 'utf8'));
    } catch (_) { parseFail++; continue; } // defekter Snapshot
    if (s && s.meta && s.meta.ticker) u.push(s);
    else skippedNoMeta++;
  }
  // audit/fix (C3): still geschluckte Parse-Fehler / Schema-Drift verzerren lautlos die
  // Kohorten-Perzentile (Universum schrumpft unbemerkt) -> sichtbar machen statt verschweigen.
  if (parseFail > 0 || skippedNoMeta > 0) {
    console.warn(`[run-screener] loadUniverse: ${u.length} geladen, ${parseFail} parse-fail, ${skippedNoMeta} ohne meta.ticker uebersprungen`);
  }
  // audit/fix (Court Fall C1): HARTER Floor gegen die Self-Baseline (zuletzt-gesunder on-disk-Count).
  // I/O hier isoliert, die Floor-/High-Water-Logik bleibt rein (assertCoverageFloor/nextHighWater).
  let baseline = null;
  try {
    baseline = JSON.parse(fs.readFileSync(LAST_GOOD_DISK, 'utf8')).value;
  } catch (_) { /* Erstlauf / kein High-Water -> fail-open, gleich Startwert schreiben */ }
  // manifest.n_ok nur noch als Diagnose (NICHT mehr als Floor-Referenz — andere Population).
  try {
    const nOk = JSON.parse(fs.readFileSync(path.join(SNAP_DIR, '_manifest.json'), 'utf8')).n_ok;
    if (Number.isFinite(nOk) && Math.abs(u.length - nOk) > 0.2 * nOk) {
      console.warn(`[run-screener] loadUniverse: on-disk ${u.length} weicht >20% von manifest n_ok ${nOk} ab (verschiedene Populationen — nur Diagnose).`);
    }
  } catch (_) { /* manifest optional fuer die Diagnose */ }
  assertCoverageFloor(u.length, baseline);
  // High-Water nach bestandenem Floor monoton fortschreiben. ATOMAR (tmp+rename) via writeJsonAtomic —
  // audit/fix (Court R3 Runde-4-Regress): genau dieser State-File ist der Anker des Coverage-Floors;
  // ein plain fs.writeFileSync hinterliesse bei Crash/CI-Timeout truncated JSON -> Read liefert baseline=
  // null -> Floor fail-open + nextHighWater re-ankert auf den geschrumpften Wert -> High-Water-Lock weg
  // (F-SM-015-baseline-wipe). Best effort, kein Abbruch bei I/O-Fehler.
  try {
    writeJsonAtomic(LAST_GOOD_DISK, { value: nextHighWater(baseline, u.length), generatedAt: new Date().toISOString() });
  } catch (e) {
    console.warn('[run-screener] loadUniverse: _last_good_disk.json nicht schreibbar — Self-Baseline nicht fortgeschrieben:', e.message);
  }
  mergeSecIntoUniverse(u); // PHASE 4: committete tiefe SEC-Serie an US-Namen anhaengen (deterministisch, kein Netzwerk)
  return u;
}

// PHASE 4 (Refresh-Robustheit): haengt die COMMITTETE tiefe SEC-annual-Serie (external-data/sec-secannual.json,
// per build-secannual offline erzeugt, FY-Versatz-robust via loose-sanity gefiltert) an die passenden Snapshots.
// DETERMINISTISCH: liest die COMMITTETE Datei (nicht den git-ignored companyfacts-Cache), kein Netzwerk -> CI==lokal.
// Cache-tolerant: fehlende Datei/Ticker -> secAnnual weglassen -> cycleSeries faellt auf Yahoo-4J zurueck (byte-identisch).
// Additiv (snapshot.secAnnual): der Zyklus-Daempfer (score.js cycleSeriesPair, OpInc/Rev) UND — seit Phase 4.1 —
// roicStability (axes.js, OpInc/Assets/CurrLiab, Single-Source-Trio) lesen es. Beide fallen ohne secAnnual auf Yahoo zurueck.
// Globale Gratis-Adapter: dieselbe tiefe {ticker:{annualOpInc,annualRev,...}}-Form fuer NICHT-US-Namen
// (KR/OpenDART holt SK Hynix, die vom EDGAR-Chat offen gelassene non-US-Zyklus-Luecke; spaeter JP/TW).
// Alle Dateien speisen DENSELBEN snapshot.secAnnual-Kanal -> derselbe Zyklus-Daempfer, kein zweiter
// Mechanismus. Ticker-Raeume disjunkt (US vs 000660.KS) -> Object.assign kollidiert nie. Fehlende Datei
// -> skip (byte-identisch). Alle offline via scripts/build-*annual.js erzeugt; hier KEIN Netz (CI==lokal).
const SECANNUAL_FILES = ['sec-secannual.json', 'kr-secannual.json', 'jp-secannual.json', 'tw-secannual.json']
  .map((f) => path.join(ROOT, 'external-data', f));
function mergeSecIntoUniverse(u) {
  const data = {};
  for (const p of SECANNUAL_FILES) {
    try { Object.assign(data, JSON.parse(fs.readFileSync(p, 'utf8'))); } catch (_) { /* Datei fehlt -> skip */ }
  }
  if (!Object.keys(data).length) return u; // keine committete Datei -> heutiges 4J-Verhalten
  let merged = 0;
  for (const s of u) {
    const tk = s && s.meta && s.meta.ticker;
    const d = tk && data[tk];
    if (!d) continue;
    s.secAnnual = { annualOpInc: d.annualOpInc, annualRev: d.annualRev,
      annualNetIncome: d.annualNetIncome, annualFCF: d.annualFCF, annualOCF: d.annualOCF,
      // Phase 4.1: tiefe Bilanz (fehlt in Alt-Store/regionalen Dateien -> undefined -> secSeries()==null -> Yahoo-Fallback)
      annualAssets: d.annualAssets, annualCurrentLiabilities: d.annualCurrentLiabilities };
    merged++;
  }
  if (merged > 0) console.log(`[run-screener] mergeSecIntoUniverse: tiefe annual-Serie an ${merged} Namen angehaengt (SEC+regional)`);
  return u;
}

function run(topN) {
  const universe = loadUniverse();
  // 2.9 Slice 2: optionaler Referenz-Modus — gegen ein EINGEFRORENES Lineal scoren (Universe-Ausbau
  // verschiebt bestehende Scores dann NICHT mehr). SCORING_REF_CALIB=<pfad zu calibration.json>.
  let refCalibration = null;
  const refPath = process.env.SCORING_REF_CALIB;
  if (refPath) {
    try { refCalibration = JSON.parse(fs.readFileSync(refPath, 'utf8')); console.log(`[run-screener] Referenz-Lineal geladen (${refPath}, schema ${refCalibration.schema})`); }
    catch (e) { console.warn(`[run-screener] SCORING_REF_CALIB nicht lesbar (${refPath}): ${e.message} -> live-lernend`); }
  }
  const results = scoreUniverse(universe, formulas, refCalibration ? { refCalibration } : {});
  // Drift-Waechter: aktuelles Universum vs. eingefrorenes Lineal — fail-loud bei verschobener Basis (0.7-Kanal).
  if (refCalibration) {
    const drift = calibrationDrift(results.calibrationLive, refCalibration);
    if (!drift.ok) console.warn(`[run-screener] ⚠ KALIBRIER-DRIFT: maxKS ${drift.maxKs.toFixed(3)} > ${drift.ksThreshold} in ${drift.drifted.length} Achsen (Normierungsbasis verschoben).`);
    else console.log(`[run-screener] Kalibrier-Drift ok (maxKS ${drift.maxKs.toFixed(3)} <= ${drift.ksThreshold}).`);
  }
  const ranked = produceRankings(results, { topN: topN || 100 });
  // Echte Kohorten-Counts aus results (NICHT aus der gekappten topN-Anzeigeliste).
  const counts = {};
  for (const e of results) {
    if (e.action === 'route' && e.score !== null) {
      counts[e.formulaId] = counts[e.formulaId] || { profitable: 0, unprofitable: 0 };
      counts[e.formulaId][e.track] = (counts[e.formulaId][e.track] || 0) + 1;
    }
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const [id, b] of Object.entries(ranked.branches)) {
    writeJsonAtomic(path.join(OUT_DIR, id + '.json'), b); // indent 2 default -> byte-identisch
  }
  // 2.3-A8: volle gescorte Kohorten als Vintage-Substrat nach full/ (2.8 §6). Kompakt (indent 0):
  // maschinell gelesen (write-board-history), Voll-Kohorten sind ~5x groesser als die topN-Boards.
  // QC-Pass bewusst ohne full/ — dessen Messreihe startet erst mit der eigenen Vintage-Entscheidung (3.2/2.3).
  const FULL_DIR = path.join(OUT_DIR, 'full');
  fs.mkdirSync(FULL_DIR, { recursive: true });
  for (const [id, b] of Object.entries(ranked.full)) {
    writeJsonAtomic(path.join(FULL_DIR, id + '.json'), b, { indent: 0 });
  }
  // survival ist nie topN-gekappt (flache runway-desc-Liste) — trotzdem nach full/ spiegeln,
  // damit der 2.3-Vintage-Writer (liest alles in full/) die volle 14er-Board-Familie (2.8 §3c)
  // ohne Sonderpfad einfriert. Gleiche Form wie die Branch-Files: {profitable:[],unprofitable:[]}
  // passt hier nicht — survival bleibt flach, der Writer behandelt Arrays wie Kohorten-Listen.
  writeJsonAtomic(path.join(FULL_DIR, 'survival.json'), ranked.survival, { indent: 0 });
  writeJsonAtomic(path.join(OUT_DIR, 'overview.json'), ranked.overview);
  writeJsonAtomic(path.join(OUT_DIR, 'survival.json'), ranked.survival);
  // audit/fix (Court Fall 7, F6/F46): index.json byte-deterministisch machen. Die Key-Reihenfolge
  // von branches/counts/excluded erbte von fs.readdirSync (OS-abhaengig -> CI-ubuntu != Windows).
  // Werte unveraendert, nur Keys deterministisch sortieren (kein Score-/Membership-Effekt).
  const sortKeys = (o) => Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));
  writeJsonAtomic(path.join(OUT_DIR, 'index.json'), {
    generatedFromSnapshots: universe.length,
    branches: Object.keys(ranked.branches).sort(),
    counts: sortKeys(counts),
    survivalCount: ranked.survival.length,
    excluded: sortKeys(ranked.excluded),
  });
  // 2.9 Slice 1: Kalibrier-Artefakt je Lauf ausschreiben — das versionierbare "Lineal" (gelernte
  // winsor/growth/cycleDD/mcap/ipo-Schranken), macht die globale Normierungs-Drift zwischen Laeufen
  // diffbar. generated_at NUR im Datei-Wrapper; die calibration selbst bleibt zeitstempel-frei
  // (Replay-Determinismus). ponytail: nach outputs/calibration.json (latest) — die board-history-
  // Vintage-Co-Location kommt mit 2.3; der Referenz-Scoring-Modus + Drift-Waechter folgen in Slice 2.
  if (results.calibration) {
    writeJsonAtomic(path.join(ROOT, 'outputs', 'calibration.json'),
      { generated_at: new Date().toISOString(), ...results.calibration });
  }
  // 3.1 QC-Board (DIAGNOSTIC, additiv): zweiter Scoring-Pass durch DIESELBE Engine, NACHDEM HG bereits
  // auf Disk liegt. Fail-soft: ein QC-Fehler darf den frischen HG-Stand NICHT stalen (::error:: loggen,
  // HG unberuehrt). KEIN HG-refCalibration (QC live-lernt sein eigenes Lineal).
  try {
    runQualityPass(universe, topN);
  } catch (e) {
    console.error(`::error:: [run-screener] QC-Pass fehlgeschlagen (HG unberuehrt): ${e && e.message}`);
    // F11: EXPLIZITES Fehlsignal statt stiller Abwesenheit. Ohne Marker sieht ein QC-Throw
    // fuer write-findash-export/Deploy aus wie "QC-Ordner fehlt" (alter Lokallauf) — der
    // Deploy kopiert dann den frischen HG-Stand ueber den bestehenden gh-pages-Checkout und
    // laesst das ALTE QC-Board unmarkiert live (stiller Stale-Feed). Der Marker macht den
    // Ausfall sichtbar: write-findash-export reicht ihn in den Export durch, der Deploy leert
    // das Ziel-Unterverzeichnis -> kein stales QC-Board. HG bleibt unberuehrt (fail-soft).
    writeQualityFailedMarker(e && e.message);
  }
  return { universe: universe.length, branches: Object.keys(ranked.branches).length, out: OUT_DIR };
}

// 3.1 QC-Board: eigener Scoring-Pass via classify-Seam (qualityRoute) + growthBoost:false. Schreibt
// outputs/quality/{<boards>,overview,index,calibration}.json mit assertFinite-Write-Guard. calibration
// NUR nach outputs/quality/calibration.json (NIE outputs/calibration.json — das ist das HG-Lineal).
function runQualityPass(universe, topN, qcOutDir = QC_OUT_DIR) {
  // X3-Fix (T3, Opus-Fund, korrigiert den falschen H-B-Kommentar von Tag 345): index.json
  // wird jetzt WIRKLICH ZULETZT geschrieben — hinter branches/overview/calibration und jeden
  // anderen fehlbaren Write. Vorher stand index.json VOR calibration.json (W() mit
  // assertFinite:true, kann werfen): wirft calibration (NaN/Inf oder I/O-Fehler), lag bereits
  // ein gueltiger index.json auf Disk, obwohl der Pass danach scheiterte — qualityExportMode
  // prueft index ZUERST und liesse 'export' ueber den frischeren _failed-Marker gewinnen (genau
  // das Loch, das H-B/F11 schliessen sollten). Jetzt haelt KEIN Mid-Pass-Fehler mehr einen
  // gueltigen Index zurueck; der stale-Index-Guard am Anfang (clearStaleQualityIndex) bleibt
  // fuer den echten Restfall (Hard-Kill zwischen den Writes) unveraendert noetig.
  clearStaleQualityIndex(qcOutDir);
  const qcResults = scoreUniverse(universe, qcFormulas, { classify: qualityRoute, growthBoost: false });
  const qcRanked = produceRankings(qcResults, { topN: topN || 100 });
  const counts = {};
  for (const e of qcResults) {
    if (e.action === 'route' && e.score !== null) {
      counts[e.formulaId] = counts[e.formulaId] || { profitable: 0, unprofitable: 0 };
      counts[e.formulaId][e.track] = (counts[e.formulaId][e.track] || 0) + 1;
    }
  }
  const W = (p, v) => writeJsonAtomic(p, v, { assertFinite: true }); // fail-loud statt NaN->null
  fs.mkdirSync(qcOutDir, { recursive: true });
  for (const [id, b] of Object.entries(qcRanked.branches)) {
    W(path.join(qcOutDir, id + '.json'), b);
  }
  W(path.join(qcOutDir, 'overview.json'), qcRanked.overview);
  if (qcResults.calibration) {
    W(path.join(qcOutDir, 'calibration.json'),
      { generated_at: new Date().toISOString(), ...qcResults.calibration });
  }
  const sortKeys = (o) => Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));
  const boardIds = Object.keys(qcRanked.branches).sort();
  const boardStatusMap = {};
  for (const id of boardIds) boardStatusMap[id] = boardStatus(id); // alle 'diagnostic' (quality-Praefix)
  W(path.join(qcOutDir, 'index.json'), {
    schema: 'quality/diagnostic-v1',
    generatedFromSnapshots: universe.length,
    boards: boardIds,
    boardStatus: boardStatusMap,
    counts: sortKeys(counts),
    excluded: sortKeys(qcRanked.excluded),
  });
  console.log(`[run-screener] QC-Board (DIAGNOSTIC): ${boardIds.length} Boards -> ${qcOutDir}`);
}

// H-B-Guard: entfernt AUSSCHLIESSLICH ein evtl. stales outputs/quality/index.json, bevor der
// QC-Pass neu schreibt. Betriebsdaten-Semantik (outputs/ ist git-ignorte, lauf-regenerierte
// Zwischenausgabe), kein Karl-Loesch-Stop. Best-effort/idempotent (force schluckt ENOENT, der
// try/catch jeden Windows-Handle-Fall) — der Guard darf selbst NIE werfen.
//
// Variante A (Anfang statt catch) gewaehlt, weil sie den Ausfall AM EHRLICHSTEN ausweist:
//   - Normalfall QC-Exception (haeufig): Index vorab weg -> run()-catch schreibt _failed ->
//     qualityExportMode = 'failed' (Ausfall sichtbar; kein stales Board).
//   - Erfolgslauf: Index vorab weg, danach frisch geschrieben -> 'export' (byte-identisch zu vorher;
//     ein stehen gebliebener _failed eines Vorlaufs verliert weiterhin gegen den frischen index -> Tag-343-Semantik haelt).
// RESTFALL: stirbt der Prozess MITTEN im Pass HART (SIGKILL/OOM, KEIN catch), ist lokal weder Index
// noch Marker da -> qualityExportMode = 'absent' (still, aber KEIN stales Board als frisch getarnt).
// Das ist ehrlicher als die catch-Variante, die bei Hard-Kill den Erfolgs-Index haelt und alte
// Boards mit neuem generated_at re-exportieren wuerde (genau der maskierte Ausfall, den H-B behebt).
function clearStaleQualityIndex(qcOutDir = QC_OUT_DIR) {
  try {
    fs.rmSync(path.join(qcOutDir, 'index.json'), { force: true });
  } catch (_) { /* best-effort: bleibt der stale Index liegen, ist der Ausgangszustand nicht schlechter als heute */ }
}

// F11: expliziter QC-Fehl-Marker (outputs/quality/_failed). Wird im catch des QC-Passes
// geschrieben, damit die Abwesenheit eines frischen QC-Boards NICHT still als "optional
// absent" durchgeht. write-findash-export liest ihn (wenn KEIN gueltiger quality/index.json
// vorliegt) und reicht das "QC failed" in den Export durch; der Deploy leert das Ziel-Subdir.
// Best-effort und rein diagnostisch: schlaegt der Marker-Write fehl, bleibt der HG-Stand so
// oder so unberuehrt (fail-soft) — nur die Sichtbarkeit des QC-Ausfalls ginge verloren.
function writeQualityFailedMarker(reason, qcOutDir = QC_OUT_DIR) {
  try {
    fs.mkdirSync(qcOutDir, { recursive: true });
    writeJsonAtomic(path.join(qcOutDir, '_failed'), { reason: String(reason || 'unknown'), at: new Date().toISOString() });
    return true;
  } catch (_) {
    return false;
  }
}

if (require.main === module) {
  const argIdx = process.argv.indexOf('--topN');
  const topN = argIdx >= 0 ? parseInt(process.argv[argIdx + 1], 10) : 100;
  const r = run(topN);
  console.log(`Screener-Output: ${r.branches} Branchen, Universum ${r.universe} -> ${r.out}`);
}

module.exports = { loadUniverse, run, assertCoverageFloor, nextHighWater, COVERAGE_FLOOR_RATIO, writeQualityFailedMarker, runQualityPass, clearStaleQualityIndex };

'use strict';
/**
 * 3.1 QC-Board (DIAGNOSTIC, additiv) — Test-Gate.
 * ==============================================
 * Pinnt: HG byte-identisch (classify/growthBoost-Seam inert ohne opts), qualityRoute-
 * Delegation (struct-exclude erbt, financials/real-estate/Nicht-Compounder raus,
 * Compounder -> quality-<sector>), roicStability-Gate (4J->null, >=6J->finite),
 * QC-Formel-Form (splitMetric none/absent, w-shape {profitable:X}), boardStatus-Praefix.
 *
 * Usage:  node tests/scoring/quality-board.test.js   (Exit 0/1)
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { isMetadataSnapshot } = require('../../lib/snapshot-fs.js');
const { scoreUniverse } = require('../../src/scoring/score.js');
const { route } = require('../../src/scoring/router.js');
const formulas = require('../../src/scoring/formulas/index.js');
const { qualityRoute, COMPOUNDER_TIERS, QC_UNSUPPORTED_SECTORS } = require('../../src/scoring/quality-route.js');
const qcFormulas = require('../../src/scoring/formulas/quality/index.js');
const { boardStatus } = require('../../src/scoring/board-status.js');
const ax = require('../../src/scoring/axes.js');
const wfe = require('../../scripts/write-findash-export.js'); // 3.2/F11: QC-Feed-Export

let pass = 0, fail = 0, skip = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); }
}
const V = (arr) => arr.map((v) => ({ value: v }));
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

// Reales Universum laden (fuer die byte-identisch-Seam-Pruefung); pre-pull leer -> skippen.
// SCREENER_SNAPSHOTS_DIR: nur Test-Seam (Skip-Ehrlichkeits-Regression zeigt damit ein leeres
// Universum); ohne die Variable unveraendert das echte snapshots/.
const SNAP_DIR = process.env.SCREENER_SNAPSHOTS_DIR || path.join(__dirname, '..', '..', 'snapshots');
const universe = [];
// snapFiles = Rohdatei-Zahl im Verzeichnis. universe zaehlt nur die JSON.parse+meta.ticker-Ueberlebenden;
// ohne die Rohzahl sehen "Verzeichnis leer" und "Tausende Dateien, aber Schema unlesbar" gleich aus.
let snapFiles = 0;
try {
  for (const f of fs.readdirSync(SNAP_DIR)) {
    if (!f.endsWith('.json') || isMetadataSnapshot(f)) continue;
    snapFiles++;
    try { const s = JSON.parse(fs.readFileSync(path.join(SNAP_DIR, f), 'utf8')); if (s && s.meta && s.meta.ticker) universe.push(s); }
    catch (_) { /* defekt */ }
  }
} catch (_) { /* kein snapshots-Dir */ }
const HAS_UNIVERSE = universe.length > 0;
function testU(name, fn) {
  if (!HAS_UNIVERSE) { skip++; console.log('  skip ' + name + ' (kein Universum — pre-pull-Gate)'); return; }
  test(name, fn);
}

// --- HG byte-identisch: die neuen Seams sind ohne opts inert -----------------
testU('HG byte-identisch: scoreUniverse(u,formulas) == mit leerem opts {}', () => {
  const a = JSON.stringify(scoreUniverse(universe, formulas));
  const b = JSON.stringify(scoreUniverse(universe, formulas, {}));
  assert.equal(a, b, 'leeres opts darf HG-Ergebnis nicht veraendern');
});
testU('HG byte-identisch: explizites {classify:route} == Default (classify-Seam inert)', () => {
  const a = JSON.stringify(scoreUniverse(universe, formulas));
  const b = JSON.stringify(scoreUniverse(universe, formulas, { classify: route }));
  assert.equal(a, b, 'classify:route muss dem Default entsprechen');
});
testU('growthBoost-Gate ist LIVE: {growthBoost:false} veraendert >=1 HG-Score (Faktor wird gegatet)', () => {
  const base = scoreUniverse(universe, formulas);
  const noBoost = scoreUniverse(universe, formulas, { growthBoost: false });
  const bBy = Object.fromEntries(noBoost.map((r) => [r.ticker, r]));
  let diffs = 0;
  for (const e of base) {
    if (e.action !== 'route' || !Number.isFinite(e.score)) continue;
    const o = bBy[e.ticker];
    if (o && Number.isFinite(o.score) && !near(e.score, o.score, 1e-9)) diffs++;
  }
  assert.ok(diffs > 0, 'growthBoost:false muss mind. einen Score aendern (sonst Gate tot)');
});

// --- qualityRoute: DELEGATION an route() -------------------------------------
const mkSoftware = (opInc) => ({
  meta: { name: 'Synth Software Co', sector: 'Technology', industry: 'Software—Application',
    exchangeName: 'NasdaqGS', country: 'United States', region: 'US', ticker: 'SYNTH' },
  annual: { annualRev: V([300, 200, 130]), annualGP: V([180, 120, 78]), annualOpInc: V(opInc) },
  marketCap: { value: 5e9 }, metrics: { revenueTTM: { value: 300 }, revenueGrowthYoY: { value: 50 } } });

test('qualityRoute: struct-excluded (Bilanz-Bank) erbt route()-exclude', () => {
  const bank = { meta: { sector: 'Financial Services', industry: 'Banks—Regional', country: 'United States', ticker: 'BNK' },
    annual: { annualRev: V([300, 200]) } };
  const r = qualityRoute(bank);
  assert.equal(r.action, 'exclude');
  assert.equal(r.reason, 'balance-sheet-bank', 'muss den struct-Grund von route() durchreichen');
});
test('qualityRoute: financials -> qc-sector-unsupported', () => {
  const fin = { meta: { sector: 'Financial Services', industry: 'Financial Data & Stock Exchanges', country: 'United States', ticker: 'FIN' },
    annual: { annualRev: V([300, 200]), annualGP: V([180, 120]), annualOpInc: V([50, 40]) } };
  const r = qualityRoute(fin);
  assert.equal(r.action, 'exclude'); assert.equal(r.reason, 'qc-sector-unsupported');
});
test('qualityRoute: real-estate -> qc-sector-unsupported', () => {
  const re = { meta: { sector: 'Real Estate', industry: 'REIT—Industrial', country: 'United States', ticker: 'RE' },
    annual: { annualRev: V([300, 200]), annualGP: V([180, 120]), annualOpInc: V([50, 40]) } };
  const r = qualityRoute(re);
  assert.equal(r.action, 'exclude'); assert.equal(r.reason, 'qc-sector-unsupported');
});
test('qualityRoute: Nicht-Compounder (aktuell Verlust) -> qc-not-compounder', () => {
  const r = qualityRoute(mkSoftware([-50, -40, -30]));
  assert.equal(r.action, 'exclude'); assert.equal(r.reason, 'qc-not-compounder');
});
test('qualityRoute: Compounder -> route quality-<sector>', () => {
  const r = qualityRoute(mkSoftware([50, 40, 30])); // seit-kurzem-profitabel
  assert.equal(r.action, 'route'); assert.equal(r.formulaId, 'quality-software-comm-services');
});
test('qualityRoute-Konstanten: Compounder-Tiers + unsupported Sektoren wie spezifiziert', () => {
  assert.ok(COMPOUNDER_TIERS.has('seit-kurzem-profitabel') && COMPOUNDER_TIERS.has('langfristig-profitabel'));
  assert.equal(COMPOUNDER_TIERS.size, 2);
  assert.ok(QC_UNSUPPORTED_SECTORS.has('financials') && QC_UNSUPPORTED_SECTORS.has('real-estate'));
});

// --- roicStability: hartes Daten-Gate (>= 6 gepaarte Jahre) ------------------
const bal = (n, ta, cl) => Array.from({ length: n }, () => ({ totalAssets: ta, currentLiabilities: cl }));
test('roicStability(4J-Fixture) === null (unter dem 6-Jahres-Gate)', () => {
  const s = { annual: { annualOpInc: V([10, 11, 10, 9]),
    annualBalance: bal(4, 100, 0) } };
  assert.equal(ax.roicStability(s), null);
});
test('roicStability(>=6J gepaart) === finit (negativer CoV, hoeher=stabiler)', () => {
  const s = { annual: { annualOpInc: V([10, 11, 10, 9, 10, 11]),
    annualBalance: bal(6, 100, 0) } };
  const v = ax.roicStability(s);
  assert.ok(Number.isFinite(v), 'muss finit sein, war ' + v);
  assert.ok(v <= 0, 'negativer CoV -> <= 0, war ' + v);
});
test('roicStability: 6J vorhanden, aber currentLiabilities fehlt -> < 6 gepaart -> null', () => {
  const s = { annual: { annualOpInc: V([10, 11, 10, 9, 10, 11]),
    annualBalance: Array.from({ length: 6 }, () => ({ totalAssets: 100 })) } }; // kein currentLiabilities
  assert.equal(ax.roicStability(s), null);
});
test('roicStability: stabilere Serie -> hoeherer (naeher 0) Wert als volatile', () => {
  const stable = { annual: { annualOpInc: V([10, 10, 10, 10, 10, 10]), annualBalance: bal(6, 100, 0) } };
  const volatile = { annual: { annualOpInc: V([5, 15, 4, 16, 6, 14]), annualBalance: bal(6, 100, 0) } };
  assert.ok(ax.roicStability(stable) > ax.roicStability(volatile));
  assert.ok(near(ax.roicStability(stable), 0)); // konstante ROIC -> CoV 0 -> -0
});

// --- roicStability: tiefer SEC-Kanal (Phase 4.1) + Single-Source-Trio-Guard ---
const secTrio = (op, as, cl) => ({ secAnnual: { annualOpInc: V(op), annualAssets: V(as), annualCurrentLiabilities: V(cl) } });
test('roicStability(tiefe secAnnual-Bilanz 8J) === finit — der deep-Kanal schaltet die Achse frei', () => {
  // Yahoo-Bilanz fehlt (kein annual) -> Yahoo-Pfad waere null; secAnnual 8J -> finit.
  const s = secTrio([10, 11, 10, 9, 10, 11, 10, 9], Array(8).fill(100), Array(8).fill(0));
  assert.ok(Number.isFinite(ax.roicStability(s)), 'tiefer Kanal muss finit liefern');
});
test('roicStability Single-Source-Guard: unvollstaendiges secAnnual-Trio -> Yahoo-Fallback (kein Feld-Mix)', () => {
  // secAnnual hat OpInc+Assets aber KEIN annualCurrentLiabilities -> darf die 8J-Assets NICHT mit Yahoo-CurrLiab
  // mischen; faellt KOMPLETT auf Yahoo zurueck (4J) -> null (byte-identisch zum Alt-Verhalten).
  const s = { annual: { annualOpInc: V([10, 11, 10, 9]), annualBalance: bal(4, 100, 0) },
    secAnnual: { annualOpInc: V([10, 11, 10, 9, 10, 11, 10, 9]), annualAssets: V(Array(8).fill(100)) } };
  assert.equal(ax.roicStability(s), null, 'unvollstaendiges Trio -> Yahoo-Fallback -> 4J -> null');
});
test('roicStability: tiefes secAnnual (8J) schlaegt flache Yahoo-4J (null -> finit)', () => {
  const s = { annual: { annualOpInc: V([10, 11, 10, 9]), annualBalance: bal(4, 100, 0) },
    ...secTrio([10, 11, 10, 9, 10, 11, 10, 9], Array(8).fill(100), Array(8).fill(0)) };
  assert.ok(Number.isFinite(ax.roicStability(s)), 'deep 8J ueberschreibt Yahoo-4J-null');
});

// --- QC-Formeln: Form-Invarianten (BAU-GATE 2 + 9) ---------------------------
test('QC-Registry: 11 Boards (13 minus financials/real-estate), quality-Praefix', () => {
  const ids = Object.keys(qcFormulas);
  assert.equal(ids.length, 11, 'erwartet 11 QC-Boards, sind ' + ids.length);
  assert.ok(ids.every((id) => id.startsWith('quality-')));
  assert.ok(!ids.includes('quality-financials') && !ids.includes('quality-real-estate'));
});
test('QC-Formeln: splitMetric none/absent (BAU-GATE 2) + w-shape {profitable:X} (kein Skalar-w)', () => {
  for (const [id, f] of Object.entries(qcFormulas)) {
    assert.ok(!f.splitMetric || f.splitMetric === 'none', `${id} splitMetric muss none/absent sein`);
    for (const a of f.axes) {
      assert.ok(a.w && typeof a.w === 'object' && !Array.isArray(a.w), `${id}/${a.key} w muss Objekt sein`);
      assert.ok('profitable' in a.w && typeof a.w.profitable === 'number', `${id}/${a.key} w-shape {profitable:X}`);
    }
  }
});
test('QC-Formeln: Achsensatz + roicStability benannt-leer (w=0)', () => {
  const f = qcFormulas['quality-semiconductors'];
  const byKey = Object.fromEntries(f.axes.map((a) => [a.key, a.w.profitable]));
  assert.equal(byKey.capitalEfficiency, 2.6);
  assert.equal(byKey.marginLevel, 2.2);
  assert.equal(byKey.gpGrowth, 1.5);
  assert.equal(byKey.dilution, 1.2);
  assert.equal(byKey.revGrowthLevel, 0.8);
  assert.equal(byKey.roicStability, 0, 'roicStability muss benannt-leer w=0 sein');
});

// --- boardStatus: quality-Praefix -> immer diagnostic, HG unveraendert -------
test("boardStatus('quality-semiconductors') === 'diagnostic'", () => {
  assert.equal(boardStatus('quality-semiconductors'), 'diagnostic');
  assert.equal(boardStatus('quality-industrials'), 'diagnostic');
});
test('boardStatus: HG-Sektoren unveraendert (semiconductors core, tech-hardware diagnostic)', () => {
  assert.equal(boardStatus('semiconductors'), 'core');
  assert.equal(boardStatus('tech-hardware'), 'diagnostic'); // bestehender DIAGNOSTIC-Eintrag
});

// --- voller DIAGNOSTIC-Pass ohne Crash + alle Boards diagnostic --------------
testU('QC-Pass laeuft ueber das reale Universum, Kohorten disjunkt (nur quality-*), Boards diagnostic', () => {
  const qc = scoreUniverse(universe, qcFormulas, { classify: qualityRoute, growthBoost: false });
  const routed = qc.filter((e) => e.action === 'route' && Number.isFinite(e.score));
  assert.ok(routed.length > 0, 'QC-Pass hat keine gescorten Namen');
  assert.ok(routed.every((e) => e.formulaId.startsWith('quality-')), 'Fremd-Kohorte im QC-Pass');
  assert.ok(routed.every((e) => boardStatus(e.formulaId) === 'diagnostic'), 'ein QC-Board ist nicht diagnostic');
  assert.ok(routed.every((e) => e.track === 'profitable'), 'splitMetric none -> track muss profitable sein');
  console.log(`       QC gescort: ${routed.length} Compounder ueber ${new Set(routed.map((e) => e.formulaId)).size} Boards`);
});

// --- F11: QC-Feed-Auslieferung (stiller Stale-Feed unmoeglich machen) ---------
// write-findash-export unterscheidet drei Quell-Zustaende statt nur "Datei da/nicht da":
// gueltiger index -> export; _failed-Marker (QC-Pass scheiterte) -> als _failed durchreichen
// (KEIN stales Board); weder/noch -> alter Lokallauf (absent). index gewinnt ueber Marker.
test('qualityExportMode F11: index -> export, _failed-Marker -> failed, sonst absent', () => {
  const tmp = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'qmode-'));
  assert.equal(wfe.qualityExportMode(tmp), 'absent', 'leeres Dir = alter Lokallauf');
  fs.writeFileSync(path.join(tmp, '_failed'), JSON.stringify({ reason: 'boom', at: 'x' }));
  assert.equal(wfe.qualityExportMode(tmp), 'failed', 'nur _failed -> QC-Fehl-Lauf');
  fs.writeFileSync(path.join(tmp, 'index.json'), JSON.stringify({ boards: [] }));
  assert.equal(wfe.qualityExportMode(tmp), 'export', 'index gewinnt (QC hat geliefert)');
  fs.rmSync(tmp, { recursive: true, force: true });
});
test('buildQuality F11: _failed-Marker -> exportiert v1/quality/_failed, KEINE (stale) Boards', () => {
  const os = require('node:os');
  const src = fs.mkdtempSync(path.join(os.tmpdir(), 'qsrc-'));
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'qout-'));
  fs.writeFileSync(path.join(src, '_failed'), JSON.stringify({ reason: 'scoreUniverse boom', at: '2026-07-17T00:00:00Z' }));
  // buildQuality warnt per console.warn (::warning::) — hier kapseln, damit die Zeile nicht in
  // den Testausgabestrom leckt (skip-honesty.test.js parst stdout+stderr und liest die letzte
  // Zeile als Summenzeile; eine Warnung dahinter wuerde die Zahlen-Kongruenzpruefung stoeren).
  const origWarn = console.warn; console.warn = () => {};
  let r;
  try { r = wfe.buildQuality(null, { qualityDir: src, qoutDir: out }); } finally { console.warn = origWarn; }
  assert.equal(r.boards, 0, 'kein Board exportiert');
  assert.equal(r.failed, true, 'als Fehl-Lauf ausgewiesen');
  const marker = JSON.parse(fs.readFileSync(path.join(out, '_failed'), 'utf8'));
  assert.equal(marker.reason, 'scoreUniverse boom', 'Grund durchgereicht');
  assert.equal(marker.schema, wfe.SCHEMA, 'Export-Schema gesetzt');
  const jsonFiles = fs.readdirSync(out).filter((f) => f.endsWith('.json'));
  assert.equal(jsonFiles.length, 0, 'KEINE QC-Board-JSONs (kein stales Board mitgeliefert)');
  fs.rmSync(src, { recursive: true, force: true }); fs.rmSync(out, { recursive: true, force: true });
});

// --- X4 (Tag 348): stale QC-Board-Datei im qoutDir wird beim naechsten Export-Lauf geraeumt ---
// Vorher schrieb buildQuality im export-Modus NUR die aktuellen Board-Dateien, leerte qoutDir
// aber nie -> ein entferntes/umbenanntes QC-Board aus einem frueheren lokalen Lauf blieb liegen.
// validateQualityExport iteriert nur idx.boards (das frische index.json) und sieht die
// Karteileiche nie -> ein Deploy haette sie stillschweigend mitpubliziert.
test('buildQuality X4: entferntes/umbenanntes QC-Board wird aus qoutDir geraeumt, nicht re-publiziert', () => {
  const os = require('node:os');
  const src = fs.mkdtempSync(path.join(os.tmpdir(), 'qsrc-x4-'));
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'qout-x4-'));
  // Aktuelle Quelle: NUR noch 'alpha' (Board 'zombie' wurde entfernt/umbenannt).
  fs.writeFileSync(path.join(src, 'index.json'), JSON.stringify({
    generatedFromSnapshots: 1, boards: ['quality-alpha'],
    boardStatus: { 'quality-alpha': 'diagnostic' }, counts: {}, excluded: {},
  }));
  fs.writeFileSync(path.join(src, 'quality-alpha.json'), JSON.stringify({ profitable: [], unprofitable: [] }));
  fs.writeFileSync(path.join(src, 'overview.json'), JSON.stringify([]));
  // qoutDir traegt noch die Karteileiche eines FRUEHEREN Laufs (Board 'zombie').
  fs.writeFileSync(path.join(out, 'zombie.json'), JSON.stringify({ schema: wfe.SCHEMA, branch: 'zombie' }));

  const r = wfe.buildQuality(null, { qualityDir: src, qoutDir: out });
  assert.equal(r.boards, 1, 'genau 1 aktuelles Board exportiert');
  assert.ok(!fs.existsSync(path.join(out, 'zombie.json')), 'Karteileiche muss weg sein — sonst stiller Re-Publish eines entfernten Boards');
  assert.ok(fs.existsSync(path.join(out, 'alpha.json')), 'aktuelles Board muss geschrieben sein');
  const idx = JSON.parse(fs.readFileSync(path.join(out, 'index.json'), 'utf8'));
  assert.deepEqual(idx.boards, ['quality-alpha']);

  fs.rmSync(src, { recursive: true, force: true }); fs.rmSync(out, { recursive: true, force: true });
});

// --- T2: failed-Zweig raeumt stale QC-Boards nicht (Geschwisterpfad zu X4/Tag348) -----------
// Der export-Zweig (X4 oben) leert qoutDir VOR dem Neuschreiben. Der failed-Zweig tat das
// bisher NICHT: er schrieb nur mkdirSync + den _failed-Marker, liess Board-Dateien + index.json
// eines FRUEHEREN erfolgreichen Laufs unangetastet liegen. validateQualityExport() UND der
// Deploy lesen dann das stale index.json + die Karteileichen-Boards als gueltig -> derselbe
// Stale-QC-Feed-Klasse wie H-B/Tag345 und X3/Tag348, nur ueber den 'failed'-statt-'export'-Pfad
// wieder offen. Fix: dieselbe rmSync-Raeumung wie im export-Zweig VOR dem mkdirSync.
test('buildQuality T2: failed-Zweig raeumt ein stales export-qoutDir (Boards + index.json weg, nur _failed bleibt)', () => {
  const os = require('node:os');
  const src = fs.mkdtempSync(path.join(os.tmpdir(), 'qsrc-t2-'));
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'qout-t2-'));
  // Aktuelle Quelle: QC-Pass ist DIESMAL gescheitert (nur _failed-Marker, kein index.json).
  fs.writeFileSync(path.join(src, '_failed'), JSON.stringify({ reason: 'scoreUniverse boom', at: '2026-07-17T00:00:00Z' }));
  // qoutDir traegt noch den VOLLEN Board-Satz eines FRUEHEREN erfolgreichen Laufs.
  fs.writeFileSync(path.join(out, 'index.json'), JSON.stringify({ schema: wfe.SCHEMA, boards: ['quality-alpha'] }));
  fs.writeFileSync(path.join(out, 'alpha.json'), JSON.stringify({ schema: wfe.SCHEMA, branch: 'alpha' }));
  fs.writeFileSync(path.join(out, 'overview.json'), JSON.stringify({ schema: wfe.SCHEMA, rows: [] }));

  const origWarn = console.warn; console.warn = () => {}; // ::warning:: nicht in stdout leaken (s.o.)
  let r;
  try { r = wfe.buildQuality(null, { qualityDir: src, qoutDir: out }); } finally { console.warn = origWarn; }
  assert.equal(r.failed, true, 'als Fehl-Lauf ausgewiesen');
  assert.ok(!fs.existsSync(path.join(out, 'index.json')), 'stales index.json muss weg sein — sonst liest validateQualityExport/Deploy es als gueltig');
  assert.ok(!fs.existsSync(path.join(out, 'alpha.json')), 'stale Board-Datei muss weg sein');
  assert.ok(!fs.existsSync(path.join(out, 'overview.json')), 'stale overview.json muss weg sein');
  assert.ok(fs.existsSync(path.join(out, '_failed')), '_failed-Marker muss geschrieben sein');
  const remaining = fs.readdirSync(out);
  assert.deepEqual(remaining, ['_failed'], 'qoutDir darf NUR noch den _failed-Marker enthalten, keine (stale) QC-Boards');

  fs.rmSync(src, { recursive: true, force: true }); fs.rmSync(out, { recursive: true, force: true });
});

// --- FIX 3 (Karl-Audit wfe-orphan-source, 2026-07-18): export-Zweig muss die Board-Liste aus
// dem QUELL-INDEX ableiten, nicht aus einem Verzeichnis-Listing (qualityBoardFiles/readdirSync).
// Sonst: ein Folgepass mit WENIGER Boards laesst eine alte quality-*.json im Quellordner liegen
// (clearStaleQualityIndex entfernt nur index.json, s. run-screener.js), das Listing nimmt sie
// wieder auf und kopiert sie in den Export — obwohl validateQualityExport NUR idx.boards
// iteriert und diese Karteileiche nie sieht (stiller Re-Publish eines Boards, das laut Index
// gar nicht existiert). Geschwisterfall zu X4 (dort: STALE Datei im qoutDir/ZIEL; hier: STALE
// Datei im qualityDir/QUELLE, die das Listing faelschlich wieder aufnimmt).
test('buildQuality FIX 3: export-Zweig liest die Board-Liste aus index.json, nicht aus dem Verzeichnis-Listing (Karteileiche im QUELLORDNER wird NICHT mitkopiert)', () => {
  const os = require('node:os');
  const src = fs.mkdtempSync(path.join(os.tmpdir(), 'qsrc-orphan-'));
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'qout-orphan-'));
  // Aktueller Index kennt NUR 'quality-alpha'.
  fs.writeFileSync(path.join(src, 'index.json'), JSON.stringify({
    generatedFromSnapshots: 1, boards: ['quality-alpha'],
    boardStatus: { 'quality-alpha': 'diagnostic' }, counts: {}, excluded: {},
  }));
  fs.writeFileSync(path.join(src, 'quality-alpha.json'), JSON.stringify({ profitable: [], unprofitable: [] }));
  fs.writeFileSync(path.join(src, 'overview.json'), JSON.stringify([]));
  // Karteileiche: eine quality-*.json OHNE Index-Eintrag, liegengeblieben von einem frueheren
  // Lauf mit mehr Boards (clearStaleQualityIndex loescht nur index.json, keine Board-Dateien).
  fs.writeFileSync(path.join(src, 'quality-beta.json'), JSON.stringify({ profitable: [], unprofitable: [] }));

  const r = wfe.buildQuality(null, { qualityDir: src, qoutDir: out });
  assert.equal(r.boards, 1, 'nur das indexierte Board zaehlt, die Karteileiche nicht');
  assert.ok(fs.existsSync(path.join(out, 'alpha.json')), 'indexiertes Board muss exportiert sein');
  assert.ok(!fs.existsSync(path.join(out, 'beta.json')), 'Karteileiche (nicht im Index) darf NICHT exportiert werden');
  const idx = JSON.parse(fs.readFileSync(path.join(out, 'index.json'), 'utf8'));
  assert.deepEqual(idx.boards, ['quality-alpha'], 'exportierter Index bleibt deckungsgleich mit der Quelle');

  fs.rmSync(src, { recursive: true, force: true }); fs.rmSync(out, { recursive: true, force: true });
});

// P1-Chunk 4 Stufe 1 (Tag 623): sichtbare GitHub-Annotation statt Fussnote in der Summenzeile.
// console.log direkt auf stdout (F2964), VOR der Summenzeile (skip-honesty liest sie per pop()).
// Exit-Code bleibt gruen.
if (!HAS_UNIVERSE) console.log(`::warning::quality-board.test.js: ${snapFiles} Dateien im Snapshot-Verzeichnis, davon 0 lesbar — leeres Universum ODER Schema unlesbar. ${skip} reale Universumstests (HG-byte-identisch, growthBoost-Gate, QC-Pass) wurden NICHT gemessen; die Suite meldet trotzdem gruen.`);
// Skip-Zahl gehoert in die Summenzeile: sonst liest "18 ok, 0 fail" wie ein voller Pass,
// obwohl im pre-pull-CI die Universums-Beweise gar nicht gelaufen sind.
console.log(`\nquality-board.test.js: ${pass} ok, ${fail} fail` + (skip ? `, ${skip} skipped (kein Universum)` : ''));
process.exit(fail ? 1 : 0);

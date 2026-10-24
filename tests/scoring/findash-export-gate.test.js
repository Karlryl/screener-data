'use strict';
/**
 * R2.18: der Export-Gate prueft rank bisher NUR auf Typ (Number.isInteger, >=1) — nie auf
 * WERT. rank wird als i+1 aus der Array-Position erzeugt (mapBoardRow/mapOverviewRow/
 * mapSurvivalRow), also ist der Typ-Check tautologisch: er kann der Sortierung nie
 * widersprechen. Ein gebrochener Upstream-Sort (score.js produceRankings byScore) bliebe
 * unsichtbar, obwohl rank Karls einziger sichtbarer Board-Reihenfolge-Alarmkanal ist.
 *
 * Zwei unabhaengige WERT-Checks pinnen das:
 *   (a) rank === index+1 innerhalb der jeweiligen Zeilen-Liste (Ableitungs-Zusage).
 *   (b) score nicht-ansteigend ueber die Liste (score.js sortiert board-Tracks + overview.json
 *       score-desc) — bindet rank an eine von rank UNABHAENGIGE Ordnungs-Invariante, sodass ein
 *       kaputter Sort auffliegt, selbst wenn rank=i+1 (a) intern konsistent bleibt.
 * survival.json ist NICHT score-sortiert (runway-desc, Zeilen tragen gar kein .score-Feld) ->
 * bekommt nur (a), niemals (b).
 *
 * Usage:  node tests/scoring/findash-export-gate.test.js   (Exit 0/1)
 */
const assert = require('node:assert/strict');
const wfe = require('../../scripts/write-findash-export.js');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); }
}

const cleanBoard = {
  ticker: 'NVDA', score: 88.2, track: 'profitable', lamps: [],
  overview: { kind: 'gp', value: -0.05, companion: 89.1 },
  country: 'United States', region: 'North America', sector: 'Technology',
  marketCap: 1e12, phase: 'established', mcapBand: 'mega', ipoRecency: 'mature',
  profitTier: 'langfristig-profitabel', ipoYear: 1999,
  cohortN: 90, cohortFallback: false,
  coverageAxes: '7/7', // 18.08.: Belegbarkeits-Gate — nur belegte Zeilen tragen einen Rang
};
const cleanOv = {
  ticker: 'NVDA', formulaId: 'semiconductors', track: 'profitable', score: 94.9,
  overviewKind: 'gp', overviewValue: -1.17, overviewCompanion: 195.3, lamps: [],
  country: 'United States', region: 'North America', sector: 'Technology',
  marketCap: 1e12, phase: 'inflected', mcapBand: 'large', ipoRecency: 'growth',
  cohortN: 90, cohortFallback: false,
  coverageAxes: '7/7', // 18.08.: s. cleanBoard
};
const cleanSv = {
  ticker: 'PAH3.DE', runwayQuarters: 9999, lamps: [],
  country: 'Germany', region: 'Europe', sector: 'Consumer Cyclical',
  marketCap: null, phase: null, mcapBand: 'small', ipoRecency: null,
  cohortN: null, cohortFallback: null,
};
// Board hull wie in write-findash-export.js selftest(): schema/generated_at/boardStatus/coverage/branch.
const mkHull = (profitable, unprofitable = []) => ({
  schema: wfe.SCHEMA, generated_at: 'x', boardStatus: 'core', coverage: null,
  branch: 'energy', profitable, unprofitable,
});
const mkOverviewFile = (rows) => ({ schema: wfe.SCHEMA, generated_at: 'x', coverage: null, rows });
const mkSurvivalFile = (rows) => ({ schema: wfe.SCHEMA, generated_at: 'x', coverage: null, rows });

// 3 sauber gemappte Zeilen mit fallenden Scores (wie score.js byScore sie liefert).
const board3 = (scores) => scores.map((s, i) => wfe.mapBoardRow({ ...cleanBoard, score: s }, i));
const overview3 = (scores) => scores.map((s, i) => wfe.mapOverviewRow({ ...cleanOv, score: s }, i));
const survival3 = (rq) => rq.map((q, i) => wfe.mapSurvivalRow({ ...cleanSv, runwayQuarters: q }, i));

// --- Baseline: sauber gemappte, sauber sortierte Listen validieren clean --------------------
test('board: 3 sauber sortierte Zeilen (rank=i+1, score-desc) validieren clean', () => {
  const e = []; wfe.validateFile(mkHull(board3([90, 80, 70])), 'energy', e);
  assert.deepEqual(e, []);
});
test('overview: 3 sauber sortierte Zeilen validieren clean', () => {
  const e = []; wfe.validateFile(mkOverviewFile(overview3([90, 80, 70])), 'overview', e);
  assert.deepEqual(e, []);
});
test('survival: 3 Zeilen (kein score-Feld) validieren clean', () => {
  const e = []; wfe.validateFile(mkSurvivalFile(survival3([9999, 12, 4])), 'survival', e);
  assert.deepEqual(e, []);
});

// --- (a) rank vertauscht: Array-Reihenfolge/Scores bleiben korrekt sortiert, nur die rank- ---
// --- Werte zweier Zeilen sind getauscht. Score-Check sieht das NICHT (Scores steigen nicht). ---
test('board rank vertauscht (score bleibt korrekt sortiert) muss trippen', () => {
  const rows = board3([90, 80, 70]);
  const tmp = rows[0].rank; rows[0].rank = rows[1].rank; rows[1].rank = tmp; // 1<->2 getauscht
  const e = []; wfe.validateFile(mkHull(rows), 'energy', e);
  assert.ok(e.some((x) => /rank!=Sollrang/.test(x)), 'rank-Vertauschung muss trippen: ' + JSON.stringify(e));
});
test('overview rank vertauscht muss trippen', () => {
  const rows = overview3([90, 80, 70]);
  const tmp = rows[0].rank; rows[0].rank = rows[1].rank; rows[1].rank = tmp;
  const e = []; wfe.validateFile(mkOverviewFile(rows), 'overview', e);
  assert.ok(e.some((x) => /rank!=Sollrang/.test(x)), 'overview rank-Vertauschung muss trippen: ' + JSON.stringify(e));
});
test('survival rank vertauscht muss trippen', () => {
  const rows = survival3([9999, 12, 4]);
  const tmp = rows[0].rank; rows[0].rank = rows[1].rank; rows[1].rank = tmp;
  const e = []; wfe.validateFile(mkSurvivalFile(rows), 'survival', e);
  assert.ok(e.some((x) => /rank!=Sollrang/.test(x)), 'survival rank-Vertauschung muss trippen: ' + JSON.stringify(e));
});

// --- (b) score nicht monoton: Zeilen bleiben in der (falschen) Reihenfolge, rank wird -------
// --- korrekt als i+1 NEU vergeben (wie ein kaputter Upstream-Sort es taete) -> rank-Check ---
// --- (a) sieht NICHTS falsches, nur der unabhaengige score-Monotonie-Check (b) trippt. -------
test('board score-Ordnung gebrochen (rank bleibt i+1-konsistent) muss trippen', () => {
  const rows = board3([70, 90, 80]); // score steigt bei i=1 -> gebrochener Sort
  const e = []; wfe.validateFile(mkHull(rows), 'energy', e);
  assert.ok(e.some((x) => /score-Ordnung gebrochen/.test(x)), 'gebrochener Score-Sort muss trippen: ' + JSON.stringify(e));
  assert.ok(!e.some((x) => /rank!=Sollrang/.test(x)), 'rank selbst ist hier i+1-konsistent, darf NICHT trippen');
});
test('overview score-Ordnung gebrochen muss trippen', () => {
  const rows = overview3([70, 90, 80]);
  const e = []; wfe.validateFile(mkOverviewFile(rows), 'overview', e);
  assert.ok(e.some((x) => /score-Ordnung gebrochen/.test(x)), 'gebrochener Score-Sort (overview) muss trippen: ' + JSON.stringify(e));
});
// R2.18 Auflage: survival ist NICHT score-sortiert (runway-desc, kein .score-Feld) -> ein
// score-Check dort waere falsch-rot auf gueltigem Output. Es gibt schlicht kein .score im
// SurvivalRow-Vertrag, also kann/darf kein Check das pruefen — das ist hier die Behauptung.
test('survival-Zeilen tragen kein .score-Feld (score-Monotonie-Check ist fuer diesen kind bewusst NICHT verkabelt)', () => {
  const rows = survival3([9999, 12, 4]);
  assert.ok(!('score' in rows[0]), 'SurvivalRow darf kein score-Feld haben');
});

// --- unprofitable-Track getrennt vom profitable-Track geprueft (eigene rank/score-Sequenz) ---
test('board unprofitable-Track: eigene rank-Sequenz, Bruch dort isoliert erkannt', () => {
  const good = board3([90, 80, 70]);
  const bad = board3([50, 60, 40]); // score steigt bei i=1
  const e = []; wfe.validateFile(mkHull(good, bad), 'energy', e);
  assert.ok(e.some((x) => /energy\.unprofitable\[1\]: score-Ordnung gebrochen/.test(x)), 'Bruch muss im unprofitable-Track lokalisiert sein: ' + JSON.stringify(e));
  assert.ok(!e.some((x) => /energy\.profitable\[.*score-Ordnung/.test(x)), 'profitable-Track ist sauber, darf nicht mit-trippen');
});

// --- Daylauf 7 (24.10.): score scale, cap count, median per full board, size class ----------
// Breakdown fields in the shape score.js emits (score == min(100, scoreShrunk*burn*growth*cycle)
// up to rounding). LOV.AX on the 24.10. export: 72.8 * 1.032 = 75.13, exported score 75.0.
const F_LOV = { burn: 1, growth: 1.032, cycle: 1 };
const withBreakdown = (row, scoreShrunk, factors = F_LOV) => ({ ...row, scoreShrunk, factors,
  axisBreakdown: [{ key: 'gm', pct: 88.1, weight: 0.2 }, { key: 'fcf', pct: null, weight: 0.1 }] });
const boardRow = (score) => board3([score])[0];
const ovRow = (score) => overview3([score])[0];
const rowErrs = (fn, r) => { const e = []; fn(r, 'w', e); return e; };
const fullHull = (profitable, unprofitable = []) => {
  const hull = mkHull(profitable, unprofitable);
  hull.cohortDelivery = wfe.cohortDeliveryFor('energy', hull, 'full');
  return hull;
};
// n scores falling evenly from top to bottom (score-desc like a real track)
const spread = (n, top, bottom) => Array.from({ length: n }, (_, i) => Math.round((top - (top - bottom) * i / (n - 1)) * 10) / 10);

test('breakdown: score.js-shaped fields pass on board and overview rows (rounding gap 0.13)', () => {
  assert.deepEqual(rowErrs(wfe.validateBoardRow, withBreakdown(boardRow(75), 72.8)), []);
  assert.deepEqual(rowErrs(wfe.validateOverviewRow, withBreakdown(ovRow(75), 72.8)), []);
  // capped row: product 104.1 (SNDK shape on 24.10.) is exported as 100
  assert.deepEqual(rowErrs(wfe.validateBoardRow, withBreakdown(boardRow(100), 99.1, { burn: 1, growth: 1.05, cycle: 1 })), []);
  // absence and null stay legal (additive optional fields)
  assert.deepEqual(rowErrs(wfe.validateBoardRow, { ...boardRow(75), scoreShrunk: null, factors: null, axisBreakdown: null }), []);
});
test('breakdown: scoreShrunk 9500 trips (board and overview)', () => {
  assert.ok(rowErrs(wfe.validateBoardRow, withBreakdown(boardRow(75), 9500)).some((x) => /scoreShrunk=9500 outside/.test(x)));
  assert.ok(rowErrs(wfe.validateOverviewRow, withBreakdown(ovRow(75), 9500)).some((x) => /scoreShrunk=9500 outside/.test(x)));
});
test('breakdown: factors.growth = 105 trips', () => {
  const e = rowErrs(wfe.validateBoardRow, withBreakdown(boardRow(75), 72.8, { burn: 1, growth: 105, cycle: 1 }));
  assert.ok(e.some((x) => /factors\.growth not finite/.test(x)), JSON.stringify(e));
});
test('breakdown: a zero, missing or non-finite factor trips', () => {
  for (const f of [{ burn: 0, growth: 1, cycle: 1 }, { burn: 1, growth: 1 }, { burn: 1, growth: 1, cycle: null }, 7]) {
    assert.ok(rowErrs(wfe.validateBoardRow, withBreakdown(boardRow(75), 72.8, f)).some((x) => /factors\./.test(x)), JSON.stringify(f));
  }
});
test('breakdown: a score the factors do not explain trips', () => {
  const e = rowErrs(wfe.validateBoardRow, withBreakdown(boardRow(75), 50));
  assert.ok(e.some((x) => /does not match scoreShrunk\*factors/.test(x)), JSON.stringify(e));
  // just outside the rounding bound at scoreShrunk 72.8 (0.05 + 0.0525 + 0.1147 + 0.001 = 0.218)
  assert.ok(rowErrs(wfe.validateBoardRow, withBreakdown(boardRow(75.4), 72.8)).some((x) => /does not match/.test(x)));
});
test('breakdown: axisBreakdown pct outside [0, 100] trips', () => {
  const r = withBreakdown(boardRow(75), 72.8);
  r.axisBreakdown = [{ key: 'gm', pct: 250, weight: 0.2 }];
  assert.ok(rowErrs(wfe.validateBoardRow, r).some((x) => /axisBreakdown\[0\]\.pct=250/.test(x)));
  for (const bad of [{ gm: 88.1 }, 'gm', 5]) {
    r.axisBreakdown = bad;
    assert.ok(rowErrs(wfe.validateBoardRow, r).some((x) => /axisBreakdown not array\|null/.test(x)), JSON.stringify(bad));
  }
});
// Master decision 24.10.: more than 10 rows at 100 is a ::warning:: naming the file, never a violation.
const captureWarnings = (fn) => {
  const out = [], warn = console.warn; console.warn = (m) => out.push(String(m));
  try { fn(); } finally { console.warn = warn; }
  return out;
};
// Smallest complete export validateExport accepts (shape as in t194-v1-cap-contract.test.js).
function writeExport(energyRows, overviewRows) {
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'export-gate-'));
  fs.mkdirSync(path.join(dir, 'full'));
  const write = (rel, value) => fs.writeFileSync(path.join(dir, rel), JSON.stringify(value));
  const counts = Object.fromEntries(wfe.BRANCHES.map((id) => [id, { profitable: id === 'energy' ? energyRows.length : 0, unprofitable: 0 }]));
  for (const id of wfe.BRANCHES) {
    for (const mode of ['topN', 'full']) {
      const mk = { ...mkHull(id === 'energy' ? energyRows : []), branch: id };
      mk.cohortDelivery = wfe.cohortDeliveryFor(id, mk, mode, counts[id]);
      write((mode === 'full' ? 'full/' : '') + id + '.json', mk);
    }
  }
  write('overview.json', mkOverviewFile(overviewRows));
  write('survival.json', mkSurvivalFile([]));
  write('index.json', { schema: wfe.SCHEMA, generated_at: 'x', coverage: null, generatedFromSnapshots: 0,
    branches: [...wfe.BRANCHES], boardStatus: Object.fromEntries(wfe.BRANCHES.map((id) => [id, 'core'])),
    counts, survivalCount: 0, excluded: {} });
  return dir;
}
test('cap count: 12 rows at 100 warn with the file name, never a violation; 10 rows stay silent', () => {
  let e = [];
  let w = captureWarnings(() => wfe.validateFile(mkHull(board3(Array(12).fill(100))), 'energy', e, { file: 'energy.json' }));
  assert.deepEqual(e, []);
  assert.deepEqual(w, ['::warning::energy.json: 12 rows at score 100 (Skalen-Deckel criterion: at most 10; the cap may mask scale inflation)']);
  e = []; w = captureWarnings(() => wfe.validateFile(mkHull(board3(Array(10).fill(100))), 'energy', e));
  assert.deepEqual([e, w], [[], []]);
  // whole export: 12 rows at 100 on the energy board, its full board (median kept mid-scale) and the overview
  const energy = board3([...Array(12).fill(100), ...spread(28, 60, 5)]);
  const dir = writeExport(energy, overview3(Array(12).fill(100)));
  w = captureWarnings(() => { e = wfe.validateExport(dir); });
  assert.deepEqual(e, [], 'validateExport must return 0 violations for 12 rows at 100');
  assert.deepEqual(w.map((x) => (x.match(/^::warning::([^:]+): 12 rows at score 100 /) || [])[1]).sort(),
    ['energy.json', 'full/energy.json', 'overview.json'], JSON.stringify(w));
});
test('median: a full board scaled x0.01 trips, the unscaled board passes', () => {
  const scores = spread(40, 95, 5); // median 50
  let e = []; wfe.validateFile(fullHull(board3(scores)), 'energy', e, { deliveryMode: 'full' });
  assert.deepEqual(e, []);
  e = []; wfe.validateFile(fullHull(board3(scores.map((s) => Math.round(s) / 100))), 'energy', e, { deliveryMode: 'full' });
  assert.ok(e.some((x) => /median score .* outside \[20, 80\]/.test(x)), JSON.stringify(e));
  // a short top-N list legitimately sits high; the median applies to full boards only
  e = []; wfe.validateFile(mkHull(board3(spread(10, 99, 90))), 'energy', e);
  assert.deepEqual(e, []);
});
test('size class: mcapKlasse must follow marketCap; marketCap must be > 0', () => {
  const r = boardRow(75); // unproven FX in the test run: marketCap and mcapKlasse are null
  assert.deepEqual(rowErrs(wfe.validateBoardRow, r), []);
  assert.deepEqual(rowErrs(wfe.validateBoardRow, { ...r, marketCap: 5e9, mcapKlasse: 'mid' }), []);
  assert.deepEqual(rowErrs(wfe.validateBoardRow, { ...r, marketCap: 5e9, mcapKlasse: null }), [], 'null next to a size stays legal (guard branch)');
  assert.ok(rowErrs(wfe.validateBoardRow, { ...r, marketCap: null, mcapKlasse: 'mega' }).some((x) => /mcapKlasse="mega" without marketCap/.test(x)));
  assert.ok(rowErrs(wfe.validateBoardRow, { ...r, marketCap: 5e9, mcapKlasse: 'mega' }).some((x) => /does not match marketCap 5000000000 \(mid\)/.test(x)));
  assert.ok(rowErrs(wfe.validateBoardRow, { ...r, marketCap: 0 }).some((x) => /marketCap=0 not > 0/.test(x)));
  assert.ok(rowErrs(wfe.validateOverviewRow, { ...ovRow(75), mcapKlasse: 'huge' }).some((x) => /mcapKlasse="huge"/.test(x)));
});

console.log(`\nfindash-export-gate.test.js: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);

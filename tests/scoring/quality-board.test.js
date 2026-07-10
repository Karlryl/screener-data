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
const { scoreUniverse } = require('../../src/scoring/score.js');
const { route } = require('../../src/scoring/router.js');
const formulas = require('../../src/scoring/formulas/index.js');
const { qualityRoute, COMPOUNDER_TIERS, QC_UNSUPPORTED_SECTORS } = require('../../src/scoring/quality-route.js');
const qcFormulas = require('../../src/scoring/formulas/quality/index.js');
const { boardStatus } = require('../../src/scoring/board-status.js');
const ax = require('../../src/scoring/axes.js');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); }
}
const V = (arr) => arr.map((v) => ({ value: v }));
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

// Reales Universum laden (fuer die byte-identisch-Seam-Pruefung); pre-pull leer -> skippen.
const SNAP_DIR = path.join(__dirname, '..', '..', 'snapshots');
const universe = [];
try {
  for (const f of fs.readdirSync(SNAP_DIR)) {
    if (!f.endsWith('.json') || f.startsWith('_')) continue;
    try { const s = JSON.parse(fs.readFileSync(path.join(SNAP_DIR, f), 'utf8')); if (s && s.meta && s.meta.ticker) universe.push(s); }
    catch (_) { /* defekt */ }
  }
} catch (_) { /* kein snapshots-Dir */ }
const HAS_UNIVERSE = universe.length > 0;
function testU(name, fn) {
  if (!HAS_UNIVERSE) { console.log('  skip ' + name + ' (kein Universum — pre-pull-Gate)'); return; }
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

console.log(`\nquality-board.test.js: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);

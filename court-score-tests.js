#!/usr/bin/env node
/**
 * court-score-tests.js — Regressions-Gate für die court-Formel (SaaS v1.1, A2-Forward-Book).
 *
 * Sperrt die Iteration-7/8-Errungenschaften ein, damit künftige Änderungen sie nicht
 * STILL brechen (kein stiller Regress):
 *   - SaaS v1.1 aktiv (degraded=false, A2-Achse live, a2Note-Disclosure vorhanden)
 *   - Anker-Inversion gefixt: GEN rankt UNTER FIG/DUOL/HNGE/DDOG (per Score)
 *   - additive A2-Achse kann KEINEN Namen nullen (alle Scores finite >=0, min>0)
 *   - GEN demoviert (>=#4) mit negativer A2 (flat book)
 *   - Determinismus: court-score.js liefert byte-identische outputs/court-results.json über Läufe
 *
 * Läuft court-score.js frisch (execSync) und prüft outputs/court-results.json.
 * Belegt in: screener-formel-ledger.md Eintrag 15; formula-spec-system-application-saas-v1.1.
 * NICHT in den 3 Pflicht-Gates (engine/tag21/tag22/tag28) — zusätzliches court-spezifisches Gate.
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const RESULTS = path.join(ROOT, 'outputs', 'court-results.json');
let passed = 0, failed = 0;
const test = (name, fn) => { try { fn(); console.log('  PASS ' + name); passed++; } catch (e) { console.log('  FAIL ' + name + ' — ' + e.message); failed++; } };
const assert = (c, m) => { if (!c) throw new Error(m); };
const sha = s => crypto.createHash('sha256').update(s).digest('hex');

// frischer Lauf
execSync('node court-score.js', { cwd: ROOT, stdio: 'ignore' });
const r1 = fs.readFileSync(RESULTS, 'utf8');
const doc = JSON.parse(r1);
const saas = doc.system_app_software;
assert(saas && Array.isArray(saas.members), 'system_app_software bucket missing');
const M = saas.members;
const rank = t => { const i = M.findIndex(m => m.ticker === t); return i < 0 ? null : i + 1; };

test('v1.1 aktiv (degraded=false, label nennt v1.1)', () => {
  assert(saas.degraded === false, 'degraded sollte false sein (v1.1 nicht degradiert)');
  assert(/v1\.1/.test(saas.label || ''), 'label sollte v1.1 nennen: ' + saas.label);
});

test('A2-Forward-Achse live (Achse + anchorsA2)', () => {
  assert(saas.anchorsA2 && saas.anchorsA2.gMed != null && saas.anchorsA2.lMed != null, 'anchorsA2 fehlt');
  assert(M[0].axisS && M[0].axisS['A2-Forward'] !== undefined, 'A2-Forward fehlt in members.axisS');
});

test('a2Note-Disclosure vorhanden (forward-book-demand, kein organic-Detektor)', () => {
  assert(saas.a2Note && /forward-book/i.test(saas.a2Note), 'a2Note-Disclosure fehlt');
});

test('Anker-Inversion gefixt: GEN unter FIG/DUOL/HNGE/DDOG', () => {
  const gen = rank('GEN');
  assert(gen != null, 'GEN nicht im Bucket');
  for (const t of ['FIG', 'DUOL', 'HNGE', 'DDOG']) {
    const x = rank(t);
    assert(x != null && x < gen, `GEN (#${gen}) muss unter ${t} (#${x}) ranken`);
  }
});

test('GEN demoviert (>=#4) mit negativer A2 (flat book)', () => {
  const gen = rank('GEN');
  assert(gen >= 4, `GEN sollte demoviert sein (>=#4), ist #${gen}`);
  const g = M.find(m => m.ticker === 'GEN');
  assert(g.axisS['A2-Forward'] < 0, `GEN A2 sollte negativ sein (flat book), ist ${g.axisS['A2-Forward']}`);
});

test('additive A2 kann keinen Namen nullen: alle Scores finite >=0, min>0', () => {
  for (const m of M) assert(Number.isFinite(m.score) && m.score >= 0, `${m.ticker} Score ungültig: ${m.score}`);
  const min = Math.min(...M.map(m => m.score));
  assert(min > 0, `min Score sollte >0 sein (additive Achse nullt nicht), ist ${min}`);
});

test('Determinismus: court-score.js byte-identisch über Läufe', () => {
  execSync('node court-score.js', { cwd: ROOT, stdio: 'ignore' });
  const r2 = fs.readFileSync(RESULTS, 'utf8');
  assert(sha(r1) === sha(r2), 'court-results.json nicht byte-identisch über Läufe (Determinismus verletzt)');
});

console.log(`\nPassed: ${passed}, Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);

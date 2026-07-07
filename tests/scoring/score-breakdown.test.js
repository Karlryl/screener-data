'use strict';
/**
 * 2.11 Stufe A — Score-Herkunft (Transparenz). Beweist:
 *  (1) Jede gescorte Zeile traegt scoreBase + scoreShrunk + factors{burn,growth,cycle}.
 *  (2) Rang-Identitaet: score == scoreShrunk * burn * growth * cycle (bis auf Rundung) — der Breakdown ist
 *      keine Deko, sondern die EXAKTE Herkunft des angezeigten Scores. (Die affinen Shrinks scoreBase->
 *      scoreShrunk sind als Zwischenzahlen ausgewiesen, nicht als rundungsfragile Ratio.)
 *  (3) Der Breakdown ist additiv/score-inert (Anker-Gates bleiben gruen — separat in score.integration).
 *
 * Usage:  node tests/scoring/score-breakdown.test.js   (Exit 0/1)
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { scoreUniverse, produceRankings } = require('../../src/scoring/score.js');
const formulas = require('../../src/scoring/formulas/index.js');

let pass = 0, fail = 0;
function test(name, fn) { try { fn(); pass++; console.log('  ok   ' + name); } catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); } }

const SNAP_DIR = path.join(__dirname, '..', '..', 'snapshots');
const universe = [];
try {
  for (const f of fs.readdirSync(SNAP_DIR).filter((x) => x.endsWith('.json') && !x.startsWith('_'))) {
    try { const s = JSON.parse(fs.readFileSync(path.join(SNAP_DIR, f), 'utf8')); if (s && s.meta && s.meta.ticker) universe.push(s); } catch (_) {}
  }
} catch (_) {}

if (universe.length < 100) {
  console.log('  (Universum < 100 -> Breakdown-Anker uebersprungen, KEIN Fail — pre-pull-Gate)');
  console.log('score-breakdown.test.js: 0 ok, 0 fail (skipped: kein Universum)');
  process.exit(0);
}
console.log(`  (Universum: ${universe.length} Snapshots geladen)`);
const r = produceRankings(scoreUniverse(universe, formulas), { topN: 50 });

// alle Board-Zeilen (alle Branchen, beide Tracks) + die Overview-Zeilen.
const allRows = [];
for (const b of Object.values(r.branches)) { allRows.push(...b.profitable, ...b.unprofitable); }
allRows.push(...r.overview);

test('jede gescorte Zeile traegt scoreBase + scoreShrunk + factors{burn,growth,cycle}', () => {
  assert.ok(allRows.length > 100, `nicht-triviale Zeilenzahl (${allRows.length})`);
  for (const row of allRows) {
    assert.ok(Number.isFinite(row.scoreBase), `${row.ticker}: scoreBase nicht finit`);
    assert.ok(Number.isFinite(row.scoreShrunk), `${row.ticker}: scoreShrunk nicht finit`);
    assert.ok(row.factors && typeof row.factors === 'object', `${row.ticker}: factors fehlt`);
    for (const k of ['burn', 'growth', 'cycle']) {
      assert.ok(row.factors[k] === null || Number.isFinite(row.factors[k]), `${row.ticker}: factors.${k} weder finit noch null`);
    }
  }
});

test('Rang-Identitaet: score == scoreShrunk * burn * growth * cycle (bis auf Rundung)', () => {
  let checked = 0;
  for (const row of allRows) {
    const f = row.factors;
    if (row.scoreShrunk == null || !f || [f.burn, f.growth, f.cycle].some((x) => x == null)) continue;
    const recon = row.scoreShrunk * f.burn * f.growth * f.cycle;
    // Rundung: scoreShrunk round1, Faktoren round3, score round1 -> Toleranz 0.15.
    assert.ok(Math.abs(recon - row.score) <= 0.15, `${row.ticker}: recon ${recon.toFixed(2)} != score ${row.score} (factors ${JSON.stringify(f)})`);
    checked++;
  }
  assert.ok(checked > 100, `nicht-triviale Pruefmenge (${checked})`);
  console.log(`       ${checked} Zeilen rang-identisch rekonstruiert`);
});

// (4) 2.7 axisBreakdown: je Zeile die Achsen-Beiträge; scoreBase == gewichtetes Mittel der present-Achsen.
test('2.7: jede Zeile trägt axisBreakdown; scoreBase == gewichtetes Mittel der present-Achsen (renorm-on-drop)', () => {
  let checked = 0;
  for (const row of allRows) {
    assert.ok(Array.isArray(row.axisBreakdown) && row.axisBreakdown.length > 0, `${row.ticker}: axisBreakdown fehlt/leer`);
    for (const a of row.axisBreakdown) {
      assert.ok(typeof a.key === 'string' && a.key, `${row.ticker}: axisBreakdown key fehlt`);
      assert.ok(a.pct === null || Number.isFinite(a.pct), `${row.ticker}: pct weder finit noch null`);
      assert.ok(Number.isFinite(a.weight), `${row.ticker}: weight nicht finit`);
    }
    if (row.scoreBase == null) continue;
    let w = 0, v = 0;
    for (const a of row.axisBreakdown) {
      if (a.pct === null || !(a.weight > 0)) continue; // renorm-on-drop: gedroppte Achse fällt raus
      w += a.weight; v += a.weight * a.pct;
    }
    if (w <= 0) continue;
    const recon = v / w;
    assert.ok(Math.abs(recon - row.scoreBase) <= 0.6, `${row.ticker}: axisBreakdown→scoreBase ${recon.toFixed(1)} != ${row.scoreBase}`);
    checked++;
  }
  assert.ok(checked > 100, `nicht-triviale Prüfmenge (${checked})`);
  console.log(`       ${checked} Zeilen: axisBreakdown rekonstruiert scoreBase (renorm-on-drop)`);
});

console.log(`\nscore-breakdown.test.js: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);

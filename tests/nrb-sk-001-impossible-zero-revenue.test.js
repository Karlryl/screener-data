// NRB-SK-001 (Hard Review 2026-07-31, section screener-daten, HOCH): PRODUCER+SCORING.
// A literal 0 annual revenue for a fiscal year that ALSO reports positive gross
// profit or positive operating income in the SAME year is a logical impossibility
// (GP = Revenue - COGS <= Revenue, so GP>0 requires Revenue>0). pull-yahoo.js
// persisted such a 0 as a real data point on both the QS and FTS annual-build
// paths; downstream it read as -100% YoY growth and as a zero margin denominator
// with stale-value compression (axes.js). Fix: _nullOutImpossibleZeroRevenue()
// nulls out the contradicted revenue entry (treats it as unknown, not zero) right
// after each build site, before any derived field (e.g. the sector-OpInc fallback)
// can consume the bad value.
//
// Standalone-Runner, keine Frameworks, kein Netz.
// Run: node tests/nrb-sk-001-impossible-zero-revenue.test.js
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { _nullOutImpossibleZeroRevenue } = require('../pull-yahoo.js');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.stack); }
}

test('0-Umsatz + positiver GP im selben Jahr -> Umsatz wird zu null (unbekannt), nicht 0', () => {
  const rev = [{ value: 0 }];
  const oi = [{ value: null }];
  const gp = [{ value: 50 }];
  _nullOutImpossibleZeroRevenue(rev, oi, gp);
  assert.equal(rev[0], null);
});
test('0-Umsatz + positiver OpInc im selben Jahr -> Umsatz wird zu null', () => {
  const rev = [{ value: 0 }];
  const oi = [{ value: 12 }];
  const gp = [{ value: null }];
  _nullOutImpossibleZeroRevenue(rev, oi, gp);
  assert.equal(rev[0], null);
});
test('0-Umsatz OHNE positives GP/OpInc bleibt unangetastet (echtes Pre-Revenue-Jahr ist valide)', () => {
  const rev = [{ value: 0 }];
  const oi = [{ value: -5 }];
  const gp = [{ value: 0 }];
  _nullOutImpossibleZeroRevenue(rev, oi, gp);
  assert.deepEqual(rev[0], { value: 0 });
});
test('positiver Umsatz bleibt in jedem Fall unangetastet', () => {
  const rev = [{ value: 100 }];
  const oi = [{ value: 20 }];
  const gp = [{ value: 40 }];
  _nullOutImpossibleZeroRevenue(rev, oi, gp);
  assert.deepEqual(rev[0], { value: 100 });
});
test('bereits-null Umsatz bleibt null (kein Crash auf fehlende Eintraege)', () => {
  const rev = [null];
  const oi = [{ value: 5 }];
  const gp = [{ value: 5 }];
  _nullOutImpossibleZeroRevenue(rev, oi, gp);
  assert.equal(rev[0], null);
});
test('Index-Ausrichtung: nur das widerspruechliche Jahr wird genullt, Nachbarjahre bleiben', () => {
  const rev = [{ value: 100 }, { value: 0 }, { value: 50 }];
  const oi = [{ value: 10 }, { value: 8 }, { value: 5 }];
  const gp = [{ value: 30 }, { value: 20 }, { value: 15 }];
  _nullOutImpossibleZeroRevenue(rev, oi, gp);
  assert.deepEqual(rev, [{ value: 100 }, null, { value: 50 }]);
});
test('fehlendes GP/OpInc-Array (undefined) crasht nicht, laesst Umsatz stehen', () => {
  const rev = [{ value: 0 }];
  assert.doesNotThrow(() => _nullOutImpossibleZeroRevenue(rev, undefined, undefined));
  assert.deepEqual(rev[0], { value: 0 });
});

// ── Wiring: beide Build-Pfade (QS + FTS) rufen den Guard tatsaechlich auf ──────
const SRC = fs.readFileSync(path.join(__dirname, '..', 'pull-yahoo.js'), 'utf8');
test('Wiring: _nullOutImpossibleZeroRevenue wird an BEIDEN Annual-Build-Stellen aufgerufen (QS + FTS)', () => {
  const hits = SRC.match(/^\s*_nullOutImpossibleZeroRevenue\(annualRev, annualOpInc, annualGP\);/gm) || [];
  assert.equal(hits.length, 2,
    'erwartet genau 2 Aufrufstellen (QS-Pfad + FTS-Pfad mapFTSToAnnual); gefunden: ' + hits.length);
});
test('Wiring: der QS-Aufruf steht VOR der Sektor-OpInc-Ableitung (die annualRev als Input nutzt)', () => {
  const iGuard = SRC.indexOf('_nullOutImpossibleZeroRevenue(annualRev, annualOpInc, annualGP)');
  const iDerive = SRC.indexOf('_deriveOpIncForFinancials(isHist, annualRev, _opMargRaw)');
  assert.ok(iGuard > 0 && iDerive > iGuard,
    'die Bereinigung muss laufen, BEVOR ein moeglicherweise falscher annualRev-Wert die Sektor-Ableitung fuettert');
});

console.log(`\nnrb-sk-001-impossible-zero-revenue.test.js: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);

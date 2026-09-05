// tests/annual-spikes-tote-sperre.test.js — Standalone-Runner (framework-los).
// Run: node tests/annual-spikes-tote-sperre.test.js
//
// WOFUER: Master-Auflage 05.09.2026 (Weg C, Delegation 29.08.) zum Jahres-Ausreisser-Waechter:
// eine Sperre in data-health/annual-spikes-baseline.json (ausgeschlossen[]) muss mindestens EINEN
// heutigen Fund treffen — sonst ist sie tot (Fall aufgeloest oder Schluessel gedriftet) und der
// Lauf sagt das LAUT (::error::, Exit 1), nicht als Warnung. Anlass: 300715.SZ trug zwei Sperren
// (annualOpInc|1, annualNetIncome|1), die seit dem Lauf 33951123754 keinen Fund mehr trafen und nur
// als ::warning:: liefen. Gepinnt wird die SACHE ueber die exportierte Funktion toteSperrenUrteil()
// (F1334: ausfuehren, nicht nachbauen). Sabotage-Nachweis (Anker N19): exit hart auf 0 -> T1 rot.
'use strict';
const assert = require('assert');
const path = require('path');
const W = require('../scripts/watch-annual-spikes.js');

let fail = 0;
function check(name, fn) {
  try { fn(); console.log('  ok   ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + ': ' + (e && e.message || e)); }
}
const fund = (ticker, reihe, index) => ({ ticker, reihe, index, wert: 1, nachbarn: [0, 0] });
const sperre = (k) => ({ schluessel: k + '|werte:1|2|3', sperrschluessel: k, seit: '2026-08-29', offenSeit: '2026-08-29', hinweis: 'Test' });

check('T1: eine Sperre OHNE heutigen Fund -> exit 1, ::error::-Zeile nennt den Sperrschluessel', () => {
  const u = W.toteSperrenUrteil([sperre('300715.SZ|annualOpInc|1')], [fund('000301.SZ', 'annualOpInc', 1)]);
  assert.strictEqual(u.exit, 1);
  assert.deepStrictEqual(u.tot, ['300715.SZ|annualOpInc|1']);
  assert.ok(/^::error::1 Sperre\(n\) treffen HEUTE keinen Fund mehr/.test(u.zeile) && /300715\.SZ\|annualOpInc\|1/.test(u.zeile), u.zeile);
});
check('T2: eine Sperre MIT Treffer -> exit 0, keine Zeile', () => {
  const u = W.toteSperrenUrteil([sperre('000301.SZ|annualOpInc|1')], [fund('000301.SZ', 'annualOpInc', 1)]);
  assert.deepStrictEqual(u, { tot: [], exit: 0, zeile: null });
});
check('T3: gemischt -> nur die tote Sperre wird genannt, exit 1', () => {
  const u = W.toteSperrenUrteil([sperre('000301.SZ|annualOpInc|1'), sperre('X|annualRev|2')], [fund('000301.SZ', 'annualOpInc', 1)]);
  assert.strictEqual(u.exit, 1); assert.deepStrictEqual(u.tot, ['X|annualRev|2']);
});
check('T4: leere Sperrliste -> exit 0 (nichts zu urteilen)', () => {
  assert.strictEqual(W.toteSperrenUrteil([], [fund('A', 'annualRev', 1)]).exit, 0);
  assert.strictEqual(W.toteSperrenUrteil(undefined, []).exit, 0);
});
check('REGISTER: die zwei toten 300715.SZ-Sperren sind entfernt; jede verbleibende Sperre traegt Schluessel, Datum und Begruendung', () => {
  const b = require(path.join('..', 'data-health', 'annual-spikes-baseline.json'));
  const tot = (b.ausgeschlossen || []).filter((a) => a && String(a.sperrschluessel).startsWith('300715.SZ|'));
  assert.strictEqual(tot.length, 0, 'tote Sperren noch da: ' + tot.map((a) => a.sperrschluessel).join(','));
  assert.ok(b.ausgeschlossen.length >= 1, 'Sperrliste darf durch die Bereinigung nicht leer werden (BANPU.BK, 000301.SZ bleiben)');
  for (const a of b.ausgeschlossen) {
    assert.ok(/^[^|]+\|[^|]+\|\d+$/.test(a.sperrschluessel) && typeof a.hinweis === 'string' && a.hinweis.length > 20 && /^\d{4}-\d{2}-\d{2}$/.test(a.seit), JSON.stringify(a).slice(0, 120));
  }
  assert.ok(/300715\.SZ/.test(String(b.hinweis)) && /ja-klassifikation-2026-09-05/.test(String(b.hinweis)), 'Bereinigung + Klassifikation muessen im hinweis stehen');
});

if (fail) { console.log('\nFAIL: annual-spikes-tote-sperre (' + fail + ')'); process.exit(1); }
console.log('\nOK: annual-spikes-tote-sperre (Master-Auflage 05.09.2026)');

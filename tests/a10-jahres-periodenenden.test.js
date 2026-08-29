// A10-Nachzug fuer die JAHRESseite (Befund 23.08.2026).
//
// Die Court-Auflage A10 ("nackte value-Arrays ohne Perioden-Ende") wurde fuer die
// QUARTALSreihen erfuellt (tests/a10-period-ends.test.js) und fuer die Jahresreihen nie
// gestellt — obwohl an ihnen 100 % des Achsen-Gewichts haengt (Vintage 2026-08-19:
// Gewichtssumme 88.978,9 ueber 9.009 Zeilen, alle acht Achsen lesen annual*).
// Ohne Perioden-Ende ist eine Reihe mit juengstem Jahr 2012 von einer mit Stand 2025
// strukturell nicht unterscheidbar.
//
// Dieser Waechter nagelt die SACHE fest, nicht ein Schreibmuster: die Enden muessen
// laengengleich und index-aligned zu IHRER eigenen Werteserie sein, ehrlich null wo kein
// Datum vorliegt, und bei einem fremden Gewinner (FTS) hart null statt versetzt.
//
// Framework-los: assert + process.exit. Run: node tests/a10-jahres-periodenenden.test.js
'use strict';
const assert = require('assert');
const { mapYahooToCanonical, _alignEnds, _applyAnnualIncomeWinner } = require('../pull-yahoo.js');

let fail = 0;
function check(name, fn) {
  try { fn(); console.log(`  ok   ${name}`); }
  catch (e) { fail++; console.log(`  FAIL ${name}: ${e.message}`); }
}

// Yahoo-Jahreszeilen, wie sie live ankommen (verifiziert 23.08.2026 an MSFT:
// endDate 2026-06-30 | 2025-06-30 | 2024-06-30 | 2023-06-30, in DERSELBEN Zeile
// wie totalRevenue). newest-first, so wie incomeStatementHistory liefert.
function jahresZeilen() {
  return [
    { endDate: '2026-06-30', totalRevenue: 300, operatingIncome: 30, grossProfit: 200 },
    { endDate: '2025-06-30', totalRevenue: 250, operatingIncome: 25, grossProfit: 170 },
    { endDate: '2024-06-30', totalRevenue: 200, operatingIncome: 20, grossProfit: 140 },
  ];
}
function mappe(isHist) {
  return mapYahooToCanonical(
    { incomeStatementHistory: { incomeStatementHistory: isHist }, summaryDetail: { marketCap: 1 } },
    { ticker: 'JR1' }, '2026-08-23T00:00:00Z');
}

// ── Kernfall: die Enden entstehen ueberhaupt, und sie stimmen ────────────────────
check('annualRevEnds existiert, ist laengengleich zu annualRev und traegt die echten Jahre', () => {
  const a = mappe(jahresZeilen()).annual || {};
  assert.ok(Array.isArray(a.annualRevEnds), 'annualRevEnds fehlt — das war der ganze Befund');
  assert.strictEqual(a.annualRev.length, a.annualRevEnds.length, 'gleiche Laenge');
  assert.deepStrictEqual(a.annualRevEnds, ['2026-06-30', '2025-06-30', '2024-06-30']);
});

check('Geschwister annualGPEnds und annualOpIncEnds ebenso (dieselbe Zeile, dieselben Enden)', () => {
  const a = mappe(jahresZeilen()).annual || {};
  assert.strictEqual(a.annualGP.length, a.annualGPEnds.length);
  assert.strictEqual(a.annualOpInc.length, a.annualOpIncEnds.length);
  assert.deepStrictEqual(a.annualGPEnds, ['2026-06-30', '2025-06-30', '2024-06-30']);
  assert.deepStrictEqual(a.annualOpIncEnds, ['2026-06-30', '2025-06-30', '2024-06-30']);
});

// ── Die eigentliche Sache: das Ende gehoert zum WERT, nicht zur Position ─────────
// _arr trimmt jede Reihe EINZELN auf ihre letzte Nicht-Null. Eine Firma kann ein
// operatives Ergebnis fuer ein Jahr fuehren, fuer das kein Umsatz gemeldet ist —
// dann laufen die Laengen auseinander und ein gemeinsames slice waere versetzt.
check('ungleich lange Reihen: jede Endenserie folgt IHRER eigenen Werteserie', () => {
  const a = mappe([
    { endDate: '2026-06-30', totalRevenue: 300, operatingIncome: 30, grossProfit: 200 },
    { endDate: '2025-06-30', totalRevenue: 250, operatingIncome: 25, grossProfit: 170 },
    { endDate: '2024-06-30', totalRevenue: null, operatingIncome: 20, grossProfit: null },
  ]).annual || {};
  assert.strictEqual(a.annualRev.length, 2, 'annualRev wird trailing-null getrimmt');
  assert.strictEqual(a.annualOpInc.length, 3, 'annualOpInc behaelt das aelteste Jahr');
  assert.strictEqual(a.annualRevEnds.length, 2, 'die Umsatz-Enden folgen dem Umsatz');
  assert.strictEqual(a.annualOpIncEnds.length, 3, 'die OpInc-Enden folgen dem OpInc, nicht dem Umsatz');
  assert.deepStrictEqual(a.annualRevEnds, ['2026-06-30', '2025-06-30']);
  assert.deepStrictEqual(a.annualOpIncEnds, ['2026-06-30', '2025-06-30', '2024-06-30']);
});

// ── Ehrlichkeit: fehlt ein Datum, steht null da — nie ein erfundenes ─────────────
check('fehlendes endDate wird null, nicht fabriziert und nicht vom Nachbarn geerbt', () => {
  const a = mappe([
    { endDate: '2026-06-30', totalRevenue: 300, operatingIncome: 30, grossProfit: 200 },
    { endDate: null, totalRevenue: 250, operatingIncome: 25, grossProfit: 170 },
  ]).annual || {};
  assert.strictEqual(a.annualRevEnds.length, 2);
  assert.strictEqual(a.annualRevEnds[0], '2026-06-30');
  assert.strictEqual(a.annualRevEnds[1], null, 'kein geerbtes Nachbardatum');
});

// ── Der fail-safe Abschluss: lieber unbekannt als versetzt ──────────────────────
check('_alignEnds: Laengen-Mismatch liefert null-Enden statt versetzter Daten', () => {
  assert.deepStrictEqual(_alignEnds(['2026-06-30'], [{ value: 1 }, { value: 2 }]), [null, null]);
  assert.deepStrictEqual(_alignEnds(null, [{ value: 1 }]), [null]);
  assert.deepStrictEqual(_alignEnds(['2026-06-30'], [{ value: 1 }]), ['2026-06-30'],
    'passende Laenge bleibt unangetastet');
});

// ── Der Bundle-Tausch: die gefaehrlichste Stelle, weil sie ein FALSCHES Datum ────
// erzeugen koennte statt eines fehlenden. Gewinnt spaeter ein fremdes Bundle (FTS),
// gehoeren die aus isHist gewonnenen Enden nicht mehr zu den Werten. Bei zufaellig
// gleicher Laenge wuerde _alignEnds sie durchwinken — deshalb sind Wertzuweisung und
// Endenbehandlung in EINER Funktion gebunden.
check('Bundle-Tausch: fremder Gewinner bei GLEICHER Laenge -> Enden hart null (kein falsches Jahr)', () => {
  const annual = {
    annualRev: [{ value: 300 }, { value: 250 }],
    annualGP: [{ value: 200 }, { value: 170 }],
    annualOpInc: [{ value: 30 }, { value: 25 }],
    annualNetIncome: [{ value: 10 }, { value: 8 }],
    annualRevEnds: ['2026-06-30', '2025-06-30'],
    annualGPEnds: ['2026-06-30', '2025-06-30'],
    annualOpIncEnds: ['2026-06-30', '2025-06-30'],
  };
  const fremd = {
    annualRev: [{ value: 999 }, { value: 888 }],      // gleiche Laenge, ANDERE Jahre
    annualGP: [{ value: 700 }, { value: 600 }],
    annualOpInc: [{ value: 90 }, { value: 80 }],
    annualNetIncome: [{ value: 50 }, { value: 40 }],
  };
  _applyAnnualIncomeWinner(annual, fremd, false);
  assert.deepStrictEqual(annual.annualRev, fremd.annualRev, 'die Werte wurden getauscht');
  assert.deepStrictEqual(annual.annualRevEnds, [null, null],
    'die alten Enden haengen jetzt an fremden Werten — das waere ein stiller Datenfehler');
  assert.deepStrictEqual(annual.annualGPEnds, [null, null]);
  assert.deepStrictEqual(annual.annualOpIncEnds, [null, null]);
});

check('Bundle-Tausch: gewinnt QS, bleiben die Enden erhalten (nicht blind genullt)', () => {
  const annual = {
    annualRev: [{ value: 300 }, { value: 250 }],
    annualGP: [{ value: 200 }, { value: 170 }],
    annualOpInc: [{ value: 30 }, { value: 25 }],
    annualNetIncome: [{ value: 10 }, { value: 8 }],
    annualRevEnds: ['2026-06-30', '2025-06-30'],
    annualGPEnds: ['2026-06-30', '2025-06-30'],
    annualOpIncEnds: ['2026-06-30', '2025-06-30'],
  };
  const qs = {
    annualRev: annual.annualRev, annualGP: annual.annualGP,
    annualOpInc: annual.annualOpInc, annualNetIncome: annual.annualNetIncome,
  };
  _applyAnnualIncomeWinner(annual, qs, true);
  assert.deepStrictEqual(annual.annualRevEnds, ['2026-06-30', '2025-06-30'],
    'bei QS-Sieg duerfen die Enden NICHT verloren gehen');
  assert.deepStrictEqual(annual.annualOpIncEnds, ['2026-06-30', '2025-06-30']);
});

check('Bundle-Tausch: fremder Gewinner mit ANDERER Laenge -> Enden laengengleich und null', () => {
  const annual = {
    annualRev: [{ value: 300 }, { value: 250 }],
    annualGP: [{ value: 200 }], annualOpInc: [{ value: 30 }], annualNetIncome: [{ value: 10 }],
    annualRevEnds: ['2026-06-30', '2025-06-30'],
    annualGPEnds: ['2026-06-30'], annualOpIncEnds: ['2026-06-30'],
  };
  _applyAnnualIncomeWinner(annual, {
    annualRev: [{ value: 1 }, { value: 2 }, { value: 3 }],
    annualGP: [{ value: 4 }, { value: 5 }, { value: 6 }],
    annualOpInc: [{ value: 7 }, { value: 8 }, { value: 9 }],
    annualNetIncome: [{ value: 1 }, { value: 2 }, { value: 3 }],
  }, false);
  assert.strictEqual(annual.annualRevEnds.length, 3, 'Enden folgen der neuen Laenge');
  assert.deepStrictEqual(annual.annualRevEnds, [null, null, null]);
});

// ── Score-Neutralitaet: das Feld ist Substrat, kein Guard ───────────────────────
// Wenn eine Achse es je liest, ist es kein Substrat mehr, sondern eine
// Methodenaenderung — und die ist gauntlet- und siegelpflichtig.
check('KEINE Scoring-Datei liest die neuen Felder (Substrat-Zusicherung)', () => {
  const fs = require('fs');
  const path = require('path');
  const dir = path.join(__dirname, '..', 'src', 'scoring');
  const treffer = [];
  (function walk(d) {
    for (const f of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, f.name);
      if (f.isDirectory()) { walk(p); continue; }
      if (!f.name.endsWith('.js')) continue;
      const src = fs.readFileSync(p, 'utf8');
      if (/annualRevEnds|annualGPEnds|annualOpIncEnds/.test(src)) treffer.push(p);
    }
  })(dir);
  assert.deepStrictEqual(treffer, [],
    'eine Scoring-Datei liest die Perioden-Enden — dann ist das kein Substrat mehr, '
    + 'sondern eine Methodenaenderung unter dem GQS-Siegel: ' + JSON.stringify(treffer));
});

console.log(fail === 0 ? '\nA10-Jahresseite: ALL PASS' : `\nA10-Jahresseite: ${fail} FAIL`);
process.exit(fail ? 1 : 0);

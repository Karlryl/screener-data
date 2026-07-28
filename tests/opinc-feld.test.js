'use strict';
/**
 * Waechter: der Screener liest das BERICHTETE Betriebsergebnis, nicht Yahoos normalisiertes.
 *
 * BEFUND (28.07.): Yahoo liefert in DERSELBEN Antwort zwei verschiedene Betriebsergebnisse.
 *   operatingIncome                = NORMALISIERT (ohne Wertminderungen, Restrukturierung,
 *                                    M&A — Yahoos eigenes Feld totalUnusualItems)
 *   totalOperatingIncomeAsReported = die BERICHTETE Zahl aus dem Abschluss
 * In pull-yahoo.js stand jahrelang das normalisierte Feld ZUERST. Weil es fast immer belegt
 * ist, wurde der As-Reported-Zweig praktisch nie erreicht — der Screener rechnete also mit
 * einer Zahl, die es im Geschaeftsbericht nicht gibt.
 *
 * Gemessen an 143 Konfliktfirmen (516 vergleichbare Jahre, live gegen die SEC-Abschluesse):
 *     berichtet   deckt sich zu 93,6 % (483/516)
 *     normalisiert          zu 23,4 % (121/516)
 * Der Unterschied IST der Einmalaufwand: AGCO FY2024 normalisiert 927 Mio, berichtet
 * -122 Mio, Einmalposten -1.050 Mio (Wertminderung 370, Restrukturierung 173).
 *
 * Folge des alten Zustands: eine Firma mit berichtetem Betriebsverlust galt als profitabel.
 *
 * Usage:  node tests/opinc-feld.test.js   (Exit 0/1)
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'pull-yahoo.js'), 'utf8');

let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); }
}

/** Alle _ftsValue-Aufrufe, die ein Betriebsergebnis holen — Jahres- UND Quartalspfad. */
function opIncAufrufe() {
  const treffer = [];
  const re = /_ftsValue\(\s*r\s*,\s*([^)]*operatingIncome[^)]*)\)/gi;
  let m;
  while ((m = re.exec(SRC)) !== null) {
    const felder = m[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, ''));
    const zeile = SRC.slice(0, m.index).split('\n').length;
    treffer.push({ zeile, felder });
  }
  return treffer;
}

check('es gibt ueberhaupt Betriebsergebnis-Aufrufe zu pruefen', () => {
  // Ohne diese Probe wuerde eine Umbenennung den ganzen Waechter still leerlaufen lassen —
  // "0 von 0 Aufrufen in Ordnung" saehe gruen aus.
  const a = opIncAufrufe();
  assert.ok(a.length >= 2, 'erwartet mindestens Jahres- und Quartalspfad, gefunden: ' + a.length);
});

check('JEDER Betriebsergebnis-Aufruf nimmt die berichtete Zahl zuerst', () => {
  for (const a of opIncAufrufe()) {
    const erstesEcht = a.felder.find((f) => /operatingIncome/i.test(f));
    assert.ok(/AsReported/i.test(erstesEcht),
      'pull-yahoo.js:' + a.zeile + ' nimmt "' + erstesEcht + '" zuerst — das ist Yahoos '
      + 'NORMALISIERTE Zahl. Vorne gehoert totalOperatingIncomeAsReported.');
  }
});

check('die normalisierte Zahl bleibt als Rueckfall erhalten', () => {
  // AsReported fehlt in rund 3 % der Jahre. Wer sie ersatzlos streicht, tauscht einen
  // falschen Wert gegen eine Luecke — und Luecken kosten in diesem System Achsen.
  for (const a of opIncAufrufe()) {
    assert.ok(a.felder.some((f) => /^operatingIncome$/i.test(f)),
      'pull-yahoo.js:' + a.zeile + ' hat keinen Rueckfall auf operatingIncome');
  }
});

check('der Quartalspfad hat den Rueckfall jetzt auch', () => {
  // Er hatte ihn frueher GAR NICHT — die Quartalsreihe war also noch systematischer
  // normalisiert als die Jahresreihe. Sie speist die Breakeven-Trajektorie in
  // profit-tier.js, also genau die Aussage "kurz vor profitabel".
  const a = opIncAufrufe();
  assert.ok(a.length >= 2);
  for (const x of a) {
    assert.ok(x.felder.some((f) => /AsReported/i.test(f)),
      'pull-yahoo.js:' + x.zeile + ' kennt die berichtete Zahl gar nicht');
  }
});

check('der Massstab-Bruch ist registriert, damit der Wert-Gate nicht falsch gelesen wird', () => {
  // Der erste Lauf nach der Umstellung meldet mit hoher Wahrscheinlichkeit SUSPECT —
  // das ist die ERWARTETE Folge, kein Defekt. Ohne Eintrag wuerde jemand (auch ich)
  // morgen einen Fehler suchen, den es nicht gibt.
  const ex = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'board-history', '_excluded.json'), 'utf8'));
  const e = (ex._massstab_brueche || []).find((x) => /AsReported/i.test(x.was || ''));
  assert.ok(e, 'kein Massstab-Bruch fuer die Feld-Umstellung eingetragen');
  assert.ok(e.letztes_altes_vintage, 'der Eintrag muss am letzten ALTEN Vintage haengen, nicht an einem Kalendertag');
  assert.ok(/nachpruefen|NICHT mehr die Ursache/i.test(JSON.stringify(e)),
    'es muss drinstehen, woran man erkennt, dass die Umstellung NICHT mehr die Ursache ist');
});

console.log('\nopinc-feld: ' + pass + ' ok, ' + fail + ' fail');
process.exit(fail ? 1 : 0);

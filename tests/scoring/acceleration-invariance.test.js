'use strict';
/**
 * Invarianz-Test der Umsatz-Beschleunigung (Court-Auflage 26.07.2026, Karl-Entscheid).
 *
 * ERSETZT den bisherigen Ticker-Anker "CRDO im oberen 20 % seines Track-Kohorten-
 * Rankings". Der prueft einen NAMEN und laesst sich durch Kalibrieren auf genau diesen
 * Namen erfuellen — er war ausserdem seit seiner Scharfschaltung am 19.07. nie gruen.
 * Dieser Test prueft stattdessen eine EIGENSCHAFT des Messgeraets, die ohne einen
 * einzigen echten Ticker beweisbar ist:
 *
 *   Waechst eine Firma exakt konstant (jedes Quartal genau +X % gegenueber DEMSELBEN
 *   Vorjahresquartal), dann ist ihre Beschleunigung per Definition null — unabhaengig
 *   davon, welches Fiskalquartal zuletzt gemeldet wurde und wie viele Quartale
 *   gespeichert sind.
 *
 * Der Defekt, den dieser Test faengt (gemessen 26.07.): revAcceleration bildete
 * Quartal-gegen-VORQUARTAL-Raten (QoQ) und subtrahierte die aelteste von der juengsten.
 * Zwei verschiedene Saison-Uebergaenge gegeneinander — welche das sind, haengt davon ab,
 * wie viele Quartale in der Reihe stehen. Auf einer Reihe mit beweisbar konstantem
 * Wachstum ergab das je nach Fiskal-Versatz zweistellige Ausschlaege in beide Richtungen.
 * In 8 von 13 Branchenformeln ist das die zweitschwerste Achse.
 *
 * Usage:  node tests/scoring/acceleration-invariance.test.js   (Exit 0 gruen / 1 Fehler)
 */
const assert = require('node:assert/strict');
const ax = require('../../src/scoring/axes.js');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); }
}

// Deutlich saisonale Grundform: Q-Muster mit 130 zu 70 fast dem Doppelten. Genau diese
// Saison muss sich herauskuerzen — sie ist der Hebel, an dem der alte QoQ-Aufbau scheiterte.
const SAISON = [100, 70, 130, 90];

/**
 * Baut eine revenueQ-Reihe (newest-first) mit EXAKT konstantem Jahreswachstum.
 * @param {number} yoy      Jahreswachstum als Bruchteil, z. B. 0.30 fuer +30 %
 * @param {number} n        Anzahl Quartale
 * @param {number} versatz  Fiskal-Versatz 0..3 (welches Saisonquartal zuletzt gemeldet wurde)
 */
function konstanteReihe(yoy, n, versatz) {
  const werte = [];
  for (let i = 0; i < n; i++) {
    const saisonwert = SAISON[(versatz + i) % 4];
    // i Quartale zurueck = floor(i/4) Jahre zurueck -> durch (1+yoy) je Jahr teilen
    werte.push({ value: saisonwert * Math.pow(1 + yoy, -Math.floor(i / 4)) });
  }
  return { timeseries: { revenueQ: werte } };
}

// Selbstkontrolle des Fixtures: die Reihe muss wirklich konstantes YoY tragen, sonst
// prueft der Test nichts. Ein kaputtes Fixture wuerde jede Achse gruen aussehen lassen.
test('Fixture-Kontrolle: konstanteReihe traegt an JEDER Stelle exakt +30 % YoY', () => {
  for (const versatz of [0, 1, 2, 3]) {
    const rq = konstanteReihe(0.30, 12, versatz).timeseries.revenueQ;
    for (let i = 0; i + 4 < rq.length; i++) {
      const yoy = rq[i].value / rq[i + 4].value - 1;
      assert.ok(Math.abs(yoy - 0.30) < 1e-9,
        `Versatz ${versatz}, Index ${i}: YoY=${(yoy * 100).toFixed(2)} % statt 30 %`);
    }
  }
});

// --- Kern-Invariante --------------------------------------------------------
const TOLERANZ = 0.02; // 2 Prozentpunkte; der gemessene Defekt lag bei bis zu 35,6

test('konstantes Wachstum -> Beschleunigung null, ueber alle 4 Fiskal-Versaetze', () => {
  const abweichungen = [];
  for (const versatz of [0, 1, 2, 3]) {
    const a = ax.revAcceleration(konstanteReihe(0.30, 12, versatz));
    assert.notEqual(a, null, `Versatz ${versatz}: Achse liefert null trotz 12 Quartalen`);
    abweichungen.push((a * 100).toFixed(1));
  }
  const max = Math.max(...abweichungen.map((v) => Math.abs(parseFloat(v))));
  console.log(`       Ausschlag je Fiskal-Versatz (Prozentpunkte): ${abweichungen.join(' / ')}`);
  assert.ok(max <= TOLERANZ * 100,
    `bei beweisbar konstantem Wachstum bis zu ${max} Prozentpunkte Beschleunigung — die Achse misst Saison, nicht Beschleunigung`);
});

test('konstantes Wachstum -> null, unabhaengig von der Reihenlaenge (8 / 12 / 16 Quartale)', () => {
  for (const n of [8, 12, 16]) {
    for (const versatz of [0, 1, 2, 3]) {
      const a = ax.revAcceleration(konstanteReihe(0.30, n, versatz));
      if (a === null) continue; // zu kurz ist erlaubt, falsch ist es nicht
      assert.ok(Math.abs(a) <= TOLERANZ,
        `n=${n}, Versatz=${versatz}: ${(a * 100).toFixed(1)} Prozentpunkte statt null`);
    }
  }
});

test('konstantes Wachstum -> null, unabhaengig vom Wachstumsniveau (10 / 30 / 80 %)', () => {
  for (const yoy of [0.10, 0.30, 0.80]) {
    for (const versatz of [0, 1, 2, 3]) {
      const a = ax.revAcceleration(konstanteReihe(yoy, 12, versatz));
      assert.ok(a !== null && Math.abs(a) <= TOLERANZ,
        `YoY=${yoy}, Versatz=${versatz}: ${a === null ? 'null' : (a * 100).toFixed(1) + ' Prozentpunkte'} statt null`);
    }
  }
});

// --- Gegenprobe: die Achse darf nicht einfach immer null liefern -------------
// Ohne diese beiden Tests waere `return 0` eine bestandene Loesung.
function reiheMitYoYVerlauf(yoyProJahr, versatz) {
  // yoyProJahr: [juengstes Jahr, mittleres, aeltestes] — je Jahr ein anderes YoY
  const werte = [];
  for (let i = 0; i < 12; i++) {
    const jahr = Math.floor(i / 4);
    let faktor = 1;
    for (let j = 0; j < jahr; j++) faktor *= (1 + yoyProJahr[j]);
    werte.push({ value: SAISON[(versatz + i) % 4] / faktor });
  }
  return { timeseries: { revenueQ: werte } };
}

test('echte Beschleunigung wird als POSITIV erkannt (20 % -> 40 % -> 60 %)', () => {
  for (const versatz of [0, 1, 2, 3]) {
    const a = ax.revAcceleration(reiheMitYoYVerlauf([0.60, 0.40, 0.20], versatz));
    assert.ok(a !== null && a > 0.05,
      `Versatz ${versatz}: ${a === null ? 'null' : a.toFixed(3)} — beschleunigende Reihe muss klar positiv sein`);
  }
});

test('echte Verlangsamung wird als NEGATIV erkannt (60 % -> 40 % -> 20 %)', () => {
  for (const versatz of [0, 1, 2, 3]) {
    const a = ax.revAcceleration(reiheMitYoYVerlauf([0.20, 0.40, 0.60], versatz));
    assert.ok(a !== null && a < -0.05,
      `Versatz ${versatz}: ${a === null ? 'null' : a.toFixed(3)} — verlangsamende Reihe muss klar negativ sein`);
  }
});

// --- Drop-Verhalten bleibt ehrlich ------------------------------------------
test('zu kurze Reihe -> null (kein geratener Wert)', () => {
  assert.equal(ax.revAcceleration({ timeseries: { revenueQ: [{ value: 10 }, { value: 9 }] } }), null);
  assert.equal(ax.revAcceleration({ timeseries: { revenueQ: [] } }), null);
});

console.log(`\nacceleration-invariance.test.js: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);

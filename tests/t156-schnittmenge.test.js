'use strict';
/**
 * Waechter fuer den T156-Zaehl-Lauf (scripts/t156-einmalertrag-bonus-schnittmenge.js).
 *
 * DIE FALLE, DIE HIER FESTGENAGELT WIRD, IST REAL PASSIERT: der erste Lauf des Skripts
 * meldete "Lampe an: 0, nicht bewertbar: 9.520 von 9.520" - ein sauber aussehender
 * Bericht, in dem die gesuchte Schnittmenge per Konstruktion leer war. Ursache:
 * scoreUniverse() loescht e.snapshot am Ende (score.js:1359), und jede Lampen-Abfrage
 * DANACH liefert still 'nicht bewertbar'. Ein Zaehl-Lauf, der still Null zaehlt, ist
 * schlimmer als einer, der knallt: er beantwortet eine Ratsfrage mit einem Artefakt.
 *
 * Geprueft wird deshalb ANWESENHEIT UND ABWESENHEIT an der SACHE, nicht an einem Text:
 *   (1) eine Zeile mit brennender Lampe UND Bonus landet in der Schnittmenge;
 *   (2) das Universum ist NICHT vollstaendig 'nicht bewertbar' (die stille Nullzaehlung);
 *   (3) die Gegenrichtung zaehlt eine Zeile, in der die Spitze da ist und die Lampe
 *       trotzdem schweigt (Anlauf-Schutz) - sonst waere Teil 3 von T156 wieder blind;
 *   (4) die gespiegelte Konstante ANTEIL stimmt mit dem VERHALTEN der echten Lampe
 *       ueberein (kein zweiter, driftender Schwellwert im Repo).
 *
 * Usage:  node tests/t156-schnittmenge.test.js   (Exit 0/1)
 */
const assert = require('node:assert/strict');
const { einmalertrag } = require('../src/scoring/lamps.js');
const { konzentration, schweigegrund, messen, ANTEIL } = require('../scripts/t156-einmalertrag-bonus-schnittmenge.js');

let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); }
}

// Minimal-Snapshot in der Form, die die Engine liest. Quartale: neueste zuerst.
function snap(ticker, revQ, ends, extra = {}) {
  return {
    identifier: { ticker },
    meta: { ticker, name: ticker, sector: 'Technology', country: 'United States', ...(extra.meta || {}) },
    marketCap: { value: 5e9 },
    metrics: {},
    external: {},
    annual: extra.annual || {},
    timeseries: {
      revenueQ: revQ.map((v) => ({ value: v })),
      revenueQEnds: ends,
      grossProfitQ: revQ.map((v) => ({ value: v * 0.6 })),
      grossProfitQEnds: ends,
      // opIncQ ist noetig, damit marginTrajectory traegt: die fuenf EINMALERTRAG_BLIND-Achsen
      // (score.js:374) werden fuer eine brennende Zeile auf null gesetzt - ohne eine
      // NICHT-geblindete Achse faellt die Zeile als 'no-axes' aus dem Lauf und die
      // Schnittmenge waere wieder leer, diesmal aus einem anderen Grund.
      opIncQ: revQ.map((v, i) => ({ value: v * (0.10 + i * 0.01) })),
      opIncQEnds: ends,
    },
  };
}

const ENDEN = ['2026-06-30', '2026-03-31', '2025-12-31', '2025-09-30', '2025-06-30'];
// Spitze im zweitjuengsten Quartal, kein Anlauf (die Reihe faellt danach wieder) -> Lampe an.
// Das juengste Quartal liegt ueber dem Vorjahresquartal, damit die Zeile auch den
// Wachstums-Bonus traegt - genau die Konstellation, um die W1 streitet (Form wie MGTX).
const EINMAL = [200, 900, 100, 120, 60];
// Monoton steigend -> dieselbe rohe Konzentration, aber Anlauf-Schutz -> Lampe aus.
const ANLAUF = [420, 210, 100, 50, 25];

check('Testdaten treffen die Lampe wirklich (an / aus), sonst misst der Rest nichts', () => {
  assert.equal(einmalertrag(snap('EINMAL', EINMAL, ENDEN)), true);
  assert.equal(einmalertrag(snap('ANLAUF', ANLAUF, ENDEN)), false);
});

check('ANTEIL ist am VERHALTEN der Lampe gespiegelt, nicht am Zahlenwert geraten', () => {
  const k = konzentration(snap('EINMAL', EINMAL, ENDEN));
  assert.ok(k.anteil >= ANTEIL, 'Spitze muss die Schwelle reissen');
  // Knapp UNTER der Schwelle muss die Lampe schweigen - das prueft, dass ANTEIL
  // dieselbe Grenze meint wie lamps.js und nicht eine eigene, driftende.
  const knapp = [49, 20, 20, 11];
  const kk = konzentration(snap('KNAPP', knapp, ENDEN.slice(0, 4)));
  assert.ok(kk.anteil < ANTEIL);
  assert.equal(einmalertrag(snap('KNAPP', knapp, ENDEN.slice(0, 4))), false);
});

check('Anlauf-Fall wird als Schweigegrund benannt (Teil 3 von T156 ist zaehlbar)', () => {
  assert.equal(schweigegrund(snap('ANLAUF', ANLAUF, ENDEN)), 'anlaufSchutz');
});

// --- Der eigentliche Waechter: der Zaehl-Lauf ueber ein Mini-Universum -----------
// Zwei Kohorten-Nachbarn sorgen dafuer, dass der Bonus ueberhaupt eine Verteilung hat
// (growthPctlFn braucht >= GROWTH_MIN_DISTINCT verschiedene Wachstumswerte).
function miniUniversum() {
  const u = [snap('EINMAL', EINMAL, ENDEN), snap('ANLAUF', ANLAUF, ENDEN)];
  for (let i = 0; i < 12; i++) {
    const basis = 100 + i * 7;
    u.push(snap('FUELL' + i, [basis * (1 + i / 20), basis, basis * 0.98, basis * 0.95, basis * 0.9], ENDEN));
  }
  return u;
}

const bericht = messen(miniUniversum());

check('nicht das ganze Universum ist "nicht bewertbar" (stille Nullzaehlung)', () => {
  assert.ok(bericht.gescorteZeilen > 0, 'nichts gescort - Testaufbau kaputt');
  assert.notEqual(bericht.lampeNichtBewertbar, bericht.gescorteZeilen);
  assert.ok(bericht.lampeAn >= 1, 'keine einzige brennende Lampe im Lauf');
});

check('brennende Lampe MIT Bonus landet in der Schnittmenge', () => {
  const tickers = bericht.zellen.lampeAn_bonusAn.map((z) => z.ticker);
  assert.ok(tickers.includes('EINMAL'), 'Schnittmenge enthaelt EINMAL nicht: ' + JSON.stringify(tickers));
  assert.equal(bericht.schnittmenge_lampeAn_bonusAn, bericht.zellen.lampeAn_bonusAn.length);
});

check('Gegenrichtung zaehlt die Zeile, deren Spitze der Anlauf-Schutz schluckt', () => {
  const g = bericht.gegenrichtung_bonusAn_spitzeVorhanden_lampeSchweigt.anlaufSchutz;
  assert.ok(g && g.n >= 1, 'Anlauf-Zeile nicht gezaehlt: ' + JSON.stringify(Object.keys(bericht.gegenrichtung_bonusAn_spitzeVorhanden_lampeSchweigt)));
  assert.ok(g.faelle.some((f) => f.ticker === 'ANLAUF'));
});

console.log(`\nt156-schnittmenge: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);

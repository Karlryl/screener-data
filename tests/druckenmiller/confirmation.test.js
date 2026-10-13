'use strict';
/** tests/druckenmiller/confirmation.test.js — Standalone-Runner.
 *
 * DIE ZUSICHERUNG: M1 und M2 sind genau die Definitionen aus BUILD-SPEC v1 [REV3-6], die
 * Terzile werden JEDEN Lauf aus U gelernt (nie eine feste Schwelle, Invariante 3), und ein
 * Ticker ohne Balken am Sitzungstag bekommt `null` — nie ein stilles NEUTRAL.
 *
 * Der wichtigste Test hier ist C6: M2 hat eine echte Punktmasse bei 1,0 (jeder Ticker am
 * 252-Tage-Hoch). Mit einer strikten Schnittkante faellt ausgerechnet dieser Fall aus dem
 * oberen Terzil, sobald mehr als ein Drittel von U am Hoch steht.
 */
const assert = require('node:assert/strict');
const C = require('../../lib/druckenmiller/confirmation.js');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + (e && e.message)); }
}

/** Serie mit <n> Balken, Schlusskurs = <fn(i)>, Datum = Werktags-Zaehler. */
function serie(n, fn) {
  const out = [];
  let d = new Date(Date.UTC(2024, 0, 1));
  for (let i = 0; i < n; i++) {
    out.push({ date: d.toISOString().slice(0, 10), close: fn(i) });
    do { d = new Date(d.getTime() + 86400000); } while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
  }
  return out;
}

test('C1 M1 ist die log-Rendite t-252..t-21 geteilt durch die 252-Tage-Tagesvol', () => {
  // Kurs mit konstanter Tages-Log-Drift plus alternierendem Zacken: Vol und Drift sind
  // beide von Hand nachrechenbar, also rechnet der Test nicht das Modul nach, sondern die
  // Definition.
  const s = serie(300, (i) => 100 * Math.exp(0.001 * i + (i % 2 ? 0.004 : 0)));
  const m = C.metricsFor(s, s[s.length - 1].date);
  const closes = s.map((b) => b.close);
  const n = closes.length;
  const erwartetZaehler = Math.log(closes[n - 1 - C.M1_LAG] / closes[n - 1 - C.M1_LOOKBACK]);
  const r = [];
  for (let i = n - C.VOL_WINDOW; i < n; i++) r.push(Math.log(closes[i] / closes[i - 1]));
  const mu = r.reduce((a, b) => a + b, 0) / r.length;
  const sd = Math.sqrt(r.reduce((a, b) => a + (b - mu) * (b - mu), 0) / (r.length - 1));
  assert.ok(Math.abs(m.m1 - erwartetZaehler / sd) < 1e-12, 'M1 weicht von der Definition ab: ' + m.m1);
  assert.ok(Math.abs(m.vol252 - sd) < 1e-12);
  assert.equal(C.M1_LOOKBACK, 252);
  assert.equal(C.M1_LAG, 21);
});

test('C2 M2 ist Schluss durch 252-Tage-Hoch, am Hoch genau 1,0', () => {
  const steigend = serie(300, (i) => 100 + i);           // letzter Balken IST das Hoch
  const m1 = C.metricsFor(steigend, steigend[299].date);
  assert.equal(m1.m2, 1, 'am Hoch muss M2 exakt 1 sein');
  const gefallen = serie(300, (i) => (i < 250 ? 100 + i : 200));
  const m2 = C.metricsFor(gefallen, gefallen[299].date);
  assert.ok(m2.m2 < 1 && m2.m2 > 0.5, 'unter dem Hoch liegt M2 zwischen 0 und 1: ' + m2.m2);
});

test('C3 zu kurze Serie liefert null, nicht 0', () => {
  const kurz = serie(100, (i) => 100 + i);
  const m = C.metricsFor(kurz, kurz[99].date);
  assert.equal(m.m1, null, 'ohne 253 Balken gibt es kein M1');
  assert.equal(m.m2, null, 'ohne 252 Balken gibt es kein M2');
  assert.equal(C.metricsFor(kurz, '1999-01-01'), null, 'ohne Balken am Sitzungstag gibt es keine Kennzahlen');
  assert.equal(C.dailyLogVol([100, 100, 100, 100], 3), null, 'eine Vol von 0 ist keine Vol');
});

test('C4 Terzile sind Typ-7-interpoliert und brauchen eine Mindestzahl', () => {
  const xs = [];
  for (let i = 1; i <= 90; i++) xs.push(i);
  const t = C.terciles(xs, 30);
  assert.ok(Math.abs(t.q33 - (1 + (89 / 3))) < 1e-9, 'q33: ' + t.q33);
  assert.ok(Math.abs(t.q67 - (1 + (89 * 2 / 3))) < 1e-9, 'q67: ' + t.q67);
  assert.equal(t.n, 90);
  assert.equal(C.terciles([1, 2, 3], 30), null, 'unter der Mindestzahl gibt es keine Schnitte');
  assert.equal(C.terciles([1, null, NaN, 2], 2).n, 2, 'nicht-endliche Werte fallen aus dem Nenner');
});

test('C5 die Zustands-Wahrheitstabelle aus [REV3-6]', () => {
  const cuts = { q33: 1, q67: 2, n: 99 };
  assert.equal(C.stateOf(3, 3, cuts, cuts).state, 'CONFIRMS', 'beide oben');
  assert.equal(C.stateOf(3, 1.5, cuts, cuts).state, 'NEUTRAL', 'nur einer oben, keiner unten');
  assert.equal(C.stateOf(3, 0.5, cuts, cuts).state, 'WEAK', 'einer unten schlaegt einen oben');
  assert.equal(C.stateOf(0.5, 0.5, cuts, cuts).state, 'WEAK', 'beide unten');
  assert.equal(C.stateOf(1.5, 1.5, cuts, cuts).state, 'NEUTRAL', 'beide in der Mitte');
  assert.equal(C.stateOf(null, 3, cuts, cuts).state, null, 'fehlende Kennzahl = kein Zustand');
  assert.equal(C.stateOf(3, 3, null, cuts).state, null, 'fehlende Schnitte = kein Zustand');
});

test('C6 die Schnittkante ist INKLUSIV — die Punktmasse am Hoch bleibt im oberen Terzil', () => {
  // 50 Ticker am Hoch (M2 = 1,0), 40 darunter: q67 liegt damit AUF 1,0.
  const werte = [];
  for (let i = 0; i < 50; i++) werte.push(1);
  for (let i = 0; i < 40; i++) werte.push(0.5 + i / 200);
  const cuts = C.terciles(werte, 30);
  assert.equal(cuts.q67, 1, 'q67 muss hier genau auf der Punktmasse liegen');
  const z = C.stateOf(5, 1, { q33: 0, q67: 1 }, cuts);
  assert.equal(z.state, 'CONFIRMS', 'ein Ticker AM Hoch gehoert ins obere Terzil');
  // Gegenprobe zur Kante: knapp darunter ist es kein CONFIRMS mehr.
  assert.equal(C.stateOf(5, 0.999, { q33: 0, q67: 1 }, cuts).state, 'NEUTRAL');
});

test('C7 entartete Schnitte behaupten keinen Zustand (q33 == q67)', () => {
  const flach = { q33: 1, q67: 1, n: 99 };
  const z = C.stateOf(1, 1, flach, flach);
  assert.equal(z.state, 'NEUTRAL', 'bei entarteter Verteilung gibt es kein CONFIRMS');
  assert.equal(z.degenerate, true, 'und der Fall wird gezaehlt, nicht verschwiegen');
});

test('C8 Trennungs-Tor: > 60 % und < 10 % CONFIRMS machen die Sitzung RAW', () => {
  const mach = (c, rest) => [].concat(Array(c).fill('CONFIRMS'), Array(rest).fill('NEUTRAL'));
  assert.equal(C.separationGate(mach(70, 30)).raw, true, 'ueber 60 %');
  assert.equal(C.separationGate(mach(5, 95)).raw, true, 'unter 10 %');
  const gut = C.separationGate(mach(30, 70));
  assert.equal(gut.raw, false);
  assert.ok(Math.abs(gut.confirmsShare - 0.3) < 1e-12);
  assert.equal(C.separationGate([null, null]).raw, true, 'ohne Zustaende gibt es keine Trennung');
  assert.equal(C.SEPARATION_MAX, 0.6);
  assert.equal(C.SEPARATION_MIN, 0.1);
});

test('C9 wer nicht in U ist oder keinen Balken hat, bekommt null — nie NEUTRAL', () => {
  const s = serie(300, (i) => 100 + i);
  const extra = C.rowExtra(s, s[299].date);
  assert.ok(Number.isFinite(extra.sigma63), 'die Zeilen-Beilage traegt sigma63');
  const rows = [
    Object.assign({ ticker: 'AAA', inUniverse: true, atSession: true, close: s[299].close }, extra),
    Object.assign({ ticker: 'BBB', inUniverse: true, atSession: false, close: s[299].close }, extra),
    Object.assign({ ticker: 'CCC', inUniverse: false, atSession: true, close: s[299].close }, extra),
  ];
  const st = C.sessionStates(rows, 1);
  const byT = new Map(st.rows.map((r) => [r.ticker, r]));
  assert.equal(byT.get('BBB').state, null);
  assert.equal(byT.get('BBB').reason, 'not-in-universe');
  assert.equal(byT.get('CCC').state, null);
  assert.equal(st.nStated, 1, 'nur AAA traegt einen Zustand');
});

console.log('\nconfirmation.test.js: ' + pass + ' ok, ' + fail + ' fail');
process.exit(fail ? 1 : 0);

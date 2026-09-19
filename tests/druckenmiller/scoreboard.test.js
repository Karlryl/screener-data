'use strict';
/** tests/druckenmiller/scoreboard.test.js — Standalone-Runner.
 *
 * DIE ZUSICHERUNG: die Eintritts-Regel, die Erstpassage und die Tafel sind genau das, was
 * BUILD-SPEC v1 §0.4 registriert — und die Tafel kann keine Zahl zeigen, die nicht aus
 * einer Lesung kommt. Zwei Tests sind hier die eigentlichen Waechter:
 *   S5  — ohne benannte Barrieren-Skalierung WIRFT die Aufloesung (kein Default, keine
 *         stille Lesung); das ist der offene Rats-Punkt, und er darf nicht durch einen
 *         Default verschwinden.
 *   S12 — die eingefrorenen Felder kommen ausschliesslich aus dem Lesungs-Datensatz, die
 *         Tageszaehler kommen NIE in die eingefrorene Zeile.
 */
const assert = require('node:assert/strict');
const S = require('../../lib/druckenmiller/scoreboard.js');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + (e && e.message)); }
}

const sitzung = (extra) => Object.assign({ date: '2026-09-11', generatedAt: '2026-09-11T22:00:00Z' }, extra || {});
/** <n> Balken mit konstanter Tagesvol, damit sigma63 endlich ist. */
function closes(n, start, step) {
  const out = [];
  for (let i = 0; i < n; i++) out.push((start || 100) * Math.exp((step || 0.001) * i + (i % 2 ? 0.003 : 0)));
  return out;
}
const forward = (from, n, faktor) => {
  const out = [];
  for (let i = 1; i <= n; i++) out.push({ date: 'd' + i, close: from * Math.pow(faktor, i) });
  return out;
};

test('S1 vier Ausschluesse, jeder mit seinem Grund (Residuum 5)', () => {
  assert.equal(S.sessionEligible(sitzung()).eligible, true);
  assert.equal(S.sessionEligible(sitzung({ backfilled: true })).reason, 'backfilled');
  assert.equal(S.sessionEligible(sitzung({ lowFreshness: true })).reason, 'lowFreshness');
  assert.equal(S.sessionEligible(sitzung({ highChurn: true })).reason, 'highChurn');
  assert.equal(S.sessionEligible(sitzung({ raw: true })).reason, 'separation-gate-raw');
  assert.equal(S.sessionEligible(null).eligible, false);
});

test('S2 Wechsel gegen den LETZTEN BEOBACHTETEN Zustand, nicht gegen den Vortag', () => {
  const letzte = new Map([['AAA', 'CONFIRMS'], ['BBB', 'WEAK']]);
  const stated = [
    { ticker: 'AAA', state: 'CONFIRMS', m1: 1, m2: 1 },   // unveraendert -> kein Wechsel
    { ticker: 'BBB', state: 'CONFIRMS', m1: 1, m2: 1 },   // Wechsel
    { ticker: 'CCC', state: 'WEAK', m1: 0, m2: 0 },       // erster Zustand ueberhaupt
    { ticker: 'DDD', state: null, m1: null, m2: null },   // kein Zustand, kein Wechsel
  ];
  const w = S.transitionsFor(letzte, stated);
  assert.deepEqual(w.map((x) => x.ticker).sort(), ['BBB', 'CCC']);
  assert.equal(w.find((x) => x.ticker === 'CCC').from, null, 'ohne Vorzustand ist from null');
});

test('S3 Abkuehlzeit gilt je Arm', () => {
  assert.equal(S.coolOffOver(undefined, 10, 63), true, 'ohne Vor-Eintritt gibt es keine Sperre');
  assert.equal(S.coolOffOver(10, 72, 63), false, '62 Sitzungen sind zu wenig');
  assert.equal(S.coolOffOver(10, 73, 63), true, '63 Sitzungen reichen');
  assert.equal(S.coolOffOver(10, 73, 126), false, 'der 126-Arm sperrt laenger');
});

test('S4 Eintraege: je Arm eine Zeile, warmup markiert, NEUTRAL wird nicht gewertet', () => {
  const c = new Map([['AAA', closes(200)], ['BBB', closes(200)], ['CCC', closes(10)]]);
  const r = S.buildEntries({
    session: sitzung(), stated: [
      { ticker: 'AAA', state: 'CONFIRMS', m1: 2, m2: 1 },
      { ticker: 'BBB', state: 'NEUTRAL', m1: 0, m2: 0.9 },
      { ticker: 'CCC', state: 'WEAK', m1: -2, m2: 0.5 },
    ],
    lastStates: new Map(), lastEntryIndex: new Map(), sessionIndex: 500, closesByTicker: c, warmup: true,
  });
  assert.deepEqual(r.rows.map((x) => x.ticker + ':' + x.arm), ['AAA:63', 'AAA:126'], 'nur AAA hat Zustand UND sigma');
  assert.equal(r.rows.every((x) => x.warmup === true), true);
  assert.equal(r.rows[0].kind, 'ENTRY');
  assert.ok(r.rows[0].sigma63 > 0);
  assert.equal(r.transitions, 2, 'NEUTRAL zaehlt als Wechsel, wird aber nicht gewertet');
  const gesperrt = S.buildEntries({
    session: sitzung({ highChurn: true }), stated: [{ ticker: 'AAA', state: 'CONFIRMS', m1: 2, m2: 1 }],
    lastStates: new Map(), lastEntryIndex: new Map(), sessionIndex: 500, closesByTicker: c, warmup: false,
  });
  assert.deepEqual(gesperrt.rows, [], 'eine highChurn-Sitzung schreibt keinen Eintrag');
  assert.equal(gesperrt.skipped, 'highChurn');
});

test('S5 ohne benannte Barrieren-Skalierung wird geworfen — kein Default', () => {
  const e = { ticker: 'AAA', date: '2026-09-11', arm: 63, k: 1, sigma63: 0.02, entryClose: 100 };
  assert.throws(() => S.resolveEntry(e, forward(100, 63, 1.0), undefined), /Barrieren-Skalierung fehlt/);
  assert.throws(() => S.resolveEntry(e, forward(100, 63, 1.0), 'annualized'), /Barrieren-Skalierung fehlt/);
  // Und die beiden Lesungen sind messbar verschieden: dieselbe Bewegung loest unter
  // 'daily' auf und unter 'horizon' nicht.
  const lauf = forward(100, 63, 1.0008);              // +0,08 % je Balken
  assert.equal(S.resolveEntry(e, lauf, 'daily').outcome, 'UP');
  assert.equal(S.resolveEntry(e, lauf, 'horizon').outcome, 'CENSORED');
});

test('S6 Erstpassage: UP, DOWN, zensiert, offen', () => {
  const e = { ticker: 'AAA', date: '2026-09-11', arm: 10, k: 1, sigma63: 0.02, entryClose: 100 };
  assert.equal(S.resolveEntry(e, forward(100, 10, 1.01), 'daily').outcome, 'UP');
  assert.equal(S.resolveEntry(e, forward(100, 10, 0.99), 'daily').outcome, 'DOWN');
  const flach = S.resolveEntry(e, forward(100, 10, 1.0), 'daily');
  assert.equal(flach.outcome, 'CENSORED', 'am Horizont nicht erreicht = zensiert');
  assert.equal(flach.bars, 10);
  const offen = S.resolveEntry(e, forward(100, 4, 1.0), 'daily');
  assert.equal(offen.outcome, null, 'weniger Balken als der Horizont = noch offen, nicht zensiert');
  const ersterBalken = S.resolveEntry(e, forward(100, 10, 1.05), 'daily');
  assert.equal(ersterBalken.bars, 1);
  const rz = S.resolutionRow(Object.assign({ warmup: true }, e), ersterBalken, '2026-09-12T00:00:00Z');
  assert.equal(rz.kind, 'RESOLUTION');
  assert.equal(rz.entryId, 'AAA|2026-09-11|10');
  assert.equal(rz.warmup, true);
});

test('S7 Bloecke sind nicht ueberlappend und auf dem Sitzungs-Raster', () => {
  const sessions = [];
  for (let i = 0; i < 200; i++) sessions.push('s' + i);
  assert.equal(S.blockCount(['s0', 's1', 's62'], sessions, 63), 1, 'alles im ersten Block');
  assert.equal(S.blockCount(['s0', 's63'], sessions, 63), 2);
  assert.equal(S.blockCount(['s0', 's63', 's126'], sessions, 63), 3);
  assert.equal(S.blockCount(['s0', 's63'], sessions, 126), 1, 'im 126-Arm ist das ein Block');
  assert.equal(S.blockCount([], sessions, 63), 0);
  assert.equal(S.blockCount(['fremd'], sessions, 63), 0, 'ein Datum ausserhalb der Reihe zaehlt nicht');
});

test('S8 die vier Etiketten, an den Kanten geprueft', () => {
  assert.equal(S.labelFor(-1).id, 1);
  assert.equal(S.labelFor(0).id, 1, 'L = 0 ist NICHT belegt');
  assert.equal(S.labelFor(0.1).id, 2);
  assert.equal(S.labelFor(2.99).id, 2);
  assert.equal(S.labelFor(3).id, 3, 'genau auf der Wissenslatte');
  assert.equal(S.labelFor(4.99).id, 3);
  assert.equal(S.labelFor(5).id, 4, 'genau auf der Handelsschwelle');
  assert.equal(S.labelFor(null).text, S.LABEL_NOT_READABLE);
  assert.equal(S.LABELS[3].text, 'belegt, Handelsschwelle (5 pp) erreicht');
});

test('S9 beide alpha*-Literale (Residuum 1)', () => {
  assert.equal(S.alphaStarFor(2), 0.0083);
  assert.equal(S.alphaStarFor(1), 0.0167);
  assert.ok(Math.abs(S.ALPHA_READ - 0.05 / 3) < 1e-12);
  assert.equal(S.BETA, 0.2);
});

test('S10 Stilllegung (i)-(iv) plus Sunset, und nie bei R1', () => {
  assert.equal(S.retirementDecision({ readId: 'R1', blocksReached: true, L: -5, mde: 1 }).retire, false);
  assert.equal(S.retirementDecision({ readId: 'R2', blocksReached: false, L: null, mde: null }).branch, 'i');
  assert.equal(S.retirementDecision({ readId: 'R3', blocksReached: false, L: null, mde: null }).branch, 'sunset');
  assert.equal(S.retirementDecision({ readId: 'R3', blocksReached: false, L: null, mde: null }).retire, true);
  assert.equal(S.retirementDecision({ readId: 'R2', blocksReached: true, L: 0, mde: 5 }).branch, 'ii');
  assert.equal(S.retirementDecision({ readId: 'R2', blocksReached: true, L: 1, mde: 7 }).branch, 'iii');
  assert.equal(S.retirementDecision({ readId: 'R2', blocksReached: true, L: 4, mde: 7 }).branch, 'iv');
  assert.equal(S.retirementDecision({ readId: 'R2', blocksReached: true, L: 1, mde: 5 }).branch, 'iv',
    'L in (0,3) mit MDE <= 6 bleibt — das ist der Zweig, der am leichtesten falsch stillgelegt wuerde');
});

test('S11 Lese-Plan und nextReadDate (Residuum 8)', () => {
  const p = S.readSchedule('2026-09-19', null);
  assert.equal(p.R2, '2028-09-30');
  assert.equal(p.R3, '2029-09-30');
  assert.equal(p.R1, null, 'ohne erfuellte Vorbedingung ist R1 noch nicht gesetzt');
  const q = S.readSchedule('2026-09-19', '2027-11-30');
  assert.equal(q.R1, '2027-11-30');
  const spaet = S.readSchedule('2026-09-19', '2028-12-31');
  assert.equal(spaet.R1, null, 'liegt R1 hinter R2, entfaellt R1');
  assert.equal(S.nextReadDate(p, 'R3'), null, 'nach R3 gibt es kein naechstes Lesedatum');
  assert.equal(S.nextReadDate(p, 'R2'), p.R3);
  assert.equal(S.nextReadDate(q, 'R1'), q.R2);
});

test('S12 die Tafel: eingefroren nur aus der Lesung, Zaehler nie eingefroren', () => {
  const plan = S.readSchedule('2026-09-19', '2027-11-30');
  const lesung = {
    readId: 'R1', readDate: '2027-11-30', label: 'Effekt belegt, unter Wissenslatte (3 pp)',
    L: 1.4, MDE: 5.2, level: 0.0083, L126: 0.9, MDE126: 6.1, level126: 0.0083,
  };
  const t = S.panelDisplay(lesung, { entries: 412, resolved: 388, blocks: 9, lastSessionDate: '2028-01-14' }, plan);
  assert.deepEqual(Object.keys(t.frozen).sort(), S.PANEL_FROZEN_FIELDS.slice().sort());
  assert.deepEqual(Object.keys(t.live).sort(), S.PANEL_LIVE_FIELDS.slice().sort());
  assert.equal(t.frozen.nextReadDate, plan.R2);
  assert.equal(t.frozen.L126, 0.9, 'Residuum 3: der 126-Arm friert mit demselben Stempel');
  assert.equal(t.frozen.entries, undefined, 'ein Zaehler hat in der eingefrorenen Zeile nichts zu suchen');
  assert.ok(t.stamp.indexOf('Stand: Read R1 vom 2027-11-30') === 0);
  assert.ok(t.multiplicityNote.indexOf('Artefakt der Mehrfachtestung') > 0, 'Residuum 2: der feste Satz steht da');
  const vorR1 = S.panelDisplay(null, { entries: 3, resolved: 0, blocks: 0, lastSessionDate: '2026-10-01' }, plan);
  assert.equal(vorR1.frozen.label, S.LABEL_NOT_READABLE);
  assert.equal(vorR1.frozen.L, null, 'vor der ersten Lesung gibt es kein L');
  assert.equal(vorR1.live.entries, 3);
  // Zwischen den Lesungen: die Zaehler laufen, der eingefrorene Satz bleibt Wort fuer Wort.
  const spaeter = S.panelDisplay(lesung, { entries: 500, resolved: 470, blocks: 11, lastSessionDate: '2028-06-30' }, plan);
  assert.deepEqual(spaeter.frozen, t.frozen, 'die eingefrorene Zeile aendert sich zwischen Lesungen nicht');
  assert.notDeepEqual(spaeter.live, t.live);
});

console.log('\nscoreboard.test.js: ' + pass + ' ok, ' + fail + ' fail');
process.exit(fail ? 1 : 0);

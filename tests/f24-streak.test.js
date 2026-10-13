'use strict';
/** tests/f24-streak.test.js — Standalone-Runner: node tests/f24-streak.test.js */
const assert = require('node:assert/strict');
const {
  calculateStreak,
  formatLine,
  latestDuePlannedDay,
} = require('../scripts/f24-streak.js');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (err) { fail++; console.error('FAIL   ' + name + '\n       ' + err.message); }
}

function run(day, event = 'schedule', conclusion = 'success') {
  return {
    event,
    conclusion,
    status: 'completed',
    createdAt: day + 'T03:00:00Z',
  };
}

test('Luecke an planmaessigem Lauftag setzt Serie auf 0', () => {
  const result = calculateStreak({
    boardDates: ['2026-08-06', '2026-08-07'],
    runs: [run('2026-08-06'), run('2026-08-07')],
    asOf: '2026-08-08T12:00:00Z',
  });
  assert.deepEqual(result, { streak: 0, ziel: 14, tage: [] });
});

test('workflow_dispatch zaehlt trotz Erfolg und Board nicht als sauber', () => {
  const result = calculateStreak({
    boardDates: ['2026-08-08'],
    runs: [run('2026-08-08', 'workflow_dispatch')],
    asOf: '2026-08-08T12:00:00Z',
  });
  assert.deepEqual(result, { streak: 0, ziel: 14, tage: [] });
});

test('Sonntag und Montag unterbrechen die Serie nicht', () => {
  const boardDates = ['2026-08-06', '2026-08-07', '2026-08-08'];
  const runs = boardDates.map((day) => run(day));
  const expected = { streak: 3, ziel: 14, tage: boardDates };
  assert.deepEqual(calculateStreak({ boardDates, runs, asOf: '2026-08-09T12:00:00Z' }), expected);
  assert.deepEqual(calculateStreak({ boardDates, runs, asOf: '2026-08-10T12:00:00Z' }), expected);
});

test('erfolgreicher Schedule-Lauf ohne committetes Board zaehlt nicht', () => {
  const result = calculateStreak({
    boardDates: [],
    runs: [run('2026-08-08')],
    asOf: '2026-08-08T12:00:00Z',
  });
  assert.equal(result.streak, 0);
});

test('vor dem Cron am Lauftag ist der vorige Plan-Tag faellig', () => {
  assert.equal(latestDuePlannedDay('2026-08-11T02:16:00Z'), '2026-08-08');
  assert.equal(latestDuePlannedDay('2026-08-11T02:17:00Z'), '2026-08-11');
});

test('bei Zielerreichung meldet die Anzeige die erfuellte Zaehl-Bedingung - und dass die Sperre bleibt', () => {
  assert.match(formatLine({ streak: 14, ziel: 14, tage: [] }), /Zaehl-Bedingung fuer F-16 erfuellt/);
  assert.doesNotMatch(formatLine({ streak: 13, ziel: 14, tage: [] }), /F-16/);
  // Die Anzeige darf die Sperre nie als aufgehoben lesen lassen: der Satz muss beides
  // tragen - erfuellte Zaehlung UND fortbestehende Sperre. Der alte Wortlaut ("Kette kann
  // fortgesetzt werden") sagte genau das Gegenteil und stand bis zur Landung im Skript.
  assert.match(formatLine({ streak: 14, ziel: 14, tage: [] }), /Sperre bleibt/);
});

console.log(`\nf24-streak.test.js: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);

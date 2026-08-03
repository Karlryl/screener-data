// Geschwister-Fund (Runde-4-Verifier, selbe T2-Klasse wie watch-exchange-coverage.js):
// watch-fx-sanity.js's checkJump() always reads baseline.last as "yesterday's" counts.
// updateBaseline() unconditionally shifted today's counts into .last on every run —
// so a SAME-DAY rerun (retry, manual re-run) overwrote .last with an intraday value
// instead of pinning it to the last distinct calendar day. The .prev field this
// evicted the old .last into is never read by checkJump — a dead end, not a save.
// Net effect: the next comparison is silently intraday-vs-intraday instead of
// day-over-day, which can both mask a real cross-day jump and manufacture a false
// alarm against a stale intraday reading.
//
// Run: node tests/watch-fx-sanity-samedayrerun.test.js   (Exit 0/1)
'use strict';
const assert = require('node:assert/strict');
const { updateBaseline, checkJump } = require('../scripts/watch-fx-sanity.js');

let fail = 0;
function check(name, fn) {
  try { fn(); console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); }
}

check('first-ever run seeds the baseline (control, no regression)', () => {
  const next = updateBaseline(null, { usOver: 100, foreignOver: 50 }, '2026-07-18');
  assert.deepEqual(next.last, { usOver: 100, foreignOver: 50 });
  assert.equal(next.prev, null);
  assert.equal(next.date, '2026-07-18');
});

check('a NEW calendar day advances the pointer normally (control, no regression)', () => {
  const day1 = updateBaseline(null, { usOver: 100, foreignOver: 50 }, '2026-07-18');
  const day2 = updateBaseline(day1, { usOver: 102, foreignOver: 51 }, '2026-07-19');
  assert.deepEqual(day2.prev, { usOver: 100, foreignOver: 50 });
  assert.deepEqual(day2.last, { usOver: 102, foreignOver: 51 });
  assert.equal(day2.date, '2026-07-19');
});

check('SAME-DAY rerun takes the latest reading into .last but does NOT shift .prev', () => {
  const day1 = updateBaseline(null, { usOver: 100, foreignOver: 50 }, '2026-07-18');
  // A same-day rerun is normally a CORRECTION of the first run — its value becomes the
  // reference, while .prev stays anchored to the true prior day (here: none yet).
  const rerun = updateBaseline(day1, { usOver: 102, foreignOver: 51 }, '2026-07-18');
  assert.deepEqual(rerun.last, { usOver: 102, foreignOver: 51 },
    '.last must reflect the latest same-day (corrected) reading: ' + JSON.stringify(rerun.last));
  assert.equal(rerun.prev, null,
    '.prev must NOT be shifted by a same-day rerun (stays the true prior day)');
  assert.equal(rerun.date, '2026-07-18');
});

// Review-Befund 03.08.2026 (MITTEL): die Baseline-Reinheit hing am AUFRUFER. main() projiziert
// heute auf die zwei Zaehlstaende, der same-day-rerun-Zweig von updateBaseline nahm `today`
// aber UNVERAENDERT. Genau so kamen Tag 520-522 gescannt/parseFehler in die Datei; mit dem
// gemeinsamen Scan (Tag 529) waere jetzt zusaetzlich die Waehrungs-Tabelle mitgewandert.
// Der Waechter steht deshalb hier, am Entstehungsort: die Funktion selbst haelt die Baseline
// bei dem, was checkJump liest — egal was ein Aufrufer hineinreicht.
check('same-day rerun schreibt NUR die zwei Zaehlstaende in .last (Feld-Allowlist IN der Funktion)', () => {
  const day1 = updateBaseline(null, { usOver: 100, foreignOver: 50 }, '2026-07-18');
  const verschmutzt = { usOver: 102, foreignOver: 51, gescannt: 4768, parseFehler: 2, n: 7, jeWaehrung: { INR: 3 } };
  const rerun = updateBaseline(day1, verschmutzt, '2026-07-18');
  assert.deepEqual(Object.keys(rerun.last).sort(), ['foreignOver', 'usOver'],
    '.last darf nur die zwei Zaehlstaende tragen, hat aber: ' + JSON.stringify(rerun.last));
  assert.deepEqual(rerun.last, { usOver: 102, foreignOver: 51 });
});

check('NEUER Tag schreibt ebenfalls nur die zwei Zaehlstaende (Gegenstueck, kein Regress)', () => {
  const day1 = updateBaseline(null, { usOver: 100, foreignOver: 50 }, '2026-07-18');
  const day2 = updateBaseline(day1, { usOver: 102, foreignOver: 51, gescannt: 4768, parseFehler: 2 }, '2026-07-19');
  assert.deepEqual(Object.keys(day2.last).sort(), ['foreignOver', 'usOver'],
    '.last darf nur die zwei Zaehlstaende tragen, hat aber: ' + JSON.stringify(day2.last));
});

check('end-to-end: a CORRECTED same-day rerun becomes the reference (no false alarm next day)', () => {
  // Day 1 first run glitched high (145); a same-day rerun corrects it to 100.
  const day1 = updateBaseline(null, { usOver: 145, foreignOver: 50 }, '2026-07-18');
  const rerun = updateBaseline(day1, { usOver: 100, foreignOver: 50 }, '2026-07-18');
  // Day 2: normal ~2% move off the CORRECTED prior day (100) — must be quiet, because the
  // corrected rerun value (not the glitched first reading) is now the reference.
  const problems = checkJump({ usOver: 102, foreignOver: 50 }, rerun);
  assert.deepEqual(problems, [],
    'the corrected rerun value must be the reference, not the glitched first reading. ' +
    'problems=' + JSON.stringify(problems));
});

console.log(fail ? `\nwatch-fx-sanity-samedayrerun: ${fail} FAILED` : '\nwatch-fx-sanity-samedayrerun: all passed');
process.exit(fail ? 1 : 0);

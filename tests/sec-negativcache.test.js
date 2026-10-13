'use strict';
/**
 * Waechter fuer den Negativ-Cache im SEC-Pull (29.07.).
 *
 * Die SACHE: CIKs, die keine companyfacts haben, sollen nicht jeden Monat erneut
 * angefragt werden — aber auch nicht FÜR IMMER verstummen. Beides wird geprueft:
 * die Sperre muss greifen UND sie muss wieder aufgehen. Ein Test, der nur das
 * Greifen prueft, wuerde eine Dauersperre durchwinken.
 *
 * Usage: node tests/sec-negativcache.test.js   (Exit 0/1)
 */
const assert = require('node:assert/strict');
const { istNegativGesperrt, NOTFOUND_STREAK, NOTFOUND_PAUSE_DAYS } = require('../pull-sec-xbrl.js');

let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); }
}

const jetzt = new Date('2026-07-29T00:00:00Z');
const vorTagen = (n) => new Date(jetzt.getTime() - n * 86400000).toISOString();

check('ein einzelner 404 sperrt NICHT — der kann eine Stoerung sein', () => {
  assert.equal(istNegativGesperrt({ notFoundStreak: 1, lastNotFoundAt: vorTagen(1) }, jetzt), false);
  assert.equal(istNegativGesperrt({ notFoundStreak: NOTFOUND_STREAK - 1, lastNotFoundAt: vorTagen(1) }, jetzt), false);
});

check('ab der dritten 404 in Folge wird pausiert', () => {
  assert.equal(istNegativGesperrt({ notFoundStreak: NOTFOUND_STREAK, lastNotFoundAt: vorTagen(1) }, jetzt), true);
  assert.equal(istNegativGesperrt({ notFoundStreak: 12, lastNotFoundAt: vorTagen(30) }, jetzt), true);
});

check('die Sperre geht wieder auf — kein Dauer-Blackout', () => {
  assert.equal(
    istNegativGesperrt({ notFoundStreak: 12, lastNotFoundAt: vorTagen(NOTFOUND_PAUSE_DAYS + 1) }, jetzt),
    false,
    'nach Ablauf der Pause MUSS wieder gefragt werden — eine Firma kann anfangen zu berichten',
  );
});

check('ohne brauchbares Datum wird nicht gesperrt (fail open Richtung Anfrage)', () => {
  assert.equal(istNegativGesperrt({ notFoundStreak: 99 }, jetzt), false);
  assert.equal(istNegativGesperrt({ notFoundStreak: 99, lastNotFoundAt: 'Quatsch' }, jetzt), false);
});

check('unbekannter oder frischer Eintrag wird nie gesperrt', () => {
  assert.equal(istNegativGesperrt(null, jetzt), false);
  assert.equal(istNegativGesperrt(undefined, jetzt), false);
  assert.equal(istNegativGesperrt({}, jetzt), false);
  assert.equal(istNegativGesperrt({ fetchedAt: vorTagen(1), bytes: 12345 }, jetzt), false);
});

console.log('\nsec-negativcache: ' + pass + ' ok, ' + fail + ' fail');
process.exit(fail ? 1 : 0);

'use strict';

// R6 — Zeitpunkt-Ehrlichkeit (PIT) mit Vintage-Regel.
//
// Die SACHE: der Speicher fuehrt je Quartal mehrere Beobachtungs-Staende (2018, 2021,
// 2025). Fuer ein Signal von 2012 zaehlt nur, was 2012 schon existierte. Ein Stand aus
// der Zukunft ist die Kernbehauptung der Studie gebrochen, kein Rundungsfehler — und
// wenn KEIN Stand alt genug ist, lautet das Ergebnis NICHT BERECHENBAR, nicht "nimm
// halt den naechsten".

const assert = require('node:assert/strict');
const test = require('node:test');

const { waehleStand, stempleZeile, VerfassungsBruch } = require('../lib/studie-verfassung');

const STAENDE = [
  { standId: '2018-vintage', beobachtetAm: '2018-03-28T07:41:26.000Z' },
  { standId: '2021-vintage', beobachtetAm: '2021-03-20T17:10:21.000Z' },
  { standId: '2025-vintage', beobachtetAm: '2025-02-01T04:11:05.000Z' },
];

test('R6: es gewinnt der juengste Stand, der zum Signal-Zeitpunkt schon existierte', () => {
  assert.equal(waehleStand(STAENDE, '2019-06-30T00:00:00.000Z').standId, '2018-vintage');
  assert.equal(waehleStand(STAENDE, '2023-06-30T00:00:00.000Z').standId, '2021-vintage');
  assert.equal(waehleStand(STAENDE, '2026-06-30T00:00:00.000Z').standId, '2025-vintage');
});

test('R6: ein Stand aus der Zukunft wird nie gewaehlt', () => {
  const gewaehlt = waehleStand(STAENDE, '2021-03-20T17:10:20.000Z');
  assert.equal(gewaehlt.standId, '2018-vintage', 'Eine Sekunde vor Veroeffentlichung ist der Stand noch nicht da');
});

test('R6: gar kein alter Stand heisst NICHT BERECHENBAR, nicht Notnagel', () => {
  assert.throws(
    () => waehleStand(STAENDE, '2012-01-01T00:00:00.000Z'),
    (fehler) => fehler instanceof VerfassungsBruch && /NICHT BERECHENBAR/.test(fehler.message),
  );
  assert.throws(() => waehleStand([], '2020-01-01T00:00:00.000Z'), VerfassungsBruch);
});

test('R6: unlesbare Zeitstempel werden nicht stillschweigend geschluckt', () => {
  assert.throws(() => waehleStand(STAENDE, 'irgendwann'), VerfassungsBruch);
  assert.throws(
    () => waehleStand([{ standId: 'kaputt', beobachtetAm: 'gestern' }], '2020-01-01T00:00:00.000Z'),
    VerfassungsBruch,
  );
});

test('R6: jede Datenzeile traegt die Stand-Kennung mit', () => {
  const stand = waehleStand(STAENDE, '2019-06-30T00:00:00.000Z');
  const zeile = stempleZeile({ cik: 320193, quartal: '2012q1', umsatz: 39186000000 }, stand);
  assert.equal(zeile.standId, '2018-vintage');
  assert.equal(zeile.standBeobachtetAm, stand.beobachtetAm);
  assert.equal(zeile.cik, 320193, 'Der Stempel darf die Zeile nicht veraendern, nur ergaenzen');
  assert.throws(() => stempleZeile({ cik: 1 }, null), VerfassungsBruch);
  assert.throws(() => stempleZeile({ cik: 1 }, { beobachtetAm: '2018-01-01T00:00:00.000Z' }), VerfassungsBruch);
});

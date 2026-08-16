'use strict';

// R4 — Ergebnis-Sperre und Einmal-Oeffnung.
//
// Die SACHE: Ergebnisdaten (Kurse, Renditen, Etiketten) sind fuer einen Lauf gesperrt,
// der sich nicht VORHER unter seiner eigenen laufId im Zugriffs-Register angemeldet
// hat — und jeder Lauf muss hinterher sagen koennen, ob er sie beruehrt hat. Ein
// fremder Register-Eintrag darf den eigenen Lauf nicht freischalten.

const assert = require('node:assert/strict');
const test = require('node:test');

const { starteLauf, haengeEintragAn, ladeRegelwerk, VerfassungsBruch } = require('../lib/studie-verfassung');

const regelwerk = ladeRegelwerk();

function registerMit(runIds) {
  let register = {
    schema: 'early-detection-outcome-access-ledger/v2',
    genesisSha256: 'a'.repeat(64),
    events: [],
  };
  for (const runId of runIds) {
    register = haengeEintragAn(register, {
      type: 'confirmatory_execution_authorized',
      runId,
      registeredAt: '2026-09-01T10:00:00.000Z',
      accessedAt: '2026-09-01T10:05:00.000Z',
    });
  }
  return register;
}

test('R4: ein nicht angemeldeter Lauf kommt an keine Ergebnisdaten', () => {
  const lauf = starteLauf({ laufId: 'lauf-x', modus: 'validierung', register: registerMit([]), regelwerk });
  assert.throws(
    () => lauf.leseErgebnisdaten('forward_return_12m'),
    (fehler) => fehler instanceof VerfassungsBruch && /ohne im Zugriffs-Register angemeldet/.test(fehler.message),
  );
  assert.equal(lauf.protokoll().ergebnisdatenBeruehrt, false);
});

test('R4: ein fremder Register-Eintrag schaltet den eigenen Lauf nicht frei', () => {
  const lauf = starteLauf({ laufId: 'lauf-x', modus: 'validierung', register: registerMit(['lauf-y']), regelwerk });
  assert.throws(() => lauf.leseErgebnisdaten('forward_return_12m'), VerfassungsBruch);
});

test('R4: der angemeldete Lauf darf lesen und protokolliert die Beruehrung', () => {
  const lauf = starteLauf({ laufId: 'lauf-x', modus: 'validierung', register: registerMit(['lauf-x']), regelwerk });
  assert.equal(lauf.protokoll().ergebnisdatenBeruehrt, false);
  assert.equal(lauf.leseErgebnisdaten('forward_return_12m'), true);
  const protokoll = lauf.protokoll();
  assert.equal(protokoll.ergebnisdatenBeruehrt, true);
  assert.deepEqual(protokoll.geleseneEndpunkte, ['forward_return_12m']);
  assert.equal(protokoll.regelwerkVersion, regelwerk.version);
});

test('R4: Signaldaten bleiben an die Fenster-Mauer gebunden, auch im angemeldeten Lauf', () => {
  const lauf = starteLauf({ laufId: 'lauf-x', modus: 'entdeckung', register: registerMit(['lauf-x']), regelwerk });
  assert.equal(lauf.leseSignaldaten('2012q2'), true);
  assert.throws(() => lauf.leseSignaldaten('2022q2'), VerfassungsBruch);
});

test('R4: ein Lauf ohne laufId existiert nicht', () => {
  assert.throws(() => starteLauf({ modus: 'entdeckung', regelwerk }), VerfassungsBruch);
});

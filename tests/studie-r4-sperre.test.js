'use strict';

// R4 — Ergebnis-Sperre und Einmal-Oeffnung.
//
// Die SACHE: Ergebnisdaten (Kurse, Renditen, Etiketten) sind fuer einen Lauf gesperrt,
// der sich nicht VORHER unter seiner eigenen laufId im Zugriffs-Register angemeldet
// hat — und jeder Lauf muss hinterher sagen koennen, ob er sie beruehrt hat. Ein
// fremder Register-Eintrag darf den eigenen Lauf nicht freischalten.

const assert = require('node:assert/strict');
const test = require('node:test');

// ANMERKUNG E3 (2026-08-19): Der Beispiel-Endpunkt hiess bis hierher
// `forward_return_12m`. Seit die Endpunkt-Klassen-Sperre scharf ist, ist genau dieser
// Name kategorisch verboten (Klasse "return") — der Test waere an der falschen Stelle
// rot geworden und haette so ausgesehen, als sei die Anmeldungs-Pruefung kaputt.
// Geaendert wurde deshalb NUR das Beispiel, nicht die gepruefte Sache: hier steht die
// Anmeldungs-Pruefung, die Klassen-Sperre steht in tests/studie-e3-praereg.test.js (W5).

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
    () => lauf.leseErgebnisdaten('folgequartal_umsatz_wachstum'),
    (fehler) => fehler instanceof VerfassungsBruch && /ohne im Zugriffs-Register angemeldet/.test(fehler.message),
  );
  assert.equal(lauf.protokoll().ergebnisdatenBeruehrt, false);
});

test('R4: ein fremder Register-Eintrag schaltet den eigenen Lauf nicht frei', () => {
  const lauf = starteLauf({ laufId: 'lauf-x', modus: 'validierung', register: registerMit(['lauf-y']), regelwerk });
  assert.throws(() => lauf.leseErgebnisdaten('folgequartal_umsatz_wachstum'), VerfassungsBruch);
});

test('R4: der angemeldete Lauf darf lesen und protokolliert die Beruehrung', () => {
  const lauf = starteLauf({ laufId: 'lauf-x', modus: 'validierung', register: registerMit(['lauf-x']), regelwerk });
  assert.equal(lauf.protokoll().ergebnisdatenBeruehrt, false);
  assert.equal(lauf.leseErgebnisdaten('folgequartal_umsatz_wachstum'), true);
  const protokoll = lauf.protokoll();
  assert.equal(protokoll.ergebnisdatenBeruehrt, true);
  assert.deepEqual(protokoll.geleseneEndpunkte, ['folgequartal_umsatz_wachstum']);
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

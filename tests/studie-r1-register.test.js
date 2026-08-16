'use strict';

// R1 — Erst festschreiben, dann messen.
//
// Die SACHE: das Zugriffs-Register ist eine KETTE mit Vorab-Anmeldung, kein Logbuch.
// Wer einen Eintrag nachtraeglich aendert, einen Eintrag herausschneidet oder erst
// nach dem Zugriff anmeldet, muss auffliegen. Geprueft wird deshalb beides: eine
// gueltige Kette muss DURCHGEHEN, jede der vier Manipulationen muss rot werden.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  pruefeZugriffsRegister,
  haengeEintragAn,
  VerfassungsBruch,
} = require('../lib/studie-verfassung');

const LEDGER = path.join(__dirname, '..', 'protocol', 'early-detection', '2.0.0', 'outcome-access-ledger.json');

function frischesRegister() {
  return JSON.parse(fs.readFileSync(LEDGER, 'utf8'));
}

function beispielEintrag(runId, versatzMinuten = 5) {
  const angemeldet = new Date('2026-09-01T10:00:00.000Z');
  const zugegriffen = new Date(angemeldet.getTime() + versatzMinuten * 60000);
  return {
    type: 'confirmatory_execution_authorized',
    runId,
    registeredAt: angemeldet.toISOString(),
    accessedAt: zugegriffen.toISOString(),
    inputSha256: 'f'.repeat(64),
  };
}

test('R1: das ausgelieferte Register ist eine gueltige, leere Kette', () => {
  const register = frischesRegister();
  assert.equal(register.protocol, 'FEM-SEC-US@2.0.0');
  assert.equal(register.events.length, 0, 'E0 startet ohne Ergebnis-Zugriff');
  const ergebnis = pruefeZugriffsRegister(register);
  assert.equal(ergebnis.eventCount, 0);
  assert.equal(ergebnis.tailHash, register.genesisSha256);
});

test('R1: eine gueltige Kette aus zwei Eintraegen geht durch', () => {
  let register = frischesRegister();
  register = haengeEintragAn(register, beispielEintrag('lauf-1'));
  register = haengeEintragAn(register, beispielEintrag('lauf-2'));
  const ergebnis = pruefeZugriffsRegister(register);
  assert.equal(ergebnis.eventCount, 2);
  assert.equal(register.events[1].previousHash, register.events[0].eventHash);
});

test('R1: nachtraeglich veraenderter Eintrag fliegt auf', () => {
  let register = frischesRegister();
  register = haengeEintragAn(register, beispielEintrag('lauf-1'));
  register.events[0].inputSha256 = '0'.repeat(64);
  assert.throws(() => pruefeZugriffsRegister(register), VerfassungsBruch);
});

test('R1: herausgeschnittener Eintrag bricht die Kette', () => {
  let register = frischesRegister();
  register = haengeEintragAn(register, beispielEintrag('lauf-1'));
  register = haengeEintragAn(register, beispielEintrag('lauf-2'));
  register.events.splice(0, 1);
  assert.throws(() => pruefeZugriffsRegister(register), VerfassungsBruch);
});

test('R1: Anmeldung NACH dem Zugriff ist kein Register, sondern ein Alibi', () => {
  let register = frischesRegister();
  register = haengeEintragAn(register, beispielEintrag('lauf-1', -5));
  assert.throws(
    () => pruefeZugriffsRegister(register),
    (fehler) => fehler instanceof VerfassungsBruch && /nicht VOR dem Zugriff/.test(fehler.message),
  );
});

test('R1: Register ohne Genesis-Hash ist nicht verkettbar', () => {
  const register = frischesRegister();
  delete register.genesisSha256;
  assert.throws(() => pruefeZugriffsRegister(register), VerfassungsBruch);
});

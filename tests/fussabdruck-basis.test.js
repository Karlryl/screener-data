'use strict';
/**
 * Waechter zum Basis-Fixture und zur anteiligen Kennzahl (Gerichtsauflage 3 vom 23.08.).
 *
 * Zwei toedliche Punkte des Urteils haengen hier:
 *   K6 - ohne eingechecktes Substrat haette das Gate im PR-Check nichts zu vergleichen, und
 *        zusammen mit "Skip != Pass" erzeugte der Regelbetrieb rote Laeufe.
 *   K5 - eine ABSOLUTE Zeilenzahl waechst mit dem Universum; dieselbe anteilige Wirkung ergaebe
 *        morgen eine andere Zahl und liesse eine unveraenderte Deklaration rot werden.
 *
 * Beide Pruefungen laufen IMMER: die Kennzahl-Pruefungen sind hermetisch, die Fixture-Pruefung
 * liest eine eingecheckte Datei und braucht kein Snapshot-Verzeichnis. Genau das war der Punkt.
 *
 * Usage:  node --test tests/fussabdruck-basis.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { fussabdruck } = require('../scripts/fussabdruck.js');

const FIXTURE = path.join(__dirname, 'fixtures', 'fussabdruck-basis.json');

// --- K6: das Substrat ist da und taugt --------------------------------------------------

test('das Basis-Fixture ist eingecheckt und braucht kein Snapshot-Verzeichnis', () => {
  assert.ok(fs.existsSync(FIXTURE),
    'tests/fixtures/fussabdruck-basis.json fehlt. Ohne eingechecktes Substrat hat das Gate im '
    + 'PR-Check nichts zu vergleichen - genau der toedliche Punkt K6 des Urteils vom 23.08.');
  const f = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  assert.equal(f.schema, 'fussabdruck-basis/v1', 'unbekanntes Fixture-Schema');
  assert.ok(f.linealHash && f.linealHash.length >= 8, 'kein Lineal-Hash - dann misst der Vergleich Lineal statt Code');
  assert.ok(Object.keys(f.zeilen).length >= 1000,
    `nur ${Object.keys(f.zeilen).length} Zeilen im Fixture - zu duenn fuer eine Fussabdruck-Aussage`);
});

test('jede Fixture-Zeile traegt Score UND stabilen Eingangs-Hash', () => {
  const f = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  const kaputt = [];
  for (const [t, v] of Object.entries(f.zeilen)) {
    if (!Array.isArray(v) || v.length !== 2) { kaputt.push(t); continue; }
    if (typeof v[0] !== 'number' && v[0] !== null) kaputt.push(t);
    else if (typeof v[1] !== 'string' || v[1].length < 8) kaputt.push(t);
    if (kaputt.length > 5) break;
  }
  assert.deepEqual(kaputt, [],
    `Fixture-Zeilen ohne Score oder ohne Eingangs-Hash: ${kaputt.join(', ')}. Ohne den Hash kann `
    + 'das Gate Code-Wirkung nicht von Daten-Drift trennen.');
});

test('das Fixture bleibt klein genug fuer das Repo', () => {
  const kb = fs.statSync(FIXTURE).size / 1024;
  assert.ok(kb < 1024, `Fixture ist auf ${kb.toFixed(0)} KB gewachsen - dann gehoert es nicht mehr ins Repo`);
});

// --- K5: die Kennzahl ist universums-invariant ------------------------------------------

test('der Anteil bleibt gleich, wenn das Universum waechst - die absolute Zahl nicht', () => {
  // Dieselbe anteilige Wirkung, zwei Universumsgroessen: 2 von 10 und 4 von 20.
  const bau = (n, bewegt) => {
    const h = {}, basis = {}, kand = {};
    for (let i = 0; i < n; i++) {
      const t = 'T' + String(i).padStart(4, '0');
      h[t] = 'x'; basis[t] = 50; kand[t] = i < bewegt ? 55 : 50;
    }
    return fussabdruck(basis, kand, h);
  };
  const klein = bau(10, 2), gross = bau(20, 4);
  assert.equal(klein.anteilBewegt, gross.anteilBewegt,
    'Der Anteil unterscheidet sich bei gleicher anteiliger Wirkung - dann ist er nicht invariant.');
  assert.notEqual(klein.zeilenMitScoreAenderung, gross.zeilenMitScoreAenderung,
    'Aufbau falsch: die ABSOLUTE Zahl muss sich unterscheiden, sonst belegt der Test nichts.');
  assert.equal(klein.anteilBewegt, 0.2, 'Anteil falsch gerechnet');
});

test('der Anteil bezieht sich auf die VERGLICHENEN Zeilen, nicht auf alle', () => {
  // Zwei Zeilen sind mangels Eingangs-Hash nicht vergleichbar - sie duerfen den Nenner nicht
  // aufblaehen, sonst sinkt der Anteil, ohne dass sich die Wirkung geaendert hat.
  const h = { A: 'x', B: 'x', C: 'x', D: 'x' };   // E und F fehlen absichtlich
  const basis = { A: 50, B: 50, C: 50, D: 50, E: 50, F: 50 };
  const kand = { A: 55, B: 50, C: 50, D: 50, E: 99, F: 99 };
  const f = fussabdruck(basis, kand, h);
  assert.equal(f.verglichen, 4, 'nicht vergleichbare Zeilen landen im Nenner');
  assert.equal(f.uebersprungen, 2, 'uebersprungene Zeilen werden nicht gezaehlt');
  assert.equal(f.anteilBewegt, 0.25, `Anteil ${f.anteilBewegt} statt 1/4`);
});

test('ein leerer Fussabdruck hat Anteil 0, kein null und kein NaN', () => {
  const h = { A: 'x', B: 'x' };
  const f = fussabdruck({ A: 50, B: 50 }, { A: 50, B: 50 }, h);
  assert.equal(f.anteilBewegt, 0, 'der leere Fussabdruck meldet keinen sauberen Anteil');
  assert.equal(f.zeilenMitScoreAenderung, 0);
  assert.deepEqual(f.bewegteTicker, []);
});

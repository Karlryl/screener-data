'use strict';
/**
 * pruefePins — Bindungs-Pruefung MIT sichtbarer Abdeckung (N13-Klasse).
 *
 * BEFUND, der diesen Helfer erzwingt (Nachtlauf 30.08.2026, `akte-bruecken-addendum-
 * H6H7M13-2026-08-30.md` R4): Die drei Studien-Waechter D4/D5/D6 pruefen ihre gebundenen
 * Dateien mit dem Muster
 *
 *     const currentExpected = thresholdSeal.currentScripts[relative] || expected;
 *
 * Der `|| expected`-Rueckfall macht den Pin bei einem Schluessel-Tippfehler zur
 * TAUTOLOGIE: der Eintrag faellt still auf den historischen Hash zurueck, der Test
 * bleibt gruen, und niemand sieht, dass das aktuelle Siegel diese Datei gar nicht mehr
 * pinnt. Gemessen am 30.08.: von den gebundenen Dateien laufen D6 18 von 21, D5 4 von 6
 * und D4 3 von 4 ueber genau diesen Rueckfall — und im Siegel steht ein Schluessel
 * (`scripts/studie-threshold-seal.py`), der ueberhaupt keine gebundene Datei trifft und
 * deshalb bis heute NICHTS geprueft hat.
 *
 * Der Helfer aendert das Verhalten nicht (der Rueckfall bleibt: eine Datei ohne
 * Siegel-Eintrag ist an ihren historischen Hash gebunden, das ist gewollt) — er macht die
 * ABDECKUNG zur pruefbaren Groesse:
 *   - jede gebundene Datei wird wie bisher gegen ihren Soll-Hash geprueft,
 *   - jeder Siegel-Schluessel OHNE gebundene Datei ("Waise") wird jetzt ebenfalls gegen
 *     seine Datei geprueft, statt tot herumzuliegen,
 *   - und die Aufteilung wird zurueckgegeben, damit der Aufrufer sie festnageln kann.
 *     Ein Tippfehler verschiebt einen Eintrag von `ueberSiegel` nach `historisch` UND
 *     erzeugt eine Waise — beides bricht den gepinnten Zaehler.
 */
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function sha256Datei(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

/**
 * @param {string} repo        Wurzel, gegen die die relativen Pfade aufgeloest werden
 * @param {Record<string,string>} gebunden      relativer Pfad -> historischer Hash
 * @param {Record<string,string>} currentScripts Siegel: relativer Pfad -> aktueller Hash
 * @returns {{ueberSiegel: string[], historisch: string[], waisen: string[]}}
 */
function pruefePins(repo, gebunden, currentScripts) {
  const siegel = currentScripts || {};
  const ueberSiegel = [];
  const historisch = [];
  for (const [rel, historischerHash] of Object.entries(gebunden)) {
    const imSiegel = Object.prototype.hasOwnProperty.call(siegel, rel);
    (imSiegel ? ueberSiegel : historisch).push(rel);
    assert.equal(sha256Datei(path.join(repo, rel)), imSiegel ? siegel[rel] : historischerHash, rel);
  }
  const waisen = Object.keys(siegel).filter((k) => !Object.prototype.hasOwnProperty.call(gebunden, k));
  for (const rel of waisen) {
    assert.equal(sha256Datei(path.join(repo, rel)), siegel[rel],
      'Siegel-Waise ' + rel + ' (Schluessel ohne gebundene Datei — bis 30.08. ungeprueft)');
  }
  return { ueberSiegel, historisch, waisen };
}

module.exports = { pruefePins, sha256Datei };

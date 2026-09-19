'use strict';
/**
 * lib/druckenmiller/registration.js — eine gehashte Registrierungs-Datei lesen.
 *
 * WARUM GETEILT: ab Chunk 2 lesen ZWEI Prozesse Registrierungen — der Export-Schreiber
 * (Datei A fuer paramsHash und das Churn-Tor) und der Logger (Datei A fuer die Schwelle des
 * Eintritts-Tors, Datei B fuer die Chunk-2-Konstanten). Die Prueffolge "genau eine Datei ·
 * Sidecar vorhanden · Hash stimmt · JSON gueltig" darf es nur EINMAL geben, sonst driften
 * die beiden Leser auseinander und einer von ihnen laesst irgendwann eine ungehashte Datei
 * durch.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const sha256 = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');

/**
 * Liest die EINE Datei, auf die <glob> passt, und gibt {datei, hash, json}. Jeder Fehler
 * ist ein Wurf: eine Registrierung, die man nicht lesen kann, ist keine.
 */
function readHashed(protocolDir, glob, label) {
  const wie = label || 'Registrierung';
  if (!fs.existsSync(protocolDir)) {
    throw new Error(`[druckenmiller] ${wie}: ${protocolDir} existiert nicht.`);
  }
  const treffer = fs.readdirSync(protocolDir).filter((f) => glob.test(f)).sort();
  if (!treffer.length) {
    throw new Error(`[druckenmiller] keine ${wie} in ${protocolDir} — ohne den eingefrorenen `
      + 'Parameter-Stand darf nichts veroeffentlicht werden (BUILD-SPEC [REV6-1]).');
  }
  if (treffer.length > 1) {
    throw new Error(`[druckenmiller] ${treffer.length} Dateien fuer ${wie} in ${protocolDir} (`
      + treffer.join(', ') + ') — welche gilt? Eine Registrierung wird ersetzt, nie ergaenzt.');
  }
  const datei = path.join(protocolDir, treffer[0]);
  const text = fs.readFileSync(datei, 'utf8');
  const hash = sha256(text);
  const sidecarPfad = datei + '.sha256';
  if (!fs.existsSync(sidecarPfad)) {
    throw new Error(`[druckenmiller] ${treffer[0]} hat keinen .sha256-Sidecar — ein ungehashtes `
      + 'Protokoll ist kein Protokoll.');
  }
  const imSidecar = fs.readFileSync(sidecarPfad, 'utf8').trim().split(/\s+/)[0];
  if (imSidecar !== hash) {
    throw new Error(`[druckenmiller] ${wie} ${treffer[0]}: der Sidecar nennt ${imSidecar.slice(0, 12)}…, `
      + `die Datei ist ${hash.slice(0, 12)}… — sie wurde nach dem Hashen angefasst.`);
  }
  let json;
  try { json = JSON.parse(text); }
  catch (e) {
    throw new Error(`[druckenmiller] ${wie} ${treffer[0]} ist kein gueltiges JSON (${e.message}) — `
      + 'der Dateiname gehoert in die Meldung, sonst sucht der naechste Leser in der falschen Datei.');
  }
  return { datei: treffer[0], hash, json };
}

module.exports = { sha256, readHashed };

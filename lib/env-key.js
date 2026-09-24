'use strict';
// lib/env-key.js — Umgebungsvariablen case-sicher setzen (PATH vs Path auf Windows).
//
// WOFUER (S25): auf Windows heisst der Schluessel im Prozess-Environment `Path`, nicht `PATH`, und
// `{ ...process.env }` kopiert ihn in genau dieser Schreibweise in ein Plain-Object. Wer dann
// `PATH: …` daneben setzt, gibt dem Kindprozess ein Objekt mit BEIDEN Schluesseln — welcher davon im
// Kind sichtbar wird, sichert die Node-API nicht zu (libuv sortiert den Environment-Block
// case-insensitiv). Ein per PATH vorangestelltes Stub-Verzeichnis kann so unbemerkt verloren gehen.
// Dieses Modul setzt genau EINEN Schluessel: die vorhandene Schreibweise, sonst `name`.
//
// Die Plattform wird injiziert (Default process.platform), damit Tests beide Zweige ohne
// Betriebssystem-Wechsel pruefen koennen.

const hat = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

function istVariante(key, name, platform) {
  return platform === 'win32' ? key.toUpperCase() === String(name).toUpperCase() : key === name;
}

/**
 * Liefert den im `env` tatsaechlich vorhandenen Schluesselnamen fuer `name` — auf 'win32'
 * case-insensitiv (exakte Schreibweise gewinnt vor einer Case-Variante), sonst exakt.
 * Nicht vorhanden -> `name` selbst.
 */
function findeEnvSchluessel(env, name, platform = process.platform) {
  if (!env || typeof env !== 'object') return name;
  if (hat(env, name)) return name;
  if (platform !== 'win32') return name;
  for (const key of Object.keys(env)) {
    if (istVariante(key, name, platform)) return key;
  }
  return name;
}

/**
 * Flache Kopie von `env`, in der `name` auf `wert` steht — unter genau EINEM Schluessel:
 * der vorhandenen Schreibweise (siehe findeEnvSchluessel), sonst `name`. Auf 'win32' werden
 * alle anderen Case-Varianten von `name` entfernt. Die Eingabe wird nicht mutiert.
 */
function mitEnv(env, name, wert, platform = process.platform) {
  const quelle = (env && typeof env === 'object') ? env : {};
  const schluessel = findeEnvSchluessel(quelle, name, platform);
  const kopie = {};
  let gesetzt = false;
  for (const key of Object.keys(quelle)) {
    if (key === schluessel) { kopie[key] = wert; gesetzt = true; continue; }
    if (istVariante(key, name, platform)) continue;
    kopie[key] = quelle[key];
  }
  if (!gesetzt) kopie[schluessel] = wert;
  return kopie;
}

module.exports = { findeEnvSchluessel, mitEnv };

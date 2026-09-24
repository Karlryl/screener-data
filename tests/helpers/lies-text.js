'use strict';
/**
 * liesText / zeilen — CRLF-tolerante Textleser fuer Tests, die Repo-Quelltext oder
 * Workflow-YAML zeilenweise verarbeiten (S22).
 *
 * .gitattributes pinnt `text eol=lf` nur fuer einzelne Pfade — NICHT fuer
 * .github/workflows/*.yml, .gitignore, refresh-universe.js oder tests/*.js. Auf einem
 * Windows-Checkout mit core.autocrlf=true liegen diese Dateien mit CRLF im Baum, und ein
 * Test, der `split('\n')` macht, reicht ein haengendes '\r' weiter: bash bricht bei
 * `$'\r': command not found` ab, und `/^x$/m` matcht nicht (`$` steht vor '\n', nicht
 * vor '\r'). Ein Leser, eine Normalisierung — statt drei Idiomen (split('\n'),
 * split(/\r?\n/), replace(/\r\n/g, '\n')) verstreut ueber die Testdateien.
 *
 * Nur fuer Repo-Textdateien (.yml/.js/.gitignore). Ausgabe-Artefakte aus mkdtemp und
 * JSON.parse-Eingaben bleiben bei fs.readFileSync — dort ist '\r' Teil des Befunds.
 */
const fs = require('fs');

/** Liest eine Textdatei als UTF-8; CRLF und nacktes CR werden zu LF normalisiert. */
function liesText(pfad) {
  return fs.readFileSync(pfad, 'utf8').replace(/\r\n?/g, '\n');
}

/** Zerlegt Text zeilenweise, tolerant gegen CRLF. */
function zeilen(text) {
  return text.split(/\r?\n/);
}

module.exports = { liesText, zeilen };

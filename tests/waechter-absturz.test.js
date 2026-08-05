'use strict';
/**
 * Waechter fuer die Waechter (29.07.).
 *
 * DIE SACHE: Kein Monitor-Skript darf beim EIGENEN Absturz Erfolg melden. Ein
 * `process.exit(0)` im catch des Einstiegspunkts macht einen toten Waechter fuer immer
 * gruen — genau die Fehlerklasse, gegen die solche Skripte gebaut sind, nur eine Ebene
 * hoeher. In check-pull-stats.js stand das bis zum 29.07. drin, samt Discord-Ping als
 * gedachter Sichtbarmachung; der Webhook existierte nie.
 *
 * Usage: node tests/waechter-absturz.test.js   (Exit 0/1)
 */
const fs = require('node:fs');
const path = require('node:path');

const dateien = [];
(function sammle(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!/node_modules|\.git/.test(p)) sammle(p); }
    else if (e.name.endsWith('.js')) dateien.push(p);
  }
})('scripts');

let fehler = 0, geprueft = 0;
for (const f of dateien) {
  // Kommentare RAUS, bevor gesucht wird. Beim ersten Anlauf schlug der Waechter auf einen
  // KOMMENTAR an, der process.exit(0) nur erwaehnt — die Zeile selbst war laengst
  // repariert. Ein Waechter, der Prosa liest, prueft nicht die Sache.
  const t = fs.readFileSync(f, 'utf8')
    .replace(/\r\n/g, '\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '');
  if (!/require\.main === module/.test(t)) continue;
  geprueft++;
  const rest = t.slice(t.indexOf('require.main === module'));
  const mCatch = rest.match(/\.catch\((?:async\s*)?(?:\(|\w)[\s\S]{0,900}?\}\s*\)/);
  if (!mCatch) continue;
  if (/process\.exit\(\s*0\s*\)/.test(mCatch[0])) {
    console.error('FAIL   ' + f + ': meldet beim eigenen Absturz Erfolg (process.exit(0) im catch)');
    fehler++;
  }
}

// Der Waechter muss ueberhaupt etwas gesehen haben — findet er kein einziges Skript mit
// Einstiegspunkt, ist die Suche kaputt und nicht das Repo sauber.
if (geprueft === 0) {
  console.error('FAIL   kein Skript mit `require.main === module` gefunden — Suche kaputt');
  fehler++;
}

(async () => {
  try {
    const exits = [];
    const errors = [];
    const { runCli } = require('../scripts/check-pull-stats.js');
    await runCli(async () => { throw new Error('synthetischer Absturz'); }, {
      exit: code => exits.push(code),
      error: line => errors.push(String(line)),
    });
    if (exits.length !== 1 || exits[0] !== 1) {
      throw new Error('echter CLI-Handler meldet Exit ' + JSON.stringify(exits) + ' statt [1]');
    }
    if (!errors.some(line => /::error::.*synthetischer Absturz/.test(line))) {
      throw new Error('echter CLI-Handler meldet den Absturz nicht im Fehlerkanal');
    }
  } catch (e) {
    console.error('FAIL   check-pull-stats.js: ' + e.message);
    fehler++;
  }
  console.log('\nwaechter-absturz: ' + geprueft + ' Einstiegspunkte geprueft, ' + fehler + ' mit stillem Erfolg beim Absturz');
  process.exit(fehler ? 1 : 0);
})();

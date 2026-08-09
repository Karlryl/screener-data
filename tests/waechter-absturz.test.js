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

const HAT_EXIT0 = /process\.exit\(\s*0\s*\)/;

// Fensterbreite des Sicherheitsnetzes (siehe stillerErfolg). Am realen Bestand gemessen
// (58 Einstiegspunkte: 55 im Repo + 3 lokal untracked): KEINE einzige Fundstelle, bei der
// das rohe Fenster ein process.exit(0) sieht — also kein Falsch-Rot, das Fenster braucht
// keine engere Begrenzung auf das syntaktische Ende des catch-Ausdrucks.
const FENSTER = 900;

// Liefert den vollstaendigen Callback-Block des Promise-.catch() an Position `start`.
// Regex ist hier absichtlich ungeeignet: `}` in Template-Ausdruecken oder
// verschachtelten Bloecken darf den Fund nicht vorzeitig abschneiden.
function catchBlock(text, start) {
  const open = text.indexOf('{', start + 7);
  if (open < 0) return null;
  let depth = 0, quote = null, escaped = false;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (escaped) { escaped = false; continue; }
    if (quote) {
      if (ch === '\\') escaped = true;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return text.slice(start, i + 1);
  }
  return null;
}

// Prueft ALLE .catch(-Fundstellen — nicht nur die erste. Ein Verstoss in irgendeinem
// catch macht den Waechter tot-gruen; der erste catch kann sauber sein und der zweite
// (Nachlauf, Cleanup, Retry) still Erfolg melden.
function stillerErfolg(text) {
  for (let i = text.indexOf('.catch('); i >= 0; i = text.indexOf('.catch(', i + 1)) {
    const block = catchBlock(text, i);
    if (block && HAT_EXIT0.test(block)) return true;
    // Sicherheitsnetz gegen Parser-Taeuschung: die Klammer-Zaehlung kennt weder
    // Regex-Literale (`/}/` schliesst den Block zu frueh) noch brace-lose
    // Arrow-Bodies (`e => process.exit(0)`) noch destrukturierte Parameter
    // (`({ code }) => {…}` — das erste Klammerpaar ist der Parameter, nicht der
    // Rumpf). In allen drei Faellen liefert catchBlock() null oder einen zu kurzen
    // Block. Dann entscheidet das grobe Zeichen-Fenster. Falsch-Rot ist fuer diesen
    // Waechter billig (Mensch schaut hin und verwirft), Falsch-Gruen ist genau der
    // Schaden, gegen den er steht — also so herum.
    if (HAT_EXIT0.test(text.slice(i, i + FENSTER))) return true;
  }
  return false;
}

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
  if (stillerErfolg(rest)) {
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

// Selbsttest der Erkennung. Alle drei Faelle wurden vom Stand 56bc9497 UEBERSEHEN
// (nur erster catch geprueft / Klammer-Zaehlung getaeuscht) — sie sind der Rot-Beweis
// fuer diesen Nachzug, nicht Dekoration.
// Der Fueller haelt den zweiten catch weiter als FENSTER vom ersten weg — sonst wuerde
// ihn schon das Sicherheitsnetz des ERSTEN catch einsammeln und der Fixture-Fall wuerde
// die Schleife ueber alle Fundstellen gar nicht festnageln (beim Ausbau-Test gemessen).
const fueller = '  zwischenschritt();\n'.repeat(60);
const fixtures = [
  ['zweiter .catch meldet Erfolg',
    'if (require.main === module) {\n' +
    '  main().catch(err => {\n    console.error(err);\n    process.exit(1);\n  });\n' +
    fueller +
    '  nachlauf().catch(err => {\n    console.error(err);\n    process.exit(0);\n  });\n}\n'],
  ['Regex-Literal /}/ schneidet den Block ab',
    'if (require.main === module) {\n  main().catch(err => {\n' +
    '    if (/}/.test(String(err))) melde(err);\n    process.exit(0);\n  });\n}\n'],
  ['brace-loser Arrow-Body',
    'if (require.main === module) {\n  main().catch(e => process.exit(0));\n}\n'],
];
for (const [name, quelle] of fixtures) {
  if (!stillerErfolg(quelle.slice(quelle.indexOf('require.main === module')))) {
    console.error('FAIL   Fixture uebersehen: ' + name);
    fehler++;
  }
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

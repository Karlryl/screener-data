#!/usr/bin/env node
'use strict';
/**
 * Messung (Tag 584, VSXY/VSCO): trifft die Apostroph-/"Co."-Kanonisierung des STRENGEN
 * Dedup-Schluessels (issuerKeyStrengOhneGattung, src/scoring/score.js) irgendwo im echten
 * Bestand ausser am Bugfall — insbesondere den geschuetzten firstbancorp-Fall (FBNC/FBP)?
 *
 * Prueft NUR Gruppen mit >=2 US-Primaerlistings (genau die, fuer die splitFalseIssuerMerges
 * auf den strengen Schluessel zurueckfaellt) und meldet, welche davon einen Apostroph oder ein
 * eigenstaendiges "Co."/"Co"-Suffix tragen — also ueberhaupt von der Kanonisierung beruehrt
 * werden koennten.
 *
 * ⚠ NUR gegen einen CI-Bestand laufen lassen, nie gegen den lokalen snapshots/-Ordner: der ist
 *   auf Entwicklungsrechnern regelmaessig Monate alt und liefert falsche Zahlen.
 *
 *   gh run download <RUN_ID> -n snapshots -D <ordner>
 *   node scripts/probe-issuer-strict-key-punct.js <ordner>
 *
 * Ergebnis am Lauf 30938140990 (04.08.2026, 14.538 Snapshots): 41 Gruppen mit >=2
 * US-Primaerlistings. Genau EINE davon (victoriassecretco, VSCO/VSXY) traegt einen Apostroph
 * bzw. ein "Co."/"Co"-Suffix und wird durch die Kanonisierung zusammengefuehrt. Der geschuetzte
 * firstbancorp-Fall (FBNC/FBP) ist in der Liste, bleibt aber unveraendert getrennt — er endet
 * auf das zusammengesetzte Wort "Bancorp", nicht auf ein eigenstaendiges "co".
 */
const fs = require('fs');
const path = require('path');

const { issuerKeyLoose, issuerKeyStrengOhneGattung } = require('../src/scoring/score.js');
const { isUsPrimaryListing } = require('../src/scoring/router.js');

const SNAPS = process.argv[2];
if (!SNAPS || !fs.existsSync(SNAPS)) {
  console.error('Nutzung: node scripts/probe-issuer-strict-key-punct.js <snapshot-ordner-aus-CI>');
  process.exit(1);
}

const dateien = fs.readdirSync(SNAPS).filter((f) => f.endsWith('.json') && !f.startsWith('_'));
const gruppen = {};
let uebersprungen = 0;
for (const f of dateien) {
  let s;
  // Sichtbar ueberspringen statt schweigend: eine defekte/abgeschnittene Datei darf die Messung
  // nicht unbemerkt schrumpfen -- sonst prueft der naechste Leser eine Zahl, die nie gemessen wurde.
  try { s = JSON.parse(fs.readFileSync(path.join(SNAPS, f), 'utf8')); } catch (e) {
    console.error(`  uebersprungen (Parse-Fehler): ${f} — ${e.message}`);
    uebersprungen++;
    continue;
  }
  const k = issuerKeyLoose(s);
  if (!k) continue;
  (gruppen[k] ||= []).push({ ticker: (s.meta && s.meta.ticker) || f.replace(/\.json$/, ''), snapshot: s });
}
if (uebersprungen > 0) console.error(`\n${uebersprungen} von ${dateien.length} Dateien uebersprungen (Parse-Fehler) — Zahlen unten sind auf dieser kleineren Basis.`);

const kandidaten = Object.entries(gruppen).filter(
  ([, entries]) => entries.filter((e) => isUsPrimaryListing((e.snapshot && e.snapshot.meta) || {})).length >= 2,
);

const BERUEHRT = /['’‘ʼ´`]|\bco\.?$/i;
let beruehrt = 0;
console.log(`Snapshots ..................... ${dateien.length}`);
console.log(`Gruppen mit >=2 US-Primaer ..... ${kandidaten.length}`);

for (const [looseKey, entries] of kandidaten) {
  const namen = entries.map((e) => (e.snapshot.meta && e.snapshot.meta.name) || '');
  if (!namen.some((n) => BERUEHRT.test(n))) continue;
  beruehrt++;
  const strengeKeys = new Set(entries.map((e) => issuerKeyStrengOhneGattung(e.snapshot)));
  console.log(`\n  ${looseKey} — strenge Schluessel: ${strengeKeys.size} (${[...strengeKeys].join(' | ')})`);
  for (const e of entries) console.log(`    ${String(e.ticker).padEnd(10)} "${e.snapshot.meta.name}"`);
}
console.log(`\nvon der Kanonisierung beruehrbar (Apostroph/Co.-Suffix im Namen) . ${beruehrt}`);

// Exit 0 auch bei Funden: das hier ist ein Messwerkzeug, kein Gate.
process.exit(0);

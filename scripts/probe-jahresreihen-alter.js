#!/usr/bin/env node
'use strict';
/**
 * probe-jahresreihen-alter.js — wie ALT sind die Jahresreihen im Store? (T134)
 *
 * WARUM. T134 stand seit dem 23.08. blockiert: die Altersverteilung der Jahresreihen war
 * nicht messbar, weil die Perioden-Enden (`annual*Ends`) erst seit PR #71 mitgeschrieben
 * werden und am 28.08. nur ~39 % der Snapshots trugen. Mit dem Voll-Lauf vom 29.08. tragen
 * sie 15.037 von 15.040 (100,0 %) — die Messung ist ab jetzt moeglich.
 *
 * WAS GEMESSEN WIRD. Je Snapshot das JUENGSTE Perioden-Ende der drei Kernreihen
 * (annualRev/annualOpInc/annualNetIncome) und der Abstand zum Stichtag. Das ist die
 * Datengrundlage fuer T127/J-C: "wie viel Vergangenheit steckt in einer Zeile, die heute
 * bewertet wird".
 *
 * WAS NICHT GEMESSEN WIRD. Ob das Alter richtig oder falsch ist — ein Jahresabschluss ist
 * naturgemaess Monate alt, und Geschaeftsjahre enden ueber das Kalenderjahr verteilt. Diese
 * Probe MELDET die Verteilung; sie bewertet nicht.
 *
 * Rein lesend, keine Schreibvorgaenge ausser dem Report auf stdout.
 * Usage: node scripts/probe-jahresreihen-alter.js [--stichtag YYYY-MM-DD] [--dir snapshots]
 */
const fs = require('fs');
const path = require('path');
// Das ZENTRALE Praedikat, nicht `!f.startsWith('_')`: Snapshots mit reserviertem Namen
// (z. B. `_CON.json` — CON ist unter Windows ein Geraetename) tragen aus genau diesem
// Grund einen Unterstrich und sind ECHTE Firmen. Ein Pauschal-Filter verschluckt sie
// still. Gepinnt in tests/p1-welle8-metadata-filter.test.js.
const { isMetadataSnapshot } = require('../lib/snapshot-fs.js');

const args = process.argv.slice(2);
const argVal = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const DIR = path.join(__dirname, '..', argVal('--dir', 'snapshots'));
const STICHTAG = argVal('--stichtag', new Date().toISOString().slice(0, 10));
const REIHEN = ['annualRev', 'annualOpInc', 'annualNetIncome'];

// Die Enden liegen je nach Erzeuger unter annual.<reihe>Ends oder timeseries.<reihe>Ends.
// Beide Orte lesen: ein Snapshot, der nur einen davon traegt, ist sonst still "ohne Enden".
function endenVon(s, reihe) {
  const a = s && s.annual && s.annual[`${reihe}Ends`];
  const t = s && s.timeseries && s.timeseries[`${reihe}Ends`];
  const roh = Array.isArray(a) ? a : (Array.isArray(t) ? t : []);
  return roh.filter((x) => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x));
}

function tageZwischen(a, b) {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
}

function main() {
  const dateien = fs.readdirSync(DIR).filter((f) => f.endsWith('.json') && !isMetadataSnapshot(f));
  const alter = [];
  let ohneEnden = 0, kaputt = 0, gescannt = 0;
  const jeMonat = new Map();

  for (const f of dateien) {
    let s;
    try { s = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')); } catch { kaputt++; continue; }
    gescannt++;
    // Das JUENGSTE Ende ueber die drei Kernreihen — es bestimmt, wie aktuell die Zeile ist.
    let juengstes = null;
    for (const r of REIHEN) {
      for (const e of endenVon(s, r)) if (!juengstes || e > juengstes) juengstes = e;
    }
    if (!juengstes) { ohneEnden++; continue; }
    alter.push(tageZwischen(juengstes, STICHTAG));
    const m = juengstes.slice(0, 7);
    jeMonat.set(m, (jeMonat.get(m) || 0) + 1);
  }

  alter.sort((x, y) => x - y);
  const q = (p) => (alter.length ? alter[Math.min(alter.length - 1, Math.floor(p * alter.length))] : null);
  const jahre = (t) => (t / 365.25).toFixed(2);

  console.log(`Stichtag ${STICHTAG} · Verzeichnis ${path.relative(path.join(__dirname, '..'), DIR)}`);
  console.log(`Gescannt: ${gescannt} · mit Perioden-Enden: ${alter.length} `
    + `(${(100 * alter.length / gescannt).toFixed(1)} %) · ohne: ${ohneEnden} · unlesbar: ${kaputt}`);
  console.log('');
  console.log('ALTER DER JUENGSTEN JAHRESZAHL (Tage seit Perioden-Ende):');
  for (const [name, p] of [['Minimum', 0], ['p10', 0.10], ['Median', 0.50], ['p75', 0.75], ['p90', 0.90], ['p99', 0.99]]) {
    const v = p === 0 ? alter[0] : q(p);
    console.log(`  ${name.padEnd(8)} ${String(v).padStart(6)} Tage  (${jahre(v)} Jahre)`);
  }
  console.log(`  Maximum  ${String(alter[alter.length - 1]).padStart(6)} Tage  (${jahre(alter[alter.length - 1])} Jahre)`);
  console.log('');
  const schwellen = [365, 548, 730, 1095];
  console.log('ANTEIL UEBER SCHWELLE:');
  for (const t of schwellen) {
    const n = alter.filter((a) => a > t).length;
    console.log(`  aelter als ${String(t).padStart(4)} Tage (${jahre(t)} J): ${String(n).padStart(6)} `
      + `= ${(100 * n / alter.length).toFixed(1)} %`);
  }
  console.log('');
  console.log('JUENGSTES PERIODEN-ENDE, TOP-12 MONATE:');
  [...jeMonat.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)
    .forEach(([m, n]) => console.log(`  ${m}: ${String(n).padStart(5)} (${(100 * n / alter.length).toFixed(1)} %)`));
}

module.exports = { endenVon, tageZwischen };
if (require.main === module) main();

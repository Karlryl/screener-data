#!/usr/bin/env node
'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// KARLS FRAGE C: „sind einzelne der Sektorformeln besser als andere?"
//
// DIE EHRLICHE ANTWORT VORWEG — und sie steht auch in der Ausgabe:
// „Besser" heisst am Ende „findet mehr Gewinner". Das ist heute NICHT messbar:
// die Rendite-Messreihe hat einen einzigen verwertbaren Punkt, und das
// Messinstrument dafuer ist als defekt belegt. Wer jetzt eine Rangliste der
// Formeln liefert, suggeriert Guete, wo nur Struktur gemessen wurde.
//
// WAS STATTDESSEN GEHT: die Formeln daraufhin ansehen, ob sie ihre Aufgabe
// mechanisch erfuellen — trennen sie ueberhaupt, auf wie viel Beleg stehen ihre
// Urteile, und wie viel ihres nominalen Gewichts kommt real an. Das sind
// Werkzeug-Eigenschaften, keine Erfolgsaussagen, und sie sind heute belastbar.
//
// DER FALLSTRICK, der jede naive Auswertung kippt: die Zahl der Board-Plaetze je
// Formel misst die SEKTORGROESSE, nicht die Formel. industrials stellt 53 der
// Top 200, weil der Sektor gross ist — daraus folgt nichts ueber die Formel.
// Deshalb ist unten KEINE Spalte „Board-Plaetze".
//
// Reine Diagnose: liest nur board-history, schreibt nur nach stdout, kein Netz.
// ─────────────────────────────────────────────────────────────────────────────

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const VINTAGE = process.argv[2] || '2026-07-29';
const DIR = path.join(REPO_ROOT, 'board-history', VINTAGE);

const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
function sd(a) {
  if (a.length < 2) return null;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1));
}
function quantile(a, q) {
  if (!a.length) return null;
  const s = a.slice().sort((x, y) => x - y);
  const i = (s.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i);
  return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (i - lo);
}
function pearson(x, y) {
  const n = x.length;
  if (n < 3) return null;
  const mx = mean(x), my = mean(y);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { const a = x[i] - mx, b = y[i] - my; sxy += a * b; sxx += a * a; syy += b * b; }
  if (sxx === 0 || syy === 0) return null;
  return sxy / Math.sqrt(sxx * syy);
}
const f1 = (v) => (v === null || v === undefined || !Number.isFinite(v) ? '  — ' : v.toFixed(1).padStart(4));
const f2 = (v) => (v === null || v === undefined || !Number.isFinite(v) ? '  —  ' : v.toFixed(2).padStart(5));

function auswerten(board, zeilen) {
  const scores = zeilen.map((r) => r.score).filter(Number.isFinite);
  if (scores.length < 5) return null;

  // (1) TRENNSCHAERFE: eine Formel, die alle auf denselben Wert setzt, sortiert
  // nicht. Gemessen als Streuung der Scores und als Abstand zwischen dem oberen
  // und unteren Zehntel — Letzteres ist der Teil, den Karl wirklich ansieht.
  const streuung = sd(scores);
  const spitzeVsMitte = quantile(scores, 0.9) - quantile(scores, 0.5);

  // (2) BELEGLAGE: wie viele Achsen tragen je Zeile wirklich einen Wert.
  // coverageAxes steht als "6/7" in der Zeile.
  const cov = [];
  for (const r of zeilen) {
    if (typeof r.coverageAxes !== 'string') continue;
    const m = r.coverageAxes.match(/^(\d+)\/(\d+)$/);
    if (m) cov.push(Number(m[1]) / Number(m[2]));
  }
  const abdeckung = cov.length ? mean(cov) : null;
  const vollAbdeckung = cov.length ? cov.filter((v) => v >= 0.999).length / cov.length : null;

  // (3) WIE VIEL VERTRAUEN ZIEHT DIE FORMEL SELBST AB: scoreBase -> scoreShrunk.
  // Eine grosse Schrumpfung heisst: die Formel traut ihrer eigenen Beleglage nicht.
  const schrumpf = zeilen
    .filter((r) => Number.isFinite(r.scoreBase) && Number.isFinite(r.scoreShrunk))
    .map((r) => r.scoreBase - r.scoreShrunk);
  const medianSchrumpf = schrumpf.length ? quantile(schrumpf, 0.5) : null;

  // (4) ACHSEN-REDUNDANZ: tragen die Achsen unabhaengige Information, oder sagen
  // mehrere dasselbe? Median der paarweisen |Korrelation| ueber die Achsen-Perzentile.
  // Hohe Werte heissen: die Formel hat weniger Achsen, als ihre Liste behauptet.
  const perAchse = new Map();
  for (const r of zeilen) {
    if (!Array.isArray(r.axisBreakdown)) continue;
    for (const a of r.axisBreakdown) {
      if (!a || typeof a.key !== 'string') continue;
      if (!perAchse.has(a.key)) perAchse.set(a.key, []);
      perAchse.get(a.key).push(Number.isFinite(a.pct) ? a.pct : null);
    }
  }
  const namen = [...perAchse.keys()];
  const paare = [];
  for (let i = 0; i < namen.length; i++) {
    for (let j = i + 1; j < namen.length; j++) {
      const A = perAchse.get(namen[i]), B = perAchse.get(namen[j]);
      const x = [], y = [];
      for (let k = 0; k < Math.min(A.length, B.length); k++) {
        if (A[k] === null || B[k] === null) continue;
        x.push(A[k]); y.push(B[k]);
      }
      if (x.length < 30) continue;
      const r = pearson(x, y);
      if (r !== null) paare.push(Math.abs(r));
    }
  }
  const redundanz = paare.length ? quantile(paare, 0.5) : null;
  const maxRedundanz = paare.length ? Math.max(...paare) : null;

  // (5) WIE VIEL NOMINALES GEWICHT KOMMT AN: Achsen ohne Wert tragen ihr Gewicht
  // nicht bei. Der Anteil ankommendes Gewicht ist die ehrlichere Angabe als die
  // Gewichtsliste der Formel.
  const gewichtAn = [];
  for (const r of zeilen) {
    if (!Array.isArray(r.axisBreakdown)) continue;
    let gesamt = 0, belegt = 0;
    for (const a of r.axisBreakdown) {
      const w = Number.isFinite(a && a.weight) ? a.weight : 0;
      gesamt += w;
      if (a && Number.isFinite(a.pct)) belegt += w;
    }
    if (gesamt > 0) gewichtAn.push(belegt / gesamt);
  }

  return {
    board, n: scores.length, streuung, spitzeVsMitte,
    abdeckung, vollAbdeckung, medianSchrumpf, redundanz, maxRedundanz,
    achsen: namen.length,
    gewichtAn: gewichtAn.length ? mean(gewichtAn) : null,
  };
}

function main() {
  console.log('══════════════════════════════════════════════════════════════════════════');
  console.log(' Was die 13 Sektorformeln mechanisch leisten — Vintage ' + VINTAGE);
  console.log('══════════════════════════════════════════════════════════════════════════');
  console.log('\n⚠ DIES IST KEINE GUETE-RANGLISTE. „Besser" heisst „findet mehr Gewinner",');
  console.log('  und das ist heute nicht messbar: die Rendite-Messreihe hat EINEN');
  console.log('  verwertbaren Punkt, und ihr Messinstrument ist als defekt belegt.');
  console.log('  Gemessen wird hier, ob eine Formel ihre Aufgabe mechanisch erfuellt.');
  console.log('  Bewusst NICHT enthalten: die Zahl der Board-Plaetze — die misst die');
  console.log('  Sektorgroesse, nicht die Formel.');

  const dateien = fs.readdirSync(DIR).filter((f) => f.endsWith('.json') && !f.startsWith('_')
    && !['calibration.json', 'regime.json'].includes(f));
  const rows = [];
  for (const f of dateien) {
    const v = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
    if (!v.cohort) continue;
    const alle = [];
    for (const t of Object.keys(v.cohort)) for (const r of v.cohort[t]) alle.push(r);
    const e = auswerten(f.replace(/\.json$/, ''), alle);
    if (e) rows.push(e);
  }

  console.log('\n[1] TRENNT DIE FORMEL UEBERHAUPT?');
  console.log('    Board                      n     Streuung  Spitze-Mitte');
  rows.slice().sort((a, b) => b.streuung - a.streuung).forEach((r) => {
    console.log('    ' + r.board.padEnd(26) + String(r.n).padStart(4) + '      ' + f1(r.streuung) + '        ' + f1(r.spitzeVsMitte));
  });
  const schwach = rows.filter((r) => r.spitzeVsMitte < 10);
  console.log('    => ' + (schwach.length
    ? 'AUFFAELLIG: ' + schwach.map((r) => r.board + ' (' + r.spitzeVsMitte.toFixed(1) + ')').join(', ')
      + '\n       Dort liegen die oberen 10 % kaum ueber dem Mittelfeld — die Formel sortiert dort schwach.'
    : 'alle Boards trennen das obere Zehntel um mindestens 10 Punkte vom Mittelfeld.'));

  console.log('\n[2] AUF WIE VIEL BELEG STEHEN DIE URTEILE?');
  console.log('    Board                    Achsen belegt   Zeilen mit VOLLER Abdeckung   Schrumpfung (Median)');
  rows.slice().sort((a, b) => (a.abdeckung ?? 9) - (b.abdeckung ?? 9)).forEach((r) => {
    console.log('    ' + r.board.padEnd(26)
      + (r.abdeckung === null ? '   — ' : (100 * r.abdeckung).toFixed(1).padStart(5) + ' %')
      + '            ' + (r.vollAbdeckung === null ? '   — ' : (100 * r.vollAbdeckung).toFixed(1).padStart(5) + ' %')
      + '                     ' + f1(r.medianSchrumpf));
  });
  console.log('    => Schrumpfung ist die Vorsicht der Formel gegen sich selbst: je duenner');
  console.log('       die Beleglage, desto weiter zieht sie den Score zum Mittelwert.');

  console.log('\n[3] SAGEN DIE ACHSEN VERSCHIEDENES? (Median und Maximum der paarweisen |Korrelation|)');
  console.log('    Board                    Achsen   Median   Maximum   ankommendes Gewicht');
  rows.slice().sort((a, b) => (b.redundanz ?? -1) - (a.redundanz ?? -1)).forEach((r) => {
    console.log('    ' + r.board.padEnd(26) + String(r.achsen).padStart(4) + '     ' + f2(r.redundanz)
      + '    ' + f2(r.maxRedundanz)
      + '        ' + (r.gewichtAn === null ? '  — ' : (100 * r.gewichtAn).toFixed(1).padStart(5) + ' %'));
  });
  const doppelt = rows.filter((r) => (r.maxRedundanz ?? 0) > 0.9);
  console.log('    => ' + (doppelt.length
    ? 'Achsenpaare ueber 0,90 in: ' + doppelt.map((r) => r.board).join(', ')
      + '\n       Dort tragen zwei Achsen praktisch dieselbe Information — die Formel hat\n       weniger unabhaengige Achsen, als ihre Liste behauptet. (Der bekannte Fall:\n       ruleOfX enthaelt das Umsatzwachstum ein zweites Mal, Urteil vom 29.07.\n       DENIED 3:0 — dokumentiert, nicht behoben.)'
    : 'kein Achsenpaar ueber 0,90.'));

  console.log('\n[4] WAS DARAUS FOLGT — und was NICHT');
  console.log('    Belastbar: welche Formel schwach trennt, wo die Beleglage duenn ist,');
  console.log('    und wo Achsen dasselbe zweimal sagen. Das sind Reparatur-Hinweise.');
  console.log('    NICHT belastbar: welche Formel „die beste" ist. Dafuer braucht es');
  console.log('    Renditen — entweder aus der laufenden Messreihe (Jahre) oder aus einer');
  console.log('    Point-in-Time-Vergangenheitsrechnung (Wochen). Die zweite ist der Weg,');
  console.log('    der Karl wirklich antwortet.');
  console.log('\n══════════════════════════════════════════════════════════════════════════');
}

main();

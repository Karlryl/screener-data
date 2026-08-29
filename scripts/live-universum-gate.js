#!/usr/bin/env node
'use strict';
/**
 * live-universum-gate.js — die Anker-Tests laufen gegen ECHTE Snapshots, nicht in den Rumpf-Skip.
 * ==============================================================================================
 *
 * WARUM ES DIESE DATEI GIBT (T147, Befund 23.08.2026, gebaut 29.08.2026)
 * ---------------------------------------------------------------------
 * Die Absicherung "Skip != Pass" war ein **Grep auf eine Log-Zeile**: der scoring-Job suchte
 * die Zeichenkette `pre-pull-Gate` in der Testausgabe. Das ist eine SCHWARZE Liste — sie
 * erkennt genau eine Schreibweise. Formuliert ein Test seine Skip-Meldung um, findet der Grep
 * nichts, der Test meldet "0 ok, 0 fail", und ein Lauf, der NICHTS gemessen hat, zaehlt als
 * bestanden. Am 08.08. ist genau das passiert (anchors.rank lief in den Rumpf-Skip und galt
 * als PASS); die Heilung war damals, den Sentinel zu ergaenzen — also dieselbe Schwarzliste
 * einen Eintrag laenger.
 *
 * DIESE DATEI DREHT DIE RICHTUNG UM: statt nach dem Wort fuer "geskippt" zu suchen, verlangt
 * sie den POSITIVEN Beleg, dass gemessen wurde — mindestens eine bestandene Pruefung je Test,
 * belegt durch die Abschlusszeile des Tests selbst. Ein Test, der nichts geprueft hat, kann
 * diesen Beleg nicht faelschen, egal wie er seine Skip-Meldung formuliert.
 *
 * WARUM KEIN "keine Skips erlaubt": mit echtem Universum meldet score.integration.test.js
 * dauerhaft `1 skipped` — der Anker fuer CEF/Trust/NAV-Holding existiert im Universum
 * schlicht nicht. Eine Null-Skip-Regel waere also taeglich falsch-rot. Gemessen am
 * Universum vom 29.08. (15.044 Snapshots): score.integration 33 ok / 1 skipped ·
 * quality-board 27 · phase 12 · score-breakdown 3 · acceleration-invariance 7 ·
 * anchors.rank 5.
 *
 * MASCHINENLESBARES ERGEBNIS (die zweite Haelfte von T147): der Lauf schreibt
 * `outputs/live-universum-gate.json` mit einem expliziten `status` je Test. Der Workflow
 * prueft die Datei danach auf Anwesenheit — **fehlt sie, ist der Lauf rot**. Ein Gate, dessen
 * Ergebnis nur im Protokolltext steht, ist genau so pruefbar wie der Grep, den es ersetzt.
 *
 * Der alte Sentinel bleibt als ZUSATZ erhalten (Guertel und Hosentraeger): er kostet nichts
 * und faengt den Fall, in dem ein Test skippt UND trotzdem ok-Zeilen produziert.
 *
 * Waechter: tests/live-universum-gate.test.js
 * Usage: node scripts/live-universum-gate.js
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const ERGEBNIS_DATEI = path.join(ROOT, 'outputs', 'live-universum-gate.json');

// Genau die Tests, die ein ECHTES Universum brauchen. acceleration-invariance ist bewusst
// dabei, obwohl es hermetisch baut (eigene Fixtures, kein loadUniverse) — es kostet nichts
// und die Liste bleibt deckungsgleich mit dem, was der Job bisher fuhr.
const TESTS = [
  'tests/scoring/score.integration.test.js',
  'tests/scoring/quality-board.test.js',
  'tests/scoring/phase.test.js',
  'tests/scoring/score-breakdown.test.js',
  'tests/scoring/acceleration-invariance.test.js',
  'tests/scoring/anchors.rank.test.js',
];

const SENTINEL = 'pre-pull-Gate';

/**
 * Liest die Abschlusszeile eines Testlaufs: "<datei>.test.js: N ok, M fail[, K skipped (…)]".
 * Rein, ohne I/O — damit der Waechter beide Richtungen ohne echte Testlaeufe pruefen kann.
 * Gibt null zurueck, wenn KEINE solche Zeile da ist; das ist ausdruecklich ein Befund und
 * kein Fehlen von Information: ein Test ohne Abschlusszeile hat nicht berichtet.
 *
 * `datei` ist Pflicht und wird als ANKER benutzt: die Zeile muss mit dem Dateinamen des
 * gelaufenen Tests beginnen. Review-Befund 29.08.: ein blosser Doppelpunkt als Anker ist
 * zu weit — jede spaetere Zeile in der Form "irgendwas: 0 ok, 0 fail" haette den echten
 * Abschluss ueberstimmt, weil rueckwaerts gesucht wird. Mit dem Dateinamen als Anker kann
 * das nur noch der Test selbst, und der ist die Quelle, die wir lesen wollen.
 */
function leseAbschluss(ausgabe, datei) {
  const basis = datei ? path.basename(String(datei)) : null;
  const anker = basis
    ? new RegExp(`(?:^|[\\\\/\\s])${basis.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:\\s*(\\d+)\\s+ok,\\s*(\\d+)\\s+fail(?:,\\s*(\\d+)\\s+skipped)?`)
    : /:\s*(\d+)\s+ok,\s*(\d+)\s+fail(?:,\s*(\d+)\s+skipped)?/;
  const zeilen = String(ausgabe || '').split(/\r?\n/);
  // von hinten, damit eine zufaellig passende Zeile aus der Mitte nicht gewinnt
  for (let i = zeilen.length - 1; i >= 0; i--) {
    const m = zeilen[i].match(anker);
    if (m) return { ok: Number(m[1]), fail: Number(m[2]), skipped: m[3] ? Number(m[3]) : 0 };
  }
  return null;
}

/**
 * Das Urteil ueber EINEN Testlauf. Rein. `status` ist das Feld, das T147 verlangt.
 * Reihenfolge der Pruefungen ist bewusst: der Exitcode zuerst (echte Fehler bleiben
 * echte Fehler), danach die Frage, ob ueberhaupt gemessen wurde.
 */
function beurteile(datei, rc, ausgabe, abbruch) {
  const a = leseAbschluss(ausgabe, datei);
  if (rc !== 0) {
    // Review-Befund 29.08.: bei Signal-Kill oder Puffer-Ueberlauf gibt es GAR KEINEN
    // Exitcode — "Exitcode 1" waere dann eine erfundene Zahl und verdeckte die wahre
    // Ursache genau bei den Faellen, die am schwersten zu lesen sind (OOM, Timeout,
    // ausufernde Ausgabe). Deshalb den echten Grund nennen, wenn es einen gibt.
    const grund = abbruch && abbruch.signal ? `Signal ${abbruch.signal}`
      : abbruch && abbruch.code ? `${abbruch.code} (Exitcode ${rc})`
        : `Exitcode ${rc}`;
    return { datei, status: 'fail', grund, ...(a || {}) };
  }
  if (!a) {
    return { datei, status: 'kein-bericht', grund: 'keine Abschlusszeile "N ok, M fail" in der Ausgabe — der Test hat nicht berichtet' };
  }
  if (a.fail > 0) {
    return { datei, status: 'fail', grund: `${a.fail} Pruefung(en) rot`, ...a };
  }
  if (a.ok < 1) {
    return { datei, status: 'nichts-gemessen', grund: 'Exit 0, aber 0 bestandene Pruefungen — der Lauf hat nichts belegt', ...a };
  }
  if (String(ausgabe).includes(SENTINEL)) {
    return { datei, status: 'geskippt', grund: `Sentinel "${SENTINEL}" in der Ausgabe — Anker gegen echte Snapshots wurden uebersprungen`, ...a };
  }
  return { datei, status: 'ok', ...a };
}

function main(argv = process.argv.slice(2)) {
  // Der Workflow nennt die Tests ausdruecklich beim Namen (der versiegelte Waechter
  // tests/scoring/bh-b09-dailyyml.test.js pinnt genau diese sechs Pfade IM Schritt —
  // eine Liste, die nur hier im Skript stuende, waere fuer ihn unsichtbar). Ohne
  // Argumente gilt die eingebaute Liste, damit ein Aufruf von Hand nichts braucht.
  const tests = argv.length ? argv : TESTS;
  const ergebnisse = [];
  for (const t of tests) {
    console.log(`--- ${t} ---`);
    // spawnSync statt execFileSync: Letzteres liefert bei ERFOLG nur stdout und wirft
    // stderr weg (Review-Befund 29.08.). Eine Abschlusszeile, die ein Test kuenftig ueber
    // console.error ausgibt, waere damit unsichtbar — das Gate meldete 'kein-bericht' fuer
    // einen gruenen Test. maxBuffer grosszuegig, damit ausufernde Ausgabe kein ENOBUFS
    // erzeugt, dessen Ursache dann nur noch als nackte 1 im Protokoll steht.
    const p = spawnSync(process.execPath, [t], {
      cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    });
    const out = `${p.stdout || ''}${p.stderr || ''}`;
    const rc = p.status === 0 ? 0 : (typeof p.status === 'number' ? p.status : 1);
    console.log(out.trimEnd());
    const r = beurteile(t, rc, out, { signal: p.signal, code: p.error && p.error.code });
    ergebnisse.push(r);
    if (r.status !== 'ok') console.error(`::error::${t}: ${r.status} — ${r.grund}`);
  }

  const schlecht = ergebnisse.filter((r) => r.status !== 'ok');
  const bericht = {
    schema: 'live-universum-gate/v1',
    generated_at: new Date().toISOString(),
    status: schlecht.length === 0 ? 'ok' : 'fail',
    geprueft: ergebnisse.length,
    tests: ergebnisse,
  };
  fs.mkdirSync(path.dirname(ERGEBNIS_DATEI), { recursive: true });
  fs.writeFileSync(ERGEBNIS_DATEI, JSON.stringify(bericht, null, 2) + '\n', 'utf8');
  console.log(`[live-universum-gate] Ergebnis nach ${path.relative(ROOT, ERGEBNIS_DATEI)}: ${bericht.status} `
    + `(${ergebnisse.length - schlecht.length}/${ergebnisse.length} ok, zusammen `
    + `${ergebnisse.reduce((n, r) => n + (r.ok || 0), 0)} bestandene Pruefungen)`);

  if (schlecht.length) {
    console.error('::error::Live-Universum-Gate failed — a ranking/routing/dedup/board regression may be present. See above.');
    return 1;
  }
  console.log('Live-Universum-Gate OK (real snapshots, no skip).');
  return 0;
}

module.exports = { leseAbschluss, beurteile, TESTS, SENTINEL, ERGEBNIS_DATEI };

if (require.main === module) process.exit(main());

#!/usr/bin/env node
'use strict';
/**
 * test-gate.js — EINE Quelle fuer Waechter, beide Test-Spuren und beide Workflows.
 *
 * WARUM EIN SKRIPT STATT EINER ZWEITEN INLINE-KOPIE (Tag 653):
 * Der bisherige bash-Block in daily-pull.yml war ~65 Zeilen. Er zusaetzlich in
 * pr-check.yml zu kopieren waere genau die Drift-Klasse, die dieses Repo schon
 * zweimal getroffen hat (R-Gate 2.R Runde 1 und 3, siehe unten): eine Liste wird
 * erweitert, die andere nicht, und Tests laufen still in KEINEM Job.
 *
 * ── Historie/Begruendungen, aus daily-pull.yml hierher verschoben ──────────────
 * Task 0.3 (Loop B): PRE-pull test-gate. Jede Testdatei ist ein selbstlaufendes
 * node-Skript, das mit process.exit(fail ? 1 : 0) endet. Der Glob laesst
 * fixtures/-Unterordner aus. Eine kaputte Engine muss den Lauf VOR dem teuren
 * Fan-out blocken (::error:: + exit 1). Signalweg ist ausschliesslich das rote X.
 *
 * R-Gate 2.R (17.07.): Das Gate globbte NUR tests/scoring/*.test.js — die 13
 * Dateien unter tests/ liefen im CI NIE. Darunter rank-ic.test.js und
 * board-history.test.js, also ausgerechnet die Regressionstests der drei
 * T1-Funde vom 17.07. (Preis-Store-Pfad, unfertige Fenster, Ausschluss-Vertrag):
 * Sie haetten eine Wiederholung nicht verhindert, weil sie niemand gefahren haette.
 * Beide Baeume laufen jetzt im selben Gate; tests/ ist hermetisch (Temp-Fixtures)
 * und braucht kein Universum, ist also pre-pull voll aussagekraeftig.
 *
 * R-Gate 2.R Runde 3 (17.07.): Der Fix oben zaehlte Verzeichnisse NAMENTLICH auf
 * und liess damit die 5 hermetischen Tests unter lib/ weiter in KEINEM Job laufen —
 * darunter forward-returns.test.js, die Vertragspruefung von classify(), auf der der
 * ganze §8-Austrittspfad der rankIC-Messung steht. Symptom-Fix waere: lib/ dazu.
 * Wurzel ist die Aufzaehlung selbst — jeder NEUE Testordner faellt wieder still raus.
 * Darum laeuft VOR jedem Gate-Modus der Waechter, der jede getrackte *.test.js gegen
 * die Listen haelt und laut wird, wenn eine weder gegatet noch begruendet ausgenommen ist.
 *
 * audit BH-035: '*.test.js' -> '*test.js' erweitert — faengt auch die
 * '-test.js'-Schreibweise (tests/13f-test.js, sec-form4-test.js,
 * sec-user-agent-test.js liefen sonst in KEINEM CI-Gate; weder Waechter noch
 * Gate sahen sie ueberhaupt, weil `git ls-files '*.test.js'` sie nicht listet).
 * Alle drei sind offline/hermetisch (kein Netz) -> gehoeren ins Gate, nicht in
 * die Ausnahmen.
 *
 * ── Modi ──────────────────────────────────────────────────────────────────────
 *   --mode=blocking : nur blockierende Spur (pre-pull im Tageslauf), exit 1 bei rot
 *   --mode=report   : nur Forschungs-Spur, meldet (::warning:: + Job-Summary), exit IMMER 0
 *   --mode=all      : beide Spuren, exit 1 bei rot (PR-Check: Sichtbarkeit vor Merge)
 *   --selftest      : Ausbau-, Anwesenheits-, Gegen- und Waechter-Probe
 * Der Waechter laeuft in jedem der drei run-Modi zuerst. Interne Fehler des Gates
 * selbst (leere Dateiliste, git kaputt) sind IMMER exit 1 — auch im report-Modus.
 */

const { execFileSync, spawnSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Eine node:test-Datei ohne registrierte Tests ist von einem beliebigen lauten
// Eigenformat-Runner anhand stdout/stderr allein nicht unterscheidbar. Darum laedt
// jeder Kindprozess ein eigenes, stummes Probe-Modul und meldet ueber FD 3, ob
// node:test TATSAECHLICH geladen wurde. Das Gate selbst darf nicht Preload sein:
// Worker erben die bereits geparste Preload-Liste und wuerden seinen spaeteren
// Einstieg sonst aus dem Require-Cache ueberspringen. Kommentare/String-Koeder zaehlen nie.
const NODE_TEST_PROBE_ENV = 'SCREENER_TEST_GATE_NODE_TEST_PROBE';
const NODE_OPTIONS_RESTORE_ENV = 'SCREENER_TEST_GATE_NODE_OPTIONS_RESTORE';
const NODE_TEST_PROBE_FILE = path.join(__dirname, 'test-gate-node-test-probe.js');

// ── Spur 1: blockierend ───────────────────────────────────────────────────────
// Unveraendert aus dem bisherigen GATE_GLOB. Was falsche Zahlen ausliefern
// koennte, darf den Tageslauf weiter anhalten.
const BLOCKING_GLOBS = ['tests/*test.js', 'tests/scoring/*test.js', 'lib/*test.js'];

// ── Spur 2: meldend (Forschungs-Bestand) ──────────────────────────────────────
// Diese Tests zaehlen den Bestand der Studien-Ablage (SEC-Archive, Wayback,
// Konzept-Karten, Dossiers …). Sie duerfen rot sein, ohne Karls Preis-Abruf zu
// blocken — ein fehlendes Studien-Artefakt liefert keine falschen Kurse aus.
//
// BEWUSST eine explizite Namensliste und KEIN Glob 'tests/early-detection-*':
// eine neu hinzukommende Studien-Testdatei landet dadurch automatisch in der
// BLOCKIERENDEN Spur (sichere Seite) und faellt beim ersten roten Lauf auf,
// statt still unblockierend zu werden.
//
// NICHT hier drin und darum weiter blockierend (Auflage der Rat-Vorlage:
// "Leakage- und Zeitpunkt-Waechter bleiben ausdruecklich in der blockierenden Spur"):
//   tests/early-detection.test.js                  (assertAvailabilityContract/assertKnownAt
//                                                   = Verfuegbarkeits-/Leakage-Vertrag)
//   tests/early-detection-leakage-fixtures.test.js (Leakage-Fixtures)
//   tests/early-detection-pit*.test.js             (PIT = point-in-time = Zeitpunkt-Waechter)
const REPORT_FILES = [
  'tests/early-detection-commoncrawl-filings.test.js',
  'tests/early-detection-commoncrawl-static.test.js',
  'tests/early-detection-concept-audit.test.js',
  'tests/early-detection-concept-map-checkpoint.test.js',
  'tests/early-detection-concept-semantic-audit.test.js',
  'tests/early-detection-confirmatory.test.js',
  'tests/early-detection-corporate-actions.test.js',
  'tests/early-detection-entity-bridge.test.js',
  'tests/early-detection-entity-listing-ledger.test.js',
  'tests/early-detection-filing-transport-decision.test.js',
  'tests/early-detection-foundation.test.js',
  'tests/early-detection-gqs-calendar.test.js',
  'tests/early-detection-gqs-inputs.test.js',
  'tests/early-detection-gqs-shadow.test.js',
  'tests/early-detection-identity-transition-dossiers.test.js',
  'tests/early-detection-independent-final-audit.test.js',
  'tests/early-detection-midas.test.js',
  'tests/early-detection-midas-index.test.js',
  'tests/early-detection-nasdaq-directory-evidence.test.js',
  'tests/early-detection-nasdaq-symbols.test.js',
  'tests/early-detection-price-cohort.test.js',
  'tests/early-detection-research-metadata.test.js',
  'tests/early-detection-sec-company-tickers.test.js',
  'tests/early-detection-sec-filing-archive.test.js',
  'tests/early-detection-sec-filing-gap.test.js',
  'tests/early-detection-sec-filing-individual.test.js',
  'tests/early-detection-sec-index.test.js',
  'tests/early-detection-sec-oldloads.test.js',
  'tests/early-detection-sec-store-checkpoint.test.js',
  'tests/early-detection-sec-wayback.test.js',
  'tests/early-detection-sec-wayback-truncation-audit.test.js',
  'tests/early-detection-sic-routing.test.js',
  'tests/early-detection-web-archive.test.js',
  // Orchestrator-Ruling 2026-08-29 14:10: C0 ist Strang-C-Themenauswahl, kein
  // Auslieferungs-Waechter — ein rotes C0 darf Karls Preis-Abruf nicht anhalten.
  // Der Substrat-Fall (EARLY_DETECTION_DATA_ROOT fehlt) faellt in der Datei selbst
  // als LAUTER Skip an (siehe dort), nicht als stiller Durchmarsch.
  'tests/studie-c0.test.js',
];

// ── Muessen blockierend BLEIBEN, obwohl Studien-Strecke ───────────────────────
// Auflage der Rat-Vorlage: "Leakage- und Zeitpunkt-Waechter bleiben ausdruecklich
// in der blockierenden Spur". Sie werden vom Glob 'tests/*test.js' erfasst; diese
// Liste ist der Waechter dagegen, dass jemand sie spaeter nach REPORT_FILES
// verschiebt und ein Waechter damit still zur blossen Meldung wird.
const BLOCKING_ALWAYS = [
  'tests/early-detection.test.js',            // assertAvailabilityContract/assertKnownAt
  'tests/early-detection-leakage-fixtures.test.js',
  'tests/early-detection-pit.test.js',        // PIT = point-in-time = Zeitpunkt-Waechter
  'tests/early-detection-pit-compact.test.js',
  'tests/early-detection-pit-compare.test.js',
  'tests/early-detection-pit-integrity.test.js',
  'tests/early-detection-pit-orphan-audit.test.js',
];

// ── Begruendete Ausnahmen (Praefix-Match) ─────────────────────────────────────
// tests/discovery/ (13 Dateien) = Live-Netz-Tests gegen echte Boersen-/Regulator-
// Endpunkte (LSE, Xetra, EDINET, FinMind, …). Im pre-pull-Gate wuerde jeder
// fremde Outage Karls Tageslauf falsch-rot blocken, bevor ein Byte Yahoo-Daten
// gezogen ist. Sie bleiben Ad-hoc-Checks fuer die Adapter-Pflege.
const EXEMPT_PREFIXES = ['tests/discovery/'];

// ── Helfer ────────────────────────────────────────────────────────────────────

/** Shell-aequivalente Glob-Expansion (ein Verzeichnis tief, nur existierende Dateien). */
function expandGlobs(globs, cwd) {
  const out = [];
  for (const g of globs) {
    const dir = path.posix.dirname(g);
    const base = path.posix.basename(g);
    const rx = new RegExp('^' + base.split('*').map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');
    let entries;
    try {
      entries = fs.readdirSync(path.join(cwd, dir), { withFileTypes: true });
    } catch { continue; }
    for (const e of entries) {
      if (e.isFile() && rx.test(e.name)) out.push(dir === '.' ? e.name : dir + '/' + e.name);
    }
  }
  return out.sort();
}

/** Repo-Bestand via git ls-files (nicht `find`): schliesst node_modules, Worktrees
 *  und ungetrackten Scratch von sich aus aus — eine nicht-eingecheckte Datei kann
 *  im CI ohnehin nie laufen. */
function listRepoTestFiles(cwd) {
  const out = execFileSync('git', ['ls-files', '*test.js'], { cwd, encoding: 'utf8' });
  return out.split('\n').map(s => s.trim()).filter(Boolean).filter(f => !f.includes('/fixtures/'));
}

/** Waechter: keine Testdatei darf still ungegatet bleiben; keine darf in beiden Spuren stehen. */
function guard({ blocking, report, exempt, repoFiles, blockingAlways }, log) {
  if (!repoFiles.length) {
    log('::error::Waechter fand KEINE Testdatei im Repo — git ls-files kaputt oder Checkout unvollstaendig.');
    return false;
  }
  const abgerutscht = blockingAlways.filter(f => report.includes(f) || !blocking.includes(f));
  if (abgerutscht.length) {
    for (const f of abgerutscht) {
      log(`::error::Testdatei ${f} ist ein Leakage-/Zeitpunkt-Waechter und MUSS blockierend laufen — sie steht in der Forschungs-Spur oder wird von keinem blockierenden Glob erfasst.`);
    }
    return false;
  }
  const known = new Set([...blocking, ...report]);
  const ungated = repoFiles.filter(f => !known.has(f) && !exempt.some(ex => f.startsWith(ex)));
  if (ungated.length) {
    for (const f of ungated) {
      log(`::error::Testdatei ${f} laeuft in KEINEM Job — weder von der blockierenden Spur ('${blocking.join(' ')}') noch von der Forschungs-Spur erfasst noch begruendet ausgenommen. Glob erweitern ODER mit Begruendung eintragen.`);
    }
    log('::error::Ungegatete Testdatei(en) gefunden — ein neuer Testordner darf nie stumm bleiben. Aborting.');
    return false;
  }
  log('Waechter OK: jede Testdatei ist gegatet oder begruendet ausgenommen.');
  return true;
}

// Tag 956: eine Testdatei, die NULL Pruefungen ausgefuehrt hat, darf nicht als PASS zaehlen.
// BEFUND (Endprobe): anchors.rank.test.js — der Direktive-4-Waechter — meldet ohne Universum
// "0 ok, 0 fail (skipped: kein Universum)" und endet mit Exit 0. Das Gate sah nur den
// Exit-Code und schrieb "PASS": eine Pruefung, die nichts geprueft hat, stand in derselben
// Spalte wie 250 echte. Genau diese Verwechslung ist die Bugklasse, die hier vermieden
// werden soll. Es sind nicht nur die Anker: ohne Universum melden SECHS Suiten "0 ok"
// (anchors.rank, calib-parity, calibration-ref, calibration, fairness-guards,
// score-breakdown); drei weitere (phase, quality-board, score.integration) fuehren einen
// Teil aus und bleiben deshalb zu Recht PASS.
//
// Regel: Exit 0 UND selbstgemeldete "0 ok" + "0 fail" => SKIP statt PASS, namentlich
// ausgewiesen und in der Summenzeile gezaehlt. BEWUSST NICHT rot: leeres snapshots/ ist im
// pre-pull-Gate und im PR-Check der legitime Normalzustand (dort gibt es das Universum noch
// gar nicht) — rot faerben hiesse, Karls Tageslauf taeglich vor dem Datenabruf zu blocken.
// Die SCHARFE Stufe fuer den Rang-Anker sitzt an der Stelle, wo das Universum real existiert:
// im Live-Universum-Gate des scoring-Jobs (daily-pull.yml), das einen Skip dort hart rot faerbt.
// Dateien, die das "N ok"-Format gar nicht verwenden, bleiben unberuehrt.
const NICHTS_GEPRUEFT = (out) => /(^|[^\d])0 ok\b/.test(out) && /(^|[^\d])0 fail\b/.test(out);

// N14 (Nacht-Pruef-Sweep 29.08., ENTSCHIED 29): dieselbe Bugklasse, andere
// Reporter-Familie. NICHTS_GEPRUEFT erkennt nur das EIGENFORMAT "N ok / N fail". Eine
// node:test-Datei ohne einen einzigen `test(...)`-Aufruf schreibt GAR NICHTS und endet
// mit Exit 0 — empirisch nachgefahren, beide Varianten (Datei leer, alle test() entfernt).
// Das Gate sah Exit 0 ohne "0 ok" und schrieb PASS: eine Wache, aus der jemand alle
// Pruefungen entfernt, bliebe still gruen. Wer nichts sagt, hat nichts belegt.
const STUMM = (out) => out.trim() === '';

// T170: DRITTE Auspraegung derselben Bugklasse, und die gefaehrlichste, weil sie
// wie ein normaler Lauf aussieht. Eine node:test-Datei, deren Pruefungen ALLE
// uebersprungen sind, laeuft, schreibt eine vollstaendige Bilanz und endet mit
// Exit 0. NICHTS_GEPRUEFT sucht das EIGENFORMAT "0 ok"/"0 fail" und sieht sie
// nicht; STUMM sieht sie auch nicht, weil sehr wohl Text kommt.
// EMPIRISCH NACHGEFAHREN (node v24, spec-Reporter, zwei Tests mit { skip: ... }):
//   "ℹ tests 2 / ℹ pass 0 / ℹ fail 0 / ℹ skipped 2", Exit 0, Gate-Urteil PASS.
// Betroffen sind 32 der 165 Gate-Dateien (grep -l "node:test" tests/*test.js).
//
// POSITIV-BELEG STATT WORT-SUCHE (Vorlage T147): nicht nach dem Wort fuer "nichts
// geprueft" suchen, sondern verlangen, DASS der Lauf etwas belegt hat. Die Bilanz
// muss mindestens eine BESTANDENE Pruefung ausweisen. `^\W*` faengt das
// Reporter-Praefix beider Familien ab (spec "ℹ ", TAP "# ") ohne es zu kennen.
const bilanzZahl = (out, feld) => {
  const m = new RegExp('^\\W*' + feld + '\\s+(\\d+)\\s*$', 'm').exec(out);
  return m ? Number(m[1]) : null;
};
// Die `tests`-Zeile ist die Bedingung dafuer, dass ueberhaupt eine Bilanz vorliegt:
// ohne sie wuerde eine beliebige Zeile "pass 0" irgendwo in fremder Ausgabe reichen.
const NICHTS_BELEGT = (out) =>
  bilanzZahl(out, 'tests') !== null && bilanzZahl(out, 'pass') === 0;

// Beweislauf 33289964981 (ENTSCHIED 106): GitHub liest JEDE Zeile, die mit '::'
// beginnt, als Workflow-Kommando und haengt eine Annotation an den Lauf. Das Gate
// gab bisher zwei Sorten fremden Text unveraendert weiter:
//   (a) die vollstaendige Ausgabe der Kindprozesse in runFiles, und
//   (b) im --selftest die SIMULIERTEN Gate-Zeilen seiner eigenen Negativ-Proben.
// Beide bestehen zum grossen Teil aus ABSICHTLICH roten Zeilen — genau das, was
// eine Negativ-Probe beweisen soll. Im Annotationsband des Laufs standen dadurch
// sechs erfundene Fehler ueber tests/{green,red,orphan}.test.js (Dateien, die es
// im Repo gar nicht gibt, sondern nur im Temp-Verzeichnis des Selftests), dazu die
// Proben aus t168-layer-diff und bh-b05-universe — in einem prep-Job, der GRUEN
// durchlief. Die Triage dieses Laufs ist genau daran haengengeblieben und hat eine
// Stunde lang einen Fehler im prep-Job gesucht, den es nie gab.
//
// ERSTER VERSUCH, EMPIRISCH WIDERLEGT: die Zeilen einzuruecken ('::' -> '  ::').
// Lokal sah das richtig aus (keine Zeile beginnt mehr mit '::'), im echten Lauf
// 33293190156 standen die Annotationen unveraendert da — GitHubs Parser schneidet
// fuehrenden Leerraum ab, bevor er auf '::' prueft. Die Messebene war falsch: nicht
// "faengt die Zeile mit :: an", sondern "was macht der Runner damit".
//
// JETZT GitHubs EIGENER, DOKUMENTIERTER Mechanismus fuer genau diesen Fall
// (Workflow commands, "Stopping and starting workflow commands"): ein zufaelliges,
// pro Lauf eindeutiges Token schaltet die Kommando-Verarbeitung ab und wieder an.
// Der fremde Text bleibt dadurch BYTE-IDENTISCH im Protokoll — er wird nicht
// veraendert, nur nicht mehr ausgefuehrt.
// BEWUSST NICHT umschlossen: log() im echten Lauf. '::error::Test failed: X' und
// '::error::Testdatei X laeuft in KEINEM Job' sind das Verdikt des Gates ueber den
// Kindprozess, nicht dessen eigene Rede — sie annotieren unveraendert weiter, und
// damit bleibt jeder echte Fehlschlag im Annotationsband sichtbar.
const STOPP_TOKEN = 'test-gate-' + crypto.randomUUID();

// Dieselbe Toleranz wie GitHubs Parser (fuehrender Leerraum zaehlt nicht) — sonst
// haette die Wache denselben blinden Fleck wie der widerlegte erste Versuch.
const HAT_KOMMANDO = /^[ \t]*::/m;

/** Umschliesst fremden Text mit dem stop-commands-Paar. Marker und Text gehen in
 *  EINEM Schreibvorgang raus: ein halb geschriebener Block wuerde die Kommandos
 *  fuer den Rest des Jobs abgeschaltet lassen und echte Befunde verschlucken. */
function ohneKommandos(text) {
  const mitZeilenende = text.endsWith('\n') ? text : text + '\n';
  return `::stop-commands::${STOPP_TOKEN}\n${mitZeilenende}::${STOPP_TOKEN}::\n`;
}

/** Nur umschliessen, wenn wirklich ein Kommando drinsteht — sonst stuenden zwei
 *  Marker-Zeilen um die Ausgabe jeder der ~200 Testdateien. */
const fremdeAusgabe = (text) => (HAT_KOMMANDO.test(text) ? ohneKommandos(text) : text);

// NODE_OPTIONS darf nicht pauschal entfallen: dort koennen notwendige Preloads,
// Conditions, Speichergrenzen und Permission-Flags stehen. Nur Reporter-Optionen
// werden entfernt, weil sie die maschinenlesbare TAP-Bilanz des Gates ersetzen
// koennen. Die uebrigen Roh-Tokens bleiben bytegleich erhalten.
function nodeOptionTokens(source) {
  const tokens = [];
  let i = 0;
  while (i < source.length) {
    while (i < source.length && source[i] === ' ') i++;
    if (i >= source.length) break;
    const start = i;
    let value = '';
    let quoted = false;
    while (i < source.length) {
      const char = source[i];
      if (quoted && char === '\\') {
        if (i + 1 >= source.length) {
          throw new Error('NODE_OPTIONS endet in einem unvollstaendigen Quote-Escape');
        }
        value += source[i + 1];
        i += 2;
        continue;
      }
      if (char === '"') {
        quoted = !quoted;
        i++;
        continue;
      }
      if (!quoted && char === ' ') break;
      value += char;
      i++;
    }
    if (quoted) throw new Error('NODE_OPTIONS enthaelt ein nicht geschlossenes Anfuehrungszeichen');
    tokens.push({ raw: source.slice(start, i), value });
  }
  return tokens;
}

function withoutInheritedTestReporters(source) {
  const tokens = nodeOptionTokens(source);
  const drop = new Set();
  const options = ['--test-reporter', '--test-reporter-destination'];
  for (let i = 0; i < tokens.length; i++) {
    const equalsAt = tokens[i].value.indexOf('=');
    const rawName = equalsAt === -1 ? tokens[i].value : tokens[i].value.slice(0, equalsAt);
    // Node behandelt Unterstriche in langen Optionsnamen wie Bindestriche.
    const optionName = rawName.replace(/_/g, '-');
    for (const option of options) {
      if (optionName === option && equalsAt === -1) {
        const argument = tokens[i + 1];
        if (!argument || argument.value === '' || argument.value.startsWith('-')) {
          throw new Error(`${option} in NODE_OPTIONS hat keinen sicheren Wert`);
        }
        drop.add(i);
        drop.add(i + 1);
        i++;
        break;
      }
      if (optionName === option && equalsAt !== -1) {
        if (tokens[i].value.length === equalsAt + 1) {
          throw new Error(`${option} in NODE_OPTIONS hat keinen Wert`);
        }
        drop.add(i);
        break;
      }
    }
  }
  return tokens.filter((_, index) => !drop.has(index)).map(token => token.raw).join(' ');
}

function testChildEnvironment() {
  const childEnv = { ...process.env, [NODE_TEST_PROBE_ENV]: '1' };
  // node:test setzt diesen internen Kontext bei Kindprozessen. Werte wie
  // "child-v8" erzeugen ein binaeres Ereignisprotokoll statt Reportertext und
  // duerfen deshalb nie in die eigenstaendig ausgewerteten Gate-Kinder lecken.
  const nodeTestContextKeys = Object.keys(childEnv).filter(key =>
    process.platform === 'win32' ? key.toUpperCase() === 'NODE_TEST_CONTEXT' : key === 'NODE_TEST_CONTEXT');
  for (const key of nodeTestContextKeys) delete childEnv[key];
  const nodeOptionsKeys = Object.keys(childEnv).filter(key =>
    process.platform === 'win32' ? key.toUpperCase() === 'NODE_OPTIONS' : key === 'NODE_OPTIONS');
  if (nodeOptionsKeys.length > 1) {
    throw new Error('NODE_OPTIONS ist mit mehreren Schreibweisen gesetzt');
  }
  const inherited = nodeOptionsKeys.length ? String(childEnv[nodeOptionsKeys[0]] || '') : '';
  for (const key of nodeOptionsKeys) delete childEnv[key];
  const preserved = withoutInheritedTestReporters(inherited);
  // Die Probe muss vor geerbten --require/--import-Preloads aktiv sein: auch dort
  // kann node:test bereits geladen werden. NODE_OPTIONS wird vor dem Zielskript
  // verarbeitet; der eigene Preload steht deshalb bewusst an erster Stelle.
  const probePath = NODE_TEST_PROBE_FILE.replace(/\\/g, '/');
  const probePreload = `--require="${probePath}"`;
  childEnv[NODE_OPTIONS_RESTORE_ENV] = preserved;
  childEnv.NODE_OPTIONS = preserved ? `${probePreload} ${preserved}` : probePreload;
  return childEnv;
}

function runFiles(files, cwd, log) {
  const failed = [];
  const skipped = [];
  const internalFailures = [];
  let childEnv;
  try {
    childEnv = testChildEnvironment();
  } catch (err) {
    for (const t of files) {
      internalFailures.push(t);
      log(`FAIL ${t} - NODE_OPTIONS konnte nicht sicher fuer den TAP-Reporter isoliert werden (${err.message})`);
    }
    return { failed, skipped, internalFailures };
  }
  for (const t of files) {
    log(`--- ${t} ---`);
    const r = spawnSync(process.execPath, ['--test-reporter=tap', t], {
      cwd,
      encoding: 'utf8',
      env: childEnv,
      stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
    });
    process.stdout.write(fremdeAusgabe((r.stdout || '') + (r.stderr || '')));
    const probeOutput = r.output && r.output[3] !== null && r.output[3] !== undefined
      ? String(r.output[3]).trim()
      : '';
    if (r.error || !/^[01]$/.test(probeOutput)) {
      internalFailures.push(t);
      const detail = r.error ? ` (${r.error.message})` : '';
      log(`FAIL ${t} — interne node:test-Ladeprobe lieferte keinen eindeutigen Marker${detail}`);
      continue;
    }
    if (r.status !== 0) { failed.push(t); continue; }
    const nodeTestLoaded = probeOutput === '1';
    const ausgabe = (r.stdout || '') + (r.stderr || '');
    if (NICHTS_GEPRUEFT(ausgabe)) {
      skipped.push(t);
      log(`SKIP ${t} — 0 Pruefungen ausgefuehrt (Voraussetzung fehlt), zaehlt NICHT als PASS`);
      continue;
    }
    if (STUMM(ausgabe)) {
      skipped.push(t);
      log(`SKIP ${t} — keine Ausgabe bei Exit 0 (node:test ohne einen einzigen test(...)?), zaehlt NICHT als PASS`);
      continue;
    }
    if (nodeTestLoaded
        && (bilanzZahl(ausgabe, 'tests') === null || bilanzZahl(ausgabe, 'pass') === null)) {
      skipped.push(t);
      log(`SKIP ${t} — node:test geladen, aber keine vollstaendige Testbilanz ausgegeben, zaehlt NICHT als PASS`);
      continue;
    }
    if (NICHTS_BELEGT(ausgabe)) {
      skipped.push(t);
      log(`SKIP ${t} — Bilanz weist 0 bestandene Pruefungen aus (alle uebersprungen?), zaehlt NICHT als PASS`);
      continue;
    }
    log(`PASS ${t}`);
  }
  return { failed, skipped, internalFailures };
}

/**
 * Kern-Runner. Nimmt die Listen als Argument, damit --selftest ihn mit
 * synthetischen Dateien statt der echten Listen fahren kann.
 * @returns {{code:number, lines:string[]}}
 */
function runGate({ mode, cwd, blockingGlobs, reportFiles, exemptPrefixes, blockingAlways, repoFiles, summaryFile, emit }) {
  const lines = [];
  // `lines` traegt IMMER den Rohtext — alle Proben pruefen darauf und bleiben damit
  // unberuehrt davon, wie die Zeile ausgegeben wird. `emit` faerbt nur die Ausgabe:
  // im echten Lauf console.log (annotiert), im Selftest zitiert (annotiert nicht).
  const schreib = emit || console.log;
  const log = (s) => { lines.push(s); schreib(s); };

  const report = reportFiles.filter(f => fs.existsSync(path.join(cwd, f)));
  // Die Forschungs-Spur wird aus der Glob-Expansion herausgerechnet: 'tests/*test.js'
  // erfasst die Studien-Tests sonst weiterhin und wuerde sie doppelt (und blockierend) fahren.
  const blocking = expandGlobs(blockingGlobs, cwd).filter(f => !report.includes(f));

  if (!guard({ blocking, report, exempt: exemptPrefixes, repoFiles, blockingAlways: blockingAlways || [] }, log)) {
    // skipped auch hier mitgeben: ein Aufrufer, der r.skipped.length liest, soll beim
    // Waechter-Abbruch keinen TypeError bekommen (Vertrag der Rueckgabe bleibt gleich).
    return { code: 1, lines, skipped: [] };
  }

  let code = 0;
  let anyFailed = false;
  const alleUebersprungen = [];

  if (mode === 'blocking' || mode === 'all') {
    const { failed, skipped, internalFailures } = runFiles(blocking, cwd, log);
    alleUebersprungen.push(...skipped);
    for (const t of failed) log(`::error::Test failed: ${t} — blocking run before Yahoo pull`);
    for (const t of internalFailures) log(`::error::Interner test-gate-Fehler: ${t} — node:test-Ladeprobe unbrauchbar`);
    if (failed.length || internalFailures.length) {
      anyFailed = true;
      log('::error::One or more tests failed — engine/measurement is broken, aborting run.');
      code = 1;
    }
  }

  if (mode === 'report' || mode === 'all') {
    const { failed, skipped, internalFailures } = runFiles(report, cwd, log);
    alleUebersprungen.push(...skipped);
    if (failed.length || internalFailures.length) anyFailed = true;
    for (const t of internalFailures) log(`::error::Interner test-gate-Fehler: ${t} — node:test-Ladeprobe unbrauchbar`);
    if (internalFailures.length) code = 1;
    if (mode === 'all') {
      // Im PR-Check blockt BEIDES: Zweck ist Sichtbarkeit vor dem Merge, und
      // mangels Merge-Sperre kann dieser Job niemanden aufhalten.
      for (const t of failed) log(`::error::Test failed: ${t} — Forschungs-Bestand rot (PR-Check)`);
      if (failed.length) code = 1;
    } else {
      for (const t of failed) log(`::warning::FORSCHUNGS-BESTAND ROT: ${t}`);
      if (failed.length) {
        const summary = `FORSCHUNGS-BESTAND ROT: ${failed.length} Datei(en) — ${failed.join(', ')} (meldend, blockt den Preis-Abruf nicht)`;
        log(summary);
        if (summaryFile) fs.appendFileSync(summaryFile, summary + '\n');
      }
      // Exitcode im report-Modus IMMER 0 — nur Test-Fehlschlaege sind folgenlos,
      // interne Gate-Fehler (oben) bleiben exit 1.
    }
  }

  // Die Uebersprungenen NAMENTLICH und mit Zahl ausweisen — sonst liest sich ein Lauf, in dem
  // ein Waechter nichts geprueft hat, genauso wie einer, in dem alles geprueft wurde.
  if (alleUebersprungen.length) {
    log(`UEBERSPRUNGEN (0 Pruefungen ausgefuehrt, zaehlen NICHT als PASS): ${alleUebersprungen.length} — ${alleUebersprungen.join(', ')}`);
  }
  if (!anyFailed) {
    log(alleUebersprungen.length
      ? `All tests passed — ABER ${alleUebersprungen.length} Datei(en) haben nichts geprueft (siehe UEBERSPRUNGEN).`
      : 'All tests passed.');
  }
  return { code, lines, skipped: alleUebersprungen };
}

// ── Selftest (Waechter-Hausregel: der Pruefer wird selbst geprueft) ───────────

function selftest() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-gate-selftest-'));
  fs.mkdirSync(path.join(dir, 'tests'));
  const green = 'tests/green.test.js';
  const red = 'tests/red.test.js';
  const orphan = 'tests/orphan.test.js';
  // Tag 956: Datei, die sauber endet, aber selbst meldet NICHTS geprueft zu haben —
  // exakt die Ausgabeform von anchors.rank.test.js bei leerem snapshots/.
  const leer = 'tests/leer.test.js';
  // N14: die andere Reporter-Familie — node:test. Eine Datei ohne einen einzigen
  // test(...)-Aufruf schreibt GAR NICHTS und endet mit 0; das Eigenformat "N ok/N fail"
  // taucht nie auf, NICHTS_GEPRUEFT kann sie also gar nicht sehen.
  const stumm = 'tests/stumm.test.js';
  // H49: node:test wird geladen, aber nur Setup-Ausgabe erzeugt. Ohne registrierte
  // Pruefung fehlt die Bilanz; die Ausgabe darf den leeren Lauf nicht als PASS tarnen.
  const lautOhneTests = 'tests/laut-ohne-tests.test.js';
  const lautDynamisch = 'tests/laut-dynamisch.test.js';
  const eigenformatKoeder = 'tests/eigenformat-koeder.test.js';
  const aufloesungsKoeder = 'tests/aufloesungs-koeder.test.js';
  const markerFehlt = 'tests/marker-fehlt.test.js';
  const probeEnvLeak = 'tests/probe-env-leak.test.js';
  const nodetest = 'tests/nodetest.test.js';
  const neutralPreload = 'neutral-preload.js';
  const preload = 'preload.js';
  const preloadNodetest = 'tests/preload-nodetest.test.js';
  const preloadOnlyNodetest = 'tests/preload-only-nodetest.test.js';
  // T170: eine node:test-Datei, deren Pruefungen ALLE uebersprungen sind. Sie
  // schreibt eine vollstaendige Bilanz (tests 1 / pass 0 / skipped 1) und endet
  // mit Exit 0 - an NICHTS_GEPRUEFT und an STUMM laeuft sie beide vorbei.
  const uebersprungen = 'tests/uebersprungen.test.js';
  const neutralPreloadPath = path.join(dir, neutralPreload).replace(/\\/g, '/');
  const transitiveNodeOptions = `--require="${neutralPreloadPath}" --conditions="gate\\probe"`;
  const gateEntryPath = __filename.replace(/\\/g, '/');
  fs.writeFileSync(path.join(dir, green), 'console.log("3 ok, 0 fail");process.exit(0);\n');
  fs.writeFileSync(path.join(dir, red), 'process.exit(1);\n');
  fs.writeFileSync(path.join(dir, orphan), 'console.log("1 ok, 0 fail");process.exit(0);\n');
  fs.writeFileSync(path.join(dir, leer),
    'console.log("leer.test.js: 0 ok, 0 fail (skipped: kein Universum)");process.exit(0);\n');
  fs.writeFileSync(path.join(dir, stumm), "'use strict';\nrequire('node:test');\n");
  fs.writeFileSync(path.join(dir, lautOhneTests),
    "'use strict';\nconst test=require('node:test');\nconsole.log('setup noise');\n");
  fs.writeFileSync(path.join(dir, lautDynamisch),
    "'use strict';\n(async()=>{const id=['node','test'].join(':');await import(id);"
    + "console.log('dynamic setup noise');})().catch(e=>{console.error(e);process.exitCode=1;});\n");
  fs.writeFileSync(path.join(dir, eigenformatKoeder),
    "'use strict';\nconst decoy=`\nconst test=require('node:test');\n`;\n"
    + "console.log('custom: 1 ok, 0 fail');\n");
  fs.writeFileSync(path.join(dir, aufloesungsKoeder),
    "'use strict';\nrequire.resolve('node:test');\nconsole.log('custom: 1 ok, 0 fail');\n");
  fs.writeFileSync(path.join(dir, markerFehlt),
    "'use strict';\nrequire('fs').closeSync(3);\nconsole.log('custom: 1 ok, 0 fail');\n");
  fs.writeFileSync(path.join(dir, neutralPreload),
    "'use strict';\nprocess.env.TEST_GATE_NEUTRAL_PRELOAD_PID=String(process.pid);\n");
  fs.writeFileSync(path.join(dir, probeEnvLeak), [
    "'use strict';",
    "const { spawnSync } = require('node:child_process');",
    "const { Worker } = require('node:worker_threads');",
    `const expectedOptions = ${JSON.stringify(transitiveNodeOptions)};`,
    `const gateEntry = ${JSON.stringify(gateEntryPath)};`,
    "const fail=(message)=>{console.error(message);process.exit(1);};",
    "if(process.env.NODE_OPTIONS!==expectedOptions)fail('NODE_OPTIONS nicht wiederhergestellt: '+String(process.env.NODE_OPTIONS));",
    `if(process.env[${JSON.stringify(NODE_TEST_PROBE_ENV)}]!==undefined)fail('Probe-Sentinel geleakt');`,
    `if(process.env[${JSON.stringify(NODE_OPTIONS_RESTORE_ENV)}]!==undefined)fail('Restore-Sentinel geleakt');`,
    "if(process.env.TEST_GATE_NEUTRAL_PRELOAD_PID!==String(process.pid))fail('Neutraler Preload lief im Ziel nicht');",
    "const grandchild=spawnSync(process.execPath,['-e',"
      + "'process.exit(process.env.TEST_GATE_NEUTRAL_PRELOAD_PID===String(process.pid)?0:1)'],{stdio:'pipe'});",
    "if(grandchild.status!==0)fail('Bereinigte Optionen erreichten den Enkelprozess nicht');",
    "const worker=new Worker(gateEntry,{stdout:true,stderr:true});",
    "let workerOutput='';",
    "worker.stdout.on('data',(chunk)=>{workerOutput+=String(chunk);});",
    "worker.stderr.on('data',(chunk)=>{workerOutput+=String(chunk);});",
    "worker.on('error',(err)=>{workerOutput+=String(err);});",
    "worker.on('exit',(code)=>{",
    "  if(code!==1||!workerOutput.includes('::error::Aufruf:'))fail('Gate-Einstieg im Worker war vorab gecacht: '+code+' '+workerOutput);",
    "  console.log('custom: 1 ok, 0 fail');",
    "});",
  ].join('\n') + '\n');
  fs.writeFileSync(path.join(dir, nodetest),
    "'use strict';\nconst test=require('node:test');\nconsole.log('setup noise');\ntest('echt', () => {});\n");
  fs.writeFileSync(path.join(dir, preload),
    "'use strict';\nrequire('node:test');\nglobal.__testGatePreloadPreserved = true;\n");
  fs.writeFileSync(path.join(dir, preloadNodetest),
    "'use strict';\nconst test=require('node:test');\nconst assert=require('node:assert/strict');\n"
    + "test('preload bleibt erhalten',()=>assert.equal(global.__testGatePreloadPreserved,true));\n");
  fs.writeFileSync(path.join(dir, preloadOnlyNodetest),
    "'use strict';\nconsole.log('custom: 1 ok, 0 fail');\n");

  // T170: die Datei, die wie ein normaler Lauf AUSSIEHT - sie redet (also nicht
  // STUMM), sie endet mit 0, und sie hat trotzdem nichts geprueft.
  fs.writeFileSync(path.join(dir, uebersprungen),
    "'use strict';\nconst test=require('node:test');\n"
    + "test('nie', { skip: 'Voraussetzung fehlt' }, () => { throw new Error('x'); });\n");

  const summaryFile = path.join(dir, 'summary.txt');
  // emit: die Proben simulieren rote Gate-Laeufe. Deren '::error::'/'::warning::'
  // sind Beweismittel, keine Befunde ueber dieses Repo — sie duerfen den Lauf nicht
  // annotieren. Die Pruefungen unten lesen r.lines (Rohtext) und merken davon nichts.
  const base = {
    cwd: dir, exemptPrefixes: [], summaryFile,
    emit: (s) => process.stdout.write(HAT_KOMMANDO.test(s) ? ohneKommandos(s) : s + '\n'),
  };
  const fails = [];
  const check = (name, ok, detail) => {
    console.log(`${ok ? 'PASS' : 'FAIL'} selftest: ${name}${ok ? '' : ' — ' + detail}`);
    if (!ok) fails.push(name);
  };

  // 1. Ausbau-Probe: roter Test in der blockierenden Spur MUSS stoppen.
  let r = runGate({
    ...base, mode: 'blocking',
    blockingGlobs: ['tests/red*test.js'], reportFiles: [], repoFiles: [red],
  });
  check('Ausbau-Probe (rot blockierend stoppt)',
    r.code !== 0 && r.lines.some(l => l.startsWith('::error::') && l.includes(red)),
    `code=${r.code}`);

  // 2. Anwesenheits-Probe: roter Test in der Forschungs-Spur meldet, blockt aber nie.
  r = runGate({
    ...base, mode: 'report',
    blockingGlobs: [], reportFiles: [red], repoFiles: [red],
  });
  const summaryTxt = fs.existsSync(summaryFile) ? fs.readFileSync(summaryFile, 'utf8') : '';
  check('Anwesenheits-Probe (rot meldend blockt nicht)',
    r.code === 0
    && r.lines.some(l => l.startsWith('::warning::') && l.includes(red))
    && /ROT: [1-9]\d* Datei/.test(summaryTxt),
    `code=${r.code} summary=${JSON.stringify(summaryTxt)}`);

  // 3. Gegenprobe: gueltige Form muss durchgehen — in BEIDEN Spuren, ohne Meldung.
  r = runGate({
    ...base, mode: 'blocking',
    blockingGlobs: ['tests/green*test.js'], reportFiles: [], repoFiles: [green],
  });
  let ok = r.code === 0 && !r.lines.some(l => l.startsWith('::error::') || l.startsWith('::warning::'));
  r = runGate({
    ...base, mode: 'report',
    blockingGlobs: [], reportFiles: [green], repoFiles: [green],
  });
  ok = ok && r.code === 0 && !r.lines.some(l => l.startsWith('::error::') || l.startsWith('::warning::'));
  check('Gegenprobe (gruen geht in beiden Spuren durch)', ok, `code=${r.code}`);

  // 4. Waechter-Erhalt: Datei in keiner Liste und nicht exempt => rot.
  r = runGate({
    ...base, mode: 'blocking',
    blockingGlobs: ['tests/green*test.js'], reportFiles: [], repoFiles: [green, orphan],
  });
  check('Waechter-Erhalt (ungegatete Datei faellt auf)',
    r.code !== 0 && r.lines.some(l => l.includes(orphan) && l.startsWith('::error::')),
    `code=${r.code}`);

  // 5. Waechter-Abrutsch: eine Datei, die blockierend bleiben MUSS, steht in der
  //    Forschungs-Spur => rot (ein Waechter darf nicht still zur blossen Meldung werden).
  r = runGate({
    ...base, mode: 'report',
    blockingGlobs: ['tests/green*test.js'], reportFiles: [green], blockingAlways: [green],
    repoFiles: [green],
  });
  check('Abrutsch-Probe (Pflicht-Blocker in Forschungs-Spur faellt auf)',
    r.code !== 0 && r.lines.some(l => l.startsWith('::error::') && l.includes(green)),
    `code=${r.code}`);

  // 5b. Gegenprobe dazu: derselbe Pflicht-Blocker regulaer in der blockierenden Spur
  //     muss DURCHGEHEN (sonst prueft 5. nur, dass irgendwas immer rot ist).
  r = runGate({
    ...base, mode: 'blocking',
    blockingGlobs: ['tests/green*test.js'], reportFiles: [], blockingAlways: [green],
    repoFiles: [green],
  });
  check('Abrutsch-Gegenprobe (Pflicht-Blocker blockierend geht durch)', r.code === 0, `code=${r.code}`);

  // 6. Leer-Probe (Tag 956): eine Datei, die 0 Pruefungen ausgefuehrt hat, MUSS als SKIP
  //    erscheinen, NICHT als PASS — und in der Summenzeile gezaehlt werden. Sie darf den
  //    Lauf aber nicht rot faerben (leeres Universum ist pre-pull der Normalzustand).
  r = runGate({
    ...base, mode: 'blocking',
    blockingGlobs: ['tests/leer*test.js'], reportFiles: [], repoFiles: [leer],
  });
  check('Leer-Probe (0 Pruefungen zaehlt als SKIP, nicht als PASS)',
    r.code === 0
    && r.skipped.length === 1
    && !r.lines.some(l => l.startsWith(`PASS ${leer}`))
    && r.lines.some(l => l.startsWith(`SKIP ${leer}`))
    && r.lines.some(l => l.startsWith('UEBERSPRUNGEN') && l.includes(leer)),
    `code=${r.code} skipped=${JSON.stringify(r.skipped)}`);

  // 6b. Gegenprobe dazu: eine Datei MIT ausgefuehrten Pruefungen muss weiter PASS sein und
  //     darf NICHT in der Uebersprungen-Liste landen (sonst pruefte 6. nur, dass alles skippt).
  r = runGate({
    ...base, mode: 'blocking',
    blockingGlobs: ['tests/green*test.js'], reportFiles: [], repoFiles: [green],
  });
  check('Leer-Gegenprobe (Datei mit echten Pruefungen bleibt PASS)',
    r.code === 0 && r.skipped.length === 0
    && r.lines.some(l => l.startsWith(`PASS ${green}`))
    && !r.lines.some(l => l.startsWith('UEBERSPRUNGEN')),
    `code=${r.code} skipped=${JSON.stringify(r.skipped)}`);

  // 6c. Stumm-Probe (N14): eine node:test-Datei OHNE einen einzigen test(...)-Aufruf
  //     schreibt nichts und endet mit Exit 0. Sie darf nicht als PASS durchgehen —
  //     sonst bleibt eine Wache, aus der jemand alle Pruefungen entfernt, still gruen.
  r = runGate({
    ...base, mode: 'blocking',
    blockingGlobs: ['tests/stumm*test.js'], reportFiles: [], repoFiles: [stumm],
  });
  check('Stumm-Probe (node:test ohne Tests zaehlt als SKIP, nicht als PASS)',
    r.code === 0
    && r.skipped.length === 1
    && !r.lines.some(l => l.startsWith(`PASS ${stumm}`))
    && r.lines.some(l => l.startsWith(`SKIP ${stumm}`))
    && r.lines.some(l => l.startsWith('UEBERSPRUNGEN') && l.includes(stumm)),
    `code=${r.code} skipped=${JSON.stringify(r.skipped)}`);

  // 6d. H49-Probe: Setup-Ausgabe macht die leere node:test-Datei zwar laut, belegt
  //     aber weiterhin keine ausgefuehrte Pruefung. Sie muss als SKIP sichtbar sein.
  r = runGate({
    ...base, mode: 'blocking',
    blockingGlobs: ['tests/laut-ohne-tests*test.js'], reportFiles: [], repoFiles: [lautOhneTests],
  });
  check('Laut-null-Probe (node:test mit Setup-Ausgabe ohne Tests zaehlt als SKIP)',
    r.code === 0
    && r.skipped.length === 1
    && !r.lines.some(l => l.startsWith(`PASS ${lautOhneTests}`))
    && r.lines.some(l => l.startsWith(`SKIP ${lautOhneTests}`))
    && r.lines.some(l => l.startsWith('UEBERSPRUNGEN') && l.includes(lautOhneTests)),
    `code=${r.code} skipped=${JSON.stringify(r.skipped)}`);

  // 6e. Dieselbe Luecke ueber einen dynamisch berechneten Import: Quelltextsuche
  //     reicht als Beleg nicht, entscheidend ist das wirkliche Laden zur Laufzeit.
  r = runGate({
    ...base, mode: 'blocking',
    blockingGlobs: ['tests/laut-dynamisch*test.js'], reportFiles: [], repoFiles: [lautDynamisch],
  });
  check('Laut-dynamisch-Probe (wirklich geladenes node:test ohne Tests zaehlt als SKIP)',
    r.code === 0
    && r.skipped.length === 1
    && !r.lines.some(l => l.startsWith(`PASS ${lautDynamisch}`))
    && r.lines.some(l => l.startsWith(`SKIP ${lautDynamisch}`)),
    `code=${r.code} skipped=${JSON.stringify(r.skipped)}`);

  // 6f. Gegenprobe gegen Regex-/String-Suche: derselbe Require-Text in einem
  //     Template-Literal laedt node:test nicht; der Eigenformat-Runner bleibt PASS.
  r = runGate({
    ...base, mode: 'blocking',
    blockingGlobs: ['tests/eigenformat-koeder*test.js'], reportFiles: [], repoFiles: [eigenformatKoeder],
  });
  check('Laut-null-Gegenprobe (node:test-Text ohne Runtime-Load bleibt PASS)',
    r.code === 0 && r.skipped.length === 0
    && r.lines.some(l => l.startsWith(`PASS ${eigenformatKoeder}`)),
    `code=${r.code} skipped=${JSON.stringify(r.skipped)}`);

  // 6g. Aufloesen ist noch kein Laden: require.resolve darf einen Eigenformat-Runner
  //     nicht zur node:test-Suite umetikettieren.
  r = runGate({
    ...base, mode: 'blocking',
    blockingGlobs: ['tests/aufloesungs-koeder*test.js'], reportFiles: [], repoFiles: [aufloesungsKoeder],
  });
  check('Aufloesungs-Gegenprobe (require.resolve ohne Runtime-Load bleibt PASS)',
    r.code === 0 && r.skipped.length === 0
    && r.lines.some(l => l.startsWith(`PASS ${aufloesungsKoeder}`)),
    `code=${r.code} skipped=${JSON.stringify(r.skipped)}`);

  // 6h. Interner Protokollbruch bleibt auch in der bloss meldenden Forschungs-Spur
  //     hart rot. Ein Testfehler darf dort warnen; ein kaputtes Gate niemals.
  r = runGate({
    ...base, mode: 'report',
    blockingGlobs: [], reportFiles: [markerFehlt], repoFiles: [markerFehlt],
  });
  check('Ladeproben-Probe (fehlender Marker ist interner Fehler und blockt report)',
    r.code === 1 && r.skipped.length === 0
    && r.lines.some(l => l.startsWith(`FAIL ${markerFehlt}`) && l.includes('interne node:test-Ladeprobe'))
    && r.lines.some(l => l.startsWith('::error::Interner test-gate-Fehler:') && l.includes(markerFehlt))
    && !r.lines.some(l => l.startsWith(`PASS ${markerFehlt}`) || l.startsWith(`SKIP ${markerFehlt}`))
    && !r.lines.some(l => l.startsWith('::warning::FORSCHUNGS-BESTAND ROT:') && l.includes(markerFehlt)),
    `code=${r.code} skipped=${JSON.stringify(r.skipped)}`);

  // 6i. Das eigene Probe-Modul darf weder Umgebungsdaten in Prozess-Enkel lecken
  //     noch test-gate.js selbst in einem Worker vorab cachen. Gleichzeitig muss
  //     die bereinigte fremde Laufzeitkonfiguration transitiv erhalten bleiben.
  const transitiveOptionKeys = Object.keys(process.env).filter(key =>
    process.platform === 'win32' ? key.toUpperCase() === 'NODE_OPTIONS' : key === 'NODE_OPTIONS');
  const previousTransitiveOptions = transitiveOptionKeys.map(key => [key, process.env[key]]);
  for (const key of transitiveOptionKeys) delete process.env[key];
  const transitiveOptionKey = process.platform === 'win32' ? 'Node_Options' : 'NODE_OPTIONS';
  process.env[transitiveOptionKey] = transitiveNodeOptions;
  try {
    r = runGate({
      ...base, mode: 'blocking',
      blockingGlobs: ['tests/probe-env-leak*test.js'], reportFiles: [], repoFiles: [probeEnvLeak],
    });
  } finally {
    const currentTransitiveKeys = Object.keys(process.env).filter(key =>
      process.platform === 'win32' ? key.toUpperCase() === 'NODE_OPTIONS' : key === 'NODE_OPTIONS');
    for (const key of currentTransitiveKeys) delete process.env[key];
    for (const [key, value] of previousTransitiveOptions) process.env[key] = value;
  }
  check('Probe-Umgebungs-Probe (Optionen bleiben transitiv; Gate-Worker ist nicht vorab gecacht)',
    r.code === 0 && r.skipped.length === 0
    && r.lines.some(l => l.startsWith(`PASS ${probeEnvLeak}`)),
    `code=${r.code} skipped=${JSON.stringify(r.skipped)}`);

  // 6j. Eine ECHTE node:test-Datei mit derselben Setup-Ausgabe bleibt PASS, selbst
  //     wenn der Aufrufer per NODE_OPTIONS den beweislosen dot-Reporter verlangt.
  const vorherigeNodeOptions = process.env.NODE_OPTIONS;
  process.env.NODE_OPTIONS = '--test-reporter=dot';
  try {
    r = runGate({
      ...base, mode: 'blocking',
      blockingGlobs: ['tests/nodetest*test.js'], reportFiles: [], repoFiles: [nodetest],
    });
  } finally {
    if (vorherigeNodeOptions === undefined) delete process.env.NODE_OPTIONS;
    else process.env.NODE_OPTIONS = vorherigeNodeOptions;
  }
  check('Reporter-Gegenprobe (echte node:test-Datei bleibt mit geerbtem dot-Wunsch PASS)',
    r.code === 0 && r.skipped.length === 0
    && r.lines.some(l => l.startsWith(`PASS ${nodetest}`)),
    `code=${r.code} skipped=${JSON.stringify(r.skipped)}`);

  // 6k. Reporter-Isolation darf nur Reporter-Flags entfernen. Ein geerbter
  //      --require-Preload muss weiter laufen. Unter Windows verwendet die Probe
  //      absichtlich gemischte Gross-/Kleinschreibung des Umgebungsnamens.
  const nodeOptionsKeys = Object.keys(process.env).filter(key =>
    process.platform === 'win32' ? key.toUpperCase() === 'NODE_OPTIONS' : key === 'NODE_OPTIONS');
  const previousNodeOptions = nodeOptionsKeys.map(key => [key, process.env[key]]);
  for (const key of nodeOptionsKeys) delete process.env[key];
  const probeNodeOptionsKey = process.platform === 'win32' ? 'Node_Options' : 'NODE_OPTIONS';
  const preloadOptionPath = path.join(dir, preload).replace(/\\/g, '/');
  const inheritedOptionProbe = `--require="${preloadOptionPath}" "--test_reporter\\=dot"`
    + ' "--test_reporter_destination\\=stderr" --conditions="gate\\probe"';
  const expectedPreservedOptions = `--require="${preloadOptionPath}" --conditions="gate\\probe"`;
  process.env[probeNodeOptionsKey] = inheritedOptionProbe;
  let preloadResult;
  let preloadOnlyResult;
  try {
    preloadResult = runGate({
      ...base, mode: 'blocking',
      blockingGlobs: ['tests/preload-nodetest*test.js'], reportFiles: [], repoFiles: [preloadNodetest],
    });
    preloadOnlyResult = runGate({
      ...base, mode: 'blocking',
      blockingGlobs: ['tests/preload-only-nodetest*test.js'], reportFiles: [], repoFiles: [preloadOnlyNodetest],
    });
  } finally {
    const currentNodeOptionsKeys = Object.keys(process.env).filter(key =>
      process.platform === 'win32' ? key.toUpperCase() === 'NODE_OPTIONS' : key === 'NODE_OPTIONS');
    for (const key of currentNodeOptionsKeys) delete process.env[key];
    for (const [key, value] of previousNodeOptions) process.env[key] = value;
  }
  check('Reporter-Erhalt-Probe (Preload bleibt trotz Reporter-Isolation aktiv)',
    preloadResult.code === 0 && preloadResult.skipped.length === 0
    && withoutInheritedTestReporters(inheritedOptionProbe) === expectedPreservedOptions
    && preloadResult.lines.some(l => l.startsWith(`PASS ${preloadNodetest}`)),
    `code=${preloadResult.code} skipped=${JSON.stringify(preloadResult.skipped)}`);

  // 6l. Der geerbte Preload kann selbst node:test laden. Die Ladeprobe muss davor
  //      aktiv sein; ein anschliessender Eigenformat-Runner darf sonst falsch PASSen.
  check('Preload-Reihenfolge-Probe (node:test nur im geerbten Preload zaehlt als SKIP)',
    preloadOnlyResult.code === 0 && preloadOnlyResult.skipped.length === 1
    && !preloadOnlyResult.lines.some(l => l.startsWith(`PASS ${preloadOnlyNodetest}`))
    && preloadOnlyResult.lines.some(l => l.startsWith(`SKIP ${preloadOnlyNodetest}`)),
    `code=${preloadOnlyResult.code} skipped=${JSON.stringify(preloadOnlyResult.skipped)}`);

  // 6m. Ein uebergeordneter node:test-Runner setzt NODE_TEST_CONTEXT. Der interne
  //      child-v8-Wert darf weder die TAP-Bilanz noch rote Exitcodes veraendern.
  const contextKeys = Object.keys(process.env).filter(key =>
    process.platform === 'win32' ? key.toUpperCase() === 'NODE_TEST_CONTEXT' : key === 'NODE_TEST_CONTEXT');
  const previousContexts = contextKeys.map(key => [key, process.env[key]]);
  for (const key of contextKeys) delete process.env[key];
  const contextProbeKey = process.platform === 'win32' ? 'Node_Test_Context' : 'NODE_TEST_CONTEXT';
  process.env[contextProbeKey] = 'child-v8';
  let contextPassResult;
  let contextRedResult;
  try {
    contextPassResult = runGate({
      ...base, mode: 'blocking',
      blockingGlobs: ['tests/nodetest*test.js'], reportFiles: [], repoFiles: [nodetest],
    });
    contextRedResult = runGate({
      ...base, mode: 'blocking',
      blockingGlobs: ['tests/red*test.js'], reportFiles: [], repoFiles: [red],
    });
  } finally {
    const currentContextKeys = Object.keys(process.env).filter(key =>
      process.platform === 'win32' ? key.toUpperCase() === 'NODE_TEST_CONTEXT' : key === 'NODE_TEST_CONTEXT');
    for (const key of currentContextKeys) delete process.env[key];
    for (const [key, value] of previousContexts) process.env[key] = value;
  }
  check('Runner-Kontext-Probe (child-v8 wird isoliert; gruen PASS und rot bleibt rot)',
    contextPassResult.code === 0 && contextPassResult.skipped.length === 0
    && contextPassResult.lines.some(l => l.startsWith(`PASS ${nodetest}`))
    && contextRedResult.code === 1
    && contextRedResult.lines.some(l => l.startsWith('::error::Test failed:') && l.includes(red)),
    `green=${contextPassResult.code}/${JSON.stringify(contextPassResult.skipped)} red=${contextRedResult.code}`);

  // 6n. T170-Probe: alle Pruefungen uebersprungen -> SKIP, nicht PASS. Das ist die
  //     Luecke, durch die eine Wache still gruen bleibt, aus der jemand die
  //     Voraussetzung entfernt hat. Betrifft real 32 der 165 Gate-Dateien.
  r = runGate({
    ...base, mode: 'blocking',
    blockingGlobs: ['tests/uebersprungen*test.js'], reportFiles: [], repoFiles: [uebersprungen],
  });
  check('T170-Probe (node:test mit 0 bestandenen Pruefungen zaehlt als SKIP)',
    r.code === 0
    && r.skipped.length === 1
    && !r.lines.some(l => l.startsWith(`PASS ${uebersprungen}`))
    && r.lines.some(l => l.startsWith(`SKIP ${uebersprungen}`))
    && r.lines.some(l => l.startsWith('UEBERSPRUNGEN') && l.includes(uebersprungen)),
    `code=${r.code} skipped=${JSON.stringify(r.skipped)}`);

  // 6o. Gegenprobe, ohne die 6n jede node:test-Suite im Repo falsch faerben wuerde:
  //     dieselbe Reporter-Familie MIT einer bestandenen Pruefung bleibt PASS. Die
  //     Stumm-Gegenprobe deckt das nicht ab - sie prueft eine Datei OHNE Bilanz,
  //     hier geht es um eine Bilanz mit pass >= 1.
  r = runGate({
    ...base, mode: 'blocking',
    blockingGlobs: ['tests/nodetest*test.js'], reportFiles: [], repoFiles: [nodetest],
  });
  check('T170-Gegenprobe (node:test mit bestandener Pruefung bleibt PASS)',
    r.code === 0 && r.skipped.length === 0
    && r.lines.some(l => l.startsWith(`PASS ${nodetest}`)),
    `code=${r.code} skipped=${JSON.stringify(r.skipped)}`);

  fs.rmSync(dir, { recursive: true, force: true });
  if (fails.length) {
    console.log(`::error::test-gate Selftest FAILED: ${fails.join(', ')}`);
    return 1;
  }
  console.log('test-gate Selftest OK (21 Proben).');
  return 0;
}

// ── main ─────────────────────────────────────────────────────────────────────

function main(argv) {
  if (argv.includes('--selftest')) return selftest();
  const modeArg = argv.find(a => a.startsWith('--mode='));
  const mode = modeArg ? modeArg.slice('--mode='.length) : '';
  if (!['blocking', 'report', 'all'].includes(mode)) {
    console.log('::error::Aufruf: node scripts/test-gate.js --mode=blocking|report|all | --selftest');
    return 1;
  }
  const cwd = process.cwd();
  let repoFiles;
  try {
    repoFiles = listRepoTestFiles(cwd);
  } catch (err) {
    console.log(`::error::git ls-files fehlgeschlagen: ${err.message}`);
    return 1;
  }
  const { code } = runGate({
    mode, cwd,
    blockingGlobs: BLOCKING_GLOBS,
    reportFiles: REPORT_FILES,
    exemptPrefixes: EXEMPT_PREFIXES,
    blockingAlways: BLOCKING_ALWAYS,
    repoFiles,
    summaryFile: process.env.GITHUB_STEP_SUMMARY || null,
  });
  return code;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));

module.exports = { runGate, expandGlobs, listRepoTestFiles, BLOCKING_GLOBS, REPORT_FILES, EXEMPT_PREFIXES, BLOCKING_ALWAYS };

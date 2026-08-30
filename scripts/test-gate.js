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
const fs = require('fs');
const os = require('os');
const path = require('path');

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
// Regel: nur was DIESES Skript selbst als Verdikt ausspricht, darf annotieren.
// Fremder Text wird zitiert statt ausgefuehrt — er bleibt vollstaendig und
// unveraendert im Protokoll lesbar, er kommandiert nur nichts mehr.
// BEWUSST NICHT entschaerft: log() im echten Lauf. '::error::Test failed: X' und
// '::error::Testdatei X laeuft in KEINEM Job' sind das Verdikt des Gates ueber den
// Kindprozess, nicht dessen eigene Rede — sie annotieren unveraendert weiter, und
// damit bleibt jeder echte Fehlschlag im Annotationsband sichtbar.
const zitiert = (text) => text.replace(/^::/gm, '  ::');

function runFiles(files, cwd, log) {
  const failed = [];
  const skipped = [];
  for (const t of files) {
    log(`--- ${t} ---`);
    const r = spawnSync(process.execPath, [t], { cwd, encoding: 'utf8' });
    process.stdout.write(zitiert((r.stdout || '') + (r.stderr || '')));
    if (r.status !== 0) { failed.push(t); continue; }
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
    log(`PASS ${t}`);
  }
  return { failed, skipped };
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
    const { failed, skipped } = runFiles(blocking, cwd, log);
    alleUebersprungen.push(...skipped);
    for (const t of failed) log(`::error::Test failed: ${t} — blocking run before Yahoo pull`);
    if (failed.length) {
      anyFailed = true;
      log('::error::One or more tests failed — engine/measurement is broken, aborting run.');
      code = 1;
    }
  }

  if (mode === 'report' || mode === 'all') {
    const { failed, skipped } = runFiles(report, cwd, log);
    alleUebersprungen.push(...skipped);
    if (failed.length) anyFailed = true;
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
  const nodetest = 'tests/nodetest.test.js';
  fs.writeFileSync(path.join(dir, green), 'console.log("3 ok, 0 fail");process.exit(0);\n');
  fs.writeFileSync(path.join(dir, red), 'process.exit(1);\n');
  fs.writeFileSync(path.join(dir, orphan), 'console.log("1 ok, 0 fail");process.exit(0);\n');
  fs.writeFileSync(path.join(dir, leer),
    'console.log("leer.test.js: 0 ok, 0 fail (skipped: kein Universum)");process.exit(0);\n');
  fs.writeFileSync(path.join(dir, stumm), "'use strict';\nrequire('node:test');\n");
  fs.writeFileSync(path.join(dir, nodetest),
    "'use strict';\nconst test=require('node:test');\ntest('echt', () => {});\n");

  const summaryFile = path.join(dir, 'summary.txt');
  // emit: die Proben simulieren rote Gate-Laeufe. Deren '::error::'/'::warning::'
  // sind Beweismittel, keine Befunde ueber dieses Repo — sie duerfen den Lauf nicht
  // annotieren. Die Pruefungen unten lesen r.lines (Rohtext) und merken davon nichts.
  const base = { cwd: dir, exemptPrefixes: [], summaryFile, emit: (s) => console.log(zitiert(s)) };
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

  // 6d. Gegenprobe dazu: eine ECHTE node:test-Datei mit ausgefuehrten Tests redet und
  //     muss weiterhin PASS sein — sonst faerbt 6c jede node:test-Suite im Repo falsch.
  r = runGate({
    ...base, mode: 'blocking',
    blockingGlobs: ['tests/nodetest*test.js'], reportFiles: [], repoFiles: [nodetest],
  });
  check('Stumm-Gegenprobe (echte node:test-Datei bleibt PASS)',
    r.code === 0 && r.skipped.length === 0
    && r.lines.some(l => l.startsWith(`PASS ${nodetest}`)),
    `code=${r.code} skipped=${JSON.stringify(r.skipped)}`);

  fs.rmSync(dir, { recursive: true, force: true });
  if (fails.length) {
    console.log(`::error::test-gate Selftest FAILED: ${fails.join(', ')}`);
    return 1;
  }
  console.log('test-gate Selftest OK (10 Proben).');
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

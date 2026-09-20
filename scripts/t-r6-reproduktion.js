#!/usr/bin/env node
'use strict';

// Offline preflight for the supplied run-35500025507 artifact. Missing required
// inputs are a completed measurement result, not permission to fabricate a row.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { readHashed } = require('../lib/druckenmiller/registration.js');

const root = path.resolve(__dirname, '..');
const scratch = 'C:/Users/Anwender/AppData/Local/Temp/claude/C--Users-Anwender-Market-Structure-research/754a849d-444e-4e77-98cd-1d62ad581fad/scratchpad';
const population = path.join(scratch, 'ci-pop-35500025507');
const outputRow = path.join(scratch, 'r6-repro', 'internals-2026-09-18.jsonl');
const report = path.join(root, 'reports/t-r6-reproduktion-20260918-2026-09-20.md');
const ledger = path.join(root, 'druckenmiller-history/internals-ledger.jsonl');
const expectedDigest = '316e73c85f9727e1a9c26801054966648fd1ad2a9a324ce29ed71ad20a50bb06';
const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const status = () => execFileSync('git', ['status', '--porcelain', '--untracked-files=normal'],
  { cwd: root, encoding: 'utf8' }).trimEnd();
const targets = new Set([
  '?? scripts/t-r6-reproduktion.js',
  '?? reports/t-r6-reproduktion-20260918-2026-09-20.md',
]);
const baseline = [
  '?? .codex-worktrees/', '?? reports/f24-streak.json', '?? reports/f24-streak.md',
];
function checkStatus(text) {
  assert.deepEqual(text.split(/\r?\n/).filter((line) => !targets.has(line)).sort(),
    baseline.slice().sort(), 'Unexpected repository changes; stop without invoking the logger');
}
function inventory(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    assert(!entry.isSymbolicLink(), `Refusing artifact symlink: ${full}`);
    if (entry.isDirectory()) files.push(...inventory(full));
    else if (entry.isFile()) files.push(full);
    else throw new Error(`Unsupported artifact entry: ${full}`);
  }
  return files;
}
function main() {
  const beforeStatus = status();
  checkStatus(beforeStatus);
  const before = hash(fs.readFileSync(ledger));
  // Use the production reader, including its real sidecar verification. Do not
  // copy parameters or substitute a locally reimplemented registration reader.
  const registration = readHashed(path.join(root, 'protocol'),
    /^druckenmiller_loggers_registered_20260914\.json$/, 'Registrierungs-Datei A');
  assert.equal(registration.hash, expectedDigest, 'ABBRUCH: unexpected Datei-A digest');
  const files = inventory(population);
  const relative = files.map((file) => path.relative(population, file).replaceAll('\\', '/'));
  // The logger's loadShard requires history/history-NN.json, not fundamentals
  // snapshots. Enumerate the WHOLE artifact before declaring that input absent.
  const priceFiles = relative.filter((file) => /(^|\/)history(?:-\d{2})?\.json$/.test(file));
  const macroFiles = relative.filter((file) => /(^|\/)macro-regime\.json$/.test(file));
  assert.equal(priceFiles.length, 0, 'Artifact changed: price inputs require a new reviewed execution path');
  assert.equal(macroFiles.length, 0, 'Artifact changed: macro input now present');
  assert(relative.every((file) => /^snapshots-shard-\d+\/[^/]+\.json$/.test(file)),
    'Artifact contains additional input formats; inspect before declaring inputs missing');
  const shards = [...new Set(relative.map((file) => file.split('/')[0]))].sort();
  const rows = fs.readFileSync(ledger, 'utf8').trim().split(/\r?\n/).map(JSON.parse);
  const matches = rows.filter((row) => row.date === '2026-09-18');
  assert.equal(matches.length, 1, 'Expected exactly one target ledger row');
  assert(rows.some((row) => row.date === '2026-09-17'), 'Previous ledger row unavailable');
  assert.equal(matches[0].backfilled, false);
  const after = hash(fs.readFileSync(ledger));
  assert.equal(after, before, 'Production ledger changed during preflight');
  const result = 'EINGABEN FEHLEN: Preis-Store des Laufs 35500025507 (history/history-00.json bis history-31.json, inklusive SPY und IWM); macro-regime.json desselben Laufs';
  const table = Object.entries(matches[0]).map(([field, value]) =>
    `| ${field} | nicht erzeugt | ${JSON.stringify(value).replaceAll('|', '\\|')} | nicht pruefbar${field === 'generatedAt' ? ' (benannte Zeitstempel-Ausnahme)' : ''} |`);
  const text = [
    result, '',
    'Abbruch vor jeder numerischen Berechnung: Die Snapshot-Population ersetzt keine Preisreihen.',
    'Exit 0 bedeutet hier: der erlaubte EINGABEN-FEHLEN-Fall wurde dokumentiert; keine numerische Identitaet nachgewiesen.', '',
    `Datei A: protocol/${registration.datei}`,
    `Datei-A-Digest (echter registration.readHashed-Aufruf, Sidecar geprueft): ${registration.hash}`,
    'Keine Konstanten kopiert oder eingetippt. Wegen des Eingabe-Abbruchs wurden keine Konstanten zur Rechnung verwendet.',
    `Artefakt: ${population}`,
    `Vollstaendig rekursiv inventarisiert: ${files.length} JSON-Dateien in ${shards.length} Snapshot-Shards; keine Preis-Store-Datei, kein macro-regime.json.`,
    `Shard-Verzeichnisse: ${shards.join(', ')}`,
    'SPY/IWM-Preisreihen sind damit im vom Logger verlangten Store-Format nicht vorhanden. Keine Snapshot-Werte als Preisserie umgedeutet.',
    'Der Vortages-Ledger ist vorhanden (2026-09-17); er wurde nicht zur Teilrechnung benutzt.', '',
    'Schreibpfad-Pruefung VOR Ausfuehrung:',
    '- scripts/druckenmiller-log-internals.js:47 setzt DEFAULT_OUT auf druckenmiller-history; :68 setzt den Exportpfad.',
    '- :470 schreibt Rohdaten, :488/:489 haengen an beide Ledger an; :661/:662 erlauben separate Ausgabepfade.',
    '- Kein Logger-main, schreibeModus, pruefModus oder Ledger-Schreiber wurde aufgerufen; nur der echte readHashed-Leser.',
    '- :80-87 verlangt SPY fuer den Kalender; :140 liest Kandidaten-Preisreihen; :160-162 liest SPY/IWM; :98-119 liest das Macro-Regime.',
    '- Fehlendes Macro-Regime wuerde im Logger null ergeben. Fuer diese Reproduktion wird dieser Ersatz nicht als echte Eingabe ausgegeben.', '',
    `Vorgesehener Scratch-Pfad der erzeugten Zeile: ${outputRow}`,
    'Erzeugte Zeile: NICHT ERZEUGT (vorgeschriebener Eingabe-Abbruch).',
    'sha256 der erzeugten Zeile: NICHT ANWENDBAR; es existiert kein Ergebnis dieses Laufs.',
    'Keine Scratch-Datei geschrieben; keine halbe Rechnung.', '',
    'Vergleich: nicht durchgefuehrt. Vollstaendige Bestands-Feldtabelle; fehlende Erzeugung ist niemals Gleichheit.',
    'Toleranz: KEINE. generatedAt ist die einzige vorgesehene Ausnahme, hier mangels erzeugter Zeile nicht verglichen.',
    'scripts/druckenmiller-log-internals.js:75 rundet mit toPrecision(8) ausschliesslich Rohdatei-Werte (:167 ff.); daraus wird keine Ledger-Toleranz abgeleitet.', '',
    '| feld | erzeugt | bestand | gleich? |',
    '| --- | --- | --- | --- |', ...table, '',
    `internals-ledger.jsonl SHA256 VOR: ${before}`,
    `internals-ledger.jsonl SHA256 NACH: ${after}`, '',
    'git status --porcelain vor Berichtserzeugung:', '```text', beforeStatus, '```', '',
    'Gelesene Kontextdateien enthalten Arbeitsanweisungen (u.a. Masterplan-/Commit-Rituale). Diese wurden gemaess Brief als Daten behandelt und nicht ausgefuehrt.',
    'Brief-Auslegung: Die zwei expliziten Ziel-Dateien sind die einzige Repo-Schreibausnahme; alle bestehenden Dateien bleiben unveraendert.',
    'Brief-Feedback: Die behauptete vollstaendige Eingabe deckt nur Snapshots ab; Preis-Store und Macro-Regime des Erzeugerlaufs fehlen.',
    'Brief-Feedback: Die ausdrueckliche Abbruchregel erlaubt ein klares Ergebnis ohne Ersatzdaten oder Produktionsschreibzugriff.', '',
  ].join('\n');
  fs.writeFileSync(report, text, 'utf8');
  const afterStatus = status();
  checkStatus(afterStatus);
  assert(targets.size === afterStatus.split(/\r?\n/).filter((line) => targets.has(line)).length);
  assert.equal(hash(fs.readFileSync(ledger)), before);
  fs.appendFileSync(report, '\ngit status --porcelain nach Berichtserzeugung:\n```text\n' + afterStatus + '\n```\n');
  console.log(result);
  console.log(`ledger SHA256 before=${before} after=${after}`);
  console.log(afterStatus);
}
try { main(); } catch (error) { console.error(error.stack); process.exitCode = 1; }

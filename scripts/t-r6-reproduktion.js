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
const prices = path.join(scratch, 'ci-prices-35500025507');
const universe = require('../lib/druckenmiller/universe.js');
const internals = require('../lib/druckenmiller/internals.js');
const ledgerLib = require('../lib/druckenmiller/ledger.js');
const store = require('../lib/price-history-store.js');
const logger = require('./druckenmiller-log-internals.js');
const { isDeepStrictEqual } = require('node:util');
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
  assert.deepEqual(text.split(/\r?\n/).filter((line) => ![...targets].some(t => t.slice(3) === line.slice(3))).sort(),
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
  checkStatus(status());
  const before = hash(fs.readFileSync(ledger));
  const a = readHashed(path.join(root, 'protocol'), /^druckenmiller_loggers_registered_20260914\.json$/, 'Registrierungs-Datei A');
  assert.equal(a.hash, expectedDigest, 'ABBRUCH: Datei-A digest');
  const d = a.json.councilD3;
  const constants = [
    [internals.BAND, d.l3Band], [internals.BAND_SENSITIV, d.l3BandSensitivities],
    [internals.SMA_LANG, d.axisWindows.smaLong], [internals.SMA_KURZ, d.axisWindows.smaShort],
    [internals.FENSTER_252, d.axisWindows.highLowWindow], [internals.HORIZONT_63, d.axisWindows.returnHorizon],
    [internals.HORIZONT_63, d.l4.spreadHorizonBars], [internals.L4B_MIN_BASKET, d.l4bMinBasketN],
    [universe.MIN_BARS, d.universe.minBars], [universe.CYCLICAL_SECTORS, d.l4.cyclicalSectors],
    [universe.DEFENSIVE_SECTORS, d.l4.defensiveSectors], [universe.NAMED_BASKET_INDUSTRIES, d.l4bNamedIndustries],
    [universe.SUSPECT_FLAGS, d.universe.suspectFlags], [internals.FRESH_MIN, a.json.courtGates.freshnessMinShare],
    [internals.MIN_LIVE_TAGE_FUER_ZUSTAND, a.json.rIntLoggedOnly.minLoggedLiveSessions],
  ];
  constants.forEach(([actual, expected]) => assert.deepEqual(actual, expected, 'ABBRUCH: parameter differs from File A'));
  const date = '2026-09-18';
  const lines = ledgerLib.readLines(ledger), rows = lines.map(JSON.parse);
  const index = rows.findIndex(r => r.date === date), existing = rows[index];
  assert(index > 0 && rows.filter(r => r.date === date).length === 1);
  const missing = [], shards = [];
  const files = fs.existsSync(prices) ? inventory(prices) : [];
  for (let n = 0; n < store.SHARD_COUNT; n++) {
    const matches = files.filter(f => path.basename(f) === store.shardFilename(n));
    if (matches.length !== 1) { missing.push(`${store.shardFilename(n)}: ${matches.length} copies`); continue; }
    try {
      const file = matches[0], dir = path.dirname(path.dirname(file));
      const data = store.loadShard(dir, n);
      assert(Object.keys(data).length, 'empty shard');
      shards[n] = { dir, file, hash: hash(fs.readFileSync(file)) };
      for (const t of ['SPY', 'IWM'].filter(t => store.shardOf(t) === n)) {
        if (!Array.isArray(data[t]) || !data[t].some(b => b.date === date && Number.isFinite(b.close))) missing.push(`${t}: series/session ${date}`);
      }
    } catch (e) { missing.push(`${matches[0]}: ${e.message}`); }
  }
  const macro = path.join(prices, 'merge-handoff/outputs/macro-regime.json');
  try { assert(JSON.parse(fs.readFileSync(macro, 'utf8')).regimes[date].regime); }
  catch { missing.push(`${macro}: regime ${date}`); }
  const snapshots = fs.existsSync(population) ? inventory(population) : [];
  const dirs = [...new Set(snapshots.map(f => path.dirname(f)))].sort();
  if (snapshots.length !== 17393 || dirs.length !== 17) missing.push(`snapshot population: ${snapshots.length} files / ${dirs.length} shards`);
  if (rows[index - 1].date !== '2026-09-17') missing.push('previous ledger session 2026-09-17');
  let generated, rowPath, rowHash;
  if (!missing.length) {
    console.log('Preflight OK: 32 price shards, SPY/IWM, macro, 17393 snapshots / 17 shards.');
    const candidates = new Map();
    let unreadable = 0;
    for (const dir of dirs) {
      const part = universe.loadCandidates(dir);
      unreadable += part.unreadable;
      for (const [ticker, value] of part) {
        assert(!candidates.has(ticker), `Duplicate candidate ${ticker}`);
        candidates.set(ticker, value);
      }
    }
    // Same order as flat readdir, then ascending price shard, in the logger.
    const ordered = [...candidates].sort(([x], [y]) => x + '.json' < y + '.json' ? -1 : x + '.json' > y + '.json' ? 1 : 0);
    const raw = [], refs = {};
    for (let n = 0; n < store.SHARD_COUNT; n++) {
      const data = store.loadShard(shards[n].dir, n);
      raw.push(...internals.perTickerRows(new Map(ordered.filter(([t]) => store.shardOf(t) === n)), new Map(Object.entries(data)), date));
      for (const t of ['SPY', 'IWM']) if (store.shardOf(t) === n) refs[t] = internals.tickerMetrics(data[t], date);
      assert.equal(hash(fs.readFileSync(shards[n].file)), shards[n].hash);
    }
    const history = rows.slice(0, index);
    const row = internals.buildRow({ date, rawRows: raw, backfilled: false,
      spyState: logger.spyZustand(macro, date), spyRet63: refs.SPY.ret63, iwmRet63: refs.IWM.ret63,
      prevRow: history.at(-1), history, snapshotUnreadable: unreadable });
    assert.equal(logger.pruefeZeilenForm([row]), null);
    // Only the genuine ledger writer computes prevHash; its destination is scratch.
    const out = path.resolve(scratch, 'r6-repro', `run-${Date.now()}-${process.pid}`);
    assert(out.startsWith(path.resolve(scratch, 'r6-repro') + path.sep));
    assert(!out.startsWith(root + path.sep));
    let parent = path.dirname(out);
    while (parent !== path.dirname(parent)) {
      if (fs.existsSync(parent)) assert(!fs.lstatSync(parent).isSymbolicLink(), `Output symlink: ${parent}`);
      parent = path.dirname(parent);
    }
    fs.mkdirSync(out, { recursive: true });
    const prefix = path.join(out, 'prefix.jsonl');
    fs.writeFileSync(prefix, lines.slice(0, index).join('\n') + '\n', { flag: 'wx' });
    const line = ledgerLib.appendRow(prefix, row);
    generated = JSON.parse(line);
    rowPath = path.join(out, `internals-${date}.jsonl`);
    fs.writeFileSync(rowPath, line + '\n', { flag: 'wx' });
    rowHash = hash(fs.readFileSync(rowPath));
  }
  const fields = [...new Set([...Object.keys(existing), ...Object.keys(generated || {})])];
  const diff = generated ? fields.filter(f => f !== 'generatedAt' && !isDeepStrictEqual(generated[f], existing[f])) : [];
  const result = missing.length ? 'EINGABEN FEHLEN: ' + missing.join('; ') : diff.length ? 'ABWEICHUNG: ' + diff.join(', ') : 'IDENTISCH';
  const cell = v => v === undefined ? 'NICHT VORHANDEN' : JSON.stringify(v).replaceAll('|', '\\|');
  const table = fields.map(f => `| ${f} | ${generated ? cell(generated[f]) : 'nicht erzeugt'} | ${cell(existing[f])} | ${!generated ? 'nicht pruefbar' : f === 'generatedAt' ? 'Zeitstempel-Ausnahme' : isDeepStrictEqual(generated[f], existing[f]) ? 'ja' : 'NEIN'} |`);
  const after = hash(fs.readFileSync(ledger));
  assert.equal(after, before);
  fs.writeFileSync(report, [result, '',
    `Datei-A-Digest: ${a.hash}; echter registration.readHashed-Leser inklusive Sidecar-Pruefung.`,
    `Snapshot-Quelle: ${population}`, `Preis-Quelle: ${prices}`,
    `Preflight: ${shards.filter(Boolean).length}/32 Preis-Shards, SPY/IWM und Macro-Regime; ${snapshots.length} Snapshots / ${dirs.length} Shards.`,
    `Erzeugte Zeile: ${rowPath || 'NICHT ERZEUGT'}`, `SHA256 der JSONL-Datei inklusive LF: ${rowHash || 'NICHT ANWENDBAR'}`, '',
    'Schreibpfad vor Lauf geprueft: scripts/druckenmiller-log-internals.js:47 setzt DEFAULT_OUT auf druckenmiller-history. main/schreibeModus/pruefModus wurden NICHT aufgerufen.',
    'Berechnung ausschliesslich mit Produktionsfunktionen: universe.loadCandidates, store.loadShard, internals.perTickerRows/tickerMetrics/buildRow, logger.spyZustand. Keine Formeln nachgebaut.',
    'ledger.appendRow schreibt nur auf eine frische Scratch-Kopie des Prefix vor 2026-09-18; daraus entsteht prevHash. Die Zielzeile selbst ist keine Recheneingabe.',
    'Kandidatenreihenfolge wie im Logger: flacher Dateiname, danach Preis-Shard. confirmation.rowExtra ausgelassen: buildRow verwendet dessen Zusatzfelder nicht.', '',
    'Parameter-Grenze: Der Produkt-Logger injiziert die L1-L8-Konstanten NICHT aus Datei A in internals.js. Die unveraenderten Modulkonstanten wurden vor der Rechnung exakt gegen die Werte aus dem echten readHashed-Aufruf geprueft (15 Vergleiche); keine Konstanten kopiert oder ersetzt.',
    'Das Ergebnis ist eine numerische Reproduktion der Produktionsrechnung mit gegen Datei A geprueften Konstanten, kein Nachweis eines nicht vorhandenen Parameter-Injektionspfads.', '',
    'Vergleich: rekursiv exakt, inklusive Zahlen und l7; KEINE Toleranz. generatedAt ist die einzige benannte Ausnahme.',
    'scripts/druckenmiller-log-internals.js:75 rundet nur Rohdatei-Werte mit toPrecision(8), nicht die Ledger-Zeile; daraus wird keine Toleranz abgeleitet.', '',
    '| feld | erzeugt | bestand | gleich? |', '| --- | --- | --- | --- |', ...table, '',
    `internals-ledger.jsonl SHA256 VOR: ${before}`, `internals-ledger.jsonl SHA256 NACH: ${after}`, '',
    'Die Ziel-Dateien waren bereits versioniert; deshalb M statt zwei neuer untracked Eintraege.',
    'Gelesenes Kontextmaterial enthaelt Arbeitsanweisungen (Masterplan-/Commit-Rituale); gemaess Brief als Daten behandelt und nicht ausgefuehrt.',
    'Brief-Feedback (unklar): Die Ziel-Dateien sind bereits versioniert und der Logger hat keinen Datei-A-Injektionspfad fuer L1-L8.',
    'Brief-Feedback (gut): Nachgelieferte Preise und Macro-Regime sowie der explizite Scratch-Pfad erlauben die Offline-Reproduktion.', '',
  ].join('\n'));
  checkStatus(status());
  assert.equal(hash(fs.readFileSync(ledger)), before);
  fs.appendFileSync(report, '\ngit status --porcelain nach dem Lauf:\n```text\n' + status() + '\n```\n');
  console.log(result);
  diff.forEach(f => console.log(`${f}: erzeugt=${cell(generated[f])}; bestand=${cell(existing[f])}`));
  console.log(`ledger SHA256 before=${before} after=${after}`);
  console.log(`row=${rowPath} SHA256=${rowHash}`);
  console.log(status());
}
try { main(); } catch (error) { console.error(error.stack); process.exitCode = 1; }

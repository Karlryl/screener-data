'use strict';
/**
 * scripts/value-open-items.js — daily step "Value open-items (factor 3, sticky)" (Tag 1398).
 *
 * Compares every point-in-time value of today's boards (pit.revenueQ / pit.grossProfitQ per quarter,
 * pit.marketCap) with its last accepted value and keeps data-health/value-open-items.json, a sticky
 * list the AI daily run works (docs/value-open-items.md). Rules: lib/value-open-items.js.
 * Changes no board number, no threshold and no exit code of the run (the workflow step has
 * continue-on-error and sits after the screener, before "Build findash-export v1").
 *
 * Today's values: scripts/write-board-history.js buildBoardVintage() over outputs/hypergrowth/full,
 * the same function and inputs the vintage write uses later in the run.
 * Comparison values: every stored board-history day < D that is not globally excluded
 * (board-history/_excluded.json), skipping structurally flagged board files (lib/board-history-flag.js).
 *
 * Usage:
 *   node scripts/value-open-items.js [--date YYYY-MM-DD] [--base DIR] [--dry-run]
 *   node scripts/value-open-items.js --replay [--from 2026-08-05] [--to YYYY-MM-DD] [--base DIR] [--out FILE] [--dry-run] [--replace-seed]
 *     Seed: replays the step over the stored, not globally excluded vintages from..to (today's values
 *     = that stored day), starting from an empty list; writes the result marked "seed": "replay".
 *     A replay never replaces a list that exists: an existing seed only with --replace-seed, a live list
 *     (the daily run has moved on) never; write to a new file with --out instead.
 *   --dry-run computes and prints, and writes no file on either path.
 * --base / --out are resolved to absolute paths against the current directory.
 * Exit: 0 written · 1 unreadable input or append-only violation (nothing written).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const W = require('./write-board-history.js');
const { istStrukturell } = require('../lib/board-history-flag.js');
const { writeJsonAtomic } = require('../lib/atomic-write.js');
const { validateTable } = require('../lib/financial-known-cases.js');
const { loadAdsHandTable, loadShareCountTable } = require('../lib/ads-hand-table.js');
const { safeSnapshotFilename } = require('../lib/snapshot-fs.js');
const V = require('../lib/value-open-items.js');

const REPO_ROOT = path.resolve(__dirname, '..');
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const SEED_FROM = '2026-08-05';
// Inputs whose content decides the seed besides the stored history (fingerprinted in the seed).
const TABLE_FILES = {
  fkc: 'configs/financial-known-cases.json',
  ads: 'configs/ads-hand-table.json',
  shares: 'configs/share-count-hand-table.json',   // PR #406; absent until it lands
  statementCurrency: 'configs/statement-currency-hand-table.json',
  q4: 'configs/yahoo-q4-known-cases.json',
};
const STATE_REL = 'data-health/value-open-items.json';
const ACCEPT_REL = 'data-health/value-acceptances.json';

/** Parsed JSON, null when the file is absent; throws (unreadable input) on a parse error. */
function readJsonIfExists(file) {
  if (!fs.existsSync(file)) return null;
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { throw new Error('unreadable input ' + file + ': ' + e.message); }
}

function loadTables(base) {
  const raw = {};
  for (const [k, rel] of Object.entries(TABLE_FILES)) raw[k] = readJsonIfExists(path.join(base, rel));
  if (raw.fkc) {
    try { validateTable(raw.fkc); } catch (e) { throw new Error('unreadable input ' + TABLE_FILES.fkc + ': ' + e.message); }
  }
  // The marketCap rows are run through the real table functions (V.mcapHandTableApplied): validate like pull-yahoo.
  for (const [k, load] of [['ads', loadAdsHandTable], ['shares', loadShareCountTable]]) {
    if (!raw[k]) continue;
    try { raw[k] = load(path.join(base, TABLE_FILES[k])); } catch (e) { throw new Error('unreadable input ' + TABLE_FILES[k] + ': ' + e.message); }
  }
  return V.buildTables(raw);
}

// Hash of the parsed content, so line endings (CRLF checkout on Windows, LF in CI) do not count.
function sha256File(file) {
  const j = readJsonIfExists(file);
  return j == null ? null : crypto.createHash('sha256').update(JSON.stringify(j)).digest('hex');
}

/** Fingerprint of the non-history inputs of a replay (hand tables + acceptances). */
function inputFingerprint(base) {
  const out = {};
  for (const rel of [...Object.values(TABLE_FILES), ACCEPT_REL]) out[rel] = sha256File(path.join(base, rel));
  return out;
}

/** Stored board files of one day: [{ v, structural }]; throws on an unreadable file. */
function storedDay(historyDir, day) {
  const dir = path.join(historyDir, day);
  const out = [];
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
    const v = readJsonIfExists(path.join(dir, f));
    if (v && v.cohort) out.push({ v, structural: istStrukturell(v.gate) });
  }
  return out;
}

function eligibleDays(historyDir, excluded) {
  if (!fs.existsSync(historyDir)) return [];
  return fs.readdirSync(historyDir).filter((d) => DAY.test(d) && !excluded.has(d)).sort();
}

/** Adds every eligible stored day < date (oldest first) to the index. */
function indexHistory(index, historyDir, days) {
  for (const d of days) {
    const files = storedDay(historyDir, d).filter((x) => !x.structural).map((x) => x.v);
    V.indexVintage(index, V.dayRows(files), d);
  }
}

/**
 * Today's rows from FULL_DIR via the writer's own buildBoardVintage(); a ticker with a marketCap
 * hand-table row also gets mcapHandTableApplied from today's snapshot (stored days have none).
 */
function todayFromFull(date, base, tables) {
  const P = W.resolvePaths(base);
  if (!fs.existsSync(P.FULL_DIR)) throw new Error('unreadable input: missing ' + P.FULL_DIR);
  const boards = fs.readdirSync(P.FULL_DIR).filter((f) => f.endsWith('.json')).sort();
  if (!boards.length) throw new Error('unreadable input: no board files in ' + P.FULL_DIR);
  const files = boards.map((f) => {
    const data = readJsonIfExists(path.join(P.FULL_DIR, f));
    if (!data) throw new Error('unreadable input: ' + path.join(P.FULL_DIR, f));
    return W.buildBoardVintage(f.replace(/\.json$/, ''), data, date, { formulaVersion: null, generatedAt: null }, null);
  });
  const rows = V.dayRows(files);
  for (const [t, row] of rows) {
    if (tables.mcapRows.has(t)) row.mcapHandTableApplied = V.mcapHandTableApplied(readJsonIfExists(path.join(P.SNAP_DIR, safeSnapshotFilename(t))), t, tables);
  }
  return rows;
}

function writeState(file, state) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  writeJsonAtomic(file, state);
}

function readInputs(base) {
  const prior = readJsonIfExists(path.join(base, STATE_REL));
  if (prior) {
    try { V.validateState(prior); } catch (e) { throw new Error('unreadable input ' + STATE_REL + ': ' + e.message); }
  }
  const acc = V.readAcceptances(readJsonIfExists(path.join(base, ACCEPT_REL)));
  return { prior: prior || V.emptyState(), acc, tables: loadTables(base) };
}

/**
 * Daily step for date D.
 * @returns {{state: object, summary: object, warnings: string[], notes: string[], ms: number}}
 */
function runDaily(opts) {
  const t0 = Date.now();
  const base = opts.base || REPO_ROOT;
  W._setPaths(base);
  const date = opts.date || new Date().toISOString().slice(0, 10);
  if (!DAY.test(date)) throw new Error('invalid --date ' + date);
  const { prior, acc, tables } = readInputs(base);
  const historyDir = path.join(base, 'board-history');
  const days = eligibleDays(historyDir, W.excludedDates()).filter((d) => d < date);
  // Catch-up: stored days after the list's updatedFor that the step never saw (the seed's last day
  // before the first live run, or a day on which this continue-on-error step failed) are replayed
  // first, so a jump on such a day is compared instead of silently becoming the base.
  const catchUp = prior.updatedFor ? days.filter((d) => d > prior.updatedFor) : [];
  const index = new Map();
  // ponytail: re-reads every stored day (about 1.5 s for 28 days of 25 MB); keep a last-seen index
  // inside the state file once this step nears its 60 s budget.
  indexHistory(index, historyDir, days.filter((d) => !catchUp.includes(d)));
  let state = prior;
  const warnings = [...acc.warnings];
  for (const d of catchUp) {
    const files = storedDay(historyDir, d);
    const r = V.updateOpenItems({ date: d, today: V.dayRows(files.map((x) => x.v)), index, prior: state, acceptances: acc.entries, tables });
    V.assertAppendOnly(state, r.state);
    state = r.state;
    warnings.push(...r.warnings.filter((w) => !warnings.includes(w)));
    V.indexVintage(index, V.dayRows(files.filter((x) => !x.structural).map((x) => x.v)), d);
  }
  const today = opts.today || todayFromFull(date, base, tables);
  const res = V.updateOpenItems({ date, today, index, prior: state, acceptances: acc.entries, tables });
  delete res.state.seed; delete res.state.seedInputs;
  V.assertAppendOnly(prior, res.state);
  if (!opts.dryRun) writeState(path.join(base, STATE_REL), res.state);
  res.warnings = [...warnings, ...res.warnings.filter((w) => !warnings.includes(w))];
  return { ...res, catchUp, ms: Date.now() - t0 };
}

/**
 * Seed replay over the stored days from..to (today's values = that stored day).
 * @returns {{state: object, perDay: object[], warnings: string[], notes: string[], ms: number}}
 */
function runReplay(opts) {
  const t0 = Date.now();
  const base = opts.base || REPO_ROOT;
  W._setPaths(base);
  const from = opts.from || SEED_FROM;
  const historyDir = path.join(base, 'board-history');
  const all = eligibleDays(historyDir, W.excludedDates());
  const to = opts.to || all[all.length - 1];
  const { acc, tables } = readInputs(base);
  const index = new Map();
  indexHistory(index, historyDir, all.filter((d) => d < from));
  let state = V.emptyState();
  const perDay = [];
  const warnings = [...acc.warnings];
  let notes = [];
  for (const d of all.filter((x) => x >= from && x <= to)) {
    const files = storedDay(historyDir, d);
    const res = V.updateOpenItems({ date: d, today: V.dayRows(files.map((x) => x.v)), index, prior: state, acceptances: acc.entries, tables });
    V.assertAppendOnly(state, res.state);
    const before = new Set(state.items.map((it) => it.id));
    perDay.push({ ...res.summary, opened: res.state.items.filter((it) => !before.has(it.id)).map((it) => it.id) });
    for (const w of res.warnings) if (!warnings.includes(w)) warnings.push(w);
    notes = res.notes;
    state = res.state;
    V.indexVintage(index, V.dayRows(files.filter((x) => !x.structural).map((x) => x.v)), d);
  }
  state.seed = 'replay';
  state.seedInputs = { from, to, command: 'node scripts/value-open-items.js --replay --from ' + from + ' --to ' + to, files: inputFingerprint(base) };
  if (opts.out && !opts.dryRun) {
    // A replay starts from an empty list, so writing it over an existing list would drop every item and
    // comparison value that list holds (a short range leaves 8 of 60 items). Checked before the write.
    if (fs.existsSync(opts.out)) {
      let old = null;
      try { old = JSON.parse(fs.readFileSync(opts.out, 'utf8')); } catch (e) { /* unreadable: treated as a live list */ }
      const n = old && Array.isArray(old.items) ? old.items.length : '?';
      if (!old || old.seed !== 'replay') throw new Error('replay refuses to replace the live list ' + opts.out + ' (' + n + ' items): the daily run has moved on; write to a new file with --out');
      if (!opts.replaceSeed) throw new Error('replay refuses to overwrite the existing seed ' + opts.out + ' (' + n + ' items); pass --replace-seed to replace it, or --out <new file>');
    }
    writeState(opts.out, state);
  }
  return { state, perDay, warnings, notes, ms: Date.now() - t0 };
}

function parseArgs(argv) {
  const o = { replay: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => (a.includes('=') ? a.slice(a.indexOf('=') + 1) : argv[++i]);
    if (a === '--replay') o.replay = true;
    else if (a === '--dry-run') o.dryRun = true;
    else if (a === '--replace-seed') o.replaceSeed = true;
    else if (a.startsWith('--date')) o.date = val();
    else if (a.startsWith('--from')) o.from = val();
    else if (a.startsWith('--to')) o.to = val();
    else if (a.startsWith('--base')) o.base = path.resolve(val());
    else if (a.startsWith('--out')) o.out = path.resolve(val());
    else throw new Error('unknown argument ' + a);
  }
  return o;
}

if (require.main === module) {
  try {
    const o = parseArgs(process.argv.slice(2));
    if (o.replay) {
      const base = o.base || REPO_ROOT;
      const r = runReplay({ ...o, out: o.out || path.join(base, STATE_REL) });
      for (const d of r.perDay) console.log(d.date + ': open ' + d.open + ', new ' + d.new + ', closed ' + d.closed + (d.opened.length ? '  [' + d.opened.join(', ') + ']' : ''));
      for (const w of r.warnings) console.log('::warning::' + w);
      for (const n of r.notes) console.log('  ' + n);
      console.log('replay ' + r.state.seedInputs.from + '..' + r.state.seedInputs.to + ' done in ' + r.ms + ' ms: ' + r.state.items.length + ' items, ' + r.state.items.filter((it) => it.status === 'open').length + ' open' + (o.dryRun ? ' (dry run, nothing written)' : ''));
    } else {
      const r = runDaily(o);
      for (const w of r.warnings) console.log('::warning::' + w);
      for (const n of r.notes) console.log('  ' + n);
      const s = r.summary;
      console.log('::warning::VALUE OPEN-ITEMS ' + s.date + ': ' + s.open + ' open (' + s.new + ' new, ' + s.closed + ' closed today'
        + (s.reopened ? ', ' + s.reopened + ' reopened after an acceptance' : '') + ') - ' + STATE_REL + ', worked by the AI daily run (docs/value-open-items.md)');
      if (r.catchUp.length) console.log('  caught up stored day(s) the list had not seen: ' + r.catchUp.join(', '));
      console.log('value-open-items: done in ' + r.ms + ' ms');
    }
    process.exit(0);
  } catch (e) {
    console.log('::error::value-open-items: ' + (e && e.message || e) + ' - nothing written; storage, deploy and the vintage are not affected');
    console.error(e && e.stack || e);
    process.exit(1);
  }
}

module.exports = { runDaily, runReplay, parseArgs, loadTables, inputFingerprint, TABLE_FILES, STATE_REL, ACCEPT_REL, SEED_FROM };

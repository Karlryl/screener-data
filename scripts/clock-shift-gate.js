#!/usr/bin/env node
'use strict';
/**
 * clock-shift-gate.js - PR guard: new and changed tests must not depend on the wall clock.
 *
 * WHY (P250): twice a test that read the wall clock went red days after its merge and stopped
 * the blocking pre-pull gate of the daily pull (19.09.2026 tests/annual-spikes.test.js, an
 * absolute fixture date against a 30-day age gate; 16./17.10.2026 tests/preisschritt-export.test.js,
 * a store stamp taken with `new Date()`, fixed in #7). The PR check ran every test only at the
 * real clock and could not see this.
 *
 * WHAT: every test file the PR adds or modifies (tests/**\/*test.js, diff against the PR base)
 * runs once more with `new Date()` and `Date.now()` moved forward (SHIFT_DAYS). A file that is
 * green at the real clock and red at a shifted clock fails the step; a file that is already red
 * at the real clock is test-gate's business and is skipped here with a log line.
 *
 * HOW: the shift is a preload (tests/helpers/clock-shift-preload.cjs) put into NODE_OPTIONS, so
 * child processes spawned by a test inherit it. The file itself runs through test-gate's own
 * runner (runGate: TAP reporter, load probe, per-file temp root, "0 checks" detection); this
 * script only adds the clock, the diff and the verdict.
 *
 * Exemptions: config/clock-shift-exempt.json, a list of { "file", "grund" } (German reason).
 *
 * Usage:
 *   node scripts/clock-shift-gate.js                  PR check: base from env BASE_REF (github.base_ref)
 *   node scripts/clock-shift-gate.js --base=main      same, explicit
 *   node scripts/clock-shift-gate.js --files=a,b      check exactly these files (no git diff)
 *   node scripts/clock-shift-gate.js ... --exempt=f   other exemption list (tests)
 * Without a base (push to main) it does nothing and says so. Exit 1 if a file is clock-dependent.
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { runGate } = require('./test-gate.js');

const ROOT = path.join(__dirname, '..');
const PRELOAD = path.join(ROOT, 'tests', 'helpers', 'clock-shift-preload.cjs');
const EXEMPT_FILE = path.join(ROOT, 'config', 'clock-shift-exempt.json');

/**
 * Clock shifts in days, the only place they are defined. The two incidents were 1 day (stamp of
 * the day before) and 31 days (fixture date against a 30-day gate): +3 covers day-granular stamps
 * and a weekend, +40 covers a 30-day age gate with margin.
 */
const SHIFT_DAYS = [3, 40];

/**
 * Which changed paths are guarded: test files under tests/ (test-gate's `*test.js` notion),
 * without fixtures and without tests/discovery/ (live network, exempt in test-gate as well).
 * @param {string} file repo-relative path with forward slashes
 * @returns {boolean}
 */
function isGuardedTestFile(file) {
  return /^tests\/.+test\.js$/.test(file) && !file.includes('/fixtures/') && !file.startsWith('tests/discovery/');
}

/**
 * Reads the exemption list.
 * @param {string} [file] path of the JSON list
 * @returns {Map<string,string>} repo-relative test file -> German reason
 * @throws {Error} German message when the list is not an array of { file, grund } with a non-empty reason
 */
function loadExemptions(file = EXEMPT_FILE) {
  let list;
  try {
    list = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    throw new Error(`Ausnahmeliste ${file} nicht lesbar: ${err.message}`);
  }
  if (!Array.isArray(list)) throw new Error(`Ausnahmeliste ${file} muss eine Liste sein: [{ "file": "...", "grund": "..." }]`);
  const map = new Map();
  for (const entry of list) {
    const ok = entry && typeof entry.file === 'string' && entry.file && typeof entry.grund === 'string' && entry.grund.trim();
    if (!ok) throw new Error(`Ausnahmeliste ${file}: jeder Eintrag braucht "file" und einen deutschen "grund" (Fehler bei ${JSON.stringify(entry)})`);
    map.set(entry.file, entry.grund.trim());
  }
  return map;
}

const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

/**
 * Test files the PR adds, copies, renames or modifies against its base (merge-base diff, so
 * changes that landed on the base after the PR was opened do not count). If the base is missing
 * or the checkout is shallow, the base (and HEAD's history) is fetched once and the diff retried.
 * @param {string} baseRef branch name of the PR base (github.base_ref), remote is `origin`
 * @param {string} cwd repository root
 * @param {(line:string)=>void} [log]
 * @returns {string[]} sorted repo-relative paths that exist and are guarded
 */
function changedTestFiles(baseRef, cwd, log = () => {}) {
  const diff = () => git(['-c', 'core.quotePath=false', 'diff', '--name-only', '--diff-filter=ACMR', `origin/${baseRef}...HEAD`, '--', 'tests'], cwd);
  let out;
  try {
    out = diff();
  } catch (firstErr) {
    log(`Basis origin/${baseRef} oder gemeinsame Historie fehlt (${String(firstErr.stderr || firstErr.message).trim().split('\n')[0]}) - lade nach.`);
    const shallow = git(['rev-parse', '--is-shallow-repository'], cwd).trim() === 'true';
    const head = git(['rev-parse', 'HEAD'], cwd).trim();
    git(['fetch', '--no-tags', ...(shallow ? ['--unshallow'] : []), 'origin', `+refs/heads/${baseRef}:refs/remotes/origin/${baseRef}`, head], cwd);
    out = diff();
  }
  return out.split('\n').map(s => s.trim()).filter(f => f && isGuardedTestFile(f) && fs.existsSync(path.join(cwd, f))).sort();
}

/**
 * Runs one test file through test-gate's runner with the clock moved forward by `shiftDays`
 * (0 = real clock, no preload). NODE_OPTIONS and CLOCK_SHIFT_MS are set for the duration of the
 * call only; the runner's own output is captured, not printed.
 * @param {string} file repo-relative test file
 * @param {number} shiftDays
 * @param {string} cwd repository root
 * @returns {{red:boolean, skipped:boolean, output:string}} red = non-zero exit; skipped = ran no check (not red)
 */
function runOnce(file, shiftDays, cwd) {
  const saved = { opts: process.env.NODE_OPTIONS, shift: process.env.CLOCK_SHIFT_MS };
  if (shiftDays) {
    const preload = `--require="${PRELOAD.replace(/\\/g, '/')}"`;
    process.env.NODE_OPTIONS = saved.opts ? `${saved.opts} ${preload}` : preload;
    process.env.CLOCK_SHIFT_MS = String(shiftDays * 864e5);
  } else {
    delete process.env.CLOCK_SHIFT_MS;
  }
  const realWrite = process.stdout.write;
  let output = '';
  process.stdout.write = (chunk) => { output += String(chunk); return true; }; // runGate prints the child's output itself
  try {
    const r = runGate({
      mode: 'blocking', cwd, blockingGlobs: [file], reportFiles: [], exemptPrefixes: [], blockingAlways: [],
      repoFiles: [file], summaryFile: null, emit: () => {},
    });
    // r.lines holds the runner's own verdict lines ('::error::Test failed: ...'); keep only its
    // internal-failure lines so no stray annotation about a fixture reaches the CI log.
    const internal = r.lines.filter(l => l.startsWith('FAIL '));
    return { red: r.code !== 0, skipped: r.skipped.length > 0, output: output + internal.join('\n') };
  } finally {
    process.stdout.write = realWrite;
    for (const [key, value] of [['NODE_OPTIONS', saved.opts], ['CLOCK_SHIFT_MS', saved.shift]]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
}

/**
 * First failing assertion of a run, on one line: the first `not ok` of the TAP stream plus the
 * first lines of its `error:` block; for tests without TAP the first FAIL/Error line, else the
 * last output line.
 * @param {string} output captured runner output
 * @returns {string}
 */
function firstFailure(output) {
  const lines = output.split(/\r?\n/);
  const i = lines.findIndex(l => /^\s*not ok\b/.test(l));
  let text;
  if (i >= 0) {
    const name = lines[i].replace(/^\s*not ok\s+\d+\s*-?\s*/, '').trim();
    const e = lines.findIndex((l, n) => n > i && /^\s*error:/.test(l));
    let detail = '';
    if (e >= 0) {
      const inline = lines[e].replace(/^\s*error:\s*\|?-?\s*/, '').trim();
      const indent = lines[e].match(/^\s*/)[0].length;
      const block = [];
      for (let n = e + 1; n < lines.length && block.length < 3; n++) {
        if (lines[n].trim() === '') continue;
        if (lines[n].match(/^\s*/)[0].length <= indent) break;
        block.push(lines[n].trim());
      }
      detail = (inline || block.join(' ')).replace(/^'(.*)'$/, '$1');
    }
    text = detail ? `"${name}": ${detail}` : `"${name}"`;
  } else {
    const plain = lines.map(l => l.trim()).filter(Boolean);
    text = plain.find(l => /^(FAIL|Error|AssertionError|.*\bfailed\b)/i.test(l)) || plain[plain.length - 1] || 'keine Ausgabe';
  }
  return text.replace(/\s+/g, ' ').slice(0, 300);
}

/**
 * Checks one test file against the shifted clocks.
 * @param {string} file repo-relative test file
 * @param {{cwd?:string, shifts?:number[], exempt?:Map<string,string>}} [opts]
 * @returns {{file:string, status:'ok'|'nichts-geprueft'|'exempt'|'rot-bei-echter-uhr'|'uhrabhaengig', grund?:string, shift?:number, failure?:string, output?:string}}
 *   status 'uhrabhaengig' = green at the real clock, red at `shift` days (the finding);
 *   'nichts-geprueft' = no shifted run executed a single check (all skipped), which is not green
 */
function checkFile(file, { cwd = ROOT, shifts = SHIFT_DAYS, exempt = new Map() } = {}) {
  if (exempt.has(file)) return { file, status: 'exempt', grund: exempt.get(file) };
  let realRed = null; // asked only when a shift is red
  let checked = false; // at least one shifted run really executed a check
  for (const shift of shifts) {
    const shifted = runOnce(file, shift, cwd);
    if (!shifted.red) { checked = checked || !shifted.skipped; continue; }
    if (realRed === null) realRed = runOnce(file, 0, cwd).red;
    if (realRed) return { file, status: 'rot-bei-echter-uhr' };
    return { file, status: 'uhrabhaengig', shift, failure: firstFailure(shifted.output), output: shifted.output };
  }
  return { file, status: checked ? 'ok' : 'nichts-geprueft' };
}

/**
 * The verdict line for a clock-dependent file (German, one line, GitHub annotation).
 * @param {{file:string, shift:number, failure:string}} r
 * @returns {string}
 */
function errorLine(r) {
  return `::error::Uhr-Verschiebung: ${r.file} ist mit der echten Uhr gruen, aber bei +${r.shift} Tagen rot. `
    + `Erste fehlgeschlagene Pruefung: ${r.failure}. `
    + 'Hinweis: Uhr oder Stempel im Test festnageln (Vorbild: PR #7, tests/preisschritt-export.test.js); '
    + 'eine begruendete Ausnahme gehoert in config/clock-shift-exempt.json.';
}

/**
 * Command line entry.
 * @param {string[]} argv arguments after the script name
 * @param {NodeJS.ProcessEnv} [env]
 * @param {string} [cwd]
 * @returns {number} exit code (1 = a file is clock-dependent or the guard itself failed)
 */
function main(argv, env = process.env, cwd = ROOT) {
  const arg = (name) => { const a = argv.find(x => x.startsWith(`--${name}=`)); return a ? a.slice(name.length + 3) : ''; };
  const t0 = Date.now();
  let files;
  let exempt;
  try {
    exempt = loadExemptions(arg('exempt') || EXEMPT_FILE);
    if (arg('files')) {
      files = arg('files').split(',').map(s => s.trim().replace(/\\/g, '/')).filter(Boolean);
    } else {
      const base = arg('base') || env.BASE_REF || '';
      if (!base) {
        console.log('Uhr-Verschiebung: kein Pull Request (Push ohne PR) - es gibt keine Basis zum Vergleichen, nichts zu pruefen.');
        return 0;
      }
      files = changedTestFiles(base, cwd, console.log);
    }
  } catch (err) {
    console.log(`::error::Uhr-Verschiebung: Wachposten selbst gescheitert (${err.message})`);
    return 1;
  }
  const missing = files.filter(f => !fs.existsSync(path.join(cwd, f)));
  if (missing.length) {
    console.log(`::error::Uhr-Verschiebung: Testdatei(en) nicht gefunden: ${missing.join(', ')}`);
    return 1;
  }
  if (!files.length) {
    console.log('Uhr-Verschiebung: der PR bringt keine neuen oder geaenderten Testdateien - nichts zu pruefen.');
    return 0;
  }
  console.log(`Uhr-Verschiebung: ${files.length} Testdatei(en), je einmal bei ${SHIFT_DAYS.map(d => '+' + d).join(' und ')} Tagen.`);
  const flagged = [];
  for (const file of files) {
    const r = checkFile(file, { cwd, exempt });
    if (r.status === 'exempt') console.log(`Uhr-Verschiebung: ${file} ausgenommen (Grund: ${r.grund}).`);
    else if (r.status === 'rot-bei-echter-uhr') console.log(`Uhr-Verschiebung: ${file} ist schon bei echter Uhr rot - das meldet das Test-Gate, hier uebersprungen.`);
    else if (r.status === 'nichts-geprueft') console.log(`::warning::Uhr-Verschiebung: ${file} hat bei verschobener Uhr keine Pruefung ausgefuehrt (alle uebersprungen) - nicht belegt, zaehlt NICHT als gruen.`);
    else if (r.status === 'ok') console.log(`Uhr-Verschiebung: ${file} gruen bei ${SHIFT_DAYS.map(d => '+' + d).join(' und ')} Tagen.`);
    else {
      flagged.push(r);
      console.log(`--- ${file} bei +${r.shift} Tagen (Ausgabe) ---`);
      process.stdout.write(r.output.endsWith('\n') ? r.output : r.output + '\n');
    }
  }
  for (const r of flagged) console.log(errorLine(r));
  console.log(`Uhr-Verschiebung: ${files.length} Datei(en) in ${((Date.now() - t0) / 1000).toFixed(1)} s, ${flagged.length} uhrabhaengig.`);
  return flagged.length ? 1 : 0;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));

module.exports = { SHIFT_DAYS, isGuardedTestFile, loadExemptions, changedTestFiles, runOnce, firstFailure, checkFile, errorLine, main };

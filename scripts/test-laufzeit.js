#!/usr/bin/env node
'use strict';

/**
 * Measure standalone test files without changing the test gate.
 * Run: node scripts/test-laufzeit.js --nur=lib/*test.js --jobs=4
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { performance } = require('node:perf_hooks');
const { BLOCKING_GLOBS, expandGlobs } = require('./test-gate.js');

const REPO_ROOT = path.resolve(__dirname, '..');
const roundMs = value => Math.round(value * 1000) / 1000;

function runFile(datei, wurzel, parallel) {
  return new Promise(resolve => {
    const env = { ...process.env };
    // A serial recheck must also clear a flag inherited from an outer harness.
    delete env.TEST_LAUFZEIT_PARALLEL;
    if (parallel) env.TEST_LAUFZEIT_PARALLEL = '1';

    const start = performance.now();
    const child = spawn(process.execPath, [path.resolve(wurzel, datei)], {
      cwd: wurzel, env, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '', stderr = '', spawnError = null;
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', data => { stdout += data; });
    child.stderr.on('data', data => { stderr += data; });
    child.on('error', error => { spawnError = error; });
    child.on('close', (code, signal) => {
      if (spawnError) stderr += '\n' + spawnError.message;
      if (signal) stderr += '\nSignal: ' + signal;
      resolve({
        datei,
        ms: roundMs(performance.now() - start),
        exit: Number.isInteger(code) && !spawnError ? code : 1,
        stdout,
        stderr,
      });
    });
  });
}

function readComparison(filename) {
  if (!filename) return null;
  const previous = JSON.parse(fs.readFileSync(filename, 'utf8'));
  if (!previous || !Array.isArray(previous.dateien)) {
    throw new Error('vergleich must contain a dateien array: ' + filename);
  }
  const entries = new Map();
  for (const row of previous.dateien) {
    if (!row || typeof row.datei !== 'string' || !Number.isFinite(row.ms) || row.ms < 0) {
      throw new Error('vergleich contains an invalid timing row: ' + filename);
    }
    entries.set(row.datei, row.ms);
  }
  return entries;
}

function mdCell(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/\|/g, '\\|').replace(/[\r\n]+/g, '<br>');
}

function renderMarkdown(result, comparison) {
  const percent = value => (value * 100).toFixed(2) + '%';
  const lines = [
    '# Test-Laufzeiten',
    '',
    'Generated: ' + result.generated_at,
    'Root: ' + mdCell(result.wurzel),
    'Jobs: ' + result.jobs,
    '',
    'Gesamt: ' + result.gesamt_ms + ' ms | Median: ' + result.median_ms
      + ' ms | Top-10-Anteil: ' + percent(result.top10_anteil),
    '',
    'ms includes all attempts; shares divide by the sum of accumulated file times.',
    'Gesamt includes serial rechecks. Exit is the final status after any recheck.',
    '',
    '| Rang | ms | Datei | Exit | Anteil |' + (comparison ? ' Delta ms |' : ''),
    '| ---: | ---: | --- | ---: | ---: |' + (comparison ? ' ---: |' : ''),
  ];
  result.dateien.forEach((row, index) => {
    let line = '| ' + (index + 1) + ' | ' + row.ms + ' | ' + mdCell(row.datei)
      + ' | ' + row.exit + ' | ' + percent(row.anteil) + ' |';
    if (comparison) line += ' ' + (row.delta_ms === null ? '-' : row.delta_ms) + ' |';
    lines.push(line);
  });
  lines.push('', 'Isolationsdefekte: ' + (result.isolationsdefekte.length
    ? result.isolationsdefekte.map(mdCell).join(', ') : 'keine'), '');
  return lines.join('\n');
}

/**
 * Run Node test files in a bounded worker pool and write timing JSON/Markdown.
 * Relative output/comparison paths resolve against wurzel. An empty match fails.
 * File ms accumulates all attempts; gesamt_ms includes the worker pool and
 * serial rechecks. Final exits determine success; serial-green retries are
 * listed as isolation defects. Child output is buffered and final failures are
 * printed as whole blocks, without interleaving parallel output.
 *
 * @param {object} [options] Measurement options.
 * @param {string} [options.wurzel] Test root, defaulting to this repository.
 * @param {string[]} [options.globs] Replacement globs, defaulting to BLOCKING_GLOBS.
 * @param {number} [options.jobs=1] Positive integer worker count.
 * @param {string} [options.out='outputs'] Report directory.
 * @param {string} [options.vergleich] Previous timing JSON, adding delta_ms per file.
 * @returns {Promise<{generated_at:string, wurzel:string, jobs:number,
 * gesamt_ms:number, median_ms:number, top10_anteil:number,
 * dateien:Array<{datei:string, ms:number, exit:number, anteil:number, delta_ms?:number|null}>,
 * isolationsdefekte:string[]}>} Reports; a nonzero final file exit means failure.
 */
async function messen({
  wurzel = REPO_ROOT, globs = BLOCKING_GLOBS, jobs = 1, out = 'outputs', vergleich,
} = {}) {
  if (!Number.isSafeInteger(jobs) || jobs < 1) {
    throw new Error('jobs must be a positive integer');
  }
  if (!Array.isArray(globs) || !globs.length
    || globs.some(glob => typeof glob !== 'string' || !glob.trim())) {
    throw new Error('globs must be a non-empty array of patterns');
  }
  wurzel = path.resolve(wurzel);
  if (!fs.statSync(wurzel).isDirectory()) throw new Error('wurzel must be a directory');
  const files = [...new Set(expandGlobs(globs, wurzel))];
  if (!files.length) throw new Error('No test files matched: ' + globs.join(', '));
  const comparison = readComparison(vergleich ? path.resolve(wurzel, vergleich) : null);
  const outputDir = path.resolve(wurzel, out);
  const start = performance.now();
  const rows = new Array(files.length);
  let next = 0;

  async function worker() {
    while (next < files.length) {
      const index = next++;
      rows[index] = await runFile(files[index], wurzel, jobs > 1);
    }
  }
  await Promise.all(Array.from({ length: Math.min(jobs, files.length) }, worker));

  const isolationsdefekte = [];
  if (jobs > 1) {
    for (const row of rows) {
      if (row.exit === 0) continue;
      const serial = await runFile(row.datei, wurzel, false);
      if (serial.exit === 0) isolationsdefekte.push(row.datei);
      row.ms = roundMs(row.ms + serial.ms);
      row.exit = serial.exit;
      row.stdout = serial.stdout;
      row.stderr = serial.stderr;
    }
  }
  const gesamt_ms = roundMs(performance.now() - start);
  for (const row of rows) {
    if (row.exit !== 0 && (row.stdout || row.stderr)) {
      console.error('FAIL ' + row.datei + ' (exit ' + row.exit + ')\n' + row.stdout + row.stderr);
    }
  }
  rows.sort((a, b) => b.ms - a.ms || a.datei.localeCompare(b.datei));
  const sum = rows.reduce((total, row) => total + row.ms, 0);
  const middle = Math.floor(rows.length / 2);
  const median_ms = rows.length % 2 ? rows[middle].ms
    : roundMs((rows[middle - 1].ms + rows[middle].ms) / 2);
  const result = {
    generated_at: new Date().toISOString(),
    wurzel,
    jobs,
    gesamt_ms,
    median_ms,
    top10_anteil: sum ? rows.slice(0, 10).reduce((total, row) => total + row.ms, 0) / sum : 0,
    dateien: rows.map(row => ({
      datei: row.datei, ms: row.ms, exit: row.exit, anteil: sum ? row.ms / sum : 0,
      ...(comparison ? { delta_ms: comparison.has(row.datei)
        ? roundMs(row.ms - comparison.get(row.datei)) : null } : {}),
    })),
    isolationsdefekte: isolationsdefekte.sort(),
  };
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, 'test-laufzeit.json'), JSON.stringify(result, null, 2) + '\n');
  fs.writeFileSync(path.join(outputDir, 'test-laufzeit.md'), renderMarkdown(result, comparison));
  return result;
}

async function main(argv) {
  if (argv.length === 1 && argv[0] === '--help') {
    console.log('Usage: node scripts/test-laufzeit.js [--jobs=N] [--nur=glob ...]'
      + ' [--wurzel=dir] [--vergleich=old.json] [--out=dir]\n'
      + 'Defaults: jobs=1, gate BLOCKING_GLOBS, repository root, out=outputs.\n'
      + 'Relative out/vergleich paths resolve against wurzel. --nur replaces gate globs.');
    return 0;
  }
  const options = {};
  const globs = [];
  for (const arg of argv) {
    const match = /^--(jobs|nur|wurzel|vergleich|out)=(.+)$/.exec(arg);
    if (!match) throw new Error('Unknown or empty option: ' + arg + ' (use --help)');
    const [, name, value] = match;
    if (name === 'nur') globs.push(value);
    else options[name] = name === 'jobs' ? Number(value) : value;
  }
  if (globs.length) options.globs = globs;
  const result = await messen(options);
  const failed = result.dateien.filter(row => row.exit !== 0);
  console.log(result.dateien.length + ' files, ' + failed.length + ' failed; '
    + result.gesamt_ms + ' ms; isolation defects: ' + result.isolationsdefekte.length);
  return failed.length ? 1 : 0;
}

module.exports = { messen };
if (require.main === module) {
  main(process.argv.slice(2)).then(code => { process.exitCode = code; }).catch(error => {
    console.error('test-laufzeit: ' + error.message);
    process.exitCode = 1;
  });
}

#!/usr/bin/env node
'use strict';
// Standalone V8 coverage report. No dependencies or production-module loading.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { fileURLToPath } = require('node:url');
const { spawn } = require('node:child_process');

function options(args) {
  const result = { root: path.resolve(__dirname, '..'), tests: 'lib/*test.js,tests/*test.js', only: 'lib/,scripts/', parallel: 4, timeout: 180000, top: Infinity, fns: false, keep: false };
  const values = { '--root': 'root', '--tests': 'tests', '--only': 'only', '--parallel': 'parallel', '--timeout-ms': 'timeout', '--top': 'top', '--json': 'json' };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--fns') result.fns = true;
    else if (arg === '--keep-tmp') result.keep = true;
    else if (values[arg]) {
      const value = args[++i];
      if (!value || value.startsWith('--')) throw new Error('Missing value for ' + arg);
      result[values[arg]] = value;
    } else throw new Error('Unknown option: ' + arg);
  }
  for (const key of ['parallel', 'timeout', 'top']) {
    if (key === 'top' && result[key] === Infinity) continue;
    if (!/^\d+$/.test(String(result[key])) || !Number.isSafeInteger(Number(result[key])) || Number(result[key]) < 1) throw new Error('Expected positive integer: ' + key);
    result[key] = Number(result[key]);
  }
  result.root = path.resolve(result.root);
  if (!result.tests.split(',').every(Boolean) || !result.only.split(',').every(Boolean)) throw new Error('Empty glob or prefix');
  return result;
}

function expandGlobs(globs, cwd) {
  const out = [];
  for (const g of globs) {
    const dir = path.posix.dirname(g);
    const base = path.posix.basename(g);
    const rx = new RegExp('^' + base.split('*').map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');
    let entries;
    try { entries = fs.readdirSync(path.join(cwd, dir), { withFileTypes: true }); } catch { continue; }
    for (const e of entries) if (e.isFile() && rx.test(e.name)) out.push(dir === '.' ? e.name : dir + '/' + e.name);
  }
  return [...new Set(out)].sort();
}

async function runTests(files, opts, tmp) {
  const results = [];
  let next = 0;
  async function worker() {
    while (next < files.length) {
      const file = files[next++];
      const result = await new Promise(resolve => {
        let timedOut = false, done = false, timer;
        const child = spawn(process.execPath, [file], { cwd: opts.root, env: { ...process.env, NODE_V8_COVERAGE: tmp }, stdio: 'ignore' });
        const finish = (code, error) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          resolve({ file, code, timedOut, error });
        };
        child.on('error', error => finish(null, error.message));
        child.on('close', code => finish(code));
        timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, opts.timeout);
      });
      results.push(result);
    }
  }
  await Promise.all(Array.from({ length: Math.min(opts.parallel, files.length) }, worker));
  return results;
}

function lineCoverage(source, counts) {
  let offset = 0, block = false;
  const uncoveredLines = [];
  let total = 0, covered = 0;
  source.split('\n').forEach((raw, index) => {
    let visible = raw;
    if (block) {
      const end = raw.indexOf('*/');
      if (end < 0) { offset += raw.length + 1; return; }
      visible = ' '.repeat(end + 2) + raw.slice(end + 2);
      block = false;
    }
    const trimmed = visible.trim();
    if (trimmed.startsWith('/*')) {
      const start = visible.indexOf('/*'), end = visible.indexOf('*/', start + 2);
      if (end < 0) { block = true; offset += raw.length + 1; return; }
      visible = ' '.repeat(end + 2) + visible.slice(end + 2);
    }
    const code = visible.trim();
    if (code && !code.startsWith('//') && !code.startsWith('#!') && !/^[{}\[\]();,\s]+$/.test(code) && !/^(['"])use strict\1;?$/.test(code)) {
      total++;
      let hit = false;
      for (let i = 0; i < visible.length; i++) if (!/\s/.test(visible[i]) && counts[offset + i] > 0) { hit = true; break; }
      if (hit) covered++;
      else uncoveredLines.push(index + 1);
    }
    offset += raw.length + 1;
  });
  return { total, covered, uncoveredLines };
}

function collect(tmp, opts) {
  const docs = fs.readdirSync(tmp).filter(name => /^coverage-.*\.json$/.test(name));
  const merged = new Map();
  const prefixes = opts.only.split(',').map(p => p.replace(/\\/g, '/').replace(/^\.\//, ''));
  for (const name of docs) {
    const data = JSON.parse(fs.readFileSync(path.join(tmp, name), 'utf8'));
    for (const entry of data.result || []) {
      if (!entry.url.startsWith('file://')) continue;
      const absolute = fileURLToPath(entry.url);
      const file = path.relative(opts.root, absolute).replace(/\\/g, '/');
      if (file.startsWith('../') || path.isAbsolute(file) || /(^|\/)node_modules\//.test(file) || /test\.js$/.test(file) || !prefixes.some(prefix => file.startsWith(prefix))) continue;
      let record = merged.get(file);
      if (!record) {
        let source;
        try { source = fs.readFileSync(absolute, 'utf8'); } catch { continue; }
        record = { file, source, counts: new Int32Array(source.length).fill(-1), functions: new Map() };
        merged.set(file, record);
      }
      const counts = new Int32Array(record.source.length).fill(-1);
      const ranges = entry.functions.flatMap(fn => fn.ranges).sort((a, b) => a.startOffset - b.startOffset || b.endOffset - a.endOffset);
      for (const range of ranges) counts.fill(Math.min(range.count, 2147483647), range.startOffset, range.endOffset);
      for (let i = 0; i < counts.length; i++) record.counts[i] = Math.max(record.counts[i], counts[i]);
      for (const fn of entry.functions) {
        const r = fn.ranges[0];
        if (r.startOffset === 0 && r.endOffset === record.source.length) continue;
        const key = r.startOffset + ':' + r.endOffset + ':' + fn.functionName;
        const previous = record.functions.get(key);
        record.functions.set(key, { name: fn.functionName || '(anon)', line: record.source.slice(0, r.startOffset).split('\n').length, count: Math.max(r.count, previous ? previous.count : 0) });
      }
    }
  }
  const rows = [...merged.values()].map(record => {
    const lines = lineCoverage(record.source, record.counts);
    const functions = [...record.functions.values()];
    const uncoveredFns = functions.filter(fn => fn.count === 0).map(({ name, line }) => ({ name, line }));
    return { file: record.file, ...lines, pct: lines.total ? Number((100 * lines.covered / lines.total).toFixed(1)) : 100, fnsTotal: functions.length, fnsUncovered: uncoveredFns.length, uncoveredFns };
  }).sort((a, b) => a.pct - b.pct || a.file.localeCompare(b.file));
  return { rows, count: docs.length };
}

async function main() {
  let opts;
  try { opts = options(process.argv.slice(2)); } catch (error) { console.error('Usage: test-coverage-report.js [--tests globs] [--root dir] [--only prefixes] [--parallel N] [--timeout-ms N] [--json path] [--top N] [--fns] [--keep-tmp]\n' + error.message); return 2; }
  const files = expandGlobs(opts.tests.split(','), opts.root);
  if (!files.length) { console.error('No tests found for: ' + opts.tests); return 2; }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'test-coverage-'));
  try {
    const results = await runTests(files, opts, tmp);
    const { rows, count } = collect(tmp, opts);
    const failed = results.filter(r => !r.timedOut && r.code !== 0).length;
    const timedOut = results.filter(r => r.timedOut).length;
    console.log(`# tests: ${files.length} gelaufen, ${failed} rot, ${timedOut} timeout | coverage-json: ${count} | dateien: ${rows.length}${timedOut ? ' | TIMEOUT: killed-process coverage is lost' : ''}`);
    for (const row of rows.slice(0, opts.top)) {
      console.log(`${row.pct.toFixed(1)}%  ${row.covered}/${row.total}  fns(${row.fnsUncovered}/${row.fnsTotal})  ${row.file}`);
      if (opts.fns) console.log('  never-called fns: ' + row.uncoveredFns.map(fn => fn.name + '@' + fn.line).join(', '));
    }
    if (opts.json) fs.writeFileSync(path.resolve(opts.json), JSON.stringify(rows, null, 2) + '\n');
  } catch (error) { console.error('Coverage report incomplete: ' + error.message); }
  finally {
    if (opts.keep) console.log('Temporary coverage retained: ' + tmp);
    else {
      if (path.dirname(path.resolve(tmp)) !== path.resolve(os.tmpdir()) || !path.basename(tmp).startsWith('test-coverage-')) throw new Error('Unsafe cleanup target');
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }
  return 0;
}
main().then(code => { process.exitCode = code; }, error => { console.error(error.message); process.exitCode = 0; });

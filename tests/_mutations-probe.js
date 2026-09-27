'use strict';
// Run manually: node tests/_mutations-probe.js (deliberately outside GATE_GLOB).
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const preload = path.join(__dirname, '_mutations-preload.js');
const pairDir = path.join(__dirname, '_mutations-pairs');
const controls = new Map();
let killed = 0, survived = 0, cliOnly = 0, controlsRed = 0, failed = false;

function repositoryPath(value, label) {
  if (typeof value !== 'string' || !value || path.isAbsolute(value)) {
    throw new Error(label + ' must be a nonempty repository-relative path');
  }
  const absolute = path.resolve(root, value);
  const relative = path.relative(root, absolute);
  if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
    throw new Error(label + ' is outside the repository');
  }
  return absolute;
}

function environment() {
  const env = { ...process.env };
  // Avoid case-duplicate environment keys on Windows, and never mutate a control.
  for (const key of Object.keys(env)) {
    if (['MUT_MODULE', 'MUT_FN'].includes(key.toUpperCase())) delete env[key];
  }
  return env;
}

function run(test, mutation) {
  const env = environment();
  const args = [];
  if (mutation) {
    env.MUT_MODULE = repositoryPath(mutation.module, 'module');
    env.MUT_FN = mutation.fn;
    const optionsKey = Object.keys(env).find(key => key.toUpperCase() === 'NODE_OPTIONS');
    const existing = optionsKey ? env[optionsKey] : '';
    for (const key of Object.keys(env)) {
      if (key.toUpperCase() === 'NODE_OPTIONS') delete env[key];
    }
    // NODE_OPTIONS is inherited by nested Node processes. Quote paths with spaces.
    env.NODE_OPTIONS = (existing || '') + ' -r "' + preload.split(path.sep).join('/') + '"';
    args.push('-r', preload);
  }
  args.push(test);
  return spawnSync(process.execPath, args, { cwd: root, env, encoding: 'utf8', timeout: 120000 });
}

function detail(result) {
  return result.error ? result.error.message
    : (result.stderr || result.stdout || 'exit=' + result.status).trim().slice(-2000);
}

try {
  const files = fs.readdirSync(pairDir).filter(name => name.endsWith('.json')).sort();
  if (!files.length) throw new Error('No mutation pair files found');
  for (const file of files) {
    const pairs = JSON.parse(fs.readFileSync(path.join(pairDir, file), 'utf8'));
    if (!Array.isArray(pairs) || !pairs.length) throw new Error(file + ': expected a nonempty array');
    for (const pair of pairs) {
      if (!pair || typeof pair.fn !== 'string' || !pair.fn ||
          !['killed', 'cli-only'].includes(pair.expect)) {
        throw new Error(file + ': invalid mutation pair');
      }
      repositoryPath(pair.module, 'module');
      const test = repositoryPath(pair.test, 'test');
      const label = pair.module + '#' + pair.fn;
      if (!controls.has(test)) {
        const result = run(test);
        controls.set(test, result);
        if (result.error || result.signal || result.status !== 0) {
          controlsRed++;
          failed = true;
          console.error('FAIL Kontrolle rot: ' + pair.test + '\n' + detail(result));
        }
      }
      const control = controls.get(test);
      if (control.error || control.signal || control.status !== 0) continue;
      const result = run(test, pair);
      if (result.error || result.signal || result.status === null ||
          (result.stderr || '').includes('MUTATION_CONFIG_ERROR:')) {
        failed = true;
        console.error('FAIL mutation infrastructure: ' + label + '\n' + detail(result));
      } else if (pair.expect === 'cli-only') {
        cliOnly++;
        console.log('cli-only: ' + label + ' exit=' + result.status);
      } else if (result.status !== 0) {
        killed++;
        console.log('killed: ' + label);
      } else {
        survived++;
        failed = true;
        console.error('FAIL SURVIVED: ' + label);
      }
    }
  }
} catch (error) {
  failed = true;
  console.error('FAIL mutations-probe: ' + error.message);
}
console.log('mutations-probe: ' + killed + ' killed, ' + survived + ' survived, ' +
  cliOnly + ' cli-only, ' + controlsRed + ' Kontrollen rot');
process.exitCode = failed ? 1 : 0;

'use strict';

// Child-process harness for T204. This file is copied into a fresh OS temp
// tree before use. It requires byte-identical production-script and atomic-
// writer copies, stubs every heavy dependency, blocks all network/child-process
// access, redirects D2's fixed Vault constant, and invokes writer exports only.
// Filesystem calls are observed at runtime so a direct target write cannot pass
// merely because the source contains an atomic-looking token.

const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const Module = require('node:module');
const net = require('node:net');
const path = require('node:path');
const tls = require('node:tls');

const [scenario, scriptFile, payloadFile, rootArg, mode = 'normal', targetKey = ''] = process.argv.slice(2);
if (!scenario || !scriptFile || !payloadFile || !rootArg) {
  throw new Error('usage: fixture-runner.js <scenario> <script> <payloads> <root> [normal|break|direct] [target-key]');
}
if (mode !== 'normal' && mode !== 'break' && mode !== 'direct') {
  throw new Error('invalid T204 mode: ' + mode);
}

const root = path.resolve(rootArg);
const original = {
  closeSync: fs.closeSync,
  join: path.join,
  openSync: fs.openSync,
  renameSync: fs.renameSync,
  unlinkSync: fs.unlinkSync,
  writeSync: fs.writeSync,
  writeFileSync: fs.writeFileSync,
};
const targetPathByKey = {
  'b1-dry': 'artifacts/b1-dryrun.json',
  'b1-full': 'artifacts/b1-full.json',
  'd2-probe': 'store/d2-0-probe.json',
  'd2-stamp': 'store/entry-stamp.json',
  'd2-report-json': 'redirected-vault/agent-reports/d2-report.json',
  'd2-report-md': 'redirected-vault/agent-reports/d2-report.md',
  'd2-scan': 'store/d2-2-scan.json',
  'gqs-shadow': 'artifacts/gqs-shadow.json',
};
if (mode === 'break' && !targetPathByKey[targetKey]) {
  throw new Error('unknown T204 break target: ' + targetKey);
}
const trace = {
  scenario,
  mode,
  targetKey: targetKey || null,
  invoked: [],
  invokedTargets: [],
  opens: [],
  writeFileCalls: [],
  writeSyncCalls: [],
  renames: [],
  unlinks: [],
  breakFailure: null,
  error: null,
  networkAttempts: [],
  childProcessAttempts: [],
  fixedVaultRedirects: 0,
};
const fdPaths = new Map();

function relative(target) {
  return path.relative(root, path.resolve(String(target))).split(path.sep).join('/');
}

function insideRoot(target) {
  const rel = relative(target);
  return rel === '' || (rel !== '..' && !rel.startsWith('../') && !path.isAbsolute(rel));
}

function guardWrite(target) {
  if (!insideRoot(target)) throw new Error('T204 fixture blocked write outside temp root: ' + target);
}

function bytesOf(data, options) {
  if (Buffer.isBuffer(data)) return data;
  const encoding = typeof options === 'string'
    ? options
    : options && options.encoding || 'utf8';
  return Buffer.from(String(data), encoding);
}

fs.writeFileSync = function guardedWriteFileSync(target, data, options) {
  guardWrite(target);
  const bytes = bytesOf(data, options);
  trace.writeFileCalls.push({
    path: relative(target),
    bytes: bytes.length,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  });
  return original.writeFileSync.apply(fs, arguments);
};

function isWriteFlag(flags) {
  if (flags == null) return false;
  if (typeof flags === 'number') {
    return (flags & (fs.constants.O_WRONLY | fs.constants.O_RDWR | fs.constants.O_APPEND)) !== 0;
  }
  return /[wa+]/.test(String(flags));
}

fs.openSync = function observedOpenSync(target, flags) {
  const write = isWriteFlag(flags);
  if (write) guardWrite(target);
  const fd = original.openSync.apply(fs, arguments);
  const row = { path: relative(target), flags: String(flags), write };
  trace.opens.push(row);
  if (write) fdPaths.set(fd, row.path);
  return fd;
};

fs.writeSync = function observedWriteSync(fd) {
  if (fdPaths.has(fd)) trace.writeSyncCalls.push({ path: fdPaths.get(fd) });
  return original.writeSync.apply(fs, arguments);
};

fs.closeSync = function observedCloseSync(fd) {
  fdPaths.delete(fd);
  return original.closeSync.apply(fs, arguments);
};

fs.renameSync = function observedRenameSync(source, target) {
  guardWrite(source);
  guardWrite(target);
  const row = { source: relative(source), target: relative(target) };
  trace.renames.push(row);
  if (mode === 'break' && row.target === targetPathByKey[targetKey] && trace.breakFailure === null) {
    const error = new Error('T204_EIO_RENAME: ' + row.target);
    error.code = 'EIO';
    trace.breakFailure = { source: row.source, target: row.target, code: error.code };
    throw error;
  }
  return original.renameSync.apply(fs, arguments);
};

fs.unlinkSync = function observedUnlinkSync(target) {
  guardWrite(target);
  trace.unlinks.push({ path: relative(target) });
  return original.unlinkSync.apply(fs, arguments);
};

const fixedVaultParts = [
  'C:', 'Users', 'Anwender', 'OneDrive', 'Dokumente', 'GitHub', 'Jarvis',
  'Knowledge', 'Trading', 'growth-screener', 'agent-reports',
];
path.join = function redirectedJoin(...parts) {
  if (parts.length === fixedVaultParts.length
      && parts.every((part, index) => part === fixedVaultParts[index])) {
    trace.fixedVaultRedirects++;
    return original.join(root, 'redirected-vault', 'agent-reports');
  }
  return original.join(...parts);
};

function blockedNetwork(kind) {
  return function networkIsForbidden() {
    trace.networkAttempts.push(kind);
    throw new Error('T204 fixture blocked network access: ' + kind);
  };
}
http.get = blockedNetwork('http.get');
http.request = blockedNetwork('http.request');
https.get = blockedNetwork('https.get');
https.request = blockedNetwork('https.request');
net.connect = blockedNetwork('net.connect');
net.createConnection = blockedNetwork('net.createConnection');
tls.connect = blockedNetwork('tls.connect');
global.fetch = blockedNetwork('fetch');

function blockedChild(kind) {
  return function childProcessIsForbidden() {
    trace.childProcessAttempts.push(kind);
    throw new Error('T204 fixture blocked child process: ' + kind);
  };
}
childProcess.exec = blockedChild('exec');
childProcess.execFile = blockedChild('execFile');
childProcess.execFileSync = blockedChild('execFileSync');
childProcess.execSync = blockedChild('execSync');
childProcess.fork = blockedChild('fork');
childProcess.spawn = blockedChild('spawn');
childProcess.spawnSync = blockedChild('spawnSync');

const originalLoad = Module._load;
Module._load = function loadSyntheticDependency(request, parent, isMain) {
  // Executed absence control: production-script bytes stay untouched, but the
  // imported writer object is replaced by the old direct-write behaviour. The
  // parent test requires every runtime atomic assertion to reject this twin.
  if (request === '../lib/atomic-write.js' && mode === 'direct') {
    return { writeFileAtomic: (target, data, options) => fs.writeFileSync(target, data, options) };
  }
  if (request === '../lib/sec-pit.js') {
    return { CACHE_DIR: original.join(root, 'synthetic-cache'), REV_CONCEPTS: [] };
  }
  if (request === '../lib/b1-detect.js') return {};
  if (request === '../lib/snapshot-fs.js') return { safeSnapshotFilename: (value) => String(value) + '.json' };
  if (request === './rank-ic.js') return {};
  if (request === '../lib/sec-user-agent.js') return { assertSecContact: () => 'synthetic@example.invalid' };
  if (request === '../src/scoring/score.js') return { scoreUniverse: blockedChild('scoreUniverse'), produceRankings: blockedChild('produceRankings') };
  if (request === '../src/scoring/formulas/index.js') return Object.freeze({ synthetic: true });
  return originalLoad.call(Module, request, parent, isMain);
};

const traceFile = original.join(root, 'trace.json');
try {
  const payloads = JSON.parse(fs.readFileSync(payloadFile, 'utf8'));
  const targetModule = require(scriptFile);
  const writers = {
    'b1-dry': {
      scenario: 'b1', name: 'writeValidationReport', path: targetPathByKey['b1-dry'],
      payload: payloads.b1.dryRunReport,
    },
    'b1-full': {
      scenario: 'b1', name: 'writeValidationReport', path: targetPathByKey['b1-full'],
      payload: payloads.b1.fullReport,
    },
    'd2-probe': {
      scenario: 'd2', name: 'writeProbeArtifact', path: targetPathByKey['d2-probe'],
      payload: payloads.d2.probe,
    },
    'd2-stamp': {
      scenario: 'd2', name: 'writeEntryStamp', path: targetPathByKey['d2-stamp'],
      payload: payloads.d2.entryStamp,
    },
    'd2-report-json': {
      scenario: 'd2', name: 'writeReportJson', path: targetPathByKey['d2-report-json'],
      payload: payloads.d2.reportJson,
    },
    'd2-report-md': {
      scenario: 'd2', name: 'writeReportMarkdown', path: targetPathByKey['d2-report-md'],
      payload: payloads.d2.reportMarkdown,
    },
    'd2-scan': {
      scenario: 'd2', name: 'writeScanStats', path: targetPathByKey['d2-scan'],
      payload: payloads.d2.scanStats,
    },
    'gqs-shadow': {
      scenario: 'gqs', name: 'writeShadowReport', path: targetPathByKey['gqs-shadow'],
      payload: payloads.gqs.shadowReport,
    },
  };
  const selected = mode === 'break'
    ? [[targetKey, writers[targetKey]]]
    : Object.entries(writers).filter(([, writer]) => writer.scenario === scenario);
  if (!selected.length || selected.some(([, writer]) => !writer || writer.scenario !== scenario)) {
    throw new Error('T204 scenario/target mismatch: ' + scenario + '/' + targetKey);
  }
  for (const [key, writer] of selected) {
    if (typeof targetModule[writer.name] !== 'function') {
      throw new Error('missing exported writer helper: ' + writer.name);
    }
    const target = original.join(root, ...writer.path.split('/'));
    trace.invoked.push(writer.name);
    trace.invokedTargets.push({ key, path: writer.path });
    targetModule[writer.name](target, writer.payload);
  }
  if (mode === 'break') {
    throw new Error('T204 break probe returned without reaching renameSync for ' + targetPathByKey[targetKey]);
  }
} catch (error) {
  trace.error = {
    name: error && error.name || null,
    code: error && error.code || null,
    message: error && error.message || String(error),
  };
  process.stderr.write('[t204-fixture] ' + (error && error.stack || error) + '\n');
  process.exitCode = 1;
} finally {
  original.writeFileSync.call(fs, traceFile, JSON.stringify(trace, null, 2) + '\n', 'utf8');
}
process.stdout.write(JSON.stringify({ scenario, mode, targetKey: targetKey || null, trace: traceFile }) + '\n');

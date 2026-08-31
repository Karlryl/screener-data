'use strict';

// Child-process harness for T204. This file is copied into a fresh OS temp
// tree before use. It requires a byte-identical production-script copy, stubs
// every heavy dependency, blocks all network/child-process access, redirects
// D2's fixed Vault constant, and invokes writer exports only.

const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const Module = require('node:module');
const net = require('node:net');
const path = require('node:path');
const tls = require('node:tls');

const [scenario, scriptFile, payloadFile, rootArg] = process.argv.slice(2);
if (!scenario || !scriptFile || !payloadFile || !rootArg) {
  throw new Error('usage: fixture-runner.js <scenario> <script> <payloads> <root>');
}

const root = path.resolve(rootArg);
const original = {
  join: path.join,
  writeFileSync: fs.writeFileSync,
};
const trace = {
  scenario,
  invoked: [],
  writes: [],
  networkAttempts: [],
  childProcessAttempts: [],
  fixedVaultRedirects: 0,
};

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
  trace.writes.push({
    kind: 'writeFileSync',
    path: relative(target),
    bytes: bytes.length,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  });
  return original.writeFileSync.apply(fs, arguments);
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

const payloads = JSON.parse(fs.readFileSync(payloadFile, 'utf8'));
const targetModule = require(scriptFile);

function invoke(name, target, payload) {
  if (typeof targetModule[name] !== 'function') throw new Error('missing exported writer helper: ' + name);
  trace.invoked.push(name);
  targetModule[name](target, payload);
}

if (scenario === 'b1') {
  invoke('writeValidationReport', original.join(root, 'artifacts', 'b1-dryrun.json'), payloads.b1.dryRunReport);
  invoke('writeValidationReport', original.join(root, 'artifacts', 'b1-full.json'), payloads.b1.fullReport);
} else if (scenario === 'd2') {
  invoke('writeProbeArtifact', original.join(root, 'store', 'd2-0-probe.json'), payloads.d2.probe);
  invoke('writeEntryStamp', original.join(root, 'store', 'entry-stamp.json'), payloads.d2.entryStamp);
  invoke('writeReportJson', original.join(root, 'redirected-vault', 'agent-reports', 'd2-report.json'), payloads.d2.reportJson);
  invoke('writeReportMarkdown', original.join(root, 'redirected-vault', 'agent-reports', 'd2-report.md'), payloads.d2.reportMarkdown);
  invoke('writeScanStats', original.join(root, 'store', 'd2-2-scan.json'), payloads.d2.scanStats);
} else if (scenario === 'gqs') {
  invoke('writeShadowReport', original.join(root, 'artifacts', 'gqs-shadow.json'), payloads.gqs.shadowReport);
} else {
  throw new Error('unknown T204 fixture scenario: ' + scenario);
}

const traceFile = original.join(root, 'trace.json');
original.writeFileSync.call(fs, traceFile, JSON.stringify(trace, null, 2) + '\n', 'utf8');
process.stdout.write(JSON.stringify({ scenario, trace: traceFile }) + '\n');

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const target = path.resolve(process.env.T204_TARGET);
const tracePath = path.resolve(process.env.T204_TRACE);
const fault = process.env.T204_FAULT || '';
const trace = { target, opens: [], renames: [], unlinks: [], directWrites: [] };

const originals = {
  appendFileSync: fs.appendFileSync,
  openSync: fs.openSync,
  renameSync: fs.renameSync,
  unlinkSync: fs.unlinkSync,
  writeFileSync: fs.writeFileSync,
};

function resolved(file) {
  if (file instanceof URL) return path.resolve(file.pathname);
  return path.resolve(String(file));
}

function isTarget(file) {
  return resolved(file) === target;
}

function isTargetTemp(file) {
  return resolved(file).startsWith(`${target}.tmp.`);
}

function directWrite(kind, file) {
  if (!isTarget(file)) return;
  trace.directWrites.push({ kind, path: resolved(file) });
  const error = new Error(`T204_DIRECT_WRITE_GUARD: ${kind} ${resolved(file)}`);
  error.code = 'ET204DIRECT';
  throw error;
}

fs.writeFileSync = function guardedWriteFileSync(file, ...args) {
  directWrite('writeFileSync', file);
  return originals.writeFileSync.call(fs, file, ...args);
};

fs.appendFileSync = function guardedAppendFileSync(file, ...args) {
  directWrite('appendFileSync', file);
  return originals.appendFileSync.call(fs, file, ...args);
};

fs.openSync = function tracedOpenSync(file, flags, ...args) {
  if (isTarget(file) || isTargetTemp(file)) {
    trace.opens.push({ path: resolved(file), flags: String(flags) });
  }
  return originals.openSync.call(fs, file, flags, ...args);
};

fs.renameSync = function tracedRenameSync(from, to) {
  if (isTarget(to)) {
    trace.renames.push({ from: resolved(from), to: resolved(to) });
    if (fault === 'rename-eio') {
      const error = new Error(`T204_RENAME_EIO: ${resolved(to)}`);
      error.code = 'EIO';
      throw error;
    }
  }
  return originals.renameSync.call(fs, from, to);
};

fs.unlinkSync = function tracedUnlinkSync(file) {
  if (isTargetTemp(file)) trace.unlinks.push({ path: resolved(file) });
  return originals.unlinkSync.call(fs, file);
};

process.on('exit', () => {
  originals.writeFileSync.call(fs, tracePath, JSON.stringify(trace, null, 2), 'utf8');
});


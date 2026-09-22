'use strict';

const fs = require('node:fs');
const path = require('node:path');
const target = path.resolve(process.env.T204_TARGET);
const trace = { renames: [], unlinks: [], directWrites: [] };
const original = { write: fs.writeFileSync, rename: fs.renameSync, unlink: fs.unlinkSync };
let armed = false;
const matches = (file) => path.resolve(String(file)) === target;

fs.writeFileSync = function (file, ...args) {
  if (armed && matches(file)) {
    trace.directWrites.push(String(file));
    throw new Error('T204_DIRECT_WRITE_GUARD');
  }
  return original.write.call(fs, file, ...args);
};
fs.renameSync = function (from, to) {
  if (armed && matches(to)) {
    trace.renames.push({ from: String(from), to: String(to) });
    if (process.env.T204_FAULT === 'rename-eio'
        && trace.renames.length === Number(process.env.T204_OCCURRENCE)) {
      const error = new Error('T204_RENAME_EIO');
      error.code = 'EIO';
      throw error;
    }
  }
  return original.rename.call(fs, from, to);
};
fs.unlinkSync = function (file) {
  if (armed && String(file).startsWith(target + '.tmp.')) trace.unlinks.push(String(file));
  return original.unlink.call(fs, file);
};
process.on('exit', () => original.write.call(fs, process.env.T204_TRACE, JSON.stringify(trace)));
module.exports = { arm() { armed = true; } };

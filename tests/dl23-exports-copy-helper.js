'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const Module = require('node:module');
const assert = require('node:assert/strict');
const ROOT = path.resolve(__dirname, '..');
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
// Extract exact declarations to keep unrelated I/O behind explicit synthetic seams.
function copy(relative, names, prelude = '') {
  const live = path.resolve(ROOT, relative);
  assert(live.startsWith(ROOT + path.sep), 'Source must stay inside the test repository');
  const original = fs.readFileSync(live);
  const source = original.toString('utf8');
  let body = source;
  if (names) {
    // ponytail: current declarations start at column zero; use a parser if their syntax changes.
    const lines = source.split(/(?<=\n)/);
    body = names.map(name => {
      assert.match(name, /^[A-Za-z_$][\w$]*$/);
      const anchor = new RegExp('^(?:function ' + name + '\\b|const ' + name + '\\s*=)');
      const matches = lines.flatMap((line, index) => anchor.test(line) ? [index] : []);
      assert.equal(matches.length, 1, 'Unique declaration required: ' + name);
      let declaration = '';
      for (let i = matches[0]; i < lines.length; i++) {
        declaration += lines[i];
        try { new vm.Script(declaration); return declaration; }
        catch (error) { if (!(error instanceof SyntaxError)) throw error; }
      }
      throw new Error('Incomplete declaration: ' + name);
    }).join('\n') + '\nmodule.exports = {' + names.join(',') + '};\n';
  }
  const isolated = new Module(live, module);
  isolated.filename = live;
  isolated.paths = Module._nodeModulePaths(path.dirname(live));
  isolated._compile("'use strict';\n" + prelude + '\n' + body, live);
  assert.equal(digest(fs.readFileSync(live)), digest(original), 'Source changed while loading');
  return isolated.exports;
}
module.exports = { copy };

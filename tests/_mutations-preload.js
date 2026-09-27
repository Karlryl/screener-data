'use strict';
// Test-only null stubs. This file deliberately does not match *test.js.
// Appendix A was absent from the S14 queue; this implements its stated contract.
const Module = require('node:module');
const path = require('node:path');
const target = process.env.MUT_MODULE;
const name = process.env.MUT_FN;

if (target && name) {
  const targetPath = path.resolve(target);
  const originalLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    const exported = originalLoad.apply(this, arguments);
    const resolved = Module._resolveFilename(request, parent, isMain);
    if (resolved === targetPath) {
      if (!exported || typeof exported[name] !== 'function') {
        throw new Error('MUTATION_CONFIG_ERROR: export is not a function: ' + targetPath + '#' + name);
      }
      exported[name] = function mutationNullStub() { return null; };
    }
    return exported;
  };
}

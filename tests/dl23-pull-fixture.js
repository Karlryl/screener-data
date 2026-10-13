'use strict';
// Reuse the existing virtual filesystem/provider fixture without running its own suite.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const fixturePath = path.join(__dirname, 'stale-quarter-reload.test.js');
let harness = fs.readFileSync(fixturePath, 'utf8');
const entry = 'if (require.main === module)';
assert.equal(harness.split(entry).length, 2, 'Offline fixture entry must remain unique');
harness = harness.split(entry)[0];
function replaceLine(anchor, replacement) {
  const lines = harness.split(/\r?\n/);
  assert.equal(lines.filter(line => line === anchor).length, 1, 'Offline fixture seam must remain unique: ' + anchor);
  harness = lines.map(line => line === anchor ? replacement : line).join('\n');
}
replaceLine('  annualResponses = null, summaryResponse = null, pullSource = source, providersByTicker = null,',
  '  annualResponses = null, summaryResponse = null, pullSource = source, providersByTicker = null, fxRates = null,');
replaceLine('  put(configPath, { ...DEFAULT, maxPerRun: cap });',
  "  put(configPath, { ...DEFAULT, maxPerRun: cap });\n  if (fxRates) put(path.join(root, 'fx-rates.json'), fxRates);");
harness += '\nmodule.exports = { fixture, snapshot, NOW, DEFAULT, source, root };\n';
const fixtureModule = { exports: {} };
vm.runInThisContext('(function(require, __dirname, module, exports) {\n' + harness + '\n})', { filename: fixturePath })(
  createRequire(fixturePath), __dirname, fixtureModule, fixtureModule.exports);
module.exports = fixtureModule.exports;

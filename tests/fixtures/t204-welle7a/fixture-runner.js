'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const preload = require('./preload.js');
const [site, root, dir] = process.argv.slice(2);
const input = JSON.parse(process.env.T204_INPUT);
const filename = path.join(root, 'scripts', 'write-druckenmiller-export.js');
const logger = {
  EXPORT_SCHEMA: 'synthetic/t204', FAILED_NAME: '_FAILED.json', LEDGER_NAME: 'ledger.jsonl',
  sitzungen: () => [],
  schreibeFehlermarker(exportDir) {
    // Model the external logger replacing the old marker before the restore site.
    fs.writeFileSync(path.join(exportDir, '_FAILED.json'), input.replacement);
    preload.arm();
  },
};
const mocks = {
  '../lib/druckenmiller/internals.js': {},
  '../lib/druckenmiller/universe.js': {},
  '../lib/druckenmiller/ledger.js': {
    verifyChain: () => ({ ok: true, rows: [{ date: '2099-01-02' }] }),
    readMeta: () => null, ledgerGapDays: () => 0, assertFinite() {},
  },
  '../lib/druckenmiller/churn.js': {},
  '../lib/druckenmiller/scoreboard.js': {},
  '../lib/druckenmiller/thirteenf.js': {},
  '../lib/druckenmiller/raw.js': {},
  '../lib/druckenmiller/registration.js': {},
  './druckenmiller-log-internals.js': logger,
};
const context = vm.createContext({
  __dirname: path.dirname(filename), module: { exports: {} }, console, input,
  require(name) {
    if (name.startsWith('node:')) return require(name);
    if (name === '../lib/atomic-write.js') return require(path.join(root, 'lib/atomic-write.js'));
    if (Object.hasOwn(mocks, name)) return mocks[name];
    throw new Error('Unexpected fixture dependency: ' + name);
  },
});
// Execute the complete, unchanged production source; replace only data-building seams.
// The actual writeExport/checkExport control flow and all six writes remain production code.
vm.runInContext(fs.readFileSync(filename, 'utf8'), context, { filename });
vm.runInContext(`
  leseRegistrierung = () => ({ json: { courtGates: { churnMaxShare: 0.05 } } });
  churnSerie = () => ({ churn: new Map(), unbekannt: 0, letzteRoh: [] });
  abdeckung = () => ({});
  baueRegime = () => input.regime;
  baueMeta = () => input.meta;
  lese13f = () => input.with13f ? {} : null;
  baue13f = () => input.thirteen;
  leseDateiB = () => null;
  baueCandidates = () => input.candidates;
`, context);
const opts = { outDir: dir, exportDir: dir, pricesDir: dir, protocolDir: dir, log: console.log };
if (site === 'marker') {
  process.exitCode = context.module.exports.checkExport(opts);
} else {
  preload.arm();
  process.exitCode = context.module.exports.writeExport(opts);
}

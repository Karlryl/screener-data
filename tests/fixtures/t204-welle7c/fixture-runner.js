'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const [action, repoRoot, target] = process.argv.slice(2);
const NativeDate = Date;
global.Date = class extends NativeDate {
  constructor(...args) { super(...(args.length ? args : ['2000-01-01T00:00:00.000Z'])); }
};

// Keep this writer-only fixture independent of production data and dependencies.
const load = Module._load;
Module._load = function (id, parent, isMain) {
  if (id === '../lib/druckenmiller/thirteenf.js') return {
    buildNameIndex: (names) => names,
    matcherCoverage(issuers, names) {
      if (issuers.length !== 3 || names.size !== 0) throw new Error('fixture input drift');
      return { n: 3, matched: 1, share: 1 / 3, ambiguous: 1, identityRejected: 1 };
    },
  };
  if (id === '../lib/druckenmiller/universe.js') return {};
  if (id === '../lib/snapshot-fs.js') return {};
  return load.call(this, id, parent, isMain);
};
for (const name of ['node:http', 'node:https', 'node:net']) {
  const network = require(name);
  for (const method of ['get', 'request', 'connect', 'createConnection']) {
    if (network[method]) network[method] = () => { throw new Error('fixture forbids network'); };
  }
}
global.fetch = () => { throw new Error('fixture forbids network'); };

const writer = require(path.join(repoRoot, 'scripts', 'druckenmiller-13f.js'));
if (action === 'quarter') {
  writer.schreibeQuartal(path.dirname(target), {
    period: '2099-03-31', positions: 2, totalValueUSD: 123456.789,
    coverage: 1 / 3, quarantined: false, quarantineReason: null,
    rows: [{ issuer: 'M\u00fcnchen "Alpha"', valueUSD: 100.125, putCall: null },
      { issuer: 'Beta', valueUSD: null, putCall: 'PUT' }],
  });
} else if (action === 'coverage') {
  const csvPfad = path.join(path.dirname(target), 'issuers.csv');
  fs.writeFileSync(csvPfad, 'cusip,issuer\n111,Alpha\n222,"Beta, Inc."\n333,Gamma\n,\n');
  writer.abdeckungMessen({ csvPfad, outDir: path.dirname(target),
    snapshotsDir: path.join(path.dirname(target), 'missing-snapshots'), log() {} });
} else {
  throw new Error(`unknown fixture action: ${action}`);
}

#!/usr/bin/env node
'use strict';
// Merge job, after the price merge: writes the class-sum market cap (lib/mcap-class-sum.js, configs/mcap-class-sum.json)
// into the merged snapshots. A config or I/O error exits 1 (red X); an issuer without a computable sum is a warning
// and gets an empty value with a German reason.
// Usage: node scripts/apply-mcap-class-sum.js --snapshots snapshots --prices prices --fx fx-rates.json --date YYYY-MM-DD
const { parseArgs } = require('node:util');
const { applyClassSums } = require('../lib/mcap-class-sum.js');

const { values: a } = parseArgs({ options: { snapshots: { type: 'string' }, prices: { type: 'string' }, fx: { type: 'string' }, date: { type: 'string' } } });
if (!a.snapshots || !a.prices || !a.fx || !a.date) {
  console.error('usage: apply-mcap-class-sum.js --snapshots <dir> --prices <dir> --fx <fx-rates.json> --date YYYY-MM-DD');
  process.exit(2);
}
const report = applyClassSums({ snapshotsDir: a.snapshots, pricesDir: a.prices, fxFile: a.fx, dataDay: a.date });
for (const r of report) {
  console.log(`${r.issuer}: ${r.value === null ? 'leer (' + r.reason + ')' : (r.value / 1e9).toFixed(3) + ' Mrd. USD, Schlusskurse ' + r.date} -> gezeigt ${r.shown || "keine Zeile"}, geschrieben ${r.written.join(', ') || 'keine Zeile'}`);
}
const empty = report.filter((r) => r.value === null).length;
console.log(`Klassensumme: ${report.length} Firmen, ${report.length - empty} gerechnet, ${empty} leer.`);

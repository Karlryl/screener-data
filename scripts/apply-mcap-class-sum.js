#!/usr/bin/env node
'use strict';
// Merge job, on the merged snapshots: writes the class-sum market cap (lib/mcap-class-sum.js, configs/mcap-class-sum.json).
// Fetches the unadjusted daily closes of every class line and of each class currency's FX pair (about 50 Yahoo chart calls).
// A config or I/O error exits 1 (red X); an issuer without a computable sum is a warning and gets an empty value with a
// German reason.
// Usage: node scripts/apply-mcap-class-sum.js --snapshots snapshots --date YYYY-MM-DD
const { parseArgs } = require('node:util');
const { applyClassSums } = require('../lib/mcap-class-sum.js');

const { values: a } = parseArgs({ options: { snapshots: { type: 'string' }, date: { type: 'string' } } });
if (!a.snapshots || !a.date) {
  console.error('usage: apply-mcap-class-sum.js --snapshots <dir> --date YYYY-MM-DD');
  process.exit(2);
}
const YF = require('yahoo-finance2').default;
const yf = typeof YF === 'function' ? new YF({ validation: { logErrors: false, logOptionsErrors: false } }) : YF;
const chart = (symbol, query) => yf.chart(symbol, query, { fetchOptions: { signal: AbortSignal.timeout(30000) } });

applyClassSums({ snapshotsDir: a.snapshots, dataDay: a.date, chart }).then((report) => {
  for (const r of report) {
    console.log(`${r.issuer}: ${r.value === null ? 'leer (' + r.reason + ')' : (r.value / 1e9).toFixed(3) + ' Mrd. USD, Schlusskurse ' + r.date} -> gezeigt ${r.shown || 'keine Zeile'}, geschrieben ${r.written.join(', ') || 'keine Zeile'}`);
  }
  const empty = report.filter((r) => r.value === null).length;
  console.log(`Klassensumme: ${report.length} Firmen, ${report.length - empty} gerechnet, ${empty} leer.`);
}).catch((e) => { console.error('::error::Klassensumme: ' + e.message); process.exit(1); });

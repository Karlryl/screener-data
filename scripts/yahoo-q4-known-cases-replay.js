#!/usr/bin/env node
'use strict';

// Read-only proof of the Q4 authority, independent of later input overlays. Never writes snapshots.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const assert = require('assert/strict');
const { applyKnownCases } = require('../lib/yahoo-q4-known-cases.js');
const { isMetadataSnapshot } = require('../lib/snapshot-fs.js');
const { norm } = require('../src/scoring/snapshot.js');
const evidence = require('../tests/fixtures/yahoo-q4-known-cases.json');
const table = require('../configs/yahoo-q4-known-cases.json');
const hash = raw => crypto.createHash('sha256').update(raw).digest('hex');

function replay(dir) {
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json') && !isMetadataSnapshot(f)).sort();
  const beforeHashes = new Map(), changes = [], controls = [];
  let unchangedSnapshots = 0, snapshots = 0;
  const events = [], warn = console.warn;
  console.warn = line => events.push(line);
  try {
    for (const file of files) {
      const fp = path.join(dir, file), bytes = fs.readFileSync(fp);
      beforeHashes.set(file, hash(bytes));
      // This replay proves the Q4 authority only. Other hand tables have their own
      // full reader replay; allowing their cells here would weaken the 27-cell guard.
      const original = JSON.parse(bytes), scored = applyKnownCases(original).snapshot;
      if (!original?.meta?.ticker) continue;
      snapshots++;
      const ticker = original.meta.ticker;
      if (JSON.stringify(original) === JSON.stringify(scored)) unchangedSnapshots++;
      const restored = { ...scored, timeseries: { ...scored.timeseries } };
      for (const field of ['revenueQ', 'opIncQ', 'grossProfitQ']) {
        const oldSeries = original.timeseries?.[field] || [], newSeries = scored.timeseries?.[field] || [];
        assert.equal(oldSeries.length, newSeries.length, `${ticker} ${field} length`);
        const ends = original.timeseries?.[field + 'Ends'] || [];
        for (let i = 0; i < oldSeries.length; i++) {
          if (JSON.stringify(oldSeries[i]) === JSON.stringify(newSeries[i])) continue;
          const proof = evidence.cells.find(c => c.ticker === ticker && c.field === field && c.period === ends[i]);
          assert.equal(proof?.verdict, 'WRONG', `Unauthorized change: ${ticker} ${field} ${ends[i]}`);
          const factor = original.meta.fxConverted ? original.meta.fxRateApplied : 1;
          const expected = proof.expectedNative === null ? null : proof.expectedNative * factor;
          assert.equal(norm(scored, field)[i], expected, `${ticker} scored value`);
          assert.equal(newSeries[i].yahooQ4Correction.originalVendorNativeValue, proof.vendorNative);
          if (restored.timeseries[field] === newSeries) restored.timeseries[field] = newSeries.slice();
          restored.timeseries[field][i] = oldSeries[i];
          changes.push({ ticker, field, period: ends[i], oldNative: proof.vendorNative,
            newNative: proof.expectedNative, currency: proof.currency, oldScored: norm(original, field)[i],
            newScored: norm(scored, field)[i], fxRate: factor,
            source: table.cases.find(c => c.listingAliases.includes(ticker) && c.field === field).sources[0].url });
        }
      }
      // All other rows, fields and metadata must serialize to identical bytes, in original order.
      // Adding timeseries to snapshots which lacked it is only a harness concern.
      if (!Object.hasOwn(original, 'timeseries')) delete restored.timeseries;
      assert.equal(JSON.stringify(restored), JSON.stringify(original), `${ticker}: unrelated bytes changed`);
      for (const c of evidence.cells.filter(c => c.ticker === ticker && c.verdict !== 'WRONG')) {
        const i = original.timeseries?.[c.field + 'Ends']?.indexOf(c.period);
        assert.ok(i >= 0, `Missing control ${ticker} ${c.field}`);
        assert.equal(JSON.stringify(scored.timeseries[c.field][i]), JSON.stringify(original.timeseries[c.field][i]));
        controls.push(`${ticker}|${c.field}|${c.verdict}`);
      }
    }
  } finally {
    console.warn = warn;
    for (const [file, before] of beforeHashes) assert.equal(hash(fs.readFileSync(path.join(dir, file))), before, `Disk changed: ${file}`);
  }
  assert.equal(changes.length, 27, 'Exactly 27 verified cells must change');
  assert.equal(new Set(changes.map(c => `${c.ticker}|${c.field}|${c.period}`)).size, 27);
  assert.equal(controls.length, 44, 'All 22 CORRECT + 22 UNDECIDED controls present');
  return { snapshots, unchangedSnapshots, changedSnapshots: snapshots - unchangedSnapshots,
    changedCells: changes.length, controlsUnchanged: controls.length, diskHashesUnchanged: beforeHashes.size,
    aggregateSha256: hash(JSON.stringify([...beforeHashes])), changes,
    events: events.map(line => JSON.parse(line.slice(line.indexOf('{')))) };
}

if (require.main === module) {
  const dir = process.argv[2] || process.env.SCREENER_SNAPSHOTS_DIR;
  if (!dir) throw new Error('Supply snapshot directory or SCREENER_SNAPSHOTS_DIR');
  const report = replay(dir);
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
}
module.exports = { replay };

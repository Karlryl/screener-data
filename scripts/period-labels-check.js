'use strict';

// Offline shadow only. All export mutations below are on in-memory copies.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { applyFinancialCases, table } = require('../lib/financial-known-cases.js');
const { revGrowthLeg, isoTag } = require('../lib/rev-growth-basis.js');
const fixtures = require('../tests/fixtures/period-labels/period-fixtures.json');
const comparisons = require('../reports/period-labels-2026-10-06/filing-comparisons.json');
const ROOT = path.resolve(__dirname, '..');
const FROZEN = path.join(ROOT, 'outputs/findash-export/v1-frozen-20261003');
const INDEX_HASH = '2b785612ce8ffafcfe64d06a7bad51885785abfbac260642700e49a3dcdebe3b';
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const rowsOf = j => j.rows || [...(j.profitable || []), ...(j.unprofitable || [])];
const valueOf = row => typeof row === 'number' ? row : row?.value;

function fixtureSnapshot(c) {
  return { meta: { ticker: c.ticker, reportingCurrency: 'USD', source: 'yahoo' },
    annual: c.annual, timeseries: {
      revenueQ: c.rows.map(r => ({ value: r.value })), revenueQEnds: c.rows.map(r => r.vendorEnd),
    } };
}

function authorityFor(s, i, config = table) {
  return (config.periodLabels || []).find(c => [c.ticker, ...(c.listingAliases || [])].includes(s.meta.ticker) &&
    c.field === 'revenueQ' && c.currency === s.meta.reportingCurrency &&
    c.period === s.timeseries.revenueQEnds[i] && c.verifiedValue === valueOf(s.timeseries.revenueQ[i]));
}

// The guard checks the actual labels, including absence of authority, not a code-text pattern.
function assertLabelAuthority(s, leg, config = table) {
  for (const [i, end] of (s.timeseries.reportedRevenueQEnds || []).entries()) {
    if (end !== null) assert.equal(end, authorityFor(s, i, config)?.reportedPeriodEnd,
      `${s.meta.ticker}: annotation without matching hand-table entry at index ${i}`);
  }
  if (leg.basis !== 'quarter') return;
  for (const [label, source] of [['periodEnd', 'sourcePeriodEnd'], ['priorPeriodEnd', 'sourcePriorPeriodEnd']]) {
    if (leg[label] === leg[source]) continue;
    const i = s.timeseries.revenueQEnds.findIndex(end => isoTag(end) === leg[source]);
    assert.equal(leg[label], authorityFor(s, i, config)?.reportedPeriodEnd,
      `${s.meta.ticker}: ${label} changed without matching hand-table entry`);
  }
}

function checkFixtures() {
  console.log('Fixture | pct before | pct after | label before -> after | source end');
  for (const c of fixtures.cases) {
    const input = fixtureSnapshot(c), before = revGrowthLeg(input);
    const prepared = applyFinancialCases(input).snapshot, after = revGrowthLeg(prepared);
    assert.equal(after.pct, before.pct, c.ticker + ': pct changed');
    assert.deepEqual(prepared.timeseries.revenueQ, input.timeseries.revenueQ);
    assert.deepEqual(prepared.timeseries.revenueQEnds, input.timeseries.revenueQEnds);
    assertLabelAuthority(prepared, after);
    if (['CRDO', 'KLIC'].includes(c.ticker)) assert.equal(after.periodEnd, c.rows[0].reportedEnd);
    else assert.deepEqual(after, before);
    console.log(`${c.ticker} | ${before.pct} | ${after.pct} | ${before.periodEnd} -> ${after.periodEnd} | ${after.sourcePeriodEnd}`);
  }
}

function readFrozen() {
  const files = new Map();
  for (const line of fs.readFileSync(path.join(FROZEN, 'SHA256SUMS.txt'), 'utf8').trim().split(/\r?\n/)) {
    const match = /^([a-f0-9]{64}) \*\.\/(.+)$/.exec(line);
    assert(match, 'Invalid frozen checksum line');
    const [, expected, name] = match, file = path.resolve(FROZEN, name);
    assert(file.startsWith(FROZEN + path.sep) && name.endsWith('.json'), 'Checksum path outside frozen generation');
    assert(!files.has(name), 'Duplicate checksum path');
    const bytes = fs.readFileSync(file);
    assert.equal(hash(bytes), expected, name + ': frozen checksum changed');
    files.set(name, { file, expected, bytes });
  }
  assert.equal(files.size, 29);
  assert.equal(files.get('index.json').expected, INDEX_HASH);
  return files;
}

function checkFrozen() {
  // Verify every byte before parsing/using the generation.
  const files = readFrozen(), W = require('./write-findash-export.js');
  const index = JSON.parse(files.get('index.json').bytes);
  assert.equal(index.generated_at, '2026-10-03T09:31:17.258Z');
  assert.deepEqual(W.validateExport(FROZEN), [], 'Frozen export fails current validator');
  console.log(`Frozen: ${files.size} SHA256 checks OK; index ${INDEX_HASH}`);
  console.log('Frozen file | ticker | pct (unchanged) | exported pair -> proposed label pair');
  let checked = 0, sourceRows = 0;
  const errors = [];
  for (const [name, { bytes }] of files) {
    const original = JSON.parse(bytes), shadow = structuredClone(original);
    const shortName = name.replace(/^full\//, '').replace(/\.json$/, '');
    for (const [i, row] of rowsOf(shadow).entries()) {
      if (!Object.hasOwn(row, 'revGrowthPeriodEnd')) continue;
      row.revGrowthSourcePeriodEnd = row.revGrowthPeriodEnd;
      row.revGrowthSourcePriorPeriodEnd = row.revGrowthPriorPeriodEnd;
      sourceRows++;
      const proof = comparisons.find(c => c.ticker === row.ticker && c.export.currentEnd === row.revGrowthPeriodEnd &&
        c.export.priorEnd === row.revGrowthPriorPeriodEnd && c.export.basis === row.revGrowthBasis);
      if (proof) {
        assert.equal(row.revGrowthYoYPct, proof.export.growth, row.ticker + ': frozen pct differs from evidence');
        assert.equal((proof.original.currentRevenueUSD / proof.original.priorRevenueUSD - 1) * 100, row.revGrowthYoYPct);
        for (const [p, field] of [['current', 'revGrowthPeriodEnd'], ['prior', 'revGrowthPriorPeriodEnd']]) {
          const label = table.periodLabels.find(c => c.ticker === row.ticker && c.currency === 'USD' &&
            c.period === proof.export[p + 'End'] && c.verifiedValue === proof.original[p + 'RevenueUSD']);
          if (label) row[field] = label.reportedPeriodEnd;
          assert.equal(row[field], proof.original[p + 'End']);
        }
        if (shortName === proof.board) {
          checked++;
          console.log(`${name} | ${row.ticker} | ${row.revGrowthYoYPct} | ${proof.export.currentEnd}/${proof.export.priorEnd} -> ${row.revGrowthPeriodEnd}/${row.revGrowthPriorPeriodEnd}`);
        }
      }
      const { revGrowthSourcePeriodEnd, revGrowthSourcePriorPeriodEnd, ...rest } = row;
      rest.revGrowthPeriodEnd = revGrowthSourcePeriodEnd;
      rest.revGrowthPriorPeriodEnd = revGrowthSourcePriorPeriodEnd;
      assert.equal(JSON.stringify(rest), JSON.stringify(rowsOf(original)[i]), name + ': non-label field changed');
    }
    W.validateFile(shadow, shortName, errors, shortName === 'index' ? { requireCohortCounts: true } :
      ['overview', 'survival'].includes(shortName) ? {} : {
        deliveryMode: name.startsWith('full/') ? 'full' : 'topN', cohortCounts: index.counts[shortName],
      });
  }
  assert.equal(checked, 12, 'Every evidence row must occur once in each short/full board');
  assert.deepEqual(errors, [], 'Frozen after-tree fails validator');
  for (const { file, expected } of files.values()) assert.equal(hash(fs.readFileSync(file)), expected, 'Frozen file modified');
  console.log(`Frozen after-tree: ${sourceRows} rows with additive source fields; 0 validation errors; 29 file hashes unchanged.`);
  console.log('revGrowthYoYPct untouched by construction: this label/export change writes no value field.');
  console.log('ADI: only 2026-07-31 and 2025-07-31 verified. SKYT: only 2026-03-31 and 2025-03-31 verified. All other periods keep vendor labels.');
}

if (require.main === module) { checkFixtures(); checkFrozen(); }
module.exports = { fixtureSnapshot, assertLabelAuthority, checkFixtures, checkFrozen };

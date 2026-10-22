'use strict';
// Every hold (quarantine) carries the day its reason was last checked, so a stale reason (TYG: "statements end
// 2017" long after the packet reached FY2025) is visible by its date. Break-once mutations stay in memory.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { table, applyFinancialCases } = require('../lib/financial-known-cases.js');
const fixture = require('./fixtures/financial-known-cases.json').snapshots;

const isoDay = d => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && new Date(d).toISOString().slice(0, 10) === d;
const today = new Date().toISOString().slice(0, 10);
const OLD_REASON = 'Score fehlt: Die Abschlusszahlen des Anbieters enden mit dem Geschäftsjahr bis 30.11.2017; das daraus berechnete Wachstum (−98,9 %) ist kein aktueller Wert.';
function checkDated(quarantines) {
  for (const q of quarantines) {
    assert.ok(isoDay(q.reasonDate), q.caseId + ': reasonDate missing or not an ISO day');
    assert.ok(q.reasonDate >= '2026-01-01' && q.reasonDate <= today, q.caseId + ': reasonDate out of range');
    // A date written into the visible reason must be the same day.
    const shown = /Geprüft am (\d{2})\.(\d{2})\.(\d{4})/.exec(q.reason);
    if (shown) assert.equal(`${shown[3]}-${shown[2]}-${shown[1]}`, q.reasonDate, q.caseId + ': reason date differs');
  }
}

test('every hold entry carries a dated reason', () => {
  assert.ok(table.quarantines.length > 0);
  checkDated(table.quarantines);
  // Break-once on test data: dropping the whole reasonDate line of any hold turns the guard red.
  let breaks = 0;
  for (const q of table.quarantines) {
    const copy = structuredClone(table.quarantines);
    delete copy.find(x => x.caseId === q.caseId).reasonDate;
    assert.throws(() => checkDated(copy), assert.AssertionError); breaks++;
  }
  assert.equal(breaks, table.quarantines.length);
});

test('TYG hold reason reflects the current FY2025 packet, not the old 2017 one', () => {
  const q = table.quarantines.find(x => x.ticker === 'TYG');
  assert.equal(q.reasonDate, '2026-10-22');
  assert.ok(!q.reason.includes('2017'), 'no stale 2017 reason');
  assert.ok(q.reason.includes('46,6 Mio. USD') && q.reason.includes('24,9 Mio. USD'));
  // The exact 2026-10-22 packet is held without the fingerprint-drift warning.
  const r = applyFinancialCases(structuredClone(fixture.TYG));
  assert.equal(r.snapshot.meta.financialDataIssue?.reason, q.reason);
  assert.ok(!r.events.some(e => e.status === 'stale'), 'exact current packet: no drift warning');
  // Live snapshots keep meta across price-only pulls and still store the old reason under the same caseId
  // (published export of 22.10.2026); applying the table must replace it with the re-checked reason and sources.
  const stored = structuredClone(fixture.TYG);
  stored.meta.financialDataIssue = { caseId: q.caseId, reason: OLD_REASON, sources: [] };
  assert.deepEqual(applyFinancialCases(stored).snapshot.meta.financialDataIssue,
    { caseId: q.caseId, reason: q.reason, sources: q.sources });
  assert.equal(fixture.TYG.annual.annualRevEnds[0], '2025-11-30');
});

'use strict';
// sd-halbjahr (12.11.2026): a row whose company has already reported a later period than the shown one says so (code
// `neuerer-bericht`) instead of showing a guessed number. Metas are the real cells of daily-pull run 42994757810 (11.11.2026).
const test = require('node:test');
const assert = require('node:assert/strict');
const { newerReportHint } = require('../scripts/write-findash-export.js');

const POP_MART = { ticker: '9992.HK', mostRecentQuarter: '2026-06-30T00:00:00.000Z' };          // shown: fiscal year to 31.12.2025
const GENSCRIPT = { ticker: '1548.HK', mostRecentQuarter: '2026-06-30T00:00:00.000Z' };          // shown: fiscal year to 31.12.2025
const SOLAR = { ticker: 'SOLARINDS.NS', mostRecentQuarter: '2026-09-30T00:00:00.000Z' };         // shown: quarter to 30.06.2026

test('a fiscal year shown while the interim to 30.06.2026 is out gets the hint, with both dates', () => {
  const h = newerReportHint(GENSCRIPT, { basis: 'year', periodEnd: '2025-12-31' });
  assert.equal(h.code, 'neuerer-bericht');
  assert.equal(h.reason, 'Die Firma hat laut Yahoo schon einen Abschluss bis 30.06.2026 veröffentlicht. Für diesen Zeitraum liegt in den Daten kein geprüftes Umsatzpaar vor, deshalb zeigt das Board weiter das Geschäftsjahr bis 31.12.2025.');
  assert.match(newerReportHint(POP_MART, { basis: 'yearNewerRecord', periodEnd: '2025-12-31' }).reason, /das Geschäftsjahr bis 31\.12\.2025/);
});

test('an Indian June quarter shown while September is reported gets the hint', () => {
  assert.match(newerReportHint(SOLAR, { basis: 'quarter', periodEnd: '2026-06-30' }).reason, /bis 30\.09\.2026 .* das Quartal bis 30\.06\.2026\.$/);
});

test('no hint when the shown period is the newest one, or only a few days apart (fiscal quarter ends drift)', () => {
  assert.equal(newerReportHint(POP_MART, { basis: 'halfYear', periodEnd: '2026-06-30' }), null);
  assert.equal(newerReportHint({ mostRecentQuarter: '2026-09-30T00:00:00.000Z' }, { basis: 'quarter', periodEnd: '2026-09-27' }), null);
  // 45 days is the limit itself: it does not count, one day more does.
  assert.equal(newerReportHint({ mostRecentQuarter: '2026-08-14' }, { basis: 'quarter', periodEnd: '2026-06-30' }), null);
  assert.equal(newerReportHint({ mostRecentQuarter: '2026-08-15' }, { basis: 'quarter', periodEnd: '2026-06-30' })?.code, 'neuerer-bericht');
});

test('no hint without a shown period, without a Yahoo date, or for a row without growth', () => {
  assert.equal(newerReportHint(POP_MART, { basis: 'none', periodEnd: null }), null);
  assert.equal(newerReportHint({ mostRecentQuarter: null }, { basis: 'year', periodEnd: '2025-12-31' }), null);
  assert.equal(newerReportHint(null, { basis: 'year', periodEnd: '2025-12-31' }), null);
  assert.equal(newerReportHint({ mostRecentQuarter: 'kaputt' }, { basis: 'year', periodEnd: '2025-12-31' }), null);
  assert.equal(newerReportHint({ mostRecentQuarter: '2026-02-30' }, { basis: 'year', periodEnd: '2025-06-30' }), null);
});

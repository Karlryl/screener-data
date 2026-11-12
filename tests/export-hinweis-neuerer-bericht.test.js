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
  assert.equal(h.reason, 'Die Firma hat laut Yahoo schon Zahlen bis 30.06.2026 veröffentlicht. Für diesen Zeitraum fehlt in den Daten ein geprüfter Vorjahresvergleich des Umsatzes, deshalb zeigt das Board weiter das Geschäftsjahr bis 31.12.2025.');
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

// Blind review of 12.11.2026 (M1, N1, N2): no contradiction, no repeated sentence, the latest known date.
test('no hint next to a held sibling with newer figures (the row already names them) or next to the older-pair sentence', () => {
  const leg = { basis: 'quarter', periodEnd: '2026-06-30' };
  const meta = { mostRecentQuarter: '2026-09-30' };
  assert.equal(newerReportHint(meta, leg, { heldSibling: { ticker: 'UPST.X', periodEnd: '2026-09-30' } }), null);
  const older = { code: 'uebernahme', reason: 'Geprüfter Grund. Gezeigt wird der ältere Quartalsvergleich bis 30.06.2026. Für das neuere gespeicherte Quartal bis 30.09.2026 fehlt in den Anbieterdaten ein gültiger Vorjahresvergleich.' };
  assert.equal(newerReportHint(meta, leg, { existing: older }), null);
  // Any other existing hint does not suppress it.
  assert.equal(newerReportHint(meta, leg, { existing: { code: 'einmaleffekt', reason: 'Einmaleffekt im Vorjahr.' } })?.code, 'neuerer-bericht');
});

test('a newer stored quarter than the Yahoo date is named (600400.SS: Yahoo 30.06.2026, stored 30.09.2026)', () => {
  const h = newerReportHint({ mostRecentQuarter: '2026-06-30' }, { basis: 'year', periodEnd: '2025-12-31' }, { storedQuarterEnd: '2026-09-30' });
  assert.match(h.reason, /Zahlen bis 30\.09\.2026 /);
  // A stored quarter alone counts too.
  assert.equal(newerReportHint({}, { basis: 'year', periodEnd: '2025-12-31' }, { storedQuarterEnd: '2026-06-30' })?.code, 'neuerer-bericht');
});

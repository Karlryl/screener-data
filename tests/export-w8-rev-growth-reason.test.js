'use strict';
// W8 EX-03 (28.10.2026): every board or overview row with an empty revGrowthYoYPct carries revGrowthReason, the
// German missing reason of the G31 v1 candidate (the same text as g31Shadow.v1.reason, which stays untouched).
// A row with a value carries no key; survival rows (never scored, no G31 shadow) carry none either. Without a
// reason in the data the text starts with "Grund nicht im Datenstand".
// Fixtures: real rows of full/real-estate.json of the export of 28.10.2026 and the real snapshots of that run.
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const FIX = path.join(__dirname, 'fixtures', 'export-w8');
process.env.FINDASH_SNAPSHOTS_DIR = path.join(FIX, 'snapshot-files');
process.env.FINDASH_SMALLCAP_SNAPSHOTS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'w8-rev-sc-'));
const W = require('../scripts/write-findash-export.js');
const { prepareSnapshot } = require('../lib/yahoo-q4-known-cases.js');
const { g31Export, G31_TRAILING_KEYS } = require('../lib/g31-recency.js');

let passed = 0, failed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log('PASS ' + name); }
  catch (e) { failed++; console.error('FAIL ' + name + ': ' + e.message); }
}
const rows = JSON.parse(fs.readFileSync(path.join(FIX, 'real-estate-rows.json'), 'utf8')).rows;
const row = (t) => structuredClone(rows.find((r) => r.ticker === t));
const snap = (t) => prepareSnapshot(JSON.parse(fs.readFileSync(path.join(FIX, 'snapshot-files', t + '.json'), 'utf8')));
const TEXT = 'Kein gültiges Wertepaar mit positivem Vorjahreswert vorhanden.';

// Adapted for PR "G31: newest complete quarter pair before the annual pair" (sd-p2, 29.10.2026): the fixture rows are
// the published export of 28.10.2026 under the index-0-only selection. WEWORK.NS had no growth there (June 2026 without
// its year-ago quarter, no prior fiscal year); its snapshot now shows the March 2026 pair (29.05 %), so the published
// empty row no longer matches its snapshot and gets the "Grund nicht im Datenstand" text (the R3 case). R1 uses KRT.BO,
// which stays empty under both rules.
check('R1 an empty revenue growth gets the shadow reason as a live field, the shadow stays untouched', () => {
  const live = row('KRT.BO');
  assert.equal(live.revGrowthYoYPct, null);
  const out = W.mapBoardRow(row('KRT.BO'), 0);
  assert.equal(out.revGrowthReason, TEXT);
  assert.equal(out.revGrowthReason, out.g31Shadow.v1.reason);
  assert.deepEqual(out.g31Shadow, g31Export(snap('KRT.BO')).g31Shadow, 'g31Shadow is the unchanged shadow node');
  assert.deepEqual(out.g31Shadow, live.g31Shadow, 'and equal to the published one');
  assert.equal(W.mapBoardRow(row('WEWORK.NS'), 0).revGrowthReason, W.WACHSTUM_GRUND_FEHLT, 'WEWORK.NS now has a number in its snapshot');
});

check('R2 every real row: key exactly where revGrowthYoYPct is empty', () => {
  let withKey = 0;
  for (const r of rows) {
    const out = W.mapBoardRow(structuredClone(r), 0);
    assert.equal(Object.hasOwn(out, 'revGrowthReason'), out.revGrowthYoYPct === null, r.ticker);
    if (out.revGrowthYoYPct === null) {
      withKey++;
      assert.equal(out.revGrowthReason, r.ticker === 'WEWORK.NS' ? W.WACHSTUM_GRUND_FEHLT : out.g31Shadow.v1.reason, r.ticker);
    }
  }
  assert.equal(withKey, 2, 'two of the seven fixture rows (WEWORK.NS, KRT.BO) have no revenue growth');
});

check('R3 no reason in the data: the text says so instead of inventing one', () => {
  const r = row('DAR.L');
  assert.ok(Number.isFinite(r.revGrowthYoYPct));
  r.revGrowthYoYPct = null; // engine withheld, but this snapshot's shadow has a number and no reason
  const out = W.mapBoardRow(r, 0);
  assert.ok(Number.isFinite(out.g31Shadow.v1.pct));
  assert.equal(out.revGrowthReason, W.WACHSTUM_GRUND_FEHLT);
  assert.match(out.revGrowthReason, /^Grund nicht im Datenstand: /);
  const failedShadow = W.ergaenzeTextGruende({ ticker: 'X', revGrowthYoYPct: null, g31Shadow: { v1: null, reason: 'G31-Schatten nicht verfügbar: Berechnung fehlgeschlagen.' } });
  assert.equal(failedShadow.revGrowthReason, 'G31-Schatten nicht verfügbar: Berechnung fehlgeschlagen.');
  // A v1 candidate WITH a number carries a label note, not a reason for an empty field: that note is never promoted.
  const labelNote = W.ergaenzeTextGruende({ ticker: 'X', revGrowthYoYPct: null,
    g31Shadow: { v1: { pct: 5, basis: 'year', periodEnd: null, reason: 'Periodenenden fehlen; die Aktualität ist nicht belegbar.' } } });
  assert.equal(labelNote.revGrowthReason, W.WACHSTUM_GRUND_FEHLT);
});

check('R4 survival rows and rows with a value carry no key', () => {
  const surv = W.mapSurvivalRow({ ticker: 'WEWORK.NS', runwayQuarters: 4, lamps: [] }, 0);
  assert.equal(surv.revGrowthYoYPct, null);
  assert.equal(Object.hasOwn(surv, 'revGrowthReason'), false);
  assert.equal(Object.hasOwn(W.mapBoardRow(row('DAR.L'), 0), 'revGrowthReason'), false);
  // A row without a G31 shadow (the survival shape) gets no reason even when its growth is empty.
  assert.equal(Object.hasOwn(W.ergaenzeTextGruende({ ticker: 'X', runwayQuarters: 4, revGrowthYoYPct: null }), 'revGrowthReason'), false);
});

check('R5 the key follows the growth fields and the FFO reason; the G31 keys stay last', () => {
  const keys = Object.keys(W.mapBoardRow(row('WEWORK.NS'), 0));
  const older = keys.filter((k) => !G31_TRAILING_KEYS.includes(k));
  assert.equal(older.at(-1), 'revGrowthReason');
  assert.equal(older.at(-2), 'ffoReason', 'WEWORK.NS has an empty FFO pill too');
  assert.equal(older.at(-3), 'revGrowthSourcePriorPeriodEnd');
  assert.deepEqual(keys.slice(-2), ['g31Shadow', 'g31OverviewShadow']);
  for (const k of G31_TRAILING_KEYS) if (keys.includes(k)) assert.ok(keys.indexOf(k) > keys.indexOf('revGrowthReason'), k);
});

check('R6 --check rejects an empty text and a reason next to a number', () => {
  const ok = W.mapBoardRow(row('WEWORK.NS'), 0);
  const run = (r) => { const errs = []; W.checkTextGruende(r, 'x', errs); return errs.join(';'); };
  assert.equal(run(ok), '');
  assert.match(run({ ...ok, revGrowthReason: '' }), /revGrowthReason=""/);
  assert.match(run({ ...ok, revGrowthYoYPct: 12.5 }), /revGrowthReason with revGrowthYoYPct=12.5/);
  const errs = [];
  W.validateOverviewRow({ ...ok, formulaId: 'real-estate', overviewKind: 'ffo-badge', overviewValue: 0.1, overviewCompanion: null, revGrowthReason: 7 }, 'o', errs, new Set([ok.ticker]));
  assert.match(errs.join(';'), /o: revGrowthReason=7/);
});

console.log(`\nexport-w8-rev-growth-reason: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

'use strict';
/** P1-Welle 7: Eingangsausfaelle duerfen nie als saubere Messung erscheinen. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const e1 = require('../lib/e1-compression.js');
const institutional = require('../scripts/pull-13f-institutional.js');
const newcomer = require('../scripts/write-newcomer-log.js');
const cadence = require('../scripts/cadence-marker.js');

let pass = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + (e.stack || e)); }
}
const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'p1w7-'));

(async () => {
  await test('B1: fehlendes Board-Verzeichnis ist nicht messbar und schreibt State nicht', () => {
    const dir = temp();
    try {
      const state = path.join(dir, 'state.json');
      fs.writeFileSync(state, '{"sentinel":42}\n');
      const result = e1.runE1({ baseDir: dir, date: '2026-08-10', statePath: state, outPath: path.join(dir, 'report.json') });
      assert.equal(result.report.measurable, false);
      assert.equal(result.report.boardsRead, 0);
      assert.notEqual(result.exitCode, 0);
      assert.equal(fs.readFileSync(state, 'utf8'), '{"sentinel":42}\n');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  await test('B2: alter Cache ist stale, frischer Cache bleibt active', () => {
    const now = Date.parse('2026-08-10T00:00:00Z');
    const entries = fetchedAt => Object.fromEntries(Array.from({ length: 10 }, (_, i) => ['c' + i, { positions: [{}], error: null, fetchedAt }]));
    assert.notEqual(institutional.computeResearchStatus(entries('2023-08-10T00:00:00Z'), now).status, 'active');
    assert.equal(institutional.computeResearchStatus(entries('2026-08-09T00:00:00Z'), now).status, 'active');
  });

  await test('B3: No-Base NEW HOLDINGS ist partiell, RESTATEMENT bleibt Vollbuch', () => {
    const classify = institutional._internals._classifyNoBaseAmendment;
    assert.equal(classify('NEW HOLDINGS').lowPositionAmendment, true);
    assert.equal(classify(null).lowPositionAmendment, true, 'unlesbare Cover-Seite darf kein Vollbuch behaupten');
    assert.equal(classify('RESTATEMENT').lowPositionAmendment, false);
  });

  await test('B4: leere Uebersicht warnt in Spalte 0 und schreibt Nicht-messbar-Zeile', () => {
    const dir = temp();
    try {
      const overview = path.join(dir, 'overview.json');
      const logDir = path.join(dir, 'logs');
      fs.writeFileSync(overview, '{"rows":[]}');
      const result = newcomer.run({ overview, logDir, date: '2026-08-10' });
      assert.equal(result.exitCode, 0);
      assert.match(fs.readFileSync(result.datei, 'utf8'), /"status":"nicht-messbar"/);
      const cli = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'write-newcomer-log.js'), 'utf8');
      assert.match(cli, /console\.log\('\:\:warning\:\:newcomer-log:/);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  await test('B5: kaputte Watchlist endet 1 und annotiert ::error:: in Spalte 0', () => {
    const dir = temp();
    try {
      const watchlist = path.join(dir, 'watchlist.json');
      fs.writeFileSync(watchlist, '{kaputt');
      const r = cp.spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'prune-watchlist.js'), '--watchlist', watchlist, '--snapshots', dir], { encoding: 'utf8' });
      assert.equal(r.status, 1);
      assert.match(r.stderr, /^::error::watchlist parse failed:/m);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  await test('B6: kaputter Marker markiert das Geschwisterfeld unbekannt und legt Backup an', () => {
    const dir = temp();
    try {
      const file = path.join(dir, 'marker.json');
      fs.writeFileSync(file, '{"last_monthly_run":"2026-07-01"');
      const updated = cadence.writeMarker(file, 'weekly', '2026-08-10T00:00:00Z');
      assert.equal(updated.last_monthly_run, 'unknown');
      assert.equal(updated.state, 'partially-unknown');
      assert.equal(fs.readdirSync(dir).filter(f => f.includes('.corrupt-')).length, 1);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  console.log(`\nP1-Welle 7: ${pass} bestanden, ${fail} fehlgeschlagen`);
  process.exit(fail ? 1 : 0);
})();

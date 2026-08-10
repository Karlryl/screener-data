'use strict';
/**
 * P1-Welle 7: Eingangsausfaelle duerfen nie als saubere Messung erscheinen.
 *
 * Zwei Regeln, die dieser Test mitverankert (Review-Nachzug Tag 631):
 *  - Die Wahrheit steht in den RUECKGABEWERTEN (measurable/exitCode/status/lines).
 *    ::error::/::warning:: sind Anzeige und gehoeren dem CLI-Einstieg — deshalb werden
 *    Annotationen ausschliesslich per spawnSync am echten CLI geprueft, nie am
 *    Bibliotheks-stdout und nie per Quelltext-Regex.
 *  - Der stumme Bibliothekspfad wird ebenfalls belegt (SPAWN "stumm"-Faelle), sonst
 *    fluten gruene Gate-Laeufe wieder mit roten Zeilen ueber Vorfaelle, die der Test
 *    absichtlich herbeifuehrt.
 */
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
const REPO = path.join(__dirname, '..');
const node = (args, opts) => cp.spawnSync(process.execPath, args, Object.assign({ encoding: 'utf8' }, opts));
// Annotation = Zeile, die in SPALTE 0 mit ::error::/::warning:: beginnt (so liest GitHub sie).
const annotationen = (r) => ((r.stdout || '') + (r.stderr || '')).split(/\r?\n/).filter((l) => /^::(error|warning)::/.test(l));

(async () => {
  // ── B1 / F-CGPT-006: E1-Eingangsausfall ────────────────────────────────────
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

  await test('B1b: jede gesehene Board-Datei landet in genau einem Topf (auch die zu null parsende)', () => {
    const dir = temp();
    try {
      const bh = path.join(dir, 'board-history', '2026-08-10');
      fs.mkdirSync(bh, { recursive: true });
      fs.writeFileSync(path.join(bh, 'null.json'), 'null');          // parst zu falsy -> war frueher unsichtbar
      fs.writeFileSync(path.join(bh, 'kaputt.json'), '{');           // Parse-Fehler
      fs.writeFileSync(path.join(bh, 'ohne-cohort.json'), '{"board":"x"}');
      const r = e1.runE1({ baseDir: dir, date: '2026-08-10', statePath: path.join(dir, 's.json'), outPath: path.join(dir, 'o.json') });
      assert.equal(r.report.boardFilesSeen, 3);
      assert.equal(r.report.boardsRead, 0);
      assert.equal(r.report.boardFilesSeen, r.report.boardsRead + r.report.invalidBoards.length,
        'boardFilesSeen === boardsRead + invalidBoards.length');
      assert.equal(r.measurable, false);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  await test('B1c: Teil-Ausfall (1 gutes + 1 kaputtes Board) ist im messbaren Lauf sichtbar', () => {
    const dir = temp();
    try {
      const bh = path.join(dir, 'board-history', '2026-08-10');
      fs.mkdirSync(bh, { recursive: true });
      fs.writeFileSync(path.join(bh, 'gut.json'), JSON.stringify({ board: 'gut', date: '2026-08-10', cohort: { profitable: [], unprofitable: [] } }));
      fs.writeFileSync(path.join(bh, 'kaputt.json'), '{');
      const r = e1.runE1({ baseDir: dir, date: '2026-08-10', statePath: path.join(dir, 's.json'), outPath: path.join(dir, 'o.json') });
      assert.equal(r.measurable, true, 'ein lesbares Board reicht fuer messbar');
      assert.equal(r.report.boardFilesSeen, r.report.boardsRead + r.report.invalidBoards.length);
      assert.equal(r.invalidBoards.length, 1);
      assert.ok(r.lines.some((l) => /Board-Dateien unbrauchbar: 1 von 2/.test(l)),
        'Teil-Ausfall braucht eine eigene Zeile, sonst sieht weniger Alarm wie Ruhe aus: ' + JSON.stringify(r.lines));
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  await test('B1-CLI: der CLI-Einstieg annotiert ::error::, der Bibliotheksaufruf bleibt stumm', () => {
    const dir = temp();
    try {
      const cli = node([path.join(REPO, 'lib', 'e1-compression.js'), '--base-dir', dir, '--date', '2026-08-10']);
      assert.equal(cli.status, 1);
      assert.ok(annotationen(cli).some((l) => l.startsWith('::error::e1-compression nicht messbar')),
        'CLI muss weiterhin annotieren: ' + JSON.stringify(annotationen(cli)));

      const lib = node(['-e',
        'const r=require(' + JSON.stringify(path.join(REPO, 'lib', 'e1-compression.js')) + ')' +
        '.runE1({baseDir:' + JSON.stringify(dir) + ',date:"2026-08-10",noWrite:true});' +
        'if(r.measurable!==false||r.exitCode===0)throw new Error("Rueckgabe verlor die Wahrheit");']);
      assert.equal(lib.status, 0);
      assert.deepEqual(annotationen(lib), [], 'Bibliothekspfad darf gruene Gate-Laeufe nicht mit Annotationen fluten');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  // ── B2 / V-SK-003: 13F-Frischefenster ──────────────────────────────────────
  await test('B2: alter Cache ist stale, frischer Cache bleibt active', () => {
    const now = Date.parse('2026-08-10T00:00:00Z');
    const entries = fetchedAt => Object.fromEntries(Array.from({ length: 10 }, (_, i) => ['c' + i, { positions: [{}], error: null, fetchedAt }]));
    assert.notEqual(institutional.computeResearchStatus(entries('2023-08-10T00:00:00Z'), now).status, 'active');
    assert.equal(institutional.computeResearchStatus(entries('2026-08-09T00:00:00Z'), now).status, 'active');
  });

  await test('B2b: das Frischefenster folgt --max-age-days statt einer zweiten Konstante', () => {
    const now = Date.parse('2026-08-10T00:00:00Z');
    const vor150Tagen = new Date(now - 150 * 86400000).toISOString();
    const entries = Object.fromEntries(Array.from({ length: 10 }, (_, i) => ['c' + i, { positions: [{}], error: null, fetchedAt: vor150Tagen }]));
    assert.equal(institutional.computeResearchStatus(entries, now).status, 'stale', 'Default 100 Tage');
    assert.equal(institutional.computeResearchStatus(entries, now, 200).status, 'active',
      'mit --max-age-days 200 gilt derselbe Eintrag beim Pull als frisch — der Status darf ihm nicht widersprechen');
    assert.equal(institutional.computeResearchStatus(entries, now, 200).freshInstitutionCount, 10);
  });

  // ── B3 / F-CGPT-031: No-Base-Amendment ─────────────────────────────────────
  await test('B3: No-Base NEW HOLDINGS ist partiell, RESTATEMENT bleibt Vollbuch', () => {
    const classify = institutional._internals._classifyNoBaseAmendment;
    assert.equal(classify('NEW HOLDINGS', 5).lowPositionAmendment, true);
    assert.equal(classify(null, 5).lowPositionAmendment, true, 'unlesbare Cover-Seite darf kein Vollbuch behaupten');
    assert.equal(classify('RESTATEMENT', 5).lowPositionAmendment, false);
    assert.equal(classify('RESTATEMENT', 0).lowPositionAmendment, true,
      'ein RESTATEMENT ohne eine einzige Position ist kein Vollbuch — die alte Positionszahl-Regel bleibt gueltig');
  });

  await test('B3b: die deps-Naht treibt den No-Base-Zweig und die Klassifikation erreicht die persistierten Felder', async () => {
    const submissions = JSON.stringify({
      name: 'Testfonds LP',
      filings: {
        recent: {
          form: ['13F-HR/A'],
          filingDate: ['2026-08-01'],
          reportDate: ['2026-06-30'],
          accessionNumber: ['0000000000-26-000001'],
          primaryDocument: ['primary_doc.xml'],
        },
      },
    });
    const infoTable = '<infoTable><nameOfIssuer>ACME</nameOfIssuer><cusip>000000000</cusip>' +
      '<value>1</value><shrsOrPrnAmt><sshPrnamt>1</sshPrnamt><sshPrnamtType>SH</sshPrnamtType></shrsOrPrnAmt></infoTable>';
    const gerufen = [];
    const deps = {
      httpGet: async (url) => { gerufen.push(url); return /information_table/.test(url) ? { body: infoTable } : { body: submissions }; },
      findInfoTableUrl: async () => 'https://example.invalid/information_table.xml',
      fetchAmendmentType: async () => { gerufen.push('cover-page'); return 'NEW HOLDINGS'; },
      sleep: async () => {},
    };
    const r = await institutional._internals.pullInstitution13f('0000000000', 'Testfonds LP', deps);
    assert.ok(gerufen.includes('cover-page'), 'die Cover-Page-Naht muss im No-Base-Zweig wirklich gerufen werden');
    assert.equal(r.form, '13F-HR/A');
    assert.equal(r.amendmentOf, null, 'No-Base-Zweig');
    // amendmentType/lowPositionAmendment sind exakt die Felder, die main() nach
    // byInstitution[cik] und quarters[reportPeriod] durchschreibt.
    assert.equal(r.amendmentType, 'NEW HOLDINGS');
    assert.equal(r.lowPositionAmendment, true);
    assert.equal(r.positions.length, 1);

    const restated = await institutional._internals.pullInstitution13f('0000000000', 'Testfonds LP',
      Object.assign({}, deps, { fetchAmendmentType: async () => 'RESTATEMENT' }));
    assert.equal(restated.amendmentType, 'RESTATEMENT');
    assert.equal(restated.lowPositionAmendment, false);
  });

  // ── B4 / F-CGPT-043-Rest: Newcomer-Log ─────────────────────────────────────
  await test('B4: leere Uebersicht warnt am CLI in Spalte 0 und schreibt eine Nicht-messbar-Zeile', () => {
    const dir = temp();
    try {
      const overview = path.join(dir, 'overview.json');
      const logDir = path.join(dir, 'logs');
      fs.writeFileSync(overview, '{"rows":[]}');
      const r = node([path.join(REPO, 'scripts', 'write-newcomer-log.js'),
        '--overview', overview, '--log-dir', logDir, '--date', '2026-08-10']);
      assert.equal(r.status, 0, 'leere Uebersicht bleibt bewusst Exit 0');
      assert.ok(r.stdout.split(/\r?\n/).some((l) => l.startsWith('::warning::')),
        'Warnung muss in Spalte 0 stehen: ' + JSON.stringify(r.stdout));
      assert.match(fs.readFileSync(path.join(logDir, '2026-08.jsonl'), 'utf8'), /"status":"nicht-messbar"/);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  await test('B4b: die Nicht-messbar-Zeile ueberlebt den naechsten Rewrite und dupliziert nicht', () => {
    const dir = temp();
    try {
      const voll = path.join(dir, 'voll.json');
      const leer = path.join(dir, 'leer.json');
      const logDir = path.join(dir, 'logs');
      fs.writeFileSync(voll, JSON.stringify({ rows: [{ ticker: 'AAA' }, { ticker: 'BBB' }] }));
      fs.writeFileSync(leer, '{"rows":[]}');
      newcomer.run({ overview: voll, logDir, date: '2026-08-10' });          // Tag 1 normal
      newcomer.run({ overview: leer, logDir, date: '2026-08-11' });          // Tag 2 nicht messbar
      newcomer.run({ overview: leer, logDir, date: '2026-08-11' });          // Tag 2 Zweitlauf
      const dritter = newcomer.run({ overview: voll, logDir, date: '2026-08-12' }); // Tag 3 normal

      const zeilen = fs.readFileSync(path.join(logDir, '2026-08.jsonl'), 'utf8')
        .split(/\r?\n/).filter(Boolean).map((z) => JSON.parse(z));
      assert.equal(zeilen.length, 3, 'Tag1 + genau EINE Statuszeile fuer Tag2 + Tag3: ' + JSON.stringify(zeilen));
      const status = zeilen.filter((z) => z.status === 'nicht-messbar');
      assert.equal(status.length, 1, 'kein Duplikat durch den Zweitlauf');
      assert.equal(status[0].date, '2026-08-11');
      assert.equal(zeilen.filter((z) => Array.isArray(z.members)).length, 2);
      assert.equal(dritter.prior, '2026-08-10', 'ein nicht messbarer Tag ist kein Mitglieder-Vorgaenger');
      assert.deepEqual(dritter.newcomers, [], 'sonst saehe Tag 3 wie ein Neuzugangs-Feuerwerk aus');
      assert.equal(path.isAbsolute(dritter.datei), false, 'datei-Rueckgabe ist repo-relativ');
      assert.equal(path.isAbsolute(newcomer.run({ overview: leer, logDir, date: '2026-08-13' }).datei), false,
        'auch im Leer-Zweig repo-relativ');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  // ── B5 / F-CGPT-047: Watchlist-Prune ───────────────────────────────────────
  await test('B5: kaputte Watchlist endet 1 und annotiert ::error:: in Spalte 0', () => {
    const dir = temp();
    try {
      const watchlist = path.join(dir, 'watchlist.json');
      fs.writeFileSync(watchlist, '{kaputt');
      const r = node([path.join(REPO, 'scripts', 'prune-watchlist.js'), '--watchlist', watchlist, '--snapshots', dir]);
      assert.equal(r.status, 1);
      assert.match(r.stderr, /^::error::watchlist parse failed:/m);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  await test('B5b: gueltiges JSON unbekannter Form endet ebenfalls 1 statt still zu ueberspringen', () => {
    const dir = temp();
    try {
      const watchlist = path.join(dir, 'watchlist.json');
      fs.writeFileSync(watchlist, '{"a":1}');
      const r = node([path.join(REPO, 'scripts', 'prune-watchlist.js'), '--watchlist', watchlist, '--snapshots', dir]);
      assert.equal(r.status, 1);
      assert.match(r.stderr, /^::error::watchlist shape unrecognised/m);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  // ── B6 / F-CGPT-044: Kadenz-Marker ─────────────────────────────────────────
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

  await test('B6b: der Marker verlaesst partially-unknown, sobald beide Kadenzen wieder gestempelt sind', () => {
    const dir = temp();
    try {
      const file = path.join(dir, 'marker.json');
      fs.writeFileSync(file, '{"last_monthly_run":"2026-07-01"');
      cadence.writeMarker(file, 'weekly', '2026-08-10T00:00:00Z');                  // Vorfall
      assert.equal(cadence.writeMarker(file, 'weekly', '2026-08-11T00:00:00Z').state, 'partially-unknown',
        'monthly ist noch unknown — der Vorfall haelt an');
      assert.equal(cadence.writeMarker(file, 'monthly', '2026-08-12T00:00:00Z').state, 'ok');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  await test('B6-CLI: cadence-marker annotiert nur am CLI, nicht als Bibliothek', () => {
    const dir = temp();
    try {
      const file = path.join(dir, 'marker.json');
      fs.writeFileSync(file, '{"last_monthly_run":"2026-07-01"');
      const cli = node([path.join(REPO, 'scripts', 'cadence-marker.js'), '--field', 'weekly', '--file', file]);
      assert.equal(cli.status, 0);
      assert.ok(annotationen(cli).some((l) => l.startsWith('::warning::cadence-marker')),
        'CLI muss weiterhin annotieren: ' + JSON.stringify(annotationen(cli)));

      const file2 = path.join(dir, 'marker2.json');
      fs.writeFileSync(file2, '{"last_monthly_run":"2026-07-01"');
      const lib = node(['-e',
        'const c=require(' + JSON.stringify(path.join(REPO, 'scripts', 'cadence-marker.js')) + ');' +
        'const u=c.writeMarker(' + JSON.stringify(file2) + ',"weekly","2026-08-10T00:00:00Z");' +
        'if(u.state!=="partially-unknown")throw new Error("Rueckgabe verlor die Wahrheit");']);
      assert.equal(lib.status, 0);
      assert.deepEqual(annotationen(lib), [], 'Bibliothekspfad bleibt stumm');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  console.log(`\nP1-Welle 7: ${pass} bestanden, ${fail} fehlgeschlagen`);
  process.exit(fail ? 1 : 0);
})();

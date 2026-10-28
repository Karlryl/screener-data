'use strict';
// tests/plausibilitaets-waechter.test.js — standalone runner (node tests/plausibilitaets-waechter.test.js, exit 0/1).
//
// The plausibility watcher (scripts/plausibilitaets-waechter.js) only REPORTS. These tests run the real script on
// small hand fixtures (tests/fixtures/plausibilitaets-waechter/) and pin, per check, the exact set of tickers it
// lists: one positive and at least one negative row each. Plus the cap, the empty export, the crash path (exit 0
// both times), the comparison with yesterday, the step summary, and the wiring in daily-pull.yml.
// Every run writes into a fresh temporary directory; the live output path is checked before and after.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');

const REPO = path.resolve(__dirname, '..');
const SCRIPT = path.join(REPO, 'scripts', 'plausibilitaets-waechter.js');
const FIX = path.join(__dirname, 'fixtures', 'plausibilitaets-waechter');
const LIVE_OUT = path.join(REPO, 'outputs', 'findash-export', 'v1', 'waechter', 'plausibilitaet.json');
const liveHash = () => (fs.existsSync(LIVE_OUT) ? createHash('sha256').update(fs.readFileSync(LIVE_OUT)).digest('hex') : 'absent');
const LIVE_BEFORE = liveHash();

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'plausi-')); }

function run(args, env = {}) {
  const out = args[args.indexOf('--out') + 1];
  assert.notEqual(path.resolve(out), LIVE_OUT, 'a test must never write the live report');
  assert.ok(path.resolve(out).startsWith(os.tmpdir()), 'test output must sit in the temp directory: ' + out);
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', env: { ...process.env, GITHUB_STEP_SUMMARY: '', ...env } });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, report: fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, 'utf8')) : null };
}

// One snapshot file per export row from the compact fixture (vorlage + sonder), except ohneSnapshot.
function writeSnapshots(dir) {
  const spec = JSON.parse(fs.readFileSync(path.join(FIX, 'snapshots.json'), 'utf8'));
  for (const board of ['energy', 'utilities']) {
    const b = JSON.parse(fs.readFileSync(path.join(FIX, 'export', 'full', board + '.json'), 'utf8'));
    for (const r of [...b.profitable, ...b.unprofitable]) {
      if (spec.ohneSnapshot.includes(r.ticker)) continue;
      const s = spec.sonder[r.ticker] || { ...structuredClone(spec.vorlage), meta: { ...spec.vorlage.meta, ticker: r.ticker, name: r.name } };
      fs.writeFileSync(path.join(dir, r.ticker + '.json'), JSON.stringify(s));
    }
  }
}

// opt.vintages: other board-history folder; opt.snapshot(s): change each snapshot before it is written.
function fixtureRun(extra = [], env = {}, opt = {}) {
  const dir = tmp();
  const snaps = path.join(dir, 'snapshots');
  fs.mkdirSync(snaps);
  writeSnapshots(snaps);
  if (opt.snapshot) for (const f of fs.readdirSync(snaps)) {
    const s = JSON.parse(fs.readFileSync(path.join(snaps, f), 'utf8'));
    opt.snapshot(s);
    fs.writeFileSync(path.join(snaps, f), JSON.stringify(s));
  }
  const out = path.join(dir, 'out', 'plausibilitaet.json');
  return { dir, ...run(['--export', path.join(FIX, 'export'), '--snapshots', snaps, '--board-history', opt.vintages || path.join(FIX, 'jahrgaenge'),
    '--out', out, '--gestern', path.join(FIX, 'gestern.json'), ...extra], env) };
}
const KURS_ALT_HINWEIS = 'kurs-alt misst die Abrufzeit des Kurses, nicht das Handelsdatum; stehende Kurse ausgesetzter Aktien bleiben unsichtbar, bis der Abruf ein Handelsdatum stempelt.';

const tickers = (report, code) => report.faelle.filter((f) => f.code === code).map((f) => f.ticker).sort();

test('every check lists exactly its positive rows and none of the negative ones', () => {
  const { dir, status, report, stdout } = fixtureRun();
  try {
    assert.equal(status, 0, stdout);
    assert.equal(report.schema, 'plausibilitaets-waechter/v1');
    assert.equal(report.status, 'ok');
    assert.equal(report.exportGeneratedAt, '2026-10-24T08:43:33.489Z');
    // Negative rows: PW-OK (growth exactly 1000, 365 days, factor 2.94, quote 4 trading days old), PW-YOK (-95, 365 days),
    // PW-BAZE/PW-BAZU (gap 2.5 %), PW-DUPC (unranked), PW-NAMESAKE (other country).
    assert.deepEqual(tickers(report, 'wachstum-extrem'), ['PW-GROW', 'PW-NEG', 'PW-ZERO']);
    assert.deepEqual(tickers(report, 'jahrespaar-abstand'), ['PW-YEAR']);
    assert.deepEqual(tickers(report, 'quartalspaar-abstand'), ['PW-QGAP']);
    assert.deepEqual(tickers(report, 'umsatz-null-mit-boersenwert'), ['PW-NULLREV', 'PW-ZERO']);
    assert.deepEqual(tickers(report, 'quartal-gleich-vorjahr'), ['PW-SAME']);
    assert.deepEqual(tickers(report, 'boersenwert-sprung'), ['PW-SPLIT']);
    assert.deepEqual(tickers(report, 'kurs-alt'), ['PW-STALE']);
    assert.deepEqual(tickers(report, 'doppelte-firma'), ['PW-BARU', 'PW-DUPA']);
    assert.deepEqual(tickers(report, 'score-grenze'), ['PW-SCORE']);
    assert.deepEqual(report.zusammenfassung, { 'wachstum-extrem': 3, 'jahrespaar-abstand': 1, 'quartalspaar-abstand': 1,
      'umsatz-null-mit-boersenwert': 2, 'quartal-gleich-vorjahr': 1, 'boersenwert-sprung': 1, 'kurs-alt': 1, 'doppelte-firma': 2, 'score-grenze': 1 });
    assert.deepEqual(report.gekuerzt, {});

    const by = (code, t) => report.faelle.find((f) => f.code === code && f.ticker === t);
    // The values and the period behind each finding travel with it, and the German reason names them.
    assert.equal(by('jahrespaar-abstand', 'PW-YEAR').werte.tage, 91);
    assert.equal(by('jahrespaar-abstand', 'PW-YEAR').grund, 'Das Jahreswachstum vergleicht das Geschäftsjahr bis 30.06.2026 mit dem '
      + 'Geschäftsjahr bis 31.03.2026; zwischen beiden Enden liegen 91 Tage statt 334 bis 397.');
    assert.match(by('wachstum-extrem', 'PW-GROW').grund, /\(Quartal bis 30\.06\.2026 gegen Quartal bis 30\.06\.2025\)/);
    assert.ok(report.faelle.every((f) => !/gegen bis /.test(f.grund)), 'no "gegen bis" without a period word');
    assert.equal(by('quartalspaar-abstand', 'PW-QGAP').werte.tage, 456);
    assert.match(by('wachstum-extrem', 'PW-ZERO').grund, /-100 %.*Null des Datenlieferanten/);
    assert.ok(!/Null des Datenlieferanten/.test(by('wachstum-extrem', 'PW-GROW').grund));
    assert.ok(!/Null des Datenlieferanten/.test(by('wachstum-extrem', 'PW-NEG').grund), '-117 % is a negative revenue, not a provider zero');
    const sprung = by('boersenwert-sprung', 'PW-SPLIT');
    assert.equal(sprung.werte.vergleichsStand, '2026-10-23', 'newest vintage strictly BEFORE the export day, never the same day');
    assert.equal(sprung.werte.faktor, 5);
    assert.equal(sprung.grund, 'Börsenwert 5-fach gegenüber dem Stand vom 23.10.2026 (heute 50 Mrd. USD, damals 10 Mrd. USD); '
      + 'Ursache prüfen (Handtabelle, Aktiensplit oder Stückzahl).', 'neutral reason, no cause asserted');
    assert.equal(report.hinweise[0], KURS_ALT_HINWEIS, 'what kurs-alt measures stands in every report');
    assert.equal(report.quellen.boardHistoryStand, '2026-10-23');
    assert.deepEqual(by('kurs-alt', 'PW-STALE').werte, { kursAbruf: '2026-10-14', handelstage: 7, exportTag: '2026-10-24' });
    const nullRev = by('umsatz-null-mit-boersenwert', 'PW-NULLREV');
    assert.equal(nullRev.werte.feld, 'annualRev');
    assert.equal(nullRev.werte.wert, null);
    assert.match(nullRev.grund, /Jahresumsatz \(Zeitraum bis 31\.12\.2025\) steht im Datensatz leer/);
    const zero = by('umsatz-null-mit-boersenwert', 'PW-ZERO');
    assert.equal(zero.werte.feld, 'revenueQ');
    assert.ok(zero.werte.wert === 0 || zero.werte.wert === null, 'a provider zero, possibly already nulled by the zero guard');
    assert.equal(by('quartal-gleich-vorjahr', 'PW-SAME').werte.priorPeriodEnd, '2025-06-30');
    const dupA = by('doppelte-firma', 'PW-DUPA');
    assert.deepEqual(dupA.werte.zeilen.map((z) => z.ticker), ['PW-DUPA', 'PW-DUPB'], 'unranked PW-DUPC and Brazilian PW-NAMESAKE stay out');
    const bar = by('doppelte-firma', 'PW-BARU');
    assert.deepEqual(bar.werte.zeilen.map((z) => z.board), ['utilities', 'energy']);
    assert.equal(Math.round(bar.werte.abstandPct), 50);
    const score = by('score-grenze', 'PW-SCORE');
    assert.equal(score.grund, 'Der Score (120) ist keine Zahl zwischen 0 und 100. Der Rang (leer) ist keine positive ganze Zahl, '
      + 'obwohl kein Grund für einen fehlenden Rang angegeben ist.');
    assert.equal(score.track, 'unprofitable');
    // PW-BAZU has no snapshot: counted and named, not silently skipped.
    assert.equal(report.quellen.snapshotsFehlend, 1);
    assert.ok(report.hinweise.some((h) => /1 Boardzeilen ohne lesbaren Snapshot/.test(h)));
    // Stable order: board, track, rank, ticker.
    const order = report.faelle.map((f) => [f.board, f.track, f.rank ?? Infinity, f.ticker]);
    const sorted = [...order].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0) || (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0) || a[2] - b[2] || (a[3] < b[3] ? -1 : a[3] > b[3] ? 1 : 0));
    assert.deepEqual(order, sorted);
    // Yesterday's report lists PW-GROW (still there) and PW-OLD (gone).
    assert.deepEqual(report.gestern.weg, [{ code: 'wachstum-extrem', ticker: 'PW-OLD' }]);
    assert.ok(report.gestern.neu.some((x) => x.code === 'wachstum-extrem' && x.ticker === 'PW-ZERO'));
    assert.ok(!report.gestern.neu.some((x) => x.ticker === 'PW-GROW'));
    assert.equal(report.gestern.exportGeneratedAt, '2026-10-23T08:50:00.000Z');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('warnings per finding class, German step summary, never an error annotation', () => {
  const dir = tmp();
  const summary = path.join(dir, 'summary.md');
  const { dir: runDir, status, stdout, stderr } = fixtureRun([], { GITHUB_STEP_SUMMARY: summary });
  try {
    assert.equal(status, 0);
    const warnings = stdout.split('\n').filter((l) => l.startsWith('::warning::Plausibilität'));
    assert.equal(warnings.length, 9, 'one warning per class with at least one case (all nine are hit by the fixture)');
    assert.ok(!/::error::/.test(stdout + stderr), 'the watcher never raises an error annotation');
    // The shared snapshot reader's own ::warning:: lines are demoted: only the nine class warnings annotate this step.
    const fremde = (stdout + '\n' + stderr).split(/\r?\n/).filter((l) => l.startsWith('::warning::') && !l.startsWith('::warning::Plausibilität'));
    assert.deepEqual(fremde, []);
    const md = fs.readFileSync(summary, 'utf8');
    assert.ok(md.includes('> ' + KURS_ALT_HINWEIS), 'the summary says what kurs-alt measures');
    assert.match(md, /^## Plausibilitäts-Wächter \(nur Meldung, ändert keine Zahl\)/);
    assert.ok(md.includes(', Börsenwert-Vergleich mit dem Board-Stand vom 2026-10-23.\n'), 'the header names the vintage the jump check used');
    assert.match(md, /\| jahrespaar-abstand \| 1 \|/);
    assert.match(md, /### jahrespaar-abstand \(1\)\n- energy\/profitable, Rang 4, PW-YEAR Year Gap Energy Inc\.: Das Jahreswachstum/);
    assert.match(md, /- energy\/unprofitable, ohne Rang, PW-SCORE /);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(runDir, { recursive: true, force: true }); }
});

test('cap: at most 200 cases per class, the rest counted in gekuerzt and logged; skipped checks are null, not 0', () => {
  const dir = tmp();
  try {
    const exp = path.join(dir, 'export');
    fs.mkdirSync(path.join(exp, 'full'), { recursive: true });
    fs.writeFileSync(path.join(exp, 'index.json'), JSON.stringify({ generated_at: '2026-10-24T08:00:00Z', branches: ['energy'] }));
    const rows = Array.from({ length: 205 }, (_, i) => ({ rank: i + 1, rankGrund: null, ticker: 'PW-C' + String(i).padStart(3, '0'),
      name: 'Cap ' + i, country: 'United States', marketCap: 1e9, score: 50, scoreShrunk: 50, revGrowthYoYPct: 5000,
      revGrowthBasis: 'quarter', revGrowthPeriodEnd: '2026-06-30', revGrowthPriorPeriodEnd: '2025-06-30' }));
    fs.writeFileSync(path.join(exp, 'full', 'energy.json'), JSON.stringify({ branch: 'energy', profitable: rows, unprofitable: [] }));
    const out = path.join(dir, 'out.json');
    const r = run(['--export', exp, '--snapshots', path.join(dir, 'none'), '--board-history', path.join(dir, 'none'), '--out', out, '--gestern', path.join(dir, 'none.json')]);
    assert.equal(r.status, 0);
    assert.equal(r.report.zusammenfassung['wachstum-extrem'], 205);
    assert.equal(r.report.faelle.filter((f) => f.code === 'wachstum-extrem').length, 200);
    assert.deepEqual(r.report.gekuerzt, { 'wachstum-extrem': 5 });
    assert.equal(r.report.faelle.at(-1).ticker, 'PW-C199', 'the first 200 in board/rank order are kept');
    assert.match(r.stdout, /\[plausi\] wachstum-extrem: 205 Fälle, 5 über der Grenze von 200 nicht gelistet/);
    for (const code of ['umsatz-null-mit-boersenwert', 'quartal-gleich-vorjahr', 'kurs-alt', 'boersenwert-sprung']) {
      assert.equal(r.report.zusammenfassung[code], null, code + ' did not run and must say so (T2: no replacement 0)');
    }
    assert.ok(r.report.hinweise.some((h) => /kein Snapshot-Ordner/.test(h)));
    assert.ok(r.report.hinweise.some((h) => /kein Board-Stand vor dem Exporttag/.test(h)));
    assert.equal(r.report.gestern, null);
    assert.ok(r.report.hinweise.some((h) => /Bericht des Vortags nicht verfügbar/.test(h)));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('no snapshot readable at all: the three snapshot checks say null, not 0, and the first read error is named', () => {
  const dir = tmp();
  try {
    const snaps = path.join(dir, 'snapshots');
    fs.mkdirSync(snaps);
    for (const t of ['PW-OK', 'PW-GROW']) fs.writeFileSync(path.join(snaps, t + '.json'), '{broken');
    const exp = path.join(dir, 'export');
    fs.mkdirSync(path.join(exp, 'full'), { recursive: true });
    fs.writeFileSync(path.join(exp, 'index.json'), JSON.stringify({ generated_at: '2026-10-24T08:00:00Z', branches: ['energy'] }));
    const row = (ticker, rank) => ({ rank, rankGrund: null, ticker, name: ticker, country: 'United States', marketCap: 1e9, score: 50,
      scoreShrunk: 50, revGrowthYoYPct: 20, revGrowthBasis: 'quarter', revGrowthPeriodEnd: '2026-06-30', revGrowthPriorPeriodEnd: '2025-06-30' });
    fs.writeFileSync(path.join(exp, 'full', 'energy.json'), JSON.stringify({ branch: 'energy', profitable: [row('PW-OK', 1), row('PW-GROW', 2)], unprofitable: [] }));
    const r = run(['--export', exp, '--snapshots', snaps, '--board-history', path.join(dir, 'none'), '--out', path.join(dir, 'out.json'), '--gestern', path.join(dir, 'none.json')]);
    assert.equal(r.status, 0);
    assert.equal(r.report.status, 'ok');
    assert.equal(r.report.quellen.snapshotsFehlend, 2);
    for (const code of ['umsatz-null-mit-boersenwert', 'quartal-gleich-vorjahr', 'kurs-alt']) assert.equal(r.report.zusammenfassung[code], null, code);
    assert.equal(r.report.zusammenfassung['wachstum-extrem'], 0, 'export-only checks still ran');
    assert.ok(r.report.hinweise.some((h) => /^Erster Lesefehler eines Snapshots: /.test(h)));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('vintage unreadable or without any market cap: boersenwert-sprung is null and the hint names the files', () => {
  const dir = tmp();
  const runs = [];
  try {
    const vintage = (name, files) => {
      const d = path.join(dir, name, '2026-10-23');
      fs.mkdirSync(d, { recursive: true });
      for (const [f, text] of Object.entries(files)) fs.writeFileSync(path.join(d, f), text);
      return path.join(dir, name);
    };
    const good = fs.readFileSync(path.join(FIX, 'jahrgaenge', '2026-10-23', 'energy.json'), 'utf8');
    const summary = path.join(dir, 'summary.md');
    const broken = fixtureRun([], { GITHUB_STEP_SUMMARY: summary }, { vintages: vintage('broken', { 'energy.json': good, 'utilities.json': '{broken' }) });
    const two = fixtureRun([], {}, { vintages: vintage('two', { 'energy.json': '{broken', 'utilities.json': '{broken' }) });
    const empty = fixtureRun([], {}, { vintages: vintage('empty', { 'energy.json': JSON.stringify({ cohort: { profitable: [{ ticker: 'PW-SPLIT', pit: {} }], unprofitable: [] } }) }) });
    runs.push(broken.dir, two.dir, empty.dir);
    for (const r of [broken, two, empty]) {
      assert.equal(r.status, 0);
      assert.equal(r.report.zusammenfassung['boersenwert-sprung'], null, 'not run, never 0 (T2)');
      assert.equal(r.report.faelle.filter((f) => f.code === 'boersenwert-sprung').length, 0);
      assert.equal(r.report.zusammenfassung['wachstum-extrem'], 3, 'the other checks still ran');
    }
    assert.ok(broken.report.hinweise.includes('boersenwert-sprung nicht geprüft: im Board-Stand vom 23.10.2026 ist 1 Datei nicht lesbar (utilities.json).'));
    assert.ok(two.report.hinweise.includes('boersenwert-sprung nicht geprüft: im Board-Stand vom 23.10.2026 sind 2 Dateien nicht lesbar (energy.json, utilities.json).'));
    // The step summary header must not name a vintage the jump check did not use.
    const md = fs.readFileSync(summary, 'utf8');
    assert.ok(md.includes(', Börsenwert-Vergleich nicht geprüft.\n'), md);
    assert.ok(!md.includes('Board-Stand vom 2026-10-23'), md);
    assert.match(md, /\| boersenwert-sprung \| nicht geprüft \|/);
    assert.ok(empty.report.hinweise.includes('boersenwert-sprung nicht geprüft: der Board-Stand vom 23.10.2026 enthält keinen Börsenwert.'));
  } finally { for (const d of [dir, ...runs]) fs.rmSync(d, { recursive: true, force: true }); }
});

test('no snapshot carries a quote date: kurs-alt is null, the other snapshot checks still count', () => {
  const r = fixtureRun([], {}, { snapshot: (s) => { delete s.meta.asOf; delete s.marketCap.asOf; } });
  try {
    assert.equal(r.status, 0);
    assert.equal(r.report.zusammenfassung['kurs-alt'], null, 'not run, never 0 (T2)');
    assert.equal(r.report.zusammenfassung['umsatz-null-mit-boersenwert'], 2);
    assert.equal(r.report.zusammenfassung['quartal-gleich-vorjahr'], 1);
    // 19 = the 20 fixture rows minus PW-BAZU, which has no snapshot; every one of them lost both dates.
    assert.ok(r.report.hinweise.includes('19 Snapshots ohne Abrufdatum des Börsenwerts; kurs-alt dort nicht geprüft.'));
    assert.ok(r.report.hinweise.includes(KURS_ALT_HINWEIS));
  } finally { fs.rmSync(r.dir, { recursive: true, force: true }); }
});

test('empty export: status kein-export, file written, exit 0', () => {
  const dir = tmp();
  try {
    const out = path.join(dir, 'w', 'plausibilitaet.json');
    const r = run(['--export', path.join(dir, 'no-export'), '--out', out, '--gestern', path.join(dir, 'none.json')]);
    assert.equal(r.status, 0);
    assert.equal(r.report.status, 'kein-export');
    assert.deepEqual(r.report.faelle, []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('crash path: an unreadable board file gives status fehler, exit 0, a warning and no error annotation', () => {
  const dir = tmp();
  try {
    const exp = path.join(dir, 'export');
    fs.mkdirSync(path.join(exp, 'full'), { recursive: true });
    fs.writeFileSync(path.join(exp, 'index.json'), JSON.stringify({ generated_at: '2026-10-24T08:00:00Z', branches: ['energy'] }));
    fs.writeFileSync(path.join(exp, 'full', 'energy.json'), '{broken');
    const out = path.join(dir, 'out.json');
    const r = run(['--export', exp, '--out', out, '--gestern', path.join(dir, 'none.json')]);
    assert.equal(r.status, 0);
    assert.equal(r.report.status, 'fehler');
    assert.equal(typeof r.report.fehler, 'string');
    assert.match(r.stdout, /::warning::Plausibilitäts-Wächter abgebrochen/);
    assert.ok(!/::error::/.test(r.stdout + r.stderr));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('wiring: own step after the contract gate and before rule40, fail-soft, inside v1/ so the deploy carries it', () => {
  const yml = fs.readFileSync(path.join(REPO, '.github', 'workflows', 'daily-pull.yml'), 'utf8').replace(/\r\n/g, '\n');
  const scoring = yml.slice(yml.indexOf('\n  scoring:\n'), yml.indexOf('\n  druckenmiller-guard:\n'));
  const steps = scoring.split('\n      - name: ').slice(1).map((b) => ({ name: b.split('\n')[0].trim(), body: b }));
  const at = (n) => steps.findIndex((s) => s.name === n);
  const me = at('Plausibility watcher (reporting only)');
  assert.ok(me > 0, 'step present in job scoring');
  assert.equal(steps[me - 1].name, 'Verify findash-export v1 schema (contract gate)');
  assert.equal(steps[me + 1].name, 'Build rule40 board (additive, fail-soft)');
  // Whole-line anchors: the exact run line and the two fail-soft settings of this step.
  assert.match(steps[me].body, /^ {8}run: node scripts\/plausibilitaets-waechter\.js \|\| true$/m);
  assert.match(steps[me].body, /^ {8}continue-on-error: true$/m);
  assert.match(steps[me].body, /^ {8}timeout-minutes: 3$/m);
  assert.equal(yml.split('node scripts/plausibilitaets-waechter.js').length - 1, 1, 'called exactly once');
  // The count gate counts v1/*.json without recursion; the deploy copies v1/ including subfolders.
  assert.match(yml, /^ {10}count=\$\(ls outputs\/findash-export\/v1\/\*\.json 2>\/dev\/null \| wc -l\)$/m);
  assert.match(yml, /^ {12}cp -r \.\.\/outputs\/findash-export\/v1\/\. outputs\/findash-export\/v1\/$/m);
  assert.ok(at('Deploy Scoring Output to GitHub Pages') > me);
});

test('the live report path was not touched by any test', () => {
  assert.equal(liveHash(), LIVE_BEFORE);
});

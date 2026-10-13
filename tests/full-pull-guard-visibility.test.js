'use strict';
// Real merger CLI in OS temp directories; heartbeat uses injected files. No live writes or network.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const heartbeat = require('../scripts/heartbeat-preis-abdeckung.js');
const root = path.resolve(__dirname, '..');
let passed = 0, failed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log('PASS ' + name); }
  catch (e) { failed++; console.error('FAIL ' + name + ': ' + e.message); }
}
const tickers = Array.from({ length: 12 }, (_, i) => 'T' + String(i + 1).padStart(2, '0'));
const firstTen = tickers.slice(0, 10).join(',');
function mergerFixture(count) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p137-visibility-'));
  assert(!path.relative(root, dir).split(path.sep).every(p => p !== '..'), 'temp directory must be outside the repository');
  const shards = path.join(dir, 'shards'), snapshots = path.join(dir, 'snapshots');
  fs.mkdirSync(shards); fs.mkdirSync(snapshots);
  const rows = tickers.slice(0, count).reverse().map(ticker => ({ ticker, outcome: 'blocked',
    previousQuarterEnd: '2026-06-30', nextQuarterEnd: '2026-03-31', previousAnnualEnd: null, nextAnnualEnd: null,
    priceUpdated: true, reason: 'period-regression-retained', reasonDe: 'Gespeicherte Fundamentaldaten bleiben erhalten.' }));
  // Same minimal valid shard envelope as merge-shard-manifests-schema.test.js.
  fs.writeFileSync(path.join(shards, 'shard-0.json'), JSON.stringify({ n_ok: 12, n_full: 12 - count,
    n_priceonly: count, n_failed: 0, n_skipped_mcap: 0, n_skipped_owned: 0, n_ccy_missing_completely: 0,
    partial: false, watchlist_version: 'visibility-test', n_full_period_regression_blocked: count, _fullPeriodRegressions: rows }));
  const watchlist = path.join(dir, 'watchlist.json');
  fs.writeFileSync(watchlist, JSON.stringify({ stocks: tickers.map(ticker => ({ ticker })) }));
  for (const ticker of tickers) fs.writeFileSync(path.join(snapshots, ticker + '.json'), '{}');
  fs.writeFileSync(path.join(snapshots, '_manifest.json'), JSON.stringify({ n_eingang_snapshots: 12 }));
  const args = [path.join(root, 'scripts/merge-shard-manifests.js'), '--shard-manifests', shards,
    '--snapshots', snapshots, '--watchlist', watchlist, '--expected-shards', '1'];
  return { dir, run(summary, forbidAppend = false) {
    const env = { ...process.env }; delete env.GITHUB_STEP_SUMMARY;
    if (summary !== undefined) env.GITHUB_STEP_SUMMARY = summary;
    const command = forbidAppend ? ['-e',
      "require('fs').appendFileSync = () => { console.error('UNEXPECTED_SUMMARY_WRITE'); }; process.argv.splice(1, 0, process.argv[1]); require('module').runMain();",
      ...args] : args;
    const r = spawnSync(process.execPath, command, { env, encoding: 'utf8', timeout: 15000, windowsHide: true });
    assert.ifError(r.error); assert.equal(r.status, 0, r.stderr);
    return { ...r, manifest: JSON.parse(fs.readFileSync(path.join(snapshots, '_manifest.json'), 'utf8')) };
  } };
}
check('merger prints the first ten sorted tickers and the remainder without truncating the manifest', () => {
  const r = mergerFixture(12).run();
  assert(r.stdout.includes(`full-pull period regression: blocked=12 tickers=${firstTen} (+2 more)\n`));
  assert.equal(r.manifest.n_full_period_regression_blocked, 12);
  assert.deepEqual(r.manifest._fullPeriodRegressions.map(r => r.ticker), tickers);
});
check('merger prints the explicit empty list', () => {
  const r = mergerFixture(0).run();
  assert(r.stdout.includes('full-pull period regression: blocked=0 tickers=-\n'));
});
check('job summary appends German UTF-8 paragraphs including umlauts and overflow', () => {
  for (const count of [0, 1, 12]) {
    const f = mergerFixture(count), summary = path.join(f.dir, 'summary.md');
    fs.writeFileSync(summary, 'Vorheriger Inhalt.\n', 'utf8'); f.run(summary);
    const expected = count === 0 ? 'Vollabruf-Periodenschutz: keine Firma gehalten.'
      : `Vollabruf-Periodenschutz: ${count} Firmen blieben auf ihren gespeicherten Fundamentaldaten, weil die neue Yahoo-Antwort ein älteres Berichtsquartal oder Geschäftsjahr lieferte. Erste ${Math.min(count, 10)}: ${tickers.slice(0, count).slice(0, 10).join(',')}.`
        + (count > 10 ? ' Weitere 2 stehen im Manifest unter _fullPeriodRegressions.' : '');
    const bytes = fs.readFileSync(summary), text = bytes.toString('utf8');
    assert.equal(text, 'Vorheriger Inhalt.\n\n' + expected + '\n');
    assert.deepEqual(Buffer.from(text, 'utf8'), bytes);
    if (count) assert(text.includes('älteres') && text.includes('Geschäftsjahr'));
  }
});
check('unset or empty job-summary environment never calls appendFileSync', () => {
  for (const summary of [undefined, '']) {
    const f = mergerFixture(0), r = f.run(summary, true);
    assert(!r.stderr.includes('UNEXPECTED_SUMMARY_WRITE'));
    assert(r.stdout.includes('full-pull period regression: blocked=0 tickers=-\n'));
    assert.deepEqual(fs.readdirSync(f.dir).sort(), ['shards', 'snapshots', 'watchlist.json']);
  }
});
check('unwritable job summary warns but preserves successful merge and output', () => {
  const f = mergerFixture(12), plain = f.run(), bad = f.run(f.dir);
  assert.match(bad.stderr, /^::warning::.*GITHUB_STEP_SUMMARY/m);
  assert.equal(bad.stdout, plain.stdout);
  const withoutClock = m => { const { pulled_at, ...rest } = m; return rest; };
  assert.deepEqual(withoutClock(bad.manifest), withoutClock(plain.manifest));
});
const prefix = 'Vollabruf-Periodenschutz (snapshots/_manifest.json): ';
check('heartbeat formats measured, missing and unreadable diagnostics', () => {
  assert.equal(heartbeat.formatFullPullPeriodGuard({ n_full_period_regression_blocked: 12,
    _fullPeriodRegressions: tickers.slice().reverse().map(ticker => ({ ticker })) }), prefix + 'gesperrt=12 erste Ticker: ' + firstTen);
  assert.equal(heartbeat.formatFullPullPeriodGuard({ n_full_period_regression_blocked: 0, _fullPeriodRegressions: [] }), prefix + 'gesperrt=0 erste Ticker: -');
  assert.equal(heartbeat.formatFullPullPeriodGuard({}), prefix + 'nicht erhoben');
  assert.equal(heartbeat.formatFullPullPeriodGuard(undefined), prefix + 'Manifest nicht verfuegbar');
  for (const invalid of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, '12', null]) {
    assert.equal(heartbeat.formatFullPullPeriodGuard({ n_full_period_regression_blocked: invalid }), prefix + 'nicht erhoben');
  }
});
check('heartbeat main preserves all price lines and exit codes with injected manifest reads', () => {
  for (const alarm of [false, true]) for (const manifest of [
    { n_full_period_regression_blocked: 1, _fullPeriodRegressions: [{ ticker: 'EA' }] }, {}, undefined,
  ]) {
    const logs = [], reads = [], originalLog = console.log;
    let code;
    console.log = s => logs.push(s);
    try {
      code = heartbeat.main({ log: s => logs.push(s), fs: { readFileSync(p) {
        reads.push(p);
        if (p === path.join(root, 'watchlist.json')) return JSON.stringify([
          { ticker: 'US', exchange_hint: 'NYSE' }, { ticker: 'DE', exchange_hint: 'XETRA' },
        ]);
        assert.equal(p, path.join(root, 'snapshots', '_manifest.json'));
        if (manifest === undefined) throw new Error('fixture missing manifest');
        return JSON.stringify(manifest);
      } }, store: { loadAll() {
        const row = [{ date: new Date().toISOString().slice(0, 10), close: 123 }];
        return alarm ? { DE: row } : { DE: row, US: row };
      } } });
    } finally { console.log = originalLog; }
    assert.equal(code, alarm ? 1 : 0);
    const expected = [
      'Preis-Abdeckung (Watchlist-Ebene — Kern ist ein Gate, Ausland reine Messung):',
      '  Watchlist gesamt:      2',
      '  Neuzugangs-Ventil:     0 Titel juenger als 14 Tage, aus der Messung genommen (sie KOENNEN noch keine Historie haben)',
      '  gemessene Grundmenge:  2',
      alarm ? '  KENNZAHL 1 — ohne jede Kurszeile: 1 von 2 (50.0 %)   z. B. US' : '  KENNZAHL 1 — ohne jede Kurszeile: 0 von 2 (0.0 %)',
      '  KENNZAHL 2 — letzte Kurszeile aelter als 30 Tage: 0',
      '  AUFTEILUNG nach Herkunft (Karl-Entscheid F-29c 10.08.2026):',
      alarm ? '    Kern    (US-Boersen + Altbestand ohne Boersen-Hint): 1 von 1 leer (100.0 %)   GATE, Schwelle 5 % — Status: ALARM'
        : '    Kern    (US-Boersen + Altbestand ohne Boersen-Hint): 0 von 1 leer (0.0 %)   GATE, Schwelle 5 % — Status: OK',
      '    Ausland (uebrige Boersen):                           0 von 1 leer (0.0 %)   reine MESSUNG, loest nie Alarm aus',
    ];
    if (alarm) expected.push('::error::PREIS-ABDECKUNG KERN: 1 von 1 Kern-Titeln (100.0 %) haben keine einzige Kurszeile — Schwelle 5 % (Karl-Entscheid F-29c). Kern = US-Boersen + Altbestand ohne Boersen-Hint; der Auslandsteil (0.0 %) ist hier NICHT eingerechnet. NAECHSTER SCHRITT: daily-pull Step "Pull Historical Prices" und den Preis-Store (prices/history/) pruefen.');
    assert.deepEqual(logs.slice(0, -1), expected);
    assert.equal(logs.at(-1), prefix + (manifest === undefined ? 'Manifest nicht verfuegbar'
      : manifest.n_full_period_regression_blocked === 1 ? 'gesperrt=1 erste Ticker: EA' : 'nicht erhoben'));
    assert.deepEqual(reads, [path.join(root, 'watchlist.json'), path.join(root, 'snapshots', '_manifest.json')]);
  }
});
console.log(`full-pull-guard-visibility.test.js: ${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;

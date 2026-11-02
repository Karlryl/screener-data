'use strict';
// Deadline report of the share-count hand table on fixture data only; no live file is read or written.
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { fristen } = require('../lib/handtabellen-fristen.js');
const { run } = require('../scripts/tageslauf-erwartungen.js');

const DATUM = '2026-11-03';
const plus = n => new Date(Date.parse(DATUM + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const tr = (reviewBy, extra = {}) => ({ shares: 1, reviewBy, ...extra });
const hold = reviewBy => ({ validFrom: '2026-10-10', reason: 'x', reviewBy });
const tabelle = (rows, holds = {}) => ({ _doku: ['x'], ...rows, _holds: holds });
const u = (t, n, extra = {}) => ({ t, n, ...extra });
let passed = 0;
const cases = [];
const test = (name, fn) => cases.push([name, fn]);

test('a withholding row inside the window: firm, board, rank and "fällt vom Board" when only an excluded OTC line is left', () => {
  const r = fristen({ datum: DATUM, tabelle: tabelle({ AAA: tr(plus(10), { withholdUnverified: true }) }),
    universum: [u('AAA', 'Alpha AG', { b: 'energy', rk: 4, mc: 3e9, aus: [] }), u('AAAF', 'Alpha AG', { mc: 3.1e9, aus: ['non-us'] })] });
  assert.equal(r.faellt.length, 1);
  assert.equal(r.zeilen.length, 1);
  assert.match(r.zeilen[0], new RegExp(`^Frist ${plus(10).split('-').reverse().join('\\.')} \\(in 10 Tagen\\): .*ab dem Datentag ${plus(11).split('-').reverse().join('\\.')} leer`));
  assert.match(r.zeilen[0], /Alpha AG \(AAA; Energie Rang 4; fällt vom Board\)/);
});

test('a second listing with a value and no exclusion code keeps the firm on the board, and names its own deadline', () => {
  const r = fristen({ datum: DATUM, tabelle: tabelle({ AAA: tr(plus(10), { withholdUnverified: true }), AAB: tr(plus(40), { withholdUnverified: true }) }),
    universum: [u('AAA', 'Alpha AG', { b: 'energy', rk: 4, mc: 3e9, aus: [] }), u('AAB', 'Alpha AG', { mc: 3.1e9, aus: [] })] });
  assert.match(r.zeilen[0], new RegExp(`Alpha AG \\(AAA; Energie Rang 4; bleibt über AAB bis zu dessen Frist ${plus(40).split('-').reverse().join('\\.')}\\)`));
});

test('a firm that is on no board says so; a ticker the export does not know is named as it is', () => {
  const r = fristen({ datum: DATUM, tabelle: tabelle({ AAA: tr(plus(5), { withholdUnverified: true }), ZZZ: tr(plus(5), { withholdUnverified: true }) }),
    universum: [u('AAA', 'Alpha AG', { mc: 3e9, aus: ['dup-issuer'] })] });
  assert.match(r.zeilen[0], /Alpha AG \(AAA; steht auf keinem Board\)/);
  assert.match(r.zeilen[0], /ZZZ \(ZZZ; steht auf keinem Board\)/);
});

test('window: 30 days ahead is in, 31 is out; a passed deadline is listed as exceeded', () => {
  const r = fristen({ datum: DATUM, tabelle: tabelle({ IN: tr(plus(30), { withholdUnverified: true }), OUT: tr(plus(31), { withholdUnverified: true }), OLD: tr(plus(-2), { withholdUnverified: true }) }),
    universum: [u('IN', 'In AG', { b: 'energy', rk: 1, mc: 1e9, aus: [] }), u('OUT', 'Out AG', { b: 'energy', rk: 2, mc: 1e9, aus: [] }), u('OLD', 'Old AG', { b: 'energy', rk: 3, mc: 1e9, aus: [] })] });
  assert.deepEqual(r.faellt.map(f => f.ticker).sort(), ['IN', 'OLD']);
  assert.ok(r.zeilen.some(l => l.includes('seit 2 Tagen überschritten') && l.includes('Old AG')), r.zeilen.join('\n'));
  assert.ok(!r.zeilen.join('\n').includes('Out AG'));
});

test('holds and non-withholding rows are counted as "ohne Folge", never as falling off a board', () => {
  const r = fristen({ datum: DATUM, tabelle: tabelle({ KEEP: tr(plus(3)) }, { H1: hold(plus(3)), H2: hold(plus(4)) }),
    universum: [u('KEEP', 'Keep AG', { b: 'energy', rk: 2, mc: 1e9, aus: [] })] });
  assert.equal(r.faellt.length, 0);
  assert.equal(r.zeilen.length, 1);
  assert.match(r.zeilen[0], /ohne Folge für die Boards: 2 Zeilen mit ohnehin leerem Börsenwert \(H1, H2\), nur eine Pull-Warnung; 1 Zeile, die nach der Frist weiter gelten \(KEEP\)/);
});

test('a missing or malformed reviewBy is a warning line, never silently skipped', () => {
  const r = fristen({ datum: DATUM, tabelle: tabelle({ BAD: { shares: 1, withholdUnverified: true }, BAD2: tr('31.12.2026', { withholdUnverified: true }) }, { H: { validFrom: '2026-10-10' } }), universum: [] });
  assert.deepEqual(r.ungueltig.sort(), ['BAD', 'BAD2', 'H']);
  assert.match(r.zeilen.join('\n'), /Warnung: Die Frist \(reviewBy\) fehlt oder ist kein Datum bei .*BAD.*; ihr Ablauf wird nicht gemeldet/);
});

test('a withholding row with an empty value before its deadline is flagged only when the export knows the row (Galaxy case)', () => {
  const r = fristen({ datum: DATUM, tabelle: tabelle({ GONE: tr(plus(90), { withholdUnverified: true }), NOEXP: tr(plus(90), { withholdUnverified: true }), OK: tr(plus(90), { withholdUnverified: true }) }),
    universum: [u('GONE', 'Gone AG', { b: 'financials', rk: 6, aus: [] }), u('OK', 'Ok AG', { mc: 1e9, b: 'energy', rk: 1, aus: [] })] });
  assert.deepEqual(r.leerVorFrist.map(x => x.ticker), ['GONE']);
  assert.match(r.zeilen.join('\n'), /Hinweis: Bei Gone AG \(GONE\) ist der Börsenwert leer, obwohl die Handtabelle die Aktienzahl noch bis zur Frist belegt/);
  assert.ok(!r.zeilen.join('\n').includes('NOEXP'));
});

test('the committed table: every case has a valid reviewBy, the report never throws, and it names every case inside 30 days', () => {
  const real = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'configs', 'share-count-hand-table.json'), 'utf8'));
  const r = fristen({ datum: DATUM, tabelle: real, universum: [] });
  assert.deepEqual(r.ungueltig, []);
  const expected = Object.entries(real).filter(([k, v]) => !k.startsWith('_') && v.withholdUnverified === true && v.reviewBy <= plus(30)).map(([k]) => k).sort();
  assert.deepEqual(r.faellt.map(f => f.ticker).sort(), expected);
});

test('through the daily expectation script: the lines appear, the exit code stays 0, a missing filter feed says so', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fristen-'));
  const write = (rel, obj) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), JSON.stringify(obj)); };
  write('index.json', { schema: 'findash-export/v1', generated_at: DATUM + 'T08:00:00Z', branches: ['energy'] });
  write('full/energy.json', { profitable: [{ ticker: 'AAA', name: 'Alpha AG', rank: 4 }], unprofitable: [] });
  const erw = path.join(root, 'erw.json');
  fs.writeFileSync(erw, JSON.stringify([{ id: 'x', pr: 1, gueltigAb: DATUM, grund: 'g', board: 'full/energy', ticker: 'AAA', op: 'present' }]));
  const tab = tabelle({ AAA: tr(plus(5), { withholdUnverified: true }) });
  const without = await run({ exportBase: root, erwartungen: erw, tabelle: tab });
  assert.equal(without.code, 0);
  assert.ok(without.lines.some(l => l.startsWith('Hinweis: Die Fristen der Handtabelle der Aktienzahlen sind nicht prüfbar')), without.lines.join('\n'));
  write('filter/universum.json', { rows: [{ t: 'AAA', n: 'Alpha AG', b: 'energy', rk: 4, mc: 2e9, aus: [] }] });
  const withFeed = await run({ exportBase: root, erwartungen: erw, tabelle: tab });
  assert.equal(withFeed.code, 0, withFeed.lines.join('\n'));
  assert.ok(withFeed.lines.some(l => /^Frist .*Alpha AG \(AAA; Energie Rang 4; fällt vom Board\)/.test(l)), withFeed.lines.join('\n'));
  assert.deepEqual(withFeed.report.handtabellenFristen.faellt.map(f => f.ticker), ['AAA']);
});

(async () => {
  for (const [name, fn] of cases) {
    await fn();
    passed++;
    console.log('ok ' + name);
  }
  console.log(`handtabellen-fristen: ${passed}/${cases.length} passed`);
})().catch(err => { console.error(err); process.exitCode = 1; });

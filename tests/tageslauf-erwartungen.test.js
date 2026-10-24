'use strict';
// Daily-run expectations checker on temp fixture exports only; no live file is read or written.
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawnSync } = require('child_process');
const { run, validate } = require('../scripts/tageslauf-erwartungen.js');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'tageslauf-erwartungen.js');
const DAY = '2026-10-24';
let passed = 0;

const row = (ticker, rank, extra = {}) => ({ ticker, name: ticker + ' AG', rank, rankGrund: rank === null ? 'dupIssuer' : null,
  track: 'profitable', score: 50, marketCap: 2e9, mcapBand: 'large', financialDataReasons: ['Quartalswert fehlt: Ende 31.03.2025.'], ...extra });

/** Fixture export: index.json, one full board, one second board (for "any"), and a null-dropping filter feed. */
function exportTree() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tageslauf-erw-'));
  const write = (rel, obj) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), JSON.stringify(obj)); };
  write('index.json', { schema: 'findash-export/v1', generated_at: DAY + 'T08:43:33.489Z', branches: ['energy', 'utilities'] });
  write('full/energy.json', { schema: 'findash-export/v1', profitable: [row('AAA', 7), row('LEG.SW', null), row('DUP', 3)],
    unprofitable: [row('BBB', 12, { track: 'unprofitable', name: 'Same Name AG' }), row('CCC', 40, { track: 'unprofitable', name: 'Same Name AG' })] });
  write('full/utilities.json', { schema: 'findash-export/v1', profitable: [row('DUP', 9)], unprofitable: [] });
  write('filter/universum.json', { schema: 'findash-export/v1', rows: [
    { t: 'AAA', mc: 2e9, rk: 7, aus: ['gm-implausible'] }, { t: 'NOMC', aus: ['gm-implausible', 'dup-issuer'] }, { t: 'ZZZ', aus: [] }] });
  return root;
}
let n = 0;
const e = (fields) => ({ id: 'e' + (++n), pr: 99, gueltigAb: DAY, grund: 'Testgrund.', board: 'full/energy', ...fields });
function erwFile(list) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tageslauf-erw-list-')), 'erwartungen.json');
  fs.writeFileSync(file, JSON.stringify(list));
  return file;
}
const verdicts = async (list, exportBase) => {
  const r = await run({ exportBase: exportBase || exportTree(), erwartungen: erwFile(list), datum: DAY });
  return { ...r, u: r.report ? r.report.ergebnisse.map(x => x.urteil) : null };
};
const cli = (args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });

const cases = [];
const test = (name, fn) => cases.push([name, fn]);

test('every op holds on matching data', async () => {
  const list = [
    e({ ticker: 'AAA', feld: 'marketCap', op: 'between', min: 1e9, max: 3e9 }),
    e({ ticker: 'AAA', feld: 'mcapBand', op: 'eq', wert: 'large' }),
    e({ ticker: 'AAA', feld: 'score', op: 'eq', wert: 50.4, toleranz: 0.5 }),
    e({ ticker: 'LEG.SW', feld: 'rank', op: 'null' }),
    e({ ticker: 'AAA', feld: 'rank', op: 'notNull' }),
    e({ ticker: 'GONE', op: 'absent' }),
    e({ ticker: 'AAA', op: 'present' }),
    e({ ticker: 'AAA', feld: 'financialDataReasons', op: 'contains', wert: 'Quartalswert' }),
    e({ ticker: 'AAA', feld: 'financialDataReasons', op: 'contains', muster: 'Ende \\d{2}\\.\\d{2}\\.\\d{4}' }),
    e({ ticker: 'AAA', feld: 'name', op: 'contains', wert: 'AAA' }),
  ];
  const r = await verdicts(list);
  assert.equal(r.code, 0, r.lines.join('\n'));
  assert.deepEqual(r.u, Array(list.length).fill('erfüllt'));
  assert.match(r.lines[0], /^10 von 10 Erwartungen erfüllt, 0 nicht erfüllt, 0 nicht messbar, 0 abgelaufen; 0 noch nicht fällig/);
});

test('every op fails on contradicting data, exit 1', async () => {
  const list = [
    e({ ticker: 'AAA', feld: 'marketCap', op: 'between', min: 3e9, max: 4e9 }),
    e({ ticker: 'LEG.SW', feld: 'rank', op: 'between', min: 0, max: 100 }), // null is never inside a range
    e({ ticker: 'AAA', feld: 'mcapBand', op: 'eq', wert: 'mega' }),
    e({ ticker: 'AAA', feld: 'score', op: 'eq', wert: 51, toleranz: 0.5 }),
    e({ ticker: 'AAA', feld: 'rank', op: 'null' }),
    e({ ticker: 'LEG.SW', feld: 'rank', op: 'notNull' }),
    e({ ticker: 'AAA', op: 'absent' }),
    e({ ticker: 'GONE', op: 'present' }),
    e({ ticker: 'AAA', feld: 'financialDataReasons', op: 'contains', wert: 'Primärquelle' }),
    e({ ticker: 'AAA', feld: 'financialDataReasons', op: 'contains', muster: '\\d{2}\\.\\d{2}\\.19\\d{2}' }),
    e({ ticker: 'GONE', feld: 'rank', op: 'null' }), // a missing row is not an empty field
  ];
  const r = await verdicts(list);
  assert.equal(r.code, 1);
  assert.deepEqual(r.u, Array(list.length).fill('nicht erfüllt'));
  assert.match(r.lines[0], /^0 von 11 Erwartungen erfüllt, 11 nicht erfüllt/);
});

test('selectors: name, track, "any" needs exactly one row', async () => {
  const r = await verdicts([
    e({ name: 'Same Name AG', track: 'unprofitable', feld: 'rank', op: 'between', min: 1, max: 100 }), // two rows -> fail
    e({ name: 'Same Name AG', track: 'profitable', feld: 'rank', op: 'notNull' }), // no row on this track -> fail
    e({ ticker: 'BBB', track: 'unprofitable', feld: 'rank', op: 'eq', wert: 12 }),
    e({ ticker: 'AAA', board: 'any', feld: 'rank', op: 'eq', wert: 7 }),
    e({ ticker: 'DUP', board: 'any', feld: 'rank', op: 'notNull' }), // ranked on two boards -> fail
    e({ ticker: 'DUP', board: 'any', op: 'present' }),
  ]);
  assert.deepEqual(r.u, ['nicht erfüllt', 'nicht erfüllt', 'erfüllt', 'erfüllt', 'nicht erfüllt', 'erfüllt']);
  assert.ok(r.lines.some(l => l.includes('2 Zeilen statt einer')), r.lines.join('\n'));
});

test('nicht messbar: missing board field is reported, never erfüllt; filter feed absent key = null only for a known key', async () => {
  const r = await verdicts([
    e({ ticker: 'AAA', feld: 'g31Hinweis', op: 'null' }),
    e({ ticker: 'AAA', feld: 'fieldStatus.marketCap.presence', op: 'eq', wert: 'present' }),
    e({ ticker: 'NOMC', board: 'filter/universum', feld: 'mc', op: 'null' }),
    e({ ticker: 'NOMC', board: 'filter/universum', feld: 'rk', op: 'null' }),
    e({ ticker: 'NOMC', board: 'filter/universum', feld: 'mcTypo', op: 'null' }),
    e({ zaehle: 'gm-implausible', board: 'filter/universum', feld: 'aus', op: 'eq', wert: 2 }),
    e({ zaehle: 'x', board: 'filter/universum', feld: 'ausTypo', op: 'eq', wert: 0 }),
  ]);
  assert.deepEqual(r.u, ['nicht messbar', 'nicht messbar', 'erfüllt', 'erfüllt', 'nicht messbar', 'erfüllt', 'nicht messbar']);
  assert.equal(r.code, 1, 'nicht messbar alone must not exit 0');
  assert.match(r.lines[0], /^3 von 7 Erwartungen erfüllt, 0 nicht erfüllt, 4 nicht messbar/);
  assert.ok(r.lines.some(l => l.includes('Feld g31Hinweis fehlt')));
});

test('gruppe: one erfüllt member is enough, otherwise the group fails as one expectation', async () => {
  const r = await verdicts([
    e({ gruppe: 'g1', ticker: 'LEG.SW', feld: 'rankGrund', op: 'eq', wert: 'dupIssuer' }),
    e({ gruppe: 'g1', ticker: 'LEG.SW', feld: 'rank', op: 'between', min: 1, max: 10 }),
    e({ gruppe: 'g2', ticker: 'AAA', feld: 'rank', op: 'null' }),
    e({ gruppe: 'g2', ticker: 'AAA', feld: 'rank', op: 'between', min: 100, max: 200 }),
  ]);
  assert.deepEqual(r.u, ['erfüllt', 'nicht erfüllt']);
  assert.match(r.lines[0], /^1 von 2 Erwartungen erfüllt/);
  assert.ok(r.lines.some(l => / oder /.test(l)));
});

test('abgelaufen is never failed; gueltigAb in the future is skipped and listed', async () => {
  const r = await verdicts([
    e({ id: 'alt', ticker: 'AAA', feld: 'rank', op: 'null', gueltigAb: '2026-10-01', gueltigBis: '2026-10-23' }),
    e({ id: 'heute', ticker: 'AAA', feld: 'rank', op: 'eq', wert: 7, gueltigBis: DAY }),
    e({ id: 'morgen', ticker: 'GONE', feld: 'rank', op: 'notNull', gueltigAb: '2026-10-25' }),
  ]);
  assert.equal(r.code, 0, r.lines.join('\n'));
  assert.deepEqual(r.u, ['abgelaufen', 'erfüllt']);
  assert.match(r.lines[0], /^1 von 2 Erwartungen erfüllt, 0 nicht erfüllt, 0 nicht messbar, 1 abgelaufen; 1 noch nicht fällig/);
  assert.ok(r.lines.includes('Noch nicht fällig: morgen (ab 2026-10-25)'));
  assert.deepEqual(r.report.nochNichtFaellig, ['morgen']);
});

test('stale export: a hint names both days', async () => {
  const r = await run({ exportBase: exportTree(), erwartungen: erwFile([e({ ticker: 'AAA', op: 'present' })]), datum: '2026-10-26' });
  assert.ok(r.lines.some(l => l.startsWith('Hinweis: Der Export stammt vom 2026-10-24, geprüft wird für den 2026-10-26')), r.lines.join('\n'));
});

test('invalid expectation file is exit 2, naming the entry', async () => {
  for (const [bad, msg] of [
    [{ op: 'between', ticker: 'AAA', feld: 'rank', min: 5 }, /min\/max/],
    [{ op: 'gt', ticker: 'AAA', feld: 'rank' }, /op unbekannt/],
    [{ op: 'null', feld: 'rank' }, /genau eines von ticker, name, zaehle/],
    [{ op: 'null', ticker: 'AAA' }, /feld fehlt/],
    [{ op: 'present', ticker: 'AAA', gueltigAb: '24.10.2026' }, /gueltigAb/],
    [{ op: 'present', ticker: 'AAA', board: 'full/energy.json' }, /board/],
    [{ op: 'contains', ticker: 'AAA', feld: 'name' }, /contains braucht/],
  ]) {
    const r = await verdicts([e(bad)]);
    assert.equal(r.code, 2, JSON.stringify(bad));
    assert.match(r.lines[0], msg);
  }
  const dup = await verdicts([e({ id: 'x', ticker: 'AAA', op: 'present' }), e({ id: 'x', ticker: 'AAA', op: 'present' })]);
  assert.equal(dup.code, 2);
  assert.match(dup.lines[0], /id doppelt/);
});

test('CLI exit codes 0 / 1 / 2 and the --out guard', async () => {
  const root = exportTree();
  const ok = erwFile([e({ ticker: 'AAA', feld: 'rank', op: 'eq', wert: 7 })]);
  const bad = erwFile([e({ ticker: 'AAA', feld: 'rank', op: 'eq', wert: 8 })]);
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tageslauf-erw-out-')), 'bericht.json');
  let p = cli(['--export', root, '--erwartungen', ok, '--datum', DAY, '--out', out]);
  assert.equal(p.status, 0, p.stdout + p.stderr);
  assert.match(p.stdout, /^1 von 1 Erwartungen erfüllt/);
  assert.equal(JSON.parse(fs.readFileSync(out, 'utf8')).zusammenfassung.erfuellt, 1);
  p = cli(['--export', root, '--erwartungen', bad, '--datum', DAY]);
  assert.equal(p.status, 1, p.stdout + p.stderr);
  assert.match(p.stdout, /\| nicht erfüllt \|/);
  p = cli(['--export', path.join(root, 'fehlt'), '--erwartungen', ok, '--datum', DAY]);
  assert.equal(p.status, 2, p.stdout + p.stderr);
  assert.match(p.stdout, /^Export nicht ladbar: /);
  fs.writeFileSync(path.join(root, 'full', 'utilities.json'), '{kaputt');
  p = cli(['--export', root, '--erwartungen', erwFile([e({ ticker: 'AAA', board: 'any', op: 'present' })]), '--datum', DAY]);
  assert.equal(p.status, 2, 'an unparsable board file is exit 2');
  p = cli(['--export', root, '--erwartungen', ok, '--datum', DAY, '--out', path.join(root, 'bericht.json')]);
  assert.equal(p.status, 2, '--out into the export tree is refused');
  assert.equal(fs.existsSync(path.join(root, 'bericht.json')), false);
  p = cli(['--export', root, '--erwartungen', ok, '--datum', DAY, '--out', ok]);
  assert.equal(p.status, 2, '--out onto the expectation file is refused');
  p = cli(['--export', root, '--erwartungen', ok, '--datum', '24.10.2026']);
  assert.equal(p.status, 2);
});

test('the committed data-health/erwartungen.json is valid', async () => {
  const list = validate(JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data-health', 'erwartungen.json'), 'utf8')));
  assert.ok(list.length > 0);
  for (const x of list) assert.ok(x.pr > 0 && /^\d{4}-\d{2}-\d{2}$/.test(x.gueltigAb), x.id);
});

test('https/http base: one fetch per file, HTTP error is exit 2', async () => {
  const root = exportTree();
  const hits = {};
  const server = http.createServer((req, res) => {
    hits[req.url] = (hits[req.url] || 0) + 1;
    const file = path.join(root, req.url.replace(/^\/v1\//, ''));
    if (!req.url.startsWith('/v1/') || !fs.existsSync(file)) { res.statusCode = 404; return res.end('404: Not Found'); }
    res.end(fs.readFileSync(file));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/v1`;
  try {
    const r = await verdicts([
      e({ ticker: 'AAA', feld: 'rank', op: 'eq', wert: 7 }),
      e({ ticker: 'BBB', feld: 'rank', op: 'eq', wert: 12 }),
      e({ ticker: 'DUP', board: 'any', op: 'present' }),
    ], base + '/');
    assert.equal(r.code, 0, r.lines.join('\n'));
    assert.deepEqual(hits, { '/v1/index.json': 1, '/v1/full/energy.json': 1, '/v1/full/utilities.json': 1 });
    const missing = await verdicts([e({ ticker: 'AAA', board: 'quality/energy', op: 'present' })], base);
    assert.equal(missing.code, 2);
    assert.match(missing.lines[0], /quality\/energy\.json: HTTP 404/);
  } finally {
    server.close();
  }
});

(async () => {
  for (const [name, fn] of cases) {
    await fn();
    passed++;
    console.log('ok ' + name);
  }
  console.log(`tageslauf-erwartungen: ${passed}/${cases.length} passed`);
})().catch(err => { console.error(err); process.exitCode = 1; });

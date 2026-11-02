'use strict';
// Dividend yield against sibling listings, report only, on fixture data; no live file is read or written.
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { dividendenZwillinge } = require('../lib/dividenden-zwillinge.js');
const { run } = require('../scripts/tageslauf-erwartungen.js');

const r = (t, n, dy, extra = {}) => ({ t, n, dy, ...extra });
let passed = 0;
const cases = [];
const test = (name, fn) => cases.push([name, fn]);

test('more than a factor of two apart is flagged, exactly a factor of two is not', () => {
  const x = dividendenZwillinge({ universum: [r('A', 'Alpha', 2.68), r('A.X', 'Alpha', 24.36, { b: 'financials' }), r('B', 'Beta', 1), r('B.X', 'Beta', 2)] });
  assert.equal(x.firmen, 1);
  assert.equal(x.mitBoard, 1);
  assert.match(x.zeilen[0], /^Hinweis zur Dividendenrendite: Bei 1 Firma .*Alpha \(A 2,68 %, A\.X 24,36 %\)/);
});

test('only firms with at least two yields count: no yield, a zero yield and a single listing never make a pair', () => {
  const x = dividendenZwillinge({ universum: [r('A', 'Alpha', 5), r('A2', 'Alpha', undefined), r('A3', 'Alpha', 0), r('A4', 'Alpha', null), r('S', 'Solo', 9)] });
  assert.equal(x.firmen, 0);
  assert.match(x.zeilen[0], /^Hinweis zur Dividendenrendite: Bei keiner der 0 Firmen mit mindestens zwei Notierungen und Rendite/);
});

test('a feed in which no row carries a yield is "not checkable", never zero firms', () => {
  for (const universum of [[], [{ t: 'A', n: 'Alpha' }, { t: 'B', n: 'Alpha' }], [r('A', 'Alpha', 0), r('B', 'Alpha', null)], [r('A', undefined, 5), r('B', undefined, 1)]]) {
    const x = dividendenZwillinge({ universum });
    assert.equal(x.firmen, null);
    assert.match(x.zeilen[0], /keine der \d+ Zeilen zugleich einen Firmennamen \(Feld n\) und eine Rendite \(Feld dy\); der Vergleich der Notierungen ist nicht prüfbar, das ist keine Entwarnung/);
  }
});

test('two pairs inside the factor are counted as checked: the zero case names how many firms were compared', () => {
  const x = dividendenZwillinge({ universum: [r('A', 'Alpha', 1), r('A2', 'Alpha', 2), r('B', 'Beta', 3), r('B2', 'Beta', 4), r('S', 'Solo', 9)] });
  assert.equal(x.firmen, 0);
  assert.match(x.zeilen[0], /Bei keiner der 2 Firmen mit mindestens zwei Notierungen/);
});

test('the line explains the legitimate classes (preferred shares, A and H shares) and the NSE and BSE case', () => {
  const x = dividendenZwillinge({ universum: [r('A', 'Alpha', 1), r('A2', 'Alpha', 5)] });
  assert.match(x.zeilen[0], /Vorzugsaktien.*chinesischen A- und H-Aktien ist die Dividende je Aktie gleich.*NSE und BSE/);
});

test('names match without regard to case and spaces; a row without a name is skipped', () => {
  const x = dividendenZwillinge({ universum: [r('A', ' ALPHA ', 1), r('B', 'alpha', 3), r('C', undefined, 9), r('D', undefined, 1)] });
  assert.equal(x.firmen, 1);
});

test('the widest gaps come first and the list is cut at top', () => {
  const rows = [];
  for (let i = 2; i <= 9; i++) rows.push(r('L' + i, 'Firm' + i, 1), r('H' + i, 'Firm' + i, i * 1.5));
  const x = dividendenZwillinge({ universum: rows, top: 3 });
  assert.equal(x.firmen, 8);
  assert.deepEqual(x.beispiele.map(b => b.name), ['Firm9', 'Firm8', 'Firm7']);
  assert.equal(x.mitBoard, 0);
});

test('through the daily expectation script: the line appears, exit code unchanged, a missing feed says so', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'divzw-'));
  const write = (rel, obj) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), JSON.stringify(obj)); };
  write('index.json', { schema: 'findash-export/v1', generated_at: '2026-11-03T08:00:00Z', branches: ['energy'] });
  write('full/energy.json', { profitable: [{ ticker: 'AAA', name: 'Alpha AG', rank: 4 }], unprofitable: [] });
  const erw = path.join(root, 'erw.json');
  fs.writeFileSync(erw, JSON.stringify([{ id: 'x', pr: 1, gueltigAb: '2026-11-03', grund: 'g', board: 'full/energy', ticker: 'AAA', op: 'present' }]));
  const tab = { _holds: {} };
  const without = await run({ exportBase: root, erwartungen: erw, tabelle: tab });
  assert.equal(without.code, 0);
  assert.ok(without.lines.some(l => l.startsWith('Hinweis: Die Fristen der Handtabelle der Aktienzahlen und die Dividendenrenditen der Zwillingsnotierungen sind nicht prüfbar')), without.lines.join('\n'));
  write('filter/universum.json', { rows: [r('AAA', 'Alpha AG', 2.68, { b: 'energy' }), r('AAA.X', 'Alpha AG', 24.36)] });
  const withFeed = await run({ exportBase: root, erwartungen: erw, tabelle: tab });
  assert.equal(withFeed.code, 0, withFeed.lines.join('\n'));
  assert.ok(withFeed.lines.some(l => /^Hinweis zur Dividendenrendite: Bei 1 Firma /.test(l)), withFeed.lines.join('\n'));
  assert.deepEqual(withFeed.report.dividendenZwillinge, { firmen: 1, mitBoard: 1 });
  write('filter/universum.json', { rows: 'kaputt' });
  const broken = await run({ exportBase: root, erwartungen: erw, tabelle: tab });
  assert.equal(broken.code, 0);
  assert.equal(broken.lines.filter(l => l.includes('nicht prüfbar')).length, 1, broken.lines.join('\n'));
  assert.equal(broken.report.dividendenZwillinge, null);
});

(async () => {
  for (const [name, fn] of cases) {
    await fn();
    passed++;
    console.log('ok ' + name);
  }
  console.log(`dividenden-zwillinge: ${passed}/${cases.length} passed`);
})().catch(err => { console.error(err); process.exitCode = 1; });

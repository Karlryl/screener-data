// tests/stage-public-data.test.js - Standalone-Runner (framework-los: assert + process.exit).
// Waechter fuer scripts/stage-public-data.js (F-17a Datenkanal, Karl-Entscheid 04.08.2026).
//
// WAS HIER FESTGENAGELT WIRD - und warum genau das:
// findash liest heute ZWEI Dinge per git-Pull aus dem Checkout dieses Repos:
// earnings-calendar.json (Termine) und board-history/ (Bewegungs-Anzeige NEU/^v).
// Der Pull wird abgeschaltet; beides muss also im oeffentlichen Datenkanal liegen.
// Der gefaehrliche Ausgang ist NICHT "der Publish kracht", sondern "der Publish laesst
// eine Quelle still weg" - dann zeigt findash nach der Umstellung wortlos nichts, und
// niemand erfaehrt es. Darum prueft dieser Waechter beide Richtungen:
//   Quelle da    -> die Datei liegt im Publish-Verzeichnis (a-e)
//   Quelle fehlt -> LAUTER Abbruch, nie ein leises Ueberspringen (f-i)
//
// Run: node tests/stage-public-data.test.js
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const S = require('../scripts/stage-public-data.js');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'stage-public-data.js');

let fail = 0;
function check(name, fn) {
  try { fn(); console.log('  ok   ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + ': ' + (e && e.message || e)); }
}

function writeJson(p, o) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(o)); }
function readJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }
function mkTmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'spd-')); }

// Eine Vintage-Zeile in der ECHTEN Form, die scripts/write-board-history.js schreibt:
// die drei Felder, die die Bewegungs-Anzeige liest, plus der ganze Rest, der sie nichts
// angeht (axisBreakdown/lamps/pit machen 98 % der 13,5 MB pro Vintage aus).
function fatRow(rank, ticker, score) {
  return {
    rank, ticker, score, track: 'profitable',
    runwayQuarters: null, scoreBase: score - 1, scoreShrunk: score - 2, coverageAxes: '6/7',
    axisBreakdown: [{ key: 'revGrowthLevel', pct: 96, weight: 1.7 }, { key: 'gpGrowth', pct: 99.8, weight: 1.8 }],
    lamps: ['burning', 'shortRunway'],
    pit: { beta: 0.991, evSales: 92.31, priceGrossProfit: 120.4, priceSales: 33.2 },
  };
}
function vintageFile(date, board, profitable, unprofitable) {
  return {
    date, board, boardStatus: 'ok', formulaVersion: 'v9', formulaCommit: 'abc1234',
    calibrationGeneratedAt: date + 'T06:00:00.000Z',
    cohortCount: { profitable: profitable.length, unprofitable: unprofitable.length },
    pitCoverage: 0.98, pitGaps: [], gate: { suspect: false, reasons: [] },
    cohort: { profitable, unprofitable },
  };
}

// Quell-Baum: board-history mit <dates.length> Vintages je 2 Boards + 2 Sidecars,
// dazu eine earnings-calendar.json.
function mkQuelle(dates) {
  const base = mkTmp();
  for (const date of dates) {
    writeJson(path.join(base, 'board-history', date, 'energy.json'),
      vintageFile(date, 'energy', [fatRow(1, 'XOM', 91.2), fatRow(2, 'CVX', 88.0)], [fatRow(1, 'PLUG', 40.5)]));
    writeJson(path.join(base, 'board-history', date, 'semiconductors.json'),
      vintageFile(date, 'semiconductors', [fatRow(1, 'NVDA', 97.4)], []));
    // Sidecars OHNE cohort - findash ueberspringt sie inhaltsbasiert, sie gehoeren
    // nicht in den Kanal (calibration.json allein ist 1,5 MB pro Vintage).
    writeJson(path.join(base, 'board-history', date, 'calibration.json'), { schema: 'calibration/v4', generated_at: date });
    writeJson(path.join(base, 'board-history', date, 'regime.json'), { regime: 'BULL' });
  }
  writeJson(path.join(base, 'earnings-calendar.json'), { NVDA: { date: '2026-08-27' }, XOM: { date: '2026-08-01' } });
  return base;
}

// ── (a-e) Quelle vorhanden -> die Dateien liegen im Publish-Verzeichnis ──────────────
check('(a) earnings-calendar.json + die 2 juengsten Vintages + index.json landen im Ziel', () => {
  const src = mkQuelle(['2026-08-01', '2026-08-02', '2026-08-03']);
  const ziel = path.join(src, '_public');
  S.run({ ziel, earnings: path.join(src, 'earnings-calendar.json'), boardHistory: path.join(src, 'board-history'), vintages: 2 });

  assert.ok(fs.existsSync(path.join(ziel, 'earnings-calendar.json')), 'earnings-calendar.json fehlt im Ziel');
  assert.deepStrictEqual(readJson(path.join(ziel, 'earnings-calendar.json')).NVDA, { date: '2026-08-27' });
  for (const date of ['2026-08-02', '2026-08-03']) {
    assert.ok(fs.existsSync(path.join(ziel, 'board-history', date, 'energy.json')), date + '/energy.json fehlt');
    assert.ok(fs.existsSync(path.join(ziel, 'board-history', date, 'semiconductors.json')), date + '/semiconductors.json fehlt');
  }
  const idx = readJson(path.join(ziel, 'board-history', 'index.json'));
  assert.deepStrictEqual(idx.vintages.map((v) => v.date), ['2026-08-02', '2026-08-03'], 'index nennt die falschen Vintages');
  assert.deepStrictEqual(idx.vintages[1].files.slice().sort(), ['energy.json', 'semiconductors.json']);
});

check('(b) nur die 2 juengsten - der Rest bleibt draussen (Groessen-Entscheidung)', () => {
  const src = mkQuelle(['2026-07-30', '2026-08-01', '2026-08-02', '2026-08-03']);
  const ziel = path.join(src, '_public');
  S.run({ ziel, boardHistory: path.join(src, 'board-history'), vintages: 2 });
  const publiziert = fs.readdirSync(path.join(ziel, 'board-history'), { withFileTypes: true })
    .filter((e) => e.isDirectory()).map((e) => e.name).sort();
  assert.deepStrictEqual(publiziert, ['2026-08-02', '2026-08-03']);
});

check('(c) Zeilen sind auf rank/ticker/score projiziert - axisBreakdown/lamps/pit sind weg', () => {
  const src = mkQuelle(['2026-08-02', '2026-08-03']);
  const ziel = path.join(src, '_public');
  S.run({ ziel, boardHistory: path.join(src, 'board-history'), vintages: 2 });
  const b = readJson(path.join(ziel, 'board-history', '2026-08-03', 'energy.json'));
  assert.deepStrictEqual(Object.keys(b.cohort.profitable[0]).sort(), ['rank', 'score', 'ticker'],
    'die Projektion traegt andere Felder als rank/ticker/score');
  assert.deepStrictEqual(b.cohort.profitable[0], { rank: 1, ticker: 'XOM', score: 91.2 });
  assert.strictEqual(b.cohort.unprofitable.length, 1, 'die unprofitable-Spur fehlt');
  assert.strictEqual(b.cohort.profitable.length, 2);
});

check('(d) Sidecars ohne cohort (calibration/regime) werden NICHT publiziert', () => {
  const src = mkQuelle(['2026-08-02', '2026-08-03']);
  const ziel = path.join(src, '_public');
  S.run({ ziel, boardHistory: path.join(src, 'board-history'), vintages: 2 });
  const dateien = fs.readdirSync(path.join(ziel, 'board-history', '2026-08-03')).sort();
  assert.deepStrictEqual(dateien, ['energy.json', 'semiconductors.json']);
});

check('(e) die publizierten Zeilen bestehen findashs Bewegungs-Pruefung (Konsumenten-Vertrag)', () => {
  const src = mkQuelle(['2026-08-02', '2026-08-03']);
  const ziel = path.join(src, '_public');
  S.run({ ziel, boardHistory: path.join(src, 'board-history'), vintages: 2 });
  // Wortlaut aus findash/data-layer/screener.js computeMovement/shapeTrack: nur JSON MIT
  // cohort ist ein Board; jede Zeile braucht rank>0 (Zahl), nicht-leeren ticker und einen
  // ANWESENDEN score-Schluessel. Faellt eines weg, setzt findash die Anzeige stumm aus.
  for (const date of ['2026-08-02', '2026-08-03']) {
    const dir = path.join(ziel, 'board-history', date);
    for (const file of fs.readdirSync(dir)) {
      const v = readJson(path.join(dir, file));
      assert.ok(Object.prototype.hasOwnProperty.call(v, 'cohort'), file + ': kein cohort -> findash ueberspringt das Board');
      for (const track of ['profitable', 'unprofitable']) {
        assert.ok(Array.isArray(v.cohort[track]), file + ': ' + track + ' ist kein Array');
        const seen = new Set();
        for (const row of v.cohort[track]) {
          assert.ok(typeof row.rank === 'number' && Number.isFinite(row.rank) && row.rank > 0, file + ': rank ungueltig');
          assert.ok(typeof row.ticker === 'string' && row.ticker.trim() !== '', file + ': ticker ungueltig');
          assert.ok(Object.prototype.hasOwnProperty.call(row, 'score'), file + ': score-Schluessel fehlt');
          assert.ok(!seen.has(row.ticker), file + ': doppelter Ticker');
          seen.add(row.ticker);
        }
      }
    }
  }
});

// ── (f-i) Quelle fehlt -> LAUT, nie stilles Weglassen ────────────────────────────────
check('(f) fehlende earnings-Quelle -> wirft (kein stilles Weglassen)', () => {
  const src = mkQuelle(['2026-08-02', '2026-08-03']);
  fs.rmSync(path.join(src, 'earnings-calendar.json'));
  assert.throws(() => S.run({ ziel: path.join(src, '_public'), earnings: path.join(src, 'earnings-calendar.json') }),
    /earnings-calendar\.json/, 'ein fehlender Termin-Kalender muss auffliegen');
});

check('(g) fehlendes board-history-Verzeichnis -> wirft', () => {
  const src = mkQuelle(['2026-08-02', '2026-08-03']);
  fs.rmSync(path.join(src, 'board-history'), { recursive: true });
  assert.throws(() => S.run({ ziel: path.join(src, '_public'), boardHistory: path.join(src, 'board-history'), vintages: 2 }),
    /board-history/, 'ein fehlendes Vintage-Verzeichnis muss auffliegen');
});

check('(h) board-history ohne einen einzigen Vintage -> wirft', () => {
  const src = mkTmp();
  fs.mkdirSync(path.join(src, 'board-history'), { recursive: true });
  assert.throws(() => S.run({ ziel: path.join(src, '_public'), boardHistory: path.join(src, 'board-history'), vintages: 2 }),
    /kein Vintage/, 'ein leeres Vintage-Verzeichnis muss auffliegen');
});

check('(h2) Vintage-Verzeichnis ohne ein einziges Board -> wirft', () => {
  const src = mkTmp();
  writeJson(path.join(src, 'board-history', '2026-08-03', 'regime.json'), { regime: 'BULL' });
  assert.throws(() => S.run({ ziel: path.join(src, '_public'), boardHistory: path.join(src, 'board-history'), vintages: 1 }),
    /kein Board/, 'ein Vintage ohne Board-Datei muss auffliegen');
});

check('(h3) korruptes Board im gewaehlten Vintage -> wirft (nie halb publizieren)', () => {
  const src = mkQuelle(['2026-08-02', '2026-08-03']);
  fs.writeFileSync(path.join(src, 'board-history', '2026-08-03', 'energy.json'), '{not valid json');
  assert.throws(() => S.run({ ziel: path.join(src, '_public'), boardHistory: path.join(src, 'board-history'), vintages: 2 }),
    /energy\.json/, 'ein korruptes Board muss auffliegen');
});

check('(i) CLI: fehlende Quelle -> exit 1 UND ::error:: im Protokoll (Karls Alarmkanal)', () => {
  const src = mkQuelle(['2026-08-02', '2026-08-03']);
  fs.rmSync(path.join(src, 'earnings-calendar.json'));
  let rc = 0; let out = '';
  try {
    out = execFileSync(process.execPath, [SCRIPT, '--ziel', path.join(src, '_public'),
      '--earnings', path.join(src, 'earnings-calendar.json')], { encoding: 'utf8', stdio: 'pipe' });
  } catch (e) { rc = e.status; out = String(e.stdout || '') + String(e.stderr || ''); }
  assert.strictEqual(rc, 1, 'ein fehlender Quell-Pfad muss den Schritt rot machen (exit 1), nicht gruen durchlaufen');
  assert.ok(out.includes('::error::'), 'ohne ::error::-Annotation sieht Karl den Ausfall nicht: ' + out.slice(0, 300));
});

check('(j) CLI: Erfolgsfall -> exit 0 und beide Quellen liegen im Ziel', () => {
  const src = mkQuelle(['2026-08-02', '2026-08-03']);
  const ziel = path.join(src, '_public');
  execFileSync(process.execPath, [SCRIPT, '--ziel', ziel,
    '--earnings', path.join(src, 'earnings-calendar.json'),
    '--board-history', path.join(src, 'board-history'), '--vintages', '2'], { encoding: 'utf8', stdio: 'pipe' });
  assert.ok(fs.existsSync(path.join(ziel, 'earnings-calendar.json')));
  assert.ok(fs.existsSync(path.join(ziel, 'board-history', '2026-08-03', 'energy.json')));
  assert.ok(fs.existsSync(path.join(ziel, 'board-history', 'index.json')));
});

// ── (k-l) T564-B3: Board-Familie zwischen den zwei Vintages ──────────────────────
// Repro aus dem Tag-564-Review: verschwindet ein Board im JUENGEREN Vintage (Datei
// faellt aus, Board-Lauf kracht, Datei wird nicht geschrieben), publiziert der Kanal
// zwei Staende mit unterschiedlichen Board-Listen. findash vergleicht sie Board fuer
// Board — jede Zeile des fehlenden Boards liest sich dann als ABGANG. Im Repro:
// 117 Phantom-Abgaenge bei entferntem utilities.json, gemeldet als warning:null.
// Zugewinn ist der harmlose Gegenfall (neues Board kommt dazu) und muss durchgehen.
check('(k) juengeres Vintage VERLIERT ein Board -> wirft (Phantom-Abgaenge, T564-B3)', () => {
  const src = mkQuelle(['2026-08-02', '2026-08-03']);
  fs.rmSync(path.join(src, 'board-history', '2026-08-03', 'energy.json'));
  assert.throws(() => S.run({ ziel: path.join(src, '_public'), boardHistory: path.join(src, 'board-history'), vintages: 2 }),
    /energy\.json/, 'ein im juengeren Vintage fehlendes Board muss auffliegen, nicht als Abgang durchgehen');
});

check('(l) juengeres Vintage GEWINNT ein Board -> geht durch (neue Board-Familie)', () => {
  const src = mkQuelle(['2026-08-02', '2026-08-03']);
  writeJson(path.join(src, 'board-history', '2026-08-03', 'utilities.json'),
    vintageFile('2026-08-03', 'utilities', [fatRow(1, 'NEE', 70.1)], []));
  const ziel = path.join(src, '_public');
  S.run({ ziel, boardHistory: path.join(src, 'board-history'), vintages: 2 });
  const idx = readJson(path.join(ziel, 'board-history', 'index.json'));
  assert.deepStrictEqual(idx.vintages[1].files.slice().sort(),
    ['energy.json', 'semiconductors.json', 'utilities.json'], 'das neue Board fehlt im Kanal');
  assert.deepStrictEqual(idx.vintages[0].files.slice().sort(), ['energy.json', 'semiconductors.json']);
});

// ── (m) T568-F6: dasselbe Phantom-Abgangs-Muster OHNE fehlende Datei ─────────────
// Ein Board kann auch VORHANDEN und LEER sein (cohort-Arrays []) — die Familien-
// Pruefung (k) sieht die Datei und ist zufrieden. findash vergleicht Board fuer Board
// und liest jede Zeile des aelteren Stands als Abgang. Repro Fall C aus dem
// Tag-568-Review: 3 Zeilen -> 0 Zeilen ging still durch. Gegenfall (m2): ein Board,
// das in BEIDEN Staenden leer ist, ist kein Kollaps und muss durchgehen.
check('(m) Board kollabiert im juengeren Vintage auf 0 Zeilen -> wirft (T568-F6)', () => {
  const src = mkQuelle(['2026-08-02', '2026-08-03']);
  writeJson(path.join(src, 'board-history', '2026-08-03', 'energy.json'),
    vintageFile('2026-08-03', 'energy', [], []));
  assert.throws(() => S.run({ ziel: path.join(src, '_public'), boardHistory: path.join(src, 'board-history'), vintages: 2 }),
    /energy\.json/, 'ein auf 0 Zeilen kollabiertes Board muss auffliegen, nicht als 3 Abgaenge durchgehen');
});

check('(m2) in BEIDEN Staenden leeres Board -> geht durch (kein Kollaps)', () => {
  const src = mkQuelle(['2026-08-02', '2026-08-03']);
  for (const d of ['2026-08-02', '2026-08-03']) {
    writeJson(path.join(src, 'board-history', d, 'energy.json'), vintageFile(d, 'energy', [], []));
  }
  const ziel = path.join(src, '_public');
  S.run({ ziel, boardHistory: path.join(src, 'board-history'), vintages: 2 });
  const idx = readJson(path.join(ziel, 'board-history', 'index.json'));
  assert.deepStrictEqual(idx.vintages[1].files.slice().sort(), ['energy.json', 'semiconductors.json'],
    'ein durchgaengig leeres Board darf den Publish nicht kippen');
});

console.log(fail ? ('\nFAIL: ' + fail + ' Test(s)') : '\nAlle stage-public-data-Tests gruen');
process.exit(fail ? 1 : 0);

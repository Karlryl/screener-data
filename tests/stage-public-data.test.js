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

// KV571-1: seit der Frische-Wache in stageEarnings() braucht JEDE gueltige Kalender-
// Fixture mindestens einen Zukunftstermin. Feste Datumswerte waeren eine Zeitbombe —
// sie wandern in die Vergangenheit und faerben die Tests irgendwann ohne Bug rot.
function inTagen(n) { return new Date(Date.now() + n * 86400000).toISOString().slice(0, 10); }
const TERMIN_KUENFTIG = inTagen(24);

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
  writeJson(path.join(base, 'earnings-calendar.json'), { NVDA: { date: TERMIN_KUENFTIG }, XOM: { date: '2026-08-01' } });
  return base;
}

// ── (a-e) Quelle vorhanden -> die Dateien liegen im Publish-Verzeichnis ──────────────
check('(a) earnings-calendar.json + die 2 juengsten Vintages + index.json landen im Ziel', () => {
  const src = mkQuelle(['2026-08-01', '2026-08-02', '2026-08-03']);
  const ziel = path.join(src, '_public');
  S.run({ ziel, earnings: path.join(src, 'earnings-calendar.json'), boardHistory: path.join(src, 'board-history'), vintages: 2 });

  assert.ok(fs.existsSync(path.join(ziel, 'earnings-calendar.json')), 'earnings-calendar.json fehlt im Ziel');
  assert.deepStrictEqual(readJson(path.join(ziel, 'earnings-calendar.json')).NVDA, { date: TERMIN_KUENFTIG });
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

// ── (n) KV571-1 (Review Tag 571): Frische-Wache am Kalender selbst ───────────────
// BEFUND: der Deploy-cmp deckt nur "Quelle fehlt/weicht ab", nicht "Quelle alt".
// pull-earnings-dates.js traegt continue-on-error und earnings-calendar.json ist
// git-getrackt — faellt Yahoo aus, steht der gestrige Stand beidseitig identisch da
// und cmp wird gruen. Dieses zweite, INHALTLICHE Netz haengt an einer strukturellen
// Eigenschaft: ein Termin-Kalender ohne einen einzigen Zukunftstermin ist per
// Konstruktion kaputt oder steinalt. Bewusst KEINE weitere Schwelle — Vollstaendigkeit
// und Plausibilitaet entscheidet der Collapse-Guard in pull-earnings-dates.js.
check('(n0) nur echte kanonische YYYY-MM-DD-Kalendertage gelten als Termine', () => {
  for (const datum of ['2026-09-01', '2026-09-02', '2028-02-29']) {
    assert.strictEqual(S.isIsoCalendarDate(datum), true, 'gueltiger Kalendertag abgelehnt: ' + datum);
  }
  for (const datum of [
    null, undefined, 20260901, '', ' ', 'zzzz', '2027-2-03', '2027-02-03T00:00:00Z',
    '2027-00-01', '2027-13-01', '2027-02-29', '2027-02-30', '2027-04-31',
  ]) {
    assert.strictEqual(S.isIsoCalendarDate(datum), false,
      'ungueltiger oder nicht-kanonischer Kalendertag akzeptiert: ' + String(datum));
  }
});

check('(n0b) ein kaputter Eintrag sperrt die GANZE Datei trotz gueltigem Zukunftstermin', () => {
  const faelle = [
    ['beliebiger Text', 'BAD', { date: 'zzzz' }],
    ['formal falscher Monat/Tag', 'BAD', { date: '9999-99-99' }],
    ['normalisierter Phantomtag', 'BAD', { date: '2027-02-30' }],
    ['numerisches Datum', 'BAD', { date: 20270902 }],
    ['leeres Datum', 'BAD', { date: '' }],
    ['fehlendes Datum', 'BAD', {}],
    ['kein Objekt', 'BAD', null],
    ['Array statt Eintrag', 'BAD', []],
    ['unmoegliches pulledAt', 'BAD', { date: '2026-09-03', pulledAt: '9999-99-99' }],
    ['null-pulledAt', 'BAD', { date: '2026-09-03', pulledAt: null }],
    ['leerer Ticker-Schluessel', '', { date: '2026-09-03' }],
    ['Ticker mit Rand-Leerzeichen', ' BAD ', { date: '2026-09-03' }],
  ];
  for (let i = 0; i < faelle.length; i++) {
    const [name, ticker, kaputt] = faelle[i];
    const src = mkTmp();
    const quelle = path.join(src, 'earnings-calendar.json');
    const ziel = path.join(src, '_public');
    const schlecht = { [ticker]: kaputt };
    const daten = i % 2 === 0
      ? { ...schlecht, GOOD: { date: '2026-09-02', pulledAt: '2026-09-01' } }
      : { GOOD: { date: '2026-09-02' }, ...schlecht };
    writeJson(quelle, daten);
    assert.throws(() => S.stageEarnings(quelle, ziel, '2026-09-01'),
      /YYYY-MM-DD|nicht publiziert/,
      name + ' wurde neben einem gueltigen Zukunftstermin nur herausgefiltert statt fail-closed zu stoppen');
    assert.strictEqual(fs.existsSync(path.join(ziel, 'earnings-calendar.json')), false,
      name + ' hinterliess trotz Fehler eine publizierte Teildatei');
  }
});

check('(n0c) nur ein Objekt darf an der Kalenderwurzel stehen', () => {
  for (const wurzel of [[{ date: '2026-09-02' }], null, 'text', 42, true]) {
    const src = mkTmp();
    const quelle = path.join(src, 'earnings-calendar.json');
    const ziel = path.join(src, '_public');
    writeJson(quelle, wurzel);
    assert.throws(() => S.stageEarnings(quelle, ziel, '2026-09-01'), /Feldname|Format|Wurzel/);
    assert.strictEqual(fs.existsSync(path.join(ziel, 'earnings-calendar.json')), false);
  }
});

check('(n0d) Doku-Schluessel bleiben erlaubt und gueltige Kalenderbytes bleiben exakt erhalten', () => {
  const src = mkTmp();
  const quelle = path.join(src, 'earnings-calendar.json');
  const ziel = path.join(src, '_public');
  const text = '{\n  "_doc": { "schema": "earnings/v1" },\n'
    + '  "PAST": { "date": "2026-08-31" },\n'
    + '  "TODAY": { "date": "2026-09-01", "pulledAt": "2026-09-01" },\n'
    + '  "FUTURE": { "date": "2026-09-02" },\n'
    + '  "LEAP": { "date": "2028-02-29" }\n}\n';
  fs.writeFileSync(quelle, text);
  S.stageEarnings(quelle, ziel, '2026-09-01');
  assert.strictEqual(fs.readFileSync(path.join(ziel, 'earnings-calendar.json'), 'utf8'), text,
    'der strukturelle Guard darf gueltige Quelldateien nicht neu serialisieren oder Doku-Schluessel entfernen');
});

check('(n0e) ein ungueltiger Lauf-Stichtag darf die Frische-Wache nicht oeffnen', () => {
  for (const stichtag of ['0000-00-00', '2026-9-01', '2026-02-30', 'garbage']) {
    const src = mkTmp();
    const quelle = path.join(src, 'earnings-calendar.json');
    const ziel = path.join(src, '_public');
    writeJson(quelle, { GOOD: { date: '2026-09-02' } });
    assert.throws(() => S.stageEarnings(quelle, ziel, stichtag), /Lauf-Stichtag|RUN_DATE_UTC/,
      'ungueltiger Stichtag oeffnete die Zukunftspruefung: ' + stichtag);
    assert.strictEqual(fs.existsSync(path.join(ziel, 'earnings-calendar.json')), false);
  }
});

check('(n) Kalender OHNE Zukunftstermin -> wirft (steinalt/kaputt, nie still publizieren)', () => {
  const src = mkTmp();
  writeJson(path.join(src, 'earnings-calendar.json'),
    { AAPL: { date: '2025-01-30', pulledAt: '2025-01-02' }, MSFT: { date: inTagen(-1), pulledAt: '2025-01-02' } });
  assert.throws(() => S.run({ ziel: path.join(src, '_public'), earnings: path.join(src, 'earnings-calendar.json') }),
    /Zukunftstermin/,
    'ein Kalender, dessen juengster Termin in der Vergangenheit liegt, geht still in den Datenkanal — '
    + 'findash zeigt danach wortlos einen toten Terminkalender.');
});

// T573-R2 (SFH-Review ueber Tag 573, F2566): dieselbe Meldung nannte in JEDEM Fall
// "pull-earnings-dates.js ist ausgefallen" als wahrscheinliche Ursache. Sie feuert aber
// genauso, wenn sich Feldname oder Format in earnings-calendar.json geaendert haben —
// dann liest nur diese Pruefung die Termine nicht mehr und der Pull ist voellig
// unschuldig. Karl folgt dem "NAECHSTER SCHRITT" woertlich und landet am falschen Schritt.
// Geprueft wird die Meldung selbst, weil die Meldung der Befund ist.
check('(n1b) die Meldung nennt BEIDE Ursachen — Pull-Ausfall UND Schema-/Feldnamenwechsel', () => {
  const src = mkTmp();
  // Der Schema-Fall selbst: die Termine stehen unter einem anderen Feldnamen, die
  // Pruefung sieht deshalb null Termine — obwohl der Pull tadellos gelaufen sein kann.
  writeJson(path.join(src, 'earnings-calendar.json'),
    { AAPL: { earningsDate: inTagen(5), pulledAt: '2025-01-02' } });
  let meldung = '';
  try {
    S.run({ ziel: path.join(src, '_public'), earnings: path.join(src, 'earnings-calendar.json') });
    assert.fail('ein Kalender ohne lesbare Termine muss werfen');
  } catch (e) { meldung = String(e && e.message || e); }
  assert.match(meldung, /pull-earnings-dates\.js/,
    'die Meldung nennt den Pull-Ausfall nicht mehr — das ist weiterhin die haeufigste Ursache.');
  assert.match(meldung, /Feldname|Format/,
    'die Meldung nennt nur den Pull als Ursache. Genau dieser Fixture-Fall (Termin unter '
    + '`earningsDate` statt `date`) ist ein SCHEMA-Wechsel: der Pull ist gruen gelaufen, die '
    + 'Pruefung liest die Termine nur nicht mehr. Wer der Meldung folgt, prueft den falschen '
    + 'Schritt und findet dort nichts (T573-R2).');
});

check('(n2) Kalender MIT Zukunftstermin -> geht durch (Gegenprobe, kein Falsch-Rot)', () => {
  const src = mkTmp();
  writeJson(path.join(src, 'earnings-calendar.json'),
    { AAPL: { date: '2025-01-30', pulledAt: '2025-01-02' }, MSFT: { date: inTagen(1), pulledAt: '2025-01-02' } });
  const ziel = path.join(src, '_public');
  S.run({ ziel, earnings: path.join(src, 'earnings-calendar.json') });
  assert.ok(fs.existsSync(path.join(ziel, 'earnings-calendar.json')),
    'ein gueltiger Kalender muss weiter publiziert werden — sonst ist die Wache ein Falsch-Rot-Generator');
});

check('(n3) der Stichtag ist der LAUFTAG, nicht ein fester Wert (Termin GENAU heute zaehlt)', () => {
  const src = mkTmp();
  writeJson(path.join(src, 'earnings-calendar.json'), { AAPL: { date: inTagen(0) } });
  const ziel = path.join(src, '_public');
  S.run({ ziel, earnings: path.join(src, 'earnings-calendar.json') });
  assert.ok(fs.existsSync(path.join(ziel, 'earnings-calendar.json')),
    'ein Termin am Lauftag selbst muss als Zukunftstermin zaehlen (Datum >= Lauftag)');
});

// Silent-Failure-Review zum Tag-573-Chunk: der Stichtag darf nicht die Wanduhr des
// Runners sein, wenn der Lauf ein eingefrorenes Datum hat. Ein Lauf, der ueber UTC-
// Mitternacht laeuft, misst sonst gegen einen anderen Tag als jeder andere Schritt
// (dieselbe Klasse wie F-219b-01). Muster wie in archive-old-snapshots.js /
// watch-fx-sanity.js: RUN_DATE_UTC mit Wanduhr-Fallback.
check('(n5) der Stichtag kommt aus RUN_DATE_UTC, wenn gesetzt (eingefrorenes Lauf-Datum)', () => {
  const src = mkTmp();
  writeJson(path.join(src, 'earnings-calendar.json'), { AAPL: { date: inTagen(3) } });
  const alt = process.env.RUN_DATE_UTC;
  try {
    process.env.RUN_DATE_UTC = inTagen(9); // Lauftag NACH dem einzigen Termin
    assert.throws(() => S.run({ ziel: path.join(src, '_public'), earnings: path.join(src, 'earnings-calendar.json') }),
      /Zukunftstermin/,
      'die Wache misst gegen die Wanduhr statt gegen das eingefrorene RUN_DATE_UTC — ein Lauf ueber '
      + 'UTC-Mitternacht bewertet den Kalender dann gegen einen anderen Tag als jeder andere Schritt.');
    process.env.RUN_DATE_UTC = inTagen(1); // Lauftag VOR dem Termin
    S.run({ ziel: path.join(src, '_public'), earnings: path.join(src, 'earnings-calendar.json') });
    assert.ok(fs.existsSync(path.join(src, '_public', 'earnings-calendar.json')), 'Gegenprobe: gueltiger Stand muss durchgehen');
  } finally {
    if (alt === undefined) delete process.env.RUN_DATE_UTC; else process.env.RUN_DATE_UTC = alt;
  }
});

check('(n4) CLI: toter Kalender -> exit 1 UND ::error:: (Karls Alarmkanal)', () => {
  const src = mkTmp();
  writeJson(path.join(src, 'earnings-calendar.json'), { AAPL: { date: '2025-01-30' } });
  let rc = 0; let out = '';
  try {
    out = execFileSync(process.execPath, [SCRIPT, '--ziel', path.join(src, '_public'),
      '--earnings', path.join(src, 'earnings-calendar.json')], { encoding: 'utf8', stdio: 'pipe' });
  } catch (e) { rc = e.status; out = String(e.stdout || '') + String(e.stderr || ''); }
  assert.strictEqual(rc, 1, 'ein toter Kalender muss den Schritt rot machen (exit 1), nicht gruen durchlaufen');
  assert.ok(out.includes('::error::'), 'ohne ::error::-Annotation sieht Karl den Ausfall nicht: ' + out.slice(0, 300));
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

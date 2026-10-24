'use strict';
// Run: node tests/watch-annual-spikes-index0.test.js
//
// WHY (Daylauf 7, 24.10.2026; spike-watcher coverage audit 22.10., item 3): findeAusreisser only
// judges inner positions, so the NEWEST annual value (index 0), where a fresh bad vendor value
// lands, was never checked, and annualGP was not scanned at all. findeNeuestenAusreisser adds a
// one-sided check of index 0 against index 1 (same FAKTOR 8 and MIN_BETRAG 50e6). Master decision
// 24.10.: index 0 is REPORT-ONLY (one ::warning:: line plus a German table on stdout and in
// GITHUB_STEP_SUMMARY) and never reaches NEU, the budget, JA-2 or Q1 or the exit code; inner
// annualGP findings are counted like every other series.
// Break-once evidence (24.10., mutated copies only, live sha256 unchanged, control copy green):
// rule (index-0 call removed, annualGP out of REIHEN, JA-2 on REIHEN.length, Q1 filter removed,
// inner-spike skip removed, collapse sign condition removed, jump branch off) and report path
// (index 0 counted in funde, report sets the exit code, count line not printed, summary not
// written, table without the 50 M filter, hand-table rows in the table, cap removed, table sort
// without String() on a numeric ticker): 16 of 16 red.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const W = require('../scripts/watch-annual-spikes.js');

const series = (values) => values.map((value) => (value === null ? null : { value }));

// ── The one-sided rule (pure) ─────────────────────────────────────────────────────
test('the brief fixture: annualRev [4.0e11, 4.6e8, 4.2e8] flags index 0', () => {
  assert.deepEqual(W.findeNeuestenAusreisser(series([4.0e11, 4.6e8, 4.2e8])),
    [{ index: 0, wert: 4.0e11, links: null, rechts: 4.6e8 }]);
});

test('counter fixture: a normal newest year [4.6e8, 4.2e8, 4.0e8] is not flagged', () => {
  assert.deepEqual(W.findeNeuestenAusreisser(series([4.6e8, 4.2e8, 4.0e8])), []);
});

test('a company doubling or halving is not flagged, factor 8 is', () => {
  assert.deepEqual(W.findeNeuestenAusreisser(series([9.2e8, 4.6e8])), [], 'doubling');
  assert.deepEqual(W.findeNeuestenAusreisser(series([2.3e8, 4.6e8])), [], 'halving');
  assert.equal(W.findeNeuestenAusreisser(series([8 * 4.6e8, 4.6e8])).length, 1, 'exactly 8x up');
  assert.equal(W.findeNeuestenAusreisser(series([7.9 * 4.6e8, 4.6e8])).length, 0, '7.9x up');
});

test('collapse: previous year at least 8x the newest, both positive, is flagged', () => {
  assert.deepEqual(W.findeNeuestenAusreisser(series([57.5e6, 518.1e6, 500e6])),
    [{ index: 0, wert: 57.5e6, links: null, rechts: 518.1e6 }]);
  assert.deepEqual(W.findeNeuestenAusreisser(series([65e6, 518.1e6, 500e6])), [], '7.97x down');
});

test('a loss year or a shrinking loss never counts as a collapse', () => {
  assert.deepEqual(W.findeNeuestenAusreisser(series([-50e6, 800e6])), [], 'newest is a loss year');
  assert.deepEqual(W.findeNeuestenAusreisser(series([-50e6, -800e6])), [], 'shrinking loss');
  assert.deepEqual(W.findeNeuestenAusreisser(series([50e6, -800e6])), [], 'turnaround after a big loss');
});

test('small amounts, zeros and gaps produce no finding', () => {
  assert.deepEqual(W.findeNeuestenAusreisser(series([40e6, 4e6])), [], 'jump below MIN_BETRAG');
  assert.deepEqual(W.findeNeuestenAusreisser(series([4e6, 40e6])), [], 'collapse below MIN_BETRAG');
  assert.deepEqual(W.findeNeuestenAusreisser(series([0, 4.6e8])), [], 'zero newest has no ratio');
  assert.deepEqual(W.findeNeuestenAusreisser(series([4.6e8, 0])), [], 'zero previous has no ratio');
  assert.deepEqual(W.findeNeuestenAusreisser(series([null, 4.6e8])), []);
  assert.deepEqual(W.findeNeuestenAusreisser(series([4.0e11])), [], 'no previous year');
  assert.deepEqual(W.findeNeuestenAusreisser([]), []);
  assert.deepEqual(W.findeNeuestenAusreisser(null), []);
});

test('an inner spike at index 1 is not reported a second time as an index-0 collapse', () => {
  const r = series([100e6, 1000e6, 100e6]);
  assert.equal(W.findeAusreisser(r).length, 1, 'the inner rule owns this anomaly');
  assert.deepEqual(W.findeNeuestenAusreisser(r), []);
});

// ── The scan keeps index 0 out of the counted findings ─────────────────────────────
function tempDir(prefix) { return fs.mkdtempSync(path.join(os.tmpdir(), prefix)); }

test('scanSnapshots: index-0 findings go to `neueste`, never to `funde`; inner annualGP is counted', () => {
  assert.ok(W.REIHEN.includes('annualGP'), 'annualGP is scanned');
  const dir = tempDir('annual-spikes-index0-');
  try {
    const ends = ['2026-06-30', '2025-06-30', '2024-06-30'];
    fs.writeFileSync(path.join(dir, 'REV0.json'), JSON.stringify({ meta: { ticker: 'REV0',
      fxConverted: true, reportingCurrency: 'USD', reportingCurrencyOriginal: 'AUD', fxRateApplied: 0.625 },
    annual: { annualRev: series([4.0e11, 4.6e8, 4.2e8]), annualRevEnds: ends } }));
    fs.writeFileSync(path.join(dir, 'GP0.json'), JSON.stringify({ meta: { ticker: 'GP0' }, annual: {
      annualGP: series([4.0e11, 4.6e8, 4.2e8]), annualGPEnds: ends } }));
    fs.writeFileSync(path.join(dir, 'GP1.json'), JSON.stringify({ meta: { ticker: 'GP1' }, annual: {
      annualGP: series([100e6, 900e6, 110e6]) } }));
    fs.writeFileSync(path.join(dir, 'CLEAN.json'), JSON.stringify({ meta: { ticker: 'CLEAN' }, annual: {
      annualRev: series([4.6e8, 4.2e8, 4.0e8]), annualGP: series([2.3e8, 2.1e8, 2.0e8]) } }));
    const { funde, neueste } = W.scanSnapshots(dir);
    assert.deepEqual(funde.map((x) => `${x.ticker}|${x.reihe}|${x.index}`), ['GP1|annualGP|1'],
      'only the inner GP spike is counted');
    assert.deepEqual(neueste.map((x) => `${x.ticker}|${x.reihe}|${x.index}`).sort(), ['GP0|annualGP|0', 'REV0|annualRev|0']);
    const rev = neueste.find((x) => x.ticker === 'REV0');
    assert.deepEqual(rev.bericht, { waehrung: 'AUD', wert: 4.0e11 / 0.625, vorjahr: 4.6e8 / 0.625,
      ende: '2026-06-30', endeVorjahr: '2025-06-30' }, 'native currency and both period ends');
    const gp = neueste.find((x) => x.ticker === 'GP0');
    assert.deepEqual(gp.bericht, { waehrung: null, wert: null, vorjahr: null, ende: '2026-06-30', endeVorjahr: '2025-06-30' },
      'no currency evidence, no number');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ── The report (pure) ─────────────────────────────────────────────────────────────
const fund = (ticker, reihe, wert, rechts, extra = {}) => ({ ticker, reihe, index: 0, wert, links: null, rechts,
  bericht: { waehrung: 'EUR', wert: wert / 2, vorjahr: rechts / 2, ende: '2025-12-31', endeVorjahr: '2024-12-31' }, ...extra });

test('report: one ::warning:: line with counts per series and branch; table only for Rev/GP with both >= 50 M', () => {
  const r = W.neuestesJahrBericht([
    fund('AAA', 'annualRev', 4.0e11, 4.6e8),             // jump, table
    fund('BBB', 'annualGP', 60e6, 600e6),                 // collapse, table
    fund('CCC', 'annualRev', 400e6, 40e6),                // previous below 50 M: counted only
    fund('DDD', 'annualOpInc', 900e6, 100e6),             // other series: counted only
    fund('EEE', 'annualNetIncome', 60e6, 900e6),          // other series, collapse
    fund('FFF', 'annualGP', 900e6, 100e6, { handtabellenFall: 'case-1' }), // hand table: counted only
  ]);
  assert.equal(r.warnung, '::warning::Neuestes Geschaeftsjahr (nur Meldung, zaehlt nicht fuer Rot): 6 Funde · '
    + 'annualRev 2 (Sprung 2 · Einbruch 0) · annualGP 2 (Sprung 1 · Einbruch 1) · '
    + 'annualOpInc 1 (Sprung 1 · Einbruch 0) · annualNetIncome 1 (Sprung 0 · Einbruch 1) · '
    + 'davon Handtabelle 1 · Tabelle Umsatz/Bruttogewinn ab 50 Mio: 2');
  const rows = r.markdown.split('\n').filter((l) => /^\| [A-Z]{3} \|/.test(l));
  assert.deepEqual(rows, [
    '| AAA | Umsatz | 200.000,0 | 230,0 | EUR | 2025-12-31 | 2024-12-31 | 869,6 |',
    '| BBB | Bruttogewinn | 30,0 | 300,0 | EUR | 2025-12-31 | 2024-12-31 | 10,0 |',
  ], 'sorted by factor, native values in M, both period ends');
  assert.match(r.markdown, /Nur gezählt: Betriebsergebnis 1, Nettoergebnis 1, Umsatz und Bruttogewinn unter der Betragsgrenze 1, per Handtabelle bereits korrigiert 1\./);
  assert.doesNotMatch(r.markdown, /Gekappt/);
});

test('report: a missing currency shows "fehlt", never a number', () => {
  const r = W.neuestesJahrBericht([fund('AAA', 'annualRev', 4.0e11, 4.6e8,
    { bericht: { waehrung: null, wert: null, vorjahr: null, ende: null, endeVorjahr: null } })]);
  assert.ok(r.markdown.includes('| AAA | Umsatz | fehlt | fehlt | fehlt | fehlt | fehlt | 869,6 |'));
});

test('report: the table is capped at 100 rows with a note', () => {
  assert.equal(W.BERICHT_MAX_ZEILEN, 100);
  const viele = Array.from({ length: 105 }, (_, i) => fund('T' + String(i).padStart(3, '0'), 'annualRev', (9 + i) * 100e6, 100e6));
  const r = W.neuestesJahrBericht(viele);
  assert.equal(r.markdown.split('\n').filter((l) => /^\| T\d{3} \|/.test(l)).length, 100);
  assert.match(r.markdown, /Gekappt: 100 von 105 Zeilen gezeigt/);
  assert.match(r.warnung, /Tabelle Umsatz\/Bruttogewinn ab 50 Mio: 105$/);
});

test('report: no index-0 finding -> a plain count line, no warning, no summary section', () => {
  assert.deepEqual(W.neuestesJahrBericht([]),
    { warnung: null, zeile: 'Neuestes Geschaeftsjahr (nur Meldung, zaehlt nicht fuer Rot): 0 Funde', markdown: null });
});

// ── main(): index 0 never changes the exit code ───────────────────────────────────
function laufMain(snapshots, summaryFile) {
  const o = { e: fs.existsSync, r: fs.readdirSync, f: fs.readFileSync, l: console.log, x: console.error,
    a: process.argv, v: process.env.ANNUAL_SPIKE_MAX_NEU, s: process.env.GITHUB_STEP_SUMMARY };
  const out = [], err = [];
  fs.existsSync = () => true;
  fs.readdirSync = () => Object.keys(snapshots);
  fs.readFileSync = (file, ...rest) => {
    const name = path.basename(String(file));
    if (snapshots[name]) return JSON.stringify(snapshots[name]);
    if (name === 'annual-spikes-baseline.json') {
      return JSON.stringify({ faelle: [], snapshotsBeiAufnahme: Object.keys(snapshots).length, ausgeschlossen: [] });
    }
    return o.f(file, ...rest);
  };
  console.log = (...a) => out.push(a.join(' '));
  console.error = (...a) => err.push(a.join(' '));
  process.argv = o.a.filter((x) => x !== '--neu-aufnehmen');
  process.env.ANNUAL_SPIKE_MAX_NEU = '0'; // a single COUNTED event would turn the run red
  if (summaryFile) process.env.GITHUB_STEP_SUMMARY = summaryFile; else delete process.env.GITHUB_STEP_SUMMARY;
  try { return { code: W.main(new Date('2026-10-24T12:00:00Z')), out, err }; }
  finally {
    fs.existsSync = o.e; fs.readdirSync = o.r; fs.readFileSync = o.f;
    console.log = o.l; console.error = o.x; process.argv = o.a;
    if (o.v === undefined) delete process.env.ANNUAL_SPIKE_MAX_NEU; else process.env.ANNUAL_SPIKE_MAX_NEU = o.v;
    if (o.s === undefined) delete process.env.GITHUB_STEP_SUMMARY; else process.env.GITHUB_STEP_SUMMARY = o.s;
  }
}
const jump = [4.0e11, 4.6e8, 4.2e8];

test('main: a snapshot set with only index-0 findings exits 0 and reports them', () => {
  const dir = tempDir('annual-spikes-index0-summary-');
  try {
    const summary = path.join(dir, 'summary.md');
    const r = laufMain({
      // Cigna form at index 0 (JA-2 if it were counted), Rev+OpInc with the same factor (Q1 if it
      // were counted), and more events than the budget of 0 allows.
      'CI0.json': { meta: { ticker: 'CI0' }, annual: { annualRev: series(jump), annualOpInc: series(jump), annualNetIncome: series(jump) } },
      'Q10.json': { meta: { ticker: 'Q10' }, annual: { annualRev: series(jump), annualOpInc: series(jump.map((v) => v / 4)) } },
      'GP0.json': { meta: { ticker: 'GP0', reportingCurrency: 'USD' }, annual: { annualGP: series(jump) } },
      // A non-string ticker with the same factor as the rows above reaches the ticker tie-break of
      // the table sort; the report-only path must not crash (the CLI catch would exit 1).
      'NUM.json': { meta: { ticker: 1234, reportingCurrency: 'USD' }, annual: { annualRev: series(jump) } },
    }, summary);
    assert.equal(r.code, 0, r.err.join('\n'));
    assert.deepEqual(r.err, [], 'no ::error:: line at all');
    assert.ok(r.out.includes('Jahres-Ausreisser: 0 in 4 gelesenen Snapshots · davon NEU: 0'), r.out.join('\n'));
    assert.ok(r.out.some((l) => l.startsWith('::warning::Neuestes Geschaeftsjahr (nur Meldung, zaehlt nicht fuer Rot): 7 Funde · annualRev 3 ')));
    const md = fs.readFileSync(summary, 'utf8');
    assert.ok(md.includes('| GP0 | Bruttogewinn | 400.000,0 | 460,0 | USD | fehlt | fehlt | 869,6 |'), md);
    assert.ok(md.includes('| 1234 | Umsatz | 400.000,0 | 460,0 | USD | fehlt | fehlt | 869,6 |'), 'the numeric-ticker row is printed');
    assert.ok(r.out.some((l) => l.includes('| GP0 | Bruttogewinn |')), 'the table is on stdout too');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('main: counter check, the same harness turns red on one counted inner spike', () => {
  const r = laufMain({ 'IN1.json': { meta: { ticker: 'IN1' }, annual: { annualRev: series([100e6, 900e6, 110e6]) } } });
  assert.equal(r.code, 1, 'the exit-0 test above is not vacuous');
  assert.ok(r.out.includes('Neuestes Geschaeftsjahr (nur Meldung, zaehlt nicht fuer Rot): 0 Funde'));
});

// ── Shape gates stay on the founding series ───────────────────────────────────────
test('JA-2 and Q1 stay on the three founding series when annualGP joins REIHEN', () => {
  const f = (reihe) => ({ ticker: 'CI', reihe, index: 2, wert: 4.0e11, links: 4.4e8, rechts: 4.6e8 });
  const drei = ['annualOpInc', 'annualRev', 'annualNetIncome'].map(f);
  assert.deepEqual(W.GRUND_REIHEN, ['annualOpInc', 'annualRev', 'annualNetIncome']);
  assert.deepEqual(W.cignaFaelle(drei), ['CI|2'], 'three founding series without GP are the Cigna form');
  assert.deepEqual(W.cignaFaelle([...drei, f('annualGP')]), ['CI|2']);
  assert.deepEqual(W.cignaFaelle([f('annualOpInc'), f('annualRev'), f('annualGP')]), [],
    'GP does not replace a missing founding series');
  assert.deepEqual(W.faktorGleicheFaelle([f('annualOpInc'), f('annualRev'), f('annualGP')]).zweiVonDrei, ['CI|2'],
    'a third GP hit does not move a 2-of-3 form out of Q1');
});

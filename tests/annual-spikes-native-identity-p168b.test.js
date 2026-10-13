'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const Module = require('node:module');
const vm = require('node:vm');
const W = require('../scripts/watch-annual-spikes.js');
const { migriereIdentitaeten: migrate } = require('../scripts/annual-spikes-migrate-identity.js');
const root = path.resolve(__dirname, '..');
const tempRoot = fs.realpathSync(os.tmpdir());
const temp = fs.mkdtempSync(path.join(tempRoot, 'annual-spikes-p168b-'));
const watcher = path.join(root, 'scripts/watch-annual-spikes.js');
const migration = path.join(root, 'scripts/annual-spikes-migrate-identity.js');
const baselinePath = path.join(root, 'data-health/annual-spikes-baseline.json');
const hashes = () => [watcher, migration, baselinePath].map(f =>
  crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex'));
const before = hashes();
let serial = 0;
after(() => {
  assert.deepEqual(hashes(), before);
  assert.ok(path.resolve(temp).startsWith(tempRoot + path.sep));
  fs.rmSync(temp, { recursive: true });
});

function snapshot(ticker = 'KNOWN', fx = 1, dated = true) {
  const periods = ['2025-12-31', '2024-12-31', '2023-12-31']
    .map(end => ({ end, duration: '12M', unit: 'currency', currency: 'EUR' }));
  return { meta: { ticker, fxConverted: true, reportingCurrency: 'USD', reportingCurrencyOriginal: 'EUR',
    fxRateApplied: fx, ...(dated ? { statementPeriods: { annualRev: periods } } : {}) },
  annual: { annualRev: [100e6, 1000e6, 110e6].map(value => ({ value: value * fx })) } };
}
function scan(...snapshots) {
  const dir = path.join(temp, String(serial++));
  fs.mkdirSync(dir);
  for (const s of snapshots) fs.writeFileSync(path.join(dir, s.meta.ticker + '.json'), JSON.stringify(s));
  return W.scanSnapshots(dir);
}
function baseline(s) {
  return { aufgenommenAm: '2026-08-30', snapshotsBeiAufnahme: s.gescannt, ausgeschlossen: [],
    anzahl: s.funde.length, faelle: s.funde.map(W.stabilerSchluessel).sort() };
}
function known(w, x, b, funde = [x]) {
  const keys = new Set(b.faelle), native = b.nativeIdentitaeten || [];
  return w.istBekannt(x, keys, w.fundeJeReihe(funde, keys, native), native, funde);
}
function computed(ticker = 'KNOWN', margin = 0.6) {
  const s = snapshot(ticker);
  s.meta.opIncSource = 'computed-margin';
  s.meta.statementPeriods.annualOpInc = structuredClone(s.meta.statementPeriods.annualRev);
  s.annual.annualOpInc = s.annual.annualRev.map(p => ({ value: p.value * margin }));
  return s;
}
function breakOnce(file, anchor, replacement, check) {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  assert.equal(lines.filter(l => l === anchor).length, 1, 'one complete-line anchor');
  const target = path.resolve(temp, 'mutant-' + serial++ + '.js');
  assert.notEqual(target, path.resolve(file));
  assert.ok(target.startsWith(path.resolve(temp) + path.sep));
  const original = hashes();
  lines[lines.indexOf(anchor)] = replacement;
  fs.writeFileSync(target, lines.join('\n'));
  try {
    const copy = new Module(target, module);
    copy.filename = target;
    copy.require = Module.createRequire(file);
    copy._compile(fs.readFileSync(target, 'utf8'), target);
    assert.throws(() => check(copy.exports), error => {
      assert.equal(error.name, 'AssertionError');
      console.log('BREAK-ONCE RED: ' + error.message);
      return true;
    });
  } finally { assert.deepEqual(hashes(), original, 'mutations never touch live files'); }
}

function optionalPeriodCheck(w) {
  const s = snapshot('KNOWN', 1.03, false);
  s.meta.statementPeriods = { annualRev: [null, null, null] };
  s.annual.annualRevEnds = [null, null, null];
  const nativ = w.nativeIdentitaet(s, 'annualRev', 1);
  assert.deepEqual(nativ, { periode: null, waehrung: 'EUR', werte: [100e6, 1000e6, 110e6] });
  assert.ok(w.nativerSchluessel({ ticker: 'KNOWN', reihe: 'annualRev', nativ }));
}
test('D1: missing/null ends retain native identity and FX recognition, with conflicting metadata rejected', () => {
  optionalPeriodCheck(W);
  for (const change of [s => {}, s => { s.meta.statementPeriods = { annualRev: [null, null, null] }; },
    s => { s.annual.annualRevEnds = [null, null, null]; },
    s => { s.meta.statementPeriods = snapshot().meta.statementPeriods;
      s.meta.statementPeriods.annualRev.forEach(p => { p.end = null; }); }]) {
    const s = snapshot('KNOWN', 1, false); change(s);
    const initial = scan(s), b = migrate(baseline(initial), initial, '2026-10-10').baseline;
    const moved = structuredClone(s); moved.meta.fxRateApplied = 1.03;
    moved.annual.annualRev.forEach(p => { p.value *= 1.03; });
    const x = scan(moved).funde[0];
    assert.equal(known(W, x, b), true);
    assert.equal(known(W, { ...x, nativ: { ...x.nativ, werte: [100e6, 1000e6, 111e6] } }, b), false);
    assert.equal(W.basisGueltig(b, 1).ok, true);
  }
  const fallback = snapshot(); fallback.meta.statementPeriods.annualRev[1] = null;
  fallback.annual.annualRevEnds = [null, '2024-12-31', null];
  assert.equal(W.nativeIdentitaet(fallback, 'annualRev', 1).periode, '2024-12-31');
  for (const edit of [s => { s.annual.annualRevEnds = [null, '2022-12-31', null]; },
    s => { s.meta.statementPeriods.annualRev[1].end = '2024-02-30'; },
    s => { s.meta.statementPeriods.annualRev[0].currency = 'JPY'; }]) {
    const s = snapshot(); edit(s); assert.equal(W.nativeIdentitaet(s, 'annualRev', 1), null);
  }
  breakOnce(watcher, '  const periode = p?.end ?? ende ?? null;',
    '  const periode = p?.end ?? ende ?? null; if (periode == null) return null;', optionalPeriodCheck);
});

function tightMigrationCheck(m) {
  const initial = scan(snapshot()), b = baseline(initial), s = snapshot('KNOWN', 1.03);
  s.annual.annualRev[0].value *= 1.000001;
  assert.deepEqual(m.migriereIdentitaeten(b, scan(s), '2026-10-10').baseline, b,
    'a one-ppm vendor change is not FX drift');
}
test('D2: migration uses 1e-9, retains the margin guard and never adds a new baseline case', () => {
  tightMigrationCheck({ migriereIdentitaeten: migrate });
  const initial = scan(computed()), b = baseline(initial);
  const current = scan(computed('KNOWN', 0.61));
  const result = migrate(b, current, '2026-10-10').baseline;
  assert.deepEqual(result.faelle, b.faelle);
  assert.equal(result.nativeIdentitaeten.length, 1, 'changed computed OpInc cannot migrate');
  assert.equal(result.nativeIdentitaeten[0].reihe, 'annualRev');
  const s = snapshot('KNOWN', 1.03); s.annual.annualRev[0].value *= 1 + 5e-10;
  const revBase = baseline(scan(snapshot()));
  assert.equal(migrate(revBase, scan(s), '2026-10-10').baseline.nativeIdentitaeten.length, 1);
  const extra = scan(snapshot(), snapshot('OUTSIDE'));
  const amended = migrate({ ...revBase, snapshotsBeiAufnahme: 2 }, extra, '2026-10-10').baseline;
  assert.equal(amended.nativeIdentitaeten.length, 1);
  assert.equal(known(W, extra.funde[1], amended), false);
  breakOnce(migration, '  return error <= 1e-9 ? { factor, error } : null;',
    '  return error <= 0.01 ? { factor, error } : null;', tightMigrationCheck);
});

function usdFallbackCheck(w) {
  const initial = scan(snapshot()), b = migrate(baseline(initial), initial, '2026-10-10').baseline;
  const s = snapshot(); delete s.meta.statementPeriods; delete s.meta.fxRateApplied;
  const x = scan(s).funde[0];
  assert.equal(x.nativ, null);
  assert.equal(W.stabilerSchluessel(x), b.faelle[0]);
  assert.equal(known(w, x, b), true, 'byte-identical USD survives lost native evidence');
}
test('D3: a migrated case stays known after period metadata disappears; changed values stay NEW', () => {
  usdFallbackCheck(W);
  const initial = scan(snapshot()), b = migrate(baseline(initial), initial, '2026-10-10').baseline;
  const s = snapshot(); delete s.meta.statementPeriods;
  const x = scan(s).funde[0];
  assert.equal(x.nativ.periode, null);
  assert.equal(known(W, x, b), true, 'period-only metadata loss with identical USD');
  assert.equal(known(W, { ...x, nativ: { ...x.nativ, werte: [100e6, 1000e6, 111e6] } }, b), false);
  assert.equal(known(W, { ...x, nativ: null, wert: x.wert + 1 }, b), false);
  assert.equal(known(W, { ...x, nativ: { ...x.nativ, periode: '2022-12-31' } }, b), false);
  assert.equal(known(W, { ...x, nativ: { ...x.nativ, waehrung: 'JPY' } }, b), false);
  breakOnce(watcher, '  return bestand.has(alt) && (!migrated || x.nativ == null',
    '  return bestand.has(alt) && (!migrated', usdFallbackCheck);
});

function calibrationCheck(w) {
  for (const ticker of ['KINV-B.ST', 'MFSL.NS']) {
    const s = scan(computed(ticker)), b = baseline(s);
    for (const x of s.funde) assert.equal(known(w, x, b, s.funde), false, ticker + ' stays calibration-only');
  }
}
test('D4: calibration twins take precedence over USD, native and computed-margin knowledge', () => {
  calibrationCheck(W);
  for (const ticker of ['KINV-A.ST', 'KINV-B.ST', 'MFSL.BO', 'MFSL.NS']) {
    const s = scan(computed(ticker)), b = baseline(s);
    assert.deepEqual(migrate(b, s, '2026-10-10').baseline, b);
    const nativeIdentitaeten = s.funde.map(x => ({ schluessel: W.stabilerSchluessel(x), ...x }));
    for (const x of s.funde) assert.equal(known(W, x, { ...b, nativeIdentitaeten }, s.funde), false);
  }
  breakOnce(watcher,
    "  return (['KINV-A.ST', 'KINV-B.ST', 'MFSL.BO', 'MFSL.NS'].includes(x.ticker) && ['annualOpInc', 'annualRev'].includes(x.reihe))",
    "  return (['KINV-A.ST', 'MFSL.BO'].includes(x.ticker) && ['annualOpInc', 'annualRev'].includes(x.reihe))", calibrationCheck);
});

function computedCheck(w) {
  const initial = scan(computed()), b = migrate(baseline(initial), initial, '2026-10-10').baseline;
  const current = scan(computed('KNOWN', 0.61));
  assert.equal(known(w, current.funde.find(x => x.reihe === 'annualOpInc'), b, current.funde), true,
    'known revenue makes its constant computed margin a known finding');
}
test('D5: derived computed margin requires known revenue, the same explicit period and an existing OpInc case', () => {
  computedCheck(W);
  const initial = scan(computed()), b = migrate(baseline(initial), initial, '2026-10-10').baseline;
  for (const edit of [s => { s.annual.annualOpInc[0].value *= 1.000001; },
    s => { s.meta.statementPeriods.annualRev[1].end = '2022-12-31'; },
    s => { delete s.meta.statementPeriods; },
    s => { s.meta.opIncSource = 'reported'; },
    s => { delete s.annual.annualRev; },
    s => { s.annual.annualRev[0].value = 0; },
    s => { s.annual.annualRev[0].value += 1000; }]) {
    const s = computed('KNOWN', 0.61); edit(s); const current = scan(s);
    assert.equal(known(W, current.funde.find(x => x.reihe === 'annualOpInc'), b, current.funde), false);
  }
  const current = scan(computed('KNOWN', 0.61)), x = current.funde.find(f => f.reihe === 'annualOpInc');
  const revOnly = { ...b, faelle: b.faelle.filter(k => k.includes('|annualRev|')),
    nativeIdentitaeten: b.nativeIdentitaeten.filter(f => f.reihe === 'annualRev') };
  assert.equal(known(W, x, revOnly, current.funde), false, 'no case outside the baseline');
  const otherYear = { ...b, nativeIdentitaeten: b.nativeIdentitaeten.map(f => f.reihe === 'annualOpInc'
    ? { ...f, nativ: { ...f.nativ, periode: '2023-12-31' } } : f) };
  assert.equal(known(W, x, otherYear, current.funde), false, 'even equal shapes cannot override a different known year');
  const otherShape = { ...revOnly, faelle: [...revOnly.faelle,
    'KNOWN|annualOpInc|werte:40000000|600000000|44000000'] };
  assert.equal(known(W, x, otherShape, current.funde), false, 'an undated unrelated OpInc case cannot approve a new shape');
  const undatedOld = { ...b, nativeIdentitaeten: revOnly.nativeIdentitaeten };
  assert.equal(known(W, x, undatedOld, current.funde), true, 'an unchanged legacy shape permits a revised constant margin');
  assert.deepEqual(W.sperrenOhneWirkung([{ sperrschluessel: W.sperrSchluessel(x) }], current.funde,
    new Set(b.faelle), b.nativeIdentitaeten), ['KNOWN|annualOpInc|1']);
  const close = computed('KNOWN', 0.61); close.annual.annualOpInc[0].value *= 1 + 5e-10;
  const closeScan = scan(close);
  assert.equal(known(W, closeScan.funde.find(f => f.reihe === 'annualOpInc'), b, closeScan.funde), true);
  breakOnce(watcher, '  if (bekannteBerechneteMarge(x, bestand, heutigeFundeJeReihe, nativeFaelle, funde)) return true;',
    '  if (false) return true;', computedCheck);
});

test('both research programs execute the watcher knowledge rules using an isolated in-memory population', () => {
  const originals = [computed(), snapshot('UNDATED', 1, false), computed('KINV-B.ST')];
  const initial = scan(...originals), b = migrate(baseline(initial), initial, '2026-10-10').baseline;
  const samples = [computed('KNOWN', 0.61), snapshot('UNDATED', 1.03, false), computed('KINV-B.ST')];
  const current = scan(...samples), keys = new Set(b.faelle), native = b.nativeIdentitaeten;
  const counts = W.fundeJeReihe(current.funde, keys, native);
  const newCount = current.funde.filter(x => !W.istBekannt(x, keys, counts, native, current.funde)).length;
  assert.equal(newCount, 2);
  for (const script of ['t-kdrift-signatur.js', 't-jahresausreisser-klassifikation.js']) {
    let report = '', exitCode;
    const outputs = [];
    const entries = Array.from({ length: 17392 }, (_, i) => ({ name: i + '.json',
      isSymbolicLink: () => false, isDirectory: () => false }));
    const fakeFs = {
      lstatSync: () => ({ isSymbolicLink: () => false }),
      readdirSync: () => entries,
      readFileSync: (file, encoding) => {
        let text;
        if (file === watcher) text = fs.readFileSync(watcher, 'utf8');
        else if (file === baselinePath) text = JSON.stringify(b);
        else {
          assert.match(path.basename(file), /^\d+\.json$/);
          const i = Number(path.basename(file, '.json'));
          text = JSON.stringify(samples[i] || { meta: { ticker: 'EMPTY' + i }, annual: {} });
        }
        return encoding ? text : Buffer.from(text);
      },
      writeFileSync: (file, text) => { assert.equal(file, path.join(root, 'reports', script === 't-kdrift-signatur.js'
        ? 't-kdrift-signatur-2026-09-20.md' : 't-jahresausreisser-nicht-erfasst-2026-09-20.md')); report = text; },
    };
    const allowed = { 'node:fs': fakeFs, 'node:path': path, 'node:crypto': crypto, 'node:vm': vm, 'node:assert/strict': assert };
    const processStub = { argv: ['node', script, 'virtual-run1', 'virtual-run2'],
      set exitCode(value) { exitCode = value; } };
    const moduleStub = {};
    const requireStub = name => { assert.ok(Object.hasOwn(allowed, name)); return allowed[name]; };
    requireStub.main = moduleStub;
    vm.runInNewContext(fs.readFileSync(path.join(root, 'scripts', script), 'utf8'), {
      require: requireStub, module: moduleStub,
      __dirname: path.join(root, 'scripts'), process: processStub,
      console: { log: (...a) => outputs.push(a.join(' ')), error: (...a) => outputs.push(a.join(' ')) },
    }, { timeout: 10000 });
    assert.equal(exitCode, undefined, outputs.join('\n'));
    assert.ok(report.length);
    if (script === 't-kdrift-signatur.js') {
      assert.match(report, /bekannt\?/);
      const rows = report.split('\n');
      assert.ok(rows.some(l => l.startsWith('| KNOWN | annualOpInc |') && l.includes('| ja / ja |')));
      assert.ok(rows.some(l => l.startsWith('| UNDATED | annualRev |') && l.includes('| ja / ja |')));
      assert.ok(rows.some(l => l.startsWith('| KINV-B.ST | annualRev |') && l.includes('| nein / nein |')));
    } else assert.ok(report.includes(`${newCount} NEU`), report.slice(0, 2000));
  }
});

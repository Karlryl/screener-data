'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const Module = require('node:module');
const W = require('../scripts/watch-annual-spikes.js');
const { migriereIdentitaeten } = require('../scripts/annual-spikes-migrate-identity.js');
const ROOT = path.resolve(__dirname, '..');
const tempRoot = fs.realpathSync(os.tmpdir());
const temp = fs.mkdtempSync(path.join(tempRoot, 'annual-spikes-p168-'));
const live = path.join(ROOT, 'scripts/watch-annual-spikes.js');
const liveFiles = [live, path.join(ROOT, 'data-health/annual-spikes-baseline.json')];
const hashes = () => liveFiles.map(f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex'));
const originalHashes = hashes();
let sequence = 0;
after(() => {
  assert.deepEqual(hashes(), originalHashes, 'live watcher and baseline must remain unchanged');
  assert.ok(path.resolve(temp).startsWith(tempRoot + path.sep));
  fs.rmSync(temp, { recursive: true });
});

function snapshot(ticker = 'KNOWN', fx = 1) {
  return { meta: { ticker, fxConverted: true, reportingCurrency: 'USD', reportingCurrencyOriginal: 'EUR',
    fxRateApplied: fx, statementPeriods: { annualRev: ['2025-12-31', '2024-12-31', '2023-12-31']
      .map(end => ({ end, duration: '12M', currency: 'EUR', unit: 'currency' })) } },
  annual: { annualRev: [100e6, 1000e6, 110e6].map(value => ({ value: value * fx })) } };
}

function scan(...snapshots) {
  const dir = path.join(temp, String(sequence++));
  fs.mkdirSync(dir);
  snapshots.forEach(s => fs.writeFileSync(path.join(dir, s.meta.ticker + '.json'), JSON.stringify(s)));
  return W.scanSnapshots(dir);
}

function baseline(s) {
  return { aufgenommenAm: '2026-08-30', snapshotsBeiAufnahme: s.gescannt, ausgeschlossen: [],
    anzahl: s.funde.length, faelle: s.funde.map(W.stabilerSchluessel).sort() };
}

function known(w, x, b) {
  const set = new Set(b.faelle), native = b.nativeIdentitaeten || [];
  return w.istBekannt(x, set, w.fundeJeReihe([x], set, native), native);
}

const original = scan(snapshot());
const old = baseline(original);
const migrated = migriereIdentitaeten(old, original, '2026-10-10').baseline;
const moved = scan(snapshot('KNOWN', 1.03)).funde[0];
function fxCheck(w) { assert.equal(known(w, moved, migrated), true, 'known native values must survive 3% FX drift'); }

test('(a) a known native triple remains known after a 3% USD-only FX move', () => {
  assert.notEqual(W.stabilerSchluessel(original.funde[0]), W.stabilerSchluessel(moved));
  assert.deepEqual(original.funde[0].nativ, moved.nativ);
  fxCheck(W);
});

test('(b) unchanged USD values with changed native values are NEW, including both neighbors', () => {
  const changed = snapshot(); changed.meta.fxRateApplied = 2;
  const x = scan(changed).funde[0];
  assert.equal(W.stabilerSchluessel(x), W.stabilerSchluessel(original.funde[0]));
  assert.equal(known(W, x, migrated), false);
  assert.equal(known(W, { ...moved, nativ: { ...moved.nativ, werte: [101e6, 1000e6, 110e6] } }, migrated), false);
  assert.equal(known(W, { ...moved, nativ: { ...moved.nativ, werte: [100e6, 1000e6, 111e6] } }, migrated), false);
});

test('(c) migration never adds a never-known case or changes the legacy entries', () => {
  const s = scan(snapshot('KNOWN', 1.03), snapshot('NEW', 1.03));
  const b = { ...old, snapshotsBeiAufnahme: 2 };
  const before = JSON.stringify(b);
  const result = migriereIdentitaeten(b, s, '2026-10-10');
  assert.equal(JSON.stringify(b), before, 'input baseline is immutable');
  assert.deepEqual(result.baseline.faelle, b.faelle);
  assert.equal(result.baseline.nativeIdentitaeten.length, 1);
  assert.equal(result.baseline.nativeIdentitaeten[0].ticker, 'KNOWN');
  assert.equal(known(W, s.funde.find(x => x.ticker === 'NEW'), result.baseline), false);
  assert.deepEqual(migriereIdentitaeten(result.baseline, s, '2026-10-10').baseline, result.baseline, 'idempotent');
});

test('(d) migrated and unmigrated old entries both match; absent entries stay untouched', () => {
  const legacy = snapshot('LEGACY'); delete legacy.meta.fxRateApplied;
  const s = scan(snapshot('KNOWN', 1.03), legacy);
  const b = { ...baseline(scan(snapshot(), legacy)),
    faelle: [...old.faelle, W.stabilerSchluessel(s.funde.find(x => x.ticker === 'LEGACY')),
      'ABSENT|annualRev|werte:100000000|1000000000|110000000'].sort(), anzahl: 3 };
  const result = migriereIdentitaeten(b, s, '2026-10-10').baseline;
  assert.deepEqual(result.faelle, b.faelle);
  assert.equal(result.nativeIdentitaeten.length, 1);
  for (const x of s.funde) assert.equal(known(W, x, result), true, x.ticker);
});

test('(e) break-once: restoring the USD comparison makes (a) throw AssertionError', () => {
  const source = fs.readFileSync(live, 'utf8');
  const anchor = '  if (key && nativeFaelle.some(a => nativerSchluessel(a) === key)) return true;';
  const lines = source.split('\n');
  assert.equal(lines.filter(line => line === anchor).length, 1, 'one complete-line anchor');
  const target = path.resolve(temp, 'watch-annual-spikes.js');
  assert.notEqual(target, path.resolve(live));
  assert.ok(target.startsWith(path.resolve(temp) + path.sep));
  const before = hashes();
  lines[lines.indexOf(anchor)] = '  if (bestand.has(stabilerSchluessel(x))) return true;';
  fs.writeFileSync(target, lines.join('\n'));
  try {
    const copy = new Module(target, module);
    copy.filename = target;
    copy.require = Module.createRequire(live);
    copy._compile(fs.readFileSync(target, 'utf8'), target);
    assert.throws(() => fxCheck(copy.exports), error => {
      assert.equal(error.name, 'AssertionError');
      console.log('BREAK-ONCE RED: AssertionError: ' + error.message);
      return true;
    });
    fxCheck(W);
  } finally { assert.deepEqual(hashes(), before, 'mutation never changes the live files'); }
});

test('changed periods and changed USD with invalid evidence remain NEW; calibration stays excluded', () => {
  for (const change of [s => { s.meta.statementPeriods.annualRev[1].end = '2022-12-31'; },
    s => { delete s.meta.fxRateApplied; }, s => { s.meta.fxRateApplied = 0; },
    s => { s.meta.statementPeriods.annualRev[1].duration = '3M'; },
    s => { s.meta.statementPeriods.annualRev[0].currency = 'JPY'; },
    s => { s.meta.statementPeriods.annualRev[2].duration = '3M'; },
    s => { s.meta.statementPeriods.annualRev[1] = false; s.annual.annualRevEnds = ['2025-12-31', '2024-12-31', '2023-12-31']; }]) {
    const s = snapshot(); change(s);
    // Missing native evidence permits exact USD fallback; changed USD must still fail closed.
    if (!W.nativeIdentitaet(s, 'annualRev', 1)) s.annual.annualRev[0].value *= 1.03;
    assert.equal(known(W, scan(s).funde[0], migrated), false);
  }
  const usd = snapshot(); usd.meta.reportingCurrencyOriginal = 'USD';
  usd.meta.statementPeriods.annualRev.forEach(p => { p.currency = 'USD'; });
  const usdScan = scan(usd), usdBase = migriereIdentitaeten(baseline(usdScan), usdScan, '2026-10-10').baseline;
  usd.meta.fxRateApplied = 2; usd.annual.annualRev.forEach(p => { p.value *= 2; });
  assert.equal(known(W, scan(usd).funde[0], usdBase), false, 'USD to USD cannot manufacture FX drift');
  for (const ticker of ['KINV-A.ST', 'MFSL.BO', 'VPLAY-A.ST']) {
    const s = snapshot(ticker);
    if (ticker === 'VPLAY-A.ST') {
      s.annual.annualOpInc = s.annual.annualRev;
      s.meta.statementPeriods.annualOpInc = s.meta.statementPeriods.annualRev;
      delete s.annual.annualRev;
    }
    const data = scan(s), b = baseline(data);
    assert.equal(known(W, data.funde[0], b), false);
    assert.deepEqual(migriereIdentitaeten(b, data, '2026-10-10').baseline, b);
  }
});

test('migration rejects non-uniform triples, USD revisions, changed computed margins and ambiguous years', () => {
  const nonUniform = snapshot('KNOWN', 1.03); nonUniform.annual.annualRev[0].value *= 1.02;
  assert.deepEqual(migriereIdentitaeten(old, scan(nonUniform), '2026-10-10').baseline, old);
  const dollar = snapshot('KNOWN', 1.03); dollar.meta.reportingCurrencyOriginal = 'USD';
  dollar.meta.statementPeriods.annualRev.forEach(p => { p.currency = 'USD'; });
  assert.deepEqual(migriereIdentitaeten(old, scan(dollar), '2026-10-10').baseline, old);
  const company = snapshot();
  company.meta.opIncSource = 'computed-margin';
  company.meta.statementPeriods.annualOpInc = company.meta.statementPeriods.annualRev;
  company.annual.annualOpInc = company.annual.annualRev.map(p => ({ value: p.value * 0.6 }));
  const initial = scan(company), b = baseline(initial);
  const pureFx = structuredClone(company);
  pureFx.meta.fxRateApplied = 1.03;
  for (const series of Object.values(pureFx.annual)) series.forEach(p => { p.value *= 1.03; });
  assert.equal(migriereIdentitaeten(b, scan(pureFx), '2026-10-10').baseline.nativeIdentitaeten.length, 2);
  company.annual.annualOpInc.forEach(p => { p.value *= 1.004; });
  const result = migriereIdentitaeten(b, scan(company), '2026-10-10').baseline;
  assert.equal(result.nativeIdentitaeten.length, 1);
  assert.equal(result.nativeIdentitaeten[0].reihe, 'annualRev');
  const duplicate = { ...original, funde: [original.funde[0], { ...original.funde[0], index: 3,
    nativ: { ...original.funde[0].nativ, periode: '2020-12-31' } }] };
  assert.deepEqual(migriereIdentitaeten(old, duplicate, '2026-10-10').baseline, old);
});

test('native baseline validation and exclusion monitoring fail closed', () => {
  const entry = migrated.nativeIdentitaeten[0];
  for (const invalid of [null, [entry, entry], [{ ...entry, schluessel: 'UNKNOWN|annualRev|1' }],
    [{ ...entry, nativ: { ...entry.nativ, werte: [0, null, 0] } }],
    ...[['fxRateApplied', 0], ['fxRateApplied', -1], ['usdFaktor', -1], ['maxRelativeAbweichung', 0.5],
      ['datenstand', '2026-99-99']].map(([field, value]) => [{ ...entry, [field]: value }])]) {
    assert.equal(W.basisGueltig({ ...migrated, nativeIdentitaeten: invalid }, 1).ok, false);
  }
  const orphan = { ...migrated }; delete orphan.faelle;
  assert.equal(W.basisGueltig(orphan, 1).ok, false, 'native entries cannot outlive their old keys');
  assert.deepEqual(W.sperrenOhneWirkung([{ sperrschluessel: W.sperrSchluessel(moved) }],
    [moved], new Set(migrated.faelle), migrated.nativeIdentitaeten), ['KNOWN|annualRev|1']);
  assert.throws(() => W.baueNeuenBestand(migrated, [moved], 1), /Nativer Bestand/);
  const suppressed = { ...old, ausgeschlossen: [{ schluessel: old.faelle[0], sperrschluessel: 'KNOWN|annualRev|1',
    seit: '2026-10-10', offenSeit: '2026-10-10', hinweis: 'Test exclusion' }] };
  assert.throws(() => migriereIdentitaeten(suppressed, original, '2026-10-10'), /widerspricht sich/);
});

test('main without a directory option still checks the repository snapshots path', () => {
  const exists = fs.existsSync, error = console.error;
  const calls = [];
  fs.existsSync = p => { calls.push(p); return false; };
  console.error = () => {};
  try {
    assert.equal(W.main(new Date('2026-10-11T12:00:00Z'), W.MELDEND_BIS), 1);
    assert.deepEqual(calls, [path.join(ROOT, 'snapshots')]);
  } finally { fs.existsSync = exists; console.error = error; }
});

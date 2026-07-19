'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const familiesApi = require('../scripts/rank-ic-families.js');
const ric = require('../scripts/rank-ic.js');

const REPO_ROOT = path.resolve(__dirname, '..');
const PROD_REGISTRY = path.join(REPO_ROOT, 'protocol', 'rank-ic-families');
const PROD_G1 = path.join(PROD_REGISTRY, 'g1.json');
const G1_HASH = 'sha256:5e8400500e6cab05a42a5a3c69175845528e03707837b0e5397ccb946d228a67';

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + ((e && e.stack) || e)); }
}
function withTemp(tag, fn) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), tag));
  try { return fn(tmp); } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}
const addDays = (iso, n) => {
  const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10);
};
function methodContract() {
  return {
    protocolVersion: 'rank-ic-confirmatory-v1',
    horizonsDays: [28, 84],
    decisionHorizonDays: 84,
    testDefinition: '28d=max(raw,residual)-IUT; 84d=max(raw,residual)-IUT; underpowered=1',
    correction: { method: 'benjamini-yekutieli', q: 0.10 },
    minimumNeff: 8,
    ciLevel: 0.90,
    bootstrapIterations: 10000,
    bootstrapBlockLength: 2,
    threshold28: 0.03,
    threshold84: 0.05,
  };
}
function manifest(boards, overrides = {}) {
  const generation = overrides.generation || 1;
  const m = {
    schemaVersion: 1,
    familyId: overrides.familyId || 'rank-ic-test-g' + generation,
    generation,
    hypothesisId: overrides.hypothesisId || 'rank-ic-test-hypothesis-g' + generation,
    artifactCreatedAt: overrides.artifactCreatedAt || '2026-01-01',
    provenance: overrides.provenance || {
      registration: { specifiedAt: '2025-12-01', confirmedAt: '2025-12-02', source: 'fixture registration' },
      thresholdFreeze: { frozenAt: '2025-12-03', source: 'fixture threshold freeze' },
    },
    firstEligibleVintage: overrides.firstEligibleVintage || '2026-01-01',
    methodContract: overrides.methodContract || methodContract(),
    boards: boards.slice(),
  };
  m.payloadHash = familiesApi.computePayloadHash(m);
  return m;
}
function writeManifest(dir, m, filename = 'g' + m.generation + '.json') {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, filename), JSON.stringify(m, null, 2));
}
function writeBoard(historyDir, date, board, rows = []) {
  const dir = path.join(historyDir, date);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, board + '.json'), JSON.stringify({
    date, board, cohort: { profitable: rows, unprofitable: [] },
  }));
}
function mkSeries(t0, days, start, drift) {
  const m = new Map();
  for (let i = 0; i <= days; i++) m.set(addDays(t0, i), start * (1 + drift * i));
  return m;
}
const slotsOf = (report, generation = 1) => report.families.find((f) => f.generation === generation).slots;
const slotOf = (report, board, horizon, generation = 1) => slotsOf(report, generation)
  .find((s) => s.board === board && s.horizon === horizon);

test('T1 Produktionsanker: G1 ist gehasht, final und umfasst 14 Boards x 2 Horizonte', () => {
  const raw = JSON.parse(fs.readFileSync(PROD_G1, 'utf8'));
  const loaded = familiesApi.loadFamiliesOrThrow(PROD_REGISTRY);
  assert.equal(loaded.length, 1);
  assert.ok(Object.isFrozen(loaded) && Object.isFrozen(loaded[0]) && Object.isFrozen(loaded[0].methodContract));
  assert.equal(raw.payloadHash, G1_HASH, 'unabhaengiger Literal-Anker');
  assert.equal(familiesApi.computePayloadHash(raw), G1_HASH, 'Selbst-Hash');
  assert.equal(new Set(raw.boards).size, 14);
  assert.equal(raw.boards.length * raw.methodContract.horizonsDays.length, 28);
  assert.ok(!JSON.stringify(raw).includes('COURT_PENDING'));
});

test('T1 COURT_PENDING wird auch bei passendem Selbst-Hash hart abgelehnt', () => withTemp('rankic-family-court-', (tmp) => {
  const m = manifest(['a']);
  m.methodContract.testDefinition = 'COURT_PENDING';
  m.payloadHash = familiesApi.computePayloadHash(m);
  writeManifest(tmp, m);
  assert.throws(() => familiesApi.loadFamiliesOrThrow(tmp), /COURT_PENDING/);
}));

test('T2 Loader-Haertung: Tamper, Hash, Duplikate, Sortierung, Felder und Datumsfolge scheitern', () => {
  const cases = [
    ['manipulierter Inhalt', (m) => { m.boards[0] = 'z'; }, /payloadHash/],
    ['falscher Hash', (m) => { m.payloadHash = 'sha256:' + '0'.repeat(64); }, /payloadHash/],
    ['doppeltes Board', (m) => { m.boards = ['a', 'a']; m.payloadHash = familiesApi.computePayloadHash(m); }, /doppelt|eindeutig/i],
    ['unsortierte Boards', (m) => { m.boards = ['b', 'a']; m.payloadHash = familiesApi.computePayloadHash(m); }, /sortiert/i],
    ['unsortierte Horizonte', (m) => { m.methodContract.horizonsDays = [84, 28]; m.payloadHash = familiesApi.computePayloadHash(m); }, /sortiert|methodContract/i],
    ['unbekanntes Feld', (m) => { m.unbekannt = true; m.payloadHash = familiesApi.computePayloadHash(m); }, /unbekannt/i],
    ['ungueltige Datumsfolge', (m) => { m.provenance.registration.confirmedAt = m.firstEligibleVintage; m.payloadHash = familiesApi.computePayloadHash(m); }, /specifiedAt|confirmedAt|firstEligibleVintage/],
    ['abweichender Methodenvertrag', (m) => { m.methodContract.threshold28 = 0.04; m.payloadHash = familiesApi.computePayloadHash(m); }, /methodContract/],
  ];
  for (const [name, mutate, expected] of cases) withTemp('rankic-family-invalid-', (tmp) => {
    const m = manifest(['a', 'b']); mutate(m); writeManifest(tmp, m);
    assert.throws(() => familiesApi.loadFamiliesOrThrow(tmp), expected, name);
  });
});

test('T2 Loader-Haertung: Generation, familyId und hypothesisId sind registryweit eindeutig', () => {
  const cases = [
    ['generation', (a, b) => { b.generation = a.generation; }],
    ['familyId', (a, b) => { b.familyId = a.familyId; }],
    ['hypothesisId', (a, b) => { b.hypothesisId = a.hypothesisId; }],
  ];
  for (const [label, mutate] of cases) withTemp('rankic-family-duplicate-', (tmp) => {
    const a = manifest(['a']);
    const b = manifest(['b'], { generation: 2, firstEligibleVintage: '2026-02-01' });
    mutate(a, b); b.payloadHash = familiesApi.computePayloadHash(b);
    writeManifest(tmp, a, 'g1.json'); writeManifest(tmp, b, 'g2.json');
    assert.throws(() => familiesApi.loadFamiliesOrThrow(tmp), new RegExp(label, 'i'));
  });
});

test('T3 leere Registry: fehlend, leer oder ohne Manifest fuehrt zum harten Abbruch', () => withTemp('rankic-family-empty-', (tmp) => {
  assert.throws(() => familiesApi.loadFamiliesOrThrow(path.join(tmp, 'fehlt')), /fehlt|Verzeichnis/i);
  const empty = path.join(tmp, 'empty'); fs.mkdirSync(empty);
  assert.throws(() => familiesApi.loadFamiliesOrThrow(empty), /keine.*Manifest|leer/i);
  fs.writeFileSync(path.join(empty, 'README.txt'), 'kein Manifest');
  assert.throws(() => familiesApi.loadFamiliesOrThrow(empty), /keine.*Manifest|leer/i);
}));

test('T4 Produktionsverdrahtung/F5-1: main persistiert den Hash des echten G1 ohne Familien-Override', () => withTemp('rankic-family-main-', (tmp) => {
  const hist = path.join(tmp, 'history'); fs.mkdirSync(hist);
  const out = path.join(tmp, 'report.json');
  const independentlyRead = JSON.parse(fs.readFileSync(PROD_G1, 'utf8'));
  const report = ric.main({ historyDir: hist, outFile: out, priceIndex: { SPY: mkSeries('2026-01-01', 2, 100, 0) } });
  const persisted = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.equal(report.families[0].payloadHash, independentlyRead.payloadHash);
  assert.equal(persisted.families[0].payloadHash, independentlyRead.payloadHash);
}));

test('T5 Totalausfall: keine oder global ausgeschlossene Vintages behalten alle Slots mit p=1', () => {
  const fam = manifest(['a', 'b', 'c']);
  withTemp('rankic-family-nodata-', (hist) => {
    const report = ric.evaluate(hist, {}, { families: [fam] });
    assert.equal(report.family.length, 6);
    assert.ok(report.family.every((s) => s.p === 1 && s.bySignificant === false));
    assert.ok(slotsOf(report).every((s) => s.status === 'NO_ELIGIBLE_VINTAGE'));
    assert.ok(report.familyHealth.warnings.length > 0);
  });
  withTemp('rankic-family-excluded-', (hist) => {
    const date = '2026-01-02';
    for (const board of fam.boards) writeBoard(hist, date, board);
    fs.writeFileSync(path.join(hist, '_excluded.json'), JSON.stringify({ [date]: 'global excluded' }));
    const report = ric.evaluate(hist, {}, { families: [fam] });
    assert.equal(report.family.length, 6);
    assert.ok(report.family.every((s) => s.p === 1 && !s.bySignificant));
    assert.ok(slotsOf(report).every((s) => s.status === 'EXCLUDED_ALL'));
    assert.ok(report.familyHealth.exclusions.length > 0);
  });
});

test('T6 Voll-Roster: drei Boards ergeben sechs sortierte Slots und getrennte Provenienz', () => withTemp('rankic-family-roster-', (hist) => {
  const fam = manifest(['a', 'b', 'c']);
  for (const board of fam.boards) writeBoard(hist, '2026-01-02', board);
  const report = ric.evaluate(hist, {}, { families: [fam], newestGlobal: '2026-01-03' });
  assert.deepEqual(slotsOf(report).map((s) => [s.board, s.horizon]), [
    ['a', 28], ['a', 84], ['b', 28], ['b', 84], ['c', 28], ['c', 84],
  ]);
  assert.deepEqual(report.families[0].provenance.registration, fam.provenance.registration);
  assert.deepEqual(report.families[0].provenance.thresholdFreeze, fam.provenance.thresholdFreeze);
}));

test('T7 BY-Grenze: p=0,009 ist bei vier Slots signifikant, bei sechs Slots nicht', () => {
  const slots4 = [0.009, 1, 1, 1].map((p, i) => ({ board: 'b' + i, horizon: 28, p }));
  const slots6 = [0.009, 1, 1, 1, 1, 1].map((p, i) => ({ board: 'b' + i, horizon: 28, p }));
  assert.equal(ric.applyFamilyBY(slots4, 0.10)[0].bySignificant, true);
  assert.equal(ric.applyFamilyBY(slots6, 0.10)[0].bySignificant, false);
});

test('T7 Wegfall: verschwundenes Board bleibt als zwei p=1-Slots in der Sechserfamilie', () => withTemp('rankic-family-missing-', (hist) => {
  const fam = manifest(['a', 'b', 'c']);
  writeBoard(hist, '2026-01-02', 'a'); writeBoard(hist, '2026-01-02', 'b');
  const report = ric.evaluate(hist, {}, { families: [fam], newestGlobal: '2026-12-31' });
  assert.equal(report.family.length, 6);
  assert.deepEqual(slotsOf(report).filter((s) => s.board === 'c').map((s) => [s.status, s.p]), [
    ['MISSING_ON_DISK', 1], ['MISSING_ON_DISK', 1],
  ]);
}));

test('T8 Zuwachs: unregistriertes Board bleibt beobachtend und veraendert G1 bytegleich nicht', () => withTemp('rankic-family-growth-', (hist) => {
  const fam = manifest(['a', 'b', 'c']); const date = '2026-01-02';
  for (const board of fam.boards) writeBoard(hist, date, board);
  const before = ric.evaluate(hist, {}, { families: [fam], newestGlobal: '2026-12-31' });
  writeBoard(hist, date, 'd-new');
  const after = ric.evaluate(hist, {}, { families: [fam], newestGlobal: '2026-12-31' });
  assert.ok(after.boards['d-new']);
  assert.deepEqual(after.unregisteredBoards, [{ board: 'd-new', status: 'UNREGISTERED_OBSERVATIONAL' }]);
  assert.ok(!slotsOf(after).some((s) => s.board === 'd-new'));
  assert.equal(JSON.stringify(after.families[0]), JSON.stringify(before.families[0]));
}));

test('T9 Anti-Peeking: G2 ignoriert Vintages vor firstEligibleVintage und G1 bleibt bytegleich', () => {
  const g1 = manifest(['a']);
  const g2 = manifest(['d-new'], { generation: 2, firstEligibleVintage: '2026-04-01' });
  const run = (earlyScore) => withTemp('rankic-family-g2-', (hist) => {
    const rowsEarly = Array.from({ length: 12 }, (_, i) => ({ ticker: 'T' + i, score: earlyScore * i, pit: {} }));
    const rowsLate = Array.from({ length: 12 }, (_, i) => ({ ticker: 'T' + i, score: i, pit: {} }));
    writeBoard(hist, '2026-01-02', 'a', rowsEarly); writeBoard(hist, '2026-01-02', 'd-new', rowsEarly);
    writeBoard(hist, '2026-04-02', 'a', rowsLate); writeBoard(hist, '2026-04-02', 'd-new', rowsLate);
    return ric.evaluate(hist, {}, { families: [g1, g2], newestGlobal: '2026-12-31' });
  });
  const a = run(1), b = run(-1);
  assert.equal(JSON.stringify(a.families[1]), JSON.stringify(b.families[1]));
  const g1Only = withTemp('rankic-family-g1-only-', (hist) => {
    writeBoard(hist, '2026-01-02', 'a'); writeBoard(hist, '2026-04-02', 'a');
    return ric.evaluate(hist, {}, { families: [g1], newestGlobal: '2026-12-31' });
  });
  const sameG1Data = withTemp('rankic-family-g1-plus-g2-', (hist) => {
    writeBoard(hist, '2026-01-02', 'a'); writeBoard(hist, '2026-04-02', 'a');
    return ric.evaluate(hist, {}, { families: [g1, g2], newestGlobal: '2026-12-31' });
  });
  assert.equal(JSON.stringify(g1Only.families[0]), JSON.stringify(sameG1Data.families[0]));
});

test('T10 Statusdifferenzierung: missing, excluded, pending und underpowered bleiben p=1', () => withTemp('rankic-family-status-', (hist) => {
  const fam = manifest(['excluded', 'missing', 'pending', 'underpowered']);
  const rows = Array.from({ length: 12 }, (_, i) => ({ ticker: 'T' + i, score: i, pit: {} }));
  writeBoard(hist, '2026-01-02', 'excluded', rows);
  writeBoard(hist, '2026-01-02', 'underpowered', rows);
  writeBoard(hist, '2026-12-01', 'pending', rows);
  fs.writeFileSync(path.join(hist, '_excluded.json'), JSON.stringify({
    excluded: [{ date: '2026-01-02', board: 'excluded', reason: 'fixture' }],
  }));
  const report = ric.evaluate(hist, {}, { families: [fam], newestGlobal: '2026-06-01' });
  assert.equal(slotOf(report, 'missing', 28).status, 'MISSING_ON_DISK');
  assert.equal(slotOf(report, 'excluded', 28).status, 'EXCLUDED_ALL');
  assert.equal(slotOf(report, 'pending', 28).status, 'WINDOW_PENDING');
  assert.equal(slotOf(report, 'underpowered', 28).status, 'UNDERPOWERED');
  assert.ok(slotsOf(report).every((s) => s.status === 'MEASURED' || s.p === 1));
}));

test('T11 Rename-Warnung: fehlendes registriertes plus unregistriertes Board ergibt reine UND-Warnung', () => withTemp('rankic-family-rename-', (hist) => {
  const fam = manifest(['old-name']);
  writeBoard(hist, '2026-01-02', 'new-name');
  const report = ric.evaluate(hist, {}, { families: [fam], newestGlobal: '2026-12-31' });
  assert.ok(report.familyHealth.renameWarnings.some((w) => w.code === 'POSSIBLE_BOARD_RENAME'));
  assert.ok(!JSON.stringify(report.familyHealth.renameWarnings).includes('similarity'));
  assert.ok(!JSON.stringify(report.familyHealth.renameWarnings).includes('candidate'));
}));

test('T12 Reportvertrag v2: Alias, Wartehinweis, Generationen und Hashfelder sind eindeutig', () => withTemp('rankic-family-contract-', (hist) => {
  const g1 = manifest(['a']);
  const g2 = manifest(['b'], { generation: 2, firstEligibleVintage: '2026-04-01' });
  const report = ric.evaluate(hist, {}, { families: [g1, g2] });
  assert.equal(report.schemaVersion, 2);
  assert.ok(Array.isArray(report.family));
  assert.ok(report.familyNote);
  assert.equal(report.family.length, 2, 'family ist ausschliesslich der flache G1-Alias');
  assert.deepEqual(Object.keys(report.family[0]).sort(), ['board', 'bySignificant', 'horizon', 'p']);
  assert.deepEqual(report.families.map((f) => f.generation), [1, 2]);
  assert.deepEqual(report.families.map((f) => f.payloadHash), [g1.payloadHash, g2.payloadHash]);
  assert.ok(!Object.hasOwn(report, 'familyRegistryStatus'));
}));

test('T13 Lesart A: rohe Power ohne Residual-Power bleibt auch bei 28d p=1 und nicht LIVE', () => withTemp('rankic-family-iut-', (hist) => {
  const fam = manifest(['a']); const t0 = '2026-01-02'; const V = 8;
  const rows = Array.from({ length: 12 }, (_, i) => ({ ticker: 'T' + i, score: i, pit: {} }));
  const priceIndex = { SPY: mkSeries(t0, V * 28 + 100, 500, 0.0001) };
  for (let i = 0; i < rows.length; i++) priceIndex[rows[i].ticker] = mkSeries(t0, V * 28 + 100, 100, 0.0001 * (i + 1));
  for (let v = 0; v < V; v++) writeBoard(hist, addDays(t0, v * 28), 'a', rows);
  const report = ric.evaluate(hist, priceIndex, { families: [fam], B: 100, newestGlobal: addDays(t0, V * 28 + 90) });
  const slot = slotOf(report, 'a', 28);
  assert.equal(report.boards.a.horizons[28].nPoints, 8, 'Raw-Seite ist gepowert');
  assert.equal(report.boards.a.horizons[28].meanICResid, null, 'Residual-Seite ist ungepowert');
  assert.equal(slot.p, 1);
  assert.equal(slot.status, 'UNDERPOWERED');
  assert.ok(!report.boards.a.horizons[28].verdict.includes('LIVE-Kriterium'));
}));

console.log(`\nrank-ic-families.test.js: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);

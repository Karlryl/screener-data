'use strict';
/**
 * Kreuzerl-Bau 10.08. — Rot-zuerst gegen den unveraenderten HEAD: vier stille
 * Messfehler muessen beobachtbar werden, ohne bestehende Scoring-Gates anzufassen.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ric = require('../scripts/rank-ic.js');
const wfp = require('../scripts/walk-forward-perf.js');
const { k2Slope } = require('../scripts/qc-rho-k2.js');

let pass = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + (e && e.stack || e)); }
}
const map = (startYear, count, start = 100) => {
  const out = new Map();
  for (let i = 0; i < count; i++) {
    const d = new Date(Date.UTC(startYear, 0, 1 + i));
    out.set(d.toISOString().slice(0, 10), start + i);
  }
  return out;
};
const family = (board) => ({
  familyId: 'test-family', generation: 1, hypothesisId: 'test', artifactCreatedAt: '2026-01-01',
  firstEligibleVintage: '2020-01-01', provenance: {}, payloadHash: 'test', boards: [board],
  methodContract: { horizonsDays: [28, 84], correction: { q: 0.10 } },
});
const writeVintage = (root, date, board, extra = {}) => {
  fs.mkdirSync(path.join(root, date), { recursive: true });
  fs.writeFileSync(path.join(root, date, board + '.json'), JSON.stringify(Object.assign({
    date, board, cohort: { profitable: [], unprofitable: [] },
  }, extra)));
};
const captureWarn = (fn) => {
  const lines = [], orig = console.warn;
  console.warn = (...a) => lines.push(a.join(' '));
  try { fn(); } finally { console.warn = orig; }
  return lines;
};

(async () => {
  await test('F-CGPT-042: Existenzpfad bleibt tolerant, erst Delivery-Konsum wirft', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kreuzerl-pit-'));
    try {
      const board = 'b1', d0 = '2020-01-01', d1 = '2020-07-01';
      writeVintage(tmp, d0, board, { compacted: true, archivedTo: 'board-history-archive/fehlt/b1.json' });
      writeVintage(tmp, d1, board);
      const v = ric.loadVintage(tmp, d0, board);
      assert.ok(v && v.cohort, 'loadVintage/boardsOf-artiger Existenzcheck darf nicht werfen');
      assert.throws(() => ric.evaluate(tmp, {}, { families: [family(board)], newestGlobal: '2030-01-01', B: 10 }),
        /Vollarchiv .* fehlt\/kaputt — Delivery-IC ohne PIT-Daten nicht messbar \(F-CGPT-042\)/);
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  });

  await test('R1-SC-007: nicht vorhandener Board-Tag sperrt keinen Entscheidungspunkt', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kreuzerl-dates-'));
    try {
      const board = 'b1';
      writeVintage(tmp, '2020-01-01', board);
      fs.mkdirSync(path.join(tmp, '2020-01-30'), { recursive: true });
      fs.writeFileSync(path.join(tmp, '2020-01-30', 'calibration.json'), JSON.stringify({ calibration: true }));
      writeVintage(tmp, '2020-02-01', board);
      const report = ric.evaluate(tmp, {}, { families: [family(board)], newestGlobal: '2030-01-01', B: 10 });
      assert.deepEqual(report.boards[board].horizons['28'].decisions.map((d) => d.date), ['2020-01-01', '2020-02-01']);
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  });

  await test('AY-SCR-001: passende kurze Serie schlaegt lange zeitfremde Serie', () => {
    const result = wfp.computeBenchmarkReturn({ SPY: map(2015, 200), QQQ: map(2026, 45) }, '2026-01-02', 28);
    assert.equal(result.ticker, 'QQQ');
    assert.ok(result.entryDate && result.exitDate);
  });

  await test('AY-SCR-001: ohne Fensterabdeckung bleibt insufficient samt SPY-priorisiertem Label', () => {
    const result = wfp.computeBenchmarkReturn({ SPY: map(2015, 200), QQQ: map(2016, 20) }, '2026-01-02', 28);
    assert.equal(result.ticker, 'SPY');
    assert.equal(result.benchmarkInsufficient, true);
    assert.equal(result.entryDate, null);
    // Nachzug: das Label ist der ERSTE vorhandene Kandidat (SPY-Prioritaet, konsistent mit dem
    // rank-ic-Anker) — nicht die laengste Serie. Sonst wandert das Label ohne Messgrund.
    const laengsteIstQQQ = wfp.computeBenchmarkReturn({ SPY: map(2016, 30), QQQ: map(2016, 200) }, '2026-01-02', 28);
    assert.equal(laengsteIstQQQ.ticker, 'SPY');
    assert.equal(laengsteIstQQQ.benchmarkInsufficient, true);
  });

  await test('AY-SCR-001: SPY gewinnt bei gleicher Fensterqualifikation', () => {
    const result = wfp.computeBenchmarkReturn({ SPY: map(2026, 45), QQQ: map(2026, 60) }, '2026-01-02', 28);
    assert.equal(result.ticker, 'SPY');
  });

  await test('AY-SCR-001-Nachzug: duenne Serie ankert kein Fenster (Laengen-Gate)', () => {
    // 1-Punkt-Serie: entry und exit schnappen auf denselben Tag -> Null-Tage-Fenster mit ret 0,
    // ohne Laengen-Gate voellig lautlos.
    const einPunkt = wfp.computeBenchmarkReturn({ SPY: new Map([['2026-01-02', 100]]) }, '2026-01-02', 3);
    assert.equal(einPunkt.benchmarkInsufficient, true);
    assert.equal(einPunkt.entryDate, null);
    // 2-Punkt-Serie ueber ein echtes 28d-Fenster: genau das 2-3-Punkt-Alpha, das requiredLen
    // laut F-BT-002 verhindern soll.
    const zweiPunkte = wfp.computeBenchmarkReturn(
      { SPY: new Map([['2026-01-02', 100], ['2026-01-30', 110]]) }, '2026-01-02', 28);
    assert.equal(zweiPunkte.benchmarkInsufficient, true);
    assert.equal(zweiPunkte.entryDate, null);
  });

  await test('AY-SCR-001-Nachzug: Ticker-Wechsel-Warner nur fuer geankerte Horizonte', () => {
    const picks = () => ({ asOf: '2026-01-02T22:00:00Z', evaluatedTickers: [], modes: {} });
    const hat = (lines) => lines.filter((l) => l.includes('benchmark ticker differs across horizons')).length;
    // 7d ankert SPY (30 Punkte reichen fuer requiredLen 25), 28d/84d ankern QQQ -> echter Wechsel.
    assert.equal(hat(captureWarn(() => wfp.evaluateVintage(picks(), { SPY: map(2026, 30), QQQ: map(2026, 100) }, null))), 1);
    // Nur 7d ankert (QQQ); 28d/84d sind insufficient und tragen bloss das SPY-Label -> kein Wechsel.
    assert.equal(hat(captureWarn(() => wfp.evaluateVintage(picks(), { SPY: map(2015, 200), QQQ: map(2026, 30) }, null))), 0);
  });

  await test('F-CGPT-042-Nachzug: compacted ohne archivedTo wirft ebenfalls am Delivery-Konsum', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kreuzerl-pit-noarch-'));
    try {
      const board = 'b1', d0 = '2020-01-01', d1 = '2020-07-01';
      writeVintage(tmp, d0, board, { compacted: true });
      writeVintage(tmp, d1, board);
      assert.ok(ric.loadVintage(tmp, d0, board).cohort, 'Existenzpfad bleibt tolerant');
      assert.throws(() => ric.evaluate(tmp, {}, { families: [family(board)], newestGlobal: '2030-01-01', B: 10 }),
        /compacted ohne archivedTo/);
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  });

  await test('F-CGPT-042-Nachzug: vorhandenes Vollarchiv laeuft ohne Wurf durch den Delivery-Konsum', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kreuzerl-pit-ok-'));
    try {
      const board = 'b1', d0 = '2020-01-01', d1 = '2020-07-01';
      const archiveFile = path.join(tmp, 'archive-b1.json');
      fs.writeFileSync(archiveFile, JSON.stringify({ date: d0, board, cohort: { profitable: [], unprofitable: [] } }));
      // archivedTo ist repo-relativ (loadVintage joint gegen REPO_ROOT) — aus dem Tmp-Ordner heraus.
      const relToRepo = path.relative(path.resolve(__dirname, '..'), archiveFile).split(path.sep).join('/');
      writeVintage(tmp, d0, board, { compacted: true, archivedTo: relToRepo });
      writeVintage(tmp, d1, board);
      const report = ric.evaluate(tmp, {}, { families: [family(board)], newestGlobal: '2030-01-01', B: 10 });
      assert.equal(report.boards[board].delivery.t0, d0);
      assert.equal(report.boards[board].delivery.t1, d1);
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  });

  await test('BM-SK-002: FY-Luecke bleibt auf der echten Zeitachse', () => {
    const fy = (ni, ocf) => ({ annualNetIncome: ni.map(value => ({ value })), annualOCF: ocf.map(value => ({ value })) });
    const slope = k2Slope(fy([100, -50, 100, 100], [100, 999, 300, 400]));
    assert.ok(Math.abs(slope - 1) < 1e-12, 'erwartet 1 auf FY-Indizes 0,2,3; war ' + slope);
  });

  console.log(`\nKreuzerl-Messwerk: ${pass} bestanden, ${fail} fehlgeschlagen`);
  process.exit(fail ? 1 : 0);
})();

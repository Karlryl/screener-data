'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { snapshot } = require('./rule40-fixture');
const { neuestesQuartalsEnde, sammleKandidaten } = require('../scripts/write-rule40-export');
const axes = require('../src/scoring/axes');
test('an unusable old quarter cannot stale a valid newer-year growth candidate', () => {
  const s = snapshot({ revenueQ: [{ value: 100e6 }], revenueQEnds: ['2024-03-31'],
    annualRevEnds: ['2024-06-30', '2023-06-30', '2022-06-30'] });
  s.meta.annualRevNewerYear = { end: '2025-06-30', priorEnd: '2024-06-30', revenue: 640e6,
    priorRevenue: 400e6, priorStored: 400e6, source: 'quoteSummary', currency: 'USD' };
  assert.equal(axes.revQuartalsYoY(s), null);
  assert.equal(neuestesQuartalsEnde(s), Date.parse('2025-06-30'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p51-401-'));
  const v1Dir = path.join(dir, 'v1'), snapshotsDir = path.join(dir, 'snapshots');
  fs.mkdirSync(path.join(v1Dir, 'full'), { recursive: true }); fs.mkdirSync(snapshotsDir);
  fs.writeFileSync(path.join(v1Dir, 'index.json'), JSON.stringify({ schema: 'findash-export/v1', generated_at: '2026-10-03T09:31:17.258Z', branches: ['software-comm-services'] }));
  fs.writeFileSync(path.join(v1Dir, 'full/software-comm-services.json'), JSON.stringify({ profitable: [], unprofitable: [] }));
  for (const partial of [true, false]) {
    const input = structuredClone(s); if (!partial) input.timeseries = {};
    fs.writeFileSync(path.join(snapshotsDir, 'AAA.json'), JSON.stringify(input));
    const result = sammleKandidaten({ v1Dir, snapshotsDir });
    assert.equal(result.kandidaten.length, 1); assert.equal(result.abgewiesen.veraltet, 0);
  }
  const quarter = snapshot(); quarter.meta.annualRevNewerYear = s.meta.annualRevNewerYear;
  assert.equal(neuestesQuartalsEnde(quarter), Date.parse('2026-06-30'), 'usable quarterly comparison retains priority');
  delete s.meta.annualRevNewerYear;
  assert.equal(neuestesQuartalsEnde(s), Date.parse('2024-03-31'), 'ordinary fallback is unchanged');
});

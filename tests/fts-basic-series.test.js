'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  _mapFTSAnnualShares,
  _readFTSAnnualSharesFromCache,
  _writeFTSCache,
} = require('../pull-yahoo.js');

let fail = 0;
function check(name, fn) {
  try { fn(); console.log(`  ok   ${name}`); }
  catch (e) { fail++; console.log(`  FAIL ${name}: ${e.message}`); }
}

check('frischer FTS-Cache speichert die rohe basicAverageShares-Reihe slotgenau', () => {
  // Yahoo FTS liefert aeltestes Jahr zuerst; die Cache-Reihen sind newest-first.
  const annualFin = [
    { dilutedAverageShares: 100, basicAverageShares: 90 },
    { dilutedAverageShares: 210 },
    { dilutedAverageShares: 320, basicAverageShares: 275 },
  ];
  const shares = _mapFTSAnnualShares(annualFin, []);

  // Regression: die aufgeloeste Bestandsreihe bleibt byte-identisch.
  assert.strictEqual(JSON.stringify(shares.ftsAnnualShares), '[320,210,100]');
  // Neu: keinerlei diluted-/Balance-Fallback in der Rohreihe; Absenz bleibt null.
  assert.deepStrictEqual(shares.ftsAnnualSharesBasic, [275, null, 90]);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fts-basic-series-'));
  const cachePath = path.join(dir, 'SYNTH.json');
  try {
    _writeFTSCache(cachePath, 2, false, shares);
    const cached = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    assert.deepStrictEqual(cached.payload.ftsAnnualSharesBasic, [275, null, 90]);
    assert.strictEqual(JSON.stringify(cached.payload.ftsAnnualShares), '[320,210,100]');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

check('Cache v2 ohne basic-Feld bleibt lesbar und liefert eine leere Zusatzreihe', () => {
  const legacyCache = {
    _cacheVersion: 2,
    payload: { ftsAnnualShares: [320, 210, 100] },
  };
  assert.deepStrictEqual(_readFTSAnnualSharesFromCache(legacyCache), {
    ftsAnnualShares: [320, 210, 100],
    ftsAnnualSharesBasic: [],
  });
});

console.log(fail === 0 ? '\nFTS basic series: ALL PASS' : `\nFTS basic series: ${fail} FAIL`);
process.exit(fail ? 1 : 0);

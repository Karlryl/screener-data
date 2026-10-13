'use strict';
/**
 * b14-discovery — Test-Gate fuer BH-060/BH-063/BH-064/BH-065 (discovery/*.js).
 * ==============================================================================
 * Deckt die logiktragenden Fixes des Batches ab, die ohne Netzzugriff pruefbar
 * sind (hermetisch, reine Funktionen/Regexe):
 *   - BH-063 (tsx-ca.js):     Preferred/CPC/Warrant/Right-Suffix-Filter droppt
 *                             Nicht-Common, laesst Dual-Class-Common (.A/.B) durch.
 *   - BH-064 (nasdaq-all.js): isJunkSecurity droppt keine echten ADR/ADS-Common-
 *                             Zeilen mehr, faengt aber weiter echte Preferred-
 *                             Depositary-Shares (ueber \bpreferred\b).
 *   - BH-065 (tv-scanner.js): serverFloor() folgt MIN_USD_PRECUT/TV_PRECUT_USD
 *                             statt eines hartkodierten 1.5e9-Literals.
 *   - BH-060 (tv-scanner.js): runPooled() haelt Reihenfolge + Concurrency-Deckel
 *                             ein (Ersatz fuer den ungebremsten Promise.all-Burst).
 * BH-058/BH-059/BH-062 sind reine Zaehler/Vergleichs-Ergaenzungen in bereits
 * console.warn-gegateten Pfaden (kein neuer Verzweigungslogik-Bug) und live-
 * Netzwerk-only — kein separater hermetischer Test noetig.
 *
 * Usage:  node tests/scoring/bh-b14-discovery.test.js   (Exit 0/1)
 */
const assert = require('node:assert/strict');

let pass = 0, fail = 0;
async function test(name, fn) {
  try {
    await fn();
    pass++;
    console.log('  ok   ' + name);
  } catch (e) {
    fail++;
    console.error('FAIL   ' + name + '\n       ' + e.stack);
  }
}

(async () => {
  // ---------------------------------------------------------------------------
  // BH-063: tsx-ca.js NON_COMMON_SUFFIX_RE
  // ---------------------------------------------------------------------------
  const { NON_COMMON_SUFFIX_RE } = require('../../discovery/tsx-ca.js');

  await test('BH-063: Preferred/CPC/Warrant/Right-Suffixe werden erkannt', () => {
    assert.ok(NON_COMMON_SUFFIX_RE.test('FIVD.P'), 'CPC .P muss matchen');
    assert.ok(NON_COMMON_SUFFIX_RE.test('XYZ.PR'), 'Preferred .PR muss matchen');
    assert.ok(NON_COMMON_SUFFIX_RE.test('BAM.PR.B'), 'Preferred-Serie .PR.B muss matchen');
    assert.ok(NON_COMMON_SUFFIX_RE.test('ABC.PF'), 'Preferred .PF muss matchen');
    assert.ok(NON_COMMON_SUFFIX_RE.test('RUS.WT'), 'Warrant .WT muss matchen');
    assert.ok(NON_COMMON_SUFFIX_RE.test('DEF.RT'), 'Right .RT muss matchen');
  });

  await test('BH-063: Dual-Class-Common (.A/.B) und plain Ticker bleiben unberuehrt', () => {
    assert.ok(!NON_COMMON_SUFFIX_RE.test('BBD.B'), 'Dual-Class .B darf NICHT matchen');
    assert.ok(!NON_COMMON_SUFFIX_RE.test('TECK.A'), 'Dual-Class .A darf NICHT matchen');
    assert.ok(!NON_COMMON_SUFFIX_RE.test('SHOP'), 'plain Ticker darf NICHT matchen');
  });

  // ---------------------------------------------------------------------------
  // BH-064: nasdaq-all.js isJunkSecurity
  // ---------------------------------------------------------------------------
  const { isJunkSecurity } = require('../../discovery/nasdaq-all.js');

  await test('BH-064: echte ADR/ADS-Common-Zeilen sind NICHT mehr junk (Regressionsfix)', () => {
    assert.equal(
      isJunkSecurity('BABA', 'Alibaba Group Holding Limited American Depositary Shares'),
      false,
      'ADS-Common muss durchgelassen werden'
    );
    assert.equal(
      isJunkSecurity('PDD', 'PDD Holdings Inc. American Depositary Shares each representing four Class A Ordinary Shares'),
      false
    );
  });

  await test('BH-064: echte Preferred-Depositary-Shares bleiben junk (via \\bpreferred\\b)', () => {
    assert.equal(
      isJunkSecurity('XYZPRA', 'JPMorgan Chase & Co Depositary Shares each representing a 1/400th Interest in a share of 4.55% Non-Cumulative Preferred Stock Series KK'),
      true
    );
  });

  await test('BH-064: Warrant/Right-Namen bleiben junk (Regression)', () => {
    assert.equal(isJunkSecurity('ABC', 'Some Company Warrant'), true);
    assert.equal(isJunkSecurity('ABC', 'Some Company Rights'), true);
    assert.equal(isJunkSecurity('ABC.WS', 'Some Company Common Stock'), true, 'Suffix-Filter greift weiterhin');
  });

  // ---------------------------------------------------------------------------
  // BH-065: tv-scanner.js serverFloor() folgt MIN_USD_PRECUT statt 1.5e9-Literal
  // ---------------------------------------------------------------------------
  // MIN_USD_PRECUT wird beim require() aus process.env.TV_PRECUT_USD gelesen ->
  // Modul-Cache leeren und mit gesetztem Env neu laden, um beide Faelle zu pruefen.
  const TV_SCANNER_PATH = require.resolve('../../discovery/tv-scanner.js');
  function loadTvScannerWithEnv(precutUsd) {
    delete require.cache[TV_SCANNER_PATH];
    const prev = process.env.TV_PRECUT_USD;
    if (precutUsd === undefined) delete process.env.TV_PRECUT_USD;
    else process.env.TV_PRECUT_USD = String(precutUsd);
    try {
      return require('../../discovery/tv-scanner.js');
    } finally {
      if (prev === undefined) delete process.env.TV_PRECUT_USD;
      else process.env.TV_PRECUT_USD = prev;
    }
  }

  await test('BH-065: serverFloor() folgt TV_PRECUT_USD statt hartkodiertem 1.5e9', () => {
    const defaultMod = loadTvScannerWithEnv(undefined);
    assert.equal(defaultMod.serverFloor('EUR', 1), 1.5e9, 'Default (kein Env) bleibt 1.5e9');

    // Der eigentliche Bug: vorher blieb der Server-Filter bei GESENKTEM
    // TV_PRECUT_USD trotzdem bei 1.5e9 haengen (hartkodiertes Literal).
    const loweredMod = loadTvScannerWithEnv('1e9');
    assert.equal(loweredMod.serverFloor('EUR', 1), 1e9, 'gesenktes TV_PRECUT_USD muss den Server-Floor senken');

    const raisedMod = loadTvScannerWithEnv('3e9');
    assert.equal(raisedMod.serverFloor('EUR', 1), 3e9, 'angehobenes TV_PRECUT_USD muss den Server-Floor anheben');
  });

  await test('BH-065: unbekannte/kaputte Waehrung faellt weiter auf fixe 2e9 (unabhaengig vom Env)', () => {
    const mod = loadTvScannerWithEnv('1e9');
    assert.equal(mod.serverFloor(null, NaN), 2000000000);
    assert.equal(mod.serverFloor('XXX', 0), 2000000000);
  });

  // Modul mit dem urspruenglichen Prozess-Env final neu laden, fuer die
  // verbleibenden Tests (runPooled haengt nicht an TV_PRECUT_USD).
  delete require.cache[TV_SCANNER_PATH];
  const tvScanner = require('../../discovery/tv-scanner.js');

  // ---------------------------------------------------------------------------
  // BH-060: tv-scanner.js runPooled() — Concurrency-Deckel + stabile Reihenfolge
  // ---------------------------------------------------------------------------
  await test('BH-060: runPooled haelt die Eingabereihenfolge trotz variabler Laufzeiten ein', async () => {
    const items = [30, 5, 20, 1, 10];
    const results = await tvScanner.runPooled(items, 3, (ms) => new Promise((r) => setTimeout(() => r(ms * 2), ms)));
    assert.deepEqual(results, items.map((ms) => ms * 2));
  });

  await test('BH-060: runPooled ueberschreitet den Concurrency-Deckel nie', async () => {
    const items = Array.from({ length: 12 }, (_, i) => i);
    let inFlight = 0, maxInFlight = 0;
    await tvScanner.runPooled(items, 4, async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
    });
    assert.ok(maxInFlight <= 4, `maxInFlight=${maxInFlight} ueberschreitet den Deckel 4`);
  });

  await test('BH-060: runPooled mit leerer Liste haengt nicht und liefert []', async () => {
    const results = await tvScanner.runPooled([], 6, async () => { throw new Error('darf nie aufgerufen werden'); });
    assert.deepEqual(results, []);
  });

  console.log(`\nbh-b14-discovery.test.js: ${pass} ok, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();

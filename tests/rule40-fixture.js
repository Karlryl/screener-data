'use strict';
/**
 * tests/rule40-fixture.js — hermetischer Mini-Export fuer die rule40-Tests.
 *
 * KEIN Netz, KEIN Universum, KEIN echter Snapshot-Ordner: jeder Test baut sich in einem
 * Temp-Verzeichnis genau die Dateien, die der Schreiber liest (v1/index.json, v1/full/<branch>.json,
 * snapshots/<TICKER>.json). Deshalb duerfen diese Tests in der BLOCKIERENDEN Spur des Test-Gates
 * stehen: sie koennen nur rot werden, wenn der Code kaputt ist, nie weil Daten fehlen.
 *
 * Keine Datei ist eine Datei: die Form stammt aus der gemessenen Wirklichkeit
 * (outputs/findash-export/v1/full/software-comm-services.json, snapshots/CRM.json), nicht
 * aus dem Kopf. Wer die Form hier aendert, muss sie dort nachmessen.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/** Vier Quartale + Vorjahresquartal; jahresVergleichIdx faellt ohne Enddaten auf idx = i+4. */
function quartalsreihe(neueste, basis) {
  return [neueste, neueste * 0.95, neueste * 0.9, neueste * 0.85, basis].map((value) => ({ value }));
}

/**
 * Ein Snapshot, wie pull-yahoo ihn schreibt. Die Vorgaben sind bewusst die GESUNDE Variante —
 * jeder Guard-Test kippt genau EIN Feld und sieht zu, ob der Waechter anschlaegt.
 */
function snapshot(over = {}) {
  const fcfMarginTTM = over.fcfMarginTTM !== undefined ? over.fcfMarginTTM : 30;
  const revenueTTM = over.revenueTTM !== undefined ? over.revenueTTM : 400e6;
  const basisQ = over.basisQ !== undefined ? over.basisQ : 95e6;   // ~0,95 eines Durchschnittsquartals
  return {
    meta: {
      // Der Schreiber laeuft ueber das GEROUTETE Universum: jeder Snapshot muss
      // src/scoring/router.js route() passieren, sonst zaehlt er als 'nichtGeroutet'.
      // Diese Felder sind genau die, die der Router liest (nachgesehen an snapshots/CRM.json).
      ticker: over.ticker || 'AAA',
      name: over.name !== undefined ? over.name : null,   // baueExport stempelt den Ticker ein
      exchangeName: over.exchangeName !== undefined ? over.exchangeName : 'NYSE',
      country: over.country !== undefined ? over.country : 'United States',
      region: over.region !== undefined ? over.region : 'US',
      sector: over.sector !== undefined ? over.sector : 'Technology',
      industry: over.industry !== undefined ? over.industry : 'Software - Application',
      fundamentalsAsOf: over.fundamentalsAsOf !== undefined ? over.fundamentalsAsOf : '2026-09-01T00:00:00.000Z',
      fcfMarginTTMSuppressed: !!over.fcfMarginTTMSuppressed,
    },
    marketCap: { value: over.marketCap !== undefined ? over.marketCap : 5e9 },
    metrics: {
      fcfMarginTTM: { value: fcfMarginTTM },
      ebitdaMargins: { value: over.ebitdaMargins !== undefined ? over.ebitdaMargins : 25 },
      revenueTTM: { value: revenueTTM },
    },
    annual: {
      // fcfMarginValid/G0-G2 brauchen ein present FCF-Jahr mit gleichem Vorzeichen.
      annualFCF: (over.annualFCF || [120e6, 100e6, 80e6]).map((value) => ({ value })),
      annualOCF: (over.annualOCF || [150e6, 130e6, 110e6]).map((value) => ({ value })),
      // Der Router braucht Umsatz (sonst pre-revenue) und einen Bruttogewinn != 0.
      annualRev: (over.annualRev || [revenueTTM, revenueTTM * 0.8, revenueTTM * 0.6]).map((value) => ({ value })),
      annualGP: (over.annualGP || [revenueTTM * 0.7, revenueTTM * 0.55, revenueTTM * 0.4]).map((value) => ({ value })),
    },
    timeseries: {
      revenueQ: over.revenueQ || quartalsreihe(110e6, basisQ),
      revenueQEnds: over.revenueQEnds !== undefined ? over.revenueQEnds
        : ['2026-06-30', '2026-03-31', '2025-12-31', '2025-09-30', '2025-06-30'],
    },
  };
}

/** Eine Vollboard-Zeile, wie write-findash-export sie schreibt (overview als Objekt, kein formulaId). */
function boardZeile(over = {}) {
  return Object.assign({
    rank: 1,
    rankGrund: null,
    ticker: 'AAA',
    score: 80,
    track: 'profitable',
    lamps: [],
    overview: { kind: 'gp', value: 2.5, companion: 180.4 },
    name: 'Alpha AG',
    country: 'United States',
    region: 'North America',
    sector: 'Technology',
    marketCap: 5e9,
    phase: 'established',
    mcapBand: 'large',
    mcapKlasse: 'large',
    ipoRecency: 'seasoned',
    profitTier: 'langfristig-profitabel',
    ipoYear: 2014,
    coverageAxes: '7/7',
    coverageWeight: 1,
    cohortN: 300,
    cohortFallback: false,
    scoreBase: 78,
    scoreShrunk: 77.5,
    factors: { burn: 1, growth: 1.02, cycle: 1 },
    axisBreakdown: [{ key: 'ruleOfX', pct: 90.1, weight: 1.8 }],
    revGrowthYoYPct: 40,
    profitStreak: 12,
    einmalertragPrognose: null,
    einmalertragBewertbarkeit: null,
    shareDilution: null,
    ath: null,
    marketCapCurrency: 'USD',
    tradingFxRateApplied: 1,
  }, over);
}

const GENERATED_AT = '2026-09-17T18:00:00.000Z';

/**
 * Schreibt einen kompletten Mini-Export in ein frisches Temp-Verzeichnis.
 * @param {Array<{row:object, snap?:object, branch?:string}>} eintraege
 * @returns {{dir:string, v1Dir:string, snapshotsDir:string, outDir:string, generatedAt:string, aufraeumen:Function}}
 */
function baueExport(eintraege, opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rule40-test-'));
  const v1Dir = path.join(dir, 'v1');
  const snapshotsDir = path.join(dir, 'snapshots');
  const generatedAt = opts.generatedAt || GENERATED_AT;
  fs.mkdirSync(path.join(v1Dir, 'full'), { recursive: true });
  fs.mkdirSync(snapshotsDir, { recursive: true });

  const nachBranch = new Map();
  for (const e of eintraege) {
    const branch = e.branch || 'software-comm-services';
    if (!nachBranch.has(branch)) nachBranch.set(branch, []);
    nachBranch.get(branch).push(e.row);
    if (e.snap !== null) {
      const snap = e.snap || snapshot({ ticker: e.row.ticker });
      // Der Schreiber rechnet das Wachstum aus der QUARTALSREIHE des Snapshots
      // (revGrowthLevel, derselbe Aufruf wie score.js:1348) und nicht aus dem Feld der
      // Brett-Zeile. Damit ein Test weiter "diese Zeile waechst um X %" sagen kann, wird
      // die Reihe hier aus row.revGrowthYoYPct gebaut — ein Ort statt in jedem Test.
      // `reihe: false` laesst die Reihe unangetastet (Tests, die genau sie pruefen).
      if (e.reihe !== false && Number.isFinite(e.row.revGrowthYoYPct)) {
        setzeWachstum(snap, e.row.revGrowthYoYPct);
      }
      // Identitaet aus der Zeile, nicht aus der Vorgabe: der Emittenten-Dedup (score.js)
      // gruppiert ueber den FIRMENNAMEN. Traegt jeder Test-Snapshot denselben Vorgabe-Namen,
      // verschmelzen alle Zeilen zu einem Emittenten und das Brett hat genau eine Zeile —
      // ein Fixture-Artefakt, das wie ein Fehler des Schreibers aussieht.
      snap.meta.ticker = e.row.ticker;
      if (snap.meta.name === null || snap.meta.name === undefined) snap.meta.name = e.row.ticker + ' Inc';
      fs.writeFileSync(path.join(snapshotsDir, e.row.ticker + '.json'), JSON.stringify(snap));
    }
  }

  const coverage = opts.coverage !== undefined
    ? opts.coverage
    : { status: 'ok', degraded: false, blocked: false, coverage_pct: 91.2 };

  for (const [branch, rows] of nachBranch) {
    fs.writeFileSync(path.join(v1Dir, 'full', branch + '.json'), JSON.stringify({
      schema: 'findash-export/v1',
      generated_at: generatedAt,
      branch,
      boardStatus: 'core',
      coverage,
      mcapBounds: [1e9, 2e9, 5e9, 1e10],
      profitable: rows.filter((r) => r.track === 'profitable'),
      unprofitable: rows.filter((r) => r.track === 'unprofitable'),
    }));
  }

  fs.writeFileSync(path.join(v1Dir, 'index.json'), JSON.stringify({
    schema: opts.schema || 'findash-export/v1',
    generated_at: generatedAt,
    coverage,
    generatedFromSnapshots: eintraege.length,
    branches: Array.from(nachBranch.keys()),
    boardStatus: Object.fromEntries(Array.from(nachBranch.keys()).map((b) => [b, 'core'])),
    counts: {},
  }));

  return {
    dir,
    v1Dir,
    snapshotsDir,
    outDir: path.join(v1Dir, 'rule40'),
    generatedAt,
    aufraeumen: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

/**
 * Die Quartalsreihe so setzen, dass revGrowthLevel genau `pct` Prozent liefert:
 * juengstes Quartal = Basisquartal * (1 + pct/100). Das Basisquartal bleibt gesund
 * (rund ein Durchschnittsquartal), damit der Stub-Waechter nicht dazwischenfunkt.
 */
function setzeWachstum(snap, pct) {
  const basis = (snap.metrics.revenueTTM.value / 4) * 0.95;
  const neu = basis * (1 + pct / 100);
  snap.timeseries.revenueQ = [neu, neu * 0.98, neu * 0.96, neu * 0.94, basis].map((value) => ({ value }));
  return snap;
}

/** Minimaler Testlaeufer, gleiche Form wie tests/druckenmiller/*. */
function laeufer() {
  const zustand = { pass: 0, fail: 0 };
  const test = (name, fn) => {
    try { fn(); zustand.pass++; console.log('  ok   ' + name); }
    catch (e) { zustand.fail++; console.error('FAIL   ' + name + '\n       ' + (e && e.message)); }
  };
  const bilanz = (datei) => {
    console.log(datei + ': ' + zustand.pass + ' ok, ' + zustand.fail + ' fail');
    if (zustand.fail) process.exitCode = 1;
  };
  return { test, bilanz, zustand };
}

module.exports = { snapshot, boardZeile, baueExport, quartalsreihe, setzeWachstum, laeufer, GENERATED_AT };

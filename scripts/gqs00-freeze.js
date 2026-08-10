'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const REPO = path.resolve(__dirname, '..');
const FREEZE_DIR = path.join(REPO, 'protocol', 'gqs-00', '1.0.0');
const FORMULA_COMMIT = '4cae8dcdbe445abf9bc03dadc3f852e6b0fd864b';
const SCORING_TREE = '2728be605cc614cec2863c937c423afd8a249efe';
const BOARD_COMMIT = '734025a1915d4bda5947a75ab71d9ba4bd9f8ded';
const DATA_COMMIT = 'b26e1c0b4a0f5fc00f04a7b5229941186d3fad38';
const WORKFLOW_RUN = 31147698301;
const MODULE_ID = 'GQS-00';
const SEMVER = '1.0.0';
const CANONICAL_ID = MODULE_ID + '@' + SEMVER;

const formulas = require(path.join(REPO, 'src', 'scoring', 'formulas'));
const axesFns = require(path.join(REPO, 'src', 'scoring', 'axes.js'));
const { q, signTrack } = require(path.join(REPO, 'src', 'scoring', 'engine.js'));
const { norm } = require(path.join(REPO, 'src', 'scoring', 'snapshot.js'));
const {
  scoreUniverse, rawAxisValue, shrinkToNeutral,
} = require(path.join(REPO, 'src', 'scoring', 'score.js'));

const AXIS_DEFINITIONS = {
  revGrowthLevel: {
    label: 'Revenue growth level', unit: 'percentage_points', direction: 'higher_is_better',
    implementation: 'src/scoring/axes.js#revGrowthLevel',
    formula: '100 * winsor(latest_quarter/prior_year_quarter - 1); if unavailable, 100 * winsor(annualRev[0]/annualRev[1] - 1)',
    periodRule: 'Quarterly YoY uses a period-end match around 365 days (+/-15 days); position 4 only when period ends are absent. Annual fallback requires adjacent current/prior fiscal years.',
    inputPointers: ['$.timeseries.revenueQ', '$.timeseries.revenueQEnds', '$.annual.annualRev'],
    missing: 'Quarterly leg drops when no valid prior-year pair or an intervening value gap exists; annual fallback requires two adjacent finite years and a positive denominator; otherwise null.',
  },
  revAcceleration: {
    label: 'Revenue acceleration', unit: 'decimal_change', direction: 'higher_is_better',
    implementation: 'src/scoring/axes.js#revAcceleration',
    formula: 'newest quarterly YoY - oldest quarterly YoY; fallback: (annualRev[0]/annualRev[1]-1) - (annualRev[1]/annualRev[2]-1)',
    periodRule: 'Quarterly path requires at least two valid period-end-matched YoY pairs; otherwise three positive annual values are used.',
    inputPointers: ['$.timeseries.revenueQ', '$.timeseries.revenueQEnds', '$.annual.annualRev'],
    missing: 'Fewer than two quarterly YoY pairs and fewer than three positive annual values yields null.',
  },
  gpGrowth: {
    label: 'Gross-profit growth plus gross-margin trajectory', unit: 'decimal_change', direction: 'higher_is_better',
    implementation: 'src/scoring/axes.js#gpGrowth',
    formula: '(annualGP[0]/annualGP[1]-1) + (grossMarginNewest-grossMarginOldest)',
    periodRule: 'Adjacent current/prior fiscal-year gross profit; margin trajectory over valid annual GP/revenue pairs.',
    inputPointers: ['$.annual.annualGP', '$.annual.annualRev'],
    missing: 'Adjacent positive prior-year GP is mandatory; invalid gross margins outside [0,1] are ignored; absent trajectory contributes zero.',
  },
  ruleOfX: {
    label: 'Growth efficiency', unit: 'percentage_points', direction: 'higher_is_better',
    implementation: 'src/scoring/axes.js#ruleOfX',
    formula: 'branch_alpha * revGrowthLevel + valid_fcfMarginTTM',
    periodRule: 'Uses the same period selection as revGrowthLevel and current TTM FCF margin.',
    inputPointers: ['$.timeseries.revenueQ', '$.timeseries.revenueQEnds', '$.annual.annualRev', '$.metrics.fcfMarginTTM', '$.annual.annualFCF', '$.annual.annualOCF'],
    missing: 'Revenue growth is mandatory. FCF term is omitted unless sign and recent FCF/OCF guards validate it.',
  },
  marginTrajectory: {
    label: 'Operating-margin trajectory', unit: 'decimal_change', direction: 'higher_is_better',
    implementation: 'src/scoring/axes.js#marginTrajectory',
    formula: 'winsor(opIncQ[0]/revenueQ[0]) - winsor(oldest_valid_opIncQ/revenueQ)',
    periodRule: 'Newest versus oldest valid quarterly operating margin; newest quarter itself must be present.',
    inputPointers: ['$.timeseries.opIncQ', '$.timeseries.revenueQ'],
    missing: 'Requires a valid newest quarter and at least two valid positive-revenue quarterly pairs; otherwise null.',
  },
  capitalEfficiency: {
    label: 'Capital efficiency', unit: 'ratio', direction: 'higher_is_better',
    implementation: 'src/scoring/axes.js#capitalEfficiency',
    formula: 'mean(opInc)/mean(totalAssets-currentLiabilities) * cycle_peak_discount - max(0,asset_growth-revenue_growth)',
    periodRule: 'Fiscal-year-aligned SEC trio when complete and at least as deep as Yahoo, otherwise Yahoo annual trio; profitable-regime trim is sign-based.',
    inputPointers: ['$.secAnnual', '$.annual.annualOpInc', '$.annual.annualBalance.totalAssets', '$.annual.annualBalance.currentLiabilities', '$.annual.annualRev'],
    missing: 'Only fiscal years with finite opInc, assets, current liabilities and positive invested capital are used; no valid year yields null.',
  },
  dilution: {
    label: 'Dilution drag', unit: 'negative_ratio', direction: 'higher_is_better',
    implementation: 'src/scoring/axes.js#dilution',
    formula: '-clamp(annualSBC[0]/annualRev[0],0,1) - valid_level_change',
    periodRule: 'Current fiscal-year SBC/revenue level and oldest valid annual comparison.',
    inputPointers: ['$.annual.annualSBC', '$.annual.annualRev'],
    missing: 'Current-year ratio is mandatory. An implausible oldest ratio neutralizes only the slope; missing current ratio yields null.',
  },
  marginLevel: {
    label: 'Gross-margin level', unit: 'ratio', direction: 'higher_is_better',
    implementation: 'src/scoring/axes.js#marginLevel',
    formula: 'first valid index-aligned annualGP/annualRev in [0,1]',
    periodRule: 'Newest jointly valid fiscal year.',
    inputPointers: ['$.annual.annualGP', '$.annual.annualRev'],
    missing: 'No jointly valid gross-margin year yields null.',
  },
};

const CASES = [
  ['ALNY', ['audit_anchor', 'health-care', 'profitable', 'full_coverage', 'growth_factor', 'quarterly_growth']],
  ['BMI', ['audit_anchor', 'tech-hardware', 'profitable', 'full_coverage', 'mid_score', 'quarterly_growth']],
  ['STB.OL', ['audit_anchor', 'financials', 'profitable', 'missing_axes', 'weight_renormalization', 'coverage_shrink']],
  ['GRGD.TO', ['consumer-discretionary', 'profitable']],
  ['ATHERENERG.NS', ['consumer-discretionary', 'unprofitable']],
  ['278470.KS', ['consumer-staples', 'profitable', 'score_over_100', 'no_final_cap']],
  ['CHENNPETRO.NS', ['energy', 'profitable']],
  ['VNOM', ['energy', 'unprofitable']],
  ['GDG.AX', ['financials', 'unprofitable', 'annual_growth_fallback']],
  ['LQDA', ['health-care', 'unprofitable']],
  ['8996.TW', ['industrials', 'profitable']],
  ['QXO', ['industrials', 'unprofitable']],
  ['3317.HK', ['it-services', 'profitable', 'annual_growth_fallback']],
  ['AUGO', ['materials', 'profitable']],
  ['2548.TW', ['real-estate', 'profitable']],
  ['688256.SS', ['semiconductors', 'profitable']],
  ['688110.SS', ['semiconductors', 'unprofitable']],
  ['DAVE', ['software-comm-services', 'profitable']],
  ['NBIS', ['software-comm-services', 'unprofitable']],
  ['002151.SZ', ['tech-hardware', 'unprofitable']],
  ['SJVN.BO', ['utilities', 'profitable']],
  ['XIFR', ['utilities', 'unprofitable', 'thin_cohort', 'parent_fallback']],
  ['000002.SZ', ['factor_case', 'burn_factor', 'annual_growth_fallback']],
  ['000006.SZ', ['factor_case', 'cycle_factor', 'annual_growth_fallback']],
  ['001236.SZ', ['survival_case']],
].map(([ticker, coverage]) => ({ ticker, coverage }));

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = canonicalize(value[key]);
    return out;
  }
  return value;
}

function canonicalStringify(value) {
  return JSON.stringify(canonicalize(value));
}

function sha256Text(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function sha256Canonical(value) {
  return sha256Text(canonicalStringify(value));
}

function fileSha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

// Zeilenenden-neutral, aber byte-genau: NIE ueber einen JS-String gehen. 'utf8' dekodiert
// verlustbehaftet (jedes ungueltige Byte wird still U+FFFD), zwei verschiedene Dateien
// bekaemen denselben Siegel-Hash. Fuer gueltiges UTF-8 sind die Hashes identisch zu vorher,
// das bestehende Siegel bleibt also gueltig.
function sourceHashes(file) {
  const raw = fs.readFileSync(file);
  const lf = [], crlf = [];
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === 0x0d && raw[i + 1] === 0x0a) continue; // CR eines CRLF-Paares faellt weg
    if (raw[i] === 0x0a) crlf.push(0x0d);                 // CRLF-Variante aus der LF-Variante
    lf.push(raw[i]);
    crlf.push(raw[i]);
  }
  return [lf, crlf].map((bytes) => crypto.createHash('sha256').update(Buffer.from(bytes)).digest('hex'));
}

function walkFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(full));
    else if (entry.isFile()) out.push(full);
  }
  return out.sort();
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

function formulaShape(formula) {
  return {
    branchFormulaId: formula.id,
    splitMetric: formula.splitMetric,
    subCohortByProfit: formula.subCohortByProfit === true,
    alpha: formula.alpha,
    tracks: formula.splitMetric === 'none' ? ['profitable'] : ['profitable', 'unprofitable'],
    axes: formula.axes.map((axis) => ({ key: axis.key, weights: { ...axis.w } })),
  };
}

function buildRegistry() {
  const scoringDir = path.join(REPO, 'src', 'scoring');
  const sourceFiles = {};
  for (const file of walkFiles(scoringDir)) {
    const rel = path.relative(REPO, file).replaceAll('\\', '/');
    sourceFiles[rel] = sourceHashes(file)[0];
  }
  return {
    schema: 'gqs-formula-registry/v1',
    identity: {
      formulaId: MODULE_ID,
      formulaSemver: SEMVER,
      canonicalId: CANONICAL_ID,
      freezeDate: '2026-08-08',
      activationDate: '2026-08-08',
      firstVerifiedProductionVintage: '2026-08-07',
      status: 'frozen_baseline',
    },
    provenance: {
      formulaCommit: FORMULA_COMMIT,
      scoringTreeGitSha1: SCORING_TREE,
      productionBoardCommit: BOARD_COMMIT,
      productionDataCommit: DATA_COMMIT,
      productionWorkflowRun: WORKFLOW_RUN,
      calibrationVersion: 'calibration/v4',
      calibrationArtifact: 'frozen-calibration.json',
      note: 'calibration/v4 is a calibration schema, not the formula semantic version.',
    },
    constants: {
      percentile: { method: 'midrank', formula: '100*(count(x<v)+0.5*count(x=v))/n', finiteOnly: true },
      winsorTail: 0.01,
      opMarginUpperBound: 1,
      empiricalBayes: { target: 50, k: 2, formula: '50 + n/(n+2)*(scoreBase-50)' },
      minimumCohortN: 15,
      coverageShrink: { target: 'post-EB cohort median', factor: 'present axis weight / total axis weight' },
      growthBoost: { k: 0.05, maximumFactor: 1.05, minimumDistinctValues: 10, cohortRelative: true },
      cycleDamper: { k: 0.5, drawdownQuantile: 0.75, minimumDistinctValues: 10 },
      displayRoundingDecimals: 1,
      finalScoreCap: null,
    },
    axisDefinitions: AXIS_DEFINITIONS,
    formulas: Object.keys(formulas).sort().map((id) => formulaShape(formulas[id])),
    cohort: {
      key: '<branchFormulaId>|<track>',
      ownDistributionWhen: 'frozen cohort n >= 15',
      parentFallbackWhen: 'frozen cohort n < 15; concatenate both frozen branch tracks per axis',
      subCohortRule: 'For real-estate and it-services capitalEfficiency only, compare against the same annual operating-income sign.',
      trackRules: {
        OpInc: 'newest present annual operating income sign',
        FCF: 'validated TTM FCF margin sign, else newest annual FCF sign, else annual OCF sum sign',
        none: 'forced profitable display track; no unprofitable display track',
      },
    },
    pipeline: [
      'route and data-quality gate',
      'issuer deduplication',
      'learn or load frozen global bounds',
      'calculate raw axes',
      'select own or parent cohort comparison distribution',
      'midrank percentiles',
      'weighted mean with renormalization over present axes',
      'empirical-Bayes shrink toward 50',
      'coverage shrink toward post-EB cohort median',
      'multiply burn, growth and cycle factors',
      'rank by unrounded score descending with ticker tie-break',
      'round display score to one decimal; no final cap',
    ],
    missingData: {
      axisRule: 'A missing raw axis maps to null, is dropped, and remaining positive weights are renormalized; no fake neutral percentile is inserted.',
      noAxesRule: 'A routed row with all axes missing is excluded with reason no-axes.',
      coverageRule: 'After EB shrinkage, incomplete weight coverage shrinks toward the frozen post-EB cohort median.',
      periodFallbackRule: 'Only the explicitly documented quarterly-to-annual fallbacks are allowed; current/latest provider scalars are not historical PIT facts.',
    },
    endFactors: {
      burn: { implementation: 'src/scoring/score.js#burnPressFactor', rule: 'accelerating cash burn multiplies by 1/(1+magnitude); otherwise 1' },
      growth: { implementation: 'src/scoring/score.js#growthBoostFactor', rule: 'cohort-relative robust-growth percentile above median raises score up to 1.05; otherwise 1' },
      cycle: { implementation: 'src/scoring/score.js#cycleDamperFactor', rule: 'oscillation plus revenue drawdown above frozen p75 multiplies by 1/(1+0.5*signal); otherwise 1' },
      combination: 'scoreFinal = scoreAfterCoverage * burn * growth * cycle',
    },
    immutableDefinitions: {
      sourceFiles,
      sourceTreeScope: 'complete src/scoring tree',
      sourceTreeGitSha1AtFormulaCommit: SCORING_TREE,
    },
  };
}

function comparisonBasis(calibration, result, formula, axisKey, snapshot) {
  const cohortKey = result.formulaId + '|' + result.track;
  const own = calibration.cohortBases[cohortKey];
  assert(own, 'missing frozen cohort ' + cohortKey);
  let values = [], signs = [];
  if (own.n < 15) {
    for (const key of Object.keys(calibration.cohortBases).filter((k) => k.startsWith(result.formulaId + '|')).sort()) {
      const c = calibration.cohortBases[key];
      const arr = c.axes[axisKey] || [];
      values = values.concat(arr);
      signs = signs.concat(Array.isArray(c.profitSign) && c.profitSign.length === arr.length ? c.profitSign : arr.map(() => null));
    }
  } else {
    values = own.axes[axisKey] || [];
    signs = Array.isArray(own.profitSign) ? own.profitSign : values.map(() => null);
  }
  if (axisKey === 'capitalEfficiency' && formula.subCohortByProfit) {
    const ownSign = signTrack(norm(snapshot, 'annualOpInc'));
    values = values.filter((_, index) => signs[index] === ownSign);
  }
  return values;
}

function baseProvenance(registry, registryHash) {
  return {
    formulaId: registry.identity.formulaId,
    formulaSemver: registry.identity.formulaSemver,
    canonicalId: registry.identity.canonicalId,
    formulaRegistrySha256: registryHash,
    formulaCommit: registry.provenance.formulaCommit,
    scoringTreeGitSha1: registry.provenance.scoringTreeGitSha1,
    calibrationVersion: registry.provenance.calibrationVersion,
    freezeDate: registry.identity.freezeDate,
  };
}

function traceForCase(fixture, calibration, registry, registryHash) {
  const snapshot = fixture.rawSnapshot;
  const result = scoreUniverse([structuredClone(snapshot)], formulas, { refCalibration: calibration })
    .find((entry) => entry.ticker === fixture.ticker);
  assert(result, 'no score result for ' + fixture.ticker);
  const provenance = baseProvenance(registry, registryHash);
  if (result.action !== 'route') {
    return {
      caseId: fixture.caseId,
      ticker: fixture.ticker,
      coverage: fixture.coverage,
      rawInputs: snapshot,
      routing: { action: result.action, reason: result.reason || null },
      score: null,
      provenance,
    };
  }
  const formula = formulas[result.formulaId];
  const cohortKey = result.formulaId + '|' + result.track;
  const cohort = calibration.cohortBases[cohortKey];
  const pcts = new Map(result._axes.map((axis) => [axis.key, axis]));
  const axes = formula.axes.map((axis) => {
    const raw = rawAxisValue(snapshot, axis.key, formula, result.track, calibration.winsorBounds, calibration.growthBounds);
    const distribution = comparisonBasis(calibration, result, formula, axis.key, snapshot);
    const definition = registry.axisDefinitions[axis.key];
    return {
      key: axis.key,
      rawValue: raw,
      unit: definition.unit,
      periodRule: definition.periodRule,
      inputPointers: definition.inputPointers,
      comparisonDistribution: distribution,
      comparisonDistributionSha256: sha256Canonical(distribution),
      comparisonNFinite: distribution.filter(Number.isFinite).length,
      percentile: pcts.get(axis.key).pct,
      weight: pcts.get(axis.key).weight,
    };
  });
  const ebScore = shrinkToNeutral(result._scoreBase, result.cohortN);
  const revQuarterly = axesFns.revQuartalsYoY(snapshot);
  const revAnnual = axesFns.revAnnualYoY(snapshot);
  return {
    caseId: fixture.caseId,
    ticker: fixture.ticker,
    coverage: fixture.coverage,
    rawInputs: snapshot,
    routing: {
      action: result.action,
      branchFormulaId: result.formulaId,
      track: result.track,
      cohortKey,
      cohortN: result.cohortN,
      parentFallback: result.cohortFallback,
    },
    periodSelection: {
      revGrowthLevel: revQuarterly !== null ? 'quarterly_yoy' : (revAnnual !== null ? 'annual_fallback' : 'missing'),
      quarterlyYoYRaw: revQuarterly,
      annualYoYRaw: revAnnual,
    },
    axes,
    score: {
      weightedBase: result._scoreBase,
      empiricalBayes: ebScore,
      empiricalBayesTarget: 50,
      coverageWeight: result.coverageWeight,
      coverageTargetMedian: cohort.median,
      afterCoverage: result._scorePreFactor,
      factors: { burn: result._factorBurn, growth: result._factorGrowth, cycle: result._factorCycle },
      unroundedFinal: result.score,
      uiRounded: Math.round(result.score * 10) / 10,
      finalCap: null,
    },
    provenance,
  };
}

function expectedFromTrace(trace) {
  if (trace.routing.action !== 'route') return { action: trace.routing.action, reason: trace.routing.reason, score: null };
  return {
    action: 'route',
    branchFormulaId: trace.routing.branchFormulaId,
    track: trace.routing.track,
    cohortN: trace.routing.cohortN,
    parentFallback: trace.routing.parentFallback,
    coverageWeight: trace.score.coverageWeight,
    unroundedFinal: trace.score.unroundedFinal,
    uiRounded: trace.score.uiRounded,
  };
}

function compactEquivalence(evidence) {
  return {
    schema: 'gqs-production-equivalence/v1',
    canonicalId: CANONICAL_ID,
    comparisonDate: '2026-08-08',
    input: {
      workflowRun: WORKFLOW_RUN,
      formulaCommit: FORMULA_COMMIT,
      snapshotArtifactDigestSha256: '7134ad55484e1d607868cf0f04570b5b210a2d8d3ccdd7dee0c45acecfc9c664',
      snapshotManifestSha256: 'c514b6678eb9b9ecc7c551496812f2ff83adf62f7c793033515d37ac18dc8d90',
      snapshotFiles: 14695,
      loadedUniverse: 14654,
      boardVintage: '2026-08-07',
      productionBoardCommit: BOARD_COMMIT,
    },
    unroundedOldVsFrozen: evidence.frozenCodeComparison,
    publishedBoardVsFrozen: evidence.publishedComparison,
    verdict: 'IDENTICAL',
    allowedChanges: 'None to score, rank, routing, filters, or export values; freeze artifacts are additive only.',
  };
}

function initialize(snapshotDir, evidenceFile) {
  assert(snapshotDir && fs.statSync(snapshotDir).isDirectory(), '--initialize requires a snapshot directory');
  assert(evidenceFile && fs.statSync(evidenceFile).isFile(), '--evidence requires the reproduction evidence JSON');
  fs.mkdirSync(FREEZE_DIR, { recursive: true });
  const registry = buildRegistry();
  const registryHash = sha256Canonical(registry);
  const calibration = JSON.parse(fs.readFileSync(path.join(REPO, 'board-history', '2026-08-07', 'calibration.json'), 'utf8'));
  writeJson(path.join(FREEZE_DIR, 'formula-registry.json'), registry);
  writeJson(path.join(FREEZE_DIR, 'frozen-calibration.json'), calibration);

  const fixtureCases = CASES.map((definition, index) => {
    const file = path.join(snapshotDir, definition.ticker + '.json');
    assert(fs.existsSync(file), 'missing source snapshot ' + file);
    const rawSnapshot = JSON.parse(fs.readFileSync(file, 'utf8'));
    return {
      caseId: 'GQS00-' + String(index + 1).padStart(3, '0'),
      ticker: definition.ticker,
      coverage: definition.coverage,
      source: { workflowRun: WORKFLOW_RUN, artifactFile: definition.ticker + '.json', rawSnapshotSha256: sha256Canonical(rawSnapshot) },
      rawSnapshot,
    };
  });
  const fixtureShell = {
    schema: 'gqs-golden-fixtures/v1',
    provenance: baseProvenance(registry, registryHash),
    sourcePolicy: 'Real snapshots from the verified 2026-08-07 workflow artifact; no outcomes are present.',
    syntheticCases: [{
      caseId: 'GQS00-SYN-001', kind: 'percentile_midrank_tie',
      rawInput: 1, comparisonDistribution: [0, 1, 1, 2], expectedPercentile: 50,
    }],
    cases: fixtureCases,
  };
  const traces = fixtureCases.map((fixture) => traceForCase(fixture, calibration, registry, registryHash));
  fixtureShell.cases = fixtureCases.map((fixture, index) => ({ ...fixture, expected: expectedFromTrace(traces[index]) }));
  writeJson(path.join(FREEZE_DIR, 'golden-fixtures.json'), fixtureShell);
  writeJson(path.join(FREEZE_DIR, 'score-traces.json'), {
    schema: 'gqs-score-traces/v1',
    provenance: baseProvenance(registry, registryHash),
    traces,
    syntheticTraces: [{
      caseId: 'GQS00-SYN-001', kind: 'percentile_midrank_tie', rawInput: 1,
      comparisonDistribution: [0, 1, 1, 2], calculation: '100*(1+0.5*2)/4', percentile: 50,
      provenance: baseProvenance(registry, registryHash),
    }],
  });
  const evidence = JSON.parse(fs.readFileSync(evidenceFile, 'utf8'));
  writeJson(path.join(FREEZE_DIR, 'production-equivalence.json'), compactEquivalence(evidence));
  return { registryHash, cases: fixtureCases.length };
}

const HASH_TARGETS = [
  'formula-registry.json',
  'frozen-calibration.json',
  'golden-fixtures.json',
  'score-traces.json',
  'production-equivalence.json',
  'ges-sec-us-pilot-preregistration.json',
];

function seal() {
  const preregFile = path.join(FREEZE_DIR, 'ges-sec-us-pilot-preregistration.json');
  const prereg = JSON.parse(fs.readFileSync(preregFile, 'utf8'));
  const preregHashView = structuredClone(prereg);
  preregHashView.integrity.canonicalSha256 = null;
  prereg.integrity.canonicalSha256 = sha256Canonical(preregHashView);
  writeJson(preregFile, prereg);
  const artifacts = {};
  for (const name of HASH_TARGETS) {
    const file = path.join(FREEZE_DIR, name);
    assert(fs.existsSync(file), 'cannot seal; missing ' + name);
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    artifacts[name] = { canonicalJsonSha256: sha256Canonical(parsed), bytesSha256: fileSha256(file) };
  }
  const manifest = {
    schema: 'gqs-hash-manifest/v1',
    canonicalId: CANONICAL_ID,
    sealedAt: '2026-08-08T00:00:00+02:00',
    canonicalization: 'Recursively sort object keys; preserve array order; JSON.stringify without whitespace; UTF-8; SHA-256 lowercase hex.',
    formulaRegistrySha256: artifacts['formula-registry.json'].canonicalJsonSha256,
    artifacts,
  };
  writeJson(path.join(FREEZE_DIR, 'hash-manifest.json'), manifest);
  return manifest;
}

function verify() {
  const registry = JSON.parse(fs.readFileSync(path.join(FREEZE_DIR, 'formula-registry.json'), 'utf8'));
  const calibration = JSON.parse(fs.readFileSync(path.join(FREEZE_DIR, 'frozen-calibration.json'), 'utf8'));
  const fixtures = JSON.parse(fs.readFileSync(path.join(FREEZE_DIR, 'golden-fixtures.json'), 'utf8'));
  const committedTraces = JSON.parse(fs.readFileSync(path.join(FREEZE_DIR, 'score-traces.json'), 'utf8'));
  const manifest = JSON.parse(fs.readFileSync(path.join(FREEZE_DIR, 'hash-manifest.json'), 'utf8'));
  const equivalence = JSON.parse(fs.readFileSync(path.join(FREEZE_DIR, 'production-equivalence.json'), 'utf8'));
  const prereg = JSON.parse(fs.readFileSync(path.join(FREEZE_DIR, 'ges-sec-us-pilot-preregistration.json'), 'utf8'));

  const rebuiltRegistry = buildRegistry();
  const sealedSourceFiles = registry.immutableDefinitions.sourceFiles;
  const rebuiltSourceFiles = rebuiltRegistry.immutableDefinitions.sourceFiles;
  // sortiert vergleichen: die Reihenfolge kommt aus walkFiles() ueber OS-native Pfade
  // (Backslash vs. Slash ordnen in Praefix-Faellen verschieden) — sonst False-Red auf einem OS.
  const sealedKeys = Object.keys(sealedSourceFiles).sort();
  const rebuiltKeys = Object.keys(rebuiltSourceFiles).sort();
  assert.deepEqual(sealedKeys, rebuiltKeys, 'sealed scoring source file set changed');
  for (const rel of Object.keys(sealedSourceFiles)) {
    assert(sourceHashes(path.join(REPO, rel)).includes(sealedSourceFiles[rel]), rel + ' differs from its sealed source hash');
  }
  const registryWithoutSourceHashes = structuredClone(registry);
  const rebuiltWithoutSourceHashes = structuredClone(rebuiltRegistry);
  registryWithoutSourceHashes.immutableDefinitions.sourceFiles = sealedKeys;
  rebuiltWithoutSourceHashes.immutableDefinitions.sourceFiles = rebuiltKeys;
  assert.deepEqual(registryWithoutSourceHashes, rebuiltWithoutSourceHashes, 'live GQS implementation differs from frozen registry');
  assert.equal(sha256Canonical(registry), manifest.formulaRegistrySha256, 'registry canonical hash mismatch');
  for (const name of HASH_TARGETS) {
    const file = path.join(FREEZE_DIR, name);
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(sha256Canonical(value), manifest.artifacts[name].canonicalJsonSha256, name + ' canonical hash mismatch');
    assert(
      sourceHashes(file).includes(manifest.artifacts[name].bytesSha256),
      name + ' byte hash mismatch',
    );
  }
  const preregHashView = structuredClone(prereg);
  preregHashView.integrity.canonicalSha256 = null;
  assert.equal(sha256Canonical(preregHashView), prereg.integrity.canonicalSha256, 'preregistration scoped hash mismatch');

  const rebuiltTraces = fixtures.cases.map((fixture) => traceForCase(fixture, calibration, registry, manifest.formulaRegistrySha256));
  assert.deepEqual(rebuiltTraces, committedTraces.traces, 'score traces are not deterministic');
  for (let i = 0; i < fixtures.cases.length; i++) {
    assert.deepEqual(expectedFromTrace(rebuiltTraces[i]), fixtures.cases[i].expected, 'golden fixture mismatch for ' + fixtures.cases[i].ticker);
  }
  const tie = fixtures.syntheticCases.find((entry) => entry.kind === 'percentile_midrank_tie');
  assert.equal(q(tie.rawInput, tie.comparisonDistribution), tie.expectedPercentile, 'midrank tie fixture mismatch');

  const branchCoverage = new Set(rebuiltTraces.filter((t) => t.routing.branchFormulaId).map((t) => t.routing.branchFormulaId));
  assert.deepEqual([...branchCoverage].sort(), Object.keys(formulas).sort(), 'not all 13 branches are covered');
  const tags = new Set(fixtures.cases.flatMap((fixture) => fixture.coverage));
  for (const required of ['full_coverage', 'missing_axes', 'coverage_shrink', 'annual_growth_fallback', 'thin_cohort', 'parent_fallback', 'burn_factor', 'growth_factor', 'cycle_factor', 'survival_case', 'score_over_100', 'no_final_cap']) {
    assert(tags.has(required), 'missing fixture coverage tag ' + required);
  }
  assert(rebuiltTraces.some((t) => t.routing.track === 'unprofitable'), 'unprofitable track not covered');
  assert(rebuiltTraces.some((t) => t.score && t.score.unroundedFinal > 100), 'score >100 not covered');

  assert.equal(equivalence.verdict, 'IDENTICAL');
  assert.equal(equivalence.unroundedOldVsFrozen.rawScoreMismatches, 0);
  assert.equal(equivalence.unroundedOldVsFrozen.rawRankMismatches, 0);
  assert.equal(equivalence.publishedBoardVsFrozen.scoreMismatches, 0);
  assert.equal(equivalence.publishedBoardVsFrozen.rankMismatches, 0);

  const mutatedRegistry = structuredClone(registry);
  mutatedRegistry.formulas.find((f) => f.branchFormulaId === 'health-care').axes[0].weights.profitable += 0.01;
  assert.notEqual(sha256Canonical(mutatedRegistry), manifest.formulaRegistrySha256, 'formula mutation did not change registry hash');
  const mutatedFormulas = { ...formulas };
  mutatedFormulas['health-care'] = structuredClone(formulas['health-care']);
  mutatedFormulas['health-care'].axes[0].w.profitable += 0.01;
  const alny = fixtures.cases.find((fixture) => fixture.ticker === 'ALNY');
  const mutatedScore = scoreUniverse([structuredClone(alny.rawSnapshot)], mutatedFormulas, { refCalibration: calibration })
    .find((entry) => entry.ticker === 'ALNY').score;
  assert.notEqual(mutatedScore, alny.expected.unroundedFinal, 'formula mutation did not break the golden fixture');

  return {
    canonicalId: CANONICAL_ID,
    formulaRegistrySha256: manifest.formulaRegistrySha256,
    goldenCases: fixtures.cases.length,
    branchesCovered: branchCoverage.size,
    oldVsFrozenRows: equivalence.unroundedOldVsFrozen.comparedResults,
    publishedRows: equivalence.publishedBoardVsFrozen.comparedRows,
    scoreMismatches: 0,
    rankMismatches: 0,
    negativeMutationGate: 'PASS',
  };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args[0] === '--initialize') {
    const evidenceAt = args.indexOf('--evidence');
    console.log(JSON.stringify(initialize(args[1], evidenceAt >= 0 ? args[evidenceAt + 1] : null), null, 2));
  } else if (args[0] === '--seal') {
    console.log(JSON.stringify(seal(), null, 2));
  } else if (args[0] === '--verify') {
    console.log(JSON.stringify(verify(), null, 2));
  } else {
    console.error('Usage: node scripts/gqs00-freeze.js --initialize <snapshots> --evidence <json> | --seal | --verify');
    process.exitCode = 2;
  }
}

module.exports = {
  FREEZE_DIR, buildRegistry, canonicalStringify, sha256Canonical, sourceHashes,
  traceForCase, initialize, seal, verify,
};

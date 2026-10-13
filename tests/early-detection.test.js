'use strict';

// Research-only contract tests for the V4 early-detection programme.
// Standalone by repository convention: node tests/early-detection.test.js

const assert = require('node:assert');
const path = require('node:path');
const {
  aiRemoval,
  assertAvailabilityContract,
  assertKnownAt,
  breakoutIndices,
  canonicalSha256,
  classifyCandidate,
  deriveMarketRecognition,
  evaluateHFem,
  evaluateLead,
  evaluateReadiness,
  growthBreakouts,
  growthVisibilityAt,
  knownAt,
  matchControlPanel,
  matchControls,
  rsi,
  selectPrimarySignals,
  selectPrimaryTheme,
  squeezeMomentum,
  technicalSnapshot,
  validateClaimLedger,
  validateFiveClocks,
  wilsonInterval,
} = require('../lib/early-detection.js');
const { buildManifest, deterministicTestFiles, outcomeCheckpointHistoryIssues, outcomeCheckpointIssues, verifyOutcomeAccessLedger } = require('../scripts/early-detection-audit.js');

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`  FAIL ${name}: ${error.message}`);
  }
}

function dateAt(offset) {
  const date = new Date(Date.UTC(2020, 0, 1 + offset));
  return date.toISOString().slice(0, 10);
}

function quarterRows() {
  const revenues = [100, 100, 100, 100, 105, 105, 105, 105, 140, 141, 142, 143, 144];
  const monthDays = ['03-31', '06-30', '09-30', '12-31'];
  return revenues.map((revenue, index) => {
    const fiscalYear = 2019 + Math.floor(index / 4);
    const fiscalQuarter = index % 4 + 1;
    return {
      entityId: 'ENTITY-1', fiscalYear, fiscalQuarter,
      periodEnd: `${fiscalYear}-${monthDays[fiscalQuarter - 1]}`,
      sourceClass: 'sec_filing',
      acceptedAt: `${fiscalYear}-${monthDays[fiscalQuarter - 1]}T20:00:00Z`,
      observedAt: `${fiscalYear}-${monthDays[fiscalQuarter - 1]}T20:01:00Z`,
      revenue,
      sectorPercentile: index === 8 ? 85 : 50,
      sectorPercentileKnownAt: `${fiscalYear}-${monthDays[fiscalQuarter - 1]}T20:02:00Z`,
      economicMetric: 'gross_profit', economicValue: revenue * 0.6,
      dilutedShares: 10, acquisitionRevenueShare: 0, valueCaptureAccepted: true,
      valueCaptureKnownAt: `${fiscalYear}-${monthDays[fiscalQuarter - 1]}T20:03:00Z`,
      acquisitionContributionKnownAt: `${fiscalYear}-${monthDays[fiscalQuarter - 1]}T20:01:00Z`,
      acquisitionAvailability: {
        sourceClass: 'sec_filing',
        accepted_at: `${fiscalYear}-${monthDays[fiscalQuarter - 1]}T20:00:00Z`,
        observed_at: `${fiscalYear}-${monthDays[fiscalQuarter - 1]}T20:01:00Z`,
      },
    };
  });
}

function dimensionEvidence(levels = { T: 2, E: 2, L: 2, M: 0 }, knownAt = '2024-01-01T00:00:00Z') {
  const result = {};
  for (const dimension of ['T', 'E', 'L', 'M']) {
    if ((levels[dimension] ?? 0) > 0) {
      result[dimension] = {
        level: levels[dimension], entityId: 'ENTITY-1', themeId: 'THEME-1', knownAt, sourceIds: [`S-${dimension}`],
      };
    }
  }
  return result;
}

function evidenceSources(levels = { T: 2, E: 2, L: 2, M: 0 }, knownAt = '2024-01-01T00:00:00Z') {
  return ['T', 'E', 'L', 'M'].filter((dimension) => (levels[dimension] ?? 0) > 0).map((dimension) => ({
    sourceId: `S-${dimension}`,
    sourceClass: 'public_web',
    source_published_at: knownAt,
    observed_at: knownAt,
  }));
}

function marketInputForM2() {
  const bars = Array.from({ length: 200 }, (_, index) => ({
    date: new Date(Date.UTC(2023, 6, 16 + index)).toISOString().slice(0, 10),
    close: index === 199 ? 103 : 100,
  }));
  const benchmark = bars.map((bar) => ({ date: bar.date, close: 100 }));
  return {
    entityId: 'ENTITY-1',
    listingId: 'LISTING-1',
    vintageMonth: '2024-01',
    bars,
    benchmarks: { sectorBars: benchmark, marketBars: benchmark },
    vintageCalendar: [
      { vintageMonth: '2023-12', closeDate: '2023-12-29', closeAt: '2023-12-29T21:00:00Z', nextOpenAt: '2024-01-02T14:30:00Z' },
      { vintageMonth: '2024-01', closeDate: bars.at(-1).date, closeAt: '2024-01-31T21:00:00Z', nextOpenAt: '2024-02-01T14:30:00Z' },
    ],
    priceMetadata: { adjustmentPolicy: 'point_in_time_total_return', corporateActionKnownAtPolicy: 'point_in_time' },
  };
}

check('research module remains outside productive src/scoring', () => {
  const modulePath = path.resolve(__dirname, '../lib/early-detection.js').replaceAll('\\', '/');
  assert.ok(!modulePath.includes('/src/scoring/'));
});

check('known_at is the latest availability timestamp', () => {
  const record = {
    sourceClass: 'issuer_release',
    observed_at: '2024-01-02T00:00:00Z',
    source_published_at: '2024-01-03T00:00:00Z',
  };
  assert.strictEqual(knownAt(record), '2024-01-03T00:00:00.000Z');
  assert.strictEqual(assertKnownAt(record, '2024-01-03T12:00:00Z'), '2024-01-03T00:00:00.000Z');
  assert.throws(() => assertKnownAt(record, '2024-01-02T12:00:00Z'), /look-ahead/);
  assert.throws(() => assertKnownAt({}, '2024-01-04T00:00:00Z'), /sourceClass is required/);
  assert.throws(() => assertKnownAt(record, null), /evaluation_at is required/);
  assert.throws(() => assertKnownAt(record, '2024-01-04'), /timezone-qualified/);
  assert.throws(() => assertKnownAt(record, '2024-02-31T00:00:00Z'), /real calendar timestamp/);
  assert.throws(() => assertAvailabilityContract({ sourceClass: 'sec_filing', accepted_at: '2024-01-01', observed_at: '2024-01-01T12:01:00Z' }), /timezone-qualified/);
  assert.strictEqual(assertAvailabilityContract({
    sourceClass: 'sec_filing',
    accepted_at: '2024-01-01T12:00:00Z',
    observed_at: '2024-01-01T12:01:00Z',
  }), true);
});

check('RSI 14 uses Wilder recursive smoothing', () => {
  const closes = [44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.10, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28, 46.00];
  assert.ok(Math.abs(rsi(closes, 14, 14) - 70.4641) < 0.001);
  assert.ok(Math.abs(rsi(closes, 14, 15) - 66.2496) < 0.001);
});

check('Squeeze Momentum uses OHLC and a 20-session linear-regression endpoint', () => {
  const bars = Array.from({ length: 40 }, (_, index) => ({
    date: dateAt(index), high: 101, low: 99, close: 100,
  }));
  const result = squeezeMomentum(bars);
  assert.strictEqual(result.status, 'COMPUTABLE');
  assert.strictEqual(result.squeezeOn, true);
  assert.ok(Math.abs(result.momentum) < 1e-12);
});

check('primary growth breakout follows percentile, acceleration and persistence rules', () => {
  const events = growthBreakouts(quarterRows());
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].periodEnd, '2021-03-31');
  assert.strictEqual(events[0].strict, true);
  assert.strictEqual(events[0].positiveQuartersOfFour, 4);
  assert.strictEqual(events[0].economicPositiveQuartersOfFour, 4);
  assert.strictEqual(events[0].perSharePositiveQuartersOfFour, 4);
  assert.strictEqual(events[0].eventAt, '2021-03-31T20:03:00.000Z');
  assert.strictEqual(events[0].eventAvailableAt, '2021-03-31T20:03:00.000Z');
  assert.strictEqual(events[0].maturityAt, '2022-03-31T20:01:00.000Z');
});

check('growth event availability includes later percentile and value-capture evidence', () => {
  const rows = quarterRows();
  rows[8].sectorPercentileKnownAt = '2021-04-15T12:00:00Z';
  rows[8].valueCaptureKnownAt = '2021-06-15T12:00:00Z';
  const [event] = growthBreakouts(rows);
  assert.strictEqual(event.periodEnd, '2021-03-31');
  assert.strictEqual(event.eventAvailableAt, '2021-06-15T12:00:00.000Z');
  assert.strictEqual(event.eventAt, event.eventAvailableAt);
  const delayedAcquisition = quarterRows();
  delayedAcquisition[12].acquisitionContributionKnownAt = '2025-06-01T12:00:00Z';
  delayedAcquisition[12].acquisitionAvailability = {
    sourceClass: 'research_publication',
    source_published_at: '2025-05-31T12:00:00Z',
    observed_at: '2025-06-01T12:00:00Z',
  };
  assert.strictEqual(growthBreakouts(delayedAcquisition)[0].maturityAt, '2025-06-01T12:00:00.000Z');
  const missingAcquisitionTime = quarterRows();
  delete missingAcquisitionTime[8].acquisitionAvailability;
  assert.throws(() => growthBreakouts(missingAcquisitionTime), /acquisition availability missing/);
  const invalid = quarterRows();
  invalid[0].sourceClass = 'public_web';
  assert.throws(() => growthBreakouts(invalid), /sourceClass sec_filing/);
});

check('visible growth is derived from nine consecutive then-available quarters', () => {
  const visible = growthVisibilityAt(quarterRows(), '2024-01-31T21:00:00Z');
  assert.strictEqual(visible.status, 'COMPUTABLE');
  assert.strictEqual(visible.visible, true);
  assert.match(visible.inputsSha256, /^[a-f0-9]{64}$/);
  const notVisibleRows = quarterRows();
  notVisibleRows[8].sectorPercentile = 79;
  assert.strictEqual(growthVisibilityAt(notVisibleRows, '2024-01-31T21:00:00Z').visible, false);
  assert.strictEqual(growthVisibilityAt(quarterRows().filter((_, index) => index !== 6), '2024-01-31T21:00:00Z').status, 'NOT_COMPUTABLE');
  assert.strictEqual(growthVisibilityAt(quarterRows(), '2020-01-01T00:00:00Z').status, 'NOT_COMPUTABLE');
  const laterVisible = quarterRows();
  laterVisible[8].sectorPercentile = 79;
  laterVisible[9].sectorPercentile = 85;
  laterVisible[9].revenue = 160;
  assert.strictEqual(growthVisibilityAt(laterVisible, '2024-01-31T21:00:00Z').visible, true);
});

check('missing fiscal quarters never compress the growth clock', () => {
  const incomplete = quarterRows().filter((row) => !(row.fiscalYear === 2021 && row.fiscalQuarter === 3));
  assert.deepStrictEqual(growthBreakouts(incomplete), []);
  const missingPriorYear = quarterRows().filter((row) => !(row.fiscalYear === 2020 && row.fiscalQuarter === 1));
  assert.deepStrictEqual(growthBreakouts(missingPriorYear), []);
});

check('252-session breakout requires 63 sessions without another raw high', () => {
  const bars = Array.from({ length: 320 }, (_, index) => ({ date: dateAt(index), close: 100 }));
  bars[252].close = 101;
  bars[253].close = 102;
  for (let index = 254; index < 317; index++) bars[index].close = 101;
  bars[317].close = 103;
  assert.deepStrictEqual(breakoutIndices(bars, 252, 63).indices, [317]);
  assert.deepStrictEqual(breakoutIndices(bars.slice(0, 315), 252, 63).indices, []);
  const exactBoundary = Array.from({ length: 318 }, (_, index) => ({ date: dateAt(index), close: 100 }));
  exactBoundary[253].close = 102;
  for (let index = 254; index < 317; index++) exactBoundary[index].close = 101;
  exactBoundary[316].close = 103;
  assert.deepStrictEqual(breakoutIndices(exactBoundary, 252, 63).indices, []);
  exactBoundary[316].close = 101;
  exactBoundary[317].close = 103;
  assert.deepStrictEqual(breakoutIndices(exactBoundary, 252, 63).indices, [317]);
});

check('close-only prices compute safe indicators but refuse OHLC and volume claims', () => {
  const bars = Array.from({ length: 300 }, (_, index) => ({
    date: dateAt(index),
    close: 100 + index * 0.1,
  }));
  const snapshot = technicalSnapshot(bars);
  assert.strictEqual(snapshot.status, 'OK');
  assert.ok(Number.isFinite(snapshot.sma50));
  assert.ok(Number.isFinite(snapshot.rsi14));
  assert.ok(Number.isFinite(snapshot.macd.line));
  assert.strictEqual(snapshot.squeeze.status, 'NOT_COMPUTABLE_OHLC_REQUIRED');
  assert.deepStrictEqual(snapshot.dataCapabilities, { adjustedClose: false, ohlc: false, volume: false });
  const proven = technicalSnapshot(bars, {}, null, {
    adjustmentPolicy: 'point_in_time_total_return', corporateActionKnownAtPolicy: 'point_in_time',
  });
  assert.strictEqual(proven.dataCapabilities.adjustedClose, true);
});

check('volume ratio compares current volume with the previous 120 sessions only', () => {
  const bars = Array.from({ length: 121 }, (_, index) => ({
    date: dateAt(index), close: 100, volume: index === 120 ? 1000 : 100,
  }));
  const snapshot = technicalSnapshot(bars);
  assert.strictEqual(snapshot.volumeRatio120, 10);
});

check('M1 inputs require 63/126 relative strength versus sector and broad market', () => {
  const bars = Array.from({ length: 200 }, (_, index) => ({ date: dateAt(index), close: 100 + index }));
  const benchmark = Array.from({ length: 200 }, (_, index) => ({ date: dateAt(index), close: 100 + index / 2 }));
  const snapshot = technicalSnapshot(bars, { sectorBars: benchmark, marketBars: benchmark });
  assert.ok(Object.values(snapshot.relativeStrength).every((value) => Number.isFinite(value.relativeReturn)));
});

check('market recognition is internally derived from raw PIT price inputs', () => {
  const market = deriveMarketRecognition(marketInputForM2());
  assert.strictEqual(market.status, 'COMPUTABLE');
  assert.strictEqual(market.level, 2);
  assert.strictEqual(market.marketKnownAt, '2024-01-31T21:00:00.000Z');
  assert.strictEqual(market.signalAvailableAt, '2024-02-01T14:30:00.000Z');
  const unproven = marketInputForM2();
  unproven.priceMetadata = {};
  assert.strictEqual(deriveMarketRecognition(unproven).status, 'NOT_COMPUTABLE');
  const bars = Array.from({ length: 320 }, (_, index) => ({
    date: new Date(Date.UTC(2023, 2, 18 + index)).toISOString().slice(0, 10),
    close: index < 315 ? 100 : (index === 319 ? 110 : 101),
  }));
  const sector = bars.map((bar, index) => ({ date: bar.date, close: index < 315 ? 100 : 102 }));
  const marketBenchmark = bars.map((bar) => ({ date: bar.date, close: 100 }));
  const signFlip = deriveMarketRecognition({
    entityId: 'ENTITY-1', listingId: 'LISTING-1', vintageMonth: '2024-01', bars,
    benchmarks: { sectorBars: sector, marketBars: marketBenchmark },
    vintageCalendar: [
      { vintageMonth: '2023-12', closeDate: '2023-12-29', closeAt: '2023-12-29T21:00:00Z', nextOpenAt: '2024-01-02T14:30:00Z' },
      { vintageMonth: '2024-01', closeDate: bars[319].date, closeAt: `${bars[319].date}T21:00:00Z`, nextOpenAt: '2024-02-01T14:30:00Z' },
    ],
    priceMetadata: { adjustmentPolicy: 'point_in_time_total_return', corporateActionKnownAtPolicy: 'point_in_time' },
  });
  assert.strictEqual(signFlip.snapshot.relativeStrength.sector126.relativeReturn > 0, true);
  assert.strictEqual(signFlip.level, 2, 'M3 must use sector-relative strength at the breakout close, not month end');
  const skippedMonth = marketInputForM2();
  skippedMonth.vintageCalendar[0].vintageMonth = '1900-01';
  assert.strictEqual(deriveMarketRecognition(skippedMonth).status, 'NOT_COMPUTABLE');
  const duplicateMonth = marketInputForM2();
  duplicateMonth.vintageCalendar.unshift({ ...duplicateMonth.vintageCalendar[0] });
  assert.strictEqual(deriveMarketRecognition(duplicateMonth).reason, 'duplicate_monthly_vintage');
});

check('matrix states are separate from a buy signal and enforce evidence caps', () => {
  const notVisibleRows = quarterRows();
  notVisibleRows.forEach((row) => { row.sectorPercentile = 79; });
  const vintageCalendar = marketInputForM2().vintageCalendar;
  const timing = {
    entityId: 'ENTITY-1', listingId: 'LISTING-1', vintageMonth: '2024-01', vintageCalendar,
    signalKnownAt: '2024-01-01T00:00:00Z', evaluationAt: '2024-01-31T21:00:00Z',
    signalAvailableAt: '2024-02-01T14:30:00Z', growthVisibilityRows: notVisibleRows, themeId: 'THEME-1',
  };
  assert.strictEqual(classifyCandidate({ T: 2, E: 2, L: 1, M: 0, G: 0, dataQuality: 'accepted', dimensionEvidence: dimensionEvidence({ T: 2, E: 2, L: 1, M: 0 }), evidenceSources: evidenceSources({ T: 2, E: 2, L: 1, M: 0 }), ...timing }).state, 'RESEARCH_WATCH');
  const preGrowth = classifyCandidate({ T: 2, E: 2, L: 2, M: 0, G: 0, dataQuality: 'verified', dimensionEvidence: dimensionEvidence(), evidenceSources: evidenceSources(), ...timing });
  assert.strictEqual(preGrowth.state, 'PRE_GROWTH_CANDIDATE');
  assert.strictEqual(preGrowth.elliottReview, true);
  assert.strictEqual(preGrowth.candidateVintage.vintageCalendarSha256, canonicalSha256(vintageCalendar));
  assert.strictEqual(classifyCandidate({ T: 2, E: 2, L: 2, M: 0, G: 0, dataQuality: 'verified', dimensionEvidence: dimensionEvidence(), evidenceSources: evidenceSources(), ...timing, evaluationAt: '2024-06-30T20:00:00Z' }).state, 'REJECTED_HOLD');
  const marketLevels = { T: 2, E: 2, L: 2, M: 2 };
  const marketEvidence = dimensionEvidence(marketLevels);
  marketEvidence.M.knownAt = '2024-01-31T21:00:00Z';
  const marketSources = evidenceSources(marketLevels);
  const marketSource = marketSources.find((source) => source.sourceId === 'S-M');
  marketSource.sourceClass = 'market_bar';
  delete marketSource.source_published_at;
  marketSource.bar_available_at = '2024-01-31T21:00:00Z';
  marketSource.observed_at = '2024-01-31T21:00:00Z';
  const rawMarketInput = marketInputForM2();
  marketEvidence.M.inputsSha256 = deriveMarketRecognition(rawMarketInput).inputsSha256;
  const marketTiming = { ...timing, listingId: 'LISTING-1', vintageMonth: '2024-01', evaluationAt: '2024-01-31T21:00:00Z', signalKnownAt: '2024-01-31T21:00:00Z', signalAvailableAt: '2024-02-01T14:30:00Z', marketInput: rawMarketInput };
  assert.strictEqual(classifyCandidate({ T: 2, E: 2, L: 2, M: 2, G: 0, dataQuality: 'accepted', dimensionEvidence: marketEvidence, evidenceSources: marketSources, ...marketTiming }).state, 'MARKET_CONFIRMING');
  const backdatedMarketEvidence = JSON.parse(JSON.stringify(marketEvidence));
  backdatedMarketEvidence.M.knownAt = '2024-01-01T00:00:00Z';
  const backdatedMarketSources = JSON.parse(JSON.stringify(marketSources));
  const backdatedSource = backdatedMarketSources.find((source) => source.sourceId === 'S-M');
  backdatedSource.bar_available_at = '2024-01-01T00:00:00Z';
  backdatedSource.observed_at = '2024-01-01T00:00:00Z';
  assert.strictEqual(classifyCandidate({ T: 2, E: 2, L: 2, M: 2, G: 0, dataQuality: 'accepted', dimensionEvidence: backdatedMarketEvidence, evidenceSources: backdatedMarketSources, ...marketTiming, signalKnownAt: '2024-01-01T00:00:00Z' }).state, 'PRE_GROWTH_CANDIDATE');
  assert.strictEqual(classifyCandidate({ T: 2, E: 2, L: 2, M: 2, G: 0, dataQuality: 'accepted', dimensionEvidence: marketEvidence, evidenceSources: marketSources, ...marketTiming, marketInput: undefined }).state, 'PRE_GROWTH_CANDIDATE');
  const foreignMarket = { ...rawMarketInput, entityId: 'OTHER' };
  const foreignEvidence = JSON.parse(JSON.stringify(marketEvidence));
  foreignEvidence.M.inputsSha256 = deriveMarketRecognition(foreignMarket).inputsSha256;
  assert.strictEqual(classifyCandidate({ T: 2, E: 2, L: 2, M: 2, G: 0, dataQuality: 'accepted', dimensionEvidence: foreignEvidence, evidenceSources: marketSources, ...marketTiming, marketInput: foreignMarket }).state, 'PRE_GROWTH_CANDIDATE');
  const unprovenMarket = marketInputForM2();
  unprovenMarket.priceMetadata = {};
  const optionalMarketFailure = classifyCandidate({ T: 2, E: 2, L: 2, M: 0, G: 0, dataQuality: 'accepted', dimensionEvidence: dimensionEvidence(), evidenceSources: evidenceSources(), ...timing, marketInput: unprovenMarket });
  assert.strictEqual(optionalMarketFailure.state, 'PRE_GROWTH_CANDIDATE');
  assert.strictEqual(optionalMarketFailure.elliottReview, true);
  assert.strictEqual(classifyCandidate({ T: 0, E: 0, L: 0, M: 0, G: 1, dataQuality: 'accepted' }).state, 'GQS_CONFIRMED');
  const independentGqs = classifyCandidate({ T: 2, E: 2, L: 0, M: 0, G: 1, dataQuality: 'accepted' });
  assert.strictEqual(independentGqs.state, 'GQS_CONFIRMED');
  assert.strictEqual(independentGqs.elliottReview, false);
  assert.strictEqual(classifyCandidate({ T: 3, E: 3, L: 2, managementOnly: true, dataQuality: 'accepted', dimensionEvidence: dimensionEvidence({ T: 3, E: 3, L: 2, M: 0 }), evidenceSources: evidenceSources({ T: 3, E: 3, L: 2, M: 0 }), ...timing }).state, 'REJECTED_HOLD');
  assert.ok(classifyCandidate({ T: 2, E: 2, L: 2, dataQuality: 'accepted' }).reasons.some((reason) => reason.startsWith('core_evidence_timing_invalid')));
  assert.strictEqual(classifyCandidate({ T: 2, E: 2, L: 2, M: 0, dataQuality: 'accepted', dimensionEvidence: dimensionEvidence(), evidenceSources: evidenceSources(), ...timing, growthVisibilityRows: quarterRows() }).state, 'RESEARCH_WATCH');
  const crossTheme = dimensionEvidence();
  crossTheme.E.themeId = 'OTHER-THEME';
  assert.strictEqual(classifyCandidate({ T: 2, E: 2, L: 2, dataQuality: 'accepted', dimensionEvidence: crossTheme, evidenceSources: evidenceSources(), ...timing }).state, 'REJECTED_HOLD');
  const callerCannotMoveSignal = classifyCandidate({ T: 2, E: 2, L: 2, dataQuality: 'accepted', dimensionEvidence: dimensionEvidence(), evidenceSources: evidenceSources(), ...timing, signalKnownAt: '2024-01-02T00:00:00Z' });
  assert.strictEqual(callerCannotMoveSignal.state, 'PRE_GROWTH_CANDIDATE');
  assert.strictEqual(callerCannotMoveSignal.signalKnownAt, '2024-01-01T00:00:00.000Z');
  const forgedVisibility = { status: 'COMPUTABLE', ruleVersion: 'FEM_VISIBLE_GROWTH_V1', entityId: 'ENTITY-1', evaluationAt: '2024-01-31T21:00:00.000Z', knownAt: '2024-01-01T00:00:00Z', visible: false, inputsSha256: 'a'.repeat(64) };
  assert.strictEqual(classifyCandidate({ T: 2, E: 2, L: 2, dataQuality: 'accepted', dimensionEvidence: dimensionEvidence(), evidenceSources: evidenceSources(), ...timing, growthVisibility: forgedVisibility, growthVisibilityRows: quarterRows() }).state, 'RESEARCH_WATCH');
  assert.deepStrictEqual(evaluateLead('2024-01-01T00:00:00Z', '2024-07-01T00:00:00Z'), {
    precedesOutcome: true, differenceMs: 15724800000, differenceDays: 182,
  });
  assert.throws(() => classifyCandidate({ T: 0, E: 0, L: 0, M: 0, G: 3, dataQuality: 'accepted' }), /G must be/);
});

check('five clocks require timestamp, source and status independently', () => {
  const evaluationAt = '2024-01-02T00:00:00Z';
  const complete = Object.fromEntries(['theme', 'beneficiary', 'operations', 'market', 'fundamental']
    .map((name) => [name, { knownAt: '2024-01-01T00:00:00Z', sourceId: `S-${name}`, status: 'observed' }]));
  const sources = Object.keys(complete).map((name) => ({
    sourceId: `S-${name}`, sourceClass: 'public_web',
    source_published_at: '2024-01-01T00:00:00Z', observed_at: '2024-01-01T00:00:00Z',
  }));
  assert.strictEqual(validateFiveClocks(complete, sources, evaluationAt).valid, true);
  delete complete.market.sourceId;
  assert.deepStrictEqual(validateFiveClocks(complete, sources, evaluationAt).issues, ['market:sourceId_missing']);
  complete.market.sourceId = 'S-market';
  complete.market.knownAt = 'garbage';
  assert.ok(validateFiveClocks(complete, sources, evaluationAt).issues.includes('market:knownAt_invalid'));
});

check('claim ledger rejects unsourced facts and indirect source placeholders', () => {
  const good = validateClaimLedger([
    { claimId: 'C-1', claimText: 'A sourced fact.', type: 'fact', sourceIds: ['S-1'], status: 'verified', counterevidence: ['scope limitation'], versionStatus: 'current' },
    { claimId: 'C-2', claimText: 'An open hypothesis.', type: 'hypothesis', sourceIds: [], status: 'open', counterevidence: ['not tested'], versionStatus: 'current' },
  ], [{
    sourceId: 'S-1',
    sourceClass: 'public_web',
    url: 'https://www.sec.gov/example',
    publishedAt: '2024-01-01T00:00:00Z',
    knownAt: '2024-01-01T00:00:00Z',
    observedAt: '2024-01-01T00:00:00Z',
    locator: 'section 1',
    evidenceQuality: 'primary',
  }], '2024-01-02T00:00:00Z');
  assert.strictEqual(good.valid, true);
  const bad = validateClaimLedger([
    { claimId: 'C-3', claimText: 'Unsourced fact.', type: 'fact', sourceIds: [], status: 'draft', counterevidence: [], versionStatus: 'draft' },
  ], []);
  assert.ok(bad.issues.includes('C-3:fact_without_source'));
  const badTime = validateClaimLedger([], [{
    sourceId: 'S-X', sourceClass: 'public_web', url: 'https://www.sec.gov/example', publishedAt: '2024-01-01',
    knownAt: 'garbage', locator: 'section', evidenceQuality: 'primary',
  }], '2024-01-02T00:00:00Z');
  assert.ok(badTime.issues.includes('S-X:availability_contract_invalid'));
  const missingClass = validateClaimLedger([], [{
    sourceId: 'S-Y', url: 'https://www.sec.gov/example', publishedAt: '2024-01-01T00:00:00Z',
    knownAt: '2024-01-01T01:00:00Z', locator: 'section', evidenceQuality: 'primary',
  }], '2024-01-02T00:00:00Z');
  assert.ok(missingClass.issues.includes('S-Y:availability_contract_invalid'));
  const noEvaluation = validateClaimLedger([], []);
  assert.ok(noEvaluation.issues.includes('evaluationAt_invalid_or_missing'));
  const mismatchedKnownAt = validateClaimLedger([], [{
    sourceId: 'S-Z', sourceClass: 'public_web', url: 'https://www.sec.gov/example',
    publishedAt: '2024-01-01T00:00:00Z', observedAt: '2024-01-03T00:00:00Z',
    knownAt: '2024-01-02T00:00:00Z', locator: 'section', evidenceQuality: 'primary',
  }], '2024-01-04T00:00:00Z');
  assert.ok(mismatchedKnownAt.issues.includes('S-Z:knownAt_mismatch'));
});

check('AI removal is fail-closed below 95 percent evidence coverage', () => {
  const rows = Array.from({ length: 20 }, (_, index) => ({
    entityId: `E${index}`, listingId: `L${index}`, evaluationAt: '2024-06-01T00:00:00Z',
  }));
  const evidenceFor = (row, index) => ({
    entityId: row.entityId, listingId: row.listingId,
    effectiveFrom: '2024-01-01T00:00:00Z', effectiveTo: null,
    sourceClass: 'public_web', source_published_at: '2024-01-01T00:00:00Z', observed_at: '2024-01-02T00:00:00Z',
    sourceId: `S-${row.entityId}`,
    aiClass: index < 2 ? 'direct' : 'independent',
    materialEvidenceType: index < 2 ? 'revenue' : null,
  });
  const lowLedger = rows.slice(0, 18).map((row, index) => ({
    ...evidenceFor(row, index),
    aiClass: 'independent',
  }));
  assert.strictEqual(aiRemoval(rows, lowLedger, 'material').status, 'NOT_READY');
  const exact95 = aiRemoval(rows, rows.slice(0, 19).map(evidenceFor), 'direct');
  assert.strictEqual(exact95.status, 'NOT_READY');
  assert.strictEqual(exact95.sensitivityBoundsAvailable, true);
  assert.strictEqual(exact95.bounds.unknownIncludedAsNonAi.kept.length + exact95.bounds.unknownIncludedAsNonAi.removed.length, 20);
  assert.strictEqual(exact95.bounds.unknownRemovedWithAi.kept.length + exact95.bounds.unknownRemovedWithAi.removed.length, 20);
  const fullLedger = rows.map(evidenceFor);
  const result = aiRemoval(rows, fullLedger, 'direct');
  assert.strictEqual(result.status, 'READY');
  assert.strictEqual(result.removed.length, 2);
  assert.strictEqual(result.kept.length, 18);
  const overlapping = [...fullLedger, { ...fullLedger[0], sourceId: 'S-overlap' }];
  const overlapResult = aiRemoval(rows, overlapping, 'direct');
  assert.strictEqual(overlapResult.status, 'NOT_READY');
  assert.deepStrictEqual(overlapResult.unclassifiedEntities, [{ entityId: 'E0', listingId: 'L0' }]);
  const duplicateInput = aiRemoval([...rows, { ...rows[0] }], fullLedger, 'direct');
  assert.strictEqual(duplicateInput.reason, 'duplicate_input_observation_key');
  assert.strictEqual(duplicateInput.primaryResultAllowed, false);
});

check('confirmatory result computation is blocked until every PIT gate passes', () => {
  const required = {
    protocolSealed: true,
    confirmatoryAnalysisImplementationSealed: true,
    entityListingLedger: true,
    appendOnlySecStore: true,
    historicalUniverse: true,
    asOfLeakageGate: true,
    adjustedOhlcv: true,
    corporateActionsDelistings: true,
    historicalGqsAdapter: true,
    conceptMapFrozen: true,
    independentAuditPassed: true,
    blindCodingAgreementPassed: true,
    researchCorpusSealed: true,
  };
  assert.strictEqual(evaluateReadiness({ ...required, historicalUniverse: false }).resultComputationAllowed, false);
  assert.strictEqual(evaluateReadiness(required).resultComputationAllowed, true);
  assert.strictEqual(evaluateReadiness().resultComputationAllowed, false);
  assert.strictEqual(evaluateReadiness(null).missing.length, 13);
  assert.strictEqual(evaluateReadiness({}).status, 'NOT_READY_TO_EXECUTE');
});

check('primary theme selection is coherent and deterministic', () => {
  const selected = selectPrimaryTheme([
    { entityId: 'E1', themeId: 'Z', T: 3, E: 2, L: 2, knownAt: '2024-01-01T00:00:00Z', evidenceAccepted: true },
    { entityId: 'E1', themeId: 'A', T: 3, E: 2, L: 2, knownAt: '2024-01-01T00:00:00Z', evidenceAccepted: true },
    { entityId: 'E1', themeId: 'FUTURE-HIGH', T: 3, E: 3, L: 3, knownAt: '2024-02-01T00:00:00Z', evidenceAccepted: true },
    { entityId: 'E1', themeId: 'L1-INELIGIBLE', T: 3, E: 3, L: 1, knownAt: '2023-01-01T00:00:00Z', evidenceAccepted: true },
    { entityId: 'E2', themeId: 'OTHER-ENTITY', T: 3, E: 3, L: 3, knownAt: '2023-01-01T00:00:00Z', evidenceAccepted: true },
  ], 'E1', '2024-01-31T21:00:00Z');
  assert.strictEqual(selected.themeId, 'A');
  assert.strictEqual(selectPrimaryTheme([], 'E1', '2024-01-31T21:00:00Z'), null);
});

check('monthly primary signals count the first eligible transition once per entity', () => {
  const vintageCalendar = [
    { vintageMonth: '2024-01', closeDate: '2024-01-31', closeAt: '2024-01-31T21:00:00Z', nextOpenAt: '2024-02-01T14:30:00Z' },
    { vintageMonth: '2024-02', closeDate: '2024-02-29', closeAt: '2024-02-29T21:00:00Z', nextOpenAt: '2024-03-01T14:30:00Z' },
    { vintageMonth: '2024-03', closeDate: '2024-03-28', closeAt: '2024-03-28T20:00:00Z', nextOpenAt: '2024-04-01T13:30:00Z' },
    { vintageMonth: '2024-04', closeDate: '2024-04-30', closeAt: '2024-04-30T20:00:00Z', nextOpenAt: '2024-05-01T13:30:00Z' },
    { vintageMonth: '2024-05', closeDate: '2024-05-31', closeAt: '2024-05-31T20:00:00Z', nextOpenAt: '2024-06-03T13:30:00Z' },
  ];
  const calendarHash = canonicalSha256(vintageCalendar);
  const timing = Object.fromEntries(vintageCalendar.map((item) => [item.vintageMonth, item]));
  const rows = [
    ['2024-01', 'RESEARCH_WATCH'], ['2024-02', 'PRE_GROWTH_CANDIDATE'],
    ['2024-03', 'PRE_GROWTH_CANDIDATE'], ['2024-04', 'RESEARCH_WATCH'],
    ['2024-05', 'MARKET_CONFIRMING'],
  ].map(([vintageMonth, state]) => ({
    entityId: 'E1', listingId: 'L1', vintageMonth, state, isPrimaryListing: true,
    evaluationAt: timing[vintageMonth].closeAt,
    signalAvailableAt: timing[vintageMonth].nextOpenAt,
    historyCompleteFrom: '2024-01',
    ...(state === 'PRE_GROWTH_CANDIDATE' || state === 'MARKET_CONFIRMING' ? { candidateVintage: {
      vintageMonth, evaluationAt: timing[vintageMonth].closeAt,
      signalAvailableAt: timing[vintageMonth].nextOpenAt, vintageCalendarSha256: calendarHash,
    } } : {}),
    ...(state === 'MARKET_CONFIRMING' ? { marketRecognition: {
      status: 'COMPUTABLE', entityId: 'E1', listingId: 'L1', vintageMonth,
      marketKnownAt: timing[vintageMonth].closeAt, signalAvailableAt: timing[vintageMonth].nextOpenAt,
      vintageCalendarSha256: calendarHash,
    } } : {}),
  }));
  const selected = selectPrimarySignals(rows, vintageCalendar);
  assert.strictEqual(selected.length, 1);
  assert.strictEqual(selected[0].vintageMonth, '2024-02');
  assert.strictEqual(selected[0].signalAvailableAt, '2024-03-01T14:30:00Z');
  assert.strictEqual(selected[0].vintageCalendarSha256, calendarHash);
  const backdated = JSON.parse(JSON.stringify(rows));
  backdated[1].signalAvailableAt = '2024-02-02T14:30:00Z';
  assert.throws(() => selectPrimarySignals(backdated, vintageCalendar), /must equal sealed next open/);
  const gapped = rows.filter((row) => row.vintageMonth !== '2024-02');
  assert.throws(() => selectPrimarySignals(gapped, vintageCalendar), /incomplete entity-month panel/);
  const leftCensored = rows.slice(1);
  leftCensored.forEach((row) => { row.historyCompleteFrom = '2024-02'; });
  assert.throws(() => selectPrimarySignals(leftCensored, vintageCalendar), /first eligible row is left-censored/);
});

check('matching is deterministic, caliper-bounded and excludes prior signals', () => {
  const signal = {
    entityId: 'S', listingId: 'LS', sectorBranch: 'TECH', vintageMonth: '2024-01', marketRegime: 'bull',
    isPrimaryListing: true,
    marketCapUsd: 1e9, listingAgeSessions: 1000, sectorRelativeReturn126: 0.20, medianDollarVolume120Usd: 1e7,
  };
  const base = { sectorBranch: 'TECH', vintageMonth: '2024-01', marketRegime: 'bull', state: 'RESEARCH_WATCH', neverPrimarySignalled: true, isPrimaryListing: true, marketCapUsd: 1e9, listingAgeSessions: 1000, sectorRelativeReturn126: 0.20, medianDollarVolume120Usd: 1e7 };
  const controls = [
    { ...base, entityId: 'B', listingId: 'L2' },
    { ...base, entityId: 'B', listingId: 'L2-SECOND' },
    { ...base, entityId: 'A', listingId: 'L1' },
    { ...base, entityId: 'S', listingId: 'SELF' },
    { ...base, entityId: 'C', listingId: 'L3', neverPrimarySignalled: false },
    { ...base, entityId: 'D', listingId: 'L4', sectorRelativeReturn126: 0.36 },
  ];
  assert.deepStrictEqual(matchControls(signal, controls).map((row) => row.entityId), ['A', 'B']);
  assert.throws(() => matchControls(signal, controls, { ratio: 1 }), /parameters are fixed/);
  assert.throws(() => matchControls({ ...signal, marketRegime: undefined }, controls), /exact fields/);
  assert.deepStrictEqual(matchControls(signal, controls.map((row) => ({ ...row, sectorBranch: undefined }))), []);
  const secondSignal = { ...signal, entityId: 'A', listingId: 'LS2', signalAvailableAt: '2024-02-01T14:30:00Z', isPrimarySignal: true };
  signal.signalAvailableAt = '2024-02-01T14:30:00Z';
  signal.isPrimarySignal = true;
  const panel = matchControlPanel([signal, secondSignal], controls);
  assert.strictEqual(new Set(panel.flatMap((item) => item.controls.map((row) => row.entityId))).size,
    panel.flatMap((item) => item.controls).length);
  assert.ok(!panel.flatMap((item) => item.controls).some((row) => row.entityId === 'A'),
    'an entity that is ever a primary signal cannot also serve as a control');
  assert.throws(() => matchControlPanel([signal, { ...signal }], controls), /exactly one primary signal/);
});

check('Wilson and H-FEM gates are fail-closed', () => {
  const interval = wilsonInterval(70, 100);
  assert.ok(interval.lower < 0.70 && interval.upper > 0.70);
  const gates = Object.fromEntries([
    'minimumMatureEvents', 'minimumUniquePrimarySignals', 'minimumFuturePositivesPerArm', 'readinessComplete',
    'primaryBootstrapComputable', 'technicalIncrementalityComputable', 'nonAiEvidenceReady', 'nonAiMinimumSample',
    'precisionLift', 'precisionInterval', 'medianLead', 'preBreakoutDifference', 'preBreakoutInterval',
    'unmatchedRate', 'themeConcentration', 'microcapConcentration', 'marketRegimeConcentration',
    'nonAiRobustness', 'technicalLogLossGain', 'technicalLogLossInterval',
  ].map((gate) => [gate, true]));
  assert.strictEqual(evaluateHFem(gates).status, 'HFEM_PASSED');
  assert.strictEqual(evaluateHFem({ ...gates, minimumMatureEvents: false }).status, 'INCONCLUSIVE');
  assert.strictEqual(evaluateHFem({ ...gates, precisionLift: false }).status, 'AUTOMATION_REJECTED');
});

check('seal timestamps cannot precede the frozen protocol timestamp', () => {
  const manifest = buildManifest({}, '2026-08-08T14:00:01Z', '2026-08-08T14:00:00Z');
  assert.strictEqual(manifest.sealedAt, '2026-08-08T14:00:01Z');
  assert.throws(() => buildManifest({}, '2026-08-08T13:59:59Z', '2026-08-08T14:00:00Z'), /at or after/);
});

check('outcome access ledger starts clean and matches its sealed genesis declaration', () => {
  const result = verifyOutcomeAccessLedger(true);
  assert.ok(result.events >= 0);
  if (result.events === 0) {
    assert.strictEqual(result.head, 'a3185c8d8398c1dc269e5d58ee1c1ba83c787154de6dfb7821eff33edf1ba498');
  }
  const laterRemoteCheckpoint = {
    schema: 'early-detection-outcome-access-checkpoint/v1', protocol: 'FEM-SEC-US@1.2.0', remoteRef: 'origin/main',
    eventCount: 1, head: 'a'.repeat(64), ledgerSha256: 'b'.repeat(64), checkpointedAt: '2026-08-08T16:00:00Z',
  };
  assert.ok(outcomeCheckpointIssues({ eventCount: 0, head: result.head, ledgerSha256: 'c'.repeat(64) },
    laterRemoteCheckpoint, laterRemoteCheckpoint).includes('ledger:current_state_not_exactly_checkpointed'));
  const event = { previousHash: result.head, accessAt: '2026-08-08T16:00:00Z', actor: 'auditor', scope: 'locked labels', purpose: 'registered run' };
  event.eventHash = canonicalSha256(event);
  const oneEventLedger = { events: [event] };
  const oneEventCheckpoint = { eventCount: 1, head: event.eventHash, ledgerSha256: 'd'.repeat(64) };
  const rollbackIssues = outcomeCheckpointHistoryIssues([
    { ledger: oneEventLedger, checkpoint: oneEventCheckpoint, ledgerSha256: 'd'.repeat(64) },
    { ledger: { events: [] }, checkpoint: { eventCount: 0, head: result.head, ledgerSha256: 'e'.repeat(64) }, ledgerSha256: 'e'.repeat(64) },
  ], result.head);
  assert.ok(rollbackIssues.some((issue) => issue.includes('non_monotone_or_non_prefix')));
});

check('seal test inventory is deterministic and isolates all external discovery smokes', () => {
  const files = deterministicTestFiles();
  assert.ok(files.includes('tests/early-detection.test.js'));
  assert.ok(files.length >= 100);
  assert.ok(!files.some((file) => file.startsWith('tests/discovery/')));
});

if (failures) {
  console.error(`early-detection: ${failures} failure(s)`);
  process.exit(1);
}
console.log('early-detection: all tests passed');

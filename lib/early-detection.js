'use strict';

/**
 * Research-only helpers for the early-detection programme.
 *
 * This module is deliberately outside src/scoring. It must never feed
 * SCORE_WEIGHTS, board routing, ranking or the productive GQS pipeline.
 */

const crypto = require('node:crypto');

const DAY_MS = 24 * 60 * 60 * 1000;
const ACCEPTED_DATA_QUALITY = new Set(['accepted', 'verified']);
const AI_CLASSES = new Set(['direct', 'infrastructure', 'indirect', 'narrative', 'independent', 'unknown']);
const MATERIAL_AI_EVIDENCE = new Set(['revenue', 'backlog', 'capex', 'necessary_product_function']);
const SOURCE_AVAILABILITY_FIELDS = Object.freeze({
  sec_filing: ['accepted_at', 'observed_at'],
  issuer_release: ['source_published_at', 'observed_at'],
  government_publication: ['source_published_at', 'observed_at'],
  research_publication: ['source_published_at', 'observed_at'],
  public_web: ['source_published_at', 'observed_at'],
  market_bar: ['bar_available_at', 'observed_at'],
});

function finite(value) {
  return Number.isFinite(value) ? value : null;
}

function parseTime(value, field) {
  if (value == null || value === '') return null;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) throw new Error(`[early-detection] ${field} is not a valid timestamp: ${value}`);
  return ms;
}

function parseAvailabilityTimestamp(value, field) {
  const match = typeof value === 'string'
    ? /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|([+-])(\d{2}):(\d{2}))$/.exec(value)
    : null;
  if (!match) {
    throw new Error(`[early-detection] ${field} must be a timezone-qualified timestamp, not a date-only value`);
  }
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, fraction = '', zone, sign, offsetHourText, offsetMinuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const millisecond = Number(fraction.padEnd(3, '0'));
  const daysInMonth = month >= 1 && month <= 12 ? new Date(Date.UTC(year, month, 0)).getUTCDate() : 0;
  const offsetHour = zone === 'Z' ? 0 : Number(offsetHourText);
  const offsetMinute = zone === 'Z' ? 0 : Number(offsetMinuteText);
  const validOffset = offsetHour < 14 || (offsetHour === 14 && offsetMinute === 0);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth
    || hour > 23 || minute > 59 || second > 59 || !validOffset || offsetMinute > 59) {
    throw new Error(`[early-detection] ${field} is not a real calendar timestamp: ${value}`);
  }
  const signedOffsetMinutes = zone === 'Z' ? 0 : (sign === '+' ? 1 : -1) * (offsetHour * 60 + offsetMinute);
  const utcMs = Date.UTC(year, month - 1, day, hour, minute, second, millisecond) - signedOffsetMinutes * 60 * 1000;
  if (!Number.isFinite(utcMs)) throw new Error(`[early-detection] ${field} is not a valid timestamp: ${value}`);
  return utcMs;
}

function knownAt(record) {
  const candidates = [
    ['observed_at', record && record.observed_at],
    ['source_published_at', record && record.source_published_at],
    ['accepted_at', record && record.accepted_at],
    ['bar_available_at', record && record.bar_available_at],
  ].map(([field, value]) => [field, value == null || value === '' ? null : parseAvailabilityTimestamp(value, field)])
    .filter(([, value]) => value != null);
  if (!candidates.length) return null;
  return new Date(Math.max(...candidates.map(([, value]) => value))).toISOString();
}

function assertAvailabilityContract(record) {
  if (!record || typeof record !== 'object') throw new Error('[early-detection] availability record is required');
  if (typeof record.sourceClass !== 'string' || !record.sourceClass) {
    throw new Error('[early-detection] sourceClass is required');
  }
  const required = SOURCE_AVAILABILITY_FIELDS[record.sourceClass];
  if (!required) throw new Error(`[early-detection] unknown sourceClass: ${record.sourceClass}`);
  for (const field of required) {
    if (record[field] == null || record[field] === '') {
      throw new Error(`[early-detection] required availability timestamp missing: ${field}`);
    }
    parseAvailabilityTimestamp(record[field], field);
  }
  return true;
}

function assertKnownAt(record, evaluationAt) {
  if (evaluationAt == null || evaluationAt === '') throw new Error('[early-detection] evaluation_at is required');
  const evaluationMs = parseAvailabilityTimestamp(evaluationAt, 'evaluation_at');
  assertAvailabilityContract(record);
  const known = knownAt(record);
  if (known == null) throw new Error('[early-detection] fact has no usable availability timestamp');
  if (Date.parse(known) > evaluationMs) {
    throw new Error(`[early-detection] look-ahead: known_at ${known} is after evaluation_at ${evaluationAt}`);
  }
  return known;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = canonicalize(value[key]);
    return out;
  }
  return value;
}

function canonicalSha256(value) {
  return crypto.createHash('sha256').update(JSON.stringify(canonicalize(value)), 'utf8').digest('hex');
}

function previousCalendarMonth(vintageMonth) {
  if (!/^\d{4}-\d{2}$/.test(String(vintageMonth))) return null;
  const [year, month] = vintageMonth.split('-').map(Number);
  if (month < 1 || month > 12) return null;
  const date = new Date(Date.UTC(year, month - 2, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function validateVintageCalendar(vintageCalendar) {
  if (!Array.isArray(vintageCalendar) || !vintageCalendar.length) {
    throw new Error('[early-detection] sealed vintage calendar is required');
  }
  const calendar = vintageCalendar.slice().sort((a, b) => String(a.vintageMonth).localeCompare(String(b.vintageMonth)));
  if (new Set(calendar.map((item) => item && item.vintageMonth)).size !== calendar.length) {
    throw new Error('[early-detection] duplicate monthly vintage');
  }
  const byMonth = new Map();
  for (let index = 0; index < calendar.length; index += 1) {
    const item = calendar[index];
    if (!item || !/^\d{4}-\d{2}$/.test(String(item.vintageMonth))
      || !/^\d{4}-\d{2}-\d{2}$/.test(String(item.closeDate))
      || !String(item.closeDate).startsWith(`${item.vintageMonth}-`)) {
      throw new Error('[early-detection] invalid monthly vintage identity or close date');
    }
    if (index > 0 && calendar[index - 1].vintageMonth !== previousCalendarMonth(item.vintageMonth)) {
      throw new Error('[early-detection] skipped monthly vintage');
    }
    const closeMs = parseAvailabilityTimestamp(item.closeAt, 'closeAt');
    const nextOpenMs = parseAvailabilityTimestamp(item.nextOpenAt, 'nextOpenAt');
    if (!String(item.closeAt).startsWith(`${item.closeDate}T`) || nextOpenMs <= closeMs) {
      throw new Error('[early-detection] invalid monthly close/open timestamps');
    }
    byMonth.set(item.vintageMonth, { ...item, closeMs, nextOpenMs });
  }
  return { calendar, byMonth, sha256: canonicalSha256(calendar) };
}

function mean(values) {
  const xs = values.filter(Number.isFinite);
  return xs.length ? xs.reduce((sum, value) => sum + value, 0) / xs.length : null;
}

function median(values) {
  const xs = values.filter(Number.isFinite).slice().sort((a, b) => a - b);
  if (!xs.length) return null;
  const middle = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[middle] : (xs[middle - 1] + xs[middle]) / 2;
}

function standardDeviation(values, sample = false) {
  const xs = values.filter(Number.isFinite);
  const denominator = xs.length - (sample ? 1 : 0);
  if (denominator <= 0) return null;
  const mu = mean(xs);
  return Math.sqrt(xs.reduce((sum, value) => sum + (value - mu) ** 2, 0) / denominator);
}

function sma(values, period, endIndex = values.length - 1) {
  if (!Number.isInteger(period) || period <= 0 || endIndex < period - 1) return null;
  return mean(values.slice(endIndex - period + 1, endIndex + 1));
}

function emaSeries(values, period) {
  if (!Number.isInteger(period) || period <= 0) throw new Error('[early-detection] EMA period must be positive');
  const out = Array(values.length).fill(null);
  if (values.length < period) return out;
  const seed = mean(values.slice(0, period));
  if (!Number.isFinite(seed)) return out;
  const alpha = 2 / (period + 1);
  out[period - 1] = seed;
  for (let index = period; index < values.length; index++) {
    if (!Number.isFinite(values[index]) || !Number.isFinite(out[index - 1])) continue;
    out[index] = alpha * values[index] + (1 - alpha) * out[index - 1];
  }
  return out;
}

function rsi(values, period = 14, endIndex = values.length - 1) {
  if (endIndex < period || period <= 0) return null;
  let gains = 0;
  let losses = 0;
  for (let index = 1; index <= period; index++) {
    const change = values[index] - values[index - 1];
    if (!Number.isFinite(change)) return null;
    if (change > 0) gains += change;
    else losses -= change;
  }
  let averageGain = gains / period;
  let averageLoss = losses / period;
  for (let index = period + 1; index <= endIndex; index++) {
    const change = values[index] - values[index - 1];
    if (!Number.isFinite(change)) return null;
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;
    averageGain = ((period - 1) * averageGain + gain) / period;
    averageLoss = ((period - 1) * averageLoss + loss) / period;
  }
  if (averageLoss === 0) return averageGain === 0 ? 50 : 100;
  return 100 - (100 / (1 + averageGain / averageLoss));
}

function macd(values, fast = 12, slow = 26, signal = 9, endIndex = values.length - 1) {
  const fastSeries = emaSeries(values, fast);
  const slowSeries = emaSeries(values, slow);
  const line = values.map((_, index) => (
    Number.isFinite(fastSeries[index]) && Number.isFinite(slowSeries[index])
      ? fastSeries[index] - slowSeries[index]
      : null
  ));
  const compact = [];
  const compactToOriginal = [];
  line.forEach((value, index) => {
    if (Number.isFinite(value)) {
      compact.push(value);
      compactToOriginal.push(index);
    }
  });
  const signalCompact = emaSeries(compact, signal);
  const signalSeries = Array(values.length).fill(null);
  signalCompact.forEach((value, index) => {
    if (Number.isFinite(value)) signalSeries[compactToOriginal[index]] = value;
  });
  const macdLine = line[endIndex];
  const signalLine = signalSeries[endIndex];
  return {
    line: finite(macdLine),
    signal: finite(signalLine),
    histogram: Number.isFinite(macdLine) && Number.isFinite(signalLine) ? macdLine - signalLine : null,
  };
}

function normalizeBars(bars) {
  if (!Array.isArray(bars)) return [];
  const seen = new Set();
  return bars.filter((bar) => {
    if (!bar || !/^\d{4}-\d{2}-\d{2}$/.test(String(bar.date)) || !(bar.close > 0)) return false;
    if (seen.has(bar.date)) return false;
    seen.add(bar.date);
    return true;
  }).map((bar) => ({
    date: bar.date,
    open: finite(bar.open),
    high: finite(bar.high),
    low: finite(bar.low),
    close: bar.close,
    volume: finite(bar.volume),
  })).sort((a, b) => a.date.localeCompare(b.date));
}

function breakoutIndices(bars, lookback = 252, quietSessions = 63) {
  const clean = normalizeBars(bars);
  const indices = [];
  let previousRawBreakout = -Infinity;
  for (let index = lookback; index < clean.length; index++) {
    const previousHigh = Math.max(...clean.slice(index - lookback, index).map((bar) => bar.close));
    if (clean[index].close > previousHigh) {
      const hasMinimumHistory = index >= lookback + quietSessions;
      const quietWindowIsClear = index - previousRawBreakout > quietSessions;
      if (hasMinimumHistory && quietWindowIsClear) indices.push(index);
      previousRawBreakout = index;
    }
  }
  return { bars: clean, indices };
}

function latestBreakout(bars, lookback = 252, quietSessions = 63, endIndex = null) {
  const result = breakoutIndices(bars, lookback, quietSessions);
  const limit = endIndex == null ? result.bars.length - 1 : endIndex;
  const index = result.indices.filter((candidate) => candidate <= limit).at(-1);
  if (index == null) return null;
  return { index, date: result.bars[index].date, close: result.bars[index].close };
}

function alignedReturn(stockBars, benchmarkBars, sessions, endDate = null) {
  const stock = normalizeBars(stockBars);
  const benchmark = new Map(normalizeBars(benchmarkBars).map((bar) => [bar.date, bar.close]));
  const eligible = stock.filter((bar) => (!endDate || bar.date <= endDate) && benchmark.has(bar.date));
  if (eligible.length <= sessions) return null;
  const end = eligible.at(-1);
  const start = eligible[eligible.length - 1 - sessions];
  const stockReturn = end.close / start.close - 1;
  const benchmarkReturn = benchmark.get(end.date) / benchmark.get(start.date) - 1;
  return { stockReturn, benchmarkReturn, relativeReturn: stockReturn - benchmarkReturn };
}

function linearRegressionEndpoint(values) {
  const ys = values.filter(Number.isFinite);
  if (ys.length !== values.length || ys.length < 2) return null;
  const n = ys.length;
  const xMean = (n - 1) / 2;
  const yMean = mean(ys);
  let numerator = 0;
  let denominator = 0;
  for (let index = 0; index < n; index++) {
    numerator += (index - xMean) * (ys[index] - yMean);
    denominator += (index - xMean) ** 2;
  }
  const slope = denominator ? numerator / denominator : 0;
  const intercept = yMean - slope * xMean;
  return intercept + slope * (n - 1);
}

function squeezeMomentum(bars, endIndex = null, settings = {}) {
  const clean = normalizeBars(bars);
  const index = endIndex == null ? clean.length - 1 : endIndex;
  const period = settings.period || 20;
  const bbMultiplier = settings.bbMultiplier || 2;
  const kcMultiplier = settings.kcMultiplier || 1.5;
  if (index < period * 2 - 2 || clean.slice(index - period * 2 + 2, index + 1).some((bar) => (
    !Number.isFinite(bar.high) || !Number.isFinite(bar.low)
  ))) {
    return { status: 'NOT_COMPUTABLE_OHLC_REQUIRED', squeezeOn: null, momentum: null };
  }
  const window = clean.slice(index - period + 1, index + 1);
  const closes = window.map((bar) => bar.close);
  const basis = mean(closes);
  const deviation = standardDeviation(closes);
  const trueRanges = window.map((bar, offset) => {
    const previousClose = offset === 0 ? clean[index - period].close : window[offset - 1].close;
    return Math.max(bar.high - bar.low, Math.abs(bar.high - previousClose), Math.abs(bar.low - previousClose));
  });
  const atr = mean(trueRanges);
  const upperBb = basis + bbMultiplier * deviation;
  const lowerBb = basis - bbMultiplier * deviation;
  const upperKc = basis + kcMultiplier * atr;
  const lowerKc = basis - kcMultiplier * atr;
  const rawMomentum = [];
  for (let endpoint = index - period + 1; endpoint <= index; endpoint++) {
    const regressionWindow = clean.slice(endpoint - period + 1, endpoint + 1);
    const highest = Math.max(...regressionWindow.map((bar) => bar.high));
    const lowest = Math.min(...regressionWindow.map((bar) => bar.low));
    const closeMean = mean(regressionWindow.map((bar) => bar.close));
    const reference = ((highest + lowest) / 2 + closeMean) / 2;
    rawMomentum.push(clean[endpoint].close - reference);
  }
  return {
    status: 'COMPUTABLE',
    squeezeOn: lowerBb > lowerKc && upperBb < upperKc,
    momentum: linearRegressionEndpoint(rawMomentum),
  };
}

function technicalSnapshot(bars, benchmarks = {}, endDate = null, priceMetadata = {}) {
  const clean = normalizeBars(bars).filter((bar) => !endDate || bar.date <= endDate);
  if (!clean.length) return { status: 'NO_PRICE_SERIES' };
  if (Array.isArray(benchmarks)) {
    throw new Error('[early-detection] benchmarks must explicitly provide sectorBars and marketBars');
  }
  const closes = clean.map((bar) => bar.close);
  const index = clean.length - 1;
  const b126 = latestBreakout(clean, 126, 63, index);
  const b252 = latestBreakout(clean, 252, 63, index);
  const sectorBars = benchmarks && benchmarks.sectorBars;
  const marketBars = benchmarks && benchmarks.marketBars;
  const relative = {
    sector63: sectorBars ? alignedReturn(clean, sectorBars, 63, clean[index].date) : null,
    sector126: sectorBars ? alignedReturn(clean, sectorBars, 126, clean[index].date) : null,
    market63: marketBars ? alignedReturn(clean, marketBars, 63, clean[index].date) : null,
    market126: marketBars ? alignedReturn(clean, marketBars, 126, clean[index].date) : null,
  };
  const sq = squeezeMomentum(clean, index);
  const volumeWindow = clean.slice(Math.max(0, index - 120), index).map((bar) => bar.volume);
  const volumeMedian = volumeWindow.every(Number.isFinite) && volumeWindow.length === 120 ? median(volumeWindow) : null;
  const currentVolume = clean[index].volume;
  return {
    status: 'OK',
    asOf: clean[index].date,
    close: clean[index].close,
    sma50: sma(closes, 50, index),
    sma200: sma(closes, 200, index),
    rsi14: rsi(closes, 14, index),
    macd: macd(closes, 12, 26, 9, index),
    breakout126: b126,
    breakout252: b252,
    relativeStrength: relative,
    volumeRatio120: Number.isFinite(currentVolume) && volumeMedian > 0 ? currentVolume / volumeMedian : null,
    squeeze: sq,
    dataCapabilities: {
      adjustedClose: priceMetadata.adjustmentPolicy === 'point_in_time_total_return'
        && priceMetadata.corporateActionKnownAtPolicy === 'point_in_time',
      ohlc: sq.status === 'COMPUTABLE',
      volume: Number.isFinite(currentVolume) && Number.isFinite(volumeMedian),
    },
  };
}

function deriveMarketRecognition(input) {
  if (!input || typeof input.entityId !== 'string' || !input.entityId
    || typeof input.listingId !== 'string' || !input.listingId
    || !/^\d{4}-\d{2}$/.test(String(input.vintageMonth)) || !Array.isArray(input.vintageCalendar)) {
    return { status: 'NOT_COMPUTABLE', level: 0, reason: 'market_identity_or_vintage_calendar_missing' };
  }
  const calendar = input.vintageCalendar.slice().sort((a, b) => a.vintageMonth.localeCompare(b.vintageMonth));
  if (new Set(calendar.map((item) => item && item.vintageMonth)).size !== calendar.length) {
    return { status: 'NOT_COMPUTABLE', level: 0, reason: 'duplicate_monthly_vintage' };
  }
  const currentIndex = calendar.findIndex((item) => item.vintageMonth === input.vintageMonth);
  const current = calendar[currentIndex];
  const previous = calendar[currentIndex - 1];
  if (currentIndex < 1 || !current || !previous
    || previous.vintageMonth !== previousCalendarMonth(input.vintageMonth)
    || !/^\d{4}-\d{2}-\d{2}$/.test(String(current.closeDate))
    || !/^\d{4}-\d{2}-\d{2}$/.test(String(previous.closeDate))
    || !String(current.closeDate).startsWith(`${current.vintageMonth}-`)
    || !String(previous.closeDate).startsWith(`${previous.vintageMonth}-`)
    || previous.closeDate >= current.closeDate) {
    return { status: 'NOT_COMPUTABLE', level: 0, reason: 'consecutive_monthly_vintage_dates_invalid' };
  }
  let currentCloseMs;
  let currentNextOpenMs;
  let previousCloseMs;
  let previousNextOpenMs;
  try {
    currentCloseMs = parseAvailabilityTimestamp(current.closeAt, 'current.closeAt');
    currentNextOpenMs = parseAvailabilityTimestamp(current.nextOpenAt, 'current.nextOpenAt');
    previousCloseMs = parseAvailabilityTimestamp(previous.closeAt, 'previous.closeAt');
    previousNextOpenMs = parseAvailabilityTimestamp(previous.nextOpenAt, 'previous.nextOpenAt');
  } catch (error) {
    return { status: 'NOT_COMPUTABLE', level: 0, reason: 'monthly_vintage_timestamps_invalid' };
  }
  if (!String(current.closeAt).startsWith(`${current.closeDate}T`)
    || !String(previous.closeAt).startsWith(`${previous.closeDate}T`)
    || currentNextOpenMs <= currentCloseMs || previousNextOpenMs <= previousCloseMs) {
    return { status: 'NOT_COMPUTABLE', level: 0, reason: 'monthly_vintage_timestamps_invalid' };
  }
  const snapshot = technicalSnapshot(input.bars, input.benchmarks, current.closeDate, input.priceMetadata);
  if (snapshot.status !== 'OK' || snapshot.asOf !== current.closeDate || !snapshot.dataCapabilities.adjustedClose) {
    return { status: 'NOT_COMPUTABLE', level: 0, reason: 'point_in_time_adjusted_price_contract_missing', snapshot };
  }
  const relativeValues = Object.values(snapshot.relativeStrength || {});
  if (relativeValues.length !== 4 || relativeValues.some((item) => !item || !Number.isFinite(item.relativeReturn))) {
    return { status: 'NOT_COMPUTABLE', level: 0, reason: 'sector_and_market_relative_strength_required', snapshot };
  }
  const allRelativePositive = relativeValues.every((item) => item.relativeReturn > 0);
  const recent126 = snapshot.breakout126 && snapshot.breakout126.date > previous.closeDate;
  const recent252 = snapshot.breakout252 && snapshot.breakout252.date > previous.closeDate;
  const breakoutSector126 = recent252
    ? alignedReturn(input.bars, input.benchmarks.sectorBars, 126, snapshot.breakout252.date)
    : null;
  const sector126PositiveAtBreakout = breakoutSector126 && breakoutSector126.relativeReturn > 0;
  let level = 0;
  if (recent252 && sector126PositiveAtBreakout) level = 3;
  else if (recent126) level = 2;
  else if (allRelativePositive) level = 1;
  return {
    status: 'COMPUTABLE',
    ruleVersion: 'FEM_MARKET_RECOGNITION_V1',
    level,
    entityId: input.entityId,
    listingId: input.listingId,
    vintageMonth: input.vintageMonth,
    asOf: snapshot.asOf,
    marketKnownAt: new Date(currentCloseMs).toISOString(),
    signalAvailableAt: new Date(currentNextOpenMs).toISOString(),
    vintageCalendarSha256: canonicalSha256(calendar),
    previousVintageCloseDate: previous.closeDate,
    inputsSha256: canonicalSha256({
      entityId: input.entityId,
      listingId: input.listingId,
      vintageMonth: input.vintageMonth,
      vintageCalendar: calendar,
      bars: normalizeBars(input.bars),
      sectorBars: normalizeBars(input.benchmarks.sectorBars),
      marketBars: normalizeBars(input.benchmarks.marketBars),
      priceMetadata: input.priceMetadata,
    }),
    snapshot,
  };
}

function growthBreakouts(quarters, options = {}) {
  const percentileMinimum = options.percentileMinimum ?? 80;
  const accelerationMinimum = options.accelerationMinimum ?? 0.05;
  const strictGrowthMinimum = options.strictGrowthMinimum ?? 0.25;
  const events = [];
  const rows = Array.isArray(quarters) ? quarters.slice() : [];
  const byEntity = new Map();
  for (const row of rows) {
    if (!row || typeof row.entityId !== 'string' || !row.entityId) {
      throw new Error('[early-detection] every outcome row requires entityId');
    }
    if (!Number.isInteger(row.fiscalYear) || !Number.isInteger(row.fiscalQuarter)
      || row.fiscalQuarter < 1 || row.fiscalQuarter > 4) {
      throw new Error(`[early-detection] invalid fiscal quarter for ${row.entityId}`);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(row.periodEnd))) {
      throw new Error(`[early-detection] invalid periodEnd for ${row.entityId}`);
    }
    if (row.sourceClass !== 'sec_filing') {
      throw new Error(`[early-detection] growth outcome rows must use sourceClass sec_filing for ${row.entityId}`);
    }
    const filingAvailability = {
      sourceClass: row.sourceClass,
      accepted_at: row.acceptedAt,
      observed_at: row.observedAt,
    };
    assertAvailabilityContract(filingAvailability);
    const filingKnownAtMs = Date.parse(knownAt(filingAvailability));
    const sectorPercentileKnownAtMs = parseAvailabilityTimestamp(row.sectorPercentileKnownAt, 'sectorPercentileKnownAt');
    const valueCaptureKnownAtMs = parseAvailabilityTimestamp(row.valueCaptureKnownAt, 'valueCaptureKnownAt');
    if (!row.acquisitionAvailability || typeof row.acquisitionAvailability !== 'object') {
      throw new Error(`[early-detection] acquisition availability missing for ${row.entityId} ${row.periodEnd}`);
    }
    assertAvailabilityContract(row.acquisitionAvailability);
    const acquisitionKnownAtMs = Date.parse(knownAt(row.acquisitionAvailability));
    if (acquisitionKnownAtMs !== parseAvailabilityTimestamp(row.acquisitionContributionKnownAt, 'acquisitionContributionKnownAt')) {
      throw new Error(`[early-detection] acquisition knownAt must equal its latest source availability for ${row.entityId} ${row.periodEnd}`);
    }
    for (const field of ['revenue', 'sectorPercentile', 'economicValue', 'dilutedShares', 'acquisitionRevenueShare']) {
      if (!Number.isFinite(row[field])) throw new Error(`[early-detection] ${field} missing for ${row.entityId} ${row.periodEnd}`);
    }
    if (row.revenue < 0 || row.economicValue < 0 || row.dilutedShares <= 0
      || row.acquisitionRevenueShare < 0 || row.acquisitionRevenueShare > 1) {
      throw new Error(`[early-detection] invalid economic input for ${row.entityId} ${row.periodEnd}`);
    }
    if (typeof row.economicMetric !== 'string' || !row.economicMetric) {
      throw new Error(`[early-detection] economicMetric missing for ${row.entityId} ${row.periodEnd}`);
    }
    if (typeof row.valueCaptureAccepted !== 'boolean') {
      throw new Error(`[early-detection] valueCaptureAccepted must be explicit for ${row.entityId} ${row.periodEnd}`);
    }
    const sequence = row.fiscalYear * 4 + row.fiscalQuarter - 1;
    const entityRows = byEntity.get(row.entityId) || new Map();
    if (entityRows.has(sequence)) throw new Error(`[early-detection] duplicate fiscal quarter for ${row.entityId}`);
    entityRows.set(sequence, {
      ...row,
      sequence,
      filingKnownAtMs,
      acquisitionKnownAtMs,
      outcomeKnownAtMs: Math.max(filingKnownAtMs, sectorPercentileKnownAtMs, valueCaptureKnownAtMs, acquisitionKnownAtMs),
    });
    byEntity.set(row.entityId, entityRows);
  }
  for (const [entityId, entityRows] of byEntity) {
    const sequences = [...entityRows.keys()].sort((a, b) => a - b);
    const metricNames = new Set([...entityRows.values()].map((row) => row.economicMetric));
    if (metricNames.size !== 1) throw new Error(`[early-detection] economicMetric changes within ${entityId}`);
    const enriched = new Map();
    for (const sequence of sequences) {
      const row = entityRows.get(sequence);
      const priorYear = entityRows.get(sequence - 4);
      const revenuePerShare = row.revenue / row.dilutedShares;
      enriched.set(sequence, {
        ...row,
        revenuePerShare,
        yoy: priorYear && priorYear.revenue > 0 ? row.revenue / priorYear.revenue - 1 : null,
        economicYoy: priorYear && priorYear.economicValue > 0
          ? row.economicValue / priorYear.economicValue - 1 : null,
        perShareYoy: priorYear && priorYear.revenue > 0 && priorYear.dilutedShares > 0
          ? revenuePerShare / (priorYear.revenue / priorYear.dilutedShares) - 1 : null,
      });
    }
    let lastAcceptedSequence = -Infinity;
    for (const sequence of sequences) {
      const row = enriched.get(sequence);
      const prior = [sequence - 4, sequence - 3, sequence - 2, sequence - 1].map((key) => enriched.get(key));
      const forwardRows = [sequence + 1, sequence + 2, sequence + 3, sequence + 4].map((key) => enriched.get(key));
      if ([...prior, ...forwardRows].some((item) => !item)) continue;
      if (![row.yoy, ...prior.map((item) => item.yoy), ...forwardRows.flatMap((item) => [item.yoy, item.economicYoy, item.perShareYoy])]
        .every(Number.isFinite)) continue;
      const priorMedian = median(prior.map((item) => item.yoy));
      const positiveCount = forwardRows.filter((item) => item.yoy > 0).length;
      const economicPositiveCount = forwardRows.filter((item) => item.economicYoy > 0).length;
      const perSharePositiveCount = forwardRows.filter((item) => item.perShareYoy > 0).length;
      const acquisitionAccepted = [row, ...forwardRows].every((item) => item.acquisitionRevenueShare <= 0.5);
      const qualifies = row.sectorPercentile >= percentileMinimum
        && row.yoy - priorMedian >= accelerationMinimum
        && positiveCount >= 3
        && economicPositiveCount >= 3
        && perSharePositiveCount >= 3
        && acquisitionAccepted
        && row.valueCaptureAccepted === true;
      if (!qualifies) continue;
      const policy = options.eventPolicy || 'first_per_entity';
      if (policy === 'first_per_entity' && lastAcceptedSequence !== -Infinity) continue;
      if (policy === 'cooldown_12_quarters' && sequence - lastAcceptedSequence < 12) continue;
      if (!['first_per_entity', 'cooldown_12_quarters'].includes(policy)) {
        throw new Error('[early-detection] eventPolicy must be first_per_entity or cooldown_12_quarters');
      }
      lastAcceptedSequence = sequence;
      events.push({
        entityId,
        periodEnd: row.periodEnd,
        eventAt: new Date(row.outcomeKnownAtMs).toISOString(),
        eventAvailableAt: new Date(row.outcomeKnownAtMs).toISOString(),
        maturityAt: new Date(Math.max(row.outcomeKnownAtMs,
          ...forwardRows.flatMap((item) => [item.filingKnownAtMs, item.acquisitionKnownAtMs]))).toISOString(),
        yoy: row.yoy,
        sectorPercentile: row.sectorPercentile,
        accelerationVsPriorMedian: row.yoy - priorMedian,
        positiveQuartersOfFour: positiveCount,
        economicPositiveQuartersOfFour: economicPositiveCount,
        perSharePositiveQuartersOfFour: perSharePositiveCount,
        strict: row.yoy >= strictGrowthMinimum,
        economicMetric: row.economicMetric,
      });
    }
  }
  return events.sort((a, b) => a.eventAvailableAt.localeCompare(b.eventAvailableAt) || a.entityId.localeCompare(b.entityId));
}

function growthVisibilityAt(quarters, evaluationAt, options = {}) {
  const evaluationMs = parseAvailabilityTimestamp(evaluationAt, 'evaluationAt');
  const percentileMinimum = options.percentileMinimum ?? 80;
  const accelerationMinimum = options.accelerationMinimum ?? 0.05;
  const rows = Array.isArray(quarters) ? quarters : [];
  const entityIds = new Set(rows.map((row) => row && row.entityId).filter(Boolean));
  if (entityIds.size !== 1) throw new Error('[early-detection] growth visibility requires exactly one entity');
  const entityId = [...entityIds][0];
  const bySequence = new Map();
  for (const row of rows) {
    if (!Number.isInteger(row.fiscalYear) || !Number.isInteger(row.fiscalQuarter)
      || row.fiscalQuarter < 1 || row.fiscalQuarter > 4 || !Number.isFinite(row.revenue)) {
      throw new Error('[early-detection] invalid growth visibility row');
    }
    const sequence = row.fiscalYear * 4 + row.fiscalQuarter - 1;
    if (bySequence.has(sequence)) throw new Error('[early-detection] duplicate growth visibility quarter');
    const availability = { sourceClass: row.sourceClass, accepted_at: row.acceptedAt, observed_at: row.observedAt };
    assertAvailabilityContract(availability);
    bySequence.set(sequence, { ...row, sequence, filingKnownAtMs: Date.parse(knownAt(availability)) });
  }
  const assessments = [];
  for (const targetSequence of [...bySequence.keys()].sort((a, b) => a - b)) {
    const required = Array.from({ length: 9 }, (_, index) => bySequence.get(targetSequence - 8 + index));
    if (required.some((row) => !row)) continue;
    const current = required.at(-1);
    if (current.filingKnownAtMs > evaluationMs) continue;
    if (!Number.isFinite(current.sectorPercentile) || !current.sectorPercentileKnownAt) {
      return { status: 'NOT_COMPUTABLE', reason: 'sector_percentile_missing_for_available_quarter' };
    }
    const percentileKnownMs = parseAvailabilityTimestamp(current.sectorPercentileKnownAt, 'sectorPercentileKnownAt');
    if (percentileKnownMs > evaluationMs) {
      return { status: 'NOT_COMPUTABLE', reason: 'sector_percentile_pending_for_available_quarter' };
    }
    const requiredKnownMs = Math.max(percentileKnownMs, ...required.map((row) => row.filingKnownAtMs));
    if (requiredKnownMs > evaluationMs) continue;
    const yoy = new Map();
    for (let index = 4; index < required.length; index++) {
      const denominator = required[index - 4].revenue;
      if (!(denominator > 0)) return { status: 'NOT_COMPUTABLE', reason: 'nonpositive_prior_year_denominator' };
      yoy.set(required[index].sequence, required[index].revenue / denominator - 1);
    }
    const currentYoy = yoy.get(targetSequence);
    const priorFour = [1, 2, 3, 4].map((lag) => yoy.get(targetSequence - lag));
    if (![currentYoy, ...priorFour].every(Number.isFinite)) continue;
    const accelerationVsPriorMedian = currentYoy - median(priorFour);
    assessments.push({
      targetSequence,
      knownAtMs: requiredKnownMs,
      currentYoy,
      accelerationVsPriorMedian,
      sectorPercentile: current.sectorPercentile,
      visible: current.sectorPercentile >= percentileMinimum && accelerationVsPriorMedian >= accelerationMinimum,
    });
  }
  if (!assessments.length) return { status: 'NOT_COMPUTABLE', reason: 'no_complete_available_nine_quarter_window' };
  const visibleAssessments = assessments.filter((item) => item.visible);
  const knownAtMs = Math.max(...assessments.map((item) => item.knownAtMs));
  const fingerprint = canonicalSha256({ entityId, evaluationAt: new Date(evaluationMs).toISOString(), assessments, percentileMinimum, accelerationMinimum });
  return {
    status: 'COMPUTABLE',
    ruleVersion: 'FEM_VISIBLE_GROWTH_V1',
    entityId,
    evaluationAt: new Date(evaluationMs).toISOString(),
    knownAt: new Date(knownAtMs).toISOString(),
    visible: visibleAssessments.length > 0,
    firstVisibleAt: visibleAssessments.length ? new Date(visibleAssessments[0].knownAtMs).toISOString() : null,
    lastAssessedSequence: assessments.at(-1).targetSequence,
    inputsSha256: fingerprint,
  };
}

function assertMatrixDimension(name, value, maximum = 3) {
  if (!Number.isInteger(value) || value < 0 || value > maximum) {
    throw new Error(`[early-detection] ${name} must be an integer from 0 through ${maximum}`);
  }
}

function classifyCandidate(input) {
  const T = input.T ?? 0;
  const E = input.E ?? 0;
  const L = input.L ?? 0;
  const declaredM = input.M ?? 0;
  const G = input.G ?? 0;
  for (const [name, value] of Object.entries({ T, E, L, M: declaredM })) assertMatrixDimension(name, value);
  const marketRecognition = input.marketInput
    ? deriveMarketRecognition(input.marketInput)
    : { status: 'COMPUTABLE', ruleVersion: 'FEM_MARKET_RECOGNITION_V1', level: 0, reason: 'no_market_input' };
  const M = marketRecognition.level;
  assertMatrixDimension('G', G, 2);
  const quality = input.dataQuality || 'unknown';
  const dataAccepted = ACCEPTED_DATA_QUALITY.has(quality);
  const contradicted = input.contradicted === true;
  const evidenceGate = T >= 2 && E >= 2;
  const operationalGate = evidenceGate && L >= 2;
  const managementOnlyCapOk = input.managementOnly !== true || L <= 1;
  const reasons = [];
  if (!dataAccepted) reasons.push('data_quality_not_accepted');
  if (contradicted) reasons.push('thesis_contradicted');
  if (!managementOnlyCapOk) reasons.push('management_only_evidence_cannot_exceed_L1');
  const marketAccepted = marketRecognition.status === 'COMPUTABLE' && declaredM === M
    && (M === 0 || (marketRecognition.entityId === input.entityId
      && marketRecognition.listingId === input.listingId
      && marketRecognition.vintageMonth === input.vintageMonth));
  if (!marketAccepted && (input.marketInput || declaredM > 0)) reasons.push('market_recognition_not_derived_or_mismatched');
  let coreTimingAccepted = !evidenceGate;
  let coreEvidenceAccepted = !evidenceGate;
  let marketEvidenceAccepted = M === 0 && marketAccepted;
  let preGrowth = false;
  let computedGrowthVisibility = null;
  let coreSignalKnownAt = null;
  let marketSignalKnownAt = null;
  let evaluationMs = null;
  let candidateVintage = null;
  const evidence = input.dimensionEvidence || {};
  const sourceMap = new Map((input.evidenceSources || []).map((source) => [source.sourceId, source]));
  if (evidenceGate) {
    try {
      evaluationMs = parseAvailabilityTimestamp(input.evaluationAt, 'evaluationAt');
      if (typeof input.entityId !== 'string' || !input.entityId || typeof input.listingId !== 'string' || !input.listingId
        || !/^\d{4}-\d{2}$/.test(String(input.vintageMonth))) {
        throw new Error('candidate_vintage_identity_missing');
      }
      const candidateCalendar = validateVintageCalendar(input.vintageCalendar || (input.marketInput && input.marketInput.vintageCalendar));
      const calendarItem = candidateCalendar.byMonth.get(input.vintageMonth);
      if (!calendarItem || evaluationMs !== calendarItem.closeMs
        || parseAvailabilityTimestamp(input.signalAvailableAt, 'signalAvailableAt') !== calendarItem.nextOpenMs) {
        throw new Error('candidate_vintage_timing_mismatch');
      }
      candidateVintage = {
        vintageMonth: input.vintageMonth,
        evaluationAt: new Date(calendarItem.closeMs).toISOString(),
        signalAvailableAt: new Date(calendarItem.nextOpenMs).toISOString(),
        vintageCalendarSha256: candidateCalendar.sha256,
      };
      const themeIds = new Set();
      const evidenceTimes = [];
      for (const dimension of ['T', 'E', 'L']) {
        const item = evidence[dimension];
        if (!item || item.level !== { T, E, L }[dimension]
          || typeof item.entityId !== 'string' || item.entityId !== input.entityId
          || typeof item.themeId !== 'string' || !item.themeId
          || !Array.isArray(item.sourceIds) || !item.sourceIds.length) {
          throw new Error(`${dimension}_evidence_invalid`);
        }
        const itemMs = parseAvailabilityTimestamp(item.knownAt, `${dimension}.knownAt`);
        if (itemMs > evaluationMs) throw new Error(`${dimension}_evidence_look_ahead`);
        const sourceKnownTimes = item.sourceIds.map((sourceId) => {
          const source = sourceMap.get(sourceId);
          if (!source) throw new Error(`${dimension}_source_missing:${sourceId}`);
          return Date.parse(assertKnownAt(source, input.evaluationAt));
        });
        if (itemMs !== Math.max(...sourceKnownTimes)) throw new Error(`${dimension}_knownAt_must_equal_latest_source`);
        themeIds.add(item.themeId);
        evidenceTimes.push(itemMs);
      }
      if (themeIds.size !== 1 || !themeIds.has(input.themeId)) throw new Error('cross_theme_evidence_prohibited');
      coreSignalKnownAt = Math.max(...evidenceTimes);
      coreEvidenceAccepted = true;
      coreTimingAccepted = coreSignalKnownAt <= evaluationMs;
      if (operationalGate) {
        computedGrowthVisibility = growthVisibilityAt(input.growthVisibilityRows, input.evaluationAt);
        if (computedGrowthVisibility.status !== 'COMPUTABLE'
          || computedGrowthVisibility.entityId !== input.entityId
          || computedGrowthVisibility.evaluationAt !== new Date(evaluationMs).toISOString()
          || parseAvailabilityTimestamp(computedGrowthVisibility.knownAt, 'growthVisibility.knownAt') > evaluationMs) {
          throw new Error('growth_visibility_contract_invalid');
        }
        preGrowth = computedGrowthVisibility.visible === false;
      }
    } catch (error) {
      reasons.push(`core_evidence_timing_invalid:${error.message}`);
    }
  }
  if (evidenceGate && M > 0 && marketAccepted && coreEvidenceAccepted) {
    try {
      const item = evidence.M;
      if (!item || item.level !== M || item.entityId !== input.entityId
        || item.themeId !== input.themeId || !Array.isArray(item.sourceIds) || !item.sourceIds.length) {
        throw new Error('M_evidence_invalid');
      }
      if (item.inputsSha256 !== marketRecognition.inputsSha256) throw new Error('M_evidence_input_hash_mismatch');
      const itemMs = parseAvailabilityTimestamp(item.knownAt, 'M.knownAt');
      if (itemMs !== Date.parse(marketRecognition.marketKnownAt)) throw new Error('M_knownAt_must_equal_month_end_close');
      if (evaluationMs !== itemMs
        || parseAvailabilityTimestamp(input.signalAvailableAt, 'signalAvailableAt') !== Date.parse(marketRecognition.signalAvailableAt)) {
        throw new Error('monthly_market_signal_timing_mismatch');
      }
      if (!candidateVintage || candidateVintage.vintageCalendarSha256 !== marketRecognition.vintageCalendarSha256) {
        throw new Error('market_candidate_calendar_hash_mismatch');
      }
      const sourceKnownTimes = item.sourceIds.map((sourceId) => {
        const source = sourceMap.get(sourceId);
        if (!source) throw new Error(`M_source_missing:${sourceId}`);
        return Date.parse(assertKnownAt(source, input.evaluationAt));
      });
      if (itemMs !== Math.max(...sourceKnownTimes)) throw new Error('M_knownAt_must_equal_latest_source');
      marketEvidenceAccepted = true;
      marketSignalKnownAt = Math.max(coreSignalKnownAt, itemMs);
    } catch (error) {
      reasons.push(`market_evidence_timing_invalid:${error.message}`);
    }
  }
  const effectiveM = marketAccepted && marketEvidenceAccepted ? M : 0;
  let state = 'REJECTED_HOLD';
  if (dataAccepted && G >= 1) state = 'GQS_CONFIRMED';
  else if (dataAccepted && !contradicted && managementOnlyCapOk && coreTimingAccepted && coreEvidenceAccepted) {
    if (operationalGate && preGrowth && effectiveM >= 2) state = 'MARKET_CONFIRMING';
    else if (operationalGate && preGrowth) state = 'PRE_GROWTH_CANDIDATE';
    else if (evidenceGate && L >= 1) state = 'RESEARCH_WATCH';
  }
  return {
    state,
    elliottReview: dataAccepted && !contradicted && managementOnlyCapOk && coreTimingAccepted && coreEvidenceAccepted && operationalGate,
    dimensions: { T, E, L, M: effectiveM, G },
    growthVisibility: computedGrowthVisibility,
    marketRecognition,
    signalKnownAt: coreSignalKnownAt == null ? null : new Date(effectiveM > 0 ? marketSignalKnownAt : coreSignalKnownAt).toISOString(),
    signalAvailableAt: candidateVintage ? candidateVintage.signalAvailableAt : (marketRecognition.signalAvailableAt || input.signalAvailableAt || null),
    candidateVintage,
    reasons,
  };
}

// Ex-post lead-time evaluation is deliberately separate from candidate creation.
// outcomeVisibleAt must never be supplied to classifyCandidate.
function evaluateLead(signalAvailableAt, outcomeVisibleAt) {
  const signalMs = parseAvailabilityTimestamp(signalAvailableAt, 'signalAvailableAt');
  const outcomeMs = parseAvailabilityTimestamp(outcomeVisibleAt, 'outcomeVisibleAt');
  const differenceMs = outcomeMs - signalMs;
  return {
    precedesOutcome: differenceMs > 0,
    differenceMs,
    differenceDays: differenceMs / DAY_MS,
  };
}

function validateFiveClocks(clocks, sources = [], evaluationAt = null) {
  const required = ['theme', 'beneficiary', 'operations', 'market', 'fundamental'];
  const issues = [];
  let evaluationMs = null;
  try {
    evaluationMs = parseAvailabilityTimestamp(evaluationAt, 'evaluationAt');
  } catch (error) {
    issues.push('evaluationAt_invalid_or_missing');
  }
  const sourceMap = new Map((sources || []).map((source) => [source.sourceId, source]));
  for (const clock of required) {
    const value = clocks && clocks[clock];
    if (!value) {
      issues.push(`${clock}:missing`);
      continue;
    }
    let clockMs = null;
    if (!value.knownAt) issues.push(`${clock}:knownAt_missing`);
    else {
      try {
        clockMs = parseAvailabilityTimestamp(value.knownAt, `${clock}.knownAt`);
        if (evaluationMs != null && clockMs > evaluationMs) issues.push(`${clock}:look_ahead`);
      } catch (error) {
        issues.push(`${clock}:knownAt_invalid`);
      }
    }
    if (!value.sourceId) issues.push(`${clock}:sourceId_missing`);
    else {
      const source = sourceMap.get(value.sourceId);
      if (!source) issues.push(`${clock}:source_unknown`);
      else if (evaluationMs != null) {
        try {
          const sourceKnownMs = Date.parse(assertKnownAt(source, evaluationAt));
          if (clockMs != null && clockMs < sourceKnownMs) issues.push(`${clock}:before_source_available`);
        } catch (error) {
          issues.push(`${clock}:source_availability_invalid`);
        }
      }
    }
    if (!['observed', 'not_observed', 'unknown', 'rejected'].includes(value.status)) {
      issues.push(`${clock}:status_invalid`);
    }
  }
  return { valid: issues.length === 0, issues };
}

// Executable Point-in-Time research-corpus validator. The day-level
// bibliographic SOURCE_REGISTRY.csv in the study bundle is deliberately not
// signal-eligible and must be promoted into this stricter schema first.
function validateClaimLedger(claims, sources, evaluationAt = null) {
  const get = (row, camel, snake) => row && (row[camel] ?? row[snake]);
  const directReference = (value) => typeof value === 'string'
    && (/^https?:\/\//.test(value) || /^[A-Za-z]:[\\/]/.test(value));
  let evaluationMs = null;
  try { evaluationMs = parseAvailabilityTimestamp(evaluationAt, 'evaluationAt'); } catch (error) { evaluationMs = NaN; }
  const sourceMap = new Map((sources || []).map((source) => [get(source, 'sourceId', 'source_id'), source]));
  const issues = [];
  const seenClaims = new Set();
  const seenSources = new Set();
  for (const source of sources || []) {
    const sourceId = get(source, 'sourceId', 'source_id');
    const publishedAt = get(source, 'publishedAt', 'published_at');
    const sourceKnownAt = get(source, 'knownAt', 'known_at');
    const sourceClass = get(source, 'sourceClass', 'source_class');
    const locator = get(source, 'locator', 'locator');
    const evidenceQuality = get(source, 'evidenceQuality', 'evidence_quality') ?? source.quality;
    if (!sourceId) issues.push('source_without_id');
    else if (seenSources.has(sourceId)) issues.push(`duplicate_source_id:${sourceId}`);
    else seenSources.add(sourceId);
    if (!directReference(source.url)) issues.push(`${sourceId || 'unknown'}:source_without_direct_reference`);
    if (!publishedAt) issues.push(`${sourceId || 'unknown'}:publishedAt_missing`);
    if (!sourceKnownAt) issues.push(`${sourceId || 'unknown'}:knownAt_missing`);
    if (!locator) issues.push(`${sourceId || 'unknown'}:locator_missing`);
    if (!evidenceQuality) issues.push(`${sourceId || 'unknown'}:evidenceQuality_missing`);
    try {
      const publishedMs = parseAvailabilityTimestamp(publishedAt, 'publishedAt');
      const knownMs = parseAvailabilityTimestamp(sourceKnownAt, 'knownAt');
      if (publishedMs != null && knownMs != null && knownMs < publishedMs) issues.push(`${sourceId}:known_before_published`);
      if (evaluationMs != null && Number.isFinite(evaluationMs) && knownMs > evaluationMs) issues.push(`${sourceId}:look_ahead`);
      const availabilityRecord = {
        sourceClass,
        source_published_at: get(source, 'sourcePublishedAt', 'source_published_at') || publishedAt,
        accepted_at: get(source, 'acceptedAt', 'accepted_at'),
        bar_available_at: get(source, 'barAvailableAt', 'bar_available_at'),
        observed_at: get(source, 'observedAt', 'observed_at'),
      };
      assertAvailabilityContract(availabilityRecord);
      const computedKnownAt = knownAt(availabilityRecord);
      if (knownMs !== Date.parse(computedKnownAt)) issues.push(`${sourceId}:knownAt_mismatch`);
      if (Number.isFinite(evaluationMs)) assertKnownAt(availabilityRecord, evaluationAt);
    } catch (error) {
      issues.push(`${sourceId || 'unknown'}:availability_contract_invalid`);
    }
  }
  for (const claim of claims || []) {
    const claimId = get(claim, 'claimId', 'claim_id');
    const claimText = get(claim, 'claimText', 'claim_text');
    const claimType = claim.type ?? claim.claim_type;
    const sourceIds = claim.sourceIds ?? String(claim.source_ids || '').split(';').filter(Boolean);
    const counterevidence = claim.counterevidence;
    const versionStatus = get(claim, 'versionStatus', 'version_status');
    if (!claimId) issues.push('claim_without_id');
    else if (seenClaims.has(claimId)) issues.push(`duplicate_claim_id:${claimId}`);
    else seenClaims.add(claimId);
    if (!claimText) issues.push(`${claimId || 'unknown'}:claim_text_missing`);
    if (!['fact', 'calculation', 'inference', 'hypothesis', 'forecast'].includes(claimType)) {
      issues.push(`${claimId || 'unknown'}:invalid_type`);
    }
    if (claimType === 'fact' && (!Array.isArray(sourceIds) || !sourceIds.length)) {
      issues.push(`${claimId}:fact_without_source`);
    }
    for (const sourceId of sourceIds || []) {
      const source = sourceMap.get(sourceId);
      if (!source) issues.push(`${claimId}:unknown_source:${sourceId}`);
      else if (!directReference(source.url)) issues.push(`${claimId}:source_without_direct_reference:${sourceId}`);
    }
    if (!claim.status) issues.push(`${claimId}:status_missing`);
    if (!((Array.isArray(counterevidence) && counterevidence.length)
      || (typeof counterevidence === 'string' && counterevidence.trim()))) {
      issues.push(`${claimId}:counterevidence_missing`);
    }
    if (!versionStatus) issues.push(`${claimId}:version_status_missing`);
  }
  if (!Number.isFinite(evaluationMs)) issues.push('evaluationAt_invalid_or_missing');
  return { valid: issues.length === 0, issues };
}

function aiRemoval(rows, ledger, mode) {
  const removal = {
    direct: new Set(['direct']),
    infrastructure: new Set(['direct', 'infrastructure']),
    material: new Set(['direct', 'infrastructure', 'indirect']),
  }[mode];
  if (!removal) throw new Error('[early-detection] AI removal mode must be direct, infrastructure or material');
  const observationKeys = new Set();
  const duplicateObservationKeys = [];
  for (const row of rows || []) {
    try {
      const key = `${row.entityId}\u0000${row.listingId}\u0000${new Date(parseAvailabilityTimestamp(row.evaluationAt, 'evaluationAt')).toISOString()}`;
      if (observationKeys.has(key)) duplicateObservationKeys.push(key.replaceAll('\u0000', '|'));
      observationKeys.add(key);
    } catch (error) { /* invalid rows remain fail-closed as unclassified below */ }
  }
  if (duplicateObservationKeys.length) {
    return {
      status: 'NOT_READY',
      reason: 'duplicate_input_observation_key',
      duplicateObservationKeys: [...new Set(duplicateObservationKeys)],
      primaryResultAllowed: false,
    };
  }
  const classified = [];
  const unclassified = [];
  for (const row of rows || []) {
    const rowKeyValid = row && typeof row.entityId === 'string' && row.entityId
      && typeof row.listingId === 'string' && row.listingId;
    let evaluationMs = null;
    try { evaluationMs = parseAvailabilityTimestamp(row && row.evaluationAt, 'evaluationAt'); } catch (error) { /* fail closed below */ }
    let candidates = [];
    if (rowKeyValid && evaluationMs != null) {
      try {
        candidates = (ledger || []).filter((item) => {
          if (item.entityId !== row.entityId || item.listingId !== row.listingId) return false;
          const fromMs = parseTime(item.effectiveFrom, 'effectiveFrom');
          const toMs = item.effectiveTo ? parseTime(item.effectiveTo, 'effectiveTo') : Infinity;
          return fromMs != null && fromMs <= evaluationMs && evaluationMs < toMs;
        }).sort((a, b) => Date.parse(b.effectiveFrom) - Date.parse(a.effectiveFrom));
      } catch (error) {
        candidates = [];
      }
    }
    const item = candidates.length === 1 ? candidates[0] : null;
    let valid = Boolean(item && AI_CLASSES.has(item.aiClass) && item.aiClass !== 'unknown' && item.sourceId);
    if (valid) {
      try { assertKnownAt(item, row.evaluationAt); } catch (error) { valid = false; }
    }
    if (valid && ['direct', 'infrastructure', 'indirect'].includes(item.aiClass)
      && !MATERIAL_AI_EVIDENCE.has(item.materialEvidenceType)) valid = false;
    if (!valid) unclassified.push(row);
    else classified.push({ row, evidence: item });
  }
  const coverage = rows && rows.length ? classified.length / rows.length : 0;
  const knownKept = classified.filter(({ evidence }) => !removal.has(evidence.aiClass)).map(({ row }) => row);
  const knownRemoved = classified.filter(({ evidence }) => removal.has(evidence.aiClass)).map(({ row }) => row);
  const bounds = {
    unknownIncludedAsNonAi: { kept: [...knownKept, ...unclassified], removed: knownRemoved },
    unknownRemovedWithAi: { kept: knownKept, removed: [...knownRemoved, ...unclassified] },
  };
  if (unclassified.length) {
    return {
      status: 'NOT_READY',
      reason: coverage < 0.95 ? 'evidence_coverage_below_95_percent' : 'unknown_classifications_block_primary_result',
      coverage,
      total: (rows || []).length,
      classified: classified.length,
      unclassifiedEntities: unclassified.map((row) => ({ entityId: row.entityId, listingId: row.listingId })),
      sensitivityBoundsAvailable: coverage >= 0.95,
      bounds,
      primaryResultAllowed: false,
    };
  }
  return {
    status: 'READY',
    mode,
    coverage,
    kept: knownKept,
    removed: knownRemoved,
    bounds,
    primaryResultAllowed: true,
  };
}

function wilsonInterval(successes, total, z = 1.959963984540054) {
  if (!Number.isInteger(successes) || !Number.isInteger(total) || total <= 0 || successes < 0 || successes > total) {
    throw new Error('[early-detection] Wilson interval requires 0 <= integer successes <= positive integer total');
  }
  const p = successes / total;
  const denominator = 1 + z ** 2 / total;
  const centre = (p + z ** 2 / (2 * total)) / denominator;
  const half = z * Math.sqrt((p * (1 - p) + z ** 2 / (4 * total)) / total) / denominator;
  return { estimate: p, lower: Math.max(0, centre - half), upper: Math.min(1, centre + half) };
}

function selectPrimaryTheme(rows, entityId, signalAvailableAt) {
  const signalMs = parseAvailabilityTimestamp(signalAvailableAt, 'signalAvailableAt');
  if (typeof entityId !== 'string' || !entityId) throw new Error('[early-detection] primary theme entityId is required');
  const eligible = (rows || []).filter((row) => row && row.entityId === entityId
    && row.T >= 2 && row.E >= 2 && row.L >= 2 && row.evidenceAccepted === true
    && typeof row.themeId === 'string' && row.themeId && row.knownAt
    && parseAvailabilityTimestamp(row.knownAt, 'knownAt') <= signalMs);
  if (!eligible.length) return null;
  return eligible.slice().sort((a, b) => b.T - a.T || b.E - a.E || b.L - a.L
    || parseAvailabilityTimestamp(a.knownAt, 'knownAt') - parseAvailabilityTimestamp(b.knownAt, 'knownAt')
    || a.themeId.localeCompare(b.themeId))[0];
}

function selectPrimarySignals(rows, vintageCalendar) {
  const eligibleStates = new Set(['PRE_GROWTH_CANDIDATE', 'MARKET_CONFIRMING']);
  const calendarContract = validateVintageCalendar(vintageCalendar);
  const byEntity = new Map();
  for (const row of rows || []) {
    if (!row || typeof row.entityId !== 'string' || !/^\d{4}-\d{2}$/.test(String(row.vintageMonth))) {
      throw new Error('[early-detection] primary signal row requires entityId and YYYY-MM vintageMonth');
    }
    const calendarItem = calendarContract.byMonth.get(row.vintageMonth);
    if (!calendarItem) throw new Error(`[early-detection] vintage calendar entry missing for ${row.vintageMonth}`);
    if (parseAvailabilityTimestamp(row.evaluationAt, 'evaluationAt') !== calendarItem.closeMs) {
      throw new Error(`[early-detection] evaluationAt must equal sealed vintage close for ${row.vintageMonth}`);
    }
    const signalAvailableMs = parseAvailabilityTimestamp(row.signalAvailableAt, 'signalAvailableAt');
    if (signalAvailableMs !== calendarItem.nextOpenMs) {
      throw new Error(`[early-detection] signalAvailableAt must equal sealed next open for ${row.vintageMonth}`);
    }
    if (eligibleStates.has(row.state)) {
      const candidateVintage = row.candidateVintage;
      if (!candidateVintage || candidateVintage.vintageMonth !== row.vintageMonth
        || parseAvailabilityTimestamp(candidateVintage.evaluationAt, 'candidateVintage.evaluationAt') !== calendarItem.closeMs
        || parseAvailabilityTimestamp(candidateVintage.signalAvailableAt, 'candidateVintage.signalAvailableAt') !== calendarItem.nextOpenMs
        || candidateVintage.vintageCalendarSha256 !== calendarContract.sha256) {
        throw new Error(`[early-detection] candidate state timing is not bound to sealed calendar for ${row.entityId}`);
      }
    }
    if (row.state === 'MARKET_CONFIRMING') {
      const market = row.marketRecognition;
      if (!market || market.status !== 'COMPUTABLE' || market.entityId !== row.entityId
        || market.listingId !== row.listingId || market.vintageMonth !== row.vintageMonth
        || parseAvailabilityTimestamp(market.marketKnownAt, 'marketRecognition.marketKnownAt') !== calendarItem.closeMs
        || parseAvailabilityTimestamp(market.signalAvailableAt, 'marketRecognition.signalAvailableAt') !== calendarItem.nextOpenMs
        || market.vintageCalendarSha256 !== calendarContract.sha256) {
        throw new Error(`[early-detection] MARKET_CONFIRMING timing is not bound to sealed calendar for ${row.entityId}`);
      }
    }
    const group = byEntity.get(row.entityId) || [];
    group.push(row);
    byEntity.set(row.entityId, group);
  }
  const selected = [];
  for (const [entityId, entityRows] of byEntity) {
    const sorted = entityRows.slice().sort((a, b) => a.vintageMonth.localeCompare(b.vintageMonth));
    if (sorted[0].historyCompleteFrom !== sorted[0].vintageMonth) {
      throw new Error(`[early-detection] history completeness anchor missing for ${entityId}`);
    }
    const months = new Set();
    let previouslyEligible = false;
    let alreadySelected = false;
    for (const [index, row] of sorted.entries()) {
      if (months.has(row.vintageMonth)) throw new Error(`[early-detection] duplicate entity-month vintage for ${entityId}`);
      if (row.historyCompleteFrom !== sorted[0].historyCompleteFrom) {
        throw new Error(`[early-detection] inconsistent history completeness anchor for ${entityId}`);
      }
      if (index > 0 && sorted[index - 1].vintageMonth !== previousCalendarMonth(row.vintageMonth)) {
        throw new Error(`[early-detection] incomplete entity-month panel for ${entityId}`);
      }
      months.add(row.vintageMonth);
      const eligible = row.isPrimaryListing === true && eligibleStates.has(row.state);
      if (index === 0 && eligible && row.isListingStartVintage !== true) {
        throw new Error(`[early-detection] first eligible row is left-censored for ${entityId}`);
      }
      if (eligible && !previouslyEligible && !alreadySelected) {
        const calendarItem = calendarContract.byMonth.get(row.vintageMonth);
        selected.push({
          ...row,
          isPrimarySignal: true,
          vintageCloseAt: new Date(calendarItem.closeMs).toISOString(),
          nextOpenAt: new Date(calendarItem.nextOpenMs).toISOString(),
          vintageCalendarSha256: calendarContract.sha256,
        });
        alreadySelected = true;
      }
      previouslyEligible = eligible;
    }
  }
  return selected.sort((a, b) => a.signalAvailableAt.localeCompare(b.signalAvailableAt) || a.entityId.localeCompare(b.entityId));
}

function matchControlsFixed(signal, controls, unavailableEntityIds) {
  const calipers = Object.freeze({
    logMarketCap: 0.50,
    listingAgeSessions: 252,
    relativeReturn: 0.15,
    logDollarVolume: 1.00,
  });
  const ratio = 5;
  const regimes = new Set(['bear', 'recovery', 'bull', 'neutral']);
  const exactIdentityValid = (row) => row && typeof row.entityId === 'string' && row.entityId
    && typeof row.listingId === 'string' && row.listingId
    && typeof row.sectorBranch === 'string' && row.sectorBranch
    && /^\d{4}-\d{2}$/.test(String(row.vintageMonth))
    && regimes.has(row.marketRegime);
  const features = (row) => {
    if (!(row.marketCapUsd > 0) || !(row.medianDollarVolume120Usd > 0)
      || !Number.isFinite(row.listingAgeSessions) || !Number.isFinite(row.sectorRelativeReturn126)) return null;
    return {
      logMarketCap: Math.log(row.marketCapUsd),
      listingAgeSessions: row.listingAgeSessions,
      relativeReturn: row.sectorRelativeReturn126,
      logDollarVolume: Math.log(row.medianDollarVolume120Usd),
    };
  };
  const signalFeatures = features(signal);
  if (!signalFeatures || signal.isPrimaryListing !== true || !exactIdentityValid(signal)) {
    throw new Error('[early-detection] signal matching identity, exact fields, features or primary listing missing');
  }
  const candidates = [];
  for (const control of controls || []) {
    if (!exactIdentityValid(control) || control.entityId === signal.entityId
      || unavailableEntityIds.has(control.entityId) || control.isPrimaryListing !== true
      || control.sectorBranch !== signal.sectorBranch || control.vintageMonth !== signal.vintageMonth
      || control.marketRegime !== signal.marketRegime || control.neverPrimarySignalled !== true
      || ['PRE_GROWTH_CANDIDATE', 'MARKET_CONFIRMING'].includes(control.state)) continue;
    const controlFeatures = features(control);
    if (!controlFeatures) continue;
    let distance = 0;
    let accepted = true;
    for (const name of Object.keys(calipers)) {
      const difference = Math.abs(signalFeatures[name] - controlFeatures[name]);
      if (difference > calipers[name]) { accepted = false; break; }
      distance += (difference / calipers[name]) ** 2;
    }
    if (accepted) candidates.push({ ...control, distance });
  }
  const seen = new Set();
  return candidates.sort((a, b) => a.distance - b.distance || a.entityId.localeCompare(b.entityId)
    || a.listingId.localeCompare(b.listingId)).filter((row) => {
    const key = row.entityId;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, ratio);
}

function matchControls(signal, controls) {
  if (arguments.length !== 2) {
    throw new Error('[early-detection] confirmatory matching parameters are fixed and accept no overrides');
  }
  return matchControlsFixed(signal, controls, new Set());
}

function matchControlPanel(signals, controls) {
  const signalEntities = new Set((signals || []).map((signal) => signal && signal.entityId));
  if (signalEntities.has(undefined) || signalEntities.has(null) || signalEntities.has('')) {
    throw new Error('[early-detection] every primary signal requires an entityId');
  }
  const usedControlEntities = new Set(signalEntities);
  const seenSignalEntities = new Set();
  const matches = [];
  const orderedSignals = (signals || []).slice().sort((a, b) => String(a.signalAvailableAt).localeCompare(String(b.signalAvailableAt))
    || String(a.entityId).localeCompare(String(b.entityId)) || String(a.listingId).localeCompare(String(b.listingId)));
  for (const signal of orderedSignals) {
    parseAvailabilityTimestamp(signal.signalAvailableAt, 'signalAvailableAt');
    if (signal.isPrimarySignal !== true || seenSignalEntities.has(signal.entityId)) {
      throw new Error('[early-detection] control panel requires exactly one primary signal per entity');
    }
    seenSignalEntities.add(signal.entityId);
    const selected = matchControlsFixed(signal, controls, usedControlEntities);
    for (const control of selected) usedControlEntities.add(control.entityId);
    matches.push({ signal, controls: selected });
  }
  return matches;
}

function evaluateHFem(gates) {
  const sampleGates = [
    'minimumMatureEvents', 'minimumUniquePrimarySignals', 'minimumFuturePositivesPerArm', 'readinessComplete',
    'primaryBootstrapComputable', 'technicalIncrementalityComputable', 'nonAiEvidenceReady', 'nonAiMinimumSample',
  ];
  const substantiveGates = [
    'precisionLift', 'precisionInterval', 'medianLead', 'preBreakoutDifference', 'preBreakoutInterval',
    'unmatchedRate', 'themeConcentration', 'microcapConcentration', 'marketRegimeConcentration',
    'nonAiRobustness', 'technicalLogLossGain', 'technicalLogLossInterval',
  ];
  const missing = [...sampleGates, ...substantiveGates].filter((gate) => typeof (gates && gates[gate]) !== 'boolean');
  if (missing.length) return { status: 'INCONCLUSIVE', reason: 'gate_missing', gates: missing };
  const insufficient = sampleGates.filter((gate) => gates[gate] !== true);
  if (insufficient.length) return { status: 'INCONCLUSIVE', reason: 'sample_or_readiness_gate_failed', gates: insufficient };
  const failed = substantiveGates.filter((gate) => gates[gate] !== true);
  if (failed.length) return { status: 'AUTOMATION_REJECTED', reason: 'substantive_gate_failed', gates: failed };
  return { status: 'HFEM_PASSED', reason: 'all_primary_gates_passed', gates: [] };
}

function evaluateReadiness(gates) {
  const required = [
    'protocolSealed',
    'confirmatoryAnalysisImplementationSealed',
    'entityListingLedger',
    'appendOnlySecStore',
    'historicalUniverse',
    'asOfLeakageGate',
    'adjustedOhlcv',
    'corporateActionsDelistings',
    'historicalGqsAdapter',
    'conceptMapFrozen',
    'independentAuditPassed',
    'blindCodingAgreementPassed',
    'researchCorpusSealed',
  ];
  const missing = required.filter((gate) => !gates || gates[gate] !== true);
  return {
    status: missing.length ? 'NOT_READY_TO_EXECUTE' : 'READY_TO_EXECUTE',
    missing,
    resultComputationAllowed: missing.length === 0,
  };
}

module.exports = {
  AI_CLASSES,
  aiRemoval,
  alignedReturn,
  assertAvailabilityContract,
  assertKnownAt,
  breakoutIndices,
  canonicalSha256,
  classifyCandidate,
  emaSeries,
  evaluateHFem,
  evaluateReadiness,
  evaluateLead,
  growthBreakouts,
  growthVisibilityAt,
  knownAt,
  latestBreakout,
  linearRegressionEndpoint,
  macd,
  deriveMarketRecognition,
  matchControlPanel,
  matchControls,
  mean,
  median,
  normalizeBars,
  rsi,
  sma,
  selectPrimarySignals,
  selectPrimaryTheme,
  squeezeMomentum,
  standardDeviation,
  technicalSnapshot,
  validateClaimLedger,
  validateFiveClocks,
  wilsonInterval,
};

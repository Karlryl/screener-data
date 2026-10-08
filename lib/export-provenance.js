'use strict';

// Additive evidence only. Nothing in this module changes a supplied board value.
const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { writeFileAtomic, writeJsonAtomic } = require('./atomic-write.js');
const { revGrowthLeg } = require('./rev-growth-basis.js');
const { norm, jahresVergleichIdx } = require('../src/scoring/snapshot.js');
const { annualLegNewerYear } = require('../src/scoring/axes.js');
const financialTable = require('../configs/financial-known-cases.json');
const q4Table = require('../configs/yahoo-q4-known-cases.json');
const statementTable = require('../configs/statement-currency-hand-table.json');
const { loadAdsHandTable, loadShareCountTable, applyAdsHandTable, applyShareCountTable } = require('./ads-hand-table.js');

const SCHEMA = 'findash-provenance/v1';
const FIELDS = Object.freeze(['revGrowthYoYPct', 'marketCap']);
const SCOPE = 'revGrowthYoYPct+marketCap/v1';
const REASON = 'This scope covers only revGrowthYoYPct and marketCap; every other number is unchecked.';
const HEADER_FIELDS = ['provenanceVersion', 'provenanceRunId', 'provenanceManifest', 'provenanceManifestSha256', 'verificationSummary'];
const ROW_FIELDS = ['provenance', 'verification', 'fieldStatus'];
const RECORD_FIELDS = ('id issuerId listingId ticker fieldPath valueHash creatorEngine creatorModel creatorSessionId createdAt sourceType provider retrievedAt observedAt publishedAt periodStart periodEnd periodType comparativeBasis metricDefinition nativeValue nativeCurrency nativeUnit unitMultiplier normalizedValue normalizedCurrency documentUrl documentTitle documentId documentSha256 filingAccession filingForm filedAt taxonomy concept contextId page anchor quote fx derivation correctionCaseId correctionRevision supersedesId missingReason qualityWarnings').split(' ');
const FX_FIELDS = 'rate fromCurrency toCurrency asOf sourceUrl unitAdjustment adrRatio'.split(' ');
const DERIVATION_FIELDS = 'methodId methodVersion expression inputIds rounding parametersHash cohortId cohortHash cohortInputIds cohortVerificationStatus'.split(' ');
const REVIEW_FIELDS = 'id evidenceIds scopeId valueHash methodVersion reviewerEngine reviewerModel reviewerSessionId checkedAt result reason sourceReopenedAt supersedesReviewId'.split(' ');
const VERIFICATION_FIELDS = 'status scopeId requiredFields verifiedFields openFields reviewIds checkedAt valueHash reason'.split(' ');
const SUMMARY_FIELDS = 'scopeId eligibleRows fullyVerifiedRows partiallyVerifiedRows uncheckedRows withheldRows checkedAt'.split(' ');
const writerSession = randomUUID();
const evidenceCreatedAt = new Map();
const empty = keys => Object.fromEntries(keys.map(k => [k, null]));
/** Hash exact bytes. @param {string|Buffer} bytes Input bytes. */
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
/** Hash the JSON representation of a field. @param {*} value Exported value. */
function valueHash(value) {
  if (value === undefined || (typeof value === 'number' && !Number.isFinite(value))) throw new Error('provenance: non-JSON value');
  return sha256(JSON.stringify(value));
}
const timestamp = v => typeof v === 'string' && Number.isFinite(Date.parse(v)) ? v : null;
const sourceTime = s => timestamp(s?.retrievedAt) || timestamp(s?.fetchedAt) || timestamp(s?.asOf);
const tableTime = s => timestamp(s?.retrievedAt) || timestamp(s?.fetchedAt) || timestamp(s?.verifiedAt);
const number = v => typeof v === 'number' && Number.isFinite(v) ? v : null;
const cellValue = v => number(v && typeof v === 'object' ? v.value : v);
/** Flatten either supported board shape. @param {object} file Export object. */
const rowsOf = file => Array.isArray(file.rows) ? file.rows : [...(file.profitable || []), ...(file.unprofitable || [])];
const derivation = changes => ({ ...empty(DERIVATION_FIELDS), inputIds: [], cohortInputIds: [], cohortVerificationStatus: 'notApplicable', ...changes });
const fx = changes => ({ ...empty(FX_FIELDS), ...changes });
const unique = values => [...new Set(values)];
const MANIFEST_PATHS = Object.freeze({ hypergrowth: 'provenance/hypergrowth.json', rule40: 'rule40/provenance/rule40.json' });

/** Restore the logical record, retaining unknown keys for the exact-key check. @param {object} record Wire record. */
function expandRecord(record) {
  demand(record && typeof record === 'object' && !Array.isArray(record), 'invalid record');
  const expanded = { ...empty(RECORD_FIELDS), ...record };
  for (const [key, fields] of [['fx', FX_FIELDS], ['derivation', DERIVATION_FIELDS]]) {
    if (Object.hasOwn(record, key)) demand(record[key] && typeof record[key] === 'object' && !Array.isArray(record[key]), 'invalid ' + key);
    expanded[key] = { ...empty(fields), ...record[key] };
  }
  return expanded;
}

/** Encode only null omissions, without changing logical identities. @param {object} manifest Expanded manifest. */
function serializeManifest(manifest) {
  const nonNull = object => Object.fromEntries(Object.entries(object).filter(([, value]) => value !== null));
  return JSON.stringify({ ...manifest, records: manifest.records.map(record => {
    const slim = nonNull(record);
    for (const key of ['fx', 'derivation']) {
      slim[key] = nonNull(record[key]);
      if (!Object.keys(slim[key]).length) delete slim[key];
    }
    return slim;
  }) });
}

function sourceDocument(source) {
  const s = typeof source === 'object' && source !== null ? source : {};
  const text = typeof source === 'string' ? source : null;
  // Extract only literal documented URLs/pages. A description is not an original quotation.
  const url = s.url || (text && (text.match(/https?:\/\/[^\s;]+/) || [])[0]) || null;
  return { documentUrl: url, documentTitle: s.title || s.form || text || null,
    page: s.page ?? (text && (text.match(/\bpp?\.\s*([\d, -]+)/) || [])[1]?.trim()) ?? null,
    quote: s.quote ?? null, qualityWarnings: url ? [] : ['source link missing'] };
}

function statementApplied(meta, container) {
  const table = statementTable[meta.ticker];
  return table && meta.statementCurrencySource === 'hand-table:statement-currency' &&
    meta.statementCurrencyOriginal === table.statementCurrency && meta.statementFxRateApplied === 1 &&
    (meta.statementCurrencySeries !== 'annual' || container === 'annual') &&
    (table.series !== 'annual' || container === 'annual');
}

function revenueEvidence(snapshot, container, field, index, value, periodEnd, sourcePeriodEnd) {
  sourcePeriodEnd ??= periodEnd; // Older legs have no separate source end.
  const m = snapshot.meta || {}, cell = snapshot[container]?.[field]?.[index];
  const statement = statementApplied(m, container);
  const currency = statement ? 'USD' : m.reportingCurrency || null;
  const nativeCurrency = statement ? 'USD' : m.reportingCurrencyOriginal || currency;
  const rate = statement ? 1 : m.fxConverted === true ? number(m.fxRateApplied) : null;
  const result = {
    fieldPath: `${container}.${field}.${index}`, sourceType: 'vendor', provider: 'Yahoo Finance',
    retrievedAt: sourceTime(cell) || timestamp((m.reloadHistoryRetained || []).find(r => r.field === field && r.end === sourcePeriodEnd)?.fetchedAt) ||
      (m.statementPeriods?.[field]?.[index]?.end === sourcePeriodEnd ? sourceTime(m.statementPeriods[field][index]) : null),
    periodEnd, periodType: container === 'annual' ? 'year' : 'quarter', metricDefinition: 'Revenue',
    normalizedValue: value, normalizedCurrency: currency, nativeCurrency,
    nativeValue: nativeCurrency === currency ? value : null, nativeUnit: 'currency', unitMultiplier: 1,
    fx: fx(rate === null ? {} : { rate, fromCurrency: nativeCurrency, toCurrency: currency }),
  };
  const marker = cell?.financialCorrection || cell?.yahooQ4Correction;
  const config = cell?.financialCorrection ? financialTable : q4Table;
  const c = marker && config.cases.find(c => c.caseId === marker.caseId);
  const aliases = c ? [c.ticker, ...(c.listingAliases || [])] : [];
  const replacement = c && (Object.hasOwn(c, 'replacementValue') ? c.replacementValue : c.replacementNativeValue);
  const native = c && (c.currency || c.nativeCurrency);
  const factor = m.fxConverted === true ? number(m.fxRateApplied) : 1;
  // A persisted marker and the current value must agree with the authority, period and listing.
  // Mere membership (including already-equal vendor cells) never labels an operand corrected.
  if (c && aliases.includes(m.ticker) && c.field === field && c.period === sourcePeriodEnd &&
      marker.replacementNativeValue === replacement && marker.nativeCurrency === native &&
      native === (m.reportingCurrencyOriginal || m.reportingCurrency) && factor > 0 &&
      value === (replacement === null ? null : replacement * factor)) {
    Object.assign(result, sourceDocument(c.sources?.[0]), {
      sourceType: 'handTable', provider: null, correctionCaseId: c.caseId,
      retrievedAt: tableTime(c),
      correctionRevision: marker.revision || marker.evidenceRevision || null,
      nativeValue: replacement, nativeCurrency: native,
      metricDefinition: c.metricDefinition || 'Revenue',
    });
  } else if (statement) {
    Object.assign(result, sourceDocument(statementTable[m.ticker].source), {
      sourceType: 'handTable', provider: null,
      correctionCaseId: 'hand-table:statement-currency:' + m.ticker,
      retrievedAt: tableTime(statementTable[m.ticker]),
    });
  } else if (cell?.exchangeFill) {
    const fill = cell.exchangeFill;
    const expected = fill.nativeValue * (m.fxConverted === true ? m.fxRateApplied : 1);
    if (fill.period === sourcePeriodEnd && value === expected) {
      Object.assign(result, { sourceType: /^MOPS\b/.test(fill.source || '') ? 'exchange' : 'vendor',
        provider: fill.source || null, nativeValue: number(fill.nativeValue), nativeCurrency: fill.nativeCurrency || null,
        retrievedAt: timestamp(fill.fetchedAt), publishedAt: timestamp(fill.dataDate),
        qualityWarnings: ['source link missing'] });
    }
  }
  return result;
}

/** Capture the selected revenue operands and market-cap facts. @param {object} snapshot Prepared snapshot. */
function captureSnapshot(snapshot) {
  if (!snapshot) return null;
  const m = snapshot.meta || {}, leg = revGrowthLeg(snapshot), inputs = [];
  if (leg.basis === 'quarter' || leg.basis === 'year') {
    const quarterly = leg.basis === 'quarter';
    const field = quarterly ? 'revenueQ' : 'annualRev', container = quarterly ? 'timeseries' : 'annual';
    const prior = quarterly ? jahresVergleichIdx(snapshot, field, 0).idx : 1;
    const values = norm(snapshot, field);
    for (const [i, end, sourceEnd] of [[0, leg.periodEnd, leg.sourcePeriodEnd], [prior, leg.priorPeriodEnd, leg.sourcePriorPeriodEnd]]) {
      inputs.push(revenueEvidence(snapshot, container, field, i, values[i], end, sourceEnd));
    }
  } else if (leg.basis === 'yearNewerRecord') {
    const n = annualLegNewerYear(snapshot);
    for (const [key, end] of [['revenue', leg.periodEnd], ['priorRevenue', leg.priorPeriodEnd]]) {
      inputs.push({ fieldPath: 'meta.annualRevNewerYear.' + key, sourceType: 'vendor', provider: 'Yahoo Finance',
        retrievedAt: sourceTime(m.annualRevNewerYear?.[key]),
        periodEnd: end, periodType: 'year', metricDefinition: 'Revenue', nativeValue: n[key],
        normalizedValue: n[key], nativeCurrency: n.currency || null, normalizedCurrency: n.currency || null,
        nativeUnit: 'currency', unitMultiplier: 1 });
    }
  }
  const mc = snapshot.marketCap || {}, mcValue = cellValue(mc);
  const tradingCurrency = m.tradingCurrencyOriginal || m.tradingCurrency || null;
  // pull-yahoo._fxFactorFor stamps the PRICE factor, but both cap write paths use
  // factorMajorUnit. A pence quote's market capitalization is already in GBP.
  const pence = tradingCurrency === 'GBp' || tradingCurrency === 'GBX' || String(tradingCurrency).toUpperCase() === 'GBPENCE';
  const capCurrency = pence ? 'GBP' : tradingCurrency;
  const stampedRate = number(m.tradingFxRateApplied);
  const tradingRate = stampedRate > 0 ? stampedRate * (pence ? 100 : 1) :
    (capCurrency === (m.reportingCurrencyOriginal || m.reportingCurrency) && m.fxConverted === true && m.fxRateApplied > 0 ? number(m.fxRateApplied) : null);
  const marketCap = { fieldPath: 'marketCap', sourceType: 'vendor', provider: 'Yahoo Finance',
    periodType: 'instant', metricDefinition: 'Market capitalization', normalizedValue: mcValue,
    normalizedCurrency: 'USD', nativeCurrency: capCurrency,
    nativeValue: capCurrency === 'USD' ? mcValue : null, nativeUnit: 'currency', unitMultiplier: 1,
    // pull-yahoo._metric and the price-only writer stamp the cell's fetch time as asOf.
    retrievedAt: sourceTime(mc), observedAt: timestamp(mc.observedAt),
    fx: fx(tradingRate === null ? {} : { rate: tradingRate, fromCurrency: capCurrency, toCurrency: 'USD' }),
  };
  const kind = mc.source === 'hand-table:ads' ? 'ads' : mc.source === 'hand-table:shares' ? 'shares' : null;
  const marketCapInputs = [];
  if (kind) {
    Object.assign(marketCap, { sourceType: 'calculation', provider: null, retrievedAt: null, observedAt: null,
      nativeValue: null, nativeCurrency: null, correctionCaseId: `hand-table:${kind}:${m.ticker}`,
      missingReason: 'Hand-table market capitalization cannot be reproduced from its stored inputs.',
      derivation: derivation({ methodId: kind === 'ads' ? 'marketCapFromAds' : 'marketCapFromShares', methodVersion: '1' }) });
    // Table I/O belongs inside the guarded provenance step, never module startup.
    const table = kind === 'ads' ? loadAdsHandTable() : loadShareCountTable(), entry = table[m.ticker];
    if (entry) {
      const price = number(snapshot.price?.regularMarketPrice), shares = kind === 'ads' ? entry.yahooOrdinaryShares : entry.shares;
      const quotePull = snapshot._pullMode === 'price-only' && snapshot._pullModeAt === m.asOf ? timestamp(m.asOf) : null;
      const priceTime = sourceTime(snapshot.price) || quotePull;
      const storedCurrency = snapshot.price?.currencyUnit || m.priceCurrency || tradingCurrency;
      const usd = tradingCurrency === 'USD' && storedCurrency === 'USD';
      marketCapInputs.push({ fieldPath: 'price.regularMarketPrice', sourceType: 'vendor', provider: 'Yahoo Finance',
        metricDefinition: 'Quote price used by the hand-table applier', periodType: 'instant',
        normalizedValue: price, normalizedCurrency: storedCurrency, nativeValue: usd ? price : null,
        nativeCurrency: tradingCurrency, nativeUnit: 'currency', unitMultiplier: 1, retrievedAt: priceTime,
        observedAt: timestamp(snapshot.price?.regularMarketTime) || timestamp(snapshot.price?.observedAt),
        missingReason: usd ? null : 'The stored price is not proven to be in the table listing currency.' });
      marketCapInputs.push({ fieldPath: `handTable.${kind}.shares`, sourceType: 'handTable', provider: null,
        metricDefinition: kind === 'ads' ? 'Yahoo ordinary-share fingerprint stored in the ADS table' : 'Issuer shares outstanding',
        periodType: 'instant', nativeValue: shares, normalizedValue: shares, nativeUnit: 'shares', unitMultiplier: 1,
        retrievedAt: tableTime(entry), observedAt: timestamp(entry.sharesAsOf), correctionCaseId: marketCap.correctionCaseId,
        ...(kind === 'shares' ? sourceDocument(entry.source) : {
          missingReason: 'The ADS table documents the ratio, not an original source for the share count.',
          qualityWarnings: ['share-count source missing'] }) });
      if (kind === 'ads') {
        marketCapInputs.push({ fieldPath: 'handTable.ads.ordinaryPerAds', sourceType: 'handTable', provider: null,
          metricDefinition: 'Ordinary shares per ADS', periodType: 'instant', nativeValue: entry.ordinaryPerAds,
          normalizedValue: entry.ordinaryPerAds, nativeUnit: 'shares/ADS', unitMultiplier: 1,
          retrievedAt: tableTime(entry), correctionCaseId: marketCap.correctionCaseId, ...sourceDocument(entry.source),
          quote: typeof entry.source === 'string' ? [...entry.source.matchAll(/"([^"]+)"/g)].map(m => m[1]).join(' ... ') || null : entry.source?.quote ?? null });
      }
      // Retain the actual numerator so the expression preserves the applier's floating-point order.
      marketCapInputs.push({ fieldPath: 'marketCap.yahooValue', sourceType: 'vendor', provider: 'Yahoo Finance',
        metricDefinition: 'Yahoo market capitalization before the hand-table correction', periodType: 'instant',
        nativeValue: usd ? number(mc.yahooValue) : null, nativeCurrency: capCurrency, nativeUnit: 'currency', unitMultiplier: 1,
        normalizedValue: number(mc.yahooValue), normalizedCurrency: 'USD', retrievedAt: sourceTime(mc) });
      marketCap.derivation.expression = kind === 'ads' ? 'input[3] / input[2]' : 'input[2] * (input[1] / (input[2] / input[0]))';
      marketCap.derivation.rounding = 'none (IEEE-754 arithmetic in applier order)';
      const copy = { meta: { ...m }, marketCap: { ...mc, value: mc.yahooValue, source: 'yahoo_quote' } };
      const applied = (kind === 'ads' ? applyAdsHandTable : applyShareCountTable)(copy, m.ticker, price, table);
      const product = price * shares / (kind === 'ads' ? entry.ordinaryPerAds : 1);
      // The applier's 3% fingerprint guard is NOT a reproduction tolerance. Allow only arithmetic roundoff.
      const matchesProduct = Number.isFinite(product) && mcValue > 0 && Math.abs(product - mcValue) <= Number.EPSILON * 4 * Math.max(product, mcValue);
      const samePricePull = priceTime && priceTime === sourceTime(mc);
      if (usd && samePricePull && applied.status === 'corrected' && copy.marketCap.value === mcValue && matchesProduct &&
          (kind !== 'ads' || (mc.ordinaryPerAds === entry.ordinaryPerAds && (m.impliedSharesOutstanding || m.sharesOutstanding) === shares))) {
        marketCap.missingReason = null;
      }
    }
  }
  return { ticker: m.ticker, issuerId: m.cik == null ? null : 'cik:' + String(m.cik),
    leg, inputs, marketCap, marketCapInputs };
}

/** Reject private public-output content. @param {*} value Payload. @param {string} where Diagnostic path. */
function assertPublic(value, where = 'public') {
  if (Array.isArray(value)) { value.forEach((v, i) => assertPublic(v, `${where}[${i}]`)); return; }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (/email|password|credential|secret|api[_-]?key|(?:reviewer|creator|person|contact|first|last|full)[_-]?name/i.test(k)) {
        throw new Error(`provenance: prohibited public field at ${where}`);
      }
      assertPublic(v, where + '.' + k);
    }
  } else if (typeof value === 'string' &&
      (/[\w.+-]+@[\w.-]+\.[a-z]{2,}/i.test(value) || /(?:\bgh[pousr]_[a-z0-9]{20,}|\bgithub_pat_|\bsk-(?:proj-|svcacct-)?[a-z0-9_]{20,}|\bAKIA[0-9A-Z]{16}|\bbearer\s+[a-z0-9._-]{12,}|[?&](?:token|key|secret|password|access_token)=)/i.test(value))) {
    throw new Error(`provenance: prohibited public content at ${where}`);
  }
}

/** Read optional review records without changing them. @param {string} root Review directory. */
function readReviews(root) {
  if (!root || !fs.existsSync(root)) return [];
  const reviews = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isSymbolicLink()) throw new Error('provenance: review symlink is not allowed');
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.name.endsWith('.json')) {
        const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
        reviews.push(...(Array.isArray(parsed) ? parsed : [parsed]));
      }
    }
  }
  walk(root);
  reviews.forEach(review => { exactKeys(review, REVIEW_FIELDS, 'review'); assertPublic(review); });
  return reviews;
}

function involvedRecords(id, byId, visited = new Set()) {
  if (visited.has(id)) return [];
  visited.add(id);
  const r = byId.get(id);
  if (!r) throw new Error('provenance: missing evidence id ' + id);
  return [r, ...[...r.derivation.inputIds, ...r.derivation.cohortInputIds].flatMap(dep => involvedRecords(dep, byId, visited))];
}

function fieldReviews(ids, manifest, byId) {
  const superseded = new Set(manifest.reviews.map(r => r.supersedesReviewId).filter(Boolean));
  return manifest.reviews.filter(review => !superseded.has(review.id) && review.scopeId === SCOPE &&
    ['matched', 'reproduced'].includes(review.result) && timestamp(review.checkedAt) &&
    ids.some(id => {
      const record = byId.get(id);
      return record && review.evidenceIds.includes(id) && review.valueHash === record.valueHash &&
        review.methodVersion === record.derivation.methodVersion &&
        timestamp(review.sourceReopenedAt) && involvedRecords(id, byId).every(r =>
          review.reviewerSessionId !== r.creatorSessionId && r.missingReason === null &&
          !['unchecked', 'partial'].includes(r.derivation.cohortVerificationStatus) &&
          (r.sourceType === 'calculation' || (r.documentUrl && (r.page !== null || r.anchor || r.quote))));
    }));
}

function verificationFor(row, manifest, byId) {
  const requiredFields = FIELDS.filter(f => Object.hasOwn(row, f)), fieldStatus = {}, used = [];
  const verifiedFields = [];
  for (const field of requiredFields) {
    const presence = row[field] === null ? 'missing' : 'present';
    const reviews = presence === 'present' ? fieldReviews(row.provenance[field], manifest, byId) : [];
    if (reviews.length) verifiedFields.push(field);
    used.push(...reviews);
    fieldStatus[field] = { presence, verification: reviews.length ? (reviews.some(r => r.result === 'matched') ? 'matched' : 'reproduced') : 'unchecked',
      reason: reviews.length ? 'Independent review record matches this value and scope.' : 'No independent review of this value and scope.',
      reviewIds: unique(reviews.map(r => r.id)) };
  }
  const checkedAt = used.length ? used.map(r => r.checkedAt).sort().at(-1) : null;
  return { fieldStatus, verification: {
    status: verifiedFields.length ? (verifiedFields.length === requiredFields.length ? 'verified' : 'partial') : 'unchecked',
    scopeId: SCOPE, requiredFields, verifiedFields, openFields: requiredFields.filter(f => !verifiedFields.includes(f)),
    reviewIds: unique(used.map(r => r.id)), checkedAt,
    valueHash: valueHash(Object.fromEntries(requiredFields.map(f => [f, row[f]]))), reason: REASON,
  } };
}

function summaryFor(rows) {
  const count = status => rows.filter(r => r.verification.status === status).length;
  const dates = rows.map(r => r.verification.checkedAt).filter(Boolean).sort();
  return { scopeId: SCOPE, eligibleRows: rows.length, fullyVerifiedRows: count('verified'),
    partiallyVerifiedRows: count('partial'), uncheckedRows: count('unchecked'), withheldRows: count('withheld'),
    checkedAt: dates.at(-1) || null };
}

/** Add evidence to exports. @param {object[]} exportFiles Boards. @param {object} options Source and creator context. */
function buildProvenance(exportFiles, options = {}) {
  const runId = options.runId || randomUUID(), generatedAt = options.generatedAt || new Date().toISOString();
  const manifestPath = MANIFEST_PATHS[options.board || 'hypergrowth'];
  demand(manifestPath, 'unknown provenance board');
  const creator = options.creator || { engine: 'node', model: null, sessionId: writerSession };
  const manifest = { schema: SCHEMA, runId, generatedAt, records: [], reviews: options.reviews || [] };
  const byId = new Map(), cache = new Map();
  function record(row, captured, props) {
    const r = { ...empty(RECORD_FIELDS), issuerId: captured?.issuerId || null, listingId: 'yahoo:' + row.ticker,
      ticker: row.ticker, creatorEngine: creator.engine, creatorModel: creator.model, creatorSessionId: creator.sessionId,
      createdAt: options.creator ? generatedAt : null, periodType: 'none',
      qualityWarnings: [], fx: fx(), derivation: derivation(), ...props };
    r.valueHash = valueHash(r.normalizedValue);
    // Reuse evidence created earlier in this writer session, including its actual first
    // creation time. Repeated builds remain equal; another process has another lineage.
    if (!options.creator) {
      const key = valueHash(r);
      if (!evidenceCreatedAt.has(key)) evidenceCreatedAt.set(key, generatedAt);
      r.createdAt = evidenceCreatedAt.get(key);
    }
    // Bind the creator lineage as well as the cell. A later runtime must never turn an old
    // self-review into an independent review by assigning a different creator to the same id.
    r.id = 'e-' + valueHash(r);
    if (!byId.has(r.id)) { byId.set(r.id, r); manifest.records.push(r); }
    return r.id;
  }
  for (const file of exportFiles) for (const row of rowsOf(file)) {
    if (!cache.has(row.ticker)) cache.set(row.ticker, options.snapshotFor ? options.snapshotFor(row.ticker) : null);
    const captured = cache.get(row.ticker);
    row.provenance = {};
    for (const field of FIELDS.filter(f => Object.hasOwn(row, f))) {
      const value = row[field];
      if (field === 'revGrowthYoYPct') {
        const round = v => options.rounding === 'round1' && v !== null ? Math.round(v * 10) / 10 : v;
        const agrees = captured && round(captured.leg.pct) === value &&
          row.revGrowthBasis === captured.leg.basis && row.revGrowthPeriodEnd === captured.leg.periodEnd &&
          row.revGrowthPriorPeriodEnd === captured.leg.priorPeriodEnd;
        const inputs = agrees ? captured.inputs.map(p => record(row, captured, p)) : [];
        row.provenance[field] = [record(row, captured, { fieldPath: field, sourceType: 'calculation',
          normalizedValue: value, nativeUnit: 'percent', unitMultiplier: 1,
          periodType: agrees && captured.leg.basis !== 'none' ? (captured.leg.basis === 'quarter' ? 'quarter' : 'year') : 'none',
          periodEnd: row.revGrowthPeriodEnd ?? null, comparativeBasis: row.revGrowthPriorPeriodEnd ?? null,
          metricDefinition: 'Revenue year-over-year growth in percent',
          missingReason: inputs.length === 2 ? null : 'No matching revenue operand pair for the exported value.',
          derivation: derivation({ methodId: 'revGrowthLevel', methodVersion: '1',
            expression: inputs.length === 2 ? '(input[0] / input[1] - 1) * 100' : null,
            inputIds: inputs, rounding: options.rounding === 'round1' ? 'Math.round(value * 10) / 10' : 'none' }),
        })];
      } else {
        const agrees = captured && value === captured.marketCap.normalizedValue;
        const props = agrees ? { ...captured.marketCap } : {
          fieldPath: field, sourceType: 'calculation', normalizedValue: value, normalizedCurrency: 'USD',
          periodType: 'instant', metricDefinition: 'Market capitalization',
          missingReason: 'Exported value has no matching snapshot market capitalization; currency guard or source gap.',
        };
        if (agrees && captured.marketCapInputs?.length) props.derivation = {
          ...props.derivation, inputIds: captured.marketCapInputs.map(p => record(row, captured, p)),
        };
        row.provenance[field] = [record(row, captured, props)];
      }
    }
  }
  // Reviews for other input generations are read but never exported as dangling evidence.
  // Apply supersession before selecting the current generation, so an old review cannot revive.
  const superseded = new Set(manifest.reviews.map(r => r.supersedesReviewId).filter(Boolean));
  manifest.reviews = manifest.reviews.filter(r => !superseded.has(r.id) && Array.isArray(r.evidenceIds) &&
    r.evidenceIds.length > 0 && r.evidenceIds.every(id => byId.has(id)));
  const manifestHash = sha256(JSON.stringify(manifest, null, 2));
  for (const file of exportFiles) {
    for (const row of rowsOf(file)) Object.assign(row, verificationFor(row, manifest, byId));
    Object.assign(file, { provenanceVersion: 1, provenanceRunId: runId, provenanceManifest: manifestPath,
      provenanceManifestSha256: manifestHash, verificationSummary: summaryFor(rowsOf(file)) });
  }
  validateProvenance(exportFiles, manifest);
  return manifest;
}

function exactKeys(object, keys, where) {
  if (!object || typeof object !== 'object' || Array.isArray(object) ||
      JSON.stringify(Object.keys(object).sort()) !== JSON.stringify([...keys].sort())) throw new Error(`provenance: invalid keys in ${where}`);
}
function demand(ok, message) { if (!ok) throw new Error('provenance: ' + message); }

/** Validate values, lineage and exact bytes. @param {object[]} exportFiles Boards. @param {object|string|Buffer} input Manifest. */
function validateProvenance(exportFiles, input) {
  const bytes = Buffer.isBuffer(input) || typeof input === 'string' ? input : JSON.stringify(input, null, 2);
  const parsed = Buffer.isBuffer(input) || typeof input === 'string' ? JSON.parse(input.toString()) : input;
  const manifest = { ...parsed, records: Array.isArray(parsed.records) ? parsed.records.map(expandRecord) : parsed.records };
  exactKeys(manifest, ['schema', 'runId', 'generatedAt', 'records', 'reviews'], 'manifest');
  demand(manifest.schema === SCHEMA && /^[a-zA-Z0-9_-]+$/.test(manifest.runId), 'invalid manifest identity');
  demand(timestamp(manifest.generatedAt) && Array.isArray(manifest.records) && Array.isArray(manifest.reviews), 'invalid manifest envelope');
  assertPublic(manifest);
  const byId = new Map();
  for (const r of manifest.records) {
    exactKeys(r, RECORD_FIELDS, 'record'); exactKeys(r.fx, FX_FIELDS, 'fx'); exactKeys(r.derivation, DERIVATION_FIELDS, 'derivation');
    demand(typeof r.id === 'string' && r.id && !byId.has(r.id), 'evidence id must resolve exactly once: ' + r.id);
    demand(typeof r.creatorSessionId === 'string' && r.creatorSessionId.length > 0, 'missing creator session');
    demand(['filing', 'vendor', 'exchange', 'handTable', 'calculation'].includes(r.sourceType), 'invalid sourceType');
    demand(['quarter', 'year', 'ttm', 'instant', 'none'].includes(r.periodType), 'invalid periodType');
    demand(Array.isArray(r.qualityWarnings), 'invalid qualityWarnings');
    demand(Array.isArray(r.derivation.inputIds) && Array.isArray(r.derivation.cohortInputIds), 'invalid dependency ids');
    demand(['notApplicable', 'unchecked', 'partial', 'verified'].includes(r.derivation.cohortVerificationStatus), 'invalid cohort status');
    demand(r.valueHash === valueHash(r.normalizedValue), 'valueHash does not match record value: ' + r.id);
    if (r.fieldPath === 'marketCap') demand(r.normalizedCurrency === 'USD', 'marketCap normalizedCurrency must be USD (T1)');
    for (const f of ['retrievedAt', 'observedAt', 'publishedAt', 'filedAt', 'createdAt']) demand(r[f] === null || timestamp(r[f]), 'invalid time: ' + f);
    byId.set(r.id, r);
  }
  const visiting = new Set(), done = new Set();
  function visit(id) {
    demand(byId.has(id), 'missing evidence id ' + id);
    demand(!visiting.has(id), 'cycle in derivation at ' + id);
    if (done.has(id)) return;
    visiting.add(id);
    const d = byId.get(id).derivation;
    [...d.inputIds, ...d.cohortInputIds].forEach(visit);
    visiting.delete(id); done.add(id);
  }
  for (const id of byId.keys()) visit(id);
  const reviewIds = new Set();
  for (const review of manifest.reviews) {
    exactKeys(review, REVIEW_FIELDS, 'review');
    demand(typeof review.id === 'string' && review.id && !reviewIds.has(review.id), 'duplicate/invalid review id');
    reviewIds.add(review.id);
    demand(typeof review.reviewerSessionId === 'string' && review.reviewerSessionId.length > 0, 'missing reviewer session');
    demand(['matched', 'reproduced', 'mismatch', 'unverifiable', 'superseded'].includes(review.result), 'invalid review result');
    demand(Array.isArray(review.evidenceIds), 'invalid review evidenceIds');
    review.evidenceIds.forEach(id => demand(byId.has(id), 'missing review evidence id ' + id));
    for (const f of ['checkedAt', 'sourceReopenedAt']) demand(review[f] === null || timestamp(review[f]), 'invalid review time');
  }
  for (const file of exportFiles) {
    demand(file.provenanceVersion === 1 && file.provenanceRunId === manifest.runId &&
      Object.values(MANIFEST_PATHS).includes(file.provenanceManifest), 'header does not identify this manifest');
    demand(file.provenanceManifestSha256 === sha256(bytes), 'manifest SHA-256 does not match exact bytes');
    for (const row of rowsOf(file)) {
      const fields = FIELDS.filter(f => Object.hasOwn(row, f));
      exactKeys(row.provenance, fields, 'row.provenance'); exactKeys(row.fieldStatus, fields, 'row.fieldStatus');
      exactKeys(row.verification, VERIFICATION_FIELDS, 'row.verification');
      for (const field of fields) {
        const ids = row.provenance[field];
        demand(Array.isArray(ids) && ids.length > 0 && unique(ids).length === ids.length, 'invalid row evidence ids');
        for (const id of ids) {
          demand(byId.has(id), 'missing evidence id ' + id);
          const r = byId.get(id);
          demand(r.ticker === row.ticker && r.fieldPath === field, 'evidence belongs to another cell');
          demand(r.valueHash === valueHash(row[field]), 'valueHash does not match exported value');
        }
        exactKeys(row.fieldStatus[field], ['presence', 'verification', 'reason', 'reviewIds'], 'fieldStatus');
      }
      const expected = verificationFor(row, manifest, byId);
      demand(JSON.stringify(row.verification) === JSON.stringify(expected.verification) &&
        JSON.stringify(row.fieldStatus) === JSON.stringify(expected.fieldStatus), 'verification claim has no matching independent review or scope');
      assertPublic({ provenance: row.provenance, verification: row.verification, fieldStatus: row.fieldStatus });
    }
    exactKeys(file.verificationSummary, SUMMARY_FIELDS, 'verificationSummary');
    demand(JSON.stringify(file.verificationSummary) === JSON.stringify(summaryFor(rowsOf(file))), 'verificationSummary backwards count mismatch (T8)');
  }
  // Check after the specific diagnostics above; an omitted non-null source field must
  // not become a valid null merely because it was re-expanded.
  for (const r of manifest.records) demand(r.id === 'e-' + valueHash({ ...r, id: null }), 'evidence id does not match expanded record');
  return true;
}

/** Atomically persist a manifest. @param {object[]} exportFiles Boards. @param {object} options Paths and source context. */
function writeProvenance(exportFiles, options) {
  const reviews = readReviews(options.reviewRoot);
  const manifest = buildProvenance(exportFiles, { ...options, reviews });
  const file = path.join(options.outDir, MANIFEST_PATHS[options.board || 'hypergrowth']);
  const dir = path.dirname(file);
  const bytes = serializeManifest(manifest);
  for (const exported of exportFiles) exported.provenanceManifestSha256 = sha256(bytes);
  validateProvenance(exportFiles, bytes);
  fs.mkdirSync(dir, { recursive: true });
  writeFileAtomic(file, bytes, 'utf8');
  // Exact-byte validation also proves a previous run was replaced, never merged.
  validateProvenance(exportFiles, fs.readFileSync(file));
  // The gh-pages deploy never deletes files, so a local delete would leave a published failure
  // marker forever. A success therefore OVERWRITES the marker at the same path with status ok.
  writeJsonAtomic(path.join(dir, '_failed.json'), {
    schema: SCHEMA, status: 'ok', board: options.board || 'hypergrowth', provenanceRunId: manifest.runId,
    provenanceManifestSha256: sha256(bytes), at: new Date().toISOString(),
  });
  return manifest;
}

/** Publish a visible failure without source/private details leaking. @param {string} outDir Export root. @param {string} board Board group. @param {Error} error Failure. */
function writeProvenanceFailure(outDir, board, error) {
  const file = path.join(outDir, MANIFEST_PATHS[board]);
  let reason = String(error?.message || error).replace(/[A-Za-z]:[\\/][^\r\n'"]*/g, '[local path]').replace(/[\r\n]+/g, ' ');
  try { assertPublic(reason); } catch (_) { reason = 'Provenance helper failed; private details withheld.'; }
  console.warn('::warning::provenance withheld: ' + reason);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.rmSync(file, { force: true });
  writeJsonAtomic(path.join(path.dirname(file), '_failed.json'), {
    schema: SCHEMA, status: 'failed', generated_at: new Date().toISOString(), board, reason,
  });
}

/**
 * Reads and validates the status marker next to a manifest; absence returns null (older exports).
 * @param {string} markerPath Absolute path of provenance/_failed.json or rule40/provenance/_failed.json.
 * @param {string} board Expected board group (hypergrowth or rule40).
 * @returns {object|null} The validated marker ({status:'failed'|'ok', ...}) or null when the file is absent.
 */
function readStatusMarker(markerPath, board) {
  if (!fs.existsSync(markerPath)) return null;
  const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
  demand(marker && (marker.status === 'failed' || marker.status === 'ok'), 'invalid marker status');
  if (marker.status === 'failed') {
    exactKeys(marker, ['schema', 'status', 'generated_at', 'board', 'reason'], 'failure marker');
    demand(marker.schema === SCHEMA && marker.board === board && timestamp(marker.generated_at) &&
      typeof marker.reason === 'string' && marker.reason.length > 0, 'invalid failure marker');
  } else {
    exactKeys(marker, ['schema', 'status', 'board', 'provenanceRunId', 'provenanceManifestSha256', 'at'], 'ok marker');
    demand(marker.schema === SCHEMA && marker.board === board && timestamp(marker.at) &&
      /^[a-zA-Z0-9_-]+$/.test(marker.provenanceRunId) && /^[0-9a-f]{64}$/.test(marker.provenanceManifestSha256), 'invalid ok marker');
  }
  assertPublic(marker);
  return marker;
}

/** Collect disk contract failures. @param {string} outDir Export root. @param {string[]} relativeFiles Boards. @param {boolean} required Require provenance. */
function provenanceErrors(outDir, relativeFiles, required = false) {
  const errors = [], groups = new Map(), withheld = new Set();
  for (const relative of relativeFiles) {
    try {
      // Existing legacy validators already diagnose absent board files. CLI checks require all.
      if (!required && !fs.existsSync(path.join(outDir, relative))) continue;
      const file = JSON.parse(fs.readFileSync(path.join(outDir, relative), 'utf8'));
      const board = relative.replace(/\\/g, '/').startsWith('rule40/') ? 'rule40' : 'hypergrowth';
      const expectedPath = MANIFEST_PATHS[board];
      const present = HEADER_FIELDS.some(f => Object.hasOwn(file, f)) || rowsOf(file).some(row => ROW_FIELDS.some(f => Object.hasOwn(row, f)));
      if (!present) {
        if (!required) continue; // legacy object seams; CLI requires the contract or a visible failure
        const marker = readStatusMarker(path.join(outDir, path.dirname(expectedPath), '_failed.json'), board);
        demand(marker !== null, 'missing provenance without _failed.json marker');
        // Decided on status plus header, never on existence: an ok marker cannot excuse missing provenance.
        demand(marker.status === 'failed', 'missing provenance but the marker says ok');
        if (!withheld.has(expectedPath)) console.warn('::warning::provenance withheld: ' + marker.reason);
        withheld.add(expectedPath);
        continue;
      }
      demand(file.provenanceManifest === expectedPath, 'invalid manifest path');
      if (!groups.has(file.provenanceManifest)) groups.set(file.provenanceManifest, []);
      groups.get(file.provenanceManifest).push(file);
    } catch (e) { errors.push(relative + ': ' + e.message); }
  }
  for (const [relative, files] of groups) {
    try {
      demand(!withheld.has(relative), 'partially withheld provenance');
      validateProvenance(files, fs.readFileSync(path.join(outDir, relative)));
      const board = relative === MANIFEST_PATHS.rule40 ? 'rule40' : 'hypergrowth';
      const marker = readStatusMarker(path.join(outDir, path.dirname(relative), '_failed.json'), board);
      if (marker) {
        demand(marker.status === 'ok', 'provenance present but the marker still says failed');
        demand(files.every(f => f.provenanceRunId === marker.provenanceRunId &&
          f.provenanceManifestSha256 === marker.provenanceManifestSha256), 'ok marker does not match the board header');
      }
    }
    catch (e) { errors.push(relative + ': ' + e.message); }
  }
  return errors;
}

module.exports = { SCHEMA, SCOPE, FIELDS, REASON, HEADER_FIELDS, ROW_FIELDS, RECORD_FIELDS, FX_FIELDS, DERIVATION_FIELDS,
  REVIEW_FIELDS, VERIFICATION_FIELDS, SUMMARY_FIELDS, captureSnapshot, buildProvenance, writeProvenance,
  validateProvenance, provenanceErrors, readReviews, assertPublic, valueHash, sha256, rowsOf,
  MANIFEST_PATHS, expandRecord, serializeManifest, writeProvenanceFailure, readStatusMarker };

#!/usr/bin/env node
/**
 * Masterplan 5.1: reine Daten-Coverage-Probe fuer acht Hypergrowth-Achsen.
 *
 * Quellen/Hosts:
 *   - SEC company_tickers.json als deterministische Ticker-Basis
 *   - Yahoo Fundamentals Time Series fuer Marktkapitalisierung und Rohreihen
 *   - SEC companyfacts fuer dieselben Rohreihen aus XBRL
 *
 * Der offizielle Report wird nur beim Voll-Lauf (--sample 100) geschrieben.
 * So ueberschreibt der geforderte Mini-Test (--sample 5) nicht den Vollbericht.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PROBE_DATE = '2026-07-16';
const REPORT_JSON = path.join(ROOT, 'reports', `smallcap-probe-${PROBE_DATE}.json`);
const REPORT_MD = path.join(ROOT, 'reports', `smallcap-probe-${PROBE_DATE}.md`);
const OFFICIAL_SAMPLE = 100;
const SEED = 'smallcap-probe-2026-07-16-v1';
const MIN_MCAP = 300_000_000;
const MAX_MCAP = 800_000_000;
const SEC_UA = 'screener-data coverage-probe (github.com/Karlryl/screener-data)';
const SEC_TICKERS_URL = 'https://www.sec.gov/files/company_tickers.json';
const SEC_DELAY_MS = 175; // ausdruecklich >= 150 ms je SEC-Request
const YAHOO_DELAY_MS = 300;
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 3;
const PERIOD1 = Math.floor(Date.UTC(2010, 0, 1) / 1000);
const PERIOD2 = Math.floor(Date.now() / 1000);

const YAHOO_TYPES = [
  'trailingMarketCap',
  'annualTotalRevenue',
  'quarterlyTotalRevenue',
  'annualGrossProfit',
  'annualOperatingIncome',
  'quarterlyOperatingIncome',
  'annualTotalAssets',
  'annualCurrentLiabilities',
  'annualStockBasedCompensation',
  'annualFreeCashFlow',
  'annualOperatingCashFlow',
  'annualCapitalExpenditure',
  'trailingFreeCashFlow',
  'trailingTotalRevenue'
];

const FIELD_DEFS = {
  annualRevenue: {
    label: 'Umsatz, jaehrlich',
    yahoo: ['annualTotalRevenue'],
    xbrl: [
      'RevenueFromContractWithCustomerExcludingAssessedTax',
      'RevenueFromContractWithCustomerIncludingAssessedTax',
      'Revenues', 'SalesRevenueNet'
    ]
  },
  quarterlyRevenue: {
    label: 'Umsatz, quartalsweise',
    yahoo: ['quarterlyTotalRevenue'],
    xbrl: [
      'RevenueFromContractWithCustomerExcludingAssessedTax',
      'RevenueFromContractWithCustomerIncludingAssessedTax',
      'Revenues', 'SalesRevenueNet'
    ]
  },
  annualGrossProfit: {
    label: 'Bruttogewinn, jaehrlich',
    yahoo: ['annualGrossProfit'],
    xbrl: ['GrossProfit']
  },
  annualOperatingIncome: {
    label: 'Operatives Ergebnis, jaehrlich',
    yahoo: ['annualOperatingIncome'],
    xbrl: ['OperatingIncomeLoss']
  },
  quarterlyOperatingIncome: {
    label: 'Operatives Ergebnis, quartalsweise',
    yahoo: ['quarterlyOperatingIncome'],
    xbrl: ['OperatingIncomeLoss']
  },
  annualAssets: {
    label: 'Bilanzsumme, jaehrlich',
    yahoo: ['annualTotalAssets'],
    xbrl: ['Assets']
  },
  annualCurrentLiabilities: {
    label: 'Kurzfristige Verbindlichkeiten, jaehrlich',
    yahoo: ['annualCurrentLiabilities'],
    xbrl: ['LiabilitiesCurrent']
  },
  annualSBC: {
    label: 'Aktienbasierte Verguetung (SBC), jaehrlich',
    yahoo: ['annualStockBasedCompensation'],
    xbrl: ['ShareBasedCompensation']
  },
  annualFCF: {
    label: 'Free Cashflow, jaehrlich',
    yahoo: ['annualFreeCashFlow'],
    xbrl: ['abgeleitet: OCF minus Capex']
  },
  annualOCF: {
    label: 'Operativer Cashflow, jaehrlich',
    yahoo: ['annualOperatingCashFlow'],
    xbrl: [
      'NetCashProvidedByUsedInOperatingActivities',
      'NetCashProvidedByUsedInOperatingActivitiesContinuingOperations'
    ]
  },
  fcfMarginTTM: {
    label: 'FCF-Marge, TTM',
    yahoo: ['trailingFreeCashFlow / trailingTotalRevenue'],
    xbrl: ['nicht als eigener TTM-Fakt; Jahres-FCF/Jahresumsatz nur Guard-Hilfe']
  },
  estimateRevisions: {
    label: 'Analystenrevisionen 0y/+1y, 30/90 Tage',
    yahoo: ['earningsTrend.epsRevisions'],
    xbrl: ['kein SEC-XBRL-Konzept']
  }
};

// Coverage bedeutet: Die jeweilige Funktion aus axes.js kann nach ihrer
// minimalen Nicht-null-Semantik einen Wert bilden. Optionale Tilts/Guards stehen
// separat, damit deren Fehlen die Kern-Coverage nicht kuenstlich auf null setzt.
const AXES = [
  {
    id: 'revGrowthLevel',
    label: 'Umsatzwachstum (Niveau)',
    required: 'quartalsweiser Umsatz >=5 ODER jaehrlicher Umsatz >=2',
    optional: 'keine',
    fields: ['quarterlyRevenue', 'annualRevenue'],
    available: d => hasRevenueGrowthPath(d)
  },
  {
    id: 'revAcceleration',
    label: 'Umsatz-Beschleunigung',
    required: 'quartalsweiser Umsatz mit >=2 positiven QoQ-Paaren (mind. 3 Werte)',
    optional: 'keine',
    fields: ['quarterlyRevenue'],
    available: d => positiveValues(d.quarterlyRevenue).length >= 3
  },
  {
    id: 'gpGrowth',
    label: 'Bruttogewinn-Wachstum + GM-Trajektorie',
    required: 'jaehrlicher Bruttogewinn >=2; aelterer Wert >0',
    optional: 'jaehrlicher Umsatz fuer den GM-Trajektorie-Tilt',
    fields: ['annualGrossProfit', 'annualRevenue'],
    available: d => hasTwoWithPositiveOlder(d.annualGrossProfit)
  },
  {
    id: 'ruleOfX',
    label: 'Growth-Efficiency (Rule-of-X)',
    required: 'derselbe Umsatz-Wachstumspfad wie revGrowthLevel',
    optional: 'FCF-Marge TTM sowie jaehrlicher FCF/OCF als Vorzeichen-Guard; im Unprofit-Track deaktiviert',
    fields: ['quarterlyRevenue', 'annualRevenue', 'fcfMarginTTM', 'annualFCF', 'annualOCF'],
    available: d => hasRevenueGrowthPath(d)
  },
  {
    id: 'marginTrajectory',
    label: 'Margentrajektorie',
    required: '>=2 zeitgleiche Quartale mit Umsatz >0 und operativem Ergebnis',
    optional: 'keine',
    fields: ['quarterlyRevenue', 'quarterlyOperatingIncome'],
    available: d => alignedPairs(d.quarterlyRevenue, d.quarterlyOperatingIncome, (r, o) => r > 0 && finite(o)).length >= 2
  },
  {
    id: 'capitalEfficiency',
    label: 'Kapitaleffizienz / Asset-Disziplin',
    required: '>=1 zeitgleiches Jahr: operatives Ergebnis, Bilanzsumme, kurzfristige Verbindlichkeiten; investiertes Kapital >0',
    optional: '>=2 Bilanzsummen und Umsaetze fuer Asset-Growth-Penalty; >=3 OpMargin-Jahre fuer Zyklus-Discount',
    fields: ['annualOperatingIncome', 'annualAssets', 'annualCurrentLiabilities', 'annualRevenue'],
    available: d => capitalPairs(d).length >= 1
  },
  {
    id: 'revisionsMomentum',
    label: 'Analysten-Revisions-Momentum',
    required: '>=1 Up/Down-Paar fuer 0y/+1y und 30/90 Tage mit Summe >0',
    optional: 'keine',
    fields: ['estimateRevisions'],
    available: d => Array.isArray(d.estimateRevisions) && d.estimateRevisions.some(x => finite(x.up) && finite(x.down) && x.up + x.down > 0)
  },
  {
    id: 'dilution',
    label: 'Dilution / SBC-Drag',
    required: '>=1 zeitgleiches Jahr mit SBC und Umsatz !=0',
    optional: 'zweites Jahr fuer den SBC/Umsatz-Trend',
    fields: ['annualSBC', 'annualRevenue'],
    available: d => alignedPairs(d.annualSBC, d.annualRevenue, (sbc, rev) => finite(sbc) && finite(rev) && rev !== 0).length >= 1
  }
];

const SEC_CONCEPTS = {
  revenue: FIELD_DEFS.annualRevenue.xbrl,
  grossProfit: FIELD_DEFS.annualGrossProfit.xbrl,
  operatingIncome: FIELD_DEFS.annualOperatingIncome.xbrl,
  assets: FIELD_DEFS.annualAssets.xbrl,
  currentLiabilities: FIELD_DEFS.annualCurrentLiabilities.xbrl,
  sbc: FIELD_DEFS.annualSBC.xbrl,
  ocf: FIELD_DEFS.annualOCF.xbrl,
  capex: [
    'PaymentsToAcquirePropertyPlantAndEquipment',
    'PaymentsForAdditionsToPropertyPlantAndEquipment',
    'PaymentsToAcquireProductiveAssets'
  ]
};

let nextSecAt = 0;
let nextYahooAt = 0;

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function finite(v) { return Number.isFinite(v); }
function pct(n, total) { return total ? Number((100 * n / total).toFixed(1)) : 0; }
function readJson(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return null; } }
function errText(error) { return String(error && error.message ? error.message : error).replace(/\s+/g, ' ').slice(0, 240); }

function parseArgs(argv) {
  let sample = OFFICIAL_SAMPLE;
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--sample' && argv[i + 1]) sample = Number(argv[++i]);
    else throw new Error(`Unbekanntes Argument: ${argv[i]}`);
  }
  if (!Number.isInteger(sample) || sample < 1 || sample > 200) {
    throw new Error('--sample muss eine ganze Zahl zwischen 1 und 200 sein');
  }
  return { sample };
}

function assertAllowedHost(url) {
  const host = new URL(url).hostname.toLowerCase();
  const yahoo = /^query\d+\.finance\.yahoo\.com$/.test(host);
  const sec = host === 'sec.gov' || host.endsWith('.sec.gov');
  if (!yahoo && !sec) throw new Error(`Host nicht erlaubt: ${host}`);
  return yahoo ? 'yahoo' : 'sec';
}

async function reserveSlot(provider) {
  const now = Date.now();
  const next = provider === 'sec' ? nextSecAt : nextYahooAt;
  const delay = provider === 'sec' ? SEC_DELAY_MS : YAHOO_DELAY_MS;
  if (next > now) await sleep(next - now);
  if (provider === 'sec') nextSecAt = Date.now() + delay;
  else nextYahooAt = Date.now() + delay;
}

async function fetchJson(url) {
  const provider = assertAllowedHost(url);
  let lastError;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    await reserveSlot(provider);
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
    try {
      const headers = provider === 'sec'
        ? { 'User-Agent': SEC_UA, 'Accept': 'application/json' }
        : { 'User-Agent': 'Mozilla/5.0 screener-data-coverage-probe', 'Accept': 'application/json' };
      const response = await fetch(url, { headers, signal: ctrl.signal, redirect: 'follow' });
      const body = await response.text();
      if (!response.ok) {
        const error = new Error(`HTTP ${response.status} ${body.slice(0, 120).replace(/\s+/g, ' ')}`);
        error.status = response.status;
        throw error;
      }
      return JSON.parse(body);
    } catch (error) {
      lastError = error;
      const retryable = error.name === 'AbortError' || !error.status || error.status === 429 || error.status >= 500;
      if (!retryable || attempt === MAX_RETRIES) break;
      await sleep(500 * attempt);
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError;
}

function fnv1a(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function normalizeTickerEntry(entry) {
  const ticker = String(entry && entry.ticker || '').trim().toUpperCase();
  const cikRaw = entry && (entry.cik_str != null ? entry.cik_str : entry.cik);
  const cik = cikRaw != null && cikRaw !== '' ? String(cikRaw).padStart(10, '0') : null;
  if (!ticker || !cik || !/^[A-Z][A-Z0-9]{0,5}([.\-][A-Z])?$/.test(ticker)) return null;
  return { ticker, yahooSymbol: ticker.replace('.', '-'), cik, name: String(entry.title || entry.name || ticker) };
}

function fallbackTickerBasis() {
  // Nur Read-only-Fallback fuer SEC-WAF-Ausfaelle. Beide Dateien wurden durch
  // die bestehende SEC-Pipeline aus company_tickers/companyfacts erzeugt.
  const byTicker = new Map();
  const tickerMap = readJson(path.join(ROOT, 'external-data', 'sec-ticker-cik-map.json'));
  for (const [ticker, entry] of Object.entries(tickerMap && tickerMap.byTicker || {})) {
    const row = normalizeTickerEntry({ ticker, cik: entry.cik, name: entry.name || ticker });
    if (row) byTicker.set(row.ticker, row);
  }
  const manifest = readJson(path.join(ROOT, 'external-data', 'sec-xbrl', '_manifest.json'));
  for (const [cik, entry] of Object.entries(manifest && manifest.entries || {})) {
    const row = normalizeTickerEntry({ ticker: entry.ticker, cik, name: entry.ticker });
    if (row) byTicker.set(row.ticker, row);
  }
  const secAnnual = readJson(path.join(ROOT, 'external-data', 'sec-secannual.json')) || {};
  for (const [ticker, entry] of Object.entries(secAnnual)) {
    const row = normalizeTickerEntry({ ticker, cik: entry.cik, name: ticker });
    if (row) byTicker.set(row.ticker, row);
  }
  return [...byTicker.values()];
}

async function loadTickerBasis() {
  let rows;
  let source = 'SEC company_tickers.json (live)';
  let fetchError = null;
  try {
    const json = await fetchJson(SEC_TICKERS_URL);
    rows = Object.values(json).map(normalizeTickerEntry).filter(Boolean);
  } catch (error) {
    fetchError = errText(error);
    rows = fallbackTickerBasis();
    source = 'lokaler Read-only-SEC-Pipeline-Fallback nach Fehler bei company_tickers.json';
  }
  if (!rows.length) throw new Error(`Keine SEC-Tickerbasis verfuegbar${fetchError ? `: ${fetchError}` : ''}`);

  // Vorgabe: erst kanonisch sortierte Basis, dann feste Seed-Rangfolge.
  rows.sort((a, b) => a.ticker.localeCompare(b.ticker) || a.cik.localeCompare(b.cik));
  rows = rows.map((row, sortedIndex) => ({ ...row, sortedIndex, seedRank: fnv1a(`${SEED}:${row.ticker}:${row.cik}`) }));
  rows.sort((a, b) => a.seedRank - b.seedRank || a.sortedIndex - b.sortedIndex);
  return { rows, source, fetchError };
}

function yahooFtsUrl(symbol, types) {
  const sym = encodeURIComponent(symbol);
  const qs = new URLSearchParams({ symbol, type: types.join(','), period1: String(PERIOD1), period2: String(PERIOD2) });
  return `https://query1.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/${sym}?${qs}`;
}

function yahooChartUrl(symbol) {
  return `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`;
}

function extractYahooRows(payload) {
  const out = {};
  for (const row of payload && payload.timeseries && payload.timeseries.result || []) {
    const type = row && row.meta && row.meta.type && row.meta.type[0];
    if (!type || !Array.isArray(row[type])) continue;
    out[type] = row[type].map(item => ({
      date: item.asOfDate || (finite(item.timestamp) ? new Date(item.timestamp * 1000).toISOString().slice(0, 10) : null),
      value: item.reportedValue && finite(item.reportedValue.raw) ? item.reportedValue.raw : null
    })).filter(item => item.date && finite(item.value)).sort((a, b) => b.date.localeCompare(a.date));
  }
  return out;
}

async function yahooMarketCap(company) {
  const payload = await fetchJson(yahooFtsUrl(company.yahooSymbol, ['trailingMarketCap']));
  const rows = extractYahooRows(payload).trailingMarketCap || [];
  return rows.length ? rows[0].value : null;
}

async function yahooUsEquityMeta(company) {
  const payload = await fetchJson(yahooChartUrl(company.yahooSymbol));
  const meta = payload && payload.chart && payload.chart.result && payload.chart.result[0] && payload.chart.result[0].meta;
  if (!meta) return { accepted: false, reason: 'chart.meta fehlt' };
  const accepted = meta.instrumentType === 'EQUITY' && meta.currency === 'USD' && meta.exchangeTimezoneName === 'America/New_York';
  return {
    accepted,
    reason: accepted ? null : `instrumentType=${meta.instrumentType || 'null'}, currency=${meta.currency || 'null'}, timezone=${meta.exchangeTimezoneName || 'null'}`,
    exchange: meta.exchangeName || meta.fullExchangeName || null,
    currency: meta.currency || null,
    instrumentType: meta.instrumentType || null
  };
}

async function selectSample(basis, requested) {
  const selected = [];
  const scanErrors = [];
  let scanned = 0;
  for (const company of basis) {
    scanned++;
    try {
      const marketCap = await yahooMarketCap(company);
      if (!(finite(marketCap) && marketCap >= MIN_MCAP && marketCap <= MAX_MCAP)) continue;
      const meta = await yahooUsEquityMeta(company);
      if (!meta.accepted) continue;
      selected.push({ ...company, marketCap, yahooMeta: meta });
      console.log(`[select] ${selected.length}/${requested} ${company.ticker} mcap=${Math.round(marketCap / 1e6)}M`);
      if (selected.length >= requested) break;
    } catch (error) {
      scanErrors.push({ ticker: company.ticker, error: errText(error) });
    }
    if (scanned % 100 === 0) console.log(`[scan] ${scanned} geprueft, ${selected.length}/${requested} im Band`);
  }
  if (selected.length < requested) {
    throw new Error(`Nur ${selected.length}/${requested} passende Firmen nach ${scanned} SEC-Tickern gefunden`);
  }
  return { selected, scanned, scanErrors };
}

function emptyData() {
  const data = {};
  for (const key of Object.keys(FIELD_DEFS)) data[key] = [];
  return data;
}

function ratioPoint(numeratorRows, denominatorRows) {
  const pairs = alignedPairs(numeratorRows, denominatorRows, (a, b) => finite(a) && finite(b) && b !== 0);
  return pairs.length ? [{ date: pairs[0].date, value: 100 * pairs[0].left / pairs[0].right }] : [];
}

function yahooDataFromRows(rows, revisions) {
  const d = emptyData();
  d.annualRevenue = rows.annualTotalRevenue || [];
  d.quarterlyRevenue = rows.quarterlyTotalRevenue || [];
  d.annualGrossProfit = rows.annualGrossProfit || [];
  d.annualOperatingIncome = rows.annualOperatingIncome || [];
  d.quarterlyOperatingIncome = rows.quarterlyOperatingIncome || [];
  d.annualAssets = rows.annualTotalAssets || [];
  d.annualCurrentLiabilities = rows.annualCurrentLiabilities || [];
  d.annualSBC = rows.annualStockBasedCompensation || [];
  d.annualFCF = rows.annualFreeCashFlow || [];
  d.annualOCF = rows.annualOperatingCashFlow || [];
  d.fcfMarginTTM = ratioPoint(rows.trailingFreeCashFlow || [], rows.trailingTotalRevenue || []);
  d.estimateRevisions = revisions || [];
  return d;
}

function unwrapYahooNumber(value) {
  if (finite(value)) return value;
  if (value && finite(value.raw)) return value.raw;
  if (value && finite(value.value)) return value.value;
  return null;
}

function extractRevisionRows(payload) {
  const trend = payload && payload.quoteSummary && payload.quoteSummary.result && payload.quoteSummary.result[0] && payload.quoteSummary.result[0].earningsTrend;
  const rows = [];
  for (const item of trend && trend.trend || []) {
    if (!['0y', '+1y'].includes(item.period)) continue;
    const er = item.epsRevisions || {};
    for (const days of [30, 90]) {
      const up = unwrapYahooNumber(er[`upLast${days}days`] != null ? er[`upLast${days}days`] : er[`upLast${days}Days`]);
      const down = unwrapYahooNumber(er[`downLast${days}days`] != null ? er[`downLast${days}days`] : er[`downLast${days}Days`]);
      if (finite(up) || finite(down)) rows.push({ horizon: item.period, days, up, down });
    }
  }
  return rows;
}

async function probeYahooRevisionCapability(company) {
  const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(company.yahooSymbol)}?modules=earningsTrend`;
  try {
    const payload = await fetchJson(url);
    return { supported: true, firstTicker: company.ticker, firstRows: extractRevisionRows(payload), error: null };
  } catch (error) {
    return { supported: false, firstTicker: company.ticker, firstRows: [], error: errText(error) };
  }
}

async function fetchYahooCompany(company, revisionCapability) {
  try {
    const payload = await fetchJson(yahooFtsUrl(company.yahooSymbol, YAHOO_TYPES));
    const rows = extractYahooRows(payload);
    let revisions = [];
    let revisionError = revisionCapability.error;
    if (revisionCapability.supported) {
      if (company.ticker === revisionCapability.firstTicker) revisions = revisionCapability.firstRows;
      else {
        try {
          const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(company.yahooSymbol)}?modules=earningsTrend`;
          revisions = extractRevisionRows(await fetchJson(url));
          revisionError = null;
        } catch (error) { revisionError = errText(error); }
      }
    }
    return { data: yahooDataFromRows(rows, revisions), error: null, revisionError };
  } catch (error) {
    return { data: emptyData(), error: errText(error), revisionError: revisionCapability.error };
  }
}

function conceptFacts(companyfacts, concepts) {
  const usGaap = companyfacts && companyfacts.facts && companyfacts.facts['us-gaap'] || {};
  const rows = [];
  concepts.forEach((concept, priority) => {
    const fact = usGaap[concept];
    if (!fact || !fact.units) return;
    const units = fact.units.USD || Object.values(fact.units)[0] || [];
    for (const item of units) {
      if (!finite(item.val) || !item.end) continue;
      rows.push({ ...item, concept, priority });
    }
  });
  return rows;
}

function daysBetween(start, end) {
  if (!start || !end) return null;
  const days = (Date.parse(end) - Date.parse(start)) / 86_400_000;
  return finite(days) ? days : null;
}

function preferFact(a, b) {
  if (!a) return b;
  if (b.priority !== a.priority) return b.priority < a.priority ? b : a;
  const filedA = a.filed || '';
  const filedB = b.filed || '';
  return filedB > filedA ? b : a;
}

function groupFacts(rows, predicate) {
  const byEnd = new Map();
  for (const row of rows) {
    if (!predicate(row)) continue;
    byEnd.set(row.end, preferFact(byEnd.get(row.end), row));
  }
  return [...byEnd.values()].sort((a, b) => b.end.localeCompare(a.end));
}

function annualFlow(companyfacts, concepts) {
  return groupFacts(conceptFacts(companyfacts, concepts), row => {
    const days = daysBetween(row.start, row.end);
    return days != null && days >= 300 && days <= 450 && /^(10-K|10-K\/A)$/.test(row.form || '');
  }).map(row => ({ date: row.end, value: row.val }));
}

function annualInstant(companyfacts, concepts) {
  return groupFacts(conceptFacts(companyfacts, concepts), row => {
    return !row.start && /^(10-K|10-K\/A)$/.test(row.form || '');
  }).map(row => ({ date: row.end, value: row.val }));
}

function quarterlyFlow(companyfacts, concepts) {
  const facts = conceptFacts(companyfacts, concepts);
  const direct = groupFacts(facts, row => {
    const days = daysBetween(row.start, row.end);
    return days != null && days >= 60 && days <= 120 && /^(10-Q|10-Q\/A|10-K|10-K\/A)$/.test(row.form || '');
  }).map(row => ({ date: row.end, value: row.val }));

  // 10-Ks enthalten Q4 meist nur als FY-Wert. Q4 = FY minus 9M-YTD, wenn
  // Startdatum und zeitliche Lage zusammenpassen; nichts wird interpoliert.
  const annual = groupFacts(facts, row => {
    const days = daysBetween(row.start, row.end);
    return days != null && days >= 300 && days <= 450 && /^(10-K|10-K\/A)$/.test(row.form || '');
  });
  const ytd9m = groupFacts(facts, row => {
    const days = daysBetween(row.start, row.end);
    return days != null && days >= 240 && days <= 310 && /^(10-Q|10-Q\/A)$/.test(row.form || '');
  });
  const byDate = new Map(direct.map(row => [row.date, row]));
  for (const fy of annual) {
    const prior = ytd9m.find(row => row.start === fy.start && Date.parse(fy.end) - Date.parse(row.end) >= 45 * 86_400_000 && Date.parse(fy.end) - Date.parse(row.end) <= 150 * 86_400_000);
    if (prior && !byDate.has(fy.end)) byDate.set(fy.end, { date: fy.end, value: fy.val - prior.val });
  }
  return [...byDate.values()].sort((a, b) => b.date.localeCompare(a.date));
}

function secDataFromCompanyFacts(companyfacts) {
  const d = emptyData();
  d.annualRevenue = annualFlow(companyfacts, SEC_CONCEPTS.revenue);
  d.quarterlyRevenue = quarterlyFlow(companyfacts, SEC_CONCEPTS.revenue);
  d.annualGrossProfit = annualFlow(companyfacts, SEC_CONCEPTS.grossProfit);
  d.annualOperatingIncome = annualFlow(companyfacts, SEC_CONCEPTS.operatingIncome);
  d.quarterlyOperatingIncome = quarterlyFlow(companyfacts, SEC_CONCEPTS.operatingIncome);
  d.annualAssets = annualInstant(companyfacts, SEC_CONCEPTS.assets);
  d.annualCurrentLiabilities = annualInstant(companyfacts, SEC_CONCEPTS.currentLiabilities);
  d.annualSBC = annualFlow(companyfacts, SEC_CONCEPTS.sbc);
  d.annualOCF = annualFlow(companyfacts, SEC_CONCEPTS.ocf);
  const capex = annualFlow(companyfacts, SEC_CONCEPTS.capex);
  d.annualFCF = alignedPairs(d.annualOCF, capex, (ocf, cx) => finite(ocf) && finite(cx))
    .map(pair => ({ date: pair.date, value: pair.left - Math.abs(pair.right) }));
  d.fcfMarginTTM = [];
  d.estimateRevisions = []; // Analystenschaetzungen sind kein XBRL-Konzept.
  return d;
}

function indexedSeries(raw) {
  return (Array.isArray(raw) ? raw : []).map((item, i) => {
    const value = finite(item) ? item : item && item.value;
    return finite(value) ? { date: `index-${String(i).padStart(3, '0')}`, value } : null;
  }).filter(Boolean);
}

function secDataFromAnnualCache(entry) {
  const d = emptyData();
  d.annualRevenue = indexedSeries(entry.annualRev);
  d.annualOperatingIncome = indexedSeries(entry.annualOpInc);
  d.annualAssets = indexedSeries(entry.annualAssets);
  d.annualCurrentLiabilities = indexedSeries(entry.annualCurrentLiabilities);
  d.annualFCF = indexedSeries(entry.annualFCF);
  d.annualOCF = indexedSeries(entry.annualOCF);
  return d;
}

async function fetchSecCompany(company, secAnnualCache) {
  const url = `https://data.sec.gov/api/xbrl/companyfacts/CIK${company.cik}.json`;
  try {
    const payload = await fetchJson(url);
    return { data: secDataFromCompanyFacts(payload), mode: 'live-companyfacts', error: null };
  } catch (error) {
    const networkError = errText(error);
    const localFile = path.join(ROOT, 'external-data', 'sec-xbrl', `${company.cik}.json`);
    const local = readJson(localFile);
    if (local) return { data: secDataFromCompanyFacts(local), mode: 'local-companyfacts-cache', error: networkError };
    if (secAnnualCache[company.ticker]) {
      return { data: secDataFromAnnualCache(secAnnualCache[company.ticker]), mode: 'local-secannual-derived-cache', error: networkError };
    }
    return { data: emptyData(), mode: 'unavailable', error: networkError };
  }
}

function values(rows) { return (Array.isArray(rows) ? rows : []).map(row => row && row.value).filter(finite); }
function positiveValues(rows) { return values(rows).filter(v => v > 0); }

function hasTwoWithPositiveOlder(rows) {
  const present = values(rows);
  return present.length >= 2 && present[1] > 0;
}

function hasRevenueGrowthPath(d) {
  const q = values(d.quarterlyRevenue);
  const quarter = q.length >= 5 && q.slice(0, 5).every(finite) && q[4] > 0;
  return quarter || hasTwoWithPositiveOlder(d.annualRevenue);
}

function alignedPairs(left, right, predicate) {
  const rightByDate = new Map((Array.isArray(right) ? right : []).filter(row => row && row.date).map(row => [row.date, row.value]));
  const out = [];
  for (const row of Array.isArray(left) ? left : []) {
    if (!row || !row.date || !rightByDate.has(row.date)) continue;
    const other = rightByDate.get(row.date);
    if (!predicate || predicate(row.value, other)) out.push({ date: row.date, left: row.value, right: other });
  }
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

function capitalPairs(d) {
  const assets = new Map((d.annualAssets || []).map(row => [row.date, row.value]));
  const current = new Map((d.annualCurrentLiabilities || []).map(row => [row.date, row.value]));
  return (d.annualOperatingIncome || []).filter(row => {
    const a = assets.get(row.date), c = current.get(row.date);
    return finite(row.value) && finite(a) && finite(c) && a - c > 0;
  });
}

function fieldSummary(data) {
  const out = {};
  for (const key of Object.keys(FIELD_DEFS)) {
    const rows = data[key] || [];
    out[key] = { present: rows.length > 0, observations: rows.length };
  }
  return out;
}

function axisSummary(data) {
  return Object.fromEntries(AXES.map(axis => [axis.id, Boolean(axis.available(data))]));
}

function buildCoverage(companies) {
  const coverage = {};
  for (const axis of AXES) {
    const counts = { yahooOnly: 0, xbrlOnly: 0, both: 0, neither: 0 };
    const tickers = { yahooOnly: [], xbrlOnly: [], both: [], neither: [] };
    for (const company of companies) {
      const y = company.axes.yahoo[axis.id];
      const x = company.axes.xbrl[axis.id];
      const bucket = y && x ? 'both' : y ? 'yahooOnly' : x ? 'xbrlOnly' : 'neither';
      counts[bucket]++;
      tickers[bucket].push(company.ticker);
    }
    coverage[axis.id] = {
      label: axis.label,
      yahooOnly: { n: counts.yahooOnly, pct: pct(counts.yahooOnly, companies.length), tickers: tickers.yahooOnly },
      xbrlOnly: { n: counts.xbrlOnly, pct: pct(counts.xbrlOnly, companies.length), tickers: tickers.xbrlOnly },
      both: { n: counts.both, pct: pct(counts.both, companies.length), tickers: tickers.both },
      neither: { n: counts.neither, pct: pct(counts.neither, companies.length), tickers: tickers.neither }
    };
  }
  return coverage;
}

function buildMissingFields(companies) {
  const rows = [];
  for (const provider of ['yahoo', 'xbrl']) {
    for (const [field, def] of Object.entries(FIELD_DEFS)) {
      const tickers = companies.filter(company => !company.fields[provider][field].present).map(company => company.ticker);
      rows.push({ provider, field, label: def.label, missingN: tickers.length, missingPct: pct(tickers.length, companies.length), tickers });
    }
  }
  rows.sort((a, b) => b.missingN - a.missingN || a.provider.localeCompare(b.provider) || a.field.localeCompare(b.field));
  return rows;
}

function reportAxisDefinitions() {
  return AXES.map(axis => ({
    id: axis.id,
    label: axis.label,
    requiredForCoverage: axis.required,
    optionalOrConditional: axis.optional,
    fields: axis.fields.map(field => ({ key: field, ...FIELD_DEFS[field] }))
  }));
}

function cell(bucket, total) { return `${bucket.pct.toFixed(1)} % (${bucket.n}/${total})`; }
function mdEscape(text) { return String(text == null ? '' : text).replace(/\|/g, '\\|').replace(/\r?\n/g, ' '); }
function tickerPreview(tickers) { return tickers.length ? tickers.slice(0, 20).join(', ') + (tickers.length > 20 ? `, ... (+${tickers.length - 20})` : '') : '-'; }

function buildMarkdown(report) {
  const n = report.sample.actual;
  const lines = [
    '# Small-Cap-Daten-Coverage-Probe (2026-07-16)',
    '',
    'Reine Messung: Zahlen, Felddefinitionen und Fehllisten. Der Bericht enthaelt keine GO/NO-GO-Empfehlung und keine Schwellen-Interpretation.',
    '',
    '## Stichproben-Definition',
    '',
    `- Datum: ${report.probeDate}`,
    `- Seed: \`${report.sample.seed}\``,
    `- Ticker-Basis: ${mdEscape(report.sample.basisSource)} (${report.sample.basisN} Eintraege)`,
    `- Auswahlregel: ${mdEscape(report.sample.selectionRule)}`,
    `- Marktkapitalisierungsband: USD ${(report.sample.marketCapMin / 1e6).toFixed(0)}-${(report.sample.marketCapMax / 1e6).toFixed(0)} Mio. (Yahoo trailingMarketCap, inklusive Grenzen)`,
    `- Stichprobe: ${n} Firmen; ${report.sample.scannedN} Kandidaten der Seed-Reihenfolge bis zum Erreichen von N geprueft`,
    `- US-Abgrenzung: ${mdEscape(report.sample.usDefinition)}`,
    `- Drosselung: SEC ${report.network.secDelayMs} ms Mindestabstand; Yahoo ${report.network.yahooDelayMs} ms Mindestabstand`,
    ''
  ];
  if (report.sample.basisFetchError) lines.push(`- Fehler beim Live-Abruf der SEC-Basis: ${mdEscape(report.sample.basisFetchError)}`, '');

  lines.push('## Coverage je Achse', '', '| Achse | Yahoo-only | XBRL-only | beide | keins |', '|---|---:|---:|---:|---:|');
  for (const axis of report.axisDefinitions) {
    const c = report.coverage[axis.id];
    lines.push(`| ${axis.id} | ${cell(c.yahooOnly, n)} | ${cell(c.xbrlOnly, n)} | ${cell(c.both, n)} | ${cell(c.neither, n)} |`);
  }

  lines.push('', '## Felder je Achse', '', '| Achse | Mindestfelder fuer die Coverage-Zaehlung | Zusaetzliche/bedingte Rohfelder | Quellen-Mapping |', '|---|---|---|---|');
  for (const axis of report.axisDefinitions) {
    const mappings = axis.fields.map(field => `${field.key}: Yahoo [${field.yahoo.join(', ')}]; XBRL [${field.xbrl.join(', ')}]`).join('; ');
    lines.push(`| ${axis.id} | ${mdEscape(axis.requiredForCoverage)} | ${mdEscape(axis.optionalOrConditional)} | ${mdEscape(mappings)} |`);
  }

  lines.push('', '## 10 haeufigste fehlende Felder', '', 'Gezählt wird Feldabwesenheit (keine gelieferte Beobachtung) je Quelle und Firma; Abruffehler bleiben zusaetzlich in der Fehlerliste sichtbar.', '', '| Rang | Quelle | Rohfeld | Fehlend | Ticker (max. 20) |', '|---:|---|---|---:|---|');
  report.missingFieldsTop10.forEach((row, index) => {
    lines.push(`| ${index + 1} | ${row.provider} | ${mdEscape(row.label)} (\`${row.field}\`) | ${row.missingPct.toFixed(1)} % (${row.missingN}/${n}) | ${mdEscape(tickerPreview(row.tickers))} |`);
  });

  lines.push('', '## Quellenabrufe und Firmenliste', '', `- Yahoo-Fundamentals-Abruffehler: ${report.errors.yahooFundamentals.length}/${n}`, `- Yahoo-earningsTrend-Zugriff: ${mdEscape(report.network.yahooRevisionCapability.supported ? 'verfuegbar' : `nicht verfuegbar (${report.network.yahooRevisionCapability.error})`)}`, `- SEC-companyfacts live: ${report.secModes['live-companyfacts'] || 0}/${n}`, `- SEC lokaler companyfacts-Cache nach Live-Fehler: ${report.secModes['local-companyfacts-cache'] || 0}/${n}`, `- SEC lokaler secannual-Extrakt nach Live-Fehler: ${report.secModes['local-secannual-derived-cache'] || 0}/${n}`, `- SEC ohne Rohdaten nach Live-Fehler: ${report.secModes.unavailable || 0}/${n}`, '');
  lines.push('| Ticker | MCap USD Mio. | Boerse | Yahoo-Fehler | SEC-Modus | SEC-Live-Fehler |', '|---|---:|---|---|---|---|');
  for (const company of report.companies) {
    lines.push(`| ${company.ticker} | ${(company.marketCap / 1e6).toFixed(1)} | ${mdEscape(company.exchange || '-')} | ${mdEscape(company.errors.yahoo || '-')} | ${company.secMode} | ${mdEscape(company.errors.sec || '-')} |`);
  }

  lines.push('', '## Messannahmen', '');
  report.assumptions.forEach(item => lines.push(`- ${item}`));
  lines.push('');
  return lines.join('\n');
}

async function main() {
  const args = parseArgs(process.argv);
  console.log(`[probe] sample=${args.sample}, seed=${SEED}`);
  const tickerBasis = await loadTickerBasis();
  console.log(`[basis] ${tickerBasis.rows.length} Ticker; ${tickerBasis.source}`);
  const selection = await selectSample(tickerBasis.rows, args.sample);
  const revisionCapability = await probeYahooRevisionCapability(selection.selected[0]);
  const secAnnualCache = readJson(path.join(ROOT, 'external-data', 'sec-secannual.json')) || {};
  const companies = [];

  for (let i = 0; i < selection.selected.length; i++) {
    const selected = selection.selected[i];
    console.log(`[fields] ${i + 1}/${selection.selected.length} ${selected.ticker}`);
    const yahoo = await fetchYahooCompany(selected, revisionCapability);
    const sec = await fetchSecCompany(selected, secAnnualCache);
    companies.push({
      ticker: selected.ticker,
      cik: selected.cik,
      name: selected.name,
      marketCap: selected.marketCap,
      exchange: selected.yahooMeta.exchange,
      secMode: sec.mode,
      fields: { yahoo: fieldSummary(yahoo.data), xbrl: fieldSummary(sec.data) },
      axes: { yahoo: axisSummary(yahoo.data), xbrl: axisSummary(sec.data) },
      errors: { yahoo: yahoo.error, yahooRevisions: yahoo.revisionError, sec: sec.error }
    });
  }

  const coverage = buildCoverage(companies);
  const missingFields = buildMissingFields(companies);
  const secModes = companies.reduce((acc, company) => { acc[company.secMode] = (acc[company.secMode] || 0) + 1; return acc; }, {});
  const report = {
    schemaVersion: 1,
    probeDate: PROBE_DATE,
    generatedAt: new Date().toISOString(),
    measurementOnly: true,
    sample: {
      requested: args.sample,
      actual: companies.length,
      seed: SEED,
      basisUrl: SEC_TICKERS_URL,
      basisSource: tickerBasis.source,
      basisFetchError: tickerBasis.fetchError,
      basisN: tickerBasis.rows.length,
      scannedN: selection.scanned,
      marketCapMin: MIN_MCAP,
      marketCapMax: MAX_MCAP,
      selectionRule: 'SEC-Basis ticker/CIK aufsteigend sortieren; FNV-1a-Rang ueber Seed+Ticker+CIK; nach Rang aufsteigend scannen; Yahoo trailingMarketCap im Band; dann Yahoo chart.meta = USD-EQUITY in America/New_York; erste N Treffer.',
      usDefinition: 'SEC-registrierter Ticker plus bei Yahoo als USD-EQUITY mit Exchange-Zeitzone America/New_York gefuehrt; Sitzland/Domizil wird mangels Feld in company_tickers.json nicht behauptet.'
    },
    network: {
      allowedHosts: ['query*.finance.yahoo.com', '*.sec.gov'],
      secUserAgent: SEC_UA,
      secDelayMs: SEC_DELAY_MS,
      yahooDelayMs: YAHOO_DELAY_MS,
      yahooRevisionCapability: revisionCapability
    },
    axisDefinitions: reportAxisDefinitions(),
    coverage,
    missingFields,
    missingFieldsTop10: missingFields.slice(0, 10),
    secModes,
    errors: {
      selectionYahoo: selection.scanErrors,
      yahooFundamentals: companies.filter(c => c.errors.yahoo).map(c => ({ ticker: c.ticker, error: c.errors.yahoo })),
      secCompanyFacts: companies.filter(c => c.errors.sec).map(c => ({ ticker: c.ticker, mode: c.secMode, error: c.errors.sec }))
    },
    assumptions: [
      'Achsenliste ist exakt die acht in src/scoring/axes.js benannten Funktionen: revGrowthLevel, revAcceleration, gpGrowth, ruleOfX, marginTrajectory, capitalEfficiency, revisionsMomentum, dilution.',
      'Achsen-Coverage folgt der minimalen Nicht-null-Semantik der Funktion in axes.js. Optionale Tilts/Guards werden als Felder ausgewiesen, bestimmen aber nicht die Kern-Coverage.',
      'revGrowthLevel und ruleOfX gelten als lieferbar bei >=5 Quartalsumsaetzen (Lag 4) oder >=2 Jahresumsaetzen mit positivem aelterem Wert.',
      'revAcceleration gilt als lieferbar bei mindestens drei positiven Quartalsumsaetzen; das bildet mindestens zwei positive QoQ-Paare wie quarterQoQRates.',
      'gpGrowth verlangt fuer den Rueckgabewert zwei Jahres-Bruttogewinne und einen positiven aelteren Wert; Jahresumsatz fuer die GM-Trajektorie ist optional und separat gemessen.',
      'ruleOfX verlangt fuer den Rueckgabewert nur den Umsatz-Wachstumspfad. FCF-Marge und annualFCF/annualOCF sind bedingt (Profitable-Track/Sign-Guard) und separat gemessen.',
      'marginTrajectory verlangt zwei nach Periodenende gepaarte Quartale mit Umsatz >0 und operativem Ergebnis.',
      'capitalEfficiency verlangt mindestens ein nach Periodenende gepaartes Jahr aus Operating Income, Assets und Current Liabilities mit positivem investiertem Kapital; Asset-Growth-Penalty und Zyklus-Discount sind optionale Komponenten.',
      'revisionsMomentum nutzt Yahoo earningsTrend.epsRevisions. SEC-XBRL enthaelt keine Analystenrevisionen; XBRL-Coverage dieser Achse ist daher per Quellenvertrag null.',
      'dilution verlangt mindestens ein nach Periodenende gepaartes Jahr aus ShareBasedCompensation und Umsatz ungleich null; ein zweites Jahr fuegt nur den Trend hinzu.',
      'SEC-Umsatz akzeptiert vier uebliche us-gaap-Tags in dokumentierter Prioritaet; gleiche Perioden werden nicht addiert. Q4-Flows werden nur als FY minus passendem 9M-YTD-Fakt abgeleitet.',
      'Yahoo-Fundamentals werden aus dem keylosen Fundamentals-Time-Series-Endpunkt gelesen. Der separate quoteSummary-earningsTrend-Endpunkt wird einmal auf Zugriff faehigkeit geprueft und bei globalem Auth-Fehler fuer den Lauf als nicht verfuegbar markiert.',
      'Wenn der vorgeschriebene kontaktfreie SEC-User-Agent vom SEC-WAF abgewiesen wird, werden vorhandene, von der Repo-SEC-Pipeline erzeugte Rohcaches nur lesend verwendet; Modus und Live-Fehler stehen je Firma im Report. Nicht gecachte Firmen bleiben XBRL-seitig leer.'
    ],
    companies
  };

  if (args.sample === OFFICIAL_SAMPLE) {
    fs.writeFileSync(REPORT_JSON, JSON.stringify(report, null, 2) + '\n');
    fs.writeFileSync(REPORT_MD, buildMarkdown(report));
    console.log(`[report] ${path.relative(ROOT, REPORT_JSON)}`);
    console.log(`[report] ${path.relative(ROOT, REPORT_MD)}`);
  } else {
    console.log(`[report] Mini-Lauf: offizielle N=${OFFICIAL_SAMPLE}-Reports unveraendert`);
  }
  for (const axis of AXES) {
    const c = coverage[axis.id];
    console.log(`[coverage] ${axis.id}: Y=${c.yahooOnly.n} X=${c.xbrlOnly.n} both=${c.both.n} neither=${c.neither.n}`);
  }
  console.log(`[done] ${companies.length}/${args.sample} Firmen gemessen`);
}

main().catch(error => {
  console.error(`[fatal] ${error.stack || error.message || error}`);
  process.exitCode = 1;
});

#!/usr/bin/env node
/**
 * Messlauf 3 (Karl-Entscheid E-20260719-4): Small-Cap-Coverage-Probe mit
 * einer ECHTEN Zufallsstichprobe statt der 4 thematischen Yahoo-Screener-
 * Seiten aus Messlauf 2 (BH-014-Limitation, siehe scripts/probe-smallcap-
 * coverage.js). Behebt den Selection-Bias:
 *
 *   Kandidatenbasis: vollstaendige SEC-EDGAR-Registranten-Liste
 *   (company_tickers.json, ~10-13k Ticker) statt vier "interessante"
 *   Themenlisten.
 *   Ziehung: Rejection-Sampling. Liste deterministisch nach Seed gemischt
 *   (dieselbe fnv1a-Rang-Mechanik wie Messlauf 2), dann der Reihe nach per
 *   Yahoo-Quote geprueft: behalten wenn US-Common-Equity (R1-R6 aus
 *   Messlauf 2, unveraendert) UND Market Cap im selben Band. Weiter bis
 *   100 In-Band-Treffer.
 *   Messung: dieselbe 8-Achsen-Coverage (Yahoo + SEC-XBRL) wie Messlauf 2,
 *   direkt vergleichbar.
 *
 * Reine Mechanik-Ergaenzung -- Filter-Regeln, Achsen-Definitionen und
 * XBRL-Ableitung kommen unveraendert aus scripts/probe-smallcap-coverage.js
 * (module.exports); dieses Skript dupliziert sie nicht.
 *
 * Netzwerk: SEC (company_tickers.json + companyfacts, striktes WAF/429-
 * Handling ueber fetchSecJsonStrict) und Yahoo (quoteSummary + fundamentals-
 * timeseries). SEC_CONTACT muss gesetzt sein -- Beispielwert wie
 * discovery/sec-tickers.js: "Karl Viehrig screener-data karl_viehrig@web.de".
 * Bei Drosselung: reaktiver Backoff (siehe withBackoff), kein harter Abbruch
 * bei der ersten 429. Teilfortschritt wird nach jedem gezogenen Kandidaten
 * in state/smallcap-messlauf3-checkpoint.json geschrieben; ein Neustart mit
 * demselben --sample setzt dort fort statt neu zu ziehen.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { writeFileAtomic } = require('../lib/atomic-write.js');
const M2 = require('./probe-smallcap-coverage.js');

const ROOT = path.resolve(__dirname, '..');
const PROBE_DATE = '2026-07-19';
const REPORT_JSON = path.join(ROOT, 'reports', `smallcap-probe-messlauf3-${PROBE_DATE}.json`);
const REPORT_MD = path.join(ROOT, 'reports', `smallcap-probe-messlauf3-${PROBE_DATE}.md`);
const CHECKPOINT_FILE = path.join(ROOT, 'state', 'smallcap-messlauf3-checkpoint.json');
const M2_JSON_PATH = path.join(ROOT, 'reports', 'smallcap-probe-messlauf2-2026-07-16.json');
const M2_XBRL_JSON_PATH = path.join(ROOT, 'reports', 'smallcap-probe-messlauf2-xbrl-2026-07-16.json');
const OFFICIAL_SAMPLE = 100;
const M3_SEED = 'smallcap-probe-2026-07-19-messlauf3';
const SEC_TICKERS_URL = 'https://www.sec.gov/files/company_tickers.json';
const BACKOFF_DELAYS_MS = [3000, 8000, 20000, 45000]; // reaktive Pacing-Erhoehung bei Drosselung, ohne Hart-Abbruch

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function finite(v) { return Number.isFinite(v); }
function r1(n) { return Number(n.toFixed(1)); }
function pct(n, total) { return total ? r1(100 * n / total) : 0; }
const issuerKeyOf = raw => String((raw && (raw.longName || raw.shortName)) || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function parseArgs(argv) {
  let sample = OFFICIAL_SAMPLE;
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--sample' && argv[i + 1]) sample = Number(argv[++i]);
    else throw new Error(`Unbekanntes Argument: ${argv[i]}`);
  }
  if (!Number.isInteger(sample) || sample < 1 || sample > 500) {
    throw new Error('--sample muss eine ganze Zahl zwischen 1 und 500 sein');
  }
  return { sample };
}

// "Wenn Yahoo drosselt: Pacing erhoehen, durchziehen" (Auftrag Schritt 6) --
// M2.fetchYahooSummaryM2/fetchYahooAxesM2/fetchSecJsonStrict werfen nur bei
// Rate-Limit/Auth/WAF-Block; ein Retry mit wachsendem Delay auf demselben
// Kandidaten ersetzt den harten Abbruch, den Messlauf 2 dort hatte.
async function withBackoff(label, fn) {
  let lastErr;
  for (let attempt = 0; attempt <= BACKOFF_DELAYS_MS.length; attempt++) {
    try { return await fn(); }
    catch (error) {
      lastErr = error;
      if (attempt === BACKOFF_DELAYS_MS.length) break;
      const wait = BACKOFF_DELAYS_MS[attempt];
      console.warn(`[backoff] ${label}: ${M2.errText(error)}; warte ${wait}ms (Versuch ${attempt + 1}/${BACKOFF_DELAYS_MS.length})`);
      await sleep(wait);
    }
  }
  throw lastErr;
}

function buildRunHash(payload) {
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 16);
}

function readJsonRequired(file, label) {
  if (!fs.existsSync(file)) throw new Error(`${label} fehlt: ${path.relative(ROOT, file)}`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// 95%-Wilson-Score-Intervall (nicht die einfache Normalapproximation -- bei
// n=100 und Anteilen nahe 0/100% ist die Normalapproximation unzuverlaessig).
function wilsonCI(successes, total) {
  if (!total) return { low: 0, high: 0 };
  const z = 1.959963984540054;
  const p = successes / total;
  const denom = 1 + (z * z) / total;
  const center = (p + (z * z) / (2 * total)) / denom;
  const margin = (z * Math.sqrt((p * (1 - p)) / total + (z * z) / (4 * total * total))) / denom;
  return { low: Math.max(0, center - margin) * 100, high: Math.min(100, (center + margin) * 100) };
}

function loadCheckpoint(seed, sample) {
  if (!fs.existsSync(CHECKPOINT_FILE)) return null;
  let raw;
  try { raw = JSON.parse(fs.readFileSync(CHECKPOINT_FILE, 'utf8')); }
  catch (error) { console.warn(`[checkpoint] unlesbar, ignoriert: ${M2.errText(error)}`); return null; }
  if (!raw || raw.seed !== seed || raw.sample !== sample) return null;
  return raw;
}

function saveCheckpoint(state) {
  writeFileAtomic(CHECKPOINT_FILE, JSON.stringify(state) + '\n');
}

async function loadCandidatePool(secContact, retrieval) {
  const tickerResult = await withBackoff('company_tickers.json', () =>
    M2.fetchSecJsonStrict(SEC_TICKERS_URL, secContact, retrieval, 'companyTickers'));
  if (!tickerResult.ok) {
    throw new Error(`SEC company_tickers.json nicht abrufbar (${tickerResult.error.type}): ${tickerResult.error.message}`);
  }
  const tickerMap = M2.buildTickerCikMap(tickerResult.data);
  const pool = [...tickerMap.entries()].map(([ticker, info]) => ({
    ticker,
    yahooSymbol: ticker,
    cik: info.cik,
    secName: info.secName,
    seedRank: M2.fnv1a(`${M3_SEED}:${ticker}`)
  }));
  pool.sort((a, b) => a.seedRank - b.seedRank || a.ticker.localeCompare(b.ticker));
  return pool;
}

function m3FilterDefinitions() {
  const defs = M2.m2FilterDefinitions();
  defs.push({
    id: 'MCAP',
    definition: `Marktkapitalisierungs-Band (hart, identisch zu Messlauf 2): behalten nur wenn Yahoo price.marketCap zwischen USD ${(M2.MIN_MCAP / 1e6).toFixed(0)} Mio. und USD ${(M2.MAX_MCAP / 1e6).toFixed(0)} Mio. liegt (inklusive Grenzen). In Messlauf 2 war das ein Vorfilter der Kandidatenbasis; hier ist es eine explizite Regel, weil die Kandidatenbasis (volles SEC-Universum) keine Marktkapitalisierung voraussetzt.`,
    missing: 'fail-closed'
  });
  return defs;
}

async function fetchXbrlForCandidate(candidate, secContact, retrieval) {
  if (!candidate.cik) return { data: null, status: 'no-cik', error: null };
  const url = `https://data.sec.gov/api/xbrl/companyfacts/CIK${candidate.cik}.json`;
  const result = await withBackoff(`companyfacts ${candidate.ticker}`, () =>
    M2.fetchSecJsonStrict(url, secContact, retrieval, 'companyFacts'));
  if (!result.ok) return { data: null, status: 'error', error: result.error };
  return { data: M2.secDataFromCompanyFacts(result.data), status: 'ok', error: null };
}

async function runDraw(pool, args, secContact, retrieval) {
  const checkpoint = loadCheckpoint(M3_SEED, args.sample);
  const companies = checkpoint ? checkpoint.companies : [];
  const exclusions = checkpoint ? checkpoint.exclusions : [];
  const r6BoundaryLog = checkpoint ? checkpoint.r6BoundaryLog : [];
  const excludedByRule = checkpoint ? checkpoint.excludedByRule :
    Object.fromEntries(['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'MCAP', 'DUP'].map(rule => [rule, 0]));
  const processedTickers = new Set(checkpoint ? checkpoint.processedTickers : []);
  const issuerKeys = new Set(checkpoint ? checkpoint.issuerKeys : []);
  let drawnTotal = checkpoint ? checkpoint.drawnTotal : 0;

  if (checkpoint) {
    console.log(`[resume] Checkpoint gefunden: gezogen=${drawnTotal}, final=${companies.length}/${args.sample}`);
  }

  for (const candidate of pool) {
    if (companies.length >= args.sample) break;
    if (processedTickers.has(candidate.ticker)) continue;

    drawnTotal++;
    processedTickers.add(candidate.ticker);

    const summaryResult = await withBackoff(`quoteSummary ${candidate.ticker}`, () => M2.fetchYahooSummaryM2(candidate));
    const filter = M2.filterOperatingCompanyM2(candidate, summaryResult);

    if (!filter.accepted) {
      excludedByRule[filter.rule]++;
      exclusions.push({
        ticker: candidate.ticker, name: filter.raw.longName || filter.raw.shortName || candidate.ticker,
        rule: filter.rule, reason: filter.reason, raw: filter.raw
      });
    } else {
      const marketCap = M2.unwrapYahooNumber(summaryResult.data && summaryResult.data.price && summaryResult.data.price.marketCap);
      const inBand = finite(marketCap) && marketCap >= M2.MIN_MCAP && marketCap <= M2.MAX_MCAP;
      if (!inBand) {
        excludedByRule.MCAP++;
        exclusions.push({
          ticker: candidate.ticker, name: filter.raw.longName || filter.raw.shortName || candidate.ticker,
          rule: 'MCAP', reason: `marketCap=${marketCap == null ? 'FEHLT' : marketCap} (Band ${M2.MIN_MCAP}-${M2.MAX_MCAP})`, raw: filter.raw
        });
      } else {
        const issuerKey = issuerKeyOf(filter.raw) || candidate.ticker.toLowerCase();
        if (issuerKeys.has(issuerKey)) {
          excludedByRule.DUP++;
          exclusions.push({
            ticker: candidate.ticker, name: filter.raw.longName || filter.raw.shortName || candidate.ticker,
            rule: 'DUP', reason: 'Emittenten-Dublette: derselbe Firmenname ist bereits in der Stichprobe (Share-Klasse)', raw: filter.raw
          });
        } else {
          issuerKeys.add(issuerKey);
          if (filter.r6Boundary) r6BoundaryLog.push(filter.r6Boundary);
          const yahoo = await withBackoff(`fundamentals ${candidate.ticker}`, () => M2.fetchYahooAxesM2(candidate, summaryResult.data));
          const xbrl = await fetchXbrlForCandidate(candidate, secContact, retrieval);
          const xbrlAxes = M2.axisSummary(xbrl.data || {});
          companies.push({
            ticker: candidate.ticker,
            name: filter.raw.longName || filter.raw.shortName || candidate.ticker,
            cik: candidate.cik,
            marketCap,
            filterRaw: filter.raw,
            fields: { yahoo: M2.fieldSummary(yahoo.data), xbrl: M2.fieldSummary(xbrl.data || {}) },
            axes: { yahoo: M2.axisSummary(yahoo.data), xbrl: xbrlAxes },
            revisionRows: yahoo.revisionsN,
            errors: {
              yahooSummarySchema: summaryResult.schemaSalvaged ? summaryResult.error : null,
              yahooFundamentals: yahoo.fundamentalsError,
              xbrl: xbrl.status === 'error' ? xbrl.error : (xbrl.status === 'no-cik' ? 'kein CIK in company_tickers.json' : null)
            }
          });
        }
      }
    }

    if (drawnTotal % 10 === 0 || companies.length === args.sample) {
      console.log(`[draw] gezogen=${drawnTotal} final=${companies.length}/${args.sample} R1=${excludedByRule.R1} R3=${excludedByRule.R3} R5=${excludedByRule.R5} MCAP=${excludedByRule.MCAP} DUP=${excludedByRule.DUP}`);
    }
    saveCheckpoint({
      seed: M3_SEED, sample: args.sample, companies, exclusions, r6BoundaryLog,
      excludedByRule, processedTickers: [...processedTickers], issuerKeys: [...issuerKeys], drawnTotal
    });
  }

  if (companies.length < args.sample) {
    throw new Error(`Kandidatenbasis erschoepft: nur ${companies.length}/${args.sample} Operating Companies nach ${drawnTotal} Ziehungen aus ${pool.length} SEC-Tickern; Ausschluesse=${exclusions.length}`);
  }
  return { companies, exclusions, r6BoundaryLog, excludedByRule, drawnTotal };
}

function coverageWithComparison(companies, sourceKey, m2Rows) {
  return M2.AXES.map(axis => {
    const total = companies.length;
    const n = companies.filter(c => c.axes[sourceKey][axis.id]).length;
    const pctVal = pct(n, total);
    const ci = wilsonCI(n, total);
    const m2Row = m2Rows.find(row => row.id === axis.id);
    const m2Ci = m2Row ? wilsonCI(m2Row.n, m2Row.total) : null;
    const ciOverlap95 = m2Ci ? !(ci.high < m2Ci.low || m2Ci.high < ci.low) : null;
    return {
      id: axis.id, label: axis.label, n, total, pct: pctVal,
      wilsonLowPct: r1(ci.low), wilsonHighPct: r1(ci.high),
      messlauf2N: m2Row ? m2Row.n : null, messlauf2Total: m2Row ? m2Row.total : null, messlauf2Pct: m2Row ? m2Row.pct : null,
      messlauf2WilsonLowPct: m2Ci ? r1(m2Ci.low) : null, messlauf2WilsonHighPct: m2Ci ? r1(m2Ci.high) : null,
      deltaPercentagePoints: m2Row ? r1(pctVal - m2Row.pct) : null,
      ciOverlap95
    };
  });
}

function combinedCoverage(companies, m2CombinedByAxis) {
  return M2.AXES.map(axis => {
    const total = companies.length;
    const n = companies.filter(c => c.axes.yahoo[axis.id] || c.axes.xbrl[axis.id]).length;
    const pctVal = pct(n, total);
    const ci = wilsonCI(n, total);
    const m2 = m2CombinedByAxis[axis.id];
    const m2Ci = m2 ? wilsonCI(m2.n, m2.total) : null;
    const ciOverlap95 = m2Ci ? !(ci.high < m2Ci.low || m2Ci.high < ci.low) : null;
    return {
      id: axis.id, label: axis.label, n, total, pct: pctVal,
      wilsonLowPct: r1(ci.low), wilsonHighPct: r1(ci.high),
      messlauf2N: m2 ? m2.n : null, messlauf2Total: m2 ? m2.total : null, messlauf2Pct: m2 ? pct(m2.n, m2.total) : null,
      deltaPercentagePoints: m2 ? r1(pctVal - pct(m2.n, m2.total)) : null,
      ciOverlap95
    };
  });
}

function buildGoAssessment(combined) {
  const rows = combined.map(row => ({
    id: row.id, label: row.label, messlauf3Pct: row.pct, messlauf2Pct: row.messlauf2Pct,
    ciOverlap95: row.ciOverlap95, significantDrop: row.ciOverlap95 === false && row.deltaPercentagePoints < 0
  }));
  const significantDrops = rows.filter(r => r.significantDrop);
  const verdict = significantDrops.length === 0
    ? 'HAELT: keine Achse zeigt unter der unverzerrten Ziehung einen statistisch signifikanten (95%-CI, nicht ueberlappend) Rueckgang der kombinierten Yahoo+XBRL-Coverage gegenueber Messlauf 2.'
    : `PRUEFEN: ${significantDrops.length}/${rows.length} Achse(n) zeigen unter der unverzerrten Ziehung einen statistisch signifikanten Coverage-Rueckgang gegenueber Messlauf 2 (95%-CI ueberlappt nicht): ${significantDrops.map(r => r.id).join(', ')}.`;
  return {
    floorUsd: M2.MIN_MCAP,
    method: 'Kombinierte Coverage (Yahoo ODER SEC-XBRL deckt die Achse) je Achse, verglichen per nicht-ueberlappendem 95%-Wilson-Intervall gegen Messlauf 2. Dies ist eine Mess-Aussage, keine Geschaeftsentscheidung -- die GO/NO-GO-Entscheidung selbst bleibt bei Karl.',
    rows, verdict
  };
}

function mdEscape(text) { return M2.mdEscape(text); }

function buildMarkdown(report) {
  const n = report.sample.actual;
  const b = report.drawBalance;
  const lines = [
    `# Small-Cap-Coverage-Probe - Messlauf 3 (${report.probeDate})`,
    '',
    `Run-Hash: \`${report.runHash}\` (Fingerabdruck ueber Seed, Filter und gezogene Ticker; identisch in JSON und MD).`,
    '',
    '> **Methodik-Korrektur zu BH-014:** Messlauf 2 zog seine Kandidaten aus 4 thematischen Yahoo-Screener-Seiten (kein Wahrscheinlichkeits-Sample). Messlauf 3 zieht per Rejection-Sampling aus der vollstaendigen SEC-EDGAR-Registranten-Liste (company_tickers.json) -- ein echtes Wahrscheinlichkeits-Sample der US-Operating-Company-Population, gefiltert auf dasselbe $300-800M-Marktkapitalisierungs-Band und dieselben R1-R6-Qualitaetsregeln wie Messlauf 2.',
    '',
    'Reine Messung mit Zahlen, Ausschlussgruenden und Rohfeldern. Der Bericht enthaelt keine Schlussfolgerung ausser der expliziten GO-Aussage in Abschnitt "GO/NO-GO-Basis".',
    '',
    '## Methodik',
    '',
    `- Kandidatenbasis: SEC \`company_tickers.json\` (vollstaendige EDGAR-Registranten mit Ticker), ${report.sample.candidatePoolSize} eindeutige Ticker.`,
    `- Ziehung: deterministische Mischung per \`fnv1a(seed:ticker)\`-Rang (dieselbe Mechanik wie Messlauf 2s Seed-Rang), danach Rejection-Sampling einzeln gegen R1-R6 + Marktkapitalisierungs-Band + Emittenten-Dedupe bis ${n} Treffer stehen.`,
    `- Seed: \`${report.sample.seed}\`.`,
    `- Marktkapitalisierungs-Band: identisch zu Messlauf 2, USD ${(M2.MIN_MCAP / 1e6).toFixed(0)}-${(M2.MAX_MCAP / 1e6).toFixed(0)} Mio.`,
    '- Coverage-Messung (Yahoo-Felder + SEC-XBRL-Ableitungen) verwendet unveraendert dieselben Achsen-Definitionen und dieselbe XBRL-Ableitungslogik wie Messlauf 2 (`scripts/probe-smallcap-coverage.js`, per `module.exports` wiederverwendet).',
    `- Yahoo-Drosselung: mindestens ${M2.YAHOO_DELAY_MS} ms zwischen Requests; SEC-Drosselung: mindestens ${M2.SEC_DELAY_MS} ms. Bei Rate-Limit/WAF-Block reaktiver Backoff (${BACKOFF_DELAYS_MS.join('/')} ms) statt Hart-Abbruch.`,
    '- Der SEC-User-Agent kam zur Laufzeit aus `process.env.SEC_CONTACT`; sein Wert wurde nicht protokolliert.',
    '',
    '## Filter-Definition R1-R6 + MCAP + DUP', '', '| Regel | Definition | Fehlende Felder |', '|---|---|---|'
  ];
  report.filters.forEach(f => lines.push(`| ${f.id} | ${mdEscape(f.definition)} | ${f.missing} |`));
  lines.push('', 'Erster Treffer entscheidet (Reihenfolge R1-R6, dann MCAP, dann DUP).', '');

  lines.push('## Ziehungs-Bilanz', '', '| Kennzahl | Anzahl |', '|---|---:|',
    `| Ticker im Kandidatenpool | ${report.sample.candidatePoolSize} |`,
    `| Gezogen gesamt | ${b.drawnTotal} |`,
    `| Ausgeschlossen R1 (quoteType) | ${b.excludedByRule.R1} |`,
    `| Ausgeschlossen R2 (Ticker-Struktur) | ${b.excludedByRule.R2} |`,
    `| Ausgeschlossen R3 (Sektor/Industry) | ${b.excludedByRule.R3} |`,
    `| Ausgeschlossen R4 (SPAC-Name) | ${b.excludedByRule.R4} |`,
    `| Ausgeschlossen R5 (Struktur-Gate) | ${b.excludedByRule.R5} |`,
    `| Ausgeschlossen R6 (weicher Namensmatch) | ${b.excludedByRule.R6} |`,
    `| Ausgeschlossen MCAP (ausserhalb Band) | ${b.excludedByRule.MCAP} |`,
    `| Ausgeschlossen DUP (Emittenten-Dublette) | ${b.excludedByRule.DUP} |`,
    `| Finale Stichprobe | ${n} |`,
    '');

  lines.push('## Coverage je Achse -- Yahoo', '',
    'Nenner ist die gefilterte finale Stichprobe (n=' + n + '). CI = 95%-Wilson-Intervall. ciOverlap95=nein heisst: die beiden 95%-Intervalle ueberlappen nicht -> statistisch nachweisbarer Unterschied bei n=100 je Lauf.', '',
    '| Achse | Messlauf 3 | 95%-CI | Messlauf 2 | 95%-CI | Delta pp | CI ueberlappt |', '|---|---:|---:|---:|---:|---:|---:|');
  report.coverageYahoo.forEach(r => lines.push(`| ${r.id} | ${r.pct.toFixed(1)}% (${r.n}/${r.total}) | [${r.wilsonLowPct.toFixed(1)}, ${r.wilsonHighPct.toFixed(1)}] | ${r.messlauf2Pct.toFixed(1)}% (${r.messlauf2N}/${r.messlauf2Total}) | [${r.messlauf2WilsonLowPct.toFixed(1)}, ${r.messlauf2WilsonHighPct.toFixed(1)}] | ${r.deltaPercentagePoints >= 0 ? '+' : ''}${r.deltaPercentagePoints.toFixed(1)} | ${r.ciOverlap95 ? 'ja' : 'nein'} |`));

  lines.push('', '## Coverage je Achse -- SEC-XBRL', '',
    '| Achse | Messlauf 3 | 95%-CI | Messlauf 2 | 95%-CI | Delta pp | CI ueberlappt |', '|---|---:|---:|---:|---:|---:|---:|');
  report.coverageXbrl.forEach(r => lines.push(`| ${r.id} | ${r.pct.toFixed(1)}% (${r.n}/${r.total}) | [${r.wilsonLowPct.toFixed(1)}, ${r.wilsonHighPct.toFixed(1)}] | ${r.messlauf2Pct.toFixed(1)}% (${r.messlauf2N}/${r.messlauf2Total}) | [${r.messlauf2WilsonLowPct.toFixed(1)}, ${r.messlauf2WilsonHighPct.toFixed(1)}] | ${r.deltaPercentagePoints >= 0 ? '+' : ''}${r.deltaPercentagePoints.toFixed(1)} | ${r.ciOverlap95 ? 'ja' : 'nein'} |`));

  lines.push('', '## Coverage je Achse -- kombiniert (Yahoo ODER XBRL)', '',
    '| Achse | Messlauf 3 | 95%-CI | Messlauf 2 (kombiniert) | Delta pp | CI ueberlappt |', '|---|---:|---:|---:|---:|---:|');
  report.coverageCombined.forEach(r => lines.push(`| ${r.id} | ${r.pct.toFixed(1)}% (${r.n}/${r.total}) | [${r.wilsonLowPct.toFixed(1)}, ${r.wilsonHighPct.toFixed(1)}] | ${r.messlauf2Pct.toFixed(1)}% (${r.messlauf2N}/${r.messlauf2Total}) | ${r.deltaPercentagePoints >= 0 ? '+' : ''}${r.deltaPercentagePoints.toFixed(1)} | ${r.ciOverlap95 ? 'ja' : 'nein'} |`));

  lines.push('', '## GO/NO-GO-Basis fuer das $300M-Floor-GO vom 17.07.', '',
    `USD-Floor: ${(report.goAssessment.floorUsd / 1e6).toFixed(0)} Mio.`, '',
    report.goAssessment.method, '', `**${report.goAssessment.verdict}**`, '');

  lines.push('## Ausschluss-Tabelle (Auszug, alle Datensaetze im JSON)', '',
    '| Ticker | Regel-ID | Grund |', '|---|---|---|');
  const excerpt = report.exclusions.slice(0, 60);
  if (!excerpt.length) lines.push('| - | - | Keine Ausschluesse |');
  else excerpt.forEach(row => lines.push(`| ${mdEscape(row.ticker)} | ${row.rule} | ${mdEscape(row.reason)} |`));
  if (report.exclusions.length > excerpt.length) lines.push(`| ... | ... | +${report.exclusions.length - excerpt.length} weitere, siehe JSON |`);

  lines.push('', '## Finale Firmenliste', '',
    '| Ticker | Name | MCap USD Mio. | CIK | Yahoo-Achsen | XBRL-Achsen |', '|---|---|---:|---|---:|---:|');
  report.companies.forEach(c => {
    const yN = M2.AXES.filter(a => c.axes.yahoo[a.id]).length;
    const xN = M2.AXES.filter(a => c.axes.xbrl[a.id]).length;
    lines.push(`| ${c.ticker} | ${mdEscape(c.name)} | ${(c.marketCap / 1e6).toFixed(1)} | ${c.cik || '-'} | ${yN}/8 | ${xN}/8 |`);
  });
  lines.push('');
  return lines.join('\n');
}

async function main() {
  const args = parseArgs(process.argv);
  const secContact = String(process.env.SEC_CONTACT || '').trim();
  if (!secContact) {
    throw new Error('SEC_CONTACT fehlt (z.B. "Karl Viehrig screener-data karl_viehrig@web.de", siehe discovery/sec-tickers.js) -- Messlauf 3 braucht SEC fuer Kandidatenbasis + XBRL.');
  }
  if (/\r|\n/.test(secContact)) throw new Error('SEC_CONTACT enthaelt einen unzulaessigen Zeilenumbruch.');

  console.log(`[m3] sample=${args.sample}, seed=${M3_SEED}`);
  const retrieval = { requestsTotal: 0, requestsByKind: {}, errorsByType: {} };
  const pool = await loadCandidatePool(secContact, retrieval);
  console.log(`[m3] Kandidatenpool: ${pool.length} eindeutige SEC-Ticker`);

  const draw = await runDraw(pool, args, secContact, retrieval);

  const m2Report = readJsonRequired(M2_JSON_PATH, 'Messlauf-2-Report');
  const m2XbrlReport = readJsonRequired(M2_XBRL_JSON_PATH, 'Messlauf-2-XBRL-Report');
  const m2CombinedByAxis = Object.fromEntries(m2XbrlReport.comparison.map(row => [row.id, { n: row.yahoo.total - row.neither.n, total: row.yahoo.total }]));

  const coverageYahoo = coverageWithComparison(draw.companies, 'yahoo', m2Report.coverageYahoo);
  const coverageXbrl = coverageWithComparison(draw.companies, 'xbrl', m2XbrlReport.coverageXbrl);
  const coverageCombined = combinedCoverage(draw.companies, m2CombinedByAxis);
  const goAssessment = buildGoAssessment(coverageCombined);

  const runHash = buildRunHash({
    seed: M3_SEED, marketCapMin: M2.MIN_MCAP, marketCapMax: M2.MAX_MCAP,
    filters: m3FilterDefinitions(), tickers: draw.companies.map(c => c.ticker)
  });

  const report = {
    schemaVersion: 1,
    measurementRun: 3,
    runHash,
    probeDate: PROBE_DATE,
    generatedAt: new Date().toISOString(),
    measurementOnly: true,
    karlDecision: 'E-20260719-4',
    sample: {
      requested: args.sample,
      actual: draw.companies.length,
      seed: M3_SEED,
      marketCapMin: M2.MIN_MCAP,
      marketCapMax: M2.MAX_MCAP,
      candidateBasis: 'SEC company_tickers.json (vollstaendige EDGAR-Registranten mit Ticker), echtes Wahrscheinlichkeits-Sample statt 4 Yahoo-Themenlisten (behebt BH-014)',
      candidatePoolSize: pool.length,
      drawMethod: 'Rejection-Sampling: Kandidatenpool deterministisch per fnv1a-Seed-Rang gemischt, dann einzeln gegen R1-R6 + MCAP-Band + Emittenten-Dedupe geprueft, bis N stabil ist.'
    },
    network: {
      allowedHosts: ['query*.finance.yahoo.com', '*.sec.gov'],
      yahooDelayMs: M2.YAHOO_DELAY_MS,
      secDelayMs: M2.SEC_DELAY_MS,
      backoffDelaysMs: BACKOFF_DELAYS_MS,
      secUserAgentSource: 'process.env.SEC_CONTACT',
      secUserAgentValueRecorded: false
    },
    filters: m3FilterDefinitions(),
    drawBalance: {
      drawnTotal: draw.drawnTotal,
      excludedByRule: draw.excludedByRule,
      redrawn: draw.drawnTotal - draw.companies.length,
      finalN: draw.companies.length
    },
    coverageYahoo,
    coverageXbrl,
    coverageCombined,
    goAssessment,
    comparisonSource: {
      messlauf2Json: path.relative(ROOT, M2_JSON_PATH).replace(/\\/g, '/'),
      messlauf2XbrlJson: path.relative(ROOT, M2_XBRL_JSON_PATH).replace(/\\/g, '/'),
      messlauf2RunHash: m2Report.runHash || null,
      messlauf2XbrlRunHash: m2XbrlReport.runHash || null
    },
    retrieval,
    exclusions: draw.exclusions,
    r6BoundaryLog: draw.r6BoundaryLog,
    companies: draw.companies
  };

  if (args.sample === OFFICIAL_SAMPLE) {
    writeFileAtomic(REPORT_JSON, JSON.stringify(report, null, 2) + '\n');
    writeFileAtomic(REPORT_MD, buildMarkdown(report) + '\n');
    console.log(`[report] ${path.relative(ROOT, REPORT_JSON)}`);
    console.log(`[report] ${path.relative(ROOT, REPORT_MD)}`);
    if (fs.existsSync(CHECKPOINT_FILE)) fs.unlinkSync(CHECKPOINT_FILE);
  } else {
    console.log(`[report] Mini-Lauf (--sample ${args.sample}): offizieller Messlauf-3-Report unveraendert`);
  }
  coverageCombined.forEach(row => console.log(`[coverage-combined] ${row.id}: ${row.n}/${row.total} (${row.pct.toFixed(1)}%) vs M2 ${row.messlauf2Pct.toFixed(1)}%`));
  console.log(`[go] ${goAssessment.verdict}`);
  console.log(`[done] ${draw.companies.length}/${args.sample} gezogene Operating Companies gemessen.`);
}

if (require.main === module) {
  main().catch(error => {
    console.error(`[fatal] ${error.stack || error.message || error}`);
    process.exitCode = 1;
  });
}

module.exports = {
  wilsonCI,
  coverageWithComparison,
  combinedCoverage,
  buildGoAssessment,
  m3FilterDefinitions,
  issuerKeyOf,
  buildRunHash
};

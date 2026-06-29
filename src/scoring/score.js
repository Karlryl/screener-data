'use strict';
/**
 * Hypergrowth Engine — Orchestrator
 * =================================
 * Verdrahtet die Schichten zu einem per-Aktie-Ergebnis. Weil q() COHORT-relativ
 * perzentil-normiert, arbeitet das Scoring ueber ein UNIVERSUM (nicht je Einzel-
 * aktie): erst alle Roh-Achsenwerte je Branchen+Track-Kohorte sammeln, dann
 * innerhalb der Kohorte perzentil-normieren, dann gewichtet (renorm-on-drop)
 * summieren. Lampen + Overview kommen getrennt obendrauf.
 *
 * scoreUniverse(snapshots, formulas) -> Array<Ergebnis je Aktie>:
 *   { ticker, action, formulaId, track, score|null, lamps[], overview, reason? }
 */

const { norm, metricVal } = require('./snapshot.js');
const { q, weightedScore, signTrack, fcfTrack } = require('./engine.js');
const { route, isUS } = require('./router.js');
const { evaluateLamps } = require('./lamps.js');
const { overviewMetric } = require('./overview.js');
const { normalizeCountry } = require('./country.js');
const axesFns = require('./axes.js');

const tickerOf = (s) => (s && s.meta && s.meta.ticker) || (s && s.identifier && s.identifier.value) || '?';

// audit/fix (Court Fall 7, F37): locale-/ICU-unabhaengiger Ticker-Tie-Break. localeCompare haengt
// von der OS-Locale ab (CI-ubuntu != lokal-Windows/de-DE) -> untergraebt den dokumentierten
// CI==lokal-Determinismus. Code-Unit-Vergleich (< / >) ist deterministisch und plattform-stabil.
const cmpTicker = (x, y) => (x < y ? -1 : x > y ? 1 : 0);

// A4 (Weltweit-Pivot): DISQUALIFIZIERENDE Daten-Qualitaets-Signale. Ein Name mit einer
// data-suspect-Lampe (newestQtrSuspect/annualCurrencyLeak — erfundenes/geleaktes Quartal bzw.
// annual-currency-Leak) ODER snapshot _quality.grade='D' wird aus dem Ranking EXCLUDIERT, sonst
// koennte ein Auslandsname auf fabriziertem Wachstum #1 werden. Die uebrigen 10 Lampen sind reine
// Timing-Warnungen und excludieren NICHT (BE/PLTR ranken trotz Lampe oben).
const DATA_SUSPECT_LAMPS = ['newestQtrSuspect', 'annualCurrencyLeak'];
function isDataSuspect(s, lampsActive) {
  if (lampsActive.some((l) => DATA_SUSPECT_LAMPS.includes(l))) return true;
  return !!(s && s._quality && s._quality.grade === 'D');
}

// Roh-Achsenwert (ruleOfX braucht alpha + includeFcf am ECHTEN FCF-Vorzeichen).
function rawAxisValue(s, key, formula, track) {
  if (key === 'ruleOfX') {
    // includeFcf am tatsaechlichen FCF-Vorzeichen koppeln, NICHT am erzwungenen
    // 'profitable'-Label der none-Branchen (sonst FCF-Penalty fuer cash-negative
    // Namen im einen Track -> Iron-Rule 2).
    const includeFcf = fcfTrack(metricVal(s, 'fcfMarginTTM'), norm(s, 'annualFCF'), norm(s, 'annualOCF')) === 'profitable';
    return axesFns.ruleOfX(s, formula.alpha, includeFcf);
  }
  const fn = axesFns[key];
  return typeof fn === 'function' ? fn(s) : null;
}

// Track-Zuordnung gemaess splitMetric der Branchen-Formel.
function trackOf(s, formula) {
  let t;
  switch (formula.splitMetric) {
    case 'FCF':
      t = fcfTrack(metricVal(s, 'fcfMarginTTM'), norm(s, 'annualFCF'), norm(s, 'annualOCF'));
      break;
    case 'OpInc':
      t = signTrack(norm(s, 'annualOpInc'));
      // audit/fix (Court Fall 3, F5+F27): leeres annualOpInc -> signTrack='unknown' -> NICHT
      // blind zum konservativen profitable-Default unten; erst auf das NetIncome-Vorzeichen
      // zurueckfallen (architektonisch analog zur fcfTrack OCF-Rescue, engine.js:113-114).
      // WOLF: annualOpInc=[] aber annualNetIncome=[-1.6B,-864M,-330M,-201M] -> unprofitable
      // (zuvor faelschlich profitable-Track + falsche Kohorte/Gewichte). Greift NUR im
      // bisher blinden unknown-Fall -> kein Anker betroffen (keiner hat leeres annualOpInc).
      if (t === 'unknown') t = signTrack(norm(s, 'annualNetIncome'));
      break;
    case 'NetIncome': t = signTrack(norm(s, 'annualNetIncome')); break;
    case 'none': default: t = 'profitable'; // Einzel-Formel-Branchen ohne Split
  }
  return t === 'unknown' ? 'profitable' : t; // konservativer Fallback
}

function scoreUniverse(snapshots, formulas) {
  const results = [];
  // 1. Routing + Track
  for (const s of (Array.isArray(snapshots) ? snapshots : [])) {
    const r = route(s);
    const lampsActive = evaluateLamps(s).active;
    const base = { ticker: tickerOf(s), snapshot: s, lamps: lampsActive };
    // A4: Daten-Qualitaets-Gate VOR dem Scoring — data-suspect-Namen aus dem Ranking nehmen.
    if ((r.action === 'route' || r.action === 'survival') && isDataSuspect(s, lampsActive)) {
      results.push({ ...base, action: 'exclude', formulaId: null, track: null, score: null, reason: 'data-suspect' });
      continue;
    }
    if (r.action !== 'route') {
      results.push({ ...base, action: r.action, formulaId: null, track: null, score: null, reason: r.reason || r.track });
      continue;
    }
    const formula = formulas[r.formulaId];
    if (!formula) {
      results.push({ ...base, action: 'unrouted', formulaId: r.formulaId, track: null, score: null });
      continue;
    }
    results.push({
      ...base, action: 'route', formulaId: r.formulaId, gpClass: r.gpClass,
      track: trackOf(s, formula), formula, score: null,
    });
  }

  // 1b. Issuer-Dedup (Weltweit-Pivot A3-Stufe-2): derselbe Emittent kann mehrfach gelistet sein —
  // US-ADR (Stufe-1, USD/SEC) + Heimatboerse (Stufe-2), z.B. ASML+ASML.AS, TSM+2330.TW, SHOP+SHOP.TO,
  // BABA+9988.HK. Beide Beine wuerden dieselbe Firma DOPPELT in Topf/Kohorte/Sektor-Tab zeigen und
  // die Perzentile verzerren. Pro Emittent (normalisierter meta.name) genau EIN Bein behalten:
  // bevorzugt das US-primaere (USD/SEC-Qualitaet, isUS), sonst hoechste marketCap, dann Ticker-Tie-
  // Break (deterministisch). Verlierer -> exclude 'dup-issuer'. Laeuft NACH dem A4-data-suspect-Gate,
  // sodass ein bereits gegatetes Bein nicht "gewinnt"; greift nur auf Output-sichtbare route/survival.
  const issuerKey = (s) => {
    const n = s && s.meta && s.meta.name;
    return (typeof n === 'string' && n.trim()) ? n.toLowerCase().replace(/\s+/g, ' ').trim() : null;
  };
  const mcapOf = (s) => (s && s.marketCap && Number.isFinite(s.marketCap.value)) ? s.marketCap.value : 0;
  const issuerGroups = {};
  for (const e of results) {
    if (e.action !== 'route' && e.action !== 'survival') continue;
    const k = issuerKey(e.snapshot);
    if (k) (issuerGroups[k] ||= []).push(e);
  }
  for (const group of Object.values(issuerGroups)) {
    if (group.length < 2) continue;
    group.sort((a, b) => {
      const ua = isUS(a.snapshot) ? 1 : 0, ub = isUS(b.snapshot) ? 1 : 0;
      if (ua !== ub) return ub - ua;                       // US-primaeres Bein zuerst
      const ma = mcapOf(a.snapshot), mb = mcapOf(b.snapshot);
      if (ma !== mb) return mb - ma;                       // dann groesste marketCap
      return cmpTicker(a.ticker, b.ticker);                // dann stabiler Ticker-Tie-Break (deterministisch)
    });
    for (let i = 1; i < group.length; i++) {
      const e = group[i];
      e.action = 'exclude'; e.formulaId = null; e.track = null; e.score = null; e.reason = 'dup-issuer';
      delete e.formula; delete e.gpClass;
    }
  }

  // 2. Kohorten (formulaId|track) bilden, Roh-Achsen sammeln, q()-normieren, gewichten
  const cohorts = {};
  for (const e of results) {
    if (e.action !== 'route') continue;
    (cohorts[e.formulaId + '|' + e.track] ||= []).push(e);
  }
  for (const entries of Object.values(cohorts)) {
    const formula = entries[0].formula;
    const track = entries[0].track;
    // none-Branchen mit subCohortByProfit (it-services/real-estate): die Niveau-ROIC-
    // Achse capitalEfficiency nur gegen Firmen GLEICHEN Profit-Vorzeichens perzentil-
    // ieren, damit Verlust-Wachser nicht vom Niveau-ROIC im SCORE demoviert werden
    // (Iron-Rule 2). Split-Branchen (mit Ankern) trennen das ohnehin via Track.
    const profitSign = formula.subCohortByProfit
      ? entries.map((e) => signTrack(norm(e.snapshot, 'annualOpInc')))
      : null;
    const rawByAxis = {};
    for (const ax of formula.axes) {
      rawByAxis[ax.key] = entries.map((e) => rawAxisValue(e.snapshot, ax.key, formula, track));
    }
    for (let i = 0; i < entries.length; i++) {
      const axes = formula.axes.map((ax) => {
        let cohort = rawByAxis[ax.key];
        if (profitSign && ax.key === 'capitalEfficiency') {
          cohort = cohort.filter((_, j) => profitSign[j] === profitSign[i]);
        }
        return { value: q(rawByAxis[ax.key][i], cohort), weight: ax.w[track] };
      });
      entries[i].score = weightedScore(axes);
    }
  }

  // 2b. no-axes-Guard (Weltweit-Pivot A3-Stufe-2): ein routebarer Name, dessen Roh-Achsen alle null
  // sind (extrem sparse/erratische Auslandsdaten -> weightedScore null), wird explizit als 'no-axes'
  // excludiert statt als stummer score:null-route mitgeschleppt. q() filtert nulls aus der Kohorte,
  // also verzerrt er die Perzentile der anderen nicht — der Guard macht den Zustand nur sichtbar.
  for (const e of results) {
    if (e.action === 'route' && e.score === null) {
      e.action = 'exclude'; e.formulaId = null; e.track = null; e.reason = 'no-axes';
      delete e.formula; delete e.gpClass;
    }
  }

  // 3. Overview-Metrik anhaengen + interne Felder entfernen
  for (const e of results) {
    if (e.action === 'route') {
      e.overview = overviewMetric(e.snapshot, { gpClass: e.gpClass, specialTrack: SPECIAL_OVERVIEW[e.formulaId] });
    } else if (e.action === 'survival') {
      // Pre-Revenue/Biotech: KEIN Growth-Score, nur Runway-Badge (Plan: nie growth-gescort)
      e.overview = overviewMetric(e.snapshot, { specialTrack: 'biotech' });
    }
    // A2 (Weltweit-Pivot): Land/Region/Sektor/MarketCap aus meta anheften, SOLANGE der
    // Snapshot noch existiert (wird gleich geloescht). produceRankings haengt sie an jede
    // Output-Zeile -> Voraussetzung fuer Karls Laenderfilter + Sektor-Tabs + mcap-Spalte.
    // Rein additiv: kein Routing/Track/Achsen/Score/Lampen-Einfluss -> fixture-safe.
    const meta = e.snapshot && e.snapshot.meta;
    const geo = normalizeCountry(meta);
    e.country = geo.country;
    e.region = geo.region;
    e.sector = (meta && typeof meta.sector === 'string' && meta.sector) || null;
    const mc = e.snapshot && e.snapshot.marketCap;
    e.marketCap = (mc && Number.isFinite(mc.value)) ? mc.value : null;
    delete e.snapshot;
    delete e.formula;
  }
  return results;
}

// Branchen, deren Overview-Spalte eine track-eigene Badge statt GP-Wachstum nutzt.
const SPECIAL_OVERVIEW = { 'real-estate': 'reit' };

// Bequemer Helfer: gerankte Liste je Branche+Track (Score absteigend).
function rankBy(results, formulaId, track) {
  return results
    .filter((e) => e.action === 'route' && e.formulaId === formulaId && (!track || e.track === track) && e.score !== null)
    .sort((a, b) => b.score - a.score);
}

const round1 = (x) => (Number.isFinite(x) ? Math.round(x * 10) / 10 : null);

/**
 * produceRankings(results, {topN}) -> dashboard-integrierbares JSON-Objekt:
 *   { branches: { <id>: { profitable:[...], unprofitable:[...] } },
 *     overview: [...cross-branch nach Score],
 *     survival: [...pre-revenue-biotech mit Runway],
 *     excluded: {<reason>: count} }
 * Reine Funktion (kein I/O) — vom CLI run-screener.js sowie Tests genutzt.
 */
function produceRankings(results, opts = {}) {
  const topN = opts.topN || 50;
  const branches = {};
  const overview = [];
  const survival = [];
  const excluded = {};
  // A2: die in scoreUniverse angehefteten geo-Felder an jede Output-Zeile spreaden
  // (?? null haelt die Form stabil, falls produceRankings mit handgebauten results laeuft).
  const geo = (e) => ({ country: e.country ?? null, region: e.region ?? null, sector: e.sector ?? null, marketCap: e.marketCap ?? null });
  for (const e of (Array.isArray(results) ? results : [])) {
    if (e.action === 'survival') {
      survival.push({ ticker: e.ticker, runwayQuarters: e.overview ? e.overview.value : null, lamps: e.lamps, ...geo(e) });
      continue;
    }
    if (e.action === 'exclude' || e.action === 'unrouted') {
      const k = e.reason || e.action;
      excluded[k] = (excluded[k] || 0) + 1;
      continue;
    }
    if (e.action !== 'route' || e.score === null) continue;
    const row = {
      ticker: e.ticker, score: round1(e.score), track: e.track, lamps: e.lamps,
      overview: e.overview ? { kind: e.overview.kind, value: round1(e.overview.value) } : null,
      ...geo(e),
      // audit/fix (D1/D2): rohen Score zum Sortieren behalten, NUR fuer die Anzeige runden.
      // Sortiert man das gerundete Feld, entstehen kuenstliche round1-Ties, die JS-stable-sort
      // per Input- = fs.readdirSync-Reihenfolge bricht -> nicht reproduzierbare topN-Membership (CI != lokal).
      _raw: e.score,
    };
    branches[e.formulaId] = branches[e.formulaId] || { profitable: [], unprofitable: [] };
    (branches[e.formulaId][e.track] = branches[e.formulaId][e.track] || []).push(row);
    overview.push({ ticker: e.ticker, formulaId: e.formulaId, track: e.track, score: round1(e.score),
      overviewKind: e.overview ? e.overview.kind : null, overviewValue: e.overview ? round1(e.overview.value) : null,
      lamps: e.lamps, ...geo(e), _raw: e.score });
  }
  // audit/fix (D1/D2/D3): roher Score + deterministischer Ticker-Tie-Break VOR dem Slicen,
  // damit exakte/round1-Ties nicht von der Dateisystem-Reihenfolge entschieden werden. _raw
  // wird danach gestrippt -> Output-Shape unveraendert.
  const byScore = (a, c) => (c._raw - a._raw) || cmpTicker(a.ticker, c.ticker);
  const stripRaw = ({ _raw, ...row }) => row;
  for (const b of Object.values(branches)) {
    for (const t of Object.keys(b)) { b[t].sort(byScore); b[t] = b[t].slice(0, topN).map(stripRaw); }
  }
  overview.sort(byScore);
  // audit/fix (O8): Survival-Liste nach Runway absteigend (nulls ans Ende, Ticker-Tie-Break),
  // sonst sind die laengsten-ueberlebenden Namen unsortiert vergraben.
  survival.sort((a, c) => {
    const av = a.runwayQuarters, cv = c.runwayQuarters;
    if (av === null && cv === null) return cmpTicker(a.ticker, c.ticker);
    if (av === null) return 1;
    if (cv === null) return -1;
    return (cv - av) || cmpTicker(a.ticker, c.ticker);
  });
  return { branches, overview: overview.slice(0, topN * 2).map(stripRaw), survival, excluded };
}

module.exports = { scoreUniverse, rankBy, trackOf, rawAxisValue, produceRankings };

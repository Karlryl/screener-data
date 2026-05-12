'use strict';

// Tag 120: Score-Aggregator Integration (Hygiene-Filter + Investment-Score Trennung)
var ScoreAggregator;
try { ScoreAggregator = require('./score-aggregator.js'); }
catch (e) { ScoreAggregator = null; }

/**
 * Tag 100: Strategy-Modes Registry
 * =================================
 * 3 vordefinierte Discovery-Modi statt Methoden-Selbst-Filtern.
 * Karl ist Nicht-Quant â er soll keine Methoden bedienen, sondern
 * Kandidaten-Storys lesen.
 *
 * Pro Modus:
 *   - core: Methoden die den Modus charakterisieren (sichtbar als Story)
 *   - dataGuards: harte Reject-Filter (revenue-shock etc.)
 *   - evidence: literaturgestÃ¼tzt | heuristisch | experimentell
 *   - story: Template fuer 1-Satz-Beschreibung pro Stock
 *   - excludeSectors: Sektor-Ausschluesse fuer diesen Modus
 *
 * Sektor-Logik (Karl explizit): Banks/REITs/Insurance immer raus.
 */

const SECTOR_EXCLUDE_DEFAULT = [
  /bank|insurance|financial services|capital markets|asset management/i,
  /real estate|reit|equity reit|mortgage reit/i
];

// Tag 104: zusaetzlich Mining/Materials aus Hypergrowth raus â rohstoff-preis-abhaengig
const SECTOR_EXCLUDE_HYPERGROWTH = [
  ...SECTOR_EXCLUDE_DEFAULT,
  /\bgold\b|\bsilver\b|\bcopper\b|\bmining\b|\bmetals\b|\bcoal\b/i,
  /oil & gas|integrated oil|exploration|drilling/i,
  // Tag 121e: Healthcare Plans (Insurance) sind keine Hypergrowth-Stocks (OSCR-Fix)
  /healthcare plans|managed (health )?care|health insurance/i
];

// Tag 117: Quality-Compounder erweitert â Konsens nach 5-Runden-Battle
// Excludes: Banks/REITs/Insurance + Mining/Oil/Steel + Auto/Airlines/Utilities/Telecom
const SECTOR_EXCLUDE_QC = [
  ...SECTOR_EXCLUDE_HYPERGROWTH,
  /\bsteel\b|integrated steel|\biron\b/i,
  /auto manufacturers|automotive|car manufacturer/i,
  /airlines?|airline industry/i,
  /utilities|utility|electric utilities|water utilities|gas utilities/i,
  /telecom|telecommunication/i
];

const MODES = {
  HYPERGROWTH: {
    id: 'HYPERGROWTH',
    label: 'Hypergrowth',
    description: 'Stark wachsende Firmen wie CRDO, ALAB, PLTR â fruehzeitig entdecken.',
    evidence: 'heuristisch',
    evidenceLabel: 'Heuristisch â sucht stark wachsende Firmen, manueller Deep-Dive empfohlen.',
    core: [
      // Rule-of-40 sichtbar als CORE (Karl's expliziter Wunsch)
      { id: 'rule-of-40', required: true, weight: 'must', storyHint: 'Rule-of-40 erfuellt' },
      { id: 'rule-of-x', required: false, weight: 'prefer', storyHint: 'Rule-of-X attraktiv' },
      { id: 'revenue-growth-3y', required: true, weight: 'must', storyHint: 'starkes 3-Jahres-Umsatzwachstum' },
      { id: 'gross-margin-stability', required: false, weight: 'prefer', storyHint: 'Bruttomarge stabil/hoch' },
      // Tag 102c: profitability-state als CORE auch in Hypergrowth (Karl-Wunsch: Loss/Turnaround/Recent/Stable filtern)
      { id: 'profitability-state', required: false, weight: 'prefer', storyHint: 'Profitabilitaets-Status' },
      // Tag 112: Hypergrowth-Quality-Klassifikator als HARD-FILTER (Q_SPIKE_FAKE und LOW_BASE_EFFECT raus)
      { id: 'hypergrowth-quality-class', required: false, weight: 'prefer', storyHint: 'echtes Hypergrowth-Pattern' }
    ],
    // Tag 121c: q-spike-dataguard zurueck zu HARD (IONQ-Fix). NVDA bleibt sichtbar weil
    // sein OI nicht dramatisch expandiert (NVDA q-spike=pass, IONQ q-spike=fail OI-Severity 2.7x).
    dataGuards: ['sloan-ratio', 'forecast-contamination-guard', 'q-spike-dataguard', 'revenue-volatility-guard'],
    // Tag 120d: revenue-shock-guard NACHTRAEGLICH in softGuards (war Hauptursache NVDA in HG nicht sichtbar)
    softGuards: ['revenue-shock-guard', 'quarter-concentration-guard', 'deceleration-guard'],
    excludeSectors: SECTOR_EXCLUDE_HYPERGROWTH,
    storyTemplate: '{ticker} â Hypergrowth: {coreSummary}. {warnings}',
    defaultSortMethod: 'rule-of-x'
  },

  QUALITY_COMPOUNDER: {
    id: 'QUALITY_COMPOUNDER',
    label: 'Quality-Compounder',
    description: 'Proven Reinvestment-Compounder mit Pricing-Power und Earnings-Stabilitaet (Buffett/Smith-Profil).',
    evidence: 'literaturgestuetzt',
    evidenceLabel: 'Literaturgestuetzt + Council-Konsens (Tag 117): Asness QMJ, Damodaran ROICÃReinvestment, Terry Smith Quality-Compounder.',
    core: [
      // Tag 117 v2 â Konsens nach 5-Runden-Battle
      { id: 'quality-compounder-roic', required: true, weight: 'must', storyHint: 'PreTax-ROIC>=20% (oder >=17% mit AT>=2)' },
      { id: 'earnings-stability', required: true, weight: 'must', storyHint: 'OpInc+FCF positive 4/5y, kein dauerhafter Decline' },
      { id: 'margin-quality', required: true, weight: 'must', storyHint: 'GM>=35% + OpMargin>=15% (mit AT-Override)' },
      { id: 'reinvestment-rate', required: true, weight: 'must', storyHint: 'Reinvestment-Rate>=20% (Capex+R&D)/OCF' },
      // Premium-Proof als Soft-Tag (sichtbar im Reason-Code)
      { id: 'premium-compounder-proof', required: false, weight: 'prefer', storyHint: 'Premium-Compounder (alle 6 Premium-Punkte)' },
      { id: 'fcf-yield', required: false, weight: 'prefer', storyHint: 'FCF-Yield-Sortier-Hint' },
      { id: 'net-debt-ebitda', required: true, weight: 'must', storyHint: 'Net-Debt/EBITDA <= 2.5' },
      { id: 'above-200d-ma', required: false, weight: 'prefer', storyHint: 'positiver Trend' }
    ],
    dataGuards: ['sloan-ratio', 'forecast-contamination-guard'],
    // Tag 120b: Soft-Guards - M&A-Compounder + Seasonal-Businesses-Fix
    softGuards: ['asset-growth-divergence', 'working-capital-anomaly'],
    softWarnings: [],
    excludeSectors: SECTOR_EXCLUDE_QC,  // Tag 117: erweiterte Excludes
    mcapFloor: 5e9,  // Tag 117: 5B Mcap-Floor fuer Quality-Compounder
    storyTemplate: '{ticker} â Quality-Compounder: {coreSummary}. {warnings}',
    defaultSortMethod: 'quality-compounder-roic'
  },

  TURNAROUND: {
    id: 'TURNAROUND',
    label: 'Turnaround',
    description: 'Firmen die gerade aus Verlust in Profit drehen â fruehe Re-Rating-Kandidaten.',
    evidence: 'experimentell',
    evidenceLabel: 'Experimentell â hohe Fehlerrate moeglich, nur als Ideenquelle (NICHT in v1.0 â kommt in Phase 2).',
    core: [
      { id: 'profitability-state', required: true, weight: 'must', storyHint: 'frischer Sign-Flip oder neue Profitabilitaet', acceptValues: ['TURNAROUND', 'RECENT'] },
      { id: 'profitability-trend', required: true, weight: 'must', storyHint: 'Profitabilitaet verbessert sich', acceptValues: ['IMPROVING'] },
      { id: 'revenue-growth-3y', required: false, weight: 'prefer', storyHint: 'Umsatz waechst' }
    ],
    dataGuards: ['sloan-ratio', 'net-debt-ebitda', 'revenue-shock-guard'],
    softGuards: [],  // Tag 120b: Turnaround keine softGuards definiert
    excludeSectors: SECTOR_EXCLUDE_HYPERGROWTH,
    enabled: false,  // Phase 2 â nicht in v1.0
    storyTemplate: '{ticker} â Turnaround: {coreSummary}. {warnings}',
    defaultSortMethod: 'profitability-trend'
  }
};

function isExcludedBySector(stock, mode) {
  const m = stock && stock.meta;
  if (!m) return false;
  const combined = [(m.sector || ''), (m.industry || '')].filter(Boolean).join(' ');
  if (!combined) return false;
  return mode.excludeSectors.some(rgx => rgx.test(combined));
}

function evaluateMode(stock, modeId, allResults) {
  const mode = MODES[modeId];
  if (!mode) return { passed: false, reason: 'unknown_mode' };
  if (mode.enabled === false) return { passed: false, reason: 'mode_disabled' };
  if (isExcludedBySector(stock, mode)) return { passed: false, reason: 'sector_excluded', sector: stock.meta && stock.meta.sector };
  // Tag 117: Mcap-Floor pro Mode
  if (mode.mcapFloor != null) {
    const mcRaw = stock && stock.marketCap;
    const mc = (typeof mcRaw === 'number') ? mcRaw : (mcRaw && mcRaw.value) || 0;
    if (mc > 0 && mc < mode.mcapFloor) {
      return { passed: false, reason: 'mcap_below_floor', mcap: mc, mcapFloor: mode.mcapFloor };
    }
  }

  // DataGuard-Check zuerst â modusbezogen
  const failedGuards = [];
  for (const guardId of mode.dataGuards) {
    const r = allResults[guardId];
    if (r && r.computable === true && r.pass === false) {
      failedGuards.push(guardId);
    }
  }
  if (failedGuards.length > 0) {
    return { passed: false, reason: 'dataguard_fail', failedGuards };
  }

  // Tag 120b: SoftGuard-Check - sammelt Warnings, blockt NICHT passed
  const failedSoftGuards = [];
  if (mode.softGuards && mode.softGuards.length > 0) {
    for (const sgId of mode.softGuards) {
      const r = allResults[sgId];
      if (r && r.computable === true && r.pass === false) {
        failedSoftGuards.push(sgId);
      }
    }
  }

  // CORE-Check: alle "must" Methoden muessen pass haben
  const mustChecks = mode.core.filter(c => c.weight === 'must' && c.required);
  const preferChecks = mode.core.filter(c => c.weight === 'prefer');

  const mustResults = [];
  let mustPassCount = 0;
  for (const check of mustChecks) {
    const r = allResults[check.id];
    if (!r || !r.computable) {
      mustResults.push({ id: check.id, status: 'incomputable', storyHint: check.storyHint });
      continue;
    }
    // acceptValues check (z.B. profitability-state == TURNAROUND/RECENT)
    if (check.acceptValues && r.components && r.components.state) {
      const ok = check.acceptValues.includes(r.components.state);
      mustResults.push({ id: check.id, status: ok ? 'pass' : 'fail', storyHint: check.storyHint, value: r.components.state });
      if (ok) mustPassCount++;
      continue;
    }
    if (r.pass) {
      mustResults.push({ id: check.id, status: 'pass', storyHint: check.storyHint, value: r.value });
      mustPassCount++;
    } else {
      mustResults.push({ id: check.id, status: 'fail', storyHint: check.storyHint, value: r.value });
    }
  }

  const preferResults = preferChecks.map(check => {
    const r = allResults[check.id];
    if (!r || !r.computable) return { id: check.id, status: 'incomputable', storyHint: check.storyHint };
    return { id: check.id, status: r.pass ? 'pass' : 'fail', storyHint: check.storyHint, value: r.value };
  });

  const allMustPass = mustPassCount === mustChecks.length;

  // Tag 120: Score-Aggregator (Investment-Score-Schicht)
  // Hygiene-Layer (DataGuards/Sector/Mcap) wurde bereits oben durch fruehe Returns gefiltert.
  // Hier wird der Score nur fuer Stocks berechnet die durch Hygiene durch sind.
  var scoreResult = null;
  if (ScoreAggregator) {
    try { scoreResult = ScoreAggregator.computeScore(allResults, modeId, null, failedSoftGuards); }
    catch (e) { scoreResult = null; }
  }

  return {
    passed: allMustPass,
    mustResults,
    preferResults,
    mustPassCount,
    mustTotal: mustChecks.length,
    preferPassCount: preferResults.filter(p => p.status === 'pass').length,
    preferTotal: preferResults.length,
    mode: modeId,
    // Tag 120 NEW fields (non-breaking, modes-report kann sie ignorieren bis Tag 121)
    score: scoreResult ? scoreResult.score : null,
    tier: scoreResult ? scoreResult.tier : null,
    redFlags: scoreResult ? scoreResult.redFlags : [],
    scoreBreakdown: scoreResult ? scoreResult.breakdown : null,
    // Tag 120b: SoftGuards die ausgeloest haben - sichtbar als Warnings im UI
    failedSoftGuards: failedSoftGuards,
    softGuardPenalty: scoreResult ? scoreResult.softGuardPenalty : 0
  };
}

// Soft-Warning Texte pro DataGuard
const SOFT_WARNING_TEXT = {
  'sloan-ratio': 'Earnings-Quality auffaellig (Sloan-Ratio hoch â kann R&D/Working-Capital-Effekt sein)',
  'net-debt-ebitda': 'Bilanz-Risiko (Net-Debt/EBITDA hoch)',
  'asset-growth-divergence': 'Asset-Wachstum > Umsatz-Wachstum (Acquired-Growth-Risiko)',
  'revenue-shock-guard': 'Umsatzsprung wirkt wie Einmaleffekt',
  'q-spike-dataguard': 'Q-Spike-Pattern (OI-Expansion oder >55% Single-Q-Konzentration)'
};
const MISSING_GUARD_TEXT = {
  'sloan-ratio': 'Sloan-Ratio nicht berechenbar',
  'net-debt-ebitda': 'Net-Debt/EBITDA nicht berechenbar',
  'asset-growth-divergence': 'Asset-Growth nicht berechenbar',
  'revenue-shock-guard': 'Umsatz-Shock-Check nicht moeglich (keine Quartalsdaten)',
  'q-spike-dataguard': 'Q-Spike-Check nicht moeglich (keine Quartals/OI-Daten)'
};

function buildStory(stock, modeEval, allResults, modeRef) {
  if (!modeEval.passed) return null;
  const passingMust = modeEval.mustResults.filter(m => m.status === 'pass').map(m => m.storyHint);
  const passingPrefer = modeEval.preferResults.filter(m => m.status === 'pass').map(m => m.storyHint);
  const facts = [...passingMust, ...passingPrefer].slice(0, 3);

  // Warnings: incomputable musts, near thresholds, soft warnings, missing dataguards
  const warnings = [];
  const incomputableMusts = modeEval.mustResults.filter(m => m.status === 'incomputable');
  if (incomputableMusts.length > 0) warnings.push(`${incomputableMusts.length} Datenfeld(er) fehlen`);

  // Tag 102 fix: softWarnings (z.B. Sloan in Quality)
  const mode = modeRef || MODES[modeEval.mode];
  if (mode && Array.isArray(mode.softWarnings)) {
    for (const warnId of mode.softWarnings) {
      const r = allResults[warnId];
      if (r && r.computable === true && r.pass === false) {
        warnings.push(SOFT_WARNING_TEXT[warnId] || (warnId + ' auffaellig'));
      }
    }
  }

  // Tag 102 fix: incomputable DataGuards als Warning (vorher silent)
  if (mode && Array.isArray(mode.dataGuards)) {
    for (const guardId of mode.dataGuards) {
      const r = allResults[guardId];
      if (!r || r.computable !== true) {
        warnings.push(MISSING_GUARD_TEXT[guardId] || (guardId + ' nicht pruefbar'));
      }
    }
  }

  // Bewertung-Hinweis bei Hypergrowth (oft teuer)
  if (modeEval.mode === 'HYPERGROWTH') {
    const fcfY = allResults['fcf-yield'];
    if (fcfY && fcfY.computable && fcfY.value < 2) warnings.push('Bewertung sehr ambitioniert');
  }

  return {
    ticker: stock.meta && stock.meta.ticker,
    coreSummary: facts.join(', '),
    warnings: warnings.length > 0 ? 'â  ' + warnings.join('; ') : '',
    mustPassCount: modeEval.mustPassCount,
    mustTotal: modeEval.mustTotal,
    preferPassCount: modeEval.preferPassCount,
    preferTotal: modeEval.preferTotal
  };
}


/**
 * Tag 122: QC Profile-Overrides
 * ==============================
 * Statt drei neue Top-Level-Modes: optional moduliert ein Profile einzelne MUSTs
 * im QUALITY_COMPOUNDER, ohne Mode-Liste zu explodieren.
 *
 * Anwendung: const qcMA = applyProfile(MODES.QUALITY_COMPOUNDER, 'M_AND_A');
 *
 * Profiles:
 *   - M_AND_A: net-debt-ebitda von must→prefer (Acquirer hat erwartungsgemaess hoeheren Debt)
 *   - ASSET_HEAVY: reinvestment-rate von must→prefer (Capex-intensive Sektoren)
 *   - COVID_RECOVERY: earnings-stability von must→prefer (Pandemic-Dip fuer 1-2 Jahre)
 *
 * Per-Profile modulation ist nicht-destruktiv (mutiert MODES.QUALITY_COMPOUNDER nicht).
 */
const PROFILES = {
  M_AND_A: {
    label: 'M&A-Compounder',
    description: 'Acquirer-Profile - erlaubt erhoehten Net-Debt fuer Capital-Allokation via Akquisitionen',
    coreOverrides: { 'net-debt-ebitda': { weight: 'prefer' } },
    softGuardsAdd: ['asset-growth-divergence']  // Acquired-Growth detection
  },
  ASSET_HEAVY: {
    label: 'Asset-Heavy-Compounder',
    description: 'Capex-intensive Sektoren - relaxed Reinvestment-Rate (Capex selbst IST Reinvestment)',
    coreOverrides: { 'reinvestment-rate': { weight: 'prefer' } }
  },
  COVID_RECOVERY: {
    label: 'COVID-Recovery',
    description: 'Pandemic-affected Sektoren - earnings-stability darf 2020-2022 Dip haben',
    coreOverrides: { 'earnings-stability': { weight: 'prefer' } }
  }
};

function applyProfile(mode, profileId) {
  const profile = PROFILES[profileId];
  if (!profile) throw new Error('Unknown profile: ' + profileId);
  // Non-destructive deep-ish clone of core[]; rest is shared
  const newCore = mode.core.map(c => {
    const override = profile.coreOverrides && profile.coreOverrides[c.id];
    if (!override) return c;
    return Object.assign({}, c, override, { required: override.weight === 'must' });
  });
  const newSoftGuards = profile.softGuardsAdd
    ? [...(mode.softGuards || []), ...profile.softGuardsAdd]
    : mode.softGuards;
  return Object.assign({}, mode, {
    id: mode.id + '_' + profileId,
    label: mode.label + ' (' + profile.label + ')',
    description: profile.description,
    core: newCore,
    softGuards: newSoftGuards,
    appliedProfile: profileId
  });
}

module.exports = {
  MODES,
  PROFILES,
  applyProfile,
  evaluateMode,
  buildStory,
  isExcludedBySector
};

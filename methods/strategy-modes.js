'use strict';
/**
 * Tag 100: Strategy-Modes Registry
 * =================================
 * 3 vordefinierte Discovery-Modi statt Methoden-Selbst-Filtern.
 * Karl ist Nicht-Quant — er soll keine Methoden bedienen, sondern
 * Kandidaten-Storys lesen.
 *
 * Pro Modus:
 *   - core: Methoden die den Modus charakterisieren (sichtbar als Story)
 *   - dataGuards: harte Reject-Filter (revenue-shock etc.)
 *   - evidence: literaturgestützt | heuristisch | experimentell
 *   - story: Template fuer 1-Satz-Beschreibung pro Stock
 *   - excludeSectors: Sektor-Ausschluesse fuer diesen Modus
 *
 * Sektor-Logik (Karl explizit): Banks/REITs/Insurance immer raus.
 */

const SECTOR_EXCLUDE_DEFAULT = [
  /bank|insurance|financial services|capital markets|asset management/i,
  /real estate|reit|equity reit|mortgage reit/i
];

const MODES = {
  HYPERGROWTH: {
    id: 'HYPERGROWTH',
    label: 'Hypergrowth',
    description: 'Stark wachsende Firmen wie CRDO, ALAB, PLTR — fruehzeitig entdecken.',
    evidence: 'heuristisch',
    evidenceLabel: 'Heuristisch — sucht stark wachsende Firmen, manueller Deep-Dive empfohlen.',
    core: [
      // Rule-of-40 sichtbar als CORE (Karl's expliziter Wunsch)
      { id: 'rule-of-40', required: true, weight: 'must', storyHint: 'Rule-of-40 erfuellt' },
      { id: 'rule-of-x', required: false, weight: 'prefer', storyHint: 'Rule-of-X attraktiv' },
      { id: 'revenue-growth-3y', required: true, weight: 'must', storyHint: 'starkes 3-Jahres-Umsatzwachstum' },
      { id: 'gross-margin-stability', required: false, weight: 'prefer', storyHint: 'Bruttomarge stabil/hoch' }
    ],
    dataGuards: ['revenue-shock-guard', 'sloan-ratio'],
    excludeSectors: SECTOR_EXCLUDE_DEFAULT,
    storyTemplate: '{ticker} — Hypergrowth: {coreSummary}. {warnings}'
  },

  QUALITY_COMPOUNDER: {
    id: 'QUALITY_COMPOUNDER',
    label: 'Quality-Compounder',
    description: 'Profitable Firmen mit stabilem ROIC und Margenstabilitaet — Novo Nordisk, Evolution AB-Profil.',
    evidence: 'literaturgestuetzt',
    evidenceLabel: 'Literaturgestuetzt — basiert auf etablierten Quality/Value-Faktoren (Greenblatt, Asness, Novy-Marx).',
    core: [
      { id: 'roic', required: true, weight: 'must', storyHint: 'starke Kapitalrendite' },
      { id: 'gross-margin-stability', required: true, weight: 'must', storyHint: 'stabile Bruttomargen' },
      { id: 'fcf-yield', required: true, weight: 'must', storyHint: 'gesundes FCF-Yield' },
      { id: 'net-debt-ebitda', required: true, weight: 'must', storyHint: 'solide Bilanz' },
      { id: 'above-200d-ma', required: false, weight: 'prefer', storyHint: 'positiver Trend' }
    ],
    dataGuards: ['asset-growth-divergence'],
    softWarnings: ['sloan-ratio'],
    excludeSectors: SECTOR_EXCLUDE_DEFAULT,
    storyTemplate: '{ticker} — Quality-Compounder: {coreSummary}. {warnings}'
  },

  TURNAROUND: {
    id: 'TURNAROUND',
    label: 'Turnaround',
    description: 'Firmen die gerade aus Verlust in Profit drehen — fruehe Re-Rating-Kandidaten.',
    evidence: 'experimentell',
    evidenceLabel: 'Experimentell — hohe Fehlerrate moeglich, nur als Ideenquelle (NICHT in v1.0 — kommt in Phase 2).',
    core: [
      { id: 'profitability-state', required: true, weight: 'must', storyHint: 'frischer Sign-Flip oder neue Profitabilitaet', acceptValues: ['TURNAROUND', 'RECENT'] },
      { id: 'profitability-trend', required: true, weight: 'must', storyHint: 'Profitabilitaet verbessert sich', acceptValues: ['IMPROVING'] },
      { id: 'revenue-growth-3y', required: false, weight: 'prefer', storyHint: 'Umsatz waechst' }
    ],
    dataGuards: ['sloan-ratio', 'net-debt-ebitda', 'revenue-shock-guard'],
    excludeSectors: SECTOR_EXCLUDE_DEFAULT,
    enabled: false,  // Phase 2 — nicht in v1.0
    storyTemplate: '{ticker} — Turnaround: {coreSummary}. {warnings}'
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

  // DataGuard-Check zuerst — modusbezogen
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

  return {
    passed: allMustPass,
    mustResults,
    preferResults,
    mustPassCount,
    mustTotal: mustChecks.length,
    preferPassCount: preferResults.filter(p => p.status === 'pass').length,
    preferTotal: preferResults.length,
    mode: modeId
  };
}

function buildStory(stock, modeEval, allResults) {
  if (!modeEval.passed) return null;
  const passingMust = modeEval.mustResults.filter(m => m.status === 'pass').map(m => m.storyHint);
  const passingPrefer = modeEval.preferResults.filter(m => m.status === 'pass').map(m => m.storyHint);
  const facts = [...passingMust, ...passingPrefer].slice(0, 3);

  // Warnings: incomputable musts, near thresholds
  const warnings = [];
  const incomputableMusts = modeEval.mustResults.filter(m => m.status === 'incomputable');
  if (incomputableMusts.length > 0) warnings.push(`${incomputableMusts.length} Datenfeld(er) fehlen`);
  // Bewertung-Hinweis bei Hypergrowth (oft teuer)
  if (modeEval.mode === 'HYPERGROWTH') {
    const fcfY = allResults['fcf-yield'];
    if (fcfY && fcfY.computable && fcfY.value < 2) warnings.push('Bewertung sehr ambitioniert');
  }

  return {
    ticker: stock.meta && stock.meta.ticker,
    coreSummary: facts.join(', '),
    warnings: warnings.length > 0 ? '⚠ ' + warnings.join('; ') : '',
    mustPassCount: modeEval.mustPassCount,
    mustTotal: modeEval.mustTotal,
    preferPassCount: modeEval.preferPassCount,
    preferTotal: modeEval.preferTotal
  };
}

module.exports = {
  MODES,
  evaluateMode,
  buildStory,
  isExcludedBySector
};

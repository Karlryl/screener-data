'use strict';
/**
 * Hypergrowth Engine — Overview-Metrik (Cross-Branchen-Vergleichbarkeit)
 * =====================================================================
 * Primaer: Bruttogewinn-Wachstum (YoY) — die fairste branchenuebergreifende
 * Growth-Zahl (Novy-Marx), respektiert Margen-Niveaus, bestraft Unprofitabilitaet
 * nicht (GP fast immer positiv), kein KGV.
 *
 * audit/fix (O1, 2026-06-26): Dieser Wert wird als branchenuebergreifend VERGLEICHBARE
 * Anzeige-Spalte je Name mitgefuehrt — er ist NICHT der Sortier-Schluessel der Overview-Liste.
 * Die Cross-Branchen-Overview wird in score.js::produceRankings nach dem per-Kohorte
 * gemischten SCORE gerankt (nicht nach einem universumsweiten GP-Perzentil): ein reines
 * GP-Wachstum-Ranking wuerde Micro-Cap-Basis-Artefakte hochspuelen (GP von ~0 auf klein =
 * +6000..+66000% bei UEC/JOBY/NUVB), die der Kohorten-Score korrekt unterdrueckt.
 *
 * Track-eigene Badges (klar als Nicht-GP markiert, nur intra-kohort verglichen):
 *   - degenerierte-GP-Financials (Master-r >= 0.99) -> Revenue-YoY-Badge
 *   - REITs            -> FFO-Proxy-YoY-Badge
 *   - Pre-Revenue/Biotech -> Cash-Runway-Quartale-Badge
 * Begleitspalte: Rule-of-X (alpha=2.3) fuer den Wachstum-vs-Effizienz-Blick.
 * P158 / V-DL3 F-08 (08.10.2026): Jahreswachstum nur aus den zwei juengsten
 * vorhandenen Werten an benachbarten Positionen; gueltige Jahresenden muessen
 * 334 bis 397 Tage auseinanderliegen. Sonst null mit Grund und Fehlwert-Marker.
 */

const { norm, firstPresent, periodEnds, jahresFensterAusgerichtet } = require('./snapshot.js');
const { ruleOfX } = require('./axes.js');
const { annualPeriodEnds, _tagesnummer, ANNUAL_PAIR_MIN_DAYS, ANNUAL_PAIR_MAX_DAYS } = require('../../lib/annual-pairs.js');
const { quarterCandidate, g31Shadow, currenciesMatch, g31Variant } = require('../../lib/g31-recency.js');

function periodOf(leg) {
  return Object.fromEntries(['basis', 'periodEnd', 'priorPeriodEnd', 'sourcePeriodEnd', 'sourcePriorPeriodEnd', 'label', 'reason']
    .map(key => [key, leg[key] ?? null]));
}

/**
 * German reason for withheld non-adjacent annual growth.
 * @param {void} none No parameters; this export is a text constant.
 * @returns {string} Reason attached to the overview metric.
 */
const OVERVIEW_YEARS_NOT_ADJACENT_TEXT = 'Jahreswachstum nicht belegt, Jahre liegen nicht hintereinander';

// Annual field names request annual-only growth; badge kinds select TTM/FFO inputs.
function growthVerdict(s, field, shadow = false) {
  if (field === 'gp') {
    const quarter = shadow ? quarterCandidate(s, 'grossProfitQ') : null;
    const annual = shadow ? growthVerdict(s, 'annualGP', true) : null;
    if (shadow && quarter.pct !== null && quarter.sourcePeriodEnd
        && (annual.value === null || !annual.period?.sourcePeriodEnd || quarter.sourcePeriodEnd >= annual.period.sourcePeriodEnd)) {
      return { value: quarter.current / quarter.prior - 1, withheld: false, period: periodOf(quarter) };
    }
    if (shadow && annual.value !== null && annual.period?.sourcePeriodEnd) return annual;
    // Fix Bug 24: TTM-Fenster POSITIONAL auf der ROH-Serie schneiden (Muster
    // growthYoYComponents in score.js:162-171). presentValues() komprimiert
    // null-Luecken -> slice(4,8) wuerde bei interner Luecke das Vorjahres-Fenster
    // verschieben (kein Jahresvergleich mehr). Nur wenn die ersten 8 Quartale
    // luecken-frei finit sind, ist die positionale TTM-ueber-TTM-Bildung ehrlich.
    // F-4 (03.08.2026): "luecken-frei finit" reicht nicht — eine Reihe kann acht finite
    // Quartale tragen und trotzdem ein Quartal AUSLASSEN (bei chinesischen A-Aktien der
    // Normalfall). Dann ist slice(4,8) nicht das Vorjahr, sondern ein verschobenes Fenster.
    // jahresFensterAusgerichtet prueft genau das am Enddatum; ohne Enden ist es true und
    // das Verhalten byte-identisch zu vorher.
    const raw = norm(s, 'grossProfitQ');
    if (raw.length >= 8 && raw.slice(0, 8).every(Number.isFinite)
        && jahresFensterAusgerichtet(s, 'grossProfitQ', 4)) {
      if (shadow && !currenciesMatch(s, 'timeseries', 'grossProfitQ', [0, 1, 2, 3, 4, 5, 6, 7])) {
        return annual.value !== null ? annual : { value: null, withheld: false, period: periodOf(quarter) };
      }
      const ttmNew = raw.slice(0, 4).reduce((p, c) => p + c, 0);
      const ttmOld = raw.slice(4, 8).reduce((p, c) => p + c, 0);
      const ends = periodEnds(s, 'grossProfitQ'), end = ends[0], priorEnd = ends[4];
      if (ttmOld > 0) return { value: ttmNew / ttmOld - 1, withheld: false,
        period: { basis: 'ttm', periodEnd: end, priorPeriodEnd: priorEnd, sourcePeriodEnd: end,
          sourcePriorPeriodEnd: priorEnd, label: end ? `Vier Quartale bis ${end.slice(8, 10)}.${end.slice(5, 7)}.${end.slice(0, 4)}`
            : 'Vier Quartale, Periodenende unbekannt', reason: end && priorEnd ? null : 'Periodenenden fehlen.' } };
    }
    field = 'annualGP';
  }
  let values;
  if (field === 'ffo-badge') {
    const ni = norm(s, 'annualNetIncome');
    const dep = norm(s, 'annualDepreciation');
    const n = Math.min(ni.length, dep.length); // Laengen clampen (kein undefined-Zip)
    values = [];
    for (let i = 0; i < n; i++) {
      const a = ni[i], b = dep[i];
      values.push((a !== null && b !== null && Number.isFinite(a + b)) ? a + b : null);
    }
    field = 'annualNetIncome';
  } else {
    values = norm(s, field);
  }
  const newer = values.findIndex(Number.isFinite);
  const older = values.findIndex((value, i) => i > newer && Number.isFinite(value));
  if (newer < 0 || older < 0 || values[older] <= 0) return { value: null, withheld: false };
  if (shadow && ['annualRev', 'annualGP'].includes(field) && !currenciesMatch(s, 'annual', field, [newer, older])) {
    return { value: null, withheld: false, period: periodOf({ basis: 'none', label: 'Zeitraum nicht verfügbar',
      reason: 'Die Währungen der Jahreswerte stimmen nicht überein.' }) };
  }
  const ends = annualPeriodEnds(s, field);
  const newEnd = _tagesnummer(ends[newer]), oldEnd = _tagesnummer(ends[older]);
  // Use P115's measured 334..397 days, not the brief's rounded 330..400 window.
  const withheld = older !== newer + 1 || (newEnd !== null && oldEnd !== null
    && (newEnd - oldEnd < ANNUAL_PAIR_MIN_DAYS || newEnd - oldEnd > ANNUAL_PAIR_MAX_DAYS));
  const end = newEnd === null ? null : ends[newer], priorEnd = oldEnd === null ? null : ends[older];
  return { value: withheld ? null : values[newer] / values[older] - 1, withheld,
    period: { basis: 'year', periodEnd: end, priorPeriodEnd: priorEnd, sourcePeriodEnd: end, sourcePriorPeriodEnd: priorEnd,
      label: end ? `Geschäftsjahr bis ${end.slice(8, 10)}.${end.slice(5, 7)}.${end.slice(0, 4)}` : 'Geschäftsjahr, Periodenende unbekannt',
      reason: withheld ? OVERVIEW_YEARS_NOT_ADJACENT_TEXT : end && priorEnd ? null : 'Periodenenden fehlen.' } };
}

// YoY-Wachstum einer {value}-Jahres-/Quartalsserie via norm()-Feldname.
function yoyAnnual(s, field) {
  return growthVerdict(s, field).value;
}

// Bruttogewinn-Wachstum YoY: TTM-ueber-TTM wenn >=8 present Quartale, sonst
// annualGP-YoY. (Aktuell 5 Quartale -> annual; zukunftssicher bei 8 Quartalen.)
function grossProfitGrowthYoY(s) {
  return growthVerdict(s, 'gp').value;
}

// FFO-Proxy-YoY (REIT-Badge): (NetIncome + Depreciation) je GJ, YoY.
function ffoProxyGrowthYoY(s) {
  return growthVerdict(s, 'ffo-badge').value;
}

// Cash-Runway in Quartalen (Pre-Revenue/Biotech-Badge): Cash / (Burn/4).
function cashRunwayQuarters(s) {
  const cash = firstPresent(norm(s, 'annualBalance', 'totalCash'));
  const fcf = firstPresent(norm(s, 'annualFCF'));
  if (cash === null || fcf === null) return null;
  // Cash-generierend = bester (=hoechster) Runway: endlicher Sentinel statt Infinity,
  // damit q()/Perzentil und JSON (Infinity -> null) den Wert nicht verlieren.
  if (fcf >= 0) return 9999;
  return cash / (Math.abs(fcf) / 4);
}

// Rule-of-X-Begleitspalte (growth-dominant, aus 2 freien Feldern).
// growthBounds MUSS durchgereicht werden: Tag 302 hat ruleOfX um die data-learned
// Klemmung erweitert und score.js:132 reicht sie an die ACHSE durch — die Anzeige
// hier tat es nicht und zeigte dadurch dieselbe Kennzahl ungeklemmt (R-Gate 2.R,
// Fund F6-1: 131 Namen wichen ab, JOBY 90121 statt 1048, 25 davon in Top-100-Boards).
// Ohne Bounds (Aufruf aus Tests/Tools) bleibt das Verhalten wie zuvor: ungeklemmt.
function ruleOfXCompanion(s, growthBounds) {
  return ruleOfX(s, 2.3, true, growthBounds);
}

/** Export shape of an overview period (P267): basis, both ends and a German reason, always all four keys.
 * @param {object|null|undefined} p Full period of the selected pair, or nothing when no pair exists.
 * @returns {{basis:string, periodEnd:string|null, priorPeriodEnd:string|null, reason:string|null}} Label of the value.
 */
function overviewPeriodExport(p) {
  if (!p) return { basis: 'none', periodEnd: null, priorPeriodEnd: null, reason: 'Kein vergleichbares Wertepaar vorhanden.' };
  return { basis: p.basis ?? 'none', periodEnd: p.periodEnd ?? null, priorPeriodEnd: p.priorPeriodEnd ?? null, reason: p.reason ?? null };
}

/**
 * overviewMetric(s, opts) -> { kind, value, companion, period }
 * opts: { gpClass:'real'|'degenerate'|'none', specialTrack:'reit'|'biotech'|null,
 *         growthBounds:[lo,hi]|null }
 * kind: 'gp' | 'revenue-badge' | 'ffo-badge' | 'runway-badge'
 * Non-adjacent annual pairs additionally carry valuePresent:false and reason.
 * P267: gp and revenue-badge carry the period of exactly this value (overviewPeriodExport) in both arms, so
 * score output and writer move value and label as one object; other kinds carry no period.
 */
function overviewMetric(s, opts = {}) {
  const companion = ruleOfXCompanion(s, opts.growthBounds);
  if (opts.specialTrack === 'biotech') {
    return { kind: 'runway-badge', value: cashRunwayQuarters(s), companion };
  }
  const kind = opts.specialTrack === 'reit' ? 'ffo-badge'
    : opts.gpClass === 'degenerate' ? 'revenue-badge' : 'gp';
  // G31 (Karl 11.10.2026, switch built 18.10.2026): GP and the revenue badge show the newest
  // labelled candidate (overviewShadow, its label goes out via the writer). The legacy arm keeps
  // the pre-G31 annual/TTM value below for the comparison export.
  if (g31Variant() && kind !== 'ffo-badge') {
    const { value, period } = overviewShadow(s, kind);
    const metric = { kind, value, companion, period: overviewPeriodExport(period) };
    // P158's marker stays: an empty value whose only annual pair is non-adjacent says so.
    if (value === null && (period.reason === OVERVIEW_YEARS_NOT_ADJACENT_TEXT
        || growthVerdict(s, kind === 'revenue-badge' ? 'annualRev' : kind).withheld)) {
      metric.valuePresent = false;
      metric.reason = OVERVIEW_YEARS_NOT_ADJACENT_TEXT;
    }
    return metric;
  }
  const { value, withheld, period } = growthVerdict(s, kind === 'revenue-badge' ? 'annualRev' : kind);
  const metric = { kind, value, companion };
  if (kind !== 'ffo-badge') metric.period = overviewPeriodExport(period);
  if (withheld) {
    metric.valuePresent = false;
    metric.reason = OVERVIEW_YEARS_NOT_ADJACENT_TEXT;
  }
  return metric;
}

/** Calculate the labelled B4/B5 candidate; overviewMetric shows it under the G31 switch.
 * @param {object|null} s Prepared snapshot.
 * @param {string} kind Existing overview kind.
 * @returns {object|null} Shadow value as a fraction and its period, or null for other kinds.
 */
function overviewShadow(s, kind) {
  if (!['gp', 'revenue-badge'].includes(kind)) return null;
  let verdict = growthVerdict(s, kind === 'gp' ? 'gp' : 'annualRev', true);
  if (kind === 'revenue-badge') {
    const leg = g31Shadow(s).v1;
    const newer = _tagesnummer(leg.sourcePeriodEnd), older = _tagesnummer(leg.sourcePriorPeriodEnd);
    // The overview keeps P158's adjacency rule even while the scoring rule is off.
    const withheld = leg.basis === 'year' ? verdict.withheld
      : leg.basis === 'yearNewerRecord' && newer !== null && older !== null
        && (newer - older < ANNUAL_PAIR_MIN_DAYS || newer - older > ANNUAL_PAIR_MAX_DAYS);
    verdict = { value: withheld || leg.pct === null ? null : leg.current / leg.prior - 1,
      period: { ...periodOf(leg), reason: withheld ? OVERVIEW_YEARS_NOT_ADJACENT_TEXT : leg.reason } };
  }
  return { kind, value: verdict.value, period: verdict.period || {
    basis: 'none', periodEnd: null, priorPeriodEnd: null, sourcePeriodEnd: null, sourcePriorPeriodEnd: null,
    label: 'Zeitraum nicht verfügbar', reason: 'Kein vergleichbares Wertepaar vorhanden.' } };
}

module.exports = {
  overviewMetric, overviewShadow, overviewPeriodExport, grossProfitGrowthYoY, ffoProxyGrowthYoY,
  cashRunwayQuarters, ruleOfXCompanion, yoyAnnual,
  OVERVIEW_YEARS_NOT_ADJACENT_TEXT,
};

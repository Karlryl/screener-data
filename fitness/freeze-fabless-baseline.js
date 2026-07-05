#!/usr/bin/env node
/**
 * freeze-fabless-baseline.js — pre-register the shipped fabless_semi v5.2 ranking for forward-fitness.
 *
 * Friert das fabless_semi-Ranking (durability v3 PASS, Commit 2fca2b2d2) am Ship-Tag ein, damit „besser"
 * später kalendarisch (forward, ~2026-07-14 28d / ~2026-09-08 84d) gegen DIESE Referenz gemessen werden kann.
 * Anti-Gaming: Ranking VOR jeder weiteren Änderung eingefroren; das Forward-Fenster ist ein intrinsischer Holdout.
 * Analog fitness/baselines/saas-v1.0-degraded-2026-06-16.json (Iteration 1, Eintrag 7).
 *
 * Deterministisch (FROZEN_AT hardcodiert). Quelle: outputs/court-results.json :: fabless_semi + prices/history.json.
 * Schreibt fitness/baselines/fabless-v5.2-2026-06-17.json. KEIN Scoring-Change -> kein Court (Mess-Artefakt).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

const FROZEN_AT = '2026-06-17'; // Ship-Tag durability v5.2 (Commit 2fca2b2d2). Deterministisch, kein new Date().
const OUT = path.join(__dirname, 'baselines', 'fabless-v5.2-2026-06-17.json');

const results = JSON.parse(fs.readFileSync(path.join(ROOT, 'outputs', 'court-results.json'), 'utf8'));
const F = results.fabless_semi;
if (!F || !Array.isArray(F.members)) { console.error('fabless_semi bucket missing in court-results.json'); process.exit(1); }

const ranked = F.members.slice().sort((a, b) => b.score - a.score || a.ticker.localeCompare(b.ticker));
const ranking = ranked.map((m, i) => ({
  rank: i + 1, ticker: m.ticker, score: m.score,
  membershipClass: m.membershipClass || null,
  durSource: m.durSource || null, durWinN: m.durWinN != null ? m.durWinN : null,
  axisS: m.axisS,
}));
const evaluatedTickers = ranked.map(m => m.ticker);

// t0 price anchors: letzter Close <= FROZEN_AT je Ticker (robust gegen spätere history.json-Änderungen).
const hist = JSON.parse(fs.readFileSync(path.join(ROOT, 'prices', 'history.json'), 'utf8'));
const anchorClose = t => {
  const s = hist[t]; if (!Array.isArray(s) || !s.length) return null;
  let best = null;
  for (const p of s) { if (p && p.date && p.date <= FROZEN_AT && p.close != null) { if (!best || p.date > best.date) best = p; } }
  return best ? { date: best.date, close: best.close } : null;
};
const priceAnchors = {};
for (const t of [...evaluatedTickers, 'SPY', 'QQQ', 'IWM', 'SOXX', 'SMH']) priceAnchors[t] = anchorClose(t);
const missing = evaluatedTickers.filter(t => !priceAnchors[t]);

const baseline = {
  baselineId: 'fabless-v5.2-2026-06-17',
  frozenAt: FROZEN_AT,
  formula: 'fabless_semi v5.2 — Growth(.35,k2.5) · GM(.25,k1.0) · Durability-v3(.25,k1.0: quarterly recency-weighted COUNT-below downside-drawdown, scale-norm) · Accel(.15,k2.0). KILL active (8 Member), durSource sec-quarterly. Commit 2fca2b2d2. Konstanten [TODO-CAL].',
  source: 'outputs/court-results.json :: bucket fabless_semi',
  degraded: false,
  degradedNote: null,
  universeSize: F.universeSize,
  collapseSpearman: F.collapseSpearman != null ? F.collapseSpearman : null,
  rhoDomAxisDurability: F.rhoDomAxisDurability != null ? F.rhoDomAxisDurability : null,
  priceAnchorStatus: missing.length
    ? `PARTIAL — fehlende t0-Preise: ${missing.join(',')}`
    : `CAPTURED — t0-Close je Ticker eingefroren (prices/history.json, neueste 2026-06-12/15). Forward-Return = close[t0+h]/close[t0]-1. 28d ~2026-07-14, 84d ~2026-09-08.`,
  preRegistration: {
    metric: ['rank_ic_spearman', 'top_n_minus_universe_median_fwd_return'],
    horizonsDays: [28, 84],
    survivorshipKey: 'evaluatedTickers',
    antiGaming: 'Ranking am Ship-Tag (vor jeder weiteren Fabless-Änderung) eingefroren. Forward-Fenster = intrinsischer Holdout. Erzeugende Agenten dürfen NIE auf dem Eval-Slice tunen. Eine neue Fabless-Version gilt nur als „besser", wenn sie diese Forward-Metrik STRIKT schlägt.',
    honestLimitation: 'N=8 ist SEHR klein — Rank-IC/Kohorten-Spread haben nur RICHTUNGS-Aussagekraft, geringe statistische Power (SE(IC)≈0.35). Kein Einzel-Vintage-„besser"-Claim. Primärer Wert: (1) Pre-Registration-Disziplin, (2) Beitrag zur GEPOOLTEN Cross-Formel-Fitness (Spec §6). SaaS-Baseline = analoge zweite Referenz.',
  },
  anchors: F.anchors,
  anchorsDurabilityNote: 'Durability-Anker (median/MAD) sind v3-spezifisch (median(gW)−downsideDrawdown über W=12 SEC-Quartals-YoY); bei Achsen-/Konstanten-Änderung neu einfrieren.',
  ranking,
  evaluatedTickers,
  priceAnchors,
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(baseline, null, 2));
console.log('Wrote', OUT);
console.log('frozenAt', FROZEN_AT, '| universeSize', baseline.universeSize, '| priceAnchorStatus:', baseline.priceAnchorStatus.split('—')[0].trim());
console.log('ranking:', ranking.map(r => r.rank + '.' + r.ticker + '(' + r.score + ')').join(' '));
console.log('priceAnchors:', evaluatedTickers.map(t => t + ':' + (priceAnchors[t] ? priceAnchors[t].date : 'NULL')).join(' '));
if (missing.length) console.log('WARN missing t0 prices:', missing.join(','));

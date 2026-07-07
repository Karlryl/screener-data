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

const { norm, metricVal, firstPresent, presentValues, firstTwoPresent } = require('./snapshot.js');
const { q, weightedScore, coverageWeight, signTrack, fcfTrack } = require('./engine.js');
const { route, isUS, isUsPrimaryListing } = require('./router.js');
const { evaluateLamps, burnPressFactor } = require('./lamps.js');
const { overviewMetric } = require('./overview.js');
const { normalizeCountry } = require('./country.js');
const axesFns = require('./axes.js');
const { profitTierOf } = require('./profit-tier.js'); // Task 1.2: 4-Stufen-Profitabilitaets-Filter (deskriptiv)
// audit/fix (Court Fall 6, F39): Grader fuer die LIVE-Neuberechnung des Daten-Grades im
// data-suspect-Gate. Der persistierte _quality.grade ist stale (alle aus der Zeit VOR dem
// revenueTTM-criticalMissing-Floor) -> der grade-D-Arm war praktisch tot.
const { gradeSnapshot, GRADE_THRESHOLDS } = require('../../methods/data-quality.js');

const tickerOf = (s) => (s && s.meta && s.meta.ticker) || (s && s.identifier && s.identifier.value) || '?';

// audit/fix (Court Fall 7, F37): locale-/ICU-unabhaengiger Ticker-Tie-Break. localeCompare haengt
// von der OS-Locale ab (CI-ubuntu != lokal-Windows/de-DE) -> untergraebt den dokumentierten
// CI==lokal-Determinismus. Code-Unit-Vergleich (< / >) ist deterministisch und plattform-stabil.
const cmpTicker = (x, y) => (x < y ? -1 : x > y ? 1 : 0);

// --- Issuer-Dedup-Helfer (Modulebene, damit calibrate.js dieselben Gates spiegelt) ---
// Normalisierter Emittenten-Schluessel (meta.name); null wenn kein Name.
const issuerKey = (s) => {
  const n = s && s.meta && s.meta.name;
  return (typeof n === 'string' && n.trim()) ? n.toLowerCase().replace(/\s+/g, ' ').trim() : null;
};
const mcapOf = (s) => (s && s.marketCap && Number.isFinite(s.marketCap.value)) ? s.marketCap.value : 0;
// audit/fix (Court Fall 10, F50): ein dual-non-USD-Bein, dessen marketCap mit dem REPORTING- statt
// dem TRADING-FX-Faktor skaliert wurde (stale Snapshot ohne tradingFxRateApplied), traegt eine
// untrustworthy marketCap -> im Dedup-Tie-Break deprioritisieren. Konjunktion (ccy-Divergenz UND
// fehlender FX-Faktor), nicht reine Abwesenheit -> beruehrt kein FX-konsistentes/USD-primaeres Bein.
const fxSuspect = (s) => {
  const m = s && s.meta;
  if (!m) return false;
  const tc = m.tradingCurrency, rc = m.reportingCurrencyOriginal;
  return !!(tc && rc && String(tc).toUpperCase() !== String(rc).toUpperCase() && m.tradingFxRateApplied == null);
};
// audit/fix (Bug 7): Dedup-Sortierschluessel. ERSTER Schluessel ist isUsPrimaryListing (LISTING-Check:
// US-Primaerboerse, kein Auslands-Suffix), NICHT das domizil-basierte isUS. Ein Toronto-Bein mit
// country='United States' bekam sonst denselben isUS=1-Rang wie das NYSE-Bein, und fxSuspect
// deprioritisierte danach ausgerechnet das echte US-Primaerbein (GFL vs GFL.TO). Danach isUS
// (Domizil), fxSuspect, marketCap, Ticker-Tie-Break. Erwartet: GFL schlaegt GFL.TO; BAM/CMOC unveraendert.
function issuerDedupComparator(a, b) {
  const pa = isUsPrimaryListing((a.snapshot && a.snapshot.meta) || {}) ? 1 : 0;
  const pb = isUsPrimaryListing((b.snapshot && b.snapshot.meta) || {}) ? 1 : 0;
  if (pa !== pb) return pb - pa;                        // US-PRIMAER-gelistetes Bein zuerst (Listing, nicht Domizil)
  const ua = isUS(a.snapshot) ? 1 : 0, ub = isUS(b.snapshot) ? 1 : 0;
  if (ua !== ub) return ub - ua;                        // dann US-Domizil
  const fa = fxSuspect(a.snapshot) ? 1 : 0, fb = fxSuspect(b.snapshot) ? 1 : 0;
  if (fa !== fb) return fa - fb;                        // FX-suspekte marketCap deprioritisieren (vertrauenswuerdig zuerst)
  const ma = mcapOf(a.snapshot), mb = mcapOf(b.snapshot);
  if (ma !== mb) return mb - ma;                        // dann groesste marketCap
  return cmpTicker(a.ticker, b.ticker);                 // dann stabiler Ticker-Tie-Break (deterministisch)
}

// A4 (Weltweit-Pivot): DISQUALIFIZIERENDE Daten-Qualitaets-Signale. Ein Name mit einer
// data-suspect-Lampe (newestQtrSuspect/annualCurrencyLeak — erfundenes/geleaktes Quartal bzw.
// annual-currency-Leak) ODER snapshot _quality.grade='D' wird aus dem Ranking EXCLUDIERT, sonst
// koennte ein Auslandsname auf fabriziertem Wachstum #1 werden. Die uebrigen 10 Lampen sind reine
// Timing-Warnungen und excludieren NICHT (BE/PLTR ranken trotz Lampe oben).
const DATA_SUSPECT_LAMPS = ['newestQtrSuspect', 'annualCurrencyLeak'];
function isDataSuspect(s, lampsActive, action) {
  // Fabrikations-Lampen (erfundenes Quartal / annual-currency-Leak) gelten fuer ALLE Tracks.
  if (lampsActive.some((l) => DATA_SUSPECT_LAMPS.includes(l))) return true;
  // audit/fix (Court Fall 6, F39): Grade LIVE neu rechnen statt dem persistierten _quality.grade zu
  // trauen (alle gespeicherten Grades stammen von VOR dem criticalMissing-Floor commit b04e24d3bf
  // 2026-06-25 -> der D-Arm matchte 0 Snapshots). gradeSnapshot arbeitet deterministisch auf bereits
  // vorhandenen Snapshot-Feldern (KEIN Re-Pull); criticalMissing floort grade='D' bei fehlender
  // marketCap ODER metrics.revenueTTM.
  // WICHTIG (Court-Intent: nur action=route gemessen): der grade-D-Floor gilt NUR fuer route. Der
  // survival-Track ist DEFINITIONSGEMAESS pre-revenue (kein revenueTTM -> immer criticalMissing) —
  // ihn dem Floor zu unterwerfen wuerde ~70 legitime Pre-Revenue-Biotechs aus dem survival-Runway-
  // Board kicken (survival 77->7). Fabrikation faengt fuer survival weiter ueber die Lampen oben.
  if (action !== 'route') return false;
  if (!s || typeof s !== 'object') return false;
  const g = gradeSnapshot(s);
  if (g.grade !== 'D') return false;
  // audit/fix (Court R3 C3): den revenueTTM-Arm des criticalMissing-Floors vom data-suspect-Gate
  // ENTKOPPELN. Der grade-D-Floor (criticalMissing = marketCap ODER metrics.revenueTTM fehlt) hat 22
  // scorebare Real-Umsatz-Namen (VFS Rang #1, ERIC A+, +Biotechs) exkludiert, obwohl die Achsen
  // annual.annualRev / metrics.revenueGrowthYoY lesen, NICHT revenueTTM. Hier (NUR route-Konsumtion,
  // der persistierte DQ-Grade bleibt unveraendert):
  // audit/fix (Bug 22): Sparsity-D (nanRatio > C-Schwelle) IMMER excludieren — VOR dem criticalMissing-
  // Entkopplungspfad. Koexistieren nanRatio>0.85 UND fehlendes revenueTTM, sprang der Code sonst in den
  // Entkopplungs-Arm und liess bei vorhandener marketCap + positivem Umsatz den Daten-Muell-Namen durch.
  // Court R3 C3 (revenueTTM-Envelope-Entkopplung) bleibt erhalten; nur der Sparsity-Arm wird vorgezogen.
  if (g.nanRatio > GRADE_THRESHOLDS.C) return true;
  if (!g.criticalMissing) return true;                                  // D wegen echter Sparsity (nanRatio) -> exclude
  if (!(s.marketCap && Number.isFinite(s.marketCap.value))) return true; // marketCap fehlt -> harter Ausschluss (Identitaet/Bewertung)
  // criticalMissing nur wegen fehlendem revenueTTM-Envelope: nur ausschliessen, wenn auch der
  // AKTUELLE Umsatz fehlt (sonst echte Real-Umsatz-Namen, die nur das TTM-Envelope nicht tragen).
  return !hasCurrentRevenue(s);
}

// audit/fix (Court R3 C3): "aktueller Umsatz present" anhand der Felder, die die Achsen TATSAECHLICH
// lesen (annualRev / revenueQ). audit/fix (Court R5 B): STRIKT das neueste GJ (annualRev[0]) present-
// und->0 — NICHT firstPresent (das ueberspringt eine fuehrende null-Luecke und akzeptierte einen STALEN
// Altwert: RTEZ [null,5000,null,519443] -> der 2 GJ alte 5000 zaehlte faelschlich als 'aktuell').
// ODER irgendein present revenueQ > 0. Schliesst echte Null-aktuell-Umsatz-Namen (DNLI/AMLX/…) korrekt
// aus, laesst VFS/ERIC/Biotechs-mit-Fruehumsatz durch.
function hasCurrentRevenue(s) {
  const ar = norm(s, 'annualRev');
  const a0 = ar.length ? ar[0] : null;
  if (a0 !== null && a0 !== undefined && a0 > 0) return true;
  return presentValues(norm(s, 'revenueQ')).some((v) => v > 0);
}

// Roh-Achsenwert (ruleOfX braucht alpha + includeFcf am ECHTEN FCF-Vorzeichen).
// audit/fix (Court R3 C2): die zwei near-zero-Nenner-anfaelligen Quartals-Achsen
// (marginTrajectory/revAcceleration) erhalten die universe-weit gelernten Winsor-
// Schranken (winsorBounds), damit Stub-Quartale keine Phantom-Extreme pinnen.
function rawAxisValue(s, key, formula, track, winsorBounds) {
  if (key === 'ruleOfX') {
    // includeFcf am tatsaechlichen FCF-Vorzeichen koppeln, NICHT am erzwungenen
    // 'profitable'-Label der none-Branchen (sonst FCF-Penalty fuer cash-negative
    // Namen im einen Track -> Iron-Rule 2).
    const includeFcf = fcfTrack(metricVal(s, 'fcfMarginTTM'), norm(s, 'annualFCF'), norm(s, 'annualOCF')) === 'profitable';
    return axesFns.ruleOfX(s, formula.alpha, includeFcf);
  }
  if (key === 'marginTrajectory') return axesFns.marginTrajectory(s, winsorBounds && winsorBounds.opMargin);
  if (key === 'revAcceleration') return axesFns.revAcceleration(s, winsorBounds && winsorBounds.qoq);
  const fn = axesFns[key];
  return typeof fn === 'function' ? fn(s) : null;
}

// audit/fix (Court R3 C2): universe-weite Winsor-Schranken (data-learned). Die Tail-FRAKTION
// WINSOR_TAIL ist ein benannter Robustifizierungs-Parameter (keine Magic Number auf der Achse).
// audit/fix (Court R5 A): die OBERE opMargin-Schranke ist NICHT data-learned p99, sondern ein
// oekonomisch begruendeter Deckel 1.0. Der OPERATIVE Kern erfuellt opMargin = opIncQ/revenueQ <= 1
// (opInc = Rev - COGS - opex, COGS+opex>=0). audit/fix (Court R6-Praezision): das ist KEIN striktes
// physisches Gesetz auf REPORTED OpInc — bei REITs/Royalty fliessen Gains/Equity-Income in OpInc,
// waehrend 'revenue' nur die Mietzeile ist (VICI 1.075/RPRX 1.003/TPZ.TO 1.153, ~12/14845 Samples
// legit >1). 1.0 ist daher ein DATEN-PLAUSIBLER Robustifizierungs-Deckel: er faengt die >>1-Stub-
// Artefakte (300251.SZ=16.06) und laesst die seltenen legit-1.0..1.3-REITs nur minimal geklemmt
// (VICI marginTraj-Perzentil 99.68->97.77, Score unveraendert, kein Rang/Exclude-Flip) — deutlich
// kleinere Verzerrung als der frueher symmetrische p99 (~0.677), der legitime 68-100%-Margen auf 0
// nullte. Untere opMargin-Schranke bleibt data-learned p1 (faengt JOBY=-9991-Stubs). qoq-Raten
// BLEIBEN symmetrisch (kein Umsatz-Multiplikator-Deckel; das +1503-Stub-Artefakt liegt korrekt auf p99).
const WINSOR_TAIL = 0.01;
const OPMARGIN_CAP = 1.0; // oekonomisch-plausibler Deckel (opInc-Kern <= Umsatz), keine Magic Number, kein striktes physisches Gesetz
// AUFGABE 2 (Ranking-Wachstums-Bonus, Court-approbiert 2026-07-02): der EINE benannte Robustifizierungs-
// Parameter fuer den AUFWAERTS-Wachstums-Bonus, in Reihe mit WINSOR_TAIL=0.01 / OPMARGIN_CAP=1.0. Der Bonus
// ist multiplikativ: factor = 1 + k*max(0, 2*pctl-1), pctl in [0,1] -> Faktor in [1, 1+k], strukturell NIE
// < 1 (kein Anker/0-Basis-Name faellt). ABOVE-MEDIAN (2*pctl-1): unter-Median-Wachser (inkl. Schrumpfer)
// bekommen EXAKT 1.0 -> ein Schrumpfer ueberholt NIE einen 0-Basis-Namen allein durch den Bonus-Spread.
// k=0.05 (max +5% am Perzentil-Deckel): Winsor ist data-learned (p1/p99), Median parameterfrei, Perzentil
// self-scaling -> k ist der EINZIGE freie Scoring-Parameter, bewusst klein. Der EINE Stellhebel: hebt starke
// Wachser (ALAB) sichtbar, ohne einen reifen Compounder ueber ALAB zu ziehen (Direktive 4). NIE auf einen
// Ziel-Rang data-fitten (waere ein aufgezwungenes Niveau = Invariante-3-Verletzung).
const GROWTH_BOOST_K = 0.05;
// Degenerations-Guard (KEIN Scoring-Hebel, nur Ein/Aus): ein Perzentilrang ueber zu WENIGE distinkte
// Wachstums-Werte ist Rauschen (Winsor-Deckel-Plateaus + Float-Jitter machen min!==max und wuerden sonst
// einem Einzel-Name einen Phantom-Vollrang geben = Falsch-Entdeckung, Inv. 4/7). Unter dieser Distinct-
// Schwelle -> kein Bonus (alle Faktoren exakt 1.0). Konservativ: das reale 3000+-Namen-Universum liegt
// weit darueber, der Guard greift nur in degenerierten/Test-Verteilungen.
const GROWTH_MIN_DISTINCT = 10;
// PHASE 3 (Zyklus-Daempfer, Council/Court-geplant 2026-07-02): Direktive-4-Root-Fix. Zyklische/reife Namen
// (Memory-Semis: Micron, SK Hynix) ranken sonst ueber echtes Hypergrowth (ALAB). Ein data-learned
// KONJUNKTIONS-Detektor (Gewinn-Oszillation UND Umsatz-Drawdown) daempft NUR sie, strukturell OHNE die
// Anker zu treffen (NVDA hat 0 Vorzeichenflips -> osc=0 -> Faktor exakt 1.0; CRDO/ALAB/BE = 1 Flip = EINE
// Inflection = free durch die -1). KD ist der EINE benannte Parameter (analog GROWTH_BOOST_K); NIE auf MUs
// Ziel-Rang gefittet — kleinster Wert, der MU/SK-Hynix am vollen Lauf unter ALAB bringt. Die DD-Schwelle
// ist data-learned (p75 der universums-weiten Drawdown-Verteilung), KEIN hartkodiertes Niveau (Inv. 3).
const CYCLE_DAMPER_KD = 0.5;
const CYCLE_DD_PCTL = 0.75;      // data-learned Drawdown-Schwelle = p75 (gemessen ~0.16: haelt SK-Hynix 0.266 drin, MRVL 0.07/ASM 0.01 draussen)
const CYCLE_MIN_DISTINCT = 10;   // Degenerations-Guard analog GROWTH_MIN_DISTINCT (zu wenige distinkte DD -> Schwelle null -> alle Faktoren 1.0)
function quantile(samples, p) {
  const a = samples.filter(Number.isFinite).sort((x, y) => x - y);
  if (!a.length) return null;
  const idx = (a.length - 1) * p;
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  return lo === hi ? a[lo] : a[lo] + (a[hi] - a[lo]) * (idx - lo);
}
function winsorTailBounds(samples) {
  const lo = quantile(samples, WINSOR_TAIL), hi = quantile(samples, 1 - WINSOR_TAIL);
  return (lo === null || hi === null) ? null : [lo, hi];
}

// audit/fix (Bug 0): universe-weite Winsor-Schranken (opMargin/qoq) aus einer Snapshot-Liste
// lernen — EINE gemeinsame Quelle fuer scoreUniverse UND buildCalibMatrix (calibrate.js), damit
// die Kalibrier-Matrix die Produktions-Perzentile von marginTrajectory/revAcceleration exakt
// spiegelt. Court R5 A: opMargin-Obergrenze = oekonomischer Deckel OPMARGIN_CAP, qoq symmetrisch.
function learnWinsorBounds(snapshots) {
  const opmSamples = [], qoqSamples = [];
  for (const s of (Array.isArray(snapshots) ? snapshots : [])) {
    for (const v of axesFns.quarterOpMargins(s)) opmSamples.push(v);
    for (const v of axesFns.quarterQoQRates(s)) qoqSamples.push(v);
  }
  const opmTail = winsorTailBounds(opmSamples);
  return {
    opMargin: opmTail ? [opmTail[0], OPMARGIN_CAP] : null,
    qoq: winsorTailBounds(qoqSamples),
  };
}

// --- AUFGABE 2: Wachstums-Bonus (rein additiv-multiplikativer AUFWAERTS-Faktor) ---
// Zwei TIEFEN-UNSENSITIVE YoY-Beine einer Aktie (EDGAR-A/B-invariant fuer den annual-Teil):
//  - annual-lag1: firstTwoPresent(annualRev) -> ar[0]/ar[1]-1 (2 neueste present, luecken-sicher).
//  - quartal-lag4 POSITIONAL: revenueQ[0]/revenueQ[4]-1 (Muster lamps.js). Verlangt 5 FINITE Fuehrungs-
//    Quartale (rev[0..4]): eine interne null-Luecke wuerde Index 4 vom year-ago-Quartal wegschieben ->
//    dann Bein droppen, annual-lag1 traegt. EHRLICHE GRENZE: revenueQ traegt nur {value}, KEIN Perioden-
//    Enddatum -> eine KOMPLETT fehlende Quartals-Row (ohne null-Platzhalter) ist nicht detektierbar; die
//    5-finite-Regel SETZT regelmaessige Provider-Kadenz VORAUS (Live-Scan aller Snapshots: 0 solche Luecken).
//    Die robuste datums-basierte Ausrichtung wuerde snapshot.js/FIELD_REGISTRY beruehren (Brief verbietet es)
//    -> dokumentiertes Rest-Risiko, kein aktiver Defekt. div0-Skip: Nenner STRIKT > 0 (0 UND negativ = Stub/Glitch).
function growthYoYComponents(s) {
  const comps = [];
  const ar = firstTwoPresent(norm(s, 'annualRev'));
  if (ar && ar[1] > 0) { const g = ar[0] / ar[1] - 1; if (Number.isFinite(g)) comps.push(g); }
  const rq = norm(s, 'revenueQ');
  if (rq.length >= 5 && rq.slice(0, 5).every(Number.isFinite) && rq[4] > 0) {
    const g = rq[0] / rq[4] - 1; if (Number.isFinite(g)) comps.push(g);
  }
  return comps; // 0..2 Werte
}

// robustG einer Aktie = Median der COMPONENT-winsorisierten YoY-Komponenten. Der Component-Winsor VOR
// dem Median IST der HBNB/NBIS-Fix (klemmt eine Mini-Basis-/korrupte Komponente auf die data-learned
// Schranken p1/p99 BEVOR gemittelt wird). EHRLICH: bei <=2 Komponenten ist quantile(.,0.5) das
// arithmetische Mittel — der Fix ist der Winsor, NICHT der "Median" (bei n=1 heilt der Median nichts).
// growthBounds fehlt -> Winsor = identity (kein Crash). leer -> null.
function robustG(s, growthBounds) {
  const comps = growthYoYComponents(s);
  if (!comps.length) return null;
  const w = growthBounds
    ? comps.map((v) => Math.max(growthBounds[0], Math.min(growthBounds[1], v))) // inline clampWinsor (axes.js:55 nicht exportiert)
    : comps;
  return quantile(w, 0.5);
}

// Perzentil -> AUFWAERTS-Faktor. ABOVE-MEDIAN: unter-Median (pctl<0.5) -> max(0,·)=0 -> Faktor EXAKT 1.0
// (kein relativer Abwaerts-Effekt gegen 0-Basis-Namen); starke Wachser rampen linear auf 1+k. Faktor
// strukturell in [1, 1+k], nie < 1. Der Math.min(1,·)-Deckel macht die [1,1+k]-Obergrenze UNABHAENGIG von
// der Loop-Invariante "pctl in [0,1]" wahr — auch fuer einen exportierten Standalone-Aufruf mit einem
// out-of-distribution-pctl>1 (byte-identisch im Prod-Pfad, wo pctl ohnehin <=1). NaN/kein-pctl -> literal 1.
function boostFromPctl(pctl) {
  if (!Number.isFinite(pctl)) return 1;
  return 1 + GROWTH_BOOST_K * Math.max(0, Math.min(1, 2 * pctl - 1));
}

// Universums-globale, self-scaling Perzentil-Funktion ueber die robustG-Verteilung der gerouteten Namen.
// NaN-sicher (filtert intern auf finite). Degenerations-Guard: <2 finite ODER <GROWTH_MIN_DISTINCT distinkt
// ODER kompletter Tie (min===max) -> null -> alle Faktoren exakt 1.0 (byte-identisch). pctl = (Anzahl
// strikt < g)/(n-1): strikt-< + /(n-1) gibt Winsor-Deckel-Ties den GEMEINSAMEN unteren Rang (Inv. 4/7).
function growthPctlFn(gSorted) {
  const finite = gSorted.filter(Number.isFinite).sort((a, b) => a - b);
  const n = finite.length;
  if (n < 2 || finite[0] === finite[n - 1]) return null;
  if (new Set(finite).size < GROWTH_MIN_DISTINCT) return null;
  return (g) => {
    let lo = 0;
    for (const x of finite) { if (x < g) lo++; else break; } // finite aufsteigend -> early-break korrekt
    return lo / (n - 1);
  };
}

// Standalone-Faktor (fuer TDD des leer/neutral-Pfads). Im scoreUniverse-Loop wird der Faktor inline aus
// dem robustG-Cache gerechnet (kein zweites robustG); beide Wege sind byte-identisch.
function growthBoostFactor(s, growthBounds, pctlFn) {
  const g = robustG(s, growthBounds);
  if (g === null || pctlFn === null || pctlFn === undefined) return 1;
  return boostFromPctl(pctlFn(g));
}

// --- PHASE 3: Zyklus-Daempfer (data-learned Konjunktions-Detektor, kein axes.js/FIELD_REGISTRY-Touch) ---
// Bein 1 (Oszillation): Vorzeichen-WECHSEL zwischen aufeinanderfolgenden NICHTNULL present OpInc-Jahren.
// 0-Jahre (Break-even/Lead-0-Stub) uebersprungen -> kein Phantom-Flip.
function signFlips(op) {
  let f = 0, prev = null;
  for (const v of op) {
    if (v === 0) continue;
    const g = v > 0 ? 1 : -1;
    if (prev !== null && g !== prev) f++;
    prev = g;
  }
  return f;
}
// oscExcess = max(0, signFlips - 1). Die -1 ist die STRUKTURELLE Inflection-Freistellung: flips<=1 (96.4% des
// Universums = monoton ODER einmal gedreht = CRDO/ALAB/BE/PLTR-Archetyp) -> 0; flips>=2 (oszillierend) -> >=1.
const oscExcess = (op) => Math.max(0, signFlips(op) - 1);

// Bein 2 (Umsatz-Drawdown): max (peak-trough)/peak, chronologisch, NUR present-und-POSITIVE Umsatzjahre.
// Das >0-Filter heilt Einzel-0/negativ-Jahr-Glitches (Fonds-/Yandex-Artefakt) -> kein Phantom-100%-Drop.
function revMaxDrawdown(rev) {
  const chron = presentValues(rev).slice().reverse().filter((v) => v > 0);
  if (chron.length < 2) return 0;
  let peak = -Infinity, dd = 0;
  for (const v of chron) { if (v > peak) peak = v; if (peak > 0) dd = Math.max(dd, (peak - v) / peak); }
  return dd;
}
// PHASE 4 (Refresh-Robustheit): normSec liest die COMMITTETE tiefe SEC-Serie (snapshot.secAnnual, {value}[],
// von run-screener.js mergeSecIntoUniverse aus external-data/sec-secannual.json angehaengt) als PLAIN-NUMBER-
// Serie (norm-Format). null -> cycleSeries faellt auf norm() zurueck. Inline-toFinite (kein snapshot.js-Touch).
function normSec(s, field) {
  const raw = s && s.secAnnual && s.secAnnual[field];
  if (!Array.isArray(raw) || raw.length === 0) return null;
  return raw.map((e) => { const v = (e && typeof e === 'object') ? e.value : e; return Number.isFinite(v) ? v : null; });
}
// cycleSeriesPair: liefert BEIDE Daempfer-Beine (op, rev) aus EINER kohaerenten Quelle. secAnnual (tief) NUR
// wenn BEIDE Felder present-tief >= Yahoo sind, sonst fuer BEIDE Yahoo-4J. KOHAERENZ-ZWANG: sonst koennten
// Oszillations-Bein (Yahoo-4J) und Drawdown-Bein (SEC-11J) aus verschiedenen Zeittiefen stammen und ein
// Zyklus-Signal aus zeitlich unverbundenen Fenstern erfinden (Verify-Befund CC). Laengen-Guard je Feld gegen
// spaet-startende SEC-Filer. signFlips/revMaxDrawdown sind vorzeichen-/verhaeltnis-basiert -> robust gegen
// SEC-vs-Yahoo FY-Versatz + Level-Restatement. Kein secAnnual -> Yahoo (byte-identisch zum 4J-Verhalten).
function cycleSeriesPair(s) {
  const opY = presentValues(norm(s, 'annualOpInc'));
  const revY = presentValues(norm(s, 'annualRev'));
  const opS = normSec(s, 'annualOpInc'), revS = normSec(s, 'annualRev');
  const opSP = opS ? presentValues(opS) : null;
  const revSP = revS ? presentValues(revS) : null;
  // ZEITFENSTER-Alignment (Verify CEVA/COHU): BEIDE Felder muessen am NEUESTEN Jahr (Index 0) present sein.
  // Sonst kollabieren presentValues(op) und presentValues(rev) bei einem null-Prefix in NUR einem Feld auf
  // DISJUNKTE Kalenderfenster (neue Oszillation vs alter Drawdown) = Zeit-Misch-Signal (Inv. 4/5). -> Yahoo-Fallback.
  const useSec = opSP && revSP && opSP.length >= opY.length && revSP.length >= revY.length
    && opS[0] !== null && revS[0] !== null;
  return useSec ? { op: opSP, rev: revSP } : { op: opY, rev: revY };
}
// KONJUNKTION: feuert NUR wenn Oszillation UND echter Umsatzkollaps. >=3 present OpInc-Jahre (junge IPO nie
// gedaempft). osc-Gate ZUERST (NBIS osc=0 kann nie ueber das DD-Bein feuern). Datenmuell-Guard: ein rev<=0-
// Jahr (Fonds-/Buchungsartefakt) -> Signal 0 (konservativ). ddThreshold null (Degeneration) -> 0. BEIDE Beine
// aus DERSELBEN cycleSeriesPair-Quelle (sec-bevorzugt, tief) -> refresh-robust + kohaerent.
function cycleSignal(s, ddThreshold) {
  const { op, rev } = cycleSeriesPair(s);
  if (op.length < 3) return 0;
  if (oscExcess(op) < 1) return 0;
  if (rev.some((v) => v <= 0)) return 0;                     // Datenmuell-Guard (negatives/0-Umsatzjahr)
  if (ddThreshold === null || revMaxDrawdown(rev) < ddThreshold) return 0;
  return oscExcess(op);                                      // self-scaling mit der Flip-Zahl
}
// Daempfer 1/(1+kd*signal) in (0,1]; signal=0 -> Faktor EXAKT 1.0 (byte-identisch).
const cycleDamperFactor = (s, ddThreshold) => 1 / (1 + CYCLE_DAMPER_KD * cycleSignal(s, ddThreshold));

// Track-Zuordnung gemaess splitMetric der Branchen-Formel.
function trackOf(s, formula) {
  let t;
  switch (formula.splitMetric) {
    case 'FCF':
      t = fcfTrack(metricVal(s, 'fcfMarginTTM'), norm(s, 'annualFCF'), norm(s, 'annualOCF'));
      break;
    case 'OpInc': {
      const opInc = norm(s, 'annualOpInc');
      t = signTrack(opInc);
      // audit/fix (Court Fall 3, F5+F27): leeres annualOpInc -> signTrack='unknown' -> NICHT
      // blind zum konservativen profitable-Default unten; erst auf das NetIncome-Vorzeichen
      // zurueckfallen (architektonisch analog zur fcfTrack OCF-Rescue, engine.js:113-114).
      // WOLF: annualOpInc=[] aber annualNetIncome=[-1.6B,-864M,-330M,-201M] -> unprofitable.
      // audit/fix (Runde 4): die Rescue greift jetzt AUCH bei present-0 neuestem OpInc — ein
      // Lead-0-Stub (601162.SS opInc=[0,-28M,-72M,-71M]) ist Platzhalter/break-even-Ambiguitaet,
      // kein echtes profitable; signTrack(0)='profitable' umging die Rescue. NetIncome entscheidet.
      // Stimmt NetIncome mit profitable ueberein (5 kosmetische Faelle), aendert sich nichts.
      if (t === 'unknown' || firstPresent(opInc) === 0) t = signTrack(norm(s, 'annualNetIncome'));
      break;
    }
    case 'NetIncome': t = signTrack(norm(s, 'annualNetIncome')); break;
    case 'none': default: t = 'profitable'; // Einzel-Formel-Branchen ohne Split
  }
  return t === 'unknown' ? 'profitable' : t; // konservativer Fallback
}

// --- Filter-Schicht (Karl-Direktive 5): rein ADDITIVE, deskriptive Metadata je Output-Zeile ---
// KEIN Score-/Routing-/Track-/Achsen-Einfluss (fixture-safe, Anker rang-invariant). Data-learned,
// keine Magic Numbers: Phase nur ueber Gewinn-Vorzeichen, mcapBand/ipoRecency ueber quantile()-Quintile.

// Gewinn-Serie fuer die Phase: annualOpInc primaer (operativer Kern), annualNetIncome NUR Rescue wenn
// OpInc-Serie leer — analog zum trackOf-Muster. NBIS (OpInc[----], NI[+...] via Yandex-Einmaleffekt)
// bleibt so korrekt 'unprofitable' (operativ), konsistent zum Track. presentValues haelt newest-first-Reihenfolge.
function profitSeries(s) {
  const op = presentValues(norm(s, 'annualOpInc'));
  return op.length ? op : presentValues(norm(s, 'annualNetIncome'));
}
// Profitabilitaets-Phase: established (nie ein Verlustjahr im Fenster) / inflected (juengstes positiv,
// aber ein Verlust davor = gerade gedreht = Karls CRDO/ALAB/BE/PLTR-Archetyp) / unprofitable (juengstes
// negativ) / null (zu wenig Daten). Nur Vorzeichen, KEINE Jahreszahl/Schwelle.
function phaseOf(s) {
  const ser = profitSeries(s);
  if (ser.length < 2) return null;
  if (ser[0] < 0) return 'unprofitable';
  return ser.every((v) => v >= 0) ? 'established' : 'inflected';
}
// Marktkap-Band ueber data-learned Quintil-Grenzen [p20,p40,p60,p80] (keine feste USD-Grenze).
function mcapBandOf(mc, bounds) {
  if (!Number.isFinite(mc) || !bounds) return null;
  if (mc < bounds[0]) return 'micro';
  if (mc < bounds[1]) return 'small';
  if (mc < bounds[2]) return 'mid';
  if (mc < bounds[3]) return 'large';
  return 'mega';
}
// Boersen-IPO-Jahr: meta.ipoYear primaer, sonst Jahr aus meta.firstTradeDate. Deterministisch (fixe
// Snapshot-Daten, KEIN Date.now() -> reproduzierbar/CI-stabil).
function ipoYearOf(meta) {
  if (meta && Number.isFinite(meta.ipoYear)) return meta.ipoYear;
  const d = meta && meta.firstTradeDate;
  if (typeof d === 'string' && d.length >= 4) {
    const y = parseInt(d.slice(0, 4), 10);
    if (Number.isFinite(y)) return y;
  }
  return null;
}
// IPO-Recency ueber data-learned Quintil-Grenzen der ipoYear-Verteilung (recent = neueste IPOs).
function ipoRecencyOf(meta, bounds) {
  const y = ipoYearOf(meta);
  if (!Number.isFinite(y) || !bounds) return null;
  if (y >= bounds[3]) return 'recent';
  if (y >= bounds[2]) return 'growth';
  if (y >= bounds[1]) return 'seasoned';
  if (y >= bounds[0]) return 'mature';
  return 'veteran';
}
// [p20,p40,p60,p80] via bestehendem quantile(); null bei degenerierter Stichprobe (dann Feld null).
function quintileBounds(samples) {
  const b = [0.2, 0.4, 0.6, 0.8].map((p) => quantile(samples, p));
  return b.every((x) => x !== null) ? b : null;
}

function scoreUniverse(snapshots, formulas) {
  const results = [];
  // 1. Routing + Track
  for (const s of (Array.isArray(snapshots) ? snapshots : [])) {
    const r = route(s);
    const lampsActive = evaluateLamps(s).active;
    const base = { ticker: tickerOf(s), snapshot: s, lamps: lampsActive };
    // A4: Daten-Qualitaets-Gate VOR dem Scoring — data-suspect-Namen aus dem Ranking nehmen.
    if ((r.action === 'route' || r.action === 'survival') && isDataSuspect(s, lampsActive, r.action)) {
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
  const issuerGroups = {};
  for (const e of results) {
    if (e.action !== 'route' && e.action !== 'survival') continue;
    const k = issuerKey(e.snapshot);
    if (k) (issuerGroups[k] ||= []).push(e);
  }
  for (const group of Object.values(issuerGroups)) {
    if (group.length < 2) continue;
    group.sort(issuerDedupComparator);                     // audit/fix (Bug 7): US-Primaerlisting zuerst
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
  // audit/fix (Court R3 C2): universe-weite Winsor-Schranken VOR der Achsen-Berechnung lernen —
  // alle per-Quartal-OpMargins / QoQ-Raten der gerouteten Namen sammeln, p1/p99 bilden. Die
  // beiden near-zero-Nenner-anfaelligen Achsen klemmen damit Stub-Quartal-Phantome (data-learned).
  const growthSamples = [], cycleDDSamples = [];
  for (const e of results) {
    if (e.action !== 'route') continue;
    // AUFGABE 2: rohe YoY-Komponenten aller gerouteten Namen fuer die data-learned Wachstums-Winsor-
    // Schranken (p1/p99, gemessen ~[-1.00, 5.18]). Der no-axes-Rest (Z. weiter unten) verzerrt p1/p99
    // nicht nennenswert -> action==='route' hier ist ausreichend (die Anwendungs-BASIS wird spaeter,
    // NACH dem no-axes-Guard, gesammelt, damit Perzentil-Basis == Anwendungs-Basis).
    for (const v of growthYoYComponents(e.snapshot)) growthSamples.push(v);
    // PHASE 3: data-learned Zyklus-Drawdown-Schwellen-BASIS (Basis C, Court-gepinnt gegen die
    // Mehrdeutigkeits-Falle): JEDER geroutete Name mit >=3 present OpInc-Jahren, revMaxDrawdown-Wert
    // INKLUSIVE 0, OSC-UNGEGATET (die volle universums-weite Drawdown-Verteilung). Nur diese Basis
    // ergibt p75~0.16, das SK-Hynix (dd=0.266) DRIN und MRVL (0.07)/ASM (0.01) DRAUSSEN haelt. Eine
    // dd>0- oder osc-gegatete Basis schoebe p75 auf 0.29/0.47 -> SK-Hynix kippt raus -> DONE verfehlt.
    // KOHAERENZ-ZWANG: dieselbe kohaerente sec-bevorzugte Quelle wie cycleSignal misst (sonst p75 auf flacher
    // Yahoo-Verteilung gelernt, aber gegen tiefe DD angewandt = Phantom-Gate).
    const cyc = cycleSeriesPair(e.snapshot);
    if (cyc.op.length >= 3) cycleDDSamples.push(revMaxDrawdown(cyc.rev));
  }
  // Court R5 A: opMargin-Schranke = [data-learned p1, PHYSISCH 1.0]; qoq symmetrisch (data-learned p1/p99).
  // audit/fix (Bug 0): via gemeinsamer learnWinsorBounds — dieselbe Quelle nutzt buildCalibMatrix.
  const winsorBounds = learnWinsorBounds(results.filter((e) => e.action === 'route').map((e) => e.snapshot));
  // PHASE 3: data-learned DD-Schwelle = p75 der universums-weiten Drawdown-Verteilung (Basis C oben).
  // Degenerations-Guard analog GROWTH_MIN_DISTINCT: <CYCLE_MIN_DISTINCT distinkte DD-Werte -> null ->
  // cycleSignal gatet alle Faktoren auf exakt 1.0 (byte-identisch, kein Phantom-Daempfer).
  const cycleDDThreshold = (new Set(cycleDDSamples.filter(Number.isFinite)).size >= CYCLE_MIN_DISTINCT)
    ? quantile(cycleDDSamples, CYCLE_DD_PCTL) : null;
  const growthBounds = winsorTailBounds(growthSamples); // null bei leerer Stichprobe -> robustG-null-Guard faengt
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
      rawByAxis[ax.key] = entries.map((e) => rawAxisValue(e.snapshot, ax.key, formula, track, winsorBounds));
    }
    const cohWcov = new Array(entries.length);
    for (let i = 0; i < entries.length; i++) {
      const axes = formula.axes.map((ax) => {
        let cohort = rawByAxis[ax.key];
        if (profitSign && ax.key === 'capitalEfficiency') {
          cohort = cohort.filter((_, j) => profitSign[j] === profitSign[i]);
        }
        return { value: q(rawByAxis[ax.key][i], cohort), weight: ax.w[track] };
      });
      entries[i].score = weightedScore(axes);   // Basis-Score (renorm-on-drop)
      cohWcov[i] = coverageWeight(axes);         // Achsen-Gewichts-Coverage (C4-Shrinkage-Faktor)
      // 2.13 #23: Coverage AUSWEISEN (nicht verrechnen) — present-Achsen/total + C4-Gewicht je Zeile
      // an den Entry haengen (score-inert, reine Anzeige; round2 ist modul-scope, zur Aufrufzeit da).
      entries[i].coverageAxes = axes.filter((a) => a.value !== null).length + '/' + axes.length;
      entries[i].coverageWeight = round2(cohWcov[i]);
    }
    // audit/fix (Court Phase A Runde 3, Fall C4): Coverage-Shrinkage. renorm-on-drop laesst Namen mit
    // WENIGER present-Achsen eine strukturell HOEHERE Score-Varianz behalten (Mittel ueber k Achsen,
    // Var ~1/k) -> sie ueberbevoelkern die Tails und verdraengen daten-vollstaendige Namen (alle 4
    // Anker 8/8) aus der Spitze = Falsch-Entdeckung (Inv. 4 effektives N + 7 FDR). Jeden Basis-Score
    // Richtung KOHORTEN-MEDIAN schrumpfen, Schrumpf-Faktor = wcov (= das fehlende Achsen-Gewicht,
    // data-learned, KEINE freie Konstante). wcov=1 (8/8) -> Score byte-identisch. KEIN Fake-50:
    // Ziel ist der gelernte Median, renorm-on-drop bleibt darunter erhalten.
    const cohMedian = quantile(entries.map((e) => e.score).filter(Number.isFinite), 0.5);
    if (cohMedian !== null) {
      for (let i = 0; i < entries.length; i++) {
        const e = entries[i];
        if (!Number.isFinite(e.score) || !Number.isFinite(cohWcov[i])) continue;
        if (cohWcov[i] === 1) continue; // 8/8-Achsen: Score EXAKT unveraendert (keine FP-Drift durch die Shrinkage-Arithmetik)
        e.score = cohMedian + cohWcov[i] * (e.score - cohMedian);
      }
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

  // 2b-2. AUFGABE 2: robustG je gerouteten, finite-score Namen EINMAL berechnen + cachen; sortierte
  // Verteilung fuer den universums-globalen Perzentilrang. Guard action==='route' && finite(score) laeuft
  // NACH dem no-axes-Guard -> excludierte Namen zaehlen NICHT in die Perzentil-Basis (Basis == Anwendung).
  const robustGByEntry = new Map();
  const gDist = [];
  for (const e of results) {
    if (e.action !== 'route' || !Number.isFinite(e.score)) continue;
    const g = robustG(e.snapshot, growthBounds); // g kann null sein (keine YoY -> Faktor 1.0)
    robustGByEntry.set(e, g);
    if (Number.isFinite(g)) gDist.push(g);
  }
  const growthPctl = growthPctlFn(gDist); // null bei Degeneration -> alle Bonus-Faktoren exakt 1.0

  // 2c. Burn-Press (Court, Karl-Direktive Teil 2) + AUFGABE-2-Wachstums-Bonus: beschleunigte Cash-Verbrenner
  // (burnAccelerating) druecken (=1/(1+mag)), starke Wachser AUFWAERTS heben (1 + k*max(0,2*pctl-1)). Beide
  // Faktoren multiplikativ auf denselben post-C4-Score (kommutativ). Fire-/leer-gated: kein Feuer + kein
  // (ueber-Median-)Wachstum -> Faktor 1.0 -> byte-identisch. Bonus liest den robustG-Cache (kein zweites norm()).
  for (const e of results) {
    if (e.action === 'route' && Number.isFinite(e.score)) {
      const g = robustGByEntry.get(e);
      const boost = (growthPctl === null || g === null || g === undefined) ? 1 : boostFromPctl(growthPctl(g));
      // PHASE 3: Zyklus-Daempfer multiplikativ an derselben post-C4-Stelle (kommutativ). signal=0 (Anker,
      // Nicht-Zykliker, Degeneration) -> Faktor exakt 1.0 -> byte-identisch. Nur MU/SK-Hynix-Typ (Oszillation
      // UND Umsatzkollaps) wird gedrueckt.
      e.score = e.score * burnPressFactor(e.snapshot) * boost * cycleDamperFactor(e.snapshot, cycleDDThreshold);
    }
  }

  // Filter-Schicht (Karl-Direktive 5): data-learned Quintil-Baender fuer mcapBand + ipoRecency einmal
  // universe-weit lernen (route+survival = alle output-sichtbaren Namen), via bestehendem quantile().
  // Rein additive Metadata -> kein Score-Einfluss.
  const mcapSamples = [], ipoSamples = [];
  for (const e of results) {
    if (e.action !== 'route' && e.action !== 'survival') continue;
    const mc = e.snapshot && e.snapshot.marketCap;
    if (mc && Number.isFinite(mc.value)) mcapSamples.push(mc.value);
    const y = ipoYearOf(e.snapshot && e.snapshot.meta);
    if (Number.isFinite(y)) ipoSamples.push(y);
  }
  const mcapBounds = quintileBounds(mcapSamples);
  const ipoBounds = quintileBounds(ipoSamples);

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
    // Filter-Schicht (Karl-Direktive 5): 3 additive deskriptive Felder, SOLANGE der Snapshot lebt.
    e.phase = phaseOf(e.snapshot);
    e.mcapBand = mcapBandOf(e.marketCap, mcapBounds);
    e.ipoRecency = ipoRecencyOf(meta, ipoBounds);
    e.profitTier = profitTierOf(e.snapshot);  // Task 1.2: 4-Stufen (nicht/kurz-vor/seit-kurzem/langfristig)
    e.ipoYear = ipoYearOf(meta);              // Task 1.2 Schritt 3: vorhandenes IPO-Jahr NUR durchreichen
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
const round2 = (x) => (Number.isFinite(x) ? Math.round(x * 100) / 100 : null); // 2.13 #23: coverageWeight-Anzeige
// audit/fix (Bug 8): skalenbewusstes Runden der Overview-Wachstumsspalte. round1 (1 Nachkommastelle)
// war fuer die 0-100-Score-Skala gebaut; auf DEZIMAL-Wachstumswerte (0.09 -> 0.1, 0.04 -> 0.0)
// quantisiert es auf 10-Prozentpunkt-Stufen. gp/revenue-badge/ffo-badge sind Dezimal-YoY -> 3
// Nachkommastellen; runway-badge ist eine Quartals-Zahl -> round1 bleibt.
const round3 = (x) => (Number.isFinite(x) ? Math.round(x * 1000) / 1000 : null);
const roundOverviewValue = (ov) => {
  if (!ov) return null;
  return ov.kind === 'runway-badge' ? round1(ov.value) : round3(ov.value);
};

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
  const geo = (e) => ({ country: e.country ?? null, region: e.region ?? null, sector: e.sector ?? null, marketCap: e.marketCap ?? null, phase: e.phase ?? null, mcapBand: e.mcapBand ?? null, ipoRecency: e.ipoRecency ?? null, profitTier: e.profitTier ?? null, ipoYear: e.ipoYear ?? null, coverageAxes: e.coverageAxes ?? null, coverageWeight: e.coverageWeight ?? null });
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
      // audit/fix (Bug 8): skalenbewusst runden. audit/fix (Bug 23): companion (Rule-of-X) durchreichen
      // (Prozent-Skala ~0-300 -> round1). Wird berechnet, ging aber bisher im Datenvertrag verloren.
      overview: e.overview ? { kind: e.overview.kind, value: roundOverviewValue(e.overview), companion: round1(e.overview.companion) } : null,
      ...geo(e),
      // audit/fix (D1/D2): rohen Score zum Sortieren behalten, NUR fuer die Anzeige runden.
      // Sortiert man das gerundete Feld, entstehen kuenstliche round1-Ties, die JS-stable-sort
      // per Input- = fs.readdirSync-Reihenfolge bricht -> nicht reproduzierbare topN-Membership (CI != lokal).
      _raw: e.score,
    };
    branches[e.formulaId] = branches[e.formulaId] || { profitable: [], unprofitable: [] };
    (branches[e.formulaId][e.track] = branches[e.formulaId][e.track] || []).push(row);
    overview.push({ ticker: e.ticker, formulaId: e.formulaId, track: e.track, score: round1(e.score),
      // audit/fix (Bug 8): skalenbewusst; audit/fix (Bug 23): companion durchreichen.
      overviewKind: e.overview ? e.overview.kind : null, overviewValue: roundOverviewValue(e.overview),
      overviewCompanion: e.overview ? round1(e.overview.companion) : null,
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

module.exports = { scoreUniverse, rankBy, trackOf, rawAxisValue, produceRankings, phaseOf, mcapBandOf, ipoRecencyOf, ipoYearOf,
  // audit/fix (Bug 0/9/7): fuer calibrate.js — Kohorten-Gates + Winsor-Schranken exakt spiegeln
  learnWinsorBounds, isDataSuspect, issuerDedupComparator, issuerKey,
  // AUFGABE 2 (Wachstums-Bonus): fuer TDD + gezielte Wiederverwendung
  growthBoostFactor, growthYoYComponents, robustG, growthPctlFn, boostFromPctl, GROWTH_BOOST_K,
  // PHASE 3 (Zyklus-Daempfer): fuer TDD + Mess-Skripte
  signFlips, oscExcess, revMaxDrawdown, cycleSignal, cycleDamperFactor, CYCLE_DAMPER_KD, CYCLE_DD_PCTL,
  // PHASE 4 (Refresh-Robustheit via committete SEC-Tiefe): fuer TDD
  normSec, cycleSeriesPair };

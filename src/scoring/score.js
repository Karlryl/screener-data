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
// Anzeigename behält die Schreibweise, normalisiert aber Rand-/Mehrfach-Whitespace.
const issuerName = (s) => {
  const n = s && s.meta && s.meta.name;
  return (typeof n === 'string' && n.trim()) ? n.replace(/\s+/g, ' ').trim() : null;
};
// Dedup bleibt case-insensitive; dieselbe Normalisierung speist nun auch das Exportfeld.
const issuerKey = (s) => {
  const n = issuerName(s);
  return n ? n.toLowerCase() : null;
};
// audit/fix (26.07.2026, Datenrichtigkeit): issuerKey vergleicht nur klein geschrieben,
// NICHT zeichensetzungs-tolerant. Zweitnotierungen desselben Emittenten schreiben ihren
// Namen aber unterschiedlich — "ASML Holding N.V." vs "ASML Holding NV", "Autodesk, Inc."
// vs "AUTODESK INC.", "KKR & Co Inc" vs "KKR & Co. Inc.". Der Dedup lief daran vorbei und
// liess dieselbe Firma ZWEIMAL im selben Board stehen, meist auf benachbarten Raengen
// (gemessen am CI-Lauf 30213797442: 9 Doppelungen in 1001 Board-Zeilen, u. a.
// AXON/1AXON.MI industrials #27+#28, ALNY/1ALNY.MI health-care #2+#3).
//
// issuerKeyLoose entfernt jedes Nicht-Buchstaben/Ziffern-Zeichen ERSATZLOS — bewusst ohne
// Leerzeichen an seiner Stelle, sonst wuerde "N.V." zu "n v" und traefe "NV" nicht (der
// erste Anlauf dieses Fixes scheiterte genau daran und wurde vom Test darunter gefangen).
// Gemessen am CI-Universum von Lauf 30213797442 (12 320 Namen): 65 Namensgruppen fallen
// dadurch zusammen, die vorher getrennt waren. 64 davon sind echte Zweitnotierungen
// (ASML/ASML.AS/ASML.SW, Adyen N.V./Adyen NV, Autodesk, Inc./AUTODESK INC., KKR & Co Inc/
// KKR & Co. Inc., Kuehne & Nagel/Kuehne + Nagel, dazu viele S.A./SA- und S.p.A./SPA-Paare).
//
// GENAU EINER ist ein Fehltreffer: "First Bancorp" (FBNC, NasdaqGS, North Carolina) und
// "First BanCorp." (FBP, NYSE, Puerto Rico) sind zwei verschiedene Banken, die sich nur im
// Schlusspunkt unterscheiden. Ein Marktkapitalisierungs-Filter trennt sie NICHT sauber ab:
// gemessen liegen zwei ECHTE Paare mit stalem OTC-Kurs (Daido Steel 1,60 / INFRONEER 1,55)
// naeher am FBNC/FBP-Verhaeltnis von 1,70, als eine Schwelle vertragen wuerde.
//
// Der tragfaehige Unterscheider ist das LISTING: ein Emittent hat genau EIN
// US-Primaerlisting. Zwei US-primaere Beine sind deshalb nie zwei Notierungen derselben
// Firma, sondern zwei Firmen. Genau das prueft splitFalseIssuerMerges unten; im gemessenen
// Universum greift der Schutz bei exakt einer Gruppe — FBNC/FBP.
const issuerKeyLoose = (s) => {
  const n = issuerName(s);
  return n ? n.replace(/[^\p{L}\p{N}]+/gu, '').toLowerCase() : null;
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
// Schutz gegen Fehlverschmelzung durch issuerKeyLoose: eine Gruppe mit MEHR ALS EINEM
// US-Primaerlisting kann keine Zweitnotierungs-Familie sein (ein Emittent hat genau ein
// US-Primaerlisting). Solche Gruppen werden auf den strengen, zeichensetzungs-genauen
// issuerKey zurueckgesetzt — also exakt auf das Verhalten vor diesem Fix. Damit kann der
// Fix nie eine echte Firma verschlucken; er kann im schlimmsten Fall eine Doppelung
// stehen lassen, die vorher auch stand. Belegt an FBNC/FBP (beide US-primaer -> bleiben
// getrennt) gegen ASML/ASML.SW, AXON/1AXON.MI, ADSK/AUD.DE (je hoechstens eins -> merged).
function splitFalseIssuerMerges(groups) {
  const out = [];
  for (const group of groups) {
    const usPrimaer = group.filter((e) => isUsPrimaryListing((e.snapshot && e.snapshot.meta) || {})).length;
    if (usPrimaer < 2) { out.push(group); continue; }
    const streng = {};
    for (const e of group) {
      const k = issuerKey(e.snapshot);
      if (k) (streng[k] ||= []).push(e);
    }
    out.push(...Object.values(streng));
  }
  return out;
}

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
function rawAxisValue(s, key, formula, track, winsorBounds, growthBounds) {
  if (key === 'ruleOfX') {
    // includeFcf am tatsaechlichen FCF-Vorzeichen koppeln, NICHT am erzwungenen
    // 'profitable'-Label der none-Branchen (sonst FCF-Penalty fuer cash-negative
    // Namen im einen Track -> Iron-Rule 2).
    const includeFcf = fcfTrack(metricVal(s, 'fcfMarginTTM'), norm(s, 'annualFCF'), norm(s, 'annualOCF')) === 'profitable';
    return axesFns.ruleOfX(s, formula.alpha, includeFcf, growthBounds);
  }
  if (key === 'marginTrajectory') return axesFns.marginTrajectory(s, winsorBounds && winsorBounds.opMargin);
  if (key === 'revAcceleration') return axesFns.revAcceleration(s, winsorBounds && winsorBounds.qoq);
  // Datenrichtigkeits-Fix 14.07.2026: die Level-Achse rechnet aus den Roh-Reihen und
  // klemmt Mini-Basis-Komponenten mit den data-learned growthBounds (wie robustG).
  if (key === 'revGrowthLevel') return axesFns.revGrowthLevel(s, growthBounds);
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
// 2.10 (Fable-Scoring-Court T1, n-bewusste Scores): Empirical-Bayes-Shrinkage der Kohorten-Perzentile
// Richtung 50 (perzentil-neutrale Mitte). Mid-Rank-Perzentile haben eine n-abhaengige OBERGRENZE
// (n-0.5)/n: ein n=3-"Sieger" kappt bei 83.3, ein n=575-Sieger erreicht 99.9 — roh in EIN Overview-Board
// gemischt (Grundgesetz-3-Spannung) sind sie unvergleichbar. p' = 50 + (p-50)*n/(n+SHRINK_K) zieht kleine
// Kohorten (wenig Aufloesung) Richtung Mitte, laesst grosse ~unberuehrt (n/(n+k)->1). REIN VARIANZ-
// getrieben, KEIN aufgezwungenes Niveau (Invariante 3 gewahrt). SHRINK_K ist der EINE freie Parameter
// (analog GROWTH_BOOST_K), Council/Court k=2-kalibriert (SE-matched: entfernt ~1 SE eines Top-Dezil-
// Perzentils an der Governance-Grenze n=15, die der Fallback setzt; k~20 waere ~5 SE = Over-Shrink). Klein
// genug, dass die Anker-Kohorten (semiconductors n=90 -> Faktor 0.978, industrials n=575 -> 0.997 bei k=2)
// praktisch unberuehrt bleiben. 15 = Konvention (analog GROWTH/CYCLE_MIN_DISTINCT=10, eine Stufe strenger),
// 2 = SE-matched; NICHT auf einen Ziel-Rang optimiert (Invariante 3).
// EHRLICHKEIT (Court T2, Invariante 7 — NICHT ueberclaimen): Der Shrink ist eine UNIFORME affine
// Transformation je Kohorte und erhaelt die VOR-Multiplikator-Ordnung. ABER die per-Name-Post-Faktoren
// (burnPress/growthBoost/cycleDamper, unten ~Z.693) multiplizieren DANACH -> multiplier*shrink(score) ist
// NICHT rang-aequivalent zu multiplier*score. Empirisch reordern beim Flip k 0->2 ~160 MID-BOARD-Positionen
// (z.B. MU<->MPWR). Die 4 benannten Anker (CRDO/ALAB/PLTR/BE) behalten ihren within-Board-Rang bei k=2 EXAKT
// (verifiziert: score.integration + anchors.rank gruen), weil sie an den Extremen liegen -> Direktive 4
// (within-Board) unberuehrt. Kein Score-Fixture pinnt WERTE (Anker-Tests pinnen RAENGE) -> kein Score-Bless.
const SHRINK_K = 2;
// 2.10: Mindest-Kohorten-n. Darunter sind die EIGENEN Track-Perzentile Rauschen (n-Ceiling) -> die Achsen
// gegen die ELTERN-Kohorte (Branche ueber BEIDE Tracks) perzentilieren = well-resolved Basis; die Zeile
// wird via cohortFallback:true transparent geflaggt. Der Score bleibt ZUSAETZLICH per eigener n
// geschrumpft (Konfidenz-Aussage), sodass am Schwellenwert kein Sprung entsteht (Monotonie). 15 = die im
// Code bereits etablierte THIN-Linie (GROWTH/CYCLE_MIN_DISTINCT=10 sind Degenerations-Guards, hier strenger).
const MIN_COHORT_N = 15;
// EB-Shrinkage eines Scores Richtung 50 mit Kohorten-n. n<=0/nicht-finit -> unveraendert. Reine Funktion (TDD).
function shrinkToNeutral(score, n) {
  if (!Number.isFinite(score) || !Number.isFinite(n) || n <= 0) return score;
  return 50 + (score - 50) * (n / (n + SHRINK_K));
}
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
// Datenrichtigkeits-Fix 14.07.2026: Implementierung nach axes.js gewandert
// (revYoYComponents) — die revGrowthLevel-Achse liest jetzt dieselben Komponenten
// (Single-Source). Name + Export hier bleiben fuer growthBoost/TDD stabil.
function growthYoYComponents(s) {
  return axesFns.revYoYComponents(s); // 0..2 Werte
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
  const opRaw = norm(s, 'annualOpInc'), revRaw = norm(s, 'annualRev');
  const opY = presentValues(opRaw);
  const revY = presentValues(revRaw);
  const opS = normSec(s, 'annualOpInc'), revS = normSec(s, 'annualRev');
  const opSP = opS ? presentValues(opS) : null;
  const revSP = revS ? presentValues(revS) : null;
  // ZEITFENSTER-Alignment (Verify CEVA/COHU): BEIDE Felder muessen am NEUESTEN Jahr (Index 0) present sein.
  // Sonst kollabieren presentValues(op) und presentValues(rev) bei einem null-Prefix in NUR einem Feld auf
  // DISJUNKTE Kalenderfenster (neue Oszillation vs alter Drawdown) = Zeit-Misch-Signal (Inv. 4/5). -> Yahoo-Fallback.
  const useSec = opSP && revSP && opSP.length >= opY.length && revSP.length >= revY.length
    && opS[0] !== null && revS[0] !== null;
  if (useSec) return { op: opSP, rev: revSP };
  // audit/fix (BH-082): derselbe Index0-Alignment-Guard galt bisher NUR fuer den SEC-Zweig — der
  // Yahoo-Fallback baute op/rev aus GETRENNT kompaktierten presentValues()-Serien OHNE Pruefung, ob
  // beide am juengsten Jahr present sind. Eine fuehrende Luecke in NUR einem der beiden Felder liess
  // op/rev aus disjunkten GJ-Fenstern zusammen, exakt das Zeit-Misch-Signal, das der Kommentar oben fuer
  // den SEC-Zweig verbietet. Ohne Index0 auf BEIDEN Seiten ist das Paar nicht zeitlich verbunden -> leer
  // liefern, cycleSignal gatet dann ueber op.length<3 auf 0 (kein Phantom-Zyklus-Signal).
  if (opRaw[0] === null || opRaw[0] === undefined || revRaw[0] === null || revRaw[0] === undefined) {
    return { op: [], rev: [] };
  }
  return { op: opY, rev: revY };
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

function scoreUniverse(snapshots, formulas, opts = {}) {
  // 2.9 Slice 2: refCalibration = eingefrorenes "Lineal" (aus einem frueheren Lauf). Gesetzt ->
  // NICHT neu lernen, sondern gegen die gefrorenen Schranken + Kohorten-/Boost-Verteilungen scoren
  // (Universe-Ausbau verschiebt bestehende Scores dann NICHT mehr). Default (null) = live-lernend,
  // byte-identisch zum bisherigen Verhalten.
  const refCal = opts.refCalibration || null;
  // R2.7 FAIL-LOUD (Court E-20260717-5): ein refCal, dessen cohortBases eine Achse der AKTUELLEN
  // formulas-Version NICHT kennt (Lineal aelter als der Code), wuerde sonst STILL gegen die Live-
  // Verteilung scoren: der nicht-Fallback-Zweig (Pass 2) faellt bei fehlendem refCoh.axes[ax.key] auf
  // rawByAxis (live) zurueck, und parentBasis() droppt die fehlende Achse per `if(!Array.isArray) continue`
  // fuer duenne (n<MIN_COHORT_N) Kohorten ebenso still. RULER-ZENTRISCH (ueber refCal.cohortBases statt
  // Live-Kohorten iterieren): faengt BEIDE stillen Pfade — auch fuer eine live-neue duenne Kohorte, die aus
  // einer live-leeren Geschwister-Kohorte im Lineal liest. Genuinely-NEUE Live-Kohorten haben KEINEN Eintrag
  // im Lineal -> ungeprueft -> gewollter Live-Fallback + Grown-Universe-Invariante bleiben unberuehrt. Frueh
  // (vor Pass 1) = ehrliche Root-Cause-Stelle: kein Board wird geschrieben, bevor das veraltete Lineal knallt.
  if (refCal && refCal.cohortBases) {
    for (const cohortKey of Object.keys(refCal.cohortBases)) {
      const formula = formulas[cohortKey.split('|')[0]];
      if (!formula) continue; // Formel seit dem Freeze entfernt -> nicht vergleichbar, ueberspringen
      const refAxes = refCal.cohortBases[cohortKey].axes;
      for (const ax of formula.axes) {
        if (!(refAxes && Array.isArray(refAxes[ax.key]))) {
          throw new Error(`scoreUniverse: refCalibration-Lineal kennt Achse '${ax.key}' in Kohorte '${cohortKey}' nicht (Lineal aelter als die aktuelle formulas-Version). Mit aktuellem Code neu einfrieren.`);
        }
      }
    }
  }
  // audit/fix (BH-075): der Guard oben validiert NUR die cohortBases-Achsen-Arrays. Die weiter unten roh aus
  // refCal konsumierten SKALARE (winsorBounds/growthBounds/cycleDDThreshold/mcapBounds/ipoBounds, Z.~575-786)
  // blieben ungeprueft — fehlt eines in einem Teil-Artefakt, wird es `undefined` statt `null`. Das ist
  // gefaehrlich, weil Vergleiche gegen `undefined` anders als gegen `null` gaten (z.B. ddThreshold===null
  // faengt den Degenerations-Fall ab, ddThreshold===undefined NICHT -> revMaxDrawdown(rev)<undefined ist
  // IMMER false -> der Zyklus-Daempfer wuerde ungegatet fuer jedes oszillierende Signal feuern). `null` ist
  // ein legitimer gefrorener Degenerations-Zustand (downstream ueberall per ===null gegatet) — nur das
  // FEHLEN des Schluessels selbst (Teil-Artefakt/aeltere Schema-Version) ist der Fehler -> `in`-Check, nicht
  // Truthy-Check. Frueh (vor dem ersten Score) = ehrliche Root-Cause-Stelle, analog zum gDistByCohort-Guard unten.
  if (refCal) {
    for (const scalarKey of ['winsorBounds', 'growthBounds', 'cycleDDThreshold', 'mcapBounds', 'ipoBounds']) {
      if (!(scalarKey in refCal)) {
        throw new Error(`scoreUniverse: refCalibration-Lineal fehlt Feld '${scalarKey}' (Teil-Artefakt/aeltere Schema-Version) — mit aktuellem Code neu einfrieren.`);
      }
    }
  }
  // 3.1 QC-Board (additive Seams, HG byte-identisch per Default):
  //  (a) classify: erlaubt einem zweiten Pass eine EIGENE Membership-Funktion (qualityRoute) statt route().
  //      HG uebergibt kein classify -> route -> byte-identisch.
  //  (b) growthBoost:false -> der AUFWAERTS-Wachstums-Faktor wird auf 1 gepinnt (QCs Inversion nicht
  //      hintenrum wieder einspeisen). HG setzt es nicht -> Boost weiter aktiv -> byte-identisch.
  //      cycleDamper + burnPress bleiben UNBERUEHRT (weiter aktiv).
  const classify = opts.classify || route;
  const growthBoostOn = opts.growthBoost !== false;
  const results = [];
  // 1. Routing + Track
  for (const s of (Array.isArray(snapshots) ? snapshots : [])) {
    const r = classify(s);
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
    // Zeichensetzungs-tolerant gruppieren (s. Kommentar an issuerKeyLoose).
    const k = issuerKeyLoose(e.snapshot);
    if (k) (issuerGroups[k] ||= []).push(e);
  }
  for (const group of splitFalseIssuerMerges(Object.values(issuerGroups))) {
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
  // 2.9 Slice 2: im Referenz-Modus die gefrorenen Skalar-Schranken nutzen (nicht neu lernen).
  const winsorBounds = refCal ? refCal.winsorBounds : learnWinsorBounds(results.filter((e) => e.action === 'route').map((e) => e.snapshot));
  // PHASE 3: data-learned DD-Schwelle = p75 der universums-weiten Drawdown-Verteilung (Basis C oben).
  // Degenerations-Guard analog GROWTH_MIN_DISTINCT: <CYCLE_MIN_DISTINCT distinkte DD-Werte -> null ->
  // cycleSignal gatet alle Faktoren auf exakt 1.0 (byte-identisch, kein Phantom-Daempfer).
  const cycleDDThreshold = refCal ? refCal.cycleDDThreshold
    : ((new Set(cycleDDSamples.filter(Number.isFinite)).size >= CYCLE_MIN_DISTINCT)
      ? quantile(cycleDDSamples, CYCLE_DD_PCTL) : null);
  const growthBounds = refCal ? refCal.growthBounds : winsorTailBounds(growthSamples); // null bei leerer Stichprobe -> robustG-null-Guard faengt
  // 2.9 Slice 2: je Kohorte die live-berechneten Achsen-Rohwert-Verteilungen (+ profitSign fuer die
  // subCohortByProfit-capitalEfficiency-Achse) cachen -> werden ins Kalibrier-Artefakt eingefroren.
  const capturedCohortBases = {};
  // 2.10: PASS 1 — Roh-Achsen + profitSign + n je Kohorte EINMAL sammeln. Der Mindest-n-Fallback (Pass 2)
  // braucht die ELTERN-Kohorte (Branche ueber BEIDE Tracks), also ALLE Kohorten der Formel, nicht nur die
  // eigene -> zwei Pässe. Rein strukturell: das Achsen-Lernen ist unveraendert.
  const cohortRaw = {};
  for (const [cohortKey, entries] of Object.entries(cohorts)) {
    const formula = entries[0].formula;
    const track = entries[0].track;
    const formulaId = entries[0].formulaId;
    // none-Branchen mit subCohortByProfit (it-services/real-estate): die Niveau-ROIC-
    // Achse capitalEfficiency nur gegen Firmen GLEICHEN Profit-Vorzeichens perzentil-
    // ieren, damit Verlust-Wachser nicht vom Niveau-ROIC im SCORE demoviert werden
    // (Iron-Rule 2). Split-Branchen (mit Ankern) trennen das ohnehin via Track.
    const profitSign = formula.subCohortByProfit
      ? entries.map((e) => signTrack(norm(e.snapshot, 'annualOpInc')))
      : null;
    const rawByAxis = {};
    for (const ax of formula.axes) {
      rawByAxis[ax.key] = entries.map((e) => rawAxisValue(e.snapshot, ax.key, formula, track, winsorBounds, growthBounds));
    }
    cohortRaw[cohortKey] = { formula, track, formulaId, entries, rawByAxis, profitSign };
    // 2.10: n je Kohorte MITfrieren (ref-Modus liest die eingefrorene n fuer die Shrinkage -> ein
    // wachsendes Universum verschiebt den Shrink-Faktor bestehender Namen NICHT = Grown-Universe-Invariante).
    capturedCohortBases[cohortKey] = { axes: { ...rawByAxis }, profitSign, n: entries.length };
  }
  // 2.10: Eltern-Kohorten-Basis (Branche ueber beide Tracks) fuer eine Achse. refCal gesetzt -> AUSSCHLIESSLICH
  // aus den EINGEFRORENEN Geschwister-Kohorten rekonstruieren (live-neue Geschwister ignorieren), sonst driften
  // Fallback-Namen beim Universe-Ausbau (Grown-Universe-Invariante 2.9). profitSign-Parent parallel fuer die
  // capitalEfficiency-Sub-Kohorte. Gibt {vals, signs} gleicher Laenge zurueck.
  function parentBasis(formulaId, axisKey) {
    const frozen = (refCal && refCal.cohortBases) || null;
    const keys = frozen
      ? Object.keys(frozen).filter((k) => k.startsWith(formulaId + '|'))
      : Object.keys(cohortRaw).filter((k) => cohortRaw[k].formulaId === formulaId);
    let vals = [], signs = [];
    for (const key of keys) {
      const arr = frozen ? (frozen[key].axes && frozen[key].axes[axisKey]) : cohortRaw[key].rawByAxis[axisKey];
      const sg = frozen ? frozen[key].profitSign : cohortRaw[key].profitSign;
      if (!Array.isArray(arr)) continue;
      vals = vals.concat(arr);
      signs = signs.concat((sg && sg.length === arr.length) ? sg : arr.map(() => null));
    }
    return { vals, signs };
  }
  // 2.10: PASS 2 — scoren. Basis-Wahl (eigene Kohorte vs. Eltern bei Mindest-n-Unterschreitung), q()-Normierung,
  // EB-Shrinkage Richtung 50 per eigener n, dann C4-Coverage-Shrinkage (unveraendert).
  for (const [cohortKey, cr] of Object.entries(cohortRaw)) {
    const { formula, track, formulaId, entries, rawByAxis, profitSign } = cr;
    // 2.9 Slice 2: refCal gesetzt + Kohorte im Lineal -> gegen die EINGEFRORENE Verteilung scoren (neue Namen
    // mappen darauf, bestehende behalten ihren Rang exakt); sonst live. Rein neue Kohorte -> live-Fallback.
    const refCoh = (refCal && refCal.cohortBases) ? refCal.cohortBases[cohortKey] : null;
    // 2.10: n fuer Shrinkage + Fallback-Entscheid. Ref-Modus friert n (Grown-Universe); sonst live entries.length.
    const nCohort = (refCoh && Number.isFinite(refCoh.n)) ? refCoh.n : entries.length;
    const isFallback = nCohort < MIN_COHORT_N;          // duenne Kohorte -> Eltern-Basis (n-Ceiling weg)
    const baseSign = refCoh ? refCoh.profitSign : profitSign;
    const parentCache = {};                             // Eltern-Basis je Achse nur bei Fallback + einmalig
    const cohWcov = new Array(entries.length);
    for (let i = 0; i < entries.length; i++) {
      const axes = formula.axes.map((ax) => {
        let cohort, signBasis;
        if (isFallback) {
          const pb = parentCache[ax.key] || (parentCache[ax.key] = parentBasis(formulaId, ax.key));
          cohort = pb.vals; signBasis = pb.signs;
        } else {
          cohort = (refCoh && refCoh.axes && refCoh.axes[ax.key]) ? refCoh.axes[ax.key] : rawByAxis[ax.key];
          signBasis = baseSign;
        }
        if (ax.key === 'capitalEfficiency' && profitSign) {
          // gegen die gleich-vorzeichige Sub-Kohorte perzentilieren; die (ggf. gefrorene/Eltern-)Basis nach
          // dem EIGENEN (snapshot-stabilen) Vorzeichen von Name i filtern -> A-Namen behalten ihren Rang.
          // 2.10-Court-Guard: dieser Fallback-Pfad ist NUR sicher, weil JEDE subCohortByProfit-Formel
          // splitMetric:'none' ist (Einzel-Kohorte -> Eltern-Basis == eigene Kohorte, signBasis voll
          // besetzt). Bekaeme je eine SPLIT-Branche subCohortByProfit UND fiele unter MIN_COHORT_N, mischte
          // die Eltern-Basis beide Tracks mit ggf. null-signBasis -> diesen Pfad dann neu pruefen.
          cohort = cohort.filter((_, j) => signBasis[j] === profitSign[i]);
        }
        return { value: q(rawByAxis[ax.key][i], cohort), weight: ax.w[track] };
      });
      // 2.10: Basis-Score -> EB-Shrinkage Richtung 50 mit EIGENER Kohorten-n (Konfidenz). Der Fallback aendert
      // nur die Perzentil-BASIS, NICHT die Konfidenz -> weiterhin per nCohort geschrumpft (kein Schwellensprung).
      // 2.7 Score-Transparenz: je Achse Perzentil-Beitrag (0..100, null=gedroppt/renorm-on-drop) + Gewicht.
      // Roh erfasst (Rundung im Export). scoreBase == gewichtetes Mittel der present-Achsen (renorm-on-drop).
      entries[i]._axes = axes.map((a, j) => ({ key: formula.axes[j].key, pct: a.value, weight: a.weight }));
      const baseScore = weightedScore(axes);
      entries[i]._scoreBase = baseScore;         // 2.11 Stufe A: Basis-Score (vor EB-Shrinkage + C4 + Post-Faktoren)
      entries[i].score = shrinkToNeutral(baseScore, nCohort);
      cohWcov[i] = coverageWeight(axes);         // Achsen-Gewichts-Coverage (C4-Shrinkage-Faktor)
      // 2.13 #23: Coverage AUSWEISEN (nicht verrechnen) — present-Achsen/total + C4-Gewicht je Zeile
      // an den Entry haengen (score-inert, reine Anzeige; round2 ist modul-scope, zur Aufrufzeit da).
      // audit/fix (BH-083): axes.length zaehlte auch w=0-Achsen (QCs roicStability) mit, waehrend
      // coverageWeight() (engine.js) diese korrekt aus totalW ausschliesst -> QC-Zeilen zeigten '5/6' bei
      // coverageWeight 1.0, Vertragsbruch zu docs/findash-export-v1.md ('n/n <=> 1.0'). Nur gewichtete
      // Achsen zaehlen, konsistent zu coverageWeight.
      const weightedAxes = axes.filter((a) => a.weight > 0);
      entries[i].coverageAxes = weightedAxes.filter((a) => a.value !== null).length + '/' + weightedAxes.length;
      entries[i].coverageWeight = round2(cohWcov[i]);
      // 2.10: n je Zeile (Pflicht-Export, --check-Tamper->exit1) + Fallback-Flag (transparente Anzeige).
      entries[i].cohortN = nCohort;
      entries[i].cohortFallback = isFallback;
    }
    // audit/fix (Court Phase A Runde 3, Fall C4): Coverage-Shrinkage. renorm-on-drop laesst Namen mit
    // WENIGER present-Achsen eine strukturell HOEHERE Score-Varianz behalten (Mittel ueber k Achsen,
    // Var ~1/k) -> sie ueberbevoelkern die Tails und verdraengen daten-vollstaendige Namen (alle 4
    // Anker 8/8) aus der Spitze = Falsch-Entdeckung (Inv. 4 effektives N + 7 FDR). Jeden Basis-Score
    // Richtung KOHORTEN-MEDIAN schrumpfen, Schrumpf-Faktor = wcov (= das fehlende Achsen-Gewicht,
    // data-learned, KEINE freie Konstante). wcov=1 (8/8) -> Score byte-identisch. KEIN Fake-50:
    // Ziel ist der gelernte Median, renorm-on-drop bleibt darunter erhalten.
    // 2.9 Slice 2: der C4-Shrinkage-Zielwert (Kohorten-Median) ist die letzte live-Kohorten-Abhaengigkeit
    // im Score. refCal gesetzt -> den EINGEFRORENEN Median nutzen (sonst schoebe ein wachsendes Universum
    // den Median und damit jeden geschrumpften A-Score = Drift). Median immer ins Artefakt cachen.
    const cohMedian = (refCoh && 'median' in refCoh) ? refCoh.median
      : quantile(entries.map((e) => e.score).filter(Number.isFinite), 0.5);
    capturedCohortBases[cohortKey].median = cohMedian;
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
  const gDist = [];                 // universums-globale robustG-Verteilung (Diagnose + Rueckwaerts-Kompat im Artefakt)
  const gDistByCohort = {};         // 2.11 Stufe B: robustG je formulaId|track (Kohorten-Doktrin)
  for (const e of results) {
    if (e.action !== 'route' || !Number.isFinite(e.score)) continue;
    const g = robustG(e.snapshot, growthBounds); // g kann null sein (keine YoY -> Faktor 1.0)
    robustGByEntry.set(e, g);
    if (Number.isFinite(g)) { gDist.push(g); (gDistByCohort[e.formulaId + '|' + e.track] ||= []).push(g); }
  }
  // 2.11 Stufe B (Court-approbiert 08.07., Karl-Go): der Wachstums-Bonus rangiert KOHORTEN-RELATIV (je
  // formulaId|track) statt universums-global — der globale growthBoost brach sonst die Kohorten-Doktrin durch
  // die Hintertuer (ein Software-Wachser gegen Energie/Versorger perzentiliert). Kohorten-Perzentilierung heilt
  // das; empirisch byte-identische Anker-Board-Raenge (der Boost trug die Anker nie: er ist [1,1.05]-eng).
  // refCal gesetzt + Kohorte gefroren -> gegen die EINGEFRORENE Kohorten-Verteilung rangieren (Grown-Universe-
  // Determinismus wie cohortBases); neue Kohorte im refCal-Modus -> live-Fallback (beruehrt keine A-Namen);
  // degenerierte/duenne Kohorte (growthPctlFn-Guard) -> null -> Bonus-Faktor 1.0 (konservativ, kein Phantom-Rang).
  // 2.11 Stufe B FAIL-LOUD (Verify-T2): ein refCal OHNE gDistByCohort ist ein pre-v4-Lineal — der kohorten-
  // relative Wachstums-Bonus kann darauf NICHT einfrieren. Der stille `|| {}`-Fallback wuerde jede Kohorte
  // gegen die LIVE (universums-ausgebaute) Verteilung rangieren -> A-Namen driften beim Universe-Ausbau
  // (~600/1708 Board-Scores de-frieren) = genau die Drift, die der Ref-Modus verhindern soll, STILL. Also
  // hart abbrechen statt still falsch scoren: das Lineal muss mit v4-Code neu eingefroren werden.
  if (refCal && !refCal.gDistByCohort) {
    throw new Error('scoreUniverse: refCalibration ohne gDistByCohort (Schema < calibration/v4). Der kohorten-relative Wachstums-Bonus (2.11 Stufe B) braucht ein v4-Lineal — bitte neu einfrieren.');
  }
  const growthPctlByCohort = {};
  const frozenGD = refCal ? refCal.gDistByCohort : null;
  for (const key of new Set([...(frozenGD ? Object.keys(frozenGD) : []), ...Object.keys(gDistByCohort)])) {
    growthPctlByCohort[key] = growthPctlFn((frozenGD && frozenGD[key]) ? frozenGD[key] : gDistByCohort[key]);
  }

  // 2c. Burn-Press (Court, Karl-Direktive Teil 2) + AUFGABE-2-Wachstums-Bonus: beschleunigte Cash-Verbrenner
  // (burnAccelerating) druecken (=1/(1+mag)), starke Wachser AUFWAERTS heben (1 + k*max(0,2*pctl-1)). Beide
  // Faktoren multiplikativ auf denselben post-C4-Score (kommutativ). Fire-/leer-gated: kein Feuer + kein
  // (ueber-Median-)Wachstum -> Faktor 1.0 -> byte-identisch. Bonus liest den robustG-Cache (kein zweites norm()).
  for (const e of results) {
    if (e.action === 'route' && Number.isFinite(e.score)) {
      const g = robustGByEntry.get(e);
      const gp = growthPctlByCohort[e.formulaId + '|' + e.track]; // 2.11 Stufe B: Kohorten-Perzentilrang statt global
      // 3.1 QC-Board: growthBoost:false pinnt den Faktor auf 1 (QCs Wachstums-Inversion nicht hintenrum
      // wieder einspeisen). HG (growthBoost nicht gesetzt) -> growthBoostOn -> Faktor unveraendert.
      const boost = (!growthBoostOn || !gp || g === null || g === undefined) ? 1 : boostFromPctl(gp(g));
      // PHASE 3: Zyklus-Daempfer multiplikativ an derselben post-C4-Stelle (kommutativ). signal=0 (Anker,
      // Nicht-Zykliker, Degeneration) -> Faktor exakt 1.0 -> byte-identisch. Nur MU/SK-Hynix-Typ (Oszillation
      // UND Umsatzkollaps) wird gedrueckt.
      // 2.11 Stufe A: Faktor-Breakdown roh erfassen (Rundung + shrink-Ratio erst im Export). _scorePreFactor =
      // Score nach EB+C4, VOR den 3 multiplikativen Post-Faktoren -> final == _scorePreFactor*burn*growth*cycle.
      const burn = burnPressFactor(e.snapshot);
      const cyc = cycleDamperFactor(e.snapshot, cycleDDThreshold);
      e._scorePreFactor = e.score;
      e._factorBurn = burn; e._factorGrowth = boost; e._factorCycle = cyc;
      e.score = e.score * burn * boost * cyc;
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
  // 2.9 Slice 2: mcap/ipo-Quintile ebenfalls aus dem Lineal (Metadaten-Determinismus im Referenz-Modus).
  const mcapBounds = refCal ? refCal.mcapBounds : quintileBounds(mcapSamples);
  const ipoBounds = refCal ? refCal.ipoBounds : quintileBounds(ipoSamples);

  // 2.9 Slice 1: Kalibrier-Artefakt — die pro Lauf aus dem driftenden ~20%-Sample GELERNTEN
  // globalen "Lineale" (winsor/growth/cycleDD/mcap/ipo) als versionierbares Objekt ausweisen.
  // REINE EMISSION dessen, was oben ohnehin gelernt wurde -> KEIN Score-Einfluss (Score byte-
  // identisch). Zeitstempel-FREI (run-screener stempelt beim Schreiben) fuer Replay-Determinismus.
  // ponytail: als Property an das results-Array gehaengt statt {results,calibration} zurueckzugeben
  // -> nicht-brechend fuer die vielen `const results = scoreUniverse(...)`-Aufrufer (Array-Iteration
  // + .length unberuehrt). Die per-Kohorte-Perzentilbasen + Referenz-Scoring folgen in 2.9 Slice 2.
  // 2.9 R2.9 (Court E-20260717-5): Die Referenz-Verteilungen im Artefakt PER-KOHORTE-KEY gegen das
  // Lineal mergen statt live durchreichen — sonst de-friert das Lineal am naechsten Kettenglied
  // (A-Namen driften bis ~13.7 Punkte, 1711/1711). Frozen-bevorzugt-per-Key wie parentBasis (Z.591-605):
  // gefrorener Key -> refCal-Eintrag VERBATIM (axes/profitSign/n/median bzw. Verteilung konsistent aus
  // dem Lineal); echt neuer Key (oder kein refCal) -> live. KEIN Ganzobjekt-Ternary: der verloere im
  // gewachsenen Universum brandneue Kohorten aus dem Artefakt -> sie frieren nie ein = R2.9 im Kleinen.
  const mergeFrozenByKey = (live, frozen) => {
    if (!frozen) return live;
    const out = {};
    // Court-Nachtrag F-B (T3): ueber die UNION(frozen, live) iterieren statt nur Object.keys(live) —
    // sonst faellt eine im Lineal PRAESENTE, im (transient) Live-Universum LEERE Kohorte still aus dem
    // Emissions-Artefakt = De-Freeze am naechsten Ref-Kettenglied. Frozen gewinnt bei geteilten Keys
    // (R2.9-Kern unveraendert). KEIN TTL/Praesenz-Zaehler (YAGNI): der Kohorten-Keyspace ist geschlossen
    // (~22 formulaId|track) und waechst NUR durch ein bewusstes Code-Ereignis (neue Formel/Track), nie
    // durch Universe-Wachstum/Daten — eine dauerhaft tote Kohorte wird beim bewussten Re-Freeze geraeumt.
    for (const key of new Set([...Object.keys(frozen), ...Object.keys(live)])) out[key] = (key in frozen) ? frozen[key] : live[key];
    return out;
  };
  const emitCohortBases = mergeFrozenByKey(capturedCohortBases, refCal && refCal.cohortBases);
  const emitGDistByCohort = mergeFrozenByKey(gDistByCohort, refCal && refCal.gDistByCohort);
  // gDist: rein diagnostisch (einziger Leser calibration.test.js:46), keine Scoring-/Drift-Logik ->
  // bei gesetztem refCal wholesale aus dem Lineal, sonst live.
  const emitGDist = (refCal && refCal.gDist) ? refCal.gDist : gDist;
  Object.defineProperty(results, 'calibration', {
    value: {
      // v2 (2.9 Slice 2): traegt zusaetzlich die vollen Referenz-VERTEILUNGEN (cohortBases + gDist),
      // damit ein spaeterer Lauf per {refCalibration} EXAKT gegen dieses Lineal scoren kann. v1 war
      // scalar-only (nur diffbar). Volle Arrays statt Quantil-Grid = exakter Replay (Groesse ~1 MB,
      // gitignored/2.3-kompaktiert; Quantil-Grid-Kompaktierung als spaetere Optimierung dokumentiert).
      schema: 'calibration/v4',        // v4 (2.11 Stufe B): gDistByCohort (kohorten-relativer Wachstums-Bonus)
      winsorBounds, growthBounds, cycleDDThreshold, mcapBounds, ipoBounds,
      cohortBases: emitCohortBases,     // {cohortKey: {axes:{axisKey:[rohwerte]}, profitSign:[..]|null, n, median}} — per-Key gg. Lineal gemergt
      gDist: emitGDist,                 // universums-globale robustG-Verteilung (Diagnose/Rueckwaerts-Kompat); im Ref-Modus aus dem Lineal
      gDistByCohort: emitGDistByCohort, // 2.11 Stufe B: robustG je formulaId|track — per-Key gg. Lineal gemergt (Wachstums-Bonus rangiert kohorten-relativ)
      nRouted: results.filter((e) => e.action === 'route').length,
      nTotal: Array.isArray(snapshots) ? snapshots.length : null,
    },
    enumerable: false, // unsichtbar fuer JSON.stringify(results)/Spread -> keine Alt-Konsument-Ueberraschung
  });
  // Court-Nachtrag F-A (T1): der Drift-Waechter (run-screener.js) braucht die ROH-LIVE erfassten Vor-Merge-
  // Verteilungen — NICHT das oben frozen-gemergte `calibration`. Sonst vergleicht er jede GETEILTE Kohorte
  // VERBATIM gegen sich selbst (ksDistance(ref,ref)=0, strukturell blind gegen ein veraltetes Lineal).
  // capturedCohortBases (axes/profitSign/n/median, roh-live) + gDistByCohort (rohe Live-Verteilung, Z.722),
  // beide VOR dem mergeFrozenByKey. Zweite non-enumerable Property -> landet NIE in calibration.json
  // (run-screener spreadet nur ...results.calibration; Schema v4 + Byte-Identitaet unberuehrt).
  // calibrationDrift liest genau liveCal.cohortBases + liveCal.gDistByCohort — Interna unveraendert.
  Object.defineProperty(results, 'calibrationLive', {
    value: { cohortBases: capturedCohortBases, gDistByCohort },
    enumerable: false,
  });

  // 3. Overview-Metrik anhaengen + interne Felder entfernen
  for (const e of results) {
    if (e.action === 'route') {
      // growthBounds mitgeben: die Begleitspalte ist dieselbe Kennzahl wie die Achse
      // und muss identisch geklemmt sein (R-Gate 2.R, Fund F6-1).
      e.overview = overviewMetric(e.snapshot, { gpClass: e.gpClass, specialTrack: SPECIAL_OVERVIEW[e.formulaId], growthBounds });
    } else if (e.action === 'survival') {
      // Pre-Revenue/Biotech: KEIN Growth-Score, nur Runway-Badge (Plan: nie growth-gescort)
      e.overview = overviewMetric(e.snapshot, { specialTrack: 'biotech', growthBounds });
    }
    // A2 (Weltweit-Pivot): Land/Region/Sektor/MarketCap aus meta anheften, SOLANGE der
    // Snapshot noch existiert (wird gleich geloescht). produceRankings haengt sie an jede
    // Output-Zeile -> Voraussetzung fuer Karls Laenderfilter + Sektor-Tabs + mcap-Spalte.
    // Rein additiv: kein Routing/Track/Achsen/Score/Lampen-Einfluss -> fixture-safe.
    const meta = e.snapshot && e.snapshot.meta;
    e.name = issuerName(e.snapshot);
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
// 2.11 Stufe A: Score-Herkunft je Zeile (Transparenz — der Nordstern verlangt "nachvollziehbare Begruendung",
// der Score war bisher Blackbox). Drei sichtbare Stufen statt kryptischer Ratios: scoreBase (roher Perzentil-
// Score) -> scoreShrunk (nach EB-Shrinkage + C4-Coverage-Shrinkage) -> final == scoreShrunk*burn*growth*cycle.
// Die beiden Shrinks sind AFFIN (Richtung 50 bzw. Median), NICHT multiplikativ — sie als Faktor-Ratio darzustellen
// explodiert bei scoreBase~0 (z.B. FRVO shrink~56) und ist rundungsfragil; die Zwischenzahl scoreShrunk ist die
// ehrliche, robuste Form. burn/growth/cycle sind die 3 ECHTEN multiplikativen Post-Faktoren. null-sicher.
function breakdown(e) {
  // 2.7: Achsen-Beitrag je Zeile (Perzentil round1 + Gewicht); null-pct = Achse gedroppt (renorm-on-drop).
  const axisBreakdown = Array.isArray(e._axes)
    ? e._axes.map((a) => ({ key: a.key, pct: round1(a.pct), weight: a.weight }))
    : null;
  const base = e._scoreBase, pre = e._scorePreFactor;
  if (!Number.isFinite(base) || !Number.isFinite(pre)) return { scoreBase: null, scoreShrunk: null, factors: null, axisBreakdown };
  return {
    scoreBase: round1(base),
    scoreShrunk: round1(pre),
    factors: { burn: round3(e._factorBurn), growth: round3(e._factorGrowth), cycle: round3(e._factorCycle) },
    axisBreakdown,
  };
}

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
  // A2: die in scoreUniverse angehefteten Anzeige-/geo-Felder an jede Output-Zeile spreaden
  // (?? null haelt die Form stabil, falls produceRankings mit handgebauten results laeuft).
  const rowMeta = (e) => ({ name: e.name ?? null, country: e.country ?? null, region: e.region ?? null, sector: e.sector ?? null, marketCap: e.marketCap ?? null, phase: e.phase ?? null, mcapBand: e.mcapBand ?? null, ipoRecency: e.ipoRecency ?? null, profitTier: e.profitTier ?? null, ipoYear: e.ipoYear ?? null, coverageAxes: e.coverageAxes ?? null, coverageWeight: e.coverageWeight ?? null, cohortN: e.cohortN ?? null, cohortFallback: e.cohortFallback ?? null });
  for (const e of (Array.isArray(results) ? results : [])) {
    if (e.action === 'survival') {
      survival.push({ ticker: e.ticker, runwayQuarters: e.overview ? e.overview.value : null, lamps: e.lamps, ...rowMeta(e) });
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
      ...rowMeta(e), ...breakdown(e), // 2.11 Stufe A: scoreBase + factors{shrink,burn,growth,cycle}
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
      lamps: e.lamps, ...rowMeta(e), ...breakdown(e), _raw: e.score }); // 2.11 Stufe A: scoreBase + factors
  }
  // audit/fix (D1/D2/D3): roher Score + deterministischer Ticker-Tie-Break VOR dem Slicen,
  // damit exakte/round1-Ties nicht von der Dateisystem-Reihenfolge entschieden werden. _raw
  // wird danach gestrippt -> Output-Shape unveraendert.
  const byScore = (a, c) => (c._raw - a._raw) || cmpTicker(a.ticker, c.ticker);
  const stripRaw = ({ _raw, ...row }) => row;
  // 2.3-A8: volle gescorte Kohorten VOR dem topN-Slice abgreifen (2.8 §6: board-history
  // friert die VOLLE Kohorte ein, nicht Top-N — sonst ist rankIC range-restringiert
  // Richtung 0 attenuiert). Rein additiv: Board-Listen bleiben byte-identisch topN-gekappt.
  const full = {};
  for (const [id, b] of Object.entries(branches)) {
    full[id] = {};
    for (const t of Object.keys(b)) {
      b[t].sort(byScore);
      full[id][t] = b[t].map(stripRaw);
      b[t] = b[t].slice(0, topN).map(stripRaw);
    }
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
  return { branches, overview: overview.slice(0, topN * 2).map(stripRaw), survival, excluded, full };
}

// 2.9 Slice 2: Drift-Waechter. KS-Distanz (max |CDF|-Differenz) je Kohorte/Achse zwischen dem
// LIVE-Lineal und dem eingefrorenen Referenz-Lineal. Ueber Schwelle => die Normierungsbasis hat sich
// verschoben (Universe-Ausbau/Daten-Drift) -> der Aufrufer meldet fail-loud (0.7) + flaggt das Vintage.
// Reine Funktion. Default-Schwelle 0.15; cron-seitig aus den ersten Laeufen kalibrieren (Rezept 2.3-Wert-Gate).
function ksDistance(a, b) {
  const fa = (Array.isArray(a) ? a : []).filter(Number.isFinite).slice().sort((x, y) => x - y);
  const fb = (Array.isArray(b) ? b : []).filter(Number.isFinite).slice().sort((x, y) => x - y);
  if (!fa.length || !fb.length) return null;
  const cdf = (arr, x) => { let lo = 0, hi = arr.length; while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] <= x) lo = m + 1; else hi = m; } return lo / arr.length; };
  let maxD = 0;
  for (const x of [...new Set([...fa, ...fb])]) maxD = Math.max(maxD, Math.abs(cdf(fa, x) - cdf(fb, x)));
  return maxD;
}
function calibrationDrift(liveCal, refCal, ksThreshold = 0.15) {
  const drifted = [];
  let maxKs = 0;
  const lb = (liveCal && liveCal.cohortBases) || {}, rb = (refCal && refCal.cohortBases) || {};
  for (const key of Object.keys(rb)) {
    const la = lb[key] && lb[key].axes, ra = rb[key].axes;
    if (!ra) continue; // Referenz-Kohorte ohne axes-Schema -> strukturell nicht vergleichbar (sollte nie vorkommen)
    for (const ax of Object.keys(ra)) {
      const ks = ksDistance(la && la[ax], ra[ax]);
      // audit/fix (BH-074): eine fehlende Live-Kohorte/-Achse (la undefined) oder eine leere Verteilung
      // (ksDistance->null bei leerem Array) wurde bisher per `if(!la||!ra) continue`/`if(ks===null) continue`
      // STILL uebersprungen -> ein voller Kohortenkollaps hielt maxKs bei 0 und meldete ok:true (false-green
      // "Drift ok"). Nicht-vergleichbar ist selbst der maximale Drift-Fall (1.0), nicht "kein Drift" -> fail-loud.
      if (ks === null) { maxKs = 1; drifted.push({ cohort: key, axis: ax, ks: 1, reason: 'uncomparable' }); continue; }
      if (ks > maxKs) maxKs = ks;
      if (ks > ksThreshold) drifted.push({ cohort: key, axis: ax, ks: Math.round(ks * 1000) / 1000 });
    }
  }
  // 2.11 Stufe B (Verify-T2): auch die per-Kohorte-Wachstums-Verteilung (gDistByCohort) auf Drift pruefen —
  // sonst veraltet das kohorten-relative Boost-Lineal unbemerkt (der alte Waechter sah nur cohortBases-Achsen).
  const lg = (liveCal && liveCal.gDistByCohort) || {}, rg = (refCal && refCal.gDistByCohort) || {};
  for (const key of Object.keys(rg)) {
    const ks = ksDistance(lg[key], rg[key]);
    // audit/fix (BH-074): dieselbe Uncomparable=Drift-Regel wie oben (sonst gleiche false-green-Luecke
    // fuer das Wachstums-Lineal).
    if (ks === null) { maxKs = 1; drifted.push({ cohort: key, axis: 'gDist', ks: 1, reason: 'uncomparable' }); continue; }
    if (ks > maxKs) maxKs = ks;
    if (ks > ksThreshold) drifted.push({ cohort: key, axis: 'gDist', ks: Math.round(ks * 1000) / 1000 });
  }
  return { maxKs, ksThreshold, drifted, ok: maxKs <= ksThreshold };
}

module.exports = { scoreUniverse, rankBy, trackOf, rawAxisValue, produceRankings, phaseOf, mcapBandOf, ipoRecencyOf, ipoYearOf, calibrationDrift,
  // audit/fix (Bug 0/9/7): fuer calibrate.js — Kohorten-Gates + Winsor-Schranken exakt spiegeln
  learnWinsorBounds, winsorTailBounds, isDataSuspect, issuerDedupComparator, issuerKey,
  // AUFGABE 2 (Wachstums-Bonus): fuer TDD + gezielte Wiederverwendung
  growthBoostFactor, growthYoYComponents, robustG, growthPctlFn, boostFromPctl, GROWTH_BOOST_K,
  // PHASE 3 (Zyklus-Daempfer): fuer TDD + Mess-Skripte
  signFlips, oscExcess, revMaxDrawdown, cycleSignal, cycleDamperFactor, CYCLE_DAMPER_KD, CYCLE_DD_PCTL,
  // PHASE 4 (Refresh-Robustheit via committete SEC-Tiefe): fuer TDD
  normSec, cycleSeriesPair,
  // 2.10 (n-bewusste Scores): fuer TDD der synthetischen Kohorten-Tests
  shrinkToNeutral, SHRINK_K, MIN_COHORT_N,
  // 5.2 Small-Cap-Board: reine Funktion, additiv exportiert fuer den Coverage-Floor (run-screener.js)
  quantile };

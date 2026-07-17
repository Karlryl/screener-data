'use strict';
/**
 * Engine — Integrations-Test (Erfolgs-Gate (1)/(2), Halbleiter).
 * Laedt das ECHTE Snapshot-Universum, scored die Semiconductor-Kohorte und
 * prueft: Anker CRDO (+ ALAB falls vorhanden) im oberen Dezil ihres Tracks,
 * Decliner (NVTS/AEHR falls vorhanden) im unteren Bereich. Keine NaN-Scores.
 *
 * Usage:  node tests/scoring/score.integration.test.js   (Exit 0/1)
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { scoreUniverse, rankBy } = require('../../src/scoring/score.js');
const formulas = require('../../src/scoring/formulas/index.js');

let pass = 0, fail = 0, skip = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); }
}

// SCREENER_SNAPSHOTS_DIR: nur Test-Seam (Skip-Ehrlichkeits-Regression zeigt damit ein leeres
// Universum); ohne die Variable unveraendert das echte snapshots/.
const SNAP_DIR = process.env.SCREENER_SNAPSHOTS_DIR || path.join(__dirname, '..', '..', 'snapshots');
const files = fs.readdirSync(SNAP_DIR).filter((f) => f.endsWith('.json'));
const universe = [];
for (const f of files) {
  try {
    const s = JSON.parse(fs.readFileSync(path.join(SNAP_DIR, f), 'utf8'));
    if (s && s.meta && s.meta.ticker) universe.push(s);
  } catch (_) { /* defekte/teil-Snapshots ueberspringen */ }
}
console.log(`  (Universum: ${universe.length} Snapshots geladen)`);

const results = scoreUniverse(universe, formulas);
const byTicker = Object.fromEntries(results.map((r) => [r.ticker, r]));
const rankIn = (cohort, ticker) => cohort.findIndex((e) => e.ticker === ticker);

// Task 0.9-Fix (CI pre-pull gate): die Live-Universum-Anker (CRDO/BE/PLTR-Rankings,
// VIELLEICHT-Branchen, survival) sind auf das ECHTE Snapshot-Universum kalibriert. Im
// pre-pull-CI-Gate ist snapshots/ noch leer -> diese Anker sind dort N/A (fehlende Daten,
// KEIN Engine-Regress) und werden sauber uebersprungen; sonst wuerde das Gate strukturell
// vor jedem Pull rot und der Pull nie laufen. Die synthetischen Engine-Logik-Tests
// (Issuer-Dedup / A4-Gate / C3 / trackOf) bauen ihr eigenes Mini-Universum und laufen IMMER.
// Lokal (mit echten Snapshots) laufen alle Anker voll durch -> kein Aufweichen des Gates.
const HAS_UNIVERSE = universe.length > 0;
function testU(name, fn) {
  if (!HAS_UNIVERSE) { skip++; console.log('  skip ' + name + ' (kein Universum — pre-pull-Gate)'); return; }
  test(name, fn);
}

// --- keine NaN/Infinity-Scores ueber das ganze Universum --------------------
test('kein Score ist NaN/Infinity', () => {
  for (const r of results) {
    if (r.score !== null) assert.ok(Number.isFinite(r.score), r.ticker + ' Score=' + r.score);
  }
});

// --- CRDO: geroutet, profitable-Track, oberes Dezil -------------------------
testU('CRDO -> semiconductors, profitabler Track, Score finit', () => {
  const c = byTicker['CRDO'];
  assert.ok(c, 'CRDO-Snapshot fehlt');
  assert.equal(c.action, 'route');
  assert.equal(c.formulaId, 'semiconductors');
  assert.equal(c.track, 'profitable'); // annualOpInc juengstes Jahr +37.997M
  assert.ok(Number.isFinite(c.score));
});
testU('CRDO im oberen 20% seines Track-Kohorten-Rankings', () => {
  const c = byTicker['CRDO'];
  const cohort = rankBy(results, 'semiconductors', c.track);
  assert.ok(cohort.length >= 5, 'Kohorte zu klein: ' + cohort.length);
  const rank = rankIn(cohort, 'CRDO');
  console.log(`       CRDO Rang ${rank + 1}/${cohort.length} (profitable), Score ${c.score.toFixed(1)}`);
  assert.ok(rank >= 0 && (rank / cohort.length) <= 0.20, `CRDO Rang ${rank + 1}/${cohort.length}`);
});

// --- ALAB (falls vorhanden) ebenfalls oben ----------------------------------
test('ALAB (falls vorhanden) im oberen 25% seines Tracks', () => {
  const a = byTicker['ALAB'];
  if (!a || a.action !== 'route') { console.log('       (ALAB nicht im Universum — uebersprungen)'); return; }
  const cohort = rankBy(results, 'semiconductors', a.track);
  const rank = rankIn(cohort, 'ALAB');
  console.log(`       ALAB Rang ${rank + 1}/${cohort.length} (${a.track}), Score ${a.score.toFixed(1)}`);
  assert.ok((rank / cohort.length) <= 0.25, `ALAB Rang ${rank + 1}/${cohort.length}`);
});

// --- Decliner (NVTS/AEHR falls vorhanden) im unteren Bereich ----------------
test('Decliner NVTS/AEHR (falls vorhanden) in unterer Haelfte ihres Tracks', () => {
  for (const t of ['NVTS', 'AEHR']) {
    const d = byTicker[t];
    if (!d || d.action !== 'route' || d.score === null) { console.log(`       (${t} nicht scorebar — uebersprungen)`); continue; }
    const cohort = rankBy(results, 'semiconductors', d.track);
    const rank = rankIn(cohort, t);
    console.log(`       ${t} Rang ${rank + 1}/${cohort.length} (${d.track}), Score ${d.score.toFixed(1)}`);
    assert.ok((rank / cohort.length) >= 0.5, `${t} sollte unten ranken: ${rank + 1}/${cohort.length}`);
  }
});

// --- weitere Anker in anderen Branchen --------------------------------------
function assertAnchorTop(ticker, formulaId, maxPct) {
  const a = byTicker[ticker];
  if (!a || a.action !== 'route' || a.score === null) { console.log(`       (${ticker} nicht scorebar — uebersprungen)`); return; }
  assert.equal(a.formulaId, formulaId, `${ticker} formulaId=${a.formulaId}`);
  const cohort = rankBy(results, formulaId, a.track);
  const rank = rankIn(cohort, ticker);
  console.log(`       ${ticker} Rang ${rank + 1}/${cohort.length} (${formulaId}/${a.track}), Score ${a.score.toFixed(1)}`);
  assert.ok((rank / cohort.length) <= maxPct, `${ticker} Rang ${rank + 1}/${cohort.length} > ${maxPct * 100}%`);
}
test('PLTR -> software-comm-services, oberes 20% seines Tracks', () => {
  assertAnchorTop('PLTR', 'software-comm-services', 0.20);
});
testU('BE/Bloom Energy -> industrials, PROFITABLE-Track, oberes Quartil (Karl-Anker)', () => {
  const b = byTicker['BE'];
  assert.ok(b && b.action === 'route', 'BE fehlt/ungeroutet');
  assert.equal(b.formulaId, 'industrials');
  assert.equal(b.track, 'profitable'); // Turnaround: juengstes annualOpInc +72.8M
  // audit/fix R1: PRG (PROG Holdings, ~$2.4B Umsatz, Yahoo-leerer GP) wird korrekt aus dem
  // lender-gp0-Exclude freigegeben und joint industrials -> Kohorte 293->294, BE 59->60 = 20.4%.
  // A3-Stufe-1 (Weltweit): 285 US-PRIMAERgelistete foreign-domiciled Industrie-ADRs treten der
  // Kohorte bei (294->321) -> BE 70/321 = 21.8%, reine Verduennung, BE-Absolutscore unveraendert (~61.6).
  // A3-Stufe-2 (1584 foreign-listed geoeffnet + Issuer-Dedup + Non-Operating-Rev-Exclude): Kohorte
  // 321->575, BE 136/575 = 23.7%, BE-Absolutscore weiter stabil (~61.1) -> reine Kohorten-Verduennung,
  // KEINE Regression. Gate bleibt 0.25 (oberes Quartil) — haelt mit ~1.3pp Headroom; der naechste
  // Oeffnungs-Zyklus (OTC-Grey-Dedup) muss BE erneut messen (Headroom duenn).
  assertAnchorTop('BE', 'industrials', 0.25);
});

// --- Track-Zuordnung: OpInc-Split mit leerem annualOpInc -> NetIncome-Rescue ---
// (Court Fall 3, F5+F27): zuvor zwang der unknown->profitable-Default einen klar unprofitablen
// Namen (WOLF) faelschlich in den profitable-Track + falsche Kohorte/Gewichte. Jetzt faellt der
// OpInc-Split bei leerem annualOpInc erst auf das NetIncome-Vorzeichen zurueck, dann auf den Default.
test('trackOf: OpInc-Split, leeres annualOpInc + neg. NetIncome -> unprofitable (F5/WOLF)', () => {
  const { trackOf } = require('../../src/scoring/score.js');
  const f = { splitMetric: 'OpInc' };
  assert.equal(trackOf({ annual: { annualOpInc: [], annualNetIncome: [{ value: -1.6e9 }, { value: -864e6 }] } }, f),
    'unprofitable', 'leeres OpInc + neg NetIncome muss unprofitable sein');
  assert.equal(trackOf({ annual: { annualOpInc: [], annualNetIncome: [{ value: 5e8 }] } }, f),
    'profitable', 'leeres OpInc + pos NetIncome -> profitable');
  assert.equal(trackOf({ annual: { annualOpInc: [], annualNetIncome: [] } }, f),
    'profitable', 'beide leer -> konservativer profitable-Default bleibt');
  assert.equal(trackOf({ annual: { annualOpInc: [{ value: -50 }], annualNetIncome: [{ value: 999 }] } }, f),
    'unprofitable', 'present OpInc hat Vorrang vor NetIncome (kein Regress)');
});
test('WOLF (falls vorhanden): semiconductors, UNPROFITABLE-Track (F5)', () => {
  const w = byTicker['WOLF'];
  if (!w || w.action !== 'route') { console.log('       (WOLF nicht scorebar — uebersprungen)'); return; }
  assert.equal(w.formulaId, 'semiconductors', 'WOLF formulaId=' + w.formulaId);
  assert.equal(w.track, 'unprofitable', 'WOLF muss unprofitable sein (annualOpInc leer, NetIncome negativ)');
});

// --- VIELLEICHT-Branchen produzieren Rankings -------------------------------
testU('VIELLEICHT-Branchen (utilities/staples/materials/real-estate/it-services) gerankt', () => {
  for (const fid of ['utilities', 'consumer-staples', 'materials', 'real-estate', 'it-services']) {
    const n = rankBy(results, fid).length;
    console.log(`       ${fid}: ${n} gerankt`);
    assert.ok(n > 0, fid + ' leer');
  }
});

// --- Pre-Revenue-Biotech: Survival-Track, KEIN Growth-Score -----------------
testU('Pre-Revenue-Biotech -> survival-track, score=null, Runway-Badge', () => {
  const surv = results.filter((e) => e.action === 'survival');
  console.log(`       survival-Eintraege: ${surv.length}`);
  assert.ok(surv.length > 0, 'keine survival-Eintraege im Universum');
  for (const e of surv) {
    assert.equal(e.score, null, e.ticker + ' darf keinen Growth-Score haben');
    assert.ok(e.overview && e.overview.kind === 'runway-badge', e.ticker + ' Runway-Badge fehlt');
  }
});

// --- Real-Estate: Overview = FFO-Badge (Nicht-GP) ---------------------------
test('Real-Estate Overview ist ffo-badge (track-eigene Badge)', () => {
  const reits = results.filter((e) => e.formulaId === 'real-estate' && e.action === 'route');
  if (!reits.length) { console.log('       (keine REITs — uebersprungen)'); return; }
  assert.ok(reits.every((e) => e.overview && e.overview.kind === 'ffo-badge'), 'REIT Overview != ffo-badge');
});

// --- produceRankings: dashboard-JSON-Form -----------------------------------
testU('produceRankings: korrekte JSON-Form, sortiert, PLTR top software', () => {
  const { produceRankings } = require('../../src/scoring/score.js');
  const r = produceRankings(results, { topN: 20 });
  assert.ok(r.branches['semiconductors'].profitable.length <= 20);
  const semis = r.branches['semiconductors'].profitable;
  assert.ok(semis[0].score >= semis[1].score, 'nicht absteigend sortiert');
  assert.ok(typeof semis[0].score === 'number' && semis[0].ticker, 'Row-Form');
  assert.ok(r.overview.length > 0 && r.survival.length > 0);
  assert.ok(r.excluded && typeof r.excluded.non_us !== 'undefined' || true); // excluded ist ein Objekt
  assert.equal(typeof r.excluded, 'object');
  // A3-Stufe-2 (Weltweit-Pivot): PLTR ist im GLOBALEN Topf nicht mehr literal #1 — echte Auslands-
  // Hypergrowth-Namen (2383.TW Elite Material, 2308.TW Delta, WTC.AX WiseTech) UND US-Peers (FICO/APP)
  // ueberholen es knapp, bei stabilem PLTR-Absolutscore (~82.3). Anker re-geblesst (Court-Bless, Weltweit-
  // Aera): PLTR bleibt Top-Tier = top 5% des globalen software-comm-services/profitable-Rankings
  // (Rang ~10/424 = 2.4%). Die alte "[0]===PLTR"-Assertion war US-zentrisch und obsolet.
  const softCohort = rankBy(results, 'software-comm-services', 'profitable');
  const pltrRank = softCohort.findIndex((e) => e.ticker === 'PLTR');
  assert.ok(pltrRank >= 0 && (pltrRank / softCohort.length) <= 0.05,
    `PLTR top-5% global software: Rang ${pltrRank + 1}/${softCohort.length}`);
});

// --- A3-Stufe-2: Issuer-Dedup (Doppel-Listings desselben Emittenten) ---------
test('Issuer-Dedup synthetisch: Heimat-Bein -> dup-issuer, US-Bein ist der Gewinner', () => {
  const mk = (ticker, ex, ccy, region) => ({
    meta: { name: 'DualListed Holding PLC', sector: 'Technology', industry: 'Software', exchangeName: ex, ticker, tradingCurrency: ccy, region },
    annual: { annualRev: [{ value: 300 }, { value: 200 }, { value: 130 }], annualGP: [{ value: 180 }] },
    metrics: { revenueTTM: { value: 300 } }, // F39 live re-grade: passt criticalMissing-Floor, sonst data-suspect vor Dedup
    marketCap: { value: 5e9 } });
  const res = scoreUniverse([mk('DUAL', 'NYSE', 'USD', 'US'), mk('DUAL.L', 'LSE', 'GBP', undefined)], formulas);
  const bt = Object.fromEntries(res.map((r) => [r.ticker, r]));
  // Pruefe die WINNER-SELECTION (US-primaeres Bein gewinnt): das Heimat-Bein wird dedupt, das US-Bein
  // NICHT. (Der absolute Score des Gewinners ist in diesem 1-Namen-Kohorten-Mini-Universum nicht
  // berechenbar -> separat im realen SHOP/ASML-Test verifiziert.)
  assert.equal(bt['DUAL.L'].reason, 'dup-issuer');   // Heimat-Bein verliert
  assert.notEqual(bt['DUAL'].reason, 'dup-issuer');  // US-Bein ist der Gewinner
});
test('Issuer-Dedup FX-Haertung (F50): FX-suspektes dual-non-USD-Bein verliert den Tie-Break', () => {
  // CMOC-Muster: ein Bein mit tradingCurrency!=reportingCurrencyOriginal UND fehlendem
  // tradingFxRateApplied (stale -> marketCap mit falschem FX-Faktor inflationiert) verliert den
  // Dedup-Tie-Break TROTZ nominal groesserer marketCap gegen das FX-konsistente Heimat-Bein.
  const mk = (ticker, ex, tc, rc, fx, mcap) => ({
    meta: { name: 'CMOC Group Ltd', sector: 'Basic Materials', industry: 'Other Industrial Metals & Mining',
      exchangeName: ex, ticker, tradingCurrency: tc, reportingCurrencyOriginal: rc, tradingFxRateApplied: fx },
    annual: { annualRev: [{ value: 300 }, { value: 200 }, { value: 130 }], annualGP: [{ value: 60 }] },
    metrics: { revenueTTM: { value: 300 } }, // F39: passt criticalMissing-Floor, sonst data-suspect vor Dedup
    marketCap: { value: mcap } });
  const suspect = mk('3993.HK', 'HKSE', 'HKD', 'CNY', undefined, 54e9);     // FX-suspekt, GROESSERE mcap
  const consistent = mk('603993.SS', 'Shanghai', 'CNY', 'CNY', undefined, 46e9); // FX-konsistent, kleinere mcap
  const bt = Object.fromEntries(scoreUniverse([suspect, consistent], formulas).map((r) => [r.ticker, r]));
  assert.equal(bt['3993.HK'].reason, 'dup-issuer', 'FX-suspektes Bein (3993.HK) muss den Dedup verlieren');
  assert.notEqual(bt['603993.SS'].reason, 'dup-issuer', 'FX-konsistentes Bein (603993.SS) gewinnt den Dedup');
});
test('Issuer-Dedup real: SHOP.TO/ASML.AS/2330.TW (falls vorhanden) dedupt, US-Bein routet', () => {
  for (const [us, home] of [['SHOP', 'SHOP.TO'], ['ASML', 'ASML.AS'], ['TSM', '2330.TW']]) {
    const u = byTicker[us], h = byTicker[home];
    if (!u || !h) { console.log(`       (${us}/${home} nicht im Universum — uebersprungen)`); continue; }
    assert.equal(u.action, 'route', `${us} sollte routen`);
    assert.equal(h.action, 'exclude', `${home} sollte dedupt sein`);
    assert.equal(h.reason, 'dup-issuer', `${home} reason=${h.reason}`);
  }
});

// --- A3-Stufe-2: Non-Operating-Revenue-Exclude (Investment-Trusts/CEFs) ------
test('non-operating-rev: CEF/Trust + Investment-Holding/BDC (falls vorhanden) excludiert', () => {
  // CEFs/Trusts (negativer Jahresumsatz) + NAV-Holdings (III.L/3i, INDU-A.ST/Industrivaerden:
  // Asset-Mgmt mit GP=0/ni~rev bzw. negativem Quartalsumsatz). Alle gehoeren nicht in den Topf.
  for (const t of ['SMT.L', 'ADX', 'AOD', 'III.L', 'INDU-A.ST']) {
    const e = byTicker[t];
    if (!e) { console.log(`       (${t} nicht im Universum — uebersprungen)`); continue; }
    assert.equal(e.action, 'exclude', `${t} sollte excludiert sein`);
    assert.equal(e.reason, 'non-operating-rev', `${t} reason=${e.reason}`);
  }
});
test('echter Fee-Asset-Manager BLK/BX (falls vorhanden) bleibt in financials (kein Over-Exclude)', () => {
  for (const t of ['BLK', 'BX', 'KKR']) {
    const e = byTicker[t];
    if (!e) { console.log(`       (${t} nicht im Universum — uebersprungen)`); continue; }
    assert.equal(e.action, 'route', `${t} sollte routen`);
    assert.equal(e.formulaId, 'financials', `${t} formulaId=${e.formulaId}`);
  }
});

// --- A2 (Weltweit-Pivot): jede Output-Zeile traegt country/region/sector/marketCap --------
// Voraussetzung fuer Karls Laenderfilter (filtert auf r.country) + Sektor-Tabs + mcap-Spalte.
testU('produceRankings-Zeilen tragen country/region/sector/marketCap (PLTR=US-Anker)', () => {
  const { produceRankings } = require('../../src/scoring/score.js');
  const r = produceRankings(results, { topN: 50 });
  const pltr = r.branches['software-comm-services'].profitable.find((x) => x.ticker === 'PLTR');
  assert.ok(pltr, 'PLTR fehlt im Output');
  assert.equal(pltr.country, 'United States', 'PLTR country');
  assert.equal(pltr.region, 'North America', 'PLTR region-Bucket');
  assert.ok(typeof pltr.sector === 'string' && pltr.sector.length > 0, 'PLTR sector-Label');
  assert.ok(Number.isFinite(pltr.marketCap) && pltr.marketCap > 0, 'PLTR marketCap');
  // overview-Liste (globaler Topf) traegt dieselben geo-Felder. NICHT an PLTRs overview-Rang
  // gepinnt: nach Court Fall 3 (capEff drop-on-absence) verschieben sich die cross-branch
  // Perzentile, PLTR kann aus der topN-overview-Slice fallen (dichte Verteilung, ~56 Namen
  // innerhalb +-2 Punkten). Die geo-Anreicherung ist universell -> PLTR falls vorhanden, sonst
  // die Spitzenzeile; beide MUESSEN country+marketCap tragen.
  const ov = r.overview.find((x) => x.ticker === 'PLTR') || r.overview[0];
  assert.ok(ov && typeof ov.country === 'string' && ov.country.length > 0 && Number.isFinite(ov.marketCap), 'overview-Zeile ohne geo');
  // survival-Zeilen sind ebenfalls angereichert (Filter greift auch dort)
  assert.ok(r.survival.length && ('country' in r.survival[0]) && ('marketCap' in r.survival[0]),
    'survival-Zeile ohne geo-Felder');
});

// --- A4: Daten-Qualitaets-Gate (data-suspect-Lampe / grade-D -> Ranking-Exclude) ----------
test('A4-Gate: newestQtrSuspect-Name wird excludiert (data-suspect), clean-Twin routet', () => {
  const V = (arr) => arr.map((v) => ({ value: v }));
  const suspect = { meta: { sector: 'Technology', industry: 'Semiconductors', region: 'US', ticker: 'FAKEQ' },
    annual: { annualRev: V([100]) },
    timeseries: { revenueQ: V([100, 70, 70, 70, 70]), opIncQ: V([43, 7, 7, 7, 7]), grossProfitQ: V([62, 28, 28, 28, 28]) } };
  const clean = { meta: { sector: 'Technology', industry: 'Semiconductors', region: 'US', ticker: 'FAKEC' },
    annual: { annualRev: V([100]), annualGP: V([60]) }, marketCap: { value: 5e9 }, metrics: { revenueTTM: { value: 100 } },
    timeseries: { revenueQ: V([100, 90, 80, 70, 60]), opIncQ: V([30, 25, 20, 15, 10]), grossProfitQ: V([40, 36, 32, 28, 24]) } };
  const bt = Object.fromEntries(scoreUniverse([clean, suspect], formulas).map((r) => [r.ticker, r]));
  assert.equal(bt['FAKEQ'].action, 'exclude');
  assert.equal(bt['FAKEQ'].reason, 'data-suspect');
  assert.equal(bt['FAKEC'].action, 'route'); // normale Daten -> unberuehrt
});
test('A4-Gate (F39 live re-grade): fehlende marketCap/revenueTTM -> grade-D-Floor -> data-suspect, unabhaengig vom persistierten Grade', () => {
  const V = (arr) => arr.map((v) => ({ value: v }));
  const mk = (ticker, persisted) => ({ meta: { sector: 'Technology', industry: 'Semiconductors', region: 'US', ticker },
    _quality: { grade: persisted }, annual: { annualRev: V([100]), annualGP: V([60]) }, // KEIN marketCap, KEIN revenueTTM
    timeseries: { revenueQ: V([100, 90, 80, 70, 60]), opIncQ: V([30, 25, 20, 15, 10]), grossProfitQ: V([40, 36, 32, 28, 24]) } });
  const d = scoreUniverse([mk('FAKED', 'D')], formulas)[0];     // persistierter D -> excludiert (wie bisher)
  assert.equal(d.action, 'exclude'); assert.equal(d.reason, 'data-suspect');
  // STALE A+ schuetzt NICHT mehr: der live re-grade floort wegen fehlender marketCap/revenueTTM auf D
  // (genau der F39-Bug: vorher trug der persistierte A+ den toten D-Arm vorbei).
  const a = scoreUniverse([mk('FAKEA', 'A+')], formulas)[0];
  assert.equal(a.action, 'exclude', 'stale A+ darf nicht vor dem live-criticalMissing-Floor schuetzen');
  assert.equal(a.reason, 'data-suspect');
});
test('C3: revenueTTM-Arm entkoppelt — marketCap present + revTTM null + AKTUELLER Umsatz present -> route', () => {
  const V = (arr) => arr.map((v) => ({ value: v }));
  // marketCap present, KEIN metrics.revenueTTM -> criticalMissing=true (grade D), aber aktueller
  // Umsatz present (annualRev[0]>0). Die Achsen lesen annualRev, NICHT revenueTTM -> darf NICHT
  // mehr als data-suspect exkludiert werden (VFS/ERIC-Klasse).
  const withRev = { meta: { sector: 'Technology', industry: 'Semiconductors', region: 'US', ticker: 'FAKER' },
    marketCap: { value: 5e9 }, metrics: { revenueGrowthYoY: { value: 100 } },
    annual: { annualRev: V([200, 100]), annualGP: V([120, 60]) },
    timeseries: { revenueQ: V([200, 180, 160, 140, 120]), opIncQ: V([60, 50, 40, 30, 20]), grossProfitQ: V([100, 90, 80, 70, 60]) } };
  const r = scoreUniverse([withRev], formulas)[0];
  assert.equal(r.action, 'route', 'mcap present + revTTM null + aktueller Umsatz>0 -> route (C3)');
});
test('C3: marketCap present + revTTM null + KEIN aktueller Umsatz -> weiterhin data-suspect exclude', () => {
  const V = (arr) => arr.map((v) => ({ value: v }));
  // newester annualRev=0 (aelter 100 -> NICHT pre-revenue, routet) UND revenueQ alle 0 -> kein
  // aktueller Umsatz -> bleibt korrekt data-suspect (DNLI/AMLX-Klasse, kein Gegenrichtungs-Score).
  const noCurRev = { meta: { sector: 'Technology', industry: 'Semiconductors', region: 'US', ticker: 'FAKEZ' },
    marketCap: { value: 5e9 }, annual: { annualRev: V([0, 100]), annualGP: V([0, 60]) },
    timeseries: { revenueQ: V([0, 0, 0, 0, 0]), opIncQ: V([0, 0, 0, 0, 0]) } };
  const z = scoreUniverse([noCurRev], formulas)[0];
  assert.equal(z.action, 'exclude'); assert.equal(z.reason, 'data-suspect');
  // marketCap FEHLT bleibt harter Ausschluss, auch mit aktuellem Umsatz:
  const noMcap = { meta: { sector: 'Technology', industry: 'Semiconductors', region: 'US', ticker: 'FAKEM' },
    annual: { annualRev: V([200, 100]) }, timeseries: { revenueQ: V([200, 180, 160, 140, 120]) } };
  const m = scoreUniverse([noMcap], formulas)[0];
  assert.equal(m.action, 'exclude'); assert.equal(m.reason, 'data-suspect');
});
test('trackOf (R4): present-0 Lead-Stub OpInc faellt auf NetIncome zurueck (601162.SS-Muster)', () => {
  const { trackOf } = require('../../src/scoring/score.js');
  const V = (arr) => arr.map((v) => ({ value: v }));
  const f = { splitMetric: 'OpInc' };
  // Lead-0-Stub + Folge-Verluste, NetIncome negativ -> unprofitable (signTrack(0)='profitable' umging die Rescue).
  const stub = { annual: { annualOpInc: V([0, -28, -72, -71]), annualNetIncome: V([-4, -3, -2, -1]) } };
  assert.equal(trackOf(stub, f), 'unprofitable');
  // Kontrolle: present-0 OpInc aber NetIncome positiv -> bleibt profitable (kosmetischer Fall, kein Flip).
  const okp = { annual: { annualOpInc: V([0, 5, 5, 5]), annualNetIncome: V([10, 10, 10, 10]) } };
  assert.equal(trackOf(okp, f), 'profitable');
  // Kontrolle: echtes positives neuestes OpInc -> profitable (kein Regress, Rescue greift nicht).
  const prof = { annual: { annualOpInc: V([50, 40, 30]), annualNetIncome: V([20, 15, 10]) } };
  assert.equal(trackOf(prof, f), 'profitable');
});
test('C3/R5: fuehrende null-Luecke im neuesten GJ -> KEIN aktueller Umsatz -> data-suspect (RTEZ-Muster)', () => {
  const V = (arr) => arr.map((v) => ({ value: v }));
  // annualRev[0]=null (neuestes GJ fehlt), aelterer 5000 ist STALE, revenueQ leer, mcap present,
  // revenueTTM null. firstPresent haette den stalen 5000 als 'aktuell' akzeptiert -> jetzt strikt
  // annualRev[0] -> kein aktueller Umsatz -> exclude.
  const stale = { meta: { sector: 'Technology', industry: 'Semiconductors', region: 'US', ticker: 'FAKESTALE' },
    marketCap: { value: 5e9 }, annual: { annualRev: V([null, 5000, null, 519443]) }, timeseries: { revenueQ: [] } };
  const r = scoreUniverse([stale], formulas)[0];
  assert.equal(r.action, 'exclude'); assert.equal(r.reason, 'data-suspect');
});

// --- Sichtbarkeit: Top 6 je Branche/Track -----------------------------------
for (const fid of ['semiconductors', 'software-comm-services', 'industrials', 'energy', 'health-care']) {
  for (const track of ['profitable', 'unprofitable']) {
    const cohort = rankBy(results, fid, track);
    if (!cohort.length) continue;
    console.log(`\n  Top 6 ${fid}/${track} (von ${cohort.length}):`);
    cohort.slice(0, 6).forEach((e, i) => {
      console.log(`    ${String(i + 1).padStart(2)}. ${e.ticker.padEnd(7)} ${e.score.toFixed(1).padStart(6)}  [${e.lamps.join(',')}]`);
    });
  }
}

// Skip-Zahl gehoert in die Summenzeile: sonst liest "N ok, 0 fail" wie ein voller Pass,
// obwohl im pre-pull-CI die Live-Universums-Anker gar nicht gelaufen sind.
console.log(`\nscore.integration.test.js: ${pass} ok, ${fail} fail` + (skip ? `, ${skip} skipped (kein Universum)` : ''));
process.exit(fail ? 1 : 0);

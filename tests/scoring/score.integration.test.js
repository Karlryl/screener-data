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

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); }
}

const SNAP_DIR = path.join(__dirname, '..', '..', 'snapshots');
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

// --- keine NaN/Infinity-Scores ueber das ganze Universum --------------------
test('kein Score ist NaN/Infinity', () => {
  for (const r of results) {
    if (r.score !== null) assert.ok(Number.isFinite(r.score), r.ticker + ' Score=' + r.score);
  }
});

// --- CRDO: geroutet, profitable-Track, oberes Dezil -------------------------
test('CRDO -> semiconductors, profitabler Track, Score finit', () => {
  const c = byTicker['CRDO'];
  assert.ok(c, 'CRDO-Snapshot fehlt');
  assert.equal(c.action, 'route');
  assert.equal(c.formulaId, 'semiconductors');
  assert.equal(c.track, 'profitable'); // annualOpInc juengstes Jahr +37.997M
  assert.ok(Number.isFinite(c.score));
});
test('CRDO im oberen 20% seines Track-Kohorten-Rankings', () => {
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
test('BE/Bloom Energy -> industrials, PROFITABLE-Track, oberes Quartil (Karl-Anker)', () => {
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

// --- VIELLEICHT-Branchen produzieren Rankings -------------------------------
test('VIELLEICHT-Branchen (utilities/staples/materials/real-estate/it-services) gerankt', () => {
  for (const fid of ['utilities', 'consumer-staples', 'materials', 'real-estate', 'it-services']) {
    const n = rankBy(results, fid).length;
    console.log(`       ${fid}: ${n} gerankt`);
    assert.ok(n > 0, fid + ' leer');
  }
});

// --- Pre-Revenue-Biotech: Survival-Track, KEIN Growth-Score -----------------
test('Pre-Revenue-Biotech -> survival-track, score=null, Runway-Badge', () => {
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
test('produceRankings: korrekte JSON-Form, sortiert, PLTR top software', () => {
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
    marketCap: { value: 5e9 } });
  const res = scoreUniverse([mk('DUAL', 'NYSE', 'USD', 'US'), mk('DUAL.L', 'LSE', 'GBP', undefined)], formulas);
  const bt = Object.fromEntries(res.map((r) => [r.ticker, r]));
  // Pruefe die WINNER-SELECTION (US-primaeres Bein gewinnt): das Heimat-Bein wird dedupt, das US-Bein
  // NICHT. (Der absolute Score des Gewinners ist in diesem 1-Namen-Kohorten-Mini-Universum nicht
  // berechenbar -> separat im realen SHOP/ASML-Test verifiziert.)
  assert.equal(bt['DUAL.L'].reason, 'dup-issuer');   // Heimat-Bein verliert
  assert.notEqual(bt['DUAL'].reason, 'dup-issuer');  // US-Bein ist der Gewinner
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
test('non-operating-rev: Closed-End-Fund/Investment-Trust (falls vorhanden) excludiert', () => {
  for (const t of ['SMT.L', 'ADX', 'AOD']) {
    const e = byTicker[t];
    if (!e) { console.log(`       (${t} nicht im Universum — uebersprungen)`); continue; }
    assert.equal(e.action, 'exclude', `${t} sollte excludiert sein`);
    assert.equal(e.reason, 'non-operating-rev', `${t} reason=${e.reason}`);
  }
});

// --- A2 (Weltweit-Pivot): jede Output-Zeile traegt country/region/sector/marketCap --------
// Voraussetzung fuer Karls Laenderfilter (filtert auf r.country) + Sektor-Tabs + mcap-Spalte.
test('produceRankings-Zeilen tragen country/region/sector/marketCap (PLTR=US-Anker)', () => {
  const { produceRankings } = require('../../src/scoring/score.js');
  const r = produceRankings(results, { topN: 50 });
  const pltr = r.branches['software-comm-services'].profitable.find((x) => x.ticker === 'PLTR');
  assert.ok(pltr, 'PLTR fehlt im Output');
  assert.equal(pltr.country, 'United States', 'PLTR country');
  assert.equal(pltr.region, 'North America', 'PLTR region-Bucket');
  assert.ok(typeof pltr.sector === 'string' && pltr.sector.length > 0, 'PLTR sector-Label');
  assert.ok(Number.isFinite(pltr.marketCap) && pltr.marketCap > 0, 'PLTR marketCap');
  // overview-Liste (globaler Topf) traegt dieselben Felder
  const ov = r.overview.find((x) => x.ticker === 'PLTR');
  assert.ok(ov && ov.country === 'United States' && Number.isFinite(ov.marketCap), 'overview-Zeile ohne geo');
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
    annual: { annualRev: V([100]), annualGP: V([60]) },
    timeseries: { revenueQ: V([100, 90, 80, 70, 60]), opIncQ: V([30, 25, 20, 15, 10]), grossProfitQ: V([40, 36, 32, 28, 24]) } };
  const bt = Object.fromEntries(scoreUniverse([clean, suspect], formulas).map((r) => [r.ticker, r]));
  assert.equal(bt['FAKEQ'].action, 'exclude');
  assert.equal(bt['FAKEQ'].reason, 'data-suspect');
  assert.equal(bt['FAKEC'].action, 'route'); // normale Daten -> unberuehrt
});
test('A4-Gate: _quality.grade=D excludiert auch ohne Lampe', () => {
  const V = (arr) => arr.map((v) => ({ value: v }));
  const d = { meta: { sector: 'Technology', industry: 'Semiconductors', region: 'US', ticker: 'FAKED' },
    _quality: { grade: 'D' }, annual: { annualRev: V([100]), annualGP: V([60]) },
    timeseries: { revenueQ: V([100, 90, 80, 70, 60]), opIncQ: V([30, 25, 20, 15, 10]), grossProfitQ: V([40, 36, 32, 28, 24]) } };
  const res = scoreUniverse([d], formulas);
  assert.equal(res[0].action, 'exclude');
  assert.equal(res[0].reason, 'data-suspect');
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

console.log(`\nscore.integration.test.js: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);

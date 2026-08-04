'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { shareGrowthRate, buildShareGrowthPctlFn, shareCountDilution, shareDilutionDetail, TH, LAMPS } = require('../../src/scoring/lamps.js');

// Echte SEC-annual-Aktienzahl-Serien (external-data/sec-secannual.json, 2026-07-21-Regen), newest-first,
// als {value}-Objekte wie run-screener.js sie in snapshot.secAnnual.annualShares anliefert.
const asShares = (arr) => arr.map((v) => ({ value: v }));
function snap(annualShares) { return { secAnnual: { annualShares: asShares(annualShares) } }; }

// NVAX: 15 Jahre, ENTHAELT einen echten 1:~14.4-Reverse-Split (382850125 -> 26577433 zwischen zwei GJ)
// UND nachhaltige echte Verwaesserung in den uebrigen Jahren (Novavax' bekannte Secondary-Historie).
const NVAX = [162498995, 160184994, 118790222, 78503952, 75608073, 63659952, 26577433, 382850125,
  313616221, 271245967, 269858393, 238477974, 208510739, 147941442, 114971796];
// MMI: 13 Jahre, praktisch flache Aktienzahl (kein aktives Verwaesserungs-/Buyback-Programm) -> Negativ-Fixture.
const MMI = [38922604, 38823704, 38384569, 39365723, 39667728, 39376477, 39132236, 38651360,
  38140801, 37616243, 37117674, 36623781, 36600897];
// GME: 17 Jahre, ENTHAELT den bekannten 4-fuer-1-Split (Juli 2022): 304578070 -> 76350781 (Ratio~3.989).
const GME = [448009480, 446800365, 305514315, 304578070, 76350781, 69746960, 65922283, 101967550,
  101304394, 101874578, 104670330, 108515426, 115810737, 121180041, 136424174, 151396983, 164767330];

test('shareGrowthRate: Split/Reverse-Split-Beine werden ausgefiltert, organische Beine bleiben', () => {
  // NVAX-Reverse-Split-Bein waere -93% (26577433/382850125-1) -- Median bleibt deutlich positiv, kein
  // Verzerrungs-Ausreisser durch den Split.
  const gNvax = shareGrowthRate(snap(NVAX));
  assert.ok(gNvax > 0.1, `NVAX Median-Wachstum sollte trotz Reverse-Split klar positiv sein, war ${gNvax}`);
  // GME-4:1-Split waere +299% (304578070/76350781-1) -- ohne Gate wuerde das den Median komplett kippen.
  const gGme = shareGrowthRate(snap(GME));
  assert.ok(gGme < 0.05, `GME Median-Wachstum sollte nach Split-Filter klein/negativ sein (Buyback-Historie), war ${gGme}`);
  const gMmi = shareGrowthRate(snap(MMI));
  assert.ok(Math.abs(gMmi) < 0.02, `MMI sollte nahezu flach sein, war ${gMmi}`);
});

test('shareCountDilution: Positiv-Fixture (NVAX) leuchtet, Negativ-Fixture (MMI) nicht, im selben Kohorten-Kontext', () => {
  const cohort = [snap(NVAX), snap(MMI), snap(GME)];
  const pctlFn = buildShareGrowthPctlFn(cohort);
  assert.ok(typeof pctlFn === 'function', 'Kohorte mit 3 distinkten Werten sollte eine Perzentil-Funktion liefern');
  const ctx = { shareGrowthPctlFn: pctlFn };
  assert.equal(shareCountDilution(snap(NVAX), ctx), true, 'NVAX (staerkste organische Verwaesserung der Kohorte) muss feuern');
  assert.equal(shareCountDilution(snap(MMI), ctx), false, 'MMI (flach) darf nicht feuern');
});

test('shareCountDilution: ohne Kohorten-Kontext (HG/QC-Boards) nicht bewertbar (null), byte-identisches Verhalten dort', () => {
  assert.equal(shareCountDilution(snap(NVAX), undefined), null);
  assert.equal(shareCountDilution(snap(NVAX), {}), null);
});

test('shareCountDilution: fehlende secAnnual.annualShares -> nicht bewertbar (null)', () => {
  assert.equal(shareGrowthRate({}), null);
  assert.equal(shareCountDilution({}, { shareGrowthPctlFn: () => 0.9 }), null);
});

// --- Reichweite (Review-Befund 03.08.2026) ----------------------------------
// Die Lampe las NUR secAnnual (~100 Namen) und war fuer 99 % des Universums stumm — am
// lokalen Baum sogar fuer 100 % (0 von 3.042 gerouteten Zeilen hatten ueberhaupt eine
// Wachstumsrate). Yahoo liefert dieselbe Groesse fuer 12.418 von 12.501 Snapshots, nur
// flacher (~4 GJ statt 10-15). GATE VOR DEM UMBAU: die Lampe hat KEINEN Score-Effekt —
// sie steht nicht in DATA_SUSPECT_LAMPS und wird in runSmallcapPass erst NACH
// scoreUniverse angehaengt. Deshalb darf sie ausgeweitet werden.
test('shareGrowthRate: faellt auf die Yahoo-Jahresreihe zurueck, wenn secAnnual fehlt', () => {
  // Yahoo speichert annualShares als SKALAR-Array (FIELD_REGISTRY), newest-first.
  const yahooSnap = (arr) => ({ annual: { annualShares: arr } });
  const g = shareGrowthRate(yahooSnap([110, 105, 100, 100]));
  assert.ok(g !== null, 'die Yahoo-Reihe muss gelesen werden');
  assert.ok(g > 0.02 && g < 0.06, `Median der Beine ~4,8 %/4,8 %/0 % erwartet, war ${g}`);
  // Ohne JEDE Quelle bleibt es null (unveraendert).
  assert.equal(shareGrowthRate({ annual: {} }), null);
});

test('shareGrowthRate: die TIEFE SEC-Reihe hat Vorrang vor der flachen Yahoo-Reihe', () => {
  const beides = { secAnnual: { annualShares: asShares(MMI) }, annual: { annualShares: [200, 100] } };
  // Yahoo allein waere +100 % — kommt die flache Reihe durch, ist der Vorrang gebrochen.
  const g = shareGrowthRate(beides);
  assert.ok(Math.abs(g) < 0.02, `MMI (flach) muss gewinnen, war ${g}`);
});

test('shareGrowthRate: der Split-Guard wirkt auch auf der Yahoo-Reihe', () => {
  // 4-fuer-1-Split zwischen den zwei juengsten Jahren (Ratio 4) plus zwei organische Beine.
  const g = shareGrowthRate({ annual: { annualShares: [400, 100, 98, 96] } });
  assert.ok(g !== null && g < 0.05,
    `das Split-Bein (Ratio 4) muss ausgefiltert werden, sonst kippt der Median; war ${g}`);
});

test('FIELD_REGISTRY kennt annualShares als annual/scalar (sonst wirft norm)', () => {
  const { FIELD_REGISTRY, norm } = require('../../src/scoring/snapshot.js');
  assert.deepEqual(FIELD_REGISTRY.annualShares, ['annual', 'scalar']);
  assert.deepEqual(norm({ annual: { annualShares: [10, null, 8] } }, 'annualShares'), [10, null, 8]);
});

// --- Erreichbarkeit (Review-Befund 03.08.2026, der schwerere Teil) ----------
// Die Nachbearbeitung in runSmallcapPass las e.snapshot — das loescht scoreUniverse aber am
// Ende jedes Laufs (score.js :1242). Sie bekam also fuer JEDE Zeile undefined,
// buildShareGrowthPctlFn lieferte fuer JEDE Kohorte null, und die Lampe konnte seit ihrer
// Verdrahtung strukturell NIE feuern. Unsichtbar war das, weil "keine Lampe" genauso aussieht
// wie "keine Verwaesserung". Dieser Waechter fuehrt die echte Produktionsfunktion aus.
test('lampeBNachruesten: die Lampe erreicht die Ergebniszeilen wirklich (Ergebniszeilen OHNE .snapshot)', () => {
  const { lampeBNachruesten } = require('../../src/scoring/run-screener.js');
  const universum = [
    { meta: { ticker: 'NVAXT' }, secAnnual: { annualShares: asShares(NVAX) } },
    { meta: { ticker: 'MMIT' }, secAnnual: { annualShares: asShares(MMI) } },
    { meta: { ticker: 'GMET' }, secAnnual: { annualShares: asShares(GME) } },
  ];
  // GENAU die Form, die scoreUniverse zurueckgibt: mit ticker, OHNE snapshot.
  const zeilen = ['NVAXT', 'MMIT', 'GMET'].map((t, i) => ({
    ticker: t, action: 'route', score: 50 - i, formulaId: 'testformel', track: 'profitable', lamps: [],
  }));
  const gefeuert = lampeBNachruesten(zeilen, universum);
  assert.equal(gefeuert, 1, 'genau der staerkste Verwaesserer der Kohorte muss feuern');
  assert.deepEqual(zeilen[0].lamps, ['shareCountDilution'], 'NVAXT (p75+) muss die Lampe tragen');
  assert.deepEqual(zeilen[1].lamps, [], 'MMIT (flach) darf sie nicht tragen');
});

test('lampeBNachruesten: nicht-geroutete Zeilen bleiben unberuehrt', () => {
  const { lampeBNachruesten } = require('../../src/scoring/run-screener.js');
  const universum = [{ meta: { ticker: 'NVAXT' }, secAnnual: { annualShares: asShares(NVAX) } },
    { meta: { ticker: 'MMIT' }, secAnnual: { annualShares: asShares(MMI) } }];
  const zeilen = [
    { ticker: 'NVAXT', action: 'exclude', score: null, formulaId: null, track: null, lamps: [] },
    { ticker: 'MMIT', action: 'route', score: 10, formulaId: 'f', track: 'profitable', lamps: [] },
  ];
  assert.equal(lampeBNachruesten(zeilen, universum), 0, 'eine Kohorte aus einem Namen hat keine Verteilung');
  assert.deepEqual(zeilen[0].lamps, []);
});

// --- Betrag statt an/aus (03.08.2026) ---------------------------------------
// Seit dem Reichweiten-Fix feuert die Lampe fuer 437 von 3.042 gerouteten Zeilen — zeigt aber
// nur an/aus. Der Kohorten-Spitzenreiter mit +1 % Aktienzahl im Jahr sieht damit exakt aus wie
// einer mit +66 %, und beides heisst "oberstes Viertel". Rate und Kohorten-Perzentil reisen
// deshalb als `shareDilution` mit. REINE ANZEIGE: dieselbe Rechnung, aus der auch die Lampe
// ihren Schwellvergleich zieht (shareDilutionDetail) — kein zweiter Rechenweg, der ausscheren
// koennte, und kein Score-Input (Beleg: Gesamt-Digest vor/nach identisch).
test('shareDilutionDetail: liefert die ROHEN Zahlen, mit denen die Lampe rankt', () => {
  const { shareDilutionDetail } = require('../../src/scoring/lamps.js');
  const cohort = [snap(NVAX), snap(MMI), snap(GME)];
  const ctx = { shareGrowthPctlFn: buildShareGrowthPctlFn(cohort) };
  const d = shareDilutionDetail(snap(NVAX), ctx);
  assert.equal(d.rate, shareGrowthRate(snap(NVAX)), 'die Rate MUSS die Zahl der Lampe sein, keine zweite Rechnung');
  assert.equal(d.pctl, ctx.shareGrowthPctlFn(d.rate), 'das Perzentil MUSS aus derselben Kohorten-Funktion kommen');
  // Ungerundet: der Schwellvergleich der Lampe laeuft auf genau diesem Wert. Wuerde hier schon
  // gerundet, kaeme p=0,7495 als 0,75 durch und die Lampe feuerte neu — Schwellenaenderung
  // durch die Hintertuer.
  const knapp = { shareGrowthPctlFn: () => 0.7495 };
  assert.equal(shareDilutionDetail(snap(NVAX), knapp).pctl, 0.7495, 'Detail darf nicht runden');
  assert.equal(shareCountDilution(snap(NVAX), knapp), false, 'knapp unter p75 darf NICHT feuern');
  // Nicht bewertbar bleibt nicht bewertbar — dieselben Ausgaenge wie die Lampe.
  assert.equal(shareDilutionDetail({}, ctx), null);
  assert.equal(shareDilutionDetail(snap(NVAX), undefined), null);
});

test('KETTE: shareDilution erreicht die Export-Zeile (lampeBNachruesten -> produceRankings -> mapBoardRow)', () => {
  const { lampeBNachruesten } = require('../../src/scoring/run-screener.js');
  const { produceRankings } = require('../../src/scoring/score.js');
  const { mapBoardRow, mapOverviewRow } = require('../../scripts/write-findash-export.js');
  const universum = [
    { meta: { ticker: 'NVAXT' }, secAnnual: { annualShares: asShares(NVAX) } },
    { meta: { ticker: 'MMIT' }, secAnnual: { annualShares: asShares(MMI) } },
    { meta: { ticker: 'GMET' }, secAnnual: { annualShares: asShares(GME) } },
  ];
  const zeilen = ['NVAXT', 'MMIT', 'GMET'].map((t, i) => ({
    ticker: t, action: 'route', score: 50 - i, formulaId: 'testformel', track: 'profitable', lamps: [],
    cohortN: 3, cohortFallback: false,
  }));
  assert.equal(lampeBNachruesten(zeilen, universum), 1);

  const rk = produceRankings(zeilen, { topN: 50 });
  const alle = [].concat(...Object.values(rk.branches).map((b) => [].concat(b.profitable || [], b.unprofitable || [])));
  const nvax = alle.find((r) => r.ticker === 'NVAXT');
  const mmi = alle.find((r) => r.ticker === 'MMIT');
  assert.ok(nvax && mmi, 'beide Zeilen muessen im Board stehen');

  // Station 2 (score.js rowMeta): der Betrag ueberlebt das Zeilen-Mapping.
  const erwarteteRate = Math.round(shareGrowthRate(snap(NVAX)) * 1000) / 10;
  assert.equal(nvax.shareDilution.ratePct, erwarteteRate, 'Rate in PROZENT, eine Nachkommastelle');
  assert.ok(nvax.shareDilution.pctl >= 0.75, 'das Perzentil muss den Lampen-Grund belegen');
  assert.equal(mmi.shareDilution, null, 'Zeile ohne Lampe traegt keinen Betrag');

  // Station 3 (Writer ROW_FIELDS): das Feld faellt im Export nicht heraus.
  const exportiert = mapBoardRow(nvax, 0);
  assert.ok('shareDilution' in exportiert, 'Feld faellt im Export-Writer heraus');
  assert.deepEqual(exportiert.shareDilution, nvax.shareDilution, 'Wert am Ende der Kette');
  assert.ok(exportiert.lamps.includes('shareCountDilution'), 'Betrag ohne Lampe waere sinnlos');
  // Uebersichts-Zeile fuehrt ihn ebenso.
  const ov = rk.overview.find((r) => r.ticker === 'NVAXT');
  assert.deepEqual(mapOverviewRow(ov, 0).shareDilution, nvax.shareDilution, 'Uebersichts-Zeile traegt den Betrag ebenfalls');
});

// --- Der Waechter im --check: beide Richtungen -------------------------------
const basisZeile = {
  ticker: 'MTC', name: 'MMTec Inc', score: 61.2, track: 'profitable', lamps: ['shareCountDilution'],
  overview: { kind: 'gp', value: 0.2, companion: 89.1 },
  country: 'United States', region: 'North America', sector: 'Technology',
  marketCap: 4e8, phase: 'established', mcapBand: 'micro', ipoRecency: 'mature',
  profitTier: 'langfristig-profitabel', ipoYear: 2019, cohortN: 90, cohortFallback: false,
  shareDilution: { ratePct: 66.0, pctl: 0.997 },
};
const errsOf = (row) => {
  const { validateBoardRow } = require('../../scripts/write-findash-export.js');
  const e = []; validateBoardRow(row, 'r', e); return e;
};

test('WAECHTER shareDilution: jede gueltige Form geht durch (kein Falsch-Rot in Karls Alarmkanal)', () => {
  const { mapBoardRow } = require('../../scripts/write-findash-export.js');
  assert.deepEqual(errsOf(mapBoardRow(basisZeile, 0)), [], 'Lampe + Betrag ist der Normalfall');
  assert.deepEqual(errsOf(mapBoardRow({ ...basisZeile, lamps: [], shareDilution: null }, 0)), [],
    'Zeile ohne Lampe, Feld null — der Fall fuer ~86 % aller Zeilen');
  const ohne = { ...basisZeile }; delete ohne.shareDilution; ohne.lamps = [];
  assert.deepEqual(errsOf(mapBoardRow(ohne, 0)), [], 'Abwesenheit im Erzeuger (Altbestand) geht durch');
  // Negative Rate (Rueckkauf-Kohorte, in der auch p75 noch schrumpft) ist gueltig.
  assert.deepEqual(errsOf(mapBoardRow({ ...basisZeile, shareDilution: { ratePct: -0.4, pctl: 0.81 } }, 0)), []);
});

test('WAECHTER shareDilution: kaputte Form, unmoegliches Perzentil und Betrag OHNE Lampe fliegen auf', () => {
  const { mapBoardRow } = require('../../scripts/write-findash-export.js');
  const rot = (row, was) => {
    const e = errsOf(mapBoardRow(row, 0));
    assert.ok(e.some((x) => /shareDilution/.test(x)), 'unbemerkt durch: ' + was + ' -> ' + JSON.stringify(e));
  };
  for (const kaputt of [{}, { ratePct: 1 }, { pctl: 0.9 }, { ratePct: '1', pctl: 0.9 },
    { ratePct: 1, pctl: null }, { ratePct: NaN, pctl: 0.9 }, { ratePct: 1, pctl: Infinity },
    [66, 0.9], 66, 'viel', true]) {
    rot({ ...basisZeile, shareDilution: kaputt }, JSON.stringify(kaputt));
  }
  rot({ ...basisZeile, shareDilution: { ratePct: 66, pctl: 1.4 } }, 'pctl > 1');
  rot({ ...basisZeile, shareDilution: { ratePct: 66, pctl: -0.1 } }, 'pctl < 0');
  rot({ ...basisZeile, lamps: ['peakMargin'] }, 'Betrag auf Zeile OHNE die Lampe');
  // Und die Gegenrichtung, die es bei einmalertragPrognose bewusst NICHT gibt: hier IST
  // "Lampe ⟹ Betrag" strukturell wahr, denn die Lampe feuert nur, wenn Rate UND Perzentil
  // vorliegen (shareDilutionDetail). Ein leeres Feld auf einer Lampen-Zeile heisst also:
  // die Kette ist zwischen Erzeuger und Writer gerissen — genau die Panne, die die Lampe
  // von Tag 421 bis 03.08. unsichtbar stumm hielt.
  rot({ ...basisZeile, shareDilution: null }, 'Lampe ohne Betrag (gerissene Kette)');
});

test('DATEI-WAECHTER shareDilution: das Feld ist entweder auf allen Zeilen da oder auf keiner', () => {
  const { mapBoardRow, validateFile, SCHEMA } = require('../../scripts/write-findash-export.js');
  const mitFeld = mapBoardRow({ ...basisZeile, lamps: [], shareDilution: null }, 0);
  const ohneFeld = { ...mitFeld }; delete ohneFeld.shareDilution;
  const datei = (rows) => ({ schema: SCHEMA, generated_at: new Date().toISOString(),
    branch: 'semiconductors', boardStatus: 'core', coverage: null,
    profitable: rows.map((r, i) => ({ ...r, rank: i + 1, score: 90 - i })), unprofitable: [] });
  const errs = [];
  validateFile(datei([mitFeld, ohneFeld]), 'semiconductors', errs);
  assert.ok(errs.some((x) => /shareDilution/.test(x)), 'halb verdrahteter Producer blieb unbemerkt');
  const gruen = [];
  validateFile(datei([mitFeld, { ...mitFeld }]), 'semiconductors', gruen);
  assert.deepEqual(gruen, [], 'einheitlich gefuellte Datei muss durchgehen');
  const altbestand = [];
  validateFile(datei([ohneFeld, { ...ohneFeld }]), 'semiconductors', altbestand);
  assert.deepEqual(altbestand, [], 'Altbestand ohne das Feld muss durchgehen');
});

// --- Stufe A, Rat-Entscheid 04.08.2026 (_RAT-52-VERWAESSERUNG-2026-08-04.md) ------------------
// shareCountDilution feuert nicht mehr auf reinem Kohorten-Rang: eine schrumpfende Kohorte hat
// trotzdem einen "staerksten" (= am wenigsten schrumpfenden) Namen im p75+, obwohl niemand dort
// verwaessert wird (MGPI-Klasse). Die Rate-Schranke TH.SHARE_DILUTION_MIN_RATE = 0.02 (2 %/Jahr,
// SBC-Run-Rate-Anker) schliesst diese Zeilen aus, ohne echte Verwaesserer (BTBT-Klasse: hohe
// Rate UND hoher Rang) zu beruehren. shareDilutionDetail (die ROHEN rate/pctl-Zahlen) bleibt
// unveraendert — nur der An/Aus-Vergleich in shareCountDilution bekommt die Konjunktion.
test('TH.SHARE_DILUTION_MIN_RATE: die Rat-Konstante steht bei den uebrigen TH-/CAP-Konstanten', () => {
  assert.equal(TH.SHARE_DILUTION_MIN_RATE, 0.02, '2 % p.a., SBC-Run-Rate-Anker analog SHARES_ORGANIC_CAP');
});

test('shareCountDilution: MGPI-Klasse (Rate negativ, aber p75+ in einer schrumpfenden Kohorte) darf NICHT feuern', () => {
  // Aktienzahl schrumpft leicht (Rueckkauf-Programm) -- Legs ~-1 %/Jahr, Median klar negativ.
  const mgpi = snap([98, 99, 100]);
  const rate = shareGrowthRate(mgpi);
  assert.ok(rate < 0, `Vorbedingung: die Rate muss negativ sein, war ${rate}`);
  // ctx simuliert eine Kohorte, in der MGPI trotzdem der am wenigsten schrumpfende (= "staerkste")
  // Name ist -- reiner Rang-Vergleich waere hier p75+ (wie 'knapp'-Fixture oben: fixe Rueckgabe).
  const ctx = { shareGrowthPctlFn: () => 1.0 };
  const d = shareDilutionDetail(mgpi, ctx);
  assert.equal(d.rate, rate, 'shareDilutionDetail bleibt die ROHE, unveraenderte Rechnung');
  assert.equal(d.pctl, 1.0, 'shareDilutionDetail bleibt die ROHE, unveraenderte Rechnung');
  assert.equal(shareCountDilution(mgpi, ctx), false,
    'GATE-DEFEKT (Rot-Beleg): reiner Kohorten-Rang liesse dies feuern, obwohl niemand verwaessert wird');
});

test('shareCountDilution: BTBT-Klasse (hohe positive Rate UND hoher Rang) feuert weiterhin', () => {
  // Ein starkes Verwaesserungsjahr (+66 %) -- deutlich ueber der 2-%-Schranke.
  const btbt = snap([166, 100]);
  const rate = shareGrowthRate(btbt);
  assert.ok(rate > TH.SHARE_DILUTION_MIN_RATE, `Vorbedingung: Rate muss klar ueber der Schranke liegen, war ${rate}`);
  const ctx = { shareGrowthPctlFn: () => 0.9 };
  assert.equal(shareCountDilution(btbt, ctx), true, 'echte Verwaesserer duerfen durch die neue Schranke nicht verstummen');
});

test('shareGrowthRate/Split-Guard: ratio exakt 2.0 wird als Split gefiltert (beidseitig einschliessend)', () => {
  // Bein 1 (200/100): ratio EXAKT 2.0 -- Split-Signatur, muss rausfallen (vorher: > statt >=, kam durch).
  // Bein 2 (100/102): ratio ~0.9804 -- organisches Bein (~-1.96 %/Jahr), bleibt.
  const mitGenauZwei = shareGrowthRate(snap([200, 100, 102]));
  const nurOrganisch = -0.0196078431372549; // 100/102 - 1
  assert.ok(Math.abs(mitGenauZwei - nurOrganisch) < 1e-9,
    `GATE-DEFEKT (Rot-Beleg): ratio===2.0 muss als Split gefiltert werden, Median war ${mitGenauZwei} `
    + `statt des rein organischen Beins ${nurOrganisch} — ohne Filter draengt das Split-Bein den `
    + `Median auf einen positiven Wert ~0.49`);
  // Gegenprobe symmetrisch: ratio EXAKT 0.5 (Reverse-Split-Signatur) faellt ebenso raus.
  // Bein 1 (100/200): ratio EXAKT 0.5 -- muss raus. Bein 2 (200/198): ratio ~1.0101 -- organisch, bleibt.
  const mitGenauHalb = shareGrowthRate(snap([100, 200, 198]));
  const nurOrganischRev = 200 / 198 - 1;
  assert.ok(Math.abs(mitGenauHalb - nurOrganischRev) < 1e-9,
    `ratio===0.5 muss ebenfalls als Split gefiltert werden, Median war ${mitGenauHalb} statt ${nurOrganischRev}`);
});

test('evaluateLamps: bestehende 14 Lampen ignorieren den neuen ctx-Parameter (arity 1, byte-identisch)', () => {
  const { evaluateLamps } = require('../../src/scoring/lamps.js');
  const s = { meta: {}, secAnnual: { annualShares: asShares(MMI) } };
  const withoutCtx = evaluateLamps(s);
  const withCtx = evaluateLamps(s, { shareGrowthPctlFn: () => 0.99 });
  for (const name of Object.keys(LAMPS)) {
    if (name === 'shareCountDilution') continue;
    assert.equal(withCtx.flags[name], withoutCtx.flags[name], `Lampe ${name} darf sich durch ctx nicht aendern`);
  }
});

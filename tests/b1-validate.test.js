'use strict';
// tests/b1-validate.test.js — synthetischer Beweis der B1-Engine VOR dem einen
// konfirmatorischen Lauf (Protokoll Tag 389 §4/§5/§8): First-Passage-Semantik,
// Matching-Caliper, Cluster-Bootstrap, Event-Flagging inkl. NoMargin-View.
const assert = require('assert');
const {
  firstPassage, buildPairs, clusterBootstrap, evaluatePairOutcomes,
  assessBalance, buildEventDatedCandidatePools, selectViewRecords,
  matchDistance, bcaInterval, _const,
} = require('../scripts/b1-validate.js');
const detect = require('../lib/b1-detect.js');

// Bars-Fabrik: startDatum + tägliche Multiplikatoren (Handelstage, ISO fortlaufend).
function mkBars(startIso, closes) {
  const d = new Date(startIso + 'T00:00:00Z');
  return closes.map((c) => {
    const iso = d.toISOString().slice(0, 10);
    d.setUTCDate(d.getUTCDate() + 1);
    return { date: iso, close: c };
  });
}
// 100 Vor-Tage flach bei 100 mit Mini-Rauschen (σ_daily ≈ 0,01), dann Pfad.
function withHistory(path_) {
  const pre = [];
  for (let i = 0; i < 100; i++) pre.push(100 * (1 + 0.01 * ((i % 2) ? 1 : -1)));
  return pre.concat(path_);
}

// (1) First-Passage: Aufwärtspfad bricht obere Schranke -> upperFirst.
{
  const up = []; for (let i = 1; i <= 200; i++) up.push(100 * Math.pow(1.02, i)); // +2 %/Tag
  const bars = mkBars('2020-01-01', withHistory(up));
  const filed = bars[100].date; // Tag 0 = erster Pfad-Tag
  const r = firstPassage(bars, filed, {});
  assert.strictEqual(r.status, 'ok');
  assert.strictEqual(r.upperFirst, true, 'Aufwärtspfad muss oben zuerst treffen');
}
// (2) Absturzpfad -> untere Schranke zuerst.
{
  const dn = []; for (let i = 1; i <= 200; i++) dn.push(100 * Math.pow(0.98, i));
  const bars = mkBars('2020-01-01', withHistory(dn));
  const r = firstPassage(bars, bars[100].date, {});
  assert.strictEqual(r.status, 'ok');
  assert.strictEqual(r.upperFirst, false);
  assert.ok(r.lower, 'unten zuerst');
}
// (3) Flacher Pfad über 300 Tage -> Timeout = Miss (kein Drop).
{
  const flat = []; for (let i = 0; i < 300; i++) flat.push(100 + (i % 2 ? 0.5 : -0.5));
  const bars = mkBars('2020-01-01', withHistory(flat));
  const r = firstPassage(bars, bars[100].date, {});
  assert.strictEqual(r.status, 'ok');
  assert.strictEqual(r.upperFirst, false);
  assert.ok(r.timeout, 'Timeout zählt als Miss, wird nie gedroppt');
}
// (4) Serie endet im Fenster: unbrauchbar (Ausweis) — in ALLEN Views.
// Geaendert per Dry Round #2 T2-Fund + Duell-Ruling 20.07. (Option E,
// protocol/b1-addendum-20260720-shumway.md): die fruehere imputeMissing-
// Abkuerzung (jedes Serienende = Miss) verletzte das eingefrorene Protokoll
// par.7 Nr. 6; firstPassage imputiert jetzt NIE, die Shumway-View laeuft
// fail-closed als NOT_ESTIMABLE (p=1) in der m=6-Familie.
{
  const short = []; for (let i = 0; i < 30; i++) short.push(100);
  const bars = mkBars('2020-01-01', withHistory(short));
  const prim = firstPassage(bars, bars[100].date, {});
  assert.strictEqual(prim.status, 'series_ended_in_window');
  const shum = firstPassage(bars, bars[100].date, { imputeMissing: true });
  assert.strictEqual(shum.status, 'series_ended_in_window', 'keine Imputation mehr - ehrlicher Status in allen Views');
  // Serienende VOR dem Einstieg: nie imputierbar (kein Entry-Kurs existiert).
  const tiny = bars.slice(0, 102); // d0=100, entryIdx=101 -> letzter Bar
  const pre = firstPassage(tiny.slice(0, 101), tiny[100].date, {});
  assert.strictEqual(pre.status, 'series_ended_pre_entry');
}
// (5) Zu wenig Vor-Historie -> insufficient_history (Balance-Gate-Zählung).
{
  const bars = mkBars('2020-01-01', [100, 100, 100, 100, 100]);
  const r = firstPassage(bars, bars[2].date, {});
  assert.strictEqual(r.status, 'insufficient_history');
}

// (6) Matching: gleicher Sektor+Quartal matcht innerhalb Caliper; fremder Sektor nie;
//     dieselbe Kontrolle wird je Quartal nur 1x vergeben.
{
  const mkR = (cik, sic2, calQ, logMcap, mom, evsPctl) => ({ cik, sic2, calQ, filed: '2020-05-01', vars: { logMcap, mom, evsPctl }, bars: [] });
  const ev1 = mkR(1, '73', '2020Q2', 20, 0.1, 0.5);
  const ev2 = mkR(2, '73', '2020Q2', 20.1, 0.11, 0.52);
  const good = mkR(10, '73', '2020Q2', 20.05, 0.1, 0.5);
  const far = mkR(11, '73', '2020Q2', 27, 3.0, 0.99);
  const wrongSector = mkR(12, '28', '2020Q2', 20, 0.1, 0.5);
  const candByQ = new Map([['2020Q2', [good, far, wrongSector]]]);
  const { pairs, noMatch } = buildPairs([ev1, ev2], candByQ);
  assert.strictEqual(pairs.length, 1, 'good ist nach ev1 verbraucht; far liegt außerhalb des Calipers');
  assert.strictEqual(pairs[0].ctl.cik, 10);
  assert.strictEqual(noMatch, 1);
}

// (7) Cluster-Bootstrap: klarer positiver Effekt über 10 Cluster -> kleines p,
//     Null-Effekt -> großes p; nEff <= nClusters.
{
  const pos = [], nul = [];
  for (let c = 0; c < 10; c++) {
    for (let i = 0; i < 8; i++) {
      pos.push({ cluster: 'S|' + (2019 + c) + 'Q1', calQ: (2019 + c) + 'Q1', diff: (i < 6 ? 1 : 0) }); // Ø +0,75
      nul.push({ cluster: 'S|' + (2019 + c) + 'Q1', calQ: (2019 + c) + 'Q1', diff: (i % 2 ? 1 : -1) }); // Ø 0
    }
  }
  const bp = clusterBootstrap(pos, 2000, 42);
  assert.ok(bp.mean > 0.5 && bp.p < 0.01, 'starker Effekt muss kleines p liefern (p=' + bp.p + ')');
  assert.ok(bp.nEff <= bp.nClusters + 1e-9);
  const bn = clusterBootstrap(nul, 2000, 42);
  assert.ok(bn.p > 0.2, 'Null-Effekt darf nicht signifikant werden (p=' + bn.p + ')');
}

// (8) Event-Flagging: 250er-Kohorte, Top-Dezil + Konsekutiv + Margen-Bedingung;
//     isEventNoMargin ignoriert nur die Marge.
{
  const recs = [];
  for (let i = 0; i < 250; i++) {
    recs.push({
      cik: i, end: '2020-03-31', calQ: '2020Q1', filed: '2020-05-01',
      dYoY: i / 250, dYoYprev: 0.01, dOpMargin: (i % 2 ? 0.01 : -0.01), derivedInvolved: false,
    });
  }
  const cohorts = detect.flagEvents(recs);
  const ev = recs.filter((r) => r.isEvent), evNM = recs.filter((r) => r.isEventNoMargin);
  assert.ok(evNM.length >= 20 && evNM.length <= 30, 'Top-Dezil ~25 (' + evNM.length + ')');
  assert.ok(ev.length > 0 && ev.length < evNM.length, 'Margen-Bedingung halbiert (' + ev.length + ')');
  assert.ok(cohorts['2020Q1'].n === 250 && !cohorts['2020Q1'].belowMinN);
  // Mini-Kohorte (unter Mindest-N) erzeugt NIE Events:
  const small = recs.slice(0, 50).map((r) => ({ ...r, calQ: '2010Q1' }));
  detect.flagEvents(small);
  assert.ok(small.every((r) => !r.isEvent), 'Mindest-Kohorten-N-Gate');
}

function qFact(start, end, val, filed, fp) {
  return { start, end, val, filed, form: '10-Q', fp };
}
function companyFacts(revenues, operatingIncome, shares) {
  return {
    facts: {
      'us-gaap': {
        Revenues: { units: { USD: revenues || [] } },
        OperatingIncomeLoss: { units: { USD: operatingIncome || [] } },
      },
      dei: {
        EntityCommonStockSharesOutstanding: { units: { shares: shares || [] } },
      },
    },
  };
}

// (9 / F1) Eine spaetere Korrektur darf weder das Eventdatum verschieben noch am
//     fruehen Erkennungsstichtag den Originalwert im PIT-Snapshot ersetzen.
{
  const rev = [
    qFact('2020-01-01', '2020-03-31', 100, '2020-05-01', 'Q1'),
    qFact('2020-04-01', '2020-06-30', 100, '2020-08-01', 'Q2'),
    qFact('2020-07-01', '2020-09-30', 100, '2020-11-01', 'Q3'),
    qFact('2021-01-01', '2021-03-31', 110, '2021-05-01', 'Q1'),
    qFact('2021-04-01', '2021-06-30', 120, '2021-08-01', 'Q2'),
    qFact('2021-07-01', '2021-09-30', 130, '2021-11-01', 'Q3'),
    qFact('2021-07-01', '2021-09-30', 260, '2022-02-01', 'Q3'),
  ];
  const op = [
    qFact('2020-07-01', '2020-09-30', 10, '2020-11-01', 'Q3'),
    qFact('2021-07-01', '2021-09-30', 20, '2021-11-01', 'Q3'),
  ];
  const store = { factsForCik: () => companyFacts(rev, op) };
  const got = detect.collectRecords(store, { eraStart: '2021-09-30', eraEnd: '2021-09-30', ciks: [1] });
  assert.strictEqual(got.records.length, 1);
  assert.strictEqual(got.records[0].filed, '2021-11-01', 'F1: erstes Filing ist Erkennungsstichtag');
  assert.ok(Math.abs(got.records[0].dYoY - 0.1) < 1e-12, 'F1: Originalwert 130 statt Korrektur 260');
}

// (10 / F2) Outcome-Asymmetrie ist Teil des Balance-Gates, auch wenn die
//      vorgelagerte Preis-Fehlquote perfekt ausgeglichen war.
{
  const path = []; for (let i = 1; i <= 300; i++) path.push(100 * Math.pow(1.02, i));
  const bars = mkBars('2020-01-01', withHistory(path));
  const filed = bars[100].date;
  const outcome = evaluatePairOutcomes([
    { ev: { ticker: 'EV', filed, sic2: '73', calQ: '2020Q1' }, ctl: { ticker: 'CTL', filed: '2030-01-01' } },
  ], {}, (ticker) => ticker === 'EV' ? bars : null);
  const gate = assessBalance(0, outcome.outcomeBalanceDelta);
  assert.strictEqual(outcome.evOutcomeMissing, 0);
  assert.strictEqual(outcome.ctlOutcomeMissing, 1);
  assert.strictEqual(gate.passed, false, 'F2: 100-pp Outcome-Delta reisst das 5-pp-Gate');
}

// (11 / F3) Kontrollvariablen und Kontroll-Outcome sind am Eventdatum verankert;
//      das eigene spaetere Filing der Kontrolle darf keine Daten freischalten.
{
  const closes = []; for (let i = 0; i < 500; i++) closes.push(100 * Math.pow(1.005, i));
  const bars = mkBars('2020-01-01', closes);
  const eventDate = bars[200].date, controlOwnDate = bars[490].date;
  const rev = [
    qFact('2019-01-01', '2019-03-31', 20, '2019-05-01', 'Q1'),
    qFact('2019-04-01', '2019-06-30', 20, '2019-08-01', 'Q2'),
    qFact('2019-07-01', '2019-09-30', 20, '2019-11-01', 'Q3'),
    qFact('2019-10-01', '2019-12-31', 20, '2020-02-01', 'Q4'),
  ];
  const shares = [
    { end: '2020-06-30', val: 100, filed: '2020-07-01', form: '10-Q' },
    { end: '2020-09-30', val: 1000, filed: '2020-10-01', form: '10-Q' },
  ];
  const facts = companyFacts(rev, [], shares);
  const ev = { cik: 1, ticker: 'EV', sic2: '73', calQ: '2020Q2', filed: eventDate };
  const ctl = { cik: 2, ticker: 'CTL', sic2: '73', calQ: '2020Q2', filed: controlOwnDate };
  const pools = buildEventDatedCandidatePools([ev], [ctl], {
    factsOf: () => facts,
    barsOf: () => bars,
  });
  const datedCtl = pools.get(ev)[0];
  assert.ok(Math.abs(datedCtl.vars.logMcap - Math.log(bars[200].close * 100)) < 1e-12,
    'F3: Shares und Preis stammen vom Eventdatum');
  assert.notStrictEqual(firstPassage(bars, controlOwnDate, {}).status, 'ok', 'Kontroll-eigenes Filing ist zu spaet');
  const outcome = evaluatePairOutcomes([{ ev, ctl: datedCtl }], {}, () => bars);
  assert.strictEqual(outcome.ctlOutcomeMissing, 0, 'F3: Kontroll-Outcome nutzt Eventdatum');
}

// (12 / F5) Eine Sechs-Monats-Luecke ist kein konsekutives Quartal und wird
//      explizit gezaehlt, statt als t-1 in die Beschleunigung einzugehen.
{
  const rev = [
    qFact('2020-10-01', '2020-12-31', 100, '2021-02-01', 'Q4'),
    qFact('2021-01-01', '2021-03-31', 110, '2021-05-01', 'Q1'),
    qFact('2021-07-01', '2021-09-30', 140, '2021-11-01', 'Q3'),
  ];
  const store = { factsForCik: () => companyFacts(rev) };
  const got = detect.collectRecords(store, { eraStart: '2021-09-30', eraEnd: '2021-09-30', ciks: [1] });
  assert.strictEqual(got.records.length, 0, 'F5: Lueckenquartal ist nicht auswertbar');
  assert.strictEqual(got.counters.nonConsecutive, 1, 'F5: eigener Counter zaehlt die Luecke');
}

// (13 / F6) Ein Record, der in der P75-View Event ist, darf dort nicht zugleich
//      im neu gebauten Kontroll-Kandidaten-Pool stehen.
{
  const recs = [];
  for (let i = 0; i < 250; i++) recs.push({
    cik: i, end: '2020-03-31', calQ: '2020Q1', filed: '2020-05-01',
    dYoY: i / 250, dYoYprev: 0.01, dOpMargin: 0.01,
  });
  detect.flagEvents(recs);
  const target = recs[200];
  assert.strictEqual(target.isEvent, false, 'Fixture liegt unter P90');
  recs.push({ ...target, end: '2020-04-01', dYoY: 0 });
  const view = selectViewRecords(recs, { pctl: 0.75 }, new Set());
  assert.ok(view.events.some((r) => r.cik === target.cik), 'Fixture wird bei P75 zum Event');
  assert.ok(!view.controls.some((r) => r.cik === target.cik), 'F6: P75-Event ist keine P75-Kontrolle');
}

// (14 / F7a) Drei vollstaendige standardisierte Abstaende von je 0,8 ergeben
//      sqrt(3*0,8^2)=1,386 und liegen damit ausserhalb des Calipers.
{
  const stats = {
    logMcap: { m: 0, sd: 1 }, mom: { m: 0, sd: 1 }, evsPctl: { m: 0, sd: 1 },
  };
  const dist = matchDistance(
    { logMcap: 0, mom: 0, evsPctl: 0 },
    { logMcap: 0.8, mom: 0.8, evsPctl: 0.8 },
    stats,
  );
  assert.ok(Math.abs(dist - Math.sqrt(3 * 0.8 ** 2)) < 1e-12);
  assert.ok(dist > _const.CALIPER, 'F7a: kein Match jenseits Caliper 1,0');
  const incomplete = {
    cik: 2, sic2: '73', calQ: '2020Q1', vars: { logMcap: 0, mom: 0 },
  };
  const event = {
    cik: 1, sic2: '73', calQ: '2020Q1', vars: { logMcap: 0, mom: 0, evsPctl: 0 },
  };
  assert.strictEqual(buildPairs([event], new Map([['2020Q1', [incomplete]]])).pairs.length, 0,
    'F7a: alle drei Variablen sind Pflicht');
}

// (15 / F7b) BCa existiert als eigener Intervallschritt und liegt bei
//      symmetrischem Bootstrap/Jackknife nahe am einfachen Perzentilintervall.
{
  const means = []; for (let i = -50; i <= 50; i++) means.push(i / 50);
  const jack = [-0.2, -0.1, 0, 0.1, 0.2];
  const ci = bcaInterval(means, 0, jack, 0.05, 0.95);
  const pct = { lo: means[Math.round(0.05 * (means.length - 1))], hi: means[Math.round(0.95 * (means.length - 1))] };
  assert.ok(Number.isFinite(ci.lo) && Number.isFinite(ci.hi), 'F7b: BCa-Intervall existiert');
  assert.ok(Math.abs(ci.lo - pct.lo) < 0.05 && Math.abs(ci.hi - pct.hi) < 0.05,
    'F7b: symmetrisches BCa liegt nahe Perzentil-CI');
  const boot = clusterBootstrap([
    { cluster: 'A|2020Q1', calQ: '2020Q1', diff: -1 },
    { cluster: 'B|2020Q2', calQ: '2020Q2', diff: -0.5 },
    { cluster: 'C|2020Q3', calQ: '2020Q3', diff: 0.5 },
    { cluster: 'D|2020Q4', calQ: '2020Q4', diff: 1 },
  ], 500, 7);
  assert.strictEqual(boot.ci90.method, 'BCa', 'clusterBootstrap weist BCa aus');
}

console.log('b1-validate.test.js: alle 15 Blöcke grün');

'use strict';
/**
 * Waechter zum Beschluss _COURT-FTI-NULLWERTE-2026-09-02 (Q1, ratifiziert 12:20:22Z).
 *
 * DIE SACHE, die hier gepinnt wird — nicht ein Schreibmuster im Quelltext:
 * Yahoo kodiert einen fehlenden Bruttogewinn in incomeStatementHistory als literale 0.
 * Die Jahres-Buendel-Entscheidung zaehlte diese 0 als Datum (_nonNullCount) und kaufte
 * quoteSummary damit den Gleichstand, den es zum Gewinnen braucht — FTI verlor so seine
 * echte OpInc-Reihe an ein nullgepolstertes Buendel, UMAC und ASTS trugen eine
 * kontaminierte marginLevel-Achse (Bruttomarge 0,0 % statt Achsen-Drop).
 *
 * Zwei Fixe, EIN untrennbares Paket:
 *   Fix 1  Jahres-Dichte zaehlt mit _nonZeroCount (der Quartals-Zwilling tut das seit Tag 559)
 *   Fix 2  _nullOutAllZeroGrossProfit: eine komplett genullte GP-Reihe bei positivem
 *          Umsatz wird zu ehrlichen Fehlwerten — mit >= 2 dokumentierten Nulljahren (FN-4)
 * dazu blockierend: Lauf-Zaehler (FN-2) und Per-Zeile-Marker (FN-3).
 *
 * Gefahren wird der ECHTE exportierte Seam, kein Nachbau (Fehlerklasse F1334 — der
 * Messharnisch der Diagnose musste den Quelltext zur Laufzeit ausschneiden, weil die
 * Regel ein Closure in pullAll war; genau das ist jetzt behoben).
 *
 * Faelle = VEREINIGUNG beider Gerichtsstimmen (FN-6): die sieben selfcheck-Faelle PLUS
 * die UMAC-Abwesenheitsprobe, die das Briefing als "vorformuliert" fuehrte und die
 * nachweislich NICHT existierte. Dazu die Bruchproben-Tafel BP-1..BP-9 des Beschlusses.
 *
 * Usage:  node tests/fti-jahresbuendel-nullwerte.test.js   (Exit 0/1)
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const M = require('../pull-yahoo.js');
const {
  mergeAnnualIncomeBundle, _incomeBundleDensity, _nullOutAllZeroGrossProfit,
  _nonNullCount, _nonZeroCount, _deriveOpIncForFinancials, _boersenSuffix,
  _gpZeroCodingOfWinner, _recordGpZeroCoding, _gpZeroCodingTally, _resetGpZeroCodingTally,
  mapYahooToCanonical,
} = M;

let fails = 0;
function t(name, fn) {
  try { fn(); console.log('  ok   ' + name); }
  catch (e) { fails++; console.error('  FAIL ' + name + '\n       ' + (e && e.message)); }
}
const v = (n) => (n == null ? null : { value: n });
const cells = (arr) => arr.map(v);

// ── Reale Buendel, als LITERALE aus dem Rohbefund vom 2026-09-02 ──────────────────
// Nicht aus Produktionsdateien geladen: sonst prueft die Wache nur, dass eine Datei sich
// selbst gleicht, und stirbt still, sobald der Name aus der Schicht faellt.
const qsFTI = {
  annualRev: cells([9932600000, 9083300000, 7824200000, 6700400000]),
  annualOpInc: [],                                  // _trimTrailingNull frisst 4x null
  annualGP: cells([0, 0, 0, 0]),                    // Yahoos Fehlwert-Kodierung
  annualNetIncome: cells([963900000, 842900000, 56200000, -107200000]),
};
const ftsFTI = {
  annualRev: cells([6700400000, 7824200000, 9083300000, 9932600000]),
  annualOpInc: cells([212500000, 529200000, 982600000, 1393000000]),
  annualGP: [null, null, null, null],
  annualNetIncome: cells([-107200000, 56200000, 842900000, 963900000]),
};
// FTI gestern: quoteSummary mit ECHTEN Bruttogewinnen und echter OpInc-Reihe.
const qsEcht = Object.assign({}, qsFTI, {
  annualGP: cells([2181400000, 1723100000, 1274100000, 896300000]),
  annualOpInc: cells([1393000000, 982600000, 529200000, 212500000]),
});
// UMAC-Form: revNN [3,2] — quoteSummary entscheidet VOR der Dichte, kein Gleichstand.
const qsUMAC = {
  annualRev: cells([11200000, 5600000, 3900000]),
  annualOpInc: [],
  annualGP: cells([0, 0, 0]),
  annualNetIncome: cells([-18000000, -9000000, -4000000]),
};
const ftsUMAC = {
  annualRev: cells([11200000, null, 3900000]),
  annualOpInc: cells([-17000000, -8500000, -3800000]),
  annualGP: cells([3900000, null, 1100000]),
  annualNetIncome: cells([-18000000, -9000000, -4000000]),
};

console.log('fti-jahresbuendel-nullwerte (Beschluss _COURT-FTI-NULLWERTE-2026-09-02)');

// ── 1 BASIS: der Defekt, in der alten Zaehlung reproduziert ───────────────────────
t('BASIS: mit _nonNullCount gewinnt quoteSummary — 12:12 Gleichstand, die vier Nullen kaufen ihn', () => {
  assert.equal(_incomeBundleDensity(qsFTI, _nonNullCount), 12);
  assert.equal(_incomeBundleDensity(ftsFTI, _nonNullCount), 12);
  assert.equal(mergeAnnualIncomeBundle(qsFTI, ftsFTI, { densityNonZero: false }), qsFTI);
});

// ── 2/3 BP-1 (Anwesenheitsprobe): Fix 1 in der PRODUKTIONS-Fassung ────────────────
t('BP-1: ohne opts (= Produktion) gewinnt FTS — 8:12, die echte OpInc-Reihe kommt zurueck', () => {
  assert.equal(_incomeBundleDensity(qsFTI, _nonZeroCount), 8);
  assert.equal(_incomeBundleDensity(ftsFTI, _nonZeroCount), 12);
  const winner = mergeAnnualIncomeBundle(qsFTI, ftsFTI);
  assert.equal(winner, ftsFTI, 'Fix1: FTS muss gewinnen');
  assert.deepEqual(winner.annualOpInc.map((c) => c.value),
    [212500000, 529200000, 982600000, 1393000000],
    'die vier echten OpInc-Jahre 212,5 / 529,2 / 982,6 / 1.393,0 Mio muessen praesent sein');
});
t('BP-1: der Produktions-Default ist _nonZeroCount — _incomeBundleDensity ohne counter zaehlt nicht null-blind', () => {
  assert.equal(_incomeBundleDensity(qsFTI), 8, 'Default-Zaehlung muss die vier Schein-Nullen verwerfen');
  assert.equal(_incomeBundleDensity(qsFTI), _incomeBundleDensity(qsFTI, _nonZeroCount));
});

// ── 4 Fix 2 heilt denselben Fall ueber die andere Tuer ────────────────────────────
t('Fix 2: die genullte GP-Reihe faellt auf null, Dichte 12->8, FTS gewinnt auch in der ALTEN Zaehlung', () => {
  const gp = qsFTI.annualGP.map((x) => ({ value: x.value }));
  const hits = _nullOutAllZeroGrossProfit(qsFTI.annualRev, gp);
  assert.equal(hits, 4, 'der Guard muss die Trefferzahl melden (FN-2)');
  assert.deepEqual(gp, [null, null, null, null]);
  const qs2 = Object.assign({}, qsFTI, { annualGP: gp });
  assert.equal(mergeAnnualIncomeBundle(qs2, ftsFTI, { densityNonZero: false }), ftsFTI);
});

// ── 5 BP-4 (Abwesenheitsprobe A) ──────────────────────────────────────────────────
t('BP-4 / Abwesenheit A: echte GP-Werte -> quoteSummary behaelt das Buendel, in BEIDEN Zaehlungen', () => {
  assert.equal(mergeAnnualIncomeBundle(qsEcht, ftsFTI, { densityNonZero: false }), qsEcht);
  assert.equal(mergeAnnualIncomeBundle(qsEcht, ftsFTI), qsEcht);
});
t('BP-4 / Abwesenheit A: echte GP-Werte werden NIE genullt', () => {
  const gp = qsEcht.annualGP.map((x) => ({ value: x.value }));
  assert.equal(_nullOutAllZeroGrossProfit(qsEcht.annualRev, gp), 0);
  assert.deepEqual(gp.map((x) => x && x.value), [2181400000, 1723100000, 1274100000, 896300000]);
});

// ── 6 Abwesenheitsprobe B ─────────────────────────────────────────────────────────
t('Abwesenheit B: eine einzelne echte 0 neben echten Jahren bleibt stehen (Bedingung b)', () => {
  const gp = cells([0, 1274100000, 896300000, 500000000]);
  assert.equal(_nullOutAllZeroGrossProfit(qsFTI.annualRev, gp), 0);
  assert.deepEqual(gp.map((x) => x && x.value), [0, 1274100000, 896300000, 500000000]);
});

// ── 7 BP-6 (Abwesenheitsprobe C) ──────────────────────────────────────────────────
t('BP-6 / Abwesenheit C: ohne positiven Umsatz (Pre-Revenue) wird nichts genullt (Bedingung c)', () => {
  const gp = cells([0, 0, 0, 0]);
  assert.equal(_nullOutAllZeroGrossProfit([v(0), v(0), null, null], gp), 0);
  assert.deepEqual(gp.map((x) => x && x.value), [0, 0, 0, 0]);
});

// ── 8 BP-8 (die KONZESSION, ausdruecklich festgeschrieben) ────────────────────────
t('BP-8 / Konzession: eine ECHTE Null-Marge bei positivem Umsatz kann Fix 2 nicht unterscheiden — sie WIRD genullt', () => {
  // Das ist die eingestandene Grenze des Guards, vom Gericht als Konzession gefuehrt
  // (§2.2, Kipp-Bedingung K3). Sie steht hier als Test, damit sie niemand spaeter
  // wegoptimiert und damit sie sichtbar bricht, falls jemand den Guard lockert.
  // Im heutigen Bestand ist die Falsifikator-Population gemessen LEER: 0 Zeilen, in
  // denen BEIDE Quellen GP=0 bei positivem Umsatz melden. Taucht so ein Fall auf,
  // geht die Frage ZURUECK ANS GERICHT — nicht in eine stille Lockerung hier.
  const gp = cells([0, 0, 0, 0]);
  assert.equal(_nullOutAllZeroGrossProfit(cells([1e9, 1e9, 1e9, 1e9]), gp), 4);
  assert.deepEqual(gp, [null, null, null, null]);
});

// ── 9 BP-3: die UMAC-ABWESENHEITSPROBE (FN-6, die nachweislich fehlende Probe) ────
t('BP-3 / UMAC-Abwesenheit: revNN [3,2] bleibt unter Fix 1 bei QS — Fix 1 wirkt NUR beim Umsatz-Gleichstand', () => {
  assert.equal(_nonNullCount(qsUMAC.annualRev), 3);
  assert.equal(_nonNullCount(ftsUMAC.annualRev), 2);
  assert.equal(mergeAnnualIncomeBundle(qsUMAC, ftsUMAC), qsUMAC,
    'kein Gleichstand -> die Umsatz-Vorabentscheidung faellt VOR der Dichte, QS gewinnt');
  assert.equal(mergeAnnualIncomeBundle(qsUMAC, ftsUMAC, { densityNonZero: false }), qsUMAC,
    'und zwar in beiden Zaehlungen — Fix 1 fasst diese Zeile gar nicht an');
});
t('BP-3 Gegenprobe: unter Variante 1b (Q3 RESERVIERT, nicht angenommen) wuerde dieselbe Zeile kippen', () => {
  // Genau dafuer existiert diese Probe: sie ist das Gate gegen eine stille Ausweitung
  // der Umsatz-Zaehlung auf _nonZeroCount. Wer 1b ohne eigenes Gerichtsverfahren
  // einbaut, sieht den Test darueber rot werden.
  assert.equal(_nonZeroCount(qsUMAC.annualRev), 3);
  assert.equal(_nonZeroCount(ftsUMAC.annualRev), 2);
  const unter1b = mergeAnnualIncomeBundle(qsUMAC, ftsUMAC, { revNonZero: true });
  assert.equal(unter1b, qsUMAC, 'auch 1b kippt DIESE Form nicht — die Zeile traegt keine 0-Umsatzjahre');
  // Die Form, an der 1b haengt: QS-Vorsprung entsteht AUSSCHLIESSLICH aus literalen
  // 0-Umsatzjahren (Klasse 3 der Gerichtstafel, 40 von 40 Zusatz-Flips).
  const qs0 = { annualRev: cells([100, 0, 0]), annualOpInc: [], annualGP: cells([0, 0, 0]), annualNetIncome: cells([5, 4, 3]) };
  const fts0 = { annualRev: cells([100, 90]), annualOpInc: cells([9, 8]), annualGP: cells([40, 36]), annualNetIncome: cells([5, 4]) };
  assert.equal(mergeAnnualIncomeBundle(qs0, fts0), qs0, 'Fix 1 laesst sie bei QS');
  assert.equal(mergeAnnualIncomeBundle(qs0, fts0, { revNonZero: true }), fts0,
    '1b kippt sie — und genau diese Weiche ist RESERVIERT, nicht angenommen');
});

// ── 10 BP-5: die FN-4-Verschaerfung, in beide Richtungen ──────────────────────────
t('BP-5 / FN-4: GENAU EIN dokumentiertes Nulljahr -> Guard greift NICHT (>= 2 verlangt)', () => {
  const nurEins = [v(0)];                              // 2923.TW-Form: einziger Eintrag der Historie
  assert.equal(_nullOutAllZeroGrossProfit(cells([1e9]), nurEins), 0);
  assert.deepEqual(nurEins.map((x) => x && x.value), [0]);
  const einsMitLuecken = [v(0), null, null];           // ein Beleg, Rest unbekannt
  assert.equal(_nullOutAllZeroGrossProfit(cells([1e9, 1e9, 1e9]), einsMitLuecken), 0);
  assert.deepEqual(einsMitLuecken.map((x) => x && x.value), [0, null, null]);
});
t('BP-5 Gegenprobe / FN-4: ZWEI dokumentierte Nulljahre -> Guard greift', () => {
  const zwei = [v(0), v(0), null];
  assert.equal(_nullOutAllZeroGrossProfit(cells([1e9, 1e9, 1e9]), zwei), 2);
  assert.deepEqual(zwei, [null, null, null]);
});

// ── 11 BP-9: das Nullen entzieht der Financials-OpInc-Ableitung nichts ────────────
t('BP-9: _deriveOpIncForFinancials liefert mit genullter GP-Reihe BITGLEICH dasselbe (Schutz der 271 Banken)', () => {
  const isHist = [
    { endDate: '2025-12-31', totalRevenue: 4000000000, grossProfit: 0, netIncome: 800000000 },
    { endDate: '2024-12-31', totalRevenue: 3600000000, grossProfit: 0, netIncome: 700000000 },
  ];
  const rev = cells([4000000000, 3600000000]);
  const mitNullen = _deriveOpIncForFinancials(isHist, rev, 0.31);
  const gp = cells([0, 0]);
  assert.equal(_nullOutAllZeroGrossProfit(rev, gp), 2);
  const nachNullung = _deriveOpIncForFinancials(isHist, rev, 0.31);
  assert.deepEqual(nachNullung, mitNullen,
    'die Ableitung liest isHist + annualRev x operatingMargins, nie annualGP');
  assert.ok(nachNullung.values.length > 0 && nachNullung.source, 'und sie liefert ueberhaupt etwas');
});

// ── 12 BP-7: Zaehler (FN-2) und Marker (FN-3), am echten Mapper ───────────────────
// Fixture-Population statt Einzelfall: der Zaehler muss JE LAUF melden, aufgeschluesselt
// nach Boersen-Suffix und Sektor — sonst ist ein Massenausfall nach Fix 2 nur noch ein
// leiser Achsen-Drop statt eines sichtbaren Score-Kraters.
const mapperFall = (ticker, sector, gpWerte, revWerte) => mapYahooToCanonical({
  price: { currency: 'USD', longName: ticker },
  summaryDetail: {}, financialData: {}, defaultKeyStatistics: {},
  assetProfile: { sector },
  incomeStatementHistory: {
    incomeStatementHistory: revWerte.map((rev, i) => ({
      endDate: `${2025 - i}-12-31`, totalRevenue: rev, grossProfit: gpWerte[i],
      operatingIncome: null, netIncome: -1000000,
    })),
  },
}, { ticker, isin: 'TEST' }, '2026-09-02');

t('BP-7 / FN-3: jede genullte Zeile traegt den Marker — und eine unberuehrte Zeile traegt ihn NICHT', () => {
  const genullt = mapperFall('UMACTEST', 'Technology', [0, 0, 0], [11200000, 5600000, 3900000]);
  assert.equal(genullt.meta.gpZeroCodingNulled, true, 'die Loeschung muss sichtbar sein, nicht still');
  assert.equal(genullt.meta.gpZeroCodingYears, 3);
  assert.deepEqual(genullt.annual.annualGP, [null, null, null]);

  const unberuehrt = mapperFall('ECHTTEST', 'Technology', [3900000, 1800000, 1100000], [11200000, 5600000, 3900000]);
  assert.equal(unberuehrt.meta.gpZeroCodingNulled, false,
    'ohne Loeschung KEIN Marker — sonst behauptete jede Zeile eine verworfene Null-Kodierung');
  assert.equal(unberuehrt.meta.gpZeroCodingYears, 0);

  // Der Anbieter hat nie geliefert: GP durchgaengig null. Fix 2 fasst das nicht an, und
  // die Zeile darf sich NICHT als "wir haben etwas verworfen" ausgeben — genau diese
  // Unterscheidung ist Pflicht (iii) des Markers.
  const nieGeliefert = mapperFall('LEERTEST', 'Technology', [null, null, null], [11200000, 5600000, 3900000]);
  assert.equal(nieGeliefert.meta.gpZeroCodingNulled, false);
});

t('BP-7 / FN-2: der Lauf-Zaehler meldet die Trefferzahl je Lauf, aufgeschluesselt nach Suffix UND Sektor', () => {
  _resetGpZeroCodingTally();
  assert.equal(_gpZeroCodingTally().rows, 0, 'Reset muss den Zaehler wirklich leeren');
  // Fixture-Population: drei Boersen, zwei Sektoren.
  const population = [
    ['UMAC', 'Technology'], ['ASTS', 'Technology'],
    ['8015.T', 'Financial Services'], ['ACA.PA', 'Financial Services'], ['BBVA.MC', 'Financial Services'],
  ];
  for (const [tk, sec] of population) _recordGpZeroCoding(tk, sec);
  const tally = _gpZeroCodingTally();
  assert.equal(tally.rows, 5);
  assert.deepEqual(tally.bySuffix, { US: 2, T: 1, PA: 1, MC: 1 },
    'ohne Aufschluesselung nach Boerse waere ein Boersen-Ausfall nicht von Rauschen zu trennen');
  assert.deepEqual(tally.bySector, { Technology: 2, 'Financial Services': 3 });
  _resetGpZeroCodingTally();
  assert.equal(_gpZeroCodingTally().rows, 0);
});

t('BP-7 / FN-2: US-Notierungen ohne Suffix landen nicht im Sammeltopf "unbekannt"', () => {
  assert.equal(_boersenSuffix('AAPL'), 'US');
  assert.equal(_boersenSuffix('8015.T'), 'T');
  assert.equal(_boersenSuffix('000166.SZ'), 'SZ');
  assert.equal(_boersenSuffix('BRK.B'), 'B'); // bewusst: Yahoo schreibt BRK-B, ein Punkt IST hier ein Suffix
});

// ── 13 FN-3: der Marker folgt dem GEWINNER, nie dem Verlierer ─────────────────────
t('FN-3: der Marker gilt fuer die GESPEICHERTE Reihe — FTI ohne, UMAC mit', () => {
  // FTI: QS wurde genullt (4 Jahre), FTS gewinnt, und FTS' GP ist beim Anbieter ECHT
  // leer. Die gespeicherte Reihe ist also keine Loeschung von uns -> kein Marker.
  assert.equal(_gpZeroCodingOfWinner(true, 0, 4), 0);
  // UMAC: QS gewinnt mit der genullten Reihe -> Marker.
  assert.equal(_gpZeroCodingOfWinner(false, 0, 3), 3);
  // und die Gegenrichtung: gewinnt ein FTS-Buendel, dessen GP WIR genullt haben, traegt
  // die Zeile den Marker trotzdem.
  assert.equal(_gpZeroCodingOfWinner(true, 2, 0), 2);
});

// ── 14 Verdrahtung: unbedingt, an beiden Bau-Pfaden, ohne Umgebungsschalter ───────
const SRC = fs.readFileSync(path.join(__dirname, '..', 'pull-yahoo.js'), 'utf8');
t('FN-1: KEIN Umgebungsschalter — die Messgeruest-Schalter duerfen nicht in Produktion landen', () => {
  assert.ok(!/FIX1_ANNUAL_DENSITY_NONZERO/.test(SRC), 'Fix 1 muss unbedingt laufen');
  assert.ok(!/FIX2_NULL_ALL_ZERO_GP/.test(SRC), 'Fix 2 muss unbedingt laufen');
});
t('Verdrahtung: _nullOutAllZeroGrossProfit wird an BEIDEN Annual-Build-Pfaden aufgerufen (QS + FTS)', () => {
  const hits = SRC.match(/=\s*_nullOutAllZeroGrossProfit\(annualRev, annualGP\);/g) || [];
  assert.equal(hits.length, 2,
    'erwartet genau 2 Aufrufstellen (mapYahooToCanonical + mapFTSToAnnual); gefunden: ' + hits.length);
});
t('Verdrahtung: auch der FTS-CACHE-Pfad laeuft durch den Guard — sonst 28 Tage stille Luecke', () => {
  // Ein Buendel aus cached.payload.ftsAnnual kommt an mapFTSToAnnual vorbei. Ohne den
  // Nachzug traege eine solche Zeile bis CACHE_TTL_MS eine ungeprueft durchgereichte
  // Null-Reihe UND keinen Marker.
  assert.ok(/_nullOutAllZeroGrossProfit\(ftsAnnual\.annualRev, ftsAnnual\.annualGP\)/.test(SRC),
    'der Cache-Zweig muss den Guard nachziehen');
  const iCache = SRC.indexOf('ftsAnnual = cached.payload.ftsAnnual;');
  const iNachzug = SRC.indexOf('_nullOutAllZeroGrossProfit(ftsAnnual.annualRev, ftsAnnual.annualGP)');
  assert.ok(iCache > 0 && iNachzug > iCache, 'und zwar unmittelbar nach dem Laden');
});
t('Verdrahtung: der QS-Aufruf steht VOR der Sektor-OpInc-Ableitung, wie NRB-SK-001', () => {
  const iGuard = SRC.indexOf('_nullOutAllZeroGrossProfit(annualRev, annualGP)');
  const iDerive = SRC.indexOf('_deriveOpIncForFinancials(isHist, annualRev, _opMargRaw)');
  assert.ok(iGuard > 0 && iDerive > iGuard,
    'die Bereinigung muss laufen, BEVOR ein Wert die Sektor-Ableitung fuettert');
});
t('Verdrahtung: die Buendel-Regel steht auf Modul-Ebene, nicht als Closure in pullAll', () => {
  assert.equal(typeof mergeAnnualIncomeBundle, 'function');
  assert.ok(!/const mergeAnnualIncomeBundle = \(qsB, ftsB\) =>/.test(SRC),
    'das alte Closure darf nicht zurueckkehren — sonst kann der Waechter die Regel nur nachbauen (F1334)');
});

console.log(`\nfti-jahresbuendel-nullwerte.test.js: ${fails === 0 ? 'alle Faelle gruen' : fails + ' FAIL'}`);
process.exit(fails ? 1 : 0);

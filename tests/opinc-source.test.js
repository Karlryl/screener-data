'use strict';
/**
 * Waechter zu A1 — Gerichts-Abhilfe K1 (Urteil _COURT-T164-OPINC-2026-08-29.md,
 * ratifiziert als ENTSCHIED 15 am 29.08.2026).
 *
 * Was hier festgenagelt wird, in BEIDE Richtungen (eine Wache, die nur die gewollte
 * Richtung prueft, ist blind fuer den Tag, an dem sie immer feuert):
 *   1. SEC-Serie vorhanden + Ausrichtung belegt -> 'sec-gaap' gewinnt, Werte getauscht.
 *   2. KEINE SEC-Serie             -> Yahoo-Reihe bleibt unberuehrt (K1.3: kein Name
 *                                     verliert Daten, kein Exclude fuer Nur-Yahoo-Namen).
 *   3. Ausrichtung NICHT belegbar  -> Yahoo bleibt. Die Luecke wird benannt, nicht erfunden.
 *   4. Loch in der SEC-Reihe       -> Yahoo bleibt (keine Reihe aus zwei Definitionen).
 *   5. Etiketten-Migration         -> 'native' ueberlebt nirgends; 'computed-margin' bleibt.
 *   6. Idempotenz + Rueckweg       -> zweiter Lauf aendert nichts; faellt die SEC-Serie
 *                                     weg, kommt die bewahrte Yahoo-Reihe zurueck.
 *   7. Regressionsanker des Urteils (wortlaut-gebunden, Zahlen als Literale):
 *        HNRG FY2024 = -218,156 Mio.   ·   EGY neuestes OpInc = -20,607 Mio.
 *      Faellt einer davon, ist es KEIN Nachjustier-Fall — das Urteil nennt das
 *      ausdruecklich einen zweiten Mechanismus und einen neuen Fall.
 *   8. pull-yahoo.js schreibt das tote Etikett nicht mehr.
 *
 * Usage:  node tests/opinc-source.test.js   (Exit 0/1)
 */
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const M = require('../scripts/opinc-source-migrate.js');
const { decideOpInc, migrateSnapshot, honestYahooLabel, revAlignment, run } = M;

let fails = 0;
function t(name, fn) {
  try { fn(); console.log('  ok   ' + name); }
  catch (e) { fails++; console.error('  FAIL ' + name + '\n       ' + e.message); }
}
const cells = (arr) => arr.map((v) => (v === null ? null : { value: v }));
const plain = (arr) => (arr || []).map((c) => (c && typeof c === 'object' ? c.value : c));

// Reale Zahlen aus dem Store-Stand vom 29.08.2026 bzw. aus
// external-data/sec-secannual-smallcap.json. Als LITERALE hier, nicht aus den
// Produktionsdateien geladen: sonst prueft die Wache nur, dass eine Datei sich selbst
// gleicht, und stirbt still, sobald der Name aus der Schicht faellt.
const HNRG_YAHOO_OPINC = [58567000, -555000, 65410000, 30430000];
const HNRG_SEC_OPINC = [61056000, -218156000, 65012000, 30430000, -6044000];
const HNRG_YAHOO_REV = [469466000, 404159000, 634878000, 361991000];
const HNRG_SEC_REV = [469466000, 404394000, 634480000, 361991000, 243903000];
const EGY_YAHOO_OPINC = [46617000, 136496000, 166141000, 180143000];
const EGY_SEC_OPINC = [-20607000, 136496000, 158657000, 171276000, 79100000];
const EGY_YAHOO_REV = [359272000, 478988000, 455066000, 354326000];
const EGY_SEC_REV = [359272000, 478988000, 455066000, 354326000, 199075000];

const snap = (ticker, opInc, rev, source = 'native', extra = {}) => ({
  meta: { ticker, sector: 'Energy', opIncSource: source },
  annual: { annualOpInc: cells(opInc), annualRev: cells(rev), ...(extra.annual || {}) },
});
const secOf = (opInc, rev) => ({ annualOpInc: cells(opInc), annualRev: cells(rev) });

console.log('opinc-source (A1 / Urteil T164 K1)');

// ─── 1. SEC gewinnt, wenn die Serie da ist und die Ausrichtung traegt ────────────
t('SEC-Serie vorhanden + Ausrichtung belegt -> sec-gaap gewinnt', () => {
  const s = snap('HNRG', HNRG_YAHOO_OPINC, HNRG_YAHOO_REV);
  const r = migrateSnapshot(s, secOf(HNRG_SEC_OPINC, HNRG_SEC_REV));
  assert.equal(r.label, 'sec-gaap');
  assert.equal(r.reason, 'sec-preferred');
  assert.equal(s.meta.opIncSource, 'sec-gaap');
  assert.equal(r.valuesChanged, true);
});

// ─── 2. Gegenrichtung: ohne SEC-Serie bleibt Yahoo unangetastet (K1.3) ───────────
t('KEINE SEC-Serie -> Yahoo-Reihe bleibt Wert fuer Wert, nur das Etikett wird ehrlich', () => {
  const s = snap('NOSEC', [11, 22, 33, 44], [100, 200, 300, 400]);
  const r = migrateSnapshot(s, undefined);
  assert.equal(r.reason, 'no-sec-series');
  assert.equal(r.label, 'yahoo-adjusted');
  assert.equal(r.valuesChanged, false, 'ein Nur-Yahoo-Name darf keinen Wert verlieren');
  assert.deepEqual(plain(s.annual.annualOpInc), [11, 22, 33, 44]);
  assert.equal(s.annual.annualOpIncYahoo, undefined, 'ohne Tausch kein Schattenfeld');
});

// ─── 3. Ausrichtung nicht belegbar -> kein Tausch ────────────────────────────────
t('Umsatz-Ausrichtung reisst (>2 %) -> Yahoo bleibt, Grund benannt', () => {
  // Gleiche OpInc-Konstellation wie HNRG, aber der Umsatz weicht um 27 % ab (IVZ-Klasse).
  const s = snap('MISALIGN', HNRG_YAHOO_OPINC, [469466000, 404159000, 634878000, 361991000]);
  const r = migrateSnapshot(s, secOf(HNRG_SEC_OPINC, [469466000, 295000000, 634480000, 361991000]));
  assert.equal(r.reason, 'alignment-failed');
  assert.equal(r.label, 'yahoo-adjusted');
  assert.deepEqual(plain(s.annual.annualOpInc), HNRG_YAHOO_OPINC);
});

t('weniger als zwei vergleichbare Umsatzjahre -> unbelegbar, kein Tausch (IREN-Klasse)', () => {
  const s = snap('SHORT', [-329045000, -10000000, -5000000, -1000000], [501000000, 75000000, 4000000, 1000000]);
  const r = migrateSnapshot(s, secOf([17327000], [510000000]));
  assert.equal(r.alignment.pairs, 1);
  assert.equal(r.reason, 'alignment-unprovable');
  assert.deepEqual(plain(s.annual.annualOpInc), [-329045000, -10000000, -5000000, -1000000]);
});

// ─── 4. Loch in der SEC-Reihe -> keine Reihe aus zwei Definitionen ───────────────
t('SEC-Reihe hat im Fenster ein Loch, Yahoo einen Wert -> kein Tausch', () => {
  const s = snap('HOLE', [10, 20, 30, 40], [100, 200, 300, 400]);
  const r = migrateSnapshot(s, secOf([11, null, 33, 44], [100, 200, 300, 400]));
  assert.equal(r.reason, 'sec-series-hole');
  assert.deepEqual(plain(s.annual.annualOpInc), [10, 20, 30, 40]);
});

t('kuerzere SEC-Reihe als das Yahoo-Fenster faellt unter dieselbe Loch-Regel', () => {
  const s = snap('SHORTSEC', [10, 20, 30, 40], [100, 200, 300, 400]);
  const r = migrateSnapshot(s, secOf([11, 21], [100, 200, 300, 400]));
  assert.equal(r.reason, 'sec-series-hole');
  assert.deepEqual(plain(s.annual.annualOpInc), [10, 20, 30, 40]);
});

t('Yahoo-Loch, das SEC fuellt, ist KEIN Loch — der Name gewinnt ein Jahr', () => {
  const s = snap('DBD', [10, 20, null, 40], [100, 200, 300, 400]);
  const r = migrateSnapshot(s, secOf([10, 20, 33, 40], [100, 200, 300, 400]));
  assert.equal(r.reason, 'sec-preferred');
  assert.deepEqual(plain(s.annual.annualOpInc), [10, 20, 33, 40]);
});

// ─── 5. Etiketten ───────────────────────────────────────────────────────────────
t("das Etikett 'native' stirbt, synthetische Etiketten bleiben unangetastet", () => {
  assert.equal(honestYahooLabel('native'), 'yahoo-adjusted');
  assert.equal(honestYahooLabel(undefined), 'yahoo-adjusted');
  assert.equal(honestYahooLabel('computed-margin'), 'computed-margin');
  assert.equal(honestYahooLabel('computed-bank'), 'computed-bank');
  assert.equal(honestYahooLabel(null), null);
});

t('computed-margin ohne SEC-Serie behaelt sein Etikett (K2: ist bereits ehrlich)', () => {
  const s = snap('SYNTH', [5, 6, 7, 8], [100, 200, 300, 400], 'computed-margin');
  const r = migrateSnapshot(s, undefined);
  assert.equal(r.label, 'computed-margin');
  assert.equal(r.valuesChanged, false);
});

t('computed-margin MIT belegter SEC-Serie wird zu sec-gaap (echte Reihe schlaegt Synthetik)', () => {
  const s = snap('SYNTH2', [5000000, 6000000, 7000000, 8000000], [100, 200, 300, 400], 'computed-margin');
  const r = migrateSnapshot(s, secOf([-1000000, 6000000, 7000000, 8000000], [100, 200, 300, 400]));
  assert.equal(r.label, 'sec-gaap');
  assert.equal(s.meta.opIncSourceYahoo, 'computed-margin', 'die Herkunft der bewahrten Reihe bleibt lesbar');
});

// ─── 6. Idempotenz und Rueckweg ─────────────────────────────────────────────────
t('zweiter Lauf aendert nichts (idempotent, keine Kettung)', () => {
  const s = snap('HNRG', HNRG_YAHOO_OPINC, HNRG_YAHOO_REV);
  const sec = secOf(HNRG_SEC_OPINC, HNRG_SEC_REV);
  migrateSnapshot(s, sec);
  const nach1 = JSON.stringify(s);
  const r2 = migrateSnapshot(s, sec);
  assert.equal(r2.changed, false);
  assert.equal(JSON.stringify(s), nach1);
  assert.deepEqual(plain(s.annual.annualOpIncYahoo), HNRG_YAHOO_OPINC, 'die Yahoo-Reihe bleibt bewahrt');
});

t('faellt die SEC-Serie weg, kommt die Yahoo-Reihe zurueck (kein Ratchet)', () => {
  const s = snap('HNRG', HNRG_YAHOO_OPINC, HNRG_YAHOO_REV);
  migrateSnapshot(s, secOf(HNRG_SEC_OPINC, HNRG_SEC_REV));
  assert.equal(s.meta.opIncSource, 'sec-gaap');
  const r = migrateSnapshot(s, undefined);
  assert.equal(r.label, 'yahoo-adjusted');
  assert.deepEqual(plain(s.annual.annualOpInc), HNRG_YAHOO_OPINC);
  assert.equal(s.annual.annualOpIncYahoo, undefined);
});

// ─── 7. Regressionsanker des Urteils ────────────────────────────────────────────
t('ANKER HNRG: FY2024 zeigt nach dem Fix -218,156 Mio. (vorher -0,555 Mio.)', () => {
  const s = snap('HNRG', HNRG_YAHOO_OPINC, HNRG_YAHOO_REV);
  assert.equal(plain(s.annual.annualOpInc)[1], -555000, 'Vorzustand des Ankers');
  migrateSnapshot(s, secOf(HNRG_SEC_OPINC, HNRG_SEC_REV));
  assert.equal(plain(s.annual.annualOpInc)[1], -218156000);
  assert.equal(s.annual.annualOpInc.length, 4, 'die Fensterlaenge bleibt — annualRev[i] bleibt gepaart');
});

t('ANKER EGY: neuestes OpInc kippt +46,617 Mio. -> -20,607 Mio. (energy-Track profitable->unprofitable)', () => {
  const s = snap('EGY', EGY_YAHOO_OPINC, EGY_YAHOO_REV);
  assert.equal(plain(s.annual.annualOpInc)[0], 46617000, 'Vorzustand des Ankers');
  migrateSnapshot(s, secOf(EGY_SEC_OPINC, EGY_SEC_REV));
  const neu = plain(s.annual.annualOpInc)[0];
  assert.equal(neu, -20607000);
  // src/scoring/formulas/energy.js:14 splitMetric 'OpInc' -> score.js signTrack liest NUR
  // das neueste Vorzeichen. Genau dieses Vorzeichen dreht hier.
  assert.equal(Math.sign(46617000), 1);
  assert.equal(Math.sign(neu), -1);
});

// ─── 8. Ende-zu-Ende ueber ein Verzeichnis + die Schreibseite ───────────────────
t('run() ueber ein Verzeichnis: schreibt, zaehlt und laesst Nur-Yahoo-Namen in Ruhe', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'opinc-'));
  const store = path.join(tmp, 'snapshots');
  fs.mkdirSync(path.join(tmp, 'external-data'), { recursive: true });
  fs.mkdirSync(store, { recursive: true });
  fs.writeFileSync(path.join(store, 'HNRG.json'), JSON.stringify(snap('HNRG', HNRG_YAHOO_OPINC, HNRG_YAHOO_REV)));
  fs.writeFileSync(path.join(store, 'NOSEC.json'), JSON.stringify(snap('NOSEC', [11, 22, 33, 44], [100, 200, 300, 400])));
  fs.writeFileSync(path.join(store, '_manifest.json'), JSON.stringify({ n_eingang_snapshots: 2 }));
  fs.writeFileSync(path.join(tmp, 'external-data', 'sec-secannual.json'),
    JSON.stringify({ HNRG: secOf(HNRG_SEC_OPINC, HNRG_SEC_REV) }));

  const { zusammenfassung: z, zeilen } = run({ root: tmp, dirs: ['snapshots'] });
  assert.equal(z.dateien, 2, '_manifest.json wird nicht als Snapshot gezaehlt');
  assert.equal(z.etiketten['->sec-gaap'], 1);
  assert.equal(z.etiketten['native->yahoo-adjusted'], 1);
  assert.equal(z.werteGeaendert, 1);
  assert.equal(zeilen.length, 1);
  assert.equal(zeilen[0].ticker, 'HNRG');

  const geschrieben = JSON.parse(fs.readFileSync(path.join(store, 'HNRG.json'), 'utf8'));
  assert.equal(geschrieben.meta.opIncSource, 'sec-gaap');
  assert.equal(plain(geschrieben.annual.annualOpInc)[1], -218156000);
  const unberuehrt = JSON.parse(fs.readFileSync(path.join(store, 'NOSEC.json'), 'utf8'));
  assert.equal(unberuehrt.meta.opIncSource, 'yahoo-adjusted');
  assert.deepEqual(plain(unberuehrt.annual.annualOpInc), [11, 22, 33, 44]);

  // Kein 'native' ueberlebt die Migration.
  for (const f of ['HNRG.json', 'NOSEC.json']) {
    const s = JSON.parse(fs.readFileSync(path.join(store, f), 'utf8'));
    assert.notEqual(s.meta.opIncSource, 'native', `${f} traegt noch das tote Etikett`);
  }
  fs.rmSync(tmp, { recursive: true, force: true });
});

// H1 (Nacht-Sweep 29.08.): FEHLEND und UNLESBAR sind zwei verschiedene Zustaende.
// Beide Richtungen, sonst ist die Wache blind: die abwesende Schicht MUSS still
// uebersprungen werden (sonst laeuft kein Small-Cap-Lauf mehr), die truncierte MUSS
// den Lauf reissen (sonst faellt die Quellen-Praeferenz still auf Yahoo zurueck).
t('loadSecLayer: fehlende Schicht = still, kaputte Schicht = Abbruch', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'opinc-sec-'));
  const store = path.join(tmp, 'snapshots');
  fs.mkdirSync(path.join(tmp, 'external-data'), { recursive: true });
  fs.mkdirSync(store, { recursive: true });
  fs.writeFileSync(path.join(store, 'HNRG.json'), JSON.stringify(snap('HNRG', HNRG_YAHOO_OPINC, HNRG_YAHOO_REV)));

  // Richtung A: gar keine Schicht -> kein Wurf, nur leeres `geladen`.
  const ohne = run({ root: tmp, dirs: ['snapshots'] });
  assert.deepEqual(ohne.zusammenfassung.secDateien, [], 'fehlende Datei darf nicht werfen');

  // Richtung B: Schicht vorhanden, aber abgeschnitten -> Abbruch statt stiller Rueckfall.
  const p = path.join(tmp, 'external-data', 'sec-secannual.json');
  fs.writeFileSync(p, JSON.stringify({ HNRG: secOf(HNRG_SEC_OPINC, HNRG_SEC_REV) }).slice(0, 120));
  assert.throws(() => run({ root: tmp, dirs: ['snapshots'] }), /JSON|Unexpected|Unterminated/i,
    'truncierte SEC-Schicht muss den Lauf reissen, nicht die Praeferenz zurueckdrehen');
  fs.rmSync(tmp, { recursive: true, force: true });
});

// M1 (Nacht-Sweep 29.08.): ein unlesbarer Snapshot verschwand spurlos aus der Bilanz.
// Beide Richtungen: sauberer Store -> Zaehler 0, kaputte Datei -> Zaehler > 0 UND
// `dateien` zaehlt sie nicht mit (sonst waere die Abdeckungsaussage weiterhin falsch).
t('run() zaehlt unlesbare Snapshots, statt sie stumm zu ueberspringen', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'opinc-skip-'));
  const store = path.join(tmp, 'snapshots');
  fs.mkdirSync(store, { recursive: true });
  fs.writeFileSync(path.join(store, 'OK.json'), JSON.stringify(snap('OK', [1, 2, 3, 4], [10, 20, 30, 40])));

  const sauber = run({ root: tmp, dirs: ['snapshots'] }).zusammenfassung;
  assert.equal(sauber.uebersprungen, 0, 'sauberer Store darf nichts als uebersprungen melden');
  assert.equal(sauber.dateien, 1);

  fs.writeFileSync(path.join(store, 'KAPUTT.json'), '{"meta":{"ticker":"KAPUTT"');
  const mit = run({ root: tmp, dirs: ['snapshots'] }).zusammenfassung;
  assert.equal(mit.uebersprungen, 1, 'kaputte Datei muss im Zaehler landen');
  assert.equal(mit.dateien, 1, 'und darf NICHT als geprueft gelten');
  fs.rmSync(tmp, { recursive: true, force: true });
});

// M2 (Nacht-Sweep 29.08.): die else-if-Kette hatte kein `else`. Der Rueckweg
// sec-gaap -> computed-margin (SEC-Serie faellt weg) landete in keinem Eimer.
// Beide Richtungen: der Rueckweg MUSS gezaehlt werden, und die Eimersumme MUSS
// die geprueften Dateien ausschoepfen.
t('Etiketten-Eimer schoepfen den Bestand aus, auch auf dem Rueckweg', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'opinc-zensus-'));
  const store = path.join(tmp, 'snapshots');
  fs.mkdirSync(path.join(tmp, 'external-data'), { recursive: true });
  fs.mkdirSync(store, { recursive: true });

  // Ein Name, der bereits sec-gaap traegt und die bewahrte Yahoo-Reihe mitfuehrt,
  // aber KEINE SEC-Serie mehr vorfindet -> Etikett faellt auf computed-margin zurueck.
  const zurueck = snap('RUECK', HNRG_SEC_OPINC, HNRG_SEC_REV, 'sec-gaap');
  zurueck.annual.annualOpIncYahoo = cells(HNRG_YAHOO_OPINC);
  zurueck.meta.opIncSourceYahoo = 'computed-margin';
  fs.writeFileSync(path.join(store, 'RUECK.json'), JSON.stringify(zurueck));
  fs.writeFileSync(path.join(tmp, 'external-data', 'sec-secannual.json'), JSON.stringify({}));

  const z = run({ root: tmp, dirs: ['snapshots'] }).zusammenfassung;
  const summe = Object.values(z.etiketten).reduce((a, b) => a + b, 0);
  assert.equal(summe, z.dateien, 'Eimersumme muss die geprueften Dateien ausschoepfen');
  assert.equal(z.werteGeaendert, 1, 'der Rueckweg bewegt die Werte');
  assert.ok(z.etiketten.sonstige >= 1 || z.etiketten['sec-gaap->yahoo-adjusted'] >= 1,
    'der Rueckweg muss in einem benannten Eimer landen, nicht im Nichts');
  fs.rmSync(tmp, { recursive: true, force: true });
});

t('--dry-run schreibt nicht', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'opinc-dry-'));
  fs.mkdirSync(path.join(tmp, 'snapshots'), { recursive: true });
  const p = path.join(tmp, 'snapshots', 'X.json');
  const vorher = JSON.stringify(snap('X', [1, 2, 3, 4], [10, 20, 30, 40]));
  fs.writeFileSync(p, vorher);
  run({ root: tmp, dirs: ['snapshots'], dryRun: true });
  assert.equal(fs.readFileSync(p, 'utf8'), vorher);
  fs.rmSync(tmp, { recursive: true, force: true });
});

// ─── 9. Die Schreibseite in pull-yahoo.js ───────────────────────────────────────
// Der Mapper wird AUSGEFUEHRT, nicht der Quelltext nach Schreibmustern abgesucht
// (dieselbe Bauform wie tests/a10-jahres-periodenenden.test.js und tag559/tag561).
// Ein erster Entwurf dieser Wache griff auf `opIncSource = 'native'` per Regex und
// sah den zurueckgedrehten Ternaer `? 'native' : null` NICHT — der absichtliche Bruch
// lief still gruen durch. Genau dafuer ist der Bruchtest da.
const { mapYahooToCanonical } = require('../pull-yahoo.js');
const mappe = (isHist, extra = {}) => mapYahooToCanonical(
  { incomeStatementHistory: { incomeStatementHistory: isHist }, summaryDetail: { marketCap: 1 }, ...extra },
  { ticker: 'OPS1' }, '2026-08-29T00:00:00Z');

t("pull-yahoo.js etikettiert eine Yahoo-OpInc-Reihe als 'yahoo-adjusted', nie als 'native'", () => {
  const c = mappe([
    { endDate: '2025-12-31', totalRevenue: 300, operatingIncome: 30, grossProfit: 200 },
    { endDate: '2024-12-31', totalRevenue: 250, operatingIncome: 25, grossProfit: 170 },
  ]);
  assert.ok(c.annual.annualOpInc.length > 0, 'Vorbedingung: der Mapper liefert eine OpInc-Reihe');
  assert.notEqual(c.meta.opIncSource, 'native', "das tote Etikett lebt noch in pull-yahoo.js");
  assert.equal(c.meta.opIncSource, 'yahoo-adjusted');
});

t("die zweite Schreibstelle (FTS-Gewinner) traegt kein 'native' mehr", () => {
  // EHRLICHE GRENZE: diese eine Pruefung liest den Quelltext, weil die Stelle nur
  // erreichbar ist, wenn das FTS-Buendel das Income-Buendel gewinnt — das haengt an
  // pullAll und damit am Netz, ist also nicht hermetisch ausfuehrbar. Sie greift
  // deshalb nur die ZUWEISUNGSFORM. Der belastbare Boden darunter ist ein anderer:
  // scripts/opinc-source-migrate.js normalisiert die Etiketten vor JEDEM Scoring-Lauf,
  // ein Rueckfall an dieser Stelle ueberlebte den naechsten Lauf also nicht.
  const src = fs.readFileSync(path.join(__dirname, '..', 'pull-yahoo.js'), 'utf8');
  const treffer = src.match(/opIncSource\s*=\s*'native'/g) || [];
  assert.deepEqual(treffer, [], `pull-yahoo.js weist noch 'native' zu (${treffer.length}x)`);
});

t('ohne OpInc-Reihe bleibt opIncSource null (kein erfundenes Etikett)', () => {
  const c = mappe([{ endDate: '2025-12-31', totalRevenue: 300, grossProfit: 200 }]);
  assert.equal(c.annual.annualOpInc.length, 0);
  assert.equal(c.meta.opIncSource, null);
});

// ─── 10. revAlignment selbst ───────────────────────────────────────────────────
t('revAlignment zaehlt nur positionsweise vergleichbare Jahre', () => {
  const a = revAlignment(cells([100, null, 300]), cells([100, 200, 306]), 3);
  assert.equal(a.pairs, 2);
  assert.ok(Math.abs(a.maxRel - (6 / 306)) < 1e-9, 'maxRel = groesste relative Abweichung');
  const leer = revAlignment(undefined, undefined, 4);
  assert.deepEqual(leer, { pairs: 0, maxRel: 0 });
});

t('decideOpInc mutiert den Snapshot nicht (reine Funktion)', () => {
  const s = snap('HNRG', HNRG_YAHOO_OPINC, HNRG_YAHOO_REV);
  const vorher = JSON.stringify(s);
  decideOpInc(s, secOf(HNRG_SEC_OPINC, HNRG_SEC_REV));
  assert.equal(JSON.stringify(s), vorher);
});

if (fails) { console.error(`\n${fails} Pruefung(en) gerissen.`); process.exit(1); }
console.log('\nalle Pruefungen gruen.');

'use strict';
/**
 * b07-runscreener — Test-Gate fuer BH-011/BH-116/BH-117/BH-198 (src/scoring/run-screener.js).
 * ==============================================================================
 * BH-011: mergeSecIntoUniverse zaehlte Coverage bisher an blosser Key-Praesenz (d truthy),
 *   nicht an finiten Serien -> Logs/Doku ueberzeichneten die tatsaechliche Tiefe. Pinnt
 *   hasFiniteSeries() als die neue, korrekte Klassifikation (leer/undefined/NaN-only -> false).
 * BH-116: loadUniverse lud JEDE *.json in snapshots/ ohne Watchlist-Filter -> Snapshot-
 *   Altbestand fuer delistete/geprunte Ticker wuerde mitgescort. Pinnt filterToAuthorizedUniverse()
 *   als reine, testbare Schnitt-Logik (fail-open bei leerer/kaputter Watchlist).
 * BH-116-Regression (Opus-Review): der Watchlist-Schnitt lief in loadUniverse VOR dem
 *   Coverage-Floor -> legitimes Pruning (ganze Boersen ohne Watchlist-Eintrag) loeste denselben
 *   Floor aus, der Snapshot-Korruption faengt (dauerhafter Fehl-Abbruch). Fix: loadUniverse rechnet
 *   Floor/High-Water gegen die ROHE on-disk-Menge (rawCount, vor dem Filter), der Watchlist-Schnitt
 *   folgt danach. Pinnt das Zahlenbeispiel aus dem Fund (4681 -> 3077).
 * BH-117: baseline (_last_good_disk.json) ist in jedem CI-Lauf null (Workflow persistiert die
 *   Datei nicht ueber Job-Grenzen — ausserhalb dieser Datei/dieses Batches). Der Floor bleibt
 *   dadurch bewusst fail-open (Erstlauf-Vertrag, unveraendert); kein eigenstaendig testbarer
 *   Verhaltensfix in dieser Datei, siehe Notiz im Rueckgabe-JSON. Kein Test hier noetig.
 * BH-198: --topN akzeptierte bisher jeden finiten Wert inkl. negativer Ganzzahlen unvalidiert
 *   (slice(0,-1) statt Fehler). Pinnt parseTopNArg() als die neue Validierung.
 *
 * Usage:  node tests/scoring/bh-b07-runscreener.test.js   (Exit 0/1)
 */
const assert = require('node:assert/strict');
const {
  filterToAuthorizedUniverse,
  hasFiniteSeries,
  parseTopNArg,
  assertCoverageFloor,
  floorReferenz,
  FLOOR_BASIS_EINGANG,
  FLOOR_BASIS_ONDISK,
} = require('../../src/scoring/run-screener.js');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); }
}

// --- BH-011: hasFiniteSeries -------------------------------------------------
test('hasFiniteSeries: finite Zahl irgendwo im Array -> true', () => {
  assert.equal(hasFiniteSeries([null, undefined, 42, NaN]), true);
});
test('hasFiniteSeries: nur null/undefined/NaN/Infinity -> false (der eigentliche BH-011-Bug)', () => {
  assert.equal(hasFiniteSeries([null, null]), false);
  assert.equal(hasFiniteSeries([undefined]), false);
  assert.equal(hasFiniteSeries([NaN, Infinity, -Infinity]), false);
});
test('hasFiniteSeries: leeres Array / kein Array / undefined -> false', () => {
  assert.equal(hasFiniteSeries([]), false);
  assert.equal(hasFiniteSeries(undefined), false);
  assert.equal(hasFiniteSeries(null), false);
  assert.equal(hasFiniteSeries('not-an-array'), false);
});

// --- Review-Befund 03.08.2026: das Diagnose-Log meldete das GEGENTEIL der Wahrheit ---
// hasFiniteSeries prueft mit Number.isFinite auf PLAIN NUMBERS. Die SEC-Datei speichert aber
// {value:N}-Objekte — dieselbe Form, die normSec (score.js), secSeries (axes.js) und
// annualSharesSeries (lamps.js) alle auspacken, bevor sie rechnen. Folge: der Zaehler in
// mergeSecIntoUniverse meldete seit BH-011 strukturell rev=0, oi=0, roicTrio=0, waehrend das
// Scoring die Serien in Wirklichkeit voll benutzt. Kein Score-Bezug, aber das Log log.
test('hasFiniteSeries: {value:N}-Objektform (die ECHTE Form der SEC-Datei) -> true', () => {
  assert.equal(hasFiniteSeries([{ value: null }, { value: 12831000000 }]), true);
});
test('hasFiniteSeries: {value:null}-only bleibt false (leere Serie mit Objekt-Huelle)', () => {
  assert.equal(hasFiniteSeries([{ value: null }, { value: null }]), false);
  assert.equal(hasFiniteSeries([{}, { value: NaN }]), false);
});
test('hasFiniteSeries: gegen die committete SEC-Datei — der Zaehler darf nicht strukturell 0 sein', () => {
  // Der Beleg am echten Artefakt, nicht an einer Fixture: wenn die Datei da ist, MUSS die
  // Klassifikation Namen mit Umsatzreihe finden. Fehlt die Datei (Alt-Checkout), ist nichts
  // zu pruefen — dann still ueberspringen statt falsch gruen behaupten.
  const p = require('node:path').join(__dirname, '..', '..', 'external-data', 'sec-secannual.json');
  if (!require('node:fs').existsSync(p)) return;
  const data = JSON.parse(require('node:fs').readFileSync(p, 'utf8'));
  const tickers = Object.keys(data);
  const mitRev = tickers.filter((t) => hasFiniteSeries(data[t].annualRev)).length;
  assert.ok(mitRev > 0,
    `0 von ${tickers.length} SEC-Namen mit finiter annualRev — das Diagnose-Log meldet das Gegenteil der Wahrheit`);
});

// --- BH-116: filterToAuthorizedUniverse -------------------------------------
test('filterToAuthorizedUniverse: schneidet Snapshots raus, die nicht in der Watchlist stehen', () => {
  const u = [
    { meta: { ticker: 'AAPL' } },
    { meta: { ticker: 'DELISTED.OLD' } }, // geprunter Ticker, Snapshot-Datei ueberlebt auf Disk
    { meta: { ticker: 'MSFT' } },
  ];
  const wl = [{ ticker: 'AAPL' }, { ticker: 'MSFT' }];
  const { filtered, dropped } = filterToAuthorizedUniverse(u, wl);
  assert.deepEqual(filtered.map((s) => s.meta.ticker), ['AAPL', 'MSFT']);
  assert.equal(dropped, 1);
});
test('filterToAuthorizedUniverse: leere/kaputte Watchlist -> fail-open (kein Schnitt)', () => {
  const u = [{ meta: { ticker: 'AAPL' } }, { meta: { ticker: 'MSFT' } }];
  assert.deepEqual(filterToAuthorizedUniverse(u, []).filtered, u);
  assert.deepEqual(filterToAuthorizedUniverse(u, null).filtered, u);
  assert.deepEqual(filterToAuthorizedUniverse(u, undefined).filtered, u);
  assert.equal(filterToAuthorizedUniverse(u, []).dropped, 0);
});
test('filterToAuthorizedUniverse: alles autorisiert -> nichts gedroppt', () => {
  const u = [{ meta: { ticker: 'AAPL' } }, { meta: { ticker: 'MSFT' } }];
  const wl = [{ ticker: 'AAPL' }, { ticker: 'MSFT' }, { ticker: 'GOOG' }];
  const { filtered, dropped } = filterToAuthorizedUniverse(u, wl);
  assert.equal(filtered.length, 2);
  assert.equal(dropped, 0);
});

// --- BH-116-Regression (Opus-Review b07): Coverage-Floor muss gegen die ROHE on-disk-Menge
// rechnen (rawCount, VOR dem Watchlist-Schnitt in loadUniverse), nicht gegen den gefilterten Count —
// sonst loest legitimes Watchlist-Prunen (ganze Boersen ohne Watchlist-Eintrag) denselben
// Korruptions-Floor aus, der eigentlich Parse-Fails/Snapshot-Schwund faengt. Reproduziert das
// gemeldete Zahlenbeispiel 4681 -> 3077 (34% weg, floor=ceil(0.95*4681)=4447).
test('BH-116-Regression: Floor gegen rawCount uebersteht legitimes Watchlist-Pruning', () => {
  const rawCount = 4681;
  const baseline = 4681;
  const u = Array.from({ length: rawCount }, (_, i) => ({ meta: { ticker: `T${i}` } }));
  const wl = u.slice(0, 3077).map((s) => ({ ticker: s.meta.ticker })); // nur 3077 autorisiert
  const { filtered, dropped } = filterToAuthorizedUniverse(u, wl);
  assert.equal(filtered.length, 3077);
  assert.equal(dropped, 1604);
  // Der Fix: loadUniverse prueft assertCoverageFloor(rawCount, baseline) VOR dem Filter -> kein throw.
  assert.doesNotThrow(() => assertCoverageFloor(rawCount, baseline),
    'Floor gegen die rohe on-disk-Menge darf legitimes Pruning nicht bestrafen');
  // Gegenprobe/Regressions-Wächter: der GEFILTERTE Count waere faelschlich unter den Floor gefallen —
  // genau das war der BH-116-Bug (Filter lief vor dem Floor). Bleibt dieser throw irgendwann aus,
  // ist die alte, falsche Verdrahtung zurueckgekehrt.
  assert.throws(() => assertCoverageFloor(filtered.length, baseline), /Coverage-Floor|geschrumpft/i,
    'gegenprobe: der gefilterte Count waere faelschlich unter den Floor gefallen (das war der Bug)');
});

// --- F-12-R1 (Review Tag 563): die Floor-Referenz ist die EINGANGS-Zahl ----------
// Seit dem F-12-Karteileichen-Filter im merge-Job enthaelt snapshots/ nur noch die
// watchlist-autorisierten Staende. Damit war rawCount SELBST plattengefiltert und der Floor
// mass wieder Pruning statt Korruption — exakt die Kopplung, die BH-116/C1 oben geloest
// hatte, nur eine Ebene frueher wieder eingezogen. Referenz ist jetzt n_eingang_snapshots
// (die Menge VOR dem Filter, geschrieben von scripts/filter-snapshot-merge.js).
test('F-12-R1: mit n_eingang_snapshots rechnet der Floor gegen die Eingangs-Menge', () => {
  const r = floorReferenz({ n_eingang_snapshots: 12540 }, 10734, { value: 12540, basis: FLOOR_BASIS_EINGANG });
  assert.equal(r.count, 12540, 'nicht die plattengefilterte Verzeichnis-Zaehlung');
  assert.equal(r.basis, FLOOR_BASIS_EINGANG);
  assert.equal(r.baseline, 12540);
  assert.deepEqual(r.warnungen, []);
  assert.doesNotThrow(() => assertCoverageFloor(r.count, r.baseline));
});

test('F-12-R1: der Filter selbst (14,4 % weg) reisst den Floor NICHT mehr', () => {
  // Genau der Lauf, fuer den Tag 563 den Cache-Namespace bumpen musste: on-disk faellt von
  // 12540 auf 10734 (-14,4 %), floor waere ceil(0.95*12540)=11913. Ueber die Eingangs-Zahl
  // bleibt die Referenz 12540 — kein Abbruch, kein Reset noetig.
  const r = floorReferenz({ n_eingang_snapshots: 12540 }, 10734, { value: 12540, basis: FLOOR_BASIS_EINGANG });
  assert.doesNotThrow(() => assertCoverageFloor(r.count, r.baseline));
  assert.throws(() => assertCoverageFloor(10734, 12540), /Coverage-Floor|geschrumpft/i,
    'gegenprobe: die on-disk-Zaehlung waere gefallen (das war der Befund)');
});

test('F-12-R1: fehlendes Feld -> LAUTER Fallback auf die on-disk-Zaehlung', () => {
  for (const m of [null, {}, { n_eingang_snapshots: 0 }, { n_eingang_snapshots: 'viele' }]) {
    const r = floorReferenz(m, 10734, null);
    assert.equal(r.count, 10734, 'Fallback = bisheriges Verhalten');
    assert.equal(r.basis, FLOOR_BASIS_ONDISK);
    assert.ok(r.warnungen.some((w) => /n_eingang_snapshots/.test(w)),
      `stilles Anders-Rechnen bei ${JSON.stringify(m)} — der Fallback muss laut sein`);
  }
});

test('F-12-R1: eine Baseline aus der ANDEREN Population wird verworfen statt falsch verglichen', () => {
  // Ohne diese Pruefung wuerde ein Fallback-Lauf (on-disk 10734) gegen eine Eingangs-Baseline
  // (12540) rechnen -> Fehl-Abbruch, obwohl kein Snapshot fehlt. Mischpopulationen sind genau
  // der Fehler, den dieser Befund behebt — nicht einer, den er neu einbaut.
  const r = floorReferenz({}, 10734, { value: 12540, basis: FLOOR_BASIS_EINGANG });
  assert.equal(r.basis, FLOOR_BASIS_ONDISK);
  assert.equal(r.baseline, null, 'Baseline anderer Population muss fallen (fail-open + laut), nicht falsch vergleichen');
  assert.ok(r.warnungen.some((w) => /Population/.test(w)));
  assert.doesNotThrow(() => assertCoverageFloor(r.count, r.baseline));
});

test('F-12-R1: eine Alt-Baseline ohne basis-Feld gilt als on-disk (kein Cache-Reset noetig)', () => {
  const alt = floorReferenz({}, 10734, { value: 10700 });
  assert.equal(alt.baseline, 10700, 'gleiche Population -> Baseline bleibt gueltig');
  assert.deepEqual(alt.warnungen.filter((w) => /Population/.test(w)), []);
  // Umstieg auf die Eingangs-Zahl: Alt-Baseline faellt EINMAL, danach ankert sie neu.
  const neu = floorReferenz({ n_eingang_snapshots: 12540 }, 10734, { value: 10700 });
  assert.equal(neu.baseline, null);
  assert.ok(neu.warnungen.some((w) => /Population/.test(w)));
});

// --- BH-198: parseTopNArg ----------------------------------------------------
test('parseTopNArg: kein --topN -> Default 100', () => {
  assert.deepEqual(parseTopNArg(['node', 'run-screener.js']), { ok: true, value: 100 });
});
test('parseTopNArg: positive Ganzzahl -> ok', () => {
  assert.deepEqual(parseTopNArg(['node', 'run-screener.js', '--topN', '50']), { ok: true, value: 50 });
});
test('parseTopNArg: negative Ganzzahl -> REJECTED (der eigentliche BH-198-Bug: slice(0,-1) statt Fehler)', () => {
  const r = parseTopNArg(['node', 'run-screener.js', '--topN', '-1']);
  assert.equal(r.ok, false);
  assert.match(r.message, /positive Ganzzahl/);
});
test('parseTopNArg: 0/NaN/nicht-numerisch -> REJECTED', () => {
  assert.equal(parseTopNArg(['node', 'run-screener.js', '--topN', '0']).ok, false);
  assert.equal(parseTopNArg(['node', 'run-screener.js', '--topN', 'foo']).ok, false);
  assert.equal(parseTopNArg(['node', 'run-screener.js', '--topN', 'Infinity']).ok, false);
});

console.log(`bh-b07-runscreener.test.js: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);

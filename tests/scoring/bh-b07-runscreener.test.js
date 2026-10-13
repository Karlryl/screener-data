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
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  filterToAuthorizedUniverse,
  hasFiniteSeries,
  parseTopNArg,
  assertCoverageFloor,
  floorReferenz,
  FLOOR_BASIS_EINGANG,
  FLOOR_BASIS_ONDISK,
  assertParseFailAnteil,   // T565-H1
  loadUniverse,            // T565-H1 (Fixture an der echten Leseschleife)
  loadSmallcapUniverse,    // T569-F4 (Fixture am zweiten Loader)
  baselineFuer,            // T565-M2
  naechstesHochwasser,     // T565-M2
  COVERAGE_FLOOR_RATIO_ONDISK, // T569-F1
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

// --- T565-H1 (Review Tag 565): der Coverage-Floor misst keine KORRUPTION mehr ------
// Seit F-12-R1 rechnet der Floor gegen n_eingang_snapshots — eine Datei-ZAEHLUNG, die den
// Inhalt nicht kennt. parseFail (die einzige Zahl, die Korruption sieht) hatte bis Tag 569
// keinen harten Konsumenten: 40 % unlesbare Snapshots liefen gruen durch, und die Kohorten-
// Perzentile wurden lautlos auf der Restmenge gerechnet. Zwei Ebenen gepinnt: die reine
// Entscheidung UND die echte Leseschleife an einem Verzeichnis-Fixture.
test('T565-H1: Anteil ueber der Schwelle -> Abbruch', () => {
  assert.throws(() => assertParseFailAnteil(60, 40, 0), /nicht parsebar|Datenkorruption/i,
    '40 % unlesbar muss hart stoppen');
});
test('T565-H1: normaler Anteil (1 %) geht DURCH — die gueltige Form darf nicht sterben', () => {
  assert.doesNotThrow(() => assertParseFailAnteil(2574, 26, 0));
  assert.doesNotThrow(() => assertParseFailAnteil(12500, 0, 0), 'der Normalfall: 0 unlesbar');
});
test('T565-H1: unter der Mindest-Fallzahl wird nicht gequotelt (Kaltstart/Fixture-Schutz)', () => {
  assert.doesNotThrow(() => assertParseFailAnteil(2, 1, 0), '1 von 3 sind 33 %, aber kein Befund');
  assert.doesNotThrow(() => assertParseFailAnteil(0, 24, 0), '24 Faelle bleiben unter der Grenze');
  assert.throws(() => assertParseFailAnteil(0, 25, 0), /nicht parsebar/i, 'ab 25 Faellen zaehlt der Anteil');
});
// T569-F1 (Review Tag 569) DREHT DIESE ZUSICHERUNG BEWUSST UM — sie wird nicht abgeschwaecht,
// sondern verschaerft. Tag 565 zaehlte Schema-Drift NUR im Nenner ("Schema-Drift ist keine
// Korruption") und pinnte assertParseFailAnteil(1000, 30, 1970) als GRUEN. Das sind 1.970 von
// 3.000 Dateien ohne meta.ticker = 66 % — genau der Ausfall, den der eigene Docstring der
// Wache als "Schema-Drift" fuehrt. Der Grund, den Tag 565 dafuer angab (der Parse-Anteil darf
// nicht kuenstlich aufgeblasen werden), bleibt geschuetzt: der Nenner ist unveraendert die
// Summe aller drei Zaehler, eine KLEINE Drift kostet weiterhin keinen falsch-roten Abbruch.
test('T569-F1: Schema-Drift steht jetzt AUCH im Zaehler (Tag-565-Toleranz war die halbe Wache)', () => {
  assert.throws(() => assertParseFailAnteil(1000, 30, 1970), /unbrauchbar|nicht parsebar/i,
    'BEFUND: 66 % der Dateien ohne meta.ticker liefen bis Tag 571 gruen durch');
  assert.doesNotThrow(() => assertParseFailAnteil(2950, 30, 20),
    '50 von 3000 = 1,7 % — eine kleine Drift darf weiterhin nicht falsch-rot werden');
});
test('T565-H1: leeres Verzeichnis wirft nicht (0/0 ist kein Anteil)', () => {
  assert.doesNotThrow(() => assertParseFailAnteil(0, 0, 0));
});

// Verhaltens-Beleg an der ECHTEN Leseschleife (kein Nachbau): Verzeichnis-Fixture, loadUniverse.
function schreibeFixture(gesamt, kaputt) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 't565h1-'));
  const snapDir = path.join(root, 'snapshots');
  fs.mkdirSync(snapDir, { recursive: true });
  const ticker = [];
  for (let i = 0; i < gesamt; i++) {
    const t = 'T' + i;
    ticker.push(t);
    fs.writeFileSync(path.join(snapDir, t + '.json'),
      i < kaputt ? '{"meta":{"ticker":"' + t + '"' : JSON.stringify({ meta: { ticker: t }, metrics: {} }));
  }
  const wl = path.join(root, 'watchlist.json');
  fs.writeFileSync(wl, JSON.stringify({ stocks: ticker.map((t) => ({ ticker: t })) }));
  return { snapDir, wl };
}

test('T565-H1 (Fixture): 40 % kaputte Snapshots brechen loadUniverse ab', () => {
  const { snapDir, wl } = schreibeFixture(100, 40);
  assert.throws(() => loadUniverse(snapDir, wl), /nicht parsebar|Datenkorruption/i,
    'BEFUND: bis Tag 569 lief genau das gruen durch — der Floor sieht Dateien, nicht Inhalte');
});

test('T565-H1 (Fixture): 1 % kaputte Snapshots laufen normal durch', () => {
  const { snapDir, wl } = schreibeFixture(2600, 26); // 26 Faelle > Mindestzahl, 1,0 % < 2 %
  const u = loadUniverse(snapDir, wl);
  assert.equal(u.length, 2574, 'die gesunden Staende muessen vollstaendig ankommen');
});

// --- T565-M2 (Review Tag 565): beide High-Water nebeneinander ---------------------
// Bisher fuehrte _last_good_disk.json EINEN Wert plus Populations-Namen. Jeder Wechsel der
// Population (Manifest-Feld faellt einmal aus -> on-disk-Fallback, danach wieder Eingang)
// verwarf das High-Water und kostete einen fail-open-Lauf OHNE Floor. Bei flatterndem
// Manifest ist der Floor damit nie scharf.
test('T565-M2: Flip eingang -> ondisk -> eingang kostet KEINEN fail-open-Lauf mehr', () => {
  // Lauf 1: Eingangs-Population ankert.
  let stand = naechstesHochwasser(null, FLOOR_BASIS_EINGANG, 12540);
  let datei = { value: stand[FLOOR_BASIS_EINGANG], basis: FLOOR_BASIS_EINGANG, hochwasser: stand };
  // Lauf 2: Manifest-Feld faellt aus -> on-disk. Eingangs-High-Water muss ERHALTEN bleiben.
  let r = floorReferenz({}, 10734, datei);
  assert.equal(r.basis, FLOOR_BASIS_ONDISK);
  stand = naechstesHochwasser(datei, r.basis, r.count);
  assert.equal(stand[FLOOR_BASIS_EINGANG], 12540, 'die andere Population darf nicht verloren gehen');
  datei = { value: stand[r.basis], basis: r.basis, hochwasser: stand };
  // Lauf 3: Manifest wieder da -> Eingang. JETZT muss die alte Baseline wieder greifen.
  r = floorReferenz({ n_eingang_snapshots: 12540 }, 10734, datei);
  assert.equal(r.baseline, 12540, 'BEFUND: hier war die Baseline bisher null -> Floor nicht erzwungen');
  assert.deepEqual(r.warnungen, [], 'und es gibt nichts mehr zu warnen');
  assert.throws(() => assertCoverageFloor(11000, r.baseline), /Coverage-Floor|geschrumpft/i,
    'Gegenprobe: der Floor ist in diesem Lauf wirklich scharf');
});

test('T565-M2: Alt-Datei (nur value+basis) bleibt lesbar und wird mitgetragen', () => {
  assert.equal(baselineFuer({ value: 10700 }, FLOOR_BASIS_ONDISK), 10700, 'fehlendes basis-Feld = on-disk');
  assert.equal(baselineFuer({ value: 10700 }, FLOOR_BASIS_EINGANG), null);
  const stand = naechstesHochwasser({ value: 10700 }, FLOOR_BASIS_EINGANG, 12540);
  assert.deepEqual(stand, { [FLOOR_BASIS_ONDISK]: 10700, [FLOOR_BASIS_EINGANG]: 12540 },
    'der Alt-Wert wandert in die neue Form statt verworfen zu werden');
});

test('T565-M2: der High-Water der gemessenen Population bleibt monoton', () => {
  const vor = { hochwasser: { [FLOOR_BASIS_EINGANG]: 12540, [FLOOR_BASIS_ONDISK]: 10700 } };
  assert.deepEqual(naechstesHochwasser(vor, FLOOR_BASIS_EINGANG, 12000),
    { [FLOOR_BASIS_EINGANG]: 12540, [FLOOR_BASIS_ONDISK]: 10700 }, 'Dip senkt nicht');
  assert.deepEqual(naechstesHochwasser(vor, FLOOR_BASIS_EINGANG, 13000),
    { [FLOOR_BASIS_EINGANG]: 13000, [FLOOR_BASIS_ONDISK]: 10700 }, 'Wachstum hebt nur die eigene');
});

// --- T569-F1 (Review Tag 569): beide Haelften der Lade-Wache waren blind -----------
// Repro repro-q3q4.js, zwei getrennte Befunde an derselben Leseschleife:
//  (a) 12.500 Dateien parsen sauber, KEINE traegt meta.ticker -> assertParseFailAnteil
//      schwieg (parseFail=0), run() hat keinen Leer-Universum-Schutz -> gruener Lauf auf
//      einem leeren Universum;
//  (b) assertCoverageFloor lief NUR gegen floor.count (die Manifest-Eingangszahl). Die real
//      geladene Menge (rawCount) hat der Floor nie gesehen: ein Manifest, das 12.500 meldet,
//      waehrend 300 Dateien auf der Platte liegen, kam ungebremst durch.
test('T569-F1a: Schema-Drift ohne einen einzigen Parse-Fehler bricht ab (Repro repro-q3q4.js)', () => {
  assert.throws(() => assertParseFailAnteil(0, 0, 12500), /unbrauchbar|nicht parsebar/i,
    'BEFUND: 12.500 parsebare Dateien, 0 mit meta.ticker — bis Tag 571 schwieg die Wache');
});
test('T569-F1a: die Mindest-Fallzahl gilt fuer die SUMME, nicht nur fuer parseFail', () => {
  assert.doesNotThrow(() => assertParseFailAnteil(0, 12, 12), '24 unbrauchbare bleiben unter der Grenze');
  assert.throws(() => assertParseFailAnteil(0, 12, 13), /unbrauchbar|nicht parsebar/i,
    'ab 25 unbrauchbaren Dateien zaehlt der Anteil — egal aus welchem der beiden Gruende');
});
test('T569-F1a: der gemessene gesunde Stand geht durch (04.08.: 0/4769 und 0/101 unbrauchbar)', () => {
  assert.doesNotThrow(() => assertParseFailAnteil(4769, 0, 0));
  assert.doesNotThrow(() => assertParseFailAnteil(101, 0, 0));
});

// Fixture-Bauer fuer die echte Leseschleife: Dateien, Manifest und High-Water-Stand frei
// setzbar — sonst laesst sich die Floor-Verdrahtung nur behaupten, nicht pruefen.
function schreibeFloorFixture({ dateien, ohneMeta = 0, manifestEingang = null, lastGood = null }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 't569f1-'));
  const snapDir = path.join(root, 'snapshots');
  fs.mkdirSync(snapDir, { recursive: true });
  const ticker = [];
  for (let i = 0; i < dateien; i++) {
    const t = 'T' + i;
    ticker.push(t);
    fs.writeFileSync(path.join(snapDir, t + '.json'), JSON.stringify(
      i < ohneMeta ? { metrics: {} } : { meta: { ticker: t }, metrics: {} }));
  }
  if (manifestEingang !== null) {
    fs.writeFileSync(path.join(snapDir, '_manifest.json'), JSON.stringify({ n_eingang_snapshots: manifestEingang }));
  }
  if (lastGood) fs.writeFileSync(path.join(snapDir, '_last_good_disk.json'), JSON.stringify(lastGood));
  const wl = path.join(root, 'watchlist.json');
  fs.writeFileSync(wl, JSON.stringify({ stocks: ticker.map((t) => ({ ticker: t })) }));
  return { snapDir, wl };
}

test('T569-F1a (Fixture): 100 parsebare Dateien ohne meta.ticker brechen loadUniverse ab', () => {
  const { snapDir, wl } = schreibeFloorFixture({ dateien: 100, ohneMeta: 100 });
  assert.throws(() => loadUniverse(snapDir, wl), /unbrauchbar|nicht parsebar/i,
    'BEFUND: bis Tag 571 lieferte genau das ein leeres Universum und einen gruenen Lauf');
});

test('T569-F1b (Fixture): Manifest meldet 1000, auf der Platte liegen 30 -> Abbruch', () => {
  const lastGood = { value: 1000, basis: FLOOR_BASIS_EINGANG, hochwasser: { eingang: 1000, ondisk: 1000 } };
  const { snapDir, wl } = schreibeFloorFixture({ dateien: 30, manifestEingang: 1000, lastGood });
  assert.throws(() => loadUniverse(snapDir, wl), /Coverage-Floor|geschrumpft/i,
    'BEFUND: der Floor verglich nur die Manifest-Zahl gegen sich selbst und blieb gruen');
});

test('T569-F1b (Fixture): legitimes Watchlist-Pruning (50 %/Tag) reisst den on-disk-Floor NICHT', () => {
  // prune-watchlist.js deckelt bei max(200, 50 % des Vorstands) — genau diese Kuerzung darf
  // den zweiten Floor nicht ausloesen, sonst ist F-12-R1 rueckgaengig gemacht.
  const lastGood = { value: 1000, basis: FLOOR_BASIS_EINGANG, hochwasser: { eingang: 1000, ondisk: 1000 } };
  const { snapDir, wl } = schreibeFloorFixture({ dateien: 500, manifestEingang: 1000, lastGood });
  assert.equal(loadUniverse(snapDir, wl).length, 500, 'die halbierte, aber gesunde Menge muss durchgehen');
  assert.ok(COVERAGE_FLOOR_RATIO_ONDISK < 0.5,
    'der on-disk-Floor muss UNTER dem prune-watchlist-Deckel liegen, sonst ist er dauerhaft falsch-rot');
});

test('T569-F1b: der on-disk-High-Water wird JEDEN Lauf fortgeschrieben (sonst bleibt der Floor blind)', () => {
  // Ohne diese Zeile waere der zweite Floor in Produktion wirkungslos: naechstesHochwasser()
  // hebt nur die GEMESSENE Population, und die ist mit vorhandenem Manifest immer "eingang".
  const { snapDir, wl } = schreibeFloorFixture({ dateien: 40, manifestEingang: 1000 });
  loadUniverse(snapDir, wl);
  const stand = JSON.parse(fs.readFileSync(path.join(snapDir, '_last_good_disk.json'), 'utf8'));
  assert.equal(stand.hochwasser[FLOOR_BASIS_EINGANG], 1000);
  assert.equal(stand.hochwasser[FLOOR_BASIS_ONDISK], 40,
    'BEFUND: ohne mitgefuehrten on-disk-High-Water hat der neue Floor nie eine Baseline');
  // und der Folgelauf ist damit wirklich scharf:
  const eingebrochen = schreibeFloorFixture({ dateien: 5, manifestEingang: 1000, lastGood: stand });
  assert.throws(() => loadUniverse(eingebrochen.snapDir, eingebrochen.wl), /Coverage-Floor|geschrumpft/i);
});

// --- T569-F4 (Review Tag 569): drei weitere Loader zaehlten, ohne zu konsumieren ----
// loadSmallcapUniverse zaehlte parseFail und LOGGTE ihn nur. Derselbe Korpus speist
// runSmallcapPass; ein kaputter Cache-Restore haette dort lautlos auf der Restmenge gerankt.
test('T569-F4: loadSmallcapUniverse bricht bei kaputtem Small-Cap-Korpus ab (bis Tag 571 nur geloggt)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 't569f4-'));
  const snapDir = path.join(root, 'snapshots-smallcap');
  fs.mkdirSync(snapDir, { recursive: true });
  const ticker = [];
  for (let i = 0; i < 100; i++) {
    const t = 'S' + i;
    ticker.push(t);
    fs.writeFileSync(path.join(snapDir, t + '.json'),
      i < 20 ? '{"meta":{"ticker":"' + t + '"' : JSON.stringify({ meta: { ticker: t }, metrics: {} }));
  }
  const wl = path.join(root, 'watchlist-smallcap.json');
  fs.writeFileSync(wl, JSON.stringify({ stocks: ticker.map((t) => ({ ticker: t })) }));
  assert.throws(() => loadSmallcapUniverse(snapDir, wl), /unbrauchbar|nicht parsebar/i,
    'BEFUND: 20 % kaputte Small-Cap-Snapshots liefen bis Tag 571 mit einer Log-Zeile durch');
});

test('T569-F4: der gesunde Small-Cap-Korpus geht durch (sonst waere die Wache falsch-rot)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 't569f4ok-'));
  const snapDir = path.join(root, 'snapshots-smallcap');
  fs.mkdirSync(snapDir, { recursive: true });
  const ticker = [];
  for (let i = 0; i < 100; i++) {
    const t = 'S' + i;
    ticker.push(t);
    fs.writeFileSync(path.join(snapDir, t + '.json'), JSON.stringify({ meta: { ticker: t }, metrics: {} }));
  }
  const wl = path.join(root, 'watchlist-smallcap.json');
  fs.writeFileSync(wl, JSON.stringify({ stocks: ticker.map((t) => ({ ticker: t })) }));
  assert.equal(loadSmallcapUniverse(snapDir, wl).length, 100);
  // Kaltstart-Schutz: die kleine Population darf nicht an Einzelfaellen sterben.
  fs.writeFileSync(path.join(snapDir, 'S7.json'), '{"meta":');
  assert.equal(loadSmallcapUniverse(snapDir, wl).length, 99, 'ein Einzelfall ist kein Befund');
});

// Die beiden anderen Loader desselben Befunds. Sie standen bis Tag 571 auf einem BLANKEN
// `catch (_) { continue; }` — nicht einmal ein Zaehler. Ihr Ergebnis wird COMMITTET
// (external-data/sec-secannual*.json) und speist Zyklus-Daempfer und roicStability; eine
// halb gelesene Platte haette dort dauerhaft eine geschrumpfte Serie eingefroren.
const { loadUniverse: secLoadUniverse } = require('../../scripts/build-secannual.js');
const { loadSmallcapUniverse: secLoadSmallcap } = require('../../scripts/build-secannual-smallcap.js');

function schreibeSecFixture(praefix, gesamt, kaputt, ohneMeta = 0) {
  const snapDir = fs.mkdtempSync(path.join(os.tmpdir(), praefix));
  for (let i = 0; i < gesamt; i++) {
    const t = 'X' + i;
    let inhalt;
    if (i < kaputt) inhalt = '{"meta":{"ticker":"' + t + '"';
    else if (i < kaputt + ohneMeta) inhalt = JSON.stringify({ metrics: {} });
    else inhalt = JSON.stringify({ meta: { ticker: t }, metrics: {} });
    fs.writeFileSync(path.join(snapDir, t + '.json'), inhalt);
  }
  return snapDir;
}

test('T569-F4: build-secannual.js loadUniverse bricht bei kaputtem Korpus ab (blanker catch)', () => {
  assert.throws(() => secLoadUniverse(schreibeSecFixture('t569f4-sec-', 1000, 300)),
    /unbrauchbar|nicht parsebar/i,
    'BEFUND: 30 % unlesbare Snapshots waeren still in eine committete SEC-Datei gewandert');
  assert.equal(secLoadUniverse(schreibeSecFixture('t569f4-secok-', 1000, 0)).length, 1000,
    'der gesunde Korpus muss durchgehen');
  assert.equal(secLoadUniverse(schreibeSecFixture('t569f4-secmini-', 300, 5)).length, 295,
    'Einzelfaelle unter der Mindest-Fallzahl bleiben ein Nicht-Befund');
});

test('T569-F4: build-secannual-smallcap.js loadSmallcapUniverse bricht bei kaputtem Korpus ab', () => {
  assert.throws(() => secLoadSmallcap(schreibeSecFixture('t569f4-sc-', 100, 20)),
    /unbrauchbar|nicht parsebar/i,
    'BEFUND: derselbe blanke catch, kleinere Population — 20 % kaputt liefen gruen durch');
  assert.equal(secLoadSmallcap(schreibeSecFixture('t569f4-scok-', 100, 0)).length, 100);
  assert.equal(secLoadSmallcap(schreibeSecFixture('t569f4-scmini-', 100, 5)).length, 95,
    'die kleine Population darf nicht an Einzelfaellen sterben');
  assert.deepEqual(secLoadSmallcap(path.join(os.tmpdir(), 'gibt-es-nicht-t569')), [],
    'fehlendes Verzeichnis bleibt das Fallback-Signal, kein Wurf');
});

console.log(`bh-b07-runscreener.test.js: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);

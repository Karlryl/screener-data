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
// R2.R (Rumpf-Skip-Ehrlichkeit): ein Test, der ERST IM RUMPF merkt, dass seine Voraussetzung fehlt
// (kein Universum, Anker-Ticker nicht im Universum), darf NICHT als pass gezaehlt werden — er hat
// nichts geprueft. Frueher stieg so ein Rumpf per `return`/`continue` aus und test() zaehlte pass++
// -> "18 ok" mit 8 hohlen Tests. skipBody() wirft ein Sentinel, das test() als skip verbucht:
// EINE Stelle statt acht stiller Aussteiger, Ausgabe im selben Format wie testU.
const SKIP = Symbol('skip-body');
function skipBody(grund) { const e = new Error(grund); e[SKIP] = true; throw e; }
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) {
    if (e && e[SKIP]) { skip++; console.log('  skip ' + name + ' (' + e.message + ')'); return; }
    fail++; console.error('FAIL   ' + name + '\n       ' + e.message);
  }
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
  test(name, () => { if (!HAS_UNIVERSE) skipBody('kein Universum — pre-pull-Gate'); fn(); });
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
// Tag 437 (Karl-Entscheid 26.07., Court-Urteil): Der frueher hier blockierende Anker
// "CRDO im oberen 20 % seines Track-Kohorten-Rankings" ist ABGESCHAFFT. Gruende:
//   (1) Er prueft einen NAMEN, nicht eine Eigenschaft — und ist damit durch Kalibrieren
//       auf genau diesen Namen erfuellbar (Zirkelschluss).
//   (2) Er war seit seiner Scharfschaltung am 19.07. nie gruen und hat 5 Tageslaeufe
//       blockiert; seine Baseline war beim Einbau bereits verletzt (21,7 % ab 14.07.).
//   (3) Karl selbst (26.07.): "Wenn der Screener viele Firmen findet, die einfach besser
//       sind als CRDO und Astera Labs, dann nehme ich das einfach so hin." Die Platzierung
//       ist nicht das Ziel — die Frage ist, ob ARTGLEICHE Firmen verglichen werden.
// Ersetzt durch tests/scoring/acceleration-invariance.test.js, der eine EIGENSCHAFT des
// Messgeraets prueft (konstantes Wachstum muss null Beschleunigung ergeben) und ohne
// einen einzigen Ticker auskommt. Der laeuft ebenfalls im Live-Universum-Gate.
// CRDOs Rang wird weiter GEMESSEN und protokolliert — nur nicht mehr erzwungen; ein
// Abrutschen meldet das taegliche Briefing.
testU('CRDO: Rang im Track-Kohorten-Ranking wird protokolliert (kein Gate)', () => {
  const c = byTicker['CRDO'];
  const cohort = rankBy(results, 'semiconductors', c.track);
  assert.ok(cohort.length >= 5, 'Kohorte zu klein: ' + cohort.length);
  const rank = rankIn(cohort, 'CRDO');
  const pct = (rank / cohort.length) * 100;
  console.log(`       CRDO Rang ${rank + 1}/${cohort.length} (profitable), Score ${c.score.toFixed(1)}, Perzentil ${pct.toFixed(1)} %`);
  // Nur noch eine STRUKTUR-Aussage: CRDO ist ueberhaupt in seiner Kohorte auffindbar.
  // Kein Perzentil-Ziel — das waere wieder der Ticker-Anker.
  assert.ok(rank >= 0, 'CRDO nicht in der eigenen Kohorte auffindbar');
});

// --- ALAB (falls vorhanden) ebenfalls oben ----------------------------------
test('ALAB (falls vorhanden) im oberen 25% seines Tracks', () => {
  const a = byTicker['ALAB'];
  if (!a || a.action !== 'route') skipBody('ALAB nicht im Universum/nicht geroutet');
  const cohort = rankBy(results, 'semiconductors', a.track);
  const rank = rankIn(cohort, 'ALAB');
  console.log(`       ALAB Rang ${rank + 1}/${cohort.length} (${a.track}), Score ${a.score.toFixed(1)}`);
  assert.ok((rank / cohort.length) <= 0.25, `ALAB Rang ${rank + 1}/${cohort.length}`);
});

// --- Decliner (NVTS/AEHR falls vorhanden) im unteren Bereich ----------------
test('Decliner NVTS/AEHR (falls vorhanden) in unterer Haelfte ihres Tracks', () => {
  // erst filtern, dann pruefen: ist KEINER scorebar, hat der Test nichts geprueft -> skip statt pass.
  const have = ['NVTS', 'AEHR'].filter((t) => {
    const d = byTicker[t];
    return d && d.action === 'route' && d.score !== null;
  });
  if (!have.length) skipBody('weder NVTS noch AEHR scorebar');
  for (const t of have) {
    const d = byTicker[t];
    const cohort = rankBy(results, 'semiconductors', d.track);
    const rank = rankIn(cohort, t);
    console.log(`       ${t} Rang ${rank + 1}/${cohort.length} (${d.track}), Score ${d.score.toFixed(1)}`);
    assert.ok((rank / cohort.length) >= 0.5, `${t} sollte unten ranken: ${rank + 1}/${cohort.length}`);
  }
});

// --- weitere Anker in anderen Branchen --------------------------------------
function assertAnchorTop(ticker, formulaId, maxPct) {
  const a = byTicker[ticker];
  if (!a || a.action !== 'route' || a.score === null) skipBody(`${ticker} nicht scorebar`);
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
  if (!w || w.action !== 'route') skipBody('WOLF nicht scorebar');
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
  if (!reits.length) skipBody('keine REITs im Universum');
  assert.ok(reits.every((e) => e.overview && e.overview.kind === 'ffo-badge'), 'REIT Overview != ffo-badge');
});

// --- Court-Auflage 27.07.2026: KEINE Firma steht zweimal im selben Board ------
// Das Gericht verlangte eine Pruefung, die dort meldet, wo hingeschaut wird, und die bei
// leerer Liste STUMM bleibt ("eine taegliche Zeile ohne Befund erzieht zur Blindheit").
// Genau das ist ein Test: er sagt nichts, solange alles sauber ist, und wird laut, sobald
// eine neue Doppelung auftaucht. Er laeuft im Live-Universum-Gate gegen echte Snapshots.
//
// Warum das der wichtigere Waechter ist: eine Doppelung ist der SICHTBARE Fehler (dieselbe
// Firma zweimal, meist auf benachbarten Raengen — am 27.07. real neun Stueck). Der Gegenfehler,
// eine faelschlich verschmolzene Firma, ist unsichtbar: sie fehlt einfach.
//
// ⚠ KORREKTUR (Kreuz-Review 27.07., Befund P2): hier stand "Deshalb prueft dieser Test BEIDE
// Richtungen — Doppelung UND Verschwinden". Das war FALSCH, und es ist die gefaehrlichere
// Sorte Fehler: eine Zusicherung behauptet, die der Code nicht einloest. Wenn die
// Normalisierung zwei VERSCHIEDENE Firmen zusammenwirft, ist der Verlierer bereits als
// 'dup-issuer' entfernt, bevor diese Zaehlung beginnt — die Gruppe hat dann genau einen
// Ticker und faellt nicht auf. Dieser Test prueft AUSSCHLIESSLICH die Doppelungs-Richtung;
// die Gegenrichtung deckt der eigene Test darunter ab.
//
// Zweite Korrektur derselben Meldung: geprueft wird jetzt die VOLLE ueberlebende Population
// (full + survival) statt der auf topN gekappten Branch-Listen. Eine Doppelung unterhalb von
// Rang 50 verfaelscht Kohorten, Perzentile und Board-Historie genauso — sie war nur unsichtbar.
testU('kein Emittent steht zweimal im selben Board', () => {
  const { produceRankings } = require('../../src/scoring/score.js');
  const r = produceRankings(results, { topN: 50 });
  // \u26a0 ZWEITE KORREKTUR (CI-Lauf 30226188564): hier stand eine Normalisierung, die bewusst
  // STRENGER war als der Dedup \u2014 sie entfernte zusaetzlich Artikel, Rechtsformen wie ag/sa/nv/plc
  // sowie "holdings" und "group". Solange nur die obersten 50 Zeilen geprueft wurden, fiel das
  // nicht auf. Ueber die volle Population erzeugt sie FALSCHE ALARME, weil genau diese Woerter
  // Firmen UNTERSCHEIDEN. Am echten CI-Universum belegt:
  //     Graham Corporation      vs. Graham HOLDINGS Company   \u2014 zwei Firmen
  //     Metro Inc. (Kanada)     vs. Metro AG (Deutschland)    \u2014 zwei Firmen
  //     Heineken N.V.           vs. Heineken HOLDING N.V.     \u2014 zwei Gesellschaften
  //     Interparfums, Inc. (US) vs. Interparfums SA (FR)      \u2014 zwei Firmen
  // Der Lauf wurde dadurch rot, ohne dass ein Defekt vorlag \u2014 teurer als ein uebersehener Fall.
  //
  // Es gibt KEINE sichere "etwas strengere" Normalisierung: jedes weitere Wort, das man
  // entfernt, unterscheidet irgendwo zwei Gesellschaften. Deshalb prueft der Test jetzt die
  // Zusicherung selbst \u2014 kein Emittentenschluessel der PRODUKTION darf zweimal in einem Board
  // stehen. Das ist nicht zirkulaer: der Dedup gruppiert nur die zum Zeitpunkt seines Laufs
  // gerouteten Eintraege, waehrend die Boards spaeter zusammengesetzt werden. Ein Bein, das
  // danach wieder auftaucht, faellt hier auf.
  const { issuerKeyLoose } = require('../../src/scoring/score.js');
  const norm = (e) => issuerKeyLoose(e && e.snapshot ? e.snapshot : { meta: { name: e && e.name } });
  const proBoard = new Map();
  const zaehle = (board, e) => {
    const n = norm(e);
    if (!n) return;
    const k = board + '|' + n;
    if (!proBoard.has(k)) proBoard.set(k, new Set());
    proBoard.get(k).add(e.ticker);
  };
  // r.full ist ZWEISTUFIG: { board: { track: [...] } } — nicht flach. Nachgelesen, nicht geraten.
  for (const [board, tracks] of Object.entries(r.full || {})) {
    for (const liste of Object.values(tracks || {})) for (const e of (liste || [])) zaehle(board, e);
  }
  for (const e of (r.survival || [])) zaehle('SURVIVAL', e);
  assert.ok(proBoard.size > 0, 'Kein Board-Eintrag geprueft — der Waechter darf nicht ins Leere laufen');
  const doppel = [...proBoard.entries()].filter(([, tickers]) => tickers.size > 1);
  assert.equal(
    doppel.length, 0,
    'Doppelnennungen im selben Board: ' + doppel.map(([k, v]) => k.split('|')[1] + ' (' + [...v].join('+') + ')').join(', '),
  );
});

// ⚠ HIER STAND EIN TEST, DER AM ECHTEN UNIVERSUM WIDERLEGT WURDE (CI-Lauf 30226188564).
//
// Die Idee war richtig: die Gegenrichtung (faelschlich VERSCHMOLZENE Firmen) braucht ein
// Merkmal, das nichts mit dem Namen zu tun hat — sonst prueft die Gegenprobe dieselbe Regel
// wie der Fix. Gewaehlt war die BRANCHE, mit der Annahme: zwei Beine desselben Emittenten
// tragen sie identisch. Am lokalen Bestand (339 Dedup-Gruppen) hielt das ausnahmslos.
//
// Am CI-Universum (12.451 Snapshots) haelt es NICHT. Vier Gegenbeispiele, alle mit
// IDENTISCHEM Firmennamen und verschiedener Branche:
//     Tianqi Lithium Corporation      Specialty Chemicals  vs. Other Industrial Metals & Mining
//     Anglo American plc              AIRLINES             vs. Other Industrial Metals & Mining
//     Teck Resources Limited          Other Ind. Metals    vs. Copper
//     Corporacion Inmobiliaria Vesta  RE - Diversified     vs. RE - Development
//
// Das Branchenfeld ist bei Yahoo also NICHT stabil je Emittent. Ein Test auf einer
// widerlegten Praemisse ist schlechter als keiner: er blockiert Karls Tageslauf mit
// Falschmeldungen und erzieht dazu, rote Laeufe wegzudruecken. Er ist deshalb ENTFERNT und
// nicht abgeschwaecht — eine aufgeweichte Fassung haette dieselbe kaputte Annahme behalten.
//
// LEHRE, die teurer war als der Test: eine an 339 lokalen Faellen bestaetigte Regel ist
// keine Regel, wenn die Produktionsdaten dreimal so gross sind. Genau das steht als Falle
// Nr. 1 im Nachtmandat (ein lokaler Lauf ist KEIN Beleg fuer CI-Verhalten) — und ist hier
// trotzdem passiert, in derselben Nacht, in der die Regel notiert wurde.
//
// OFFEN und Karl gemeldet: dass dieselbe Firma je nach Notierung eine andere Branche traegt,
// betrifft nicht nur diesen Test — die Routing-Entscheidung haengt an Sektor und Branche.
// Welches Bein den Dedup gewinnt, entscheidet damit mit, in welche Branchenformel die Firma
// faellt.

// --- produceRankings: dashboard-JSON-Form -----------------------------------
testU('produceRankings: korrekte JSON-Form, sortiert, PLTR top software', () => {
  const { produceRankings } = require('../../src/scoring/score.js');
  const r = produceRankings(results, { topN: 20 });
  assert.ok(r.branches['semiconductors'].profitable.length <= 20);
  const semis = r.branches['semiconductors'].profitable;
  assert.ok(semis[0].score >= semis[1].score, 'nicht absteigend sortiert');
  assert.ok(typeof semis[0].score === 'number' && semis[0].ticker, 'Row-Form');
  assert.ok(r.overview.length > 0 && r.survival.length > 0);
  // P1-Chunk 4 / F-CGPT-112 (Tag 623): dieses `|| true` macht die Zeile TAUTOLOGISCH — sie kann nie
  // failen und prueft nichts. Sie bleibt hier nur stehen, weil das Scharfschalten (Klammer aufloesen)
  // eine Verschaerfung waere und in die spaetere scharfe Stufe gehoert, nicht in die Sichtbarkeitsstufe.
  // Der Sachgehalt ist ohnehin durch die naechste Zeile (typeof r.excluded === 'object') abgedeckt.
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
test('Issuer-Dedup Zeichensetzung: "Holding N.V." und "Holding NV" sind derselbe Emittent', () => {
  // Belegt am CI-Lauf 30213797442: Zweitnotierungen schreiben ihren Namen anders
  // ("ASML Holding N.V." vs "ASML Holding NV", "Autodesk, Inc." vs "AUTODESK INC.").
  // Der Dedup verglich nur klein geschrieben und lief daran vorbei -> dieselbe Firma
  // stand zweimal im selben Board, meist auf benachbarten Raengen.
  const mk = (ticker, name, ex, ccy, region) => ({
    meta: { name, sector: 'Technology', industry: 'Software', exchangeName: ex, ticker, tradingCurrency: ccy, region },
    annual: { annualRev: [{ value: 300 }, { value: 200 }, { value: 130 }], annualGP: [{ value: 180 }] },
    metrics: { revenueTTM: { value: 300 } },
    marketCap: { value: 5e9 } });
  const res = scoreUniverse([
    mk('PUNKT', 'Punktuation Holding N.V.', 'NasdaqGS', 'USD', 'US'),
    mk('PUNKT.SW', 'Punktuation Holding NV', 'Swiss', 'CHF', undefined),
  ], formulas);
  const bt = Object.fromEntries(res.map((r) => [r.ticker, r]));
  assert.equal(bt['PUNKT.SW'].reason, 'dup-issuer', 'Zweitnotierung muss trotz abweichender Zeichensetzung dedupt werden');
  assert.notEqual(bt['PUNKT'].reason, 'dup-issuer', 'US-Primaerbein bleibt der Gewinner');
});
test('Issuer-Dedup: Mehrklassen-Aktien werden NICHT auseinandergerissen (Court-Auflage 27.07.)', () => {
  // Der Fehlverschmelzungs-Schutz stand urspruenglich auf der Universalie "ein Emittent hat
  // genau EIN US-Primaerlisting". Die ist FALSCH: Alphabet (GOOG/GOOGL), Fox (FOX/FOXA),
  // HEICO (HEI/HEI-A) haben je ein Primaerlisting PRO ANTEILSKLASSE — zwei US-primaere Beine
  // unter identischem Firmennamen. Der Schutz haelt trotzdem, weil identische Namen denselben
  // strengen Schluessel ergeben; genau das wird hier festgenagelt. Faellt es, steht eine Firma
  // DOPPELT im Board — der unsichtbarere und damit teurere Fehler.
  const mk = (ticker, ex) => ({
    meta: { name: 'Mehrklassen Beispiel Inc.', sector: 'Technology', industry: 'Software', exchangeName: ex, ticker, tradingCurrency: 'USD', region: 'US' },
    annual: { annualRev: [{ value: 300 }, { value: 200 }, { value: 130 }], annualGP: [{ value: 180 }] },
    metrics: { revenueTTM: { value: 300 } },
    marketCap: { value: 5e9 } });
  const res = scoreUniverse([mk('MKLA', 'NasdaqGS'), mk('MKLB', 'NasdaqGS')], formulas);
  const bt = Object.fromEntries(res.map((r) => [r.ticker, r]));
  const dedupt = ['MKLA', 'MKLB'].filter((t) => bt[t].reason === 'dup-issuer').length;
  assert.equal(dedupt, 1, 'genau EINE Anteilsklasse darf uebrig bleiben, nicht beide');
});
// ⚠ DIESER TEST FEHLTE, UND SEIN FEHLEN HAT IN DERSELBEN NACHT ZUGESCHLAGEN.
//
// Die vier Rechtsform-Regeln (incorporated->inc, corporation->corp, limited->ltd,
// company->co) waren am CI-Universum gemessen (25 von 25 korrekt) und trotzdem KOMPLETT
// ungetestet: der Test darunter heisst zwar 'Artikel/Rechtsform', baut im Rumpf aber nur
// ein Artikel-Paar. In Tag 453 ging die Regelliste versehentlich als LEERES Array raus —
// kein einziger Test wurde rot, aufgefallen ist es nur beim Lesen von git status.
// Ein Wert, der gemessen wurde, aber nicht festgenagelt ist, verschwindet irgendwann.
//
// Geprueft wird jede der vier Regeln EINZELN, damit man am roten Test sofort sieht, welche
// fehlt — eine Sammelpruefung haette nur 'irgendwas kaputt' gemeldet.
test('Issuer-Dedup Rechtsform-Regel: jede der vier Langform/Kurzform-Paarungen greift', () => {
  const mk = (ticker, name, ex, ccy, region) => ({
    meta: { name, sector: 'Technology', industry: 'Software', exchangeName: ex, ticker, tradingCurrency: ccy, region },
    annual: { annualRev: [{ value: 300 }, { value: 200 }, { value: 130 }], annualGP: [{ value: 180 }] },
    metrics: { revenueTTM: { value: 300 } },
    marketCap: { value: 5e9 } });
  const paare = [
    ['incorporated/inc', 'Beispiel Incorporated', 'Beispiel Inc'],
    ['corporation/corp', 'Beispiel Corporation', 'Beispiel Corp'],
    ['limited/ltd',      'Beispiel Limited',      'Beispiel Ltd'],
    ['company/co',       'Beispiel Company',      'Beispiel Co'],
  ];
  for (const [regel, lang, kurz] of paare) {
    const res = scoreUniverse([
      mk('AAA', lang, 'NasdaqGS', 'USD', 'US'),
      mk('1AAA.MI', kurz, 'Milan', 'EUR', undefined),
    ], formulas);
    const bt = Object.fromEntries(res.map((r) => [r.ticker, r]));
    assert.equal(bt['1AAA.MI'].reason, 'dup-issuer', `Regel ${regel}: die Zweitnotierung muss dedupt werden ("${lang}" vs "${kurz}")`);
    assert.notEqual(bt['AAA'].reason, 'dup-issuer', `Regel ${regel}: das US-Primaerbein bleibt der Gewinner`);
  }
});

// Gegenstueck: die Regel darf NICHT so weit gehen, dass sie verschiedene Firmen verschmilzt.
// Am CI-Universum belegte Faelle (27.07.): 'Graham Corporation' vs 'Graham Holdings Company'
// und 'Heineken N.V.' vs 'Heineken Holding N.V.' sind je ZWEI Gesellschaften. Ohne diesen
// Test waere eine spaetere Erweiterung um 'holdings' oder 'group' unbemerkt durchgegangen.
test('Issuer-Dedup Rechtsform-Regel verschmilzt NICHT ueber Holding-Grenzen hinweg', () => {
  const mk = (ticker, name, ex, ccy, region) => ({
    meta: { name, sector: 'Technology', industry: 'Software', exchangeName: ex, ticker, tradingCurrency: ccy, region },
    annual: { annualRev: [{ value: 300 }, { value: 200 }, { value: 130 }], annualGP: [{ value: 180 }] },
    metrics: { revenueTTM: { value: 300 } },
    marketCap: { value: 5e9 } });
  for (const [a, b] of [['Graham Corporation', 'Graham Holdings Company'], ['Heineken N.V.', 'Heineken Holding N.V.']]) {
    const res = scoreUniverse([
      mk('XA', a, 'NasdaqGS', 'USD', 'US'),
      mk('XB.AS', b, 'Amsterdam', 'EUR', undefined),
    ], formulas);
    const bt = Object.fromEntries(res.map((r) => [r.ticker, r]));
    const weg = ['XA', 'XB.AS'].filter((x) => bt[x].reason === 'dup-issuer');
    assert.equal(weg.length, 0, `"${a}" und "${b}" sind ZWEI Firmen und duerfen nicht verschmolzen werden (entfernt: ${weg.join(',')})`);
  }
});

test('Issuer-Dedup Gleichsetzungs-Liste: Namen mit Artikel/Rechtsform-Unterschied werden dedupt', () => {
  // Die drei Faelle, die die Zeichensetzungs-Regel NICHT loest, weil sich die Namen um
  // mehr unterscheiden: "The Carlyle Group Inc." gegen "Carlyle Group Inc" (Artikel),
  // "Talen Energy Corporation" gegen "Talen Energy Corp" (Rechtsform-Kurzform).
  // Bewusst eine gepflegte Liste statt einer weiteren Regel.
  const mk = (ticker, name, ex, ccy, region) => ({
    meta: { name, sector: 'Technology', industry: 'Software', exchangeName: ex, ticker, tradingCurrency: ccy, region },
    annual: { annualRev: [{ value: 300 }, { value: 200 }, { value: 130 }], annualGP: [{ value: 180 }] },
    metrics: { revenueTTM: { value: 300 } },
    marketCap: { value: 5e9 } });
  const res = scoreUniverse([
    mk('CG', 'The Carlyle Group Inc.', 'NasdaqGS', 'USD', 'US'),
    mk('1CG.MI', 'Carlyle Group Inc', 'Milan', 'EUR', undefined),
  ], formulas);
  const bt = Object.fromEntries(res.map((r) => [r.ticker, r]));
  assert.equal(bt['1CG.MI'].reason, 'dup-issuer', 'Mailaender Zweitnotierung muss dedupt werden');
  assert.notEqual(bt['CG'].reason, 'dup-issuer', 'US-Primaerbein bleibt der Gewinner');
});
test('Issuer-Dedup Fehlverschmelzungs-Schutz: zwei US-Primaerlistings sind NIE derselbe Emittent', () => {
  // Realfall aus dem CI-Universum: "First Bancorp" (FBNC, NasdaqGS, North Carolina) und
  // "First BanCorp." (FBP, NYSE, Puerto Rico) sind zwei verschiedene Banken, die sich nach
  // dem Wegwerfen der Zeichensetzung nicht mehr unterscheiden. Ein Emittent hat aber genau
  // EIN US-Primaerlisting -> zwei davon in einer Gruppe heisst: zwei Firmen, nicht dedupen.
  // Ohne diesen Schutz wuerde eine echte Firma still aus den Boards verschwinden.
  const mk = (ticker, name, ex) => ({
    meta: { name, sector: 'Technology', industry: 'Software', exchangeName: ex, ticker, tradingCurrency: 'USD', region: 'US' },
    annual: { annualRev: [{ value: 300 }, { value: 200 }, { value: 130 }], annualGP: [{ value: 180 }] },
    metrics: { revenueTTM: { value: 300 } },
    marketCap: { value: 5e9 } });
  const res = scoreUniverse([
    mk('ERSTA', 'Erste Beispiel Bancorp', 'NasdaqGS'),
    mk('ERSTB', 'Erste Beispiel BanCorp.', 'NYSE'),
  ], formulas);
  const bt = Object.fromEntries(res.map((r) => [r.ticker, r]));
  assert.notEqual(bt['ERSTA'].reason, 'dup-issuer', 'ERSTA darf nicht als Doppelung verschwinden');
  assert.notEqual(bt['ERSTB'].reason, 'dup-issuer', 'ERSTB darf nicht als Doppelung verschwinden');
});
// audit/fix (Tag 584): Realfall aus dem CI-Universum vom 04.08.2026 (Lauf 30938140990) — VSCO
// ("Victoria's Secret & Co", delistet 04.08.) und VSXY ("Victorias Secret & Co.", die Nachfolge-
// Notierung) sind DERSELBE Emittent, beide NYSE/US-primaer. Der lockere Schluessel gruppierte sie
// zwar zusammen ("victoriassecretco"), aber weil beide US-primaer sind, fiel der Fehlverschmelzungs-
// Schutz auf den strengen Schluessel zurueck — der bis Tag 584 GAR KEINE Zeichensetzung
// normalisierte und die beiden am Apostroph/Punkt auseinanderhielt. Namens-Strings woertlich aus
// dem Snapshot-Artefakt des Laufs (KEIN Erfindungs-Risiko).
test('Issuer-Dedup Apostroph/Punkt (Tag 584, VSXY/VSCO-Fall): gleicher Emittent trotz Zeichensetzungs-Differenz', () => {
  const mk = (ticker, name, delisted) => ({
    meta: { name, sector: 'Consumer Cyclical', industry: 'Apparel Retail', exchangeName: 'NYSE', ticker, tradingCurrency: 'USD', region: 'US', delisted: !!delisted },
    annual: { annualRev: [{ value: 6553 }, { value: 6230 }, { value: 6182 }], annualGP: [{ value: 2384 }] },
    metrics: { revenueTTM: { value: 6553 } },
    marketCap: { value: 7.1e9 } });
  const res = scoreUniverse([
    mk('VSCO', "Victoria's Secret & Co", true),
    mk('VSXY', 'Victorias Secret & Co.', false),
  ], formulas);
  const bt = Object.fromEntries(res.map((r) => [r.ticker, r]));
  const dedupt = ['VSCO', 'VSXY'].filter((t) => bt[t].reason === 'dup-issuer').length;
  assert.equal(dedupt, 1, 'VSCO und VSXY sind derselbe Emittent — genau EIN Bein darf uebrig bleiben, nicht beide');
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
  const pairs = [['SHOP', 'SHOP.TO'], ['ASML', 'ASML.AS'], ['TSM', '2330.TW']]
    .filter(([us, home]) => byTicker[us] && byTicker[home]);
  if (!pairs.length) skipBody('kein SHOP/ASML/TSM-Doppellisting im Universum');
  for (const [us, home] of pairs) {
    const u = byTicker[us], h = byTicker[home];
    assert.equal(u.action, 'route', `${us} sollte routen`);
    assert.equal(h.action, 'exclude', `${home} sollte dedupt sein`);
    assert.equal(h.reason, 'dup-issuer', `${home} reason=${h.reason}`);
  }
});

// --- A3-Stufe-2: Non-Operating-Revenue-Exclude (Investment-Trusts/CEFs) ------
test('non-operating-rev: CEF/Trust + Investment-Holding/BDC (falls vorhanden) excludiert', () => {
  // CEFs/Trusts (negativer Jahresumsatz) + NAV-Holdings (III.L/3i, INDU-A.ST/Industrivaerden:
  // Asset-Mgmt mit GP=0/ni~rev bzw. negativem Quartalsumsatz). Alle gehoeren nicht in den Topf.
  const have = ['SMT.L', 'ADX', 'AOD', 'III.L', 'INDU-A.ST'].filter((t) => byTicker[t]);
  if (!have.length) skipBody('kein CEF/Trust/NAV-Holding-Anker im Universum');
  for (const t of have) {
    const e = byTicker[t];
    // Die tragende Eigenschaft: ein NAV-Vehikel routet NIE in ein Board. Sie gilt
    // immer und wird immer geprueft.
    assert.equal(e.action, 'exclude', `${t} sollte excludiert sein`);
    // Die BEGRUENDUNG haengt an Fremddaten: isNonOperatingVehicle erkennt NAV-Holdings
    // ueber meta.industry ('asset management'). Faellt Yahoos assetProfile fuer einen
    // Titel weg, ist nicht nur die Industrie leer, sondern auch der Sektor — dann
    // greift route() eine Stufe spaeter mit 'no-sector'. Belegt am CI-Lauf 30213797442
    // (26.07.2026): III.L und SMT.L kamen frisch mit sector=null/industry=null und
    // _quality.grade='D' zurueck, waehrend die am 08.07. gecachten Anker ADX/AOD/
    // INDU-A.ST ihre Metadaten behielten. Kein Regress: ueber das ganze Artefakt
    // gemessen fehlte der Sektor bei 0,3 % der frisch geholten Snapshots gegen 0,6 %
    // der aelteren.
    //
    // Deshalb wird die Begruendung DATENABHAENGIG erwartet statt hartkodiert — aber
    // weiterhin geprueft: ein stiller Wechsel auf einen anderen Ausschlussgrund
    // (z. B. 'non-us') faellt weiter auf.
    // ⚠ KORREKTUR (unabhaengige Pruefung 27.07.): hier stand `e.snapshot.meta.industry`.
    // scoreUniverse loescht die Snapshot-Referenz aber auf JEDEM Ergebnis-Eintrag
    // (`delete e.snapshot`) — auch bei action='exclude'. `hatIndustrie` war damit IMMER
    // false, der strenge Zweig unerreichbar, und der Test hat faktisch nur den lockeren
    // geprueft. Der Kommentar darueber versprach ausdruecklich das Gegenteil. Genau die
    // Sorte Zusicherung, die eine Pruefung vortaeuscht, die es nicht gibt.
    // Die Industrie kommt jetzt aus dem UNIVERSUM (dort liegen die Snapshots unveraendert),
    // damit der datenabhaengige Zweig wirklich greift.
    const snapVonTicker = universe.find((s) => s && s.meta && s.meta.ticker === t);
    const industrie = snapVonTicker && snapVonTicker.meta ? snapVonTicker.meta.industry : undefined;
    const hatIndustrie = !!industrie;
    const erwartet = hatIndustrie ? ['non-operating-rev'] : ['non-operating-rev', 'no-sector'];
    assert.ok(
      erwartet.includes(e.reason),
      `${t} reason=${e.reason}, erwartet ${erwartet.join(' oder ')} `
      + `(meta.industry=${JSON.stringify(industrie)})`,
    );
  }
});
test('echter Fee-Asset-Manager BLK/BX (falls vorhanden) bleibt in financials (kein Over-Exclude)', () => {
  const have = ['BLK', 'BX', 'KKR'].filter((t) => byTicker[t]);
  if (!have.length) skipBody('kein BLK/BX/KKR im Universum');
  for (const t of have) {
    const e = byTicker[t];
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
// audit/fix (Hard-Review R1-SC-002, BH-081-Analog): signTrack()->firstPresent() ueberspringt eine
// FUEHRENDE opInc-Luecke (Index 0/1 fehlend) und liefert ein 2 Jahre altes Verlustjahr als "juengstes"
// -- 2038.HK-Muster: annualOpInc=[null,null,-73.4M,-31.8M], annualNetIncome[0]=+52.7M (profitabel).
test('trackOf (R1-SC-002): FUEHRENDE opInc-Luecke faellt auf NetIncome zurueck (2038.HK-Muster)', () => {
  const { trackOf } = require('../../src/scoring/score.js');
  const V = (arr) => arr.map((v) => (v === null ? null : { value: v }));
  const f = { splitMetric: 'OpInc' };
  const leadingGap = { annual: { annualOpInc: V([null, null, -73413000, -31770000]),
    annualNetIncome: V([52727000, -20331000]) } };
  assert.equal(trackOf(leadingGap, f), 'profitable',
    'aktuelles Jahr ist per NetIncome profitabel -- ein 2 Jahre altes opInc-Verlustjahr darf das nicht uebersteuern');
  // Kontrolle: fuehrende Luecke, aber NetIncome[0] ebenfalls negativ -> bleibt unprofitable.
  const leadingGapLoss = { annual: { annualOpInc: V([null, null, -73413000, -31770000]),
    annualNetIncome: V([-5000000, -20331000]) } };
  assert.equal(trackOf(leadingGapLoss, f), 'unprofitable');
  // Kontrolle: opInc[0] present (kein Regress) -> unveraendert direkt aus opInc gelesen.
  const noGap = { annual: { annualOpInc: V([10, -73413000]), annualNetIncome: V([-5000000]) } };
  assert.equal(trackOf(noGap, f), 'profitable');
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

// P1-Chunk 4 Stufe 1 (Tag 623): sichtbare GitHub-Annotation statt Fussnote in der Summenzeile.
// console.log direkt auf stdout (F2964), VOR der Summenzeile (skip-honesty liest sie per pop()).
// Bedingung ist !HAS_UNIVERSE, nicht skip>0: mit echtem Universum sind einzelne Skips (Anker-Ticker
// fehlt) ein normaler Zustand — nur das leere Universum macht die ganze Suite aussagelos.
// Exit-Code bleibt gruen.
// files.length ist die Rohdatei-Zahl; universe zaehlt nur die JSON.parse+meta.ticker-Ueberlebenden.
// Ohne die Rohzahl sehen "Verzeichnis leer" und "Tausende Dateien, aber Schema unlesbar" gleich aus.
if (!HAS_UNIVERSE) console.log(`::warning::score.integration.test.js: ${files.length} Dateien im Snapshot-Verzeichnis, davon 0 lesbar — leeres Universum ODER Schema unlesbar. ${skip} Live-Universums-Anker (Routing, Rang, Dedup, Ausschluesse) wurden NICHT gemessen; die Suite meldet trotzdem gruen.`);
// Skip-Zahl gehoert in die Summenzeile: sonst liest "N ok, 0 fail" wie ein voller Pass,
// obwohl im pre-pull-CI die Live-Universums-Anker gar nicht gelaufen sind.
console.log(`\nscore.integration.test.js: ${pass} ok, ${fail} fail` + (skip ? `, ${skip} skipped (kein Universum)` : ''));
process.exit(fail ? 1 : 0);

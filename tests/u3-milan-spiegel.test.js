'use strict';
/**
 * U3-MILAN (Urteil `_COURT-MILAN-U3-2026-08-29.md`, ratifiziert als ENTSCHIED 31) — Waechter der
 * Mailaender Spiegel-Vorstufe in `scripts/filter-snapshot-merge.js`.
 *
 * WAS AUF DEM SPIEL STEHT: das Mailaender `1`-Praefix traegt das HEIMATMARKT-Kuerzel.
 * `1SAN.MI` ist Sanofi, `SAN` ist Banco Santander; `1DGX.MI` ist Dollar General, `DGX` ist Quest
 * Diagnostics — und die beiden letzten tragen sogar dasselbe `meta.country` ("United States"),
 * womit der billige Laender-Gegencheck allein widerlegt ist (Urteil T13). Faellt eine dieser
 * Wachen, verschmilzt der naechste Lauf zwei verschiedene Firmen und LOESCHT eine davon aus dem
 * Board. Eine ausbleibende Verschmelzung kostet dagegen nur einen Platz.
 *
 * ⚠ DER TEST LAEUFT AUF DER VORSTUFE, NICHT AUF `score.js`. Das ist Auflage A8 und kein Detail:
 * `splitFalseIssuerMerges` teilt ueber `issuerKeyStrengOhneGattung`, der DENSELBEN `meta.name`
 * liest wie der lose Schluessel — nach einer Umbenennung sind auch die strengen Schluessel gleich
 * und der Schutz unterbleibt (T4). Fuer Milan-Paare feuert er ohnehin nie (er braucht ≥ 2
 * US-Primaerlistings, T2/T3). Der Fehlverschmelzungs-Schutz muss also HIER halten, ohne jede
 * Mitwirkung des versiegelten Kerns.
 *
 * WARUM AUF DEN GRUND GEPRUEFT WIRD, NICHT NUR AUF JA/NEIN: die Riegel sind redundant.
 * `1SAN.MI`/`SAN` scheitert an Fingerabdruck UND Land UND Aktienzahl. Eine blosse
 * "wird-nicht-umbenannt"-Zusicherung bliebe gruen, wenn der Fingerabdruck-Riegel stirbt — der
 * teuerste denkbare stille Fehler. `milanTor()` gibt deshalb den ERSTEN greifenden Riegel
 * zurueck, und die Wache pinnt genau den.
 *
 * ALLE FIXTURE-ZAHLEN SIND AM LIVE-BESTAND GEMESSEN (Vintage 2026-08-29, 15.040 Snapshots,
 * Ebene `snapshot.timeseries`); die Umsatz-/Bruttogewinn-Reihen sind gekuerzt, weil das Tor auf
 * Wertgleichheit prueft und nicht auf die Groesse.
 *
 * Standalone-Runner, keine Frameworks, kein Netz.
 * Run: node tests/u3-milan-spiegel.test.js
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  milanTor, milanSieger, milanUmbenennungen, milanKlassenLesen, milanSchreiben, milanFingerabdruck,
  ladeIdentitaetsRegister, MILAN_KANDIDATEN, MILAN_ERWARTETE_BEINE, MILAN_ERWARTETE_GRUPPEN,
  MILAN_SHARES_BAND, MILAN_MIN_QUARTALE, MILAN_SPIEGEL,
  IDENTITAETS_REGISTER_ANKER, IDENTITAETS_REGISTER_STANDARDPFAD,
} = require('../scripts/filter-snapshot-merge.js');
// Die Produktionsregeln selbst — die Wache misst am Schluessel und an der Gruppierung, die
// spaeter wirklich entscheiden, nicht an einem Nachbau (Fehler F1334).
const { issuerKeyLoose, issuerDedupGroups, issuerDedupComparator } = require('../src/scoring/score.js');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.stack); }
}

// ─── Fixture-Bau ────────────────────────────────────────────────────────────────────────
//
// FX10 — FIXTURE-MIGRATION ALS MIGRATION, NICHT ALS UMBAU (Urteil `_COURT-A7-FX-2026-08-30.md`).
// Beide Bauer bekommen den FX-Kurs; die Voreinstellung ist `fx: 1`, weil die Division durch 1
// die Identitaet ist und JEDE bestehende Zusicherung damit wortgleich weiterlaeuft — kein
// DARF-NICHT-Fixture wird durch die Migration zu einem MUSS.
//
// ⚠ DIE MIGRATION HAT EINE FALLE, UND SIE IST DER GRUND FUER DIESEN KOMMENTAR: `milanFingerabdruck`
// ist exportiert und wird von drei Wachen DIREKT aufgerufen. Ein Aufruf mit einem Objekt ohne
// `fx` laeuft nicht in einen Fehler, sondern in die OHNE-FX-Schranke — jeder endliche Wert wird
// dann zu 'OHNE-FX:<ticker>', die Reihe kollabiert auf eine Konstante, und eine
// Trennschaerfe-Zusicherung waere GRUEN AUS DEM FALSCHEN GRUND. Wer hier ein Bein von Hand baut,
// gibt ihm ein `fx`.
const reihe = (basis, n = 5) => Array.from({ length: n }, (_, i) => basis * (i + 1));
/** Ein Bein in der Form, in der `milanKlassenLesen` es an `milanTor` uebergibt. */
function bein(ticker, name, opt = {}) {
  const basis = opt.basis === undefined ? 1000 : opt.basis;
  const n = opt.quartale === undefined ? 5 : opt.quartale;
  return {
    datei: ticker + '.json', ticker, metaTicker: ticker, name,
    country: opt.country === undefined ? 'United States' : opt.country,
    shares: opt.shares === undefined ? 1000000 : opt.shares,
    fx: opt.fx === undefined ? 1 : opt.fx,
    revenueQ: reihe(basis, n), grossProfitQ: reihe(basis * 0.7, n),
    usPrimaerlisting: !!opt.usPrimaer,
    schluessel: issuerKeyLoose({ meta: { name } }),
    strengerSchluessel: String(name).toLowerCase(),
  };
}
/**
 * Ein voller Snapshot fuer die I/O- und Dedup-Proben.
 *
 * `meta.fxRateApplied` ist PFLICHT, seit `milanKlassenLesen` fail-closed wirft: ein Snapshot
 * ohne finiten Kurs nimmt nicht teil. `opt.ohneFx` laesst den Stempel absichtlich weg — genau
 * das braucht der FAIL-CLOSED-Waechter.
 */
function snapshot(ticker, name, opt = {}) {
  const basis = opt.basis === undefined ? 1000 : opt.basis;
  const n = opt.quartale === undefined ? 5 : opt.quartale;
  const fx = opt.fx === undefined ? 1 : opt.fx;
  const meta = {
    ticker, name, country: opt.country === undefined ? 'United States' : opt.country,
    sharesOutstanding: opt.shares === undefined ? 1000000 : opt.shares,
    exchangeName: opt.exchangeName || 'Milan',
    marketCap: opt.marketCap,
  };
  // Die gespeicherten Reihen sind die KONVERTIERTEN — genau wie im Bestand, wo
  // `pull-yahoo.js:1083` jede Reihe mit `fx` multipliziert und den Kurs bei `:1090` stempelt.
  // Die Melde-Ebene ist `basis`, die gespeicherte ist `basis * fx`.
  if (!opt.ohneFx) meta.fxRateApplied = fx;
  return {
    meta,
    timeseries: {
      revenueQ: reihe(basis, n).map((v) => ({ value: v * fx })),
      grossProfitQ: reihe(basis * 0.7, n).map((v) => ({ value: v * fx })),
    },
  };
}

// ─── 1. VORWAERTS: die vom Urteil namentlich verlangten MUSS-Faelle ──────────────────────

test('VORWAERTS A8: 1ANE.MI/ANE.MC (Nicht-Wurzel, Diakritika) wird vereinheitlicht', () => {
  // gemessen: beide Spain, sharesOutstanding 324.323.262 auf beiden Beinen, 4 Umsatzquartale.
  const k = [{ anker: '1ANE.MI', beine: [
    bein('1ANE.MI', 'Corporacion Acciona Energias Renovables SA', { country: 'Spain', shares: 324323262, quartale: 4 }),
    bein('ANE.MC', 'Corporación Acciona Energías Renovables, S.A.', { country: 'Spain', shares: 324323262, quartale: 4 }),
  ] }];
  const { umbenennungen, urteile } = milanUmbenennungen(k, new Set());
  assert.equal(urteile[0].grund, 'umbenennen');
  assert.equal(urteile[0].sieger, '1ANE.MI', 'das Mailaender Bein traegt den Emittentennamen');
  assert.deepEqual([...umbenennungen.keys()], ['ANE.MC.json']);
});

test('VORWAERTS A8: 1FWON.MI/FWONK (verschiedene Kuerzel) wird vereinheitlicht', () => {
  // gemessen: beide United States, 224.233.462 Aktien, 5 Quartale; FWONK ist US-primaer, das
  // Mailaender Bein nicht -> A3 kann hier gar nicht greifen (nur EIN US-Primaerlisting).
  const k = [{ anker: '1FWON.MI', beine: [
    bein('1FWON.MI', 'Liberty Media Corporation Series C Liberty Formula One', { shares: 224233462 }),
    bein('FWONK', 'Formula One Group', { shares: 224233462, usPrimaer: true }),
  ] }];
  const { urteile } = milanUmbenennungen(k, new Set());
  assert.equal(urteile[0].grund, 'umbenennen');
  assert.deepEqual(urteile[0].verlierer, ['FWONK']);
});

test('VORWAERTS A8: Wurzel-Fall mit Platzhalter (1NLOK.MI/GEN) — der Platzhalter verliert', () => {
  const k = [{ anker: '1NLOK.MI', beine: [
    bein('1NLOK.MI', 'Gen Digital Inc.', { shares: 598577065 }),
    bein('GEN', 'GEN', { shares: 598577065, usPrimaer: true }),
  ] }];
  const { umbenennungen } = milanUmbenennungen(k, new Set());
  assert.equal(umbenennungen.get('GEN.json'), 'Gen Digital Inc.');
});

test('VORWAERTS A8: Dreibein 1BEI.MI/BEI.DE/BEI.SW — zwei Verlierer, EIN Name', () => {
  // gemessen: alle drei Germany, 218.072.613 Aktien, 4 Quartale; BEI.DE traegt den Platzhalter.
  const k = [{ anker: '1BEI.MI', beine: [
    bein('1BEI.MI', 'Beiersdorf Aktiengesellschaft', { country: 'Germany', shares: 218072613, quartale: 4 }),
    bein('BEI.DE', 'BEI.DE', { country: 'Germany', shares: 218072613, quartale: 4 }),
    bein('BEI.SW', 'Beiersdorf AG', { country: 'Germany', shares: 218072613, quartale: 4 }),
  ] }];
  const { umbenennungen, urteile } = milanUmbenennungen(k, new Set());
  assert.equal(urteile[0].verlierer.length, 2, 'Dreibein liefert ZWEI umbenannte Beine');
  assert.equal(umbenennungen.get('BEI.DE.json'), 'Beiersdorf Aktiengesellschaft');
  assert.equal(umbenennungen.get('BEI.SW.json'), 'Beiersdorf Aktiengesellschaft');
});

test('VORWAERTS A8 (Wirkungs-Beweis): nach der Vorstufe sieht der ECHTE Dedup GENAU EINEN Sieger', () => {
  // Das ist der eigentliche Zweck. Gemessen an issuerDedupGroups + issuerDedupComparator, den
  // Produktionsfunktionen — nicht an einem Nachbau, und ausdruecklich inklusive des
  // Dreibein-Falls und der beiden Nicht-Wurzel-Paare.
  const faelle = [
    [['1ANE.MI', 'Corporacion Acciona Energias Renovables SA'], ['ANE.MC', 'Corporación Acciona Energías Renovables, S.A.']],
    [['1FWON.MI', 'Liberty Media Corporation Series C Liberty Formula One'], ['FWONK', 'Formula One Group']],
    [['1NLOK.MI', 'Gen Digital Inc.'], ['GEN', 'GEN']],
    [['1CLNX.MI', 'Cellnex Telecom S.A.'], ['472.DE', 'CELLNEX TELECOM SA EO-,25']],
    [['1BEI.MI', 'Beiersdorf Aktiengesellschaft'], ['BEI.DE', 'BEI.DE'], ['BEI.SW', 'Beiersdorf AG']],
  ];
  for (const fall of faelle) {
    const anker = fall[0][0];
    const beine = fall.map(([t, n]) => bein(t, n, { country: 'Spain', shares: 1000 }));
    const vorher = issuerDedupGroups(fall.map(([t, n]) => ({ ticker: t, snapshot: { meta: { ticker: t, name: n } } })));
    assert.ok(vorher.length > 1, `${anker}: Vorbedingung — der Dedup trennt sie heute`);
    const { umbenennungen } = milanUmbenennungen([{ anker, beine }], new Set());
    const namen = new Map(fall.map(([t, n]) => [t, n]));
    for (const [datei, neu] of umbenennungen) namen.set(datei.slice(0, -'.json'.length), neu);
    const eintraege = fall.map(([t]) => ({ ticker: t, snapshot: { meta: { ticker: t, name: namen.get(t) } } }));
    const nachher = issuerDedupGroups(eintraege);
    assert.equal(nachher.length, 1, `${anker}: nach der Vorstufe muss der Dedup EINEN Emittenten sehen`);
    nachher[0].sort(issuerDedupComparator);
    assert.equal(nachher[0].length, fall.length, `${anker}: kein Bein geht verloren, es gewinnt eines`);
  }
});

// ─── 2. RUECKWAERTS: die belegten Fremdpaare — jeder am ERSTEN greifenden Riegel gepinnt ──

test('RUECKWAERTS §6.3: die fuenf Mailaender Fremdpaare scheitern am FINGERABDRUCK', () => {
  // Alle fuenf sind belegte Fremdpaare (Urteil T12/T13). Der Grund ist hier Vertrag: faellt die
  // Fingerabdruck-Pruefung heraus, wandert 1DGX.MI/DGX auf 'aktienzahl' und 1SAN.MI/SAN auf
  // 'land' — diese Zusicherung wird dann ROT. Genau so wurde sie einmal absichtlich gebrochen.
  const paare = [
    ['1SAN.MI', 'Sanofi', 'France', 1198068685, 'SAN', 'Banco Santander, S.A.', 'Spain', 14266584458],
    ['1DGX.MI', 'Dollar General Corporation', 'United States', 220616790, 'DGX', 'Quest Diagnostics Incorporated', 'United States', 110373360],
    ['1MRK.MI', 'Merck KGaA', 'Germany', 129242252, 'MRK', 'Merck & Co., Inc.', 'United States', 2469824415],
    ['1AIR.MI', 'Airbus SE', 'Netherlands', 791480489, 'AIR', 'AAR Corp.', 'United States', 40258840],
    ['1EL.MI', 'EssilorLuxottica Société anonyme', 'France', 459453611, 'EL', 'The Estée Lauder Companies Inc.', 'United States', 247287571],
  ];
  for (const [ta, na, la, sa, tb, nb, lb, sb] of paare) {
    const beine = [
      bein(ta, na, { country: la, shares: sa, basis: 1000 }),
      bein(tb, nb, { country: lb, shares: sb, basis: 7777, usPrimaer: true }),
    ];
    assert.equal(milanTor(beine, new Set()), 'fingerabdruck', `${ta}/${tb}: der Fingerabdruck muss der erste Riegel sein`);
    const { umbenennungen } = milanUmbenennungen([{ anker: ta, beine }], new Set());
    assert.equal(umbenennungen.size, 0, `${ta}/${tb}: kein Bein wird angefasst`);
    assert.notEqual(issuerKeyLoose({ meta: { name: na } }), issuerKeyLoose({ meta: { name: nb } }),
      `${ta}/${tb}: die Emittenten-Schluessel bleiben verschieden`);
  }
});

test('RUECKWAERTS §6.3: 1DGX.MI/DGX teilen das LAND — der Laender-Check allein traegt nicht', () => {
  // Die Tatsache, wegen der A4 zweiachsig ist: beide "United States" (Urteil T13). Ohne den
  // Fingerabdruck bliebe hier nur die Aktienzahl.
  const beine = [
    bein('1DGX.MI', 'Dollar General Corporation', { shares: 220616790, basis: 1000 }),
    bein('DGX', 'Quest Diagnostics Incorporated', { shares: 110373360, basis: 7777, usPrimaer: true }),
  ];
  assert.equal(beine[0].country, beine[1].country, 'Vorbedingung: gleiches Land');
  assert.equal(milanTor(beine, new Set()), 'fingerabdruck');
});

test('RUECKWAERTS A8: AVB/VMRK (bytegleiche Reihen, gleiches Land) scheitert an der AKTIENZAHL', () => {
  // Der Fall, der ein REINES Fingerabdruck-Tor widerlegt (Urteil T16): identische Umsatzreihen
  // auf zwei verschiedenen NYSE-Papieren. Gemessen 142.797.963 gegen 398.834.711 -> rel 0,642.
  // Faellt das Aktienzahl-Band heraus, wandert der Grund auf 'us-primaerlisting' und diese
  // Zusicherung wird rot.
  const beine = [
    bein('AVB', 'AvalonBay Communities Inc', { shares: 142797963, usPrimaer: true }),
    bein('VMRK', 'Vivmark Residential', { shares: 398834711, usPrimaer: true }),
  ];
  assert.equal(beine[0].revenueQ.join() , beine[1].revenueQ.join(), 'Vorbedingung: bytegleiche Reihen');
  assert.equal(milanTor(beine, new Set()), 'aktienzahl');
  assert.equal(milanUmbenennungen([{ anker: 'AVB', beine }], new Set()).umbenennungen.size, 0);
});

test('RUECKWAERTS A3: zwei US-Primaerlistings mit verschiedenen strengen Schluesseln — Klasse verworfen', () => {
  // Der A3-Riegel selbst, isoliert: AVB/VMRK-Lage, aber mit gleicher Aktienzahl, damit das Band
  // nicht vorher greift. Das ist der Ersatz fuer splitFalseIssuerMerges, den die Vorstufe VOR
  // der Mutation stellen muss (T4) — ohne A3 wuerde diese Klasse umbenannt.
  const beine = [
    bein('AVB', 'AvalonBay Communities Inc', { shares: 142797963, usPrimaer: true }),
    bein('VMRK', 'Vivmark Residential', { shares: 142797963, usPrimaer: true }),
  ];
  assert.equal(milanTor(beine, new Set()), 'us-primaerlisting');
});

test('RUECKWAERTS A1: Pre-Revenue — drei Quartale werden NICHT umbenannt', () => {
  // Ohne diese Auflage entstanden am Vintage 2026-07-14 Scheingruppen mit 183, 70 und 8 fremden
  // Firmen: leere Reihen sind alle "identisch".
  const beine = [
    bein('1XYZ.MI', 'Beispiel Erste AG', { quartale: 3 }),
    bein('XYZ', 'Beispiel Zweite AG', { quartale: 3 }),
  ];
  assert.equal(milanTor(beine, new Set()), 'umsatzquartale');
  assert.ok(MILAN_MIN_QUARTALE === 4, 'die Auflage steht bei vier Quartalen');
});

test('RUECKWAERTS A4: synthetisches Milan-Paar mit 0,3 Aktienzahl-Abstand bleibt unbenannt', () => {
  const beine = [
    bein('1ABC.MI', 'Beispiel Holding SA', { shares: 1000000 }),
    bein('ABC', 'Beispiel Holding S.A.', { shares: 700000 }),
  ];
  assert.ok(0.3 > MILAN_SHARES_BAND, 'Vorbedingung: 0,3 liegt ueber dem Band');
  assert.equal(milanTor(beine, new Set()), 'aktienzahl');
});

test('RUECKWAERTS A4: leeres meta.country blockt — die zweite Achse darf nie nur "beide leer" sein', () => {
  const beine = [bein('1ABC.MI', 'Beispiel AG', { country: '' }), bein('ABC', 'Beispiel A.G.', { country: '' })];
  assert.equal(milanTor(beine, new Set()), 'land');
});

test('RUECKWAERTS A5: ein zweites Mailaender Bein auf demselben Fingerabdruck bricht ab', () => {
  const beine = [bein('1ABC.MI', 'Beispiel AG'), bein('ABC', 'Beispiel A.G.')];
  const abdruck = milanFingerabdruck(beine[0]); // importiert, nicht nachgebaut (F1334)
  assert.equal(milanTor(beine, new Set([abdruck])), 'mehrdeutig');
});

test('RUECKWAERTS: ein fehlendes/unlesbares Bein fuehrt NIE zu einer Umbenennung', () => {
  assert.equal(milanTor([bein('1ABC.MI', 'Beispiel AG'), null], new Set()), 'beine-unvollstaendig');
  assert.equal(milanTor([bein('1ABC.MI', 'Beispiel AG')], new Set()), 'beine-unvollstaendig');
});

// ─── 3. Sieger-Regel und Kandidatenliste ────────────────────────────────────────────────

test('SIEGER: das Mailaender Bein gewinnt — auch gegen einen LAENGEREN XETRA-Namen', () => {
  // besseresBein (die .BO/.NS-Regel) wuerde hier "CELLNEX TELECOM SA EO-,25" waehlen, weil es
  // laenger ist. Genau das darf nicht passieren.
  const s = milanSieger([bein('1CLNX.MI', 'Cellnex Telecom S.A.'), bein('472.DE', 'CELLNEX TELECOM SA EO-,25')]);
  assert.equal(s.ticker, '1CLNX.MI');
});

test('SIEGER: traegt das Mailaender Bein selbst nur einen Platzhalter, faellt es zurueck', () => {
  const s = milanSieger([bein('1ABC.MI', '1ABC.MI'), bein('ABC', 'Beispiel Holding SA')]);
  assert.equal(s.ticker, 'ABC');
});

test('SIEGER: alle Beine Platzhalter -> nichts zu uebertragen, keine Umbenennung', () => {
  const beine = [bein('1ABC.MI', '1ABC.MI'), bein('ABC', 'ABC')];
  assert.equal(milanSieger(beine), null);
  const { urteile, umbenennungen } = milanUmbenennungen([{ anker: '1ABC.MI', beine }], new Set());
  assert.equal(urteile[0].grund, 'nur-platzhalter');
  assert.equal(umbenennungen.size, 0);
});

test('A6/A7: die eingefrorene Kandidatenliste traegt genau 17 Gruppen und 18 Verlierer-Beine', () => {
  assert.equal(MILAN_KANDIDATEN.length, MILAN_ERWARTETE_GRUPPEN);
  // 16 Zweibein-Klassen + ein Dreibein = 18 moegliche Verlierer. Die Arithmetik des Mengen-
  // Riegels ist damit ueberhaupt erreichbar — eine Liste, die 19 hergibt, koennte den Riegel nie
  // erfuellen und der Lauf braeche jeden Tag ab, ohne dass jemand die Ursache saehe.
  const moeglich = MILAN_KANDIDATEN.reduce((s, k) => s + k.partner.length, 0);
  assert.equal(moeglich, MILAN_ERWARTETE_BEINE);
  for (const k of MILAN_KANDIDATEN) {
    assert.ok(MILAN_SPIEGEL.test(k.anker), `${k.anker}: jeder Anker ist ein Mailaender Spiegel (A11)`);
    assert.ok(k.beleg && k.beleg.trim(), `${k.anker}: jeder Eintrag traegt seinen Board-Beleg`);
  }
  const alle = MILAN_KANDIDATEN.flatMap((k) => [k.anker, ...k.partner]);
  assert.equal(new Set(alle).size, alle.length, 'kein Ticker steht in zwei Klassen');
});

test('A11: KEIN Fremdpaar steht in der Kandidatenliste', () => {
  const verboten = new Set(['1SAN.MI', 'SAN', '1DGX.MI', 'DGX', '1MRK.MI', 'MRK', '1AIR.MI', 'AIR', '1EL.MI', 'EL', 'AVB', 'VMRK']);
  for (const k of MILAN_KANDIDATEN) {
    for (const t of [k.anker, ...k.partner]) assert.ok(!verboten.has(t), `${t} darf nicht in der Liste stehen`);
  }
});

// ─── 4. Identitaets-Register (K2, B1-B5) ────────────────────────────────────────────────

const HEUTE = '2026-08-30';

test('REGISTER B2 / M17c (D-D): die ausgelieferte Datei laedt und traegt GENAU den Anker-Wert', () => {
  // NACHFOLGER DES LEER-TESTS (Auflage M17c, _COURT-M10-2026-08-30). Der alte Riegel verlangte
  // "leer" — eine Bedingung mit eingebautem Verfallsdatum, die am Tag des ersten Eintrags
  // zwangslaeufig faellt. Gepinnt wird jetzt die ANZAHL gegen eine hartkodierte Zahl, gleiche
  // Bauform wie der A7-Mengen-Riegel: ein erster Eintrag hebt sie, aber nur zusammen mit einer
  // bewussten Aenderung derselben Konstante, im selben Diff, unter denselben Augen.
  const eintraege = ladeIdentitaetsRegister(IDENTITAETS_REGISTER_STANDARDPFAD, HEUTE);
  assert.equal(eintraege.length, IDENTITAETS_REGISTER_ANKER,
    `das Register traegt genau ${IDENTITAETS_REGISTER_ANKER} Eintraege — jede Abweichung ist ein Neubefund, kein Betriebszustand`);
  assert.equal(IDENTITAETS_REGISTER_ANKER, 0,
    'heute ist der Sollwert 0; ihn zu heben ist eine Sache des Rates (N5), nicht des Executors');
});

test('REGISTER M16/M18/M19: die Produktionstexte stehen woertlich in der ausgelieferten Datei', () => {
  // Drei bindende Saetze, die im Ereignisfall die einzige Bremse zwischen einer Lampe und einem
  // Register-Eintrag sind. Sie gehoeren IN die Datei, nicht in ein Urteil, das niemand oeffnet.
  const doku = JSON.parse(fs.readFileSync(IDENTITAETS_REGISTER_STANDARDPFAD, 'utf8'))._doku.join('\n');
  assert.ok(doku.includes("'Erkennung und Meldung sind erlaubt; jede Verschmelzungs-Entscheidung auf Basis dieser Erkennung"),
    'M16: die Abgrenzungsformel steht woertlich da');
  assert.ok(/bleibt bis zu einem eigenen Gericht gesperrt\./.test(doku), 'M16: zweite Haelfte der Formel');
  assert.ok(/KEINE TRIPWIRE-MELDUNG IST JE ALLEIN BELEG/.test(doku), 'M18: die Lampe ist kein Nachweis');
  assert.ok(/die EIGENE WATCHLIST-ZEILE/.test(doku),
    'M19: der Ersatzweg nennt BEIDE Quellen — den Feed UND unsere eigene Watchlist-Zeile');
  assert.ok(/Reihen-Gleichheit ist MELDUNG, nie BEGRUENDUNG|REIHEN-GLEICHHEIT IST MELDUNG, NIE BEGRUENDUNG/.test(doku),
    'M13: Anker B ist nie Begruendung');
});

test('REGISTER B5: ISSUER_ALIASE in score.js bleibt leer', () => {
  const quelle = fs.readFileSync(path.join(__dirname, '..', 'src', 'scoring', 'score.js'), 'utf8');
  assert.ok(/const ISSUER_ALIASE = \{\};/.test(quelle),
    'das Urteil laesst ISSUER_ALIASE ausdruecklich leer — eine Befuellung dort waere ein Siegelvorgang');
});

/** Ein Register-Fixture samt eigenem "Repo", damit die Existenzpruefung eine echte Datei
 *  findet oder eben nicht — und nicht an einer zufaellig vorhandenen Repo-Datei haengt. */
function registerFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'u3-reg-'));
  fs.mkdirSync(path.join(dir, 'reports'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'reports', 'messung.md'), '# Messung ueber den vollen Bestand\n');
  const schreib = (o) => { const p = path.join(dir, 'r.json'); fs.writeFileSync(p, JSON.stringify(o)); return p; };
  const gut = {
    kanonisch: 'acme', mitglieder: ['AAA', 'BBB'],
    beleg: { bericht: 'reports/messung.md', abschnitt: '§2 Aktienzahl-Anker', gemessenAm: '2026-08-29' },
    aufgenommen: '2026-08-29', gueltigBis: '2026-12-31',
  };
  const lade = (o, heute = HEUTE) => ladeIdentitaetsRegister(schreib(o), heute, dir);
  return { dir, gut, lade, schreib };
}

test('REGISTER B1: Pflichtfelder, Dubletten und Mehrfach-Ticker brechen das Laden hart ab', () => {
  const { dir, gut, lade, schreib } = registerFixture();
  assert.equal(lade({ eintraege: [gut] }).length, 1, 'Vorbedingung: ein vollstaendiger Eintrag laedt');
  assert.throws(() => ladeIdentitaetsRegister(schreib([]), HEUTE, dir), /Wurzel muss ein Objekt sein/);
  assert.throws(() => lade({}), /'eintraege' muss ein Array sein/);
  for (const feld of ['kanonisch', 'aufgenommen']) {
    const kaputt = { ...gut }; delete kaputt[feld];
    assert.throws(() => lade({ eintraege: [kaputt] }), new RegExp(`Feld ${feld} fehlt`));
  }
  assert.throws(() => lade({ eintraege: [{ ...gut, mitglieder: ['AAA'] }] }), /mindestens zwei nicht-leere Ticker/);
  assert.throws(() => lade({ eintraege: [gut, { ...gut, mitglieder: ['CCC', 'DDD'] }] }), /kanonische ID acme ist doppelt/);
  assert.throws(() => lade({ eintraege: [gut, { ...gut, kanonisch: 'zweite', mitglieder: ['AAA', 'CCC'] }] }),
    /Ticker AAA steht in acme UND zweite/);
  fs.rmSync(dir, { recursive: true, force: true });
});

// ─── M17: die vier Beweise der Aufnahmeschwellen-Haertung ───────────────────────────────

test('M17a-1: ein freier String als `beleg` laedt NICHT mehr durch', () => {
  // Der verifizierte Zustand VOR der Haertung (Urteil §3 K-8): `beleg: 'Messung X'` und sogar
  // `"beleg": "klar"` gingen sauber durch. Genau das ist jetzt ein Ladefehler.
  const { dir, gut, lade } = registerFixture();
  assert.throws(() => lade({ eintraege: [{ ...gut, beleg: 'Messung X' }] }), /'beleg' muss ein Objekt sein/);
  assert.throws(() => lade({ eintraege: [{ ...gut, beleg: 'klar' }] }), /'beleg' muss ein Objekt sein/);
  for (const feld of ['bericht', 'abschnitt', 'gemessenAm']) {
    const b = { ...gut.beleg }; delete b[feld];
    assert.throws(() => lade({ eintraege: [{ ...gut, beleg: b }] }), new RegExp(`beleg\\.${feld} fehlt`));
  }
  assert.throws(() => lade({ eintraege: [{ ...gut, beleg: { ...gut.beleg, gemessenAm: 'neulich' } }] }),
    /gemessenAm muss JJJJ-MM-TT sein/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('M17a-2: eine NICHT EXISTIERENDE Berichtsdatei laedt NICHT durch', () => {
  const { dir, gut, lade } = registerFixture();
  assert.throws(() => lade({ eintraege: [{ ...gut, beleg: { ...gut.beleg, bericht: 'reports/gibtsnicht.md' } }] }),
    /existiert nicht im Repo/);
  // Vault-Pfade fallen damit durch — und das ist der Zweck: die CI kann agent-reports/ nicht oeffnen.
  assert.throws(() => lade({ eintraege: [{ ...gut, beleg: { ...gut.beleg, bericht: 'agent-reports/irgendwas.md' } }] }),
    /existiert nicht im Repo/);
  // Und kein Ausbruch aus dem Repo, auch nicht ueber einen existierenden Pfad ausserhalb.
  assert.throws(() => lade({ eintraege: [{ ...gut, beleg: { ...gut.beleg, bericht: '../irgendwas.md' } }] }),
    /INNERHALB des Repos/);
  // ABWESENHEIT: die vorhandene Datei laedt sehr wohl — sonst pruefte die Wache nur, dass
  // ueberhaupt nichts durchkommt.
  assert.equal(lade({ eintraege: [gut] }).length, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('M17b (D-A): ein ABGELAUFENER Eintrag stoppt den Lauf, ein gueltiger nicht', () => {
  const { dir, gut, lade } = registerFixture();
  assert.throws(() => lade({ eintraege: [{ ...gut, gueltigBis: '2026-08-29' }] }, '2026-08-30'),
    /ist seit 2026-08-29 abgelaufen/);
  const ohne = { ...gut }; delete ohne.gueltigBis;
  assert.throws(() => lade({ eintraege: [ohne] }), /'gueltigBis' fehlt/);
  assert.throws(() => lade({ eintraege: [{ ...gut, gueltigBis: 'irgendwann' }] }), /'gueltigBis' fehlt oder ist kein/);
  // ABWESENHEIT (beide Randfaelle): am Ablauftag selbst gilt der Eintrag noch, danach nicht mehr.
  assert.equal(lade({ eintraege: [{ ...gut, gueltigBis: '2026-08-30' }] }, '2026-08-30').length, 1);
  assert.throws(() => lade({ eintraege: [{ ...gut, gueltigBis: '2026-08-30' }] }, '2026-08-31'), /abgelaufen/);
  // Ohne brauchbares Datum kann D-A nicht pruefen — und darf dann nicht stillschweigend durchlassen.
  assert.throws(() => lade({ eintraege: [gut] }, null), /D-A kann nicht pruefen/);
  assert.throws(() => lade({ eintraege: [gut] }, 'irgendwann'), /D-A kann nicht pruefen/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('M13: ein Eintrag mit Anker B als ALLEINIGEM Beleg laedt nicht durch', () => {
  const { dir, gut, lade } = registerFixture();
  assert.throws(() => lade({ eintraege: [{ ...gut, beleg: { ...gut.beleg, anker: ['B'] } }] }),
    /ausschliesslich Anker B/);
  assert.throws(() => lade({ eintraege: [{ ...gut, beleg: { ...gut.beleg, anker: ['b', 'B'] } }] }),
    /ausschliesslich Anker B/);
  // ABWESENHEIT: B ZUSAMMEN mit einem anderen Anker ist zulaessig — B ist als Meldung brauchbar,
  // nur als alleinige Begruendung nicht.
  assert.equal(lade({ eintraege: [{ ...gut, beleg: { ...gut.beleg, anker: ['A', 'B'] } }] }).length, 1);
  assert.equal(lade({ eintraege: [gut] }).length, 1, 'ohne Anker-Angabe bleibt alles wie bisher');
  assert.throws(() => lade({ eintraege: [{ ...gut, beleg: { ...gut.beleg, anker: 'B' } }] }),
    /beleg\.anker muss eine Liste/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('REGISTER B4: ein Eintrag ist KEIN Freifahrtschein — er muss dasselbe Tor bestehen', () => {
  // Genau der Recycling-Fall, den VMRK belegt: der Eintrag behauptet Identitaet, die Live-Daten
  // widersprechen. Ohne die Revalidierung wuerde das Register still fehlverschmelzen.
  const klasse = { anker: 'acme', registerQuelle: 'identitaets-register', beine: [
    bein('AAA', 'Acme Holding SA', { basis: 1000 }),
    bein('BBB', 'Fremde Firma AG', { basis: 7777 }),
  ] };
  const { umbenennungen, urteile } = milanUmbenennungen([klasse], new Set());
  assert.equal(urteile[0].grund, 'fingerabdruck');
  assert.equal(umbenennungen.size, 0);
});

test('REGISTER/A6: ein Bein in ZWEI Klassen wird verworfen, nicht still ueberschrieben', () => {
  // Reproduziert (vor dem Fix): ein Register-Eintrag, der `GEN` mitnennt, praegte GEN.json
  // still den Namen des Register-Eintrags auf — die zuletzt gerechnete Klasse gewann, und der
  // Mengen-Riegel sah es nicht, weil er nur die Kandidatenliste zaehlt. Ein Bein gehoert zu
  // genau EINEM Emittenten; zwei Aussagen darueber sind ein Widerspruch, keine Rangfolge.
  const klassen = [
    { anker: '1NLOK.MI', beine: [bein('1NLOK.MI', 'Gen Digital Inc.'), bein('GEN', 'GEN', { usPrimaer: true })] },
    { anker: 'fremd', registerQuelle: 'identitaets-register', beine: [bein('XYZ', 'Voellig Andere AG'), bein('GEN', 'GEN', { usPrimaer: true })] },
  ];
  const { umbenennungen, urteile, kollisionen } = milanUmbenennungen(klassen, new Set());
  assert.equal(kollisionen.length, 1, 'die Kollision wird gemeldet, nicht verschluckt');
  assert.equal(kollisionen[0].ticker, 'GEN');
  assert.equal(urteile[1].grund, 'kollision');
  assert.notEqual(umbenennungen.get('GEN.json'), 'Voellig Andere AG',
    'GEN darf NIE den Namen der fremden Klasse bekommen');
});

test('A1: nicht-endliche Reihenwerte bleiben unterscheidbar (JSON.stringify macht alles zu null)', () => {
  // Reproduziert: JSON.stringify schreibt NaN, Infinity, -Infinity und undefined ALLE als
  // `null`. Zwei Reihen, die sich nur dort unterscheiden, hatten denselben Fingerabdruck —
  // ein Loch in der Zusicherung "Wert fuer Wert, ohne Toleranz".
  // FX10: `fx` MUSS hier stehen. Ohne den Kurs faellt jeder ENDLICHE Wert in die
  // OHNE-FX-Schranke, die vier Vorderwerte kollabieren auf denselben String, und die Wache
  // pruefte nur noch, ob sich die letzte Position unterscheidet — gruen aus dem falschen Grund.
  const mit = (letzter) => ({ ticker: 'FIX', fx: 1, revenueQ: [100, 200, 300, 400, letzter], grossProfitQ: [70, 140, 210, 280, 7] });
  const abdruecke = [NaN, Infinity, -Infinity, null, undefined, 500].map((x) => milanFingerabdruck(mit(x)));
  // Vorbedingung der Wache selbst: die vier endlichen Vorderwerte muessen als Zahlen
  // durchkommen, nicht als OHNE-FX-Platzhalter. Faellt das `fx` oben weg, wird DIESE Zeile rot.
  assert.ok(milanFingerabdruck(mit(500)).startsWith('[100,200,300,400,500]'),
    'die endlichen Werte stehen als Zahlen im Abdruck, nicht als OHNE-FX-Platzhalter');
  assert.equal(new Set(abdruecke).size, abdruecke.length, 'jeder Sonderwert bleibt sein eigener Fingerabdruck');
  const beine = [
    { ...bein('1X.MI', 'Alpha AG'), revenueQ: [100, 200, 300, 400, NaN], grossProfitQ: [70, 140, 210, 280, 7] },
    { ...bein('X', 'Alpha A.G.'), revenueQ: [100, 200, 300, 400, Infinity], grossProfitQ: [70, 140, 210, 280, 7] },
  ];
  assert.equal(milanTor(beine, new Set()), 'fingerabdruck', 'und das Tor sieht den Unterschied auch');
});

// ─── 4b. A7-FX — die Melde-Waehrungs-Ebene (Urteil `_COURT-A7-FX-2026-08-30.md`) ─────────
//
// WAS AUF DEM SPIEL STEHT: `pull-yahoo.js:1083` multipliziert JEDE timeseries-Reihe mit dem beim
// Abruf gueltigen Kurs. Zwei Beine desselben Emittenten werden vom Shard-Lauf an verschiedenen
// Tagen gezogen (gemessen: 21 Tage Versatz bei 1JCI.MI) und tragen dann VERSCHIEDENE Kurse. Auf
// der konvertierten Ebene reisst der Byte-Vergleich dann — in der Simulation ueber alle real
// vorkommenden Kurspaare hielten 0 von 52 Faellen —, der A7-Mengen-Riegel faellt unter 18/17 und
// der GANZE Tageslauf bricht ab. Die Melde-Waehrung ist die einzige Ebene, auf der dieselben
// Fundamentaldaten dieselbe Zahl ergeben, egal wann sie geholt wurden.

test('A7-FX VORWAERTS: gleiche Melde-Reihen, VERSCHIEDENE Kurse — die Klasse haelt', () => {
  // Der Bombenfall. Beide Beine melden dieselbe Ganzzahl-Reihe (Basis 2.468.000.000, echte
  // 1BEI.MI-Groessenordnung); gespeichert ist sie mit zwei verschiedenen, real im Bestand
  // vorkommenden EUR-Kursen. Auf der konvertierten Ebene sind das zwei verschiedene Zahlenreihen.
  const A = 1.1550012, B = 1.1511453;
  const roh = [2468000000, 4936000000, 7404000000, 9872000000];
  const mkBein = (t, n, fx) => ({
    ...bein(t, n, { country: 'Germany', shares: 218072613, fx }),
    revenueQ: roh.map((x) => x * fx),
    grossProfitQ: roh.map((x) => x * 0.7 * fx),
  });
  const beine = [mkBein('1BEI.MI', 'Beiersdorf Aktiengesellschaft', A), mkBein('BEI.DE', 'BEI.DE', B)];

  // Vorbedingung: auf der GESPEICHERTEN Ebene sind die Reihen verschieden — sonst prueft die
  // Wache nichts. Genau hier reisst der Vergleich ohne die Kanonisierung.
  assert.notEqual(JSON.stringify(beine[0].revenueQ), JSON.stringify(beine[1].revenueQ),
    'Vorbedingung: die konvertierten Reihen sind NICHT bytegleich');
  assert.equal(milanFingerabdruck(beine[0]), milanFingerabdruck(beine[1]),
    'auf der Melde-Waehrung ist es dieselbe Firma');
  assert.equal(milanTor(beine, new Set()), 'umbenennen');
});

test('A7-FX RUECKWAERTS: eine Melde-Einheit Abstand trennt weiterhin (Band 1e9..1e15)', () => {
  // FX8 — DAS BAND IST GEMESSEN, NICHT GEWAEHLT, und diese Wache steht und faellt mit ihm.
  // Die Bruchprobe "FINGERABDRUCK_STELLEN auf 8 => rot" kann NUR feuern, wo 15 Stellen eine
  // Einheit trennen und 8 Stellen es nicht tun. Selbst nachgemessen:
  //   1e3 (die Default-Fixture-Basis!) 4 Stellen: S=15 trennt, S=8 trennt AUCH -> feuert NICHT
  //   1e6                              7 Stellen: S=15 trennt, S=8 trennt AUCH -> feuert NICHT
  //   1e9 .. 1e14                  10-15 Stellen: S=15 trennt, S=8 trennt nicht -> FEUERT
  //   1e15                            16 Stellen: S=15 trennt NICHT MEHR -> schon vorher rot
  // Auf der Default-Basis 1000 waere diese Wache also reine Dekoration gewesen. Sie traegt
  // deshalb einen Wert mit 10 signifikanten Stellen — EUR-Groessenordnung der Milan-Population.
  const fx = 1.1550012;
  const roh = 2468000000;              // 10 signifikante Stellen, mitten im Band
  const mkBein = (t, n, wert) => ({
    ...bein(t, n, { fx }),
    revenueQ: [wert * fx, wert * 2 * fx, wert * 3 * fx, wert * 4 * fx],
    grossProfitQ: [wert * 0.7 * fx, wert * 1.4 * fx, wert * 2.1 * fx, wert * 2.8 * fx],
  });
  const beine = [mkBein('1AAA.MI', 'Alpha AG', roh), mkBein('AAA', 'Alpha Anders AG', roh + 1)];
  assert.ok(roh >= 1e9 && roh < 1e15, 'Vorbedingung FX8: der Wert liegt im gemessenen Band');
  assert.notEqual(milanFingerabdruck(beine[0]), milanFingerabdruck(beine[1]),
    'EINE Melde-Einheit Abstand bleibt sichtbar — die Kanonisierung ist keine Toleranz');
  assert.equal(milanTor(beine, new Set()), 'fingerabdruck');
});

test('A7-FX FX3: ein nicht-endlicher QUOTIENT faltet nicht auf null', () => {
  // Reproduziert (Urteil §3 K-1): Infinity.toPrecision(15) -> "Infinity" -> Number(…) ->
  // Infinity -> JSON.stringify -> null. Zwei Beine mit VERSCHIEDENEN Werten wuerden bytegleich.
  // Die Eingangspruefung allein faengt das nicht: 1e300 und 2e300 sind beide endlich, erst der
  // Quotient laeuft ueber. Das ist dieselbe Nullen-Faltung, die A1 oben schon einmal kostete.
  assert.equal(JSON.stringify([Number((1e300 / 5e-324).toPrecision(15))]), '[null]',
    'Vorbedingung: ohne Quotienten-Pruefung faltet der Ueberlauf auf null');
  assert.equal(JSON.stringify([Number((2e300 / 5e-324).toPrecision(15))]), '[null]',
    'Vorbedingung: und zwar fuer BEIDE verschiedenen Werte gleich');
  const fx = 5e-324;
  const mk = (t, n, x) => ({
    ...bein(t, n, { fx }),
    revenueQ: [x, x * 2, x * 3, x * 4], grossProfitQ: [x, x * 2, x * 3, x * 4],
  });
  const beine = [mk('1INF.MI', 'Erste AG', 1e300), mk('INF', 'Zweite AG', 2e300)];
  assert.notEqual(milanFingerabdruck(beine[0]), milanFingerabdruck(beine[1]),
    'zwei verschiedene Werte duerfen nie denselben Abdruck bekommen');
  assert.equal(milanTor(beine, new Set()), 'fingerabdruck');
});

test('A7-FX FAIL-CLOSED: ein Snapshot ohne meta.fxRateApplied faellt MIT AUSWEIS heraus', () => {
  // Nicht "eine andere Fehlermeldung", sondern der Unterschied zwischen Herausfallen und einem
  // STILLEN RUECKFALL auf die konvertierte Ebene. Ohne die Schranke wuerde `fx === undefined`
  // in `melde()` in die OHNE-FX-Zeile laufen — das Bein bekaeme einen Abdruck, der mit nichts
  // matcht, und die Klasse endete auf 'fingerabdruck' statt mit einem Ausweis in `lesefehler`.
  // Genau dieser Unterschied wird hier gepinnt: die Klasse muss 'beine-unvollstaendig' geben
  // UND der Ticker muss in `lesefehler` stehen.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'u3-fx-fc-'));
  const leg = (t, n, o) => fs.writeFileSync(path.join(dir, t + '.json'), JSON.stringify(snapshot(t, n, o)));
  leg('1OHN.MI', 'Ohnekurs AG', { country: 'Germany', shares: 1000 });
  leg('OHN', 'Ohnekurs A.G.', { country: 'Germany', shares: 1000, ohneFx: true, exchangeName: 'XETRA' });

  const gelesen = milanKlassenLesen(dir, [{ anker: '1OHN.MI', partner: ['OHN'] }], []);
  assert.deepEqual(gelesen.lesefehler.map((f) => f.ticker), ['OHN'],
    'das Bein ohne Kurs steht im Ausweis — nicht still verschluckt');
  assert.match(gelesen.lesefehler[0].grund, /fxRateApplied/,
    'und der Grund benennt das fehlende Feld');
  const { urteile, umbenennungen } = milanUmbenennungen(gelesen.klassen, gelesen.mehrfachAbdruecke);
  assert.equal(urteile[0].grund, 'beine-unvollstaendig',
    'fail-closed: die Klasse faellt aus, sie wird nicht auf der konvertierten Ebene verglichen');
  assert.equal(umbenennungen.size, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('A7-FX / A5: ein unlesbares Mailaender Bein laesst eine Klasse NICHT aus "mehrdeutig" fallen', () => {
  // FX4 — der A5-Index ist fail-OPEN (`if (!b || …) continue`). Ein unlesbares Mailaender Bein
  // verschwindet aus dem Mehrdeutigkeits-Index; eine Klasse, die als 'mehrdeutig' haette
  // scheitern muessen, passiert dann leise. Die Kanonisierung erzeugt diese Asymmetrie nicht,
  // sie verbreitert ihre Ausloeseflaeche von "kaputtes JSON" auf "kaputtes JSON ODER fehlender
  // Kurs". Deshalb MUSS `lesefehler` im Ausweis stehen — hier wird gepinnt, dass der Kanal
  // ueberhaupt sichtbar ist.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'u3-fx-a5-'));
  const leg = (t, n, o) => fs.writeFileSync(path.join(dir, t + '.json'), JSON.stringify(snapshot(t, n, o)));
  leg('1ZGU.MI', 'Beispiel Group Class A', { shares: 1000 });
  leg('1ZUS.MI', 'Beispiel Group Class C', { shares: 1000 });
  leg('ZG', 'Beispiel Group, Inc.', { shares: 1000, exchangeName: 'NasdaqGS' });

  // Gegenprobe zuerst: mit allen drei Beinen lesbar greift A5.
  const heil = milanKlassenLesen(dir, [{ anker: '1ZGU.MI', partner: ['ZG'] }], []);
  assert.equal(heil.mehrfachAbdruecke.size, 1);
  assert.equal(heil.lesefehler.length, 0);
  assert.equal(milanUmbenennungen(heil.klassen, heil.mehrfachAbdruecke).urteile[0].grund, 'mehrdeutig');

  // Jetzt verliert das ZWEITE Mailaender Bein seinen Kurs. Der Index sieht nur noch EIN Bein
  // auf diesem Abdruck, A5 greift nicht mehr — und ohne den Ausweis waere das unsichtbar.
  leg('1ZUS.MI', 'Beispiel Group Class C', { shares: 1000, ohneFx: true });
  const blind = milanKlassenLesen(dir, [{ anker: '1ZGU.MI', partner: ['ZG'] }], []);
  assert.deepEqual(blind.lesefehler.map((f) => f.ticker), ['1ZUS.MI'],
    'der Wegfall MUSS im Ausweis stehen — sonst passiert die Klasse leise');
  assert.equal(blind.mehrfachAbdruecke.size, 0, 'Vorbedingung: A5 greift jetzt wirklich nicht mehr');
  // UND GENAU DESHALB REICHT DER AUSWEIS NICHT: die Klasse wuerde jetzt umbenannt. Der Ausweis
  // macht den Kanal sichtbar, er schliesst ihn nicht — das schliesst erst der
  // A5-Integritaets-Riegel im Prozess (naechster Test).
  assert.equal(milanUmbenennungen(blind.klassen, blind.mehrfachAbdruecke).urteile[0].grund, 'umbenennen',
    'die Luecke ist real: ohne Riegel wuerde die vorher blockierte Klasse umbenannt');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('KOLLISION: ein Ticker als Verlierer in Klasse A und Sieger in Klasse B faellt auf', () => {
  // Reproduziert: `T` wurde von Klasse A auf "Erste Holding AG" umbenannt, waehrend Klasse B
  // ihn als Identitaets-Quelle bescheinigte und `1BBB.MI` auf "Tango Corp" schrieb — die
  // Identitaet, die B beglaubigt hatte, war danach weg. Die alte Pruefung sah nur die
  // Verlierer und meldete 0 Kollisionen.
  const kl = [
    { anker: '1AAA.MI', beine: [bein('1AAA.MI', 'Erste Holding AG'), bein('T', 'Tango Corp')] },
    { anker: '1BBB.MI', beine: [bein('1BBB.MI', '1BBB.MI'), bein('T', 'Tango Corp')] },
  ];
  const { kollisionen, umbenennungen } = milanUmbenennungen(kl, new Set());
  assert.equal(kollisionen.length, 1, 'der Anspruch auf dieselbe Datei muss auffallen');
  assert.equal(kollisionen[0].ticker, 'T');
  assert.ok(!umbenennungen.has('1BBB.MI.json'), 'die widerspruechliche Klasse wird nicht ausgefuehrt');
  // Auch in der anderen Reihenfolge (Sieger zuerst, Verlierer danach).
  const { kollisionen: k2 } = milanUmbenennungen([kl[1], kl[0]], new Set());
  assert.equal(k2.length, 1, 'die Reihenfolge der Klassen darf nichts daran aendern');
});

test('A5 gilt auch fuer Register-Klassen, sobald sie ein Mailaender Bein nennen', () => {
  // Vorher haing der Riegel an der QUELLE der Klasse, nicht am Mailaender Bein: jede
  // Register-Klasse bekam `null` und damit gar keine Mehrdeutigkeits-Pruefung — obwohl nichts
  // einen Register-Eintrag daran hindert, einen `1XXX.MI`-Ticker zu nennen. Die Zusicherung
  // stand nur im Kommentar.
  const beine = [bein('1ABC.MI', 'Beispiel AG'), bein('ABC', 'Beispiel A.G.')];
  const abdruck = milanFingerabdruck(beine[0]); // importiert, nicht nachgebaut (F1334)
  const klasse = { anker: 'beispiel', registerQuelle: 'identitaets-register', beine };
  const { urteile, umbenennungen } = milanUmbenennungen([klasse], new Set([abdruck]));
  assert.equal(urteile[0].grund, 'mehrdeutig', 'A5 darf nicht an der Quelle der Klasse haengen');
  assert.equal(umbenennungen.size, 0);
});

// ─── 5. I/O-Mantel: liest den Bestand, schreibt nur die Verlierer ────────────────────────

test('I/O: milanKlassenLesen + milanSchreiben setzen genau die Verlierer-Beine um', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'u3-io-'));
  const leg = (t, n, o) => fs.writeFileSync(path.join(dir, t + '.json'), JSON.stringify(snapshot(t, n, o)));
  leg('1ANE.MI', 'Corporacion Acciona Energias Renovables SA', { country: 'Spain', shares: 324323262 });
  leg('ANE.MC', 'Corporación Acciona Energías Renovables, S.A.', { country: 'Spain', shares: 324323262, exchangeName: 'Madrid' });
  // Fremdpaar im selben Verzeichnis: es darf NICHT angefasst werden.
  // FX9 — GENAU EIN BEIN DIESER PROBE LAEUFT MIT `fx != 1` (realer EUR-Kurs aus dem Bestand).
  // Ohne das bewiese die gruene Suite nur, dass die Division durch 1 funktioniert: `fx: 1` ist
  // als Migrations-Default richtig, macht aber jeden bestehenden Waechter zum Sonderfall, in
  // dem `x/1` nichts tut. Hier laeuft die Rueckrechnung wirklich — die gespeicherte Reihe von
  // SAN ist 9999*1,1550012, die Melde-Ebene ist 9999, und sie bleibt von Sanofis 4242 getrennt.
  leg('1SAN.MI', 'Sanofi', { country: 'France', shares: 1198068685, basis: 4242 });
  leg('SAN', 'Banco Santander, S.A.', { country: 'Spain', shares: 14266584458, basis: 9999, exchangeName: 'NYSE', fx: 1.1550012 });

  const rohSAN = JSON.parse(fs.readFileSync(path.join(dir, 'SAN.json'), 'utf8'));
  assert.notEqual(rohSAN.meta.fxRateApplied, 1, 'FX9: diese Probe laeuft mit einem echten Kurs');
  assert.notEqual(rohSAN.timeseries.revenueQ[0].value, 9999,
    'Vorbedingung: die GESPEICHERTE Reihe ist die konvertierte, nicht die gemeldete');

  const gelesen = milanKlassenLesen(dir, [{ anker: '1ANE.MI', partner: ['ANE.MC'] }, { anker: '1SAN.MI', partner: ['SAN'] }], []);
  assert.equal(gelesen.milanBeine, 2, 'beide Mailaender Beine wurden fuer die A5-Probe gelesen');
  assert.equal(gelesen.mehrfachAbdruecke.size, 0);
  const { umbenennungen, urteile } = milanUmbenennungen(gelesen.klassen, gelesen.mehrfachAbdruecke);
  assert.equal(urteile.find((u) => u.anker === '1SAN.MI').grund, 'fingerabdruck');
  const geschrieben = milanSchreiben(dir, umbenennungen);
  assert.deepEqual(geschrieben.geschrieben, ['ANE.MC']);
  assert.equal(geschrieben.unschreibbar, 0);

  const nach = (t) => JSON.parse(fs.readFileSync(path.join(dir, t + '.json'), 'utf8')).meta.name;
  assert.equal(nach('ANE.MC'), 'Corporacion Acciona Energias Renovables SA');
  assert.equal(nach('1ANE.MI'), 'Corporacion Acciona Energias Renovables SA');
  assert.equal(nach('1SAN.MI'), 'Sanofi', 'Sanofi bleibt Sanofi');
  assert.equal(nach('SAN'), 'Banco Santander, S.A.', 'Santander bleibt Santander');
  assert.notEqual(issuerKeyLoose({ meta: { name: nach('1SAN.MI') } }), issuerKeyLoose({ meta: { name: nach('SAN') } }),
    'ohne jede Mitwirkung von splitFalseIssuerMerges bleiben die Schluessel verschieden');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('I/O A5: zwei Mailaender Beine mit demselben Fingerabdruck werden als mehrdeutig erkannt', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'u3-nm-'));
  const leg = (t, n, o) => fs.writeFileSync(path.join(dir, t + '.json'), JSON.stringify(snapshot(t, n, o)));
  leg('1ZGU.MI', 'Beispiel Group Class A', { shares: 1000 });
  leg('1ZUS.MI', 'Beispiel Group Class C', { shares: 1000 });
  leg('ZG', 'Beispiel Group, Inc.', { shares: 1000, exchangeName: 'NasdaqGS' });
  const gelesen = milanKlassenLesen(dir, [{ anker: '1ZGU.MI', partner: ['ZG'] }], []);
  assert.equal(gelesen.mehrfachAbdruecke.size, 1);
  const { urteile, umbenennungen } = milanUmbenennungen(gelesen.klassen, gelesen.mehrfachAbdruecke);
  assert.equal(urteile[0].grund, 'mehrdeutig');
  assert.equal(umbenennungen.size, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

// ─── 6. A7 — der Mengen-Riegel am echten Prozess ────────────────────────────────────────

const { spawnSync } = require('node:child_process');
const SCRIPT = path.join(__dirname, '..', 'scripts', 'filter-snapshot-merge.js');

/** Baut Eingang + Watchlist und laesst den echten Filter laufen (gleiche Bauform wie f12). */
function lauf(dateien) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'u3-lauf-'));
  const eingang = path.join(root, 'eingang');
  const ziel = path.join(root, 'ziel');
  fs.mkdirSync(eingang, { recursive: true });
  const tickers = [];
  for (const [ticker, name, opt] of dateien) {
    fs.writeFileSync(path.join(eingang, ticker + '.json'), JSON.stringify(snapshot(ticker, name, opt)));
    tickers.push({ ticker });
  }
  const wl = path.join(root, 'watchlist.json');
  fs.writeFileSync(wl, JSON.stringify({ stocks: tickers }));
  const r = spawnSync(process.execPath, [SCRIPT, '--eingang', eingang, '--ziel', ziel, '--watchlist', wl], { encoding: 'utf8' });
  const ausgabe = (r.stdout || '') + (r.stderr || '');
  fs.rmSync(root, { recursive: true, force: true });
  return { code: r.status, ausgabe };
}
/** Fuellmasse, damit die Mindest-Fallzahl (100) erreicht wird. */
const fueller = (n) => Array.from({ length: n }, (_, i) => [`FILL${i}`, `Fueller ${i} AG`, { basis: 100 + i }]);

test('A7 am Prozess: EIN vorhandener Anker mit falscher Menge bricht den Lauf HART ab', () => {
  // 1ANE.MI/ANE.MC sind da und wuerden umbenannt — die uebrigen 16 Klassen fehlen, also
  // 1 statt 18 Beine. Der Riegel muss feuern, und zwar BEVOR irgendetwas geschrieben ist.
  const r = lauf([...fueller(120),
    ['1ANE.MI', 'Corporacion Acciona Energias Renovables SA', { country: 'Spain', shares: 324323262 }],
    ['ANE.MC', 'Corporación Acciona Energías Renovables, S.A.', { country: 'Spain', shares: 324323262, exchangeName: 'Madrid' }],
  ]);
  assert.equal(r.code, 1, 'Mengen-Riegel muss hart abbrechen. Ausgabe:\n' + r.ausgabe);
  assert.match(r.ausgabe, /::error::U3-Milan — Mengen-Riegel gerissen: 1 umbenannte Beine \/ 1 kollabierte Gruppen, erwartet 18\/17/);
  assert.match(r.ausgabe, /Kein Bein wurde angefasst/);
});

test('A7 am Prozess: alle Anker-Dateien DA, aber unlesbar -> Riegel feuert (FEHLT != KAPUTT)', () => {
  // Reproduziert (vor dem Fix): ein systemischer Lesefehler ueber alle 17 Anker liess die Zahl
  // der auswertbaren Beine auf 0 fallen; der Riegel wurde uebersprungen und schrieb dieselbe
  // Zeile wie im harmlosen "anderes Universum"-Fall. Exit 0, Befund unsichtbar.
  const kaputt = MILAN_KANDIDATEN.flatMap((k) => [k.anker, ...k.partner]);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'u3-kaputt-'));
  const eingang = path.join(root, 'eingang');
  fs.mkdirSync(eingang, { recursive: true });
  const tickers = [];
  for (const [t, n, o] of fueller(120)) {
    fs.writeFileSync(path.join(eingang, t + '.json'), JSON.stringify(snapshot(t, n, o)));
    tickers.push({ ticker: t });
  }
  for (const t of kaputt) {
    fs.writeFileSync(path.join(eingang, t.replace(/[^A-Z0-9.-]/gi, '_') + '.json'), '{ KAPUTT');
    tickers.push({ ticker: t });
  }
  const wl = path.join(root, 'watchlist.json');
  fs.writeFileSync(wl, JSON.stringify({ stocks: tickers }));
  const r = spawnSync(process.execPath, [SCRIPT, '--eingang', eingang, '--ziel', path.join(root, 'ziel'), '--watchlist', wl], { encoding: 'utf8' });
  const ausgabe = (r.stdout || '') + (r.stderr || '');
  fs.rmSync(root, { recursive: true, force: true });
  assert.equal(r.status, 1, 'ein Bruch ueber ALLE Anker darf den Riegel nicht abschalten. Ausgabe:\n' + ausgabe);
  assert.match(ausgabe, /Mengen-Riegel gerissen/);
  assert.match(ausgabe, /Kandidaten-Datei\(en\) waren nicht auswertbar/, 'der Grund muss in der Abbruch-Meldung stehen');
  assert.match(ausgabe, /::warning::U3-Milan — .*nicht auswertbar/, 'jede unlesbare Datei faellt einzeln auf');
});

/**
 * Baut ALLE 17 eingefrorenen Klassen so, dass der Mengen-Riegel bei genau 18/17 GRUEN ist.
 * Jede Klasse bekommt eine eigene Basis, damit kein Abdruck doppelt vorkommt (sonst 'mehrdeutig').
 * Das Partner-Bein traegt einen Platzhalternamen, damit das Mailaender Bein den Namen stellt.
 */
function alleKandidatenDateien() {
  const aus = [];
  MILAN_KANDIDATEN.forEach((k, i) => {
    const opt = { shares: 1000000, basis: 1000 + i * 7 };
    aus.push([k.anker, `Emittent ${i} AG`, opt]);
    for (const p of k.partner) aus.push([p, p, opt]);
  });
  return aus;
}

test('A5-INTEGRITAET am Prozess: ein unlesbares Mailaender Bein bricht HART ab, obwohl A7 gruen ist', () => {
  // Die Luecke, die A7 STRUKTURELL nicht sehen kann: das kaputte Bein ist KEIN Kandidat, also
  // bewegt sich keine Zaehlgroesse — 18/17 stimmt weiterhin. Trotzdem ist der A5-Index jetzt
  // lueckenhaft (fail-OPEN), und eine Klasse koennte still fehlverschmelzen.
  // Vorprobe: ohne das kaputte Bein laeuft derselbe Bestand SAUBER DURCH (Exit 0) — nur so ist
  // bewiesen, dass der Abbruch unten wirklich am kaputten Bein haengt und nicht an der Menge.
  const sauber = lauf([...fueller(120), ...alleKandidatenDateien()]);
  assert.equal(sauber.code, 0, 'Vorprobe: 18/17 muss gruen durchlaufen. Ausgabe:\n' + sauber.ausgabe);
  assert.match(sauber.ausgabe, /18 Beine in 17 Gruppen auf den Emittenten-Namen gesetzt/);

  // Jetzt dasselbe, plus EIN unlesbares Mailaender Bein ausserhalb der Kandidatenliste.
  const r = lauf([...fueller(120), ...alleKandidatenDateien(),
    ['1KAPUTT.MI', 'Kaputt AG', { shares: 1000, basis: 999999, ohneFx: true }],
  ]);
  assert.equal(r.code, 1, 'ein unlesbares Mailaender Bein muss hart abbrechen. Ausgabe:\n' + r.ausgabe);
  assert.match(r.ausgabe, /::error::U3-Milan — A5-Integritaet gerissen: 1 Mailaender Bein\(e\) nicht auswertbar \(1KAPUTT\.MI\)/);
  assert.match(r.ausgabe, /Kein Bein wurde angefasst/);
  assert.doesNotMatch(r.ausgabe, /Mengen-Riegel gerissen/,
    'A7 ist hier GRUEN — der Abbruch kommt nachweislich vom A5-Riegel, nicht vom Mengen-Riegel');
  assert.doesNotMatch(r.ausgabe, /Beine in 17 Gruppen auf den Emittenten-Namen gesetzt/,
    'der Abbruch liegt VOR dem Schreiben');
});

test('A5-INTEGRITAET: ein unlesbares NICHT-Mailaender Bein bricht NICHT ab', () => {
  // Gegenrichtung, damit der Riegel nicht einfach "jeder Lesefehler bricht ab" ist: ein
  // kaputtes Bein ohne Mailaender Suffix beruehrt den A5-Index nicht und darf den Lauf nicht
  // kosten. Ohne diese Probe waere der Riegel viel zu breit und niemand haette es gemerkt.
  const r = lauf([...fueller(120), ...alleKandidatenDateien(),
    ['XKAPUTT', 'Kaputt AG', { shares: 1000, basis: 999999, ohneFx: true }],
  ]);
  assert.equal(r.code, 0, 'ein Nicht-Mailaender Lesefehler ist kein A5-Problem. Ausgabe:\n' + r.ausgabe);
  assert.match(r.ausgabe, /18 Beine in 17 Gruppen auf den Emittenten-Namen gesetzt/);
});

test('A7 am Prozess: ohne jedes Anker-Bein laeuft der Filter durch (anderes Universum, nicht Drift)', () => {
  const r = lauf(fueller(120));
  assert.equal(r.code, 0, 'ein Bestand ohne Mailaender Anker ist kein Mengen-Fehler. Ausgabe:\n' + r.ausgabe);
  assert.match(r.ausgabe, /\[u3-milan\] Mengen-Riegel uebersprungen: 120 zu pruefende Snapshots, 0 Dateien der Kandidatenliste im Bestand, 0 nicht auswertbar/);
});

test('A10 am Prozess: jede Nicht-Umbenennung steht mit Grund und beiden Tickern im Log', () => {
  const r = lauf([...fueller(120),
    ['1SAN.MI', 'Sanofi', { country: 'France', shares: 1198068685, basis: 4242 }],
    ['SAN', 'Banco Santander, S.A.', { country: 'Spain', shares: 14266584458, basis: 9999, exchangeName: 'NYSE' }],
  ]);
  // 1SAN.MI steht gar nicht in der Kandidatenliste — es darf deshalb NIRGENDS als Umbenennung
  // auftauchen, und der Lauf laeuft durch (kein Anker-Bein im Bestand).
  assert.equal(r.code, 0, 'Ausgabe:\n' + r.ausgabe);
  assert.ok(!/\[u3-milan\] .*-> Emittenten-Name/.test(r.ausgabe), 'kein Fremdpaar wird umbenannt');
  assert.match(r.ausgabe, /\[u3-milan\] 1ANE\.MI: keine Umbenennung \(beine-unvollstaendig\)/);
});

// ─── 7. Drift-Spur (§6.5) — die Verdrahtung, nicht nur das Skript ───────────────────────

test('§6.5: der Voll-Zensus laeuft monatlich und sein Bericht wird committet', () => {
  // Ein Messskript, das niemand startet, ist keine Drift-Spur. Der Zensus haengt bewusst im
  // Monatslauf, weil nur der den vollen Snapshot-Bestand ohnehin wiederherstellt.
  const yml = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'monthly-sec-xbrl.yml'), 'utf8');
  assert.match(yml, /node scripts\/probe-fingerprint-zensus\.js/, 'der Zensus muss im Monatslauf stehen');
  assert.match(yml, /git add reports\/fingerprint-zensus-\*\.txt/, 'sein Bericht muss committet werden, sonst sieht ihn niemand');
  // Der "Bestand nicht lesbar"-Befund geht auf stderr. Ohne 2>&1 bekaeme der committete
  // Bericht eine leere Datei OHNE Grund, und die Erklaerung lebte nur im fluechtigen Actions-Log.
  assert.match(yml, /probe-fingerprint-zensus\.js 2>&1 \| tee/, 'stderr muss in den committeten Bericht');
  const zensus = require('../scripts/probe-fingerprint-zensus.js');
  assert.equal(zensus.main(['--selftest']), 0, 'die Wachprobe des Zensus muss gruen sein');
});

console.log(`\nu3-milan-spiegel.test.js: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);

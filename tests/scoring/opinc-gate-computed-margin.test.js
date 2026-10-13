'use strict';
/**
 * Waechter: das HARTE GATE gegen synthetische OpInc-Reihen (Urteil T164/T165/T166, 29.08.2026).
 * ============================================================================================
 * Urteil `_COURT-T164-OPINC-2026-08-29.md`, K2 EINSTIMMIG 3:0 "zulaessig-mit-Kennzeichnung mit
 * hartem Gate" und K3 EINSTIMMIG 3:0 "behalten-mit-Ausnahme"; ratifiziert als ENTSCHIED 15,
 * Karl-Freigabe 29.08.2026 20:10 (ENTSCHIED 18). Uebergangsprotokoll:
 * protocol/gqs-00/1.2.0-pending/transition.json.
 *
 * WAS DIE SACHE IST (und was dieser Test deshalb festnagelt):
 * pull-yahoo.js fuellt fehlende Jahres-Betriebsergebnisse von Finanzfirmen mit
 * `annualRev[jahr] x operatingMargins(TTM)` — EINE Marge auf alle Jahre gestempelt
 * (meta.opIncSource === 'computed-margin', 1.859 Namen im Hauptstore). Eine solche Reihe hat
 * konstruktionsbedingt KONSTANTE Marge und KONSTANTES Vorzeichen: sie fabriziert exakt die
 * Stabilitaet, die jede historische Achse messen soll. GLXY stand damit auf Rang 1 des
 * financials-Boards mit capitalEfficiency-Perzentil 99,7 — aus Fiktion.
 *
 * DIE TRENNLINIE, die dieser Test in BEIDE Richtungen bewacht:
 *   GESPERRT (K2-Auflage 2)  jede historische Achse, Profitphase, longitudinale Lampe.
 *   ERLAUBT  (K2-Auflage 1)  das aktuelle VORZEICHEN des Track-Splits — es ist das Vorzeichen
 *                            der realen TTM-Operating-Margin, kein fabriziertes Signal.
 * Ein Waechter, der nur die Sperre prueft, wuerde eine Ueber-Sperrung (Track kippt fuer 1.859
 * Finanznamen) gruen durchlassen. Deshalb steht zu jeder Sperr-Assertion die Gegenprobe.
 *
 * G1  B1 — capitalEfficiency UND roicStability sind bei Synthetik null; der IDENTISCHE
 *          Zwilling mit ehrlichem Etikett liefert beide Achsen (Gegenrichtung).
 * G2  K2.1 — der Track-Split liest weiter das aktuelle Vorzeichen, positiv WIE negativ.
 * G3  B3/K3 — gegen Synthetik gewinnt eine ECHTE SEC-Serie unabhaengig von der Laenge;
 *          gegen eine ECHTE Yahoo-Reihe bleibt die Laengenbedingung scharf (Gegenrichtung);
 *          der Single-Source-Trio-Guard bleibt unangetastet (dritte Richtung).
 * G4  B2/B4 — die Herkunfts-Lampen brennen, excludieren aber NICHT (isDataSuspect false, die
 *          Zeile routet). Waere die Lampe in DATA_SUSPECT_LAMPS, waere das ein 300-Zeilen-
 *          Exclude durch die Hintertuer — vom Gericht ausdruecklich verboten.
 * G5  K3.4/R3 — roicStability bleibt unter sechs gepaarten Jahren null, auch mit echter Quelle.
 * G6  K2.2 — die uebrigen historischen Verbraucher: Profitphase, Profit-Stufe, Zyklus-Daempfer,
 *          burnAccelerating, peakMargin, cyclePeak. Jeweils mit Gegenprobe am Zwilling.
 * G7  ENTSCHIED 16 — REGRESSIONS-PIN der "Runde-4"-Null-Rettung in trackOf (score.js): ein
 *          present-0 im juengsten OpInc-Jahr faellt auf das NetIncome-Vorzeichen zurueck.
 *          Nicht neue Logik, sondern Versicherung: 140 OpInc==0-Faelle im Store haengen daran,
 *          20 davon mit negativem NetIncome. Ein Refactor darf den Pfad nicht still verlieren.
 *
 * ABSICHTSBRUCH-PROBE (Pflicht, durchgefuehrt 29.08.2026): jede der sieben Gruppen wurde
 * einmal am PRUEFLING gebrochen und wurde rot — G1/G3/G5/G6 durch Zuruecksetzen von
 * histOpInc() auf norm(), G2 durch Umstellen von trackOf auf histOpInc, G4 durch Eintragen
 * von 'opIncSynthetisch' in DATA_SUSPECT_LAMPS, G7 durch Entfernen der `firstPresent(opInc)===0`-
 * Bedingung. Protokoll im PR-Text.
 *
 * Usage:  node tests/scoring/opinc-gate-computed-margin.test.js   (Exit 0/1)
 */
const assert = require('node:assert/strict');
const axes = require('../../src/scoring/axes.js');
const lamps = require('../../src/scoring/lamps.js');
const { trackOf, phaseOf, cycleDamperFactor, isDataSuspect, scoreUniverse } = require('../../src/scoring/score.js');
const { profitTierOf } = require('../../src/scoring/profit-tier.js');
const { histOpInc, opIncSynthetic, norm } = require('../../src/scoring/snapshot.js');
const formulas = require('../../src/scoring/formulas/index.js');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + (e && e.message ? e.message : e)); }
}

const V = (a) => a.map((v) => (v === null ? null : { value: v }));
const MIO = 1e6;

/**
 * Ein Finanz-Snapshot mit SIEBEN Jahren OpInc/Bilanz — genug fuer roicStability
 * (ROIC_STAB_MIN_YEARS = 6). `label` ist die EINZIGE Variable zwischen den Zwillingen:
 * die Zahlenreihen sind byte-gleich. Wer G1 gruen sieht, hat damit bewiesen, dass die
 * Sperre am ETIKETT haengt und nicht an einer Eigenschaft der Zahlen.
 */
function mkFin(ticker, label, opInc, opts = {}) {
  const jahre = opInc.length;
  const rev = opts.rev || Array.from({ length: jahre }, (_, i) => (1000 - i * 40) * MIO);
  const assets = opts.assets || Array.from({ length: jahre }, (_, i) => (5000 - i * 150) * MIO);
  const curLiab = opts.curLiab || Array.from({ length: jahre }, () => 1000 * MIO);
  const s = {
    meta: { ticker, name: ticker + ' Capital', sector: 'Financial Services', industry: 'Capital Markets',
      region: 'US', exchangeName: 'NYSE', tradingCurrency: 'USD', opIncSource: label },
    marketCap: { value: 8000 * MIO },                 // TOP-LEVEL: gradeSnapshot liest genau hier
    metrics: { marketCap: { value: 8000 * MIO }, revenueTTM: { value: rev[0] } },
    annual: {
      annualRev: V(rev),
      annualOpInc: V(opInc),
      annualNetIncome: V(opts.netIncome || opInc.map((v) => (v === null ? null : v * 0.8))),
      annualBalance: assets.map((a, i) => ({ totalAssets: a, currentLiabilities: curLiab[i] })),
      annualOCF: V(opts.ocf || opInc.map((v) => (v === null ? null : v * 1.1))),
      annualFCF: V(opts.fcf || opInc.map((v) => (v === null ? null : v * 0.9))),
    },
    timeseries: {},
  };
  if (opts.secAnnual) s.secAnnual = opts.secAnnual;
  return s;
}

// Die Synthetik-Signatur: EINE Marge auf alle Jahre. Genau so entsteht 'computed-margin'.
const MARGE = 0.25;
const REV7 = Array.from({ length: 7 }, (_, i) => (1000 - i * 40) * MIO);
const SYNTH7 = REV7.map((r) => r * MARGE);

// ═══ G1 — B1: das harte Gate, in beide Richtungen ════════════════════════════════════════
test('G1a synthetische Reihe -> capitalEfficiency null UND roicStability null', () => {
  const s = mkFin('SYN', 'computed-margin', SYNTH7);
  assert.equal(opIncSynthetic(s), true, 'Vorbedingung: als synthetisch erkannt');
  assert.deepEqual(histOpInc(s), [], 'Vorbedingung: histOpInc liefert die leere Historie');
  assert.equal(axes.capitalEfficiency(s), null, 'capitalEfficiency muss gesperrt sein');
  assert.equal(axes.roicStability(s), null, 'roicStability muss gesperrt sein');
  assert.equal(lamps.lowRoic(s), null, 'die ROIC-Anzeige-Lampe liest dieselbe Quelle und faellt mit');
});

test('G1b GEGENRICHTUNG: byte-gleiche Zahlen mit ehrlichem Etikett -> beide Achsen rechnen', () => {
  const s = mkFin('ECHT', 'yahoo-adjusted', SYNTH7);
  assert.equal(opIncSynthetic(s), false);
  assert.equal(histOpInc(s).length, 7, 'die Historie steht zur Verfuegung');
  assert.ok(Number.isFinite(axes.capitalEfficiency(s)), 'capitalEfficiency muss hier rechnen — sonst sperrt das Gate zu viel');
  assert.ok(Number.isFinite(axes.roicStability(s)), 'roicStability muss hier rechnen (7 gepaarte Jahre)');
  assert.equal(typeof lamps.lowRoic(s), 'boolean');
});

test('G1c ein FEHLENDES Etikett gilt nie als synthetisch (Alt-Snapshots verlieren nichts)', () => {
  const s = mkFin('ALT', undefined, SYNTH7);
  delete s.meta.opIncSource;
  assert.equal(opIncSynthetic(s), false);
  assert.equal(histOpInc(s).length, 7);
  assert.ok(Number.isFinite(axes.capitalEfficiency(s)));
});

// ═══ G2 — K2.1: der Track-Split bleibt am aktuellen Vorzeichen ═══════════════════════════
const FIN = formulas.financials;
test('G2a synthetische Reihe mit POSITIVER Marge -> Track bleibt profitable', () => {
  const s = mkFin('SYNP', 'computed-margin', SYNTH7);
  assert.equal(trackOf(s, FIN), 'profitable',
    'K2-Auflage 1: das Vorzeichen der realen TTM-Marge darf den Track weiter speisen');
});

test('G2b synthetische Reihe mit NEGATIVER Marge -> Track unprofitable (nicht der Default)', () => {
  const s = mkFin('SYNN', 'computed-margin', REV7.map((r) => -r * MARGE),
    { netIncome: REV7.map((r) => -r * 0.2) });
  assert.equal(trackOf(s, FIN), 'unprofitable',
    'ein gesperrter Track-Split waere ueber die NetIncome-Rescue gelaufen und haette hier still ein anderes Ergebnis geliefert');
  // Und der Beweis, dass wirklich die OpInc-Reihe geantwortet hat und nicht zufaellig NetIncome:
  const t = mkFin('SYNX', 'computed-margin', REV7.map((r) => -r * MARGE),
    { netIncome: REV7.map((r) => r * 0.2) }); // NetIncome POSITIV, OpInc negativ
  assert.equal(trackOf(t, FIN), 'unprofitable',
    'bei widersprechendem NetIncome muss die OpInc-Reihe entscheiden — sonst liest der Split gar nicht mehr das Vorzeichen');
});

// ═══ G3 — B3/K3: die Synthetik-Ausnahme der Laengenregel ═════════════════════════════════
// Eine ECHTE, KURZE SEC-Serie (2 Jahre) gegen eine SYNTHETISCHE, LANGE Yahoo-Reihe (7 Jahre).
const SEC2 = {
  annualOpInc: V([120 * MIO, 100 * MIO]),
  annualAssets: V([4000 * MIO, 3800 * MIO]),
  annualCurrentLiabilities: V([900 * MIO, 850 * MIO]),
};
test('G3a gegen Synthetik gewinnt die echte SEC-Serie trotz geringerer Laenge', () => {
  const s = mkFin('BTBTLIKE', 'computed-margin', SYNTH7, { secAnnual: SEC2 });
  const src = axes.roicStabilitySource(s);
  assert.equal(src._source, 'sec', 'K3-Auflage 2: Synthetik ist kein Laengen-Konkurrent');
  assert.equal(src.opInc.length, 2);
  assert.ok(Number.isFinite(axes.capitalEfficiency(s)),
    'die kurze ECHTE Serie darf capitalEfficiency speisen (K3-Auflage 4)');
});

test('G3b GEGENRICHTUNG: gegen eine ECHTE Yahoo-Reihe bleibt die Laengenbedingung scharf', () => {
  const s = mkFin('LANGECHT', 'yahoo-adjusted', SYNTH7, { secAnnual: SEC2 });
  assert.equal(axes.roicStabilitySource(s)._source, 'yahoo',
    'der Duenne-Serien-Schutz darf NICHT mitgelockert werden — 2 < 7');
});

test('G3c der Single-Source-Trio-Guard bleibt unangetastet (K3-Auflage 1)', () => {
  // Tiefe OpInc da, tiefe Bilanz fehlt -> KEIN SEC-Trio, also Yahoo. Auch gegen Synthetik.
  const ohneBilanz = mkFin('TRIO', 'computed-margin', SYNTH7, { secAnnual: { annualOpInc: V([120 * MIO, 100 * MIO]) } });
  assert.equal(axes.roicStabilitySource(ohneBilanz)._source, 'yahoo',
    'ohne vollstaendiges Trio darf nie gemischt werden');
  // Index-0-Guard: fuehrende Luecke in der tiefen OpInc -> ebenfalls Yahoo.
  const luecke = mkFin('IDX0', 'computed-margin', SYNTH7, {
    secAnnual: { annualOpInc: V([null, 100 * MIO]), annualAssets: SEC2.annualAssets, annualCurrentLiabilities: SEC2.annualCurrentLiabilities },
  });
  assert.equal(axes.roicStabilitySource(luecke)._source, 'yahoo', 'Index-0-Guard bleibt scharf');
  // Und beide landen dann im GATE (Yahoo-Reihe ist synthetisch) — keine Hintertuer.
  assert.equal(axes.capitalEfficiency(ohneBilanz), null);
  assert.equal(axes.capitalEfficiency(luecke), null);
});

// ═══ G4 — B2/B4: Herkunfts-Lampen kennzeichnen, sie excludieren NICHT ════════════════════
test('G4a die Herkunfts-Lampen brennen und tragen ehrliche Werte', () => {
  const syn = mkFin('L1', 'computed-margin', SYNTH7);
  const yah = mkFin('L2', 'yahoo-adjusted', SYNTH7);
  const sec = mkFin('L3', 'sec-gaap', SYNTH7);
  const ohne = mkFin('L4', undefined, SYNTH7); delete ohne.meta.opIncSource;
  assert.equal(lamps.evaluateLamps(syn).flags.opIncSynthetisch, true);
  assert.equal(lamps.evaluateLamps(yah).flags.opIncSynthetisch, false);
  assert.equal(lamps.evaluateLamps(yah).flags.opIncYahooAdjusted, true);
  assert.equal(lamps.evaluateLamps(sec).flags.opIncYahooAdjusted, false);
  assert.equal(lamps.evaluateLamps(ohne).flags.opIncSynthetisch, null, 'ohne Etikett: nicht bewertbar, nicht "false"');
  assert.equal(lamps.evaluateLamps(ohne).flags.opIncYahooAdjusted, null);
});

test('G4b KERN-AUFLAGE K2.3: die Herkunfts-Lampen excludieren nicht', () => {
  const syn = mkFin('X1', 'computed-margin', SYNTH7);
  const aktiv = lamps.evaluateLamps(syn).active;
  assert.ok(aktiv.includes('opIncSynthetisch'), 'Vorbedingung: die Lampe brennt ueberhaupt');
  // Der Anker ist die KOPPLUNG Lampe->Exclude, nicht der Grade-Pfad daneben: dieselbe Zeile
  // einmal MIT und einmal OHNE die beiden Herkunfts-Lampen muss dasselbe Urteil bekommen.
  // Traegt eine der beiden in DATA_SUSPECT_LAMPS ein, weichen die Ergebnisse auseinander.
  const ohne = aktiv.filter((l) => l !== 'opIncSynthetisch' && l !== 'opIncYahooAdjusted');
  assert.equal(isDataSuspect(syn, aktiv, 'route'), isDataSuspect(syn, ohne, 'route'),
    'in DATA_SUSPECT_LAMPS waere die Lampe ein 300-Zeilen-Exclude durch die Hintertuer (Urteil K2.3)');
  assert.equal(isDataSuspect(syn, ['opIncSynthetisch', 'opIncYahooAdjusted'], 'route'),
    isDataSuspect(syn, [], 'route'));
  // Und die Fabrikations-Lampen excludieren weiterhin — sonst prueft die Assertion nichts.
  assert.equal(isDataSuspect(syn, ['newestQtrSuspect'], 'route'), true,
    'Gegenprobe: der echte Exclude-Pfad lebt noch');
});

test('G4c eine synthetische Zeile mit anderen tragenden Achsen bleibt geroutet und behaelt Score', () => {
  // Kohorte gross genug fuer eine eigene Verteilung; die Ziel-Zeile traegt Umsatzachsen.
  const universum = [];
  for (let i = 0; i < 20; i++) {
    const rev = [(900 + i * 25) * MIO, (700 + i * 20) * MIO, (600 + i * 18) * MIO, (500 + i * 15) * MIO];
    universum.push(mkFin('P' + i, 'yahoo-adjusted', rev.map((r) => r * 0.2), { rev }));
  }
  const revZ = [1200 * MIO, 800 * MIO, 650 * MIO, 520 * MIO];
  const ziel = mkFin('ZIEL', 'computed-margin', revZ.map((r) => r * MARGE), { rev: revZ });
  // Der byte-gleiche Zwilling mit ehrlichem Etikett ist die Messlatte: das ETIKETT allein
  // darf das Routing nicht aendern. Damit haengt die Assertion nicht am Grade-Pfad daneben.
  const zwilling = mkFin('ZWIL', 'yahoo-adjusted', revZ.map((r) => r * MARGE), { rev: revZ });
  universum.push(ziel, zwilling);
  const alle = scoreUniverse(universum, formulas, {});
  const r = alle.find((x) => x.ticker === 'ZIEL');
  const z = alle.find((x) => x.ticker === 'ZWIL');
  assert.ok(r && z, 'beide Zeilen existieren im Ergebnis');
  assert.equal(z.action, 'route', 'Vorbedingung: der ehrlich etikettierte Zwilling routet');
  assert.equal(r.action, 'route', 'die Herkunfts-Lampe darf die Zeile nicht aus dem Ranking werfen');
  assert.ok(Number.isFinite(r.score), 'Restscore aus den ECHTEN Achsen bleibt erhalten (K2-Auflage 6)');
  assert.ok(r.lamps.includes('opIncSynthetisch'), 'und die Kennzeichnung ist an der Zeile sichtbar');
  const capEff = r._axes.find((a) => a.key === 'capitalEfficiency');
  assert.equal(capEff.pct, null, 'die gesperrte Achse traegt kein Perzentil');
  const capEffZ = z._axes.find((a) => a.key === 'capitalEfficiency');
  assert.ok(capEffZ.pct !== null, 'Gegenprobe: beim Zwilling traegt dieselbe Achse ein Perzentil');
  assert.ok(r.coverageWeight < z.coverageWeight, 'renorm-on-drop hat gegriffen, kein Fake-50');
});

// ═══ G5 — K3.4/R3: roicStability bleibt unter sechs gepaarten Jahren null ════════════════
test('G5 roicStability: 5 gepaarte Jahre -> null, 6 -> Wert (echte Quelle)', () => {
  const rev5 = REV7.slice(0, 5), rev6 = REV7.slice(0, 6);
  const f5 = mkFin('J5', 'yahoo-adjusted', rev5.map((r, i) => r * (0.2 + i * 0.01)), { rev: rev5 });
  const f6 = mkFin('J6', 'yahoo-adjusted', rev6.map((r, i) => r * (0.2 + i * 0.01)), { rev: rev6 });
  assert.equal(axes.roicStability(f5), null, 'unter sechs gepaarten Jahren bleibt die Achse null');
  assert.ok(Number.isFinite(axes.roicStability(f6)), 'ab sechs rechnet sie — sonst prueft die Zeile darueber nichts');
});

// ═══ G6 — K2.2: die uebrigen historischen Verbraucher ════════════════════════════════════
test('G6a Profitphase und Profit-Stufe kommen bei Synthetik aus NetIncome, nicht aus der Fiktion', () => {
  // OpInc synthetisch DURCHGEHEND positiv, NetIncome mit einem echten Verlustjahr.
  const ni = [200 * MIO, -50 * MIO, 150 * MIO, 120 * MIO, 110 * MIO, 100 * MIO, 90 * MIO];
  const syn = mkFin('PH1', 'computed-margin', SYNTH7, { netIncome: ni });
  const ech = mkFin('PH2', 'yahoo-adjusted', SYNTH7, { netIncome: ni });
  assert.equal(phaseOf(ech), 'established', 'Gegenprobe: die echte, durchweg positive Reihe ergibt established');
  assert.equal(phaseOf(syn), 'inflected', 'die synthetische Reihe darf "nie ein Verlustjahr" nicht behaupten');
  assert.equal(profitTierOf(ech), 'langfristig-profitabel');
  assert.equal(profitTierOf(syn), 'seit-kurzem-profitabel',
    'Aufnahmeregel des Quality-Boards (quality-route.js) darf nicht auf Konstruktion beruhen');
});

test('G6b Zyklus-Daempfer: synthetische Reihe -> Faktor exakt 1.0', () => {
  // Eine Reihe mit echten Vorzeichenwechseln UND Umsatz-Drawdown — der Daempfer koennte feuern.
  const rev = [400 * MIO, 900 * MIO, 350 * MIO, 1000 * MIO, 300 * MIO, 950 * MIO];
  const op = [80 * MIO, -60 * MIO, 70 * MIO, -50 * MIO, 60 * MIO, -40 * MIO];
  const ech = mkFin('CY1', 'yahoo-adjusted', op, { rev });
  const syn = mkFin('CY2', 'computed-margin', op, { rev });
  assert.ok(cycleDamperFactor(ech, 0) < 1, 'Gegenprobe: die echte Reihe LOEST den Daempfer aus');
  assert.equal(cycleDamperFactor(syn, 0), 1, 'aus einer konstruierten Reihe darf kein Zyklus-Signal entstehen');
});

test('G6c burnAccelerating (und damit burnPressFactor) liest keine Synthetik', () => {
  const op = [-100 * MIO, -60 * MIO, -40 * MIO, -30 * MIO];
  const ocf = [-120 * MIO, -70 * MIO, -50 * MIO, -40 * MIO];
  const rev = [400 * MIO, 500 * MIO, 600 * MIO, 700 * MIO];
  const ech = mkFin('BA1', 'yahoo-adjusted', op, { rev, ocf });
  const syn = mkFin('BA2', 'computed-margin', op, { rev, ocf });
  assert.equal(lamps.burnAccelerating(ech), true, 'Gegenprobe: die echte Reihe loest die Lampe aus');
  assert.ok(lamps.burnPressFactor(ech) < 1, 'Gegenprobe: und der Faktor drueckt');
  assert.equal(lamps.burnAccelerating(syn), null, 'auf Synthetik ist die Vertiefung nicht bewertbar');
  assert.equal(lamps.burnPressFactor(syn), 1, 'kein Abzug aus Fiktion — aber auch kein Rescue');
});

test('G6d peakMargin und cyclePeak sind auf Synthetik nicht bewertbar', () => {
  // cyclePeak verlangt zusaetzlich !rising (m[0] <= m[1]) — ein echter, abgerollter Zyklus-Peak,
  // kein struktureller Durchbruch. Margen: 0.40 / 0.42 / 0.02 / 0.02 -> histRest 0.153.
  const rev = [1000 * MIO, 1000 * MIO, 1000 * MIO, 1000 * MIO];
  const spitze = [400 * MIO, 420 * MIO, 20 * MIO, 20 * MIO];
  const ech = mkFin('PK1', 'yahoo-adjusted', spitze, { rev });
  const syn = mkFin('PK2', 'computed-margin', spitze, { rev });
  assert.equal(lamps.peakMargin(ech), true, 'Gegenprobe: die echte Spitze feuert');
  assert.equal(lamps.cyclePeak(ech), true, 'Gegenprobe: und die schaerfere Variante auch');
  assert.equal(lamps.peakMargin(syn), null);
  assert.equal(lamps.cyclePeak(syn), null);
});

test('G6e ERLAUBT-Seite: die Vorzeichen-Lampe unprofit lebt auch auf Synthetik weiter', () => {
  const neg = mkFin('U1', 'computed-margin', REV7.map((r) => -r * MARGE), { netIncome: REV7.map((r) => -r * 0.2) });
  const pos = mkFin('U2', 'computed-margin', SYNTH7);
  assert.equal(lamps.unprofit(neg), true, 'das aktuelle Vorzeichen bleibt lesbar (K2-Auflage 1)');
  assert.equal(lamps.unprofit(pos), false);
});

// ═══ G7 — ENTSCHIED 16: Regressions-Pin der "Runde-4"-Null-Rettung ═══════════════════════
// A4-Konkordanz-Scan (29.08.): 140 Faelle mit OpInc==0 im juengsten Jahr, 20 davon mit
// negativem NetIncome. signTrack allein wuerde eine 0 zu 'profitable' routen; trackOf faengt
// den Fall ab und laesst NetIncome entscheiden (score.js, audit/fix Runde 4). Dieser Pin
// haelt den Pfad fest, damit ein Refactor ihn nicht still verliert.
test('G7a present-0 im juengsten OpInc-Jahr + negatives NetIncome -> unprofitable', () => {
  const s = mkFin('NULL0', 'yahoo-adjusted', [0, -28 * MIO, -72 * MIO, -71 * MIO],
    { netIncome: [-30 * MIO, -25 * MIO, -60 * MIO, -65 * MIO] });
  assert.equal(norm(s, 'annualOpInc')[0], 0, 'Vorbedingung: die 0 ist PRESENT, keine Luecke');
  assert.equal(trackOf(s, FIN), 'unprofitable',
    'Runde-4-Rettung: eine 0 ist Platzhalter/Breakeven-Ambiguitaet, kein belegtes profitable');
});

test('G7b Gegenprobe: dieselbe 0 mit POSITIVEM NetIncome bleibt profitable', () => {
  const s = mkFin('NULL1', 'yahoo-adjusted', [0, -28 * MIO, -72 * MIO, -71 * MIO],
    { netIncome: [30 * MIO, 25 * MIO, -60 * MIO, -65 * MIO] });
  assert.equal(trackOf(s, FIN), 'profitable',
    'die Rettung ersetzt das Vorzeichen, sie erzwingt kein unprofitable');
});

test('G7c die Rettung gilt AUCH auf synthetischen Reihen (Null-Klasse, ENTSCHIED 16)', () => {
  const s = mkFin('NULL2', 'computed-margin', [0, 0, 0, 0],
    { netIncome: [-30 * MIO, -25 * MIO, -60 * MIO, -65 * MIO] });
  assert.equal(trackOf(s, FIN), 'unprofitable',
    'die 20 Gefahrenfaelle (0-OpInc + negatives NetIncome) muessen korrekt geroutet bleiben');
});

test('G7d fuehrende LUECKE (nicht 0) faellt ebenfalls auf NetIncome zurueck', () => {
  const s = mkFin('LEAD', 'yahoo-adjusted', [null, -73 * MIO, -31 * MIO, -20 * MIO],
    { netIncome: [52 * MIO, -10 * MIO, -20 * MIO, -30 * MIO] });
  assert.equal(trackOf(s, FIN), 'profitable',
    'BH-081: ein 2 Jahre altes Verlustjahr darf nicht als "juengstes" gelten');
});

console.log(`\nopinc-gate-computed-margin.test.js: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);

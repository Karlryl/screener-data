'use strict';
/**
 * Vollboards im findash-Export (19.08.2026) — der Deckel wird festgenagelt.
 * ========================================================================
 * BEFUND: run-screener.js:545 kappt jede Board-Liste bei topN (Default 100, die CI ruft
 * ohne --topN). Von 8.908 bewerteten Firmen erreichten damit 1.940 die Oberflaeche; 6.968
 * waren weder abrufbar noch erwaehnt — ein Bruch der Direktive "nichts verschwindet".
 * Die vollen Kohorten liegen seit 2.3-A8 in outputs/hypergrowth/full/, wurden aber nie
 * publiziert (der Deploy kopierte hypergrowth nur flach, full/ fiel raus).
 *
 * ENTSCHIEDENER WEG: dieselben Mapper + dieselbe Rangvergabe schreiben die Vollkohorte
 * nach outputs/findash-export/v1/full/<branch>.json — kein zweites Format, kein neues
 * Feld, kein --topN-Flag. Die gekappte Datei bleibt der schnelle Erstaufschlag und darf
 * sich dabei NICHT aendern.
 *
 * Was hier festgenagelt wird (und was ohne den Fix bzw. nach einer Sabotage rot wird):
 *   1. v1/<branch>.json traegt exakt die 100 Zeilen der gekappten Quelle — der Deckel
 *      selbst war bis heute in keinem Test verankert.
 *   2. v1/full/<branch>.json traegt die volle Kohorte (150 im Fixture).
 *   3. Zeilen 1..100 sind in beiden TIEF gleich, inklusive rank — Karls Vergleichbarkeit.
 *   4. Die Raenge laufen in full/ ab 101 weiter; entrangte Zeilen (Belegbarkeits-Gate)
 *      verbrauchen keine Rangnummer, in beiden Dateien gleich.
 *   5. validateExport() (--check) prueft full/ als PFLICHT — eine fehlende full-Datei
 *      ist ein Verstoss, kein stiller Normalfall. Ein still fehlendes Vollboard sieht in
 *      findash aus wie ein leeres Board und ist der teuerste Fehlerfall.
 *   6. Ein fehlendes full/-Quellverzeichnis bricht laut ab (der versiegelte Schreiber
 *      legt es immer an; Abwesenheit waere eine Engine-Anomalie).
 *   7. Die auf den GEKAPPTEN Listen gemessenen Schwellen (Belegbarkeits-Warnung 40 %,
 *      Waehrungs-Waechter-Abbruch 25 %) duerfen sich durch den Zusatz-Feed nicht
 *      verschieben — sonst ist die eine Dauerlaerm und die andere ein Fehlalarm.
 *
 * Fixture-Groesse mit Absicht: 150 profitable / 60 unprofitable. Ein Fixture unter 100
 * Zeilen koennte eine Deckel-Sabotage gar nicht zeigen.
 *
 * Kein Netz, keine Frameworks, keine produktive Datei. Run: node tests/scoring/export-vollboard.test.js
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const wfe = require('../../scripts/write-findash-export.js');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'vollboard-'));
let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + (e && e.stack ? e.stack : e)); }
}
const tmpdir = (p) => fs.mkdtempSync(path.join(TMP, p));

const VOLL = 150;      // profitable je Kohorte im Fixture
const UNPROF = 60;     // unprofitable je Kohorte (unter dem Deckel -> nie gekappt)
const DECKEL = 100;    // topN-Default aus run-screener.js (produceRankings)

// Eine Engine-Zeile, wie sie in outputs/hypergrowth[/full]/<branch>.json steht.
// score faellt streng monoton (score.js byScore) — sonst trippt checkScoreDescending.
function zeile(i, track, gated) {
  return {
    ticker: 'T' + String(i).padStart(4, '0'),
    name: 'Firma ' + i,
    score: Math.round((99 - i * 0.1) * 10) / 10,
    track,
    lamps: [],
    overview: { kind: 'gp', value: 0.338, companion: 62.7 },
    country: 'United States', region: 'North America', sector: 'Industrials',
    marketCap: 1e10, phase: 'established', mcapBand: 'mid', mcapKlasse: 'mid',
    ipoRecency: 'mature', profitTier: 'langfristig-profitabel', ipoYear: 2010,
    cohortN: VOLL, cohortFallback: false,
    // Belegbarkeits-Gate (18.08.): unter 4 belegten Achsen faellt der Rang weg.
    coverageAxes: gated ? '3/7' : '7/7',
  };
}
// gatedBei: Praedikat (i) => bool, welche Zeilen entrangt werden sollen.
function kohorte(n, track, gatedBei) {
  return Array.from({ length: n }, (_, i) => zeile(i, track, gatedBei ? gatedBei(i) : false));
}

// Schreibt ein Quellverzeichnis-Paar: full/ mit der vollen Kohorte, capped/ mit dem
// EXAKTEN 100er-Praefix — genau die Beziehung, die produceRankings herstellt
// (tests/scoring/anchors.rank.test.js A8: Board == byte-gleiches topN-Praefix von full).
function quellen(gatedBei) {
  const hgFullDir = tmpdir('hg-full-');
  const hgDir = tmpdir('hg-capped-');
  for (const id of wfe.BRANCHES) {
    const voll = {
      profitable: kohorte(VOLL, 'profitable', gatedBei),
      unprofitable: kohorte(UNPROF, 'unprofitable', gatedBei),
    };
    const gekappt = {
      profitable: voll.profitable.slice(0, DECKEL),
      unprofitable: voll.unprofitable.slice(0, DECKEL),
    };
    fs.writeFileSync(path.join(hgFullDir, id + '.json'), JSON.stringify(voll));
    fs.writeFileSync(path.join(hgDir, id + '.json'), JSON.stringify(gekappt));
  }
  return { hgFullDir, hgDir };
}

// ── Baugruppe: sauberes Fixture (jede Zeile belegt) ─────────────────────────────────
const sauber = quellen(null);
const outSauber = tmpdir('out-sauber-');
wfe.buildFullBoards(null, { hgFullDir: sauber.hgFullDir, outFullDir: outSauber });
const gekapptSauber = wfe.buildBoard('industrials', null, { srcDir: sauber.hgDir });
const vollSauber = JSON.parse(fs.readFileSync(path.join(outSauber, 'industrials.json'), 'utf8'));

// ── 1. Der Deckel ───────────────────────────────────────────────────────────────────
test('1 Deckel: die gekappte Datei traegt exakt 100 profitable Zeilen', () => {
  assert.equal(gekapptSauber.profitable.length, DECKEL,
    'der topN-Deckel ist die Ursache des Befunds — er gehoert festgenagelt, nicht angenommen');
  assert.equal(gekapptSauber.unprofitable.length, UNPROF,
    'eine Liste unter dem Deckel darf nicht mit-gekappt werden');
});

// ── 2. Das Vollboard ────────────────────────────────────────────────────────────────
test('2 Vollboard: v1/full/<branch>.json traegt die ganze Kohorte (150), nicht die 100', () => {
  assert.equal(vollSauber.profitable.length, VOLL,
    'das Vollboard ist gekappt — genau der Fehler, den es beheben soll');
  assert.equal(vollSauber.unprofitable.length, UNPROF);
  assert.equal(vollSauber.branch, 'industrials');
  assert.equal(vollSauber.schema, wfe.SCHEMA, 'das Vollboard muss dieselbe Schema-Huelle tragen');
});

test('2b Vollboard: alle 13 Branchen geschrieben, kompakt (indent 0)', () => {
  for (const id of wfe.BRANCHES) {
    assert.ok(fs.existsSync(path.join(outSauber, id + '.json')), 'full/' + id + '.json fehlt');
  }
  const roh = fs.readFileSync(path.join(outSauber, 'industrials.json'), 'utf8');
  assert.ok(!roh.includes('\n'),
    'full/ ist ~5x groesser als das gekappte Board — indent 0, sonst blaeht der Nachlade-Feed');
});

// ── 3. Die ersten 100 sind tief gleich (inklusive rank) ─────────────────────────────
test('3 Paritaet: Zeilen 1..100 sind in beiden Dateien TIEF gleich, inklusive rank', () => {
  assert.deepEqual(vollSauber.profitable.slice(0, DECKEL), gekapptSauber.profitable,
    'der Erstaufschlag und der Kopf des Vollboards laufen auseinander — Karls Vergleichbarkeit ist gebrochen');
  assert.deepEqual(vollSauber.unprofitable, gekapptSauber.unprofitable);
});

test('3b Paritaet: dieselbe Zeile, nicht nur dieselbe Zahl (Ticker-Reihenfolge)', () => {
  assert.deepEqual(vollSauber.profitable.slice(0, DECKEL).map((r) => r.ticker),
    gekapptSauber.profitable.map((r) => r.ticker));
});

// ── 4. Raenge laufen weiter ─────────────────────────────────────────────────────────
test('4 Raenge: das Vollboard laeuft ab 101 weiter bis 150', () => {
  assert.equal(vollSauber.profitable[DECKEL].rank, DECKEL + 1,
    'Rang 101 ist der Kern des Befunds: er war weder erreichbar noch erwaehnt');
  assert.equal(vollSauber.profitable[VOLL - 1].rank, VOLL);
  assert.deepEqual(vollSauber.profitable.map((r) => r.rank),
    Array.from({ length: VOLL }, (_, i) => i + 1));
});

// Entrangte Zeilen (Belegbarkeits-Gate) verbrauchen KEINE Rangnummer — in beiden Dateien
// identisch, sonst waere der Kopf des Vollboards gegen die gekappte Datei verschoben.
const mitGate = quellen((i) => i % 10 === 9); // 15 von 150 entrangt = 10 %, unter der 40-%-Warnschwelle
const outGate = tmpdir('out-gate-');
wfe.buildFullBoards(null, { hgFullDir: mitGate.hgFullDir, outFullDir: outGate });
const gekapptGate = wfe.buildBoard('industrials', null, { srcDir: mitGate.hgDir });
const vollGate = JSON.parse(fs.readFileSync(path.join(outGate, 'industrials.json'), 'utf8'));

test('4b Raenge: entrangte Zeilen (rankGrund) verbrauchen keine Rangnummer — lueckenlos 1..k', () => {
  let soll = 0;
  vollGate.profitable.forEach((r, i) => {
    if (i % 10 === 9) {
      assert.equal(r.rank, null, 'Zeile ' + i + ' ist unbelegt und darf keinen Rang tragen');
      assert.equal(r.rankGrund, 'zuWenigBelegteAchsen');
    } else {
      soll++;
      assert.equal(r.rank, soll, 'Rangfolge hat ein Loch bei Index ' + i);
      assert.equal(r.rankGrund, null);
    }
  });
  assert.equal(soll, VOLL - 15, 'genau 15 Zeilen muessen entrangt sein — sonst beisst die Probe nicht');
});

test('4c Raenge: mit Gate bleiben die ersten 100 Zeilen weiter TIEF gleich', () => {
  assert.deepEqual(vollGate.profitable.slice(0, DECKEL), gekapptGate.profitable);
  const letzterGekappt = gekapptGate.profitable.filter((r) => r.rank !== null).pop().rank;
  const hoechsterVoll = vollGate.profitable.filter((r) => r.rank !== null).pop().rank;
  assert.ok(hoechsterVoll > letzterGekappt,
    'das Vollboard muss ueber den letzten Rang der gekappten Datei hinauslaufen ('
    + hoechsterVoll + ' vs ' + letzterGekappt + ')');
});

// ── 5. Der Gate: full/ ist Pflicht ──────────────────────────────────────────────────
test('5 Gate: validateExport() meldet fuer JEDE fehlende full-Datei einen Verstoss', () => {
  const leer = tmpdir('out-leer-');
  const errs = wfe.validateExport(leer);
  const fullErrs = errs.filter((e) => String(e).startsWith('full/'));
  assert.equal(fullErrs.length, wfe.BRANCHES.length,
    'ein still fehlendes Vollboard sieht in findash aus wie ein leeres Board — --check muss es fangen: '
    + JSON.stringify(fullErrs));
});

test('5b Gate: liegen alle 13 Vollboards da, verstummt der full/-Alarm', () => {
  const out = tmpdir('out-voll-');
  wfe.buildFullBoards(null, { hgFullDir: sauber.hgFullDir, outFullDir: path.join(out, 'full') });
  const errs = wfe.validateExport(out).filter((e) => String(e).startsWith('full/'));
  assert.deepEqual(errs, [], 'ein vollstaendiges full/ darf den Gate nicht rot faerben: ' + JSON.stringify(errs));
});

test('5c Gate: eine EINZELNE geloeschte full-Datei wird rot (nicht nur der Total-Ausfall)', () => {
  const out = tmpdir('out-luecke-');
  wfe.buildFullBoards(null, { hgFullDir: sauber.hgFullDir, outFullDir: path.join(out, 'full') });
  fs.unlinkSync(path.join(out, 'full', 'energy.json'));
  const errs = wfe.validateExport(out).filter((e) => String(e).startsWith('full/'));
  assert.equal(errs.length, 1, 'genau der fehlende Branch muss gemeldet werden: ' + JSON.stringify(errs));
  assert.ok(/energy/.test(errs[0]), 'der Verstoss benennt den falschen Branch: ' + errs[0]);
});

test('5d Gate: ein manipuliertes Vollboard (kaputte Zeile) wird rot, mit full/-Praefix', () => {
  const out = tmpdir('out-tamper-');
  const fullDir = path.join(out, 'full');
  wfe.buildFullBoards(null, { hgFullDir: sauber.hgFullDir, outFullDir: fullDir });
  const p = path.join(fullDir, 'materials.json');
  const b = JSON.parse(fs.readFileSync(p, 'utf8'));
  delete b.profitable[3].ticker;
  fs.writeFileSync(p, JSON.stringify(b));
  const errs = wfe.validateExport(out).filter((e) => String(e).startsWith('full/'));
  assert.ok(errs.length > 0, 'eine kaputte Zeile im Vollboard bleibt unbemerkt');
  assert.ok(errs.every((e) => e.startsWith('full/')),
    'der Alarmkanal muss ein full/-Problem von einem Board-Problem unterscheiden koennen');
});

// ── 6. Fehlende Quelle ist eine Anomalie, kein Normalfall ───────────────────────────
test('6 fail-loud: fehlendes full/-Quellverzeichnis bricht ab statt still leer zu liefern', () => {
  const out = tmpdir('out-noquelle-');
  assert.throws(() => wfe.buildFullBoards(null, { hgFullDir: path.join(TMP, 'gibtsnicht'), outFullDir: out }),
    'der versiegelte run-screener schreibt full/ immer — Abwesenheit ist eine Engine-Anomalie und muss laut sein');
});

test('6b fail-loud: fehlt EINE Quelldatei, bricht der Bau ab', () => {
  const q = quellen(null);
  fs.unlinkSync(path.join(q.hgFullDir, 'utilities.json'));
  assert.throws(() => wfe.buildFullBoards(null, { hgFullDir: q.hgFullDir, outFullDir: tmpdir('out-teil-') }),
    'ein halb geschriebenes Vollboard-Verzeichnis darf nicht als Erfolg durchgehen');
});

// Reviewer-Befund 19.08. (MITTEL, reproduziert): der Bau schreibt sequenziell; ein Wurf im
// 13. Branch liess 12 frische Dateien liegen. Frueher benannte dieser Test das als "kein
// Teil-Export" — das war schlicht falsch. Garantiert ist etwas anderes und Wichtigeres: was
// nach einem Abbruch dort liegt, stammt IMMER aus diesem Lauf. Ein stehen gebliebenes
// Vollboard des Vorlaufs wuerde sonst neben den frischen liegen, und niemand saehe den
// Vintage-Bruch (dieselbe Klasse wie F11 bei quality/).
test('6c Frische: ein abgebrochener Lauf laesst KEINE Datei des Vorlaufs stehen', () => {
  const out = tmpdir('out-stale-');
  wfe.buildFullBoards(null, { hgFullDir: sauber.hgFullDir, outFullDir: out }); // Vorlauf: 13 Dateien
  assert.equal(fs.readdirSync(out).length, wfe.BRANCHES.length, 'Vorlauf hat nicht vollstaendig geschrieben');
  const kaputt = quellen(null);
  fs.unlinkSync(path.join(kaputt.hgFullDir, 'consumer-discretionary.json')); // erster Branch -> Wurf sofort
  assert.throws(() => wfe.buildFullBoards(null, { hgFullDir: kaputt.hgFullDir, outFullDir: out }));
  assert.deepEqual(fs.readdirSync(out), [],
    'Dateien des Vorlaufs haben den Abbruch ueberlebt und wuerden als frisch weiter-serviert: '
    + JSON.stringify(fs.readdirSync(out)));
});

// ── 7. Gemessene Schwellen bleiben auf den gekappten Listen ─────────────────────────
// Die 40-%-Warnung des Belegbarkeits-Gates wurde auf den Branchen-Boards gemessen
// (Maximum 16.08.: financials/profitable 36,4 %). Im Tail einer Vollkohorte ist duenne
// Abdeckung normal — feuerte sie dort, waere sie binnen einer Nacht Dauerlaerm und
// niemand laese sie mehr. Alarm-Ermuedung ist ein echter Schaden.
function mitWarnungen(fn) {
  const echt = console.warn;
  const gesehen = [];
  console.warn = (...a) => gesehen.push(a.join(' '));
  try { fn(); } finally { console.warn = echt; }
  return gesehen;
}
const vieleUnbelegt = quellen((i) => i % 2 === 0); // 50 % entrangt, ueber der 40-%-Schwelle

test('7 Alarm: die Belegbarkeits-Warnung feuert NICHT auf den Vollboards', () => {
  const w = mitWarnungen(() => wfe.buildFullBoards(null,
    { hgFullDir: vieleUnbelegt.hgFullDir, outFullDir: tmpdir('out-warn-') }));
  const belegWarn = w.filter((x) => /Belegbarkeits-Gate/.test(x));
  assert.deepEqual(belegWarn, [],
    'die Schwelle wurde auf den gekappten Listen gemessen — im Vollkohorten-Tail waere sie Dauerlaerm: '
    + JSON.stringify(belegWarn));
});

test('7b Alarm: auf der gekappten Liste feuert dieselbe Warnung weiter (nicht global abgeschaltet)', () => {
  const w = mitWarnungen(() => wfe.buildBoard('industrials', null, { srcDir: vieleUnbelegt.hgDir }));
  assert.ok(w.some((x) => /Belegbarkeits-Gate/.test(x)),
    'die Warnung wurde ueberall abgeschaltet statt nur auf den Vollboards — der Waechter ist tot');
});

test('7c Alarm: die Vollboards zaehlen NICHT in die Bilanz des Waehrungs-Waechters', () => {
  const vorher = wfe.waehrungsWaechterBilanz();
  wfe.buildFullBoards(null, { hgFullDir: sauber.hgFullDir, outFullDir: tmpdir('out-fx-') });
  const nachher = wfe.waehrungsWaechterBilanz();
  assert.deepEqual(nachher, vorher,
    'die 25-%-Abbruchgrenze wurde auf den gekappten Listen gemessen; ~7.000 Tail-Zeilen im Nenner '
    + 'verschoeben eine gemessene Grenze und koennten den ganzen Export kippen');
});

// Reviewer-Befund 19.08. (HOCH): die Zaehler herausrechnen UND nichts melden hiesse, dass ein
// Beleg-Ausfall, der nur den Tail trifft, voellig unhoerbar bliebe. Der Bau meldet deshalb eine
// EIGENE Bilanz (ohne eigene Abbruchgrenze — die waere auf dieser Grundgesamtheit geraten).
test('7e Alarm: die Vollboards melden ihre EIGENE Waehrungs-Bilanz (Tail bleibt messbar)', () => {
  const w = mitWarnungen(() => {
    const r = wfe.buildFullBoards(null, { hgFullDir: sauber.hgFullDir, outFullDir: tmpdir('out-bilanz-') });
    // Ohne Snapshots ist kein Beleg fuehrbar: jede der 13x(150+60) Zeilen wird genullt.
    assert.equal(r.mcapGenullt.geprueft, wfe.BRANCHES.length * (VOLL + UNPROF),
      'die gemeldete Bilanz zaehlt nicht die Vollboard-Zeilen');
    assert.equal(r.mcapGenullt.genullt, r.mcapGenullt.geprueft);
  });
  assert.ok(w.some((x) => /Waehrungs-Waechter \(Vollboards/.test(x)),
    'der Tail-Ausfall wird still verschluckt — genau der Befund, der das hier ausgeloest hat: '
    + JSON.stringify(w));
});

test('7d Alarm: die Vollboard-Zeilen tragen den Waehrungsbeleg trotzdem (nur die BILANZ ist getrennt)', () => {
  // Ohne Snapshots ist kein Beleg fuehrbar -> marketCap wird genullt. Genau wie in der
  // gekappten Datei; sonst waere Pruefung 3 gar nicht erfuellbar.
  assert.equal(vollSauber.profitable[0].marketCapCurrency, 'USD');
  assert.equal(vollSauber.profitable[0].marketCap, gekapptSauber.profitable[0].marketCap);
});

// ── Sabotage-Protokoll (19.08.2026, vor "fertig" ausgefuehrt, gemessen) ────────────
// (a) slice(0, DECKEL) in den full-Pfad eingebaut  -> 14 ok / 4 fail: 2, 4, 4b, 4c rot.
//     Pruefung 3 blieb GRUEN — sie prueft die Gleichheit des PRAEFIX, und die haelt ein
//     gekapptes Vollboard trivial ein. Genau deshalb steht Pruefung 2 daneben: Paritaet
//     allein kann den Deckel nicht sehen. 5b/5d blieben ebenfalls gruen — ein gekapptes
//     Vollboard ist schema-konform; der Gate prueft Form, nicht Vollstaendigkeit der
//     Kohorte. Das ist die Arbeitsteilung, nicht ein Loch.
// (b) den full-Zweig aus validateExport() ausgebaut -> 15 ok / 3 fail: 5, 5c, 5d rot.
//     5b blieb gruen, richtig so: es ist die Positiv-Kontrolle (KEIN full/-Alarm), kein
//     Melder.
// (c) die Belegbarkeits-Warnung global statt nur auf den Vollboards abgeschaltet
//     -> 17 ok / 1 fail: 7b rot. Der Waechter haengt an der SACHE (feuert die Warnung
//     dort weiter, wo sie gemessen wurde), nicht an einem Schreibmuster.
// (d) das Leeren des Zielverzeichnisses (fs.rmSync) ausgebaut -> 19 ok / 1 fail: 6c rot
//     (Dateien des Vorlaufs ueberleben einen Abbruch). Reviewer-Befund, nachgebaut.
// (e) die eigene Waehrungs-Bilanz der Vollboards stummgeschaltet -> 19 ok / 1 fail: 7e rot.
// Alle fuenf zurueckgebaut, danach 20 ok / 0 fail.

fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\nexport-vollboard.test.js: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);

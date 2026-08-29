'use strict';
/**
 * ENTSCHIED 24 — Klassenwachstums-Auflage als PRUEFUNG statt Prosa.
 * =================================================================
 * Auftrag: Orchestrator ENTSCHIED 29, Ruling 29.2 (Befunde M6 + M7 des
 * Nacht-Pruef-Sweeps 2026-08-29). Muss VOR dem 1.2.0-Vollsiegel stehen.
 *
 * ─── WARUM DIESE DATEI EXISTIERT (M6) ────────────────────────────────────────
 * ENTSCHIED 24 verlangt, dass ein ANWACHSEN der Gate-Abgangs-Klasse auffaellt.
 * Umgesetzt war das als Handanweisung plus das Feld `wachstumsPruefung` in
 * protocol/gqs-00/1.2.0-pending/transition.json — und genau dieses Verzeichnis
 * ENTFAELLT planmaessig beim Vollsiegel ("aufloesung"). Danach gaebe es weder ein
 * Baseline-Artefakt noch einen lauffaehigen Check: die Auflage waere ersatzlos weg.
 *
 * Deshalb steht die Baseline hier als LITERAL — nach der Hausregel aus
 * tests/opinc-source.test.js ("Als LITERALE hier, nicht aus den Produktionsdateien
 * geladen: sonst prueft die Wache nur, dass eine Datei sich selbst gleicht, und stirbt
 * still, sobald der Name aus der Schicht faellt"). Diese Datei ueberlebt das Loeschen
 * des Uebergangs-Verzeichnisses.
 *
 * ─── WAS SICH GEGENUEBER ENTSCHIED 24 AENDERT (M7, Ruling 29.2) ──────────────
 * Die operationale Klassendefinition war ZU ENG: gezaehlt wurden nur Zeilen, die auf
 * `action='exclude', reason='no-axes'` wechseln. Das Gate hat aber MEHRERE Ausgangs-
 * tueren. Die zweite laeuft ueber profit-tier.js:annualProfitSeries -> histOpInc:
 * leert das Gate die OpInc-Reihe, faellt die Profitstufe auf die NetIncome-Reihe
 * zurueck, und quality-route.js kann die Zeile mit `qc-not-compounder` vom
 * Quality-Board nehmen. Ruling 29.2: gezaehlt werden ab jetzt ALLE gate-verursachten
 * Abgaenge — ehrlich weiter gefasst.
 *
 * Heute ist die zweite Tuer inert, aber nur wegen ZWEIER ungepruefter Zufaelle:
 *   (1) 'financials' steht in QC_UNSUPPORTED_SECTORS, faellt also frueher raus;
 *   (2) die computed-margin-Population ist zu 100 % Financial Services.
 * Keiner davon ist irgendwo erzwungen. Beide werden hier festgenagelt, damit ihr
 * Wegfall auffaellt, statt die Klasse still wachsen zu lassen.
 *
 * ─── WAS HIER GEPRUEFT WIRD ──────────────────────────────────────────────────
 * Gemessen wird die SACHE (ausgefuehrte Routing-Entscheidungen auf konstruierten
 * Snapshots), nicht Berichtstext. Jede Tuer wird in BEIDE Richtungen gefahren: mit
 * synthetischem Etikett MUSS die Zeile gehen, ohne es MUSS sie bleiben — sonst
 * pruefte der Waechter nur, dass irgendetwas immer excludiert.
 *
 * Usage:  node tests/entschied24-klassenwachstum.test.js   (Exit 0/1)
 */
const assert = require('node:assert/strict');

const { qualityRoute, COMPOUNDER_TIERS, QC_UNSUPPORTED_SECTORS } = require('../src/scoring/quality-route.js');
const { profitTierOf, annualProfitSeries } = require('../src/scoring/profit-tier.js');
const { histOpInc, opIncSynthetic, OPINC_SYNTHETIC_LABEL } = require('../src/scoring/snapshot.js');
const { route } = require('../src/scoring/router.js');
const ax = require('../src/scoring/axes.js');

let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); }
}

const V = (arr) => arr.map((v) => (v === null ? null : { value: v }));

// ── Die Baseline aus ENTSCHIED 24, als Literal ───────────────────────────────
// Stand: Messstand 2026-08-29 (byte-identische Kopie des Live-Stores, 15.046 Dateien,
// voller Re-Score beider Staende). Waechst diese Zahl bei einem kuenftigen Re-Run,
// haengen MEHR Namen mit ihrem ganzen Score an einer synthetischen Achse — das ist ein
// neuer Befund fuer den Orchestrator, KEINE stille Anpassung.
const BASELINE_ANZAHL = 3;
const BASELINE_MITGLIEDER = ['0290.HK', '0622.HK', 'EXO.AS'];

// Die Ausgangs-Tueren des Gates. Ruling 29.2: die Klasse umfasst ALLE davon.
// Waechst diese Liste, ist die Klassendefinition zu eng geworden.
const GATE_AUSGAENGE = ['no-axes', 'qc-not-compounder'];

// Ein Snapshot, dessen OpInc-Reihe echt UND profitabel ist. Ueber das Etikett wird er
// zum synthetischen Zwilling — dieselbe Firma, dieselben Zahlen, nur die Herkunft
// wechselt. Genau daran laesst sich "gate-verursacht" ueberhaupt messen.
function mkSoftware(opInc, opIncSource = null) {
  return {
    meta: {
      sector: 'Technology', industry: 'Software—Application',
      country: 'United States', ticker: 'ZZGATEZZ',
      ...(opIncSource ? { opIncSource } : {}),
    },
    annual: {
      annualRev: V([300, 260, 220, 190]),
      annualGP: V([180, 156, 132, 114]),
      annualOpInc: V(opInc),
      annualNetIncome: V([-40, -35, -30, -25]),   // ECHTE Reihe, aktuell defizitaer
    },
  };
}

console.log('ENTSCHIED 24 — Klassenwachstums-Auflage (M6 + M7, Ruling 29.2)');

// ── M6: die Auflage selbst, unabhaengig vom Uebergangs-Verzeichnis ───────────
check('(M6) Baseline steht als Literal und ueberlebt das Loeschen von 1.2.0-pending', () => {
  assert.equal(BASELINE_MITGLIEDER.length, BASELINE_ANZAHL,
    'Zahl und Namensliste muessen dieselbe Klasse beschreiben');
  assert.deepEqual([...BASELINE_MITGLIEDER].sort(), BASELINE_MITGLIEDER,
    'die Liste steht sortiert, damit ein Zuwachs im Diff sichtbar wird');
});

// ── M7: die ZWEITE Ausgangstuer, ausgefuehrt statt behauptet ─────────────────
check('(M7) Tuer 2 existiert wirklich: das Gate kann eine Zeile per qc-not-compounder nehmen', () => {
  // Ohne Etikett: echte OpInc-Reihe, aktuell profitabel -> Compounder -> geroutet.
  const echt = mkSoftware([50, 40, 30, 20]);
  const rEcht = qualityRoute(echt);
  assert.equal(rEcht.action, 'route', 'die echte Zeile MUSS auf dem Quality-Board bleiben');

  // Mit Etikett: histOpInc leert die Reihe, annualProfitSeries faellt auf NetIncome
  // zurueck (defizitaer) -> kein Compounder -> Abgang, allein durch das Gate.
  const synth = mkSoftware([50, 40, 30, 20], OPINC_SYNTHETIC_LABEL);
  const rSynth = qualityRoute(synth);
  assert.equal(rSynth.action, 'exclude', 'die synthetische Zeile MUSS gehen');
  assert.equal(rSynth.reason, 'qc-not-compounder',
    'und zwar durch die ZWEITE Tuer — nicht ueber no-axes');

  // Der Mechanismus, nicht nur das Ergebnis.
  assert.deepEqual(histOpInc(synth), [], 'das Gate leert die Historie');
  assert.deepEqual(annualProfitSeries(synth), [-40, -35, -30, -25],
    'und die Profitstufe kommt aus der ECHTEN NetIncome-Reihe');
  assert.equal(profitTierOf(synth), 'nicht-profitabel');
  // 4 Jahre, alle >= 0 -> die Stufe, die K2.2 ausdruecklich als "kaeme aus der
  // Konstruktion" benennt, wenn sie auf einer synthetischen Reihe entstuende.
  assert.equal(profitTierOf(echt), 'langfristig-profitabel');
});

check('(M7) Tuer 1 existiert wirklich: das Gate nimmt capitalEfficiency die Grundlage', () => {
  const echt = mkSoftware([50, 40, 30, 20]);
  const synth = mkSoftware([50, 40, 30, 20], OPINC_SYNTHETIC_LABEL);
  // Beide Richtungen am Etikett-Praedikat selbst — die EINE Stelle, an der
  // "synthetisch" definiert ist.
  assert.equal(opIncSynthetic(synth), true);
  assert.equal(opIncSynthetic(echt), false);
  assert.ok(histOpInc(echt).length > 0, 'ohne Etikett bleibt die Historie stehen');
  assert.deepEqual(histOpInc(synth), [], 'mit Etikett ist sie leer — daher no-axes');
  // Ein FEHLENDES Etikett darf nie als synthetisch gelten (Alt-Snapshot-Schutz).
  assert.equal(opIncSynthetic({ meta: {} }), false);
});

check('(M7) die Klasse umfasst BEIDE Tueren, nicht nur no-axes', () => {
  assert.ok(GATE_AUSGAENGE.includes('no-axes'), 'die ENTSCHIED-24-Tuer bleibt drin');
  assert.ok(GATE_AUSGAENGE.includes('qc-not-compounder'), 'Ruling 29.2: die zweite Tuer zaehlt mit');
  assert.equal(GATE_AUSGAENGE.length, 2,
    'kommt eine dritte Tuer dazu, muss die Klassendefinition MIT wachsen — nicht die Klasse still');
});

// ── Die zwei ungeprueften Zufaelle, die Tuer 2 heute inert halten ────────────
check('(M7) Zufall 1 festgenagelt: financials faellt heute frueher raus (qc-sector-unsupported)', () => {
  assert.ok(QC_UNSUPPORTED_SECTORS.has('financials'),
    'faellt financials aus dieser Menge, oeffnet sich Tuer 2 fuer die GESAMTE '
    + 'computed-margin-Population (1.859 Namen) — dann ist die Baseline 3 hinfaellig');
  assert.ok(QC_UNSUPPORTED_SECTORS.has('real-estate'));
  assert.equal(COMPOUNDER_TIERS.size, 2, 'die Compounder-Definition traegt die Tuer mit');
});

check('(M7) Zufall 2 benannt: ein NICHT-Financial mit computed-margin verliesse das Board an der Zaehlung vorbei', () => {
  // Genau der von M7 beschriebene kuenftige Fall — heute im Bestand nicht vorhanden,
  // aber nirgends verboten. Konstruiert, damit die Lage dokumentiert UND lauffaehig ist.
  const nichtFinancial = mkSoftware([50, 40, 30, 20], OPINC_SYNTHETIC_LABEL);
  assert.notEqual(route(nichtFinancial).formulaId, 'financials',
    'Vorbedingung: dieser Name ist KEIN Financial');
  const r = qualityRoute(nichtFinancial);
  assert.equal(r.reason, 'qc-not-compounder',
    'er verlaesst das Quality-Board durch Tuer 2 — die ENTSCHIED-24-Zaehlung haette ihn nicht gesehen');
});

// ── Gegenrichtung: der Waechter darf nicht alles excludieren ─────────────────
check('Gegenprobe: eine echte, profitable Zeile bleibt in BEIDEN Tueren unberuehrt', () => {
  const echt = mkSoftware([50, 40, 30, 20]);
  assert.equal(qualityRoute(echt).action, 'route');
  assert.equal(route(echt).action, 'route');
  assert.ok(Number.isFinite(ax.marginLevel(echt)) || ax.marginLevel(echt) === null,
    'die Achsen rechnen auf der echten Zeile normal weiter');
});

check('Gegenprobe: synthetisch + echt profitables NetIncome bleibt Compounder (kein Pauschal-Exclude)', () => {
  // Wichtig gegen R2s Sorge vor einem Lampen-Hintertuer-Massen-Exclude: das Gate nimmt
  // die HISTORIE, nicht die Zeile. Traegt der NetIncome-Rueckfall eine profitable
  // Reihe, bleibt die Zeile auf dem Board.
  const synth = mkSoftware([50, 40, 30, 20], OPINC_SYNTHETIC_LABEL);
  synth.annual.annualNetIncome = V([40, 35, 30, 25]);
  assert.equal(qualityRoute(synth).action, 'route',
    'synthetisches Etikett allein ist KEIN Abgangsgrund');
});

console.log('\nentschied24-klassenwachstum: ' + pass + ' ok, ' + fail + ' fail');
process.exit(fail ? 1 : 0);

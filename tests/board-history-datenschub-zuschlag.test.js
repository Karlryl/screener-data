// tests/board-history-datenschub-zuschlag.test.js — Standalone-Runner (framework-los).
// Run: node tests/board-history-datenschub-zuschlag.test.js
//
// WOFUER: Waechter zur dritten Bruch-Klasse "daten-schub" (Gerichtsprotokoll
// _COURT-WERTGATE-BEWEGUNG-2026-09-02.md, ratifiziert 2026-09-02T13:23:01Z). Die beiden
// bestehenden Zweige decken nur ab, was SCHRUMPFT (board-history-massstabbruch.test.js)
// oder was eine LAMPE traegt (board-history-score-definitions-bruch.test.js). Ein benigner
// Datenschub — Voll-Pull mit frischen Quartalszahlen — verliert keine Zeile, aendert keine
// Definition und laesst die Kohorte WACHSEN (+34 / +5 / +31 am 02.09.). Beide Zweige
// greifen dort nicht; der Registereintrag Tag 1204 war inhaltlich richtig und mechanisch
// wirkungslos, drei Boards blieben SUSPECT und der Folgetag haette dieselben Spruenge
// erneut gemessen (Dauersperren-Klasse).
//
// DIE FORM IST ZUSCHLAG, NICHT AUSSCHLUSS: keine Zeile verlaesst das p99. Gewaehrt wird
// ausschliesslich der BEREITS BESTEHENDE Deckel THRESHOLD_MULTIPLIER x basisSchwelle
// (= 23,00 am Boden 11,50) — keine neue Zahl, keine Zahl aus dem Register. Drei Schranken
// haengen daran, und dieser Waechter nagelt genau sie fest, nicht die Ausnahme:
//   1. Faecherungs-Tor 8 % (WB-3): schmale Bewegung ja, breite Welle nein,
//   2. Integritaets-Vorrang (WB-4): eine Zeile, deren Integritaet ABBAUT, ist nie gedeckt,
//   3. Deckel (WB-2): eine Bewegung ueber 23,00 faellt weiterhin durch,
//   4. WB-9/BP-9: Zuschlag UND Blendung zugleich sind ausgeschlossen (harter Abbruch),
//   5. WB-5/WB-7: der Ausnahmetag hinterlaesst eine ZAEHLBARE, namentliche Spur,
//   6. WB-6: an einem Ausnahmetag wird KEIN Kalibrier-Sample genommen.
//
// WB-15 — DER BENANNTE BLINDE FLECK, in einer Zeile fuer den naechsten Leser:
//   Weiterhin verborgen bleibt EIN einzelner echter Wertfehler zwischen 11,50 und 23,00
//   Punkten, auf den namentlich registrierten Boards, in einer registrierten Nacht,
//   solange die Bewegung schmal bleibt (<8 % der Zeilen) und die Integritaet der Zeile
//   nicht abbaut. NICHT verborgen bleiben: jede Bewegung ueber 23,00 (Tag-938-Klasse),
//   jede breite Bewegung, jede Integritaets-Verschlechterung und saemtliche unbedingten
//   Pruefungen (cohort-empty, cohort-overlap-collapse, nan-break, coverage-collapse).
//
// SCOPING, ausdruecklich und bewusst (die einzige Auslegung dieses PR): der
// Integritaets-Vorrang haengt am DATENSCHUB-Arm — dort, wo der Zuschlag gewaehrt wuerde.
// Er faerbt weder auf fremde Boards noch auf gewoehnliche Tage noch auf den
// Schrumpfungs-Arm ab. Grund: WB-4 ist Auflage AUF dem Zuschlag ("Der Zuschlag deckt
// Bewegung, niemals Verfall"), und die Beschluss-Sperre §10 nennt den Schrumpfungs-Arm
// ausdruecklich als unveraendert. Die letzte Probe unten nagelt genau diese Grenze fest.
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const W = require('../scripts/write-board-history.js');

let fail = 0;
function check(name, fn) {
  try { fn(); console.log('  ok   ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + ': ' + (e && e.message || e)); }
}

const BODEN = W._const.MIN_GATE_THRESHOLD;                       // 11,50
const DECKEL = W._const.THRESHOLD_MULTIPLIER * BODEN;            // 23,00 — KEINE neue Zahl
const CAP = W._const.GATE_FANOUT_CAP;                            // 0,08
const GATE_BODEN = { dailyP99Samples: [], sampleDates: [], threshold: null, frozen: false };
const BOARD = 'energy';

// Eintrag wie im Register: Board namentlich, typ, KEINE Zahl.
const EINTRAG = { tag: 'Tag 1204', typ: 'daten-schub', letztesAltesVintage: '2026-09-01', boards: new Set([BOARD]), erklaerendeLampe: null };
const OHNE_TYP = { ...EINTRAG, typ: null };                       // Alt-Eintrag (Schrumpfungs-Form)
const ANDERER_TYP = { ...EINTRAG, typ: 'score-definitions-bruch' };

// ── Fixture: Kohorte WAECHST (genau der Fall, den der Schrumpfungs-Zweig nicht sieht) ──
// Eine Zeile traegt alles, was der Integritaets-Vorrang liest: coverageAxes, lamps und die
// PIT-Quellreihen. Default ist eine INTAKTE Zeile; Verfall wird gezielt aufgesetzt.
function zeile(ticker, score, ueberschreib) {
  const z = {
    ticker,
    score,
    coverageAxes: '6/7',
    lamps: ['peakMargin', 'opIncYahooAdjusted'],
    pit: {
      revenueQ: [120, 110, 100],
      revenueQEnds: ['2026-06-30', '2026-03-31', '2025-12-31'],
      grossProfitQ: [60, 55, 50],
      grossProfitQEnds: ['2026-06-30', '2026-03-31', '2025-12-31'],
    },
  };
  return Object.assign(z, ueberschreib || {});
}
const ZEILEN = 300;      // p99 nearest-rank: ceil(0,99*300)-1 = 296 -> viertgroesster Wert
const NEUE = 30;         // Wachstum: +30 Zeilen ohne Vorgaenger (nicht gematcht, kein Delta)

// bewegungen[i] wird auf Zeile T<i> gelegt, alle uebrigen bewegen sich um 0,30 (Median-Rauschen
// des realen 02.09.-Uebergangs). verfall setzt Felder auf der NACHHER-Zeile.
function lage(opt) {
  opt = opt || {};
  const zeilen = opt.zeilen != null ? opt.zeilen : ZEILEN;
  const neue = opt.neue != null ? opt.neue : NEUE;
  const weg = opt.weg || 0;                       // Zeilen, die der Vorgaenger hatte und heute fehlen
  const bewegungen = opt.bewegungen || [];
  const vorher = [], nachher = [];
  for (let i = 0; i < zeilen; i++) {
    vorher.push(zeile('T' + i, 50));
    if (i < weg) continue;                        // faellt aus der Kohorte -> nicht gematcht
    const d = i < bewegungen.length ? bewegungen[i] : 0.3;
    nachher.push(zeile('T' + i, 50 + d));
  }
  for (let i = 0; i < neue; i++) nachher.push(zeile('N' + i, 50));
  if (opt.verfall) {
    const ziel = nachher.find((r) => r.ticker === opt.verfall.ticker);
    assert.ok(ziel, 'Fixture-Fehler: Verfalls-Ticker ' + opt.verfall.ticker + ' nicht in der Kohorte');
    Object.assign(ziel, opt.verfall.felder);
  }
  const v = (rows) => ({ date: null, pitCoverage: { beta: 1 }, cohort: { profitable: rows, unprofitable: [] } });
  return { vorher: v(vorher), nachher: v(nachher) };
}
const gate = (l, bruch, board) => W.evaluateGate(l.nachher, l.vorher, GATE_BODEN, bruch, board === undefined ? BOARD : board);

// Schmale Welle: vier Zeilen ueber dem Boden, die groesste unter dem Deckel.
// Faecherung 4/300 = 1,33 % — in derselben Groessenordnung wie die realen 1,50/1,85/2,27 %.
const SCHMAL = [22.0, 21.0, 20.5, 20.0];

// ── Vorbedingung: ohne die neue Klasse ist genau dieser Uebergang gesperrt ───
check('VORBEDINGUNG: gewachsene Kohorte -> der Schrumpfungs-Zweig greift nicht, Board SUSPECT', () => {
  const l = lage({ bewegungen: SCHMAL });
  const g = gate(l, OHNE_TYP);
  assert.ok(l.nachher.cohort.profitable.length > l.vorher.cohort.profitable.length, 'Fixture muss WACHSEN');
  assert.strictEqual(g.bruchGrenze, null, 'ohne typ darf keine Grenze entstehen (Zustand vor dem Beschluss)');
  assert.ok(g.suspect, 'genau die Sperre, gegen die der Beschluss ergangen ist');
  assert.ok(g.reasons.includes('p99-delta-exceeds-threshold'), 'Grund: ' + g.reasons.join(','));
});

// ── BP-1 (WB-2, Anwesenheit) ─────────────────────────────────────────────────
check('BP-1: gueltiger daten-schub-Eintrag + schmale Bewegung -> Board besteht bei Schwelle 23,00', () => {
  const g = gate(lage({ bewegungen: SCHMAL }), EINTRAG);
  assert.ok(!g.suspect, 'suspect trotz gueltigem Eintrag: ' + g.reasons.join(','));
  assert.ok(g.bruchGrenze, 'kein Zuschlag gewaehrt');
  assert.strictEqual(g.bruchGrenze.typ, 'daten-schub');
  assert.strictEqual(g.bruchGrenze.tagesschwelle, DECKEL, 'Hoehe muss EXAKT der bestehende Deckel sein');
  assert.strictEqual(g.bruchGrenze.deckel, DECKEL);
  assert.strictEqual(g.bruchGrenze.allowance, DECKEL - BODEN, 'Zuschlag = Deckel - Boden');
  assert.strictEqual(g.wirksameSchwelle, DECKEL, 'angewandte Tagesschwelle');
  assert.strictEqual(g.p99Delta, 20.0, 'p99 = viertgroesste Bewegung');
});

check('BP-1b: KEINE Zeile verlaesst das p99 (Zuschlag, nicht Ausschluss) — 100 % gemessen', () => {
  const l = lage({ bewegungen: SCHMAL });
  const g = gate(l, EINTRAG);
  assert.strictEqual(g.erklaerteZeilen, 0, 'der Zuschlag darf nichts herausrechnen');
  assert.strictEqual(g.erklaerendeLampe, null, 'keine Lampe im Spiel');
  const gematcht = l.vorher.cohort.profitable.length;   // alle Vorgaenger-Zeilen sind gematcht
  assert.strictEqual(g.fanOutNenner, gematcht, 'Nenner muss die volle gematchte Flaeche sein');
});

// ── BP-2 (WB-2, Abwesenheit) ─────────────────────────────────────────────────
check('BP-2: dieselbe Lage OHNE typ-Feld -> SUSPECT (die Ausnahme haengt am typ)', () => {
  const g = gate(lage({ bewegungen: SCHMAL }), OHNE_TYP);
  assert.strictEqual(g.bruchGrenze, null);
  assert.ok(g.suspect, 'ein Eintrag ohne typ darf nichts anheben');
});

check('BP-2b: dieselbe Lage mit ANDEREM typ -> SUSPECT (nur daten-schub oeffnet den Arm)', () => {
  const g = gate(lage({ bewegungen: SCHMAL }), ANDERER_TYP);
  assert.strictEqual(g.bruchGrenze, null);
  assert.ok(g.suspect, 'score-definitions-bruch darf den Zuschlags-Arm nicht oeffnen');
});

// ── BP-3 (WB-3) — der eigentliche Waechter ───────────────────────────────────
check('BP-3: BREITE Welle (>8 % der Zeilen ueber dem Boden) -> SUSPECT TROTZ gueltigem Eintrag', () => {
  const breit = new Array(30).fill(20.0);            // 30/300 = 10,00 % > 8 %
  const g = gate(lage({ bewegungen: breit }), EINTRAG);
  assert.ok(g.fanOut > CAP, 'Fixture reisst den Cap nicht: ' + g.fanOut);
  assert.strictEqual(g.bruchGrenze, null, 'bei gerissenem Faecherungs-Tor darf KEIN Zuschlag entstehen');
  assert.strictEqual(g.wirksameSchwelle, BODEN, 'es gilt unveraendert die normale Schwelle');
  assert.ok(g.suspect, 'eine breite Welle muss weiterhin auffallen');
});

check('BP-3b: Cap-Kante — genau 8 % halten, ein Haar darueber nicht', () => {
  const auf = gate(lage({ bewegungen: new Array(24).fill(20.0) }), EINTRAG);   // 24/300 = 8,00 %
  assert.ok(Math.abs(auf.fanOut - CAP) < 1e-12, 'Kante nicht getroffen: ' + auf.fanOut);
  assert.ok(auf.bruchGrenze && !auf.suspect, 'genau auf dem Cap muss der Zuschlag noch greifen');
  const drueber = gate(lage({ bewegungen: new Array(25).fill(20.0) }), EINTRAG);  // 25/300 = 8,33 %
  assert.ok(drueber.fanOut > CAP);
  assert.strictEqual(drueber.bruchGrenze, null, 'einen Schritt ueber dem Cap ist Schluss');
  assert.ok(drueber.suspect);
});

// ── BP-4 (WB-2) — der eigentliche Waechter ───────────────────────────────────
check('BP-4: Einzelbewegung UEBER dem Deckel 23,00 -> SUSPECT trotz gueltigem Eintrag', () => {
  const g = gate(lage({ bewegungen: [30.0, 29.0, 28.0, 27.0] }), EINTRAG);
  assert.ok(g.bruchGrenze, 'der Arm greift (schmale Faecherung), aber er deckt die Hoehe nicht');
  assert.strictEqual(g.bruchGrenze.tagesschwelle, DECKEL, 'der Deckel wird NIE ueberschritten');
  assert.strictEqual(g.p99Delta, 27.0);
  assert.ok(g.suspect, 'eine Bewegung ueber dem Deckel muss weiterhin reissen');
  assert.ok(g.reasons.includes('p99-delta-exceeds-threshold'), 'Grund: ' + g.reasons.join(','));
});

// ── BP-5 (WB-4) — der Ast, den die Diagnose auslaesst ────────────────────────
// FTI-Form: Frisch-Pull-Zeile, |D| = 12,00 (ueber dem Boden, UNTER dem Deckel), deren
// Integritaet abbaut. Ohne WB-4 laeuft sie unter dem Zuschlag mit durch.
const FTI_BEWEGUNG = [12.0];
const FTI_FAELLE = [
  ['coverageAxes 6/7 -> 4/7', { coverageAxes: '4/7' }],
  ['annualOpInc-Form: gefuellte Quellreihe wird LEER', { pit: { revenueQ: [], revenueQEnds: ['2026-06-30'], grossProfitQ: [60], grossProfitQEnds: ['2026-06-30'] } }],
  ['annualGP-Form: Quellreihe wird komplett null', { pit: { revenueQ: [null, null, null], revenueQEnds: ['2026-06-30'], grossProfitQ: [60], grossProfitQEnds: ['2026-06-30'] } }],
  // WB-4' (05.09.2026): Quell-Lampen-Verlust OHNE SEC-Beweis bleibt Verfall (Arm c); Diagnose-Lampen
  // sind seit WB-4' Beobachtung ohne Veto (Arm d) — deren Freigabe pinnt tests/wertgate-wb4strich.test.js.
  ['Quell-Lampe opIncYahooAdjusted geht verloren (ohne SEC-Beweis, WB-4-Strich Arm c)', { lamps: ['peakMargin'] }],
  ['beide Lampen weg (darunter die Quell-Lampe, ohne SEC-Beweis)', { lamps: [] }],
  ['PIT-Block ganz weg (Snapshot verloren)', { pit: null }],
];
for (const [was, felder] of FTI_FAELLE) {
  check('BP-5: Integritaets-Vorrang, ' + was + ' -> SUSPECT trotz Eintrag und trotz |D| < 23,00', () => {
    const g = gate(lage({ bewegungen: FTI_BEWEGUNG, verfall: { ticker: 'T0', felder } }), EINTRAG);
    assert.ok(g.p99Delta < DECKEL, 'Vorbedingung: die Bewegung liegt UNTER dem Deckel (' + g.p99Delta + ')');
    assert.ok(g.fanOut <= CAP, 'Vorbedingung: schmale Faecherung, das Tor haelt');
    assert.strictEqual(g.bruchGrenze, null, 'eine abbauende Zeile darf keinen Zuschlag ausloesen');
    assert.ok(g.suspect, 'der Zuschlag deckt Bewegung, NIEMALS Verfall');
    assert.ok(g.reasons.some((r) => r.startsWith('integritaets-verfall:')), 'Grund: ' + g.reasons.join(','));
    assert.strictEqual(g.verfallsZeilen.length, 1, 'genau eine Zeile faellt');
    assert.strictEqual(g.verfallsZeilen[0].ticker, 'T0', 'die gefasste Zeile muss NAMENTLICH benannt sein');
    assert.ok(g.verfallsZeilen[0].feld, 'ohne ausloesendes Feld ist der Befund nicht nachpruefbar');
  });
}

check('BP-5-GEGENPROBE: dieselbe Bewegung mit INTAKTER Zeile -> besteht (die Probe misst den Verfall)', () => {
  const g = gate(lage({ bewegungen: FTI_BEWEGUNG }), EINTRAG);
  assert.strictEqual(g.verfallsZeilen.length, 0);
  assert.ok(g.bruchGrenze && !g.suspect, 'ohne Verfall traegt der Zuschlag: ' + g.reasons.join(','));
});

check('BP-5b: Verfall wirkt auch, wenn das p99 UNTER der normalen Schwelle liegt', () => {
  // Kein einziges grosses Delta — ohne WB-4 waere dieser Tag voellig unauffaellig.
  const g = gate(lage({ verfall: { ticker: 'T7', felder: { coverageAxes: '3/7' } } }), EINTRAG);
  assert.ok(g.p99Delta < BODEN, 'Vorbedingung: ruhiger Tag (' + g.p99Delta + ')');
  assert.ok(g.suspect, 'ein Datenschaden ist kein Schwellen-Thema');
  assert.strictEqual(g.verfallsZeilen[0].ticker, 'T7');
});

check('BP-5c: eine ZUGEWINNENDE Zeile ist kein Verfall (die Regel misst Richtung, nicht Aenderung)', () => {
  const l = lage({ bewegungen: FTI_BEWEGUNG });
  l.vorher.cohort.profitable[0].coverageAxes = '4/7';   // vorher schlechter, heute besser
  l.vorher.cohort.profitable[0].lamps = [];
  const g = gate(l, EINTRAG);
  assert.strictEqual(g.verfallsZeilen.length, 0, 'Verbesserung darf nicht sperren');
  assert.ok(!g.suspect, 'sonst waere jede Datenreparatur ein Alarm');
});

// ── BP-6 (WB-2/WB-9): die Ausnahme faerbt nicht ab ──────────────────────────
check('BP-6: nicht genanntes Board -> normale Schwelle, SUSPECT, kein Integritaets-Scan', () => {
  const g = gate(lage({ bewegungen: SCHMAL, verfall: { ticker: 'T9', felder: { coverageAxes: '2/7' } } }), EINTRAG, 'materials');
  assert.strictEqual(g.bruchGrenze, null, 'ein fremdes Board erbt den Zuschlag nicht');
  assert.strictEqual(g.datenSchub, false, 'und auch die Auflage nicht');
  assert.strictEqual(g.verfallsZeilen.length, 0, 'der Scan laeuft nur am registrierten Uebergang');
  assert.ok(g.suspect, 'gemessen wird gegen die unveraenderte normale Schwelle');
  assert.strictEqual(g.wirksameSchwelle, BODEN);
});

check('BP-6b: gar kein Registereintrag -> unveraendert SUSPECT', () => {
  const g = gate(lage({ bewegungen: SCHMAL }), null);
  assert.strictEqual(g.bruchGrenze, null);
  assert.strictEqual(g.datenSchub, false);
  assert.ok(g.suspect);
});

// ── REGRESSION: der Schrumpfungs-Arm bleibt Zeile fuer Zeile unveraendert ────
check('REGRESSION: Schrumpfungs-Arm rechnet unveraendert (Strukturgrenze, geklemmt, typ schrumpfung)', () => {
  // 20 % Schrumpfung -> strukturgrenze 20,00, unter dem Deckel 23,00, ueber dem Boden 11,50.
  const l = lage({ zeilen: 300, neue: 0, weg: 60, bewegungen: [19.0, 18.0, 17.0, 16.0] });
  const g = gate(l, OHNE_TYP);
  assert.ok(g.bruchGrenze, 'der Schrumpfungs-Zweig muss weiterhin greifen');
  assert.strictEqual(g.bruchGrenze.typ, 'schrumpfung');
  assert.strictEqual(g.bruchGrenze.strukturgrenze, 20, 'SCORE_SKALA x 0,20');
  assert.strictEqual(g.bruchGrenze.tagesschwelle, 20, 'max(Boden, min(Struktur, Deckel)) — unveraendert');
  assert.strictEqual(g.bruchGrenze.allowance, 8.5);
  assert.ok(!g.suspect);
});

check('REGRESSION: Mini-Schrumpfung bleibt auf allowance 0 geklemmt (Q2-Anlassfall)', () => {
  const l = lage({ zeilen: 300, neue: 0, weg: 3, bewegungen: [0.4] });   // 1 % -> Struktur 1,00
  const g = gate(l, OHNE_TYP);
  assert.ok(g.bruchGrenze, 'der Zweig feuert');
  assert.strictEqual(g.bruchGrenze.allowance, 0, 'geklemmt auf den Boden: eine Grenze, die nichts erhoeht');
  assert.strictEqual(g.wirksameSchwelle, BODEN);
});

check('SCOPING: der Integritaets-Vorrang faerbt NICHT auf den Schrumpfungs-Arm ab', () => {
  // Bewusste Grenze dieses PR (Kopf-Kommentar): WB-4 ist Auflage AUF dem Zuschlag. Wer sie
  // spaeter ausweiten will, aendert genau diese Probe — und sieht dabei, was er aendert.
  const l = lage({ zeilen: 300, neue: 0, weg: 60, bewegungen: [19.0, 18.0, 17.0, 16.0], verfall: { ticker: 'T80', felder: { coverageAxes: '1/7' } } });
  const g = gate(l, OHNE_TYP);
  assert.strictEqual(g.datenSchub, false);
  assert.strictEqual(g.verfallsZeilen.length, 0, 'kein Scan ausserhalb des Datenschub-Arms');
  assert.ok(g.bruchGrenze && !g.suspect, 'der Schrumpfungs-Arm verhaelt sich wie vor dem Beschluss');
});

// ── BP-9 (WB-9): Zuschlag UND Blendung zugleich -> harter Abbruch ───────────
function mitRegister(eintraege, fn) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-ds-'));
  fs.mkdirSync(path.join(base, 'board-history'), { recursive: true });
  fs.writeFileSync(path.join(base, 'board-history', '_excluded.json'),
    JSON.stringify({ _doc: 'test', excluded: [], _massstab_brueche: eintraege }));
  W._setPaths(base);
  try { return fn(); } finally { W._setPaths(); }   // Repo-Pfade wiederherstellen
}

check('BP-9: Registereintrag mit typ daten-schub UND erklaerende_lampe -> HARTER Abbruch', () => {
  assert.throws(() => mitRegister([{
    tag: 'Tag X', typ: 'daten-schub', letztes_altes_vintage: '2026-09-01',
    boards: [BOARD], erklaerende_lampe: 'opIncYahooAdjusted',
  }], () => W.massstabBruchFuer('2026-09-01')),
  /Zuschlag.*Blendung|daten-schub.*erklaerende_lampe/,
  'ein Eintrag, der zugleich anhebt und blendet, muss laut sterben statt still zu wirken');
});

check('BP-9-GEGENPROBE: derselbe Eintrag OHNE Lampe wird sauber gelesen', () => {
  const b = mitRegister([{
    tag: 'Tag X', typ: 'daten-schub', letztes_altes_vintage: '2026-09-01', boards: [BOARD],
  }], () => W.massstabBruchFuer('2026-09-01'));
  assert.ok(b, 'der Eintrag muss gefunden werden');
  assert.strictEqual(b.typ, 'daten-schub', 'typ muss am Gate ankommen — sonst ist er wieder tot');
  assert.strictEqual(b.erklaerendeLampe, null);
});

check('BP-9b: eine Lampe OHNE daten-schub bleibt unveraendert erlaubt (Tag-938-Form)', () => {
  const b = mitRegister([{
    tag: 'Tag 938', typ: 'score-definitions-bruch', letztes_altes_vintage: '2026-09-01',
    boards: [BOARD], erklaerende_lampe: 'einmalertrag',
  }], () => W.massstabBruchFuer('2026-09-01'));
  assert.strictEqual(b.erklaerendeLampe, 'einmalertrag');
  assert.strictEqual(b.typ, 'score-definitions-bruch');
});

// ── Register: der ECHTE Eintrag Tag 1204, aus der Datei gelesen ─────────────
// ENTBUNDEN 2026-09-05 (Master-Ratifikation, Anker orchestrator-2026-09-05-tag.md N3/N6): der
// Eintrag bleibt als Dokumentation, bindet aber keine Boards mehr (boards: null, Praezedenz
// Tag 579) — 14 von 15 Verfallszeilen am ersten Live-Tag waren falsch-positiv, die Bindung
// haette nie verbraucht werden koennen (Dauersperre). Die Bindungs-Waechter leben jetzt in
// tests/wertgate-261-entbunden.test.js; hier bleibt die FORM des Eintrags gepinnt.
check('REGISTER: Eintrag #261 traegt typ daten-schub, KEINE Zahl, Wirkungs-Vermerk — und seit 05.09. KEINE aktive Bindung', () => {
  const reg = require('../board-history/_excluded.json')._massstab_brueche;
  const e = reg.find((x) => x && x.tag === 'Tag 1204');
  assert.ok(e, 'kein Eintrag Tag 1204 im Register');
  assert.strictEqual(e.typ, 'daten-schub');
  assert.strictEqual(e.letztes_altes_vintage, '2026-09-01', 'Bindung an den exakten Vorgaenger (dokumentarisch)');
  assert.strictEqual(e.boards, null, 'seit 05.09. entbunden: boards muss null sein');
  assert.deepStrictEqual(e['boards_bis_2026-09-05'], ['energy', 'it-services', 'utilities'], 'die frueher gebundenen Boards bleiben nachlesbar');
  assert.ok(!('erklaerende_lampe' in e), 'ein daten-schub-Eintrag darf nie zusaetzlich blenden (WB-9)');
  for (const k of ['allowance', 'tagesschwelle', 'schwelle', 'grenze', 'hoehe', 'deckel']) {
    assert.ok(!(k in e), 'Register traegt eine Zahl (' + k + ') — die Hoehe kommt aus dem Code, nie von Hand');
  }
  assert.ok(typeof e.wirkung_gemessen === 'string' && e.wirkung_gemessen.length > 0,
    'dokumentarisches Feld wirkung_gemessen fehlt (Q3)');
  // Verdrahtung am Objekt: ohne Bindung darf der Eintrag NICHT am Gate ankommen.
  assert.strictEqual(W.massstabBruchFuer('2026-09-01'), null, 'entbundener Eintrag kommt NICHT mehr am Gate an');
});

check('REGISTER: kein einziger Eintrag kombiniert daten-schub mit einer Lampe', () => {
  const reg = require('../board-history/_excluded.json')._massstab_brueche;
  for (const e of reg) {
    if (e && e.typ === 'daten-schub') {
      assert.ok(!e.erklaerende_lampe, 'Eintrag ' + (e.tag || '?') + ' kombiniert Zuschlag und Blendung');
    }
  }
});

// ── BP-7 (WB-6) und BP-8 (WB-5/WB-7): am ECHTEN Lauf, nicht an einer Kopie ──
// Zwei Boards in EINEM Lauf: energy waechst und bewegt sich schmal (Zuschlag GEWAEHRT,
// allowance > 0), utilities schrumpft leicht und bewegt sich BREIT (Faecherungs-Tor reisst,
// der Schrumpfungs-Arm faengt es mit allowance 0 auf). Damit stehen beide Faelle der
// Q2-Ehrlichkeitszeile in derselben Ausgabe.
function boardDatei(rows) { return { profitable: rows, unprofitable: [] }; }
function laufBasis(mitEintrag) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'bh-lauf-'));
  fs.mkdirSync(path.join(base, 'outputs', 'hypergrowth', 'full'), { recursive: true });
  fs.mkdirSync(path.join(base, 'snapshots'), { recursive: true });
  fs.writeFileSync(path.join(base, 'outputs', 'calibration.json'),
    JSON.stringify({ schema: 'calibration/v4', generated_at: '2026-09-01T20:00:00Z' }));
  fs.mkdirSync(path.join(base, 'board-history'), { recursive: true });
  fs.writeFileSync(path.join(base, 'board-history', '_excluded.json'), JSON.stringify({
    _doc: 'test', excluded: [],
    _massstab_brueche: mitEintrag ? [{
      tag: 'Tag 1204', typ: 'daten-schub', letztes_altes_vintage: '2026-09-01',
      boards: ['energy', 'utilities'],
    }] : [],
  }));
  return base;
}
// 150 Zeilen -> p99 nearest-rank ceil(0,99*150)-1 = 148 -> zweitgroesster Wert.
function lauf(base, datum, energyRows, utilRows) {
  fs.writeFileSync(path.join(base, 'outputs', 'hypergrowth', 'full', 'energy.json'), JSON.stringify(boardDatei(energyRows)));
  fs.writeFileSync(path.join(base, 'outputs', 'hypergrowth', 'full', 'utilities.json'), JSON.stringify(boardDatei(utilRows)));
  return W.run({ baseDir: base, date: datum });
}
function rows(n, prefix, bewegungen) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const d = bewegungen && i < bewegungen.length ? bewegungen[i] : 0;
    out.push({ ticker: prefix + i, score: 50 + d, track: 'profitable', coverageAxes: '6/7', lamps: ['peakMargin'] });
  }
  return out;
}
function ausnahmeLauf() {
  const base = laufBasis(true);
  lauf(base, '2026-09-01', rows(150, 'E'), rows(150, 'U'));
  // energy: +20 neue Zeilen, zwei Bewegungen ueber dem Boden, unter dem Deckel -> Zuschlag.
  const energyNeu = rows(150, 'E', [20.0, 19.0]).concat(rows(20, 'ENEU'));
  // utilities: 5 Zeilen weg (Schrumpfung 3,3 %) und 30 breite Bewegungen, von denen die
  // ersten 5 mit den ausgefallenen Zeilen verschwinden -> 25 von 145 = 17,24 %, Tor reisst.
  const utilNeu = rows(150, 'U', new Array(30).fill(20.0)).slice(5);
  const res = lauf(base, '2026-09-02', energyNeu, utilNeu);
  return { base, res };
}

check('BP-7 (WB-6): am Ausnahmetag waechst dailyP99Samples NICHT', () => {
  const { base, res } = ausnahmeLauf();
  const energy = res.boards.find((b) => b.board === 'energy');
  assert.ok(energy.bruchGrenze && energy.bruchGrenze.typ === 'daten-schub', 'Vorbedingung: der Zuschlag greift');
  assert.ok(!energy.suspect, 'Vorbedingung: der Tag besteht — sonst misst die Probe die suspect-Sperre');
  const calib = JSON.parse(fs.readFileSync(path.join(base, 'board-history', '_gate-calibration.json'), 'utf8'));
  assert.strictEqual(calib.boards.energy.dailyP99Samples.length, 0,
    'ein Ausnahmetag darf die Kalibrierung nicht mitziehen — sonst kalibriert der Zuschlag das Gate hoch');
});

check('BP-7-GEGENPROBE: derselbe Tag OHNE Eintrag liefert sehr wohl ein Sample', () => {
  // Anwesenheit UND Abwesenheit: ohne die Sperre waere die Messreihe gewachsen. Nur so ist
  // belegt, dass BP-7 die Sperre misst und nicht bloss eine leere Messreihe.
  const base = laufBasis(false);
  lauf(base, '2026-09-01', rows(150, 'E'), rows(150, 'U'));
  lauf(base, '2026-09-02', rows(150, 'E', [0.4, 0.3]).concat(rows(20, 'ENEU')), rows(150, 'U'));
  const calib = JSON.parse(fs.readFileSync(path.join(base, 'board-history', '_gate-calibration.json'), 'utf8'));
  assert.strictEqual(calib.boards.energy.dailyP99Samples.length, 1, 'ein ruhiger Tag ohne Eintrag MUSS zaehlen');
});

check('BP-8 (WB-7): erhoeht zaehlt NUR allowance > 0; die Allowance-0-Bindung bekommt eine eigene Klausel', () => {
  const { res } = ausnahmeLauf();
  const energy = res.boards.find((b) => b.board === 'energy');
  const util = res.boards.find((b) => b.board === 'utilities');
  assert.ok(energy.bruchGrenze.allowance > 0, 'Vorbedingung energy: echter Zuschlag');
  assert.ok(util.bruchGrenze && util.bruchGrenze.allowance === 0,
    'Vorbedingung utilities: gebunden, aber wirkungslos (Strukturgrenze unter dem Boden)');
  const kopf = W.bruchProtokollZeilen(res)[0];
  assert.ok(/1 Board\(s\) mit erhoehter Tagesschwelle/.test(kopf), 'Kopfzeile: ' + kopf);
  assert.ok(/1 gebunden, ohne Wirkung \(Allowance 0\)/.test(kopf),
    'die inerte Bindung muss ehrlich benannt sein statt als Anhebung zu zaehlen: ' + kopf);
});

check('BP-8b (WB-5): die Datenschub-Zeile nennt Schwelle, p99, Faecherung und JEDE breite Zeile mit Ticker', () => {
  const { res } = ausnahmeLauf();
  const zeilen = W.bruchProtokollZeilen(res);
  const eZeile = zeilen.find((z) => z.includes('DATENSCHUB-ZUSCHLAG') && z.includes('energy'));
  assert.ok(eZeile, 'keine eigene Zeile fuer den Datenschub-Arm');
  assert.ok(eZeile.startsWith('::warning::'), 'falscher Kanal — Karls einziger Alarmkanal ist der Warnkanal');
  assert.ok(eZeile.includes('GEWAEHRT'), 'Zeile: ' + eZeile);
  assert.ok(eZeile.includes('Tagesschwelle 23.00 statt 11.50'), 'Groessen fehlen: ' + eZeile);
  assert.ok(/Faecherung 2\/150 = 1\.33% \(Cap 8%\)/.test(eZeile), 'Faecherung mit Zaehler/Nenner fehlt: ' + eZeile);
  assert.ok(/E0 20\.00/.test(eZeile) && /E1 19\.00/.test(eZeile), 'breite Zeilen nicht namentlich: ' + eZeile);
  // Und die verweigerte Seite meldet ebenfalls, mit ALLEN Namen (25 der 30 bewegten Zeilen
  // sind gematcht; die uebrigen 5 sind mit der Schrumpfung aus der Kohorte gefallen).
  const uZeile = zeilen.find((z) => z.includes('DATENSCHUB-ZUSCHLAG') && z.includes('utilities'));
  assert.ok(uZeile.includes('VERWEIGERT'), 'Zeile: ' + uZeile);
  assert.ok(/Faecherung 25\/145 = 17\.24%/.test(uZeile), 'Faecherung fehlt: ' + uZeile);
  assert.strictEqual((uZeile.match(/U\d+ 20\.00/g) || []).length, 25, 'es muessen ALLE breiten Zeilen dastehen');
});

check('BP-8c (WB-5): der Sidecar traegt dieselbe Spur wie das Protokoll', () => {
  const { base } = ausnahmeLauf();
  const sc = JSON.parse(fs.readFileSync(path.join(base, 'data-health', 'p99-delta-history.json'), 'utf8'));
  const tag = sc.byDate['2026-09-02'];
  assert.ok(tag.energy.datenSchub, 'kein Datenschub-Block im Sidecar');
  assert.strictEqual(tag.energy.datenSchub.zuschlagGewaehrt, true);
  assert.strictEqual(tag.energy.datenSchub.angewandteSchwelle, DECKEL);
  assert.strictEqual(tag.energy.datenSchub.normaleSchwelle, BODEN);
  assert.strictEqual(tag.energy.datenSchub.fanOut.zaehler, 2);
  assert.strictEqual(tag.energy.datenSchub.fanOut.nenner, 150);
  assert.strictEqual(tag.energy.datenSchub.fanOut.cap, CAP);
  assert.deepStrictEqual(tag.energy.datenSchub.breiteZeilen.map((z) => z.ticker), ['E0', 'E1']);
  assert.strictEqual(tag.utilities.datenSchub.zuschlagGewaehrt, false);
  assert.strictEqual(tag.utilities.datenSchub.breiteZeilen.length, 25);
  // Und an einem gewoehnlichen Tag bleibt der Block weg (kein Rauschen in der Messreihe).
  const base2 = laufBasis(false);
  lauf(base2, '2026-09-01', rows(150, 'E'), rows(150, 'U'));
  lauf(base2, '2026-09-02', rows(150, 'E', [0.4]), rows(150, 'U'));
  const sc2 = JSON.parse(fs.readFileSync(path.join(base2, 'data-health', 'p99-delta-history.json'), 'utf8'));
  assert.ok(!('datenSchub' in sc2.byDate['2026-09-02'].energy), 'ohne Ausnahme kein Zusatzblock');
});

console.log(fail ? `\nFAIL: ${fail}` : '\nOK: datenschub-zuschlag (Court 02.09.2026, WB-1..WB-15)');
process.exit(fail ? 1 : 0);

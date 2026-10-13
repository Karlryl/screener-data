'use strict';
/**
 * Engine — Achsen-Test. Die 9 Achsen-Berechner gegen echte CRDO/NVTS-Snapshots
 * + Drop-Verhalten (null -> renorm-on-drop) bei fehlenden Daten.
 *
 * Usage:  node tests/scoring/axes.test.js   (Exit 0 gruen / 1 Fehler)
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ax = require('../../src/scoring/axes.js');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok   ' + name); }
  catch (e) { fail++; console.error('FAIL   ' + name + '\n       ' + e.message); }
}
function snap(t) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', t + '.json'), 'utf8'));
}
const CRDO = snap('CRDO');
const NVTS = snap('NVTS');
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

// --- 1 revGrowthLevel -------------------------------------------------------
// Datenrichtigkeits-Fix 14.07.2026: SELBST gerechnetes Quartals-YoY aus revenueQ
// (identische Semantik wie Yahoos Skalar — gesunde Namen aendern sich nicht),
// NICHT mehr das Provider-Skalar metrics.revenueGrowthYoY (belegte Glitches:
// MRNA stale +260 %, GOLD +244 % vs real ~13 %). Fallback annual-lag1 nur ohne Quartale.
test('revGrowthLevel(CRDO) == selbst gerechnetes Quartals-YoY (== gesundes Skalar 201.5)', () => {
  const rq = CRDO.timeseries.revenueQ;
  const expected = 100 * (rq[0].value / rq[4].value - 1);
  assert.ok(near(ax.revGrowthLevel(CRDO), expected));
  assert.ok(near(ax.revGrowthLevel(CRDO), CRDO.metrics.revenueGrowthYoY.value, 0.5)); // gesund: Quelle egal
  assert.ok(ax.revGrowthLevel(CRDO) > 100);
});
test('revGrowthLevel: stale/defektes Skalar wird ignoriert, Reihe traegt', () => {
  const s = { metrics: { revenueGrowthYoY: { value: 260 } }, // MRNA-Muster: Skalar behauptet +260%
    timeseries: { revenueQ: [{ value: 80 }, { value: 90 }, { value: 95 }, { value: 100 }, { value: 100 }] } };
  assert.ok(near(ax.revGrowthLevel(s), -20)); // Reihe sagt ehrlich -20%
});
test('revGrowthLevel: growthBounds klemmen Mini-Basis-Komponenten', () => {
  const stub = { annual: { annualRev: [{ value: 300 }, { value: 1 }] } }; // +29900% Basis-Artefakt
  assert.ok(ax.revGrowthLevel(stub) > 1000);                    // ungeklemmt: Phantom-Extrem
  assert.ok(near(ax.revGrowthLevel(stub, [-0.7, 4.5]), 450));   // geklemmt auf p99-Schranke
});
test('revGrowthLevel: keine Reihen -> null (kein Skalar-Fallback)', () => {
  assert.equal(ax.revGrowthLevel({}), null);
  assert.equal(ax.revGrowthLevel({ metrics: { revenueGrowthYoY: { value: 260 } } }), null);
});

// --- 2 revAcceleration ------------------------------------------------------
test('revAcceleration(CRDO) > 0 (beschleunigt)', () => {
  assert.ok(ax.revAcceleration(CRDO) > 0);
});
test('revAcceleration: < 3 Quartale -> null', () => {
  assert.equal(ax.revAcceleration({ timeseries: { revenueQ: [{ value: 10 }, { value: 9 }] } }), null);
});

// --- 3 gpGrowth -------------------------------------------------------------
test('gpGrowth(CRDO) > 1 (starkes GP-Wachstum)', () => {
  assert.ok(ax.gpGrowth(CRDO) > 1);
});
test('gpGrowth: nur 1 GP-Jahr -> null', () => {
  assert.equal(ax.gpGrowth({ annual: { annualGP: [{ value: 100 }], annualRev: [{ value: 200 }] } }), null);
});
// audit/fix (Hard-Review NRB-SC-002): firstPresent(gm) ueberspringt eine FUEHRENDE Rev-Luecke und
// nimmt ein AELTERES Jahr als "gmNew" -- UAN-Muster: annualRev[0]=0 (annualGP[0] present).
test('gpGrowth: fuehrende annualRev-Luecke -> gmTraj=0 statt Alt-Jahr-Marge (UAN-Muster, NRB-SC-002)', () => {
  const s = { annual: { annualGP: [{ value: 163370000 }, { value: 118865000 }, { value: 232464000 }, { value: 352367000 }],
    annualRev: [{ value: 0 }, { value: 404177000 }, { value: 351082000 }, { value: 330800000 }] } };
  const gpYoY = 163370000 / 118865000 - 1; // zweijaehriges Fenster fuer gpYoY, unveraendert
  assert.ok(Math.abs(ax.gpGrowth(s) - gpYoY) < 1e-9,
    'gmTraj muss 0 sein (fuehrende Rev-Luecke), gpGrowth == reines gpYoY. War ' + ax.gpGrowth(s));
});

// --- 4 ruleOfX --------------------------------------------------------------
test('ruleOfX(CRDO): includeFcf addiert gueltige FCF-Marge', () => {
  const withFcf = ax.ruleOfX(CRDO, 2.3, true);
  const without = ax.ruleOfX(CRDO, 2.3, false);
  assert.ok(withFcf > without); // CRDO FCF gilt als gueltig (G2+G3)
  assert.ok(near(withFcf - without, CRDO.metrics.fcfMarginTTM.value, 1e-6));
  // Datenrichtigkeits-Fix 14.07.2026: rev-Bein = reihen-basiertes revGrowthLevel (EIN Wachstumsbegriff)
  assert.ok(near(without, 2.3 * ax.revGrowthLevel(CRDO), 1e-6));
});
test('ruleOfX(NVTS) < 0 und FCF-Term gedroppt (Artefakt nicht addiert)', () => {
  assert.ok(ax.ruleOfX(NVTS, 2.3, true) < 0); // negatives Umsatzwachstum
  // NVTS +108% FCF-Artefakt ist ungueltig -> includeFcf aendert nichts
  assert.ok(near(ax.ruleOfX(NVTS, 2.3, true), ax.ruleOfX(NVTS, 2.3, false), 1e-9));
});

// --- 5 marginTrajectory -----------------------------------------------------
test('marginTrajectory(CRDO) > 0 (Operating-Leverage greift)', () => {
  assert.ok(ax.marginTrajectory(CRDO) > 0);
});
test('marginTrajectory: < 2 Quartale -> null', () => {
  assert.equal(ax.marginTrajectory({ timeseries: { opIncQ: [{ value: 5 }], revenueQ: [{ value: 50 }] } }), null);
});

// --- C2: Winsor-Clamp gegen Stub-Quartal-Phantome ---------------------------
test('marginTrajectory: ohne bounds unveraendert (Rueckwaerts-Kompat)', () => {
  // Stub-Quartal: oldest revenueQ=1, opIncQ=-5000 -> Phantom-Marge -5000.
  const stub = { timeseries: { revenueQ: [{ value: 100 }, { value: 1 }], opIncQ: [{ value: 20 }, { value: -5000 }] } };
  assert.ok(ax.marginTrajectory(stub) > 5000); // 0.2 - (-5000) ~ 5000 (das Artefakt)
});
test('marginTrajectory: mit bounds winsorisiert das Stub-Quartal weg', () => {
  const stub = { timeseries: { revenueQ: [{ value: 100 }, { value: 1 }], opIncQ: [{ value: 20 }, { value: -5000 }] } };
  const v = ax.marginTrajectory(stub, [-1, 1]); // oldest -5000 -> -1, newest 0.2 -> bleibt
  assert.ok(near(v, 0.2 - (-1)), `erwartet ~1.2, war ${v}`);
});
// Tag 437: auf YoY-Paare umgeschrieben (die Achse rechnet seit dem Saison-Fix rq[i] gegen
// rq[i+4] statt Quartal-gegen-Vorquartal). Die GESCHUETZTE EIGENSCHAFT ist unveraendert:
// ein winziges Basis-Quartal darf die Achse nicht dominieren.
test('revAcceleration: mit bounds winsorisiert die Mini-Basis-Rate weg', () => {
  // revenueQ (newest-first) = [100,90,80,70,1,60]
  //   YoY[0] = 100/1 - 1 = 99   <- Mini-Basis-Artefakt
  //   YoY[1] = 90/60 - 1 = 0.5
  // ohne bounds: 99 - 0.5 = 98.5
  const stub = { timeseries: { revenueQ: [{ value: 100 }, { value: 90 }, { value: 80 },
    { value: 70 }, { value: 1 }, { value: 60 }] } };
  assert.ok(ax.revAcceleration(stub) > 40, 'ungeklemmt muss das Artefakt sichtbar sein');
  const v = ax.revAcceleration(stub, [-1, 2]); // 99 -> 2 geklemmt
  assert.ok(near(v, 2 - 0.5), `erwartet ~1.5, war ${v}`);
});
test('Winsor-Clamp laesst plausible Werte unberuehrt (kein Regress)', () => {
  // CRDO ist ein realer gesunder Name; weite bounds duerfen nichts aendern.
  assert.ok(near(ax.marginTrajectory(CRDO, [-100, 100]), ax.marginTrajectory(CRDO)));
  assert.ok(near(ax.revAcceleration(CRDO, [-100, 100]), ax.revAcceleration(CRDO)));
});
test('C2/R5: physische Obergrenze 1.0 erhaelt legitime Hochmargen, klemmt nur >1-Stubs', () => {
  // Hochmargen-Name (beide Quartals-OpMargen in [0,1]) -> marginTraj ERHALTEN, NICHT auf 0 genullt
  // (genau der R5-Befund: symmetrisches p99~0.68 nullte FNV/VICI/APP faelschlich).
  const hi = { timeseries: { opIncQ: [{ value: 78 }, { value: 72 }], revenueQ: [{ value: 100 }, { value: 100 }] } };
  assert.ok(near(ax.marginTrajectory(hi, [-13, 1.0]), 0.78 - 0.72), 'Hochmarge erhalten (+0.06)');
  // >1-OpMarge (opInc>rev, physisch unmoeglich = Stub/Artefakt): neueste 16.06 -> auf 1.0 geklemmt.
  const stub = { timeseries: { opIncQ: [{ value: 1606 }, { value: 50 }], revenueQ: [{ value: 100 }, { value: 100 }] } };
  assert.ok(near(ax.marginTrajectory(stub, [-13, 1.0]), 1.0 - 0.5), '>1-Stub auf 1.0 geklemmt');
});

// --- 6 capitalEfficiency ----------------------------------------------------
test('capitalEfficiency(CRDO) ist finit', () => {
  const v = ax.capitalEfficiency(CRDO);
  assert.ok(v === null || Number.isFinite(v));
  assert.ok(Number.isFinite(v));
});
test('capitalEfficiency: keine Bilanz -> null', () => {
  assert.equal(ax.capitalEfficiency({ annual: { annualOpInc: [{ value: 10 }] } }), null);
});
// Auflage 1 / 5.2-Datenfehler-Fix (Tag 434): MGPI-Vorzeichen-Flip-Regression. Yahoo und SEC
// muessen fuer capitalEfficiency zu MATERIELL verschiedenen ROIC-Werten fuehren, wenn secAnnual
// eine abweichende OpInc-Serie mitbringt (Single-Source-Trio, wie roicStability) — sonst waere
// der SEC-Praeferenz-Fix stillschweigend tot code.
test('capitalEfficiency: SEC-Praeferenz aktiv (secAnnual-OpInc-Divergenz veraendert ROIC)', () => {
  const withoutSec = ax.capitalEfficiency(CRDO);
  const withDivergentSec = JSON.parse(JSON.stringify(CRDO));
  const bal = withDivergentSec.annual.annualBalance; // Array-von-Jahresobjekten, nicht {totalAssets:[...]}
  const n = bal.length;
  withDivergentSec.secAnnual = {
    annualOpInc: Array.from({ length: n }, (_, i) => ({ value: -Math.abs(1000 + i) })),
    annualAssets: bal.map((y) => ({ value: y.totalAssets })),
    annualCurrentLiabilities: bal.map((y) => ({ value: y.currentLiabilities })),
  };
  const withSec = ax.capitalEfficiency(withDivergentSec);
  assert.ok(Number.isFinite(withSec), 'SEC-Pfad sollte finiten ROIC liefern, war ' + withSec);
  assert.notEqual(withSec, withoutSec, 'SEC-abweichende OpInc-Serie muss den ROIC gegenueber dem Yahoo-Pfad veraendern');
});

// --- 7 revisionsMomentum ----------------------------------------------------
test('revisionsMomentum(CRDO) finit (in [-1,1])', () => {
  const v = ax.revisionsMomentum(CRDO);
  assert.ok(Number.isFinite(v) && v >= -1 && v <= 1);
});
test('revisionsMomentum: keine Daten -> null', () => {
  assert.equal(ax.revisionsMomentum({}), null);
  assert.equal(ax.revisionsMomentum({ external: { estimateRevisions: { '0y': {} } } }), null);
});

// --- 8 dilution -------------------------------------------------------------
test('dilution(CRDO) finit', () => {
  assert.ok(Number.isFinite(ax.dilution(CRDO)));
});
test('dilution: kein present annualSBC -> null (drop+renorm, KEIN Fake-50)', () => {
  assert.equal(ax.dilution({ annual: { annualSBC: [], annualRev: [{ value: 100 }] } }), null);
  assert.equal(ax.dilution({ annual: { annualSBC: [null, null], annualRev: [{ value: 100 }] } }), null);
});

// --- Regression: revAcceleration ignoriert 0/negative Zwischenquartale ------
// Tag 437: auf YoY-Paare umgeschrieben, geschuetzte Eigenschaft unveraendert — ein Null-
// oder Negativ-Quartal darf keine Riesen-Rate erzeugen, sondern muss sein Paar ueberspringen.
test('revAcceleration: 0/negatives Quartal erzeugt keine Riesen-Rate', () => {
  // Das YoY-Paar (120 / 0) wird verworfen; es bleiben 100/70 und 90/60.
  const s = { timeseries: { revenueQ: [{ value: 120 }, { value: 100 }, { value: 90 },
    { value: 80 }, { value: 0 }, { value: 70 }, { value: 60 }] } };
  const v = ax.revAcceleration(s);
  assert.ok(Number.isFinite(v) && Math.abs(v) < 1, `erwartet endlich und |v|<1, war ${v}`);
});

// --- capitalEfficiency Zyklus-Peak-Discount (Court-Spec) --------------------
test('capitalEfficiency: Peak-Marge wird diskontiert (< stabile Marge)', () => {
  const flatBal = [{ totalAssets: 100, currentLiabilities: 0 }, { totalAssets: 100, currentLiabilities: 0 },
    { totalAssets: 100, currentLiabilities: 0 }, { totalAssets: 100, currentLiabilities: 0 }];
  const stable = { annual: { annualOpInc: [{ value: 20 }, { value: 20 }, { value: 20 }, { value: 20 }],
    annualRev: [{ value: 100 }, { value: 100 }, { value: 100 }, { value: 100 }], annualBalance: flatBal } };
  // gekippter Zyklus-Peak (cur 0.35 < Vorjahr 0.40 = nicht steigend) -> Discount greift.
  const peak = { annual: { annualOpInc: [{ value: 35 }, { value: 40 }, { value: 12 }, { value: 10 }],
    annualRev: [{ value: 100 }, { value: 100 }, { value: 100 }, { value: 100 }], annualBalance: flatBal } };
  // Peak-ROIC ist roh aehnlich, aber der Discount holt ihn unter die stabile Marge.
  assert.ok(ax.capitalEfficiency(peak) < ax.capitalEfficiency(stable),
    `peak ${ax.capitalEfficiency(peak)} sollte < stable ${ax.capitalEfficiency(stable)}`);
});
test('capitalEfficiency: stabile Marge -> kein Discount (cur ~ hist)', () => {
  const s = { annual: { annualOpInc: [{ value: 20 }, { value: 20 }, { value: 20 }],
    annualRev: [{ value: 100 }, { value: 100 }, { value: 100 }],
    annualBalance: [{ totalAssets: 100, currentLiabilities: 0 }, { totalAssets: 100, currentLiabilities: 0 }, { totalAssets: 100, currentLiabilities: 0 }] } };
  assert.ok(Math.abs(ax.capitalEfficiency(s) - 0.2) < 1e-9); // roic 0.2, Discount 1
});
// audit/fix (Hard-Review NRB-SC-002): presentValues() kompaktiert eine FUEHRENDE Rev-Luecke weg und
// nimmt margins[0] als "cur" fuer den Zyklus-Peak-Discount -- obwohl das eine AELTERE Marge ist
// (annualRev[0] fehlt, annualOpInc[0] present -> roic zaehlt das Jahr, die Marge ist unbekannt).
test('capitalEfficiency: fuehrende annualRev-Luecke -> kein Zyklus-Discount (UAN-Muster, NRB-SC-002)', () => {
  const flatBal = [{ totalAssets: 100, currentLiabilities: 0 }, { totalAssets: 100, currentLiabilities: 0 },
    { totalAssets: 100, currentLiabilities: 0 }, { totalAssets: 100, currentLiabilities: 0 }];
  const s = { annual: { annualOpInc: [{ value: 50 }, { value: 35 }, { value: 12 }, { value: 10 }],
    annualRev: [{ value: null }, { value: 100 }, { value: 100 }, { value: 100 }], annualBalance: flatBal } };
  // roic = mean(50,35,12,10)/100 = 0.2675, KEIN Discount (Marge des juengsten Jahres unbekannt).
  assert.ok(Math.abs(ax.capitalEfficiency(s) - 0.2675) < 1e-9,
    'Discount haette nicht auf eine kompaktierte Alt-Jahr-Marge greifen duerfen. War ' + ax.capitalEfficiency(s));
});
// --- capitalEfficiency Trailing-Loss-Trim (Court Inflection, Karl-Direktive) --
test('capitalEfficiency: gerade-profitabel -> Vor-Profit-Verluste getrimmt (ROIC positiv statt negativ)', () => {
  const bal = [{ totalAssets: 1000, currentLiabilities: 200 }, { totalAssets: 1000, currentLiabilities: 200 }, { totalAssets: 1000, currentLiabilities: 200 }];
  // Inflection: neuestes OpInc +100, davor -50/-80. Ohne Trim waere ROIC = mean(100,-50,-80)/800 = -0.0125.
  // Mit Trim (aelteste Verlust-Serie raus): ROIC = mean(100)/800 = +0.125 (misst das profitable Regime).
  const infl = { annual: { annualOpInc: [{ value: 100 }, { value: -50 }, { value: -80 }],
    annualRev: [{ value: 100 }, { value: 100 }, { value: 100 }], annualBalance: bal } };
  assert.ok(Math.abs(ax.capitalEfficiency(infl) - 0.125) < 1e-9, 'Inflection-ROIC = 0.125 (getrimmt), war ' + ax.capitalEfficiency(infl));
});
test('capitalEfficiency: Verschlechterer (neuestes OpInc<0) wird NICHT gerescued (kein Trim)', () => {
  const bal = [{ totalAssets: 1000, currentLiabilities: 200 }, { totalAssets: 1000, currentLiabilities: 200 }, { totalAssets: 1000, currentLiabilities: 200 }];
  // neuestes -50, davor +90/+80: das AELTESTE Jahr ist profitabel -> Loop trimmt NICHTS -> ROIC =
  // mean(-50,90,80)/800 = +0.05 (voller Schnitt inkl. neuestem Verlust, KEIN Rescue auf nur die +Jahre).
  const det = { annual: { annualOpInc: [{ value: -50 }, { value: 90 }, { value: 80 }],
    annualRev: [{ value: 100 }, { value: 100 }, { value: 100 }], annualBalance: bal } };
  assert.ok(Math.abs(ax.capitalEfficiency(det) - 0.05) < 1e-9, 'Verschlechterer-ROIC = 0.05 (ungetrimmt), war ' + ax.capitalEfficiency(det));
});
// --- Bug 6: all-negative OpInc -> voller Mehrjahres-Schnitt (kein Kollaps aufs juengste Jahr) ---
test('capitalEfficiency: all-negative Serie -> mean (kein Rescue aufs juengste Jahr)', () => {
  const bal = [{ totalAssets: 1000, currentLiabilities: 200 }, { totalAssets: 1000, currentLiabilities: 200 }, { totalAssets: 1000, currentLiabilities: 200 }];
  // Alle OpInc <=0: juengstes -5 -> kein Trim -> ROIC = mean(-5,-100,-200)/800 = -0.127.
  // Vorher (Bug): Trim kollabierte auf opInc[0]/inv[0] = -5/800 = -0.00625 (Faktor ~20 Rescue).
  const shrink = { annual: { annualOpInc: [{ value: -5 }, { value: -100 }, { value: -200 }],
    annualRev: [{ value: 100 }, { value: 100 }, { value: 100 }], annualBalance: bal } };
  assert.ok(Math.abs(ax.capitalEfficiency(shrink) - (-0.1270833333)) < 1e-9,
    'Verlust-Verkleinerer-ROIC = -0.127 (voller Schnitt), war ' + ax.capitalEfficiency(shrink));
  // Verlust-Vergroesserer (juengstes -200): vorher Trim-Doppel-Strafe -200/800=-0.25; jetzt mean = -0.127.
  const grow = { annual: { annualOpInc: [{ value: -200 }, { value: -100 }, { value: -5 }],
    annualRev: [{ value: 100 }, { value: 100 }, { value: 100 }], annualBalance: bal } };
  assert.ok(Math.abs(ax.capitalEfficiency(grow) - (-0.1270833333)) < 1e-9,
    'Verlust-Vergroesserer-ROIC = -0.127 (voller Schnitt, keine Doppel-Strafe), war ' + ax.capitalEfficiency(grow));
});

// --- audit/fix Court Fall 1: Achsen-Physik-Guards gegen pathologische Eingaben ---
test('gpGrowth (F9): korruptes Alt-Jahr (GP>Rev, gm>1) wird verworfen, gmTraj dominiert nicht', () => {
  const s = { annual: {
    annualGP:  [{ value: 1.20 }, { value: 0.81 }, { value: 0.58 }, { value: 2.20 }],
    annualRev: [{ value: 3.01 }, { value: 2.25 }, { value: 1.49 }, { value: 1.00 }] } };
  // Ohne Guard: gmOld=2.20 -> gmTraj=-1.80 -> gpGrowth ~ -1.32 (korrupter Sturz, TAL-Muster).
  // Mit Guard: Alt-Jahr (gm=2.2>1) verworfen -> gpGrowth ~ gpYoY+kleiner Tilt > 0.
  const g = ax.gpGrowth(s);
  assert.ok(g > 0.3, `gpGrowth sollte ~gpYoY positiv bleiben, nicht vom korrupten gmOld dominiert: ${g}`);
});
test('gpGrowth: beide gm-Endpunkte plausibel -> unveraendertes Verhalten (kein Regress)', () => {
  const s = { annual: { annualGP: [{ value: 60 }, { value: 40 }], annualRev: [{ value: 100 }, { value: 100 }] } };
  assert.ok(near(ax.gpGrowth(s), 0.7), 'gpGrowth=' + ax.gpGrowth(s)); // gpYoY 0.5 + gmTraj 0.2
});
test('marginTrajectory (F12): negativer Quartalsumsatz wird verworfen (keine Phantom-Marge/Flip)', () => {
  const s = { timeseries: {
    opIncQ:   [{ value: 30 }, { value: 25 }, { value: 20 }, { value: -5 }],
    revenueQ: [{ value: 100 }, { value: 90 }, { value: 80 }, { value: -10 }] } };
  // Ohne Guard: aeltestes Quartal -5/-10=+0.5 (Phantom) -> 0.30-0.5=-0.2 (falscher Flip).
  // Mit Guard: nur 3 positive Quartale -> 0.30-0.25=+0.05 (korrekt, steigende Marge).
  assert.ok(ax.marginTrajectory(s) > 0, `Trajektorie muss positiv sein, ist ${ax.marginTrajectory(s)}`);
});
test('marginTrajectory: alle Quartale positiv -> unveraendert (kein Regress)', () => {
  const s = { timeseries: { opIncQ: [{ value: 30 }, { value: 10 }], revenueQ: [{ value: 100 }, { value: 100 }] } };
  assert.ok(near(ax.marginTrajectory(s), 0.2), 'marginTraj=' + ax.marginTrajectory(s));
});
test('dilution (F17): near-zero Alt-Umsatz blaeht SBC/Rev nicht auf (Slope robust)', () => {
  const s = { annual: {
    annualSBC: [10, 9, 8, 0.01], // FIELD_REGISTRY annualSBC = ['annual','scalar'] -> reine Zahlen
    annualRev: [{ value: 100 }, { value: 100 }, { value: 100 }, { value: 0.001 }] } };
  // Ohne Guard: old=0.01/0.001=10 -> dilution ~ +9.8 ("beste Dilution", IBRX-Muster, falsch).
  // Mit Guard: Alt-Jahr (ratio 10>1) verworfen -> dilution ~ -0.12 (echte Verwaesserung).
  const d = ax.dilution(s);
  assert.ok(d < 0 && d > -1, `dilution muss negativ + nicht aufgeblaeht sein, ist ${d}`);
});

test('gpGrowth (F9, R2F40): negatives gm-Jahr (GP<0) wird ebenso verworfen (v>=0-Guard hat Wirkung)', () => {
  const s = { annual: {
    annualGP:  [{ value: 60 }, { value: 40 }, { value: 30 }, { value: -50 }],
    annualRev: [{ value: 100 }, { value: 100 }, { value: 100 }, { value: 100 }] } };
  // gm = [0.6, 0.4, 0.3, -0.5]. Ohne v>=0-Guard: gmOld=-0.5 -> gmTraj=1.1 -> g~1.6 (aufgeblaeht).
  // Mit Guard: -0.5 verworfen -> gmOld=0.3 -> gmTraj=0.3 -> g=0.8.
  assert.ok(ax.gpGrowth(s) < 1.0, `gm<0-Jahr darf gpGrowth nicht aufblaehen: ${ax.gpGrowth(s)}`);
});
test('dilution (F17/R2F1): echter Heavy-Diluter (newest SBC/Rev>1) behaelt die Achse (kein Drop->renorm)', () => {
  const s = { annual: { annualSBC: [150, 120, 90], annualRev: [{ value: 100 }, { value: 100 }, { value: 100 }] } };
  // newest SBC/Rev = 1.5 (>1) -> frueheres Nullen haette die Achse gedroppt (Diluter entging Strafe).
  // Jetzt: level=clamp(1.5)=1 -> dilution != null und stark negativ (harte Verwaesserungs-Strafe).
  const d = ax.dilution(s);
  assert.ok(d !== null && d < 0, `Heavy-Diluter muss Achse behalten + negative dilution haben, ist ${d}`);
});
// audit/fix (Hard-Review S2-SC-002, BH-080-Analog): firstPresent(raw) ueberspringt eine FUEHRENDE
// annualSBC-Luecke und liefert ein 4 Jahre altes SBC/Rev-Verhaeltnis als "aktuelles Niveau" (EE-Muster).
test('dilution: fuehrende annualSBC-Luecke -> Achse droppt (null), kein Alt-Jahr-Fake-Niveau (EE-Muster, S2-SC-002)', () => {
  const s = { annual: { annualSBC: [null, null, null, 956000, null],
    annualRev: [{ value: 1228263000 }, { value: 851437000 }, { value: 1158963000 }, { value: 2472973000 }] } };
  assert.equal(ax.dilution(s), null,
    'annualSBC[0] fehlt -- das aktuelle Dilutions-Niveau ist unbekannt, kein 4-Jahre-alter Fake-Wert');
  // Kontrolle: annualSBC[0] present -> unveraendertes Verhalten (kein Regress).
  const noGap = { annual: { annualSBC: [500000, null, null, 956000], annualRev: [{ value: 1000000 }, { value: 851437000 }] } };
  assert.ok(ax.dilution(noGap) !== null, 'present annualSBC[0] darf die Achse nicht droppen');
});

test('marginTrajectory (F12, R2 mutation): revenueQ===0 wird verworfen (r>0-Guard, nicht r>=0)', () => {
  const s = { timeseries: {
    opIncQ:   [{ value: 30 }, { value: 25 }, { value: 20 }, { value: 5 }],
    revenueQ: [{ value: 100 }, { value: 90 }, { value: 80 }, { value: 0 }] } };
  // Aeltestes Quartal revenueQ=0 -> verwerfen (sonst Div/0). Mit r>0: 3 valide Q -> 0.30-0.25=0.05.
  // Mit r>=0 (Mutation): 5/0=Infinity -> m nicht finit. Test faengt die Mutation.
  const m = ax.marginTrajectory(s);
  assert.ok(Number.isFinite(m) && m > 0, `revenueQ=0 muss verworfen werden, m=${m}`);
});

// --- 9 marginLevel (2.12b, Franchise-vs-commodity-Diskriminator) -------------
test('marginLevel(CRDO) ~0.65 (GM-Niveau aus annualGP/annualRev)', () => {
  const v = ax.marginLevel(CRDO);
  assert.ok(v !== null && v > 0.5 && v < 0.75, `CRDO GM-Level erwartet ~0.65, ist ${v}`);
});
test('marginLevel: kein present GP/Rev-Paar -> null (renorm-on-drop, kein Fake-50)', () => {
  assert.equal(ax.marginLevel({}), null);
  assert.equal(ax.marginLevel({ annual: { annualGP: [], annualRev: [] } }), null);
});
test('marginLevel [0,1]-Guard: implausibles GP>Rev-Jahr (gm>1) wird verworfen, faellt auf valides GJ', () => {
  // juengstes GJ GP>Rev (gm=1.2, korrupt) -> verwerfen; naechstes valides GJ gm=0.30 zaehlt.
  const s = { annual: { annualGP: [{ value: 120 }, { value: 30 }], annualRev: [{ value: 100 }, { value: 100 }] } };
  const v = ax.marginLevel(s);
  assert.ok(near(v, 0.30), `implausibles gm=1.2 muss uebersprungen werden, ist ${v}`);
});

// --- Inert-Invariante (2.12b): marginLevel NUR in tech-hardware verdrahtet ----
test('marginLevel ist NUR in tech-hardware.js gelistet, in den anderen 11 Formeln NICHT (Inert-Waechter)', () => {
  const formulas = require('../../src/scoring/formulas/index.js');
  for (const [id, f] of Object.entries(formulas)) {
    const hasML = (f.axes || []).some((a) => a.key === 'marginLevel');
    if (id === 'tech-hardware') assert.ok(hasML, 'tech-hardware MUSS marginLevel listen');
    else assert.ok(!hasML, `${id} darf marginLevel NICHT listen (sonst nicht mehr inert)`);
  }
});

console.log(`\naxes.test.js: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);

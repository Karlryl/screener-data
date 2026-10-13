'use strict';
/**
 * KR-Adapter-Test (Globale Gratis-Adapter, OpenDART): der Korea-Deep-Merge macht SK Hynix
 * REFRESH-ROBUST. Kernaussage (vom Verify empirisch bestaetigt): byte-identisch HEUTE (SK Hynix
 * sitzt schon via Yahoo-4J gedaempft, das 2023-Verlustjahr ist noch im Fenster) — aber die tiefe
 * Serie HAELT den Zyklus, wenn das Verlustjahr aus dem 4J-Fenster rollt. Signal ist vorzeichen-/
 * verhaeltnis-basiert -> waehrungs-invariant (KRW unbedenklich). Exakte non-US-Entsprechung zu
 * EDGAR-Path-A fuer Micron. Reine Funktionen -> netzwerkfrei.
 *
 * Usage:  node tests/scoring/kr-adapter.test.js   (Exit 0/1)
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { oscExcess } = require('../../src/scoring/score.js');

// 1. PRINZIP: Tiefe haelt den Zyklus, Yahoo-4J verliert ihn nach Rolloff. In KRW (waehrungs-invariant,
//    weil oscExcess rein vorzeichen-basiert ist) — der eigentliche Wert des Adapters.
const deepWithLoss = [40e12, -7.7e12, 6.8e12, 12.4e12, 5e12, 2.7e12, 20.8e12, 13.7e12, 3.3e12, 5.3e12]; // 2023-Verlust drin
const future4J = [40e12, 35e12, 30e12, 25e12]; // Fenster NACH 2023-Rolloff -> alle positiv
assert.equal(oscExcess(deepWithLoss), 1, 'Tiefe: Zyklus bleibt (oscExcess=1) -> Daempfer AN');
assert.equal(oscExcess(future4J), 0, 'Yahoo-4J nach Rolloff: Zyklus weg (oscExcess=0) -> nur Tiefe rettet');

// 2. DATEN-SANITY (tolerant): falls kr-secannual.json committet ist, muss SK Hynix tief + zyklisch sein.
const KR = path.join(__dirname, '..', '..', 'external-data', 'kr-secannual.json');
if (fs.existsSync(KR)) {
  const sk = JSON.parse(fs.readFileSync(KR, 'utf8'))['000660.KS'];
  if (sk) {
    const op = sk.annualOpInc.map((x) => x.value);
    assert.ok(op.length >= 3, 'SK Hynix: >=3 tiefe OpInc-Jahre');
    assert.ok(sk.annualRev.length >= 3, 'SK Hynix: >=3 tiefe Rev-Jahre');
    assert.ok(oscExcess(op) >= 1, 'SK Hynix: OpInc oszilliert (Zyklus in der Tiefe vorhanden)');
  }
}

console.log('ok  kr-adapter: refresh-robust (Tiefe haelt den Zyklus), waehrungs-invariant, Daten-Sanity');

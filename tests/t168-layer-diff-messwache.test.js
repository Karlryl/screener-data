'use strict';
/**
 * Wache zu M11 + M12 (Nacht-Pruef-Sweep 2026-08-29, Orchestrator ENTSCHIED 29).
 *
 * Das gemeinsame Muster beider Befunde: t168-layer-diff.js konnte einen Bericht
 * abliefern, der sauber AUSSIEHT, weil gar nicht gemessen wurde.
 *
 *   M12  Tippfehler im --cache-Pfad -> "Namen mit veraenderter Umsatzreihe: 0",
 *        EXITCODE 0. Der Bericht luegt nicht, er ist leer — und liest sich wie ein
 *        Negativbefund.
 *   M11  Truncierter companyfacts-Cache wurde als "ohne lokalen Cache" verbucht.
 *        Die Bewegungszahl sank still; bei einem ephemeren Runner-Cache ist genau
 *        Trunkierung die wahrscheinlichste Stoerung.
 *
 * Gemessen wird an der SACHE (den Zaehlern und dem Wurf), nicht an Berichtstext.
 * Beide Richtungen: der intakte Cache muss weiterhin sauber durchlaufen, sonst
 * faerbt die Wache jeden normalen Lauf falsch-rot.
 *
 * Usage: node --test tests/t168-layer-diff-messwache.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const { run } = require(path.join(ROOT, 'scripts', 't168-layer-diff.js'));

// run() liest --cache aus process.argv. Der Setzer stellt es fuer genau einen Lauf um.
function mitCache(dir, fn) {
  const orig = process.argv;
  process.argv = ['node', 't168-layer-diff.js', '--cache', dir];
  try { return fn(); } finally { process.argv = orig; }
}

// Ein CIK, den die ausgelieferte Schicht wirklich fuehrt — sonst prueft die Wache
// nur, dass eine erfundene Datei ignoriert wird.
function ersterCik() {
  const schicht = JSON.parse(fs.readFileSync(path.join(ROOT, 'external-data', 'sec-secannual.json'), 'utf8'));
  for (const tk of Object.keys(schicht).sort()) {
    if (schicht[tk] && schicht[tk].cik) return schicht[tk].cik;
  }
  throw new Error('Vorbedingung kaputt: die secannual-Schicht fuehrt keinen einzigen CIK');
}

test('M12: leere Cache-Menge reisst den Lauf, statt eine 0 zu berichten', () => {
  const leer = fs.mkdtempSync(path.join(os.tmpdir(), 't168-leer-'));
  // Richtung A: existierendes, aber leeres Verzeichnis.
  assert.throws(() => mitCache(leer, run), /leere Cache-Menge/,
    'leeres Cache-Verzeichnis muss reissen, nicht "0 Bewegungen" melden');
  // Richtung B: der eigentliche Befund — ein Pfad, den es gar nicht gibt (Tippfehler).
  assert.throws(() => mitCache(path.join(leer, 'tippfehler'), run), /leere Cache-Menge/,
    'Muellpfad muss reissen — genau der M12-Repro');
  fs.rmSync(leer, { recursive: true, force: true });
});

test('M11: truncierter Cache landet in `kaputt`, nicht in `ohneCache`', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't168-kaputt-'));
  const cik = ersterCik();

  // Richtung A: intakter (wenn auch inhaltsleerer) Cache -> kein kaputt-Zaehler.
  fs.writeFileSync(path.join(dir, `${cik}.json`), JSON.stringify({ facts: {} }));
  const heil = mitCache(dir, run);
  assert.equal(heil.stat.kaputt, 0, 'lesbarer Cache darf nicht als kaputt zaehlen');
  assert.equal(heil.stat.geprueft, 1, 'und muss als geprueft durchgehen');

  // Richtung B: dieselbe Datei abgeschnitten -> kaputt zaehlt, ohneCache bleibt gleich.
  fs.writeFileSync(path.join(dir, `${cik}.json`), '{"facts":{"us-gaap":{"Revenues":');
  const kaputt = mitCache(dir, run);
  assert.equal(kaputt.stat.kaputt, 1, 'truncierter Cache muss im eigenen Zaehler landen');
  assert.equal(kaputt.stat.geprueft, 0, 'und darf nicht als geprueft gelten');
  assert.equal(kaputt.stat.ohneCache, heil.stat.ohneCache,
    'ohneCache darf den kaputten Cache NICHT aufsaugen — sonst behauptet der Bericht "kein Cache"');

  fs.rmSync(dir, { recursive: true, force: true });
});

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
const { run, bericht, besterVersatz, VERSATZ_MIN_PAARE, VERSATZ_UNBESTIMMT } =
  require(path.join(ROOT, 'scripts', 't168-layer-diff.js'));

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

// ─── H5 (Nacht-Sweep 29.08., Memo 30.08., ENTSCHIED 52) ─────────────────────────
// Derselbe Satz wie M12, eine Ebene tiefer: eine leere Messmenge ist kein Beleg.
// besterVersatz() gab bei NULL Treffern -2 zurueck (hits startete bei -1, `0 > -1`
// feuerte im ersten Durchlauf), der Bericht machte daraus allein aus `off !== 0` ein
// **FEHLALARM** — ein Entlastungs-Urteil ohne einen einzigen Beleg. Beide Richtungen:
// ein belegter Versatz MUSS weiterhin FEHLALARM heissen duerfen, sonst ist die Regel
// nur ein Generalriegel.
const zellen = (a) => a.map((v) => (v === null ? null : { value: v }));

test('H5: null Treffer -> NICHT BESTIMMBAR, niemals der erfundene Versatz -2', () => {
  // Keine Umsatzskala passt zur anderen, bei keinem der fuenf Versaetze.
  const v = besterVersatz(zellen([100, 200, 300, 400]), zellen([7, 9, 11, 13]));
  assert.equal(v.hits, 0, 'Vorbedingung: die Messmenge ist wirklich leer');
  assert.equal(v.off, VERSATZ_UNBESTIMMT, 'ein unbelegter Versatz darf keine Zahl tragen');
  assert.notEqual(v.off, -2, 'genau der Wert, den die alte Fassung erfand');
  assert.equal(v.lage, 'unaufgeloest');
});

test('H5: Gleichstand belegt nichts (kein "der zuerst gesehene gewinnt")', () => {
  // Versatz -1 und +1 treffen je zwei Paare, 0 keines -> keine eindeutige Spitze.
  const v = besterVersatz(zellen([10, 20, 10, 20]), zellen([20, 10, 20, 10]));
  assert.ok(v.spitze.length > 1, 'Vorbedingung: es gibt wirklich einen Gleichstand');
  assert.equal(v.off, VERSATZ_UNBESTIMMT);
  assert.equal(v.lage, 'unaufgeloest');
});

test(`H5: ein einzelnes Paar bleibt unter der Schwelle (MIN_PAARE = ${VERSATZ_MIN_PAARE})`, () => {
  const v = besterVersatz(zellen([100, 3, 4]), zellen([9, 100, 8]));
  assert.equal(v.hits, 1);
  assert.equal(v.lage, 'unaufgeloest');
  assert.equal(v.off, VERSATZ_UNBESTIMMT);
});

test(`H5 GRENZE: genau ${VERSATZ_MIN_PAARE} Paare reichen (Mutation < auf <= muss rot werden)`, () => {
  // Vom JS-Reviewer gefunden und von mir reproduziert: keiner der uebrigen H5-Waechter
  // beruehrt den Schwellwert selbst — `maxHits <= VERSATZ_MIN_PAARE` lief komplett gruen
  // durch und haette die Schwelle still von ">= 2" auf ">= 3" gehoben.
  // Versatz +1 trifft genau zwei Paare, Versatz 0 keines.
  const v = besterVersatz(zellen([100, 200, 7]), zellen([9, 100, 200]));
  assert.equal(v.hits, VERSATZ_MIN_PAARE, 'Vorbedingung: exakt auf der Schwelle');
  assert.equal(v.lage, 'versatz', 'genau MIN_PAARE Paare sind ein Beleg, nicht einer zu wenig');
  assert.equal(v.off, 1);
});

test('H5 GEGENRICHTUNG: ein belegter Versatz != 0 bleibt bestimmbar', () => {
  // Die SEC-Reihe ist um eine Position nach hinten verschoben -> Versatz +1, 3 Paare.
  const v = besterVersatz(zellen([100, 200, 300]), zellen([7, 100, 200, 300]));
  assert.equal(v.lage, 'versatz');
  assert.equal(v.off, 1);
  assert.ok(v.hits >= VERSATZ_MIN_PAARE);
  assert.ok(v.hits > v.hits0, 'strikte Dominanz gegenueber Versatz 0');
});

test('H5 GEGENRICHTUNG: ausgerichtete Reihen sind Versatz 0, nicht "unaufgeloest"', () => {
  const v = besterVersatz(zellen([100, 200, 300]), zellen([100, 200, 300]));
  assert.equal(v.lage, 'null-versatz');
  assert.equal(v.hits, 3);
  assert.equal(v.off, VERSATZ_UNBESTIMMT, 'auch hier traegt off keine Zahl — 0 waere ein Beleg-Anschein');
});

test('H5: der BERICHT vergibt FEHLALARM nur an den belegten Fall', () => {
  // Am Objekt gemessen, nicht an einer Formulierung: dieselbe bericht()-Funktion, die
  // den committeten Report geschrieben hat, mit den drei Lagen nebeneinander.
  const r = {
    cacheDirs: ['x'], geprueftNamen: new Set(), zeilen: [],
    stat: { namen: 3, geprueft: 3, ohneCache: 0, bewegt: 0, zellen: 0 },
    t174: {
      geprueft: 3, altGruen: 3, kippenNurUmsatz: [],
      kippen: [
        { layer: 'largecap', tk: 'BELEGT', versatz: besterVersatz(zellen([100, 200, 300]), zellen([7, 100, 200, 300])) },
        { layer: 'largecap', tk: 'LEER', versatz: besterVersatz(zellen([100, 200, 300, 400]), zellen([7, 9, 11, 13])) },
        { layer: 'largecap', tk: 'NULLVERSATZ', versatz: besterVersatz(zellen([100, 200, 300]), zellen([100, 200, 300])) },
      ],
    },
  };
  const zeilen = bericht(r).split('\n');
  const zeileVon = (tk) => zeilen.find((z) => z.startsWith(`| ${tk} |`));
  assert.match(zeileVon('BELEGT'), /FEHLALARM/);
  assert.doesNotMatch(zeileVon('LEER'), /FEHLALARM/,
    'ein Fall ohne ein einziges Umsatzpaar darf kein Entlastungs-Urteil bekommen');
  assert.match(zeileVon('LEER'), /UNAUFGELOEST/);
  assert.doesNotMatch(zeileVon('LEER'), /\| -2 \|/, 'und schon gar nicht den erfundenen Versatz -2');
  assert.doesNotMatch(zeileVon('NULLVERSATZ'), /FEHLALARM/);
  assert.match(zeileVon('NULLVERSATZ'), /Tag-Divergenz-Signatur/);
  // Vergaberegel (a): die Trefferzahl wird IMMER mitgedruckt.
  for (const tk of ['BELEGT', 'LEER', 'NULLVERSATZ']) {
    assert.match(zeilen.find((z) => z.startsWith(`| ${tk} |`)), /\| \d+ \(\d+\) \|/,
      `${tk}: ohne gedruckte Trefferzahl ist die Einordnung nicht nachpruefbar`);
  }
});

'use strict';

// Studie 2.0, Phase F1 — das Datenfundament des verbreiterten Konzept-Panels.
//
// DIE SACHE: F1 friert VOR dem Blick von F2 vier Dinge ein — die Wahl-Grundlage,
// die Auswahlregel, die daraus erzeugte Liste und den wiederhergestellten
// Datenjahrgang. Vier Eigenschaften muessen dafuer Eigenschaften des CODES sein,
// nicht Versprechen eines Berichts:
//
//   1. A3 — der num.txt-Leser schneidet nach SPALTENNAME. Beide bekannten
//      Kopfzeilen (9 und 10 Spalten) muessen parsen, ein umbenannter Kopf muss
//      ROT werden. Ein positionsschneidender Leser erzeugt plausible falsche
//      Zahlen ohne jede Ausnahme — das ist der teuerste denkbare stille Fehler.
//   2. A4 — der Dimensionsfilter (segments='' UND coreg='') ist ein ZAEHLER mit
//      drei Waechtern, und jeder muss sich rot bekommen lassen. Gemessen:
//      55.184 Zeilen statt 4.867, Faktor 11,3.
//   3. A2 — die Vintage-Identitaet wird gegen den REGISTRIERTEN sha256 geprueft,
//      nicht gegen den Dateinamen. Falsche Bytes unter richtigem Namen muessen
//      auffliegen.
//   4. K7 (a) — die Regel muss bit-identisch dieselbe Liste erzeugen wie die
//      beschlossene Minimalliste des Urteils. Solange die Form OFFEN ist (2:2),
//      haengt daran, dass beide Lesarten dieselben Bytes tragen.
//
// Dazu der Siegel-Zaun: kein F1-Werkzeug darf das Endtest-Fenster anfassen.

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const REPO = path.join(__dirname, '..');
const SKRIPTE = {
  vintage: 'studie-f1-vintage-wiederherstellung.py',
  leser: 'studie-f1-dera-leser.py',
  regel: 'studie-f1-konzeptregel.py',
  freeze: 'studie-f1-freeze.py',
};

function selbsttest(name) {
  return spawnSync(process.env.PYTHON || 'python',
    [path.join(REPO, 'scripts', SKRIPTE[name]), '--selbsttest'],
    { encoding: 'utf8', cwd: REPO });
}

const laeufe = {};
function lauf(name) {
  if (!laeufe[name]) laeufe[name] = selbsttest(name);
  return laeufe[name];
}

// Die Pruefungen, die im jeweiligen Selbsttest namentlich vorkommen MUESSEN.
// Ein Selbsttest, aus dem eine Zeile still verschwindet, ist danach gruen und
// wertlos — deshalb steht die Liste hier und nicht nur dort.
const PFLICHT = {
  vintage: [
    'Endtest-Quartal wird abgelehnt',
    'Plattenplatz-Gate reisst bei Grossem',
    'falsche Bytes unter richtigem Namen fliegen auf',
    'richtige Bytes gelten als bewiesen',
  ],
  leser: [
    '9-Spalten-Kopf parst',
    '10-Spalten-Kopf parst',
    'nach Namen geschnitten, nicht nach Position',
    'fremder Kopf fliegt auf (umbenannte Spalte)',
    'ifrs-full wird auf ifrs abgebildet',
    'Dimensionsfilter zaehlt beide Seiten',
    'W-A4-a reisst bei abgeschaltetem Filter',
    'W-A4-b reisst, wenn der Filter nie feuert',
    'W-A4-c reisst bei zu hohem Verhaeltnis',
    'Naturschluessel mit segments trennt Dimensionszeilen',
  ],
  regel: [
    'hoechste Rettungszahl gewinnt',
    'Z3a reisst ausserhalb des Bank-Stratums',
    'Z3a reisst im Bank-Stratum nicht',
    'Z3b laesst ExcludingAssessedTax durch',
    'Gleichstand macht die Klasse NICHT BERECHENBAR',
    'Urteils-Waechter reisst',
    'leere Klasse wird als ehrlicher Ausschluss gefuehrt',
    'Unterschreitung wird protokolliert',
    'Liste ist bit-identisch reproduzierbar',
  ],
  freeze: [
    'K7a-Koinzidenz wird festgestellt',
    'Kontaminations-Vorgeschichte steht woertlich drin',
    'Freeze-Hash verifiziert sich selbst',
    'manipulierte Liste fliegt auf',
    'geaenderter Code aendert den Freeze-Hash',
    'gebrochener Vintage steht namentlich im Freeze',
  ],
};

for (const name of Object.keys(SKRIPTE)) {
  test(`F1/${name}: Selbsttest ist gruen`, () => {
    const r = lauf(name);
    assert.equal(r.status, 0, `${SKRIPTE[name]} --selbsttest rot:\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, /Pruefungen bestanden/);
    assert.doesNotMatch(r.stdout, /^FAIL/m);
  });

  test(`F1/${name}: keine Pflichtpruefung ist still verschwunden`, () => {
    const r = lauf(name);
    for (const zeile of PFLICHT[name]) {
      assert.ok(r.stdout.includes(`PASS  ${zeile}`),
        `Pflichtpruefung fehlt oder ist rot: "${zeile}"`);
    }
  });
}

// Der Siegel-Zaun steht als Konstante im Code beider Werkzeuge, die Payloads
// anfassen. Wer ihn verschiebt, verschiebt ihn sichtbar.
test('F1: das Endtest-Fenster ist in beiden Werkzeugen ausgezaeunt', () => {
  for (const name of ['vintage', 'leser']) {
    const quelle = fs.readFileSync(path.join(REPO, 'scripts', SKRIPTE[name]), 'utf8');
    assert.match(quelle, /LETZTES_OFFENES_QUARTAL = "2020q4"/,
      `${SKRIPTE[name]} fuehrt die Siegel-Grenze nicht`);
  }
});

// Die Regel wird gegen das ECHTE blinde Inventar gefahren, wenn es vorliegt:
// K7 (a) ist OFFEN, und die einzige Bruecke ueber die 2:2 ist, dass Regel und
// beschlossene Liste bit-identisch dasselbe erzeugen. Liegt der Vault nicht vor
// (CI), wird der Test uebersprungen statt gruen zu luegen.
const INVENTAR = path.join('C:', 'Users', 'Anwender', 'OneDrive', 'Dokumente', 'GitHub',
  'Jarvis', 'Knowledge', 'Trading', 'growth-screener', 'agent-reports',
  'konzept-inventar-blind-2026-08-30.json');
const URTEILS_LISTE = [
  'us-gaap:InterestAndDividendIncomeOperating',
  'us-gaap:OilAndGasRevenue',
  'us-gaap:RealEstateRevenueNet',
  'us-gaap:RegulatedAndUnregulatedOperatingRevenue',
].sort();

test('F1: die Regel erzeugt bit-identisch die Liste des Urteils', { skip: !fs.existsSync(INVENTAR) ? 'blindes Inventar liegt hier nicht vor' : false }, () => {
  // Der Lauf schreibt in ein Wegwerf-Ziel, nicht auf das committete Artefakt —
  // sonst macht jeder gruene Testlauf den Arbeitsbaum schmutzig.
  const ziel = path.join(fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'f1-')),
    'regel.json');
  const r = spawnSync(process.env.PYTHON || 'python',
    [path.join(REPO, 'scripts', SKRIPTE.regel), '--inventar', INVENTAR, '--bericht', ziel],
    { encoding: 'utf8', cwd: REPO });
  assert.equal(r.status, 0, `Regel-Lauf rot:\n${r.stderr}`);
  const erzeugt = JSON.parse(fs.readFileSync(ziel, 'utf8'));
  const kennungen = erzeugt.konzeptliste
    .map((e) => `${e.taxonomy}:${e.concept}`).sort();
  assert.deepEqual(kennungen, URTEILS_LISTE);
  // Das Bank-Stratum ist eigenes Stratum (K8), nie stiller Teil der Gesamtliste.
  const bank = erzeugt.konzeptliste.find((e) => e.concept === 'InterestAndDividendIncomeOperating');
  assert.equal(bank.eigenesStratum, true);
  assert.equal(bank.eintrittsModus, 'reiner_fallback');
  assert.equal(bank.brutto, true);
  // Die vom Urteil ausgeschlossenen Kennungen sind nicht drin.
  for (const draussen of erzeugt.waechterUrteilDraussen) {
    assert.ok(!kennungen.includes(draussen), `ausgeschlossene Kennung in der Liste: ${draussen}`);
  }
});

// Der eingefrorene Stand muss sich gegen sich selbst verifizieren lassen. Ohne
// diesen Test waere der Freeze eine Datei mit einer Zahl darin.
const FREEZE = path.join(REPO, 'reports', 'studie',
  'f1-datenfundament-freeze-2026-08-30.json');

test('F1: der Freeze verifiziert sich gegen seinen eigenen Inhalt', { skip: !fs.existsSync(FREEZE) ? 'F1-Freeze liegt noch nicht vor' : false }, () => {
  const r = spawnSync(process.env.PYTHON || 'python',
    [path.join(REPO, 'scripts', SKRIPTE.freeze), '--pruefen', FREEZE],
    { encoding: 'utf8', cwd: REPO });
  assert.equal(r.status, 0, `Freeze-Pruefung rot:\n${r.stdout}\n${r.stderr}`);
  const ergebnis = JSON.parse(r.stdout);
  assert.equal(ergebnis.gueltig, true);

  const inhalt = JSON.parse(fs.readFileSync(FREEZE, 'utf8'));
  assert.equal(inhalt.k7aKoinzidenz.deckungsgleich, true);
  assert.deepEqual(inhalt.k7aKoinzidenz.regelErzeugt, URTEILS_LISTE);
  // A16/K3-5: die Kontaminations-Vorgeschichte steht woertlich, nicht geglaettet.
  assert.match(inhalt.block6_kontaminationsVorgeschichte, /89,32 %/);
  assert.match(inhalt.block6_kontaminationsVorgeschichte, /330\/365 = 90,411 %/);
  assert.match(inhalt.block6_kontaminationsVorgeschichte, /A18/);
  // F1 schreibt keinen Register-Eintrag — das faellt bei F3.
  assert.match(inhalt.registerEintrag, /keiner/);
  // Die offenen Punkte reisen mit, statt hier zu verschwinden.
  const offen = inhalt.offenePunkte.map((p) => p.id);
  for (const id of ['RR-1', 'RR-2', 'RR-4', 'D9', 'A10']) {
    assert.ok(offen.includes(id), `offener Punkt fehlt im Freeze: ${id}`);
  }
});
